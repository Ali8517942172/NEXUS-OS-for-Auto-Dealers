'use strict';

const C = require('../lib/constants');

// ---------------------------------------------------------------------------
// A. Marketplace enquiry that arrives as a WhatsApp message. The clean case.
// ---------------------------------------------------------------------------

const OCCURRED_AT = C.at(0);

module.exports = {
  id: 'A',
  slug: 'dubizzle-whatsapp-clean',
  external_event_id: 'whatsapp:wamid.SIMULATED.A.0000000000000001',
  occurred_at: OCCURRED_AT,
  title: 'Marketplace (Dubizzle) enquiry arriving over WhatsApp - clean',
  source_key: 'marketplace_dubizzle',

  // What THIS emitter declares. Always 'simulated'; see README.
  provenance: C.EMITTED_PROVENANCE,
  // lead_source_catalogue REQUIRES 'simulated' for marketplace_dubizzle, and
  // that is not a gap in this file. There is no public route, so nothing
  // external can attest anything, and lead_ingest_endpoint_production_needs_real_provenance
  // makes a production endpoint for this source a row that cannot exist.
  provenance_in_production: 'simulated',

  // How the same enquiry is actually captured in production today. It arrives
  // on the WhatsApp channel NEXUS already runs - source_key whatsapp_inbound,
  // provenance shared_secret_header, deduped on wa_message_id - and is
  // ATTRIBUTED to marketplace_dubizzle. The marketplace source key exists to
  // be attributed and simulated, not to be integrated.
  capture_in_production: {
    source_key: 'whatsapp_inbound',
    provenance: 'shared_secret_header',
    dedup_field: 'wa_message_id'
  },

  evidence_grade: C.EVIDENCE.RECONSTRUCTION,

  description: [
    'A buyer looking at a listing taps the WhatsApp button and a message lands on the',
    'dealership number. This is the primary real capture path for marketplace demand,',
    'because Dubizzle Motors publishes no leads-out API, no webhook and no developer',
    'portal - there is nothing to integrate against, so the enquiry is captured where it',
    'actually appears.',
    '',
    'EVIDENCE GRADE: the OUTER envelope below is the WhatsApp Cloud API inbound webhook',
    'shape from Meta\'s published documentation. The INNER message text - the listing',
    'preamble the marketplace prepends - is OUR RECONSTRUCTION of what a dealer sees.',
    'It is not a published contract and the marketplace is free to change it without',
    'telling anyone. Any parser built on it must fail soft: if the preamble does not',
    'match, the message is still a real customer message and must still become a lead,',
    'just without the vehicle attribution.',
    '',
    'Note where the origin proof comes from: the TRANSPORT is attested, the MARKETPLACE',
    'is not. On the live WhatsApp channel a shared secret header attests the delivery, and',
    'the listing reference is a string in the message body that anyone could type. So the',
    'lead is real and the attribution is an assertion - which is why the normalized object',
    'below records attribution_confidence rather than presenting the listing as proven.'
  ].join('\n'),

  payload_raw: {
    _simulation: {
      environment_label: C.ENVIRONMENT_LABEL,
      dealership: C.DEALERSHIP_NAME,
      shape_of_outer_envelope: 'WhatsApp Cloud API inbound message webhook (published by Meta)',
      shape_of_message_text: 'reconstruction - no published marketplace contract exists'
    },
    object: 'whatsapp_business_account',
    entry: [{
      id: '000000000000001',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '999555010',
            phone_number_id: '000000000000010'
          },
          contacts: [{
            profile: { name: 'Test Buyer Alpha' },
            wa_id: '9995550101'
          }],
          messages: [{
            from: '9995550101',
            id: 'wamid.SIMULATED.A.0000000000000001',
            timestamp: String(C.unixAt(0)),
            type: 'text',
            text: {
              body: [
                'Hello, I am interested in your listing.',
                'Ref: NEXUS-TEST-000123',
                'https://marketplace.invalid/listing/NEXUS-TEST-000123',
                '2021 Nissan Patrol Platinum',
                '',
                'Is it still available and can I see it this weekend?'
              ].join('\n')
            }
          }]
        }
      }]
    }]
  },

  normalized: {
    // WhatsApp gives a profile name, not a verified legal name. It is the best
    // name available at this point and is treated as such downstream.
    full_name: 'Test Buyer Alpha',
    // wa_id is E.164 digits WITHOUT the leading plus. Adding it is a
    // normalization step, not a formatting preference.
    phone_e164: '+9995550101',
    vehicle_interest: '2021 Nissan Patrol Platinum',
    message: 'Is it still available and can I see it this weekend?',
    locale: 'en_AE',
    attribution: {
      source_key: 'marketplace_dubizzle',
      channel: 'whatsapp_inbound',
      listing_ref: 'NEXUS-TEST-000123',
      listing_url: 'https://marketplace.invalid/listing/NEXUS-TEST-000123',
      attribution_confidence: 'body_text_only',
      attribution_note:
        'The listing reference was read out of the message body. It is asserted by the ' +
        'sender, not proven by the transport. Do not present it as verified provenance.',
      simulated: true
    }
    // budget_aed is deliberately absent. The buyer did not state one, and the
    // simulator does not invent figures.
  },

  expect: {
    disposition: 'PROMOTED',
    in_words:
      'Recorded on the first call with a provider-minted external id (the wamid), ' +
      'normalized in the same hop because the payload already carries a name and a phone ' +
      'number, then promoted to a lead. No second-hop fetch is needed. A redelivery of the ' +
      'same wamid returns already-known rather than a second lead.'
  }
};
