-- NEXUS OS -- NX1013: NEXUS sits on top of the dealer's software, so it needs a door that software can use
--
-- THE CLAIM THIS MIGRATION MAKES TRUE
-- -----------------------------------
-- NEXUS is sold as a layer that sits ON TOP of a dealership's existing DMS,
-- CRM, ERP and call system -- never a replacement for them. Until now that was
-- only true in one direction: leads came in through ingest endpoints, but the
-- dealer's own systems had no way to read a lead back out, push a stock list
-- in, report a phone call, or be told when something changed. This migration
-- is the database half of a tenant-scoped public REST API (edge function
-- supabase/functions/api-v1) plus outbound webhooks.
--
-- WHAT IT INSTALLS
-- ----------------
--   1. Vocabulary. A new provenance kind 'api_client_key' (a bearer key the
--      dealership minted for its own system: real business, not attested by
--      any third party) and two new lead sources, 'api' (a lead the dealer's
--      own DMS/CRM pushed) and 'api_call' (a lead first seen as a phone call
--      reported by the dealer's call system). channel_family gains
--      'dealer_system'. API-created leads therefore go through door three --
--      nexus_record_lead_event + nexus_promote_lead_event -- exactly like a
--      walk-in, so attribution, journeys, the audit row and
--      nexus_lead_ingest_invariants() all see them. Nothing inserts into
--      public.leads directly.
--   2. Tables, all RLS-on with no policies (access only through the
--      SECURITY DEFINER RPCs below): api_client_key, outbound_webhook,
--      outbound_webhook_delivery, api_lead_clock (public.leads has no
--      updated_at, and adding one would be an ALTER TABLE on the busiest
--      table in the schema that nexus_guard_born_open_grants() reacts to;
--      a side table maintained by trigger gives the API an honest
--      updated_since without touching leads), api_call_log (no existing
--      table can hold a call: communication_logs is keyed on lead_email and
--      a phone-only lead has none), api_rate_window (per-key 120/min).
--   3. Dashboard RPCs (authenticated; caller's own dealership only; writes
--      need owner/admin): nexus_api_keys_list, nexus_api_key_create,
--      nexus_api_key_revoke, nexus_webhooks_list, nexus_webhook_create,
--      nexus_webhook_delete, nexus_webhook_send_test, nexus_webhook_deliveries.
--   4. Service-role-only RPCs for the edge function and the webhook
--      dispatcher. Every data function takes p_tenant explicitly; the edge
--      function passes ONLY the tenant nexus_api_authenticate() returned.
--   5. Triggers on leads, appointment and communication_logs that enqueue
--      webhook deliveries. They can never fail the write that fired them.
--
-- KEYS AND SECRETS
-- ----------------
-- An API key is 'nxk_live_' + 40 hex and is shown ONCE; only its sha256 is
-- stored. A webhook signing secret is 'whsec_' + 48 hex, shown ONCE, and kept
-- in supabase vault (vault.create_secret) -- the table holds only the vault id.
--
-- ERRORS: errcode P0001 everywhere, machine code in DETAIL (NX_API_*), which
-- the edge function maps to 404/409/422.
--
-- GRANTS: every function revokes from public, anon, authenticated in one
-- statement before granting (see ops/ci/function-grants.mjs).
-- ===========================================================================

-- ===========================================================================
-- 1. Vocabulary: provenance kind, channel family, two sources
-- ===========================================================================
insert into public.lead_provenance_kind
  (kind, is_cryptographic, strength_rank, counts_as_real, description, is_externally_attested)
values
  ('api_client_key', false, 40, true,
   'Pushed by the dealership''s own software (DMS, CRM, call system) through the NEXUS public API, '
   'authenticated by a bearer key the dealership minted (api_client_key, stored as sha256 only). '
   'Real business, but nothing outside the dealership attests the payload: it is the dealership''s '
   'own system''s word, so is_externally_attested is false, like operator_recorded.',
   false)
on conflict (kind) do nothing;

alter table public.lead_source_catalogue drop constraint if exists lead_source_channel_family;
alter table public.lead_source_catalogue add constraint lead_source_channel_family
  check (channel_family = any (array['social_lead_ad','search_lead_form','website','marketplace',
                                     'messaging','offline','dealer_system']::text[]));

insert into public.lead_source_catalogue
  (source_key, display_name, channel_family, integration_status, delivery_shape,
   required_provenance, dedup_field, evidence_note, manual_entry_surface)
values
  ('api', 'Dealer system (NEXUS API)', 'dealer_system', 'AVAILABLE', 'WEBHOOK_FULL_PAYLOAD',
   'api_client_key', 'external_id',
   'POST /v1/leads on the api-v1 edge function, called by the dealership''s own DMS or CRM with a '
   'key minted in Settings > API. Idempotent on (dealership, external_id) -- the Idempotency-Key '
   'header or the body''s external_id. NEXUS sits on top of the dealer''s software; this is the '
   'door that software uses.', null),
  ('api_call', 'Call system (NEXUS API)', 'offline', 'AVAILABLE', 'WEBHOOK_FULL_PAYLOAD',
   'api_client_key', 'external_call_id',
   'POST /v1/calls on the api-v1 edge function. The call is matched to an existing lead by E.164 '
   'phone within the dealership; only a caller NEXUS has never seen becomes a new lead with this '
   'source. Idempotent on (dealership, external_call_id). Distinct from phone_call (typed by a '
   'person) and phone_call_tracked (a tracking-number carrier).', null)
on conflict (source_key) do nothing;

-- ===========================================================================
-- 2. Tables
-- ===========================================================================
create table if not exists public.api_client_key (
  key_id       uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete restrict,
  name         text not null check (length(btrim(name)) between 1 and 80),
  key_prefix   text not null check (key_prefix ~ '^nxk_live_[0-9a-f]{4}$'),
  key_hash     text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  scopes       text[] not null default '{leads:read,leads:write,inventory:read,inventory:write,calls:write,appointments:read}',
  created_by   uuid,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  constraint api_client_key_scopes_known check (
    cardinality(scopes) > 0 and scopes <@ array['leads:read','leads:write','inventory:read',
      'inventory:write','calls:write','appointments:read']::text[])
);
create index if not exists api_client_key_tenant_idx on public.api_client_key (tenant_id, created_at desc);
comment on table public.api_client_key is
  'NX1013. A dealership''s key for the NEXUS public API (api-v1 edge function). Only the sha256 of '
  'the key is stored; the key itself is returned once by nexus_api_key_create(). RLS on, no '
  'policies: read and written only through SECURITY DEFINER RPCs.';

create table if not exists public.outbound_webhook (
  webhook_id           uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete restrict,
  url                  text not null check (url ~ '^https://' and length(url) <= 2048),
  events               text[] not null,
  vault_secret_id      uuid not null,
  status               text not null default 'active' check (status in ('active','disabled')),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  created_by           uuid,
  created_at           timestamptz not null default now(),
  last_delivery_at     timestamptz,
  constraint outbound_webhook_tenant_key unique (tenant_id, webhook_id),
  constraint outbound_webhook_events_known check (
    cardinality(events) > 0 and events <@ array['lead.created','lead.updated','lead.scored',
      'appointment.created','appointment.updated','message.received','ping']::text[])
);
create index if not exists outbound_webhook_tenant_idx on public.outbound_webhook (tenant_id, status);
comment on table public.outbound_webhook is
  'NX1013. A dealership''s outbound webhook subscription. The signing secret lives in supabase '
  'vault (vault_secret_id); it is shown once by nexus_webhook_create() and read back only by the '
  'service-role dispatcher through nexus_webhook_claim_deliveries(). Disabled automatically after '
  '20 consecutive failed deliveries.';

create table if not exists public.outbound_webhook_delivery (
  delivery_id      uuid primary key default gen_random_uuid(),
  webhook_id       uuid not null,
  tenant_id        uuid not null,
  event            text not null check (event in ('lead.created','lead.updated','lead.scored',
                     'appointment.created','appointment.updated','message.received','ping')),
  payload          jsonb not null,
  status           text not null default 'pending' check (status in ('pending','delivered','failed','dead')),
  attempts         integer not null default 0 check (attempts >= 0),
  next_attempt_at  timestamptz not null default now(),
  last_status_code integer,
  last_error       text,
  created_at       timestamptz not null default now(),
  delivered_at     timestamptz,
  constraint outbound_webhook_delivery_webhook_fk foreign key (tenant_id, webhook_id)
    references public.outbound_webhook (tenant_id, webhook_id) on delete cascade,
  constraint outbound_webhook_delivery_delivered_at check ((status = 'delivered') = (delivered_at is not null))
);
create index if not exists outbound_webhook_delivery_due_idx
  on public.outbound_webhook_delivery (next_attempt_at) where status in ('pending','failed');
create index if not exists outbound_webhook_delivery_webhook_idx
  on public.outbound_webhook_delivery (webhook_id, created_at desc);
comment on table public.outbound_webhook_delivery is
  'NX1013. One queued delivery of one event to one webhook. Claimed by the dispatcher with '
  'nexus_webhook_claim_deliveries() (5-minute lease), settled with nexus_webhook_mark_delivery(): '
  'backoff 1m, 5m, 30m, 2h, 6h, 12h, 24h, dead after the 8th failed attempt.';

create table if not exists public.api_lead_clock (
  lead_id    integer primary key,
  tenant_id  uuid not null,
  changed_at timestamptz not null default now(),
  constraint api_lead_clock_lead_fk foreign key (tenant_id, lead_id)
    references public.leads (tenant_id, id)
);
create index if not exists api_lead_clock_tenant_idx on public.api_lead_clock (tenant_id, changed_at, lead_id);
comment on table public.api_lead_clock is
  'NX1013. When a lead last changed in a field the public API exposes. public.leads has no '
  'updated_at; this side table, maintained by nexus_api_on_lead_change(), gives GET /v1/leads an '
  'honest updated_since without an ALTER TABLE on leads. Backfilled from leads.created_at.';

create table if not exists public.api_call_log (
  call_id             uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete restrict,
  external_call_id    text not null check (length(btrim(external_call_id)) between 1 and 200),
  lead_id             integer not null,
  direction           text not null check (direction in ('inbound','outbound')),
  from_number         text,
  to_number           text,
  customer_phone_e164 text not null check (customer_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  duration_sec        integer check (duration_sec is null or duration_sec between 0 and 86400),
  recording_url       text check (recording_url is null or (recording_url ~ '^https://' and length(recording_url) <= 2048)),
  started_at          timestamptz,
  lead_created        boolean not null default false,
  created_at          timestamptz not null default now(),
  constraint api_call_log_identity_key unique (tenant_id, external_call_id),
  constraint api_call_log_lead_fk foreign key (tenant_id, lead_id) references public.leads (tenant_id, id)
);
create index if not exists api_call_log_lead_idx on public.api_call_log (tenant_id, lead_id, started_at desc);
comment on table public.api_call_log is
  'NX1013. A phone call reported by the dealership''s call system through POST /v1/calls. No '
  'existing table could hold one: communication_logs is keyed on lead_email and a phone-only lead '
  'has none. Idempotent on (tenant_id, external_call_id).';

create table if not exists public.api_rate_window (
  key_id       uuid not null references public.api_client_key(key_id) on delete cascade,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key_id, window_start)
);
comment on table public.api_rate_window is
  'NX1013. Fixed one-minute request counter per API key (120/min), written by '
  'nexus_api_rate_limit_hit(). Old windows are pruned opportunistically by the same function.';

alter table public.api_client_key            enable row level security;
alter table public.outbound_webhook          enable row level security;
alter table public.outbound_webhook_delivery enable row level security;
alter table public.api_lead_clock            enable row level security;
alter table public.api_call_log              enable row level security;
alter table public.api_rate_window           enable row level security;

revoke all on table public.api_client_key, public.outbound_webhook, public.outbound_webhook_delivery,
  public.api_lead_clock, public.api_call_log, public.api_rate_window from public, anon, authenticated;

insert into public.api_lead_clock (lead_id, tenant_id, changed_at)
select l.id, l.tenant_id, coalesce(l.created_at, now()) from public.leads l
on conflict (lead_id) do nothing;

-- ===========================================================================
-- 3. Internal helpers (service_role only; SECURITY DEFINER callers reach them as owner)
-- ===========================================================================
create or replace function public.nexus_api_caller_tenant(p_need_admin boolean)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare v_t uuid := public.nexus_current_tenant_id();
begin
  if auth.uid() is null or v_t is null then
    raise exception using errcode = 'P0001',
      message = 'Your account does not belong to an active dealership.',
      detail  = 'NX_API_NO_DEALERSHIP';
  end if;
  if p_need_admin and not exists (
    select 1 from public.tenant_members m
     where m.tenant_id = v_t and m.auth_user_id = auth.uid() and m.role in ('owner','admin')) then
    raise exception using errcode = 'P0001',
      message = 'Only the dealership''s owner or an admin can manage API keys and webhooks.',
      detail  = 'NX_API_OWNER_OR_ADMIN_ONLY';
  end if;
  return v_t;
end;
$fn$;
revoke all on function public.nexus_api_caller_tenant(boolean) from public, anon, authenticated;
grant execute on function public.nexus_api_caller_tenant(boolean) to service_role;

create or replace function public.nexus_api_e164(p_raw text)
returns text
language sql
immutable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  -- +E.164 as given; 00-prefixed international; 971... without the plus; and a
  -- UAE national number (0 + 8 or 9 digits) -- this platform only sells to UAE
  -- dealers, whose call systems commonly report 05XXXXXXXX.
  select case
           when v ~ '^\+[1-9][0-9]{7,14}$'  then v
           when v ~ '^00[1-9][0-9]{7,14}$'  then '+' || substr(v, 3)
           when v ~ '^971[0-9]{8,9}$'       then '+' || v
           when v ~ '^0[1-9][0-9]{7,8}$'    then '+971' || substr(v, 2)
           else null
         end
    from (select regexp_replace(coalesce(p_raw, ''), '[[:space:]().-]', '', 'g') as v) s;
$fn$;
revoke all on function public.nexus_api_e164(text) from public, anon, authenticated;
grant execute on function public.nexus_api_e164(text) to service_role;

create or replace function public.nexus_api_ensure_endpoint(p_tenant uuid, p_source_key text)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare v_pk text;
begin
  if p_source_key not in ('api','api_call') then
    raise exception using errcode = 'P0001', message = 'Not an API source.', detail = 'NX_API_SOURCE_UNKNOWN';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nx1013:endpoint:' || p_tenant::text || ':' || p_source_key, 0));
  select e.public_key into v_pk from public.lead_ingest_endpoint e
   where e.tenant_id = p_tenant and e.source_key = p_source_key
     and e.environment = 'production' and e.status = 'active'
   order by e.created_at limit 1;
  if v_pk is not null then return v_pk; end if;
  v_pk := p_source_key || '_' || encode(extensions.gen_random_bytes(18), 'hex');
  insert into public.lead_ingest_endpoint
    (tenant_id, source_key, required_provenance_for_source, declared_provenance,
     provenance_counts_as_real, environment, public_key, label, rate_limit_per_minute)
  values
    (p_tenant, p_source_key, 'api_client_key', 'api_client_key', true, 'production', v_pk,
     case p_source_key when 'api' then 'NEXUS public API (dealer DMS/CRM)'
                       else 'NEXUS public API (dealer call system)' end, 120);
  return v_pk;
end;
$fn$;
revoke all on function public.nexus_api_ensure_endpoint(uuid, text) from public, anon, authenticated;
grant execute on function public.nexus_api_ensure_endpoint(uuid, text) to service_role;

create or replace function public.nexus_api_lead_json(p_tenant uuid, p_lead_id integer)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select jsonb_build_object(
    'id',               l.id,
    'name',             l.name,
    'email',            l.email,
    'phone',            l.phone,
    'source',           l.source,
    'vehicle_interest', l.vehicle_interest,
    'budget_aed',       l.budget_aed,
    'status',           l.status,
    'ai_score',         l.ai_score,
    'scoring_state',    l.scoring_state,
    'assigned_to_id',   l.assigned_to_id,
    'assigned_to',      l.assigned_to,
    'external_id',      (select substr(e.external_event_id, 5) from public.lead_event e
                          where e.tenant_id = l.tenant_id and e.lead_id = l.id
                            and e.source_key = 'api' and e.external_event_id like 'api:%'
                          order by e.received_at limit 1),
    'created_at',       l.created_at,
    'updated_at',       coalesce(c.changed_at, l.created_at))
  from public.leads l
  left join public.api_lead_clock c on c.lead_id = l.id
  where l.tenant_id = p_tenant and l.id = p_lead_id;
$fn$;
revoke all on function public.nexus_api_lead_json(uuid, integer) from public, anon, authenticated;
grant execute on function public.nexus_api_lead_json(uuid, integer) to service_role;

create or replace function public.nexus_api_appointment_json(p_tenant uuid, p_appointment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select jsonb_build_object(
    'id',               a.appointment_id,
    'lead_id',          a.lead_id,
    'customer_id',      a.customer_id,
    'inventory_id',     a.inventory_id,
    'state',            a.state,
    'channel',          a.channel,
    'starts_at',        a.starts_at,
    'ends_at',          a.ends_at,
    'duration_minutes', a.duration_minutes,
    'location',         a.location,
    'assigned_to_id',   a.assigned_to_id,
    'notes',            a.notes,
    'outcome_reason',   a.outcome_reason,
    'requested_at',     a.requested_at,
    'confirmed_at',     a.confirmed_at,
    'closed_at',        a.closed_at,
    'created_at',       a.created_at,
    'updated_at',       a.updated_at)
  from public.appointment a
  where a.tenant_id = p_tenant and a.appointment_id = p_appointment_id;
$fn$;
revoke all on function public.nexus_api_appointment_json(uuid, uuid) from public, anon, authenticated;
grant execute on function public.nexus_api_appointment_json(uuid, uuid) to service_role;

create or replace function public.nexus_webhook_url_defect(p_url text)
returns text
language plpgsql
immutable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare v_url text := btrim(coalesce(p_url, '')); v_host text;
begin
  if v_url = '' then return 'NX_WEBHOOK_URL_REQUIRED'; end if;
  if length(v_url) > 2048 then return 'NX_WEBHOOK_URL_TOO_LONG'; end if;
  -- Same anchored host class as NX1010: no '@', no credentials, no spaces.
  if v_url !~ '^https://[a-zA-Z0-9.-]+(:[0-9]{1,5})?(/[^[:space:]]*)?$' then
    return 'NX_WEBHOOK_URL_SHAPE';
  end if;
  v_host := lower((regexp_match(v_url, '^https://([a-zA-Z0-9.-]+)'))[1]);
  if v_host !~ '\.' or v_host ~ '^[0-9.]+$'
     or v_host = 'localhost' or v_host ~ '\.(localhost|local|internal|lan|home|arpa)$' then
    return 'NX_WEBHOOK_URL_HOST';
  end if;
  return null;
end;
$fn$;
revoke all on function public.nexus_webhook_url_defect(text) from public, anon, authenticated;
grant execute on function public.nexus_webhook_url_defect(text) to service_role;

create or replace function public.nexus_webhook_enqueue_to(p_webhook_id uuid, p_tenant uuid, p_event text, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare v_id uuid := gen_random_uuid(); v_now timestamptz := now();
begin
  insert into public.outbound_webhook_delivery (delivery_id, webhook_id, tenant_id, event, payload)
  values (v_id, p_webhook_id, p_tenant, p_event,
          jsonb_build_object('id', v_id, 'type', p_event, 'created_at', v_now,
                             'tenant_id', p_tenant, 'data', coalesce(p_data, '{}'::jsonb)));
  return v_id;
end;
$fn$;
revoke all on function public.nexus_webhook_enqueue_to(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.nexus_webhook_enqueue_to(uuid, uuid, text, jsonb) to service_role;

create or replace function public.nexus_webhook_enqueue(p_tenant uuid, p_event text, p_data jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare r record; n integer := 0;
begin
  for r in select w.webhook_id from public.outbound_webhook w
            where w.tenant_id = p_tenant and w.status = 'active' and p_event = any (w.events) loop
    perform public.nexus_webhook_enqueue_to(r.webhook_id, p_tenant, p_event, p_data);
    n := n + 1;
  end loop;
  return n;
end;
$fn$;
revoke all on function public.nexus_webhook_enqueue(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.nexus_webhook_enqueue(uuid, text, jsonb) to service_role;

-- ===========================================================================
-- 4. Dashboard RPCs (authenticated, caller's own dealership)
-- ===========================================================================
create or replace function public.nexus_api_keys_list()
returns table(key_id uuid, name text, key_prefix text, scopes text[], created_at timestamptz,
              last_used_at timestamptz, revoked_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
#variable_conflict use_column
declare v_t uuid := public.nexus_api_caller_tenant(false);
begin
  return query
    select k.key_id, k.name, k.key_prefix, k.scopes, k.created_at, k.last_used_at, k.revoked_at
      from public.api_client_key k
     where k.tenant_id = v_t
     order by (k.revoked_at is null) desc, k.created_at desc;
end;
$fn$;
revoke all on function public.nexus_api_keys_list() from public, anon, authenticated;
grant execute on function public.nexus_api_keys_list() to authenticated, service_role;

create or replace function public.nexus_api_key_create(p_name text, p_scopes text[] default null)
returns table(key_id uuid, key_prefix text, api_key_once text)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
#variable_conflict use_column
declare
  v_t       uuid := public.nexus_api_caller_tenant(true);
  v_allowed text[] := array['leads:read','leads:write','inventory:read','inventory:write','calls:write','appointments:read'];
  v_scopes  text[];
  v_key     text;
  v_id      uuid;
  v_name    text := btrim(coalesce(p_name, ''));
begin
  if v_name = '' or length(v_name) > 80 then
    raise exception using errcode = 'P0001',
      message = 'Give the key a name of 1-80 characters, e.g. the system that will use it.',
      detail  = 'NX_API_KEY_NAME';
  end if;
  select array_agg(distinct s order by s) into v_scopes
    from unnest(coalesce(p_scopes, v_allowed)) s where s is not null;
  if v_scopes is null or not (v_scopes <@ v_allowed) then
    raise exception using errcode = 'P0001',
      message = 'Unknown scope. Allowed: ' || array_to_string(v_allowed, ', ') || '.',
      detail  = 'NX_API_SCOPE_UNKNOWN';
  end if;
  if (select count(*) from public.api_client_key k where k.tenant_id = v_t and k.revoked_at is null) >= 25 then
    raise exception using errcode = 'P0001',
      message = 'This dealership already has 25 active API keys. Revoke one first.',
      detail  = 'NX_API_KEY_LIMIT';
  end if;

  v_key := 'nxk_live_' || encode(extensions.gen_random_bytes(20), 'hex');
  insert into public.api_client_key (tenant_id, name, key_prefix, key_hash, scopes, created_by)
  values (v_t, v_name, left(v_key, 13), encode(extensions.digest(v_key, 'sha256'), 'hex'), v_scopes, auth.uid())
  returning public.api_client_key.key_id into v_id;

  perform public.nexus_api_ensure_endpoint(v_t, 'api');
  perform public.nexus_api_ensure_endpoint(v_t, 'api_call');

  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('NEXUS API', 'SUCCESS',
          format('API key %s... "%s" created with scopes %s', left(v_key, 13), v_name, array_to_string(v_scopes, ',')),
          v_t);

  return query select v_id, left(v_key, 13), v_key;
end;
$fn$;
revoke all on function public.nexus_api_key_create(text, text[]) from public, anon, authenticated;
grant execute on function public.nexus_api_key_create(text, text[]) to authenticated, service_role;

create or replace function public.nexus_api_key_revoke(p_key_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare v_t uuid := public.nexus_api_caller_tenant(true); v_prefix text;
begin
  select k.key_prefix into v_prefix from public.api_client_key k
   where k.key_id = p_key_id and k.tenant_id = v_t;
  if v_prefix is null then
    raise exception using errcode = 'P0001', message = 'No such API key at this dealership.',
      detail = 'NX_API_NOT_FOUND';
  end if;
  update public.api_client_key k set revoked_at = now()
   where k.key_id = p_key_id and k.tenant_id = v_t and k.revoked_at is null;
  if found then
    insert into public.audit_log (workflow, status, summary, tenant_id)
    values ('NEXUS API', 'SUCCESS', format('API key %s... revoked', v_prefix), v_t);
  end if;
end;
$fn$;
revoke all on function public.nexus_api_key_revoke(uuid) from public, anon, authenticated;
grant execute on function public.nexus_api_key_revoke(uuid) to authenticated, service_role;

create or replace function public.nexus_webhooks_list()
returns table(webhook_id uuid, url text, events text[], status text, consecutive_failures integer,
              created_at timestamptz, last_delivery_at timestamptz, deliveries_24h bigint, failures_24h bigint)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
#variable_conflict use_column
declare v_t uuid := public.nexus_api_caller_tenant(false);
begin
  return query
    select w.webhook_id, w.url, w.events, w.status, w.consecutive_failures, w.created_at, w.last_delivery_at,
           (select count(*) from public.outbound_webhook_delivery d
             where d.webhook_id = w.webhook_id and d.created_at > now() - interval '24 hours'),
           (select count(*) from public.outbound_webhook_delivery d
             where d.webhook_id = w.webhook_id and d.created_at > now() - interval '24 hours'
               and d.status in ('failed','dead'))
      from public.outbound_webhook w
     where w.tenant_id = v_t
     order by w.created_at desc;
end;
$fn$;
revoke all on function public.nexus_webhooks_list() from public, anon, authenticated;
grant execute on function public.nexus_webhooks_list() to authenticated, service_role;

create or replace function public.nexus_webhook_create(p_url text, p_events text[])
returns table(webhook_id uuid, signing_secret_once text)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
#variable_conflict use_column
declare
  v_t       uuid := public.nexus_api_caller_tenant(true);
  v_allowed text[] := array['lead.created','lead.updated','lead.scored','appointment.created',
                            'appointment.updated','message.received','ping'];
  v_events  text[];
  v_defect  text := public.nexus_webhook_url_defect(p_url);
  v_secret  text;
  v_wid     uuid := gen_random_uuid();
  v_sid     uuid;
begin
  if v_defect is not null then
    raise exception using errcode = 'P0001',
      message = 'The webhook URL must be a public https:// address (no credentials, no IP literal, no localhost or internal host).',
      detail  = v_defect;
  end if;
  select array_agg(distinct e order by e) into v_events from unnest(p_events) e where e is not null;
  if v_events is null or not (v_events <@ v_allowed) then
    raise exception using errcode = 'P0001',
      message = 'Choose at least one event. Allowed: ' || array_to_string(v_allowed, ', ') || '.',
      detail  = 'NX_WEBHOOK_EVENT_UNKNOWN';
  end if;
  if (select count(*) from public.outbound_webhook w where w.tenant_id = v_t) >= 10 then
    raise exception using errcode = 'P0001',
      message = 'This dealership already has 10 webhooks. Delete one first.',
      detail  = 'NX_WEBHOOK_LIMIT';
  end if;

  v_secret := 'whsec_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_sid := vault.create_secret(v_secret, 'nexus_outbound_webhook_' || v_wid::text,
                               'NEXUS outbound webhook signing secret (NX1013).');
  insert into public.outbound_webhook (webhook_id, tenant_id, url, events, vault_secret_id, created_by)
  values (v_wid, v_t, btrim(p_url), v_events, v_sid, auth.uid());

  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('NEXUS API', 'SUCCESS',
          format('Webhook %s created for events %s', v_wid, array_to_string(v_events, ',')), v_t);

  return query select v_wid, v_secret;
end;
$fn$;
revoke all on function public.nexus_webhook_create(text, text[]) from public, anon, authenticated;
grant execute on function public.nexus_webhook_create(text, text[]) to authenticated, service_role;

create or replace function public.nexus_webhook_delete(p_webhook_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare v_t uuid := public.nexus_api_caller_tenant(true); v_sid uuid;
begin
  select w.vault_secret_id into v_sid from public.outbound_webhook w
   where w.webhook_id = p_webhook_id and w.tenant_id = v_t;
  if v_sid is null then
    raise exception using errcode = 'P0001', message = 'No such webhook at this dealership.',
      detail = 'NX_API_NOT_FOUND';
  end if;
  delete from public.outbound_webhook w where w.webhook_id = p_webhook_id and w.tenant_id = v_t;
  begin
    delete from vault.secrets s where s.id = v_sid;
  exception when insufficient_privilege then
    -- Could not remove the vault row: destroy the material instead.
    perform vault.update_secret(v_sid, encode(extensions.gen_random_bytes(32), 'hex'));
  end;
  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('NEXUS API', 'SUCCESS', format('Webhook %s deleted', p_webhook_id), v_t);
end;
$fn$;
revoke all on function public.nexus_webhook_delete(uuid) from public, anon, authenticated;
grant execute on function public.nexus_webhook_delete(uuid) to authenticated, service_role;

create or replace function public.nexus_webhook_send_test(p_webhook_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare v_t uuid := public.nexus_api_caller_tenant(true);
begin
  -- A test also re-arms a webhook that was auto-disabled after 20 failures:
  -- "send test" is exactly what a dealer does after fixing their receiver.
  update public.outbound_webhook w set status = 'active', consecutive_failures = 0
   where w.webhook_id = p_webhook_id and w.tenant_id = v_t;
  if not found then
    raise exception using errcode = 'P0001', message = 'No such webhook at this dealership.',
      detail = 'NX_API_NOT_FOUND';
  end if;
  return public.nexus_webhook_enqueue_to(p_webhook_id, v_t, 'ping',
           jsonb_build_object('webhook_id', p_webhook_id, 'message', 'Test delivery from NEXUS.'));
end;
$fn$;
revoke all on function public.nexus_webhook_send_test(uuid) from public, anon, authenticated;
grant execute on function public.nexus_webhook_send_test(uuid) to authenticated, service_role;

create or replace function public.nexus_webhook_deliveries(p_webhook_id uuid, p_limit integer default 20)
returns table(delivery_id uuid, event text, status text, attempts integer, last_status_code integer,
              created_at timestamptz, delivered_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
#variable_conflict use_column
declare v_t uuid := public.nexus_api_caller_tenant(false);
begin
  if not exists (select 1 from public.outbound_webhook w where w.webhook_id = p_webhook_id and w.tenant_id = v_t) then
    raise exception using errcode = 'P0001', message = 'No such webhook at this dealership.',
      detail = 'NX_API_NOT_FOUND';
  end if;
  return query
    select d.delivery_id, d.event, d.status, d.attempts, d.last_status_code, d.created_at, d.delivered_at
      from public.outbound_webhook_delivery d
     where d.webhook_id = p_webhook_id and d.tenant_id = v_t
     order by d.created_at desc
     limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$fn$;
revoke all on function public.nexus_webhook_deliveries(uuid, integer) from public, anon, authenticated;
grant execute on function public.nexus_webhook_deliveries(uuid, integer) to authenticated, service_role;

-- ===========================================================================
-- 5. Service-role RPCs for the api-v1 edge function
-- ===========================================================================
create or replace function public.nexus_api_authenticate(p_key text)
returns table(tenant_id uuid, key_id uuid, scopes text[])
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
#variable_conflict use_column
declare r record;
begin
  if p_key is null or p_key !~ '^nxk_live_[0-9a-f]{40}$' then return; end if;
  select k.key_id as kid, k.tenant_id as tid, k.scopes as sc, k.last_used_at as lu into r
    from public.api_client_key k
    join public.tenants t on t.id = k.tenant_id and t.status = 'active'
   where k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
     and k.revoked_at is null;
  if not found then return; end if;
  if r.lu is null or r.lu < now() - interval '1 minute' then
    update public.api_client_key k set last_used_at = now() where k.key_id = r.kid;
  end if;
  return query select r.tid, r.kid, r.sc;
end;
$fn$;
revoke all on function public.nexus_api_authenticate(text) from public, anon, authenticated;
grant execute on function public.nexus_api_authenticate(text) to service_role;

create or replace function public.nexus_api_rate_limit_hit(p_key_id uuid, p_limit integer default 120)
returns table(allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
#variable_conflict use_column
declare v_w timestamptz := date_trunc('minute', now()); v_hits integer; v_lim integer := greatest(1, coalesce(p_limit, 120));
begin
  insert into public.api_rate_window as r (key_id, window_start, hits)
  values (p_key_id, v_w, 1)
  on conflict on constraint api_rate_window_pkey do update set hits = r.hits + 1
  returning r.hits into v_hits;
  if random() < 0.02 then
    delete from public.api_rate_window r where r.window_start < now() - interval '1 hour';
  end if;
  return query select v_hits <= v_lim, greatest(v_lim - v_hits, 0), v_w + interval '1 minute';
end;
$fn$;
revoke all on function public.nexus_api_rate_limit_hit(uuid, integer) from public, anon, authenticated;
grant execute on function public.nexus_api_rate_limit_hit(uuid, integer) to service_role;

create or replace function public.nexus_api_me(p_tenant uuid, p_key_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select jsonb_build_object(
    'tenant', jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug),
    'key',    jsonb_build_object('id', k.key_id, 'name', k.name, 'prefix', k.key_prefix,
                                 'scopes', to_jsonb(k.scopes), 'created_at', k.created_at))
    from public.api_client_key k join public.tenants t on t.id = k.tenant_id
   where k.key_id = p_key_id and k.tenant_id = p_tenant;
$fn$;
revoke all on function public.nexus_api_me(uuid, uuid) from public, anon, authenticated;
grant execute on function public.nexus_api_me(uuid, uuid) to service_role;

create or replace function public.nexus_api_leads_list(p_tenant uuid, p_updated_since timestamptz default null,
                                                       p_limit integer default 50, p_cursor text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_cts timestamptz; v_cid integer; m text[];
  r record; v_data jsonb := '[]'::jsonb; v_n integer := 0; v_next text; v_more boolean := false;
begin
  if p_cursor is not null then
    m := regexp_match(p_cursor, '^([0-9]{1,19})\.([0-9]{1,10})$');
    if m is null then
      raise exception using errcode = 'P0001', message = 'Malformed cursor.', detail = 'NX_API_CURSOR_INVALID';
    end if;
    v_cts := 'epoch'::timestamptz + (m[1]::bigint * interval '1 microsecond');
    v_cid := m[2]::integer;
  end if;
  for r in
    select l.id, coalesce(c.changed_at, l.created_at, 'epoch'::timestamptz) as u
      from public.leads l left join public.api_lead_clock c on c.lead_id = l.id
     where l.tenant_id = p_tenant
       and (p_updated_since is null or coalesce(c.changed_at, l.created_at, 'epoch'::timestamptz) >= p_updated_since)
       and (v_cts is null or (coalesce(c.changed_at, l.created_at, 'epoch'::timestamptz), l.id) > (v_cts, v_cid))
     order by 2, 1
     limit v_limit + 1
  loop
    v_n := v_n + 1;
    if v_n > v_limit then v_more := true; exit; end if;
    v_data := v_data || jsonb_build_array(public.nexus_api_lead_json(p_tenant, r.id));
    v_next := ((extract(epoch from r.u) * 1000000)::bigint)::text || '.' || r.id::text;
  end loop;
  return jsonb_build_object('data', v_data, 'next_cursor', case when v_more then v_next end);
end;
$fn$;
revoke all on function public.nexus_api_leads_list(uuid, timestamptz, integer, text) from public, anon, authenticated;
grant execute on function public.nexus_api_leads_list(uuid, timestamptz, integer, text) to service_role;

create or replace function public.nexus_api_lead_get(p_tenant uuid, p_lead_id integer)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select public.nexus_api_lead_json(p_tenant, p_lead_id);
$fn$;
revoke all on function public.nexus_api_lead_get(uuid, integer) from public, anon, authenticated;
grant execute on function public.nexus_api_lead_get(uuid, integer) to service_role;

create or replace function public.nexus_api_lead_create(p_tenant uuid, p_payload jsonb, p_external_id text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_ext   text := nullif(btrim(coalesce(p_external_id, p_payload->>'external_id', '')), '');
  v_name  text := nullif(btrim(coalesce(p_payload->>'name', p_payload->>'full_name', '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_payload->>'email', ''))), '');
  v_rawph text := nullif(btrim(coalesce(p_payload->>'phone', '')), '');
  v_phone text;
  v_occ   timestamptz;
  v_norm  jsonb; v_rec record; v_prom record; v_ev record; v_lead integer;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = 'P0001', message = 'The body must be a JSON object.', detail = 'NX_API_BODY_NOT_OBJECT';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant and t.status = 'active') then
    raise exception using errcode = 'P0001', message = 'Dealership is not active.', detail = 'NX_API_NO_DEALERSHIP';
  end if;
  if v_ext is null then
    v_ext := 'gen-' || gen_random_uuid()::text;   -- no idempotency asked for: every call is a new arrival
  elsif v_ext !~ '^[A-Za-z0-9._:@/-]{1,200}$' then
    raise exception using errcode = 'P0001',
      message = 'external_id / Idempotency-Key must be 1-200 characters of letters, digits and ._:@/-',
      detail = 'NX_API_EXTERNAL_ID_INVALID';
  end if;
  if v_name is null or length(v_name) > 200 then
    raise exception using errcode = 'P0001', message = 'name is required (1-200 characters).', detail = 'NX_API_NAME_REQUIRED';
  end if;
  if v_rawph is not null then
    v_phone := public.nexus_api_e164(v_rawph);
    if v_phone is null then
      raise exception using errcode = 'P0001', message = 'phone must be an E.164 number such as +971501234567.',
        detail = 'NX_API_PHONE_INVALID';
    end if;
  end if;
  if v_email is null and v_phone is null then
    raise exception using errcode = 'P0001', message = 'A lead needs an email or a phone.', detail = 'NX_API_CONTACT_REQUIRED';
  end if;
  if p_payload ? 'budget_aed' and jsonb_typeof(p_payload->'budget_aed') not in ('number','null') then
    raise exception using errcode = 'P0001', message = 'budget_aed must be a number.', detail = 'NX_API_BUDGET_INVALID';
  end if;
  if jsonb_typeof(p_payload->'budget_aed') = 'number'
     and ((p_payload->>'budget_aed')::numeric < 0 or (p_payload->>'budget_aed')::numeric > 100000000) then
    raise exception using errcode = 'P0001', message = 'budget_aed must be between 0 and 100,000,000.', detail = 'NX_API_BUDGET_INVALID';
  end if;
  if coalesce(p_payload->>'occurred_at', '') <> '' then
    begin
      v_occ := (p_payload->>'occurred_at')::timestamptz;
    exception when others then
      raise exception using errcode = 'P0001', message = 'occurred_at must be an ISO-8601 timestamp.', detail = 'NX_API_OCCURRED_AT_INVALID';
    end;
  end if;

  v_norm := jsonb_strip_nulls(jsonb_build_object(
    'full_name',        v_name,
    'email',            v_email,
    'phone_e164',       v_phone,
    'vehicle_interest', nullif(left(btrim(coalesce(p_payload->>'vehicle_interest', '')), 200), ''),
    'budget_aed',       case when jsonb_typeof(p_payload->'budget_aed') = 'number'
                             then to_jsonb(round((p_payload->>'budget_aed')::numeric)::integer) end));

  select * into v_rec from public.nexus_record_lead_event(
    public.nexus_api_ensure_endpoint(p_tenant, 'api'),
    'api:' || v_ext,
    'api_client_key',
    jsonb_strip_nulls(jsonb_build_object(
      'received_via',  'nexus_public_api',
      'notes',         nullif(left(btrim(coalesce(p_payload->>'notes', '')), 2000), ''),
      'source_detail', nullif(left(btrim(coalesce(p_payload->>'source_detail', '')), 120), ''),
      'received_at',   now())),
    coalesce(v_occ, now()),
    v_norm);

  select e.event_id, e.phase, e.lead_id, e.normalized into v_ev from public.lead_event e where e.event_id = v_rec.event_id;

  if v_ev.lead_id is not null then
    return jsonb_build_object('lead', public.nexus_api_lead_json(p_tenant, v_ev.lead_id),
                              'created', false, 'duplicate_of', 'external_id');
  end if;
  if v_ev.phase = 'DUPLICATE' then
    select l.id into v_lead from public.leads l
     where l.tenant_id = p_tenant and l.email = (v_ev.normalized->>'email');
    return jsonb_build_object('lead', public.nexus_api_lead_json(p_tenant, v_lead),
                              'created', false, 'duplicate_of', 'email');
  end if;

  begin
    select * into v_prom from public.nexus_promote_lead_event(v_rec.event_id);
  exception when unique_violation then
    -- leads_tenant_email_key: this dealership already has a lead with that email.
    select l.id into v_lead from public.leads l
     where l.tenant_id = p_tenant and l.email = (v_ev.normalized->>'email');
    update public.lead_event e set phase = 'DUPLICATE',
           disposition_reason = 'EMAIL_ALREADY_A_LEAD:' || coalesce(v_lead::text, '?')
     where e.event_id = v_rec.event_id;
    return jsonb_build_object('lead', public.nexus_api_lead_json(p_tenant, v_lead),
                              'created', false, 'duplicate_of', 'email');
  end;

  return jsonb_build_object('lead', public.nexus_api_lead_json(p_tenant, v_prom.lead_id),
                            'created', not v_prom.was_already_promoted, 'duplicate_of',
                            case when v_prom.was_already_promoted then 'external_id' end);
end;
$fn$;
revoke all on function public.nexus_api_lead_create(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.nexus_api_lead_create(uuid, jsonb, text) to service_role;

create or replace function public.nexus_api_lead_update(p_tenant uuid, p_lead_id integer, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_allowed text[] := array['status','assigned_to_id','vehicle_interest','budget_aed','notes'];
  v_bad     text;
  v_status  text; v_assignee uuid; v_vi text; v_budget integer; v_name text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception using errcode = 'P0001', message = 'The body must be a non-empty JSON object.', detail = 'NX_API_BODY_NOT_OBJECT';
  end if;
  select string_agg(k, ', ' order by k) into v_bad from jsonb_object_keys(p_patch) k where k <> all (v_allowed);
  if v_bad is not null then
    raise exception using errcode = 'P0001',
      message = 'Not updatable: ' || v_bad || '. Updatable fields: ' || array_to_string(v_allowed, ', ') || '.',
      detail = 'NX_API_FIELD_NOT_UPDATABLE';
  end if;

  select l.name into v_name from public.leads l where l.tenant_id = p_tenant and l.id = p_lead_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'No such lead.', detail = 'NX_API_NOT_FOUND';
  end if;

  if p_patch ? 'status' then
    v_status := btrim(coalesce(p_patch->>'status', ''));
    if jsonb_typeof(p_patch->'status') <> 'string' or v_status !~ '^[A-Za-z][A-Za-z_ -]{0,31}$' then
      raise exception using errcode = 'P0001', message = 'status must be a word of 1-32 letters (e.g. HOT, WARM, COLD, WON, LOST).',
        detail = 'NX_API_STATUS_INVALID';
    end if;
  end if;
  if p_patch ? 'assigned_to_id' and jsonb_typeof(p_patch->'assigned_to_id') <> 'null' then
    begin
      v_assignee := (p_patch->>'assigned_to_id')::uuid;
    exception when others then
      raise exception using errcode = 'P0001', message = 'assigned_to_id must be a uuid or null.', detail = 'NX_API_ASSIGNEE_INVALID';
    end;
    if not exists (select 1 from public.users u where u.id = v_assignee and u.tenant_id = p_tenant) then
      raise exception using errcode = 'P0001', message = 'assigned_to_id is not a salesperson at this dealership.',
        detail = 'NX_API_ASSIGNEE_INVALID';
    end if;
  end if;
  if p_patch ? 'vehicle_interest' and jsonb_typeof(p_patch->'vehicle_interest') not in ('string','null') then
    raise exception using errcode = 'P0001', message = 'vehicle_interest must be a string or null.', detail = 'NX_API_VEHICLE_INTEREST_INVALID';
  end if;
  v_vi := nullif(left(btrim(coalesce(p_patch->>'vehicle_interest', '')), 200), '');
  if p_patch ? 'budget_aed' and jsonb_typeof(p_patch->'budget_aed') <> 'null' then
    if jsonb_typeof(p_patch->'budget_aed') <> 'number'
       or (p_patch->>'budget_aed')::numeric < 0 or (p_patch->>'budget_aed')::numeric > 100000000 then
      raise exception using errcode = 'P0001', message = 'budget_aed must be a number between 0 and 100,000,000, or null.',
        detail = 'NX_API_BUDGET_INVALID';
    end if;
    v_budget := round((p_patch->>'budget_aed')::numeric)::integer;
  end if;
  if p_patch ? 'notes' and (jsonb_typeof(p_patch->'notes') <> 'string' or length(p_patch->>'notes') > 2000) then
    raise exception using errcode = 'P0001', message = 'notes must be a string of at most 2000 characters.', detail = 'NX_API_NOTES_INVALID';
  end if;

  perform set_config('nexus.change_reason', 'Changed by the dealership''s own system through the NEXUS API', true);
  update public.leads l set
    status           = case when p_patch ? 'status' then v_status else l.status end,
    assigned_to_id   = case when p_patch ? 'assigned_to_id' then v_assignee else l.assigned_to_id end,
    assigned_to      = case when p_patch ? 'assigned_to_id'
                            then (select u.name from public.users u where u.id = v_assignee)
                            else l.assigned_to end,
    vehicle_interest = case when p_patch ? 'vehicle_interest' then v_vi else l.vehicle_interest end,
    budget_aed       = case when p_patch ? 'budget_aed' then v_budget else l.budget_aed end
   where l.tenant_id = p_tenant and l.id = p_lead_id;

  -- leads has no notes column; a note is an audit row against the lead, which
  -- is where every "what happened to this lead" reader already looks.
  if p_patch ? 'notes' and btrim(p_patch->>'notes') <> '' then
    insert into public.audit_log (workflow, status, lead_name, summary, tenant_id)
    values ('api:lead-note', 'SUCCESS', v_name,
            'Note on lead ' || p_lead_id::text || ' from the dealer system: ' || btrim(p_patch->>'notes'), p_tenant);
  end if;

  return public.nexus_api_lead_json(p_tenant, p_lead_id);
end;
$fn$;
revoke all on function public.nexus_api_lead_update(uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.nexus_api_lead_update(uuid, integer, jsonb) to service_role;

create or replace function public.nexus_api_inventory_list(p_tenant uuid, p_status text default null,
                                                           p_limit integer default 100, p_cursor text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_after text; r record; v_data jsonb := '[]'::jsonb; v_n integer := 0; v_last text; v_more boolean := false;
begin
  if p_cursor is not null then
    begin
      if p_cursor !~ '^([0-9a-f]{2}){1,128}$' then raise exception 'bad'; end if;
      v_after := convert_from(decode(p_cursor, 'hex'), 'UTF8');
    exception when others then
      raise exception using errcode = 'P0001', message = 'Malformed cursor.', detail = 'NX_API_CURSOR_INVALID';
    end;
  end if;
  for r in
    select i.id, i.vin, i.model, i.status, i.price_aed, i.days_in_stock, i.acquired_at, i.aging_alert
      from public.inventory i
     where i.tenant_id = p_tenant
       and (p_status is null or lower(i.status) = lower(p_status))
       and (v_after is null or i.id > v_after)
     order by i.id
     limit v_limit + 1
  loop
    v_n := v_n + 1;
    if v_n > v_limit then v_more := true; exit; end if;
    v_data := v_data || jsonb_build_array(jsonb_build_object(
      'stock_number', r.id, 'vin', r.vin, 'model', r.model, 'status', r.status,
      'price_aed', r.price_aed, 'days_in_stock', r.days_in_stock, 'acquired_at', r.acquired_at,
      'aging_alert', r.aging_alert));
    v_last := r.id;
  end loop;
  return jsonb_build_object('data', v_data,
    'next_cursor', case when v_more then encode(convert_to(v_last, 'UTF8'), 'hex') end);
end;
$fn$;
revoke all on function public.nexus_api_inventory_list(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.nexus_api_inventory_list(uuid, text, integer, text) to service_role;

create or replace function public.nexus_api_inventory_upsert(p_tenant uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_items jsonb; v_it jsonb; v_idx integer := -1;
  v_stock text; v_vin text; v_id text; v_model text; v_status text;
  v_price integer; v_cost integer; v_acq date; v_n integer;
  v_results jsonb := '[]'::jsonb; v_created integer := 0; v_updated integer := 0; v_failed integer := 0;
  v_detail text; v_msg text;
begin
  if not exists (select 1 from public.tenants t where t.id = p_tenant and t.status = 'active') then
    raise exception using errcode = 'P0001', message = 'Dealership is not active.', detail = 'NX_API_NO_DEALERSHIP';
  end if;
  v_items := case jsonb_typeof(p_payload) when 'array' then p_payload
                                          when 'object' then jsonb_build_array(p_payload) end;
  if v_items is null or jsonb_array_length(v_items) = 0 or jsonb_array_length(v_items) > 500 then
    raise exception using errcode = 'P0001', message = 'Send one vehicle object or an array of 1-500.',
      detail = 'NX_API_INVENTORY_BATCH_SIZE';
  end if;

  for v_it in select value from jsonb_array_elements(v_items) loop
    v_idx := v_idx + 1;
    v_stock := null; v_vin := null;
    begin
      if jsonb_typeof(v_it) <> 'object' then
        raise exception using errcode = 'P0001', message = 'Each vehicle must be an object.', detail = 'NX_API_INVENTORY_ITEM';
      end if;
      v_stock := nullif(btrim(coalesce(v_it->>'stock_number', '')), '');
      v_vin   := nullif(upper(btrim(coalesce(v_it->>'vin', ''))), '');
      if v_stock is not null and v_stock !~ '^[A-Za-z0-9._/-]{1,64}$' then
        raise exception using errcode = 'P0001', message = 'stock_number must be 1-64 of letters, digits and ._/-', detail = 'NX_API_STOCK_NUMBER_INVALID';
      end if;
      if v_vin is not null and v_vin !~ '^[A-HJ-NPR-Z0-9]{11,17}$' then
        raise exception using errcode = 'P0001', message = 'vin must be 11-17 characters (no I, O or Q).', detail = 'NX_API_VIN_INVALID';
      end if;
      if v_stock is null and v_vin is null then
        raise exception using errcode = 'P0001', message = 'Each vehicle needs a stock_number or a vin.', detail = 'NX_API_VEHICLE_KEY_REQUIRED';
      end if;
      v_model := nullif(left(btrim(coalesce(v_it->>'model', '')), 120), '');
      v_status := nullif(left(btrim(coalesce(v_it->>'status', '')), 40), '');
      v_price := null; v_cost := null; v_acq := null;
      if v_it ? 'price_aed' and jsonb_typeof(v_it->'price_aed') <> 'null' then
        if jsonb_typeof(v_it->'price_aed') <> 'number' or (v_it->>'price_aed')::numeric < 0
           or (v_it->>'price_aed')::numeric > 100000000 then
          raise exception using errcode = 'P0001', message = 'price_aed must be a number 0-100,000,000.', detail = 'NX_API_PRICE_INVALID';
        end if;
        v_price := round((v_it->>'price_aed')::numeric)::integer;
      end if;
      if v_it ? 'cost_aed' and jsonb_typeof(v_it->'cost_aed') <> 'null' then
        if jsonb_typeof(v_it->'cost_aed') <> 'number' or (v_it->>'cost_aed')::numeric < 0
           or (v_it->>'cost_aed')::numeric > 100000000 then
          raise exception using errcode = 'P0001', message = 'cost_aed must be a number 0-100,000,000.', detail = 'NX_API_COST_INVALID';
        end if;
        v_cost := round((v_it->>'cost_aed')::numeric)::integer;
      end if;
      if coalesce(v_it->>'acquired_at', '') <> '' then
        begin
          v_acq := (v_it->>'acquired_at')::date;
        exception when others then
          raise exception using errcode = 'P0001', message = 'acquired_at must be a date (YYYY-MM-DD).', detail = 'NX_API_ACQUIRED_AT_INVALID';
        end;
      end if;

      v_id := null;
      if v_stock is not null then
        select i.id into v_id from public.inventory i where i.tenant_id = p_tenant and i.id = v_stock;
      else
        select count(*) into v_n from public.inventory i where i.tenant_id = p_tenant and upper(i.vin) = v_vin;
        if v_n > 1 then
          raise exception using errcode = 'P0001', message = 'More than one vehicle has this vin; send its stock_number.',
            detail = 'NX_API_VIN_AMBIGUOUS';
        end if;
        select i.id into v_id from public.inventory i where i.tenant_id = p_tenant and upper(i.vin) = v_vin;
      end if;

      if v_id is null then
        if v_model is null then
          raise exception using errcode = 'P0001', message = 'model is required for a new vehicle.', detail = 'NX_API_MODEL_REQUIRED';
        end if;
        insert into public.inventory (tenant_id, id, model, vin, status, price_aed, cost_aed, acquired_at)
        values (p_tenant, coalesce(v_stock, v_vin), v_model, v_vin, coalesce(v_status, 'Available'),
                v_price, v_cost, coalesce(v_acq, current_date));
        v_created := v_created + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'index', v_idx, 'stock_number', coalesce(v_stock, v_vin), 'action', 'created'));
      else
        update public.inventory i set
          model       = coalesce(v_model, i.model),
          vin         = coalesce(v_vin, i.vin),
          status      = coalesce(v_status, i.status),
          price_aed   = case when v_it ? 'price_aed' then v_price else i.price_aed end,
          cost_aed    = case when v_it ? 'cost_aed' then v_cost else i.cost_aed end,
          acquired_at = coalesce(v_acq, i.acquired_at)
         where i.tenant_id = p_tenant and i.id = v_id;
        v_updated := v_updated + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'index', v_idx, 'stock_number', v_id, 'action', 'updated'));
      end if;
    exception when others then
      get stacked diagnostics v_detail = pg_exception_detail, v_msg = message_text;
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'index', v_idx, 'stock_number', coalesce(v_stock, v_vin), 'action', 'error',
        'error', jsonb_build_object(
          'code', case when v_detail like 'NX\_API\_%' then v_detail else 'NX_API_INVENTORY_ROW_REJECTED' end,
          'message', case when v_detail like 'NX\_API\_%' then v_msg else 'The row was refused by the database.' end)));
    end;
  end loop;

  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('api:inventory-sync', case when v_failed = 0 then 'SUCCESS' else 'PARTIAL' end,
          format('Inventory sync from the dealer system: %s created, %s updated, %s rejected', v_created, v_updated, v_failed),
          p_tenant);

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'failed', v_failed, 'results', v_results);
end;
$fn$;
revoke all on function public.nexus_api_inventory_upsert(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.nexus_api_inventory_upsert(uuid, jsonb) to service_role;

create or replace function public.nexus_api_call_log(p_tenant uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_ext  text := nullif(btrim(coalesce(p_payload->>'external_call_id', '')), '');
  v_dir  text := lower(btrim(coalesce(p_payload->>'direction', '')));
  v_from text := nullif(left(btrim(coalesce(p_payload->>'from_number', '')), 40), '');
  v_to   text := nullif(left(btrim(coalesce(p_payload->>'to_number', '')), 40), '');
  v_rec_url text := nullif(btrim(coalesce(p_payload->>'recording_url', '')), '');
  v_cust text; v_dur integer; v_start timestamptz; v_lead integer; v_created boolean := false;
  v_existing record; v_rec record; v_prom record; v_call uuid; v_name text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = 'P0001', message = 'The body must be a JSON object.', detail = 'NX_API_BODY_NOT_OBJECT';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant and t.status = 'active') then
    raise exception using errcode = 'P0001', message = 'Dealership is not active.', detail = 'NX_API_NO_DEALERSHIP';
  end if;
  if v_ext is null or v_ext !~ '^[A-Za-z0-9._:@/-]{1,200}$' then
    raise exception using errcode = 'P0001', message = 'external_call_id is required (1-200 of letters, digits and ._:@/-).',
      detail = 'NX_API_EXTERNAL_CALL_ID_INVALID';
  end if;
  if v_dir not in ('inbound','outbound') then
    raise exception using errcode = 'P0001', message = 'direction must be inbound or outbound.', detail = 'NX_API_CALL_DIRECTION_INVALID';
  end if;
  v_cust := public.nexus_api_e164(case when v_dir = 'inbound' then v_from else v_to end);
  if v_cust is null then
    raise exception using errcode = 'P0001',
      message = 'The customer''s number (from_number for inbound, to_number for outbound) must be a valid phone number.',
      detail = 'NX_API_CALL_CUSTOMER_PHONE_INVALID';
  end if;
  if p_payload ? 'duration_sec' and jsonb_typeof(p_payload->'duration_sec') <> 'null' then
    if jsonb_typeof(p_payload->'duration_sec') <> 'number' or (p_payload->>'duration_sec')::numeric < 0
       or (p_payload->>'duration_sec')::numeric > 86400 then
      raise exception using errcode = 'P0001', message = 'duration_sec must be 0-86400.', detail = 'NX_API_CALL_DURATION_INVALID';
    end if;
    v_dur := round((p_payload->>'duration_sec')::numeric)::integer;
  end if;
  if v_rec_url is not null and (v_rec_url !~ '^https://[^[:space:]]+$' or length(v_rec_url) > 2048) then
    raise exception using errcode = 'P0001', message = 'recording_url must be an https:// URL.', detail = 'NX_API_CALL_RECORDING_URL_INVALID';
  end if;
  if coalesce(p_payload->>'started_at', '') <> '' then
    begin
      v_start := (p_payload->>'started_at')::timestamptz;
    exception when others then
      raise exception using errcode = 'P0001', message = 'started_at must be an ISO-8601 timestamp.', detail = 'NX_API_CALL_STARTED_AT_INVALID';
    end;
    if v_start > now() + interval '1 day' then
      raise exception using errcode = 'P0001', message = 'started_at is in the future.', detail = 'NX_API_CALL_STARTED_AT_INVALID';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nx1013:call:' || p_tenant::text || ':' || v_ext, 0));
  -- And on the customer's number, so two different calls from a caller NEXUS
  -- has never seen cannot race each other into two leads.
  perform pg_advisory_xact_lock(hashtextextended('nx1013:phone:' || p_tenant::text || ':' || v_cust, 0));
  select c.call_id, c.lead_id, c.lead_created into v_existing from public.api_call_log c
   where c.tenant_id = p_tenant and c.external_call_id = v_ext;
  if found then
    return jsonb_build_object('call_id', v_existing.call_id, 'lead_id', v_existing.lead_id,
                              'lead_created', v_existing.lead_created, 'was_duplicate', true);
  end if;

  select l.id into v_lead from public.leads l
   where l.tenant_id = p_tenant
     and regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') = substr(v_cust, 2)
   order by l.created_at desc nulls last, l.id desc
   limit 1;

  if v_lead is null then
    v_name := nullif(left(btrim(coalesce(p_payload->>'caller_name', '')), 200), '');
    select * into v_rec from public.nexus_record_lead_event(
      public.nexus_api_ensure_endpoint(p_tenant, 'api_call'),
      'call:' || v_ext,
      'api_client_key',
      jsonb_strip_nulls(jsonb_build_object('received_via', 'nexus_public_api', 'direction', v_dir,
                                           'duration_sec', v_dur, 'started_at', v_start)),
      coalesce(v_start, now()),
      jsonb_build_object('full_name', coalesce(v_name, 'Caller ' || v_cust), 'phone_e164', v_cust));
    select * into v_prom from public.nexus_promote_lead_event(v_rec.event_id);
    v_lead := v_prom.lead_id;
    v_created := not v_prom.was_already_promoted;
  end if;

  insert into public.api_call_log (tenant_id, external_call_id, lead_id, direction, from_number, to_number,
                                   customer_phone_e164, duration_sec, recording_url, started_at, lead_created)
  values (p_tenant, v_ext, v_lead, v_dir, v_from, v_to, v_cust, v_dur, v_rec_url, v_start, v_created)
  returning public.api_call_log.call_id into v_call;

  return jsonb_build_object('call_id', v_call, 'lead_id', v_lead, 'lead_created', v_created, 'was_duplicate', false);
end;
$fn$;
revoke all on function public.nexus_api_call_log(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.nexus_api_call_log(uuid, jsonb) to service_role;

create or replace function public.nexus_api_appointments_list(p_tenant uuid, p_updated_since timestamptz default null,
                                                              p_state text default null, p_limit integer default 50,
                                                              p_cursor text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_cts timestamptz; v_cid uuid; m text[];
  r record; v_data jsonb := '[]'::jsonb; v_n integer := 0; v_next text; v_more boolean := false;
begin
  if p_cursor is not null then
    m := regexp_match(p_cursor, '^([0-9]{1,19})\.([0-9a-f-]{36})$');
    if m is null then
      raise exception using errcode = 'P0001', message = 'Malformed cursor.', detail = 'NX_API_CURSOR_INVALID';
    end if;
    v_cts := 'epoch'::timestamptz + (m[1]::bigint * interval '1 microsecond');
    v_cid := m[2]::uuid;
  end if;
  for r in
    select a.appointment_id, a.updated_at
      from public.appointment a
     where a.tenant_id = p_tenant
       and (p_updated_since is null or a.updated_at >= p_updated_since)
       and (p_state is null or a.state = upper(p_state))
       and (v_cts is null or (a.updated_at, a.appointment_id) > (v_cts, v_cid))
     order by a.updated_at, a.appointment_id
     limit v_limit + 1
  loop
    v_n := v_n + 1;
    if v_n > v_limit then v_more := true; exit; end if;
    v_data := v_data || jsonb_build_array(public.nexus_api_appointment_json(p_tenant, r.appointment_id));
    v_next := ((extract(epoch from r.updated_at) * 1000000)::bigint)::text || '.' || r.appointment_id::text;
  end loop;
  return jsonb_build_object('data', v_data, 'next_cursor', case when v_more then v_next end);
end;
$fn$;
revoke all on function public.nexus_api_appointments_list(uuid, timestamptz, text, integer, text) from public, anon, authenticated;
grant execute on function public.nexus_api_appointments_list(uuid, timestamptz, text, integer, text) to service_role;

-- ===========================================================================
-- 6. Service-role RPCs for the webhook dispatcher
-- ===========================================================================
create or replace function public.nexus_webhook_claim_deliveries(p_limit integer default 50)
returns table(delivery_id uuid, webhook_id uuid, tenant_id uuid, url text, secret text, event text,
              payload jsonb, attempts integer)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
#variable_conflict use_column
begin
  -- Claiming counts the attempt and takes a 5-minute lease (next_attempt_at),
  -- so a dispatcher that dies mid-send is retried instead of stranding the row.
  return query
    with picked as (
      select d.delivery_id as did
        from public.outbound_webhook_delivery d
        join public.outbound_webhook w on w.webhook_id = d.webhook_id and w.status = 'active'
       where d.status in ('pending','failed') and d.next_attempt_at <= now()
       order by d.next_attempt_at
       limit greatest(1, least(coalesce(p_limit, 50), 200))
       for update of d skip locked
    ), upd as (
      update public.outbound_webhook_delivery d
         set attempts = d.attempts + 1, next_attempt_at = now() + interval '5 minutes'
        from picked p
       where d.delivery_id = p.did
      returning d.delivery_id as did, d.webhook_id as wid, d.tenant_id as tid, d.event as ev,
                d.payload as pl, d.attempts as att
    )
    select u.did, u.wid, u.tid, w.url, s.decrypted_secret::text, u.ev, u.pl, u.att
      from upd u
      join public.outbound_webhook w on w.webhook_id = u.wid
      left join vault.decrypted_secrets s on s.id = w.vault_secret_id;
end;
$fn$;
revoke all on function public.nexus_webhook_claim_deliveries(integer) from public, anon, authenticated;
grant execute on function public.nexus_webhook_claim_deliveries(integer) to service_role;

create or replace function public.nexus_webhook_mark_delivery(p_delivery_id uuid, p_ok boolean,
                                                              p_status_code integer default null,
                                                              p_error text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  d record; v_fails integer;
  v_backoff interval[] := array['1 minute','5 minutes','30 minutes','2 hours','6 hours','12 hours','24 hours']::interval[];
begin
  select x.delivery_id, x.webhook_id, x.tenant_id, x.status, x.attempts into d
    from public.outbound_webhook_delivery x where x.delivery_id = p_delivery_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'No such delivery.', detail = 'NX_API_NOT_FOUND';
  end if;
  if d.status in ('delivered','dead') then return; end if;   -- settled already: idempotent

  if coalesce(p_ok, false) then
    update public.outbound_webhook_delivery x
       set status = 'delivered', delivered_at = now(), last_status_code = p_status_code, last_error = null
     where x.delivery_id = p_delivery_id;
    update public.outbound_webhook w set consecutive_failures = 0, last_delivery_at = now()
     where w.webhook_id = d.webhook_id;
    return;
  end if;

  update public.outbound_webhook_delivery x
     set status = case when d.attempts >= 8 then 'dead' else 'failed' end,
         next_attempt_at = now() + v_backoff[least(greatest(d.attempts, 1), 7)],
         last_status_code = p_status_code,
         last_error = left(regexp_replace(coalesce(p_error, ''), '[[:cntrl:]]', ' ', 'g'), 500)
   where x.delivery_id = p_delivery_id;

  update public.outbound_webhook w set consecutive_failures = w.consecutive_failures + 1
   where w.webhook_id = d.webhook_id
  returning w.consecutive_failures into v_fails;

  if v_fails >= 20 then
    update public.outbound_webhook w set status = 'disabled'
     where w.webhook_id = d.webhook_id and w.status = 'active';
    if found then
      update public.outbound_webhook_delivery x
         set status = 'dead', last_error = 'Webhook disabled after 20 consecutive failures.'
       where x.webhook_id = d.webhook_id and x.status in ('pending','failed');
      insert into public.audit_log (workflow, status, summary, tenant_id)
      values ('NEXUS API', 'FAILED',
              format('Webhook %s disabled after 20 consecutive failed deliveries', d.webhook_id), d.tenant_id);
    end if;
  end if;
end;
$fn$;
revoke all on function public.nexus_webhook_mark_delivery(uuid, boolean, integer, text) from public, anon, authenticated;
grant execute on function public.nexus_webhook_mark_delivery(uuid, boolean, integer, text) to service_role;

-- ===========================================================================
-- 7. Triggers: keep the lead clock and enqueue deliveries. Never fail the write.
-- ===========================================================================
create or replace function public.nexus_api_on_lead_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare v_event text;
begin
  begin
    if tg_op = 'UPDATE' and row(new.name, new.email, new.phone, new.source, new.vehicle_interest, new.budget_aed,
                                new.status, new.ai_score, new.scoring_state, new.assigned_to_id, new.assigned_to)
                        is not distinct from
                            row(old.name, old.email, old.phone, old.source, old.vehicle_interest, old.budget_aed,
                                old.status, old.ai_score, old.scoring_state, old.assigned_to_id, old.assigned_to) then
      return null;
    end if;
    insert into public.api_lead_clock (lead_id, tenant_id, changed_at)
    values (new.id, new.tenant_id, now())
    on conflict (lead_id) do update set changed_at = excluded.changed_at, tenant_id = excluded.tenant_id;

    v_event := case
      when tg_op = 'INSERT' then 'lead.created'
      when new.scoring_state = 'SCORED'
           and (old.scoring_state is distinct from 'SCORED' or new.ai_score is distinct from old.ai_score) then 'lead.scored'
      else 'lead.updated' end;

    if exists (select 1 from public.outbound_webhook w
                where w.tenant_id = new.tenant_id and w.status = 'active' and v_event = any (w.events)) then
      perform public.nexus_webhook_enqueue(new.tenant_id, v_event, public.nexus_api_lead_json(new.tenant_id, new.id));
    end if;
  exception when others then
    raise warning 'nexus_api_on_lead_change: % (lead %)', sqlstate, new.id;
  end;
  return null;
end;
$fn$;
revoke all on function public.nexus_api_on_lead_change() from public, anon, authenticated;

drop trigger if exists nexus_api_lead_change_trg on public.leads;
create trigger nexus_api_lead_change_trg
  after insert or update on public.leads
  for each row execute function public.nexus_api_on_lead_change();

create or replace function public.nexus_api_on_appointment_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare v_event text := case when tg_op = 'INSERT' then 'appointment.created' else 'appointment.updated' end;
begin
  begin
    if exists (select 1 from public.outbound_webhook w
                where w.tenant_id = new.tenant_id and w.status = 'active' and v_event = any (w.events)) then
      perform public.nexus_webhook_enqueue(new.tenant_id, v_event,
                public.nexus_api_appointment_json(new.tenant_id, new.appointment_id));
    end if;
  exception when others then
    raise warning 'nexus_api_on_appointment_change: % (appointment %)', sqlstate, new.appointment_id;
  end;
  return null;
end;
$fn$;
revoke all on function public.nexus_api_on_appointment_change() from public, anon, authenticated;

drop trigger if exists nexus_api_appointment_change_trg on public.appointment;
create trigger nexus_api_appointment_change_trg
  after insert or update on public.appointment
  for each row execute function public.nexus_api_on_appointment_change();

create or replace function public.nexus_api_on_message_received()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
begin
  begin
    if lower(coalesce(new.direction_key, new.direction, '')) <> 'inbound' then
      return null;
    end if;
    if exists (select 1 from public.outbound_webhook w
                where w.tenant_id = new.tenant_id and w.status = 'active' and 'message.received' = any (w.events)) then
      perform public.nexus_webhook_enqueue(new.tenant_id, 'message.received', jsonb_build_object(
        'id',          new.id,
        'channel',     coalesce(new.channel_key, new.channel),
        'lead_id',     (select l.id from public.leads l
                         where l.tenant_id = new.tenant_id and new.lead_email is not null and l.email = new.lead_email
                         limit 1),
        'lead_email',  new.lead_email,
        'message',     new.message,
        'created_at',  new.created_at));
    end if;
  exception when others then
    raise warning 'nexus_api_on_message_received: % (message %)', sqlstate, new.id;
  end;
  return null;
end;
$fn$;
revoke all on function public.nexus_api_on_message_received() from public, anon, authenticated;

drop trigger if exists nexus_api_message_received_trg on public.communication_logs;
create trigger nexus_api_message_received_trg
  after insert on public.communication_logs
  for each row execute function public.nexus_api_on_message_received();

-- ===========================================================================
-- 8. Verify the ACL we meant is the ACL we got
-- ===========================================================================
do $verify$
declare f text;
begin
  foreach f in array array[
    'public.nexus_api_caller_tenant(boolean)', 'public.nexus_api_e164(text)',
    'public.nexus_api_ensure_endpoint(uuid,text)', 'public.nexus_api_lead_json(uuid,integer)',
    'public.nexus_api_appointment_json(uuid,uuid)', 'public.nexus_webhook_url_defect(text)',
    'public.nexus_webhook_enqueue_to(uuid,uuid,text,jsonb)', 'public.nexus_webhook_enqueue(uuid,text,jsonb)',
    'public.nexus_api_authenticate(text)', 'public.nexus_api_rate_limit_hit(uuid,integer)',
    'public.nexus_api_me(uuid,uuid)', 'public.nexus_api_leads_list(uuid,timestamptz,integer,text)',
    'public.nexus_api_lead_get(uuid,integer)', 'public.nexus_api_lead_create(uuid,jsonb,text)',
    'public.nexus_api_lead_update(uuid,integer,jsonb)', 'public.nexus_api_inventory_list(uuid,text,integer,text)',
    'public.nexus_api_inventory_upsert(uuid,jsonb)', 'public.nexus_api_call_log(uuid,jsonb)',
    'public.nexus_api_appointments_list(uuid,timestamptz,text,integer,text)',
    'public.nexus_webhook_claim_deliveries(integer)', 'public.nexus_webhook_mark_delivery(uuid,boolean,integer,text)',
    'public.nexus_api_on_lead_change()', 'public.nexus_api_on_appointment_change()',
    'public.nexus_api_on_message_received()']
  loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'NX1013 verify: % is reachable by anon or authenticated', f;
    end if;
  end loop;
  foreach f in array array[
    'public.nexus_api_keys_list()', 'public.nexus_api_key_create(text,text[])', 'public.nexus_api_key_revoke(uuid)',
    'public.nexus_webhooks_list()', 'public.nexus_webhook_create(text,text[])', 'public.nexus_webhook_delete(uuid)',
    'public.nexus_webhook_send_test(uuid)', 'public.nexus_webhook_deliveries(uuid,integer)']
  loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'NX1013 verify: % is reachable by anon', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'NX1013 verify: % is not reachable by authenticated', f;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.api_client_key', 'select')
     or has_table_privilege('authenticated', 'public.api_client_key', 'select')
     or has_table_privilege('authenticated', 'public.outbound_webhook', 'select') then
    raise exception 'NX1013 verify: an API table is directly readable by a client role';
  end if;
end
$verify$;
