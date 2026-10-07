/* NEXUS OS — screens/policy.js
   THE POLICY ENGINE. Every threshold this product applies to a customer is
   meant to be data with a source, an effective date and an owner — never a
   constant in the code. This screen is how far that has got, and it is
   deliberately uncomfortable reading.

   THE ONE FINDING THAT IS NOT A NUMBER. The Finance Calc workflow sends a
   customer-facing sentence over WhatsApp — "Min 20% down payment, max 60 months
   (UAE Central Bank rules)" — which names a regulator and rests on two
   constants nobody in this project has checked against the instrument. Every
   other row in the migration backlog is a figure; that one is a sentence
   asserting the law. The engine says so in its own words and this screen prints
   them.

   WHERE EVERYTHING COMES FROM — nothing below is computed in this file
     v_policy_rule                 every rule VERSION this dealership can see,
                                   each labelled with whether it may be relied
                                   on today and, in plain words, why not.
     v_policy_authoritative        the safe read: only versions that state a
                                   value, are in force, are inside their
                                   effective span and were verified against a
                                   named source. A rule that is missing,
                                   unverified, expired or disputed is simply
                                   ABSENT here, so a consumer that finds no row
                                   must handle "unknown" and cannot silently
                                   receive a value it should not trust.
     v_policy_unmigrated_constant  the migration backlog: every jurisdiction or
                                   commercial constant still hard-coded, with its
                                   exact file and line, whether it reaches a
                                   customer, and what state its migration is in.

   ═══════════════════════════════════════════════════════════════════════════
   FIVE RULES THIS SCREEN IS BUILT AROUND
   ═══════════════════════════════════════════════════════════════════════════

   1. VERIFICATION AND LIFECYCLE ARE ORTHOGONAL AND ARE SHOWN SEPARATELY.
      `status` says whether a version is in force. `verification_status` says
      whether a human has checked it against its source. A rule can be ACTIVE
      and NOT_VERIFIED — that is the honest description of a constant the code
      already obeys and nobody has sourced — and collapsing the two axes into
      one "healthy / unhealthy" badge would hide exactly the rows that matter.

   2. THE CITATION IS THE POINT, SO IT IS RENDERED. Four of the seeded rules
      cite "A constant in this codebase — NOT a central bank" with a file and a
      line number. That sentence is the most useful thing on this screen: it
      says out loud that the product's own source for a regulatory figure is the
      product. It is printed verbatim, in full, never abbreviated to a tick.

   3. THE 21 CONSTANTS ARE A WORK ORDER, ORDERED BY WHO SEES THEM. Customer-
      facing items sort first because the risk is not that a number is wrong —
      it is that a wrong number reaches a buyer with a regulator's name attached.
      The ordering is the engine's own `reaches_a_customer` flag, not a rank
      invented here.

   4. AN EMPTY SAFE READ IS A FINDING, NOT A BLANK PANEL. v_policy_authoritative
      holding no rows means every consumer asking this engine for a value gets
      nothing — which is the system refusing rather than the system failing, and
      is the correct behaviour. It is stated in those words.

   5. A COUNT OF ZERO IS ONLY EVER A COUNT OF ROWS THIS ACCOUNT COULD READ.
      Every figure below names its denominator. Where a vocabulary value has no
      rows, the cell says "none" against the version count it was measured over
      — it never implies the value cannot occur. */

import { db, dbWrite, onIdentityChange } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { dubaiDate, dubaiStamp, esc, num, pill } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { openModal } from '../lib/modal.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { tenantLabel, tenantState } from '../lib/tenant.js';
import { closeDrawer, kpi, openDrawer, panel, table } from '../lib/ui.js';

/* ── Small local vocabulary ───────────────────────────────────────────────── */
const str = v => String(v == null ? '' : v).trim();
const up  = v => str(v).toUpperCase();
const n0  = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const plural = (c, one, many) => (Number(c) === 1 ? one : many);
const muted  = h => `<div class="ds-cell-sub">${h}</div>`;
const hot    = h => `<div class="ds-cell-sub t-hot">${h}</div>`;
const bold   = h => `<div style="font-weight:600">${h}</div>`;
const wrap   = h => `<div style="white-space:normal">${h}</div>`;
const mono   = v => `<span class="mono">${esc(str(v))}</span>`;

const readFailed = (what, err) =>
  hot(`${esc(what)} could not be read (${esc(str(err && err.message) || 'no reason given')}), so nothing is claimed `
    + 'here and nothing is ruled out.');

/* ── The two closed vocabularies ────────────────────────────────────────────
   These are the CHECK constraints on public.policy_rule —
   `policy_rule_verification_status_check` and `policy_rule_status_check` — and
   they are listed here for one reason only: so that a value with NO ROWS can
   still be shown as a state that exists and is unoccupied. Counting only the
   values present would silently drop VERIFIED from the screen on the exact day
   it matters most, which is the day before the first rule is verified.

   Nothing branches on these lists. Every rule row is rendered with its own word
   printed verbatim, so a value the database gains tomorrow appears on this
   screen without an edit — it simply also gets a row of its own in the matrix
   under "not in this product's vocabulary", which is a finding rather than a
   blank. */
const VERIFICATION_WORDS = ['VERIFIED', 'NOT_VERIFIED', 'UNKNOWN', 'DISPUTED'];
const LIFECYCLE_WORDS = ['DRAFT', 'ACTIVE', 'SUPERSEDED', 'WITHDRAWN'];
/* ── The reader's word for each state ───────────────────────────────────────
   Added 5 Sep 2026. The State column printed the database's own token —
   `NOT_VERIFIED`, `SUPERSEDED` — as the row label, which is our vocabulary and
   not a dealership's. The verbatim principle this file is built on stays
   intact and is the reason this is a LABEL map rather than a rewrite: a state
   nobody here has heard of still appears, still under its own stored spelling,
   because a token with no entry falls through to itself. `verbatim` on the
   pill is a claim about PROVENANCE, so it is now true only where the label IS
   the stored word — a translated one is our wording, not the database's. */
const VERIFICATION_LABEL = {
  VERIFIED: 'Checked', NOT_VERIFIED: 'Not checked', UNKNOWN: 'Never stated', DISPUTED: 'Disputed',
};
const LIFECYCLE_LABEL = {
  DRAFT: 'Draft', ACTIVE: 'In force', SUPERSEDED: 'Replaced', WITHDRAWN: 'Withdrawn',
};
const stateLabel = (w, map) => map[w] || w;

const VERIFICATION_MEANS = {
  VERIFIED: 'A person read the named source, cited it, dated it and signed for it. Only these reach the safe read.',
  NOT_VERIFIED: 'A value is recorded and nobody has checked it against a source. It describes what this system does, '
    + 'not what the law or the lender says.',
  UNKNOWN: 'No value has ever been stated. The row is registered as a question, not as an answer — nothing may be '
    + 'computed from it.',
  DISPUTED: 'Somebody has challenged this value and the challenge is unresolved. It may not be relied on while that '
    + 'stands.',
};
const LIFECYCLE_MEANS = {
  DRAFT: 'Written down and not yet in force.',
  ACTIVE: 'In force today. Says nothing about whether anybody has checked it.',
  SUPERSEDED: 'Replaced by a later version. Kept so a decision taken last March can still be explained.',
  WITHDRAWN: 'Taken out of force without a replacement.',
};

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
/* A confirmation that has to survive the re-render a write triggers (go()
   runs this screen again from scratch). Cleared on a change of signed-in
   identity, same as screens/actions.js. */
let NOTICE = null;
onIdentityChange(() => { NOTICE = null; });

SCREENS.policy = async host => {
  /* `.ds-screen` is the class lib/design-system.css gates its handful of
     upgrades to existing chrome behind. It goes on a wrapper this screen
     appends, and NOT on `#screen`, because lib/nav.js empties `#screen` between
     renders without touching its classes: a class set there would follow the
     operator onto Leads or Money Leaks and restyle a screen nobody converted.
     A wrapper cannot leak — go() removes it with the rest of the subtree. Same
     pattern as screens/inventory.js, screens/leads.js, screens/overview.js,
     screens/money-leaks.js, screens/conversations.js and screens/setup.js. */
  const root = el('div', 'ds-screen');
  host.appendChild(root);
  if (NOTICE) {
    const n = el('div');
    n.innerHTML = `<div class="banner info"><span class="material-symbols-outlined">check_circle</span><div>${NOTICE}</div></div>`;
    root.appendChild(n);
    NOTICE = null;
  }

  const readRules = shared(() => db('v_policy_rule'
    + '?select=id,is_global_rule,jurisdiction,rule_type,rule_name,version,value_numeric,value_text,unit,value_kind,'
    + 'value_display,status,verification_status,confidence,effective_from,effective_to,source_name,source_url,'
    + 'source_document,verification_date,verified_by,added_by,added_at,updated_at,notes,authority,authority_reason,'
    + 'may_be_relied_on'
    + '&order=rule_type.asc,rule_name.asc,version.desc&limit=500'));

  const readAuthoritative = shared(() => db('v_policy_authoritative'
    + '?select=id,jurisdiction,rule_type,rule_name,version,value_display,unit,value_kind,effective_from,effective_to,'
    + 'source_name,source_url,source_document,verification_date,verified_by,confidence,citation'
    + '&order=rule_type.asc,rule_name.asc&limit=500'));

  const readConstants = shared(() => db('v_policy_unmigrated_constant'
    + '?select=layer,kind,location,snippet,current_value,reaches_a_customer,proposed_rule_type,proposed_rule_name,'
    + 'seeded_as_rule,rule_row_exists,rule_is_authoritative,migration_state,note,surveyed_on'
    + '&order=reaches_a_customer.desc,layer.asc,location.asc&limit=500'));

  /* ── Derivations, once, in one place ──────────────────────────────────── */
  const ruleFacts = rows => {
    const rules = rows || [];
    /* Partitioned on the engine's own boolean, not on the spelling of a status.
       may_be_relied_on is the single judgement this screen colours anything by;
       a verification word nobody here has heard of still lands correctly. */
    const reliable = rules.filter(k => k.may_be_relied_on === true);
    const verified = rules.filter(k => up(k.verification_status) === 'VERIFIED');
    const valued   = rules.filter(k => str(k.value_display));
    const questions = rules.filter(k => !str(k.value_display));
    const byVerification = new Map();
    const byLifecycle = new Map();
    rules.forEach(k => {
      const v = up(k.verification_status) || 'NOT RECORDED';
      const s = up(k.status) || 'NOT RECORDED';
      byVerification.set(v, (byVerification.get(v) || 0) + 1);
      byLifecycle.set(s, (byLifecycle.get(s) || 0) + 1);
    });
    /* Values the database holds that this screen's vocabulary lists do not.
       Reported rather than dropped: a state nobody here has heard of is a
       finding, and silently omitting it is how a screen goes stale. */
    const strangeV = [...byVerification.keys()].filter(v => !VERIFICATION_WORDS.includes(v));
    const strangeS = [...byLifecycle.keys()].filter(v => !LIFECYCLE_WORDS.includes(v));
    const types = new Set(rules.map(k => str(k.rule_type)).filter(Boolean));
    return { rules, reliable, verified, valued, questions, byVerification, byLifecycle, strangeV, strangeS, types };
  };

  const constFacts = rows => {
    const consts = rows || [];
    const facing = consts.filter(k => k.reaches_a_customer === true);
    const hidden = consts.filter(k => k.reaches_a_customer !== true);
    /* JURISDICTION means the constant asserts a rule somebody else owns — a
       regulator, a tax authority, a lender. That is a different kind of risk
       from a commercial threshold this dealership is entitled to choose, and
       the engine already draws the line in its own `kind` column. */
    const facingLaw = facing.filter(k => up(k.kind) === 'JURISDICTION');
    const byState = new Map();
    const byLayer = new Map();
    consts.forEach(k => {
      const s = str(k.migration_state) || 'NOT RECORDED';
      const l = str(k.layer) || 'NOT RECORDED';
      byState.set(s, (byState.get(s) || 0) + 1);
      byLayer.set(l, (byLayer.get(l) || 0) + 1);
    });
    return { consts, facing, hidden, facingLaw, byState, byLayer,
      /* Counted off the engine's own boolean rather than inferred from the
         migration state, so the two can be reported side by side and a
         disagreement between them would be visible instead of hidden. */
      noRule: consts.filter(k => k.rule_row_exists !== true),
      ready: consts.filter(k => up(k.migration_state) === 'READY_TO_MIGRATE'),
      blocked: consts.filter(k => up(k.migration_state) === 'BLOCKED_ON_VERIFICATION'),
      unrecorded: consts.filter(k => up(k.migration_state) === 'NOT_YET_RECORDED'),
      surveyed: consts.length ? consts[0].surveyed_on : null };
  };

  /* ══════════════════════════════════════════════════════════════════════
     P1 · Can anything on this page be relied on?
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'What this product is standing on',
    sub: 'Jurisdiction and commercial rules are meant to be data with a source, an effective date and an owner. These '
       + 'are the versions on record and how far any of them may be trusted',
    actions: linkBtn('compliance', 'Open Compliance') + ' ' + linkBtn('finance', 'Open Finance Desk'),
    load: async () => {
      const [r, a, c] = await Promise.all([settle(readRules()), settle(readAuthoritative()), settle(readConstants())]);
      if (r.err && a.err && c.err) throw r.err;
      return { r, a, c };
    },
    render: ({ r, a, c }) => {
      const F = r.err ? null : ruleFacts(r.v);
      const auth = a.err ? null : (a.v || []);
      const K = c.err ? null : constFacts(c.v);

      const versionsTile = F
        ? kpi('Rule versions on record', num(F.rules.length),
            muted(`Across ${num(F.types.size)} rule ${plural(F.types.size, 'domain', 'domains')}, superseded versions `
              + `included. ${num(F.valued.length)} state a value and ${num(F.questions.length)} are registered as a `
              + 'question with no value at all — a row that exists so a consumer finds an explicit unknown rather '
              + 'than nothing and a temptation to guess.'))
        : kpi('Rule versions on record', num(null), readFailed('The policy rules', r.err));

      const verifiedTile = F
        ? kpi('Verified against a source', num(F.verified.length),
            muted(F.verified.length === 0
              ? `Not one of ${num(F.rules.length)}. Every version on record is either a question or a value nobody `
                + 'has checked against the instrument it claims to come from.'
              : `Of ${num(F.rules.length)} ${plural(F.rules.length, 'version', 'versions')}. Verified means a person `
                + 'read the source, cited it, dated it and signed for it.'),
            F.verified.length === 0 ? 't-hot' : '')
        : kpi('Verified against a source', num(null), readFailed('The policy rules', r.err));

      const reliableTile = F
        ? kpi('May be relied on today', num(F.reliable.length),
            muted(F.reliable.length === 0
              ? 'No rule here is authoritative, so no customer-facing regulatory claim this product makes is currently '
                + 'backed by one. That is the engine refusing, which is what it is for.'
              : `Of ${num(F.rules.length)} ${plural(F.rules.length, 'version', 'versions')}. This is the engine's own `
                + 'judgement, not this screen&rsquo;s.'),
            F.reliable.length === 0 ? 't-hot' : '')
        : kpi('May be relied on today', num(null), readFailed('The policy rules', r.err));

      const safeTile = auth == null
        ? kpi('The safe read', num(null), readFailed('The authoritative view', a.err))
        : kpi('The safe read', num(auth.length),
            muted(auth.length === 0
              ? 'Empty. Any consumer that asks this engine for a value — policy_numeric(), policy_citation(), the VAT '
                + 'recompute — gets nothing back and must handle "unknown". That is the system refusing to hand out a '
                + 'figure it cannot stand behind, not the system failing.'
              : `${num(auth.length)} ${plural(auth.length, 'rule', 'rules')} state a value, are in force, are inside `
                + 'their effective span and were verified against a named source. Only these may be quoted.'),
            auth.length === 0 ? 't-hot' : '');

      const constTile = K
        ? kpi('Constants still in the code', num(K.consts.length),
            muted(`${num(K.facing.length)} of them reach a customer`
              + (K.facingLaw.length
                  ? `, and ${num(K.facingLaw.length)} of those `
                    + `${plural(K.facingLaw.length, 'asserts a rule', 'assert rules')} somebody else owns — a `
                    + 'regulator, a tax authority or a lender.'
                  : '.')
              + ` ${num(K.blocked.length)} ${plural(K.blocked.length, 'is', 'are')} blocked on verifying the rule `
              + `${plural(K.blocked.length, 'it', 'they')} would move to, and ${num(K.ready.length)} `
              + `${plural(K.ready.length, 'is', 'are')} ready to migrate.`),
            K.facing.length ? 't-hot' : '')
        : kpi('Constants still in the code', num(null), readFailed('The constant survey', c.err));

      /* ── The claim that is a sentence, not a number ──────────────────────
         Selected on two engine columns — it reaches a customer and it asserts
         somebody else's rule — never on a ranking invented here. Each one is
         printed with the engine's own note, and the engine's own note is what
         says which is the most urgent. */
      const urgent = K && K.facingLaw.length
        ? `<div class="banner hot" style="margin-top:16px">
             <span class="material-symbols-outlined" style="font-size:20px">gavel</span>
             <div>
               ${bold(`${num(K.facingLaw.length)} customer-facing `
                 + `${plural(K.facingLaw.length, 'figure asserts a rule this project does not own', 'figures assert rules this project does not own')}.`)}
               ${muted('Each of these is quoted to a customer on the authority of something nobody in this project '
                 + 'has read. They are listed in full further down, each with its exact file and line and the '
                 + 'engine&rsquo;s own note. Read the notes: one of these is not a number at all but a sentence '
                 + 'naming a regulator, and the engine says so itself.')}
             </div>
           </div>`
        : K
          ? `<div class="banner info" style="margin-top:16px">
               <span class="material-symbols-outlined" style="font-size:20px">gavel</span>
               <div>${muted('No constant in the survey both reaches a customer and asserts a jurisdiction rule. '
                 + 'That is what the survey records, as of the date it was taken.')}</div>
             </div>`
          : '';

      const orthogonal = `<div class="banner info" style="margin-top:16px">
          <span class="material-symbols-outlined" style="font-size:20px">rule</span>
          <div>
            ${bold('&ldquo;In force&rdquo; and &ldquo;checked&rdquo; are two different questions, and this engine keeps them apart.')}
            ${muted('One answer says whether a rule is in force. A separate one says whether a person has checked '
              + 'it against the source it names. A rule can be in force and unchecked at the same time — that is the '
              + 'honest description of a rule NEXUS already obeys and nobody has sourced — so the two are counted '
              + 'separately below and never folded into one badge.')}
          </div>
        </div>`;

      return `<div class="grid g5">${versionsTile}${verifiedTile}${reliableTile}${safeTile}${constTile}</div>`
        + urgent + orthogonal;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P2 · The two axes, counted separately
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'Checked, and in force',
    sub: 'The same versions counted twice, on the two axes that must never be merged. A state with no rows is shown as '
       + 'a state with no rows, not left off the page',
    load: () => readRules(),
    render: rows => {
      const F = ruleFacts(rows);
      if (!F.rules.length) {
        return stateEmpty('No policy rule is on record',
          'Every threshold this product applies is therefore a constant in the code with nothing standing behind it, '
          + 'and this engine cannot say what any of them should be.', 'gavel');
      }

      const axis = (words, counts, means, strange, title, caption, labels) => `<div class="section">
          <div class="label-caps">${esc(title)}</div>
          ${table([
            /* `verbatim` is a claim about PROVENANCE — that this label is a
               value the database handed us — so it is true only where a row
               actually carries the word. A vocabulary state with no rows is
               this screen naming a state that exists and is unoccupied, and
               claiming otherwise would put a false hover note on it. */
            /* Shown as words. `verbatim` now also requires that the word IS
               the stored one — for a state we have translated, the pill is our
               label and must not claim the database's provenance. */
            { label: 'State', strong: true,
              render: w => pill(w.label, w.n ? '' : 'unknown', { verbatim: w.n > 0 && w.label === w.k }) },
            { label: 'Versions', align: 'r', render: w => (w.n
                ? num(w.n)
                /* A real zero, and it says what it is a zero OF. Not a dash:
                   the state exists in this database's vocabulary and simply has
                   nothing in it right now. */
                : `<span class="t-muted">none of ${num(F.rules.length)}</span>`) },
            { label: 'What it means', render: w => wrap(muted(esc(w.means))) },
          ], words.map(k => ({ k, label: stateLabel(k, labels), n: counts.get(k) || 0, means: means[k] || 'No meaning is recorded for this state.' }))
            .concat(strange.map(k => ({ k, label: stateLabel(k, labels), n: counts.get(k) || 0,
              means: 'The database holds this value and this screen has no wording for it. It is shown exactly as '
                + 'stored rather than folded into a state it might mean.' }))))}
          ${muted(caption)}
        </div>`;

      const left = axis(VERIFICATION_WORDS, F.byVerification, VERIFICATION_MEANS, F.strangeV,
        'Has anybody checked it?',
        'Counted over the ' + num(F.rules.length) + ' ' + plural(F.rules.length, 'version', 'versions')
          + ' this account can read. Only a checked rule reaches the safe read, and a rule that is missing, unchecked, '
          + 'expired or disputed is simply absent from it — so a consumer finds nothing rather than a value it should '
          + 'not trust.', VERIFICATION_LABEL);

      const right = axis(LIFECYCLE_WORDS, F.byLifecycle, LIFECYCLE_MEANS, F.strangeS,
        'Is it in force?',
        'The same ' + num(F.rules.length) + ' ' + plural(F.rules.length, 'version', 'versions')
          + ', counted on the other axis. A version is never edited in place: superseding inserts a new row and closes '
          + 'the old one, so the evidence behind a quote issued last March survives this March&rsquo;s rule change.', LIFECYCLE_LABEL);

      const cross = `<div class="banner ${F.reliable.length ? 'info' : 'warm'}">
          <span class="material-symbols-outlined" style="font-size:20px">fact_check</span>
          <div>${muted(`Read the two tables together. `
            + (F.reliable.length
                ? `${num(F.reliable.length)} of ${num(F.rules.length)} `
                  + `${plural(F.reliable.length, 'version', 'versions')} sit in the one square that permits reliance: `
                  + 'in force and checked.'
                /* Three genuinely different situations, and the sentence has to
                   match the one it is sitting in. Both counts zero is not "the
                   sets do not overlap" — it is that the engine holds nothing on
                   either axis, which is a stronger and simpler statement. */
                : ((F.byLifecycle.get('ACTIVE') || 0) === 0 && F.verified.length === 0
                    ? `Nothing is on either axis: not one of the ${num(F.rules.length)} `
                      + `${plural(F.rules.length, 'version has', 'versions have')} been put in force in this engine, `
                      + 'and not one has been checked. Note what that does NOT mean — the values themselves are in '
                      + 'force in the code right now, which is exactly why they are recorded here as unsourced.'
                    : `No version sits in the square that permits reliance — in force AND checked. `
                      + `${num(F.byLifecycle.get('ACTIVE') || 0)} `
                      + `${plural(F.byLifecycle.get('ACTIVE') || 0, 'is', 'are')} in force and `
                      + `${num(F.verified.length)} ${plural(F.verified.length, 'has', 'have')} been checked, and no `
                      + 'version is in both sets.')))}</div>
        </div>`;

      return `<div class="grid g2">${left}${right}</div>` + cross;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P3 · The rules, with their citations
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'Every rule version, and what it cites',
    sub: 'The source line is the point of this table. Where a rule&rsquo;s only source is this codebase, that is what '
       + 'it says',
    load: () => readRules(),
    render: rows => {
      const F = ruleFacts(rows);
      if (!F.rules.length) {
        return stateEmpty('No policy rule is on record',
          'Nothing is written down, so there is nothing to cite and nothing to check.', 'gavel');
      }

      const body = table([
        { label: 'Rule', strong: true, render: k =>
            wrap(`<div class="mono">${esc(str(k.rule_name))}</div>`)
            + muted(`${esc(str(k.jurisdiction))} &middot; ${esc(str(k.rule_type))} &middot; v${esc(str(k.version))}`
              + (k.is_global_rule === true ? ' &middot; global' : ' &middot; this dealership')) },
        { label: 'Value', render: k => (str(k.value_display)
            ? `<div class="mono">${esc(str(k.value_display))}</div>`
            /* No value is not a missing value: the row was created as a
               question on purpose, so that a consumer looking for the figure
               finds an explicit unknown instead of nothing at all. */
            : `<span class="pill unknown"><span class="dot"></span>NO VALUE STATED</span>`
              + muted('Registered as a question rather than an answer. Nothing may be computed from it and no claim '
                + 'may be made on it.')) },
        /* The reader's word, with the stored token preserved as the pill's
           title so the provenance is still one hover away. `verbatim` claims
           the label came from the database, so it is asserted only where the
           translation left it unchanged. */
        { label: 'Checked', render: k => pill(stateLabel(str(k.verification_status) || 'NOT RECORDED', VERIFICATION_LABEL), '',
            { verbatim: !VERIFICATION_LABEL[str(k.verification_status)] })
            + muted(str(k.verification_date)
                ? `verified ${esc(dubaiDate(k.verification_date))} by `
                  + `${esc(str(k.verified_by) || 'nobody named')}`
                : 'no verification date, and nobody has signed for it') },
        { label: 'In force', render: k => pill(stateLabel(str(k.status) || 'NOT RECORDED', LIFECYCLE_LABEL), '',
            { verbatim: !LIFECYCLE_LABEL[str(k.status)] })
            + muted(str(k.effective_from)
                ? `from ${esc(dubaiDate(k.effective_from))}`
                  + (str(k.effective_to) ? ` to ${esc(dubaiDate(k.effective_to))}` : ', open-ended')
                : 'no effective date is recorded') },
        { label: 'Authority', render: k =>
            /* The only colour on this screen, and it is the engine's own
               boolean rather than a severity map in this file. */
            pill(str(k.authority) || 'UNKNOWN', k.may_be_relied_on === true ? 'ok' : 'hot', { verbatim: true })
            + muted(wrap(esc(str(k.authority_reason))
                || 'The engine records no reason for this grading, which is itself a gap.')) },
        { label: 'What it cites', render: k => wrap(
            `<div>${esc(str(k.source_name)) || '<span class="t-muted">no source named</span>'}</div>`
            + (str(k.source_document)
                ? muted(`<span class="mono">${esc(str(k.source_document))}</span>`)
                : muted('No document, file or line is recorded against this rule.'))
            + (str(k.source_url) ? muted(esc(str(k.source_url))) : '')) },
      ], F.rules, { onRow: true });

      /* The engine's own notes, given room. They carry the reasoning a table
         cell cannot — including which of these the engine itself considers most
         urgent, and why. Printed unaltered. */
      const notes = F.rules.filter(k => str(k.notes)).map(k => `<div class="section" style="margin-top:14px">
          ${bold(`<span class="mono">${esc(str(k.rule_name))}</span> `
            + pill(str(k.authority) || 'UNKNOWN', k.may_be_relied_on === true ? 'ok' : 'hot', { verbatim: true }))}
          <div class="quote">${esc(str(k.notes))}</div>
          ${muted(`Added by ${esc(str(k.added_by) || 'nobody named')}`
            + (k.added_at ? ` on ${esc(dubaiStamp(k.added_at))}` : '')
            + (k.updated_at ? `, last changed ${esc(dubaiStamp(k.updated_at))}` : '')
            + `. Confidence: ${esc(str(k.confidence) || 'not stated')}.`)}
        </div>`).join('');

      const notesBlock = notes
        ? `<div class="section" style="margin-top:16px">
             <div class="label-caps">What each rule&rsquo;s author wrote about it, unaltered</div>
             ${notes}
           </div>`
        : `<div class="section" style="margin-top:16px">${muted('No rule carries a note. Every rule here is therefore '
            + 'a value and a citation with no account of how it was arrived at.')}</div>`;

      return body + muted('Click a row for every version of that rule, each beside the one it replaced.') + notesBlock;
    },
  }).then(card => {
    wireGo(card);
    /* Every version, global ones included, opens its own history. Wired from
       the shared read so the row index maps to the same row the table drew. */
    readRules().then(rs => {
      const list = rs || [];
      card.querySelectorAll('tbody tr.clickable').forEach(tr => tr.addEventListener('click', () => {
        const k = list[Number(tr.dataset.i)];
        if (k) historyDrawer(str(k.jurisdiction), str(k.rule_name));
      }));
    }).catch(() => {});
  });

  /* ══════════════════════════════════════════════════════════════════════
     P4 · The safe read
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'What a consumer actually receives',
    sub: 'The safe read holds only rule versions that state a value, are in force, are inside their effective span and '
       + 'were verified against a named source. Everything else is simply absent from it',
    load: () => readAuthoritative(),
    render: rows => {
      const auth = rows || [];
      if (!auth.length) {
        return `<div class="banner hot">
            <span class="material-symbols-outlined" style="font-size:20px">block</span>
            <div>
              ${bold('The safe read is empty, and that is the engine working.')}
              ${muted('Nothing on record clears all four bars, so every consumer that asks this engine for a value '
                + 'receives nothing and has to handle &ldquo;unknown&rdquo;. A figure the product cannot stand behind '
                + 'is never handed out quietly — the call refuses instead, loudly, which is why the VAT recompute has '
                + 'not been repointed at the Policy Engine yet.')}
              ${muted('This is an empty view with a reason, not a failed read. Where a read fails, this panel says so '
                + 'in those words instead.')}
            </div>
          </div>`;
      }
      return table([
        { label: 'Rule', strong: true, render: k =>
            wrap(`<div class="mono">${esc(str(k.rule_name))}</div>`)
            + muted(`${esc(str(k.jurisdiction))} &middot; ${esc(str(k.rule_type))} &middot; v${esc(str(k.version))}`) },
        { label: 'Value', render: k => (str(k.value_display)
            ? `<span class="mono">${esc(str(k.value_display))}</span>`
            : '<span class="t-muted">no value rendered, which cannot happen in this view and is a defect if seen</span>') },
        { label: 'In force from', render: k => (str(k.effective_from)
            ? `<div>${esc(dubaiDate(k.effective_from))}</div>`
              + muted(str(k.effective_to) ? `until ${esc(dubaiDate(k.effective_to))}` : 'open-ended')
            : '<span class="t-muted">no effective date</span>') },
        { label: 'Verified', render: k => `<div>${esc(dubaiDate(k.verification_date))}</div>`
            + muted(`by ${esc(str(k.verified_by) || 'nobody named')} &middot; `
              + `confidence ${esc(str(k.confidence) || 'not stated')}`) },
        { label: 'The citation a customer-facing claim must carry', render: k => wrap(muted(esc(str(k.citation))
            || 'No citation string is recorded, which makes this rule unquotable in practice.')) },
      ], auth);
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P5 · The work order
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'Constants still hard-coded',
    sub: 'The cost of migrating to the Policy Engine, written down with the exact file and line. It asserts nothing '
       + 'about whether any listed value is correct — only that it is asserted with no source',
    actions: linkBtn('finance', 'Open Finance Desk') + ' ' + linkBtn('automation', 'Open Automation'),
    load: () => readConstants(),
    render: rows => {
      const K = constFacts(rows);
      if (!K.consts.length) {
        return stateEmpty('No hard-coded constant was found',
          'Either every rule has moved into the policy tables or the survey has not been run, and this screen cannot '
          + 'tell those two apart. A survey that has not been taken is not a clean one.', 'done_all');
      }

      const head = `<div class="grid g4">
          ${kpi('In the survey', num(K.consts.length),
            muted(`Across ${num(K.byLayer.size)} ${plural(K.byLayer.size, 'layer', 'layers')}: `
              + [...K.byLayer.entries()].map(([l, n]) => `${num(n)} ${esc(l.toLowerCase())}`).join(', ') + '.'))}
          ${kpi('Reaching a customer', num(K.facing.length),
            muted(K.facing.length
              ? `Of ${num(K.consts.length)}. These are printed, quoted or spoken to a buyer. The other `
                + `${num(K.hidden.length)} shape internal behaviour only, which makes them cheaper to be wrong about `
                + 'and no less unsourced.'
              : 'Not one of these figures reaches a buyer.'),
            K.facing.length ? 't-hot' : '')}
          ${kpi('Blocked on verification', num(K.blocked.length),
            muted(K.blocked.length
              ? 'A rule row exists and nobody has verified it, so repointing the code would replace a silent wrong '
                + 'number with a loud refusal. That is progress, and it must be a deliberate choice rather than a '
                + 'tidy-up.'
              : 'Nothing is waiting on a verification.'))}
          ${kpi('Ready to migrate', num(K.ready.length),
            muted(K.ready.length
              ? 'An authoritative rule now exists and the code can be repointed at it.'
              : `Nothing is ready. ${num(K.noRule.length)} `
                + `${plural(K.noRule.length, 'constant has', 'constants have')} no rule row at all yet — some `
                + 'deliberately, because seeding a lender&rsquo;s appetite or one dealership&rsquo;s commercial term '
                + 'would give it the same shelf as a regulation.'),
            K.ready.length ? 't-won' : '')}
        </div>`;

      const list = (rows2, title, caption) => (rows2.length
        ? `<div class="section" style="margin-top:16px">
             <div class="label-caps">${esc(title)}</div>
             ${table([
               { label: 'Where', strong: true, render: k =>
                   wrap(`<div class="mono">${esc(str(k.location))}</div>`)
                   + muted(`${esc(str(k.layer))} &middot; ${esc(str(k.kind))}`)
                   + (str(k.snippet) ? muted(`<span class="mono">${esc(str(k.snippet))}</span>`) : '') },
               { label: 'Value in force', render: k => (str(k.current_value)
                   ? `<span class="mono">${esc(str(k.current_value))}</span>`
                   : '<span class="t-muted">the survey records no value for this constant</span>') },
               { label: 'Reaches a customer', render: k => (k.reaches_a_customer === true
                   ? pill('Yes', 'hot', { verbatim: false })
                   : k.reaches_a_customer === false
                     ? pill('No', 'cold', { verbatim: false })
                     : pill('Not stated', 'unknown', { verbatim: false })) },
               { label: 'Migration state', render: k => pill(str(k.migration_state) || 'NOT RECORDED', '', { verbatim: true })
                   + muted(k.rule_row_exists === true
                       ? (k.rule_is_authoritative === true
                           ? 'A rule exists and may be relied on.'
                           : 'A rule row exists and it is not authoritative, so the code cannot be repointed at it yet.')
                       : 'No rule row exists for this constant yet.') },
               { label: 'Would become', render: k => (str(k.proposed_rule_name)
                   ? muted(`<span class="mono">${esc(str(k.proposed_rule_type))} / ${esc(str(k.proposed_rule_name))}</span>`)
                   : muted('No destination rule is proposed for this constant.')) },
               { label: 'What the survey says about it', render: k => wrap(muted(esc(str(k.note))
                   || 'The survey records no note against this constant.')) },
             ], rows2)}
             ${caption ? muted(caption) : ''}
           </div>`
        : '');

      const facing = list(K.facing, 'Reaching a customer — these come first, and the ordering is the survey&rsquo;s own',
        'Read the notes rather than the numbers. One of these is not a figure at all: it is a sentence naming a '
        + 'regulator, sent over WhatsApp, resting on constants nobody has checked against the instrument. The survey '
        + 'says which, in its own words.');
      const hidden = list(K.hidden, 'Internal only — cheaper to be wrong about, and no better sourced',
        'These shape recommendations, thresholds and validation rather than anything a customer reads. Several of them '
        + 'exist in two places with two different numbers, which the survey names row by row.');

      const foot = muted(`Surveyed ${K.surveyed ? esc(dubaiDate(K.surveyed)) : 'on a date the view does not record'}. `
        + 'This is a point-in-time survey of source files and database objects, so a constant added since is not in '
        + 'it — the absence of a row here is not evidence that a constant does not exist.');

      return head + facing + hidden + `<div class="section">${foot}</div>`;
    },
  }).then(wireGo);

  /* ══════════════════════════════════════════════════════════════════════
     P5b · This dealership's own house rules — propose, verify, supersede,
     withdraw, and the history of each
     ══════════════════════════════════════════════════════════════════════
     Added 7 Oct 2026. The four policy_* write functions existed and nothing
     called them, so every panel above was read-only. Each is SECURITY DEFINER,
     takes its dealership and its authority from the session
     (action_approver_context), and REFUSES BY RAISING — SQLSTATE NX001 with the
     sentence in MESSAGE, the machine code in DETAIL and the next step in HINT.
     All three are shown, unaltered, because they were written for the person
     reading them (see lib/data.js, which carries them on `.refusal`).

     Only TENANT_HOUSE is offered as a jurisdiction, and only rows that belong to
     this dealership get Verify / Supersede / Withdraw. That is a convenience,
     not the control: a platform or regulator rule is refused by the database
     with JURISDICTION_NOT_YOURS_TO_LEGISLATE whatever this screen offers.
     Verifying is what lets a value be quoted to a customer, so every action
     goes through a confirm dialog that says what it does. */
  const readTypes = shared(() => db('policy_rule_type?select=code,label&order=code.asc'));
  const readUnits = shared(() => db('policy_unit?select=code,label,value_kind&order=code.asc'));
  /* Keyed on jurisdiction AND name: a house rule may share its name with the
     platform rule it tightens, and the two histories are not one history. */
  const readHistory = (jur, ruleName) => db('v_policy_rule_history'
    + '?select=id,rule_name,jurisdiction,version,status,verification_status,value_numeric,value_text,unit,'
    + 'effective_from,effective_to,source_name,source_document,verification_date,verified_by,added_by,added_at,'
    + 'previous_value_numeric,previous_value_text,previous_effective_from,previous_source_name'
    + `&jurisdiction=eq.${encodeURIComponent(jur)}&rule_name=eq.${encodeURIComponent(ruleName)}&order=version.desc&limit=50`);

  panel(root, {
    title: 'Your dealership’s house rules',
    sub: 'Rules this dealership states for itself. A house rule may tighten what the platform allows and can never '
       + 'loosen it. Global and regulator rules are shown above and cannot be changed from here',
    actions: '<button class="btn sm primary" data-pol="propose">Propose a house rule</button>',
    load: () => readRules(),
    render: rows => {
      const mine = (rows || []).filter(k => k.is_global_rule !== true);
      const list = table([
        { label: 'Rule', strong: true, render: k => `<div class="mono">${esc(str(k.rule_name))}</div>`
            + muted(`${esc(str(k.rule_type))} &middot; v${esc(str(k.version))}`) },
        { label: 'Value', render: k => (str(k.value_display)
            ? `<span class="mono">${esc(str(k.value_display))}</span>`
            : '<span class="pill unknown"><span class="dot"></span>NO VALUE STATED</span>') },
        { label: 'Checked', render: k => pill(stateLabel(str(k.verification_status) || 'NOT RECORDED', VERIFICATION_LABEL), '',
            { verbatim: !VERIFICATION_LABEL[str(k.verification_status)] }) },
        { label: 'In force', render: k => pill(stateLabel(str(k.status) || 'NOT RECORDED', LIFECYCLE_LABEL), '',
            { verbatim: !LIFECYCLE_LABEL[str(k.status)] }) },
        { label: '', align: 'r', render: k => {
            const open = !['SUPERSEDED', 'WITHDRAWN'].includes(up(k.status));
            const id = esc(str(k.id));
            return `<button class="btn sm ghost" data-hist="${esc(str(k.rule_name))}" data-jur="${esc(str(k.jurisdiction))}">History</button>`
              + (open ? ` <button class="btn sm" data-pol="verify" data-id="${id}">Verify</button>`
                  + ` <button class="btn sm" data-pol="supersede" data-id="${id}">Supersede</button>`
                  + ` <button class="btn sm danger" data-pol="withdraw" data-id="${id}">Withdraw</button>` : '');
          } },
      ], mine, {
        empty: stateEmpty('This dealership has stated no house rule',
          'Every rule on record is a platform or regulator rule. Propose one to record a position of your own — it '
          + 'starts as a draft and nothing reads it as checked until an approver verifies it against a source.', 'gavel'),
      });
      return list + `<div class="section">${muted('Who may do what is decided by the database, not this screen: '
        + 'proposing needs a dealership account, and verifying, superseding or withdrawing needs the same approval '
        + 'authority as an inventory action. A refusal is shown in the database&rsquo;s own words.')}</div>`;
    },
  }).then(card => {
    wireGo(card);
    const byId = new Map();
    readRules().then(rs => (rs || []).forEach(k => byId.set(str(k.id), k))).catch(() => {});
    card.querySelectorAll('[data-hist]').forEach(b => b.addEventListener('click', () => historyDrawer(b.dataset.jur, b.dataset.hist)));
    card.querySelectorAll('[data-pol]').forEach(b => b.addEventListener('click', () => {
      const kind = b.dataset.pol;
      if (kind === 'propose') { proposeDialog(); return; }
      const rule = byId.get(str(b.dataset.id));
      if (rule) ruleDialog(kind, rule);
    }));
  });

  /* The refusal, in the database's three parts. A failure that is not an NX001
     refusal falls back to the user-safe clause lib/errors.js wrote. */
  const refusalHtml = e => {
    const r = e && e.refusal;
    if (!r || !r.message) return `<span class="t-hot">${esc(str(e && e.message) || 'The change did not go through.')}</span>`;
    return `<div class="t-hot">${esc(r.message)}</div>`
      + (r.detail ? muted(`Code: <span class="mono">${esc(r.detail)}</span>`) : '')
      + (r.hint ? muted(esc(r.hint)) : '');
  };
  const field = (id, label, input, hint) => `<div class="field"><label for="${id}">${esc(label)}</label>${input}`
    + (hint ? `<div class="hint">${esc(hint)}</div>` : '') + '</div>';
  const val = (m, id) => (m.wrap.querySelector('#' + id)?.value || '').trim();
  const orNull = v => (v === '' ? null : v);
  const done = (m, text) => { m.close(); NOTICE = text; go('policy'); };

  async function proposeDialog() {
    const m = openModal('Propose a house rule', `<div class="form-stack">
        <div class="banner info banner-flush"><span class="material-symbols-outlined">info</span>
          <div>This records a rule as a draft under this dealership&rsquo;s own name (TENANT_HOUSE). It is not checked
          and nothing may quote it until an approver verifies it. Leave the value empty to register the rule as a
          question.</div></div>
        <div class="frow">
          ${field('pRt', 'Rule type', '<select id="pRt"><option value="">Loading…</option></select>')}
          ${field('pName', 'Rule name', '<input id="pName" type="text" maxlength="80" placeholder="e.g. MIN_DEPOSIT_PCT">',
            'Capital letters, digits and underscores.')}
        </div>
        <div class="frow">
          ${field('pUnit', 'Unit', '<select id="pUnit"><option value="">Loading…</option></select>')}
          ${field('pVal', 'Value (optional)', '<input id="pVal" type="text" maxlength="200">',
            'A number for a numeric unit, words otherwise.')}
        </div>
        ${field('pSrc', 'Where this comes from (required)', '<input id="pSrc" type="text" maxlength="200">',
          'Name the source even for an unchecked rule — a person, a document, a policy.')}
        <div class="frow">
          ${field('pDoc', 'Document or reference (optional)', '<input id="pDoc" type="text" maxlength="200">')}
          ${field('pFrom', 'In force from (optional)', '<input id="pFrom" type="date">')}
        </div>
        ${field('pNotes', 'Notes (optional)', '<textarea id="pNotes" rows="2"></textarea>')}
      </div>`,
      '<button class="btn primary" id="pGo">Propose</button><button class="btn ghost" id="pCancel">Cancel</button>');
    m.wrap.querySelector('#pCancel').addEventListener('click', m.close);
    let units = [];
    Promise.all([readTypes(), readUnits()]).then(([types, us]) => {
      units = us || [];
      m.wrap.querySelector('#pRt').innerHTML = (types || []).map(t =>
        `<option value="${esc(str(t.code))}">${esc(str(t.label) || str(t.code))}</option>`).join('');
      m.wrap.querySelector('#pUnit').innerHTML = units.map(u =>
        `<option value="${esc(str(u.code))}">${esc(str(u.label) || str(u.code))}</option>`).join('');
    }).catch(e => m.msg(`<span class="t-hot">The rule types and units could not be read (${esc(str(e && e.message))}), so a rule cannot be proposed right now.</span>`));
    m.wrap.querySelector('#pGo').addEventListener('click', async () => {
      const btn = m.wrap.querySelector('#pGo');
      const unit = val(m, 'pUnit');
      const kind = up((units.find(u => str(u.code) === unit) || {}).value_kind);
      const raw = val(m, 'pVal');
      if (raw && kind === 'NUMERIC' && Number.isNaN(Number(raw))) {
        m.msg('<span class="t-hot">That unit is numeric, so the value must be a number. Nothing was written.</span>');
        return;
      }
      btn.disabled = true; btn.textContent = 'Proposing…';
      try {
        const res = await dbWrite('POST', 'rpc/policy_propose_rule', {
          p_jurisdiction: 'TENANT_HOUSE',
          p_rule_type: val(m, 'pRt'),
          p_rule_name: up(val(m, 'pName')),
          p_unit: unit,
          p_source_name: val(m, 'pSrc'),
          p_value_numeric: raw && kind === 'NUMERIC' ? Number(raw) : null,
          p_value_text: raw && kind !== 'NUMERIC' ? raw : null,
          p_source_url: null,
          p_source_document: orNull(val(m, 'pDoc')),
          p_effective_from: orNull(val(m, 'pFrom')),
          p_notes: orNull(val(m, 'pNotes')),
        });
        const row = Array.isArray(res) ? res[0] : res;
        done(m, `Recorded as a draft (version ${esc(str(row && row.version) || '1')}). It is not checked until an approver verifies it.`);
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Try again';
        m.msg(refusalHtml(e));
      }
    });
  }

  const RULE_ACTION = {
    verify: { title: 'Verify this rule', fn: 'policy_verify_rule', go: 'Verify',
      what: 'Verifying says a named person read the source, and it is what allows this value to be quoted to a '
        + 'customer. It is recorded against your account and cannot be undone — a correction later is a new version.' },
    supersede: { title: 'Replace this rule with a new version', fn: 'policy_supersede_rule', go: 'Record new version',
      what: 'The current version stays on record as replaced, so a decision taken under it can still be explained. The '
        + 'new version starts unchecked.' },
    withdraw: { title: 'Withdraw this rule', fn: 'policy_withdraw_rule', go: 'Withdraw',
      what: 'Takes this rule out of force with no replacement. It stays on record as withdrawn.' },
  };

  function ruleDialog(kind, k) {
    const A = RULE_ACTION[kind];
    const numeric = up(k.value_kind) === 'NUMERIC';
    const form = kind === 'verify'
      ? field('rSrc', 'Source you checked (optional — keeps the recorded one if empty)', '<input id="rSrc" type="text" maxlength="200">')
        + field('rDoc', 'Document, article or reference', '<input id="rDoc" type="text" maxlength="200">',
          'A verified rule must name a document or a link.')
        + field('rUrl', 'Link (optional)', '<input id="rUrl" type="text" maxlength="400">')
        + `<div class="frow">${field('rFrom', 'In force from', '<input id="rFrom" type="date">',
            'Only needed if this version has no start date yet.')}
           ${field('rConf', 'Confidence', '<select id="rConf"><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select>')}</div>`
        + field('rNotes', 'Notes (optional)', '<textarea id="rNotes" rows="2"></textarea>')
      : kind === 'supersede'
        ? `<div class="frow">${field('rVal', `New value${numeric ? ' (a number)' : ''}`, '<input id="rVal" type="text" maxlength="200">')}
             ${field('rFrom', 'In force from (required)', '<input id="rFrom" type="date">',
               'Must be after the current version’s start date.')}</div>`
          + field('rSrc', 'Where the new value comes from (required)', '<input id="rSrc" type="text" maxlength="200">')
          + field('rDoc', 'Document or reference (optional)', '<input id="rDoc" type="text" maxlength="200">')
          + field('rNotes', 'Notes (optional)', '<textarea id="rNotes" rows="2"></textarea>')
        : field('rWhy', 'Why (required)', '<textarea id="rWhy" rows="3"></textarea>');
    const m = openModal(A.title, `<div class="form-stack">
        <div class="banner ${kind === 'withdraw' ? 'warm' : 'info'} banner-flush"><span class="material-symbols-outlined">${kind === 'withdraw' ? 'warning' : 'info'}</span>
          <div>${esc(A.what)}</div></div>
        <div class="cell-sub"><span class="mono">${esc(str(k.rule_name))}</span> &middot; v${esc(str(k.version))} &middot;
          ${str(k.value_display) ? `value <span class="mono">${esc(str(k.value_display))}</span>` : 'no value stated'}</div>
        ${form}
      </div>`,
      `<button class="btn ${kind === 'withdraw' ? 'danger' : 'primary'}" id="rGo">${esc(A.go)}</button><button class="btn ghost" id="rCancel">Cancel</button>`);
    m.wrap.querySelector('#rCancel').addEventListener('click', m.close);
    m.wrap.querySelector('#rGo').addEventListener('click', async () => {
      const btn = m.wrap.querySelector('#rGo');
      let body;
      if (kind === 'verify') {
        body = { p_rule_id: k.id, p_source_name: orNull(val(m, 'rSrc')), p_source_url: orNull(val(m, 'rUrl')),
          p_source_document: orNull(val(m, 'rDoc')), p_effective_from: orNull(val(m, 'rFrom')),
          p_confidence: val(m, 'rConf') || 'HIGH', p_notes: orNull(val(m, 'rNotes')) };
      } else if (kind === 'supersede') {
        const raw = val(m, 'rVal');
        if (raw && numeric && Number.isNaN(Number(raw))) {
          m.msg('<span class="t-hot">This rule is numeric, so the new value must be a number. Nothing was written.</span>');
          return;
        }
        body = { p_rule_id: k.id, p_effective_from: orNull(val(m, 'rFrom')), p_source_name: val(m, 'rSrc'),
          p_value_numeric: raw && numeric ? Number(raw) : null, p_value_text: raw && !numeric ? raw : null,
          p_source_url: null, p_source_document: orNull(val(m, 'rDoc')), p_notes: orNull(val(m, 'rNotes')) };
      } else {
        body = { p_rule_id: k.id, p_reason: val(m, 'rWhy') };
      }
      btn.disabled = true; btn.textContent = 'Recording…';
      try {
        const res = await dbWrite('POST', `rpc/${A.fn}`, body);
        const row = Array.isArray(res) ? res[0] : res;
        done(m, `${esc(str(k.rule_name))}: ${esc(str(row && row.outcome) || 'recorded')}`
          + (row && row.version ? ` (version ${esc(str(row.version))})` : '') + '.');
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Try again';
        m.msg(refusalHtml(e));
      }
    });
  }

  async function historyDrawer(jur, ruleName) {
    openDrawer(`<div class="drawer-head">
        <div class="drawer-head-main"><h2 class="mono">${esc(ruleName)}</h2>
          <div class="card-sub">Every version of this rule, each beside the one it replaced</div></div>
        <button class="btn ghost sm" id="polClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div><div class="drawer-body" id="polHist">${stateLoading(4)}</div>`);
    $('polClose').addEventListener('click', closeDrawer);
    const host = $('polHist');
    let rows;
    try { rows = await readHistory(jur, ruleName); } catch (e) { if (host) host.innerHTML = stateError('this rule’s history', e); return; }
    if (!host) return;
    if (!rows.length) {
      host.innerHTML = stateEmpty('No version history came back',
        'The history view returned nothing for this rule name, so no earlier version is claimed and none is ruled out.', 'history');
      return;
    }
    const v = (n, t) => (n != null ? esc(String(n)) : str(t) ? esc(str(t)) : '<span class="t-muted">no value</span>');
    host.innerHTML = `<div class="timeline">${rows.map(h => `
      <div class="tl-item"><span class="tl-dot"></span><div class="tl-body">
        <div class="tl-meta"><span class="chip">v${esc(str(h.version))}</span>
          ${esc(stateLabel(str(h.status), LIFECYCLE_LABEL))} &middot; ${esc(stateLabel(str(h.verification_status), VERIFICATION_LABEL))}
          &middot; ${esc(str(h.jurisdiction))}</div>
        <div class="tl-text">Value ${v(h.value_numeric, h.value_text)} ${esc(str(h.unit))}
          ${str(h.effective_from) ? `&middot; from ${esc(dubaiDate(h.effective_from))}` : '&middot; no start date'}
          ${str(h.effective_to) ? ` to ${esc(dubaiDate(h.effective_to))}` : ''}</div>
        <div class="cell-sub cell-sub-wrap">Source: ${esc(str(h.source_name) || 'none named')}${str(h.source_document) ? ` &middot; ${esc(str(h.source_document))}` : ''}.
          Added by ${esc(str(h.added_by) || 'nobody named')}${h.added_at ? ` on ${esc(dubaiStamp(h.added_at))}` : ''}.
          ${str(h.verified_by) ? `Verified by ${esc(str(h.verified_by))}${h.verification_date ? ` on ${esc(dubaiDate(h.verification_date))}` : ''}.` : 'Not verified.'}</div>
        ${h.previous_value_numeric != null || str(h.previous_value_text) || str(h.previous_source_name)
          ? `<div class="cell-sub cell-sub-wrap">Replaced: value ${v(h.previous_value_numeric, h.previous_value_text)}`
            + `${str(h.previous_effective_from) ? `, in force from ${esc(dubaiDate(h.previous_effective_from))}` : ''}`
            + `${str(h.previous_source_name) ? `, sourced to ${esc(str(h.previous_source_name))}` : ''}.</div>`
          : '<div class="cell-sub">First version — nothing before it.</div>'}
      </div></div>`).join('')}</div>`;
  }

  /* ══════════════════════════════════════════════════════════════════════
     P6 · Where this page stands
     ══════════════════════════════════════════════════════════════════════ */
  panel(root, {
    title: 'Where this page stands',
    sub: 'The provenance of everything above, read from the same views rather than asserted here',
    load: async () => {
      const [r, a, c] = await Promise.all([settle(readRules()), settle(readAuthoritative()), settle(readConstants())]);
      if (r.err && a.err && c.err) throw r.err;
      return { r, a, c };
    },
    render: ({ r, a, c }) => {
      const F = r.err ? null : ruleFacts(r.v);
      const auth = a.err ? null : (a.v || []);
      const K = c.err ? null : constFacts(c.v);

      const t = tenantState();
      const label = tenantLabel(t);
      const tenantLine = !t.loaded
        ? 'Still being read.'
        : !t.ok
          ? `The membership read failed (${esc(str(t.error))}), so this page cannot say which dealership these rows `
            + 'belong to. It is not a claim that they belong to none.'
          : label
            ? `${esc(label)}. This view returns this dealership&rsquo;s own rules plus the global ones, scoped by the `
              + 'database rather than filtered by this screen.'
            : 'This account has a membership with no readable dealership name.';

      const confidences = F
        ? [...new Set(F.rules.map(k => str(k.confidence)).filter(Boolean))].join(', ')
        : '';

      const strip = [
        ['Evidence', F
          ? `${num(F.rules.length)} rule ${plural(F.rules.length, 'version', 'versions')} and `
            + (K ? `${num(K.consts.length)} surveyed ${plural(K.consts.length, 'constant', 'constants')}` : 'a constant survey that could not be read')
            + '. Every citation on this page is the string the database holds, printed unaltered — including the ones '
            + 'that cite this codebase rather than an authority.'
          : 'The rule versions could not be read, so nothing on this page is evidenced.'],
        ['Confidence', confidences
          ? `As graded on each version: ${esc(confidences)}. A rule cannot be marked checked at all while its confidence `
            + 'is unstated — that is enforced where the rule is stored, so an unchecked rule cannot quietly acquire a '
            + 'confidence it has not earned.'
          : 'No rule version was read on this render, so no confidence is stated.'],
        ['Data coverage', F && K
          ? `${num(F.valued.length)} of ${num(F.rules.length)} versions state a value; `
            + `${num(K.noRule.length)} of ${num(K.consts.length)} surveyed `
            + 'constants have no rule row at all yet. The survey covers source files and database objects as of the '
            + 'date it was taken, and nothing re-runs it automatically.'
          : 'Not established — one of the two reads behind this page failed.'],
        ['Unknown', F
          ? `Whether any of these values is actually correct. This engine records what the product asserts and who `
            + 'checked it; it has never claimed to know the law. '
            + (F.reliable.length === 0
                ? 'With nothing verified, every regulatory figure this product shows is currently unsupported.'
                : '')
          : 'Not established on this render.'],
        ['Last updated', K && K.surveyed
          ? `Constant survey taken ${esc(dubaiDate(K.surveyed))}. Rule versions are never edited in place, so their `
            + 'own dates are on each row above.'
          : 'Not stated on this render.'],
        ['Tenant', tenantLine],
        ['Action', K && K.facingLaw.length
          ? `Verify or withdraw the ${num(K.facingLaw.length)} customer-facing `
            + `${plural(K.facingLaw.length, 'claim', 'claims')} that assert somebody else&rsquo;s rule. Verifying one `
            + 'means reading the instrument, citing the article and dating it — which is exactly what being checked '
            + 'requires, and why nothing has reached it yet.'
          : auth && auth.length === 0
            ? 'Nothing on record can be quoted. The first useful step is verifying one rule end to end, so the safe '
              + 'read stops being empty.'
            : 'Not established on this render.'],
      ];

      return `<dl class="kv">${strip.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
    },
  }).then(wireGo);
};
