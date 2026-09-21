/* Runs both Code-node bodies of the Google Ads Lead Form receiver in a harness
 * that fakes n8n's $input / $env / $(), so every branch is exercised before
 * Google ever calls the URL.
 *
 * The thing under test that has no equivalent in the other two receivers is the
 * STATUS CODE. Google retries a 5XX and permanently discards the lead on a 4XX,
 * so every refusal below asserts the number as well as the reason: getting the
 * reason right and the number wrong still loses the customer.
 *
 *     node ops/n8n-google-lead-form/receiver.test.js
 */
const fs = require('fs');
const path = require('path');

const SHAPE_SRC = fs.readFileSync(path.join(__dirname, 'extract-and-shape.node.js'), 'utf8');
const VERIFY_SRC = fs.readFileSync(path.join(__dirname, 'verify-and-redact.node.js'), 'utf8');

function runShape({ json = {}, binary = null }) {
  const $input = { first: () => ({ json, binary }) };
  return new Function('$input', 'Buffer', '"use strict";' + SHAPE_SRC)($input, Buffer);
}
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
function runVerify(endpointRow, shaped, env, helpers) {
  const $input = { first: () => ({ json: endpointRow }) };
  const mocks = { 'Extract And Shape': shaped };
  /* Throws on an upstream the workflow does not have. This caught a real defect
     in the Meta receiver, where a node read event_id off a gate that never has
     one and would have hydrated `undefined` on the first real lead. */
  const $ = name => {
    if (!(name in mocks)) throw new Error('node body referenced an unknown upstream node: ' + name);
    return { item: { json: mocks[name] } };
  };
  return new AsyncFunction('$input', '$', '$env', '$helpers', 'Buffer', '"use strict";' + VERIFY_SRC)(
    $input, $, env || {}, helpers || {}, Buffer);
}

let pass = 0, fail = 0;
const ck = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS' : '** FAIL **') + '  ' + label + (cond ? '' : '\n   ' + detail));
};

const KEY = 'alba-google-endpoint-key-0001';   // 29 chars, matches the column shape
const SECRET = 'the-shared-google-key';
const SECRET_REF = 'GOOGLE_LEAD_KEY_ALBA';

const ENDPOINT = {
  endpoint_id: 'ep-uuid-1',
  tenant_id: 'tenant-uuid-alba',
  source_key: 'google_ads_lead_form',
  declared_provenance: 'shared_secret_in_body',
  environment: 'production',
  secret_ref: SECRET_REF,
  delivery_shape: 'WEBHOOK_FULL_PAYLOAD',
  dedup_field: 'lead_id',
};
const ENV = { [SECRET_REF]: SECRET };

const body = (over = {}) => JSON.stringify(Object.assign({
  lead_id: 'lead-abc-123',
  api_version: '1.0',
  form_id: 987654321,
  campaign_id: 111222333,
  adgroup_id: 444555666,
  creative_id: 777888999,
  gcl_id: 'Cj0KCQjw-gcl-id-example',
  google_key: SECRET,
  is_test: false,
  user_column_data: [
    { column_id: 'FULL_NAME', column_name: 'Full Name', string_value: 'Khalid Al Marri' },
    { column_id: 'EMAIL', column_name: 'Email', string_value: 'Khalid@Example.AE' },
    { column_id: 'PHONE_NUMBER', column_name: 'Phone Number', string_value: '+971501234567' },
  ],
}, over));

const deliver = (wire, key = KEY) => runShape({
  json: { params: { key }, query: {}, headers: {} },
  binary: { data: { data: Buffer.from(wire, 'utf8').toString('base64') } },
});
const accept = async (wire, env = ENV, ep = ENDPOINT) => {
  const shaped = deliver(wire)[0].json;
  return (await runVerify(ep, shaped, env))[0].json;
};

/* ------------------------------------------------------------------------- */
(async () => {

console.log('\nThe URL, before any body is parsed');
{
  const noKey = runShape({ json: { params: {}, query: {}, headers: {} } })[0].json;
  ck('no key in the URL is 404 and discardable', noKey.respond_status === 404 &&
     noKey.reason_code === 'NO_ENDPOINT_KEY_IN_URL' && noKey.google_will === 'DISCARD_PERMANENTLY',
     JSON.stringify(noKey));

  const shortKey = runShape({ json: { params: { key: 'too-short' }, query: {}, headers: {} } })[0].json;
  ck('a malformed key is refused without any lookup being attempted',
     shortKey.reason_code === 'ENDPOINT_KEY_MALFORMED' && shortKey.respond_status === 404,
     JSON.stringify(shortKey));

  const viaQuery = runShape({ json: { params: {}, query: { k: KEY }, headers: {} },
    binary: { data: { data: Buffer.from(body()).toString('base64') } } })[0].json;
  ck('?k= is accepted as well as a path segment', viaQuery.verdict === 'SHAPED' &&
     viaQuery.public_key === KEY, JSON.stringify(viaQuery).slice(0, 200));
}

console.log('\nThe body, and the status code each refusal chooses');
{
  const notJson = deliver('this is not json')[0].json;
  ck('a non-JSON body is 400 - retrying sends the same bytes',
     notJson.respond_status === 400 && notJson.reason_code === 'BODY_NOT_JSON' &&
     notJson.google_will === 'DISCARD_PERMANENTLY', JSON.stringify(notJson));

  const arr = deliver('[1,2,3]')[0].json;
  ck('a JSON array is not a delivery', arr.reason_code === 'BODY_NOT_A_JSON_OBJECT', JSON.stringify(arr));

  const noLead = deliver(JSON.stringify({ google_key: SECRET }))[0].json;
  ck('no lead_id is 400, because a redelivery could not be told from a new customer',
     noLead.respond_status === 400 && noLead.reason_code === 'NO_LEAD_ID', JSON.stringify(noLead));

  const noBody = runShape({ json: { params: { key: KEY }, query: {}, headers: {} } })[0].json;
  ck('no body at all is OUR fault, so it is 500 and Google holds the lead',
     noBody.respond_status === 500 && noBody.google_will === 'RETRY', JSON.stringify(noBody));
}

console.log('\nThe secret: per dealership, and never a global');
{
  const shaped = deliver(body())[0].json;

  const unconfigured = (await runVerify(ENDPOINT, shaped, {}))[0].json;
  ck('an unset secret refuses every delivery rather than passing traffic through',
     unconfigured.reason_code === 'ENDPOINT_SECRET_NOT_CONFIGURED' && unconfigured.wrote_nothing === true,
     JSON.stringify(unconfigured));
  ck('and it answers 5XX, so a real customer is HELD by Google, not discarded',
     unconfigured.respond_status === 500 && unconfigured.google_will === 'RETRY',
     JSON.stringify(unconfigured));
  ck('the refusal names which variable is missing, without printing its value',
     unconfigured.secret_ref === SECRET_REF && !JSON.stringify(unconfigured).includes(SECRET),
     JSON.stringify(unconfigured));

  const noRef = (await runVerify(Object.assign({}, ENDPOINT, { secret_ref: null }), shaped, ENV))[0].json;
  ck('an endpoint registered with no secret_ref is also 5XX, not a pass',
     noRef.reason_code === 'ENDPOINT_HAS_NO_SECRET_REF' && noRef.respond_status === 500,
     JSON.stringify(noRef));

  const wrongKey = (await runVerify(ENDPOINT, shaped, { [SECRET_REF]: 'a-different-secret' }))[0].json;
  ck('a wrong google_key is 403 and nothing is written',
     wrongKey.respond_status === 403 && wrongKey.reason_code === 'GOOGLE_KEY_REJECTED' &&
     wrongKey.wrote_nothing === true, JSON.stringify(wrongKey));

  const noKeySent = (await runVerify(ENDPOINT, deliver(body({ google_key: undefined }))[0].json, ENV))[0].json;
  ck('a delivery with no google_key at all gets the SAME refusal as a wrong one',
     noKeySent.reason_code === 'GOOGLE_KEY_REJECTED' && noKeySent.why === wrongKey.why,
     JSON.stringify(noKeySent));

  const prefix = (await runVerify(ENDPOINT, deliver(body({ google_key: SECRET.slice(0, 5) }))[0].json, ENV))[0].json;
  ck('a correct prefix is not a correct key', prefix.reason_code === 'GOOGLE_KEY_REJECTED',
     JSON.stringify(prefix));

  /* The reason the endpoint is resolved before the secret is compared: the
     secret belongs to the endpoint, so two dealerships never share one. */
  const otherTenant = (await runVerify(
    Object.assign({}, ENDPOINT, { tenant_id: 'tenant-uuid-other', secret_ref: 'GOOGLE_LEAD_KEY_OTHER' }),
    shaped, Object.assign({ GOOGLE_LEAD_KEY_OTHER: 'another-dealers-secret' }, ENV)))[0].json;
  ck('one dealership’s key does not open another dealership’s endpoint',
     otherTenant.reason_code === 'GOOGLE_KEY_REJECTED', JSON.stringify(otherTenant));

  const wrongSource = (await runVerify(
    Object.assign({}, ENDPOINT, { source_key: 'website_form' }), shaped, ENV))[0].json;
  ck('a key belonging to a non-Google endpoint is named, not silently accepted',
     wrongSource.reason_code === 'ENDPOINT_IS_NOT_A_GOOGLE_ENDPOINT' &&
     wrongSource.respond_status === 400, JSON.stringify(wrongSource));
}

console.log('\nA real lead, once the key matches');
{
  const r = (await accept(body()));
  ck('it is accepted and promotable', r.verdict === 'ACCEPT' && r.can_promote === true, JSON.stringify(r).slice(0, 300));
  ck('the tenant came from the endpoint row, never from the body', r.tenant_id === 'tenant-uuid-alba', r.tenant_id);
  ck('lead_id is the external event id, so a redelivery deduplicates',
     r.lead_id === 'lead-abc-123', r.lead_id);
  ck('provenance is declared as what actually happened', r.origin_verified === 'shared_secret_in_body', r.origin_verified);
  ck('the name, email and phone are normalized', r.normalized.full_name === 'Khalid Al Marri' &&
     r.normalized.email === 'khalid@example.ae' && r.normalized.phone_e164 === '+971501234567',
     JSON.stringify(r.normalized));
  ck('gcl_id is kept, because offline conversion upload needs it later',
     r.payload_raw.gcl_id === 'Cj0KCQjw-gcl-id-example', String(r.payload_raw.gcl_id));
}

console.log('\nThe secret must not survive into anything a dealership can read');
{
  const r = (await accept(body()));
  const raw = JSON.stringify(r.payload_raw);
  ck('google_key is absent from payload_raw', !raw.includes(SECRET) && !/google_key/.test(raw), raw.slice(0, 300));
  ck('and absent from normalized', !JSON.stringify(r.normalized).includes(SECRET), JSON.stringify(r.normalized));

  /* The allowlist, not a filter: a field Google adds next year does not arrive
     by default, credential or otherwise. */
  const future = (await accept(body({ some_future_field: 'whatever', access_token: 'EAA-not-mine' })));
  const fraw = JSON.stringify(future.payload_raw);
  ck('an unknown future top-level field is not copied', !/some_future_field/.test(fraw), fraw.slice(0, 300));
  ck('and a top-level access_token cannot arrive by being forgotten',
     !/access_token/.test(fraw), fraw.slice(0, 300));

  /* user_column_data is the one branch copied wholesale, so the walk has to
     work there. */
  const nested = (await accept(body({ user_column_data: [
    { column_id: 'FULL_NAME', string_value: 'Noura' },
    { column_id: 'EMAIL', string_value: 'n@example.ae' },
    { column_id: 'CUSTOM', column_name: 'notes', string_value: 'x', extra: { api_key: 'leaked' } },
  ] })));
  const nraw = JSON.stringify(nested.payload_raw);
  ck('a credential-named key nested inside a customer answer is dropped',
     !/leaked/.test(nraw) && nested.stripped_secret_keys >= 1, nraw.slice(0, 400));
}

console.log('\nThe constraint that can eat a real lead, in both directions');
{
  const CONSTRAINT = /"(google_key|app_secret|client_secret|access_token|api_key|authorization)"/i;

  /* A custom question the advertiser named after a credential word. */
  const label = (await accept(body({ user_column_data: [
    { column_id: 'FULL_NAME', string_value: 'Fatima' },
    { column_id: 'PHONE_NUMBER', string_value: '+971502222222' },
    { column_id: 'CUSTOM_QUESTION_1', column_name: 'authorization', string_value: 'yes I consent' },
  ] })));
  const lraw = JSON.stringify(label.payload_raw);
  ck('a question labelled with a constraint word still yields a promotable lead',
     label.can_promote === true && !CONSTRAINT.test(lraw), lraw.slice(0, 400));
  ck('and the label the advertiser chose is still readable',
     /"authorization \(stored with this note/.test(lraw), lraw.slice(0, 400));
  ck('the customer answer to it survives verbatim in normalized',
     /yes I consent/.test(label.normalized.message || ''), label.normalized.message);

  /* And the case the Meta receiver shipped broken: the collision in the ANSWER. */
  const answer = (await accept(body({ user_column_data: [
    { column_id: 'FULL_NAME', string_value: 'Omar' },
    { column_id: 'EMAIL', string_value: 'omar@example.ae' },
    { column_id: 'CUSTOM_QUESTION_1', column_name: 'what do you need', string_value: 'api_key' },
  ] })));
  const araw = JSON.stringify(answer.payload_raw);
  ck('an ANSWER that is exactly a constraint word does not destroy the lead',
     answer.can_promote === true && !CONSTRAINT.test(araw), araw.slice(0, 400));
  ck('the word the customer typed still starts the stored string',
     /"api_key \(stored with this note/.test(araw), araw.slice(0, 400));
  ck('and normalized keeps it with nothing appended at all',
     /what do you need: api_key$/.test(answer.normalized.message || ''), answer.normalized.message);
  ck('the repair is counted rather than done silently', answer.annotated_values === 1,
     String(answer.annotated_values));

  /* An uppercase column_id, because the database match is case-insensitive. */
  const upper = (await accept(body({ user_column_data: [
    { column_id: 'FULL_NAME', string_value: 'Sara' },
    { column_id: 'EMAIL', string_value: 's@example.ae' },
    { column_id: 'API_KEY', column_name: 'Api Key', string_value: 'no' },
  ] })));
  ck('an uppercase column_id is caught too, because the match ignores case',
     !CONSTRAINT.test(JSON.stringify(upper.payload_raw)) && upper.can_promote === true,
     JSON.stringify(upper.payload_raw).slice(0, 400));

  /* The opposite direction of the same old defect: a label that merely CONTAINS
     a constraint word never trips it and must not be touched. */
  const near = (await accept(body({ user_column_data: [
    { column_id: 'FULL_NAME', string_value: 'Hind' },
    { column_id: 'EMAIL', string_value: 'h@example.ae' },
    { column_id: 'CUSTOM_QUESTION_1', column_name: 'my_api_key_question', string_value: 'no' },
  ] })));
  const nraw2 = JSON.stringify(near.payload_raw);
  ck('a label that only contains a constraint word is left exactly alone',
     /"my_api_key_question"/.test(nraw2) && !/stored with this note/.test(nraw2), nraw2.slice(0, 400));
  ck('and nothing was counted as repaired', near.annotated_values === 0, String(near.annotated_values));

  /* Ordinary traffic must not pay for any of this. */
  const clean = (await accept(body()));
  ck('an ordinary lead repairs nothing, so zero is the healthy answer',
     clean.annotated_values === 0 && clean.stripped_secret_keys === 0,
     clean.annotated_values + '/' + clean.stripped_secret_keys);
}

console.log('\nGoogle’s own test button, which must never become a customer');
{
  const t = (await accept(body({ is_test: true, lead_id: 'TEST_LEAD',
    user_column_data: [
      { column_id: 'FULL_NAME', string_value: 'Test Lead' },
      { column_id: 'EMAIL', string_value: 'test@example.com' },
    ] })));
  ck('a test delivery is verified and accepted, because proving the wire works is the point',
     t.verdict === 'ACCEPT' && t.respond_status === 200, JSON.stringify(t).slice(0, 250));
  ck('but it is NOT promotable, so no fake customer enters the funnel',
     t.can_promote === false, String(t.can_promote));
  ck('and the row records that it was a test', t.payload_raw.is_test === true && t.is_test === true,
     String(t.payload_raw.is_test));

  const strTrue = (await accept(body({ is_test: 'true' })));
  ck('is_test as the string "true" is honoured too', strTrue.can_promote === false, String(strTrue.can_promote));

  const real = (await accept(body()));
  ck('a real lead is not accidentally flagged as a test',
     real.payload_raw.is_test === false && real.can_promote === true, String(real.payload_raw.is_test));
}

console.log('\nForms that did not collect enough to reach anyone');
{
  const nameOnly = (await accept(body({ user_column_data: [{ column_id: 'FULL_NAME', string_value: 'Ahmed' }] })));
  ck('a form with no email and no phone is refused with the promoter’s own reason',
     nameOnly.normalized_defect === 'NORMALIZED_NEEDS_EMAIL_OR_PHONE' && nameOnly.can_promote === false,
     JSON.stringify(nameOnly.normalized));
  ck('and it still answers 200, because the delivery was fine - the FORM is not',
     nameOnly.respond_status === 200, String(nameOnly.respond_status));

  const noName = (await accept(body({ user_column_data: [{ column_id: 'EMAIL', string_value: 'a@b.ae' }] })));
  ck('contact without a name is refused too', noName.normalized_defect === 'NORMALIZED_FULL_NAME_REQUIRED',
     JSON.stringify(noName.normalized));

  const split = (await accept(body({ user_column_data: [
    { column_id: 'FIRST_NAME', string_value: 'Layla' },
    { column_id: 'LAST_NAME', string_value: 'Hassan' },
    { column_id: 'EMAIL', string_value: 'l@example.ae' },
  ] })));
  ck('first + last become a full name', split.normalized.full_name === 'Layla Hassan', split.normalized.full_name);

  const arabic = (await accept(body({ user_column_data: [
    { column_id: 'FULL_NAME', string_value: 'محمد الفلاسي' },
    { column_id: 'PHONE_NUMBER', string_value: '+971503333333' },
  ] })));
  ck('an Arabic name survives intact', arabic.normalized.full_name === 'محمد الفلاسي',
     arabic.normalized.full_name);

  const local = (await accept(body({ user_column_data: [
    { column_id: 'FULL_NAME', string_value: 'Yousef' },
    { column_id: 'PHONE_NUMBER', string_value: '050 444 5566' },
  ] })));
  ck('a local UAE 05x number becomes E.164', local.normalized.phone_e164 === '+971504445566',
     String(local.normalized.phone_e164));

  const junk = (await accept(body({ user_column_data: [
    { column_id: 'FULL_NAME', string_value: 'Amina' },
    { column_id: 'EMAIL', string_value: 'amina@example.ae' },
    { column_id: 'PHONE_NUMBER', string_value: '12345' },
  ] })));
  ck('an unparseable phone is reported, never repaired by guessing a country code',
     junk.normalized.phone_e164 === undefined && junk.payload_raw.phone_unparseable === '12345' &&
     junk.can_promote === true, JSON.stringify(junk.normalized));

  /* The advertiser's own column_name is free text, so it is a fallback and not
     the primary key into the answers. */
  const byName = (await accept(body({ user_column_data: [
    { column_name: 'Full Name', string_value: 'Reem' },
    { column_name: 'Email', string_value: 'reem@example.ae' },
  ] })));
  ck('a delivery with only column_name still resolves the customer',
     byName.normalized.full_name === 'Reem', JSON.stringify(byName.normalized));
}

console.log('\nAttribution, which is recorded and never guessed');
{
  const r = (await accept(body({ campaign_id: 999 })));
  ck('the source is the endpoint, stated as such', r.payload_raw.ad_platform === 'google_search' &&
     r.payload_raw.ad_platform_confidence === 'ENDPOINT_REGISTERED', JSON.stringify(r.payload_raw.ad_platform_evidence));
  ck('campaign and adgroup ids are carried for the attribution graph',
     r.payload_raw.campaign_id === '999' && r.payload_raw.adgroup_id === '444555666',
     r.payload_raw.campaign_id + '/' + r.payload_raw.adgroup_id);
  ck('and nothing in payload_raw claims a placement Google did not state',
     !/instagram|facebook|display|youtube/i.test(JSON.stringify(r.payload_raw)),
     JSON.stringify(r.payload_raw).slice(0, 200));
}

console.log('\nThe key the promoter actually reads');
{
  const vehicleProbe = (await accept(body({ user_column_data: [
    { column_id: 'FULL_NAME', string_value: 'Zayed' },
    { column_id: 'PHONE_NUMBER', string_value: '+971509999999' },
    { column_id: 'VEHICLE_MODEL', string_value: 'Patrol Nismo' },
  ] }))).normalized;
  /* A near-miss that shipped silently and cost the most valuable field on a car
     dealership's lead row. nexus_promote_lead_event reads
     normalized->>'vehicle_interest'; both receivers written this week emitted
     'vehicle_of_interest'; nexus_lead_normalized_defect does not mention a
     vehicle at all, so nothing complained and every lead would have landed with
     leads.vehicle_interest NULL. Migration
     20260907124500_leadingest_10_the_promoter_never_looked_at_environment now
     coalesces both spellings, and this test pins the pair so a third spelling
     cannot be introduced quietly. */
  const READ_BY_THE_PROMOTER = ['vehicle_interest', 'vehicle_of_interest'];
  const keys = Object.keys(vehicleProbe);
  const vehicleKeys = keys.filter(k => /vehicle/i.test(k));
  ck('the receiver emits exactly one vehicle key', vehicleKeys.length === 1, vehicleKeys.join(','));
  ck('and it is a spelling the promoter reads, so the answer reaches leads.vehicle_interest',
     READ_BY_THE_PROMOTER.includes(vehicleKeys[0]), vehicleKeys[0]);
}

console.log('\nThe secret from the vault, per endpoint, for a dealer that connected itself');
{
  const shaped = deliver(body())[0].json;
  const VENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-placeholder' };
  const fake = (row, throws) => {
    const calls = [];
    return { calls, helpers: { httpRequest: async (o) => {
      calls.push(o); if (throws) throw new Error('down'); return row ? [row] : []; } } };
  };
  const own = { tenant_id: ENDPOINT.tenant_id, endpoint_id: ENDPOINT.endpoint_id,
                source_key: 'google_ads_lead_form', secret: SECRET };
  const selfServe = Object.assign({}, ENDPOINT, { secret_ref: null });

  const f1 = fake(own);
  const ok = (await runVerify(selfServe, shaped, VENV, f1.helpers))[0].json;
  ck('an endpoint with no secret_ref authenticates from the vault',
     ok.verdict !== 'REFUSE' && ok.secret_source === 'vault_per_endpoint', JSON.stringify([ok.verdict, ok.reason_code]));
  const b1 = f1.calls[0] && f1.calls[0].body;
  ck('the vault was asked by provider identity google/google_webhook_id/<public_key>, kind google_lead_form_key',
     b1 && b1.p_provider === 'google' && b1.p_identity_kind === 'google_webhook_id' &&
     b1.p_identity_value === shaped.public_key && b1.p_kind === 'google_lead_form_key', JSON.stringify(b1));
  ck('the vault secret is not in the output item',
     !JSON.stringify(ok).includes(SECRET), 'leak');

  const f2 = fake(own);
  const bad = (await runVerify(selfServe, deliver(body({ google_key: 'wrong' }))[0].json, VENV, f2.helpers))[0].json;
  ck('a wrong key against a vault secret is still 403',
     bad.respond_status === 403 && bad.reason_code === 'GOOGLE_KEY_REJECTED', JSON.stringify(bad.reason_code));

  const f3 = fake(Object.assign({}, own, { tenant_id: 'tenant-uuid-other', endpoint_id: 'ep-other' }));
  const mis = (await runVerify(selfServe, shaped, VENV, f3.helpers))[0].json;
  ck('a vault secret owned by another dealership is refused before any compare',
     mis.reason_code === 'ENDPOINT_SECRET_TENANT_MISMATCH' && mis.wrote_nothing === true, JSON.stringify(mis.reason_code));

  const f4 = fake(null);
  const none = (await runVerify(selfServe, shaped, VENV, f4.helpers))[0].json;
  ck('no vault secret and no legacy ref: 5XX, never a pass',
     none.reason_code === 'ENDPOINT_HAS_NO_SECRET_REF' && none.respond_status === 500, JSON.stringify(none.reason_code));

  const f5 = fake(null, true);
  const down = (await runVerify(ENDPOINT, shaped, Object.assign({}, VENV, ENV), f5.helpers))[0].json;
  ck('vault unreachable with a legacy per-endpoint env secret: legacy path, labelled',
     down.verdict !== 'REFUSE' && down.secret_source === 'env_per_endpoint_legacy', JSON.stringify([down.verdict, down.secret_source]));

  const f6 = fake(own);
  const both = (await runVerify(ENDPOINT, shaped, Object.assign({}, VENV, { [SECRET_REF]: 'stale-env' }), f6.helpers))[0].json;
  ck('when both exist the vault wins',
     both.verdict !== 'REFUSE' && both.secret_source === 'vault_per_endpoint', JSON.stringify([both.verdict, both.reason_code]));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);

})().catch(e => { console.error('HARNESS ERROR: ' + (e && e.stack || e)); process.exit(1); });
