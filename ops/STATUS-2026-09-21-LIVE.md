# STATUS — 2026-09-21 LIVE production changes

Applied directly to the n8n instance (`https://35.224.126.225.nip.io`) and to Supabase
project `dsvuoovivysszdoiorch`, one workflow at a time, each verified with the read-only
`ops/tenant-precedence/wf.py verify` against the reviewed patch before and after publish.
`update_workflow` (n8n MCP) was used for every write — never the n8n public REST `PUT`.

## 1. Per-dealer send (NX1007, Cloud-preferred with WAHA fallback)

| Workflow | id | new active versionId | what changed |
|---|---|---|---|
| 7-Day Warm Lead Drip Campaign | `G7FhvMY2ucW5Fg7X` | `20f8f3dd-7ea7-4547-8b0a-9d1b4d28ac2f` | Added `Fetch/Resolve/IF Send Channel` chain ahead of the Day1 and Day5 WAHA sends. `WhatsApp: Welcome` / `WhatsApp: Check-in` now read session + API-key-env from `Resolve Send Channel (Day1/5)` instead of hardcoded `session:'default'` / `$env.WAHA_API_KEY`. |
| KYC/AML Document Auditor + Re-upload Loop | `qTnh3nwWheFJbFkU` | `0d0abe79-7262-4174-a488-124a0ba8f568` | Same pattern on the Approved and Reask branches. `WhatsApp: KYC Approved` / `WhatsApp: Request Re-upload` now channel-resolved per tenant. |
| WhatsApp Send (Dashboard Reply) | `yx6m55p1Kj8V7koR` | `ff885faf-2a52-4fb4-ae0d-cae08da86cb2` | Same pattern; `Send via WAHA` now channel-resolved per tenant. |

All three: new `Fetch Send Channel (*)` / `Reveal Cloud Token (*)` HTTP nodes carry the
`Supabase account` (`dv4OeARarErZLHCj`) credential explicitly (n8n's credential
auto-assignment skips new HTTP nodes; this was set with `setNodeCredential` and confirmed via
`get_workflow_details`). Verify diffs after publish show only those credential-bearing nodes
mismatching the source patch files (which ship without a `credentials` block) — everything
else, including all connections, matches byte-for-byte.

## 2. Master Router timeouts + retry (`JnlZFAVmFAuNXVya`)

New active versionId: `55376526-c688-47b7-be58-f365708fa13c`.

- `OpenRouter Chat Model` (the only LLM node in this workflow with a native `options.timeout`
  knob — `lmChatGroq` and the `agent` node have no such parameter in this n8n version):
  `options.timeout` → 45000ms (was default 360000ms).
- HTTP nodes capped at 15000ms: `Audit Log`, `Persist Lead (deterministic)`,
  `Update Lead Scoring (PATCH)` (`Verify JWT` and `Tenant For JWT User` were already ≤15000ms
  and left unchanged).
- `retryOnFail` (maxTries 3, wait 1500ms — matching `Audit Log`'s existing policy) added to
  `Persist Lead (deterministic)` (POST with `on_conflict=tenant_id,email` +
  `resolution=merge-duplicates`, a true upsert) and `Update Lead Scoring (PATCH)` (PATCH
  filtered by `tenant_id`+`email`, idempotent by natural key). Today's live persist-first /
  Rule-Based Lead Scorer / provenance changes on this workflow were read from the live nodes
  first and are untouched — this pass only touched the 4 nodes above.

## 3. Settings-only: `saveDataSuccessExecution: all`

| Workflow | id | new active versionId |
|---|---|---|
| NEXUS Error Handler | `iYJkh1kztWxZXDbT` | `3749646a-a723-4f80-bb16-7045456d3f27` |
| NEXUS Infra Health Probe | `57QpbNQGwlFKb0q3` | `065bab55-29f3-426d-8bb8-95cd88b7f8d1` |

No node changes; `setWorkflowSettings` only.

## 4. Competitors authenticated rescrape (`LphiGg4iqF1bn6El`)

New active versionId: `a9bbfa27-444e-49b0-922c-fae6a2a3511c`.

Added a `POST /webhook/competitors/rescrape` entry point (new webhook, its own `webhookId`
server-assigned on creation — the only diff vs. the source patch) with the full
auth → tenant-resolve → rate-limit chain: `Verify JWT` → `Tenant For JWT User` → `Auth OK?`
→ `Resolve Tenant` (refuses on 0 or >1 tenant memberships) → `Last Scrape For Tenant` →
`Within Cooldown?` (1/dealership/hour, keyed off that tenant's own `competitors.scraped_at`)
→ on pass, feeds into the *existing* `Fetch Local Inventory` entry point (same pipeline the
Schedule Trigger uses) and responds 202 immediately; on auth/rate-limit failure, responds
401/429 and audits the rejection. Confirmed live: unauthenticated
`POST /webhook/competitors/rescrape` → `401 {"error":"Unauthorized",...}`.

## 5. New workflows

| Workflow | id | active versionId |
|---|---|---|
| Channel Test Send (WhatsApp Cloud) | `cOJm2zNppMJlzD7y` | `a7e3fa80-0e59-48bd-b93c-1f801747e128` |
| NX996 · Notification Outbox Sender (Gmail, vendor pipeline) | `xSJRtSmIpoGLrM73` | `948019d5-5977-4932-92ed-31c84d7991d1` |

Both created inactive (`create_workflow_from_code` with the trigger only, then the full node
graph added via `update_workflow`), verified node-by-node and connection-by-connection
against the source `NEW.*.json` files, then published. Both verify clean except for
server-assigned `webhookId`/node `id` on the trigger nodes (cosmetic, not a functional diff)
— Channel Test Send's Supabase-credentialed nodes were credentialed manually (auto-assign
skips new HTTP nodes, same as section 1); NX996's credentials were embedded directly in the
`addNode` payload from the source file and confirmed present after apply.

## 6. Public privacy/terms pages

| Workflow | id | active versionId |
|---|---|---|
| NEXUS Public — Privacy | `vKTmNepP4fGaTAe8` | `195aa88b-3390-4331-a211-6f86f6db553e` |
| NEXUS Public — Terms | `Z0zFB6IKvARAzjpQ` | `ed52874f-8910-4bca-8e11-9b0d95c596c7` |

`Out` (respondToWebhook) node's `responseBody` replaced with
`n8n-workflows/nexus_public_privacy.html` / `nexus_public_terms.html` verbatim. Confirmed live:

```
curl https://35.224.126.225.nip.io/webhook/privacy  -> "last updated 21 September 2026"
curl https://35.224.126.225.nip.io/webhook/terms    -> "last updated 21 September 2026"
```

(Previous content was dated 24 August 2026.)

## 7. Edge function: `founder-invite`

Deployed to `dsvuoovivysszdoiorch` from `supabase/functions/founder-invite/index.ts`
verbatim. Was already present at version 1 (content byte-identical to the repo source, so
this pass's deploy is what put version 2 live) with `verify_jwt: true`; redeployed anyway
per instruction to guarantee the live copy matches the reviewed source exactly.

- Result: `status: ACTIVE`, `version: 2`, `verify_jwt: true`.
- Unauthenticated `POST /functions/v1/founder-invite` (no `Authorization` header) →
  `401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}` —
  confirmed NOT 200. This 401 is the Supabase gateway's own JWT-verification gate (fires
  before the function body runs); the function's own code additionally returns 401 for a
  present-but-invalid session token (`NX_INVITE_NO_SESSION` / `NX_INVITE_BAD_SESSION`), and
  403 for a valid session with no founder/owner authority.

## 8. BDC cutover — SKIPPED

Candidate `LTBExI7QzFeANeFg` (`whatsapp_bdc_ai_agent.TENANT_SCOPED.json`, 54 nodes,
confirmed live and unchanged from the authored file, `active: false`) was **not** cut over.

Per `ops/per-dealer-send/BDC-CUTOVER-RUNBOOK.md`'s own preflight, cutover Step 3 — closing
the candidate's WhatsApp-Cloud-preference gap (`Resolve WAHA Send Channel` needs the same
Fetch → Resolve(Cloud-preferred) → IF pattern this pass built for Drip/KYC/Dashboard Reply,
replacing the WAHA-only resolver) — is an explicit prerequisite the runbook states was **not**
done in the pass that authored the candidate, and the runbook's own closing section says
plainly: *"No node in this task ran or was written to n8n. `LTBExI7QzFeANeFg` stays
`active=false` until someone runs Step 3 onward deliberately."*

Re-verified live immediately before this pass (read-only `wf.py fetch`): the candidate is
still WAHA-only — no `Cloud`-named node exists among its 54 nodes, `Resolve WAHA Send
Channel` is unchanged. The preflight check fails, so per instruction this step was skipped
rather than proceeding on a runbook whose own stated prerequisite is open. Nothing was
frozen, snapshotted, repointed, activated or deactivated for the BDC workflows; live
`BiyHk9ZXxJUVGbf6` continues to serve WhatsApp BDC/Outreach traffic from the Master Router
unchanged, exactly as it did before this session.

**What would unblock this**: close the Cloud-preference gap in `LTBExI7QzFeANeFg` (same
pattern as section 1 above, applied to `Resolve WAHA Send Channel` / `Fetch WAHA Channel` /
`Send Reply via WAHA HTTP API`), re-verify all 15+ Supabase calls still carry
`tenant_id`/`p_tenant`, re-confirm no drift since 2026-08-30, and only then run the runbook's
Steps 4–7 (repoint Master Router's two `executeWorkflow` nodes, activate/deactivate in the
same window, canary on the ALBA WAHA tenant, 24h watch window).

## Verification method

Every workflow write in sections 1–6 followed: `wf.py verify` (read-only GET, node-by-node
diff) before the change → `update_workflow` operations (node-level `addNode`/
`setNodeParameter`/`setNodeSettings`/`setNodeCredential`/`addConnection`/`removeConnection`/
`setWorkflowSettings` — never a raw PUT) → `publish_workflow` → `get_workflow_details` /
`wf.py fetch` to confirm `versionId == activeVersionId` and the new active version's node
count → `wf.py verify` again to confirm every touched node matches the reviewed source
(mismatches were checked individually and are all either server-assigned ids/webhookIds or
credential blocks the source files ship without).
