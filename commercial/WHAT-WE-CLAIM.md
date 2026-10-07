# NEXUS OS — Claims Register

**Version 2.3 · Positioning sharpened and marketplace claims settled,
8 September 2026. The counts marked *(8 Sep)* were re-read against production
`dsvuoovivysszdoiorch` on that date.**

**What version 2.3 changes.** One addition, one refusal, and four corrections
where a count had moved far enough to change a sentence:

1. **The positioning is sharpened**, and three names for the product are
   retired. See "What NEXUS is" below.
2. **Marketplaces get their own section.** *"NEXUS integrates with Dubizzle"* is
   now a Part 2 claim and will stay there permanently — the database refuses to
   write the row that would make it true. The full assessment is
   `ops/marketplace/STRATEGY.md`.
3. **The 1-in-31 WhatsApp figure is fenced.** It is a risk shape measured on a
   personal handset. It is not a dealership benchmark and not a market
   statistic, and it must never be quoted as either.
4. **Lead and contact counts moved and the substance did not.** 5 lead records
   and 14 WhatsApp contacts, and **zero of the five is a genuine customer
   vehicle enquiry**. The count going up is not the product working, and the
   rows below say so.
5. **"Those webhooks are wired" was too generous** and is corrected. All three
   registered advertising endpoints are `disabled` and there is no receiver.
6. **Recovered revenue gets its own Part 2 row.** It is 0 proven and the
   database refuses to record any without a real sale behind it.

**Zero paying customers, and zero dealership customers have bought a car through
this system.** Unchanged on 8 September and no row below should be read as
implying otherwise.

---

**Version 2.2 · Body re-measured 3 September 2026; the rows below marked
*(5 Sep)* were re-measured against the live system on 5 September 2026**

**What version 2.2 changes.** Four rows, and one of them moves a claim from
Part 2 towards Part 1 — read the wording exactly, because it does not move all
the way:

1. **The tenancy readiness gate now reports zero BLOCKERs**, not one. The
   unattributed-default flag no longer points at the dealership; it is held by a
   quarantine tenant, pinned by a CHECK constraint. **This does not make NEXUS
   sellable as multi-tenant** — `NEXUS_TENANT_MAP` is unset on the box, the
   inbound webhook still lets the caller pick the dealership, and
   `workflow_registry` is still unscoped. The Part 2 row stands, with its
   reasons corrected.
2. **A dashboard login now carries a role.** The Part 2 row is rewritten rather
   than deleted: the mechanism exists and **is inert**, because production has
   one login and it is the owner's.
3. **Unclaimed KYC document files no longer fall to the default dealership.**
   They fall to quarantine — visible and recoverable rather than silent.
4. **Run counts and row counts have moved again.** Where a figure was
   re-measured on 5 September it says so; where it was not, it still carries its
   3 September date and must be re-read before it is quoted.

**Zero paying customers, and zero dealership customers have bought a car through
this system.** That has not changed and no row below should be read as implying
otherwise.

## What NEXUS is, and what that does not let you say

**NEXUS is a product sold to auto dealerships on a subscription — the UAE market
first, then worldwide. It is not a system built for one dealer.** **Tenant A is
tenant #1 and the pilot**: the dealership whose real stock, enquiries and
WhatsApp traffic every measurement in this register was taken against.

Both halves of that are sayable. What it does **not** license is any claim that
NEXUS can run two dealerships today — the Part 2 row on multi-tenancy stands
exactly as written, and it is the row that governs. "It is being built as a
product for dealerships" is a statement about intent. "You can put your second
branch on it" is a statement about capability, and the evidence does not support
it.

### The sharpened positioning *(8 Sep)*

**This is what NEXUS is for. Use it when you need one sentence:**

> **NEXUS captures dealership enquiries, identifies which conversations are real
> sales opportunities, tells your team what to do next, and keeps an auditable
> record of what happened.**

Each of those four clauses is doing work, and each is a claim you can be held to.
Read them against Part 1 and Part 2 before you say the sentence, because two of
the four are further along than the other two: the capture and the record are
demonstrable today, the identification is partly built, and "tells your team what
to do next" describes routing that exists rather than a workforce it replaces.

**Three things NEXUS must not be called, and each has a reason:**

| Do not call it | Why |
|---|---|
| **"An AI CRM for dealerships"** | It is not a CRM and does not try to be. There is no DMS connection, no service table, no appointments table, no deal pipeline a dealership would recognise as one. A buyer who hears "CRM" prices it against a CRM, and then discovers it does not replace theirs. |
| **"An AI chatbot"** | This undersells it in the direction that loses the sale. A chatbot is a widget on a website. What is in Part 1 is capture, grounded answers off a live stock table, a cost-price gate, deduplication, and a verified audit record. "Chatbot" invites the buyer to compare it with something free. |
| **"A Dubizzle integration"** | There is nothing to integrate with, the database refuses to write a production Dubizzle endpoint, and it is the most checkable lie in the pack — the first question a technical buyer asks is which API. See the marketplace section below. |

**Read every figure in Part 1 and Part 3 as a one-tenant figure.** Production
holds one active dealership plus a quarantine tenant. Cross-tenant behaviour was
proven on staging, deliberately, because activating a second dealership on
production silences five consumers of `nexus_scoped_tenant_id()`. Nothing
measured on Tenant A is evidence about what a second dealership would see, and
a buyer must not be allowed to hear it that way.

---

**Version 2.1 · Re-measured against the live system on 3 September 2026**

**Two claims changed in version 2.0 and they still stand.** The response-time claim was
**withdrawn entirely** — "17.8 seconds" and "under 20 seconds" are gone from every sales
document, and the replacement wording is in Part 1. And tenant isolation moved from Part 2 to
Part 1, but only at the level that was actually tested; read the wording exactly as written.

**What version 2.1 changes.** Every run count in this pack was re-read on 3 September and
most had moved; they are corrected below. Four things changed in substance:

1. The tenancy readiness gate now reports **one** BLOCKER, not three — the two globally
   unique keys were scoped per dealership. The remaining BLOCKER is the n8n one and it
   cannot be closed from the database.
2. `tenant_id` is now **NOT NULL on 24 of the 26 tenant-scoped tables**. The old "nullable on
   all 15 tables" caveat is withdrawn; the two exceptions are deliberate and are described in
   Part 1.
3. **The inbound WhatsApp webhook is not authenticated.** New row in Part 2. It must be
   closed on the VM before a dealership's customers touch the system.
4. **A dashboard login is not read-only.** Any signed-in user can edit or delete a vehicle
   and reassign any lead. New row in Part 2, and it changes what you tell a buyer at
   onboarding.

This document has one job: keep Ali from saying something in a meeting that the system
cannot back up.

Read the right-hand column before every meeting. If a claim is not in the left column, do
not make it. If you want to add one, prove it against the database first and then add it
here with the query result and the date.

**A buyer who discovers a gap you disclosed trusts you more. A buyer who discovers a gap you
hid does not buy from you again.**

---

## Part 1 — Claims you may make

| You may say | Evidence, re-measured 3 Sep 2026 unless a date says otherwise |
|---|---|
| **"Nexus automatically responds to inbound dealership enquiries and routes high-intent opportunities to the right team."** This is the approved sentence. Use it verbatim. **Attach no number to it.** | Live inbound at 06:07:12.52 on 2 Sep, automated outbound at 06:07:30.35, logged as sent by `bot`. 18 automated replies since 31 August, every one of them paired to a real inbound message. |
| "Replies take seconds to a couple of minutes." — only if asked, and only with the slow end included. | 18 replies since 31 Aug, re-measured 2 Sep: fastest **13.3s**, median **38.8s**, mean **62.1s**, 90th percentile **135.1s**, slowest **218.3s** (3 min 38 s). 4 of 18 took over 100 seconds. |
| "The price it quotes comes from your stock list, not from the AI's imagination." | Reply quoted AED 152,000; `inventory.price_aed` for VIN MHFXW9F31P0450103 (Toyota Fortuner 2.7 VXR 2024) is exactly 152000. |
| "It knows your cost price and will not disclose it." | `cost_aed` for that VIN is 133,000. It does not appear in the reply text. Gate added after a 31 Aug leak — see Part 2. |
| "The message attached to the customer who was already on file, without creating a duplicate." | Message resolved to lead 38, created 31 Aug 02:40. `leads` count was 3 before and 3 after. |
| "When it cannot tell two customers apart by phone number, it refuses to guess and leaves the message unassigned." | Resolution requires a unique 9-digit phone tail; a tail shared by two people matches nobody. Both database resolution paths agree on all 14 distinct message keys, 0 disagreements. Guard is by construction — no collision exists in live data to have triggered it. |
| "Every run writes an independently verified record — the system checks that each step it claims actually landed." | The 2 Sep run logged `SUCCESS — all 3 claimed steps verified`. `audit_log` holds **742** rows for this dealership since 14 Aug (re-read 5 Sep; it was 687 on 3 Sep) — it grows with every run, so re-count rather than quoting this number. |
| "The system grades its own workflows and tells you when one is broken." | `v_workflow_health` over 18 registered workflows: 2 HEALTHY, 11 DEGRADED, 1 PRODUCING_NOTHING, 1 NEVER_RAN, 3 NOT_INSTRUMENTED. |
| "Days-in-stock is recomputed every night and flags cars that are sitting." | Inventory Ageing Recompute: 20 runs, 20 successes, 100%, graded HEALTHY. Last run 2 Sep 20:15. 12 units, average 57.4 days, 3 flagged WARNING or CRITICAL. The average rises by one every night, so read it off the screen rather than quoting this line. |
| "Duplicate WhatsApp messages do not produce duplicate replies." | The id is claimed atomically before the reply is generated, and it was observed absorbing a real duplicate delivery live on 4 September. `processed_messages` holds **73** ids (5 Sep; it held 76 on 3 Sep, so rows have been removed and nothing in the repo records by what). **Two caveats to keep with the claim:** the claim node is `onError:continueRegularOutput` and the branch after it is an OR that includes the error, so the path is **fail-open** — the guarantee is strong in the database and weaker in the workflow; and a database CHECK added 5 September now refuses an id minted per attempt, which is the shape that would have defeated it. |
| "It stays quiet when one of your people is already in the chat." | Reply-eligibility check runs before the model. Present in the published workflow. |
| "Everything is on the record and you can read it back." | **142 rows (8 Sep; 114 on 5 Sep)** in `communication_logs` for this dealership, each with direction, timestamp and sender; on 3 Sep it was 108 (83 inbound WhatsApp, 18 automated outbound, 5 human outbound, 2 system). **Say the record exists; do not quote it as a message count.** None of the 114 rows carries a provider message id, ten groups of them are retry-shaped, and their ids are unrecoverable — so a historical message count off this table carries an error nobody can quantify. **A third caveat added 8 Sep:** in one seven-day window five messages were claimed in `processed_messages` and never logged anywhere. The claim is permanent, so a redelivery of any of those five is suppressed for ever and the customer's words exist nowhere. Say the record exists and is readable. Do not say it is complete. |
| "The dashboard is 14 screens over one live database." | 14 registered screens in the build production actually serves (`origin/main` → `lib/nav.js`, 14 entries — **re-counted 5 Sep, still 14**); one Supabase project, no second data store. A 20-screen build exists on an unmerged branch — **do not count those six**, a buyer cannot open them. |
| **Tenant isolation — say it in these words and no stronger:** *"Your data is separated from any other dealership's at the database level. Every table that holds your data carries a dealership id and every access rule checks it, so a signed-in user reads only their own dealership's rows. That was tested on 2 September with two test dealerships, and re-tested more harshly on 3 September across every table and every view in the database — including with the same customer email and the same phone number deliberately planted in both dealerships. Each saw its own rows and none of the other's, writes across the line were refused, and a forged dealership id in a login token was ignored. The automation layer is not there yet — the workflows write as a system account with no dealership attached — so I still run one dealership per system."* | Migrations `nexus_mt_01`…`nexus_mt_07` applied 2 Sep; `tenant_id` now on 26 base tables, FK to `tenants`, indexed, backfilled, and **NOT NULL on 24 of them**. No policy granting `authenticated` uses `USING (true)` on any table holding customer data; all of them test `tenant_id IN (SELECT nexus_current_tenant_ids())`. `anon` carries a RESTRICTIVE deny and, since the 2–3 Sep grant work, holds **no privilege at all** on any table, view or sequence. All public views carry `security_invoker` — 33/33 on 3 Sep, **39/39 re-read 5 Sep**, and the gate check that verifies it was itself fixed on 5 Sep, having previously accepted a view created `(security_invoker = false)`. Re-tested 3 Sep as real Postgres roles with real JWT claims inside a rolled-back transaction, including as `service_role` which bypasses RLS entirely: zero cross-tenant rows on 22 views and on every base table probed in both directions, cross-tenant INSERT/UPDATE/DELETE blocked `42501`, forged `tenant_id` claim discarded, and a deliberate same-email/same-phone collision produced two separate customer records rather than one merged one. Evidence: `apps/executive-dashboard/SECURITY_REGRESSION_REPORT.md`. **Two things must be said with it.** (1) The two nullable columns are `policy_rule` and `policy_rule_event`, and they are nullable **by design** — NULL there means "applies to every dealership" and such a row is deliberately readable by all of them. It is not customer data. (2) That sweep also found **three defects that fire the day a second dealership is added** — unclaimed KYC document files falling to the default dealership, a lead assignable to another dealership's staff member, and two reports going silently empty at two dealerships. None of them can fire with one dealership. They are why "one dealership per system" is a real limit and not a formality. |
| "The AI can answer staff questions from your own documents." | Ask-AI RAG agent: 17 logged runs, 11 successes, graded HEALTHY. **Add: "it has not produced an answer since 24 August and holds 15 sample documents, not yours."** The six later entries are all `REJECTED` — an unauthenticated security probe on 3 Sep that the auth gate correctly refused. The agent last *succeeded* on 24 Aug. Do not read "it ran on 3 September" as "it works today". |
| "You would be the first dealership on it." | 1 user account *(unchanged 8 Sep)*. **5 lead records (8 Sep; it was 3 on 5 Sep)** — two disqualified wrong numbers, one the owner's own test, one a preflight walk-in test, and one a friend's message the capture path turned into a lead. **Zero of the five is a genuine customer vehicle enquiry.** Quote the sentence, not the lead count: the count has gone up and the substance has not. |
| "It is a supervised pilot on my infrastructure, not a self-service product." | True and it is the correct frame. Say it early. |

---

## Part 2 — Claims you may NOT make

| Do not say | The gap |
|---|---|
| **"It quotes finance — monthly payment, APR, EMI."** | `finance_quotes` holds **0 rows**. The calculator has 65 logged runs: 49 rejected, 8 produced no calculation, 5 failed, 3 succeeded — and even the 3 successes left no quote row. Last success 24 August. |
| **"The finance figures are reliable."** | On **31 August the WhatsApp agent invented a monthly payment of AED 11,200 and sent it to a real person.** The true figure was nearer AED 7,800. The path is gated. Never present a finance number verbally either. |
| **"It verifies customer ID / it is KYC compliant."** | Re-measured 5 Sep: `kyc_documents` still holds **3 rows, all verdict `REJECTED`, 0 verified customers**. One correction to how this was described on 4 September: the decision nodes **do** exist in the auditor workflow; what is missing is the endpoint from the dashboard, so the Compliance screen cannot show a decision count and now says so with an em dash rather than three zeros. The capability gap is real either way. All three are `NOT_A_DOCUMENT`, verdict `REJECTED`, voided — images correctly identified as not identity documents. The auditor workflow: 12 logged runs, 10 failures, 2 escalations, **0 successes ever**. The last genuine run was 17 August; the September entries are refused unauthenticated probes, not work. The path has never once succeeded. |
| **"It tracks closed deals / shows you sold revenue."** | `purchase_history` held **zero rows** all the way to 09:59 on 2 September 2026. At **09:59:53** the first row appeared, written by repair work going on that morning: the owner's own test lead (lead 38, still marked WARM), a Lexus LX 600 2024 at AED 585,000. **It is not a customer sale.** No dealership customer has ever bought a car through this system. Re-read 3 Sep: still **1 row**, still that one. The sync job now shows 19 runs, 15 failures, 4 successes and is still graded DEGRADED. One row from a repair test is not a working capability — check the outcome, never the count. |
| **"It monitors competitor prices."** | 168 runs, 17 usable prices, 151 producing nothing. The system's own health rule classifies it `PRODUCING_NOTHING`. |
| **"It runs automated marketing follow-up."** | The 7-day drip campaign: 8 runs, 8 failures, 0% success. It has never succeeded once. |
| **"It is multi-tenant"** / **"we can put your second branch on it"** / any claim beyond the exact isolation wording in Part 1 | The database layer is tested and most of the way (Part 1) but it is **not finished**. **Corrected 5 September, and the correction does not make the claim sayable.** `select * from public.nexus_tenancy_readiness();` now reports **zero BLOCKERs** — the previous one fired whenever *any* tenant held the unattributed-default flag and therefore could never clear. The underlying defect is genuinely narrowed: the flag is held by a **quarantine tenant**, not by Tenant A, pinned there by a CHECK constraint, and quarantined rows are excluded from all 29 tenant-carrying views in their own definitions. A second dealership's unattributed traffic would now land in quarantine — visible and recoverable — rather than under Tenant A. **But "zero BLOCKERs" is a statement about the database only.** Every n8n workflow still writes as `service_role` with no dealership attached; **which workflows omit `tenant_id` is UNKNOWN** and cannot be established from the repository; `NEXUS_TENANT_MAP` is unset on the box, so roughly fifteen code paths switch to "unresolved" the moment it holds two keys; the inbound WhatsApp webhook still lets the **caller choose the dealership**; and `workflow_registry` is still readable by every signed-in user with no tenant scope. None of that can be fixed from the database. The two key blockers that used to sit beside it are **closed** — the readiness report now lists `leads.email`, `customer_360_profiles.customer_id` and six more natural keys as correctly scoped per dealership. The two remaining WARNs are `policy_rule` and `policy_rule_event`, nullable **by design**, holding platform-wide rules every dealership is meant to read; they are not a leak and they are not customer data. **Three further defects, found by the 3 Sep security sweep, fire on the day a second dealership is added and are not in the readiness report at all:** ~~unclaimed KYC document files fall through to the default dealership~~ — **corrected 5 September: they now fall to quarantine, unreadable by any dealership session and recoverable with one UPDATE**; `leads.assigned_to_id` has a global foreign key so a lead can be assigned to another dealership's staff, and two reports go silently empty rather than wrong once a second dealership exists. The second and third are still open. Also untested: isolation was proven with real Postgres roles and real JWT claims, **not** through a signed-in browser session against the live API, and four launch-critical gate checks covering exactly this (non-approver refusal, idempotency, cross-dealership denial, rendered-vs-live parity) are **NOT RUN** because production holds one dealership and one user. *The repository README claimed a multi-tenant architecture until 3 September; it was corrected. If any document in this repo reads more confidently than this row, this row is the one that is right.* |
| **"Enterprise-ready", "enterprise-grade", "SOC 2", "GDPR compliant", "ISO"** | None has been assessed, audited or certified. There is no data-processing agreement drafted. |
| **"99.9% uptime" / any SLA figure** | There is no SLA and no uptime measurement. The VM has been taken down twice by concurrent changes and is documented as CPU-starved. The infra health probe is registered and has **never run**. |
| **Any response-time number at all** — "17.8 seconds", "under 20 seconds", "real-time", "instant", "immediately", "within a minute" | **Withdrawn in full on 2 September 2026.** 17.8 seconds was one measurement, not a rate. Re-measured the same day across all 18 automated replies: median 38.8s, mean 62.1s, 90th percentile 135.1s, slowest 218.3s. Four of eighteen took over 100 seconds. Say the approved sentence in Part 1 with no number attached. If asked, "seconds to a couple of minutes", with the slow end included. |
| **Any SLA — uptime, response time, resolution time** | None exists and none is measured. See "When a response-time claim becomes allowed" below. |
| **"It answers every message."** | 83 inbound WhatsApp messages, 34 received a reply. The rest were non-customer traffic on a shared number and were correctly left alone — but do not claim full coverage. |
| **"It has handled hundreds of customers."** | **Re-measured 8 Sep: 5 lead records and 14 WhatsApp contacts** (3 and 12 on 5 Sep). The count moved and the substance did not — two are disqualified wrong numbers, one is the owner's own test, one is a preflight walk-in test, and one is a friend asking a favour that the capture path turned into a lead. **Zero of the five is a genuine customer vehicle enquiry.** The honest word is *pilot*. |
| **"Facebook, Instagram, the website and TikTok feed into it."** *(corrected 8 Sep)* | **"Wired" was too generous and is withdrawn.** `lead_ingest_endpoint` holds five rows: production endpoints for Facebook Lead Ads, Instagram Lead Ads and the Google Ads lead form, and **all three are `disabled`**. The only two active endpoints are `walk_in` and `phone_call`, and both of those are a person typing. The `leadingest_07` migration records the state in its own comment — *"There is no Meta app, no webhook subscription, no receiver of any kind"* — and it exists because a screen had been rendering these sources to the dealership as connected. TikTok is not in `lead_source_catalogue` at all. **Not one lead has ever arrived through any of them.** Every real inbound has come through WhatsApp. |
| **"Customer 360 gives you a live view of the customer."** | It is a once-daily batch, 2 profiles on file, 27 runs at 33% success — 9 successes, 16 partials, 2 failures, last success 26 August. It is not live. |
| **"Data is purged on a retention schedule."** | The retention purge workflow is registered, is marked active, and has **never run**. KYC records carry a `retain_until` of 2033 that nothing has ever enforced. |
| **"It has been penetration-tested / security-reviewed."** | No external review has happened. An access-key exposure was found and closed on 2 September and an **internal** security sweep ran on 3 September; both are real, and neither is an external review. Say "I have tested it hard myself and written down what I found. Nobody independent has looked at it." |
| **"The system is locked down / only my systems can talk to it."** | **`POST /webhook/whatsapp-inbound` accepts unauthenticated requests.** Confirmed live 3 September: its auth gate is env-driven and **dormant on the box** because `WAHA_WEBHOOK_SECRET` is unset, so the check passes everything through. A second control downstream — an allowlist on the WhatsApp session name — refuses an unknown session and writes nothing, and that was proven three times the same day; it is the only thing standing there. Ten of the eleven business endpoints *do* refuse an unauthenticated caller, and did so on 3 September, but every one of them starts an execution before refusing. **This is a configuration fix on the VM, not a code change, and it belongs in week one of any onboarding.** Until it is done, do not tell a buyer the perimeter is closed. |
| **"Every member of your team gets the right level of access."** *(rewritten 5 Sep)* | **A role model now exists and nobody is using it.** Measured 3 September, any signed-in user could delete a vehicle, change its asking and cost price and reassign any lead. Closed 5 September: `tenant_members.role` is `owner / admin / manager / sales / technician / member`, enforced by three separate mechanisms in the database and matched in the interface, and 37 adversarial cases were run and rolled back. **What you may say:** *"The database now separates what an owner, a manager, a salesperson and a technician may change — a rep cannot alter a cost price or delete a vehicle."* **What you must say with it, every time:** it has never been used, because the system has exactly one login and it is mine; there is **no way to add a second person from the interface yet**; a new login inherits the lowest role; and the strongest form of the cost-price lock is written but not deployed, because deploying it needs a dashboard rebuild. Do not describe this as tested in the field. It is tested in a transaction that was rolled back. |
| **"It integrates with Dubizzle"** / **"we pull your Dubizzle leads"** / **"marketplace attribution"** / **"see which listing site performs best"** | **Permanent, not pending.** Dubizzle Motors publishes no leads-out API, no webhook, no developer portal and no Zapier integration; the only public API surface is third-party scrapers, which breach Dubizzle's terms. YallaMotor and CarSwitch look the same. `lead_source_catalogue.marketplace_dubizzle` records this as `integration_status = COMMERCIAL_CONVERSATION_REQUIRED` and `required_provenance = 'simulated'` — and because `simulated` carries `counts_as_real = false`, two CHECK constraints on `lead_ingest_endpoint` make **a production Dubizzle endpoint a row Postgres refuses to write**. Zero marketplace `lead_event` rows have ever existed. This is the most checkable claim in the pack: the first question a technical buyer asks is which API. See the marketplace section below and `ops/marketplace/STRATEGY.md`. |
| **"It recovered revenue" / "it saved you a deal" / any figure attached to either** | **0 proven, and the database is built to keep it that way.** `inventory_actions` and `lead_recovery_actions` hold **zero rows carrying a `recovered_value_aed`** (8 Sep), and the CHECKs `inventory_actions_recovered_needs_real_sale` and `lead_recovery_actions_recovered_needs_real_sale` refuse any such row unless it is attributed to a real purchase with a stated basis. `purchase_history` holds one row and it is a repair test against the owner's own lead, not a customer sale. Never state a recovered figure, a pipeline value or a saved-deal count, and never present a margin figure as money the dealership would have kept. |
| **"It has been fully tested."** | The product's own quality gate exits non-zero. Last full-lane run **5 September 2026**: 26 pass, **2 launch-critical failures**, 2 warnings, and **6 checks that could not be run** — four because they need a second dealership or a non-approving user, and production has one dealership and one user who is an approver; two because they need a database connection the run did not have. A NOT RUN is not a pass and must never be reported as one. |

### When a response-time claim becomes allowed

A response-time SLA, or any stated response-time figure, may be claimed **only once there is
statistically meaningful production data**. Nothing about the current 18 replies qualifies:
they come from three days of the owner's own testing on a personal number, and the spread is
wider than the headline.

**What would count. All five, together:**

1. **At least 200 automated replies** to genuine inbound customer enquiries — not test
   messages, not the owner messaging himself.
2. **From at least two distinct dealerships**, or failing that from one dealership across at
   least 30 consecutive days of normal trading, so the figure is not one quiet week.
3. **Spanning the full trading day**, including the busiest hour. The current sample is
   heavily overnight, which is the easiest condition the system will ever face.
4. **Measured on the official WhatsApp Cloud API**, not the unofficial client. The two have
   different delivery behaviour and the current numbers do not transfer.
5. **Stated as a percentile with the tail attached, never as an average** — for example
   "90% of replies inside N seconds, measured over M replies between two dates". An average
   hides the three-minute reply and the three-minute reply is what the customer remembers.

Until all five hold: the approved sentence, and no number.

**And when it does hold, an SLA is a further step beyond a measurement.** A measured
percentile is a description of the past. An SLA is a promise about the future with a remedy
attached, and it needs uptime monitoring that actually runs — the infrastructure health probe
is registered and has never run once — plus an agreed credit if it is missed. Do not offer
one before both exist.

---

## Marketplaces — Dubizzle, YallaMotor, CarSwitch *(added 8 Sep)*

Marketplaces are where UAE dealership demand actually comes from, so this comes
up in every meeting, and a competitor will have claimed an integration. The full
assessment, with the queries, is `ops/marketplace/STRATEGY.md`. This is what may
be said in a room.

### What may be said

- *"Enquiries that reach your WhatsApp number are what NEXUS works on, whichever
  listing site the customer found you on."*
- *"We call it what it is: WhatsApp capture."*
- *"There is no API to plug into at Dubizzle. Anyone claiming one is either
  scraping the site, which breaks Dubizzle's terms, or telling you a story."*
- *"If the customer's own message mentions where they found you, that is worth
  keeping as a note on the lead — as something the customer said, not as
  something we verified."*

### What may not be said

- **"NEXUS integrates with Dubizzle."** There is nothing to integrate with.
- **"We attribute leads to Dubizzle."** We do not, and the database will not let
  us. A marketplace enquiry that arrives on WhatsApp is a WhatsApp enquiry.
- **"Dubizzle ROI reporting" / "marketplace attribution" / "see which listing
  site is performing."** Each describes a capability that does not exist and
  that no amount of engineering time produces.
- **Any count, rate or total broken down by marketplace.** Every one of those
  would be a number computed from a string a customer typed, and every one of
  them gets quoted back at you.

### The exact wording for a marketplace enquiry that arrived by WhatsApp

Say this. It survives being checked, and the honesty is the argument against a
competitor claiming an integration that cannot exist.

> "Dubizzle does not give anyone a lead feed. No API, no webhook, no developer
> portal — so a vendor who tells you they integrate with Dubizzle is either
> scraping the site, which breaks Dubizzle's terms, or telling you a story. What
> actually happens is that the buyer taps the button on your listing and the
> enquiry lands on your WhatsApp. That is the message NEXUS works on: it reads
> it, answers it from your real stock list, and the exchange is on the record for
> you to read back. It arrives as a WhatsApp enquiry and that is what we call it,
> because WhatsApp is what delivered it and WhatsApp is the part I can prove. I
> will not show you a Dubizzle lead count, and I would not trust anyone who
> does."

**Three things must be said with it, every time:**

1. **No speed number.** The response-time rules above apply unchanged. "Seconds
   to a couple of minutes", only if asked, with the slow end included.
2. **Not every message is answered.** The full-coverage claim is a Part 2 claim
   and stays there.
3. **The WhatsApp channel disclosure in Part 3 comes with it.** A marketplace
   conversation is a WhatsApp conversation, so everything in Part 3 about the
   unofficial client and the personal number is on the table in the same
   meeting.

### The 1-in-31 figure is not a benchmark *(added 8 Sep)*

A figure is circulating internally and it must not leave the building in the
wrong shape. Measured on production: of 31 genuine one-to-one inbound WhatsApp
messages in seven days, **one** matched a vehicle enquiry — and that one was the
owner's own test from his Indian number.

**What it came from.** Ali's **personal handset**, the number his family and his
other businesses message. It is not a dealership sales line. The other thirty
messages are family conversation in four languages, a kitchen-worktop quotation,
an unrelated payment chase, design work in progress, and one social-engineering
attempt.

**What it demonstrates.** The *shape of the risk*: a capture path that turns
every unknown inbound into a lead will fill a CRM with things that are not
customers. That risk is already measured rather than hypothetical — four
WhatsApp-derived lead records exist, none is a real vehicle enquiry, and two had
to be manually disqualified by a human.

**What it is not, and never say otherwise:**

- **Not a dealership benchmark.** On a real dealership sales line the mix
  inverts. Nothing about this measurement predicts what a dealership would see.
- **Not a market statistic.** It is one handset, one week, thirty-one messages.
  It says nothing about the UAE, about WhatsApp, or about dealerships generally.
- **Not a filtering accuracy figure.** No classifier was measured. It is a
  description of what arrived, not of what any part of NEXUS decided.

Use it internally to argue for a cautious capture design. Do not put it in front
of a buyer as a number about their business.

---

## Part 3 — The WhatsApp channel. Disclose this before signature, every time.

**The system currently sends and receives through WAHA, an unofficial WhatsApp client,
running on a personal mobile number.**

Everything proven in Part 1 went through that channel. It works. It is also three separate
problems, and a dealership owner will understand all three immediately:

**1. It is against WhatsApp's terms of service.** Unofficial clients are automated
third-party access to WhatsApp. Meta bans numbers for it, without warning and without
appeal. If that happens mid-pilot, the dealership loses its WhatsApp number — the number
printed on its cars and its listings. That is a commercial risk to the buyer, not a
technical inconvenience, and it must be stated in those terms.

**2. It is running on a personal number, and it is reading personal messages.** The database
currently holds **14 WhatsApp contacts (8 Sep; 12 on 5 Sep)**, of which one is a car enquiry. The others are family
and unrelated business contacts — a contracting company, a perfumer, a cosmetics shop — and
their private conversations have been captured and stored, including cheque and payment
discussions in Gujarati. This is unacceptable for a commercial deployment and it is also the
clearest possible argument for a dedicated dealership number. Say it plainly: *"Right now it
is on my own number and it picks up my mother's messages. That is exactly why step one of
your onboarding is a dedicated number that only your customers use."*

**3. There is no template approval, no green tick, no delivery guarantee.** The official API
brings message templates, a verified business profile, and a delivery receipt. The
unofficial client brings none of them.

### The plan to tell the buyer

> "Week one of your onboarding, before a single customer of yours touches it, the number
> moves to the official WhatsApp Cloud API through a Meta Business account in **your**
> dealership's name. The privacy policy and terms pages Meta requires for that approval are
> already live — that groundwork is done. The pilot does not go live on real customers until
> the migration is complete.
>
> Two things that come with it and you should know now: your business gets verified with
> Meta, which takes a few days and needs your trade licence. And messages you send outside a
> 24-hour reply window are charged per message by Meta — small money at pilot volume, but it
> is a real line item and it is yours, not mine."

**Never demo on the unofficial channel to a buyer without saying which channel it is.** If
the buyer later learns that the impressive 17.8-second reply came through a client that
could get their number banned, you have lost the account and the referral behind it.

---

## Part 4 — How to keep this document true

- **Before every buyer meeting**, re-run the counts in Part 2. `finance_quotes`,
  `kyc_documents` and `purchase_history` are the three that change the sales conversation the
  moment any of them holds its first genuine success.
- **A row appearing is not a success.** `kyc_documents` went from 0 to 3 rows on 2 September
  and the number of verified customers stayed at zero. Check the outcome, not the count.
- **A run appearing is not a run.** On 3 September a security test posted an unauthenticated
  request to every endpoint. Ten refused correctly — and each refusal wrote a `FAILED` or
  `REJECTED` row against its workflow. That single burst moved the "last run" date on eight
  workflows, including KYC and Ask AI, and added to their failure counts. When a workflow's
  last activity is 3 September 08:53, that is the probe, not the product. Read `last_success`,
  not `last_run`.
- **When a claim moves from Part 2 to Part 1**, write the date, the query and the result
  beside it. A claim with no evidence line does not belong in Part 1.
- **Nothing moves from Part 2 to Part 1 on the strength of code being written.** It moves
  when it has run, on real data, and left a record. "Wired but never fired" stays in Part 2.
- **No speed number goes back into a sales document** until the five conditions above are
  all met. This is the claim that was overstated once already; it does not get a second
  chance on a smaller sample.
- **Tenant isolation is checked by running the system's own readiness report**, not by
  reading this page: `select * from public.nexus_tenancy_readiness();`. While it returns a
  BLOCKER, the Part 1 wording stands exactly as written and goes no further. Two cautions on
  reading it: its remaining BLOCKER fires on the n8n side, which the database cannot see, so
  it will never clear from database work; and it does not know about the three
  second-dealership defects in the 3 September sweep, so a clean-looking report is not a
  clean bill of health.

---

## Final verification

Re-run against the live Supabase project `dsvuoovivysszdoiorch` on **3 September 2026**. The
previous run was 10:04:17 UTC on 2 September; every count below that moved has been corrected
and the ones that did not move are marked unchanged. The run counts in this pack go stale
within days — re-read them, do not quote this page.

**Read the scoping note before the numbers.** Between 09:52 and 10:02 another workstream
created three synthetic QA dealerships and wrote test rows into `purchase_history`,
`finance_quotes`, `kyc_documents`, `leads`, `inventory` and `communication_logs`. A raw
`count(*)` at 09:57 showed 2 purchases, 2 finance quotes and 10 leads — **none of it real**.
By 10:04 that test data had been cleaned up. Every figure below is scoped to the one genuine
dealership, `tenants.slug = 'alba-cars'`.

**Before any buyer meeting, scope your counts to the real tenant.** A raw count will lie to
you in exactly the direction you want to be lied to.

| Table (scoped to Tenant A) | Rows | Reading |
|---|---|---|
| `purchase_history` | **1**, and **0** of them a customer sale (unchanged) | Zero rows until 09:59:53 on 2 Sep, when the repair work in progress wrote one against the owner's own test lead (still marked WARM). The sync job is now 19 runs, 15 failures, 4 successes, graded DEGRADED. **This is the live example of Part 4's rule: a row appeared and the capability did not start working.** |
| `finance_quotes` | **0** (unchanged) | Finance quoting has never completed. |
| `kyc_documents` | **3**, of which **0 verified** (unchanged) | All three `NOT_A_DOCUMENT`, `REJECTED`, voided. Rows appearing is not the capability working — check the outcome column, never the count. |
| `leads` | 3 on 5 Sep · **5 on 8 Sep** | Two disqualified wrong numbers, the owner's own test, a preflight walk-in test, and one created from a friend's message. **Zero is a genuine customer vehicle enquiry**, which is the reading — not the count. |
| `inventory` | **12** (unchanged) | AED 3,046,900 asking, AED 2,667,000 cost, average 57.4 days in stock, 2 WARNING + 1 CRITICAL ageing flags. Every unit has a cost and a days-in-stock; **none has a reconditioning cost, so net margin is not computable and the system says so rather than guessing.** |
| `communication_logs` | 108 on 3 Sep · 114 on 5 Sep · **142 on 8 Sep** | On 3 Sep: 83 inbound WhatsApp, 18 automated outbound, 5 sent by hand, 2 system; 24 of the 108 resolved to a named customer record. **Read as a record, not as a count**: none of the 114 rows carries a provider message id, ten groups are retry-shaped with sub-second gaps, and the ids are unrecoverable, so the true number of distinct messages is lower by an amount nobody can state. |
| `audit_log` | 687 on 3 Sep · 742 on 5 Sep · **881 on 8 Sep** | Growing with every run. First row 14 August 2026. Was 600 on 2 Sep; 8 of the 3 Sep increase is the security probe being refused. |
| `whatsapp_contacts` | 12 on 5 Sep · **14 on 8 Sep** | One is a car enquiry. The rest are personal and unrelated-business contacts. See Part 3. |
| `users` | **1** (unchanged) | One dealership, one account, and that account is an approver — which is why four launch-critical checks cannot be run. |
| `rag_documents` | **15** (unchanged) | Sample documents, not a customer's. |
| `customer_360_profiles` | **2** (unchanged) | Nightly batch, not live. |
| `processed_messages` | 76 on 3 Sep · 73 on 5 Sep · **41 on 8 Sep** | Duplicate-suppression keys. Was 100 on 2 Sep. It has now gone **down three times**, so do not present it as a growth figure or as a message count. Nothing in the repository records what removes these rows, and a removed claim is a suppression that will not fire again. |
| `tenants` (real) | **1** (unchanged) | Tenant A. **Corrected 5 Sep: it no longer holds the unattributed-default flag** — a quarantine tenant does, and a CHECK constraint prevents the flag returning to a dealership. `tenants` therefore holds 2 rows, of which 1 is a dealership. |
| `policy_rule` | **13**, of which **0 `VERIFIED`** (5 Sep) | And **0** platform attestations. Every WhatsApp conversation therefore returns `TEMPLATE_REQUIRED`, which is the engine being honest. No regulatory or finance claim may be made until this changes. |
| the messaging layer | **0** rows in every operational table (5 Sep) | `channel_message_events`, `whatsapp_delivery_events`, `whatsapp_opt_in_event`, `whatsapp_templates`, `whatsapp_message_usage`. **It has never carried a message.** `channel_registry` holds one row, the WAHA session; there is no Cloud API row. |
| lead ingestion | **1** `lead_event` row, **0** of them marketplace or WhatsApp; **5** registered endpoints of which **2 active**, both manual entry (8 Sep) | The one event is the preflight walk-in. Facebook, Instagram and Google endpoints are registered and `disabled`; there is no WhatsApp endpoint at all. **Capture of a WhatsApp enquiry into an attributed lead is specified and not built** — `ops/whatsapp-lead-capture/SPEC.md`, unapplied. |
| recovered revenue | **0** rows carrying a value, in both `inventory_actions` and `lead_recovery_actions` (8 Sep) | And two CHECK constraints refuse such a row without a real sale attributed behind it. There is no recovered-revenue figure to quote and the database is built so that there cannot be one prematurely. |
| applied migrations | **273** (5 Sep) | And the repository now holds all 273 byte-for-byte with a restorable baseline, which it could not do before 4 September. This is a business-continuity fact, not a customer-facing one — do not present it as a feature. |

### Response times, re-measured 2 September 2026 and unchanged on 3 September

Every automated reply paired to the inbound message it answered, same contact, immediately
preceding. Still 18 replies, all of them between 31 August and 2 September — no new automated
reply has been sent since, so this sample has not grown and none of the five conditions below
is any closer to being met:

| | Seconds |
|---|---|
| Replies measured | 18 |
| Fastest | 13.3 |
| Median | 38.8 |
| Mean | 62.1 |
| 90th percentile | 135.1 |
| Slowest | 218.3 (3 min 38 s) |
| Over 100 seconds | 4 of 18 |

The single 17.8-second reply is inside that distribution. It is the third fastest of
eighteen. That is why it is no longer quoted.

### Tenant isolation, re-checked 3 September 2026

- **0** policies granting `authenticated` still use `USING (true)` on any table holding
  customer data. Every one now tests `tenant_id IN (SELECT nexus_current_tenant_ids())`.
- **Thirteen exceptions, and disclose them if asked — none holds customer data.**
  `workflow_registry` plus twelve reference tables (the deal-rescue, lead-recovery,
  attribution and policy vocabularies, and the two reason-code lists) are readable by any
  signed-in user. They hold names, statuses, units and health grades — no messages, no
  customers, no prices — and they are read-only to a signed-in user and closed to anonymous
  callers entirely. Say "the shared lists are the system's own vocabulary; your customer data
  is not shared." The product's own quality gate flags ten of these as a failure, and that
  failure is a definition question the owner has not yet settled — **it is not evidence of a
  data leak, and it is also not a clean gate.**
- **33 of 33** public views carry `security_invoker`, so they inherit the caller's
  restrictions rather than bypassing them.
- **A live corroboration, unplanned:** while this document was being written another
  workstream inserted rows for two synthetic dealerships into the same tables. Tenant A'
  own counts were unmoved by any of it — the QA dealerships' rows stayed in the QA
  dealerships. The only Tenant A counts that changed came from repair work that was
  deliberately writing into Tenant A. That is the separation doing its job on data it did
  not expect.
- **The old nullable caveat is withdrawn, and this is the change to know about.** On
  2 September `tenant_id` was nullable on all 15 tenant-scoped tables and a QA row briefly
  carried a NULL. After a migration applied 3 September it is **NOT NULL on 24 of the 26
  tenant-scoped base tables**. The two still nullable are `policy_rule` and
  `policy_rule_event`, and they are nullable **by design**: NULL there means "this rule applies
  platform-wide", and such a row is deliberately readable by every dealership. That is not an
  orphan and it is not a leak. It does mean nothing in the database stops a row belonging to
  one dealership being written with a NULL and shown to all of them, so those two tables need
  a human check before a second dealership — and they must not be "fixed" by making the column
  NOT NULL, which would delete platform scope.
- **Still blocking a second dealership:** run `select * from public.nexus_tenancy_readiness();`
  and read what it says. On 3 September it returned **one** BLOCKER — n8n writes are not
  dealership-aware — plus the two by-design WARNs above and an INFO confirming that
  `leads.email`, `customer_360_profiles.customer_id` and six other natural keys are now scoped
  per dealership. Read that BLOCKER knowing it can never clear from database work, and read
  the whole report knowing it cannot see the three second-dealership defects recorded in
  `apps/executive-dashboard/SECURITY_REGRESSION_REPORT.md`.

The database counts here are what a buyer will be told. Re-run them, scoped to the real
tenant, before each meeting.
