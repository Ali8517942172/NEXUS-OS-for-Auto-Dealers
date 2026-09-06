-- ===========================================================================
-- POLICY ENGINE — 11 · closing the default grant this pass reproduced live
--
-- BUSINESS RULE (a security one, and it was proven rather than assumed)
-- After creating the three read views in policy_04, the ACL was read back
-- rather than trusted. All three carried:
--
--     authenticated=arwdDxtm/postgres
--
-- — SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER — arriving
-- from Supabase's default privileges, which grant DIRECTLY to `authenticated`
-- on every new object in public. policy_04 and policy_07 both revoked from
-- `anon, public` and then granted SELECT to `authenticated`; the grant merely
-- ADDED to a full-privilege entry that was already there and that neither
-- revoke named. Nothing in either migration's diff showed it. This is the
-- fifth time this exact shape has opened something in this project, and the
-- first time it has been caught inside the same pass that created it.
--
-- Two of the three views are not auto-updatable today (a LATERAL join in
-- v_policy_rule, a join in v_policy_rule_history), so a write through them
-- would currently fail on the view's shape rather than on a privilege. That is
-- an INCIDENTAL lock, not a designed one: simplifying either view — or a
-- future INSTEAD OF trigger — would open a live write path to the policy
-- register with no grant-shaped diff to review. Incidental locks are treated
-- here as open.
--
-- The base tables were revoked correctly in policy_07 (they name
-- `authenticated` explicitly) and read back as `authenticated=r` — so the
-- damage was confined to the views, and the register itself was never
-- writable. The fix is the same everywhere: name every role in the revoke.
-- ===========================================================================

revoke all on public.v_policy_rule             from anon, authenticated, public;
revoke all on public.v_policy_authoritative    from anon, authenticated, public;
revoke all on public.v_policy_rule_history     from anon, authenticated, public;
revoke all on public.v_policy_unmigrated_constant from anon, authenticated, public;

grant select on public.v_policy_rule             to authenticated, service_role;
grant select on public.v_policy_authoritative    to authenticated, service_role;
grant select on public.v_policy_rule_history     to authenticated, service_role;
grant select on public.v_policy_unmigrated_constant to authenticated, service_role;

-- And re-assert the base tables, so that a later CREATE OR REPLACE or an
-- extension-triggered re-grant does not quietly restore what was removed.
revoke all on public.policy_rule                from anon, authenticated, public;
revoke all on public.policy_rule_event          from anon, authenticated, public;
revoke all on public.policy_rule_type           from anon, authenticated, public;
revoke all on public.policy_unit                from anon, authenticated, public;
revoke all on public.policy_unmigrated_constant from anon, authenticated, public;

grant select on public.policy_rule                to authenticated;
grant select on public.policy_rule_event          to authenticated;
grant select on public.policy_rule_type           to authenticated;
grant select on public.policy_unit                to authenticated;
grant select on public.policy_unmigrated_constant to authenticated;

grant select, insert, update, delete on public.policy_rule                to service_role;
grant select, insert, update, delete on public.policy_rule_event          to service_role;
grant select, insert, update, delete on public.policy_rule_type           to service_role;
grant select, insert, update, delete on public.policy_unit                to service_role;
grant select, insert, update, delete on public.policy_unmigrated_constant to service_role;
