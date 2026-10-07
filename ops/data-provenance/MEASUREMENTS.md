# What is actually on production, measured 9 September 2026

Production `dsvuoovivysszdoiorch`, read-only. Every number below is quoted with
the query that produced it. Nothing here was run against staging; where staging
is mentioned it is cited from a file, not from a query I ran.

---

## 1. Does a test/demo marker already exist? Searched first, on purpose

The instruction was to look before inventing. I looked for a column named
anything like `is_test`, `is_demo`, `demo`, `seed`, `fixture`, `synthetic`,
`sim`, `sandbox`, `dummy`, `sample`, `mock`, plus the four names in the owner's
proposed shape.

```sql
select c.table_name, c.column_name, c.data_type
from information_schema.columns c
join information_schema.tables t
  on t.table_schema=c.table_schema and t.table_name=c.table_name
 and t.table_type='BASE TABLE'
where c.table_schema='public'
  and (c.column_name ~* '(^|_)(is_)?(test|demo|seed|fixture|synthetic|sim|simulated|sandbox|dummy|sample|mock)($|_)'
       or c.column_name ~* 'environment|provenance|origin|source_kind|created_by|test_run|data_origin')
order by 1,2;
```

Sixteen rows. **Not one is a test/demo marker on a table that feeds a money or
count metric.** In full:

| table | column | what it actually is |
|---|---|---|
| `channel_message_events` | `origin_verified` | how a *message's* sender was authenticated |
| `competitors` | `source_kind` | `oem \| marketplace \| dealer \| unknown` — the kind of **website** scraped |
| `lead_event` | `environment` | `production \| simulation` — of the **endpoint**, not the row |
| `lead_event` | `origin_verified`, `provenance_counts_as_real` | how the **webhook** was authenticated |
| `lead_ingest_endpoint` | `environment`, `declared_provenance`, `required_provenance_for_source`, `provenance_counts_as_real`, `origin_allowlist` | endpoint configuration |
| `lead_source_catalogue` | `required_provenance` | platform reference data |
| `policy_platform_attestation` | `source_kind` | `PROVIDER_ACCOUNT_CONSOLE \| PROVIDER_PUBLIC_DOCUMENTATION \| REGULATOR_PUBLICATION \| CONTRACT \| LEGAL_ADVICE` |
| `tenant_configuration_default` | `provenance_required` | a boolean policy switch |
| `tenant_member_invite` | `created_by` | uuid of the inviting auth user |
| `whatsapp_delivery_events`, `whatsapp_message_usage` | `*conversation_origin_type` | Meta's billing category |

**Two of the owner's four proposed names are already taken, with meanings that
are not this one.**

- `source_kind` exists **twice**, with two vocabularies that do not intersect —
  lower-case website kinds on `competitors`, upper-case evidence kinds on
  `policy_platform_attestation`. Adding a third meaning under the same name is
  the precondition for the `match_quality` failure, not a variation on it.
- `created_by` exists on `tenant_member_invite` as a `uuid` foreign key to an
  auth user. A provenance `created_by` naming a harness (`"lead-simulator"`)
  or a person is a different domain in the same name.

Design consequence in `CONTRACT.md` §2: `data_origin` and `test_run_id` are
adopted verbatim — measured zero collisions. `source_kind` and `created_by` are
not, and the replacements are named there with this measurement as the reason.

Corroborating, from the repo rather than the catalogue —
`supabase/migrations/20260907124500_leadingest_10_the_promoter_never_looked_at_environment.sql:20`:

```
--   columns of public.leads matching (sim|test|demo|fixture|synthetic) ->  0
```

Still 0 today.

---

## 2. Tenants present

```sql
select id::text, name, created_at from tenants order by created_at;
```

| id | name | created |
|---|---|---|
| `fff6a2b5-cfd5-4460-8383-875bc5826de0` | Tenant A | 2026-09-02 08:45:04+00 |
| `02c86264-6653-4522-b055-1c3f359a82fe` | UNATTRIBUTED - QUARANTINE (not a dealership) | 2026-09-05 20:12:06+00 |

**The demo tenant `dddddddd-dddd-4ddd-8ddd-dddddddddddd` does NOT exist on
production.** Two rows, neither is it. `ops/demo/seed_demo_tenant.sql` is a
staging fixture and its own header refuses production on two independent tests.
So demo-tenant contamination of production is not the problem this contract has
to solve today. That is a fact about today and not a control: nothing in the
schema prevents a third tenant id from appearing.

Quarantine holds 21 rows in total — 20 `audit_log`, 1 `communication_logs`.
Everything else on production is Tenant A's.

---

## 3. Row counts per candidate table, and tenant split

```sql
select 'leads' t, count(*) n from leads union all select 'inventory', count(*) from inventory ... ;
select 'leads', coalesce(tenant_id::text,'(null)'), count(*) from leads group by 2 union all ... ;
```

| table | rows | Tenant A | quarantine | carries money |
|---|---|---|---|---|
| `audit_log` | 898 | 878 | 20 | no |
| `communication_logs` | 142 | 141 | 1 | no |
| `competitors` | 22 | 22 | — | `price_aed, our_price_aed, price_diff_aed` |
| `inventory` | 12 | 12 | — | `cost_aed, price_aed, gross_margin, net_margin, holding_cost_accrued, vat_amount` |
| `whatsapp_contacts` | 14 | 14 | — | no |
| `daily_metrics` | 21 | 21 | — | `pipeline_aed, holding_cost_aed` |
| `rag_documents` | 15 | — | — | no |
| `inventory_action_events` | 10 | 10 | — | no |
| `leads` | 5 | 5 | — | `budget_aed` |
| `lead_ingest_endpoint` | 5 | — | — | no |
| `customer_360_profiles` | 4 | 4 | — | no |
| `inventory_actions` | 3 | 3 | — | `engine_impact_aed, engine_gross_margin_aed, recovered_value_aed` |
| `kyc_documents` | 3 | 3 | — | no |
| `purchase_history` | **1** | 1 | — | `amount_aed` |
| `deals_embeddings` | 1 | 1 | — | no |
| `lead_event` | **1** | 1 | — | no |
| `users` | 1 | 1 | — | no |
| `finance_quotes` | **0** | — | — | 12 money columns |
| `lead_recovery_actions` | **0** | — | — | `recovered_value_aed` |
| `lead_recovery_action_events` | 0 | — | — | no |
| `channel_message_events` | 0 | — | — | no |
| `lead_owner_events` | 0 | — | — | no |

Every row on production carries a `tenant_id`. No orphans.

---

## 4. Which tables feed a number a dealer would act on

Derived, not assumed, and **counted by query rather than by hand** — my first
hand-count was wrong in every row and is not what is printed below.

The 24 screens under `apps/executive-dashboard/screens/` reference 39 distinct
`v_*` views (`grep -rho "v_[a-z_0-9]*" apps/executive-dashboard/screens/*.js
apps/executive-dashboard/lib/*.js | sort -u`). Base-table dependency comes from
`pg_depend`, not from reading SQL text, so a table reached through a nested view
still counts:

```sql
with dash(vn) as (values ('v_action_center_health'),('v_attribution_edges'), … 39 rows … ),
v as (select oid, relname from pg_class
       where relnamespace='public'::regnamespace and relkind='v')
select d.relname as base_table, count(distinct v.relname) as dashboard_views
from v
join dash on dash.vn = v.relname
join pg_rewrite r  on r.ev_class = v.oid
join pg_depend  dep on dep.objid = r.oid and dep.classid = 'pg_rewrite'::regclass
join pg_class   d  on d.oid = dep.refobjid and d.relkind = 'r'
                  and d.relnamespace = 'public'::regnamespace
group by 1 having count(distinct v.relname) >= 2
order by 2 desc, 1;
```

| base table | dashboard views | carries money |
|---|---|---|
| `tenants` | 24 | no — joined for the tenancy fence, not a data table |
| **`leads`** | **16** | `budget_aed`, and every lead count |
| **`communication_logs`** | **11** | no — drives response time, silence, enquiry coverage |
| **`purchase_history`** | **11** | `amount_aed` |
| `audit_log` | 7 | no |
| `finance_quotes` | 7 | 12 money columns, 0 rows |
| **`inventory`** | **7** | `cost_aed`, `price_aed`, margins, holding cost |
| `inventory_profit_settings` | 6 | thresholds, not amounts |
| `inventory_actions` | 5 | `engine_impact_aed`, `engine_gross_margin_aed`, `recovered_value_aed` |
| `lead_recovery_actions` | 5 | `recovered_value_aed` |
| `users` | 5 | no |
| `competitors` | 3 | `price_aed`, `our_price_aed`, `price_diff_aed` |
| `whatsapp_contacts` | 3 | no |
| `communication_log_evidence_event`, `deals_embeddings`, `inventory_action_events`, `kyc_documents`, `policy_rule` | 2 each | no |
| `customer_360_profiles` | 1 (`v_customer_360`) | no |
| `daily_metrics` | **0** — read directly by screens, not through any view | `pipeline_aed`, `holding_cost_aed` |

Money columns per table, measured separately:

```sql
select c.relname,
       (select string_agg(a.attname, ', ' order by a.attname) from pg_attribute a
         where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
           and a.attname ~ '(_aed|amount|price|cost|margin|value|revenue|budget)')
from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r';
```

Scope is decided from this table in `CONTRACT.md` §3.

---

## 5. Rows on production that are already known not to be dealership business

### 5.1 One lead is a NEXUS preflight, on file as production traffic

```sql
select id, left(name,20) nm, split_part(email,'@',2) email_domain,
       source, status, created_at::date, budget_aed
from leads order by id;
```

| id | name | email domain | source | status | created |
|---|---|---|---|---|---|
| 34 | Siva … | `whatsapp.lead` | nexus-master-router | DISQUALIFIED | 2026-08-26 |
| 35 | Effco … | *(empty)* | nexus-master-router | DISQUALIFIED | 2026-08-26 |
| 38 | Ali | gmail.com | nexus-master-router | WARM | 2026-08-31 |
| **121** | **Preflight Walk-In** | **`nexus-preflight.invalid`** | walk_in | new | 2026-09-07 |
| 122 | Hussain | `whatsapp.lead` | nexus-master-router | COLD | 2026-09-07 |

Lead 121 is not a customer. `ops/pilot-readiness/BLOCKERS.md:123-125` says so in
as many words — *"It is Ali's own preflight test, and it is on file as production
traffic"* — and `CLAUDE.md:512` calls it *"a preflight, not a customer"*.

The only thing distinguishing it in the database is an RFC 2606 `.invalid`
email domain. **That is a naming convention, not a column.** No view filters on
it. It is counted by `v_team_performance`, `v_customer_directory`,
`v_lead_recovery_coverage` and `v_customer_360` today.

### 5.2 The existing provenance machinery calls that preflight REAL

This is the most important measurement in this document.

```sql
select event_id, source_key, environment, origin_verified,
       provenance_counts_as_real, phase, lead_id, external_event_id
from lead_event;
-- 3d8cae04… | walk_in | production | operator_recorded | true | PROMOTED | 121
--           | external_event_id = 'walkin-preflight-2026-09-07-01'
```

```sql
select lead_id, source, phase, is_test_traffic,
       origin_externally_attested, origin_strength, source_key from v_lead_origin;
-- 121 | Walk-in / showroom | PROMOTED | is_test_traffic = FALSE
--     | origin_externally_attested = false | 10 | walk_in
```

```sql
select kind, is_externally_attested, strength_rank, counts_as_real
from lead_provenance_kind order by strength_rank desc;
-- hmac_sha256_x_hub   true  90 true
-- hmac_sha256_svix    true  85 true
-- shared_secret_header true 50 true
-- shared_secret_in_body true 30 true
-- origin_and_form_key true  20 true
-- operator_recorded   false 10 TRUE     <- flipped by 20260907023525
-- simulated           false  0 false
-- unverified          false  0 false
```

`v_lead_origin.is_test_traffic` is defined as `environment = 'simulation'`
(`supabase/migrations/20260907170000_…:123`). The preflight was recorded through
a **production** walk-in endpoint by an operator, so `environment = 'production'`
and `is_test_traffic = false`. Migration `20260907023525` — *"a walk-in is real
business it is just not attested"* — deliberately set `operator_recorded.counts_
as_real = true`, and that is correct **for the question it answers**.

**The existing field answers "which endpoint did this arrive at, and how was the
sender authenticated". It does not answer "is this row dealership business".**
For the one row on production where the two answers differ, it gives the wrong
one. That is why this contract is a new field and not a reuse of
`environment` or `provenance_counts_as_real`.

### 5.3 The twelve inventory units are NEXUS-shaped and unattested

```sql
select id, left(model,28), left(vin,10), status, price_aed, cost_aed, acquired_at::date
from inventory order by id;
-- NX-1001 Toyota Land Cruiser VXR 2024  JTMHV05J20  Available  385000  342000  2026-08-04
-- NX-1002 … through … NX-1012 Toyota Corolla 2.0 XLI 2024      79000   68000  2026-08-11
```

All twelve ids are `NX-1001` … `NX-1012` — a NEXUS numbering scheme, not a
dealer stock number. VINs are plausible WMI prefixes and no `DEMOVIN` marker.
They are not in `ops/journey-lab/DO-NOT-RUN-IN-PRODUCTION/setup_real_data.sql` (quarantined
2026-09-14; was `setup_real_data.sql` at the repo root — do not execute it)
(`grep -c "NX-10" ops/journey-lab/DO-NOT-RUN-IN-PRODUCTION/setup_real_data.sql` →
`0`), and `grep -rln NX-1001` finds them only in evidence docs, one tenancy
migration, and the dashboard unit-form fixtures — **never in an insert script in
this repo.** Whether Tenant A's real stock was entered under NEXUS ids or a fixture
was, is **NOT MEASURABLE from here**. It is UNKNOWN, and UNKNOWN is not ZERO.

These twelve are the entire basis of the Profit Sentinel's twelve scored units.

### 5.4 The AED 585,000 sale

```sql
select id, left(customer_name,20), split_part(email,'@',2), left(vehicle,30),
       amount_aed, purchase_date, deal_id, lead_id, created_at from purchase_history;
-- 2f04d2c4… | Ali | gmail.com | Lexus LX 600 2024 | 585000 | 2026-09-02
--           | deal_id 'auto:shabbir53ujjainwala@gmail.com|2026-09-02' | lead_id 38
--           | created_at 2026-09-02 09:59:53+00
```

Already flagged in `ops/truth-dashboard/SPEC.md:141`: the vehicle text is
*"Lexus LX 600 2024"* at exactly unit **NX-1011's list price of 585,000**, and
NX-1011 is still `Available`. That spec's words: *"the text matches perfectly and
proves nothing."*

Two further facts I measured that it does not state: the `deal_id` names
`shabbir53ujjainwala@gmail.com` while `customer_name` is `Ali` and `leads.id=38`
is `Ali` at a different gmail address; and `created_at` is the same day as the
tenant row itself was created (2026-09-02 08:45 vs 09:59). **Whether this is
Tenant A's real sale or a row entered during setup is UNKNOWN and cannot be settled
by any query.** It is the single row behind every "confirmed revenue AED 585,000"
tile in the product. It is the strongest argument for this contract and it is
the open question the contract cannot close by itself — only a person can.

---

## 6. What an `ALTER TABLE` would actually cost, per table

`nexus_guard_born_open_grants` has **no tag filter**, so it fires on every
`ddl_command_end`:

```sql
select evtname, evtevent, evtenabled, evttags from pg_event_trigger order by 1;
-- nexus_guard_born_open_grants       | ddl_command_end | O | (null)
-- nexus_guard_security_invoker_views | ddl_command_end | O | {CREATE VIEW,ALTER VIEW,ALTER TABLE}
```

From the guard's own body (`pg_get_functiondef`), for `object_type = 'table'`:

```sql
revoke all on <table> from anon;
revoke insert, update, delete, truncate on <table> from authenticated;
```

`SELECT` is untouched. `service_role` is untouched. A table-level `REVOKE` of a
privilege also removes that privilege's **column-level** grants. So the exposure
is exactly: table `DELETE`, and every column-level `INSERT`/`UPDATE`, for
`authenticated`.

Measured today —

```sql
select table_name, grantee, privilege_type, string_agg(column_name,',' order by column_name)
from information_schema.column_privileges
where table_schema='public' and grantee in ('authenticated','anon') group by 1,2,3;

select count(*) from information_schema.role_table_grants
where table_schema='public' and grantee='anon';   -- 0
```

| table | what `authenticated` loses on any `ALTER TABLE` |
|---|---|
| **`inventory`** | table `DELETE`; `INSERT` on 9 columns (`id, model, vin, status, price_aed, cost_aed, ai_recommendation, acquired_at, tenant_id`); `UPDATE` on 8 (same less `tenant_id`) |
| **`leads`** | `UPDATE` on 8 columns (`assigned_to, assigned_to_id, budget_aed, email, name, phone, status, vehicle_interest`) |
| `purchase_history` | **nothing** — `SELECT` only, and `SELECT` is not revoked |
| `competitors`, `communication_logs`, `customer_360_profiles`, `deals_embeddings`, `finance_quotes`, `inventory_actions`, `inventory_action_events`, `kyc_documents`, `lead_recovery_actions`, `whatsapp_contacts` | **nothing** — `SELECT` only |
| every table, for `anon` | **nothing** — `anon` holds 0 table grants in `public` |

**The owner's caution about `purchase_history` is, measured, unnecessary for the
grant reason.** The tables where the fear is justified are `inventory` and
`leads`. This has bitten before and is on file:
`supabase/migrations/20260906071310_restore_inventory_write_grants_the_acl_guard_stripped_on_alter.sql`
repaired exactly this after `20260906065739` ran two `ALTER TABLE`s on
`inventory` — *"inventory went from authenticated=rd with nine column ACLs to
authenticated=r with none, identically on staging and production. The unit form
would have returned 42501 on save."*

### Does the re-asserting `GRANT` survive the guard?

`GRANT` also fires `ddl_command_end`, and the guard's `nexus.acl_guard` re-entry
flag is set `is_local = true`, so it is reset at statement end and does **not**
suppress the guard across statements in the same migration
(`ops/channel-events/WIRING-SPEC.md:724`).

**Measured:** it survives. `inventory` holds its 9 `INSERT` / 8 `UPDATE` column
grants and its table `DELETE` on production today, restored by that GRANT-only
migration, whose own `DO` block would have raised had they not landed.

**Inferred, NOT MEASURED:** the mechanism. For a `GRANT`,
`pg_event_trigger_ddl_commands()` reports no `object_identity`, so
`format('revoke … on %s …', NULL)` yields `NULL`, `execute NULL` raises, and the
guard's `exception when others then null` swallows it. I did not run DDL on
either project to confirm this, and the migration pattern therefore does not
rely on the mechanism — it relies on a self-check that raises if the grants are
absent afterwards. See `MIGRATION-PATTERN.md` §5.

---

## 7. Not measured

- Whether Tenant A's twelve `NX-*` units are the dealership's real stock. UNKNOWN.
- Whether the AED 585,000 `purchase_history` row is a real Tenant A sale. UNKNOWN.
- Staging (`wwspuxrbiyagnrnzgate`) row counts and ACLs. Read-only to me as well,
  and I did not query it. Everything said about staging here is quoted from a
  repo file.
- Whether `service_role` writers (n8n, workflows) would in practice populate a
  new provenance column. No writer was read; `RISKS.md` §1 treats them as
  unconstrained.
