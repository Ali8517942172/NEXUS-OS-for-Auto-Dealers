-- ===========================================================================
-- DEFECT 1 - objects created in `public` are born open, and it recurs.
--
-- MEASURED 4 Sep 2026, in rolled-back transactions, on BOTH projects:
--
--   (i)  postgres cannot close the supabase_admin default-privilege line.
--          set role supabase_admin
--            -> 42501 permission denied to set role "supabase_admin"
--          alter default privileges for role supabase_admin in schema public
--            revoke all on tables from anon
--            -> 42501 permission denied to change default privileges
--        postgres is not a member of supabase_admin (pg_auth_members), and
--        supabase grants no route to it. CLAUDE.md recorded this on 2 Sep; it
--        is re-proved here rather than taken on trust.
--
--   (ii) The line is live, not theoretical. `create extension ... schema
--        public` run BY postgres produces objects OWNED BY supabase_admin, so
--        they take the supabase_admin default ACL:
--
--          create extension postgis schema public;   -- rolled back
--          public.spatial_ref_sys
--            owner   = supabase_admin
--            relacl  = supabase_admin=arwdDxtm , postgres=arwdDxtm ,
--                      anon=arwdDxtm , authenticated=arwdDxtm ,
--                      service_role=arwdDxtm , =r
--            anon SELECT=true  anon INSERT=true  anon TRUNCATE=true
--            authenticated TRUNCATE=true   rowsecurity=false
--
--        and on staging, as the anon role, `select count(*) from
--        public.spatial_ref_sys` RETURNED 8500 ROWS. Not a privilege bit - an
--        actual anonymous read. Nobody wrote a GRANT; nothing appears in a
--        migration diff.
--
--   (iii) And a remediation migration written the obvious way is a SILENT
--        NO-OP, because postgres is not the grantor:
--
--          revoke all on public.spatial_ref_sys from anon, public;
--            -> returned SUCCESS
--          relacl afterwards: UNCHANGED, anon SELECT still true.
--
--   (iv) Residue already in the database: 149 functions in `public` on this
--        project (150 on staging) are owned by supabase_admin and carry
--        `anon=X/supabase_admin` - every one from pg_trgm and vector, both
--        installed in `public`. The 2 Sep sweep read relacl and reported "anon
--        holds nothing", which was true of TABLES and blind to functions.
--        Those functions are index-support and vector maths; they read no
--        table, and PUBLIC already holds `=X` on all of them, so revoking anon
--        alone would change nobody's reach. They are recorded as evidence the
--        path is live, not as a live data hole. Table, sequence, type and
--        COLUMN grants to anon in `public`: zero on both projects.
--
-- WHAT THIS MIGRATION DOES
--
--   Part A closes the line postgres OWNS. The 2 Sep pass removed `anon` from
--   the postgres default ACL and stopped there, so every table a migration
--   creates was still born `authenticated=arwdDxtm` - INSERT, UPDATE, DELETE
--   and TRUNCATE, and RLS does not filter TRUNCATE - and every sequence born
--   `authenticated=rwU`, where UPDATE on a sequence is setval(). Proved on both
--   projects by creating one of each in a rolled-back transaction. The 3 Sep
--   narrowing fixed the objects that existed; it did not fix the default, so
--   the defect was set to recur on the next migration. New tables are now born
--   `authenticated=r`, which is the standing policy, and new sequences give
--   authenticated nothing.
--
--   Part B neutralises the line postgres does NOT own, as far as it can be
--   neutralised from this project. Since postgres cannot revoke a
--   supabase_admin grant, the only lever is to be RUNNING AS supabase_admin at
--   the moment the grant exists. A ddl_command_end event trigger function is
--   executed as the role that ran the DDL, so when supabase_admin creates the
--   object the REVOKE inside runs as supabase_admin and bites. The function is
--   SECURITY INVOKER on purpose - SECURITY DEFINER would make it run as
--   postgres and turn it back into the no-op proved in (iii).
--
--   The guard can never abort the DDL that triggered it: every action is
--   wrapped, and a session-local flag stops it recursing through its own
--   REVOKEs (GRANT and REVOKE also fire ddl_command_end - observed).
--
-- WHAT IS STILL NOT CLOSED, AND MUST NOT BE CLAIMED AS CLOSED
--
--   1. The pg_default_acl row `supabase_admin / public / {table,sequence,
--      function} -> anon=arwdDxtm|rwU|X` STILL EXISTS and cannot be removed
--      from this project.
--   2. Part B does NOT cover `CREATE EXTENSION`. Measured on staging with an
--      instrumented event trigger: CREATE TABLE and CREATE SEQUENCE fire
--      ddl_command_end (and the guard's own REVOKEs were observed firing);
--      `create extension citext schema public` fired NOTHING. So the exact
--      path that produced finding (ii) is invisible to this guard, by
--      measurement, not by theory. Do not install extensions into `public`;
--      use the `extensions` schema.
--   3. The one lever that WOULD close (ii) is `revoke usage on schema public
--      from anon, public` - measured on staging: revoking from anon alone
--      changed nothing (anon still read 8500 rows, because PUBLIC holds `=U`),
--      and revoking from PUBLIC as well produced 42501 permission denied for
--      schema public. It is not applied here because eleven roles hold USAGE
--      only through PUBLIC - including `authenticator`, the role PostgREST
--      logs in as and builds its schema cache with. Revoking is a plausible
--      whole-API outage and needs a rehearsal against a live REST endpoint
--      first. Recorded as the open item, not done quietly.
--
--   The per-object ACL check in CLAUDE.md therefore remains load-bearing.
-- ===========================================================================

-- --- Part A: the default-privilege line postgres owns ----------------------
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  grant select on tables to authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- The FUNCTIONS line is deliberately left as it is (authenticated=X). Every
-- rpc/* function the dashboard calls depends on it, and narrowing it would
-- silently break the next one somebody adds. CLAUDE.md's rule stands: read the
-- ACL of every function you create and revoke explicitly.

-- --- Part B: the supabase_admin line postgres does not own ------------------
create or replace function public.nexus_guard_born_open_grants()
returns event_trigger
language plpgsql
as $fn$
declare
  r       record;
  m       record;
  ext_oid oid;
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
      if r.object_type = 'extension' then
        -- Kept for completeness. Measured 4 Sep 2026: CREATE EXTENSION does
        -- not fire ddl_command_end on this platform, so this branch does not
        -- run today. It is not the guard's coverage; see note 2 above.
        select e.oid into ext_oid from pg_extension e where e.extname = r.object_identity;
        if ext_oid is not null then
          for m in
            select 'rel'::text as kind, c.oid::regclass::text as ident, c.relkind
              from pg_depend d
              join pg_class c on c.oid = d.objid
              join pg_namespace n on n.oid = c.relnamespace
             where d.refclassid = 'pg_extension'::regclass and d.refobjid = ext_oid
               and d.classid = 'pg_class'::regclass and d.deptype = 'e'
               and n.nspname = 'public' and c.relkind in ('r','p','v','m','S','f')
            union all
            select 'fn'::text, p.oid::regprocedure::text, null::"char"
              from pg_depend d
              join pg_proc p on p.oid = d.objid
              join pg_namespace n on n.oid = p.pronamespace
             where d.refclassid = 'pg_extension'::regclass and d.refobjid = ext_oid
               and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
               and n.nspname = 'public'
          loop
            begin
              if m.kind = 'fn' then
                execute format('revoke all on function %s from anon', m.ident);
              elsif m.relkind = 'S' then
                execute format('revoke all on sequence %s from anon', m.ident);
                execute format('revoke update on sequence %s from authenticated', m.ident);
              else
                execute format('revoke all on %s from anon', m.ident);
                execute format('revoke insert, update, delete, truncate on %s from authenticated', m.ident);
              end if;
            exception when others then null;
            end;
          end loop;
        end if;

      elsif r.schema_name = 'public' then
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

  perform set_config('nexus.acl_guard', 'idle', true);
exception when others then
  -- Never abort somebody else's DDL, including a Supabase platform upgrade.
  perform set_config('nexus.acl_guard', 'idle', true);
end
$fn$;

comment on function public.nexus_guard_born_open_grants() is
  'Removes the grants a new object in public is BORN with. Supabase carries a pg_default_acl line for role supabase_admin granting anon ALL on new tables, rwU on new sequences and EXECUTE on new functions in public; postgres cannot alter that line (42501, re-proved 4 Sep 2026) and cannot revoke a supabase_admin grant either - a REVOKE by a non-grantor returns SUCCESS and changes nothing. A ddl_command_end trigger function runs AS THE ROLE THAT RAN THE DDL, so this one runs as supabase_admin when supabase_admin creates the object and the REVOKE bites. SECURITY INVOKER is required for that and must not be changed to DEFINER. It can never abort the triggering DDL. COVERAGE, MEASURED NOT ASSUMED: it fires for CREATE TABLE / VIEW / SEQUENCE / FUNCTION in a SQL session; it does NOT fire for CREATE EXTENSION on this platform, which is exactly how pg_trgm and vector arrived in public owned by supabase_admin with anon=X on 149 functions. Install extensions into the extensions schema, not public.';

revoke all on function public.nexus_guard_born_open_grants() from anon, authenticated, public;

drop event trigger if exists nexus_guard_born_open_grants;
create event trigger nexus_guard_born_open_grants
  on ddl_command_end
  execute function public.nexus_guard_born_open_grants();
