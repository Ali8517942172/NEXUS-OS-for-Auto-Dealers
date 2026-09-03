# J1 — Production readiness report

**Run:** 2026-09-03, 11:29–11:46 UTC.
**Question asked:** is NEXUS V1 production-proven, not merely implemented?

# VERDICT: `NOT_READY`

Not because something is broken. Because **the build that passes the quality gate
has never been deployed, and nobody has ever signed in and looked at it.** Three
different versions of NEXUS exist right now — a 14-screen build on production, a
15-screen build in an open pull request, and a 20-screen build that exists only
in one container's working tree — and the two newer ones share no commit with
each other. Alongside that, the public WhatsApp endpoint still accepts
unauthenticated requests, and the gate exits 1 on two live database checks.

Every "PASS" below rests on the deployed artefact, the published workflow, or a
live database read. Every claim that could only be made from source code is
marked as such and does not carry a verdict.

---

## Step 1 · Deployment reality

### What is actually serving customers

| Evidence | Value |
|---|---|
| Production URL | `https://nexus-os-dashboard-six.vercel.app` |
| Vercel project | `nexus-os-dashboard` (`ali8517942172's projects`, Hobby) |
| Production deployment built from | **“Merge pull request #4 from Ali8517942172/wip/domain-truth-2026-09-02”**, ~1 day old |
| Bundle actually served (read from the DOM) | `/assets/main-CC_KkxVO.js` |
| Bundle built from this container's HEAD | `dist/assets/main-Bf85vy-H.js` |
| **Nav entries on the live site** | **14** |

Live nav, read out of the running page while signed in as *Ali Asgher ·
senior_rep*:

> Overview · Leads · Conversations · Compliance ‖ Inventory · Competitors ‖
> Ask AI · Finance Desk · Customer 360 ‖ Campaigns · Deals · Automation · Team ‖
> Settings

There is **no “Revenue recovery” group at all**. Revenue Recovery, Lead Recovery,
Deal Rescue, Attribution, Policy, the Action Center and the Profit Sentinel are
**not reachable on the live site**. Navigating to `#revenue` directly resolves
back to `#overview` — the screen is not registered in the shipped bundle, so it
is not a routing accident.

The brief framed this as “20 if the new build is live, 15 if it is not”. The
real answer is neither: **it is 14**, and there are three worlds, not two.

### The three worlds

| World | Nav | Where it lives | Evidence |
|---|---|---|---|
| **Production** | **14** | merge of PR #4 on `main` | live DOM + Vercel deployment header + bundle hash `main-CC_KkxVO.js` |
| **PR #5** (open) | **15** | branch `wip/launch-day-2026-09-02` | `lib/nav.js` fetched raw from that branch: adds **Action Center**, nothing else |
| **This container** | **20** | local branch `wip/platform-truth-2026-09-01`, HEAD `415b426` | `lib/nav.js` + the gate's own R1 (`navItems=20`) |

- GitHub shows **1 open PR and 4 merged**. PR #5 is “Ready to merge”, 13 commits,
  +9,815 / −3,314 across 43 files, all checks passed, no conflicts with base.
- **None of PR #5's 13 commits exist in this container.** `git cat-file -t` on
  each of `8adceee 5eecec3 afd175a 47fa47a 55a5f22 aebb50c fc9cef7 6f1e7d2
  08b5d63 2eb6f39 1f12025 4fe58a1 cef1bf0` returns absent. The local branch is
  not an ancestor or a descendant of the PR branch; the two chains share no
  commit ids at all.
- The five Revenue-Recovery screens and the Action Center in this container all
  first appear in local commit **`8eb9cd7` “Four engines, five screens, and the
  AED 250,000 that was never real”**, which is on **no GitHub branch**.
- The local `origin/main` ref is **stale** and must not be used as evidence:
  this container has no GitHub credentials (`git fetch` → *could not read
  Username for 'https://github.com'*), and its top `origin/main` commit
  (`4e963bd`) predates the PR #4 merge that Vercel actually deployed. Every
  statement above about `main` comes from the browser and the live bundle, not
  from that ref.

**What this means commercially.** The work a buyer would be shown — the Profit
Sentinel, the Action Center, the recovery engines — is not on the product they
would log into. And the 20-screen version of it is not backed up anywhere: it
exists in one container's working tree and nowhere else.

---

## Step 2 · WhatsApp webhook — `POST /webhook/whatsapp-inbound`

Tested live against the **published** workflow `BiyHk9ZXxJUVGbf6`
(`versionId == activeVersionId == e09df9f0-c146-4b59-a19b-16545d3ac50d`), not
against the repo copy. Three probes, each chosen to die before any write.

| # | Probe | HTTP | Execution | What the saved execution shows |
|---|---|---|---|---|
| A | no `x-nexus-webhook-secret`, session `nexus-j1-audit-probe-…` | 200 `{"message":"Workflow was started"}` | 9322 | `_gate = {mode:"DORMANT", ok:false, header_present:false, enforcing:false}`; `Resolve Tenant` output `[]`; `lastNodeExecuted: "Resolve Tenant"` |
| B | forged secret `definitely-not-the-secret-j1` | 200 | 9323 | same shape |
| C | session `default`, `fromMe:true` | 200 | 9324 | `Resolve Tenant` → `tenant_id fff6a2b5-cfd5-4460-8383-875bc5826de0`, `tenant_source waha_session`, `waha_session default`; halted on the empty false branch of `Is Real Inbound?` |

No `leads`, `processed_messages`, `whatsapp_contacts`, `communication_logs` or
`audit_log` row was produced by any of the three, and no WhatsApp message was
sent. Probe C used a twelve-nines number and `fromMe:true` so it could not reach
the send node.

### Current state on the box

| Variable | State | How it was established |
|---|---|---|
| `WAHA_WEBHOOK_SECRET` | **unset or empty** | the gate reported `mode:"DORMANT"`, which is the only mode it emits when `EXPECTED` is falsy. Since 3 Sep the gate tags `_gate` in *every* state, so this is a positive signal, not the absence of one. |
| `WAHA_WEBHOOK_ENFORCE` | **not `true`** | implied by DORMANT; and were it true with no secret, the gate now returns `[]` (fail closed) rather than passing everything |
| session allowlist (`Resolve Tenant`) | **live and refusing** | unknown session → zero items, twice |
| `NEXUS_TENANT_MAP` | **not externally observable — do not claim it is unset** | the *effective* map resolves `default` → ALBA CARS and refuses everything else. That is identical whether the env var is absent (built-in fallback) or present with `default` as a key. Only the box can distinguish them. |
| `saveDataSuccessExecution` | **`"all"`** | fetched from the published settings. The trap CLAUDE.md warned about — enforcing blind because MONITOR executions were never saved — is closed. |

### Distance from the required end state

| Required | Today | |
|---|---|---|
| missing secret → reject | **accepted and processed past the gate** | ✗ |
| wrong secret → reject | **accepted and processed past the gate** | ✗ |
| unknown session → reject | refused at `Resolve Tenant`, zero items | ✓ |
| valid secret + valid session → process | untestable while the gate is dormant | — |
| a rejection does no business processing, chooses no tenant, sends no reply, writes nothing | proven on the session arm, three times today | ✓ |

**One of the two locks is live. The other is dormant and cannot be closed from
here** — it needs `WAHA_WEBHOOK_SECRET` in `/opt/nexus/.env`, the matching custom
header on WAHA session `default`, a MONITOR window, then `WAHA_WEBHOOK_ENFORCE=true`.
Hardcoding the secret in n8n first would drop every real customer message,
because WAHA is not sending the header yet.

Worth stating plainly: `whatsapp-inbound` is the **only** one of the eleven
endpoints that writes *nothing at all* when it refuses. The other ten write a
refusal row, which is write amplification an unauthenticated caller controls.

---

## Step 3 · n8n — every published POST webhook

Eleven business POST webhooks, all `active`, all with
`versionId == activeVersionId` (i.e. no unpublished draft in front of what I
read). Read from the published definitions, not the repo exports.

**The prior finding holds: not one of the eleven sets n8n's own
`authentication` parameter.** All eleven report `authentication: ABSENT`. Every
guard is downstream application logic, so the request is accepted and an
execution is started before anything refuses.

Re-verified live on `slack-command` (the one whose guard changed today):
unauthenticated POST → **HTTP 200** with the friendly ack body, and **execution
9325 started** and then failed at `Auth Gate`
(`lastNodeExecuted: "Auth Gate"`). A runner slot, CPU and an execution row are
spent before the refusal. On a 1-vCPU / 958 MB box with a history of CPU
starvation that is not cosmetic.

| Path | Workflow | n8n auth | Application guard chain | Tenant resolution | `service_role` write targets | Duplicate behaviour | Audit on refusal |
|---|---|---|---|---|---|---|---|
| `whatsapp-inbound` | WhatsApp BDC | ABSENT | `WAHA Auth Gate` (**dormant**) → `Resolve Tenant` (allowlist, live) | WAHA session → tenant, no fallback | `processed_messages`, `whatsapp_contacts`, `communication_logs`, `audit_log`, + `leads` via `Score New Lead` | `Claim Message Id` + `Prefer: resolution=ignore-duplicates` / `merge-duplicates` | **none — writes nothing when it refuses** |
| `nexus-inbound-lead` | Master Router | ABSENT | `Verify JWT` → `Auth Gate` → `Tenant For JWT User` | authenticated user via `tenant_members` | `leads` (`on_conflict=tenant_id,email`), `audit_log` | upsert on `(tenant_id,email)` | FAILED row |
| `slack-command` | Slack Command Center | ABSENT | `Verify JWT` → `Tenant For JWT User` (`alwaysOutputData` — fixed) → `Auth Gate` | authenticated user via `tenant_members` | `audit_log` | not established | FAILED row (gate throws → error workflow) |
| `ask-ai` | Ask-AI RAG | ABSENT | `Verify JWT` → `Auth OK?` → `Tenant For JWT User` | authenticated user via `tenant_members` | `audit_log`, `rpc/search_rag_documents` | not established | FAILED row — **but `saveDataSuccessExecution` is unset on this workflow, so the execution is not observable** |
| `finance-calc` | Finance Calc | ABSENT | `Verify JWT` → `Tenant For JWT User` → `Resolve Tenant` | authenticated user via `tenant_members` | `finance_quotes`, `audit_log` | not established | FAILED row |
| `audit-kyc` | KYC/AML Auditor | ABSENT | `Verify JWT` → `Auth Gate` → `Tenant For JWT User` | authenticated user via `tenant_members` | `kyc_documents`, `communication_logs`, `audit_log` | not established | FAILED row — **`saveDataSuccessExecution: "none"`, so successes are unobservable** |
| `lead-escalation` | Lead Escalation | ABSENT | `Verify JWT` → `Auth Gate` | from the fetched lead row | `leads` (scoped `email` + `tenant_id`), `audit_log` | not established | FAILED row |
| `lead-trigger` | 7-Day Warm Drip | ABSENT | `Verify JWT` → `Resolve Tenant` | authenticated user via `tenant_members` | `communication_logs`, `audit_log`, `rpc/nexus_comm_keys_for_lead` | not established | FAILED row |
| `erp-sync` | wf_108 ERP Sync | ABSENT | `Verify JWT` → `Auth Gate` → `Resolve Tenant` | `Resolve Tenant` | `leads` (scoped `email` + `tenant_id`) | not established | FAILED row |
| `deals/closed-won` | Closed-Won Sync | ABSENT | `Verify JWT` → `Tenant For JWT User` | authenticated user via `tenant_members` | `purchase_history`, `deals_embeddings`, `audit_log` | `Prefer: ignore-duplicates` / `merge-duplicates`; **proven 2 Sep — four submissions, one row** | FAILED row |
| `whatsapp-send` | WhatsApp Send | ABSENT | `Verify JWT` → `Auth OK?` → `Tenant For JWT User` | authenticated user via `tenant_members` | `communication_logs` | not established | responds `Unauthorized` |

Every one of these writes as `service_role`, which is `BYPASSRLS`. No RLS policy
filters anything n8n does; the tenant stamp in the workflow **is** the only
control.

### Two findings from this pass

1. **`slack-command` is now closed by design, not by accident.** Its
   `Tenant For JWT User` carries `alwaysOutputData: true`, so the chain reaches
   `Auth Gate`, which throws with an explicit refusal message. Execution 9325 is
   the evidence. Previously the chain halted before the gate and recorded
   SUCCESS with no audit row.
2. **A sole-tenant fallback survives in `whatsapp-send`.** Its `Prepare Send`
   node contains `if (!U.test(t) && k.length === 1) t = String(m[k[0]] || '');` —
   a signed-in user with no `tenant_members` row is given the only configured
   tenant. Harmless with one dealership. With two, `k.length` is 2, `t` becomes
   `''`, and the row falls to the column default, i.e. whichever tenant holds
   `is_unattributed_default`. **This is on the second-dealership checklist.**

---

## Step 4 · Quality gate

Run twice: offline lanes only, then with a live catalogue dumped from Supabase
at `2026-09-03T11:39:43Z` through the read-only SQL channel. Nothing suppressed.

```
PASS 26 · FAIL 2 · WARN 2 · NOT RUN 4 · exit 1
```

Offline lanes are clean: 20/20 screens render, 0 page errors, 129 PostgREST
calls and 0 rejected, no `AED 0` reaching any money screen, the fabricated
`recovered_value_aed` of 250,000 refused by the screen, disabled-and-explained
authorisation controls rendered rather than hidden.

Live lane passes L1, L3, L4, L5, L6, L7, L8, L10 — including the two grant
checks CLAUDE.md calls the shape that has opened a hole three times.

### L2 — FAIL. Investigated; **do not adopt the proposed replacement.**

L2 fails on 8 of the 13 `USING(true)` policies in `public`. The five it does not
fail on are exempted by the hand-typed regex `/reason_codes|workflow_registry/`,
which went stale the day the lead-recovery, deal-rescue, attribution and policy
engines shipped their vocabulary tables.

I measured whether the regex draws a distinction that exists in the database.
**It does not.** All thirteen tables are the same shape:

| Property | All 13, measured |
|---|---|
| `tenant_id` column | absent on all 13, including `workflow_registry` |
| policy command | `SELECT` on all 13 (never `FOR ALL`) |
| `anon` in the read policy's roles | absent on all 13; each also carries an explicit `*_deny_anon [ALL] qual=false` |
| table ACL for `authenticated` | `authenticated=r` on all 13 — **read only, no write letters** |

**The brief's precondition for adopting the property-based rule is therefore not
met.** The proposed property — SELECT-only, `anon` absent, no `tenant_id`
column, never `FOR ALL` — **does exempt `workflow_registry`**, and so does the
stricter five-clause form that adds “no write letters in the role grant”.
Proof, read live:

```
workflow_registry
  acl        : postgres=arwdDxtm/postgres | service_role=arwdDxtm/postgres | authenticated=r/postgres
  tenant_id  : absent
  policies   : workflow_registry_read      [SELECT] roles=authenticated qual=true
               workflow_registry_deny_anon [ALL]    roles=anon          qual=false
               workflow_registry_service_role_all [ALL] roles=service_role qual=true
```

Every clause is satisfied, so the rule would exempt it. I did **not** implement
the replacement, and I did not touch the check to make it pass.

What is actually true, commercially: none of the eight flagged tables holds
customer data — they are jurisdiction/vocabulary tables (`deal_rescue_states`,
`attribution_edge_type`, `policy_unit`, and so on), readable but not writable by
a signed-in user, and closed to `anon`. **L2 is a blocker to a green gate, not
evidence of a data leak.** The decision it is waiting on is the owner's: either
name the eight tables explicitly (honest, and stale again next engine), or
define “reference vocabulary” as a *property of the table* — a marker column, an
extension of the naming convention, or a registry — that `workflow_registry`
does not accidentally satisfy.

### L9 — FAIL, and the check was **fixed** because it was stating a falsehood

Before this pass L9 took the raw set difference between `audit_log.workflow` and
`workflow_registry` and printed, against every member of it:

> “…v_workflow_health cannot see it, so its runs are invisible to every health
> surface in the product.”

Measured live, that sentence was **false for one of the two names it was printed
against**. `Inventory Action Center` wrote 6 audit rows, and
`public.v_action_center_health` reports `audit_rows = 6`, `audit_rows_30d = 6`,
and `last_audit_at = 2026-09-02 18:25:20.42367+00`, the newest of them. Those
runs are on a different health surface *on purpose*, because they are human
decisions rather than an n8n execution.

`public.v_audit_unregistered_writers` already owns that judgement and states it
per writer in its `disposition` column:

| writer | rows | statuses | disposition |
|---|---|---|---|
| `Example Workflow` | 1 | FAILED | *Unrecognised writer. Register it from the box with its real n8n id, or establish it is not a NEXUS workflow. Do not invent a registry row.* |
| `Inventory Action Center` | 6 | REJECTED, SUCCESS | *Known and deliberate. Human decisions, not an n8n run – see v_action_center_health.* |

L9 now **reads that column** instead of computing a second, cruder opinion
beside it — CLAUDE.md's one-figure-one-derivation rule. The check did not get
weaker:

- a writer the database calls unrecognised still **FAILS**;
- a disposition the gate does not recognise **also fails**, so a future third
  category cannot pass by being unfamiliar;
- a catalogue dumped before the new key exists falls back to the raw list, which
  is the *stricter* of the two behaviours.

**L9 still FAILS**, on `Example Workflow` — one FAILED audit row written
2026-08-26 by something with no registry entry. That is a real open item and it
must be resolved from the box, by identifying the writer. **Do not invent a
registry row to clear it.**

Files changed: `apps/executive-dashboard/QUALITY_GATE.mjs` (catalogue SQL gains
`unregistered_writer_dispositions`; L9 rewritten) and the regenerated
`QUALITY_GATE_REPORT.md`. **Both are uncommitted in the working tree.**

### B1–B4 — NOT RUN, and they cannot be run against this database

Confirmed live rather than assumed:

- `public.tenants` — **1 row**: ALBA CARS, `is_unattributed_default = true`.
- `public.tenant_members` — **1 row**, role `owner`.
- `public.inventory_action_policy` — `approver_tenant_roles = {owner, admin, manager}`, `approver_staff_roles = {}`.
- `auth.users` — 1.

So the only signed-in identity that exists **is** an approver. There is no
non-approver to be refused (B1), no second dealership to be withheld (B3), and
the gate will not create either against production. B2 needs a real write; B4
needs a credentialed run against live data rather than the deterministic stub.

**These four are NOT RUN. They are not passes, and nothing in this report treats
them as passes.**

### Warnings carried, not cleared

- **L8b** — 7 ledger events share 6 audit rows. One `decide()` emits APPROVED and
  ASSIGNED and audits once. Defensible, but anything counting audit rows to
  count actions will be short.
- **S5b** — `screens/actions.js:637` coalesces a null `engine_impact_aed` to zero
  inside a total, so “no exposure” and “not computed” are indistinguishable in
  that one sum.

### Two things measured that the gate does not check

**The `authenticated` grant narrowing holds.** Re-run of the CLAUDE.md query,
widened to INSERT/UPDATE/DELETE/TRUNCATE, returns exactly two objects in
`public`:

```
inventory  authenticated=arwd    (the unit form — lib/unit-form.js)
leads      authenticated=rw      (owner assignment — lib/lead-drawer.js)
```

No `D` (TRUNCATE) anywhere, no `anon` write anywhere, `service_role` untouched.
`get_advisors(security)` returns **zero ERROR-level lints**; all findings are
WARN (two extensions in `public`, leaked-password protection off, and the
expected `authenticated`-executable SECURITY DEFINER RPCs, which L4 proved are
tenant-scoped). `action_write_audit` no longer carries `authenticated=X`.
`recompute_inventory_derived()` is now caller-scoped: an `authenticated` caller
recomputes only its own tenant, and returns 0 for a member of none.

**`nexus_tenancy_readiness()` contains a WARN whose text is wrong.** It reports
`policy_rule` and `policy_rule_event` as “NULLABLE `tenant_id` defaulting to
`nexus_default_tenant_id()`”, “invisible to every signed-in user”, and “a NULL
also silently defeats that uniqueness”. All three are false for these two tables:

- they have **no column default** at all;
- their RLS policy is `((tenant_id IS NULL) OR (tenant_id IN (nexus_current_tenant_ids())))` — a NULL is **deliberately visible**, which is how a jurisdiction-level rule is meant to work;
- uniqueness is covered by a **partial unique index**, `policy_rule_global_version_uq … WHERE (tenant_id IS NULL)`.

All 7 `policy_rule` rows and all 7 `policy_rule_event` rows carry
`tenant_id = NULL` and are global by design. This is a caption asserting the
opposite of its own code, in the live gate Ali is told to read — the exact class
CLAUDE.md says has been found seven times. It is a database function, and
Supabase is read-only from this session, so it is **reported, not fixed**.

---

## Step 5 · Production smoke test — **NOT RUN**

The precondition failed: the new build is not live. Walking Login → Overview →
Revenue Recovery → Inventory → Profit Sentinel → a vehicle → Action Center →
approve → execute → audit → retry is impossible on production, because six of
those screens do not exist in the bundle production serves.

I did not substitute a walk of the 14 live screens and call it a pass. For the
record, the live Overview rendered without error and reports honest emptiness
(1 open lead, pipeline “—” with the reason stated, 1 unit at risk with holding
cost shown as unavailable rather than as zero) — an observation, not a verdict,
and not evidence about anything in this release.

**The approve → execute → audit → retry → no-duplicate chain has never been
exercised by a human against the live database.** That is the single largest
untested surface in the release, and it is the one a buyer is shown first.

---

## Step 6 · Tenancy rehearsal plan (no second dealership was onboarded)

Nothing below was executed. Production still holds one tenant and one member.

### Why it cannot be rehearsed here

Four gate checks are NOT RUN for one structural reason: **the only identity that
exists is an approver in the only dealership that exists.** Creating a
non-approver, or a second dealership, is a write to the live customer's
database. That is not a test environment.

### Where it should run

A **staging Supabase project restored from a production snapshot**, plus a
staging n8n container. Not a branch of production, and not production with
synthetic rows added and deleted afterwards — several of the checks below leave
audit rows by design, and an audit trail that has been swept is not an audit
trail.

### Fixtures

| Fixture | Definition |
|---|---|
| Tenant A | restored ALBA CARS, `is_unattributed_default` **cleared** |
| Tenant B | a second dealership, its own inventory / leads / actions |
| Quarantine tenant Q | holds `is_unattributed_default`, no staff, never read by a screen |
| `a_owner` | member of A, role `owner` — approver |
| `a_rep` | member of A, role **not** in `approver_tenant_roles` — **the non-approver B1 needs and production does not have** |
| `b_owner` | member of B, role `owner` |
| `nomad` | authenticated, **no** `tenant_members` row |
| `NEXUS_TENANT_MAP` | `{"default":"<A>","<B session>":"<B>"}` — **`default` must stay a key**, or the live dealership goes offline |

### The matrix

| # | Actor | Action | Required outcome | Closes |
|---|---|---|---|---|
| 1 | `a_owner` | `action_decide()` on an A action | permitted; one state change, one audit row, one ledger event, all `tenant_id = A` | — |
| 2 | `a_rep` | `action_decide()` on an A action | refused **by Postgres** with `NOT_AN_APPROVER`; refusal audited; no state change | **B1** |
| 3 | `a_owner` | submit the same decision twice | second returns `idempotent = true`; **one** state change | **B2** |
| 4 | `a_owner` | read/act on a B action | denied — zero rows *and* the write refused | **B3** |
| 5 | `b_owner` | read/act on an A action | denied, symmetrically | **B3** |
| 6 | `a_owner` | forge `tenant_id = B` in a request body | denied; the tenant comes from `tenant_members`, never from the body | **B3** |
| 7 | `a_rep` | forge an approver role in the JWT | denied; authority read from `inventory_action_policy`, not from the claim | **B1** |
| 8 | `nomad` | any screen | “not attached to a dealership”, never an empty business | — |
| 9 | anon | every table, view and sequence | refused by **GRANT** (`42501`), verified on the ACL — not by a row count | — |
| 10 | POST `whatsapp-inbound`, B's session, valid secret | — | lands in **B**, never in A or Q | — |
| 11 | POST `whatsapp-inbound`, unknown session, valid secret | — | zero items, zero writes | — |
| 12 | `whatsapp-send` as `nomad` | — | **must not** inherit a tenant — this is the live sole-tenant fallback found in Step 3 | — |
| 13 | Customer 360 nightly batch, 2 tenants | — | must iterate tenants; today `nexus_scoped_tenant_id()` returns NULL for `service_role` at >1 tenant, so it syncs nobody **silently** | — |
| 14 | any write with `tenant_id` omitted | — | lands in **Q**, and is visible as unattributed | — |
| 15 | render | A's figures on A's screens | match the live A rows exactly | **B4** |

Rows 12, 13 and 14 are the ones that will actually fail. They are known,
located, and none of them is a code rewrite.

---

## Remaining blockers

Only these. Not wishes.

1. **The release is not on GitHub and not deployed.** Production serves a
   14-screen build. PR #5 is a 15-screen build on a commit chain that shares
   nothing with the 20-screen branch in this container, and the four
   Revenue-Recovery engines exist only in that container's working tree,
   unpushed and unbacked-up. Until these are reconciled into one branch, merged
   and deployed, **nothing in this release is in front of a customer and one
   machine failure loses it.**
2. **`POST /webhook/whatsapp-inbound` accepts unauthenticated requests.**
   `WAHA_WEBHOOK_SECRET` is unset; the gate is DORMANT. The session allowlist
   stops the damage today, but the door is open and the key has not been cut.
   Fixable only on the VM.
3. **The quality gate exits 1.** L9 fails on one genuinely unregistered
   `audit_log` writer (`Example Workflow`). L2 fails on eight vocabulary tables
   and is blocked on an owner decision, because the proposed property-based
   replacement is **proven** to exempt `workflow_registry` and therefore cannot
   be adopted as stated.
4. **Step 5 was never run.** The approve → execute → audit → retry → prove-no-
   duplicate chain has never been walked signed-in against live data, on any
   deployed build. Do not demonstrate it to a buyer before it has been.
5. **B1–B4 are NOT RUN and cannot be run against production.** One tenant, one
   member, and that member is an approver. Non-approver refusal, idempotency,
   cross-tenant denial and render-vs-live parity are all unproven.

Not blockers, but they must not be lost:

- `tenants.is_unattributed_default = true` on the live dealership — every omitted `tenant_id` lands in ALBA CARS.
- `whatsapp-send` grants the sole configured tenant to a member of none.
- All 11 endpoints start an execution before refusing; ten of them write a refusal row an unauthenticated caller can trigger.
- `ask-ai` and `audit-kyc` do not save successful executions, so their behaviour is unobservable in the execution list.
- `nexus_tenancy_readiness()` states three false things about `policy_rule` / `policy_rule_event`.
- L8b and S5b warnings above.

---

## The exact next action

**Commit the working tree, push the branch, and reconcile it with PR #5 — before
anything else.** In this order:

1. `git add -A && git commit` on `wip/platform-truth-2026-09-01` (currently
   `QUALITY_GATE.mjs`, `QUALITY_GATE_REPORT.md` and this file are uncommitted),
   then push it. The four engines exist in exactly one place today.
2. Decide, with the diff in front of you, whether PR #5 is superseded by that
   branch or must be merged first. They are two independent chains covering
   overlapping work; merging both blind will conflict or silently revert.
3. Merge to `main`, let Vercel deploy, and **confirm the live nav reads 20 and
   `#revenue` resolves** before believing it.
4. Then run Step 5 for real, signed in, on production.
5. Then Ali, on the VM: `WAHA_WEBHOOK_SECRET` → WAHA custom header → MONITOR
   until every real message shows `_gate.mode = "MONITOR", ok = true` →
   `WAHA_WEBHOOK_ENFORCE=true`. Send yourself one WhatsApp *first*, before
   changing anything, because the allowlist is already live.
6. Identify `Example Workflow` from the box and register it, or establish it is
   not a NEXUS workflow. Do not invent a registry row.
7. Put the L2 exemption decision in front of the owner. It is a definition
   question, not a bug.

---

## Rollback plan

| If | Roll back by | Cost |
|---|---|---|
| the new frontend is deployed and breaks a screen | Vercel → Deployments → the PR #4 merge deployment → **Promote to Production** | seconds; no rebuild, no git operation |
| a merge to `main` turns out wrong | `git revert -m 1 <merge sha>` and push; Vercel redeploys | one deploy cycle |
| `Resolve Tenant` refuses real customer messages (WAHA sends no `session`) | n8n editor → open `WhatsApp BDC AI Agent` → **disable the `Resolve Tenant` node** → save | ~10 s; a disabled node passes input straight through, restoring pre-patch behaviour |
| the auth gate drops real messages after the secret is set | n8n editor → **disable the `WAHA Auth Gate` node**, or unset `WAHA_WEBHOOK_SECRET` and restart | ~10 s in the editor; one restart on the box |
| `WAHA_WEBHOOK_ENFORCE=true` proves premature | remove the variable and `docker compose up -d n8n`; the gate returns to MONITOR | one restart |
| the L9 gate change is unwanted | `git checkout -- apps/executive-dashboard/QUALITY_GATE.mjs` | immediate; the change is confined to one file, is additive in SQL, and falls back to the previous behaviour on an old catalogue |
| the database needs to go back | Supabase point-in-time restore | **no migration was applied in this pass; nothing to undo** |

Nothing in this session altered production data. No workflow was published or
updated. The only writes reaching the database were the refusal audit row from
the `slack-command` security probe (execution 9325) and n8n's own execution
records; the three WhatsApp probes wrote nothing at all.

---

**Verdict: `NOT_READY`.**
