# NEXUS OS — what this product is

Decided 2 September 2026. This supersedes any earlier description of NEXUS
as an "AI WhatsApp assistant", a CRM, or an automation platform. Those are
implementation details, and each of them is a crowded market.

## The thesis

Dealerships already own systems that record what happened — a DMS, a CRM, an
inventory tool, a marketplace feed, an accounting package. What none of them
reliably does is notice that money is leaking *right now* and do something
about it.

> **NEXUS sits above the dealership's existing stack, finds where revenue is
> leaking, decides the next best action, and executes it — with the team in
> control.**

NEXUS does not replace the DMS, the CRM, vAuto, or a service system. It reads
from them, reasons across them, and acts. That is the wedge: the competitors
listed below are each excellent inside their own lane, and none of them is the
layer that reasons across all the lanes at once.

Four questions the product must answer, in this order:

1. Where is this dealership losing money?
2. Why is it happening?
3. What should happen next?
4. Can NEXUS do it — and how much was actually recovered?

## Who it is sold to

**NEXUS is a multi-tenant product for auto dealerships, sold on a subscription.
The UAE market first, then worldwide.** It is not a bespoke build for one
dealer, and no document in this repository should read as though it were.

**ALBA CARS is tenant #1 and the pilot.** It supplies the real stock, the real
enquiries and the real WhatsApp traffic that everything here is measured
against, and it is the first dealership the product has to be good enough for —
but it is the proving ground, not the client. The practical test on every
feature is *does this hold for a dealership we have not met yet?*, and anything
that is really one dealership's configuration — its bank commission arrangement,
its holding-cost rate, its lead-ingest endpoints — is per-tenant data rather
than a product constant.

**That is what NEXUS is for. It is not a claim about what it can do today.**
Multi-tenancy is by design and by intent; what may be said to a buyer about
running two dealerships side by side is governed by
`commercial/WHAT-WE-CLAIM.md`, which still refuses the multi-tenancy claim. And
every production figure in this document is a **one-tenant** figure — production
holds one active dealership plus a quarantine tenant, and cross-tenant behaviour
is exercised on staging deliberately. See "Every production measurement in this
repo is a measurement of one tenant" in `CLAUDE.md`.

## What the 14 modules are for, commercially

| Module | Commercial role |
|---|---|
| Overview | Revenue Command Center |
| Leads | Lead Recovery |
| Conversations | AI BDC |
| Customer 360 | Ownership Intelligence |
| Inventory | Profit Sentinel |
| Deals | Deal Rescue |
| Finance Desk | Deal Finance |
| Compliance | Risk Control |
| Campaigns | Revenue Activation |
| Competitors | Market Intelligence |
| Ask AI | Executive Copilot |
| Automation | Action Engine |
| Team | Performance & Capacity |
| Settings | Control Plane |

Nothing gets thrown away. The screens change what they are *for*.

**Re-counted 2026-09-06: the branch carries 21 screens, not 14.** The seven
added are `revenue` (Revenue Recovery), `leadrecovery`, `dealrescue`,
`attribution`, `policy`, `actions` (the Action Center) and — since 6 September —
`moneyleaks` (Today's Money Leaks), which is now the default landing screen. The
fourteen commercial roles above are unchanged: the new screens are the engines
below given a surface of their own rather than new modules. **`origin/main`,
which is what production builds, still carries the original 14** — counted in
`lib/nav.js` on both refs on 6 September, 14 against 21, with the branch **75
commits** ahead. **A rebuild from `main` today ships without the Action Center,
the five revenue engines, Today's Money Leaks and the honesty machinery.**

---

# The sequencing decision, and why it is not the same as the strategy

The strategy above is right. The order below is where an owner can lose a
year, so it is set by one test only:

> **Does the data this engine needs exist in the database today?**

An engine that renders "no data" in front of a paying dealership is worse
than an engine that does not exist, because it teaches them the product is
empty. **Measured 2026-09-03 against the live database and re-measured
2026-09-05**; each row carries the date of the figure it states, so movement is
auditable rather than overwritten:

| Data | State | What it unlocks |
|---|---|---|
| `inventory` — 12 units, **12 with `cost_aed`, 12 with `days_in_stock`** | complete, unchanged | **Profit Sentinel — built and shipped** |
| `competitors` — **19 rows** *(5 Sep; was 14 on 3 Sep, 11 on 2 Sep)*, all priced, but `v_competitor_latest` resolved only **6** when last checked | present, thin, and **not refreshing** | market position, with caveats |
| `leads` — **3**, of which **1 assigned**; `response_time_minutes` on 2 of 3 | works, no volume | Lead Recovery mechanics |
| `communication_logs` — **115** *(re-measured 6 Sep; still taking traffic)*, **0** carrying a provider message id | real, and not deduplicable retrospectively | AI BDC, silence detection |
| `purchase_history` — **1** *(recorded 2 Sep through the dashboard; still 1 on 5 Sep)*. **It is the owner's own test lead, not a customer sale** | one row, one mechanism proven | attribution starts here |
| `finance_quotes` — **0 live rows**, but **25 inserts / 15 deletes** in `pg_stat_all_tables` | the insert path has worked repeatedly; a teardown script clears it | Deal Finance |
| `policy_rule` — **13 rows, 0 `VERIFIED`** *(5 Sep)*, and **0** platform attestations; 21 constants still unmigrated | shipped, **unverified** | see the Policy Engine caveat below |
| `deal_rescue_states` — 7 state definitions, **`v_deal_rescue` = 0 rows** | **structurally empty by design** | Deal Rescue — blocked on a deal record |
| **service records** | **no table exists** *(re-checked: 0 tables matching service/appointment)* | Service Retention — blocked |
| **appointments** | **no table exists** | no-show recovery, Deal Rescue stages — blocked |
| **`recon_cost`** | **no column exists** *(re-checked: 0 columns matching recon)* | true margin — blocked |
| **DMS / accounting integration** | **does not exist** | most of the Leak Radar — blocked |

**The competitor feed is the figure that got worse and should not be sold.**
`v_workflow_health` read Competitor Price Scraping as `PRODUCING_NOTHING` on
3 September: **151 no-result runs out of 168 in 30 days, 10.1% success rate.**
There are **19** rows on file as of 5 September and they are stale. The run
statistics have not been re-measured since 3 September and should be re-read
before they are quoted. Market Intelligence is a screen, not a capability, until
that scraper produces prices.

So the roadmap is not "ten engines this sprint". It is:

### Now — SHIPPED as screens, 2026-09-03. Shipped is not proven.

Five engines have landed as screens since this table was written, and the gate
renders all of them. **Shipped-as-a-screen means a dealership can open it and it
draws real rows or says honestly why it cannot. It does not mean the engine has
been exercised by a dealership, and none of these has.** Read each line for
which of the two it is.

1. **Inventory Profit Sentinel** — `screens/inventory.js`, `screens/revenue.js`,
   `screens/actions.js` over `rpc/sentinel_inventory_actions` and
   `v_inventory_profit_sentinel`: **12 of 12 units**, real cost and days in
   stock. The Action Center holds **3 real `inventory_actions` rows** with a
   propose / decide / execute lane behind `SECURITY DEFINER` functions. This is
   the strongest thing in the product. Its economics are gated: with no
   configured holding rate the screen renders `NOT_COMPUTABLE`, never zero
   (gate checks `L6`, `R4`, `S5`).
2. **Lead Recovery** — `screens/lead-recovery.js` over `v_lead_recovery`:
   **3 leads, queue = 0**. The mechanics render; there is nothing to recover.
   Volume still arrives with the first dealership. One dependency is *broken,
   not missing*: the 12-Hour Silence Detector last succeeded **26 Aug**, so
   `silence_detector_state` reads `STALE` for every lead.
3. **AI BDC** — live and proven end to end on a real inbound WhatsApp message
   (2 Sep). Still the one demoable path. `v_workflow_health` rates the workflow
   `DEGRADED` at 42.4% over 290 runs; the successful path is real, the failure
   rate is also real, and both should be said.
4. **Revenue Attribution** — `screens/attribution.js` over
   `v_attribution_edges`: **115 edges, 114 events** from the one real sale
   forward. The chain grades its own hops rather than asserting them — the
   VEHICLE hop on the single sale reads `UNKNOWN_TEXT_ONLY` and its margin
   `NOT_COMPUTABLE`, because nothing links `purchase_history` to a unit. That
   refusal is the feature.
5. **Policy Engine** — `screens/policy.js` over `v_policy_rule`: **13 rules
   (5 Sep), and `0` of them `VERIFIED`**, with `0` platform attestations on file
   and 21 hard-coded constants still unmigrated. A platform-verification path
   now exists (`policy_platform_verify_rule()`, `service_role` only, demanding a
   named attestation); nobody has used it. A jurisdiction is now a namespace
   with an owner, so a dealership can no longer legislate as Meta.
   **So the rule this document sets — "a customer-facing regulatory claim
   requires a verified policy row" — currently forbids every regulatory claim.**
   The engine is built; the evidence is not in it yet.
6. **Deal Rescue** — `screens/deal-rescue.js`. **`v_deal_rescue` returns 0 rows
   and always will until a deal record exists.** This is deliberate and it is
   handled honestly rather than hidden: the screen reads
   `v_deal_rescue_readiness`, nine named prerequisites each carrying what it
   unlocks, why it is not merely code, and what was measured — six of them
   schema or integration gaps, one (`SILENCE_DETECTOR_RESUMED`) a paused
   workflow, one deliberately not built. **Do not demo Deal Rescue as a working
   engine. Demo it as the product refusing to invent a pipeline**, which is a
   different and more sellable thing.
7. **Executive Copilot.** Still to do. "What needs my attention today?" over the
   above. It must show only what it can evidence — an honest three-item list
   beats a fabricated seven-item one.

### Next — needs one integration each, not a rebuild

**A deal record written at first commitment**, which is the single unlock for
Deal Rescue and is named as `DEAL_RECORD` in `v_deal_rescue_readiness`;
appointments (one integration, two engines — it also unlocks Lead Recovery's
`APPOINTMENT_PENDING`); a lender decision on `finance_quotes`; a hard
unit/VIN link from `purchase_history` to `inventory`, which turns "a deal is at
risk" into "AED N of margin is at risk". Then Trade-In Mining (needs ownership
duration and finance maturity) and competitor pricing that actually returns a
price.

### Later — needs a system NEXUS does not talk to yet

Service Retention and Service Revenue Recovery are the largest opportunity in
the strategy **and** the furthest away: there is no service table, no
appointment table, and no DMS connection. Sell them as roadmap, never as
capability.

Dealer Benchmarking needs multiple dealerships. It is a moat that only exists
after customers do — do not build it before them.

### Lead ingestion — the source of the data every engine above is short of

Added 6 September 2026. The sequencing rule cuts both ways: the engines are
starved because leads barely arrive, and **the one field that would say where a
lead came from does not say it.** Production holds three leads and all three
carry `source = 'nexus-master-router'` — the name of the workflow that wrote
them. Attribution has been rendering a column that never held an origin, which
is exactly the "no data in front of a paying dealership" failure this section
exists to prevent, dressed as a value.

Nine sources are catalogued. They divide commercially, not technically:

| Source | Can it be a real integration today? |
|---|---|
| Meta Lead Ads — Facebook and Instagram | **Yes.** Signed webhook, then a Graph fetch for the fields |
| Google Ads lead forms | **Yes.** One POST carrying the whole lead |
| Website form | **Yes.** It is our own page posting to our own endpoint |
| Inbound email | **Yes**, once an ingest subdomain exists |
| Walk-in, phone call | **Yes** — a person typing. In a UAE showroom this is the largest source there is, and the layer must record it as real business even though nothing external attests it |
| WhatsApp inbound | Already carried, on a door that is still open — see `CLAUDE.md` |
| Dubizzle Motors | **No.** Roadmap only |
| Marketplace notification email | Partly. We can send ourselves a real email; we cannot make Dubizzle send one |

**Dubizzle is the one to be careful about, and the reason is one sentence:**
Dubizzle Motors publishes no leads-out API, no webhook and no developer portal,
so its enquiries can only be simulated, intercepted as WhatsApp or email, or
negotiated commercially — never integrated — and it must be sold as roadmap and
never as capability. YallaMotor and CarSwitch are the same shape.

**Two sources are testable end to end at AED 0.** Meta's Lead Ads Testing Tool
and Google's "send test data" button both fire the **real** production webhook,
free of charge, with no campaign running and no ad spend. So the first honest
demonstration of lead capture costs nothing but the receiver.

**What may not be said yet.** The database contract for ingestion is built and
proved adversarially on staging; **no HTTP endpoint exists**, nothing has
carried a real lead, and the six migrations are deliberately not on production.
Until a real lead arrives through it, lead ingestion is roadmap by this
document's own rule, the same as Service Retention.

---

# The engines

Each is a reusable domain engine, not necessarily a screen.

### Revenue Leak Radar
Detects: unanswered leads, slow response, forgotten follow-up, stalled deals,
missed appointments, no-shows, ageing inventory, price mismatch, margin risk,
stalled finance, service defection, missed trade-ins, dormant high-value
customers.

Every leak carries **evidence, severity, estimated impact, owner, next best
action, action status**. A leak with no evidence is not displayed.

### Next Best Action Engine
For a lead, customer, vehicle, deal, service customer or campaign, returns:
`action, reason, confidence, evidence, owner, deadline, automation_allowed,
human_approval_required`.

### Opportunity Recovery Engine
`LEAD_RECOVERY, DEAL_RECOVERY, INVENTORY_RECOVERY, SERVICE_RECOVERY,
TRADEIN_RECOVERY, CUSTOMER_REACTIVATION`. Tracks opportunity value, action
taken, result, recovery probability.

### Inventory Profit Sentinel
Per unit: acquisition, recon, price, days in stock, market position, enquiry
volume, offers, margin, expected days to sell → `HOLD, REPRICE, PROMOTE,
TRANSFER, WHOLESALE, INSPECT, RECON, MANAGER_REVIEW`.

Do not try to reproduce vAuto's market-data engine. Orchestrate actions around
inventory data the dealership already trusts.

### Deal Rescue Engine
Why at risk, what blocked it, next best action, who acts, by when.

### Ownership Lifecycle Engine
Sale → delivery → first service → service → declined service → maintenance →
trade-in signal → next vehicle → repeat sale.

### Executive Copilot
Ask AI's default answer to "what needs my attention today?" — ranked by
revenue leaks, stalled opportunities, inventory risk, deal risk, retention,
team execution, market signals. Every item: evidence, reason, confidence, and
an action.

### Revenue Attribution Graph
Campaign → lead → conversation → vehicle → appointment → deal → finance →
revenue → service → repeat purchase. **Never invent attribution where the
relationship data does not exist.**

### Policy Engine
Jurisdiction rules are data, never hard-coded constants:
`jurisdiction, rule_type, value, unit, source, effective_from, effective_to,
verification_status, last_verified, owner`. Finance, export, compliance, VAT,
messaging and campaigns read from it. A customer-facing regulatory claim
requires a verified policy row.

---

# Rules that outrank features

- **Never fabricate a monetary impact.** Estimated, attributed and confirmed
  are three different words and must never be interchanged on a screen. Do not
  call an estimate revenue.
- **Never claim recovered revenue until a real business outcome occurs.**
- **AI may** summarise, classify, recommend, draft, and trigger approved
  actions. **AI may not** invent prices, finance numbers, inventory
  availability, regulatory requirements, customer identity, discounts, margin
  or attribution.
- **One owner, one canonical source, one write path, one evidence path** for
  every business fact. See `NEXUS_INVARIANTS.md`.
- Three claims from earlier research are **not** to be encoded as fact until
  sourced: that ~80% of cars are financed; that a 10-second response doubles
  ad ROI; and any country import rule. These belong in the Policy Engine with
  a source, or nowhere.

# What we say, and what we do not

Say: *"NEXUS sits on top of your existing dealership systems, finds revenue
leaks, decides the next best action, and executes it — with your team in
control."*

Do not say: enterprise-ready, globally compliant, zero-risk, or any guaranteed
revenue increase. The honest commercial position is a **controlled dealership
pilot**.

Every feature must connect to at least one of: time saved, revenue recovered,
gross profit protected, customers retained, inventory moved, deals closed. If
it connects to none of them, it is interesting rather than valuable, and it
waits.

---

# The commercial shape, decided 4 September 2026

NEXUS is sold as three product shapes, and the difference between them is not
packaging — it is **what Ali can see**.

| Shape | Who hosts | Telemetry Ali gets |
|---|---|---|
| **NEXUS Cloud** | Ali | Everything. This is the recommended shape |
| **NEXUS Managed** | Ali, installed in person | Everything |
| **NEXUS Self-Hosted** | The dealership | A licence activation, and nothing else that a competent operator cannot block |

A software marketplace is a **distribution channel**, not the product. NEXUS's
own control plane stays the source of truth for licences, subscriptions,
activations, health, usage and tenant lifecycle.

**Never sell NEXUS as a cheap unlimited lifetime deal.** AI calls, WhatsApp
conversations, hosting and support are recurring costs, so a one-time price
turns a successful launch into a loss that grows with every sale.

**Four metrics that are not the same metric:** a download, an activation, an
active dealership, and a paying subscription. Conflating them is how a product
believes it has customers it does not have.

See `CONTROL-PLANE.md` for the vendor/dealership information boundary, and
`JOURNEYS.md` for the twenty journeys and the node coverage matrix.
