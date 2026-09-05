-- ===========================================================================
-- DEFECT 2 - two control-plane tables were readable from the dealer data plane.
--
-- CONTROL-PLANE.md draws the line: the control plane is the vendor's world
-- (platform identity, who vouched for what, support access); the dealer data
-- plane is what the twenty dashboard screens read. These two tables sat in the
-- dealer database with a SELECT USING (true) policy for `authenticated`.
--
-- WHAT WAS MEASURED, 4 Sep 2026, in rolled-back transactions on production:
--
--   as authenticated:
--     select attested_by, source_name, source_ref, notes
--       from public.policy_platform_attestation          -> EXECUTED (rows=0)
--     select attested_by_contact from ...                -> 42501
--     select * from ...                                  -> 42501
--     select * from public.policy_jurisdiction           -> EXECUTED (rows=6)
--
--   rows=0 is evidence about RLS and nothing else. The grant evidence is that
--   the ten-column statement PARSED AND EXECUTED where the eleventh column and
--   `select *` were refused 42501.
--
-- WHY policy_platform_attestation WAS INVISIBLE TO THE PRESCRIBED CHECK:
--   its relacl is `postgres=arwdDxtm/postgres , service_role=arwdDxtm/postgres`
--   - no `authenticated` entry at all. The access was ten `pg_attribute.attacl`
--   column grants. CLAUDE.md's prescribed ACL query reads relacl only, so it
--   reported the table as service_role-only while a signed-in dealership user
--   could read the attestor's NAME, the source they read, when they read it,
--   the confidence and the free-text notes.
--
-- THE DECISION, AND WHY IT IS A REVOKE RATHER THAN A SCOPED VIEW:
--
--   A scoped view was the obvious candidate - a dealership does have a
--   legitimate interest in knowing that a rule binding it was verified and
--   when, and no interest in who verified it or how to reach them. But that
--   interest is ALREADY SERVED, from a different object, by columns the
--   dashboard already reads:
--
--     v_policy_rule (security_invoker, authenticated=r) already carries
--     verification_status, verification_date, verified_by, source_name,
--     source_url, source_document, confidence - and `authority`,
--     `authority_reason` and `may_be_relied_on`, which is precisely
--     "explain this rule's authority".
--
--   So a new attestation view would be a SECOND derivation of a fact the
--   product already derives once. NEXUS_INVARIANTS.md's rule is one figure,
--   one derivation. The attestation row is the evidence FILE behind
--   v_policy_rule's answer - a named individual, their contact address, the
--   provider account that was inspected, free-text notes - and that is
--   vendor-side material. It goes back to service_role.
--
--   policy_jurisdiction is the harder call, because it IS shipped vocabulary:
--   six rows naming which body owns which policy namespace, byte-identical at
--   every dealership, nothing about any business. Its natural home is
--   QUALITY_GATE.mjs's L2_EXEMPT_TABLES, alongside policy_rule_type and
--   policy_unit. It is revoked here instead, for two reasons that are about
--   evidence rather than about the gate:
--
--     1. Measured, not assumed: `policy_jurisdiction` appears NOWHERE in
--        apps/executive-dashboard - not in screens/policy.js, not in lib/, and
--        not in the shipped dist/assets bundle. No view in public reads it
--        (checked through pg_depend/pg_rewrite). The only readers are
--        policy_propose_rule and policy_verify_rule, both SECURITY DEFINER
--        owned by postgres, which touch it as postgres and are unaffected by
--        what the caller holds; and the trigger
--        policy_rule_derive_jurisdiction_owner, which is SECURITY INVOKER but
--        can never fire as `authenticated` because authenticated holds only
--        SELECT on policy_rule (auth_insert = false, measured).
--        CLAUDE.md: if an object has no reader for a role, revoking costs
--        nothing.
--     2. The screen does not need it. The authority of a rule reaches the
--        Policy screen through v_policy_rule.authority / authority_reason,
--        and policy_rule.jurisdiction_owner_kind is denormalised onto each
--        rule by trigger. Reading the jurisdiction table directly would be a
--        second path to the same sentence.
--
--   If a future screen genuinely needs the vocabulary itself, the honest fix
--   is to add the table to L2_EXEMPT_TABLES BY NAME with a written reason and
--   restore this grant - not to leave it open now because it might be wanted
--   later. Neither table is added to any exemption map by this migration.
--
-- WHAT THIS DOES NOT CLAIM: nothing here changes what service_role may do, and
-- n8n writes as service_role.
-- ===========================================================================

-- --- policy_platform_attestation -------------------------------------------
-- Explicit column revoke first. A table-level REVOKE also clears column
-- privileges, but naming the ten columns makes the diff say what was actually
-- open, which relacl never did.
revoke select (
  attestation_id, rule_id, attested_by, attested_at, source_kind,
  source_name, source_ref, source_observed_on, confidence, notes
) on public.policy_platform_attestation from authenticated;

revoke all on public.policy_platform_attestation from authenticated, anon, public;

drop policy if exists policy_platform_attestation_authenticated_read
  on public.policy_platform_attestation;

-- --- policy_jurisdiction ---------------------------------------------------
revoke all on public.policy_jurisdiction from authenticated, anon, public;

drop policy if exists policy_jurisdiction_authenticated_read
  on public.policy_jurisdiction;

-- The RESTRICTIVE deny-anon policies and the service_role policies on both
-- tables are left exactly as they were.
