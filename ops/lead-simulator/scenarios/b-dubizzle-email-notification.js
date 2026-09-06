'use strict';

const C = require('../lib/constants');

// ---------------------------------------------------------------------------
// B. Marketplace enquiry that arrives as a notification EMAIL. The fallback.
// ---------------------------------------------------------------------------

const OCCURRED_AT = C.at(7);
const RFC_MESSAGE_ID = 'sim-b-0000000000000002@marketplace.invalid';

// The per-dealership ingest address. A secret local-part on a dedicated
// subdomain - NOT plus-addressing, which forwarders strip or mangle. Knowing
// this address is the authenticity claim; see the description.
const INGEST_ADDRESS = 'q7f2m9x4t1@in.' + C.EMAIL_DOMAIN;

module.exports = {
  id: 'B',
  slug: 'dubizzle-email-notification',
  external_event_id: 'marketplace_email:' + RFC_MESSAGE_ID,
  occurred_at: OCCURRED_AT,
  title: 'Marketplace notification email parsed into a lead - the fallback path',
  source_key: 'marketplace_email_notification',

  provenance: C.EMITTED_PROVENANCE,
  // The email does not authenticate itself. What IS signed is the inbound-email
  // provider's webhook telling us an email arrived - a Svix HMAC. That is a
  // claim about the provider, not about the sender, and lead_source_catalogue
  // requires exactly it for this source.
  provenance_in_production: 'hmac_sha256_svix',

  evidence_grade: C.EVIDENCE.RECONSTRUCTION,

  description: [
    'The second way marketplace demand actually reaches a UAE dealer: a notification',
    'email to the account mailbox saying somebody enquired. No API, no webhook from the',
    'marketplace - an email, which we parse. It is the universal fallback for any',
    'marketplace with no API, which is currently all of them.',
    '',
    'EVIDENCE GRADE: the email content below is OUR RECONSTRUCTION. There is no published',
    'contract for this notification, the sender address and template are invented for this',
    'repository, and the marketplace can change the layout at any time. A parser built on',
    'it is a maintenance liability and must fail LOUDLY - an unparseable notification has',
    'to raise an operator task, never be dropped. The DELIVERY mechanics (a signed',
    'provider webhook, then a fetch) are our own contract with the inbound-email provider',
    'and are a different matter.',
    '',
    'THREE THINGS THAT ARE COUNTER-INTUITIVE AND LOAD-BEARING:',
    '',
    '1. ROUTE ON THE ENVELOPE RECIPIENT, NEVER ON THE To: HEADER. A dealer who forwards',
    '   marketplace mail from their own inbox produces a message whose To: still points at',
    '   themselves. Route on To: and every forwarded lead lands in the wrong tenant, or in',
    '   none. The envelope recipient is the only field that says where the mail was',
    '   actually delivered.',
    '',
    '2. DMARC CANNOT BE THE AUTHENTICITY GATE. SPF fails across a forward by design - that',
    '   is what forwarding does to SPF, not a sign of forgery - so requiring a DMARC pass',
    '   rejects precisely the forwarded mail this path exists to catch. The authenticity',
    '   claim is that the sender knew a secret, unguessable, per-dealership ingest address.',
    '   The auth results are recorded as a SIGNAL and are not a gate.',
    '',
    '3. IT IS A TWO-HOP SOURCE. The provider webhook carries metadata - message id,',
    '   envelope recipient, from, subject. The body is fetched on a second call. Same',
    '   record-then-hydrate shape as Meta in scenario C, for an entirely different reason.',
    '',
    'And one operational property: this path is slower than WhatsApp. Delivery, provider',
    'processing, fetch and parse all add latency to a channel where response time is the',
    'product. It is a fallback, not a plan.',
    '',
    'The contact is often a MASKED relay address rather than the buyer\'s own. The',
    'normalized object records the relay honestly and flags it, rather than letting the',
    'dealership believe it holds a direct address.'
  ].join('\n'),

  // HOP ONE. The signed provider webhook. Metadata only - no body.
  payload_raw: {
    _simulation: {
      environment_label: C.ENVIRONMENT_LABEL,
      dealership: C.DEALERSHIP_NAME,
      shape: 'inbound-email provider webhook (our own contract with the provider)',
      warning:
        'The marketplace email quoted in the hydration hop is invented. Do not treat it ' +
        'as a specification of any real provider\'s notification email.'
    },
    type: 'email.received',
    // The Svix signature is verified over the raw bytes before this object
    // exists. It attests the PROVIDER, not the sender.
    provider_event_id: 'msg_SIMULATED_B_0000000002',
    data: {
      rfc_message_id: RFC_MESSAGE_ID,
      // >>> Tenant routing key. Not the To: header.
      envelope_recipient: INGEST_ADDRESS,
      envelope_sender: 'listing-notifications@marketplace.invalid',
      from: 'listing-notifications@marketplace.invalid',
      // Deliberately different from envelope_recipient, which is what a
      // forwarded notification looks like. Routing on this would be wrong.
      to_header: 'sales@' + C.EMAIL_DOMAIN,
      subject: 'New enquiry on your listing NEXUS-TEST-000456',
      received_at: OCCURRED_AT,
      has_body: false,
      body_fetch_ref: 'msg_SIMULATED_B_0000000002',
      // Recorded, not enforced. See point 2 in the description.
      authentication_results: {
        spf: 'fail',
        dkim: 'pass',
        dmarc: 'fail',
        interpretation:
          'SPF and DMARC fail because this notification was forwarded. That is expected ' +
          'and is not evidence of forgery. The authenticity claim is the secret ingest ' +
          'address in envelope_recipient.',
        used_as_gate: false
      }
    }
  },

  // Post-hydration.
  normalized: {
    full_name: 'Test Buyer Bravo',
    email: 'buyer-bravo-relay@' + C.EMAIL_DOMAIN,
    phone_e164: '+9995550102',
    vehicle_interest: '2022 Toyota Land Cruiser GXR',
    // A number the fictional buyer typed. Not an outcome, not a forecast.
    budget_aed: 185000,
    message: 'Please send me the service history and the accident report.',
    locale: 'en_AE',
    attribution: {
      source_key: 'marketplace_email_notification',
      channel: 'email',
      listing_ref: 'NEXUS-TEST-000456',
      contact_is_relay_address: true,
      arrived_forwarded: true,
      attribution_confidence: 'parsed_from_notification_body',
      attribution_note:
        'Every field here came from parsing prose in an email body. If the template ' +
        'changes, these fields go missing before anyone notices.',
      simulated: true
    }
  },

  expect: {
    disposition: 'PROMOTED',
    in_words:
      'Two hops. The signed provider webhook is recorded against the RFC 822 Message-ID, ' +
      'so the same notification delivered twice cannot become two leads, and the tenant is ' +
      'resolved from the envelope recipient rather than the To: header. The body is then ' +
      'fetched, parsed and hydrated, and the event is promoted. The lead carries a relay ' +
      'email flagged as a relay - the dealership must not be told it holds the buyer\'s ' +
      'direct address. Had the parser found no name or no contact channel, the correct ' +
      'disposition is REFUSED plus an operator task holding the raw message, never a ' +
      'silent drop.'
  },

  plan: [
    {
      call: 'record',
      normalized: null,
      note:
        'Metadata only - the webhook carries no body. Keyed on the RFC 822 Message-ID, ' +
        'which is the dedup_field lead_source_catalogue names for this source.',
      expect: {
        disposition: 'PENDING_HYDRATION',
        in_words:
          'Delivery recorded and tenant resolved from the envelope recipient. No customer ' +
          'data yet.'
      }
    },
    {
      call: 'provider_fetch',
      note: 'Not a database call. Fetch the message body from the inbound-email provider.',
      request: {
        method: 'GET',
        url: 'https://api.inbound-email-provider.invalid/messages/msg_SIMULATED_B_0000000002',
        headers: { authorization: '[held-in-credential-store-never-in-a-payload]' }
      },
      response: {
        status: 200,
        body: {
          rfc_message_id: RFC_MESSAGE_ID,
          text: [
            'You have a new enquiry.',
            '',
            'Listing: NEXUS-TEST-000456 - 2022 Toyota Land Cruiser GXR',
            'Buyer name: Test Buyer Bravo',
            'Buyer email: buyer-bravo-relay@' + C.EMAIL_DOMAIN,
            'Buyer phone: +9995550102',
            'Budget: AED 185,000',
            'Message: Please send me the service history and the accident report.',
            '',
            'This is a simulated notification generated inside a ' + C.ENVIRONMENT_LABEL + '.'
          ].join('\n')
        }
      }
    },
    {
      call: 'hydrate',
      note:
        'The parse result is stored alongside the text, so that a later template change ' +
        'is diagnosable from the row rather than from a log nobody kept.',
      hydrated_payload: {
        source: 'inbound_email_body_fetch',
        fetched_at: C.at(8),
        rfc_message_id: RFC_MESSAGE_ID,
        body_text: [
          'You have a new enquiry.',
          '',
          'Listing: NEXUS-TEST-000456 - 2022 Toyota Land Cruiser GXR',
          'Buyer name: Test Buyer Bravo',
          'Buyer email: buyer-bravo-relay@' + C.EMAIL_DOMAIN,
          'Buyer phone: +9995550102',
          'Budget: AED 185,000',
          'Message: Please send me the service history and the accident report.',
          '',
          'This is a simulated notification generated inside a ' + C.ENVIRONMENT_LABEL + '.'
        ].join('\n'),
        parse_result: {
          parser: 'marketplace_email_notification.v0',
          matched_template: 'reconstruction_v0',
          fields_found: ['listing_ref', 'vehicle', 'name', 'email', 'phone', 'budget', 'message'],
          fields_missing: [],
          on_no_match:
            'raise an operator task with the raw message attached; never silently discard'
        }
      },
      expect: {
        disposition: 'PENDING_HYDRATION',
        in_words: 'Body attached and parsed. Still not a lead until promoted.'
      }
    },
    { call: 'promote' }
  ]
};
