// Accept a raw webhook POST (data under .body) or a direct/sub-workflow call.
const raw = $input.first().json;
const src = raw.body || raw.lead || raw;

const clean = (v) => (v === undefined || v === null || v === false || v === '') ? null : String(v).trim();

const email = clean(src.email);
const phone = clean(src.phone) || clean(src.whatsapp);

if (!email && !phone) {
  throw new Error('Rejected: inbound lead has neither an email nor a phone number. Keys received: ' + Object.keys(src).join(', '));
}

// ---- TENANT (18 Sep 2026) -------------------------------------------------
// REPLACES the 2 Sep resolver, which read `src.tenant_id` FIRST and only fell
// back to the JWT. That order let an authenticated user of dealership A post
// `tenant_id: <B>` and have this workflow create the leads row under B --
// n8n writes as service_role, which is BYPASSRLS, so nothing downstream would
// have stopped it. The caller's tenant_id is now never a source. It is only
// ever a claim, and a claim that disagrees with the membership row is refused.
//
// Two doors, two rules:
//   * public webhook  -- `Webhook Catch-All` -> `Verify JWT` ->
//     `Tenant For JWT User` -> `Auth Gate` -> here. The ONLY trusted answer is
//     the tenant_members row for the Supabase user behind the verified JWT.
//     No row, or more than one row, means refuse; there is no fallback on this
//     door, because a fallback is exactly how an unverifiable caller acquires
//     a dealership.
//   * internal hop    -- `Called Internally` -> here. The caller is a sibling
//     workflow that already resolved the dealership; `Auth Gate` never ran, so
//     that is how this node tells the doors apart.
//
// Refusals carry the '[NEXUS-UNATTRIBUTED]' prefix at position 0, the contract
// with the NEXUS Error Handler (iYJkh1kztWxZXDbT): the failed execution is
// filed under the quarantine tenant instead of being appended to some real
// dealership's audit trail.
const NEXUS_BUILTIN = { 'default': 'fff6a2b5-cfd5-4460-8383-875bc5826de0' };  // ALBA CARS
const NEXUS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let nexusMap = {};
try { nexusMap = JSON.parse(String($env.NEXUS_TENANT_MAP || '')) || {}; } catch (e) { nexusMap = {}; }
if (!nexusMap || typeof nexusMap !== 'object' || !Object.keys(nexusMap).length) nexusMap = NEXUS_BUILTIN;
const nexusKeys = Object.keys(nexusMap);

// What the caller ASSERTED. Never authoritative; only ever cross-checked.
const claimed = String(src.tenant_id || raw.tenant_id || '');

// Which door? `$()` throws for a node that did not run in this execution.
let viaWebhook = true;
try { $('Auth Gate').all(); } catch (e) { viaWebhook = false; }

let tenant = null;
let tenantSource = 'unresolved';

if (viaWebhook) {
  const ids = Array.from(new Set(
    $('Tenant For JWT User').all()
      .map((i) => (i && i.json ? i.json.tenant_id : null))
      .filter(Boolean)
      .map(String)
  ));
  if (ids.length > 1) {
    throw new Error('[NEXUS-UNATTRIBUTED] Lead rejected: the authenticated user is a member of ' + ids.length + ' dealerships. This endpoint will not choose one on their behalf.');
  }
  if (ids.length === 0 || !NEXUS_UUID.test(ids[0])) {
    throw new Error('[NEXUS-UNATTRIBUTED] Lead rejected: the authenticated user has no tenant_members row. A dealership is never taken from the request body.');
  }
  if (claimed && claimed.toLowerCase() !== ids[0].toLowerCase()) {
    throw new Error('[NEXUS-UNATTRIBUTED] Lead rejected: caller asserted tenant_id ' + claimed + ' but is a member of ' + ids[0] + '. tenant_id is not a caller-selectable field.');
  }
  tenant = ids[0];
  tenantSource = 'jwt_tenant_member';
} else {
  if (NEXUS_UUID.test(claimed)) {
    tenant = claimed;
    tenantSource = 'internal_caller';
  } else if (nexusKeys.length === 1 && NEXUS_UUID.test(String(nexusMap[nexusKeys[0]] || ''))) {
    tenant = String(nexusMap[nexusKeys[0]]);
    tenantSource = 'sole_configured_tenant';
  } else {
    throw new Error('[NEXUS-UNATTRIBUTED] Lead rejected: the internal caller supplied no resolvable tenant_id and ' + nexusKeys.length + ' dealerships are configured. Refusing rather than filing this lead under a guess.');
  }
}

return [{
  json: {
    lead: {
      name: clean(src.name) || clean(src.full_name) || 'Unknown',
      email: email,
      phone: phone,
      vehicle_interest: clean(src.vehicle_interest) || clean(src.vehicleInterest) || clean(src.message) || null,
      budget_aed: src.budget_aed ? Number(src.budget_aed) : null,
      source: clean(src.source) || 'webhook',
      // Travels with the lead so the sub-workflows this router fans out to --
      // the BDC agent, the drip, the ERP sync -- write under the right
      // dealership too.
      tenant_id: tenant,
      tenant_source: tenantSource,
      // Who handed us this lead. 'whatsapp-bdc' means the person is ALREADY in
      // a live WhatsApp thread that the BDC agent has just answered, so the
      // outreach branches below must not fire a canned welcome at them on top
      // of the reply they are reading right now. Everything else -- scoring,
      // the Slack alert, the ERP write, the drip -- still applies.
      origin: clean(src.origin) || 'external',
      received_at: new Date().toISOString()
    }
  }
}];
