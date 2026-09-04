-- Measured in the probe run: sent_under_an_unverified_rule was
-- "verification_status <> 'VERIFIED'", which swept in NO_RULE_APPLIED -- a
-- freeform message inside an open window, where no rule was applied at all --
-- and reported it as having been sent under an unverified rule. Unknown is not
-- the same as unverified, and a caption must match its own branch.
drop view public.v_whatsapp_messaging_usage_monthly;

create view public.v_whatsapp_messaging_usage_monthly
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
  count(*) filter (where u.policy_rule_verification_status
                          in ('NOT_VERIFIED','UNKNOWN','DISPUTED'))       as sent_under_an_unverified_rule,
  count(*) filter (where u.policy_rule_verification_status = 'NO_RULE_APPLIED') as sent_with_no_rule_applied,
  count(*) filter (where u.latest_status = 'failed')                      as failed_messages,
  count(*) filter (where u.latest_status is null)                         as no_status_reported,
  'UNKNOWN - NEXUS holds no WhatsApp rate card. Meta prices by country, category and date; these are counts of what was sent and what the provider said about it, not an amount.'::text
                                                                          as cost_answer
from public.whatsapp_message_usage u
group by u.tenant_id, date_trunc('month', u.sent_at), u.message_category;

comment on view public.v_whatsapp_messaging_usage_monthly is
  'The "what did WhatsApp cost me this month" rollup, and its honest answer: counts, not money. No total column, because Meta prices by country, category and date and NEXUS holds no rate card. provider_conversations_reported is the closest thing to a billable unit NEXUS can evidence, and it is a count of what the provider reported, not a charge. sent_with_no_rule_applied is kept apart from sent_under_an_unverified_rule: no rule applied is not the same as an unverified rule.';

revoke all on public.v_whatsapp_messaging_usage_monthly from anon, authenticated, public;
grant select on public.v_whatsapp_messaging_usage_monthly to authenticated, service_role;