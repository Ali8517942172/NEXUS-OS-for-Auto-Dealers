-- Postgres grants EXECUTE to PUBLIC on every new function, so the anon role
-- inherited call rights on the tenant-context helpers. Only two of them are
-- actually needed by a signed-in caller (RLS policies and column DEFAULTs
-- evaluate as the caller), and none is needed by anon.
revoke all on function public.nexus_jwt_tenant_id()      from public, anon;
revoke all on function public.nexus_current_tenant_ids() from public, anon;
revoke all on function public.nexus_current_tenant_id()  from public, anon;
revoke all on function public.nexus_default_tenant_id()  from public, anon;
revoke all on function public.nexus_tenancy_readiness()  from public, anon, authenticated;

-- required: policy predicates call this one
grant execute on function public.nexus_current_tenant_ids() to authenticated, service_role;
-- required: it is the DEFAULT expression on every tenant_id column
grant execute on function public.nexus_default_tenant_id()  to authenticated, service_role;
-- convenience for the dashboard; returns only the caller's own tenant
grant execute on function public.nexus_current_tenant_id()  to authenticated, service_role;
grant execute on function public.nexus_jwt_tenant_id()      to authenticated, service_role;
-- operator tool only
grant execute on function public.nexus_tenancy_readiness()  to service_role;