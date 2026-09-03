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

---

# The sequencing decision, and why it is not the same as the strategy

The strategy above is right. The order below is where an owner can lose a
year, so it is set by one test only:

> **Does the data this engine needs exist in the database today?**

An engine that renders "no data" in front of a paying dealership is worse
than an engine that does not exist, because it teaches them the product is
empty. Measured on 2 September:

| Data | State | What it unlocks |
|---|---|---|
| `inventory` — 12 units, **12 with `cost_aed`, 12 with `days_in_stock`** | complete | **Profit Sentinel — buildable now** |
| `competitors` — 11 rows | present, thin | market position, with caveats |
| `leads.response_time_minutes` — 2 of 3 | works, no volume | Lead Recovery mechanics |
| `communication_logs` — 108 | real | AI BDC, silence detection |
| `purchase_history` — 1 | one real sale | attribution starts here |
| **service records** | **no table exists** | Service Retention — blocked |
| **appointments** | **no table exists** | no-show recovery, Deal Rescue stages — blocked |
| **`recon_cost`** | **no column exists** | true margin — blocked |
| **DMS / accounting integration** | **does not exist** | most of the Leak Radar — blocked |

So the roadmap is not "ten engines this sprint". It is:

### Now — the engines whose data is already here

1. **Inventory Profit Sentinel.** Every unit has acquisition cost and days in
   stock. Margin at risk, ageing, and a reprice/promote/hold recommendation are
   computable today, per VIN, with real numbers. This is the single most
   sellable thing that can be built this week, and no integration is required.
2. **Lead Recovery.** SLA, silence, ownership and next action — the mechanics
   exist; only volume is missing, and volume arrives with the first dealership.
3. **AI BDC.** Already live and proven end to end.
4. **Executive Copilot.** "What needs my attention today?" over the three above.
   It must show only what it can evidence — an honest three-item list beats a
   fabricated seven-item one.
5. **Revenue attribution, started small.** One real sale exists. Build the
   chain from campaign → lead → conversation → vehicle → deal now, while it is
   one row and cheap to get right.

### Next — needs one integration each, not a rebuild

Deal Rescue (needs deal stages and appointments), Trade-In Mining (needs
ownership duration and finance maturity), Competitor pricing depth.

### Later — needs a system NEXUS does not talk to yet

Service Retention and Service Revenue Recovery are the largest opportunity in
the strategy **and** the furthest away: there is no service table, no
appointment table, and no DMS connection. Sell them as roadmap, never as
capability.

Dealer Benchmarking needs multiple dealerships. It is a moat that only exists
after customers do — do not build it before them.

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
