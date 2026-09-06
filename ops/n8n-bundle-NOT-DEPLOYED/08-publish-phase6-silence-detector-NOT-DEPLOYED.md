# 08 — Publish **Phase 6 — 12-Hour Silence Detector** — write-up only, **DO NOT PERFORM**

**Traffic-affecting. Ali's, in order, with a rollback. I did not publish it.**

## The disagreement, measured today

| source | says |
|---|---|
| the box (`get_workflow_details B3TcpfzOMWj8oWgF`) | `active: false`, **`activeVersionId: null`** — never published |
| `public.workflow_registry` | `is_active = true`, `trigger_type = 'schedule'`, `trigger_detail = 'hourly'` |
| the dashboard | reads the **registry** |

The box's trigger is `Every Hour` (`scheduleTrigger`, `interval: [{field:"hours"}]`),
so the registry's `hourly` is at least accurate — unlike the probe's row (file 05).
`is_active = true` is not.

## Why it matters commercially

Lead Recovery depends on it. The silence state reads STALE for every lead since
26 August because nothing has computed it. `Find Silent Leads` is the only thing
that writes the `[SILENCE-ESCALATED]` marker, and production holds **zero** rows
with `direction = 'internal'` — consistent with a workflow that has never run.

## What publishing turns on — read the blast radius before you press it

Per hour, per run:

- `Fetch Open Leads` — all non-WON/LOST/DISQUALIFIED leads (production holds
  **3** `leads` rows today, so the first run is small).
- `Fetch Recent Comms` — all `communication_logs` from the last 40 days
  (**114** rows today).
- `Fetch WhatsApp Contacts` — all of `whatsapp_contacts`.
- `Find Silent Leads` — bounded at **`MAX_PER_RUN = 8`**, highest `ai_score` first.
- `Trigger Lead Escalation` → sub-workflow `KI6P1Qcf3MIZakNa` with
  `waitForSubWorkflow: true`. **This is the part that reaches a human**: the
  escalation agent posts to Slack. Run length is linear in the number of silent
  leads, and `executionTimeout` is 300 s.
- `Mark as Escalated` — writes one `communication_logs` row per escalated lead,
  `channel:'system'`, `direction:'internal'`, message `[SILENCE-ESCALATED] …`.

**The first run after publishing surfaces the whole backlog** — every lead that
has been silent since the workflow last could have run. `MAX_PER_RUN = 8` and the
`MAX_SILENCE_HOURS = 24*40` window bound it, and with 3 leads in the table today
the backlog is trivially small. **Re-check that count immediately before
publishing**; if `leads` has grown, expect up to 8 escalations an hour until it
drains.

## Preconditions

1. **Change 03 applied and verified.** `Find Silent Leads` reads
   `communication_logs` and decides who has "gone quiet" from `direction` and
   `created_at`. The duplicate-inbound rows that 03 closes do not change the
   verdict (a duplicate inbound still reads as "they replied"), but they do change
   the `matched_on` audit trail. More importantly: publishing this while
   `communication_logs` still accumulates duplicates means the first thing anyone
   investigating a wrong escalation will find is the duplicate, not the cause.
2. **Change 07 done and the channel proven healthy.** If the escalation path is
   ever extended to WhatsApp, an unarmed inbound webhook plus an active outbound
   escalator is the wrong combination. Today the escalation posts to Slack only —
   check that is still true in `KI6P1Qcf3MIZakNa` before publishing.
3. **A human is watching the Slack channel.** An escalation nobody reads is
   `audit_log` noise with a customer-shaped cost.

## The publish

n8n editor → `B3TcpfzOMWj8oWgF` → Publish. Fetch the published version back and
confirm `activeVersionId` is no longer `null`.

**Consider publishing it disabled first**, or publish and immediately watch the
first run via `Run Manually` before the hour turns. `saveDataSuccessExecution` is
`"all"` on this workflow, so the first run is fully inspectable.

## What breaks if applied out of order

- **Before 03:** you cannot cleanly attribute a wrong escalation.
- **Before 07:** the WhatsApp channel is still unauthenticated while a workflow
  that chases customers is running hourly. Nothing links them technically; the
  ordering is about not having two live changes on the customer-contact path at once.
- **Publishing it and 05 in the same window:** both add `audit_log` rows via the
  same error workflow (`iYJkh1kztWxZXDbT`). Separate them so a FAILED audit row
  has one possible author.

## Verify

See `VERIFY.md` §08.

## Roll back (under a minute)

n8n editor → Unpublish `B3TcpfzOMWj8oWgF`. The hourly trigger stops immediately.

**Rolling back does not un-send an escalation**, and it does not remove the
`[SILENCE-ESCALATED]` markers already written. If a run escalated the wrong leads,
delete those marker rows as `service_role` so the leads return to the safety net:

```sql
delete from public.communication_logs
 where direction = 'internal'
   and message like '[SILENCE-ESCALATED]%'
   and created_at >= '<the run you are undoing>';
```
