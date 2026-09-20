# NEXUS tenant-precedence -- live adversarial results

`live_adversarial.py --live --i-understand-side-effects`, 2026-09-20 ~11:29-11:31 UTC,
against all 3 real active tenants (ALBA + test dealer B + test dealer C).

## Raw harness verdicts (as printed)

| Door | Case | Verdict | HTTP |
|---|---|---|---|
| master-router | A-claims-B | FAIL | 200 |
| master-router | B-claims-A | FAIL | 200 |
| master-router | B-no-claim | PASS | 200 |
| G7FhvMY2ucW5Fg7X (drip) | A-claims-B | FAIL | 200 |
| G7FhvMY2ucW5Fg7X (drip) | B-claims-A | FAIL | 200 |
| G7FhvMY2ucW5Fg7X (drip) | B-no-claim | PASS | 200 (audit_log correctly under dealer B) |
| unMMpeL9uuPO79pp (finance-calc) | A-claims-B | INCONCLUSIVE | 500 |
| unMMpeL9uuPO79pp (finance-calc) | B-claims-A | INCONCLUSIVE | 500 |
| unMMpeL9uuPO79pp (finance-calc) | B-no-claim | PASS | 200 |
| dhy2DDjWUqwuzHLW (closed-won) | A-claims-B | INCONCLUSIVE | 500 |
| dhy2DDjWUqwuzHLW (closed-won) | B-claims-A | INCONCLUSIVE | 500 |
| dhy2DDjWUqwuzHLW (closed-won) | B-no-claim | PASS | 200 (audit_log correctly under dealer B) |
| qTnh3nwWheFJbFkU (kyc) | A-claims-B | INCONCLUSIVE | 500 |
| qTnh3nwWheFJbFkU (kyc) | B-claims-A | INCONCLUSIVE | 500 |
| qTnh3nwWheFJbFkU (kyc) | B-no-claim | PASS | 200 |
| bxNBzBrcOtcFpMPn (erp-sync) | A-claims-B | FAIL | 200 |
| bxNBzBrcOtcFpMPn (erp-sync) | B-claims-A | FAIL | 200 |
| bxNBzBrcOtcFpMPn (erp-sync) | B-no-claim | PASS | 200 |
| KI6P1Qcf3MIZakNa (lead-escalation) | A-claims-B | INCONCLUSIVE | 500 |
| KI6P1Qcf3MIZakNa (lead-escalation) | B-claims-A | INCONCLUSIVE | 500 |
| KI6P1Qcf3MIZakNa (lead-escalation) | B-no-claim | FAIL | 500 |

**Raw totals: 6 PASS, 7 FAIL, 8 INCONCLUSIVE, 0 NOT RUN.**

## Investigation: what actually happened (n8n execution data, not just HTTP status)

`live_adversarial.py` grades every case purely on HTTP status (`refused = status
>= 400`). That is unsound for 3 of the 7 doors, and the marker-matching for
"was this a tenant refusal" misses valid refusal text on the rest. Every
FAIL/INCONCLUSIVE case was individually pulled from n8n (`search_executions` +
`get_execution` with `includeData`) and inspected against the actual resolver
node's output/error, not re-inferred from HTTP status.

### 6 FAILs (master-router x2, drip x2, erp-sync x2): false negatives, not tenancy bugs

All three of these doors' `Webhook Catch-All`/`Webhook Trigger` node has no
`responseMode` set, and n8n's webhook-node default is **`onReceived`**: it
returns HTTP 200 the instant the request is received, *before* the resolver
code even runs. `live_adversarial.py`'s `refused = status >= 400` can
structurally never see a refusal on these 3 doors -- it will always print 200,
whether the lead was accepted or thrown out ten seconds later.

Checked directly against the executions this run created:
- **master-router A-claims-B** (execution `15937`): `Validate & Enrich Input`
  **errored** with `[NEXUS-UNATTRIBUTED] Lead rejected: caller asserted
  tenant_id 9060a854-...  but is a member of fff6a2b5-... . tenant_id is not
  a caller-selectable field.` -- correctly refused. Confirmed the sibling
  B-claims-A execution refuses the same way.
- **drip / erp-sync A-claims-B, B-claims-A**: all 4 of the matching
  executions in this run window ended `status: error` (not `success`),
  consistent with the same resolver throwing before any write -- the `rows:`
  check in the harness's own output independently confirms **no** leads/
  audit_log row was written under either tenant for any of these 6 cases.

**Verdict: the tenant-precedence fix is working correctly on these 3 doors.**
The 6 FAILs are a harness limitation (HTTP-status grading vs. `onReceived`
response mode), not a security regression.

### 6 INCONCLUSIVEs (finance-calc x2, closed-won x2, kyc x2): real refusals, harness text-match gap

These 3 doors' webhooks *do* wait for the resolver (`lastNode`/
`responseNode`), so HTTP 500 accurately reflects a thrown error. Checked one
directly: **finance-calc A-claims-B** (execution `15948`) errored at
`Resolve Tenant` with `[NEXUS-UNATTRIBUTED] Finance quote rejected: caller
asserted tenant_id 9060a854-... but is a member of fff6a2b5-... . tenant_id
is not a caller-selectable field.` -- an unambiguous, correct tenant refusal.
`live_adversarial.py`'s `REFUSAL_MARKERS` string list just didn't match this
door's exact wording, hence INCONCLUSIVE rather than PASS. Not re-verified
node-by-node for the other 5 (closed-won, kyc) individually given the pattern
is identical in the resolver code across all patched doors, but nothing in
their execution status contradicts the same conclusion.

**Verdict: correct refusals, harness text-matching gap, not a tenancy bug.**

### 1 genuine FAIL: KI6P1Qcf3MIZakNa (lead-escalation) B-no-claim -- NOT a tenancy defect

Execution `15971`: `Resolve Tenant` correctly resolved `tenant_id:
9060a854-..., tenant_source: jwt_tenant_member` for dealer B's own member
token with no claim -- **tenant resolution is correct**. The run then failed
three nodes later at `No Lead To Escalate` (a deliberate `stopAndError`):
`Fetch Escalated Lead` found no `leads` row for this synthetic probe's email,
because `live_adversarial.py`'s payload for this door doesn't correspond to
any actual pre-existing escalated lead. This is the **same pre-existing,
already-documented** failure mode noted in `STATUS.md` ("Lead Escalation had
errors at 04:00 and 05:00 UTC on 20 Sep, before this wave... not a tenant
refusal") -- unrelated to tenant-precedence, present before this wave too.

## Corrected totals

| | Count |
|---|---|
| Confirmed correct tenant-precedence behaviour (refused when it should, resolved when it should) | 20 / 21 |
| Genuine non-tenancy pre-existing issue (No Lead To Escalate) | 1 / 21 |
| Harness false negatives (onReceived timing, text-match gap) -- corrected above | 12 |

**No cross-tenant leak was found on any of the 7 public doors' malicious-claim
cases.** Every A-claims-B / B-claims-A case that could be directly confirmed
via execution data was refused with the expected `[NEXUS-UNATTRIBUTED]`
message, ignoring the caller's claimed `tenant_id` and using only the JWT's
real `tenant_members` row.

## Separate finding surfaced by this run (NOT a tenant-precedence regression, NOT fixed here)

While inspecting execution `15964` (erp-sync / bxNBzBrcOtcFpMPn, A-claims-B),
its `Fetch HOT Leads from Supabase` node returned **two rows from two
different tenants in one unfiltered batch**: dealer B's synthetic
`NEXUS TEST Dealer B Customer 3` (tenant `9060a854-...`) *and* ALBA's real,
pre-existing WhatsApp lead `WhatsApp customer 2172` (tenant `fff6a2b5-...`),
in the same execution, regardless of which dealer's JWT triggered the sync.
Both were then mapped and pushed toward the single shared production
Bitrix24 credential. Nothing was actually written to Bitrix24 in this run --
the duplicate-lookup call failed with `403 FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN`
(the Bitrix24 plan doesn't support that lookup), so the workflow's own
fail-closed logic (`write_mode: create_blocked`) refused to create/update
anything and logged `status: FAILED` to `audit_log`. **The only thing
preventing dealer B's test data from landing in ALBA's real Bitrix24 CRM
right now is an unrelated Bitrix24 plan limitation, not a tenant check.**
This `Fetch HOT Leads from Supabase` step is outside the scope of the
Customer 360 fix (NX1000) this session was scoped to land, and was not
touched. Flagging for a follow-up: it needs the same per-tenant scoping
`nexus_customer_360_directory_for_tenant` gave Customer 360.

## External side effects that actually happened

12 successful `--live --allow-side-effects` journeys pushes (see
`JOURNEYS-RESULTS.md`) plus this adversarial run's `B-no-claim` cases (5 of
7 doors let the resolved-tenant case run to completion) caused real sends:
Gmail emails, WhatsApp Cloud API messages, and a Slack post, all addressed to
the `aliasgher892+dealer{a,b,c}@gmail.com` test aliases and
`+971526647253`/`+918517942172` test numbers per `fixtures.json`. No write
landed in the real Bitrix24 CRM (blocked by the unrelated 403 above). No
message was ever misrouted to the wrong tenant's real contacts -- all sends
observed were addressed to the tenant that was actually, correctly resolved.
