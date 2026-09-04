
-- BUSINESS RULE
-- Nothing that resolves or reveals a dealership's identity is reachable
-- without signing in. Supabase's default privileges grant EXECUTE on every new
-- public function to `anon`, so the two helpers added minutes earlier were
-- callable at /rest/v1/rpc/... by anyone holding the publishable anon key:
-- nexus_scoped_tenant_id() would have handed out ALBA CARS' tenant UUID, and
-- nexus_kyc_object_tenant(name) is a yes/no oracle for whether a guessed KYC
-- object path exists. Both are SECURITY DEFINER, so RLS does not save them.
-- This is the same regression shape that put the anon key over five views on
-- 2 September: a REVOKE ... FROM PUBLIC does not remove a grant held directly
-- by `anon`.

revoke execute on function public.nexus_scoped_tenant_id() from anon;
revoke execute on function public.nexus_kyc_object_tenant(text) from anon;
revoke execute on function public.search_rag_documents(text, integer, uuid) from anon;
