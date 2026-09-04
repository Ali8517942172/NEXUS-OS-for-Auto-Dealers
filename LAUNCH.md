# NEXUS Launch Week

Decided 4 September 2026. `ROADMAP.md` holds the market position and the long
route; this file holds what ships now, what does not, and the two tracks that
run at the same time.

## The reframing

The goal is not fifteen new modules. It is: **harden what exists, add five to
seven thin capabilities that connect data NEXUS already holds, and launch as a
Dealer Revenue Recovery OS.**

The governing rule is **maximum high-value problems per unit of engineering
effort.** A service-overdue detector takes one to three days and exposes a real
revenue opportunity. A service ERP takes three months and competes with vendors
who already sell one.

## The five revenue-control loops

This is the launch story, and each is mostly built already.

| Loop | The dealer's problem |
|---|---|
| **Lead Recovery** | An enquiry arrived, somebody replied late, the customer went elsewhere |
| **Stock Recovery** | A car has been standing 30, 60, 90, 150 days |
| **Deal Recovery** | A hot buyer is stuck behind a finance blocker or a missing document |
| **Marketing Recovery** | The dealer has stock and does not know which vehicle to push |
| **Customer Recovery** | Someone enquired and never bought, or bought and was forgotten |

## The thin additions

Not systems. Intelligence layers over data that is already there.

**Pricing Advisor** — not a valuation engine. Acquisition cost, current price,
days in stock, enquiry count, margin, comparable data where it exists → `HOLD`,
`WATCH`, `REPRICE`, `MANAGER REVIEW`. Every recommendation carries evidence,
confidence, and what is missing.

**Buy or Don't Buy Advisor** — an offline decision tool, no auction
integrations. Acquisition price, expected retail, estimated recon, expected
holding days, target margin → `BUY`, `NEGOTIATE`, `WALK AWAY`,
`MANAGER REVIEW`. This moves NEXUS upstream from *"I own this, what now"* to
*"should I own this"*, which is a much larger economic loop.

**Trade-In Desk** — a valuation **workflow**, not a valuation. Capture vehicle,
mileage, condition, service and accident history, photos, inspection, expected
recon → `INSUFFICIENT EVIDENCE`, or a `PRELIMINARY RANGE`, or
`APPROVAL REQUIRED`. Refusing to price a car NEXUS cannot evidence is the
feature, not a limitation of it.

**Marketplace Performance Sentinel** — read imported marketplace reports; do
**not** build a publisher. Per vehicle: views, leads, price, days listed,
lead-to-view ratio → *"exposure but no demand"*, *"enquiries but no
conversion"*, *"ageing without lead activity"*.

**Service Revenue Recovery** — last service, mileage, age, warranty expiry,
next due, last contact → `DUE`, `OVERDUE`, `AT RISK`, and a recovery action.
Nothing else. This is not workshop software.

**Stock-to-lead matching** — a buyer says "AED 150K, family SUV" and NEXUS
names candidates. Every competitor has inventory-aware AI, so the match alone
is table stakes. NEXUS differentiates by naming the **economic consequence**:
*"Vehicle A fits the buyer and is 147 days old. Vehicle B fits similarly and is
42 days old. Recommend B."*

## The screen that is the product

**Today's Money Leaks** — the primary owner view. Not "AI Insights", not
"Analytics", not "AI Assistant".

> AED X exposed today.
> Five leads have no response. Two hot leads have finance blockers. Three
> vehicles are ageing. One vehicle has pricing risk. Four customers need
> follow-up.

Every item: **WHY → EVIDENCE → ACTION → APPROVE → RESULT.**

A dealer understands that in thirty seconds, and it is not a feature-by-feature
comparison with anybody.

## What must stay explicitly unsupported

Saying these plainly is what makes the rest credible. UAE vendors already sell
full DMS and workshop systems — one advertises DMS projects from AED 120K–250K
and service/parts systems from AED 50K. Do not fight them head-on.

RTA automation · vehicle registration · insurance transactions · full lender
submission · workshop management · parts ERP · bodyshop ERP · marketplace
publishing · automated trade-in valuation without evidence · acquisition
pricing without reliable market data.

## Pricing, with real benchmarks

| | |
|---|---|
| Funoon (AI WhatsApp lead management, UAE) | AED 499 / 999 / 1,999 per month |
| Repluno (website, unified inbox, leads, proformas) | $199 / $900 / $2,900 per month |
| Mawrid360 (AI dealer cockpit) | demo/pilot, no public monthly price |

AED 2,500–3,500 is defensible — **but not for another WhatsApp bot.** At that
price NEXUS has to be sold as revenue recovery, stock profit control and a
management action system, priced on dealership size, inventory, users and
integrations rather than on AI conversation count.

## The two tracks

They run at the same time and **neither waits for the other.**

**Track A — make it safe.** Consent identity P0 → the anonymous
object-creation path → the idempotency family → the policy foreign key and the
delivery-events key → the stale gate snapshot → staging parity → full security
regression. No shortcuts. WhatsApp does not switch on until this is done.

**Track B — make it sellable.** Three to five UAE dealers. Show the real Profit
Sentinel on ALBA's own honest data and Today's Money Leaks. Ask **what they
would pay**, and what the one missing capability is.

Never ask *"what features would you like"* — that is how a product becomes an
ERP.

**Track B does not depend on Track A.** The demo is read-only: it needs no
WhatsApp, no consent fix, no Meta attestation. So the dealer conversations
happen this week regardless of where the engineering stands, and what those
dealers say reorders everything below them.

## The agent structure

36 specialist roles; **~12–18 actively coding at any moment.** More than that
and coordination overhead outweighs the parallelism.

| Area | Agents |
|---|---|
| Architecture and orchestration | 4 |
| Backend and data | 8 |
| AI and intelligence | 5 |
| Integrations and n8n | 6 |
| Dealer frontend | 5 |
| Dealer's-customer frontend | 3 |
| Control plane | 2 |
| QA, security, release | 3 |

Three levels, and the middle one is what keeps agent output honest:
**Builder → Reviewer → Gatekeeper.** Every agent gets bounded file ownership.
Waves, not a free-for-all. And still **one agent at a time on the n8n box** —
parallel writes have crashed that VM twice.

## Four surfaces, separated from now on

1. **NEXUS Control Center** — Ali's. Tenants, subscriptions, usage, health,
   releases, security.
2. **Dealer OS** — the dealership's. Revenue, leads, stock, deals, customers,
   actions.
3. **Dealer Customer Experience** — the dealership's customer. Vehicle →
   enquiry → conversation → appointment. Keep this small for launch.
4. **Integration and automation plane** — not user-visible. n8n, webhooks,
   event processing, provider adapters, AI orchestration. Do not couple it to
   the frontend.
