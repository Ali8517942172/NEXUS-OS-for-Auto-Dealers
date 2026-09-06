-- LEAD RECOVERY ENGINE — 09: execution and the only path to the word "recovered".
--
-- Executing a lead recovery action means a PERSON did something - sent the
-- follow-up, made the call, escalated to a manager. NEXUS has no executor for
-- this and does not pretend to: mark_executed records that a human acted.
--
-- record_outcome is the only way recovered_value_aed is ever written, and it
-- refuses unless a real purchase_history row for THIS lead was recorded AFTER
-- the action was executed. Approval is not recovery; execution is not recovery;
-- a sale that predates the action is not recovery either.

create function public.lead_recovery_mark_executed(
  p_action_id uuid, p_note text default null, p_failed boolean default false, p_failure text default null)
returns table(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action public.lead_recovery_actions)
language plpgsql security definer set search_path to 'public'
as $$
declare v_ctx record; v_row public.lead_recovery_actions; v_audit uuid; v_sent text;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code,
      replace(coalesce(v_ctx.refusal_reason,''),'inventory action','action'), null::public.lead_recovery_actions;
    return;
  end if;
  select * into v_row from public.lead_recovery_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id for update;
  if not found then
    return query select false, false, 'NOT_FOUND', 'No such action on this dealership.', null::public.lead_recovery_actions;
    return;
  end if;
  if v_row.status in ('EXECUTED','EXECUTION_FAILED') then
    return query select true, true, null::text,
      'Already recorded as ' || lower(v_row.status) || '. No second record was created.', v_row;
    return;
  end if;
  if v_row.status <> 'APPROVED' then
    return query select false, false, 'NOT_APPROVED',
      'Only an approved action can be executed. This one is ' || lower(v_row.status)
      || '. Recording execution against an undecided action would erase the decision step.', v_row;
    return;
  end if;
  if p_failed and nullif(btrim(coalesce(p_failure,'')),'') is null then
    return query select false, false, 'FAILURE_REQUIRED',
      'A failed execution needs to say what failed, otherwise the record teaches nobody anything.', v_row;
    return;
  end if;

  update public.lead_recovery_actions a set
    status = case when p_failed then 'EXECUTION_FAILED' else 'EXECUTED' end,
    executed_at = now(), executed_by_staff_id = v_ctx.staff_id,
    execution_note = nullif(btrim(coalesce(p_note,'')),''),
    execution_failure = case when p_failed then btrim(p_failure) end,
    outcome_state = case when p_failed then a.outcome_state else 'AWAITING_OUTCOME' end,
    updated_at = now()
  where a.id = v_row.id and a.tenant_id = v_ctx.tenant_id
  returning * into v_row;

  v_sent := case when p_failed
    then 'Execution failed: ' || v_row.execution_failure
    else 'A person carried this out: ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
         || '. Nothing has been recovered yet - the outcome is unknown until a sale is recorded and attributed.' end;
  v_audit := public.lead_recovery_write_audit(
    v_ctx.tenant_id, v_row.id, v_row.lead_id, v_row.recommendation,
    case when p_failed then 'FAILED' else 'SUCCESS' end, v_sent);
  insert into public.lead_recovery_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, case when p_failed then 'EXECUTION_FAILED' else 'EXECUTED' end,
          v_ctx.staff_id, v_ctx.auth_user_id, v_ctx.authority, v_sent, v_audit);
  return query select true, false, null::text, null::text, v_row;
end;
$$;

-- Which sales could this action plausibly have produced? Read-only, and it never
-- picks one - a person does.
create function public.lead_recovery_outcome_candidates(p_action_id uuid)
returns table(purchase_id uuid, vehicle text, amount_aed integer, purchase_date date,
              recorded_at timestamptz, recorded_after_execution boolean)
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_tenant uuid; v_row public.lead_recovery_actions;
begin
  v_tenant := public.nexus_current_tenant_id();
  if v_tenant is null then return; end if;
  select * into v_row from public.lead_recovery_actions a
   where a.id = p_action_id and a.tenant_id = v_tenant;
  if not found then return; end if;
  return query
    select p.id, p.vehicle, p.amount_aed, p.purchase_date, p.created_at,
           (v_row.executed_at is not null and p.created_at >= v_row.executed_at)
      from public.purchase_history p
     where p.tenant_id = v_tenant and p.lead_id = v_row.lead_id
     order by p.created_at desc;
end;
$$;

create function public.lead_recovery_record_outcome(
  p_action_id uuid, p_purchase_id uuid, p_note text default null)
returns table(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action public.lead_recovery_actions)
language plpgsql security definer set search_path to 'public'
as $$
declare v_ctx record; v_row public.lead_recovery_actions; v_p public.purchase_history;
        v_audit uuid; v_sent text;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code,
      replace(coalesce(v_ctx.refusal_reason,''),'inventory action','action'), null::public.lead_recovery_actions;
    return;
  end if;
  if not v_ctx.may_decide then
    return query select false, false, coalesce(v_ctx.refusal_code,'NOT_AN_APPROVER'),
      'Attributing revenue to an action is an approver''s call. '
      || replace(coalesce(v_ctx.refusal_reason,''),'inventory action','action'), null::public.lead_recovery_actions;
    return;
  end if;
  select * into v_row from public.lead_recovery_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id for update;
  if not found then
    return query select false, false, 'NOT_FOUND', 'No such action on this dealership.', null::public.lead_recovery_actions;
    return;
  end if;
  if v_row.outcome_state = 'ATTRIBUTED' and v_row.outcome_purchase_id = p_purchase_id then
    return query select true, true, null::text, 'This outcome was already recorded. No second record was created.', v_row;
    return;
  end if;
  if v_row.status <> 'EXECUTED' then
    return query select false, false, 'NOT_EXECUTED',
      'Revenue cannot be attributed to an action nobody carried out. This action is '
      || lower(v_row.status) || '. A recommendation is not a recovery.', v_row;
    return;
  end if;

  select * into v_p from public.purchase_history p
   where p.id = p_purchase_id and p.tenant_id = v_ctx.tenant_id;
  if not found then
    return query select false, false, 'SALE_NOT_FOUND',
      'No sale with that id at this dealership.', v_row;
    return;
  end if;
  if v_p.lead_id is distinct from v_row.lead_id then
    return query select false, false, 'SALE_IS_ANOTHER_LEADS',
      'That sale is not recorded against this lead, so attributing it here would invent a link '
      || 'between a recovery action and someone else''s purchase.', v_row;
    return;
  end if;
  if v_p.created_at < v_row.executed_at then
    return query select false, false, 'SALE_PREDATES_THE_ACTION',
      'That sale was recorded on '
      || to_char(v_p.created_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI')
      || ' GST, before this action was carried out. An action cannot have recovered a sale that '
      || 'already existed.', v_row;
    return;
  end if;
  if v_p.amount_aed is null then
    return query select false, false, 'SALE_HAS_NO_AMOUNT',
      'That sale carries no amount, so there is no confirmed figure to attribute. '
      || 'Record the amount on the sale first; do not estimate it here.', v_row;
    return;
  end if;

  update public.lead_recovery_actions a set
    outcome_state = 'ATTRIBUTED',
    outcome_purchase_id = v_p.id,
    outcome_recorded_at = now(),
    outcome_recorded_by_staff_id = v_ctx.staff_id,
    attribution_basis = 'EXECUTED_ACTION_PRECEDED_A_RECORDED_SALE_ON_THE_SAME_LEAD',
    attribution_note = nullif(btrim(coalesce(p_note,'')),''),
    recovered_value_aed = v_p.amount_aed,
    recovered_value_basis = 'CONFIRMED_SALE_AMOUNT_FROM_PURCHASE_HISTORY',
    updated_at = now()
  where a.id = v_row.id and a.tenant_id = v_ctx.tenant_id
  returning * into v_row;

  v_sent := 'Outcome attributed by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
    || '. Sale ' || v_p.id || ' (' || coalesce(v_p.vehicle,'vehicle not named') || ', AED '
    || to_char(v_p.amount_aed, 'FM999,999,999') || ') was recorded after this action was carried out on '
    || 'the same lead. CONFIRMED revenue, attributed by a person - not an estimate and not proof of cause.';
  v_audit := public.lead_recovery_write_audit(
    v_ctx.tenant_id, v_row.id, v_row.lead_id, v_row.recommendation, 'SUCCESS', v_sent);
  insert into public.lead_recovery_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, 'OUTCOME_ATTRIBUTED', v_ctx.staff_id, v_ctx.auth_user_id,
          v_ctx.authority, v_sent, v_audit);
  return query select true, false, null::text, null::text, v_row;
end;
$$;

create function public.lead_recovery_mark_not_attributable(p_action_id uuid, p_note text)
returns table(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action public.lead_recovery_actions)
language plpgsql security definer set search_path to 'public'
as $$
declare v_ctx record; v_row public.lead_recovery_actions; v_audit uuid; v_sent text;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code,
      replace(coalesce(v_ctx.refusal_reason,''),'inventory action','action'), null::public.lead_recovery_actions;
    return;
  end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null then
    return query select false, false, 'NOTE_REQUIRED',
      'Closing an outcome as not attributable needs a note. "We do not know" is a finding and has to '
      || 'be written down as one.', null::public.lead_recovery_actions;
    return;
  end if;
  select * into v_row from public.lead_recovery_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id for update;
  if not found then
    return query select false, false, 'NOT_FOUND', 'No such action on this dealership.', null::public.lead_recovery_actions;
    return;
  end if;
  update public.lead_recovery_actions a set
    outcome_state = 'NOT_ATTRIBUTABLE', outcome_recorded_at = now(),
    outcome_recorded_by_staff_id = v_ctx.staff_id,
    attribution_basis = 'DECLARED_NOT_ATTRIBUTABLE_BY_A_PERSON',
    attribution_note = btrim(p_note), updated_at = now()
  where a.id = v_row.id and a.tenant_id = v_ctx.tenant_id returning * into v_row;
  v_sent := 'Outcome closed as NOT ATTRIBUTABLE by ' || coalesce(v_ctx.staff_name,'an account with no staff record')
            || ': ' || btrim(p_note) || ' No revenue is claimed.';
  v_audit := public.lead_recovery_write_audit(
    v_ctx.tenant_id, v_row.id, v_row.lead_id, v_row.recommendation, 'SUCCESS', v_sent);
  insert into public.lead_recovery_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, 'OUTCOME_NOT_ATTRIBUTABLE', v_ctx.staff_id, v_ctx.auth_user_id,
          v_ctx.authority, v_sent, v_audit);
  return query select true, false, null::text, null::text, v_row;
end;
$$;

create function public.lead_recovery_cancel(p_action_id uuid, p_note text)
returns table(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action public.lead_recovery_actions)
language plpgsql security definer set search_path to 'public'
as $$
declare v_ctx record; v_row public.lead_recovery_actions; v_audit uuid; v_sent text;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code,
      replace(coalesce(v_ctx.refusal_reason,''),'inventory action','action'), null::public.lead_recovery_actions;
    return;
  end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null then
    return query select false, false, 'NOTE_REQUIRED',
      'A cancellation needs a note saying why the action stopped being the right one.', null::public.lead_recovery_actions;
    return;
  end if;
  select * into v_row from public.lead_recovery_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id for update;
  if not found then
    return query select false, false, 'NOT_FOUND', 'No such action on this dealership.', null::public.lead_recovery_actions;
    return;
  end if;
  if v_row.status = 'CANCELLED' then
    return query select true, true, null::text, 'Already cancelled.', v_row;
    return;
  end if;
  if v_row.status in ('EXECUTED','EXECUTION_FAILED') then
    return query select false, false, 'ALREADY_EXECUTED',
      'This action was carried out. Cancelling it would delete the record that somebody did the work.', v_row;
    return;
  end if;
  update public.lead_recovery_actions a set
    status = 'CANCELLED', decided_at = coalesce(a.decided_at, now()),
    decided_by_staff_id = coalesce(a.decided_by_staff_id, v_ctx.staff_id),
    decided_by_auth_id = coalesce(a.decided_by_auth_id, v_ctx.auth_user_id),
    decided_by_authority = coalesce(a.decided_by_authority, coalesce(v_ctx.authority, 'CANCELLED_WITHOUT_APPROVAL_AUTHORITY')),
    decision_note = btrim(p_note),
    outcome_state = 'CLOSED_WITHOUT_ACTION', updated_at = now()
  where a.id = v_row.id and a.tenant_id = v_ctx.tenant_id returning * into v_row;
  v_sent := 'Cancelled by ' || coalesce(v_ctx.staff_name,'an account with no staff record') || ': ' || btrim(p_note);
  v_audit := public.lead_recovery_write_audit(
    v_ctx.tenant_id, v_row.id, v_row.lead_id, v_row.recommendation, 'SUCCESS', v_sent);
  insert into public.lead_recovery_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, 'CANCELLED', v_ctx.staff_id, v_ctx.auth_user_id,
          v_ctx.authority, v_sent, v_audit);
  return query select true, false, null::text, null::text, v_row;
end;
$$;

revoke all on function public.lead_recovery_mark_executed(uuid,text,boolean,text) from anon, public;
revoke all on function public.lead_recovery_outcome_candidates(uuid) from anon, public;
revoke all on function public.lead_recovery_record_outcome(uuid,uuid,text) from anon, public;
revoke all on function public.lead_recovery_mark_not_attributable(uuid,text) from anon, public;
revoke all on function public.lead_recovery_cancel(uuid,text) from anon, public;
grant execute on function public.lead_recovery_mark_executed(uuid,text,boolean,text) to authenticated, service_role;
grant execute on function public.lead_recovery_outcome_candidates(uuid) to authenticated, service_role;
grant execute on function public.lead_recovery_record_outcome(uuid,uuid,text) to authenticated, service_role;
grant execute on function public.lead_recovery_mark_not_attributable(uuid,text) to authenticated, service_role;
grant execute on function public.lead_recovery_cancel(uuid,text) to authenticated, service_role;