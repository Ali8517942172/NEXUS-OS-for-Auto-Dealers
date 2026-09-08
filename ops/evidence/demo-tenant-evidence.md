# The demo dealership — evidence

**Built and measured 6 September 2026, on STAGING (`wwspuxrbiyagnrnzgate`)
only.** Nothing in this pass wrote a single row or statement to production
(`dsvuoovivysszdoiorch`); the only production traffic was three read-only
`SELECT`s, each recorded below with its purpose. The n8n box was not touched.
No `git` command was run. `QUALITY_GATE.mjs`, `screens/team.js`,
`screens/money-leaks.js`, `lib/nav.js` and `app.js` were read and not edited.

Deliverables:

| what | where |
|---|---|
| the runbook | `/home/claude/repo/ops/DEMO.md` |
| the seed | `/home/claude/repo/ops/demo/seed_demo_tenant.sql` |
| the teardown | `/home/claude/repo/ops/demo/teardown_demo_tenant.sql` |
| this evidence | `/home/claude/out/demo-tenant-evidence.md` |

---

## 1 · Staging before anything was created

Measured first, as instructed, so that "returned to where it started" has a
starting point.

| tenant | slug | inventory | leads | inventory_actions | audit_log | users | communication_logs |
|---|---|---|---|---|---|---|---|
| Alpha Motors (staging) | `staging-alpha` | 3 | 3 | 2 | 8 | 7 | 0 |
| Bravo Autos (staging) | `staging-bravo` | 1 | 1 | 1 | 1 | 2 | 0 |
| UNATTRIBUTED – QUARANTINE | `__unattributed__` | 0 | 0 | 0 | 0 | 0 | 0 |

Also present and left alone: the `GATE-PROBE-1788673708220` unit under Alpha
from the B1–B4 pass, nine `auth.users` rows, and every platform reference table.

**A staging-parity gap was measured at the same time and is finding 5 below:**
six platform reference tables that carry rows on production are **empty on
staging**, including the nine `deal_rescue_prerequisites` rows the Deal Rescue
screen exists to render.

---

## 2 · The dealership

**NORTHWIND MOTORS (DEMO — FICTIONAL DEALERSHIP)**, slug `demo-northwind`,
tenant `dddddddd-dddd-4ddd-8ddd-dddddddddddd`. A third active tenant beside
Alpha and Bravo.

Every row is synthetic **on the screen**, not merely in a document:

| axis | convention |
|---|---|
| dealership | name literally contains `DEMO — FICTIONAL DEALERSHIP` |
| people | `Dana / Omar / Rita / Faisal / … Example (demo)` |
| addresses | `*.demo.invalid` — RFC 2606, can never resolve |
| phones | `+9715000000NN` — undiallable |
| units | ids `DEMO-2xxx`, VINs `DEMOVIN00000021xx` |
| competitors | `Example Motors LLC (demo)`, `Sample Auto Trading (demo)`, `Placeholder Cars FZE (demo)`, host `listings.example.invalid` |
| WhatsApp handles | `971500000091@c.us` … `93`, push name `WhatsApp contact 9N (demo, unidentified)` |

### The shape, and why each number

| | | reasoning |
|---|---|---|
| inventory | **29** (27 available, 2 sold) | Small-independent scale. Ageing is a pattern rather than a list, and 29 gives the clear register a denominator worth printing. |
| flagged by the engine | **9** (31%) | Enough that ranking by money is a real decision. |
| on `HOLD` | **20** | The "measured clear" line *"20 of 29 units on HOLD"* is what makes the nine credible. |
| leads | **24** — 11 open, 13 closed | 46% going nowhere is an ordinary month; ranking 5 of 11 open is a decision. |
| leads needing an action | **5** | Matches the shape LAUNCH.md sketches. |
| communication_logs | **37**, 31 resolving | 83.8% identity resolution — deliberately not 100%. |
| unresolved WhatsApp handles | **3** | What a real dealership number looks like. |
| purchase_history | **2**, AED 254,000 | CONFIRMED has a holder, and **0** of it is attributed to NEXUS. |
| inventory_actions | **5** | One of each shape of stuck: approved-not-done, attempted-and-failed, rejected-with-a-reason, awaiting-a-decision, deferral-expired. |
| audit_log / action events | **10 / 10** | `events_without_audit = 0`. |
| competitors | **9**, none usable | All `weak` / `model_only` / unrecorded / 25 days old. |
| holding-cost rate | **not recorded** | Deliberate: it is what makes net margin `NOT_COMPUTABLE`. |

Thresholds are the dealership's own, not NEXUS defaults: warn 75 days, critical
110, promote 60, wholesale 170, minimum reprice margin 9.00%, market tolerance
3.00%, accepted match quality `{exact,strong}`, market freshness 14 days,
enquiry floor 50. `settings_are_defaults = false`.

### The nine flagged units, as the engine graded them (measured, not intended)

| unit | days | cost | price | gross | % | band | risk | recommendation | impact |
|---|---|---|---|---|---|---|---|---|---|
| DEMO-2101 Toyota Land Cruiser VXR 2022 | 214 | 268,000 | 279,000 | 11,000 | 3.94 | CRITICAL | SEVERE | `WHOLESALE` | 11,000 EXPOSED |
| DEMO-2104 Land Rover Range Rover Vogue 2021 | 187 | 305,000 | 352,000 | 47,000 | 13.35 | CRITICAL | SEVERE | `MANAGER_REVIEW` | 47,000 EXPOSED |
| DEMO-2107 Nissan Patrol LE 2022 | 148 | 232,000 | 262,000 | 30,000 | 11.45 | CRITICAL | SEVERE | `REPRICE` | 30,000 EXPOSED |
| DEMO-2109 BMW X5 xDrive40i 2022 | 121 | 198,000 | 224,000 | 26,000 | 11.61 | CRITICAL | SEVERE | `REPRICE` | 26,000 EXPOSED |
| DEMO-2130 GMC Yukon Denali 2022 | 132 | **null** | 235,000 | **null** | — | CRITICAL | SEVERE | `MANAGER_REVIEW` | **NOT_COMPUTABLE** |
| DEMO-2115 Toyota Fortuner VXR 2023 | 103 | 141,000 | 158,000 | 17,000 | 10.76 | WARNING | HIGH | `REPRICE` | 17,000 EXPOSED |
| DEMO-2112 Kia Sportage GT-Line 2023 | 96 | 79,000 | 82,500 | 3,500 | 4.24 | WARNING | HIGH | `INSPECT` | 3,500 EXPOSED |
| DEMO-2118 Hyundai Tucson Premium 2023 | 72 | 71,000 | 79,000 | 8,000 | 10.13 | HEALTHY | ELEVATED | `PROMOTE` | 8,000 EXPOSED |
| DEMO-2124 Ford Explorer ST 2022 | 41 | 149,000 | 153,500 | 4,500 | 2.93 | HEALTHY | HIGH | `MANAGER_REVIEW` | 4,500 EXPOSED |

Market position on **29 of 29** units: `UNKNOWN_NO_COMPARABLE` (18),
`UNKNOWN_UNVERIFIED_COMPARABLE` (10), `UNKNOWN_STALE_COMPARABLE` (1, DEMO-2101 —
a `strong` match captured 25 days ago against a 14-day window). Enquiry coverage
`INSUFFICIENT` on 29 of 29. Holding cost and net margin `NOT_COMPUTABLE` on 29 of
29.

### The three honest-machine requirements, satisfied

1. **A figure that renders `NOT_COMPUTABLE` with its reason** — two of them.
   Net margin on all 29 units (*"This dealership has not recorded what a day of
   floor costs…"*), and **DEMO-2130's impact**: `impact_kind =
   NOT_COMPUTABLE`, `impact_aed = null`, on a unit the engine still names as a
   SEVERE leak. That line appears in the leak register with the money word
   *Not computable* and no number in its place.
2. **A check in the "could not be measured" register** — seven of them; see §4.
   The flagship: the 12-Hour Silence Detector has **never recorded a successful
   run** for this dealership (`silence_detector_state = NEVER_SUCCEEDED`,
   `last_success_at = null`). No fake workflow audit rows were written to
   manufacture a STALE state; the honest state is the stronger one.
3. **A lead whose value is `UNKNOWN_NO_LINK`** — all 24. The view hard-codes it,
   with the basis *"leads.budget_aed is null on every lead on file and nothing
   links a lead to a unit… A figure here would be invented."*

---

## 3 · The walk, as a real signed-in user

Three sign-ins were created (`owner@` / `manager@` / `sales@northwind.demo.invalid`,
password `NexusDemo!2026`) and every figure below was read through the **live
REST API with a real access token**, not through the privileged SQL channel.

### Isolation, measured

As `owner@northwind.demo.invalid`:

```
POST /rest/v1/rpc/sentinel_inventory_actions  -> 29 units, tenant_id set = {dddddddd-…}
GET  /rest/v1/inventory                       -> 29 rows,  tenant_id set = {dddddddd-…}
GET  /rest/v1/leads                           -> 24 rows,  tenant_id set = {dddddddd-…}
```

Alpha's 3 units and Bravo's 1 are in the same tables and invisible to this
session. Alpha and Bravo row counts were identical before, during and after.

### Today's Money Leaks — header strip

Re-derived from the same reads the screen makes, using the same predicates:

| tile | value | derivation |
|---|---|---|
| Leaks today | **13** | 8 unit lines + 5 enquiry lines |
| Gross margin behind them | **AED 143,500** | 47,000 + 30,000 + 26,000 + 17,000 + 11,000 + 8,000 + 4,500 · *"7 of 7 included, none omitted"* |
| Checks that came back clear | **4** | see §5 finding 1 — one of the four is false |
| Checks that could not run | **7** | §4 |

### Register 1 — what is leaking, worst first

| # | kind | unit / enquiry | money word | amount | open |
|---|---|---|---|---|---|
| 1 | `DECIDED_NOT_DONE` | DEMO-2104 Range Rover Vogue | EXPOSED | 47,000 | 6d |
| 2 | `ATTEMPT_FAILED` | DEMO-2107 Nissan Patrol LE | EXPOSED | 30,000 | 9d |
| 3 | `NEVER_RAISED` | DEMO-2109 BMW X5 | EXPOSED | 26,000 | 121d |
| 4 | `WAITING_ON_A_PERSON` | DEMO-2115 Fortuner VXR | EXPOSED | 17,000 | 3d |
| 5 | `DEFERRAL_DUE` | DEMO-2101 Land Cruiser VXR | EXPOSED | 11,000 | 21d |
| 6 | `NEVER_RAISED` | DEMO-2118 Tucson Premium | EXPOSED | 8,000 | 72d |
| 7 | `NEVER_RAISED` | DEMO-2124 Explorer ST | EXPOSED | 4,500 | 41d |
| 8 | `NEVER_RAISED` | DEMO-2130 Yukon Denali | **NOT_COMPUTABLE** | — | 132d |
| 9 | `LEAD_AT_RISK` | Yusuf Example (demo) · WAITING_RESPONSE / HIGH / ESCALATE | NOT_COMPUTABLE | — | |
| 10 | `LEAD_AT_RISK` | Hessa Example (demo) · WAITING_RESPONSE / HIGH / ASSIGN_OWNER | NOT_COMPUTABLE | — | |
| 11 | `LEAD_AT_RISK` | Bilal Example (demo) · SILENT / HIGH / ESCALATE | NOT_COMPUTABLE | — | |
| 12 | `LEAD_AT_RISK` | Mariam Example (demo) · SILENT / MEDIUM / FOLLOW_UP | NOT_COMPUTABLE | — | |
| 13 | `LEAD_AT_RISK` | Salem Example (demo) · NEW_RISK / UNKNOWN / MANAGER_REVIEW | NOT_COMPUTABLE | — | |

Zero lines rendered as a **named fault**, i.e. every one carried all six parts
`makeLeak()` requires.

The rejected action (DEMO-2112, `PRICE_IS_CORRECT`) is correctly **absent** from
register 1 — a person read the engine, disagreed and recorded why — and appears
under `inventory_aging` in register 4 instead.

### Register 2 — checks that came back clear (4)

| what was checked | over how many rows |
|---|---|
| Nothing is stuck for want of somebody able to approve it | 5 action records, none escalated |
| No live decision rests on an engine finding that has since changed | 3 live actions, engine re-read on this load and still agreeing with each |
| The engine is content with the rest of the stock and recommends holding | 20 of 29 units on HOLD |
| ~~No open enquiry is recorded as having missed the first-response target~~ | ~~11 open enquiries~~ — **FALSE, see finding 1** |

### Register 3 — checks that could not run (7)

| what is not measured | since / how much | kind |
|---|---|---|
| Whether any enquiry has gone quiet on us | **no successful run is on record at all** | OPERATIONAL |
| How fast the exposed margin is being eaten, and net margin on any unit | 29 of 29 units | DATA |
| Whether any unit is priced above or below the market | 29 of 29, graded `UNKNOWN_NO_COMPARABLE` | INTEGRATION |
| Whether a slow-selling unit is slow because nobody wants it or nobody has seen it | 29 of 29, coverage `INSUFFICIENT` | DATA |
| Whose conversations we are looking at | 31 of 37 message events resolve (83.8%); 3 handles match no enquiry | SCHEMA |
| What Lead Recovery says it cannot tell you, in its own words | measured on this read | ENGINE |
| Service retention, missed appointments and no-shows, true margin after recon | **never measured, on any day** | ROADMAP |

The Deal Rescue line is **absent**, and that is finding 5: `v_deal_rescue_readiness`
returns 0 rows on staging because the platform reference table behind it is empty.

### Register 4 — what this screen refuses to call a leak (22 alerts, 5 kinds)

| kind | n | verdict | example |
|---|---|---|---|
| `undercut` | 7 | REFUSED | Kia Sportage GT-Line 2023 · *Example Motors LLC (demo) is AED 2,000 cheaper* |
| `sla_breach` | 6 | **NO RULE** | Yusuf Example (demo) · *Responded in 7 min — breaches the 5-minute rule* |
| `inventory_aging` | 5 | ALREADY RANKED | Toyota Land Cruiser VXR 2022 · **detail = NULL** (finding 3) |
| `unanswered_chat` | 3 | REFUSED | WhatsApp contact 91 (demo, unidentified) |
| `lead_unassigned` | 1 | **NO RULE** | Hessa Example (demo) · *HOT lead with no rep assigned* |

All 5 `inventory_aging` refs (2101, 2104, 2107, 2109, 2130) are genuinely in
register 1, so ALREADY RANKED is true. All 3 `unanswered_chat` refs genuinely
resolve to no enquiry, so the rows are correctly characterised — but the verdict
*sentence* is not (finding 2).

### Register 5 — the four money words

| word | what holds it today |
|---|---|
| EXPOSED | 5 action records carry `MARGIN_EXPOSED` |
| ESTIMATED | nothing — listed so the reader learns the others are not decoration |
| ATTRIBUTED | **nothing has passed the four-column evidence test** |
| CONFIRMED | **2 recorded sales on file, and 0 of them attributed to anything NEXUS did** |

### Step 6–7 — approve, and the audit trail

Run live against the published functions, as real signed-in users.

**The salesperson is refused, and the refusal is on the record.**
`rpc/action_approver_context` as `sales@`: `may_decide = false`,
`refusal_code = NOT_AN_APPROVER`. `rpc/action_decide` APPROVE returns
`ok = false` with the same code, and writes an `APPROVAL_REFUSED` event with
`actor_authority = "NONE - refused; account role sales"` and an `audit_log` row
with status `REJECTED`.

**The owner approves.** `ok = true`, status `APPROVED`, authority
`TENANT_OWNER`, assigned to Omar Example (demo). Timeline afterwards, four rows,
every one carrying an audit chip:

```
PROPOSED          Omar Example (demo), Sales Manager      SUCCESS
APPROVAL_REFUSED  Rita Example (demo), Sales Executive    REJECTED
APPROVED          Dana Example (demo), Owner              SUCCESS
ASSIGNED          Dana Example (demo), Owner              SUCCESS
```

The approval's own detail line, written by the database:

> *"Approved by Dana Example (demo) on authority TENANT_OWNER. Assigned to Omar
> Example (demo). Nothing has been executed yet and no money has been recovered
> — approval is a decision, not an outcome."*

**Approving twice returns `idempotent = true`** — *"This decision was already
recorded by you at 06 Sep 2026 10:19 GST. No second record was created."*

**And the money did not move.** After approval the leak count is still 13 and
the exposure is still AED 143,500; line 4 changes from *"…is waiting on somebody
to answer"* to *"A decision was taken on … and nothing has been recorded as
done"*. That is the correct behaviour and it is the closing argument of the
demo.

---

## 4 · Product findings the walk exposed

Ranked by what they would cost in front of a buyer. None was worked around in
the data; none of the do-not-edit files was touched.

### Finding 1 — a **false CLEAR** in the register whose whole job is that a zero has a denominator

**Severity: highest. It puts a wrong statement in front of a buyer, on the
screen the product is sold from.**

`screens/money-leaks.js` → `measuredClear()`:

```js
const late = open.filter(l => up(l.sla_state) === 'BREACHED' || up(l.sla_state) === 'BREACH');
if (open.length && !late.length)
  out.push({ what: 'No open enquiry is recorded as having missed the first-response target', … });
```

`v_lead_recovery` emits **`BREACHED_SLA`**, never `BREACHED` and never `BREACH`
— confirmed against the live view: the only three values it produces are
`BREACHED_SLA`, `WITHIN_SLA`, `UNKNOWN`. So `late` is **always empty** and the
check is **structurally incapable of failing**.

Measured on this dealership: **6 of 11 open enquiries breached** — 7, 12, 41, 18,
95 and 6 minutes against a 5-minute target (Yusuf, Mariam, Amina, Karim, Layla,
Rashid) — while the screen reported *"No open enquiry is recorded as having
missed the first-response target, 11 open enquiries checked."* The same six are
listed by name in register 4 as `sla_breach` alerts **on the same page**, so the
screen contradicts itself.

Invisible on production because ALBA has one open enquiry. It is exactly
CLAUDE.md's *"check captions against the branch they sit in"*, and it is the
eighth instance.

**Fix:** one word — test the value the view emits. It is a one-line change in a
file this pass was told not to edit, so it is reported rather than made.

### Finding 2 — a hard-coded verdict sentence that asserts a fact about the database

Register 4's `unanswered_chat` verdict reads *"Not one WhatsApp thread in this
database resolves to a lead record."* Measured here: `v_conversations` returns
**17 threads, 14 of which resolve to a lead** (`identified = 'lead'`).

The rows filed under the verdict are correctly characterised — all three are
unidentified handles, because `v_needs_attention` only surfaces threads whose
last message is inbound and within 7 days. But the sentence is a claim about the
whole database that happened to be true of ALBA and is false of any dealership
whose customers are on file. Same shape as finding 1: a sentence and its branch
disagreeing.

### Finding 3 — `v_needs_attention.inventory_aging` renders **no detail at all** when no holding rate is on record

```sql
((i.days_in_stock || ' days in stock · AED ' || to_char(i.holding_cost_accrued,'FM999,999')) || ' holding cost')
```

`holding_cost_accrued` is NULL whenever the dealership has not recorded a
holding rate, and in SQL anything concatenated with NULL is NULL — so the whole
`detail` column is NULL. **Measured: 5 of 5 `inventory_aging` alerts have
`detail = null`.** The alert renders as a bare car name with nothing under it,
on Overview and in money-leaks register 4.

Not a wrong number — a missing sentence where the engine one view over has a
complete one. Any dealership that has not entered a floor-plan rate (which is
every dealership on day one) sees this.

### Finding 4 — the exposure denominator cannot report a unit line it never saw

`screens/money-leaks.js` filters to `EXPOSED` **before** calling `expose()`:

```js
const sized = leaks.filter(x => up(x.size.word) === 'EXPOSED');
const t = expose(sized, …);
```

So `t.of === t.n` always, and the tile prints *"7 of 7 included, none omitted"*
while an eighth **unit** line (DEMO-2130) carries no figure at all. `expose()`
was written to report its own denominator — *"a disclosure that only appears
when there is bad news is a disclosure nobody learns to look for"* — and the
pre-filter removes the one case that disclosure exists for.

The gap is narrated elsewhere on the page (the caveat banner explains the
*enquiry* half), so it is a disclosure weakness rather than a false number.
Invisible on production, where all 12 ALBA units carry cost and price. Passing
`leaks.filter(unit lines)` and letting `expose()` count the misses would close
it.

### Finding 5 — staging is not a faithful rehearsal, and it is worse than CLAUDE.md records

CLAUDE.md's *"Staging is not yet a faithful rehearsal"* names function parity and
the un-staged n8n box. Measured 6 September, six platform reference tables carry
rows on production and **nothing** on staging:

| table | production | staging | what breaks on staging |
|---|---|---|---|
| `deal_rescue_prerequisites` | 9 | **0** | `v_deal_rescue_readiness` = 0 rows → Deal Rescue renders *"No prerequisites are recorded"*, and money-leaks register 3 loses its deal line |
| `deal_rescue_states` | 7 | **0** | the state model screen |
| `deal_rescue_evidence_sources` | 9 | **0** | the candidate/evidence panel |
| `lead_recovery_states` | 8 | **0** | the Lead Recovery state model |
| `workflow_registry` | 18 | **0** | `v_workflow_health` = 0 rows → the automation line in register 3 never appears; `nexus_workflow_catalogue()` returns nothing |
| `attribution_edge_type` / `event_type` / `link_basis` | 16 / 8 / 10 | **0** | the Attribution screen |
| `policy_rule` | 13 | 7 | the Policy screen is thinner |

**This was deliberately NOT fixed by this pass**, for a reason worth more than
the fix: **`deal_rescue_prerequisites` has no `tenant_id`, and its
`evidence_today` column contains one dealership's measured counts as stored
prose.** Production's rows say *"leads = 3 (2 of them quarantined wrong-number
junk), purchase_history = 1, finance_quotes = 0"* and *"12 units"*. Copying them
to staging would print ALBA's lead count and sale count on the demo
dealership's screen — and, more seriously, **on a second real dealership's
screen the day one is onboarded.** It is a cross-tenant disclosure of measured
facts through a platform-scoped text column, and it is not in the readiness gate
or in any tenancy sweep because no row is leaking, only a sentence.

The right fix is for the owner of that table to decide: either the column
becomes tenant-scoped, or it stops carrying counts.

### Finding 6 — `recompute_inventory_derived()` would write a fabricated margin onto the unit with no cost

```sql
coalesce(inv.price_aed, 0) - coalesce(inv.cost_aed, 0) as gross_margin
```

For DEMO-2130 (price 235,000, **cost never recorded**) that is **235,000** — the
full list price presented as margin. Proved by reading the expression against the
live row without writing it:

```
what recompute_inventory_derived() would write : 235000
what the seed stored                           : null
what v_inventory_profit_sentinel says          : null
```

The engine is right and the stored column would be wrong, so the same fact has
two derivations that disagree — an INV-001 violation. It matters because
`lib/unit-form.js:557` renders `inventory.gross_margin` directly in the unit
drawer. The seed deliberately stores NULL; **do not run
`recompute_inventory_derived()` on the demo tenant** until this is fixed. (It is
also not tenant-scoped when called as `postgres`, which is a second reason not to
run it: it would update Alpha's and Bravo's rows too.)

### Finding 7 — a dash where the engine has a sentence

With `gross_margin` NULL, `lib/unit-form.js` renders `aed(null)` → **"—"**, with
no reason beside it. One view over, `v_inventory_profit_sentinel` has the full
sentence (*"Missing an acquisition cost, so margin cannot be computed and no
recommendation is safe."*). Small, and the same family as the rest: the honest
value is present and the honest explanation is not shown.

### Finding 8 — two alert kinds have no verdict at all

`sla_breach` (6 rows here) and `lead_unassigned` (1) fall through
money-leaks register 4's `VERDICT` map to **"NO RULE"** — *"neither counted as a
leak nor cleared… somebody should decide which it is."* That is honest, and it
is also 7 of 22 alerts sitting in limbo on the flagship screen. Both kinds are
things a dealership would call money leaks. It never showed on production because
ALBA has no HOT unassigned lead and no recent measured breach.

### Finding 9 — an `auth.users` row inserted by SQL breaks sign-in in a way nothing in the row looks wrong

Creating the three demo logins with `confirmation_token`, `recovery_token`,
`email_change` and `email_change_token_new` left NULL produced
`500 unexpected_failure "Database error querying schema"` on **every** sign-in
attempt. GoTrue scans those columns into non-nullable Go strings. `''` is not
NULL here. Recorded in the seed with a comment, because the next person to
create a tenant by SQL will hit it, and the error message points nowhere.

---

## 5 · Reproducibility

### The guard — proved in both directions

Both scripts open with the same two tests and refuse on either:

- **(a) negative:** raises `NX999` if any tenant's slug or name contains `alba`.
- **(b) positive:** raises `NX999` unless **both** `staging-alpha` and
  `staging-bravo` exist.

**Evaluated on production, read-only** (the only production traffic in this
pass, a single `SELECT` over `public.tenants`):

```
guard_a_alba_tenant_present_so_script_raises : true
guard_b_staging_fixtures_present             : false
```

Both fire. Either alone stops the script before its first `DELETE`.

**Fired deliberately on staging**, because a guard that has never gone red is
decoration. Inside one `DO` block: plant a tenant named `ALBA CARS (probe)`,
evaluate the real predicate, `RAISE`:

```
ERROR: NX999: GUARD FIRED AS DESIGNED: an ALBA-looking tenant is present,
       so the demo scripts refuse. This probe is now rolled back.
```

`select slug, name from public.tenants` immediately afterwards: three rows,
`__unattributed__`, `staging-alpha`, `staging-bravo`. The plant did not persist.

### Scope

Every `DELETE` and every `INSERT` in both files is keyed on
`tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'`, or for the three auth rows
on those three fixed user ids. Neither file names a platform reference table in
any statement.

### Teardown proof

Run in full on staging. Before/after per table, printed by the script itself:

| table | rows before | rows after |
|---|---|---|
| tenants | 1 | **0** |
| users | 3 | **0** |
| tenant_members | 3 | **0** |
| inventory | 29 | **0** |
| leads | 24 | **0** |
| communication_logs | 37 | **0** |
| whatsapp_contacts | 3 | **0** |
| competitors | 9 | **0** |
| purchase_history | 2 | **0** |
| inventory_actions | 5 | **0** |
| inventory_action_events | **13** | **0** |
| audit_log | **12** | **0** |
| auth.users | 3 | **0** |

`inventory_action_events` was 13 and `audit_log` 12, not the seeded 10 and 10 —
because the live approve-and-refusal in §3 added three events and two audit rows.
**The teardown removed what the demo itself created**, which is the property that
matters.

### Nothing else moved

Immediately after teardown:

```
tenants                       : __unattributed__, staging-alpha, staging-bravo
staging-alpha                 : inv=3 leads=3 acts=2 audit=8 users=7 comm=0
staging-bravo                 : inv=1 leads=1 acts=1 audit=1 users=2 comm=0
__unattributed__              : all zero
GATE-PROBE fixture unit       : GATE-PROBE-1788673708220 (Alpha) — present
auth.users                    : the original nine, unchanged
platform reference untouched  : deal_rescue_prerequisites=0 workflow_registry=0
                                policy_rule=7 inventory_action_reason_codes=10
                                lead_recovery_reason_codes=9
```

Identical to §1 on every line.

### Idempotency proof

The seed was then re-run from scratch on the emptied tenant and produced counts
**identical to the first run** — 1 / 3 / 3 / 29 / 24 / 37 / 3 / 9 / 2 / 5 / 10 /
10 — and sign-in worked again immediately. The action lane came back to the
pre-demo state (`DEMO-2115` `PROPOSED`, awaiting a decision for 3 days), so a
rehearsal is undone by re-seeding.

**Staging is left seeded**, with the demo dealership present and ready.

---

## 6 · What could not be made honest, and is left undone

- **The Deal Rescue step of `LAUNCH.md`'s path cannot be walked on staging**, and
  the fix is not mine to make (finding 5). The runbook routes that beat through
  money-leaks register 3 instead and says why.
- **The clear register contains a false line** (finding 1). The runbook opens
  with a warning telling the presenter not to show it, or to show it and say it
  is wrong. Shaping the demo data so no enquiry breaches the response target
  would have hidden a real defect behind a fixture, which is the opposite of the
  job.
- **The automation layer is not demonstrable.** There is no n8n box behind
  staging and `workflow_registry` is empty, so `v_workflow_health` returns
  nothing and Ask AI, the WhatsApp send box and the finance calculator are all
  inert. The runbook says this out loud rather than routing around it: the demo
  shows the data and decision layer, not the automation layer.
- **No response-time, uptime or recovered-revenue figure is demonstrated**, and
  none should be. `commercial/WHAT-WE-CLAIM.md` forbids all three and this
  dataset does not create a way around any of them: `ATTRIBUTED` holds nothing,
  `CONFIRMED` holds two sales attributed to nobody, and `ESTIMATED` is empty by
  construction.
- **Attribution was not seeded**, because the attribution reference tables are
  empty on staging (finding 5) and the sale-to-unit link the chain needs does not
  exist in the schema at all. The Attribution screen is not on the demo path.
