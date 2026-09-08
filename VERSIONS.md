# NEXUS OS — V1 to V4, and where each capability actually is

Written 5 September 2026. **Re-measured 6 September 2026** after roughly
twenty-five commits landed overnight. `PRODUCT.md` holds the thesis, `ROADMAP.md`
the market reasoning, `LAUNCH.md` the launch story, `STATUS-2026-09-06.md` what
moved and what did not, `OWNER-ACTIONS.md` what only Ali can do.

**This file exists to stop four different questions being answered with one
word.**

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

**And as of 8 September 2026 these four columns are reported on a five-level
ladder.** The owner's reporting rule is
`1. IMPLEMENTED · 2. PROVEN · 3. PRODUCTION-DEPLOYED · 4. REAL TRAFFIC PROVEN ·
5. COMMERCIAL VALIDATED`, and it splits what this table's third column ran
together: **deployed** and **carrying real traffic** are two different facts,
and this document has needed that distinction on nearly every row (a capability
implemented on an unmerged branch; a screen deployed with no customer through
it). The columns below are not rewritten — they are still what was measured —
but a status quoted from here should name the ladder level as well. The full
applied ladder is at `ops/evidence-standard/STATUS-LADDER.md` and is
deliberately not reproduced here.

**Why that fourth column names ALBA CARS.** NEXUS is a multi-tenant product
sold to auto dealerships on a subscription — the UAE market first, then
worldwide — and **ALBA CARS is tenant #1 and the pilot**, not the dealership the
product was built for. So a capability proving itself on ALBA proves it on the
proving ground; it does not prove it on the market. Everything measured
"as the ALBA owner" or "on production" below is a **one-tenant** measurement:
production runs one active dealership plus a quarantine tenant, and two-dealership
behaviour is exercised on staging deliberately, because activating a second
dealership on production silences five consumers of `nexus_scoped_tenant_id()`.

**Three facts run through every table below and are stated once here rather than
softened in each row. All three were re-measured on 6 September 2026 against
production `dsvuoovivysszdoiorch`:**

- **The messaging layer has never carried a genuine customer message.**
  `channel_message_events` **0**, `whatsapp_delivery_events` **0**,
  `whatsapp_opt_in_event` **0**, `whatsapp_templates` **0**,
  `whatsapp_message_usage` **0**. `channel_registry` holds **one** row — the WAHA
  session — and there is no Cloud API row. **This did not move last night and no
  work last night was aimed at moving it.** A second measurement now sharpens it:
  over a 102-execution sample spanning 8h56m, the inbound workflow's own
  `Is Real Inbound?` node classified **0 of 51 distinct messages** as genuine
  customer conversation.
- **There are zero paying customers, and no dealership customer has ever bought a
  car through this system.** `purchase_history` holds **1** row and it is the
  owner's own test lead. `auth.users` holds **1** row; `tenant_members` holds
  **1**. So the **Commercially validated** column is **NO for every capability in
  this document, without exception**, and it is not repeated in each row.
- **What is described here is not what is deployed.** `origin/main` carries **14**
  screens (counted in its own `lib/nav.js`); this branch carries **21** and is
  **75 commits** ahead. **Everything measured below as Implemented is implemented
  in a working tree that a buyer cannot open.** Deploying it is one of the
  cheapest actions in `OWNER-ACTIONS.md` and it gates half this document.

**On percentages.** A percentage appears below only where it says what was
counted. Where a fraction would be an impression rather than a measurement, the
row says what is done and what is not, and that is deliberate.

---

# The versions

**Corrected 8 September 2026.** This section was headed *"The four versions"*.
There are five: `V1.5 — Revenue Capture Reliability` was inserted before V2 by
the owner on 8 September 2026, and `ROADMAP.md` holds the reasoning for the
order.

| | What it is | Where it stands |
|---|---|---|
| **V1** | **Production-safe core Revenue OS.** One dealership, safely: lead recovery, stock profit, evidence-based action, the honesty machinery, and a channel that does not leak or misattribute | The engines are implemented and now substantially tested through real signed-in sessions; the flagship screen exists; **the channel is still not operational and the branch is still not merged or deployed** |
| **V1.5** | **Revenue Capture Reliability.** No new product surface. WhatsApp capture, message event durability, customer / conversation / lead identity, AI enquiry classification, held queue, manual recovery, cross-channel attach, audit, attribution, delivery reliability, observability | **New on 8 September 2026, and nothing here is claimed as capability.** Parts of it exist and are measured in the V1 tables below — the ingestion contract, the origin column, the promotion race fix, the owner-change audit. The items it names as gaps are the ones this document already measures as gaps: no lead HTTP receiver in service, `communication_logs` joined on an email string, message identity with no writer, nothing watching the channel |
| **V2** | **Dealer intelligence expansion.** Pricing advisor, buy/don't-buy, trade-in desk, marketplace performance, stock-to-lead matching, service revenue recovery | **Nothing implemented.** Two of the six are also blocked on data that does not exist. Unchanged |
| **V3** | **Full dealership lifecycle.** Ownership, service, appointments, and a customer-facing surface | **Nothing implemented.** No service table, no appointments table, no customer route, no build target. Unchanged |
| **V4** | **Platform.** Unified event graph, control plane, subscriptions, self-serve onboarding, cross-system integrations | **Nothing implemented.** Zero control-plane objects in production. Unchanged |

## The milestones

| | | Status, re-measured 6 September 2026 |
|---|---|---|
| **M0** | The repository is production truth | **DONE, re-measured.** `supabase_migrations.schema_migrations` holds **286** with head **`20260906071310`**; `supabase/migrations/` holds **286** files with the same newest version. **What that measurement is:** a count and a head, taken today. The byte-exact rollup comparison was last done at 273/273 on 5 September (`4f9bd21234f8cfe6079184432d6120ad`) and **has not been re-run over the thirteen migrations added since**. `L11` and `L12` — the checks that would keep this honest automatically — are still **NOT RUN** for want of `NEXUS_DB_URL` |
| **M1** | Security and database integrity closed | **NOT DONE, and closer again.** Newly closed since 5 Sep: `workflow_registry` off the dealer plane entirely with `L2` **passing**; a designed RESTRICTIVE deny floor on seven messaging tables; the tenancy-readiness BLOCKER that measures the resolver; a staff role model that can actually be used; three engine defects including a fabricated margin and a cross-tenant disclosure through a text column. Still open: `authenticated` still reaches born-open objects and closing it needs Supabase; **the n8n writer changes for `communication_logs` and `processed_messages` are written up and NOT deployed**; the full security regression has not been re-run since 3 September |
| **M2** | The core Revenue OS is hardened | **NOT DONE, and materially advanced.** The flagship screen exists and is the default; B1–B3 pass through real signed-in sessions; the gate's definitive run is PASS 31 · FAIL 1 · WARN 2 · NOT RUN 3, exit 1. **The branch is still not merged and not deployed**, and four migrations landed after the gate's catalogue was taken, so that board is a true statement about 06:51Z and not a current one |
| **M3** | Messaging is operational | **NOT STARTED in the sense that matters, and unchanged.** The layer is built and wired to nothing. Nothing on the box changed last night. The nine-step rollout now exists as an ordered runbook with its constraints stated, which is progress in *planning*, not in *operation* |
| **M4** | Two tenants proven | **NOT DONE — and the first column moved.** A full customer journey was walked under two dealerships in aborted transactions with a live positive control on every probe, and all eight assertions passed **at the database**. `NEXUS_TENANT_MAP` is still unset, the switch has never been rehearsed, the inbound webhook still lets the caller pick the dealership, and `service_role` is `BYPASSRLS` and was measured writing a lead under the wrong dealership with no check at all. **The sentence is unchanged: *multi-tenant architecture implemented, second-dealer runtime proof pending*** |
| **M4.5** | **NEXUS V1 — REAL DEALERSHIP CERTIFIED** | **NOT STARTED, and it is now the next milestone.** Set by the owner on 8 September 2026: one real dealership's real enquiries proven end to end — source → capture → classify → lead → response → sales action → audit → revenue evidence. **Not one clause of that has happened.** Production holds 5 leads, of which one is a preflight and one is a WhatsApp lead created from a message that was not an enquiry; no lead has arrived through an HTTP receiver; the messaging layer has never carried a genuine customer message. This milestone is what `V1.5` in `ROADMAP.md` exists to reach |
| **M5** | V1 is sellable | **NOT DONE.** Requires M1–M4 plus a decision on price and a signed pilot — **and, corrected 8 September 2026, M4.5 before it.** The old sentence implied feature completeness was the bar. It is not: the bar is a real dealership's real enquiries proven end to end |
| **M6 / M7 / M8** | V2 / V3 / V4 | **Not started.** None of the three has an implemented capability |

**Nothing above is a percentage, because there is no honest denominator for
"hardened" or "sellable".** Where a count exists it is given.

---

# V1 — production-safe core Revenue OS

## The engines and screens

| Capability | Implemented | Tested | Production-proven | Notes |
|---|---|---|---|---|
| **Today's Money Leaks** (the screen `LAUNCH.md` calls the product) | **YES — this row was NO yesterday** | **YES** — gate `R2`/`R3` render it, `S6` confirms every `holding_cost_state` value is named, and it was walked adversarially against a demo dealership's data on the day it shipped | **YES** — it renders ALBA's real data and its header states its own derivation on the screen: measured at build time, **2 leaks · AED 66,000 gross margin exposed · 8 checks clear · 9 checks that could not run** | The default landing screen (`lib/nav.js`: `let current = 'moneyleaks'`). **Its live counterparts `L6`, `L7` and `L10` have not been run against it**, and the five header figures have not been re-measured since the engine-defect migrations |
| **Inventory Profit Sentinel** | YES | YES — gate `L6`, `R4`, `S5` pass; renders `NOT_COMPUTABLE` rather than zero with no holding rate | **YES** — 12 of 12 units carry real cost and days in stock; re-measured today, **12 of 12 `gross_margin_state = COMPUTED`**; 3 real `inventory_actions` rows have moved through propose/decide/execute | **A defect in its nightly recompute was closed on 6 Sep**: a unit with no cost on file was given a margin equal to its whole asking price. **0 of 12 net margins are computable** because no holding rate is on record — one number from Ali closes that |
| **Lead Recovery** | YES | YES — screen renders live; the SLA verdict is now decided by complement over a named vocabulary rather than by string equality | PARTLY — the mechanics render against 3 real leads and the queue is **0**. Its dependency, the 12-Hour Silence Detector, **has never been published** (`activeVersionId: null`) and last succeeded 26 August | The false-CLEAR defect in the SLA branch (`STATUS-2026-09-06.md` §3.1) was in the Money Leaks screen, not in this engine — but it was a claim about this engine's data |
| **Action Center** (propose / decide / execute) | YES | **YES — this row was PARTLY yesterday.** `B1` (a non-approver's refusal) and `B2` (decision idempotency) **ran and passed**, through GoTrue sign-in and PostgREST, against real staging sessions | PARTLY — 3 real action rows | B1's second door refuses **by GRANT (42501), not by row filter**, which is the distinction that matters. `B2`'s repeat wrote **+0 audit, +0 events** |
| **Revenue Recovery / the three words** | YES | **YES, and this is still the load-bearing test** — under a forced 403 a tile rendered `—` and said *"nothing is claimed here and nothing is ruled out"* | YES — Estimated "Not computed", Attributed AED 0 with the reason, Confirmed AED 585,000 with *"none of it is attributed to anything NEXUS did"* | The page refuses to produce an aggregate "revenue at risk", deliberately |
| **Revenue Attribution** | YES | YES | PARTLY — 115 edges, 114 events from one sale; the VEHICLE hop reads `UNKNOWN_TEXT_ONLY` and its margin `NOT_COMPUTABLE`. **That refusal is the feature** | Not on the demo path: the reference tables are empty on staging and the sale-to-unit link does not exist in the schema |
| **Deal Rescue** | YES | YES | **NO, structurally** — `v_deal_rescue` returns **0** rows (re-measured today) and always will until a deal record exists before a sale closes | **A cross-tenant disclosure was found and closed here on 6 Sep**: `deal_rescue_prerequisites` stored one dealership's measured counts as prose, in a table with no `tenant_id`. **Cannot be walked on staging at all** — those tables hold zero rows there |
| **Policy Engine** | YES | YES — adversarially, including a dealership unable to legislate in `PLATFORM_WHATSAPP`, `NEXUS_HOUSE` or `AE` | **NO** — re-measured today: **13 rules, 0 `VERIFIED`, 0 attestations** | Its own rule — a regulatory claim needs a verified row — currently forbids every regulatory claim. Only Ali can close it |
| **AI BDC (inbound WhatsApp → grounded reply)** | YES | YES | **YES, once, and it is the one demoable path** — 2 September, a real inbound message resolved to an existing lead without creating a duplicate and was answered in 17.8 s quoting a real price with the cost withheld | Graded `DEGRADED` at 42.4% over 290 runs. **New, and it changes what this channel is worth: 0 of 51 sampled messages were genuine customer conversation** |
| **Deals (closed-won through the dashboard)** | YES | YES — submitted four times, one row written | YES as a mechanism | **It is not a customer sale.** And a probable live failure was found on the box on 6 Sep: `Upsert Vector` has **no `on_conflict` at all**, so a resubmitted deal raises `23505` and kills the run before Audit Log and Respond to Webhook |
| **Ask AI / RAG** | YES | PARTLY | PARTLY — 11 successes in 17 runs, and **no answer produced since 24 August**; the 15 documents are samples, not a dealership's | Retrieval is full-text plus trigram. No embeddings are computed anywhere. **The 2-argument `search_rag_documents` returns 0 rows at two dealerships** |
| **Finance Desk** | YES | PARTLY | **NO** — re-measured today: `finance_quotes` holds **0** live rows. Whether it works *today* is still **UNKNOWN** | On 31 August this path sent a real person an invented EMI. It is gated and must stay gated |
| **Team & Access** (add, change role, revoke, see who has access) | **YES — this row did not exist yesterday** | **YES** — a `sales` user promoting themselves refused NX001 **on authority**; cross-tenant role changes refused; a sole owner demoting themselves refused `NX_TEAM_LAST_OWNER` **on production**; revocation measured as `3 / 3 / 7` → `0 / 0 / 0` in one transaction | **NO, and it cannot be yet** — production has **one** login. The invite path is proved end to end on staging only | **NEXUS cannot send a sign-in link** and does not pretend to. Ali closes that from the Supabase dashboard's own Invite user; an `auth.users` trigger applies the recorded role on first sign-in |
| **KYC / Compliance** | PARTLY | — | **NO** — 3 documents, all `REJECTED`, 0 verified. The auditor workflow has 0 successes ever | The decision nodes exist in the workflow; the endpoint is missing from the dashboard |
| **Consent visibility** (a dealership sees its own WhatsApp consent state) | **YES — new** | YES — scoped accessor, proved by counterfactual: under the pre-migration shape Bravo read Alpha's consent row; after it, zero | **NO** — production holds **0** consent rows | The screen says *"nothing recorded yet"*, never *"nobody has opted out"*. Correct and currently uninformative |
| **Customer 360** | YES | PARTLY | PARTLY — a once-daily batch, 2 profiles, 27 runs at 33% | **Goes silent at two dealerships**, and it is one of **five** consumers that do, not one. **`v_customer_directory` does not carry `tenant_id` at all** — that is a migration and it is not written |
| **Competitor / market intelligence** | YES | — | **NO** — `v_competitor_latest` returns **7** rows today (20 raw `competitors` rows), and **0** are of accepted match quality; the scraper was graded `PRODUCING_NOTHING` on 3 September | A screen, not a capability. Money Leaks audits its three most sellable sentences in register 4 and lets **none** reach the leak list |
| **Marketing / campaigns** | YES | — | **NO** — 8 runs, 8 failures. The Gmail credential has been broken since 23 August | |

## The safety layer V1 depends on

| Control | Implemented | Tested | Production-proven | Notes |
|---|---|---|---|---|
| Tenant isolation at the database | YES | **YES, adversarially, and now across a full customer journey under two dealerships** — enquiry → lead → conversation → vehicle → policy decision → action → deal, all eight assertions in both directions, 50 isolation probes, all 39 views swept, every probe with a live positive control | YES, in the sense that one dealership reads only its own rows | **`B3` now PASSES through a real signed-in browser session.** The sentence that travels with it: that is the signed-in path only. `service_role` is `BYPASSRLS`, n8n holds it, and it was **measured writing a lead under the wrong dealership with no check at all** |
| `anon` reaches nothing in `public` | YES | YES — by reachability probe | YES | The `supabase_admin` default-ACL line still exists and cannot be closed from this project |
| `authenticated` privilege posture | PARTLY | YES | PARTLY | **The canonical ACL check in `CLAUDE.md` was found blind to column-level grants and to every level but UPDATE** — it reported both live write paths as closed and returned **zero rows** against four holes planted on staging, where the corrected query returned eight. Third time this shape has hidden something here |
| Staff role model on `inventory` / `leads` | YES | **YES** — 37 adversarial cases on 5 Sep, plus the team probes on 6 Sep | **NO, and now for a smaller reason** — production has one login. **There is now a UI to add a second person**; what is missing is that nobody has been invited | The stronger cost lock (`rbac_02`) is still written and **not deployed**. `team_03`'s last-owner guard was **unreachable** until `team_05` |
| Unattributed traffic never files under a dealership | YES | YES — proved on staging including against a forged JWT claim and a forged membership row | PARTLY — re-measured today, `nexus_quarantine_census()` returns **0 rows** | Which n8n workflows omit `tenant_id` is still **UNKNOWN** |
| Message and consent identity | YES | YES — every attack re-run, plus a designed RESTRICTIVE deny floor on seven tables replacing an incidental lock | **NO** — the tables are empty, so no identity has ever been exercised by real traffic | `service_role` writing the tables directly bypasses the writer's checks, and n8n holds `service_role` |
| Idempotency of the inbound claim | YES | YES | YES — observed absorbing a real duplicate delivery on 4 September | The workflow path around it is **fail-open**, so the database guarantee is stronger than the operational one |
| The inbound webhook perimeter | **NO** | YES — tested live and found open | — | `WAHA_WEBHOOK_SECRET` unset; the caller picks the dealership. **The second sender is identified** — Ali's own account on device 8, an older WAHA on his Windows desktop `desktop-l3an0ma` in Docker Desktop, the old n8n host behind `https://desktop-l3an0ma.tail2141f7.ts.net`. **It had not stopped**: measured on 8 Sep 2026, execution 11103 at 06:07:40 UTC posted `session.status` from `2.50.10.149` with no secret header, two days after this repo called it gone — the earlier samples grouped by `payload.id` and that host emits only events which can never pair. Its whole `nexus-os` compose project (`n8n`, `n8n-db`, `waha`) was **stopped by hand at 06:08:24 UTC**. Status: **identified, and stopped by hand on 8 Sep 2026 — not yet permanently removed (`restart: always` still declared, device 8 still linked)**. Measured over 51 messages, it was never the only sender, and it now delivers no messages at all, so enforcement would drop only its `session.status` posts. **Enforcement is nevertheless still blocked, for a new reason:** the gate reads `header_present: true, ok: false` on the box's **own** traffic, because in queue mode the comparison runs in `n8n-worker` and `docker compose up -d n8n` recreates the wrong container |
| Something watching the channel | **NO** | — | — | The Infra Health Probe has `activeVersionId: null` — **never published** — while `workflow_registry` says `is_active = true`. **The defect is the pair**: the Automation screen tells the dealership its channel is monitored |
| The quality gate | YES | YES — and on 6 September its own freshness test was rebuilt on the migration history rather than on a clock, after a snapshot **eighteen minutes old** turned out to be wrong | YES | Definitive run **PASS 31 · FAIL 1 · WARN 2 · NOT RUN 3**, exit 1, anchored to `20260906062139`. **Four migrations have landed since**, and the render lane goes red against the stale snapshot — measured both ways, and it is the snapshot's age, not the product |
| The repository can rebuild the database | YES | PARTLY | — | `L11` and `L12` are the mechanism and both are still **NOT RUN** here |
| **The work is backed up** | **NO** | — | — | **The nine newest commits exist only in this container.** `origin/main` is 75 commits behind and the newest patch on disk stops at `383c511`. This is the single largest operational risk in the project today |

## What stands between here and "V1 is sellable"

In the order they block each other. `OWNER-ACTIONS.md` is the same list with
timings, "done" criteria and out-of-order consequences.

**Read this list under the milestone that now comes first.** As of 8 September
2026 the next milestone is **M4.5 — NEXUS V1 REAL DEALERSHIP CERTIFIED**, not
feature completeness, so items 1–10 below are no longer "the remaining build" —
they are the prerequisites for putting one real dealership's real enquiries
through the system and proving each hop. Nothing is added to the list and
nothing is removed; what changed is what finishing it buys.

1. **Get the work off this container and onto GitHub.** Nine commits — including
   the entire flagship screen — exist nowhere else.
2. **Deploy the branch.** 14 screens against 21 is the largest single gap between
   what is built and what a buyer could open.
3. **Record the holding-cost rate.** One number, from Ali. It turns 12
   `NOT_COMPUTABLE` net margins into figures and "AED 66,000 exposed" into a rate
   of loss. **The cheapest unlock in the product.**
4. **Invite a second user through the Supabase dashboard**, which makes the role
   model non-inert without a line of code.
5. **Deploy the two n8n writer changes** already written up, so the
   `communication_logs` and `processed_messages` identities have writers.
6. **Publish the Infra Health Probe**, so something is watching the channel
   *before* the webhook gate is armed.
7. **Close the inbound webhook**, in the documented order. Two things sit under
   this. The second WAHA host — `desktop-l3an0ma` — is **identified, and stopped
   by hand on 8 Sep 2026 — not yet permanently removed (`restart: always` still
   declared, device 8 still linked)**; it was measured still posting that
   morning. And the gate itself now reads `header_present: true, ok: false` on
   the box's own traffic, because the box is in queue mode and the comparison
   runs in `n8n-worker`.
8. **Publish the Phase 6 Silence Detector**, which empties most of Money Leaks'
   register 3.
9. **Rehearse the `NEXUS_TENANT_MAP` switch on staging** — and note it needs a
   `v_customer_directory` migration that is not written.
10. **Meta attestation**, which only Ali can do, and without which every
    conversation returns `TEMPLATE_REQUIRED`.
11. **A price, and a dealership willing to pay it.** Nothing in this repository
    moves this one.

**Item 11 is the only one that can validate anything commercially, and it depends
on items 1–3 only.** The Profit Sentinel and Money Leaks demo is read-only and
runs on today's honest data.

---

# V1.5 — revenue capture reliability

Inserted 8 September 2026, before V2. `ROADMAP.md` holds the phase and the
reasoning; this section holds only where the thirteen items stand, and the
honest answer for most of them is in the V1 tables above rather than here.

**Nothing in this phase is a new capability to sell.** It is the layer the V1
engines already depend on, and the reason it is a phase of its own is that this
document keeps measuring the same shape: the mechanism exists, and the arrival
it was built for has not happened.

| Item | Where it stands, from the measurements above |
|---|---|
| WhatsApp capture | The inbound path runs and the perimeter is open: `WAHA_WEBHOOK_SECRET` unset, the caller picks the dealership, and enforcement is blocked because the comparison runs in `n8n-worker`. **0 of 51 sampled messages were genuine customer conversation** |
| Message event durability | The database identities refuse per-attempt ids; **the n8n writers were not changed**, `communication_logs` has 115 rows and 0 external ids, and `Claim Message Id` is fail-open |
| Customer identity | Identity helpers fail closed at more than one dealership by design, so inbound stops matching known customers and starts creating duplicate people |
| Conversation identity | `v_conversations` renders; `channel_message_events` holds **0** rows |
| Lead identity | The promotion race that made three customers out of one phone-only enquiry is fixed on both projects, with a standing ten-backend regression |
| AI enquiry classification | Not built. The only measurement of enquiry density is from a personal handset and is **not** a dealership benchmark — see `CLAUDE.md` |
| Held queue | Not built. There is no place for an enquiry that arrives and cannot be classified or attached |
| Manual recovery | `nexus_lead_record_manual()` and the Add-a-lead screen are live and proved on production in a rolled-back transaction |
| Cross-channel attach | Not built. Nothing links a lead to a unit, and nothing attaches a WhatsApp conversation to a lead except an email string |
| Audit | Every promoted lead now writes one audit row from door three. **92%** of `audit_log` still carries no customer link |
| Attribution | `nexus_lead_attribution()` reads the origin a dealership is entitled to; the single production lead reads `UNKNOWN` and is not filed under Facebook |
| Delivery reliability | `whatsapp_delivery_events` holds **0** rows. Its key omitted `integration_id` and that is fixed; no delivery report has ever been recorded |
| Observability | **NO.** The Infra Health Probe has never been published while `workflow_registry` says it is active — the dealership is told the channel is monitored |

---

# V2 — dealer intelligence expansion

**None of the six begins before V1.5 is proven** — the sequencing decision the
owner set on 8 September 2026, recorded with its reasoning in `ROADMAP.md`. The
priority order inside the list is unchanged.

Six capabilities, from `LAUNCH.md`. **None is implemented.** Unchanged since
5 September; the column that matters is the last one.

| Capability | Implemented | Data it needs | Does that data exist? |
|---|---|---|---|
| **Pricing Advisor** | NO | acquisition cost, current price, days in stock, enquiry count, margin, comparables | **Mostly yes** — 12 of 12 units carry cost and days in stock. Comparables are the weak leg, and the measurement is now sharper: **7 competitor rows, 0 of accepted match quality**. Enquiry count per unit does not exist, because nothing links a lead to a unit |
| **Buy or Don't Buy Advisor** | NO | acquisition price, expected retail, estimated recon, expected holding days, target margin — all entered by the user | **Yes, by construction** — an offline decision tool over inputs. The cheapest V2 item and the least blocked |
| **Trade-In Desk** | NO | vehicle, mileage, condition, service and accident history, photos, inspection, expected recon | **No.** No service history, no `recon_cost` column, no inspection record |
| **Marketplace Performance Sentinel** | NO | imported marketplace reports | **No.** No import and no marketplace connection |
| **Service Revenue Recovery** | NO | last service, mileage, age, warranty expiry, next due, last contact | **No.** No service table, no appointments table, no DMS connection. The largest opportunity in the strategy and the furthest away |
| **Stock-to-lead matching** | NO | lead requirements and inventory attributes | **Partly** — inventory is complete; leads carry a budget on almost none of them, and nothing links a lead to a unit |

**The sequencing rule from `PRODUCT.md` applies without exception: build the
engine whose data already exists.** By that rule the order is Buy/Don't-Buy, then
Pricing Advisor, then Stock-to-lead — and Service Revenue Recovery is not a V2
item at all until an integration exists, whatever the revenue case for it.

---

# V3 — full dealership lifecycle

Unchanged since 5 September.

| Capability | Implemented | Blocked on |
|---|---|---|
| Ownership lifecycle (sale → delivery → first service → trade-in signal → repeat sale) | NO | No service table, no delivery record, no ownership duration |
| Service booking and service history | NO | No service table, no DMS connection |
| Appointments and no-show recovery | NO | **No appointments table.** One integration unlocks two engines, including Lead Recovery's `APPOINTMENT_PENDING` |
| Customer-facing surface (vehicle → enquiry → conversation → appointment) | NO | **0% built** — no directory, no route, no build target |

**Every row here is blocked on an integration rather than on code**, which is the
honest reason V3 is far away and the reason it must be sold as roadmap and never
as capability.

---

# V4 — platform

`CONTROL-PLANE.md` is the design. **Zero control-plane objects in production** —
not a table, not a screen, not a licence service, not an event collector.
Unchanged since 5 September.

| Capability | Implemented | Notes |
|---|---|---|
| Unified event graph across systems | NO | The "Dealership Event Graph" is named in `ROADMAP.md` as the moat. It does not exist |
| Control plane (tenants, health, releases, support) | NO | The dealership's dashboard is doing double duty as the operator's console. **The boundary work advanced on 6 Sep**: `workflow_registry` left the dealer data plane entirely and the vendor's register is now served through an accessor whose result type withholds the control-plane columns structurally |
| Subscriptions and licensing | NO | Needs a separate project and a payment processor. It answers "who is paying", which is most of the commercial value, and it needs no telemetry at all |
| Self-serve onboarding | NO | Not safe to attempt while one JSON field can choose whose data a webhook writes |
| Cross-system integrations (DMS, accounting, marketplace) | NO | The same gap that blocks V2 and V3 |

**One design fact to carry into V4 rather than discover in it:** self-hosted
telemetry is a fiction. A licence check can gate first-run setup, carry an expiry
and be revoked; it cannot prove the software stopped running, report health, or
count active dealerships. And **a download, an activation, an active dealership
and a paying subscription are four different numbers** — conflating any two is
how a product believes it has customers it does not have. Today all four are
zero.

---

# The one-line answer, if somebody asks how far along this is

**V1 is built and not finished; V1.5 is the phase that has to be proven before
V2, V3 and V4 start, and none of those three has begun.** The next milestone is
not feature completeness — it is one real dealership's real enquiries proven end
to end. The database is in good shape, can be rebuilt from this repository, and
two dealerships have now been proven isolated from each other adversarially at
that level. The flagship screen exists. **The product differentiator is on an unmerged, undeployed branch
whose nine newest commits exist in one container.** The messaging layer has never
carried a genuine customer message. Nobody has paid for any of it.
