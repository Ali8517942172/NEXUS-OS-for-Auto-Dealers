-- Meta's status callbacks, one row per (message, status), append-only.
--
-- On the adapter agent's recommendation this table foreign-keys to
-- channel_message_events.event_id -- the outbound message found via
-- (tenant_id, direction='outbound', external_message_id = statuses[].id).
-- Taken up, with ONE change: the FK is NULLABLE and the row says why.
-- A NOT NULL FK would force the ingest to either drop a callback whose outbound
-- event has not landed yet (losing a billing fact the provider reported and will
-- not repeat) or fabricate an outbound event (inventing a message that was never
-- sent). Both are worse than an honestly unlinked row. link_state names which
-- case a row is in, and the wamid is always kept so it can be linked later.

create table public.whatsapp_delivery_events (
  delivery_event_id           uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete restrict,
  integration_id              uuid not null references public.channel_registry(integration_id) on delete restrict,
  provider                    text not null default 'whatsapp_cloud',

  provider_message_id         text not null,
  event_id                    uuid references public.channel_message_events(event_id) on delete restrict,
  link_state                  text not null,
  linked_at                   timestamptz,

  status                      text not null,
  status_raw                  text not null,
  status_at                   timestamptz not null,
  recipient_wa_id             text,

  conversation_id             text,
  conversation_origin_type    text,
  conversation_expiration_at  timestamptz,

  pricing_billable            boolean,
  pricing_model               text,
  pricing_category            text,
  pricing_type                text,
  pricing_reported            boolean generated always as
                                (pricing_billable is not null
                                 or nullif(btrim(coalesce(pricing_model,'')),'') is not null
                                 or nullif(btrim(coalesce(pricing_category,'')),'') is not null) stored,

  errors                      jsonb,
  provider_payload            jsonb not null,

  received_at                 timestamptz not null default now(),
  recorded_at                 timestamptz not null default now(),

  constraint wde_provider_vocabulary
    check (provider = any (array['whatsapp_cloud','waha'])),

  -- WAHA reports acknowledgements and no billing whatsoever. Copying a pricing
  -- field onto a WAHA row would be NEXUS inventing a provider-reported fact.
  constraint wde_waha_reports_no_billing
    check (provider <> 'waha'
           or (pricing_billable is null and pricing_model is null
               and pricing_category is null and pricing_type is null
               and conversation_id is null and conversation_origin_type is null
               and conversation_expiration_at is null)),

  constraint wde_message_id_shape
    check (provider_message_id = btrim(provider_message_id)
           and length(provider_message_id) between 1 and 300),

  constraint wde_status_vocabulary
    check (status = any (array['sent','delivered','read','failed','played','unmapped'])),
  constraint wde_status_raw_present
    check (nullif(btrim(status_raw),'') is not null and length(status_raw) <= 100),
  -- Forward-compatible without inventing: a status string this vocabulary does
  -- not know is recorded as 'unmapped' with the provider's word kept verbatim,
  -- rather than being coerced into the nearest known value or dropped.
  constraint wde_unmapped_iff_unknown_word
    check ((status = 'unmapped') = (lower(btrim(status_raw)) <> all (array['sent','delivered','read','failed','played']))),

  constraint wde_link_state_vocabulary
    check (link_state = any (array['LINKED','UNLINKED_NO_OUTBOUND_EVENT'])),
  constraint wde_link_state_matches_the_fk
    check ((event_id is not null and link_state = 'LINKED' and linked_at is not null)
        or (event_id is null and link_state = 'UNLINKED_NO_OUTBOUND_EVENT' and linked_at is null)),

  constraint wde_recipient_is_digits_or_null
    check (recipient_wa_id is null or recipient_wa_id ~ '^[0-9]{6,20}$'),

  constraint wde_errors_is_an_array
    check (errors is null or jsonb_typeof(errors) = 'array'),
  constraint wde_payload_is_an_object
    check (jsonb_typeof(provider_payload) = 'object' and length(provider_payload::text) <= 20000),

  constraint wde_refs_are_not_secrets
    check ((conversation_id is null or (length(conversation_id) <= 200
             and conversation_id !~* '^(eyJ|sk-|sb_secret_|sbp_|service_role|bearer)'))
       and (pricing_model is null or length(pricing_model) <= 100)
       and (pricing_category is null or length(pricing_category) <= 100)
       and (pricing_type is null or length(pricing_type) <= 100)
       and (conversation_origin_type is null or length(conversation_origin_type) <= 100))
);

-- The duplicate-callback guard. Meta retries a callback with the same body; a
-- message reaches each status once. Keying on (dealership, wamid, the
-- provider's own status word) means a retry collides and is refused, so a
-- redelivered 'delivered' cannot become two delivered events -- and therefore
-- cannot double-count a conversation charge.
create unique index whatsapp_delivery_events_idempotency_key
  on public.whatsapp_delivery_events (tenant_id, provider_message_id, status_raw);

create index whatsapp_delivery_events_message_idx
  on public.whatsapp_delivery_events (tenant_id, provider_message_id, status_at);
create index whatsapp_delivery_events_event_idx
  on public.whatsapp_delivery_events (event_id) where event_id is not null;
create index whatsapp_delivery_events_unlinked_idx
  on public.whatsapp_delivery_events (tenant_id, integration_id, provider_message_id)
  where link_state = 'UNLINKED_NO_OUTBOUND_EVENT';

-- The FK alone proves the referenced event exists; it does not prove it belongs
-- to the same dealership, or that it is the OUTBOUND message this status is
-- about. channel_message_events is another agent's table, so rather than add a
-- composite key to it, that is enforced here.
create or replace function public.whatsapp_delivery_events_guard_link()
returns trigger language plpgsql
set search_path to 'public','pg_catalog'
as $$
declare
  v_tenant uuid; v_dir text; v_ext text; v_integration uuid;
begin
  if new.event_id is null then
    return new;
  end if;

  select e.tenant_id, e.direction, e.external_message_id, e.integration_id
    into v_tenant, v_dir, v_ext, v_integration
    from public.channel_message_events e
   where e.event_id = new.event_id;

  if v_tenant is distinct from new.tenant_id then
    raise exception
      'whatsapp_delivery_events: event % belongs to dealership %, not %. A status callback may only be linked to a message the same dealership sent.',
      new.event_id, v_tenant, new.tenant_id using errcode = '42501';
  end if;
  if v_dir <> 'outbound' then
    raise exception
      'whatsapp_delivery_events: event % is direction %, not outbound. Delivery statuses describe messages NEXUS sent.',
      new.event_id, v_dir using errcode = '22023';
  end if;
  if v_ext is distinct from new.provider_message_id then
    raise exception
      'whatsapp_delivery_events: event % carries external_message_id %, but this callback is about %. Linking them would attribute one message''s delivery and billing to another.',
      new.event_id, coalesce(v_ext,'(null)'), new.provider_message_id using errcode = '22023';
  end if;
  if v_integration is distinct from new.integration_id then
    raise exception
      'whatsapp_delivery_events: event % was sent through integration %, but this callback arrived on %.',
      new.event_id, v_integration, new.integration_id using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger whatsapp_delivery_events_guard_link
  before insert or update on public.whatsapp_delivery_events
  for each row execute function public.whatsapp_delivery_events_guard_link();

-- Append-only. The single exception is linking an orphan callback to the
-- outbound event once that event exists: event_id NULL -> value, and nothing
-- else on the row may move. A provider-reported fact is never edited.
create or replace function public.whatsapp_delivery_events_append_only()
returns trigger language plpgsql
set search_path to 'public','pg_catalog'
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'whatsapp_delivery_events is append-only: a provider-reported delivery fact is never deleted. It is the evidence behind what messaging cost.'
      using errcode = '42501';
  end if;

  if old.event_id is not null then
    raise exception
      'whatsapp_delivery_events %: already linked to event %. Re-pointing a callback at a different message would move a billing fact between messages.',
      old.delivery_event_id, old.event_id using errcode = '42501';
  end if;

  if new.event_id is null then
    raise exception
      'whatsapp_delivery_events %: the only permitted update is linking an unlinked callback to its outbound event.',
      old.delivery_event_id using errcode = '42501';
  end if;

  if (new.tenant_id, new.integration_id, new.provider, new.provider_message_id,
      new.status, new.status_raw, new.status_at, new.recipient_wa_id,
      new.conversation_id, new.conversation_origin_type, new.conversation_expiration_at,
      new.pricing_billable, new.pricing_model, new.pricing_category, new.pricing_type,
      new.errors, new.provider_payload, new.received_at, new.recorded_at)
     is distinct from
     (old.tenant_id, old.integration_id, old.provider, old.provider_message_id,
      old.status, old.status_raw, old.status_at, old.recipient_wa_id,
      old.conversation_id, old.conversation_origin_type, old.conversation_expiration_at,
      old.pricing_billable, old.pricing_model, old.pricing_category, old.pricing_type,
      old.errors, old.provider_payload, old.received_at, old.recorded_at) then
    raise exception
      'whatsapp_delivery_events %: linking may set event_id, link_state and linked_at and nothing else. What the provider reported does not change because NEXUS later worked out which message it was about.',
      old.delivery_event_id using errcode = '42501';
  end if;

  new.linked_at := coalesce(new.linked_at, now());
  new.link_state := 'LINKED';
  return new;
end;
$$;

create trigger whatsapp_delivery_events_append_only
  before update or delete on public.whatsapp_delivery_events
  for each row execute function public.whatsapp_delivery_events_append_only();

comment on table public.whatsapp_delivery_events is
  'Append-only record of WhatsApp status callbacks. One row per (dealership, wamid, provider status word) -- that unique key is what stops a retried callback double-counting a conversation charge. pricing_* and conversation_* are copied VERBATIM from the provider and are the only billing facts NEXUS holds; NEXUS never derives a money amount from them because it holds no rate card.';
comment on column public.whatsapp_delivery_events.link_state is
  'LINKED means event_id points at the outbound channel_message_events row this status is about. UNLINKED_NO_OUTBOUND_EVENT means the callback arrived and NEXUS has no outbound event for that wamid -- a race, a backfill, or a message another system sent on this number. The row is kept either way: a provider-reported billing fact is not discarded because NEXUS cannot yet place it.';
comment on column public.whatsapp_delivery_events.pricing_billable is
  'The provider''s own billable flag, verbatim. FALSE is a provider-reported fact that this message was not charged. NULL means the callback carried no pricing object -- unknown, which is not the same as free and must never be rendered as zero.';
comment on column public.whatsapp_delivery_events.provider_payload is
  'The verbatim statuses[] element as received. Kept so a billing dispute is settled against what the provider actually said, not against NEXUS''s reading of it.';