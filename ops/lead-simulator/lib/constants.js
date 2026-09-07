'use strict';

// Every identity this simulator can emit. Nothing here is real, and the guards
// in validate.js refuse to emit anything that is not drawn from this file.
//
// WHY THIS FILE EXISTS AS A CHOKE POINT: the point of the simulator is that its
// output can never be mistaken for, or counted as, real business. That is not a
// convention you can hold in your head across ten scenario files. It is a
// constant table plus an assertion that runs before every emit.

// ---------------------------------------------------------------------------
// The fictional dealership
// ---------------------------------------------------------------------------

// This name is invented for this repository. It is NOT the name of any real UAE
// dealership, and no scenario in this directory may name, brand or imitate one.
const DEALERSHIP_NAME = 'Nexus Auto Test Showroom';

// Stamped into every payload, every fixture envelope and every POST header.
const ENVIRONMENT_LABEL = 'DEMONSTRATION TEST ENVIRONMENT';

// The database vocabulary. A simulation endpoint declares provenance
// 'simulated' and runs in environment 'simulation'; the writer refuses a
// production-environment endpoint whose provenance is unattestable, which is
// why this simulator physically cannot produce a production-labelled row.
const ENVIRONMENT = 'simulation';
const EMITTED_PROVENANCE = 'simulated';

// ---------------------------------------------------------------------------
// Contact details
// ---------------------------------------------------------------------------

// RFC 2606 reserves `.invalid` as a TLD guaranteed never to resolve. Mail to
// any address below is undeliverable by design.
const EMAIL_DOMAIN = 'nexus-auto-test-showroom.invalid';

// ITU-T E.164 country code 999 is reserved and is not assigned to any country,
// so a +999 number is well-formed E.164 and is not dialable anywhere on earth.
// That is the whole reason it is used here: the scenarios need numbers that
// PASS the E.164 check without any chance of ringing a real handset.
//
// NOTE FOR ANYONE ADDING A SCENARIO: do not "make it more realistic" by
// switching these to +9715… UAE mobile numbers. Every +9715 number of the right
// shape is either assigned to a person today or assignable to one tomorrow.
const PHONE_PREFIX = '+999555';

const SYNTHETIC_PHONES = {
  buyerAlpha:   '+9995550101',
  buyerBravo:   '+9995550102',
  buyerCharlie: '+9995550103',
  buyerDelta:   '+9995550104',
  buyerEcho:    '+9995550105',
  buyerFoxtrot: '+9995550106',
  buyerGolf:    '+9995550107',
  buyerHotel:   '+9995550108',
  buyerIndia:   '+9995550109',
  buyerJuliet:  '+9995550110'
};

// ---------------------------------------------------------------------------
// Deterministic clock
// ---------------------------------------------------------------------------
// occurred_at values are fixed so that regenerating fixtures produces a clean
// diff. Only `_meta.generated_at` moves.
const BASE_INSTANT = Date.parse('2026-09-06T09:00:00.000Z');

function at(minutesOffset) {
  return new Date(BASE_INSTANT + minutesOffset * 60000).toISOString();
}

function unixAt(minutesOffset) {
  return Math.floor((BASE_INSTANT + minutesOffset * 60000) / 1000);
}

// ---------------------------------------------------------------------------
// Contract vocabulary (kept here so a typo fails loudly instead of silently)
// ---------------------------------------------------------------------------

// Mirrored from public.lead_source_catalogue
// (supabase/migrations/20260906201008_leadingest_01_provenance_and_source_vocabulary.sql).
// The catalogue is the authority; this is a copy so the simulator can fail fast
// offline, and scenarios/index.js asserts every scenario against it. If the two
// ever disagree, the migration is right and this file is stale.
const SOURCE_CATALOGUE = {
  meta_lead_ads_facebook: {
    required_provenance: 'hmac_sha256_x_hub',
    dedup_field: 'leadgen_id',
    integration_status: 'AVAILABLE',
    delivery_shape: 'WEBHOOK_METADATA_THEN_FETCH'
  },
  meta_lead_ads_instagram: {
    required_provenance: 'hmac_sha256_x_hub',
    dedup_field: 'leadgen_id',
    integration_status: 'AVAILABLE',
    delivery_shape: 'WEBHOOK_METADATA_THEN_FETCH'
  },
  google_ads_lead_form: {
    required_provenance: 'shared_secret_in_body',
    dedup_field: 'lead_id',
    integration_status: 'AVAILABLE',
    delivery_shape: 'WEBHOOK_FULL_PAYLOAD'
  },
  website_form: {
    required_provenance: 'origin_and_form_key',
    dedup_field: 'submission_id',
    integration_status: 'AVAILABLE',
    delivery_shape: 'WEBHOOK_FULL_PAYLOAD'
  },
  marketplace_dubizzle: {
    // The catalogue REQUIRES 'simulated' for this source. That is not a
    // placeholder awaiting a better value: there is no public route, so no
    // external system can attest anything, and a production endpoint for this
    // source cannot exist until a commercial conversation changes the facts.
    required_provenance: 'simulated',
    dedup_field: 'simulator_scenario_id',
    integration_status: 'COMMERCIAL_CONVERSATION_REQUIRED',
    delivery_shape: 'INBOUND_MESSAGE'
  },
  marketplace_email_notification: {
    required_provenance: 'hmac_sha256_svix',
    dedup_field: 'rfc_message_id',
    integration_status: 'AVAILABLE',
    delivery_shape: 'INBOUND_EMAIL_METADATA_THEN_FETCH'
  },
  whatsapp_inbound: {
    required_provenance: 'shared_secret_header',
    dedup_field: 'wa_message_id',
    integration_status: 'AVAILABLE',
    delivery_shape: 'INBOUND_MESSAGE'
  },
  walk_in: {
    required_provenance: 'operator_recorded',
    dedup_field: 'operator_reference',
    integration_status: 'AVAILABLE',
    delivery_shape: 'MANUAL_ENTRY'
  },
  phone_call: {
    required_provenance: 'operator_recorded',
    dedup_field: 'operator_reference',
    integration_status: 'AVAILABLE',
    delivery_shape: 'MANUAL_ENTRY'
  }
};

const SOURCE_KEYS = [
  'meta_lead_ads_facebook',
  'meta_lead_ads_instagram',
  'google_ads_lead_form',
  'website_form',
  'marketplace_dubizzle',
  'marketplace_email_notification',
  'whatsapp_inbound',
  'walk_in',
  'phone_call'
];

const PROVENANCE_KINDS = [
  'hmac_sha256_x_hub',
  'hmac_sha256_svix',
  'shared_secret_header',
  'shared_secret_in_body',
  'origin_and_form_key',
  'operator_recorded',
  'simulated',
  'unverified'
];

// How much evidence stands behind a payload SHAPE. These two are not the same
// grade of thing and the README must not blur them.
const EVIDENCE = {
  // Taken from the provider's own published developer documentation.
  PUBLISHED: 'published_provider_contract',
  // Our reconstruction of what a dealer actually receives. No published
  // contract exists. Treat the field names as ours, not theirs.
  RECONSTRUCTION: 'reconstruction_no_published_contract',
  // Our own form, our own contract. We are not adapting to anybody here, so
  // the shape is right by definition -- which is a different claim again from
  // "the provider documents it".
  FIRST_PARTY: 'first_party_contract_we_own'
};

const DISPOSITIONS = [
  'PROMOTED',          // written, hydrated if needed, promoted to a lead
  'PENDING_HYDRATION', // recorded; customer data must be fetched second-hop
  'EXPIRED',           // recorded, hydration impossible, reason stated, retained
  'ALREADY_KNOWN',     // duplicate external id; success, not an error
  'REFUSED'            // adapter or database refused it, by name
];

// E.164 as the normalized Lead Event object defines it.
const E164 = /^\+[1-9][0-9]{7,14}$/;

// lead_ingest_endpoint_public_key_shape, from migration leadingest_02.
const PUBLIC_KEY_SHAPE = /^[A-Za-z0-9_-]{24,128}$/;

module.exports = {
  DEALERSHIP_NAME,
  ENVIRONMENT_LABEL,
  ENVIRONMENT,
  EMITTED_PROVENANCE,
  EMAIL_DOMAIN,
  PHONE_PREFIX,
  SYNTHETIC_PHONES,
  BASE_INSTANT,
  at,
  unixAt,
  SOURCE_KEYS,
  SOURCE_CATALOGUE,
  PROVENANCE_KINDS,
  EVIDENCE,
  DISPOSITIONS,
  E164,
  PUBLIC_KEY_SHAPE
};
