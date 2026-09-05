-- NEXUS 2026-09-04. Two changes, both consequences of the CREATE EXTENSION measurement.
--
-- (a) nexus_guard_born_open_grants() carried a comment saying CREATE EXTENSION
--     "does not fire ddl_command_end on this platform". That is true but the
--     reason recorded was unknown, and the branch it guarded was dead in a
--     second way nobody had noticed: even if it DID fire, its REVOKEs run as
--     postgres while extension objects are owned by supabase_admin, so every one
--     of them is the non-grantor no-op. Measured: REVOKE ALL ON FUNCTION
--     public.word_similarity_dist_op(text,text) FROM anon returns SUCCESS, leaves
--     anon=X in proacl, and has_function_privilege('anon',...) stays true.
--     The dead branch is removed and replaced by the control that does work.
--
-- (b) The real control is the schema door, and the guard now re-asserts it.
--     A Supabase platform migration that runs the stock
--     "grant usage on schema public to postgres, anon, authenticated, service_role"
--     would silently re-open it with no grant-shaped diff to review.

create or replace function public.nexus_guard_born_open_grants()
returns event_trigger
language plpgsql
security invoker              -- ON PURPOSE. An event trigger function runs as the
                              -- role that ran the DDL, so its REVOKE executes as the
                              -- grantor and bites. SECURITY DEFINER would run it as
                              -- postgres and turn it back into the proved no-op.
set search_path to 'pg_catalog'
as $function$
declare
  r record;
begin
  -- GRANT and REVOKE also fire ddl_command_end, so without this the guard's
  -- own REVOKEs would re-enter it.
  if coalesce(current_setting('nexus.acl_guard', true), '') = 'running' then
    return;
  end if;
  perform set_config('nexus.acl_guard', 'running', true);

  for r in select object_type, object_identity, schema_name
             from pg_event_trigger_ddl_commands()
  loop
    begin
      if r.schema_name = 'public' then
        if r.object_type in ('table','view','materialized view','foreign table') then
          execute format('revoke all on %s from anon', r.object_identity);
          execute format('revoke insert, update, delete, truncate on %s from authenticated', r.object_identity);
        elsif r.object_type = 'sequence' then
          execute format('revoke all on sequence %s from anon', r.object_identity);
          execute format('revoke update on sequence %s from authenticated', r.object_identity);
        elsif r.object_type in ('function','procedure','aggregate') then
          execute format('revoke all on function %s from anon', r.object_identity);
        end if;
      end if;
    exception when others then null;
    end;
  end loop;

  -- Re-assert the schema door. This is the control that covers the creation
  -- paths the guard cannot see -- CREATE EXTENSION above all -- because it does
  -- not depend on seeing the object at all. Only ever runs when the door has
  -- been re-opened, so it is a no-op on every ordinary migration.
  begin
    if pg_catalog.has_schema_privilege('anon', 'public', 'USAGE') then
      execute 'revoke usage on schema public from public';
      execute 'revoke usage on schema public from anon';
      execute 'grant usage on schema public to authenticator, dashboard_user, pgbouncer, '
           || 'supabase_admin, supabase_auth_admin, supabase_storage_admin, '
           || 'supabase_realtime_admin, supabase_replication_admin, '
           || 'supabase_read_only_user, supabase_etl_admin, supabase_privileged_role';
    end if;
  exception when others then null;
  end;

  perform set_config('nexus.acl_guard', 'idle', true);
exception when others then
  -- Never abort somebody else's DDL, including a Supabase platform upgrade.
  perform set_config('nexus.acl_guard', 'idle', true);
end
$function$;

-- Detection that measures REACHABILITY, not ACL metadata.
-- The distinction is the whole lesson of this pass: after the door was shut,
-- public.spatial_ref_sys still read anon=arwdDxtm in relacl and
-- has_table_privilege('anon', ...) still returned true, while both an anonymous
-- SELECT and an anonymous INSERT returned 42501. relacl was the wrong witness.
--
-- Two rules, and a clean result means both hold:
--   anon must reach NOTHING in schema public, by any route.
--   authenticated may reach only objects OWNED BY postgres. Anything in public
--   owned by another role got there through a path we do not control, and
--   supabase_admin ownership is exactly the born-open signature.
create or replace function public.nexus_public_exposure_report()
returns table(role_name text, object_kind text, object_name text, object_owner text, privileges text, rule_broken text)
language sql
stable
security invoker
set search_path to 'pg_catalog'
as $function$
  with r(rn) as (select unnest(array['anon','authenticated'])),
  privs(p) as (select unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])),
  rel as (
    select r.rn, c.oid, c.relkind, (n.nspname || '.' || c.relname) as nm,
           pg_get_userbyid(c.relowner) as own
      from r
      join pg_class c on true
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','p','v','m','f','S')
  ),
  fn as (
    select r.rn, p.oid, p.oid::regprocedure::text as nm,
           pg_get_userbyid(p.proowner) as own
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
     and (fn.rn = 'anon' or fn.own <> 'postgres')
     and has_function_privilege(fn.rn, fn.oid, 'EXECUTE')
  order by 1, 2, 3;
$function$;

revoke all on function public.nexus_public_exposure_report() from anon, authenticated;
