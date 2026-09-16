# CONTAMINATION-MAP — what in production `dsvuoovivysszdoiorch` is not real business

Measured 9 September 2026, **read-only** (SELECT only; no DDL, no DML, nothing
deleted). Project `dsvuoovivysszdoiorch`, tenant `fff6a2b5-cfd5-4460-8383-875bc5826de0`
(ALBA CARS). Every row below carries the query or `file:line` that produced it and a
confidence with the reason attached. Nothing is called fake without saying why.

---

## 0. Verdict on the commit's claims (`4bc9f8f`)

| Claim in `4bc9f8f` | Verdict | Evidence |
|---|---|---|
| `purchase_history` holds exactly one row | **CONFIRMED** | `select count(*) from public.purchase_history;` → `1` |
| AED 585,000 | **CONFIRMED** | `amount_aed = 585000` |
| written 2026-09-02 | **CONFIRMED** | `created_at = 2026-09-02 09:59:53.189871+00` |
| against the owner's own test lead | **CONFIRMED** | `lead_id = 38`; lead 38 = `Ali` / `shabbir53ujjainwala@gmail.com`, still `WARM` |
| from a +91 number | **CONFIRMED** | `phone = +918517942172` (India country code, in a UAE-market system) |
| recorded in PILOT-ONBOARDING as a repair test | **CONFIRMED** | `commercial/PILOT-ONBOARDING.md:372` — *"one `purchase_history` row appeared at 09:59:53 on 2 Sep from a repair test against the owner's own lead — not a sale"* |
| `purchase_history` has no provenance column | **CONFIRMED** | 11 columns, none of them provenance — see §2 |
| **"six screens"** | **WRONG — it is nine** | see `BLAST-RADIUS.md`. Nine registered screens render a figure that moves when the row is removed; two more (`campaigns`, `conversations`) render it through the shared lead drawer. Six was the count of *bullet points* in `ops/frontend-audit/HONESTY-AUDIT.md:165-175`, not of screens. |

Two further corrections to the record, both minor and both worth fixing because the
same sentences are quoted downstream:

- `HONESTY-AUDIT.md:187` — *"The one table in the database that carries `is_test_traffic`
  is `lead_event`"*. **`lead_event` has no column of that name.** Its columns are
  `environment` and `provenance_counts_as_real` (`information_schema.columns`, 19 rows).
  `is_test_traffic` is a **derived** column of the view `v_lead_origin`. The distinction
  matters to the fix: the attestable base column is `provenance_counts_as_real`, and it
  is `NOT NULL` with **no default** — the writer is forced to state it. That is the
  precedent the owner's rule already has in this database.
- `4bc9f8f` — *"All 42 views in public are security_invoker=true"*. 41 of 42 carry the
  literal `security_invoker=true`; `v_competitor_latest` carries `security_invoker=on`.
  Behaviourally identical, so the contract conclusion stands, but a `reloptions` grep on
  the exact string misses one view.

---

## 1. The candidate table

`data_origin` here is what an honest provenance column **would** say, not what any
column says today. Confidence is about the *classification*, not about the row existing.

| # | Rows | Where | Would-be `data_origin` | Confidence | Evidence that made me say so |
|---|---|---|---|---|---|
| **C1** | 1 | `purchase_history` id `2f04d2c4-4cd2-424c-aa34-6cc2a0c20b86` | **TEST** | **CERTAIN** | Four independent witnesses. (a) `audit_log` at `2026-09-02 09:54:19.44+00`: `workflow='Sync Closed-Won Deals to Supabase pgvector'`, `status=FAILED`, summary begins **`transport_probe [line 74] · Failed at node: Format Deal Text · Execution 8650`** — the workflow was being *exercised*, by a probe, minutes before the write. (b) `audit_log` at `09:59:54.099+00`, 0.91 s **after** the insert: `SUCCESS`, `lead_name='Ali'`, summary *"Closed-won deal auto:shabbir53ujjainwala@gmail.com\|2026-09-02 — all 1 claimed steps verified. Not covered by this check: purchase_history row (Record Purchase) — parallel branch…"*. (c) `commercial/PILOT-ONBOARDING.md:372` records it as a repair test in the owner's own onboarding log. (d) The buyer is the operator: `customer_name='Ali'`, phone `+918517942172` — an **Indian** number, and lead 38 is still `status='WARM'`, i.e. the CRM does not think this person bought anything. A dealership does not record a AED 585,000 sale against a lead it still calls warm. |
| **C2** | 1 | `deals_embeddings` id `f3d39cda-b3a3-4ca0-a1ee-36835e60bca3` | **TEST** | **CERTAIN** | Same write, other half. `created_at = 2026-09-02 09:59:53.930941+00` — **0.74 s after** C1. Identical `deal_id` `auto:shabbir53ujjainwala@gmail.com\|2026-09-02`. `content` = *"Customer: Ali… Deal value: AED 585000. Closed at: 2026…"*. This is the RAG vector for the test sale: **Ask AI can quote the fake deal back to a rep as company fact.** `apps/executive-dashboard/screens/deals.js:671` documents the two-write branch: *"`deals/closed-won` writes purchase_history AND deals_embeddings in one"*. |
| **C3** | 15 (4 docs) | `rag_documents` | **SEED FIXTURE** | **CERTAIN** | Byte-for-byte identical to `ops/journey-lab/DO-NOT-RUN-IN-PRODUCTION/setup_real_data.sql:121-135` (quarantined 2026-09-14; was `setup_real_data.sql:111-125` at the repo root before a 10-line DO-NOT-RUN header was prepended), verified line by line. Four titles: `warranty_policy_v4.2.pdf` (5), `hr_handbook_2026.pdf` (3), `sales_compensation_policy.pdf` (3), `trade_in_appraisal_sop.pdf` (4). The text says *"All new vehicles sold by **NEXUS OS**…"* — it is the vendor's own demo copy, not an ALBA CARS policy. Liability, not just tidiness: a rep can quote a 3-year/100,000 km warranty ALBA never agreed to. |
| **C4** | 12 | `inventory` `NX-1001`…`NX-1012` | **SEED FIXTURE (probable)** | **MEDIUM–HIGH** | Structural tells, not a document: ids are a perfect unbroken sequence `NX-1001…NX-1012`; VINs end in a matching sequence `…100101`…`…100112` (`JTMHV05J204012001`, `JTJGB7CX0P4100111`); every one of the twelve is `status='Available'` — **no dealership has sold nothing from its entire floor**; `gross_margin` is an exact round number on all twelve. Held back from CERTAIN because I found **no** seed file in this repo that inserts them: `ops/journey-lab/DO-NOT-RUN-IN-PRODUCTION/setup_real_data.sql:67+` (was `setup_real_data.sql:57+`, quarantined 2026-09-14) seeds a *different* set (`VH-001…`, real-looking VINs), and grep for `NX-1001` / `JTJGB7CX0P4100111` across `*.sql` returns only migration **comments** (`supabase/migrations/20260902102629…:70`) and dashboard code (`lib/unit-form.js:426`). **Origin unlocated → UNKNOWN, not proven-fake.** Requires an owner answer: *are these twelve cars on ALBA's actual lot?* |
| **C5** | 1 | `leads` id 121 "Preflight Walk-In" | **TEST** | **CERTAIN** | `email='walkin-preflight-01@nexus-preflight.invalid'` — RFC 2606 reserved TLD, cannot exist; `phone='+971500000001'`; `source='walk_in'`; `ops/pilot-readiness/BLOCKERS.md:759` — *"Lead 121 is a preflight run"*. |
| **C6** | 1 | `lead_event` `3d8cae04-9e69-4551-acd2-80ee2ec90b2f` | **TEST, ATTESTED REAL** | **CERTAIN — and this is the important one** | The database's **only** provenance record. It covers C5 (`lead_id=121`) and it says `environment='production'`, `origin_verified='operator_recorded'`, **`provenance_counts_as_real = true`**; `v_lead_origin.is_test_traffic` therefore renders **`false`** for the preflight probe. **The one attestation on file attests a test as real business**, because the preflight wrote its own attestation. Any provenance contract that lets the writing automation set its own `data_origin` reproduces this exactly. |
| **C7** | 1 | `customer_360_profiles` `2b00cc91-…` (Ali) | **DERIVED FROM TEST** | **HIGH** | A sync artefact of C1/lead 38, `last_synced_at 2026-09-08 22:00:19`. Also `d1f4c6b9-…` = the Preflight Walk-In (C5). 2 of 4 profile rows trace to test identities. |
| **C8** | 3 | `kyc_documents` | **TEST BURST** | **HIGH** | All three are `lead_email='shabbir53ujjainwala@gmail.com'` (the operator), same `chat_id 158510264357112@lid`, written `2026-09-02 07:25:27.8`, `:29.2`, `:32.9` — **three rows in 5.2 seconds**, all `document_type='NOT_A_DOCUMENT'`, all `verdict='REJECTED'`, all `void_reason='Not a KYC submission…'`. A person submitting real ID does not submit three non-documents in five seconds. The Compliance screen counts them as 3 KYC submissions. |
| **C9** | 9 of 22 | `competitors` where `match_quality is null` | **UNRATED, NOT FAKE** | **MEDIUM (as an evidence defect, not as fake data)** | `select source_kind, source_host, match_quality, count(*) … group by 1,2,3` → 9 rows with `match_quality`, `source_kind` and `source_host` all `null`, scraped `2026-08-28 19:01` → `2026-09-01 01:00`; the 13 later rows all carry `weak` or `model_only`. These are real scrapes from before the rating columns existed. They are **UNKNOWN provenance, not test data** — and they are the exact rows the "Above/Below their page price" conclusion is drawn from. |
| **—** | 2 | `leads` 34 (Siva Thangavelu), 35 (Effco Contracting llc) | **REAL, MISROUTED** | **CERTAIN they are real people** | Both `+971` numbers, both `DISQUALIFIED`, both carrying an operator note explaining they are wrong numbers (solar clamps; a web-design contact) auto-created by the WhatsApp→Router keyword trip. **Listed here to be explicitly cleared.** Deleting or marking these as test would destroy the evidence of a real classifier defect. |
| **—** | 1 | `leads` 122 (Hussain) | **REAL** | **CERTAIN** | `+971556382721`, free-text human message, 15 messages on file. Real inbound, real customer, whatever its sales value. |

**Nothing was found by the "round number / obviously fake name / `test` / `demo` /
`asdf` / `xxx`" sweep.** There are no `asdf` rows and no `Test User`. That is the point
worth stating plainly: **this contamination does not look like test data.** It is a real
name, a real email, a real vehicle at the real list price, written by the real
production workflow, 0.9 seconds before a `SUCCESS` audit line. A string-matching test
filter would catch none of it. Only an attested origin column can.

---

## 2. Why no screen can know

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema='public' and table_name='purchase_history'
order by ordinal_position;
```

```
id uuid NO gen_random_uuid()      | customer_name text YES  | email text YES
phone text YES                    | vehicle text YES        | purchase_date date YES
amount_aed integer YES            | created_at timestamptz YES now()
deal_id text YES                  | lead_id integer YES     | tenant_id uuid NO nexus_default_tenant_id()
```

Eleven columns. Not one of them says where the row came from. `leads` has none either.
The only base column in the whole database that carries this meaning is
`lead_event.provenance_counts_as_real`, and it covers **one** row — the preflight (C6).

So every screen reads the strongest word the schema offers — CONFIRMED — over a row
nobody can mark. The screens are not lying; they are reporting a column correctly. The
column is the defect.

---

## 3. The correlated inventory contradiction

`purchase_history` says a `Lexus LX 600 2024` sold for AED 585,000 on 2 Sep.
`inventory` says:

```sql
select id, model, status, price_aed, cost_aed, days_in_stock from inventory where id='NX-1011';
-- NX-1011 | Lexus LX 600 2024 | Available | 585000 | 530000 | 42
```

Same model, **same price to the dirham**, still `Available`. Only
`v_attribution_sale_chain.vehicle_note` notices, and it refuses correctly:
*"1 unit(s) share model words with the sale text… THE TEXT MATCHES AND PROVES
NOTHING — note the unit's status."* Inventory and Deals each render their own half
without either mentioning the other.

This is also why the test row's amount is exactly 585,000: it was copied off NX-1011's
list price by whoever ran the repair. It is corroborating evidence for C1, and it is
the reason gross margin on the "sale" is `NOT_COMPUTABLE` rather than 55,000.

---

## 4. Open questions only the owner can close

1. **C4 — are `NX-1001…NX-1012` ALBA's real cars?** Unlocated origin. If they are seed,
   every inventory, aging, holding-cost and margin figure on the dashboard is fixture
   data, and that is a larger blast radius than this one row.
2. **C6 — who is allowed to attest?** The single existing attestation was written by the
   thing being tested and says `counts_as_real = true`. If the provenance contract lets
   n8n set `data_origin`, C1 would have been written `REAL` on 2 September.
3. **C3 — should the seed RAG corpus be removed or re-attested?** It is the only Ask AI
   corpus that exists; removing it empties the feature, keeping it risks a quoted
   warranty term ALBA never agreed to.
