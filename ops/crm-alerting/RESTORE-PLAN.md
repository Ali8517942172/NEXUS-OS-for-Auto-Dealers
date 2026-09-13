# Restore plan — get a lead fanning out to Bitrix24 and Slack again

Read `WHY-SILENT.md` first. The short version that drives this plan:
**nothing is broken on the lead path.** `wf_108` is HOT-only and no lead has been
HOT; the Slack leg of the HOT branch is `Lead Escalation - AI Agent`, which is
running. So step 1 is not a fix — it is a **proof**, and it may well end the job.

Ordered. Do not skip to step 3.

---

## Step 1 — Prove the HOT branch (owner, 10 minutes, no code)

**Owner steps.**

1. Confirm the premise, read-only, on production:
   ```sql
   select id, name, status, ai_score, created_at from leads where status ilike 'HOT';
   -- expected today: 0 rows
   ```
2. Push **one** deliberately HOT lead through the Master Router webhook
   (`POST /webhook/nexus-inbound-lead`, with a valid Supabase user JWT — the
   `Auth Gate` requires one). Make it unambiguous: a named vehicle, a budget, and
   "I want to buy this week".
3. Then, again read-only:
   ```sql
   select id, name, status, ai_score, bitrix_lead_id, crm_synced_at
     from leads order by created_at desc limit 3;
   select logged_at, workflow, status, left(summary,120)
     from audit_log where logged_at > now() - interval '15 minutes' order by logged_at;
   ```

**Reading the result.**

| what you see | what it means | next |
|---|---|---|
| `status = HOT`, `bitrix_lead_id` filled, `wf_108…` row in `audit_log` | Nothing was ever broken. | Stop. Go to `MONITORING-GAP.md` — that is the real work. |
| `status = HOT` but no `wf_108` row and `bitrix_lead_id` still NULL | The call site is gone or the sub-workflow is unpublished on the live box. | Step 2. |
| `status` comes back COLD/WARM again | The scorer is the problem, not the plumbing. | Step 4. |

## Step 2 — Check the live box, not the repo (owner, 15 minutes, no code)

`n8n-workflows/` is an export dated **2026-08-30** and is not evidence about
today. Only if step 1 failed:

**Owner steps.**

1. Open Master Router `JnlZFAVmFAuNXVya` at its **published** version
   (`activeVersionId`, not the draft) and confirm `Intent Switch` output 0 still
   connects to `ERP Sync (HOT)` → `bxNBzBrcOtcFpMPn`.
2. Open `bxNBzBrcOtcFpMPn` and confirm `activeVersionId` is **not null**. An
   unpublished sub-workflow is invisible in exactly this way — precedent:
   `NEXUS Infra Health Probe 57QpbNQGwlFKb0q3` has `activeVersionId: null` while
   `workflow_registry` says `is_active = true`
   (`STATUS-2026-09-06.md:73`).
3. Confirm `BITRIX24_WEBHOOK_URL` is set in the box's environment — every Bitrix
   call in `wf_108` is `={{ $env.BITRIX24_WEBHOOK_URL }}crm.lead.*`. An unset var
   makes every call a malformed URL. **Do not print the value.**
4. Check the box's own execution list for `bxNBzBrcOtcFpMPn` since 19 August.
   This is the one place that distinguishes "never invoked" from "invoked and
   died before its audit node" — `audit_log` structurally cannot.

**Code steps:** none until step 2 returns an answer. Re-importing the stale
August export over a live workflow would destroy whatever the box currently has.

## Step 3 — Repair, scoped to what step 2 found (code)

Only the branch that step 2 identifies. In likelihood order:

- **Call site missing from the published Master Router** → re-add a single
  `executeWorkflow` node on `Intent Switch` output 0 pointing at
  `bxNBzBrcOtcFpMPn`, matching the export's `ERP Sync (HOT)` node. Publish.
  Re-run step 1.
- **`wf_108` unpublished** → publish it. No edit.
- **`BITRIX24_WEBHOOK_URL` unset/rotated** → owner sets it in the box env. No
  code change; nothing about the secret goes in the repo or in a report.

## Step 4 — If leads keep scoring COLD (product, not plumbing)

If real buying enquiries are being scored COLD, the fan-out is working and the
**scorer** is the defect. Two candidates, in order:

1. `Parse AI Decision` (`nexus_master_lead_router_ai_agent.json`) — its own
   comment records that an earlier version "silently fell back to COLD/0 on any
   parse failure, which made every single lead look cold". Verify against live
   runs that the current parser is not doing this again. A model-ladder fallback
   returning prose instead of JSON would reproduce the old symptom exactly.
2. The `AI Lead Scoring Agent` prompt thresholds. Lead 126 scored 20. With six
   leads total on production there is not enough signal to call this — collect
   more before touching the prompt.

**This step is a hypothesis, not a diagnosis.** Do not tune the prompt until
step 1 has been run at least twice with a lead you are certain is HOT.

## Step 5 — Slack: decide what `slack-command` is for (owner decision)

The HOT-lead Slack alert already works via `Lead Escalation - AI Agent`
(`KI6P1Qcf3MIZakNa`, 13 successes, last 2026-09-12). Nothing to restore there.

`Slack Command Center - AI Agent` (`VmnIXo7tM30zqawp`) is a **separate product**:
a `/nexus` slash command. It is deliberately fail-closed behind a Supabase user
JWT that **Slack cannot send**, so it can never succeed from Slack as built
(`ops/n8n-bundle-NOT-DEPLOYED/00-slack-command-claim-corrected-NO-CHANGE-NOT-DEPLOYED.md`).

The owner picks one, and the answer is a decision, not a bug fix:

- **(a) Leave it locked.** Correct today. Then stop counting it as a live
  integration anywhere — catalogue it `is_active = false` so it stops reading as
  a dead integration in health views. Cheapest, and honest.
- **(b) Make it real.** Replace the JWT gate with Slack's own auth — verify the
  `X-Slack-Signature` / `X-Slack-Request-Timestamp` HMAC against the signing
  secret, then map the Slack `user_id` to a NEXUS user and resolve the tenant
  from that. This is real work (signature verification node, a Slack-user →
  tenant mapping, and its own tests) and should be scoped separately, not
  smuggled into a restore.

Do **not** simply remove the `Auth Gate` to "make Slack work". That reopens the
last unauthenticated public webhook in the system.
