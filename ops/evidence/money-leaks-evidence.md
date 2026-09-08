# Today's Money Leaks — evidence

Screen: `apps/executive-dashboard/screens/money-leaks.js`, nav id `moneyleaks`.
Branch `wip/platform-truth-2026-09-01`. All measurements taken **6 September 2026**
against production `dsvuoovivysszdoiorch`, read-only. No row was written to any
database. No migration was applied. The n8n box was not touched.

**Reading caveat on every number below.** They were read through the Supabase MCP
SQL channel, which connects as a privileged role, not as a signed-in dealership
session. ALBA is the only active dealership on this project today, so the row
sets are the same; at two dealerships they would not be, and this file should be
re-taken as a dealership user before it is quoted at anyone.

---

## 1. What each engine can honestly say today, measured

### Inventory Profit Sentinel — `v_inventory_profit_sentinel`, 12 rows
The strongest engine in the product, and the only one that can put a number on
anything today.

| measured | value |
|---|---|
| units | **12**, all `Available` |
| `cost_aed` and `price_aed` present | **12 / 12** |
| `days_in_stock` present | **12 / 12** |
| recommendation ≠ HOLD | **3** (NX-1010 SEVERE, NX-1004 HIGH, NX-1008 HIGH) |
| recommendation = HOLD | **9** |
| `impact_kind = MARGIN_EXPOSED` | **3**, totalling **AED 82,000** |
| `holding_cost_state = COMPUTED` | **0 / 12** — `inventory_profit_settings.holding_cost_per_day_aed` is NULL |
| `net_margin_state = COMPUTED` | **0 / 12** — follows from the line above |
| `market_position LIKE 'UNKNOWN%'` | **12 / 12** |
| `enquiry_coverage = SUFFICIENT` | **0 / 12** |
| `settings_are_defaults` | **false** — the dealership has set its own ageing bands (warn 90 / critical 120, min reprice margin 8.00%) |

The three flagged units:

| unit | model | days | cost | price | gross margin | risk | rec |
|---|---|---|---|---|---|---|---|
| NX-1010 | Range Rover Sport HSE 2023 | 153 | 352,000 | 395,000 | **43,000** | SEVERE | REPRICE |
| NX-1008 | Ford Explorer Platinum 2023 | 112 | 155,000 | 178,000 | **23,000** | HIGH | REPRICE |
| NX-1004 | Mitsubishi Pajero GLS 2023 | 118 | 112,000 | 128,000 | **16,000** | HIGH | REPRICE |

Every one of them carries the engine's own words on the figure, quoted verbatim
on the screen: *"EXPOSURE — AED 43,000 of gross margin (list minus acquisition
cost) sits in a unit that has not sold in 153 days. This is the amount AT RISK.
It is not expected loss, not attributed revenue and not recovered revenue."*

### The action lane — `v_inventory_action_queue` (3 rows), `v_action_center_health` (1 row)

| measured | value |
|---|---|
| action records | **3** |
| `APPROVED` and `executed_at IS NULL` | **1** — NX-1010, approved 2 Sep 18:23 by Ali Asgher as `TENANT_OWNER`, assigned to the *Sales Manager role and to nobody by name*, open **4 days** |
| `EXECUTION_FAILED` | **1** — NX-1008, attempted 6 Sep 04:23 by Ali Asgher; `execution_failure` = `"jhgjgj"` |
| `REJECTED` with a reason code | **1** — NX-1004, `PRICE_IS_CORRECT`, `decision_says_engine_was_wrong = true` |
| `awaiting_decision` | **0** |
| `escalated_at` | **0** |
| `deferral_now_due` | **0** |
| live actions where `engine_still_agrees = false` | **0** (1 live action, engine re-read and still agreeing) |
| flagged units never raised at all | **0** of 3 |
| `recovered_value_aed` non-null | **0 / 3** |
| `v_action_center_health.health` | **`EXECUTIONS_FAILING`** |
| `events_without_audit` | **0** — 10 events, 8 audit rows |

### Lead Recovery — `v_lead_recovery` (3), `v_lead_recovery_coverage` (1)

| measured | value |
|---|---|
| leads | **3** — 1 open, 2 `DISQUALIFIED` |
| the open one | lead 38 "Ali", state **`RECOVERED`** — a sale is recorded against it |
| `leads_at_risk` | **0** |
| open leads with a recommended action | **0** |
| `opportunity_value_state` | **`UNKNOWN_NO_LINK` on all 3** — no lead carries a budget, nothing links a lead to a unit |
| `confirmed_revenue_aed` | **585,000** |
| `sales_attributed_to_a_recovery_action` | **0** |
| `message_events` | **112**, of which **51** resolve to a lead |
| `identity_resolution_pct` | **45.5%** |
| `unresolved_whatsapp_handles` | **9** |
| `silence_detector_state` | **`STALE`** |
| `silence_detector_last_success_at` | **2026-08-26 19:03:30 UTC — 11 days ago** |
| `silence_detector_last_run_class` | **`FAILURE`** (last run 31 Aug) |
| `settings_are_defaults` | **true** — the 5-minute first-response target is NEXUS's default, not this dealership's choice |

The engine's own `what_this_engine_cannot_tell_you`, rendered verbatim on the
screen rather than paraphrased:

> CANNOT SIZE: no lead carries a budget and nothing links a lead to a unit, so no
> opportunity value is computable — only confirmed sales. CANNOT SEE: 61 message
> events belong to WhatsApp handles that match no lead. CANNOT CONFIRM SILENCE:
> the detector state is STALE. CANNOT BOOK: there is no appointment table, so
> APPOINTMENT_PENDING is unreachable. CANNOT EXECUTE: no workflow performs a lead
> recovery action; a person does.

### Deal Rescue — `v_deal_rescue` = **0 rows**, `v_deal_rescue_readiness` = **9 rows, 0 met**
Structurally empty. `measured_now` is re-taken on every read: `public.deals` does
not exist, `public.appointments` does not exist, 0 decision-shaped columns on
`finance_quotes`, 0 unit-link columns on `purchase_history`, 2 of 3 leads
unassigned, `public.deal_rescue_actions` does not exist. The first unmet
prerequisite is `DEAL_RECORD`.

### Attribution — `v_attribution_sale_chain` = 1 sale, `v_attribution_edges` = 121
AED 585,000, `revenue_kind = CONFIRMED_REVENUE`. **4 of 8 hops evidenced**;
`first_break = CAMPAIGN`; `vehicle_state = UNKNOWN_TEXT_ONLY`;
`margin_state = NOT_COMPUTABLE`. None of it attributed to anything NEXUS did.

### Market / competitors — `v_competitor_latest` = 7 rows
**0 of 7** carry a `match_quality` this dealership accepts
(`inventory_profit_settings.accepted_market_match_quality = {exact,strong}`): 6
are `weak` or `model_only`, 1 is null. `Competitor Price Scraping` reads
`PRODUCING_NOTHING` — **205 of 228 runs in 30 days produced nothing, 10.1%**.
Three rows say so in their own `ai_recommendation`: *"NO CONCLUSION: nothing on
the page ties this price to our unit."*

### Automations — `v_workflow_health` = 18 rows
2 `HEALTHY`, 11 `DEGRADED`, 3 `NOT_INSTRUMENTED`, 1 `NEVER_RAN`, 1
`PRODUCING_NOTHING`. `Phase 6 - 12-Hour Silence Detector`: 4 runs in 30 days,
last run 31 Aug, last success 26 Aug.

---

## 2. What the screen renders today, line by line

Re-derived in SQL from the live rows using the same predicates the screen uses.

### Header strip
| tile | value today | how it is derived |
|---|---|---|
| Leaks today | **2** | count of register-1 lines |
| Gross margin behind them | **AED 66,000** | `expose()` over the two lines: `43,000 + 23,000`, one `impact_kind` (`MARGIN_EXPOSED`), *"2 of 2 included, none omitted"* |
| Checks that came back clear | **8** | register 2, computed from the same function that renders it |
| Checks that could not run | **9** | register 3, computed from the same function that renders it |

Beneath it, `EXPOSURE_CAVEAT` verbatim, plus: *"Nothing on this page adds a
customer figure to a unit figure. No enquiry in this database carries a value at
all, so the customer half of a true 'revenue at risk' does not exist at any
confidence and is not filled in."*

**The headline is a named derivation and the screen says so:** the sum of
`engine_impact_aed` over the action records in register 1, and nothing else. One
kind, one engine, two columns a dealership already trusts (`cost_aed`,
`price_aed`) plus `acquired_at`. It is not a sum of estimates.

### Register 1 — what is leaking, worst first

**Rank 1 · DECIDED_NOT_DONE · AED 43,000 · exposed · confidence HIGH**
- *What:* A decision was taken on the Range Rover Sport HSE 2023 and nothing has
  been recorded as done.
- *Why:* somebody with authority approved this and no execution has been
  recorded since. The gap between a decision and an act is the leak, not the car.
- *Evidence (7 facts, each with its source):* action `17b13c7c…` on NX-1010,
  status APPROVED · the engine's frozen reason (149 days, 10.89% margin against
  an 8.00% floor) · the engine still agrees today, at 153 days · holding cost
  `NOT_COMPUTABLE` · market position `UNKNOWN_UNVERIFIED_COMPARABLE` · approved 4
  days ago by Ali Asgher acting as `TENANT_OWNER` · assigned to the Sales Manager
  role and to nobody by name · `executed_at` is null.
- *Size:* AED 43,000, word **exposed**, with the engine's own EXPOSURE sentence.
- *Confidence:* HIGH — *"the leak itself is an approval with no execution
  recorded against it, which is two stored columns and not a judgement"*; the
  underlying recommendation is graded MEDIUM by the engine and that grading is
  quoted.
- *Action:* record that it was carried out, or withdraw it → **Open the Action
  Center**. Plus the view's own `outcome_sentence`: *"No outcome yet. This has
  been approved but not carried out, and an approval is a decision, not money."*

**Rank 2 · ATTEMPT_FAILED · AED 23,000 · exposed · confidence MEDIUM**
- *What:* Work on the Ford Explorer Platinum 2023 was attempted and did not
  happen.
- *Why:* worse than an untouched action — the decision and the attempt are both
  already spent, nothing re-raises it automatically, and it is closed so it will
  not resurface.
- *Evidence:* status `EXECUTION_FAILED`, attempted 6 Sep by Ali Asgher · **"The
  recorded failure reason is "jhgjgj", which is not a reason anybody can act
  on"** · `is_live` false, so nothing will surface it again · engine still
  agrees at 112 days · holding cost and market both unknown.
- *Confidence:* MEDIUM, and the screen says exactly why: *"The failure is stored
  and certain. Why it failed is not: the reason column holds a placeholder, so
  nothing can be said about whether it would fail again."*
- *Action:* raise it again, or record why it is being left → **Open the Action
  Center**.

Both actions route into the existing `propose / decide / execute` spine in
`screens/actions.js`. **No decision control is duplicated on this screen** — a
second approval surface would be a second authority vocabulary and a second set
of `SECURITY DEFINER` calls to keep out of `anon`'s reach, which is the same
argument `v_deal_rescue_readiness.ACTION_LANE` uses for not building one.

### Register 2 — checks that came back clear (8, each with its denominator)
1. No recommendation is sitting unanswered by a person — *3 action records, none awaiting a decision.*
2. Nothing is stuck for want of somebody able to approve it — *3 records, none escalated.*
3. No deferred decision has quietly come due again — *3 records, none past a deferral date.*
4. No live decision rests on an engine finding that has since changed — *1 live action, engine re-read on this load and still agreeing.*
5. Every unit the engine flags has been put in front of a person at least once — *3 of 12 units flagged, all 3 raised.*
6. The engine is content with the rest of the stock and recommends holding — *9 of 12 units on HOLD.*
7. No open enquiry carries a recommended recovery action — *1 open enquiry of 3 on file. Read it as a record and not as a rate — this is not lead volume.*
8. No open enquiry is recorded as having missed the first-response target — *1 open enquiry checked.*

The header tile calls `measuredClear()` with the same three arguments the panel
does, and the unmeasured tile calls `notMeasured()` with the same five, so a tile
can never report a different number from the table it introduces. An earlier
draft passed `null` for the readiness read in the tile only and counted one check
fewer than the panel below it; that is fixed and the reason is recorded in the
code.

If a source cannot be read, its checks are **absent from this list**, and a
banner names them: *"Those checks are neither clear nor failing — they are
unread, and they are not counted anywhere on this screen as clear."*

### Register 3 — checks that could not run (9 today, unknown is not zero)

| what is not measured | since / how much | why | what would light it up | kind |
|---|---|---|---|---|
| **Whether any enquiry has gone quiet on us** | detector last succeeded 26 Aug 2026 23:03 GST — 11 days ago | reads `STALE`. The state can still be computed from message timestamps, but the corroborating marker is worthless. *"Reading '0 gone quiet' as good news would be reading a stopped clock."* | Start the 12-Hour Silence Detector again. Not code, not an integration — a paused workflow, and the cheapest thing on this list | OPERATIONAL |
| How fast the exposed margin is being eaten, and net margin on any unit | 12 of 12 units; net margin reads `NOT_COMPUTABLE` | no holding rate on record for this dealership | **One number: what a day on the lot costs.** A single field on Inventory. It turns every exposure figure here into a net one | DATA |
| Whether any unit is priced above or below the market | 12 of 12, graded `UNKNOWN_UNVERIFIED_COMPARABLE` / `UNKNOWN_NO_COMPARABLE` | no competitor listing meets the accepted match quality | a feed returning a listing tied to a specific car — year, trim, condition — not a model name on a manufacturer page | INTEGRATION |
| Whether a slow unit is slow because nobody wants it or nobody has seen it | 12 of 12, `enquiry_coverage = INSUFFICIENT` | too few enquiries resolve to a unit | enquiries that name the car; arrives with volume | DATA |
| Whose conversations we are looking at | 51 of 112 message events resolve (45.5%); 9 handles match no enquiry | *"A clear result over part of the traffic is not a clear result over the traffic."* | a provider message id on every logged message and a phone number on every enquiry | SCHEMA |
| What Lead Recovery says it cannot tell you | measured on this read | the engine's own `what_this_engine_cannot_tell_you`, printed verbatim | each clause names its own blocker | ENGINE |
| Whether any deal in progress is at risk | 0 of 9 prerequisites met | this database records a sale at the moment it closes and nothing before it. *"The engine is not empty of findings; it is empty of subjects."* | `DEAL_RECORD` — a deal row created at first commitment | SCHEMA |
| Whether the automations behind these checks are running | 16 of 18 not healthy | graded through `lib/health.js`, never inspected here | fixed on the automation box. *"Until they are, some of the clear results on this screen rest on data that stopped arriving."* | OPERATIONAL |
| **Service retention, missed appointments and no-shows, and true margin after reconditioning** | **never measured, on any day** | no service table, no appointments table, no `recon_cost` column, no connection to a system that holds them | a connection to the system the dealership already keeps this in. *Sold as roadmap and never as capability* | ROADMAP |

The last row is **unconditional** — it renders whether or not any read succeeds,
because its absence is the single largest thing a dealership would assume this
product covers, and an empty bucket there would read as a clean bill of health.

### Register 4 — what this screen refuses to call a leak
The alert feed (`v_needs_attention`, 10 items today) audited item by item rather
than trusted:

| alert kind | items | verdict | why |
|---|---|---|---|
| `unanswered_chat` | 4 | **REFUSED** | Not one WhatsApp thread in this database resolves to a lead record. "A customer is waiting" is not a claim this data supports, and there is nothing to put a figure on. *Calling them a money leak would be inventing the customer.* |
| `undercut` | 3 | **REFUSED** | The inventory engine grades market position UNKNOWN on every unit, because no competitor row meets the accepted match quality. A price difference against a listing nobody can tie to our car is arithmetic, not a finding — and the competitor rows say so themselves. |
| `inventory_aging` | 1 | **ALREADY RANKED** | Same unit as register 1; named so the lists reconcile, not counted twice. |
| `workflow_failure` | 2 | **NOT A MONEY LEAK** | A failing workflow is a reason a check could not run. Reporting it as money would be the dashboard inventing an amount for its own broken plumbing. |
| any unknown kind | — | **NO RULE** | shown as the feed holds it, counted as neither leak nor clear. |

The three refused `undercut` items are the ones this matters most for: the feed
offers **"drivearabia.com is AED 90,000 cheaper"**, **"AED 30,000 cheaper"** and
**"AED 23,100 cheaper"**. Those are the three most sellable sentences on this
dataset. None of them reaches the leak register, and the reason is on screen.

Followed by: *"There is confirmed sale revenue in this database. It is not shown
on this screen as a leak, as a recovery or as anything NEXUS did"* — with a route
to Attribution.

### Register 5 — the four money words
A table of `EXPOSED` / `ESTIMATED` / `ATTRIBUTED` / `CONFIRMED`, each with what
holds it today:

- **EXPOSED** — 3 action records carry `MARGIN_EXPOSED`. The only word this
  screen totals.
- **ESTIMATED** — *"No engine in NEXUS produces an estimate, so nothing carries
  this word."* Listed on purpose: a vocabulary with no empty slots is a
  vocabulary nobody checks.
- **ATTRIBUTED** — 0. Nothing has passed the four-column evidence test.
- **CONFIRMED** — 1 recorded sale on file, **0 of them attributed to anything
  NEXUS did**. *"That distinction is the product, not a shortcoming of it."*

`recovered_value_aed` is read only through `recoveryEvidence()` imported from
`screens/actions.js`. A row carrying the amount without the four columns raises a
red fault banner using that file's `unsupportedRecoverySentence()` — it is never
rendered as money. Live today: 0 such rows, so the guard is latent.

---

## 3. Structural guarantee: a leak line cannot be rendered without its parts

`makeLeak()` is the only constructor. It checks six things — what is leaking, why
it is a leak, the rows behind it, which money word applies, how confident and
why, what to do — plus the amount/word gate. A line missing any of them renders
through `leakFault()` as a **named red fault** listing the missing part, never as
a tidy row with a blank in it.

`sizeCell()` is the single gate on money: `NOT_COMPUTABLE` may never carry a
number (it renders the state word and the basis); `EXPOSED`/`ATTRIBUTED`/
`CONFIRMED` must carry one or the cell says *"A money word without a number is a
claim this screen cannot make."* A word outside the closed set of four renders as
a fault. No caller can bypass either.

Lead-side leaks are constructed with `word: 'NOT_COMPUTABLE'` unconditionally,
because `opportunity_value_state` is `UNKNOWN_NO_LINK` on every lead — the engine
can name the leak and cannot size it, and the screen says so instead of guessing.

---

## 4. Reuse, not reinvention

- `expose()`, `exposureLine()`, `impactPhrase()` and `EXPOSURE_CAVEAT` are
  **imported from `screens/overview.js`**. They were local `const`s; four `export`
  keywords were added and a comment recording why. Nothing moved, nothing
  changed. This is the same pattern `overview.js` already uses to import
  `recoveryEvidence()` from `screens/actions.js`.
- `recoveryEvidence()` / `unsupportedRecoverySentence()` imported from
  `screens/actions.js`.
- `healthWords()` from `lib/health.js` — the sole mirror of the database's outcome
  vocabulary. This screen never inspects a run status itself (gate S10).
- `panel()` / `kpi()` / `table()` from `lib/ui.js`; `stateEmpty` from
  `lib/states.js`; every fetch through `db()` in `lib/data.js`; every error
  sentence through `lib/errors.js` via `stateError`; the `linkBtn` / `wireGo`
  "not in this build" pattern copied from `revenue.js` and `deal-rescue.js`.
- The silence-detector state is taken from `v_lead_recovery.silence_detector_state`
  rather than by matching a workflow **name**, so it cannot drift from what Lead
  Recovery says on its own screen.

## 5. Files changed

| file | change |
|---|---|
| `apps/executive-dashboard/screens/money-leaks.js` | **new** — the screen |
| `apps/executive-dashboard/lib/nav.js` | registers `moneyleaks` first in the Work group; `current` and the unknown-id fallback point at it |
| `apps/executive-dashboard/app.js` | adds the module to `import.meta.glob`; default landing `'overview'` → `'moneyleaks'` (fallback only — a hash still wins) |
| `apps/executive-dashboard/screens/overview.js` | four `export` keywords + one comment. No behaviour change |

`screens/team.js` and `QUALITY_GATE.mjs` were **not touched**. No git command was
run; everything is in the working tree.

## 6. Verification

- `node --check` on all four files — clean.
- `npm run build` with the three required env vars — **89 modules, built in 2.88s.**
- `node QUALITY_GATE.mjs` — **PASS 18 · FAIL 0 · WARN 1 · NOT RUN 17.**
  - `R1` navItems **21** matching `lib/nav.js`; `R2` **21/21** screens,
    `moneyleaks: 34,031 chars / 6 cards`, 0 page errors; `R3` 137 PostgREST
    calls, 0 rejected; `R4`, `R5`, `R6`, `R7` pass; `S1`–`S10` pass, with `S6`
    reporting `screens/money-leaks.js: holding_cost_state — every value named`
    and the same for `net_margin_state`.
  - The one WARN is `S5b` on `screens/actions.js:637`, **pre-existing** and not in
    a file this work touched.
  - The 17 NOT RUN are the entire live-database and live-render lanes, unrunnable
    because `NEXUS_DB_URL` / `NEXUS_STAGING_DB_URL` / `NEXUS_LIVE_*` are not set
    in this container. That is an environment condition, not a consequence of
    this change. **A check that could not run is not a check that passed** —
    `L6`, `L7` and `L10` in particular are the live counterparts of the honesty
    rules this screen rests on, and they have not been run against it.

## 7. Database objects this screen would have needed and does not have

None. It was built entirely against views and functions that already exist. Two
things would materially improve it and both are data, not schema:

1. **`inventory_profit_settings.holding_cost_per_day_aed`** — one number, set by
   the dealership. It turns 12 `NOT_COMPUTABLE` net margins into figures and
   turns "AED 66,000 exposed" into "AED 66,000 exposed, being eaten at AED N a
   day". This is the single cheapest unlock in the product and the screen names
   it as such.
2. **Restarting the 12-Hour Silence Detector.** Not code, not an integration — a
   paused workflow. Until it runs, the customer-side zero on this screen is
   labelled "not measured" rather than "clear", which is correct but weaker than
   it needs to be.
