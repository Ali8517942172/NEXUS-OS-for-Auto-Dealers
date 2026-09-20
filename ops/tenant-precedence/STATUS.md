# Tenant-precedence wave — status

Rule being enforced everywhere: **authenticated/trusted tenant resolution always
overrides caller-supplied `body.tenant_id`. A caller may never choose another
dealership by submitting one.** Unresolved tenant fails closed.

| # | workflow | id | applied (20 Sep) | red-team (unit, 10 cases) | live smoke | status |
|---|---|---|---|---|---|---|
| 1 | Master Lead Router | `JnlZFAVmFAuNXVya` | YES + limit 1→2 | 10 PASS | NOT RUN | APPLIED, UNIT-TESTED |
| 2 | 7-Day Warm Lead Drip | `G7FhvMY2ucW5Fg7X` | YES (+Tenant For JWT User) | 10 PASS | NOT RUN | APPLIED, UNIT-TESTED |
| 3 | Finance Calc | `unMMpeL9uuPO79pp` | YES | 10 PASS | NOT RUN | APPLIED, UNIT-TESTED |
| 4 | KYC/AML Auditor | `qTnh3nwWheFJbFkU` | YES | 10 PASS | NOT RUN | APPLIED, UNIT-TESTED |
| 5 | Sync Closed-Won | `dhy2DDjWUqwuzHLW` | YES | 7 PASS, 3 N/A (no internal door exists) | NOT RUN | APPLIED, UNIT-TESTED |
| 6 | wf_108 ERP Sync | `bxNBzBrcOtcFpMPn` | YES (+Tenant For JWT User) | 9 PASS, 2 N/A, +backlog case PASS | NOT RUN | APPLIED, UNIT-TESTED |
| 7 | Lead Escalation | `KI6P1Qcf3MIZakNa` | YES (+Tenant For JWT User, +Resolve Tenant) | 10 PASS | NOT RUN | APPLIED, UNIT-TESTED |

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
