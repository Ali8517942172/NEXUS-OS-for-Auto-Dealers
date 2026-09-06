# NEXUS OS — V1 to V4, and where each capability actually is

Written 5 September 2026. `PRODUCT.md` holds the thesis, `ROADMAP.md` the market
reasoning, `LAUNCH.md` the launch story, `STATUS-2026-09-05.md` what moved this
week. **This file exists to stop four different questions being answered with
one word.**

## The distinction this whole document is for

> **implemented ≠ tested ≠ production-proven ≠ commercially validated**

Four columns, four different pieces of evidence, and a capability can sit at any
combination of them. Most of the disappointment in this project has come from a
"yes" in column one being read as a "yes" in column four.

| column | what a YES means | what proves it |
|---|---|---|
| **Implemented** | The code, schema or workflow exists and is applied or deployed | A migration in `supabase/migrations/`, a file in the shipped bundle, a published workflow on the box |
| **Tested** | Somebody deliberately tried to break it and recorded the result | An adversarial probe in a rolled-back transaction, a gate check that ran, a harness with named inputs. **A build that compiles is not a test** |
| **Production-proven** | It has done its job on real production data at least once and left a record | A row, an audit entry, an execution — with the outcome checked, not the count |
| **Commercially validated** | A dealership that is not ALBA CARS has used it, and ideally paid for it | Nothing in this repository can currently supply this |

**Two facts run through every table below and are stated once here rather than
softened in each row:**

- **The messaging layer has never carried a genuine customer message.** Measured
  5 September 2026: `channel_message_events`, `whatsapp_delivery_events`,
  `whatsapp_opt_in_event`, `whatsapp_templates` and `whatsapp_message_usage` all
  hold **zero rows**. `channel_registry` holds one row — the WAHA session — and
  there is no Cloud API row. Four agents built it over two days and nothing
  calls it.
- **There are zero paying customers, and no dealership customer has ever bought
  a car through this system.** The one `purchase_history` row is the owner's own
  test lead. So the **Commercially validated** column is **NO for every
  capability in this document, without exception**, and it is not repeated in
  each row.

**On percentages.** A percentage appears below only where it says what was
counted. Where a fraction would be an impression rather than a measurement, the
row says what is done and what is not, and that is deliberate.

---

# The four versions

| | What it is | Where it stands |
|---|---|---|
| **V1** | **Production-safe core Revenue OS.** One dealership, safely: lead recovery, stock profit, evidence-based action, the honesty machinery, and a channel that does not leak or misattribute | The engines are implemented and mostly tested; the channel is not operational and the branch is not merged |
| **V2** | **Dealer intelligence expansion.** Pricing advisor, buy/don't-buy, trade-in desk, marketplace performance, stock-to-lead matching, service revenue recovery | **Nothing implemented.** Two of the six are also blocked on data that does not exist |
| **V3** | **Full dealership lifecycle.** Ownership, service, appointments, and a customer-facing surface | **Nothing implemented.** No service table, no appointments table, no customer route, no build target |
| **V4** | **Platform.** Unified event graph, control plane, subscriptions, self-serve onboarding, cross-system integrations | **Nothing implemented.** Measured 5 September: zero control-plane objects in production. The boundary work in the existing dashboard is a prerequisite, not a start |

## The milestones

| | | Status, measured 5 September 2026 |
|---|---|---|
| **M0** | The repository is production truth | **DONE.** 273 migrations in `supabase/migrations/` against 273 in `supabase_migrations.schema_migrations`; 1,809,043 bytes on both sides; rollup `4f9bd21234f8cfe6079184432d6120ad` computed independently in Postgres and locally. A generated baseline, a history stamp and a vocabulary seed, with gate checks `L11` and `L12` to keep them honest. **Both of those checks are NOT RUN in this environment**, so the mechanism that stops M0 decaying has itself not been exercised here |
| **M1** | Security and database integrity closed | **NOT DONE, and much closer.** Closed: consent identity, the anonymous object-creation path at the schema door, the idempotency family at the database, the policy-citation foreign key, the delivery-event identity, eight composite tenant/carrier foreign keys, a staff role model, the unattributed-default quarantine, the raw-error leak, the `workflow_registry` column withholding. Open: `workflow_registry` has no `tenant_id`; `authenticated` still reaches born-open objects and closing it needs Supabase; the n8n writer changes for `communication_logs` and `processed_messages` are written up and **not deployed**; the full security regression has not been re-run since 3 September |
| **M2** | The core Revenue OS is hardened | **NOT DONE.** The engines ship as screens and the honesty machinery holds under a forced 403. The gate exits 1 with two failures. **The branch is not merged**: `origin/main` carries 14 screens, this branch 20, so a rebuild from `main` ships without the product differentiator |
| **M3** | Messaging is operational | **NOT STARTED in the sense that matters.** The layer is built and wired to nothing. Two of twelve preconditions for switching WhatsApp on were true on 4 September and nothing on the box has changed since |
| **M4** | Two tenants proven | **NOT DONE.** `NEXUS_TENANT_MAP` is unset; the switch has never been rehearsed on staging; the inbound webhook lets the caller pick the dealership; gate checks `B1`–`B4` have never run |
| **M5** | V1 is sellable | **NOT DONE.** Requires M1–M4 plus a decision on price and a signed pilot |
| **M6 / M7 / M8** | V2 / V3 / V4 | **Not started.** None of the three has an implemented capability |

**Nothing above is a percentage, because there is no honest denominator for
"hardened" or "sellable".** Where a count exists it is given.

---

# V1 — production-safe core Revenue OS

## The engines and screens

| Capability | Implemented | Tested | Production-proven | Notes |
|---|---|---|---|---|
| **Inventory Profit Sentinel** | YES | YES — gate checks `L6`, `R4`, `S5` all pass; renders `NOT_COMPUTABLE` rather than zero with no holding rate | **YES** — 12 of 12 units carry real cost and days in stock; 3 real `inventory_actions` rows have moved through propose/decide/execute | The strongest thing in the product, and the demo that needs nothing on the open list |
| **Lead Recovery** | YES | YES — screen renders live | PARTLY — the mechanics render against 3 real leads and the queue is **0**, because there is nothing to recover. Its dependency, the 12-Hour Silence Detector, last succeeded **26 August**, so `silence_detector_state` reads `STALE` for every lead | Volume arrives with the first dealership, not before |
| **Action Center** (propose / decide / execute) | YES | PARTLY — the authority model is behind `SECURITY DEFINER` functions, but `B1` (a non-approver's refusal) and `B2` (decision idempotency) have **never run** | PARTLY — 3 real action rows | The two checks that would prove the authority model need a non-approving user, and production has one user who is an approver |
| **Revenue Recovery / the three words** | YES | **YES, and this is the load-bearing test** — under a forced 403 a tile rendered `—` and said *"nothing is claimed here and nothing is ruled out"* rather than manufacturing a plausible zero | YES — Estimated renders "Not computed", Attributed AED 0 with the reason, Confirmed AED 585,000 with *"none of it is attributed to anything NEXUS did"* | The page also refuses to produce an aggregate "revenue at risk", deliberately |
| **Revenue Attribution** | YES | YES | PARTLY — 115 edges, 114 events from one sale; the VEHICLE hop reads `UNKNOWN_TEXT_ONLY` and its margin `NOT_COMPUTABLE`, because nothing links `purchase_history` to a unit. **That refusal is the feature** | |
| **Deal Rescue** | YES | YES | **NO, structurally** — `v_deal_rescue` returns 0 rows and always will until a deal record exists before a sale closes. `v_deal_rescue_readiness` names all nine prerequisites | Demo the refusal, never the engine |
| **Policy Engine** | YES | YES — adversarially: a dealership could legislate as Meta until 4 September, and now cannot, because a jurisdiction is a namespace with an owner | **NO** — 13 rules, **0 verified**, **0 attestations**. A platform-verification path exists and nobody has used it | Its own rule — a regulatory claim needs a verified row — currently forbids every regulatory claim |
| **AI BDC (inbound WhatsApp → grounded reply)** | YES | YES | **YES, once, and it is the one demoable path** — 2 September, a real inbound message resolved to an existing lead without creating a duplicate and was answered in 17.8 s quoting a real price with the cost withheld, with a SUCCESS audit row | The workflow is graded `DEGRADED` at 42.4% over 290 runs. Both facts are true and both should be said |
| **Deals (closed-won through the dashboard)** | YES | YES — submitted four times, one row written | YES as a mechanism | **It is not a customer sale.** The row is the owner's own lead |
| **Ask AI / RAG** | YES | PARTLY | PARTLY — 11 successes in 17 runs, but **no answer produced since 24 August**, and the 15 documents are samples, not a dealership's | Retrieval is full-text plus trigram. No embeddings are computed anywhere |
| **Finance Desk** | YES | PARTLY | **NO** — `finance_quotes` holds 0 live rows. The insert path has fired repeatedly (25 inserts, 15 deletes) and a teardown clears it. Whether it works *today* is **UNKNOWN**: the fix to the constraint that broke it is nine minutes younger than the last failure and has not been exercised since | On 31 August this path sent a real person an invented EMI. It is gated and must stay gated |
| **KYC / Compliance** | PARTLY | — | **NO** — 3 documents, all verdict `REJECTED`, 0 verified. The auditor workflow has 0 successes ever | The decision nodes exist in the workflow; the endpoint is missing from the dashboard. The screen now says "Not zero — nothing to count" rather than showing three zeros |
| **Customer 360** | YES | PARTLY | PARTLY — a once-daily batch, 2 profiles, 27 runs at 33% | Not live, and it goes silent at two dealerships until it iterates tenants |
| **Competitor / market intelligence** | YES | — | **NO** — 19 rows on file and stale; the system's own health rule graded the scraper `PRODUCING_NOTHING` on 3 September | A screen, not a capability |
| **Marketing / campaigns** | YES | — | **NO** — 8 runs, 8 failures. The Gmail credential has been broken since 23 August | |
| **Today's Money Leaks** (the screen `LAUNCH.md` calls the product) | **NO** | — | — | It does not exist on either branch, and the AED figure it opens with is exactly the aggregate the Revenue screen currently refuses to produce |

## The safety layer V1 depends on

| Control | Implemented | Tested | Production-proven | Notes |
|---|---|---|---|---|
| Tenant isolation at the database | YES | **YES, adversarially** — two synthetic tenants as real roles with real JWT claims: reads, writes, tenant-hopping, a forged `tenant_id` claim, membership self-grant, all views, phone-tail collision, all returned zero rows | YES, in the sense that one dealership reads only its own rows | Proven with Postgres roles, **not** through a signed-in browser session against the live API. `B3` has never run |
| `anon` reaches nothing in `public` | YES | YES — by reachability probe, which is the witness that told the truth when ACL metadata did not | YES | The `supabase_admin` default-ACL line still exists and cannot be closed from this project; what contains it is the closed schema door |
| `authenticated` privilege posture | PARTLY | YES | PARTLY | No table grants a table-level UPDATE. But `authenticated` still reaches born-open objects — measured, 8,500 rows read, one row updated — and closing that needs Supabase to change a config-file setting |
| Staff role model on `inventory` / `leads` | YES | **YES** — 37 adversarial cases, all rolled back, each naming which of the three mechanisms refused | **NO, and it cannot be** — production has one login, already `owner`, and there is no UI to add a second person | The stronger cost lock (`rbac_02`) is written and **not deployed** |
| Unattributed traffic never files under a dealership | YES | YES — proved on staging with two active dealerships, including against a forged JWT claim and a forged membership row | PARTLY — the mechanism is live and `nexus_quarantine_census()` returns **0 rows** so far | Which n8n workflows omit `tenant_id` is **UNKNOWN** |
| Message and consent identity | YES | YES — every attack re-run, including a genuine multi-backend race | **NO** — the tables are empty, so no identity has ever been exercised by real traffic | `service_role` writing the tables directly bypasses the writer's checks, and n8n holds `service_role` |
| Idempotency of the inbound claim | YES | YES | YES — observed absorbing a real duplicate delivery on 4 September | The workflow path around it is **fail-open**, so the database guarantee is stronger than the operational one |
| The inbound webhook perimeter | **NO** | YES — tested live and found open | — | `WAHA_WEBHOOK_SECRET` unset; the gate is `DORMANT`; the caller picks the dealership. A configuration fix on the VM, in a specific order |
| Something watching the channel | **NO** | — | — | NEXUS Infra Health Probe has never been published and has never run |
| The quality gate | YES | YES — and on 5 September the gate's own checks were audited, finding two that tested for a mechanism's presence rather than its effect | YES | Last full-lane run: PASS 26 · FAIL 2 · WARN 2 · NOT RUN 6, exit 1 |
| The repository can rebuild the database | YES | PARTLY | — | `L11` and `L12` are the mechanism and both are NOT RUN in this environment |

## What stands between here and "V1 is sellable"

In the order they block each other:

1. **Merge the branch.** 14 screens against 20 is the largest single gap between
   what is built and what a buyer could open.
2. **Deploy the two n8n writer changes** already written up, so the
   `communication_logs` and `processed_messages` identities have writers.
3. **Close the inbound webhook**, in the documented order, after identifying
   `2.50.10.149`. Setting the secret before WAHA sends the header would silently
   drop every real customer message.
4. **Give `workflow_registry` a `tenant_id`** and a scoped view.
5. **Rehearse the `NEXUS_TENANT_MAP` switch on staging**, and re-establish
   staging parity, which is **UNKNOWN** after the eighteen migrations of
   5 September.
6. **Meta attestation**, which only Ali can do, and without which every
   conversation returns `TEMPLATE_REQUIRED`.
7. **Publish the Infra Health Probe.**
8. **A price, and a dealership willing to pay it.** Nothing in this repository
   moves this one.

**Item 8 is the only one that can validate anything commercially, and it does
not depend on items 1–7.** The Profit Sentinel demo is read-only and runs on
today's honest data.

---

# V2 — dealer intelligence expansion

Six capabilities, from `LAUNCH.md`. **None is implemented.** The column that
matters here is the last one: what data each needs, and whether it exists.

| Capability | Implemented | Data it needs | Does that data exist? |
|---|---|---|---|
| **Pricing Advisor** | NO | acquisition cost, current price, days in stock, enquiry count, margin, comparables | **Mostly yes** — 12 of 12 units carry cost and days in stock. Comparables are the weak leg: 19 competitor rows, stale, and the scraper is graded as producing nothing. Enquiry count per unit does not exist, because nothing links a lead to a unit |
| **Buy or Don't Buy Advisor** | NO | acquisition price, expected retail, estimated recon, expected holding days, target margin — all entered by the user | **Yes, by construction** — it is an offline decision tool over inputs, not over the database. This is the cheapest V2 item and the one least blocked |
| **Trade-In Desk** | NO | vehicle, mileage, condition, service and accident history, photos, inspection, expected recon | **No.** There is no service history, no `recon_cost` column and no inspection record. As a *workflow* that refuses to price what it cannot evidence, it is buildable; as a valuation it is not |
| **Marketplace Performance Sentinel** | NO | imported marketplace reports: views, leads, price, days listed | **No.** No import exists and no marketplace connection exists |
| **Service Revenue Recovery** | NO | last service, mileage, age, warranty expiry, next due, last contact | **No.** No service table, no appointments table, no DMS connection. This is the largest opportunity in the strategy and the furthest away |
| **Stock-to-lead matching** | NO | lead requirements and inventory attributes | **Partly** — inventory is complete; leads carry a budget on almost none of them, and nothing links a lead to a unit. The differentiator is naming the economic consequence, which needs days-in-stock, and that exists |

**The sequencing rule from `PRODUCT.md` applies without exception here: build the
engine whose data already exists.** By that rule the order is Buy/Don't-Buy,
then Pricing Advisor, then Stock-to-lead — and Service Revenue Recovery is not a
V2 item at all until an integration exists, whatever the revenue case for it.

---

# V3 — full dealership lifecycle

| Capability | Implemented | Blocked on |
|---|---|---|
| Ownership lifecycle (sale → delivery → first service → trade-in signal → repeat sale) | NO | No service table, no delivery record, no ownership duration |
| Service booking and service history | NO | No service table, no DMS connection |
| Appointments and no-show recovery | NO | **No appointments table.** One integration unlocks two engines, including Lead Recovery's `APPOINTMENT_PENDING` |
| Customer-facing surface (vehicle → enquiry → conversation → appointment) | NO | **0% built** — no directory, no route, no build target |

**Every row here is blocked on an integration rather than on code**, which is
the honest reason V3 is far away and the reason it must be sold as roadmap and
never as capability.

---

# V4 — platform

`CONTROL-PLANE.md` is the design. Measured 5 September 2026 against production:
**zero control-plane objects.** Not a table, not a screen, not a licence
service, not an event collector.

| Capability | Implemented | Notes |
|---|---|---|
| Unified event graph across systems | NO | The "Dealership Event Graph" is named in `ROADMAP.md` as the moat. It does not exist |
| Control plane (tenants, health, releases, support) | NO | The dealership's dashboard is currently doing double duty as the operator's console. The boundary work is prerequisite and is **partly done**: the frontend half landed 5 September, the `workflow_registry` half did not |
| Subscriptions and licensing | NO | Needs a separate project and a payment processor. It answers "who is paying", which is most of the commercial value, and it needs no telemetry at all |
| Self-serve onboarding | NO | Not safe to attempt while one JSON field can choose whose data a webhook writes |
| Cross-system integrations (DMS, accounting, marketplace) | NO | The same gap that blocks V2 and V3 |

**One design fact to carry into V4 rather than discover in it:** self-hosted
telemetry is a fiction. A licence check can gate first-run setup, carry an
expiry and be revoked; it cannot prove the software stopped running, report
health, or count active dealerships. And **a download, an activation, an active
dealership and a paying subscription are four different numbers** — conflating
any two is how a product believes it has customers it does not have. Today all
four are zero.

---

# The one-line answer, if somebody asks how far along this is

**V1 is built and not finished; V2, V3 and V4 are not started.** The database is
in good shape and can now be rebuilt from this repository. The product
differentiator is on an unmerged branch. The messaging layer has never carried a
customer message. Nobody has paid for any of it.
