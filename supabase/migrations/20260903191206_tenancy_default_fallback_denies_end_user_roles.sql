-- Closes: "the sole configured tenant is handed to a member of none".
--
-- nexus_default_tenant_id() and nexus_scoped_tenant_id() fall back to the tenant
-- carrying tenants.is_unattributed_default whenever nexus_current_tenant_id() is
-- NULL. That fallback exists for ONE reason: n8n writes as service_role with no
-- end-user identity, and 16 tenant_id column DEFAULTs call
-- nexus_default_tenant_id() to stamp those rows. It was never meant to answer
-- "which dealership does this signed-in user belong to" -- but it did. An
-- `authenticated` caller holding no tenant_members row was handed the tenant,
-- and both functions are EXECUTE-granted to `authenticated`, hence callable over
-- /rest/v1/rpc/.
--
-- The fix is deliberately NOT a revoke. Measured 3 Sep 2026 inside a rolled-back
-- transaction, revoking EXECUTE from `authenticated` returns 42501 on four LIVE
-- paths, because three consumers are SECURITY INVOKER and evaluate the call as
-- the caller, and one is a column default fired by a browser INSERT:
--     v_customer_directory        (security_invoker=on)  -> Customers screen
--     v_inventory_sales           (security_invoker=on)
--     search_rag_documents(text,int) (prosecdef=false)   -> Ask AI retrieval
--     inventory INSERT omitting tenant_id                -> lib/unit-form.js
--
-- So the fallback stays reachable and instead becomes unavailable to the two
-- end-user roles. current_setting('role') is the role PostgREST SET ROLEs per
-- request; it survives into a SECURITY DEFINER body (measured), and it is a
-- surer discriminator than `auth.uid() IS NULL` because it does not depend on
-- whether a service key happens to carry a `sub` claim. Roles other than
-- authenticated/anon -- postgres running a migration or the nightly batch --
-- keep the fallback, so admin and backend behaviour is unchanged.
--
-- A member of a dealership is unaffected: nexus_current_tenant_id() answers
-- first and coalesce() short-circuits before the guard is ever reached.
--
-- Rollback is at the bottom of this file.

create or replace function public.nexus_default_tenant_id()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(
    public.nexus_current_tenant_id(),
    (select t.id from public.tenants t
      where t.is_unattributed_default
        and t.status = 'active'
        -- The unattributed-default fallback is for trusted backend writers.
        -- A signed-in end user gets their membership or nothing.
        and coalesce(current_setting('role', true), '') not in ('authenticated', 'anon')
      limit 1));
$function$;

create or replace function public.nexus_scoped_tenant_id()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(
    public.nexus_current_tenant_id(),
    (select t.id from public.tenants t
      where t.is_unattributed_default
        and t.status = 'active'
        -- Same guard as nexus_default_tenant_id(); keep the two in step.
        and coalesce(current_setting('role', true), '') not in ('authenticated', 'anon')
        -- Pre-existing guard, unchanged: silent rather than wrong at 2 tenants.
        and (select count(*) from public.tenants w where w.status = 'active') = 1));
$function$;

comment on function public.nexus_default_tenant_id() is
  'Tenant to stamp on a row whose writer did not supply one. Returns the caller''s '
  'membership if they have one; otherwise the tenants.is_unattributed_default row, '
  'but ONLY for non-end-user roles (service_role, postgres). Returns NULL for an '
  '`authenticated` or `anon` caller with no tenant_members row -- fails closed. '
  'Called by 16 tenant_id column DEFAULTs. Guarded 3 Sep 2026.';

comment on function public.nexus_scoped_tenant_id() is
  'Tenant a scoped read should be filtered to. Same end-user guard as '
  'nexus_default_tenant_id(), plus the pre-existing single-active-tenant guard. '
  'Read by v_customer_directory, v_inventory_sales and search_rag_documents(text,int), '
  'all of which are SECURITY INVOKER -- do not revoke EXECUTE from `authenticated`. '
  'Guarded 3 Sep 2026.';

-- ROLLBACK (restores the exact prior bodies):
--
-- create or replace function public.nexus_default_tenant_id()
-- returns uuid language sql stable security definer
-- set search_path to 'public', 'pg_catalog' as $r$
--   select coalesce(
--     public.nexus_current_tenant_id(),
--     (select t.id from public.tenants t
--       where t.is_unattributed_default and t.status = 'active' limit 1));
-- $r$;
--
-- create or replace function public.nexus_scoped_tenant_id()
-- returns uuid language sql stable security definer
-- set search_path to 'public', 'pg_catalog' as $r$
--   select coalesce(
--     public.nexus_current_tenant_id(),
--     (select t.id from public.tenants t
--       where t.is_unattributed_default and t.status = 'active'
--         and (select count(*) from public.tenants w where w.status = 'active') = 1));
-- $r$;