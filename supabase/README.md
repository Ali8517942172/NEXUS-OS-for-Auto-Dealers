# `supabase/` — the database, as a thing the repository owns

Until 4 September 2026 this repository could not rebuild its own database.
`architecture/README.md` said so in as many words — *"There is no schema file you
can run. The database is the record."* — and it was right. The 255 migrations
that existed then lived in exactly one place, Supabase project
`dsvuoovivysszdoiorch`. If that project had been lost, the schema was gone.
(There are **273** as of 5 September; the count moves, the argument does not.)

That sentence is now false. This folder is why.

## What is here

| path | what it is | generated? |
|---|---|---|
| `migrations/` | **273** files, one per row of `supabase_migrations.schema_migrations`, each containing the statements production actually applied, **verbatim** | yes — `tools/extract-migrations.mjs` |
| `baseline/00000000000000_baseline.sql` | the schema of production at version `20260904142907`, read out of the live catalogue | yes — `tools/generate-baseline.mjs` |
| `baseline/00000000000001_migration_history.sql` | stamps the **255 versions up to and including the baseline's own version** into `supabase_migrations.schema_migrations`, so a restored project knows what it already has. The 18 later ones are files, not stamps — that is the point of step 4 below | yes |
| `baseline/00000000000002_vocabulary_seed.sql` | the shipped vocabulary — reason codes, state models, units, jurisdictions. 190 rows across 19 tables. **Not** dealership data | yes |
| `tools/extract-migrations.mjs` | re-reads the history and rewrites `migrations/` | — |
| `tools/generate-baseline.mjs` | re-reads the catalogue and rewrites the baseline | — |
| `tools/verification-harness.sql` | the Supabase-shaped scaffolding a bare Postgres needs before any of this can be replayed or checked | — |
| `sentinel/`, `2026-08-14_*.sql`, `create_missing_tables.sql` | pre-existing loose SQL, unrelated to this, left alone | — |

**Nothing in `migrations/` or `baseline/` is hand-written, and none of it should
be hand-edited.** Regenerate instead. The repository already has one monument to
a hand-maintained schema file — `architecture/schema.sql`, which still calls
itself `AUTHORITATIVE` while sitting a hundred migrations behind — and the whole
point of this folder is to not build a second one.

## The honest position: the recorded chain does NOT replay from empty

This is the thing to understand before trusting anything here, and it was
measured rather than assumed.

Replaying all recorded migrations, in version order, into an empty PostgreSQL 17
carrying a Supabase-shaped harness: **47 applied, 196 failed** (measured at 243
migrations; nothing since changes the argument).

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
4. Every file in `migrations/` whose version is **greater than `20260904142907`**
   (the version stamped in the baseline's first line). **Measured 5 September
   2026: that is 18 files, 106,698 bytes** — `20260905192903` through
   `20260905211435`, the whole of that evening's constraint, tenancy-quarantine,
   role-model and message-identity work. It was none on 4 September and it will
   not stay 18; count it rather than quoting this line.
   `supabase db push` will do exactly this and skip the rest, because step 2
   told the project it already has them.
5. Re-create the one scheduled job, which is neither schema nor data:
   `select cron.schedule('nexus-daily-metrics', '50 19 * * *', 'select public.capture_daily_metrics();');`
   Section 22 of the baseline carries this and says why omitting it fails
   silently.

**Steps 1 and 2 have to move together, and step 4 is not optional.** The
baseline carries the effects of the 4 September migrations, so a history stamp
that still claimed only 243 versions would send `supabase db push` off to replay
twelve migrations whose work is already in the file — and several of them
(`drop constraint`, `drop index`) would fail on the second application. Both
files are regenerated together or neither is. Equally: the baseline is **18
migrations behind production** as of 5 September, so a restore that stops after
step 3 rebuilds the database *without* the policy-citation foreign key, the
quarantine tenant, the staff role model and the message identities. Steps 1–3
are not a restore on their own any more.

**A restored database has no dealership data.** No `tenants` row, no leads, no
inventory, no `workflow_registry`. That is deliberate — see below — and it means
a restore gets you a working NEXUS, not this dealership's NEXUS.

Into a **bare Postgres** (for testing): stand up the platform first with
`tools/verification-harness.sql`, which is the harness every number below was
measured against.

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
  `whatsapp_message_intent`. 19 tables, 190 rows.
* **Not in the seed** — `tenants` (the dealership's own identity) and
  `workflow_registry`, which holds this box's real n8n workflow ids, trigger
  detail and `is_active` flags. `CLAUDE.md` calls that operational
  configuration, not shipped vocabulary, and it is the subject of a live
  tenancy finding. Plus every tenant-scoped table.

## What was verified, and how

Everything below was run. None of it is inferred.

**The extraction is byte-exact. Re-measured 5 September 2026, after that
evening's eighteen further migrations.** The **273** files total
**1,809,043 bytes**, which is exactly `sum(octet_length(statements[1]))` on
production. Independently, a per-migration md5 rollup — `md5` over
`version:md5(body)` lines in version order, newline-joined with no trailing
newline — computed locally over the files and by Postgres over the table both
give `4f9bd21234f8cfe6079184432d6120ad`. `ls migrations | wc -l` is **273**,
`select count(*) from supabase_migrations.schema_migrations` is **273**, and
`max(version)` is `20260905211435` on both sides.

The figures this paragraph carried before — 255 files, 1,702,345 bytes, rollup
`3946a4fe5fdfed86041e83cbd6a0eb91` — were true on 4 September and are recorded
here because a rollup that changes is the mechanism working, not a defect.

The twelve migrations of 4 September were the ones missing, 72,578 bytes of
them, and they are the whole of that day's security and consent hardening:
the control-plane revokes, the born-open default-ACL closure and its guard, the
five consent-identity P0s, and the schema-door closure. Each was fetched as
base64, decoded, and checked against the recorded `octet_length` and `md5`
before and after being written to disk.

**The migration history stamp matches the table, for the versions it covers.**
The stamp holds the **255** `(version, name)` pairs up to the baseline's own
version `20260904142907` — not all 273, deliberately, because the later 18 are
step 4's job. Re-measured 5 September: `md5` over `version|name` joined by
newline in version order gives `8d5ecffc85e7d8c12848cf9c2b092a49` from the file,
and the identical value from production over
`where version <= '20260904142907'`. The gate's own `L12` offline arm published
the same digest independently.

One correction rather than a silent overwrite: this paragraph previously
published `7a5968e5668b6b64a1ebe255a3773bdc` for the same claim. That value
**could not be reproduced** on 5 September from the stamp file or from
production under any separator tried, over either 243 or 255 pairs. The digest
above is the one that was measured on both sides today; the older one is
unverified and should not be quoted.

**The baseline reproduced production at the version it was taken from.**
Measured 5 September 2026 against production **as it stood at
`20260904142907`**. Production has since applied 18 more migrations, so the
left-hand column below is a record of that comparison and not a description of
production today — for today's catalogue, read the paragraph after the table.
A fingerprint query covering columns,
constraints, indexes, views, function bodies, triggers, event triggers, RLS
flags, policies, and *effective* privileges for `anon`, `authenticated` and
`service_role` at schema, table, column and function level, plus default
privileges, was run against production and against a database built from
`tools/verification-harness.sql` and `baseline/00000000000000_baseline.sql`
alone:

| | production | restored | result |
|---|---|---|---|
| columns | 1737 | 1737 | identical |
| constraints | 359 | 359 | identical |
| indexes | 168 | 168 | identical |
| views | 39 | 39 | **1 view differs, see below** |
| function bodies | 113 | 113 | identical |
| triggers | 17 | 17 | identical |
| event triggers | 8 | 2 | the 2 NEXUS guards are identical; 6 are platform |
| RLS flags | 59 | 59 | identical |
| policies | 159 | 159 | identical |
| table privileges | 2352 | 2352 | identical |
| **column privileges** | 20736 | 20736 | identical |
| function privileges | 339 | 339 | identical |
| default privileges | 27 | 9 | the 9 `public` + `storage` lines are byte-identical; 18 are platform |
| schema privileges on `public` | 10 | 10 | identical (`6d08e639a19a897753246dd313307943` both sides) |

The **event trigger** and **default privilege** counts differ because production
is a real Supabase project and carries platform objects the baseline is not
responsible for and must not invent: `pgrst_ddl_watch`, `pgrst_drop_watch`,
`issue_pg_cron_access`, `issue_pg_graphql_access`, `issue_pg_net_access`,
`issue_graphql_placeholder`, and default-ACL lines for `auth`, `realtime`,
`graphql_public` and friends. The objects the baseline *does* own match exactly:
both `nexus_guard_born_open_grants` and `nexus_guard_security_invoker_views`,
and all nine `postgres`/`supabase_admin` default-ACL lines for `public` and
`storage`.

**What production carries today, and therefore how far the baseline is behind.**
Re-measured 5 September 2026 after the evening's eighteen migrations: **59
tables, 39 views (39 of 39 `security_invoker`), 269 functions in `public`, 374
constraints, 169 indexes, 163 policies, RLS on 59 of 59 tables.** Set against
the table above, that is the size of the gap step 4 of the restore path closes.
Regenerating the baseline would move it; that has not been done, and this
paragraph exists so nobody reads the table above as current.

One further difference is recorded rather than rounded away: `pg_namespace.nspacl`
on `public` contains the **same fifteen entries** on both sides, in a different
array **order**, because array order records the order the grants were made. The
effective answer — the `has_schema_privilege` digest in the table above — is
identical, so this is a difference in how the fact is stored, not in the fact.

The **one differing view** is `v_inventory_profit_sentinel`, and it is the same
`pg_get_viewdef` artifact recorded here in the previous generation, unchanged:
production deparses a `UNION ALL` branch as `'message'::text` (33,906 bytes) and
the round-tripped copy as `'message'::text AS text` (33,914 bytes). A non-first
`UNION` branch does not name the view's columns, so the view's output columns and
types are identical; the other 38 views match byte for byte.

**Column-level grants survive.** Production genuinely uses them:
`channel_registry.credential_ref` is granted to `service_role` and **not** to
`authenticated`, while its seven sibling columns are. A `relacl`-only dump loses
that distinction silently. All 20,736 column-privilege facts match.

**The vocabulary seed matches production, row for row.** All 19 tables, 190 rows,
compared with a collation-independent digest (`md5` over the sorted list of
per-row `md5`s) on both sides. Identical.

**The generator reproduces its own output.** Running
`tools/generate-baseline.mjs` against the verified replica emits a file that is
byte-identical to `baseline/00000000000000_baseline.sql`
(`334b0b1cbfa15fe0e27c1f424323f1b4`, 777,711 bytes).

### The security posture the baseline is there to preserve

The previous baseline was taken at `20260904090150`, hours before that
afternoon's work. Restoring from it would have rebuilt the database **with the
born-open grants and the open schema door** — the precise failure the twelve
missing migrations exist to close. That is the reason this folder was regenerated
rather than merely topped up.

Measured on production and on a database restored from the new baseline alone.
Both columns are the same query:

| claim | production | restored |
|---|---|---|
| `anon` holds `USAGE` on schema `public` | `false` | `false` |
| tables `authenticated` may write | `inventory, leads` | `inventory, leads` |
| `channel_registry` columns granted to `authenticated` | 7 | 7 |
| …`credential_ref` among them | `false` | `false` |
| views total / lacking `security_invoker` | 39 / 0 | 39 / 0 |
| event triggers owned by `postgres` | the two NEXUS guards | the two NEXUS guards |
| objects in `public` reachable by `anon` | 0 | 0 |

Section 15 of the baseline is the load-bearing one. The previous generation
granted `USAGE ON SCHEMA public` to `PUBLIC` **and** to `anon`; this one revokes
both and grants it back to eleven named roles, which is what production holds.
Without `USAGE` on the schema, no object ACL inside it is reachable — including
objects that do not exist yet, whichever path creates them. That is what
contains the `supabase_admin` default-ACL line recorded below, which `postgres`
still cannot alter.

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

**`L11` watches `migrations/`; `L12` now watches the baseline.** For one
afternoon nothing watched it, and that gap cost something. The twelve migrations
of 4 September were recorded in the database and absent from `migrations/`,
which `L11` is built to catch; but the *baseline* had gone stale on the same
afternoon, and no check looked at it at all. Worse, the vocabulary seed had been
written out HTML-escaped, and every row count still matched — because counting
rows is not reading them. `L12` compares the seed with the live rows **by
value**, re-runs `generate-baseline.mjs` and diffs it byte for byte, and at its
strongest replays the whole folder into an empty PostgreSQL 17 and regenerates
from the replica. Validated against a deliberately re-escaped seed: every row
count stays identical and three digests change. A baseline one day behind is not
a nuisance — for one afternoon it was the difference between
restoring a database with the schema door shut and restoring one with it open.
Regenerating is now a script rather than a remembered query:

```bash
GEN_CONN='-h HOST -p PORT -U postgres' GEN_DB=DBNAME \
  node supabase/tools/generate-baseline.mjs > supabase/baseline/00000000000000_baseline.sql
```

and the history stamp must be regenerated in the same commit. **Re-run the
fingerprint comparison afterwards**; a baseline nobody diffed against production
is a claim, not a check.

## Known deviations, recorded rather than fixed

Found while doing this. Nothing here was written to either database.

1. **`anon` still gets ALL on new tables through the `supabase_admin` default-
   privilege line.** Production's `pg_default_acl` carries three lines that
   matter. The `postgres` lines for `public` and `storage` have had `anon`
   removed — the 2 and 4 September closures. The `supabase_admin` line has not:
   `anon` holds DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE,
   UPDATE on tables created in `public` **as `supabase_admin`**, plus sequences
   and functions. `postgres` cannot alter that line (42501, re-proved 4
   September) and cannot revoke a grant it did not make. The baseline reproduces
   it faithfully (section 21) and says in its own comment that it is doing so
   because it is true, not because it is right.
   **What now contains it is the closed schema door**, not the ACL: with `anon`
   holding no `USAGE` on `public`, an object born open through that line is
   still unreachable. That is why section 15 must never be "fixed" by granting
   `anon` back.

2. **The two `L2` rows recorded in the previous generation are now closed.**
   `policy_jurisdiction` and `policy_platform_attestation` were `SELECT
   USING(true)` for `authenticated`; `20260904112412` revoked both, including the
   ten `pg_attribute.attacl` column grants on the attestation table that a
   `relacl`-only check could not see. `workflow_registry` remains the one
   documented `L2` row.

3. **`QUALITY_GATE.mjs`'s embedded `SNAPSHOT` was stale. Closed 5 September
   2026.** It was taken 3 September and did not know `channel_message_events`,
   `channel_registry`, `channel_send_form`, `channel_provider_capability`,
   `channel_provider_rank`, `channel_send_directive` or the other 4 September
   tables, so `L1` failed against production as well as against a replica. It
   was regenerated from production at `2026-09-05T20:56:16Z`, 98 relations,
   with `NEXUS_SNAPSHOT_SOURCE_NOTE` making the run write its own provenance
   rather than somebody typing it in later.

4. **The 4 September vocabulary seed had HTML-escaped text, and it has been
   repaired.** The generation of that file passed its free text through an
   HTML-escaping step, so twenty characters were stored as entities rather than
   as themselves — 11 × `&gt;`, 6 × `&lt;`, 3 × `&amp;`. A restore seeded
   `purchase_history.lead_id -&gt; leads(id)` into `attribution_link_basis`,
   and the same corruption into six other vocabulary tables, where production
   holds `->`. **Row counts always matched, which is exactly why it survived the
   first pass** — only free-text columns (`description`, `finding`, `meaning`,
   `snippet`) were wrong, and nothing that has a key or a foreign key was
   affected. The entities were decoded and all 19 tables were then re-compared
   against production; they now match. `migrations/` and the baseline were
   checked for the same corruption and have none.

## The harness the verification ran against

A bare Postgres is not a Supabase project. To make a replay fail on NEXUS's own
SQL rather than on the absence of the platform, the verification above created,
on PostgreSQL 17 (production is 17.6) — this is now
`tools/verification-harness.sql` rather than a listing to retype:

* roles `anon`, `authenticated`, `service_role` (BYPASSRLS), `authenticator`,
  `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin`,
  `supabase_realtime_admin`, `supabase_replication_admin`,
  `supabase_read_only_user`, `supabase_etl_admin`, `supabase_privileged_role`,
  `dashboard_user`, `pgbouncer` — the last eleven because the 4 September
  schema-door migration grants `USAGE` to them by name;
* schemas `extensions`, `auth`, `graphql_public`, `storage`, `realtime`;
* extensions `pgcrypto` and `uuid-ossp` in `extensions`, `pg_trgm` and `vector`
  in `public` (the baseline creates the last two itself);
* `auth.users`, and `auth.uid()` / `auth.jwt()` / `auth.role()` reading
  `request.jwt.claims`;
* all three stock Supabase default-privilege lines — `FOR ROLE postgres` in
  `public` and in `storage`, and `FOR ROLE supabase_admin` in `public` —
  granting ALL to the three roles, **and** the stock
  `GRANT USAGE ON SCHEMA public TO anon`, so that the baseline's revokes are
  actually exercised rather than assumed. This matters more than it sounds: a
  harness that never opens the door cannot prove the baseline shuts it.

`pg_cron`, `supabase_vault` and `pg_stat_statements` are not installable in that
environment and are not needed: `pg_depend` records **zero** non-extension
dependencies on any of the three. The baseline names them in section 22 instead
of running them.

**Version matters.** PostgreSQL 16 cannot apply this baseline — production uses
the `MAINTAIN` privilege, which is PostgreSQL 17 and later. Verify on 17.
