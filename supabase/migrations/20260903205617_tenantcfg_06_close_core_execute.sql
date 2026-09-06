-- tenantcfg_06_close_core_execute
--
-- Read the ACL back, and when it disagrees with the comment, change the ACL.
--
-- tenantcfg_04 revoked EXECUTE on the two internal cores from anon,
-- authenticated and public, and its comment claimed they were "callable by
-- nobody". The ACL read back as postgres=X, service_role=X: Supabase's default
-- privileges grant EXECUTE to service_role as well, and the revoke did not name
-- it. Not exposure - service_role already bypasses RLS and can read these
-- tables directly - but the sentence in the catalogue was false, and a false
-- comment about a grant is how the next reader mis-scopes the next function.
--
-- The wrappers are unaffected: they are SECURITY DEFINER owned by postgres, so
-- the inner call is checked against postgres, not against the caller. One
-- derivation, and now genuinely two doors into it.

revoke all on function public.nexus_tenant_config_core(uuid)     from service_role;
revoke all on function public.nexus_tenant_capability_core(uuid) from service_role;