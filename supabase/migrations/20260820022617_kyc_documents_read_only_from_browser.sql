-- kyc_documents carried two overlapping SELECT policies for `authenticated`,
-- and one of them (kyc_documents_authenticated_all) was an ALL policy with
-- USING true / WITH CHECK true. That let any signed-in dashboard user insert,
-- update or delete AML compliance records straight from the browser with the
-- anon key plus their JWT. Nothing in the product does that: KYC rows are only
-- ever written by the n8n KYC/AML auditor, which uses the service role, and
-- service_role has BYPASSRLS so it is unaffected by this change.
--
-- Dropping the ALL policy closes the write hole and also resolves the
-- multiple_permissive_policies performance warning, since kyc_documents_staff_read
-- already grants exactly the read access the compliance screen needs.
drop policy if exists kyc_documents_authenticated_all on public.kyc_documents;

-- reviewed_by is a foreign key with no covering index; the compliance screen
-- will join on it once reviewer attribution ships.
create index if not exists idx_kyc_documents_reviewed_by
  on public.kyc_documents (reviewed_by);