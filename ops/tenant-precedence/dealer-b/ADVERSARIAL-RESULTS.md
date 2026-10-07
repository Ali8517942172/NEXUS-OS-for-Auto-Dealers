# NEXUS tenant-precedence -- live adversarial results

`live_adversarial.py --live --i-understand-side-effects`, 2026-09-20 ~11:29-11:31 UTC,
against all 3 real active tenants (Tenant A + test dealer B + test dealer C).

**This report has been rewritten by `live_adversarial.py --reverify ADVERSARIAL-RUN.json`.**
The harness itself has been fixed (see below) and every verdict below comes
from n8n EXECUTION data -- each case's own resolver-node output/error --
not from HTTP status or a fixed substring list, and it sends nothing new: the
21 executions this run originally created were re-fetched read-only (via
`../wf.py`'s GET-only `call()`) and re-judged. `ADVERSARIAL-RUN.json` records
which execution id backs each row so a future `--reverify` needs no
reconstruction at all.

## HARNESS FIX applied here

The old harness graded every case as `refused = HTTP status >= 400` and
matched refusal text against a fixed list. That was unsound two ways,
both now fixed in `live_adversarial.py` (logic lives in `exec_judge.py`,
shared with `journeys.py`):

1. **`onReceived` webhooks answer 200 before the resolver runs.** 3 of the
   7 doors (master-router, drip, erp-sync) have no `responseMode` set on
   their trigger node, so n8n's default (`onReceived`) fires the HTTP
   response the instant the request is received -- before the tenant
   resolver even executes. HTTP status on these doors is structurally
   incapable of distinguishing a refusal from an acceptance.
2. **Refusal wording isn't uniform across doors.** Each door's resolver
   throws its own door-specific message (`"Lead rejected"`,
   `"Finance quote rejected"`, `"Drip campaign aborted"`, ...), but every
   one of them was confirmed (by direct inspection of this run's own
   executions) to share one field: the thrown error's **`description`**
   always starts with `"[NEXUS-UNATTRIBUTED] "`. The harness now checks
   that field directly on the execution, not a hand-maintained substring
   list against the HTTP response body.

The harness now: POSTs as before, finds the execution that request created
(matched by the run marker inside the webhook trigger node's own captured
body -- present regardless of what happens downstream), polls it to a
terminal state (timeout 120s -> INCONCLUSIVE), and reads the verdict off
that execution's own node data. A "must refuse" case only PASSES if some
node's error `description` starts with `[NEXUS-UNATTRIBUTED] ` **and**
Supabase has no row for that case's marker under the forbidden tenant. A
"must resolve to X" case only PASSES if some node's output carries
`tenant_id: X` **and**, if a leads/audit_log row exists at all, it also
carries `X`.

## Results (from execution data, not HTTP status)

| Door | Case | Verdict | Previous harness said | Detail |
|---|---|---|---|---|
| master-router | A-claims-B | PASS | FAIL (HTTP 200) | execution 15937 refused at `Validate & Enrich Input`: `[NEXUS-UNATTRIBUTED] Lead rejected: caller asserted tenant_id 9060a854-... but is a member of fff6a2b5-... .` |
| master-router | B-claims-A | PASS | FAIL (HTTP 200) | execution 15939, same resolver, refused the mirror claim |
| master-router | B-no-claim | PASS | PASS (HTTP 200) | execution 15941 resolved tenant_id=9060a854-... correctly (execution then errored downstream at an unrelated OpenRouter free-tier rate limit -- not a tenancy issue, see note below) |
| G7FhvMY2ucW5Fg7X (drip) | A-claims-B | PASS | FAIL (HTTP 200) | execution 15942 refused at `Resolve Tenant`: `[NEXUS-UNATTRIBUTED] Drip campaign aborted: ...` |
| G7FhvMY2ucW5Fg7X (drip) | B-claims-A | PASS | FAIL (HTTP 200) | execution 15945, mirror claim, refused the same way |
| G7FhvMY2ucW5Fg7X (drip) | B-no-claim | PASS | PASS (HTTP 200) | execution 15947 resolved tenant_id=9060a854-... correctly; `audit_log` row confirmed under dealer B |
| unMMpeL9uuPO79pp (finance-calc) | A-claims-B | PASS | INCONCLUSIVE (HTTP 500) | execution 15948 refused at `Resolve Tenant`: `[NEXUS-UNATTRIBUTED] Finance quote rejected: ...` |
| unMMpeL9uuPO79pp (finance-calc) | B-claims-A | PASS | INCONCLUSIVE (HTTP 500) | execution 15950, mirror claim, refused the same way |
| unMMpeL9uuPO79pp (finance-calc) | B-no-claim | PASS | PASS (HTTP 200) | execution 15952 resolved tenant_id=9060a854-... correctly |
| dhy2DDjWUqwuzHLW (closed-won) | A-claims-B | PASS | INCONCLUSIVE (HTTP 500) | execution 15953 refused at `Format Deal Text`: `[NEXUS-UNATTRIBUTED] Closed-won sync aborted: ...` |
| dhy2DDjWUqwuzHLW (closed-won) | B-claims-A | PASS | INCONCLUSIVE (HTTP 500) | execution 15955, mirror claim, refused the same way |
| dhy2DDjWUqwuzHLW (closed-won) | B-no-claim | PASS | PASS (HTTP 200) | execution 15957 resolved tenant_id=9060a854-... correctly; `audit_log` row confirmed under dealer B |
| qTnh3nwWheFJbFkU (kyc) | A-claims-B | **INCONCLUSIVE** | INCONCLUSIVE (HTTP 500) | **no n8n execution exists at all** for this call, in this window or any other -- see "NEW FINDING" below |
| qTnh3nwWheFJbFkU (kyc) | B-claims-A | **INCONCLUSIVE** | INCONCLUSIVE (HTTP 500) | same -- no execution created |
| qTnh3nwWheFJbFkU (kyc) | B-no-claim | **INCONCLUSIVE** | PASS (HTTP 200) | same -- no execution created; the HTTP 200 the original harness saw was **not evidence the workflow ever ran** |
| bxNBzBrcOtcFpMPn (erp-sync) | A-claims-B | **FAIL** | FAIL (HTTP 200) | execution 15964: **no refusal was ever thrown -- ran to `status: success`**; see "REVISED FINDING" below (previous report's claim that this execution ended `status: error` does not match the execution data) |
| bxNBzBrcOtcFpMPn (erp-sync) | B-claims-A | **FAIL** | FAIL (HTTP 200) | execution 15965: same -- ran to `status: success`, never refused, resolver output ended up carrying the forbidden tenant_id (see below for why that's not quite what it sounds like) |
| bxNBzBrcOtcFpMPn (erp-sync) | B-no-claim | **FAIL** | PASS (HTTP 200) | execution 15966: resolved/output tenant_id is Tenant A's, not dealer B's -- see "REVISED FINDING" below |
| KI6P1Qcf3MIZakNa (lead-escalation) | A-claims-B | PASS | INCONCLUSIVE (HTTP 500) | execution 15967 refused at `Resolve Tenant`: `[NEXUS-UNATTRIBUTED] Escalation rejected: ...` |
| KI6P1Qcf3MIZakNa (lead-escalation) | B-claims-A | PASS | INCONCLUSIVE (HTTP 500) | execution 15969, mirror claim, refused the same way |
| KI6P1Qcf3MIZakNa (lead-escalation) | B-no-claim | **PASS** | FAIL (HTTP 500) | execution 15971: `Tenant For JWT User` correctly resolved tenant_id=9060a854-... (dealer B); the execution then failed 3 nodes later at a deliberate `No Lead To Escalate` stop (no pre-existing escalated lead matched the synthetic probe's email) -- a real, separate, pre-existing bug (see below), but **not a tenancy failure**, so this case now correctly PASSES the tenant-precedence check it's actually testing |

**New totals: 15 PASS, 3 FAIL, 3 INCONCLUSIVE, 0 NOT RUN** (vs. the original
harness's own count of 6 PASS, 7 FAIL, 8 INCONCLUSIVE).

## NEW FINDING: qTnh3nwWheFJbFkU (KYC/AML door) never creates an n8n execution

All three kyc cases are INCONCLUSIVE not because of an ambiguous refusal
message (as the original report guessed, without checking), but because
**no execution exists under this workflow id at all**, in the run's time
window or in the workflow's execution history checked more broadly. The
door answered HTTP 500 to all three calls, but n8n's own `/api/v1/executions`
list has zero rows for `qTnh3nwWheFJbFkU` in the entire 2026-09-20 09:00-11:31
UTC range this investigation covered. Whatever produced that HTTP 500 did so
before n8n ever created an execution record -- consistent with a failure at
the reverse-proxy/webhook-routing layer in front of n8n, not inside the
workflow. This needs follow-up with direct access to the n8n webhook logs;
it cannot be diagnosed further from execution data because there is none.
**The original report's assumption that kyc's pattern "is identical" to
finance-calc/closed-won (both of which DO have executions, and DID refuse
correctly) was not checked and turns out to be wrong for a different
reason than either of them.**

## REVISED FINDING: bxNBzBrcOtcFpMPn (erp-sync) does not gate on the caller's tenant claim at all

The original report treated erp-sync's two malicious-claim cases the same
as master-router/drip's (assumed refused, HTTP-onReceived hid it) and
called the door's behaviour correct. Execution data contradicts that:
executions `15964` (A-claims-B) and `15965` (B-claims-A) both ran to
**`status: success`** -- no `[NEXUS-UNATTRIBUTED]` refusal was ever thrown,
for either malicious claim.

Tracing execution `15964`'s node list end to end: `ErpSyncWebhook` ->
`Verify JWT` -> `Tenant For JWT User` (correctly resolves the caller's real
membership, Tenant A, from their JWT) -> `Auth Gate` -> **`Fetch HOT Leads from
Supabase`** -- with no resolver node in between that ever compares the
caller's real tenant against the body's claimed `tenant_id`. This door's
"Resolve Tenant" node (seen later in the chain) doesn't derive anything
from the caller's identity or claim at all -- `Fetch HOT Leads from
Supabase` pulls an already-queued, **unfiltered-by-tenant** batch of "HOT"
leads (this run's batch happened to contain both dealer B's own
`NEXUS TEST Dealer B Customer 3` and Tenant A's real, pre-existing
`WhatsApp customer 2172`, regardless of which dealer's JWT triggered the
call), and each item in that batch simply carries whatever `tenant_id` its
own row already had in Supabase. So:
  * The malicious `tenant_id` claim in the request body is neither honoured
    nor refused -- it's **ignored entirely**, because this door never reads
    it in the first place.
  * "resolved tenant_id" for this door, as read off the execution, is not a
    single per-request value the way it is on the other 6 doors -- it's
    whichever tenant's lead happened to be processed last in that batch
    (Tenant A's, in all three of this run's calls, since Tenant A's `WhatsApp
    customer 2172` row was the second item in every batch).

This is the **same pre-existing defect** already flagged in this file's
original run (the "Fetch HOT Leads from Supabase" cross-tenant read, noted
below as "not fixed here" and scoped outside NX1000) -- but confirmed now,
for the first time via real execution data rather than assumption, to mean
**erp-sync has no tenant-precedence gate on its own webhook at all**, not
merely an unrelated read-scoping gap downstream of a working gate. All three
cases are graded FAIL under the stated rule (no confirmed refusal for the
two malicious claims; the "must resolve to dealer B" case's own execution
output never carries dealer B's tenant_id either). Nothing was written to
the real Bitrix24 CRM in any of the three calls (blocked by the unrelated
Bitrix24 `403 FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN`, same as originally
found), so there is no confirmed cross-tenant *write*, but the gate itself
is confirmed absent on this door. **Recommend giving erp-sync's webhook the
same per-request tenant-claim resolver the other 6 doors have, and scoping
`Fetch HOT Leads from Supabase` to the caller's own tenant, together.**

## Confirmed correct: 15/21 cases, now backed by execution data instead of assumption

Every case above marked PASS was individually confirmed either by an error
whose `description` starts with `[NEXUS-UNATTRIBUTED] ` (the 12
malicious-claim refusals across master-router/drip/finance-calc/closed-won/
lead-escalation), or by a resolver node output carrying the expected
`tenant_id` (the 3 `B-no-claim` resolutions on those same doors, plus
master-router's own `B-no-claim`). `lead-escalation`'s `B-no-claim` case in
particular flips from the original report's FAIL to PASS here: its tenant
resolution was always correct (confirmed directly on execution `15971`'s
`Tenant For JWT User` output), and the failure 3 nodes later
(`No Lead To Escalate`, because no pre-existing lead matched the synthetic
probe's email) is a real, separate, already-documented issue (same one
`STATUS.md` flagged from 04:00/05:00 UTC that day) -- unrelated to tenant
precedence and not something this case is testing.

## External side effects that actually happened

Unchanged from the original run (this `--reverify` sent nothing new): 12
successful `journeys.py --live --allow-side-effects` pushes plus 5 of this
run's 7 `B-no-claim` cases let the resolved-tenant case run to completion,
causing real Gmail/WhatsApp/Slack sends, all addressed to the
`aliasgher892+dealer{a,b,c}@gmail.com` test aliases and
`+971526647253`/`+918517942172` test numbers per `fixtures.json`. No write
landed in the real Bitrix24 CRM (blocked by the unrelated 403 above, on all
three erp-sync calls, not just the one originally checked).

## Raw case -> execution-id mapping

Saved to `ADVERSARIAL-RUN.json` next to this script (reconstructed for this
run, since it predates `live_adversarial.py` saving this mapping
automatically -- see that file's `meta.note`; reconstruction here needed the
caller's claimed `tenant_id` as a disambiguator, since this harness's markers
are random per call and were never logged anywhere outside the executions
themselves, unlike `journeys.py`'s deterministic ones). A future `--live` run
will save this mapping itself, and a future `--reverify` of it will not need
to reconstruct anything.

## Re-run 20 Sep 2026 ~15:01 UTC: erp-sync PASSes 3/3 post-patch; kyc still INCONCLUSIVE x3 (root cause now confirmed, not a harness gap)

`live_adversarial.py --live --i-understand-side-effects --doors erp-sync,audit-kyc`
(new `--doors` filter), after landing `patched3/bxNBzBrcOtcFpMPn.json` (see
`STATUS.md`'s "NX1001 landed..." section for the full writeup) and fixing two
harness bugs this re-run exposed (`now_iso_floor`'s 5s clock-skew buffer, and
`find_resolved_tenant` walking into the raw request body -- both in
`exec_judge.py`/`live_adversarial.py`, neither in the workflows).

| door | case | verdict | execution | detail |
|---|---|---|---|---|
| erp-sync | A-claims-B | PASS | 16063 | resolved tenant_id=fff6a2b5... (dealer A's own real tenant; the claimed dealer-B id was never read) |
| erp-sync | B-claims-A | PASS | 16064 | resolved tenant_id=9060a854... (dealer B's own real tenant; the claimed Tenant A id was never read) |
| erp-sync | B-no-claim | PASS | 16066 | resolved tenant_id=9060a854... (dealer B's own real tenant) |
| kyc | A-claims-B | INCONCLUSIVE | none | HTTP 500; no execution exists for this workflow, ever (`saveDataErrorExecution`/`saveDataSuccessExecution` = `"none"` on the workflow itself) |
| kyc | B-claims-A | INCONCLUSIVE | none | HTTP 500; same cause |
| kyc | B-no-claim | INCONCLUSIVE | none | HTTP 200, body `{}` (a genuine successful run); same cause -- confirms the "no execution" symptom is independent of success/failure |

**Totals this re-run: 3 PASS, 3 INCONCLUSIVE (kyc, by permanent design, not a defect), 0 FAIL.**

erp-sync's 3 PASSes confirm the malicious `tenant_id` claim in the request
body is never honoured for this door -- not merely refused when caught, but
never read at all, in any of the three cases, regardless of which dealer
authenticated the call. Raw case -> execution mapping in
`ADVERSARIAL-RUN.json` (this run overwrote the previous reconstruction; the
previous run's own analysis above, including its "erp-sync has no gate at
all" finding, is what this patch and re-run fixed).

kyc's root cause (workflow settings disable execution persistence entirely,
confirmed via `GET /workflows/qTnh3nwWheFJbFkU` -- see STATUS.md) supersedes
this file's earlier "needs follow-up with direct webhook logs" note above:
no webhook/proxy log access was needed in the end, and the workflow was not
changed.
