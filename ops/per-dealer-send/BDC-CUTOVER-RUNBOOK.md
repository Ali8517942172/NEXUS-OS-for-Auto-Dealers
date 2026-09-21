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
   hard-codes ALBA's discount ceiling, opening band, make allowlist, and even a
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
preferred, WAHA session legacy-only for ALBA), it needs the same
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

## Cutover steps (execute only after separate sign-off — this task does not apply anything)

1. **Freeze**: confirm no in-flight execution is mid-conversation on
   `BiyHk9ZXxJUVGbf6` (`n8n executions list, status=running, workflowId=BiyHk9ZXxJUVGbf6`).
2. **Snapshot rollback point**: `python3 ops/tenant-precedence/wf.py fetch
   BiyHk9ZXxJUVGbf6 ops/per-dealer-send/rollback/bdc-live-before-cutover.json`
   (already-safe read-only op; keep this file — it is the rollback artifact).
3. **Close the Cloud-preference gap** in `LTBExI7QzFeANeFg` per the section
   above, re-verify (parses, no dangling connections, all 15+ Supabase calls
   still carry `tenant_id`/`p_tenant`), and re-fetch to confirm it is still the
   version on the box (no drift since 2026-08-30 export).
4. **Point the callers, not the box**: in `JnlZFAVmFAuNXVya` (Master Router),
   change the `workflowId` on both `WhatsApp BDC (WARM)` and
   `WhatsApp Outreach (HOT)` `executeWorkflow` nodes from `BiyHk9ZXxJUVGbf6` to
   `LTBExI7QzFeANeFg`. This is the actual cutover moment — one workflow, two
   node fields, reviewable as a two-line diff.
5. **Activate** `LTBExI7QzFeANeFg` (`active: true`) and **deactivate**
   `BiyHk9ZXxJUVGbf6` (`active: false`) in the same change window, so the old
   workflow cannot also fire from its own webhook trigger concurrently.
6. **Canary**: send one WAHA-session test message through the ALBA tenant only
   (the one dealership on WAHA today) and confirm: reply leaves from the
   session `channel_registry` names for ALBA's `tenant_id`, `Claim Message Id`
   writes with ALBA's `tenant_id`, and `communication_logs` rows carry it too.
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
