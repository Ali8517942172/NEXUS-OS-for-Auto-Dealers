/**
 * Meta X-Hub-Signature-256 verification for the WhatsApp Cloud API receiver.
 *
 * The whole point of this file is one trap, and it is the reason the Cloud
 * receiver has not been written yet:
 *
 *   Meta computes the HMAC over the EXACT BYTES it sent. If your framework
 *   parses the JSON and you re-serialise it in order to hash it, you get
 *   different bytes — and for pure ASCII you very often get the SAME bytes by
 *   luck. So the bug passes every test written by an English speaker and then
 *   fails on the first customer called محمد.
 *
 * In Dubai that is not an edge case. It is Tuesday.
 *
 * Meta's own documentation states it: "we generate the signature using an
 * escaped unicode version of the payload, with lowercase hex digits. If you
 * just calculate against the decoded bytes, you will end up with a different
 * signature."
 *
 * The practical rule for whatever runs this: capture the raw request body as
 * a Buffer BEFORE any JSON middleware touches it, and hash that. In Express
 * that means `express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })`.
 * In a Vercel function, read the stream yourself. In n8n, the webhook node must
 * be configured for raw/binary body — a parsed JSON body has already lost the
 * bytes Meta signed and no amount of care downstream gets them back.
 */
import crypto from 'node:crypto';

/** The only correct form: hash the raw request body, untouched. */
export function verifyRaw(rawBodyBuffer, headerValue, appSecret) {
  if (!Buffer.isBuffer(rawBodyBuffer)) {
    throw new TypeError(
      'verifyRaw needs the raw body as a Buffer. If you are holding a parsed ' +
      'object here, the bytes Meta signed are already gone — capture the body ' +
      'before any JSON parsing.');
  }
  if (typeof headerValue !== 'string' || !headerValue.startsWith('sha256=')) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBodyBuffer)
    .digest('hex');

  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  /* Length first: timingSafeEqual throws on a length mismatch, and that throw
     is itself a timing oracle. */
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * The wrong form. Exported ONLY so the test can demonstrate that it is wrong,
 * and that it looks right under ASCII. Never call this in a receiver.
 */
export function verifyReserialised(parsedBody, headerValue, appSecret) {
  const bytes = Buffer.from(JSON.stringify(parsedBody), 'utf8');
  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(bytes)
    .digest('hex');
  return headerValue === expected;
}
