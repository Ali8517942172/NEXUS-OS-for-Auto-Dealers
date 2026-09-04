-- NEXUS OS multi-tenancy, step 4 of 6: every USING (true) becomes a tenant test.
--
-- Two rules were followed strictly:
--   1. The VERB SET IS UNCHANGED. A table that was read-only to `authenticated`
--      stays read-only; a table that was ALL stays ALL. Widening access while
--      narrowing visibility would trade one risk for another.
--   2. service_role keeps unconditional access. n8n runs as service_role and is
--      off-limits to this agent, so nothing it does may change today.
--
-- A row with tenant_id IS NULL matches no tenant and is therefore invisible to
-- every signed-in user. That is deliberate: an insert path that loses its
-- tenant fails loudly on screen instead of quietly leaking to another dealer.
set local lock_timeout = '5s';

-- ── read-only to authenticated, within the tenant ─────────────────────────
drop policy if exists audit_log_authenticated_read on public.audit_log;
create policy audit_log_authenticated_read on public.audit_log
  for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists communication_logs_authenticated_read on public.communication_logs;
create policy communication_logs_authenticated_read on public.communication_logs
  for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists customer_360_authenticated_read on public.customer_360_profiles;
create policy customer_360_authenticated_read on public.customer_360_profiles
  for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists daily_metrics_authenticated_read on public.daily_metrics;
create policy daily_metrics_authenticated_read on public.daily_metrics
  for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists deals_embeddings_authenticated_read on public.deals_embeddings;
create policy deals_embeddings_authenticated_read on public.deals_embeddings
  for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists finance_quotes_authenticated_read on public.finance_quotes;
create policy finance_quotes_authenticated_read on public.finance_quotes
  for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists kyc_documents_staff_read on public.kyc_documents;
create policy kyc_documents_staff_read on public.kyc_documents
  for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists purchase_history_authenticated_read on public.purchase_history;
create policy purchase_history_authenticated_read on public.purchase_history
  for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists rag_documents_authenticated_read on public.rag_documents;
create policy rag_documents_authenticated_read on public.rag_documents
  for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists users_authenticated_read on public.users;
create policy users_authenticated_read on public.users
  for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists whatsapp_contacts_authenticated_read on public.whatsapp_contacts;
create policy whatsapp_contacts_authenticated_read on public.whatsapp_contacts
  for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));

-- ── read/write to authenticated, within the tenant ────────────────────────
-- The dashboard PATCHes leads, and POSTs/PATCHes/DELETEs inventory.
drop policy if exists leads_authenticated_all on public.leads;
create policy leads_authenticated_all on public.leads
  for all to authenticated
  using      (tenant_id in (select public.nexus_current_tenant_ids()))
  with check (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists inventory_authenticated_all on public.inventory;
create policy inventory_authenticated_all on public.inventory
  for all to authenticated
  using      (tenant_id in (select public.nexus_current_tenant_ids()))
  with check (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists competitors_authenticated_all on public.competitors;
create policy competitors_authenticated_all on public.competitors
  for all to authenticated
  using      (tenant_id in (select public.nexus_current_tenant_ids()))
  with check (tenant_id in (select public.nexus_current_tenant_ids()));

-- ── service_role: unchanged, and made explicit where it was only implicit ──
-- service_role carries BYPASSRLS, so these policies are belt-and-braces. They
-- exist so that removing BYPASSRLS one day does not silently break n8n.
drop policy if exists daily_metrics_service_role_all on public.daily_metrics;
create policy daily_metrics_service_role_all on public.daily_metrics
  for all to service_role using (true) with check (true);

drop policy if exists workflow_registry_service_role_all on public.workflow_registry;
create policy workflow_registry_service_role_all on public.workflow_registry
  for all to service_role using (true) with check (true);

-- ── anon is locked out, permanently ───────────────────────────────────────
-- On 2 Sep the public anon key read every customer through five views. A
-- RESTRICTIVE policy is ANDed with everything, so no future permissive policy
-- can re-open anon by accident. This is the guard that incident asked for.
do $mig$
declare t text;
begin
  foreach t in array array[
    'leads','communication_logs','whatsapp_contacts','inventory',
    'purchase_history','finance_quotes','kyc_documents','customer_360_profiles',
    'competitors','rag_documents','audit_log','processed_messages',
    'daily_metrics','users','deals_embeddings','workflow_registry'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_deny_anon', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to anon using (false) with check (false)',
      t || '_deny_anon', t);
  end loop;
end
$mig$;