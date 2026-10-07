// -- Entry-path resolution ------------------------------------------------
// Webhook - New Deal -> Verify JWT -> Tenant For JWT User -> Auth OK? -> here
//                                             (public HTTP; auth enforced)
// direct / manual call -> here                (already trusted)
//
// $('Webhook - New Deal') THROWS when that node did not run in this execution
// -- it does NOT return undefined, so `?.` and `||` cannot rescue it, and an
// Expression field cannot hold try/catch.
let webhookJson = null;
try {
  webhookJson = $('Webhook - New Deal').first().json;
} catch (e) {
  // non-webhook path -- the trigger never executed.
}

let raw;
if (webhookJson) {
  // 6 Sep 2026: the real refusal now happens at the 'Auth OK?' IF node before
  // this one, which answers HTTP 401 with a JSON body and writes its own
  // REJECTED audit row. This check is kept as a BACKSTOP only -- on the live
  // webhook path it is unreachable, because an item with no verified user took
  // the false branch and never got here.
  //
  // Until that branch existed the throw below WAS the refusal, and because the
  // webhook is responseMode:responseNode a thrown execution reached no Respond
  // node at all: the caller got HTTP 200 with an empty body and could not tell
  // a refusal from a success.
  let auth = {};
  try { auth = $('Verify JWT').first().json || {}; } catch (e) { auth = {}; }
  if (!auth.id) {
    // The '[NEXUS-UNATTRIBUTED]' prefix is a contract with the NEXUS Error
    // Handler (iYJkh1kztWxZXDbT). An execution that failed BEFORE it
    // authenticated its caller belongs to no dealership, so that workflow omits
    // tenant_id and audit_log's own DEFAULT nexus_default_tenant_id() retains
    // the row under the quarantine tenant instead of appending an anonymous
    // stranger's row to Tenant A' audit trail. Keep the marker at the START of
    // the message: the handler tests position 0.
    throw new Error('[NEXUS-UNATTRIBUTED] Closed-won sync aborted: unauthorized. A valid Supabase session token is required in the Authorization header.');
  }
  raw = webhookJson;
} else {
  raw = $input.first().json;
}

// -- Normalise the deal ---------------------------------------------------
// The dashboard posts a closed-won deal as
//   { lead_email, lead_name, phone, vehicle, sale_price_aed, closed_at }
// with no deal_id at all, while this node used to demand deal_id and read
// customer_name / amount_aed. That mismatch aborted every single run.
// Both vocabularies are accepted now.
const d = raw.body || raw.deal || raw;

const clean = (v) => (v === undefined || v === null || v === '') ? null : String(v).trim();

const customer = clean(d.customer_name) || clean(d.lead_name) || clean(d.name);
const email    = clean(d.lead_email) || clean(d.email);
const vehicle  = clean(d.vehicle) || clean(d.vehicle_interest);
const amount   = (d.amount_aed !== undefined && d.amount_aed !== null) ? d.amount_aed : d.sale_price_aed;
const closedAt = clean(d.closed_at) || clean(d.closedAt);

// -- INV-002: the originating lead ----------------------------------------
// purchase_history.lead_id -- integer, NULLABLE, no default, FK
// purchase_history_lead_id_fkey -> leads(id) ON DELETE SET NULL -- was added
// on 2 Sep 2026 (migration inv002_purchase_history_lead_id). Before that this
// node's returned object was CLOSED, so a lead_id posted by the dashboard was
// read into `d` here and then silently dropped, reaching no storage at all.
//
// Coerced to a positive integer because leads.id is integer/serial. Anything
// absent, empty or non-integral becomes null, which the column documents as
// 'provenance not recorded' -- deliberately NOT an error: a bad id must not
// cost us the sale itself by turning the insert into a 400 or an FK violation.
const leadIdRaw = (d.lead_id !== undefined && d.lead_id !== null) ? d.lead_id : d.leadId;
const leadIdNum = Number(leadIdRaw);
const leadId = (leadIdRaw !== undefined && leadIdRaw !== null && leadIdRaw !== '' && Number.isInteger(leadIdNum) && leadIdNum > 0)
  ? leadIdNum
  : null;

let dealId = clean(d.deal_id) || clean(d.dealId) || clean(d.id);
if (!dealId) {
  // No id supplied. Derive a DETERMINISTIC one so that re-posting the same
  // deal overwrites its existing vector row instead of adding a duplicate.
  // NOTE: lead_id is deliberately NOT part of this key. deal_id is the dedupe
  // key on both sides (pgvector on_conflict=deal_id, and the partial unique
  // index purchase_history_deal_id_key that makes Record Purchase's
  // 'resolution=ignore-duplicates' idempotent). Changing its shape would give
  // one sale two ids across the change, hence two vector rows.
  const key = email || customer;
  if (!key) {
    throw new Error('Rejected: closed-won deal has neither a deal_id nor a lead_email/customer name to derive one from. Keys received: ' + Object.keys(d).join(', '));
  }
  dealId = 'auto:' + key.toLowerCase() + '|' + (closedAt || 'no-close-date');
}

// ---- TENANT (rewritten 18 Sep 2026, tenant-precedence wave) ---------------
// purchase_history and deals_embeddings are revenue. n8n writes them as
// service_role -- BYPASSRLS, no auth.uid() -- so without an explicit tenant_id
// the column default files them under whichever tenant holds
// is_unattributed_default: a second dealership's sale would appear on the FIRST
// dealership's Deals screen and inside its revenue total.
//
// REPLACES the 2 Sep resolver, which read `d.tenant_id || raw.tenant_id` FIRST
// and only consulted `Tenant For JWT User` when the body carried nothing. That
// order let an authenticated user of dealership A POST `tenant_id: <B>` and
// book the sale -- and its revenue -- under B. The caller's value is never a
// source now. It is only ever a CLAIM, and on the public door a claim that
// disagrees with the membership row is refused.
//
// Two doors, two rules:
//   * public webhook -- `Webhook - New Deal` -> `Verify JWT` ->
//     `Tenant For JWT User` -> `Auth OK?` -> here. The ONLY trusted answer is
//     the tenant_members row for the Supabase user behind the verified JWT.
//     No row, or more than one row, means refuse; there is NO fallback on this
//     door, because a fallback is exactly how an unverifiable caller acquires
//     a dealership.
//   * internal / direct call -- `Auth OK?` never ran, which is how this node
//     tells the doors apart. The sibling workflow already resolved the
//     dealership, so its UUID is accepted; absent that, a single configured
//     dealership is named explicitly -- stated rather than defaulted.
//
// Refusals carry the '[NEXUS-UNATTRIBUTED]' prefix at position 0, the contract
// with the NEXUS Error Handler (iYJkh1kztWxZXDbT): the failed execution is
// filed under the quarantine tenant instead of being appended to some real
// dealership's audit trail.
const NEXUS_BUILTIN = { 'default': 'fff6a2b5-cfd5-4460-8383-875bc5826de0' };  // Tenant A
const NEXUS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let nexusMap = {};
try { nexusMap = JSON.parse(String($env.NEXUS_TENANT_MAP || '')) || {}; } catch (e) { nexusMap = {}; }
if (!nexusMap || typeof nexusMap !== 'object' || !Object.keys(nexusMap).length) nexusMap = NEXUS_BUILTIN;
const nexusKeys = Object.keys(nexusMap);

// What the caller ASSERTED. Never authoritative; only ever cross-checked.
const claimed = String(d.tenant_id || raw.tenant_id || '');

// Which door? `$()` throws for a node that did not run in this execution.
let viaWebhook = true;
try { $('Auth OK?').all(); } catch (e) { viaWebhook = false; }

let tenant = null;
let tenantSource = 'unresolved';

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
    throw new Error('[NEXUS-UNATTRIBUTED] Closed-won sync aborted: the authenticated user is a member of ' + ids.length + ' dealerships. This endpoint will not choose one on their behalf.');
  }
  if (ids.length === 0 || !NEXUS_UUID.test(ids[0])) {
    throw new Error('[NEXUS-UNATTRIBUTED] Closed-won sync aborted: the authenticated user has no tenant_members row. A dealership is never taken from the request body.');
  }
  if (claimed && claimed.toLowerCase() !== ids[0].toLowerCase()) {
    throw new Error('[NEXUS-UNATTRIBUTED] Closed-won sync aborted: caller asserted tenant_id ' + claimed + ' but is a member of ' + ids[0] + '. tenant_id is not a caller-selectable field.');
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
    throw new Error('[NEXUS-UNATTRIBUTED] Closed-won sync aborted: the internal caller supplied no resolvable tenant_id and ' + nexusKeys.length + ' dealerships are configured. Refusing rather than filing this sale under a guess.');
  }
}
const parts = [
  customer ? 'Customer: ' + customer : null,
  email ? 'Email: ' + email : null,
  vehicle ? 'Vehicle: ' + vehicle : null,
  (amount !== undefined && amount !== null && amount !== '') ? 'Deal value: AED ' + amount : null,
  closedAt ? 'Closed at: ' + closedAt : null,
  clean(d.notes) ? 'Notes: ' + clean(d.notes) : null
].filter(Boolean);

const dealText = parts.join('. ');
if (!dealText) throw new Error('Rejected: deal ' + dealId + ' produced no text to embed.');

// Carry the structured fields through as well. `Record Purchase` needs them to
// write the actual purchase_history row; the embedding chain reads only dealId
// and dealText and is unaffected by the extra keys.
return [{ json: {
  dealId,
  dealText,
  customer_name: customer,
  email,
  phone: clean(d.phone) || clean(d.lead_phone),
  vehicle,
  amount_aed: (amount === undefined || amount === '') ? null : amount,
  purchase_date: closedAt,
  lead_id: leadId,
  tenant_id: tenant,
  tenant_source: tenantSource
} }];
