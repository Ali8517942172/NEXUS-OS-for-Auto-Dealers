-- NEXUS 2026-09-04: close the anon exposure that arrives through CREATE EXTENSION.
--
-- Root cause (measured, not inferred): supautils intercepts CREATE EXTENSION for
-- every name in supautils.privileged_extensions and re-runs it as
-- supautils.superuser = supabase_admin, while SKIPPING event triggers owned by
-- non-superusers (supautils.log_skipped_evtrigs exists precisely for this).
-- Consequences, both proved:
--   1. Extension objects land in public OWNED BY supabase_admin, so the
--      supabase_admin default-ACL line for public applies: anon=arwdDxtm, RLS off.
--   2. No event trigger owned by postgres fires -- not ddl_command_end, not
--      ddl_command_start, tagged or untagged. The guard cannot cover this door.
-- postgres cannot close the supabase_admin default-ACL line (42501) and cannot
-- REVOKE a grant it did not make (the statement succeeds and changes nothing).
--
-- The one lever postgres does own is the SCHEMA DOOR. anon holds USAGE on public
-- twice: a direct grant and the PUBLIC grant. Both are granted by
-- pg_database_owner, and postgres is a member of pg_database_owner.
-- Without USAGE on the schema, no object ACL inside it is reachable -- including
-- objects that do not exist yet, whichever path creates them.
--
-- Safe here because anon reaches NOTHING in public today: zero tables, views,
-- sequences with an anon or a PUBLIC grant; the only anon-granted functions are
-- the 149 pg_trgm/vector extension members, which PostgREST does not even expose
-- (unnamed arguments), read no table, and already carry PUBLIC =X.

-- 1. THE SCHEMA DOOR ---------------------------------------------------------
revoke usage on schema public from public;
revoke usage on schema public from anon;

-- Every role that held USAGE only through PUBLIC gets it back by name, except anon.
-- postgres, authenticated, service_role and pg_database_owner keep pre-existing
-- direct grants and are deliberately not restated.
grant usage on schema public to
  authenticator,
  dashboard_user,
  pgbouncer,
  supabase_admin,
  supabase_auth_admin,
  supabase_storage_admin,
  supabase_realtime_admin,
  supabase_replication_admin,
  supabase_read_only_user,
  supabase_etl_admin,
  supabase_privileged_role;

-- 2. THE THIRD DEFAULT-ACL LINE: postgres / storage --------------------------
-- Every existing object in storage is owned by supabase_storage_admin, so this
-- line has never applied to one. It applies to objects postgres creates in
-- storage in future, and it grants anon ALL. Narrowed to mirror public.
alter default privileges for role postgres in schema storage
  revoke all on tables from anon;
alter default privileges for role postgres in schema storage
  revoke insert, update, delete, truncate, references, trigger on tables from authenticated;
alter default privileges for role postgres in schema storage
  revoke all on sequences from anon;
alter default privileges for role postgres in schema storage
  revoke all on sequences from authenticated;
alter default privileges for role postgres in schema storage
  revoke all on functions from anon;
