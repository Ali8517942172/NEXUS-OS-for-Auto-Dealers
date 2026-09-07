'use strict';

const C = require('../lib/constants');
const A = require('../lib/adapter');

const OCCURRED_AT = C.at(40);
const SUBMISSION_ID = 'sub_01J9SIMULATED000000000000F';

module.exports = {
  id: 'F',
  slug: 'website-form-clean',
  occurred_at: OCCURRED_AT,
  title: 'Website form - clean submission with a client-minted submission_id',
  source_key: 'website_form',

  provenance: C.EMITTED_PROVENANCE,
  // Our own form, on our own origin, carrying the per-form key we issued.
  provenance_in_production: 'origin_and_form_key',

  evidence_grade: C.EVIDENCE.FIRST_PARTY,

  description: [
    'The one source whose contract we own end to end. Everything else in this directory',
    'is us adapting to somebody else\'s shape; here we choose it, so it is worth choosing',
    'well.',
    '',
    'The choice that matters is `submission_id`: a UUID/ULID minted BY THE BROWSER when',
    'the form is first rendered, and sent with the submission. It is the external event',
    'id, and it is the reason a double-click, a flaky connection retry or an impatient',
    'refresh produces one lead instead of three. The server cannot mint it - by the time',
    'the server sees the second request it has no way to know it is the same intent.',
    '',
    'The honeypot field is present and empty, which is what a human produces. Scenario G',
    'is the same form with that field filled.',
    '',
    'Provenance here is origin_and_form_key: the request came from our origin and carried',
    'the per-form key we issued. That is real but modest evidence - it proves the form',
    'was ours, not that the human was. Nothing about a website form can prove the latter,',
    'and the normalized object should not imply otherwise.'
  ].join('\n'),

  payload_raw: {
    _simulation: {
      environment_label: C.ENVIRONMENT_LABEL,
      dealership: C.DEALERSHIP_NAME,
      shape: 'our own form contract - we own and publish this one'
    },
    submission_id: SUBMISSION_ID,
    form_key: 'nexus_test_showroom_enquiry_v1',
    form_version: 1,
    submitted_at: OCCURRED_AT,
    origin: 'https://nexus-auto-test-showroom.invalid',
    // Empty, as a human leaves it.
    [A.HONEYPOT_FIELD]: '',
    // Time from first render to submit. A human takes seconds; a script takes
    // milliseconds. Recorded, not enforced - it is a signal, not a gate.
    render_to_submit_ms: 47210,
    fields: {
      full_name: 'Test Buyer Foxtrot',
      email: 'buyer-foxtrot@' + C.EMAIL_DOMAIN,
      phone: '+9995550106',
      vehicle_of_interest: '2022 Nissan Patrol SE',
      budget_aed: '160000',
      message: 'Can I trade in my current car against this one?',
      preferred_language: 'en'
    },
    utm: {
      utm_source: 'simulation',
      utm_medium: 'demonstration',
      utm_campaign: 'nexus_lead_simulator'
    }
  },

  normalized: {
    full_name: 'Test Buyer Foxtrot',
    email: 'buyer-foxtrot@' + C.EMAIL_DOMAIN,
    phone_e164: '+9995550106',
    vehicle_interest: '2022 Nissan Patrol SE',
    budget_aed: 160000,
    message: 'Can I trade in my current car against this one?',
    locale: 'en_AE',
    attribution: {
      source_key: 'website_form',
      form_key: 'nexus_test_showroom_enquiry_v1',
      form_version: 1,
      submission_id: SUBMISSION_ID,
      utm_source: 'simulation',
      utm_medium: 'demonstration',
      utm_campaign: 'nexus_lead_simulator',
      attribution_confidence: 'first_party',
      simulated: true
    }
  },

  expect: {
    disposition: 'PROMOTED',
    in_words:
      'Recorded against the client-minted submission_id, normalized and promoted in one ' +
      'pass. Both a name and two contact channels are present, so nothing is missing at ' +
      'promotion. Resubmitting the same submission_id returns already-known - see scenario H.'
  },

  plan: [
    {
      call: 'record',
      external_event_id: 'website_form:' + SUBMISSION_ID,
      note:
        'The external id is the browser-minted submission_id, prefixed with the source so ' +
        'ids from different providers cannot collide in one namespace.'
    },
    { call: 'promote' }
  ]
};
