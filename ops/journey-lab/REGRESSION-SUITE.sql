-- NEXUS dealer-plane regression suite — one statement, self-asserting, rolls back
--
-- Paste into the SQL editor of STAGING and run. It ends in RAISE EXCEPTION on
-- purpose: the whole block aborts, so nothing it writes can survive even if a
-- control misbehaves. A prior agent ran a live DELETE outside a transaction and
-- had to disclose it; this shape makes that impossible.
--
-- WHAT IT COVERS, and why each one is here rather than being assumed:
--   1  a rep cannot reassign a lead that is not theirs      (authorisation)
--   2  an owner change writes an audit row naming the actor (T12)
--   3  an owner change that cannot be recorded is REFUSED   (T12, fail closed)
--   4  a direct PATCH can file a lead under another         (measured defect;
--      dealership's staff -- the rpc refuses it              the rpc is the fix)
--   5  manual entry: a rep cannot manufacture attribution
--   6  manual entry: an uncontactable lead is refused
--   7  manual entry: the same request id is idempotent
--   8  manual entry: an account in no dealership is refused
--   9  registered =/= connected: an endpoint with no entry
--      surface reads REGISTERED_NO_ENTRY_PATH, not CONNECTED
--  10  disabled =/= receiving: a disabled endpoint is unresolvable
--  11  a promoted lead always has an event pointing back at it (orphan check)
--
-- NOT covered here, and deliberately not faked:
--   * the 10-way promotion race. It needs ten separate BACKENDS, which a single
--     session cannot produce -- see CONCURRENCY-REGRESSION.sql.
--   * the missing-message-id bypass. It lives in an n8n Set expression, not in
--     the database; see ops/n8n-waha-gate/prefilter.assignments.md.
--   * whether a SCREEN renders the truth. A database cannot answer that.
--
-- Edit the six identifiers below to match the project being tested.

do $$
declare
  -- ── fixtures for this database ───────────────────────────────────────────
  T_ALPHA   uuid := '11111111-1111-4111-8111-111111111111';
  T_BRAVO   uuid := '22222222-2222-4222-8222-222222222222';
  U_MANAGER text := 'aaaaaaaa-0000-4000-8000-00000000a003';   -- may reassign anything
  U_SALES   text := 'aaaaaaaa-0000-4000-8000-00000000a004';   -- owns LEAD_MINE only
  S_OTHER   uuid := 'a0000000-0000-4000-8000-0000000000a5';   -- another Alpha rep
  S_BRAVO   uuid := 'b0000000-0000-4000-8000-0000000000b1';   -- a Bravo staff member
  LEAD_MINE  integer := 8;                                    -- assigned to U_SALES
  LEAD_THEIRS integer := 9;                                   -- assigned to someone else
  -- ─────────────────────────────────────────────────────────────────────────
  res text[] := '{}'; fails int := 0; rid uuid := gen_random_uuid();
  n int; v_owner uuid; v_state text; r record;

  procedure_note text;
begin
  -- helper: record a control
  -- (inline rather than a function, so this file is one paste-and-run block)

  ---------------------------------------------------------------- 1
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U_SALES,'role','authenticated')::text, true);
  with u as (update public.leads set assigned_to_id = S_OTHER where id = LEAD_THEIRS returning 1)
  select count(*) into n from u;
  reset role;
  if n = 0 then res := array_append(res, 'PASS  1 a rep cannot take a lead that is not theirs');
  else fails := fails+1; res := array_append(res, 'FAIL  1 a rep reassigned a lead that is not theirs'); end if;

  ---------------------------------------------------------------- 2
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U_MANAGER,'role','authenticated')::text, true);
  perform set_config('nexus.change_reason', 'regression suite', true);
  update public.leads set assigned_to_id = S_OTHER where id = LEAD_MINE;
  reset role;
  select * into r from public.lead_owner_events where lead_id = LEAD_MINE order by at desc limit 1;
  if found and r.actor_authority = 'tenant_member' and r.actor_staff_id is not null
     and r.audit_log_id is not null and r.reason = 'regression suite' then
    res := array_append(res, 'PASS  2 the owner change is recorded with the actor, the reason and an audit row');
  else
    fails := fails+1;
    res := array_append(res, 'FAIL  2 the owner change was not recorded properly');
  end if;

  ---------------------------------------------------------------- 3
  -- NOT VALID and NOT validated. A NOT VALID check still applies to every NEW
  -- row, which is exactly what this control needs, and skipping the validation
  -- is not laziness: control 2 has already written a row, so VALIDATE would
  -- fail on the existing data and abort the suite before the control ran. That
  -- is how this block failed the first time it was executed.
  alter table public.lead_owner_events add constraint zz_refuse check (false) not valid;
  begin
    update public.leads set assigned_to_id = NULL where id = LEAD_MINE;
    v_state := 'ACCEPTED';
  exception when others then v_state := 'refused ' || sqlstate; end;
  select assigned_to_id into v_owner from public.leads where id = LEAD_MINE;
  alter table public.lead_owner_events drop constraint zz_refuse;
  if v_state <> 'ACCEPTED' and v_owner = S_OTHER then
    res := array_append(res, 'PASS  3 an owner change that cannot be audited is refused, and the owner is unchanged');
  else
    fails := fails+1;
    res := array_append(res, format('FAIL  3 fail-closed did not hold (%s, owner %s)', v_state, v_owner));
  end if;

  ---------------------------------------------------------------- 4
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U_MANAGER,'role','authenticated')::text, true);
  begin
    perform public.nexus_lead_assign_owner(LEAD_MINE, S_BRAVO, 'should refuse');
    v_state := 'rpc ACCEPTED';
  exception when others then v_state := 'rpc refused'; end;
  update public.leads set assigned_to_id = S_BRAVO where id = LEAD_MINE;   -- the direct path
  select assigned_to_id into v_owner from public.leads where id = LEAD_MINE;
  reset role;
  if v_state = 'rpc refused' and v_owner = S_BRAVO then
    res := array_append(res, 'PASS  4 the rpc refuses a cross-dealership owner; the direct PATCH still accepts it (known, and why the screen uses the rpc)');
  else
    fails := fails+1;
    res := array_append(res, format('FAIL  4 cross-dealership owner behaviour changed (%s, owner %s)', v_state, v_owner));
  end if;

  ---------------------------------------------------------------- 5..8
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U_SALES,'role','authenticated')::text, true);

  begin
    perform public.nexus_lead_record_manual('meta_lead_ads_facebook', gen_random_uuid(), 'Forged', '+971500000901');
    fails := fails+1; res := array_append(res, 'FAIL  5 a signed-in user recorded a provider-delivered source by hand');
  exception when others then res := array_append(res, 'PASS  5 a signed-in user cannot manufacture attribution'); end;

  begin
    perform public.nexus_lead_record_manual('walk_in', gen_random_uuid(), 'No Way To Reach Me');
    fails := fails+1; res := array_append(res, 'FAIL  6 a lead with no phone and no email was accepted');
  exception when others then res := array_append(res, 'PASS  6 an uncontactable lead is refused'); end;

  select * into r from public.nexus_lead_record_manual('walk_in', rid, 'Regression Walkin', '+971500000902');
  n := r.lead_id;
  select * into r from public.nexus_lead_record_manual('walk_in', rid, 'Regression Walkin', '+971500000902');
  if r.lead_id = n and r.was_duplicate then
    res := array_append(res, 'PASS  7 the same request id returns the same lead');
  else
    fails := fails+1; res := array_append(res, 'FAIL  7 a repeated request id made a second customer');
  end if;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}', true);
  begin
    perform public.nexus_lead_record_manual('walk_in', gen_random_uuid(), 'Outsider', '+971500000903');
    fails := fails+1; res := array_append(res, 'FAIL  8 an account in no dealership recorded a lead');
  exception when others then res := array_append(res, 'PASS  8 an account in no dealership is refused'); end;
  reset role;

  ---------------------------------------------------------------- 9
  update public.lead_source_catalogue set manual_entry_surface = null where delivery_shape = 'MANUAL_ENTRY';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub',U_MANAGER,'role','authenticated')::text, true);
  select connection_state into v_state from public.nexus_lead_source_readiness() where source_key = 'walk_in';
  reset role;
  if v_state = 'REGISTERED_NO_ENTRY_PATH' then
    res := array_append(res, 'PASS  9 a registered manual source with no entry surface is not CONNECTED');
  else
    fails := fails+1; res := array_append(res, format('FAIL  9 walk_in read %s with no entry surface recorded', v_state));
  end if;

  ---------------------------------------------------------------- 10
  update public.lead_ingest_endpoint set status = 'disabled'
   where tenant_id = T_ALPHA and source_key = 'walk_in';
  begin
    perform public.nexus_record_lead_event(
      (select public_key from public.lead_ingest_endpoint where tenant_id=T_ALPHA and source_key='walk_in'),
      'regression-disabled-' || gen_random_uuid()::text, 'operator_recorded', '{}'::jsonb, now(),
      '{"full_name":"Should Not Land","phone_e164":"+971500000904"}'::jsonb);
    fails := fails+1; res := array_append(res, 'FAIL 10 a disabled endpoint still accepted a lead');
  exception when others then res := array_append(res, 'PASS 10 a disabled endpoint is unresolvable'); end;

  ---------------------------------------------------------------- 11
  select detail into procedure_note from public.nexus_lead_ingest_invariants()
   where invariant like 'Every lead carrying an ingestion source%' and status = 'FAIL';
  if procedure_note is null then
    res := array_append(res, 'PASS 11 no orphan leads');
  else
    fails := fails+1; res := array_append(res, 'FAIL 11 ' || procedure_note);
  end if;

  raise exception E'\n%\n\n%  --  ROLLED BACK BY DESIGN',
    array_to_string(res, E'\n'),
    case when fails = 0 then 'ALL CONTROLS HELD' else fails || ' CONTROL(S) FAILED' end;
end $$;

-- ── RUN, staging, 7 September 2026 ─────────────────────────────────────────
-- PASS  1 a rep cannot take a lead that is not theirs
-- PASS  2 owner change recorded with actor, reason and audit row
-- PASS  3 unauditable owner change refused, owner unchanged
-- PASS  4 rpc refuses a cross-dealership owner; the direct PATCH still accepts it (known)
-- PASS  5 cannot manufacture attribution
-- PASS  6 uncontactable lead refused
-- PASS  7 same request id returns the same lead
-- PASS  8 account in no dealership refused
-- PASS  9 registered manual source with no entry surface is not CONNECTED
-- PASS 10 disabled endpoint is unresolvable
-- PASS 11 no orphan leads
--
-- ALL CONTROLS HELD -- ROLLED BACK BY DESIGN
--
-- Teardown asserted afterwards, not assumed: leads 31, lead_owner_events 0,
-- disabled endpoints 0, lead 8 back with its original owner, no rows left
-- behind. The suite writes a good deal and keeps none of it.
--
-- CONTROL 4 IS THE ONE TO READ TWICE. It passes by asserting that a direct
-- PATCH STILL accepts a cross-dealership owner. That is a known, measured
-- defect in the row policy -- leads_role_update constrains the lead's tenant
-- and says nothing about assigned_to_id -- and it is the reason the screen goes
-- through nexus_lead_assign_owner. The day somebody closes it in the policy,
-- this control goes red and should be rewritten to expect the refusal on both
-- paths. A control that passes on a defect must say so out loud, or the next
-- reader takes the green for a guarantee.
