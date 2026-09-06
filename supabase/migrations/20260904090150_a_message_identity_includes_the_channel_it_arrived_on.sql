-- The message identity was (tenant, direction, external_message_id), omitting the
-- channel. Proved 4 Sep: with a WAHA channel and a Cloud channel both active on one
-- dealership, recording an id on the WAHA channel made the SAME id on the Cloud
-- channel return first_seen=false -- silently dropped. That is the denial of service
-- CLAUDE.md warns about (claiming a wamid suppresses the genuine Meta delivery and
-- nothing appears broken), reachable structurally rather than only by claiming a
-- signature. WAHA ids and wamids are different id spaces, so including the channel
-- costs nothing real; and the live doubled-sender case -- two WAHA hosts posting one
-- payload.id -- resolves to ONE integration, so that dedupe is unaffected (proved).
alter table public.channel_message_events
  drop constraint channel_message_events_tenant_direction_extmsg_key;
alter table public.channel_message_events
  add constraint channel_message_events_channel_direction_extmsg_key
  unique (tenant_id, integration_id, direction, external_message_id);

create or replace function public.nexus_record_channel_event(
  p_integration_id uuid, p_direction text, p_external_message_id text, p_origin_verified text,
  p_received_at timestamptz default now(), p_customer_external_id text default null,
  p_customer_phone text default null, p_conversation_id text default null,
  p_message_kind text default 'text', p_media_ref text default null,
  p_media_mime text default null, p_media_sha256 text default null,
  p_provider_account_id text default null, p_provider_delivery_ref text default null)
returns table(event_id uuid, tenant_id uuid, first_seen boolean)
language plpgsql security definer set search_path to 'public','pg_catalog'
as $function$
declare
  v_tenant uuid; v_ctype text; v_cstatus text; v_tstatus text; v_provider text;
  v_dir text := lower(btrim(coalesce(p_direction, '')));
  v_ext text := btrim(coalesce(p_external_message_id, ''));
  v_event uuid; v_new boolean := false;
begin
  if coalesce(current_setting('role', true), '') in ('authenticated', 'anon') then
    raise exception
      'nexus_record_channel_event: refused for end-user role %. Channel events are written by the backend only.',
      current_setting('role', true) using errcode = '42501';
  end if;

  if v_ext = '' then
    raise exception
      'nexus_record_channel_event: external_message_id is required. Do not substitute a per-delivery id (WAHA x-webhook-request-id / body.id) or a generated one -- either makes the idempotency key change per delivery and defeats it.'
      using errcode = '22023';
  end if;

  select cr.tenant_id, cr.channel_type, cr.status, t.status
    into v_tenant, v_ctype, v_cstatus, v_tstatus
    from public.channel_registry cr
    join public.tenants t on t.id = cr.tenant_id
   where cr.integration_id = p_integration_id;

  if v_tenant is null then
    raise exception
      'nexus_record_channel_event: integration % is not in channel_registry. An unregistered channel writes nothing; register it with nexus_register_channel() first.',
      p_integration_id using errcode = '23503';
  end if;

  if v_cstatus <> 'active' or v_tstatus <> 'active' then
    raise exception
      'nexus_record_channel_event: channel status % / dealership status % -- a suspended channel records nothing.',
      v_cstatus, v_tstatus using errcode = '42501';
  end if;

  v_provider := case v_ctype
                  when 'whatsapp_waha_session'           then 'waha'
                  when 'whatsapp_cloud_phone_number_id'  then 'whatsapp_cloud'
                end;
  if v_provider is null then
    raise exception 'nexus_record_channel_event: no provider mapping for channel_type %.', v_ctype
      using errcode = '22023';
  end if;

  -- Cloud API's whole advantage is that Meta signs the raw bytes. Recording a
  -- Cloud event that was not verified would throw that away silently, so it is
  -- refused here as well as in the CHECK constraint.
  if v_provider = 'whatsapp_cloud'
     and coalesce(p_origin_verified, '') <> 'hmac_sha256_x_hub' then
    raise exception
      'nexus_record_channel_event: a whatsapp_cloud event may only be recorded when Meta''s X-Hub-Signature-256 was verified over the raw request bytes; got %.',
      coalesce(nullif(p_origin_verified, ''), '(null)') using errcode = '42501';
  end if;

  insert into public.channel_message_events (
    tenant_id, integration_id, provider, channel_type, direction,
    external_message_id, customer_external_id, customer_phone, conversation_id,
    message_kind, media_ref, media_mime, media_sha256,
    provider_account_id, provider_delivery_ref, origin_verified, received_at)
  values (
    v_tenant, p_integration_id, v_provider, v_ctype, v_dir,
    v_ext, p_customer_external_id, p_customer_phone, p_conversation_id,
    coalesce(nullif(btrim(coalesce(p_message_kind, '')), ''), 'unsupported'),
    p_media_ref, p_media_mime, p_media_sha256,
    p_provider_account_id, p_provider_delivery_ref,
    coalesce(nullif(btrim(coalesce(p_origin_verified, '')), ''), 'unverified'),
    coalesce(p_received_at, now()))
  on conflict on constraint channel_message_events_channel_direction_extmsg_key
  do nothing
  returning public.channel_message_events.event_id into v_event;

  if v_event is not null then
    v_new := true;
  else
    select e.event_id into v_event
      from public.channel_message_events e
     where e.tenant_id           = v_tenant
       and e.integration_id      = p_integration_id
       and e.direction           = v_dir
       and e.external_message_id = v_ext;
  end if;

  return query select v_event, v_tenant, v_new;
end;
$function$;