// Extract document content AND the customer contact details we need to
// close the Phase-5 loop (WhatsApp re-upload request).
const item = $input.first().json;
const body = item.body || item;

let documentContent = '';
let imageBase64 = null;
if (body.document_base64) { imageBase64 = body.document_base64; documentContent = 'Image document provided as base64'; }
else if (body.document_text) { documentContent = body.document_text; }
else if (body.text) { documentContent = body.text; }
else { documentContent = JSON.stringify(body); }

// Normalise the WhatsApp chat id the same way the BDC agent does.
let chatId = String(body.chat_id || body.phone || body.whatsapp || '').trim();
if (chatId && !chatId.includes('@')) chatId = chatId.replace(/[^0-9]/g, '') + '@c.us';

// ---- TENANT (18 Sep 2026) -------------------------------------------------
// REPLACES the 2 Sep resolver, which read `body.tenant_id` FIRST and only fell
// back to 'Tenant For JWT User'. On the public `audit-kyc` webhook that order
// let an authenticated user of dealership A post `tenant_id: <B>` and have the
// Emirates ID they just uploaded -- plus every audit_log line and the
// kyc_documents row -- filed under B. n8n writes as service_role, which is
// BYPASSRLS with no auth.uid(), so nothing downstream would have caught it.
// The caller's tenant_id is now never a source. It is only ever a CLAIM, and a
// claim that disagrees with the membership row is refused outright.
//
// Two doors, two rules:
//   * public webhook -- `ReceiveDocument` -> `Verify JWT` ->
//     `Tenant For JWT User` -> `Auth Gate` -> here. The ONLY trusted answer is
//     the tenant_members row for the Supabase user behind the verified JWT.
//     No row, or more than one, means refuse. There is no fallback on this
//     door: a fallback is exactly how an unverifiable caller acquires a
//     dealership, and this door carries identity documents.
//   * internal hop  -- `Called by Another Workflow` -> here. The caller is a
//     sibling workflow (the WhatsApp BDC agent) that already resolved the
//     dealership from the WAHA session the document arrived on; `Auth Gate`
//     never ran, and that is how this node tells the doors apart.
//
// Refusals carry the '[NEXUS-UNATTRIBUTED]' prefix at position 0, the contract
// with the NEXUS Error Handler (iYJkh1kztWxZXDbT): the failed execution is
// filed under the quarantine tenant instead of being appended to some real
// dealership's compliance trail.
const NEXUS_BUILTIN = { 'default': 'fff6a2b5-cfd5-4460-8383-875bc5826de0' };  // Tenant A
const NEXUS_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let nexusMap = {};
try { nexusMap = JSON.parse(String($env.NEXUS_TENANT_MAP || '')) || {}; } catch (e) { nexusMap = {}; }
if (!nexusMap || typeof nexusMap !== 'object' || !Object.keys(nexusMap).length) nexusMap = NEXUS_BUILTIN;
const nexusKeys = Object.keys(nexusMap);

// What the caller ASSERTED. Never authoritative; only ever cross-checked.
const claimed = String(body.tenant_id || item.tenant_id || '');

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
    throw new Error('[NEXUS-UNATTRIBUTED] KYC upload rejected: the authenticated user is a member of ' + ids.length + ' dealerships. This endpoint will not choose one on their behalf.');
  }
  if (ids.length === 0 || !NEXUS_UUID.test(ids[0])) {
    throw new Error('[NEXUS-UNATTRIBUTED] KYC upload rejected: the authenticated user has no tenant_members row. A dealership is never taken from the request body.');
  }
  if (claimed && claimed.toLowerCase() !== ids[0].toLowerCase()) {
    throw new Error('[NEXUS-UNATTRIBUTED] KYC upload rejected: caller asserted tenant_id ' + claimed + ' but is a member of ' + ids[0] + '. tenant_id is not a caller-selectable field.');
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
    throw new Error('[NEXUS-UNATTRIBUTED] KYC upload rejected: the internal caller supplied no resolvable tenant_id and ' + nexusKeys.length + ' dealerships are configured. Refusing rather than filing an identity document under a guess.');
  }
}

return [{ json: {
  documentContent: documentContent,
  imageBase64: imageBase64,
  hasImage: !!imageBase64,
  lead_email: body.lead_email || body.email || null,
  lead_name: body.lead_name || body.name || null,
  chat_id: chatId || null,
  tenant_id: tenant,
  tenant_source: tenantSource
} }];
