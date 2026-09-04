-- Audit of what the dashboard bundle actually writes: lib/data.js exposes exactly
-- one write helper (dbWrite), and it is called from exactly two places --
-- lib/unit-form.js (inventory create/edit/delete) and lib/lead-drawer.js
-- (leads.assigned_to_id). Nothing in the product writes finance_quotes,
-- rag_documents or users from the browser; those are all service-role paths
-- through n8n.
--
-- Yet all three carried write access for `authenticated`, which means any signed-in
-- dashboard user could, with the anon key and their own JWT:
--
--   * rewrite rag_documents -- the corpus the Ask-AI agent quotes back to staff
--     and customers as company policy. This is the worst of the three: it is an
--     integrity hole in the thing the AI treats as ground truth.
--   * forge or delete finance_quotes, the record of what APR a customer was offered.
--   * insert or edit users rows, including role.
--
-- Narrowed to read-only. service_role has BYPASSRLS, so every n8n workflow is
-- unaffected. inventory and leads keep their write policies -- those are the two
-- the product genuinely uses.

-- rag_documents: read-only from the browser
drop policy if exists rag_docs_authenticated_all on public.rag_documents;
create policy rag_documents_authenticated_read
  on public.rag_documents for select to authenticated using (true);

-- finance_quotes: read-only from the browser. It had no service_role policy
-- either; add one explicitly so the intent is visible in the schema rather than
-- resting on BYPASSRLS.
drop policy if exists finance_quotes_authenticated on public.finance_quotes;
create policy finance_quotes_authenticated_read
  on public.finance_quotes for select to authenticated using (true);
create policy finance_quotes_service_role_all
  on public.finance_quotes for all to service_role using (true) with check (true);

-- users: the roster is read-only from the browser. There is no self-service
-- profile edit and no invite endpoint; both would be added deliberately, with
-- a policy scoped to auth.uid() rather than a blanket grant.
drop policy if exists users_authenticated_insert on public.users;
drop policy if exists users_authenticated_update on public.users;

-- kyc_documents had no explicit service_role policy either (same reasoning).
create policy kyc_documents_service_role_all
  on public.kyc_documents for all to service_role using (true) with check (true);