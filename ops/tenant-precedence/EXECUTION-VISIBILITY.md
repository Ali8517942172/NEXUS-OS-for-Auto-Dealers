# Execution visibility audit — save-data settings, and the c-c1 gap

**Read-only. No writes to n8n or Supabase were made in producing this file.**
Measured 2026-09-20 ~20:00-20:10 UTC against the live n8n instance
(`https://35.224.126.225.nip.io`, fronted by a Caddy reverse proxy — confirmed
via the `via: 1.1 Caddy` response header) using `ops/tenant-precedence/wf.py`'s
`call()` against the public API (`GET /workflows`, `GET /executions`).

## 1. Every workflow's save-data settings (27 total)

| Workflow | ID | Active | saveDataSuccessExecution | saveDataErrorExecution | Both none? |
|---|---|---|---|---|---|
| KYC/AML Document Auditor + Re-upload Loop (Phase 5) | `qTnh3nwWheFJbFkU` | True | none | none | **YES** |
| WhatsApp BDC — TENANT SCOPED CANDIDATE (do not activate) | `LTBExI7QzFeANeFg` | False | none | none | **YES** |
| 7-Day Warm Lead Drip Campaign | `G7FhvMY2ucW5Fg7X` | True | all | all |  |
| Ask-AI — RAG Query Agent | `qHAtd3RckAKRBUkE` | True | all (default) | all |  |
| Competitor Price Scraping & Supabase Update | `LphiGg4iqF1bn6El` | True | all (default) | all |  |
| Customer 360 - Data Aggregation (Bitrix24) | `AZkGM5M4c1uzSH7S` | True | all | all |  |
| Finance Calc: Auto Loan Equity & Credit Score | `unMMpeL9uuPO79pp` | True | all (default) | all |  |
| Google Ads Lead Form - Inbound Receiver | `EYva4c2bMV5MGq0o` | True | all (default) | all (default) |  |
| Inventory Ageing Recompute | `ZUc42jcwwHoBeEr8` | True | all (default) | all (default) |  |
| Lead Escalation - AI Agent | `KI6P1Qcf3MIZakNa` | True | all | all |  |
| Meta Lead Ads - Inbound Receiver | `JDqy54w2HUH7pHgW` | True | all | all |  |
| NEXUS Appointment Booking — CANDIDATE (do not activate) | `IsdF6LbuBnq0z3K7` | False | all (default) | all (default) |  |
| NEXUS Error Handler | `iYJkh1kztWxZXDbT` | True | none | all |  |
| NEXUS Infra Health Probe | `57QpbNQGwlFKb0q3` | True | none | all |  |
| NEXUS Master Lead Router - AI Agent | `JnlZFAVmFAuNXVya` | True | all | all |  |
| NEXUS Public — Home | `bhzCbnro0MlSCwwo` | True | none | all (default) |  |
| NEXUS Public — Privacy | `vKTmNepP4fGaTAe8` | True | none | all (default) |  |
| NEXUS Public — Terms | `Z0zFB6IKvARAzjpQ` | True | none | all (default) |  |
| NEXUS Retention Purge | `aIYwwoYStDAi9kHy` | True | all | all |  |
| NEXUS Site Enquiry to Gmail Notification | `Oz2W6EWG6n6XW0HQ` | False | all (default) | all (default) |  |
| Phase 6 - 12-Hour Silence Detector | `B3TcpfzOMWj8oWgF` | True | all | all |  |
| Slack Command Center - AI Agent | `VmnIXo7tM30zqawp` | True | all | all |  |
| Sync Closed-Won Deals to Supabase pgvector | `dhy2DDjWUqwuzHLW` | True | all | all |  |
| WhatsApp BDC AI Agent | `BiyHk9ZXxJUVGbf6` | True | all | all |  |
| WhatsApp Cloud - Inbound Receiver (Meta) | `J8MXprxVw1yhjBpp` | True | all | all |  |
| WhatsApp Send (Dashboard Reply) | `yx6m55p1Kj8V7koR` | True | all | all |  |
| wf_108 ERP Sync - Bitrix24 CRM | `bxNBzBrcOtcFpMPn` | True | all | all |  |


**Headline: 2 of 27 workflows save neither success nor error executions — 1
live, 1 inactive candidate.**

- **`qTnh3nwWheFJbFkU` — KYC/AML Document Auditor + Re-upload Loop (Phase 5),
  `active: true`.** `saveDataSuccessExecution: "none"` AND
  `saveDataErrorExecution: "none"`. This is the workflow named in the prompt,
  confirmed still live and unchanged. It handles **documents** (KYC/AML
  uploads) — the highest-severity case in this table: it is active, it is on
  the money/compliance path, and by n8n's own settings it **never** writes an
  execution row, success or error. `GET /executions?workflowId=qTnh3nwWheFJbFkU`
  independently re-confirmed 0 rows just now. (Root cause already recorded in
  `ops/tenant-precedence/STATUS.md` 20 Sep ~14:30-15:10 UTC section: this is a
  by-design workflow-settings characteristic, not a bug, and the workflow was
  not touched by that investigation either.)
- **`LTBExI7QzFeANeFg` — WhatsApp BDC — TENANT SCOPED CANDIDATE (do not
  activate), `active: false`.** Same both-none settings, but it is an inactive
  candidate — its own name says not to activate it yet. It handles **customer
  messages** (WhatsApp). Flagging so this gets fixed *before* activation, not
  discovered after.

No workflow that handles **money** (Finance Calc, ERP Sync, Deals sync) has
both-none; all of those save errors at minimum, most save both.

**Near-miss tier (saves errors, not successes — success path is silent but
failures are visible):** `NEXUS Error Handler`, `NEXUS Infra Health Probe`
(both intentionally success-silent utility workflows) and the three
`NEXUS Public —*` static-page workflows (Home/Privacy/Terms — low-stakes,
`saveDataErrorExecution` defaults to `all` since it's unset). None of these
handle money, documents, or customer messages, so they're informational only,
not flagged as risks.

## 2. The c-c1 gap: HTTP-accepted, zero n8n execution

**Case:** `JOURNEYS-RUN.json` run `07c60f5a`, dealer-C push `c-c1`
(marker `07c60f5a-c-c1`), ~2026-09-20 15:03 UTC, against
`JnlZFAVmFAuNXVya` (NEXUS Master Lead Router), webhook path
`nexus-inbound-lead`. One adversarial call showed the same symptom (per
`STATUS.md`/`JOURNEYS-RESULTS.md`).

**Ruled out, with evidence:**

1. **NOT a workflow-settings suppression.** `JnlZFAVmFAuNXVya`'s live settings:
   `saveDataSuccessExecution: "all"`, `saveDataErrorExecution: "all"`,
   `errorWorkflow: iYJkh1kztWxZXDbT`. This is the opposite of the KYC case —
   nothing here tells n8n to discard the execution.
2. **NOT a request-never-arrived case, on the evidence available.** The
   harness recorded an HTTP-accepted response for this push (task framing);
   this session did not re-send it (no writes), but independently re-queried
   `GET /executions?workflowId=JnlZFAVmFAuNXVya&limit=50` just now: the four
   *other* pushes from the exact same run/window all show up cleanly —
   16069 (15:03:53.907Z), 16072 (15:04:13.944Z), 16074 (15:04:33.982Z), 16077
   (15:04:54.114Z), each ~20s apart as the harness paced them. **There is no
   execution row anywhere in the 15:03:00–15:03:53 slot where c-c1's push (the
   first of the five, ~20s before 16069) should be.** So: the workflow is
   otherwise healthy and recording normally within seconds of the gap: this
   is not a broad pruning or DB-write outage.
3. **NOT the pruning window.** See §3 — the pruning floor sits at 2026-09-13,
   a week before this event; irrelevant to a same-day gap.
4. **NOT queue-mode saturation from volume.** Only 5 pushes in ~80s; the box
   handled far higher bursts elsewhere in these logs (11:14-11:28 UTC, 15
   pushes) with executions recorded for all of them (some erroring, but
   recorded).

**Contributing factor found, not yet a full root cause:** the
`Webhook Catch-All` node on `JnlZFAVmFAuNXVya` has **no explicit
`responseMode`** set in its parameters (confirmed via `GET
/workflows/JnlZFAVmFAuNXVya`) — it relies on n8n's node default, which is
`onReceived` ("respond immediately," i.e. the HTTP 200 is written back to the
caller as soon as the webhook is received, decoupled from whether an
execution record is ever successfully created or persisted downstream). By
contrast, KYC's webhook (`ReceiveDocument` on `qTnh3nwWheFJbFkU`) explicitly
sets `responseMode: "lastNode"` — different mechanism, already closed in §1.
An `onReceived` response mode is *consistent with* "caller sees 200, but the
execution-creation step that happens after the response was already sent can
fail silently" — and the box sits behind a Caddy reverse proxy (`via: 1.1
Caddy` on every response), which is exactly the kind of intermediate hop an
intermittent proxy-layer drop would implicate.

**Verdict: NOT DETERMINED (root mechanism), but well-bounded.** Workflow
settings are ruled out with certainty (point 1). A queue-enqueue or
proxy-layer drop occurring *after* the `onReceived` response was already sent
is the most consistent explanation of the evidence in points 1-4, matching
the prior session's own conclusion — this audit independently reproduces
their "no execution in the gap" finding rather than just trusting it, and adds
the concrete `responseMode: onReceived` (default) + Caddy-fronted evidence as
the mechanism that makes such a drop possible without an error HTTP code. It
is not proven because nothing available to this read-only session shows the
actual failure point.

**What would settle it (none of this is available to this session):**
- n8n main-process application logs for 2026-09-20 15:03:30-15:03:55 UTC
  (would show whether the webhook handler even attempted to create an
  execution, or errored/threw before that).
- Caddy access/error logs for the same window (would show whether the request
  reached n8n at all, or was answered by the proxy, or the upstream
  connection was reset).
- If `EXECUTIONS_MODE=queue` is confirmed live (see §3 — plausible but also
  not settled by this session), Redis queue metrics/logs for the same window
  (would show a job enqueued-then-lost vs never enqueued).
- Deliberately reproducing the gap live (out of scope here: read-only).

## 3. Execution pruning: confirmed active, ~7-day floor (settles a
previously-open repo question)

The repo carries two conflicting compose configs and multiple docs
(`ops/message-durability/P0-CLAIMED-NEVER-LOGGED.md`,
`ops/n8n-meta-lead-ads/GO-LIVE.md`, `ops/n8n-waha-gate/README.md`,
`ops/v1-certification/OWNER-STEPS.md`, `ops/whatsapp-cloud/WAHA-EXIT-PLAN.md`)
all independently flagging "which compose file the box runs is not settled by
this repository":

| compose file | `EXECUTIONS_DATA_PRUNE` | `EXECUTIONS_DATA_MAX_AGE` | `EXECUTIONS_DATA_PRUNE_MAX_COUNT` |
|---|---|---|---|
| `docker-compose.yml` | `true` | `168` h (7 days) | `5000` |
| `docker-compose.single.yml` | `true` | `72` h (3 days) | `1000` |
| `render.yaml` | (unset — no prune env vars at all) | — | — |

This session has no SSH/docker access to the box (confirmed: no `~/.ssh`
config, no `docker` binary here, `/opt/nexus/.env` is not on this machine —
it is on the remote VM the n8n API is served from), so `docker compose ps` /
`grep -o '^[A-Z_]*=' /opt/nexus/.env` could not be run. **But the question is
settled empirically anyway**, by paging every execution the API will return:

- Scanned all executions via `GET /executions` (paginated, 2 059 rows total).
- **Oldest surviving execution: id 13185, `startedAt: 2026-09-13T20:00:27Z`.**
- Current server time (from the HTTPS response `Date` header, same query):
  **2026-09-20T20:07:43Z** — almost exactly **7 days 0h 7m** after the oldest
  surviving row.
- This is a hard cliff, not just thin history: the repo's own audit docs
  reference live execution IDs and heavy testing activity throughout
  1-12 September (workflows were created 2026-08-24), so the absence of any
  execution older than 2026-09-13 in a system with real traffic before that
  is pruning, not silence. 2 059 total executions is also far under both
  candidate `MAX_COUNT` caps, so age — not count — is the active limit.

**Conclusion: `docker-compose.yml`'s `EXECUTIONS_DATA_MAX_AGE=168` (7 days) is
the config actually running**, not `docker-compose.single.yml`'s 72 h. This
also agrees with `CLAUDE.md`'s recorded `executionMode: queue`, which only
`docker-compose.yml` can produce. **The evidence trail for any execution —
including this one — survives 7 days, then is gone for good.**

## 4. Minimal fixes

| Target | Fix |
|---|---|
| `qTnh3nwWheFJbFkU` (KYC, live) | Set `saveDataErrorExecution: "all"` at minimum (ideally `saveDataSuccessExecution: "all"` too, or `"errors"` cheaper) via `PUT /workflows/{id}` (public API `PUT` on this workflow family has previously rejected extra properties — use `mcp__n8n__update_workflow` + `publish_workflow`, and re-check `versionId == activeVersionId`, per `STATUS.md`'s own note on this exact hazard). Every KYC document audit currently leaves zero evidence trail; this is the highest-priority fix in this file. |
| `LTBExI7QzFeANeFg` (WhatsApp BDC candidate, inactive) | Same fix, before this workflow is ever activated — it is currently a landmine identical to the KYC one, just not yet armed. |
| `JnlZFAVmFAuNXVya` (Master Router, the c-c1 gap) | Settings are not the defect (§2), so no settings change fixes this. Minimal mitigation: set the webhook node's `responseMode` explicitly to `"lastNode"` (or `"responseNode"` with an explicit `Respond` node placed *after* the execution/persist step) so the HTTP response is coupled to actual execution completion instead of firing on receipt — this would turn a silent drop into a caller-visible timeout/5xx instead of a false-positive 200, which is strictly better even if it doesn't eliminate the underlying proxy/queue flakiness. Getting the actual root cause requires n8n + Caddy logs for the window (§2), which this session cannot reach. |
| Pruning floor (repo-wide) | Either (a) confirm `docker-compose.yml` is authoritative and delete/relabel `docker-compose.single.yml` so the repo stops disagreeing with itself, or (b) if evidence retention matters more than disk, raise `EXECUTIONS_DATA_MAX_AGE` (e.g. to 336h/14d) on whichever file is live — 7 days is tight for an audit trail on a KYC/compliance-adjacent system. |
