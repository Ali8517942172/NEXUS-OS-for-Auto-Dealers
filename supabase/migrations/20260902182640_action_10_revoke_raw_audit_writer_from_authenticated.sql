-- ===========================================================================
-- action_10_revoke_raw_audit_writer_from_authenticated
--
-- HOLE, found by the Supabase security linter after action_09 and closed here.
-- public.action_write_audit(p_tenant, ...) takes the tenant as an ARGUMENT and
-- is SECURITY DEFINER, so it writes an audit_log row for whatever tenant it is
-- handed, bypassing RLS. action_03 revoked it from PUBLIC and granted it to
-- service_role only - but Supabase's default privileges had already granted
-- EXECUTE directly to `authenticated`, and revoking from PUBLIC does not touch
-- a direct grant. Any signed-in user could therefore have posted forged audit
-- rows against ANOTHER dealership through /rest/v1/rpc/action_write_audit.
-- Nothing indicates it was called; the window was roughly thirteen minutes on
-- 2026-09-02 and the only rows in audit_log under 'Inventory Action Center' are
-- the five this lane's own walkthrough wrote.
--
-- BUSINESS RULE: an audit row is written as a side effect of something that
-- actually happened. Nobody may call the writer directly.
-- ===========================================================================
revoke execute on function public.action_write_audit(uuid, uuid, text, text, text, text) from authenticated;
revoke execute on function public.inventory_actions_touch() from authenticated;