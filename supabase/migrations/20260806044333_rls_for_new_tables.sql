-- kyc_documents holds names, DOB and document numbers. It must never be readable
-- by anon. Same rule already applied to leads.
ALTER TABLE kyc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kyc_documents_authenticated_all ON kyc_documents;
CREATE POLICY kyc_documents_authenticated_all ON kyc_documents
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS daily_metrics_authenticated_read ON daily_metrics;
CREATE POLICY daily_metrics_authenticated_read ON daily_metrics
  FOR SELECT TO authenticated USING (true);

-- No anon policy on either table: RLS enabled with zero matching policies = deny all.