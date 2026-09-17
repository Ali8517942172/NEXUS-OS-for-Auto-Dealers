-- NX986 — The screen could not see the channel that was actually working.
--
-- WhatsApp Cloud is the ONE channel in this product that has received real,
-- signature-verified customer messages. On the Lead Sources screen it reads
-- "Not connected".
--
-- The reason is structural, not cosmetic. There are two planes and they have
-- never been joined:
--
--   messaging   channel_registry + channel_message_events
--               (whatsapp_cloud_phone_number_id 1306545252542419, active,
--                2 inbound rows, newest 14 Sep 20:14:42Z, hmac_sha256_x_hub)
--   lead ingest lead_ingest_endpoint + lead_source_catalogue + v_lead_origin
--               (6 endpoints, 1 lead_event in its whole life)
--
-- nexus_lead_source_readiness() answers from the lead-ingest plane only, so
-- `whatsapp_inbound` reads NOT_CONNECTED while a live Cloud number sits
-- registered and has taken real traffic. The screen was not wrong; it was
-- blind on one side.
--
-- And it could not have been fixed in JavaScript. Measured: `authenticated`
-- holds NO grant on channel_registry, channel_message_events, or
-- lead_ingest_endpoint, and no EXECUTE on nexus_meta_onboarding_status(). A
-- browser has no read of the messaging plane at all. So the accessor comes
-- first and the screen second.
--
-- WHAT THIS DELIBERATELY DOES NOT COLLAPSE:
--   REGISTERED  a row exists saying where this would arrive
--   CONNECTED   that row is switched on
--   RECEIVING   something real has actually arrived through it
-- Three different sentences. A dealer who is told "connected" when nothing has
-- ever arrived will find out at the worst possible moment, and this product's
-- whole claim is that it does not do that.
--
-- No customer data crosses this boundary: counts, timestamps, and the dealer's
-- own configuration identifiers only. No phone number of any customer, no
-- message text, no name.

begin;

create or replace function public.nexus_channel_status()
returns table (
  channel_key      text,
  display_name     text,
  family           text,
  plane            text,
  registered       boolean,
  registered_detail text,
  connected        boolean,
  connected_detail text,
  received_count   bigint,
  last_received_at timestamptz,
  origin_attested  text,
  state            text,
  evidence         text
)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare v_tenants uuid[];
begin
  select array_agg(t) into v_tenants from public.nexus_current_tenant_ids() t;
  if v_tenants is null or cardinality(v_tenants) = 0 then
    -- No membership, no answer. Never a default dealership: a screen that
    -- silently shows somebody else's channels is the defect this whole
    -- migration exists to avoid.
    return;
  end if;

  -- ── The messaging plane: WhatsApp Cloud and WAHA ────────────────────────
  return query
  with reg as (
    select r.channel_type, r.external_identifier, r.status, r.integration_id
      from public.channel_registry r
     where r.tenant_id = any(v_tenants)
  ),
  ev as (
    select e.channel_type,
           count(*) filter (where e.direction = 'inbound')            as inbound,
           max(e.received_at) filter (where e.direction = 'inbound')  as newest,
           (array_agg(e.origin_verified order by e.received_at desc))[1] as attested
      from public.channel_message_events e
     where e.tenant_id = any(v_tenants)
     group by e.channel_type
  ),
  want(k, ct, dn) as (
    values ('whatsapp_cloud', 'whatsapp_cloud_phone_number_id', 'WhatsApp Business Cloud'),
           ('whatsapp_waha',  'whatsapp_waha_session',          'WhatsApp (WAHA session)')
  )
  select
    w.k, w.dn, 'messaging'::text, 'messaging'::text,
    (r.channel_type is not null),
    case when r.channel_type is null then 'No registry row for this dealership.'
         else 'Registered as ' || r.external_identifier end,
    coalesce(r.status = 'active', false),
    case when r.channel_type is null then 'Nothing to switch on yet.'
         when r.status = 'active'    then 'Registry row is active.'
         else 'Registered but status is ' || r.status || '.' end,
    coalesce(e.inbound, 0),
    e.newest,
    e.attested,
    case when coalesce(e.inbound, 0) > 0        then 'RECEIVING'
         when coalesce(r.status = 'active', false) then 'CONNECTED'
         when r.channel_type is not null        then 'REGISTERED'
         else 'NOT_BUILT' end,
    case when coalesce(e.inbound, 0) > 0
           then e.inbound || ' inbound message(s) recorded, newest ' ||
                to_char(e.newest at time zone 'Asia/Dubai', 'DD Mon HH24:MI') || ' Dubai time' ||
                coalesce(', attested ' || e.attested, ', with no attestation recorded')
         when coalesce(r.status = 'active', false)
           then 'Switched on, and nothing has arrived through it yet. Connected is not receiving.'
         when r.channel_type is not null
           then 'A registry row exists and is not active.'
         else 'Not set up for this dealership.' end
  from want w
  left join reg r on r.channel_type = w.ct
  left join ev  e on e.channel_type = w.ct;

  -- ── The lead-ingest plane: ad forms, website, phone, walk-in ────────────
  return query
  with ep as (
    select i.source_key, i.status, i.ingest_address, i.environment
      from public.lead_ingest_endpoint i
     where i.tenant_id = any(v_tenants)
  ),
  le as (
    select l.source_key, count(*) as arrivals, max(l.received_at) as newest,
           (array_agg(l.origin_verified order by l.received_at desc))[1] as attested
      from public.lead_event l
     where l.tenant_id = any(v_tenants)
     group by l.source_key
  )
  select
    c.source_key, c.display_name, c.channel_family, 'lead_ingest'::text,
    (ep.source_key is not null),
    case when ep.source_key is null then 'No endpoint registered for this dealership.'
         when ep.ingest_address is null then 'Registered, but no address recorded — nobody can say where this would arrive.'
         else 'Arrives at ' || ep.ingest_address end,
    coalesce(ep.status = 'active', false),
    case when ep.source_key is null then 'Nothing to switch on yet.'
         when ep.status = 'active'  then 'Endpoint is active.'
         else 'Endpoint exists and is ' || ep.status || '.' end,
    coalesce(le.arrivals, 0),
    le.newest,
    le.attested,
    case when coalesce(le.arrivals, 0) > 0        then 'RECEIVING'
         when coalesce(ep.status = 'active', false) then 'CONNECTED'
         when ep.source_key is not null           then 'REGISTERED'
         else 'NOT_BUILT' end,
    case when coalesce(le.arrivals, 0) > 0
           then le.arrivals || ' arrival(s), newest ' ||
                to_char(le.newest at time zone 'Asia/Dubai', 'DD Mon HH24:MI') || ' Dubai time' ||
                coalesce(', attested ' || le.attested, '')
         when coalesce(ep.status = 'active', false) and c.delivery_shape = 'MANUAL_ENTRY'
           then 'A person types these in. There is no wire to fire, so nothing will ever arrive on its own.'
         when coalesce(ep.status = 'active', false)
           then 'Switched on, and nothing has arrived through it yet. Connected is not receiving.'
         when ep.source_key is not null
           then 'An endpoint exists and is switched off. A delivery today would be refused.'
         when c.integration_status = 'COMMERCIAL_CONVERSATION_REQUIRED'
           then 'No public integration exists. This one needs a commercial agreement, not code.'
         else 'Not set up for this dealership.' end
  from public.lead_source_catalogue c
  left join ep on ep.source_key = c.source_key
  left join le on le.source_key = c.source_key
  where c.source_key <> 'whatsapp_inbound'   -- answered by the messaging plane above
  order by 1;
end
$fn$;

comment on function public.nexus_channel_status() is
  'One row per channel, across BOTH planes — the messaging plane '
  '(channel_registry, channel_message_events) and the lead-ingest plane '
  '(lead_ingest_endpoint, lead_event). Scoped to the caller''s own '
  'dealerships and to nothing else. Keeps REGISTERED, CONNECTED and RECEIVING '
  'as three separate answers, because a dealer told "connected" about a '
  'channel that has never received anything finds out at the worst moment. '
  'Returns counts, timestamps and the dealership''s own configuration '
  'identifiers only — no customer phone number, name or message text.';

revoke all on function public.nexus_channel_status() from public, anon;
grant execute on function public.nexus_channel_status() to authenticated, service_role;

commit;