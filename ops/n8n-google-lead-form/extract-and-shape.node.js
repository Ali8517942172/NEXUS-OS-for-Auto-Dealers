/* The exact body of the "Extract And Shape" Code node in the n8n workflow
 * "Google Ads Lead Form - Inbound Receiver".
 *
 * This runs BEFORE the dealership is known and BEFORE anything is
 * authenticated. It therefore writes nothing, decides nothing about trust, and
 * exists only to answer two questions cheaply: is this even shaped like a
 * Google delivery, and which endpoint key is it addressed to.
 *
 * WHY THIS PROVIDER IS DIFFERENT FROM THE OTHER TWO, IN THE ONLY WAY THAT
 * CHANGES THE DESIGN
 *
 * Meta signs its body. Google does not sign anything. Google authenticates by
 * putting a plaintext shared secret -- `google_key` -- INSIDE the JSON, which
 * means:
 *
 *   - there is no integrity over the body at all. `google_key` proves the
 *     sender knew a secret; it proves nothing about the bytes around it. A
 *     man in the middle who can read one delivery can forge every future one.
 *     TLS is the only thing standing behind that, so this endpoint must never
 *     be reachable over plain HTTP.
 *   - the secret arrives in the same object as the customer, so redaction is
 *     not tidiness here, it is the whole job. See `redact-and-normalize`.
 *
 * AND THE STATUS CODE IS PART OF THE CONTRACT, NOT AN AFTERTHOUGHT
 *
 * Google Ads documents lead delivery as at-least-once, retries a 5XX, and
 * PERMANENTLY DISCARDS the lead on a 4XX. So the status is a decision about a
 * real customer, and every refusal below states which it is choosing:
 *
 *   4XX -- "this can never succeed, do not keep it"   (a forgery, a wrong key,
 *          a body with no lead id: identical bytes on retry, identical answer)
 *   5XX -- "this is ours to fix, hold it and come back" (our secret is not
 *          configured, our database is down, our bug)
 *   200 -- accepted, duplicated, or stored-and-refused-for-a-stated-reason
 *
 * The one that looks wrong and is not: an UNCONFIGURED secret answers 5XX, not
 * 4XX. While NEXUS is not configured, Google holds the lead and redelivers it.
 * Answering 4XX there would throw away real customers to make our own
 * misconfiguration quiet.
 */
const item = $input.first();
const j = item.json || {};
const params = j.params || {};
const query = j.query || {};

const refuse = (status, code, why, extra) => [{ json: Object.assign(
  { verdict: 'REFUSE', respond_status: status, respond_text: code,
    reason_code: code, why, wrote_nothing: true,
    google_will: status >= 500 ? 'RETRY' : 'DISCARD_PERMANENTLY' }, extra || {}) }];

/* ---- which endpoint is this addressed to ----------------------------------
   The key is in the URL because Google's webhook URL is configured per lead
   form, in the dealership's OWN Google Ads account -- unlike Meta, where one
   callback URL serves every tenant. That makes the URL a legitimate place to
   carry the tenant identifier. It is an identifier and not an authenticator:
   anything bearing one is still unauthenticated until the secret matches. */
const publicKey = String(params.key || query.k || '').trim();
if (!publicKey) {
  return refuse(404, 'NO_ENDPOINT_KEY_IN_URL',
    'This URL carries no endpoint key. The webhook URL registered in Google Ads ' +
    'must be the full per-dealership URL, ending in /<endpoint public key>.');
}
/* Shape-checked here, before any database call, so that junk costs nothing and
   a probe cannot make us do work. Same alphabet as the column constraint
   lead_ingest_endpoint_public_key_shape. */
if (!/^[A-Za-z0-9_-]{24,128}$/.test(publicKey)) {
  return refuse(404, 'ENDPOINT_KEY_MALFORMED',
    'The key in the URL is not the shape an endpoint key has, so no lookup was ' +
    'attempted.');
}

/* ---- the body ------------------------------------------------------------
   Read the raw bytes rather than n8n's parse, for the same reason as the Meta
   receivers: what arrived is evidence, and a re-encode is not what arrived. */
let raw = null, raw_source = null;
const bin = item.binary && (item.binary.data || item.binary.body);
if (bin && bin.data) { raw = Buffer.from(bin.data, 'base64'); raw_source = 'binary'; }
else if (typeof j.body === 'string') { raw = Buffer.from(j.body, 'utf8'); raw_source = 'string'; }
else if (j.body && typeof j.body === 'object') {
  raw = Buffer.from(JSON.stringify(j.body), 'utf8'); raw_source = 'reserialised';
}
if (!raw) {
  return refuse(500, 'RAW_BODY_NOT_AVAILABLE',
    'The webhook node handed this node no body at all. That is a fault in our ' +
    'own configuration, so Google is told to retry rather than to discard.');
}

let payload;
try { payload = JSON.parse(raw.toString('utf8')); }
catch (e) {
  return refuse(400, 'BODY_NOT_JSON',
    'The body is not JSON. Retrying will send the same bytes, so there is ' +
    'nothing to hold.');
}
if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
  return refuse(400, 'BODY_NOT_A_JSON_OBJECT', 'The body parsed but is not an object.');
}

/* ---- the idempotency key -------------------------------------------------
   lead_id is the catalogue's dedup_field for this source and the ONLY thing
   that makes at-least-once delivery safe. Without it a redelivery is
   indistinguishable from a second customer, and the dealership is handed the
   same person twice. Nothing downstream can repair that, so it stops here. */
const leadId = String(payload.lead_id || '').trim();
if (!leadId) {
  return refuse(400, 'NO_LEAD_ID',
    'The delivery carries no lead_id, so redeliveries of it could not be told ' +
    'apart from new customers. A retry would carry the same defect.');
}

/* Google's own test button sends is_test: true with fabricated details. It is
   allowed through the gate on purpose -- proving the wire works is exactly what
   it is for -- and is flagged here so that it is recorded and NEVER promoted
   into the dealership's funnel. A fake customer in a real pipeline is the
   defect this whole layer exists to avoid. */
const isTest = payload.is_test === true || String(payload.is_test || '').toLowerCase() === 'true';

/* The secret is deliberately NOT returned in this node's output. It has to be
   read once, in the next node, to be compared -- and every value a Code node
   returns is written into n8n's own execution store. See the README: the
   webhook node's own output still holds it, and that is a real exposure this
   redaction does not close. */
return [{ json: {
  verdict: 'SHAPED',
  public_key: publicKey,
  lead_id: leadId,
  is_test: isTest,
  raw_source,
  /* Carried forward for the secret comparison in the next node and used
     nowhere else. */
  google_key_presented: typeof payload.google_key === 'string' ? payload.google_key : '',
  google_key_present: typeof payload.google_key === 'string' && payload.google_key !== '',
  /* The whole parsed body, for the redactor. It contains the secret. It must
     not reach a database column, a response body, or a log line. */
  parsed: payload,
} }];
