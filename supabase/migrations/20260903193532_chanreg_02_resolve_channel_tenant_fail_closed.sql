-- The resolver n8n calls instead of reading body.session against an env var.
--
-- RETURNS A SET, NOT A SCALAR, ON PURPOSE.
-- Unresolved is zero rows, not NULL. Through PostgREST that is `[]`, and in n8n
-- a node that produces no items halts its branch — which is exactly the
-- fail-closed behaviour the current `Resolve Tenant` node was measured to have
-- on 3 Sep (unknown session -> zero items -> zero writes). A scalar returning
-- NULL would hand the next node one item whose json is null, which a careless
-- downstream expression can read as success.
--
-- NO FALLBACK OF ANY KIND. There is no is_unattributed_default clause here and
-- there must never be one: this function's entire job is to refuse when the
-- binding is absent.

create or replace function public.nexus_resolve_channel_tenant(
  p_channel_type       text,
  p_external_identifier text
)
returns table (
  tenant_id           uuid,
  tenant_slug         text,
  integration_id      uuid,
  channel_type        text,
  external_identifier text
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select cr.tenant_id,
         t.slug,
         cr.integration_id,
         cr.channel_type,
         cr.external_identifier
    from public.channel_registry cr
    join public.tenants t on t.id = cr.tenant_id
   where cr.channel_type        = lower(btrim(coalesce(p_channel_type, '')))
     and cr.external_identifier = lower(btrim(coalesce(p_external_identifier, '')))
     -- REQUIREMENT 4: a suspended channel resolves to nothing.
     and cr.status = 'active'
     -- A suspended DEALERSHIP resolves to nothing either, so a single
     -- tenants.status change takes every one of its channels off the air.
     and t.status  = 'active'
     -- REQUIREMENT 2, second half. Same guard, same wording, as the fallback
     -- clause a sibling agent just added to nexus_default_tenant_id() and
     -- nexus_scoped_tenant_id() on 3 Sep: a signed-in end user is never handed
     -- a tenant by a backend resolver. Here it is defence in depth rather than
     -- the primary lock — EXECUTE is revoked from anon and authenticated in
     -- chanreg_03 — because CLAUDE.md's own history is that a later
     -- CREATE OR REPLACE or a platform default-privilege can re-open a grant
     -- with no grant-shaped diff to review. If that happens, this predicate
     -- still returns zero rows.
     and coalesce(current_setting('role', true), '') not in ('authenticated', 'anon')
   limit 1;
$fn$;

comment on function public.nexus_resolve_channel_tenant(text, text) is
  'Resolve an inbound integration identity to a dealership. Fails closed: '
  'returns ZERO ROWS for an unknown identifier, a suspended channel, a '
  'suspended tenant, a null/blank argument, or any call made under the '
  'authenticated/anon roles. Never falls back to tenants.is_unattributed_default. '
  'Intended caller: n8n as service_role. The caller supplies what the webhook '
  'observed; this function decides whether it means anything.';
