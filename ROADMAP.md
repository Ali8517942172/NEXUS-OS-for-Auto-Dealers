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
proven at a dealership. Production, measured 5 September 2026: one dealership
tenant (plus a non-dealership quarantine tenant), twelve vehicles, three leads
(two junk, one Ali), **one `purchase_history` row that is the owner's own test
lead and not a customer sale**, and **114** messages. **Nothing below has
carried a paying dealership's traffic, and there are zero paying customers.**
`VERSIONS.md` states each capability against four separate columns —
implemented, tested, production-proven, commercially validated — because "Built"
in this table answers only the first.

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
idempotent, auditable, deployable.** Items 1–6 as written on 4 September are
**closed**, and the list is kept with each one's outcome rather than deleted,
because what closed an item is the evidence that it is closed.

1. ~~**Consent identity — P0.**~~ **CLOSED 4 Sep 2026.** Two constraints, not
   one: the act (tenant, integration, customer, event, `occurred_at`) and
   evidence-once as a separate property. A future OPT_IN is refused; a future
   OPT_OUT is clamped. The tiebreak is a generated, unwritable `consent_rank`,
   so the answer no longer depends on commit order — proved with five
   overlapping `pg_cron` backends. **Not fully closed:** there is no
   `SECURITY DEFINER` here, so `service_role` writing the table directly
   bypasses the writer's checks, and n8n holds `service_role`.
2. ~~**The anonymous object-creation path — P0.**~~ **CLOSED 4 Sep 2026**, and
   the closure is the schema door, not the ACL: `USAGE` on `public` is revoked
   from `PUBLIC` and `anon` and re-granted by name to eleven service roles.
   `supautils` re-runs `CREATE EXTENSION` as `supabase_admin` and skips
   non-superuser event triggers, so a guard **cannot** cover it — proved with
   three simultaneous triggers. **Open:** `authenticated` still reaches
   born-open objects (measured: SELECT 8,500 rows, UPDATE one row) and closing
   that needs Supabase to change a config-file setting. **Operational rule:
   install extensions into `extensions`, never `public`.**
3. ~~**Finish the idempotency family — P0.**~~ **Closed at the database
   5 Sep 2026.** `whatsapp_customer_message_seen`, `channel_message_events`,
   `whatsapp_delivery_events` and `processed_messages.message_id` now refuse an
   id minted per attempt (`nokey:`, `outreach:`, `exec-`, `run-`, `job-`, bare
   epochs) with `23514`. **Open, and it is the half that matters operationally:**
   the n8n writers were not changed, `Claim Message Id` is fail-open, and the
   `communication_logs` identity has no writer at all — 114 rows, 0 external
   ids.
4. ~~**`policy_applied_rule_id` foreign key, and `integration_id` in the
   delivery-events key — P1.**~~ **CLOSED 5 Sep 2026**, together with
   `status_raw` case normalisation and eight composite tenant/carrier foreign
   keys, all verified in production's catalogue.
5. ~~**The stale gate snapshot — P1.**~~ **CLOSED 5 Sep 2026.** Regenerated from
   production at `20:56:16Z`, 98 relations, provenance written by the run. The
   same pass fixed three checks that tested for a mechanism's *presence* rather
   than its *effect*, and added `L12` to watch the baseline.
6. ~~**Staging parity — P1.**~~ Achieved 4 Sep and **not re-measured since the
   eighteen migrations of 5 September**. Treat parity as **UNKNOWN** until a
   fingerprint comparison is run.
7. **Still open, in this order:** identify `2.50.10.149`; the WAHA secret
   rollout; the Meta attestation (13 rules, 0 verified, 0 attestations); Meta
   Cloud. Then give `workflow_registry` a `tenant_id`, publish the Infra Health
   Probe, and rehearse the `NEXUS_TENANT_MAP` switch on staging.

**PR #7 is not merged and WhatsApp messaging is not switched on until item 7 is
done and the n8n writers in item 3 are deployed.** `STATUS-2026-09-05.md`
carries the full open list.

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
