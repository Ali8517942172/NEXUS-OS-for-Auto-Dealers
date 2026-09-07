#!/usr/bin/env node
/* NEXUS OS — secret scan, with no database and no credential.
 *
 * WHAT THIS IS FOR
 * ----------------
 * Twelve pull requests reached main with no automated check of any kind. The
 * cheapest catastrophic mistake in a repository shaped like this one is a
 * service-role key in a committed file: it is one paste away at any moment, it
 * defeats every RLS policy L2..L5 exist to verify, and once pushed it is public
 * forever regardless of the revert.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS DOES NOT PATTERN-MATCH `eyJ` AND STOP
 * ─────────────────────────────────────────────────────────────────────────────
 * Three anon JWTs are committed here ON PURPOSE — ten n8n workflow files and
 * ops/DEMO.md carry two distinct anon keys between them. An anon key is
 * DESIGNED to ship in a browser bundle; it is the public half of the pair, it
 * carries no privilege of its own, and everything it can reach is decided by
 * RLS. Failing on it would make this job cry wolf on every run, and a job that
 * cries wolf is a job somebody adds `|| true` to.
 *
 * A service_role key looks IDENTICAL to an anon key from the outside. Same
 * issuer, same `eyJhbGciOi` prefix, same length class, same everything a regex
 * can see. The only thing that separates "safe to publish" from "hands the
 * bearer every row in every dealership" is the `role` claim in the payload.
 *
 * So this decodes the payload and reads `role`. `anon` passes and is reported
 * by name. Anything else — service_role, an unreadable payload, a payload with
 * no role at all — FAILS LOUDLY. Unreadable is a failure and not a pass on
 * purpose: a token this job cannot classify is a token nobody has classified.
 *
 * WHAT IT SCANS
 *   By default every file git tracks. --diff <base> also prints, separately,
 *   which findings this change introduced, so a PR author sees their own line
 *   rather than the whole tree's.
 *
 * EXIT  0 clean · 1 something was found · 3 this script could not run
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt  = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const DIFF_BASE = opt('--diff');
const MAX_BYTES = 8 * 1024 * 1024;

/* Each pattern requires enough trailing key material that a bare mention of the
   prefix in prose or in a CHECK constraint is not a hit. supabase/migrations/
   spells `sb_secret_` out inside guards that refuse to STORE such a value; that
   is the opposite of a leak and must not read as one. */
const PATTERNS = [
  { what: 'Supabase secret key',   re: /sb_secret_[A-Za-z0-9_-]{12,}/g },
  { what: 'JSON Web Token',        re: /eyJhbGciOi[A-Za-z0-9._-]{30,}/g, jwt: true },
  { what: 'OpenRouter API key',    re: /sk-or-v1-[A-Za-z0-9]{16,}/g },
  { what: 'Apify API token',       re: /apify_api_[A-Za-z0-9]{16,}/g },
  { what: 'Slack token',           re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { what: 'GitHub personal token', re: /ghp_[A-Za-z0-9]{20,}/g },
];

/* Returns { role, why } — role is null when the token could not be classified,
   and `why` then says which step failed. A token that cannot be classified is
   never treated as safe. */
function jwtRole(tok) {
  const parts = tok.split('.');
  if (parts.length < 2) return { role: null, why: 'it has no payload segment' };
  let json;
  try {
    json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch (e) { return { role: null, why: `its payload is not base64 (${e.message})` }; }
  let obj;
  try { obj = JSON.parse(json); } catch { return { role: null, why: 'its payload is not JSON' }; }
  if (typeof obj.role !== 'string' || !obj.role) return { role: null, why: 'its payload carries no role claim' };
  return { role: obj.role, ref: obj.ref || null, why: '' };
}

let tracked;
try {
  tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean);
} catch (e) {
  console.error(`git ls-files failed: ${String(e.stderr || e.message).trim().slice(0, 300)}`);
  process.exit(3);
}

let touched = null;
if (DIFF_BASE) {
  try {
    touched = new Set(execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${DIFF_BASE}...HEAD`],
      { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean));
  } catch (e) {
    console.error(`could not diff against ${DIFF_BASE}: ${String(e.stderr || e.message).trim().slice(0, 300)}`);
    process.exit(3);
  }
}

const findings = [], allowed = [];
let scanned = 0, skippedBig = 0, skippedBinary = 0;

for (const rel of tracked) {
  let st;
  try { st = statSync(join(REPO, rel)); } catch { continue; }
  if (!st.isFile()) continue;
  if (st.size > MAX_BYTES) { skippedBig++; continue; }
  let buf;
  try { buf = readFileSync(join(REPO, rel)); } catch { continue; }
  if (buf.includes(0)) { skippedBinary++; continue; }
  scanned++;
  const text = buf.toString('utf8');

  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      if (p.jwt) {
        const { role, ref, why } = jwtRole(m[0]);
        if (role === 'anon') {
          allowed.push(`${rel}:${line} — anon JWT${ref ? ` for project ${ref}` : ''}. An anon key is the public half of the pair and is designed to ship in a browser bundle; RLS decides what it can reach. Allowed by role claim, not by filename.`);
        } else if (role) {
          findings.push({ rel, line, what: `a JWT whose role claim is "${role}"`,
            detail: `${ref ? `project ${ref}. ` : ''}Only role "anon" may be committed. A ${role} token defeats every RLS policy L2..L5 exist to verify, and once pushed it is public regardless of the revert. Rotate it in Supabase before doing anything else — removing the line does not un-publish the key.` });
        } else {
          findings.push({ rel, line, what: 'a JWT this scan could not classify',
            detail: `${why}. An unclassifiable token is not a safe token: this job passes a JWT only when it can read role="anon" out of the payload, and it could not. Decode it by hand and either remove it or explain it.` });
        }
      } else {
        findings.push({ rel, line, what: `a ${p.what}`,
          detail: `matched ${m[0].slice(0, 14)}…. Rotate it at the issuer first; a committed credential is compromised the moment it is pushed.` });
      }
    }
  }
}

console.log('════ SECRET SCAN — no database, no credential ════');
console.log(`RAN     ${scanned} tracked text file(s) scanned for ${PATTERNS.length} credential shapes`
  + (skippedBig ? `, ${skippedBig} skipped as larger than ${MAX_BYTES} bytes` : '')
  + (skippedBinary ? `, ${skippedBinary} skipped as binary` : ''));
console.log(`RAN     every JWT found was DECODED and judged on its role claim, never on its prefix`);

if (allowed.length) {
  console.log(`\nALLOWED — ${allowed.length} committed JWT(s), each one anon:`);
  for (const a of allowed) console.log(`  ${a}`);
}

if (touched) {
  const mine = findings.filter(f => touched.has(f.rel));
  console.log(`\nOf ${findings.length} finding(s), ${mine.length} ${mine.length === 1 ? 'is' : 'are'} in a file this change touches (against ${DIFF_BASE}).`);
}

if (findings.length) {
  console.log(`\nFAIL — ${findings.length} finding(s):`);
  for (const f of findings) console.log(`  ${f.rel}:${f.line} contains ${f.what}. ${f.detail}`);
  console.log('\nThis job needs no credential and no database, so nothing above is an environment problem.');
  process.exit(1);
}
console.log('\nclean — no credential found that is not an anon key');
