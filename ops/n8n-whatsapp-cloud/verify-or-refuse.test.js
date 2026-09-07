/* Runs the exact Code-node body from verify-or-refuse.node.js in a harness that
 * fakes n8n's $input / $env, so every branch is exercised before it is deployed
 * rather than after a customer hits it.
 *
 * Deploying and then poking the live URL only reaches the branches the box's
 * current configuration allows. With no META_APP_SECRET set on the VM, the live
 * probe can only ever reach one refusal. This harness reaches all of them.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC = fs.readFileSync(path.join(__dirname, 'verify-or-refuse.node.js'), 'utf8');

function runNode({ env = {}, json = {}, binary = null }) {
  const $env = env;
  const $input = { first: () => ({ json, binary }) };
  // eslint-disable-next-line no-new-func
  const fn = new Function('$input', '$env', 'Buffer', '"use strict";' + SRC);
  return fn($input, $env, Buffer);
}

let pass = 0, fail = 0;
const ck = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS' : '** FAIL **') + '  ' + label + (cond ? '' : '\n   ' + detail));
};

const SECRET = 'an-app-secret';
const TOKEN = 'a-verify-token';

const metaBody = name => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{
    id: '1098665496068509',
    changes: [{
      field: 'messages',
      value: {
        metadata: { display_phone_number: '15556724466', phone_number_id: '1306545252542419' },
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

const post = (wireString, secretForSig, envOverride) => {
  const buf = Buffer.from(wireString, 'utf8');
  const sig = 'sha256=' + crypto.createHmac('sha256', secretForSig).update(buf).digest('hex');
  return runNode({
    env: Object.assign({ META_APP_SECRET: SECRET, META_WEBHOOK_VERIFY_TOKEN: TOKEN }, envOverride || {}),
    json: { headers: { 'x-hub-signature-256': sig }, query: {} },
    binary: { data: { data: buf.toString('base64'), mimeType: 'application/json' } },
  });
};

console.log('\nGET subscription handshake');
{
  const noToken = runNode({ env: {}, json: { query: { 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '999' } } });
  ck('refuses 500 when no verify token is configured',
     noToken[0].json.reason_code === 'VERIFY_TOKEN_NOT_CONFIGURED' && noToken[0].json.respond_status === 500,
     JSON.stringify(noToken[0].json));

  const wrong = runNode({ env: { META_WEBHOOK_VERIFY_TOKEN: TOKEN }, json: { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'guess', 'hub.challenge': '999' } } });
  ck('refuses 403 on a wrong verify token', wrong[0].json.respond_status === 403, JSON.stringify(wrong[0].json));

  const notSub = runNode({ env: { META_WEBHOOK_VERIFY_TOKEN: TOKEN }, json: { query: { 'hub.mode': 'unsubscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '999' } } });
  ck('refuses 400 when hub.mode is not subscribe', notSub[0].json.respond_status === 400, JSON.stringify(notSub[0].json));

  const good = runNode({ env: { META_WEBHOOK_VERIFY_TOKEN: TOKEN }, json: { query: { 'hub.mode': 'subscribe', 'hub.verify_token': TOKEN, 'hub.challenge': '999' } } });
  ck('echoes the challenge on a correct token and writes nothing',
     good[0].json.verdict === 'CHALLENGE' && good[0].json.respond_text === '999' && good[0].json.wrote_nothing === true,
     JSON.stringify(good[0].json));
}

console.log('\nThe gate must never be dormant');
{
  const r = runNode({ env: {}, json: { headers: { 'x-hub-signature-256': 'sha256=' + 'a'.repeat(64) }, query: {} },
                      binary: { data: { data: Buffer.from(metaBody('Ahmed')).toString('base64') } } });
  ck('refuses 500 with no app secret, even with a well-formed signature header',
     r[0].json.reason_code === 'APP_SECRET_NOT_CONFIGURED' && r[0].json.respond_status === 500,
     JSON.stringify(r[0].json));
  ck('and its HMAC self-test passes all vectors and rejects the negative control',
     r[0].json.hmac_selftest && r[0].json.hmac_selftest.ok === true &&
     r[0].json.hmac_selftest.failed === 0 && r[0].json.hmac_selftest.negative_control_rejects === true,
     JSON.stringify(r[0].json.hmac_selftest));
}

console.log('\nSignature verification');
{
  const noHeader = runNode({ env: { META_APP_SECRET: SECRET }, json: { headers: {}, query: {} },
                             binary: { data: { data: Buffer.from(metaBody('Ahmed')).toString('base64') } } });
  ck('refuses 401 with no signature header', noHeader[0].json.reason_code === 'SIGNATURE_HEADER_MISSING', JSON.stringify(noHeader[0].json));

  const forged = post(metaBody('Ahmed'), 'a-different-secret');
  ck('refuses 401 on a signature made with the wrong secret', forged[0].json.reason_code === 'SIGNATURE_MISMATCH', JSON.stringify(forged[0].json));

  const wire = escapeNonAscii(metaBody('Ahmed'));
  const buf = Buffer.from(wire, 'utf8');
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(buf).digest('hex');
  const tampered = runNode({
    env: { META_APP_SECRET: SECRET },
    json: { headers: { 'x-hub-signature-256': sig }, query: {} },
    binary: { data: { data: Buffer.concat([buf, Buffer.from(' ')]).toString('base64') } },
  });
  ck('refuses 401 when the body was changed after signing', tampered[0].json.reason_code === 'SIGNATURE_MISMATCH', JSON.stringify(tampered[0].json));

  const sha1 = runNode({ env: { META_APP_SECRET: SECRET },
    json: { headers: { 'x-hub-signature-256': 'sha1=' + 'a'.repeat(40) }, query: {} },
    binary: { data: { data: buf.toString('base64') } } });
  ck('refuses a sha1= prefixed header', sha1[0].json.reason_code === 'SIGNATURE_HEADER_MISSING', JSON.stringify(sha1[0].json));

  const truncated = runNode({ env: { META_APP_SECRET: SECRET },
    json: { headers: { 'x-hub-signature-256': sig.slice(0, 40) }, query: {} },
    binary: { data: { data: buf.toString('base64') } } });
  ck('refuses a truncated digest', truncated[0].json.reason_code === 'SIGNATURE_MISMATCH', JSON.stringify(truncated[0].json));

  const upper = runNode({ env: { META_APP_SECRET: SECRET },
    json: { headers: { 'x-hub-signature-256': 'sha256=' + sig.slice(7).toUpperCase() }, query: {} },
    binary: { data: { data: buf.toString('base64') } } });
  ck('refuses uppercase hex - Meta sends lowercase', upper[0].json.reason_code === 'SIGNATURE_MISMATCH', JSON.stringify(upper[0].json));
}

console.log('\nThe Arabic name, which is the whole reason this file exists');
{
  for (const [label, name] of [['Ahmed (ASCII)', 'Ahmed'], ['محمد (Arabic)', 'محمد']]) {
    for (const [form, fn] of [['literal UTF-8', s => s], ['Meta escaped-unicode', escapeNonAscii]]) {
      const r = post(fn(metaBody(name)), SECRET);
      ck('accepts a genuine delivery: ' + label + ', ' + form + ' wire form',
         r[0].json.verdict === 'ACCEPT' && r[0].json.origin_verified === 'hmac_sha256_x_hub',
         JSON.stringify(r[0].json));
    }
  }
  const r = post(escapeNonAscii(metaBody('محمد')), SECRET);
  ck('and the customer name survives the escaped wire form', r[0].json.customer_name === 'محمد', r[0].json.customer_name);
}

console.log('\nWhat a verified delivery yields');
{
  const r = post(escapeNonAscii(metaBody('Ahmed')), SECRET)[0].json;
  ck('tenant identity comes from Meta metadata.phone_number_id, not from anything the caller named',
     r.phone_number_id === '1306545252542419', r.phone_number_id);
  ck('carries the provider message id, not a per-delivery id',
     r.message_id === 'wamid.HBgMOTE4NTE3OTQyMTcy', r.message_id);
  ck('dates the message from the provider timestamp',
     r.occurred_at === new Date(1788700000 * 1000).toISOString(), r.occurred_at);
  ck('hashes the raw bytes handed over as binary, not a re-serialised object', r.raw_source === 'binary', r.raw_source);
}

console.log('\nDeliveries that verify but must not be measured');
{
  const noId = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1306545252542419' }, messages: [{ from: '918517942172', timestamp: '1788700000', type: 'text', text: { body: 'hi' } }] } }] }] });
  ck('a message with no provider id is accepted but not measurable',
     post(noId, SECRET)[0].json.verdict === 'ACCEPT_UNMEASURABLE', JSON.stringify(post(noId, SECRET)[0].json));

  const noTs = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1306545252542419' }, messages: [{ from: '918517942172', id: 'wamid.X', type: 'text', text: { body: 'hi' } }] } }] }] });
  ck('an undated message is accepted but not measurable',
     post(noTs, SECRET)[0].json.verdict === 'ACCEPT_UNMEASURABLE', JSON.stringify(post(noTs, SECRET)[0].json));

  const statusOnly = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1306545252542419' }, statuses: [{ id: 'wamid.X', status: 'delivered' }] } }] }] });
  ck('a status callback verifies and writes nothing',
     post(statusOnly, SECRET)[0].json.verdict === 'ACCEPT_NO_MESSAGE', JSON.stringify(post(statusOnly, SECRET)[0].json));

  const notJson = Buffer.from('not json at all', 'utf8');
  const sig = 'sha256=' + crypto.createHmac('sha256', SECRET).update(notJson).digest('hex');
  const r = runNode({ env: { META_APP_SECRET: SECRET }, json: { headers: { 'x-hub-signature-256': sig }, query: {} },
                      binary: { data: { data: notJson.toString('base64') } } });
  ck('a correctly signed non-JSON body is refused 400', r[0].json.reason_code === 'BODY_NOT_JSON', JSON.stringify(r[0].json));
}

console.log('\nTwo messages in one delivery');
{
  const two = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1306545252542419' }, messages: [
    { from: '918517942172', id: 'wamid.A', timestamp: '1788700000', type: 'text', text: { body: 'one' } },
    { from: '918517942172', id: 'wamid.B', timestamp: '1788700060', type: 'text', text: { body: 'two' } }] } }] }] });
  const r = post(two, SECRET);
  ck('both messages become items - neither is silently dropped',
     r.length === 2 && r[0].json.message_id === 'wamid.A' && r[1].json.message_id === 'wamid.B',
     JSON.stringify(r.map(x => x.json.message_id)));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
