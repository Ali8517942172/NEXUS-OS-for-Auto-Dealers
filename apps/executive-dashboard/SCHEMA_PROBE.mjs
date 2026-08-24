/* Live schema probe for the dashboard screens.
 *
 * WHY THIS EXISTS
 * ---------------
 * QUALITY_GATE.mjs stubs every PostgREST response with a fixed 200 and a fake
 * row. That is the right call for rendering — it makes the render deterministic
 * — but it means a screen can ask for a column that does not exist and still
 * come up green. That is exactly what happened: team.js selected
 * `leads.lead_score`, PostgREST answered 42703, and the whole roster query died
 * in production while the gate reported a clean pass.
 *
 * This probe closes that hole. It extracts every db() path out of the screen
 * sources and runs each one against the real database with limit=1. It does not
 * care how many rows come back — only that PostgREST accepts the query. A 400
 * here is a column name the schema does not have, a filter with the wrong type,
 * or an embed PostgREST cannot resolve.
 *
 * It also checks that every HOOK.* value the screens use is a webhook path the
 * workflow_registry actually knows about, so nobody can invent an endpoint.
 *
 * USAGE
 *   NEXUS_ENV=/path/to/.env node SCHEMA_PROBE.mjs
 *
 * The env file needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Service role is
 * used on purpose: this checks the SHAPE of the query, and RLS is verified
 * separately (see the policy audit in the project docs). Never commit that file.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ENV_PATH = process.env.NEXUS_ENV || '/tmp/nexus.env';

const env = Object.fromEntries(
  (await readFile(ENV_PATH, 'utf8')).split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const SUPA = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA || !KEY) {
  console.error(`SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from ${ENV_PATH}`);
  process.exit(2);
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json' };

/* A template-literal query is only statically known up to its first ${…}.
 * Interpolations are always a filter VALUE or a limit, never a column, so the
 * static prefix carries every name worth checking. Trailing operators are
 * trimmed so the prefix is a valid query on its own. */
/* A query built by concatenation —
 *     db('v_workflow_health?select=id,name,category,'
 *        + 'is_active,health&limit=' + N)
 * — used to be read only as far as its FIRST literal, so the probe sent
 * `...trigger_detail,` to PostgREST, got PGRST100 for a select ending in a
 * comma, and reported a perfectly good query as rejected. Three files were
 * failing that way. A checker that cries wolf gets ignored, and then it cannot
 * report the real thing, so the concatenation is joined before anything is
 * sent. Only string literals joined by `+` are followed; the moment an
 * expression appears the prefix stops, which is the same rule the template
 * branch below already uses. */
function joinConcat(code, from) {
  let i = from, out = '';
  const re = /^\s*\+\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/;
  for (;;) {
    const m = re.exec(code.slice(i));
    if (!m) break;
    if (m[2].includes('${')) break;      // a template with an interpolation
    out += m[2];
    i += m[0].length;
  }
  return out;
}

function pathsIn(code) {
  const out = new Set();
  for (const m of code.matchAll(/db\(\s*[`'"]([^`'"$]+)[`'"]/g)) {
    out.add(m[1] + joinConcat(code, m.index + m[0].length));
  }
  for (const m of code.matchAll(/db\(\s*`([^`]*?)\$\{/g)) {
    let p = m[1];
    if (!p.includes('?')) continue;
    p = p.replace(/[&?][a-z_0-9.]+=(eq|gte|lte|gt|lt|ilike|like|in|is|neq)?\.?$/i, '')
         .replace(/[&?]limit=$/, '')
         .replace(/[&?]$/, '');
    out.add(p);
  }
  /* Trim any path that still ends mid-expression, whichever branch produced it —
     a select ending in a comma is a probe artefact, not a real defect. */
  return new Set([...out].map(p => p
    .replace(/[&?][a-z_0-9.]+=(eq|gte|lte|gt|lt|ilike|like|in|is|neq)?\.?$/i, '')
    .replace(/[&?]limit=$/, '')
    .replace(/,+$/, '')
    .replace(/[&?]$/, '')));
}

function hooksIn(code) {
  return new Set([...code.matchAll(/HOOK\.(\w+)/g)].map(m => m[1]));
}

function cheap(path) {
  const p = path.replace(/limit=\d*/g, 'limit=1');
  return p.includes('limit=') ? p : p + (p.includes('?') ? '&' : '?') + 'limit=1';
}

async function probe(path) {
  const r = await fetch(`${SUPA}/rest/v1/${cheap(path)}`, { headers: H });
  if (r.ok) return { ok: true, status: r.status };
  return { ok: false, status: r.status, body: (await r.text()).slice(0, 240) };
}

/* ── 1. every db() path in every screen ─────────────────────────────────── */

const dir = new URL('./screens/', import.meta.url).pathname;
const files = (await readdir(dir)).filter(f => f.endsWith('.js')).sort();
const failures = [];
const usedHooks = new Set();
let checked = 0;

for (const f of files) {
  const src = await readFile(join(dir, f), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  hooksIn(code).forEach(h => usedHooks.add(h));

  const paths = [...pathsIn(code)].sort();
  if (!paths.length) continue;
  console.log('\n' + f);
  for (const p of paths) {
    const r = await probe(p);
    checked++;
    console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.status}  ${p.slice(0, 108)}`);
    if (!r.ok) { console.log(`        ${r.body}`); failures.push({ f, p, ...r }); }
  }
}

/* ── 2. every HOOK the screens reach for must be a real registered webhook ── */

const libSrc = await readFile(new URL('./lib/data.js', import.meta.url).pathname, 'utf8');
const hookBlock = libSrc.match(/const HOOK = \{([\s\S]*?)\}/);
const HOOK = Object.fromEntries(
  [...(hookBlock?.[1] || '').matchAll(/(\w+)\s*:\s*'([^']+)'/g)].map(m => [m[1], m[2]]));

const reg = await fetch(
  `${SUPA}/rest/v1/workflow_registry?select=name,trigger_type,trigger_detail,is_active`,
  { headers: H }).then(r => r.json());
const known = new Set(reg.filter(w => w.trigger_type === 'webhook')
                         .map(w => String(w.trigger_detail).replace(/^\w+ \/webhook\//, '')));

console.log('\nHOOK map');
const hookFailures = [];
for (const name of [...usedHooks].sort()) {
  const path = HOOK[name];
  if (!path) { console.log(`  FAIL HOOK.${name} is not defined in lib/data.js`); hookFailures.push(name); continue; }
  const ok = known.has(path);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} HOOK.${name} -> ${path}${ok ? '' : '  (no active webhook workflow registered on this path)'}`);
  if (!ok) hookFailures.push(name);
}

/* ── verdict ────────────────────────────────────────────────────────────── */

console.log(`\n${checked} queries probed · ${failures.length} rejected · ` +
            `${usedHooks.size} hooks used · ${hookFailures.length} unresolved`);

if (failures.length) {
  console.log('\nREJECTED QUERIES');
  for (const x of failures) console.log(`  ${x.f}  ${x.status}\n    ${x.p}\n    ${x.body}`);
}
process.exit(failures.length || hookFailures.length ? 1 : 0);
