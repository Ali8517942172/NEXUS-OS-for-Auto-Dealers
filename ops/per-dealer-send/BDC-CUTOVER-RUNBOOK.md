# BDC cutover — LTBExI7QzFeANeFg replaces BiyHk9ZXxJUVGbf6

## Decision: CUT OVER. Do not patch the live BDC (BiyHk9ZXxJUVGbf6) node-by-node.

Reasoning, read against production and against `ops/tenant-scope-bdc/STATUS.md`:

1. The live BDC's `session: 'default'` is not an isolated bug. It is one of **nine**
   cross-tenant leaks in the same workflow (see STATUS.md table): `Fetch All Leads`
   pulls every dealership's leads to resolve one phone number; `search_inventory`
   exposes `cost_aed`/margins across tenants; `search_policy` has no tenant filter;
   eight `communication_logs`/`whatsapp_contacts`/`processed_messages`/`audit_log`
   calls file under `nexus_default_tenant_id()`; the idempotency key on
   `Claim Message Id` collides across dealers; and the agent's system prompt
   hard-codes Tenant A's discount ceiling, opening band, make allowlist, and even a
   real closed price (`AED 538,200`) into every dealership's negotiation.
   Patching only the WAHA send node leaves all eight other leaks live.
2. `LTBExI7QzFeANeFg` (`whatsapp_bdc_ai_agent.TENANT_SCOPED.json`) already fixes
   all nine, verified line-by-line against production schema by a prior agent
   (STATUS.md), and is **already imported into n8n today, inactive**
   (`active=false`, 54 nodes) — confirmed by re-fetching it live on 2026-09-21:
   its node set is byte-identical to the authored file in
   `ops/tenant-scope-bdc/whatsapp_bdc_ai_agent.TENANT_SCOPED.json`. There is no
   import step left to do; only activation.
3. Re-deriving those same nine fixes by hand-patching the live workflow would be
   slower and higher-risk than switching to a workflow that already has them and
   has been read-verified (RPC signatures, connection graph, node-name
   uniqueness) — just never executed.

## Gap the candidate still has, and what this task closes before cutover

`LTBExI7QzFeANeFg`'s `Resolve WAHA Send Channel` node resolves **only**
`whatsapp_waha_session` from `channel_registry` — it has no WhatsApp Cloud
preference. Per the binding decision (WhatsApp Cloud `phone_number_id`
preferred, WAHA session legacy-only for Tenant A), it needs the same
Fetch → Resolve(Cloud-preferred) → IF → {Reveal Cloud Token → Graph POST} /
{WAHA POST with dynamic session} pattern already built and validated in this
task for Drip, KYC and Dashboard Reply
(`ops/per-dealer-send/patched/drip.G7FhvMY2ucW5Fg7X.json`,
`kyc.qTnh3nwWheFJbFkU.json`, `dashreply.yx6m55p1Kj8V7koR.json`) — replacing
`Resolve WAHA Send Channel` + `Fetch WAHA Channel` + `Send Reply via WAHA HTTP
API` the same way. That node-level patch to the 54-node candidate is **not**
included in this pass (scope/time); it is the one prerequisite before Step 3
below. Until it lands, cutting over as-is still fixes 8 of the 9 leaks and
moves the 9th (shared WAHA number) from "every dealer, unconditionally" to
"WAHA-only dealers, with the number bound to `channel_registry` and refused —
not defaulted — when absent" (STATUS finding #7's "PARTLY" verdict), which is
still strictly safer than the live workflow today. Recommend closing the
Cloud-preference gap in the same pass as Step 3, not after.

## STATUS UPDATE (2026-09-21): the Cloud-preference gap above is CLOSED (not yet deployed)

The gap this runbook named above — `LTBExI7QzFeANeFg` resolving only `whatsapp_waha_session` and having no WhatsApp Cloud reply path — is closed by a separate, reviewable patch: `ops/bdc-cloud-send/patched/LTBExI7QzFeANeFg.json` (73 nodes, +19/-0/~4 vs the 54-node candidate this runbook describes) plus a one-node addition to the live Cloud inbound receiver, `ops/bdc-cloud-send/patched/J8MXprxVw1yhjBpp.json`. Full evidence, design rationale, and a deploy-order checklist are in the new section at the bottom of this file, **"WhatsApp Cloud reply patch"**. Neither patched file has been applied to n8n — this is still read-only analysis, same as everything else in this runbook. Step 3 below now reads as satisfied by that patch, pending its own deploy.

## Cutover steps (execute only after separate sign-off — this task does not apply anything)

1. **Freeze**: confirm no in-flight execution is mid-conversation on
   `BiyHk9ZXxJUVGbf6` (`n8n executions list, status=running, workflowId=BiyHk9ZXxJUVGbf6`).
2. **Snapshot rollback point**: `python3 ops/tenant-precedence/wf.py fetch
   BiyHk9ZXxJUVGbf6 ops/per-dealer-send/rollback/bdc-live-before-cutover.json`
   (already-safe read-only op; keep this file — it is the rollback artifact).
3. **Close the Cloud-preference gap** — DONE, not yet deployed. Apply
   `ops/bdc-cloud-send/patched/LTBExI7QzFeANeFg.json` (73 nodes) to
   `LTBExI7QzFeANeFg` AND `ops/bdc-cloud-send/patched/J8MXprxVw1yhjBpp.json`
   (12 nodes) to `J8MXprxVw1yhjBpp` in the **same change window** — the second
   file is what actually calls the first for a Cloud-origin message; deploying
   only the BDC side leaves Cloud replies unreachable, and deploying only the
   receiver side means Execute Workflow calls a target that behaves exactly as
   it does today (WAHA-only). Re-verify both with `wf.py verify` after applying
   (this task already ran it read-only against both live workflows — see the
   "WhatsApp Cloud reply patch" section below for the ADDED/CHANGED diff and
   the fact that every untouched node came back byte-identical).
4. **Point the callers, not the box**: in `JnlZFAVmFAuNXVya` (Master Router),
   change the `workflowId` on both `WhatsApp BDC (WARM)` and
   `WhatsApp Outreach (HOT)` `executeWorkflow` nodes from `BiyHk9ZXxJUVGbf6` to
   `LTBExI7QzFeANeFg`. This is the actual cutover moment — one workflow, two
   node fields, reviewable as a two-line diff.
5. **Activate** `LTBExI7QzFeANeFg` (`active: true`) and **deactivate**
   `BiyHk9ZXxJUVGbf6` (`active: false`) in the same change window, so the old
   workflow cannot also fire from its own webhook trigger concurrently.
6. **Canary**: send one WAHA-session test message through the Tenant A tenant only
   (the one dealership on WAHA today) and confirm: reply leaves from the
   session `channel_registry` names for Tenant A's `tenant_id`, `Claim Message Id`
   writes with Tenant A's `tenant_id`, and `communication_logs` rows carry it too.
7. **Watch window**: 24h on `channel_send_directive`/executions for
   `LTBExI7QzFeANeFg`, error rate vs. `BiyHk9ZXxJUVGbf6`'s trailing 7-day
   baseline.

## Rollback (single change, reversible in under a minute)

If step 6/7 shows a regression:
1. Re-activate `BiyHk9ZXxJUVGbf6`, re-deactivate `LTBExI7QzFeANeFg`.
2. Revert the two `workflowId` fields on the Master Router's `WhatsApp BDC
   (WARM)` / `WhatsApp Outreach (HOT)` nodes back to `BiyHk9ZXxJUVGbf6`
   (`ops/per-dealer-send/rollback/bdc-live-before-cutover.json` has the
   confirmed-good `workflowId` value and full node state to diff against).
3. No data migration is needed either direction: both workflows write to the
   same tables: `channel_send_directive`, `communication_logs`, `audit_log`,
   `kyc_documents` are all keyed by `tenant_id` + natural keys, not by which
   workflow wrote them.

## What this runbook does not authorize

No node in this task ran or was written to n8n. `LTBExI7QzFeANeFg` stays
`active=false` until someone runs Step 3 onward deliberately, outside this
session, with the same read-only `wf.py fetch`/hand-review discipline used
throughout `ops/tenant-scope-bdc/`.

---

## WhatsApp Cloud reply patch — evidence, deploy order, rollback (2026-09-21)

This section documents the patch that closes the Cloud-preference gap named
above. Both patched files were produced by re-fetching the live workflows
fresh (`wf.py fetch`) on 2026-09-21 and are pure additive diffs, verified
read-only against the live box with `wf.py verify` — **nothing was applied**.

### Design

- **Cloud inbound arrives via Execute Workflow, not a second webhook.** The
  live receiver `J8MXprxVw1yhjBpp` already does the one thing that must never
  be duplicated — verify Meta's HMAC signature over the raw body
  (`ops/n8n-whatsapp-cloud/verify-or-refuse.node.js`) — and already resolves
  the tenant from `channel_registry` and records the customer service window
  (`whatsapp_record_customer_message`). Today that receiver only logs; it
  never hands the message to anything that could reply. The patch adds one
  node, `Hand Off To BDC Agent (Cloud)`, that calls `LTBExI7QzFeANeFg` with
  Execute Workflow immediately after the window is recorded, in parallel with
  (not blocking) `Respond 200 Recorded` — `waitForSubWorkflow:false`, same
  fire-and-forget reasoning already used by this candidate's own
  `Score New Lead (Master Router)` node. The WAHA door is a webhook with no
  signature at all (`Verify WAHA Origin Or Refuse` checks a per-tenant shared
  secret header instead); the Cloud door is an `executeWorkflowTrigger`,
  reachable only from other workflows owned by the same n8n user
  (`callerPolicy: workflowsFromSameOwner`, added to `LTBExI7QzFeANeFg`'s
  settings by this patch — it was unset on the live box, so the trust
  boundary the code already narrated in a comment did not actually hold for
  *either* existing caller until now), plus its own shape validation
  (`Require Cloud Context From Receiver`, fail-closed on a missing/malformed
  tenant_id, integration_id, phone_number_id, customer_wa_id or message_id).
- **Tenant Context gets a third source, stays the one place the dealership is
  decided.** `Require Cloud Context From Receiver`'s output is tried after
  the WAHA-session and Master-Router sources, in the same try/catch-fallback
  shape already there. It still throws `BDC_TENANT_UNRESOLVED` if nothing
  resolves. It additionally stamps `inbound_channel`
  (`whatsapp_cloud`/`whatsapp_waha`) and, for Cloud, `cloud_phone_number_id`
  — the exact `phone_number_id` the message arrived on, carried through
  unchanged to the reply.
- **One extractor per channel, same output shape.** `Extract Cloud Message &
  Sender` produces the identical item shape `Extract Message & Sender`
  produces (`message`, `sender`, `sender_phone`, `is_document`, `is_voice`,
  `push_name`, `direction`, ...), selected by a new `Inbound Is Cloud?` IF
  node right after `Tenant Policy`. Every downstream node that consumes that
  shape (Reply Eligibility, Model Ladder, the AI agent, Log Incoming
  Message, Skip Duplicate Outreach, New Lead Worth Scoring?, ...) needed **no
  changes**. Two nodes named `Extract Message & Sender` by hardcoded
  reference (`Resolve Lead Identity`, `Resolve Lead Id (Tenant Scoped)`) got
  a three-line try/fallback to the Cloud extractor — without it, both throw
  "node did not run on this branch" for every Cloud message.
  Cloud media (image/audio/document) is explicitly **out of scope** for this
  pass: a non-text inbound gets a placeholder describing what NEXUS can't
  process yet (visible to the AI agent, not silently dropped) rather than a
  download/transcribe pipeline. WAHA keeps its existing image/voice handling
  unchanged.
- **Reply on the SAME channel the message arrived on**, not "Cloud
  preferred." A new `Reply Channel Is Cloud?` IF node, inserted right after
  `Guard Reply` (the AI output is already quality-gated), branches on
  `inbound_channel`. WAHA and outreach (Master-Router-triggered first
  contact) both fall through to the **existing, byte-for-byte unchanged**
  `Resolve WAHA Send Channel` → `Send Reply via WAHA HTTP API` path — this
  patch does not touch outreach's channel choice at all, which is a
  deliberate scope cut (outreach is business-initiated with no "channel it
  came in on" and has its own template-requirement question, out of scope
  here). Cloud gets a new path:
  1. `Check Cloud Service Window` calls `whatsapp_policy_decision` (the
     existing, deterministic, no-model-in-the-path SQL authority in
     `supabase/migrations/20260904024807_wapolicy_03_decision_function_writers_and_view.sql`)
     with `p_intent='SERVICE_REPLY'` — the 24h customer service window rule
     is read from there, never recomputed in n8n.
  2. `Cloud Window Open?` — anything other than `FREEFORM_ALLOWED`
     (`BLOCKED`, `TEMPLATE_REQUIRED`) refuses the send. Templates are
     explicitly out of scope for this pass, so `TEMPLATE_REQUIRED` is a
     refusal here, not a fallback to a template send.
  3. `Reveal Cloud Token (BDC)` calls `nexus_channel_secret_reveal` for
     **this tenant's own** `cloud_phone_number_id` — the same number the
     message arrived on — server-side, at run time.
  4. `POST Graph Messages (BDC Cloud)` sends to
     `graph.facebook.com/v21.0/{that same phone_number_id}/messages`.
     `neverError:true` + `fullResponse:true` (same pattern as the live
     `Channel Test Send` workflow's `POST Graph Test Message`), so a non-2xx
     or a 2xx with no `messages[0].id` is classified and logged, not thrown
     into the generic error workflow (which cannot attribute a tenant to an
     in-flight item — see `Log Failure to audit_log`'s own
     `TENANT UNRESOLVED` fallback note).
  5. On success, rejoins the **existing** `Log Conversation` → `Delivery
     Report` → `Audit Log` → `New Lead Worth Scoring?` chain unchanged, so a
     brand-new Cloud lead still gets scored exactly like a WAHA one.
  6. On any failure (window check errored, window closed, token reveal
     failed, send failed/rejected), a small Code node builds a
     `{status, summary}` pair and all four paths converge on one new
     `Audit Log (Cloud BDC Send)` node that writes `audit_log` **with
     `tenant_id`** — not left to the workflow-level error handler, which is
     the pattern the runbook's own `errhandler.json` documents it cannot do
     reliably (`TENANT UNRESOLVED: an error trigger reports which workflow
     failed, not whose customer it was`).
  `Delivery Report`'s hardcoded claim of `'Send Reply via WAHA HTTP API'`
  was also updated to pick the node that actually ran
  (`POST Graph Messages (BDC Cloud)` vs the WAHA node, `Claim Message Id
  (Cloud)` vs `Claim Message Id`) based on `inbound_channel` — without this
  fix every successful Cloud send would have been reported PARTIAL/FAILED.
- **Token handling.** The revealed secret (`Reveal Cloud Token (BDC)`'s
  `.secret` field) is referenced in exactly one place: the `Authorization`
  header expression of `POST Graph Messages (BDC Cloud)`. No Set/Code node
  in the patch copies it into anything that gets logged — `Log Conversation`
  logs `Guard Reply`'s `.output` (the reply text), `Audit Log (Cloud BDC
  Send)` logs the four Note-node summaries (window/reveal/send failure
  reasons, built from RPC/HTTP error objects and the Graph API's own
  response body, which never echoes back the Authorization header it was
  sent), and `Delivery Report` logs node names, not payloads.

### Nodes ADDED / CHANGED (per `wf.py verify`, read-only, against the live box on 2026-09-21)

`LTBExI7QzFeANeFg` — 54 live nodes → 73 patched. **50 nodes MATCH byte-for-byte**
(confirms nothing outside this diff moved). 19 ADDED:
`Called by Cloud Receiver`, `Require Cloud Context From Receiver`,
`Claim Message Id (Cloud)`, `Is New Cloud Message?`, `Inbound Is Cloud?`,
`Extract Cloud Message & Sender`, `Reply Channel Is Cloud?`,
`Check Cloud Service Window`, `Cloud Window Decision`, `Cloud Window Open?`,
`Reveal Cloud Token (BDC)`, `POST Graph Messages (BDC Cloud)`,
`Classify Cloud Send Result`, `Cloud Send Accepted?`,
`Note: Cloud Window Check Failed`, `Note: Cloud Window Closed`,
`Note: Cloud Token Reveal Failed`, `Note: Cloud Send Failed`,
`Audit Log (Cloud BDC Send)`. 4 CHANGED: `Tenant Context` (third source),
`Resolve Lead Identity` and `Resolve Lead Id (Tenant Scoped)` (Cloud-extractor
fallback), `Delivery Report` (channel-aware claim node). Plus `connections`
and `settings.callerPolicy` (added, was unset).

`J8MXprxVw1yhjBpp` — 11 live nodes → 12 patched. **All 11 existing nodes
MATCH byte-for-byte.** 1 ADDED: `Hand Off To BDC Agent (Cloud)`. Plus
`connections` (one new edge, parallel to the existing
`Open Or Extend Customer Service Window` → `Respond 200 Recorded` edge).

### Validation performed (this task, all read-only / offline)

- `wf.py verify` against both live workflows (above) — confirms the diff is
  exactly what this section claims and nothing else drifted.
- No dangling connections (every edge target exists as a node) in either
  patched file, checked programmatically.
- `node --check` on all 25 Code node bodies in the patched BDC workflow
  (async-wrapped, since n8n's Code node runtime allows top-level `await` and
  one pre-existing unrelated node — `Image To Base64` — uses it) — all pass.
- `ops/bdc-cloud-send/test_offline.js`: runs `Tenant Context`,
  `Require Cloud Context From Receiver`, and `Cloud Window Decision`'s real
  `jsCode` (extracted straight from the patched JSON, not reimplemented)
  under stubbed n8n globals (`$input`, `$`, `$env`) for the five required
  scenarios — WAHA Tenant A, Cloud Tenant A, Cloud unregistered (refuses,
  `BDC_CLOUD_CONTEXT_INCOMPLETE`), Cloud dealer B (resolves B independently
  of Tenant A, sends from B's own `phone_number_id`), and outside-24h
  (`TEMPLATE_REQUIRED` → `Cloud Window Open?` false → `Note: Cloud Window
  Closed` produces a `BLOCKED` audit row). 10/10 assertions pass.

### What is still blocking an actual Cloud send today (checked live, 2026-09-21)

`channel_registry` has exactly **one** active `whatsapp_cloud_phone_number_id`
row and it belongs to Tenant A (`external_identifier = 1306545252542419`,
`integration_id = 9129126e-da78-4340-a89d-ca703b9fc169`) — so this patch has
a real tenant to exercise, not only the synthetic "dealer B" in the offline
test. **But that channel has no `channel_secret` row** (`kind =
'meta_system_user_token'`) — confirmed with a direct read of
`channel_registry` joined to `channel_secret` for Tenant A's `tenant_id`. Until a
token is installed (via the onboarding flow behind `nexus_channel_register_cloud_number`
/ the `Channel Test Send` workflow), `Reveal Cloud Token (BDC)` will fail
every time with `nexus_channel_secret_reveal`'s own `NX930 NO_CREDENTIAL`,
and this patch's `Note: Cloud Token Reveal Failed` → `Audit Log (Cloud BDC
Send)` path is exactly what will record that. This is a real, separate,
pre-existing gap (credential onboarding), not something this patch could
close — it only makes the gap visible and logged instead of unreachable
code.

### Deploy order (when someone runs this deliberately, outside this session)

1. Confirm a token exists for Tenant A's Cloud channel (`channel_secret` row,
   `kind='meta_system_user_token'`) — or accept that Cloud replies will
   refuse-and-log until one does; either is a safe state to deploy into.
2. Apply `ops/bdc-cloud-send/patched/LTBExI7QzFeANeFg.json` to
   `LTBExI7QzFeANeFg` (still `active:false` — this only changes what the
   candidate *would* do once cut over, per this runbook's existing Decision
   section).
3. Apply `ops/bdc-cloud-send/patched/J8MXprxVw1yhjBpp.json` to
   `J8MXprxVw1yhjBpp` in the **same window** as step 2. This receiver is
   live and active today; from the moment this specific file is applied, its
   new node starts calling `LTBExI7QzFeANeFg` for every future Cloud
   delivery — harmless while the candidate is inactive-but-importable is
   irrelevant here, because Execute Workflow runs an inactive target anyway
   (inactive only means "has no independent trigger of its own"), so this
   step is the moment Cloud replies actually start attempting to go out. Do
   not apply this file on its own ahead of the rest of the cutover.
4. Re-run `wf.py verify` against both to confirm the applied state matches
   these patched files exactly.
5. Canary exactly as this runbook's existing Step 6 describes, but send the
   test message over WhatsApp Cloud to Tenant A's number instead of WAHA, and
   additionally confirm: `Reply Channel Is Cloud?` took the true branch
   (visible in the execution), the reply left from `1306545252542419` (not
   any WAHA session), and `audit_log` carries a `Cloud BDC Send` row either
   way (`SUCCESS` once a token exists, `FAILED`/`NX930 NO_CREDENTIAL` until
   it does).

### Rollback (additive-only, so this is simpler than the main rollback above)

Both patches are pure additions — no existing node, connection, or field was
removed, only new nodes/edges plus four in-place edits described above (all
reversible from `ops/bdc-cloud-send/live/*.json`, the pre-patch fetch this
task took on 2026-09-21). To roll back:

1. Re-apply `ops/bdc-cloud-send/live/J8MXprxVw1yhjBpp.json` to
   `J8MXprxVw1yhjBpp` — removes the one handoff node/edge, receiver goes back
   to log-only for Cloud inbound. Independently safe: rolling back only this
   file stops all new Cloud sends immediately (Execute Workflow is never
   called) while leaving `LTBExI7QzFeANeFg` however it was left.
2. Re-apply `ops/bdc-cloud-send/live/LTBExI7QzFeANeFg.json` to
   `LTBExI7QzFeANeFg` — returns the candidate to the exact 54-node,
   WAHA-only state this runbook's Decision section already describes and
   has verified.
3. No data migration either direction: `channel_send_directive`,
   `communication_logs`, `audit_log`, `processed_messages` are all keyed by
   `tenant_id` + natural keys, same as the main rollback section above notes
   for the WAHA-only cutover.
