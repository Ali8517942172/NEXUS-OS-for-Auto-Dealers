-- One row per outbound WhatsApp message: what was sent, under which rule, with
-- which template, and what the PROVIDER reported about billing.
--
-- Rule 2 of this work: never invent a cost. There is deliberately NO money
-- column on this table and no rate anywhere in this migration. Meta's pricing
-- varies by country, category and time and NEXUS holds no rate card, so the
-- only honest answers are the provider's own facts and the word UNKNOWN.
-- cost_state is a GENERATED state, not a number, so a screen cannot sum it into
-- a total that looks like an invoice.

create table public.whatsapp_message_usage (
  usage_id                            uuid primary key default gen_random_uuid(),
  tenant_id                           uuid not null references public.tenants(id) on delete restrict,
  integration_id                      uuid not null references public.channel_registry(integration_id) on delete restrict,
  event_id                            uuid not null references public.channel_message_events(event_id) on delete restrict,

  message_category                    text not null,
  template_required                   boolean not null,
  template_id                         uuid references public.whatsapp_templates(template_id) on delete restrict,

  policy_decision                     text not null,
  policy_reason_code                  text not null,
  policy_rule_id                      uuid references public.policy_rule(id) on delete restrict,
  policy_rule_name                    text,
  policy_rule_verification_status      text not null,
  policy_decided_at                   timestamptz not null,

  template_provider_status_at_send    text,
  template_status_age_at_send         interval,
  template_staleness_verdict_at_send  text,

  sent_at                             timestamptz not null,

  billing_fact_state                  text not null default 'AWAITING_PROVIDER_REPORT',
  provider_billable                   boolean,
  provider_pricing_model              text,
  provider_pricing_category           text,
  provider_pricing_type               text,
  provider_conversation_id            text,
  provider_conversation_origin_type   text,
  provider_conversation_expiration_at timestamptz,
  provider_pricing_observed_at        timestamptz,
  provider_pricing_delivery_event_id  uuid references public.whatsapp_delivery_events(delivery_event_id) on delete restrict,

  latest_status                       text,
  latest_status_at                    timestamptz,
  latest_status_delivery_event_id     uuid references public.whatsapp_delivery_events(delivery_event_id) on delete restrict,

  cost_state text generated always as (
    case
      when billing_fact_state = 'AWAITING_PROVIDER_REPORT'      then 'UNKNOWN_AWAITING_PROVIDER_REPORT'
      when billing_fact_state = 'PROVIDER_REPORTED_NO_PRICING'  then 'UNKNOWN_PROVIDER_REPORTED_NO_PRICING'
      when provider_billable is false                            then 'NOT_BILLABLE_PROVIDER_REPORTED'
      when provider_billable is true                             then 'BILLABLE_AMOUNT_UNKNOWN_NO_RATE_CARD'
      else 'UNKNOWN'
    end) stored,

  recorded_at                         timestamptz not null default now(),
  updated_at                          timestamptz not null default now(),

  constraint wmu_message_category_vocabulary
    check (message_category = any (array['SERVICE','UTILITY','MARKETING','AUTHENTICATION','UNKNOWN'])),

  constraint wmu_policy_decision_vocabulary
    check (policy_decision = any (array['FREEFORM_ALLOWED','TEMPLATE_REQUIRED'])),
  -- BLOCKED is absent on purpose: a blocked message was never sent, so it has no
  -- place in a ledger of what was sent. A refusal belongs in the audit trail.
  constraint wmu_template_required_is_the_decision
    check (template_required = (policy_decision = 'TEMPLATE_REQUIRED')),
  constraint wmu_template_required_names_a_template
    check (template_required = false or template_id is not null),
  constraint wmu_policy_reason_code_present
    check (nullif(btrim(policy_reason_code),'') is not null and length(policy_reason_code) <= 100),
  constraint wmu_policy_rule_verification_vocabulary
    check (policy_rule_verification_status = any (array['VERIFIED','NOT_VERIFIED','UNKNOWN','DISPUTED','NO_RULE_APPLIED'])),
  constraint wmu_rule_id_pairs_with_its_status
    check ((policy_rule_id is null) = (policy_rule_verification_status = 'NO_RULE_APPLIED')),

  -- The send path had to ask "is this template still good, and how stale is that
  -- answer" -- so the answer it got is on the row. Without this a stale APPROVED
  -- send leaves no trace that anybody checked.
  constraint wmu_template_send_records_the_staleness_answer
    check (template_id is null
           or (template_provider_status_at_send is not null
               and template_staleness_verdict_at_send is not null)),
  constraint wmu_status_age_only_when_a_status_was_observed
    check ((template_provider_status_at_send = 'UNKNOWN') = (template_status_age_at_send is null)
           or template_provider_status_at_send is null),
  constraint wmu_staleness_verdict_vocabulary
    check (template_staleness_verdict_at_send is null
           or template_staleness_verdict_at_send = any (array[
             'SEND_ALLOWED','SENT_ON_OPERATOR_OVERRIDE'])),

  -- Billing provenance, in the shape inventory_profit_settings established for
  -- holding cost: a provider-reported figure may not be saved without saying
  -- WHICH callback reported it and WHEN.
  constraint wmu_billing_fact_state_vocabulary
    check (billing_fact_state = any (array[
      'AWAITING_PROVIDER_REPORT','PROVIDER_REPORTED','PROVIDER_REPORTED_NO_PRICING'])),
  constraint wmu_awaiting_carries_nothing
    check (billing_fact_state <> 'AWAITING_PROVIDER_REPORT'
           or (provider_billable is null and provider_pricing_model is null
               and provider_pricing_category is null and provider_pricing_type is null
               and provider_conversation_id is null and provider_conversation_origin_type is null
               and provider_conversation_expiration_at is null
               and provider_pricing_observed_at is null
               and provider_pricing_delivery_event_id is null)),
  constraint wmu_reported_names_its_source
    check (billing_fact_state = 'AWAITING_PROVIDER_REPORT'
           or (provider_pricing_observed_at is not null
               and provider_pricing_delivery_event_id is not null)),
  constraint wmu_reported_means_a_pricing_object_arrived
    check (billing_fact_state <> 'PROVIDER_REPORTED' or provider_billable is not null),
  constraint wmu_no_pricing_means_no_pricing_values
    check (billing_fact_state <> 'PROVIDER_REPORTED_NO_PRICING'
           or (provider_billable is null and provider_pricing_model is null
               and provider_pricing_category is null and provider_pricing_type is null)),

  constraint wmu_latest_status_vocabulary
    check (latest_status is null
           or latest_status = any (array['sent','delivered','read','failed','played','unmapped'])),
  constraint wmu_latest_status_names_its_source
    check ((latest_status is null and latest_status_at is null and latest_status_delivery_event_id is null)
        or (latest_status is not null and latest_status_at is not null and latest_status_delivery_event_id is not null))
);

-- One row per outbound message. The send path writes the channel event first;
-- this key is what makes a retried send path idempotent rather than doubling
-- the ledger.
create unique index whatsapp_message_usage_one_per_message
  on public.whatsapp_message_usage (tenant_id, event_id);

create index whatsapp_message_usage_month_idx
  on public.whatsapp_message_usage (tenant_id, sent_at);
create index whatsapp_message_usage_cost_state_idx
  on public.whatsapp_message_usage (tenant_id, cost_state, sent_at);
create index whatsapp_message_usage_template_idx
  on public.whatsapp_message_usage (template_id) where template_id is not null;
create index whatsapp_message_usage_awaiting_idx
  on public.whatsapp_message_usage (tenant_id, sent_at)
  where billing_fact_state = 'AWAITING_PROVIDER_REPORT';

create or replace function public.whatsapp_message_usage_touch()
returns trigger language plpgsql
set search_path to 'public','pg_catalog'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger whatsapp_message_usage_touch
  before update on public.whatsapp_message_usage
  for each row execute function public.whatsapp_message_usage_touch();

comment on table public.whatsapp_message_usage is
  'One row per outbound WhatsApp message: the ledger a "what did WhatsApp cost me this month" screen reads. It holds NO money column and NEXUS holds no rate card, so the only cost answers it can give are the provider''s own billable flag and UNKNOWN. It carries no customer identifier -- the recipient lives on channel_message_events, which end-user roles cannot read.';
comment on column public.whatsapp_message_usage.cost_state is
  'GENERATED, and deliberately a state rather than an amount, so no screen can sum it into something that looks like an invoice. UNKNOWN_AWAITING_PROVIDER_REPORT: no status callback yet. UNKNOWN_PROVIDER_REPORTED_NO_PRICING: a callback arrived with no pricing object. NOT_BILLABLE_PROVIDER_REPORTED: the provider said billable=false -- its fact, not NEXUS''s inference. BILLABLE_AMOUNT_UNKNOWN_NO_RATE_CARD: the provider charged for this and NEXUS does not know how much. None of these is zero.';
comment on column public.whatsapp_message_usage.policy_rule_verification_status is
  'The verification status of the policy rule the send was made under, captured at send time. Today the platform window rules are seeded NOT_VERIFIED, so honest rows read NOT_VERIFIED and a screen must say so rather than implying the send was governed by a verified rule.';
comment on column public.whatsapp_message_usage.template_status_age_at_send is
  'How old NEXUS''s copy of the provider''s template status was at the moment of sending. This is the evidence that somebody asked "how stale is that answer" before a template went out.';