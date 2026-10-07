// NEXUS - Resolve Tenant (finance calculator)
// ---------------------------------------------------------------------------
// finance_quotes is the table INV-001 makes the single source of every APR and
// instalment this business is allowed to show a customer. n8n writes it as
// service_role - BYPASSRLS, no auth.uid() - so a row without an explicit
// tenant_id is filed by the column default under whichever tenant holds
// is_unattributed_default. A second dealership's quote would then sit inside
// the first dealership's tenant, where its staff can read a rate that was
// quoted to somebody else's customer.
//
// ---- REWRITTEN 18 Sep 2026 (tenant-precedence wave) -----------------------
// REPLACES the 6 Sep resolver, which took the tenant_members row for the
// verified JWT user FIRST but, when that produced nothing, fell back to
// `Called as Tool`.tenant_id and then to `Webhook Trigger`.body.tenant_id.
// That last step was the defect: an authenticated user of dealership A could
// POST `tenant_id: <B>` and, on any execution where the membership lookup came
// back empty, have this workflow file the quote under B. The caller's value is
// never a source now. On the public door it is only ever a CLAIM, and a claim
// that disagrees with the membership row is refused.
//
// Two doors, two rules:
//   * public webhook -- `Webhook Trigger` -> `Verify JWT` ->
//     `Calculate Equity & Tier` -> `Tenant For JWT User` -> here. The ONLY
//     trusted answer is the tenant_members row for the Supabase user behind the
//     verified JWT. No row, or more than one row, means refuse; there is NO
//     fallback on this door, because a fallback is exactly how an unverifiable
//     caller acquires a dealership. This also subsumes the 6 Sep
//     anonymousWebhook case: an unauthenticated caller has no membership row,
//     so it refuses here rather than reaching sole_configured_tenant.
//   * internal hop -- `Called as Tool` -> `Calculate Equity & Tier` -> here.
//     `Verify JWT` never ran, which is how this node tells the doors apart.
//     The sibling workflow already resolved the dealership, so its UUID is
//     accepted; absent that, a single configured dealership is named
//     explicitly - stated rather than defaulted.
//
// Refusals carry the '[NEXUS-UNATTRIBUTED]' prefix at position 0, the contract
// with the NEXUS Error Handler (iYJkh1kztWxZXDbT): the failed execution is
// filed under the quarantine tenant instead of being appended to some real
// dealership's audit trail.
//
// This node CARRIES THE CALCULATION THROUGH UNCHANGED. It re-reads it from
// 'Calculate Equity & Tier' by name rather than from $input, because the HTTP
// node before it replaced the item with the tenant lookup's response. No figure
// is recomputed here, so INV-001's one-figure-one-derivation rule is untouched.
const NEXUS_BUILTIN = { 'default': 'fff6a2b5-cfd5-4460-8383-875bc5826de0' };  // Tenant A
const NEXUS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let nexusMap = {};
try { nexusMap = JSON.parse(String($env.NEXUS_TENANT_MAP || '')) || {}; } catch (e) { nexusMap = {}; }
if (!nexusMap || typeof nexusMap !== 'object' || !Object.keys(nexusMap).length) nexusMap = NEXUS_BUILTIN;
const nexusKeys = Object.keys(nexusMap);

// Which door? `$()` throws for a node that did not run in this execution.
// `Tenant For JWT User` is NOT usable for this test: it sits on both branches
// (Calculate Equity & Tier feeds it from the tool path too, where it queries
// the all-zero uuid). `Verify JWT` runs on the webhook branch and only there.
let viaWebhook = true;
try { $('Verify JWT').all(); } catch (e) { viaWebhook = false; }

// What the caller ASSERTED. Never authoritative; only ever cross-checked.
let claimed = '';
if (viaWebhook) {
  try {
    const wh = $('Webhook Trigger').first().json || {};
    claimed = String((wh.body && wh.body.tenant_id) || wh.tenant_id || '');
  } catch (e) { claimed = ''; }
} else {
  try {
    const tj = $('Called as Tool').first().json || {};
    claimed = String(tj.tenant_id || '');
  } catch (e) { claimed = ''; }
}

let tenant = null;
let source = 'unresolved';

if (viaWebhook) {
  let ids = [];
  try {
    ids = Array.from(new Set(
      $('Tenant For JWT User').all()
        .map((i) => (i && i.json ? i.json.tenant_id : null))
        .filter(Boolean)
        .map(String)
    ));
  } catch (e) { ids = []; }
  if (ids.length > 1) {
    throw new Error('[NEXUS-UNATTRIBUTED] Finance quote rejected: the authenticated user is a member of ' + ids.length + ' dealerships. This endpoint will not choose one on their behalf.');
  }
  if (ids.length === 0 || !NEXUS_UUID.test(ids[0])) {
    throw new Error('[NEXUS-UNATTRIBUTED] Finance quote rejected: the authenticated user has no tenant_members row. A dealership is never taken from the request body.');
  }
  if (claimed && claimed.toLowerCase() !== ids[0].toLowerCase()) {
    throw new Error('[NEXUS-UNATTRIBUTED] Finance quote rejected: caller asserted tenant_id ' + claimed + ' but is a member of ' + ids[0] + '. tenant_id is not a caller-selectable field.');
  }
  tenant = ids[0];
  source = 'jwt_tenant_member';
} else {
  if (NEXUS_UUID.test(claimed)) {
    tenant = claimed;
    source = 'internal_caller';
  } else if (nexusKeys.length === 1 && NEXUS_UUID.test(String(nexusMap[nexusKeys[0]] || ''))) {
    tenant = String(nexusMap[nexusKeys[0]]);
    source = 'sole_configured_tenant';
  } else {
    throw new Error('[NEXUS-UNATTRIBUTED] Finance quote rejected: the internal caller supplied no resolvable tenant_id and ' + nexusKeys.length + ' dealerships are configured. Refusing rather than filing this quote under a guess.');
  }
}

const calc = $('Calculate Equity & Tier').first().json || {};
return [{ json: Object.assign({}, calc, { tenant_id: tenant, tenant_source: source }) }];
