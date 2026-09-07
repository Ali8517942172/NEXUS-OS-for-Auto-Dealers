-- Lead ingestion, part 10: two things door three got wrong, found by asking a
-- narrow question and following the answer.
--
-- The question was "is it safe to register a SIMULATION Google endpoint so the
-- receiver can be proven end to end?". The answer was no, for a reason that had
-- nothing to do with Google.
--
-- ONE. THE SIMULATION BOUNDARY STOPPED AT THE FIRST DOOR.
--
-- Part 2 says, in its own words, that the simulator cannot reach production
-- numbers "because the row it would need cannot be written" -- and part 3
-- repeats it. That is true of RECORDING: lead_event_production_needs_real_provenance
-- and lead_ingest_endpoint_production_needs_real_provenance both hold.
--
-- It was never true of PROMOTION. nexus_promote_lead_event read the phase, the
-- origin and the normalised object, and never once looked at `environment`.
-- Measured on production, 7 September 2026:
--
--   pg_get_functiondef(nexus_promote_lead_event) like '%environment%'  ->  0 rows
--   columns of public.leads matching (sim|test|demo|fixture|synthetic) ->  0
--
-- So a simulation lead_event, once hydrated, inserted into public.leads exactly
-- like a real customer -- and public.leads has no column that could ever say
-- otherwise. Pipeline value, response-time reporting and every "recovered
-- revenue" number would have counted it. Nothing has happened yet: there are
-- currently zero simulation endpoints and zero simulation events. This is a
-- door that was open, not a mess to clean up.
--
-- The fix here is the conservative one: door three REFUSES a simulation event
-- and says what would have to exist before it could stop refusing. The
-- tempting alternative -- add leads.is_simulation and carry the flag -- is a
-- real answer and is deliberately NOT taken today, because (a) an ALTER TABLE
-- on public.leads fires nexus_guard_born_open_grants() and strips the live
-- dashboard's write grants, and (b) every consumer of public.leads would then
-- have to learn to filter, and a flag that half the readers ignore is worse
-- than no flag. That is a change to make deliberately, with someone watching,
-- not as a side effect of a Google adapter.
--
-- TWO. THE VEHICLE THE CUSTOMER ASKED ABOUT WAS BEING DROPPED.
--
-- The promoter reads normalized->>'vehicle_interest'. Both receivers written
-- this week emit normalized.vehicle_of_interest. nexus_lead_normalized_defect
-- does not mention a vehicle at all, so nothing complained: every Meta and
-- Google lead would have landed with leads.vehicle_interest NULL, which for a
-- car dealership is the most valuable field on the row after the phone number.
--
-- A silent near-miss between two spellings, invisible because the contract was
-- silent about the field. Both spellings are accepted here so that no lead in
-- flight loses the answer, and the receivers are being changed to the canonical
-- one. The contract is left permissive on purpose: refusing the wrong spelling
-- would have turned a dropped field into a dropped customer.

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

  -- The door this migration exists to close. public.leads cannot say that a row
  -- is simulated, so a simulated row put there is a real customer to every
  -- reader of that table, for ever.
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
    -- Both spellings. 'vehicle_interest' is canonical and matches the column;
    -- 'vehicle_of_interest' is what the Meta and Google receivers emitted, and
    -- accepting it here means no lead already in flight loses the one answer a
    -- salesperson most wants to see.
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
  'leads.source to the source_key -- which is the fix for the defect that '
  'started this work: every lead in production carried source = '
  '''nexus-master-router'', the name of the workflow that wrote it, so the '
  'column recorded the writer and no question about origin could be answered. '
  'Refuses a non-production event: the simulation boundary was enforced at the '
  'recording door only, and public.leads has no column that can say a row is '
  'simulated.';

-- CREATE OR REPLACE keeps an existing ACL, but this database has been surprised
-- three times by what a function is granted after it is written, so the grants
-- are re-stated rather than assumed. Checked with has_function_privilege below,
-- not by reading proacl -- anon reaches a function through the bare PUBLIC entry
-- and never appears in proacl at all, which made an earlier sweep blind.
revoke all on function public.nexus_promote_lead_event(uuid) from public, anon, authenticated;
grant execute on function public.nexus_promote_lead_event(uuid) to service_role;

do $$
declare
  bad text[] := '{}';
begin
  if has_function_privilege('anon', 'public.nexus_promote_lead_event(uuid)', 'execute') then
    bad := array_append(bad, 'anon can execute it');
  end if;
  if has_function_privilege('authenticated', 'public.nexus_promote_lead_event(uuid)', 'execute') then
    bad := array_append(bad, 'authenticated can execute it');
  end if;
  if not has_function_privilege('service_role', 'public.nexus_promote_lead_event(uuid)', 'execute') then
    bad := array_append(bad, 'service_role CANNOT execute it, so ingestion is broken');
  end if;
  if cardinality(bad) > 0 then
    raise exception 'nexus_promote_lead_event ACL is wrong: %', array_to_string(bad, '; ');
  end if;
end $$;
