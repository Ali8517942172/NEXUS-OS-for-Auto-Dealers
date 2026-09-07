/**
 * The test that has to exist before the Cloud receiver is written.
 *
 * It does not merely check that the verifier works. It demonstrates the
 * failure mode: an ASCII-only suite passes with BOTH implementations, so an
 * ASCII-only suite proves nothing at all.
 */
import crypto from 'node:crypto';
import { verifyRaw, verifyReserialised } from './verify-signature.mjs';

const SECRET = 'test-app-secret-not-a-real-one';
const sign = buf => 'sha256=' + crypto.createHmac('sha256', SECRET).update(buf).digest('hex');

/* Meta escapes non-ASCII in the bytes it actually transmits. Node's
   JSON.stringify does not — it emits literal UTF-8. That one difference is the
   entire bug, so the fixture has to reproduce Meta's form rather than Node's. */
const escapeNonAscii = s =>
  s.replace(/[-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

const leadBody = name => JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{
    id: '311007628770691',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '971526647253', phone_number_id: '000000000000000' },
        contacts: [{ profile: { name }, wa_id: '918517942172' }],
        messages: [{
          from: '918517942172', id: 'wamid.TEST', timestamp: '1788700000',
          text: { body: 'Is the Fortuner still available?' }, type: 'text',
        }],
      },
    }],
  }],
});

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : '** FAIL **'}  ${label}`);
};

console.log('\nASCII customer name — "Ahmed"');
{
  const wire = Buffer.from(escapeNonAscii(leadBody('Ahmed')), 'utf8');
  const hdr = sign(wire);
  check('raw-bytes verifier accepts a genuine delivery',
        verifyRaw(wire, hdr, SECRET), true);
  check('re-serialising verifier ALSO accepts  <- this is why the bug survives review',
        verifyReserialised(JSON.parse(wire.toString()), hdr, SECRET), true);
}

console.log('\nArabic customer name — "محمد", an ordinary Dubai buyer');
{
  const wire = Buffer.from(escapeNonAscii(leadBody('محمد')), 'utf8');
  const hdr = sign(wire);
  check('raw-bytes verifier accepts a genuine delivery',
        verifyRaw(wire, hdr, SECRET), true);
  check('re-serialising verifier REJECTS that same genuine delivery',
        verifyReserialised(JSON.parse(wire.toString()), hdr, SECRET), false);
}

console.log('\nForgery, tampering and malformed input');
{
  const wire = Buffer.from(escapeNonAscii(leadBody('محمد')), 'utf8');
  const good = sign(wire);
  check('wrong app secret rejected',
        verifyRaw(wire, good, 'a-different-secret'), false);
  check('body tampered after signing rejected',
        verifyRaw(Buffer.concat([wire, Buffer.from(' ')]), good, SECRET), false);
  check('missing header rejected',        verifyRaw(wire, undefined, SECRET), false);
  check('empty header rejected',          verifyRaw(wire, '', SECRET), false);
  check('sha1= prefix rejected',          verifyRaw(wire, 'sha1=' + 'a'.repeat(40), SECRET), false);
  check('truncated digest rejected',      verifyRaw(wire, good.slice(0, 40), SECRET), false);
  check('uppercase hex rejected (Meta sends lowercase)',
        verifyRaw(wire, good.toUpperCase().replace('SHA256=', 'sha256='), SECRET), false);

  let threw = false;
  try { verifyRaw(JSON.parse(wire.toString()), good, SECRET); } catch { threw = true; }
  check('a parsed object throws rather than silently mis-verifying', threw, true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
