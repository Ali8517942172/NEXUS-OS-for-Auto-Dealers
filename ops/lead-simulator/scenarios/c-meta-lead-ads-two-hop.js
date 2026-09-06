'use strict';

const C = require('../lib/constants');

// ---------------------------------------------------------------------------
// C. Meta Lead Ads. Six fields, none of them a customer. Then the second hop.
// ---------------------------------------------------------------------------

const OCCURRED_AT = C.at(15);
const LEADGEN_ID = '900000000000001';

// The webhook body exactly as Meta documents it: object, entry[], changes[],
// and a `value` carrying six fields - five ids and a timestamp. There is no
// name in it. There is no phone number in it. There is no email in it.
const WEBHOOK_BODY = {
  object: 'page',
  entry: [{
    id: '100000000000001',            // page id
    time: C.unixAt(15),
    changes: [{
      field: 'leadgen',
      value: {
        ad_id: '300000000000001',
        adgroup_id: '400000000000001',
        created_time: C.unixAt(15),
        leadgen_id: LEADGEN_ID,
        page_id: '100000000000001',
        form_id: '500000000000001'
      }
    }]
  }]
};

module.exports = {
  id: 'C',
  slug: 'meta-lead-ads-two-hop',
  title: 'Meta Lead Ads - metadata-only webhook, then a successful second-hop fetch',
  source_key: 'meta_lead_ads_facebook',

  provenance: C.EMITTED_PROVENANCE,
  provenance_in_production: 'hmac_sha256_x_hub',

  // Meta publishes this shape. Different grade of evidence from A and B.
  evidence_grade: C.EVIDENCE.PUBLISHED,

  description: [
    'THIS IS WHAT META ACTUALLY SENDS. Not a trimmed example - the whole thing. Six',
    'fields in `value`, five of which are ids, and not one byte of customer data.',
    '',
    'Every integration that assumes "the webhook contains the lead" is broken on arrival',
    'and the breakage is invisible: the webhook succeeds, a row appears, and the row has',
    'no human in it. The customer data lives behind a second call,',
    '',
    '    GET /v25.0/<leadgen_id>?access_token=<page_token>',
    '',
    'which needs the leads_retrieval permission plus Lead Access Manager access - two',
    'grants that are easy to have working in a sandbox and missing in the client account,',
    'and whose absence produces the same error as scenario D.',
    '',
    'The call returns field_data as an array of {name, values[]} pairs whose `name` values',
    'are chosen by whoever built the form. They are NOT a fixed vocabulary: "full_name"',
    'on one form is "your_name" on the next.',
    '',
    'That is why the ingestion layer is three functions and not one. nexus_record_lead_event',
    'is allowed to accept an event with p_normalized = NULL - the delivery is real and must',
    'be durable before we know who it is from. nexus_hydrate_lead_event attaches the',
    'customer data when the fetch returns. nexus_promote_lead_event is where full_name and',
    'a contact channel become mandatory, because that is the first moment they could',
    'possibly be known.',
    '',
    'Record the delivery first, then hydrate. An adapter that fetches before writing loses',
    'the lead entirely if the fetch fails - which is scenario D.'
  ].join('\n'),

  payload_raw: WEBHOOK_BODY,

  // The post-hydration state. See `plan` for what is true at each hop.
  normalized: {
    full_name: 'Test Buyer Charlie',
    email: 'buyer-charlie@' + C.EMAIL_DOMAIN,
    phone_e164: '+9995550103',
    vehicle_interest: '2023 Nissan Patrol - test drive request',
    message: 'Best price for cash purchase please.',
    locale: 'en_AE',
    attribution: {
      source_key: 'meta_lead_ads_facebook',
      platform: 'facebook',
      ad_id: '300000000000001',
      adgroup_id: '400000000000001',
      form_id: '500000000000001',
      page_id: '100000000000001',
      leadgen_id: LEADGEN_ID,
      attribution_confidence: 'provider_signed',
      simulated: true
    }
  },

  expect: {
    disposition: 'PROMOTED',
    in_words:
      'Two hops. The first records a signed but anonymous delivery and leaves it ' +
      'PENDING_HYDRATION - correct, not a failure. The second fetches field_data, hydrates ' +
      'the event and promotes it. The lead exists only after hop two.'
  },

  plan: [
    {
      call: 'record',
      external_event_id: 'meta_leadgen:' + LEADGEN_ID,
      normalized: null,
      note:
        'p_normalized is NULL on purpose. There is nothing to normalize yet: the body ' +
        'contains six ids. The external id is the leadgen_id, which is Meta\'s own stable ' +
        'identifier for this lead and is therefore what idempotency keys on.',
      expect: {
        disposition: 'PENDING_HYDRATION',
        in_words: 'Row written, signature verified, no customer data yet. Not an error state.'
      }
    },
    {
      call: 'provider_fetch',
      note: 'Not a database call. The second hop against the Graph API.',
      request: {
        method: 'GET',
        url: 'https://graph.facebook.com/v25.0/' + LEADGEN_ID,
        query: { access_token: '[held-in-credential-store-never-in-a-payload]' }
      },
      response: {
        status: 200,
        body: {
          created_time: OCCURRED_AT,
          id: LEADGEN_ID,
          field_data: [
            { name: 'full_name', values: ['Test Buyer Charlie'] },
            { name: 'email', values: ['buyer-charlie@' + C.EMAIL_DOMAIN] },
            { name: 'phone_number', values: ['+9995550103'] },
            { name: 'vehicle_of_interest', values: ['2023 Nissan Patrol - test drive request'] },
            { name: 'anything_else_', values: ['Best price for cash purchase please.'] }
          ]
        }
      }
    },
    {
      call: 'hydrate',
      note:
        'field_data is a list, not an object, and its `name` keys are form-author-defined. ' +
        'The mapping from those keys to the normalized object is per-form configuration and ' +
        'must be treated as such - hardcoding "full_name" works until the next form.',
      hydrated_payload: {
        source: 'graph_api_leadgen_fetch',
        fetched_at: C.at(15.5),
        leadgen_id: LEADGEN_ID,
        field_data: [
          { name: 'full_name', values: ['Test Buyer Charlie'] },
          { name: 'email', values: ['buyer-charlie@' + C.EMAIL_DOMAIN] },
          { name: 'phone_number', values: ['+9995550103'] },
          { name: 'vehicle_of_interest', values: ['2023 Nissan Patrol - test drive request'] },
          { name: 'anything_else_', values: ['Best price for cash purchase please.'] }
        ]
      },
      expect: {
        disposition: 'PENDING_HYDRATION',
        in_words: 'Customer data attached to the existing event. Still not a lead until promoted.'
      }
    },
    {
      call: 'promote',
      note:
        'full_name and a contact channel are enforced here - the first hop at which they ' +
        'could be known.',
      expect: {
        disposition: 'PROMOTED',
        in_words: 'The lead now exists, carrying the ad, form and campaign ids it arrived with.'
      }
    }
  ]
};
