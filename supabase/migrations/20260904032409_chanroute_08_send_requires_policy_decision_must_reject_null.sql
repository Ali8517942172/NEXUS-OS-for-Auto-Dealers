-- chanroute_08_send_requires_policy_decision_must_reject_null
--
-- Found by the rolled-back probe on staging, 4 Sep 2026, and it is the exact
-- defect this constraint existed to prevent.
--
-- As written in chanroute_03 the constraint was:
--     check (directive <> 'SEND'
--            or policy_decision = any (array['FREEFORM_ALLOWED','TEMPLATE_REQUIRED']))
--
-- With directive = 'SEND' and policy_decision = NULL that evaluates to
--     false OR NULL  ->  NULL
-- and a CHECK constraint accepts NULL. It only ever rejects FALSE. So a row
-- claiming a permitted send with NO policy decision on it inserted cleanly -
-- proven, not reasoned: the probe forged exactly that row and it was ACCEPTED.
--
-- "The router must not run before a policy decision exists" was therefore
-- enforced by the function alone, which is convention, not structure. The
-- three-valued logic silently removed the structural half.
--
-- The fix is the explicit NULL test: `policy_decision is not null` returns
-- FALSE (never NULL) for a null column, so the disjunction evaluates to FALSE
-- and the row is rejected.

alter table public.channel_send_directive
  drop constraint if exists csd_send_requires_policy_decision;

alter table public.channel_send_directive
  add constraint csd_send_requires_policy_decision
    check (directive <> 'SEND'
           or (policy_decision is not null
               and policy_decision = any (array['FREEFORM_ALLOWED','TEMPLATE_REQUIRED'])));

comment on constraint csd_send_requires_policy_decision on public.channel_send_directive is
  'A SEND directive cannot be recorded without a policy decision behind it. The "is not null" is load-bearing and must not be tidied away: a CHECK rejects only FALSE, so a comparison against a NULL column yields NULL and the row passes. That is how the first version of this constraint let a forged SEND through.';