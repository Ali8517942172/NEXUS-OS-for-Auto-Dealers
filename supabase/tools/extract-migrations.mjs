#!/usr/bin/env node
/* NEXUS OS — re-extract supabase/migrations/ from the database that owns it.
 *
 * WHY THIS IS A SCRIPT AND NOT A PARAGRAPH IN A README
 * ----------------------------------------------------
 * The folder this writes is a snapshot of a table, and snapshots rot. The repo
 * already has one monument to a regeneration procedure that was written down
 * and then not run: architecture/schema.sql still calls itself AUTHORITATIVE
 * and is a hundred migrations behind. A procedure a person has to retype is a
 * procedure that gets skipped, so the procedure is this file.
 *
 * WHAT IT DOES
 *   Reads supabase_migrations.schema_migrations and writes one file per row,
 *   named <version>_<name>.sql, containing statements[1] VERBATIM. Nothing is
 *   reformatted, re-indented or "improved": the file has to be what was
 *   actually applied, or it is worth nothing.
 *
 * USAGE
 *   NEXUS_DB_URL=postgres://…  node supabase/tools/extract-migrations.mjs
 *   …                                                          --check
 *
 *   --check   write nothing; exit 1 if the folder and the database disagree.
 *             This is the same question QUALITY_GATE.mjs asks as L11, in a form
 *             you can put in front of a commit.
 *
 * THE ONE REFUSAL
 *   A database restored from supabase/baseline/ has its history stamped by
 *   version and name, with no statements — the bodies were left here rather
 *   than duplicated into the table. Extracting from such a database would
 *   replace 1.6 MB of real migration bodies with 243 empty files and would look
 *   like a successful run. So: a row with no statements never overwrites a file
 *   that has content. It is reported and skipped.
 */
import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT  = join(HERE, '..', 'migrations');
const CHECK = process.argv.includes('--check');
const url = process.env.NEXUS_DB_URL;

if (!url) {
  console.error('NEXUS_DB_URL is not set. This reads supabase_migrations.schema_migrations, which PostgREST does not expose, so it needs a SQL connection.');
  process.exit(3);
}

const SQL = `select coalesce(json_agg(json_build_object(
  'v', version, 'n', name, 'b', statements[1]) order by version), '[]'::json)::text
from supabase_migrations.schema_migrations;`;

let rows;
try {
  const out = execFileSync('psql', [url, '-Atqc', SQL], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  rows = JSON.parse(out.trim());
} catch (e) {
  console.error('could not read the migration history:', String(e.stderr || e.message).trim().slice(0, 400));
  process.exit(3);
}

const md5 = s => createHash('md5').update(s, 'utf8').digest('hex');
const safe = n => (String(n).replace(/[^0-9a-zA-Z_]+/g, '_').replace(/^_+|_+$/g, '') || 'unnamed');

await mkdir(OUT, { recursive: true });
const existing = new Map();
for (const f of (await readdir(OUT).catch(() => []))) {
  const m = /^(\d{14})_(.+)\.sql$/.exec(f);
  if (m) existing.set(m[1], { file: f, body: await readFile(join(OUT, f), 'utf8') });
}

const wrote = [], skippedEmpty = [], unchanged = [], changed = [], orphaned = [];
for (const r of rows) {
  if (!/^\d{14}$/.test(String(r.v))) { console.error(`refusing ${r.v}: not a 14-digit version, the CLI could not order it`); process.exit(1); }
  const file = `${r.v}_${safe(r.n)}.sql`;
  const body = r.b;
  const prev = existing.get(r.v);
  if (body == null || body === '') {
    if (prev && prev.body.length) { skippedEmpty.push(`${r.v} (${prev.file} kept: ${prev.body.length} bytes here, nothing recorded there)`); continue; }
    skippedEmpty.push(`${r.v} (no body recorded and no file here either)`);
    continue;
  }
  if (prev && prev.file === file && md5(prev.body) === md5(body)) { unchanged.push(r.v); continue; }
  if (prev) changed.push(`${r.v}: ${prev.file}${prev.file === file ? '' : ` -> ${file}`}`);
  else changed.push(`${r.v}: new (${file})`);
  if (!CHECK) { await writeFile(join(OUT, file), body, 'utf8'); }
  wrote.push(file);
}
for (const [v, e] of existing) if (!rows.some(r => r.v === v)) orphaned.push(`${e.file} has no row in the database`);

console.log(`database rows: ${rows.length}   files already correct: ${unchanged.length}   ${CHECK ? 'would write' : 'written'}: ${wrote.length}`);
for (const c of changed.slice(0, 40)) console.log('  ' + (CHECK ? 'DIFFERS  ' : 'wrote    ') + c);
if (changed.length > 40) console.log(`  … and ${changed.length - 40} more`);
for (const s of skippedEmpty) console.log('  SKIPPED  ' + s);
for (const o of orphaned) console.log('  EXTRA    ' + o);

if (skippedEmpty.length)
  console.log(`\n${skippedEmpty.length} row(s) had no recorded statements. If that is most of them, this is a database restored from supabase/baseline/ and it is not a source to extract from — point NEXUS_DB_URL at the project that has the real history.`);

if (CHECK && (changed.length || orphaned.length)) {
  console.log('\nsupabase/migrations/ and the database disagree. Re-run without --check, then commit.');
  process.exit(1);
}
console.log(CHECK ? '\nin sync' : '\ndone');
