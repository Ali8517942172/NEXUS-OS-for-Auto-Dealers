-- KYC document archive.
-- The IMAGE lives in Supabase Storage (private bucket "kyc-documents").
-- This table stores only metadata plus the path to it. Never put the file in
-- Postgres: it would ride along in every backup, SELECT * and replication, and
-- the free-tier database size is the scarce resource, not Storage.

ALTER TABLE public.kyc_documents
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS retain_until date;

COMMENT ON COLUMN public.kyc_documents.storage_path IS
  'Object path inside the private "kyc-documents" bucket, e.g. kyc/<email>/2026/08/<uuid>.jpg. Read it with a short-lived signed URL - never a public URL.';
COMMENT ON COLUMN public.kyc_documents.retain_until IS
  'Delete the stored image on or after this date. UAE AML record-keeping is commonly 5 years; confirm with the customer''s legal team before go-live.';

ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kyc_documents_staff_read ON public.kyc_documents;
CREATE POLICY kyc_documents_staff_read ON public.kyc_documents
  FOR SELECT TO authenticated USING (true);

-- Storage object policies. Only signed-in staff may list/read; writes are left
-- to the service role (the n8n workflow), so a leaked anon key cannot upload.
DROP POLICY IF EXISTS kyc_objects_staff_read ON storage.objects;
CREATE POLICY kyc_objects_staff_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'kyc-documents');

DROP POLICY IF EXISTS kyc_objects_no_anon ON storage.objects;
CREATE POLICY kyc_objects_no_anon ON storage.objects
  FOR ALL TO anon
  USING (false) WITH CHECK (false);