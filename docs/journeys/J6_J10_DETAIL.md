# NEXUS OS — Journeys 6–10, execution detail

Derived from the 21 live workflow definitions in `/tmp/wf2/after/*.json` and
`/tmp/wf2/BRIEF_TRUTH.md`. Node names below are byte-exact from the JSON. Where the
JSON contradicts `NEXUS_10_JOURNEYS.md`, the contradiction is **not** written around —
it is listed in **PLAN CORRECTIONS** at the end and referenced inline as `[PC-n]`.

**Snapshot warning:** these JSONs were exported **26 Aug 05:02–05:12**. The allowlist,
`New Lead Worth Scoring?`, `Resolve Lead Identity` and `Fetch Open Leads` fixes published
on **28 Aug** are **not in these files**. J9 depends on those fixes. See `[PC-1]`.

---

## 0. Common ground for all five journeys

### 0.1 Identity
| | |
|---|---|
| email | `shabbir53ujjainwala@gmail.com` |
| phone | `+918517942172` |
| chat id | `158510264357112@lid` |
| rep | Ali Asgher, `9941a4db-733b-4f29-8ea4-9e26df23e44b` |

### 0.2 Workflow ids (for execution lookups)
```
BiyHk9ZXxJUVGbf6  WhatsApp BDC AI Agent
JnlZFAVmFAuNXVya  NEXUS Master Lead Router - AI Agent
KI6P1Qcf3MIZakNa  Lead Escalation - AI Agent
qTnh3nwWheFJbFkU  KYC/AML Document Auditor + Re-upload Loop (Phase 5)
B3TcpfzOMWj8oWgF  Phase 6 - 12-Hour Silence Detector
dhy2DDjWUqwuzHLW  Sync Closed-Won Deals to Supabase pgvector
AZkGM5M4c1uzSH7S  Customer 360 - Data Aggregation (Bitrix24)
LphiGg4iqF1bn6El  Competitor Price Scraping & Supabase Update
ZUc42jcwwHoBeEr8  Inventory Ageing Recompute
aIYwwoYStDAi9kHy  NEXUS Retention Purge
iYJkh1kztWxZXDbT  NEXUS Error Handler
VmnIXo7tM30zqawp  Slack Command Center - AI Agent
bxNBzBrcOtcFpMPn  wf_108 ERP Sync - Bitrix24 CRM
qHAtd3RckAKRBUkE  Ask-AI — RAG Query Agent
yx6m55p1Kj8V7koR  WhatsApp Send (Dashboard Reply)
unMMpeL9uuPO79pp  Finance Calc: Auto Loan Equity & Credit Score
G7FhvMY2ucW5Fg7X  7-Day Warm Lead Drip Campaign
```

### 0.3 The three BDC paths (memorise these — J6–J10 are all combinations of them)

All three start:
`WAHA Webhook (POST)` → `Prefilter` → `Is Real Inbound?`

**Is Real Inbound? = false** → dead end. Nothing else runs, nothing is written.

**true** → `Claim Message Id` → `Is New Message?` → (true) `Extract Message & Sender`
→ `Fetch All Leads` → `Resolve Lead Identity`, which fans out to **two** branches:
`Upsert WhatsApp Contact` (always) and `Is Document?`.

**Path A — text, bot replies.** `Is Document?` **false** → `Recent Outreach Check` →
`Skip Duplicate Outreach` → `Log Incoming Message` → `Reply Eligibility` →
`Should The Bot Reply?` **true** → `Model Ladder` → `AI BDC Sales Agent`
(tools `search_inventory` / `search_policy` / `finance_calculator`, models
`OpenRouter Chat Model` + `Groq Chat Model`, `Window Buffer Memory`) → `Guard Reply` →
`Send Reply via WAHA HTTP API` → `Log Conversation` → `Delivery Report` → `Audit Log` →
`New Lead Worth Scoring?` → (true) `Shape Lead For Router` → `Score New Lead (Master Router)`.

**Path B — text, bot stays silent.** identical to A up to `Should The Bot Reply?`, which
goes **false** and the branch **ends there**. `Delivery Report` and `Audit Log` are
downstream of `Log Conversation`, so **a correctly-silent run writes no audit_log row at
all.** It does still write `processed_messages`, `whatsapp_contacts` and one **inbound**
`communication_logs` row. That asymmetry is the whole basis of the J9 silence test.

**Path C — image from a matched lead.** `Is Document?` **true** (needs
`is_document === true` AND `matched_lead === true`) → `Download KYC Image` →
`Image To Base64` → `Send to KYC Auditor` (`waitForSubWorkflow: false`, so KYC is a
**separate execution**). On this path `Recent Outreach Check`, `Log Incoming Message`,
`Reply Eligibility`, `Should The Bot Reply?`, `Guard Reply`,
`Send Reply via WAHA HTTP API`, `Log Conversation`, `Delivery Report`, `Audit Log` and
`New Lead Worth Scoring?` **do not run**. No inbound comms row is written for an image.

### 0.4 Ask-AI chain (identical every journey)
`Webhook - Ask AI` → `Verify JWT` → `Auth OK?` (true) → `Extract Question` →
`Supabase Knowledge Search` (RPC `search_rag_documents`) → `Build RAG Context` →
`Docs Found?`
* **true** (`doc_count > 0`) → `AI Agent - Generate Answer` → `Format Response` →
  `Respond to Webhook` → `Delivery Report` → `Audit Log`
* **false** → `Format Response` **directly** — the LLM is never called, the answer is the
  hardcoded `no_match_message`. This is J9's anti-hallucination path.

### 0.5 Delivery Report — what a green run does and does not prove
Every terminal path ends in a `Delivery Report` Code node that emits
`delivery.status ∈ {SUCCESS, PARTIAL, FAILED}`, `delivery.verified[]`, `delivery.dropped[]`
and `delivery.note`. The rule the runner applies to **every** journey:

* A green n8n execution proves only that nothing threw. Upstream HTTP nodes carry
  `onError: continueRegularOutput`, so a failed send emits `{error: …}` and the run stays green.
* `audit_log` has **no** `delivery` column. `delivery.status` lands in `audit_log.status`
  and `delivery.note` + `dropped[]` are appended to `audit_log.summary`.
* **PASS requires reading `audit_log.summary`.** `status='SUCCESS'` with
  `summary LIKE '%all % claimed steps verified%'` is a pass. `PARTIAL`/`FAILED` is a pass
  **only** when `summary` names a drop already on the accepted list (today: the Bitrix
  403 `[PC-6]`, and the Customer 360 Gmail/Slack reads `[PC-7]`). Any other text in the
  `[...]` bracket is a fail.
* Workflows with **no** Delivery Report on the branch taken, and therefore no audit row:
  KYC/AML (writes none at all `[PC-4]`), BDC Path B and Path C, Retention Purge's
  archive-gap and dedupe-prune branches, Finance Calc, Inventory Ageing.

### 0.6 Watermark (run before every journey)
```sql
-- n8n-db on nexus-vm
select max(id) as exec_watermark from execution_entity;
-- Supabase
select now() as t0;
```
Every query below is written against `:t0`. Substitute the literal timestamp.

---

## J6 — We don't have what they want

**Persona** Idris Chinwala. **Asked for** Toyota Hilux 2024 double cab — **not in stock**.
**Counter-offer** NX-1008 Ford Explorer Platinum, AED 178,000, 102 days.

### 6.1 Expected execution chain

**Msg 1 `Do you have a Toyota Hilux 2024 double cab?`** — sender is unknown at this point,
message contains `toyota` → allowlist hit.

`BiyHk9ZXxJUVGbf6` **Path A**, with these specifics:
* `Reply Eligibility` → `bot_may_reply = true`, `reply_reason = "dealership keyword: toyota"`
* `AI BDC Sales Agent` **must** call `search_inventory` with `vehicle_model ≈ "Hilux"`.
  The tool is `inventory.model ilike %Hilux%`, limit 20 → **0 rows**.
* `Guard Reply` → `Send Reply via WAHA HTTP API` → `Log Conversation` → `Delivery Report`
  → `Audit Log` → `New Lead Worth Scoring?` **true** (inbound, `matched_lead=false`,
  `sender_phone` non-empty) → `Shape Lead For Router` → `Score New Lead (Master Router)`.

`JnlZFAVmFAuNXVya` (sub-execution, `origin = 'whatsapp-bdc'`):
`Called Internally` → `Validate & Enrich Input` → `Model Ladder` → `AI Lead Scoring Agent`
(`Supabase Lead Lookup`, `check_purchase_history` → 0 rows, `upsert_lead`) →
`Parse AI Decision` → `Intent Switch`.
* If **WARM**: output 1 → `WARM: Already In A Live Chat?` **true** (origin is `whatsapp-bdc`)
  → `Delivery Report` → `Audit Log`. `WhatsApp BDC (WARM)` **must NOT run** — the customer
  is already in a live thread.
* If **HOT**: output 0 fans out to `Slack Router (HOT)`, `ERP Sync (HOT)` and
  `HOT: Already In A Live Chat?` **true** → `Delivery Report`.
  `WhatsApp Outreach (HOT)` **must NOT run**.

**Msg 2 `Nothing else? What about something similar in that budget?`** and
**Msg 3 `Send me what you have around 180k`** — sender is now a matched lead
(`matched_lead=true`), so `Reply Eligibility` short-circuits on `'known lead'`.
Path A again; `New Lead Worth Scoring?` now goes **false** (condition
`matched_lead === false` fails) → `Shape Lead For Router` and
`Score New Lead (Master Router)` **must NOT run** on msgs 2 and 3.

**Dashboard reply (WhatsApp Send test)** `yx6m55p1Kj8V7koR`:
`Dashboard Send Webhook` → `Verify JWT` → `Auth OK?` (true) → `Prepare Send` →
`Has chat_id and text?` (true) → `Send via WAHA` → `Log Outbound` → `Delivery Report` →
`Respond Sent`. `Respond Unauthorized`, `Respond Bad Request`, `Respond Send Failed`
**must NOT run**.

**Competitors** `LphiGg4iqF1bn6El` (manual run):
`Schedule Trigger` → `Fetch Local Inventory` (returns **all** units, not just NX-1008) →
`Build Apify Query` → `Apify - Search Competitor Price` → `Extract Price with AI` →
`Parse AI Price` → `Is This Real Intel?`
* true → `Log Competitor Intel` → `Delivery Report` → `Audit Log`
* false → `Audit Log` directly, `status='REJECTED'`
`Should Update Price?`, `Build Update Payload`, `Update Prices in Supabase` **can never
run** — nothing connects into `Should Update Price?` `[PC-8]`.

**Inventory ageing** `ZUc42jcwwHoBeEr8`: `Every night at 00:15` → `Recompute Inventory Ageing`
(RPC `recompute_inventory_derived`) → `Audit Log`. Status is a **hardcoded** `'SUCCESS'`;
this workflow has no Delivery Report `[PC-9]`.

**Campaign push of the aged Explorer** is a **dashboard-only** action. No workflow in the
21 targets aged stock `[PC-10]`.

**Ask AI** — *"How is sales commission calculated?"* → `Docs Found?` **true** branch.

### 6.2 Verification SQL
```sql
-- (a) the Hilux really is not in stock — the premise of the test
select id, model, status, days_in_stock, price_aed
from inventory where model ilike '%hilux%';                -- expect 0 rows

-- (b) the counter-offer unit exists and is what the agent should have reached for
select id, model, status, days_in_stock, price_aed
from inventory where id = 'NX-1008';                       -- Ford Explorer Platinum, 178000, 102

-- (c) the outbound reply the agent actually sent
select created_at, direction, message
from communication_logs
where lead_email in ('shabbir53ujjainwala@gmail.com','158510264357112@lid')
  and created_at > :t0
order by created_at;

-- (d) HALLUCINATION GATE: no outbound message may assert a Hilux in stock
select count(*) as hilux_claims
from communication_logs
where created_at > :t0 and direction = 'outbound'
  and message ilike '%hilux%'
  and message !~* '(do not|don''t|dont|not) (currently )?(have|stock|carry)';
-- expect 0. Any row here must be read by a human before it is called a pass.

-- (e) the lead row
select id, name, email, phone, source, vehicle_interest, budget_aed,
       status, ai_score, assigned_to, assigned_to_id, created_at
from leads where email = 'shabbir53ujjainwala@gmail.com';

-- (f) audit trail for this journey
select workflow, status, lead_email, lead_score, intent, summary, logged_at
from audit_log where logged_at > :t0 order by logged_at;

-- (g) competitors intel written by the scrape run
select id, competitor, model, price_aed, our_price_aed, price_diff_aed,
       ai_recommendation, scraped_at
from competitors where scraped_at > :t0 order by scraped_at;

-- (h) dashboard-sent message (note: keyed on the CHAT ID, not the email)
select created_at, lead_email, direction, message
from communication_logs
where lead_email = '158510264357112@lid' and direction = 'outbound'
  and created_at > :t0;
```

### 6.3 Pass / fail
| # | Criterion |
|---|---|
| 6.1 | `inventory` has **0** rows matching `%hilux%`. If this fails the journey is invalid, not failed. |
| 6.2 | Query (d) returns `hilux_claims = 0`. |
| 6.3 | At least one outbound `communication_logs.message` after `:t0` contains a model string that also appears in `inventory.model` for a row with `status='Available'`. Alternatives must be **real stock**. |
| 6.4 | `search_inventory` appears in the `AI BDC Sales Agent` node run data for msg 1 with 0 returned rows. If the tool was never called, fail regardless of how good the reply reads. |
| 6.5 | `leads` has exactly **1** row for the email; `leads.source` non-null; `leads.status ∈ {HOT,WARM,COLD}`. |
| 6.6 | `audit_log` has exactly one `workflow='Master Router'` row after `:t0`, `intent` equal to `leads.status`, and `summary` ending in the delivery note. Exactly one Master Router execution above the watermark — msgs 2 and 3 must not create more. |
| 6.7 | Master Router `delivery.dropped[]` (in `summary`) must **not** contain "WhatsApp outreach to the customer". If it does, `origin` was not `whatsapp-bdc` and the customer got a canned welcome on top of a live conversation. |
| 6.8 | `audit_log` row `workflow='WhatsApp BDC Agent'`, `status='SUCCESS'`, summary `all 3 claimed steps verified`. Note this row has `lead_email = NULL` by design. |
| 6.9 | WhatsApp Send: `Respond Sent.status` = `'sent'` (not `'sent_but_not_logged'`), and query (h) returns ≥1 row. |
| 6.10 | Competitors: for every row in (g), `competitor` is not `'unknown'`, not `'null'`, and does not match the bot-interstitial list. `price_diff_aed = price_aed - our_price_aed`. A run producing 0 usable rows is a **P2 failure**, not a J6 failure — record it and move on. |
| 6.11 | Ask AI: `documents_consulted > 0`, answer cites *Sales Compensation Policy / Commission Tiers*, `audit_log.workflow='Ask-AI RAG Query'` `status='SUCCESS'`. |

### 6.4 What may legitimately differ
* **MUST hold:** `search_inventory` is called; it returns 0 rows for Hilux; the reply
  states plainly that we do not have it; every vehicle named in the reply exists in
  `inventory`; no price is invented for a Hilux.
* **May vary:** wording, tone, language mirroring, how many alternatives are offered
  (system prompt says two or three), whether the Explorer specifically is among them —
  the agent picks by `ilike` on whatever model string it infers, so a Fortuner or Patrol
  suggestion is not a failure. The `Intent Switch` verdict (HOT vs WARM) may vary run to
  run; both are acceptable as long as 6.6/6.7 hold. `ai_score` will vary.
* **Not acceptable as "LLM variation":** naming a Hilux trim, quoting a Hilux price,
  saying "let me check and get back to you" and nothing else (the system prompt forbids
  leaving it unanswered).

---

## J7 — Lost to a cheaper rival

**Persona** Taher Nomanbhoy. **Unit** NX-1009 Chevrolet Tahoe LT, AED 245,000.
**Verdict** closed-lost. This journey is defined as much by what must **not** happen.

### 7.1 Expected execution chain

**Msgs 1–3** — `BiyHk9ZXxJUVGbf6` **Path A** three times.
Msg 1 (`Tahoe LT 2024 — what's your price?`) hits the allowlist on `price`;
`New Lead Worth Scoring?` **true** → Master Router once. Msgs 2 and 3 are from a matched
lead → Path A, `New Lead Worth Scoring?` **false**, no further Router runs.

**Dashboard: mark closed-lost** — sets `leads.status = 'LOST'`.

**Nodes that must NOT run — the point of J7:**
* Entire workflow `dhy2DDjWUqwuzHLW` (Sync Closed-Won Deals to Supabase pgvector).
  **There must be zero executions of `dhy2DDjWUqwuzHLW` above the watermark.**
  Specifically `Format Deal Text`, `OpenRouter - Generate Embedding`,
  `Parse Embedding Response`, `Supabase (Postgres) - Upsert Vector`, `Record Purchase`.
  **This workflow contains no closed-won guard of any kind `[PC-2]`** — if the dashboard
  posts a closed-lost deal to `Webhook - New Deal`, a `deals_embeddings` row **and** a
  `purchase_history` row are written and nothing stops it. The test is therefore of the
  *dashboard*, and the falsifiable artefact is the absence of an execution.
* `Phase 6 - 12-Hour Silence Detector` must run and must **not** pick this lead up.
  `Fetch Open Leads` filters `status neq LOST`, so the lead is excluded at the source and
  `Find Silent Leads` emits nothing for it.

**Silence Detector expected chain (negative case)**
`Run Manually` → `Fetch Open Leads` → `Fetch Recent Comms` → `Find Silent Leads` →
`Loop Over Silent Leads`. With no silent leads the loop's "done" output (`main:0`) is
**not connected to anything**, so the execution ends there. `Trigger Lead Escalation`,
`Mark as Escalated`, `Delivery Report` and `Audit Log` **must not run**, and **no
audit_log row is produced** `[PC-11]`.

**Competitors** `LphiGg4iqF1bn6El` — same chain as J6.

**Ask AI** — *"What voids the warranty?"* → `Docs Found?` **true**.

### 7.2 Verification SQL
```sql
-- (a) the lead reached LOST
select id, name, email, status, ai_score, assigned_to_id, escalated_at
from leads where email = 'shabbir53ujjainwala@gmail.com';
-- expect exactly 1 row, status = 'LOST'

-- (b) NEGATIVE: no vector row for this customer
select deal_id, metadata->>'email' as email
from deals_embeddings
where metadata->>'email' = 'shabbir53ujjainwala@gmail.com'
   or deal_id ilike '%shabbir53ujjainwala%';
-- expect 0 rows

-- (c) NEGATIVE: no purchase recorded for a deal we lost
select deal_id, customer_name, email, vehicle, amount_aed, purchase_date
from purchase_history where email = 'shabbir53ujjainwala@gmail.com';
-- expect 0 rows

-- (d) NEGATIVE: closed-won sync left no audit trail
select count(*) from audit_log
where workflow = 'Sync Closed-Won to pgvector' and logged_at > :t0;
-- expect 0

-- (e) NEGATIVE: the silence detector did not chase a lost lead
select count(*) as silence_rows from communication_logs
where lead_email in ('shabbir53ujjainwala@gmail.com','158510264357112@lid')
  and message like '[SILENCE-ESCALATED]%';
-- expect 0

-- (f) NEGATIVE: no escalation was recorded on the lead
select escalated_at from leads where email = 'shabbir53ujjainwala@gmail.com';
-- expect NULL

-- (g) POSITIVE: the silence detector actually ran (see 7.3)
select workflow, status, summary, logged_at from audit_log
where logged_at > :t0 order by logged_at;

-- (h) competitor gap on the Tahoe
select competitor, model, price_aed, our_price_aed, price_diff_aed,
       ai_recommendation, scraped_at
from competitors where model ilike '%tahoe%' order by scraped_at desc;

-- (i) our price, for the diff arithmetic
select id, model, price_aed, days_in_stock, status
from inventory where id = 'NX-1009';
```

### 7.3 Pass / fail — "correctly skipped" vs "never ran"
| # | Criterion |
|---|---|
| 7.1 | (a) returns 1 row, `status='LOST'`. |
| 7.2 | (b), (c), (d), (e), (f) all return 0 rows / NULL. |
| 7.3 | **Zero** executions of workflow `dhy2DDjWUqwuzHLW` above the exec watermark. This is the real assertion — (b)/(c) being empty is also consistent with the sync running and failing. |
| 7.4 | **The Silence Detector must have an execution above the watermark**, id recorded, status `success`. Inside it: `Fetch Open Leads` produced ≥1 item, **none** of which has `email = 'shabbir53ujjainwala@gmail.com'`; `Find Silent Leads` produced **0** items; `Loop Over Silent Leads` ran; `Trigger Lead Escalation` shows **no run data**. That combination is "correctly skipped". |
| 7.5 | If `Fetch Open Leads` produced 0 items overall, or the workflow has no execution above the watermark, the result is **INCONCLUSIVE, not pass** — the detector was broken or never triggered and proved nothing about LOST filtering. |
| 7.6 | Absence of an `audit_log` row for `Phase 6` after `:t0` is **expected** on the skip path and must not be reported as a failure `[PC-11]`. |
| 7.7 | Competitors: (h) has ≥1 row with `scraped_at > :t0`, `our_price_aed = 245000`, `price_diff_aed = price_aed - our_price_aed`, `ai_recommendation` beginning `UNDERCUT:` when `price_diff_aed < 0` and `HOLD:` otherwise. A row asserting Al Futtaim at 232,000 can only have been inserted by hand `[PC-12]` — if present, it must carry that provenance in `competitor` or the journey record. |
| 7.8 | Ask AI: answer cites *Warranty Policy / Warranty Voidance p.16*, `documents_consulted > 0`. |

### 7.4 What may legitimately differ
* **MUST hold:** the agent does not promise to match a competitor price below
  `cost_aed`, and does not offer more than 8% off (guardrail in the BDC system prompt:
  245,000 × 0.92 = **219,600** is the floor from discount alone, and never below `cost_aed`).
* **May vary:** whether the agent counters with a value bundle or a discount, the exact
  discount inside 8%, whether it calls `search_inventory` once or twice, and the final
  `Intent Switch` verdict on msg 1.
* Scraped competitor identity and price are entirely non-deterministic; only the schema
  and the sign arithmetic in 7.7 are assertable.

---

## J8 — The returning customer

**Persona** Murtaza Kagalwala, with history. **Unit** NX-1005 Prado TXL, AED 225,000.
**Expected:** HOT because of `check_purchase_history`, regardless of stated budget.

### 8.1 A blocking structural problem, and the procedure that works

`check_purchase_history` filters `purchase_history.email = eq.<value the agent supplies>`.
The agent only has `lead.email`. On the WhatsApp path `Shape Lead For Router` sets
`email: ctx.lead_email`, which is `null` for an unmatched sender — and
`New Lead Worth Scoring?` requires `matched_lead === false`, so **pre-seeding the lead row
to supply an email switches the Router off entirely**. The WhatsApp entry point therefore
cannot exercise the returning-customer rule. `[PC-3]`

**Run J8 in this order:**
1. Seed `purchase_history` with `email = 'shabbir53ujjainwala@gmail.com'`.
2. **POST the Master Router webhook directly** (`Webhook Catch-All`, JWT-gated) with
   `{name, email, phone, vehicle_interest, budget_aed, source}` and **no** `origin` —
   this is the marketing/dashboard intake path and is the only path that hands the agent
   a real email. `budget_aed` deliberately low (e.g. 90000) so "HOT regardless of budget"
   is a real assertion.
3. Then send WhatsApp msgs 1–2. By now the lead exists with the matching phone, so
   `Resolve Lead Identity` matches, `Reply Eligibility` short-circuits on `'known lead'`,
   and `New Lead Worth Scoring?` is **false** — exactly one Router execution for J8.

### 8.2 Expected execution chain

**Seed**
```sql
insert into purchase_history (deal_id, customer_name, email, phone, vehicle, amount_aed, purchase_date)
values ('j8-seed-landcruiser-2024', 'Murtaza Kagalwala',
        'shabbir53ujjainwala@gmail.com', '+918517942172',
        'Toyota Land Cruiser 2024', 385000, '2025-06-15');
```

**`JnlZFAVmFAuNXVya`** — `Webhook Catch-All` → `Verify JWT` → `Auth Gate` →
`Validate & Enrich Input` → `Model Ladder` → `AI Lead Scoring Agent`.
Required tool calls in the node run data, in this order: `Supabase Lead Lookup`,
**`check_purchase_history`** (returns the seeded row), `upsert_lead`.
→ `Parse AI Decision` (`intent='HOT'`, `score` 90–100, `parse_failed=false`) →
`Intent Switch` **output 0** → fans out to:
* `Slack Router (HOT)` → sub-execution `KI6P1Qcf3MIZakNa`
* `ERP Sync (HOT)` → sub-execution `bxNBzBrcOtcFpMPn`
* `HOT: Already In A Live Chat?` — `origin` is `'external'` here, so **false** →
  `WhatsApp Outreach (HOT)` → sub-execution `BiyHk9ZXxJUVGbf6`
→ `Delivery Report` → `Audit Log`.
`WARM: Already In A Live Chat?`, `WhatsApp BDC (WARM)`, `Marketing Drip (COLD)` and
`Slack: Unclassified Lead` **must NOT run**.

**`KI6P1Qcf3MIZakNa`** — `Called by Master Router` → `Fetch Escalated Lead` →
`Found The Lead?` **true** → `Model Ladder` → `AI Escalation Analyst`
(tools `get_lead_timeline`, `find_available_rep`) → fans out to
`Email: Escalation Alert (Gmail)` **and** `Send a message` (Slack);
`Email: …` → `Audit Log` → `Mark Lead Escalated` → `Delivery Report` → `Return Result`.
`No Lead To Escalate` **must NOT run**.

**`bxNBzBrcOtcFpMPn`** — `Called by Master Router` → `Map Lead to Bitrix24 Lead` →
`Find Existing Lead` → `Decide Update or Create` → `Already in Bitrix24?` →
`Create Bitrix24 Lead` (or `Update…`) → `Build Audit Row` → `Delivery Report` →
`Log to Supabase audit_log`. **Expected to end FAILED** at the Bitrix 403 `[PC-6]`.

**`BiyHk9ZXxJUVGbf6` outreach leg** — `Called by Master Router` →
`Extract Message & Sender` (builds `INITIAL_OUTREACH:` text, `direction='outbound'`) →
`Fetch All Leads` → `Resolve Lead Identity` → `Is Document?` **false** →
`Recent Outreach Check` → `Skip Duplicate Outreach` (returns `[]` and **halts the branch**
if any outbound row exists for this lead in the last 24 h) → `Log Incoming Message` →
`Reply Eligibility` (`reply_reason = 'outreach initiated by the router'`) →
`Should The Bot Reply?` true → … → `Delivery Report` → `Audit Log`.

**Then WhatsApp msgs 1–2** — Path A, `New Lead Worth Scoring?` false.

**Closed-won (if the deal is closed)** — `dhy2DDjWUqwuzHLW`: `Webhook - New Deal` →
`Verify JWT` → `Format Deal Text` → two branches: `OpenRouter - Generate Embedding` →
`Parse Embedding Response` → `Supabase (Postgres) - Upsert Vector` → `Delivery Report` →
`Audit Log`; and `Record Purchase`. Note `Delivery Report` explicitly **cannot** verify
`Record Purchase` and says so in `delivery.not_verified` — check `purchase_history` in SQL.

**Customer 360** `AZkGM5M4c1uzSH7S` (manual run) — `Schedule Trigger` →
`Get Customer Directory` (`v_customer_directory`) → `Normalise Customers` →
`Split In Batches` → `Gmail - Get Emails` + `Slack - Search Mentions` →
`Merge Customer Data` → `Transform & Unify` → `Supabase - Upsert Profile` →
`Delivery Report` → `Audit Log`, looping. Expect `PARTIAL` `[PC-7]`.

**Ask AI** — *"If a deal is refunded, what happens to the commission already paid?"*

### 8.3 Verification SQL
```sql
-- (a) the seed the whole journey depends on
select deal_id, email, vehicle, amount_aed, purchase_date
from purchase_history where email = 'shabbir53ujjainwala@gmail.com';
-- expect exactly the seeded row BEFORE the router runs

-- (b) HOT regardless of budget — the core assertion
select id, name, email, phone, source, vehicle_interest, budget_aed,
       status, ai_score, assigned_to, assigned_to_id, response_time_minutes,
       escalated_at, created_at
from leads where email = 'shabbir53ujjainwala@gmail.com';
-- expect status='HOT' AND ai_score >= 90 AND budget_aed <= 100000

-- (c) the router's own verdict
select workflow, status, lead_name, lead_email, lead_score, intent, summary, logged_at
from audit_log where workflow = 'Master Router' and logged_at > :t0;
-- expect exactly 1 row, intent='HOT', lead_score >= 90

-- (d) escalation landed
select workflow, status, lead_email, summary, logged_at
from audit_log where logged_at > :t0
  and workflow in ('Lead Escalation','Lead Escalation - AI Agent')
order by logged_at;
select escalated_at from leads where email = 'shabbir53ujjainwala@gmail.com';
-- expect escalated_at NOT NULL

-- (e) the accepted Bitrix failure, named
select workflow, status, summary from audit_log
where logged_at > :t0 and summary ilike '%bitrix%';

-- (f) outreach + conversation
select created_at, lead_email, direction, message
from communication_logs
where lead_email in ('shabbir53ujjainwala@gmail.com','158510264357112@lid',
                     '+918517942172@whatsapp.lead')
  and created_at > :t0 order by created_at;

-- (g) closed-won artefacts, only if the deal was closed
select deal_id, metadata->>'email' as email from deals_embeddings
where metadata->>'email' = 'shabbir53ujjainwala@gmail.com';
select deal_id, email, vehicle, amount_aed from purchase_history
where email = 'shabbir53ujjainwala@gmail.com' order by purchase_date;
-- expect 2 rows now: the seed and the new Prado

-- (h) Customer 360
select id, customer_id, name, email, phone, total_emails,
       total_slack_messages, last_synced_at
from customer_360_profiles where email = 'shabbir53ujjainwala@gmail.com';

-- (i) inventory movement
select id, model, status, days_in_stock, price_aed from inventory where id = 'NX-1005';
```

### 8.4 Pass / fail
| # | Criterion |
|---|---|
| 8.1 | Node run data for `AI Lead Scoring Agent` shows a `check_purchase_history` call whose result contains `deal_id = 'j8-seed-landcruiser-2024'`. **If the tool was not called, J8 fails even if the lead is HOT** — a HOT verdict reached without the history read proves nothing. |
| 8.2 | (b): `status='HOT'` and `ai_score >= 90` while `budget_aed <= 100000`. |
| 8.3 | (c): exactly one Master Router row, `intent='HOT'`. Its `summary` must contain `Slack Router` / `ERP Sync` accounting; the only permitted entry in `dropped[]` is the Bitrix one. |
| 8.4 | Master Router `audit_log.status` will be **FAILED** because `ERP Sync (HOT)` returns `status='FAILED'` and the Router's `Delivery Report` treats a sub-workflow reporting `fail` as a critical drop `[PC-6]`. That is an **accepted** FAILED. Any other dropped entry is a real failure. |
| 8.5 | `leads.escalated_at` is not null; a Slack message exists in `#sales-hot-leads` tagging Ali (requires P1). |
| 8.6 | (f) contains at least one outbound row. If `Skip Duplicate Outreach` halted the branch, the run is still a pass but must be recorded as *outreach suppressed by the 24 h guard* — check its node output is `[]`. |
| 8.7 | If the deal was closed-won: (g) returns exactly 1 `deals_embeddings` row and **2** `purchase_history` rows. `audit_log` row `workflow='Sync Closed-Won to pgvector'`, `status='SUCCESS'`, and `summary` must contain the `Not covered by this check: purchase_history row (Record Purchase)` clause — confirm the row exists in SQL, not from the report. |
| 8.8 | Customer 360: (h) returns a row with `last_synced_at > :t0`. `audit_log.status='PARTIAL'` with `dropped` naming Gmail and Slack is **accepted** `[PC-7]`; `FAILED` (the profile upsert itself) is not. |
| 8.9 | Ask AI cites *Sales Compensation Policy / Clawback Policy p.6*. |

### 8.5 What may legitimately differ
* **MUST hold:** `check_purchase_history` is called and returns the seed; `intent='HOT'`;
  `score >= 90`. The system prompt makes this deterministic in intent even though the
  model is not.
* **May vary:** `ai_score` inside 90–100, the `reason` text, whether `Supabase Lead Lookup`
  is called once or twice, the escalation email's wording and which rep
  `find_available_rep` returns, and the exact `vehicle_interest` string the agent writes.
* **Watch for:** `Parse AI Decision.parse_failed = true`. If true, the intent came from a
  regex over prose, not from the agent. Record it; a HOT reached that way is **not** proof
  the returning-customer rule fired — cross-check 8.1.

---

## J9 — Noise, abuse, and a question we cannot answer

**Unit** NX-1006 Santa Fe Signature, AED 158,000. Four inbound events, one deliberate
break, one unanswerable RAG question. **This is the journey most likely to "pass" by being
broken.**

### 9.1 Step 1 — uncaptioned landscape photo → MUST stay silent

**Expected chain (live workflows, with the 28 Aug fix):**
`WAHA Webhook (POST)` → `Prefilter` (`is_real_inbound=true`) → `Is Real Inbound?` true →
`Claim Message Id` → `Is New Message?` true → `Extract Message & Sender`
(`is_document=true`, `message='[Customer sent a document image]'`) → `Fetch All Leads` →
`Resolve Lead Identity` (`matched_lead=false`) → fan-out:
* `Upsert WhatsApp Contact` — **runs**
* `Is Document?` **false** (needs `matched_lead` too) → `Recent Outreach Check` →
  `Skip Duplicate Outreach` → `Log Incoming Message` — **runs** →
  `Reply Eligibility` → `bot_may_reply = false`,
  `reply_reason = 'not a lead and no dealership keyword — staying silent'` →
  `Should The Bot Reply?` **false** → **branch ends**

**Must NOT run:** `Model Ladder`, `AI BDC Sales Agent`, `Guard Reply`,
`Send Reply via WAHA HTTP API`, `Log Conversation`, `Delivery Report`, `Audit Log`,
`New Lead Worth Scoring?`, `Shape Lead For Router`, `Score New Lead (Master Router)`,
`Download KYC Image`, `Image To Base64`, `Send to KYC Auditor`.

> **`[PC-1]` — this step FAILS against `/tmp/wf2/after/BiyHk9ZXxJUVGbf6.json`.** In that
> 26 Aug snapshot `Reply Eligibility`'s keyword list still contains `"document"`, and the
> placeholder text contains it, so `bot_may_reply` is **true** and the bot replies to a
> stranger. Before running J9, confirm the live `Reply Eligibility` blanks the placeholder
> before the keyword test, and that `New Lead Worth Scoring?` carries a fourth condition
> excluding the placeholder.

### 9.2 Step 2 — bare `hi` → MUST stay silent
Same chain. `Extract Message & Sender` sets `message='hi'`, `is_document=false`.
`Reply Eligibility` finds no keyword (`hi` matches nothing in the list) → silent.
Same must-not-run list.

### 9.3 Step 3 — `Kya tumhare pass Santa Fe hai?` → MUST reply
**As scripted this message hits nothing.** Replaying the exact keyword list against
`kya tumhare pass santa fe hai?` yields **zero** matches: the list contains `hyundai` but
not `santa fe`, and `pass`/`hai` are not keywords. The sender is still unmatched here, so
`bot_may_reply` is **false** and the bot stays silent — J9 step 3 fails as written.
`[PC-13]` Either add `santa fe` to the allowlist, or use a phrasing carrying a listed
keyword: `Kya tumhare pass Santa Fe car hai? price kya hai?` matches `car` and `price`.
Once it fires: full **Path A**, then `New Lead Worth Scoring?` **true** →
`Shape Lead For Router` → `Score New Lead (Master Router)` → one Master Router execution
→ `leads` row created.

### 9.4 Step 4 — credit-card photo → recorded as a non-document, NOT archived as KYC
The sender is a matched lead by now (step 3 created the row), so:
`Resolve Lead Identity` → `Is Document?` **true** → `Download KYC Image` →
`Image To Base64` → `Send to KYC Auditor` (separate execution).

`qTnh3nwWheFJbFkU`: `Called by Another Workflow` → `Prepare Document` →
`OpenRouter Vision (KYC Analysis)` → `Parse JSON Output` → `Prepare Archive` →
`Archive to Storage` → `Merge Archive Result` → `Is An Identity Document?` **false**
(`parsed.isIdentityDocument !== true`) → `Delivery Report (Non-Document)` →
`Record Non-Document`.

**Must NOT run:** `Validation Check`, `Approved`, `Rejected`,
`Count Previous KYC Rejections`, `Decide: Re-ask or Escalate`, `Within Retry Limit?`,
`WhatsApp: Request Re-upload`, `Slack: KYC Escalation`, `WhatsApp: KYC Approved`,
`Record KYC (Approved)`, `Record KYC (Rejected)`. **Nothing is sent to the customer on
this branch** — that is by design.

> **`[PC-5]` — `Record Non-Document` writes `verdict: 'NOT_A_DOCUMENT'`, which violates
> the stated `verdict` CHECK (`PENDING|APPROVED|REJECTED|ESCALATED`).** The node carries
> `onError: continueRegularOutput` and is terminal, so the 400 is swallowed and **no row
> is written and nothing reports it**. Expect `kyc_documents` to have **0** new rows for
> step 4 until this is fixed. Note the image **is** uploaded to Storage before the check,
> so a credit-card photo does land in the `kyc-documents` bucket — it must be removed in
> teardown or J10's archive-gap check will see it.

### 9.5 Step 5 — deliberate break → Error Handler
Break exactly one HTTP node (recommended: `Log Conversation` in `BiyHk9ZXxJUVGbf6`, URL
host → `https://127.0.0.1:1/…`). **Note that node swallows**, so it will produce
`delivery.status = 'PARTIAL'`, not a failed execution. To force the **Error Handler**, the
broken node must be one that does *not* swallow — use `Recent Outreach Check`
(`onError: None`) or `Download KYC Image`.

Chain: broken workflow throws → `iYJkh1kztWxZXDbT` `Any Workflow Failed` →
`Build Failure Row` (`status` literal `'FAILED'`) → `Log Failure to audit_log`.
**Restore the node immediately and record the restore in the journey folder.**

### 9.6 Step 6 — RAG with no answer in the corpus
*"Do you install home EV chargers, and what does it cost?"*
Expected: `Supabase Knowledge Search` returns 0 rows → `Build RAG Context` sets
`doc_count=0`, `no_match=true` → `Docs Found?` **false** → `Format Response` →
`Respond to Webhook` → `Delivery Report` → `Audit Log`.
**`AI Agent - Generate Answer` and `AI Answer - Backup Models` must NOT run.**

### 9.7 Verification SQL
```sql
-- (A) PROOF OF LIFE for the two silent steps — these rows MUST exist
select id, created_at, lead_email, direction, message
from communication_logs
where lead_email = '158510264357112@lid' and direction = 'inbound'
  and created_at > :t0
order by created_at;
-- expect >= 2 rows: one with message = '[Customer sent a document image]', one 'hi'

select chat_id, source, processed_at from processed_messages
where chat_id = '158510264357112@lid' and processed_at > :t0
order by processed_at;
-- expect >= 4 rows (one per inbound event)

select chat_id, phone, push_name, lead_email, last_seen from whatsapp_contacts
where chat_id = '158510264357112@lid';
-- expect 1 row, last_seen > :t0

-- (B) PROOF OF SILENCE — before the step-3 reply there must be NO outbound
select count(*) as premature_outbound
from communication_logs
where lead_email in ('158510264357112@lid','shabbir53ujjainwala@gmail.com')
  and direction = 'outbound'
  and created_at > :t0
  and created_at < :t_msg3;          -- timestamp of the Santa Fe message
-- expect 0

-- (C) PROOF THE STRANGER WAS NOT PROMOTED TO A LEAD before step 3
select id, name, email, phone, source, vehicle_interest, status, ai_score, created_at
from leads where phone like '%8517942172%' or email = 'shabbir53ujjainwala@gmail.com';
-- expect 0 rows until step 3; then exactly 1
-- and vehicle_interest must NOT be '[Customer sent a document image]'

-- (D) step 3 did reply
select created_at, direction, message from communication_logs
where lead_email in ('158510264357112@lid','shabbir53ujjainwala@gmail.com')
  and created_at > :t_msg3 order by created_at;
-- expect >= 1 outbound

-- (E) step 4 non-document record
select id, lead_email, verdict, storage_path, retain_until, attempt_number,
       max_attempts, void_reason, voided_at, purged_at
from kyc_documents
where lead_email in ('shabbir53ujjainwala@gmail.com','158510264357112@lid')
   or chat_id = '158510264357112@lid';
-- see PC-5: expect 0 rows on the current definition; 1 row with
-- verdict='NOT_A_DOCUMENT', void_reason NOT NULL, voided_at NOT NULL once fixed

-- (F) step 4 must NOT have produced a KYC verdict
select count(*) from kyc_documents
where lead_email = 'shabbir53ujjainwala@gmail.com'
  and verdict in ('APPROVED','REJECTED','ESCALATED','PENDING');
-- expect 0

-- (G) the deliberate failure
select workflow, status, summary, logged_at from audit_log
where status = 'FAILED' and logged_at > :t0 order by logged_at desc;
-- expect >= 1 row, summary containing 'Failed at node: <the node you broke>'
--                 and 'Execution <id>'

-- (H) the unanswerable RAG question
select workflow, status, summary, logged_at from audit_log
where workflow = 'Ask-AI RAG Query' and logged_at > :t0 order by logged_at desc limit 5;
-- summary must contain 'docs consulted: 0'

-- (I) full audit trail
select workflow, status, lead_email, summary, logged_at
from audit_log where logged_at > :t0 order by logged_at;
```

### 9.8 Pass / fail — how "correctly silent" is told apart from "broken"

Silence alone is worthless evidence. A pass on steps 1 and 2 requires **all six** of:

| # | Evidence | Where |
|---|---|---|
| 9.1 | An n8n execution of `BiyHk9ZXxJUVGbf6` exists above the watermark for each of the two events, status `success`. | execution list |
| 9.2 | In each, `Is Real Inbound?` took output **0** and `Is New Message?` took output **0**. If either took output 1, the message was filtered as noise upstream and the allowlist was never tested — **INCONCLUSIVE**. | node run data |
| 9.3 | `Reply Eligibility` produced `bot_may_reply = false` and `reply_reason = 'not a lead and no dealership keyword — staying silent'`. This is the positive assertion that the decision was **made**, not skipped. | node run data |
| 9.4 | `Should The Bot Reply?` shows a run with **0 items on output 0** and 1 item on output 1. | node run data |
| 9.5 | Query (A) returns the inbound `communication_logs` row and the `processed_messages` claim for that event. **Rows written = the pipeline ran.** No row = the webhook never fired, WAHA never delivered, or the box was jammed — **INCONCLUSIVE, not pass**. | SQL |
| 9.6 | Query (B) returns `premature_outbound = 0` and query (C) returns 0 lead rows. | SQL |
| | **Broken-and-did-nothing** looks like: no execution, or an execution whose `Prefilter`/`Is Real Inbound?` rejected the item, or no `processed_messages` row. Any of those = INCONCLUSIVE. | |
| | **Correctly-silent** looks like: execution present, message accepted, logged inbound, `bot_may_reply=false` recorded, zero outbound. | |

Remaining criteria:

| # | Criterion |
|---|---|
| 9.7 | Step 3: ≥1 outbound row after `:t_msg3`; the reply names a vehicle that exists in `inventory`; exactly one new `leads` row; exactly one Master Router execution. |
| 9.8 | Step 4: `Is An Identity Document?` took output **1**; `Record Non-Document` ran. Then either (E) returns 1 row with `verdict='NOT_A_DOCUMENT'` and `void_reason`/`voided_at` set, **or** — on the current definition — 0 rows *and* the `Record Non-Document` node output item contains `error` mentioning the check constraint. Report the second as **FAIL (`[PC-5]`)**, never as a pass by silence. |
| 9.9 | Step 4: query (F) = 0, and no outbound `communication_logs` row exists for the credit-card event. |
| 9.10 | Step 5: query (G) returns a row whose `summary` names the exact node you broke and the execution id. `status` is the literal `'FAILED'`, which satisfies the `status = upper(status)` CHECK. |
| 9.11 | Step 5: the node is restored, and a second execution of the same workflow after the restore completes with `delivery.status='SUCCESS'`. An unrestored break invalidates every later journey. |
| 9.12 | Step 6: `Docs Found?` took output **1**; `AI Agent - Generate Answer` has **no run data**; query (H) shows `docs consulted: 0`; the answer text is exactly the `no_match_message` (begins *"Nothing in the knowledge base matched that."*) with `sources = []`. |
| 9.13 | Slack Command Center (P4): `VmnIXo7tM30zqawp` — `SlackWebhook` connects **straight** to `Extract Command`; there is no `Verify JWT`/`Auth Gate` `[PC-14]`. Until P4 lands, an unauthenticated POST reaching `AI CRM Agent` (which holds the `Update Lead Status` tool) is a **security fail**, not a pass. |
| 9.14 | Delivery Report on every run that produced one: `SUCCESS` with `all N claimed steps verified`, or a `PARTIAL`/`FAILED` whose `dropped[]` is on the accepted list. |

### 9.9 What may legitimately differ
* **MUST hold:** silence on 1 and 2 — there is no LLM in that decision at all;
  `Reply Eligibility` is deterministic string matching. A reply here is a defect, never
  variation. `Docs Found?` false → the LLM is not invoked, so step 6 is deterministic too.
* **LLM-dependent, may vary:** `OpenRouter Vision (KYC Analysis)`'s
  `parsed.isIdentityDocument` for the credit card. A credit card is unambiguous, but if
  vision returns `true` the run goes down `Validation Check` instead — record the raw
  vision JSON and treat it as a **vision-model failure**, distinct from a routing failure.
  Step 3's reply wording, chosen alternatives, and whether it answers in Roman Urdu.
* **May vary but must be bounded:** the number of `search_rag_documents` hits for the EV
  charger question. If it returns >0 (trigram noise), `Docs Found?` goes true and the LLM
  answers. Then 9.12 changes to: the answer must state the context does not cover it and
  must cite no page number that does not appear in `sources[]`. Record which branch ran.

---

## J10 — Compliance and retention

**Persona** Fatema Bhopalwala, fleet buyer. **Unit** NX-1002 Nissan Patrol Platinum V8,
AED 312,000. Two sub-tests: KYC approve + archive, then Retention Purge — **both branches**.

### 10.1 Phase 1 — KYC approved and archived

**Msg 1** (`We need a Patrol for our company fleet. Trade licence attached.`) — keyword
`patrol` → **Path A** → lead created via `New Lead Worth Scoring?` → Master Router.
**Msg 1 must be text and must land before the ID image**, otherwise `Is Document?` fails
its `matched_lead` condition and the image goes down the reply path instead of to KYC.

**Msg 2** (valid Emirates ID image) — **Path C**:
`Is Document?` **true** → `Download KYC Image` → `Image To Base64` → `Send to KYC Auditor`.

`qTnh3nwWheFJbFkU`: `Called by Another Workflow` → `Prepare Document` →
`OpenRouter Vision (KYC Analysis)` → `Parse JSON Output` → `Prepare Archive`
(builds `storage_path = kyc/<email>/<yyyy>/<mm>/<uuid>.<ext>`, `retain_until = now + 7y`)
→ `Archive to Storage` → `Merge Archive Result` → `Is An Identity Document?` **true** →
`Validation Check` **true** (`parsed.isValid === true && parsed.tamperingDetected === false`)
→ `Approved` → `WhatsApp: KYC Approved` → `Log KYC Approved` →
`Delivery Report (KYC Approved)` → `Record KYC (Approved)`.

**Must NOT run:** `Rejected`, `Count Previous KYC Rejections`,
`Decide: Re-ask or Escalate`, `Within Retry Limit?`, `WhatsApp: Request Re-upload`,
`Slack: KYC Escalation`, `Record KYC (Rejected)`, `Record Non-Document`.

### 10.2 Phase 2 — Retention Purge, success branch

Back-date the row:
```sql
update kyc_documents
set retain_until = (current_date - interval '1 day')::date
where lead_email = 'shabbir53ujjainwala@gmail.com'
  and verdict = 'APPROVED' and purged_at is null and storage_path is not null;
-- must report UPDATE 1
```

Run `aIYwwoYStDAi9kHy` manually. `Every Night 03:00` fans out to **three independent
branches**, all of which run:

1. **Purge** — `Find Expired Documents`
   (`storage_path=not.is.null & purged_at=is.null & retain_until=lt.<today>`) →
   `Collect Expired Paths` → `Delete Storage Objects` (DELETE
   `/storage/v1/object/kyc-documents`, body `{prefixes:[…]}`) →
   `Storage Delete Succeeded?` → **output 0** → `Mark Rows Purged` (PATCH
   `purged_at=$now`) → `Summarise Purge` → `Delivery Report` → `Log Purge to Audit`.
   `Purge Failed — Rows NOT Marked` **must NOT run**.
2. **Dedupe prune** — `Prune Dedupe Guard` (DELETE `processed_messages` older than 7 d).
   Terminal, no Delivery Report, no audit row.
3. **Archive gap** — `Find Archive Gaps` → `Any Gaps?` → `Slack: Archive Gap Alert`.
   Terminal, no Delivery Report, **no audit row** `[PC-15]`.

**Order is the assertion:** `Mark Rows Purged` is reachable only through
`Storage Delete Succeeded?` output 0. Delete happens first; the row is marked second.

### 10.3 Phase 3 — Retention Purge, failure branch (refuse to purge)

Seed a second expired row (repeat 10.1 with another ID image, or back-date a second
existing row), then temporarily point `Delete Storage Objects` at a dead host
(`https://127.0.0.1:1/storage/v1/object/kyc-documents`) and run again.

Expected: `Delete Storage Objects` swallows (`continueRegularOutput`) and emits
`{error: …}` → `Storage Delete Succeeded?` **output 1** →
`Purge Failed — Rows NOT Marked` (`stopAndError`) → execution status **error** →
`NEXUS Error Handler` `Any Workflow Failed` → `Build Failure Row` →
`Log Failure to audit_log`.

**Must NOT run:** `Mark Rows Purged`, `Summarise Purge`, `Delivery Report`,
`Log Purge to Audit`. **Restore the URL immediately.**

### 10.4 Phase 4 — forced archive gap

> **`[PC-16]` — deleting a Storage object by hand does NOT fire the alert.**
> `Find Archive Gaps` queries `storage_path=is.null & purged_at=is.null &
> created_at=gte.2026-08-17T16:01:48Z`. It never touches Storage. To fire it you must
> **null the column**:
```sql
update kyc_documents set storage_path = null
where id = '<the J10 kyc row id>' and purged_at is null;
```
Then run the purge workflow again. Restore the value afterwards from the archived
`30_kyc_documents.json`.

### 10.5 Verification SQL
```sql
-- (a) the approved, archived KYC row
select id, lead_email, lead_name, chat_id, verdict, is_valid, tampering,
       attempt_number, max_attempts, storage_path, retain_until,
       purged_at, void_reason, voided_at, reviewed_at, remarks
from kyc_documents
where lead_email = 'shabbir53ujjainwala@gmail.com' order by reviewed_at;
-- expect verdict='APPROVED', is_valid=true, tampering=false, attempt_number=1,
--        storage_path NOT NULL, retain_until = current_date + 7 years, purged_at NULL

-- (b) the approval message to the customer
select created_at, lead_email, direction, message from communication_logs
where message like '[KYC-APPROVED]%' and created_at > :t0;

-- (c) the delivery verdict embedded in the row itself
select id, remarks from kyc_documents
where lead_email = 'shabbir53ujjainwala@gmail.com';
-- remarks must end '[delivery: SUCCESS - all 3 claimed steps verified]'

-- (d) BEFORE the purge — the row is selectable by Find Expired Documents
select id, storage_path, retain_until, purged_at from kyc_documents
where storage_path is not null and purged_at is null
  and retain_until < current_date;
-- must return exactly the J10 row (note it — that is the purge's input set)

-- (e) AFTER a successful purge
select id, storage_path, retain_until, purged_at from kyc_documents
where lead_email = 'shabbir53ujjainwala@gmail.com';
-- expect purged_at NOT NULL and purged_at > :t0; storage_path unchanged (not nulled)

select workflow, status, summary, logged_at from audit_log
where workflow = 'NEXUS Retention Purge' and logged_at > :t0 order by logged_at;
-- expect status='SUCCESS',
--   summary like 'Retention purge: deleted 1 KYC document(s) past retain_until%'
--   and containing 'all 2 claimed steps verified'

-- (f) AFTER the forced failure — the compliance-safe outcome
select id, storage_path, retain_until, purged_at from kyc_documents where id = '<row 2 id>';
-- expect purged_at STILL NULL

select workflow, status, summary, logged_at from audit_log
where status = 'FAILED' and logged_at > :t_fail order by logged_at desc limit 3;
-- expect workflow='NEXUS Retention Purge', summary containing
--   'Retention purge aborted' and 'Failed at node: Purge Failed — Rows NOT Marked'

select count(*) from audit_log
where workflow = 'NEXUS Retention Purge' and status = 'SUCCESS' and logged_at > :t_fail;
-- expect 0 — no success row may be written by the failing run

-- (g) archive gap
select id, lead_email, created_at, storage_path, purged_at from kyc_documents
where storage_path is null and purged_at is null
  and created_at >= '2026-08-17T16:01:48Z' order by created_at;
-- must contain the row you nulled

-- (h) dedupe prune side-effect
select count(*) as old_processed from processed_messages
where processed_at < now() - interval '7 days';
-- expect 0 after the run

-- (i) inventory
select id, model, status, days_in_stock, price_aed from inventory where id = 'NX-1002';
```

### 10.6 Pass / fail — "correctly refused" vs "never ran"

**Success branch:**
| # | Criterion |
|---|---|
| 10.1 | (a): exactly 1 row, `verdict='APPROVED'`, `storage_path` matching `^kyc/shabbir53ujjainwala.*\.(jpg\|png\|webp\|pdf)$`, `retain_until = current_date + 7 years`, `attempt_number=1`. |
| 10.2 | `Archive to Storage` returned an item containing `Key` or `Id`; `Merge Archive Result.storage_path` is non-null. A null here means the object was never uploaded and (a)'s `storage_path` would also be null — a compliance hole, fail. |
| 10.3 | (c): `remarks` ends `[delivery: SUCCESS - all 3 claimed steps verified]`. A `PARTIAL`/`FAILED` here means the WhatsApp approval or the archive did not land, even though the row exists. |
| 10.4 | (d) run **before** the purge returned exactly 1 row. If it returned 0 the back-date did not take and the purge test is **INCONCLUSIVE**. |
| 10.5 | (e): `purged_at` non-null and greater than the execution's start; `audit_log` `status='SUCCESS'`, `deleted 1 KYC document(s)`. |
| 10.6 | **Ordering proof:** in the purge execution, `Delete Storage Objects` has run data with **no** `error` key, `Storage Delete Succeeded?` took output **0**, and `Mark Rows Purged` ran **after** it in the node sequence. `Purge Failed — Rows NOT Marked` has no run data. |
| 10.7 | The Storage object is actually gone (verify via the Supabase Storage browser or a signed-URL 404). The `audit_log` row is a claim; Storage is the fact. |

**Failure branch — the discriminator:**
| # | Criterion |
|---|---|
| 10.8 | **`Find Expired Documents` produced ≥1 item and `Collect Expired Paths` output `count >= 1`.** Without this, the branch simply had nothing to do and proved nothing — `Collect Expired Paths` returns `[]` when nothing is due, which silently ends the branch and looks identical to a refusal. **This is the single check that separates "correctly refused to purge" from "never ran".** |
| 10.9 | `Delete Storage Objects` run data contains an `error` key. |
| 10.10 | `Storage Delete Succeeded?` took output **1**; `Purge Failed — Rows NOT Marked` has run data; `Mark Rows Purged`, `Summarise Purge`, `Delivery Report`, `Log Purge to Audit` have **none**. |
| 10.11 | Execution status is `error`, not `success`. A green run on this branch means the IF did not fire. |
| 10.12 | (f): the row's `purged_at` is **still NULL**, and there is **no** `SUCCESS` audit row for `NEXUS Retention Purge` after `:t_fail`. A false compliance record is the exact defect the 24 Aug fix removed. |
| 10.13 | The Error Handler wrote the FAILED row: `summary` contains `Retention purge aborted` and `Failed at node: Purge Failed — Rows NOT Marked`. If no FAILED row exists, either the error workflow is not wired to this workflow or the Error Handler is broken — record which. |
| 10.14 | The URL is restored and a subsequent clean run of the purge succeeds. |

**Archive gap:**
| # | Criterion |
|---|---|
| 10.15 | (g) returns the nulled row. `Any Gaps?` produced 1 item; `Slack: Archive Gap Alert` ran; a message is visible in Slack channel `C0BKTLL1X54` containing `KYC archive gap` and the row count. |
| 10.16 | If `Find Archive Gaps` returned 0 rows, `Any Gaps?` returns `[]` and the Slack node is legitimately skipped. That is **not** a pass for this sub-test — re-do 10.4 correctly. |
| 10.17 | No `audit_log` row is expected from the gap branch `[PC-15]`; its absence must not be recorded as a failure. |

**Other:**
| # | Criterion |
|---|---|
| 10.18 | Customer 360 (matrix marks J10): profile row for the email with `last_synced_at > :t0`; `PARTIAL` on Gmail/Slack accepted `[PC-7]`. |
| 10.19 | Ask AI cites *HR Handbook / Maternity Leave p.24*, `documents_consulted > 0`. |
| 10.20 | Teardown must delete the Storage objects under `kyc/shabbir53ujjainwala…/` — a surviving object plus a deleted row is exactly the ghost the plan warns about. |

### 10.7 What may legitimately differ
* **MUST hold:** the purge order (delete then mark), the refusal to mark on failure, the
  7-year `retain_until`, `attempt_number = 1`, and `verdict = 'APPROVED'`. None of these
  involve an LLM.
* **LLM-dependent:** `OpenRouter Vision (KYC Analysis)` decides `isValid`,
  `tamperingDetected`, `isIdentityDocument`, `confidenceScore`, `fullName`,
  `dateOfBirth`, `expiryDate`, `documentType`. A genuine, clear Emirates ID should give
  `isValid=true, tamperingDetected=false`, but a false REJECT is a vision failure, not a
  workflow failure — re-shoot the photo before declaring J10 failed, and record both
  attempts. Extracted name/DOB strings may differ in formatting; only their presence is
  assertable.
* **May vary:** the wording of the Slack gap alert body beyond the fixed `:warning: *KYC
  archive gap*` prefix; the number of rows the gap query returns if earlier journeys left
  residue (this is why teardown matters).

---

## PLAN CORRECTIONS

**PC-1 — the JSON snapshot predates the fixes J9 depends on.**
`/tmp/wf2/after/*.json` was exported 26 Aug 05:02–05:12. The 28 Aug fixes are absent:
`Reply Eligibility` still keyword-matches on `"document"` while
`Extract Message & Sender` still emits `'[Customer sent a document image]'`, so an
uncaptioned image from a stranger **passes the allowlist**; `New Lead Worth Scoring?` has
only three conditions (no placeholder guard); `Resolve Lead Identity` does not exclude
`DISQUALIFIED`; `Fetch Open Leads` excludes only `LOST`. J9 steps 1 and 2 fail against
these definitions. Re-export the live workflows before running J9 and diff.

**PC-2 — "that sync is closed-won only" is not true of the workflow.**
`dhy2DDjWUqwuzHLW` has no status check anywhere. `Webhook - New Deal` → `Verify JWT` →
`Format Deal Text` accepts any deal-shaped body and writes both `deals_embeddings` and
`purchase_history`. J7's negative case tests the **dashboard**, not the workflow, and the
assertion must be "zero executions of `dhy2DDjWUqwuzHLW`", not "no row".

**PC-3 — J8 cannot exercise `check_purchase_history` through WhatsApp.**
`check_purchase_history` filters on `email`. `Shape Lead For Router` supplies
`ctx.lead_email`, which is null for an unmatched sender; and `New Lead Worth Scoring?`
requires `matched_lead === false`, so seeding the lead row to supply an email turns the
Router off. J8 must enter through the Master Router's `Webhook Catch-All` with an explicit
email (§8.1). The plan's WhatsApp-only script for J8 is not executable as written.

**PC-4 — the KYC workflow writes no `audit_log` rows at all.**
`qTnh3nwWheFJbFkU` has 31 nodes and none of them post to `audit_log`. Part 0's
"definition of done" clause *"`audit_log.status` for each workflow is SUCCESS"* cannot be
applied to KYC. Its delivery verdict is embedded in `kyc_documents.remarks` as
`[delivery: <status> - <note>]` instead — that is where J2, J4, J9 and J10 must look.

**PC-5 — `Record Non-Document` violates the `verdict` CHECK.**
It writes `verdict: 'NOT_A_DOCUMENT'`; the constraint allows only
`PENDING|APPROVED|REJECTED|ESCALATED`. The node carries `onError:
continueRegularOutput` and is terminal, so the 400 is swallowed and unreported. J4's
"Record Non-Document" coverage and J9 step 4 will both silently write nothing. Either add
the value to the CHECK or change the node to `REJECTED` with the reason in `void_reason`.

**PC-6 — a HOT lead's Master Router audit row will read FAILED, not PARTIAL.**
`wf_108` swallows the Bitrix 403 and its `Delivery Report` sets `status='FAILED'`. The
Master Router's `Delivery Report` marks any sub-workflow whose `status` matches
`/fail|unverified|error/i` as a **critical** drop. So every HOT journey (J8, and J6/J10 if
scored HOT) ends `Master Router → FAILED`. The plan's P6 says "12 of wf_108's 14 nodes
still get exercised"; it does not say the parent goes red. Add it to the accepted list.

**PC-7 — Customer 360 is expected `PARTIAL`, permanently, until P3 lands.**
`Delivery Report` claims `Gmail - Get Emails` and `Slack - Search Mentions` as
non-critical; both fail. `total_emails` and `total_slack_messages` in
`customer_360_profiles` will be `0` and are not evidence of anything.

**PC-8 — the Competitor workflow can never update a price.**
`Should Update Price?` has **no inbound connection**, so `Build Update Payload` and
`Update Prices in Supabase` are unreachable. The workflow's own `Delivery Report` says so
in a comment. `inventory.price_aed` is never written by it. J5/J6/J7's "Competitors"
coverage is intel-logging only.

**PC-9 — `Inventory Ageing Recompute` hardcodes `status: 'SUCCESS'`.**
No Delivery Report, no verification. Its audit row is exactly the shape BRIEF_TRUTH.md
warns about. Treat `days_in_stock` in the `inventory` table as the evidence, not the row.

**PC-10 — there is no aged-stock campaign workflow.**
J6's "then a Campaign pushes aged stock" has no workflow behind it. `G7FhvMY2ucW5Fg7X` is
lead-triggered, not inventory-triggered. J6's Campaigns coverage is a dashboard action
only, and the coverage matrix should not imply a workflow ran.

**PC-11 — a Silence Detector run that finds nobody produces no audit row.**
`Loop Over Silent Leads` output 0 ("done") is not connected. So `Delivery Report` and
`Audit Log` are on the escalation path only. J7 must not expect a `Phase 6` audit row.

**PC-12 — the customer's quoted competitor price has nowhere to go.**
Nothing in the system records "Al Futtaim quoted 232k". `competitors` is written only by
the scrape. J7's *"Competitors → confirm the price gap is visible"* is satisfiable only by
whatever the scraper found, or by a hand-inserted row that must be labelled as such.

**PC-13 — `"santa fe"` is not in the `Reply Eligibility` keyword list.**
The list has `hyundai` but not `santa fe`. `Kya tumhare pass Santa Fe hai?` contains
neither `hyundai` nor any other listed keyword, so an **unmatched** sender would still be
met with silence. In J9 the sender is unmatched at step 3, so as scripted step 3 fails.
Either add `santa fe` to the allowlist or use a phrasing containing `car`/`price`/`kitna`.

**PC-14 — Slack Command Center is still unauthenticated in this snapshot.**
`SlackWebhook` connects directly to `Extract Command`; there is no `Verify JWT` or
`Auth Gate`, unlike every other public webhook. P4 is genuinely outstanding, and J9's
Slack Command Center coverage should be recorded as a security finding until it lands.

**PC-15 — the archive-gap branch writes no audit row.**
`Any Gaps?` → `Slack: Archive Gap Alert` is terminal. Slack is the only evidence. If the
Slack credential is broken the node swallows (`continueRegularOutput`) and the compliance
alert vanishes with nothing recording it anywhere.

**PC-16 — deleting a Storage object by hand will not fire the archive-gap alert.**
`Find Archive Gaps` keys on `storage_path IS NULL`, not on object existence. J10's
"force one archive gap (delete a Storage object by hand, leave the row)" is a no-op. Null
the column instead, and restore it afterwards.

**PC-17 — the P5 clock table does not match the file.**
`7-Day Warm Lead Drip Campaign` has `Wait Day 3 = 2 days` and `Wait Day 7 = 2 days` in this
snapshot, not the 3 days / 4 days the plan records as "production value", and
`Find Silent Leads` still has `SILENCE_HOURS = 12`, not the 0.2 test value. Record the
true production values before shortening anything, or the restore step restores fiction.
