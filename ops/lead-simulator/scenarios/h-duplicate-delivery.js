'use strict';

const C = require('../lib/constants');

// ---------------------------------------------------------------------------
// H. The same delivery, twice. Success both times.
// ---------------------------------------------------------------------------

const LEAD_ID = 'SIM-GOOGLE-LEAD-0000000008';
const EXTERNAL_ID = 'google_ads_lead:' + LEAD_ID;

const DELIVERY = {
  _simulation: {
    environment_label: C.ENVIRONMENT_LABEL,
    dealership: C.DEALERSHIP_NAME,
    shape: 'Google Ads lead form webhook (published by Google)'
  },
  lead_id: LEAD_ID,
  api_version: '1.0',
  form_id: 700000000000008,
  campaign_id: 800000000000008,
  gcl_id: 'SIMULATED-GCLID-H',
  is_test: true,
  google_key: 'PLACEHOLDER-NOT-A-REAL-SECRET',
  user_column_data: [
    { column_id: 'FULL_NAME', column_name: 'Full Name', string_value: 'Test Buyer Hotel' },
    { column_id: 'EMAIL', column_name: 'Email', string_value: 'buyer-hotel@' + C.EMAIL_DOMAIN },
    { column_id: 'PHONE_NUMBER', column_name: 'Phone Number', string_value: '+9995550108' }
  ]
};

module.exports = {
  id: 'H',
  slug: 'duplicate-delivery',
  title: 'Duplicate delivery - same external id twice, answered "already known", not an error',
  source_key: 'google_ads_lead_form',

  provenance: C.EMITTED_PROVENANCE,
  provenance_in_production: 'shared_secret_in_body',

  evidence_grade: C.EVIDENCE.PUBLISHED,

  description: [
    'Every webhook provider retries. Meta documents that duplicate notifications happen.',
    'Google retries on anything that is not a 2XX. Networks redeliver on their own.',
    'Duplicate delivery is not an anomaly to be handled one day - it is the normal',
    'operating condition.',
    '',
    'The failure mode this scenario exists to prevent is the one that LOOKS like',
    'correctness. An adapter that treats a repeat as a conflict and answers 409, or that',
    'throws on the unique-index violation and answers 500, is punished specifically by',
    'Google: a lead form delivery that receives a non-2XX response is retried a limited',
    'number of times and then PERMANENTLY DISCARDED. Google does not keep it. There is no',
    'console to re-download it from. Answering "this is a duplicate" with an error code is',
    'how a dealership loses leads it was actually sent - and the logs will show a tidy',
    'sequence of 409s that reads like the system working.',
    '',
    'So: the second delivery of a known external id is a SUCCESS. HTTP 200. The response',
    'says already_known, the existing event_id comes back, nothing is written, no second',
    'lead appears, and no notification fires at the sales desk for a customer who only',
    'enquired once.',
    '',
    'This is also why scenario I refuses `nokey:<epoch_millis>` external ids. Idempotency',
    'is only as good as the key, and a key minted from the local clock is different on',
    'every retry - which converts this scenario from "already known" into two leads.'
  ].join('\n'),

  payload_raw: DELIVERY,

  normalized: {
    full_name: 'Test Buyer Hotel',
    email: 'buyer-hotel@' + C.EMAIL_DOMAIN,
    phone_e164: '+9995550108',
    locale: 'en_AE',
    attribution: {
      source_key: 'google_ads_lead_form',
      form_id: 700000000000008,
      campaign_id: 800000000000008,
      gcl_id: 'SIMULATED-GCLID-H',
      is_test_lead: true,
      attribution_confidence: 'provider_supplied',
      simulated: true
    }
  },

  expect: {
    disposition: 'ALREADY_KNOWN',
    in_words:
      'First delivery: recorded and promoted, one lead. Second delivery of the identical ' +
      'external id: HTTP 200 with already_known = true and the SAME event_id, no new row, ' +
      'no second lead, no second alert. Exactly one lead exists at the end. Anything that ' +
      'answers 4XX or 5XX here causes Google to permanently discard the lead.'
  },

  plan: [
    {
      call: 'record',
      external_event_id: EXTERNAL_ID,
      occurred_at: C.at(50),
      note: 'First delivery.',
      expect: {
        disposition: 'PROMOTED',
        in_words: 'New event, normalized in the same hop.'
      }
    },
    {
      call: 'promote',
      note: 'One lead now exists.'
    },
    {
      call: 'record',
      external_event_id: EXTERNAL_ID,
      occurred_at: C.at(52),
      note:
        'Second delivery, two minutes later. Byte-identical body, same external id. Note ' +
        'that occurred_at differs - the provider re-sent it later - and that this must NOT ' +
        'be read as a new event. The external id is the identity; the timestamp is not.',
      expect: {
        disposition: 'ALREADY_KNOWN',
        in_words:
          'nexus_record_lead_event returns the existing event_id with already_known = true. ' +
          'No insert. The HTTP layer answers 200. Promotion is not re-run and no second ' +
          'alert is raised.'
      }
    }
  ]
};
