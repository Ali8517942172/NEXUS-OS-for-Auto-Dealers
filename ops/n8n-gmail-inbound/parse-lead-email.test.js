/* Runs the "Parse Lead Email" Code-node body in a harness that fakes n8n's
 * $input, so every branch is exercised before a single real customer's email is
 * ever polled.
 *
 * What is under test here that has no equivalent in the webhook receivers:
 * email is the one source where the FABRICATION is easy and invisible. There is
 * always a From address, so there is always something name-shaped to steal, and
 * a lead row with a plausible wrong name looks exactly like a lead row with a
 * right one. Most of the assertions below are about what this node REFUSES to
 * write down.
 *
 *     node ops/n8n-gmail-inbound/parse-lead-email.test.js
 */
const fs = require('fs');
const path = require('path');

const PARSE_SRC = fs.readFileSync(path.join(__dirname, 'parse-lead-email.node.js'), 'utf8');

function runParse(items) {
  const arr = (Array.isArray(items) ? items : [items]).map(j => ({ json: j }));
  const $input = { all: () => arr, first: () => arr[0] };
  return new Function('$input', 'Buffer', '"use strict";' + PARSE_SRC)($input, Buffer);
}
const one = item => runParse(item)[0].json;

let pass = 0, fail = 0;
const ck = (label, cond, detail) => {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS' : '** FAIL **') + '  ' + label + (cond ? '' : '\n   ' + detail));
};

/* --------------------------------------------------------------- fixtures */

const MSGID = '<CAF7d9-notify-8821@mail.dubizzle.com>';

/* Shape A: payload.headers as an ARRAY of { name, value } -- what the Gmail
   Trigger emits with Simplify OFF. Mixed case on purpose. */
const arrayHeaders = (over = {}) => {
  const base = {
    'Message-ID': MSGID,
    'From': '"Dubizzle Notifications" <no-reply@dubizzle.com>',
    'To': 'leads@albacars-nexus.com',
    'Subject': 'New enquiry on your listing: 2021 Nissan Patrol',
    'Date': 'Mon, 15 Sep 2026 09:14:02 +0400',
    'Authentication-Results': 'mx.google.com; spf=pass smtp.mailfrom=dubizzle.com',
  };
  const merged = Object.assign({}, base, over);
  return Object.keys(merged)
    .filter(k => merged[k] !== null)
    .map(k => ({ name: k, value: merged[k] }));
};

/* Shape B: a flat lowercase object -- what the same trigger emits on other
   versions / with Simplify ON. Same message, different container. */
const objectHeaders = (over = {}) => {
  const out = {};
  for (const h of arrayHeaders(over)) out[h.name.toLowerCase()] = h.value;
  return out;
};

const PLAIN_BODY = [
  'You have a new enquiry on your listing.',
  '',
  'Name: Khalid Al Marri',
  'Phone: +971501234567',
  'Vehicle: 2021 Nissan Patrol Platinum',
  'Message: Is the car still available? I can view it this weekend.',
  '',
  'Do not reply to this email.',
].join('\n');

const msgA = (over = {}, body = PLAIN_BODY) => ({
  id: '19a7c0f1e2b3',
  threadId: '19a7c0f1e2b3',
  internalDate: '1789456442000',
  payload: {
    mimeType: 'text/plain',
    headers: arrayHeaders(over),
    body: { data: Buffer.from(body, 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_') },
  },
});

const msgB = (over = {}, body = PLAIN_BODY) => ({
  id: '19a7c0f1e2b3',
  threadId: '19a7c0f1e2b3',
  headers: objectHeaders(over),
  text: body,
});

/* ------------------------------------------------------------------------- */
console.log('\nA well-formed marketplace notification');
{
  const r = one(msgA());
  ck('it parses', r.verdict === 'PARSED' && r.reason_code === 'EMAIL_PARSED', JSON.stringify(r).slice(0, 300));
  ck('the idempotency key is the RFC Message-ID with the angle brackets removed',
     r.external_event_id === 'CAF7d9-notify-8821@mail.dubizzle.com', String(r.external_event_id));
  ck('the provenance is the one the endpoint will be registered with',
     r.origin_verified === 'mailbox_read_oauth', String(r.origin_verified));
  ck('the name came from the body label, not from anywhere near the sender',
     r.normalized.full_name === 'Khalid Al Marri' && r.payload_raw.full_name_source === 'body_label',
     JSON.stringify(r.normalized) + ' src=' + r.payload_raw.full_name_source);
  ck('the phone survives as E.164', r.normalized.phone_e164 === '+971501234567',
     String(r.normalized.phone_e164));
  ck('the vehicle lands on the key the promoter reads',
     r.normalized.vehicle_of_interest === '2021 Nissan Patrol Platinum',
     JSON.stringify(r.normalized));
  ck('occurred_at comes from the Date header, not from now()',
     r.occurred_at === new Date('Mon, 15 Sep 2026 09:14:02 +0400').toISOString(),
     String(r.occurred_at));
  ck('it is promotable', r.can_promote === true && r.normalized_defect === null,
     JSON.stringify({ c: r.can_promote, d: r.normalized_defect }));
}

console.log('\nNo Message-ID: the one thing that stops ingestion dead');
{
  const r = one(msgA({ 'Message-ID': null }));
  ck('it refuses rather than inventing a key',
     r.verdict === 'REFUSED' && r.reason_code === 'NO_RFC_MESSAGE_ID', JSON.stringify(r).slice(0, 300));
  ck('and it says plainly that nothing was written', r.wrote_nothing === true, JSON.stringify(r));

  /* The defect this guards against: two customers, same listing, identical
     template bytes. A body hash would collapse them into one lead and the
     second person would simply never be called. */
  const a = one(msgA({ 'Message-ID': '<one@mail.dubizzle.com>' }));
  const b = one(msgA({ 'Message-ID': '<two@mail.dubizzle.com>' }));
  ck('two identical bodies with different Message-IDs are two events',
     a.external_event_id !== b.external_event_id &&
     JSON.stringify(a.normalized) === JSON.stringify(b.normalized),
     a.external_event_id + ' vs ' + b.external_event_id);
}

console.log('\nThe name, and the four ways it must NOT be obtained');
{
  const noLabel = PLAIN_BODY.replace('Name: Khalid Al Marri\n', '');

  const fromLocalPart = one(msgA({
    'From': 'khalid.almarri@example.com',
  }, noLabel));
  ck('a bare address never becomes a name',
     fromLocalPart.normalized.full_name === undefined &&
     fromLocalPart.payload_raw.full_name_source === null,
     JSON.stringify(fromLocalPart.normalized));

  const displayIsLocalPart = one(msgA({
    'From': '"khalid.almarri" <khalid.almarri@example.com>',
  }, noLabel));
  ck('a display name that is only the local-part repeated is not a name either',
     displayIsLocalPart.normalized.full_name === undefined,
     JSON.stringify(displayIsLocalPart.normalized));

  const robotDisplay = one(msgA({}, noLabel));
  ck("the marketplace's own no-reply display name is never the customer",
     robotDisplay.normalized.full_name === undefined &&
     !/Dubizzle/i.test(JSON.stringify(robotDisplay.normalized)),
     JSON.stringify(robotDisplay.normalized));

  const displayIsAddress = one(msgA({
    'From': '"ahmed@example.ae" <ahmed@example.ae>',
  }, noLabel));
  ck('a display name that is itself an address is not a name',
     displayIsAddress.normalized.full_name === undefined,
     JSON.stringify(displayIsAddress.normalized));

  /* The one allowed fallback: a human sending directly, whose own display name
     is a claim literally present in the message. Recorded as the weaker source. */
  const realSender = one(msgA({
    'From': '"Reem Al Suwaidi" <reem@example.ae>',
  }, noLabel));
  ck('a real sender\'s own display name is allowed, and marked as the weaker source',
     realSender.normalized.full_name === 'Reem Al Suwaidi' &&
     realSender.payload_raw.full_name_source === 'from_display_name',
     JSON.stringify(realSender.normalized));
}

console.log('\nPhones: normalised or dropped, never coerced');
{
  const local = one(msgA({}, PLAIN_BODY.replace('+971501234567', '0501234567')));
  ck('a UAE 05x local number becomes +9715...',
     local.normalized.phone_e164 === '+971501234567', String(local.normalized.phone_e164));

  const spaced = one(msgA({}, PLAIN_BODY.replace('+971501234567', '+971 50 123 4567')));
  ck('separators do not defeat it', spaced.normalized.phone_e164 === '+971501234567',
     String(spaced.normalized.phone_e164));

  const junk = one(msgA({}, PLAIN_BODY.replace('+971501234567', '12345')));
  ck('an unparseable number is DROPPED from normalized, not repaired by guessing',
     junk.normalized.phone_e164 === undefined, JSON.stringify(junk.normalized));
  ck('and it is reported, so nobody thinks the parser lost it',
     junk.payload_raw.phone_unparseable === '12345', String(junk.payload_raw.phone_unparseable));
  ck('the dropped number leaves the lead reachable by email instead, if there is one',
     junk.can_promote === false || junk.normalized.email !== undefined,
     JSON.stringify({ c: junk.can_promote, n: junk.normalized }));

  /* The exact shape the contract names. */
  const E164 = /^\+[1-9][0-9]{7,14}$/;
  ck('every phone this node emits satisfies the declared shape',
     [local, spaced].every(r => E164.test(r.normalized.phone_e164)),
     [local, spaced].map(r => r.normalized.phone_e164).join(','));
}

console.log('\nRobot addresses are never the customer');
{
  const r = one(msgA());
  ck("the marketplace's no-reply is not stored as the customer's email",
     r.normalized.email === undefined, JSON.stringify(r.normalized));
  ck('it is recorded as discarded, with the address, for the audit trail',
     r.payload_raw.discarded_robot_addresses.indexOf('no-reply@dubizzle.com') !== -1,
     JSON.stringify(r.payload_raw.discarded_robot_addresses));
  ck('but the lead is still promotable, because the body carried a phone',
     r.can_promote === true, JSON.stringify({ c: r.can_promote, d: r.normalized_defect }));

  for (const robot of ['no-reply@x.com', 'do-not-reply@x.com', 'notification@x.com',
                       'notifications@x.com', 'mailer-daemon@x.com', 'noreply@x.com']) {
    const q = one(msgA({ 'From': '<' + robot + '>', 'Reply-To': null },
      PLAIN_BODY.replace('Phone: +971501234567\n', '')));
    ck('discarded: ' + robot, q.normalized.email === undefined, JSON.stringify(q.normalized));
  }

  /* Reply-To is where a marketplace usually puts the actual buyer. */
  const withReplyTo = one(msgA({ 'Reply-To': '"Buyer" <buyer@example.ae>' }));
  ck('a non-robot Reply-To IS the customer, and says so',
     withReplyTo.normalized.email === 'buyer@example.ae' &&
     withReplyTo.payload_raw.email_source === 'reply_to_header',
     JSON.stringify(withReplyTo.normalized));

  const labelled = one(msgA({}, PLAIN_BODY + '\nEmail: khalid@example.ae'));
  ck('a labelled email in the body beats every header',
     labelled.normalized.email === 'khalid@example.ae' &&
     labelled.payload_raw.email_source === 'body_label',
     JSON.stringify(labelled.normalized));
}

console.log('\nThe normalised contract, enforced here so the refusal is specific');
{
  const nameOnly = one(msgA({ 'From': '<no-reply@dubizzle.com>', 'Reply-To': null },
    'Name: Khalid Al Marri\nVehicle: 2021 Nissan Patrol\n'));
  ck('a name with neither phone nor email is recorded but not promotable',
     nameOnly.verdict === 'PARSED' && nameOnly.can_promote === false,
     JSON.stringify(nameOnly).slice(0, 300));
  ck('and the defect is named, not a generic failure',
     nameOnly.normalized_defect === 'NORMALIZED_NEEDS_EMAIL_OR_PHONE' &&
     nameOnly.reason_code === 'NORMALIZED_NEEDS_EMAIL_OR_PHONE',
     String(nameOnly.normalized_defect));

  const noName = one(msgA({ 'From': '<no-reply@dubizzle.com>', 'Reply-To': null },
    'Phone: +971501234567\n'));
  ck('a contactable stranger with no name names its own defect',
     noName.can_promote === false &&
     noName.normalized_defect === 'NORMALIZED_FULL_NAME_REQUIRED',
     String(noName.normalized_defect));
}

console.log('\nBoth Gmail header shapes, because the trigger changes between versions');
{
  const a = one(msgA());
  const b = one(msgB());
  ck('the array-of-{name,value} shape resolves the Message-ID',
     a.external_event_id === 'CAF7d9-notify-8821@mail.dubizzle.com', String(a.external_event_id));
  ck('the flat lowercase-object shape resolves it too',
     b.external_event_id === 'CAF7d9-notify-8821@mail.dubizzle.com', String(b.external_event_id));
  ck('and both produce the identical normalized customer',
     JSON.stringify(a.normalized) === JSON.stringify(b.normalized),
     JSON.stringify(a.normalized) + ' vs ' + JSON.stringify(b.normalized));

  /* If one shape were unhandled, THIS is how it would show up in production:
     not as a parse error, but as a total refusal of every message. */
  ck('neither shape refuses', a.verdict === 'PARSED' && b.verdict === 'PARSED',
     a.verdict + '/' + b.verdict);
}

console.log('\nBodies that are not plain text');
{
  const html = {
    id: 'html-1',
    payload: {
      mimeType: 'multipart/alternative',
      headers: arrayHeaders(),
      parts: [{
        mimeType: 'text/html',
        body: { data: Buffer.from(
          '<table><tr><td>Name</td><td>Khalid Al Marri</td></tr>' +
          '<tr><td>Phone</td><td>+971501234567</td></tr></table>', 'utf8')
          .toString('base64').replace(/\+/g, '-').replace(/\//g, '_') },
      }],
    },
  };
  const r = one(html);
  ck('an HTML table collapses to labelled lines and still parses',
     r.normalized.full_name === 'Khalid Al Marri' &&
     r.normalized.phone_e164 === '+971501234567', JSON.stringify(r.normalized));
  ck('and the body source is recorded as HTML, not claimed as plain text',
     r.payload_raw.body_source === 'text/html', String(r.payload_raw.body_source));
}

console.log('\nA poll that returns several messages');
{
  const rs = runParse([msgA({ 'Message-ID': '<m1@x>' }), msgA({ 'Message-ID': null }),
                       msgA({ 'Message-ID': '<m3@x>' })]);
  ck('every message in the batch gets its own verdict', rs.length === 3,
     'got ' + rs.length);
  ck('one bad message does not take the good ones down with it',
     rs[0].json.verdict === 'PARSED' && rs[1].json.verdict === 'REFUSED' &&
     rs[2].json.verdict === 'PARSED',
     rs.map(r => r.json.verdict).join(','));
}

console.log('\nNothing fabricated leaks into what a salesperson reads');
{
  const r = one(msgA({}, 'Name: Khalid Al Marri\nPhone: +971501234567\n'));
  const KNOWN = ['full_name', 'phone_e164', 'email', 'vehicle_of_interest', 'message'];
  ck('normalized carries only keys the contract names',
     Object.keys(r.normalized).every(k => KNOWN.indexOf(k) !== -1),
     Object.keys(r.normalized).join(','));
  ck('and only the two fields this message actually contained',
     Object.keys(r.normalized).sort().join(',') === 'full_name,phone_e164',
     Object.keys(r.normalized).join(','));
  const vehicleKeys = Object.keys(one(msgA()).normalized).filter(k => /vehicle/i.test(k));
  ck('exactly one vehicle key, spelled the way nexus_promote_lead_event reads it',
     vehicleKeys.length === 1 &&
     ['vehicle_interest', 'vehicle_of_interest'].indexOf(vehicleKeys[0]) !== -1,
     vehicleKeys.join(','));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
