'use strict';

const C = require('../lib/constants');
const A = require('../lib/adapter');

const OCCURRED_AT = C.at(41);

module.exports = {
  id: 'G',
  slug: 'website-form-honeypot-bot',
  external_event_id: 'website_form:sub_01J9SIMULATED000000000000G',
  occurred_at: C.at(41),
  title: 'Website form - bot submission, honeypot filled, refused with a reason',
  source_key: 'website_form',

  provenance: C.EMITTED_PROVENANCE,
  provenance_in_production: 'origin_and_form_key',

  evidence_grade: C.EVIDENCE.FIRST_PARTY,

  description: [
    'Scenario F\'s form, filled by a script. The tell is the honeypot: a field rendered',
    'off-screen with no label, which no human ever sees and every naive form-filler',
    'completes. Here it came back with a company name in it, and the render-to-submit',
    'time is 380ms.',
    '',
    'The refusal happens in the ADAPTER, before nexus_record_lead_event is called. That',
    'placement is the point of the scenario. Writing bot submissions as lead events "for',
    'completeness" would mean the dealership\'s received-leads count includes traffic that',
    'was never a person, and every conversion rate computed from it is wrong in the',
    'flattering direction. The floor of the funnel has to be real.',
    '',
    'The HTTP response is still 200. A 4XX tells the submitter which field caught it, and',
    'the next attempt simply leaves that field alone. Refuse quietly.',
    '',
    'What IS kept is a counter, not a row: bot submissions are counted per form per day so',
    'that "we refused 214 bot submissions this week" stays a knowable number. Refusing is',
    'not the same as being blind.',
    '',
    'normalized is null here, and that is the honest value - the adapter never got far',
    'enough to build one.'
  ].join('\n'),

  payload_raw: {
    _simulation: {
      environment_label: C.ENVIRONMENT_LABEL,
      dealership: C.DEALERSHIP_NAME,
      shape: 'our own form contract, submitted by a simulated script'
    },
    submission_id: 'sub_01J9SIMULATED000000000000G',
    form_key: 'nexus_test_showroom_enquiry_v1',
    form_version: 1,
    submitted_at: OCCURRED_AT,
    origin: 'https://nexus-auto-test-showroom.invalid',
    // >>> The tell. No human sees this field.
    [A.HONEYPOT_FIELD]: 'Simulated Bot Submitter LLC',
    render_to_submit_ms: 380,
    fields: {
      full_name: 'Test Bot Golf',
      email: 'bot-golf@' + C.EMAIL_DOMAIN,
      phone: '+9995550107',
      vehicle_of_interest: 'ANY',
      budget_aed: '999999',
      message: 'CHEAP SEO SERVICES VISIT OUR SITE',
      preferred_language: 'en'
    }
  },

  // Never built. The adapter refused before normalization.
  normalized: null,

  expect: {
    disposition: 'REFUSED',
    in_words:
      'Refused by the adapter under rule `honeypot_field_filled`, before any call to ' +
      'nexus_record_lead_event. No lead event row, no lead, no entry in the received-leads ' +
      'count. The HTTP response is 200 so the submitter learns nothing. A per-form bot ' +
      'counter is incremented so the refusal is still countable.'
  },

  plan: [
    {
      call: 'adapter_refuse',
      rule: 'honeypot_field_filled',
      note:
        'Runs before the database is touched at all. The emitter executes the real ' +
        'checkHoneypot() from lib/adapter.js and records what it returned, so this ' +
        'refusal is demonstrated rather than asserted.',
      corroborating_signals: [
        'render_to_submit_ms = 380 (a human filling six fields does not finish in 380ms)',
        'budget_aed = 999999 (a filler value, not a figure anyone typed)',
        'vehicle_of_interest = "ANY"'
      ],
      expect: {
        disposition: 'REFUSED',
        in_words: 'Discarded at the edge with the rule named. HTTP 200 to the submitter.'
      }
    }
  ]
};
