/* The exact body of the "Normalize And Redact" Code node in the n8n workflow
 * "Meta Lead Ads - Inbound Receiver".
 *
 * Input: the Graph API response for GET /v<v>/<leadgen_id>, which is the ONLY
 * place the customer's details exist — the webhook carried none.
 *
 * Output: `hydrated_payload` (what Meta said, cleaned) and `normalized` (the
 * five fields the promoter needs). Both go into a row a dealership can read, so
 * neither may carry a credential.
 *
 * THREE THINGS THIS NODE IS RESPONSIBLE FOR, AND WHY EACH IS HERE AND NOT LATER
 *
 * 1. AN ALLOWLIST FIRST, AND A FILTER ONLY WHERE AN ALLOWLIST CANNOT REACH.
 *    `lead_event_payload_carries_no_shared_secret` refuses a row whose
 *    payload_raw OR hydrated_payload contains a key named access_token,
 *    app_secret, client_secret, api_key, authorization or google_key. That
 *    constraint is the backstop, not the plan: relying on it means the first
 *    leaked token fails the whole delivery and the lead is lost.
 *
 *    So `hydrated_payload` is assembled field by field from a NAMED LIST. It is
 *    not Meta's response with the bad parts taken out; it is our own object with
 *    only the parts we asked for put in. Nothing Meta adds to that endpoint next
 *    year can arrive here by default — including a credential. This was written
 *    the other way round first, as a scrub over the whole response, and the test
 *    that proved the scrub worked also proved the scrub was never reached.
 *
 *    ONE branch is copied wholesale and therefore cannot be allowlisted:
 *    `field_data`, the customer's own answers, which we must not edit. That is
 *    the door `scrub()` guards. It drops keys with credential names and values
 *    shaped like a Meta token (EAA… past 100 characters). It does NOT do general
 *    "looks secret-ish" filtering on free text — a customer's message is not
 *    ours to mangle, and a redacted enquiry is a lost enquiry.
 *
 * 2. ATTRIBUTION AS AN ADDITIVE FACT, NEVER AS THE IDENTITY.
 *    Meta delivers Instagram lead ads on the connected Facebook Page's leadgen
 *    subscription, and the webhook has no platform field — so at RECEIVED time
 *    nobody can know which it was. The Graph response often carries `platform`.
 *    It is recorded in hydrated_payload as `ad_platform`, and it MUST NOT be
 *    turned into source_key: lead_event_identity_key is
 *    UNIQUE (tenant_id, source_key, external_event_id), so changing source_key
 *    would make Meta's redelivery of the same leadgen_id look new and hand the
 *    dealership two leads for one customer. Attribution rides alongside the
 *    identity; it is never part of it.
 *
 *    When `platform` is absent, ad_platform is null and ad_platform_confidence
 *    is 'UNKNOWN'. It is not guessed from the ad name.
 *
 * 3. A NORMALIZED SHAPE THE PROMOTER WILL ACCEPT, OR AN HONEST REFUSAL.
 *    nexus_lead_normalized_defect() requires a full name and at least one of
 *    email or phone. If Meta's form did not ask for enough to reach the person,
 *    that is a real fact about the form and it is reported as such rather than
 *    padded with a placeholder.
 */
const src = $input.first().json || {};
/* Two different upstreams, on purpose. The identifiers Meta signed come from the
   gate; the event_id exists only because Record Lead Event created the row. An
   earlier draft read event_id off the gate, where it does not exist, and would
   have hydrated `undefined` on the first real lead. */
const ctx = $('Verify Or Refuse').item.json;
const recorded = $('Record Lead Event').item.json;
const eventId = recorded && recorded.event_id;

/* Meta user access tokens start EAA and run well past 100 characters. Short
   strings are never matched, so an ordinary answer cannot be eaten by this. */
const TOKEN_SHAPED = /^EAA[A-Za-z0-9_-]{100,}$/;
const SECRET_KEYS = new Set([
  'access_token', 'app_secret', 'client_secret', 'api_key', 'apikey',
  'authorization', 'google_key', 'appsecret_proof', 'refresh_token',
  'client_id_secret', 'secret',
]);

let strippedKeys = 0, strippedValues = 0;
function scrub(v, depth) {
  if (depth > 12) return null;
  if (Array.isArray(v)) return v.map(x => scrub(x, depth + 1));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (SECRET_KEYS.has(String(k).toLowerCase())) { strippedKeys++; continue; }
      out[k] = scrub(val, depth + 1);
    }
    return out;
  }
  if (typeof v === 'string' && TOKEN_SHAPED.test(v)) { strippedValues++; return '[redacted]'; }
  return v;
}

/* ---- field_data → a flat map ---------------------------------------------- */
const fields = {};
for (const f of (src.field_data || [])) {
  const name = String((f && f.name) || '').trim().toLowerCase();
  if (!name) continue;
  const vals = Array.isArray(f.values) ? f.values.map(x => String(x == null ? '' : x).trim()) : [];
  fields[name] = vals.filter(Boolean).join(' ').trim();
}

const pick = (...names) => { for (const n of names) if (fields[n]) return fields[n]; return ''; };

let full_name = pick('full_name', 'name');
if (!full_name) {
  full_name = [pick('first_name'), pick('last_name')].filter(Boolean).join(' ').trim();
}
const email = pick('email').toLowerCase();

/* E.164 or nothing. Pasting a country code onto a number that was never local
   is how you message a stranger, so an unrecognised shape is reported as
   unparseable rather than repaired. Meta normally returns a leading +. */
function toE164(rawPhone) {
  const s = String(rawPhone || '').replace(/[^\d+]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  const d = s.replace(/\D/g, '');
  if (/^00[1-9]\d{7,14}$/.test(d)) return '+' + d.slice(2);
  if (/^971\d{9}$/.test(d)) return '+' + d;      // UAE, already prefixed
  if (/^0?5\d{8}$/.test(d)) return '+971' + d.replace(/^0/, '');  // UAE mobile as 05x
  if (/^91[6-9]\d{9}$/.test(d)) return '+' + d;  // India, already prefixed
  return null;
}
const phoneRaw = pick('phone_number', 'phone', 'mobile_number', 'mobile');
const phone_e164 = toE164(phoneRaw);

const vehicle = pick('vehicle_of_interest', 'vehicle', 'car_model', 'which_model_are_you_interested_in',
                     'model', 'what_are_you_looking_for');
/* Anything the form asked that is not one of the identity fields is kept as the
   customer's own words, so a dealership sees the answers it paid to collect. */
const KNOWN = new Set(['full_name', 'name', 'first_name', 'last_name', 'email',
                       'phone_number', 'phone', 'mobile_number', 'mobile']);
const extras = Object.entries(fields)
  .filter(([k, v]) => !KNOWN.has(k) && v)
  .map(([k, v]) => k.replace(/_/g, ' ') + ': ' + v);

const normalized = { full_name };
if (phone_e164) normalized.phone_e164 = phone_e164;
if (email) normalized.email = email;
if (vehicle) normalized.vehicle_of_interest = vehicle;
if (extras.length) normalized.message = extras.join(' | ');

/* ---- what the promoter will refuse, decided here rather than by a 500 ------ */
let defect = null;
if (!full_name) defect = 'NORMALIZED_FULL_NAME_REQUIRED';
else if (!phone_e164 && !email) defect = 'NORMALIZED_NEEDS_EMAIL_OR_PHONE';

const platform = String(src.platform || '').toLowerCase();
const ad_platform = (platform === 'instagram' || platform === 'facebook') ? platform : null;

/* ---- field_data, and a constraint that can destroy a real lead ------------
   `lead_event_payload_carries_no_shared_secret` is a TEXT match over the whole
   serialised JSON:

       hydrated_payload::text !~* '"(google_key|app_secret|client_secret|
                                    access_token|api_key|authorization)"'

   It does not distinguish a key from a value. So a Meta lead form whose QUESTION
   is called "api_key" makes the insert fail — and a failed insert here is a
   customer who filled in the form and was thrown away. Same shape as answering
   Google a 4XX.

   MEASURED against Postgres rather than reasoned about, because the regex needs
   a literal quote on both sides and JSON escaping decides whether there is one:

     {"field_data":[{"name":"api_key",...}]}            -> constraint REFUSES
     {"field_data":[{"name":"q__api_key",...}]}         -> accepted
     an ANSWER containing "api_key" in quotes           -> accepted anyway,
        because jsonb renders the inner quotes as \" and the closing quote is
        therefore preceded by a backslash, so the pattern cannot match.

   That last line killed a defence I had already written. A pass that rewrote
   the word inside string VALUES was in this file and is gone: it guarded a case
   Postgres proves cannot occur, and the cost of keeping it was editing a
   customer's own words in the archival copy for no reason at all.

   So only the question LABEL is renamed, only when it genuinely collides, and
   the rename is recorded. The answer is never touched, and `normalized` — the
   text a salesperson reads — is a different column the constraint does not
   cover and is left exactly as the customer wrote it. */
const CONSTRAINT_WORDS = /(google_key|app_secret|client_secret|access_token|api_key|authorization)/gi;
let renamedQuestions = 0;

const scrubbedFieldData = (scrub(src.field_data || [], 0) || []).map(f => {
  if (!f || typeof f !== 'object') return f;
  const name = String(f.name || '');
  if (CONSTRAINT_WORDS.test(name)) {
    CONSTRAINT_WORDS.lastIndex = 0;
    renamedQuestions++;
    /* The answer is kept. Only the question's LABEL is prefixed, and the
       original is recorded so nothing is silently rewritten. */
    return Object.assign({}, f, { name: 'q__' + name, name_original_note: 'renamed to clear a database constraint' });
  }
  CONSTRAINT_WORDS.lastIndex = 0;
  return f;
});

const hydrated_payload = {
  provider: 'meta',
  graph_lead_id: String(src.id || ''),
  created_time: src.created_time || null,
  form_id: String(src.form_id || ctx.form_id || ''),
  ad_id: String(src.ad_id || ctx.ad_id || ''),
  ad_name: src.ad_name || null,
  adset_id: src.adset_id || null,
  adset_name: src.adset_name || null,
  campaign_id: src.campaign_id || null,
  campaign_name: src.campaign_name || null,
  is_organic: typeof src.is_organic === 'boolean' ? src.is_organic : null,
  /* Attribution, additive. See the header: this never becomes source_key. */
  ad_platform,
  ad_platform_confidence: ad_platform ? 'PROVIDER_REPORTED' : 'UNKNOWN',
  ad_platform_evidence: ad_platform
    ? 'Meta returned platform="' + platform + '" on the lead node.'
    : 'Meta returned no platform on the lead node. The webhook cannot say either: '
      + 'Instagram lead ads arrive on the Facebook Page leadgen subscription. '
      + 'Not guessed from the ad or campaign name.',
  /* The one branch not allowlisted: the customer's own answers, copied
     wholesale because we must not edit them. scrub() guards exactly this. */
  field_data: scrubbedFieldData,
  phone_unparseable: phone_e164 ? null : (phoneRaw || null),
  constraint_safety: { renamed_questions: renamedQuestions },
};

return [{ json: {
  event_id: eventId,
  leadgen_id: ctx.leadgen_id,
  hydrated_payload,
  /* Untouched on purpose: this is what a salesperson reads. */
  normalized,
  normalized_defect: defect,
  can_promote: defect === null,
  ad_platform,
  /* Counted over field_data only. Zero is the normal, healthy answer:
     the rest of hydrated_payload is an allowlist and never needed one. */
  renamed_questions: renamedQuestions,
  field_data_stripped_keys: strippedKeys,
  field_data_stripped_token_shaped_values: strippedValues,
} }];
