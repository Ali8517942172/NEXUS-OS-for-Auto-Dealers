# NEXUS SYSTEM TRUTH — specification

**Written 8 September 2026. Nothing in this document is built.** No migration is
applied, no function is created, no file under `apps/` is added. Every number
below was read from production (`dsvuoovivysszdoiorch`) read-only on the day of
writing, with the query that produced it printed beside it. Everything that
proposes rather than measures is marked PROPOSED.

The owner's sentence for this screen is *"this will save you massive debugging
time once real traffic starts."* That is the whole design constraint. A screen
that flatters saves no debugging time; it costs it, because it sends the reader
looking in the wrong place. So the hard part of this specification is not
layout. It is the list of metrics that **cannot be computed today**, and the
list of plausible-looking queries that would make each one a lie.

---

## 0. Which plane this belongs to, and who may never see it

`CONTROL-PLANE.md` §2.1 puts operational health, usage events and error events
in the **Control Plane** — the vendor's world, where one dealership is a row.
This screen is entirely in that column. Three consequences, and they are
structural, not stylistic:

1. **It may aggregate across dealerships.** That is the point: "is source
   ingestion working" is a question about NEXUS, not about Tenant A.
2. **A dealership must never reach it.** Not "is not linked from their nav" —
   not reachable. The dealer bundle is served to the dealership's own browser;
   a screen inside it is one nav id and one `import` away from being rendered.
   So this is a **separate application** (§5), behind a separate credential,
   never built into `apps/executive-dashboard/dist`.
3. **It does not use `lib/vocabulary.js`.** That module exists to keep supplier
   names off a *dealer's* screen. This screen is the vendor's, and the supplier
   name is frequently the whole finding — "the second WAHA host" is not a
   sentence that survives redaction. Importing it here would delete the
   information the screen exists to carry.

`CONTROL-PLANE.md` §2.3 also says control-plane *tables* must not be created in
`dsvuoovivysszdoiorch`. This specification creates none. It proposes read
accessors over data-plane tables that already exist, which is a different act:
the vendor reading the machine he runs, not the vendor filing commercial records
next to a dealership's customers.

---

## 1. What was on production when this was measured

Read 8 September 2026. This is the context every number below sits in, and
without it the numbers are unreadable.

```sql
select count(*) from public.tenants where status = 'active' and not is_quarantine;  -- 1
```

| fact | value |
|---|---|
| active dealerships | **1** — `alba-cars` |
| quarantine tenant | `__unattributed__`, `status = 'quarantine'`, holds 20 `audit_log` rows |
| `lead_event` rows | **1** |
| `leads` rows | **5** |
| `communication_logs` rows | **142** |
| `processed_messages` rows | **41** |
| `purchase_history` rows | **1** (AED 585,000) |
| `channel_message_events`, `whatsapp_delivery_events`, `channel_send_directive`, `finance_quotes`, `lead_recovery_actions`, `whatsapp_message_usage` | **0 rows each** |
| `audit_log` rows | **881**, newest `2026-09-08 17:25:56Z` |

**One active dealership means every cross-tenant claim in this document is
untested.** The queries carry a tenant predicate that is correct at fifty
dealerships; today it happens to select one. That is a design that has not been
exercised, not a design that has been proven. It is in "Unknowns".

---

## 2. The metric table

One row per metric the owner sketched. Columns:

- **State** — `MEASURED` (the query returns a number that means what the label
  says), `PARTIAL` (a number exists but does not cover the metric), `UNKNOWN`
  (the mechanism exists and every input is absent — *not* zero), `NOT
  COMPUTABLE` (nothing in the schema can express it).
- **Today** — what the query in §3 returns right now on production.
- **What is missing** — the specific column, table, writer or distinction.
- **The plausible lie** — the wrong computation that would look right. This
  column is the reason the document exists.

### Panel 1 — Sources

| # | Metric | State | Today | What is missing | The plausible lie |
|---|---|---|---|---|---|
| S1 | Received | **MEASURED** | **1** | — | `count(*) from leads`. Returns **5**, and four of those five never arrived through any door NEXUS records — they were written by a workflow. Counting rows in the destination table and calling it "received" is exactly the mistake `leads.source` already made. |
| S2 | Authenticated | **MEASURED** | **0** | — | `count(*) where origin_verified is not null`. Returns **1**, because `operator_recorded` is a value. The column is never null; it is the *kind* of proof that matters. `lead_provenance_kind.is_externally_attested` is the flag; `counts_as_real` is a different question (`leadingest_06` split them precisely so a walk-in could be real and unattested at once) and using it here reports a salesperson's word as authentication. |
| S3 | Normalized | **MEASURED** | **1** | — | Treating `phase = 'HYDRATED'` as normalized. Hydration is the second provider hop (Meta, inbound email); Google and walk-in never hydrate and would count as zero while being fully normalized. `normalized is not null` is the fact. |
| S4 | Promoted | **MEASURED** | **1** | — | `count(*) where lead_id is not null`. Identical today by constraint (`lead_event_promotion_is_symmetric`), and it is the *constraint* that makes it true, not the data. If the constraint is ever relaxed the two diverge silently. Read `phase`. |
| S5 | Held | **NOT COMPUTABLE** | — | **There is no HELD phase.** `lead_event_phase` allows exactly `RECEIVED, HYDRATED, PROMOTED, DUPLICATE, REJECTED, QUARANTINED, EXPIRED`. "Held" is a decision to pause an arrival pending review; nothing in the schema records a decision to pause, nobody who paused it, and no reason. The nearest measurable thing is "non-terminal and not promoted", which is **0** today, and that is a *different fact*: it means "in flight", including an arrival that is 40 ms old. | Rendering the non-terminal count under the word "Held". A queue depth of 0 and a review queue of 0 are opposite findings — the first says the pipeline is idle, the second says nothing is waiting on a human. Today the pipeline has processed one event ever, and calling that "0 held" would report a healthy review queue that does not exist. |
| S6 | Quarantined | **MEASURED, and ambiguous** | **0** | The word means three unrelated things in this database and the screen must pick one and name it. `lead_event.phase = 'QUARANTINED'` = 0. `tenants.is_quarantine` — unattributable traffic filed under `__unattributed__`, **20 `audit_log` rows**. `communication_logs.evidence_state = 'QUARANTINED'` — messages whose evidence was withdrawn, **6 rows**. | Adding them, or rendering any one of them under a bare label "Quarantined". Three numbers that mean "an arrival was refused", "traffic could not be attributed to a dealership at all" and "a message's evidence was retracted after the fact" are not the same counter, and a single tile is how they become one. |
| S7 | Failed | **PARTIAL** | **0** rejected, **0** hydration errors | **The failures that matter happen before the database.** There is no HTTP receiver for any lead source (`LEAD-INGESTION.md`: "No HTTP endpoint exists yet"), so an arrival that is refused at the edge — bad signature, rate limit, malformed body, unregistered endpoint — leaves **no row anywhere**. `nexus_record_lead_event` raises `NX001` on refusal, and a raise writes nothing. A refused write is invisible to every query in this file. | Reporting `0` under "Failed" and letting the reader conclude nothing has failed. What `0` actually means is "nothing that failed was ever recorded", and the two readings are opposite. This metric must render as `0 recorded · arrivals refused before the database are not counted`, permanently, until a refusal ledger exists. |
| S8 | Unlinked | **MEASURED, two readings** | **4** leads with no arrival; **0** promotions with no lead | The interesting direction is not the one the schema protects. `promoted with no lead_id` is **0** and cannot be otherwise — a CHECK forbids it. The direction that is real is `leads` with no `lead_event`: **4 of 5**, every one carrying `source = 'nexus-master-router'`, the name of the workflow that wrote it. | Quoting the protected direction. "0 unlinked" is true, meaningless, and reassuring — a number that a database constraint guarantees is not a measurement of the system. The honest tile shows both, and shows the guaranteed one as guaranteed. |

### Panel 2 — AI

This panel is almost entirely uncomputable, and that is the most useful thing
this document can say about it.

| # | Metric | State | Today | What is missing | The plausible lie |
|---|---|---|---|---|---|
| A1 | classified | **PARTIAL** | **4** leads carry `ai_score`; **11** `audit_log` rows carry an `intent` | Neither is a count of classifications. `leads.ai_score` is a *current value on a row* — it has no timestamp, no history and no writer column, so a lead scored five times counts once and a lead rescored yesterday is indistinguishable from one scored in August. `audit_log.intent` is a run summary, and 870 of 881 audit rows carry none. | Publishing `count(*) where ai_score is not null` as "classifications today". It is a stock, not a flow, and dividing it by a time window produces a rate that no event ever had. |
| A2 | accepted | **NOT COMPUTABLE** | — | **No table records a decision about a classification.** There is no accept/reject event, no reviewer, no timestamp. `leads.status` (`HOT/WARM/COLD/DISQUALIFIED/new`) is the *outcome* of routing, not a human's verdict on the AI. | Reading `status = ai-implied intent` as "accepted". It measures whether two derived fields agree with each other, which they will, because one was computed from the other. That is a tautology rendered as an accuracy figure. |
| A3 | held | **NOT COMPUTABLE** | — | Same absence as S5, one layer up: no review queue, no hold reason, no holder. | Counting `status = 'new'`. A lead nobody has touched yet is not a classification a human paused. |
| A4 | manual override | **NOT COMPUTABLE** | — | `leads.ai_score` has **no column grant to any dealership role** (`ops/evidence/v1-closure-rbac.md`: any role writing it is refused `42501`), so a dealership cannot override it at all today; and if that changed tomorrow, the column has no history and no writer, so an override would overwrite the evidence that an override happened. `lead_owner_events` records reassignment of *ownership* and holds **0 rows**; it is not about the score. | Comparing `ai_score` against a threshold and calling disagreement an override. Nobody disagreed; a constant was chosen. |
| A5 | false positive | **NOT COMPUTABLE** | — | **There is no ground truth.** A false positive requires a labelled outcome — this lead was scored HOT and was not. The only outcome NEXUS holds is a sale, and there is **one sale in the database**. One labelled outcome cannot support a rate. | Using `status = 'DISQUALIFIED'` as the negative label. Two of the three original leads were auto-created in error and quarantined as DISQUALIFIED (`attribution_event_type.LEAD_CREATED`); they are *ingestion* defects, not classifier mistakes, and counting them as false positives blames the model for a bug in the plumbing. |
| A6 | false negative | **NOT COMPUTABLE, and structurally so** | — | A false negative is a lead NEXUS scored COLD that converted — **or a lead NEXUS never saw at all**. The second half is unreachable by construction: the system cannot count what did not arrive. Even with perfect labelling, this metric is bounded above by ingestion coverage, and ingestion coverage today is 1 arrival for 5 leads. | Reporting a false-negative rate computed only over leads NEXUS holds. It answers a narrower question than the words on the tile, and it gets *better* every time ingestion misses a lead. A metric that improves when the system loses data must not be on this screen. |

### Panel 3 — Messaging

Two counters cover different windows. `processed_messages` begins
`2026-09-01 10:26:44Z`; `communication_logs` begins `2026-08-25 05:04:15Z`.
Every figure below is therefore given twice — all-time, and over the aligned
window that starts at the later of the two.

| # | Metric | State | Today | What is missing | The plausible lie |
|---|---|---|---|---|---|
| M1 | received | **MEASURED** | **41** all-time · **36** aligned 7d · **11** distinct chats | — | Counting n8n executions. Before 6 September two WAHA hosts posted every message, so the execution list is roughly **double** the truth (`CLAUDE.md`, "Two WAHA instances"). `processed_messages` absorbed the doubling because the claim is idempotent, which is precisely why it — and not the transport — is the arrival counter. |
| M2 | logged | **MEASURED** | **109** inbound / **28** outbound all-time · **31** / **9** aligned | — | Comparing M1 and M2 across their natural ranges: 41 received against 109 logged reads as "more logged than arrived", which is impossible and is purely the window mismatch. The screen must align the window or refuse the comparison. |
| M3 | *received → logged drop-off* | **MEASURED** | **36 − 31 = 5** | — | **This is the highest-value cell on the screen** and it is also the easiest to get wrong. Joining `processed_messages.chat_id` to `communication_logs.lead_email` directly yields a gap of **29**, because one person's messages are filed under up to four key shapes as their record matures. Resolving through `whatsapp_contacts` and the `@whatsapp.lead` forms yields **5**, which matches `ops/whatsapp-lead-capture/SPEC.md` §1.1. A naive join overstates the defect by 6×, and an overstated defect is discredited the first time someone checks it. |
| M4 | replied | **PARTIAL** | **23** outbound marked `sent_by = 'bot'`; **5** outbound with `sent_by` null | `sent_by` is not constrained and is null on 5 of 28 outbound rows. There is no per-message link between an inbound message and the reply to it, so "replied" means "an outbound row exists in this thread", never "this message was answered". | Rendering 28 as "replies". Five of them assert nothing about who sent them, and `system/outbound` rows (3) are the dealership writing *about* a conversation rather than inside it — `attribution_event_type.MESSAGE_SENT` already excludes them and this panel must too. |
| M5 | delivered | **NOT COMPUTABLE** | **0 rows** | `whatsapp_delivery_events` is empty and the current transport does not produce receipts that reach it. Delivery is a Cloud API fact (`statuses[]`), and `channel_message_events` — where a Cloud message would land — is also empty. | Rendering `0` as a delivery count. `0 delivered` and `no delivery evidence exists` are opposite operational findings, and the second is the true one. This must render as `NO RECEIPTS ON FILE`, with the reason. |
| M6 | failed | **NOT COMPUTABLE** | **0 rows** | `channel_send_directive` — the table holding `send_result` (`ACCEPTED_BY_PROVIDER / REJECTED_BY_PROVIDER / TRANSPORT_ERROR / PENDING`) — holds **0 rows**. The messaging layer is built and has never carried a message (`CLAUDE.md`, "wired, never fired"). | Substituting `v_workflow_health` failures for the WhatsApp agent (166 in 30 days) as "messages failed". A workflow run failing is not a message failing; the same run can fail after a message was delivered. |
| M7 | retrying | **NOT COMPUTABLE** | **0 rows** | `send_result = 'PENDING'` is the only retry-shaped state and its table is empty. On the inbound side, a redelivery is *absorbed* by the idempotency claim and leaves no trace that it happened — `processed_messages` records that an id was claimed once, not how many times it arrived. | Counting duplicate n8n executions as retries. Before 6 September that number was the second WAHA host, not a retry, and the two have opposite remedies. |

### Panel 4 — Revenue

Definitions are in §3. Numbers here; the vocabulary argument there.

| # | Metric | State | Today | What is missing | The plausible lie |
|---|---|---|---|---|---|
| R1 | detected | **MEASURED (occurrences, no money)** | **11** rows in `v_needs_attention` | Nothing — but it carries no monetary value, and must never be rendered in AED. | Attaching a value to a detection. There is no per-lead value input: `budget_aed` is **null on all 5 leads**. |
| R2 | estimated | **UNKNOWN, not zero** | `sum(budget_aed)` = **0 over 0 non-null rows** | Every input is absent. The mechanism exists (`v_lead_recovery.opportunity_value_state / _basis`); the data does not. | `coalesce(sum(budget_aed), 0)` — which returns **0** and is indistinguishable on a tile from "this pipeline is worth nothing". `UNKNOWN ≠ ZERO` exists as a house rule because of exactly this expression. |
| R3 | attributed | **0, and honestly 0** | **AED 0** | The one sale (lead 38) has **no `lead_event`**, so its origin was never recorded. `attribution_edge_type.CAMPAIGN_TO_LEAD` is `ABSENT_NO_TABLE`: there is no campaigns table, no utm, no click id. "Which channel made me money" cannot be answered at any confidence. | Reading `leads.source` as the channel. It holds `nexus-master-router` on 4 of 5 rows — the name of the writer. A pie chart of that column is a chart of one internal workflow's name, presented as marketing attribution. |
| R4 | influenced | **MEASURED, weakest admissible basis** | **AED 585,000** on **1** sale — lead 38 resolves to **22** messages | The touch is not timestamped against the sale in the query as written, and `LEAD_TO_CONVERSATION` is `PRESENT_RESOLVED` — real *by rule*, not by key: the identity rule resolves 53 of 108 rows, and unresolved is UNKNOWN, not "no conversation". | Presenting the same AED 585,000 under both "influenced" and "attributed" tiles. It is one sale. Two words for one number, side by side, doubles it in the reader's head — and this is the specific pattern the owner's `detected ≠ estimated ≠ attributed` rule exists to stop. |
| R5 | confirmed | **MEASURED** | **AED 585,000**, 1 sale | — | Presenting it as gross profit. `attribution_edge_type.DEAL_TO_MARGIN` is `BLOCKED_BY_UPSTREAM`: cost sits on the inventory unit, `purchase_history` holds no unit reference, so NEXUS can say what the dealership sold for and **cannot** say what it made. The sale reads "Lexus LX 600 2024" at exactly unit NX-1011's list price and NX-1011 is still marked available — the text matches perfectly and proves nothing. |
| R6 | recovered | **0 proven — verified** | **AED 0**, from **0** recovery actions and **0** attributed inventory actions | `lead_recovery_actions` holds **0 rows**, so `recovered_value_aed` has never been written. `inventory_actions` holds 3, **0** with `outcome_state = 'ATTRIBUTED'`, so `UNIT_ACTION_TO_DEAL` — the only human-confirmable link — has never been exercised on live data. `lead_recovery_states.RECOVERED` means a *recovered lead*, not revenue recovered by NEXUS, and `v_lead_recovery.recovery_attribution_state` answers `SALE_WITHOUT_RECOVERY_ACTION` when no action was raised — which is the state of the one sale. | Counting the one sale as recovered because the lead reached the RECOVERED state. The lead did reach it; **no NEXUS action preceded the sale**, so nothing was recovered by NEXUS. This is the single most commercially dangerous number in the product and the repo's position — *recovered revenue is 0 proven* — is **confirmed by measurement**, not asserted. |

---

## 3. The revenue vocabulary

`detected ≠ estimated ≠ attributed ≠ influenced ≠ confirmed ≠ recovered.`
Six words, six different evidentiary standards. They are ordered by how much
must be true before the word may be used.

### detected
**Definition.** NEXUS noticed a situation. An occurrence, never an amount.
**Evidence required.** A row in a state view, with the basis it was derived
from. Nothing about money.
```sql
select count(*) from public.v_needs_attention;                       -- 11
```
**Producible today: yes**, as a count. Never in AED.

### estimated
**Definition.** A monetary figure NEXUS computed from a stated input, where the
input is not a transaction. A budget the customer named; a list price.
**Evidence required.** The input value present, the basis named, and the word
"estimated" attached to it wherever it is rendered.
```sql
select count(*) filter (where budget_aed is not null) as inputs_present,
       sum(budget_aed)                                as estimated_aed
  from public.leads
 where tenant_id in (select public.nexus_active_dealership_ids());
-- inputs_present 0 · estimated_aed NULL
```
**Producible today: no.** Zero inputs. The correct render is `UNKNOWN — no
budget recorded on any lead`, and `coalesce(..., 0)` is forbidden here.

### attributed
**Definition.** A **confirmed** sale connected to a specific NEXUS-recorded
cause by an unbroken chain of keys.
**Evidence required.** A `purchase_history` row with `lead_id`, and that lead
traceable back to a recorded arrival — which today means a `lead_event`.
```sql
select coalesce(sum(p.amount_aed), 0) as attributed_aed
  from public.purchase_history p
  join public.lead_event e on e.lead_id = p.lead_id and e.tenant_id = p.tenant_id
 where p.tenant_id in (select public.nexus_active_dealership_ids());
-- 0
```
**Producible today: no.** The chain breaks at the first hop. The one sale's lead
has no arrival record.

### influenced
**Definition.** A confirmed sale where NEXUS demonstrably touched the customer,
without a claim that the touch caused the sale.
**Evidence required.** A confirmed sale, a lead link, and at least one message
resolving to that lead by the identity rule — and the basis stated, because the
identity rule is a *rule*, not a foreign key.
```sql
select p.id, p.amount_aed,
       (select count(*) from public.communication_logs c
         where c.tenant_id = p.tenant_id
           and c.lead_email in (select email from public.leads where id = p.lead_id)) as touches
  from public.purchase_history p
 where p.tenant_id in (select public.nexus_active_dealership_ids());
-- 1 row · AED 585,000 · 22 touches
```
**Producible today: yes, with one row and a stated basis.** It must never appear
on the same screen as `attributed` showing the same amount without both being
labelled and the overlap stated.

### confirmed
**Definition.** Money the dealership recorded receiving. Revenue, not profit.
**Evidence required.** A `purchase_history` row with an amount. There is no edge
to break — `DEAL_TO_REVENUE` is `PRESENT_SAME_ROW`.
```sql
select count(*) as sales, coalesce(sum(amount_aed), 0) as confirmed_aed
  from public.purchase_history
 where tenant_id in (select public.nexus_active_dealership_ids());
-- 1 · 585000
```
**Producible today: yes.** The only revenue word that is fully producible.
One caveat that belongs on the tile: `attribution_event_type.DEAL_CREATED` is
`PRESENT_CONFLATED` — `purchase_history` only ever records a closed-won deal, so
created and confirmed are the same row and the part of the funnel where deals
are *lost* is invisible.

### recovered
**Definition.** A confirmed sale that would not have happened without a NEXUS
action. The strongest claim the product makes.
**Evidence required, all four:** (1) an action raised by NEXUS, (2) **before**
the sale, (3) executed, and (4) an outcome recorded against that action by a
named person.
```sql
select (select count(*) from public.lead_recovery_actions
         where tenant_id in (select public.nexus_active_dealership_ids()))               as actions,
       (select coalesce(sum(recovered_value_aed), 0) from public.lead_recovery_actions
         where outcome_state = 'ATTRIBUTED'
           and tenant_id in (select public.nexus_active_dealership_ids()))               as recovered_aed,
       (select count(*) from public.inventory_actions
         where outcome_state = 'ATTRIBUTED'
           and tenant_id in (select public.nexus_active_dealership_ids()))               as unit_actions_attributed;
-- actions 0 · recovered_aed 0 · unit_actions_attributed 0
```
**Producible today: no. Recovered revenue is 0 proven, and this document
verifies it rather than repeating it.** Not one action of either family has ever
carried an attributed outcome on production. The tile reads `0 proven`, with the
count of actions raised (0) beside it, so that "0 proven" is visibly a statement
about evidence and not about the dealership's performance.

### Summary — which of the six NEXUS can produce at all

| word | producible today | what it returns |
|---|---|---|
| detected | **yes** | 11 occurrences, no money |
| estimated | **no** | UNKNOWN — 0 inputs present |
| attributed | **no** | AED 0, chain broken at arrival |
| influenced | **yes, 1 row** | AED 585,000, basis: resolved identity |
| confirmed | **yes** | AED 585,000, 1 sale |
| recovered | **no** | 0 proven, 0 actions ever raised |

### The two other rules, stated as screen behaviour

- **`NOT RUN ≠ PASS`.** A panel whose query did not execute — no credential,
  timeout, permission refused — renders `NOT RUN` with the reason, and the
  screen's overall header cannot read healthy while any panel is NOT RUN. This
  mirrors `QUALITY_GATE.mjs`, where `NOTRUN()` is a distinct record state from
  `PASS()` and a P0 in that state does not produce exit 0.
- **`UNKNOWN ≠ ZERO`.** Enforced in code by §4's `cell()`, which takes a
  `state` and refuses to print a numeral unless the state is `MEASURED`.

---

## 4. Design rules, and how each is enforced in code

Intent is not enforcement. Each rule below names the object that makes it
impossible to break and the gate check that fails when it is.

### Rule 1 — a metric with no data renders as a stated unknown, never `0`

**Mechanism.** There is exactly one function that turns a number into DOM:

```
cell({ metric, state, value, as_of, drilldown })   // lib/cell.js
```

`state` comes from the database, not from JavaScript. If `state !== 'MEASURED'`
the function renders the state word and the manifest's `reason` string and
**never** touches `value`. There is no second path: `screens/*.js` in this app
receive rows and pass them to `cell()`; they do not interpolate values into
template literals.

**Gate check `T1` (`OFFLINE · source`).** Parse every file under
`apps/truth-dashboard/screens/`; fail on any template literal that interpolates
an identifier matching `/(_aed|_count|received|logged|promoted|confirmed)$/`
outside a `cell(` call. This is the same technique `QUALITY_GATE.mjs` already
uses at its "would render as nothing" check — a source-level scan, no database
needed, so it can never be NOT RUN.

**Gate check `T2` (`OFFLINE · rendered`).** Serve every panel a stub row where
every `*_state` is `NOT_COMPUTABLE` and every value is `0`. Assert the rendered
DOM contains **no** `0` inside a `.num` node. A screen that prints a zero it was
handed fails here whatever the source scan said.

### Rule 2 — a funnel shows its drop-offs, not only its top and bottom

**Mechanism.** `funnel(stages)` in `lib/funnel.js` throws on fewer than three
stages, and renders the **delta** between each adjacent pair as its own element
with its own label. Where two adjacent stages are not both `MEASURED`, it
renders a **broken link** carrying the reason instead of a number — it does not
skip to the next measurable pair, because skipping produces a shorter funnel
that looks complete.

**Gate check `T3`.** Render the Sources panel against a stub where the middle
stage (`normalized`) is `NOT_COMPUTABLE`. Assert the DOM contains a broken-link
element and that no arrow connects `authenticated` directly to `promoted`.

Applied to today's data, the Sources funnel reads
`received 1 → authenticated 0 → normalized 1 → promoted 1`, and the drop from 1
to 0 to 1 is the finding: the one arrival NEXUS holds was never externally
attested. A top-and-bottom funnel would have shown `1 → 1` and said nothing.

### Rule 3 — every number is clickable to the rows behind it, or it is not on the screen

**Mechanism.** `cell()` requires a `drilldown` object — `{ relation,
predicate }` — and throws when it is absent. The drilldown route re-runs **the
same predicate** against the same accessor and renders the rows. The headline
and the row list are therefore two evaluations of one expression, and a
disagreement between them is visible rather than argued about.

**Gate check `T4`.** After rendering each panel, assert every `.num` node
carries a non-empty `data-drill`. Then, for each, follow it and assert the
returned row count equals the rendered value wherever `state = 'MEASURED'`.

**Consequence, accepted deliberately.** Four of the six AI metrics have no rows
behind them, so under this rule they cannot be rendered as numbers at all. They
appear as named absences with the reason — which is the correct shape for them,
and is why the rule is worth its cost.

### Rule 4 — a stale figure shows its age

**Mechanism.** Every accessor in §5 returns `computed_at` and, per metric, the
`as_of` of the newest row it counted. `cell()` requires `as_of` and always
renders the age. Above a per-metric `stale_after` interval taken from the
manifest, the age **replaces** the value.

**Gate check `T5`.** Render with the clock advanced past every `stale_after`;
assert no `.num` node shows a numeral and every cell shows an age.

Measured ages on production at the time of writing, which is what this rule
would have surfaced:

```sql
select 'lead_event' r, max(received_at) from public.lead_event
union all select 'communication_logs', max(created_at) from public.communication_logs
union all select 'processed_messages', max(processed_at) from public.processed_messages
union all select 'audit_log', max(logged_at) from public.audit_log
union all select 'purchase_history', max(created_at) from public.purchase_history;
```

| relation | newest row |
|---|---|
| `audit_log` | 2026-09-08 17:25:56Z |
| `communication_logs` | 2026-09-08 17:25:55Z |
| `processed_messages` | 2026-09-08 17:24:34Z |
| `leads` | 2026-09-07 14:05:16Z |
| `lead_event` | **2026-09-07 09:41:38Z** |
| `purchase_history` | **2026-09-02 09:59:53Z** |

The Sources panel is a day and a half stale and the Revenue panel is six days
stale, while Messaging is minutes old. Rendered without ages, the four panels
read as one snapshot of one moment. They are not.

---

## 5. The data layer — PROPOSED

These are cross-tenant vendor reads. They run as `service_role`.

### 5.1 The trap this section exists to avoid

`nexus_scoped_tenant_id()` returns the single active dealership **only while
exactly one is active**; at two it returns NULL, deliberately — silent rather
than wrong. `nexus_tenancy_readiness()` already names the five consumers that go
quiet when that happens (the Customer 360 nightly batch,
`v_customer_directory`, `v_inventory_sales`, the 2-argument
`search_rag_documents`, and the 2-argument identity helpers), and states the
non-fix: widening the resolver to pick a dealership when the caller named none
turns silence into cross-tenant reads.

**No accessor in this section calls `nexus_scoped_tenant_id()`.** Every one of
them scopes with:

```sql
where tenant_id in (select public.nexus_active_dealership_ids())
```

which is `SECURITY DEFINER`, `service_role`-granted, excludes the quarantine
tenant, and is correct at one, two and fifty dealerships. Every accessor also
**groups by `tenant_id`** and returns one row per dealership. It never returns a
bare cross-tenant total: a total is a sum of visible rows, computed in the
frontend from rows the reader can see, not a query with the tenant predicate
left off — which would silently include `__unattributed__` and its 20 audit
rows.

### 5.2 The accessors

All six: `LANGUAGE sql`, `STABLE`, **`SECURITY INVOKER`** (i.e. *not* `SECURITY
DEFINER`), `SET search_path TO public, pg_catalog`.

**Why not `SECURITY DEFINER`.** Two of this repo's worst findings were definer
functions that could be borrowed — the KYC helper that answered a question RLS
had just refused, and `nexus_public_exposure_report`, executable by every
signed-in dealership user for three days because the revoke never named
`public`. An invoker function granted only to `service_role`, reading tables on
which `authenticated` holds no `SELECT` (`lead_event`, `processed_messages`,
`workflow_registry` are all `service_role`-only at table level), is refused
**twice** if the grant ever leaks. There is no read here that requires definer
rights, so taking them would buy nothing and cost the second lock.

| function | arguments | returns | definer? |
|---|---|---|---|
| `nexus_truth_source_funnel` | `p_since timestamptz default null`, `p_environment text default 'production'` | `table (tenant_id uuid, dealership text, received bigint, authenticated bigint, normalized bigint, promoted bigint, non_terminal bigint, quarantined bigint, rejected bigint, expired bigint, duplicate bigint, hydration_failed bigint, leads_without_arrival bigint, newest_arrival_at timestamptz, computed_at timestamptz)` | no |
| `nexus_truth_messaging` | `p_since timestamptz default null` | `table (tenant_id uuid, dealership text, window_start timestamptz, window_is_aligned boolean, claims bigint, distinct_chats bigint, logged_inbound bigint, logged_outbound bigint, claims_without_log bigint, logs_with_provider_id bigint, replies_attributed bigint, replies_unattributed bigint, delivery_receipts bigint, sends_routed bigint, sends_failed bigint, sends_pending bigint, newest_message_at timestamptz, computed_at timestamptz)` | no |
| `nexus_truth_revenue` | `p_since timestamptz default null` | `table (tenant_id uuid, dealership text, detected_count bigint, estimated_state text, estimated_aed bigint, estimated_inputs_present bigint, attributed_aed bigint, attributed_sales bigint, influenced_aed bigint, influenced_basis text, confirmed_aed bigint, confirmed_sales bigint, recovered_aed bigint, recovered_proven bigint, recovery_actions_raised bigint, newest_sale_at timestamptz, computed_at timestamptz)` | no |
| `nexus_truth_ai` | `p_since timestamptz default null` | `table (tenant_id uuid, dealership text, metric text, state text, value bigint, reason text, computed_at timestamptz)` — **long form on purpose**: four of six rows carry `state = 'NOT_COMPUTABLE'` and a null `value`, and a wide row would have needed a column per absent metric. | no |
| `nexus_truth_freshness` | none | `table (relation text, newest_at timestamptz, age interval, computed_at timestamptz)` | no |
| `nexus_truth_manifest` | none | `table (panel text, metric text, label text, state text, reason text, drill_relation text, drill_predicate text, stale_after interval, unit text)` | no |

`nexus_truth_manifest()` is the enforcement object, not documentation. The
frontend renders the manifest and looks up values by `metric`; a metric absent
from the manifest **cannot be drawn**, and a metric whose `state` is not
`MEASURED` cannot show a numeral. Adding a tile therefore requires a migration
that states its query, its drill-down and its staleness tolerance — which is the
only way this screen stays honest after the person who wrote it moves on.

### 5.3 Grants, and the guard

Every one of the six, verbatim:

```sql
revoke all on function public.<name>(<args>) from public, anon, authenticated;
grant execute on function public.<name>(<args>) to service_role;
```

`revoke ... from public` is not optional and is the reason it is written first.
`ops/ci/function-grants.mjs` exists because `revoke from anon, authenticated`
leaves the `PUBLIC` grant intact, both roles keep reaching the function, and
`proacl` looks clean afterwards. Each migration must then assert:

```sql
do $$ begin
  if has_function_privilege('authenticated', 'public.<name>(<args>)', 'execute')
  or has_function_privilege('anon',          'public.<name>(<args>)', 'execute') then
    raise exception 'NEXUS: truth accessor % is reachable by a dealership role', '<name>';
  end if;
end $$;
```

**Does this fire `nexus_guard_born_open_grants()`? Yes — every statement does.**
The event trigger is registered `on ddl_command_end` with `evttags` NULL, so it
fires on all DDL, and its `function`/`procedure`/`aggregate` branch runs
`revoke all on function ... from anon`. Three consequences to hold:

1. It removes `anon`, and **not** the `PUBLIC` grant a function is born with.
   The explicit `revoke ... from public` above is what closes that, and the CI
   check is what stops the next author omitting it.
2. It never aborts the DDL — it swallows its own exceptions by design — so a
   migration cannot rely on it failing loudly.
3. **Nothing in this proposal runs `ALTER TABLE`.** Creating functions is safe;
   altering a live table fires the same guard and has already stripped the two
   dashboard write paths off `inventory` once this month (migration
   `20260906071310`). Adding a column to `leads` or `purchase_history` to make
   a metric computable is a bigger act than it looks, and belongs in its own
   migration with the grants restated afterwards.

No views are proposed. A view in `public` would fire
`nexus_guard_security_invoker_views` and would have to be spelled
`security_invoker` — which is correct but pointless here, because a
`security_invoker` view read by `service_role` and denied to `authenticated`
gives exactly what the functions give, with a `CREATE OR REPLACE VIEW` footgun
(reloptions reset to NULL on every replace) attached.

---

## 6. The frontend — PROPOSED

### 6.1 A separate application, following the existing conventions

`apps/executive-dashboard/` is the dealer plane: plain ES modules, no framework,
Vite build, screens self-registering into `SCREENS` from `lib/nav.js`, data
through `db`/`dbWrite` in `lib/data.js`, empty and error states through
`lib/states.js`. This screen copies those conventions and **does not join that
bundle**, for three reasons: the bundle is served to dealerships; `service_role`
cannot exist in a browser; and `CONTROL-PLANE.md` §2.3 puts the two planes in
different systems.

### 6.2 Files to add

```
apps/truth-dashboard/
  index.html
  package.json                  vite, no @supabase/supabase-js — this app holds no Supabase client
  vite.config.js
  app.js                        boot, nav, no tenant pill, no dealership switcher
  lib/env.js                    proxy base URL only; asserts at boot that no key-shaped
                                variable is present in the bundle
  lib/data.js                   truthRead(fn, args) -> POST to the proxy. One function.
  lib/manifest.js               fetches nexus_truth_manifest() once per load; every render
                                goes through it; unknown metric -> throw
  lib/cell.js                   the ONLY path from a number to the DOM (Rules 1, 3, 4)
  lib/funnel.js                 the ONLY path to a funnel (Rule 2)
  lib/age.js                    relative-age formatting, shared by cell.js
  screens/sources.js
  screens/messaging.js
  screens/revenue.js
  screens/ai.js
  screens/workflows.js          §7 — the panel the owner's sketch does not have
  screens/rows.js               the drill-down target for every data-drill
  server/index.mjs              holds SUPABASE_SERVICE_ROLE; exposes exactly the six
                                accessors by name; refuses any other body; vendor auth
  TRUTH_GATE.mjs                checks T1..T5 from §4, in the record model of
                                QUALITY_GATE.mjs (PASS / FAIL / WARN / NOT RUN, P0 blocks
                                exit 0, NOT RUN never counts as PASS)
```

`lib/vocabulary.js` is deliberately **not** in that list (§0).

No code is written here. The point of naming the files is that `cell.js`,
`funnel.js` and `manifest.js` are the three objects the rules in §4 live inside;
if a later pass merges them into the screens, the rules become conventions
again.

---

## 7. What this screen would have caught

Six defects this repo has already found, tested against the four panels as the
owner sketched them.

| defect | caught? | which panel, or what is missing |
|---|---|---|
| **`leads.source` holds the writer's name** (`nexus-master-router` on 4 of 5 rows) | **Yes** | Sources. `received 1` against `leads 5` is a two-tile contradiction, and metric **S8** states it directly: 4 leads exist with no arrival record. The funnel makes it unavoidable — leads entered the system through a door the funnel does not have. |
| **Five messages claimed and never logged** | **Yes** | Messaging, metric **M3**. The drop-off between `received 36` and `logged 31` *is* the defect. It is only visible because Rule 2 forbids a top-and-bottom funnel; `36 → 31` and `36 arrived, 31 logged, 5 lost` are the same two numbers and only one of them is a finding. |
| **Bitrix24 silent since 19 August** | **Not by the four sketched panels.** Yes, with the fifth. | None of Sources / AI / Messaging / Revenue looks at workflow runs. `v_workflow_health` already carries it — `wf_108 ERP Sync - Bitrix24`, `runs_30d 18`, `successes_30d 7`, `last_success 2026-08-19 11:04:08Z`, `health DEGRADED` — and nothing renders it to the vendor. **Add `screens/workflows.js`**: one row per registered workflow, `last_success` age foremost, plus `v_audit_unregistered_writers` (2 rows today: `Inventory Action Center`, deliberate; `Example Workflow`, not). Under Rule 4 a 20-day-old last success is the loudest thing on the page. It would also have caught the sibling finding on the same view — `Slack Command Center`, five SUCCESS rows whose summaries all read `"Completed"`, naming nothing, last success also 19 August. |
| **The second WAHA host that had not stopped** | **No.** | The database has **no record of which host sent a message.** `processed_messages` holds `message_id, source, chat_id` — `source` is `'waha'`, the provider family, not the sender. The doubling was found in n8n execution *headers* (`x-forwarded-for`, `user-agent`, `me.jid`), which reach no table. `channel_message_events` has the right columns (`provider_account_id`, `origin_verified`, `provider`) and **0 rows**, because nothing writes it. **Extra panel needed: Ingress.** Arrivals grouped by sending identity, and a *transport-vs-ledger* comparison — n8n executions against `processed_messages` claims for the same window. On 3 September that comparison read roughly 275 against 137 and the ratio was the entire finding. It requires a writer that records the sender per arrival; today none exists. |
| **The `'+'` that will break the first Cloud message** | **Not before it happens. Yes at the moment it happens, and only by inference.** | `p_customer_phone: '+' + customer_wa_id` sends `+` prefixed to Meta's already-bare E.164 digits. The row is refused by CHECK, the insert raises, and **a refused write leaves no row in any table** — so every counter on this screen stays where it was. What the reader would see is Messaging `received` advancing while `logged` does not: metric M3 widening by one. That is a symptom, not the cause, and it points at the wrong subsystem. **Extra panel needed: Refusals.** A ledger of writer refusals — SQLSTATE, the constraint name, the function that raised, the tenant — written by the adapter when `nexus_record_lead_event` or a channel writer raises `NX001`/`23514`. This is the same hole as metric **S7**: this system currently records what it accepted and nothing about what it refused, and the refusals are where the defects are. It is the single most valuable thing missing from the owner's sketch. |
| **`nexus_scoped_tenant_id()` going NULL at the second dealership** | **No.** | Every panel here would keep reporting correctly — they use `nexus_active_dealership_ids()` — while five *other* consumers went silently empty. `nexus_tenancy_readiness()` already computes the BLOCKER and names all five. **Add it to the Workflows panel** as a platform-state strip. A screen that is immune to a defect is not a screen that detects it, and the vendor needs to see the ones that hit the dealer plane. |

Two more, for completeness, since both are the same shape:

- **`anon` reading 8,500 rows through a born-open grant.** Not caught — no panel
  looks at grants. `nexus_public_exposure_report(boolean)` exists and produces
  exactly this. It belongs on the Workflows/platform strip, not in a business
  panel.
- **Messaging cost rendered as zero.** Not caught, and not a risk here, because
  no cost metric is proposed: `whatsapp_message_usage` has **zero numeric
  columns** by design and holds 0 rows. Any future cost tile must inherit `R2`'s
  treatment — UNKNOWN, never 0.

---

## Unknowns

1. **Every cross-tenant claim in this document is untested.** One dealership is
   active. The accessors group by `tenant_id` and scope with
   `nexus_active_dealership_ids()`, which is the shape that survives two — but
   the shape has not been run against two on production, and the only proof
   offered here is that it does not call the resolver that is known to go NULL.
2. **The Messaging window alignment is asserted, not exercised.**
   `window_is_aligned` is proposed; today the misalignment is real (41 claims vs
   109 logged over different ranges) and nothing has yet computed the aligned
   figure automatically. The 36/31/5 figures in this document were computed by
   hand, in the query printed at M3.
3. **The identity rule behind M3 and R4 is a rule, not a key.** It resolves 53
   of 108 `communication_logs` rows. Whether the 5-message gap is stable under a
   different resolution of the remaining 55 has not been established.
4. **Nothing here has been run against traffic.** `lead_event` holds one row and
   it is a walk-in; the four ingestion sources have no HTTP receiver; the
   messaging layer has never carried a message. Every Sources and Messaging
   figure is a measurement of a system that is not yet doing the thing the panel
   is about. The screen's behaviour under load — a thousand arrivals, a
   half-hydrated Meta batch, a provider outage mid-window — is unknown.
5. **The staleness thresholds are not chosen.** `stale_after` is in the manifest
   because it must be per-metric; no values are proposed, because choosing them
   without traffic would be inventing a normal. Today's ages (lead_event 1.3
   days, purchase_history 6 days) are the state of a quiet system, not a
   baseline.
6. **The Refusals ledger and the Ingress panel are described, not designed.**
   Both need a writer that does not exist, and both touch the ingestion path,
   which is the part of NEXUS with the least production evidence behind it.
7. **Whether `service_role` is the right credential for the proxy at all.** It
   is `BYPASSRLS`, and `CONTROL-PLANE.md` §2.4 warns that the moment a support
   screen renders a customer's name beside a project reference, the control
   plane has become a console into the dealership's business. Every accessor
   here returns **counts and states, never customer rows** — but `screens/rows.js`
   is a drill-down, and a drill-down into `communication_logs` shows message
   text. That boundary is stated and not solved. A narrower vendor role, or a
   drill-down that returns row *identifiers* and timestamps only, are the two
   candidates and neither has been decided.
