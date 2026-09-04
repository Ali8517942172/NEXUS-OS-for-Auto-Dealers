
-- Leads policies
CREATE POLICY "leads_authenticated_all" ON public.leads
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "leads_service_role_all" ON public.leads
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Inventory policies
CREATE POLICY "inventory_public_read" ON public.inventory
  FOR SELECT TO anon USING (true);
CREATE POLICY "inventory_authenticated_all" ON public.inventory
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "inventory_service_role_all" ON public.inventory
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Competitors policies
CREATE POLICY "competitors_authenticated_all" ON public.competitors
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "competitors_service_role_all" ON public.competitors
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- RAG documents policies
CREATE POLICY "rag_docs_authenticated_all" ON public.rag_documents
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "rag_docs_service_role_all" ON public.rag_documents
  FOR ALL TO service_role USING (true) WITH CHECK (true);
