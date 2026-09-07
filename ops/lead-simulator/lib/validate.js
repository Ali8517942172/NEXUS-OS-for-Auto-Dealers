'use strict';

const C = require('./constants');

// ---------------------------------------------------------------------------
// Generic walker
// ---------------------------------------------------------------------------

function walk(node, visit, path) {
  path = path || '$';
  visit(node, path);
  if (Array.isArray(node)) {
    node.forEach(function (v, i) { walk(v, visit, path + '[' + i + ']'); });
  } else if (node && typeof node === 'object') {
    Object.keys(node).forEach(function (k) { walk(node[k], visit, path + '.' + k); });
  }
}

// ---------------------------------------------------------------------------
// Guard 1: no shared secret may reach a payload column
// ---------------------------------------------------------------------------
// The database carries CHECK lead_event_payload_carries_no_shared_secret. It
// refuses any payload_raw containing `google_key`. Google Ads puts that key in
// the body of every delivery, so the adapter MUST strip it before the write --
// see scenarios/e-google-ads-lead-form.js, which exists to prove it does.
//
// The rest of the list is here because the same class of mistake -- echoing the
// credential you were authenticated with back into a durable row -- has more
// than one spelling.
const SHARED_SECRET_KEYS = [
  'google_key',
  'app_secret',
  'client_secret',
  'access_token',
  'page_access_token',
  'verify_token',
  'hub.verify_token',
  'webhook_secret',
  'shared_secret',
  'api_key',
  'apikey',
  'authorization',
  'x-hub-signature-256',
  'password'
];

function findSharedSecrets(payload) {
  const hits = [];
  walk(payload, function (node, path) {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      Object.keys(node).forEach(function (k) {
        if (SHARED_SECRET_KEYS.indexOf(String(k).toLowerCase()) !== -1) {
          hits.push({ path: path + '.' + k, key: k });
        }
      });
    }
  });
  return hits;
}

// ---------------------------------------------------------------------------
// Guard 2: no fabricated monetary outcome
// ---------------------------------------------------------------------------
// A scenario may carry `budget_aed` -- a number the fictional buyer typed into
// a form. It may NOT carry a recovered, attributed, saved or realised figure.
// The simulator produces no revenue and must never appear to.
const FORBIDDEN_MONEY_KEYS = [
  'revenue', 'revenue_aed', 'revenue_recovered', 'recovered', 'recovered_aed',
  'attributed_revenue', 'attributed_aed', 'deal_value', 'closed_value',
  'gross_profit', 'profit', 'commission', 'roi', 'uplift', 'savings', 'saved_aed'
];

function findFabricatedMoney(payload) {
  const hits = [];
  walk(payload, function (node, path) {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      Object.keys(node).forEach(function (k) {
        if (FORBIDDEN_MONEY_KEYS.indexOf(String(k).toLowerCase()) !== -1) {
          hits.push({ path: path + '.' + k, key: k });
        }
      });
    }
  });
  return hits;
}

// ---------------------------------------------------------------------------
// Guard 3: every identity must be visibly synthetic
// ---------------------------------------------------------------------------

const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const E164_IN_TEXT = /\+[1-9][0-9]{7,14}/g;

// A UAE mobile, in any of the shapes a real one is written in. If a string in a
// payload matches this, someone has typed a number that can ring a handset in
// Dubai. Refuse the emit -- including in the hostile scenario, which reproduces
// the "no country code" DEFECT without reproducing a dialable NUMBER.
const DIALABLE_UAE = /(?:\+?971[\s-]?|0)5[024568][\s-]?\d{3}[\s-]?\d{4}/g;

function findNonSyntheticIdentities(payload) {
  const hits = [];
  walk(payload, function (node, path) {
    if (typeof node !== 'string') return;

    (node.match(EMAIL_IN_TEXT) || []).forEach(function (addr) {
      if (!/\.invalid$/i.test(addr)) {
        hits.push({ path: path, value: addr, why: 'email is not on an RFC 2606 .invalid domain' });
      }
    });

    (node.match(E164_IN_TEXT) || []).forEach(function (num) {
      if (num.indexOf(C.PHONE_PREFIX) !== 0) {
        hits.push({ path: path, value: num, why: 'E.164 number is outside the reserved +999555 simulator range' });
      }
    });

    (node.match(DIALABLE_UAE) || []).forEach(function (num) {
      hits.push({ path: path, value: num, why: 'string is shaped like a dialable UAE mobile number' });
    });
  });
  return hits;
}

// ---------------------------------------------------------------------------
// The normalized Lead Event object
// ---------------------------------------------------------------------------
// full_name is required. One of email / phone_e164 is required. phone_e164, if
// present, must be E.164. Everything else is optional.
//
// Each refusal is returned by NAME so a scenario can assert on it, which is
// what scenario I does.

function validateNormalized(n) {
  const refusals = [];

  if (n === null || typeof n !== 'object' || Array.isArray(n)) {
    refusals.push({
      rule: 'normalized_object_required',
      detail: 'normalized must be a JSON object; got ' + (n === null ? 'null' : typeof n)
    });
    return refusals;
  }

  if (typeof n.full_name !== 'string' || n.full_name.trim() === '') {
    refusals.push({
      rule: 'full_name_required',
      detail: 'full_name is required and must be a non-empty string after trimming; got ' +
        JSON.stringify(n.full_name === undefined ? null : n.full_name)
    });
  }

  const hasEmail = typeof n.email === 'string' && n.email.trim() !== '';
  const hasPhone = typeof n.phone_e164 === 'string' && n.phone_e164.trim() !== '';

  if (!hasEmail && !hasPhone) {
    refusals.push({
      rule: 'contact_channel_required',
      detail: 'at least one of email / phone_e164 is required; neither was present'
    });
  }

  if (hasPhone && !C.E164.test(n.phone_e164)) {
    refusals.push({
      rule: 'phone_e164_malformed',
      detail: 'phone_e164 must match ' + C.E164.source + '; got ' + JSON.stringify(n.phone_e164)
    });
  }

  if (n.budget_aed !== undefined && n.budget_aed !== null && typeof n.budget_aed !== 'number') {
    refusals.push({
      rule: 'budget_aed_must_be_number',
      detail: 'budget_aed must be a number when present; got ' + typeof n.budget_aed
    });
  }

  return refusals;
}

// ---------------------------------------------------------------------------
// external_event_id
// ---------------------------------------------------------------------------
// The id must be the PROVIDER'S own stable identifier for the delivery. A
// minted one defeats the whole point: `nokey:<epoch_millis>` is what an adapter
// emits when the provider gave it nothing to key on, and it makes every retry
// look like a new lead. Refuse it at the door.

function validateExternalEventId(id) {
  const refusals = [];

  if (typeof id !== 'string' || id.trim() === '') {
    refusals.push({
      rule: 'external_event_id_required',
      detail: 'external_event_id must be a non-empty string; got ' + JSON.stringify(id)
    });
    return refusals;
  }

  if (/^nokey:/i.test(id)) {
    refusals.push({
      rule: 'external_event_id_must_be_provider_minted',
      detail: 'external_event_id ' + JSON.stringify(id) + ' uses the `nokey:<epoch_millis>` fallback. ' +
        'That is a locally minted timestamp, not a provider identifier: it changes on every ' +
        'redelivery, so idempotency cannot hold and every retry becomes a duplicate lead.'
    });
  }

  return refusals;
}

module.exports = {
  walk,
  SHARED_SECRET_KEYS,
  FORBIDDEN_MONEY_KEYS,
  findSharedSecrets,
  findFabricatedMoney,
  findNonSyntheticIdentities,
  validateNormalized,
  validateExternalEventId
};
