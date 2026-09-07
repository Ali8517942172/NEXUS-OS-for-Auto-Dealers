'use strict';

const C = require('../lib/constants');

// ---------------------------------------------------------------------------
// E. Google Ads lead form. One hop, full payload - and a shared secret in it.
// ---------------------------------------------------------------------------

const OCCURRED_AT = C.at(30);
const LEAD_ID = 'SIM-GOOGLE-LEAD-0000000003';

module.exports = {
  id: 'E',
  slug: 'google-ads-lead-form',
  external_event_id: 'google_ads_lead:' + LEAD_ID,
  occurred_at: OCCURRED_AT,
  title: 'Google Ads lead form - complete in one hop, and the payload carries `google_key`',
  source_key: 'google_ads_lead_form',

  provenance: C.EMITTED_PROVENANCE,
  // Google authenticates by echoing a secret IN THE BODY, which is why the
  // vocabulary has a name for exactly that.
  provenance_in_production: 'shared_secret_in_body',

  evidence_grade: C.EVIDENCE.PUBLISHED,

  description: [
    'The opposite of Meta: Google Ads posts the complete lead in a single delivery, so',
    'there is no second hop and no retention window to lose a lead to.',
    '',
    'The catch is how Google authenticates. There is no signature header. Instead the',
    'body contains `google_key` - the shared secret you configured on the form - and you',
    'authenticate the delivery by comparing it to your stored value. The credential and',
    'the data arrive in the same object.',
    '',
    'That collides head-on with the database:',
    '',
    '    CHECK (lead_event_payload_carries_no_shared_secret)',
    '',
    'which refuses any payload_raw containing google_key. An adapter that forwards the',
    'body verbatim - the obvious implementation, and the one every tutorial shows -',
    'cannot write a single Google lead. It fails at the last step, after the HTTP 200 has',
    'already been sent, so from Google\'s side everything looks fine while nothing is',
    'stored.',
    '',
    'So the order of operations is load-bearing:',
    '   1. compare google_key against the stored secret, constant-time',
    '   2. STRIP google_key from the body',
    '   3. write the stripped body',
    'Authenticate with it, then destroy it. This scenario emits both forms - as delivered',
    'and as written - so the strip is demonstrated rather than asserted. Diff them.',
    '',
    'A note on the CHECK itself: it is not paranoia about one field name. A secret that',
    'reaches payload_raw is a secret in every backup, every replica, every CSV export and',
    'every support ticket that quotes a row, and rotating it means rotating it with the',
    'customer, not just with Google.'
  ].join('\n'),

  // AS DELIVERED. Contains google_key. This object is what arrives on the wire;
  // it is NOT what is written. The emitter runs the adapter's strip step and
  // the fixture carries both forms plus the list of what was removed.
  payload_raw: {
    _simulation: {
      environment_label: C.ENVIRONMENT_LABEL,
      dealership: C.DEALERSHIP_NAME,
      shape: 'Google Ads lead form webhook (published by Google)',
      the_point_of_this_fixture:
        'This object deliberately contains google_key so that the adapter can be seen ' +
        'removing it. The value below is a literal placeholder, not a credential.'
    },
    lead_id: LEAD_ID,
    api_version: '1.0',
    form_id: 700000000000001,
    campaign_id: 800000000000001,
    adgroup_id: 810000000000001,
    creative_id: 820000000000001,
    gcl_id: 'SIMULATED-GCLID-E',
    is_test: true,
    // >>> The shared secret. Present in every real delivery. Must not survive
    // >>> into the write. See lib/adapter.js stripSharedSecrets().
    google_key: 'PLACEHOLDER-NOT-A-REAL-SECRET',
    user_column_data: [
      { column_id: 'FULL_NAME', column_name: 'Full Name', string_value: 'Test Buyer Echo' },
      { column_id: 'EMAIL', column_name: 'Email', string_value: 'buyer-echo@' + C.EMAIL_DOMAIN },
      { column_id: 'PHONE_NUMBER', column_name: 'Phone Number', string_value: '+9995550105' },
      { column_id: 'POSTAL_CODE', column_name: 'Postal Code', string_value: '00000' },
      {
        column_id: 'VEHICLE_MODEL', column_name: 'Which model?',
        string_value: '2024 Toyota Land Cruiser'
      },
      {
        column_id: 'BUDGET', column_name: 'Budget (AED)',
        string_value: '240000'
      }
    ]
  },

  normalized: {
    full_name: 'Test Buyer Echo',
    email: 'buyer-echo@' + C.EMAIL_DOMAIN,
    phone_e164: '+9995550105',
    vehicle_interest: '2024 Toyota Land Cruiser',
    // Google hands every answer back as a STRING, including numbers. The
    // normalized contract says budget_aed is a number, so the cast happens
    // here and a non-numeric answer must fail rather than become NaN or 0.
    budget_aed: 240000,
    locale: 'en_AE',
    attribution: {
      source_key: 'google_ads_lead_form',
      form_id: 700000000000001,
      campaign_id: 800000000000001,
      adgroup_id: 810000000000001,
      creative_id: 820000000000001,
      gcl_id: 'SIMULATED-GCLID-E',
      is_test_lead: true,
      attribution_confidence: 'provider_supplied',
      simulated: true
    }
  },

  expect: {
    disposition: 'PROMOTED',
    in_words:
      'One hop. The adapter authenticates against google_key, strips it, and writes the ' +
      'stripped body; the event is normalized and promoted in the same pass. The fixture ' +
      'proves the strip: `payload_as_delivered` contains google_key, `payload_as_written` ' +
      'does not, and `adapter.stripped` names the field that was removed. Had the strip not ' +
      'run, the write would have been refused by the CHECK constraint ' +
      'lead_event_payload_carries_no_shared_secret - after the HTTP 200 was already sent.'
  }
};
