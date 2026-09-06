'use strict';

// Scenario registry. Order is the reading order: A-B are the marketplace paths
// that exist today, C-F are the integrated providers, G-I are the refusals, and
// J is the one that fails silently in production while every test passes.

const SCENARIOS = [
  require('./a-dubizzle-whatsapp-clean'),
  require('./b-dubizzle-email-notification'),
  require('./c-meta-lead-ads-two-hop'),
  require('./d-meta-lead-ads-retention-expired'),
  require('./e-google-ads-lead-form'),
  require('./f-website-form-clean'),
  require('./g-website-form-honeypot-bot'),
  require('./h-duplicate-delivery'),
  require('./i-malformed-hostile'),
  require('./j-arabic-name-unicode')
];

const C = require('../lib/constants');

// Structural checks that run on require(). A scenario that does not satisfy the
// export contract should break the CLI immediately, not produce a subtly wrong
// fixture.
const REQUIRED_KEYS = [
  'id', 'title', 'source_key', 'provenance', 'description', 'payload_raw', 'normalized', 'expect'
];

const seen = Object.create(null);

SCENARIOS.forEach(function (s, i) {
  REQUIRED_KEYS.forEach(function (k) {
    if (!(k in s)) {
      throw new Error('scenario at index ' + i + ' is missing required export `' + k + '`');
    }
  });
  if (seen[s.id]) throw new Error('duplicate scenario id ' + s.id);
  seen[s.id] = true;

  if (C.SOURCE_KEYS.indexOf(s.source_key) === -1) {
    throw new Error('scenario ' + s.id + ' has unknown source_key ' + JSON.stringify(s.source_key));
  }
  if (s.provenance !== C.EMITTED_PROVENANCE) {
    throw new Error(
      'scenario ' + s.id + ' declares provenance ' + JSON.stringify(s.provenance) +
      '. Every scenario this simulator emits must declare ' + JSON.stringify(C.EMITTED_PROVENANCE) +
      '; use provenance_in_production to record what the live endpoint would declare.'
    );
  }
  if (s.provenance_in_production &&
      C.PROVENANCE_KINDS.indexOf(s.provenance_in_production) === -1) {
    throw new Error('scenario ' + s.id + ' has unknown provenance_in_production ' +
      JSON.stringify(s.provenance_in_production));
  }

  // The database decides what provenance a source is capable of proving:
  //   lead_ingest_endpoint_production_matches_source
  //     check (environment <> 'production' or declared_provenance = required_provenance_for_source)
  // A scenario documenting a different one is documenting an endpoint that
  // cannot exist, so it fails here rather than misleading a reader.
  const cat = C.SOURCE_CATALOGUE[s.source_key];
  if (s.provenance_in_production && s.provenance_in_production !== cat.required_provenance) {
    throw new Error(
      'scenario ' + s.id + ' says provenance_in_production ' +
      JSON.stringify(s.provenance_in_production) + ' but lead_source_catalogue requires ' +
      JSON.stringify(cat.required_provenance) + ' for source_key ' + s.source_key + '. ' +
      'A production endpoint with that pairing is refused by ' +
      'lead_ingest_endpoint_production_matches_source.'
    );
  }
  if (C.DISPOSITIONS.indexOf(s.expect.disposition) === -1) {
    throw new Error('scenario ' + s.id + ' expects unknown disposition ' +
      JSON.stringify(s.expect.disposition));
  }
});

function byId(needle) {
  const want = String(needle).trim().toLowerCase();
  return SCENARIOS.filter(function (s) {
    return s.id.toLowerCase() === want || s.slug.toLowerCase() === want;
  })[0] || null;
}

module.exports = { SCENARIOS, byId };
