'use strict';

const C = require('../lib/constants');

// ---------------------------------------------------------------------------
// D. The same two-hop flow, where the second hop is too late.
// ---------------------------------------------------------------------------

const LEADGEN_ID = '900000000000002';
const CREATED_AT = C.at(-60 * 24 * 97);        // the delivery, 97 days before base
const FETCH_AT = C.at(20);                     // the retry, today

module.exports = {
  id: 'D',
  slug: 'meta-lead-ads-retention-expired',
  title: 'Meta Lead Ads - second-hop fetch fails because the retention window closed',
  source_key: 'meta_lead_ads_instagram',

  provenance: C.EMITTED_PROVENANCE,
  provenance_in_production: 'hmac_sha256_x_hub',

  evidence_grade: C.EVIDENCE.PUBLISHED,

  description: [
    'Lead data behind a leadgen_id does not live forever. Meta documents a hard expiry,',
    'after which the Graph API answers the fetch with a "does not exist" error rather than',
    'the customer.',
    '',
    'ON THE NUMBER 90: secondary sources put the window at 90 days and Meta\'s own page has',
    'not been checked against that. It is used below to make the scenario concrete and it',
    'is NOT a measured figure - lead_source_catalogue says the same thing in its',
    'evidence_note. Do not build an alerting threshold on it without verifying it first.',
    '',
    'This scenario exists because of what the WRONG handling looks like. The tempting',
    'implementations are all lies:',
    '  - delete the event, because it has no customer data  -> the delivery is erased and',
    '    the dealership is told nothing arrived that day. A missing row is not proof the',
    '    event did not happen.',
    '  - retry forever                                       -> a queue that never drains',
    '  - promote it with a placeholder name                  -> a fabricated customer',
    '',
    'The correct disposition is EXPIRED: the event stays, it carries the reason and the',
    'provider\'s own error code, and it is excluded from the promotable set. It is',
    'countable. "We received 41 Instagram leads last quarter and 3 expired before we could',
    'fetch them" is a true and useful sentence. "38 leads" is not.',
    '',
    'The operational lesson is in the timestamps: the gap between created_time and the',
    'fetch is what killed this lead. Alert on the age of the pending-hydration queue, not',
    'on the failure - by the time it fails it is unrecoverable.'
  ].join('\n'),

  payload_raw: {
    object: 'page',
    entry: [{
      id: '100000000000002',
      time: Math.floor(Date.parse(CREATED_AT) / 1000),
      changes: [{
        field: 'leadgen',
        value: {
          ad_id: '300000000000002',
          adgroup_id: '400000000000002',
          created_time: Math.floor(Date.parse(CREATED_AT) / 1000),
          leadgen_id: LEADGEN_ID,
          page_id: '100000000000002',
          form_id: '500000000000002'
        }
      }]
    }]
  },

  // There is no normalized object and there never will be one for this event.
  // NULL here is an honest absence, not an unimplemented branch.
  normalized: null,

  expect: {
    disposition: 'EXPIRED',
    in_words:
      'The event is recorded and kept. The fetch fails with Meta\'s GraphMethodException ' +
      '(code 100, subcode 33). The event is marked EXPIRED with the reason and the provider ' +
      'error stored on it, is never promoted, and is never deleted. It counts as a lead we ' +
      'received and could not read, which is a different and more useful fact than silence.'
  },

  plan: [
    {
      call: 'record',
      external_event_id: 'meta_leadgen:' + LEADGEN_ID,
      occurred_at: CREATED_AT,
      normalized: null,
      note: 'Recorded at delivery time, 97 days before the fetch attempt below.',
      expect: {
        disposition: 'PENDING_HYDRATION',
        in_words: 'Signed, anonymous, durable, awaiting the second hop.'
      }
    },
    {
      call: 'provider_fetch',
      note:
        'The retry, run today. 97 days after created_time, past the retention window as ' +
        'secondary sources report it.',
      request: {
        method: 'GET',
        url: 'https://graph.facebook.com/v25.0/' + LEADGEN_ID,
        query: { access_token: '[held-in-credential-store-never-in-a-payload]' },
        attempted_at: FETCH_AT,
        age_at_attempt_days: 97
      },
      response: {
        status: 400,
        body: {
          error: {
            message: 'Unsupported get request. Object with ID \'' + LEADGEN_ID +
              '\' does not exist, cannot be loaded due to missing permissions, or does not ' +
              'support this operation.',
            type: 'GraphMethodException',
            code: 100,
            error_subcode: 33,
            fbtrace_id: 'SIMULATED-TRACE-D'
          }
        },
        interpretation:
          'Code 100 / subcode 33 is ambiguous by design: it covers "gone", "never existed" ' +
          'and "your token cannot see it". Do not report it as certainly-expired unless the ' +
          'age of the event says so. Here it does - 97 days.'
      }
    },
    {
      call: 'hydrate',
      note:
        'Hydration is still CALLED. It attaches the failure rather than customer data, so ' +
        'that the reason lives on the event instead of only in a log line somebody has to ' +
        'go and find.',
      hydrated_payload: {
        source: 'graph_api_leadgen_fetch',
        hydration_outcome: 'unavailable',
        reason_code: 'provider_retention_window_closed',
        reason:
          'Meta retains lead data for a bounded window. This event was 97 days old at the ' +
          'first successful contact with the API, past the ~90 days secondary sources ' +
          'report (unverified against Meta\'s own documentation), so the customer data no ' +
          'longer exists to be fetched. This is permanent; do not retry.',
        provider_error: { type: 'GraphMethodException', code: 100, error_subcode: 33 },
        attempted_at: FETCH_AT,
        age_at_attempt_days: 97,
        retry_advised: false
      },
      normalized: null,
      expect: {
        disposition: 'EXPIRED',
        in_words:
          'Event marked EXPIRED with a stated reason. Retained. Excluded from promotion. ' +
          'Counted in "received" and in "expired", never in "leads".'
      }
    },
    {
      call: 'promote',
      skipped: true,
      note:
        'Deliberately NOT called. Promotion requires full_name and a contact channel; there ' +
        'are none and inventing them would manufacture a customer. This step is listed so ' +
        'that its absence is explicit rather than assumed.',
      expect: {
        disposition: 'EXPIRED',
        in_words:
          'If promotion were attempted it would be refused by full_name_required. It is not ' +
          'attempted.'
      }
    }
  ]
};
