# NEXUS OS — 10 Customer Journeys: full-system verification plan

**Written 28 Aug 2026.** Ground truth for every future session. An agent picking this
up should read Parts 0–2 before touching anything, then execute one journey at a time.

---

## Part 0 — How this runs

### The one customer
There is no test customer base. Ali plays the customer **ten times**, always with the
same identity, and the system is wiped between runs so the two never blur:

| | |
|---|---|
| Email | `shabbir53ujjainwala@gmail.com` |
| Phone | `+918517942172` |
| WhatsApp chat id | `158510264357112@lid` (LID addressing — **not** the phone digits) |
| Dealership rep | Ali Asgher, `senior_rep`, `9941a4db-733b-4f29-8ea4-9e26df23e44b` |

Every journey uses a different **persona name** so the archived rows read sensibly, but
the email and phone never change. The persona name is what the AI agent will write into
`leads.name` from the conversation.

### Who does what

| Step | Who | Why |
|---|---|---|
| Sending WhatsApp messages as the customer | **Ali, from his phone** | The agent environment refuses to originate WhatsApp/email sends. This is not a limitation to work around — the customer side must be a real human typing. |
| Dashboard clicks (approve, reply, close deal, run workflow) | Ali or agent via browser | Either; agent must screenshot each state it claims. |
| Reading DB / n8n state, verifying, archiving, teardown | Agent | Scripted, repeatable. |
| Deciding anything irreversible | **Ali** | Purges, deletions beyond the teardown script, spend. |

### Pacing — this box is fragile
nexus-vm is an e2-micro: **958 MB RAM, ~939 MB already in swap**, and n8n runs with
`N8N_CONCURRENCY_PRODUCTION_LIMIT=5`. On 28 Aug four zombie executions held four of the
five slots and froze the whole instance for 23 hours.

Rules, not suggestions:

1. **One journey per sitting.** Never two in flight.
2. **Never run parallel agents against n8n / Supabase / WAHA.** Export to disk and audit
   locally instead.
3. **Zombie check before AND after every journey** (Part 2.4). Any execution `running`
   longer than its workflow's timeout is a leaked slot — stop it before continuing.
4. Between customer messages in a journey, leave **≥ 20 seconds**. WAHA re-delivers, and
   a burst is what created the 328-execution queue.

### Definition of done for a journey
A journey passes only when **all four** hold:
- every node on its expected path shows a green run in n8n (screenshot or execution id),
- the DB rows it should have written exist and carry the right values,
- the dashboard modules it touches render those rows correctly,
- `audit_log.status` for each workflow is `SUCCESS` — and where it is `PARTIAL`/`FAILED`,
  the `delivery.dropped` text names something we already know about and accept.

A green n8n run is **not** proof. Since 26 Aug every workflow ends in a `Delivery Report`
node that names what it actually verified; read that, not the exit code.

---

## Part 1 — Pre-flight (do these before Journey 1)

| # | Fix | Why it blocks testing | Effort |
|---|---|---|---|
| P1 | Set `users.slack_user_id` for Ali | HOT escalation posts to Slack but tags nobody. Team + escalation paths untestable. | 5 min |
| P2 | Fix Competitor Price Scraping | `competitors` table is **empty** and the last run logged *"the source was the placeholder null"* — a config bug, not just no data. Competitors module cannot be tested against an empty table. | ~1 h |
| P3 | Fix Customer 360 Gmail + Slack reads | Reports `PARTIAL — 2 of 3 claimed steps did not land` every night. Module untestable until the reads work. | ~1 h |
| P4 | JWT-gate Slack Command Center | Only public webhook still unauthenticated; has been edited 70 times and **never executed once**. | 30 min |
| P5 | Shorten the clocks (see below) | Drip is 7 days, Silence 12 h, Retention 90 days. | 20 min |
| P6 | **Accept as blocked:** Bitrix24 ERP | `403 FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN`. Paid-plan wall, not our bug. 12 of wf_108's 14 nodes still get exercised; only the CRM write does not. Goes on the go-live list. | — |

### P5 — the clock changes, and putting them back
Ali chose to shorten the timers so every node runs for real. **Record the original values
here and restore them at the end. A test config left in production is how a 7-day drip
becomes a 2-minute spam cannon.**

| Workflow | Node | Production value | Test value | Restored? |
|---|---|---|---|---|
| 7-Day Warm Lead Drip | `Wait Day 3` | 3 days | 2 min | ☐ |
| 7-Day Warm Lead Drip | `Wait Day 7` | 4 days | 2 min | ☐ |
| Phase 6 Silence Detector | `SILENCE_HOURS` in `Find Silent Leads` | 12 | 0.2 (12 min) | ☐ |
| NEXUS Retention Purge | driven by `kyc_documents.retain_until` | +7 years | back-date the row per journey | ☐ |

Retention needs no code change — set `retain_until` to a past date on the specific row.

---

## Part 2 — The harness

### 2.1 Run marker
Before a journey starts, record a watermark so "what did journey N cause" is answerable:

```sql
-- record and keep with the journey folder
select max(id) as exec_watermark from execution_entity;      -- on nexus-vm's n8n-db
select now() as t0;                                          -- on Supabase
```

Everything after `t0` / above `exec_watermark` belongs to this journey. No run-id column
is added to production tables — the timestamp is enough because only one journey is ever
in flight.

### 2.2 Archive before delete (Ali's choice)
Teardown destroys the evidence, so archive first. Per journey write
`journeys/J<N>/` containing:

```
J<N>/
  00_watermark.json        exec id + t0 + persona + unit
  10_leads.json            20_communication_logs.json
  30_kyc_documents.json    40_finance_quotes.json
  50_audit_log.json        60_purchase_history.json
  70_deals_embeddings.json 80_customer_360.json
  90_executions.json       n8n executions above the watermark, with node run data
  99_RESULT.md             pass/fail per node, per module, with screenshots
```

Save to the repo under `docs/journeys/` **and** to the Claude project, so a future
session can compare journey 3 against journey 8 without the database.

### 2.3 Teardown — exact order (FK-safe)
> [!WARNING]
> **PRODUCTION DESTRUCTIVE — DO NOT PASTE THIS INTO A SQL EDITOR.**
> The statements below delete rows from `leads`, `communication_logs`,
> `customer_360_profiles` and others. They are scoped by **e-mail only** — there is
> no tenant predicate and no project guard, so run against the wrong project they
> remove another dealership's data. DML like this is *not* stopped by the NX900/NX950
> delete guards in every path.
> Production is `dsvuoovivysszdoiorch` (ALBA CARS). Staging is `wwspuxrbiyagnrnzgate`.
> They are reproduced here **as historical evidence of the journey-lab teardown**, not
> as a runbook step. Do not execute.

```sql
-- scope: the one customer, this journey only
delete from kyc_documents        where lead_email = 'shabbir53ujjainwala@gmail.com';
delete from finance_quotes       where lead_email = 'shabbir53ujjainwala@gmail.com';
delete from communication_logs   where lead_email in (
        'shabbir53ujjainwala@gmail.com','158510264357112@lid','+918517942172@whatsapp.lead');
delete from deals_embeddings     where metadata->>'email' = 'shabbir53ujjainwala@gmail.com';
delete from purchase_history     where email = 'shabbir53ujjainwala@gmail.com';
delete from customer_360_profiles where email = 'shabbir53ujjainwala@gmail.com';
delete from whatsapp_contacts    where chat_id = '158510264357112@lid';
delete from processed_messages   where chat_id = '158510264357112@lid';
delete from leads                where email = 'shabbir53ujjainwala@gmail.com';
-- inventory: put the unit back
update inventory set status='Available' where id = '<unit>';
```
`audit_log` is **kept** — it is the run history and is already timestamped. Storage
objects under `kyc-documents/` for this customer must be deleted too, or Journey 10's
archive-gap alert will fire on ghosts.

**Why the order matters:** `leads` goes last because the WhatsApp and KYC rows are keyed
on its email; deleting the lead first orphans them and the next journey's
`Resolve Lead Identity` silently matches nothing.

### 2.4 Zombie / health check — before and after every journey
```
cd /tmp && python3 nexus_healthcheck.py          # and --stop if it reports zombies
```
Plus, because the public API does **not** list `running` and the old queued check missed
`status='new'`:
```sql
select status, count(*), min("createdAt"), max("createdAt")
from execution_entity group by 1 order by 2 desc;
```
Any `running` older than its workflow's timeout = a permanently lost concurrency slot.
Five of those and the instance is dead. Stop them with
`POST /api/v1/executions/{id}/stop` (works on `new` as well as `running`).

---

## Part 3 — The ten journeys

Inventory is real. Each journey claims a **different unit**, so stock movement is
unambiguous:

| Unit | Vehicle | Price | Days | Used by |
|---|---|---|---|---|
| NX-1011 | Lexus LX 600 2024 | 585,000 | 29 | J1 |
| NX-1003 | Toyota Fortuner 2.7 VXR | 152,000 | 18 | J2 |
| NX-1012 | Toyota Corolla 2.0 XLI | 79,000 | 16 | J3 |
| NX-1004 | Mitsubishi Pajero GLS | 128,000 | **108** | J4 |
| NX-1010 | Range Rover Sport HSE | 395,000 | **143** | J5 |
| NX-1008 | Ford Explorer Platinum | 178,000 | **102** | J6 |
| NX-1009 | Chevrolet Tahoe LT | 245,000 | 39 | J7 |
| NX-1005 | Toyota Prado TXL | 225,000 | 32 | J8 |
| NX-1006 | Hyundai Santa Fe Signature | 158,000 | 26 | J9 |
| NX-1002 | Nissan Patrol Platinum V8 | 312,000 | 49 | J10 |

RAG has exactly 15 chunks across 4 documents. Each journey asks about a **different
section**, and J9 deliberately asks something the corpus cannot answer.

---

### J1 — The clean win
**Persona:** Murtaza Kagalwala, Dubai businessman, paying cash.
**Unit:** NX-1011 Lexus LX 600, AED 585,000. **Expected verdict:** HOT → closed-won.

**WhatsApp script** (≥20 s apart):
1. `Hi, I saw the Lexus LX 600 2024 on your website. Is it still available?`
2. `What is the price and can you do better for a cash payment?`
3. `I will take it. Sending my Emirates ID now.`
4. *(send a clear, valid Emirates ID image)*

**Dashboard actions:** Leads → confirm HOT and assignment. Conversations → reply once
from the dashboard (tests WhatsApp Send). Compliance → confirm APPROVED with a
`storage_path`. Deals → mark closed-won. Inventory → unit becomes Sold.

**Ask AI:** *"What does the standard warranty cover and for how long?"*
→ must cite **Warranty Policy / Standard Coverage, warranty_policy_v4.2.pdf p.12**.

**Expected:** Router scores HOT (high budget, explicit intent, in-stock match) → Lead
Escalation fires (Slack + Gmail) → KYC APPROVED first attempt → closed-won syncs to
`deals_embeddings` and `purchase_history` → Customer 360 profile appears.

**Covers:** BDC full reply path, Master Router HOT branch (all three fan-outs), Lead
Escalation, KYC approve branch + Storage archive, WhatsApp Send, Closed-Won pgvector sync,
Customer 360, Ask-AI. Modules: Overview, Leads, Conversations, Compliance, Inventory,
Deals, Customer 360, Ask AI, Team.

---

### J2 — Rejected once, then approved
**Persona:** Sakina Rangwala, first-time buyer, needs finance, trading in a car.
**Unit:** NX-1003 Fortuner, AED 152,000. **Expected verdict:** WARM.

**WhatsApp script:**
1. `Salaam, looking for a family SUV under 160k. What do you have?`
2. `Fortuner sounds good. I have a 2019 Corolla to trade in, still paying the loan.`
3. *(send a **blurry / cropped** Emirates ID — must fail on clarity, not tampering)*
4. *(after the bot asks again, send a clear one)*

**Finance Desk:** vehicle value **45,000**, loan payoff **28,000**, credit score **710**
→ expect positive equity 17,000, healthy LTV, mid finance tier.

**Ask AI:** *"Can a customer buy an extended warranty after delivery?"*
→ **Warranty Policy / Extended Warranty, p.13**.

**Expected:** KYC attempt 1 REJECTED with a readable reason → re-upload prompt on
WhatsApp → attempt 2 APPROVED, `attempt_number` = 2. Finance quote row written with
`equity_status` positive.

**Covers:** KYC reject branch, the re-upload loop, `Count Previous KYC Rejections`,
Finance Calc positive-equity path, Router WARM branch. Modules: Compliance, Finance Desk,
Leads, Conversations.

---

### J3 — Goes quiet, gets chased
**Persona:** Huzaifa Lokhandwala, casual browser, low budget.
**Unit:** NX-1012 Corolla, AED 79,000. **Expected verdict:** COLD → drip → silence escalation.

**WhatsApp script:**
1. `how much for a small car`
2. *(then **stop replying**. This is the whole test.)*

**Expected:** Router scores COLD → `Marketing Drip (COLD)` starts (fire-and-forget,
`waitForSubWorkflow:false`) → Day-1 email → shortened wait → Day-3 email + WhatsApp →
shortened wait → Day-7 offer. Then Silence Detector (shortened to 12 min) finds no inbound
after the last outbound and writes `[SILENCE-ESCALATED]`, escalating once and **not
repeating**.

**Known gap to confirm:** the drip requires an email and a WhatsApp-only lead has none —
here the lead does have one, so the drip should run. If it fails with *"a lead arrived but
carried no email address"*, that is the open `Normalize Lead Input` gap.

**Ask AI:** *"How many days of annual leave do employees get?"*
→ **HR Handbook / Annual Leave, hr_handbook_2026.pdf p.22**. (Deliberately a staff
question, to prove RAG is not sales-only.)

**Covers:** Router COLD branch, whole drip incl. both WhatsApp legs and three email legs,
Silence Detector incl. the "already escalated, don't spam" guard. Modules: Campaigns,
Leads, Overview, Automation.

---

### J4 — KYC gives up
**Persona:** Yusuf Bandukwala, buying the aged Pajero, documents keep failing.
**Unit:** NX-1004 Pajero GLS, AED 128,000, **108 days in stock**.

**WhatsApp script:**
1. `Do you have anything cheap in a 4x4? Budget 130k max`
2. *(send a photo of a **utility bill** — not an ID at all)*
3. *(send an **expired** Emirates ID)*
4. *(send a **damaged/obscured** ID)*

**Expected:** three rejections → `Within Retry Limit?` goes false on attempt 3 →
`Slack: KYC Escalation` → `Record KYC (Escalated)` with `verdict='ESCALATED'` and
`attempt_number=3`. The loop must **terminate** — this is where it previously ran forever.

**Ask AI:** *"Who has to approve a trade-in offer above AED 100,000?"*
→ **Trade-In Appraisal SOP / Manager Approval Threshold, p.11**.

**Covers:** KYC max-attempts branch, escalation, `Record Non-Document`, aged-inventory
alert on the Pajero. Modules: Compliance, Inventory (ageing), Team, Overview badges.

---

### J5 — Underwater on the trade-in
**Persona:** Zainab Poonawala, wants the Range Rover, heavily upside-down on her current loan.
**Unit:** NX-1010 Range Rover Sport HSE, AED 395,000, **143 days — the most aged unit**.

**WhatsApp script:**
1. `Interested in the Range Rover Sport. What is your best price?`
2. `I still owe 210k on my current car which is worth about 140k. Does that work?`
3. `My credit score is not great, around 560.`

**Finance Desk:** vehicle value **140,000**, loan payoff **210,000**, credit score **560**
→ expect **negative equity −70,000**, LTV over 100 %, worst finance tier, highest
indicative APR, and the disclaimer present.

**Also test rejection:** submit vehicle value **2,000** → must be rejected with
*"vehicleValue must be a realistic vehicle valuation of at least AED 5000"*.

**Ask AI:** *"How many market sources must an appraiser check?"*
→ **Trade-In Appraisal SOP / Market Value Verification, p.10**.

**Covers:** Finance Calc negative-equity + validation-rejection paths, Competitors module
against the most-aged unit, aged-stock recommendation. Modules: Finance Desk, Competitors,
Inventory, Leads.

---

### J6 — We don't have what they want
**Persona:** Idris Chinwala, wants a Toyota Hilux — **not in stock**.
**Counter-offer unit:** NX-1008 Ford Explorer Platinum, AED 178,000, **102 days**.

**WhatsApp script:**
1. `Do you have a Toyota Hilux 2024 double cab?`
2. `Nothing else? What about something similar in that budget?`
3. `Send me what you have around 180k`

**Expected:** `search_inventory` returns **no match** and the agent must say so honestly
rather than inventing a Hilux — then offer real alternatives from actual stock. Then a
Campaign pushes the aged Explorer.

**Ask AI:** *"How is sales commission calculated?"*
→ **Sales Compensation Policy / Commission Tiers, p.4**.

**Covers:** empty-result handling in the BDC agent's Supabase tool (the hallucination
test), Competitors intel, Campaigns against aged stock. Modules: Campaigns, Competitors,
Inventory, Ask AI.

---

### J7 — Lost to a cheaper rival
**Persona:** Taher Nomanbhoy, price shopper.
**Unit:** NX-1009 Chevrolet Tahoe LT, AED 245,000. **Expected:** closed-lost.

**WhatsApp script:**
1. `Tahoe LT 2024 — what's your price?`
2. `Al Futtaim quoted me 232k for the same spec.`
3. `Thanks but I'm going with them.`

**Dashboard:** Deals → mark **closed-lost** with reason "price — competitor 13k cheaper".
Competitors → confirm the price gap is visible.

**Expected:** lead reaches `LOST`; **no** `deals_embeddings` row (that sync is closed-won
only); Silence Detector must **skip** a LOST lead (`Fetch Open Leads` filters `status != LOST`).

**Ask AI:** *"What voids the warranty?"*
→ **Warranty Policy / Warranty Voidance, p.16**.

**Covers:** closed-lost path, negative case for pgvector sync, Silence Detector exclusion,
competitor price-diff. Modules: Deals, Competitors, Leads, Overview.

---

### J8 — The returning customer
**Persona:** Murtaza Kagalwala again — **this time with history**.
**Unit:** NX-1005 Prado TXL, AED 225,000.

**Setup (part of the journey, wiped with it):** seed one `purchase_history` row — a 2024
Land Cruiser bought earlier — so the Router's `check_purchase_history` tool has something
to find.

**WhatsApp script:**
1. `Hi, I bought a Land Cruiser from you last year. Looking for a Prado for my son now.`
2. `Same terms as last time if possible.`

**Expected:** the scoring agent calls `check_purchase_history`, finds the prior purchase,
and routes **HOT regardless of stated budget** — the system prompt says returning customers
are always HOT. Customer 360 aggregates. `deals_embeddings` similarity should surface the
earlier deal.

**Ask AI:** *"If a deal is refunded, what happens to the commission already paid?"*
→ **Sales Compensation Policy / Clawback Policy, p.6**.

**Covers:** `check_purchase_history` tool, returning-customer HOT rule, Customer 360,
pgvector similarity search. Modules: Customer 360, Deals, Leads, Ask AI.

---

### J9 — Noise, abuse, and a question we cannot answer
**Persona:** wrong-number / off-topic traffic, then a genuine enquiry.
**Unit:** NX-1006 Santa Fe Signature, AED 158,000.

**WhatsApp script:**
1. *(send an **uncaptioned photo of a landscape**)* → bot must stay **silent**. This is
   the 28 Aug allowlist fix: the placeholder `[Customer sent a document image]` contains
   the word "document", which used to pass the keyword filter and answer strangers.
2. `hi` → still **silent** (no keyword, not a lead).
3. `Kya tumhare pass Santa Fe hai?` → **now it replies** ("Santa Fe" is stock).
4. *(send a photo of a **credit card**)* → must be recorded as a non-document and
   **must not** be archived as KYC.

**Then deliberately break something** — e.g. point one HTTP node at a bad host — to prove
`NEXUS Error Handler` catches it and writes a FAILED audit row. Restore immediately after.

**Ask AI:** *"Do you install home EV chargers, and what does it cost?"*
→ **nothing in the corpus.** Must answer *"I don't know / not in company documents"* with
**no citation and no invention**. This is the anti-hallucination test.

**Covers:** allowlist, prefilter, `Is Real Inbound?`, `Record Non-Document`, Error Handler,
Slack Command Center (P4), RAG negative case. Modules: Conversations, Compliance,
Automation, Ask AI, Settings.

---

### J10 — Compliance and retention
**Persona:** Fatema Bhopalwala, fleet buyer.
**Unit:** NX-1002 Nissan Patrol Platinum V8, AED 312,000.

**WhatsApp script:**
1. `We need a Patrol for our company fleet. Trade licence attached.`
2. *(send a valid Emirates ID)* → APPROVED, archived to Storage.

**Then:** back-date that `kyc_documents.retain_until` to yesterday and run **NEXUS
Retention Purge** manually.

**Expected:** Storage object deleted **first**, and only then the row marked purged. If the
Storage delete fails, `Storage Delete Succeeded?` must send it to
`Purge Failed — Rows NOT Marked` and leave the row **unmarked** — the 24 Aug fix that
stopped it creating irreversible false compliance records. Also force one archive gap
(delete a Storage object by hand, leave the row) to fire `Slack: Archive Gap Alert`.

**Ask AI:** *"How much maternity leave is granted?"*
→ **HR Handbook / Maternity Leave, p.24**.

**Covers:** Retention Purge both branches, archive-gap detection, KYC archive integrity,
Settings retention config. Modules: Compliance, Settings, Automation, Overview.

---

## Part 4 — Coverage matrix

### Workflows (21)
| Workflow | J1 | J2 | J3 | J4 | J5 | J6 | J7 | J8 | J9 | J10 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| WhatsApp BDC AI Agent | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| NEXUS Master Lead Router | ● | ● | ● | ● | ● | ● | ● | ● | | ● |
| Lead Escalation | ● | | | | | | | ● | | |
| KYC/AML Auditor | ● | ● | | ● | | | | | ● | ● |
| 7-Day Warm Drip | | | ● | | | | | | | |
| Phase 6 Silence Detector | | | ● | | | | ○ | | | |
| Finance Calc | | ● | | | ● | | | ● | | |
| Ask-AI RAG | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| WhatsApp Send (Dashboard) | ● | | | | | ● | | | | |
| Closed-Won → pgvector | ● | | | | | | ○ | ● | | |
| Customer 360 | ● | | | | | | | ● | | ● |
| Competitor Scraping | | | | | ● | ● | ● | | | |
| Inventory Ageing | | | | ● | ● | ● | | | | |
| NEXUS Retention Purge | | | | | | | | | | ● |
| NEXUS Error Handler | | | | | | | | | ● | |
| Slack Command Center | | | | ● | | | | | ● | |
| wf_108 ERP Sync | ◐ | | | | | | | ◐ | | |
| Infra Health Probe | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| Public Home / Privacy / Terms | | | | | | | | | ● | ● |

● covered ○ negative case (must **not** fire) ◐ partial — blocked at the Bitrix wall (P6)

### Dashboard modules (14)
| Module | Journeys |
|---|---|
| Overview | all — badge counts, KPI tiles, attention list |
| Leads | all — HOT/WARM/COLD, drawer, timeline, assignment |
| Conversations | all — thread keys, operator reply, silence marker |
| Compliance | J1, J2, J4, J9, J10 |
| Inventory | all; ageing bands specifically J4, J5, J6 |
| Competitors | J5, J6, J7 |
| Ask AI | all ten — a different document section each time |
| Finance Desk | J2 (positive equity), J5 (negative + rejection), J8 |
| Customer 360 | J1, J8, J10 |
| Campaigns | J3 (drip), J6 (aged-stock push) |
| Deals | J1 (won), J7 (lost), J8 |
| Automation | all — run/monitor, and J9's deliberate failure |
| Team | J1 (assignment), J4 (escalation) |
| Settings | J9, J10 (retention + timers), P5 restore checklist |

---

## Part 5 — What this plan does **not** prove

Say these out loud in the final report rather than letting a green matrix imply otherwise:

1. **The Bitrix24 CRM write.** Blocked by plan tier (P6). Everything up to it is tested.
2. **Real 7-day / 12-hour timing.** P5 shortens the clocks. The *logic* is tested; the
   production durations are only restored, not re-observed.
3. **Concurrency under load.** Ten sequential journeys never put five things in flight.
   The deadlock that froze the box on 28 Aug will not reproduce here — and must not be
   assumed fixed because these journeys passed.
4. **Multi-customer behaviour.** One identity, ten times. Anything that depends on two
   customers existing at once — the badge counts, `v_conversations` grouping, the "n=1 is
   never a statistic" guards — is untested by design.
5. **Deliverability.** Gmail accepts then bounces asynchronously; a `Delivery Report` that
   says the send landed means the API accepted it, not that a human received it. Ali must
   confirm receipt on his own phone and inbox each time.

---

## Part 6 — Corrections, verified against the live workflows (28 Aug, evening)

Parts 0–5 were written from a high-level reading. Five agents then read all 21 workflow
definitions node by node and found ~31 discrepancies; **everything below was then
re-checked by me against a fresh export of the live box**, because the agents' own base
export was two days stale. Where an agent was wrong, that is recorded too.

### 6.1 Fixed on the box during this pass

| Fix | What was wrong |
|---|---|
| **`Record Non-Document` verdict** | It wrote `verdict: 'NOT_A_DOCUMENT'`, which violates `kyc_documents_verdict_check` (`PENDING\|APPROVED\|REJECTED\|ESCALATED`). PostgREST answered 400, and because the node both swallows its errors and is terminal, **no row was ever written while the image stayed in Storage** — an archive gap manufactured by the auditor itself, and exactly what J10 hunts for. Now writes `REJECTED`, with the classification moved to the free-text `document_type`. |
| **Finance Calc Delivery Report** | The one workflow the 26 Aug sweep missed. `Log Quote` swallows its failure and `Audit Log` derived SUCCESS from whether the **arithmetic** worked — never from whether the `finance_quotes` row landed. A dropped insert reported success and left the Finance Desk empty. A `Delivery Report` now sits on both inbound paths and distinguishes `REJECTED` (a correct refusal) from `FAILED` (a lost row). |
| **Customer 360 honesty** | It reported `0 email(s), 0 Slack mention(s)` when the reads had actually *errored* — a fabricated zero written nightly into `customer_360_profiles.total_emails` as if it were a measurement. It now reports the count as **UNKNOWN** when a read fails, and the real API error reaches `audit_log.summary`. |
| **Slack Command Center gated** | Last unauthenticated public webhook, holding an AI agent with Supabase write access to `leads`. Now `SlackWebhook → Verify JWT → Auth Gate → Extract Command`. |
| **Slack Command Center retry loop** | `Model Ladder` read its attempt counter off the item, but n8n's **error output emits a fresh `{error:…}` item and carries no input json forward** — so every retry recomputed `attempt = 0` and the pair looped until the 300 s timeout, firing a full agent invocation each lap. That is precisely the load shape that has toppled this box. Now counts with `$runIndex`. |
| **`users.slack_user_id`** | Empty, so HOT escalations tagged nobody. Set to `U0BGGSN2F5H`. |

### 6.2 Corrections to this plan — apply before running anything

**a) The P5 clock table was wrong in both directions.** The drip has **four** Wait nodes,
not two, and the values are not what Part 1 claimed:

| Node | Real production value |
|---|---|
| `Wait Day 1` | 1 day (no explicit amount) |
| `Wait Day 3` | **2 days** |
| `Wait Day 5` | **2 days** |
| `Wait Day 7` | **2 days** |

Restoring from the old table would have restored fiction. `SILENCE_HOURS` is 12, as stated.

**b) The teardown SQL in Part 2.3 will fail as written.** `deals_embeddings` has no
`metadata` column (it is `id, deal_id, content, embedding, created_at`), so
`metadata->>'email'` raises `42703` — and PostgREST rejects the **whole** statement, so
inside one transaction the entire teardown rolls back. `harness/teardown.py` probes for the
column and falls back to the ids the archive collected.

**c) J4 needs FOUR failed documents, not three.** `withinLimit: nextAttempt <= MAX_ATTEMPTS`
with `MAX_ATTEMPTS = 3`, so rejections 1–3 all re-ask and only the **fourth** escalates.
Also: the utility bill in step 2 consumes no attempt at all — a non-document routes to
`Record Non-Document` and never reaches the counter. So J4's script needs a non-document
**plus four rejectable IDs**.

**d) Two opening messages would have been met with silence.** The allowlist only lets a
stranger through on a keyword, and the keyword list contains **brands** (`toyota`, `nissan`,
`lexus`, `hyundai`, `kia`, `ford`, `range rover`, `patrol`, `prado`, `land cruiser`) and
intent words (`price`, `cost`, `buy`, `finance`, `suv`, `car`…) — but **not** model names
like `santa fe`, `fortuner`, `tahoe`, `pajero`, `corolla`, `explorer`, `hilux`.

- **J4** — `"Do you have anything cheap in a 4x4? Budget 130k max"` contains no keyword.
  Use: *"What is the price of a 4x4 under 130k?"*
- **J9 step 3** — `"Kya tumhare pass Santa Fe hai?"` contains no keyword.
  Use: *"Kya tumhare pass Hyundai Santa Fe hai?"*

Every other journey's opening line already carries a keyword. Check any new wording
against the list before using it, or the test will "fail" for the wrong reason.

**e) J8 cannot be run as scripted.** `check_purchase_history` filters on email, and a
WhatsApp lead has none; but pre-seeding a lead to supply one flips `matched_lead` to true,
which switches the Router off entirely (`New Lead Worth Scoring?` requires
`matched_lead === false`). J8 must enter through the Master Router's `Webhook Catch-All`
with a Supabase session token instead. See `J6_J10_DETAIL.md` for the corrected procedure.

**f) Every HOT journey will audit `FAILED`, and that is expected.** `wf_108` swallows the
Bitrix 403 and reports FAILED, and the Master Router treats a sub-workflow reporting
failure as a critical drop. So Part 0's "every `audit_log.status` is SUCCESS" is
unreachable on J1 and J8 until the Bitrix plan is resolved. Read the `dropped[]` list and
confirm the CRM write is the only thing in it.

**g) Two workflows write no `audit_log` rows at all** — the KYC auditor (31 nodes, zero
audit posts; its verdict lives in `kyc_documents.remarks`) and `WhatsApp Send`. Do not
score them on an audit row that was never designed to exist.

### 6.3 Where an agent was wrong — do not "fix" these

- **`Should Update Price?` has no inbound edge, and that is deliberate.** Two agents
  flagged it as a defect. It was **severed on 26 Aug** because the Competitor scraper was
  rewriting `inventory.price_aed` — our own list prices — to `competitorPrice − 1` every
  night, ungated, reading its own previous write as input. A monotonic downward ratchet;
  that is how a 385,000 Land Cruiser came to be recorded at 290,000. **If anyone reconnects
  that branch, stop them.**
- **`"the source was the placeholder null"` is not a bug either.** That message is the
  guard in `Parse AI Price` working correctly: it refuses to file a bot-detection
  interstitial or a null source as a rival dealership. P2 is therefore not "fix a config
  bug" — it is "the Apify scrape is not returning usable pages", which is a different and
  harder problem.

### 6.4 Still open after this pass

| Item | State |
|---|---|
| **P2 Competitor scraper** | Not fixed. The guard is right; the *scrape* returns nothing usable. `competitors` is still empty, so the Competitors module cannot be tested. Needs an Apify session that actually returns dealership pages. |
| **P3 Customer 360 reads** | Honesty fixed, **cause not fixed** — it lives in a credential, not in the workflow. Diagnosis: Slack is likely a bot token where `search.messages` needs a *user* token with `search:read` (~80 % confidence); Gmail is either a send-only grant or another expired refresh token (60/40). The next 02:00 Asia/Dubai run now writes the real API error into `audit_log.summary` — read it and the question settles itself. |
| **WhatsApp leads have a synthetic email** | `upsert_lead` merges on email, so the scoring agent invents `<phone>@whatsapp.lead`. Escalation email and the drip's email legs will bounce against it. Fixing it properly means letting `leads` merge on phone when there is no email. |
| **Drip rejects phone-only leads** | `Normalize Lead Input` requires an email; loud failure, not silent — but a COLD WhatsApp lead still gets nothing. |
| **`Transform & Unify` still writes `total_emails: 0`** on a failed read | The right fix is to omit the key so the previous good value survives, but the upsert POSTs the whole item, so someone must confirm the column's nullability first. |
| **Slack Command Center is gated with the wrong kind of lock** | Its config is unambiguously Slack-called (`response_url`, Block Kit, the slash-command fields). A Supabase JWT makes it uncallable *by Slack* — which is acceptable only because it has never once executed. The real guard is Slack request signing (HMAC of `v0:{timestamp}:{body}` against `X-Slack-Signature`). Treat the JWT as a lock on a door nobody has walked through, not as a working integration. |
