# The real finding: two integrations went quiet and nothing noticed

The Bitrix24 and Slack question turned out to have a mundane answer
(`WHY-SILENT.md`). This is the finding that is not mundane:

> **`wf_108 ERP Sync - Bitrix24` last did real work on 19 August 2026. Nobody
> noticed for 25 days, and the thing that noticed was a human asking a
> question.** The dealership's CRM push had been dark for three and a half weeks
> and every dashboard in the system was content.

Worse, the investigation itself was nearly derailed by the monitoring data:
`audit_log`'s last row for both workflows is dated 6 Sep, so the obvious reading
is "it worked on the 6th and then broke". It did not. Those rows are rejected
probes. **The health surface not only failed to raise an alarm, it supplied a
plausible wrong answer.**

---

## Why `v_workflow_health` did not catch it

Read the view definition on production (`pg_get_viewdef`). Its `health` column is
a `CASE` over eight conditions:

```
NOT writes_audit_log        -> NOT_INSTRUMENTED
runs = 0 (all time)         -> NEVER_RAN
failures_30d > 0            -> DEGRADED
partials_30d > 0            -> DEGRADED
unknown_30d > 0             -> UNKNOWN_OUTCOME
escalated_30d > 0           -> DEGRADED
effective_runs_30d = 0      -> NO_QUALIFYING_RUNS
no_result_30d*2 > runs      -> PRODUCING_NOTHING
else                        -> HEALTHY
```

**There is no state for "ran fine, then stopped".** Every branch asks *what
happened when it ran*. Not one asks *how long since it last ran*. `last_run` and
`last_success` are both selected — the data is right there — and neither is
compared to `now()`. A workflow that succeeded a hundred times and then went
silent forever stays `HEALTHY` until its last run falls out of the 30-day window,
at which point it becomes `NO_QUALIFYING_RUNS`: a phrase that reads like a
reporting nuance, not an outage.

And what the view actually says today:

| name | health | last_run |
|---|---|---|
| `wf_108 ERP Sync - Bitrix24` | DEGRADED | 2026-09-06 15:02:34 |
| `Slack Command Center - AI Agent` | DEGRADED | 2026-09-06 15:02:53 |
| `NEXUS Master Lead Router` | DEGRADED | 2026-09-11 11:18:33 |
| `Lead Escalation - AI Agent` | DEGRADED | 2026-09-12 04:05:07 |

**Everything is DEGRADED, so DEGRADED means nothing.** The healthy workflow and
the 25-days-dark workflow carry the same badge. They are DEGRADED because
`failures_30d > 0`, and their failures are the **6 Sep unauthenticated probe
sweep** — deliberate negative controls, counted as production failures. A
fail-closed gate doing its job is scored as the workflow being sick. The class
function `nexus_outcome_class()` already has a `REJECTED_EXPECTED` class for
exactly this, and these rows landed as `FAILURE` instead, because the workflows
recorded their own rejection as `status = 'FAILED'` rather than `'REJECTED'`.

Three distinct defects, all visible in that one four-row table:
1. **No staleness dimension** — the outage itself is unrepresentable.
2. **Probe noise scored as failure** — the alarm is permanently on, so nobody
   reads it.
3. **`last_run` is not "last worked"** — a rejected probe advances the clock the
   same as a successful run, which is what made the 6 Sep date look causal.

## The catalogue join, and the invisibility it creates

The view's `FROM` is `nexus_workflow_catalogue()` LEFT JOIN LATERAL `audit_log`
on `l.workflow = r.name OR l.workflow = r.audit_name OR l.workflow = ANY(r.audit_aliases)`.
Measured on production, **9 `audit_log` rows match no catalogue entry at all**:

| workflow (in `audit_log`, not in catalogue) | rows | last seen |
|---|---|---|
| `Inventory Action Center` | 8 | 2026-09-06 04:23:01 |
| `Example Workflow` | 1 | 2026-08-26 02:48:41 |

The direction of that failure is what matters. A workflow whose `audit_log`
string drifts from its catalogue name does not appear as *failing* — **it
disappears from the view entirely**. There is no row to be red. `Inventory Action
Center` has been writing audit rows for weeks and does not exist as far as
workflow health is concerned.

This is a live hazard, not a hypothetical, and `wf_108` nearly demonstrated it:
it writes **two different strings** — its seven successes are filed under
`wf_108 ERP Sync - Bitrix24` and its failures under `wf_108 ERP Sync - Bitrix24
CRM`. Both currently resolve through `audit_name`/`audit_aliases`. A third
rename, or a rename made in n8n without a matching catalogue edit, silently
deletes the workflow from monitoring. The join is a **string equality against a
hand-maintained list**, and nothing enforces the two sides agreeing.

There is precedent for the same class of failure one layer down:
`NEXUS Infra Health Probe` (`57QpbNQGwlFKb0q3`) has `activeVersionId: null` —
never published — while `workflow_registry` says `is_active = true`
(`STATUS-2026-09-06.md:73`). The monitor of last resort is itself unpublished and
the screen reports it as live.

## The check that would have caught this on day one

**One rule: a workflow that is supposed to run has not succeeded in N hours.**
That is the sentence the system cannot currently say. Three parts, in order of
value:

**1. A staleness state in the view itself** — `STALE`, computed from
`last_success` (not `last_run`), against a per-workflow expectation the catalogue
already has room for. Add `expected_max_silence` (an interval) to
`nexus_workflow_catalogue()` and one branch to the `CASE`, placed **above** the
failure branches so silence outranks noise:

```
WHEN r.expected_max_silence IS NOT NULL
 AND (a.last_success IS NULL OR a.last_success < now() - r.expected_max_silence)
     THEN 'STALE'
```

Sensible starting values: `wf_108` — hours after any HOT lead; `Master Router` —
24h; the scheduled ones (`Competitor Price Scraping`, `Inventory Ageing
Recompute`, `Customer 360`) — their own cadence plus a margin. `Slack Command
Center` is human-triggered and should be `NULL` (nothing to expect), which is
precisely why cataloguing it as `is_active = false` matters — see
`RESTORE-PLAN.md` step 5.

**2. A coverage assertion on the join** — one query, run in CI, that fails when
any `audit_log.workflow` string from the last 30 days matches no catalogue row.
Today it returns 2 names / 9 rows; it should return zero. This converts a silent
disappearance into a red build. It is four lines of SQL and it is the single
highest-value item here, because every other check inherits the join.

**3. Stop counting deliberate probes as failures** — have the fail-closed gates
record `status = 'REJECTED'` (which `nexus_outcome_class()` already maps to
`REJECTED_EXPECTED` and excludes from `effective_runs`) rather than `'FAILED'`.
`Ask-AI RAG Query` already does this correctly; the `Auth Gate` workflows do not.
Until this changes, `DEGRADED` stays permanently on and no alert built on it will
ever be read.

## Where it belongs

- **(1) and (3) in the database**, as a migration against
  `nexus_workflow_catalogue()` / `v_workflow_health` and the gate nodes.
  The view is already the single definition of workflow health; a second,
  parallel alerting notion would be the same mistake at a different layer.
- **(2) in CI**, next to the existing regression suite — it is an invariant about
  the repo and the database agreeing, and it should block a merge, not page
  someone.
- **The alert itself** should fire from whatever already watches the database on
  a schedule, reading `v_workflow_health where health in ('STALE','NEVER_RAN')`.
  It must **not** be a new n8n workflow: an n8n workflow that goes silent is the
  exact failure being monitored, and `NEXUS Infra Health Probe` is the standing
  proof that the box cannot be trusted to watch itself.

## What this would have looked like on day one

20 August, 09:00: `wf_108 ERP Sync - Bitrix24 — STALE, last success 19 Aug
11:04`. One line. Twenty-five days of a dark CRM push, and an investigation that
started from a misleading date, both avoided.
