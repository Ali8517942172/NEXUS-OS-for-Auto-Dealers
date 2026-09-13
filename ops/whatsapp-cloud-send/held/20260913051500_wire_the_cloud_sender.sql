-- ============================================================================
-- HELD MIGRATION -- NOT APPLIED. Review, then apply deliberately.
-- ops/whatsapp-cloud-send/held/20260913051500_wire_the_cloud_sender.sql
--
-- Wiring the WhatsApp Cloud SEND seam.
--
-- Read this first, because it changes what you expected to find:
--
--   The send seam is ALREADY REACHABLE. Measured read-only on prod
--   dsvuoovivysszdoiorch, 2026-09-13:
--     * EXECUTE on nexus_request_send, nexus_route_message and
--       nexus_record_send_result is granted to postgres and service_role.
--       n8n writes as service_role. Nothing needed granting.
--     * channel_registry already holds an active whatsapp_cloud_phone_number_id
--       row (external_identifier 1306545252542419) for tenant
--       fff6a2b5-cfd5-4460-8383-875bc5826de0, and nexus_route_message already
--       selects it ahead of WAHA: provider_rank 10 vs 90, is_official_platform
--       true, selection_order 1.
--
--   So this migration does NOT re-register the channel and does NOT re-grant
--   what is already granted. It does three things the measurement showed are
--   actually missing or wrong:
--
--     1. Records the SEND ENDPOINT IDENTITY -- Graph host, API version, phone
--        number id, WABA id, and the NAME of the env var holding the sending
--        token -- as a row that can be read and audited, rather than as a
--        string inside an n8n node.
--     2. Corrects channel_registry.credential_ref for the Cloud row, which
--        currently reads 'env:META_APP_SECRET+META_WA_TOKEN'. Both halves are
--        wrong for sending: META_APP_SECRET is the RECEIVER's HMAC signing
--        secret, and META_WA_TOKEN names no env var this repo sets.
--     3. Adds a readiness view so that "why did nothing send?" has one answer
--        in one place instead of four separate queries.
--
--   No ALTER TABLE on an EXISTING table anywhere in this file. Every structural
--   change is a CREATE TABLE, because ALTER on this deployment has stripped
--   dashboard write grants before. The single ALTER is ENABLE ROW LEVEL
--   SECURITY on the table created five lines above it -- a table that has no
--   grants yet to strip. The one existing-row change is a guarded UPDATE,
--   which is DML and touches no grant. Section 5 verifies the grants that
--   matter rather than assuming them.
--
--   security_invoker is declared INLINE in the CREATE VIEW. A following
--   ALTER VIEW ... SET (security_invoker = on) returns 42501 here.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Where a send actually leaves from, and which token it leaves with.
--
-- The token trap this table exists to make impossible: META_PAGE_ACCESS_TOKEN
-- in this repo holds the LEAD ADS Page token, scope leads_retrieval. It cannot
-- send a WhatsApp message; pointed at /messages it answers 190 or 200. Cloud
-- messaging needs a System User token scoped whatsapp_business_messaging --
-- a different token on a different object in Business Manager. The constraint
-- below makes a production Cloud endpoint that names the Lead Ads token a row
-- that cannot exist, so the mistake is refused by the database rather than
-- discovered by a customer not receiving a message.
-- ---------------------------------------------------------------------------
create table if not exists public.channel_send_endpoint (
  send_endpoint_id      uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  integration_id        uuid not null references public.channel_registry(integration_id) on delete restrict,
  provider              text not null,
  environment           text not null default 'production',

  -- The address. Held as data so an API-version bump is a reviewed row change
  -- with a date on it, not a string edited inside an n8n node nobody diffs.
  api_host              text not null default 'graph.facebook.com',
  api_version           text not null default 'v21.0',
  phone_number_id       text not null,
  waba_id               text,

  -- The NAME of the env var. Never the value. Nothing in this schema, this
  -- migration, or this folder handles a secret.
  token_env_var         text not null,
  token_scope_required  text not null default 'whatsapp_business_messaging',

  status                text not null default 'active',
  note                  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint channel_send_endpoint_one_active_per_integration
    unique (integration_id, environment),

  constraint channel_send_endpoint_provider
    check (provider in ('whatsapp_cloud')),
  constraint channel_send_endpoint_environment
    check (environment in ('production','simulation')),
  constraint channel_send_endpoint_status
    check (status in ('active','disabled')),

  -- A phone number id is Meta's numeric object id, not a phone number. If
  -- somebody files +971... here the send URL is wrong and Graph 404s, so the
  -- shape is refused up front. (Same discipline as the customer_phone CHECK on
  -- channel_message_events that the '+' defect tripped.)
  constraint channel_send_endpoint_phone_number_id_shape
    check (phone_number_id ~ '^[0-9]{5,32}$'),

  constraint channel_send_endpoint_api_version_shape
    check (api_version ~ '^v[0-9]{1,3}\.[0-9]{1,3}$'),

  -- The trap, encoded.
  constraint channel_send_endpoint_not_the_lead_ads_token
    check (token_env_var not in ('META_PAGE_ACCESS_TOKEN','META_APP_SECRET','META_WEBHOOK_VERIFY_TOKEN')),

  constraint channel_send_endpoint_token_env_var_shape
    check (token_env_var ~ '^[A-Z][A-Z0-9_]{5,63}$'),

  -- A production Cloud endpoint must name the messaging scope. A row that
  -- claims leads_retrieval can send nothing, and should not be filed as if it
  -- could.
  constraint channel_send_endpoint_production_needs_messaging_scope
    check (environment <> 'production' or token_scope_required = 'whatsapp_business_messaging')
);

comment on table public.channel_send_endpoint is
  'Where an outbound message physically leaves from, and the NAME of the env var holding the token it leaves with -- never the value. One active row per integration per environment. Read by ops/whatsapp-cloud-send/send.workflow.json (which resolves the phone number id from the routing directive and the token from $env by this name).';
comment on column public.channel_send_endpoint.token_env_var is
  'The NAME of an environment variable. META_PAGE_ACCESS_TOKEN is CHECK-refused here: in this repo it holds the Lead Ads Page token (scope leads_retrieval), which cannot send a WhatsApp message. Cloud messaging needs a System User token scoped whatsapp_business_messaging.';

alter table public.channel_send_endpoint enable row level security;

-- Fail closed. This is backend configuration; an end-user role has no business
-- reading which env var carries the sending token, and outbound is already a
-- backend-only path (nexus_request_send raises 42501 for authenticated/anon).
drop policy if exists channel_send_endpoint_backend_only on public.channel_send_endpoint;
create policy channel_send_endpoint_backend_only
  on public.channel_send_endpoint
  for all to service_role
  using (true) with check (true);

grant select, insert, update on public.channel_send_endpoint to service_role;

-- ---------------------------------------------------------------------------
-- 2. The row for the dealership that is already registered.
--
-- Sourced from the measurement, not from a guess:
--   integration_id 9129126e-da78-4340-a89d-ca703b9fc169
--   tenant_id      fff6a2b5-cfd5-4460-8383-875bc5826de0
--   phone number id 1306545252542419  (channel_registry.external_identifier)
--
-- waba_id is left NULL on purpose. NEXUS has not observed it: the receiver
-- reads it off an inbound payload and channel_message_events has 0 rows, so
-- there is no value to copy. NULL is "nobody has said", which is the truth.
-- ---------------------------------------------------------------------------
insert into public.channel_send_endpoint
  (tenant_id, integration_id, provider, environment,
   api_host, api_version, phone_number_id, waba_id,
   token_env_var, token_scope_required, status, note)
select r.tenant_id,
       r.integration_id,
       'whatsapp_cloud',
       'production',
       'graph.facebook.com',
       'v21.0',
       r.external_identifier,
       null,
       'META_WA_SYSTEM_USER_TOKEN',
       'whatsapp_business_messaging',
       'active',
       'Filed by ops/whatsapp-cloud-send. The token name is deliberately NOT META_PAGE_ACCESS_TOKEN, which holds the Lead Ads Page token in this repo. waba_id is NULL because NEXUS has never observed an inbound Cloud event (channel_message_events = 0 rows as of 2026-09-13, see the phone-plus defect) -- fill it in when the receiver starts writing, do not paste it from a dashboard screenshot.'
  from public.channel_registry r
 where r.channel_type = 'whatsapp_cloud_phone_number_id'
   and r.status = 'active'
on conflict (integration_id, environment) do nothing;

-- Refuse to finish quietly if that matched nothing. A migration that wires a
-- sender and files no endpoint has not wired a sender.
do $$
declare n integer;
begin
  select count(*) into n from public.channel_send_endpoint
   where provider = 'whatsapp_cloud' and status = 'active' and environment = 'production';
  if n = 0 then
    raise exception 'wire_the_cloud_sender: no active whatsapp_cloud send endpoint was filed. Expected at least one active channel_registry row with channel_type = whatsapp_cloud_phone_number_id. Register the dealership Cloud identity first with nexus_register_channel(), then re-run.';
  end if;
  raise notice 'wire_the_cloud_sender: % active whatsapp_cloud send endpoint(s) filed.', n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The credential_ref correction. DML, not DDL -- no grant is touched.
--
-- Guarded: it changes only the exact wrong value that was measured, so a row
-- someone has since corrected by hand is left alone, and a silent no-op is
-- reported rather than assumed.
-- ---------------------------------------------------------------------------
do $$
declare n integer;
begin
  update public.channel_registry
     set credential_ref = 'env:META_WA_SYSTEM_USER_TOKEN',
         updated_at     = now()
   where channel_type   = 'whatsapp_cloud_phone_number_id'
     and credential_ref = 'env:META_APP_SECRET+META_WA_TOKEN';
  get diagnostics n = row_count;

  if n = 0 then
    raise notice 'wire_the_cloud_sender: credential_ref was not the measured wrong value; left untouched. Check it by hand -- it must name the SENDING token, not META_APP_SECRET (which is the receiver''s HMAC signing secret).';
  else
    raise notice 'wire_the_cloud_sender: corrected credential_ref on % Cloud registry row(s). It named META_APP_SECRET (a signing secret, not a send credential) and META_WA_TOKEN (an env var this repo does not set).', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. One place to answer "why did nothing send?".
--
-- security_invoker declared INLINE. A trailing ALTER VIEW ... SET
-- (security_invoker = on) returns 42501 on this deployment, which is how a
-- view ends up silently running as its definer.
-- ---------------------------------------------------------------------------
create or replace view public.v_whatsapp_cloud_send_readiness
with (security_invoker = on) as
select
  e.tenant_id,
  t.slug                                       as tenant_slug,
  e.integration_id,
  e.phone_number_id,
  'https://' || e.api_host || '/' || e.api_version || '/' || e.phone_number_id || '/messages'
                                               as send_url,
  e.token_env_var,
  e.waba_id is not null                        as waba_id_observed,

  -- The three gates, each answered separately so nobody has to guess which one
  -- is shut.
  (select pr.verification_status = 'VERIFIED'
     from public.v_policy_rule pr
    where pr.rule_name = 'WA_CUSTOMER_SERVICE_WINDOW_HOURS'
    limit 1)                                   as window_rule_attested,

  (select count(*) from public.whatsapp_conversation_state c
    where c.tenant_id = e.tenant_id)::int      as conversations_measured,

  (select count(*) from public.whatsapp_templates w
    where w.tenant_id = e.tenant_id)::int      as templates_known,

  (select count(*) from public.channel_message_events m
    where m.tenant_id = e.tenant_id
      and m.provider = 'whatsapp_cloud')::int  as inbound_cloud_events,

  (select count(*) from public.channel_send_directive d
    where d.tenant_id = e.tenant_id
      and d.send_result = 'ACCEPTED_BY_PROVIDER')::int as sends_accepted,

  case
    when (select count(*) from public.channel_message_events m
           where m.tenant_id = e.tenant_id and m.provider = 'whatsapp_cloud') = 0
      then 'NO INBOUND CLOUD EVENT HAS EVER BEEN RECORDED. Until the receiver writes, every conversation is UNKNOWN and unknown is not open. Check ops/whatsapp-cloud-send/phone-plus-defect.patch first -- a leading + on customer_phone fails a CHECK and takes the whole inbound path down silently.'
    when coalesce((select pr.verification_status = 'VERIFIED'
                     from public.v_policy_rule pr
                    where pr.rule_name = 'WA_CUSTOMER_SERVICE_WINDOW_HOURS' limit 1), false) = false
      then 'THE 24-HOUR WINDOW RULE IS NOT ATTESTED. Free-form stays refused until someone with the Meta account calls policy_platform_verify_rule(). This is the seam working, not the seam broken.'
    when (select count(*) from public.whatsapp_templates w where w.tenant_id = e.tenant_id) = 0
      then 'NO TEMPLATE IS KNOWN TO NEXUS. Outside an open window only a Meta-approved template may be sent, so every out-of-window send refuses TEMPLATE_NOT_SENDABLE. That refusal is correct and is recorded.'
    else 'No structural blocker. A refusal from here on is a per-conversation policy decision; read channel_send_directive.reason.'
  end                                          as what_is_stopping_a_send

from public.channel_send_endpoint e
join public.tenants t on t.id = e.tenant_id
where e.status = 'active';

comment on view public.v_whatsapp_cloud_send_readiness is
  'Why nothing is sending, in one row per Cloud endpoint. security_invoker is ON, so it shows the caller only what the caller may see.';

grant select on public.v_whatsapp_cloud_send_readiness to service_role;

-- ---------------------------------------------------------------------------
-- 5. Verify, rather than assume, that the send path is executable.
--
-- Nothing above ALTERs a table, so no grant should have been stripped -- but
-- "should have" is what this deployment has been wrong about before, so the
-- transaction refuses to commit unless service_role can still execute all
-- three RPCs the sender depends on.
-- ---------------------------------------------------------------------------
do $$
declare missing text;
begin
  select string_agg(f, ', ')
    into missing
    from (values ('nexus_request_send'), ('nexus_route_message'), ('nexus_record_send_result')) v(f)
   where not exists (
     select 1 from information_schema.routine_privileges rp
      where rp.routine_schema = 'public'
        and rp.routine_name   = v.f
        and rp.grantee        = 'service_role'
        and rp.privilege_type = 'EXECUTE');

  if missing is not null then
    raise exception 'wire_the_cloud_sender: service_role cannot EXECUTE: %. n8n writes as service_role; without this the sender cannot route, cannot record a refusal, and cannot record a failure. Refusing to commit a half-wired send path.', missing;
  end if;

  if not exists (select 1 from information_schema.table_privileges
                  where table_schema = 'public'
                    and table_name   = 'channel_send_endpoint'
                    and grantee      = 'service_role'
                    and privilege_type = 'SELECT') then
    raise exception 'wire_the_cloud_sender: service_role cannot SELECT channel_send_endpoint. Re-assert the grant and re-run.';
  end if;

  raise notice 'wire_the_cloud_sender: grants verified. service_role can execute all three send RPCs and read the endpoint table.';
end $$;

commit;

-- ============================================================================
-- After applying, this should read as one row and one plain sentence:
--   select * from public.v_whatsapp_cloud_send_readiness;
--
-- Expected on 2026-09-13 data: what_is_stopping_a_send names the inbound path,
-- because channel_message_events is empty. That is the '+' defect, and it is
-- fixed in ops/whatsapp-cloud-send/phone-plus-defect.patch, not here.
-- ============================================================================
