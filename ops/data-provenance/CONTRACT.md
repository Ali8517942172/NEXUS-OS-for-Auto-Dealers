# The data-provenance contract

**Status: DESIGNED, NOT APPLIED.** Nothing in this folder has run against any
database. `held/` holds one worked migration deliberately kept out of
`supabase/migrations/`.

Every measurement this document rests on is in `MEASUREMENTS.md`, with the query.

---

## 1. The question this answers, and the one it does not

NEXUS must be able to say, of any number a dealer would act on, **how much of it
is the dealership's own business**. Today it cannot. On production, one of the
five `leads` rows is a NEXUS preflight test (`MEASUREMENTS.md` §5.1) and the
system's own origin view reports `is_test_traffic = false` for it
(§5.2). Twelve inventory units carry NEXUS-shaped ids and no attestation (§5.3).
One `purchase_history` row is the entire basis of "confirmed revenue AED 585,000"
and nobody can currently say where it came from (§5.4).

There is already a provenance vocabulary in this schema —
`lead_provenance_kind`, with `counts_as_real` — and it is good. It answers
**"which endpoint did this arrive at, and how was the sender authenticated?"**
That is a question about a *webhook*. This contract answers a different one:
**"is this row dealership business, or did we put it there?"** For the single
row on production where the two answers diverge, the existing field gives the
wrong one. The new field does not replace it and does not supersede it; the two
are joined in `RISKS.md` §6 where they can disagree.

This contract also does **not** answer "is this row correct". Attested ≠ true.

---

## 2. The four fields

The owner's shape is `data_origin`, `test_run_id`, `source_kind`, `created_by`.
Two of those four names are already occupied in this schema by columns meaning
something else (`MEASUREMENTS.md` §1). Reusing a taken name for a third meaning
is the same class of defect as `match_quality` — a reader who knows one meaning
will confidently apply it to the other — so two are renamed, with the collision
as the stated reason and nothing else changed.

| field | type | null? | default | note |
|---|---|---|---|---|
| `data_origin` | `text` | **not null** | `'UNKNOWN'` | FK → `data_origin_kind(origin)`. Owner's name, kept — measured zero collisions. |
| `test_run_id` | `uuid` | null | `null` | FK → `data_test_run(test_run_id)`. Owner's name, kept — zero collisions. |
| `origin_source_kind` | `text` | null | `null` | FK → `data_origin_source(source_kind)`. **Renamed** from `source_kind`, which already exists on `competitors` (`oem\|marketplace\|dealer\|unknown`) and on `policy_platform_attestation` (`PROVIDER_ACCOUNT_CONSOLE\|…`). |
| `origin_recorded_by` | `text` | null | `null` | **Renamed** from `created_by`, which exists on `tenant_member_invite` as a `uuid` FK to an auth user. This one names a *writer* — a person's staff id, or a harness name like `lead-simulator`. Different domain, so a different name. |

If the owner prefers the original two names, the correct move is to rename the
*existing* columns first — not to overload them. That is a bigger migration and
this design does not assume it.

### 2.1 `data_origin` — the values, and their exact meanings

Defined **once**, as rows in a table, never as a `CHECK (… in (…))` list and
never as a literal in a view, a setting or a screen. That is the whole point of
§5.

```
data_origin_kind (
  origin              text primary key,
  counts_as_real      boolean not null,
  is_test             boolean not null,
  requires_test_run   boolean not null,
  requires_attestation boolean not null,
  sort                smallint not null,
  description         text not null
)
```

| `origin` | `counts_as_real` | `is_test` | `requires_test_run` | `requires_attestation` | meaning |
|---|---|---|---|---|---|
| `UNKNOWN` | **false** | **false** | false | false | Nobody has said. The default, and by far the most common value for years. **Not real and not test** — a third state, and the reason `counts_as_real` and `is_test` are two booleans rather than one. |
| `REAL_ATTESTED` | true | false | false | **true** | A named person with `owner` or `admin` on this tenant has attested that this row records the dealership's own business, and an append-only attestation row exists saying who, when, and on what evidence. **The only value that makes a row count.** |
| `VENDOR_IMPORT_UNVERIFIED` | false | false | false | false | Bulk-loaded from a dealer system, CSV or DMS export. Real *in intent*; nobody has attested it row by row. Distinct from `UNKNOWN` because the import route is known. **Does not count.** This is what the twelve `NX-*` units most likely are, and "most likely" is why they will be written `UNKNOWN` and not this (§6). |
| `TEST_FIXTURE` | false | **true** | **true** | false | Written by a NEXUS test, preflight or QA run. Lead 121 is this. |
| `DEMO_SEED` | false | **true** | **true** | false | Written by a demo or sales fixture, e.g. `ops/demo/seed_demo_tenant.sql`. |
| `SIMULATED` | false | **true** | **true** | false | Produced by the marketplace or lead simulator. Aligns with `lead_provenance_kind.simulated`. |

Six values. **Three booleans, not one**, because the load-bearing distinctions
are three-way:

- `counts_as_real = true` — may be added into a number shown to a dealer.
- `is_test = true` — must be excluded, and *can be named as excluded*.
- neither — **UNKNOWN**. Must be reported as its own quantity. Folding UNKNOWN
  into "real" is the current behaviour and it is what puts a preflight in the
  team-performance table. Folding it into "test" is worse: it would delete the
  dealership's actual history from every screen on the day this ships.

**The rule, stated as the owner stated it:** default is `UNKNOWN`; `REAL_ATTESTED`
requires an explicit attestation event. There is no path by which the *absence*
of a test marker produces `REAL_ATTESTED`. A row nobody vouched for is UNKNOWN
forever, and every tile that sums it says so.

### 2.2 `origin_source_kind` — how the row physically got here

Also a table, `data_origin_source(source_kind, description)`, also FK-enforced,
and orthogonal to `data_origin`: `WEBHOOK`, `OPERATOR_FORM`, `BULK_IMPORT`,
`SCRAPER`, `NEXUS_DERIVED`, `SQL_CONSOLE`, `TEST_HARNESS`. A row may be
`REAL_ATTESTED` + `SQL_CONSOLE` (someone typed a real sale in by hand) — that is
a true and useful pair, and collapsing it into one enum would lose it.

### 2.3 `origin_recorded_by`

Free text, but not free-form: `staff:<users.id>` for a person, `harness:<name>`
for a test rig, `workflow:<workflow_registry.name>` for automation. Advisory
only — nothing is authorised by it. Authorisation is §4.

---

## 3. Scope: which tables, and why

Derived from measurement, not from judgement. `MEASUREMENTS.md` §4 counts, by
query over `pg_depend`, how many of the 39 dashboard views each base table
reaches — including through nested views, which a hand-count misses and did.

| table | dashboard views | carries | in scope |
|---|---|---|---|
| `leads` | **16** | `budget_aed`, and every lead **count** | **wave 1** |
| `purchase_history` | **11** | `amount_aed` — the AED 585,000 | **wave 1** |
| `inventory` | **7** | `cost_aed`, `price_aed`, margins, holding cost | **wave 1** |
| `communication_logs` | **11** | no money; drives response time, silence, enquiry coverage — and therefore every SLA and recovery count | **wave 2** |
| `finance_quotes` | 7 | 12 money columns, **0 rows today** | **wave 2** — the cheapest moment this table will ever be altered |
| `inventory_actions` | 5 | `engine_impact_aed`, `engine_gross_margin_aed`, `recovered_value_aed` | **wave 2** |
| `lead_recovery_actions` | 5 | `recovered_value_aed` | **wave 2** |
| `competitors` | 3 | `price_aed`, `price_diff_aed` → market position | **wave 2** |
| `whatsapp_contacts`, `kyc_documents`, `deals_embeddings`, `customer_360_profiles` | 1–3 each | counts only | wave 3 |
| `daily_metrics` | **0** — read directly by screens, not through a view | `pipeline_aed`, `holding_cost_aed` | **special — see below** |
| `audit_log` | 7 | none | **out of scope** — it is the evidence of what happened, including what happened during a test. Marking audit rows as test data makes the record of a test disappear from the record. |
| `tenants` (24 views), `users`, `tenant_members`, all `*_settings`, all `*_reason_codes`, `lead_source_catalogue`, `lead_provenance_kind`, `policy_*` | — | configuration and platform reference data | **out of scope** — these describe the system, not the dealership's business. `tenants` tops the dependency count precisely because it is the tenancy fence every view joins, which is the opposite of being a data table. |

**Wave 1 is `leads`, `purchase_history`, `inventory`.** Three tables, 18 rows in
total on production, reaching 16, 11 and 7 dashboard views, and carrying every
number the owner would be embarrassed to be wrong about.

`communication_logs` reaches 11 views and carries no money, which is exactly why
it is wave 2 and not wave 3: it decides response time and silence, and those
decide every recovery count. It is deferred only because 142 rows of message
history are harder to attest than 18 rows of business records, not because it
matters less.

`daily_metrics` is a special case and is called out rather than scoped: its 21
rows are **pre-aggregated snapshots** already summed over rows of unknown
provenance. A `data_origin` column on it would be a lie in either direction. The
honest treatment is `RISKS.md` §4: snapshots taken before the contract exists
are permanently ungradeable, and the fix is to stamp future snapshots with the
provenance mix they were computed from, not to grade the snapshot itself.

---

## 4. Who may set `REAL_ATTESTED`, and how

**Not the writer.** A row's own INSERT path cannot set `data_origin` to
`REAL_ATTESTED`. Attestation is a separate, later, human act with its own
record — modelled directly on `policy_platform_verify_rule`, which already
exists in this schema and does exactly this for policy rules
(`supabase/migrations/20260904071334_policy_platform_verification_path.sql`).

Three mechanisms, and all three are needed because each defeats a different
attack:

1. **Grants.** `authenticated` is never granted `INSERT` or `UPDATE` on any
   provenance column. It gets `SELECT` only. (Measured: `authenticated` today
   holds column `UPDATE` on 8 `leads` columns and `INSERT`/`UPDATE` on 9/8
   `inventory` columns — the provenance columns are simply not added to those
   lists.) This stops the dashboard.

2. **A `BEFORE INSERT OR UPDATE` row trigger**, `nexus_guard_data_origin()`.
   Grants do not restrain `service_role`, and every n8n workflow and every
   backend writer is `service_role` (`RISKS.md` §1). The trigger refuses any
   statement that sets `data_origin = 'REAL_ATTESTED'` unless
   `current_setting('nexus.attesting', true) = 'on'` — a transaction-local flag
   that only the attestation function sets. Created with `CREATE TRIGGER`, which
   does **not** fire `nexus_guard_born_open_grants` for any of its object types
   and therefore costs no grants.

3. **`nexus_attest_data_origin(p_table regclass, p_row_key text, p_origin text,
   p_evidence text, p_observed_on date)`** — `SECURITY DEFINER`, the only caller
   that sets the flag. It:
   - resolves the caller via `nexus_current_tenant_id()` and requires
     `tenant_members.role in ('owner','admin')` for the row's tenant — measured
     vocabulary: `owner, admin, manager, sales, technician, member`;
   - refuses if `p_evidence` is blank, and refuses `p_observed_on` in the future;
   - writes one append-only row to `data_provenance_attestation
     (attestation_id, tenant_id, table_name, row_key, origin, attested_by,
      attested_by_auth_user_id, attested_at, evidence, observed_on)`;
   - then, and only then, sets the column.

   Downgrades (`REAL_ATTESTED` → anything) go through the same function and are
   recorded the same way. Nothing is ever silently rewritten.

**A `service_role` writer that omits `data_origin` entirely gets `UNKNOWN`.**
That is the intended, safe outcome, and it is why the default is not `REAL`.

---

## 5. Where the vocabulary lives, and how a bad value fails loudly

This is the section written against `ops/f2-tenant-rule/RECONCILIATION.md`.

`match_quality` failed because the producer's vocabulary lived in a `--` comment
(`supabase/migrations/20260901042906_…:18`) and the consumer's lived in a column
default (`array['exact','strong']`). Two `text` columns, no relationship between
them, and Postgres had no opinion. The sets did not intersect, the filter
returned nothing for a week, and an empty result reads as *"the dealership has no
good data"* rather than *"these two ends do not speak the same language."*

Four defences, in order of how early they fire:

### 5.1 The producer cannot emit a value nobody defined — foreign key

Every provenance column is

```sql
data_origin text not null default 'UNKNOWN'
  references public.data_origin_kind(origin) on delete restrict
```

Writing `'REAL'`, `'real'`, `'PRODUCTION'` or `'exact'` fails at the moment of
the INSERT with SQLSTATE **23503** naming the constraint. Not a filtered-out
row — a failed write, in the caller's log, at the caller's line. This is the one
thing `match_quality` did not have. A `CHECK (… in (…))` would also refuse the
write but would put a second copy of the list in the catalogue; the FK keeps one
copy.

### 5.2 The consumer cannot name a value nobody defined — same foreign key

Any per-tenant setting that selects origins is `text[]`, and it is validated by
a `CREATE TRIGGER` constraint trigger — **not** an `ALTER TABLE … ADD CONSTRAINT`,
because arrays cannot carry an element FK, and because `CREATE TRIGGER` costs no
grants:

```sql
create constraint trigger data_origin_setting_vocabulary
  after insert or update on public.<settings table>
  for each row execute function public.nexus_guard_data_origin_setting();
-- raises 23514 naming every element of NEW.accepted_data_origin
-- that is absent from data_origin_kind
```

This is `RECONCILIATION.md`'s fix order item 2, applied at design time rather
than after the fact: **reject a configuration that names an impossible value —
cheap, rare, human, always a mistake.** Its asymmetric partner — never reject
*inbound data* for carrying an unfamiliar grade — does not arise here, because
there is no external producer of `data_origin`; every writer is ours.

### 5.3 An empty intersection is an error, not an empty result

The FKs make each end individually valid. They do **not** make the two ends
speak to each other: `{REAL_ATTESTED}` and `{TEST_FIXTURE}` are both perfectly
valid sets whose intersection is empty. `match_quality` would have passed both
checks above.

So the contract adds an invariant function, run in CI and callable on demand,
modelled on the existing `nexus_lead_ingest_invariants()`:

```sql
-- public.nexus_data_provenance_invariants() returns table(check_name text,
--   verdict text, detail text)
--
-- I1  every origin named in any setting exists in data_origin_kind
-- I2  for every consumer that filters on data_origin, the accepted set
--     INTERSECTS the set of origins that are actually WRITTEN anywhere:
--       select distinct data_origin from <each scoped table>
--     Empty intersection  -> verdict 'FAIL', not 'zero rows'.
-- I3  at least one origin in data_origin_kind has counts_as_real = true
--     and is reachable by the attestation function
-- I4  no scoped table has a data_origin value absent from data_origin_kind
--     (belt and braces; the FK should make this unreachable)
-- I5  every scoped table still carries its measured authenticated grants
--     (the ACL-guard regression check, per MIGRATION-PATTERN.md §5)
```

**I2 is the direct antidote.** Had it existed on `competitors`, it would have
said, on day one: *accepted set `{exact,strong}` intersects written set
`{exact_year,model_only,weak,null}` in zero values — FAIL*. Not "0 undercut
alerts". A named failing check with both sets printed.

### 5.4 The vocabulary must not be retyped into JavaScript

The FK does not reach `apps/executive-dashboard/`. Twenty-four screens are free
to hardcode `['REAL_ATTESTED']` and drift the day a seventh value is added —
this is the residual hole and `RISKS.md` §5 says so plainly.

The mitigation is a rule, not a mechanism: **no screen names an origin value.**
Screens read `counts_as_real` / `is_test` off a view that has already joined
`data_origin_kind`, exactly as `screens/competitors.js` reads
`v_competitor_latest` rather than re-deriving quality. A screen that needs the
list for a filter chip reads it from `data_origin_kind` over PostgREST, which is
already granted `SELECT` to `authenticated` for the sibling table
`lead_provenance_kind` today. A grep for a quoted origin literal under
`apps/` belongs in CI beside I1–I5.

---

## 6. Backfill: every existing row is genuinely UNKNOWN

`add column data_origin text not null default 'UNKNOWN'` sets every existing row
to `UNKNOWN` with no `UPDATE` statement and no scan-and-guess. That is not a
compromise; it is the true answer. Nobody attested any of the 18 wave-1 rows on
production, so `UNKNOWN` is what the database should say about all 18.

Three rules govern what may happen next.

**Downward attestation may cite a document; upward attestation may not.**
Lead 121 may be set to `TEST_FIXTURE` in the migration itself, by primary key,
citing `ops/pilot-readiness/BLOCKERS.md:123-125` and `CLAUDE.md:512` as evidence
— *"It is Ali's own preflight test."* Naming a row as ours is a claim we can
support from our own records. Naming a row as the dealership's is a claim only
the dealership can make, so **no migration ever writes `REAL_ATTESTED`.** The
twelve `NX-*` units stay `UNKNOWN` even though `VENDOR_IMPORT_UNVERIFIED` is
probably right, because "probably" is how the preflight got in.

**Adding the column changes no number.** Wave 1 is additive and no view is
touched. Consumers change in a separate, later migration, and that migration is
preceded by a census — `select data_origin, count(*), sum(<money>) from <table>
group by 1` — showing exactly what each tile would lose. Shipping the column and
the filter together would, on the day it landed, take the Sentinel from twelve
units to zero and read on screen as *"this dealership has no stock."* That is the
`match_quality` failure with the roles reversed, and it is avoided by ordering.

**Until enough rows are attested, screens report three numbers, not two.**
Real, test-excluded, and UNKNOWN — each with its own count and its own sum. The
UNKNOWN line is not an error state and not an empty state; on the day this ships
it is the whole dataset, and a dashboard that hides it is lying more than the
one we have now.

---

## 7. What a `test_run_id` binds together

One `uuid` per execution of one harness. Every row that execution writes, in
every table, carries the same value.

```
data_test_run (
  test_run_id uuid primary key,
  label       text not null,        -- 'walkin preflight 2026-09-07'
  harness     text not null,        -- 'ops/lead-simulator', 'ops/demo/seed_demo_tenant.sql'
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  torn_down_at timestamptz,
  note        text
)
```

It buys three things nothing else does:

- **Teardown that can be proved.** `delete from <t> where test_run_id = $1` per
  scoped table, then a census `select test_run_id, count(*)` that must return
  zero rows for that id. Today the equivalent is grepping for `.invalid`
  domains and `NX-` prefixes and hoping.
- **A blast radius.** "This test wrote 4 leads, 1 lead_event and 3 audit rows"
  is one query. Which is how you discover a harness wrote somewhere nobody
  expected.
- **Cross-table coherence.** A `TEST_FIXTURE` lead and the `TEST_FIXTURE`
  purchase attributed to it share an id, so a view can refuse to mix them with
  real rows *as a set* rather than row by row.

Enforced symmetrically, so neither half can drift:

```sql
constraint <t>_test_run_matches_origin check (
  (test_run_id is not null) =
  (data_origin in (select origin from data_origin_kind where requires_test_run))
)
```

— written in practice as a `CREATE TRIGGER` constraint trigger, because a
`CHECK` cannot contain a subquery. Same shape, same failure, no `ALTER TABLE`.

A test run that forgets to register itself gets **23503** on its first write.
A `TEST_FIXTURE` row with no run id is not representable. A `REAL_ATTESTED` row
carrying one is not representable either.
