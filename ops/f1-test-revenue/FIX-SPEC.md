# FIX-SPEC — how the nine screens stop reporting a repair test as revenue

**Unapplied.** Nothing in this file was run against production. No DDL, no DML, no
migration written. This specifies the fix and the decisions the owner has to make; the
universal provenance contract itself belongs to `ops/data-provenance/`, which adopts
`data_origin` and `test_run_id` (`ops/data-provenance/MEASUREMENTS.md` §1). This file
specifies only what **consumes** that contract for `purchase_history`.

Governing rule, verbatim: **"default = UNKNOWN/REAL only when explicitly attested,
never 'everything real unless marked test'."**
Governing display rule, verbatim: **"NEXUS should never hide uncertainty. It should
operationalize uncertainty."**

**Do not delete or UPDATE row `2f04d2c4-4cd2-424c-aa34-6cc2a0c20b86`.** It is the only
evidence that this happened, and its `created_at` pins it 0.91 s before the
`SUCCESS` audit line that proves what wrote it. The fix labels the row. It does not
remove it.

---

## 0. The `ALTER TABLE` constraint — and a measured correction

The task states the owner refused a blind `ALTER TABLE` on `purchase_history` because
`nexus_guard_born_open_grants()` strips live dashboard write grants on `ALTER TABLE`.
**The refusal was right; the stated reason does not apply to this table.** Measured:

The guard's body, `supabase/migrations/20260904142709_…:60-62`:

```sql
if r.object_type in ('table','view','materialized view','foreign table') then
  execute format('revoke all on %s from anon', r.object_identity);
  execute format('revoke insert, update, delete, truncate on %s from authenticated', r.object_identity);
```

It revokes **INSERT/UPDATE/DELETE/TRUNCATE from `authenticated`, and ALL from `anon`.**
It does **not** touch SELECT for `authenticated`. What `purchase_history` actually grants:

```sql
select grantee, privilege_type from information_schema.table_privileges
where table_schema='public' and table_name='purchase_history';
-- authenticated | SELECT          <= the only authenticated grant
-- postgres, service_role | SELECT INSERT UPDATE DELETE TRIGGER TRUNCATE REFERENCES
select count(*) from information_schema.column_privileges
where table_name='purchase_history' and grantee='authenticated' and privilege_type<>'SELECT';
-- 0
```

`authenticated` holds **no write grant on `purchase_history` to strip.** The dashboard
never writes it — every row comes from n8n as `service_role`, and the guard does not
touch `service_role`. `anon` holds nothing and is denied by RLS anyway
(`purchase_history_deny_anon`, `qual = false`).

So **`ALTER TABLE public.purchase_history ADD COLUMN … ` is grant-safe on this table**,
and `authenticated` holds **table-level** SELECT — so a newly added column is readable
without a new grant. The tables where the guard genuinely bites are `inventory` (6 column
write grants → 0), `leads` (owner assignment) and `lead_event` (Lead Sources) —
`4bc9f8f` measured that on a throwaway 17.11 cluster.

**What the spec still owes the refusal.** The risk is real one step later, and the
migration must handle it:

1. Exposing `data_origin` through the 11 dependent views needs `create or replace view`
   per view. Where the column list changes shape, `create or replace` is rejected and the
   view must be dropped and recreated — **which loses its grants**. All four views spot-
   checked (`v_lead_recovery`, `v_customer_360`, `v_attribution_sale_chain`,
   `v_lead_recovery_coverage`) hold exactly one authenticated grant: table-level SELECT.
   The migration must re-`grant select` on every recreated view, and its preflight must
   assert grant parity before and after.
2. The guard fires again on each view create and revokes writes from `authenticated` —
   which views do not have. No-op. Verified against the guard body, not assumed.
3. `v_deal_rescue_readiness`, `v_deal_rescue_candidates`, `v_lead_recovery*` and the five
   attribution views are `security_invoker` (41 of 42 views carry `security_invoker=true`;
   `v_competitor_latest` carries the equivalent `security_invoker=on`). A view read is a
   base-table read for grants — so the new column needs the base grant to exist, which
   table-level SELECT already supplies.

**Preflight the migration must run and fail on, before any DDL:**

```sql
-- must return 0 rows both before and after
select grantee, privilege_type from information_schema.table_privileges
where table_schema='public' and table_name='purchase_history' and grantee='authenticated'
except select 'authenticated','SELECT';
```

---

## Layer (a) — how the views filter, once provenance exists

### The consequence the owner must accept before anything is written

Default is **UNKNOWN**. Today `purchase_history` holds one row and nobody has attested
it. Therefore, on the morning the column ships:

> `where data_origin = 'REAL'` returns **zero rows**, and Confirmed revenue on all nine
> screens reads **AED 0 / nothing on file**.

That is the honest number — ALBA has sold nothing through NEXUS. It is also a dashboard
that has gone from "AED 585,000" to "nothing" overnight, and **the owner must choose that
knowingly rather than discover it.** Ship it behind a one-line decision, not a migration
footnote.

### Three postures. One is recommended; the other two are named so the choice is a choice.

**A1 — `REAL` only (silent exclusion). REJECTED.**
`where data_origin = 'REAL'`. Confirmed revenue = AED 0. Nine screens go quiet and no
screen says *why*. A reader cannot tell "we have sold nothing" from "one sale exists and
we are not counting it". This is the failure mode the owner's display rule names: silently
excluding is as wrong as silently including.

**A2 — three-way split, carried in the view. RECOMMENDED.**
Views stop emitting one revenue figure and emit three, plus the counts behind them. Nothing
is filtered out of existence; every row is classified and every class is reachable.

```sql
-- shape only. Not a migration.
select
  sum(amount_aed) filter (where data_origin = 'REAL')    as revenue_attested_real_aed,
  count(*)        filter (where data_origin = 'REAL')    as sales_attested_real,
  sum(amount_aed) filter (where data_origin = 'UNKNOWN') as revenue_unattested_aed,
  count(*)        filter (where data_origin = 'UNKNOWN') as sales_unattested,
  count(*)        filter (where data_origin = 'TEST')    as sales_marked_test,
  sum(amount_aed) filter (where data_origin = 'TEST')    as amount_marked_test_aed
from purchase_history where <existing tenant + quarantine predicates>;
```

Rules the views must hold to, in the vocabulary this codebase already enforces:

- `revenue_confirmed_aed` / `confirmed_revenue_aed` — **only `REAL`.** The word CONFIRMED
  is the strongest in the vocabulary and it may not stand over an unattested row.
- `TEST` rows are **excluded from every money and count metric** and **carried in a
  separate counter**, so a screen can say *"1 row on file is marked test"* rather than
  losing it.
- `UNKNOWN` rows are excluded from CONFIRMED **and** counted and summed in their own
  columns. `UNKNOWN ≠ ZERO`, and a view that returns only the `REAL` sum has thrown away
  the distinction the whole product is built on.
- Every state carries a `*_basis` string, matching the existing pattern
  (`confirmed_outcome_basis`, `revenue_basis`, `vehicle_note`). A number without a basis
  is not shippable in this codebase.
- `v_attribution_sale_chain` gains a **PROVENANCE hop** at the head of the chain, before
  CAMPAIGN. `hops_total` goes 8 → 9. On today's data the first break moves from `CAMPAIGN`
  to `PROVENANCE`, which is the correct answer: you cannot attribute a sale whose reality
  is unattested. This is the smallest change that makes the chain honest, and it reuses
  machinery that already exists.
- `v_lead_recovery.state = 'RECOVERED'` requires an attested-`REAL` sale row. Unattested →
  the state re-derives from messages and `confirmed_outcome_state` becomes a new
  `SALE_UNATTESTED`, distinct from the existing `NO_SALE_RECORDED`. Collapsing the two
  would tell the screen a sale does not exist when it does.
- `v_lead_recovery_state_model.RECOVERED.observation` returns to
  `REACHABLE_NOT_OBSERVED` — true today, and it stops the state model claiming a state has
  been seen in the wild when what was seen was a probe.
- `v_deal_rescue_readiness.VOLUME.measured_now` must read
  *"5 lead(s), 0 attested sale(s), 1 unattested, 0 finance quote(s)"*. **`met_now` stays
  `false` either way** — record this, so the change is not credited with an improvement it
  does not make.

**A3 — quarantine-tenant move. Zero DDL, and it is the wrong shape. NOT RECOMMENDED as
the fix; usable as a same-day stopgap if the owner wants the number off the screen before
the column exists.**

Measured, because it is genuinely tempting and its limits are exact:

```sql
with v as (select c.relname, pg_get_viewdef(c.oid,true) d from pg_class c
           join pg_namespace n on n.oid=c.relnamespace
           where n.nspname='public' and c.relkind='v')
select count(*) filter (where d ilike '%is_quarantine%') from v where d ilike '%purchase_history%';
-- 10 of 11
```

10 of the 11 views that read `purchase_history` already carry
`WHERE NOT EXISTS (select 1 from tenants _q where _q.is_quarantine and _q.id = _v.tenant_id)`
in their own definitions, and a quarantine tenant already exists
(`02c86264-6653-4522-b055-1c3f359a82fe`, *"UNATTRIBUTED - QUARANTINE (not a dealership)"*).
RLS on the table is `tenant_id IN (nexus_current_tenant_ids())`, and `tenant_members`
holds exactly one member, ALBA-only — so a single `UPDATE … set tenant_id = <quarantine>`
would make the row invisible to the four screens that read the table directly as well.

Why it is still the wrong shape:

- It makes the row **disappear**, not be **labelled**. That is A1's failure with extra
  steps, and it is exactly what "operationalize uncertainty" forbids.
- It is a write on the contaminated row on production. Recoverable, but it edits the
  evidence.
- It does not fix `v_deal_rescue_readiness` — the one view of the eleven with **no**
  quarantine predicate and no tenant scope. Deal Rescue and Revenue would still print
  *"1 sale(s) visible to this caller"*.
- It solves nothing for the next test row: the default is still "real unless moved".

---

## Layer (b) — what a screen displays for UNKNOWN

The requirement is not "show less". It is: a reader must be able to tell these four apart
at a glance, and none of them may be rendered as the others.

| State | Meaning | Rendering |
|---|---|---|
| **REAL** | A person attested this is real business | The figure, plain, toned `t-won` as today |
| **UNKNOWN** | Nobody has said either way | The figure **is shown**, visually demoted, never toned `t-won`, always carrying the attest affordance |
| **TEST** | Attested not-real | **Not in the money figure.** Carried in a visible counter |
| **NOT COMPUTABLE** | The question cannot be answered from this schema | The existing third rendering — no digit |

Concretely, on today's data:

> **Confirmed revenue — AED 0**
> *Confirmed means attested by a person. **Nothing on file is attested.***
> **AED 585,000 across 1 sale is on file and unattested.** Recorded 2 Sep 2026 by the
> workflow "Sync Closed-Won to pgvector", against lead 38.
> `[ Review this sale ]`

Rules, drawn from what this codebase already does well:

1. **The unattested figure stays on screen.** Removing it makes the screen unable to
   distinguish "no sales" from "unverified sales". `screens/system-truth.js:604-635` and
   the `NOT COMPUTABLE / NOT MEASURED / real 0` three-state rendering it defines is the
   pattern to extend to a fourth state, not to reinvent.
2. **UNKNOWN never gets a success tone.** `t-won` at `attribution.js:314`,
   `revenue.js:924` and `lead-recovery.js:255` is a claim, and it must be gated on
   `data_origin = 'REAL'`.
3. **No badge derived from an unattested row.** The VIP pill
   (`customers.js:1179`, `:1667`, `leads.js:1084`) and the drawer's
   **"returning customer"** header (`lib/lead-drawer.js:314`) are the sharpest failures,
   because a pill has no room for a caveat. Rule: **an unattested purchase produces no
   badge, and the absence is stated** — the drawer already has the right sentence for the
   adjacent case (`:327`): *"This customer is **not** being shown as a first-time buyer —
   nothing here knows either way."* Reuse that voice.
4. **Every screen showing an unattested figure carries the attest affordance**, and it
   goes to a person, never to the row's writer. This is the lesson of C6 in
   `CONTAMINATION-MAP.md`: the database's only existing attestation says
   `provenance_counts_as_real = true` over a preflight probe, because the preflight wrote
   its own attestation. **A writer may set `UNKNOWN`. Only a human session may set `REAL`.**
   `lead_event.provenance_counts_as_real` is `NOT NULL` with **no default** — the shape is
   already in this database; what is missing is that the attester must be a different
   party from the writer.
5. **A screen that shows nothing must say why it shows nothing.** *"Nothing confirmed"*
   (`revenue.js:940`) is not enough once an unattested row exists — it reads as an empty
   ledger when the ledger is not empty. It must become *"Nothing attested; one sale on
   file awaiting review."*

---

## What ships, in order

1. **Owner decision, before any code:** accept that Confirmed revenue reads **AED 0** the
   day this ships, with the unattested AED 585,000 shown beside it and labelled.
2. `data_origin` (+ `test_run_id`) on `purchase_history` per `ops/data-provenance/CONTRACT.md`,
   `NOT NULL DEFAULT 'UNKNOWN'`, with the grant-parity preflight in §0. Grant-safe on this
   table — measured, not assumed.
3. Backfill: **nothing.** Every existing row is `UNKNOWN` by default. That is the rule
   working, not a gap.
4. Attest row `2f04d2c4-…` as `TEST` **through the human attestation path**, once that path
   exists. Not by migration, and never by `UPDATE` from an agent — the value of the
   attestation is entirely in who made it.
5. The 11 views per Layer (a) A2, with grant re-assertion on any dropped view.
6. The nine screens per Layer (b).
7. A regression assertion that survives the next test row: **no metric labelled
   CONFIRMED may be sourced from a row whose `data_origin <> 'REAL'`.** `4bc9f8f` shipped
   `ops/frontend-contract/verify-bundle.mjs` for exactly this kind of pinning; this is its
   second assertion.
