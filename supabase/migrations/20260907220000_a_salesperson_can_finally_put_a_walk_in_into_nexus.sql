-- The entry path that made CONNECTED true.
--
-- Until today nexus_lead_source_readiness() reported walk_in and phone_call as
-- CONNECTED to this dealership -- the only two sources that read connected at
-- all -- and there was nowhere to enter one. Migration 20260907200000 made the
-- screen tell the truth (REGISTERED_NO_ENTRY_PATH, and production dropped to
-- ZERO CONNECTED). This migration is the other half: the path itself.
--
-- IT IS A NEW WRITE SURFACE ON THE DEALER PLANE, AND THAT IS NOT SOMETHING TO
-- WAVE THROUGH. Two hours ago the owner-assignment fix deliberately refused to
-- add one, because a narrow column grant already existed and a definer RPC
-- would have been strictly more surface. Here there is no existing grant to
-- reuse: doors one and three are service_role-only, so a browser cannot reach
-- them at all, and "a salesperson types in a walk-in" is exactly the capability
-- that has to cross that line. So it crosses once, through one function, with
-- every decision taken from the session rather than from an argument.
--
-- WHAT THE CALLER MAY NOT DECIDE, and each of these is a defect this codebase
-- has already paid for once:
--
--   * THE DEALERSHIP. Taken from nexus_current_tenant_ids(). It is not an
--     argument and there is no fallback. /webhook/whatsapp-inbound takes its
--     tenant from a caller-supplied field and that is the open door this
--     project is still living with.
--   * THE ENDPOINT. Resolved by (tenant, source_key). The caller never sends a
--     public_key -- if they did, a salesperson at one dealership could post a
--     lead onto another dealership's endpoint, which is the exact tenancy
--     defect the endpoint layer exists to remove.
--   * THE SOURCE. Only a MANUAL_ENTRY source. A salesperson cannot record a
--     lead as having come from Facebook, because that would let anybody with a
--     login manufacture attribution -- and attribution is what a dealership
--     will eventually spend money on the strength of.
--   * THE PROVENANCE. Forced to 'operator_recorded'. It is a person's word,
--     it is recorded as a person's word, and the provenance ladder already
--     knows that is not cryptographic attestation.
--
-- AMBIGUITY IS REFUSED, NOT RESOLVED. A user who belongs to two dealerships
-- gets a refusal naming both rather than having one picked for them. Picking
-- would be the same class of mistake as a resolver that guesses.
--
-- IDEMPOTENCY IS THE CALLER'S REQUEST ID, and it has to be, because the failure
-- it prevents is a double-click. Two DIFFERENT reps recording the same walk-in
-- produce two leads: that is correct. They are two separate acts of recording,
-- and collapsing two people into one row is a different problem (identity
-- resolution) that must not be solved accidentally here.

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
-- NOT `returns null on null input`. It was written that way first and it would
-- have been a silent disaster: STRICT makes the whole function return NULL the
-- moment ANY argument is null, and p_email, p_vehicle_interest and p_budget_aed
-- are all optional by design. Every refusal below would have been replaced by a
-- quiet empty answer, which the form would have rendered as "nothing happened".
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenants uuid[];
  v_tenant  uuid;
  v_shape   text;
  v_ep      record;
  v_norm    jsonb;
  v_rec     record;
  v_prom    record;
  v_actor   uuid := auth.uid();
begin
  if p_client_request_id is null then
    raise exception using errcode = 'NX001',
      message = 'This entry carries no request id, so a double submission could not be told from a second customer.',
      detail  = 'NO_CLIENT_REQUEST_ID',
      hint    = 'The form generates one uuid when it opens and sends the same one on every attempt.';
  end if;

  -- THE DEALERSHIP, from the session. Never an argument.
  select array_agg(t) into v_tenants from public.nexus_current_tenant_ids() t;
  if v_tenants is null or cardinality(v_tenants) = 0 then
    raise exception using errcode = 'NX001',
      message = 'Your account does not belong to an active dealership, so there is nowhere to file this lead.',
      detail  = 'NO_ACTIVE_DEALERSHIP',
      hint    = 'This is the same refusal an unaffiliated account gets everywhere else. There is no default dealership on purpose.';
  end if;
  if cardinality(v_tenants) > 1 then
    raise exception using errcode = 'NX001',
      message = 'Your account belongs to more than one dealership, so this lead could be filed in either.',
      detail  = 'DEALERSHIP_AMBIGUOUS',
      hint    = 'Refused rather than resolved. A resolver that picks one is how one dealership''s traffic ends up written into another''s data.';
  end if;
  v_tenant := v_tenants[1];

  -- THE SOURCE. Manual entry only.
  select delivery_shape into v_shape from public.lead_source_catalogue where lead_source_catalogue.source_key = p_source_key;
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
      hint    = 'That source is delivered by a provider, and its leads are attested by that delivery. Letting a signed-in user type one in would let anybody with a login manufacture attribution, which is what ad spend gets judged against.';
  end if;

  -- THE ENDPOINT, resolved from the dealership we derived. The caller sends no key.
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

  -- Door one, with the provenance forced. A defective normalised object is
  -- refused here by the contract itself, with the contract's own words -- there
  -- is deliberately no second copy of "what makes a lead contactable" in this
  -- function.
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
    -- The double-click. Return what already exists rather than making a second
    -- customer out of one impatient click.
    return query
      select e.lead_id, e.event_id, true, e.source_key
        from public.lead_event e where e.event_id = v_rec.event_id;
    return;
  end if;

  select * into v_prom from public.nexus_promote_lead_event(v_rec.event_id);

  insert into public.audit_log (workflow, status, lead_name, lead_email, summary, tenant_id)
  values ('dashboard:manual-lead-entry', 'SUCCESS',
          v_norm->>'full_name', v_norm->>'email',
          'Recorded a ' || p_source_key || ' lead by hand: lead ' || v_prom.lead_id::text
            || ', event ' || v_rec.event_id::text
            || coalesce(', reference ' || nullif(btrim(coalesce(p_operator_reference,'')),''), ''),
          v_tenant);

  return query select v_prom.lead_id, v_rec.event_id, false, v_rec.source_key;
end $$;

comment on function public.nexus_lead_record_manual(text,uuid,text,text,text,text,integer,text,text) is
  'The walk-in and phone-call entry path. SECURITY DEFINER because doors one and '
  'three are service_role-only, so this is the one place a browser crosses into '
  'the ingestion layer -- and every decision that matters is taken from the '
  'session rather than from an argument: the dealership from '
  'nexus_current_tenant_ids(), the endpoint from (tenant, source), the '
  'provenance forced to operator_recorded, and only MANUAL_ENTRY sources '
  'allowed so nobody with a login can manufacture attribution.';

revoke all on function public.nexus_lead_record_manual(text,uuid,text,text,text,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.nexus_lead_record_manual(text,uuid,text,text,text,text,integer,text,text) to authenticated, service_role;
