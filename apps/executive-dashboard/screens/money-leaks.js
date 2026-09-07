/* NEXUS OS — screens/money-leaks.js
   TODAY'S MONEY LEAKS. The screen a dealership opens in the morning, and the
   one PRODUCT.md's thesis is sold on: where is money leaking right now, and
   what should I do about it?

   ═══════════════════════════════════════════════════════════════════════════
   WHY THIS EXISTS WHEN OVERVIEW AND REVENUE RECOVERY ALREADY DO
   ═══════════════════════════════════════════════════════════════════════════
   It is a fair question and it was asked before a line was written.

     · screens/overview.js has a "Where money is leaking" panel. It is a panel
       on a status board — beside activity tiles, latest leads, KYC gaps and
       workflow health — and it is organised as an alert feed.
     · screens/revenue.js is the LEDGER: one section per engine, engine by
       engine, refusing to add them together. It answers "what does each engine
       say".

   Neither answers the morning question, which is an ORDER OF WORK, and neither
   carries the thing this screen exists for:

     A CHECK THAT CAME BACK CLEAR AND A CHECK THAT COULD NOT RUN ARE NOT THE
     SAME ROW, AND UNTIL NOW NOTHING IN THIS PRODUCT SEPARATED THEM.

   "0 leads gone silent" is not a finding when the 12-Hour Silence Detector last
   succeeded on 26 August. It is an absence of measurement wearing a finding's
   clothes, and it is exactly the lie CLAUDE.md records this codebase telling in
   six separate places. No screen on this branch reads
   `silence_detector_state` beside its own zero — Overview does not read that
   column at all. So this screen has four registers, not one:

     1. LEAKING          evidenced, sized in one of three named words, with an
                         action that routes into an approval lane that exists.
     2. MEASURED CLEAR   the engine looked, over a stated number of rows, and
                         found nothing. A zero with a denominator is a finding.
     3. NOT MEASURED     the engine could not look. Says since when, why, and
                         the one thing that would light it up.
     4. REFUSED          things that look like leaks and are not evidence. The
                         alert feed audited against the engines, item by item.

   ═══════════════════════════════════════════════════════════════════════════
   THE HEADLINE FIGURE, AND WHAT IT IS A DERIVATION OF
   ═══════════════════════════════════════════════════════════════════════════
   LAUNCH.md opens this screen with "AED X exposed today" and warns in the same
   breath that the number must not be a sum of estimates presented as money.
   So it is stated here, on the screen and in this comment, exactly once:

     THE HEADLINE IS THE SUM OF `engine_impact_aed` OVER THE ACTION RECORDS
     LISTED IN REGISTER 1, AND NOTHING ELSE.

   Every term of it is one kind (`MARGIN_EXPOSED`), produced by one engine
   (`v_inventory_profit_sentinel`) from two columns a dealership already
   trusts — `inventory.cost_aed` and `inventory.price_aed` — on units whose age
   comes from `inventory.acquired_at`. It is gross margin sitting in a car that
   has not sold. It is EXPOSED. It is not revenue, not expected loss, not
   savings and not recovery, and it is never added to anything that is.

   It is summed through expose() in screens/overview.js — imported, never
   re-implemented — which returns null rather than zero when no row carried a
   figure, refuses to total across two impact kinds, and reports its own
   denominator. Nothing on this page adds a lead figure to a unit figure: no
   lead in this database carries an opportunity value at all
   (`opportunity_value_state = UNKNOWN_NO_LINK` on every one), so the customer
   half of a true "revenue at risk" does not exist at any confidence and this
   screen says so rather than filling it in.

   ═══════════════════════════════════════════════════════════════════════════
   A LEAK LINE CANNOT BE RENDERED WITHOUT ITS PARTS
   ═══════════════════════════════════════════════════════════════════════════
   makeLeak() below is the only constructor, and it checks six things: what is
   leaking, why it is a leak, the rows behind it, which of the money words
   applies, how confident and why, and what to do. A leak missing any of them
   renders as a NAMED FAULT — "this line is incomplete and here is the part
   that is missing" — never as a tidy row with a blank in it. A gap that
   renders as a blank is a gap nobody reports.

   The money word is a closed set of four and the amount is gated on it:
   NOT_COMPUTABLE may not carry a number, and the other three must.

   ═══════════════════════════════════════════════════════════════════════════
   WHAT THIS SCREEN DELIBERATELY REFUSES TO SAY
   ═══════════════════════════════════════════════════════════════════════════
   · It never prices a car. The Sentinel holds no comparable of the quality this
     dealership accepts, so REPRICE asks for a human price review and names no
     figure.
   · It never calls a WhatsApp thread a waiting customer. Threads awaiting a
     reply are real; not one of them resolves to a lead, so "a customer is
     waiting" is not a claim this database supports and no figure may be put on
     it.
   · It never reports a service, appointment or reconditioning leak. There is no
     service table, no appointments table and no recon_cost column. Those are
     roadmap and are named as roadmap, not rendered as an empty bucket that
     reads like a clean bill of health.
   · It never claims a recovery. Recovery is the four-column test in
     screens/actions.js and nothing else; it is imported, not re-derived.

   ═══════════════════════════════════════════════════════════════════════════
   WHERE EVERYTHING COMES FROM — nothing below is computed in this file
   ═══════════════════════════════════════════════════════════════════════════
     rpc/sentinel_inventory_actions   the engine's live verdict per unit
     v_inventory_action_queue         the human loop: propose / decide / execute
     v_action_center_health           that lane's own one-row self-assessment
     v_lead_recovery                  per lead: state, risk, silence, detector
     v_lead_recovery_coverage         the same engine's coverage AND its own
                                      "what this engine cannot tell you"
     v_deal_rescue_readiness          nine prerequisites, measured on every read
     v_needs_attention                the alert feed, audited here rather than
                                      trusted
     v_workflow_health                whether the automations behind all of the
                                      above are running, graded by lib/health.js

   Measured against production on 6 September 2026, and recorded as a dated
   observation rather than encoded anywhere below: 12 units; 3 flagged
   (1 SEVERE, 2 HIGH) carrying AED 82,000 of gross margin; 3 action records —
   one APPROVED and not carried out for 4 days, one EXECUTION_FAILED, one
   REJECTED with a reason; 3 leads, 1 open and already sold; queue = 0; the
   silence detector STALE since 26 Aug; 45.5% of message events resolving to a
   lead; 0 of 9 Deal Rescue prerequisites met; 0 comparables of accepted match
   quality on any unit. Two leak lines. That is the correct output. */

import { db, onIdentityChange } from '../lib/data.js';
import { el } from '../lib/dom.js';
import { aed, ago, dubaiStamp, esc, n0, num } from '../lib/format.js';
import { healthWords } from '../lib/health.js';
import { SCREENS, go } from '../lib/nav.js';
import { panel } from '../lib/ui.js';
/* ── The design system, adopted here first ────────────────────────────────
   6 Sep 2026. This screen is the app's default landing screen, so it is what a
   buyer sees before anything else, and it is the first one converted to
   lib/design-system.css + lib/design-system.js.

   NOT ONE DATA READ, QUERY, THRESHOLD OR DERIVATION CHANGED IN THAT PASS.
   buildLeaks(), buildLeadLeaks(), measuredClear(), notMeasured(), makeLeak()
   and the MONEY_WORD gate are byte-for-byte what they were; the eight reads are
   the same eight columns lists; the ranking, the totals and every branch that
   decides what may be said are untouched. What changed is how the result is
   painted.

   THE CONSTRAINT THE CONVERSION WAS WRITTEN AGAINST, stated here because it is
   the thing a later pass is most likely to undo:

     The long sentences on this screen are not filler. "An unread check is not a
     clear one", "unknown is not zero", "this is not an all-clear" — each one is
     here because this codebase has shipped the opposite, and the file header
     above names six places it did. They may be DEMOTED — terse on the surface,
     one click from the full sentence — and they may NOT be deleted.

     Every one of them is now inside a <details> built by dsNote(), which means
     it is in the DOM whether it is open or closed: browser find reaches it,
     copy-paste reaches it, a screen reader reaches it, and Chromium expands the
     row when find-in-page matches inside it. None of that is true of a
     `title=` tooltip, which is why nothing on this screen uses one to carry a
     caveat. If you are about to replace a dsNote with a tooltip, read this
     paragraph again. */
import { dsCallout, dsCell, dsChip, dsDetailGrid, dsEmpty, dsEvidence, dsIntent,
         dsNote, dsRowList, dsStat, dsStatRow, dsTable, icon } from '../lib/design-system.js';
/* The exposure arithmetic and the sentence that discloses its denominator.
   Imported from screens/overview.js, which owns them, for the same reason
   overview.js imports recoveryEvidence() from screens/actions.js: a second
   copy of a money derivation is a second thing to keep true. */
import { EXPOSURE_CAVEAT, expose, exposureLine } from './overview.js';
/* The only test in this product that lets a figure be called recovered. Four
   columns, enforced by a database CHECK, and never re-implemented. */
import { recoveryEvidence, unsupportedRecoverySentence } from './actions.js';

/* ── Small local vocabulary ───────────────────────────────────────────────── */
const str = v => String(v == null ? '' : v).trim();
const up  = v => str(v).toUpperCase();
const plural = (c, one, many) => (Number(c) === 1 ? one : many);
const muted = h => `<div class="ds-cell-sub">${h}</div>`;
const hot   = h => `<div class="ds-cell-sub ds-t-danger">${h}</div>`;
const bold  = h => `<strong>${h}</strong>`;
const para  = h => `<p>${h}</p>`;
const mono  = v => `<span class="ds-mono">${esc(str(v))}</span>`;
const list  = arr => `<ul>${arr.filter(Boolean).map(x => `<li>${x}</li>`).join('')}</ul>`;
/* The first sentence of a paragraph, for the surface, with the whole paragraph
   kept for the note. Splitting on the sentence boundary rather than truncating
   at a character count means the terse form is always a complete thought and
   never ends mid-word — a clipped caveat reads as a broken one. */
const firstSentence = t => {
  const s0 = str(t);
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(s0);
  return m ? m[0] : s0;
};
/* Terse on the surface, the full text one click away. The note is omitted when
   the full text IS the first sentence, because an affordance that opens onto
   the words already on screen teaches the reader that these affordances are
   decoration — and the next one will hold something they needed. */
const said = (t, a11y = 'Read this in full') => {
  const full = str(t);
  if (!full) return '';
  const head = firstSentence(full);
  return dsCell(esc(head), head === full ? '' : para(esc(full)), a11y);
};

/* A read that failed, said where the figure would have been. Never a bare dash:
   a dash beside "Leaks today" reads as zero, and zero is a finding this screen
   makes on purpose and must be able to make credibly. */
const readFailed = (what, err) =>
  hot(`${esc(what)} could not be read (${esc(str(err && err.message) || 'no reason given')}), so nothing is claimed `
    + 'here and nothing is ruled out. An unread check is not a clear one.');

/* ── The memo is per RENDER, not per page load, and that distinction is a bug
      this screen shipped with ──────────────────────────────────────────────
   Eight panels share these reads, so a memo is right: without it one visit
   issues eight identical requests. But the memo was held at module scope and
   cleared only on rejection, which made it permanent for the life of the tab.
   Three consequences, all measured on the live site:

     - Navigating back to this screen issued ZERO requests and re-rendered
       yesterday's numbers under a caption saying "re-read on this load".
     - Refresh did nothing to the screen.
     - Worse: lib/data.js records that module state survives the re-auth path
       that does not reload the page, which is why six other modules register
       onIdentityChange. This one did not. A second dealership signing in on
       the same machine could therefore have been shown the FIRST dealership's
       leak register — the whole screen, under their own name.

   That last one is the reason this is not a caching nicety. It is the same
   class as every other finding here: a thing that looked measured and was
   remembered. So the memo now lives for one render — reset() runs at the top
   of the mount function, and again whenever the signed-in identity changes,
   which is belt and braces on purpose because the two events are not the same
   and only one of them is under this file's control. */
const MEMOS = new Set();
const shared = make => {
  let p = null;
  const f = () => {
    if (!p) { p = make(); p.catch(() => { p = null; }); }
    return p;
  };
  MEMOS.add(() => { p = null; });
  return f;
};
const resetReads = () => { MEMOS.forEach(reset => reset()); };
onIdentityChange(resetReads);
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
   THE FOUR MONEY WORDS, AND THE GATE ON EACH
   ══════════════════════════════════════════════════════════════════════════
   PRODUCT.md: estimated, attributed and confirmed are three different words and
   may never be interchanged. A fourth is added here because it is the word this
   product's strongest engine actually emits, and folding it into "estimated"
   would be the interchange the rule forbids — EXPOSED is measured from two real
   columns, where an estimate is a projection nothing here makes.

   ESTIMATED is declared and carries no rows, deliberately. Naming a word the
   engines cannot currently earn is how a reader learns that the other three are
   not decoration. */
const MONEY_WORD = {
  EXPOSED: { label: 'exposed', tone: 'warm',
    gloss: 'Gross margin — list price minus what the dealership paid — sitting in a unit that has not sold. This is '
         + 'the amount AT RISK. It is not a loss, not revenue, not money saved and not money recovered.' },
  ESTIMATED: { label: 'estimated', tone: 'unknown',
    gloss: 'A projection. No engine in NEXUS produces one today, so nothing on this screen carries this word — which '
         + 'is the point of listing it.' },
  ATTRIBUTED: { label: 'attributed', tone: 'cold',
    gloss: 'A figure tied to a recorded business outcome by a person who also recorded on what basis. Attributed is '
         + 'not confirmed and is never exposed.' },
  CONFIRMED: { label: 'confirmed', tone: 'ok',
    gloss: 'A column of a recorded sale. Confirmed revenue — not estimated, and not credited to anything NEXUS did '
         + 'unless the attribution chain says so hop by hop.' },
  NOT_COMPUTABLE: { label: 'not computable', tone: 'unknown',
    gloss: 'Nobody can compute this from what is in the database today. Not computable is not zero, and no number is '
         + 'printed in its place.' },
};

/* The amount is gated on the word, in one place, so no caller can print a
   figure under a word that does not permit one. NOT_COMPUTABLE may never carry
   a number; the other three must, or the line is incomplete and says so.

   ── What the design-system pass changed here, and what it did not ──────────
   THE GATE IS UNTOUCHED. The four branches, the order they are tested in, and
   what each one is allowed to render are exactly what they were. What changed
   is that the result is returned in THREE PIECES instead of one blob of markup,
   so the leak register can put the figure in a right-aligned numeric column,
   the money word in a chip column, and the basis behind the row's disclosure —
   rather than stacking all three into one cell, which is what made the old rows
   200px tall and put the second leak below the fold.

   `figure` is never a bare dash and never a zero. Where the gate refuses a
   number the figure slot carries WORDS — "Not computable", "No figure" — set at
   a smaller size than a real figure, so nothing in that column can be misread
   as a quantity the engine produced. */
const sizeParts = size => {
  const w = MONEY_WORD[up(size && size.word)];
  if (!w) {
    return {
      figure: '<span class="ds-t-danger">Unsized</span>', words: true, chip: '',
      note: hot(`This line claims a size of "${esc(str(size && size.word)) || 'nothing'}", which is not one of the `
        + 'four money words this screen is allowed to use. No figure is shown.'),
    };
  }
  if (up(size.word) === 'NOT_COMPUTABLE') {
    return {
      figure: '<span class="ds-t-unknown">Not computable</span>', words: true,
      chip: dsChip('not computable', 'unknown'),
      note: muted(esc(str(size.basis)) || 'The engine records no reason, which is itself a gap.'),
    };
  }
  const amount = n0(size.amount);
  if (amount == null) {
    return {
      figure: '<span class="ds-t-danger">No figure</span>', words: true,
      chip: dsChip(w.label, dsIntent(w.tone)),
      note: hot(`Sized as ${esc(w.label)} and no figure came with it, so nothing is shown. A money word without a `
        + 'number is a claim this screen cannot make.'),
    };
  }
  return {
    figure: aed(amount), words: false,
    chip: dsChip(w.label, dsIntent(w.tone)),
    note: muted(esc(str(size.basis)) || esc(w.gloss)),
  };
};

/* ── Confidence is NOT toned through lib/format.js's TONE table ─────────────
   That table exists for SEVERITY vocabularies, where HIGH is 'hot' and LOW is
   'cold'. A confidence runs the other way: passing a confidence through it
   would paint the engine's most trustworthy findings red and its least
   trustworthy ones a calm blue, which is worse than no colour at all.

   The original screen rendered confidence as plain text and made no colour
   claim, and that judgement is kept. The only distinction added is the one the
   data actually supports and that this design system exists to make visible:
   whether the engine stated a confidence at all. UNSTATED is unknown — hatched
   and dashed — because a finding with no confidence recorded is a gap in the
   finding, and the file header above says so. */
const confIntent = lvl => (up(lvl) && up(lvl) !== 'UNSTATED' ? 'neutral' : 'unknown');

/* ══════════════════════════════════════════════════════════════════════════
   makeLeak — the ONLY way a leak line comes into being
   ══════════════════════════════════════════════════════════════════════════
   Six parts. A line missing one renders as a named fault rather than a row with
   a hole in it, because a hole reads as "nothing to say here" and that is the
   failure this whole screen exists to end. */
const LEAK_PART = [
  ['what',       o => str(o.what),                                     'what is leaking'],
  ['why',        o => str(o.why),                                      'why this is a leak rather than a fact'],
  ['evidence',   o => Array.isArray(o.evidence) && o.evidence.length,   'the rows and the computation behind it'],
  ['size',       o => o.size && MONEY_WORD[up(o.size.word)],            'which of the money words applies'],
  ['confidence', o => o.confidence && str(o.confidence.level) && str(o.confidence.why), 'how confident, and why'],
  ['action',     o => o.action && str(o.action.ask),                    'what to do about it'],
];

function makeLeak(o) {
  const missing = LEAK_PART.filter(([, test]) => !test(o)).map(([, , label]) => label);
  /* The amount is part of the size contract, checked here so that an incomplete
     line is reported once, at construction, rather than discovered by whichever
     cell happened to render first. */
  if (o.size && MONEY_WORD[up(o.size.word)] && up(o.size.word) !== 'NOT_COMPUTABLE' && n0(o.size.amount) == null)
    missing.push('the figure that the money word "' + str(o.size.word).toLowerCase() + '" promises');
  return { rank: 0, ...o, missing };
}

/* A fault stays a CALLOUT rather than becoming a row, which is the same
   decision the original made and the reason it is worth restating: a line this
   screen cannot fully account for must not be tidied into the table, where it
   would sit among lines that ARE accounted for and be read as one of them. The
   missing parts are named on the surface — they are the whole point — and the
   instruction to report it is one click away. */
const leakFault = leak => dsCallout({
  intent: 'danger', name: 'danger',
  lede: 'A leak line was built without everything a leak line needs.',
  body: `<span>Missing: ${esc(leak.missing.join('; '))}.</span>`,
  note: para('A leak line was built without everything a leak line needs, and it is shown as a fault rather than as a row.')
    + para(`Missing: ${esc(leak.missing.join('; '))}.`)
    + para(`It concerns ${esc(str(leak.what) || 'something this screen could not name')}. Report this — a leak `
      + 'this dashboard cannot fully account for must not be quietly tidied into a table.'),
});

/* ══════════════════════════════════════════════════════════════════════════
   Reads
   ══════════════════════════════════════════════════════════════════════════
   `*` on the action queue for the same reason screens/actions.js uses it: the
   view is the contract and a hand-typed column list is a second contract that
   goes stale. Nothing here names recovered_value_aed — the four-column test
   imported from screens/actions.js is the only thing allowed to read it. */
const readEngine = shared(() => db('rpc/sentinel_inventory_actions'));
const readQueue  = shared(() => db('v_inventory_action_queue?select=*&order=proposed_at.desc&limit=500'));
const readLane   = shared(() => db('v_action_center_health?select=actions_total,awaiting_decision,'
  + 'escalated_no_approver,approved_not_executed,executed,execution_failed,rejected,deferred,cancelled,'
  + 'outcomes_attributed,outcomes_not_attributable,executed_awaiting_outcome,undecided_exposure_aed,'
  + 'undecided_with_no_figure,oldest_undecided_days,events_total,events_without_audit,audit_rows,last_activity_at,'
  + 'health&limit=5'));
const readLeads  = shared(() => db('v_lead_recovery?select=lead_id,lead_name,lead_status,lead_is_open,state,'
  + 'state_basis,response_time_minutes,response_time_state,sla_state,sla_first_response_minutes,last_contact_at,'
  + 'silence_state,silence_threshold_hours,silence_detector_state,silence_detector_last_success_at,'
  + 'silence_detector_note,risk_level,risk_basis,recommended_action,action_reason,owner_name,owner_state,'
  + 'action_state,opportunity_value_aed,opportunity_value_state,opportunity_value_basis,confirmed_outcome_state,'
  + 'confirmed_revenue_aed,recovery_attribution_state,recovery_attribution_basis,confidence,confidence_basis,'
  + 'automation_state,settings_are_defaults&limit=500'));
const readCoverage = shared(() => db('v_lead_recovery_coverage?select=leads_total,leads_open,leads_closed,'
  + 'leads_at_risk,leads_risk_unknown,leads_with_a_recommended_action,leads_with_a_confirmed_sale,'
  + 'confirmed_revenue_aed,sales_attributed_to_a_recovery_action,leads_with_no_owner,message_events,'
  + 'message_events_resolved_to_a_lead,identity_resolution_pct,unresolved_whatsapp_handles,silence_detector_state,'
  + 'silence_detector_last_success_at,recovery_actions_total,settings_are_defaults,sla_first_response_minutes,'
  + 'what_this_engine_cannot_tell_you,computed_at&limit=5'));
/* evidence_today is gone from the projection: nothing on this screen read it,
   and what it held was one dealership's stored counts (migration
   20260906070947). met_now / measured_now are the live, per-caller figures. */
const readReadiness = shared(() => db('v_deal_rescue_readiness?select=id,sort,requirement,kind,unlocks,'
  + 'why_not_code,met_now,measured_now,measured_at&order=sort.asc&limit=100'));
const readAttention = shared(() => db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen&limit=200'));
const readWorkflows = shared(() => db('v_workflow_health?select=name,category,is_active,health,runs_30d,'
  + 'successes_30d,failures_30d,no_result_30d,effective_runs_30d,success_rate_30d,last_run,last_success&limit=200'));

const one = rows => (Array.isArray(rows) ? rows[0] : rows) || null;

/* ══════════════════════════════════════════════════════════════════════════
   REGISTER 1 — the leaks
   ══════════════════════════════════════════════════════════════════════════
   Built from the join of what the engine says and what the human loop did about
   it, one line per action record. Ranked by exposure, largest first, because
   the only ordering an owner can act on before coffee is "which of these is the
   most money".

   A unit whose recommendation was REJECTED is NOT a leak here, and that is a
   decision worth stating: a person read the engine, disagreed, and recorded why.
   Re-raising it on this screen would be the dashboard overruling the dealership
   with the same argument it already lost. It appears in register 4 instead. */
function buildLeaks(engine, queue) {
  const units = Array.isArray(engine) ? engine : [];
  const rows = Array.isArray(queue) ? queue : [];
  const leaks = [];

  const unitOf = id => units.find(u => str(u.id) === str(id)) || null;
  const evidenceFor = (a, extra) => {
    const u = unitOf(a.unit_id);
    const e = [];
    e.push({ fact: `Action record ${str(a.id)} on unit ${str(a.unit_id)}${str(a.unit_model) ? ` (${str(a.unit_model)})` : ''}, status ${str(a.status) || 'not recorded'}`,
             source: 'v_inventory_action_queue' });
    if (str(a.engine_reason)) e.push({ fact: str(a.engine_reason), source: 'the engine, frozen at the moment this action was raised' });
    if (a.engine_still_agrees === true && n0(a.engine_now_days_in_stock) != null)
      e.push({ fact: `The engine still makes the same recommendation today, at ${num(a.engine_now_days_in_stock)} days in stock`, source: 'rpc/sentinel_inventory_actions, re-read on this load' });
    if (a.engine_still_agrees === false)
      e.push({ fact: 'The engine no longer makes the recommendation this action was raised on', source: 'rpc/sentinel_inventory_actions, re-read on this load' });
    if (u && up(u.holding_cost_state) !== 'COMPUTED')
      e.push({ fact: `How fast this margin is being eaten is ${str(u.holding_cost_state) || 'unstated'} — ${str(u.holding_cost_note) || 'no reason recorded'}`, source: 'v_inventory_profit_sentinel' });
    if (u && up(u.market_position).startsWith('UNKNOWN'))
      e.push({ fact: `Market position ${str(u.market_position)} — ${str(u.market_note) || 'no reason recorded'}`, source: 'v_inventory_profit_sentinel, over the competitor rows' });
    (extra || []).forEach(x => e.push(x));
    return e;
  };
  const sizeOf = a => ({
    word: n0(a.engine_impact_aed) == null ? 'NOT_COMPUTABLE' : (up(a.engine_impact_kind) === 'MARGIN_EXPOSED' ? 'EXPOSED' : 'NOT_COMPUTABLE'),
    amount: n0(a.engine_impact_aed),
    kind: str(a.engine_impact_kind) || 'NONE',
    basis: str(a.engine_impact_basis)
      || 'The engine attached no basis to this figure, so this screen states none on its behalf.',
  });
  const conf = a => ({
    level: str(a.engine_confidence) || 'UNSTATED',
    why: str(a.engine_confidence_basis)
      || 'The engine recorded no basis for its confidence, which is itself a gap in the finding.',
  });

  rows.forEach(a => {
    const s = up(a.status);
    const daysHeld = n0(a.days_open);

    if (s === 'APPROVED' && !str(a.executed_at)) {
      leaks.push(makeLeak({
        kind: 'DECIDED_NOT_DONE',
        what: `A decision was taken on ${str(a.unit_model) || str(a.unit_id)} and nothing has been recorded as done`,
        badge: 'Decided, not done',
        tone: 'hot',
        why: 'Somebody with authority approved this and no execution has been recorded since. The margin is still '
           + 'sitting in the car, and the dealership believes the matter is handled. That gap between a decision and '
           + 'an act is the leak — not the car.',
        evidence: evidenceFor(a, [
          { fact: `Approved ${ago(a.decided_at || a.proposed_at)}${str(a.decided_by_name) ? ` by ${str(a.decided_by_name)}` : ''}`
                + `${str(a.decided_by_authority) ? `, acting as ${str(a.decided_by_authority)}` : ''}`,
            source: 'v_inventory_action_queue.decided_at, decided_by_name, decided_by_authority' },
          { fact: str(a.assigned_to_name) ? `Assigned to ${str(a.assigned_to_name)}`
                : str(a.assigned_role) ? `Assigned to the ${str(a.assigned_role)} role and to nobody by name`
                : 'Assigned to nobody at all',
            source: 'v_inventory_action_queue.assigned_to_name, assigned_role' },
          { fact: 'executed_at is null — no person has recorded carrying this out',
            source: 'v_inventory_action_queue.executed_at' },
        ]),
        note: str(a.outcome_sentence),
        size: sizeOf(a),
        confidence: {
          level: 'HIGH',
          why: 'The leak itself is an approval with no execution recorded against it, which is two stored columns and '
             + 'not a judgement. ' + (str(a.engine_confidence)
               ? `The underlying recommendation is graded ${str(a.engine_confidence)} by the engine: ${str(a.engine_confidence_basis) || 'no basis recorded'}`
               : 'The engine recorded no confidence in the recommendation behind it.'),
        },
        action: {
          ask: 'Record that it was carried out, or withdraw it. Either answer closes the gap; leaving it open does not.',
          screen: 'actions', label: 'Open the Action Center',
        },
        heldDays: daysHeld,
        sortValue: n0(a.engine_impact_aed),
      }));
      return;
    }

    if (s === 'EXECUTION_FAILED') {
      const reason = str(a.execution_failure);
      /* A failure reason of four letters is not a reason, and saying so is more
         useful than rendering it as though it were one. The test is on length
         and on the absence of a space, which is what a placeholder looks like;
         it makes no judgement about the words themselves. */
      const reasonUsable = reason.length >= 12 && /\s/.test(reason);
      leaks.push(makeLeak({
        kind: 'ATTEMPT_FAILED',
        what: `Work on ${str(a.unit_model) || str(a.unit_id)} was attempted and did not happen`,
        badge: 'Attempted, not carried out',
        tone: 'hot',
        why: 'This one is worse than an untouched action: the dealership has already spent the decision and the '
           + 'attempt, and the margin is still where it was. Nothing re-raises it automatically, so it stops here '
           + 'unless a person picks it up.',
        evidence: evidenceFor(a, [
          { fact: `Execution attempted ${ago(a.executed_at)}${str(a.executed_by_name) ? ` by ${str(a.executed_by_name)}` : ''} and recorded as not carried out`,
            source: 'v_inventory_action_queue.executed_at, execution_failure' },
          reasonUsable
            ? { fact: `Recorded reason: ${reason}`, source: 'v_inventory_action_queue.execution_failure' }
            : { fact: `The recorded failure reason is ${reason ? `"${reason}"` : 'empty'}, which is not a reason anybody can act on`,
                source: 'v_inventory_action_queue.execution_failure' },
          { fact: 'The action is closed, so it is no longer in the live queue and nothing will surface it again',
            source: 'v_inventory_action_queue.is_live' },
        ]),
        note: str(a.outcome_sentence),
        size: sizeOf(a),
        confidence: {
          level: reasonUsable ? 'HIGH' : 'MEDIUM',
          why: reasonUsable
            ? 'A recorded failure with a recorded reason. Both are stored columns.'
            : 'The failure is stored and certain. Why it failed is not: the reason column holds a placeholder, so '
              + 'nothing can be said about whether it would fail again.',
        },
        action: {
          ask: 'Raise it again, or record why it is being left. A failed attempt with no follow-up is the same as '
             + 'never having tried, except that it has already cost somebody a decision.',
          screen: 'actions', label: 'Open the Action Center',
        },
        heldDays: daysHeld,
        sortValue: n0(a.engine_impact_aed),
      }));
      return;
    }

    if (a.awaiting_decision === true) {
      leaks.push(makeLeak({
        kind: 'WAITING_ON_A_PERSON',
        what: `${str(a.unit_model) || str(a.unit_id)} is waiting on somebody to answer`,
        badge: 'Nobody has answered',
        tone: 'warm',
        why: 'The engine raised this and no person has said yes or no. Waiting is a decision the dealership is '
           + 'taking without recording it.',
        evidence: evidenceFor(a, [
          { fact: `Raised ${ago(a.proposed_at)}${str(a.proposed_by_name) ? ` by ${str(a.proposed_by_name)}` : ''}, undecided for ${num(daysHeld)} ${plural(daysHeld, 'day', 'days')}`,
            source: 'v_inventory_action_queue.proposed_at, days_open' },
        ]),
        note: str(a.cost_of_doing_nothing),
        size: sizeOf(a),
        confidence: conf(a),
        action: { ask: 'Approve it, reject it with a reason, or defer it to a date. All three are answers; silence is not.',
                  screen: 'actions', label: 'Open the Action Center' },
        heldDays: daysHeld,
        sortValue: n0(a.engine_impact_aed),
      }));
      return;
    }

    if (a.deferral_now_due === true) {
      leaks.push(makeLeak({
        kind: 'DEFERRAL_DUE',
        what: `The wait somebody chose on ${str(a.unit_model) || str(a.unit_id)} has run out`,
        badge: 'Deferral expired',
        tone: 'warm',
        why: 'Deferring is a legitimate answer with a date on it. The date has passed, so the question is open again '
           + 'and nothing has re-asked it.',
        evidence: evidenceFor(a, [
          { fact: `Deferred until ${dubaiStamp(a.defer_until)}, which is in the past`,
            source: 'v_inventory_action_queue.defer_until, deferral_now_due' },
        ]),
        size: sizeOf(a),
        confidence: conf(a),
        action: { ask: 'Answer it now, or defer it again to a date somebody will honour.',
                  screen: 'actions', label: 'Open the Action Center' },
        heldDays: daysHeld,
        sortValue: n0(a.engine_impact_aed),
      }));
      return;
    }

    if (str(a.escalated_at)) {
      leaks.push(makeLeak({
        kind: 'NO_APPROVER',
        what: `${str(a.unit_model) || str(a.unit_id)} is stuck because nobody here may approve it`,
        badge: 'No approver',
        tone: 'hot',
        why: 'An escalation is a request for a person, not a decision. The action stays open and nothing about the '
           + 'unit has changed.',
        evidence: evidenceFor(a, [
          { fact: str(a.escalation_reason) || 'The database recorded no reason on this escalation, which is itself a gap',
            source: 'v_inventory_action_queue.escalation_reason' },
        ]),
        size: sizeOf(a),
        confidence: conf(a),
        action: { ask: 'Give somebody at this dealership the authority to decide, or decide it as the account owner.',
                  screen: 'settings', label: 'Open Settings' },
        heldDays: daysHeld,
        sortValue: n0(a.engine_impact_aed),
      }));
    }
  });

  /* A unit the engine flags that nobody has ever been asked about. Not the same
     as an action waiting: this is the engine noticing and nothing at all having
     happened, which is the gap between the software and the building. */
  const everRaised = new Set(rows.map(r => str(r.unit_id)));
  units.filter(u => up(u.recommendation) && up(u.recommendation) !== 'HOLD' && !everRaised.has(str(u.id)))
    .forEach(u => {
      leaks.push(makeLeak({
        kind: 'NEVER_RAISED',
        what: `The engine flags ${str(u.model) || str(u.id)} and nobody has ever been asked about it`,
        badge: 'Never raised',
        tone: 'warm',
        why: 'The engine has been making this recommendation every day and no action record exists for this unit at '
           + 'all, so nobody in the building has been asked to answer it once.',
        evidence: [
          { fact: str(u.reason) || 'The engine recorded no reason, which is itself a gap', source: 'v_inventory_profit_sentinel.reason' },
          { fact: `${num(u.days_in_stock)} days in stock, band ${str(u.aging_band) || 'unstated'}, overall risk ${str(u.overall_risk) || 'unstated'}`,
            source: 'inventory.acquired_at against this dealership’s own ageing bands' },
          { fact: `Market position ${str(u.market_position) || 'unstated'} — ${str(u.market_note) || 'no reason recorded'}`,
            source: 'v_inventory_profit_sentinel, over the competitor rows' },
        ],
        size: {
          word: n0(u.impact_aed) == null ? 'NOT_COMPUTABLE' : (up(u.impact_kind) === 'MARGIN_EXPOSED' ? 'EXPOSED' : 'NOT_COMPUTABLE'),
          amount: n0(u.impact_aed),
          kind: str(u.impact_kind) || 'NONE',
          basis: str(u.impact_basis) || 'The engine attached no basis to this figure.',
        },
        confidence: { level: str(u.confidence) || 'UNSTATED',
                      why: str(u.confidence_basis) || 'The engine recorded no basis for its confidence.' },
        action: { ask: `Raise it so a person answers it. The engine recommends ${str(u.recommendation)}; it is not `
                     + 'naming a price and cannot, because it holds no comparable it is willing to stand behind.',
                  screen: 'actions', label: 'Open the Action Center' },
        heldDays: n0(u.days_in_stock),
        sortValue: n0(u.impact_aed),
      }));
    });

  /* Largest exposure first; a line with no figure sorts last rather than as
     zero, because "no figure" is not "no money". */
  leaks.sort((a, b) => {
    const av = a.sortValue, bv = b.sortValue;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  });
  leaks.forEach((l, i) => { l.rank = i + 1; });
  return leaks;
}

/* Leaks the customer side of the business could produce, kept in their own
   function because they are sized by a different engine with a different — and
   today, absent — notion of value. */
function buildLeadLeaks(leads) {
  const rows = Array.isArray(leads) ? leads : [];
  return rows
    .filter(l => l.lead_is_open === true && up(l.recommended_action) && up(l.recommended_action) !== 'NO_ACTION')
    .map(l => makeLeak({
      kind: 'LEAD_AT_RISK',
      what: `${str(l.lead_name) || `Lead #${str(l.lead_id)}`} needs somebody to act`,
      badge: str(l.risk_level) || 'At risk',
      tone: 'hot',
      why: str(l.action_reason) || 'The engine recommends an action and recorded no reason, which is itself a gap.',
      evidence: [
        { fact: str(l.state_basis) || `The engine puts this enquiry in state ${str(l.state) || 'unstated'}`, source: 'v_lead_recovery.state_basis' },
        { fact: str(l.risk_basis) || 'No risk basis recorded', source: 'v_lead_recovery.risk_basis' },
        { fact: `Silence: ${str(l.silence_state) || 'unstated'} — and the detector that corroborates it reads ${str(l.silence_detector_state) || 'unstated'}`,
          source: 'v_lead_recovery.silence_state, silence_detector_state' },
        { fact: str(l.owner_state) === 'ASSIGNED' ? `Owned by ${str(l.owner_name) || 'somebody unnamed'}` : 'Nobody owns this enquiry',
          source: 'v_lead_recovery.owner_state' },
      ],
      /* Never a figure. opportunity_value_state is UNKNOWN_NO_LINK on every
         lead in this database — no lead carries a budget and no column links a
         lead to a unit — so this engine can name the leak and cannot size it,
         and saying that is the honest output. */
      size: { word: 'NOT_COMPUTABLE', amount: null, kind: str(l.opportunity_value_state) || 'UNKNOWN',
              basis: str(l.opportunity_value_basis)
                || 'No enquiry in this database carries a budget and nothing links an enquiry to a unit, so there is '
                 + 'no value to put on it. Not zero — unknown.' },
      confidence: { level: str(l.confidence) || 'UNSTATED',
                    why: str(l.confidence_basis) || 'The engine recorded no basis for its confidence.' },
      action: { ask: str(l.recommended_action).replace(/_/g, ' ').toLowerCase(),
                screen: 'leadrecovery', label: 'Open Lead Recovery' },
      heldDays: null,
      sortValue: null,
    }));
}

/* ══════════════════════════════════════════════════════════════════════════
   The screen
   ══════════════════════════════════════════════════════════════════════════ */
SCREENS.moneyleaks = async host => {
  /* Every visit re-reads. See the note on `shared` above for what this is
     repairing and why a stale register here is worse than a slow one. */
  resetReads();

  /* ── The design system is scoped to a container THIS SCREEN OWNS ──────────
     `.ds-screen` is the class lib/design-system.css gates its handful of
     upgrades to existing chrome behind. It goes on a wrapper this screen
     appends, and NOT on `#screen`, because lib/nav.js empties `#screen` between
     renders without touching its classes: a class set there would follow the
     operator onto Leads and Inventory and restyle two screens nobody converted.
     A wrapper cannot leak — go() removes it with the rest of the subtree. */
  const root = el('div', 'ds-screen');
  host.appendChild(root);

  /* ────────────────────────────────────────────────────────────────────────
     P1 · The answer, in four numbers
     ──────────────────────────────────────────────────────────────────────── */
  panel(root, {
    title: "Today's money leaks",
    sub: 'One question: where is money leaking right now, and what should be done about it. A check that came back '
       + 'clear and a check that could not run are counted separately and never added together',
    actions: linkBtn('actions', 'Open the Action Center') + ' ' + linkBtn('revenue', 'Open Revenue Recovery'),
    load: async () => {
      /* Every read the four registers below use, so the tiles are computed from
         exactly the rows those registers render. An earlier draft left the
         readiness read out of this strip and it counted one check fewer than the
         panel underneath it — two numbers for one fact, which is the defect
         NEXUS_INVARIANTS.md calls one figure, one derivation. */
      const [e, q, l, c, w, r] = await Promise.all([settle(readEngine()), settle(readQueue()), settle(readLeads()),
                                                    settle(readCoverage()), settle(readWorkflows()),
                                                    settle(readReadiness())]);
      if (e.err && q.err && l.err && c.err && w.err && r.err) throw q.err;
      return { e, q, l, c, w, r };
    },
    render: ({ e, q, l, c, w, r }) => {
      const engine = e.err ? null : (e.v || []);
      const queue  = q.err ? null : (q.v || []);
      const leads  = l.err ? null : (l.v || []);
      const cov    = c.err ? null : one(c.v);
      const flows  = w.err ? null : (w.v || []);

      const leaks = (engine && queue) ? buildLeaks(engine, queue) : null;
      const leadLeaks = leads ? buildLeadLeaks(leads) : null;
      const allLeaks = (leaks && leadLeaks) ? leaks.concat(leadLeaks) : null;

      /* THE HEADLINE. Sized rows only, one kind only, through the shared
         derivation, with its own denominator printed. See the file header. */
      const sized = leaks ? leaks.filter(x => up(x.size.word) === 'EXPOSED') : [];
      const t = expose(sized, x => x.size.amount, x => x.size.kind);

      /* ── The one rendering decision in this strip that is not a like-for-like
            move, and why it is the safer of the two ──────────────────────────
         A tile whose read FAILED used to print `num(null)`, which is an em
         dash. readFailed()'s own comment forty lines up says why that is wrong:
         "a dash beside 'Leaks today' reads as zero, and zero is a finding this
         screen makes on purpose and must be able to make credibly." The dash
         was left in place because there was nowhere else for the words to go.
         There is now — the tile carries a state rail and a note — so the figure
         slot says "Not read" in words, at heading size rather than figure size,
         with the unknown rail beside it and the full sentence one click away.
         Nothing about WHAT is read or computed changed; the null still comes
         from the same failed promise. */
      const unread = dsChip('unread', 'unknown');

      const leakTile = allLeaks == null
        ? dsStat({ label: 'Leaks today', value: 'Not read', words: true, intent: 'unknown', meta: unread,
            note: readFailed('The engines behind this count', q.err || e.err || l.err) })
        : dsStat({ label: 'Leaks today', value: num(allLeaks.length),
            intent: allLeaks.length ? 'danger' : 'success',
            meta: allLeaks.length ? 'ranked below, worst first' : 'every check that could run came back clear',
            note: para(allLeaks.length
              ? 'Each one below carries what is leaking, the rows behind it, the size in one of four named money '
                + 'words, how confident and why, and one thing to do.'
              : 'Every check that could run came back clear. That is a finding, not an empty screen — the checks that '
                + 'could NOT run are counted separately, to the right.') });

      const moneyTile = leaks == null
        ? dsStat({ label: 'Gross margin behind them', value: 'Not read', words: true, intent: 'unknown', meta: unread,
            note: readFailed('The exposure figure', q.err || e.err) })
        : dsStat({ label: 'Gross margin behind them',
            value: t.total == null ? 'Not computable' : aed(t.total),
            words: t.total == null,
            intent: t.total == null ? 'unknown' : 'warning',
            /* The denominator stays on the SURFACE, not behind the note. A
               total whose denominator is one click away is a total presented
               without one, and that is the aggregate-shaped lie this screen
               exists to refuse. The prose around it is what got demoted. */
            meta: `${num(t.n)} of ${num(t.of)} carry a figure`,
            note: para(esc(exposureLine(t, plural(sized.length, 'that leak', 'those leaks'))))
              + para('This is the only figure on this screen that adds anything up.') });

      /* Measured-clear and not-measured are counted from the same reads the
         registers below render, so the tiles cannot disagree with the panels. */
      const ready = r.err ? null : (r.v || []);
      /* Both counts come from the same two functions the registers below call,
         with the same arguments, so a tile can never report a different number
         from the table it introduces. */
      const clear = (engine || queue || leads) ? measuredClear(engine, queue, leads).length : null;
      const unmeasured = notMeasured(engine, cov, leads, flows, ready).length;

      /* A source that failed contributes no CLEAR checks — an unread check is
         not a clear one — so the count is real but incomplete, and the tile says
         which sources were unread rather than letting the number stand alone. */
      const unreadSources = [e.err && 'the inventory engine', q.err && 'the action lane', l.err && 'Lead Recovery']
        .filter(Boolean);
      const clearTile = clear == null
        ? dsStat({ label: 'Checks that came back clear', value: 'Not read', words: true, intent: 'unknown', meta: unread,
            note: readFailed('The clear register', q.err || e.err || l.err) })
        : dsStat({ label: 'Checks that came back clear', value: num(clear),
            intent: unreadSources.length ? 'warning' : 'success',
            meta: unreadSources.length
              ? dsChip('incomplete', 'warning') + '<span>some sources unread</span>'
              : 'each names its denominator',
            note: para('Each one names how many rows it looked at. A zero with a denominator is a finding; a zero '
              + 'without one is a guess.')
              + (unreadSources.length
                  ? para(`Incomplete: ${esc(unreadSources.join(', '))} could not be read, so any check that rests on `
                    + plural(unreadSources.length, 'it', 'them') + ' is missing here rather than clear.')
                  : '') });

      const unmeasuredTile = dsStat({ label: 'Checks that could not run', value: num(unmeasured),
        intent: unmeasured ? 'warning' : 'neutral',
        meta: 'unknown is not zero',
        note: para('Unknown is not zero. Each one says since when, why, and the single thing that would light it '
          + 'up.') });

      /* The definitional caveat. The first sentence of EXPOSURE_CAVEAT is on the
         surface VERBATIM rather than paraphrased: a shortened restatement of a
         money definition is a second copy of a business fact, which is the thing
         this screen imports expose() from overview.js to avoid. */
      const caveat = dsCallout({
        intent: 'info', name: 'info',
        lede: 'What the money figure is, and what it is not.',
        body: `<span>${esc(firstSentence(EXPOSURE_CAVEAT))}</span>`,
        noteLabel: 'in full',
        note: para(esc(EXPOSURE_CAVEAT))
          + para('Nothing on this page adds a customer figure to a unit figure. No enquiry in this database '
            + 'carries a value at all, so the customer half of a true "revenue at risk" does not exist at any '
            + 'confidence and is not filled in.'),
      });

      return `<div style="padding:16px">${dsStatRow(leakTile + moneyTile + clearTile + unmeasuredTile)}`
        + `<div style="margin-top:12px">${caveat}</div></div>`;
    },
  }).then(wireGo);

  /* ────────────────────────────────────────────────────────────────────────
     P2 · Register 1 — what is leaking

     Was a stack of `.list-item` blocks, each of which set out WHY, the
     EVIDENCE, the CONFIDENCE and the ACTION as paragraphs — around 200px per
     leak, so the second one was already below the fold on a 1440×900 screen and
     the third was two scrolls away. It is a table now, one 38px row per leak,
     ranked exactly as before, with all four of those parts inside the row's own
     disclosure. Nothing was dropped; the worst leak's row is opened by default
     so the evidence is on screen without a click.
     ──────────────────────────────────────────────────────────────────────── */
  panel(root, {
    title: 'What is leaking, worst first',
    sub: 'Ranked by the money behind it. Every line carries WHY, the EVIDENCE, the SIZE in a named word, the '
       + 'CONFIDENCE and one ACTION — and a line that cannot carry all six is shown as a fault, not as a row',
    actions: linkBtn('actions', 'Open the Action Center'),
    load: async () => {
      const [e, q, l] = await Promise.all([settle(readEngine()), settle(readQueue()), settle(readLeads())]);
      if (e.err && q.err && l.err) throw q.err;
      return { e, q, l };
    },
    render: ({ e, q, l }) => {
      if (q.err || e.err) {
        /* The heading keeps its exact wording. QUALITY_GATE.mjs's render lane
           detects a screen in the error state by matching /Couldn.t load/ on the
           rendered HTML, so rephrasing it would silently switch that check off
           for this screen. */
        return dsEmpty({
          intent: 'danger', name: 'danger',
          title: "Couldn't load the leak register",
          body: 'The action lane or the inventory engine could not be read, so this register is not empty — it is '
              + 'unread. Nothing is being claimed about whether anything is leaking.',
        });
      }
      const leaks = buildLeaks(e.v || [], q.v || []);
      const leadLeaks = l.err ? [] : buildLeadLeaks(l.v || []);
      const all = leaks.concat(leadLeaks);

      const leadNote = l.err
        ? dsCallout({
            intent: 'warning', name: 'alert',
            lede: 'The customer side of this register is missing, not clear.',
            body: '<span>Lead Recovery could not be read.</span>',
            noteLabel: 'what that means',
            note: para('The customer side of this register is missing, not clear.')
              + para(`Lead Recovery could not be read (${esc(str(l.err.message) || 'no reason given')}), so any `
                + 'enquiry that needs chasing is absent from the list above rather than absent from the '
                + 'dealership.'),
          })
        : '';

      if (!all.length) {
        return dsEmpty({
          intent: 'success', name: 'check',
          title: 'Nothing is leaking that this product can evidence today',
          body: 'Every engine that holds real data was asked and each came back clear. That is the correct answer, '
              + 'not an empty screen: the checks are listed below with the number of rows each one looked at, and '
              + 'separately the checks that could not run at all — because a question nobody could ask is not a '
              + 'question that came back clean.',
        }) + leadNote;
      }

      const faults = all.filter(x => x.missing.length);
      const good = all.filter(x => !x.missing.length);

      const HEAD = [{ label: '#', align: 'r' }, 'What is leaking', { label: 'Size', align: 'r' },
                    'Money word', 'Confidence', ''];
      const TEMPLATE = '28px minmax(0,1fr) 128px 132px 104px 16px';

      /* Every row starts CLOSED, including the worst one, and that is a
         deliberate reversal of the first draft of this conversion.

         Opening rank 1 by default put its evidence on screen without a click,
         which reads well — and measured at 1440x900 it filled the entire fold
         with one leak, so the operator saw exactly as many rows as the old
         paragraph layout did. The whole argument for a table is that the
         morning question is an ORDER OF WORK: how many, which is worst, how
         much. Three closed rows answer that at a glance; one open row answers
         it for one leak and hides the other two. The evidence is one click
         away, and the panel's own action sits in its head where it is reachable
         without opening anything. */
      const items = good.map(x => {
        const sz = sizeParts(x.size);
        return {
          cells: [
            /* Rank 0 is not rank zero. buildLeaks() numbers its lines 1..n by
               exposure; buildLeadLeaks() appends lines that carry no figure to
               rank by and leaves makeLeak()'s default of 0 on them. Painting
               that 0 in the rank column — which the old layout did — put a
               "0" above a "1" and a "2" in a list whose whole promise is
               "worst first". It is rendered as unranked, and the row's own
               disclosure says why. */
            `<span class="ds-row__rank${x.rank ? '' : ' ds-t-tertiary'}">${x.rank ? esc(String(x.rank)) : '–'}</span>`,
            `<span class="ds-row__title"><span>${esc(x.what)}</span>${dsChip(x.badge, dsIntent(x.tone))}`
              + (x.heldDays != null
                  ? dsChip(`${num(x.heldDays)} ${plural(x.heldDays, 'day', 'days')}`, 'neutral', { dot: false, name: 'clock' })
                  : '')
              + '</span>',
            `<span class="ds-row__num${sz.words ? ' ds-row__num--words' : ''}">${sz.figure}</span>`,
            `<span>${sz.chip}</span>`,
            `<span>${dsChip(str(x.confidence.level), confIntent(x.confidence.level), { verbatim: true })}</span>`,
            `<span class="ds-row__chev">${icon('chevron')}</span>`,
          ],
          detail: dsDetailGrid([
            ['Why this is a leak', esc(x.why)],
            ['The engine’s own words', x.note ? esc(str(x.note)) : ''],
            ['Evidence', dsEvidence(x.evidence.map(ev => ({ fact: esc(str(ev.fact)), source: str(ev.source) })))],
            [`Confidence — ${str(x.confidence.level)}`, esc(str(x.confidence.why))],
            ['What the size means', sz.note],
            ['What to do', esc(str(x.action.ask))
              + `<div style="margin-top:8px">${linkBtn(x.action.screen, x.action.label)}</div>`],
            ['Open for', x.heldDays != null ? `${num(x.heldDays)} ${plural(x.heldDays, 'day', 'days')}` : ''],
            ['Rank', x.rank ? '' : 'Unranked. The order above is by the money behind each line, and this one is '
              + 'not sized — which is a statement about what the database holds, not about how urgent it is.'],
          ]),
        };
      });

      return faults.map(leakFault).join('')
        + dsRowList(HEAD, items, { template: TEMPLATE, caption: 'What is leaking, ranked by the money behind it' })
        + (leadNote ? `<div style="padding:12px 16px">${leadNote}</div>` : '');
    },
  }).then(wireGo);

  /* ────────────────────────────────────────────────────────────────────────
     P3 · Register 2 — checks that came back clear
     ──────────────────────────────────────────────────────────────────────── */
  panel(root, {
    title: 'Checks that came back clear',
    sub: 'A zero is only a finding when it says what it counted. Each of these names its denominator',
    load: async () => {
      const [e, q, l] = await Promise.all([settle(readEngine()), settle(readQueue()), settle(readLeads())]);
      if (e.err && q.err && l.err) throw q.err;
      return { e, q, l };
    },
    render: ({ e, q, l }) => {
      const rows = measuredClear(e.err ? null : e.v, q.err ? null : q.v, l.err ? null : l.v);
      const notRun = [];
      if (e.err) notRun.push('the inventory engine');
      if (q.err) notRun.push('the action lane');
      if (l.err) notRun.push('Lead Recovery');
      const warn = notRun.length
        ? `<div style="padding:12px 16px 0">${dsCallout({
            intent: 'warning', name: 'alert',
            lede: 'Some checks are absent from this list because they could not be run at all.',
            body: `<span>Could not be read: ${esc(notRun.join(', '))}.</span>`,
            noteLabel: 'what that means',
            note: para('Some checks are absent from this list because they could not be run at all.')
              + para(`Could not be read: ${esc(notRun.join(', '))}. Those checks are neither clear nor failing — `
                + 'they are unread, and they are not counted anywhere on this screen as clear.'),
          })}</div>`
        : '';
      if (!rows.length) return warn + dsEmpty({ name: 'scan',
        title: 'No check came back clear',
        body: 'Either every check found something, or none of them could run. The two registers either side of this '
            + 'one say which.' });
      return warn + dsTable([
        { label: 'What was checked', strong: true, render: r => said(r.what, 'The full wording of this check') },
        { label: 'Over how many rows', prose: true, render: r => said(r.over, 'The denominator, in full') },
        /* ── The one place this conversion refused to keep a colour ──────────
           This column was `pill('Clear', 'ok')` for every row, unconditionally.
           measuredClear() can emit a row whose subject begins "FAULT — the
           first-response target is reporting a state this screen does not
           know", and that row was painted the same green as a measured clear —
           a check that BROKE, reported in the colour reserved for a check that
           looked and found nothing.

           Nothing in measuredClear() changed to fix it: the rule is read off
           the wording that function already writes, in the renderer, which is
           where a colour decision belongs. A fault is UNKNOWN, because that is
           what it is — the screen no longer knows what the engine is saying, so
           it cannot claim the check came back clear and must not claim it came
           back dirty either. */
        { label: 'Result', mid: true, render: r => (/^FAULT\b/.test(str(r.what))
            ? dsChip('Fault', 'unknown', { name: 'question' })
            : dsChip('Clear', 'success', { name: 'check' })) },
      ], rows, { caption: 'Checks that came back clear, each with its denominator' });
    },
  }).then(wireGo);

  /* ────────────────────────────────────────────────────────────────────────
     P4 · Register 3 — checks that could not run
     ──────────────────────────────────────────────────────────────────────── */
  panel(root, {
    title: 'Checks that could not run — unknown is not zero',
    sub: 'The engine could not look. Each line says since when, why, and the one thing that would light it up. This '
       + 'is the roadmap made concrete rather than a feature list',
    actions: linkBtn('inventory', 'Open Inventory') + ' ' + linkBtn('dealrescue', 'Open Deal Rescue'),
    load: async () => {
      const [e, c, l, w, r] = await Promise.all([settle(readEngine()), settle(readCoverage()), settle(readLeads()),
                                                 settle(readWorkflows()), settle(readReadiness())]);
      if (e.err && c.err && l.err && w.err && r.err) throw c.err;
      return { e, c, l, w, r };
    },
    render: ({ e, c, l, w, r }) => {
      const rows = notMeasured(e.err ? null : e.v, c.err ? null : one(c.v), l.err ? null : l.v,
                               w.err ? null : w.v, r.err ? null : r.v);
      if (!rows.length) {
        return dsEmpty({ name: 'shield',
          title: 'Every check this screen makes could be run',
          body: 'Nothing is being withheld for want of data. That has not been true of this database before, so if '
              + 'you are reading it, check that the reads above actually returned rows.' });
      }
      return dsTable([
        { label: 'What is not measured', strong: true, render: x => said(x.what, 'What is not measured, in full') },
        { label: 'Since / how much', prose: true, render: x => said(x.since, 'Since when, in full') },
        { label: 'Why', prose: true, render: x => said(x.why, 'Why this cannot be measured, in full') },
        { label: 'What would light it up', prose: true,
          render: x => `<div class="ds-t-warning">${said(x.unlock, 'What would light this up, in full')}</div>` },
        { label: 'Kind', mid: true,
          render: x => dsChip(x.kind, x.kind === 'OPERATIONAL' ? 'warning' : 'unknown', { verbatim: true }) },
      ], rows, { caption: 'Checks that could not run, and what would light each one up' });
    },
  }).then(wireGo);

  /* ────────────────────────────────────────────────────────────────────────
     P5 · Register 4 — what this screen refuses to call a leak
     ──────────────────────────────────────────────────────────────────────── */
  panel(root, {
    title: 'What this screen refuses to call a leak',
    sub: 'The alert feed, audited against the engines rather than trusted. A competitor’s dashboard would show '
       + 'every one of these as a finding; showing why they are not is the trust the product is selling',
    actions: linkBtn('conversations', 'Open Conversations') + ' ' + linkBtn('competitors', 'Open Competitors'),
    load: async () => {
      const [a, e, q] = await Promise.all([settle(readAttention()), settle(readEngine()), settle(readQueue())]);
      if (a.err) throw a.err;
      return { a, e, q };
    },
    render: ({ a, e, q }) => {
      const items = a.v || [];
      const engine = e.err ? null : (e.v || []);
      const queue  = q.err ? null : (q.v || []);

      /* Measured, not asserted. If the engine could not be read, the sentence
         says that rather than standing in for it — an unreadable engine is not
         evidence that every unit is UNKNOWN. */
      function engineMarketNote(units) {
        if (!Array.isArray(units) || !units.length)
          return 'The inventory engine could not be read on this pass, so nothing is claimed about market position. '
               + 'A price difference is only a finding once a competitor row meets the match quality this dealership '
               + 'accepts, and that has not been checked here.';
        const known = units.filter(u => {
          const m = up(u.market_position);
          return m && m !== 'UNKNOWN' && m !== 'NOT_COMPUTABLE' && m !== 'UNKNOWN_NO_COMPARABLES';
        });
        if (!known.length)
          return `The inventory engine grades market position UNKNOWN on all ${num(units.length)} `
               + `${plural(units.length, 'unit', 'units')}, because no competitor row meets the match quality this `
               + 'dealership accepts. A price difference measured against a listing nobody can tie to our car is '
               + 'arithmetic, not a finding — and the competitor rows say so themselves.';
        return `The inventory engine grades market position on ${num(known.length)} of ${num(units.length)} `
             + `${plural(units.length, 'unit', 'units')}, so some of these differences may be real. They are still `
             + 'refused HERE, because this alert compares a listing price rather than the engine’s graded '
             + 'position — the engine’s own REPRICE recommendation is the finding, and it is in the register '
             + 'above with its evidence.';
      }
      const ranked = (engine && queue) ? new Set(buildLeaks(engine, queue).map(x => str(x.what))) : null;

      /* One verdict per alert KIND, because the reason is a property of the
         kind and not of the row. Each verdict is a statement about evidence, not
         about the customer or the car. */
      const VERDICT = {
        /* ── Two of these were asserted, and one of them was false ──────────
           `unanswered_chat` said "Not one WhatsApp thread in this database
           resolves to a lead record". That is true of ALBA CARS today and false
           of a dataset where fourteen of seventeen resolve — a caption asserting
           a database-wide fact from inside a static map, which is the thing
           CLAUDE.md's "check captions against the branch they sit in" rule
           exists to catch, found seven times here before this one.

           `v_needs_attention` carries only kind, severity, ref, title, detail,
           at and screen — no resolution field — so this panel cannot measure
           that claim and must not make it. The rewritten reason says only what
           is true of any unanswered thread: the alert names a THREAD, and a
           money figure needs a linked lead carrying an opportunity value. That
           holds whatever the resolution rate is.

           `undercut` DOES have its evidence to hand — the engine rows are
           loaded on this panel — so it is measured rather than asserted. */
        unanswered_chat: {
          verdict: 'REFUSED',
          why: 'This alert names a conversation thread, not a customer with a value. Putting money against it needs '
             + 'a lead the thread resolves to AND an opportunity value on that lead, and this screen does not have '
             + 'the second one for any lead on file. The threads are real and are listed on Conversations; calling '
             + 'them a money leak would be inventing the amount, and possibly the customer.',
        },
        undercut: {
          verdict: 'REFUSED',
          why: engineMarketNote(engine),
        },
        inventory_aging: {
          verdict: 'ALREADY RANKED',
          why: 'This is the same unit the inventory engine flags, and it is in the leak register above with its '
             + 'evidence and its exposure. It is named here so the two lists can be reconciled, not counted twice.',
        },
        workflow_failure: {
          verdict: 'NOT A MONEY LEAK',
          why: 'A workflow that is failing is a reason a check could not run, which is the register above this one. '
             + 'It is not itself money going missing, and reporting it as money would be this dashboard inventing an '
             + 'amount for its own broken plumbing.',
        },
      };

      const kinds = new Map();
      items.forEach(i => {
        const k = str(i.kind) || 'untyped';
        if (!kinds.has(k)) kinds.set(k, []);
        kinds.get(k).push(i);
      });

      const rows = [...kinds.entries()].map(([k, list_]) => {
        const v = VERDICT[k];
        return {
          kind: k,
          n: list_.length,
          verdict: v ? v.verdict : 'NO RULE',
          why: v ? v.why
            : 'This screen has no rule for that alert kind, so it is neither counted as a leak nor cleared. It is '
            + 'shown exactly as the alert feed holds it and somebody should decide which it is.',
          example: str(list_[0].title) || str(list_[0].ref),
          detail: str(list_[0].detail),
        };
      });

      const confirmedNote = `<div style="padding:12px 16px 0">${dsCallout({
        intent: 'info', name: 'coins',
        lede: 'And the money that is on file is not a leak either.',
        body: '<span>Confirmed sale revenue exists here and nothing on this screen takes credit for it.</span>'
          + `<div style="margin-top:8px">${linkBtn('attribution', 'Open Attribution')}</div>`,
        noteLabel: 'why not',
        note: para('There is confirmed sale revenue in this database. It is not shown on this screen as a leak, as '
          + 'a recovery or as anything NEXUS did: the attribution chain grades its campaign hop UNKNOWN and its '
          + 'margin NOT COMPUTABLE, so nothing here may take credit for it. Attribution is the screen that says '
          + 'so, hop by hop.'),
      })}</div>`;

      const reconciled = ranked
        ? dsCallout({ intent: 'neutral', name: 'info',
            lede: `Reconciled against ${num(ranked.size)} ${plural(ranked.size, 'line', 'lines')} above.`,
            body: '<span>An alert marked ALREADY RANKED is not counted a second time here.</span>',
            note: para(`Reconciled against the ${num(ranked.size)} ${plural(ranked.size, 'line', 'lines')} in the `
              + 'leak register above: an alert marked ALREADY RANKED appears there with its evidence, and is not '
              + 'counted a second time here.') })
        : dsCallout({ intent: 'unknown', name: 'question',
            lede: 'These alerts have not been reconciled against the leak register.',
            body: '<span>The leak register could not be read on this pass.</span>',
            note: para('The leak register could not be read on this pass, so these alerts have not been reconciled '
              + 'against it. Nothing is being claimed about which of them is also above.') });

      if (!items.length) {
        return dsEmpty({ name: 'bellOff',
          title: 'The alert feed is empty',
          body: 'There is nothing to audit. That is a statement about the alert feed, not about the dealership.',
        }) + confirmedNote;
      }

      return dsTable([
        { label: 'Alert kind', strong: true, mid: true, render: x => mono(x.kind) },
        { label: 'Items', align: 'r', mid: true, render: x => num(x.n) },
        { label: 'Verdict', mid: true, render: x => dsChip(x.verdict, x.verdict === 'ALREADY RANKED' ? 'info'
            : x.verdict === 'NO RULE' ? 'unknown' : 'success') },
        { label: 'Why', prose: true, render: x => said(x.why, 'Why this is refused, in full') },
        { label: 'For example', prose: true,
          render: x => said(x.example + (x.detail ? ` · ${x.detail}` : ''), 'The example, in full') },
      ], rows, { caption: 'The alert feed, audited against the engines' })
        + `<div style="padding:12px 16px 0">${reconciled}</div>` + confirmedNote;
    },
  }).then(wireGo);

  /* ────────────────────────────────────────────────────────────────────────
     P6 · The four money words, and what NEXUS has actually earned
     ──────────────────────────────────────────────────────────────────────── */
  panel(root, {
    title: 'The words this screen is allowed to use about money',
    sub: 'Four words, one gate each. A figure that has not earned its word is not shown',
    load: async () => {
      const [q, c] = await Promise.all([settle(readQueue()), settle(readCoverage())]);
      if (q.err && c.err) throw q.err;
      return { q, c };
    },
    render: ({ q, c }) => {
      const queue = q.err ? null : (q.v || []);
      const cov = c.err ? null : one(c.v);

      /* The recovered figure, through the four-column test in
         screens/actions.js and nothing else. A row carrying the amount without
         the evidence is a fault to report, never an amount to read. */
      const rec = queue ? queue.map(a => ({ a, ev: recoveryEvidence(a) })) : null;
      const attributed = rec ? rec.filter(x => x.ev.state === 'ATTRIBUTED') : null;
      const unsupported = rec ? rec.filter(x => x.ev.state === 'UNSUPPORTED') : null;
      const attTotal = attributed ? expose(attributed, x => x.ev.amount, () => 'ATTRIBUTED_MARGIN') : null;

      const rows = [
        { word: 'EXPOSED',
          held: queue ? `${num(queue.filter(a => up(a.engine_impact_kind) === 'MARGIN_EXPOSED').length)} action `
            + `${plural(queue.filter(a => up(a.engine_impact_kind) === 'MARGIN_EXPOSED').length, 'record carries', 'records carry')} this kind`
            : 'unknown — the action lane could not be read',
          note: 'The only word the inventory engine emits, and the only one this screen totals.' },
        { word: 'ESTIMATED',
          held: 'No engine in NEXUS produces an estimate, so nothing carries this word',
          note: 'Listed because a vocabulary with no empty slots is a vocabulary nobody checks.' },
        { word: 'ATTRIBUTED',
          held: attributed == null
            ? 'unknown — the action lane could not be read'
            : (attributed.length
                ? `${num(attributed.length)} ${plural(attributed.length, 'action carries', 'actions carry')} a figure that passes all four evidence columns${attTotal && attTotal.total != null ? ` — ${aed(attTotal.total)}` : ''}`
                : 'Nothing has passed the four-column evidence test, so nothing carries this word'),
          note: 'The four columns are an ATTRIBUTED outcome, a linked sale, a basis for tying them together, and a '
              + 'basis for the figure itself. The database refuses to store the amount without all four; this screen '
              + 'refuses to show it without all four.' },
        { word: 'CONFIRMED',
          held: cov
            ? (n0(cov.leads_with_a_confirmed_sale) ? `${num(cov.leads_with_a_confirmed_sale)} recorded ${plural(cov.leads_with_a_confirmed_sale, 'sale', 'sales')} on file, and ${num(cov.sales_attributed_to_a_recovery_action)} of them attributed to anything NEXUS did`
                : 'No recorded sale is on file')
            : 'unknown — the coverage read failed',
          note: 'Confirmed revenue exists in this database and none of it is credited to NEXUS. That distinction is '
              + 'the product, not a shortcoming of it.' },
      ];

      const faultBanner = (unsupported && unsupported.length)
        ? `<div style="padding:12px 16px 0">${dsCallout({
            intent: 'danger', name: 'danger',
            lede: `${num(unsupported.length)} ${plural(unsupported.length, 'action record claims', 'action records claim')} money with nothing behind it.`,
            body: '',
            noteLabel: 'what is missing',
            note: para(esc(unsupportedRecoverySentence(unsupported[0].ev))),
          })}</div>`
        : '';

      return faultBanner + dsTable([
        { label: 'Word', mid: true, strong: true,
          render: r => dsChip(MONEY_WORD[r.word].label, dsIntent(MONEY_WORD[r.word].tone), { lg: true }) },
        { label: 'What it means', prose: true, render: r => said(MONEY_WORD[r.word].gloss, 'The full definition') },
        { label: 'What holds it today', render: r => said(r.held, 'What holds this word today, in full') },
        { label: 'Why it is listed', prose: true, render: r => said(r.note, 'Why this word is listed, in full') },
      ], rows, { caption: 'The four money words and the gate on each' });
    },
  }).then(wireGo);
};

/* ══════════════════════════════════════════════════════════════════════════
   REGISTER 2 — the checks that came back clear
   ══════════════════════════════════════════════════════════════════════════
   A source that could not be read contributes NOTHING here. An unread check is
   not a clear one, and the panel says separately which sources were unread. */
function measuredClear(engine, queue, leads) {
  const out = [];
  const units = Array.isArray(engine) ? engine : null;
  const rows  = Array.isArray(queue) ? queue : null;
  const lds   = Array.isArray(leads) ? leads : null;

  if (rows) {
    const n = rows.length;
    if (!rows.some(a => a.awaiting_decision === true))
      out.push({ what: 'No recommendation is sitting unanswered by a person',
                 over: `${num(n)} action ${plural(n, 'record', 'records')} on file, none of them awaiting a decision` });
    if (!rows.some(a => str(a.escalated_at)))
      out.push({ what: 'Nothing is stuck for want of somebody able to approve it',
                 over: `${num(n)} action ${plural(n, 'record', 'records')}, none escalated` });
    if (!rows.some(a => a.deferral_now_due === true))
      out.push({ what: 'No deferred decision has quietly come due again',
                 over: `${num(n)} action ${plural(n, 'record', 'records')}, none past a deferral date` });
    const disagreed = rows.filter(a => a.is_live === true && a.engine_still_agrees === false);
    if (!disagreed.length)
      out.push({ what: 'No live decision rests on an engine finding that has since changed',
                 over: `${num(rows.filter(a => a.is_live === true).length)} live ${plural(rows.filter(a => a.is_live === true).length, 'action', 'actions')}, `
                     + 'the engine re-read on this load and still agreeing with each' });
  }

  if (units && rows) {
    const flagged = units.filter(u => up(u.recommendation) && up(u.recommendation) !== 'HOLD');
    const everRaised = new Set(rows.map(r => str(r.unit_id)));
    const unraised = flagged.filter(u => !everRaised.has(str(u.id)));
    if (flagged.length && !unraised.length)
      out.push({ what: 'Every unit the engine flags has been put in front of a person at least once',
                 over: `${num(flagged.length)} of ${num(units.length)} ${plural(units.length, 'unit', 'units')} flagged, `
                     + `all ${num(flagged.length)} raised` });
    const hold = units.filter(u => up(u.recommendation) === 'HOLD');
    if (hold.length)
      out.push({ what: 'The engine is content with the rest of the stock and recommends holding',
                 over: `${num(hold.length)} of ${num(units.length)} ${plural(units.length, 'unit', 'units')} on HOLD, `
                     + 'each carrying gross margin the engine does not consider at risk yet' });
  }

  if (lds) {
    const open = lds.filter(l => l.lead_is_open === true);
    const needing = open.filter(l => up(l.recommended_action) && up(l.recommended_action) !== 'NO_ACTION');
    if (!needing.length)
      out.push({ what: 'No open enquiry carries a recommended recovery action',
                 over: `${num(open.length)} open ${plural(open.length, 'enquiry', 'enquiries')} of ${num(lds.length)} on file. `
                     + 'Read it as a record and not as a rate — this is not lead volume' });
    /* ── This line was a false CLEAR for its first hour of life ────────────
       It tested `sla_state === 'BREACHED'` and `=== 'BREACH'`. `v_lead_recovery`
       emits neither: its vocabulary is WITHIN_SLA | BREACHED_SLA, plus UNKNOWN
       and UNKNOWN_NO_LINK. So the filter was structurally incapable of matching
       and the screen printed "no open enquiry missed the first-response target"
       unconditionally — while naming the same breached enquiries by name in
       register 4 on the same page. It was invisible on production, which has one
       open lead and has never emitted BREACHED_SLA; it was caught on a
       twenty-four-lead demo dataset where six of eleven open enquiries were
       breached.

       So this is not a string fix. Two changes, and the second is the one that
       matters:

       1. The vocabulary is NAMED, and a value outside it is a fault rather than
          a silent miss. A view that renames its states must break this line
          loudly.
       2. The verdict is decided by COMPLEMENT, not by matching the bad value.
          "Within the target" is a positive assertion the view has to make;
          everything else is either a breach or an unknown, and neither may be
          rendered as clear. That is the same rule S6 already enforces on
          holding_cost_state, applied here.

       And the denominator is now what was actually MEASURABLE, not what was
       open — claiming eleven enquiries were checked when the view could only
       speak for five is the "unknown rendered as a fact" this project exists to
       refuse. */
    const SLA_OK = 'WITHIN_SLA';
    const SLA_BREACHED = 'BREACHED_SLA';
    const SLA_UNKNOWN = ['UNKNOWN', 'UNKNOWN_NO_LINK', ''];

    const slaOf = l => up(l.sla_state);
    const strange = open.filter(l => {
      const s = slaOf(l);
      return s !== SLA_OK && s !== SLA_BREACHED && !SLA_UNKNOWN.includes(s);
    });
    const measurable = open.filter(l => slaOf(l) === SLA_OK || slaOf(l) === SLA_BREACHED);
    const late = measurable.filter(l => slaOf(l) !== SLA_OK);

    if (strange.length) {
      /* Not a clear line and not a leak line — a named fault, because the screen
         no longer knows what the engine is saying. */
      out.push({ what: 'FAULT — the first-response target is reporting a state this screen does not know',
                 over: `${num(strange.length)} open ${plural(strange.length, 'enquiry', 'enquiries')} carry `
                     + `sla_state values outside WITHIN_SLA / BREACHED_SLA / UNKNOWN. `
                     + 'Nothing is claimed about first response until this is reconciled' });
    } else if (measurable.length && !late.length) {
      out.push({ what: 'No open enquiry is recorded as having missed the first-response target',
                 over: `${num(measurable.length)} of ${num(open.length)} open `
                     + `${plural(open.length, 'enquiry', 'enquiries')} could be checked against this `
                     + 'dealership’s own first-response target'
                     + (measurable.length < open.length
                        ? `. The other ${num(open.length - measurable.length)} carry no measurable first `
                          + 'response and are counted nowhere — not as clear and not as late'
                        : '') });
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
   REGISTER 3 — the checks that could not run
   ══════════════════════════════════════════════════════════════════════════
   Every line: what cannot be measured, since when or over how many rows, why,
   and the ONE thing that would light it up. That last column is the roadmap
   stated as a consequence rather than as a feature. */
function notMeasured(engine, cov, leads, flows, readiness) {
  const out = [];
  const units = Array.isArray(engine) ? engine : null;
  const lds = Array.isArray(leads) ? leads : null;

  /* THE FLAGSHIP LINE. The detector last succeeded on a date the view reports,
     and until it runs again "no enquiry has gone quiet" is an absence of
     measurement, not a finding. Taken from the engine's own state column rather
     than by matching a workflow name, so it cannot drift from what Lead
     Recovery says on its own screen. */
  const detState = str((lds && lds.length && lds[0].silence_detector_state) || (cov && cov.silence_detector_state));
  const detLast  = (lds && lds.length && lds[0].silence_detector_last_success_at) || (cov && cov.silence_detector_last_success_at);
  if (detState && detState.toUpperCase() !== 'FRESH' && detState.toUpperCase() !== 'HEALTHY') {
    out.push({
      what: 'Whether any enquiry has gone quiet on us',
      since: detLast ? `The detector last succeeded ${dubaiStamp(detLast)} — ${ago(detLast)}` : 'No successful run is on record at all',
      why: `The silence detector reads ${detState}. The state can still be computed from message timestamps, but the `
         + 'marker that corroborates it is worthless, so a count of quiet enquiries would be a number nobody should '
         + 'act on. Reading "0 gone quiet" as good news would be reading a stopped clock.',
      unlock: 'Start the 12-Hour Silence Detector again. This one is not code and not an integration — it is a paused '
            + 'workflow, and it is the cheapest thing on this list.',
      kind: 'OPERATIONAL',
    });
  }

  if (units && units.length) {
    /* Partitioned on the one value that means "this was computed", so a state
       nobody here has heard of is handled by complement rather than dropped. */
    const noHold = units.filter(u => up(u.holding_cost_state) !== 'COMPUTED');
    if (noHold.length) {
      out.push({
        what: 'How fast the exposed margin is being eaten, and therefore net margin on any unit',
        since: `${num(noHold.length)} of ${num(units.length)} ${plural(units.length, 'unit', 'units')} — `
             + `net margin reads ${str(noHold[0].net_margin_state) || 'unstated'} on ${plural(noHold.length, 'it', 'them')}`,
        why: str(noHold[0].holding_cost_note)
          || 'No holding rate is on record for this dealership, so there is nothing to subtract from gross margin.',
        unlock: 'One number: what a day on the lot costs this dealership. It is a single field on Inventory, and it '
              + 'turns every exposure figure on this screen into a net one and every ageing unit into a rate of loss.',
        kind: 'DATA',
      });
    }
    const noMarket = units.filter(u => up(u.market_position).startsWith('UNKNOWN'));
    if (noMarket.length) {
      out.push({
        what: 'Whether any unit is priced above or below the market',
        since: `${num(noMarket.length)} of ${num(units.length)} ${plural(units.length, 'unit', 'units')}, `
             + `graded ${str(noMarket[0].market_position)}`,
        why: str(noMarket[0].market_note)
          || 'No competitor listing meets the match quality this dealership accepts, so no comparison stands up.',
        unlock: 'A competitor feed that returns a listing which can be tied to a specific car — year, trim and '
              + 'condition, not a model name on a manufacturer page. Until then NEXUS asks for a human price review '
              + 'and names no figure, which is the correct refusal rather than a missing feature.',
        kind: 'INTEGRATION',
      });
    }
    const thinDemand = units.filter(u => up(u.enquiry_coverage) !== 'SUFFICIENT');
    if (thinDemand.length) {
      out.push({
        what: 'Whether a slow-selling unit is slow because nobody wants it or because nobody has seen it',
        since: `${num(thinDemand.length)} of ${num(units.length)} ${plural(units.length, 'unit', 'units')}, `
             + `enquiry coverage ${str(thinDemand[0].enquiry_coverage)}`,
        why: str(thinDemand[0].enquiry_note)
          || 'Too few enquiries resolve to a specific unit for anything to be said about demand.',
        unlock: 'Enquiries that name the car. That arrives with volume from a real dealership, and with the identity '
              + 'resolution below it.',
        kind: 'DATA',
      });
    }
  }

  if (cov) {
    const pctResolved = n0(cov.identity_resolution_pct);
    const unresolved = n0(cov.unresolved_whatsapp_handles);
    if (pctResolved != null && pctResolved < 100) {
      out.push({
        what: 'Whose conversations we are looking at — and therefore whether any leak on the customer side is missing',
        since: `${num(cov.message_events_resolved_to_a_lead)} of ${num(cov.message_events)} message events resolve to `
             + `an enquiry (${esc(String(pctResolved))}%)`
             + (unresolved ? `, and ${num(unresolved)} WhatsApp ${plural(unresolved, 'handle matches', 'handles match')} no enquiry at all` : ''),
        why: 'Every customer-side check on this screen only sees the resolved share. A clear result over part of the '
           + 'traffic is not a clear result over the traffic.',
        unlock: 'A provider message id on every logged message and a phone number on every enquiry, so a conversation '
              + 'and a person are one record rather than a rule over four incompatible key shapes.',
        kind: 'SCHEMA',
      });
    }
    const cannot = str(cov.what_this_engine_cannot_tell_you);
    if (cannot) {
      out.push({
        what: 'What Lead Recovery says it cannot tell you, in its own words',
        since: cov.computed_at ? `Measured on this read, ${dubaiStamp(cov.computed_at)}` : 'Measured on this read',
        /* The engine owns this sentence. A paraphrase here would be a second
           copy of a business fact that drifts the first time the view changes. */
        why: cannot,
        unlock: 'Each clause names its own blocker. They are worked in the order the money moves — identity first, '
              + 'then an appointment, then a value on an enquiry.',
        kind: 'ENGINE',
      });
    }
  }

  if (Array.isArray(readiness) && readiness.length) {
    const met = readiness.filter(p => p.met_now === true);
    const next = readiness.find(p => p.met_now === false) || readiness.find(p => p.met_now !== true);
    out.push({
      what: 'Whether any deal in progress is at risk',
      since: `${num(met.length)} of ${num(readiness.length)} prerequisites met, measured on this read`,
      why: 'This database records a sale at the moment it closes and nothing before it, so a deal has no in-flight '
         + 'period for any engine to observe. The engine is not empty of findings; it is empty of subjects.',
      unlock: next ? `${str(next.requirement)} — ${str(next.unlocks) || 'the population itself'}`
                   : 'Every prerequisite is met and this line should not be here.',
      kind: 'SCHEMA',
    });
  }

  if (Array.isArray(flows) && flows.length) {
    /* Graded through lib/health.js, which is the single mirror of the database's
       own outcome vocabulary. This screen never inspects a run status itself. */
    const unwell = flows.filter(f => {
      const w = healthWords(f.health);
      return w.tone === 'hot' || w.tone === 'warm' || w.tone === 'unknown';
    });
    if (unwell.length) {
      const worst = unwell[0];
      out.push({
        what: 'Whether the automations behind these checks are actually running',
        since: `${num(unwell.length)} of ${num(flows.length)} automations are not healthy`,
        why: `For example ${str(worst.name)}: ${healthWords(worst.health).label} — ${healthWords(worst.health).blurb}`,
        unlock: 'Each one is fixed on the automation box, not here. Until they are, some of the clear results on this '
              + 'screen rest on data that stopped arriving.',
        kind: 'OPERATIONAL',
      });
    }
  }

  /* Named explicitly, always, because their absence is the single largest thing
     a dealership would assume this product covers. There is no service table,
     no appointments table and no reconditioning cost column: these are not
     empty buckets, and an empty bucket here would read as a clean bill of
     health on the most valuable part of a dealership's year. */
  out.push({
    what: 'Service retention, missed appointments and no-shows, and true margin after reconditioning',
    since: 'Never measured, on any day',
    why: 'There is no service table, no appointments table and no reconditioning cost column in this database, and no '
       + 'connection to a system that holds them. Nothing has been looked at, so nothing is being reported — not a '
       + 'zero, and not a clean result.',
    unlock: 'A connection to the system the dealership already keeps this in. These are sold as roadmap and never as '
          + 'capability, and this line is here so that promise is visible on the screen rather than only in a '
          + 'document.',
    kind: 'ROADMAP',
  });

  return out;
}
