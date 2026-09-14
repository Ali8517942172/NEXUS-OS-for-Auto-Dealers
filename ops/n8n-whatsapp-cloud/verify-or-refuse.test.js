/* Runs the exact Code-node body from verify-or-refuse.node.js in a harness that
 * fakes n8n's $input / $env / $helpers, so every branch is exercised before it
 * is deployed rather than after a customer hits it.
 *
 * Deploying and then poking the live URL only reaches the branches the box's
 * current configuration allows. With no META_APP_SECRET set on the VM, the live
 * probe can only ever reach one refusal. This harness reaches all of them.
 *
 * 14 Sep 2026: the node became multi-tenant. The secret is no longer one value
 * on the box -- it is resolved per delivery from the vault, keyed on the
 * phone_number_id Meta sent. So the harness now fakes the database too, and the
 * cases that matter most are the new ones at the bottom: two dealerships with
 * different secrets, each verified under their own, and neither under the
 * other's.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC = fs.readFileSync(path.join(__dirname, 'verify-or-refuse.node.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/* A fake of the two RPCs the node calls. `vault` maps phone_number_id ->
 * { secret, tenant_id }; `tokens` maps a verify token -> { tenant_id, pnid }.
 * `down: true` makes every call fail, which is how an unreachable database is
 * tested -- it must end in a readable refusal, not an n8n exception. */
function makeHelpers({ vault = {}, tokens = {}, down = false } = {}) {
  const calls = [];
  return {
    calls,
    $helpers: {
      httpRequest: async (opts) => {
        calls.push(opts.url);
        if (down) throw new Error('ECONNREFUSED');
        if (opts.url.endsWith('/rpc/nexus_channel_secret_reveal')) {
          const hit = vault[opts.body.p_phone_number_id];
          if (!hit) throw new Error('NX930 NO_CREDENTIAL');
          return [{ tenant_id: hit.tenant_id, integration_id: 'int-' + hit.tenant_id,
                    secret: hit.secret }];
        }
        if (opts.url.endsWith('/rpc/nexus_channel_verify_token_matches')) {
          const hit = tokens[opts.body.p_token];
          return hit ? [{ tenant_id: hit.tenant_id, integration_id: 'int-' + hit.tenant_id,
                          phone_number_id: hit.pnid }] : [];
        }
        throw new Error('unexpected rpc ' + opts.url);
      },
    },
  };
}

const DB = { SUPABASE_URL: 'https://db.example.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };

async function runNode({ env = {}, json = {}, binary = null, helpers = null }) {
  const h = helpers || makeHelpers();
  const fn = new AsyncFunction('$input', '$env', '$helpers', 'Buffer',
    '"use strict";' + SRC);
  return fn({ first: () => ({ json, binary }) }, env, h.$helpers, Buffer);
}

let pass = 0, fail = 0;
const ck = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS' : '** FAIL **') + '  ' + label + (cond ? '' : '\n   ' + detail));
};

const SECRET = 'an-app-secret';
const TOKEN = 'a-verify-token';
const PNID = '1306545252542419';

const metaBody = (name, pnid) => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{
    id: '1098665496068509',
    changes: [{
      field: 'messages',
      value: {
        metadata: { display_phone_number: '15556724466', phone_number_id: pnid || PNID },
        contacts: [{ profile: { name }, wa_id: '918517942172' }],
        messages: [{
          from: '918517942172', id: 'wamid.HBgMOTE4NTE3OTQyMTcy', timestamp: '1788700000',
          type: 'text', text: { body: 'Is the Fortuner still available?' },
        }],
      },
    }],
  }],
});
const escapeNonAscii = s =>
  s.replace(/[-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

/* Legacy path: the migration secret on the box, no vault entry. */
const post = (wireString, secretForSig, envOverride, helpers) => {
  const buf = Buffer.from(wireString, 'utf8');
  const sig = 'sha256=' + crypto.createHmac('sha256', secretForSig).update(buf).digest('hex');
  return runNode({
    env: Object.assign({ META_APP_SECRET: SECRET, META_WEBHOOK_VERIFY_TOKEN: TOKEN }, envOverride || {}),
    json: { headers: { 'x-hub-signature-256': sig }, query: {} },
    binary: { data: { data: buf.toString('base64'), mimeType: 'application/json' } },
    helpers,
  });
};

(async () => {

console.log('\nGET subscription handshake');
{
  const notSub = await runNode({ env: { META_WEBHOOK_VERIFY_TOKEN: TOKEN },
    json: { query: { 'hub.mode': 'unsubscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '999' } } });
  ck('refuses 400 when hub.mode is not subscribe', notSub[0].json.respond_status === 400, JSON.stringify(notSub[0].json));

  const noToken = await runNode({ env: {}, json: { query: { 'hub.mode': 'subscribe', 'hub.challenge': '999' } } });
  ck('refuses 403 when the handshake carries no token',
     noToken[0].json.reason_code === 'HUB_VERIFY_TOKEN_MISSING', JSON.stringify(noToken[0].json));

  const wrong = await runNode({ env: { META_WEBHOOK_VERIFY_TOKEN: TOKEN },
    json: { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'guess', 'hub.challenge': '999' } } });
  ck('refuses 403 on a token that matches nobody', wrong[0].json.respond_status === 403, JSON.stringify(wrong[0].json));

  const good = await runNode({ env: { META_WEBHOOK_VERIFY_TOKEN: TOKEN },
    json: { query: { 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '999' } } });
  ck('echoes the challenge on the migration token and says so',
     good[0].json.verdict === 'CHALLENGE' && good[0].json.respond_text === '999' &&
     good[0].json.wrote_nothing === true && good[0].json.verify_token_source === 'env_global_fallback',
     JSON.stringify(good[0].json));

  const h = makeHelpers({ tokens: { 'dealer-two-token': { tenant_id: 'T2', pnid: '999' } } });
  const perDealer = await runNode({ env: DB, helpers: h,
    json: { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'dealer-two-token', 'hub.challenge': '42' } } });
  ck('a dealership token names that dealership and never leaves the database',
     perDealer[0].json.verdict === 'CHALLENGE' && perDealer[0].json.tenant_id === 'T2' &&
     perDealer[0].json.verify_token_source === 'vault_per_dealer' && perDealer[0].json.respond_text === '42',
     JSON.stringify(perDealer[0].json));
  ck('and the token was compared by the database, not fetched into n8n',
     h.calls.length === 1 && h.calls[0].endsWith('/rpc/nexus_channel_verify_token_matches'),
     JSON.stringify(h.calls));

  const strict = await runNode({
    env: Object.assign({ META_WEBHOOK_VERIFY_TOKEN: TOKEN, NEXUS_REQUIRE_PER_DEALER_SECRETS: 'true' }, DB),
    json: { query: { 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '999' } } });
  ck('STRICT mode refuses the migration token outright',
     strict[0].json.reason_code === 'HUB_VERIFY_TOKEN_UNKNOWN', JSON.stringify(strict[0].json));
}

console.log('\nThe gate must never be dormant');
{
  const r = await runNode({ env: {}, json: { headers: { 'x-hub-signature-256': 'sha256=' + 'a'.repeat(64) }, query: {} },
                      binary: { data: { data: Buffer.from(metaBody('Ahmed')).toString('base64') } } });
  ck('refuses 500 with no secret anywhere, even with a well-formed signature header',
     r[0].json.reason_code === 'NO_APP_SECRET_FOR_THIS_DELIVERY' && r[0].json.respond_status === 500,
     JSON.stringify(r[0].json));
  ck('and its HMAC self-test passes all vectors and rejects the negative control',
     r[0].json.hmac_selftest && r[0].json.hmac_selftest.ok === true &&
     r[0].json.hmac_selftest.failed === 0 && r[0].json.hmac_selftest.negative_control_rejects === true,
     JSON.stringify(r[0].json.hmac_selftest));

  const dbDown = await runNode({ env: Object.assign({ NEXUS_REQUIRE_PER_DEALER_SECRETS: 'true' }, DB),
    helpers: makeHelpers({ down: true }),
    json: { headers: { 'x-hub-signature-256': 'sha256=' + 'a'.repeat(64) }, query: {} },
    binary: { data: { data: Buffer.from(metaBody('Ahmed')).toString('base64') } } });
  ck('an unreachable vault refuses readably instead of throwing',
     dbDown[0].json.reason_code === 'NO_APP_SECRET_FOR_THIS_DELIVERY' && dbDown[0].json.respond_status === 500,
     JSON.stringify(dbDown[0].json));
}

console.log('\nSignature verification');
{
  const noHeader = await runNode({ env: { META_APP_SECRET: SECRET }, json: { headers: {}, query: {} },
                             binary: { data: { data: Buffer.from(metaBody('Ahmed')).toString('base64') } } });
  ck('refuses 401 with no signature header', noHeader[0].json.reason_code === 'SIGNATURE_HEADER_MISSING', JSON.stringify(noHeader[0].json));

  const forged = await post(metaBody('Ahmed'), 'a-different-secret');
  ck('refuses 401 on a signature made with the wrong secret', forged[0].json.reason_code === 'SIGNATURE_MISMATCH', JSON.stringify(forged[0].json));

  const wire = escapeNonAscii(metaBody('Ahmed'));
  const buf = Buffer.from(wire, 'utf8');
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(buf).digest('hex');
  const tampered = await runNode({
    env: { META_APP_SECRET: SECRET },
    json: { headers: { 'x-hub-signature-256': sig }, query: {} },
    binary: { data: { data: Buffer.concat([buf, Buffer.from(' ')]).toString('base64') } },
  });
  ck('refuses 401 when the body was changed after signing', tampered[0].json.reason_code === 'SIGNATURE_MISMATCH', JSON.stringify(tampered[0].json));

  const sha1 = await runNode({ env: { META_APP_SECRET: SECRET },
    json: { headers: { 'x-hub-signature-256': 'sha1=' + 'a'.repeat(40) }, query: {} },
    binary: { data: { data: buf.toString('base64') } } });
  ck('refuses a sha1= prefixed header', sha1[0].json.reason_code === 'SIGNATURE_HEADER_MISSING', JSON.stringify(sha1[0].json));

  const truncated = await runNode({ env: { META_APP_SECRET: SECRET },
    json: { headers: { 'x-hub-signature-256': sig.slice(0, 40) }, query: {} },
    binary: { data: { data: buf.toString('base64') } } });
  ck('refuses a truncated digest', truncated[0].json.reason_code === 'SIGNATURE_MISMATCH', JSON.stringify(truncated[0].json));

  const upper = await runNode({ env: { META_APP_SECRET: SECRET },
    json: { headers: { 'x-hub-signature-256': 'sha256=' + sig.slice(7).toUpperCase() }, query: {} },
    binary: { data: { data: buf.toString('base64') } } });
  ck('refuses uppercase hex - Meta sends lowercase', upper[0].json.reason_code === 'SIGNATURE_MISMATCH', JSON.stringify(upper[0].json));
}

console.log('\nTwo dealerships, two secrets — the whole point of today');
{
  const A = { pnid: '111111111111111', secret: 'alba-app-secret', tenant: 'T-ALBA' };
  const B = { pnid: '222222222222222', secret: 'other-app-secret', tenant: 'T-OTHER' };
  const helpers = () => makeHelpers({ vault: {
    [A.pnid]: { secret: A.secret, tenant_id: A.tenant },
    [B.pnid]: { secret: B.secret, tenant_id: B.tenant } } });
  const strictEnv = Object.assign({ NEXUS_REQUIRE_PER_DEALER_SECRETS: 'true' }, DB);

  const send = (dealer, signWith, env) => {
    const buf = Buffer.from(metaBody('Ahmed', dealer.pnid), 'utf8');
    const sig = 'sha256=' + crypto.createHmac('sha256', signWith).update(buf).digest('hex');
    return runNode({ env: env || strictEnv, helpers: helpers(),
      json: { headers: { 'x-hub-signature-256': sig }, query: {} },
      binary: { data: { data: buf.toString('base64') } } });
  };

  const a = await send(A, A.secret);
  ck('dealership A verifies under A\'s own secret and is named',
     a[0].json.verdict === 'ACCEPT' && a[0].json.tenant_id === A.tenant &&
     a[0].json.app_secret_source === 'vault_per_dealer', JSON.stringify(a[0].json));

  const b = await send(B, B.secret);
  ck('dealership B verifies under B\'s own secret and is named',
     b[0].json.verdict === 'ACCEPT' && b[0].json.tenant_id === B.tenant &&
     b[0].json.app_secret_source === 'vault_per_dealer', JSON.stringify(b[0].json));

  const crossed = await send(B, A.secret);
  ck('B\'s delivery signed with A\'s secret is REFUSED — one dealership cannot forge another',
     crossed[0].json.reason_code === 'SIGNATURE_MISMATCH', JSON.stringify(crossed[0].json));

  const unknown = await send({ pnid: '333333333333333' }, 'whatever');
  ck('an unregistered phone_number_id is refused, not passed through',
     unknown[0].json.reason_code === 'NO_APP_SECRET_FOR_THIS_DELIVERY', JSON.stringify(unknown[0].json));

  /* The forger's move: claim to be a dealership whose secret they do not have. */
  const impersonation = (() => {
    const buf = Buffer.from(metaBody('Ahmed', A.pnid), 'utf8');
    const sig = 'sha256=' + crypto.createHmac('sha256', 'attacker-guess').update(buf).digest('hex');
    return runNode({ env: strictEnv, helpers: helpers(),
      json: { headers: { 'x-hub-signature-256': sig }, query: {} },
      binary: { data: { data: buf.toString('base64') } } });
  })();
  const imp = await impersonation;
  ck('naming a real dealership without their secret still fails the HMAC',
     imp[0].json.reason_code === 'SIGNATURE_MISMATCH' && imp[0].json.verdict === 'REFUSE',
     JSON.stringify(imp[0].json));

  /* STRICT is the switch that ends the migration. Until it is on, a delivery
     the vault cannot place still verifies under the box secret -- and says so. */
  const fellBack = await post(metaBody('Ahmed'), SECRET, DB, helpers());
  ck('without STRICT, an unplaceable delivery falls back and is LABELLED as fallback',
     fellBack[0].json.verdict === 'ACCEPT' &&
     fellBack[0].json.app_secret_source === 'env_global_fallback' &&
     fellBack[0].json.tenant_id === null, JSON.stringify(fellBack[0].json));

  const noFallback = await runNode({ env: Object.assign({ META_APP_SECRET: SECRET }, strictEnv),
    helpers: helpers(),
    json: { headers: { 'x-hub-signature-256': 'sha256=' + 'a'.repeat(64) }, query: {} },
    binary: { data: { data: Buffer.from(metaBody('Ahmed')).toString('base64') } } });
  ck('with STRICT on, the box secret is not used even when it is set',
     noFallback[0].json.reason_code === 'NO_APP_SECRET_FOR_THIS_DELIVERY' &&
     noFallback[0].json.strict_per_dealer === true, JSON.stringify(noFallback[0].json));
}

console.log('\nThe Arabic name, which is the whole reason this file exists');
{
  for (const [label, name] of [['Ahmed (ASCII)', 'Ahmed'], ['محمد (Arabic)', 'محمد']]) {
    for (const [form, f] of [['literal UTF-8', s => s], ['Meta escaped-unicode', escapeNonAscii]]) {
      const r = await post(f(metaBody(name)), SECRET);
      ck('accepts a genuine delivery: ' + label + ', ' + form + ' wire form',
         r[0].json.verdict === 'ACCEPT' && r[0].json.origin_verified === 'hmac_sha256_x_hub',
         JSON.stringify(r[0].json));
    }
  }
  const r = await post(escapeNonAscii(metaBody('محمد')), SECRET);
  ck('and the customer name survives the escaped wire form', r[0].json.customer_name === 'محمد', r[0].json.customer_name);
}

console.log('\nWhat a verified delivery yields');
{
  const r = (await post(escapeNonAscii(metaBody('Ahmed')), SECRET))[0].json;
  ck('tenant identity comes from Meta metadata.phone_number_id, not from anything the caller named',
     r.phone_number_id === PNID, r.phone_number_id);
  ck('carries the provider message id, not a per-delivery id',
     r.message_id === 'wamid.HBgMOTE4NTE3OTQyMTcy', r.message_id);
  ck('dates the message from the provider timestamp',
     r.occurred_at === new Date(1788700000 * 1000).toISOString(), r.occurred_at);
  ck('hashes the raw bytes handed over as binary, not a re-serialised object', r.raw_source === 'binary', r.raw_source);
}

console.log('\nDeliveries that verify but must not be measured');
{
  const noId = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: { metadata: { phone_number_id: PNID }, messages: [{ from: '918517942172', timestamp: '1788700000', type: 'text', text: { body: 'hi' } }] } }] }] });
  ck('a message with no provider id is accepted but not measurable',
     (await post(noId, SECRET))[0].json.verdict === 'ACCEPT_UNMEASURABLE', 'see above');

  const noTs = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: { metadata: { phone_number_id: PNID }, messages: [{ from: '918517942172', id: 'wamid.X', type: 'text', text: { body: 'hi' } }] } }] }] });
  ck('an undated message is accepted but not measurable',
     (await post(noTs, SECRET))[0].json.verdict === 'ACCEPT_UNMEASURABLE', 'see above');

  const statusOnly = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: { metadata: { phone_number_id: PNID }, statuses: [{ id: 'wamid.X', status: 'delivered' }] } }] }] });
  ck('a status callback verifies and writes nothing',
     (await post(statusOnly, SECRET))[0].json.verdict === 'ACCEPT_NO_MESSAGE', 'see above');

  const notJson = Buffer.from('not json at all', 'utf8');
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(notJson).digest('hex');
  const r = await runNode({ env: { META_APP_SECRET: SECRET }, json: { headers: { 'x-hub-signature-256': sig }, query: {} },
                      binary: { data: { data: notJson.toString('base64') } } });
  ck('a correctly signed non-JSON body is refused 400', r[0].json.reason_code === 'BODY_NOT_JSON', JSON.stringify(r[0].json));
}

console.log('\nTwo messages in one delivery');
{
  const two = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: { metadata: { phone_number_id: PNID }, messages: [
    { from: '918517942172', id: 'wamid.A', timestamp: '1788700000', type: 'text', text: { body: 'one' } },
    { from: '918517942172', id: 'wamid.B', timestamp: '1788700060', type: 'text', text: { body: 'two' } }] } }] }] });
  const r = await post(two, SECRET);
  ck('both messages become items - neither is silently dropped',
     r.length === 2 && r[0].json.message_id === 'wamid.A' && r[1].json.message_id === 'wamid.B',
     JSON.stringify(r.map(x => x.json.message_id)));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
})();
