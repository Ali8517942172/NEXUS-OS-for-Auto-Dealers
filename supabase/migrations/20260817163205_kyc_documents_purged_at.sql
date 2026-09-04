-- Retention: when the stored document was actually deleted from the bucket.
-- `storage_path` is deliberately kept after the purge so the deletion is
-- provable ("this object existed and was destroyed on this date"); the path is
-- a UUID filename and holds no personal data. Anything that reads a document
-- must check `purged_at IS NULL` first — otherwise it will sign a URL for an
-- object that no longer exists.
alter table public.kyc_documents
  add column if not exists purged_at timestamptz;

comment on column public.kyc_documents.purged_at is
  'Set by the NEXUS Retention Purge workflow when the Storage object was deleted after retain_until passed. NULL means the document is still archived.';

comment on column public.kyc_documents.storage_path is
  'Object key inside the private kyc-documents bucket. Read only via a short-lived signed URL, never a public URL. NULL with purged_at also NULL means the archive step failed for this document — a compliance gap worth alerting on.';

comment on column public.kyc_documents.retain_until is
  'Deletion due date. Retention agreed at 7 years (UAE AML record-keeping, conservative end).';

create index if not exists kyc_documents_retention_idx
  on public.kyc_documents (retain_until)
  where purged_at is null;