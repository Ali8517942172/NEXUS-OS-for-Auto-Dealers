'use strict';

const C = require('./constants');
const V = require('./validate');
const A = require('./adapter');
const U = require('./unicode');

// ---------------------------------------------------------------------------
// Turn a scenario module into a fixture: the exact sequence of contract calls,
// with every guard actually executed rather than described.
// ---------------------------------------------------------------------------

const DEFAULT_PLAN = [{ call: 'record' }, { call: 'promote' }];

function guard(scenario, payloadForWrite, hydratedPayloads) {
  const problems = [];

  // 1. No shared secret may survive into anything that gets written. The CHECK
  //    covers payload_raw AND hydrated_payload, so both are scanned.
  V.findSharedSecrets({
    payload_raw: payloadForWrite,
    hydrated_payloads: hydratedPayloads || []
  }).forEach(function (h) {
    problems.push(
      'shared secret `' + h.key + '` survived at ' + h.path + ' in the payload that would be ' +
      'written. The database CHECK lead_event_payload_carries_no_shared_secret would refuse ' +
      'this write.'
    );
  });

  // 2. No fabricated monetary outcome, anywhere in the scenario.
  V.findFabricatedMoney({
    payload_raw: scenario.payload_raw,
    normalized: scenario.normalized,
    expect: scenario.expect,
    plan: scenario.plan || null
  }).forEach(function (h) {
    problems.push(
      'forbidden monetary key `' + h.key + '` at ' + h.path + '. A scenario may carry a ' +
      'budget_aed the fictional buyer typed; it may not carry a recovered, attributed or ' +
      'realised figure. The simulator produces no revenue.'
    );
  });

  // 3. Every identity must be visibly synthetic.
  V.findNonSyntheticIdentities({
    payload_raw: scenario.payload_raw,
    normalized: scenario.normalized,
    plan: scenario.plan || null
  }).forEach(function (h) {
    problems.push('non-synthetic identity at ' + h.path + ': ' + h.why + ' (' + h.value + ')');
  });

  return problems;
}

/**
 * Scenarios that claim they will be promoted must actually satisfy the
 * normalized contract, and scenarios that claim a refusal must actually be
 * refused. Checking that here is what stops the fixtures drifting into fiction.
 */
function selfCheck(scenario) {
  const notes = [];
  const d = scenario.expect.disposition;

  if (d === 'PROMOTED' || d === 'ALREADY_KNOWN') {
    const refusals = V.validateNormalized(scenario.normalized);
    if (refusals.length) {
      throw new Error(
        'scenario ' + scenario.id + ' expects ' + d + ' but its normalized object is ' +
        'invalid: ' + refusals.map(function (r) { return r.rule; }).join(', ')
      );
    }
    const idRefusals = V.validateExternalEventId(externalIdFor(scenario, {}));
    if (idRefusals.length) {
      throw new Error(
        'scenario ' + scenario.id + ' expects ' + d + ' but its external_event_id is ' +
        'refused: ' + idRefusals.map(function (r) { return r.rule; }).join(', ')
      );
    }
    notes.push('normalized object satisfies the Lead Event contract (checked at emit time)');
  }

  if (d === 'REFUSED') {
    const found = [];
    V.validateExternalEventId(externalIdFor(scenario, {})).forEach(function (r) { found.push(r); });
    if (scenario.normalized !== null) {
      V.validateNormalized(scenario.normalized).forEach(function (r) { found.push(r); });
    }
    const honeypot = A.checkHoneypot(scenario.payload_raw);
    if (honeypot.refused) found.push({ rule: honeypot.rule, detail: honeypot.detail });

    if (!found.length) {
      throw new Error(
        'scenario ' + scenario.id + ' expects REFUSED but every validator accepted it. ' +
        'Either the scenario is wrong or a guard has stopped working.'
      );
    }
    notes.push('refused at emit time by: ' + found.map(function (r) { return r.rule; }).join(', '));
  }

  return notes;
}

function externalIdFor(scenario, step) {
  return step.external_event_id || scenario.external_event_id ||
    (scenario.plan || []).reduce(function (acc, s) {
      return acc || s.external_event_id;
    }, null);
}

function renderStep(scenario, step, index, ctx) {
  const call = step.call;
  const base = {
    step: index + 1,
    note: step.note || null,
    expect: step.expect || null
  };

  if (call === 'record') {
    return Object.assign(base, {
      call: 'nexus_record_lead_event',
      kind: 'database',
      args: {
        p_public_key: ctx.publicKey,
        p_external_event_id: externalIdFor(scenario, step),
        p_origin_verified: C.EMITTED_PROVENANCE,
        p_payload_raw: ctx.payloadForWrite,
        p_occurred_at: step.occurred_at || scenario.occurred_at || C.at(0),
        p_normalized: ('normalized' in step) ? step.normalized : scenario.normalized
      },
      returns: 'event_id (uuid), already_known (boolean)'
    });
  }

  if (call === 'hydrate') {
    // The no-shared-secret CHECK covers hydrated_payload as well as
    // payload_raw, so the second-hop body goes through the same strip.
    const hyd = step.hydrated_payload
      ? A.stripSharedSecrets(step.hydrated_payload).payload
      : null;
    return Object.assign(base, {
      call: 'nexus_hydrate_lead_event',
      kind: 'database',
      args: {
        event_id: '<event_id returned by step 1>',
        hydrated_payload: hyd,
        normalized: ('normalized' in step) ? step.normalized : scenario.normalized
      }
    });
  }

  if (call === 'promote') {
    return Object.assign(base, {
      call: 'nexus_promote_lead_event',
      kind: 'database',
      skipped: step.skipped === true,
      args: { event_id: '<event_id returned by step 1>' }
    });
  }

  if (call === 'provider_fetch') {
    return Object.assign(base, {
      call: 'provider_fetch',
      kind: 'not_a_database_call',
      request: step.request || null,
      response: step.response || null
    });
  }

  if (call === 'adapter_refuse') {
    // Executed for real, so the fixture carries produced messages.
    const refusals = [];
    V.validateExternalEventId(externalIdFor(scenario, step)).forEach(function (r) {
      refusals.push(r);
    });
    if (scenario.normalized !== null) {
      V.validateNormalized(scenario.normalized).forEach(function (r) { refusals.push(r); });
    }
    const hp = A.checkHoneypot(scenario.payload_raw);
    if (hp.refused) refusals.push({ rule: hp.rule, detail: hp.detail });

    return Object.assign(base, {
      call: 'adapter_refusal',
      kind: 'before_any_database_call',
      corroborating_signals: step.corroborating_signals || null,
      refusals: refusals,
      database_calls_made: 0
    });
  }

  throw new Error('scenario ' + scenario.id + ' step ' + (index + 1) + ': unknown call ' + call);
}

function buildFixture(scenario, opts) {
  opts = opts || {};
  const publicKey = opts.publicKey;

  // Run the real adapter strip. E is the scenario where this does something.
  const stripResult = A.stripSharedSecrets(scenario.payload_raw);

  // Same treatment for every second-hop body the plan declares.
  const hydratedPayloads = (scenario.plan || [])
    .filter(function (s) { return s.call === 'hydrate' && s.hydrated_payload; })
    .map(function (s) { return A.stripSharedSecrets(s.hydrated_payload).payload; });

  const problems = guard(scenario, stripResult.payload, hydratedPayloads);
  if (problems.length) {
    throw new Error(
      'scenario ' + scenario.id + ' failed the emit guards and was NOT emitted:\n  - ' +
      problems.join('\n  - ')
    );
  }

  const selfCheckNotes = selfCheck(scenario);

  const ctx = { publicKey: publicKey, payloadForWrite: stripResult.payload };
  const plan = scenario.plan && scenario.plan.length ? scenario.plan : DEFAULT_PLAN;

  const fixture = {
    _meta: {
      notice: C.ENVIRONMENT_LABEL + ' - SYNTHETIC DATA, NOT A REAL CUSTOMER, NOT REAL BUSINESS',
      generator: 'ops/lead-simulator',
      generated_at: new Date().toISOString(),
      environment: C.ENVIRONMENT,
      dealership: C.DEALERSHIP_NAME,
      is_simulation: true,
      not_countable_as: [
        'a lead the dealership received',
        'pipeline',
        'revenue, recovered or attributed'
      ],
      identity_policy: {
        emails: 'RFC 2606 .invalid domain - undeliverable by construction',
        phones: 'ITU-T reserved country code +999 - well-formed E.164, dialable nowhere'
      }
    },

    scenario: {
      id: scenario.id,
      slug: scenario.slug,
      title: scenario.title,
      source_key: scenario.source_key,
      provenance: scenario.provenance,
      provenance_in_production: scenario.provenance_in_production || null,
      capture_in_production: scenario.capture_in_production || null,
      evidence_grade: scenario.evidence_grade,
      // Copied from public.lead_source_catalogue at emit time, not restated by
      // hand. scenarios/index.js asserts the scenario against it on require().
      source_catalogue: C.SOURCE_CATALOGUE[scenario.source_key],
      description: scenario.description
    },

    payload_as_delivered: scenario.payload_raw,
    payload_as_written: stripResult.payload,

    adapter: {
      stripped: stripResult.stripped,
      strip_note: stripResult.stripped.length
        ? 'Removed before the write. Compare payload_as_delivered with payload_as_written.'
        : 'Nothing to strip in this delivery.'
    },

    normalized: scenario.normalized,

    plan: plan.map(function (s, i) { return renderStep(scenario, s, i, ctx); }),

    expect: scenario.expect,

    emit_time_checks: selfCheckNotes
  };

  if (scenario.derive_signature_evidence) {
    fixture.signature_evidence = U.signatureEvidence(scenario.payload_raw);
  }

  return fixture;
}

module.exports = { buildFixture, DEFAULT_PLAN };
