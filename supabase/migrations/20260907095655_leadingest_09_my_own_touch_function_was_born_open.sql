-- The trigger function added by leadingest_08 was born open, and I wrote it one
-- migration after re-reading the section of CLAUDE.md that describes this exact
-- trap. Recording it rather than quietly folding the REVOKE into 08, because the
-- fact that it happened again is the useful part.
--
-- Measured on staging immediately after applying 08:
--
--   channel_registry_touch                postgres=X | service_role=X
--   lead_ingest_endpoint_touch            postgres=X | service_role=X
--   tenant_capability_touch               postgres=X | service_role=X
--   whatsapp_templates_touch              postgres=X | service_role=X
--   lead_ingest_provider_identity_touch   =X/postgres | postgres=X |
--                                         authenticated=X | service_role=X
--
-- Every sibling carries the revoke. Mine did not, so Supabase's default
-- privileges landed EXECUTE on PUBLIC and on `authenticated`. Note the shape of
-- the leak: `anon` does not appear in that ACL at all. It reaches the function
-- through the bare `=X/postgres` PUBLIC entry, so a sweep written as
-- `proacl like '%anon=%'` -- which this project has used -- reports it as
-- closed while it is fully reachable. It was caught by
-- has_function_privilege(), which asks whether the role can execute rather than
-- what the ACL string looks like.
--
-- The body is a two-line updated_at setter and is harmless today. That is not
-- the risk. The risk is a later CREATE OR REPLACE adding SECURITY DEFINER or a
-- tenant read to it, which opens a live hole with NO grant-shaped diff to
-- review, because the grant was already sitting there. This project has paid
-- for that shape three times.
--
-- Revoked from anon, authenticated AND public. Revoking only PUBLIC, or only
-- the named roles, is what left an earlier object open after it was believed
-- closed: a direct grant and a PUBLIC grant are separate ACL rows.

revoke all on function public.lead_ingest_provider_identity_touch()
  from anon, authenticated, public;

grant execute on function public.lead_ingest_provider_identity_touch()
  to service_role;
