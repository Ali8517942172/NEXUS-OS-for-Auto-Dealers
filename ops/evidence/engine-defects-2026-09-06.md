# Three engine defects a demo dataset exposed — closed 6 September 2026

Measured on **production `dsvuoovivysszdoiorch`** read-only first, fixed on
**staging `wwspuxrbiyagnrnzgate`**, proved there adversarially with positive
controls, then applied to production and re-proved there. Every probe ran inside
a transaction ending in an unconditional `RAISE EXCEPTION`; every rollback was
confirmed by re-reading afterwards.

`recompute_inventory_derived()` was **never called against production**, not even
in a rolled-back transaction. No `git` command was run. The n8n box
(`35.224.126.225`) was not touched. `QUALITY_GATE.mjs` was **read and run, never
edited**. Alpha, Bravo and the NORTHWIND MOTORS demo tenant on staging are byte
for byte where they started.

## Migrations applied — both projects, byte-identical

| version | name | md5 of the recorded statement |
|---|---|---|
| `20260906065739` | `inventory_derived_figures_refuse_to_invent_a_missing_input` | `f626d8a8ee0a52c55c2c971f5503d54b` |
| `20260906070115` | `needs_attention_inventory_aging_says_why_when_the_holding_cost_is_absent` | `bd0c79653fc3258b9b1571b70293497f` |
| `20260906070947` | `deal_rescue_platform_vocabulary_stops_carrying_one_dealerships_counts` | `a0027ead1cfe753d93393c58bf3370b2` |
| `20260906071310` | `restore_inventory_write_grants_the_acl_guard_stripped_on_alter` | `9c6c69657741e8aa948e9a0dfa939c45` |

Each is in `supabase/migrations/<version>_<name>.sql`, no trailing newline, and
`md5sum` of the file equals `md5(statements[1])` read back from **production**.
Staging recorded the same md5 for all four, so the two projects received
identical text.

---

# D1 — a margin for a car whose cost nobody entered

## What was measured, before anything was changed

The function's own body, read live from production:

```sql
coalesce(inv.price_aed, 0) - coalesce(inv.cost_aed, 0) as gross_margin
```

and, one line up, `coalesce(inv.price_aed, 0)` feeding
`round(b.price * 0.05) as vat_amount` — the same fabrication on VAT, unreported
until now: a car nobody had priced would have been stored with **AED 0 of VAT**,
which reads as a fact rather than as an absence.

**Proved by execution on staging, rolled back** (three active dealerships,
one call as `postgres`):

```
rows touched by ONE unscoped call                          = 33
DEMO-2130 (price 235,000, cost NULL) gross_margin  null  -> 235000
Alpha+Bravo BEFORE : ALPHA-001 gm=null dis=null | ALPHA-002 gm=null dis=null
                     BRAVO-001 gm=null dis=null | GATE-PROBE… gm=null dis=null
Alpha+Bravo AFTER  : ALPHA-001 gm=5000 dis=203  | ALPHA-002 gm=10000 dis=41
                     BRAVO-001 gm=5000 dis=203  | GATE-PROBE… gm=5000 dis=400
```

Both reported defects confirmed in one measurement: the **fabricated figure**
(the whole asking price of a GMC Yukon stored in a column named margin, where
`v_inventory_profit_sentinel` correctly returns NULL and says why), and the
**absence of tenant scope** — one call by a caller that named no dealership wrote
33 rows belonging to three of them.

## Who calls it, how often

- `n8n-workflows/inventory_ageing_recompute.json` — schedule trigger
  `15 0 * * *` Asia/Dubai, `active: true`, `published: true`, calling
  `POST /rest/v1/rpc/recompute_inventory_derived` with a `supabaseApi`
  credential, i.e. as **`service_role`**. That is the only caller; nothing in
  `apps/executive-dashboard` calls it, and `pg_cron` holds no job for it.
- Production `audit_log`: **23 SUCCESS rows**, first `2026-08-14 20:15:01Z`,
  last `2026-09-05 20:15:03Z`, latest summary *"Recomputed days in stock,
  holding cost, net margin and aging alert for 12 units."* So it has run nightly
  and written all 12 rows each time.

## Has it already written a fabricated margin to production? — stated plainly

**No fabricated margin exists in production today, and none can be shown ever to
have existed.** Those are two different statements and both belong here.

Every one of the 12 units was checked, not a sample:

| units | with a price | with a cost | `gross_margin <> price − cost` | `gross_margin_state` after the fix |
|---|---|---|---|---|
| 12 | 12 | 12 | **0** | `COMPUTED` on all 12 |

No production unit is missing an input, so the `coalesce` never had anything to
invent, and every stored `gross_margin` equals `price_aed − cost_aed` exactly.

**What is NOT_COMPUTABLE, and is not "no":** `pg_stat_all_tables` records **64
inserts and 143 deletes** on `public.inventory` against 12 live rows, so roughly
fifty units have come and gone across the 23 nightly runs. `inventory` keeps no
history of `cost_aed` and there is no audit of cost changes, so whether any of
those rows ever held a NULL cost across a nightly run **cannot be established
from this database in either direction**. A missing row is not proof the event
did not happen. What can be said is that no fabricated margin is on file now,
and that after this change none can be written.

**The defect was live and reachable, not theoretical.** `cost_aed` and
`price_aed` are both nullable on `inventory`, and the demo tenant's DEMO-2130
exists precisely because a writer left cost NULL.

## What changed

1. **A CHECK constraint, `inventory_derived_figures_require_their_inputs`** —
   the important half, because it binds every writer rather than one function,
   and `service_role` does not bypass a CHECK, so it binds n8n:

   ```sql
   check (
         (gross_margin           is null or (price_aed is not null and cost_aed is not null))
     and (net_margin             is null or (price_aed is not null and cost_aed is not null))
     and (recommended_commission is null or (price_aed is not null and cost_aed is not null))
     and (vat_amount             is null or  price_aed is not null)
   )
   ```

2. **`inventory.gross_margin_state`**, `GENERATED ALWAYS … STORED` and therefore
   unwritable by anybody — `COMPUTED`, `NOT_COMPUTABLE_NO_COST`,
   `NOT_COMPUTABLE_NO_PRICE`, `NOT_COMPUTABLE_NO_PRICE_NO_COST`. NULL is the
   value; this says which input is missing. Because it is generated it cannot
   drift from the two columns it describes, so it is not a second derivation to
   keep in step.

3. **The function.** `gross_margin` is now character for character the
   expression `v_inventory_profit_sentinel` uses; `vat_amount` is NULL when
   there is no price; and the backend path **enumerates**
   `public.nexus_active_dealership_ids()` instead of issuing an unscoped
   `UPDATE`. The signed-in path is unchanged in intent — the caller's own
   dealership, `0` for an account that belongs to none.

   Enumeration rather than a scope argument, deliberately: the nightly job
   legitimately recomputes every dealership, and adding a parameter would have
   meant dropping and recreating the function, which re-opens the ACL question
   this file exists to avoid. What enumeration buys is real and measured below:
   quarantined rows are no longer written, and a suspended dealership drops out.

## Proofs — staging, each rolled back

```
backend sweep, 3 active dealerships, touched = 34
DEMO-2130  price 235000 cost NULL -> gross_margin=NULL state=NOT_COMPUTABLE_NO_COST vat=11750 net=NULL
DEMO-2101  price 279000 cost 268000 -> gross_margin=11000 state=COMPUTED vat=13950      <- positive control
quarantine tenant row after a backend sweep: gross_margin = NOT TOUCHED - still null
after suspending staging-bravo (1 unit), touched = 33                                   <- enumeration, not a sweep
```

```
as postgres,     write 235000 onto DEMO-2130 : REFUSED 23514
as service_role, same write                  : REFUSED 23514
as postgres,     write 12345 onto DEMO-2101  : ACCEPTED   <- the guard is not refusing everything
write gross_margin_state directly            : REFUSED 428C9 column can only be updated to DEFAULT
```

```
signed-in, member of no dealership   -> touched 0
signed-in as the demo owner          -> touched 29 (the demo holds 29; the database holds 34)
rows outside the demo tenant carrying a gross_margin after that call: 0
```

Re-read after rollback: DEMO-2130 `gross_margin` NULL, Alpha/Bravo all NULL,
`PROBE-QUARANTINE` gone.

## Proofs — production, rolled back, without calling the function

```
production inventory: 12 units, gross_margin_state distinct = COMPUTED
stored gross_margin <> price - cost on: 0 units
planted a unit priced 235,000 with no cost -> gross_margin_state = NOT_COMPUTABLE_NO_COST
writing 235000 as its margin               : REFUSED 23514
same write as service_role (n8n's role)    : REFUSED 23514
writing a margin on NX-1001 (has both)     : ACCEPTED (control)
```

`md5(prosrc)` of `recompute_inventory_derived()` is `c7c57eb9a4be0d93fba652db0309bc02`
on **both** projects; `proacl` unchanged (`postgres`, `service_role`,
`authenticated` EXECUTE — `CREATE OR REPLACE` preserves the ACL). 12 units
before and after; the probe row did not persist.

## The same defect, in the browser — fixed, because that is the copy a dealership reads

`apps/executive-dashboard/lib/unit-form.js` `deriveUnit()` carried the identical
`coalesce`:

```js
const price = n0(u.price_aed) || 0;
const cost  = n0(u.cost_aed)  || 0;
…
const gross = price - cost;
vat_amount: Math.round(price * INV.VAT_RATE),
```

Every consumer spreads `...u` and then overwrites, so this **replaces whatever
the database returned**: a NULL-cost unit would still have printed AED 235,000 of
gross margin in the unit drawer after the database was fixed. Now both inputs
are read raw, `gross_margin` is null with `gross_margin_state` and
`gross_margin_note` beside it, `vat_amount` is null with no price, and the drawer
renders *Not computable* with the reason instead of an em dash.

`node --check` passes on all three edited files; `npm run build` succeeds
(`dist/assets/main-BGNobduB.js`).

---

# D2 — one dealership's numbers on another dealership's screen

## What the table is — decided before any SQL was written

The nine prerequisites are the **PRODUCT'S**, not a dealership's: a deal record,
a stage history, an appointments integration, a lender decision, a deal-to-unit
link, a running detector, an owner, an action lane, volume. Every dealership
needs all nine before Deal Rescue can rank anything, and none of them belongs to
a dealership. So `deal_rescue_prerequisites` is **right** to have no `tenant_id`,
and `id / sort / requirement / kind / unlocks / unlocks_states / why_not_code`
are platform vocabulary.

`evidence_today` was the odd one out and it was doing two jobs. Some of it is a
platform fact (*"No appointment table, no column, no event type"*). The rest is
ALBA CARS' measurement, frozen on 3 September: *"purchase_history holds 1 row"*,
*"all 12 units"*, *"leads = 3 (2 of them quarantined wrong-number junk)"*,
*"0 live rows (18 inserts, 15 deletes)"*, *"Last successful run 26 Aug 2026
19:03 UTC"*. Onboard a second dealership and their screen prints those as theirs.

This is the `policy_rule` jurisdiction lesson one layer down — the rule is the
platform's, the measurement is the dealership's, and they may not share a column.

**And the measurement already had a tenant-scoped home.**
`v_deal_rescue_readiness` computes `met_now` and `measured_now` on every read,
through the caller's own RLS ("visible to this caller"). So the stored prose was
also a **second derivation of a figure the view already derives live**, and a
stale one. No new table was needed: the platform table stops carrying the
measurement, and the live one carries it per dealership, as it already did.

## It is wider than reported — three more columns, two more tables

Found by looking for the shape rather than for the column. All are platform
tables with no `tenant_id`, all readable by every signed-in dealership user, all
rendered on the Deal Rescue screen:

| column | row | what it stored |
|---|---|---|
| `deal_rescue_prerequisites.evidence_today` | 9 rows | ALBA's leads, sales, units, quotes, detector time |
| `deal_rescue_prerequisites.unlocks` | `VOLUME` | *"Thresholds picked against 3 leads and 1 sale are guesses."* |
| `deal_rescue_states.requires` | `FINANCE_BLOCKED` | *"…and the table holds 0 live rows."* |
| `deal_rescue_states.requires` | `CUSTOMER_GHOSTED` | *"the 12-Hour Silence Detector last succeeded 26 Aug 2026 19:03 UTC and is stale"* |
| `deal_rescue_evidence_sources.verdict_basis` | `FINANCE_QUOTE` | *"It holds 0 live rows today (18 inserts, 15 deletes…)"* |
| `deal_rescue_evidence_sources.verdict_basis` | `KYC_DOCUMENT_VALID` | *"All 3 rows on file today are NOT_A_DOCUMENT, REJECTED and voided."* |
| `deal_rescue_evidence_sources.verdict_basis` | `APPROVED_UNEXECUTED_INVENTORY_ACTION` | **"1 such row exists today (NX-1010, REPRICE, approved 02 Sep 2026, never executed)"** |

The last is the sharpest: a second dealership's screen would have printed ALBA's
**stock number** and the date somebody approved an action on it.

## What changed

- `evidence_today` **renamed to `platform_evidence`**, and all nine values
  rewritten to carry platform facts only. Every restated claim was re-measured
  against the live catalogue on 6 Sep: no `deals` table, no `appointments`
  table, no `deal_rescue_actions` table, **0** columns named `stage` in schema
  `public`, `finance_quotes` **35 columns / 0 decision-shaped**,
  `purchase_history` **0** unit-link columns, `leads.assigned_to_id` present.
  No number in the new text is a dealership's.
- The six other leaking values rewritten the same way. Nothing was invented to
  replace a deleted count: each says the measurement is taken live instead.
- **A CHECK on all four tables** — `deal_rescue_prerequisites`,
  `deal_rescue_states`, `deal_rescue_evidence_sources`, and
  `lead_recovery_states` (same shape, clean today, floor laid while nobody is
  standing on it) — refusing a counted quantity of dealership things:

  ```
  \m[0-9][0-9,]*( +[a-z()'./-]+){0,2} +(leads?|rows?|units?|sales?|deals?|customers?
   |messages?|quotes?|enquir(y|ies)|inserts?|deletes?|appointments?|conversations?
   |vehicles?|cars?)\M
  ```

  **What it cannot catch, stated rather than left to be discovered:** it does
  **not** catch a count written noun-first (*"leads = 3"*) and it does **not**
  catch a bare date (*"last succeeded 26 Aug 2026 19:03 UTC"*). Both of those
  were live in this data and both had to be removed by hand. The constraint is a
  floor, not a proof, and the migration and the constraint comment both say so.

- **`v_deal_rescue_readiness` rebuilt** (`CREATE OR REPLACE` cannot rename an
  output column) with `security_invoker = true`, `revoke all … from anon, public`
  and an explicit `grant select … to authenticated, service_role`. Measured
  after: `authenticated=r`, nothing for `anon`.

  It keeps a column named `evidence_today` as a **deprecated compatibility
  alias** for `measured_now` — the same expression, computed once in the
  subquery and projected twice. The deployed dashboard bundle still selects that
  name and a 400 would have broken the Deal Rescue screen the moment the
  migration landed. A screen that has not been rebuilt now shows **that
  dealership's own live measurement** where it used to show ALBA's frozen one.
  Drop the alias once the dashboard is redeployed.

## Proofs

Staging (the three tables are empty there — see "staging is not a faithful
rehearsal" below), each insert rolled back:

```
insert "purchase_history holds 1 row"        : REFUSED 23514
insert "all 12 units"                        : REFUSED 23514
insert "3 leads and 1 sale" into unlocks     : REFUSED 23514
insert "1 such row exists (NX-1010...)"      : REFUSED 23514
insert real platform vocabulary              : ACCEPTED   <- not refusing everything
```

Production, rolled back:

```
restore "purchase_history holds 1 row"   : REFUSED 23514
restore "1 such row (NX-1010...)"        : REFUSED 23514
append a real platform sentence          : ACCEPTED (control)

as a signed-in dealership user, the view returns 9 rows; VOLUME reads:
  platform_evidence : Nothing here is a schema fact. Every threshold in this engine was chosen before any dealership was using it at…
  measured_now      : 3 lead(s), 1 sale(s), 0 finance quote(s) visible to this caller
  evidence_today    : 3 lead(s), 1 sale(s), 0 finance quote(s) visible to this caller
alias equals measured_now on all 9 rows: 9 of 9
```

Production after the change, outside any transaction:

```
rows still matching the guard : 0 prereq rows, 0 state rows, 0 evidence-source rows
residual ALBA specifics (NX-…, 26 Aug 2026, 02 Sep 2026, "leads = ", …) : (none)
```

Row counts unchanged: 9 prerequisites, 7 states, 9 evidence sources, 9 view rows.

## Dashboard

- `screens/deal-rescue.js` — selects `platform_evidence`, and the evidence table
  now has **two rows instead of one**: *"What is true of NEXUS, for every
  dealership"* and *"What is true of this dealership, measured on this read"*.
  The empty case for the second reads *"Not measured. That is not the same as
  met."*
- `screens/money-leaks.js` — `evidence_today` dropped from the projection;
  nothing on that screen ever read it.
- `screens/revenue.js` — untouched; it already selected `met_now`/`measured_now`
  only.

---

# D3 — an alert that said nothing

## What was measured

```sql
((i.days_in_stock || ' days in stock · AED ' ||
  to_char(i.holding_cost_accrued,'FM999,999')) || ' holding cost')
```

`holding_cost_accrued` is NULL for any dealership with no daily floor-plan rate
on record, and anything concatenated with NULL is NULL, so the whole sentence
vanished.

**Harm was already occurring in production, and this is the one that reaches
today's dealership.** On production: `inventory_profit_settings` holds one row
with `holding_cost_per_day_aed = NULL`; `v_needs_attention` returns
**1 of 1 `inventory_aging` alerts with `detail = NULL`** (NX-1010, 153 days,
CRITICAL), and it is the **only** NULL detail in the entire view. On staging the
demo tenant shows 5 of 5. Every dealership sees this on day one.

## What changed

The branch now reads the dealership's own `inventory_profit_settings` row
(`LEFT JOIN … ON s.tenant_id = i.tenant_id`) and says which half is missing:

- `'AED 12,345 holding cost'` when it is on record;
- `'holding cost NOT COMPUTABLE — this dealership has not recorded what a day of floor costs'`;
- `'holding cost NOT COMPUTABLE — a daily rate is on record but no accrued figure has been computed for this unit'`;
- and the day count itself degrades to `'Days in stock not on record'` rather than
  taking the whole sentence with it.

`security_invoker = true` re-asserted explicitly in the `CREATE OR REPLACE`.

## Proofs

Staging, all four arms fired in one rolled-back transaction:

```
DEMO-2101  ->  214 days in stock · AED 12,345 holding cost
DEMO-2104  ->  187 days in stock · holding cost NOT COMPUTABLE — a daily rate is on record but no accrued figure has been computed for this unit
DEMO-2107  ->  Days in stock not on record · holding cost NOT COMPUTABLE — a daily rate is on record …
DEMO-2130  ->  132 days in stock · holding cost NOT COMPUTABLE — a daily rate is on record …
```

with the live (no-rate) state giving *"214 days in stock · holding cost NOT
COMPUTABLE — this dealership has not recorded what a day of floor costs"* on all
five.

**Nothing else in the view moved.** A fingerprint of every non-`inventory_aging`
row (kind, severity, ref, title, detail, screen) was taken before and after on
both projects and compared: **identical** — 17 rows on staging, 9 on production.

Production after the change:

```
NX-1010 :: 153 days in stock · holding cost NOT COMPUTABLE — this dealership has not recorded what a day of floor costs
NULL details left in the whole view : 0
reloptions {security_invoker=true} ; relacl authenticated=r
```

---

# A regression this pass caused, and repaired — disclosed, not buried

`ALTER TABLE public.inventory …` in migration `20260906065739` fired the event
trigger `nexus_guard_born_open_grants()`, which runs on `ddl_command_end` for
**any** table DDL — not only `CREATE` — and unconditionally executes

```sql
revoke insert, update, delete, truncate on <table> from authenticated
```

It stripped the two deliberate dashboard write paths on both projects:
`inventory` went from `authenticated=rd` with nine column ACLs to
`authenticated=r` with none. `lib/unit-form.js` would have returned **42501** on
save. Caught by running CLAUDE.md's own write-side ACL query after the change,
which is the only reason it was caught at all.

Migration `20260906071310` restores exactly the prior grants — table-level
`DELETE`, `INSERT` on nine columns, `UPDATE` on eight — and **self-checks**,
raising rather than reporting success if the grants did not stick or if anything
reached `anon`. Verified after: the ACL query returns exactly the four rows
CLAUDE.md documents, **identically on both projects**, and nothing else:

| object | grantee | verb | table level | column level |
|---|---|---|---|---|
| `inventory` | `authenticated` | DELETE | true | n/a |
| `inventory` | `authenticated` | INSERT | false | true (9 cols) |
| `inventory` | `authenticated` | UPDATE | false | true (8 cols) |
| `leads` | `authenticated` | UPDATE | false | true (8 cols) |

And proved by execution rather than by ACL, on production, rolled back, as a
real signed-in dealership owner with a JWT claim:

```
unit-form INSERT as a signed-in dealership owner : ACCEPTED
unit-form UPDATE                                : ACCEPTED
the probe row's gross_margin_state              : COMPUTED
unit-form DELETE                                : ACCEPTED
```

**The guard itself was NOT changed.** Narrowing it to `CREATE` would weaken a
control that exists because objects in this schema are born open, and that is
not a trade to make in passing. But the interaction is a live hazard and belongs
in the record: **since the guard was installed on 4 Sep 2026, every future
`ALTER TABLE` against `public.inventory` or `public.leads` silently deletes the
dashboard's write grants, with no grant-shaped diff to review.** Anyone altering
either table must re-read the ACL afterwards and re-apply
`20260906071310`.

---

# What was found and deliberately NOT changed

- **`lib/unit-form.js:unitRow()` sends a cost of zero, not a missing cost.**
  `price_aed: n0(u.price_aed) || 0` and `cost_aed: n0(u.cost_aed) || 0` — clearing
  the cost field in the unit form writes **AED 0**, which is a claim about the
  car, not an absence, and is the same "unknown rendered as a fact" this project
  keeps paying for. Not changed here: it alters write semantics on a live screen
  and interacts with the `inventory_guard_cost_change` trigger and the
  `inventory_set_cost` RPC, so it deserves its own pass with its own proof. It
  also means the *form* cannot currently produce a NULL cost — D1's reachable
  writers are n8n and direct SQL, and `cost_aed` remains nullable.
- **The `nexus_guard_born_open_grants()` interaction above.** Repaired, not
  redesigned; see the reasoning there.
- **`QUALITY_GATE.mjs`** — read and run, never edited, per instruction. See the
  gate section below: two of its checks now report red for a reason that is not
  a defect, and the fix is the owner's to make.
- **Staging is still not a faithful rehearsal for D2.**
  `deal_rescue_prerequisites`, `deal_rescue_states`,
  `deal_rescue_evidence_sources` and `lead_recovery_states` hold **zero rows on
  staging** and 9 / 7 / 9 / 8 on production, so the staging run exercised the
  DDL, the constraints and the view rebuild but could not exercise the data
  change. That was proved on production instead, in a rolled-back transaction,
  and is stated rather than glossed. Seeding those tables on staging was
  deliberately left alone — copying production's rows is exactly what the demo
  evidence refused to do, and now that the prose is platform-only it would be
  safe, but it is a separate decision with its own blast radius.
- **`architecture/schema.sql`** was not regenerated. It is a transcription that
  goes stale within days and nothing in this pass depends on it.

---

# QUALITY_GATE state — measured, and the red is not a defect

Run after the change: **PASS 15, FAIL 2, WARN 2, NOT RUN 17**, failing

```
R2  dealrescue: chars=11252 errState=true stuck=false newErrors=2
R3  400 42703 column v_deal_rescue_readiness.platform_evidence does not exist
S3  (WARN) Every query names a relation and columns that exist
```

That lane is `OFFLINE · rendered`: it validates the screens' `select` strings
against a **column map embedded in `QUALITY_GATE.mjs`**, anchored to migration
`20260906062139` — four migrations before mine. The column exists:
`information_schema.columns` lists it on the view, and a signed-in dealership
session read it in the proof above; PostgREST's schema cache was reloaded with
`notify pgrst, 'reload schema'`.

**Measured rather than argued.** With the pre-rename select strings temporarily
restored and nothing else altered, the same gate returns **PASS 18, FAIL 0,
WARN 1**. Restoring them and re-running returns the failures. So the two
failures and the extra warning are entirely the stale snapshot meeting an
intended schema change — the exact symptom the gate's own comments describe.

**The fix is not mine to make:** refreshing needs `--refresh-schema`, which
rewrites `QUALITY_GATE.mjs` in place, or a live catalogue / `NEXUS_DB_URL` /
service-role credential, none of which is available here. **Whoever owns
`QUALITY_GATE.mjs` must re-run `--refresh-schema` against production at or after
migration `20260906071310`.** Until then R2, R3 and S3 are reporting the
snapshot's age, not the product's health.

`get_advisors(security)` on production after the change: no ERROR-level lints;
the WARNs are the pre-existing set (`vector` and `pg_trgm` in `public`, and the
`SECURITY DEFINER`-callable-by-`authenticated` list, which
`recompute_inventory_derived` was already on — its ACL is unchanged).

---

# Closing state

| | production | staging |
|---|---|---|
| `inventory` rows | 12, all `gross_margin_state = COMPUTED` | 34 across 3 dealerships; DEMO-2130 `NOT_COMPUTABLE_NO_COST` |
| `v_needs_attention` NULL details | **0** | **0** |
| `v_deal_rescue_readiness` | 9 rows, `platform_evidence` + live `measured_now` | 9 columns present, 0 rows (tables empty on staging) |
| dealership write path | INSERT / UPDATE / DELETE all ACCEPTED as a real signed-in owner | — |
| views without `security_invoker` | 0 | 0 |
| write-side ACL query | 4 rows, the four documented ones | the same 4 |
| demo / Alpha / Bravo data | — | unchanged: 29 / 24 / 37 / 5 / 10, 4, 1 |

Nothing in this pass created a row to satisfy a check, replaced a refused figure
with a different one, or weakened an existing constraint, policy or severity.
