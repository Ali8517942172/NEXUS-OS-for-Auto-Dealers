-- The provider-neutral message-event ledger.
--
-- WHAT THIS IS NOT: it is not a message store. There is no body/text column and
-- there never will be one -- `communication_logs` owns the words a customer
-- said, and CLAUDE.md's "one figure, one derivation" applies to text too. This
-- table records only that a message with a given external id existed, which
-- dealership it belonged to, which registered channel carried it, and how we
-- know the event was genuine.
--
-- WHY IT IS NOT `processed_messages`: that table is the WAHA-era claim -- a
-- message id and a chat id, with the provider implied by a `source` string and
-- no link to a registered channel. It cannot express (a) which integration row
-- carried the event, (b) that the origin was cryptographically proven rather
-- than assumed, or (c) the outbound side, which is what a delivery callback
-- needs to correlate against. Those three are exactly what the Cloud API adapter
-- exists to gain. `processed_messages` is left alone and still live.
create table if not exists public.channel_message_events (
  event_id               uuid primary key default gen_random_uuid(),

  -- Derived from the channel registry at write time, never accepted from a
  -- caller. See nexus_record_channel_event().
  tenant_id              uuid not null references public.tenants(id)            on delete restrict,
  integration_id         uuid not null references public.channel_registry(integration_id) on delete restrict,

  provider               text not null,
  channel_type           text not null,
  direction              text not null,

  -- The provider's own stable per-message identifier.
  --   waha           : body.payload.id
  --   whatsapp_cloud : entry[].changes[].value.messages[].id  ("wamid.…"), and
  --                    for outbound, the id Meta returns from POST /messages.
  -- NEVER a per-delivery id: WAHA's x-webhook-request-id and body.id both change
  -- per delivery (proven 3 Sep 2026 on executions 9427/9428) and Meta documents
  -- that duplicate notifications happen.
  external_message_id    text not null,

  -- Opaque. WAHA: "…@c.us" or "…@lid". Cloud: messages[].from / contacts[].wa_id,
  -- which is usually an E.164 phone number but may be a business-scoped user id.
  customer_external_id   text,

  -- Populated ONLY when the provider actually supplied a phone number. A WAHA
  -- "@lid" chat with no _data.Info.SenderAlt has no phone number, and the
  -- honest value is NULL. Never synthesise one from the lid digits -- that is
  -- how the phone-tail identity collision happened.
  customer_phone         text,

  -- Neither provider supplies a conversation id on an INBOUND message. WAHA has
  -- no such concept; Meta's conversation object appears only on statuses[], and
  -- from Cloud API v24.0 is omitted there too except for free-entry-point
  -- conversations. NULL here is an honest absence, not a missing implementation.
  conversation_id        text,

  message_kind           text not null,

  -- A reference, never bytes. WAHA hands a fetchable URL; Cloud hands a media
  -- id that must be exchanged for a 5-minute URL with an authenticated call.
  media_ref              text,
  media_mime             text,
  media_sha256           text,          -- Cloud supplies this; WAHA does not.

  -- Cloud: entry[].id, the WhatsApp Business Account id. WAHA: NULL.
  provider_account_id    text,

  -- WAHA: x-webhook-request-id. Cloud: none is documented. Kept for forensics
  -- (it is how the two-WAHA-senders finding was made) and is deliberately NOT
  -- part of any unique key.
  provider_delivery_ref  text,

  -- How we know the event came from who it claims to.
  --   hmac_sha256_x_hub : Meta signed the raw bytes and we verified them.
  --   shared_header     : a copyable shared secret header (WAHA today).
  --   unverified        : nothing proved the origin.
  origin_verified        text not null,

  received_at            timestamptz not null,
  recorded_at            timestamptz not null default now(),

  constraint channel_message_events_provider_check
    check (provider = any (array['waha','whatsapp_cloud'])),
  constraint channel_message_events_channel_type_check
    check (channel_type = any (array['whatsapp_waha_session','whatsapp_cloud_phone_number_id'])),
  constraint channel_message_events_provider_matches_channel_type
    check ((provider = 'waha'           and channel_type = 'whatsapp_waha_session')
        or (provider = 'whatsapp_cloud' and channel_type = 'whatsapp_cloud_phone_number_id')),
  constraint channel_message_events_direction_check
    check (direction = any (array['inbound','outbound'])),
  constraint channel_message_events_extmsg_shape
    check (external_message_id = btrim(external_message_id)
           and length(external_message_id) between 1 and 300),
  constraint channel_message_events_message_kind_check
    check (message_kind = any (array[
      'text','image','audio','video','document','sticker','location','contacts',
      'interactive','button','order','reaction','system','unsupported'])),
  -- Structural expression of the honest-absence rule: a phone number is digits
  -- or it is NULL. There is no third option and no placeholder.
  constraint channel_message_events_customer_phone_is_digits_or_null
    check (customer_phone is null or customer_phone ~ '^[0-9]{6,20}$'),
  constraint channel_message_events_origin_verified_check
    check (origin_verified = any (array['hmac_sha256_x_hub','shared_header','unverified'])),
  -- A whatsapp_cloud row may only exist if Meta's signature was verified. The
  -- workflow is supposed to refuse first; this is the backstop that makes the
  -- refusal structural rather than a matter of node ordering.
  constraint channel_message_events_cloud_requires_signature
    check (provider <> 'whatsapp_cloud' or origin_verified = 'hmac_sha256_x_hub'),
  constraint channel_message_events_media_ref_is_a_reference
    check (media_ref is null or (length(media_ref) <= 500 and media_ref !~ '^data:')),

  -- Same shape as communication_logs_tenant_direction_extmsg_key. Direction is
  -- load-bearing: an outbound send and a later inbound reply can in principle
  -- carry ids from different id-spaces, and the outbound row is the anchor a
  -- delivery-status callback correlates to.
  constraint channel_message_events_tenant_direction_extmsg_key
    unique (tenant_id, direction, external_message_id)
);

create index if not exists channel_message_events_tenant_received_idx
  on public.channel_message_events (tenant_id, received_at desc);
create index if not exists channel_message_events_integration_idx
  on public.channel_message_events (integration_id);
create index if not exists channel_message_events_customer_idx
  on public.channel_message_events (tenant_id, customer_external_id);

comment on table public.channel_message_events is
  'Provider-neutral WhatsApp message-event ledger for the channel adapters. Holds identity, routing and origin-proof only; the message text lives in communication_logs and the delivery-status transitions live in whatsapp_delivery_events. Written exclusively through nexus_record_channel_event(), which derives tenant_id from channel_registry so that no caller can name a dealership.';
comment on column public.channel_message_events.external_message_id is
  'Provider stable message id. waha: body.payload.id. whatsapp_cloud: value.messages[].id (wamid), and the id returned by POST /<phone_number_id>/messages for outbound. Never a per-delivery id.';
comment on column public.channel_message_events.conversation_id is
  'NULL on inbound for both providers today. WAHA has no conversation concept; Meta exposes conversation only on statuses[] and omits it from Cloud API v24.0 except free-entry-point conversations. An honest absence.';
comment on column public.channel_message_events.customer_phone is
  'NULL when the provider did not supply a phone number (e.g. a WAHA @lid chat with no SenderAlt). Never synthesised.';
comment on column public.channel_message_events.origin_verified is
  'hmac_sha256_x_hub = Meta signed the raw request bytes and we verified them constant-time. shared_header = a copyable secret header. unverified = nothing proved origin. A whatsapp_cloud row is CHECK-constrained to the first value.';