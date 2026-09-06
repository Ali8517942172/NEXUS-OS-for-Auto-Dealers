-- audit_log had RLS enabled with zero policies, so nobody except service_role
-- could read it -- not even a signed-in dashboard user. The activity feed
-- rendered empty despite 30 rows existing.
--
-- Deliberately NOT granting anon: audit_log rows carry lead_name and lead_email,
-- i.e. customer PII. Same treatment as public.leads.
CREATE POLICY audit_log_authenticated_read
  ON public.audit_log FOR SELECT TO authenticated USING (true);

-- n8n writes to this table with the service_role key; make that explicit rather
-- than relying on service_role's implicit RLS bypass.
CREATE POLICY audit_log_service_role_all
  ON public.audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);