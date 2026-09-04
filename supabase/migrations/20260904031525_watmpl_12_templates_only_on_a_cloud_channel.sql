-- A template is a Cloud API object. WAHA drives a personal WhatsApp session and
-- has no template concept at all, so a template row hanging off a WAHA
-- integration would be NEXUS holding an object the channel cannot have. The
-- integration must also belong to the same dealership as the template.
create or replace function public.whatsapp_templates_guard_channel()
returns trigger language plpgsql
set search_path to 'public','pg_catalog'
as $$
declare v_ctype text; v_tenant uuid;
begin
  if new.integration_id is null then
    return new;
  end if;

  select cr.channel_type, cr.tenant_id into v_ctype, v_tenant
    from public.channel_registry cr where cr.integration_id = new.integration_id;

  if v_ctype is null then
    raise exception 'whatsapp_templates: integration % is not in channel_registry.', new.integration_id using errcode='23503';
  end if;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'whatsapp_templates: integration % belongs to dealership %, not %.',
      new.integration_id, v_tenant, new.tenant_id using errcode='42501';
  end if;
  if v_ctype <> 'whatsapp_cloud_phone_number_id' then
    raise exception
      'whatsapp_templates: integration % is a % channel. Templates exist only on the WhatsApp Cloud API; a WAHA session has no template concept, so NEXUS will not hold a template against one.',
      new.integration_id, v_ctype using errcode='22023';
  end if;

  return new;
end;
$$;

create trigger whatsapp_templates_guard_channel
  before insert or update on public.whatsapp_templates
  for each row execute function public.whatsapp_templates_guard_channel();

revoke all on function public.whatsapp_templates_guard_channel() from anon, authenticated, public;
grant execute on function public.whatsapp_templates_guard_channel() to service_role;