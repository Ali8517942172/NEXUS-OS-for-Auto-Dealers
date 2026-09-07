-- Lead ingestion, part 11: three read-then-write windows, and the one that made
-- three customers out of one enquiry.
--
-- WHAT WAS MEASURED, NOT REASONED ABOUT
-- -------------------------------------
-- ops/journey-lab/README.md has said since 6 September that this Lab's twenty
-- journeys are sequential and that "twenty sequential journeys never put five
-- deliveries in flight". On 7 September five genuine concurrent backends (pg_cron
-- jobs sharing a pg_sleep_until barrier, all five entering within 25 ms) were
-- pointed at the ingestion family on staging. Three races, three results:
--
--   A. RECORD, five concurrent deliveries of one Google lead_id
--      -> 1 inserted, 4 raised 23505 lead_event_identity_key.
--      The function's own comment says a duplicate "must return an answer the
--      caller can turn into a 200" -- because Google permanently DISCARDS a lead
--      on a 4XX. That promise held only for a duplicate arriving after the first
--      had committed. A duplicate arriving *at the same moment* -- which is what
--      at-least-once delivery and an n8n retry actually produce -- got an
--      exception the receiver has no branch for.
--
--   B. PROMOTE, five concurrent promotions of one lead_event WITH an email
--      -> 1 lead, 4 raised 23505 leads_tenant_email_key.
--      Nothing in the promoter stopped the second promotion. A unique index on
--      (tenant_id, email) did. That is an incidental lock, and this file's own
--      house rules say what those are worth.
--
--   C. PROMOTE, five concurrent promotions of one lead_event with NO EMAIL
--      -> THREE leads rows: 41, 42, 43. All five callers succeeded. Two were
--      told was_already_promoted = true.
--
-- C is the defect. A unique index does not constrain NULLs, so the incidental
-- lock in B is absent exactly where UAE lead flow lives: the walk-in, the phone
-- call, the WhatsApp enquiry. CLAUDE.md already measures 25% of production leads
-- as having no email at all.
--
-- And the damage is worse than a duplicate row. lead_event.lead_id can hold one
-- value, so it kept 42; leads 41 and 43 are ORPHANS -- in the funnel, carrying
-- source = google_ads_lead_form, counted by pipeline value and by
-- nexus_lead_attribution, and nexus_lead_trace answers arrival = NO_ROWS for
-- both, which reads as "this customer predates the ingestion layer". Three
-- salespeople, three CRM cards, one person called three times, and every caller
-- got a 200.
--
-- THE FIX IS A LOCK, NOT A CONSTRAINT
-- -----------------------------------
-- The tidy answer -- a unique index on (tenant_id, phone) or a marker column --
-- is ALTER TABLE on public.leads, which fires nexus_guard_born_open_grants() and
-- strips the live dashboard's write grants. CLAUDE.md records that as a worked
-- example: route around the guard rather than firing it again. All three fixes
-- below are CREATE OR REPLACE FUNCTION and touch no table.
--
--   promote / hydrate: SELECT ... FOR UPDATE. A second concurrent caller blocks
--   until the first commits, then re-reads a row that now says PROMOTED and
--   returns was_already_promoted = true -- the same answer it already gives
--   sequentially. The guarantee stops depending on timing.
--
--   record: INSERT ... ON CONFLICT DO NOTHING, then re-read. ON CONFLICT takes a
--   speculative-insertion lock, so the loser waits for the winner and then finds
--   the row, and a concurrent duplicate returns was_duplicate = true instead of
--   23505. The one case it cannot answer is a concurrent writer that ROLLED
--   BACK: there is then no row to return and no duplicate to report, so it
--   raises by name rather than inventing an answer -- and the receiver's 5XX
--   branch is the correct home for that, because it makes Google hold the lead.

create or replace function public.nexus_record_lead_event(
  p_public_key       text,
  p_external_event_id text,
  p_origin_verified  text,
  p_payload_raw      jsonb,
  p_occurred_at      timestamptz default null,
  p_normalized       jsonb default null)
returns table (event_id uuid, tenant_id uuid, phase text, was_duplicate boolean, source_key text)
language plpgsql
set search_path = public
as $$
declare
  r_ep     record;
  v_real   boolean;
  v_defect text;
  v_id     uuid;
  v_phase  text;
begin
  select * into r_ep from public.nexus_lead_endpoint_for_public_key(p_public_key);
  if not found then
    raise exception using
      errcode = 'NX001',
      message = 'No active lead endpoint answers to that key.',
      detail  = 'LEAD_ENDPOINT_UNRESOLVED',
      hint    = 'The endpoint is unregistered, disabled, or its dealership is not active. There is no fallback tenant on purpose: a resolver that guesses is how one dealership''s traffic writes another''s data.';
  end if;

  select counts_as_real into v_real
    from public.lead_provenance_kind where kind = p_origin_verified;
  if v_real is null then
    raise exception using
      errcode = 'NX001',
      message = 'Unknown provenance kind: ' || coalesce(p_origin_verified, '(null)') || '.',
      detail  = 'PROVENANCE_KIND_UNKNOWN',
      hint    = 'Provenance is a registered vocabulary, not free text. Read public.lead_provenance_kind.';
  end if;

  if r_ep.environment = 'production' and p_origin_verified <> r_ep.declared_provenance then
    raise exception using
      errcode = 'NX001',
      message = 'This endpoint is registered to prove origin by ' || r_ep.declared_provenance ||
                ', and this event claims ' || p_origin_verified || '.',
      detail  = 'PROVENANCE_WEAKER_THAN_ENDPOINT_DECLARES',
      hint    = 'Verify the request the way the endpoint says it will be verified, or register a second endpoint. Accepting a weaker proof on a production endpoint silently downgrades every lead that came through it.';
  end if;

  if p_occurred_at is not null and p_occurred_at > now() + interval '1 day' then
    raise exception using
      errcode = 'NX001',
      message = 'This lead claims to have happened at ' || p_occurred_at || ', which is in the future.',
      detail  = 'OCCURRED_AT_IN_THE_FUTURE',
      hint    = 'Clock skew of minutes is tolerated. A day is a wrong field, and storing it would put a future date in front of a salesperson as though it were measured.';
  end if;

  if p_normalized is not null then
    v_defect := public.nexus_lead_normalized_defect(p_normalized);
    if v_defect is not null then
      raise exception using
        errcode = 'NX001',
        message = 'The normalised lead does not satisfy the Lead Event contract.',
        detail  = v_defect,
        hint    = 'Record the event without a normalised object and reject it with a stated reason, rather than promoting a lead nobody can be contacted on.';
    end if;
  end if;

  -- Duplicates are ordinary, not exceptional. Meta says duplicates can occur;
  -- Google is explicitly at-least-once and permanently discards a lead on a 4XX,
  -- so a duplicate must return an answer the caller can turn into a 200.
  --
  -- The cheap read-then-insert this used to be gave that answer only when the
  -- duplicate arrived after the first had committed. Measured 7 Sep 2026 with
  -- five concurrent backends: one insert, four 23505. ON CONFLICT closes the
  -- window -- the loser waits on the speculative-insertion lock and then reads
  -- the winner's row.
  select e.event_id, e.phase into v_id, v_phase
    from public.lead_event e
   where e.tenant_id = r_ep.tenant_id
     and e.source_key = r_ep.source_key
     and e.external_event_id = p_external_event_id;

  if found then
    return query select v_id, r_ep.tenant_id, v_phase, true, r_ep.source_key;
    return;
  end if;

  insert into public.lead_event (
    tenant_id, endpoint_id, source_key, environment, origin_verified,
    provenance_counts_as_real, external_event_id, occurred_at, payload_raw,
    normalized, phase
  ) values (
    r_ep.tenant_id, r_ep.endpoint_id, r_ep.source_key, r_ep.environment, p_origin_verified,
    v_real, p_external_event_id, p_occurred_at, coalesce(p_payload_raw, '{}'::jsonb),
    p_normalized, case when p_normalized is null then 'RECEIVED' else 'HYDRATED' end
  )
  -- ON CONSTRAINT, not a column list: the function's RETURNS TABLE declares
  -- tenant_id, phase and source_key as plpgsql variables, so an inference
  -- clause naming those columns is "42702 column reference is ambiguous". The
  -- first call after deploying the column-list form said so, which is why the
  -- fixture step runs before the race and not after it.
  on conflict on constraint lead_event_identity_key do nothing
  returning public.lead_event.event_id, public.lead_event.phase into v_id, v_phase;

  if v_id is not null then
    return query select v_id, r_ep.tenant_id, v_phase, false, r_ep.source_key;
    return;
  end if;

  -- We lost the race. The winner has committed by now, so read its row and give
  -- this caller the ordinary duplicate answer.
  select e.event_id, e.phase into v_id, v_phase
    from public.lead_event e
   where e.tenant_id = r_ep.tenant_id
     and e.source_key = r_ep.source_key
     and e.external_event_id = p_external_event_id;

  if found then
    return query select v_id, r_ep.tenant_id, v_phase, true, r_ep.source_key;
    return;
  end if;

  -- Neither inserted nor present: the concurrent writer rolled back. There is
  -- nothing true to return, so say so rather than guess. A receiver must turn
  -- this into a 5XX so the provider holds the lead and delivers it again.
  raise exception using
    errcode = 'NX001',
    message = 'A concurrent delivery of this same lead held the key and then rolled back, so nothing was recorded.',
    detail  = 'CONCURRENT_RECORD_ROLLED_BACK',
    hint    = 'Answer 5XX. Google and Meta both redeliver, and the retry will find a clear key. Answering 4XX here discards a real customer for a race that resolved itself.';
end $$;

comment on function public.nexus_record_lead_event(text,text,text,jsonb,timestamptz,jsonb) is
  'Door one. Records an arrival against the endpoint that received it. A '
  'duplicate returns was_duplicate = true and does not raise -- including a '
  'duplicate that arrives concurrently, which the earlier read-then-insert '
  'answered with 23505 (measured, five backends, 7 Sep 2026).';

create or replace function public.nexus_hydrate_lead_event(
  p_event_id uuid, p_hydrated_payload jsonb, p_normalized jsonb)
returns table (event_id uuid, phase text)
language plpgsql
set search_path = public
as $$
declare r record; v_defect text;
begin
  -- FOR UPDATE. The phase check below is a decision taken on what this row says,
  -- and without the lock the row could say something else by the time the UPDATE
  -- lands. Two concurrent Graph API fetches both saw RECEIVED and both wrote,
  -- so the function's own promise -- "re-fetching would overwrite what the
  -- salesperson has been working from" -- was exactly what happened.
  select * into r from public.lead_event
   where public.lead_event.event_id = p_event_id
   for update;
  if not found then
    raise exception using errcode = 'NX001',
      message = 'No lead event with that id.', detail = 'LEAD_EVENT_NOT_FOUND',
      hint = 'Record the event first; hydration updates a row it does not create.';
  end if;
  if r.phase <> 'RECEIVED' then
    raise exception using errcode = 'NX001',
      message = 'This event is ' || r.phase || ' and only a RECEIVED event can be hydrated.',
      detail = 'LEAD_EVENT_NOT_AWAITING_HYDRATION',
      hint = 'Re-fetching a lead that has already been hydrated or promoted would overwrite what the salesperson has been working from.';
  end if;
  v_defect := public.nexus_lead_normalized_defect(p_normalized);
  if v_defect is not null then
    raise exception using errcode = 'NX001',
      message = 'The fetched lead does not satisfy the Lead Event contract.',
      detail = v_defect,
      hint = 'Use nexus_reject_lead_event with a stated reason. A lead with no way to reach the customer is evidence of a broken form, and it should be visible as that rather than promoted and left to rot.';
  end if;

  update public.lead_event
     set hydrated_payload = p_hydrated_payload,
         hydrated_at      = now(),
         normalized       = p_normalized,
         phase            = 'HYDRATED'
   where public.lead_event.event_id = p_event_id;

  return query select p_event_id, 'HYDRATED'::text;
end $$;

comment on function public.nexus_hydrate_lead_event(uuid,jsonb,jsonb) is
  'Door two. Attaches the customer data fetched from the provider. Takes a row '
  'lock: the phase check is a decision about this row and was previously taken '
  'without one, so two concurrent fetches both passed it.';

create or replace function public.nexus_promote_lead_event(p_event_id uuid)
returns table (event_id uuid, lead_id integer, was_already_promoted boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare r record; v_lead integer;
begin
  -- FOR UPDATE, and this is the line the whole migration exists for. Without it,
  -- five concurrent promotions of one phone-only event produced THREE leads
  -- rows (41, 42, 43 on staging, 7 Sep 2026) -- two of them orphans that no
  -- lead_event points at, all three counted as customers. Two of the five
  -- callers were told was_already_promoted = true while the other two were
  -- quietly creating the duplicates.
  --
  -- The email case looked safe only because leads_tenant_email_key refused the
  -- second insert. A unique index does not constrain NULLs, and a UAE walk-in,
  -- phone call or WhatsApp enquiry has no email.
  select * into r from public.lead_event
   where public.lead_event.event_id = p_event_id
   for update;
  if not found then
    raise exception using errcode = 'NX001',
      message = 'No lead event with that id.', detail = 'LEAD_EVENT_NOT_FOUND', hint = 'Record it first.';
  end if;
  if r.phase = 'PROMOTED' then
    return query select p_event_id, r.lead_id, true;
    return;
  end if;
  if r.phase <> 'HYDRATED' then
    raise exception using errcode = 'NX001',
      message = 'This event is ' || r.phase || ' and only a HYDRATED event carries a customer to promote.',
      detail = 'LEAD_EVENT_NOT_HYDRATED',
      hint = 'A RECEIVED Meta event holds six ids and no customer. Fetch it from the Graph API first.';
  end if;
  if r.origin_verified = 'unverified' then
    raise exception using errcode = 'NX001',
      message = 'This lead''s origin was never established, so it will not be put in front of a salesperson.',
      detail = 'PROMOTION_REQUIRES_ESTABLISHED_ORIGIN',
      hint = 'Retain it for inspection. A lead nobody can attribute is indistinguishable from one somebody injected.';
  end if;

  if r.environment <> 'production' then
    raise exception using errcode = 'NX001',
      message = 'This event is ' || r.environment || ' traffic and public.leads has no way to say so.',
      detail = 'PROMOTION_REQUIRES_PRODUCTION_ENVIRONMENT',
      hint = 'A simulation event may be recorded, hydrated, read and reported on through v_lead_origin, which carries is_test_traffic. It may not become a leads row: that table has no simulation marker, so the row would be counted as a real customer by pipeline value, response-time reporting and every recovered-revenue figure. To give the simulator a funnel, add a marker column to public.leads and teach its readers to filter -- deliberately, and re-granting the dashboard write grants that nexus_guard_born_open_grants() strips on any ALTER TABLE there.';
  end if;

  insert into public.leads (name, email, phone, source, vehicle_interest, budget_aed, status, tenant_id)
  values (
    r.normalized->>'full_name',
    nullif(btrim(coalesce(r.normalized->>'email','')), ''),
    nullif(btrim(coalesce(r.normalized->>'phone_e164','')), ''),
    r.source_key,
    nullif(btrim(coalesce(r.normalized->>'vehicle_interest',
                          r.normalized->>'vehicle_of_interest', '')), ''),
    case when jsonb_typeof(r.normalized->'budget_aed') = 'number'
         then (r.normalized->>'budget_aed')::integer end,
    'new',
    r.tenant_id
  )
  returning public.leads.id into v_lead;

  update public.lead_event
     set lead_id = v_lead, promoted_at = now(), phase = 'PROMOTED'
   where public.lead_event.event_id = p_event_id;

  return query select p_event_id, v_lead, false;
end $$;

comment on function public.nexus_promote_lead_event(uuid) is
  'Door three. Creates the leads row and links it in one transaction, and sets '
  'leads.source to the source_key -- the origin, not the writer. Refuses a '
  'non-production event: public.leads has no column that can say a row is '
  'simulated. Takes a row lock on the event: without one, five concurrent '
  'promotions of a phone-only lead made three customers, two of them orphans.';

-- The invariant that would have caught leads 41 and 43 while nothing else did.
-- An orphan is invisible to every check written so far: it satisfies every
-- constraint on lead_event (because no lead_event row is involved), it carries a
-- real origin in leads.source, and nexus_lead_trace reports arrival = NO_ROWS,
-- which reads as "this customer predates the ingestion layer" rather than as a
-- fault. It is only visible from the leads side, looking back.
create or replace function public.nexus_lead_ingest_invariants()
returns table (invariant text, status text, detail text)
language sql
stable
set search_path = public
as $$
  select 'A production endpoint never accepts provenance that is not real business',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*) || ' endpoint(s)'
    from public.lead_ingest_endpoint
   where environment = 'production' and not provenance_counts_as_real
  union all
  select 'A production event never rests on provenance that is not real business',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*) || ' event(s)'
    from public.lead_event where environment = 'production' and not provenance_counts_as_real
  union all
  select 'No promoted lead came from an unestablished origin',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*) || ' event(s)'
    from public.lead_event where phase = 'PROMOTED' and origin_verified = 'unverified'
  union all
  select 'No promoted event points at a lead belonging to another dealership',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*) || ' event(s)'
    from public.lead_event e join public.leads l on l.id = e.lead_id
   where l.tenant_id <> e.tenant_id
  union all
  select 'Simulator output never carries a production label',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*) || ' event(s)'
    from public.lead_event where environment = 'production' and origin_verified = 'simulated'
  union all
  select 'Manual entry holds no secret and no public origin',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*) || ' endpoint(s)'
    from public.lead_ingest_endpoint
   where declared_provenance = 'operator_recorded'
     and (secret_ref is not null or cardinality(origin_allowlist) > 0)
  union all
  select 'Every source in the catalogue names a provenance that exists',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*) || ' source(s)'
    from public.lead_source_catalogue c
    left join public.lead_provenance_kind p on p.kind = c.required_provenance
   where p.kind is null
  union all
  -- Added 7 Sep 2026 after a concurrency race made two of them. A lead carrying
  -- an ingestion source_key got there through door three, so a lead_event must
  -- point back at it. One that none does is an orphan: counted in the funnel,
  -- counted by nexus_lead_attribution, and reported by nexus_lead_trace as an
  -- arrival with NO_ROWS -- which reads as "predates the layer", not as a fault.
  select 'Every lead carrying an ingestion source is pointed at by the event that made it',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*) || ' orphan lead(s): '
         || coalesce(string_agg(l.id::text, ', ' order by l.id), '(none)')
    from public.leads l
    join public.lead_source_catalogue c on c.source_key = l.source
   where not exists (select 1 from public.lead_event e where e.lead_id = l.id)
  union all
  select 'Share of arrivals that nothing external attested',
         'INFO',
         coalesce((select count(*)::text from public.lead_event e
                     join public.lead_provenance_kind p on p.kind = e.origin_verified
                    where e.environment = 'production' and not p.is_externally_attested), '0')
         || ' of '
         || (select count(*)::text from public.lead_event where environment = 'production')
         || ' production arrival(s) rest on a person''s word, not a signature'
  union all
  select 'Sources with no public integration are marked as such, not as buildable',
         'INFO',
         coalesce(string_agg(display_name, ', ' order by display_name), '(none)')
    from public.lead_source_catalogue where integration_status <> 'AVAILABLE';
$$;

-- CREATE OR REPLACE keeps an existing ACL. This database has been surprised
-- three distinct ways by what a function is granted after it is written, so the
-- grants are re-stated and then asserted with has_function_privilege() rather
-- than read out of proacl -- where a role reaching a function through the bare
-- PUBLIC entry does not appear at all.
revoke all on function public.nexus_record_lead_event(text,text,text,jsonb,timestamptz,jsonb) from public, anon, authenticated;
revoke all on function public.nexus_hydrate_lead_event(uuid,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.nexus_promote_lead_event(uuid) from public, anon, authenticated;
revoke all on function public.nexus_lead_ingest_invariants() from public, anon, authenticated;
grant execute on function public.nexus_record_lead_event(text,text,text,jsonb,timestamptz,jsonb) to service_role;
grant execute on function public.nexus_hydrate_lead_event(uuid,jsonb,jsonb) to service_role;
grant execute on function public.nexus_promote_lead_event(uuid) to service_role;
grant execute on function public.nexus_lead_ingest_invariants() to service_role;

do $$
declare
  fns text[] := array[
    'public.nexus_record_lead_event(text,text,text,jsonb,timestamptz,jsonb)',
    'public.nexus_hydrate_lead_event(uuid,jsonb,jsonb)',
    'public.nexus_promote_lead_event(uuid)',
    'public.nexus_lead_ingest_invariants()'];
  f text;
  bad text[] := '{}';
begin
  foreach f in array fns loop
    if has_function_privilege('anon', f, 'execute') then
      bad := array_append(bad, 'anon can execute ' || f);
    end if;
    if has_function_privilege('authenticated', f, 'execute') then
      bad := array_append(bad, 'authenticated can execute ' || f);
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      bad := array_append(bad, 'service_role CANNOT execute ' || f || ', so ingestion is broken');
    end if;
  end loop;
  if cardinality(bad) > 0 then
    raise exception 'lead ingestion ACLs are wrong: %', array_to_string(bad, '; ');
  end if;
end $$;
