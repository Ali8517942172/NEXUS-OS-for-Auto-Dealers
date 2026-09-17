/* Runs the "Fetch Lead From Graph" Code-node body in a harness that fakes n8n's
 * $(), $env and $helpers, so every branch of hop two is exercised before Meta
 * ever hands this box a leadgen_id.
 *
 * Same reason receiver.test.js exists, only more so. Hop two cannot be poked
 * with curl even in principle: exercising it for real needs a Facebook Page, a
 * live lead form, a System User token with leads_retrieval AND a Lead Access
 * Manager grant — and the whole point of the node is what it does when one of
 * those four is missing. The harness is the only thing standing between
 * "written" and "hoped for".
 *
 * The two tokens below are invented strings, shaped like Meta's only so that
 * the leak assertions are searching for something realistic. Nothing in this
 * file is or has ever been a credential.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'fetch-lead-from-graph.node.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const DEALER_TOKEN = 'EAA' + 'd'.repeat(120);
const ENV_TOKEN    = 'EAA' + 'e'.repeat(120);

const CTX = { verdict: 'ACCEPT', page_id: '102938475610293', leadgen_id: '444444444444',
              form_id: '222222222222', ad_id: '555555555555' };
const REC = { event_id: 'evt-0001', tenant_id: 'ten-alba', phase: 'RECEIVED',
              was_duplicate: false, source_key: 'meta_lead_ads_facebook' };

const LEAD = {
  id: '444444444444',
  created_time: '2026-09-16T10:00:00+0000',
  form_id: '222222222222', ad_id: '555555555555', ad_name: 'Patrol - Retargeting',
  campaign_id: '777', campaign_name: 'Sep UAE SUV', is_organic: false,
  platform: 'instagram',
  field_data: [
    { name: 'full_name', values: ['محمد الأنصاري'] },
    { name: 'phone_number', values: ['+971501234567'] },
    { name: 'email', values: ['Mohammed@Example.com'] },
  ],
};

/* Every item every case produced, so the leak assertions at the bottom run over
   the whole suite rather than over whichever branch someone remembered. */
const EVERY_ITEM = [];

function fakeHttp(opts = {}) {
  const calls = [];
  const http = async (o) => {
    calls.push(o);
    if (/\/rest\/v1\/rpc\//.test(String(o.url))) {
      if (opts.rpcThrows) throw new Error('vault unreachable');
      return opts.secretRow ? [opts.secretRow] : [];
    }
    if (opts.graphThrows) {
      const e = new Error('connect ETIMEDOUT graph.facebook.com');
      if (opts.graphThrowResponse) e.response = opts.graphThrowResponse;
      throw e;
    }
    return opts.graph || { statusCode: 200, body: LEAD };
  };
  return { calls, http };
}

async function runFetch({ env = {}, ctx = CTX, recorded = REC, helpers = {} } = {}) {
  const mocks = { 'Verify Or Refuse': ctx, 'Record Lead Event': recorded };
  const $ = (name) => {
    if (!(name in mocks)) throw new Error('node body referenced an unknown upstream node: ' + name);
    return { item: { json: mocks[name] } };
  };
  const fn = new AsyncFunction('$', '$env', '$helpers', 'Buffer', '"use strict";' + SRC);
  const out = await fn($, env, helpers, Buffer);
  for (const it of (out || [])) EVERY_ITEM.push(it);
  return out;
}

const BASE_ENV = {
  SUPABASE_URL: 'https://dsvuoovivysszdoiorch.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-placeholder',
};

let pass = 0, fail = 0;
const ck = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS' : '** FAIL **') + '  ' + label + (cond ? '' : '\n   ' + detail));
};

const graphCall = (calls) => calls.find(c => /graph\.facebook\.com/.test(String(c.url)));
const rpcCall   = (calls) => calls.find(c => /\/rest\/v1\/rpc\//.test(String(c.url)));

(async () => {

console.log('\nThe token comes from the dealership, not from the box');
{
  const { calls, http } = fakeHttp({ secretRow: {
    tenant_id: 'ten-alba', endpoint_id: '4d4f5cf2-f966-4d4e-9d9e-605757c615b7',
    source_key: 'meta_lead_ads_facebook', secret: DEALER_TOKEN } });
  const r = (await runFetch({ env: BASE_ENV, helpers: { httpRequest: http } }))[0].json;

  ck('a per-dealer token resolves and the fetch succeeds',
     r.verdict === 'FETCHED' && r.token_source === 'vault_per_dealer', JSON.stringify(r.reason_code));
  ck('it was resolved through the page id, by provider identity',
     rpcCall(calls).body.p_identity_value === '102938475610293' &&
     rpcCall(calls).body.p_identity_kind === 'facebook_page_id' &&
     rpcCall(calls).body.p_kind === 'meta_page_access_token',
     JSON.stringify(rpcCall(calls).body));
  ck('the dealership the vault named is carried out',
     r.tenant_id === 'ten-alba' && r.endpoint_id === '4d4f5cf2-f966-4d4e-9d9e-605757c615b7',
     JSON.stringify([r.tenant_id, r.endpoint_id]));

  const g = graphCall(calls);
  ck('the token travelled in an Authorization header',
     String(g.headers.Authorization) === 'Bearer ' + DEALER_TOKEN, Object.keys(g.headers).join(','));
  ck('and NEVER in the query string, where n8n and every proxy would keep it',
     !/access_token/i.test(String(g.url)) &&
     !/access_token/i.test(JSON.stringify(g.qs || {})),
     String(g.url) + ' ' + JSON.stringify(g.qs));
  ck('the request asks for exactly the fields hop three allowlists',
     /field_data/.test(g.qs.fields) && /platform/.test(g.qs.fields) && /is_organic/.test(g.qs.fields),
     String(g.qs.fields));
  ck('the version is pinned in the path',
     /graph\.facebook\.com\/v\d+\.\d+\/444444444444$/.test(String(g.url)), String(g.url));

  /* hop three reads $input.first().json AS the Graph response. If this shape
     drifts, normalize-and-redact.node.js silently hydrates an empty customer. */
  ck('the output item IS the Graph response, which is what hop three reads',
     r.id === '444444444444' && Array.isArray(r.field_data) && r.field_data.length === 3 &&
     r.platform === 'instagram', JSON.stringify(Object.keys(r)).slice(0, 300));
  ck('and it carries the event_id hop three needs from Record Lead Event',
     r.event_id === 'evt-0001', String(r.event_id));
}

console.log('\nStrict mode: no per-dealer token means no fetch, whatever is on the box');
{
  const { calls, http } = fakeHttp({ secretRow: null });
  const r = (await runFetch({
    env: Object.assign({}, BASE_ENV, { NEXUS_REQUIRE_PER_DEALER_SECRETS: 'true',
                                       META_PAGE_ACCESS_TOKEN: ENV_TOKEN }),
    helpers: { httpRequest: http } }))[0].json;

  ck('refuses when the vault holds nothing for this Page',
     r.verdict === 'NOT_FETCHED' && r.reason_code === 'NO_PAGE_TOKEN_FOR_THIS_PAGE', JSON.stringify(r.reason_code));
  ck('and says it refused BECAUSE strict is on, not because the box is empty',
     r.strict_per_dealer === true && /NEXUS_REQUIRE_PER_DEALER_SECRETS/.test(r.why), r.why);
  ck('the env token on the box was not used and no fetch was attempted',
     r.token_source === null && graphCall(calls) === undefined, String(r.token_source));
  ck('it asks Meta to retry, because a human can still install the token',
     r.respond_status === 500 && r.retryable === true, String(r.respond_status));
  ck('the row is left where door one put it',
     r.hydration_blocked === true && r.phase_remains === 'RECEIVED', JSON.stringify(r.phase_remains));
}

console.log('\nThe migration fallback: only with strict off, and labelled as itself');
{
  const { calls, http } = fakeHttp({ secretRow: null });
  const r = (await runFetch({
    env: Object.assign({}, BASE_ENV, { META_PAGE_ACCESS_TOKEN: ENV_TOKEN }),
    helpers: { httpRequest: http } }))[0].json;
  ck('with strict off the box token is used',
     r.verdict === 'FETCHED' && r.token_source === 'env_global_fallback', JSON.stringify([r.verdict, r.token_source]));
  ck('and it is NOT claimed as a dealership-held credential',
     r.tenant_id === null && r.endpoint_id === null, JSON.stringify([r.tenant_id, r.endpoint_id]));
  ck('the fallback token also went in the header',
     String(graphCall(calls).headers.Authorization) === 'Bearer ' + ENV_TOKEN, 'header');

  /* The vault wins whenever it answers. Otherwise installing a dealership's
     token changes nothing for as long as the migration var stays set. */
  const both = fakeHttp({ secretRow: { tenant_id: 'ten-alba', endpoint_id: 'e1',
                                       source_key: 'meta_lead_ads_facebook', secret: DEALER_TOKEN } });
  const rb = (await runFetch({
    env: Object.assign({}, BASE_ENV, { META_PAGE_ACCESS_TOKEN: ENV_TOKEN }),
    helpers: { httpRequest: both.http } }))[0].json;
  ck('when both exist the dealership\'s own token wins',
     rb.token_source === 'vault_per_dealer' &&
     String(graphCall(both.calls).headers.Authorization) === 'Bearer ' + DEALER_TOKEN, rb.token_source);

  const noneAtAll = fakeHttp({ secretRow: null });
  const rn = (await runFetch({ env: BASE_ENV, helpers: { httpRequest: noneAtAll.http } }))[0].json;
  ck('with neither a vault row nor a box token it refuses rather than fetching blank',
     rn.reason_code === 'NO_PAGE_TOKEN_FOR_THIS_PAGE' && graphCall(noneAtAll.calls) === undefined, rn.reason_code);

  const vaultDown = fakeHttp({ rpcThrows: true });
  const rv = (await runFetch({
    env: Object.assign({}, BASE_ENV, { NEXUS_REQUIRE_PER_DEALER_SECRETS: 'true' }),
    helpers: { httpRequest: vaultDown.http } }))[0].json;
  ck('an unreachable vault ends in a readable refusal, not an n8n exception',
     rv.verdict === 'NOT_FETCHED' && rv.reason_code === 'NO_PAGE_TOKEN_FOR_THIS_PAGE' && rv.retryable === true,
     JSON.stringify(rv.reason_code));
}

console.log('\nThe three refusals a dealership will actually hit, told apart');
{
  /* Meta's own message echoes the request back, and the request carried a
     Bearer token. It is planted here so the leak assertions have something real
     to catch. */
  const err = (code, subcode) => ({ statusCode: 400, body: { error: {
    message: 'Invalid OAuth access token for request GET /v25.0/444444444444 ' +
             '?access_token=' + DEALER_TOKEN,
    type: 'OAuthException', code, error_subcode: subcode, fbtrace_id: 'AbCdEf' } } });

  const row = { tenant_id: 'ten-alba', endpoint_id: 'e1', source_key: 'meta_lead_ads_facebook', secret: DEALER_TOKEN };

  const r190 = (await runFetch({ env: BASE_ENV,
    helpers: { httpRequest: fakeHttp({ secretRow: row, graph: err(190, 463) }).http } }))[0].json;
  const r10 = (await runFetch({ env: BASE_ENV,
    helpers: { httpRequest: fakeHttp({ secretRow: row, graph: err(10, null) }).http } }))[0].json;
  const r200 = (await runFetch({ env: BASE_ENV,
    helpers: { httpRequest: fakeHttp({ secretRow: row, graph: err(200, null) }).http } }))[0].json;

  ck('190 is named as the token being dead, not as a permission',
     r190.reason_code === 'GRAPH_TOKEN_REJECTED' && /expired, revoked/.test(r190.why), r190.reason_code);
  ck('10 is named as the token missing leads_retrieval',
     r10.reason_code === 'GRAPH_LEADS_RETRIEVAL_PERMISSION_MISSING' && /leads_retrieval/.test(r10.why), r10.reason_code);
  ck('200 is named as the Lead Access Manager grant that was never given',
     r200.reason_code === 'GRAPH_LEAD_ACCESS_NOT_GRANTED' && /Lead Access\s+Manager/.test(r200.why), r200.reason_code);
  ck('and 200 says out loud that this is the failure that looks like success',
     /LOOKS LIKE SUCCESS/.test(r200.why), r200.why.slice(0, 120));
  ck('the three reasons are distinct, so a dealership is not sent to the wrong screen',
     new Set([r190.reason_code, r10.reason_code, r200.reason_code]).size === 3, '');
  ck('the structured code and subcode are carried',
     r190.graph_error_code === 190 && r190.graph_error_subcode === 463 &&
     r190.graph_error_type === 'OAuthException', JSON.stringify([r190.graph_error_code, r190.graph_error_subcode]));
  ck('but Meta\'s message — which echoes the request — is NOT carried',
     !/Invalid OAuth/.test(JSON.stringify(r190)) && r190.message === undefined &&
     !/fbtrace/i.test(JSON.stringify(r190)), JSON.stringify(r190).slice(0, 300));
  ck('all three ask Meta to retry, because all three are things a human fixes',
     r190.respond_status === 500 && r10.respond_status === 500 && r200.respond_status === 500, '');

  const r100 = (await runFetch({ env: BASE_ENV,
    helpers: { httpRequest: fakeHttp({ secretRow: row, graph: err(100, null) }).http } }))[0].json;
  ck('100 is permanent and is answered 200, so Meta stops retrying a lost cause',
     r100.reason_code === 'GRAPH_LEAD_NOT_READABLE' && r100.respond_status === 200 && r100.retryable === false,
     JSON.stringify([r100.reason_code, r100.respond_status]));
  const rate = (await runFetch({ env: BASE_ENV,
    helpers: { httpRequest: fakeHttp({ secretRow: row, graph: err(17, null) }).http } }))[0].json;
  ck('a rate limit is retryable and named as one', rate.reason_code === 'GRAPH_RATE_LIMITED' && rate.retryable === true, rate.reason_code);
  const weird = (await runFetch({ env: BASE_ENV,
    helpers: { httpRequest: fakeHttp({ secretRow: row, graph: err(90210, null) }).http } }))[0].json;
  ck('an unclassified code refuses by name rather than falling through as success',
     weird.reason_code === 'GRAPH_ERROR_UNCLASSIFIED' && weird.verdict === 'NOT_FETCHED', weird.reason_code);

  const thrown = (await runFetch({ env: BASE_ENV, helpers: { httpRequest: fakeHttp({
    secretRow: row, graphThrows: true, graphThrowResponse: err(190, 463) }).http } }))[0].json;
  ck('an error Graph threw rather than returned is classified the same way',
     thrown.reason_code === 'GRAPH_TOKEN_REJECTED', thrown.reason_code);
  const dead = (await runFetch({ env: BASE_ENV, helpers: { httpRequest: fakeHttp({
    secretRow: row, graphThrows: true }).http } }))[0].json;
  ck('a call that never completed is GRAPH_UNREACHABLE and retryable',
     dead.reason_code === 'GRAPH_UNREACHABLE' && dead.retryable === true, dead.reason_code);
  ck('and the thrown error\'s own message does not ride out with it',
     !/ETIMEDOUT/.test(JSON.stringify(dead)), JSON.stringify(dead).slice(0, 200));
}

console.log('\nAnswers that arrive but must not be hydrated');
{
  const row = { tenant_id: 'ten-alba', endpoint_id: 'e1', source_key: 'meta_lead_ads_facebook', secret: DEALER_TOKEN };

  const mismatch = (await runFetch({ env: BASE_ENV, helpers: { httpRequest: fakeHttp({
    secretRow: row,
    graph: { statusCode: 200, body: Object.assign({}, LEAD, { id: '999999999999' }) } }).http } }))[0].json;
  ck('a 200 for a DIFFERENT lead id is refused, not hydrated',
     mismatch.verdict === 'NOT_FETCHED' && mismatch.reason_code === 'GRAPH_LEAD_ID_MISMATCH', mismatch.reason_code);
  ck('and it says why that matters — one customer\'s answers on another\'s row',
     /another customer/.test(mismatch.why) && mismatch.graph_returned_id === '999999999999', mismatch.why.slice(0, 120));
  ck('a mismatch is permanent, so it is answered 200 rather than retried forever',
     mismatch.respond_status === 200 && mismatch.retryable === false, String(mismatch.respond_status));

  const noFields = (await runFetch({ env: BASE_ENV, helpers: { httpRequest: fakeHttp({
    secretRow: row, graph: { statusCode: 200, body: { id: '444444444444', created_time: 'x' } } }).http } }))[0].json;
  ck('a lead with no field_data is refused here, where the cause is visible',
     noFields.verdict === 'NOT_FETCHED' && noFields.reason_code === 'GRAPH_LEAD_HAS_NO_FIELD_DATA', noFields.reason_code);
  const emptyFields = (await runFetch({ env: BASE_ENV, helpers: { httpRequest: fakeHttp({
    secretRow: row, graph: { statusCode: 200, body: { id: '444444444444', field_data: [] } } }).http } }))[0].json;
  ck('an empty field_data array is the same refusal, not an empty customer',
     emptyFields.reason_code === 'GRAPH_LEAD_HAS_NO_FIELD_DATA', emptyFields.reason_code);

  const noEvent = (await runFetch({ env: BASE_ENV, recorded: {},
    helpers: { httpRequest: fakeHttp({ secretRow: row }).http } }))[0].json;
  ck('with no event_id from Record Lead Event nothing is fetched at all',
     noEvent.reason_code === 'NO_EVENT_ID_FROM_RECORD' && noEvent.retryable === true, noEvent.reason_code);
  const noLead = (await runFetch({ env: BASE_ENV, ctx: { page_id: '102938475610293', leadgen_id: '' },
    helpers: { httpRequest: fakeHttp({ secretRow: row }).http } }))[0].json;
  ck('with no leadgen_id it refuses without inventing one',
     noLead.reason_code === 'NO_LEADGEN_ID_TO_FETCH' && noLead.respond_status === 200, noLead.reason_code);

  /* The allowlist in hop three covers the database row. Nothing covers the n8n
     execution record except this. */
  const withCred = (await runFetch({ env: BASE_ENV, helpers: { httpRequest: fakeHttp({
    secretRow: row,
    graph: { statusCode: 200, body: Object.assign({}, LEAD, {
      access_token: 'EAA' + 'z'.repeat(150), client_secret: 'nope' }) } }).http } }))[0].json;
  ck('a credential-named field in Graph\'s own answer is not copied into the item',
     withCred.verdict === 'FETCHED' && withCred.access_token === undefined &&
     withCred.client_secret === undefined, JSON.stringify(Object.keys(withCred)).slice(0, 300));
}

console.log('\nThe assertion the whole file exists for');
{
  const blob = JSON.stringify(EVERY_ITEM);
  ck('no output item produced by ANY case above contains the per-dealer token',
     EVERY_ITEM.length > 0 && blob.indexOf(DEALER_TOKEN) === -1,
     EVERY_ITEM.length + ' items checked');
  ck('nor the box-level migration token',
     blob.indexOf(ENV_TOKEN) === -1, EVERY_ITEM.length + ' items checked');
  ck('nor any EAA-shaped string at all',
     !/EAA[A-Za-z0-9_-]{20,}/.test(blob), (blob.match(/EAA[A-Za-z0-9_-]{20,}/) || [''])[0].slice(0, 20));
  ck('and no item ever carried Meta\'s request-echoing message',
     !/Invalid OAuth access token/.test(blob), '');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);

})().catch(e => { console.error('HARNESS ERROR: ' + (e && e.stack || e)); process.exit(1); });
