/* Runs both Code-node bodies of the Meta Lead Ads receiver in a harness that
 * fakes n8n's $input / $env / $(), so every branch is exercised before Meta
 * ever calls the URL.
 *
 * This matters more here than for the Cloud receiver. That one can at least be
 * poked with curl. This one cannot be exercised end to end at all without a
 * Facebook Page, a lead form, an app secret and a leads_retrieval token — none
 * of which exist yet. The harness is the only thing standing between "written"
 * and "hoped for".
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERIFY_SRC = fs.readFileSync(path.join(__dirname, 'verify-and-extract.node.js'), 'utf8');
const NORM_SRC = fs.readFileSync(path.join(__dirname, 'normalize-and-redact.node.js'), 'utf8');

function runVerify({ env = {}, json = {}, binary = null }) {
  const $input = { first: () => ({ json, binary }) };
  return new Function('$input', '$env', 'Buffer', '"use strict";' + VERIFY_SRC)($input, env, Buffer);
}
function runNormalize(graph, ctx, recorded) {
  const $input = { first: () => ({ json: graph }) };
  /* The harness distinguishes the two upstreams, because the node does. */
  const mocks = { 'Verify Or Refuse': ctx, 'Record Lead Event': recorded || { event_id: 'evt-from-record' } };
  const $ = name => {
    if (!(name in mocks)) throw new Error('node body referenced an unknown upstream node: ' + name);
    return { item: { json: mocks[name] } };
  };
  return new Function('$input', '$', 'Buffer', '"use strict";' + NORM_SRC)($input, $, Buffer);
}

let pass = 0, fail = 0;
const ck = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS' : '** FAIL **') + '  ' + label + (cond ? '' : '\n   ' + detail));
};

const SECRET = 'an-app-secret';
const TOKEN = 'a-verify-token';

const leadgenBody = (over = {}) => JSON.stringify({
  object: 'page',
  entry: [{
    id: '111111111111',
    time: 1788700000,
    changes: [{
      field: 'leadgen',
      value: Object.assign({
        created_time: 1788700000,
        leadgen_id: '444444444444',
        page_id: '111111111111',
        form_id: '222222222222',
        adgroup_id: '333333333333',
        ad_id: '555555555555',
      }, over),
    }],
  }],
});

const post = (wire, secret = SECRET, env = {}) => {
  const buf = Buffer.from(wire, 'utf8');
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(buf).digest('hex');
  return runVerify({
    env: Object.assign({ META_APP_SECRET: SECRET, META_WEBHOOK_VERIFY_TOKEN: TOKEN }, env),
    json: { headers: { 'x-hub-signature-256': sig }, query: {} },
    binary: { data: { data: buf.toString('base64') } },
  });
};

console.log('\nThe gate, before anything is extracted');
{
  const noSecret = runVerify({ env: {}, json: { headers: { 'x-hub-signature-256': 'sha256=' + 'a'.repeat(64) }, query: {} },
    binary: { data: { data: Buffer.from(leadgenBody()).toString('base64') } } });
  ck('refuses 500 with no app secret', noSecret[0].json.reason_code === 'APP_SECRET_NOT_CONFIGURED', JSON.stringify(noSecret[0].json));
  ck('and its HMAC self-test passes with a working negative control',
     noSecret[0].json.hmac_selftest.ok === true && noSecret[0].json.hmac_selftest.negative_control_rejects === true,
     JSON.stringify(noSecret[0].json.hmac_selftest));

  ck('refuses a signature made with the wrong secret',
     post(leadgenBody(), 'another-secret')[0].json.reason_code === 'SIGNATURE_MISMATCH', '');

  const buf = Buffer.from(leadgenBody(), 'utf8');
  const good = 'sha256=' + crypto.createHmac('sha256', SECRET).update(buf).digest('hex');
  const tampered = runVerify({ env: { META_APP_SECRET: SECRET },
    json: { headers: { 'x-hub-signature-256': good }, query: {} },
    binary: { data: { data: Buffer.concat([buf, Buffer.from(' ')]).toString('base64') } } });
  ck('refuses a body changed after signing', tampered[0].json.reason_code === 'SIGNATURE_MISMATCH', '');

  const g = runVerify({ env: { META_WEBHOOK_VERIFY_TOKEN: TOKEN },
    json: { query: { 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '31337' } } });
  ck('echoes the subscription challenge and writes nothing',
     g[0].json.verdict === 'CHALLENGE' && g[0].json.respond_text === '31337' && g[0].json.wrote_nothing === true, '');
  const gw = runVerify({ env: { META_WEBHOOK_VERIFY_TOKEN: TOKEN },
    json: { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'guess', 'hub.challenge': '1' } } });
  ck('refuses 403 on a wrong verify token', gw[0].json.respond_status === 403, '');
}

console.log('\nCrossed webhooks, which is the likeliest configuration mistake');
{
  const wa = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const r = post(wa)[0].json;
  ck('a WhatsApp delivery on the leadgen URL is refused by name, not silently ignored',
     r.reason_code === 'WRONG_WEBHOOK_OBJECT' && /whatsapp-cloud-inbound/.test(r.why), JSON.stringify(r));
}

console.log('\nWhat a verified leadgen delivery yields — and what it does NOT');
{
  const r = post(leadgenBody())[0].json;
  ck('accepted', r.verdict === 'ACCEPT' && r.reason_code === 'SIGNATURE_VERIFIED', JSON.stringify(r));
  ck('the dealership key is page_id, taken from the signed body', r.page_id === '111111111111', r.page_id);
  ck('the identity is leadgen_id', r.leadgen_id === '444444444444', r.leadgen_id);
  ck('created_time becomes a real timestamp', r.created_time === new Date(1788700000 * 1000).toISOString(), String(r.created_time));
  ck('provenance is the HMAC, not a shared header', r.origin_verified === 'hmac_sha256_x_hub', r.origin_verified);
  const keys = Object.keys(r.payload_raw).sort().join(',');
  ck('payload_raw carries the six identifiers and NO customer data',
     !/name|email|phone/i.test(JSON.stringify(r.payload_raw)) && keys.includes('leadgen_id'), keys);
}

console.log('\nDeliveries that verify but cannot be used');
{
  ck('no leadgen_id is accepted-but-unusable, not invented',
     post(leadgenBody({ leadgen_id: '' }))[0].json.reason_code === 'NO_LEADGEN_ID', '');
  const noPage = JSON.stringify({ object: 'page', entry: [{ changes: [{ field: 'leadgen',
    value: { leadgen_id: '444444444444', created_time: 1788700000 } }] }] });
  ck('no page_id anywhere is accepted-but-unusable', post(noPage)[0].json.reason_code === 'NO_PAGE_ID', '');
  const other = JSON.stringify({ object: 'page', entry: [{ id: '1', changes: [{ field: 'feed', value: {} }] }] });
  const r = post(other)[0].json;
  ck('a non-leadgen Page change writes nothing and says which',
     r.verdict === 'ACCEPT_NO_LEAD' && r.reason_code === 'NO_LEADGEN_CHANGE_IN_DELIVERY' && r.other_fields_seen === 1, JSON.stringify(r));
}

console.log('\nTwo leads in one delivery');
{
  const two = JSON.stringify({ object: 'page', entry: [{ id: '111111111111', changes: [
    { field: 'leadgen', value: { leadgen_id: 'A1', page_id: '111111111111', created_time: 1788700000 } },
    { field: 'leadgen', value: { leadgen_id: 'B2', page_id: '111111111111', created_time: 1788700060 } }] }] });
  const r = post(two);
  ck('both become items — neither is dropped',
     r.length === 2 && r[0].json.leadgen_id === 'A1' && r[1].json.leadgen_id === 'B2',
     JSON.stringify(r.map(x => x.json.leadgen_id)));
}

/* ------------------------------------------------------------------ hydrate */
const CTX = { leadgen_id: '444444444444', form_id: '222222222222', ad_id: '555555555555' };
const graph = (over = {}) => Object.assign({
  id: '444444444444',
  created_time: '2026-09-07T10:00:00+0000',
  ad_id: '555555555555', ad_name: 'Patrol - Retargeting',
  campaign_id: '777', campaign_name: 'Sep UAE SUV',
  form_id: '222222222222', is_organic: false,
  field_data: [
    { name: 'full_name', values: ['محمد الأنصاري'] },
    { name: 'phone_number', values: ['+971501234567'] },
    { name: 'email', values: ['Mohammed@Example.com'] },
    { name: 'which_model_are_you_interested_in', values: ['Nissan Patrol 2022'] },
    { name: 'preferred_time', values: ['Evening'] },
  ],
}, over);

console.log('\nHydration: normalising what Meta returns');
{
  const r = runNormalize(graph({ platform: 'instagram' }), CTX)[0].json;
  ck('event_id comes from Record Lead Event, not from the gate that never had one',
     r.event_id === 'evt-from-record', String(r.event_id));
  ck('an Arabic name survives intact', r.normalized.full_name === 'محمد الأنصاري', r.normalized.full_name);
  ck('email is lowercased', r.normalized.email === 'mohammed@example.com', r.normalized.email);
  ck('phone is E.164', r.normalized.phone_e164 === '+971501234567', r.normalized.phone_e164);
  ck('the vehicle question is recognised', r.normalized.vehicle_of_interest === 'Nissan Patrol 2022', r.normalized.vehicle_of_interest);
  ck('unrecognised form answers are kept as the customer gave them',
     /preferred time: Evening/.test(r.normalized.message || ''), r.normalized.message);
  ck('it can be promoted', r.can_promote === true && r.normalized_defect === null, String(r.normalized_defect));
}

console.log('\nAttribution: additive, and never guessed');
{
  const ig = runNormalize(graph({ platform: 'instagram' }), CTX)[0].json;
  ck('Instagram is recorded when Meta reports it',
     ig.ad_platform === 'instagram' && ig.hydrated_payload.ad_platform_confidence === 'PROVIDER_REPORTED', JSON.stringify(ig.ad_platform));
  const none = runNormalize(graph(), CTX)[0].json;
  ck('absent platform is UNKNOWN, not inferred from the campaign name',
     none.ad_platform === null && none.hydrated_payload.ad_platform_confidence === 'UNKNOWN'
     && /Not guessed/.test(none.hydrated_payload.ad_platform_evidence), JSON.stringify(none.ad_platform));
  const junk = runNormalize(graph({ platform: 'audience_network' }), CTX)[0].json;
  ck('an unrecognised platform value is UNKNOWN rather than passed through',
     junk.ad_platform === null, String(junk.ad_platform));
}

console.log('\nThe allowlist, and the one door it cannot cover');
{
  const withToken = graph({
    platform: 'facebook',
    access_token: 'EAA' + 'x'.repeat(150),
    page: { client_secret: 'nope', name: 'ALBA CARS' },
    surprise_field_meta_adds_next_year: 'whatever',
    field_data: [
      { name: 'full_name', values: ['Ahmed'] },
      { name: 'email', values: ['a@b.com'] },
      { name: 'note', values: ['EAA' + 'y'.repeat(150)] },
      { name: 'api_key', values: ['should-not-survive'] },
    ],
  });
  const r = runNormalize(withToken, CTX)[0].json;
  const s = JSON.stringify(r.hydrated_payload);

  /* The allowlist: these never entered, so there was nothing to filter. */
  ck('a top-level access_token never enters hydrated_payload', !/access_token/.test(s), s.slice(0, 200));
  ck('a nested client_secret never enters either', !/client_secret/.test(s), s.slice(0, 200));
  ck('an unknown field Meta might add later is not copied by default',
     !/surprise_field/.test(s), s.slice(0, 200));

  /* field_data is the one branch copied wholesale, so scrub() has to work there. */
  ck('a credential-named QUESTION is renamed, not dropped — the answer is kept',
     /q__api.key/.test(s) && /should-not-survive/.test(s), s.slice(0, 400));
  ck('a token-shaped value inside a customer answer is redacted', !/EAAy/.test(s), s.slice(0, 400));
  ck('the customer answers around it survive', /a@b\.com/.test(s) && /Ahmed/.test(s), s.slice(0, 300));
  ck('and it counted the token-shaped value it redacted from field_data',
     r.field_data_stripped_token_shaped_values >= 1,
     'stripped keys ' + r.field_data_stripped_keys + ', token values ' + r.field_data_stripped_token_shaped_values);

  const clean = runNormalize(graph(), CTX)[0].json;
  ck('an ordinary lead strips nothing, so zero is the healthy answer',
     clean.field_data_stripped_keys === 0 && clean.field_data_stripped_token_shaped_values === 0,
     clean.field_data_stripped_keys + '/' + clean.field_data_stripped_token_shaped_values);

  const CONSTRAINT = /"(google_key|app_secret|client_secret|access_token|api_key|authorization)"/i;
  ck('the row would satisfy lead_event_payload_carries_no_shared_secret', !CONSTRAINT.test(s), s.slice(0, 500));
  ck('and it recorded the rename rather than editing silently',
     r.hydrated_payload.constraint_safety.renamed_questions >= 1, JSON.stringify(r.hydrated_payload.constraint_safety));

  /* The lead-losing case, stated as its own test: a form question named
     api_key must NOT cost the dealership the customer. */
  const collide = runNormalize(graph({ field_data: [
    { name: 'full_name', values: ['Fatima'] },
    { name: 'phone_number', values: ['+971501111111'] },
    { name: 'authorization', values: ['yes I consent'] },
  ] }), CTX)[0].json;
  const cs = JSON.stringify(collide.hydrated_payload);
  ck('a form question that collides with the constraint still yields a promotable lead',
     collide.can_promote === true && !CONSTRAINT.test(cs), cs.slice(0, 400));
  ck('and the customer answer to it survives verbatim in normalized',
     /yes I consent/.test(collide.normalized.message || ''), collide.normalized.message);
}

console.log('\nForms that did not collect enough to reach anyone');
{
  const noContact = runNormalize(graph({ field_data: [{ name: 'full_name', values: ['Ahmed'] }] }), CTX)[0].json;
  ck('name only is refused with the promoter\'s own reason',
     noContact.can_promote === false && noContact.normalized_defect === 'NORMALIZED_NEEDS_EMAIL_OR_PHONE', String(noContact.normalized_defect));
  const noName = runNormalize(graph({ field_data: [{ name: 'email', values: ['a@b.com'] }] }), CTX)[0].json;
  ck('contact without a name is refused too', noName.normalized_defect === 'NORMALIZED_FULL_NAME_REQUIRED', String(noName.normalized_defect));
  const split = runNormalize(graph({ field_data: [
    { name: 'first_name', values: ['Ahmed'] }, { name: 'last_name', values: ['Khan'] },
    { name: 'phone_number', values: ['0501234567'] }] }), CTX)[0].json;
  ck('first + last become a full name', split.normalized.full_name === 'Ahmed Khan', split.normalized.full_name);
  ck('a local UAE 05x number becomes E.164', split.normalized.phone_e164 === '+971501234567', split.normalized.phone_e164);
  const bad = runNormalize(graph({ field_data: [
    { name: 'full_name', values: ['Ahmed'] }, { name: 'phone_number', values: ['12'] }] }), CTX)[0].json;
  ck('an unparseable phone is reported, never repaired by guessing a country',
     bad.normalized.phone_e164 === undefined && bad.hydrated_payload.phone_unparseable === '12', JSON.stringify(bad.hydrated_payload.phone_unparseable));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
