# BLAST-RADIUS — every screen and view that reports the repair test as fact

Read paths traced in `apps/executive-dashboard/`; view dependencies measured on
production `dsvuoovivysszdoiorch` with `pg_depend` + `pg_rewrite` (read-only).
"Reported value" is what the screen prints today, from a live query below.
"Corrected value" is what it prints once row `2f04d2c4-…` is excluded — quoted from
the screen's own `else` branch where the source has one.

---

## 1. The commit says six screens. It is **nine**.

`4bc9f8f` and `ops/frontend-audit/HONESTY-AUDIT.md:165-175` list **six bullet points**
across **five** screens (`customers` ×2, `deals`, `attribution`, `revenue`,
`lead-recovery`). Counting bullets is not counting screens, and four screens with the
same defect were left out. Independent count:

- **9 registered screens** print at least one figure that changes when the row is removed.
- **+2 more** (`campaigns`, `conversations`) print it through the shared lead drawer, which
  they import but whose body they do not own — listed separately, not padded into the nine.
- **`actions.js` is NOT affected**, despite reading a contaminated view — see §4. Getting
  this one wrong in the other direction would be the same failure.
- `system-truth.js` and `held-enquiries.js` reference `purchase_history` but **nothing
  imports them** (`grep -rn "system-truth\|held-enquiries" --include=*.js .` outside their
  own files → 0 hits). Not registered, not live, not counted.

All nine screens' literals are present in the checked-in deployed bundle
`dist/assets/main-CgKC2kaX.js` (built 2026-09-08 06:13) — verified by `grep -c -F`.
**Caveat, stated because the same commit raised it:** `4bc9f8f` reports the checked-in
`dist` is 103 bytes off what Vercel serves. I verified the repo bundle, **not** the bytes
at the origin. `deployed-in-repo` ≠ `served`.

---

## 2. Per screen

### 1. `screens/customers.js` — Customers

| | |
|---|---|
| Reads | `purchase_history` direct (`:554`, `:1276`), `v_customer_360` (`:550`), `v_customer_directory` |
| Metric | **"Recorded purchase value"** (`:894`) |
| Reported | **AED 585,000** — *"Summed over 1 recorded purchase from 1 customer"* |
| Corrected | **no value**; `purchaseValue` is `null` when no row carries an amount (`:771-775`) |
| Metric | **VIP pill** in the directory list (`:1179`) and in the customer drawer (`:1667`) |
| Reported | **VIP** on "Ali" — `v_customer_360.is_vip = true` |
| Corrected | **no pill**. `is_vip` is `true` only for Ali; the other three rows are `false` |
| Metric | **"Lifetime value"** (`:1680`) |
| Reported | **AED 585,000** |
| Corrected | **AED — / "No purchase amount recorded"** (`:1639`) |

```sql
select email, purchase_count, lifetime_value_aed, is_vip from v_customer_360 order by email;
-- +971547484167@whatsapp.lead | 0 | null   | false
-- +971556382721@whatsapp.lead | 0 | null   | false
-- shabbir53ujjainwala@gmail.com | 1 | 585000 | true      <= the repair test
-- walkin-preflight-01@nexus-preflight.invalid | 0 | null | false
```

**This is the one that loses the dealership.** A manager opens Customers and sees one
VIP with AED 585,000 of lifetime value. The VIP is the operator's own phone.

---

### 2. `screens/deals.js` — Deals

| | |
|---|---|
| Reads | `purchase_history` direct (`:282`, `:286`), `deals_embeddings` |
| Metric | **"Deals closed"** (`:903`) |
| Reported | **1** — *"Closed 7 days ago · the only dated row in the table"* |
| Corrected | **0** — *"Nothing recorded in the recorded sales yet"* (`:913`) |
| Metric | **"Revenue"** (`:919`) |
| Reported | **AED 585,000** |
| Corrected | **—** — *"Nothing recorded, so there is no revenue to total and no row to read a column from"* (`:921`) |

Deals is the screen a dealership shows an investor. It currently states the business
closed one deal worth AED 585,000. The business has closed zero deals.

---

### 3. `screens/attribution.js` — Attribution

| | |
|---|---|
| Reads | `v_attribution_sale_chain`, `v_attribution_lead_chain`, `v_attribution_link_map`, `v_attribution_edges`, `v_attribution_events` |
| Metric | **"Confirmed revenue on file"**, toned `t-won` (`:314`) |
| Reported | **AED 585,000** — *"Summed over 1 of 1 sale, with none excluded"* |
| Corrected | **"No sale on file"** (`:334`) |
| Metric | Lead-chain **Sale** column (`:664-666`) |
| Reported | lead 38 → `RESOLVED` · *"1 sale, AED 585,000 confirmed"* |
| Corrected | lead 38 → `NO_SALE_RECORDED`, like the other four |

```sql
select lead_id, sales_recorded, revenue_confirmed_aed, sale_state, hops_evidenced
from v_attribution_lead_chain order by lead_id;
-- 34 |0|0     |NO_SALE_RECORDED|1     121|0|0|NO_SALE_RECORDED|0
-- 35 |0|0     |NO_SALE_RECORDED|1     122|0|0|NO_SALE_RECORDED|1
-- 38 |1|585000|RESOLVED        |3   <= 585,000 and two of the three evidenced hops
```

---

### 4. `screens/revenue.js` — Revenue Recovery

| | |
|---|---|
| Reads | `v_lead_recovery`, `v_lead_recovery_coverage`, `v_attribution_sale_chain`, `v_deal_rescue*` |
| Metric | **"Confirmed revenue"**, toned `t-won` (`:924`) |
| Reported | **AED 585,000** — *"Summed over 1 of 1 sale on file, with none excluded"* |
| Corrected | **"Nothing confirmed"** (`:940`) |
| Metric | **"Sales attributed to a recovery action"** sub-line (`:647-653`) |
| Reported | **0** — *"1 confirmed sale is on file (AED 585,000), and none is linked to an action here"* |
| Corrected | **0** — *"0 confirmed sales are on file (AED —)…"*. The headline 0 is right for the wrong reason: it reads as *"we made a sale but our engine did not cause it"*, when the truth is *there is no sale.* |
| Metric | readiness table `measured_now` (`:786`) |
| Reported | VOLUME row: *"5 lead(s), **1 sale(s)**, 0 finance quote(s) visible to this caller"* |
| Corrected | *"5 lead(s), **0 sale(s)**, 0 finance quote(s)"* |

Note the near-miss the source already catches: `revenue.js:426-427` prints
*"THESE TWO VIEWS DISAGREE"* if `v_lead_recovery_coverage` and the sale chain differ.
They agree — on the same wrong row. A cross-check between two contaminated sources
passes.

---

### 5. `screens/lead-recovery.js` — Lead Recovery

| | |
|---|---|
| Reads | `v_lead_recovery`, `v_lead_recovery_coverage`, `v_lead_recovery_state_model`, `v_lead_recovery_queue` |
| Metric | **"Confirmed sales on file"**, toned `t-won` (`:248-255`) |
| Reported | **1** — *"AED 585,000 of confirmed revenue against this lead"* |
| Corrected | **0**, tone cleared |
| Metric | lead row confirmed line (`:494`) |
| Reported | lead 38 · state **RECOVERED** · *"Confirmed: AED 585,000"* |
| Corrected | lead 38 re-derives from messages (`ENGAGED` or `SILENT`); `confirmed_outcome_state → NO_SALE_RECORDED`. **DERIVED from the view definition, not separately measured** |

```sql
select lead_id, state, confirmed_outcome_state, confirmed_revenue_aed, confidence,
       recovery_attribution_state from v_lead_recovery where lead_id = 38;
-- 38 | RECOVERED | CONFIRMED_SALE | 585000 | HIGH | SALE_WITHOUT_RECOVERY_ACTION
```

`confidence = HIGH`. The product is highly confident about a repair test.

---

### 6. `screens/leads.js` — Leads *(missing from the commit's six)*

| | |
|---|---|
| Reads | `purchase_history?select=email` (`:869`) |
| Metric | **VIP pill** on the lead row (`:1084`) |
| Reported | **VIP** beside lead 38 "Ali" |
| Corrected | no pill on any lead |

The file's own header comment (`:159`) still says *"Empty on 1 Sep 2026 — nobody in
this…"*. It stopped being empty on 2 September and the comment was never revisited.

---

### 7. `screens/overview.js` — Overview *(missing from the commit's six)*

| | |
|---|---|
| Reads | `v_lead_recovery_coverage`, `v_deal_rescue`, `v_inventory_action_queue` |
| Metric | **"Sales linked to a recovery action"** sub-line (`:2265-2273`) |
| Reported | **0** — *"**1** confirmed sale is on file (**AED 585,000**), and none is linked to a recovery action. Confirmed is not attributed."* |
| Corrected | *"0 confirmed sales are on file (AED —)…"* |

Overview is the landing screen. The first number a dealership sees each morning
includes AED 585,000 that does not exist.

---

### 8. `screens/money-leaks.js` — Money Leaks *(missing from the commit's six)*

| | |
|---|---|
| Reads | `v_lead_recovery_coverage`, `v_lead_recovery`, `v_deal_rescue_readiness` |
| Metric | the **CONFIRMED** row of the word-ledger (`:1272`) |
| Reported | *"**1** recorded sale on file, and 0 of them attributed to anything NEXUS did"* |
| Corrected | *"No recorded sale is on file"* (`:1273`, the branch already written) |

The bitter one: this is the screen whose entire purpose is to police
`detected ≠ estimated ≠ attributed ≠ confirmed ≠ recovered`. Its CONFIRMED tier is
sourced from a test row. The vocabulary is enforced perfectly over data nobody checked.

---

### 9. `screens/deal-rescue.js` — Deal Rescue *(missing from the commit's six)*

| | |
|---|---|
| Reads | `v_deal_rescue_readiness`, `v_deal_rescue_candidates`, `v_deal_rescue`, `v_deal_rescue_state_model` |
| Metric | readiness `measured_now` / `evidence_today` (`:413`, `:439`) |
| Reported | VOLUME: *"5 lead(s), **1 sale(s)**, 0 finance quote(s) visible to this caller"* |
| Corrected | *"5 lead(s), **0 sale(s)**, 0 finance quote(s)"* |
| Metric | **"Prerequisites met"** (`:231`) |
| Reported | **1 of 9** |
| Corrected | **1 of 9 — UNCHANGED.** VOLUME is `met_now = false` either way; only its evidence string moves. Recorded so the fix is not credited with an improvement it does not make. |

---

### +2 through `lib/lead-drawer.js` — `campaigns.js`, `conversations.js`

`lib/lead-drawer.js:251` reads `purchase_history?email=eq.<lead email>`; `:314-319`
renders **"Purchase history · returning customer"** with *"Lexus LX 600 2024 · AED 585,000
· 2026-09-02"*. Imported by `campaigns.js:173`, `conversations.js:273`,
`customers.js:132`, `leads.js:119`, `overview.js:245`. On any of those five screens,
opening lead 38 labels the operator a **returning customer**. Corrected: the drawer's
`purchase.ok` branch returns `''` — *"read succeeded and there are none — silence is
honest"* (`:321`).

---

## 3. The views, measured

16 objects depend on `purchase_history` (transitive closure over `pg_depend`/`pg_rewrite`).
**11 are contaminated; 5 are clean.** Clean is not the same as unaffected — say which.

| View | Depth | Contaminated? | Reported → corrected |
|---|---|---|---|
| `v_attribution_sale_chain` | 1 | **YES** | 1 row, `revenue_aed 585000`, `revenue_kind CONFIRMED_REVENUE`, `hops_evidenced 4/8` → **0 rows** |
| `v_attribution_lead_chain` | 1 | **YES** | lead 38 `sales_recorded 1`, `revenue_confirmed_aed 585000`, `hops_evidenced 3` → `0`, `0`, `2` *(hops derived)* |
| `v_attribution_events` | 1 | **YES** | 148 events, incl. 1 `SALE_CONFIRMED` @ 585000 → **147**, no `SALE_CONFIRMED` |
| `v_attribution_edges` | 1 | **YES** | 148 → 147 |
| `v_attribution_link_map` | 2 | **YES** | `LEAD_TO_DEAL` 1/1 = 100.0 %, `DEAL_TO_DEAL_RECORD` 1/1 = 100.0 %, `DEAL_TO_REVENUE` 1/1 = 100.0 %, `DEAL_TO_VEHICLE` 0/1 = 0.0 %, `DEAL_TO_FINANCE` 0/1 = 0.0 % → **all five become 0 instances, `coverage_pct` null**. Three of the map's four 100 % coverages are one test row. |
| `v_customer_360` | 1 | **YES** | Ali: `purchase_count 1`, `lifetime_value_aed 585000`, `is_vip true` → `0`, `null`, `false` |
| `v_customer_directory` | 1 | **YES (minor)** | 4 rows; Ali `source_records 2`, `last_seen_at 2026-09-02 09:59:53` → `source_records 1`, `last_seen_at 2026-08-31 02:40:41`. Row count unchanged — the lead already puts him there |
| `v_lead_recovery` | 1 | **YES** | lead 38 `RECOVERED` / `CONFIRMED_SALE` / `585000` / `HIGH` → re-derives, `NO_SALE_RECORDED`, null *(state derived)* |
| `v_lead_recovery_coverage` | 2 | **YES** | `leads_with_a_confirmed_sale 1`, `confirmed_revenue_aed 585000` → `0`, `0`/null |
| `v_lead_recovery_state_model` | 2 | **YES** | `RECOVERED`: `leads_in_state_now 1`, `observation OBSERVED` → `0`, `REACHABLE_NOT_OBSERVED` |
| `v_deal_rescue_candidates` | 1 | **YES** | 10 rows incl. `CONFIRMED_SALE` / `purchase_history` / `deal_value_aed 585000` → **9 rows**, no CONFIRMED_SALE |
| `v_deal_rescue_readiness` | 1 | **YES (text only)** | VOLUME `measured_now` = *"5 lead(s), 1 sale(s)…"* → *"0 sale(s)"*. `met_now` false either way |
| `v_inventory_action_queue` | 1 | **NO** | Joins `purchase_history` **only** on `a.outcome_purchase_id`. `select count(*) from inventory_actions where outcome_purchase_id is not null` → **0**. Every `outcome_sale_*` column is null. `actions.js:371` renders nothing |
| `v_lead_recovery_queue` | 1 | **NO** | **0 rows** |
| `v_deal_rescue` | 2 | **NO** | **0 rows** |
| `v_deal_rescue_state_model` | 3 | **NO** | 7 rows, all schema-shape statements, no per-row counts from the sale |

---

## 4. Reported vs real revenue, in one line

| | Reported by NEXUS today | Real |
|---|---|---|
| Confirmed revenue | **AED 585,000** | **AED 0** |
| Deals closed | **1** | **0** |
| Customers who have bought | **1** (VIP) | **0** |
| Gross margin on that revenue | `NOT_COMPUTABLE` | correctly not computable — and it is the only figure on the dashboard that is already honest about this sale, because `purchase_history` carries no unit link |

`v_attribution_sale_chain` for this row: `hops_total 8`, `hops_evidenced 4`,
`first_break CAMPAIGN`. **Four hops of the eight-hop chain were evidenced against a
repair test.** The attribution engine is working; it is attributing a probe.
