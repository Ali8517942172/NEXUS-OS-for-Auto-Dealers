-- The view was recreated by an earlier migration and defaulted to
-- SECURITY DEFINER, which bypasses RLS on audit_log and workflow_registry.
-- Both base tables already grant SELECT to `authenticated` with qual = true
-- and grant nothing to `anon`, so switching to the invoker's rights keeps the
-- dashboard working while making the view honour RLS.
alter view public.v_workflow_health set (security_invoker = on);