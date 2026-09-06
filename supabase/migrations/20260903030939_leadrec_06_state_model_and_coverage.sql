-- LEAD RECOVERY ENGINE — 06: the vocabulary, its reachability, and what the
-- engine cannot see.
--
-- A state that cannot be produced is documented as unreachable rather than given
-- a fake path. APPOINTMENT_PENDING is the whole reason this table exists: the
-- brief for this engine names it, and this schema has no appointment table, no
-- appointment column and no appointment event. Inventing a proxy for it - "a
-- customer who said 'tomorrow'" - would put a state on a manager's screen that
-- means nothing.

create table public.lead_recovery_states (
  state              text primary key,
  sort               integer not null,
  meaning            text not null,
  engine_can_produce boolean not null,
  blocked_by         text,
  requires           text not null
);

insert into public.lead_recovery_states (state, sort, meaning, engine_can_produce, blocked_by, requires) values
 ('NEW_RISK', 10,
  'A lead exists and no conversation resolves to it. NEXUS knows nothing about what was said.',
  true, null,
  'A leads row whose identity keys match no communication_logs row under the INV-002 rule.'),
 ('WAITING_RESPONSE', 20,
  'The customer sent the last message and the dealership has not replied.',
  true, null,
  'A resolved inbound message newer than every resolved outbound message.'),
 ('SILENT', 30,
  'The dealership sent the last message and the customer has not answered past the silence threshold.',
  true, null,
  'A resolved outbound message newer than every inbound one, older than silence_hours.'),
 ('ENGAGED', 40,
  'Two-way conversation, dealership spoke last, inside the silence threshold.',
  true, null,
  'A resolved outbound message newer than every inbound one, younger than silence_hours.'),
 ('APPOINTMENT_PENDING', 50,
  'A booked appointment is outstanding.',
  false, 'NO_APPOINTMENT_TABLE',
  'An appointments table with a lead reference and a scheduled time. None exists in this schema - '
  'no table, no column, no event type - so no branch of lead_recovery_state() can return this and '
  'none has been written. Restoring it is an integration, not a code change.'),
 ('ESCALATED', 60,
  'The lead was handed to a person and nothing has been said since.',
  true, null,
  'leads.escalated_at set, and no resolved message after it.'),
 ('RECOVERED', 70,
  'A confirmed sale is recorded against this lead. Note: recovered LEAD, not revenue recovered BY '
  'NEXUS - v_lead_recovery.recovery_attribution_state answers that separately and answers it '
  'SALE_WITHOUT_RECOVERY_ACTION when no action was ever raised.',
  true, null,
  'A purchase_history row carrying this lead_id. Nothing weaker counts.'),
 ('CLOSED_NO_OUTCOME', 80,
  'The lead is closed by status and no sale is recorded. Nothing is leaking because nothing is open.',
  true, null,
  'nexus_lead_is_open(leads.status) false, and no purchase_history row.');

comment on table public.lead_recovery_states is
  'The closed state vocabulary and, for each state, whether lead_recovery_state() can actually '
  'produce it on this schema. engine_can_produce = false is a structural gap recorded as a gap.';

alter table public.lead_recovery_states enable row level security;
create policy lead_recovery_states_authenticated_read
  on public.lead_recovery_states for select to authenticated using (true);
create policy lead_recovery_states_deny_anon
  on public.lead_recovery_states as restrictive for all to anon using (false) with check (false);
create policy lead_recovery_states_service_role_all
  on public.lead_recovery_states for all to service_role using (true) with check (true);
revoke all on public.lead_recovery_states from anon, public;
grant select on public.lead_recovery_states to authenticated;
grant all on public.lead_recovery_states to service_role;

-- Reachability, measured against live data rather than claimed.
create view public.v_lead_recovery_state_model with (security_invoker = true) as
select m.state, m.sort, m.meaning, m.engine_can_produce, m.blocked_by, m.requires,
       coalesce(c.leads_in_state, 0) as leads_in_state_now,
       case
         when not m.engine_can_produce         then 'UNREACHABLE_BY_DESIGN'
         when coalesce(c.leads_in_state, 0) > 0 then 'OBSERVED'
         else 'REACHABLE_NOT_OBSERVED'
       end as observation
  from public.lead_recovery_states m
  left join (select state, count(*) as leads_in_state from public.v_lead_recovery group by state) c
    on c.state = m.state
 order by m.sort;

comment on view public.v_lead_recovery_state_model is
  'What the engine can say, and what it is actually saying today. REACHABLE_NOT_OBSERVED means the '
  'branch works and no lead is in it; UNREACHABLE_BY_DESIGN means no branch exists and the reason is '
  'in blocked_by. Do not read a zero as evidence a branch is broken, or a branch as evidence of data.';

revoke all on public.v_lead_recovery_state_model from anon, public;
grant select on public.v_lead_recovery_state_model to authenticated, service_role;

-- What the engine cannot see. Every number here weakens a conclusion above it,
-- which is why it sits beside the engine and not in a footnote.
create view public.v_lead_recovery_coverage with (security_invoker = true) as
with r as (select * from public.v_lead_recovery),
comm as (
  select c.tenant_id,
         count(*)                                                                    as log_rows,
         count(*) filter (where public.nexus_is_message(c.direction, c.channel, c.message)) as message_events,
         count(*) filter (where c.message like '[SILENCE-%')                         as silence_markers,
         count(*) filter (where public.nexus_is_message(c.direction, c.channel, c.message)
                            and exists (select 1 from public.v_lead_messages v where v.id = c.id)) as resolved_to_a_lead,
         count(distinct c.lead_email) filter (where public.nexus_is_message(c.direction, c.channel, c.message)
                            and not exists (select 1 from public.v_lead_messages v where v.id = c.id)) as unresolved_handles
    from public.communication_logs c
   group by c.tenant_id
),
acts as (
  select a.tenant_id,
         count(*) as actions_total,
         count(*) filter (where a.status = 'PROPOSED')  as awaiting_decision,
         count(*) filter (where a.status = 'EXECUTED')  as executed,
         count(*) filter (where a.outcome_state = 'ATTRIBUTED') as outcomes_attributed,
         count(*) filter (where not exists (select 1 from public.leads l
                                             where l.id = a.lead_id and l.tenant_id = a.tenant_id)) as actions_with_wrong_tenant
    from public.lead_recovery_actions a
   group by a.tenant_id
)
select
  r.tenant_id,
  count(*)                                                          as leads_total,
  count(*) filter (where r.lead_is_open)                            as leads_open,
  count(*) filter (where not r.lead_is_open)                        as leads_closed,
  count(*) filter (where r.risk_level in ('HIGH','MEDIUM'))         as leads_at_risk,
  count(*) filter (where r.risk_level = 'UNKNOWN')                  as leads_risk_unknown,
  count(*) filter (where r.recommended_action <> 'NO_ACTION')       as leads_with_a_recommended_action,
  count(*) filter (where r.confirmed_outcome_state = 'CONFIRMED_SALE') as leads_with_a_confirmed_sale,
  sum(r.confirmed_revenue_aed)                                      as confirmed_revenue_aed,
  count(*) filter (where r.recovery_attribution_state = 'ATTRIBUTED') as sales_attributed_to_a_recovery_action,
  count(*) filter (where r.owner_state = 'UNASSIGNED')              as leads_with_no_owner,
  count(*) filter (where r.response_time_state = 'UNKNOWN_NOT_MEASURED') as leads_with_no_measured_response_time,
  count(*) filter (where r.messages_resolved = 0)                   as leads_with_no_resolved_conversation,

  max(cm.log_rows)        as communication_log_rows,
  max(cm.message_events)  as message_events,
  max(cm.silence_markers) as silence_markers,
  max(cm.resolved_to_a_lead) as message_events_resolved_to_a_lead,
  case when max(cm.message_events) > 0
       then round(100.0 * max(cm.resolved_to_a_lead) / max(cm.message_events), 1) end as identity_resolution_pct,
  max(cm.unresolved_handles) as unresolved_whatsapp_handles,

  max(r.silence_detector_state)            as silence_detector_state,
  max(r.silence_detector_last_run_at)      as silence_detector_last_run_at,
  max(r.silence_detector_last_success_at)  as silence_detector_last_success_at,
  max(r.silence_detector_last_run_class)   as silence_detector_last_run_class,

  coalesce(max(ac.actions_total), 0)        as recovery_actions_total,
  coalesce(max(ac.awaiting_decision), 0)    as recovery_actions_awaiting_decision,
  coalesce(max(ac.executed), 0)             as recovery_actions_executed,
  coalesce(max(ac.outcomes_attributed), 0)  as recovery_outcomes_attributed,
  coalesce(max(ac.actions_with_wrong_tenant), 0) as actions_whose_lead_is_another_tenants,

  bool_and(r.settings_are_defaults) as settings_are_defaults,
  max(r.sla_first_response_minutes) as sla_first_response_minutes,
  -- leads.response_time_minutes > 5 is hardcoded inside v_needs_attention and
  -- v_team_performance. If this engine's threshold stops matching it, NEXUS quotes
  -- two different SLAs on two screens. This reads the live view definition rather
  -- than trusting a comment.
  (max(r.sla_first_response_minutes) = 5
   and pg_get_viewdef('public.v_needs_attention'::regclass, true) like '%response_time_minutes > 5%')
    as sla_agrees_with_needs_attention,

  'CANNOT SIZE: no lead carries a budget and nothing links a lead to a unit, so no opportunity value '
  'is computable - only confirmed sales. CANNOT SEE: '
  || coalesce((max(cm.message_events) - max(cm.resolved_to_a_lead))::text, '?')
  || ' message events belong to WhatsApp handles that match no lead. CANNOT CONFIRM SILENCE: the '
  'detector state is ' || max(r.silence_detector_state)
  || '. CANNOT BOOK: there is no appointment table, so APPOINTMENT_PENDING is unreachable. '
  'CANNOT EXECUTE: no workflow performs a lead recovery action; a person does.'
    as what_this_engine_cannot_tell_you,
  now() as computed_at
from r
left join comm cm on cm.tenant_id = r.tenant_id
left join acts ac on ac.tenant_id = r.tenant_id
group by r.tenant_id;

comment on view public.v_lead_recovery_coverage is
  'The honesty surface for the Lead Recovery Engine. Identity resolution rate, silence detector '
  'freshness, how many leads have no owner and no measured response time, whether the SLA number '
  'still agrees with the one hardcoded in v_needs_attention, and a plain sentence naming what the '
  'engine cannot tell a dealership. Read it before quoting anything from v_lead_recovery.';

revoke all on public.v_lead_recovery_coverage from anon, public;
grant select on public.v_lead_recovery_coverage to authenticated, service_role;