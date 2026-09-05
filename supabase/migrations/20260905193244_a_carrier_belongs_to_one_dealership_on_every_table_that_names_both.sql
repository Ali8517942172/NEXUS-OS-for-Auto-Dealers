alter table public.channel_message_events
  add constraint cme_carrier_belongs_to_the_tenant
  foreign key (integration_id, tenant_id)
  references public.channel_registry(integration_id, tenant_id) on delete restrict;

alter table public.whatsapp_conversation_state
  add constraint wcs_carrier_belongs_to_the_tenant
  foreign key (integration_id, tenant_id)
  references public.channel_registry(integration_id, tenant_id) on delete restrict;

alter table public.whatsapp_customer_message_seen
  add constraint wcms_carrier_belongs_to_the_tenant
  foreign key (integration_id, tenant_id)
  references public.channel_registry(integration_id, tenant_id) on delete restrict;

alter table public.whatsapp_message_usage
  add constraint wmu_carrier_belongs_to_the_tenant
  foreign key (integration_id, tenant_id)
  references public.channel_registry(integration_id, tenant_id) on delete restrict;

alter table public.whatsapp_opt_in_event
  add constraint woie_carrier_belongs_to_the_tenant
  foreign key (integration_id, tenant_id)
  references public.channel_registry(integration_id, tenant_id) on delete restrict;

alter table public.whatsapp_templates
  add constraint wt_carrier_belongs_to_the_tenant
  foreign key (integration_id, tenant_id)
  references public.channel_registry(integration_id, tenant_id) on delete restrict;