-- Every view here is security_invoker: it reads as the signed-in user and is
-- filtered by that user's RLS, not by the view owner's.

create or replace view public.v_whatsapp_template_registry
with (security_invoker = true) as
select
  t.template_id,
  t.tenant_id,
  t.integration_id,
  t.name,
  t.language,
  t.category,
  t.nexus_state,
  t.provider_status,
  t.provider_status_raw,
  t.provider_status_source,
  t.provider_status_observed_at,
  case when t.provider_status_observed_at is null then null
       else now() - t.provider_status_observed_at end            as status_age,
  case when t.provider_status_source = 'NEVER_OBSERVED' then 'NEVER_OBSERVED'
       else 'OBSERVED' end                                        as status_confidence,
  t.previous_provider_status,
  t.previous_status_observed_at,
  t.provider_rejected_reason,
  t.body_variable_count,
  t.variable_schema,
  t.body_text,
  t.body_text_source,
  case
    when t.provider_status = 'UNKNOWN'
      then 'NEXUS has never asked the provider about this template. It is not approved, and it is not rejected -- it is unknown.'
    when t.previous_provider_status is not null and t.provider_status <> t.previous_provider_status
      then format('The provider changed this template from %s to %s. Anything NEXUS sent on the old status was sent on a belief that no longer holds.',
                  t.previous_provider_status, t.provider_status)
    when t.provider_status = 'APPROVED'
      then format('The provider said APPROVED when NEXUS last asked, on %s. Whether that is still true depends on how long ago that was.',
                  to_char(t.provider_status_observed_at, 'YYYY-MM-DD HH24:MI'))
    else format('The provider last reported %s, on %s.',
                t.provider_status, to_char(t.provider_status_observed_at, 'YYYY-MM-DD HH24:MI'))
  end                                                             as what_this_row_claims,
  t.created_at,
  t.updated_at
from public.whatsapp_templates t;

comment on view public.v_whatsapp_template_registry is
  'The template registry as a screen should read it. There is no "approved" badge here that is not accompanied by the age of the answer behind it. status_confidence = NEVER_OBSERVED means NEXUS has no provider opinion at all.';


create or replace view public.v_whatsapp_message_usage
with (security_invoker = true) as
select
  u.usage_id,
  u.tenant_id,
  u.integration_id,
  u.event_id,
  u.sent_at,
  u.message_category,
  u.template_required,
  u.template_id,
  t.name                                   as template_name,
  t.language                               as template_language,
  u.policy_decision,
  u.policy_reason_code,
  u.policy_rule_id,
  u.policy_rule_name,
  u.policy_rule_verification_status,
  u.policy_decided_at,
  u.template_provider_status_at_send,
  u.template_status_age_at_send,
  u.template_staleness_verdict_at_send,
  t.provider_status                        as template_provider_status_now,
  (u.template_id is not null
   and u.template_provider_status_at_send is not null
   and t.provider_status is distinct from u.template_provider_status_at_send)
                                           as template_status_changed_since_send,
  u.latest_status,
  u.latest_status_at,
  u.billing_fact_state,
  u.provider_billable,
  u.provider_pricing_model,
  u.provider_pricing_category,
  u.provider_pricing_type,
  u.provider_conversation_id,
  u.provider_conversation_origin_type,
  u.provider_conversation_expiration_at,
  u.provider_pricing_observed_at,
  u.cost_state,
  case u.cost_state
    when 'UNKNOWN_AWAITING_PROVIDER_REPORT'      then 'Unknown - no status callback has arrived for this message yet.'
    when 'UNKNOWN_PROVIDER_REPORTED_NO_PRICING'  then 'Unknown - the provider''s callback carried no pricing object.'
    when 'NOT_BILLABLE_PROVIDER_REPORTED'        then 'Not billable - the provider itself reported billable = false.'
    when 'BILLABLE_AMOUNT_UNKNOWN_NO_RATE_CARD'  then 'Billable, amount unknown - the provider charged for this and NEXUS holds no rate card for its country, category or date.'
    else 'Unknown.'
  end                                      as cost_answer,
  u.recorded_at,
  u.updated_at
from public.whatsapp_message_usage u
left join public.whatsapp_templates t on t.template_id = u.template_id;

comment on view public.v_whatsapp_message_usage is
  'One row per outbound WhatsApp message. There is no money column, because NEXUS holds no WhatsApp rate card: cost_state and cost_answer are the only cost claims this data supports. template_status_changed_since_send is how a message sent on an APPROVED the provider has since withdrawn becomes visible.';


create or replace view public.v_whatsapp_messaging_usage_monthly
with (security_invoker = true) as
select
  u.tenant_id,
  date_trunc('month', u.sent_at)                                          as month,
  u.message_category,
  count(*)                                                                as messages,
  count(*) filter (where u.provider_billable is true)                     as provider_billable_messages,
  count(*) filter (where u.provider_billable is false)                    as provider_not_billable_messages,
  count(*) filter (where u.billing_fact_state = 'AWAITING_PROVIDER_REPORT')      as awaiting_provider_report,
  count(*) filter (where u.billing_fact_state = 'PROVIDER_REPORTED_NO_PRICING')  as reported_without_pricing,
  count(distinct u.provider_conversation_id)                              as provider_conversations_reported,
  count(*) filter (where u.template_required)                             as template_messages,
  count(*) filter (where u.policy_rule_verification_status = 'VERIFIED')  as sent_under_a_verified_rule,
  count(*) filter (where u.policy_rule_verification_status <> 'VERIFIED') as sent_under_an_unverified_rule,
  count(*) filter (where u.latest_status = 'failed')                      as failed_messages,
  count(*) filter (where u.latest_status is null)                         as no_status_reported,
  'UNKNOWN - NEXUS holds no WhatsApp rate card. Meta prices by country, category and date; these are counts of what was sent and what the provider said about it, not an amount.'::text
                                                                          as cost_answer
from public.whatsapp_message_usage u
group by u.tenant_id, date_trunc('month', u.sent_at), u.message_category;

comment on view public.v_whatsapp_messaging_usage_monthly is
  'The "what did WhatsApp cost me this month" rollup, and its honest answer: counts, not money. It deliberately has no total column. Meta bills per CONVERSATION, so provider_conversations_reported is the closest thing to a billable unit NEXUS can evidence - and it is a count of what the provider reported, not a charge.';


revoke all on public.v_whatsapp_template_registry        from anon, authenticated, public;
revoke all on public.v_whatsapp_message_usage            from anon, authenticated, public;
revoke all on public.v_whatsapp_messaging_usage_monthly  from anon, authenticated, public;

grant select on public.v_whatsapp_template_registry       to authenticated, service_role;
grant select on public.v_whatsapp_message_usage           to authenticated, service_role;
grant select on public.v_whatsapp_messaging_usage_monthly to authenticated, service_role;