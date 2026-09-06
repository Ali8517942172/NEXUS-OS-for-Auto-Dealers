'use strict';

const C = require('../lib/constants');

// ---------------------------------------------------------------------------
// J. An Arabic-script name, and the signature bug that only shows up in Dubai.
// ---------------------------------------------------------------------------

const OCCURRED_AT = C.at(70);

// Synthetic. Reads "demonstration test customer", not a person's name.
const CUSTOMER_NAME_AR = 'عميل اختبار تجريبي';
const MESSAGE_AR = 'السلام عليكم، هل السيارة ما زالت متوفرة؟ وما هو أفضل سعر نقدي؟';

const BODY = {
  object: 'whatsapp_business_account',
  entry: [{
    id: '000000000000002',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: {
          display_phone_number: '999555010',
          phone_number_id: '000000000000010'
        },
        contacts: [{
          profile: { name: CUSTOMER_NAME_AR },
          wa_id: '9995550110'
        }],
        messages: [{
          from: '9995550110',
          id: 'wamid.SIMULATED.J.0000000000000010',
          timestamp: String(C.unixAt(70)),
          type: 'text',
          text: { body: MESSAGE_AR }
        }]
      }
    }]
  }]
};

module.exports = {
  id: 'J',
  slug: 'arabic-name-unicode',
  external_event_id: 'whatsapp:wamid.SIMULATED.J.0000000000000010',
  occurred_at: OCCURRED_AT,
  title: 'Arabic-script customer name - the escaped-unicode signature trap',
  source_key: 'whatsapp_inbound',

  provenance: C.EMITTED_PROVENANCE,
  // What whatsapp_inbound requires TODAY, because the live channel is WAHA and
  // a copyable header is all it offers. The trap this scenario documents does
  // not bite on that path - it bites the moment the channel moves to the
  // WhatsApp Cloud API, where channel_message_events_cloud_requires_signature
  // CHECK-constrains origin_verified to hmac_sha256_x_hub. See the description.
  provenance_in_production: 'shared_secret_header',

  evidence_grade: C.EVIDENCE.PUBLISHED,

  description: [
    'READ THIS ONE EVEN IF YOU SKIP THE OTHERS.',
    '',
    'Meta computes X-Hub-Signature-256 as HMAC-SHA256 over the RAW REQUEST BYTES, and the',
    'bytes Meta sends escape every non-ASCII character as \\uXXXX. An adapter that parses',
    'the JSON and then re-serialises it - JSON.parse then JSON.stringify, which is what',
    'almost every framework hands you - produces the same characters as raw UTF-8. That is',
    'a different byte string, a different length, and a different HMAC.',
    '',
    'The consequence is the reason this scenario exists as its own file rather than a note',
    'on scenario A: THE BUG IS INVISIBLE TO AN ASCII TEST SUITE. Every fixture named',
    '"Test Buyer Alpha" passes. Every staging run passes. Then it ships to a Dubai',
    'dealership, and the leads that fail signature verification and get dropped are',
    'exactly the ones whose customers wrote their name in Arabic. Nobody sees a spike in',
    'errors, because a rejected signature is supposed to be rejected. What they see is a',
    'quiet, demographically selective hole in the funnel.',
    '',
    'The fixture derives the evidence rather than claiming it: it emits the body in both',
    'encodings, with the byte length and the HMAC of each, computed at emit time under a',
    'placeholder secret. The two digests differ. That is the whole finding.',
    '',
    'The fix is one sentence: verify the signature against the bytes you received, before',
    'parsing them. Keep the raw buffer. Never re-serialise and then verify.',
    '',
    'WHY THIS CHANNEL AND NOT THE LEADGEN WEBHOOK: the Meta Lead Ads webhook in scenarios',
    'C and D carries six ids and no text, so no Arabic ever appears in a body it signs. The',
    'hazard lands where the customer profile name and the message itself travel inside the',
    'signed body - WhatsApp - which is precisely the channel this product depends on for',
    'marketplace capture. The two facts compound.',
    '',
    'WHEN IT BITES, PRECISELY: not today. The live inbound channel is WAHA, whose',
    'provenance is a copyable shared header and which computes no HMAC over the body at',
    'all - which is why lead_source_catalogue requires shared_secret_header for',
    'whatsapp_inbound. The trap arms itself the moment the channel moves to the WhatsApp',
    'Cloud API, where channel_message_events_cloud_requires_signature CHECK-constrains',
    'origin_verified to hmac_sha256_x_hub and the signature therefore becomes load-bearing.',
    'That migration is on the roadmap, so this scenario is written now, before the cutover',
    'makes it expensive to discover. The fixture below is the Cloud API inbound shape.',
    '',
    'Two smaller traps ride along with this one, both visible in the normalized object:',
    '  - The name must be stored as it was written. Transliterating it to Latin script so',
    '    that it "looks tidy in the CRM" is data loss, and the customer is then addressed',
    '    by a name they did not give.',
    '  - locale is ar_AE and the reply template chosen downstream must match it. A',
    '    right-to-left name spliced into a left-to-right English template renders as',
    '    mangled text on the customer\'s handset.'
  ].join('\n'),

  payload_raw: BODY,

  normalized: {
    // Stored verbatim, in the script the customer used.
    full_name: CUSTOMER_NAME_AR,
    phone_e164: '+9995550110',
    message: MESSAGE_AR,
    locale: 'ar_AE',
    attribution: {
      source_key: 'whatsapp_inbound',
      channel: 'whatsapp_inbound',
      attribution_confidence: 'provider_signed',
      script: 'Arab',
      text_direction: 'rtl',
      simulated: true
    }
  },

  // Tells the emitter to compute the two encodings and their HMACs from
  // payload_raw at emit time. See lib/unicode.js.
  derive_signature_evidence: true,

  expect: {
    disposition: 'PROMOTED',
    in_words:
      'Promoted - provided the adapter verified the signature against the raw received ' +
      'bytes. The fixture carries both encodings of the identical object with their byte ' +
      'lengths and HMACs; the digests do not match, so an adapter that re-serialises before ' +
      'verifying would reject this delivery as forged and drop a real customer. The name is ' +
      'stored in Arabic script exactly as sent, never transliterated, and locale is ar_AE.'
  }
};
