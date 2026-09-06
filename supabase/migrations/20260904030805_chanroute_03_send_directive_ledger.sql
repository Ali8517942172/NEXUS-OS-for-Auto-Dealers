-- chanroute_03_send_directive_ledger
--
-- Where BLOCKED and TEMPLATE_REQUIRED are RECORDED. They are outcomes of a
-- send request, not errors: an engine that asks to message a customer who has
-- opted out has not malfunctioned, and raising at it would make the engine's
-- retry logic paper over a compliance refusal.
--
-- This table is also where "the router must not run before a policy decision
-- exists" is enforced STRUCTURALLY rather than by convention. See the
-- csd_send_requires_policy_decision constraint: a SEND directive that carries
-- no policy decision cannot be written to this table at all. The function is
-- not the only thing standing between an engine and an unpoliced send; the
-- constraint is.

create table if not exists public.channel_send_directive (
  directive_id            uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete restrict,

  -- what was asked for
  requested_by            text not null,
  request_ref             text,
  customer_external_id    text not null,
  intent                  text not null,
  requested_send_form     text not null,

  -- what the router answered
  directive               text not null,
  outcome                 text not null,
  reason_code             text not null,
  reason                  text not null,
  what_would_change_it    text not null,

  -- through which integration, with which credential REFERENCE
  integration_id          uuid references public.channel_registry(integration_id) on delete restrict,
  provider                text,
  channel_type            text,
  external_identifier     text,
  credential_ref          text,
  carrier_rule            text,
  candidates_considered   jsonb not null default '[]'::jsonb,

  -- what to send
  resolved_send_form      text,
  message_body            text,
  template_ref            text,
  template_variables      jsonb,
  template_category_required text,
  template_verification   text,
  media_ref               text,
  media_mime              text,

  -- the policy decision this directive rests on
  policy_decision         text,
  policy_reason_code      text,
  policy_applied_rule_id  uuid,
  policy_rule_verification_status text,
  policy_window_state     text,
  policy_evaluated_at     timestamptz,

  capability_state        text,
  capability_basis        text,
  whatsapp_capability_state text,

  routed_at               timestamptz not null default now(),
  routed_by               text not null,

  -- written back by n8n after the provider call
  send_result             text not null default 'PENDING',
  provider_message_id     text,
  provider_error_code     text,
  provider_error_detail   text,
  result_recorded_at      timestamptz,

  constraint csd_directive_check
    check (directive = any (array['SEND','DO_NOT_SEND'])),

  -- THE STRUCTURAL RULE. A SEND cannot be recorded without a policy decision.
  constraint csd_send_requires_policy_decision
    check (directive <> 'SEND'
           or policy_decision = any (array['FREEFORM_ALLOWED','TEMPLATE_REQUIRED'])),

  -- BLOCKED never sends. Not "usually", not "unless overridden".
  constraint csd_blocked_never_sends
    check (policy_decision is distinct from 'BLOCKED' or directive = 'DO_NOT_SEND'),

  -- A SEND must name the carrier it goes through.
  constraint csd_send_names_a_carrier
    check (directive <> 'SEND'
           or (integration_id is not null and provider is not null and resolved_send_form is not null)),

  -- A template send must carry the reference it is going to use.
  constraint csd_template_send_has_a_ref
    check (outcome <> 'SENDABLE_TEMPLATE' or template_ref is not null),

  constraint csd_send_result_check
    check (send_result = any (array['PENDING','ACCEPTED_BY_PROVIDER','REJECTED_BY_PROVIDER','NOT_ATTEMPTED','TRANSPORT_ERROR'])),

  -- Only a directive that said SEND may ever record a provider attempt.
  constraint csd_only_a_send_gets_a_result
    check (directive = 'SEND' or send_result = any (array['PENDING','NOT_ATTEMPTED'])),

  -- Same shape as channel_registry: this column holds a REFERENCE to a
  -- credential, never the credential.
  constraint csd_credential_ref_is_not_a_secret
    check (credential_ref is null
           or (length(credential_ref) <= 200
               and credential_ref !~ '[[:space:]]'
               and credential_ref !~* '^(eyJ|sk-|sb_secret_|sbp_|service_role|bearer)'))
);

comment on table public.channel_send_directive is
  'One row per send REQUEST, whatever the answer was. A refusal is recorded here exactly as a permission is, which is what makes "we did not message this customer, and here is the rule that stopped us" answerable months later. n8n reads a row, performs the HTTP call, and writes the result back with nexus_record_send_result; the credential itself never appears here, only credential_ref.';

comment on column public.channel_send_directive.candidates_considered is
  'Every active integration the dealership had at routing time, each with whether it was chosen and, if not, which rule excluded it. This is what makes the carrier choice auditable rather than merely deterministic.';

comment on column public.channel_send_directive.send_result is
  'PENDING until n8n reports back. PENDING is not "it was not sent" - it is "NEXUS does not know", and no screen may render it as a non-send. NOT_ATTEMPTED is the terminal state for a DO_NOT_SEND directive.';

create index if not exists channel_send_directive_tenant_routed_idx
  on public.channel_send_directive (tenant_id, routed_at desc);
create index if not exists channel_send_directive_pending_idx
  on public.channel_send_directive (tenant_id, send_result) where send_result = 'PENDING';
create index if not exists channel_send_directive_customer_idx
  on public.channel_send_directive (tenant_id, customer_external_id, routed_at desc);
create unique index if not exists channel_send_directive_request_ref_key
  on public.channel_send_directive (tenant_id, requested_by, request_ref) where request_ref is not null;

alter table public.channel_send_directive enable row level security;

drop policy if exists channel_send_directive_service_role on public.channel_send_directive;
create policy channel_send_directive_service_role on public.channel_send_directive
  for all to service_role using (true) with check (true);

revoke all on public.channel_send_directive from anon, authenticated, public;
grant select, insert, update, delete on public.channel_send_directive to service_role;