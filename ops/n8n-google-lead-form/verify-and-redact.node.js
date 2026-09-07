/* The exact body of the "Verify And Redact" Code node in the n8n workflow
 * "Google Ads Lead Form - Inbound Receiver".
 *
 * Two inputs, and the order matters: this node's own input is the resolved
 * endpoint row, and the delivery comes from `Extract And Shape`. The endpoint
 * is resolved FIRST because the secret is per-dealership -- see below -- and
 * the secret is compared HERE, before anything is written.
 *
 * WHY THE DATABASE IS READ BEFORE THE REQUEST IS AUTHENTICATED
 *
 * That ordering is uncomfortable and it is deliberate. The alternative is one
 * global `GOOGLE_LEAD_KEY` on the box, which authenticates before any lookup --
 * and makes every dealership share one secret, so any dealer who knows their
 * own key can post leads into any other dealer's pipeline. A shared secret
 * across tenants is not a smaller problem than an indexed lookup; it is the
 * exact tenancy defect this layer was built to remove. So: resolve, then
 * authenticate, with the URL key shape-checked in the previous node so an
 * unresolvable probe costs one index hit and nothing else.
 *
 * WHY THE REFUSAL IS THE SAME WHETHER THE KEY OR THE SECRET WAS WRONG
 *
 * Both answer 403 GOOGLE_KEY_REJECTED with the same body. Distinguishing them
 * would let anyone enumerate which endpoint keys exist. The cost is real: a
 * dealer who mistypes their key gets a silent refusal. That cost is paid at
 * configuration time, where Google's "send test data" button shows the status
 * -- and it is stated in the README rather than pretended away.
 *
 * WHAT REDACTION MEANS HERE, AND WHAT IT DOES NOT COVER
 *
 * `payload_raw` is built from a NAMED LIST, not filtered from Google's object.
 * `google_key` is never on that list, so it cannot arrive by being forgotten,
 * and neither can any field Google adds to this webhook next year. The one
 * branch copied wholesale is `user_column_data` -- the customer's own answers,
 * which are not ours to edit.
 *
 * This does NOT protect n8n's own execution store. The webhook node's output
 * item holds the raw body, secret included, before this node runs. That is a
 * real exposure and it is recorded in the README as unfixed.
 */

/* ---- the constraint, as measured against Postgres rather than assumed -----
   `lead_event_payload_carries_no_shared_secret` is a text match over the whole
   serialised JSON:
       payload_raw::text !~* '"(google_key|app_secret|client_secret|
                                access_token|api_key|authorization)"'
   It needs a real quote on both sides, so what actually trips it is a string --
   KEY OR VALUE, at any depth -- that is EXACTLY one of the six words. Measured
   on 7 September 2026:

     {"column_name":"google_key"}                  REFUSED   (a question label)
     {"column_id":"API_KEY"}                       REFUSED   (the match is case-insensitive)
     {"column_name":"my_api_key"}                  accepted  (a substring never trips it)
     {"string_value":"api_key"}                    REFUSED   (an ANSWER, on its own)
     {"string_value":"my api_key is broken"}       accepted
     {"string_value":"he said \"api_key\" loudly"} accepted  (jsonb escapes the inner quotes)
     {"string_value":"api_key "}                   accepted  (one trailing space clears it)
     {"a":{"b":{"c":{"d":"access_token"}}}}        REFUSED   (depth is irrelevant)

   The fourth line is the one that matters and it corrects something already
   shipped: the Meta receiver guarded question LABELS only, so a lead-form
   ANSWER of exactly "authorization" would have failed the insert and thrown
   away a real customer. And it guarded them with a SUBSTRING regex, which
   renamed harmless labels like "my_api_key" that never trip the constraint at
   all -- wrong in both directions from one wrong rule.

   So the rule is exact-match, applied to VALUES (see the SECRET_KEYS note
   below for why keys need no repair), and the repair is the smallest thing that
   clears it: the string keeps the customer's word and gains a stated note.
   Nothing is deleted, nothing is silently rewritten, and `normalized` -- the
   column a salesperson actually reads -- is not covered by the constraint and is
   never touched at all. */
const BARE_CONSTRAINT_WORD =
  /^(google_key|app_secret|client_secret|access_token|api_key|authorization)$/i;
const CONSTRAINT_NOTE =
  ' (stored with this note because the bare word is refused by a database constraint; ' +
  'the customer wrote it exactly as it appears before this bracket)';

/* Keys that carry an actual credential are DROPPED, which is a different job
   from constraint safety and is a longer list. Note that it CONTAINS all six
   constraint words, which is why the repair below runs on values only: a key
   equal to one of them never survives to be repaired, and a rename branch for
   keys would be unreachable code pretending to be a defence. Google carries the
   question label as a value -- user_column_data[].column_name -- so the value
   path is the one that fires. */
const SECRET_KEYS = new Set([
  'google_key', 'access_token', 'app_secret', 'client_secret', 'api_key', 'apikey',
  'authorization', 'refresh_token', 'secret', 'password', 'signature',
]);

let strippedKeys = 0, annotatedValues = 0;
function safeCopy(v, depth) {
  if (depth > 12) return null;
  if (Array.isArray(v)) return v.map(x => safeCopy(x, depth + 1));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      const lower = String(k).toLowerCase();
      if (SECRET_KEYS.has(lower)) { strippedKeys++; continue; }
      out[k] = safeCopy(val, depth + 1);
    }
    return out;
  }
  if (typeof v === 'string' && BARE_CONSTRAINT_WORD.test(v)) {
    annotatedValues++;
    return v + CONSTRAINT_NOTE;
  }
  return v;
}

/* -------------------------------------------------------------------------- */
const ep = $input.first().json || {};
const d = $('Extract And Shape').item.json;

const refuse = (status, code, why, extra) => [{ json: Object.assign(
  { verdict: 'REFUSE', respond_status: status, respond_text: code,
    reason_code: code, why, wrote_nothing: true,
    google_will: status >= 500 ? 'RETRY' : 'DISCARD_PERMANENTLY' }, extra || {}) }];

const secretRef = String(ep.secret_ref || '');
if (!secretRef) {
  return refuse(500, 'ENDPOINT_HAS_NO_SECRET_REF',
    'This endpoint resolved but names no secret, so no delivery to it can be ' +
    'authenticated. Ours to fix: Google is told to retry.');
}
/* $env is read by a name that came from our own database, never from the
   request. A caller cannot choose which environment variable is read. */
const expected = String($env[secretRef] || '');
if (!expected) {
  return refuse(500, 'ENDPOINT_SECRET_NOT_CONFIGURED',
    'The secret named ' + secretRef + ' is not set on this box, so nothing can ' +
    'be verified. Refusing every delivery until it is - and answering 5XX so ' +
    'Google holds the lead and redelivers it once it is set, rather than ' +
    'discarding a real customer to keep our misconfiguration quiet.',
    { secret_ref: secretRef });
}

const sameString = (a, b) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
if (!sameString(String(d.google_key_presented || ''), expected)) {
  /* One answer for "no such endpoint", "wrong secret" and "no secret sent", so
     that the endpoint key space cannot be enumerated from the outside. */
  return refuse(403, 'GOOGLE_KEY_REJECTED',
    'The google_key in the body did not match the secret registered for this ' +
    'endpoint. Nothing was written. Retrying sends the same key, so the lead ' +
    'is not held.');
}

/* Everything below this line is authenticated. -------------------------------
   Also checked: that the endpoint we authenticated against is actually a
   Google one. A registered endpoint for another source reaching this URL means
   the wrong key was pasted into Google Ads, and a Meta or website endpoint
   would otherwise be handed a provenance it never declared -- which
   nexus_record_lead_event refuses in production anyway, as a 500. Better to say
   what happened. */
if (String(ep.source_key || '') !== 'google_ads_lead_form') {
  return refuse(400, 'ENDPOINT_IS_NOT_A_GOOGLE_ENDPOINT',
    'The key in this URL belongs to a "' + ep.source_key + '" endpoint. Register ' +
    'a google_ads_lead_form endpoint for this dealership and use its key here.');
}

const p = d.parsed || {};

/* ---- the customer, out of Google's column list ---------------------------- */
const byId = {}, byName = {};
for (const c of (Array.isArray(p.user_column_data) ? p.user_column_data : [])) {
  if (!c || typeof c !== 'object') continue;
  const val = String(c.string_value == null ? '' : c.string_value).trim();
  if (!val) continue;
  const id = String(c.column_id || '').trim().toUpperCase();
  const nm = String(c.column_name || '').trim().toLowerCase();
  if (id && byId[id] === undefined) byId[id] = val;
  if (nm && byName[nm] === undefined) byName[nm] = val;
}
/* column_id is Google's own enum and is stable; column_name is the advertiser's
   free text and is not. Prefer the enum, fall back to the label. */
const pick = (ids, names) => {
  for (const i of ids) if (byId[i]) return byId[i];
  for (const n of (names || [])) if (byName[n]) return byName[n];
  return '';
};

let full_name = pick(['FULL_NAME'], ['full name', 'full_name', 'name']);
if (!full_name) {
  full_name = [pick(['FIRST_NAME'], ['first name']), pick(['LAST_NAME'], ['last name'])]
    .filter(Boolean).join(' ').trim();
}
const email = pick(['EMAIL', 'WORK_EMAIL'], ['email', 'e-mail']).toLowerCase();

/* E.164 or nothing. Pasting a country code onto a number that was never local
   is how a dealership messages a stranger, so an unrecognised shape is reported
   as unparseable rather than repaired. */
function toE164(rawPhone) {
  const s = String(rawPhone || '').replace(/[^\d+]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  const dg = s.replace(/\D/g, '');
  if (/^00[1-9]\d{7,14}$/.test(dg)) return '+' + dg.slice(2);
  if (/^971\d{9}$/.test(dg)) return '+' + dg;
  if (/^0?5\d{8}$/.test(dg)) return '+971' + dg.replace(/^0/, '');
  if (/^91[6-9]\d{9}$/.test(dg)) return '+' + dg;
  return null;
}
const phoneRaw = pick(['PHONE_NUMBER', 'WORK_PHONE'], ['phone', 'phone number', 'mobile']);
const phone_e164 = toE164(phoneRaw);

const vehicle = pick(['VEHICLE_MODEL', 'VEHICLE_TYPE'],
                     ['vehicle', 'model', 'car model', 'vehicle of interest']);

/* Everything the form asked that is not one of the identity fields, kept as the
   customer's own words so a dealership sees the answers it paid to collect. */
const IDENTITY_IDS = new Set(['FULL_NAME', 'FIRST_NAME', 'LAST_NAME', 'EMAIL',
                              'WORK_EMAIL', 'PHONE_NUMBER', 'WORK_PHONE']);
const extras = [];
for (const c of (Array.isArray(p.user_column_data) ? p.user_column_data : [])) {
  if (!c || typeof c !== 'object') continue;
  const id = String(c.column_id || '').trim().toUpperCase();
  const val = String(c.string_value == null ? '' : c.string_value).trim();
  if (!val || IDENTITY_IDS.has(id)) continue;
  const label = String(c.column_name || c.column_id || 'answer').trim();
  extras.push(label + ': ' + val);
}

const normalized = { full_name };
if (phone_e164) normalized.phone_e164 = phone_e164;
if (email) normalized.email = email;
if (vehicle) normalized.vehicle_of_interest = vehicle;
if (extras.length) normalized.message = extras.join(' | ');

let defect = null;
if (!full_name) defect = 'NORMALIZED_FULL_NAME_REQUIRED';
else if (!phone_e164 && !email) defect = 'NORMALIZED_NEEDS_EMAIL_OR_PHONE';

/* ---- payload_raw: an allowlist, and google_key is not on it ---------------- */
const payload_raw = {
  provider: 'google',
  lead_id: d.lead_id,
  api_version: p.api_version || null,
  form_id: p.form_id == null ? null : String(p.form_id),
  campaign_id: p.campaign_id == null ? null : String(p.campaign_id),
  adgroup_id: p.adgroup_id == null ? null : String(p.adgroup_id),
  creative_id: p.creative_id == null ? null : String(p.creative_id),
  asset_id: p.asset_id == null ? null : String(p.asset_id),
  /* Kept deliberately: offline conversion upload needs gclid later, and it is
     the only thing that will ever let this dealership prove to Google that the
     click became a sale. It is an ad click identifier, not a credential. */
  gcl_id: p.gcl_id == null ? null : String(p.gcl_id),
  is_test: d.is_test === true,
  ad_platform: 'google_search',
  ad_platform_confidence: 'ENDPOINT_REGISTERED',
  ad_platform_evidence:
    'Arrived on a registered google_ads_lead_form endpoint. Google does not say ' +
    'in the body which network served the ad, so this is the source, not the ' +
    'placement, and it is not guessed from the campaign name.',
  /* The one branch not allowlisted: the customer's own answers. */
  user_column_data: safeCopy(Array.isArray(p.user_column_data) ? p.user_column_data : [], 0),
  phone_unparseable: phone_e164 ? null : (phoneRaw || null),
  constraint_safety: {
    annotated_values: annotatedValues,
    stripped_secret_keys: strippedKeys,
  },
};

return [{ json: {
  verdict: defect === null ? 'ACCEPT' : 'ACCEPT_UNPROMOTABLE',
  respond_status: 200,
  respond_text: 'ok',
  reason_code: defect === null ? 'GOOGLE_KEY_VERIFIED' : defect,
  tenant_id: ep.tenant_id,
  endpoint_id: ep.endpoint_id,
  public_key: d.public_key,
  lead_id: d.lead_id,
  is_test: d.is_test === true,
  origin_verified: 'shared_secret_in_body',
  payload_raw,
  /* Untouched on purpose: this is what a salesperson reads, and the constraint
     does not cover this column. */
  normalized,
  normalized_defect: defect,
  can_promote: defect === null && d.is_test !== true,
  annotated_values: annotatedValues,
  stripped_secret_keys: strippedKeys,
} }];
