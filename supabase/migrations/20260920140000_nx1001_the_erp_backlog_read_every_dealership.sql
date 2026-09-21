-- NX1001 — The ERP backlog read every dealership, and the webhook door was
-- itself the sweep.
--
-- ORIGINAL DEFECT. n8n workflow bxNBzBrcOtcFpMPn ("wf_108 ERP Sync — Bitrix24
-- CRM"), node "Fetch HOT Leads from Supabase", was a bare GET against
-- public.leads with the shared service_role credential and no tenant filter
-- at all. Production now has 3 active, non-quarantine tenants (ALBA CARS,
-- NEXUS TEST DEALER B, NEXUS TEST DEALER C — verified live, 20 Sep 2026).
-- "Resolve Tenant" downstream (ops/tenant-precedence/code/erp-sync.Resolve-Tenant.js
-- and the live node) deliberately trusts each row's own tenant_id as database
-- truth for ATTRIBUTION on the sweep branch — the right call for tagging a
-- row correctly — but that was never a check on whether a dealership's leads
-- belong in Bitrix24 at all. The Bitrix24 credential this workflow writes
-- through is ALBA CARS' own connection, so every OTHER dealership's HOT lead
-- the bare GET fetched would have been pushed into ALBA's CRM.
--
-- WHY A FIRST VERSION OF THIS FUNCTION (took no argument, hardcoded ALBA
-- internally) WAS STILL WRONG. Live execution data (n8n executions 15964,
-- 15965, 15966) showed the actual live path: `ErpSyncWebhook` is a PUBLIC POST
-- endpoint gated only by `Verify JWT` + `Auth Gate`, i.e. by "is this any
-- valid Supabase session token", not "does this caller belong to ALBA". A
-- dealer-B user's own valid session token reaches `Fetch HOT Leads from
-- Supabase` exactly as an ALBA user's does, and the tenant check that exists
-- today (`Resolve Tenant`'s `ids.length` guard against `Tenant For JWT User`)
-- runs AFTER that fetch, not before it. A no-argument, ALBA-only function
-- would therefore have let ANY authenticated user of ANY dealership trigger a
-- sync of ALBA's own backlog into ALBA's Bitrix24 on demand, with the run's
-- audit trail reporting tenant ALBA throughout — the caller's identity was
-- never part of the boundary, only the row's tenant_id was.
--
-- WHICH TENANTS MAY THE BACKLOG SYNC? Checked live, 20 Sep 2026:
--   * public.tenant_capability — the CRM_SYNC capability key exists in
--     tenant_capability_catalogue ("Two-way sync with the dealership CRM or
--     DMS") but the tenant_capability TABLE ITSELF IS EMPTY for all 3 tenants.
--   * public.channel_registry — channel_type is a closed vocabulary
--     ('whatsapp_waha_session','whatsapp_cloud_phone_number_id' only). No
--     ERP/CRM/Bitrix24 channel type exists even in principle.
--   * No table anywhere in this schema is named or shaped for a per-tenant
--     ERP/Bitrix24 integration.
-- CONCLUSION: no per-tenant Bitrix24 record exists to read. The allowlist is
-- therefore a FIXED LITERAL in this migration — exactly ALBA CARS'
-- tenant_id (fff6a2b5-cfd5-4460-8383-875bc5826de0), the one dealership this
-- workflow's Bitrix24 credential actually belongs to — not an n8n
-- environment variable ($env.NEXUS_TENANT_MAP): that is the exact
-- anti-pattern channel_registry (20260903193511) already replaced for
-- WhatsApp, for the same reason stated there — "a mapping nothing in the
-- database can see, audit or scope". A literal here is visible in git and to
-- nexus_public_exposure_report(); a VM environment variable is neither.
--
-- THE FIX, SECOND VERSION. p_tenant is now a REQUIRED ARGUMENT, and it is a
-- CLAIM, never a source of truth on its own — same rule NX997/NX998/"Resolve
-- Tenant" already state elsewhere in this wave. The function returns rows for
-- p_tenant ONLY IF p_tenant is itself in the fixed allowlist; any other
-- p_tenant (dealer B, dealer C, garbage, null) returns ZERO ROWS, not an
-- error and not another dealership's data. The workflow-side half of this fix
-- (ops/tenant-precedence/patched3/bxNBzBrcOtcFpMPn.json) now resolves and
-- VALIDATES the webhook caller's OWN dealership — via the same
-- `tenant_members` lookup and the same '[NEXUS-UNATTRIBUTED]' refusal
-- contract 'Resolve Tenant' already uses (0 rows or >1 rows both refuse) —
-- BEFORE calling this function, and passes that resolved id as p_tenant. A
-- dealer-B caller is now validated as dealer B, asks this function for dealer
-- B's leads, and gets zero rows: the allowlist, not a downstream Bitrix24
-- 403, is what stops the sync. The internal hop ("Called by Master Router")
-- never touches this function at all and is unchanged. If a scheduled/cron
-- entry point is ever added that calls this function directly (no caller to
-- validate), it must pass ALBA's tenant_id explicitly rather than reintroduce
-- a no-argument or caller-trusting form.
--
-- SECURITY DEFINER, service_role-only, EXECUTE revoked from public, anon and
-- authenticated by name in this same migration (see nx1000's own note, and
-- ops/ci/function-grants.mjs, on why a bare `create function` is not enough).
--
-- WHAT THIS MIGRATION DOES NOT DO. It does not touch public.leads, RLS on
-- leads, or "Resolve Tenant"'s per-row attribution logic. It does not rewrite
-- the live n8n workflow — n8n is read-only for this task; the patched
-- workflow lives at ops/tenant-precedence/patched3/bxNBzBrcOtcFpMPn.json, not
-- yet applied.

begin;

drop function if exists public.nexus_erp_bitrix24_hot_leads_backlog();

create or replace function public.nexus_erp_bitrix24_hot_leads_backlog(p_tenant uuid)
returns table (
  id               integer,
  name             text,
  email            text,
  phone            text,
  source           text,
  vehicle_interest text,
  budget_aed       integer,
  ai_score         integer,
  status           text,
  created_at       timestamptz,
  bitrix_lead_id   text,
  crm_synced_at    timestamptz,
  tenant_id        uuid
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select l.id, l.name, l.email, l.phone, l.source, l.vehicle_interest,
         l.budget_aed, l.ai_score, l.status, l.created_at, l.bitrix_lead_id,
         l.crm_synced_at, l.tenant_id
    from public.leads l
   where p_tenant is not null
     -- THE ALLOWLIST. p_tenant is the CALLER'S CLAIM (validated upstream, in
     -- the workflow, against tenant_members) -- this is still the entire
     -- boundary on whether that claim is honoured at all. Not in the
     -- allowlist -> zero rows, full stop, regardless of what leads exist.
     and p_tenant = any (array[
           'fff6a2b5-cfd5-4460-8383-875bc5826de0'::uuid  -- ALBA CARS
         ])
     and l.tenant_id = p_tenant
     and l.status = 'HOT'
     and (l.crm_synced_at is null or l.crm_synced_at < now() - interval '6 hours')
   order by l.created_at desc
   limit 100;
$fn$;

comment on function public.nexus_erp_bitrix24_hot_leads_backlog(uuid) is
  'HOT-lead backlog for the n8n ERP Sync — Bitrix24 CRM workflow (bxNBzBrcOtcFpMPn, '
  'node "Fetch HOT Leads from Supabase"). p_tenant is the caller''s claimed '
  'dealership -- validated by the workflow against tenant_members BEFORE this '
  'call, exactly like every other resolver in this wave treats a caller-supplied '
  'tenant as a claim, never a source -- and is honoured ONLY if it is also in the '
  'fixed allowlist below (today: ALBA CARS only, '
  'fff6a2b5-cfd5-4460-8383-875bc5826de0), the one dealership with a Bitrix24 '
  'connection wired to this workflow. Any other p_tenant, including a validated '
  'dealer-B or dealer-C caller, returns ZERO ROWS rather than an error or another '
  'dealership''s data -- this closes the live-execution finding (n8n executions '
  '15964-15966) that any authenticated user of ANY dealership could reach this '
  'node and trigger a sync of ALBA''s backlog into ALBA''s Bitrix24. No table in '
  'this schema records a per-tenant ERP/Bitrix24 integration yet -- '
  'tenant_capability''s CRM_SYNC key has zero rows for every tenant, and '
  'channel_registry''s channel_type vocabulary has no ERP/CRM member -- so the '
  'allowlist is a literal in this migration, reviewable in git, rather than an '
  'n8n $env.NEXUS_TENANT_MAP value nothing in the database can see or audit. '
  'SECURITY DEFINER and service_role-only on purpose, same reasoning as nx1000''s '
  'nexus_customer_360_directory_for_tenant: this function IS the boundary (no '
  'RLS backs public.leads for an arbitrary caller the way rag_documents RLS '
  'backs search_rag_documents), so anon/authenticated must never reach it.';

revoke all on function public.nexus_erp_bitrix24_hot_leads_backlog(uuid) from public, anon, authenticated;
grant execute on function public.nexus_erp_bitrix24_hot_leads_backlog(uuid) to service_role;

commit;
