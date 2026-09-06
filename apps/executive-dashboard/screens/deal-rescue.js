/* NEXUS OS — screens/deal-rescue.js
   DEAL RESCUE. There is nothing to rescue, and this screen is the evidence for
   that sentence rather than an apology for it.

   v_deal_rescue returns zero rows and does so STRUCTURALLY: no deals table
   exists in this database, so no record is written while a deal is in progress.
   The sale record is written at the moment of sale, which makes DEAL_CREATED
   and SALE_CONFIRMED one event and leaves no in-flight period for any engine to
   observe. That is a fact about the schema, not about the sales floor, and the
   difference is the whole screen.

   THE CANDIDATE VIEW IS THE PRODUCT HERE. Eight rows that could plausibly have
   been called an in-flight deal were examined and each one carries a recorded
   reason for the refusal — an old lead is not a stalled deal; an approved
   inventory action is a stalled ACTION with no customer and no agreed price; a
   rejected KYC image evidences nothing; a completed sale is not in flight. A
   competitor's dashboard would show those eight as a pipeline. Showing them as
   refusals, with the reason attached, is the trust the product is selling.

   WHERE EVERYTHING COMES FROM — nothing below is computed in this file
     v_deal_rescue              one row per ADMITTED in-flight deal, with state,
                                basis, recommended action, owner, value, margin
                                at stake, confidence and the action lane. Empty.
     v_deal_rescue_candidates   every source considered as evidence of an
                                in-flight deal, with the verdict and the reason.
                                Only verdict = IN_FLIGHT_DEAL reaches the engine.
     v_deal_rescue_readiness    the purchase order: every prerequisite, what it
                                unlocks, the live evidence that it is missing,
                                why it is not a coding task, and a measurement
                                re-taken on every read so the list cannot go
                                stale the way a written one does.
     v_deal_rescue_state_model  every state the engine may return and whether a
                                branch for it exists at all. UNREACHABLE_BY_DESIGN
                                means no code path can produce it and none may be
                                written until its blocker is cleared.

   ═══════════════════════════════════════════════════════════════════════════
   FOUR RULES THIS SCREEN IS BUILT AROUND
   ═══════════════════════════════════════════════════════════════════════════

   1. AN EMPTY ENGINE IS NOT AN EMPTY SCREEN. "No deals at risk" alone would read
      as a clean pipeline. What is true is that this database cannot represent an
      in-flight deal at all, so the engine has nothing to rank — and that is the
      correct output rather than a defect.

   2. FINANCE_BLOCKED IS SHOWN AS STRUCTURALLY UNREACHABLE, NEVER AS AN EMPTY
      BUCKET. finance_quotes has thirty-five columns and not one records a
      lender's decision, and the table holds no live rows; either would be fatal
      on its own. The state exists in the vocabulary so the prerequisite that
      would unlock it can be named. A bucket showing "0" would say the opposite:
      that the engine looked and found none.

   3. EVERY REFUSAL CARRIES ITS REASON, IN THE ENGINE'S OWN WORDS. Nothing on
      this page paraphrases a verdict_basis. A paraphrase would be a second copy
      of a business fact that drifts the first time the view is edited.

   4. A MISSING FIGURE IS THE ENGINE'S STATE WORD PLUS THE ENGINE'S REASON.
      deal_value_aed is NULL on seven of the eight candidates, with states
      UNKNOWN_NO_LINK and NOT_APPLICABLE that mean different things — a value
      nobody can compute, and a question that does not apply. Neither renders as
      a dash and neither renders as zero. */

import { db } from '../lib/data.js';
import { aed, dubaiStamp, esc, num, pill } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty } from '../lib/states.js';
import { tenantLabel, tenantState } from '../lib/tenant.js';
import { kpi, panel, table } from '../lib/ui.js';

/* ── Small local vocabulary ───────────────────────────────────────────────── */
const str = v => String(v == null ? '' : v).trim();
const up  = v => str(v).toUpperCase();
const n0  = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const plural = (c, one, many) => (Number(c) === 1 ? one : many);
const muted  = h => `<div class="cell-sub">${h}</div>`;
const hot    = h => `<div class="cell-sub t-hot">${h}</div>`;
const bold   = h => `<div style="font-weight:600">${h}</div>`;
const wrap   = h => `<div style="white-space:normal">${h}</div>`;
const mono   = v => `<span class="mono">${esc(str(v))}</span>`;

const readFailed = (what, err) =>
  hot(`${esc(what)} could not be read (${esc(str(err && err.message) || 'no reason given')}), so nothing is claimed `
    + 'here and nothing is ruled out.');

/* The only way an unknown renders here: the engine's own state word, then the
   engine's own reason. A dash in the Value column of a deal screen reads as
   "worth nothing", and this engine has never said that about anything. */
const unknownCell = (state, reason) =>
  `<span class="pill unknown"><span class="dot"></span>${esc(str(state) || 'UNKNOWN')}</span>`
  + muted(esc(str(reason)) || 'The engine records no reason for this state, which is itself a gap.');

const shared = make => {
  let p = null;
  return () => {
    if (!p) { p = make(); p.catch(() => { p = null; }); }
    return p;
  };
};
const settle = pr => pr.then(v => ({ v, err: null }), e => ({ v: null, err: e }));

const linkBtn = (id, label) => (SCREENS[id]
  ? `<button class="btn sm" data-go="${esc(id)}">${esc(label)}</button>`
  : `<button class="btn sm ghost" disabled title="${esc(label)} is not part of this build: the navigation offers the screen and no module in this bundle registers it.">${esc(label)} — not in this build</button>`);
const wireGo = card => {
  card.querySelectorAll('[data-go]').forEach(b => {
    if (b.disabled) return;
    b.addEventListener('click', () => go(b.dataset.go));
  });
};

/* ══════════════════════════════════════════════════════════════════════════
   The screen
   ══════════════════════════════════════════════════════════════════════════ */
SCREENS.dealrescue = async host => {
  const readDeals = shared(() => db('v_deal_rescue'
    + '?select=deal_evidence,deal_evidence_ref,deal_evidence_source,customer_label,lead_id,identity_state,'
    + 'identity_basis,evidence_tier,admission_basis,deal_evidence_at,last_movement_at,days_since_movement,'
    + 'at_risk_days,stalled_days,settings_are_defaults,state,state_basis,recommended_action,action_reason,'
    + 'owner_name,owner_state,owner_note,deal_value_aed,deal_value_state,deal_value_basis,'
    + 'margin_at_stake_state,margin_at_stake_basis,confidence,confidence_basis,lead_recovery_state,silence_state,'
    + 'silence_detector_state,silence_detector_note,human_approval_required,automation_state,automation_note,'
    + 'action_lane_state,action_lane_note,computed_at'
    + '&limit=200'));

  const readCandidates = shared(() => db('v_deal_rescue_candidates'
    + '?select=candidate_kind,candidate_ref,customer_label,source_table,observed_at,lead_id,identity_state,'
    + 'identity_basis,verdict,evidence_tier,verdict_basis,deal_value_aed,deal_value_state,deal_value_basis'
    + '&order=candidate_kind.asc,observed_at.desc&limit=500'));

  const readReadiness = shared(() => db('v_deal_rescue_readiness'
    + '?select=id,sort,requirement,kind,unlocks,unlocks_states,platform_evidence,why_not_code,met_now,measured_now,'
    + 'measured_at'
    + '&order=sort.asc&limit=100'));

  const readStates = shared(() => db('v_deal_rescue_state_model'
    + '?select=state,sort,meaning,engine_can_produce,blocked_by,requires,deals_in_state_now,observation'
    + '&order=sort.asc&limit=100'));

  /* ── Derivations, once, in one place ──────────────────────────────────── */
  const candFacts = rows => {
    const cands = rows || [];
    /* The view's own admission rule: only IN_FLIGHT_DEAL reaches the engine.
       Partitioning on that one value handles every other verdict by complement,
       including a verdict nobody here has heard of yet. */
    const admitted = cands.filter(k => up(k.verdict) === 'IN_FLIGHT_DEAL');
    const refused  = cands.filter(k => up(k.verdict) !== 'IN_FLIGHT_DEAL');
    const kinds = new Map();
    cands.forEach(k => {
      const key = str(k.candidate_kind) || 'UNTYPED';
      kinds.set(key, (kinds.get(key) || 0) + 1);
    });
    const verdicts = new Map();
    cands.forEach(k => {
      const key = str(k.verdict) || 'NO VERDICT RECORDED';
      verdicts.set(key, (verdicts.get(key) || 0) + 1);
    });
    const sources = new Set(cands.map(k => str(k.source_table)).filter(Boolean));
    const valued = cands.filter(k => n0(k.deal_value_aed) != null);
    return { cands, admitted, refused, kinds, verdicts, sources, valued };
  };

  const readyFacts = rows => {
    const reqs = rows || [];
    /* met_now is NULL where there was nothing to measure, and the view says so:
       unknown is not met, and a caller who can see no rows must not be told a
       requirement is satisfied. Three buckets, never two. */
    const met = reqs.filter(p => p.met_now === true);
    const unmet = reqs.filter(p => p.met_now === false);
    const unmeasured = reqs.filter(p => p.met_now !== true && p.met_now !== false);
    const kinds = new Map();
    reqs.forEach(p => {
      const key = str(p.kind) || 'UNTYPED';
      kinds.set(key, (kinds.get(key) || 0) + 1);
    });
    return { reqs, met, unmet, unmeasured, kinds,
      next: unmet[0] || unmeasured[0] || null,
      measuredAt: reqs.length ? reqs[0].measured_at : null };
  };

  /* ══════════════════════════════════════════════════════════════════════
     P1 · There is nothing in flight, and here is why that is a schema fact
     ══════════════════════════════════════════════════════════════════════ */
  panel(host, {
    title: 'Deals in flight',
    sub: 'A deal this engine can rank is one this database can represent while it is still happening. Today it cannot '
       + 'represent one at all',
    actions: linkBtn('deals', 'Open Deals') + ' ' + linkBtn('revenue', 'Open Revenue Recovery'),
    load: async () => {
      const [d, c, r, s] = await Promise.all([settle(readDeals()), settle(readCandidates()),
                                             settle(readReadiness()), settle(readStates())]);
      if (d.err && c.err && r.err && s.err) throw d.err;
      return { d, c, r, s };
    },
    render: ({ d, c, r, s }) => {
      const deals = d.err ? null : (d.v || []);
      const K = c.err ? null : candFacts(c.v);
      const R = r.err ? null : readyFacts(r.v);
      const states = s.err ? null : (s.v || []);
      const unreachable = states ? states.filter(x => x.engine_can_produce === false) : null;

      const dealTile = deals == null
        ? kpi('Deals in flight', num(null), readFailed('The Deal Rescue engine', d.err))
        : kpi('Deals in flight', num(deals.length),
            muted(deals.length
              ? 'Each is listed below, ranked by what it is stuck on.'
              : 'No deal record exists while a deal is still in progress. The sale record is written at the moment of '
                + 'sale, so deal-created and sale-confirmed are one event here and there is no in-flight period for '
                + 'this engine to observe. That is the schema answering, not the engine failing.'),
            deals.length ? 't-hot' : '');

      const candTile = K
        ? kpi('Candidates examined', num(K.cands.length),
            muted(`Every row that could plausibly have been called a deal, across `
              + `${num(K.sources.size)} source ${plural(K.sources.size, 'table', 'tables')}. `
              + `${num(K.admitted.length)} ${plural(K.admitted.length, 'was', 'were')} admitted; `
              + `${num(K.refused.length)} ${plural(K.refused.length, 'carries', 'carry')} a recorded reason for not `
              + 'being a deal.'))
        : kpi('Candidates examined', num(null), readFailed('The candidate list', c.err));

      const readyTile = R
        ? kpi('Prerequisites met', `${num(R.met.length)} / ${num(R.reqs.length)}`,
            muted((R.met.length === 0
                ? 'None of them. This engine is blocked on schema and integrations rather than on code. '
                : 'Measured live against the schema on this read, not asserted. ')
              + (R.unmeasured.length
                  ? `${num(R.unmeasured.length)} ${plural(R.unmeasured.length, 'requirement', 'requirements')} could `
                    + 'not be measured at all and ' + plural(R.unmeasured.length, 'is', 'are')
                    + ' counted as neither met nor unmet — unknown is not met.'
                  : 'Every requirement could be measured.')),
            R.met.length === 0 ? 't-hot' : '')
        : kpi('Prerequisites met', num(null), readFailed('The readiness list', r.err));

      const stateTile = states == null
        ? kpi('States with no branch at all', num(null), readFailed('The state model', s.err))
        : kpi('States with no branch at all', num(unreachable.length),
            muted(unreachable.length
              ? `Of ${num(states.length)} ${plural(states.length, 'state', 'states')} in this engine&rsquo;s `
                + `vocabulary. No code path can produce ${plural(unreachable.length, 'it', 'them')}, and none may be `
                + 'written until the blocker named against it is cleared. They are not empty buckets.'
              : 'Every state in the vocabulary has a branch behind it.'),
            unreachable.length ? 't-hot' : '');

      const empty = (deals && !deals.length)
        ? `<div class="banner info" style="margin-top:16px">
             <span class="material-symbols-outlined" style="font-size:20px">handyman</span>
             <div>
               ${bold('Nothing is at risk, and that is not the same as everything being healthy.')}
               ${muted('This engine ranks deals that are in progress. This database records a sale at the moment it '
                 + 'closes and nothing before it, so there is no in-progress deal anywhere for it to see — not one '
                 + 'that is fine, and not one that is stuck. Reading this page as "no deals at risk" would be reading '
                 + 'a silence as an all-clear.')}
               ${muted('What is below instead: everything that was examined and refused, with the reason; the states '
                 + 'this engine can and cannot reach; and the list of things that would have to exist before it has '
                 + 'anything to rank.')}
             </div>
           </div>`
        : '';

      return `<div class="grid g4">${dealTile}${candTile}${readyTile}${stateTile}</div>` + empty;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P2 · Everything examined, and why each one is not a deal
     ══════════════════════════════════════════════════════════════════════ */
  panel(host, {
    title: 'Everything examined, and why it is not a deal',
    sub: 'This is the engine declining to invent a deal lifecycle. Each row was considered as evidence that something '
       + 'is in flight, and each verdict is recorded with its reason',
    actions: linkBtn('leadrecovery', 'Open Lead Recovery') + ' ' + linkBtn('actions', 'Open Action Center'),
    load: () => readCandidates(),
    render: rows => {
      const K = candFacts(rows);
      if (!K.cands.length) {
        return stateEmpty('Nothing was examined',
          'The candidate view returned no rows at all, so this engine found nothing it could even consider — which is '
          + 'not the same as considering things and clearing them. Nothing is being claimed about whether a deal '
          + 'exists.', 'search');
      }

      const body = table([
        { label: 'What it is', strong: true, render: k =>
            wrap(`<div>${esc(str(k.customer_label) || str(k.candidate_ref) || 'unnamed row')}</div>`)
            + muted(`${esc(str(k.candidate_kind))} &middot; <span class="mono">${esc(str(k.source_table))}</span>`
              + (k.observed_at ? ` &middot; ${esc(dubaiStamp(k.observed_at))}` : '')) },
        { label: 'Verdict', render: k => (up(k.verdict) === 'IN_FLIGHT_DEAL'
            ? pill(str(k.verdict), 'ok', { verbatim: true })
            : pill(str(k.verdict) || 'NO VERDICT RECORDED', '', { verbatim: true })) },
        { label: 'Why it is not a deal', render: k => wrap(muted(esc(str(k.verdict_basis))
            || 'The engine records no reason for this verdict, which is itself a gap — a refusal without a reason is '
              + 'not a refusal anybody can check.')) },
        { label: 'Who it is', render: k => (k.lead_id != null
            ? `<div>Lead #${esc(str(k.lead_id))}</div>`
              + muted(esc(str(k.identity_basis)) || 'No identity basis is recorded.')
            : unknownCell(k.identity_state, k.identity_basis)) },
        { label: 'Evidence tier', render: k => (str(k.evidence_tier)
            ? pill(str(k.evidence_tier), '', { verbatim: true })
            : muted('No tier. Only an admitted deal is graded, so a refused candidate carries none — that is the '
                + 'absence of a grade, not a low one.')) },
        { label: 'Value', align: 'r', render: k => (n0(k.deal_value_aed) != null
            ? `<div>${aed(k.deal_value_aed)}</div>` + muted(esc(str(k.deal_value_state)))
            : unknownCell(k.deal_value_state, str(k.deal_value_basis).replace(/^UNKNOWN\.\s*/i, ''))) },
      ], K.cands);

      const verdictSummary = `<div class="section" style="margin-top:16px">
          <div class="label-caps">The verdicts, counted</div>
          ${table([
            { label: 'Verdict', strong: true, render: v => mono(v.k) },
            { label: 'Candidates', align: 'r', render: v => num(v.n) },
            { label: 'Reaches the engine?', render: v => (up(v.k) === 'IN_FLIGHT_DEAL'
                ? pill('Admitted', 'ok', { verbatim: false })
                : pill('Refused', 'hot', { verbatim: false })) },
          ], [...K.verdicts.entries()].map(([k, n]) => ({ k, n })))}
        </div>`;

      const kindSummary = muted(`Examined across ${num(K.sources.size)} source `
        + `${plural(K.sources.size, 'table', 'tables')}: `
        + [...K.kinds.entries()].map(([k, n]) => `${num(n)} &times; <span class="mono">${esc(k)}</span>`).join(', ')
        + `. ${num(K.valued.length)} of ${num(K.cands.length)} carry a monetary figure at all, and where one is `
        + 'present it is what that row actually records — a confirmed sale amount is confirmed revenue, never a value '
        + 'at stake.');

      return body + verdictSummary + `<div class="section">${kindSummary}</div>`;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P3 · The state vocabulary, and the one state that has no branch
     ══════════════════════════════════════════════════════════════════════ */
  panel(host, {
    title: 'Every state this engine may return',
    sub: 'A state with no branch behind it and a state with a branch and no rows are two different findings, and this '
       + 'engine records which is which',
    load: () => readStates(),
    render: rows => {
      const states = rows || [];
      if (!states.length) {
        return stateEmpty('The state model returned no rows',
          'This engine publishes its own vocabulary and none came back, so this screen cannot say what it is able to '
          + 'say. That is a missing reference table, not a finding about deals.', 'checklist');
      }
      const noBranch = states.filter(s => s.engine_can_produce === false);
      const noRows   = states.filter(s => s.engine_can_produce !== false && !n0(s.deals_in_state_now));

      const body = table([
        { label: 'State', strong: true, render: s =>
            pill(str(s.state), s.engine_can_produce === false ? 'hot' : 'ok', { verbatim: true })
            + muted(wrap(esc(str(s.meaning)) || 'No meaning is recorded for this state.')) },
        { label: 'Observation', render: s => pill(str(s.observation) || 'UNKNOWN', '', { verbatim: true }) },
        { label: 'Deals in it now', align: 'r', render: s => (s.engine_can_produce === false
            /* NOT a zero. A count of zero would say the engine looked and found
               none; no branch exists, so it never looked and never could. */
            ? `<span class="pill unknown"><span class="dot"></span>NO BRANCH</span>`
            : n0(s.deals_in_state_now) != null
              ? num(s.deals_in_state_now)
              : '<span class="t-muted">not counted</span>') },
        { label: 'What it would take', render: s => wrap(muted(esc(str(s.requires))
            || 'The engine records no requirement for this state.')) },
      ], states);

      /* The unreachable states get their own block. Inside a table row,
         "FINANCE_BLOCKED · 0" is indistinguishable from a bucket that was
         checked and found empty, and those are opposite claims. */
      const blocked = noBranch.length
        ? noBranch.map(s => `<div class="banner warm" style="margin-top:12px">
             <span class="material-symbols-outlined" style="font-size:20px">block</span>
             <div>
               ${bold(`${esc(str(s.state))} is unreachable by design — it is not an empty bucket.`)}
               ${muted(`Blocked by <span class="mono">${esc(str(s.blocked_by) || 'not stated')}</span>. `
                 + esc(str(s.requires) || 'The engine records no requirement for this state.'))}
               ${muted('No branch of this engine returns it and none has been written. A bucket showing zero here '
                 + 'would say the engine looked and found nothing, which is the opposite of what is true.')}
             </div></div>`).join('')
        : '';

      const note = muted(`${num(states.length)} ${plural(states.length, 'state is', 'states are')} defined. `
        + `${num(noBranch.length)} ${plural(noBranch.length, 'has', 'have')} no branch at all; `
        + `${num(noRows.length)} ${plural(noRows.length, 'has a branch that works and nothing in it', 'have branches that work and nothing in them')}. `
        + 'Do not read a zero as evidence a branch is broken, or a branch as evidence of data.');

      return body + blocked + `<div class="section" style="margin-top:16px">${note}</div>`;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P4 · The purchase order
     ══════════════════════════════════════════════════════════════════════ */
  panel(host, {
    title: 'What would have to exist before this engine has anything to rank',
    sub: 'A purchase order, not a wish list. Every row names the live evidence that it is missing, and every '
       + 'measurable one is re-measured on each read so this list cannot quietly go stale',
    load: () => readReadiness(),
    render: rows => {
      const R = readyFacts(rows);
      if (!R.reqs.length) {
        return stateEmpty('No prerequisites are recorded',
          'The readiness view is empty, so this screen cannot say what is blocking the engine — and an unstated '
          + 'blocker is not an absent one.', 'checklist');
      }

      const body = table([
        { label: 'Requirement', strong: true, render: p =>
            wrap(`<div>${esc(str(p.requirement))}</div>`)
            + muted(`<span class="mono">${esc(str(p.id))}</span> &middot; ${esc(str(p.kind))}`) },
        { label: 'Met', render: p => (p.met_now === true
            ? pill('Met', 'ok', { verbatim: false })
            : p.met_now === false
              ? pill('Not met', 'hot', { verbatim: false })
              /* NULL is its own answer. The view's comment is explicit: unknown
                 is not met, and a caller who can see no rows must not be told a
                 requirement is satisfied. */
              : pill('Not measurable', 'unknown', { verbatim: false })) },
        { label: 'Measured on this read', render: p => wrap(muted(esc(str(p.measured_now))
            || 'The view returned no measurement for this prerequisite, so whether it is met is unknown rather than '
              + 'unmet.')) },
        { label: 'What it unlocks', render: p => wrap(muted(esc(str(p.unlocks))
            || 'The engine records nothing that this would unlock.')
            + (Array.isArray(p.unlocks_states) && p.unlocks_states.length
                ? muted('States: ' + p.unlocks_states.map(v => `<span class="mono">${esc(str(v))}</span>`).join(', '))
                : '')) },
        { label: 'Why it is not just code', render: p => wrap(muted(esc(str(p.why_not_code))
            || 'The engine records no account of why this is not a coding task.')) },
      ], R.reqs);

      const evidence = `<div class="section" style="margin-top:16px">
          <div class="label-caps">The live evidence behind each of those, as the engine measured it</div>
          ${table([
            { label: 'Requirement', strong: true, render: p => mono(p.id) },
            /* Two rows, not one, and the split is the point. `platform_evidence`
               is what is true of NEXUS for every dealership alike; `measured_now`
               is what is true of THIS dealership, counted on this read through
               its own row-level security. They used to be one column called
               evidence_today, which stored ALBA CARS' counts and printed them to
               whoever opened the screen - see migration 20260906070947. */
            { label: 'What is true of NEXUS, for every dealership',
              render: p => wrap(muted(esc(str(p.platform_evidence))
                || 'The engine records nothing about the platform against this requirement.')) },
            { label: 'What is true of this dealership, measured on this read',
              render: p => wrap(muted(esc(str(p.measured_now))
                || 'Not measured. That is not the same as met.')) },
          ], R.reqs)}
        </div>`;

      const kinds = [...R.kinds.entries()]
        .map(([k, n]) => `${num(n)} ${esc(k.toLowerCase())}`).join(', ');
      const note = muted(`${num(R.met.length)} of ${num(R.reqs.length)} `
        + `${plural(R.reqs.length, 'requirement is', 'requirements are')} met (${kinds}). `
        + (R.unmeasured.length
            ? `${num(R.unmeasured.length)} could not be measured and ${plural(R.unmeasured.length, 'is', 'are')} `
              + 'reported as unknown rather than folded in with the unmet ones. '
            : '')
        + 'None of the outstanding ones is a coding task waiting on somebody: they are a deal record that starts when '
        + 'a deal starts, an appointments feed, a lender decision, and a hard link from a sale to the unit that was '
        + 'sold — systems the sales floor already uses, writing down what they already know.'
        + (R.measuredAt ? ` Measured ${esc(dubaiStamp(R.measuredAt))}.` : ''));

      return body + evidence + `<div class="section">${note}</div>`;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P5 · The desk itself, and the provenance of this page
     ══════════════════════════════════════════════════════════════════════ */
  panel(host, {
    title: 'The rescue desk',
    sub: 'What this engine would show for an admitted deal, and where this page stands today',
    load: async () => {
      const [d, c, r] = await Promise.all([settle(readDeals()), settle(readCandidates()), settle(readReadiness())]);
      if (d.err && c.err && r.err) throw d.err;
      return { d, c, r };
    },
    render: ({ d, c, r }) => {
      const deals = d.err ? null : (d.v || []);
      const K = c.err ? null : candFacts(c.v);
      const R = r.err ? null : readyFacts(r.v);

      const desk = deals == null
        ? `<div class="section">${readFailed('The Deal Rescue engine', d.err)}</div>`
        : table([
            { label: 'Customer', strong: true, render: x =>
                `<div>${esc(str(x.customer_label) || 'not named')}</div>`
                + muted(x.lead_id != null
                    ? `Lead #${esc(str(x.lead_id))} &middot; ${esc(str(x.identity_basis) || 'no identity basis')}`
                    : esc(str(x.identity_state) || 'identity not stated')) },
            { label: 'State', render: x => pill(str(x.state) || 'UNKNOWN', '', { verbatim: true })
                + muted(wrap(esc(str(x.state_basis)) || 'No basis is recorded for this state.')) },
            { label: 'Stuck for', align: 'r', render: x => (n0(x.days_since_movement) != null
                ? `<div>${num(x.days_since_movement)} d</div>`
                  + muted(`at risk past ${num(x.at_risk_days)} d, stalled past ${num(x.stalled_days)} d`)
                : '<span class="t-muted">no movement recorded</span>') },
            { label: 'Value at stake', align: 'r', render: x => (n0(x.deal_value_aed) != null
                ? aed(x.deal_value_aed)
                : unknownCell(x.deal_value_state, str(x.deal_value_basis).replace(/^UNKNOWN\.\s*/i, ''))) },
            { label: 'Margin at stake', render: x => unknownCell(x.margin_at_stake_state, x.margin_at_stake_basis) },
            { label: 'Owner', render: x => (up(x.owner_state) === 'ASSIGNED'
                ? `<div>${esc(str(x.owner_name) || 'assigned, unnamed')}</div>`
                : unknownCell(x.owner_state, x.owner_note)) },
            { label: 'Next action', render: x => pill(str(x.recommended_action) || 'NONE', '', { verbatim: true })
                + muted(esc(str(x.action_reason)) || 'No reason is recorded for this recommendation.') },
          ], deals, {
            empty: stateEmpty('The desk is empty because the engine admits no deal',
              'Every candidate was refused with a reason, and those reasons are listed above. This is not a queue '
              + 'somebody has cleared and it is not a queue that failed to load — it is a queue that cannot have '
              + 'anything in it while no record of an in-flight deal exists.', 'handyman'),
          });

      /* ── The provenance strip ─────────────────────────────────────────── */
      const t = tenantState();
      const label = tenantLabel(t);
      const tenantLine = !t.loaded
        ? 'Still being read.'
        : !t.ok
          ? `The membership read failed (${esc(str(t.error))}), so this page cannot say which dealership these rows `
            + 'belong to. It is not a claim that they belong to none.'
          : label
            ? `${esc(label)}. Every row above is scoped by the database against this account, not filtered by this screen.`
            : 'This account has a membership with no readable dealership name.';

      const strip = [
        ['Evidence', K
          ? `${num(K.cands.length)} ${plural(K.cands.length, 'candidate', 'candidates')} examined across `
            + `${num(K.sources.size)} source ${plural(K.sources.size, 'table', 'tables')}, each with a recorded `
            + `verdict. ${num(K.admitted.length)} met the admission rule.`
          : 'The candidate list could not be read, so what was examined is not stated.'],
        ['Confidence', deals && deals.length
          ? `Graded per deal, with the basis printed beside it: `
            + esc([...new Set(deals.map(x => str(x.confidence)).filter(Boolean))].join(', ') || 'none recorded')
          : 'No deal is admitted, so no confidence is graded. That is the absence of a grade, not a low one.'],
        ['Data coverage', R
          ? `${num(R.met.length)} of ${num(R.reqs.length)} prerequisites met`
            + (R.unmeasured.length ? `, ${num(R.unmeasured.length)} not measurable` : '')
            + '. Each was re-measured against the live schema when this panel loaded.'
          : 'Not established — the readiness list could not be read.'],
        ['Unknown', 'Whether any deal is actually in progress on the sales floor right now. Nothing in this database '
          + 'records a deal before it closes, so the honest answer is that NEXUS cannot see — not that there are none.'],
        ['Last updated', R && R.measuredAt
          ? `${esc(dubaiStamp(R.measuredAt))}. These are views, recomputed on read rather than refreshed on a schedule.`
          : deals && deals.length && deals[0].computed_at
            ? `${esc(dubaiStamp(deals[0].computed_at))}.`
            : 'Not stated on this render.'],
        ['Tenant', tenantLine],
        ['Action', R && R.next
          ? `Nothing here is waiting on a decision. The next thing that would change this page is `
            + `<span class="mono">${esc(str(R.next.id))}</span> — ${esc(str(R.next.requirement))}`
          : 'Not established on this render.'],
      ];

      const stripHtml = `<div class="section" style="margin-top:16px">
          <div class="label-caps">Where this page stands</div>
          <dl class="kv">${strip.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
        </div>`;

      const settings = (deals && deals.length && deals.some(x => x.settings_are_defaults === true))
        ? `<div class="banner info">${muted('The at-risk and stalled windows above are this product&rsquo;s defaults '
            + 'rather than windows this dealership has set.')}</div>`
        : '';

      return desk + settings + stripHtml;
    },
  }).then(wireGo);
};
