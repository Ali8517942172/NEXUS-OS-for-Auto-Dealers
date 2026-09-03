# `architecture/` — read this first

## There is no schema file you can run. The database is the record.

**The authoritative description of the database is the live catalogue of Supabase
project `dsvuoovivysszdoiorch`, and nothing in this folder.** Migrations are
applied to that project and are listed in `supabase_migrations.schema_migrations`;
this repository holds no migration directory that mirrors them.

To see what the database is, query it:

```sql
select max(version), count(*) from supabase_migrations.schema_migrations;
```

Measured 2026-09-03 18:4x UTC: **`20260903180749`, 181 applied**, over **40 tables
and 33 views**.

## `schema.sql` is a stale transcription. Do not run it, and do not read it as current.

`schema.sql` was generated on **2026-09-02 05:01 UTC** against migration
`20260902050255`, when **81** migrations had been applied. **One hundred
migrations have landed since.** Its own header still says "THIS FILE IS
AUTHORITATIVE"; that sentence was true for a few hours on 2 September and is
false now. An earlier edition of this README called it "the schema of record"
and said it was "safe to run against the live project: it is a no-op". **Both
claims are now wrong, and the second one is dangerous** — the file predates the
entire multi-tenancy build and every engine schema, so running it against
production would be a partial replay of a much older database over a much newer
one.

Measured 2026-09-03 by grepping the file: it contains **zero** occurrences of
`tenants`, `tenant_members`, `policy_rule`, `inventory_actions`,
`lead_recovery_actions`, `deal_rescue_states`, `v_attribution_edges` or
`nexus_require_security_invoker_views`. It describes **16 tables and 9 views**
against **40 and 33** live. Everything tenancy, everything the five engine
screens read, and the event trigger that keeps views `security_invoker` are all
absent from it.

Keep it as a snapshot of 2 September if that is useful. **Do not paste it into a
SQL editor, and do not answer a question about the current schema from it.**
Regenerate it before relying on it, or ask the database.

## The two historical files. Do not run either.

### `supabase_schema.HISTORICAL.sql` — **dangerous**

Running it against the live project would (1) make the `inventory` table,
including `cost_aed` — what the dealership paid for each car — readable by anyone
holding the publishable anon key, and (2) install two triggers referring to a
column that does not exist, after which every update to `leads` and `inventory`
fails. Both effects were reproduced and confirmed on a local replica of the live
schema.

It also describes a `leads` table with columns this system has never had
(`first_name`, `last_name`, `phone_number`, `company`) and a status CHECK that
would reject every status the system actually uses (HOT / WARM / COLD /
DISQUALIFIED).

### `database_schema.HISTORICAL.sql` — wrong, but inert

It defines seven tables no component references (`customers`, `vehicles`,
`deals`, `campaigns`, `roles`, `user_profiles`, `document_embeddings`) and an
`audit_log` in a shape incompatible with the `{workflow, status, summary}` rows
every workflow posts. Because it uses bare `CREATE TABLE`, it aborts on the first
existing table, so pasting it into the Supabase editor applies nothing.

`document_embeddings` is worth naming separately, because the claim outlives the
file: **NEXUS has never used embeddings for Ask AI.** The RAG table is
`rag_documents`, and it is `tsvector` full-text plus `pg_trgm` trigram. There is
no `document_embeddings` table and no embedding column behind Ask AI. The one
`vector` column in the database is `deals_embeddings.embedding`, which nothing
reads.

## What is in this folder

| file | what it is | trust it? |
|---|---|---|
| `README.md` | this file | — |
| `DRIFT.md` | itemised: what the two historical files claim, what was live on 2026-08-30, and every contradiction. Also records two live defects found while checking. | **as history, yes; as a description of today, no** — see below |
| `schema.sql` | live catalogue transcribed 2026-09-02 05:01, 100 migrations behind | no |
| `supabase_schema.HISTORICAL.sql` | a database that has never existed | never run |
| `database_schema.HISTORICAL.sql` | a different database that has never existed | never run |
| `diagrams/System_Architecture.md` | the component diagram | yes, as corrected 2026-09-03 |

**`DRIFT.md` is dated 2026-08-30 and its own figures have moved.** Its analysis
of the two historical files is still correct and is the reason those files are
not run. Its "Live objects" and "Things that are true and worth knowing"
sections are a snapshot of 30 August: it inventories 16 tables and 6 views as the
whole of `public`, where there are now **40 tables and 33 views**, and it records
`anon` and `authenticated` holding `ALL`
privileges on every table in `public` — **that was closed on 2 and 3 September**
and `CLAUDE.md` carries the current position. Read DRIFT.md for the two SQL
files; read `CLAUDE.md` and the database for everything else.

Two live defects DRIFT.md reported have since moved and the file does not say so:
`nexus_lead_for_comm_key()`'s uuid/integer return mismatch (defect A) and
`capture_daily_metrics()` counting all-time audit rows into a per-day table
(defect B). `NEXUS_INVARIANTS.md` carries the current state of both.

## Where the current record actually lives

* **The database** — the only authoritative schema.
* `CLAUDE.md` — tenancy, grants, the open webhook, and the house rules.
* `NEXUS_INVARIANTS.md` — INV-001..INV-008 with the query that proves each.
* `PRODUCT.md` — what the product is, and which engines the data supports.
* `apps/executive-dashboard/QUALITY_GATE.mjs` — the executable version of several
  of these claims. Its live lane (`L1`..`L10`) reads the catalogue directly, and
  `L1` fails precisely when an embedded schema snapshot has drifted from live.
