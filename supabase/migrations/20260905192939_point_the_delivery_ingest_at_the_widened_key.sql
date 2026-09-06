create or replace function public.whatsapp_record_delivery_status(
  p_integration_id             uuid,
  p_provider_message_id        text,
  p_status_raw                 text,
  p_status_at                  timestamptz,
  p_provider_payload           jsonb,
  p_recipient_wa_id            text default null,
  p_conversation_id            text default null,
  p_conversation_origin_type   text default null,
  p_conversation_expiration_at timestamptz default null,
  p_pricing_billable           boolean default null,
  p_pricing_model              text default null,
  p_pricing_category           text default null,
  p_pricing_type               text default null,
  p_errors                     jsonb default null,
  p_received_at                timestamptz default now())
returns table(delivery_event_id uuid, tenant_id uuid, first_seen boolean,
              link_state text, usage_updated boolean)
language plpgsql security definer
set search_path to 'public','pg_catalog'
as $$
#variable_conflict use_column
declare
  v_tenant uuid; v_ctype text; v_cstatus text; v_tstatus text; v_provider text;
  v_ext text := btrim(coalesce(p_provider_message_id,''));
  v_raw text := btrim(coalesce(p_status_raw,''));
  v_key text; v_norm text;
  v_event uuid; v_id uuid; v_new boolean := false; v_applied boolean := false;
  v_link text;
  v_known text[] := array['sent','delivered','read','failed','played'];
begin
  perform public.whatsapp_refuse_end_user_role('whatsapp_record_delivery_status');

  if v_ext = '' then
    raise exception 'whatsapp_record_delivery_status: statuses[].id (the wamid of the message NEXUS sent) is required. Without it the callback cannot be deduplicated or attributed.' using errcode='22023';
  end if;
  if v_raw = '' then
    raise exception 'whatsapp_record_delivery_status: statuses[].status is required.' using errcode='22023';
  end if;
  if p_status_at is null then
    raise exception 'whatsapp_record_delivery_status: statuses[].timestamp is required.' using errcode='22023';
  end if;
  if p_provider_payload is null or jsonb_typeof(p_provider_payload) <> 'object' then
    raise exception 'whatsapp_record_delivery_status: the verbatim statuses[] element is required. A billing fact with no provider payload behind it is unauditable.' using errcode='22023';
  end if;

  select cr.tenant_id, cr.channel_type, cr.status, t.status
    into v_tenant, v_ctype, v_cstatus, v_tstatus
    from public.channel_registry cr join public.tenants t on t.id = cr.tenant_id
   where cr.integration_id = p_integration_id;
  if v_tenant is null then
    raise exception 'whatsapp_record_delivery_status: integration % is not in channel_registry. An unregistered channel writes nothing.', p_integration_id using errcode='23503';
  end if;
  if v_cstatus <> 'active' or v_tstatus <> 'active' then
    raise exception 'whatsapp_record_delivery_status: channel status % / dealership status %.', v_cstatus, v_tstatus using errcode='42501';
  end if;

  v_provider := case v_ctype
                  when 'whatsapp_waha_session'          then 'waha'
                  when 'whatsapp_cloud_phone_number_id' then 'whatsapp_cloud'
                end;
  if v_provider is null then
    raise exception 'whatsapp_record_delivery_status: no provider mapping for channel_type %.', v_ctype using errcode='22023';
  end if;

  v_key  := lower(v_raw);
  v_norm := case when v_key = any (v_known) then v_key else 'unmapped' end;

  select e.event_id into v_event from public.channel_message_events e
   where e.tenant_id = v_tenant and e.direction = 'outbound' and e.external_message_id = v_ext;

  insert into public.whatsapp_delivery_events as w
    (tenant_id, integration_id, provider, provider_message_id, event_id, link_state, linked_at,
     status, status_raw, status_at, recipient_wa_id,
     conversation_id, conversation_origin_type, conversation_expiration_at,
     pricing_billable, pricing_model, pricing_category, pricing_type,
     errors, provider_payload, received_at)
  values
    (v_tenant, p_integration_id, v_provider, v_ext, v_event,
     case when v_event is null then 'UNLINKED_NO_OUTBOUND_EVENT' else 'LINKED' end,
     case when v_event is null then null else now() end,
     v_norm, v_raw, p_status_at, nullif(btrim(coalesce(p_recipient_wa_id,'')),''),
     p_conversation_id, p_conversation_origin_type, p_conversation_expiration_at,
     p_pricing_billable, p_pricing_model, p_pricing_category, p_pricing_type,
     p_errors, p_provider_payload, coalesce(p_received_at, now()))
  on conflict on constraint whatsapp_delivery_events_idempotency do nothing
  returning w.delivery_event_id into v_id;

  if v_id is not null then
    v_new := true;
  else
    select e.delivery_event_id into v_id from public.whatsapp_delivery_events e
     where e.tenant_id = v_tenant
       and e.integration_id = p_integration_id
       and e.provider_message_id = v_ext
       and e.status_key = v_key;
  end if;

  if v_id is null then
    raise exception
      'whatsapp_record_delivery_status: the insert was refused as a duplicate but no existing row matches (%, %, %, %). The ingest lookup and the idempotency constraint disagree.',
      v_tenant, p_integration_id, v_ext, v_key using errcode = 'XX000';
  end if;

  if v_new then
    v_applied := public.whatsapp_apply_delivery_to_usage(v_id);
  end if;

  select e.link_state into v_link from public.whatsapp_delivery_events e where e.delivery_event_id = v_id;
  return query select v_id, v_tenant, v_new, v_link, v_applied;
end;
$$;

revoke all on function public.whatsapp_record_delivery_status(uuid,text,text,timestamptz,jsonb,text,text,text,timestamptz,boolean,text,text,text,jsonb,timestamptz) from anon, authenticated, public;
grant execute on function public.whatsapp_record_delivery_status(uuid,text,text,timestamptz,jsonb,text,text,text,timestamptz,boolean,text,text,text,jsonb,timestamptz) to service_role;