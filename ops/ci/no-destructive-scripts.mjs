#!/usr/bin/env node
// ops/ci/no-destructive-scripts.mjs
//
// Blocks destructive SQL from reaching main.
//
// R1  `drop table` against a core NEXUS table. DDL is NOT stopped by the
//     NX900/NX950 delete guards - a trigger cannot refuse a DROP - so the repo
//     is the last gate.
// R2  `delete from public.<core table>` with no tenant predicate in the same
//     statement. An unscoped delete crosses tenants.
//
// Exempt directories (historical evidence - they record what was once true and
// must not be rewritten):
//   ops/journey-lab/DO-NOT-RUN-IN-PRODUCTION/   quarantined destructive scripts
//   ops/evidence/                               audit evidence
//   AGENTS/                                     agent run records
//
// No dependencies. Walks the repo with fs. Exit 1 on any finding.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const CORE_TABLES = [
  'leads',
  'inventory',
  'customers',
  'conversation',
  'customer',
  'tenants',
  'channel_registry',
  'channel_message_events',
  'audit_log',
  'communication_logs',
  'lead_event',
];

// Longest first so `customers` wins over `customer`; trailing [a-z0-9_]* catches
// the real variants (conversations, customer_360_profiles, lead_events).
const TABLE_ALT = [...CORE_TABLES].sort((a, b) => b.length - a.length).join('|');
const TABLE_RE = '(?:' + TABLE_ALT + ')[a-z0-9_]*';

const DROP_SRC = 'drop\\s+table\\s+(?:if\\s+exists\\s+)?(?:public\\.)?"?(' + TABLE_RE + ')';
const DELETE_SRC = 'delete\\s+from\\s+public\\.(' + TABLE_RE + ')';

const EXEMPT_DIRS = [
  'ops/journey-lab/DO-NOT-RUN-IN-PRODUCTION/',
  'ops/evidence/',
  'AGENTS/',
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);

// ---------------------------------------------------------------------------
// Narrow exemptions. Each is PINNED TO A LINE NUMBER: if the file changes and
// the statement moves, the guard fires again and a human must look at it.
// Nothing here is a blanket file or directory pass.
// ---------------------------------------------------------------------------
const EXEMPT_LINES = new Map([
  // Template literal that PRINTS operator cleanup instructions after a gate run.
  // It is an error message, not SQL this process executes. Dashboard-owned file.
  ['apps/executive-dashboard/QUALITY_GATE.mjs', new Set([4340])],

  // Prose in a historical audit. Quotes a drop-table string as an input the status
  // allowlist validator REJECTS - it is the negative test case, not a statement.
  // (Worded without the literal pattern so this guard does not flag its own source.)
  ['docs/audit-2026-08-30/webhookauth/DESIGN.md', new Set([251])],

  // Deliberate RLS break-tests. These deletes are EXPECTED TO BE REFUSED (42501);
  // documenting them is the point. Line 155 is the labelled control.
  ['ops/pilot-isolation/BREAK-TESTS.md', new Set([152, 155])],

  // Undo procedure for an n8n bundle that is marked NOT-DEPLOYED in its own path.
  // Targets internal `[SILENCE-ESCALATED]` marker rows within one run window.
  ['ops/n8n-bundle-NOT-DEPLOYED/08-publish-phase6-silence-detector-NOT-DEPLOYED.md', new Set([96])],

  // Journey-lab staging regression suite. Scoped to the `racelab-concurrency-%`
  // fixture prefix, not to a tenant. KNOWN GAP: this pair should carry a
  // tenant_id predicate before it is ever pointed at a shared project.
  ['ops/journey-lab/CONCURRENCY-REGRESSION.sql', new Set([106, 107])],
]);

// Frozen git patch archives. A .patch is a byte-for-byte record of a past commit,
// is never applied by CI, and is not executable SQL. When one IS applied the
// result lands as real files, which these same rules then scan.
const SKIP_EXT = new Set([
  '.patch', '.diff',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.pdf',
  '.zip', '.gz', '.tgz', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mov',
]);

function isExemptDir(rel) {
  return EXEMPT_DIRS.some((d) => rel === d.slice(0, -1) || rel.startsWith(d));
}

function isExemptLine(rel, line) {
  const s = EXEMPT_LINES.get(rel);
  return s !== undefined && s.has(line);
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(abs, out);
    } else if (e.isFile()) {
      if (SKIP_EXT.has(path.extname(e.name).toLowerCase())) continue;
      out.push(rel);
    }
  }
  return out;
}

function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') n++;
  return n;
}

function lineTextAt(text, index) {
  const ls = text.lastIndexOf('\n', index) + 1;
  let le = text.indexOf('\n', index);
  if (le === -1) le = text.length;
  return { ls, le, raw: text.slice(ls, le) };
}

function snippet(text, index) {
  return lineTextAt(text, index).raw.trim().replace(/\s+/g, ' ').slice(0, 160);
}

// A statement sitting after `--` on its own line is commented out and cannot run.
function isSqlComment(text, index) {
  const { ls, raw } = lineTextAt(text, index);
  const dash = raw.indexOf('--');
  return dash !== -1 && ls + dash < index;
}

// The statement a match sits in: back to the previous `;`, forward to the next.
function statementAround(text, index) {
  const start = text.lastIndexOf(';', index) + 1;
  let end = text.indexOf(';', index);
  if (end === -1) end = text.length;
  return text.slice(start, end);
}

// `tenant_id =` is the tenant predicate everywhere except on `tenants` itself,
// where the tenant IS the row and `id =` is the same guarantee.
function isTenantScoped(stmt, table) {
  if (/tenant_id[ \t]*=/i.test(stmt)) return true;
  if (/^tenants/i.test(table) && /\bid[ \t]*=/i.test(stmt)) return true;
  return false;
}

const findings = [];

for (const rel of walk(ROOT, [])) {
  if (isExemptDir(rel)) continue;

  let text;
  try {
    text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    continue;
  }
  if (text.indexOf("\u0000") !== -1) continue; // binary

  const add = (index, rule) => {
    if (isSqlComment(text, index)) return;
    const line = lineOf(text, index);
    if (isExemptLine(rel, line)) return;
    findings.push({ rel, line, rule, snippet: snippet(text, index) });
  };

  const dropAll = new RegExp(DROP_SRC, "gi");
  let m;
  while ((m = dropAll.exec(text)) !== null) add(m.index, "R1 drop table");

  const delAll = new RegExp(DELETE_SRC, "gi");
  while ((m = delAll.exec(text)) !== null) {
    if (isTenantScoped(statementAround(text, m.index), m[1])) continue;
    add(m.index, "R2 delete without tenant predicate");
  }
}

findings.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line);

for (const f of findings) {
  console.log(f.rel + ":" + f.line + " | [" + f.rule + "] " + f.snippet);
}

if (findings.length === 0) {
  console.log("clean");
  process.exit(0);
}
console.log(findings.length + " blocking finding(s)");
process.exit(1);
