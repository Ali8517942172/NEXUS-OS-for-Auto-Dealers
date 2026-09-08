# PR #8 — merge gate

**Branch** `wip/gate-L9-2026-09-03` (GitHub tip `05f599d`) → `main` (GitHub tip `1c3a888`)
**Question asked:** *could merging these 32 commits into `main` break something, or carry in
something nobody intended?* — not "is the product ready to sell".

**Verdict: MERGE-SAFE**, with three things to know before clicking (§7).

Measured 6 September 2026, ~12:45–13:00 UTC, in this container.

---

## 0 · What was measured, and where

Everything below was run in a **fresh clone under `/tmp`**, not in the working copy.

```
git clone /home/claude/repo /tmp/pr8clone
```

There are **no GitHub credentials in this container** (`git ls-remote origin` →
`could not read Username for 'https://github.com'`), so the clone source is
`/home/claude/repo` itself. That is legitimate for this purpose because the working copy is
**clean** (`git status --porcelain` empty) and its tree hash is the one GitHub reports:

| ref | tree |
|---|---|
| container working copy `HEAD` | `a8179990cb9785492db0e7376f703bfe337267d6` |
| `/tmp/pr8clone` `HEAD` | `a8179990cb9785492db0e7376f703bfe337267d6` |
| GitHub `05f599d` (per the brief) | `a8179990cb9785492db0e7376f703bfe337267d6` |

Commit SHAs differ across the patch transfer — expected, and CLAUDE.md says so. The container's
branch is named `wip/gate-L9-2026-09-03-continued` and its tip is `3463b03`; that is `05f599d`
by content.

**Establishing the PR range without GitHub.** `HEAD~32..HEAD` is **32 commits and exactly
361 files changed** — both of GitHub's numbers, to the file. So the merge base is
`6a022e9` *"An actor is not part of an event's identity"*, tree
`513fe0d4df7730c9218b2dae9496fd5279f1a1b0`, and that is the commit `1c3a888` descends from.
Nothing else in the container's history produces 361 (`HEAD~31` → 116, `HEAD~34` → 362).

Read-only throughout: no git write to `/home/claude/repo`, no n8n contact, Supabase reads only.

---

## 1 · The duplicate-content question — answered by content, not by eye

**Nothing was applied twice.** Four independent checks, all clean.

### 1a · The patch files are *nested*, which is exactly how a double-apply would have happened

The six-plus older `.patch` files in `/home/claude/out/` are not siblings. The three that
matter are **cumulative prefixes of one another**, all starting from the same first commit
(*"The repository was twelve migrations behind the database…"*):

| patch | commits | inside the newest patch | present on the branch |
|---|---|---|---|
| `nexus-M0-M1-2026-09-05.patch` | 6 | **6 of 6** | 6 |
| `nexus-M0-M1-2026-09-06.patch` | 14 | **14 of 14** | 14 |
| `nexus-NIGHT-2026-09-06.patch` (newest, 11:30) | 25 | — | 25 |

Comparison is by `git patch-id --stable`, i.e. by the content of the change, not by SHA or
subject. Applying the 09-05 or 09-06 patch *in addition to* the newest one is precisely the
mistake that was feared — and it would have shown as repeated patch-ids. It does not.

### 1b · Every commit of the newest patch landed exactly once

25 patch-ids in `nexus-NIGHT-2026-09-06.patch`; **25 of 25 match a branch commit**; **0 of the
25 are missing**; **0 patch-id appears twice** among the branch's 32.

### 1c · The 32 = 25 + 7, and the 7 are accounted for

The seven branch commits whose content is *not* in the newest patch are all dated **4 September**
and sit before it in the chain — the earlier round that was already on the branch when the
newest patch was applied:

```
245b8a6  The database was reproducible from nowhere
a865116  anon read 8,500 rows, and the consent fix was half done
1eebbe0  The moat cannot be AI, because AI is what everyone else is selling
a37e91f  Launch week: five loops, six thin additions, and one screen
b4b48c9  Overturning a STOP is held to a higher standard than granting consent
78a8750  The door was the schema, and the ACL was the wrong witness
26fd032  An audit that disagrees with our own documents in six places
```

7 + 25 = 32. The set is exactly the intended one.

### 1d · Nothing duplicated at the file level either

- **Duplicate commit subjects among the 32:** none.
- **A subject from the 32 also appearing anywhere in the base history:** none.
- **Duplicate patch-ids over the last 80 commits** (wider than the PR, to catch a re-apply from
  an earlier round): none.
- **Duplicate migration version numbers:** none (286 distinct).
- **The same migration slug under two different timestamps:** none.
- **Two migration files with identical bodies** (the signature of the same change filed twice):
  none — all 286 bodies are distinct by md5.

---

## 2 · The 361 files, categorised — and nothing unaccounted for

`361 files changed, 64,460 insertions(+), 1,477 deletions(-)` · **321 added, 40 modified,
0 deleted.**

| category | files | note |
|---|---|---|
| `supabase/migrations/*.sql` | **286** (all A) | the whole directory is **new**; it did not exist at the merge base |
| `apps/executive-dashboard/**` | 35 | 32 M + 3 A (`lib/errors.js`, `lib/vocabulary.js`, `screens/money-leaks.js`) |
| `ops/n8n-bundle-NOT-DEPLOYED/**` | 14 (all A) | runbooks; **documents only, nothing executes** |
| `supabase/baseline/**` | 3 (all A) | `00000000000000_baseline.sql` (777 KB), history stamp, vocabulary seed |
| `supabase/tools/**` | 3 (all A) | `extract-migrations.mjs`, `generate-baseline.mjs`, `verification-harness.sql` |
| `ops/demo/**` + `ops/DEMO.md` | 3 (all A) | demo seed / teardown SQL and its runbook |
| root & docs markdown | 17 | 7 new (`AUDIT-2026-09-04`, `LAUNCH`, `OWNER-ACTIONS`, `ROADMAP`, `STATUS-2026-09-05`, `STATUS-2026-09-06`, `VERSIONS`), 10 modified incl. `CLAUDE.md`, `PRODUCT.md`, `README.md` |

**Every one of the 361 is accounted for. There are no unaccounted files.**

Scanned for, and **not present** — neither among the 361 nor anywhere in the tree at `HEAD`:
`node_modules/`, `dist/` or any build output, `*.patch`, `*.orig`, `*.rej`, `*.bak`, `*~`,
`*.swp`, `.DS_Store`, `Thumbs.db`, `.idea/`, `.vscode/`, `.env*`, `*.log`. `.gitignore`
already covers all of these, including `*.patch` explicitly.

Largest added file is `supabase/baseline/00000000000000_baseline.sql` at 777 KB — generated,
expected, and documented in `supabase/README.md`.

Two placement observations, neither a risk:

- **`two-tenant-proof-2026-09-06.md` sits at the repository root**, not under `docs/`. It is
  a 574-line evidence document. Consistent with the other root-level `STATUS-*` / `AUDIT-*`
  files, so this is house style rather than a stray, but it is the one file whose location
  looks accidental at a glance.
- `ops/` is a **new top-level directory** (demo fixtures + the not-deployed n8n runbooks).
  Nothing in it is wired to anything.

---

## 3 · Clean-clone build — PASS

```
cd /tmp/pr8clone/apps/executive-dashboard
npm ci        →  FAILED (see below)
npm install   →  OK
VITE_SUPABASE_URL=https://dsvuoovivysszdoiorch.supabase.co \
VITE_SUPABASE_ANON_KEY=placeholder \
VITE_N8N_BASE_URL=https://35.224.126.225.nip.io \
npm run build →  exit 0
```

```
vite v5.4.21 building for production...
✓ 89 modules transformed.
dist/index.html                  2.45 kB │ gzip:   1.14 kB
dist/assets/main-BkBRVy6q.css   13.98 kB │ gzip:   3.69 kB
dist/assets/main-BGNobduB.js  1,433.26 kB │ gzip: 422.56 kB
✓ built in 3.77s
```

Two non-fatal warnings, both pre-existing: `lib/data.js` is both statically and dynamically
imported, and the single chunk exceeds 500 KB.

### `npm ci` fails — and it is **not** this PR's doing

```
npm error `npm ci` can only install packages when your package.json and
npm error package-lock.json are in sync.
npm error Missing: playwright@1.63.0 from lock file
npm error Missing: playwright-core@1.63.0 from lock file
```

`playwright` is a `devDependency` in `package.json` and absent from `package-lock.json`.
Measured on both sides of the merge base: `playwright` is in `package.json` and **not** in the
lockfile at `HEAD~32` **and** at `HEAD` — identical. Neither `package.json` nor
`package-lock.json` is touched by any of the 32 commits. So `npm ci` fails on `main` today for
the same reason, and **merging does not change it**. It was introduced much earlier, by
`84377df` *"Put both gates in the repo, and stop the README lying"*.

It does not break deployment: `vercel.json` runs `npm install`, not `npm ci`. Worth fixing on
its own ticket (`npm install && commit the lockfile`), not as a merge blocker.

---

## 4 · The gate, run in the clean clone

### 4a · Offline lane only (no catalogue)

```
node QUALITY_GATE.mjs
PASS 18   FAIL 0   WARN 1   NOT RUN 17      exit 2
NOT RUN: L1 L2 L3 L4 L5 L6 L7 L8 L9 L10 L13 L11 L12 B1 B2 B3 B4
```

### 4b · With the production catalogue

Before using it, **production's migration head was read directly** (Supabase MCP, read-only,
12:50:42 UTC):

| | head | count |
|---|---|---|
| production `supabase_migrations.schema_migrations` | `20260906071310` | 286 |
| `catalogue.prod.2026-09-06T1122Z.json` anchor | `20260906071310` | 286 |

**Production has not moved past the catalogue's anchor.** The catalogue was ~1.5 h old at run
time, inside the gate's 24 h fuse.

```
node QUALITY_GATE.mjs --catalogue /home/claude/out/catalogue.prod.2026-09-06T1122Z.json
PASS 28   FAIL 1   WARN 2   NOT RUN 6       exit 1
```

| verdict | checks |
|---|---|
| **FAIL (1)** | **L9** |
| **WARN (2)** | L8b, S5b |
| **NOT RUN (6)** | B1, B2, B3, B4, L11, L12 |
| PASS (28) | L1 L2 L3 L4 L5 L6 L7 L8 L10 L13 · R0–R7 · S1–S10 |

**FAIL — L9** (P0, live · database):
> `"Example Workflow"` wrote 1 `audit_log` row (FAILED) and resolves to no `workflow_registry`
> entry — `v_audit_unregistered_writers` calls it an unrecognised writer, so its runs are on no
> health surface. Register it from the box with its real n8n id, or establish it is not a NEXUS
> workflow. Do not invent a registry row to clear this.

**NOT RUN, one line each:**

- **B1** — neither `NEXUS_STAGING_DB_URL` nor `NEXUS_DB_URL` is set; B1's non-approver
  `action_decide()` call writes an audit row before it returns, and the gate will not open a
  write probe on production.
- **B2** — same missing connection; both arms of B2 are state changes by definition.
- **B3** — same missing connection; the catalogue says 2 dealerships, which is enough to attempt
  it, but a catalogue has no caller.
- **B4** — no live render credential (`NEXUS_LIVE_URL` / `NEXUS_LIVE_ANON_KEY` /
  `NEXUS_LIVE_ACCESS_TOKEN` / `NEXUS_LIVE_EMAIL` / `NEXUS_LIVE_PASSWORD` all unset).
- **L11** — no `NEXUS_DB_URL`, so the gate cannot read
  `supabase_migrations.schema_migrations` for itself. *(This document read it by hand — §5 —
  but that is a measurement this document made, not a check the gate ran.)*
- **L12** — the `supabase/` folder is internally consistent; arms B and C need a SQL connection.

### 4c · Difference from the last recorded board

`/home/claude/out/gate-FINAL-2026-09-06.md` records **PASS 31 · FAIL 1 · WARN 2 · NOT RUN 3 ·
exit 1**. This run is **PASS 28 · FAIL 1 · WARN 2 · NOT RUN 6 · exit 1**.

**The difference is exactly B1, B2 and B3: PASS → NOT RUN. It is the environment, not the code.**
Those three passed in the recorded run because that shell carried staging sign-in credentials
(`NEXUS_STAGING_REST_URL`, `NEXUS_STAGING_ANON_KEY` and the four account pairs), and the gate
signed in through GoTrue against staging to exercise them. This container's environment is bare
— `env | grep -E "NEXUS|SUPABASE|DB_URL"` returns nothing — so the gate correctly reports NOT
RUN rather than PASS.

Same FAIL (L9), same two WARNs (L8b, S5b), and **L13 PASSES here** — the catalogue is anchored
to the repository's newest migration and none has landed past it. **No NOT RUN was converted to
a PASS, and no check was weakened.**

---

## 5 · Migration integrity — repository vs production

Both sides, computed independently and compared.

| | repository (`/tmp/pr8clone/supabase/migrations`) | production `dsvuoovivysszdoiorch` |
|---|---|---|
| files / rows | **286** | **286** |
| total bytes of statement text | **1,964,878** | **1,964,878** |
| rollup — md5 over `version:md5(body)`, version order | **`09c44bdd2bf7d047e072a0b95179a65f`** | **`09c44bdd2bf7d047e072a0b95179a65f`** |
| versions only, md5 | `e3e7ce881938e59cebbf2786e0500122` | `e3e7ce881938e59cebbf2786e0500122` |
| `version_name.sql` filenames, md5 | `e1eff7d97d76d5b6dd5f4ea92c9b5305` | `e1eff7d97d76d5b6dd5f4ea92c9b5305` |
| head version | `20260906071310` | `20260906071310` |
| rows with no recorded statement | — | **0** |
| rows with more than one statement | — | **0** |

**Identical on all five fingerprints.** That settles both failure modes the repo has hit before:

- **A migration file whose content does not match its recorded statement:** the body rollup
  matches, so **zero** files diverge from what production applied.
- **A filename whose version is not in the recorded history** (or a recorded version with no
  file): the versions-only and filenames fingerprints match over an ordered join, which is only
  possible if the two version sets are identical, in the same order, with the same names.
  **Zero orphans in either direction.**

`supabase/migrations/` is entirely new to `main` — the merge base held **0** files there and
11 loose `.sql` files elsewhere, none of which are removed.

---

## 6 · What `main` gains that it should not — and the three commits

### Nothing regresses

- **Zero files deleted.** `comm` of the two file lists at `HEAD~32` and `HEAD` shows nothing
  present at the base and absent at the tip. Nothing `main` has can be removed by this merge.
- **Zero dependency changes.** `package.json` and `package-lock.json` are untouched by all 32
  commits. No package added, removed or bumped.
- **Zero build or CI config changes.** `vite.config.js`, `postcss.config.js`, `Dockerfile`,
  `vercel.json`, `.gitignore` — none touched. There is no `.github/` in the tree at all.
- **Nothing in the merge executes.** The 14 `ops/n8n-bundle-NOT-DEPLOYED/` files are markdown
  runbooks. The 286 migrations are a *record* of what production already ran, not a deploy step.
  Merging applies nothing to any database.

### The three commits `main` is ahead by — **not determinable from this container**

Stated plainly rather than guessed: **those three commits are not present here in any form.**
`origin/main` in this container is the stale `4e963bd`, which is an *ancestor* of the branch;
the container holds exactly one child of the merge base (`245b8a6`, the branch's own first
commit); and there is no network path to GitHub. The eight commits that exist locally off the
branch (`_hisbase`, `frontend/identity-resolver`, `theirs/main-reconstructed`, tag
`merged-as-pr-2`) are all dated **31 Aug – 1 Sep**, well before the 4 Sep merge base, so none of
them is one of the three.

What can be said without them:

1. **The merge cannot lose them.** A merge adds; it never drops commits already on `main`, and
   GitHub reports no conflict.
2. **The branch deletes no file**, so those three commits' files survive the merge whatever they
   are.
3. **The residual risk is a clean-but-wrong textual merge** in a file both sides touched. The
   exposure surface is the **40 modified files** — 32 dashboard sources plus 8 markdown
   documents (`ARCHITECTURE.md`, `CLAUDE.md`, `CONTROL-PLANE.md`, `NEXUS_INVARIANTS.md`,
   `PRODUCT.md`, `README.md`, `architecture/README.md`, `commercial/WHAT-WE-CLAIM.md`). The 321
   added files cannot collide. **Check on GitHub whether any of the three touched a file on
   that list**; if none did, the merge is textually and semantically trivial.

---

## 7 · Three things to know before clicking merge

1. **A staging `anon` key enters `main` in a new file.** `ops/DEMO.md:110` commits
   `VITE_SUPABASE_ANON_KEY=eyJ…` for project `wwspuxrbiyagnrnzgate` (role `anon`, expiry 2036),
   next to three demo passwords (`NexusDemo!2026`, `*.demo.invalid` accounts). Anon keys are
   publishable by design and the document says so — but given this repo's history with the
   `anon` surface, it is worth deciding deliberately rather than by merge. The **production**
   anon key is already committed in ten `n8n-workflows/*.json` files and predates this PR.
2. **If a Vercel project is connected to `main`, this merge deploys the dashboard.**
   `vercel.json` builds `apps/executive-dashboard` with `npm install && npm run build`. That
   build was just proved from a cold clone (§3), so the deploy should succeed — but it is a
   production deploy, not just a repository change.
3. **`npm ci` is broken on `main` today** (§3) and this merge neither causes nor fixes it.
   Separate ticket.

The demo seed is safe: `ops/demo/seed_demo_tenant.sql` opens with a two-sided guard that raises
`NX999` if any tenant matches `%alba%` (production) **and** raises if `staging-alpha` /
`staging-bravo` are absent (not staging). It cannot run against `dsvuoovivysszdoiorch`.

---

## 8 · Verdict

**MERGE-SAFE** for the narrow question.

- The 32 commits are exactly the intended set: 25 from the newest patch, each landing once, plus
  the 7 pre-existing 4-September commits. **No content was applied twice, by patch-id, by
  subject, by migration version, by migration slug or by migration body.**
- All 361 files are accounted for. No build output, no scratch file, no `.patch`, no
  `node_modules`, no editor artefact. One cosmetic placement note (`two-tenant-proof-2026-09-06.md`
  at the root).
- The dashboard builds from a cold clone, exit 0. `npm ci` fails identically on `main` and is
  not this PR's doing.
- The gate in the clean clone is **PASS 28 · FAIL 1 · WARN 2 · NOT RUN 6 · exit 1** — same FAIL
  (L9), same WARNs, and the three-check gap against the recorded board is missing staging
  credentials in this container, not a code change.
- Migrations are byte-identical to production on all five fingerprints, 286 = 286.
- Nothing is deleted, no dependency or config moves, nothing in the merge executes.

The one honest gap: **the three commits `main` is ahead by cannot be seen from here.** They do
not affect whether the merge is destructive — it is not — but confirm on GitHub that none of
them touched one of the 40 modified files before merging.

---

*Transcripts: `/home/claude/out/pr8-gate-clean-clone-with-catalogue.txt`,
`/home/claude/out/pr8-gate-clean-clone-offline.txt`. Clean clone left at `/tmp/pr8clone`.*
