-- ===========================================================================
-- action_06_queue_and_timeline_views
--
-- BUSINESS RULE: one figure, one derivation (NEXUS_INVARIANTS INV-008). The
-- sentences a person reads about an action - what it is, why it exists, what
-- happens if nobody acts, and what is known about its outcome - are computed
-- HERE and not in the browser, so that a second screen cannot say something
-- different about the same row.
--
-- Both views are security_invoker = true. A view without it evaluates RLS as
-- its owner and hands one dealership's rows to another; that regression has
-- happened three times in this database and an event trigger now refuses the
-- deploy without it.
--
-- engine_still_agrees is the column worth explaining. inventory_actions freezes
-- the engine's words at proposal; v_inventory_profit_sentinel recomputes on
-- every read. When they disagree - the unit sold, the price moved, the ageing
-- band changed - the person deciding needs to know that before they act on a
-- recommendation the engine has since withdrawn. NULL means the engine has no
-- current row for the unit at all, which is not the same as disagreeing.
-- ===========================================================================

drop view if exists public.v_inventory_action_queue;
create view public.v_inventory_action_queue
with (security_invoker = true) as
select
  a.id,
  a.tenant_id,
  a.unit_id,
  i.model                      as unit_model,
  i.vin                        as unit_vin,
  i.status                     as unit_status,
  i.price_aed                  as unit_price_aed,
  i.cost_aed                   as unit_cost_aed,

  a.status,
  (a.status in ('PROPOSED', 'APPROVED', 'DEFERRED'))          as is_live,
  (a.status = 'PROPOSED')                                     as awaiting_decision,
  (a.status = 'DEFERRED' and a.defer_until is not null
     and a.defer_until <= current_date)                       as deferral_now_due,

  a.recommendation,
  a.engine_reason,
  a.engine_confidence,
  a.engine_confidence_basis,
  a.engine_impact_aed,
  a.engine_impact_kind,
  a.engine_impact_basis,
  a.engine_overall_risk,
  a.engine_days_in_stock,
  a.engine_gross_margin_aed,
  a.engine_owner_role,
  a.engine_evidence,
  a.engine_computed_at,

  -- What the engine says NOW, and whether that is still the same thing.
  s.recommendation             as engine_now_recommendation,
  s.overall_risk               as engine_now_risk,
  s.days_in_stock              as engine_now_days_in_stock,
  s.impact_aed                 as engine_now_impact_aed,
  s.reason                     as engine_now_reason,
  case when s.recommendation is null then null
       else s.recommendation = a.recommendation end           as engine_still_agrees,

  a.proposed_at,
  pu.name                      as proposed_by_name,
  a.proposed_source,

  a.decided_at,
  du.name                      as decided_by_name,
  du.role                      as decided_by_job_title,
  a.decided_by_authority,
  a.decision_reason_code,
  rc.label                     as decision_reason_label,
  rc.meaning                   as decision_reason_meaning,
  rc.engine_was_wrong          as decision_says_engine_was_wrong,
  a.decision_note,
  a.defer_until,

  a.assigned_to_staff_id,
  au.name                      as assigned_to_name,
  a.assigned_role,
  a.assigned_at,

  a.executed_at,
  eu.name                      as executed_by_name,
  a.execution_note,
  a.execution_failure,

  a.escalated_at,
  a.escalation_reason,

  a.outcome_state,
  a.outcome_purchase_id,
  ph.vehicle                   as outcome_sale_vehicle,
  ph.amount_aed                as outcome_sale_amount_aed,
  ph.purchase_date             as outcome_sale_date,
  a.outcome_recorded_at,
  ou.name                      as outcome_recorded_by_name,
  a.attribution_basis,
  a.attribution_note,
  a.recovered_value_aed,
  a.recovered_value_basis,

  -- The sentence the screen must show where an outcome would go. Written here
  -- so that "we do not know yet" cannot quietly become a zero on one screen and
  -- a dash on another.
  case a.outcome_state
    when 'NONE_YET' then
      case when a.status = 'PROPOSED'
             then 'No outcome, because nothing has been done yet. This is still waiting for a decision.'
           when a.status = 'APPROVED'
             then 'No outcome yet. This has been approved but not carried out, and an approval is a decision, not money.'
           when a.status = 'DEFERRED'
             then 'No outcome, because the decision was to wait.'
           else 'No outcome recorded.' end
    when 'AWAITING_OUTCOME' then
      'Carried out on ' || to_char(a.executed_at at time zone 'Asia/Dubai', 'DD Mon YYYY')
      || '. Nothing has been attributed to it yet. NEXUS will not claim a recovery until a real '
      || 'recorded sale is tied to this unit by a person, and today no column anywhere links a '
      || 'sale to a unit - purchase_history stores the vehicle as free text.'
    when 'ATTRIBUTED' then
      'Attributed to a recorded sale by ' || coalesce(ou.name, 'an approver') || '. '
      || coalesce(a.recovered_value_basis,
                  'Realised margin is not computable: the sale amount or the unit cost is missing, '
                  || 'so no figure is shown rather than a zero.')
    when 'NOT_ATTRIBUTABLE' then
      'Closed with no attributable outcome. ' || coalesce(a.attribution_note, '')
    when 'CLOSED_WITHOUT_ACTION' then
      case when a.status = 'REJECTED'
             then 'No outcome to measure: the recommendation was rejected, which is itself the useful result.'
           when a.status = 'EXECUTION_FAILED'
             then 'No outcome: the action was attempted and not carried out.'
           else 'No outcome to measure: the action was withdrawn before it was carried out.' end
  end                                                          as outcome_sentence,

  -- What happens if nobody acts. Exposure, in the engine's own words, never
  -- restated as loss or as recoverable revenue.
  case
    when a.status <> 'PROPOSED' then null
    when a.engine_impact_aed is null then
      'The engine claims no monetary impact for this unit, so nothing is stated about the cost of waiting.'
    else
      'AED ' || to_char(a.engine_impact_aed, 'FM999,999,999')
      || ' of gross margin stays exposed in a unit that has been on the lot '
      || coalesce(a.engine_days_in_stock::text, 'an unknown number of')
      || ' days. That is the amount AT RISK, not an expected loss and not a recoverable sum. '
      || 'How fast it is being eaten is NOT COMPUTABLE - this dealership has no holding rate on record.'
  end                                                          as cost_of_doing_nothing,

  (current_date - a.proposed_at::date)                         as days_open,
  a.created_at,
  a.updated_at
from public.inventory_actions a
left join public.inventory i
       on i.tenant_id = a.tenant_id and i.id = a.unit_id
left join public.v_inventory_profit_sentinel s
       on s.tenant_id = a.tenant_id and s.id = a.unit_id
left join public.users pu on pu.id = a.proposed_by_staff_id
left join public.users du on du.id = a.decided_by_staff_id
left join public.users au on au.id = a.assigned_to_staff_id
left join public.users eu on eu.id = a.executed_by_staff_id
left join public.users ou on ou.id = a.outcome_recorded_by_staff_id
left join public.purchase_history ph on ph.id = a.outcome_purchase_id
left join public.inventory_action_reason_codes rc on rc.code = a.decision_reason_code;

comment on view public.v_inventory_action_queue is
  'The Action Center work queue: one row per inventory action, joined to the unit, to what '
  'the engine says about that unit RIGHT NOW, and to the people involved. outcome_sentence '
  'and cost_of_doing_nothing are computed here so that no screen invents its own wording for '
  '"we do not know yet". security_invoker = true: a dealership sees only its own actions.';

drop view if exists public.v_inventory_action_timeline;
create view public.v_inventory_action_timeline
with (security_invoker = true) as
select
  e.id,
  e.tenant_id,
  e.action_id,
  e.at,
  e.event,
  u.name                       as actor_name,
  u.role                       as actor_job_title,
  e.actor_authority,
  e.detail,
  e.audit_log_id,
  l.status                     as audit_status,
  public.nexus_outcome_class(l.workflow, l.status, l.summary) as audit_outcome_class,
  l.summary                    as audit_summary
from public.inventory_action_events e
left join public.users u on u.id = e.actor_staff_id
left join public.audit_log l on l.id = e.audit_log_id;

comment on view public.v_inventory_action_timeline is
  'Every recorded step of one action, with the audit row behind it and that row classified by '
  'public.nexus_outcome_class - the system''s one outcome vocabulary. `event` is the lifecycle '
  'transition and `audit_outcome_class` is what the run did; they are different axes and the '
  'UI must not merge them. security_invoker = true.';

revoke all on public.v_inventory_action_queue    from anon;
revoke all on public.v_inventory_action_timeline from anon;
grant select on public.v_inventory_action_queue    to authenticated, service_role;
grant select on public.v_inventory_action_timeline to authenticated, service_role;