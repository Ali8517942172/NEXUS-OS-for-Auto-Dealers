# NEXUS OS — dashboard module checklist for the ten journeys

Written 28 Aug 2026 against `/tmp/dash-work` (`screens/*.js`, `lib/*.js`) and
`SCHEMA.md`. Column lists below are the ones the code actually selects, checked
against SCHEMA.md's **CORRECTION** section — the part that was probed live on
24 Aug. Where the narrative half of SCHEMA.md disagrees with the CORRECTION,
the CORRECTION is used here.

**Why the columns matter more than they look.** PostgREST answers `42703` for
an unknown column and rejects the **whole query**, not the field. One wrong name
blanks an entire screen while everything else reports clean. That has already
happened twice in production (`team.js` selecting `leads.lead_score`). So if a
module renders as an error or as a stubbornly empty card, read the network tab
before assuming the data is missing.

---

## Read this first: how the nav badges work

`lib/badges.js` owns **every** nav badge. There is one read —
`v_needs_attention?select=kind,severity,ref,screen&limit=500` — grouped by the
view's own `screen` column, repainted every 60 s (paused while the tab is
hidden, refreshed the moment it is visible again). No screen writes its own
badge. Consequences a tester must know before filing anything:

* **Only `HOT` and `WARM` count.** `COLD` is deliberately excluded (`COUNTS` in
  `lib/badges.js`). An alert that exists on a screen and is filed COLD by the
  view will show **no badge at all**. That is the design, not a bug — most
  relevant to J4/J5/J6, where an aged-stock item may well be COLD.
* **A failed read wipes all badges**, deliberately: stale counts are
  indistinguishable from current ones. Blank badges plus a red connection pill
  in the topbar means "could not read", not "nothing to do".
* **Overview's badge is a superset.** `badges.js` sets a floor (every HOT/WARM
  row in the view, including rows filed against no screen at all); when Overview
  is open it may refine that number **upward** with the KYC archive gaps the
  view does not list. The number therefore legitimately changes when you
  navigate to Overview. Verify, do not report.
* **Badge counts are reproducible by definition**: open the screen and the rows
  are there. If a badge says 3 and the screen shows 2, that is a real bug.
* After every teardown, `v_needs_attention` should return nothing for this
  customer and **all badges should disappear**. An empty sidebar between
  journeys is the correct state.

---

## 1 · Overview

**Reads**
`v_needs_attention` (kind, severity, ref, title, detail, at, screen; limit 200) ·
`leads` (id, name, email, phone, status, ai_score, vehicle_interest, source,
budget_aed, response_time_minutes, created_at, assigned_to, assigned_to_id) ·
`inventory` (id, model, days_in_stock, price_aed, holding_cost_accrued,
aging_alert) · `daily_metrics` (`*`, newest 2 by snapshot_date) ·
`communication_logs` (lead_email, created_at; direction = outbound, windowed) ·
`v_conversations` (chat_id, display_name, identified, phone, last_message_at) ·
`kyc_documents` (id, lead_name, full_name, lead_email, document_type, verdict,
created_at, retain_until, void_reason, attempt_number, max_attempts) ·
`v_workflow_health` (id, name, category, health, runs_30d, failures_30d,
last_run, last_failure, is_active) · `competitors` (id, limit 1 — a presence
probe only).

**Click** — a row in *Needs attention* (opens the lead drawer, or jumps to the
owning screen); the live lead feed; each KPI tile is read-only.

**Must render** — the attention list ordered with `unanswered_chat` first;
five KPI tiles (open leads, awaiting first reply, response time, pipeline value,
units at risk); the stage mix. An `unanswered_chat` row's `title` is the
`display_name`, which the view can fall back to a raw `…@lid` handle — Overview
re-resolves it against `v_conversations` and must **never** print a handle as a
person's name.

**Empty state** — after a teardown: "No leads yet", "Nothing to chart yet",
"Nothing on this list needs you right now". All three are correct. The stage-mix
card draws **no bar at all** when exactly one lead is scored and says why —
that is deliberate, not a rendering failure.

**Alerts / badges** — carries the grand total (see above). The `undercut`
category is invisible while `competitors` is empty; the screen says so rather
than letting the category go quietly missing.

---

## 2 · Leads

**Reads** `leads?select=*,users(id,name)` (limit 1000) ·
`v_needs_attention?screen=eq.leads` · `communication_logs`
(lead_email, direction, created_at — one bounded windowed read, for the
"never contacted" check) · `purchase_history` (email) ·
`audit_log` (workflow, status, lead_email, logged_at; limit 1000).
There is **no** `leads.lead_score` and **no** `leads.updated_at`.

**Click** — status segment buttons (ALL/HOT/WARM/COLD), search, sort, a row
(opens the drawer), and the two per-row workflow actions:
**Escalate** → `lead-escalation`, **Start drip** → `lead-trigger`. Both open a
confirm modal first. Both fire a real n8n execution — that is a concurrency slot
(see the pacing rules), and *Start drip* enrols a real customer twice if pressed
twice.

**Must render** — J1/J8 HOT with an assigned rep; J2 WARM; J3 COLD; the phone
number under the name everywhere a lead is named; `response_time_minutes = null`
rendered as **"Not measured"**, never as a dash and never as "fast".

**Empty state** — "No leads yet" after teardown; "No leads match these filters"
when a segment is selected. The alert strip's normal state is a sentence saying
the view returned nothing, not an empty box.

**Alerts** — the view's `lead_unassigned` / `sla_breach` rows, plus four local
checks (unassigned HOT, no logged contact attempt, stale, never measured). Local
checks never reach the nav badge; only the view's rows do.

---

## 3 · Conversations

**Reads** `v_conversations` (thread_key, chat_id, phone, push_name, lead_email,
lead_name, lead_status, display_name, identified, message_count, inbound_count,
outbound_count, last_message_at, last_message, last_direction, awaiting_reply;
newest first) · `v_needs_attention?screen=eq.conversations` ·
`communication_logs` (id, direction, message, channel, created_at) read with an
`in.()` over **every** key the view resolved onto the person · `leads?select=*,
users(id,name)&email=eq.<lead_email>` for the drawer.
**Sends** `whatsapp-send` with `{ chat_id, text }`.

**Click** — a thread (below `SPLIT_MIN` threads there is **no list column, no
search and no filter tabs** — that is the layout following the data, not a
broken render); **Refresh**; **Open lead**; the composer → **Send** (confirm
modal → real WhatsApp message on the dealership's real number).

**Must render** — `display_name` and the phone, never `thread_key` or `chat_id`
as a name; `identified` (lead / whatsapp_profile / phone_only / unidentified)
visibly different from a known customer; the whole history, and if the messages
read disagrees with the view's `message_count` the screen must say so rather
than show a short thread. After a send it **re-reads** the thread — the outbound
row is written by the workflow, not optimistically appended.

**Empty state** — "No conversations yet" with the reason (v_conversations
returned no rows, so no log row resolves to a person). Correct after every
teardown. A thread with no outbound is **not** painted red: the allowlist not
answering a stranger is the system working.

**Alerts / badges** — `unanswered_chat` (HOT, newest message inbound, inside
7 days) is what the Conversations badge counts. J9 step 1 and 2 must produce
**silence** and therefore may produce an `unanswered_chat` badge — that is
correct behaviour, not the bot failing.

---

## 4 · Compliance

**Reads** `kyc_documents` (`*`, newest first) · `whatsapp_contacts` (chat_id,
phone, push_name, lead_email) · `leads` (name, email, phone) ·
`audit_log?workflow=ilike.*KYC*` · `communication_logs` (lead_email, message,
created_at; limit 500) · `v_needs_attention?kind=eq.kyc_archive_gap` ·
`signedUrl(storage_path)` — a 60-second signed URL against the private
`kyc-documents` bucket.

**Click** — verdict/type filters; the `cShow*` alert buttons (escalated,
expired, failed archive, overdue, voided); a row → drawer; **Open file** (only
where `storage_path` is set and `purged_at` is null). There is **no KYC
approve/reject webhook** — any such control is rendered disabled with a `title=`
saying so. Do not expect to approve from here.

**Must render** — J1 APPROVED first attempt with a `storage_path`; J2 REJECTED
then APPROVED with `attempt_number = 2`; J4 three rejections ending
`verdict='ESCALATED'`, `attempt_number = 3`; J9's credit-card photo recorded as
a **non-document** and *not* archived as KYC; J10 approved-then-purged, with
`purged_at` set and **no** open-file link.

**Empty state** — "No KYC activity recorded". After teardown the register is
empty **but the activity trail is not**: `audit_log` is deliberately kept, so
KYC audit rows survive their `kyc_documents` rows and render with the identity
they can no longer resolve. Expected — see the wipe section below.

**Alerts / badges** — the archive gap (`storage_path IS NULL AND purged_at IS
NULL`, voided rows excluded). This screen applies **no recency cut-off** and the
view does, so the two numbers legitimately differ and the screen prints both
with the reason between them. J10 depends on this. The `void_reason` partition
is currently empty and an empty voided section must render as **nothing at all**,
not as a titled empty card.

---

## 5 · Inventory

**Reads** `inventory` (`*`, oldest acquisition first) ·
`v_needs_attention?screen=eq.inventory` · `purchase_history` (id,
customer_name, phone, vehicle, amount_aed, purchase_date) · `competitors`
(id, limit 1 — presence probe for the drawer). Writes go through
`lib/unit-form.js` (`inventory` is browser-writable).

**Click** — status and ageing-band filters (a band button with a zero count is
disabled); sort by days-in-stock and by margin; a row → drawer → **Edit** /
**Compare** (jumps to Competitors); **Add unit**.

**Must render** — 12 real units; `id` is the stock number (NX-1010) and is what
`v_needs_attention.ref` carries for an ageing item; ageing bands
HEALTHY / WARNING / CRITICAL at 0–74 / 75–119 / 120+ days. J4 (108 d), J5
(143 d) and J6 (102 d) are the ageing tests. The unit each journey claims must
end **Sold** where the journey closes won, and be back to **Available**
afterwards.

**Empty state** — "No vehicles in stock" (should never happen; inventory is not
in the teardown list). With exactly one unsold unit **no stacked bar is drawn** —
the single unit is described in a sentence instead. Correct.

**Alerts** — the view's `inventory_aging` rows plus local checks (unmarked
sale, missing VIN, unpriced). `ref` is only looked up as a stock number when
`kind` says it is one — an `undercut` ref is a `competitors.id` and a
`workflow_failure` ref is a workflow **name**.

**Watch this one** — the screen recomputes ageing **live** from `acquired_at`
(`deriveUnit`), while Overview reads the **stored nightly** columns. The two can
legitimately disagree; the provenance line under the toolbar says which you are
looking at. There is **no sale date anywhere on this table**.

---

## 6 · Competitors

**Reads** `competitors` (`*` — id, competitor, model, our_price_aed, price_aed,
price_diff_aed, scraped_at, ai_recommendation) · `inventory` (`*`) ·
`v_needs_attention?screen=eq.competitors`. There is **no scrape hook**; the
"Run scrape" control is deliberately disabled with the reason on it.

**Click** — freshness banner, alert rows (each scrolls to or filters the rows it
names), row → drawer, **Show inventory**.

**Must render** — the age of the newest scraped row as the **first sentence on
the screen**, fresh or not; every gap computed against the **live** list price
in `inventory`, with the scrape's own `price_diff_aed` shown separately in the
drawer and flagged when the two disagree; every match labelled as what it is — a
**text match on `model`**, not a make match (there is no make, brand or year
column on either side).

**Empty state** — `competitors` currently holds **0 rows** and this is the
screen's ordinary state, with a first-class explanation of what was deleted and
why. **P2 must be fixed before J5, J6 and J7 can test anything here.** Until
then, record those three as blocked rather than failed.

**Alerts** — five local checks the view does not model, plus the view's
`undercut` rows re-checked against today's price. Note that an unsold unit no
scraped row matches is raised explicitly: it is the undercut nobody could
detect.

---

## 7 · Ask AI

**Reads / calls** `n8n('ask-ai', { question })` ·
`rag_documents` (id, doc_title, source_file, section, page_number, content —
**no timestamp of any kind**) · `v_workflow_health` · `audit_log` ·
`workflow_registry` · `v_needs_attention?screen=eq.ask` · `leads`
(name, email, phone) for phone lookups on run history.

**Click** — the question box → **Ask**; **Show raw payload** on any turn;
**Reset**; the KB counter.

**Must render** — a live elapsed counter while waiting (a single round trip has
been measured at 8.8 s); the client-side deadline turning a hang into a stated
timeout, with a late answer still rendered and **labelled late**; the citation
list. An answer with **no citations** gets a different border, a different pill
and its own banner — it must never skim-read as a grounded answer.

**The ten checks are the deliverable here.** One document section per journey
(J1 warranty p.12 · J2 extended warranty p.13 · J3 annual leave p.22 · J4
trade-in approval p.11 · J5 market sources p.10 · J6 commission tiers p.4 ·
J7 warranty voidance p.16 · J8 clawback p.6 · J9 **nothing in the corpus** ·
J10 maternity leave p.24). J9 must answer "I don't know / not in company
documents" with **no citation and no invention**.

**Empty state** — an empty knowledge base **disables the Ask button outright**
rather than letting the model produce fiction. `rag_documents` is **not** in the
teardown list and must stay at 15 chunks / 4 documents for all ten journeys; if
Ask goes dead, check the table before the workflow.

**Badges** — this screen writes none. `v_needs_attention` has no branch
targeting it today, and the strip says that out loud: "the view found nothing
wrong here" and "the view does not look here" are different sentences.

---

## 8 · Finance Desk

**Reads / calls** `finance_quotes` (`*`: lead_email, lead_name,
vehicle_value_aed, loan_payoff_aed, equity_aed, equity_status,
loan_to_value_pct, indicative_apr_pct, finance_tier, credit_score, disclaimer,
quoted_by, source, created_at — **no term, no monthly payment, no expiry**) ·
`leads` (id, name, email, phone, vehicle_interest, budget_aed, status) ·
`audit_log` · `v_needs_attention?screen=eq.finance` · `inventory` (`*`, for the
commission panel). Calls `finance-calc` with exactly
`vehicleValue` / `loanPayoffAmount` / `creditScore` plus attribution.

**Click** — pick a lead, type the four numbers, **Calculate**; **Clear**; a
quote row → drawer; **Re-check** / **Reuse** on a stored quote.

**Must render** — J2: value 45,000, payoff 28,000, score 710 → **positive
equity 17,000**, healthy LTV, mid tier. J5: value 140,000, payoff 210,000,
score 560 → **negative equity −70,000**, LTV over 100 %, worst tier, highest
APR, **disclaimer present**. J5 rejection: value 2,000 → the workflow's own
message, *"vehicleValue must be a realistic vehicle valuation of at least AED
5000"*, rendered as prose and not as a payload dump. Any monthly instalment on
screen is **modelled in the browser** and must appear with its rate, term and
down payment — the column does not exist.

**Empty state** — "No quotes recorded yet" / "Nothing quoted from this desk
yet"; the commission panel shows "No inventory" if the inventory read comes back
empty. The averages (mean APR, mean LTV, negative-equity percentage) are
**withdrawn** while all quotes belong to one email address — one customer
re-priced is a negotiation, not a book of business. Expect them to stay absent
for all ten journeys.

---

## 9 · Customer 360

**Reads** `v_customer_directory` (id, name, email, phone, source_records,
last_seen_at) — **the spine, and the definition of a customer**: leads ∪
purchase_history · `v_customer_360` (name, email, phone, lead_count,
best_ai_score, latest_status, is_vip, last_contact_at, message_count,
total_emails, total_slack_messages, purchase_count, lifetime_value_aed,
last_purchase_date) · `customer_360_profiles` (the only source of
`last_synced_at`) · `whatsapp_contacts` · `leads` · `purchase_history`.
Per customer it re-reads leads, purchases and `communication_logs`.

**Click** — search, the segment filter, a customer in the list (the first is
opened automatically), **Go to leads**.

**Must render** — J1: a profile appears after the closed-won sync. J8: the
seeded prior purchase found, lifetime value aggregating both. J10: the fleet
buyer. A `0` in the email/Slack counters must be labelled from that profile's
own `last_synced_at` — a 0 written by a run **after** the Gmail fix is a counted
zero (a fact about the customer); a 0 from before it is "not counted".

**Empty state** — after teardown the directory is empty, the spine is not
rendered, and the "not a customer" section below it should also be empty
(teardown removes the `whatsapp_contacts` row too). Nothing in
`v_customer_360` / `customer_360_profiles` / `whatsapp_contacts` may ever add a
person to the customer list — anything present there but absent from the
directory belongs under the "not a customer" heading, with the reason.

**Badges** — see the wipe section: this module's nav id is **`customers`**, not
`customer_360`.

---

## 10 · Campaigns

**Reads / calls** `v_needs_attention` · `v_workflow_health` ·
`v_conversations` · `leads?select=*,users(id,name)` · `communication_logs` ·
`audit_log` · `workflow_registry`. Enrols through `lead-trigger`.

**Click** — the audience list; **Enrol** on a chosen lead (confirm modal, then a
real n8n execution); the alert rows.

**Must render** (J3) — the enrolment, the day-1 mail, and after the shortened
waits the day-3 and day-7 legs; (J6) an aged-stock push against the Explorer.
Enrolled and *sent* are separate events and must be shown as separate events.

**Empty state** — "Nobody is enrolled" / "No mail has been logged" /
"No campaign runs logged". With one lead in the database, this screen is mostly
empty states and that is the deliverable.

**Three things it will never print, at any n** — an open or click rate (nothing
records one), a delivery confirmation (a `communication_logs` row means the
workflow logged a send, never that it arrived), and a comparison between
campaigns (`communication_logs` carries no workflow id or campaign id, so a
day-3 drip mail and a hand-typed reply are the same shape to every query this
screen can write). Do not raise these as gaps; they are stated on screen.

---

## 11 · Deals

**Reads / calls** `purchase_history` (`*`, newest close first, with an
unordered fallback) · `deals_embeddings` (id, deal_id, content, created_at) ·
`leads` (id, name, email, phone, vehicle_interest, budget_aed, status) ·
`v_needs_attention?screen=eq.deals` · `inventory` (id, model, vin, status,
acquired_at, days_in_stock). Recording a deal posts `deals/closed-won` through
`lib/deal-form.js` — never a direct write, because the round trip is what
produces the embedding.

**Click** — **New deal** → the form → **Record**; period and sort filters; a
deal row → drawer.

**Must render** — J1 and J8 closed-won: a `purchase_history` row **and** a
matching `deals_embeddings` row, with the reconciliation between the two stated
even when it passes. J7 closed-lost with the reason: the lead reaches `LOST` and
there must be **no** `deals_embeddings` row (that sync is closed-won only).

**Empty state** — "No deals recorded yet"; "deals_embeddings has no rows at
all" is stated in words, because a silent zero beside a healthy revenue figure
reads as "nothing to embed" rather than "the memory is empty". At one deal the
average-deal tile is **withdrawn** and the month chart says a single bar is a
value, not a trend.

**Known absences** — no sale date on `inventory`, no column tying a purchase to
a unit. Margin is not derived from `inventory.cost_aed`, on purpose.

---

## 12 · Automation

**Reads / calls** `v_workflow_health` (`*` — including runs_30d, failures_30d,
last_failure, health) · `audit_log` · `workflow_registry` (id, name, audit_name,
audit_aliases) · `v_needs_attention` · `leads` (name, email, phone, for picking
a subject). Manual triggers exist **only** where a `HOOK` webhook really exists
and can be fired without inventing a subject record — today that is `erp-sync`
("Sync now"). Everything else is a disabled button naming what is missing.

**Click** — health-state filters; the `aShow*` banner buttons; a workflow →
drawer → **Open in n8n**; a run → run drawer; **Run now** where enabled.

**Must render** — the 30-day window computed here from `runs_30d` /
`failures_30d` rather than taken on trust from `success_rate`, and a disagreement
between the two stated rather than silently resolved. `NOT_INSTRUMENTED` is
**never green** — it is the absence of evidence. `DEGRADED` is red, everywhere.
A run stopped by the five-minute `executionTimeout` arrives as a *failure* and
must be labelled as the ceiling rather than as a broken workflow. Scheduled jobs
are judged against their own cadence, because a schedule that silently stops
raises no failures at all.

**Empty state** — "No runs logged yet", "Not instrumented", "No history, by
design" (for the request/response endpoints the dashboard itself calls —
whatsapp-send, ask-ai, finance-calc — where the missing audit row is the design).

**J9** — the deliberate breakage must produce a FAILED `audit_log` row through
`NEXUS Error Handler` and must be visible here. Restore the node immediately
after.

---

## 13 · Team

**Reads** `users` (id, name, email, role, status, slack_user_id, created_at —
**no phone column anywhere**) · `v_team_performance` (id, name, email, role,
status, leads_assigned, hot_leads, pipeline_aed, avg_response_minutes,
within_sla, breached_sla) · `leads` · `v_needs_attention?screen=eq.team`.

**Click** — search / role filter; a rep → drawer → **Show their leads**. There
is no invite endpoint and no delete: the drawer states how many leads a deletion
would orphan instead of offering the button.

**Must render** — J1: the assignment lands on Ali Asgher (senior_rep,
`9941a4db-733b-4f29-8ea4-9e26df23e44b`). J4: the KYC escalation reaches Slack
**tagged** — which needs P1 (`users.slack_user_id`) done first, or the path is
untestable. Staff phone numbers are rendered as an explicit absence with the
reason, never as a blank cell.

**Empty state** — with a roster of one: no concentration figure, no workload bar
chart (one bar is 100 % wide by construction), no within-SLA percentage over a
single measured lead. All withdrawn with one line each saying why. After
teardown expect "No leads assigned to anyone" and "No response times measured
yet" — both correct.

---

## 14 · Settings

**Reads** `v_needs_attention` · `v_workflow_health` ·
`audit_log?status=eq.FAILED` · `workflow_registry` · `rag_documents` (a
`select=*&limit=1` probe to learn the shape, then a targeted select) · the
session and `users` row. Nothing on this screen writes.

**Click** — **Re-check** (connectivity); the knowledge-base panel and
**Reload**; a workflow row; density toggle.

**Must render** — which Supabase project and which n8n instance this bundle is
talking to, and whether both are reachable **right now**; presence-only for
every secret (no masking, no first-four/last-four); the webhook list, **named
and never probed** — firing `lead-trigger` to see whether it answers would enrol
a real customer in a real drip.

**Empty state** — "No documents indexed" is a **finding**, not an empty panel:
Ask AI then answers from nothing. `ME === null` must distinguish "no staff
record" from "the users read failed" (`meReadFailed()`).

**J9 / J10 use** — retention config and the P5 timer restore checklist. Record
the original values (7-day drip, 12-hour silence, +7-year retention) and put
them back at the end: a test config left in production is how a 7-day drip
becomes a 2-minute spam cannon.

---

# What will break — or look broken — when the data is wiped

Ten wipes are going to happen. This is the section to read before filing a bug.

## Findings that need a fix

**F1 — `deals_embeddings` has no `metadata` column, so the teardown SQL in
Part 2.3 will fail.** The plan says
`delete from deals_embeddings where metadata->>'email' = …`, but SCHEMA.md's
CORRECTION — probed live — lists `id, deal_id, content, embedding, created_at`
and nothing else. Over PostgREST this is a `42703` that rejects the whole
statement; over psql it is an ERROR that aborts the transaction, and if it is
run inside the same transaction as the other deletes, **the entire teardown
rolls back and the operator sees rows they thought they had deleted**.
`teardown.py` probes for the column and falls back to deleting the exact ids the
archive collected. Fix the plan, or confirm the column exists, before J1.

**F2 — restoring the unit's `status` does not restore its ageing.** Marking a
unit Sold from the dashboard goes through `lib/unit-form.js`, whose
`deriveUnit()` **freezes `days_in_stock`** and rewrites `aging_alert` to
`HEALTHY` for any sold unit — then writes all of the derived columns back to the
table. `update inventory set status='Available'` undoes none of that. The Pajero
(108 d), the Range Rover (143 d) and the Explorer (102 d) are in this plan
*because* of their ageing bands, so a J1 or J8 teardown that leaves a unit
reading HEALTHY quietly disarms the ageing tests in J4/J5/J6. `watermark.py`
snapshots the whole row and `teardown.py` restores it; if you run the teardown by
hand, restore `days_in_stock`, `holding_cost_accrued` and `aging_alert` too.

**F3 — a `v_needs_attention.screen` value that is not a nav id vanishes without
trace.** `lib/badges.js` paints `#badge-<screen>`; if no such element exists,
`paintOne` returns silently — but the row **is** still added to Overview's grand
total. The tooltip only explains rows with a *blank* screen ("belong to no
screen"), so a row filed against, say, `customer_360` or `ask-ai` inflates the
Overview badge by one and appears on no nav item and in no explanation. The nav
ids are exactly: `overview, leads, conversations, compliance, inventory,
competitors, ask, finance, customers, campaigns, deals, automation, team,
settings` — note **`customers`** (not `customer_360`) and **`ask`** (not
`ask-ai`). Worth one query during J1: `select distinct screen from
v_needs_attention`.

**F4 — `processed_messages` is wiped, so WAHA redelivery is no longer
idempotent across journeys.** That table is the guard against WAHA re-delivering
the same message. Teardown empties it for this chat_id (correctly — the next
journey must be able to reuse the same phone). The consequence is that any
message WhatsApp re-delivers from an earlier journey will be processed as new.
This is the exact mechanism that built the 328-execution queue. Keep the ≥ 20 s
spacing rule, and run `zombiecheck.py` **before** each journey, not only after.

## Things that will look broken and are not — verify, do not panic

**V1 — Overview's "against yesterday" deltas.** `daily_metrics` is **not** in
the teardown list, so a snapshot taken before a wipe is compared against a table
after it. `overview.js` detects this (`snapshotShrank`) and prints a warning
naming the snapshot date and saying every delta on the strip inherits the
problem. Expect that warning from J2 onward. It is the guard working.

**V2 — `audit_log` outliving its rows.** Kept on purpose. So Compliance's
activity trail, Automation's run history, Campaigns' enrolment history, Ask AI's
run list and Settings' failure list all keep rows naming a lead that no longer
exists. Identity resolution (`whatsapp_contacts` → `leads`) is gone with the
rows, so those entries render through the "no name on record" path — an
identifier shown as an identifier, with a note. Correct, and by design.

**V3 — every module empty at once.** Between journeys the correct state is:
Leads "No leads yet"; Conversations "No conversations yet"; Compliance "No KYC
activity recorded" (with a non-empty trail — see V2); Deals "No deals recorded
yet"; Customer 360 no spine; Campaigns "Nobody is enrolled"; Finance "No quotes
recorded yet"; Team "No leads assigned to anyone"; all nav badges hidden.
Inventory (12 units), Ask AI (15 chunks) and Automation (the registry) stay
populated — if one of *those* empties, something is wrong.

**V4 — charts that refuse to draw.** Overview's stage mix at one scored lead,
Inventory's ageing bar at one unsold unit, Team's workload chart with one
carrier, Deals' month chart at one deal, Finance's averages with one customer,
Team's within-SLA percentage at one measured lead — all deliberately withdrawn
with a sentence in their place. A missing chart with an explanation under it is
the intended rendering, not a failed one.

**V5 — Competitors empty.** Zero rows is the screen's ordinary state until P2
lands. Overview drops the whole `undercut` category and says so. J5/J6/J7's
competitor checks are **blocked**, not failed.

**V6 — the Overview badge changing when you navigate.** `badges.js` sets a
floor; Overview refines it upward with the KYC archive gaps the view cannot see.
Two writers, one direction, documented in both files.

## Checked and found safe

These are the places an empty table would normally break a dashboard, and each
one is already guarded — worth knowing so time is not spent re-checking them:
`deals.js` `resolveColumns()` explicitly refuses to report "purchase_history has
no amount column" when the real cause is no rows; `inventory.js` `columnsOf()`
is only consulted where rows exist; `settings.js` guards the `rag_documents`
probe with `if (!probe.length)` before `Object.keys(probe[0])`;
`conversations.js` and `customers.js` guard their auto-open-the-first-row calls;
`lib/unit-form.js` `nextStockId()` falls back to `NX-1001` on an empty lot; every
`Math.max(...)`, `reduce()` without an initial value, and `n / total` in the
fourteen screens is behind a length or truthiness check. `lib/ui.js` `table()`
renders the caller's empty state rather than an empty `<tbody>`.
