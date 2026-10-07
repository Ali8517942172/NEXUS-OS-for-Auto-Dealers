/* NEXUS OS — scripts/stitch-classes.mjs

   WHY THIS EXISTS. Tailwind was removed from this dashboard once (postcss.config.js
   tells it) because its content scanner only sees class names that are written
   out LITERALLY in a source file. A class assembled at runtime — `bg-${tone}`,
   `'text-' + level` — is invisible to it, is therefore never generated, and the
   element renders unstyled. It looks right in `vite dev` with a warm cache and
   wrong in the production build, which is the worst place to find out.

   Tailwind is back for the Google Stitch designs, on the condition that this
   cannot happen silently again. This script runs after `vite build` (it is part
   of `npm run build`) and fails the build on either of two things:

   1. LINT — a class string glued to an interpolation or a concatenation, where
      the glued fragment is a Tailwind utility root: `bg-${x}`, `'w-' + n`,
      `` `text-${size}` ``. Choosing a variant is done from a map of COMPLETE
      class strings (lib/stitch-ui.js shows the pattern), never by assembling
      one. A hit prints file:line and the fragment.

   2. PRESENCE — every utility Tailwind generates from the content globs in
      tailwind.config.js must be present in the CSS that `vite build` actually
      wrote to dist/assets/*.css. This is the pipeline check: it goes red if the
      PostCSS plugin is dropped, if lib/stitch.css stops being imported, if a
      minifier eats a rule, or if a new source directory is outside the globs
      (run with --globs to see what was scanned).

   The third half of the guarantee is not here, because it needs a browser:
   QUALITY_GATE.mjs R8 collects every class on every element of every rendered
   screen and asks the same presence question of the built CSS. That is the
   check that would catch a class the lint missed.

   USAGE
     node scripts/stitch-classes.mjs          lint + presence against dist/
     node scripts/stitch-classes.mjs --lint   lint only (no build needed)

   The helpers are exported for QUALITY_GATE.mjs; running the file is the CLI. */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(join(ROOT, 'package.json'));
const postcss = require('postcss');
const tailwindcss = require('tailwindcss');
const selectorParser = require('postcss-selector-parser');

/* ── source files: the same set tailwind.config.js scans ─────────────────── */
function walk(dir, test, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, test, out);
    else if (test(p)) out.push(p);
  }
  return out;
}
export function sourceFiles() {
  return [
    join(ROOT, 'index.html'),
    join(ROOT, 'app.js'),
    ...walk(join(ROOT, 'lib'), p => p.endsWith('.js')),
    ...walk(join(ROOT, 'screens'), p => p.endsWith('.js')),
    ...walk(join(ROOT, 'founder'), p => /\.(js|html)$/.test(p)),
  ].filter(existsSync);
}

/* ── 1. lint ──────────────────────────────────────────────────────────────
   The utility roots are listed rather than derived: deriving them from the
   theme would miss core utilities, and a false negative here is the original
   bug. A legacy prefix such as `t-` (lib/format.js's tone classes) or `ds-` is
   not a Tailwind root and is deliberately not matched — those classes live in
   hand-written CSS that has nothing to purge. */
const VARIANT = '(?:[a-z0-9-]+:)*';
const ROOTS = [
  'bg', 'text', 'border(?:-[trblxyse])?', 'rounded(?:-[trblse]{1,2})?', '[pm][xytrblse]?', 'w', 'h', 'size',
  'min-[wh]', 'max-[wh]', 'gap(?:-[xy])?', 'space-[xy]', 'font', 'leading', 'tracking', 'shadow', 'ring(?:-offset)?',
  'opacity', 'z', 'top', 'left', 'right', 'bottom', 'inset(?:-[xy])?', 'grid-cols', 'grid-rows', 'col-span', 'row-span',
  'col-start', 'col-end', 'items', 'justify', 'self', 'content', 'place-(?:items|content|self)', 'order',
  'translate-[xy]', 'rotate', 'scale(?:-[xy])?', 'fill', 'stroke', 'outline', 'divide(?:-[xy])?', 'from', 'via', 'to',
  'decoration', 'animate', 'duration', 'ease', 'delay', 'basis', 'grow', 'shrink', 'line-clamp', 'aspect',
  'columns', 'accent', 'caret', 'blur', 'backdrop-blur', 'brightness', 'underline-offset',
].join('|');
const GLUED_INTERP = new RegExp(`(?<![\\w-])${VARIANT}(?:${ROOTS})-\\$\\{`, 'g');
const GLUED_CONCAT = new RegExp(`(['"\`])[^'"\`\\n]*?(?<![\\w-])(${VARIANT}(?:${ROOTS})-)\\1\\s*\\+`, 'g');

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])(\/\/[^\n]*)$/gm, (m, p, c) => p + c.replace(/./g, ' '));
}
export function lint(files = sourceFiles()) {
  const hits = [];
  for (const f of files) {
    const code = stripComments(readFileSync(f, 'utf8'));
    for (const re of [GLUED_INTERP, GLUED_CONCAT]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code))) {
        const line = code.slice(0, m.index).split('\n').length;
        hits.push(`${relative(ROOT, f)}:${line}  ${m[0].replace(/\s+/g, ' ').slice(-40)}`);
      }
    }
  }
  return hits;
}

/* ── 2. presence ──────────────────────────────────────────────────────────── */
/* Every class name that appears in a selector of `css`, unescaped. */
export function classesInCss(css) {
  const out = new Set();
  const root = postcss.parse(css);
  root.walkRules(rule => {
    try {
      selectorParser(sel => sel.walkClasses(c => { out.add(c.value); })).processSync(rule.selector);
    } catch { /* a selector the parser cannot read names no Tailwind class */ }
  });
  return out;
}
export async function loadConfig() {
  return (await import(pathToFileURL(join(ROOT, 'tailwind.config.js')).href)).default;
}
/* The utilities Tailwind generates for `content` (globs, or [{ raw }]). */
export async function tailwindClasses(content) {
  const config = await loadConfig();
  const res = await postcss([tailwindcss({ ...config, content })])
    .process('@tailwind components; @tailwind utilities;', { from: undefined });
  const all = classesInCss(res.css);
  all.delete('nx-tw');
  return all;
}
/* Of `tokens` (class names seen in markup), the ones Tailwind recognises as
   utilities. Used by QUALITY_GATE.mjs R8 on the classes of the rendered DOM. */
export async function recognised(tokens) {
  const list = [...new Set(tokens)].filter(Boolean);
  const gen = await tailwindClasses([{ raw: list.join(' ') }]);
  return list.filter(t => gen.has(t));
}
export function builtCss(dist = join(ROOT, 'dist')) {
  const dir = join(dist, 'assets');
  if (!existsSync(dir)) return null;
  return readdirSync(dir).filter(f => f.endsWith('.css')).map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
}

async function main() {
  const lintOnly = process.argv.includes('--lint');
  let failed = false;

  const files = sourceFiles();
  if (process.argv.includes('--globs')) files.forEach(f => console.log('  scanned ' + relative(ROOT, f)));
  const hits = lint(files);
  if (hits.length) {
    failed = true;
    console.error(`stitch-classes: ${hits.length} class string(s) assembled at runtime from a Tailwind root —`
      + ' Tailwind cannot see these and will not generate them. Pick a complete class string from a map instead:');
    hits.forEach(h => console.error('  ' + h));
  } else {
    console.log(`stitch-classes: lint — ${files.length} files, no Tailwind class assembled at runtime`);
  }

  if (!lintOnly) {
    const css = builtCss();
    if (css == null) {
      failed = true;
      console.error('stitch-classes: dist/assets has no CSS — run `vite build` first');
    } else {
      const config = await loadConfig();
      const want = await tailwindClasses(config.content.map(g => join(ROOT, g)));
      const have = classesInCss(css);
      const missing = [...want].filter(c => !have.has(c)).sort();
      if (missing.length) {
        failed = true;
        console.error(`stitch-classes: ${missing.length} of ${want.size} Tailwind classes used in the source are MISSING from the built CSS:`);
        missing.slice(0, 60).forEach(c => console.error('  ' + c));
        if (missing.length > 60) console.error(`  … and ${missing.length - 60} more`);
      } else {
        console.log(`stitch-classes: presence — all ${want.size} Tailwind classes used in the source are in the built CSS`);
      }
    }
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
