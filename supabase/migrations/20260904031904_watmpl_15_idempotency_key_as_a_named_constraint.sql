-- ON CONFLICT ON CONSTRAINT needs a real constraint, not a bare unique index.
-- Promoting the index (channel_message_events keys its own idempotency the same
-- way) means the ingest names the guard it relies on instead of re-describing it.
alter table public.whatsapp_delivery_events
  add constraint whatsapp_delivery_events_idempotency
  unique using index whatsapp_delivery_events_idempotency_key;