# What CI runs, what it cannot run, and what a human still has to

Until 7 September 2026 this repository had **no continuous integration at all**.
Twelve pull requests reached `main` without a single automated check.
`QUALITY_GATE.mjs` — 5,600 lines, the project's own safety net — ran only when
somebody remembered to run it by hand.

The immediate cause was one line. `.gitignore` carried `.github/workflows/`, so
every workflow file anyone wrote was invisible to `git` and could never be
committed. That line is gone, with a note in its place saying why it must not
come back.

---

## What runs on every pull request and on every push to `main`

`ci.yml`, four jobs, all on Node 22 (the repository has no `.nvmrc` and no
`engines`; Vite 5 declares `^18.0.0 || >=20.0.0` and development here runs 22).

| Job | What it does | Can it go red? |
|---|---|---|
| **Dashboard builds** | `npm ci` and `npm run build` in `apps/executive-dashboard` | Yes — a build break is the cheapest defect there is and it was entirely uncaught |
| **Quality gate (offline lanes)** | `node QUALITY_GATE.mjs --no-db`, with Chromium installed for the render lane | Yes — verified; see "Deliberate failures", below |
| **Migration hygiene** | `node ops/ci/migration-hygiene.mjs` **and** `node ops/ci/function-grants.mjs --census` | Yes — both verified; see "Deliberate failures" |
| **Secret scan** | `node ops/ci/secret-scan.mjs` | Yes — verified |

---

## The gate in CI: which checks run, and which are skipped

CI holds **no `NEXUS_DB_URL`, no service-role key and no n8n API key**, and it
must not: a pull request from a fork would otherwise execute arbitrary code
holding this dealership's database.

So the gate is invoked with `--no-db`. That flag is not a way of turning a red
run green. It is an assertion about the environment, and it pays for itself:

* **It refuses to run if a database input is present.** `NEXUS_DB_URL`,
  `NEXUS_STAGING_DB_URL`, `NEXUS_BASELINE_REPLAY_URL`, `NEXUS_LIVE_URL`,
  `NEXUS_STAGING_REST_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`,
  `NEXUS_ENV` or `--catalogue` alongside `--no-db` is exit 3, not a preference
  the gate resolves on your behalf. It cannot be used to mute a live lane that
  could have run and might have gone red.
* **It prints every skipped check by name**, with its severity, lane, title and
  the reason it could not run, under a heading that says in plain words that
  they are not passes. The list is derived from the results, so a check added to
  the live lane tomorrow appears in it with nobody editing anything.
* **It forgives the LIVE lane only.** A `NOT RUN` in an offline lane still exits
  2. That is what happens when Chromium is missing in CI — and a run with no
  browser has silently retired R1–R7. A gate that looks green because half of it
  did not execute is worse than no gate.
* **Its exit-0 sentence never says "every launch-critical check ran and
  passed."** It says how many did not run.

### Runs in CI (19 checks, no secret needed)

| Lane | Checks |
|---|---|
| `OFFLINE · source` | S1, S2, S3, S4, S5, S5b, S6, S7, S8, S9, S10 |
| `OFFLINE · rendered` | R0 (vite build), R1, R2, R3, R4, R5, R6, R7 |

The render lane drives headless Chromium against a **stubbed PostgREST**. It is
deterministic and offline. It proves what the UI does with a given row. It
cannot prove what Postgres does with a given caller.

### Skipped in CI (17 checks — every one needs a credential)

`L1 L2 L3 L4 L5 L6 L7 L8 L9 L10 L11 L12 L13 B1 B2 B3 B4`

These are RLS, EXECUTE grants, `security_invoker`, function bodies, the
migration history, the baseline restore path, and the four B checks about what
Postgres does to a real signed-in caller. **None of them can be inferred from
source.** A green CI run says nothing whatsoever about tenant isolation.

---

## What a human must still run by hand before a release

CI covers the source and the rendered UI. It does not cover the database, and
the database is where every P0 in this product lives.

1. **The full gate, against production, read-only.**
   ```
   NEXUS_DB_URL=postgres://…  node apps/executive-dashboard/QUALITY_GATE.mjs --report gate.md
   ```
   Exit 0 means every launch-critical check ran and passed. Exit 2 means
   something launch-critical could not run and is **not** a pass.

2. **The B lane, against staging.** `B1`, `B2` and `B3` write, so they refuse to
   run against production. They need `NEXUS_STAGING_DB_URL`, or the signed-in
   transport (`NEXUS_STAGING_REST_URL`, `NEXUS_STAGING_ANON_KEY` and the four
   staging accounts). `B4` needs `NEXUS_LIVE_*`. The gate's own header lists
   every variable and what each one buys.

3. **Refresh the schema snapshot whenever a migration lands.** The gate carries
   an embedded catalogue anchored to a migration version. When the repository
   holds migrations newer than that anchor, the offline stub answers screens
   that call the new relations with 404 and **R2/R3 go red for a reason that is
   not the screens' fault**. The gate now names the migration file responsible,
   but only a credentialled run can clear it:
   ```
   NEXUS_DB_URL=postgres://…  node apps/executive-dashboard/QUALITY_GATE.mjs --refresh-schema
   ```
   *This is the state of `wip/gate-L9-2026-09-03-continued` today: the snapshot
   is anchored to `20260906071310` and the branch adds migrations through
   `20260907024207` creating `v_lead_origin`, `v_communication_log_evidence` and
   `nexus_lead_source_readiness`. Injecting those three into the snapshot by
   hand takes the offline run from FAIL 2 to PASS 18 / FAIL 0, which is the
   evidence that the red is staleness and not a broken screen.*

4. **`supabase/tools/extract-migrations.mjs --check`** — whether the folder still
   matches `supabase_migrations.schema_migrations`. Needs `NEXUS_DB_URL`. This is
   `L11` in a form you can put in front of a commit.

5. **Anything about n8n.** No workflow is imported, executed, validated or
   compared by CI. Nothing here touches the box.

---

## Function grant hygiene, and the three shapes of one mistake

`ops/ci/function-grants.mjs` exists because a Postgres function is born with
`EXECUTE` granted to `PUBLIC`, and this database has been surprised by that in
three different ways. None of the three would have caught the other two:

1. `revoke ... from public` does **not** remove a direct grant to `anon` —
   Supabase's default privileges hand `anon` a grant of its own.
2. `revoke ... from anon, authenticated` does **not** remove the `PUBLIC` grant.
   Both roles keep reaching the function through `PUBLIC`, and neither name
   appears in `proacl` afterwards, so the ACL *looks* clean.
3. `proacl like '%anon=%'` is therefore blind, and a sweep written that way
   reported nothing wrong while a hole was open.

Number 2 is the one that cost something. `nexus_public_exposure_report` — the
function that prints this database's own over-grants — was revoked from `anon`
and `authenticated` on 4 September and stayed executable by every signed-in
dealership user until 7 September, returning 149 rows of security posture to a
customer's account. `proacl` was `{=X/postgres, postgres=X, service_role=X}`;
the leading `=X` is `PUBLIC`.

The script blocks, in migrations **newer than `20260907140000`**:

- **rule 1** — a function defined without a `revoke` naming `public` in the same
  file, and (unless it `returns trigger`) without a `grant` saying who may call
  it. A trigger function still needs the revoke: it can also be called directly,
  and one of ours was born reachable exactly that way.
- **rule 2** — any `revoke ... on function` whose role list omits `public`.

Everything at or before the watermark is a **named census, not a failure**: 90
definitions do not state their own ACL and 31 revokes omit `public`. Making that
blocking would have put CI red on day one over history that is already correct
on the server — production showed **zero** of our functions carrying a bare
`PUBLIC` entry on 7 Sep 2026. Same lesson as rule 4 of migration hygiene: a rule
whose obvious remedy is wrong is worse than no rule.

This is a check on the **text** of `supabase/migrations/`. It cannot see a grant
made by hand, cannot follow a function granted in one migration and revoked in
another, and cannot tell whether a role exists. Its live counterpart is
`nexus_public_exposure_report()`, which needs a service-role key CI must never
hold. Neither replaces the other: this one stops the defect being **written**,
that one finds it once it **exists**.

---

## Migration hygiene, and the rule that was replaced

`ops/ci/migration-hygiene.mjs` checks, with no database:

1. every filename matches `^\d{14}_[a-z0-9_]+\.sql$`
2. no two files share a version
3. versions are strictly ascending
4. see below
5. no file holds a Supabase key, JWT, or `sb_secret_` token

**Rule 4 was specified as "no file has a trailing newline, this repo's
protocol". That is not this repo's protocol, and enforcing it would have
destroyed data.** 54 of the 295 committed migrations end in a newline.
`supabase/tools/extract-migrations.mjs` writes `statements[1]` **verbatim**, so a
file's last byte is whatever the row's last byte is. `supabase/README.md`
publishes, as a figure measured on production:

> The 273 files total 1,809,043 bytes, which is exactly
> `sum(octet_length(statements[1]))` on production.

The 273 files at or before version `20260905211435` total **exactly 1,809,043
bytes on disk right now, trailing newlines included**. Those newlines are bytes
the *database* holds. Stripping them would desynchronise the folder from the
table and break both `L11` and the published md5 rollup.

So rule 4 is the invariant that is actually true, and it still goes red:

* **4a — no editor artefact.** No CR anywhere, no file ending in two or more
  newlines, no trailing space or tab. None of these can be a faithful copy of a
  row. Blocking, whole tree.
* **4b — the published byte anchor still holds.** 273 files at or before
  `20260905211435`, 1,809,043 bytes. This is precisely the corruption that
  "fixing" the newlines would cause. Blocking, whole tree. *Verified: stripping
  one trailing newline takes it to 1,809,042 and the job exits 1.*
* **4c — a census** of the 54, printed by name every run. Advisory by default;
  `--strict-newline` makes the literal rule blocking, `--base <ref>` makes it
  blocking on the files a change touches. Nothing is hidden either way.

---

## Secret scan, and why it decodes rather than pattern-matches

`ops/ci/secret-scan.mjs` scans every tracked text file for `sb_secret_`,
`eyJhbGciOi…`, `sk-or-v1-`, `apify_api_`, `xox[baprs]-` and `ghp_`.

**Eleven anon JWTs are committed here on purpose** — ten `n8n-workflows/*.json`
files and `ops/DEMO.md`, carrying two distinct keys. An anon key is the *public*
half of the pair, designed to ship in a browser bundle; RLS decides what it can
reach. Failing on it would make this job cry wolf on every run, and a job that
cries wolf gets `|| true` appended to it.

A `service_role` key is **indistinguishable from an anon key to a regex** — same
issuer, same prefix, same length class. The only difference is the `role` claim.
So the scan **decodes the payload and reads `role`**. `anon` passes and is
reported by name. `service_role`, any other role, an unreadable payload, or a
payload with no role at all **fails loudly** — an unclassifiable token is not a
safe token.

Each non-JWT pattern requires trailing key material, because
`supabase/migrations/` spells the bare prefixes out inside CHECK constraints that
refuse to *store* such a value (`credential_ref !~* '^(eyJ|sk-|sb_secret_|…)'`).
That is the opposite of a leak and must not read as one.

---

## Deliberate failures, verified

Every job below was made to fail on purpose and then restored. A CI job that
cannot fail is decoration.

| Plant | Job | Exit with plant | Exit after removal |
|---|---|---|---|
| `2026090702420_BadName-Migration.sql` | migration hygiene | 1 | 0 |
| `sb_secret_…` appended to a migration | migration hygiene | 1 | 0 |
| one trailing newline stripped (byte anchor 1809042 ≠ 1809043) | migration hygiene | 1 | 0 |
| fake `role: service_role` JWT in a tracked file | secret scan | 1 | 0 |
| fake JWT with no `role` claim | secret scan | 1 | 0 |
| fake `sk-or-v1-…` key | secret scan | 1 | 0 |
| `PLAYWRIGHT_CHROMIUM_PATH=/nonexistent` (R1–R7 could not run) | gate `--no-db` | 2 | — |
| `NEXUS_DB_URL` set alongside `--no-db` | gate `--no-db` | 3 | — |
| a post-watermark migration whose revoke omits `public` (rule 2) | function grants | 1 | 0 |
| a post-watermark function with no ACL statement at all (rule 1) | function grants | 1 | 0 |
| a post-watermark **trigger** function with no revoke (rule 1) | function grants | 1 | 0 |

A planted **anon** JWT was correctly *allowed*, next to a planted `service_role`
one that was correctly *refused*, in the same file, in the same run.

The function-grant job has a positive control too, and it matters more than
usual because both of its rules are about absence: a planted migration that
defines a callable function **and** a trigger function and states the ACL for
both correctly exits **0**. So the job is not simply refusing every new
migration.
