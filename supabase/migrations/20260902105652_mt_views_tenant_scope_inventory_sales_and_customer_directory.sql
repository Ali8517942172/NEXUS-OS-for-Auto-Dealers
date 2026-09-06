-- ─────────────────────────────────────────────────────────────────────────────
-- Two views were cross-tenant. One of them quotes cars to customers.
--
-- v_inventory_sales is the projection every customer-facing AI tool points at
-- (the WhatsApp sales agent quotes from it). It selected the whole inventory
-- table with no tenant predicate and exposed no tenant_id, so:
--   * a service_role caller (n8n is BYPASSRLS) saw EVERY dealership's stock,
--     and could not have filtered even if it wanted to — the column was absent;
--   * dealership two's customers would have been quoted dealership one's cars
--     at dealership one's prices.
-- That is a customer-facing cross-tenant leak, not an internal reporting one.
--
-- v_customer_directory is the spine of the Customers screen and the source the
-- Customer 360 batch reads. It grouped on lower(email) across ALL tenants, so
-- one customer known to two dealerships collapsed into a single directory row
-- blending both. No tenant_id meant the batch could not be made tenant-aware.
--
-- THE PREDICATE, AND WHY THIS ONE
--   public.nexus_scoped_tenant_id() returns the signed-in caller's tenant, and
--   falls back to the unattributed-default tenant ONLY while exactly one tenant
--   is active. So today (ALBA CARS alone) both views return exactly what they
--   returned before, for the dashboard and for n8n alike — the live path is
--   unchanged. The moment a second dealership is activated the fallback stops
--   resolving and a service_role caller that has not yet been taught to send a
--   tenant gets ZERO rows rather than the wrong dealership's cars. It fails
--   closed, which is the direction the rest of this system already fails in.
--
--   Both views are security_invoker, so for a signed-in user RLS on the base
--   tables scopes them too; this predicate is what protects the BYPASSRLS
--   caller, which RLS by definition cannot.
--
--   tenant_id is APPENDED as the last column of each view, never inserted in
--   the middle: the dashboard reads v_customer_directory with select=* and
--   positional assumptions are cheap to break and expensive to find.
--
-- security_invoker is restated on both. A database event trigger fails the
-- deploy without it, and CREATE OR REPLACE VIEW has silently dropped the
-- option three times in this project's history.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_inventory_sales WITH (security_invoker = on) AS
 SELECT i.id,
    i.model,
    i.status,
    i.price_aed,
    i.days_in_stock,
    i.tenant_id
   FROM public.inventory i
  WHERE i.tenant_id = public.nexus_scoped_tenant_id();

COMMENT ON VIEW public.v_inventory_sales IS
  'Customer-facing projection of inventory for the WhatsApp sales agent. Excludes cost_aed, all margin and commission columns, holding cost, and the ai_recommendation free-text field. Point every customer-facing AI tool at this view, never at inventory directly. Tenant-scoped: rows are restricted to nexus_scoped_tenant_id(), which resolves to the signed-in caller''s tenant and, for a BYPASSRLS service_role caller, to the unattributed-default tenant only while exactly one tenant is active. With two active tenants a service_role caller that sends no tenant gets zero rows, never another dealership''s stock.';

CREATE OR REPLACE VIEW public.v_customer_directory WITH (security_invoker = on) AS
 SELECT lower(x.email) AS id,
    (array_agg(x.name ORDER BY x.at DESC NULLS LAST)
       FILTER (WHERE x.name IS NOT NULL AND x.name <> ''::text))[1] AS name,
    lower(x.email) AS email,
    (array_agg(x.phone ORDER BY x.at DESC NULLS LAST)
       FILTER (WHERE x.phone IS NOT NULL AND x.phone <> ''::text))[1] AS phone,
    count(*) AS source_records,
    max(x.at) AS last_seen_at,
    x.tenant_id
   FROM ( SELECT leads.email,
            leads.name,
            leads.phone,
            leads.created_at AS at,
            leads.tenant_id
           FROM public.leads
          WHERE leads.email IS NOT NULL AND leads.email <> ''::text
            AND leads.tenant_id = public.nexus_scoped_tenant_id()
        UNION ALL
         SELECT purchase_history.email,
            purchase_history.customer_name,
            purchase_history.phone,
            purchase_history.created_at,
            purchase_history.tenant_id
           FROM public.purchase_history
          WHERE purchase_history.email IS NOT NULL AND purchase_history.email <> ''::text
            AND purchase_history.tenant_id = public.nexus_scoped_tenant_id()) x
  GROUP BY x.tenant_id, lower(x.email);

COMMENT ON VIEW public.v_customer_directory IS
  'Every person the business knows, keyed on lower(email) WITHIN a dealership - leads UNION purchase_history. Tenant-scoped: both branches are restricted to nexus_scoped_tenant_id() and the grouping is per (tenant_id, lower(email)), so one customer known to two dealerships is two directory rows, not one blended row. id remains lower(email) and is unique within any single result set because the view never returns more than one tenant. A lead with an empty email column is absent from this view by design.';