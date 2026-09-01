# NEXUS OS — Invariants

Eight rules the system is not allowed to break. Each was checked against the live
Supabase project `dsvuoovivysszdoiorch` on **2026-09-01**, as role `postgres`
with `rolbypassrls = true` — so no count below is a row-level-security artefact.

Every "verified" line names the query or script that produced it. Where the data
contradicts the rule, the contradiction is recorded as an **OPEN VIOLATION**
rather than smoothed over. Five of the eight carry one.

Runnable evidence:

- `/home/claude/verify/invariants.sql` — every SQL probe below, with the result
  recorded beside it as a comment.
- `/home/claude/verify/health_parity.mjs` — imports the real
  `apps/executive-dashboard/lib/health.js` and runs it over live `audit_log`
  data. Exit 0 = agreement.
- `/home/claude/verify/extract_audit.mjs` — builds the data file the above reads.

Frontend file lists were taken by grep at 20:55 on 2026-09-01. Five agents were
editing `screens/*.js` and `lib/*.js` during this pass and several files changed
underneath it — `lib/comm-events.js` was created at 20:51, mid-run. Re-run the
greps before relying on a consumer list.

---

## INV-001 · One vocabulary for what a workflow run did

**Business rule.** A run either did the job, did part of it, broke, produced
nothing, was refused on purpose, or was handed to a person — and the dealership
uses those same six words everywhere, plus "unrecognised" for anything else.

**Source of truth.** `public.nexus_outcome_class(workflow, status, summary)`, an
IMMUTABLE SQL function. `v_workflow_health` is the only aggregate over it.

**Owner.** Postgres. The function is the definition; nothing else may redefine it.

**Write path.** n8n workflows write a raw `audit_log` row (`workflow`, `status`,
`summary`). They do not write a class. The class is computed on read by
`nexus_outcome_class`, so a mislabelled writer cannot poison the vocabulary —
it can only be corrected by the function.

**Read path.** Screens read the pre-computed columns on `v_workflow_health`
(`failures_30d`, `partials_30d`, `no_result_30d`, `successes_30d`,
`effective_runs_30d`, `success_rate_30d`, `health`). A screen reading raw
`audit_log` rows must classify them through `lib/health.js` — the sole frontend
mirror — and never by comparing `status` itself.

**Frontend consumers.** `lib/health.js` (the mirror), imported by
`screens/ask.js`, `screens/automation.js`, `screens/campaigns.js`,
`screens/competitors.js`, `screens/compliance.js`, `screens/conversations.js`,
`screens/customers.js`, `screens/finance.js`, `screens/inventory.js`,
`screens/leads.js`, `screens/overview.js`, `screens/settings.js`,
`lib/format.js`, `lib/lead-drawer.js`.

**Failure mode.** Competitor Price Scraping showed a green "Clean, 30 d — 100.0%"
pill while producing no price on most of its runs, because four screens each
tested `status === 'FAILED'` and counted everything else as success. A manager
reading that tile had no way to know the scraper had found nothing all month.

**Regression test.**

1. `node /home/claude/verify/health_parity.mjs` — runs the real `lib/health.js`
   over every distinct `(status, summary)` pair in `audit_log`, weighted by row
   count, and compares against `nexus_outcome_class`.
   **Result 2026-09-01: 570 rows compared, 570 in agreement, 0 disagreements**
   (288 distinct pairs). No class outside the declared vocabulary. Exit 0.
   Distribution: FAILURE 199, SUCCESS 199, NO_RESULT 115, REJECTED_EXPECTED 36,
   PARTIAL 19, ESCALATED 2. *(The prior pass compared 569 rows; one row has been
   logged since.)*
2. Grep for screens classifying status themselves — comments stripped,
   pattern `(status|st)\s*===?\s*['"](FAILED|SUCCESS|PARTIAL|NOT_EXECUTED|REJECTED|ESCALATED)['"]`.
   **Result: 8 matches, all in `lib/health.js`. Zero in any screen.**
3. `invariants.sql` probe C — no workflow reported HEALTHY carries a failure,
   partial, no-result, escalation or unknown in its window.
   **Result: all five counts zero.**

**OPEN VIOLATION — `HEALTHY` is not structurally closed against NO_RESULT or ESCALATED.**
Probe C passes on today's data, but that is a property of the data, not of the
view. Replaying `v_workflow_health`'s own health `CASE` over synthetic counters
(`invariants.sql` probe D) shows what it would return:

| scenario | health |
|---|---|
| 1 PARTIAL + 10 SUCCESS | DEGRADED |
| 1 FAILED + 10 SUCCESS | DEGRADED |
| **1 NOT_EXECUTED + 10 SUCCESS** | **HEALTHY** |
| **2 ESCALATED + 10 SUCCESS** | **HEALTHY** |
| 6 NOT_EXECUTED + 5 SUCCESS | PRODUCING_NOTHING |

PARTIAL and FAILURE are structurally forbidden under HEALTHY — they have their
own `CASE` branches. NO_RESULT is not: it only forces `PRODUCING_NOTHING` once it
passes half of `effective_runs_30d`, so a minority of runs that executed and
produced nothing sits inside a green pill. ESCALATED is not either: it is
excluded from `effective_runs_30d` entirely and has no branch at all, so any
number of escalations leaves health untouched. In both cases `HEALTH_WORDS.HEALTHY`
would tell the reader "Every qualifying run in the window succeeded outright",
which is false for the first — 10 of 11 did.

This is currently latent only because no instrumented workflow has a minority
NO_RESULT count and every workflow with escalations (KYC/AML, 2 escalations) is
already DEGRADED for other reasons.

*To close:* add `when coalesce(a.no_result_30d,0) > 0 then 'DEGRADED'` — or a
distinct non-green state — above the `PRODUCING_NOTHING` branch, and decide
explicitly whether an escalation should colour a workflow at all. Both changes
are to `v_workflow_health`; `lib/health.js` needs no change because it mirrors
the row classifier, not the health roll-up.

---

## INV-002 · A customer is one person, and an uncertain match is refused

**Business rule.** Messages belong to the customer who sent them, and when the
dealership cannot tell two customers apart by phone number it attaches the
message to neither rather than guessing.

**Source of truth.** `v_lead_messages` for message-to-lead resolution;
`lib/identity.js` for the same rule in the frontend.

**Owner.** Postgres owns resolution. `lib/identity.js` is the only frontend
module permitted to decide whether two keys are the same person.

**Write path.** Nothing writes a resolution. `communication_logs.lead_email`
holds whatever key the channel supplied — a real address, `<digits>@c.us`,
`+<digits>@whatsapp.lead`, or an opaque `<lid>@lid`. Resolution happens on read.

**Read path.** `v_lead_messages` joins on, in order: exact lowercased email;
last-9-digits of a phone-bearing key, **but only when that 9-digit tail belongs
to exactly one person** (the `unique_tail` CTE); and for `@lid` keys, a bridge
through `whatsapp_contacts`. A tail shared by two people matches nothing.
Screens call `expandIdentity` / `sameIdentity` / `personQuery` from
`lib/identity.js` rather than slicing phone strings themselves.

**Frontend consumers.** `screens/campaigns.js`, `screens/compliance.js`,
`screens/conversations.js`, `screens/customers.js`, `screens/deals.js`,
`screens/leads.js`, `screens/overview.js`, `lib/lead-drawer.js`.

**Failure mode.** Before the guard, a message from one customer was attributed to
another whose number ended in the same nine digits, and two screens showed
different message counts for the same person — each confident, neither right.

**Regression test.** `invariants.sql`, INV-002 block.
**Result 2026-09-01: lead 34 → 8 rows, lead 35 → 10, lead 38 → 29** — the
canonical *resolution* figures, matching exactly. These count rows resolved to a
lead, not messages: filtered by the `is_message` column (INV-004) the same three
leads hold **7 / 10 / 28** messages, the difference being one silence marker each
for leads 34 and 38. Quote whichever figure the question asks for, and never the
resolution count under the word "messages". Collision probe returns **0 rows** (no
9-digit tail is currently shared). Resolution coverage: **99 rows in
`communication_logs`, 47 resolved by `v_lead_messages`, 52 unresolved.**

**OPEN VIOLATION — the two identity paths in Postgres do not implement the same rule.**
`v_lead_messages` refuses an ambiguous phone tail via `unique_tail`.
`nexus_lead_for_comm_key(text)` — the function the response-time trigger uses
(INV-003) — has no such guard: on a collision it takes
`order by created_at limit 1`, silently picking the oldest matching lead. So the
same message could be refused by the view and attributed by the trigger. This is
unobservable today only because the collision probe returns zero rows; it becomes
a live misattribution the first time two customers share a 9-digit tail.

*To close:* give `nexus_lead_for_comm_key` the same `unique_tail` restriction, so
that branch (b) returns NULL on an ambiguous tail instead of the oldest row.

**Note, not a violation.** `screens/finance.js` does not import `lib/identity.js`
and joins on the raw `lead_email` string (29 code references). That is narrower
than the identity rule, not in conflict with it — it will miss a customer whose
quote carries a different key shape rather than misattribute one. Unobservable
now: `finance_quotes` holds 0 rows.

---

## INV-003 · One clock decides how fast a lead was answered

**Business rule.** How long a customer waited for a first reply is measured once,
by the system, at the moment the reply is logged — and a blank means nobody
measured it, not that nobody replied.

**Source of truth.** `leads.response_time_minutes`.

**Owner.** The trigger `trg_comm_logs_first_response` on `communication_logs`,
running `nexus_mark_first_response()`. Exactly one writer.

**Write path.** AFTER INSERT on `communication_logs`. The function returns early
unless `nexus_is_reply(direction, channel, message)` — so `[system]` and
`[SILENCE-` rows never start the clock (see INV-004). It resolves the lead via
`nexus_lead_for_comm_key`, stamps only where `response_time_minutes IS NULL`, and
declines to measure a reply that predates the lead row by more than 90 seconds,
leaving NULL rather than clamping to zero. Its whole body is wrapped so a
measurement failure can never block message logging.

**Read path.** Screens read the column. They never subtract two timestamps to
produce it. SLA counts come from `v_team_performance.within_sla` /
`breached_sla`, which are `count(*) FILTER` on the same column at `<= 5` and
`> 5`; a NULL lead counts in neither.

**Frontend consumers.** `screens/leads.js` (6 references), `screens/team.js` (9),
`screens/overview.js` (3), `screens/customers.js` (2), `lib/lead-drawer.js` (2).

**Failure mode.** Until 31 Aug 2026 a second BEFORE INSERT trigger on `leads`
clamped a negative interval to 0 and locked the real writer out, so leads that
had never been answered displayed as answered instantly. It has been deleted.

**Regression test.** `invariants.sql`, INV-003 block.
**Result 2026-09-01:** of the two functions whose source mentions the column,
only `nexus_mark_first_response` matches `set\s+response_time_minutes`
(`writes_it = true`); `capture_daily_metrics` reads it but does not write it.
Column state: **2 leads populated (1 and 4 minutes), 1 NULL, 3 leads total.**
Frontend derivation check — grep for `response_time_minutes\s*=` across
`screens/*.js` and `lib/*.js` with comments stripped: **zero assignments.**

---

## INV-004 · A silence marker is not a message

**Business rule.** When twelve hours pass with no reply, the system files a note
saying so. That note is a record of nobody being in touch — it is never counted
as a message, never as a reply, and never as the date the dealership last spoke
to the customer.

**Source of truth.** `communication_logs` rows on `channel = 'system'` whose
message begins `[SILENCE-`. `nexus_is_reply()` is the DB's authority on what
counts as a message.

**Owner.** The n8n workflow "Phase 6 — 12-Hour Silence Detector" writes them.
Nothing else may.

**Write path.** The detector fires once for a lead that received an outbound
message and did not answer within twelve hours, inserting a
`channel='system'`, `direction='outbound'` row prefixed `[SILENCE-ESCALATED]`.

**Read path.** Every consumer must exclude them before counting messages, before
counting replies, and before dating last contact. The DB rule is
`nexus_is_reply`, which requires `direction='outbound'`, channel in
(whatsapp, email, sms), and a message matching neither `[system]%` nor
`[SILENCE-%`.

**Frontend consumers.** `lib/comm-events.js` (created 20:51 on 2026-09-01; the
intended single definition — `MARKER_PREFIXES`, `isMessageRow`, `isInternalRow`,
`lastContactAt`, `silenceCount`), imported so far only by `screens/customers.js`.
Still carrying their own encodings: `screens/conversations.js`
(`SILENCE_MARKER`, `isMarkerText`), `screens/overview.js` (local `isInternal` at
line 819), `screens/campaigns.js` (line 710). `screens/leads.js` defers to the
DB rule.

**Failure mode.** A thread preview rendered "[SILENCE-ESCALATED] Silent for 12h
since …" as though the dealership had sent the customer that text, and the
thread's last-contact date was taken from the marker — so a customer nobody had
spoken to in days looked freshly contacted.

**Regression test.** `invariants.sql`, INV-004 block.
**Result 2026-09-01:** `communication_logs` holds whatsapp/inbound 78,
whatsapp/outbound 19, **system/outbound 2 — and both system rows are silence
markers**; no marker exists on any other channel.
`nexus_is_reply('outbound','system','[SILENCE-ESCALATED] Silent for 12h')`
returns **false**; `nexus_is_reply('outbound','whatsapp','Hi, here is your quote')`
returns **true**.

**CLOSED 2026-09-01 — the message predicate now lives in the database.**
As measured earlier in this pass, `v_lead_messages` applied no message-shape
filter at all (`where channel='system'` returned **2**), so its per-lead counts
carried the markers, and `v_conversations.outbound_count` counted every
`direction='outbound'` row with `screens/conversations.js` compensating in UI
text and calling the figure a floor — a caption is not an invariant.

Migrations `comm_taxonomy_message_predicate` and `comm_taxonomy_views_own_the_rule`
close it. `public.nexus_is_message(direction, channel, message)` is now the single
definition; `v_lead_messages` carries an `is_message` column and
`v_conversations` carries `msg_count`, `msg_inbound_count`, `msg_outbound_count`,
`last_msg_at`, `last_msg`, `last_msg_direction` and `awaiting_msg_reply` beside
its original all-rows columns, which were left in place because other consumers
sort and alert on them. Verified 2026-09-01: leads 34 / 35 / 38 resolve 8 / 10 / 29
rows of which **7 / 10 / 28** are messages.

**OPEN VIOLATION — the alert surface still keys off the all-rows column.**
`v_needs_attention.unanswered_chat` keys off
`awaiting_reply = (last_direction = 'inbound')`, not the new `awaiting_msg_reply`,
so a thread whose newest row is a marker still satisfies no alert and disappears
from every alert surface. It is not currently *wrong* — both marker-topped threads
have an outbound last message, so the two columns agree today — but it is the
old rule, and it agrees by luck rather than by construction.

**OPEN VIOLATION — two screens still encode "is this a real message" themselves.**
`public.nexus_is_message` and `lib/comm-events.js` are now one rule, mirrored
line for line and verified identical on all 99 live rows plus the synthetic cases
that used to separate them (leading-space marker, `[system]` body,
`channel='system'` with an ordinary body). `nexus_is_reply` tests only the wide
`[SILENCE-` prefix; it agrees with `nexus_is_message AND outbound` on every live
row today, but that is data agreeing, not one definition.

Two screens have not migrated. `screens/campaigns.js:710` tests the narrow full
string `[SILENCE-ESCALATED]` and never the channel; `screens/overview.js:819`
tests `channel ∈ {system, internal} || direction === 'internal'` and never the
message text — the mirror-image hole. A future marker spelled `[SILENCE-WARNED]`
is caught by the database and by `comm-events.js` and missed by `campaigns.js`;
a marker body written on `channel='whatsapp'` is missed by `overview.js`.

*To close:* repoint `v_needs_attention.unanswered_chat` at `awaiting_msg_reply`,
and finish the `lib/comm-events.js` migration so `overview.js` and `campaigns.js`
import it instead of re-deciding. `conversations.js`, `customers.js` and
`lib/lead-drawer.js` were migrated to it on 2026-09-01.

---

## INV-005 · The dashboard shows finance figures, it does not work them out

**Business rule.** Monthly instalments and interest rates are quoted by the
finance system. The dashboard repeats what was quoted; it never calculates a
payment of its own.

**Source of truth.** `finance_quotes` — `monthly_payment_low_aed`,
`monthly_payment_high_aed`, `indicative_apr_low_pct`, `indicative_apr_high_pct`,
`apr_source`, `emi_unavailable_reason`.

**Owner.** The n8n workflow "Finance Calc: Auto Loan Equity & Credit Score".

**Write path.** The workflow computes the amortisation and writes the resulting
figures onto a `finance_quotes` row. Where it cannot price a quote it writes
`emi_unavailable_reason` and leaves `monthly_payment_low_aed` NULL — an explicit
"no instalment", not a zero.

**Read path.** `screens/finance.js` reads the stored columns and formats them.
`aprOf(q)` parses a rate already on the row; it does not derive one. Where
`monthly_payment_low_aed` is NULL the screen renders the reason rather than a
computed substitute.

**Frontend consumers.** `screens/finance.js` (the only screen touching quote
columns; `aprRange`/`aprOf` at lines 83–96, render path from line 420).
`lib/deal-form.js` and `screens/deals.js` pass `budget_aed` through as an
attribute and compute nothing.

**Failure mode.** No observed failure — this invariant has held. The risk it
guards against is the dashboard and the finance workflow quoting a customer two
different monthly payments for the same car.

**Regression test.** Grep for amortisation arithmetic across `screens/*.js` and
`lib/*.js` with comments stripped.
**Result 2026-09-01: zero occurrences of `Math.pow` anywhere in the frontend.**
No `**` exponentiation, no rate-over-12 term, no principal loop. The only
finance-shaped identifiers in `screens/finance.js` are reads of stored column
names. Note that `finance_quotes` currently holds **0 rows**, so this is a
source-level guarantee, not one exercised by live data.

---

## INV-006 · "Rejected" means two different things and must stay split

**Business rule.** A request the system refused on purpose is fine. A scraper
that ran, was told no, and came back with no price is not fine — it is a job
producing nothing, and it must not be filed under the same word as a deliberate
refusal.

**Source of truth.** `nexus_outcome_class`, which splits `status='REJECTED'` on
the summary text: matching `unauthor|forbidden|refused by validation|invalid
token|not permitted` → `REJECTED_EXPECTED`; everything else → `NO_RESULT`.

**Owner.** Postgres, via the same function as INV-001.

**Write path.** n8n writes `status='REJECTED'` for both cases — the writers do
not distinguish. The split is made on read, from the summary the writer emits.

**Read path.** `REJECTED_EXPECTED` is excluded from `effective_runs_30d`, so a
genuine refusal cannot dilute a success rate. `NO_RESULT` stays in the
denominator and drives `PRODUCING_NOTHING` once it exceeds half the qualifying
runs. Neither is green in `lib/health.js`.

**Frontend consumers.** `screens/competitors.js`, `screens/ask.js`,
`screens/finance.js`, `screens/automation.js`, `screens/settings.js` — all via
`lib/health.js` and the `v_workflow_health` columns.

**Failure mode.** Collapsing the two showed Competitor Price Scraping at a clean
100%, because its 94 "no price found" runs were read as deliberate refusals and
dropped from the denominator. The dealership believed it had current competitor
pricing; it had none.

**Regression test.** `invariants.sql`, INV-006 block.
**Result 2026-09-01:**

| workflow | class | n |
|---|---|---|
| Competitor Price Scraping | NO_RESULT | **94** |
| Finance Calc | REJECTED_EXPECTED | 33 |
| Finance Calc | NO_RESULT | 13 |
| Ask-AI RAG Query | REJECTED_EXPECTED | 3 |

Competitor Price Scraping's count is now **94, up from the 84 recorded in the
earlier pass** — it has kept running and kept finding nothing. Its health row
reads `PRODUCING_NOTHING`, 14 successes against 94 no-results over 108 effective
runs, **13.0%**. Ask-AI's 3 rejections are genuine refusals and are correctly
excluded from its denominator: it reads HEALTHY on 11 effective runs of 14.

---

## INV-007 · No record is not proof that nothing happened

**Business rule.** An empty KYC register means the dealership does not know
whether a document was checked. It does not mean no document exists, and it must
never be shown as a clean compliance result.

**Source of truth.** `kyc_documents`. The honest answer to "is this customer
verified?" is one of three values — verified, failed, **unknown** — and unknown
is a real answer, not a blank to be styled as a pass.

**Owner.** The n8n workflow "KYC/AML Document Auditor (Phase 5)".

**Write path.** The auditor inserts a row per document examined, carrying
`verdict`, `is_valid`, `confidence_score`, `attempt_number`. A run that fails
before it reaches the insert leaves no row at all — which is exactly the case
this invariant covers.

**Read path.** `screens/compliance.js` must render the absence as "unknown" and
say what it does not know. A customer with no `kyc_documents` row is not
compliant and is not non-compliant; they are unaudited.

**Frontend consumers.** `screens/compliance.js`, `screens/customers.js`.

**Failure mode.** The observed case is live right now. **`kyc_documents` holds 0
rows while the auditor has 9 logged runs** — 7 failures and 2 escalations in the
last 30 days, 0 successes. Nine documents entered the process and the register
records nothing about any of them. A compliance view that reported "no problems
found" here would be reporting the auditor's own failure as a clean result. The
planner's stale estimate for the table is 9, which is the fingerprint of rows
that once existed and are gone.

**Regression test.** `invariants.sql`, INV-007 block.
**Result 2026-09-01: `kyc_documents` = 0 rows; auditor runs = 9;
failures_30d = 7; escalated_30d = 2; health = DEGRADED.** All 3 leads have no
KYC row. Verified as `postgres` with `rolbypassrls = true`, so the zero is real
and not RLS hiding rows from this connection.

---

## INV-008 · One number, one derivation

**Business rule.** A figure the dealership acts on — pipeline value, failure
count, message count — is worked out in exactly one place. Two places means two
answers, and nobody can tell which one is the business.

**Source of truth.** Whichever single view or function owns the figure. This
invariant is about there being only one.

**Owner.** Per figure; the point is that ownership is unique.

**Write path / Read path.** A figure computed in the database is read, not
recomputed, by the frontend. A figure computed in the frontend has no database
twin.

**Frontend consumers.** All fourteen screens.

**Failure mode.** Two screens showing different totals for the same thing, with
no way to tell which is right — as `screens/customers.js` does today, printing
both a locally counted message total and `v_customer_360`'s and telling the
reader the two answer different questions.

**Regression test.** `invariants.sql`, INV-008 block, plus greps for the same
business number computed twice. **This invariant does not currently hold. Four
violations found; they are listed below rather than waved through.**

**OPEN VIOLATION 1 — workflow failure count, two rules, one of them stored.**
`capture_daily_metrics()` computes
`workflow_failures = count(*) FROM audit_log WHERE status='FAILED'` — a raw
status count that bypasses `nexus_outcome_class` entirely, in direct conflict
with INV-001. Measured 2026-09-01: **that rule yields 205; the canonical rule
(`nexus_outcome_class = 'FAILURE'`) yields 199. A 6-row overcount** — precisely
the six `did not land` rows that are partial deliveries, not failures. The wrong
number is not merely computable, it is **persisted**: the latest `daily_metrics`
snapshot stores `workflow_failures = 205`, and 14 snapshot rows carry the same
rule historically. No screen renders it today (`overview.js:242` reads
`daily_metrics` only for `avg_response_minutes`), so this is latent — one chart
away from being shown.
*To close:* change the subquery to
`count(*) FILTER (WHERE nexus_outcome_class(workflow,status,summary)='FAILURE')`,
and decide whether to leave historical snapshots as-is with a note.

**OPEN VIOLATION 2 — open pipeline (AED), derived twice in the frontend.**
`screens/overview.js:266–268` sums `budget_aed` over all open leads.
`screens/team.js:177,180` sums `budget_aed` over open leads **owned by a roster
rep**, then totals across reps. The two differ by construction on unassigned
leads. They also read different volumes — `overview.js:178` sets
`LEAD_LIMIT = 2000`, `team.js:162` sets `LEAD_LIMIT = 1000` — so above 1000 leads
they diverge regardless. Worse, the shared predicate is not shared: both files
define `TERMINAL_TONES = new Set(['won','dead'])` and
`isOpenLead = l => !TERMINAL_TONES.has(tone(l && l.status))` **verbatim and
locally** (`overview.js:430–431`, `team.js:222–223`), so an edit to one silently
changes only one screen's totals. Currently unobservable: all 3 live leads have
`budget_aed = NULL`, and 2 of the 3 are unassigned — exactly the rows that would
expose the gap.
*To close:* move `TERMINAL_TONES` / `isOpenLead` and the pipeline sum into one
shared helper, and reconcile the two read limits.

**OPEN VIOLATION 3 — a rep's pipeline has a third, contradicting definition in the DB.**
`v_team_performance.pipeline_aed` is `COALESCE(sum(l.budget_aed),0)` over **every
lead ever assigned to that user, with no status filter** — won and dead included.
`capture_daily_metrics.pipeline_aed` is the same sum over **every lead in the
table**, also unfiltered. Neither matches the frontend's open-leads-only rule.
`screens/team.js` handles this by refusing to display `pipeline_aed` and saying
why (lines 301, 728, 1083), which is honest and is why this is not currently
visible — but the contradicting definitions still exist and still feed
`daily_metrics`.
*To close:* either add the status filter to both DB definitions so all three
agree, or rename the DB columns to something that does not read as "pipeline"
(`assigned_budget_total_aed`).

**OPEN VIOLATION 4 — customer message count, two derivations, both rendered.**
`screens/customers.js` prints its own count of `communication_logs` rows
alongside `v_customer_360`'s message count and, when they differ, renders a
paragraph explaining that the view excludes `[SILENCE-` rows while the screen
counts them. The disclosure is good practice and strictly better than picking one
silently — but it is two derivations of one figure, shown to the reader as two
numbers, which is what this invariant forbids. It is downstream of INV-004: once
`v_lead_messages` and the frontend agree on what a message is, the two counts
converge and the paragraph becomes unnecessary.
*To close:* fix INV-004's marker filtering, then have the screen read the view's
count and drop its own.

**Also checked, not a violation.** Average first-response time is computed in
`screens/overview.js:264` (mean of `response_time_minutes` over leads read) and
in `capture_daily_metrics` (`avg(response_time_minutes)` over all non-null
leads). Same definition, different read scope; `overview.js:449` compares the two
as a period-over-period delta, which is the intended use. Worth watching if
`LEAD_LIMIT` is ever exceeded, since the frontend mean would then be over a
sample and the stored one over the population.
