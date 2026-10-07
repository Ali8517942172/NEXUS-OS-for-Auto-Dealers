// NEXUS tenant resolver -- wf_108 ERP Sync (Bitrix24).
//
// REPLACES the 2 Sep 2026 resolver, which read the caller's tenant_id FIRST:
//     let t = String((lead && lead.tenant_id) || j.tenant_id || '');
// and only fell back to the configured map. On the PUBLIC webhook door that
// order let any holder of a valid Supabase session token name a dealership in
// the request and have this workflow push that dealership's leads into
// Bitrix24 and PATCH its `leads` rows -- n8n writes as service_role, which is
// BYPASSRLS, so nothing downstream would have stopped it. The caller's
// tenant_id is now never a SOURCE. It is only ever a CLAIM.
//
// THREE signals, and which door each belongs to:
//
//   * public webhook -- `ErpSyncWebhook` -> `Verify JWT` ->
//     `Tenant For JWT User` -> `Auth Gate` -> `Fetch HOT Leads from Supabase`
//     -> here.  `Tenant For JWT User` (added 18 Sep 2026) is the ONLY trusted
//     answer for the caller's own identity: the tenant_members row for the
//     Supabase user behind the verified JWT. No row, or more than one row,
//     means refuse. There is no fallback on this door, because a fallback is
//     exactly how an unverifiable caller acquires a dealership.
//
//   * backlog sweep -- the items that actually arrive here on that door are
//     NOT the request body. `Fetch HOT Leads from Supabase` is an HTTP GET
//     that REPLACES them with flat `leads` rows read straight from Postgres,
//     each carrying its own tenant_id. That value is database truth, not a
//     caller assertion, so it stays authoritative per row and the sweep keeps
//     walking every dealership's hot leads exactly as it does today. A row
//     whose tenant_id is null or malformed no longer falls back to the
//     configured map -- it falls back to the VERIFIED CALLER's dealership,
//     which is the only tenant this execution can justify.
//
//   * internal hop -- `Called by Master Router` -> here. `Auth Gate` never
//     ran, which is how this node tells the doors apart. The caller is a
//     sibling workflow that already resolved the dealership from the WAHA
//     session or the authenticated user, so its UUID is accepted. With no
//     UUID and exactly one dealership configured we name that one explicitly;
//     with two or more we refuse rather than file the lead under a guess.
//
// Refusals carry the '[NEXUS-UNATTRIBUTED]' prefix at POSITION 0 -- the
// contract with the NEXUS Error Handler (iYJkh1kztWxZXDbT). The failed
// execution is filed under the quarantine tenant instead of being appended to
// some real dealership's audit trail. Keep the marker at the start: the
// handler tests position 0, so a copy embedded in a request payload cannot
// trigger it.
//
// Downstream contract is unchanged: read the tenant as
//   $('Resolve Tenant').item.json._nexus_tenant_id
// It is now always a valid UUID when this node returns -- the old `null`
// ("TENANT UNRESOLVED") outcome has become a refusal instead.
const NEXUS_BUILTIN = { 'default': 'fff6a2b5-cfd5-4460-8383-875bc5826de0' };  // Tenant A
const NEXUS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let nexusMap = {};
try { nexusMap = JSON.parse(String($env.NEXUS_TENANT_MAP || '')) || {}; } catch (e) { nexusMap = {}; }
if (!nexusMap || typeof nexusMap !== 'object' || !Object.keys(nexusMap).length) nexusMap = NEXUS_BUILTIN;
const nexusKeys = Object.keys(nexusMap);

const j = $json || {};

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
    throw new Error('[NEXUS-UNATTRIBUTED] ERP sync rejected: the authenticated user is a member of ' + ids.length + ' dealerships. This endpoint will not choose one on their behalf.');
  }
  if (ids.length === 0 || !NEXUS_UUID.test(ids[0])) {
    throw new Error('[NEXUS-UNATTRIBUTED] ERP sync rejected: the authenticated user has no tenant_members row. A dealership is never taken from the request body.');
  }
  const jwtTenant = ids[0];

  // Did this item come out of the Supabase sweep, or is it something else?
  let viaSweep = true;
  try { $('Fetch HOT Leads from Supabase').all(); } catch (e) { viaSweep = false; }
  const rowTenant = viaSweep ? String(j.tenant_id || '') : '';

  if (viaSweep && NEXUS_UUID.test(rowTenant)) {
    // Database truth for THIS row. Deliberately not narrowed to the caller's
    // own dealership: the sweep is a cross-tenant backlog walk and each item
    // is scoped by the value the item itself carries.
    tenant = rowTenant;
    tenantSource = 'supabase_row';
  } else {
    tenant = jwtTenant;
    tenantSource = 'jwt_tenant_member';
  }
} else {
  // What the internal caller ASSERTED. Trusted only because `Auth Gate` did
  // not run, i.e. this is an n8n-to-n8n hop already inside the boundary.
  const claimed = String(((j.lead || {}).tenant_id) || j.tenant_id || '');
  if (NEXUS_UUID.test(claimed)) {
    tenant = claimed;
    tenantSource = 'internal_caller';
  } else if (nexusKeys.length === 1 && NEXUS_UUID.test(String(nexusMap[nexusKeys[0]] || ''))) {
    tenant = String(nexusMap[nexusKeys[0]]);
    tenantSource = 'sole_configured_tenant';
  } else {
    throw new Error('[NEXUS-UNATTRIBUTED] ERP sync rejected: the internal caller supplied no resolvable tenant_id and ' + nexusKeys.length + ' dealerships are configured. Refusing rather than syncing this lead under a guess.');
  }
}

// Pass the ORIGINAL item through untouched apart from the added keys, so
// 'Map Lead to Bitrix24 Lead' sees exactly the shape it saw before.
return { json: Object.assign({}, j, { _nexus_tenant_id: tenant, _nexus_tenant_source: tenantSource }) };
