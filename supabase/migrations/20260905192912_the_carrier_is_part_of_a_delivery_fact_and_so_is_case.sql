alter table public.whatsapp_delivery_events
  add column status_key text
  generated always as (lower(btrim(status_raw))) stored;

comment on column public.whatsapp_delivery_events.status_key is
  'The provider''s status word, normalised. Identity only -- status_raw is the evidence and keeps the provider''s exact spelling.';

alter table public.whatsapp_delivery_events
  drop constraint whatsapp_delivery_events_idempotency;

create unique index whatsapp_delivery_events_idempotency_key
  on public.whatsapp_delivery_events
     (tenant_id, integration_id, provider_message_id, status_key);

alter table public.whatsapp_delivery_events
  add constraint whatsapp_delivery_events_idempotency
  unique using index whatsapp_delivery_events_idempotency_key;

alter table public.whatsapp_delivery_events
  add constraint wde_carrier_belongs_to_the_tenant
  foreign key (integration_id, tenant_id)
  references public.channel_registry(integration_id, tenant_id)
  on delete restrict;