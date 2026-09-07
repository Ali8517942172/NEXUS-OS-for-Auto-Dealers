/* Proves the pure-JS HMAC-SHA256 the n8n receiver has to use.
 *
 * It is not enough to check a couple of published vectors: the reason this file
 * exists is that the obvious implementation looks right and is wrong on exactly
 * the inputs an English-speaking test suite never tries. So it also differential-
 * tests 300 random key/body pairs against node:crypto, and hashes the two wire
 * forms of the same Arabic customer name.
 */
const { sha256, hmacSha256, hex, utf8 } = require('./hmac-pure.js');
const crypto = require('crypto');

let pass = 0, fail = 0;
const ck = (label, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : '** FAIL **') + '  ' + label +
    (ok ? '' : '\n   got  ' + got + '\n   want ' + want));
};

ck('SHA-256 of the empty message',
   hex(sha256(new Uint8Array(0))),
   crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex'));
ck('SHA-256 of "abc"',
   hex(sha256(utf8('abc'))),
   crypto.createHash('sha256').update('abc').digest('hex'));

ck('RFC 4231 case 1',
   hex(hmacSha256(new Uint8Array(20).fill(0x0b), utf8('Hi There'))),
   'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
ck('RFC 4231 case 2 (the vector the live self-test uses)',
   hex(hmacSha256(utf8('key'), utf8('The quick brown fox jumps over the lazy dog'))),
   'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
ck('RFC 4231 case 3 (50 bytes of 0xdd)',
   hex(hmacSha256(new Uint8Array(20).fill(0xaa), new Uint8Array(50).fill(0xdd))),
   '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe');
ck('RFC 4231 case 6 (131-byte key, longer than the block, must be hashed first)',
   hex(hmacSha256(new Uint8Array(131).fill(0xaa),
                  utf8('Test Using Larger Than Block-Size Key - Hash Key First'))),
   '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');

let mismatch = null;
for (let t = 0; t < 300 && !mismatch; t++) {
  const k = crypto.randomBytes(1 + Math.floor(Math.random() * 200));
  const m = crypto.randomBytes(Math.floor(Math.random() * 900));
  const mine = hex(hmacSha256(new Uint8Array(k), new Uint8Array(m)));
  const ref = crypto.createHmac('sha256', k).update(m).digest('hex');
  if (mine !== ref) mismatch = 'key ' + k.length + 'B, body ' + m.length + 'B';
}
ck('300 random key/body pairs match node:crypto byte for byte',
   mismatch || 'all match', 'all match');

/* The trap the whole receiver is built around, on the real payload shape. */
const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{
    id: '1098665496068509',
    changes: [{
      field: 'messages',
      value: {
        metadata: { display_phone_number: '15556724466', phone_number_id: '1306545252542419' },
        contacts: [{ profile: { name: 'محمد' }, wa_id: '918517942172' }],
        messages: [{
          from: '918517942172', id: 'wamid.TEST', timestamp: '1788700000',
          type: 'text', text: { body: 'Is the Fortuner still available?' },
        }],
      },
    }],
  }],
});
const escaped = body.replace(/[-￿]/g,
  c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

for (const [label, wire] of [
  ['a literal UTF-8 body, Arabic customer name', body],
  ['Meta\'s escaped-unicode wire form of the same body', escaped],
]) {
  const buf = Buffer.from(wire, 'utf8');
  ck(label,
     hex(hmacSha256(utf8('app-secret'), new Uint8Array(buf))),
     crypto.createHmac('sha256', 'app-secret').update(buf).digest('hex'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
