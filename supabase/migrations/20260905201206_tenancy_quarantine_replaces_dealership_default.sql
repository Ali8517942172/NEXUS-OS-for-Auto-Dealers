-- STAGE 1.5 — tenants.is_unattributed_default named a real dealership.
--
-- Measured 5 Sep 2026 on production (dsvuoovivysszdoiorch):
--   select public.nexus_default_tenant_id();  ->  ALBA CARS
-- Sixteen tables carry `tenant_id DEFAULT nexus_default_tenant_id()`, so any
-- backend write that omitted tenant_id was filed under the one real dealership.
-- Invisible while ALBA is the only dealership; the moment a second exists,
-- unresolvable traffic -- including another dealership's customers -- becomes
-- ALBA's rows, ALBA's conversations and ALBA's attributed revenue.
--
-- WHY A QUARANTINE TENANT ROW AND NOT "no default, let the insert raise":
-- all sixteen of those columns are tenant_id NOT NULL and there are 37 foreign
-- keys onto public.tenants, so "no default" means 23502 and the inbound message
-- is destroyed. That is not hypothetical -- staging has held no default since
-- 3 Sep and nexus_default_tenant_id() returns NULL there today. Dropping a real
-- customer's message is worse than misfiling it: a quarantined row is evidence,
-- it is recoverable with one UPDATE, and its volume is the only direct
-- measurement of which write paths still omit tenant_id. A raise leaves a stack
-- trace; a row leaves the payload.
--
-- WHY status = 'quarantine' RATHER THAN AN 'active' ROW WITH A FLAG:
-- five call sites already decide behaviour from tenants.status --
-- nexus_comm_keys_for_lead, nexus_lead_for_comm_key and search_rag_documents
-- refuse to answer when more than one tenant is active; capture_daily_metrics
-- writes a row per active tenant; whatsapp_policy_decision refuses to send to a
-- non-active tenant. A quarantine tenant that is not 'active' is excluded from
-- every one of them with no edit, so this migration does not make Customer 360
-- go silent and cannot cause a message to be sent to the quarantine tenant.

alter table public.tenants drop constraint tenants_status_check;

alter table public.tenants add constraint tenants_status_check
  check (status = any (array['active'::text, 'suspended'::text, 'archived'::text, 'quarantine'::text]));

alter table public.tenants add column is_quarantine boolean not null default false;

comment on column public.tenants.is_quarantine is
  'True on the single vendor-owned quarantine tenant that holds inbound traffic whose dealership could not be resolved. It is not a customer, it is never status=active, and it must never hold a tenant_members row.';

-- Clear the flag from every real dealership BEFORE the constraint that forbids
-- it exists, otherwise the constraint cannot be added.
update public.tenants set is_unattributed_default = false where is_unattributed_default;

alter table public.tenants add constraint tenants_quarantine_is_never_active
  check (is_quarantine = (status = 'quarantine'));

-- The structural fix. Re-pointing the unattributed default at a real dealership
-- now requires dropping a named constraint, which is a reviewable diff.
alter table public.tenants add constraint tenants_unattributed_default_must_be_quarantine
  check (not is_unattributed_default or is_quarantine);

create unique index tenants_one_quarantine on public.tenants ((true)) where is_quarantine;

insert into public.tenants (slug, name, status, is_unattributed_default, is_quarantine)
values ('__unattributed__', 'UNATTRIBUTED - QUARANTINE (not a dealership)', 'quarantine', true, true)
on conflict (slug) do update
  set status = 'quarantine', is_quarantine = true, is_unattributed_default = true;

create or replace function public.nexus_default_tenant_id()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(
    public.nexus_current_tenant_id(),
    (select t.id from public.tenants t
      where t.is_unattributed_default
        -- Was `t.status = 'active'`. The quarantine tenant is deliberately not
        -- active; is_quarantine is the stronger predicate, and a CHECK makes it
        -- imply status='quarantine'.
        and t.is_quarantine
        -- The fallback is for trusted backend writers. A signed-in end user
        -- gets their membership or nothing.
        and coalesce(current_setting('role', true), '') not in ('authenticated', 'anon')
      limit 1));
$function$;

comment on function public.nexus_default_tenant_id() is
  'Tenant for a backend write that did not name one. Returns the caller''s own tenant if they have one, otherwise the QUARANTINE tenant -- never a dealership. A CHECK constraint on public.tenants enforces that.';

create or replace function public.nexus_scoped_tenant_id()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(
    public.nexus_current_tenant_id(),
    -- Decoupled from is_unattributed_default on 5 Sep 2026. This function
    -- answers "which dealership is this batch for", not "where does
    -- unattributable traffic go" -- pointing a nightly sync at the quarantine
    -- tenant would sync nothing and prove nothing. Behaviour is unchanged where
    -- it matters: with one active dealership it still returns that dealership.
    (select t.id from public.tenants t
      where t.status = 'active'
        and not t.is_quarantine
        and coalesce(current_setting('role', true), '') not in ('authenticated', 'anon')
        -- Pre-existing guard, unchanged: silent rather than wrong at 2 tenants.
        and (select count(*) from public.tenants w
              where w.status = 'active' and not w.is_quarantine) = 1));
$function$;

comment on function public.nexus_scoped_tenant_id() is
  'The dealership a trusted backend batch is operating on: the caller''s own tenant, else the sole active dealership, else NULL. Never the quarantine tenant.';

create or replace function public.nexus_onboard_dealership(p_slug text, p_name text, p_owner_email text, p_owner_role text DEFAULT 'owner'::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_tenant uuid; v_auth uuid; v_staff uuid;
begin
  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'nexus_onboard_dealership: slug is required';
  end if;

  -- The quarantine tenant is not a dealership and must never be reachable
  -- through onboarding: the ON CONFLICT below would otherwise rename it, and a
  -- renamed quarantine tenant reads as a customer in every screen and export.
  if exists (select 1 from public.tenants t
              where t.slug = lower(btrim(p_slug)) and t.is_quarantine) then
    raise exception 'nexus_onboard_dealership: % is the quarantine tenant, not a dealership', lower(btrim(p_slug));
  end if;

  -- tenants.slug is unique GLOBALLY and correctly so: it is the tenant
  -- registry itself, not a tenant-scoped table.
  insert into public.tenants (slug, name, status, is_unattributed_default)
  values (lower(btrim(p_slug)), coalesce(nullif(btrim(p_name),''), p_slug), 'active', false)
  on conflict (slug) do update set name = excluded.name
  returning id into v_tenant;

  select id into v_auth from auth.users where lower(email) = lower(btrim(p_owner_email));
  if v_auth is null then
    raise exception
      'nexus_onboard_dealership: no auth.users row for %. Create the login in Supabase Auth first, then re-run.',
      p_owner_email;
  end if;

  -- Staff directory row, so the rep appears on the team screen and can be
  -- assigned leads. users.email is now unique PER DEALERSHIP
  -- (users_tenant_email_key), so one person can be staff at two dealerships and
  -- holds a separate row at each.
  insert into public.users (name, email, role, status, tenant_id)
  values (split_part(p_owner_email,'@',1), lower(btrim(p_owner_email)), 'manager', 'online', v_tenant)
  on conflict (tenant_id, email) do update set email = excluded.email
  returning id into v_staff;

  insert into public.tenant_members (tenant_id, auth_user_id, role, staff_user_id)
  values (v_tenant, v_auth, coalesce(p_owner_role,'owner'), v_staff)
  on conflict (tenant_id, auth_user_id) do update
    set role = excluded.role, staff_user_id = coalesce(public.tenant_members.staff_user_id, excluded.staff_user_id);

  return v_tenant;
end;
$function$;

-- Quarantine has to be visible to the vendor or it is a landfill. SECURITY
-- INVOKER on purpose: read as service_role it counts everything, read as a
-- dealership session RLS filters every branch to zero, so this function can
-- never become a cross-tenant read even if its EXECUTE grant is re-opened by a
-- platform default privilege.
create or replace function public.nexus_quarantine_census()
 returns table(tbl text, rows bigint, newest timestamp with time zone)
 language sql
 stable
 set search_path to 'public', 'pg_catalog'
as $function$
  with q as (select id from public.tenants where is_quarantine)
  select * from (
    select 'audit_log'::text,            count(*), max(logged_at)   from public.audit_log            where tenant_id in (select id from q)
    union all select 'communication_logs', count(*), max(created_at) from public.communication_logs  where tenant_id in (select id from q)
    union all select 'leads',              count(*), max(created_at) from public.leads               where tenant_id in (select id from q)
    union all select 'processed_messages', count(*), max(processed_at) from public.processed_messages where tenant_id in (select id from q)
    union all select 'whatsapp_contacts',  count(*), max(last_seen) from public.whatsapp_contacts    where tenant_id in (select id from q)
    union all select 'customer_360_profiles', count(*), max(last_synced_at) from public.customer_360_profiles where tenant_id in (select id from q)
    union all select 'deals_embeddings',   count(*), max(created_at) from public.deals_embeddings    where tenant_id in (select id from q)
    union all select 'finance_quotes',     count(*), max(created_at) from public.finance_quotes      where tenant_id in (select id from q)
    union all select 'inventory',          count(*), null::timestamptz from public.inventory         where tenant_id in (select id from q)
    union all select 'kyc_documents',      count(*), max(created_at) from public.kyc_documents       where tenant_id in (select id from q)
    union all select 'purchase_history',   count(*), max(created_at) from public.purchase_history    where tenant_id in (select id from q)
    union all select 'rag_documents',      count(*), null::timestamptz from public.rag_documents     where tenant_id in (select id from q)
    union all select 'users',              count(*), null::timestamptz from public.users             where tenant_id in (select id from q)
    union all select 'competitors',        count(*), max(scraped_at) from public.competitors         where tenant_id in (select id from q)
    union all select 'daily_metrics',      count(*), null::timestamptz from public.daily_metrics     where tenant_id in (select id from q)
    union all select 'inventory_profit_settings', count(*), null::timestamptz from public.inventory_profit_settings where tenant_id in (select id from q)
  ) s(tbl, rows, newest)
  where s.rows > 0
  order by s.rows desc, s.tbl;
$function$;

comment on function public.nexus_quarantine_census() is
  'Rows currently sitting in the UNATTRIBUTED quarantine tenant, per table. A non-empty result means a live write path is still omitting tenant_id: find it, fix it, then re-attribute the rows. Never delete them without reading them.';

revoke execute on function public.nexus_quarantine_census() from anon, authenticated, public;