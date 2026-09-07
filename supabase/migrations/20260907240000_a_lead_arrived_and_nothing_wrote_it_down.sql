-- T12's shape, one layer over: a lead ARRIVES and nothing writes it down.
--
-- WHAT WAS MEASURED, 7 September 2026
-- -----------------------------------
--   grep -c audit_log  ops/n8n-google-lead-form/receiver.sdk.js        -> 0
--   grep -c audit_log  ops/n8n-meta-lead-ads/*.js                      -> 0
--   the Meta workflow's own graph: Promote To Lead -> Respond 200 Promoted,
--   and nothing else.
--
-- So every receiver built this week would have created a real customer with no
-- entry in the one table a dealership reads to answer "what happened". The
-- dashboard's own owner-assignment path had exactly this defect this morning
-- (Journey Lab T12); this is the same omission at the other end of the funnel,
-- and it was found by checking rather than by it biting, because no receiver has
-- carried a lead yet.
--
-- WHY THE AUDIT GOES IN DOOR THREE AND NOT IN EACH RECEIVER
-- --------------------------------------------------------
-- The T12 lesson, applied: a writer that audits itself audits ONE writer. There
-- are four receivers now (Meta Facebook, Meta Instagram, Google, website) plus
-- manual entry, plus whatever is built next, and each one is a separate chance
-- to forget. Every lead that becomes a customer passes through
-- nexus_promote_lead_event. Putting the row there means no receiver CAN forget,
-- and there is one derivation of the sentence instead of five that drift.
--
-- It also removes one that already existed: nexus_lead_record_manual wrote its
-- own audit row an hour ago. That is now deleted from it -- two writers, one
-- fact, is how a count ends up double.
--
-- AND IT FAILS CLOSED, for the same reason T12's trigger does. If the audit
-- insert raises, the promotion goes with it. A customer that appears in the
-- funnel with no record of arriving is worse than a delivery the provider
-- retries: Meta and Google both redeliver, and both receivers answer 5XX on an
-- unexpected database error, so a failed audit costs a retry rather than a lead.

create or replace function public.nexus_promote_lead_event(p_event_id uuid)
returns table (event_id uuid, lead_id integer, was_already_promoted boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare r record; v_lead integer; v_prov record;
begin
  -- FOR UPDATE. Without it, five concurrent promotions of one phone-only event
  -- produced THREE leads (staging, 7 Sep 2026), two of them orphans that no
  -- lead_event points at. The email case looked safe only because
  -- leads_tenant_email_key refused the second insert, and a unique index does
  -- not constrain NULLs -- which is the walk-in, the phone call and the
  -- WhatsApp enquiry.
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

  -- The audit row. Here rather than in each receiver, so no receiver can forget
  -- it, and so the sentence has one derivation instead of five.
  --
  -- The provenance is spelled out in words rather than left as a code, because
  -- this is the row somebody reads when they are asking whether a lead is real.
  -- 'operator_recorded' and 'hmac_sha256_x_hub' are not the same claim and a
  -- reader should not have to look up which is which.
  select kind, is_externally_attested into v_prov
    from public.lead_provenance_kind where kind = r.origin_verified;

  insert into public.audit_log (workflow, status, lead_name, lead_email, summary, tenant_id)
  values (
    'ingest:' || r.source_key,
    'SUCCESS',
    r.normalized->>'full_name',
    nullif(btrim(coalesce(r.normalized->>'email','')), ''),
    'Lead ' || v_lead::text || ' arrived through ' || r.source_key
      || ' and was promoted. Event ' || p_event_id::text
      || ', external id ' || coalesce(r.external_event_id, '(none)')
      || ', origin ' || r.origin_verified
      || case when coalesce(v_prov.is_externally_attested, false)
              then ' (attested by the provider)'
              else ' (a person''s word, not a signature)' end,
    r.tenant_id
  );

  return query select p_event_id, v_lead, false;
end $$;

comment on function public.nexus_promote_lead_event(uuid) is
  'Door three. Creates the leads row, links it, and writes the audit row -- all '
  'in one transaction. The audit lives here rather than in each receiver so that '
  'no receiver can forget it: measured 7 Sep 2026, NONE of them wrote one. Takes '
  'a row lock on the event: without it, five concurrent promotions of a '
  'phone-only lead made three customers, two of them orphans.';

-- And removed from the manual-entry path, which wrote its own an hour ago. Two
-- writers for one fact is how a count ends up double.
create or replace function public.nexus_lead_record_manual(
  p_source_key         text,
  p_client_request_id  uuid,
  p_full_name          text,
  p_phone_e164         text default null,
  p_email              text default null,
  p_vehicle_interest   text default null,
  p_budget_aed         integer default null,
  p_operator_reference text default null,
  p_notes              text default null)
returns table (lead_id integer, event_id uuid, was_duplicate boolean, source_key text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenants uuid[]; v_tenant uuid; v_shape text; v_ep record;
  v_norm jsonb; v_rec record; v_prom record; v_actor uuid := auth.uid();
begin
  if p_client_request_id is null then
    raise exception using errcode = 'NX001',
      message = 'This entry carries no request id, so a double submission could not be told from a second customer.',
      detail  = 'NO_CLIENT_REQUEST_ID',
      hint    = 'The form generates one uuid when it opens and sends the same one on every attempt.';
  end if;

  select array_agg(t) into v_tenants from public.nexus_current_tenant_ids() t;
  if v_tenants is null or cardinality(v_tenants) = 0 then
    raise exception using errcode = 'NX001',
      message = 'Your account does not belong to an active dealership, so there is nowhere to file this lead.',
      detail  = 'NO_ACTIVE_DEALERSHIP',
      hint    = 'The same refusal an unaffiliated account gets everywhere else. There is no default dealership on purpose.';
  end if;
  if cardinality(v_tenants) > 1 then
    raise exception using errcode = 'NX001',
      message = 'Your account belongs to more than one dealership, so this lead could be filed in either.',
      detail  = 'DEALERSHIP_AMBIGUOUS',
      hint    = 'Refused rather than resolved. A resolver that picks one is how one dealership''s traffic ends up written into another''s data.';
  end if;
  v_tenant := v_tenants[1];

  select delivery_shape into v_shape from public.lead_source_catalogue c
   where c.source_key = p_source_key;
  if v_shape is null then
    raise exception using errcode = 'NX001',
      message = 'There is no lead source called ' || coalesce(p_source_key, '(null)') || '.',
      detail  = 'SOURCE_NOT_IN_CATALOGUE',
      hint    = 'The source vocabulary is a table, not free text.';
  end if;
  if v_shape <> 'MANUAL_ENTRY' then
    raise exception using errcode = 'NX001',
      message = 'A person cannot record a lead as having arrived from ' || p_source_key || '.',
      detail  = 'SOURCE_IS_NOT_MANUAL_ENTRY',
      hint    = 'That source is delivered by a provider and its leads are attested by that delivery. Letting a signed-in user type one in would let anybody with a login manufacture attribution.';
  end if;

  select * into v_ep from public.lead_ingest_endpoint e
   where e.tenant_id = v_tenant and e.source_key = p_source_key
     and e.status = 'active' and e.environment = 'production'
   limit 1;
  if not found then
    raise exception using errcode = 'NX001',
      message = 'This dealership has no active connection registered for ' || p_source_key || '.',
      detail  = 'NO_ENDPOINT_FOR_THIS_SOURCE',
      hint    = 'Register one in lead_ingest_endpoint. Recording a lead against a source with no endpoint would put it in the funnel with nothing behind it saying where it came from.';
  end if;

  v_norm := jsonb_strip_nulls(jsonb_build_object(
    'full_name',        nullif(btrim(coalesce(p_full_name, '')), ''),
    'phone_e164',       nullif(btrim(coalesce(p_phone_e164, '')), ''),
    'email',            nullif(btrim(coalesce(p_email, '')), ''),
    'vehicle_interest', nullif(btrim(coalesce(p_vehicle_interest, '')), ''),
    'budget_aed',       p_budget_aed));

  select * into v_rec from public.nexus_record_lead_event(
    v_ep.public_key,
    p_source_key || ':' || p_client_request_id::text,
    'operator_recorded',
    jsonb_strip_nulls(jsonb_build_object(
      'entered_by_auth_id', v_actor,
      'operator_reference', nullif(btrim(coalesce(p_operator_reference, '')), ''),
      'notes',              nullif(btrim(coalesce(p_notes, '')), ''),
      'entered_at',         now())),
    now(),
    v_norm);

  if v_rec.was_duplicate then
    return query
      select e.lead_id, e.event_id, true, e.source_key
        from public.lead_event e where e.event_id = v_rec.event_id;
    return;
  end if;

  -- Door three writes the audit row now. This function used to write its own,
  -- and keeping both would have filed every hand-entered lead twice.
  select * into v_prom from public.nexus_promote_lead_event(v_rec.event_id);

  return query select v_prom.lead_id, v_rec.event_id, false, v_rec.source_key;
end $$;

revoke all on function public.nexus_promote_lead_event(uuid) from public, anon, authenticated;
grant execute on function public.nexus_promote_lead_event(uuid) to service_role;
revoke all on function public.nexus_lead_record_manual(text,uuid,text,text,text,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.nexus_lead_record_manual(text,uuid,text,text,text,text,integer,text,text) to authenticated, service_role;

do $$
declare bad text[] := '{}';
begin
  if has_function_privilege('anon', 'public.nexus_promote_lead_event(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_promote_lead_event(uuid)', 'execute') then
    bad := array_append(bad, 'door three is reachable by an end-user role');
  end if;
  if not has_function_privilege('service_role', 'public.nexus_promote_lead_event(uuid)', 'execute') then
    bad := array_append(bad, 'service_role cannot execute door three, so ingestion is broken');
  end if;
  if has_function_privilege('anon', 'public.nexus_lead_record_manual(text,uuid,text,text,text,text,integer,text,text)', 'execute') then
    bad := array_append(bad, 'anon can execute the manual entry rpc');
  end if;
  if not has_function_privilege('authenticated', 'public.nexus_lead_record_manual(text,uuid,text,text,text,text,integer,text,text)', 'execute') then
    bad := array_append(bad, 'authenticated cannot execute the manual entry rpc');
  end if;
  if (select p.proisstrict from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='nexus_lead_record_manual') then
    bad := array_append(bad, 'nexus_lead_record_manual is STRICT -- every refusal becomes a silent NULL');
  end if;
  if cardinality(bad) > 0 then
    raise exception 'ingest audit migration is wrong: %', array_to_string(bad, '; ');
  end if;
end $$;
