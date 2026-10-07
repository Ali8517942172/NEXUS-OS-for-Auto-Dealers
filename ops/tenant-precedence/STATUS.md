# Tenant-precedence wave — status

Rule being enforced everywhere: **authenticated/trusted tenant resolution always
overrides caller-supplied `body.tenant_id`. A caller may never choose another
dealership by submitting one.** Unresolved tenant fails closed.

| # | workflow | id | applied (20 Sep) | red-team (unit, 10 cases) | live smoke | status |
|---|---|---|---|---|---|---|
| 1 | Master Lead Router | `JnlZFAVmFAuNXVya` | YES + limit 1→2 | 10 PASS | NOT RUN (no execution since publish) | APPLIED, UNIT-TESTED |
| 2 | 7-Day Warm Lead Drip | `G7FhvMY2ucW5Fg7X` | YES (+Tenant For JWT User) | 10 PASS | NOT RUN | APPLIED, UNIT-TESTED |
| 3 | Finance Calc | `unMMpeL9uuPO79pp` | YES | 10 PASS | NOT RUN | APPLIED, UNIT-TESTED |
| 4 | KYC/AML Auditor | `qTnh3nwWheFJbFkU` | YES | 10 PASS | NOT RUN | APPLIED, UNIT-TESTED |
| 5 | Sync Closed-Won | `dhy2DDjWUqwuzHLW` | YES | 7 PASS, 3 N/A (no internal door exists) | NOT RUN | APPLIED, UNIT-TESTED |
| 6 | wf_108 ERP Sync | `bxNBzBrcOtcFpMPn` | YES (+Tenant For JWT User, +NX1001 Resolve Sweep Caller Tenant, 20 Sep) | 9 PASS, 2 N/A, +backlog case PASS | **live 20 Sep 15:0x UTC: 3/3 PASS** (A-claims-B, B-claims-A, B-no-claim all correctly resolved to the CALLER's own real tenant; malicious claim never adopted) | APPLIED, LIVE-VERIFIED |
| 7 | Lead Escalation | `KI6P1Qcf3MIZakNa` | YES (+Tenant For JWT User, +Resolve Tenant) | 10 PASS | **exec 15855 (09:00 UTC): Resolve Tenant ran, source `internal_caller`, no refusal** | APPLIED, UNIT-TESTED |

Every touched node independently re-verified against live with `wf.py verify`: 0 mismatches on all 7.
Red-team = `redteam.mjs` executing the real resolver code under stubbed n8n globals (A/B tenants,
claim mismatch both directions, 0 rows, 2 rows, internal door, sole tenant, 2-tenant map, replay).
Results: `REDTEAM-RESULTS.md`. **Unit-level, not a live two-tenant test** — production has one tenant.

`NOT RUN` is not `PASS`. No row above is `READY`.

## 1 — Master Router, applied 18 Sep 2026

Live verification (n8n public API, the active version, not a draft):
`active=true`, `Validate & Enrich Input` jsCode 5309 bytes, byte-identical to
`code/master-router.Validate-and-Enrich-Input.js`, which passed `node --check`.

What changed: `src.tenant_id` was read FIRST and the JWT membership row was only
a fallback. Now the caller's value is a *claim*, never a source.

- public webhook door (`Webhook Catch-All -> Verify JWT -> Tenant For JWT User
  -> Auth Gate -> here`): the only trusted answer is the `tenant_members` row
  behind the verified JWT. A claim that disagrees is refused. No row, or more
  than one row, refuses — **no fallback on this door.**
- internal hop (`Called Internally -> here`): detected by `Auth Gate` not having
  run in the execution. The sibling workflow already resolved the dealership.
- refusals carry `[NEXUS-UNATTRIBUTED]` at position 0, so the error handler files
  them under the quarantine tenant rather than a real dealership's audit trail.

**Blast-radius note, measured before the write:** the last 6 executions of this
workflow are all `mode: integrated` (sub-workflow calls). **Zero webhook
executions.** So tightening the webhook door to refuse rather than fall back
breaks no caller that exists today.

## Corrections to `ops/launch/N8N-TENANT-AUDIT.md` found while doing the work

- wf_108 (`bxNBzBrcOtcFpMPn`) — the audit says "read `Tenant For JWT User` (the
  node exists upstream of `Auth Gate`)". **It does not exist in that workflow.**
  Its node list is: Called by Master Router, Map Lead to Bitrix24 Lead, Log to
  Supabase audit_log, Find Existing Lead, Decide Update or Create, Already in
  Bitrix24?, Update Bitrix24 Lead, Create Bitrix24 Lead, Build Audit Row,
  ErpSyncWebhook, Verify JWT, Auth Gate, Delivery Report, Fetch HOT Leads from
  Supabase, Find Lead by Email, Safe to Create?, Fetch Existing Bitrix Lead,
  Build Update Payload, Update Has Payload?, Link Back to Supabase, Resolve
  Tenant. The fix there has to **add** the lookup node, not reorder a read.
- Lead Escalation (`KI6P1Qcf3MIZakNa`) — `Fetch Escalated Lead` is a
  `n8n-nodes-base.supabase` node, not a Code node; the fix is in its parameter
  expression.

## Open, not fixed by this wave

- `Tenant For JWT User` still queries `limit=1`, so a user who belongs to two
  dealerships returns one arbitrary row. The new resolver refuses on >1 row, but
  it can only see >1 if the query returns >1. Raising the limit to 2 was
  rejected by `update_workflow` (`cannot descend into non-object at
  '/queryParameters/parameters'`) and needs `updateNodeParameters` instead.
  **Latent, not closed.**
- `Verify JWT` carries the Supabase anon key as a hardcoded header value in
  several workflows. That key is publishable by design, so this is hygiene, not
  a leak — n8n's own validator flags it (`HARDCODED_CREDENTIALS`).

## Behaviour changes shipped with the wave (known, intended)

- Finance Calc public webhook: an unauthenticated caller used to get HTTP 200 with an error body; it now gets a 5xx (node throws, `responseMode: lastNode`).
- Finance Calc `Called as Tool` cannot pass `tenant_id` (the trigger schema filters it), so the internal door always lands on `sole_configured_tenant`. **Becomes an error at dealer #2** — needs `tenant_id` added to that trigger's schema.
- Every resolver now resolves or throws; none emits `tenant_id: null` any more.
- `limit=1 → 2` on every `Tenant For JWT User`, so the ">1 dealership → refuse" rule is reachable.
- `wf.py apply` (public API PUT) is unusable on these workflows: 400 `settings must NOT have additional properties` (`availableInMCP`, `binaryMode`). All writes went through `mcp__n8n__update_workflow`.

## Still open, outside this wave

- KYC sends on WAHA `session:'default'` and escalates to Slack `C0BKTLL1X54`; Lead Escalation emails one fixed mailbox. Single-tenant sinks.
- Lead Escalation had errors at 04:00 and 05:00 UTC on 20 Sep, **before** this wave. Cause not investigated yet.

## CORRECTION, 20 Sep 08:15 UTC — the wave was saved as drafts, not live

`mcp__n8n__update_workflow` writes a **draft** in n8n 2.x. The public API `GET /workflows/{id}`
returns that draft, so every "verified live" check above (including the 18 Sep Master Router
check) compared against the draft and passed. `versionId != activeVersionId` on all 7 —
**production kept running the old resolvers until 08:1x UTC 20 Sep.** Found by the post-apply
smoke: Lead Escalation execution 15838 (08:00) ran `Called by Master Router -> Fetch Escalated
Lead` with no `Resolve Tenant` node in its path.

Fixed: `publish_workflow` on all 7 with the reviewed versionIds; now `versionId == activeVersionId`
on every one. Any future "is it live" check must compare those two ids, not read the node.

Lead Escalation's failure itself (`No Lead To Escalate`, 15838 and pre-wave 15796/15785) is
**pre-existing and not a tenant refusal**: the lookup returns no row for the address it is handed.

## Live smoke, 20 Sep 09:07 UTC (after publish)

Only one wave workflow executed between publish (~08:15) and 09:07: Lead Escalation 15855.
`Resolve Tenant` is now in its path and resolved `internal_caller` from the Master Router hop,
no `[NEXUS-UNATTRIBUTED]` refusal. It still ended in `No Lead To Escalate` — the pre-existing
lookup miss, same as 04:00/05:00/08:00, unrelated to tenancy. The other six had no traffic in
the window: **NOT RUN, not PASS.**

## NX1001 landed + KYC root-caused + harness bugs found and fixed, 20 Sep 2026 ~14:30-15:10 UTC

### wf_108 ERP Sync: the "no gate at all" finding from the prior wave, fixed and live-verified

`patched3/bxNBzBrcOtcFpMPn.json` adds `Resolve Sweep Caller Tenant` (a Code
node between `Auth Gate` and `Fetch HOT Leads from Supabase`) and repoints
the fetch at a new Postgres function, `nexus_erp_bitrix24_hot_leads_backlog(p_tenant uuid)`
(migration `supabase/migrations/20260920140000_nx1001_the_erp_backlog_read_every_dealership.sql`,
already applied). The new node resolves the caller's OWN dealership from
`tenant_members` (refusing on 0 or >1 rows, same `[NEXUS-UNATTRIBUTED]`
contract as every other resolver) and passes it as `p_tenant`; the SQL
function's own fixed scoping is what actually limits which rows come back.
The request body's `tenant_id` is never read by this node at all -- not
honoured, not refused, simply irrelevant, because this door has no per-request
"target tenant" concept: it is a sweep, and "whose backlog" can only ever be
"the authenticated caller's own".

`python3 wf.py verify` confirmed only the two named nodes + connections
differed before applying; applied via `mcp__n8n__update_workflow` (never the
public API PUT, which `settings must NOT have additional properties` rejects
on this workflow same as the rest of the wave), then `publish_workflow` with
the returned versionId. `versionId == activeVersionId` confirmed
(`8d899812-0a28-42a8-a97b-1b0b7804778c` both), then `wf.py verify` again: 0
mismatches.

**Live re-run, 20 Sep ~15:01 UTC, all 3 cases PASS**: A-claims-B resolved to
dealer A's real tenant (Tenant A), B-claims-A resolved to dealer B's real tenant,
B-no-claim resolved to dealer B's real tenant -- in every case the claimed
`tenant_id` in the body was completely ignored and the caller's authenticated
identity won, which is a stronger guarantee than "refuse on mismatch" (the
claim can never influence the outcome, not merely "when caught"). See
"Harness bugs found while re-verifying this" below for why the FIRST two
live-run attempts today showed false FAILs on this same, already-correct
patch.

### KYC/AML Auditor (`qTnh3nwWheFJbFkU`): why 3 live calls made zero executions -- ROOT CAUSE FOUND, workflow NOT changed

Confirmed live via `GET /workflows/qTnh3nwWheFJbFkU`: this workflow's own
settings carry `saveDataErrorExecution: "none"` and
`saveDataSuccessExecution: "none"`. n8n therefore never persists an execution
record for this workflow AT ALL, regardless of whether a run succeeds or
errors. A fresh diagnostic call just now got HTTP 200 with body `{}` (a
genuine, successful run) and `GET /executions?workflowId=qTnh3nwWheFJbFkU`
still returned zero rows, before, during and after -- confirming this is a
permanent, by-design characteristic of the workflow's own settings, not a
transient fluke, not a webhook path/method/binary mismatch (`ReceiveDocument`'s
`path:"audit-kyc"`, `httpMethod:"POST"` match `live_adversarial.py`'s
`DOORS` entry exactly, workflow `active:true`, `versionId==activeVersionId`),
and not fixable from the harness side -- no request shape or wait time can
make n8n record what its own settings tell it never to keep. **The workflow
was not touched.** This also fully explains the original report's "HTTP 500,
zero executions" observation (the response code varies run to run; the
"zero executions" part never will, by design) and means every future KYC
adversarial run will keep reporting INCONCLUSIVE for all 3 cases -- correctly,
not as a bug.

### Harness bugs found while re-verifying erp-sync, and fixed (not the workflow)

Getting erp-sync's real post-patch verdict required finding and fixing two
separate, previously-undetected bugs in the shared execution-judging harness
(`exec_judge.py`, `live_adversarial.py`, `journeys.py`) -- both would have
produced silent false verdicts on ANY door, not just erp-sync, they just
hadn't been hit yet:

1. **Clock skew excluded a case's own execution from its own search, forever.**
   Measured directly (this machine's clock vs. the n8n host's own HTTP `Date`
   response header, back to back): this machine runs **~45-50s ahead** of the
   n8n host. `now_iso_floor()`'s old 5-second buffer was nowhere near enough:
   a case's just-created execution, timestamped by the (slower) n8n clock,
   could carry a `startedAt` that was already earlier than `since_iso`
   (computed from the faster local clock) the instant it was created.
   `list_recent_executions` scans newest-first and stops at the first row
   older than `since_iso` -- so the very execution being searched for was the
   first row it looked at, and got excluded before ever being added to the
   candidate list. Confirmed on execution 16032 (marker `b7a45bc6d5`): started
   at `14:49:59.394Z`, excluded by a since_iso of `14:50:40.591Z` computed
   under the 5s buffer -- polling never found it, at ANY timeout length,
   because `startedAt` does not change. **Fix:** widened the buffer to 180s in
   both `live_adversarial.py` and `journeys.py`'s `now_iso_floor()`. Safe to
   widen: `poll_for_case_execution` still filters every candidate by the
   request's own random/deterministic marker before accepting it, so a wider
   net costs a few more scanned rows, not a false match.
2. **`find_resolved_tenant` walked into the raw, untouched request body and
   mistook the caller's OWN malicious claim for a resolved value.** It
   recursed into every nested dict of every node's output looking for any
   `tenant_id` key. `Resolve Sweep Caller Tenant` (erp-sync's new node)
   passes the original item through unchanged apart from one *differently
   named* key (`_nexus_sweep_caller_tenant_id`) -- so the walk found
   `body.tenant_id` instead (the attacker's own claim, still sitting
   unchanged in the passthrough item) and reported it as "the resolver
   adopted the forbidden tenant_id", failing a case that had in fact
   correctly ignored that exact claim. **Fix:** `find_resolved_tenant` no
   longer descends into `headers`/`body`/`query`/`params` -- the raw
   webhook-trigger shape every door's item carries, never anywhere a
   resolver's own derived value lives. Re-checked against a known-good past
   execution from a DIFFERENT door (15855, lead-escalation) to confirm this
   doesn't weaken real detection: still correctly finds `Resolve Tenant` ->
   `fff6a2b5-...` there.
3. **Not a bug, but a needed refinement:** erp-sync's fix ignores the body's
   claim unconditionally (see above) rather than refusing on a mismatch, so
   the generic 3-case `CASE_SPECS` (written for the other 6 doors, which DO
   read and act on the claim) doesn't fit it -- grading A-claims-B/B-claims-A
   as "must throw `[NEXUS-UNATTRIBUTED]`" would fail a door that is behaving
   correctly by never looking at the claim at all. Added `CLAIM_IGNORING_DOORS`
   in `live_adversarial.py`: for `bxNBzBrcOtcFpMPn`, every case (regardless of
   what was claimed) is now graded as "must resolve to the CALLER's own real
   tenant" -- exactly `judge_resolve_case`, which is what actually happened.

### Dealer C journeys re-run, live, paced >=19s apart: same 3 fails, now PROVEN to be OpenRouter's exhausted DAILY free-tier quota, not pacing

`journeys.py --live --allow-side-effects --dealers c` (new `--dealers` filter,
new pacing helper mirroring the adversarial harness's) pushed all 4 dealer-C
customers (5 pushes incl. the c4 dedupe probe), each >=19s apart. Unlike the
original (unpaced) run, which only *guessed* rate-limiting from a generic
execution error, this run's failures carry the OpenRouter provider's own
error text directly: `"Rate limit exceeded: free-models-per-day. Add 10
credits to unlock 1000 free model requests per day"` (execution 16074's
`OpenRouter Chat Model` node) and the `Model Ladder` fallback code exhausting
its list of free models for the same reason (16069, 16072, 16077). This is a
**daily** quota, not a per-minute one -- no amount of intra-run pacing fixes
it, and it will recur on any further live run today. One push (c-c1) produced
no n8n execution at all despite an accepted webhook call -- the same class of
"accepted, but nothing recorded" symptom documented for KYC above, on a
DIFFERENT, otherwise-healthy workflow (master-router's other 4 dealer-C
pushes today, and its executions all day, save normally) -- most consistent
with an intermittent proxy-layer drop on this shared box, not yet reproducible
on demand or fully diagnosed.

Of the 4 executions found: 1 succeeded (16074, c-c4 first dedupe push, via the
`Groq Fallback` path) and correctly resolved `tenant_id =
d6c3bc16-83e0-4568-9547-07bd4468415c` (dealer C's own) with exactly 1
`leads` row written for its marker (the second, duplicate push correctly
produced no second row -- dedupe still works). Check 4 (JWT-scoped
PostgREST visibility), re-run fresh for dealer C only (read-only, no side
effects): PASS, 3 rows visible, all under dealer C's own tenant, none leaked.
Dealers A and B were not re-pushed (their full 22-PASS/3-genuine-external-fail
result from the prior run stands; see `JOURNEYS-RESULTS.md`).

**Net effect on the prior wave's dealer-C verdict:** unchanged in substance
(still not a tenant-precedence defect) but now backed by the AI provider's own
error message instead of an inference, and confirmed to be a *daily* ceiling
that pacing cannot work around -- further live retries today would hit the
same wall.

## NX1002 + model-ladder terminal rules tier — merged, applied, live-verified (20 Sep 2026)

**Merged two authored patches into `JnlZFAVmFAuNXVya`** (persist-first from
`patched4/JnlZFAVmFAuNXVya.json` + the terminal-rules-tier spec in
`patched4/model-ladder.md`), applied via `update_workflow` (never the public
PUT), published, verified 0 mismatches with `wf.py verify` after every change:

1. `Persist Lead (deterministic)` moved to run immediately after `Validate &
   Enrich Input`, before the model ladder, writing `scoring_state:'PENDING'`.
2. New `Update Lead Scoring (PATCH)` node (id `nx1002-update-scoring-01`)
   PATCHes the same row to `SCORED` once a decision exists.
3. New `Rule-Based Lead Scorer` code node (id `mr-rules-01`,
   `code/rule-based-scorer.js`, 10/10 `rule-scorer.test.mjs` PASS) wired off
   `Model Ladder`'s error output (index 1) → `Parse AI Decision`, which got a
   `score_source==='RULES'` short-circuit plus NX920 tagging
   (`AI_SCORE_CONFIRMED`/`AI_SCORE_FALLBACK`) on the AI path.
4. `Model Ladder.onError` → `continueErrorOutput` (was already set in the
   persist-first file; confirmed live).

**Two live bugs found and fixed post-merge, both from the persist-first
reorder, neither present in the original two source patches on their own —
only visible once combined and pushed through a real execution:**

- **Bug A:** `Persist Lead (deterministic)` uses `Prefer: return=minimal`
  (empty HTTP response body), so once it sits *before* `Model Ladder`,
  `Model Ladder`'s `prev.lead` was silently `undefined` on every tier —
  exec 16124/16127 both show `Model Ladder` outputting `attempt/maxTiers/
  orModel/groqModel` with no `lead` at all. Fixed: `Model Ladder` now reads
  `lead` from `$('Validate & Enrich Input')` directly (same named-node
  pattern `Parse AI Decision` already used), not from its own chained input.
- **Bug B:** `model-ladder.md`'s spec assumed n8n passes a Code node's own
  *input* item through on `onError:'continueErrorOutput'` when the node
  *throws*. Live evidence (exec 16124/16127) shows this is wrong for a throw:
  the error-output item is just `{ error: <message> }`, nothing else. This
  made `Rule-Based Lead Scorer`'s `prev.lead || prev` fallback score garbage
  (the error object itself) instead of the real lead. Fixed the same way:
  `Rule-Based Lead Scorer` now reads `lead` from `$('Validate & Enrich
  Input')` directly, with a try/catch fallback to the old behavior.
- **Bug C (design gap, not a regression):** `Update Lead Scoring (PATCH)`'s
  `jsonBody` never forwarded `ai_decision.score_source` — flagged as a
  deliberate deferral in `model-ladder.md` section 4.6, but it made the
  column permanently read the `AI_SCORE_UNKNOWN` default regardless of which
  tier actually scored the lead, defeating NX920's whole purpose. Fixed:
  `jsonBody` now always writes `score_source`, plus `rules_score` (RULES
  path) or `ai_score_raw`/`ai_intent_raw` (AI path).

**Live proof, dealer A's own token, `nexus-inbound-lead` webhook** (OpenRouter's
daily free-tier quota was exhausted the whole session — confirmed by the
provider's own `"Rate limit exceeded: free-models-per-day"` text on every
tier — so every push below exercised the RULES tier for real, for free):

- Lead id `151`, created `20:39:26Z`. Read back **3 seconds** after the POST
  (well before the ~9s scoring chain finished): row already existed,
  `scoring_state:'PENDING'`, `ai_score:null` — proves persist-first, the row
  is never lost to a scoring-provider outage.
- Same row re-read after scoring: `scoring_state:'SCORED'`,
  `score_source:'RULES'`, `ai_score:33`, `rules_score:33`,
  `status:'COLD'`, `scored_at:'20:39:35Z'`, `tenant_id:'fff6a2b5-...'`
  (dealer A's own — no leakage). Confirmed via `mcp__n8n__get_execution` on
  16127/16130-range executions: `Model Ladder` tiers 0/1/2 each carried the
  real lead (name/email/budget_aed/tenant_id) after the Bug-A fix; tier
  exhaustion still throws (by design, per `model-ladder.md` — the message is
  useful evidence) but now lands cleanly on `Rule-Based Lead Scorer` with the
  real lead after the Bug-B fix.

`patched4/JnlZFAVmFAuNXVya.json` in this repo is kept as a byte-for-byte
mirror of the live/published workflow (re-fetched and overwritten after each
fix); `python3 wf.py verify JnlZFAVmFAuNXVya patched4/JnlZFAVmFAuNXVya.json`
passes with 0 mismatches as of the last publish above.

## New workflow: hourly rescore sweep, created + activated (20 Sep 2026)

**`NEW: Rescore Pending Leads (Hourly)` — workflow id `dCRmzWHCz7bniIBr`**,
built from `patched4/NEW_rescore_pending_leads.json` (18 nodes: dealership
enumeration/batching → per-tenant pending-lead fetch/batching →
`Rescore Model Ladder` (same 3-tier table as the router, kept in sync by
hand) → `Route: Exhausted?` → `Rescore Scoring Agent` (OpenRouter primary +
Groq fallback, Supabase lead-lookup + purchase-history tools, memory) →
`Parse Rescore Decision` → `nexus_record_lead_scoring_result` RPC on success
or failure). Created inactive first via `create_workflow_from_code` (trigger
only, since the SDK requires generated code, not raw JSON) then built out
node-by-node via `update_workflow` for byte fidelity, verified with
`wf.py verify` (all 18 nodes + connections MATCH), then activated + published.
`active=true`, `versionId==activeVersionId` (`fd371add-...`).

One deliberate deviation from the source file: `Rescore Groq Fallback`'s
`ai_languageModel` connection was wired to index 1 (fallback slot) instead of
the source's index 0 — the source wired both `Rescore OpenRouter Chat Model`
and `Rescore Groq Fallback` to index 0, which would have silently disabled
the fallback slot on this `needsFallback:true` agent. Corrected to match the
already-verified, published sibling node in the Master Lead Router
(`OpenRouter Chat Model`=index0 / `Groq Fallback`=index1).

Hourly cron (`0 * * * *`, Asia/Dubai), `errorWorkflow: iYJkh1kztWxZXDbT`
(NEXUS Error Handler), `executionTimeout: 1800`. Not yet exercised live (no
PENDING backlog older than an hour existed at publish time) — the persist-first
test lead above proves the *router's* inline path; the sweep itself will get
its first real PENDING row only if a future lead exhausts the rescore
workflow's own ladder too, or is manually seeded.

## Settings-only: saveDataErrorExecution=all on KYC; BDC candidate left as-is

- `qTnh3nwWheFJbFkU` (KYC/AML Document Auditor): `setWorkflowSettings` →
  `saveDataErrorExecution:'all'`, published. `saveDataSuccessExecution`
  confirmed unchanged at `'none'` post-publish (KYC success-path execution
  data contains customers' ID documents — must never be stored).
- `LTBExI7QzFeANeFg` (`WhatsApp BDC — TENANT SCOPED CANDIDATE (do not
  activate)`): **left untouched, per coordinator instruction — inactive,
  not on any live path, not a blocker.** Both `saveDataErrorExecution` and
  `saveDataSuccessExecution` are still `'none'` on this workflow. It cannot
  be read or written by any `mcp__n8n__*` tool right now: `availableInMCP`
  is `false` on it (confirmed via `search_workflows`, and both
  `get_workflow_details` and `update_workflow` refuse it with "Workflow is
  not available in MCP. Enable MCP access from the workflow card in the
  workflows list, or from the workflow settings."). There is no MCP tool to
  flip that flag, and the public-API PUT is explicitly off-limits for this
  work. **Needs a human to toggle "Available in MCP" on this workflow's
  card/settings in the n8n UI** before its settings can be fixed or it can
  be activated.

## 21 Sep 2026 — execution visibility closed out

- **BDC candidate `LTBExI7QzFeANeFg`**: owner toggled "Available in MCP"; settings now `saveDataErrorExecution=all`, `saveDataSuccessExecution=all` (matches live BDC). Saved as a draft on purpose — **not published**, because publishing would activate a candidate marked "do not activate". The settings take effect the day it is published.
- **The "accepted but no execution" call (c-c1, 20 Sep 15:03 UTC) — settled.** Nothing was lost at a hop. n8n logs: `Enqueued execution 16068 (job 4792)` at 15:03:33.922Z, worker started at 15:03:33.930Z, then `Worker errored while running execution 16068` at 15:13:35.984Z. The row exists with status **canceled**, which the harness never queried. `executionTimeout=300`; n8n hard-kills at 2x (600 s), matching the 10-minute gap — a node blocked with no timeout of its own (most likely an LLM or HTTP call). Caddy runs under systemd with **no access log** configured, so the proxy hop cannot be shown directly; n8n enqueuing the job proves Caddy forwarded it. Stack is queue mode: n8n main + n8n-worker + n8n-db + redis.
- **Retention raised** in `/opt/nexus/docker-compose.yml` (lines 45-46; `.env` has no EXECUTIONS_ keys, `docker-compose.single.yml` is unused): `EXECUTIONS_DATA_MAX_AGE` 168 → **720 h (30 days)**, `EXECUTIONS_DATA_PRUNE_MAX_COUNT` 5000 → 50000, prune stays on. Backup `docker-compose.yml.bak.20260921T021204Z`. Before: 12 GB free of 29 GB, n8n DB 195 MB / 2087 executions. Only `n8n` recreated; `/healthz` 502 once during start, then 200. Worker untouched (main prunes).

### Still open
- The node that hung 16068 for 10 minutes has no timeout. Every LLM/HTTP node in the Master Router needs an explicit timeout so a hung provider falls through to the rules tier instead of burning the run.
- Caddy has no access log. Add a `log` block so the proxy hop is provable next time.
- The harness's execution finder ignores `canceled` status — add it.

## 21 Sep 2026 — Master Router `Parse AI Decision` provenance logic restored, live

CI job "Scoring provenance" (`ops/scoring/parse-ai-decision.test.js`, 18 cases)
was failing against the LIVE Master Router (`JnlZFAVmFAuNXVya`): its
`Parse AI Decision` node (3517 bytes) was an older draft that never got the
ADR-003/NX920 provenance rewrite — decoder babble could score a buying lead
0, an empty `{}` model response was indistinguishable from a genuine
WARM/50, partial JSON was trusted, fenced JSON wasn't recognised, and the
rules didn't decide even with `AUTHORITY='RULES'`. `origin/main`'s version
(5893 bytes) had the fix but was never deployed.

Fix: replaced the live node's code with main's version, re-adding the
`score_source === 'RULES'` short-circuit (pass the Rule-Based Lead Scorer's
already-finished decision straight through, unparsed) that the live workflow
had separately gained on 20 Sep. New jsCode is 6357 bytes. Verified locally
(18/18) on a patched copy of the export before touching the live workflow,
applied via `update_workflow` `setNodeParameter` `/jsCode`, published
(`versionId == activeVersionId == 8ea32b23-1ffb-4eea-892a-ab04a1bdb7ff`), then
re-exported with `scripts/export_workflows.py` and re-ran the test against
that fresh export — 18/18 again. Also ran
`ops/tenant-precedence/code/rule-scorer.test.mjs` — 10/10.

**Live proof (exec `16187`, lead id `152`, tenant `fff6a2b5-cfd5-4460-8383-875bc5826de0` = dealer A / Tenant A):**
pushed one NEXUS-TEST lead through the Master Router webhook as dealer A
(marker `NXTEST-496e60820198`, no `tenant_id` claim). The live free model
babbled its own system-prompt instructions back ("We need to return a raw
JSON object and nothing else...") instead of JSON — exactly the failure mode
ADR-003 exists for. `Parse AI Decision` correctly recorded
`ai_structured=false`, `parse_failed=true`, and (with `AUTHORITY='RULES'`)
`score_source='RULES'`, `score=75`/`HOT` from the deterministic scorer —
**not** the old bug's WARM/0 or a false-confident WARM/50. Supabase
confirms the persisted row: `scoring_state=SCORED`, `score_source=RULES`,
`status=HOT`, `ai_score=75`, `scored_at` set. This run's re-export
(`scripts/export_workflows.py`) is what's committed in `n8n-workflows/`
alongside this note; other files in that refresh reflect unrelated live
drift from other sessions' work, not this change.
