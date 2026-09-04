-- LEAD RECOVERY ENGINE — 05: the view stops restating the model.
-- Identical column list; the three CASE ladders become calls to
-- lead_recovery_state / _risk / _recommended_action, so there is one definition
-- of the state model and not two that can drift (INV-008). security_invoker is
-- re-stated because CREATE OR REPLACE VIEW silently drops it - it has done so
-- three times in this project.
create or replace view public.v_lead_recovery with (security_invoker = true) as
with cfg as (
  select t.id                                        as tenant_id,
         coalesce(s.sla_first_response_minutes, 5)    as sla_minutes,
         coalesce(s.silence_hours, 12)                as silence_hours,
         coalesce(s.stale_silence_hours, 72)          as stale_hours,
         coalesce(s.engagement_window_days, 14)       as engage_days,
         coalesce(s.detector_max_age_hours, 26)       as detector_max_age_hours,
         (s.tenant_id is null)                        as settings_are_defaults
    from public.tenants t
    left join public.lead_recovery_settings s on s.tenant_id = t.id
),
det as (
  select c.tenant_id,
         (select max(l.logged_at) from public.audit_log l
            join public.workflow_registry r
              on l.workflow = r.name or l.workflow = r.audit_name or l.workflow = any(r.audit_aliases)
           where l.tenant_id = c.tenant_id and r.name ilike '%silence detector%') as last_run_at,
         (select max(l.logged_at) from public.audit_log l
            join public.workflow_registry r
              on l.workflow = r.name or l.workflow = r.audit_name or l.workflow = any(r.audit_aliases)
           where l.tenant_id = c.tenant_id and r.name ilike '%silence detector%'
             and public.nexus_outcome_class(l.workflow, l.status, l.summary) = 'SUCCESS') as last_success_at,
         (select public.nexus_outcome_class(l.workflow, l.status, l.summary)
            from public.audit_log l
            join public.workflow_registry r
              on l.workflow = r.name or l.workflow = r.audit_name or l.workflow = any(r.audit_aliases)
           where l.tenant_id = c.tenant_id and r.name ilike '%silence detector%'
           order by l.logged_at desc limit 1) as last_run_class
    from cfg c
),
msg as (
  select v.lead_id,
         count(*) filter (where v.is_message)                                                as msgs,
         count(*) filter (where v.is_message and lower(btrim(v.direction)) = 'inbound')      as msgs_in,
         count(*) filter (where v.is_message and lower(btrim(v.direction)) = 'outbound')     as msgs_out,
         min(v.created_at) filter (where v.is_message)                                       as first_msg_at,
         max(v.created_at) filter (where v.is_message)                                       as last_msg_at,
         max(v.created_at) filter (where v.is_message and lower(btrim(v.direction)) = 'inbound')  as last_in_at,
         max(v.created_at) filter (where v.is_message and lower(btrim(v.direction)) = 'outbound') as last_out_at,
         count(*) filter (where not v.is_message and v.message like '[SILENCE-%')            as silence_markers,
         max(v.created_at) filter (where not v.is_message and v.message like '[SILENCE-%')   as last_marker_at
    from public.v_lead_messages v
   group by v.lead_id
),
sale as (
  select p.tenant_id, p.lead_id,
         count(*)                                   as sale_n,
         sum(p.amount_aed)                          as sale_amt,
         count(*) filter (where p.amount_aed is null) as sale_n_no_amount,
         max(p.purchase_date)                       as last_sale_date,
         min(p.created_at)                          as first_sale_recorded_at
    from public.purchase_history p
   where p.lead_id is not null
   group by p.tenant_id, p.lead_id
),
act as (
  select distinct on (a.tenant_id, a.lead_id)
         a.tenant_id, a.lead_id, a.id as action_id, a.status as action_status,
         a.recommendation as action_recommendation, a.outcome_state, a.recovered_value_aed,
         a.outcome_purchase_id, a.attribution_basis, a.executed_at, a.decided_at, a.proposed_at
    from public.lead_recovery_actions a
   order by a.tenant_id, a.lead_id,
            (a.status in ('PROPOSED','APPROVED','DEFERRED')) desc, a.proposed_at desc
),
base as (
  select l.tenant_id, l.id as lead_id, l.name as lead_name, l.status as lead_status,
         l.created_at, l.escalated_at, l.assigned_to_id, l.response_time_minutes,
         public.nexus_lead_is_open(l.status) as lead_is_open,
         nullif(btrim(coalesce(l.vehicle_interest, '')), '') as vehicle_text,
         u.name as owner_name, u.role as owner_job_title,
         c.sla_minutes, c.silence_hours, c.stale_hours, c.engage_days,
         c.detector_max_age_hours, c.settings_are_defaults,
         d.last_run_at as detector_last_run_at, d.last_success_at as detector_last_success_at,
         d.last_run_class as detector_last_run_class,
         case
           when d.last_success_at is null then 'NEVER_SUCCEEDED'
           when d.last_success_at < now() - make_interval(hours => c.detector_max_age_hours) then 'STALE'
           else 'CURRENT'
         end as detector_state,
         coalesce(m.msgs, 0) as msgs, coalesce(m.msgs_in, 0) as msgs_in,
         coalesce(m.msgs_out, 0) as msgs_out,
         m.first_msg_at, m.last_msg_at, m.last_in_at, m.last_out_at,
         coalesce(m.silence_markers, 0) as silence_markers, m.last_marker_at,
         coalesce(s.sale_n, 0) as sale_n, s.sale_amt, coalesce(s.sale_n_no_amount, 0) as sale_n_no_amount,
         s.last_sale_date, s.first_sale_recorded_at,
         a.action_id, a.action_status, a.action_recommendation, a.outcome_state,
         a.recovered_value_aed, a.outcome_purchase_id, a.attribution_basis, a.executed_at,
         case when m.last_out_at is null then null
              else round((extract(epoch from (now() - m.last_out_at)) / 3600.0)::numeric, 2) end as hours_since_our_last_message,
         case when m.last_in_at is null then null
              else round((extract(epoch from (now() - m.last_in_at)) / 60.0)::numeric, 1) end as minutes_since_their_last_message
    from public.leads l
    join cfg c on c.tenant_id = l.tenant_id
    left join det  d on d.tenant_id = l.tenant_id
    left join msg  m on m.lead_id  = l.id
    left join sale s on s.tenant_id = l.tenant_id and s.lead_id = l.id
    left join act  a on a.tenant_id = l.tenant_id and a.lead_id = l.id
    left join public.users u on u.id = l.assigned_to_id and u.tenant_id = l.tenant_id
),
classified as (
  select b.*,
         public.lead_recovery_state(
           b.sale_n, b.lead_is_open, b.msgs, b.escalated_at,
           b.last_msg_at, b.last_in_at, b.last_out_at,
           b.hours_since_our_last_message, b.silence_hours) as state
  from base b
),
scored as (
  select c.*,
         public.lead_recovery_risk(
           c.state, c.minutes_since_their_last_message, c.hours_since_our_last_message,
           c.sla_minutes, c.stale_hours) as risk_level
  from classified c
)
select
  s.tenant_id,
  s.lead_id,
  s.lead_name,
  s.lead_status,
  s.lead_is_open,
  s.created_at as lead_created_at,
  s.vehicle_text as vehicle_interest_text,
  case when s.vehicle_text is null then 'UNKNOWN_NOT_RECORDED' else 'UNKNOWN_TEXT_ONLY' end as vehicle_state,
  case when s.vehicle_text is null
       then 'UNKNOWN. No vehicle interest is recorded on this lead.'
       else 'UNKNOWN. leads.vehicle_interest is free text and no column links a lead to a unit, '
            || 'so NEXUS cannot say which car on the lot this is about. The text is shown as a prompt for a person.'
  end as vehicle_note,
  s.state,
  case s.state
    when 'RECOVERED'         then 'A sale is recorded against this lead in purchase_history. That is a confirmed business outcome, not an estimate.'
    when 'CLOSED_NO_OUTCOME' then 'leads.status is ' || coalesce(s.lead_status,'(blank)') || ', which nexus_lead_is_open treats as closed, and no sale is recorded. Nothing is leaking because nothing is open.'
    when 'NEW_RISK'          then 'No message resolves to this lead under the INV-002 identity rule. NEXUS knows a lead exists and nothing else about the conversation.'
    when 'ESCALATED'         then 'leads.escalated_at is set and nothing has been said since. The lead was handed to a person and the handover has not moved.'
    when 'WAITING_RESPONSE'  then 'The customer sent the last message. The dealership has not replied.'
    when 'SILENT'            then 'The dealership sent the last message and the customer has not answered for at least ' || s.silence_hours || ' hours.'
    when 'ENGAGED'           then 'Both sides have spoken and the dealership spoke last, within the ' || s.silence_hours || '-hour silence threshold.'
    else 'No branch matched. This should be unreachable.'
  end as state_basis,
  s.response_time_minutes,
  case when s.response_time_minutes is null then 'UNKNOWN_NOT_MEASURED' else 'MEASURED' end as response_time_state,
  s.sla_minutes as sla_first_response_minutes,
  case
    when s.response_time_minutes is null                     then 'UNKNOWN'
    when s.response_time_minutes <= s.sla_minutes            then 'WITHIN_SLA'
    else 'BREACHED_SLA'
  end as sla_state,
  case when s.response_time_minutes is null
       then 'UNKNOWN: nobody measured a first response for this lead. INV-003 - a blank means unmeasured, not unanswered.'
       else null end as response_time_note,
  s.last_msg_at as last_contact_at,
  case when s.last_msg_at is null then 'UNKNOWN_NO_RESOLVED_MESSAGE' else 'FROM_RESOLVED_MESSAGE' end as last_contact_state,
  s.last_in_at  as last_customer_message_at,
  s.last_out_at as last_dealership_message_at,
  s.msgs as messages_resolved, s.msgs_in as messages_in, s.msgs_out as messages_out,
  s.first_msg_at as first_message_at,
  s.hours_since_our_last_message,
  s.minutes_since_their_last_message,
  case
    when s.msgs = 0                                                        then 'UNKNOWN_NO_MESSAGES'
    when s.last_in_at is not null and (s.last_out_at is null or s.last_in_at > s.last_out_at) then 'CUSTOMER_SPOKE_LAST'
    when s.hours_since_our_last_message >= s.stale_hours                   then 'SILENT_PAST_STALE_THRESHOLD'
    when s.hours_since_our_last_message >= s.silence_hours                 then 'SILENT_PAST_THRESHOLD'
    else 'IN_CONVERSATION'
  end as silence_state,
  s.silence_hours as silence_threshold_hours,
  s.stale_hours   as stale_silence_threshold_hours,
  s.silence_markers as silence_markers_on_file,
  s.last_marker_at as last_silence_marker_at,
  s.detector_state as silence_detector_state,
  s.detector_last_run_at as silence_detector_last_run_at,
  s.detector_last_success_at as silence_detector_last_success_at,
  s.detector_last_run_class as silence_detector_last_run_class,
  case s.detector_state
    when 'CURRENT' then null
    when 'STALE'   then 'The 12-Hour Silence Detector has not succeeded since '
                        || to_char(s.detector_last_success_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI')
                        || ' GST, so the ABSENCE of a silence marker on this lead is not evidence that nobody went quiet. '
                        || 'The silence state above is computed from message timestamps, which is why it is still stated; '
                        || 'the marker count is not.'
    else 'The 12-Hour Silence Detector has never recorded a successful run for this dealership. '
         || 'No marker count on any lead means anything.'
  end as silence_detector_note,
  s.risk_level,
  case s.risk_level
    when 'NONE'    then 'Nothing is leaking: the lead is either closed or converted.'
    when 'UNKNOWN' then 'Risk cannot be stated. No message resolves to this lead, so the conversation is invisible to NEXUS. INV-007 - a missing row is not proof nothing happened.'
    when 'HIGH'    then case s.state
                          when 'ESCALATED'        then 'Escalated to a person and nothing has moved since.'
                          when 'WAITING_RESPONSE' then 'The customer has been waiting ' || s.minutes_since_their_last_message || ' minutes against a ' || s.sla_minutes || '-minute rule.'
                          else 'Silent for ' || s.hours_since_our_last_message || ' hours, past the ' || s.stale_hours || '-hour stale threshold.' end
    when 'MEDIUM'  then case s.state
                          when 'WAITING_RESPONSE' then 'The customer spoke last, ' || s.minutes_since_their_last_message || ' minutes ago, still inside the ' || s.sla_minutes || '-minute rule.'
                          else 'Silent for ' || s.hours_since_our_last_message || ' hours, past ' || s.silence_hours || ' but not past ' || s.stale_hours || '.' end
    else 'Two-way conversation inside the silence threshold.'
  end as risk_basis,
  public.lead_recovery_recommended_action(s.state, s.risk_level, s.assigned_to_id is not null) as recommended_action,
  case
    when s.risk_level = 'NONE'    then 'Nothing to do.'
    when s.risk_level = 'UNKNOWN' then 'A person has to look, because NEXUS cannot see this conversation.'
    when s.state = 'ESCALATED'    then 'An escalation is already open on this lead. Raising a second action would compete with it.'
    when s.assigned_to_id is null and s.risk_level in ('HIGH','MEDIUM')
                                  then 'Nobody owns this lead. Chasing it before it has an owner produces an action with no one to do it.'
    when s.risk_level = 'HIGH'    then 'Past the threshold this dealership is being held to. A reply from the assigned rep is no longer enough.'
    else 'Inside the threshold. A follow-up from the owner is the proportionate action.'
  end as action_reason,
  s.assigned_to_id as owner_staff_id,
  s.owner_name     as owner_name,
  s.owner_job_title,
  case when s.assigned_to_id is null then 'UNASSIGNED' else 'ASSIGNED' end as owner_state,
  case when s.assigned_to_id is null
       then 'UNKNOWN. leads.assigned_to_id is null, so no person owns this lead. NEXUS holds no verified role directory for this dealership and will not guess one.'
       else null end as owner_note,
  s.action_id, s.action_status, s.action_recommendation,
  case when s.action_id is null then 'NONE_PROPOSED' else s.action_status end as action_state,
  null::integer as opportunity_value_aed,
  'UNKNOWN_NO_LINK'::text as opportunity_value_state,
  'UNKNOWN. leads.budget_aed is null on every lead on file and nothing links a lead to a unit, '
  'so this engine cannot size what is at stake. It reports risk, not value. A figure here would be invented.'::text
    as opportunity_value_basis,
  case
    when s.sale_n = 0                 then 'NO_SALE_RECORDED'
    when s.sale_n_no_amount > 0       then 'CONFIRMED_SALE_AMOUNT_INCOMPLETE'
    else 'CONFIRMED_SALE'
  end as confirmed_outcome_state,
  case when s.sale_n > 0 then s.sale_amt end as confirmed_revenue_aed,
  s.last_sale_date as confirmed_outcome_date,
  case when s.sale_n > 0
       then s.sale_n || ' sale row(s) in purchase_history carry lead_id = ' || s.lead_id
            || '. CONFIRMED revenue - a recorded business outcome, not an estimate and not attribution.'
       else 'No row in purchase_history names this lead. That is not proof no sale happened; it is proof none was recorded here.'
  end as confirmed_outcome_basis,
  case
    when s.action_id is null and s.sale_n > 0 then 'SALE_WITHOUT_RECOVERY_ACTION'
    when s.action_id is null                  then 'NO_RECOVERY_ACTION'
    when s.outcome_state = 'ATTRIBUTED'       then 'ATTRIBUTED'
    when s.outcome_state = 'NOT_ATTRIBUTABLE' then 'NOT_ATTRIBUTABLE'
    when s.sale_n > 0 and s.executed_at is not null then 'SALE_EXISTS_NOT_YET_ATTRIBUTED'
    else 'NO_CONFIRMED_OUTCOME'
  end as recovery_attribution_state,
  s.recovered_value_aed,
  case when s.action_id is null and s.sale_n > 0
       then 'This lead converted and NEXUS recovered nothing: no recovery action was ever raised against it. '
            || 'The sale is the dealership''s, not the product''s.'
       else s.attribution_basis end as recovery_attribution_basis,
  case
    when s.state in ('RECOVERED','CLOSED_NO_OUTCOME')                               then 'HIGH'
    when s.msgs = 0                                                                 then 'LOW'
    when s.detector_state = 'CURRENT' and s.response_time_minutes is not null       then 'HIGH'
    else 'MEDIUM'
  end as confidence,
  case
    when s.state = 'RECOVERED'         then 'A purchase_history row is a fact somebody entered, not an inference.'
    when s.state = 'CLOSED_NO_OUTCOME' then 'leads.status was set by a person and read through nexus_lead_is_open.'
    when s.msgs = 0                    then 'Derived from the lead row alone. No conversation resolves to this person.'
    when s.detector_state <> 'CURRENT' and s.response_time_minutes is null
      then 'Message timestamps are solid; the silence detector is ' || lower(s.detector_state)
           || ' and no first response was ever measured.'
    when s.detector_state <> 'CURRENT'
      then 'Message timestamps are solid; the silence detector is ' || lower(s.detector_state) || '.'
    when s.response_time_minutes is null
      then 'Message timestamps are solid; no first response was ever measured for this lead.'
    else 'Message timestamps, a measured first response and a current silence detector all agree.'
  end as confidence_basis,
  true as human_approval_required,
  'NO_AUTOMATED_EXECUTOR' as automation_state,
  'No NEXUS workflow executes a lead recovery action. FOLLOW_UP and ESCALATE mean a person acts - '
  'the dashboard''s WhatsApp Send is human-initiated. NEXUS records that they acted; it does not act.' as automation_note,
  jsonb_build_object(
    'lead_status',                     s.lead_status,
    'lead_is_open',                    s.lead_is_open,
    'messages_resolved',               s.msgs,
    'messages_in',                     s.msgs_in,
    'messages_out',                    s.msgs_out,
    'first_message_at',                s.first_msg_at,
    'last_message_at',                 s.last_msg_at,
    'last_customer_message_at',        s.last_in_at,
    'last_dealership_message_at',      s.last_out_at,
    'silence_markers_on_file',         s.silence_markers,
    'last_silence_marker_at',          s.last_marker_at,
    'silence_markers_are_not_messages','INV-004: [SILENCE-ESCALATED] rows are excluded from every count and from last_contact_at',
    'silence_detector_state',          s.detector_state,
    'silence_detector_last_success_at',s.detector_last_success_at,
    'response_time_minutes',           s.response_time_minutes,
    'escalated_at',                    s.escalated_at,
    'owner_staff_id',                  s.assigned_to_id,
    'sales_recorded',                  s.sale_n,
    'confirmed_revenue_aed',           case when s.sale_n > 0 then s.sale_amt end,
    'thresholds', jsonb_build_object(
        'sla_first_response_minutes', s.sla_minutes,
        'silence_hours',              s.silence_hours,
        'stale_silence_hours',        s.stale_hours,
        'detector_max_age_hours',     s.detector_max_age_hours,
        'are_defaults',               s.settings_are_defaults)
  ) as evidence,
  s.settings_are_defaults,
  now() as computed_at
from scored s;