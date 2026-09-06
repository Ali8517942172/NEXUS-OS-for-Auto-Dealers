-- LEAD RECOVERY ENGINE — 10: the desk and its health.
--
-- The queue carries what the engine said WHEN the action was raised alongside
-- what it says NOW, and engine_still_agrees, because an action approved on
-- Monday against evidence that changed on Tuesday is the failure mode this
-- pattern exists to catch.
create view public.v_lead_recovery_queue with (security_invoker = true) as
select
  a.id, a.tenant_id, a.lead_id,
  l.name  as lead_name,
  l.status as lead_status,
  a.status,
  (a.status in ('PROPOSED','APPROVED','DEFERRED'))                       as is_live,
  (a.status = 'PROPOSED')                                                as awaiting_decision,
  (a.status = 'DEFERRED' and a.defer_until is not null and a.defer_until <= current_date) as deferral_now_due,
  a.recommendation,
  a.engine_state, a.engine_reason, a.engine_confidence, a.engine_confidence_basis,
  a.engine_risk_level, a.engine_risk_basis, a.engine_owner_role, a.engine_evidence, a.engine_computed_at,
  e.state             as engine_now_state,
  e.risk_level        as engine_now_risk_level,
  e.recommended_action as engine_now_recommendation,
  e.action_reason     as engine_now_reason,
  (e.recommended_action = a.recommendation)                              as engine_still_agrees,
  a.opportunity_value_state, a.opportunity_value_basis,
  a.proposed_at, pu.name as proposed_by_name, a.proposed_source,
  a.decided_at, du.name as decided_by_name, du.role as decided_by_job_title, a.decided_by_authority,
  a.decision_reason_code, rc.label as decision_reason_label, rc.meaning as decision_reason_meaning,
  rc.engine_was_wrong as decision_says_engine_was_wrong, a.decision_note, a.defer_until,
  a.assigned_to_staff_id, au.name as assigned_to_name, a.assigned_role, a.assigned_at,
  a.executed_at, xu.name as executed_by_name, a.execution_note, a.execution_failure,
  a.escalated_at, a.escalation_reason,
  a.outcome_state, a.outcome_purchase_id,
  ph.vehicle as outcome_sale_vehicle, ph.amount_aed as outcome_sale_amount_aed, ph.purchase_date as outcome_sale_date,
  a.outcome_recorded_at, ou.name as outcome_recorded_by_name,
  a.attribution_basis, a.attribution_note, a.recovered_value_aed, a.recovered_value_basis,
  case a.outcome_state
    when 'NONE_YET'              then 'Nothing has been done yet, so there is no outcome to report.'
    when 'AWAITING_OUTCOME'      then 'Somebody carried this out. Whether it recovered anything is not yet known - and unknown is not none.'
    when 'ATTRIBUTED'            then 'A person attributed a confirmed sale of AED '
                                      || to_char(coalesce(a.recovered_value_aed,0), 'FM999,999,999')
                                      || ' to this action. Attributed, not proven caused.'
    when 'NOT_ATTRIBUTABLE'      then 'A person looked and could not tie any sale to this action. No revenue is claimed.'
    when 'CLOSED_WITHOUT_ACTION' then 'The action was rejected or cancelled, so nothing was done and nothing is claimed.'
  end as outcome_sentence,
  extract(day from now() - a.proposed_at)::integer as days_open,
  a.created_at, a.updated_at
from public.lead_recovery_actions a
left join public.leads l on l.id = a.lead_id and l.tenant_id = a.tenant_id
left join public.v_lead_recovery e on e.tenant_id = a.tenant_id and e.lead_id = a.lead_id
left join public.users pu on pu.id = a.proposed_by_staff_id
left join public.users du on du.id = a.decided_by_staff_id
left join public.users au on au.id = a.assigned_to_staff_id
left join public.users xu on xu.id = a.executed_by_staff_id
left join public.users ou on ou.id = a.outcome_recorded_by_staff_id
left join public.lead_recovery_reason_codes rc on rc.code = a.decision_reason_code
left join public.purchase_history ph on ph.id = a.outcome_purchase_id and ph.tenant_id = a.tenant_id;

comment on view public.v_lead_recovery_queue is
  'The Lead Recovery desk. Frozen engine output beside live engine output, with engine_still_agrees '
  'so a stale approval is visible. outcome_sentence never says recovered unless a person attributed '
  'a confirmed sale.';

-- Health. Deliberately NOT registered in workflow_registry: these are human
-- decisions, not an n8n run, and registering them would publish a DEGRADED
-- success rate for a desk that is working correctly - the same reason the
-- Inventory Action Center reports through v_action_center_health instead.
create view public.v_lead_recovery_health with (security_invoker = true) as
select
  a.tenant_id,
  count(*)                                                            as actions_total,
  count(*) filter (where a.status = 'PROPOSED')                       as awaiting_decision,
  count(*) filter (where a.status = 'PROPOSED' and a.escalated_at is not null) as escalated_no_approver,
  count(*) filter (where a.status = 'APPROVED' and a.executed_at is null)      as approved_not_executed,
  count(*) filter (where a.status = 'EXECUTED')                       as executed,
  count(*) filter (where a.status = 'EXECUTION_FAILED')               as execution_failed,
  count(*) filter (where a.status = 'REJECTED')                       as rejected,
  count(*) filter (where a.status = 'DEFERRED')                       as deferred,
  count(*) filter (where a.status = 'CANCELLED')                      as cancelled,
  count(*) filter (where a.outcome_state = 'ATTRIBUTED')              as outcomes_attributed,
  count(*) filter (where a.outcome_state = 'NOT_ATTRIBUTABLE')        as outcomes_not_attributable,
  count(*) filter (where a.status = 'EXECUTED' and a.outcome_state = 'AWAITING_OUTCOME') as executed_awaiting_outcome,
  sum(a.recovered_value_aed) filter (where a.outcome_state = 'ATTRIBUTED') as attributed_revenue_aed,
  max(a.proposed_at) as last_proposed_at,
  max(a.decided_at)  as last_decided_at,
  max(a.executed_at) as last_executed_at,
  ev.events_total, ev.events_without_audit,
  aud.audit_rows, aud.audit_rows_30d, aud.last_audit_at,
  case
    when count(*) = 0                                       then 'NO_ACTIONS'
    when coalesce(ev.events_without_audit, 0) > 0           then 'AUDIT_TRAIL_BROKEN'
    when coalesce(aud.audit_rows, 0) = 0                    then 'AUDIT_TRAIL_BROKEN'
    when count(*) filter (where a.status = 'EXECUTION_FAILED') > 0 then 'EXECUTIONS_FAILING'
    when count(*) filter (where a.status = 'PROPOSED' and a.escalated_at is not null) > 0 then 'NOBODY_MAY_APPROVE'
    else 'ACTIVE'
  end as health
from public.lead_recovery_actions a
left join lateral (
  select count(*) as events_total, count(*) filter (where e.audit_log_id is null) as events_without_audit
    from public.lead_recovery_action_events e where e.tenant_id = a.tenant_id) ev on true
left join lateral (
  select count(*) as audit_rows,
         count(*) filter (where l.logged_at > now() - interval '30 days') as audit_rows_30d,
         max(l.logged_at) as last_audit_at
    from public.audit_log l
   where l.tenant_id = a.tenant_id and l.workflow = 'Lead Recovery Action Center') aud on true
group by a.tenant_id, ev.events_total, ev.events_without_audit, aud.audit_rows, aud.audit_rows_30d, aud.last_audit_at;

comment on view public.v_lead_recovery_health is
  'Health of the Lead Recovery desk. attributed_revenue_aed is the only revenue figure this product '
  'may call recovered, and it is null until a person attributes a confirmed sale to an executed action.';

revoke all on public.v_lead_recovery_queue  from anon, public;
revoke all on public.v_lead_recovery_health from anon, public;
grant select on public.v_lead_recovery_queue  to authenticated, service_role;
grant select on public.v_lead_recovery_health to authenticated, service_role;