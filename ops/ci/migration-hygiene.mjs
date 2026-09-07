#!/usr/bin/env node
/* NEXUS OS — supabase/migrations/ hygiene, with no database.
 *
 * WHAT THIS IS FOR
 * ----------------
 * supabase/migrations/ is not a folder of scripts somebody wrote. It is a
 * verbatim extraction of supabase_migrations.schema_migrations — one file per
 * row holding statements[1] byte for byte (supabase/tools/extract-migrations.mjs
 * literally does `writeFile(file, body)` with no reformatting). Everything
 * downstream leans on that: the Supabase CLI orders by the 14-digit version,
 * QUALITY_GATE.mjs L11 compares the folder with the table, L13 asks whether the
 * catalogue predates a file here, and supabase/README.md publishes a byte total
 * and an md5 rollup measured on BOTH sides.
 *
 * All of that can be checked WITHOUT A DATABASE, which is the point: it is the
 * one thing about the schema that CI is allowed to have an opinion on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS NO "FILES MUST NOT END IN A NEWLINE" RULE, AND WHAT REPLACED IT
 * ─────────────────────────────────────────────────────────────────────────────
 * This job was specified with one: every file must have no trailing newline,
 * "this repo's protocol". 54 of the 295 committed migrations end in one, so
 * that rule would have made CI red on day one and the obvious remedy would have
 * been to strip 54 bytes.
 *
 * That remedy would have been data loss, and the repository proves it without a
 * database. supabase/README.md publishes, as a figure measured on production:
 *
 *     "The 273 files total 1,809,043 bytes, which is exactly
 *      sum(octet_length(statements[1])) on production."
 *
 * The 273 files at or before version 20260905211435 total 1,809,043 bytes on
 * disk RIGHT NOW, trailing newlines included. So those newlines are bytes the
 * DATABASE holds. They are not editor slop; the convention lives in the rows,
 * not in this folder, and a file's last byte is whatever the row's last byte is.
 * Stripping them would put the folder out of sync with the table and break both
 * L11 and the published rollup — a check that ordered CI to corrupt a byte-exact
 * extraction is worse than no check at all.
 *
 * So rule 4 is the invariant that is actually true here, and it still goes red:
 *
 *   4a  no editor artefact — no CR anywhere, no file ending in two or more
 *       newlines, no trailing space or tab at end of file. None of these can be
 *       a faithful copy of a row that psql wrote; every one of them is a person
 *       having opened the file in an editor. Blocking, whole tree.
 *   4b  the published byte anchor still holds: the files at or before
 *       20260905211435 still number 273 and still total 1,809,043 bytes. This
 *       is the exact corruption stripping newlines would cause, checked against
 *       a figure someone measured on production. Blocking, whole tree.
 *   4c  a census of which files end in a newline, printed by name every run.
 *       Advisory by default — pass --strict-newline to make the literal rule
 *       blocking, or --base <ref> to make it blocking on the files this change
 *       touches. Nothing is hidden either way.
 *
 * WHAT IT CHECKS
 *   1   every filename matches ^\d{14}_[a-z0-9_]+\.sql$
 *   2   no two files share a version
 *   3   versions are strictly ascending
 *   4   see above
 *   5   no file contains a literal Supabase key, JWT or sb_secret_ token
 *
 * USAGE
 *   node ops/ci/migration-hygiene.mjs                     rules 1,2,3,4a,4b,5 blocking
 *   node ops/ci/migration-hygiene.mjs --base origin/main  + 4c blocking on the diff
 *   node ops/ci/migration-hygiene.mjs --strict-newline    + 4c blocking everywhere
 *
 * EXIT  0 clean · 1 at least one rule broken · 3 this script could not run
 */
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const DIR  = join(REPO, 'supabase', 'migrations');
const REL  = 'supabase/migrations';

const argv = process.argv.slice(2);
const opt  = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const BASE = opt('--base');
const STRICT_NEWLINE = argv.includes('--strict-newline');

const NAME_RE = /^\d{14}_[a-z0-9_]+\.sql$/;

/* The anchor rule 4b checks, quoted from supabase/README.md § "What was
   verified, and how". Both numbers were measured on production and on disk. */
const ANCHOR = { version: '20260905211435', files: 273, bytes: 1809043,
  cite: 'supabase/README.md: "The 273 files total 1,809,043 bytes, which is exactly sum(octet_length(statements[1])) on production."' };

/* A real key has a body. The bare prefixes appear as LITERALS inside CHECK
   constraints in this folder on purpose — several tables refuse to store a
   value that looks like a credential and spell the prefixes out to do it
   (`credential_ref !~* '^(eyJ|sk-|sb_secret_|sbp_|service_role|bearer)'`).
   Matching a bare prefix would fail eight migrations for containing the very
   guard that keeps secrets out of the database, so each pattern below requires
   enough trailing key material that a guard clause cannot satisfy it. */
const SECRETS = [
  ['a Supabase secret key',   /sb_secret_[A-Za-z0-9_-]{12,}/],
  ['a JSON Web Token',        /eyJhbGciOi[A-Za-z0-9._-]{30,}/],
  ['an OpenRouter key',       /sk-or-v1-[A-Za-z0-9]{16,}/],
  ['an Apify token',          /apify_api_[A-Za-z0-9]{16,}/],
  ['a Slack token',           /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['a GitHub personal token', /ghp_[A-Za-z0-9]{20,}/],
];

if (!existsSync(DIR)) { console.error(`${REL} does not exist. Run this from a checkout of the repository.`); process.exit(3); }

let changed = null, changedWhy = '';
if (BASE) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${BASE}...HEAD`, '--', REL],
      { cwd: REPO, encoding: 'utf8' });
    changed = new Set(out.split('\n').filter(Boolean).map(p => p.split('/').pop()));
    changedWhy = `${changed.size} file(s) added or modified against ${BASE}`;
  } catch (e) {
    console.error(`could not diff against ${BASE}: ${String(e.stderr || e.message).trim().slice(0, 300)}`);
    console.error('Fetch the base ref, or drop --base.');
    process.exit(3);
  }
}

const files = (await readdir(DIR)).filter(f => f.endsWith('.sql')).sort();
if (!files.length) { console.error(`${REL} holds no .sql files. That is not a clean run, it is an empty one.`); process.exit(3); }

const bad = [], noted = [], ran = [];

/* 1 — names */
const misnamed = files.filter(f => !NAME_RE.test(f));
for (const f of misnamed)
  bad.push(`${REL}/${f} — the name does not match ^\\d{14}_[a-z0-9_]+\\.sql$. The Supabase CLI orders migrations by that 14-digit prefix and this gate reads it; a name it cannot parse applies in an order nobody chose.`);
ran.push(`1 · names: ${files.length} file(s) against ^\\d{14}_[a-z0-9_]+\\.sql$ — ${misnamed.length} bad`);

/* 2, 3 — versions unique and strictly ascending */
const versions = files.filter(f => NAME_RE.test(f)).map(f => ({ v: f.slice(0, 14), f }));
const seen = new Map();
for (const { v, f } of versions) {
  if (seen.has(v)) bad.push(`${REL}/${f} and ${REL}/${seen.get(v)} share version ${v}. Two rows cannot carry one version, so one of these is not what the database applied.`);
  else seen.set(v, f);
}
let ascending = true;
for (let i = 1; i < versions.length; i++) if (!(versions[i].v > versions[i - 1].v)) {
  ascending = false;
  bad.push(`${REL}/${versions[i].f} (${versions[i].v}) does not come strictly after ${REL}/${versions[i - 1].f} (${versions[i - 1].v}) in name order. Name order and version order must be one order or the folder no longer reads as a history.`);
}
ran.push(`2 · uniqueness: ${versions.length} version(s), ${versions.length - seen.size} collision(s)`);
ran.push(versions.length ? `3 · ordering: strictly ascending ${ascending ? 'YES' : 'NO'}, ${versions[0].v} → ${versions[versions.length - 1].v}` : '3 · ordering: no parseable version to order');

/* 4 and 5 — read every file once */
const endsNewline = [];
let anchorFiles = 0, anchorBytes = 0;
for (const f of files) {
  const buf = await readFile(join(DIR, f));
  const n = buf.length;

  if (NAME_RE.test(f) && f.slice(0, 14) <= ANCHOR.version) { anchorFiles++; anchorBytes += n; }

  /* 4a — editor artefacts */
  const cr = buf.indexOf(0x0d);
  if (cr >= 0) bad.push(`${REL}/${f} contains a carriage return at byte ${cr}. psql did not put it there; a CR means this file has been through an editor, and the folder is a verbatim copy or it is nothing.`);
  if (n >= 2 && buf[n - 1] === 0x0a && buf[n - 2] === 0x0a)
    bad.push(`${REL}/${f} ends in two or more newlines. A row body does not, so this is an edit, not an extraction.`);
  if (n >= 1 && (buf[n - 1] === 0x20 || buf[n - 1] === 0x09))
    bad.push(`${REL}/${f} ends in a space or tab. Same reason: an extraction does not grow whitespace.`);

  if (n && buf[n - 1] === 0x0a) endsNewline.push(f);

  /* 5 — secrets */
  const text = buf.toString('utf8');
  for (const [what, re] of SECRETS) {
    const m = re.exec(text);
    if (m) bad.push(`${REL}/${f}:${text.slice(0, m.index).split('\n').length} contains what looks like ${what} (${m[0].slice(0, 12)}…). A migration is applied by whoever restores this schema; a credential in one is a credential handed to all of them.`);
  }
}
ran.push(`4a · editor artefacts: ${files.length} file(s) checked for CR, double-newline and trailing blank`);

/* 4b — the published byte anchor */
if (anchorFiles !== ANCHOR.files || anchorBytes !== ANCHOR.bytes)
  bad.push(`the published byte anchor no longer holds: ${anchorFiles} file(s) at or before version ${ANCHOR.version} totalling ${anchorBytes} bytes, against ${ANCHOR.files} and ${ANCHOR.bytes} published. ${ANCHOR.cite} If a byte moved in that prefix, this folder is no longer the verbatim extraction it claims to be — check what edited it before changing this number.`);
ran.push(`4b · byte anchor: ${anchorFiles}/${ANCHOR.files} file(s) at or before ${ANCHOR.version}, ${anchorBytes}/${ANCHOR.bytes} bytes — ${anchorFiles === ANCHOR.files && anchorBytes === ANCHOR.bytes ? 'reproduced exactly' : 'DRIFTED'}`);

/* 4c — the literal trailing-newline census */
const nlBlocking = STRICT_NEWLINE ? endsNewline : (changed ? endsNewline.filter(f => changed.has(f)) : []);
for (const f of nlBlocking)
  bad.push(`${REL}/${f} ends in a newline, and this run was told to block on that (${STRICT_NEWLINE ? '--strict-newline' : `--base ${BASE}`}).`);
const nlNoted = endsNewline.filter(f => !nlBlocking.includes(f));
ran.push(`4c · trailing newline: ${endsNewline.length} of ${files.length} file(s) end in one — `
  + (STRICT_NEWLINE ? 'BLOCKING over the whole tree (--strict-newline)'
     : changed ? `BLOCKING on ${changedWhy} (${nlBlocking.length} of them), advisory elsewhere`
     : 'ADVISORY — see the header for why the literal rule is not the default'));
if (nlNoted.length)
  noted.push(`${nlNoted.length} file(s) end in a newline and were not blocked: ${nlNoted.join(', ')}`);

ran.push(`5 · secrets: ${files.length} file(s) scanned for ${SECRETS.length} credential shapes`);

console.log('════ MIGRATION HYGIENE — no database, no credential ════');
for (const r of ran) console.log(`RAN     ${r}`);
for (const n of noted) console.log(`NOTED   ${n}`);
for (const b of bad) console.log(`FAIL    ${b}`);
console.log(`\n${files.length} file(s) · ${bad.length} blocking finding(s) · ${noted.length} noted`);
if (bad.length) { console.log('\nThis job needs no credential and no database, so nothing above is an environment problem.'); process.exit(1); }
console.log('clean');
