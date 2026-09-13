#!/usr/bin/env node
/* NEXUS OS — assert the DEPLOYED dashboard bundle's data contract.
 *
 * WHY THIS EXISTS
 * ---------------
 * Twice now this repository has decided something about the dashboard from the
 * source tree and been wrong about the product.
 *
 *   1. The lead-source readiness flip was held back on 7 September on the
 *      belief that the dashboard carrying `rpc/nexus_lead_record_manual` had
 *      not shipped. It had. The decision was only settled by downloading
 *      `/assets/main-*.js` from Vercel and counting occurrences of
 *      `rpc/nexus_lead_record_manual`, `Add a lead` and `leads?id=eq`.
 *   2. The working assumption that every dashboard write goes through a
 *      SECURITY DEFINER function was false. `lib/unit-form.js` POSTs and
 *      PATCHes `inventory` directly, and until 7 September `lib/lead-drawer.js`
 *      PATCHed `leads` directly. Finding those is the only reason a
 *      grant-narrowing pass did not take two live screens down.
 *
 * The rule that came out of both: for the frontend, the deployed bundle is
 * operational truth and the source tree is reproducibility. This script makes
 * the bundle's contract a measurement anyone can re-run in ten seconds instead
 * of a fact somebody re-establishes by hand each time.
 *
 * It is the frontend twin of the n8n rule — live box = operational truth, git
 * export = reproducibility — and it is deliberately narrow. It asserts the
 * DATA CONTRACT only: which RPCs the bundle calls, which direct table writes it
 * contains, and which it must NOT contain. It says nothing about behaviour.
 *
 * WHAT IT CAN AND CANNOT SEE
 * --------------------------
 * It reads a minified JavaScript bundle as text and counts substrings. That is
 * enough for a PostgREST path, because every one of them is a string literal in
 * `lib/data.js`'s callers, and Vite's minifier does not rewrite string
 * contents. It is NOT enough for anything assembled at runtime: `rpc/${fn}` in
 * `screens/actions.js` and `${table}?${parts.join('&')}` in `lib/identity.js`
 * survive as the bare names `action_decide`, `v_communication_log_evidence` and
 * so on, with no `rpc/` or `?` beside them. Pins for those are written against
 * the bare name and say so.
 *
 * It also cannot see privileges. "The bundle calls this RPC" is not "the caller
 * may execute it" — that question is answered against the live catalogue in
 * SCREEN-DATA-MAP.md beside this file.
 *
 * EXIT CODES — repo convention
 *   0  every pin held
 *   1  at least one pin failed — a finding
 *   3  could not run: the bundle could not be fetched, or was not plausibly a
 *      bundle. NEVER 0. A gate that goes green when it cannot reach its subject
 *      is worse than no gate, and this repository has already found gates that
 *      could not go red.
 *
 *     node ops/frontend-contract/verify-bundle.mjs
 *     node ops/frontend-contract/verify-bundle.mjs --url https://staging.example/
 *     node ops/frontend-contract/verify-bundle.mjs --file /tmp/main.js
 *     node ops/frontend-contract/verify-bundle.mjs --list   print counts, pin nothing
 *
 * No dependencies beyond Node's standard library. No credentials: the bundle is
 * served publicly, which is exactly why its contents are worth pinning.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   PINNED CONTRACT FACTS — edit this block, and only this block.

   CHANGING A PIN IS A DECISION, NOT A FORMALITY. Each line below is a claim
   about what the live product does. A pin that starts failing is telling you
   the deployed dashboard changed; the correct first move is to find out why,
   not to edit the number until the script is quiet again. In particular:

     · Adding a MUST_NOT entry closes something off. Removing one re-opens it.
     · `min` on a MUST entry is a floor, not an equality, so ordinary refactors
       that duplicate a call site do not turn CI red. Raising a floor asserts
       that a screen now exists; lowering one asserts that a screen went away.
     · The two direct table writes below are the whole reason `inventory` keeps
       column-level INSERT and UPDATE grants for `authenticated`. If a pin here
       says a direct write is gone, the matching grant becomes revocable — and
       that is a database change to make deliberately, with the SCREEN-DATA-MAP
       column-grant index open in front of you.

   Recorded against the bundle measured on 8 September 2026:
   nexus-os-dashboard-six.vercel.app /assets/main-BFmkO_-a.js, 1,499,871 bytes,
   sha256 9c24e71ea338209fb7a4ef72808ea16156db6be72b7f002511e5b34d1ca280cd.
   ═══════════════════════════════════════════════════════════════════════════ */

const DEFAULT_SITE = 'https://nexus-os-dashboard-six.vercel.app/';

/* Substrings that MUST appear, with the minimum number of occurrences and the
   reason the pin exists. `note` is printed on failure, so write it for whoever
   is reading a red CI job at 2am and does not have this file's context. */
const MUST_CONTAIN = [
  // ── writes that go through a database function ──────────────────────────
  { needle: 'rpc/nexus_lead_record_manual', min: 1,
    note: 'lib/manual-lead-form.js — the manual lead entry path. Its presence in the '
        + 'DEPLOYED bundle is what makes nexus_lead_source_readiness() able to answer '
        + 'CONNECTED for phone_call and walk_in. This is the exact probe that settled '
        + 'the 7 Sep readiness argument.' },
  { needle: 'rpc/nexus_lead_assign_owner', min: 1,
    note: 'lib/lead-drawer.js — owner assignment. SECURITY INVOKER, so it still needs '
        + 'the column-level UPDATE grant on leads(assigned_to, assigned_to_id). If this '
        + 'disappears, read ops/migrations-held/ before revoking anything.' },
  { needle: 'rpc/inventory_delete_unit', min: 1,
    note: 'lib/unit-form.js — deleting a vehicle. Chosen over DELETE on the table so a '
        + 'refusal raises NX001 instead of returning 200 with an empty array.' },
  { needle: 'rpc/nexus_team_invite', min: 1,
    note: 'screens/team.js access management. All five team RPCs are SECURITY DEFINER '
        + 'owned by postgres and need no table grants.' },
  { needle: 'rpc/nexus_team_set_role', min: 1, note: 'screens/team.js — role changes.' },
  { needle: 'rpc/nexus_team_revoke_access', min: 1, note: 'screens/team.js — taking access away.' },
  // Built as `rpc/${fn}` in screens/actions.js, so only the bare name survives
  // minification. Pinned on the bare name deliberately.
  { needle: 'action_decide', min: 1,
    note: 'screens/actions.js — approve/reject an inventory action. Called as rpc/${fn}, '
        + 'so the bundle carries the bare name and never the literal "rpc/action_decide".' },
  { needle: 'action_mark_executed', min: 1, note: 'screens/actions.js — same rpc/${fn} shape.' },
  { needle: 'action_propose', min: 1, note: 'screens/actions.js — same rpc/${fn} shape.' },
  { needle: 'action_cancel', min: 1, note: 'screens/actions.js — same rpc/${fn} shape.' },

  // ── the direct table write that is still live ───────────────────────────
  { needle: 'inventory?id=eq.', min: 1,
    note: 'lib/unit-form.js PATCHes inventory directly. This is one of the two direct '
        + 'table writes in the product and the reason authenticated holds column-level '
        + 'UPDATE on inventory(id, model, vin, status, price_aed, cost_aed, '
        + 'ai_recommendation, acquired_at). Any ALTER TABLE on public.inventory fires '
        + 'nexus_guard_born_open_grants(), whose table-level REVOKE strips those column '
        + 'grants and breaks this write.' },

  // ── reads whose absence would mean a whole screen went away ─────────────
  { needle: 'rpc/sentinel_inventory_actions', min: 1,
    note: 'The Inventory Profit Sentinel, read through the function rather than the view '
        + 'by screens/inventory.js, actions.js, money-leaks.js and overview.js. '
        + 'SECURITY INVOKER — it reads its base tables as the caller.' },
  { needle: 'rpc/nexus_workflow_catalogue', min: 1,
    note: 'The workflow register, read through a SECURITY DEFINER function. This is what '
        + 'replaced direct reads of workflow_registry when that table left the dealer '
        + 'plane on 6 Sep 2026; authenticated holds no grant on the table itself.' },
  { needle: 'rpc/nexus_lead_source_readiness', min: 1,
    note: 'screens/lead-sources.js — the readiness answer this dashboard is judged on.' },
  { needle: 'v_needs_attention', min: 1,
    note: 'The attention feed. Thirteen screens plus lib/badges.js read it; its absence '
        + 'is not a refactor, it is an outage.' },
];

/* Substrings that MUST NOT appear, ever, with the reason. */
const MUST_NOT_CONTAIN = [
  { needle: 'leads?id=eq',
    note: 'The dashboard must not PATCH leads directly any more — owner assignment moved '
        + 'to rpc/nexus_lead_assign_owner on 7 Sep 2026 so that a reassignment writes an '
        + 'audit row. This pin is the standing answer to "does the deployed bundle still '
        + 'need the column-level UPDATE grant on leads for a direct PATCH", and the '
        + 'answer is no. It is NOT the answer to "is the grant unused" — the RPC is '
        + 'SECURITY INVOKER and needs the same grant. See ops/migrations-held/.' },
  { needle: 'workflow_registry?',
    note: 'workflow_registry left the dealer plane on 6 Sep 2026 and authenticated holds '
        + 'no grant on it. A PostgREST read of it from the browser would fail 42501. The '
        + 'bare word still appears twice in the bundle, both times as UI prose, which is '
        + 'why this pin requires the "?" that makes it a PostgREST path.' },
  { needle: 'sb_secret_',
    note: 'A service-role key in a public bundle. ops/ci/secret-scan.mjs guards the '
        + 'repository; this guards the artefact that is actually served.' },
  { needle: 'service_role',
    note: 'The browser must never present or name the service-role key. Every request it '
        + 'makes is as `authenticated`, and RLS is the boundary.' },
  { needle: 'rpc/nexus_public_exposure_report',
    note: 'This database’s own security posture. It was reachable by every signed-in '
        + 'dealership user for three days in September; nothing in a browser bundle has '
        + 'any business calling it.' },
];

/* ═══════════════════════ end of the editable block ════════════════════════ */

import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const SITE = arg('--url') || DEFAULT_SITE;
const FILE = arg('--file');
const LIST_ONLY = argv.includes('--list');
const TIMEOUT_MS = Number(arg('--timeout') || 20000);

/* Anything that stops us from measuring is exit 3, and it says so in the same
   sentence, so nobody has to guess whether a quiet run was a pass. */
function cannotRun(what, detail) {
  console.error('CANNOT RUN — nothing below was measured, and this is not a pass.');
  console.error(`  ${what}`);
  if (detail) console.error(`  ${detail}`);
  console.error('  Exit 3. Fix the fetch, or pass --file with a bundle downloaded by hand.');
  process.exit(3);
}

async function get(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
    if (!res.ok) return { ok: false, why: `${url} answered ${res.status} ${res.statusText}` };
    return { ok: true, text: await res.text(), url: res.url };
  } catch (e) {
    return { ok: false, why: `${url} — ${String((e && e.message) || e)}` };
  } finally {
    clearTimeout(timer);
  }
}

/* ── acquire the bundle ────────────────────────────────────────────────────
   The filename is content-hashed and changes on every deploy, so it is read
   out of the served index.html rather than pinned. Pinning the hash would make
   this script fail on every deploy, which trains people to ignore it. */
let source, bundle;

if (FILE) {
  try {
    bundle = readFileSync(FILE, 'utf8');
    source = `file ${FILE}`;
  } catch (e) {
    cannotRun(`could not read ${FILE}`, String((e && e.message) || e));
  }
} else {
  const index = await get(SITE);
  if (!index.ok) cannotRun('could not fetch the site index.', index.why);

  const m = /(?:src|href)=["']([^"']*assets\/main-[A-Za-z0-9_-]+\.js)["']/.exec(index.text);
  if (!m) {
    cannotRun('the served index.html names no /assets/main-*.js bundle.',
      'Either the deploy changed its asset naming, or what came back was not the app '
      + '(a login wall or an error page will also parse as HTML).');
  }
  const bundleUrl = new URL(m[1], index.url || SITE).toString();
  const got = await get(bundleUrl);
  if (!got.ok) cannotRun('could not fetch the bundle named by index.html.', got.why);
  bundle = got.text;
  source = bundleUrl;
}

/* A 404 page, a Vercel auth wall and an empty file are all "text". Refuse to
   measure anything that is not plausibly the application bundle. */
if (!bundle || bundle.length < 200000) {
  cannotRun(`what came back from ${source} is ${bundle ? bundle.length : 0} bytes.`,
    'The bundle has been ~1.5 MB all September. Something smaller is a wall or an error '
    + 'page, and counting substrings in it would produce confident nonsense.');
}
if (!bundle.includes('/rest/v1/')) {
  cannotRun(`${source} carries no "/rest/v1/" — it is not this dashboard's bundle.`,
    'Every database call in the app is built on that prefix in lib/data.js.');
}

const count = (needle) => {
  let n = 0, i = 0;
  while ((i = bundle.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
};

/* ── report ───────────────────────────────────────────────────────────────── */
const bytes = Buffer.byteLength(bundle, 'utf8');
console.log('NEXUS OS — deployed dashboard bundle, data contract');
console.log(`  source   ${source}`);
console.log(`  bytes    ${bytes.toLocaleString('en-US')}`);
console.log('');

if (LIST_ONLY) {
  console.log('  --list: counts only, nothing is pinned and nothing can fail.');
  for (const p of [...MUST_CONTAIN, ...MUST_NOT_CONTAIN]) {
    console.log(`    ${String(count(p.needle)).padStart(4)}  ${p.needle}`);
  }
  process.exit(0);
}

const failures = [];

console.log('  must contain');
for (const p of MUST_CONTAIN) {
  const n = count(p.needle);
  const ok = n >= p.min;
  console.log(`    ${ok ? 'ok  ' : 'FAIL'}  ${String(n).padStart(3)} (min ${p.min})  ${p.needle}`);
  if (!ok) failures.push({ kind: 'missing', ...p, n });
}

console.log('  must not contain');
for (const p of MUST_NOT_CONTAIN) {
  const n = count(p.needle);
  const ok = n === 0;
  console.log(`    ${ok ? 'ok  ' : 'FAIL'}  ${String(n).padStart(3)} (must be 0)  ${p.needle}`);
  if (!ok) failures.push({ kind: 'present', ...p, n });
}

if (failures.length) {
  console.log(`\n${failures.length} pin(s) failed. Each one is a claim about the live product `
            + 'that is no longer true:\n');
  for (const f of failures) {
    console.log(f.kind === 'missing'
      ? `  MISSING  ${f.needle} — found ${f.n}, expected at least ${f.min}`
      : `  PRESENT  ${f.needle} — found ${f.n}, expected none`);
    console.log(`           ${f.note}\n`);
  }
  console.log('Do not edit a pin to make this quiet. Find out what changed in the deploy,');
  console.log('then change the pin as a decision — the block at the top of this file says');
  console.log('what each one is load-bearing for. ops/frontend-contract/SCREEN-DATA-MAP.md');
  console.log('carries the grant and screen consequences.');
  process.exit(1);
}

console.log('\nOK — every pinned contract fact holds against the bundle actually served.');
console.log('This says nothing about privileges: whether `authenticated` may call these');
console.log('objects is measured against the live catalogue in SCREEN-DATA-MAP.md.');
