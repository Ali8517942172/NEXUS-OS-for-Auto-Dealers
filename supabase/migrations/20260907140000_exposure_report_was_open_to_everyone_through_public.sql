-- The security-posture report was readable by every signed-in dealership user,
-- and the revoke that was supposed to prevent that did nothing.
--
-- WHAT WAS MEASURED, 7 September 2026
--
-- 20260904142709 created nexus_public_exposure_report() and then wrote:
--
--     revoke all on function public.nexus_public_exposure_report()
--       from anon, authenticated;
--
-- That statement ran. It also achieved nothing, and pg_proc says why:
--
--     proacl = {=X/postgres, postgres=X/postgres, service_role=X/postgres}
--
-- The leading `=X` is the BARE PUBLIC entry -- EXECUTE granted to PUBLIC, which
-- is where a function starts life. Revoking from anon and authenticated removed
-- their DIRECT entries, which is why neither name appears in that list, and left
-- PUBLIC untouched. Every role, including both of them, still reached it through
-- PUBLIC. Measured, not inferred:
--
--     has_function_privilege('authenticated', ..., 'execute')  ->  true
--     set local role authenticated; select count(*) from nexus_public_exposure_report()
--       ->  149 rows, naming 149 objects, every one flagged as a broken rule
--
-- So a dealership's own user could ask this database to print the map of its own
-- over-grants. Nothing in those 149 rows is a real weakness today -- they are all
-- pgvector and pg_trgm objects owned by supabase_admin rather than postgres --
-- but the content of a security report changes as the schema does, and the next
-- genuine over-grant it finds would have been disclosed to a customer's account.
--
-- This is the third distinct shape of the same lesson in this database, and the
-- three do not substitute for each other:
--
--   1. `revoke from public` does not remove a DIRECT grant to anon.
--   2. `revoke from anon, authenticated` does not remove the PUBLIC grant.  <- this one
--   3. `proacl like '%anon=%'` is blind, because anon reaching a function
--      through PUBLIC never appears in proacl at all.
--
-- The rule that survives all three: revoke naming `public` AND the roles, then
-- assert with has_function_privilege(). ops/ci/function-grants.mjs now refuses a
-- new migration whose revoke omits `public`, so this cannot be written again.
--
-- A NOTE ON REACHABILITY, BECAUSE THE NUMBERS LOOK WORSE THAN THEY ARE
--
-- 146 functions in schema public report has_function_privilege('anon', ...) =
-- true. None of them is reachable by anon, because anon holds no USAGE on schema
-- public -- measured: `set local role anon; select ... from public.<fn>()` fails
-- 42501, permission denied for schema public. One schema grant is carrying all
-- of it. `authenticated` DOES hold USAGE, so its 64 reachable functions of ours
-- are genuinely reachable; 42 of those are SECURITY DEFINER and are the
-- dashboard's intended API, each responsible for its own tenant scoping.
--
-- WHAT ELSE CHANGES HERE, AND WHY IT IS NOT COSMETIC
--
-- The report returned 149 rows on a healthy database and every single one was
-- an extension object flagged by the rule "authenticated may reach only objects
-- owned by postgres". A report whose every row is noise is a report nobody
-- reads, and the next real finding would have been the 150th line of an
-- identical-looking list. Objects created by CREATE EXTENSION are not something
-- we granted and are not ours to revoke, so they are excluded -- visibly, via a
-- parameter, not silently.
--
--   nexus_public_exposure_report()      -> findings only. Zero rows is healthy.
--   nexus_public_exposure_report(true)  -> the same plus the extension objects,
--                                          so the exclusion can be audited.
--
-- And it gains the rule it failed to apply to itself: a function carrying a bare
-- PUBLIC EXECUTE entry is now a finding, whoever owns it.

-- The zero-argument function has to go: a default parameter cannot be added by
-- CREATE OR REPLACE, and leaving both would leave the open one behind.
drop function if exists public.nexus_public_exposure_report();

create function public.nexus_public_exposure_report(
  p_include_extension_objects boolean default false
)
returns table (
  role_name text, object_kind text, object_name text,
  object_owner text, privileges text, rule_broken text
)
language sql
stable
security invoker
set search_path to 'pg_catalog'
as $function$
  with r(rn) as (select unnest(array['anon','authenticated'])),
  privs(p) as (select unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])),
  rel as (
    select r.rn, c.oid, c.relkind, (n.nspname || '.' || c.relname) as nm,
           pg_get_userbyid(c.relowner) as own,
           exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e') as from_ext
      from r
      join pg_class c on true
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p','v','m','f','S')
  ),
  fn as (
    select r.rn, p.oid, p.oid::regprocedure::text as nm,
           pg_get_userbyid(p.proowner) as own,
           exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') as from_ext
      from r
      join pg_proc p on true
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  )
  select rel.rn::text,
         case rel.relkind when 'S' then 'sequence' when 'v' then 'view'
                          when 'm' then 'materialized view' when 'f' then 'foreign table'
                          else 'table' end,
         rel.nm, rel.own,
         case when rel.relkind = 'S'
              then (select string_agg(x, ',') from unnest(array['SELECT','UPDATE','USAGE']) x
                     where has_sequence_privilege(rel.rn, rel.oid, x))
              else (select string_agg(privs.p, ',' order by privs.p) from privs
                     where has_table_privilege(rel.rn, rel.oid, privs.p)) end,
         case when rel.rn = 'anon' then 'anon must reach nothing in schema public'
              else 'authenticated may reach only objects owned by postgres' end
    from rel
   where has_schema_privilege(rel.rn, 'public', 'USAGE')
     and (p_include_extension_objects or not rel.from_ext)
     and (rel.rn = 'anon' or rel.own <> 'postgres')
     and case when rel.relkind = 'S'
              then exists (select 1 from unnest(array['SELECT','UPDATE','USAGE']) x
                            where has_sequence_privilege(rel.rn, rel.oid, x))
              else exists (select 1 from privs where has_table_privilege(rel.rn, rel.oid, privs.p)) end
  union all
  select fn.rn::text, 'function', fn.nm, fn.own, 'EXECUTE',
         case when fn.rn = 'anon' then 'anon must reach nothing in schema public'
              else 'authenticated may reach only objects owned by postgres' end
    from fn
   where has_schema_privilege(fn.rn, 'public', 'USAGE')
     and (p_include_extension_objects or not fn.from_ext)
     and (fn.rn = 'anon' or fn.own <> 'postgres')
     and has_function_privilege(fn.rn, fn.oid, 'EXECUTE')
  -- The rule this function did not apply to itself. A bare PUBLIC entry in
  -- proacl grants EXECUTE to every role at once and survives a revoke that
  -- names only anon and authenticated. Reported once per function, against no
  -- particular role, because it is not about a role.
  union all
  select '(PUBLIC)', 'function', p.oid::regprocedure::text,
         pg_get_userbyid(p.proowner), 'EXECUTE',
         'a bare PUBLIC EXECUTE grant reaches every role; revoke naming public, not only the roles'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p_include_extension_objects
          or not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'))
     and (p.proacl is null or exists (select 1 from unnest(p.proacl) a where a::text like '=%'))
  order by 1, 2, 3;
$function$;

comment on function public.nexus_public_exposure_report(boolean) is
  'What anon and authenticated can actually reach in schema public that they '
  'should not, plus any function carrying a bare PUBLIC EXECUTE grant. FINDINGS '
  'ONLY: zero rows is healthy. Objects created by CREATE EXTENSION are excluded '
  'because we did not grant them and cannot revoke them -- 149 of them used to '
  'be reported on a healthy database, which made the report unreadable. Pass '
  'true to see them and audit the exclusion. This is vendor security tooling: '
  'service_role only, and it was itself readable by every signed-in dealership '
  'user until 7 September 2026 because its revoke named the roles and not public.';

revoke all on function public.nexus_public_exposure_report(boolean)
  from public, anon, authenticated;
grant execute on function public.nexus_public_exposure_report(boolean) to service_role;

do $$
declare bad text[] := '{}';
begin
  if has_function_privilege('anon', 'public.nexus_public_exposure_report(boolean)', 'execute') then
    bad := array_append(bad, 'anon can still execute it');
  end if;
  if has_function_privilege('authenticated', 'public.nexus_public_exposure_report(boolean)', 'execute') then
    bad := array_append(bad, 'authenticated can still execute it');
  end if;
  if not has_function_privilege('service_role', 'public.nexus_public_exposure_report(boolean)', 'execute') then
    bad := array_append(bad, 'service_role cannot execute it, so the report is unusable');
  end if;
  -- and the defect itself: no bare PUBLIC entry may remain on this function
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'nexus_public_exposure_report'
       and (p.proacl is null or exists (select 1 from unnest(p.proacl) a where a::text like '=%'))
  ) then
    bad := array_append(bad, 'it still carries a bare PUBLIC entry in proacl');
  end if;
  if cardinality(bad) > 0 then
    raise exception 'nexus_public_exposure_report is still exposed: %', array_to_string(bad, '; ');
  end if;
end $$;
