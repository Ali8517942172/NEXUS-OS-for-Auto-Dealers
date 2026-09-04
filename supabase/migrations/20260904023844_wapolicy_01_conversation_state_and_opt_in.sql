create table if not exists public.whatsapp_conversation_state (
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  integration_id  uuid not null references public.channel_registry(integration_id) on delete restrict,
  customer_wa_id  text not null,
  last_customer_message_at          timestamptz,
  last_customer_message_external_id text,
  last_customer_message_source      text,
  first_seen_at   timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint whatsapp_conversation_state_pkey
    primary key (tenant_id, integration_id, customer_wa_id),
  constraint wa_conv_customer_id_normalised
    check (customer_wa_id = lower(btrim(customer_wa_id))
           and length(customer_wa_id) between 1 and 120),
  constraint wa_conv_inbound_carries_provenance
    check (last_customer_message_at is null
           or nullif(btrim(coalesce(last_customer_message_source,'')),'') is not null),
  constraint wa_conv_source_needs_a_time
    check (last_customer_message_source is null or last_customer_message_at is not null)
);

comment on table public.whatsapp_conversation_state is
$c$One row per (dealership, registered channel, customer WhatsApp identity).
Holds MEASURED FACTS only. Absence of a row means NEXUS has never observed
this conversation - which is UNKNOWN, not "the window is closed", and the
decision function reports it as unknown.$c$;

comment on column public.whatsapp_conversation_state.last_customer_message_at is
$c$When the customer last messaged us. The service window is DERIVED from this
column plus the window-duration rule in policy_rule at the moment of the
decision. It is deliberately NOT stored as an expiry column:

  1. An expiry column is a second derivation of a figure that already has one.
     Supersede the window rule in policy_rule (Meta changes it, or somebody
     finally verifies it) and every stored expiry silently keeps the old
     arithmetic, with nothing in the row saying which rule produced it. The
     derived form carries the rule id in every answer.
  2. A stored expiry is only correct until the clock passes it. Nothing
     re-writes rows on a timer, so a stale OPEN would read as permission.
  3. It costs nothing to derive. The decision reads the window rule anyway;
     the expiry is one interval addition on a row already in hand.

The trade accepted: a caller who wants the expiry must call the decision
function or the view, not read a column. That is the intended direction.$c$;

comment on column public.whatsapp_conversation_state.last_customer_message_external_id is
$c$The WhatsApp message id that opened the window - the same identifier
communication_logs.external_message_id carries. This is the evidence behind
the timestamp; without it "the window is open" is an assertion.$c$;

create index if not exists whatsapp_conversation_state_tenant_recent_idx
  on public.whatsapp_conversation_state (tenant_id, last_customer_message_at desc);

create table if not exists public.whatsapp_opt_in_event (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete restrict,
  integration_id  uuid not null references public.channel_registry(integration_id) on delete restrict,
  customer_wa_id  text not null,
  event           text not null,
  occurred_at     timestamptz not null,
  mechanism       text not null,
  evidence_kind   text not null,
  evidence_ref    text not null,
  recorded_by     text not null,
  recorded_at     timestamptz not null default now(),
  notes           text,
  constraint wa_optin_event_check
    check (event in ('OPT_IN','OPT_OUT')),
  constraint wa_optin_customer_id_normalised
    check (customer_wa_id = lower(btrim(customer_wa_id))
           and length(customer_wa_id) between 1 and 120),
  constraint wa_optin_mechanism_check
    check (mechanism in ('CUSTOMER_MESSAGE','WEB_FORM','IN_STORE_SIGNED',
                         'PHONE_RECORDED','IMPORTED_FROM_SOURCE_SYSTEM','OPERATOR_RECORDED')),
  constraint wa_optin_evidence_kind_check
    check (evidence_kind in ('WHATSAPP_MESSAGE_ID','COMMUNICATION_LOG_ID','FORM_SUBMISSION_ID',
                             'DOCUMENT_REF','SOURCE_SYSTEM_RECORD_ID','AUDIT_LOG_ID')),
  constraint wa_optin_evidence_not_blank
    check (btrim(evidence_ref) <> '' and btrim(recorded_by) <> ''),
  constraint wa_optin_import_names_a_system
    check (mechanism <> 'IMPORTED_FROM_SOURCE_SYSTEM'
           or evidence_kind = 'SOURCE_SYSTEM_RECORD_ID')
);

comment on table public.whatsapp_opt_in_event is
$c$Append-only ledger of marketing consent for a WhatsApp identity. Current
state is DERIVED as the latest event, never stored: OPTED_IN, OPTED_OUT, or -
when this table holds nothing for the conversation - OPT_IN_UNKNOWN.

OPT_IN_UNKNOWN is not permission. No path in whatsapp_policy_decision()
treats it as one, and there is no "assume opted in" configuration anywhere.$c$;

create index if not exists whatsapp_opt_in_event_latest_idx
  on public.whatsapp_opt_in_event (tenant_id, integration_id, customer_wa_id, occurred_at desc, recorded_at desc);

create or replace function public.whatsapp_opt_in_event_append_only()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog'
as $f$
begin
  raise exception using
    errcode = '0A000',
    message = 'whatsapp_opt_in_event is append-only; consent history may not be rewritten.',
    hint    = 'To withdraw consent insert an OPT_OUT event. To correct a mistaken row insert a correcting event and explain it in notes. Deleting the evidence that a customer opted out is the failure this table exists to prevent.';
  return null;
end;
$f$;

drop trigger if exists whatsapp_opt_in_event_no_rewrite on public.whatsapp_opt_in_event;
create trigger whatsapp_opt_in_event_no_rewrite
  before update or delete on public.whatsapp_opt_in_event
  for each row execute function public.whatsapp_opt_in_event_append_only();

alter table public.whatsapp_conversation_state enable row level security;
alter table public.whatsapp_opt_in_event        enable row level security;

drop policy if exists whatsapp_conversation_state_service_role_all on public.whatsapp_conversation_state;
create policy whatsapp_conversation_state_service_role_all
  on public.whatsapp_conversation_state for all to service_role using (true) with check (true);
drop policy if exists whatsapp_conversation_state_deny_anon on public.whatsapp_conversation_state;
create policy whatsapp_conversation_state_deny_anon
  on public.whatsapp_conversation_state as restrictive for all to anon using (false) with check (false);

drop policy if exists whatsapp_opt_in_event_service_role_all on public.whatsapp_opt_in_event;
create policy whatsapp_opt_in_event_service_role_all
  on public.whatsapp_opt_in_event for all to service_role using (true) with check (true);
drop policy if exists whatsapp_opt_in_event_deny_anon on public.whatsapp_opt_in_event;
create policy whatsapp_opt_in_event_deny_anon
  on public.whatsapp_opt_in_event as restrictive for all to anon using (false) with check (false);