# 05 — Publish **NEXUS Infra Health Probe** — write-up only, **DO NOT PERFORM**

**This is a traffic-affecting change and it belongs to Ali, in order, with a
rollback. I did not publish it. I hold read-only on the box by instruction, and
publishing is a write.** Everything below is the runbook, not a report of work done.

## The disagreement, measured today

| source | says |
|---|---|
| the box (`get_workflow_details 57QpbNQGwlFKb0q3`) | `active: false`, **`activeVersionId: null`** — it has *never* been published |
| `public.workflow_registry` | `is_active = true`, `trigger_type = 'webhook'`, `trigger_detail = 'GET /webhook/infra-probe'` |
| the dashboard | reads the **registry** |

So the Automation screen tells the dealership its WhatsApp channel is monitored,
and **nothing is watching the WhatsApp channel.** That is the defect: not the
unpublished workflow on its own, but the unpublished workflow plus a registry row
asserting the opposite.

`workflow_registry` also mis-describes it: the box shows `triggerCount: 2` — a
`Probe Webhook` (GET, `path: infra-probe`, `responseMode: responseNode`) **and**
a schedule trigger `Every 15 Minutes` (`minutesInterval: 15`). The registry row
names only the webhook. The schedule is the part that matters: it is what gives
the probe a caller.

## What publishing turns on

Read from the live definition:

- `Every 15 Minutes` → `WAHA Sessions` → `GET http://waha:3000/api/sessions/default`
  with `X-Api-Key: {{ $env.WAHA_API_KEY }}`, `neverError: true`, `fullResponse: true`,
  timeout 15 s. **Internal to the Docker network. 96 calls/day.**
- `Format Probe` computes `ok` / `verdict` / `reasons` and deliberately withholds
  `connected_number` and the WAHA webhook URL list unless `NEXUS_PROBE_VERBOSE=true`.
  Its own comment warns that `s.config.webhooks[].customHeaders` **will contain the
  WhatsApp webhook secret once change 07 is done** — so never widen that node.
- `Probe Alarm` throws on a FAIL verdict, which n8n routes to the configured error
  workflow `iYJkh1kztWxZXDbT` (NEXUS Error Handler), which writes `audit_log`.
  De-duplicated via `$getWorkflowStaticData`: alarms on the 1st consecutive
  failure and then every 8th (~2 hours).
- `Probe Auth Gate` is **dormant** while `NEXUS_PROBE_KEY` is unset — the GET
  endpoint answers anyone. `Format Probe`'s field-by-field output is what stops it
  being an index of the WhatsApp webhook URL. Publishing without setting
  `NEXUS_PROBE_KEY` re-opens a readable (if now uninformative) probe endpoint.

**Blast radius of publishing:** `audit_log` rows when WAHA is unhealthy, and an
unauthenticated GET that returns a PASS/FAIL verdict. `saveDataSuccessExecution`
is `"none"` on this workflow, so the 96 daily runs do **not** accumulate execution
rows.

## Preconditions before publishing

1. **`NEXUS_PROBE_KEY` set on the VM** (see `PRECONDITIONS.md`). Without it the
   probe endpoint is open. It is far less dangerous than it was — `Format Probe`
   no longer leaks the webhook list — but an open endpoint that reports whether
   the dealership's WhatsApp is down is still operational intelligence.
2. `WAHA_API_KEY` present in the n8n container env (it already is — the same var
   is used by `Send Reply via WAHA HTTP API`, which works today).

## The publish

n8n editor → workflow `57QpbNQGwlFKb0q3` → Publish. Then **fetch the published
version back** and confirm `activeVersionId` is no longer `null` and equals
`versionId`. Verify against the published version, not the draft.

## Reconcile the registry at the same time

The registry row is wrong in two ways and both should be fixed in the same change
window, or the dashboard keeps lying in a new direction:

```sql
update public.workflow_registry
   set trigger_type   = 'schedule',
       trigger_detail = 'Every 15 minutes (schedule) + GET /webhook/infra-probe'
 where id = '57QpbNQGwlFKb0q3';
```

Leave `is_active` alone — it is already `true`, and after the publish it will
finally be true of the box as well.

## What breaks if applied out of order

- **Publish this BEFORE 07.** The gate rollout is the one change in this bundle
  that can take the WhatsApp channel dark, and the probe is the only thing that
  would tell you. Doing 07 first means enforcing blind.
- **Do not publish it before 03/04.** It adds a source of `audit_log` FAILED rows;
  keeping that noise out of the window in which you are reading `communication_logs`
  for change 03 is worth the ten minutes.

## Verify

See `VERIFY.md` §05.

## Roll back (under a minute)

n8n editor → Unpublish workflow `57QpbNQGwlFKb0q3`. The schedule stops
immediately; nothing outside n8n and `audit_log` was touched. If the concern is
only alarm noise, the narrower rollback is to disable the `Probe Alarm` node,
which keeps the verdict endpoint working.
