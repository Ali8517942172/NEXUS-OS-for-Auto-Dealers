#!/usr/bin/env node
// NEXUS tenant-precedence red-team harness.
//
// Loads the tenant-resolver Code node jsCode straight out of the PATCHED
// workflow JSON files (never a hand-copied string) and executes it inside a
// minimal stub of n8n's Code-node globals: $input, $json, $env, $('<node>').
// $('<node>') throws "node did not run: <name>" for any node not registered
// for that scenario, matching n8n's real behaviour for a node that did not
// execute in the run -- this is how each resolver tells its two doors apart.
//
// READ-ONLY: this script only reads files under patched/ and code/. It never
// calls wf.py, never writes to n8n, never touches production.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = HERE; // this file lives in ops/tenant-precedence

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FIXED_TS = '2026-01-01T00:00:00.000Z';
const PREFIX = '[NEXUS-UNATTRIBUTED] ';

// ---------------------------------------------------------------------------
// Extract a Code node's jsCode straight out of a patched workflow JSON.
function extractNodeCode(relJsonPath, nodeName) {
  const full = path.join(REPO, relJsonPath);
  const w = JSON.parse(fs.readFileSync(full, 'utf8'));
  const node = (w.nodes || []).find((n) => n.name === nodeName);
  if (!node) throw new Error(`FIXTURE ERROR: node "${nodeName}" not found in ${relJsonPath}`);
  const code = node.parameters && node.parameters.jsCode;
  if (typeof code !== 'string' || !code.length) {
    throw new Error(`FIXTURE ERROR: node "${nodeName}" in ${relJsonPath} has no jsCode`);
  }
  return code;
}

function readCodeFile(relPath) {
  return fs.readFileSync(path.join(REPO, relPath), 'utf8');
}

// ---------------------------------------------------------------------------
// Execute a Code node's jsCode inside a stub of n8n's runtime.
//   nodes: { '<Node Name>': [ {json:{...}}, ... ] }  -- only nodes that "ran"
//   input: [ {json:{...}}, ... ]                       -- $input's own items
//   env:   { NEXUS_TENANT_MAP: '...' }                 -- $env
// Works for both "run once for all items" nodes (which use $input.all() and
// return an array) and "run once for each item" nodes (which use $json /
// $input.item and return a single {json:...} object) -- both styles appear
// among the resolvers under test, and this stub supports both without the
// resolver code needing to know which.
function runNode(code, { input = [], nodes = {}, env = {} } = {}) {
  const dollar = function (name) {
    if (!Object.prototype.hasOwnProperty.call(nodes, name)) {
      // Real n8n: $('X') throws when X did not execute in this run. This is
      // the exact mechanic every resolver under test relies on to tell its
      // public-webhook door from its internal/sub-workflow door.
      throw new Error('node did not run: ' + name);
    }
    const items = nodes[name];
    return {
      all: () => items,
      first: () => items[0],
      item: items[0],
      itemMatching: () => items[0],
    };
  };
  const $input = {
    all: () => input,
    first: () => input[0],
    item: input[0],
    itemMatching: () => input[0],
  };
  const $json = input[0] ? input[0].json : undefined;
  const $node = { name: 'stub' };
  // eslint-disable-next-line no-new-func
  const fn = new Function('$input', '$json', '$env', '$', '$node', code);
  return fn($input, $json, env, dollar, $node);
}

// Pull the tenant-fields object out of a resolver's return value, regardless
// of whether it returned an array of items (runOnceForAllItems) or a single
// bare {json:...} item (runOnceForEachItem), and regardless of whether the
// tenant fields sit at the top level or nested under an `outputContainer` key
// (the live master-router node nests them under `.lead`).
function outputJson(result, outputContainer) {
  let j;
  if (Array.isArray(result)) j = result[0] && result[0].json;
  else if (result && typeof result === 'object' && result.json) j = result.json;
  if (j && outputContainer) j = j[outputContainer] || {};
  return j;
}

function tryRun(code, scenario) {
  try {
    return { result: runNode(code, scenario), err: null };
  } catch (e) {
    return { result: undefined, err: e };
  }
}

function assertOk(result, expectTenant, expectSource, resolver) {
  const fields = resolver.fields || { id: 'tenant_id', source: 'tenant_source' };
  const j = outputJson(result, resolver.outputContainer);
  if (!j) return { status: 'FAIL', detail: 'no output item/json produced' };
  if (j[fields.id] !== expectTenant) return { status: 'FAIL', detail: `${fields.id}=${j[fields.id]} want ${expectTenant}` };
  if (expectSource && j[fields.source] !== expectSource) return { status: 'FAIL', detail: `${fields.source}=${j[fields.source]} want ${expectSource}` };
  return { status: 'PASS', detail: `${fields.id}=${j[fields.id]} ${fields.source}=${j[fields.source]}` };
}

function assertThrow(err) {
  if (!err) return { status: 'FAIL', detail: 'expected a throw, code returned success' };
  if (typeof err.message !== 'string' || err.message.indexOf(PREFIX) !== 0) {
    return { status: 'FAIL', detail: `threw but message does not start with "${PREFIX}" at index 0: ${JSON.stringify(err.message)}` };
  }
  return { status: 'PASS', detail: `correctly refused: ${err.message.slice(0, 100)}${err.message.length > 100 ? '...' : ''}` };
}

function expectSuccess(resolver, scenario, tenant, source) {
  const { result, err } = tryRun(resolver.code, scenario);
  if (err) return { status: 'FAIL', detail: `expected success, code threw: ${err.message}` };
  return assertOk(result, tenant, source, resolver);
}

function expectFailure(resolver, scenario) {
  const { result, err } = tryRun(resolver.code, scenario);
  if (!err) return { status: 'FAIL', detail: 'expected a throw, code returned success: ' + JSON.stringify(result) };
  return assertThrow(err);
}

// ---------------------------------------------------------------------------
// Resolver fixtures. Each one's `code` is read live from the patched JSON (or
// the live master-router code file) -- never inlined -- and its webhook()/
// internal() builders hand back a minimal, realistic node/input graph, built
// from actually reading each node and its upstream context.
const resolvers = [];

// 1) 7-Day Warm Lead Drip -- Resolve Tenant  (door: Verify JWT)
resolvers.push({
  key: 'drip-resolve-tenant',
  label: '7-Day Warm Lead Drip / Resolve Tenant (G7FhvMY2ucW5Fg7X)',
  code: extractNodeCode('patched/G7FhvMY2ucW5Fg7X.json', 'Resolve Tenant'),
  hasInternalDoor: true,
  webhook(claim, membershipIds) {
    const body = { email: 'lead@example.com', name: 'Jane Lead', vehicle_interest: 'SUV' };
    if (claim !== null) body.tenant_id = claim;
    return {
      nodes: {
        'DripWebhook': [{ json: { headers: { authorization: 'Bearer test-token' }, body } }],
        'Verify JWT': [{ json: { id: 'user-uuid-1', email: 'rep@dealer.com' } }],
        'Tenant For JWT User': membershipIds.map((t) => ({ json: { tenant_id: t } })),
      },
      input: [{ json: { name: 'Jane Lead', email: 'lead@example.com', phone: null, vehicle_interest: 'SUV', enrolled_at: FIXED_TS } }],
      env: {},
    };
  },
  internal(claim) {
    const lead = { email: 'lead@example.com', name: 'Jane Lead' };
    if (claim !== null) lead.tenant_id = claim;
    return {
      nodes: { 'Called by Master Router': [{ json: { lead } }] },
      input: [{ json: { name: 'Jane Lead', email: 'lead@example.com', phone: null, vehicle_interest: 'SUV', enrolled_at: FIXED_TS } }],
      env: {},
    };
  },
});

// 2) Finance Calc -- Resolve Tenant  (door: Verify JWT)
resolvers.push({
  key: 'financecalc-resolve-tenant',
  label: 'Finance Calc / Resolve Tenant (unMMpeL9uuPO79pp)',
  code: extractNodeCode('patched/unMMpeL9uuPO79pp.json', 'Resolve Tenant'),
  hasInternalDoor: true,
  webhook(claim, membershipIds) {
    const body = { vehicle_price_aed: 120000, down_payment_aed: 20000 };
    if (claim !== null) body.tenant_id = claim;
    return {
      nodes: {
        'Webhook Trigger': [{ json: { headers: { authorization: 'Bearer test-token' }, body } }],
        'Verify JWT': [{ json: { id: 'user-uuid-2' } }],
        'Tenant For JWT User': membershipIds.map((t) => ({ json: { tenant_id: t } })),
        'Calculate Equity & Tier': [{ json: { monthly_payment_aed: 2650, apr: 3.49, tier: 'prime' } }],
      },
      input: [],
      env: {},
    };
  },
  internal(claim) {
    const j = { vehicle_price_aed: 120000, down_payment_aed: 20000 };
    if (claim !== null) j.tenant_id = claim;
    return {
      nodes: {
        'Called as Tool': [{ json: j }],
        'Calculate Equity & Tier': [{ json: { monthly_payment_aed: 2650, apr: 3.49, tier: 'prime' } }],
      },
      input: [],
      env: {},
    };
  },
});

// 3) Sync Closed-Won Deals -- Format Deal Text  (door: Auth OK?)
// No executeWorkflowTrigger node exists anywhere in this workflow (only
// "Webhook - New Deal" triggers it) -- confirmed by reading every node's
// `type`. The code still carries an internal-door branch (`Auth OK?` never
// ran), but nothing in production can reach it. Cases 7-9 are N/A here.
resolvers.push({
  key: 'closedwon-format-deal-text',
  label: 'Sync Closed-Won Deals / Format Deal Text (dhy2DDjWUqwuzHLW)',
  code: extractNodeCode('patched/dhy2DDjWUqwuzHLW.json', 'Format Deal Text'),
  hasInternalDoor: false,
  internalDoorNA: 'workflow has no executeWorkflowTrigger / sibling-caller node (checked every node\'s `type` in dhy2DDjWUqwuzHLW.json) -- only "Webhook - New Deal" triggers this workflow, so the code\'s internal-door branch (Auth OK? not run) is dead in production, not just untested',
  webhook(claim, membershipIds) {
    const body = {
      customer_name: 'Jane Lead',
      lead_email: 'lead@example.com',
      vehicle: 'SUV',
      sale_price_aed: 150000,
      closed_at: FIXED_TS,
    };
    if (claim !== null) body.tenant_id = claim;
    return {
      nodes: {
        'Webhook - New Deal': [{ json: { headers: { authorization: 'Bearer test-token' }, body } }],
        'Verify JWT': [{ json: { id: 'user-uuid-3' } }],
        'Auth OK?': [{ json: { id: 'user-uuid-3' } }],
        'Tenant For JWT User': membershipIds.map((t) => ({ json: { tenant_id: t } })),
      },
      input: [],
      env: {},
    };
  },
});

// 4) KYC/AML Document Auditor -- Prepare Document  (door: Auth Gate)
resolvers.push({
  key: 'kyc-prepare-document',
  label: 'KYC/AML Document Auditor / Prepare Document (qTnh3nwWheFJbFkU)',
  code: extractNodeCode('patched/qTnh3nwWheFJbFkU.json', 'Prepare Document'),
  hasInternalDoor: true,
  webhook(claim, membershipIds) {
    const body = { document_text: 'Emirates ID, front', lead_email: 'lead@example.com', chat_id: '971501234567' };
    if (claim !== null) body.tenant_id = claim;
    return {
      nodes: {
        'Auth Gate': [{ json: { tenant_id: membershipIds[0] || null } }],
        'Tenant For JWT User': membershipIds.map((t) => ({ json: { tenant_id: t } })),
      },
      input: [{ json: { body } }],
      env: {},
    };
  },
  internal(claim) {
    const j = { document_text: 'Emirates ID, front', lead_email: 'lead@example.com', chat_id: '971501234567' };
    if (claim !== null) j.tenant_id = claim;
    return {
      nodes: {},
      input: [{ json: j }],
      env: {},
    };
  },
});

// 5) NEXUS Master Lead Router -- Validate & Enrich Input (LIVE)  (door: Auth Gate)
resolvers.push({
  key: 'master-router-validate-enrich',
  label: 'NEXUS Master Lead Router / Validate & Enrich Input (LIVE, code/master-router.Validate-and-Enrich-Input.js)',
  code: readCodeFile('code/master-router.Validate-and-Enrich-Input.js'),
  hasInternalDoor: true,
  // This node's own return shape nests the tenant fields under json.lead.*,
  // not json.* directly (it returns [{json:{lead:{... tenant_id ...}}}]).
  outputContainer: 'lead',
  webhook(claim, membershipIds) {
    const body = { email: 'lead@example.com', name: 'Jane Lead', phone: null, vehicle_interest: 'SUV' };
    if (claim !== null) body.tenant_id = claim;
    return {
      nodes: {
        'Auth Gate': [{ json: { tenant_id: membershipIds[0] || null } }],
        'Tenant For JWT User': membershipIds.map((t) => ({ json: { tenant_id: t } })),
      },
      input: [{ json: { body } }],
      env: {},
    };
  },
  internal(claim) {
    const lead = { email: 'lead@example.com', name: 'Jane Lead' };
    if (claim !== null) lead.tenant_id = claim;
    return {
      nodes: {},
      input: [{ json: { lead } }],
      env: {},
    };
  },
});

// 6) wf_108 ERP Sync (Bitrix24) -- Resolve Tenant  (door: Auth Gate; runOnceForEachItem)
//
// Structurally different from the five resolvers above: on the webhook door,
// the ONLY edge into this node is Auth Gate -> Fetch HOT Leads from Supabase
// -> Resolve Tenant (confirmed by reading every `connections` edge in the
// patched JSON) -- there is no path where Auth Gate runs but the Supabase
// sweep does not. The item this node sees on that door is therefore always a
// `leads` ROW from Postgres, not the ErpSyncWebhook request body (which is
// never read by this node or by anything upstream of it). That row's own
// tenant_id column is server-side truth for a deliberate cross-tenant backlog
// walk (per the node's own comments), not a caller-suppliable claim -- so
// cases 3/4 (claim-vs-membership mismatch) have no caller-claim surface to
// exercise here and are N/A; case 11 (added for this resolver) exercises the
// real per-row-truth behaviour instead. Output fields are `_nexus_tenant_id` /
// `_nexus_tenant_source`, and the node returns a bare {json:...} item
// (runOnceForEachItem), not an array.
{
  const code = extractNodeCode('patched/bxNBzBrcOtcFpMPn.json', 'Resolve Tenant');
  const fields = { id: '_nexus_tenant_id', source: '_nexus_tenant_source' };

  function bxWebhookScenario(membershipIds, rowTenant) {
    const row = {
      id: 501, name: 'Jane Lead', email: 'lead@example.com', phone: null, source: 'webhook',
      vehicle_interest: 'SUV', budget_aed: 120000, ai_score: 91, status: 'HOT',
      created_at: FIXED_TS, bitrix_lead_id: null, crm_synced_at: null,
    };
    if (rowTenant !== null) row.tenant_id = rowTenant;
    return {
      nodes: {
        'Verify JWT': [{ json: { id: 'user-uuid-9' } }],
        'Auth Gate': [{ json: { id: 'user-uuid-9' } }],
        'Tenant For JWT User': membershipIds.map((t) => ({ json: { tenant_id: t } })),
        'Fetch HOT Leads from Supabase': [{ json: row }],
      },
      input: [{ json: row }], // $json for this runOnceForEachItem call IS the row
      env: {},
    };
  }
  function bxInternalScenario(claim) {
    const lead = { id: 502, name: 'Jane Lead', email: 'lead@example.com' };
    if (claim !== null) lead.tenant_id = claim;
    return {
      nodes: { 'Called by Master Router': [{ json: { lead } }] },
      input: [{ json: { lead } }],
      env: {},
    };
  }

  const resolver = {
    key: 'erpsync-resolve-tenant',
    label: 'wf_108 ERP Sync (Bitrix24) / Resolve Tenant (bxNBzBrcOtcFpMPn)',
    code,
    fields,
    hasInternalDoor: true,
    maxCase: 11,
    caseOverrides: {
      1: () => expectSuccess(resolver, bxWebhookScenario([TENANT_A], null), TENANT_A, 'jwt_tenant_member'),
      2: () => expectSuccess(resolver, bxWebhookScenario([TENANT_A], TENANT_A), TENANT_A, 'supabase_row'),
      3: () => ({ status: 'N/A', reason: 'no caller-suppliable tenant_id claim exists on this door: Resolve Tenant never reads ErpSyncWebhook\'s request body (confirmed by reading the code and every upstream connection) -- the only per-item data is the Supabase row\'s own tenant_id column, which is server-side truth by design, not attacker input. See case 11, which exercises that row-authoritative behaviour instead.' }),
      4: () => ({ status: 'N/A', reason: 'same as case 3 (reverse direction): there is no caller-suppliable claim field on this door to set to a conflicting value.' }),
      5: () => expectFailure(resolver, bxWebhookScenario([], null)),
      6: () => expectFailure(resolver, bxWebhookScenario([TENANT_A, TENANT_B], null)),
      7: () => expectSuccess(resolver, bxInternalScenario(TENANT_A), TENANT_A, 'internal_caller'),
      8: () => {
        const s = bxInternalScenario(null);
        s.env = { NEXUS_TENANT_MAP: JSON.stringify({ dealer_one: TENANT_A }) };
        return expectSuccess(resolver, s, TENANT_A, 'sole_configured_tenant');
      },
      9: () => {
        const s = bxInternalScenario(null);
        s.env = { NEXUS_TENANT_MAP: JSON.stringify({ dealer_one: TENANT_A, dealer_two: TENANT_B }) };
        return expectFailure(resolver, s);
      },
      10: () => {
        const s1 = bxWebhookScenario([TENANT_A], null);
        const s2 = bxWebhookScenario([TENANT_A], null);
        const r1 = tryRun(resolver.code, s1);
        const r2 = tryRun(resolver.code, s2);
        if (r1.err || r2.err) {
          const same = !!r1.err && !!r2.err && r1.err.message === r2.err.message;
          return { status: same ? 'PASS' : 'FAIL', detail: same ? 'both runs threw identically' : `runs diverged: ${r1.err && r1.err.message} vs ${r2.err && r2.err.message}` };
        }
        const same = JSON.stringify(r1.result) === JSON.stringify(r2.result);
        return { status: same ? 'PASS' : 'FAIL', detail: same ? 'identical output across two independent runs' : 'outputs diverged' };
      },
      11: () => expectSuccess(
        resolver,
        bxWebhookScenario([TENANT_A], TENANT_B), // authenticated as a member of A, but this backlog row is B's
        TENANT_B,
        'supabase_row'
      ),
    },
  };
  resolvers.push(resolver);
}

// 7) Lead Escalation -- Resolve Tenant  (door: Auth Gate; runOnceForEachItem)
//
// Same compare-and-throw shape as the first five resolvers, just addressed
// differently: this node runs once per item (`$json`, bare {json:...}
// return) rather than once for all items, and its output fields are
// `_nexus_tenant_id` / `_nexus_tenant_source`. `Auth Gate` here is a Code node
// that re-emits `$('EscalationWebhook').all()` verbatim on success, so the
// original webhook body (and any tenant_id it asserts) really does reach this
// node -- unlike wf_108's Auth Gate, which sits in front of a Supabase sweep.
// A manual `Test Lead` (Set node) also feeds this node directly, alongside
// `Called by Master Router`; the code cannot and does not distinguish them
// from each other -- both are simply "Auth Gate did not run" -- so both are
// already covered by the internal-door cases (7-9) below; no separate case is
// needed for `Test Lead`.
resolvers.push({
  key: 'lead-escalation-resolve-tenant',
  label: 'Lead Escalation / Resolve Tenant (KI6P1Qcf3MIZakNa)',
  code: extractNodeCode('patched/KI6P1Qcf3MIZakNa.json', 'Resolve Tenant'),
  fields: { id: '_nexus_tenant_id', source: '_nexus_tenant_source' },
  hasInternalDoor: true,
  webhook(claim, membershipIds) {
    const body = { lead_id: 77, escalation_reason: 'no reply after 3 attempts' };
    if (claim !== null) body.tenant_id = claim;
    return {
      nodes: {
        'Auth Gate': [{ json: { headers: { authorization: 'Bearer test-token' }, body } }],
        'Tenant For JWT User': membershipIds.map((t) => ({ json: { tenant_id: t } })),
      },
      input: [{ json: { headers: { authorization: 'Bearer test-token' }, body } }],
      env: {},
    };
  },
  internal(claim) {
    const lead = { lead_id: 77, escalation_reason: 'no reply after 3 attempts' };
    if (claim !== null) lead.tenant_id = claim;
    return {
      nodes: { 'Called by Master Router': [{ json: { lead } }] },
      input: [{ json: { lead } }],
      env: {},
    };
  },
});

// ---------------------------------------------------------------------------
// The 10 (or, for one resolver, 11) adversarial cases, generically applied.
function runCase(resolver, caseNum) {
  if (resolver.caseOverrides && Object.prototype.hasOwnProperty.call(resolver.caseOverrides, caseNum)) {
    return resolver.caseOverrides[caseNum]();
  }

  switch (caseNum) {
    case 1: // webhook, member of A, no claim -> tenant A
      return expectSuccess(resolver, resolver.webhook(null, [TENANT_A]), TENANT_A, 'jwt_tenant_member');
    case 2: // webhook, member of A, claim A -> tenant A
      return expectSuccess(resolver, resolver.webhook(TENANT_A, [TENANT_A]), TENANT_A, 'jwt_tenant_member');
    case 3: // webhook, member of A, claim B -> THROW
      return expectFailure(resolver, resolver.webhook(TENANT_B, [TENANT_A]));
    case 4: // webhook, member of B, claim A -> THROW (reverse)
      return expectFailure(resolver, resolver.webhook(TENANT_A, [TENANT_B]));
    case 5: // webhook, 0 membership rows -> THROW
      return expectFailure(resolver, resolver.webhook(null, []));
    case 6: // webhook, 2 rows (A and B) -> THROW
      return expectFailure(resolver, resolver.webhook(null, [TENANT_A, TENANT_B]));
    case 7: // internal door, sibling claim A -> tenant A
      if (!resolver.hasInternalDoor) return { status: 'N/A', reason: resolver.internalDoorNA };
      return expectSuccess(resolver, resolver.internal(TENANT_A), TENANT_A, 'internal_caller');
    case 8: { // internal door, no claim, map has 1 entry -> that tenant, sole_configured_tenant
      if (!resolver.hasInternalDoor) return { status: 'N/A', reason: resolver.internalDoorNA };
      const s = resolver.internal(null);
      s.env = { NEXUS_TENANT_MAP: JSON.stringify({ dealer_one: TENANT_A }) };
      return expectSuccess(resolver, s, TENANT_A, 'sole_configured_tenant');
    }
    case 9: { // internal door, no claim, map has 2 entries -> THROW
      if (!resolver.hasInternalDoor) return { status: 'N/A', reason: resolver.internalDoorNA };
      const s = resolver.internal(null);
      s.env = { NEXUS_TENANT_MAP: JSON.stringify({ dealer_one: TENANT_A, dealer_two: TENANT_B }) };
      return expectFailure(resolver, s);
    }
    case 10: { // replay: run case 1 twice with identical input -> identical output
      const s1 = resolver.webhook(null, [TENANT_A]);
      const s2 = resolver.webhook(null, [TENANT_A]);
      const r1 = tryRun(resolver.code, s1);
      const r2 = tryRun(resolver.code, s2);
      if (r1.err || r2.err) {
        const same = !!r1.err && !!r2.err && r1.err.message === r2.err.message;
        return { status: same ? 'PASS' : 'FAIL', detail: same ? 'both runs threw identically: ' + r1.err.message.slice(0, 90) : `runs diverged: e1=${r1.err && r1.err.message} e2=${r2.err && r2.err.message}` };
      }
      const same = JSON.stringify(r1.result) === JSON.stringify(r2.result);
      return { status: same ? 'PASS' : 'FAIL', detail: same ? 'identical output across two independent runs' : `outputs diverged: r1=${JSON.stringify(r1.result)} r2=${JSON.stringify(r2.result)}` };
    }
    default:
      throw new Error('unknown case ' + caseNum);
  }
}

// ---------------------------------------------------------------------------
const CASE_LABELS = {
  1: '1. webhook, member A, no claim -> tenant A',
  2: '2. webhook, member A, claim A -> tenant A',
  3: '3. webhook, member A, claim B -> THROW',
  4: '4. webhook, member B, claim A -> THROW (reverse)',
  5: '5. webhook, 0 membership rows -> THROW',
  6: '6. webhook, 2 rows (A,B) -> THROW',
  7: '7. internal door, sibling claim A -> tenant A',
  8: '8. internal door, no claim, map 1 entry -> sole_configured_tenant',
  9: '9. internal door, no claim, map 2 entries -> THROW',
  10: '10. replay determinism (case 1 x2)',
  11: '11. backlog sweep row of tenant B (caller member of A) -> tenant B, per-row',
};
const MAX_CASE_OVERALL = Math.max(...resolvers.map((r) => r.maxCase || 10));

const results = []; // { resolver, caseNum, status, detail/reason }
for (const resolver of resolvers) {
  const maxCase = resolver.maxCase || 10;
  for (let c = 1; c <= maxCase; c++) {
    let r;
    try {
      r = runCase(resolver, c);
    } catch (e) {
      r = { status: 'FAIL', detail: 'harness/fixture exception: ' + (e && e.stack || e) };
    }
    results.push({ resolver, caseNum: c, ...r });
  }
}

// ---------------------------------------------------------------------------
// Report.
const lines = [];
lines.push('# NEXUS tenant-precedence red-team results');
lines.push('');
lines.push('Generated by `ops/tenant-precedence/redteam.mjs`. Read-only: this run never called');
lines.push('`wf.py apply` and never touched anything under `patched/`. Every resolver\'s jsCode was');
lines.push('read live out of its patched workflow JSON (or the live master-router code file) and');
lines.push('executed inside a stub of n8n\'s Code-node globals (`$input`, `$json`, `$env`, `$(\'node\')`');
lines.push('throwing "node did not run" for any node not wired into that scenario).');
lines.push('');
lines.push('Tenants used: A=`' + TENANT_A + '`, B=`' + TENANT_B + '`.');
lines.push('Every THROW case is verified to carry the `[NEXUS-UNATTRIBUTED] ` prefix at message index 0.');
lines.push('');

// Summary table: resolver x case -> status
const header = ['Resolver', ...Array.from({ length: MAX_CASE_OVERALL }, (_, i) => String(i + 1))];
lines.push('| ' + header.join(' | ') + ' |');
lines.push('|' + header.map(() => '---').join('|') + '|');
for (const resolver of resolvers) {
  const row = [resolver.label];
  const maxCase = resolver.maxCase || 10;
  for (let c = 1; c <= MAX_CASE_OVERALL; c++) {
    if (c > maxCase) { row.push('-'); continue; }
    const r = results.find((x) => x.resolver === resolver && x.caseNum === c);
    row.push(r.status);
  }
  lines.push('| ' + row.join(' | ') + ' |');
}
lines.push('');

lines.push('## Case legend');
lines.push('');
for (let c = 1; c <= MAX_CASE_OVERALL; c++) lines.push(`- ${CASE_LABELS[c]}`);
lines.push('');
lines.push('Case 11 applies only to the ERP Sync resolver (its backlog-sweep, per-row-tenant branch);');
lines.push('every other resolver shows `-` in that column, not N/A or FAIL, because the case does not');
lines.push('apply to their design at all (it is specific to the Supabase backlog sweep).');
lines.push('');

lines.push('## Detail');
lines.push('');
for (const resolver of resolvers) {
  lines.push(`### ${resolver.label}`);
  lines.push('');
  lines.push('| # | case | status | detail / reason |');
  lines.push('|---|---|---|---|');
  const maxCase = resolver.maxCase || 10;
  for (let c = 1; c <= maxCase; c++) {
    const r = results.find((x) => x.resolver === resolver && x.caseNum === c);
    const detail = (r.detail || r.reason || '').replace(/\|/g, '\\|');
    lines.push(`| ${c} | ${CASE_LABELS[c]} | ${r.status} | ${detail} |`);
  }
  lines.push('');
}

const outPath = path.join(REPO, 'REDTEAM-RESULTS.md');
fs.writeFileSync(outPath, lines.join('\n') + '\n');

// Console summary for the calling agent.
console.log('Wrote', outPath);
for (const resolver of resolvers) {
  const rs = results.filter((x) => x.resolver === resolver);
  const pass = rs.filter((x) => x.status === 'PASS').length;
  const fail = rs.filter((x) => x.status === 'FAIL').length;
  const na = rs.filter((x) => x.status === 'N/A').length;
  console.log(`${resolver.key}: PASS=${pass} FAIL=${fail} N/A=${na}`);
}
const allFails = results.filter((x) => x.status === 'FAIL');
if (allFails.length) {
  console.log('\nFAILS:');
  for (const f of allFails) {
    console.log(`  [${f.resolver.key}] case ${f.caseNum} (${CASE_LABELS[f.caseNum]}): ${f.detail}`);
  }
} else {
  console.log('\nNo FAILs.');
}
