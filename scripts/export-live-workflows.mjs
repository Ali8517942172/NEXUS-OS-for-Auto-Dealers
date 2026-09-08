#!/usr/bin/env node
/**
 * NEXUS OS — export live n8n workflows into the repo.
 *
 * The live n8n instance is the source of truth. This pulls every workflow
 * down into n8n-workflows/ so the repo matches what is actually running.
 *
 * Usage (from the nexus-os folder):
 *     node scripts/export-live-workflows.mjs
 *
 * Reads N8N_API_KEY (and optionally N8N_BASE_URL) from nexus-os/.env
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = join(ROOT, 'n8n-workflows');
const ENV_PATH = join(ROOT, '.env');

const DEFAULT_BASE_URL = 'https://35.224.126.225.nip.io';

// Live workflow id -> repo filename. Keeps git history stable.
const FILE_MAP = {
  JnlZFAVmFAuNXVya: 'nexus_master_router.json',
  KI6P1Qcf3MIZakNa: 'wf_109_lead_escalation.json',
  BiyHk9ZXxJUVGbf6: 'whatsapp_bdc.json',
  VmnIXo7tM30zqawp: 'slack_router.json',
  G7FhvMY2ucW5Fg7X: 'marketing_drip.json',
  AZkGM5M4c1uzSH7S: 'customer_360.json',
  qTnh3nwWheFJbFkU: 'document_auditor.json',
  LphiGg4iqF1bn6El: 'dynamic_pricing.json',
  unMMpeL9uuPO79pp: 'finance_calc.json',
  dhy2DDjWUqwuzHLW: 'rag_sync.json',
  qHAtd3RckAKRBUkE: 'ask_ai_rag.json',
  bxNBzBrcOtcFpMPn: 'wf_108_erp_sync.json',
  B3TcpfzOMWj8oWgF: 'wf_110_silence_detector.json',
};

function loadEnv(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv(ENV_PATH);
const API_KEY = process.env.N8N_API_KEY || env.N8N_API_KEY;
const BASE_URL = (process.env.N8N_BASE_URL || env.N8N_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');

if (!API_KEY) {
  console.error('N8N_API_KEY not found in environment or nexus-os/.env');
  process.exit(1);
}

async function api(path) {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    headers: { 'X-N8N-API-KEY': API_KEY, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} -> ${res.status} ${res.statusText}\n${await res.text()}`);
  }
  return res.json();
}

/** Strip volatile fields so git diffs show real changes, not noise. */
function normalise(wf) {
  const { id, name, nodes, connections, settings } = wf;
  return {
    id,
    name,
    nodes: (nodes || []).map((n) => {
      const copy = { ...n };
      delete copy.webhookId; // regenerated per instance
      return copy;
    }),
    connections: connections || {},
    settings: settings || {},
  };
}

const main = async () => {
  mkdirSync(OUT_DIR, { recursive: true });

  const { data: workflows } = await api('/workflows?limit=200');
  console.log(`Found ${workflows.length} workflows on ${BASE_URL}\n`);

  let written = 0;
  const unmapped = [];

  for (const summary of workflows) {
    const filename = FILE_MAP[summary.id];
    if (!filename) {
      unmapped.push(`${summary.id}  ${summary.name}`);
      continue;
    }
    const full = await api(`/workflows/${summary.id}`);
    const outPath = join(OUT_DIR, filename);
    writeFileSync(outPath, JSON.stringify(normalise(full), null, 2) + '\n', 'utf8');
    console.log(`  wrote ${filename.padEnd(30)} <- ${summary.name}`);
    written++;
  }

  console.log(`\nExported ${written} workflow(s) into n8n-workflows/`);

  if (unmapped.length) {
    console.log('\nNot in FILE_MAP (add them to the map if you want them exported):');
    unmapped.forEach((u) => console.log('  ' + u));
  }

  console.log('\nNext: git add -A n8n-workflows && git commit -m "sync workflows from live n8n"');
};

main().catch((err) => {
  console.error('\nExport failed:', err.message);
  process.exit(1);
});
