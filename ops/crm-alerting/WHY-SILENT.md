# Why Bitrix24 and Slack went silent

**13 September 2026.** Production `dsvuoovivysszdoiorch`, read-only. The live n8n
box was not contacted. Repo read at `wip/gate-L9-2026-09-03-continued`.

---

## Verdict, in one paragraph

**Neither integration "stopped on 6 September", and neither of them failed.**
The 6 Sep 15:02 rows that look like a last gasp are the tail of an
**unauthenticated probe sweep** that every workflow rejected at its `Auth Gate`;
they are not traffic. The last time either workflow did real work was
**19 August**. `wf_108` has not been invoked since because it is a HOT-only
sub-workflow and **no lead has been scored HOT since** — lead 126 (Sharri) was
`COLD`, `ai_score = 20`, so Master Router → Marketing Drip is the *correct*
fan-out for it. And `Slack Command Center` was never on the lead fan-out path at
all: the Slack leg of the HOT branch is a **different workflow**, `Lead
Escalation - AI Agent`, which is alive and ran as recently as 2026-09-12.

**Confidence: HIGH** on the two "why" claims below, **MEDIUM-HIGH** on the
overall picture, because the workflow topology comes from a repo export dated
30 August and the live box is the real source of truth (see §6).

---

## 1 · The 6 Sep timestamps are a probe sweep, not a run

Query (production, `audit_log`, window 14:00–16:30 on 2026-09-06) returns the
same nine workflows, in the same order, roughly four seconds apart, **four
times** — 14:19, 14:35, 14:45, 15:02 — under **two different `tenant_id`s**
(`fff6a2b5-…` and `02c86264-…`). Every row is `FAILED` or `REJECTED`, and every
one carries the same text:

```
unauthorized. A valid Supabase session token is required in the
Authorization header. … Failed at node: Auth Gate
```

The Slack row is explicit about what it is rejecting:
`"… (Slack itself cannot send one -- s…"`.

That is the signature of somebody POSTing unauthenticated at each public webhook
in turn and every fail-closed gate doing its job. It is **not** a lead being
routed. So:

> `audit_log.logged_at` max for these two workflows is **the last time they were
> probed**, not the last time they ran.

Anyone reading "last ran 2026-09-06 15:02" as "it worked six days ago and then
died" is reading a negative control as production traffic.

## 2 · When they actually last worked

Grouped by `workflow, status` over all of `audit_log`:

| workflow string in `audit_log` | status | n | last |
|---|---|---|---|
| `wf_108 ERP Sync - Bitrix24` | SUCCESS | 7 | **2026-08-19 11:04:08** |
| `wf_108 ERP Sync - Bitrix24` | FAILED | 1 | 2026-08-26 02:40:47 |
| `wf_108 ERP Sync - Bitrix24 CRM` | FAILED | 10 | 2026-09-06 15:02:34 *(probe)* |
| `Slack Command Center` | SUCCESS | 5 | **2026-08-19 11:21:37** |
| `Slack Command Center - AI Agent` | FAILED | 7 | 2026-09-06 15:02:53 *(probe)* |
| `Lead Escalation` | SUCCESS | 13 | **2026-09-12 04:05:07** |
| `Customer 360 Aggregation` | PARTIAL | 50 | 2026-09-12 22:00:27 |

Two things fall out. The real silence is **~25 days, not 6**. And the two
workflows write *two different strings* each (`… - Bitrix24` vs `… - Bitrix24
CRM`; `Slack Command Center` vs `… - AI Agent`) — the successes and the failures
are filed under different names, which is exactly the join hazard `MONITORING-GAP.md`
covers.

Note also: **Bitrix24 is not dark.** `Customer 360 - Data Aggregation (Bitrix24)`
has run 50 times in the last 30 days (all `PARTIAL`). Only the *lead push*
(`wf_108`) is quiet.

## 3 · Are they still wired? (repo-only — export dated 2026-08-30)

`n8n-workflows/_index.json` is a live export **taken 2026-08-30T18:01Z**.
Everything in this section is repo-only and could be stale.

**`wf_108 ERP Sync - Bitrix24 CRM` (`bxNBzBrcOtcFpMPn`)** has two entry points
(`n8n-workflows/wf_108_erp_sync_bitrix24_crm.json`):
- `Called by Master Router` — `executeWorkflowTrigger`, `inputSource: passthrough`
- `ErpSyncWebhook` — public `POST /webhook/erp-sync`, behind `Verify JWT` → `Auth Gate`

Its only caller anywhere in the repo is Master Router node **`ERP Sync (HOT)`**
(`nexus_master_lead_router_ai_agent.json`, `workflowId.value =
"bxNBzBrcOtcFpMPn"`). **The call site still exists.**

But it sits on one branch only. `Intent Switch` (fallback output renamed
`UNKNOWN`) fans out:

| output | rule | targets |
|---|---|---|
| 0 | `ai_decision.intent == "HOT"` | `Slack Router (HOT)`, **`ERP Sync (HOT)`**, `HOT: Already In A Live Chat?` |
| 1 | `== "WARM"` | `WARM: Already In A Live Chat?` |
| 2 | `== "COLD"` | `Marketing Drip (COLD)` |
| extra | fallback | `Slack: Unclassified Lead` |

**`ERP Sync (HOT)` is reachable only from a HOT verdict.**

**`Slack Command Center - AI Agent` (`VmnIXo7tM30zqawp`)** has exactly one
trigger: `SlackWebhook`, `POST /webhook/slack-command` — a Slack **slash
command**. There is no `executeWorkflowTrigger` in it and **no workflow in the
repo calls its id**. It was never part of lead fan-out. The node in Master Router
named `Slack Router (HOT)` points at `KI6P1Qcf3MIZakNa`, which `_index.json`
resolves to **`Lead Escalation - AI Agent`** — a different workflow, and one that
is running fine (13 successes, last 2026-09-12).

So the "same trigger used to fan out to Slack and Bitrix and no longer does"
premise does not survive contact with the wiring: the Slack half of the fan-out
was never this workflow.

## 4 · Did they fail, or were they never invoked?

**`wf_108`: NEVER INVOKED.** Three independent traces agree, and two of them are
outside `audit_log`, so this does not rest on "absence of a row":

1. `leads` holds six rows in total. Status distribution: `COLD` 2, `DISQUALIFIED`
   2, `WARM` 1, `new` 1. **There is no HOT lead on production at all.** The
   branch that calls `wf_108` cannot have been taken.
2. `leads.bitrix_lead_id` is **NULL on every row**, and `leads.crm_synced_at` is
   **NULL on every row**. `wf_108`'s terminal node `Link Back to Supabase`
   PATCHes those columns. No partial write exists anywhere — an invoked-and-died
   run would very likely have left one, and certainly would have left an n8n
   execution.
3. Lead 126 (Sharri, 2026-09-11 11:18:32, `source = nexus-master-router`) is
   `status = COLD`, `ai_score = 20`. Master Router + 7-Day Drip both ran for it.
   That is output 2 of `Intent Switch` behaving exactly as designed.

**`Slack Command Center`: NOT INVOKED AS PART OF ANY LEAD, and would fail-closed
if a human did invoke it.** It only runs when somebody types a slash command. And
per `ops/n8n-bundle-NOT-DEPLOYED/00-slack-command-claim-corrected-NO-CHANGE-NOT-DEPLOYED.md`
(which read the live published definition), `POST /webhook/slack-command` is
guarded by `Verify JWT` → `Auth Gate` requiring a **Supabase user JWT that Slack
cannot send**. Its single retained execution, `9325` (2026-09-03 11:34:45),
ended `error` at `Auth Gate`. The endpoint is **locked, not integrated** — by
design, and documented as such. Its five successes all predate the gate
(17–19 Aug).

## 5 · The 7 September tenancy hypothesis — tested, NOT SUPPORTED

Hypothesis: the 7 Sep ingestion/tenant-resolution work made the Slack/Bitrix call
sites fail closed. Evidence against:

- The 7 Sep migrations (`supabase/migrations/20260907023137_leadingest_01…` through
  `…20260907124500_leadingest_10…`) landed **after** the last real run of either
  workflow (19 Aug) and **after** the 6 Sep probe rows. They cannot have caused
  either.
- Tenant resolution on the lead path demonstrably works post-change: lead 126
  (11 Sep, four days after the migrations) carries
  `tenant_id = fff6a2b5-cfd5-4460-8383-875bc5826de0` and fanned out correctly.
- The 6 Sep rejections say *unauthenticated*, not *tenant unresolved*. The rows
  that do say `TENANT UNRESOLVED (unauthenticated)` are `Ask-AI RAG Query` and
  `Sync Closed-Won` — and they say it because the caller was anonymous.

One part of the hypothesis **is** true and matters: the auth-gate/JWT hardening
did make the *human-callable* `slack-command` webhook unusable from Slack. That
is a real closure, just not the cause of the lead-fan-out silence.

## 6 · What would settle the remaining doubt

The residual uncertainty is entirely "is the live box still shaped like the
30 August export?" **One look at the live n8n box settles it**: open Master
Router `JnlZFAVmFAuNXVya` at its **published** `activeVersionId` and confirm that
(a) `Intent Switch` output 0 still carries `ERP Sync (HOT)` → `bxNBzBrcOtcFpMPn`,
and (b) `bxNBzBrcOtcFpMPn`'s own `activeVersionId` is not `null`. If both hold,
this diagnosis is closed at HIGH confidence with no code change required.

If a box read is not available, one **read-only** production query gets most of
the way: `select id, name, status, ai_score, created_at from leads where status
ilike 'HOT'` — it currently returns **zero rows**, and it is the whole argument
in one line. The behavioural proof is §2 of `RESTORE-PLAN.md`: push one
deliberately HOT lead and watch whether `bitrix_lead_id` fills in.

> **UNKNOWN, stated plainly:** whether the *live* `wf_108` is published and
> healthy. `audit_log` cannot tell us — the workflow has not been asked to do
> anything since 19 August, so a broken one and a dormant one look identical
> from here. That is not a hedge; it is the precise shape of the gap.
