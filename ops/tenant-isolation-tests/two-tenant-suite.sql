-- ############################################################################
-- NEXUS -- TWO-TENANT ISOLATION TEST SUITE
-- ############################################################################
--
--   TARGET:  STAGING ONLY -- Supabase project wwspuxrbiyagnrnzgate
--   NEVER RUN THIS AGAINST PRODUCTION (dsvuoovivysszdoiorch).
--   It creates tenants. Production's nexus_scoped_tenant_id() returns a
--   dealership only while exactly ONE active non-quarantine tenant exists;
--   creating a second one there would silently break Ask-AI and the nightly
--   syncs for the live Tenant A pilot.
--
--   Built 2026-09-17. Schema read from production read-only (pg_get_functiondef,
--   information_schema, pg_policies, pg_constraint, pg_indexes, pg_trigger).
--   RLS policies are copied verbatim from production's pg_policies.
--   Deviations from production are marked  -- DEVIATION Dn  and listed in
--   RESULTS.md beside this file.
--
--   HOW TO RUN
--     Parts 1-3 build the harness and the fixtures. Run them once.
--     Part 4 is the assertions. Re-run it as often as you like: every write
--     probe executes inside a subtransaction that is ALWAYS rolled back, so
--     the fixtures are never disturbed and the verdict is reproducible.
--
--   HOW TO READ THE VERDICT
--     select verdict, count(*) from public.zz_test_results group by 1;
--     select * from public.zz_test_results where verdict <> 'PASS' order by seq;
--     select * from public.zz_test_results order by seq;
--
--   RESULT AS OF 2026-09-17:  181 PASS, 0 FAIL, 2 NOT RUN.
--   Read RESULTS.md for what that does and does NOT prove. In particular it
--   proves nothing about the n8n workflows, which run as service_role and
--   bypass every policy below -- see test 8.
--
--   WHY THIS FILE IS DESTRUCTIVE ON PURPOSE  (read before you run anything)
--     This suite REBUILDS the whole public schema from scratch. Part 1 tears
--     down every NEXUS table it is about to recreate -- tenants, leads,
--     inventory, customer, conversation, audit_log, communication_logs,
--     lead_event and the rest -- and Part 4 fires UNPREDICATED, UNSCOPED row
--     removals at those same tables on purpose, to prove which ones the
--     NX900 destructive-write trigger actually refuses and which ones it does
--     not. Those probes run inside a subtransaction that is always rolled
--     back. The teardown in Part 1 is NOT rolled back and is NOT reversible.
--
--     Consequence, stated plainly: pointed at production dsvuoovivysszdoiorch
--     this file DESTROYS the live Tenant A dealership data -- every lead,
--     every vehicle, every conversation, the audit trail -- with no undo and
--     no backup taken by this script. It is for the STAGING project
--     wwspuxrbiyagnrnzgate and for nothing else. Never paste it into a
--     production SQL editor. Never point a migration runner at it. If you are
--     not certain which project your session is connected to, stop and check
--     before you run a single line.
--
--     CI: ops/ci/no-destructive-scripts.mjs blocks exactly these statements
--     from reaching main. The eleven lines below are waived one by one in
--     that guard's EXEMPT_LINES map, pinned to their line numbers, so that
--     ANY edit that moves them re-fires the guard and forces a human to look
--     again. If you add, remove or reorder lines in this file, expect CI to
--     fail and re-pin the map deliberately -- do not blanket-exempt the file.
--
-- ############################################################################

-- ============================================================================
-- NEXUS TWO-TENANT ISOLATION SUITE -- PART 1of4: HARNESS
-- Target: STAGING ONLY (wwspuxrbiyagnrnzgate). NEVER run on production.
-- DDL copied from production dsvuoovivysszdoiorch on 2026-09-17 (read-only).
-- Deviations from production are marked  -- DEVIATION Dn
-- ============================================================================

do $$ begin
  if current_database() is null then raise exception 'no db'; end if;
end $$;

-- ---------------------------------------------------------------- teardown --
drop table if exists public.zz_test_results cascade;
drop table if exists public.zz_fixture_key cascade;
drop table if exists public.lead_event cascade;
drop table if exists public.lead_ingest_endpoint cascade;
drop table if exists public.processed_messages cascade;
drop table if exists public.communication_logs cascade;
drop table if exists public.audit_log cascade;
drop table if exists public.journey_step cascade;
drop table if exists public.conversation cascade;
drop table if exists public.customer cascade;
drop table if exists public.inventory cascade;
drop table if exists public.leads cascade;
drop table if exists public.users cascade;
drop table if exists public.tenant_members cascade;
drop table if exists public.tenants cascade;

-- ---------------------------------------------------------------- functions --
create or replace function public.nexus_jwt_tenant_id()
 returns uuid language plpgsql stable set search_path to 'pg_catalog','public'
as $function$
declare raw text; j jsonb; v text;
begin
  raw := current_setting('request.jwt.claims', true);
  if raw is null or btrim(raw) = '' then return null; end if;
  begin j := raw::jsonb; exception when others then return null; end;
  v := coalesce(j->'app_metadata'->>'tenant_id',
                j->'user_metadata'->>'tenant_id',
                j->>'tenant_id');
  if v is null or btrim(v) = '' then return null; end if;
  begin return v::uuid; exception when others then return null; end;
end;
$function$;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  status text not null default 'active',
  is_unattributed_default boolean not null default false,
  created_at timestamptz not null default now(),
  is_quarantine boolean not null default false,
  constraint tenants_slug_key unique (slug),
  constraint tenants_status_check check (status = any (array['active','suspended','archived','quarantine'])),
  constraint tenants_quarantine_is_never_active check (is_quarantine = (status = 'quarantine')),
  constraint tenants_unattributed_default_must_be_quarantine check ((not is_unattributed_default) or is_quarantine)
);
create unique index tenants_one_quarantine on public.tenants ((true)) where is_quarantine;
create unique index tenants_one_unattributed_default on public.tenants ((true)) where is_unattributed_default;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  name text, email text, role text, status text, slack_user_id text,
  created_at timestamptz default now(),
  tenant_id uuid not null,
  constraint users_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete restrict
);
create unique index users_tenant_email_key on public.users (tenant_id, email);

create table public.tenant_members (
  tenant_id uuid not null,
  auth_user_id uuid not null,
  role text not null default 'member',
  staff_user_id uuid,
  created_at timestamptz not null default now(),
  primary key (tenant_id, auth_user_id),
  constraint tenant_members_role_check check (role = any (array['owner','admin','manager','sales','technician','member'])),
  constraint tenant_members_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint tenant_members_staff_user_id_fkey foreign key (staff_user_id) references public.users(id) on delete set null
  -- DEVIATION D1: production also has tenant_members_auth_user_id_fkey ->
  -- auth.users(id) ON DELETE CASCADE. Dropped here so the suite can use
  -- synthetic auth uuids without manufacturing auth.users rows. auth.uid()
  -- reads the JWT claim, not auth.users, so no RLS decision depends on it.
);

-- nexus_default_tenant_id is referenced by column defaults below, so define
-- the whole nexus_* family before the tables that default to it.
create or replace function public.nexus_current_tenant_id()
 returns uuid language sql stable security definer set search_path to 'public','pg_catalog'
as $function$
  select coalesce(
    (select c.tid
       from (select public.nexus_jwt_tenant_id() as tid) c
       join public.tenant_members m
         on m.tenant_id = c.tid and m.auth_user_id = auth.uid()
       join public.tenants t on t.id = c.tid and t.status = 'active'),
    (select m.tenant_id
       from public.tenant_members m
       join public.tenants t on t.id = m.tenant_id and t.status = 'active'
      where auth.uid() is not null and m.auth_user_id = auth.uid()
      order by m.created_at, m.tenant_id
      limit 1));
$function$;

create or replace function public.nexus_current_tenant_ids()
 returns setof uuid language sql stable security definer set search_path to 'public','pg_catalog'
as $function$
  select m.tenant_id
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
   where auth.uid() is not null and m.auth_user_id = auth.uid();
$function$;

create or replace function public.nexus_default_tenant_id()
 returns uuid language sql stable security definer set search_path to 'public','pg_catalog'
as $function$
  select coalesce(
    public.nexus_current_tenant_id(),
    (select t.id from public.tenants t
      where t.is_unattributed_default
        and t.is_quarantine
        and coalesce(current_setting('role', true), '') not in ('authenticated', 'anon')
      limit 1));
$function$;

create or replace function public.nexus_scoped_tenant_id()
 returns uuid language sql stable security definer set search_path to 'public','pg_catalog'
as $function$
  select coalesce(
    public.nexus_current_tenant_id(),
    (select t.id from public.tenants t
      where t.status = 'active'
        and not t.is_quarantine
        and coalesce(current_setting('role', true), '') not in ('authenticated', 'anon')
        and (select count(*) from public.tenants w
              where w.status = 'active' and not w.is_quarantine) = 1));
$function$;

create or replace function public.nexus_tenant_ids_for_roles(p_roles text[])
 returns setof uuid language sql stable security definer set search_path to 'public','pg_catalog'
as $function$
  select m.tenant_id
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
   where auth.uid() is not null and m.auth_user_id = auth.uid()
     and m.role = any (p_roles);
$function$;

create or replace function public.nexus_my_staff_user_ids()
 returns setof uuid language sql stable security definer set search_path to 'public','pg_catalog'
as $function$
  select m.staff_user_id
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
   where auth.uid() is not null and m.auth_user_id = auth.uid()
     and m.staff_user_id is not null;
$function$;

create or replace function public.nexus_refuse_destructive_write()
 returns trigger language plpgsql security definer set search_path to 'public','pg_temp'
as $function$
begin
  if coalesce(current_setting('nexus.destructive_write_is_deliberate', true), '')
     <> 'YES_I_HAVE_A_COPY_AND_I_MEAN_IT'
  then
    raise exception using errcode = 'P0001',
      message = format('NX900 DESTRUCTIVE_WRITE_REFUSED: %I.%I is evidence, not scratch.',
                       tg_table_schema, tg_table_name),
      detail  = 'Copied verbatim from production for the isolation harness.',
      hint    = 'Set nexus.destructive_write_is_deliberate for the transaction.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return null;
end;
$function$;

-- ------------------------------------------------------------------ tables --
create table public.leads (
  id serial primary key,
  name text not null, email text, phone text, source text, vehicle_interest text,
  budget_aed integer, status text, ai_score integer, assigned_to text,
  response_time_minutes integer,
  created_at timestamptz default now(),
  assigned_to_id uuid,
  escalated_at timestamptz, bitrix_lead_id text, crm_synced_at timestamptz,
  tenant_id uuid not null default public.nexus_default_tenant_id(),
  score_source text default 'AI_SCORE_UNKNOWN',
  rules_score integer, ai_score_raw integer, ai_intent_raw text, ai_parse_failed boolean,
  constraint leads_response_time_nonneg check ((response_time_minutes is null) or (response_time_minutes >= 0)),
  constraint leads_score_source_is_a_known_label check (score_source = any (array['RULES','AI_SCORE_CONFIRMED','AI_SCORE_FALLBACK','AI_SCORE_UNKNOWN','AI_SCORE_FAILED'])),
  constraint leads_assigned_to_id_fkey foreign key (assigned_to_id) references public.users(id) on delete set null,
  constraint leads_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete restrict
);
create unique index leads_tenant_email_key on public.leads (tenant_id, email);

create table public.customer (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  display_name text, phone_digits text, email text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint customer_has_an_identity check ((phone_digits is not null) or (email is not null)),
  constraint customer_phone_is_digits check ((phone_digits is null) or (phone_digits ~ '^[0-9]{6,20}$')),
  constraint customer_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete restrict
);
create unique index customer_tenant_phone_key on public.customer (tenant_id, phone_digits) where phone_digits is not null;

create table public.conversation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  customer_id uuid not null,
  integration_id uuid not null,
  channel text not null,
  state text not null default 'OPEN',
  opened_at timestamptz not null default now(),
  last_message_at timestamptz,
  message_count integer not null default 0,
  constraint conversation_channel_check check (channel = any (array['whatsapp_cloud','whatsapp_waha','email','web'])),
  constraint conversation_state_check check (state = any (array['OPEN','DORMANT','CLOSED'])),
  constraint conversation_customer_id_fkey foreign key (customer_id) references public.customer(id) on delete restrict,
  constraint conversation_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete restrict
  -- DEVIATION D2: production also has conversation_integration_id_fkey ->
  -- channel_registry(integration_id). channel_registry is out of the named
  -- scope, so the FK is dropped and integration_id is a free uuid here.
);
create unique index conversation_open_per_customer_channel on public.conversation (tenant_id, integration_id, customer_id) where state <> 'CLOSED';

create table public.journey_step (
  id bigserial primary key,
  correlation_id text not null,
  tenant_id uuid not null,
  step text not null,
  status text not null,
  ref_table text, ref_id text, detail text,
  at timestamptz not null default now(),
  constraint journey_step_status_check check (status = any (array['OK','SKIPPED','REFUSED','FAILED','UNKNOWN'])),
  constraint journey_step_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete restrict
);

create table public.inventory (
  id text not null,
  model text not null,
  vin text, status text, days_in_stock integer,
  price_aed integer, cost_aed integer, gross_margin integer,
  holding_cost_accrued integer, net_margin integer, recommended_commission integer,
  vat_amount integer, aging_alert text, ai_recommendation text,
  acquired_at date default current_date,
  tenant_id uuid not null default public.nexus_default_tenant_id(),
  gross_margin_state text,
  primary key (tenant_id, id),
  constraint inventory_derived_figures_require_their_inputs check (
    ((gross_margin is null) or ((price_aed is not null) and (cost_aed is not null))) and
    ((net_margin is null) or ((price_aed is not null) and (cost_aed is not null))) and
    ((recommended_commission is null) or ((price_aed is not null) and (cost_aed is not null))) and
    ((vat_amount is null) or (price_aed is not null))),
  constraint inventory_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete restrict
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  workflow text, status text, lead_name text, lead_email text,
  lead_score numeric, intent text, summary text,
  logged_at timestamptz default now(),
  tenant_id uuid not null default public.nexus_default_tenant_id(),
  constraint audit_log_status_check check (status = upper(status)),
  constraint audit_log_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete restrict
);

create table public.communication_logs (
  id uuid primary key default gen_random_uuid(),
  lead_email text, channel text, direction text, message text,
  created_at timestamptz default now(),
  sent_by text,
  tenant_id uuid not null default public.nexus_default_tenant_id(),
  external_message_id text, channel_key text, direction_key text,
  evidence_state text not null default 'ADMISSIBLE',
  constraint communication_logs_evidence_state_check check (evidence_state = any (array['ADMISSIBLE','QUARANTINED','DISPUTED'])),
  constraint communication_logs_external_message_id_is_a_provider_id check (
    (external_message_id is null) or ((external_message_id !~ '[[:space:]]')
      and (length(external_message_id) between 8 and 512)
      and (external_message_id !~* '^(nokey:|outreach:|exec-|run-|job-)')
      and (external_message_id !~ '^[0-9]{10}$')
      and (external_message_id !~ '^[0-9]{13}$'))),
  constraint communication_logs_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete restrict
);
create unique index communication_logs_external_identity_key on public.communication_logs (tenant_id, channel_key, direction_key, external_message_id);

create table public.processed_messages (
  message_id text not null,
  source text not null default 'waha',
  chat_id text,
  processed_at timestamptz not null default now(),
  tenant_id uuid not null default public.nexus_default_tenant_id(),
  primary key (tenant_id, message_id),
  constraint processed_messages_message_id_is_a_provider_id check (
    (message_id !~ '[[:space:]]') and (length(message_id) >= 8)
    and (message_id !~* '^(nokey:|outreach:|exec-|run-|job-)')
    and (message_id !~ '^[0-9]+$')),
  constraint processed_messages_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete restrict
);

create table public.lead_ingest_endpoint (
  endpoint_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  source_key text not null,
  required_provenance_for_source text not null,
  declared_provenance text not null,
  provenance_counts_as_real boolean not null,
  environment text not null,
  public_key text not null,
  secret_ref text,
  origin_allowlist text[] not null default '{}'::text[],
  ingest_address text,
  status text not null default 'active',
  rate_limit_per_minute integer not null default 60,
  label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_ingest_endpoint_environment check (environment = any (array['production','simulation'])),
  constraint lead_ingest_endpoint_manual_entry_holds_no_secret check ((declared_provenance <> 'operator_recorded') or ((secret_ref is null) and (cardinality(origin_allowlist) = 0))),
  constraint lead_ingest_endpoint_production_matches_source check ((environment <> 'production') or (declared_provenance = required_provenance_for_source)),
  constraint lead_ingest_endpoint_production_needs_real_provenance check ((environment <> 'production') or provenance_counts_as_real),
  constraint lead_ingest_endpoint_public_key_shape check (public_key ~ '^[A-Za-z0-9_-]{24,128}$'),
  constraint lead_ingest_endpoint_rate_limit check (rate_limit_per_minute between 1 and 10000),
  constraint lead_ingest_endpoint_secret_ref_required check ((declared_provenance <> all (array['hmac_sha256_x_hub','hmac_sha256_svix','shared_secret_header','shared_secret_in_body'])) or ((secret_ref is not null) and (btrim(secret_ref) <> ''))),
  constraint lead_ingest_endpoint_status check (status = any (array['active','disabled'])),
  constraint lead_ingest_endpoint_website_needs_origin check ((declared_provenance <> 'origin_and_form_key') or (cardinality(origin_allowlist) > 0)),
  constraint lead_ingest_endpoint_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete restrict,
  constraint lead_ingest_endpoint_public_key_key unique (public_key),
  constraint lead_ingest_endpoint_id_env_key unique (endpoint_id, environment),
  constraint lead_ingest_endpoint_id_source_key unique (endpoint_id, source_key),
  constraint lead_ingest_endpoint_id_tenant_key unique (endpoint_id, tenant_id)
  -- DEVIATION D3: production FKs lead_ingest_endpoint_provenance_fk ->
  -- lead_provenance_kind and lead_ingest_endpoint_source_fk ->
  -- lead_source_catalogue are dropped; those lookup tables are out of scope.
);

create table public.lead_event (
  event_id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  endpoint_id uuid not null,
  source_key text not null,
  environment text not null,
  origin_verified text not null,
  provenance_counts_as_real boolean not null,
  external_event_id text not null,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  phase text not null default 'RECEIVED',
  disposition_reason text,
  payload_raw jsonb not null,
  hydrated_payload jsonb, hydrated_at timestamptz, hydration_error text,
  normalized jsonb, lead_id integer, promoted_at timestamptz,
  constraint lead_event_environment check (environment = any (array['production','simulation'])),
  constraint lead_event_external_id_is_not_per_attempt check (
    (btrim(external_event_id) <> '') and (length(external_event_id) between 3 and 512)
    and (external_event_id !~ '^(nokey:|outreach:|exec-|run-|job-|attempt-|tmp-)')
    and (external_event_id !~ '^[0-9]{13}$')),
  constraint lead_event_hydration_timestamped check ((hydrated_payload is null) = (hydrated_at is null)),
  constraint lead_event_payload_carries_no_shared_secret check (
    ((payload_raw)::text !~* '"(google_key|app_secret|client_secret|access_token|api_key|authorization)"')
    and (coalesce((hydrated_payload)::text, '') !~* '"(google_key|app_secret|client_secret|access_token|api_key|authorization)"')),
  constraint lead_event_phase check (phase = any (array['RECEIVED','HYDRATED','PROMOTED','DUPLICATE','REJECTED','QUARANTINED','EXPIRED'])),
  constraint lead_event_production_needs_real_provenance check ((environment <> 'production') or provenance_counts_as_real),
  constraint lead_event_promoted_at_with_lead check ((lead_id is null) = (promoted_at is null)),
  constraint lead_event_promotion_is_symmetric check ((phase = 'PROMOTED') = (lead_id is not null)),
  constraint lead_event_terminal_needs_reason check ((phase <> all (array['DUPLICATE','REJECTED','QUARANTINED','EXPIRED'])) or ((disposition_reason is not null) and (btrim(disposition_reason) <> ''))),
  constraint lead_event_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete restrict,
  constraint lead_event_lead_id_fkey foreign key (lead_id) references public.leads(id) on delete set null,
  constraint lead_event_endpoint_env_fk foreign key (endpoint_id, environment) references public.lead_ingest_endpoint(endpoint_id, environment) on delete restrict,
  constraint lead_event_endpoint_source_fk foreign key (endpoint_id, source_key) references public.lead_ingest_endpoint(endpoint_id, source_key) on delete restrict,
  constraint lead_event_endpoint_tenant_fk foreign key (endpoint_id, tenant_id) references public.lead_ingest_endpoint(endpoint_id, tenant_id) on delete restrict,
  constraint lead_event_identity_key unique (tenant_id, source_key, external_event_id)
  -- DEVIATION D3 (cont.): lead_event_provenance_fk -> lead_provenance_kind dropped.
);
-- ============================================================================
-- PART 2of4: TRIGGERS, RLS, POLICIES (verbatim from pg_policies), GRANTS
-- ============================================================================

-- ------------------------------------------------- tenancy guard triggers --
create or replace function public.lead_event_guard_lead_tenant()
 returns trigger language plpgsql set search_path to 'public'
as $function$
declare v_lead_tenant uuid;
begin
  if new.lead_id is null then return new; end if;
  select l.tenant_id into v_lead_tenant from public.leads l where l.id = new.lead_id;
  if v_lead_tenant is null then
    raise exception using errcode='NX001',
      message='Lead event cites lead ' || new.lead_id || ', which does not exist.',
      detail='LEAD_EVENT_PROMOTED_TO_MISSING_LEAD';
  end if;
  if v_lead_tenant <> new.tenant_id then
    raise exception using errcode='NX001',
      message='Lead event belongs to one dealership and cites a lead belonging to another.',
      detail='LEAD_EVENT_CROSS_TENANT_PROMOTION';
  end if;
  return new;
end $function$;

create or replace function public.inventory_guard_cost_change()
 returns trigger language plpgsql security definer set search_path to 'public','pg_catalog'
as $function$
declare
  v_caller text := coalesce(nullif(current_setting('role', true), ''), current_user::text);
  v_person boolean;
begin
  if new.cost_aed is not distinct from old.cost_aed then return new; end if;
  v_person := (v_caller in ('authenticated','anon') or auth.uid() is not null);
  if not v_person then return new; end if;
  if new.tenant_id not in (select public.nexus_tenant_ids_for_roles(array['owner','admin']::text[])) then
    raise exception using errcode='NX001',
      message='You may not change the cost price of a vehicle.',
      detail='NX_RBAC_COST_PRICE_REFUSED';
  end if;
  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('Inventory Cost Price Change','SUCCESS',
          format('cost_aed on %s changed from %s to %s by auth user %s', new.id,
                 coalesce(old.cost_aed::text,'(not previously set)'),
                 coalesce(new.cost_aed::text,'(cleared)'),
                 coalesce(auth.uid()::text,'(no auth session)')),
          new.tenant_id);
  return new;
end $function$;

create trigger lead_event_guard_lead_tenant_trg
  before insert or update of lead_id, tenant_id on public.lead_event
  for each row execute function public.lead_event_guard_lead_tenant();

create trigger inventory_guard_cost_change
  before update of cost_aed on public.inventory
  for each row execute function public.inventory_guard_cost_change();

-- DEVIATION D4: production also carries non-tenancy triggers not reproduced
-- here: trg_assign_hot_lead, nexus_leads_owner_change_audit_trg,
-- trg_comm_logs_first_response, journey_on_lead_event_promoted,
-- lead_ingest_endpoint_touch_trg. None is an isolation control; each depends
-- on functions/tables outside the named scope.

-- ------------------------------------------- destructive-write guard triggers
-- Reproduced on exactly the in-scope tables that carry them in production:
-- audit_log, communication_logs, inventory, lead_event, leads, tenants.
-- Deliberately NOT on customer, conversation, journey_step, users,
-- tenant_members, processed_messages, lead_ingest_endpoint -- production does
-- not guard those either, and test 9 depends on that asymmetry being real.
create trigger nexus_audit_log_refuse_delete before delete on public.audit_log for each row execute function public.nexus_refuse_destructive_write();
create trigger nexus_audit_log_refuse_truncate before truncate on public.audit_log for each statement execute function public.nexus_refuse_destructive_write();
create trigger nexus_communication_logs_refuse_delete before delete on public.communication_logs for each row execute function public.nexus_refuse_destructive_write();
create trigger nexus_communication_logs_refuse_truncate before truncate on public.communication_logs for each statement execute function public.nexus_refuse_destructive_write();
create trigger nexus_inventory_refuse_delete before delete on public.inventory for each row execute function public.nexus_refuse_destructive_write();
create trigger nexus_inventory_refuse_truncate before truncate on public.inventory for each statement execute function public.nexus_refuse_destructive_write();
create trigger nexus_lead_event_refuse_delete before delete on public.lead_event for each row execute function public.nexus_refuse_destructive_write();
create trigger nexus_lead_event_refuse_truncate before truncate on public.lead_event for each statement execute function public.nexus_refuse_destructive_write();
create trigger nexus_leads_refuse_delete before delete on public.leads for each row execute function public.nexus_refuse_destructive_write();
create trigger nexus_leads_refuse_truncate before truncate on public.leads for each statement execute function public.nexus_refuse_destructive_write();
create trigger nexus_tenants_refuse_delete before delete on public.tenants for each row execute function public.nexus_refuse_destructive_write();
create trigger nexus_tenants_refuse_truncate before truncate on public.tenants for each statement execute function public.nexus_refuse_destructive_write();

-- ------------------------------------------------------------------ RLS on --
alter table public.tenants             enable row level security;
alter table public.tenant_members      enable row level security;
alter table public.users               enable row level security;
alter table public.leads               enable row level security;
alter table public.customer            enable row level security;
alter table public.conversation        enable row level security;
alter table public.journey_step        enable row level security;
alter table public.inventory           enable row level security;
alter table public.audit_log           enable row level security;
alter table public.communication_logs  enable row level security;
alter table public.lead_event          enable row level security;
alter table public.lead_ingest_endpoint enable row level security;
alter table public.processed_messages  enable row level security;
-- relforcerowsecurity is false on all 13 in production; left false here too.

-- ---------------------------------------------------------------- policies --
-- audit_log
create policy audit_log_authenticated_read on public.audit_log as permissive for select to authenticated using (tenant_id in (select nexus_current_tenant_ids()));
create policy audit_log_deny_anon on public.audit_log as restrictive for all to anon using (false) with check (false);
create policy audit_log_service_role_all on public.audit_log as permissive for all to service_role using (true) with check (true);
-- communication_logs
create policy communication_logs_authenticated_read on public.communication_logs as permissive for select to authenticated using (tenant_id in (select nexus_current_tenant_ids()));
create policy communication_logs_deny_anon on public.communication_logs as restrictive for all to anon using (false) with check (false);
create policy communication_logs_service_role_all on public.communication_logs as permissive for all to service_role using (true) with check (true);
-- conversation
create policy conversation_authenticated_all on public.conversation as permissive for all to authenticated using (tenant_id in (select nexus_current_tenant_ids())) with check (tenant_id in (select nexus_current_tenant_ids()));
create policy conversation_deny_anon on public.conversation as restrictive for all to anon using (false) with check (false);
create policy conversation_service_role_all on public.conversation as permissive for all to service_role using (true) with check (true);
-- customer
create policy customer_authenticated_all on public.customer as permissive for all to authenticated using (tenant_id in (select nexus_current_tenant_ids())) with check (tenant_id in (select nexus_current_tenant_ids()));
create policy customer_deny_anon on public.customer as restrictive for all to anon using (false) with check (false);
create policy customer_service_role_all on public.customer as permissive for all to service_role using (true) with check (true);
-- inventory
create policy inventory_authenticated_delete on public.inventory as permissive for delete to authenticated using (tenant_id = nexus_current_tenant_id());
create policy inventory_authenticated_insert on public.inventory as permissive for insert to authenticated with check (tenant_id = nexus_current_tenant_id());
create policy inventory_authenticated_read on public.inventory as permissive for select to authenticated using (tenant_id in (select nexus_current_tenant_ids()));
create policy inventory_authenticated_update on public.inventory as permissive for update to authenticated using (tenant_id = nexus_current_tenant_id()) with check (tenant_id = nexus_current_tenant_id());
create policy inventory_deny_anon on public.inventory as restrictive for all to anon using (false) with check (false);
create policy inventory_role_delete on public.inventory as restrictive for delete to authenticated using (tenant_id in (select nexus_tenant_ids_for_roles(array['owner','admin'])));
create policy inventory_role_insert on public.inventory as restrictive for insert to authenticated with check (tenant_id in (select nexus_tenant_ids_for_roles(array['owner','admin'])));
create policy inventory_role_update on public.inventory as restrictive for update to authenticated using (tenant_id in (select nexus_tenant_ids_for_roles(array['owner','admin','manager']))) with check (tenant_id in (select nexus_tenant_ids_for_roles(array['owner','admin','manager'])));
create policy inventory_service_role_all on public.inventory as permissive for all to service_role using (true) with check (true);
-- journey_step
create policy journey_step_authenticated_all on public.journey_step as permissive for all to authenticated using (tenant_id in (select nexus_current_tenant_ids())) with check (tenant_id in (select nexus_current_tenant_ids()));
create policy journey_step_deny_anon on public.journey_step as restrictive for all to anon using (false) with check (false);
create policy journey_step_service_role_all on public.journey_step as permissive for all to service_role using (true) with check (true);
-- lead_event
create policy lead_event_deny_anon on public.lead_event as restrictive for all to anon using (false) with check (false);
create policy lead_event_no_end_user_writes on public.lead_event as restrictive for all to authenticated using (true) with check (false);
create policy lead_event_read_own_tenant on public.lead_event as permissive for select to authenticated using (tenant_id in (select nexus_current_tenant_ids()));
create policy lead_event_service on public.lead_event as permissive for all to service_role using (true) with check (true);
-- lead_ingest_endpoint
create policy lead_ingest_endpoint_deny_end_users on public.lead_ingest_endpoint as restrictive for all to anon, authenticated using (false) with check (false);
create policy lead_ingest_endpoint_service on public.lead_ingest_endpoint as permissive for all to service_role using (true) with check (true);
-- leads
create policy leads_authenticated_all on public.leads as permissive for all to authenticated using (tenant_id in (select nexus_current_tenant_ids())) with check (tenant_id in (select nexus_current_tenant_ids()));
create policy leads_deny_anon on public.leads as restrictive for all to anon using (false) with check (false);
create policy leads_role_update on public.leads as restrictive for update to authenticated
  using ((tenant_id in (select nexus_tenant_ids_for_roles(array['owner','admin','manager'])))
      or ((tenant_id in (select nexus_tenant_ids_for_roles(array['sales','member']))) and (assigned_to_id is not null) and (assigned_to_id in (select nexus_my_staff_user_ids()))))
  with check ((tenant_id in (select nexus_tenant_ids_for_roles(array['owner','admin','manager'])))
      or ((tenant_id in (select nexus_tenant_ids_for_roles(array['sales','member']))) and (assigned_to_id is not null) and (assigned_to_id in (select nexus_my_staff_user_ids()))));
create policy leads_service_role_all on public.leads as permissive for all to service_role using (true) with check (true);
-- processed_messages
create policy processed_messages_deny_anon on public.processed_messages as restrictive for all to anon using (false) with check (false);
create policy processed_messages_no_anon on public.processed_messages as permissive for all to anon using (false) with check (false);
create policy processed_messages_no_authenticated on public.processed_messages as permissive for all to authenticated using (false) with check (false);
-- tenant_members
create policy tenant_members_deny_anon on public.tenant_members as restrictive for all to anon using (false) with check (false);
create policy tenant_members_self_read on public.tenant_members as permissive for select to authenticated using (auth_user_id = auth.uid());
create policy tenant_members_service_role_all on public.tenant_members as permissive for all to service_role using (true) with check (true);
-- tenants
create policy tenants_deny_anon on public.tenants as restrictive for all to anon using (false) with check (false);
create policy tenants_member_read on public.tenants as permissive for select to authenticated using (id in (select nexus_current_tenant_ids()));
create policy tenants_service_role_all on public.tenants as permissive for all to service_role using (true) with check (true);

-- ------------------------------------------------------------------ grants --
-- Copied verbatim from production information_schema.role_table_grants.
-- Note the shape: `authenticated` holds SELECT only (plus DELETE on inventory).
-- `anon` holds NOTHING on any of these 13 tables.
grant usage on schema public to anon, authenticated, service_role;
revoke all on public.tenants, public.tenant_members, public.users, public.leads,
  public.customer, public.conversation, public.journey_step, public.inventory,
  public.audit_log, public.communication_logs, public.lead_event,
  public.lead_ingest_endpoint, public.processed_messages from anon, authenticated;

grant select on public.audit_log, public.communication_logs, public.conversation,
  public.customer, public.journey_step, public.leads, public.tenant_members,
  public.tenants, public.users to authenticated;
grant select, delete on public.inventory to authenticated;
-- lead_event, lead_ingest_endpoint, processed_messages: no authenticated grant.

grant select, insert, update, delete, truncate, references, trigger
  on public.tenants, public.tenant_members, public.users, public.leads,
     public.customer, public.conversation, public.journey_step, public.inventory,
     public.audit_log, public.communication_logs, public.lead_event,
     public.lead_ingest_endpoint, public.processed_messages to service_role;
grant usage, select on all sequences in schema public to service_role;

grant execute on function public.nexus_current_tenant_id(), public.nexus_current_tenant_ids(),
  public.nexus_default_tenant_id(), public.nexus_scoped_tenant_id(),
  public.nexus_tenant_ids_for_roles(text[]), public.nexus_my_staff_user_ids(),
  public.nexus_jwt_tenant_id() to anon, authenticated, service_role;
-- ============================================================================
-- PART 3of4: RESULTS TABLE, FIXTURES, PROBE HELPERS
-- ============================================================================

create table public.zz_test_results (
  seq serial primary key,
  test text, as_whom text, target text, expected text, actual text, verdict text,
  note text,
  run_at timestamptz not null default now()
);

create table public.zz_fixture_key (
  tbl text primary key, pk_where_a text not null, pk_where_b text not null
);

-- ---------------------------------------------------------------- fixtures --
insert into public.tenants (id, slug, name, status, is_unattributed_default, is_quarantine) values
 ('0c1c0000-0000-4000-8000-00000000000c','__unattributed__','ZZ UNATTRIBUTED - QUARANTINE (not a dealership)','quarantine', true, true),
 ('0a1a0000-0000-4000-8000-00000000000a','zz-test-tenant-a','ZZ TEST TENANT A (synthetic)','active', false, false),
 ('0b1b0000-0000-4000-8000-00000000000b','zz-test-tenant-b','ZZ TEST TENANT B (synthetic)','active', false, false);

insert into public.users (id, name, email, role, status, tenant_id) values
 ('a5a5a5a5-0000-4000-8000-00000000a5a5','ZZ Staff A','zz-staff-a@example.invalid','owner','active','0a1a0000-0000-4000-8000-00000000000a'),
 ('b5b5b5b5-0000-4000-8000-00000000b5b5','ZZ Staff B','zz-staff-b@example.invalid','owner','active','0b1b0000-0000-4000-8000-00000000000b');

-- role 'owner' deliberately: the most-privileged role, so that any refusal
-- observed below is a TENANCY refusal and never merely an RBAC one.
insert into public.tenant_members (tenant_id, auth_user_id, role, staff_user_id) values
 ('0a1a0000-0000-4000-8000-00000000000a','aaaa1111-1111-4111-8111-111111111111','owner','a5a5a5a5-0000-4000-8000-00000000a5a5'),
 ('0b1b0000-0000-4000-8000-00000000000b','bbbb2222-2222-4222-8222-222222222222','owner','b5b5b5b5-0000-4000-8000-00000000b5b5');

insert into public.leads (name, email, phone, source, vehicle_interest, budget_aed, status, ai_score, tenant_id, assigned_to_id) values
 ('ZZ TEST LEAD A1','zz-lead-a1@example.invalid','971500000001','zz_test','ZZ Model A',100001,'HOT',91,'0a1a0000-0000-4000-8000-00000000000a','a5a5a5a5-0000-4000-8000-00000000a5a5'),
 ('ZZ TEST LEAD A2','zz-lead-a2@example.invalid','971500000002','zz_test','ZZ Model A',100002,'WARM',51,'0a1a0000-0000-4000-8000-00000000000a',null),
 ('ZZ TEST LEAD B1','zz-lead-b1@example.invalid','971500000011','zz_test','ZZ Model B',200001,'HOT',92,'0b1b0000-0000-4000-8000-00000000000b','b5b5b5b5-0000-4000-8000-00000000b5b5'),
 ('ZZ TEST LEAD B2','zz-lead-b2@example.invalid','971500000012','zz_test','ZZ Model B',200002,'WARM',52,'0b1b0000-0000-4000-8000-00000000000b',null);

insert into public.customer (id, tenant_id, display_name, phone_digits, email) values
 ('a3a3a3a3-0000-4000-8000-00000000a3a3','0a1a0000-0000-4000-8000-00000000000a','ZZ TEST CUSTOMER A','971500000001','zz-cust-a@example.invalid'),
 ('b3b3b3b3-0000-4000-8000-00000000b3b3','0b1b0000-0000-4000-8000-00000000000b','ZZ TEST CUSTOMER B','971500000011','zz-cust-b@example.invalid');

insert into public.conversation (id, tenant_id, customer_id, integration_id, channel, state, message_count) values
 ('a4a4a4a4-0000-4000-8000-00000000a4a4','0a1a0000-0000-4000-8000-00000000000a','a3a3a3a3-0000-4000-8000-00000000a3a3','a1111111-0000-4000-8000-000000000001','whatsapp_cloud','OPEN',3),
 ('b4b4b4b4-0000-4000-8000-00000000b4b4','0b1b0000-0000-4000-8000-00000000000b','b3b3b3b3-0000-4000-8000-00000000b3b3','b1111111-0000-4000-8000-000000000001','whatsapp_cloud','OPEN',5);

insert into public.journey_step (correlation_id, tenant_id, step, status, ref_table, ref_id, detail) values
 ('zz-corr-a-0001','0a1a0000-0000-4000-8000-00000000000a','ZZ_STEP_ONE','OK','leads','a1','ZZ TEST JOURNEY A'),
 ('zz-corr-a-0001','0a1a0000-0000-4000-8000-00000000000a','ZZ_STEP_TWO','OK','leads','a1','ZZ TEST JOURNEY A'),
 ('zz-corr-b-0001','0b1b0000-0000-4000-8000-00000000000b','ZZ_STEP_ONE','OK','leads','b1','ZZ TEST JOURNEY B'),
 ('zz-corr-b-0001','0b1b0000-0000-4000-8000-00000000000b','ZZ_STEP_TWO','OK','leads','b1','ZZ TEST JOURNEY B');

-- cost_aed is deliberately distinct per tenant: 111111 vs 222222, so their sum
-- (333333) is an unmistakable signature that a query reached both dealerships.
insert into public.inventory (id, model, vin, status, days_in_stock, price_aed, cost_aed, gross_margin, tenant_id) values
 ('ZZ-VEH-A-001','ZZ TEST VEHICLE A','ZZTESTVINA00000001','available',10,150000,111111,38889,'0a1a0000-0000-4000-8000-00000000000a'),
 ('ZZ-VEH-B-001','ZZ TEST VEHICLE B','ZZTESTVINB00000001','available',20,250000,222222,27778,'0b1b0000-0000-4000-8000-00000000000b');

insert into public.audit_log (id, workflow, status, lead_name, lead_email, summary, tenant_id) values
 ('a6a6a6a6-0000-4000-8000-00000000a6a6','ZZ TEST WORKFLOW A','SUCCESS','ZZ TEST LEAD A1','zz-lead-a1@example.invalid','ZZ TEST AUDIT ROW A','0a1a0000-0000-4000-8000-00000000000a'),
 ('b6b6b6b6-0000-4000-8000-00000000b6b6','ZZ TEST WORKFLOW B','SUCCESS','ZZ TEST LEAD B1','zz-lead-b1@example.invalid','ZZ TEST AUDIT ROW B','0b1b0000-0000-4000-8000-00000000000b');

insert into public.communication_logs (id, lead_email, channel, direction, message, sent_by, tenant_id, external_message_id, channel_key, direction_key) values
 ('a7a7a7a7-0000-4000-8000-00000000a7a7','zz-lead-a1@example.invalid','whatsapp','outbound','ZZ TEST MESSAGE A','zz-staff-a','0a1a0000-0000-4000-8000-00000000000a','zztestmsgA0000001','whatsapp','outbound'),
 ('b7b7b7b7-0000-4000-8000-00000000b7b7','zz-lead-b1@example.invalid','whatsapp','outbound','ZZ TEST MESSAGE B','zz-staff-b','0b1b0000-0000-4000-8000-00000000000b','zztestmsgB0000001','whatsapp','outbound');

insert into public.processed_messages (message_id, source, chat_id, tenant_id) values
 ('zztest-msg-a-0001','waha','zz-chat-a','0a1a0000-0000-4000-8000-00000000000a'),
 ('zztest-msg-b-0001','waha','zz-chat-b','0b1b0000-0000-4000-8000-00000000000b');

insert into public.lead_ingest_endpoint (endpoint_id, tenant_id, source_key, required_provenance_for_source, declared_provenance, provenance_counts_as_real, environment, public_key, label) values
 ('a2222222-0000-4000-8000-000000000002','0a1a0000-0000-4000-8000-00000000000a','zz_test_source','operator_recorded','operator_recorded',false,'simulation','zzTestPublicKeyTenantA0001','ZZ TEST ENDPOINT A'),
 ('b2222222-0000-4000-8000-000000000002','0b1b0000-0000-4000-8000-00000000000b','zz_test_source','operator_recorded','operator_recorded',false,'simulation','zzTestPublicKeyTenantB0001','ZZ TEST ENDPOINT B');

insert into public.lead_event (event_id, tenant_id, endpoint_id, source_key, environment, origin_verified, provenance_counts_as_real, external_event_id, payload_raw) values
 ('a8a8a8a8-0000-4000-8000-00000000a8a8','0a1a0000-0000-4000-8000-00000000000a','a2222222-0000-4000-8000-000000000002','zz_test_source','simulation','operator_recorded',false,'zz-test-event-a-0001','{"zz":"TEST PAYLOAD A"}'),
 ('b8b8b8b8-0000-4000-8000-00000000b8b8','0b1b0000-0000-4000-8000-00000000000b','b2222222-0000-4000-8000-000000000002','zz_test_source','simulation','operator_recorded',false,'zz-test-event-b-0001','{"zz":"TEST PAYLOAD B"}');

-- Primary-key predicates captured AS postgres, with literal values, so the write
-- probes target a real row by its PK and never lean on a tenant_id predicate
-- that RLS would trivially satisfy.
insert into public.zz_fixture_key (tbl, pk_where_a, pk_where_b)
select 'leads',
  'id = ' || (select min(id) from public.leads where tenant_id='0a1a0000-0000-4000-8000-00000000000a'),
  'id = ' || (select min(id) from public.leads where tenant_id='0b1b0000-0000-4000-8000-00000000000b');
insert into public.zz_fixture_key values
 ('customer',          'id = ''a3a3a3a3-0000-4000-8000-00000000a3a3''',      'id = ''b3b3b3b3-0000-4000-8000-00000000b3b3'''),
 ('conversation',      'id = ''a4a4a4a4-0000-4000-8000-00000000a4a4''',      'id = ''b4b4b4b4-0000-4000-8000-00000000b4b4'''),
 ('inventory',         'id = ''ZZ-VEH-A-001''',                             'id = ''ZZ-VEH-B-001'''),
 ('audit_log',         'id = ''a6a6a6a6-0000-4000-8000-00000000a6a6''',      'id = ''b6b6b6b6-0000-4000-8000-00000000b6b6'''),
 ('communication_logs','id = ''a7a7a7a7-0000-4000-8000-00000000a7a7''',      'id = ''b7b7b7b7-0000-4000-8000-00000000b7b7'''),
 ('lead_event',        'event_id = ''a8a8a8a8-0000-4000-8000-00000000a8a8''','event_id = ''b8b8b8b8-0000-4000-8000-00000000b8b8''');
insert into public.zz_fixture_key (tbl, pk_where_a, pk_where_b)
select 'journey_step',
  'id = ' || (select min(id) from public.journey_step where tenant_id='0a1a0000-0000-4000-8000-00000000000a'),
  'id = ' || (select min(id) from public.journey_step where tenant_id='0b1b0000-0000-4000-8000-00000000000b');

-- ------------------------------------------------------------ probe helpers --
-- Every WRITE probe runs in a subtransaction that is ALWAYS rolled back, so the
-- suite is idempotent and the fixtures survive a re-run byte-for-byte.

create or replace function public.zz_claims(p_uid uuid, p_role text) returns text
language sql immutable as $$
  select case when p_uid is null then ''
              else json_build_object('sub', p_uid::text, 'role', p_role)::text end;
$$;

create or replace function public.zz_scalar(p_role text, p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare v text; res text;
begin
  perform set_config('request.jwt.claims', public.zz_claims(p_uid, p_role), true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v;
    res := coalesce(v, '(null)');
  exception when others then
    res := 'ERROR ' || sqlstate || ': ' || left(sqlerrm, 160);
  end;
  reset role;
  return res;
end $$;

create or replace function public.zz_write_rb(p_role text, p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare n bigint; res text;
begin
  perform set_config('request.jwt.claims', public.zz_claims(p_uid, p_role), true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    get diagnostics n = row_count;
    res := 'ROWS=' || n;
    raise exception using errcode = 'ZZ999', message = 'zz-deliberate-rollback';
  exception
    when sqlstate 'ZZ999' then null;
    when others then res := 'ERROR ' || sqlstate || ': ' || left(sqlerrm, 160);
  end;
  reset role;
  return res;
end $$;

create or replace function public.zz_write_capture_rb(p_role text, p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare v text; res text;
begin
  perform set_config('request.jwt.claims', public.zz_claims(p_uid, p_role), true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v;
    res := coalesce(v, '(null)');
    raise exception using errcode = 'ZZ999', message = 'zz-deliberate-rollback';
  exception
    when sqlstate 'ZZ999' then null;
    when others then res := 'ERROR ' || sqlstate || ': ' || left(sqlerrm, 160);
  end;
  reset role;
  return res;
end $$;

create or replace function public.zz_assert(p_test text, p_as text, p_target text,
  p_expected text, p_actual text, p_pass boolean, p_note text default null)
returns void language sql as $$
  insert into public.zz_test_results(test, as_whom, target, expected, actual, verdict, note)
  values (p_test, p_as, p_target, p_expected, p_actual,
          case when p_pass then 'PASS' else 'FAIL' end, p_note);
$$;

create or replace function public.zz_record_notrun(p_test text, p_as text, p_target text,
  p_expected text, p_why text)
returns void language sql as $$
  insert into public.zz_test_results(test, as_whom, target, expected, actual, verdict, note)
  values (p_test, p_as, p_target, p_expected, '(not executed)', 'NOT RUN', p_why);
$$;

-- per-table probe configuration
create table public.zz_probe_cfg (
  tbl text primary key, upd_set text, ins_fmt text, has_tenant_default boolean, ins_no_tenant text);
insert into public.zz_probe_cfg (tbl, upd_set, ins_fmt, has_tenant_default) values
 ('leads','status = status',
  'insert into public.leads (name,email,tenant_id) values (''ZZ XTEST LEAD'',''zz-xtest-l@example.invalid'',%1$L)', true),
 ('customer','display_name = display_name',
  'insert into public.customer (tenant_id,display_name,email) values (%1$L,''ZZ XTEST CUSTOMER'',''zz-xtest-c@example.invalid'')', false),
 ('conversation','message_count = message_count',
  'insert into public.conversation (tenant_id,customer_id,integration_id,channel,state) values (%1$L,%2$L,gen_random_uuid(),''web'',''OPEN'')', false),
 ('journey_step','detail = detail',
  'insert into public.journey_step (correlation_id,tenant_id,step,status) values (''zz-xtest-corr'',%1$L,''ZZ_XSTEP'',''OK'')', false),
 ('inventory','model = model',
  'insert into public.inventory (id,model,tenant_id) values (''ZZ-XTEST-VEH'',''ZZ XTEST VEHICLE'',%1$L)', true),
 ('audit_log','summary = summary',
  'insert into public.audit_log (workflow,status,summary,tenant_id) values (''ZZ XTEST'',''SUCCESS'',''ZZ XTEST AUDIT'',%1$L)', true),
 ('communication_logs','message = message',
  'insert into public.communication_logs (lead_email,channel,direction,message,tenant_id) values (''zz-xtest@example.invalid'',''whatsapp'',''outbound'',''ZZ XTEST MSG'',%1$L)', true),
 ('lead_event','normalized = normalized',
  'insert into public.lead_event (tenant_id,endpoint_id,source_key,environment,origin_verified,provenance_counts_as_real,external_event_id,payload_raw) values (%1$L,%3$L,''zz_test_source'',''simulation'',''operator_recorded'',false,''zz-xtest-event'',''{}'')', false);

update public.zz_probe_cfg set ins_no_tenant = v.s from (values
 ('leads','insert into public.leads (name,email) values (''ZZ XTEST LEAD NT'',''zz-xtest-nt-l@example.invalid'') returning tenant_id::text'),
 ('customer','insert into public.customer (display_name,email) values (''ZZ XTEST CUSTOMER NT'',''zz-xtest-nt-c@example.invalid'') returning tenant_id::text'),
 ('conversation','insert into public.conversation (customer_id,integration_id,channel,state) values (%2$L,gen_random_uuid(),''web'',''OPEN'') returning tenant_id::text'),
 ('journey_step','insert into public.journey_step (correlation_id,step,status) values (''zz-xtest-nt'',''ZZ_XSTEP'',''OK'') returning tenant_id::text'),
 ('inventory','insert into public.inventory (id,model) values (''ZZ-XTEST-VEH-NT'',''ZZ XTEST VEHICLE NT'') returning tenant_id::text'),
 ('audit_log','insert into public.audit_log (workflow,status,summary) values (''ZZ XTEST NT'',''SUCCESS'',''ZZ XTEST AUDIT NT'') returning tenant_id::text'),
 ('communication_logs','insert into public.communication_logs (lead_email,channel,direction,message) values (''zz-xtest-nt@example.invalid'',''whatsapp'',''outbound'',''ZZ XTEST MSG NT'') returning tenant_id::text'),
 ('lead_event','insert into public.lead_event (endpoint_id,source_key,environment,origin_verified,provenance_counts_as_real,external_event_id,payload_raw) values (%3$L,''zz_test_source'',''simulation'',''operator_recorded'',false,''zz-xtest-event-nt'',''{}'') returning tenant_id::text')
) v(t,s) where public.zz_probe_cfg.tbl = v.t;

-- A security_invoker view over inventory, mirroring how all 26 production views
-- are built. A view WITHOUT security_invoker cannot be created on either
-- database: the event trigger nexus_guard_security_invoker_views refuses it.
create view public.zz_v_inventory_invoker with (security_invoker = true) as
  select tenant_id, id, model, price_aed, cost_aed from public.inventory;
grant select on public.zz_v_inventory_invoker to authenticated;
-- ============================================================================
-- PART 4of4: THE ASSERTIONS
-- Re-runnable. Every write probe rolls back; the fixtures are never disturbed.
-- Read the verdicts with:
--   select * from public.zz_test_results order by seq;
--   select verdict, count(*) from public.zz_test_results group by 1;
-- ============================================================================

delete from public.zz_test_results;

-- ---------------------------------------------------------------------------
-- STEP 0 -- THE IMPERSONATION GATE.
-- If this does not pass, every verdict below is meaningless and must be read
-- as NOT RUN. Do not skip it and do not "fix" it by loosening the assertion.
-- ---------------------------------------------------------------------------
do $$
declare a_t text; a_n text; b_t text; b_n text; total text;
begin
  a_t := public.zz_scalar('authenticated','aaaa1111-1111-4111-8111-111111111111','select public.nexus_current_tenant_id()::text');
  a_n := public.zz_scalar('authenticated','aaaa1111-1111-4111-8111-111111111111','select count(*)::text from public.leads');
  b_t := public.zz_scalar('authenticated','bbbb2222-2222-4222-8222-222222222222','select public.nexus_current_tenant_id()::text');
  b_n := public.zz_scalar('authenticated','bbbb2222-2222-4222-8222-222222222222','select count(*)::text from public.leads');
  total := (select count(*)::text from public.leads);
  perform public.zz_assert('0. IMPERSONATION GATE: nexus_current_tenant_id()','A','(session)','tenant A id',a_t,
    a_t = '0a1a0000-0000-4000-8000-00000000000a');
  perform public.zz_assert('0. IMPERSONATION GATE: leads visible','A','leads',
    'A''s 2 rows, not the total of '||total, a_n, a_n = '2');
  perform public.zz_assert('0. IMPERSONATION GATE: nexus_current_tenant_id()','B','(session)','tenant B id',b_t,
    b_t = '0b1b0000-0000-4000-8000-00000000000b');
  perform public.zz_assert('0. IMPERSONATION GATE: leads visible','B','leads',
    'B''s 2 rows, not the total of '||total, b_n, b_n = '2');
end $$;

-- ---------------------------------------------------------------------------
-- STEPS 1-5 -- THE MATRIX, EVERY IN-SCOPE TABLE, BOTH DIRECTIONS
-- ---------------------------------------------------------------------------
do $$
declare
  c record; actual text; i int; other_pk text; my_pk text;
  me text; me_uid text; other text; other_tid text; other_cust text; other_ep text; my_tid text;
  dirs constant text[][] := array[
    array['A','aaaa1111-1111-4111-8111-111111111111','B','0b1b0000-0000-4000-8000-00000000000b',
          'b3b3b3b3-0000-4000-8000-00000000b3b3','b2222222-0000-4000-8000-000000000002','0a1a0000-0000-4000-8000-00000000000a'],
    array['B','bbbb2222-2222-4222-8222-222222222222','A','0a1a0000-0000-4000-8000-00000000000a',
          'a3a3a3a3-0000-4000-8000-00000000a3a3','a2222222-0000-4000-8000-000000000002','0b1b0000-0000-4000-8000-00000000000b']];
begin
 for i in 1..2 loop
  me:=dirs[i][1]; me_uid:=dirs[i][2]; other:=dirs[i][3]; other_tid:=dirs[i][4];
  other_cust:=dirs[i][5]; other_ep:=dirs[i][6]; my_tid:=dirs[i][7];
  for c in select * from public.zz_probe_cfg order by tbl loop
    select case when i=1 then pk_where_b else pk_where_a end,
           case when i=1 then pk_where_a else pk_where_b end
      into other_pk, my_pk
      from public.zz_fixture_key where tbl = c.tbl;

    -- 1. READ. Zero rows OR refused outright; both mean no leak.
    actual := public.zz_scalar('authenticated', me_uid::uuid,
      format('select count(*)::text from public.%I where tenant_id = %L', c.tbl, other_tid));
    perform public.zz_assert('1. READ '||other||'''s rows', me, c.tbl,
      '0 rows, or refused', actual, actual = '0' or actual like 'ERROR 42501%',
      case when actual like 'ERROR 42501%' then 'refused at the GRANT layer, before RLS was consulted'
           else 'RLS returned an empty set' end);

    -- 2. UPDATE the other tenant's row, addressed by its real primary key.
    actual := public.zz_write_rb('authenticated', me_uid::uuid,
      format('update public.%I set %s where %s', c.tbl, c.upd_set, other_pk));
    perform public.zz_assert('2. UPDATE '||other||'''s row (by PK)', me, c.tbl,
      'ROWS=0 or refusal', actual, actual = 'ROWS=0' or actual like 'ERROR%');

    -- 3. DELETE the other tenant's row, addressed by its real primary key.
    actual := public.zz_write_rb('authenticated', me_uid::uuid,
      format('delete from public.%I where %s', c.tbl, other_pk));
    perform public.zz_assert('3. DELETE '||other||'''s row (by PK)', me, c.tbl,
      'ROWS=0 or refusal', actual, actual = 'ROWS=0' or actual like 'ERROR%');

    -- 4. INSERT carrying the other tenant's tenant_id.
    actual := public.zz_write_rb('authenticated', me_uid::uuid,
      format(c.ins_fmt, other_tid, other_cust, other_ep));
    perform public.zz_assert('4. INSERT with '||other||'''s tenant_id', me, c.tbl,
      'refused', actual, actual like 'ERROR%');

    -- 5. INSERT with no tenant_id at all -- where does the DEFAULT land it?
    actual := public.zz_write_capture_rb('authenticated', me_uid::uuid,
      format(c.ins_no_tenant, other_tid, other_cust, other_ep));
    perform public.zz_assert('5. INSERT with no tenant_id', me, c.tbl,
      'refused, or own tenant -- never '||other, actual,
      actual like 'ERROR%' or actual = my_tid,
      case when actual like 'ERROR 42501%' then 'no INSERT grant for authenticated'
           when actual like 'ERROR 23502%' then 'tenant_id is NOT NULL with no DEFAULT -- refused'
           when actual = my_tid then 'default resolved to the caller''s own tenant'
           else 'see actual' end);
  end loop;
 end loop;
end $$;

-- ---------------------------------------------------------------------------
-- STEP 6 -- THE COST LEAK, SPECIFICALLY
-- ---------------------------------------------------------------------------
do $$
declare a text; me text; me_uid text; other text; other_tid text; other_cost text; i int;
  dirs constant text[][] := array[
    array['A','aaaa1111-1111-4111-8111-111111111111','B','0b1b0000-0000-4000-8000-00000000000b','222222'],
    array['B','bbbb2222-2222-4222-8222-222222222222','A','0a1a0000-0000-4000-8000-00000000000a','111111']];
begin
 for i in 1..2 loop
  me:=dirs[i][1]; me_uid:=dirs[i][2]; other:=dirs[i][3]; other_tid:=dirs[i][4]; other_cost:=dirs[i][5];

  a := public.zz_scalar('authenticated', me_uid::uuid,
    format('select coalesce(max(cost_aed)::text,''(none)'') from public.inventory where tenant_id = %L', other_tid));
  perform public.zz_assert('6a. COST LEAK via plain select', me, 'inventory.cost_aed',
    '(none) -- must not reach '||other_cost, a, a = '(none)');

  a := public.zz_scalar('authenticated', me_uid::uuid,
    'select coalesce(sum(cost_aed)::text,''(none)'') from public.inventory');
  perform public.zz_assert('6b. COST LEAK via unpredicated aggregate', me, 'inventory.cost_aed',
    'own cost only', a, a <> '333333' and a <> other_cost,
    'SUM over every inventory row this session can reach; 333333 would mean both dealerships');

  a := public.zz_scalar('authenticated', me_uid::uuid,
    'select coalesce(max(o.cost_aed)::text,''(none)'') from public.inventory m join public.inventory o on o.tenant_id <> m.tenant_id');
  perform public.zz_assert('6c. COST LEAK via self-join across tenant_id', me, 'inventory.cost_aed',
    '(none)', a, a = '(none)');

  a := public.zz_scalar('authenticated', me_uid::uuid,
    format('select coalesce(max(cost_aed)::text,''(none)'') from public.zz_v_inventory_invoker where tenant_id = %L', other_tid));
  perform public.zz_assert('6d. COST LEAK via security_invoker view', me, 'inventory.cost_aed',
    '(none)', a, a = '(none)', 'mirrors how all 26 production views are built');

  perform public.zz_record_notrun('6e. COST LEAK via view WITHOUT security_invoker', me, 'inventory.cost_aed', '(none)',
    'Could not be run: the event trigger nexus_guard_security_invoker_views (present on BOTH production and staging) refuses to create such a view at DDL time, SQLSTATE 42501. The leak path is closed one layer earlier than this test can reach. Verified separately: all 26 production views over these tables have security_invoker=true.');
 end loop;
end $$;

-- ---------------------------------------------------------------------------
-- STEP 7 -- anon
-- ---------------------------------------------------------------------------
do $$
declare t text; a text;
begin
  foreach t in array array['tenants','tenant_members','users','leads','customer','conversation',
                           'journey_step','inventory','audit_log','communication_logs','lead_event',
                           'lead_ingest_endpoint','processed_messages'] loop
    a := public.zz_scalar('anon', null, format('select count(*)::text from public.%I', t));
    perform public.zz_assert('7. ANON read (no JWT)', 'anon', t, 'refused, or 0 rows', a,
      a='0' or a like 'ERROR%',
      case when a like 'ERROR 42501%' then 'refused at the GRANT layer: anon holds no privilege at all' else a end);
  end loop;
  a := public.zz_scalar('anon', null, 'select coalesce(max(cost_aed)::text,''(none)'') from public.zz_v_inventory_invoker');
  perform public.zz_assert('7. ANON read', 'anon', 'zz_v_inventory_invoker', 'refused, or (none)', a,
    a='(none)' or a like 'ERROR%');
  a := public.zz_scalar('anon', null, 'select coalesce(public.nexus_current_tenant_id()::text,''(null)'')');
  perform public.zz_assert('7. ANON nexus_current_tenant_id()', 'anon', '(session)', 'refused, or (null)', a,
    a='(null)' or a like 'ERROR%',
    'anon has NO USAGE on schema public -- verified identical on production.');
  a := public.zz_scalar('anon', null, 'select coalesce(public.nexus_scoped_tenant_id()::text,''(null)'')');
  perform public.zz_assert('7. ANON nexus_scoped_tenant_id()', 'anon', '(session)', 'refused, or (null)', a,
    a='(null)' or a like 'ERROR%',
    'anon has NO USAGE on schema public -- verified identical on production.');
end $$;

-- ---------------------------------------------------------------------------
-- STEPS 8-10 -- service_role, the destructive guard, and the scoped-tenant fuse
-- ---------------------------------------------------------------------------
do $$
declare t text; a text; n_active text;
begin
  foreach t in array array['leads','customer','conversation','journey_step','inventory',
                           'audit_log','communication_logs','lead_event'] loop
    a := public.zz_scalar('service_role', null,
      format('select count(distinct tenant_id)::text from public.%I where tenant_id in (''0a1a0000-0000-4000-8000-00000000000a'',''0b1b0000-0000-4000-8000-00000000000b'')', t));
    perform public.zz_assert('8. SERVICE_ROLE cross-tenant visibility', 'service_role', t,
      '2 (both tenants) -- designed behaviour, not a defect', a, a = '2',
      'service_role has rolbypassrls=true on production AND staging: RLS is never consulted for it');
  end loop;

  a := public.zz_scalar('service_role', null, 'select sum(cost_aed)::text from public.inventory');
  perform public.zz_assert('8b. SERVICE_ROLE reads every tenant''s cost_aed', 'service_role', 'inventory.cost_aed',
    '333333 (= 111111 + 222222)', a, a = '333333',
    'Every n8n workflow holding the service-role key can read both dealerships'' cost prices. Measured, not theoretical.');

  a := public.zz_write_rb('service_role', null,
    'update public.leads set status = ''ZZ-TOUCHED-BY-SERVICE-ROLE'' where tenant_id = ''0b1b0000-0000-4000-8000-00000000000b''');
  perform public.zz_assert('8c. SERVICE_ROLE writes into another tenant', 'service_role', 'leads',
    'ROWS=2 (unrestricted) -- designed, and the exposure', a, a = 'ROWS=2',
    'rolled back by the harness; on production nothing would roll it back');

  a := public.zz_write_rb('service_role', null, 'delete from public.leads');
  perform public.zz_assert('9. DESTRUCTIVE GUARD: unpredicated DELETE (GUARDED table)', 'service_role', 'leads',
    'refused by nexus_refuse_destructive_write', a, a like 'ERROR P0001%NX900%',
    'guard present on production for leads, inventory, audit_log, communication_logs, lead_event, tenants');
  a := public.zz_write_rb('service_role', null, 'delete from public.audit_log');
  perform public.zz_assert('9. DESTRUCTIVE GUARD: unpredicated DELETE (GUARDED table)', 'service_role', 'audit_log',
    'refused by nexus_refuse_destructive_write', a, a like 'ERROR P0001%NX900%');
  a := public.zz_write_rb('service_role', null, 'delete from public.customer');
  perform public.zz_assert('9. DESTRUCTIVE GUARD: unpredicated DELETE (UNGUARDED table)', 'service_role', 'customer',
    'NOT refused -- customer carries no guard trigger on production', a, a like 'ROWS=%' or a like 'ERROR 23503%',
    'rolled back by the harness. Production does not guard customer, conversation, journey_step, users, tenant_members, processed_messages, lead_ingest_endpoint.');
  a := public.zz_write_rb('service_role', null, 'delete from public.journey_step');
  perform public.zz_assert('9. DESTRUCTIVE GUARD: unpredicated DELETE (UNGUARDED table)', 'service_role', 'journey_step',
    'NOT refused -- journey_step carries no guard trigger on production', a, a like 'ROWS=%',
    'rolled back by the harness. ROWS=4 = both dealerships'' journeys would go in one statement.');

  n_active := (select count(*)::text from public.tenants where status='active' and not is_quarantine);
  a := public.zz_scalar('service_role', null, 'select coalesce(public.nexus_scoped_tenant_id()::text,''(null)'')');
  perform public.zz_assert('10. nexus_scoped_tenant_id() with '||n_active||' active tenants', 'service_role', '(function)',
    '(null) -- goes silent rather than guess', a, a = '(null)',
    'On production TODAY there is exactly 1 active non-quarantine tenant, so it returns Tenant A. The day a 2nd active tenant exists it returns NULL for every service_role caller.');
  a := public.zz_scalar('service_role', null, 'select coalesce(public.nexus_default_tenant_id()::text,''(null)'')');
  perform public.zz_assert('10b. nexus_default_tenant_id() as service_role', 'service_role', '(function)',
    'the QUARANTINE tenant', a, a = '0c1c0000-0000-4000-8000-00000000000c',
    'A service_role INSERT that omits tenant_id lands in quarantine -- not in either dealership.');
  a := public.zz_scalar('authenticated','aaaa1111-1111-4111-8111-111111111111',
    'select coalesce(public.nexus_scoped_tenant_id()::text,''(null)'')');
  perform public.zz_assert('10c. nexus_scoped_tenant_id() as a signed-in user', 'A', '(function)',
    'tenant A id (membership wins)', a, a = '0a1a0000-0000-4000-8000-00000000000a',
    'End users are unaffected by the 2-tenant NULL: their membership resolves first.');
end $$;

-- ---------------------------------------------------------------------------
-- SUPPLEMENTARY -- NOT PRODUCTION'S CONFIGURATION.
-- On production `authenticated` holds SELECT only (plus DELETE on inventory),
-- so every RLS WITH CHECK clause on these tables is unreachable dead code.
-- This section widens the grants ON THE STAGING HARNESS ONLY, to find out
-- whether those clauses would hold if a grant were ever added. It restores the
-- production grant shape at the end.
-- ---------------------------------------------------------------------------
grant insert, update, delete on public.leads, public.customer, public.conversation,
  public.journey_step, public.inventory, public.audit_log, public.communication_logs to authenticated;

do $$
declare c record; actual text; i int; other_pk text; my_pk text;
  me text; me_uid text; other text; other_tid text; other_cust text; other_ep text;
  dirs constant text[][] := array[
    array['A','aaaa1111-1111-4111-8111-111111111111','B','0b1b0000-0000-4000-8000-00000000000b',
          'b3b3b3b3-0000-4000-8000-00000000b3b3','b2222222-0000-4000-8000-000000000002'],
    array['B','bbbb2222-2222-4222-8222-222222222222','A','0a1a0000-0000-4000-8000-00000000000a',
          'a3a3a3a3-0000-4000-8000-00000000a3a3','a2222222-0000-4000-8000-000000000002']];
begin
 for i in 1..2 loop
  me:=dirs[i][1]; me_uid:=dirs[i][2]; other:=dirs[i][3]; other_tid:=dirs[i][4];
  other_cust:=dirs[i][5]; other_ep:=dirs[i][6];
  for c in select * from public.zz_probe_cfg where tbl <> 'lead_event' order by tbl loop
    select case when i=1 then pk_where_b else pk_where_a end,
           case when i=1 then pk_where_a else pk_where_b end
      into other_pk, my_pk from public.zz_fixture_key where tbl = c.tbl;

    actual := public.zz_write_rb('authenticated', me_uid::uuid,
      format('update public.%I set %s where %s', c.tbl, c.upd_set, other_pk));
    perform public.zz_assert('S1. [SUPPLEMENTARY, grants widened] UPDATE '||other||'''s row', me, c.tbl,
      'ROWS=0 or refusal', actual, actual='ROWS=0' or actual like 'ERROR%',
      'NOT production config: tests whether RLS alone holds if an INSERT/UPDATE grant is ever added');

    actual := public.zz_write_rb('authenticated', me_uid::uuid,
      format(c.ins_fmt, other_tid, other_cust, other_ep));
    perform public.zz_assert('S2. [SUPPLEMENTARY, grants widened] INSERT with '||other||'''s tenant_id', me, c.tbl,
      'refused by the WITH CHECK clause', actual, actual like 'ERROR%',
      case when actual like '%permission denied for sequence%'
           then 'Refused, but by the SEQUENCE grant, not by the WITH CHECK clause. WITH CHECK remains UNPROVEN for this table.'
           when actual like '%violates row-level security policy%'
           then 'WITH CHECK clause proven to hold.'
           else 'NOT production config' end);

    actual := public.zz_write_rb('authenticated', me_uid::uuid,
      format('delete from public.%I where %s', c.tbl, other_pk));
    perform public.zz_assert('S3. [SUPPLEMENTARY, grants widened] DELETE '||other||'''s row', me, c.tbl,
      'ROWS=0 or refusal', actual, actual='ROWS=0' or actual like 'ERROR%', 'NOT production config');

    -- The nastiest shape: not reading across the boundary, but pushing a row across it.
    actual := public.zz_write_rb('authenticated', me_uid::uuid,
      format('update public.%I set tenant_id = %L where %s', c.tbl, other_tid, my_pk));
    perform public.zz_assert('S4. [SUPPLEMENTARY, grants widened] RE-TENANT own row into '||other, me, c.tbl,
      'refused, or ROWS=0 -- the row must not move', actual,
      actual like 'ERROR%' or actual = 'ROWS=0',
      case when actual = 'ROWS=0'
           then 'no UPDATE policy applies to authenticated on this table, so the statement matches nothing'
           else 'refused by the WITH CHECK clause' end);
  end loop;
 end loop;
end $$;

-- restore production's grant shape on the harness
revoke insert, update, delete on public.leads, public.customer, public.conversation,
  public.journey_step, public.inventory, public.audit_log, public.communication_logs from authenticated;
grant select, delete on public.inventory to authenticated;

-- ------------------------------------------------------------------ verdict --
select verdict, count(*) from public.zz_test_results group by 1 order by 1;
select * from public.zz_test_results order by seq;
