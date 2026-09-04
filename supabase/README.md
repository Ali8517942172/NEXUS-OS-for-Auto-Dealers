# `supabase/` — the database, as a thing the repository owns

Until 4 September 2026 this repository could not rebuild its own database.
`architecture/README.md` said so in as many words — *"There is no schema file you
can run. The database is the record."* — and it was right. 243 migrations
existed in exactly one place, Supabase project `dsvuoovivysszdoiorch`. If that
project had been lost, the schema was gone.

That sentence is now false. This folder is why.

## What is here

| path | what it is | generated? |
|---|---|---|
| `migrations/` | 243 files, one per row of `supabase_migrations.schema_migrations`, each containing the statements production actually applied, **verbatim** | yes — `tools/extract-migrations.mjs` |
| `baseline/00000000000000_baseline.sql` | the schema of production at version `20260904090150`, read out of the live catalogue | yes |
| `baseline/00000000000001_migration_history.sql` | stamps the 243 versions into `supabase_migrations.schema_migrations` so a restored project knows what it already has | yes |
| `baseline/00000000000002_vocabulary_seed.sql` | the shipped vocabulary — reason codes, state models, units, jurisdictions. **Not** dealership data | yes |
| `tools/extract-migrations.mjs` | re-reads the history and rewrites `migrations/` | — |
| `sentinel/`, `2026-08-14_*.sql`, `create_missing_tables.sql` | pre-existing loose SQL, unrelated to this, left alone | — |

**Nothing in `migrations/` or `baseline/` is hand-written, and none of it should
be hand-edited.** Regenerate instead. The repository already has one monument to
a hand-maintained schema file — `architecture/schema.sql`, which still calls
itself `AUTHORITATIVE` while sitting a hundred migrations behind — and the whole
point of this folder is to not build a second one.

## The honest position: the recorded chain does NOT replay from empty

This is the thing to understand before trusting anything here, and it was
measured rather than assumed.

Replaying all 243 recorded migrations, in version order, into an empty
PostgreSQL 17 carrying a Supabase-shaped harness: **47 applied, 196 failed.**

The reason is the first migration. `20260717130052_enable_rls_all_tables.sql` is:

```sql
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
```

The tables predate the migration chain. Nothing in the chain creates `leads`,
`inventory`, `audit_log`, `users` or `competitors`, so the first migration fails
and 162 of the 196 failures are the cascade from that one fact: *relation
"X" does not exist*. `migrations/` is a faithful record of **what was applied**.
It is not, and cannot be made into, a build-from-nothing script.

**So the restore path is the baseline plus the chain from a known point.** That
is not a workaround; for a database whose history begins after its tables do, it
is the only correct answer.

## How to restore from nothing

Into a **new Supabase project** (the expected case — the platform gives you the
`anon` / `authenticated` / `service_role` / `supabase_admin` roles, the `auth`
schema, `auth.uid()`, `pg_cron` and `supabase_vault`):

1. `baseline/00000000000000_baseline.sql` — schema.
2. `baseline/00000000000001_migration_history.sql` — history stamp.
3. `baseline/00000000000002_vocabulary_seed.sql` — shipped vocabulary.
4. Every file in `migrations/` whose version is **greater than `20260904090150`**
   (the version stamped in the baseline's first line). Today that is none.
   `supabase db push` will do exactly this and skip the rest, because step 2
   told the project it already has them.
5. Re-create the one scheduled job, which is neither schema nor data:
   `select cron.schedule('nexus-daily-metrics', '50 19 * * *', 'select public.capture_daily_metrics();');`
   Section 22 of the baseline carries this and says why omitting it fails
   silently.

**A restored database has no dealership data.** No `tenants` row, no leads, no
inventory, no `workflow_registry`. That is deliberate — see below — and it means
a restore gets you a working NEXUS, not this dealership's NEXUS.

Into a **bare Postgres** (for testing): stand up the platform first. The harness
used to verify everything below is reproduced at the end of this file.

## Why there is a vocabulary seed, and why a schema-only baseline is not enough

A schema-only baseline looked correct and was not. Replaying the chain onto a
catalogue-derived baseline carrying the schema and no rows,
`20260904024105_wapolicy_02_intent_catalogue_and_platform_rules` failed:

```
ERROR: insert or update on table "policy_rule"
       violates foreign key constraint "policy_rule_rule_type_fkey"
```

…and `20260904025050_wapolicy_04_close_default_grants` failed after it, on an
object the first one would have created. This system keeps its vocabulary in
**tables**, and migrations `INSERT` against that vocabulary. Seeding
`policy_rule_type` alone moved the failure to `policy_unit` (`Key (unit)=(HOURS)
is not present`). With the full vocabulary seed applied, **both migrations
apply.** That is the whole argument for file 3 existing.

The line between the two kinds of rows is the one `CLAUDE.md` already draws:

* **In the seed** — shipped product vocabulary, identical for every dealership:
  `policy_rule_type`, `policy_unit`, `policy_jurisdiction`,
  `attribution_*_type`, `lead_recovery_*`, `deal_rescue_*`,
  `inventory_action_reason_codes`, `channel_*` capability and send forms,
  `tenant_capability_catalogue`, `tenant_configuration_default`,
  `whatsapp_message_intent`. 19 tables.
* **Not in the seed** — `tenants` (the dealership's own identity) and
  `workflow_registry`, which holds this box's real n8n workflow ids, trigger
  detail and `is_active` flags. `CLAUDE.md` calls that operational
  configuration, not shipped vocabulary, and it is the subject of a live
  tenancy finding. Plus every tenant-scoped table.

## What was verified, and how

Everything below was run. None of it is inferred.

**The extraction is byte-exact.** The 243 files total 1,629,767 bytes, which is
exactly `sum(octet_length(statements[1]))` on production. Independently, a
per-migration md5 rollup computed locally over the files and by Postgres over
the table both give `a1b46b16897559f7ea60bf27ea176bd2`. Loading the files back
into a fresh `schema_migrations` table reproduces the same rollup a third time.

**The baseline reproduces production.** A fingerprint query — 25,867 lines
covering columns, constraints, indexes, views, function bodies, triggers, event
triggers, RLS flags, policies, and *effective* privileges for `anon`,
`authenticated` and `service_role` at table, column and function level, plus
default privileges — was run against production and against a database built
from `baseline/` alone:

| | production | restored | differing |
|---|---|---|---|
| columns | 1736 | 1736 | 0 |
| constraints | 356 | 356 | 0 |
| indexes | 167 | 167 | 0 |
| views | 39 | 39 | **2** |
| function bodies | 110 | 110 | 0 |
| triggers | 17 | 17 | 0 |
| event triggers | 1 | 1 | 0 |
| RLS flags | 59 | 59 | 0 |
| policies | 161 | 161 | 0 |
| table privileges | 2076 | 2076 | 0 |
| **column privileges** | 20724 | 20724 | 0 |
| function privileges | 330 | 330 | 0 |
| default privileges | 84 | 84 | 0 |

The ACL-only fingerprint — 23,214 privilege facts — is identical on both sides:
`d5c270e430811e523ca1719b1fa3d277`.

The **two** differing lines are one view, `v_inventory_profit_sentinel`, and
they are a `pg_get_viewdef` artifact, not a difference: production deparses a
`UNION ALL` branch as `'message'::text` and the round-tripped copy as
`'message'::text AS text`. Normalising that one redundant alias label makes the
definitions identical, and the view's output columns and types already matched
exactly. It changes nothing — a non-first `UNION` branch does not name the
view's columns — but it is written down here rather than swept up, because "one
line differs" is the kind of thing that should be explained and not rounded to
zero.

**Column-level grants survive.** Production genuinely uses them:
`channel_registry.credential_ref` is granted to `service_role` and **not** to
`authenticated`, while its sibling columns are. A `relacl`-only dump loses that
distinction silently. All 20,724 column-privilege facts match.

**The forward path works.** Applying the repo's migration files for versions
after a catalogue-derived baseline taken at an earlier point: 53 of 55 applied
directly, and the remaining 2 applied once the vocabulary seed was present —
**55/55**, with the failure diagnosed to a specific FK and proven by fixing only
that.

**The repo's own auditor passes against the replica.** Pointing
`QUALITY_GATE.mjs` at a database built only from `baseline/`, its live lane
returns **PASS on L3, L4, L5, L6, L7, L8, L9 and L10** — security_invoker on
every view, no cross-tenant SECURITY DEFINER write, no `anon` EXECUTE, and the
engine invariants. L1 and L2 fail there for reasons that are not about the
baseline and are recorded in the findings section below.

## How this is kept from going stale

This is the part that decides whether the folder is worth anything in a month.

**The mechanism is a gate check, not a schedule.** A migration applied through
the Supabase MCP tool writes a row to `supabase_migrations.schema_migrations`
and writes nothing here, so drift is silent and unbounded. A scheduled
re-extraction does not fix that — it produces a fresher file that nobody read,
which is precisely how `architecture/schema.sql` came to say "THIS FILE IS
AUTHORITATIVE" while a hundred migrations behind. A schedule cannot fail a
release. A check can, and a check gets answered because it is in the way.

So: **`QUALITY_GATE.mjs` check `L11`** reads `schema_migrations` and compares it
with this folder — versions the database has and the repo does not, bodies that
are not byte-identical, names that disagree, and whether a baseline exists at
all. Its sibling `L11b` warns about a file the database has never applied, and
`L11c` warns when the database records migrations with no bodies (the shape of a
*restored* database, which is not a source to extract from).

`L11` is **P1, deliberately.** That file's P0 bar is "would put a wrong number,
or another dealership's data, in front of a paying customer". A repository that
has fallen behind does neither; it is a business-continuity risk, not a
customer-facing one, and widening P0 to cover it would make P0 mean less for
every check that is about a customer. So it FAILS — visibly, in the tally, at
the top of the report — without blocking the exit code. **If the owner decides
losing the ability to rebuild the database should stop a release, change
`L11_SEV` from `'P1'` to `'P0'`. Nothing else needs to change.**

The fix when it fails is mechanical:

```bash
NEXUS_DB_URL=postgres://…  node supabase/tools/extract-migrations.mjs
git add supabase/migrations && git commit
```

`--check` does the same comparison, writes nothing, and exits 1 on
disagreement — the form to put in front of a commit or in CI.

**Regenerating the baseline is a bigger job and is not automated.** It is a
long catalogue-dump query, and it should be re-run when the chain since the
baseline gets long enough that replaying it is slower than restoring, or before
any real disaster-recovery rehearsal. The current baseline's provenance is in
its own header. When you regenerate it, re-run the fingerprint comparison; a
baseline nobody diffed against production is a claim, not a check.

## Known deviations, recorded rather than fixed

Found while doing this. Nothing here was written to either database.

1. **`anon` still gets ALL on new tables through the `supabase_admin` default-
   privilege line.** Production's `pg_default_acl` carries two lines. The
   `postgres` line has had `anon` removed — that is the 2 September closure. The
   `supabase_admin` line has not: `anon` holds DELETE, INSERT, MAINTAIN,
   REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on tables created in `public`
   **as `supabase_admin`**, plus sequences and functions. Tables created by the
   MCP tool run as `postgres` and are safe; a table created through the
   dashboard as `supabase_admin` is not. The baseline reproduces this faithfully
   (section 21) and says in its own comment that it is doing so because it is
   true, not because it is right.

2. **Two new `L2` rows.** Against the replica, `L2` names
   `policy_jurisdiction` and `policy_platform_attestation` alongside the already
   documented `workflow_registry` — both `SELECT USING(true)` for
   `authenticated`, both added by the 4 September jurisdiction work. `CLAUDE.md`
   currently documents only `workflow_registry`.

3. **`QUALITY_GATE.mjs`'s embedded `SNAPSHOT` is stale.** Its `takenAt` is
   3 September and it does not know `channel_message_events`,
   `channel_registry`, `channel_send_form`, `channel_provider_capability`,
   `channel_provider_rank`, `channel_send_directive` or the other 4 September
   tables, so `L1` fails against production too — not only against the replica.
   Fixed by `node QUALITY_GATE.mjs --refresh-schema` with a connection. Not done
   here: `--refresh-schema` rewrites the snapshot block in place, and this change
   was required to leave every existing check exactly where it was.

## The harness the verification ran against

A bare Postgres is not a Supabase project. To make a replay fail on NEXUS's own
SQL rather than on the absence of the platform, the verification above created,
on PostgreSQL 17 (production is 17.6):

* roles `anon`, `authenticated`, `service_role` (BYPASSRLS), `authenticator`,
  `supabase_admin`, `supabase_auth_admin`, `dashboard_user`;
* schemas `extensions`, `auth`, `graphql_public`, `storage`, `realtime`;
* extensions `pgcrypto` and `uuid-ossp` in `extensions`, `pg_trgm` and `vector`
  in `public`;
* `auth.users`, and `auth.uid()` / `auth.jwt()` / `auth.role()` reading
  `request.jwt.claims`;
* both stock Supabase default-privilege lines — `FOR ROLE postgres` and
  `FOR ROLE supabase_admin` — granting ALL in `public` to the three roles, so
  that the baseline's revokes are actually exercised rather than assumed.

`pg_cron`, `supabase_vault` and `pg_stat_statements` are not installable in that
environment and are not needed: `pg_depend` records **zero** non-extension
dependencies on any of the three. The baseline names them in section 22 instead
of running them.

**Version matters.** PostgreSQL 16 cannot apply this baseline — production uses
the `MAINTAIN` privilege, which is PostgreSQL 17 and later. Verify on 17.
