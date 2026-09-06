-- 5 Sep 2026. communication_logs: make the idempotency key real.
--
-- MEASURED BEFORE-STATE (production dsvuoovivysszdoiorch, 5 Sep 2026):
--   114 rows, 1 tenant, 25 Aug - 5 Sep. external_message_id NOT NULL on ZERO
--   of them. One unique index, communication_logs_tenant_direction_extmsg_key
--   on (tenant_id, direction, external_message_id), non-partial. Because btree
--   NULLs are distinct, an index over a column no writer populates constrains
--   nothing: all 114 rows sit inside it and none of them collide.
--   Seven writer nodes across four n8n workflows POST to /rest/v1/communication_logs
--   with `Prefer: return=minimal` and `retryOnFail: true`, and not one of them
--   sends the column. So a POST that commits server-side but whose response is
--   lost is retried and writes a second row for one real communication, and
--   every count taken off this table over-reports by an unknown amount.
--
-- WHY THE COLUMN STAYS NULLABLE.
--   Not every row here records a message that a provider ever gave an id to.
--   Measured: 2 of 114 rows are channel='system' -- internal notes with no
--   provider leg at all -- and the drip and KYC log nodes record a send made
--   through a node whose response id we have never observed. NOT NULL would
--   force the writers to invent an identifier for those, and an invented
--   per-attempt id is worse than none: it changes on every retry, so it defeats
--   the very index it is being supplied to satisfy while also making the row
--   look identified. This codebase already carries that defect once, at
--   whatsapp_bdc_ai_agent.json:713, where an absent message id becomes
--   'nokey:' + $now.toMillis(). NULL is the honest value for "this
--   communication has no provider id", and NULLs are distinct, so those rows
--   remain unconstrained -- exactly as they are today. Nothing in this
--   migration touches or backfills a single existing row.
--
-- WHY THE INDEX IS NOT PARTIAL.
--   A partial unique index `WHERE external_message_id IS NOT NULL` expresses
--   the same intent and was the obvious choice. It was rejected on a
--   measurement, not a preference. PostgREST's `on_conflict=` parameter emits
--   `ON CONFLICT (col, ...)` with no index predicate, and arbiter inference
--   cannot match a partial index without one. Proved on staging
--   (wwspuxrbiyagnrnzgate) in a rolled-back transaction, with the pre-existing
--   non-partial index dropped first so it could not absorb the inference:
--
--     partial index only, ON CONFLICT (tenant_id, direction, external_message_id)
--       -> 42P10 there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
--   The writers here are n8n HTTP nodes; the only way they can dedupe quietly
--   is `Prefer: resolution=ignore-duplicates` plus `on_conflict=`. Against a
--   partial index that call fails outright, which would leave the n8n node
--   retrying a 42P10 four times and then continuing -- i.e. no log row at all,
--   trading a duplicate for a silent loss. A non-partial unique index over a
--   nullable column gives the identical row-level semantics (present ids
--   collide, absent ids do not) AND is inferable. So: non-partial.
--
-- THE IDENTITY, AND WHAT IT CANNOT INCLUDE.
--   The right identity for an external communication is
--     tenant + provider + integration + external_message_id + direction.
--   This table has tenant_id and direction. It has NO integration_id and NO
--   provider column, and adding either would recreate the exact defect being
--   fixed here -- a column no writer populates. What it does have is `channel`,
--   which separates the id namespaces that actually differ ('whatsapp',
--   'email', 'system'). So the key is
--     (tenant_id, channel, direction, external_message_id).
--   STATED AS OPEN, not papered over: `channel` is not `provider`. WAHA and the
--   WhatsApp Cloud API are both channel='whatsapp'. Two providers on one
--   channel are separated here only by the fact that their id formats do not
--   overlap (a WAHA `false_9715..._3EB0...` is not a `wamid.HBgL...`), which is
--   a property of those providers and not a guarantee this database makes. When
--   communication_logs gains an integration_id with a live writer behind it,
--   this index should be widened to include it.
--
--   channel and direction go into the key through GENERATED columns rather than
--   raw. Two reasons, both already paid for in this repo. Nullable key columns:
--   a writer that omits `channel` would produce a NULL, NULLs are distinct, and
--   that one row would escape the constraint entirely -- the same shape as the
--   inert index above. And case: whatsapp_delivery_events keys on unnormalised
--   status_raw, so `delivered` and `DELIVERED` double-count. coalesce+lower+btrim
--   closes both, and GENERATED ALWAYS means no writer can get it wrong or
--   overwrite it.
--
--   external_message_id itself is NOT normalised. A WhatsApp Cloud wamid is
--   base64 and case-significant; lowercasing it would collide two genuinely
--   different messages. Normalising our own vocabulary is right; normalising a
--   provider's opaque identifier is not.

alter table public.communication_logs
  add column if not exists channel_key text
    generated always as (lower(btrim(coalesce(channel, '')))) stored,
  add column if not exists direction_key text
    generated always as (lower(btrim(coalesce(direction, '')))) stored;

comment on column public.communication_logs.channel_key is
  'Normalised, unwritable copy of channel for the idempotency key only. Never render it: channel is the column a screen reads.';
comment on column public.communication_logs.direction_key is
  'Normalised, unwritable copy of direction for the idempotency key only. Never render it: direction is the column a screen reads.';

-- The shape gate. This is the constraint that stops the fix being undone by the
-- writer it is waiting for. A caller with no provider id must send NULL; it may
-- not mint one. Refused by name: the four synthetic prefixes this codebase has
-- actually produced, and a bare 10- or 13-digit epoch, which is what
-- $now.toMillis() and Date.now() look like. service_role does not bypass a
-- CHECK, and n8n holds service_role, so this bites the only writers there are.
-- The cost is stated honestly: a real provider id shorter than 8 characters
-- would be refused, and with onError=continueRegularOutput on those nodes that
-- means the log row is dropped rather than duplicated. No provider on this
-- channel list mints one that short; if one ever does, widen the bound rather
-- than removing the gate.
alter table public.communication_logs
  add constraint communication_logs_external_message_id_is_a_provider_id
  check (
    external_message_id is null
    or (
      external_message_id !~ '[[:space:]]'
      and length(external_message_id) between 8 and 512
      and external_message_id !~* '^(nokey:|outreach:|exec-|run-|job-)'
      and external_message_id !~ '^[0-9]{10}$'
      and external_message_id !~ '^[0-9]{13}$'
    )
  );

comment on constraint communication_logs_external_message_id_is_a_provider_id
  on public.communication_logs is
  'external_message_id must be an identifier the provider gave us, or NULL. A per-attempt value minted locally changes on every retry, so it defeats the unique index while making the row look identified -- send NULL instead.';

drop index if exists public.communication_logs_tenant_direction_extmsg_key;

create unique index if not exists communication_logs_external_identity_key
  on public.communication_logs (tenant_id, channel_key, direction_key, external_message_id);

comment on index public.communication_logs_external_identity_key is
  'One communication_logs row per (dealership, channel, direction, provider message id). Writers must POST with Prefer: resolution=ignore-duplicates and on_conflict=tenant_id,channel_key,direction_key,external_message_id, and treat an empty representation as "already recorded -- stop quietly". Rows with a NULL external_message_id are not constrained by it, deliberately: see the migration header.';

comment on column public.communication_logs.external_message_id is
  'The messaging platform''s own id for THE MESSAGE THIS ROW RECORDS. Inbound WhatsApp/WAHA: body.payload.id, which is stable across webhook redeliveries. Outbound: the id the provider returned for the message we sent (WAHA sendText -> id / _data.id._serialized; Cloud API -> messages[0].id). This supersedes the 3 Sep 2026 instruction to put the inbound id on an outbound row: that rule cannot be followed by whatsapp_send_dashboard_reply, where a human types a message that is not a reply to anything, and it conflates a message with a reply-to reference. It is NOT a delivery id -- x-webhook-request-id changes on every delivery attempt and must never be written here. NULL when the communication genuinely has no provider id (an internal note, channel=system, a send whose response id we do not observe); NULLs are distinct, so those rows are unconstrained. Never mint a value: see the CHECK constraint on this column.';