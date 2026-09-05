-- NEXUS baseline verification harness.
-- Reproduces the parts of a Supabase project that the baseline deliberately
-- does not contain, so that a replay exercises NEXUS's own SQL rather than the
-- absence of the platform. Mirrors supabase/README.md, plus the roles the
-- 4 September schema-door migration names by hand.

-- Roles ---------------------------------------------------------------------
do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then
  create role anon nologin;
end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then
  create role authenticated nologin;
end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then
  create role service_role nologin bypassrls;
end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticator') then
  create role authenticator noinherit login;
end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='supabase_admin') then
  create role supabase_admin superuser createrole createdb replication bypassrls;
end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then
  create role supabase_auth_admin nologin createrole;
end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='supabase_storage_admin') then
  create role supabase_storage_admin nologin createrole;
end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='supabase_realtime_admin') then
  create role supabase_realtime_admin nologin;
end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='supabase_replication_admin') then
  create role supabase_replication_admin nologin replication;
end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='supabase_read_only_user') then
  create role supabase_read_only_user nologin bypassrls;
end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='supabase_etl_admin') then
  create role supabase_etl_admin nologin replication;
end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='supabase_privileged_role') then
  create role supabase_privileged_role nologin;
end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='dashboard_user') then
  create role dashboard_user nologin createrole createdb replication;
end if; end $$;
do $$ begin if not exists (select 1 from pg_roles where rolname='pgbouncer') then
  create role pgbouncer nologin;
end if; end $$;

grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres with admin option;

-- Schemas -------------------------------------------------------------------
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists graphql_public;
create schema if not exists storage;
create schema if not exists realtime;

-- Extensions ----------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- Auth surface the schema depends on ----------------------------------------
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz default now()
);

create or replace function auth.jwt() returns jsonb
  language sql stable
  as $$ select coalesce(
      nullif(current_setting('request.jwt.claim', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb $$;

create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid $$;

create or replace function auth.role() returns text
  language sql stable
  as $$ select coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    )::text $$;

grant usage on schema auth to anon, authenticated, service_role;

-- The stock Supabase openness the baseline is supposed to close --------------
-- Both default-privilege lines, so that the baseline's REVOKEs are exercised
-- rather than assumed, and the stock schema door.
grant usage on schema public to postgres, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;

alter default privileges for role supabase_admin in schema public
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;

-- storage: the third default-ACL line the 4 September work narrows.
alter default privileges for role postgres in schema storage
  grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema storage
  grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema storage
  grant all on sequences to postgres, anon, authenticated, service_role;
