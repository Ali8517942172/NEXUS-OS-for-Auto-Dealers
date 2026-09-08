# STAGE 1.6 — `workflow_registry` moved off the dealer data plane

Migration: `20260905194717_workflow_registry_ids_and_crons_off_the_dealer_plane`
Applied: staging `wwspuxrbiyagnrnzgate` first, then production `dsvuoovivysszdoiorch`, 5 Sep 2026.
Repo file: `supabase/migrations/20260905194717_workflow_registry_ids_and_crons_off_the_dealer_plane.sql`
md5 parity: file `10495681d5f5f22d7410b76fb6c59ef7` == production `md5(statements[1])` `10495681d5f5f22d7410b76fb6c59ef7`. No trailing newline (last byte `;`).

---

## 1. Measured BEFORE, on production

```
relacl        = postgres=arwdDxtm/postgres | service_role=arwdDxtm/postgres | authenticated=r/postgres
column grants = NONE on all ten columns (pg_attribute.attacl all null)
rowcount      = 18
columns       = id, name, audit_name, trigger_type, trigger_detail, category,
                is_active, description, writes_audit_log, audit_aliases
                -- no tenant_id
policies      = workflow_registry_deny_anon        RESTRICTIVE ALL  {anon}          USING false
                workflow_registry_read             PERMISSIVE  SELECT {authenticated} USING true
                workflow_registry_service_role_all PERMISSIVE  ALL    {service_role}  USING true
```

Unlike `policy_platform_attestation` (the 4 Sep case), this leak WAS visible to the ACL
query CLAUDE.md prescribes — `authenticated=r` sat in `relacl`.

**What a dealership login could read:** all 18 rows, all 10 columns — the real n8n
workflow ids, the cron expressions and webhook paths in `trigger_detail`, the trigger
kind, and the `is_active` flag. `apps/executive-dashboard/screens/automation.js:1664`
rendered the n8n workflow id verbatim in a mono cell.

## 2. Who actually reads it — measured, not assumed

**In the database.** Four views, every one `security_invoker = true` and `authenticated=r`,
so each is checked against the *caller's* privileges:

| View | Columns of `workflow_registry` its body reads |
|---|---|
| `v_workflow_health` | `id, name, category, trigger_type, trigger_detail, description, is_active, writes_audit_log` |
| `v_lead_recovery` | `name, audit_name, audit_aliases` only |
| `v_needs_attention` | `name, audit_name, audit_aliases` only |
| `v_audit_unregistered_writers` | `name, audit_name, audit_aliases` only |

No function in `public` references it (`pg_proc.prosrc ilike '%workflow_registry%'` → 0 rows).

**Outside the database (repo grep).**

- `n8n-workflows/**` — **ZERO references.** n8n does not read this table at all, so nothing NEXUS executes depended on the `authenticated` grant.
- `SCHEMA_PROBE.mjs:150` — reads `name,trigger_type,trigger_detail,is_active` with `SUPABASE_SERVICE_ROLE_KEY`. Unaffected.
- `QUALITY_GATE.mjs:217,878` — service_role catalogue reads. Unaffected; the declared 10-column shape is unchanged.
- The dashboard read it as `authenticated` from five screens, and **every one of those call sites already carried a written fallback for a failed read**: `settings.js:1245`, `automation.js:1250`, `campaigns.js:609`, `customers.js:575` ("workflow_registry answered 403 …"), `ask.js:1667`.

## 3. Mechanism, and why it is not a whole-table revoke

The prior control-plane migration `20260904112412_policy_control_plane_tables_off_the_dealer_data_plane`
established the verb: **revoke `authenticated` from control-plane material**, and it justified a
*whole-table* revoke on the ground that the table had no authenticated reader
("if an object has no reader for a role, revoking costs nothing").

Here the converse holds and it is decisive. Three views a dealership legitimately reads —
Lead Recovery, Needs Attention, and the unregistered-writer census — join this table, and being
`security_invoker` they would go to `42501` with it. A whole-table revoke would take the flagship
engine down to close a leak in a chip.

So the **same verb is applied per column**. Column-level grants are already this database's
established pattern for exactly this shape: CLAUDE.md records `channel_registry` carrying
`authenticated=r` on seven of eight columns with `credential_ref` deliberately withheld,
and calls that design right.

- **Withheld from `authenticated`:** `id`, `trigger_type`, `trigger_detail`.
- **Kept for `authenticated`:** `name`, `audit_name`, `audit_aliases`, `category`, `description`, `is_active`, `writes_audit_log`.

CONTROL-PLANE.md Part 4: *"symptom and impact to the dealership; mechanism and location to the
vendor."* A workflow's name and whether it is switched off is symptom. Its id and its cron is location.

**`v_workflow_health` had to be rebuilt.** A `security_invoker` view is checked on every base
column its *body* reads, not on the columns the outer query asked for — proved on staging in a
rolled-back transaction: with the column grants in place, `select count(name) from
public.v_workflow_health` as `authenticated` returned **42501**. Left alone, the whole view would
have been unreadable by a dealership login, removing the one thing Part 4 says a dealership *is*
entitled to. `create or replace view` cannot drop columns, and nothing depends on the view
(pg_depend: 0 dependent views, 0 functions), so it was dropped and recreated **without** `id`,
`trigger_type`, `trigger_detail` — 28 columns to 25. `with (security_invoker = true)` is spelled
out inline and the SECURITY comment restored, per the standing warning in `20260902051823`.
Not one line of the health arithmetic changed.

**The RLS policy `workflow_registry_read` was deliberately left in place.** CLAUDE.md: "RLS is one
lock, not two." The row lock is not the lock that was wrong — the table is a global catalogue with
no tenant dimension, and the three surviving views need its rows to resolve a name. Dropping the
policy would have returned zero rows to those views and broken them **silently**, which is worse
than breaking them loudly.

---

## 4. Reachability proof — PRODUCTION, after (`set local role`, rolled-back transaction)

| Role | Statement | Outcome |
|---|---|---|
| `authenticated` | `select * from workflow_registry` (star expansion) | **42501** permission denied for table workflow_registry |
| `authenticated` | `select max(id) from workflow_registry` | **42501** permission denied for table workflow_registry |
| `authenticated` | `select max(trigger_detail) from workflow_registry` | **42501** permission denied for table workflow_registry |
| `authenticated` | `select max(trigger_type) from workflow_registry` | **42501** permission denied for table workflow_registry |
| `authenticated` | the seven kept columns | EXECUTED |
| `authenticated` | `select * from v_workflow_health` | EXECUTED **rows=18** |
| `authenticated` | `select id from v_workflow_health` | **42703** column "id" does not exist |
| `authenticated` | `select trigger_detail from v_workflow_health` | **42703** column "trigger_detail" does not exist |
| `authenticated` | `select * from v_lead_recovery` | EXECUTED rows=0 |
| `authenticated` | `select * from v_needs_attention` | EXECUTED rows=0 |
| `authenticated` | `select * from v_audit_unregistered_writers` | EXECUTED rows=0 |
| `anon` | `select * from workflow_registry` | **42501** permission denied for schema public |
| `anon` | `select * from v_workflow_health` | **42501** permission denied for schema public |
| `service_role` | `select id, trigger_type, trigger_detail from workflow_registry` | EXECUTED **rows=18** |
| `service_role` | `select * from v_workflow_health` | EXECUTED **rows=18** |

**Honesty note on the three `rows=0` lines.** A bare `set local role authenticated` carries no JWT,
so `nexus_current_tenant_ids()` resolves to nothing and those tenant-scoped views filter to zero.
That is the RLS row filter and it is unchanged by this migration — `rows=0` is evidence about RLS
and nothing else (the same point migration `20260904112412` made). The verdict that matters for
those three is **EXECUTED, not 42501**: the grant did not move under them. The same three
statements returned EXECUTED in the pre-apply rolled-back staging rehearsal.

The line that carries the real positive evidence is `v_workflow_health` → **18 rows of live
workflow health reached `authenticated`**, with no id, no trigger type and no cron in them.

Staging ran the identical probe with identical verdicts (row counts 0 throughout — staging's
`workflow_registry` is empty; the grant verdicts are the witness there, as CLAUDE.md requires).

## 5. Residual-content check

Closing three columns is worthless if the same strings live in a surviving column. Measured on the
18 production rows:

```
description matching cron-shaped text                          0
description matching webhook|https?://|nip.io|35.224|:5678     1
name / audit_name / audit_aliases / category matching either   0
```

The single `description` hit is `NEXUS Infra Health Probe` — *"…reporting WAHA session status, the
connected number and its configured webhooks."* That is the word "webhooks" in prose, not an
endpoint. **No id, cron expression, URL or hostname survives in any column `authenticated` can read.**

## 6. Final state, production

```
workflow_registry relacl        = postgres=arwdDxtm/postgres | service_role=arwdDxtm/postgres
                                  (no authenticated entry)
workflow_registry column grants = name, audit_name, category, is_active, description,
                                  writes_audit_log, audit_aliases  -> authenticated=r/postgres
columns with NO grant           = id, trigger_type, trigger_detail
has_table_privilege(authenticated, SELECT)          = false
has_column_privilege(authenticated,'id')            = false
has_column_privilege(authenticated,'trigger_detail')= false
has_column_privilege(authenticated,'name')          = true
has_table_privilege(service_role, SELECT)           = true
has_table_privilege(anon, SELECT)                   = false
policies                                            = 3 (unchanged)

v_workflow_health relacl           = postgres=arwdDxtm | authenticated=r | service_role=arwdDxtm
v_workflow_health security_invoker = true
v_workflow_health columns          = 25 (was 28)
```

Staging matches, column for column.

---

## 7. Consumer changes made in the working tree

PostgREST select lists that named a now-closed column would have returned `403`
(base table) or `400 / 42703` (view), so they were narrowed. Rendering code was left alone
wherever it already had a null-safe fallback.

| File | Change |
|---|---|
| `screens/ask.js` | `v_workflow_health` select drops `id,trigger_type,trigger_detail`; two `workflow_registry` selects drop `id`; registry↔health match moves from `String(r.id)===String(healthRow.id)` to `low(r.name)===low(healthRow.name)` |
| `screens/automation.js` | `workflow_registry` select drops `id`; `regById` → `regByName` (keyed on `name`); the mono `${esc(w.id ?? '')}` line in the drawer head — the n8n workflow id printed to the dealership — **deleted** |
| `screens/campaigns.js` | health select drops `id,trigger_type,trigger_detail`; registry select drops `trigger_detail` |
| `screens/competitors.js` | health select drops `trigger_detail` |
| `screens/customers.js` | `HEALTH_COLS` drops `id`; registry select drops `id` |
| `screens/overview.js` | health select drops `id` |
| `screens/settings.js` | health select drops `id,trigger_type,trigger_detail`; registry select drops `id`; `regById` → `regByName` |

`automation.js:796` uses `select=*` and needed no change. `compliance.js` and `conversations.js`
never selected any of the three. All nine touched files pass `node --check`.

The `name` join is exact, not a loosening: production has **18 rows, 18 distinct names, 18 distinct
lower-cased names**, and `v_workflow_health.name` *is* `workflow_registry.name`.

Null-safety of the code that still reads the three columns was verified rather than assumed:
`low()` is `String(s || '')`-shaped in every screen, and `registryHoursUtc(undefined)` returns
`null`, which collapses `competitors.js`'s schedule-drift sentence (which quoted the cron) to `''`.

---

## 8. NOT CLOSED — stated, not softened

1. **`workflow_registry` still has no `tenant_id`, and `workflow_registry_read` is still
   `USING (true)` for `authenticated`.** Every signed-in user of every dealership can still read
   *which* automations exist, their names and descriptions, and which are switched off. That is
   survivable only because there is one dealership. Giving the table a `tenant_id` and a scoped
   policy remains a **BLOCKER for onboarding a second dealership**. This migration does not claim
   to close it.
2. **`QUALITY_GATE` check L2 stays red on this row, deliberately.** L2 reads *policies*, and the
   policy is untouched, so the finding stays visible exactly as `L2_NOT_EXEMPT_NOTES` intends.
   **Nothing was added to `L2_EXEMPT_TABLES` and no security test was weakened or downgraded.**
3. **Copy on the Automation and Settings screens is now misleading in places.** With
   `trigger_detail` invisible to the dealer plane, `automation.js:1271` still says *"None of the N
   registered workflows records a cadence … Recording the real cron expression in
   `workflow_registry.trigger_detail` is what turns this panel on"*, and `automation.js:1485` /
   `settings.js:1495` render *"trigger not recorded"*. The registry **does** record it; the
   dealership simply may not see it. The strings are honest about the data the screen holds and
   dishonest about why. Rewriting that prose — along with the cadence panel, the Environment card
   and the endpoint chip list (`settings.js:596-646`) — is CONTROL-PLANE.md Part 7 item 1's
   frontend half and was **not** done here.
4. **Behaviour changes that follow from the closed columns, none of them errors:**
   `automation.js:300` / `settings.js:158` classified NEXUS's three public marketing-page
   workflows by matching `trigger_detail`; that test now always fails, so those rows lose their
   "public page" exemption on the dealership's view. `automation.js:404`'s "Run now" gate reads
   `trigger_detail` and will now never enable a live run — a safety-positive degradation.
   `campaigns.js` drip detection and `ask.js` endpoint matching fall back to name matching, which
   is the path both files already document.
5. **Not tested through a real signed-in JWT over PostgREST.** The proof above is a `set local
   role` probe in a rolled-back transaction — the same method the 4 Sep control-plane migration
   used — plus `has_column_privilege`. No live browser session was signed in, and the rebuilt
   dashboard was not run. The grant verdicts are conclusive; the *screen* behaviour after these
   select-list edits is reasoned and syntax-checked, **not** observed.
6. **The row count is still disclosed.** `select count(*) from workflow_registry` reads no column
   and therefore still EXECUTES for `authenticated`. A count of automations is not an id, a cron
   or a topology, so it was left; it is recorded here so nobody discovers it and calls it a
   regression.
