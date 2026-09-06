-- get_advisors flagged this immediately after the guard landed, and it is a
-- real finding rather than lint noise: nexus_guard_born_open_grants() is
-- SECURITY INVOKER by design, which means when supabase_admin runs the DDL the
-- function body executes with SUPERUSER rights. A function that can run as a
-- superuser must not resolve its own identifiers through a caller-controlled
-- search_path. Pinned to pg_catalog: every catalogue relation it reads lives
-- there, and every object it acts on is named through regclass/regprocedure,
-- which renders schema-qualified when the schema is not on the path.
alter function public.nexus_guard_born_open_grants() set search_path = pg_catalog;
