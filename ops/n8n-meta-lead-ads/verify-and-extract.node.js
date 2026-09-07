/* The exact body of the "Verify Or Refuse" Code node in the n8n workflow
 * "Meta Lead Ads - Inbound Receiver" — kept here so the repo holds what the box
 * runs, and so every branch can be tested without a live Meta delivery.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE WHATSAPP CLOUD RECEIVER
 *
 * The Cloud receiver gets the customer's message in the webhook. This one does
 * not get the customer AT ALL. Meta's leadgen webhook carries six identifiers —
 * leadgen_id, page_id, form_id, ad_id, adgroup_id, created_time — and no name,
 * no phone, no email. The fields arrive only from a second call,
 * GET /v<v>/<leadgen_id>, which needs `leads_retrieval` and expires.
 *
 * That two-hop shape is why `lead_event` has phases at all, and it is why this
 * node's job ends at RECEIVED. Nothing here invents a customer.
 *
 * AND THE TENANT COMES FROM page_id, WHICH IS ONLY TRUSTWORTHY AFTER THE HMAC
 *
 * There is no public key in a Meta delivery and there cannot be: the callback
 * URL is registered once with Meta and is identical for every dealership. The
 * only per-dealership fact is page_id — and page_id is public, so on its own it
 * is a string an attacker chose. What makes it safe to route on is that it
 * arrived inside a body whose signature verified, AND that it was registered in
 * lead_ingest_provider_identity. Both, in that order, or neither.
 *
 * The same three rules as the Cloud receiver otherwise: hash the RAW bytes,
 * refuse when unconfigured rather than passing traffic through, and carry the
 * HMAC in full because this sandbox has neither require('crypto') nor WebCrypto.
 */
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];

function sha256(bytes) {
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const l = bytes.length;
  /* (l + 8), not (l + 9): at l % 64 === 55 the 0x80 and the length fit the
     current block exactly. The published RFC 4231 vectors all pass with the
     wrong constant; a differential test against node:crypto is what caught it. */
  const buf = new Uint8Array((((l + 8) >> 6) + 1) << 6);
  buf.set(bytes); buf[l] = 0x80;
  const dv = new DataView(buf.buffer), bits = l * 8;
  dv.setUint32(buf.length - 8, Math.floor(bits / 4294967296));
  dv.setUint32(buf.length - 4, bits >>> 0);
  const w = new Uint32Array(64);
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32), odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
  return out;
}

function hmacHex(keyBytes, msgBytes) {
  const k = keyBytes.length > 64 ? sha256(keyBytes) : keyBytes;
  const ipad = new Uint8Array(64), opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const kb = i < k.length ? k[i] : 0;
    ipad[i] = kb ^ 0x36; opad[i] = kb ^ 0x5c;
  }
  const inner = new Uint8Array(64 + msgBytes.length);
  inner.set(ipad); inner.set(msgBytes, 64);
  const outer = new Uint8Array(96);
  outer.set(opad); outer.set(sha256(inner), 64);
  return Array.from(sha256(outer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const item = $input.first();
const j = item.json || {};
const headers = j.headers || {};
const query = j.query || {};
const VERIFY_TOKEN = String($env.META_WEBHOOK_VERIFY_TOKEN || '');
const APP_SECRET = String($env.META_APP_SECRET || '');

const refuse = (status, code, why, extra) => [{ json: Object.assign(
  { verdict: 'REFUSE', respond_status: status, respond_text: code,
    reason_code: code, why, wrote_nothing: true }, extra || {}) }];

const sameString = (a, b) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

/* ---- Meta's GET subscription handshake ------------------------------------ */
if (query['hub.mode'] !== undefined || query['hub.challenge'] !== undefined) {
  if (!VERIFY_TOKEN) {
    return refuse(500, 'VERIFY_TOKEN_NOT_CONFIGURED',
      'META_WEBHOOK_VERIFY_TOKEN is unset on this box. Confirming a subscription ' +
      'we cannot authenticate would let anyone point Meta deliveries at us.');
  }
  if (String(query['hub.mode']) !== 'subscribe') {
    return refuse(400, 'HUB_MODE_NOT_SUBSCRIBE', 'hub.mode was not subscribe.');
  }
  if (!sameString(String(query['hub.verify_token'] || ''), VERIFY_TOKEN)) {
    return refuse(403, 'HUB_VERIFY_TOKEN_MISMATCH', 'The verify token did not match.');
  }
  return [{ json: {
    verdict: 'CHALLENGE', respond_status: 200,
    respond_text: String(query['hub.challenge'] || ''),
    reason_code: 'SUBSCRIPTION_CONFIRMED', wrote_nothing: true } }];
}

/* ---- Everything below is a POST delivery ---------------------------------- */
if (!APP_SECRET) {
  const V = [
    ['key', Buffer.from('The quick brown fox jumps over the lazy dog', 'utf8'),
     'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'],
    ['key', Buffer.alloc(55, 0x61),
     '5c753ac4cf15a28e7b5a045ba8ce75e02545a313f326021d770912f768fb53ef'],
    ['key', Buffer.alloc(119, 0x61),
     '4ffbedd6a1157e63e62d3fa284549bcfe39fb98dbb77ac48a89120aed5747d6b'],
  ];
  let selftest;
  try {
    const failed = V.filter(v => hmacHex(Buffer.from(v[0], 'utf8'), v[1]) !== v[2]).length;
    const negative = hmacHex(Buffer.from('wrong-key', 'utf8'), V[0][1]) !== V[0][2];
    selftest = { vectors: V.length, failed, negative_control_rejects: negative,
                 ok: failed === 0 && negative };
  } catch (e) { selftest = { ok: false, error: String((e && e.message) || e) }; }
  return refuse(500, 'APP_SECRET_NOT_CONFIGURED',
    'META_APP_SECRET is unset on this box, so no delivery can be verified. ' +
    'Refusing every request until it is set - this gate is never dormant.',
    { hmac_selftest: selftest });
}

let raw = null, raw_source = null;
const bin = item.binary && (item.binary.data || item.binary.body);
if (bin && bin.data) { raw = Buffer.from(bin.data, 'base64'); raw_source = 'binary'; }
else if (typeof j.body === 'string') { raw = Buffer.from(j.body, 'utf8'); raw_source = 'string'; }
if (!raw) {
  return refuse(500, 'RAW_BODY_NOT_AVAILABLE',
    'The webhook node did not hand this node the raw body, so the bytes Meta ' +
    'signed are already gone. Turn on Raw Body on the webhook node.');
}

const sigHeader = String(headers['x-hub-signature-256'] || '');
if (!sigHeader.startsWith('sha256=')) {
  return refuse(401, 'SIGNATURE_HEADER_MISSING',
    'No X-Hub-Signature-256 on the request. Meta always sends one.');
}
if (!sameString(sigHeader, 'sha256=' + hmacHex(Buffer.from(APP_SECRET, 'utf8'), raw))) {
  return refuse(401, 'SIGNATURE_MISMATCH',
    'X-Hub-Signature-256 did not match an HMAC-SHA256 of the raw body under the ' +
    'app secret. Nothing was written.');
}

let payload;
try { payload = JSON.parse(raw.toString('utf8')); }
catch (e) { return refuse(400, 'BODY_NOT_JSON', 'Signature verified but the body is not JSON.'); }

/* Meta sends `object: "page"` for leadgen. A `whatsapp_business_account`
   delivery arriving here means the two webhooks are crossed in the Meta app
   config — say that, rather than silently finding no leads in it. */
const obj = String(payload.object || '');
if (obj && obj !== 'page') {
  return refuse(400, 'WRONG_WEBHOOK_OBJECT',
    'Signature verified, but object is "' + obj + '" and this endpoint consumes ' +
    'page leadgen. Check which callback URL each field is subscribed to in the ' +
    'Meta app: a whatsapp_business_account delivery belongs at ' +
    '/webhook/whatsapp-cloud-inbound.');
}

const out = [];
let sawNonLeadgen = 0;
for (const entry of (payload.entry || [])) {
  for (const ch of (entry.changes || [])) {
    if (String(ch.field || '') !== 'leadgen') { sawNonLeadgen++; continue; }
    const v = ch.value || {};
    const leadgenId = String(v.leadgen_id || '');
    const pageId = String(v.page_id || entry.id || '');
    const created = Number(v.created_time || 0);
    /* A leadgen_id is the ONLY thing that can fetch the customer and the only
       stable identity for deduplicating Meta's redeliveries. Without it there is
       nothing to hydrate and nothing to key on. Without a page_id there is no
       dealership. Neither is inventable. */
    const usable = leadgenId !== '' && pageId !== '';
    out.push({ json: {
      verdict: usable ? 'ACCEPT' : 'ACCEPT_UNUSABLE',
      respond_status: 200, respond_text: 'ok',
      reason_code: usable ? 'SIGNATURE_VERIFIED'
                          : (leadgenId === '' ? 'NO_LEADGEN_ID' : 'NO_PAGE_ID'),
      raw_source,
      page_id: pageId,
      leadgen_id: leadgenId,
      form_id: String(v.form_id || ''),
      ad_id: String(v.ad_id || ''),
      adgroup_id: String(v.adgroup_id || ''),
      created_time: created > 0 ? new Date(created * 1000).toISOString() : null,
      origin_verified: 'hmac_sha256_x_hub',
      /* payload_raw for the RECEIVED row. Six identifiers and nothing else,
         because that is genuinely all Meta sent — this is not a redaction, it
         is the shape of the delivery. */
      payload_raw: {
        provider: 'meta',
        object: obj || 'page',
        field: 'leadgen',
        leadgen_id: leadgenId,
        page_id: pageId,
        form_id: String(v.form_id || ''),
        ad_id: String(v.ad_id || ''),
        adgroup_id: String(v.adgroup_id || ''),
        created_time: created || null,
      },
    } });
  }
}

if (!out.length) {
  return [{ json: {
    verdict: 'ACCEPT_NO_LEAD', respond_status: 200, respond_text: 'ok',
    reason_code: sawNonLeadgen ? 'NO_LEADGEN_CHANGE_IN_DELIVERY' : 'EMPTY_DELIVERY',
    wrote_nothing: true, raw_source, other_fields_seen: sawNonLeadgen,
    note: 'Signature verified. This delivery carried no leadgen change - Meta ' +
          'sends other Page fields on the same subscription and they are not ' +
          'leads.' } }];
}
return out;
