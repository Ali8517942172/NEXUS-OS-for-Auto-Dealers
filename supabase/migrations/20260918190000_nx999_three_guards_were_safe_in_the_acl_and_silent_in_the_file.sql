-- NX999 — Three guards were safe in the ACL and silent in the file.
--
-- ops/ci/function-grants.mjs went red on NX997 and NX998 with six findings. The
-- live grants were checked before writing a line of this, and PRODUCTION WAS
-- ALREADY SAFE. All three functions read:
--
--   nexus_guard_same_tenant_ref            anon=false authenticated=false service_role=true
--   nexus_journey_step_guard_ref_tenant    anon=false authenticated=false service_role=true
--   nexus_lead_endpoint_for_provider_identity  anon=false authenticated=false service_role=true
--   proacl on each: postgres=X/postgres | service_role=X/postgres
--
-- No bare PUBLIC entry anywhere. So this is not a security hole; it is a
-- migration that did the right thing in a way a reader cannot check.
--
-- NX997 revoked inside a DO block using format(), so the literal target never
-- appears in the file and the census could only report "(unparsed target)".
-- NX998 revoked from anon and authenticated by name but not from public, which
-- is the NX983 trap: a bare PUBLIC grant keeps both of them reaching the
-- function while proacl still looks clean.
--
-- The census is right to refuse both. A grant a human has to run SQL to verify
-- is a grant nobody verifies. So this migration says it in literal text, once,
-- where anyone reading the history can see it. Every statement below is a
-- no-op against the ACL as it stands today; that is the point. It changes the
-- FILE, not the database, and then the file and the database agree.

begin;

revoke all on function public.nexus_guard_same_tenant_ref() from public, anon, authenticated;
grant execute on function public.nexus_guard_same_tenant_ref() to service_role;

revoke all on function public.nexus_journey_step_guard_ref_tenant() from public, anon, authenticated;
grant execute on function public.nexus_journey_step_guard_ref_tenant() to service_role;

-- The accessor is overloaded, so both signatures are named literally. A loop
-- with format() would do the same thing and leave the file unreadable to the
-- census and to a person -- which is the exact defect this migration exists to
-- correct, so it is not repeated here.
revoke all on function public.nexus_lead_endpoint_for_provider_identity(text, text, text) from public, anon, authenticated;
grant execute on function public.nexus_lead_endpoint_for_provider_identity(text, text, text) to service_role;

revoke all on function public.nexus_lead_endpoint_for_provider_identity(text, text, text, text) from public, anon, authenticated;
grant execute on function public.nexus_lead_endpoint_for_provider_identity(text, text, text, text) to service_role;

comment on function public.nexus_guard_same_tenant_ref() is
  'NX997 cross-tenant reference guard. service_role only: it runs as a trigger on the '
  'ingest path, and no browser session has any reason to call it. Revoked from public, '
  'anon and authenticated in NX999 in literal text so the file and the ACL agree.';

comment on function public.nexus_journey_step_guard_ref_tenant() is
  'NX997 journey_step polymorphic reference guard. service_role only, same reasoning as '
  'nexus_guard_same_tenant_ref. Revoked from public, anon and authenticated in NX999.';

do $verify$
declare bad text := '';
begin
  if has_function_privilege('anon', 'public.nexus_guard_same_tenant_ref()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.nexus_guard_same_tenant_ref()', 'EXECUTE')
  then bad := bad || 'nexus_guard_same_tenant_ref reachable by an end-user role. '; end if;

  if has_function_privilege('anon', 'public.nexus_journey_step_guard_ref_tenant()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.nexus_journey_step_guard_ref_tenant()', 'EXECUTE')
  then bad := bad || 'nexus_journey_step_guard_ref_tenant reachable by an end-user role. '; end if;

  if not has_function_privilege('service_role', 'public.nexus_guard_same_tenant_ref()', 'EXECUTE')
  then bad := bad || 'service_role cannot execute the guard, which would break every ingest write. '; end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'nexus_lead_endpoint_for_provider_identity'
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
            or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) then bad := bad || 'nexus_lead_endpoint_for_provider_identity reachable by an end-user role. '; end if;

  if bad <> '' then
    raise exception 'NX999 VERIFY FAILED: %', bad;
  end if;
end
$verify$;

commit;
