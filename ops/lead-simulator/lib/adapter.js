'use strict';

const V = require('./validate');

// ---------------------------------------------------------------------------
// The bits of the ingest adapter the simulator has to reproduce faithfully,
// because a scenario that skipped them would prove nothing.
// ---------------------------------------------------------------------------

// Deep clone that keeps ordering and does not need a dependency.
function clone(x) {
  return x === undefined ? undefined : JSON.parse(JSON.stringify(x));
}

/**
 * Remove every shared secret from a payload before it is handed to
 * nexus_record_lead_event.
 *
 * This is not defensive tidying. public.lead_event carries
 *   CHECK (lead_event_payload_carries_no_shared_secret)
 * and the write is REFUSED if `google_key` survives into payload_raw. Google
 * Ads includes google_key in the body of every lead delivery, so an adapter
 * that forwards the body verbatim cannot write a single Google lead.
 *
 * Returns { payload, stripped: [{ path, key }] }. The stripped list is carried
 * into the fixture so the reviewer can see WHAT was removed, without the value
 * ever being written down.
 */
function stripSharedSecrets(payloadRaw) {
  const out = clone(payloadRaw);
  const stripped = [];

  V.walk(out, function (node, path) {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      Object.keys(node).forEach(function (k) {
        if (V.SHARED_SECRET_KEYS.indexOf(String(k).toLowerCase()) !== -1) {
          stripped.push({
            path: path + '.' + k,
            key: k,
            // Deliberately not the value. A redaction that prints the secret is
            // not a redaction.
            replaced_with: '[stripped-by-adapter]'
          });
          delete node[k];
        }
      });
    }
  });

  return { payload: out, stripped: stripped };
}

/**
 * Honeypot check for the website form.
 *
 * The form renders a field that is positioned off-screen and has no label, so
 * no human ever fills it. A scripted submitter fills every input it finds.
 * A non-empty honeypot is therefore a bot, and the only correct response is to
 * refuse the submission -- but to answer the HTTP request 200, so the bot
 * learns nothing about which of its fields betrayed it.
 */
const HONEYPOT_FIELD = 'website_hp_company_registration';

function checkHoneypot(payloadRaw) {
  const value = payloadRaw && payloadRaw[HONEYPOT_FIELD];
  if (typeof value === 'string' && value.trim() !== '') {
    return {
      refused: true,
      rule: 'honeypot_field_filled',
      detail: 'the hidden field `' + HONEYPOT_FIELD + '` was submitted with a value ' +
        '(' + JSON.stringify(value) + '). No human sees that field. The submission is ' +
        'discarded before any lead event is recorded, and the HTTP response is still 200 ' +
        'so the submitter cannot learn which field detected it.'
    };
  }
  return { refused: false };
}

module.exports = {
  clone,
  stripSharedSecrets,
  checkHoneypot,
  HONEYPOT_FIELD
};
