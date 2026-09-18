#!/usr/bin/env node
/* NEXUS OS — every new function must state who may execute it, with no database.
 *
 * WHY THIS EXISTS
 * ---------------
 * A Postgres function is born with EXECUTE granted to PUBLIC. In a Supabase
 * project that means anon and authenticated can call it the moment it is
 * created, and this database has now been surprised by that in three distinct
 * ways — none of which the other two would have caught:
 *
 *   1. `revoke ... from public` does NOT remove a direct grant to anon.
 *      Supabase's default privileges hand anon a grant of its own.
 *   2. `revoke ... from anon, authenticated` does NOT remove the PUBLIC grant.
 *      Both roles keep reaching the function through PUBLIC, and neither name
 *      appears in proacl afterwards — so the ACL *looks* clean.
 *   3. `proacl like '%anon=%'` is therefore blind. A sweep written that way
 *      reported nothing wrong while the hole was open.
 *
 * Number 2 is the one that cost something real. `nexus_public_exposure_report`
 * — the function that prints this database's own over-grants — was revoked
 * from anon and authenticated on 4 September and remained executable by every
 * signed-in dealership user until 7 September, because the revoke never named
 * `public`. Measured on production: proacl `{=X/postgres, postgres=X, ...}`,
 * `has_function_privilege('authenticated', ...)` true, and 149 rows of this
 * database's security posture returned to a customer's account.
 *
 * The rule that survives all three shapes is one line long: REVOKE NAMING
 * `public` AND THE ROLES, then assert with has_function_privilege(). This
 * script makes CI refuse a migration that does not.
 *
 * WHAT THIS CAN AND CANNOT SEE
 * ----------------------------
 * CI holds no database. This is a check on the TEXT of supabase/migrations/, so
 * it reasons about what a migration *says*, never about what the database *is*.
 * It cannot see a grant made by hand in the SQL editor, cannot follow a function
 * granted in one migration and revoked in another, and cannot tell whether a
 * role exists. The live counterpart is nexus_public_exposure_report(), which
 * runs against a real database and needs a service-role key CI must never hold.
 *
 * Neither replaces the other: this one stops the defect being WRITTEN, that one
 * finds it once it EXISTS.
 *
 * WHY THE WHOLE TREE IS NOT BLOCKING, AND WHAT IS
 * -----------------------------------------------
 * 216 function definitions live in supabase/migrations/. 101 of them do not
 * state a full ACL in their own file, and 31 revoke statements omit `public`.
 * Making all of that blocking would put CI red on day one over history that is
 * already correct on the server: production currently shows ZERO functions of
 * ours carrying a bare PUBLIC entry (measured 7 Sep 2026), because later
 * migrations and Supabase's own default privileges landed differently than the
 * text alone suggests.
 *
 * migration-hygiene.mjs learned this lesson the expensive way — a rule whose
 * obvious remedy is data loss is worse than no rule — so the shape is the same
 * here: BLOCKING on anything newer than the watermark, a NAMED CENSUS for
 * everything at or before it. The watermark is the migration that fixed the
 * defect. Nothing written after it has an excuse.
 *
 *     node ops/ci/function-grants.mjs           check
 *     node ops/ci/function-grants.mjs --census  also print the legacy list
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'supabase', 'migrations');

/* The migration that closed the hole. Everything after it is held to the rule;
   everything at or before it is history, censused and not blocked. */
const WATERMARK = '20260907140000';

const SHOW_CENSUS = process.argv.includes('--census');

/* ── born open, then closed ───────────────────────────────────────────────
   Rule 1 asks for the revoke in the SAME migration that creates the function,
   and that is the right default: it is the only version of the rule you cannot
   forget halfway through. But a finding that has genuinely been closed by a
   later migration is not an open hole, and leaving CI red over it teaches
   people to ignore CI — which is the expensive failure, not the tidy one.

   So each entry below names the function and the migration that closed it, and
   the gate VERIFIES both: that migration must exist in this folder and must
   really contain a revoke naming `public` for that function. If someone
   deletes or edits the remediating migration, this stops exempting anything
   and the failure comes straight back. It cannot rot into a blanket pass. */
const REMEDIATED = [
  { fn: 'nexus_classify_message_intent',        by: 'nx972' },
  { fn: 'nexus_journey_on_message_recorded',    by: 'nx972' },
  { fn: 'nexus_guard_same_tenant_ref',           by: 'nx999' },
  { fn: 'nexus_journey_step_guard_ref_tenant',  by: 'nx999' },
  { fn: 'nexus_lead_endpoint_for_provider_identity', by: 'nx999' },
  /* NX976 created the trigger function and said nothing about who may call it,
     so PUBLIC kept its birth grant -- proacl really did read `=X/postgres` and
     has_function_privilege('anon', ...) really was true. That was a true
     finding, and NX983 closed it: revoke from public, anon, authenticated, then
     grant to service_role, asserted in its own $verify$ block.
     NX974 revoked PUBLIC from nexus_sales_lead_submit before NX975 revoked
     anon, so rule 2's reading of NX975 in isolation was a lexical artefact --
     the live ACL never carried a PUBLIC entry. NX983 restates the full revoke
     anyway, so the migration a reader checks and the ACL a reader checks now
     agree without needing a second file to make sense of the first. */
  { fn: 'nexus_journey_on_lead_event_promoted', by: 'nx983' },
  { fn: 'nexus_sales_lead_submit',              by: 'nx983' },
];

function remediatedBy(fnName) {
  const entry = REMEDIATED.find(r => r.fn === fnName);
  if (!entry) return null;
  const file = readdirSync(DIR).find(f => f.endsWith('.sql') && f.includes(entry.by));
  if (!file) return null;
  const sql = readFileSync(join(DIR, file), 'utf8');
  const pattern = new RegExp(
    'revoke\\s+all\\s+on\\s+function\\s+public\\.' + fnName + '\\s*\\([^)]*\\)\\s+from\\s+[^;]*\\bpublic\\b',
    'is');
  return pattern.test(sql) ? file : null;
}

/* ── parsing ──────────────────────────────────────────────────────────────
   Deliberately conservative. These patterns are matched against SQL that was
   extracted verbatim from the database, so they must tolerate the formatting a
   dozen different migrations happen to use, and must not claim a match they are
   unsure of. Anything unparseable is reported, never assumed correct. */

const DEFINE = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(([^)]*)\)([\s\S]{0,600}?)\b(?:language|as)\b/gi;
const REVOKE = /revoke\s+(?:all|execute)(?:\s+privileges)?[^;]*?\son\s+function\s+([^;]*?)\sfrom\s+([^;]+);/gi;
const GRANT  = /grant\s+execute\s+on\s+function\s+([^;]*?)\sto\s+([^;]+);/gi;

const nameOf = (target) => {
  const m = /(?:public\.)?([a-z0-9_]+)\s*\(/i.exec(String(target).trim());
  return m ? m[1].toLowerCase() : null;
};

function parse(sql) {
  const defined = [];
  DEFINE.lastIndex = 0;
  for (const m of sql.matchAll(DEFINE)) {
    defined.push({ name: m[1].toLowerCase(), isTrigger: /returns\s+trigger/i.test(m[3]) });
  }
  const revokes = [];
  for (const m of sql.matchAll(REVOKE)) {
    revokes.push({
      name: nameOf(m[1]),
      roles: m[2].split(',').map(r => r.trim().toLowerCase()).filter(Boolean),
    });
  }
  const grants = [];
  for (const m of sql.matchAll(GRANT)) {
    grants.push({ name: nameOf(m[1]), roles: m[2].split(',').map(r => r.trim().toLowerCase()) });
  }
  return { defined, revokes, grants };
}

/* ── the check ────────────────────────────────────────────────────────────── */
const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
const failures = [];
const census = { unstated: [], revokeOmitsPublic: [] };
let definedTotal = 0, newFiles = 0, newDefs = 0;

for (const file of files) {
  const version = file.slice(0, 14);
  const isNew = version > WATERMARK;
  const sql = readFileSync(join(DIR, file), 'utf8');
  const { defined, revokes, grants } = parse(sql);
  if (!defined.length && !revokes.length) continue;
  if (isNew) newFiles++;

  /* Rule 2 first, because it is the defect itself and it is about a STATEMENT,
     not about a function this file happens to define. A revoke that names the
     roles and omits `public` reads as protection and is not. */
  for (const r of revokes) {
    if (r.roles.includes('public')) continue;
    const where = `${file}: revoke on ${r.name ?? '(unparsed target)'} from ${r.roles.join(', ')}`;
    /* THE SAME VERIFIED EXEMPTION RULE 1 HAS ALREADY, AND FOR THE SAME REASON.
       Until now only rule 1 consulted REMEDIATED, so a finding rule 2 raised
       could never be cleared by a later migration no matter what that migration
       did -- the gate would keep reporting a hole that the database had closed.
       A gate that cannot be satisfied by fixing the thing it complains about is
       a gate people learn to skip, which is the expensive failure.
       This is not a softening: remediatedBy() still requires the named
       migration to EXIST in this folder and to really contain a revoke naming
       `public` for that exact function. Delete or edit it and the failure comes
       straight back. */
    /* AN UNPARSED TARGET IS A format() INSIDE PL/pgSQL, AND IT IS STILL A REAL
       FINDING. The statement protects something, and neither this checker nor a
       person reading the file can say what. Reporting it as "(unparsed target)"
       names no function and so cannot be acted on, which is how a finding
       becomes noise. So it is cleared only on the strictest possible reading:
       EVERY function the same migration defines must itself be remediated by a
       later migration containing a literal revoke naming `public` for it. One
       unremediated definition and the failure stands. That is stricter than the
       named case, not looser -- a named target needs one function cleared, an
       unparsed one needs all of them. */
    const r2ClosedBy = r.name
      ? remediatedBy(r.name)
      : (defined.length
           ? (defined.every(d => remediatedBy(d.name))
                ? [...new Set(defined.map(d => remediatedBy(d.name)))].join(' + ')
                : null)
           : null);
    if (isNew && r2ClosedBy) {
      census.revokeOmitsPublic.push(`${where}  — CLOSED by ${r2ClosedBy}`);
    } else if (isNew) {
      failures.push({
        rule: 2,
        text: `${where}\n        omits \`public\`. Both anon and authenticated keep reaching the ` +
              `function through the bare PUBLIC grant, and neither name will appear in proacl ` +
              `afterwards, so the ACL will look clean. Write: revoke ... from public, anon, authenticated;`,
      });
    } else {
      census.revokeOmitsPublic.push(where);
    }
  }

  for (const d of defined) {
    definedTotal++;
    if (isNew) newDefs++;
    const revoked = revokes.some(r => r.name === d.name && r.roles.includes('public'));
    /* A trigger function needs no grant — it runs as the table owner — but it
       still needs the revoke, because it can also be CALLED directly, and one
       of ours (lead_ingest_provider_identity_touch) was born reachable exactly
       that way. */
    const granted = grants.some(g => g.name === d.name);
    const missing = [];
    if (!revoked) missing.push('a revoke naming `public`');
    if (!granted && !d.isTrigger) missing.push('a grant naming who may execute it');

    if (!missing.length) continue;
    const where = `${file}: ${d.name}()${d.isTrigger ? ' [trigger]' : ''} — missing ${missing.join(' and ')}`;
    const closedBy = remediatedBy(d.name);
    if (isNew && closedBy) {
      census.unstated.push(`${where}  — CLOSED by ${closedBy}`);
    } else if (isNew) {
      failures.push({
        rule: 1,
        text: `${where}\n        A function is born with EXECUTE granted to PUBLIC. Say who may ` +
              `call it in the same migration that creates it, and assert it with ` +
              `has_function_privilege() rather than by reading proacl.`,
      });
    } else {
      census.unstated.push(where);
    }
  }
}

/* ── report ───────────────────────────────────────────────────────────────── */
const pad = (n) => String(n).padStart(4, ' ');
console.log('supabase/migrations/ — function grant hygiene');
console.log(`  files scanned                          ${pad(files.length)}`);
console.log(`  function definitions found             ${pad(definedTotal)}`);
console.log(`  files newer than ${WATERMARK}     ${pad(newFiles)}  (blocking)`);
console.log(`  function definitions in those files    ${pad(newDefs)}`);
console.log('');
console.log('  legacy census, at or before the watermark — reported, not blocked:');
console.log(`    definitions not stating their own ACL  ${pad(census.unstated.length)}`);
console.log(`    revokes omitting \`public\`              ${pad(census.revokeOmitsPublic.length)}`);
console.log('    Production showed ZERO of our functions carrying a bare PUBLIC entry');
console.log('    on 7 Sep 2026, so this census is hygiene, not an open breach. Confirm');
console.log('    with nexus_public_exposure_report(), which needs a database.');

if (SHOW_CENSUS) {
  for (const [title, list] of [['ACL not stated', census.unstated],
                               ['revoke omits public', census.revokeOmitsPublic]]) {
    if (!list.length) continue;
    console.log(`\n  ── ${title} ──`);
    for (const line of list) console.log(`    ${line}`);
  }
}

if (failures.length) {
  console.log(`\n${failures.length} blocking failure(s) in migrations after ${WATERMARK}:\n`);
  for (const f of failures) console.log(`  [rule ${f.rule}] ${f.text}\n`);
  process.exit(1);
}

console.log(`\nOK — every function defined after ${WATERMARK} states who may execute it.`);
