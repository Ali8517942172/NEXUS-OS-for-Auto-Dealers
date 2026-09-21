-- NX1000 — Customer 360 went dark at the second dealership.
--
-- NX991 (20260917080000) gave every backend caller with no identity a hard
-- choice at 2+ active non-quarantine tenants: name the dealership explicitly,
-- or raise SQLSTATE NX991 instead of quietly returning nothing. That was the
-- right call for a caller that CAN name a tenant. n8n workflow AZkGM5M4c1uzSH7S
-- ("Customer 360 — Data Aggregation (Bitrix24)", active, nightly cron), node
-- "Get Customer Directory", cannot: it reads public.v_customer_directory as a
-- bare GET with the shared service_role credential and no tenant filter at
-- all, because the view is security_invoker and filters on
-- tenant_id = any(nexus_caller_tenant_scope(...)) — and a service_role caller
-- with no auth.uid() only resolves through nexus_caller_tenant_scope's
-- backend branch, which is exactly the branch NX991 made raise at 2+ tenants.
-- So the day dealer B's `tenants` row goes status='active', ALBA's own
-- nightly Customer 360 sync starts failing its very first node, every night,
-- with no page and no error surfaced anywhere but the n8n execution log.
-- See ops/tenant-precedence/DEALER2-LANDMINES.md for the full trace (live
-- pg_get_functiondef + live node JSON), row "v_customer_directory ... Customer
-- 360 — Data Aggregation (Bitrix24)", BLOCKS_DEALER_B = YES.
--
-- THE FIX, same shape NX991 already used for search_rag_documents(q, limit)
-- and nexus_lead_for_comm_key(key): give the backend a tenant-taking form
-- that does not ask nexus_caller_tenant_scope() a question it cannot answer,
-- so the workflow can iterate public.nexus_active_dealership_ids() and call
-- this once per dealership, carrying tenant_id onto every downstream write,
-- instead of reading the bare view under service_role.
--
-- WHY SECURITY DEFINER AND SERVICE_ROLE-ONLY, UNLIKE THE INVOKER-STYLE
-- search_rag_documents(q, limit, p_tenant). That form stays SECURITY INVOKER
-- because rag_documents carries its own per-row RLS and an authenticated
-- caller naming a foreign tenant is still stopped by that RLS — the tenant
-- argument narrows, RLS is the real boundary. v_customer_directory's own
-- source rows (leads, purchase_history) are not asserted to fail closed the
-- same way for an authenticated caller naming an arbitrary p_tenant, and this
-- function exists ONLY for the one service_role batch job that cannot name
-- its caller at all. So p_tenant IS the entire boundary here, and the only
-- caller ever allowed to supply it is one that already bypasses RLS by role
-- (service_role) rather than one whose input a policy would still check.
-- Locking this to service_role, with EXECUTE named-revoked from public, anon
-- AND authenticated in this same migration (a bare `create function` here
-- would otherwise hand authenticated a standing EXECUTE grant with no
-- grant-shaped diff to review — measured behaviour, see NX991's own note on
-- nexus_fuse_dependent_objects), is what keeps a signed-in user from ever
-- being able to pass an arbitrary p_tenant and read another dealership's
-- customers through this door.
--
-- WHAT THIS MIGRATION DOES NOT DO. It does not touch public.v_customer_directory
-- itself: the view keeps reading nexus_caller_tenant_scope() exactly as NX991
-- left it, so a signed-in dashboard user still gets exactly their own
-- dealerships and nothing else, unchanged. Only the n8n batch is rewired, in
-- ops/tenant-precedence/patched2/AZkGM5M4c1uzSH7S.json (not yet applied to the
-- live workflow — n8n is read-only for this task).

begin;

create or replace function public.nexus_customer_360_directory_for_tenant(p_tenant uuid)
returns table (
  id             text,
  name           text,
  email          text,
  phone          text,
  source_records bigint,
  last_seen_at   timestamptz,
  tenant_id      uuid
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select _v.id, _v.name, _v.email, _v.phone, _v.source_records, _v.last_seen_at, _v.tenant_id
    from (
      select lower(x.email) as id,
             (array_agg(x.name  order by x.at desc nulls last)
                filter (where x.name  is not null and x.name  <> ''))[1] as name,
             lower(x.email) as email,
             (array_agg(x.phone order by x.at desc nulls last)
                filter (where x.phone is not null and x.phone <> ''))[1] as phone,
             count(*) as source_records,
             max(x.at) as last_seen_at,
             x.tenant_id
        from (
          select l.email, l.name, l.phone, l.created_at as at, l.tenant_id
            from public.leads l
           where p_tenant is not null
             and l.tenant_id = p_tenant
             and l.email is not null and l.email <> ''
          union all
          select p.email, p.customer_name, p.phone, p.created_at, p.tenant_id
            from public.purchase_history p
           where p_tenant is not null
             and p.tenant_id = p_tenant
             and p.email is not null and p.email <> ''
        ) x
       group by x.tenant_id, lower(x.email)
    ) _v
   where p_tenant is not null
     and not exists (
       select 1 from public.tenants _q
        where _q.id = p_tenant and _q.is_quarantine
     );
$fn$;

comment on function public.nexus_customer_360_directory_for_tenant(uuid) is
  'Customer 360 directory rows (same shape and dedupe logic as v_customer_directory) '
  'for exactly ONE explicit dealership, named by p_tenant. Exists so the '
  'service_role Customer 360 batch (n8n AZkGM5M4c1uzSH7S, node "Get Customer '
  'Directory") can iterate public.nexus_active_dealership_ids() and call this once '
  'per dealership instead of reading the bare view, which raises NX991 for '
  'service_role once 2+ active non-quarantine tenants exist. NULL p_tenant or a '
  'quarantine tenant returns zero rows rather than guessing. SECURITY DEFINER and '
  'service_role-only on purpose: p_tenant is the entire boundary here (no RLS backs '
  'leads/purchase_history for an arbitrary caller the way rag_documents RLS backs '
  'search_rag_documents(q, limit, p_tenant)), so anon/authenticated must never reach '
  'it — a signed-in user could otherwise pass any tenant id and read another '
  'dealership''s customers. Does not alter v_customer_directory or its behaviour for '
  'dashboard users, which keeps reading nexus_caller_tenant_scope() unchanged.';

revoke all on function public.nexus_customer_360_directory_for_tenant(uuid) from public, anon, authenticated;
grant execute on function public.nexus_customer_360_directory_for_tenant(uuid) to service_role;

commit;
