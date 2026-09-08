# `tenants.is_unattributed_default` pointed at ALBA CARS — measured, fixed, proved

STAGE 1.5. 5 September 2026.
Staging `wwspuxrbiyagnrnzgate`. Production `dsvuoovivysszdoiorch`.
No git command was run. The n8n box was not contacted.

---

## 1. The before-state, measured

### 1.1 The flag

```
production  select id, slug, name, status, is_unattributed_default from public.tenants;
  fff6a2b5-cfd5-4460-8383-875bc5826de0 | alba-cars | ALBA CARS | active | TRUE
  (one row)

staging     11111111-…  staging-alpha | Alpha Motors (staging) | active | false
            22222222-…  staging-bravo | Bravo Autos (staging)  | active | false
            (no tenant held the flag)
```

### 1.2 What the flag actually does

`public.nexus_default_tenant_id()` — `SECURITY DEFINER`, owner `postgres` — was:

```sql
select coalesce(
  public.nexus_current_tenant_id(),
  (select t.id from public.tenants t
    where t.is_unattributed_default and t.status = 'active'
      and coalesce(current_setting('role', true), '') not in ('authenticated','anon')
    limit 1));
```

It is the column `DEFAULT` on `tenant_id` for **16 tables** (`pg_attrdef`):
`audit_log, communication_logs, competitors, customer_360_profiles,
daily_metrics, deals_embeddings, finance_quotes, inventory,
inventory_profit_settings, kyc_documents, leads, processed_messages,
purchase_history, rag_documents, users, whatsapp_contacts`.
`tenant_id` is **NOT NULL on all sixteen**, and there are **37 foreign keys** onto
`public.tenants`.

Measured live, as the MCP connection (`postgres`, role setting `none`):

| | production | staging |
|---|---|---|
| `nexus_default_tenant_id()` | **`fff6a2b5…` = ALBA CARS** | `NULL` |
| `nexus_scoped_tenant_id()` | `fff6a2b5…` = ALBA CARS | `NULL` (2 active tenants) |

**So: any backend write that omitted `tenant_id` was filed under the one real
dealership.** That is the defect, stated as a measurement rather than a reading
of the code.

### 1.3 Every reader of the flag, enumerated

- Database functions whose source contains `is_unattributed_default` (4):
  `nexus_default_tenant_id()`, `nexus_scoped_tenant_id()`,
  `nexus_onboard_dealership()`, `nexus_tenancy_readiness()`.
- Views whose definition contains it: **none** (`pg_get_viewdef` over all 39).
- RLS policies referencing it: **none** — `pg_policies` shows the tenant-scoped
  policies key on `nexus_current_tenant_ids()`, not on the flag.
- Repo: only prose, migration history and `apps/executive-dashboard/.gate/*`
  catalogue snapshots. No application code reads it.
- **`n8n-workflows/*.json`: zero occurrences** of `is_unattributed_default`,
  `nexus_default_tenant_id` or `nexus_scoped_tenant_id` — and zero occurrences of
  the string `tenant_id` at all, across all 22 files. Those files are a stale
  export (`_index.json`, `exported_at 2026-08-30T18:01:07Z`) predating the
  tenancy wave. **They cannot be used to establish what the box does**, and the
  box was out of scope. See §7.

### 1.4 Were any production rows already filed this way?

Every `tenant_id` on production is ALBA's, on all 23 tables that hold any rows
(swept with dynamic SQL over every `public` base table carrying the column). The
only exceptions are `policy_rule` (13) and `policy_rule_event` (7), which are
NULL by design and mean platform scope.

**Whether any of those rows arrived via the default cannot be determined and is
not claimed.** With one dealership the default and the correct tenant are the
same value, and nothing records which produced it. This is an unknown, not a
zero.

### 1.5 The two-configuration measurement that already existed

Recorded 3 Sep (`claude/nexus-tenancy-wave-and-the-second-waha-2026-09-03.md`),
measured as `service_role` on staging in both configurations:

- **no tenant holds the flag** → a write omitting `tenant_id` fails `23502`. Loud.
- **one tenant holds it** (production) → the identical write **succeeds silently
  into that tenant**. Bravo's message would file into Alpha's records.

---

## 2. The design, and the trade-off taken explicitly

### 2.1 Quarantine row, not "no default + let it raise"

A resolver that raises is not free here, and the cost is measurable rather than
theoretical: all 16 defaulted columns are `NOT NULL`, so "no default" is exactly
the staging configuration above — `23502`, and the inbound payload is destroyed.
For a WhatsApp message that means a real customer wrote in and the text is gone,
with an error row to show for it.

Chosen: **a `tenants` row that is structurally incapable of being a customer.**

| | quarantine row | no default (raise) |
|---|---|---|
| unresolvable traffic lands under a real dealership | never | never |
| the customer's message survives | **yes** | **no — 23502, destroyed** |
| recoverable | yes, one `UPDATE` | nothing to recover |
| tells you *which* writer is broken | yes, with the payload | only a stack trace |
| risk | a write silently succeeds into a bin | a write silently fails |

The bin risk is the real cost of this choice and is mitigated by making
quarantine **loud**: `nexus_quarantine_census()` and a WARN branch in
`nexus_tenancy_readiness()` (§4).

### 2.2 Why `status = 'quarantine'` and not an `active` row with a flag

Five call sites already decide behaviour from `tenants.status`:
`nexus_comm_keys_for_lead`, `nexus_lead_for_comm_key` and `search_rag_documents`
refuse to answer once more than one tenant is `active`; `capture_daily_metrics`
writes a row per `active` tenant; `whatsapp_policy_decision` refuses to send to a
non-`active` tenant. `nexus_scoped_tenant_id()` requires exactly one.

An `active` quarantine tenant would have made the active count 2 **on production,
today**, silencing Customer 360 and the RAG search as a side effect of a security
fix. A `status='quarantine'` tenant is excluded from all five **with no edit to
any of them**, and cannot be the target of a message. Verified: production active
tenant count is still 1 and `nexus_scoped_tenant_id()` still returns ALBA CARS.

### 2.3 What was built

Migration `20260905201206_tenancy_quarantine_replaces_dealership_default`:

- `tenants_status_check` widened to admit `'quarantine'`.
- `tenants.is_quarantine boolean not null default false`.
- `tenants_quarantine_is_never_active`: `CHECK (is_quarantine = (status = 'quarantine'))`.
- `tenants_unattributed_default_must_be_quarantine`:
  `CHECK (not is_unattributed_default or is_quarantine)` — **the structural fix.**
  Re-pointing the default at a dealership now requires dropping a named
  constraint, which is a reviewable diff.
- `tenants_one_quarantine` partial unique index.
- The flag cleared from ALBA and given to a new row:
  `__unattributed__` / `UNATTRIBUTED - QUARANTINE (not a dealership)` /
  `status='quarantine'`, production id `02c86264-6653-4522-b055-1c3f359a82fe`.
- `nexus_default_tenant_id()` — fallback predicate `status='active'` replaced by
  `is_quarantine`.
- `nexus_scoped_tenant_id()` — **decoupled from the flag entirely.** It answers
  "which dealership is this batch for", which is a different question; it now
  falls back to the sole `active`, non-quarantine dealership. Behaviour on
  production is unchanged (ALBA), and a nightly batch can never be pointed at the
  bin.
- `nexus_onboard_dealership()` — raises if the slug names a quarantine tenant.
  Without this its `ON CONFLICT (slug) DO UPDATE SET name` would silently rename
  the quarantine tenant into something that reads as a customer.
- `nexus_quarantine_census()` — `SECURITY INVOKER` on purpose, `EXECUTE` revoked
  from `anon`, `authenticated` and `PUBLIC`.

Two independent locks make quarantine unreachable by any dealership session, and
neither is new code — both are pre-existing and were verified, not assumed:

1. it holds **no `tenant_members` row**, and
2. `nexus_current_tenant_ids()` and `nexus_current_tenant_id()` both require
   `tenants.status = 'active'`, which `'quarantine'` is not.

---

## 3. Proofs

Every result below is a measurement. Staging probes used the two synthetic
dealerships; production probes were read-only or ran inside a transaction that
ended in `RAISE EXCEPTION` and rolled back.

### 3.1 Staging (two active dealerships — the case the defect is about)

Three rows were written by a `service_role` insert that **omitted `tenant_id`**:
a lead, a `purchase_history` row of **AED 999,999**, and an `audit_log` row.

| # | probe | result |
|---|---|---|
| P1 | `service_role` INSERT omitting `tenant_id`, with Alpha and Bravo both active | landed under **QUARANTINE** (`9448e5d8…`), not Alpha, not Bravo |
| P4 | Alpha's owner session (`authenticated`, real `sub`) | tenants visible **1**; quarantine tenant rows **0**; quarantined leads **0**; quarantined deals **0**; `sum(amount_aed)` **0**; quarantined audit **0**; `nexus_default_tenant_id()` returned **Alpha**, not quarantine |
| P5 | same session with a **forged JWT** `app_metadata.tenant_id` = the quarantine id | claim was read back correctly, resolved tenant still **Alpha**; all quarantine counts **0** |
| P6 | **forged `tenant_members` row** granting Alpha's user membership of quarantine, *plus* the forged JWT | it held **2** membership rows; `nexus_current_tenant_ids()` admitted **1**; resolved tenant **Alpha**; quarantine tenant rows, leads, deals, revenue, audit all **0** |
| — | Bravo's owner session | tenants visible 1; quarantined leads 0; revenue seen 0; default for that session = **Bravo** |
| P7 | `update tenants set is_unattributed_default = true where slug='staging-alpha'` | refused, `23514` |
| P8 | `update tenants set status='active' where is_quarantine` | refused, `23514` |
| P9 | `nexus_quarantine_census()` as `service_role` | found all three rows, with timestamps — **retained and findable** |
| P11 | `anon` | `42501 permission denied` on `tenants`, `leads`, `purchase_history` **and** the census — blocked by GRANT, not by a row filter |
| — | `authenticated` calling `nexus_quarantine_census()` | `42501` |
| — | `authenticated` UPDATE of a quarantined lead | **0 rows affected** |
| — | `authenticated` DELETE on `purchase_history` | `42501` |

P6 is the load-bearing one: **even a genuine membership row plus a forged claim
does not open quarantine**, because the status predicate is a second, independent
lock. The forged membership row was deleted immediately afterwards
(re-verified: 0 membership rows on quarantine).

All three staging probe rows were deleted afterwards and absence verified
(`nexus_quarantine_census()` returns 0 rows).

### 3.2 The views — where the assumption failed

Checked against the **actual view definitions**, not assumed. All seven
attribution/recovery/rescue views enumerate `FROM tenants t` in a `cfg` CTE with
no exclusion, and `v_deal_rescue_candidates` builds per-tenant rows straight off
`leads` and `purchase_history`.

With the three quarantined rows present, **before** the guard:

| reader | v_attr_events | v_attr_edges | v_attr_lead_chain | v_attr_sale_chain | v_lead_recovery | v_deal_rescue_candidates |
|---|---|---|---|---|---|---|
| Alpha's session (`authenticated`) | 0 | 0 | 0 | 0 | 0 | 0 |
| `service_role` (BYPASSRLS) | **3** | **4** | **1** | **1** | **1** | **2** |

So the exclusion existed **only because of RLS**, and `v_deal_rescue_candidates`
carries `deal_value_aed`. CLAUDE.md is explicit that "returns 0 rows" is evidence
about RLS and nothing else; a vendor-side report run as `service_role` that
summed one of these without grouping by tenant would have added quarantined money
to a real figure.

Migration `20260905201227_tenancy_quarantine_excluded_from_tenant_scoped_views`
wraps **every public view carrying a `tenant_id` column** (29 of them, listed by
name in the migration) with

```sql
where not exists (select 1 from public.tenants _q
                   where _q.is_quarantine and _q.id = _v.tenant_id)
```

`NOT EXISTS`, not `NOT IN`, so the NULL-tenant `policy_rule` rows that mean
platform scope are preserved. `security_invoker = true` is re-asserted on all 29.

**After** the guard, staging as `service_role`: all six views **0**, and a
13-view sweep summed to **0**. Alpha's own counts were **identical before and
after** (6, 6, 3, 0, 3, 4, 3) — the guard is a no-op for a dealership session,
because for an `authenticated` caller the subquery reads `tenants` under RLS and
returns nothing.

### 3.3 Production, re-proved

Before/after row counts across all 29 guarded views: **identical, 406 = 406**,
including the 13 platform-scope `v_policy_rule` rows. `security_invoker`: 39 of 39.

Production probe, one transaction, rolled back
(`RESULT (transaction rolled back, lead id 120 burnt)`):

| # | probe | result |
|---|---|---|
| P1 | `service_role` INSERT into `leads` omitting `tenant_id` | **UNATTRIBUTED - QUARANTINE (not a dealership)** — was ALBA CARS before this work |
| P7 | ALBA tries to take the unattributed default | refused, `23514` |
| P8 | quarantine tries to become `active` | refused, `23514` |
| P9 | census as `service_role` | 1 table with rows — the probe row was found |
| P4 | ALBA's real owner session sees quarantine tenant rows | **0** |
| P5 | ALBA's real owner session sees quarantined leads | **0** |
| P6 | ALBA's session with a forged claim naming the quarantine tenant | resolved to **ALBA CARS** |
| P10 | quarantine rows in `v_attribution_events` for that session | **0** |
| P11 | `anon` reading `tenants` | `42501 permission denied` |

Disclosed: the rolled-back INSERT consumed `leads_id_seq` value **120**. No row
persisted — `leads` is still 3 rows, `nexus_quarantine_census()` returns 0 rows,
`tenants` holds 2 rows.

Production state after, as `service_role`:

```
default_tenant          = UNATTRIBUTED - QUARANTINE (not a dealership)
scoped_tenant           = ALBA CARS          <- unchanged, Customer 360 not silenced
active_tenants          = 1                  <- unchanged
quarantine_members      = 0
census_rows             = 0
leads                   = 3                  <- unchanged
audit_log               = 741                <- unchanged
sum(purchase_history.amount_aed) = 585000    <- unchanged, matches AUDIT-2026-09-04
```

### 3.4 Grants and advisors

The one ACL query from CLAUDE.md, run on production after the change, returns a
single row: `leads`, `authenticated=rw` — the deliberate dashboard write path. No
new object is writable by `anon` or `authenticated`. `nexus_quarantine_census()`
holds `postgres=X, service_role=X` only; `nexus_tenancy_readiness()` likewise.
`get_advisors(security)` returns no new finding — the census does not appear in
the `authenticated_security_definer_function_executable` list, and the pre-existing
lints on `nexus_default_tenant_id` / `nexus_scoped_tenant_id` are unchanged and
must stay (they are column defaults; CLAUDE.md records that a blanket revoke was
measured to break four live paths).

---

## 4. Quarantine is loud, not a landfill

`select * from public.nexus_quarantine_census();` — `service_role` only — returns
one row per table holding quarantined rows, with a count and the newest
timestamp.

`nexus_tenancy_readiness()` was rewritten
(`20260905201337_tenancy_readiness_reads_quarantine_not_dealership_default`). Its
old single BLOCKER fired whenever **any** tenant held the flag and named that
tenant — CLAUDE.md notes it therefore "could never clear". It is now four
measured branches:

- **BLOCKER** the flag is held by something that is not a quarantine tenant
  (should be unreachable; if it fires, the CHECK constraint has been dropped)
- **BLOCKER** nothing holds the flag — fail-closed, but `23502` destroys the
  payload, so this is not the safe side and is not treated as one
- **INFO** the designed state, with both locks **measured at call time** (the
  membership count and the actual status string), not asserted
- **WARN** rows are sitting in quarantine, per table, with counts

Production output now: **zero BLOCKERs.** Two pre-existing WARNs remain
(`policy_rule`, `policy_rule_event` — nullable by design, platform scope) plus
the two INFO lines. Staging: identical shape, zero BLOCKERs.

---

## 5. Migration files

Read back from `supabase_migrations.schema_migrations` on **production** and
written byte-exactly, no trailing newline:

| version | name | md5 (DB) | md5 (file) |
|---|---|---|---|
| 20260905201206 | `tenancy_quarantine_replaces_dealership_default` | `8c6945ef082968490d9d7409ceac7b71` | same |
| 20260905201227 | `tenancy_quarantine_excluded_from_tenant_scoped_views` | `2b8608cd5bfc763af0eb72122abf6b04` | same |
| 20260905201337 | `tenancy_readiness_reads_quarantine_not_dealership_default` | `af7136da6ded657be61986bd0a9fdea4` | same |

Files: `/home/claude/repo/supabase/migrations/<version>_<name>.sql`. Last byte of
each is `;`. The same three statements were applied to staging first, under the
same names.

---

## 6. Two things found on the way that are not this defect

- **Staging and production have drifted on one view.**
  `v_inventory_profit_sentinel` differs (`0c887850…` prod vs `3c97e192…` staging).
  The other 28 tenant-carrying views are byte-identical. Staging is otherwise at
  full parity: 59 tables, 39 views, 263 functions.
- **Another agent was writing to production during this session** — migrations
  `rbac_01_staff_role_vocabulary_and_helpers` (20260905201401) and
  `rbac_02_inventory_writes_by_role` (20260905201429) landed between my second and
  third migrations. Nothing here depends on them and nothing here touched what
  they touch, but the "one agent at a time" rule evidently does not hold for the
  database the way it does for the n8n box.

---

## 7. What is still open

1. **Which live n8n workflows still omit `tenant_id` is UNKNOWN.** CLAUDE.md says
   17 of 21 stamp it; the four that do not are not named anywhere I could read,
   the repo's workflow JSON is a 30 Aug export with **zero** occurrences of
   `tenant_id`, and the box was out of scope. Those writers' rows now go to
   quarantine instead of to ALBA. They are retained, recoverable and invisible to
   the dealership — a visible, fixable misfiling instead of a silent
   cross-dealership one. **`nexus_quarantine_census()` must be run within 24
   hours and then daily** until it is stable; that is the first time this
   question has ever been answerable.
2. **The `Resolve Tenant` rollback semantics changed** and the note on the box
   still says the old thing. Written up in
   `/home/claude/out/n8n-quarantine-change-NOT-DEPLOYED.md`. **NOT DEPLOYED** —
   the box was not contacted and no repo workflow JSON was edited.
3. The three `?on_conflict=` URL edits from 2 Sep are still outstanding.
4. `workflow_registry` still has no `tenant_id` and `SELECT USING (true)`.
   Unchanged by this work; `QUALITY_GATE.mjs` check L2 stays red on it.
5. Nothing here was verified through the deployed dashboard UI. The proofs are
   database-level, as `authenticated` with real `sub` claims — which is the role
   the dashboard uses, but it is not the same as a rendered screen.
