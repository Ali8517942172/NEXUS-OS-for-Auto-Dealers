-- NX910 — An action happens in the dealership you selected.
--
-- Applied to production dsvuoovivysszdoiorch on 2026-09-14 as
-- nx910_an_action_happens_in_the_dealership_you_selected. This file mirrors
-- what production already runs; it is written idempotently so a fresh
-- environment reaches the same state.
--
-- Two parts:
--   1. inventory writes are scoped to the dealership the user has selected,
--      not to every dealership they happen to belong to.
--   2. A function that reports the multi-tenant blockers that remain, so the
--      next session measures instead of guessing.
--
-- MEASURED BEFORE CHANGING (2026-09-14, production):
--   * Four tables carried a PERMISSIVE cmd=ALL policy over
--     nexus_current_tenant_ids(). Only `inventory` also had a write grant for
--     `authenticated` (DELETE). On the other three the cmd=ALL policy is inert
--     because the role has SELECT only.
--   * `inventory` already carried RESTRICTIVE owner/admin role policies. Those
--     are left untouched; this migration only narrows the permissive layer.
--   * nexus_resolve_channel_tenant() does NOT call nexus_scoped_tenant_id()
--     (the string match was a comment). The WhatsApp inbound hot path does not
--     go silent at dealership #2.

begin;

-- 1. The permissive layer on inventory --------------------------------------
--    Read across every membership; write only into the selected dealership.

drop policy if exists inventory_authenticated_all    on public.inventory;
drop policy if exists inventory_authenticated_read   on public.inventory;
drop policy if exists inventory_authenticated_insert on public.inventory;
drop policy if exists inventory_authenticated_update on public.inventory;
drop policy if exists inventory_authenticated_delete on public.inventory;

create policy inventory_authenticated_read on public.inventory
  for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));

create policy inventory_authenticated_insert on public.inventory
  for insert to authenticated
  with check (tenant_id = public.nexus_current_tenant_id());

create policy inventory_authenticated_update on public.inventory
  for update to authenticated
  using      (tenant_id = public.nexus_current_tenant_id())
  with check (tenant_id = public.nexus_current_tenant_id());

create policy inventory_authenticated_delete on public.inventory
  for delete to authenticated
  using (tenant_id = public.nexus_current_tenant_id());

-- 2. The blockers that remain, reported rather than remembered ---------------
--    Clause 2 is self-maintaining: it fires again if a future migration
--    re-adds a write grant to a table whose permissive policy still spans
--    every membership.

create or replace function public.nexus_multi_tenant_blockers()
returns table(severity text, item text, detail text)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  -- 1. Backend scope goes silent at the second dealership.
  select
    'BLOCKER'::text,
    'backend tenant scope goes silent at dealership #2'::text,
    format(
      'nexus_scoped_tenant_id() returns the single active dealership only while '
      || 'exactly one exists; there %s now. %s callers read it. At two '
      || 'dealerships it returns NULL and each of them does nothing, without '
      || 'raising. Give every caller an explicit tenant before onboarding the '
      || 'second dealership. Callers: %s',
      case when c.n = 1 then 'is 1' else format('are %s', c.n) end,
      f.n,
      f.names)
  from (select count(*) n from public.tenants
         where status = 'active' and not is_quarantine) c,
       (select count(*) n, string_agg(p.proname, ', ' order by p.proname) names
          from pg_proc p
          join pg_namespace ns on ns.oid = p.pronamespace
         where ns.nspname = 'public'
           and p.proname <> 'nexus_scoped_tenant_id'
           and p.prosrc like '%nexus_scoped_tenant_id%') f

  union all

  -- 2. A write grant sitting behind an all-my-memberships predicate.
  select
    'BLOCKER'::text,
    format('cross-dealership write is reachable on %I', pol.tablename)::text,
    format(
      'Policy %I is PERMISSIVE for %s over nexus_current_tenant_ids(), which '
      || 'returns every active membership, and `authenticated` holds %s on this '
      || 'table. A person who belongs to two dealerships can write to the one '
      || 'they did not mean. Scope the write predicate to '
      || 'nexus_current_tenant_id().',
      pol.policyname, pol.cmd, g.privs)
  from pg_policies pol
  join lateral (
    select string_agg(distinct rtg.privilege_type, ', ' order by rtg.privilege_type) privs
      from information_schema.role_table_grants rtg
     where rtg.grantee = 'authenticated'
       and rtg.table_schema = 'public'
       and rtg.table_name = pol.tablename
       and rtg.privilege_type in ('INSERT','UPDATE','DELETE')
  ) g on g.privs is not null
  where pol.schemaname = 'public'
    and pol.permissive = 'PERMISSIVE'
    and pol.cmd in ('ALL','INSERT','UPDATE','DELETE')
    and 'authenticated' = any (pol.roles)
    and coalesce(pol.with_check, pol.qual, '') like '%nexus_current_tenant_ids%'

  union all

  -- 3. Nothing to report is itself a result worth printing.
  select 'INFO'::text,
         'no cross-dealership write path found'::text,
         'Every PERMISSIVE write policy for `authenticated` is either scoped to '
         || 'the selected dealership or has no matching write grant.'
  where not exists (
    select 1 from pg_policies pol
    join lateral (
      select 1 from information_schema.role_table_grants rtg
       where rtg.grantee='authenticated' and rtg.table_schema='public'
         and rtg.table_name = pol.tablename
         and rtg.privilege_type in ('INSERT','UPDATE','DELETE') limit 1
    ) g on true
    where pol.schemaname='public' and pol.permissive='PERMISSIVE'
      and pol.cmd in ('ALL','INSERT','UPDATE','DELETE')
      and 'authenticated' = any (pol.roles)
      and coalesce(pol.with_check, pol.qual, '') like '%nexus_current_tenant_ids%'
  );
$function$;

revoke all on function public.nexus_multi_tenant_blockers() from public;
revoke all on function public.nexus_multi_tenant_blockers() from anon;
revoke all on function public.nexus_multi_tenant_blockers() from authenticated;
grant execute on function public.nexus_multi_tenant_blockers() to service_role;

commit;
