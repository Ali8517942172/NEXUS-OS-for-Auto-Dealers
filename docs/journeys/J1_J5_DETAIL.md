# NEXUS OS — Journeys 1–5, execution detail

Derived from the 21 live workflow JSONs in `/tmp/wf2/after/` (export of 26 Aug 2026),
not from the prose plan. Where the JSON and `NEXUS_10_JOURNEYS.md` disagree, the JSON
wins and the disagreement is recorded in **PLAN CORRECTIONS** at the end.

Read **§0 Shared truths** once. Then run one journey per sitting.

---

## §0 Shared truths (apply to all five journeys)

### 0.1 Identity keys — three of them, and they do not join
| Key | Value | Where it lands |
|---|---|---|
| chat id (LID) | `158510264357112@lid` | `communication_logs.lead_email` for every BDC + dashboard message; `kyc_documents.chat_id`; `whatsapp_contacts.chat_id`; `processed_messages.chat_id` |
| phone | `+918517942172` | `leads.phone` (written by `Shape Lead For Router` as `'+' + digits`) |
| email | `shabbir53ujjainwala@gmail.com` | `leads.email` **only if a human puts it there**; `finance_quotes.lead_email`; drip `communication_logs.lead_email` |

`Resolve Lead Identity` matches a WhatsApp sender to a lead on the **last 9 digits**
(`517942172`) of `sender_phone` (from `payload._data.Info.SenderAlt`), never on the chat id.

**A WhatsApp-originated lead gets `leads.email = NULL`.** `Shape Lead For Router` sets
`email: ctx.lead_email`, which is null when no lead matched — the address is never parsed
out of the message text. Three workflows key on `leads.email` and therefore cannot work at
all on a null-email lead:

* `Lead Escalation` → `Fetch Escalated Lead` (`email` filter) → `Found The Lead?` false →
  `No Lead To Escalate` (stopAndError) → the **Master Router run goes red**, because
  `Slack Router (HOT)` has no `onError`.
* `7-Day Warm Lead Drip` → `Normalize Lead Input` throws
  *"a lead arrived but carried no email address"*.
* `Phase 6 Silence Detector` → `Find Silent Leads` does `.filter(l => l && l.email)`.

**Blocking pre-flight (call it P7).** Decide one of these before J1 and use the same one
every journey, or J1/J3 cannot pass:

* **P7-a (recommended):** after the first inbound message has created the lead, and before
  anything else, run
  `update leads set email='shabbir53ujjainwala@gmail.com' where phone='+918517942172' and email is null;`
  Accept that the HOT escalation inside the *first* Master Router run will have already
  failed; re-fire `Lead Escalation` manually with `{"email":"shabbir53ujjainwala@gmail.com"}`.
* **P7-b:** patch `Shape Lead For Router` to carry a fallback email. Code change, needs Ali.
* **P7-c:** accept `Lead Escalation` as blocked-by-design for WhatsApp journeys, the way
  Bitrix is accepted under P6, and score J1 on the other seven workflows.

### 0.2 Execution order — why a `Delivery Report` can name a real node as missing
All workflows are `settings.executionOrder = "v1"`. On a fan-out, n8n runs each branch to
completion before starting the next, and picks branch order by canvas position (topmost
first). The pgvector workflow's own `Delivery Report` documents this in a comment.

Consequence in `NEXUS Master Lead Router`: `Intent Switch` output 0 feeds three nodes —
`HOT: Already In A Live Chat?` (y = −64), `Slack Router (HOT)` (y = 112), `ERP Sync (HOT)`
(y = 112). The topmost is the IF, whose branch runs straight into `Delivery Report`.
So on **every HOT lead** `Delivery Report` is expected to run *before* the Slack and ERP
nodes and report both as `node did not run on this branch`, giving `status = FAILED`.

**Falsifiable test:** open the execution, read the node run order. If `dropped[]` reads
`... — node did not run on this branch` for `Slack Router (HOT)` and `ERP Sync (HOT)`,
that is the ordering artefact, **not** a delivery failure — judge the real outcome from the
`Lead Escalation` and `wf_108 ERP Sync - Bitrix24` audit rows instead. If instead it reads
`sub-workflow reported FAILED` or a real HTTP message, that *is* a delivery failure.

### 0.3 `Delivery Report` semantics
`status`: `SUCCESS` = every claimed node ran and emitted no `{error}` item. `PARTIAL` = only
non-critical (bookkeeping) claims dropped. `FAILED` = a critical (customer-visible /
irreversible) claim dropped. A green n8n run proves nothing: HTTP nodes carry
`onError: continueRegularOutput`, so a failed WhatsApp send is an item, not an exception.
**Always read `delivery.dropped[]`, never the exit code.**

Two workflows relevant here have **no** `Delivery Report` node at all: `Finance Calc`
(`unMMpeL9uuPO79pp`) and `Inventory Ageing Recompute`. See PLAN CORRECTIONS #1.

### 0.4 `audit_log.workflow` strings (exact, for every query below)
`WhatsApp BDC Agent` · `Master Router` · `Lead Escalation` · `KYC Auditor - Phase 5` ·
`7-Day Warm Lead Drip` · `Phase 6 Silence Detector` · `Finance Calc` ·
`Ask-AI RAG Query` · `Sync Closed-Won to pgvector` · `wf_108 ERP Sync - Bitrix24` ·
`Customer 360 Aggregation` · `Competitor Price Scraping` · `Inventory Ageing Recompute`.
`WhatsApp Send (Dashboard Reply)` writes **no** audit row — do not look for one.
`KYC/AML` writes an audit row **only on the escalation branch**; approve, reject and
non-document write nothing to `audit_log`.

`NEXUS Error Handler` writes `status='FAILED'` with `workflow` = the *display name*
(e.g. `NEXUS Master Lead Router - AI Agent`), which is a different string from `Master Router`.
A row under the display name means the execution itself crashed.

### 0.5 Set `t0` before every journey
```sql
select now() as t0;   -- keep with the journey folder; every query below uses it
```
Substitute the literal timestamp for `:t0` in the SQL. `select max(id) from execution_entity;`
on nexus-vm for the n8n watermark.

---

## J1 — Cash buyer, Lexus LX 600, HOT, closed-won, KYC approved first try

Persona **Murtaza Kagalwala**. Unit **NX-1011**, AED 585,000.

### 1.1 Expected execution chain

**Msg 1** `Hi, I saw the Lexus LX 600 2024 on your website. Is it still available?`

`WhatsApp BDC AI Agent` (BiyHk9ZXxJUVGbf6) — one execution:
```
WAHA Webhook (POST) → Prefilter → Is Real Inbound? [true]
  → Claim Message Id → Is New Message? [true]
  → Extract Message & Sender → Fetch All Leads → Resolve Lead Identity   (matched_lead=false)
  ├─ branch 1 (y=144): Is Document? [FALSE branch]
  │     → Recent Outreach Check → Skip Duplicate Outreach → Log Incoming Message
  │     → Reply Eligibility (bot_may_reply=true, reason "dealership keyword: lexus")
  │     → Should The Bot Reply? [true] → Model Ladder → AI BDC Sales Agent
  │         (calls search_inventory, ilike %Lexus%)
  │     → Guard Reply → Send Reply via WAHA HTTP API → Log Conversation
  │     → Delivery Report → Audit Log
  │     → New Lead Worth Scoring? [TRUE: inbound + matched_lead false + sender_phone non-empty]
  │     → Shape Lead For Router → Score New Lead (Master Router)   [waitForSubWorkflow:false]
  └─ branch 2 (y=784): Upsert WhatsApp Contact
```
Must **not** run: `Download KYC Image`, `Image To Base64`, `Send to KYC Auditor`,
`Called by Master Router`.

`NEXUS Master Lead Router` (JnlZFAVmFAuNXVya) — separate execution:
```
Called Internally → Validate & Enrich Input → Model Ladder → AI Lead Scoring Agent
   (tools: Supabase Lead Lookup, check_purchase_history, upsert_lead)
 → Parse AI Decision → Intent Switch [output 0 = HOT]
 → HOT: Already In A Live Chat? [TRUE — lead.origin === 'whatsapp-bdc']
 → Delivery Report → Audit Log
 → Slack Router (HOT) → sub-exec of Lead Escalation
 → ERP Sync (HOT)     → sub-exec of wf_108
```
Must **not** run: `WhatsApp Outreach (HOT)` (this is the whole point of the origin flag —
the customer is already in a live thread and must not get a canned welcome on top of the
reply), `WARM: Already In A Live Chat?`, `WhatsApp BDC (WARM)`, `Marketing Drip (COLD)`,
`Slack: Unclassified Lead`, `Webhook Catch-All`/`Verify JWT`/`Auth Gate`.

`Lead Escalation` (KI6P1Qcf3MIZakNa), **only if P7 has given the lead an email**:
```
Called by Master Router → Fetch Escalated Lead → Found The Lead? [true]
 → Model Ladder → AI Escalation Analyst (tools get_lead_timeline, find_available_rep)
 ├─ Email: Escalation Alert (Gmail) → Audit Log → Mark Lead Escalated → Delivery Report → Return Result
 └─ Send a message (Slack #sales-hot-leads) → Return Result
```
`No Lead To Escalate` must **not** run. If it does, the lead has no email — see §0.1.

**Msgs 2 and 3** (`price / cash discount`, `I will take it`): same BDC chain as msg 1 with
one difference — `Resolve Lead Identity.matched_lead = true`, so
`New Lead Worth Scoring?` takes the **false** branch and `Shape Lead For Router` +
`Score New Lead (Master Router)` must **not** run. Exactly **one** Master Router
execution for the whole journey.

**Msg 4** (Emirates ID image): `Is Document?` is TRUE (`is_document && matched_lead`), so the
run takes **only** the KYC branch:
```
… Resolve Lead Identity → Is Document? [TRUE] → Download KYC Image → Image To Base64
 → Send to KYC Auditor   [waitForSubWorkflow:false]
… then Upsert WhatsApp Contact
```
`Recent Outreach Check`, `Log Incoming Message`, `AI BDC Sales Agent`, `Send Reply via WAHA`,
`Delivery Report`, `Audit Log` must **not** run on this execution — the image message
produces **no** BDC reply, no `WhatsApp BDC Agent` audit row and no inbound
`communication_logs` row.

`KYC/AML Document Auditor` (qTnh3nwWheFJbFkU):
```
Called by Another Workflow → Prepare Document → OpenRouter Vision (KYC Analysis)
 → Parse JSON Output → Prepare Archive → Archive to Storage → Merge Archive Result
 → Is An Identity Document? [TRUE] → Validation Check [TRUE: isValid && !tamperingDetected]
 → Approved → WhatsApp: KYC Approved → Log KYC Approved
 → Delivery Report (KYC Approved) → Record KYC (Approved)
```
Must **not** run: `Rejected`, `Count Previous KYC Rejections`, `Decide: Re-ask or Escalate`,
`Within Retry Limit?`, `WhatsApp: Request Re-upload`, `Log KYC Re-ask`,
`Slack: KYC Escalation`, `Log KYC Escalation`, `Record KYC (Rejected)`,
`Record Non-Document`, and the other four `Delivery Report (…)` nodes.

**Finance path must stay untouched.** J1 is cash. `Finance Calc` (unMMpeL9uuPO79pp) must
have **zero** executions and `finance_quotes` **zero** rows for this journey. The BDC agent
has a `finance_calculator` tool; if it invokes it, that is a J1 failure (and it would fail
validation anyway — see PLAN CORRECTIONS #6).

**Dashboard reply** → `WhatsApp Send (Dashboard Reply)` (yx6m55p1Kj8V7koR):
```
Dashboard Send Webhook → Verify JWT → Auth OK? [true] → Prepare Send
 → Has chat_id and text? [true] → Send via WAHA → Log Outbound → Delivery Report → Respond Sent
```
`Respond Unauthorized`, `Respond Bad Request`, `Respond Send Failed` must not run.

**Closed-won** → `Sync Closed-Won Deals to Supabase pgvector` (dhy2DDjWUqwuzHLW):
```
Webhook - New Deal → Verify JWT → Format Deal Text
 ├─ (y=304, first) OpenRouter - Generate Embedding → Parse Embedding Response
 │     → Supabase (Postgres) - Upsert Vector → Delivery Report → Audit Log
 └─ (y=504, second) Record Purchase
```

**Ask AI** → `Ask-AI — RAG Query Agent` (qHAtd3RckAKRBUkE):
```
Webhook - Ask AI → Verify JWT → Auth OK? [true] → Extract Question
 → Supabase Knowledge Search → Build RAG Context → Docs Found? [true]
 → AI Agent - Generate Answer → Format Response → Respond to Webhook → Delivery Report → Audit Log
```
`AI Answer - Backup Models` runs only if the primary errors; either is acceptable.
`Respond 401` must not run.

### 1.2 Verification SQL
```sql
-- A. the lead
select id, name, email, phone, source, vehicle_interest, budget_aed, status, ai_score,
       assigned_to, assigned_to_id, escalated_at, created_at
from leads
where phone = '+918517942172' and created_at >= :t0;
-- expect exactly 1 row; status='HOT'; source='nexus-master-router'; ai_score >= 70

-- B. the conversation, in order. NOTE lead_email holds the LID chat id, not an email.
select created_at, direction, channel, left(message, 120) as msg
from communication_logs
where lead_email in ('158510264357112@lid','shabbir53ujjainwala@gmail.com')
  and created_at >= :t0
order by created_at;
-- expect 3 inbound + 3 outbound BDC pairs + 1 '[KYC-APPROVED] …' outbound
--        + 1 outbound for the dashboard reply. NO inbound row for the image message.

-- C. KYC
select id, verdict, is_valid, tampering, attempt_number, max_attempts, confidence_score,
       document_type, full_name, expiry_date, storage_path, retain_until, remarks, created_at
from kyc_documents
where (lead_email = 'shabbir53ujjainwala@gmail.com' or chat_id = '158510264357112@lid')
  and created_at >= :t0;
-- expect exactly 1 row; verdict='APPROVED'; is_valid=true; tampering=false;
-- attempt_number=1; storage_path NOT NULL and matching 'kyc/%/2026/08/%';
-- retain_until = created_at::date + 7 years

-- D. finance must be untouched
select count(*) as must_be_zero from finance_quotes
where lead_email = 'shabbir53ujjainwala@gmail.com' and created_at >= :t0;
select count(*) as must_be_zero from audit_log
where workflow = 'Finance Calc' and logged_at >= :t0;

-- E. deal + purchase
select deal_id, customer_name, email, vehicle, amount_aed, purchase_date, created_at
from purchase_history where created_at >= :t0;
-- expect 1 row, vehicle mentioning Lexus LX 600, amount_aed = 585000
select deal_id, left(content, 160) as content, (embedding is not null) as has_vector
from deals_embeddings where content ilike '%Lexus%';
-- expect 1 row, has_vector = true

-- F. inventory
select id, model, status, days_in_stock, price_aed, aging_alert
from inventory where id = 'NX-1011';
-- expect status='Sold' AFTER the dashboard action (no workflow sets this — see 1.3)

-- G. every audit row this journey produced
select logged_at, workflow, status, lead_name, lead_email, lead_score, intent,
       left(summary, 300) as summary
from audit_log where logged_at >= :t0 order by logged_at;
```

### 1.3 Pass / fail criteria
| # | Claim | Row / column / value | A wrong value means |
|---|---|---|---|
| 1 | Lead created once | query A returns **exactly 1** row | 2 rows = `upsert_lead` merged on an empty email and split the identity; 0 rows = `Shape Lead For Router` returned `[]` because `sender_phone` was empty (LID with no `Info.SenderAlt`) |
| 2 | Scored HOT | `leads.status = 'HOT'` **and** `audit_log.intent='HOT'` on the `Master Router` row | `WARM` = the scoring agent did not treat "I will take it" as urgency; `COLD` = `Parse AI Decision.parse_failed` fired the regex fallback — check `summary` for *"Scored by the regex fallback"* |
| 3 | Only one scoring run | exactly **1** `audit_log` row with `workflow='Master Router'` | >1 = `New Lead Worth Scoring?` let a matched lead through, i.e. `Resolve Lead Identity` failed to match on phone |
| 4 | Outreach suppressed | Master Router `Delivery Report.note` ends with *"Outreach deliberately skipped: the customer is already in a live WhatsApp thread."* | absent = `lead.origin` was not `whatsapp-bdc`; the customer will have received a duplicate canned welcome |
| 5 | Master Router delivery | `audit_log.status` for `Master Router` — see §0.2. Acceptable **only** if `dropped[]` names `Slack Router (HOT)` / `ERP Sync (HOT)` with *"node did not run on this branch"* (ordering) or the Bitrix `403 FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN` (P6) | any other `dropped[]` text is a real failure |
| 6 | ERP row present and honest | 1 `audit_log` row `workflow='wf_108 ERP Sync - Bitrix24'`, `status='FAILED'`, summary containing `403`/`FEATURE_NOT_AVAILABLE` | `status='SUCCESS'` would mean the Bitrix wall moved — verify, don't assume |
| 7 | Escalation | `leads.escalated_at IS NOT NULL`; 1 `audit_log` row `workflow='Lead Escalation'`, `status='SUCCESS'`; Slack message visible in `#sales-hot-leads` **tagging Ali** (needs P1) | `escalated_at` null = `Mark Lead Escalated` dropped; no run at all = the null-email gap (§0.1) |
| 8 | KYC approved first try | query C: **1** row, `verdict='APPROVED'`, `attempt_number=1`, `is_valid=true`, `tampering=false` | a second row with `verdict='REJECTED'` = the vision model rejected a valid ID (retry the photo, don't fail the system); `verdict='PENDING'` is impossible on this path |
| 9 | Document actually retained | `kyc_documents.storage_path` **NOT NULL**, and a `HEAD` on `kyc-documents/<storage_path>` returns 200 | NULL = `Archive to Storage` dropped; `Delivery Report (KYC Approved).dropped[]` will name *"KYC document retained in Storage (7-year AML retention)"* and the whole KYC verdict is a compliance record about a document nobody kept — **hard fail** |
| 10 | KYC delivery | `kyc_documents.remarks` ends `[delivery: SUCCESS - all 3 claimed steps verified]` | `[delivery: FAILED …]` = the approval WhatsApp did not land; `PARTIAL` = only `Log KYC Approved` dropped, tolerable |
| 11 | Cash path clean | query D: both counts **0**; zero executions of `unMMpeL9uuPO79pp` above the watermark | any row = the BDC agent invoked `finance_calculator` unprompted |
| 12 | BDC delivery | every `audit_log` row `workflow='WhatsApp BDC Agent'` has `status='SUCCESS'` | `FAILED` = `Send Reply via WAHA HTTP API` dropped → Ali received nothing on his phone, regardless of the green run; `PARTIAL` = `Log Conversation` or `Claim Message Id` dropped |
| 13 | Dashboard reply | `Respond Sent.status = 'sent'` (not `sent_but_not_logged'`); one extra outbound `communication_logs` row with `lead_email='158510264357112@lid'` | `sent_but_not_logged` = message went, log did not |
| 14 | pgvector sync | `deals_embeddings` 1 row, 1536-dim vector present; `audit_log` `workflow='Sync Closed-Won to pgvector'` `status='SUCCESS'` and summary contains *"Not covered by this check: purchase_history row"* | that "not covered" clause must be present — its absence means someone edited the report to over-claim |
| 15 | purchase_history | query E returns 1 row with `deal_id` = the dashboard's id, or `auto:shabbir53ujjainwala@gmail.com|<closed_at>` | 0 rows = `Record Purchase` (`onError: stopWorkflow`) aborted — its branch runs **after** the audit row is written, so audit `SUCCESS` does not cover it |
| 16 | Inventory | `inventory.status='Sold'` for `NX-1011` | **no workflow writes this** — it is a dashboard-only write. A stuck `Available` is a dashboard bug, not an automation bug |
| 17 | Ask AI citation | response `sources[]` contains `title='Warranty Policy'`, `section='Standard Coverage'`, `source_file='warranty_policy_v4.2.pdf'`, `page_number=12`; `documents_consulted > 0`; `no_match=false` | `no_match=true` = the `search_rag_documents` RPC found nothing; an answer with `sources=[]` and `no_match=false` is a hallucination |

### 1.4 What may legitimately differ
* **Must hold:** `intent='HOT'`; `leads.status='HOT'`; `ai_score` present and ≥ 70.
  **May vary:** the exact `ai_score` (85 vs 96), the `reason` sentence, whether the agent
  called `check_purchase_history` before or after `Supabase Lead Lookup`.
* **Must hold:** the BDC reply is non-empty, WhatsApp-shaped (no markdown tables, no `**`),
  mentions the Lexus LX 600, and any discount offered is ≤ 8 % and above `cost_aed`.
  **May vary:** wording, length, emoji, whether it volunteers a test drive.
  If `Guard Reply` set `guard_blocked=true` the customer got the canned fallback
  *"Sorry, I didn't catch that properly…"* — that is a **model** failure worth one retry,
  not a system failure.
* **Must hold:** KYC `verdict='APPROVED'`, `is_valid=true`, `tampering=false`,
  `document_type` naming an identity document.
  **May vary:** `confidence_score` (any value ≥ ~70 is fine — the code does not threshold on
  it), the `remarks` prose, exact OCR of `full_name` / `date_of_birth` / `expiry_date`.
  A one-character OCR slip in the name is not a failure.
* **May vary:** which OpenRouter tier `Model Ladder` landed on (`__attempt` 0–3) and the
  `model` string in the Ask-AI response.
* **Expected non-SUCCESS:** `Customer 360 Aggregation` reports
  `PARTIAL — 2 of 3 claimed steps did not land` until P3 is fixed.

---

## J2 — Finance + trade-in, Fortuner, WARM, KYC rejected then approved, positive equity

Persona **Sakina Rangwala**. Unit **NX-1003**, AED 152,000.

### 2.1 Expected execution chain
**Msg 1** `Salaam, looking for a family SUV under 160k…` — BDC chain identical to J1 msg 1.
`Reply Eligibility` passes on keyword `suv`. `New Lead Worth Scoring?` true → one Master
Router execution.

`NEXUS Master Lead Router`, WARM path:
```
… Parse AI Decision → Intent Switch [output 1 = WARM]
 → WARM: Already In A Live Chat? [TRUE — origin 'whatsapp-bdc'] → Delivery Report → Audit Log
```
Must **not** run: `WhatsApp BDC (WARM)` (suppressed by origin — a WARM lead already in a
thread must not be re-welcomed), `Slack Router (HOT)`, `ERP Sync (HOT)`,
`HOT: Already In A Live Chat?`, `WhatsApp Outreach (HOT)`, `Marketing Drip (COLD)`,
`Slack: Unclassified Lead`. **`Lead Escalation` must not run** — WARM does not escalate.
WARM `Delivery Report` has an **empty** `CLAIMED` list, so `status` is `SUCCESS` with
`note = 'all 0 claimed steps verified. Outreach deliberately skipped: …'`.

**Msg 2** trade-in mention — BDC chain, `matched_lead=true`, no re-score. The agent may call
`finance_calculator`; see 2.4.

**Msg 3** blurry / cropped Emirates ID — KYC attempt 1:
```
Called by Another Workflow → Prepare Document → OpenRouter Vision → Parse JSON Output
 → Prepare Archive → Archive to Storage → Merge Archive Result
 → Is An Identity Document? [TRUE] → Validation Check [FALSE — isValid=false]
 → Rejected → Count Previous KYC Rejections   (0 rows matching '[KYC-REJECT]')
 → Decide: Re-ask or Escalate                 (attempts=0, nextAttempt=1, withinLimit=true)
 ├─ (y=176, first) Within Retry Limit? [TRUE] → WhatsApp: Request Re-upload
 │      → Delivery Report (KYC Re-ask) → Log KYC Re-ask   (writes the '[KYC-REJECT] …' row)
 └─ (y=304, second) Delivery Report (KYC Rejected) → Record KYC (Rejected)
```
Must **not** run: `Approved`, `WhatsApp: KYC Approved`, `Log KYC Approved`,
`Record KYC (Approved)`, `Slack: KYC Escalation`, `Log KYC Escalation`,
`Record Non-Document`.

**Msg 4** clear Emirates ID — KYC attempt 2, the J1 approved chain
(`Validation Check [TRUE] → Approved → …`).

**Finance Desk** (dashboard → `POST /webhook/finance-calc`, must carry a Supabase JWT and
`lead_email`):
```
Webhook Trigger → Verify JWT → Calculate Equity & Tier   (status='success')
 → Quote Valid? [TRUE] → Log Quote → Audit Log → Return Quote
```
`Quote Valid?` false branch (straight to `Audit Log`) must not run.

**Ask AI:** as J1, expecting Warranty Policy / Extended Warranty p.13.

### 2.2 Verification SQL
```sql
-- A. lead
select id, name, email, phone, status, ai_score, budget_aed, vehicle_interest, escalated_at
from leads where phone = '+918517942172' and created_at >= :t0;
-- expect status='WARM'; escalated_at IS NULL

-- B. the two KYC attempts, in order
select created_at, verdict, is_valid, tampering, attempt_number, max_attempts,
       confidence_score, storage_path, left(remarks, 200) as remarks
from kyc_documents
where (lead_email = 'shabbir53ujjainwala@gmail.com' or chat_id = '158510264357112@lid')
  and created_at >= :t0
order by created_at;
-- expect exactly 2 rows:
--   #1 verdict='REJECTED', is_valid=false, tampering=false, attempt_number=1, max_attempts=3
--   #2 verdict='APPROVED', is_valid=true,  tampering=false, attempt_number=1
-- both storage_path NOT NULL

-- C. the re-upload prompt actually reached the customer
select created_at, direction, left(message, 300) as msg
from communication_logs
where lead_email in ('158510264357112@lid','shabbir53ujjainwala@gmail.com')
  and message like '[KYC-REJECT]%' and created_at >= :t0;
-- expect exactly 1 row, containing '(Attempt 1 of 3)' and
--   '[delivery: SUCCESS - all 3 claimed steps verified]'

-- D. the finance quote
select id, lead_email, lead_name, quoted_by, vehicle_value_aed, loan_payoff_aed,
       credit_score, equity_aed, equity_status, loan_to_value_pct, finance_tier,
       indicative_apr_pct, disclaimer, source, created_at
from finance_quotes
where lead_email = 'shabbir53ujjainwala@gmail.com' and created_at >= :t0;
-- expect exactly 1 row with EXACTLY:
--   vehicle_value_aed=45000, loan_payoff_aed=28000, credit_score=710,
--   equity_aed=17000, equity_status='Positive', loan_to_value_pct=62.2,
--   finance_tier='Prime', indicative_apr_pct=5.49, source='finance-calc-webhook',
--   disclaimer='Indicative only. Final APR and approval are set by the lender, not by NEXUS OS.'

-- E. audit rows
select logged_at, workflow, status, intent, lead_score, left(summary,300) as summary
from audit_log where logged_at >= :t0 order by logged_at;
-- expect: >=2 'WhatsApp BDC Agent' SUCCESS; 1 'Master Router' SUCCESS intent='WARM';
--         1 'Finance Calc' SUCCESS; 1 'Ask-AI RAG Query' SUCCESS;
--         NO 'Lead Escalation' row; NO 'KYC Auditor - Phase 5' row
```

### 2.3 Pass / fail criteria
| # | Claim | Row / column / value | A wrong value means |
|---|---|---|---|
| 1 | WARM, not HOT | `leads.status='WARM'` and the `Master Router` audit row `intent='WARM'` | `HOT` = the scorer read "under 160k" as budget certainty, or `check_purchase_history` wrongly returned rows (J8 residue not wiped) |
| 2 | No escalation | `leads.escalated_at IS NULL`; **zero** `audit_log` rows `workflow='Lead Escalation'` | any row = `Intent Switch` sent a WARM lead down output 0 |
| 3 | WARM outreach suppressed | Master Router `Delivery Report` `status='SUCCESS'`, note *"all 0 claimed steps verified. Outreach deliberately skipped…"* | a `dropped[]` entry naming `WhatsApp BDC (WARM)` = the origin flag was lost and the router tried to re-welcome a live customer |
| 4 | Exactly two KYC rows | query B returns **2** | 3 rows = the clear ID was also rejected (retry the photo); 1 row = the blurry ID passed validation — the vision model is too lenient, a real defect |
| 5 | Rejection is on clarity, not tampering | row #1: `is_valid=false` **and** `tampering=false`; `remarks` mentions blur/clarity/legibility | `tampering=true` = the model mis-diagnosed; the customer was told their document "looks edited", which is a customer-relations defect even though the loop behaves the same |
| 6 | The customer was actually asked again | query C returns exactly 1 row ending `[delivery: SUCCESS - all 3 claimed steps verified]` | `[delivery: FAILED …]` = `WhatsApp: Request Re-upload` dropped; Ali got nothing and the loop is invisible to him. 0 rows = the re-ask leg never ran and the counter can never advance |
| 7 | Attempt numbering | row #1 `attempt_number=1`, `max_attempts=3` | see PLAN CORRECTIONS #3 — the second (approved) row is hardcoded to `attempt_number=1`, **not** 2. `attempt_number=2` on the approved row would mean someone changed `Record KYC (Approved)` |
| 8 | Both documents retained | both rows `storage_path IS NOT NULL`; both objects reachable in the `kyc-documents` bucket | a NULL on the **rejected** row is still a compliance hole — AML retention covers rejected documents (that is why `Prepare Archive` sits upstream of the verdict branch) |
| 9 | Finance arithmetic | query D, every value exactly as listed | `equity_status='Negative'` = the inputs were swapped; `finance_tier='Prime Plus'` = the 720 boundary moved; `loan_to_value_pct` ≠ 62.2 = the rounding (`*1000/10`) changed |
| 10 | Quote is attributable | `finance_quotes.lead_email='shabbir53ujjainwala@gmail.com'`, `quoted_by` non-null | null `quoted_by` = the dashboard did not send `quoted_by`/`rep`; the row is unauditable but the calculation still passed |
| 11 | Finance audit | 1 `audit_log` row `workflow='Finance Calc'`, `status='SUCCESS'`, `summary='Quote issued'` | `status='REJECTED'` = validation fired; read `summary` for which of the four errors |
| 12 | Finance Calc has no Delivery Report | there is none — a `SUCCESS` audit row here does **not** prove `Log Quote` landed | cross-check by confirming query D actually returns the row; if the audit says SUCCESS and query D is empty, that is exactly the class of lie the Delivery Report pattern exists to stop (PLAN CORRECTIONS #1) |
| 13 | Ask AI citation | `sources[]` = Warranty Policy / **Extended Warranty** / p.13 | p.12 = it returned Standard Coverage instead; the chunk ranking is wrong, not the workflow |

### 2.4 What may legitimately differ
* **Must hold:** WARM classification. **May vary:** `ai_score` anywhere in roughly 40–70,
  the reason text.
* **Must hold:** attempt 1 rejected, attempt 2 approved, in that order.
  **May vary:** the exact rejection wording in `remarks` and therefore in the WhatsApp
  re-upload message (it is built from `parsed.remarks`). "too blurry to read", "image is
  cropped, corners missing" and "text not legible" are all correct outcomes.
* **May vary:** `confidence_score` on both rows.
* **The in-chat finance answer will not match the Finance Desk row.** The BDC's
  `finance_calculator` tool passes only `vehicleValue`, `loanPayoffAmount`, `creditScore` —
  no `lead_email` — and `Calculate Equity & Tier` **requires** `lead_email`. So a tool call
  from the chat returns `status:'error'` with
  *"lead_email is required so the quote can be attached to a customer."*, writes **no**
  `finance_quotes` row, and produces an `audit_log` row `workflow='Finance Calc'`,
  `status='REJECTED'`. **Expect that extra REJECTED row if the agent used the tool** — it is
  a known defect (PLAN CORRECTIONS #6), not a J2 failure. The quote under test is the
  Finance Desk one, `source='finance-calc-webhook'`.
* **May vary:** how the agent phrases the trade-in reply when the tool errors. It must not
  invent equity numbers.

---

## J3 — COLD Corolla, then silence: full drip then silence escalation

Persona **Huzaifa Lokhandwala**. Unit **NX-1012**, AED 79,000.

**This journey cannot run without P7** (§0.1). `Normalize Lead Input` throws on a
null-email lead, and `Find Silent Leads` skips it.

### 3.1 Expected execution chain
**Msg 1** `how much for a small car` — BDC chain as J1 msg 1; `Reply Eligibility` passes on
keyword `car` (and `price`… no — on `car`). Then one Master Router execution:
```
… Parse AI Decision → Intent Switch [output 2 = COLD]
 → Marketing Drip (COLD)   [waitForSubWorkflow:false]
 → Delivery Report → Audit Log
```
Note the COLD branch has **no** `Already In A Live Chat?` guard — the drip fires even
though the customer is mid-conversation. `Slack Router (HOT)`, `ERP Sync (HOT)`,
`HOT:`/`WARM: Already In A Live Chat?`, `WhatsApp Outreach (HOT)`, `WhatsApp BDC (WARM)`,
`Slack: Unclassified Lead` must not run.
COLD `Delivery Report` claims only `Marketing Drip (COLD)` as *"(start only)"* — with
`waitForSubWorkflow:false` a `SUCCESS` here means the sub-workflow **started**, nothing more.

`7-Day Warm Lead Drip` (G7FhvMY2ucW5Fg7X), one long-running execution:
```
Called by Master Router → Normalize Lead Input      (throws if lead.email is null)
 → Wait Day 1  → Email: Welcome (Gmail) → Log Welcome Email
 → Has WhatsApp? (Day 1) [TRUE — lead.phone present]
     → WhatsApp: Welcome → Log WhatsApp Welcome
 → Wait Day 3  → Email: Follow Up (Gmail) → Log Follow Up Email
 → Wait Day 5  → Has WhatsApp? (Day 5) [TRUE] → WhatsApp: Check-in → Log WhatsApp Check-in
 → Wait Day 7  → Email: Final Offer (Gmail) → Log Final Offer Email
 → Delivery Report → Audit Log
```
The `Has WhatsApp?` false branches (`→ Wait Day 3`, `→ Wait Day 7` direct) must not run.

`Phase 6 - 12-Hour Silence Detector` (B3TcpfzOMWj8oWgF), the hourly run after the drip's
last outbound is older than `SILENCE_HOURS`:
```
Every Hour → Fetch Open Leads (status neq 'LOST') → Fetch Recent Comms
 → Find Silent Leads   (1 item)
 → Loop Over Silent Leads [output 1] → Trigger Lead Escalation   [waitForSubWorkflow:true]
 → Mark as Escalated
    ├─ back to Loop Over Silent Leads
    └─ Delivery Report → Audit Log
```
On the **next** hourly run the same lead must be dropped inside `Find Silent Leads` by the
`[SILENCE-ESCALATED]` guard — `Trigger Lead Escalation` must **not** run a second time.

### 3.2 Verification SQL
```sql
-- A. lead
select id, name, email, phone, status, ai_score, budget_aed, escalated_at
from leads where phone = '+918517942172' and created_at >= :t0;
-- expect status='COLD'

-- B. the whole drip, in order
select created_at, channel, direction, message
from communication_logs
where lead_email = 'shabbir53ujjainwala@gmail.com' and created_at >= :t0
order by created_at;
-- expect EXACTLY these 5, in this order:
--   'Drip Day 1 - Welcome to NEXUS OS'        channel='email'
--   'Drip Day 1 - WhatsApp welcome'           channel='whatsapp'
--   'Drip Day 3 - ...'                        channel='email'
--   'Drip Day 5 - ...'                        channel='whatsapp'
--   'Drip Day 7 - ...'                        channel='email'
-- (exact Day 3/5/7 strings come from Log Follow Up Email / Log WhatsApp Check-in /
--  Log Final Offer Email; read them off the node, they are static text)

-- C. the silence marker — must be exactly one
select created_at, lead_email, channel, direction, message
from communication_logs
where message like '[SILENCE-ESCALATED]%' and created_at >= :t0;
-- expect exactly 1 row, channel='system', direction='outbound',
-- lead_email='shabbir53ujjainwala@gmail.com'

-- D. no re-escalation after a second detector run
select count(*) as must_be_one from communication_logs
where message like '[SILENCE-ESCALATED]%' and created_at >= :t0;
select count(*) as must_be_one from audit_log
where workflow = 'Phase 6 Silence Detector' and logged_at >= :t0;

-- E. escalation actually happened
select escalated_at from leads where email = 'shabbir53ujjainwala@gmail.com';
select logged_at, status, left(summary,300) from audit_log
where workflow = 'Lead Escalation' and logged_at >= :t0;

-- F. drip verdict
select logged_at, status, left(summary,400) as summary from audit_log
where workflow = '7-Day Warm Lead Drip' and logged_at >= :t0;
-- expect exactly 1 row, status='SUCCESS',
-- summary = 'Completed - all 10 claimed steps verified'

-- G. nothing else fired
select count(*) as must_be_zero from kyc_documents where created_at >= :t0;
select count(*) as must_be_zero from finance_quotes where created_at >= :t0;
```

### 3.3 Pass / fail criteria
| # | Claim | Row / column / value | A wrong value means |
|---|---|---|---|
| 1 | COLD | `leads.status='COLD'`, `Master Router` audit `intent='COLD'` | `WARM` = the scorer over-read "how much for a small car"; retry with a flatter message. `UNKNOWN` = `Intent Switch` fell through to `Slack: Unclassified Lead` |
| 2 | Drip started | `Master Router` audit `status='SUCCESS'`, `dropped[]` empty, note contains *"(start only)"* wording via `verified[]` | a `dropped[]` naming `Marketing Drip (COLD)` with *"node produced no items"* = the sub-workflow refused at `Normalize Lead Input`, i.e. P7 was not applied |
| 3 | Drip actually ran end to end | query B returns **5** rows in that order | 0 rows and a drip execution in `error` with *"a lead arrived but carried no email address"* = the P7 gap. 3 rows only (no whatsapp) = `Has WhatsApp? (Day 1)` went false, i.e. `leads.phone` was empty when the router called the drip |
| 4 | Drip delivery honest | query F `status='SUCCESS'` and **`all 10 claimed steps verified`** | 10 = 6 email/log claims + 4 WhatsApp claims. `all 6` = `hasWhatsApp` was false and the two WhatsApp legs were never even claimed — that is a silent halving of the test, not a pass. `PARTIAL` = a `Log …` row dropped. `FAILED` = a Gmail or WAHA send dropped |
| 5 | Silence detected once | query C: exactly **1** row | 0 rows = `Find Silent Leads` produced nothing: either `leads.email` is null (P7), or the last outbound is younger than `SILENCE_HOURS`, or an inbound row is newer than the last outbound (Ali replied — the whole test is that he must not) |
| 6 | Escalated once, not hourly | query D: both counts **= 1** after at least **two** detector runs | 2+ = the `[SILENCE-ESCALATED]` guard in `Find Silent Leads` is not matching — check that `Mark as Escalated` wrote `lead_email` equal to `leads.email` exactly |
| 7 | Escalation landed | `leads.escalated_at` NOT NULL; `Lead Escalation` audit `status='SUCCESS'` | `Return Result.status='escalation_unverified'` = `Delivery Report` was unreachable from the branch that answered — the Silence Detector then believes an unverified escalation |
| 8 | Detector delivery | `Phase 6 Silence Detector` audit `status='SUCCESS'` | `FAILED` = `Trigger Lead Escalation` dropped (critical); `PARTIAL` = `Mark as Escalated` dropped, which is worse than it sounds — without that row the lead will be re-escalated every hour |
| 9 | Nothing else touched | query G both **0** | any row = leakage from a previous journey's teardown |
| 10 | Ask AI citation | `sources[]` = HR Handbook / Annual Leave / `hr_handbook_2026.pdf` / p.22 | a Warranty Policy source = the retrieval is sales-biased |

### 3.4 What may legitimately differ
* **Must hold:** COLD. **May vary:** `ai_score` (expect low, ≤ 40), reason text.
* **Must hold:** the five drip log rows and their order. Their `message` text is **static**
  — it is not model output, so it must match exactly. Only `created_at` varies.
* **May vary:** `hours_silent` in the `[SILENCE-ESCALATED]` message, and the
  `last_outbound_at` timestamp inside it.
* **May vary:** the `AI Escalation Analyst` output text in the Slack post and the
  `Lead Escalation` audit `summary`.
* **Timing is config, not behaviour.** With P5 applied the four `Wait` nodes are minutes,
  not days. The *durations* prove nothing (Part 5.2); only the *sequence* does.
* **Watch for:** the drip's WhatsApp legs address `918517942172@c.us`, not the LID chat id
  Ali is actually chatting in. Whether WAHA delivers to that address is a real question —
  if it does not, `WhatsApp: Welcome` returns an error item and the drip goes `FAILED`
  with `dropped[]` naming the WhatsApp legs, while `Log WhatsApp Welcome` still writes its
  row (it does not read the send result). See PLAN CORRECTIONS #7.

---

## J4 — KYC gives up: retry limit and escalation

Persona **Yusuf Bandukwala**. Unit **NX-1004** Pajero GLS, 108 days in stock.

**The plan's script does not reach escalation.** See PLAN CORRECTIONS #2 and #4 — you need
**four rejected identity documents**, and the utility bill does not count as one.
Revised script:

1. `Do you have anything cheap in a 4x4? Budget 130k max`
2. photo of a **utility bill** — non-document, no attempt consumed
3. **expired** Emirates ID — rejection 1
4. **damaged / obscured** Emirates ID — rejection 2
5. **another bad** Emirates ID (e.g. glare / half-cropped) — rejection 3
6. **a fourth bad** Emirates ID — rejection 4 → escalation

### 4.1 Expected execution chain
**Msg 1** — BDC chain as J1 msg 1; Master Router scores (WARM or COLD, either is fine here);
one Master Router execution. Follow the matching branch from J2 / J3.

**Msg 2, the utility bill** — `Is Document?` in the BDC is TRUE (it only tests
`is_document && matched_lead`, i.e. "an image from a known lead"), so it still goes to KYC:
```
KYC: Prepare Document → OpenRouter Vision → Parse JSON Output → Prepare Archive
 → Archive to Storage → Merge Archive Result
 → Is An Identity Document? [FALSE]
 → Delivery Report (Non-Document) → Record Non-Document
```
Must **not** run: `Validation Check`, `Approved`, `Rejected`, `Count Previous KYC
Rejections`, `Decide: Re-ask or Escalate`, `Within Retry Limit?`, both WhatsApp sends, both
Slack posts, `Record KYC (Approved)`, `Record KYC (Rejected)`.
**Nothing is sent to the customer on this branch** — `Delivery Report (Non-Document)` has an
empty `CLAIMED` list and claims only that the image was retained.

**Msgs 3, 4, 5 — rejections 1, 2, 3** — the J2 attempt-1 chain each time:
```
… → Rejected → Count Previous KYC Rejections → Decide: Re-ask or Escalate
 ├─ Within Retry Limit? [TRUE] → WhatsApp: Request Re-upload
 │     → Delivery Report (KYC Re-ask) → Log KYC Re-ask
 └─ Delivery Report (KYC Rejected) → Record KYC (Rejected)
```
with `attempts` = 0 → 1 → 2 and `nextAttempt` = 1 → 2 → 3, `withinLimit` true each time.

**Msg 6 — rejection 4, the escalation:**
```
… → Rejected → Count Previous KYC Rejections   (3 '[KYC-REJECT]' rows)
 → Decide: Re-ask or Escalate                  (attempts=3, nextAttempt=4, withinLimit=FALSE)
 ├─ Within Retry Limit? [FALSE] → Slack: KYC Escalation
 │     → Delivery Report (KYC Escalation) → Log KYC Escalation   (the only KYC audit_log write)
 └─ Delivery Report (KYC Rejected) → Record KYC (Rejected)   (verdict flips to 'ESCALATED')
```
`WhatsApp: Request Re-upload` and `Log KYC Re-ask` must **not** run on this execution — the
customer is not asked a fifth time. **The loop terminating here is the whole test.**

**Inventory ageing** on the Pajero is the nightly `Inventory Ageing Recompute`
(`Every night at 00:15 → Recompute Inventory Ageing → Audit Log`) — a Postgres RPC, not
part of the journey chain. Trigger it manually if you need a fresh `aging_alert`.

### 4.2 Verification SQL
```sql
-- A. every kyc row this journey produced, in order
select created_at, verdict, is_valid, tampering, attempt_number, max_attempts,
       document_type, confidence_score, storage_path,
       left(remarks,200) as remarks, void_reason, voided_at
from kyc_documents
where (lead_email = 'shabbir53ujjainwala@gmail.com' or chat_id = '158510264357112@lid')
  and created_at >= :t0
order by created_at;
-- expect 5 rows:
--   #1 (utility bill)  -- SEE PLAN CORRECTIONS #5: this INSERT is expected to FAIL
--   #2 verdict='REJECTED'  attempt_number=1
--   #3 verdict='REJECTED'  attempt_number=2
--   #4 verdict='REJECTED'  attempt_number=3
--   #5 verdict='ESCALATED' attempt_number=4  max_attempts=3

-- A2. therefore run this too, and expect 4 rows not 5
select count(*) as expect_4 from kyc_documents
where chat_id = '158510264357112@lid' and created_at >= :t0;
select count(*) as expect_0_see_correction_5 from kyc_documents
where chat_id = '158510264357112@lid' and verdict = 'NOT_A_DOCUMENT';

-- B. the re-ask ladder
select created_at, left(message, 200) as msg
from communication_logs
where lead_email in ('158510264357112@lid','shabbir53ujjainwala@gmail.com')
  and message like '[KYC-REJECT]%' and created_at >= :t0
order by created_at;
-- expect EXACTLY 3 rows, containing '(Attempt 1 of 3)', '(Attempt 2 of 3)', '(Attempt 3 of 3)'
-- a 4th row = the loop did not terminate

-- C. the escalation audit row
select logged_at, workflow, status, lead_name, lead_email, left(summary, 400) as summary
from audit_log where workflow = 'KYC Auditor - Phase 5' and logged_at >= :t0;
-- expect exactly 1 row, status='ESCALATED',
-- summary starting 'KYC re-upload loop exhausted after 3 attempts. Reason: '

-- D. the aged unit
select id, model, days_in_stock, aging_alert, ai_recommendation, recommended_commission,
       holding_cost_accrued, price_aed, cost_aed
from inventory where id = 'NX-1004';
-- expect days_in_stock >= 108 and aging_alert set

-- E. no runaway
select count(*) from audit_log where workflow = 'KYC Auditor - Phase 5' and logged_at >= :t0;
-- must be exactly 1
```

### 4.3 Pass / fail criteria
| # | Claim | Row / column / value | A wrong value means |
|---|---|---|---|
| 1 | The loop terminates | query B returns exactly **3** rows | 4+ = `Decide: Re-ask or Escalate` never saw `withinLimit=false`. The usual cause is that `Count Previous KYC Rejections` filters `lead_email = $json.lead_email` while `Log KYC Re-ask` writes `lead_email || chat_id` — if the lead has no email the counter reads a key nothing was written under and **the loop runs forever**. This is the exact regression J4 exists to catch; see PLAN CORRECTIONS #8 |
| 2 | Escalated row exists | query A row #5: `verdict='ESCALATED'`, `attempt_number=4`, `max_attempts=3` | `attempt_number=3` = someone changed `Decide: Re-ask or Escalate`; `verdict='REJECTED'` on the 4th = `withinLimit` was still true |
| 3 | Escalation reached a human | `audit_log` row `workflow='KYC Auditor - Phase 5'`, `status='ESCALATED'` (not `ESCALATED_FAILED` / `ESCALATED_PARTIAL`), and a visible `:no_entry: KYC blocked - human needed` post in `#sales-hot-leads` | `ESCALATED_FAILED` = `Slack: KYC Escalation` dropped: the row says a human was asked to take over and nobody was. That is the exact lie the Delivery Report pattern exists to expose — **hard fail** |
| 4 | Only one escalation | query E = 1 | >1 = the loop escalated repeatedly |
| 5 | Utility bill did not consume an attempt | the bill produces **no** `[KYC-REJECT]` row and **no** `REJECTED` kyc row; rejection 1 still reports `(Attempt 1 of 3)` | if the bill consumed an attempt, `Is An Identity Document?` wrongly went true — the vision model classified a bill as an ID |
| 6 | Non-document was recorded | query A2 second count — **expected 0 today**, because `Record Non-Document` posts `verdict:'NOT_A_DOCUMENT'` which violates the `kyc_documents.verdict` CHECK. The insert 400s, is swallowed by `onError: continueRegularOutput`, and the run stays green | if it returns 1, the CHECK constraint was widened since this export — re-read the schema. Either way, **the non-document image is retained in Storage but has no row**, so the Compliance screen shows nothing. See PLAN CORRECTIONS #5 |
| 7 | Every attempt retained | rows #2–#5 all have `storage_path IS NOT NULL`; the bill's object exists in the bucket even though its row does not | a NULL `storage_path` on any rejected row = `Archive to Storage` dropped; the corresponding `Delivery Report` will say so |
| 8 | Delivery text on each row | rows #2–#5 `remarks` all end `[delivery: SUCCESS - all 2 claimed steps verified]` (1 claim + the Storage-retention check); the three `[KYC-REJECT]` log rows end `all 3 claimed steps verified` | row #5 is written by `Delivery Report (KYC Rejected)`, which claims only `Count Previous KYC Rejections` — it deliberately does **not** claim the Slack post (parallel branch). Do not read its SUCCESS as proof the Slack post landed; criterion 3 is the proof |
| 9 | Aged unit visible | query D `aging_alert` non-null on `NX-1004` | null = `Recompute Inventory Ageing` has not run since the seed |
| 10 | Ask AI citation | `sources[]` = Trade-In Appraisal SOP / Manager Approval Threshold / p.11 | |

### 4.4 What may legitimately differ
* **Must hold:** the utility bill yields `isIdentityDocument=false`; four ID photos yield
  `isValid=false`; the fourth escalates.
  **May vary:** `confidence_score` and `remarks` on each; whether `tamperingDetected` is true
  on the "damaged/obscured" one (either is acceptable — both route to `Rejected`).
* **Real risk to plan for:** the vision model may classify a *badly* damaged or obscured ID
  as `isIdentityDocument: false` rather than "an invalid ID". That sends it to
  `Record Non-Document` and **does not consume an attempt**. If that happens, send another
  bad-but-recognisable ID rather than declaring a failure. Make each rejected photo
  obviously an Emirates ID: wrong/expired data, glare, a torn corner — not an unreadable blur.
* **May vary:** the lead's WARM/COLD score; J4 does not test scoring.
* **May vary:** the `AI BDC Sales Agent` reply to msg 1.

---

## J5 — Negative equity, bad credit, plus a rejected finance input

Persona **Zainab Poonawala**. Unit **NX-1010** Range Rover Sport HSE, 143 days.

### 5.1 Expected execution chain
**Msgs 1–3** — BDC chain as J1 (msg 1 scores; msgs 2 and 3 do not re-score;
`Reply Eligibility` passes on `range rover`, then `finance`/`loan`-family keywords —
though `matched_lead=true` already carries it from msg 2 onward).
Master Router: WARM or HOT depending on the scorer; follow the matching branch from
J1 (HOT) or J2 (WARM). Either is acceptable — J5 tests finance, not scoring.

**Finance Desk, the valid quote** (`POST /webhook/finance-calc` with JWT and `lead_email`):
```
Webhook Trigger → Verify JWT → Calculate Equity & Tier   (status='success')
 → Quote Valid? [TRUE] → Log Quote → Audit Log → Return Quote
```

**Finance Desk, the deliberate rejection** (`vehicleValue = 2000`):
```
Webhook Trigger → Verify JWT → Calculate Equity & Tier   (status='error')
 → Quote Valid? [FALSE] → Audit Log → Return Quote
```
`Log Quote` must **not** run — no `finance_quotes` row for the rejected submission. This is
the whole point: a junk valuation must not become a stored quote.

**Competitors module** against `NX-1010` — `Competitor Price Scraping & Supabase Update`
(LphiGg4iqF1bn6El), scheduled:
```
Schedule Trigger → Fetch Local Inventory → Build Apify Query
 → Apify - Search Competitor Price → Extract Price with AI → Parse AI Price
 → Is This Real Intel?  [true] → Log Competitor Intel → Delivery Report → Audit Log
                        [false] → Audit Log
```
`Should Update Price?` and `Build Update Payload` and `Update Prices in Supabase` are
**unreachable** — nothing connects into `Should Update Price?`. Prices are never updated.
This is P2 territory; do not expect an `inventory.price_aed` change.

**Ask AI:** Trade-In Appraisal SOP / Market Value Verification p.10.

### 5.2 Verification SQL
```sql
-- A. the negative-equity quote
select id, lead_email, lead_name, quoted_by, vehicle_value_aed, loan_payoff_aed,
       credit_score, equity_aed, equity_status, loan_to_value_pct, finance_tier,
       indicative_apr_pct, disclaimer, source, created_at
from finance_quotes
where lead_email = 'shabbir53ujjainwala@gmail.com' and created_at >= :t0
order by created_at;
-- expect EXACTLY ONE row with EXACTLY:
--   vehicle_value_aed = 140000
--   loan_payoff_aed   = 210000
--   credit_score      = 560
--   equity_aed        = -70000
--   equity_status     = 'Negative'
--   loan_to_value_pct = 150.0
--   finance_tier      = 'Subprime'
--   indicative_apr_pct= 12.5
--   source            = 'finance-calc-webhook'
--   disclaimer        = 'Indicative only. Final APR and approval are set by the lender, not by NEXUS OS.'

-- B. the rejected submission left no quote
select count(*) as must_be_one from finance_quotes
where lead_email = 'shabbir53ujjainwala@gmail.com' and created_at >= :t0;
-- must be 1, not 2

-- C. the rejection is audited
select logged_at, status, left(summary, 400) as summary
from audit_log where workflow = 'Finance Calc' and logged_at >= :t0 order by logged_at;
-- expect EXACTLY 2 rows:
--   #1 status='SUCCESS',  summary='Quote issued'
--   #2 status='REJECTED', summary='Rejected: vehicleValue must be a realistic vehicle
--      valuation of at least AED 5000.'
--   (note the trailing full stop; the string is built as
--    'at least AED ' + MIN_VEHICLE_VALUE_AED + '.')

-- D. the most-aged unit
select id, model, days_in_stock, price_aed, cost_aed, gross_margin, net_margin,
       holding_cost_accrued, aging_alert, ai_recommendation, recommended_commission
from inventory where id = 'NX-1010';
-- expect days_in_stock >= 143, aging_alert set, ai_recommendation non-null

-- E. competitors
select * from competitors order by created_at desc limit 10;   -- P2: may be empty
select logged_at, status, left(summary, 300) from audit_log
where workflow = 'Competitor Price Scraping' and logged_at >= :t0;

-- F. lead + comms
select id, name, email, phone, status, ai_score, vehicle_interest, budget_aed
from leads where phone = '+918517942172' and created_at >= :t0;
select created_at, direction, channel, left(message,150) from communication_logs
where lead_email in ('158510264357112@lid','shabbir53ujjainwala@gmail.com')
  and created_at >= :t0 order by created_at;
-- expect 3 inbound / 3 outbound; no [KYC-*] rows

-- G. nothing else
select count(*) as must_be_zero from kyc_documents where created_at >= :t0;
```

### 5.3 Pass / fail criteria
| # | Claim | Row / column / value | A wrong value means |
|---|---|---|---|
| 1 | Negative equity computed | query A `equity_aed = -70000` **and** `equity_status='Negative'` | `+70000` = the inputs were swapped in the Finance Desk form; `'Positive'` with a negative number = the `equity >= 0` test changed |
| 2 | LTV over 100 % | `loan_to_value_pct = 150.0` exactly | 150 (integer) is fine; 66.7 = the ratio is inverted; null = `vehicleValue` was 0 |
| 3 | Worst tier, highest APR | `finance_tier='Subprime'`, `indicative_apr_pct=12.5` | `'Near Prime'` = the 620 boundary moved; 560 must fall through all three `else if` rungs |
| 4 | Disclaimer present | `disclaimer` matches the exact string in query A | missing/edited = a finance figure is being shown without the lender caveat — a compliance defect, not cosmetic |
| 5 | Junk input rejected | query B = **1** | 2 = `Quote Valid?` let `status='error'` through and a nonsense valuation is now a stored quote |
| 6 | Rejection is recorded, not silent | query C row #2 `status='REJECTED'` with the exact message | no second row = the rejection was swallowed and nobody can see the attempt. `status='SUCCESS'` = the audit expression stopped reading `Calculate Equity & Tier.status` |
| 7 | `REJECTED` satisfies the CHECK | `audit_log.status = upper(audit_log.status)` — `'REJECTED'` passes | a lowercase status would have thrown a 23514; the insert is swallowed, so you would see **no** row at all rather than an error |
| 8 | Finance Calc has no Delivery Report | there is none. A `SUCCESS` audit row does not prove `Log Quote` landed | if query C shows SUCCESS and query A shows 0 rows, the audit row is lying — the one workflow still exposed to the original defect (PLAN CORRECTIONS #1) |
| 9 | Aged stock surfaced | query D: `NX-1010` has the highest `days_in_stock` of all units and a non-null `ai_recommendation` | null `ai_recommendation` = the ageing recompute has not run |
| 10 | Competitors | expect **no** `inventory.price_aed` change and, if `competitors` is empty, an `audit_log` row from `Competitor Price Scraping` explaining it | a price change would mean the disconnected `Should Update Price?` chain was reconnected — verify deliberately. See PLAN CORRECTIONS #9 |
| 11 | No KYC | query G = 0 | J5 sends no documents |
| 12 | Ask AI citation | `sources[]` = Trade-In Appraisal SOP / Market Value Verification / p.10 | p.11 = it returned the Manager Approval section (J4's target) |

### 5.4 What may legitimately differ
* **All ten finance numbers in query A are pure arithmetic — no LLM.** They must match
  exactly. Any deviation is a code change, not model variance.
* **The rejection message must match character for character**, including the trailing full
  stop. It is a template literal, not model output.
* **May vary:** the lead's HOT/WARM classification and `ai_score`. J5 does not assert it.
  If it lands COLD, `Marketing Drip (COLD)` will start and you will get J3's drip on top —
  not a failure, but note it and expect the extra rows.
* **May vary:** how the BDC agent answers "I owe 210k on a car worth 140k". It **must not**
  state an equity figure it did not get from a tool. If it invoked `finance_calculator`,
  that call returns `status:'error'` (`lead_email is required…`) and writes an extra
  `audit_log` row `workflow='Finance Calc'`, `status='REJECTED'` — **expect up to 3 rows in
  query C, not 2**, if the agent used the tool. Adjust criterion 6 accordingly and check the
  `summary` to tell the two rejection causes apart.
* **May vary:** the agent's tone around bad credit. It must not promise approval.
* **May vary / may be empty:** everything in the Competitors module until P2 lands.

---

## PLAN CORRECTIONS

Ordered by how much they change what the runner does.

**1. "Since 26 Aug every workflow ends in a `Delivery Report` node" is not true.**
`Finance Calc` (`unMMpeL9uuPO79pp`) and `Inventory Ageing Recompute` (`ZUc42jcwwHoBeEr8`)
have none. Finance Calc still has the original shape: `Log Quote` carries
`onError: continueRegularOutput`, and `Audit Log` writes `SUCCESS` from
`Calculate Equity & Tier.status` without ever looking at whether the `finance_quotes` insert
landed. J2 and J5 must therefore verify the quote row directly and not trust the audit row.

**2. J4's retry limit is four rejections, not three.** `Decide: Re-ask or Escalate` sets
`MAX_ATTEMPTS = 3`, `nextAttempt = attempts + 1`, `withinLimit = nextAttempt <= MAX_ATTEMPTS`.
Attempts run 1, 2, 3 as re-asks; only the **fourth** rejection gives `nextAttempt = 4` and
flips `Within Retry Limit?` to false. The plan's three-document script escalates nothing.

**3. J2's approved row will read `attempt_number = 1`, not 2.** `Record KYC (Approved)`
hardcodes `attempt_number: 1`. Only `Record KYC (Rejected)` uses the real
`nextAttempt`. The plan's *"attempt 2 APPROVED, `attempt_number` = 2"* is unachievable
without a code change.

**4. J4's utility bill does not consume a KYC attempt.** It routes through
`Is An Identity Document? [false]` → `Record Non-Document` and never reaches
`Count Previous KYC Rejections`. The plan implies it is one of the three failures.

**5. `Record Non-Document` writes an illegal `verdict` and its insert is expected to fail.**
It posts `verdict: 'NOT_A_DOCUMENT'`, which violates the `kyc_documents.verdict` CHECK
(`PENDING|APPROVED|REJECTED|ESCALATED`). `onError: continueRegularOutput` +
`alwaysOutputData: true` swallow the 400, and it is the terminal node, so nothing reports it.
The image is retained in Storage with **no** row referencing it — which is also exactly the
archive-gap condition J10 goes looking for. Affects J4 and J9. Needs either a schema value
added or the node changed (the closest legal value is `REJECTED` with the existing
`void_reason`/`voided_at` already present on the payload).

**6. The BDC's `finance_calculator` tool can never produce a quote.** The tool passes only
`vehicleValue`, `loanPayoffAmount`, `creditScore`; `Calculate Equity & Tier` requires
`lead_email` and rejects without it. Every in-chat finance question therefore yields
`status:'error'`, no `finance_quotes` row, and an extra `audit_log` row
`workflow='Finance Calc'`, `status='REJECTED'`. Affects J2, J5 and J8. The Finance Desk
webhook path is unaffected.

**7. P5's clock table is incomplete.** The drip has **four** waits:
`Wait Day 1` (no `amount` param → n8n default, 1 day), `Wait Day 3` (2 days),
`Wait Day 5` (2 days), `Wait Day 7` (2 days) — 7 days total. P5 lists only `Wait Day 3` and
`Wait Day 7`. Shortening those two still leaves 3 days of waiting, so J3 cannot finish in a
sitting. All four must be shortened and all four restored.

**8. J3's "known gap" note is inverted, and it blocks J1 and J4 as well.** The plan says
*"here the lead does have [an email]"*. It does not: `Shape Lead For Router` sets
`email: ctx.lead_email`, which is null for any lead created from WhatsApp, and the address is
never parsed out of the message text. Consequences, all reachable in J1–J5:
`Lead Escalation` cannot find the lead and hits `No Lead To Escalate` (stopAndError), which
**fails the whole Master Router execution** because `Slack Router (HOT)` has no `onError`;
`Normalize Lead Input` throws and the drip never starts; `Find Silent Leads` filters the
lead out; and `Count Previous KYC Rejections` queries a key that `Log KYC Re-ask` never
wrote under, so the KYC re-ask loop can run forever. This is P7 in §0.1 and needs a decision
from Ali before J1.

**9. `Competitor Price Scraping` cannot update a price — the chain is severed.** Nothing
connects into `Should Update Price?`, so `Build Update Payload` and
`Update Prices in Supabase` are unreachable. P2 describes the empty `competitors` table and
the null-source bug; the disconnected branch is a third, separate defect. J5's *"Competitors
module against the most-aged unit"* can only test the intel-logging half.

**10. The plan's node name `Record KYC (Escalated)` does not exist.** The escalated row is
written by `Record KYC (Rejected)`, whose `verdict` expression flips to `'ESCALATED'` when
`withinLimit` is false. Grepping for the plan's name will find nothing.

**11. Master Router HOT is expected to audit as `FAILED` for reasons that are not delivery
failures.** Under `executionOrder: v1`, `Delivery Report` sits on the topmost branch out of
`Intent Switch` output 0 and is expected to run before `Slack Router (HOT)` and
`ERP Sync (HOT)`, reporting both as *"node did not run on this branch"*. On top of that,
`ERP Sync (HOT)` legitimately reports `FAILED` at the Bitrix plan wall (P6), which the
report catches via its `sub-workflow reported FAILED` test. The Part 0 definition of done
(*"`audit_log.status` for each workflow is `SUCCESS`"*) is therefore unreachable for
`Master Router` on any HOT journey. Confirm the branch order from the execution's node run
list on J1 and, if confirmed, either move `Delivery Report` below both nodes on the canvas
or amend the definition of done.

**12. `leads.assigned_to`, `assigned_to_id`, `response_time_minutes` and `inventory.status`
are never written by any of the 21 workflows.** J1's *"confirm HOT and assignment"*,
*"Team → assignment"* and *"Inventory → unit becomes Sold"* are dashboard-only writes. If
they stay empty the automation is not at fault; check the dashboard.

**13. Only the KYC escalation branch writes to `audit_log`.** Approve, reject and
non-document write nothing. `WhatsApp Send (Dashboard Reply)` writes nothing either. Do not
treat a missing `KYC Auditor - Phase 5` row in J1 or J2 as a failure — it is expected.

**14. On a document message the BDC produces no reply, no audit row and no inbound
`communication_logs` row.** `Is Document?` routes exclusively to the KYC branch; the
`Recent Outreach Check → … → Delivery Report → Audit Log` chain does not run. J1's message 4
and J2's messages 3–4 will look like gaps in the Conversations timeline. They are correct.
