-- 3 Sep 2026. Inbound-message idempotency, part 2.
--
-- Part 1 already exists and is sound: public.processed_messages carries a real
-- UNIQUE index (its primary key, (tenant_id, message_id)) and the WhatsApp
-- workflow claims against it with PostgREST
-- `Prefer: resolution=ignore-duplicates`, i.e. INSERT ... ON CONFLICT DO NOTHING.
-- That is index-arbitrated, not an application-level read-then-decide, so it
-- holds under concurrent redelivery. Nothing here changes it.
--
-- What is missing is on the message RECORD. communication_logs has no column
-- carrying the platform's id for the message it represents and no uniqueness of
-- any kind, so any writer that reaches it a second time for the same customer
-- message writes a second row. That has already happened: chat
-- 76703921635478@lid, 31 Aug 2026, ONE claim at 06:48:01 and TWO identical
-- inbound rows at 06:48:23 and 06:48:29 -- the claim gate sits only on the
-- webhook branch, while the `Called by Master Router` sub-workflow entry joins
-- the chain downstream of it.
--
-- This migration adds the key and the constraint. It is deliberately inert until
-- a writer supplies the column: the 108 existing rows are NULL, NULLs are
-- distinct in a btree unique index, and every current n8n node omits the field.

alter table public.communication_logs
  add column if not exists external_message_id text;

comment on column public.communication_logs.external_message_id is
  'The messaging platform''s own id for the message this row records. For WhatsApp/WAHA this is body.payload.id (e.g. false_971501234567@c.us_3EB0815E1ECB77F0BE3512), which is STABLE across webhook redeliveries. It is NOT the delivery id: x-webhook-request-id changes on every delivery attempt and must never be written here. On an outbound row, put the id of the inbound message being replied to, so that (tenant_id, direction, external_message_id) means "the one reply to that message". NULL on rows written before 3 Sep 2026 and on any writer that does not supply it; NULLs are distinct, so those rows are unconstrained.';

-- The constraint. One business message record per platform message, per
-- direction, per dealership. UNIQUE, not a check in application code: two
-- simultaneous deliveries both read "not seen" and both proceed, and only the
-- index arbitrates that.
create unique index if not exists communication_logs_tenant_direction_extmsg_key
  on public.communication_logs (tenant_id, direction, external_message_id);

comment on index public.communication_logs_tenant_direction_extmsg_key is
  'Idempotency constraint for message records. Writers should POST with Prefer: resolution=ignore-duplicates and on_conflict=tenant_id,direction,external_message_id, and treat an empty representation as "already recorded -- stop quietly".';