-- A customer service window is opened by a customer MESSAGE, not by a delivery of
-- one. WAHA posts the same payload.id from two hosts and Log Incoming Message
-- retries, so "have I already counted this message?" has to be a fact NEXUS holds,
-- not something inferred from a timestamp comparison.
create table if not exists public.whatsapp_customer_message_seen (
  tenant_id           uuid        not null references public.tenants(id) on delete restrict,
  integration_id      uuid        not null references public.channel_registry(integration_id) on delete restrict,
  customer_wa_id      text        not null,
  external_message_id text        not null,
  first_occurred_at   timestamptz not null,
  first_source        text        not null,
  first_recorded_at   timestamptz not null default now(),
  constraint whatsapp_customer_message_seen_pkey
    primary key (tenant_id, integration_id, customer_wa_id, external_message_id),
  constraint wacms_customer_normalised
    check (customer_wa_id = lower(btrim(customer_wa_id)) and length(customer_wa_id) between 1 and 120),
  constraint wacms_extmsg_shape
    check (external_message_id = btrim(external_message_id) and length(external_message_id) between 1 and 300)
);

alter table public.whatsapp_customer_message_seen enable row level security;
alter table public.whatsapp_customer_message_seen force row level security;

drop policy if exists whatsapp_customer_message_seen_service_role_all on public.whatsapp_customer_message_seen;
create policy whatsapp_customer_message_seen_service_role_all
  on public.whatsapp_customer_message_seen for all to service_role using (true) with check (true);

drop policy if exists whatsapp_customer_message_seen_deny_end_users on public.whatsapp_customer_message_seen;
create policy whatsapp_customer_message_seen_deny_end_users
  on public.whatsapp_customer_message_seen as restrictive for all to anon, authenticated using (false) with check (false);

grant all on public.whatsapp_customer_message_seen to service_role;

-- Any conversation already carrying an id has counted that message once.
insert into public.whatsapp_customer_message_seen
  (tenant_id, integration_id, customer_wa_id, external_message_id, first_occurred_at, first_source)
select c.tenant_id, c.integration_id, c.customer_wa_id,
       c.last_customer_message_external_id, c.last_customer_message_at,
       coalesce(c.last_customer_message_source, 'backfill')
  from public.whatsapp_conversation_state c
 where c.last_customer_message_external_id is not null
   and c.last_customer_message_at is not null
on conflict on constraint whatsapp_customer_message_seen_pkey do nothing;

create or replace function public.whatsapp_record_customer_message(
  p_tenant_id uuid, p_integration_id uuid, p_customer_wa_id text,
  p_occurred_at timestamptz, p_external_message_id text, p_source text)
returns whatsapp_conversation_state
language plpgsql
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_cust text := lower(btrim(coalesce(p_customer_wa_id,'')));
  v_ext  text := btrim(coalesce(p_external_message_id,''));
  v_row  public.whatsapp_conversation_state;
  v_new  integer := 0;
begin
  if not exists (select 1 from public.channel_registry cr
                  where cr.integration_id = p_integration_id
                    and cr.tenant_id = p_tenant_id
                    and cr.status = 'active') then
    raise exception using errcode = '42501',
      message = 'That channel is not an active registered channel of that dealership.',
      hint    = 'Resolve the tenant from the channel identity rather than passing both in independently.';
  end if;
  if v_cust = '' then
    raise exception using errcode = '22023', message = 'A customer WhatsApp identity is required.';
  end if;
  if p_occurred_at is null then
    raise exception using errcode = '22023',
      message = 'An inbound message with no timestamp cannot open a window.',
      hint    = 'Leave the conversation unmeasured rather than recording a window NEXUS cannot date.';
  end if;
  if nullif(btrim(coalesce(p_source,'')),'') is null then
    raise exception using errcode = '22023',
      message = 'Recording an inbound message requires naming where the timestamp came from.';
  end if;

  -- An id NEXUS cannot see is an id NEXUS cannot deduplicate, and this window is
  -- the fact that turns TEMPLATE_REQUIRED into FREEFORM_ALLOWED. Accepting an
  -- unidentified message would restore the replay hole through a different door:
  -- every redelivery would look new. The cost of refusing is a template instead of
  -- a free-form reply. The cost of accepting is sending outside Meta's window.
  if v_ext = '' then
    raise exception using errcode = '22023',
      message = 'An inbound message with no provider message id cannot open or extend a customer service window.',
      detail  = 'NEXUS_INBOUND_MESSAGE_ID_REQUIRED',
      hint    = 'Send the provider''s own message id (WAHA body.payload.id, Cloud API wamid). Do not substitute a per-delivery id (x-webhook-request-id, body.id) or a generated one: either makes the key change per delivery and defeats it. If the provider genuinely gave none, leave the conversation unmeasured and send a template.';
  end if;

  -- Have we counted this message before? One row per message, per conversation.
  -- ON CONFLICT DO NOTHING is the serialisation point: a concurrent second backend
  -- blocks here on the uncommitted key and then finds it committed, so exactly one
  -- caller sees ROW_COUNT 1 for a given message.
  insert into public.whatsapp_customer_message_seen
    (tenant_id, integration_id, customer_wa_id, external_message_id, first_occurred_at, first_source)
  values (p_tenant_id, p_integration_id, v_cust, v_ext, p_occurred_at, btrim(p_source))
  on conflict on constraint whatsapp_customer_message_seen_pkey do nothing;
  get diagnostics v_new = ROW_COUNT;

  if v_new = 0 then
    -- A redelivery of a message already counted. It changes nothing, and in
    -- particular it does not move the window.
    select * into v_row from public.whatsapp_conversation_state c2
     where c2.tenant_id = p_tenant_id and c2.integration_id = p_integration_id and c2.customer_wa_id = v_cust;
    return v_row;
  end if;

  -- A genuinely new customer message. Still monotonic: an out-of-order delivery of
  -- an older message must not drag the window backwards either.
  insert into public.whatsapp_conversation_state as c
    (tenant_id, integration_id, customer_wa_id,
     last_customer_message_at, last_customer_message_external_id, last_customer_message_source)
  values (p_tenant_id, p_integration_id, v_cust, p_occurred_at, v_ext, btrim(p_source))
  on conflict (tenant_id, integration_id, customer_wa_id) do update
     set last_customer_message_at          = excluded.last_customer_message_at,
         last_customer_message_external_id = excluded.last_customer_message_external_id,
         last_customer_message_source      = excluded.last_customer_message_source,
         updated_at                        = now()
   where c.last_customer_message_at is null
      or excluded.last_customer_message_at > c.last_customer_message_at
  returning * into v_row;

  if v_row is null then
    select * into v_row from public.whatsapp_conversation_state c2
     where c2.tenant_id = p_tenant_id and c2.integration_id = p_integration_id and c2.customer_wa_id = v_cust;
  end if;
  return v_row;
end;
$function$;