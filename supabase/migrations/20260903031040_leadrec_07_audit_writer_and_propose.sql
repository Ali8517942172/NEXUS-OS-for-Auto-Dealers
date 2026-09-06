-- LEAD RECOVERY ENGINE — 07: raising an action.
--
-- Authority is NOT re-invented. action_approver_context() is this dealership's
-- single statement of who may decide anything, read from inventory_action_policy.
-- A second policy table would let the two desks disagree about who a manager is.
-- Its refusal sentences say "inventory action" because it was written for that
-- desk; the noun is corrected on the way out so a reader on the Leads screen is
-- not told about inventory. The decision itself is unchanged.

alter table public.lead_recovery_settings
  add column reproposal_cooldown_days integer
    check (reproposal_cooldown_days is null or reproposal_cooldown_days >= 0);
comment on column public.lead_recovery_settings.reproposal_cooldown_days is
  'Days before the same recommendation may be raised again on a lead after it was rejected or '
  'cancelled. Default 7 when unset. Nobody has stated this number either.';

create function public.lead_recovery_write_audit(
  p_tenant uuid, p_action_id uuid, p_lead_id integer, p_rec text, p_status text, p_summary text)
returns uuid
language plpgsql security definer
set search_path to 'public'
as $$
declare v_id uuid;
begin
  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('Lead Recovery Action Center', p_status,
          'Lead recovery action ' || coalesce(p_action_id::text, '(none)')
          || ' · lead ' || coalesce(p_lead_id::text, '(none)')
          || ' · ' || coalesce(p_rec, '(none)')
          || ' · ' || coalesce(p_summary, ''),
          p_tenant)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.lead_recovery_write_audit(uuid,uuid,integer,text,text,text) is
  'Writes the audit_log row for a lead recovery decision. SECURITY DEFINER and takes a tenant as an '
  'argument, which is exactly the shape that let any signed-in user forge audit rows through '
  'action_write_audit - so EXECUTE is revoked from authenticated as well as anon. Only the other '
  'lead_recovery_* functions call it. NOTE: audit rows written under the workflow name '
  '"Lead Recovery Action Center" will appear in v_audit_unregistered_writers with the generic '
  '"Unrecognised writer" disposition, because that view names only the Inventory Action Center as '
  'a known non-n8n writer. It is a false alarm on a deliberate writer, and the fix belongs in that view.';

-- Raise an action from the engine.
create function public.lead_recovery_propose(p_lead_id integer)
returns table(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action public.lead_recovery_actions)
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_ctx    record;
  v_eng    record;
  v_row    public.lead_recovery_actions;
  v_prior  public.lead_recovery_actions;
  v_cool   integer;
  v_audit  uuid;
  v_reason text;
begin
  select * into v_ctx from public.action_approver_context();
  v_reason := replace(coalesce(v_ctx.refusal_reason, ''), 'inventory action', 'action');
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code, nullif(v_reason, ''), null::public.lead_recovery_actions;
    return;
  end if;
  if p_lead_id is null then
    return query select false, false, 'NO_LEAD', 'No lead id was supplied.', null::public.lead_recovery_actions;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_ctx.tenant_id::text || '|lead|' || p_lead_id::text, 0));

  -- v_lead_recovery is security_invoker, so inside this SECURITY DEFINER function
  -- it evaluates RLS as the function owner and sees every dealership. The tenant
  -- predicate below is load-bearing security, not tidiness.
  select * into v_eng
    from public.v_lead_recovery v
   where v.tenant_id = v_ctx.tenant_id and v.lead_id = p_lead_id;
  if not found then
    return query select false, false, 'LEAD_NOT_FOUND',
      'No lead with that id at this dealership.', null::public.lead_recovery_actions;
    return;
  end if;
  if v_eng.recommended_action = 'NO_ACTION' then
    return query select false, false, 'NOTHING_RECOMMENDED',
      'The engine recommends no action on this lead: ' || coalesce(v_eng.action_reason, '')
      || ' An action is not raised against a recommendation the engine did not make.',
      null::public.lead_recovery_actions;
    return;
  end if;

  select * into v_row from public.lead_recovery_actions a
   where a.tenant_id = v_ctx.tenant_id and a.lead_id = p_lead_id
     and a.status in ('PROPOSED','APPROVED','DEFERRED')
   limit 1;
  if found then
    return query select true, true, null::text,
      'An action for this lead is already open, so this did not create a second one.', v_row;
    return;
  end if;

  select coalesce(s.reproposal_cooldown_days, 7) into v_cool
    from public.lead_recovery_settings s where s.tenant_id = v_ctx.tenant_id;
  v_cool := coalesce(v_cool, 7);
  if v_cool > 0 then
    select * into v_prior from public.lead_recovery_actions a
     where a.tenant_id = v_ctx.tenant_id and a.lead_id = p_lead_id
       and a.recommendation = v_eng.recommended_action
       and a.status in ('REJECTED','CANCELLED') and a.decided_at is not null
       and a.decided_at > now() - make_interval(days => v_cool)
     order by a.decided_at desc limit 1;
    if found then
      return query select false, false, 'SUPPRESSED_BY_RECENT_DECISION',
        'This recommendation was already decided on '
        || to_char(v_prior.decided_at at time zone 'Asia/Dubai', 'DD Mon YYYY')
        || ' (' || v_prior.status || ', ' || coalesce(v_prior.decision_reason_code, 'no code')
        || ') and the cooldown is ' || v_cool || ' days. Raising it again would ignore that answer.',
        v_prior;
      return;
    end if;
  end if;

  insert into public.lead_recovery_actions (
    tenant_id, lead_id, recommendation, engine_state, engine_reason,
    engine_confidence, engine_confidence_basis, engine_risk_level, engine_risk_basis,
    engine_evidence, engine_owner_role, engine_computed_at,
    opportunity_value_state, opportunity_value_basis,
    proposed_by_staff_id, outcome_state)
  values (
    v_ctx.tenant_id, p_lead_id, v_eng.recommended_action, v_eng.state, v_eng.action_reason,
    v_eng.confidence, v_eng.confidence_basis, v_eng.risk_level, v_eng.risk_basis,
    v_eng.evidence, v_eng.owner_job_title, v_eng.computed_at,
    v_eng.opportunity_value_state, v_eng.opportunity_value_basis,
    v_ctx.staff_id, 'NONE_YET')
  returning * into v_row;

  v_audit := public.lead_recovery_write_audit(
    v_ctx.tenant_id, v_row.id, p_lead_id, v_row.recommendation, 'SUCCESS',
    'Proposed from the engine by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
    || '. State ' || coalesce(v_eng.state, 'unknown') || ', risk ' || coalesce(v_eng.risk_level, 'unknown')
    || '. No monetary exposure is claimed: nothing in this schema measures what a lead is worth. '
    || 'Awaiting a decision.');

  insert into public.lead_recovery_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, 'PROPOSED', v_ctx.staff_id, v_ctx.auth_user_id,
          'Raised from the engine queue. ' || coalesce(v_eng.action_reason, ''), v_audit);

  return query select true, false, null::text, null::text, v_row;
end;
$$;

revoke all on function public.lead_recovery_write_audit(uuid,uuid,integer,text,text,text) from anon, authenticated, public;
grant execute on function public.lead_recovery_write_audit(uuid,uuid,integer,text,text,text) to service_role;
revoke all on function public.lead_recovery_propose(integer) from anon, public;
grant execute on function public.lead_recovery_propose(integer) to authenticated, service_role;