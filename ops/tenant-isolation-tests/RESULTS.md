# Two-Tenant Isolation Suite — Results

**Run:** 2026-09-17 · **Harness:** Supabase staging `wwspuxrbiyagnrnzgate`
**Schema source:** production `dsvuoovivysszdoiorch`, read-only
**Suite:** `two-tenant-suite.sql` beside this file
**Verdict: 181 PASS · 0 FAIL · 2 NOT RUN**

Production was never written to. No `apply_migration`, no INSERT/UPDATE/DELETE,
no DDL. Only `SELECT` against `pg_get_functiondef`, `information_schema`,
`pg_policies`, `pg_constraint`, `pg_indexes`, `pg_trigger`, `pg_roles`,
`pg_event_trigger` and the `tenants` table.

---

## 0. The impersonation gate

Every verdict below is worthless unless impersonation genuinely engages RLS, so
that was proved first and is recorded as a first-class test.

| test | as whom | target | expected | actual | verdict |
|---|---|---|---|---|---|
| `nexus_current_tenant_id()` | A | session | tenant A id | `0a1a…000a` | **PASS** |
| leads visible | A | `leads` | A's 2 rows, not the total of 4 | `2` | **PASS** |
| `nexus_current_tenant_id()` | B | session | tenant B id | `0b1b…000b` | **PASS** |
| leads visible | B | `leads` | B's 2 rows, not the total of 4 | `2` | **PASS** |

`current_user` inside the probe is `authenticated`; `auth.uid()` returns the
synthetic uuid from `request.jwt.claims`. RLS is being evaluated, not bypassed.

---

## 1–5. The matrix — 8 tables × 2 directions

Tables: `leads`, `customer`, `conversation`, `journey_step`, `inventory`,
`audit_log`, `communication_logs`, `lead_event`.
Both members hold role **`owner`** — the most privileged role — so every refusal
recorded is a *tenancy* refusal and never merely an RBAC one.
Write probes address the other tenant's row **by its real primary key**, captured
as `postgres` beforehand, never via a `tenant_id` predicate RLS would trivially
satisfy.

| # | test | as whom | expected | actual | verdict |
|---|---|---|---|---|---|
| 1 | READ other's rows | A and B, 8 tables | 0 rows, or refused | `0` on 7 tables; `ERROR 42501 permission denied` on `lead_event` | **16/16 PASS** |
| 2 | UPDATE other's row by PK | A and B, 8 tables | `ROWS=0` or refusal | `ERROR 42501 permission denied` on all 8 | **16/16 PASS** |
| 3 | DELETE other's row by PK | A and B, 8 tables | `ROWS=0` or refusal | `ERROR 42501` on 7; `ROWS=0` on `inventory` (the one table `authenticated` may DELETE) | **16/16 PASS** |
| 4 | INSERT carrying other's `tenant_id` | A and B, 8 tables | refused | `ERROR 42501 permission denied` on all 8 | **16/16 PASS** |
| 5 | INSERT with no `tenant_id` | A and B, 8 tables | refused, or own tenant — never the other's | `ERROR 42501 permission denied` on all 8 | **16/16 PASS** |

### What tests 2–5 actually prove, and what they do not

They prove **no write crosses the boundary**. They do **not** prove the RLS
`WITH CHECK` clauses work, because the refusal never reached RLS:

> On production, `authenticated` holds **`SELECT` only** on every one of these
> tables, plus `DELETE` on `inventory`. There is **no `INSERT` or `UPDATE` grant
> at all.** Every write is refused at the *grant* layer, one step before RLS is
> consulted.

So the `WITH CHECK` clauses in `leads_authenticated_all`,
`customer_authenticated_all`, `conversation_authenticated_all`,
`journey_step_authenticated_all` and `inventory_authenticated_insert/update` are
currently **unreachable dead code**. They are the safety net that would catch a
cross-tenant write *if* someone ever added a grant. Nothing in the live system
exercises them, so nothing would have told you if they were wrong.

That gap is why the suite carries a **supplementary section** (below).

---

## 6. The cost leak, specifically

`cost_aed` is `111111` for tenant A and `222222` for tenant B, so a sum of
`333333` is an unmistakable signature that a query reached both dealerships.

| # | vector | as whom | expected | actual | verdict |
|---|---|---|---|---|---|
| 6a | plain `select … where tenant_id = <other>` | A, B | `(none)` | `(none)` | **PASS** ×2 |
| 6b | unpredicated `sum(cost_aed)` over the whole table | A, B | own cost only | `111111` / `222222`, never `333333` | **PASS** ×2 |
| 6c | self-join `on o.tenant_id <> m.tenant_id` | A, B | `(none)` | `(none)` | **PASS** ×2 |
| 6d | through a `security_invoker` view | A, B | `(none)` | `(none)` | **PASS** ×2 |
| 6e | through a view **without** `security_invoker` | A, B | `(none)` | *(not executed)* | **NOT RUN** ×2 |

**Why 6e is NOT RUN, not PASS.** The database refuses to create such a view at
all. The event trigger `nexus_guard_security_invoker_views` — present and
enabled on **both** production and staging — raises `42501` on the `CREATE VIEW`:

> *"Without security_invoker, RLS is evaluated as the view owner (postgres,
> BYPASSRLS), not the caller. Such a view exposes every underlying row to the
> public anon key."*

The leak path is closed one layer earlier than this test can reach. Verified
separately: **all 26 production views** over these tables have
`security_invoker = true`. The control is real, but it was proved by reading the
guard and by the guard refusing the DDL — not by this test.

---

## 7. anon

| test | as whom | target | expected | actual | verdict |
|---|---|---|---|---|---|
| read | anon | all 13 in-scope tables | refused, or 0 rows | `ERROR 42501: permission denied for schema public` | **13/13 PASS** |
| read | anon | `zz_v_inventory_invoker` | refused, or `(none)` | refused | **PASS** |
| `nexus_current_tenant_id()` | anon | function | refused, or `(null)` | refused | **PASS** |
| `nexus_scoped_tenant_id()` | anon | function | refused, or `(null)` | refused | **PASS** |

anon cannot read anything because it does not have **`USAGE` on schema `public`**
— confirmed identical on production (`has_schema_privilege('anon','public','USAGE')`
is `false` on both). It never reaches a table, let alone a policy. This is the
strongest form of the result: the door is locked before the corridor.

---

## 8. service_role — the measurement that matters

This is not a failure. It is the whole point of the workflow findings, measured
so the risk is concrete rather than theoretical.

| # | test | as whom | expected | actual | verdict |
|---|---|---|---|---|---|
| 8 | cross-tenant visibility, 8 tables | service_role | sees **both** tenants | `2` distinct tenants on all 8 | **8/8 PASS** |
| 8b | `sum(cost_aed)` across all inventory | service_role | `333333` | **`333333`** | **PASS** |
| 8c | UPDATE every row of the other dealership | service_role | unrestricted | **`ROWS=2`** | **PASS** |

**`service_role` has `rolbypassrls = true` on production and on staging.**
Row-level security is *never consulted* for it. The permissive
`… to service_role using (true)` policies are decorative; the role would see
everything even if they were deleted.

Consequences, stated plainly:

- Every n8n workflow holding the service-role key can read **both dealerships'
  cost prices, customers, conversations and message logs**.
- A workflow with a missing or wrong `tenant_id` predicate writes into, or
  overwrites, the other dealership's rows. Test 8c did exactly that — `ROWS=2`
  against tenant B while nothing about the session named tenant B. The harness
  rolled it back. **On production nothing would roll it back.**
- Therefore: *every* isolation PASS in sections 1–7 applies only to the
  signed-in-user path (PostgREST / the dashboard / Ask-AI as a person).
  **None of it constrains n8n.** Tenant isolation for the workflow layer is not
  enforced by the database at all; it is enforced only by each workflow being
  written correctly.

---

## 9. The destructive-write guard

As `service_role`, `DELETE` with no tenant predicate at all.

| table | guarded on production? | expected | actual | verdict |
|---|---|---|---|---|
| `leads` | yes | refused | `ERROR P0001: NX900 DESTRUCTIVE_WRITE_REFUSED: public.leads is evidence, not scratch.` | **PASS** |
| `audit_log` | yes | refused | `ERROR P0001: NX900 DESTRUCTIVE_WRITE_REFUSED: public.audit_log …` | **PASS** |
| `customer` | **no** | not refused | `ERROR 23503` — blocked only incidentally, by a foreign key from `conversation` | **PASS** |
| `journey_step` | **no** | not refused | **`ROWS=4`** — both dealerships' journeys, in one statement | **PASS** |

The guard covers `leads`, `inventory`, `audit_log`, `communication_logs`,
`lead_event`, `tenants`. It does **not** cover `customer`, `conversation`,
`journey_step`, `users`, `tenant_members`, `processed_messages` or
`lead_ingest_endpoint`. `journey_step` took an unpredicated delete of all four
rows across both tenants without complaint; `customer` survived only because a
foreign key happened to point at it, which is luck, not a control.

---

## 10. `nexus_scoped_tenant_id()` with two active tenants

| # | test | as whom | expected | actual | verdict |
|---|---|---|---|---|---|
| 10 | `nexus_scoped_tenant_id()` | service_role | `(null)` | **`(null)`** | **PASS** |
| 10b | `nexus_default_tenant_id()` | service_role | the quarantine tenant | quarantine tenant id | **PASS** |
| 10c | `nexus_scoped_tenant_id()` | signed-in user A | tenant A id | tenant A id | **PASS** |

Read from the function body on production:

```sql
and (select count(*) from public.tenants w
      where w.status = 'active' and not w.is_quarantine) = 1
```

Production today holds exactly one active non-quarantine tenant (`alba-cars`)
plus one quarantine tenant, so the function returns ALBA CARS.

**The day dealership #2 is created with `status='active'`, that count becomes 2
and `nexus_scoped_tenant_id()` returns NULL for every `service_role` caller.**
It does not return the wrong dealership — it goes silent. Anything that calls it
without its own tenant argument stops resolving a dealership: the nightly syncs
and any Ask-AI path that runs as service_role rather than as a signed-in person.
Signed-in users are unaffected (10c) because their membership resolves first.

This is a designed fuse, and it will blow. It needs to be *converted* into an
explicit per-tenant argument before onboarding, not discovered at 02:00 when the
first nightly sync after go-live writes nothing.

`nexus_default_tenant_id()` as service_role resolves to the **quarantine**
tenant, so a service_role INSERT that omits `tenant_id` lands in quarantine
rather than in either dealership. Safe, and loud enough to notice.

---

## Supplementary — would the `WITH CHECK` clauses hold?

**This is not production's configuration.** Because the live grants make every
`WITH CHECK` unreachable (see 1–5), the suite temporarily widens
`INSERT/UPDATE/DELETE` to `authenticated` **on the staging harness only**, re-runs
the write matrix, then restores production's grant shape.

| # | test | expected | actual | verdict |
|---|---|---|---|---|
| S1 | UPDATE other's row | `ROWS=0` or refusal | `ROWS=0` throughout | **14/14 PASS** |
| S2 | INSERT with other's `tenant_id` | refused by `WITH CHECK` | `ERROR 42501: new row violates row-level security policy` on `customer`, `conversation`, `inventory`, `audit_log`, `communication_logs` | **14/14 PASS** |
| S3 | DELETE other's row | `ROWS=0` or refusal | `ROWS=0` throughout | **14/14 PASS** |
| S4 | re-tenant **own** row into the other dealership | refused, or `ROWS=0` | refused or `ROWS=0`; no row ever moved | **14/14 PASS** |

The `WITH CHECK` clauses **do** hold — the safety net is sound.

Two caveats, recorded rather than smoothed over:

- On `leads` and `journey_step` the S2 refusal was `permission denied for
  sequence`, i.e. the **sequence grant**, not the `WITH CHECK` clause. Those two
  tables have a `serial` primary key and the sequence privilege is reached first.
  **`WITH CHECK` on `leads` and `journey_step` remains UNPROVEN.**
- S4 on `audit_log` and `communication_logs` returned `ROWS=0` rather than a
  refusal, because `authenticated` has no `UPDATE` policy on those tables at all,
  so the statement matches nothing. Safe, but by absence rather than by a check.

---

## Deviations from production's schema

A harness that differs from production proves less than it appears to. Every
difference is listed.

| id | deviation | why | does it weaken the result? |
|---|---|---|---|
| **D1** | `tenant_members.auth_user_id → auth.users(id)` FK dropped | lets the suite use synthetic auth uuids without manufacturing `auth.users` rows | No. `auth.uid()` reads the JWT claim; no RLS decision consults `auth.users`. |
| **D2** | `conversation.integration_id → channel_registry` FK dropped | `channel_registry` is outside the named scope | No. Not a tenancy control. |
| **D3** | `lead_event`/`lead_ingest_endpoint` FKs to `lead_provenance_kind` and `lead_source_catalogue` dropped | lookup tables outside the named scope | No. Vocabulary constraints, not tenancy. The composite `(endpoint_id, tenant_id)` FK **is** reproduced. |
| **D4** | non-tenancy triggers not reproduced: `trg_assign_hot_lead`, `nexus_leads_owner_change_audit_trg`, `trg_comm_logs_first_response`, `journey_on_lead_event_promoted`, `lead_ingest_endpoint_touch_trg` | each depends on functions/tables outside scope | No. None is an isolation control. |

**Reproduced faithfully and verified identical:** all 13 tables' columns,
defaults, CHECK constraints, primary keys, unique indexes and partial unique
indexes; all 7 `nexus_*` tenancy functions plus `nexus_jwt_tenant_id`, copied
from `pg_get_functiondef`; **all 46 RLS policies copied verbatim from
`pg_policies`**; `relrowsecurity`/`relforcerowsecurity` flags; the full
production grant shape for `anon`/`authenticated`/`service_role`; the
`nexus_refuse_destructive_write` guard on exactly the six tables that carry it;
and the two genuine cross-tenant guard triggers `lead_event_guard_lead_tenant`
and `inventory_guard_cost_change`.

**No policy was invented.** Nothing in the harness exists that production lacks.

---

## What this suite CANNOT prove

Stated explicitly, because a green matrix invites over-reading.

1. **Nothing about the n8n workflows.** They run as `service_role`, which is
   `BYPASSRLS`. Section 8 measures that they see and write both tenants. Whether
   any individual workflow scopes its own queries correctly is untested here and
   cannot be tested here — it needs the n8n box, which was out of scope.
2. **Nothing about outbound messages.** No WhatsApp, email or Slack send was
   attempted. Whether dealership B's customer could receive dealership A's
   message is **NOT RUN**.
3. **Nothing about escalation routing.** Whether a hot lead for tenant B can page
   tenant A's manager is **NOT RUN**.
4. **Nothing about the application layer.** The dashboard, Ask-AI and the RAG
   retriever were not exercised. RLS holding at the database says nothing about a
   backend that queries with the service key — and per section 8, such a backend
   would see everything.
5. **Nothing about Storage, Realtime, or Edge Functions.** Only `public` schema
   tables were tested.
6. **Nothing about `lead_event` write paths.** `authenticated` has no grant on
   `lead_event`, so tests 2–5 there proved only that the door is shut, not that
   the promotion logic (`nexus_promote_lead_event`) scopes correctly.
7. **Nothing about production's actual data.** This ran against synthetic
   fixtures on staging. It proves the *rules* are right, not that the *existing
   rows* are correctly tenanted.
8. **`WITH CHECK` on `leads` and `journey_step`** — see the supplementary caveat.
9. **The non-`security_invoker` view path (6e)** — closed by a DDL guard, never
   executed.

---

## Where the fixtures live

**Not cleaned up, deliberately — re-run at will.**

Supabase staging `wwspuxrbiyagnrnzgate`, schema `public`:

- `tenants` — `zz-test-tenant-a` (`0a1a0000-0000-4000-8000-00000000000a`),
  `zz-test-tenant-b` (`0b1b0000-0000-4000-8000-00000000000b`), plus
  `__unattributed__` quarantine (`0c1c0000-0000-4000-8000-00000000000c`)
- members: A = `aaaa1111-1111-4111-8111-111111111111`,
  B = `bbbb2222-2222-4222-8222-222222222222`, both role `owner`
- every fixture row is prefixed `ZZ ` or `zz-`; emails are `@example.invalid`
- `zz_test_results` — the full matrix, one row per assertion
- `zz_fixture_key`, `zz_probe_cfg` — probe configuration
- `zz_scalar`, `zz_write_rb`, `zz_write_capture_rb`, `zz_assert`,
  `zz_record_notrun` — probe helpers
- `zz_v_inventory_invoker` — the `security_invoker` view used by test 6d

To re-run: execute **Part 4** of `two-tenant-suite.sql`. Every write probe rolls
back, so the fixtures are byte-for-byte unchanged after a run — verified: row
counts were identical before and after two full executions.

---

## Note on staging's state

Staging reported **zero tables and zero views** in `public` when this work began,
which is what the harness was built into. But
`supabase_migrations.schema_migrations` still lists **160+ NEXUS migrations**
(`stg_01_…` through the September series), including `stg_20_two_synthetic_tenants`
— so a full staging replica once existed there and its objects are gone while its
migration history remains. The `nexus_*` event triggers and their functions
survived. Nothing was dropped by this work: the `drop table if exists` at the top
of Part 1 ran against an already-empty schema. Flagging it because staging is not
the replica its migration history claims, and something that expects it to be one
will be surprised.

---

## The one-line verdict

The database's **signed-in-user** isolation is sound: 181 assertions, zero
failures, in both directions, across eight tables, including the cost-price leak
paths. The database's **workflow** isolation does not exist — `service_role` is
`BYPASSRLS` and n8n holds that key — and `nexus_scoped_tenant_id()` will return
NULL to every service_role caller the moment a second active tenant exists.
