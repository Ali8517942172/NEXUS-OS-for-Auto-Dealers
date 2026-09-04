create or replace function public.whatsapp_delivery_status_rank(p_status text)
returns integer language sql immutable
set search_path to 'public','pg_catalog'
as $$
  select case lower(coalesce(p_status,''))
           when 'failed'    then 90   -- terminal; nothing supersedes it
           when 'read'      then 30
           when 'played'    then 30
           when 'delivered' then 20
           when 'sent'      then 10
           else 0                     -- unmapped / unknown never supersedes
         end;
$$;

comment on function public.whatsapp_delivery_status_rank(text) is
  'Ordering for the delivery lifecycle, used so a late-arriving earlier status cannot rewind a message that is already delivered or read. failed is terminal.';


-- One row per outbound message. The send path writes the channel event first and
-- passes its id here; tenant and integration are read FROM that event so they
-- cannot disagree with it.
create or replace function public.whatsapp_record_message_usage(
  p_event_id                           uuid,
  p_message_category                   text,
  p_policy_decision                    text,
  p_policy_reason_code                 text,
  p_policy_rule_verification_status    text,
  p_policy_decided_at                  timestamptz,
  p_sent_at                            timestamptz default now(),
  p_policy_rule_id                     uuid default null,
  p_policy_rule_name                   text default null,
  p_template_id                        uuid default null,
  p_template_provider_status_at_send   text default null,
  p_template_status_age_at_send        interval default null,
  p_template_staleness_verdict_at_send text default null)
returns table(usage_id uuid, tenant_id uuid, first_seen boolean)
language plpgsql security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_tenant uuid; v_integration uuid; v_dir text; v_id uuid; v_ttenant uuid;
begin
  perform public.whatsapp_refuse_end_user_role('whatsapp_record_message_usage');

  select e.tenant_id, e.integration_id, e.direction
    into v_tenant, v_integration, v_dir
    from public.channel_message_events e where e.event_id = p_event_id;

  if v_tenant is null then
    raise exception
      'whatsapp_record_message_usage: no channel_message_events row %. Record the outbound message event first -- the ledger describes messages that exist, it does not create them.',
      p_event_id using errcode='23503';
  end if;
  if v_dir <> 'outbound' then
    raise exception
      'whatsapp_record_message_usage: event % is direction %. Only outbound messages consume messaging.',
      p_event_id, v_dir using errcode='22023';
  end if;

  if upper(coalesce(p_policy_decision,'')) = 'BLOCKED' then
    raise exception
      'whatsapp_record_message_usage: the policy engine BLOCKED this message, so it was not sent and has no place in a ledger of what was sent. Record the refusal in the audit trail instead.'
      using errcode='22023';
  end if;

  if p_template_id is not null then
    select t.tenant_id into v_ttenant from public.whatsapp_templates t where t.template_id = p_template_id;
    if v_ttenant is distinct from v_tenant then
      raise exception
        'whatsapp_record_message_usage: template % belongs to dealership %, not %.',
        p_template_id, coalesce(v_ttenant::text,'(none)'), v_tenant using errcode='42501';
    end if;
  end if;

  select u.usage_id into v_id from public.whatsapp_message_usage u
   where u.tenant_id = v_tenant and u.event_id = p_event_id;
  if v_id is not null then
    -- Idempotent: a retried send path re-reaches this and must not double the
    -- ledger. The existing row wins; provider facts already written stay.
    return query select v_id, v_tenant, false;
    return;
  end if;

  insert into public.whatsapp_message_usage
    (tenant_id, integration_id, event_id, message_category, template_required, template_id,
     policy_decision, policy_reason_code, policy_rule_id, policy_rule_name,
     policy_rule_verification_status, policy_decided_at,
     template_provider_status_at_send, template_status_age_at_send,
     template_staleness_verdict_at_send, sent_at)
  values
    (v_tenant, v_integration, p_event_id,
     upper(btrim(coalesce(p_message_category,'UNKNOWN'))),
     (upper(btrim(coalesce(p_policy_decision,''))) = 'TEMPLATE_REQUIRED'),
     p_template_id,
     upper(btrim(coalesce(p_policy_decision,''))), btrim(coalesce(p_policy_reason_code,'')),
     p_policy_rule_id, p_policy_rule_name,
     upper(btrim(coalesce(p_policy_rule_verification_status,'NO_RULE_APPLIED'))),
     coalesce(p_policy_decided_at, now()),
     p_template_provider_status_at_send, p_template_status_age_at_send,
     p_template_staleness_verdict_at_send, coalesce(p_sent_at, now()))
  returning public.whatsapp_message_usage.usage_id into v_id;

  return query select v_id, v_tenant, true;
end;
$$;


-- Copy what the provider reported onto the usage row. The only writer of the
-- provider_* columns, and it always names the callback it took them from.
create or replace function public.whatsapp_apply_delivery_to_usage(p_delivery_event_id uuid)
returns boolean language plpgsql security definer
set search_path to 'public','pg_catalog'
as $$
declare d public.whatsapp_delivery_events%rowtype; u public.whatsapp_message_usage%rowtype;
begin
  select * into d from public.whatsapp_delivery_events where delivery_event_id = p_delivery_event_id;
  if d.delivery_event_id is null or d.event_id is null then return false; end if;

  select * into u from public.whatsapp_message_usage
   where tenant_id = d.tenant_id and event_id = d.event_id;
  if u.usage_id is null then return false; end if;

  update public.whatsapp_message_usage m set
    latest_status = case when public.whatsapp_delivery_status_rank(d.status)
                            > public.whatsapp_delivery_status_rank(m.latest_status)
                         then d.status else m.latest_status end,
    latest_status_at = case when public.whatsapp_delivery_status_rank(d.status)
                               > public.whatsapp_delivery_status_rank(m.latest_status)
                            then d.status_at else m.latest_status_at end,
    latest_status_delivery_event_id = case when public.whatsapp_delivery_status_rank(d.status)
                                              > public.whatsapp_delivery_status_rank(m.latest_status)
                                           then d.delivery_event_id else m.latest_status_delivery_event_id end,

    -- Billing facts: the FIRST callback that carries a pricing object wins, and
    -- nothing overwrites it. AWAITING -> NO_PRICING -> REPORTED only ever moves
    -- forward, so a later callback without pricing cannot erase one with it.
    billing_fact_state = case
      when m.billing_fact_state = 'PROVIDER_REPORTED' then m.billing_fact_state
      when d.pricing_reported then 'PROVIDER_REPORTED'
      else 'PROVIDER_REPORTED_NO_PRICING' end,
    provider_billable = case when m.billing_fact_state <> 'PROVIDER_REPORTED' and d.pricing_reported
                             then d.pricing_billable else m.provider_billable end,
    provider_pricing_model = case when m.billing_fact_state <> 'PROVIDER_REPORTED' and d.pricing_reported
                                  then d.pricing_model else m.provider_pricing_model end,
    provider_pricing_category = case when m.billing_fact_state <> 'PROVIDER_REPORTED' and d.pricing_reported
                                     then d.pricing_category else m.provider_pricing_category end,
    provider_pricing_type = case when m.billing_fact_state <> 'PROVIDER_REPORTED' and d.pricing_reported
                                 then d.pricing_type else m.provider_pricing_type end,
    provider_conversation_id = case when m.billing_fact_state <> 'PROVIDER_REPORTED' and d.pricing_reported
                                    then d.conversation_id else m.provider_conversation_id end,
    provider_conversation_origin_type = case when m.billing_fact_state <> 'PROVIDER_REPORTED' and d.pricing_reported
                                             then d.conversation_origin_type else m.provider_conversation_origin_type end,
    provider_conversation_expiration_at = case when m.billing_fact_state <> 'PROVIDER_REPORTED' and d.pricing_reported
                                               then d.conversation_expiration_at else m.provider_conversation_expiration_at end,
    provider_pricing_observed_at = case when m.billing_fact_state = 'PROVIDER_REPORTED'
                                        then m.provider_pricing_observed_at else d.received_at end,
    provider_pricing_delivery_event_id = case when m.billing_fact_state = 'PROVIDER_REPORTED'
                                              then m.provider_pricing_delivery_event_id else d.delivery_event_id end
  where m.usage_id = u.usage_id;

  return true;
end;
$$;


-- Idempotent ingest of ONE element of Meta's statuses[] array.
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
declare
  v_tenant uuid; v_ctype text; v_cstatus text; v_tstatus text; v_provider text;
  v_ext text := btrim(coalesce(p_provider_message_id,''));
  v_raw text := btrim(coalesce(p_status_raw,''));
  v_norm text; v_event uuid; v_id uuid; v_new boolean := false; v_applied boolean := false;
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

  v_norm := lower(v_raw);
  if not (v_norm = any (v_known)) then v_norm := 'unmapped'; end if;

  -- The outbound message this status is about, per the adapter's key.
  select e.event_id into v_event from public.channel_message_events e
   where e.tenant_id = v_tenant and e.direction = 'outbound' and e.external_message_id = v_ext;

  insert into public.whatsapp_delivery_events
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
  on conflict (tenant_id, provider_message_id, status_raw) do nothing
  returning public.whatsapp_delivery_events.delivery_event_id into v_id;

  if v_id is not null then
    v_new := true;
  else
    -- A duplicate callback. Nothing is written and nothing is counted twice.
    select e.delivery_event_id into v_id from public.whatsapp_delivery_events e
     where e.tenant_id = v_tenant and e.provider_message_id = v_ext and e.status_raw = v_raw;
  end if;

  if v_new then
    v_applied := public.whatsapp_apply_delivery_to_usage(v_id);
  end if;

  return query
    select v_id, v_tenant, v_new,
           (select e.link_state from public.whatsapp_delivery_events e where e.delivery_event_id = v_id),
           v_applied;
end;
$$;


-- Callbacks that arrived before their outbound event existed. Links them and
-- applies the provider facts they were carrying all along.
create or replace function public.whatsapp_link_delivery_events(
  p_integration_id uuid,
  p_limit          integer default 500)
returns table(linked integer, applied integer)
language plpgsql security definer
set search_path to 'public','pg_catalog'
as $$
declare rec record; v_linked integer := 0; v_applied integer := 0;
begin
  perform public.whatsapp_refuse_end_user_role('whatsapp_link_delivery_events');

  for rec in
    select d.delivery_event_id, e.event_id
      from public.whatsapp_delivery_events d
      join public.channel_message_events e
        on e.tenant_id = d.tenant_id
       and e.direction = 'outbound'
       and e.external_message_id = d.provider_message_id
     where d.integration_id = p_integration_id
       and d.link_state = 'UNLINKED_NO_OUTBOUND_EVENT'
     order by d.recorded_at
     limit greatest(coalesce(p_limit,500), 1)
  loop
    update public.whatsapp_delivery_events
       set event_id = rec.event_id, link_state = 'LINKED', linked_at = now()
     where delivery_event_id = rec.delivery_event_id;
    v_linked := v_linked + 1;
    if public.whatsapp_apply_delivery_to_usage(rec.delivery_event_id) then
      v_applied := v_applied + 1;
    end if;
  end loop;

  return query select v_linked, v_applied;
end;
$$;

comment on function public.whatsapp_record_delivery_status(uuid,text,text,timestamptz,jsonb,text,text,text,timestamptz,boolean,text,text,text,jsonb,timestamptz) is
  'Idempotent ingest of one element of Meta statuses[]. A duplicate callback returns the existing row with first_seen=false and writes nothing, so no charge is counted twice. Pricing and conversation values are stored exactly as the provider reported them and are never converted into a money amount.';

revoke all on function public.whatsapp_delivery_status_rank(text) from anon, authenticated, public;
revoke all on function public.whatsapp_record_message_usage(uuid,text,text,text,text,timestamptz,timestamptz,uuid,text,uuid,text,interval,text) from anon, authenticated, public;
revoke all on function public.whatsapp_apply_delivery_to_usage(uuid) from anon, authenticated, public;
revoke all on function public.whatsapp_record_delivery_status(uuid,text,text,timestamptz,jsonb,text,text,text,timestamptz,boolean,text,text,text,jsonb,timestamptz) from anon, authenticated, public;
revoke all on function public.whatsapp_link_delivery_events(uuid,integer) from anon, authenticated, public;
grant execute on function public.whatsapp_delivery_status_rank(text) to service_role;
grant execute on function public.whatsapp_record_message_usage(uuid,text,text,text,text,timestamptz,timestamptz,uuid,text,uuid,text,interval,text) to service_role;
grant execute on function public.whatsapp_apply_delivery_to_usage(uuid) to service_role;
grant execute on function public.whatsapp_record_delivery_status(uuid,text,text,timestamptz,jsonb,text,text,text,timestamptz,boolean,text,text,text,jsonb,timestamptz) to service_role;
grant execute on function public.whatsapp_link_delivery_events(uuid,integer) to service_role;