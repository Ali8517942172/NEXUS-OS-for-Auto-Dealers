-- Lead ingestion, part 4 of 4: the writers, the dealership's view, and a
-- self-check.
--
-- Three doors, one per phase, each refusing loudly rather than returning a
-- column nobody reads. The four policy write functions learned this the hard
-- way: a refusal signalled as `ok=false` and raised nothing was read as success
-- by a QA agent, which then filed a false finding from it. Everything here
-- raises SQLSTATE NX001 with the machine code in DETAIL, the sentence in
-- MESSAGE and the next step in HINT.

-- The normalised Lead Event contract. One shape, whatever carried it.
create or replace function public.nexus_lead_normalized_defect(p_normalized jsonb)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select case
    when p_normalized is null or jsonb_typeof(p_normalized) <> 'object'
      then 'NORMALIZED_MUST_BE_AN_OBJECT'
    when coalesce(btrim(p_normalized->>'full_name'), '') = ''
      then 'NORMALIZED_FULL_NAME_REQUIRED'
    when coalesce(btrim(p_normalized->>'email'), '') = ''
     and coalesce(btrim(p_normalized->>'phone_e164'), '') = ''
      then 'NORMALIZED_NEEDS_EMAIL_OR_PHONE'
    when p_normalized ? 'phone_e164'
     and coalesce(btrim(p_normalized->>'phone_e164'), '') <> ''
     and p_normalized->>'phone_e164' !~ '^\+[1-9][0-9]{7,14}$'
      then 'NORMALIZED_PHONE_MUST_BE_E164'
    when p_normalized ? 'email'
     and coalesce(btrim(p_normalized->>'email'), '') <> ''
     and p_normalized->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      then 'NORMALIZED_EMAIL_MALFORMED'
    when p_normalized ? 'budget_aed'
     and jsonb_typeof(p_normalized->'budget_aed') not in ('number','null')
      then 'NORMALIZED_BUDGET_MUST_BE_A_NUMBER'
    else null
  end;
$$;

comment on function public.nexus_lead_normalized_defect(jsonb) is
  'The Lead Event contract, as a predicate. Returns null when the normalised '
  'object is acceptable and a machine code when it is not. Required: full_name, '
  'and at least one of email or phone_e164. Phone must already be E.164 -- this '
  'function does not guess a country code, because guessing +971 onto a number '
  'that was never local is how a dealership messages a stranger.';

-- Door one: something arrived.
create or replace function public.nexus_record_lead_event(
  p_public_key        text,
  p_external_event_id text,
  p_origin_verified   text,
  p_payload_raw       jsonb,
  p_occurred_at       timestamptz default null,
  p_normalized        jsonb default null
)
returns table (event_id uuid, tenant_id uuid, phase text, was_duplicate boolean, source_key text)
language plpgsql
security invoker
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

  -- A provider clock ahead of ours is ordinary; a lead dated next month is not,
  -- and a stored future timestamp reads to anyone auditing the table as a fact.
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
  returning public.lead_event.event_id, public.lead_event.phase into v_id, v_phase;

  return query select v_id, r_ep.tenant_id, v_phase, false, r_ep.source_key;
end $$;

comment on function public.nexus_record_lead_event(text, text, text, jsonb, timestamptz, jsonb) is
  'Door one. Records what arrived and returns whether it was already known. A '
  'duplicate is a normal return, never an exception, because Google Ads '
  'permanently discards a lead when the webhook answers 4XX -- a processing '
  'failure must answer 5XX and a duplicate must answer 200.';

-- Door two: the second fetch came back. Meta and inbound email only.
create or replace function public.nexus_hydrate_lead_event(
  p_event_id         uuid,
  p_hydrated_payload jsonb,
  p_normalized       jsonb
)
returns table (event_id uuid, phase text)
language plpgsql
security invoker
set search_path = public
as $$
declare r record; v_defect text;
begin
  select * into r from public.lead_event where public.lead_event.event_id = p_event_id;
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

-- Door three: become a lead.
create or replace function public.nexus_promote_lead_event(p_event_id uuid)
returns table (event_id uuid, lead_id integer, was_already_promoted boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare r record; v_lead integer;
begin
  select * into r from public.lead_event where public.lead_event.event_id = p_event_id;
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

  insert into public.leads (name, email, phone, source, vehicle_interest, budget_aed, status, tenant_id)
  values (
    r.normalized->>'full_name',
    nullif(btrim(coalesce(r.normalized->>'email','')), ''),
    nullif(btrim(coalesce(r.normalized->>'phone_e164','')), ''),
    r.source_key,
    nullif(btrim(coalesce(r.normalized->>'vehicle_interest','')), ''),
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
  'leads.source to the source_key -- which is the fix for the defect that '
  'started this work: every lead in production carries source = '
  '''nexus-master-router'', the name of the workflow that wrote it, so the '
  'column recorded the writer and no question about origin could be answered.';

create or replace function public.nexus_reject_lead_event(
  p_event_id uuid, p_phase text, p_reason text
)
returns table (event_id uuid, phase text)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_phase not in ('REJECTED','QUARANTINED','EXPIRED','DUPLICATE') then
    raise exception using errcode = 'NX001',
      message = p_phase || ' is not a terminal phase.', detail = 'PHASE_NOT_TERMINAL',
      hint = 'REJECTED (we refused it), QUARANTINED (held for inspection), EXPIRED (the provider''s retention window closed before we fetched it -- the lead was real and is unrecoverable), DUPLICATE.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception using errcode = 'NX001',
      message = 'A terminal disposition must state its reason.', detail = 'DISPOSITION_REASON_REQUIRED',
      hint = 'An unexplained rejection is indistinguishable from a lead that never arrived, and this codebase has rendered unknown as none in seven places.';
  end if;
  update public.lead_event set phase = p_phase, disposition_reason = p_reason
   where public.lead_event.event_id = p_event_id and public.lead_event.phase in ('RECEIVED','HYDRATED');
  if not found then
    raise exception using errcode = 'NX001',
      message = 'No open lead event with that id.', detail = 'LEAD_EVENT_NOT_OPEN',
      hint = 'It does not exist, or it is already terminal or promoted. Terminal dispositions are not rewritten.';
  end if;
  return query select p_event_id, p_phase;
end $$;

-- What a dealership may see: symptom, not mechanism. Endpoint ids, public keys,
-- secret references and raw provider payloads are the vendor's plumbing and are
-- absent from the result type rather than merely unselected.
create or replace view public.v_lead_origin
with (security_invoker = true) as
select e.event_id,
       e.tenant_id,
       c.display_name          as source,
       c.channel_family,
       e.phase,
       e.disposition_reason,
       e.received_at,
       e.occurred_at,
       e.lead_id,
       p.is_cryptographic      as origin_cryptographically_verified,
       p.strength_rank         as origin_strength,
       e.environment = 'simulation' as is_test_traffic
  from public.lead_event e
  join public.lead_source_catalogue c on c.source_key = e.source_key
  join public.lead_provenance_kind  p on p.kind = e.origin_verified;

comment on view public.v_lead_origin is
  'Where a dealership''s leads came from and how well that is attested. '
  'is_test_traffic is exposed rather than filtered out, so a screen that forgets '
  'to exclude simulation traffic shows it as test data instead of counting it as '
  'real. Mechanism -- endpoint ids, keys, secret references, raw payloads -- is '
  'not in this view''s result type at all.';

alter view public.v_lead_origin owner to postgres;
revoke all on public.v_lead_origin from anon, authenticated, public;
grant select on public.v_lead_origin to service_role;

create or replace function public.nexus_lead_ingest_invariants()
returns table (invariant text, status text, detail text)
language sql
stable
security invoker
set search_path = public
as $$
  select 'A production endpoint never accepts unattestable provenance',
         case when count(*) = 0 then 'PASS' else 'FAIL' end,
         count(*) || ' endpoint(s)'
    from public.lead_ingest_endpoint
   where environment = 'production' and not provenance_counts_as_real
  union all
  select 'A production event never rests on unattestable provenance',
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
  select 'Simulation traffic is never counted as production',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*) || ' event(s)'
    from public.lead_event where environment = 'simulation' and provenance_counts_as_real
     and origin_verified = 'simulated'
  union all
  select 'Every source in the catalogue names a provenance that exists',
         case when count(*) = 0 then 'PASS' else 'FAIL' end, count(*) || ' source(s)'
    from public.lead_source_catalogue c
    left join public.lead_provenance_kind p on p.kind = c.required_provenance
   where p.kind is null
  union all
  select 'Sources with no public integration are marked as such, not as buildable',
         'INFO',
         coalesce(string_agg(display_name, ', ' order by display_name), '(none)')
    from public.lead_source_catalogue where integration_status <> 'AVAILABLE';
$$;

revoke all on function public.nexus_lead_normalized_defect(jsonb) from public, anon, authenticated;
revoke all on function public.nexus_record_lead_event(text, text, text, jsonb, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.nexus_hydrate_lead_event(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.nexus_promote_lead_event(uuid) from public, anon, authenticated;
revoke all on function public.nexus_reject_lead_event(uuid, text, text) from public, anon, authenticated;
revoke all on function public.nexus_lead_ingest_invariants() from public, anon, authenticated;
grant execute on function public.nexus_lead_normalized_defect(jsonb) to service_role;
grant execute on function public.nexus_record_lead_event(text, text, text, jsonb, timestamptz, jsonb) to service_role;
grant execute on function public.nexus_hydrate_lead_event(uuid, jsonb, jsonb) to service_role;
grant execute on function public.nexus_promote_lead_event(uuid) to service_role;
grant execute on function public.nexus_reject_lead_event(uuid, text, text) to service_role;
grant execute on function public.nexus_lead_ingest_invariants() to service_role;