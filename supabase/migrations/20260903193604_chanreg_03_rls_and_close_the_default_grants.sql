-- Read before writing. The ACL on the brand-new objects, measured immediately
-- after chanreg_01/02 and before this migration, was exactly the shape CLAUDE.md
-- warns about:
--   channel_registry              authenticated=arwdDxtm/postgres   <- incl. D (TRUNCATE, unfiltered by RLS)
--   nexus_resolve_channel_tenant  =X/postgres  and  authenticated=X/postgres
--   channel_registry_touch        =X/postgres  and  authenticated=X/postgres
-- Nobody wrote those. They arrive from Supabase default privileges. `anon` was
-- absent because the ALTER DEFAULT PRIVILEGES backstop for role postgres is in
-- place — but it is revoked below anyway, because that backstop does not cover
-- objects created by supabase_admin and this file must not depend on it.
--
-- Revoke from BOTH the direct grantee AND public: they are separate ACL rows and
-- revoking only PUBLIC leaves the direct grant standing.

revoke all on table public.channel_registry from anon, authenticated, public;
revoke all on function public.nexus_resolve_channel_tenant(text, text) from anon, authenticated, public;
revoke all on function public.channel_registry_touch()                  from anon, authenticated, public;

-- n8n's role, and the only caller of the resolver.
grant execute on function public.nexus_resolve_channel_tenant(text, text) to service_role;
grant all    on table    public.channel_registry                          to service_role;

-- REQUIREMENT 5: a dealership may see its own channels.
-- SELECT only, and NOT on credential_ref. RLS is row-level; withholding the
-- integration pointer from the browser is column-level and has to be done here.
-- credential_ref is operational integration configuration — the same class as
-- workflow_registry, which CLAUDE.md flags as "which automations a dealership
-- runs", not shipped vocabulary. There is no browser reader of this table
-- today, so nothing breaks. Consequence to know: PostgREST `select=*` on this
-- table will 42501 for `authenticated`; name the columns.
grant select (integration_id, tenant_id, channel_type, external_identifier,
              status, created_at, updated_at)
  on public.channel_registry to authenticated;

-- anon is granted nothing at all. Not "granted and then filtered" — nothing.
-- The deny_anon policy below is a second, independent lock, not the lock.

alter table public.channel_registry enable row level security;

drop policy if exists channel_registry_deny_anon          on public.channel_registry;
drop policy if exists channel_registry_authenticated_read on public.channel_registry;
drop policy if exists channel_registry_service_role_all   on public.channel_registry;

create policy channel_registry_deny_anon
  on public.channel_registry
  as restrictive for all to anon
  using (false) with check (false);

create policy channel_registry_authenticated_read
  on public.channel_registry
  for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));

create policy channel_registry_service_role_all
  on public.channel_registry
  as permissive for all to service_role
  using (true) with check (true);
