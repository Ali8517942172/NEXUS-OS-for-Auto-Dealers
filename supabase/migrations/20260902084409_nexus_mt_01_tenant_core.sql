-- NEXUS OS multi-tenancy, step 1 of 6: the tenant spine.
-- Adds two tables and the context functions every later policy depends on.
-- Touches no existing table, so it cannot break the live dashboard or n8n.
set local lock_timeout = '5s';

create table if not exists public.tenants (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique,
  name                    text not null,
  status                  text not null default 'active'
                          check (status in ('active','suspended','archived')),
  -- Exactly one tenant may claim rows written with no tenant attribution.
  -- This is what lets n8n (service_role, no auth.uid()) keep writing while it
  -- is still tenant-unaware. It MUST be cleared before a second dealership
  -- goes live -- see nexus_onboard_dealership() and the runbook comment there.
  is_unattributed_default boolean not null default false,
  created_at              timestamptz not null default now()
);

comment on table public.tenants is
  'One row per dealership. is_unattributed_default names the single tenant that '
  'claims rows inserted with no resolvable tenant (today: every n8n write, which '
  'runs as service_role and has no auth.uid()). At most one tenant may carry it.';

create unique index if not exists tenants_one_unattributed_default
  on public.tenants ((true)) where is_unattributed_default;

create table if not exists public.tenant_members (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  auth_user_id  uuid not null references auth.users(id) on delete cascade,
  role          text not null default 'member'
                check (role in ('owner','admin','manager','member')),
  -- public.users is the dealership staff directory and is NOT auth-linked:
  -- its ids differ from auth.users ids (verified 2026-09-02). This column is
  -- the bridge, and it is optional.
  staff_user_id uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (tenant_id, auth_user_id)
);

create index if not exists tenant_members_auth_user_idx
  on public.tenant_members (auth_user_id);

-- ── Context resolution ────────────────────────────────────────────────────
-- current_setting('request.jwt.claims') is whatever PostgREST put there. It is
-- not guaranteed to be JSON, so every read of it is defended.
create or replace function public.nexus_jwt_tenant_id()
returns uuid language plpgsql stable
set search_path to 'pg_catalog','public' as $fn$
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
$fn$;

-- Every tenant this caller may READ. Policies use this one.
-- SECURITY DEFINER (owner postgres, BYPASSRLS) so a policy that calls it does
-- not recurse into tenant_members' own RLS.
create or replace function public.nexus_current_tenant_ids()
returns setof uuid language sql stable security definer
set search_path to 'public','pg_catalog' as $fn$
  select m.tenant_id
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
   where auth.uid() is not null and m.auth_user_id = auth.uid();
$fn$;

-- The single tenant this caller WRITES into. A JWT tenant_id claim wins when
-- the caller is actually a member of it; otherwise their oldest membership.
create or replace function public.nexus_current_tenant_id()
returns uuid language sql stable security definer
set search_path to 'public','pg_catalog' as $fn$
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
$fn$;

-- The tenant a new row belongs to. Used as the column DEFAULT everywhere.
-- Falls back to the unattributed-default tenant, which is how n8n keeps
-- working without knowing tenancy exists.
create or replace function public.nexus_default_tenant_id()
returns uuid language sql stable security definer
set search_path to 'public','pg_catalog' as $fn$
  select coalesce(
    public.nexus_current_tenant_id(),
    (select t.id from public.tenants t
      where t.is_unattributed_default and t.status = 'active' limit 1));
$fn$;

-- ── Privileges ────────────────────────────────────────────────────────────
revoke all on public.tenants        from anon, authenticated;
revoke all on public.tenant_members from anon, authenticated;
grant select on public.tenants        to authenticated;
grant select on public.tenant_members to authenticated;
grant all    on public.tenants        to service_role;
grant all    on public.tenant_members to service_role;

grant execute on function public.nexus_jwt_tenant_id()        to authenticated, anon, service_role;
grant execute on function public.nexus_current_tenant_ids()   to authenticated, anon, service_role;
grant execute on function public.nexus_current_tenant_id()    to authenticated, anon, service_role;
grant execute on function public.nexus_default_tenant_id()    to authenticated, anon, service_role;

-- ── RLS on the spine itself ───────────────────────────────────────────────
alter table public.tenants        enable row level security;
alter table public.tenant_members enable row level security;

drop policy if exists tenants_member_read on public.tenants;
create policy tenants_member_read on public.tenants
  for select to authenticated
  using (id in (select public.nexus_current_tenant_ids()));

drop policy if exists tenants_service_role_all on public.tenants;
create policy tenants_service_role_all on public.tenants
  for all to service_role using (true) with check (true);

-- Deliberately auth_user_id = auth.uid() and not the tenant function: a member
-- has no business enumerating who else is in the tenant from this table.
drop policy if exists tenant_members_self_read on public.tenant_members;
create policy tenant_members_self_read on public.tenant_members
  for select to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists tenant_members_service_role_all on public.tenant_members;
create policy tenant_members_service_role_all on public.tenant_members
  for all to service_role using (true) with check (true);

-- anon can never touch the spine, no matter what permissive policy is added
-- later. This is the guard the 2 Sep anon-key leak asked for.
drop policy if exists tenants_deny_anon on public.tenants;
create policy tenants_deny_anon on public.tenants
  as restrictive for all to anon using (false) with check (false);

drop policy if exists tenant_members_deny_anon on public.tenant_members;
create policy tenant_members_deny_anon on public.tenant_members
  as restrictive for all to anon using (false) with check (false);