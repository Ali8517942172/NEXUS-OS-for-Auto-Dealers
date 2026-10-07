/* NEXUS OS — scripts/stitch-theme.mjs

   The Tailwind theme is not typed by hand. Every Google Stitch export in
   design/stitch/*.html carries its own `tailwind.config = {...}` script, and
   this file reads it out of them so the build and the designs cannot drift.

     node scripts/stitch-theme.mjs           rewrite design/stitch/theme.json
                                             from the canonical export, then
                                             check every export against it
     node scripts/stitch-theme.mjs --check   check only (the build runs this)

   The canonical export is the app-shell master spec. Measured 7 Oct 2026:
   78 of the 81 exports carry a config identical to it after key sorting, and
   the other 3 (ask-ai--bb752c, customer-360-unified-intelligence--dc1622,
   finance-desk--331d24) differ only by OMITTING the colour `on-background`.
   An export whose config is a strict SUBSET of theme.json is reported and
   accepted -- it uses nothing the theme lacks. An export that ADDS or CHANGES a
   token fails the check: Stitch has produced a value the build does not have,
   and a class using it would silently compile to nothing. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, '..', 'design', 'stitch');
const CANONICAL = 'app-shell-master-specification-navigation-hierarchy--2b6343.html';
const OUT = join(DIR, 'theme.json');

const sortKeys = v => Array.isArray(v) ? v.map(sortKeys)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;

function configOf(file) {
  const s = readFileSync(join(DIR, file), 'utf8');
  const m = s.match(/<script[^>]*id="tailwind-config"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  const ctx = { tailwind: {} };
  vm.runInNewContext(m[1], ctx, { timeout: 1000 });
  return sortKeys(JSON.parse(JSON.stringify(ctx.tailwind.config)));
}

/* Walks b against a: returns the paths b adds or changes (a defect) and the
   paths b merely lacks (accepted). */
function compare(a, b, p = '', out = { extra: [], missing: [] }) {
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  const obj = v => v && typeof v === 'object' && !Array.isArray(v);
  if (!obj(a) || !obj(b)) { out.extra.push(`${p || '(root)'}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`); return out; }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(k in b)) out.missing.push(`${p}.${k}`);
    else if (!(k in a)) out.extra.push(`${p}.${k} (not in theme.json)`);
    else compare(a[k], b[k], `${p}.${k}`, out);
  }
  return out;
}

const checkOnly = process.argv.includes('--check');
const canonical = configOf(CANONICAL);
if (!canonical) { console.error(`stitch-theme: ${CANONICAL} carries no tailwind config`); process.exit(1); }
const theme = { darkMode: canonical.darkMode, extend: canonical.theme.extend };

if (!checkOnly) {
  writeFileSync(OUT, JSON.stringify(theme, null, 2) + '\n');
  console.log(`stitch-theme: wrote design/stitch/theme.json from ${CANONICAL}`);
}

const committed = JSON.parse(readFileSync(OUT, 'utf8'));
const want = sortKeys({ darkMode: committed.darkMode, theme: { extend: committed.extend } });
const files = readdirSync(DIR).filter(f => f.endsWith('.html')).sort();
let identical = 0; const subsets = []; const bad = [];
for (const f of files) {
  const c = configOf(f);
  if (!c) { bad.push(`${f}: no tailwind config script`); continue; }
  const d = compare(want, c);
  if (d.extra.length) bad.push(`${f}: ${d.extra.join('; ')}`);
  else if (d.missing.length) subsets.push(`${f} (lacks ${d.missing.join(', ')})`);
  else identical++;
}
console.log(`stitch-theme: ${files.length} exports — ${identical} identical to theme.json, ${subsets.length} a strict subset, ${bad.length} divergent`);
subsets.forEach(s => console.log(`  subset   ${s}`));
bad.forEach(s => console.log(`  DIVERGES ${s}`));
if (bad.length) process.exit(1);
