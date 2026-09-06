'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Why this file exists
// ---------------------------------------------------------------------------
// Meta signs the RAW REQUEST BYTES with HMAC-SHA256 and sends the digest as
// X-Hub-Signature-256. The bytes Meta sends escape every non-ASCII character as
// \uXXXX. An adapter that parses the JSON and re-serialises it with
// JSON.stringify() emits the same characters as raw UTF-8 -- a DIFFERENT byte
// string, with a different length and a different HMAC.
//
// The consequence is specific and nasty: an ASCII-only test suite passes,
// production passes for "Test Buyer Alpha", and every lead whose name is
// written in Arabic fails signature verification and is dropped. In Dubai that
// is not an edge case; it is a large share of the inbound.
//
// scenarios/j-arabic-name-unicode.js exists to put a number on that, and this
// module derives the number rather than asserting it.

// A stand-in for the app secret. It is a literal in a repository and is
// therefore not a credential -- it exists only so the two digests below are
// computed the same way twice.
const SIMULATED_APP_SECRET = 'SIMULATED_APP_SECRET_NOT_A_REAL_CREDENTIAL';

/** Rewrite every non-ASCII code unit as a \uXXXX escape, the way Meta does. */
function escapeNonAscii(s) {
  return s.replace(/[^\x00-\x7F]/g, function (ch) {
    return '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
  });
}

function hmac(body) {
  return 'sha256=' + crypto.createHmac('sha256', SIMULATED_APP_SECRET).update(body, 'utf8').digest('hex');
}

/**
 * Produce the on-the-wire form and the naive re-serialised form of the same
 * object, with the byte length and HMAC of each, so the divergence is visible
 * rather than claimed.
 */
function signatureEvidence(obj) {
  const naive = JSON.stringify(obj);            // raw UTF-8, what an adapter re-emits
  const asSent = escapeNonAscii(naive);         // \uXXXX escapes, what Meta actually sends

  const naiveBytes = Buffer.byteLength(naive, 'utf8');
  const asSentBytes = Buffer.byteLength(asSent, 'utf8');

  return {
    body_as_meta_sends_it: {
      encoding: 'JSON with non-ASCII escaped as \\uXXXX',
      byte_length: asSentBytes,
      x_hub_signature_256: hmac(asSent)
    },
    body_after_naive_reserialisation: {
      encoding: 'JSON.stringify() output, non-ASCII as raw UTF-8',
      byte_length: naiveBytes,
      x_hub_signature_256: hmac(naive)
    },
    digests_match: hmac(asSent) === hmac(naive),
    byte_length_delta: asSentBytes - naiveBytes,
    reading:
      'Same object, same secret, two different signatures. Verify against the bytes you ' +
      'received, before parsing. Never re-serialise and then verify.'
  };
}

module.exports = {
  SIMULATED_APP_SECRET,
  escapeNonAscii,
  hmac,
  signatureEvidence
};
