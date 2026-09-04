# NEXUS OS — the route, and what the market says about it

Written 4 September 2026, from research into UAE dealership operations and
the software already sold to them. `PRODUCT.md` holds the thesis;
`CONTROL-PLANE.md` the vendor/dealership boundary; this file holds the order
of work and the reasoning behind it.

## The finding that changes the positioning

**"AI CRM for UAE car dealers" is already crowding.** Mawrid360, Funoon and
Repluno all target UAE dealerships directly with lead capture, WhatsApp lead
management, inventory intelligence and owner dashboards. Separately, vendors
already sell the boring system-of-record layer — inventory, CRM, accounting,
VAT, purchase/import, workshop, marketplace sync.

So NEXUS cannot differentiate on *AI*, and it must not try to be a DMS. The
defensible position is the one already written in `PRODUCT.md`, and this
research strengthens it:

> **Cross-system revenue detection, with evidence, action execution, and
> outcome attribution.**

Not "run your dealership with AI". Instead: *NEXUS finds where the dealership
is losing money, proves the evidence, recommends the highest-value action,
executes approved actions across systems the dealership already has, and
measures what was recovered.*

## What a UAE dealership actually does

Acquire → inspect → recondition → price → advertise → capture enquiry →
qualify → follow up → test drive → trade-in → finance and insurance →
negotiate → reserve → documents → registration → deliver → warranty →
service → parts → retain → sell again.

NEXUS today attacks a slice of that: **enquiry capture, follow-up, response
speed, stock ageing, margin at risk, and managerial prioritisation.** That is a
real and expensive slice. It is not the dealership.

## Honest state of each capability

Green here means *built and honest about its own limits* — it does **not** mean
proven at a dealership. Production holds one tenant, twelve vehicles, three
leads (two junk, one Ali), one real sale and 108 messages. Nothing below has
carried a paying dealership's traffic.

| Capability | State |
|---|---|
| Lead leakage, prioritisation, follow-up, conversation intelligence | Built |
| Inventory ageing and margin-at-risk | Built |
| Evidence-based action, owner command centre | Built |
| Multi-tenant control-plane foundation | Built |
| WhatsApp AI response | Architecture built; **rollout blocked** |
| Deal rescue, attribution, campaigns, competitor intelligence, dynamic pricing | Partial |
| Finance desk, KYC/compliance, complaint lifecycle, service retention | Partial |
| Trade-in valuation, acquisition intelligence, reconditioning | **Missing** |
| Marketplace publishing and website sync | **Missing** |
| Test drive, reservation, registration, insurance, delivery | **Missing** |
| Workshop, service booking, parts, warranty, bodyshop, capacity | **Missing** |

## The five sentinels

Where the fourteen modules should eventually consolidate:

1. **Demand Sentinel** — unanswered lead, slow reply, unworked lead, missed
   appointment, lost opportunity.
2. **Stock Sentinel** — overpriced, ageing, low-demand, bad acquisition,
   recon overspend, margin deterioration.
3. **Deal Sentinel** — finance blocker, trade-in problem, missing document,
   stalled negotiation.
4. **Ownership Sentinel** — service due, missed service, churn, declined work,
   warranty expiry, next vehicle.
5. **Market Sentinel** — competitor price movement, demand shift, inventory
   mismatch, acquisition and export opportunity.

With the **Action Engine** on top, which is what connects them.

## The moat, stated plainly

The hardest problem in a UAE dealership is not analysis — it is that **the data
never arrives cleanly in one place.** Fragmented systems and data quality are
what dealer groups themselves name as the barrier to AI adoption.

So the moat is the **Dealership Event Graph**: lead → conversation → vehicle →
salesperson → appointment → test drive → quote → finance → trade-in → deal →
delivery → service → parts → complaint → repeat purchase, connected across
systems. Once NEXUS owns that graph, the AI on top gets much stronger. Before
it does, the AI is a commodity.

## What NOT to build

A full accounting ERP. A full workshop ERP. A full DMS. A marketplace clone. An
insurance platform. A finance company. An RTA integration. Each would put NEXUS
into a market that already has vendors, and turn it into an ERP project.

---

# The route, in order

## Now — engineering, before any feature

Nothing on the expansion list is started until this is done. The goal at this
stage is not feature-completeness; it is **reproducible, tenant-safe,
idempotent, auditable, deployable.**

1. **Consent identity — P0.** `evidence_kind` and `evidence_ref` are
   caller-supplied and are still in the consent identity, so a conversation
   that reached `CUSTOMER_OPTED_OUT` returns to `FREEFORM_ALLOWED` by three
   routes with no customer involved. Same-timestamp ordering must become
   deterministic and must **never** bias toward OPT_IN.
2. **The anonymous object-creation path — P0.** The default-privilege lines are
   closed; `CREATE EXTENSION … SCHEMA public` is not, and that is the path that
   produced a proved 8,500-row anonymous read. Close it without breaking
   PostgREST's `authenticator`. Establish the invariant: **no newly created
   application object may be anonymously readable by default** — tested for
   both migration-created and extension-created objects.
3. **Finish the idempotency family — P0.** The live `nokey:` id shape still
   extends the customer service window. Re-run every previous attack and hunt
   for remaining caller-controlled fields that affect identity, ordering or a
   state transition.
4. **`policy_applied_rule_id` foreign key, and `integration_id` in the
   delivery-events key — P1.** One constraint closes three defects; the other
   stops a second integration's genuine delivery report being silently dropped.
5. **The stale gate snapshot — P1.** A stale catalogue must never produce a
   PASS, and PASS / FAIL / BLOCKED / NOT RUN must stay four distinct answers.
6. **Staging parity — P1.**
7. Then `2.50.10.149`, then the Meta attestation, then Meta Cloud.

**PR #7 is not merged and WhatsApp messaging is not switched on until all of
the above is done.**

## Next — the seven capability gaps, in priority order

1. Trade-in and acquisition intelligence — connects straight to inventory
   profitability, and it is the largest missing economic engine.
2. Marketplace, website and channel ingestion — without complete demand data
   the intelligence layer is partially blind.
3. Complete deal workflow integration — lead to delivery.
4. Aftersales revenue recovery — the dealership's second revenue engine.
5. Ownership 360 — turn Customer 360 into the full lifecycle.
6. A true pricing and acquisition engine for UAE used cars.
7. Omnichannel — voice matters; most service bookings are still made by phone.

Each of these needs data NEXUS does not have today. **Sell none of them as
capability until the data exists.**
