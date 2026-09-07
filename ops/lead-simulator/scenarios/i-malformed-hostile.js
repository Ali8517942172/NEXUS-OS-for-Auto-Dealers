'use strict';

const C = require('../lib/constants');

// ---------------------------------------------------------------------------
// I. Three defects in one delivery. Each must be refused BY NAME.
// ---------------------------------------------------------------------------

// The phone defect, and a note about the digits.
//
// The real-world shape of this defect is a UAE mobile typed the way people
// actually write it - "05X XXX XXXX" - with no country code, which is not E.164
// and must be refused. This file reproduces the DEFECT without reproducing a
// DIALABLE NUMBER: every 05x-prefixed UAE mobile of that shape is either
// assigned to somebody today or assignable tomorrow, and lib/validate.js
// refuses to emit one. The digits below are the reserved ITU +999555 range
// written in local form, so the string is malformed in exactly the same way -
// no leading plus, national trunk zero present - and can never ring anything.
const LOCAL_FORMAT_PHONE = '0999555010';

module.exports = {
  id: 'I',
  slug: 'malformed-hostile',
  external_event_id: 'nokey:1788700000000',
  occurred_at: C.at(60),
  title: 'Malformed / hostile delivery - three defects, three named refusals',
  source_key: 'website_form',

  provenance: C.EMITTED_PROVENANCE,
  // The endpoint is still our own form endpoint, so its provenance is
  // origin_and_form_key exactly as in F and G. Nothing about this delivery
  // downgrades the endpoint: the origin was fine, the CONTENT was not. Those
  // are separate axes, and conflating them is how "unverified" ends up
  // meaning "we did not like the payload".
  provenance_in_production: 'origin_and_form_key',

  evidence_grade: C.EVIDENCE.FIRST_PARTY,

  description: [
    'One delivery carrying three separate defects. The scenario passes only if each is',
    'refused by NAME - a generic "400 Bad Request" is a failure of this test even though',
    'the lead is correctly kept out, because a refusal nobody can read is a refusal',
    'nobody can fix.',
    '',
    'DEFECT 1 - phone is not E.164.',
    '  The contract is ^\\+[1-9][0-9]{7,14}$. A local-format number has no country code,',
    '  and the trunk zero is not part of the international number. The tempting fix is to',
    '  prepend +971 and strip the zero, and it is wrong: the same 05x string is a valid',
    '  local mobile in several countries, so the guess silently manufactures a wrong',
    '  number that then gets messaged. Refuse and ask, or store the raw string as an',
    '  unverified contact hint - never guess a country code.',
    '',
    'DEFECT 2 - full_name is empty.',
    '  Whitespace is not a name. Neither is "-", "N/A" or "test". The refusal must fire',
    '  after trimming, or every future form with a space in it walks straight through.',
    '  Promotion requires a name because a lead with no name cannot be worked: the sales',
    '  desk sees a row it cannot address and the dealership counts a lead it does not have.',
    '',
    'DEFECT 3 - external_event_id is `nokey:<epoch_millis>`.',
    '  This is what an adapter emits when the provider gave it nothing stable to key on',
    '  and somebody reached for Date.now(). It is the single most damaging of the three,',
    '  and the quietest: it never errors. It just means every retry of the same delivery',
    '  carries a different id, so idempotency cannot hold and scenario H turns into two,',
    '  three, five leads for one customer - each one alerting a salesperson. Refuse the',
    '  id shape at the door.',
    '',
    'All three checks run BEFORE anything is written. The emitter executes the real',
    'validators from lib/validate.js and records what they actually returned, so the',
    'refusal messages in the fixture are produced, not transcribed.'
  ].join('\n'),

  payload_raw: {
    _simulation: {
      environment_label: C.ENVIRONMENT_LABEL,
      dealership: C.DEALERSHIP_NAME,
      shape: 'our own form contract, submitted with three defects',
      phone_digits_note:
        'The malformed phone below uses the reserved +999555 range in local form. See the ' +
        'comment at the top of this file for why it is not a UAE 05x number.'
    },
    // >>> DEFECT 3: a locally minted id, not the provider's.
    external_event_id: 'nokey:1788700000000',
    form_key: 'nexus_test_showroom_enquiry_v1',
    submitted_at: C.at(60),
    origin: 'https://nexus-auto-test-showroom.invalid',
    fields: {
      // >>> DEFECT 2: whitespace only.
      full_name: '   ',
      // >>> DEFECT 1: local format, no country code.
      phone: LOCAL_FORMAT_PHONE,
      email: '',
      vehicle_of_interest: '2020 Nissan Patrol',
      message: 'call me'
    }
  },

  // What the adapter attempted to build. It is invalid, which is the point;
  // the emitter runs validateNormalized() against it and captures the result.
  normalized: {
    full_name: '   ',
    phone_e164: LOCAL_FORMAT_PHONE,
    vehicle_interest: '2020 Nissan Patrol',
    message: 'call me',
    locale: 'en_AE',
    attribution: {
      source_key: 'website_form',
      form_key: 'nexus_test_showroom_enquiry_v1',
      attribution_confidence: 'first_party',
      simulated: true
    }
  },

  expect: {
    disposition: 'REFUSED',
    in_words:
      'Refused three times over, each with a named rule: ' +
      'external_event_id_must_be_provider_minted (the nokey: id), ' +
      'full_name_required (whitespace is not a name, checked after trimming), and ' +
      'phone_e164_malformed (no country code, trunk zero present, fails ' +
      '^\\+[1-9][0-9]{7,14}$). Because the only contact channel offered was that ' +
      'malformed phone and email was empty, contact_channel_required does not fire - the ' +
      'phone rule does, and fixing the phone is what would make the delivery admissible. ' +
      'Nothing is written. The operator sees three sentences, not one 400.'
  },

  plan: [
    {
      call: 'adapter_refuse',
      rule: 'multiple',
      note:
        'The emitter runs validateExternalEventId() and validateNormalized() for real and ' +
        'stores their output under `refusals`. If either ever stops refusing, this scenario ' +
        'fails loudly at emit time rather than passing quietly.',
      validate: {
        external_event_id: 'nokey:1788700000000',
        normalized: 'scenario.normalized'
      },
      expect: {
        disposition: 'REFUSED',
        in_words: 'Three named refusals, no database call.'
      }
    }
  ]
};
