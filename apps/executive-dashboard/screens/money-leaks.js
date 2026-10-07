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

import { ME, db, dbWrite, onIdentityChange } from '../lib/data.js';
import { leadDrawer } from '../lib/lead-drawer.js';
import { displayName, isHiddenLead } from '../lib/privacy.js';
import { UNKNOWN_WHY, aed, ago, dubaiDate, dubaiStamp, esc, n0, num, tone } from '../lib/format.js';
import { healthWords } from '../lib/health.js';
import { SCREENS, go } from '../lib/nav.js';
/* The three words a headline number may be labelled with, and the sentence that
   refuses a nought in place of a measurement. Owned by lib/vocabulary.js for
   the same reason ATTRIBUTION_CONFIDENCE is: a second copy of "confirmed" is a
   second definition of it. */
import { TILE_PROVENANCE, UNKNOWN_IS_NOT_ZERO } from '../lib/vocabulary.js';
/* The six setup steps, read by lib/setup.js and never re-derived here. This
   screen renders ONE line about them and owns none of the reasoning. */
import { readSetup, resetSetupReads } from '../lib/setup.js';
/* ── The Google Stitch designs, adopted 7 Oct 2026 ─────────────────────────
   design/stitch/today-s-money-leaks-landing-command-center--30144a.html is the
   visual reference (header, filter pills, leak cards, outcome ledger) and
   --012119 contributes the setup banner, the "Right now" strip, "Waiting on
   you" and the right-hand rail of registers. This replaced the 6 Sep design-
   system pass (lib/design-system.js), and the constraint that pass was written
   against still binds, word for word:

     NOT ONE DATA READ, QUERY, THRESHOLD OR DERIVATION CHANGED. buildLeaks(),
     buildLeadLeaks(), measuredClear(), notMeasured(), makeLeak() and the
     MONEY_WORD gate are what they were; what changed is how the result is
     painted. Three additions, each named where it lives: the outcome ledger
     (rows the action queues already returned, filtered to today), three
     decision-time columns on the recovery action read so the ledger can say
     WHEN, and buildLeadLeaks() now masks the customer name through
     lib/privacy.js — it used to put lead_name in the line verbatim.

     The long sentences on this screen are not filler. They may be DEMOTED —
     terse on the surface, one click from the full sentence — and they may NOT
     be deleted. Every one of them is inside a <details> built by note() below,
     which keeps it in the DOM open or closed: browser find, copy-paste and a
     screen reader all reach it. Nothing on this screen uses a `title=` tooltip
     to carry a caveat. Stitch's own "How is this computed?" popover is drawn as
     exactly such a <details>, for that reason. */
import { BTN, errorState, skeleton, tempChip, trustFooter } from '../lib/stitch-ui.js';
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
const muted = h => `<div class="font-body-sm text-[12px] text-on-surface-variant">${h}</div>`;
const hot   = h => `<div class="font-body-sm text-[12px] text-error font-medium">${h}</div>`;
const para  = h => `<p>${h}</p>`;
const mono  = v => `<span class="font-label-numeric-sm text-[11px] text-outline">${esc(str(v))}</span>`;
/* The first sentence of a paragraph, for the surface, with the whole paragraph
   kept for the note. Splitting on the sentence boundary rather than truncating
   at a character count means the terse form is always a complete thought and
   never ends mid-word — a clipped caveat reads as a broken one. */
const firstSentence = t => {
  const s0 = str(t);
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(s0);
  return m ? m[0] : s0;
};
/* THE demotion affordance. Stitch draws "How is this computed?" as an underlined
   link opening a popover; here it is a <details>, so the sentence it holds is in
   the DOM whether open or closed (see the import note above). `body` is HTML,
   `label` is TEXT. */
const note = (body, label = 'Why') => (body
  ? `<details class="mt-1"><summary class="cursor-pointer list-none inline-flex items-center gap-0.5 font-body-sm text-[11px] text-primary font-medium underline">${esc(label)}<span class="material-symbols-outlined text-xs">help</span></summary>`
    + `<div class="mt-1.5 p-space-sm bg-surface-container-lowest border border-outline-variant/40 rounded-lg font-body-sm text-[12px] text-on-surface-variant leading-relaxed space-y-1.5">${body}</div></details>`
  : '');
/* Terse on the surface, the full text one click away. The note is omitted when
   the full text IS the first sentence, because an affordance that opens onto
   the words already on screen teaches the reader that these affordances are
   decoration — and the next one will hold something they needed. */
const said = (t, label = 'Read in full') => {
  const full = str(t);
  if (!full) return '';
  const head = firstSentence(full);
  return `<span>${esc(head)}</span>${head === full ? '' : note(para(esc(full)), label)}`;
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

/* A route button. A screen the navigation offers and this bundle does not
   register says so in its own words rather than going nowhere. */
const LINK = {
  primary:   'px-4 py-2 rounded-lg bg-primary hover:bg-primary-container text-on-primary font-body-sm text-body-sm font-semibold flex items-center gap-2 shadow-sm transition-all',
  secondary: 'px-3 py-2 rounded-lg bg-surface-container-low hover:bg-surface-container text-secondary font-body-sm text-body-sm font-semibold flex items-center gap-1.5 transition-all',
};
const linkBtn = (id, label, kind = 'secondary') => (SCREENS[id]
  ? `<button type="button" class="${LINK[kind] || LINK.secondary}" data-go="${esc(id)}"><span class="material-symbols-outlined text-base">open_in_new</span><span>${esc(label)}</span></button>`
  : `<button type="button" class="${BTN.secondary}" disabled>${esc(label)} — not in this build</button>`);

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
/* ── Chips and callouts, from complete class strings ───────────────────────
   Six intents, one map each, copied from the Stitch exports' own chips (the
   #FDECEA/#FEF3E2/#E8F1FB/#E6F4EF set the money-leaks and leads exports use).
   `unknown` is dashed and grey on purpose: a thing nobody measured must never
   borrow a healthy colour. A tone this file does not know is NEUTRAL. */
const CHIP_CLS = {
  danger:  'inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-numeric-sm text-[10px] font-bold uppercase tracking-wider w-fit bg-[#FDECEA] text-[#C8321F]',
  warning: 'inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-numeric-sm text-[10px] font-bold uppercase tracking-wider w-fit bg-[#FEF3E2] text-[#96570A]',
  info:    'inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-numeric-sm text-[10px] font-bold uppercase tracking-wider w-fit bg-[#E8F1FB] text-[#2563A8]',
  success: 'inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-numeric-sm text-[10px] font-bold uppercase tracking-wider w-fit bg-[#E6F4EF] text-[#157A5B]',
  neutral: 'inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-numeric-sm text-[10px] font-bold uppercase tracking-wider w-fit bg-surface-container-high text-on-surface-variant',
  unknown: 'inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-numeric-sm text-[10px] font-bold uppercase tracking-wider w-fit border border-dashed border-outline text-outline',
};
const TONE_INTENT = { hot: 'danger', warm: 'warning', cold: 'info', ok: 'success', won: 'success', open: 'info', dead: 'neutral', unknown: 'unknown' };
const toIntent = t => TONE_INTENT[str(t).toLowerCase()] || 'neutral';
const chip = (label, intent = 'neutral', iconName = '') =>
  `<span class="${CHIP_CLS[intent] || CHIP_CLS.neutral}">${iconName ? `<span class="material-symbols-outlined text-xs">${esc(iconName)}</span>` : ''}${esc(label)}</span>`;
const CALLOUT_CLS = {
  danger:  'p-space-md rounded-lg bg-[#FDECEA]/60 border border-red-200 flex items-start gap-space-sm',
  warning: 'p-space-md rounded-lg bg-[#FEF3E2]/60 border border-[#F3DFBD] flex items-start gap-space-sm',
  info:    'p-space-md rounded-lg bg-surface-container-high flex items-start gap-space-sm',
  neutral: 'p-space-md rounded-lg bg-surface-container-low flex items-start gap-space-sm',
  unknown: 'p-space-md rounded-lg border border-dashed border-outline-variant bg-surface-container-lowest flex items-start gap-space-sm',
  success: 'p-space-md rounded-lg bg-[#E6F4EF]/60 border border-emerald-200 flex items-start gap-space-sm',
};
const CALLOUT_ICON = {
  danger: 'text-error', warning: 'text-[#96570A]', info: 'text-primary', neutral: 'text-secondary',
  unknown: 'text-outline', success: 'text-[#157A5B]',
};
/* `lede` is TEXT; `body` and `noteHtml` are HTML. */
const callout = ({ intent = 'info', iconName = 'info', lede = '', body = '', noteHtml = '', noteLabel = 'Read in full' } = {}) =>
  `<div class="${CALLOUT_CLS[intent] || CALLOUT_CLS.info}"><span class="material-symbols-outlined text-xl mt-0.5 ${CALLOUT_ICON[intent] || CALLOUT_ICON.info}">${esc(iconName)}</span>`
  + `<div class="flex flex-col space-y-0.5 min-w-0 font-body-sm text-body-sm text-on-surface-variant">`
  + (lede ? `<span class="font-body-md text-body-md font-bold text-on-surface">${esc(lede)}</span>` : '')
  + body + note(noteHtml, noteLabel) + '</div></div>';

/* The size of a leak, in three pieces. `figure` is never a bare dash and never
   a zero: where the gate refuses a number the slot carries WORDS, at a smaller
   size, so nothing there can be misread as a quantity the engine produced. */
const sizeParts = size => {
  const w = MONEY_WORD[up(size && size.word)];
  if (!w) {
    return {
      figure: '<span class="font-headline-md text-headline-md font-semibold text-error">Unsized</span>', words: true, chip: '',
      note: hot(`This line claims a size of "${esc(str(size && size.word)) || 'nothing'}", which is not one of the `
        + 'four money words this screen is allowed to use. No figure is shown.'),
    };
  }
  if (up(size.word) === 'NOT_COMPUTABLE') {
    return {
      figure: '<span class="font-headline-md text-headline-md font-semibold text-outline">Impact not computable</span>', words: true,
      chip: chip('not computable', 'unknown'),
      note: muted(esc(str(size.basis)) || 'The engine records no reason, which is itself a gap.'),
    };
  }
  const amount = n0(size.amount);
  if (amount == null) {
    return {
      figure: '<span class="font-headline-md text-headline-md font-semibold text-error">No figure</span>', words: true,
      chip: chip(w.label, toIntent(w.tone)),
      note: hot(`Sized as ${esc(w.label)} and no figure came with it, so nothing is shown. A money word without a `
        + 'number is a claim this screen cannot make.'),
    };
  }
  return {
    figure: `<span class="font-label-numeric-lg text-label-numeric-lg font-bold text-error">${esc(aed(amount))}</span>`, words: false,
    chip: chip(w.label, toIntent(w.tone)),
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
const leakFault = leak => callout({
  intent: 'danger', iconName: 'report',
  lede: 'A leak line was built without everything a leak line needs.',
  body: `<span>Missing: ${esc(leak.missing.join('; '))}.</span>`,
  noteHtml: para('A leak line was built without everything a leak line needs, and it is shown as a fault rather than as a row.')
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
   THE OWNER STRIP — added 14 September 2026
   ══════════════════════════════════════════════════════════════════════════
   Everything from here to the end of this block is new, and it is ADDITIVE:
   not one read, threshold or derivation above or below it changed. It exists
   because the four registers underneath answer "where is money leaking", and
   the four things an owner actually walks in asking are narrower and more
   immediate than that — who is hot, what is waiting on me, who have we left
   on read, and did any of it come back.

   It sits ABOVE "Today's money leaks" rather than replacing it for the reason
   the file header gives about Overview: a leak register is the argument, and
   this is the order of work. The argument stays.

   THE ONE RULE THIS STRIP ADDS TO THE SCREEN. Every tile carries how its
   number was arrived at, in one of three words owned by lib/vocabulary.js —
   CONFIRMED, ESTIMATED, NOT KNOWN — and ownerTile() below will not print a
   figure under the third. That is the same shape as the MONEY_WORD gate a
   hundred lines up: the word decides whether a number is allowed, in one
   place, so no caller can put a zero where a measurement never happened. */

/* Every lead on file, once. The HOT count and the Action Center's lead lookup
   are both taken from THIS array rather than from two reads, so the tile can
   never report a lead the list below cannot show — the same "one figure, one
   derivation" rule the leak strip states about its own readiness read. */
const readAllLeads = shared(() => db('leads?select=id,name,status,ai_score,score_source,rules_score,ai_score_raw,'
  + 'ai_intent_raw,ai_parse_failed,vehicle_interest,source,created_at&order=id.desc&limit=1000'));

/* The action queue itself, not v_lead_recovery_queue. The view is the right
   read for screens/lead-recovery.js, which needs the decided-by and outcome
   joins; this strip needs the four recovery-evidence columns and the raw
   recommendation, and reading the table means the count and the list below it
   come from the same rows. */
const readActions = shared(() => db('lead_recovery_actions?select=id,lead_id,recommendation,status,engine_state,'
  + 'engine_reason,engine_confidence,engine_confidence_basis,engine_risk_level,engine_risk_basis,proposed_at,'
  + 'proposed_source,outcome_state,outcome_purchase_id,attribution_basis,recovered_value_aed,'
  /* decided_at / executed_at / outcome_recorded_at added 7 Oct 2026 for the
     outcome ledger, which lists what was recorded TODAY and has to be able to
     say when. All three are columns of the table (catalogue read that day). */
  + 'recovered_value_basis,decided_at,executed_at,outcome_recorded_at&order=proposed_at.desc&limit=500'));

/* The ONLY place in this database where a message's direction is recorded
   against a thread. `public.conversation` has no direction column at all and
   `channel_message_events.conversation_id` does not resolve to one, so
   "has anybody replied to this conversation" cannot be asked of the
   conversation table. See the UNANSWERED tile, which says so on its face
   rather than counting the wrong population quietly. */
const readThreads = shared(() => db('v_conversations?select=thread_key,display_name,identified,lead_name,'
  + 'lead_status,inbound_count,outbound_count,awaiting_reply,last_message_at&limit=500'));

/* Read only so the UNANSWERED tile can state the size of the population it did
   NOT count. Nothing is derived from it. */
const readConvRows = shared(() => db('conversation?select=id,channel,state,message_count,opened_at,'
  + 'last_message_at&limit=500'));

/* The trail. CLASSIFY carries the intent and no ref, PROMOTE carries the same
   intent AND the lead it was written against, so the lead is found through
   PROMOTE/SCORE and the correlation id is what ties CLASSIFY to it. Read as
   rows rather than through nexus_journey_trace(p_correlation_id) because the
   RPC answers for one correlation and this panel needs the reason for every
   proposed action in one request. */
const readTrail = shared(() => db('journey_step?select=correlation_id,step,status,ref_table,ref_id,detail,at'
  + '&step=in.(CLASSIFY,PROMOTE,SCORE)&order=id.desc&limit=500'));

/* ── The tile constructor, and the gate it carries ─────────────────────────
   One way to build an owner tile, for the same reason makeLeak() is the only
   way to build a leak line: the check has to be somewhere a caller cannot
   forget it. */
const PROV_ICON = { CONFIRMED: 'check', ESTIMATED: 'warning', UNKNOWN: 'help' };
const PROV_INTENT = { CONFIRMED: 'success', ESTIMATED: 'warning', UNKNOWN: 'unknown' };
const provChip = key => chip(TILE_PROVENANCE[key].label, PROV_INTENT[key] || 'unknown', PROV_ICON[key]);

/* The "Right now" tile of today-s-money-leaks…--012119: uppercase label with a
   status dot, the figure, one line under it, an icon box on the right. Five
   intents, each a COMPLETE class set. The provenance chip and the note are the
   two things this screen adds to the export's tile, and neither is optional. */
const TILE = {
  danger:  { head: 'text-[11px] font-table-header uppercase tracking-wider text-error flex items-center gap-1.5', dot: 'w-1.5 h-1.5 rounded-full bg-error', val: 'font-label-numeric-lg text-[28px] font-bold text-error leading-none', box: 'w-10 h-10 rounded-[6px] bg-[#FDECEA] flex items-center justify-center text-error shrink-0' },
  warning: { head: 'text-[11px] font-table-header uppercase tracking-wider text-[#96570A] flex items-center gap-1.5', dot: 'w-1.5 h-1.5 rounded-full bg-[#96570A]', val: 'font-label-numeric-lg text-[28px] font-bold text-on-surface leading-none', box: 'w-10 h-10 rounded-[6px] bg-[#FEF3E2] flex items-center justify-center text-[#96570A] shrink-0' },
  success: { head: 'text-[11px] font-table-header uppercase tracking-wider text-secondary flex items-center gap-1.5', dot: 'w-1.5 h-1.5 rounded-full bg-[#157A5B]', val: 'font-label-numeric-lg text-[28px] font-bold text-on-surface leading-none', box: 'w-10 h-10 rounded-[6px] bg-[#E6F4EF] flex items-center justify-center text-[#157A5B] shrink-0' },
  neutral: { head: 'text-[11px] font-table-header uppercase tracking-wider text-secondary flex items-center gap-1.5', dot: 'w-1.5 h-1.5 rounded-full bg-secondary', val: 'font-label-numeric-lg text-[28px] font-bold text-on-surface leading-none', box: 'w-10 h-10 rounded-[6px] bg-surface-container-low flex items-center justify-center text-secondary shrink-0' },
  unknown: { head: 'text-[11px] font-table-header uppercase tracking-wider text-secondary flex items-center gap-1.5', dot: 'w-1.5 h-1.5 rounded-full border border-outline', val: 'font-headline-md text-headline-md font-semibold text-outline leading-none', box: 'w-10 h-10 rounded-[6px] border border-dashed border-outline-variant flex items-center justify-center text-outline shrink-0' },
};
const WORDS_VAL = {
  danger: 'font-headline-md text-headline-md font-semibold text-error leading-none',
  unknown: 'font-headline-md text-headline-md font-semibold text-outline leading-none',
};
const statTile = ({ label, value, words = false, intent = 'neutral', iconName = 'info', meta = '', noteHtml = '' }) => {
  const t = TILE[intent] || TILE.neutral;
  const valCls = words ? (WORDS_VAL[intent] || WORDS_VAL.unknown) : t.val;
  return `<div class="bg-surface-container-lowest border border-[#E8EAEF] rounded-[10px] p-4 flex items-start justify-between gap-3">
    <div class="space-y-1.5 min-w-0">
      <div class="${t.head}"><span class="${t.dot}"></span>${esc(label)}</div>
      <div class="${valCls}">${esc(value)}</div>
      ${meta ? `<div class="text-[11px] font-body-sm text-secondary flex flex-wrap items-center gap-1.5">${meta}</div>` : ''}
      ${note(noteHtml, 'How this is counted')}
    </div>
    <div class="${t.box}"><span class="material-symbols-outlined text-[22px]">${esc(iconName)}</span></div>
  </div>`;
};

function ownerTile({ label, prov, count, phrase = '', meta = '', note: noteHtml = '', intent = '', iconName = 'info' }) {
  const p = TILE_PROVENANCE[prov];
  if (!p) {
    return statTile({ label, value: 'Unlabelled', words: true, intent: 'danger', iconName,
      noteHtml: para(`This tile was built claiming a provenance of "${esc(str(prov)) || 'nothing'}", which is not one of `
        + 'the three words a tile is allowed to carry. No figure is shown: a number nobody can account for is worse '
        + 'than no number.') });
  }
  /* THE GATE. Not known may not carry a figure, and in particular may not carry
     a nought — which is the single defect this strip was written to avoid. The
     value slot gets WORDS at heading size, exactly as the leak strip does for a
     read that failed, so nothing in it can be misread as a quantity. */
  if (prov === 'UNKNOWN') {
    return statTile({ label, value: phrase || 'Not known', words: true, intent: 'unknown', iconName,
      meta: provChip('UNKNOWN') + (meta ? `<span>${meta}</span>` : ''),
      noteHtml: para(esc(UNKNOWN_IS_NOT_ZERO)) + noteHtml + para(esc(p.blurb)) });
  }
  const n = n0(count);
  if (n == null) {
    return statTile({ label, value: 'No figure', words: true, intent: 'danger', iconName, meta: provChip(prov),
      noteHtml: para(`This tile is labelled ${esc(p.label.toLowerCase())} and no number came with it, so nothing is `
        + 'shown. A provenance without a figure is a claim this screen cannot make.') + noteHtml });
  }
  return statTile({ label, value: num(n), intent: intent || (n ? 'warning' : 'success'), iconName,
    meta: provChip(prov) + (meta ? `<span>${meta}</span>` : ''),
    noteHtml: para(esc(p.blurb)) + noteHtml });
}

/* ── The Action Center list ────────────────────────────────────────────────
   The recommendation IS the instruction, so it is what the button says. The
   map is closed: a recommendation this product has no wording for renders the
   database's own word verbatim and says it has no wording, rather than being
   quietly relabelled as one of the four below. */
const REC_LABEL = {
  ESCALATE:       'Contact now',
  FOLLOW_UP:      'Follow up',
  ASSIGN_OWNER:   'Assign an owner',
  MANAGER_REVIEW: 'Manager review',
};
const recLabel = v => REC_LABEL[up(v)] || null;

/* The primary button IS the recommendation, and pressing it does two things,
   in this order:
     1. records the decision, through the same lead_recovery_decide() RPC the
        recovery desk's contract defines (APPROVE — the owner has accepted the
        recommendation), and only for an account action_approver_context() says
        may decide: a refused call would still write an audit row, so it is not
        made on behalf of someone who cannot decide. The RPC is idempotent, and
        a refusal comes back as ok = false, which is read and shown;
     2. opens the lead itself, with the recommendation and the outcome of step 1
        pinned at the top, so the next step (call, WhatsApp, book) is one click.
   A recommendation this screen has no wording for still opens the lead, under
   a neutral label, and records nothing. */
const actionButton = a => {
  const label = recLabel(a.recommendation);
  /* Plain text inside: wireContact() swaps textContent while it works, and an
     icon ligature in here would come back as the word "check". */
  return `<button class="px-3.5 py-1.5 rounded-[6px] text-[12px] font-semibold bg-primary-container text-white hover:bg-primary transition-colors shadow-sm" type="button" data-contact="${esc(str(a.id))}" data-lead="${esc(str(a.lead_id))}"`
    + ` data-rec="${esc(label || '')}" aria-label="${esc(label
      ? 'Records that you are acting on this recommendation, then opens the lead with it highlighted.'
      : 'Opens the lead. This recommendation (' + (str(a.recommendation) || 'none') + ') has no wording on this screen, so no decision is recorded.')}">`
    + `${esc(label || 'Open lead')}</button>`;
};

let approverCtx = null;
const readApprover = () => (approverCtx ||= db('rpc/action_approver_context')
  .then(r => (Array.isArray(r) ? r[0] : r) || null)
  .catch(e => { approverCtx = null; throw e; }));

async function recordDecision(actionId) {
  let ctx = null;
  try { ctx = await readApprover(); } catch (e) {
    return { ok: false, text: `Your decision was not recorded: who may decide could not be read (${e.message}).` };
  }
  if (!ctx || !ctx.may_decide) {
    return { ok: false, text: 'Not recorded as a decision: ' + (str(ctx && ctx.refusal_reason)
      || 'your account is not one this dealership allows to approve actions.') + ' The lead is open so you can still act on it.' };
  }
  try {
    const r = await dbWrite('POST', 'rpc/lead_recovery_decide', { p_action_id: actionId, p_decision: 'APPROVE' });
    const row = Array.isArray(r) ? r[0] : r;
    if (row && row.ok) return { ok: true, text: row.idempotent ? 'You had already approved this. Nothing new was recorded.' : 'Decision recorded: approved by you, just now.' };
    return { ok: false, text: 'Not recorded: ' + (str(row && row.refusal_reason) || 'the database gave no reason.') };
  } catch (e) {
    return { ok: false, text: `Your decision was not recorded: ${e.message}` };
  }
}

function wireContact(card, reasons) {
  card.querySelectorAll('button[data-contact]').forEach(b => b.addEventListener('click', async () => {
    if (b.disabled) return;
    const label = b.textContent;
    const rec = str(b.dataset.rec);
    b.disabled = true; b.textContent = 'Opening…';
    try {
      const decision = rec ? await recordDecision(str(b.dataset.contact)) : null;
      const rows = await db(`leads?select=*,users(id,name)&id=eq.${encodeURIComponent(str(b.dataset.lead))}&limit=1`);
      if (rows.length) {
        await leadDrawer(rows[0], { recommended: { label: rec || 'Open lead', reason: reasons.get(str(b.dataset.contact)) || '', decision } });
        b.textContent = decision && decision.ok ? 'Approved · open again' : label;
      } else {
        b.textContent = 'Lead not found';
      }
    } catch (e) {
      b.textContent = label;
      b.title = `Could not open this lead — ${e.message}`;
    } finally {
      b.disabled = false;
    }
  }));
}

/* The score's provenance, straight out of leads.score_source and never
   translated. Rendered VERBATIM — lib/format.js's pill() explains why that is
   the caller's claim to make — with the meaning behind the row's disclosure.
   The tone follows confIntent()'s reasoning forty lines up: a provenance is not
   a severity, so a rules score is not painted redder than a model score. Only
   "we do not know how this was scored" gets a colour, and it is the unknown
   one. */
const SCORE_SOURCE_MEANING = {
  RULES: 'Scored by the deterministic rules in NEXUS. No model was consulted, so the same message scores the same '
       + 'way every time.',
  AI_SCORE_CONFIRMED: 'A model scored this and its answer parsed cleanly into the score on the row.',
  AI_SCORE_FALLBACK: 'A model was asked and its answer could not be used, so the rules score was kept instead. The '
       + 'number on this row is the rules number.',
  AI_SCORE_UNKNOWN: 'Nothing on this row records how it was scored. The number is whatever was written at the time '
       + 'and its basis was not kept.',
  AI_SCORE_FAILED: 'The scoring attempt failed. Treat the number as unearned rather than as a low score.',
};
const scoreSourceIntent = v => (SCORE_SOURCE_MEANING[up(v)] && up(v) !== 'AI_SCORE_UNKNOWN'
  && up(v) !== 'AI_SCORE_FAILED' ? 'neutral' : 'unknown');

/* The reason, in the order of how close the evidence sits to the decision.
   NOTHING here composes a sentence: every branch returns text a row already
   holds, with the row it came from beside it, and the last branch returns null
   so the cell can say that no reason was recorded rather than fill one in. */
function actionReason(a, lead, trail) {
  if (str(a.engine_reason)) return { text: str(a.engine_reason), from: 'lead_recovery_actions.engine_reason' };
  if (Array.isArray(trail) && trail.length) {
    const mine = trail.filter(s => str(s.ref_table) === 'leads' && str(s.ref_id) === str(a.lead_id));
    const corr = new Set(mine.map(s => str(s.correlation_id)).filter(Boolean));
    const pick = up => trail.find(s => corr.has(str(s.correlation_id)) && String(s.step).toUpperCase() === up && str(s.detail));
    const step = pick('PROMOTE') || pick('CLASSIFY');
    if (step) return { text: str(step.detail), from: `journey_step ${str(step.step)}, correlation ${str(step.correlation_id)}` };
  }
  if (lead && str(lead.ai_intent_raw)) return { text: str(lead.ai_intent_raw), from: 'leads.ai_intent_raw' };
  return null;
}

const NO_REASON = 'No reason was recorded anywhere for this one — not on the action, not on the trail that raised it, '
  + 'and not on the lead. It is left blank rather than filled in: a recommendation whose reason this screen invents '
  + 'is a recommendation nobody can argue with.';

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
      /* Masked through lib/privacy.js since 7 Oct 2026. This line used to carry
         lead_name verbatim, which then reached the screen through esc(x.what) —
         a customer's name the privacy switch could not hide. */
      what: `${str(l.lead_name) ? displayName(str(l.lead_name), l.lead_id) : `Lead #${str(l.lead_id)}`} needs somebody to act`,
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
  const readAt = new Date().toISOString();

  /* ── The layout, painted before anything is read ───────────────────────────
     One root carrying `nx-stitch` (the scoped reset the Stitch classes were
     designed against), appended rather than set on `#screen`, so go() removes it
     with the rest of the subtree. Every slot starts as a skeleton and is filled
     once ALL the reads below have settled: the sections share rows, and two
     sections describing the same rows must describe the same moment. */
  const root = document.createElement('div');
  root.className = 'nx-stitch flex flex-col gap-space-md';
  host.appendChild(root);
  const slot = id => `<div data-slot="${id}">${skeleton({ rows: 2 })}</div>`;
  root.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-space-md bg-surface-container-lowest p-space-lg rounded-xl shadow-sm">
      <div class="flex flex-col space-y-1 min-w-0">
        <div class="flex items-center gap-space-sm flex-wrap">
          <h1 class="font-headline-lg text-headline-lg text-on-surface font-bold tracking-tight">Today's Money Leaks</h1>
          <span data-slot="count"></span>
        </div>
        <p class="font-body-md text-body-md text-on-surface-variant max-w-3xl">Where money is leaking right now, what is behind each line, and what to do about it. A check that came back clear and a check that could not run are kept apart.</p>
      </div>
      <div class="flex items-center gap-space-sm bg-surface-container-low px-space-md py-2.5 rounded-lg self-start md:self-auto">
        <span class="material-symbols-outlined text-primary text-xl">stream</span>
        <div class="flex flex-col">
          <div class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-primary"></span>
            <span class="font-label-numeric-sm text-label-numeric-sm text-on-surface font-semibold">Read on this visit</span>
            <span class="text-outline text-xs">•</span>
            <span class="font-label-numeric-sm text-label-numeric-sm text-on-surface-variant">${esc(dubaiStamp(readAt))}</span>
          </div>
          <span class="font-label-numeric-sm text-[11px] text-outline">Re-read every time this screen opens — nothing here is remembered from an earlier visit</span>
        </div>
      </div>
    </div>
    <div data-slot="setup"></div>
    ${slot('now')}
    ${slot('waiting')}
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-md items-start">
      <div class="lg:col-span-8 flex flex-col gap-space-md min-w-0">${slot('leaks')}</div>
      <div class="lg:col-span-4 flex flex-col gap-space-md min-w-0">${slot('clear')}${slot('notrun')}${slot('alerts')}${slot('words')}</div>
    </div>
    ${slot('ledger')}
    <div data-slot="footer"></div>`;
  const put = (id, html) => {
    const n = root.querySelector(`[data-slot="${id}"]`);
    if (!n) return null;
    n.innerHTML = html;
    n.querySelectorAll('[data-go]').forEach(b => { if (!b.disabled) b.addEventListener('click', () => go(b.dataset.go)); });
    n.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => go('moneyleaks')));
    return n;
  };
  /* A section whose renderer throws reports itself and takes nothing else down:
     a partial read degrades, it does not blank. */
  const paint = (id, what, fn) => {
    try { return put(id, fn()); } catch (e) { return put(id, errorState({ what, err: e, retry: 'moneyleaks' })); }
  };

  /* ── The setup banner — ONE LINE, AT THE TOP, AND ONLY WHILE IT IS TRUE ──────
     A dealership whose WhatsApp is not connected has no leaks to read, because
     nothing is arriving for anything to leak from — and this screen would
     report that as a clean morning. So the banner sits above the figures it
     qualifies, it is not a takeover, and it is gone once every step is done.
     Nothing waits on it; a failed setup read paints nothing (lib/setup.js does
     not reject in any case). Drawn as --012119's "Setup Progress" strip. */
  resetSetupReads();
  readSetup().then(s => {
    if (!s.prompt) return;
    const left = s.steps.filter(x => x.state === 'INCOMPLETE');
    const unmeasured = s.steps.filter(x => x.state === 'UNKNOWN');
    const done = n0(s.done), of = n0(s.denominator);
    const pctDone = done != null && of ? Math.round((done / of) * 100) : null;
    put('setup', `<div class="bg-surface-container-lowest border border-[#E8EAEF] rounded-[10px] p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div class="flex items-start md:items-center gap-3.5 min-w-0">
        <div class="w-9 h-9 rounded-[6px] bg-secondary-container/40 flex items-center justify-center shrink-0 text-primary"><span class="material-symbols-outlined text-[20px]">hub</span></div>
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-headline-md text-on-surface text-[14px] font-semibold tracking-tight">Setup progress</span>
            <span class="font-label-numeric-sm text-secondary text-[11px]">${esc(num(done))} of ${esc(num(of))} steps done</span>
          </div>
          <p class="font-body-sm text-on-surface-variant text-[13px] mt-0.5">${left.length ? `Still to do: ${esc(left.map(x => x.title).join(', '))}.` : 'Nothing is outstanding that could be checked.'}${unmeasured.length ? ` ${esc(num(unmeasured.length))} ${plural(unmeasured.length, 'step', 'steps')} could not be checked at all.` : ''}</p>
          ${note(para('The figure is steps confirmed done divided by six, and a step nobody could measure is not counted as done — so this line is not a claim that the rest of the setup is unfinished, only that six checks did not all come back done.')
            + para('It matters on this screen in particular: an unfinished setup means nothing is arriving, and a morning with no arrivals reads exactly like a morning with no leaks.'), 'How this line is counted')}
        </div>
      </div>
      <div class="flex items-center gap-4 shrink-0">
        ${pctDone == null ? '' : `<div class="w-40 sm:w-56 flex flex-col gap-1">
          <div class="flex justify-between items-center text-[11px] font-label-numeric-sm text-secondary"><span>STEPS DONE</span><span class="font-semibold text-primary">${esc(String(pctDone))}%</span></div>
          <div class="h-2 w-full bg-surface-container rounded-full overflow-hidden"><div class="h-full bg-primary rounded-full" style="width:${esc(String(pctDone))}%"></div></div>
        </div>`}
        ${SCREENS.setup ? `<button type="button" data-go="setup" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] bg-surface text-primary border border-[#E8EAEF] hover:bg-surface-container-low text-[13px] font-medium transition-colors"><span>Complete setup</span><span class="material-symbols-outlined text-[16px]">arrow_forward</span></button>` : ''}
      </div>
    </div>`);
  }).catch(() => {});

  /* ── Every read this screen makes, settled together ─────────────────────── */
  const [ld, ac, th, cv, tr, e, q, l, c, w, r, at] = await Promise.all([
    settle(readAllLeads()), settle(readActions()), settle(readThreads()), settle(readConvRows()), settle(readTrail()),
    settle(readEngine()), settle(readQueue()), settle(readLeads()), settle(readCoverage()), settle(readWorkflows()),
    settle(readReadiness()), settle(readAttention()),
  ]);
  if (!root.isConnected) return;

  const leadsAll = ld.err ? null : (ld.v || []);
  const actions  = ac.err ? null : (ac.v || []);
  const threads  = th.err ? null : (th.v || []);
  const convs    = cv.err ? null : (cv.v || []);
  const trail    = tr.err ? null : (tr.v || []);
  const engine   = e.err ? null : (e.v || []);
  const queue    = q.err ? null : (q.v || []);
  const leads    = l.err ? null : (l.v || []);
  const cov      = c.err ? null : one(c.v);
  const flows    = w.err ? null : (w.v || []);
  const ready    = r.err ? null : (r.v || []);

  const leaks = (engine && queue) ? buildLeaks(engine, queue) : null;
  const leadLeaks = leads ? buildLeadLeaks(leads) : null;
  const allLeaks = leaks ? leaks.concat(leadLeaks || []) : null;

  /* ────────────────────────────────────────────────────────────────────────
     P0 · Right now — the four things an owner walks in asking
     Above the leak register on purpose: a leak register is the argument, and
     this is the order of work. Every tile carries how its number was arrived
     at, and ownerTile() will not print a figure under NOT KNOWN.
     ──────────────────────────────────────────────────────────────────────── */
  paint('now', 'the Right now strip', () => {
    /* HOT LEADS. leads.status is the column the rest of this product routes on,
       so this is the count itself and not a proxy for it. CONFIRMED. */
    const hotLeads = leadsAll ? leadsAll.filter(x => up(x.status) === 'HOT') : null;
    const hotTile = leadsAll == null
      ? ownerTile({ label: 'Hot leads', prov: 'UNKNOWN', phrase: 'Not read', iconName: 'local_fire_department', note: readFailed('The leads table', ld.err) })
      : ownerTile({ label: 'Hot leads', prov: 'CONFIRMED', count: hotLeads.length, iconName: 'local_fire_department',
          intent: hotLeads.length ? 'danger' : 'success',
          meta: `of ${esc(num(leadsAll.length))} ${plural(leadsAll.length, 'lead', 'leads')} on file`,
          note: para('Counted on <code>leads.status</code>, which is the same column the router and every other screen '
            + 'in NEXUS routes on. It is not a re-scoring of anything.') });

    /* URGENT ACTIONS. PROPOSED is the one status that means a person has not
       answered yet. Counted over the same rows "Waiting on you" renders. */
    const proposed = actions ? actions.filter(a => up(a.status) === 'PROPOSED') : null;
    const actionTile = actions == null
      ? ownerTile({ label: 'Urgent actions', prov: 'UNKNOWN', phrase: 'Not read', iconName: 'bolt', note: readFailed('The recovery action queue', ac.err) })
      : ownerTile({ label: 'Urgent actions', prov: 'CONFIRMED', count: proposed.length, iconName: 'bolt',
          intent: proposed.length ? 'warning' : 'success',
          meta: `of ${esc(num(actions.length))} action ${plural(actions.length, 'record', 'records')}`,
          note: para('Every recovery action whose status is still PROPOSED — raised by the engine and not yet answered '
            + 'by a person. "Waiting on you" underneath is these same rows, so the two cannot disagree.') });

    /* UNANSWERED. ESTIMATED, and the reason is the whole tile: `conversation`
       records no message direction, so it cannot be asked whether anybody
       replied. The only place direction IS recorded against a thread is the
       communication ledger, and those threads are a DIFFERENT population — and
       a thread is not known to be a waiting customer. */
    const waiting = threads ? threads.filter(t => t.awaiting_reply === true) : null;
    const convLine = convs == null
      ? 'The conversation table could not be read on this load, so its size is not stated here.'
      : `The conversation table holds ${num(convs.length)} ${plural(convs.length, 'row', 'rows')}, and not one of them can be asked this question.`;
    const unansweredTile = threads == null
      ? ownerTile({ label: 'Unanswered', prov: 'UNKNOWN', phrase: 'Not read', iconName: 'timer_off', note: readFailed('The message ledger', th.err) })
      : ownerTile({ label: 'Unanswered', prov: 'ESTIMATED', count: waiting.length, iconName: 'timer_off',
          intent: waiting.length ? 'warning' : 'success',
          meta: `of ${esc(num(threads.length))} message ${plural(threads.length, 'thread', 'threads')} — not from <code>conversation</code>`,
          note: para('Counted as threads whose LAST message came from the customer, in the communication ledger, which is '
              + 'the only place in this database where a message direction is recorded against a thread.')
            + para('It is labelled estimated and not confirmed because it is not the population the tile names. '
              + '<code>conversation</code> carries no direction column, and no message event resolves to a '
              + 'conversation row, so "has this conversation been replied to" cannot be asked of it. ' + esc(convLine))
            + para('A thread is also not known to be a customer: these threads do not all resolve to a lead, so this is a '
              + 'count of conversations awaiting a reply and NOT a count of buyers left waiting.') });

    /* RECOVERED. Through recoveryEvidence() — the four-column test imported
       from screens/actions.js and never re-implemented here. A nought under
       this label is only allowed BECAUSE the test ran on every action record. */
    const evs = actions ? actions.map(a => ({ a, ev: recoveryEvidence(a) })) : null;
    const attributed = evs ? evs.filter(x => x.ev.state === 'ATTRIBUTED') : null;
    const unsupported = evs ? evs.filter(x => x.ev.state === 'UNSUPPORTED') : [];
    const recoveredTile = actions == null
      ? ownerTile({ label: 'Recovered', prov: 'UNKNOWN', phrase: 'Not read', iconName: 'verified', note: readFailed('The recovery evidence behind this count', ac.err) })
      : ownerTile({ label: 'Recovered', prov: 'CONFIRMED', count: attributed.length, iconName: 'verified',
          intent: attributed.length ? 'success' : 'neutral',
          meta: `${esc(num(actions.length))} ${plural(actions.length, 'action', 'actions')} tested on four columns`,
          note: para('An action counts as recovered only when all four of these are on the row: the outcome is ATTRIBUTED, a '
              + 'recorded sale is linked to it, somebody recorded on what basis, and somebody recorded how the figure was '
              + 'arrived at. The test is the one in the Action Center and is imported, not repeated.')
            + para(attributed.length
              ? 'The figure is a count of actions, not an amount of money. No currency total is offered here.'
              : 'Nought here is a finding and not a blank: the test ran on every action record above and none of them '
                + 'carried all four columns.')
            + (unsupported.length ? para(esc(unsupportedRecoverySentence(unsupported[0].ev))) : '') });

    return `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">${hotTile}${actionTile}${unansweredTile}${recoveredTile}</div>`;
  });

  /* ────────────────────────────────────────────────────────────────────────
     P0b · Waiting on you — the same PROPOSED rows the tile above counts, with
     the lead they are about joined here, because the enquiry text and the score
     are on `leads` and the decision columns are on `lead_recovery_actions`. A
     missing lead row is SAID, not blanked. Drawn as --012119's decision cards.
     ──────────────────────────────────────────────────────────────────────── */
  const reasons = new Map();
  const waitingNode = paint('waiting', 'the decisions waiting on you', () => {
    if (ac.err) return errorState({ what: 'the decisions waiting on you', err: ac.err, retry: 'moneyleaks' });
    const proposed = actions.filter(a => up(a.status) === 'PROPOSED' && !isHiddenLead(a.lead_id));
    const head = (n, chipHtml) => `<div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="flex items-center gap-2.5">
        <h2 class="font-headline-md text-on-surface text-[15px] font-semibold tracking-tight">Waiting on you</h2>${chipHtml}
      </div>
      <div class="flex items-center gap-2">${linkBtn('leadrecovery', 'Open Lead Recovery')}${linkBtn('actions', 'Open the Action Center')}</div>
    </div>`;
    if (!proposed.length) {
      return `<div class="space-y-3">${head(0, chip('nothing waiting', 'success', 'check'))}
        ${callout({ intent: 'success', iconName: 'task_alt', lede: 'Nothing is waiting on a decision',
          body: `<span>The queue was read and holds ${esc(num(actions.length))} action ${plural(actions.length, 'record', 'records')}, none of them still PROPOSED. That is a measured clear, not an empty screen.</span>` })}</div>`;
    }
    const rows = proposed.map(a => {
      const lead = leadsAll ? (leadsAll.find(x => str(x.id) === str(a.lead_id)) || null) : null;
      return { a, lead, leadUnread: leadsAll == null, reason: actionReason(a, lead, trail) };
    });
    reasons.clear();
    rows.forEach(x => { if (x.reason) reasons.set(str(x.a.id), firstSentence(x.reason.text)); });

    const cardFor = x => {
      const who = x.lead
        ? esc(str(x.lead.name) ? displayName(str(x.lead.name), x.lead.id) : 'Unnamed')
        : `Lead ${esc(str(x.a.lead_id))}`;
      const statusHtml = x.lead ? (str(x.lead.status) ? tempChip(x.lead.status) : chip('no status recorded', 'unknown')) : '';
      const leadNote = x.lead ? '' : (x.leadUnread
        ? hot('The leads table could not be read on this load, so nothing about this customer is shown. It is not a lead that is missing.')
        : hot('No lead row came back for this id. The action exists and the customer it is about does not read back, which is a fault to report rather than a row to tidy away.'));
      /* The score's provenance, verbatim off leads.score_source. A provenance is
         not a severity, so only "we do not know how this was scored" gets a
         colour, and it is the unknown one. */
      let scoreHtml = '';
      if (x.lead) {
        const n = n0(x.lead.ai_score);
        const src = up(x.lead.score_source);
        const meaning = SCORE_SOURCE_MEANING[src];
        scoreHtml = `<span class="font-label-numeric-sm text-[12px] text-on-surface font-semibold">Score ${esc(n == null ? '—' : num(n))}</span>`
          + (src ? chip(str(x.lead.score_source), scoreSourceIntent(src) === 'unknown' ? 'unknown' : 'neutral') : chip('no source recorded', 'unknown'))
          + note(para(esc(meaning || 'This screen has no meaning recorded for that value. It is shown exactly as the database holds it rather than folded into a word it might mean.'))
            + (str(x.lead.status) && tone(x.lead.status) === 'unknown' ? para(esc(UNKNOWN_WHY)) : ''), 'What the score is');
      }
      const ask = x.lead ? str(x.lead.vehicle_interest) : '';
      const reasonHtml = x.reason
        ? `<p class="font-body-sm text-[13px] text-on-surface-variant leading-relaxed">${esc(firstSentence(x.reason.text))}</p>`
          + note(para(esc(x.reason.text)) + muted('Read from ' + mono(x.reason.from)), 'The reason in full')
        : `<p class="font-body-sm text-[13px] text-outline italic">No reason recorded</p>${note(para(esc(NO_REASON)), 'Why this is blank')}`;
      return `<div class="bg-surface-container-lowest border border-[#E8EAEF] rounded-[10px] p-4 flex flex-col justify-between space-y-4">
        <div class="space-y-2.5">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-2 flex-wrap">${statusHtml}
              <span class="font-label-numeric-sm text-[12px] font-semibold text-primary">#${esc(str(x.a.lead_id))}</span>
              <span class="text-secondary text-[12px]">•</span>
              <span class="font-body-sm font-semibold text-on-surface text-[13px]">${who}</span>
            </div>
            <span class="text-[11px] font-label-numeric-sm text-secondary shrink-0">Raised ${esc(ago(x.a.proposed_at))}</span>
          </div>
          ${leadNote}
          ${reasonHtml}
          <div class="flex items-center gap-2 text-[12px] font-label-numeric-sm text-secondary bg-surface-container-low px-2.5 py-1.5 rounded-[6px] flex-wrap">
            <span class="material-symbols-outlined text-[16px] text-secondary">directions_car</span>
            ${x.lead ? (ask ? `<span class="text-on-surface">${esc(firstSentence(ask))}</span>${firstSentence(ask) === ask ? '' : note(para(esc(ask)), 'The enquiry in full')}` : '<span>Nothing was recorded as the enquiry on this lead.</span>') : '<span>Not shown — see above.</span>'}
          </div>
          ${scoreHtml ? `<div class="flex items-center gap-2 flex-wrap">${scoreHtml}</div>` : ''}
        </div>
        <div class="flex items-center justify-end gap-2 pt-2 border-t border-[#E8EAEF]">${actionButton(x.a)}</div>
      </div>`;
    };
    return `<div class="space-y-3">${head(proposed.length, chip(`${num(proposed.length)} ${plural(proposed.length, 'decision', 'decisions')} waiting`, 'warning'))}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${rows.map(cardFor).join('')}</div></div>`;
  });
  if (waitingNode) wireContact(waitingNode, reasons);

  /* ────────────────────────────────────────────────────────────────────────
     P1 · The register: filter pills, the headline exposure, and one Stitch
     leak card per line, worst first.

     THE HEADLINE is the sum of `engine_impact_aed` over the action records in
     the register, sized rows only, one kind only, through expose() imported
     from screens/overview.js — and its denominator stays on the SURFACE. It is
     EXPOSED, not estimated: --30144a labels it "estimated exposure", and that
     word is refused here because no engine produces an estimate (MONEY_WORD).
     ──────────────────────────────────────────────────────────────────────── */
  const sized = leaks ? leaks.filter(x => up(x.size.word) === 'EXPOSED') : [];
  const t = expose(sized, x => x.size.amount, x => x.size.kind);
  put('count', allLeaks == null
    ? chip('not read', 'unknown', 'help')
    : `<span class="px-2.5 py-0.5 rounded text-[10px] font-label-numeric-sm font-semibold ${allLeaks.length ? 'bg-error-container text-on-error-container' : 'bg-[#E6F4EF] text-[#157A5B]'} uppercase tracking-wider">${esc(num(allLeaks.length))} ${plural(allLeaks.length, 'leak', 'leaks')} today</span>`);

  const ledgerRows = buildLedger(queue, actions, leadsAll);

  const leaksNode = paint('leaks', 'the leak register', () => {
    if (q.err || e.err) {
      /* "Couldn't load" is kept: QUALITY_GATE.mjs detects an errored screen by
         those words. The register is unread, not empty. */
      return errorState({ what: 'the leak register', err: q.err || e.err, retry: 'moneyleaks' });
    }
    const leadNote = l.err
      ? callout({ intent: 'warning', iconName: 'warning', lede: 'The customer side of this register is missing, not clear.',
          body: '<span>Lead Recovery could not be read.</span>',
          noteHtml: para(`Lead Recovery could not be read (${esc(str(l.err.message) || 'no reason given')}), so any enquiry that needs chasing is absent from the list above rather than absent from the dealership.`),
          noteLabel: 'What that means' })
      : '';
    const all = allLeaks || [];
    const faults = all.filter(x => x.missing.length);
    const good = all.filter(x => !x.missing.length);
    const hotN = good.filter(x => x.tone === 'hot').length;
    const warmN = good.filter(x => x.tone !== 'hot').length;

    const PILL = {
      on:  'px-3 py-1.5 rounded-lg bg-primary text-on-primary font-body-sm text-body-sm font-semibold shadow-sm transition-all flex items-center gap-1.5',
      off: 'px-3 py-1.5 rounded-lg bg-surface-container-lowest hover:bg-surface-container text-on-surface font-body-sm text-body-sm transition-all flex items-center gap-1.5',
    };
    const COUNT = {
      on: 'px-1.5 rounded bg-surface-container-lowest text-primary text-[11px] font-label-numeric-sm',
      off: 'px-1.5 rounded bg-surface-container-high text-on-surface text-[11px] font-label-numeric-sm',
    };
    const pill = (key, label, n, dotCls, on) => `<button type="button" data-filter="${key}" class="${on ? PILL.on : PILL.off}">`
      + (dotCls ? `<span class="${dotCls}"></span>` : '') + `<span>${esc(label)}</span><span data-count class="${on ? COUNT.on : COUNT.off}">${esc(num(n))}</span></button>`;

    const exposureHtml = leaks == null ? '' : `<div class="flex flex-col items-end ml-auto">
      <div class="flex items-center gap-space-sm text-on-surface-variant font-label-numeric-sm text-label-numeric-sm">
        <span>GROSS MARGIN EXPOSED:</span>
        <span class="font-bold text-headline-md ${t.total == null ? 'text-outline' : 'text-error'}">${esc(t.total == null ? 'Not computable' : aed(t.total))}</span>
      </div>
      <div class="flex items-center gap-2 font-label-numeric-sm text-[11px] text-outline">
        <span>${esc(num(t.n))} of ${esc(num(t.of))} ${plural(t.of, 'line carries', 'lines carry')} a figure</span>
        ${note(para(esc(exposureLine(t, plural(sized.length, 'that leak', 'those leaks')))) + para(esc(EXPOSURE_CAVEAT))
          + para('This is the only figure on this screen that adds anything up. Nothing on this page adds a customer figure to a unit figure: no enquiry in this database carries a value at all, so the customer half of a true "revenue at risk" does not exist at any confidence and is not filled in.'), 'What this figure is')}
      </div></div>`;

    const filters = `<div class="flex items-center justify-between flex-wrap gap-space-sm">
      <div class="flex items-center gap-2 overflow-x-auto pb-1">
        ${pill('all', 'All leaks', good.length, '', true)}
        ${pill('hot', 'Hot', hotN, 'w-2 h-2 rounded-full bg-error', false)}
        ${pill('warm', 'Warm', warmN, 'w-2 h-2 rounded-full bg-tertiary', false)}
        <button type="button" data-jump="ledger" class="${PILL.off}"><span class="material-symbols-outlined text-sm text-primary">check_circle</span><span>Recorded today</span><span class="${COUNT.off}">${esc(ledgerRows == null ? '—' : num(ledgerRows.length))}</span></button>
      </div>
      ${exposureHtml}
    </div>`;

    if (!all.length) {
      return filters + callout({ intent: 'success', iconName: 'task_alt',
        lede: 'Nothing is leaking that this product can evidence today',
        body: '<span>Every engine that holds real data was asked and each came back clear. That is the correct answer, not an empty screen.</span>',
        noteHtml: para('The checks are listed to the right with the number of rows each one looked at, and separately the checks that could not run at all — because a question nobody could ask is not a question that came back clean.') }) + leadNote;
    }

    /* Rank 0 is not rank zero: buildLeadLeaks() appends lines that carry no
       figure to rank by, so they render as UNRANKED and the card says why. */
    const card = x => {
      const sz = sizeParts(x.size);
      const badgeIntent = x.tone === 'hot' ? 'danger' : 'warning';
      const engineName = x.kind === 'LEAD_AT_RISK' ? 'Lead Recovery engine' : 'Inventory Profit Sentinel';
      return `<div data-tone="${x.tone === 'hot' ? 'hot' : 'warm'}" class="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg flex flex-col gap-space-md">
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-space-sm bg-surface-container-low p-space-md rounded-lg">
          <div class="flex items-center gap-space-sm flex-wrap min-w-0">
            <span class="px-2 py-0.5 rounded bg-surface-container-highest font-label-numeric-sm text-[11px] font-bold text-on-surface">${x.rank ? `#${esc(String(x.rank))}` : 'UNRANKED'}</span>
            ${chip(x.badge, badgeIntent, x.tone === 'hot' ? 'emergency_home' : 'schedule')}
            <span class="font-headline-md text-headline-md font-bold text-on-surface">${esc(x.what)}</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span class="px-2.5 py-1 rounded text-xs font-medium bg-surface-container-highest text-on-surface-variant flex items-center gap-1"><span class="material-symbols-outlined text-sm text-secondary">hub</span>${esc(engineName)}</span>
            ${x.heldDays != null ? `<span class="font-label-numeric-sm text-[11px] text-outline">Open ${esc(num(x.heldDays))} ${plural(x.heldDays, 'day', 'days')}</span>` : ''}
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-space-md bg-surface-container p-space-md rounded-lg">
          <div class="flex flex-col space-y-1 min-w-0">
            <span class="font-table-header text-table-header uppercase text-outline">Why this is a leak</span>
            <span class="font-body-sm text-body-sm text-on-surface">${said(x.why, 'Why, in full')}</span>
          </div>
          <div class="flex flex-col space-y-1 md:border-l md:pl-space-md border-surface-container-high min-w-0">
            <span class="font-table-header text-table-header uppercase text-outline">Capital exposure</span>
            <div class="flex items-baseline gap-2 flex-wrap">${sz.figure}${sz.chip}</div>
            ${note(sz.note + (up(x.size.word) === 'EXPOSED' ? para(esc(EXPOSURE_CAVEAT)) : ''), 'How is this computed?')}
          </div>
          <div class="flex flex-col space-y-1 md:border-l md:pl-space-md border-surface-container-high min-w-0">
            <span class="font-table-header text-table-header uppercase text-outline">Confidence</span>
            <div>${chip(str(x.confidence.level), confIntent(x.confidence.level))}</div>
            ${note(para(esc(str(x.confidence.why))), 'Why this confidence')}
          </div>
        </div>
        <div class="flex flex-col gap-2 bg-surface-container-low p-space-md rounded-lg">
          <span class="font-table-header text-table-header uppercase text-outline font-semibold">Evidence — the rows behind this line</span>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-space-md gap-y-1.5 font-body-sm text-body-sm">
            ${x.evidence.map(ev => `<div class="flex items-start gap-2 text-on-surface"><span class="material-symbols-outlined text-base text-primary">check_circle</span><span>${esc(str(ev.fact))}${ev.source ? `<span class="block font-label-numeric-sm text-[11px] text-outline">${esc(str(ev.source))}</span>` : ''}</span></div>`).join('')}
          </div>
        </div>
        ${x.note ? `<div class="flex items-start gap-2 font-label-numeric-sm text-label-numeric-sm text-outline"><span class="material-symbols-outlined text-sm">history_toggle_off</span><span><span class="text-on-surface font-semibold">The engine’s own words:</span> ${esc(str(x.note))}</span></div>` : ''}
        <div class="p-space-md rounded-lg bg-surface-container-high flex items-start gap-space-sm">
          <span class="material-symbols-outlined text-primary text-xl mt-0.5">crisis_alert</span>
          <div class="flex flex-col space-y-0.5"><span class="font-body-md text-body-md font-bold text-on-surface">Recommended action:</span>
            <p class="font-body-md text-body-md text-on-surface-variant">${esc(str(x.action.ask))}</p></div>
        </div>
        <div class="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-space-md">
          <div class="flex items-center gap-2 flex-wrap">${linkBtn(x.action.screen, x.action.label, 'primary')}</div>
          ${x.rank ? '' : `<div class="font-body-sm text-[11px] text-outline max-w-sm">Unranked. The order is by the money behind each line, and this one is not sized — a statement about what the database holds, not about how urgent it is.</div>`}
        </div>
      </div>`;
    };

    return `<div class="flex flex-col gap-space-md">${filters}${faults.map(leakFault).join('')}
      <div class="flex flex-col gap-space-lg" data-cards>${good.map(card).join('')}</div>${leadNote}</div>`;
  });
  if (leaksNode) {
    const PILL_ON = 'px-3 py-1.5 rounded-lg bg-primary text-on-primary font-body-sm text-body-sm font-semibold shadow-sm transition-all flex items-center gap-1.5';
    const PILL_OFF = 'px-3 py-1.5 rounded-lg bg-surface-container-lowest hover:bg-surface-container text-on-surface font-body-sm text-body-sm transition-all flex items-center gap-1.5';
    leaksNode.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => {
      const f = b.dataset.filter;
      leaksNode.querySelectorAll('[data-filter]').forEach(x => { x.className = x === b ? PILL_ON : PILL_OFF; });
      leaksNode.querySelectorAll('[data-cards] > [data-tone]').forEach(n => {
        n.classList.toggle('hidden', f !== 'all' && n.dataset.tone !== f);
      });
    }));
    leaksNode.querySelector('[data-jump="ledger"]')?.addEventListener('click', () => {
      root.querySelector('[data-slot="ledger"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /* ── The right-hand rail, drawn as --012119's four cards ──────────────────── */
  const RAIL = 'bg-surface-container-lowest border border-[#E8EAEF] rounded-[10px] p-4 space-y-3';
  const railHead = (iconCls, iconName, title, rightHtml) => `<div class="flex items-center justify-between gap-2">
    <h3 class="font-headline-md text-on-surface text-[13px] font-semibold flex items-center gap-1.5"><span class="material-symbols-outlined ${iconCls} text-[18px]">${esc(iconName)}</span>${esc(title)}</h3>${rightHtml}</div>`;

  /* P3 · Register 2 — checks that came back clear. A source that could not be
     read contributes no CLEAR checks — an unread check is not a clear one. */
  paint('clear', 'the checks that came back clear', () => {
    const rows = measuredClear(engine, queue, leads);
    const notRun = [e.err && 'the inventory engine', q.err && 'the action lane', l.err && 'Lead Recovery'].filter(Boolean);
    const warn = notRun.length
      ? callout({ intent: 'warning', iconName: 'warning', lede: 'Some checks are absent because they could not be run.',
          body: `<span>Could not be read: ${esc(notRun.join(', '))}.</span>`,
          noteHtml: para(`Could not be read: ${esc(notRun.join(', '))}. Those checks are neither clear nor failing — they are unread, and they are not counted anywhere on this screen as clear.`) })
      : '';
    /* A row measuredClear() words as FAULT is not painted green: the screen no
       longer knows what the engine is saying, so it can claim neither clear nor
       dirty. The rule is read off that function's own wording, here. */
    const item = x => {
      const fault = /^FAULT\b/.test(str(x.what));
      return `<div class="p-2.5 rounded-[6px] ${fault ? 'border border-dashed border-outline-variant' : 'bg-[#E6F4EF]/50'} flex items-start justify-between gap-2">
        <div class="min-w-0"><div class="font-medium text-on-surface text-[12px]">${said(x.what, 'This check in full')}</div>
          <div class="text-[11px] text-secondary">${said(x.over, 'The denominator in full')}</div></div>
        <span class="font-label-numeric-sm text-[10px] font-bold ${fault ? 'text-outline' : 'text-[#157A5B]'} shrink-0">${fault ? 'FAULT' : 'CLEAR'}</span></div>`;
    };
    return `<div class="${RAIL}">${railHead('text-[#157A5B]', 'verified', 'Checks that came back clear',
        `<span class="text-[10px] font-label-numeric-sm ${notRun.length ? 'text-[#96570A]' : 'text-[#157A5B]'} font-semibold">${esc(num(rows.length))} ${notRun.length ? 'CLEAR · INCOMPLETE' : 'CLEAR'}</span>`)}
      <p class="text-[11px] text-on-surface-variant">Each names how many rows it looked at. A zero with a denominator is a finding; a zero without one is a guess.</p>
      ${warn}
      <div class="space-y-2 text-[12px]">${rows.length ? rows.map(item).join('')
        : `<div class="p-2.5 rounded-[6px] bg-surface text-[11px] text-on-surface-variant">No check came back clear. Either every check found something, or none of them could run — the registers beside this one say which.</div>`}</div></div>`;
  });

  /* P4 · Register 3 — checks that could not run. Not measured yet, so not
     counted as zero; each says since when, why, and what would switch it on. */
  paint('notrun', 'the checks that could not run', () => {
    const rows = notMeasured(engine, cov, leads, flows, ready);
    const KIND_INTENT = { OPERATIONAL: 'warning' };
    const item = x => `<div class="p-2.5 rounded-[6px] bg-[#FEF3E2]/50 border border-[#F3DFBD]/50 space-y-1">
      <div class="font-medium text-on-surface text-[12px] flex items-start justify-between gap-2"><span>${said(x.what, 'What is not measured, in full')}</span>${chip(x.kind, KIND_INTENT[x.kind] || 'unknown')}</div>
      <p class="text-[11px] text-secondary leading-tight">${said(x.since, 'Since when, in full')}</p>
      ${note(para('<strong>Why.</strong> ' + esc(str(x.why))) + para('<strong>What would light it up.</strong> ' + esc(str(x.unlock))), 'Why, and what would switch it on')}
    </div>`;
    return `<div class="${RAIL}">${railHead('text-[#96570A]', 'warning', 'Checks that could not run',
        `<span class="text-[10px] font-label-numeric-sm text-[#96570A] font-semibold">${esc(num(rows.length))} NOT MEASURED</span>`)}
      <p class="text-[11px] text-on-surface-variant">Unknown is not zero. These are not counted anywhere on this screen as clear.</p>
      <div class="space-y-2 text-[12px]">${rows.length ? rows.map(item).join('')
        : `<div class="p-2.5 rounded-[6px] bg-surface text-[11px] text-on-surface-variant">Every check this screen makes could be run. That has not been true of this database before, so if you are reading it, check that the reads above actually returned rows.</div>`}</div>
      <div class="flex items-center gap-2 flex-wrap">${linkBtn('inventory', 'Open Inventory')}${linkBtn('dealrescue', 'Open Deal Rescue')}</div></div>`;
  });

  /* P5 · Register 4 — alerts that are not leaks. The alert feed audited
     against the engines, one verdict per KIND, because the reason is a
     property of the kind and not of the row. Each verdict is a statement about
     evidence, not about the customer or the car. */
  paint('alerts', 'the alerts that are not leaks', () => {
    if (at.err) return errorState({ what: 'the alert feed', err: at.err, retry: 'moneyleaks' });
    const items = at.v || [];
    /* Measured, not asserted. An unreadable engine is not evidence that every
       unit is UNKNOWN. */
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
           + 'with its evidence.';
    }
    const ranked = (engine && queue) ? new Set(buildLeaks(engine, queue).map(x => str(x.what))) : null;
    /* `unanswered_chat` used to assert a database-wide fact from inside this
       static map ("not one thread resolves to a lead"), which was true of one
       dealership and false of another. v_needs_attention carries no resolution
       field, so the reason now says only what is true of ANY unanswered thread.
       `undercut` has its evidence to hand, so it is measured. */
    const VERDICT = {
      unanswered_chat: { verdict: 'REFUSED',
        why: 'This alert names a conversation thread, not a customer with a value. Putting money against it needs a lead '
           + 'the thread resolves to AND an opportunity value on that lead, and this screen does not have the second one '
           + 'for any lead on file. The threads are real and are listed on Conversations; calling them a money leak would '
           + 'be inventing the amount, and possibly the customer.' },
      undercut: { verdict: 'REFUSED', why: engineMarketNote(engine) },
      inventory_aging: { verdict: 'ALREADY RANKED',
        why: 'This is the same unit the inventory engine flags, and it is in the leak register with its evidence and its '
           + 'exposure. It is named here so the two lists can be reconciled, not counted twice.' },
      workflow_failure: { verdict: 'NOT A MONEY LEAK',
        why: 'A workflow that is failing is a reason a check could not run, which is the register above this one. It is '
           + 'not itself money going missing, and reporting it as money would be this dashboard inventing an amount for '
           + 'its own broken plumbing.' },
    };
    const kinds = new Map();
    items.forEach(i => { const k = str(i.kind) || 'untyped'; if (!kinds.has(k)) kinds.set(k, []); kinds.get(k).push(i); });
    const rows = [...kinds.entries()].map(([k, list_]) => {
      const v = VERDICT[k];
      return { kind: k, n: list_.length, verdict: v ? v.verdict : 'NO RULE',
        why: v ? v.why : 'This screen has no rule for that alert kind, so it is neither counted as a leak nor cleared. It is '
          + 'shown exactly as the alert feed holds it and somebody should decide which it is.' };
    });
    const VERDICT_INTENT = { 'ALREADY RANKED': 'info', 'NO RULE': 'unknown' };
    const item = x => `<div class="p-2.5 rounded-[6px] bg-surface flex items-start gap-2.5 border border-[#E8EAEF]">
      <span class="material-symbols-outlined text-[16px] text-secondary shrink-0 mt-0.5">policy</span>
      <div class="min-w-0 space-y-1"><div class="flex items-center gap-2 flex-wrap">${mono(x.kind)}<span class="text-[11px] text-on-surface font-semibold">${esc(num(x.n))} ${plural(x.n, 'item', 'items')}</span>${chip(x.verdict, VERDICT_INTENT[x.verdict] || 'success')}</div>
        <p class="text-[11px] text-on-surface-variant leading-snug">${said(x.why, 'Why this is not a leak')}</p></div></div>`;
    /* The alert text itself (title / detail) is deliberately not printed: the
       lead-shaped kinds carry a customer's name in `title`, and this panel's
       job is the verdict per kind, not the rows — Conversations and Leads list
       those, through the privacy helper. */
    const reconciled = ranked
      ? `<p class="text-[11px] text-on-surface-variant">Reconciled against the ${esc(num(ranked.size))} ${plural(ranked.size, 'line', 'lines')} in the leak register: an alert marked ALREADY RANKED appears there with its evidence and is not counted twice.</p>`
      : `<p class="text-[11px] text-outline">The leak register could not be read on this pass, so these alerts have not been reconciled against it. Nothing is claimed about which of them is also there.</p>`;
    const confirmedNote = callout({ intent: 'neutral', iconName: 'payments', lede: 'The money that is on file is not a leak either.',
      body: '<span>Confirmed sale revenue exists here and nothing on this screen takes credit for it.</span>',
      noteHtml: para('There is confirmed sale revenue in this database. It is not shown on this screen as a leak, as a recovery or as anything NEXUS did: the attribution chain grades its campaign hop UNKNOWN and its margin NOT COMPUTABLE, so nothing here may take credit for it. Attribution is the screen that says so, hop by hop.')
        + `<div class="pt-1">${linkBtn('attribution', 'Open Attribution')}</div>`, noteLabel: 'Why not' });
    return `<div class="${RAIL}">${railHead('text-primary', 'info', 'Alerts that are not leaks', `<span class="text-[10px] font-label-numeric-sm text-secondary font-semibold">${esc(num(items.length))} ALERTS</span>`)}
      <div class="space-y-2 text-[12px]">${rows.length ? rows.map(item).join('')
        : '<div class="p-2.5 rounded-[6px] bg-surface text-[11px] text-on-surface-variant">The alert feed is empty, so there is nothing to audit. That is a statement about the alert feed, not about the dealership.</div>'}</div>
      ${rows.length ? reconciled : ''}${confirmedNote}
      <div class="flex items-center gap-2 flex-wrap">${linkBtn('conversations', 'Open Conversations')}${linkBtn('competitors', 'Open Competitors')}</div></div>`;
  });

  /* P6 · The four money words, and what NEXUS has actually earned. The
     recovered figure goes through the four-column test in screens/actions.js
     and nothing else; a row carrying the amount without the evidence is a
     fault to report, never an amount to read. */
  paint('words', 'the four money words', () => {
    const rec = queue ? queue.map(a => ({ a, ev: recoveryEvidence(a) })) : null;
    const attributed = rec ? rec.filter(x => x.ev.state === 'ATTRIBUTED') : null;
    const unsupported = rec ? rec.filter(x => x.ev.state === 'UNSUPPORTED') : null;
    const attTotal = attributed ? expose(attributed, x => x.ev.amount, () => 'ATTRIBUTED_MARGIN') : null;
    const exposedN = queue ? queue.filter(a => up(a.engine_impact_kind) === 'MARGIN_EXPOSED').length : null;
    const rows = [
      { word: 'EXPOSED', dot: 'w-1.5 h-1.5 rounded-full bg-[#96570A]', txt: 'text-[#96570A]',
        held: exposedN == null ? 'Unknown — the action lane could not be read'
          : `${num(exposedN)} action ${plural(exposedN, 'record carries', 'records carry')} this kind`,
        why: 'The only word the inventory engine emits, and the only one this screen totals.' },
      { word: 'ESTIMATED', dot: 'w-1.5 h-1.5 rounded-full border border-outline', txt: 'text-outline',
        held: 'No engine in NEXUS produces an estimate, so nothing carries this word',
        why: 'Listed because a vocabulary with no empty slots is a vocabulary nobody checks.' },
      { word: 'ATTRIBUTED', dot: 'w-1.5 h-1.5 rounded-full bg-[#2563A8]', txt: 'text-[#2563A8]',
        held: attributed == null ? 'Unknown — the action lane could not be read'
          : (attributed.length
              ? `${num(attributed.length)} ${plural(attributed.length, 'action carries', 'actions carry')} a figure that passes all four evidence columns${attTotal && attTotal.total != null ? ` — ${aed(attTotal.total)}` : ''}`
              : 'Nothing has passed the four-column evidence test, so nothing carries this word'),
        why: 'The four columns are an ATTRIBUTED outcome, a linked sale, a basis for tying them together, and a basis for the figure itself. The database refuses to store the amount without all four; this screen refuses to show it without all four.' },
      { word: 'CONFIRMED', dot: 'w-1.5 h-1.5 rounded-full bg-[#157A5B]', txt: 'text-[#157A5B]',
        held: cov
          ? (n0(cov.leads_with_a_confirmed_sale) ? `${num(cov.leads_with_a_confirmed_sale)} recorded ${plural(cov.leads_with_a_confirmed_sale, 'sale', 'sales')} on file, and ${num(cov.sales_attributed_to_a_recovery_action)} of them attributed to anything NEXUS did`
              : 'No recorded sale is on file')
          : (c.err ? 'Unknown — the coverage read failed' : 'Unknown — the coverage view returned no row for this dealership'),
        why: 'Confirmed revenue exists in this database and none of it is credited to NEXUS. That distinction is the product, not a shortcoming of it.' },
    ];
    const fault = (unsupported && unsupported.length)
      ? callout({ intent: 'danger', iconName: 'report',
          lede: `${num(unsupported.length)} ${plural(unsupported.length, 'action record claims', 'action records claim')} money with nothing behind it.`,
          noteHtml: para(esc(unsupportedRecoverySentence(unsupported[0].ev))), noteLabel: 'What is missing' })
      : '';
    return `<div class="${RAIL}">
      <div class="flex items-center justify-between border-b border-[#E8EAEF] pb-2">
        <h3 class="font-headline-md text-[13px] font-bold uppercase tracking-wider text-secondary">The four money words</h3>
        <span class="material-symbols-outlined text-[16px] text-secondary">menu_book</span>
      </div>
      ${fault}
      <p class="text-[11px] text-on-surface-variant">Each money word has one rule. A figure that has not met its rule is not shown.</p>
      <div class="space-y-2.5 text-[12px]">${rows.map(x => `<div>
        <div class="font-label-numeric-sm text-[11px] font-bold ${x.txt} flex items-center gap-1.5"><span class="${x.dot}"></span>${esc(MONEY_WORD[x.word].label.toUpperCase())}</div>
        <p class="text-[11px] text-on-surface-variant mt-0.5 leading-snug">${said(MONEY_WORD[x.word].gloss, 'The full definition')}</p>
        <p class="text-[11px] text-on-surface mt-0.5 leading-snug"><span class="text-outline">Today:</span> ${esc(x.held)}</p>
        ${note(para(esc(x.why)), 'Why it is listed')}
      </div>`).join('')}
      <div><div class="font-label-numeric-sm text-[11px] font-bold text-outline flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full border border-outline"></span>NOT COMPUTABLE</div>
        <p class="text-[11px] text-on-surface-variant mt-0.5 leading-snug">${said(MONEY_WORD.NOT_COMPUTABLE.gloss, 'The full definition')}</p></div>
      </div></div>`;
  });

  /* ────────────────────────────────────────────────────────────────────────
     P7 · The outcome ledger: what was recorded TODAY. --30144a's last
     section, and the one Stitch region that needed a filter rather than a new
     read: the rows are the action queues this screen already holds, kept when a
     decision, an execution or an outcome is dated today in Dubai. "Recovered"
     goes through recoveryEvidence() and nothing else, so an amount without its
     four columns is withheld here exactly as it is everywhere.
     ──────────────────────────────────────────────────────────────────────── */
  paint('ledger', 'the outcome ledger', () => {
    const headHtml = n => `<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm pb-space-sm">
      <div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-xl">fact_check</span>
        <h2 class="font-headline-md text-headline-md font-bold text-on-surface">Outcome ledger: recorded today</h2>
        <span class="px-2 py-0.5 rounded text-[11px] font-label-numeric-sm font-semibold bg-surface-container-high text-on-surface">${esc(n)}</span></div>
      <span class="font-label-numeric-sm text-xs text-outline">Decisions, executions and outcomes dated ${esc(dubaiDate(readAt))}</span></div>`;
    if (ledgerRows == null) {
      return `<div class="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg">${headHtml('not read')}
        ${errorState({ what: 'the outcome ledger', err: q.err || ac.err, retry: 'moneyleaks' })}</div>`;
    }
    const partial = (q.err || ac.err)
      ? `<p class="font-body-sm text-[12px] text-[#96570A] pb-2">${q.err ? 'The inventory action queue' : 'The recovery action queue'} could not be read, so its decisions are missing from this list — not absent from the day.</p>` : '';
    const OUT_INTENT = { APPROVED: 'info', EXECUTED: 'success', EXECUTION_FAILED: 'danger', REJECTED: 'neutral', DEFERRED: 'warning', CANCELLED: 'neutral', ESCALATED: 'warning' };
    const body = ledgerRows.length ? `<div class="overflow-x-auto"><table class="w-full text-left border-collapse">
      <thead><tr class="bg-surface-container-low text-outline font-table-header text-table-header uppercase">
        <th class="py-2.5 px-3 rounded-l-lg">Time</th><th class="py-2.5 px-3">Subject</th><th class="py-2.5 px-3">What was recorded</th>
        <th class="py-2.5 px-3 text-right">Recovered</th><th class="py-2.5 px-3 text-right rounded-r-lg">Recorded by</th></tr></thead>
      <tbody class="divide-y divide-surface-container-high font-body-md text-body-md">${ledgerRows.map(x => {
        const ev = recoveryEvidence(x.row);
        const money = ev.state === 'ATTRIBUTED'
          ? `<span class="font-label-numeric-md text-label-numeric-md font-bold text-primary">${esc(aed(ev.amount))}</span><div class="font-label-numeric-sm text-[10px] text-outline">attributed, four columns on file</div>`
          : ev.state === 'UNSUPPORTED'
            ? `<span class="font-label-numeric-sm text-[11px] text-error font-semibold">Withheld</span>${note(para(esc(unsupportedRecoverySentence(ev))), 'Why')}`
            : '<span class="font-label-numeric-md text-label-numeric-md text-outline">—</span><div class="font-label-numeric-sm text-[10px] text-outline">no recovery recorded</div>';
        return `<tr class="hover:bg-surface-container-low transition-colors">
          <td class="py-3 px-3 font-label-numeric-sm text-label-numeric-sm text-outline whitespace-nowrap">${esc(dubaiStamp(x.at))}</td>
          <td class="py-3 px-3"><div class="flex flex-col"><span class="font-semibold text-on-surface">${esc(x.subject)}</span><span class="font-label-numeric-sm text-[11px] text-outline">${esc(x.ref)}</span></div></td>
          <td class="py-3 px-3"><div class="flex flex-col gap-0.5">${chip(`${x.what} · ${x.status || 'no status'}`, OUT_INTENT[up(x.status)] || 'neutral')}${x.detail ? `<span class="font-body-sm text-[11px] text-outline">${esc(x.detail)}</span>` : ''}</div></td>
          <td class="py-3 px-3 text-right">${money}</td>
          <td class="py-3 px-3 text-right font-label-numeric-sm text-label-numeric-sm text-on-surface-variant">${esc(x.by || 'Not recorded')}</td></tr>`;
      }).join('')}</tbody></table></div>`
      : `<div class="p-space-md rounded-lg bg-surface-container-low font-body-sm text-body-sm text-on-surface-variant">Nothing was decided, carried out or given an outcome today in the ${esc(num((queue || []).length + (actions || []).length))} action records read. That is a statement about today's records, not about the work done on the floor — only what somebody recorded in NEXUS can appear here.</div>`;
    return `<div class="bg-surface-container-lowest rounded-xl shadow-sm p-space-lg flex flex-col gap-space-md">${headHtml(`${num(ledgerRows.length)} ${plural(ledgerRows.length, 'entry', 'entries')}`)}${partial}${body}</div>`;
  });

  put('footer', trustFooter({
    source: 'rpc/sentinel_inventory_actions · v_inventory_action_queue · v_lead_recovery · lead_recovery_actions · v_needs_attention',
    asOf: dubaiStamp(readAt),
    evidence: allLeaks == null ? 'The register could not be read'
      : `${num(allLeaks.length)} leak ${plural(allLeaks.length, 'line', 'lines')} from ${num((queue || []).length)} inventory and ${num((actions || []).length)} recovery action records`,
    actor: ME && ME.name ? ME.name : '',
  }));
};

/* The outcome ledger's rows: every decision, execution or recorded outcome on
   either action queue whose timestamp falls on today's Dubai date. Returns null
   when NEITHER queue was read — an unread ledger is not an empty day. Leads are
   named through lib/privacy.js; a unit by its model. */
function buildLedger(queue, actions, leadsAll) {
  if (!queue && !actions) return null;
  const today = dubaiDate(Date.now());
  const isToday = ts => !!ts && dubaiDate(ts) === today;
  const out = [];
  const stampOf = r => [['outcome', r.outcome_recorded_at], ['executed', r.executed_at], ['decided', r.decided_at]]
    .find(([, ts]) => isToday(ts)) || null;
  (queue || []).forEach(r => {
    const hit = stampOf(r);
    if (!hit) return;
    out.push({ row: r, at: hit[1], what: hit[0] === 'outcome' ? 'Outcome' : hit[0] === 'executed' ? 'Execution' : 'Decision',
      status: hit[0] === 'outcome' ? str(r.outcome_state) : str(r.status),
      detail: str(r.outcome_sentence) || str(r.decision_reason_label) || str(r.execution_failure),
      subject: str(r.unit_model) || `Unit ${str(r.unit_id)}`, ref: `Unit ${str(r.unit_id)} · inventory action ${str(r.id)}`,
      by: hit[0] === 'outcome' ? str(r.outcome_recorded_by_name) : hit[0] === 'executed' ? str(r.executed_by_name) : str(r.decided_by_name) });
  });
  (actions || []).forEach(r => {
    const hit = stampOf(r);
    if (!hit || isHiddenLead(r.lead_id)) return;
    const lead = leadsAll ? leadsAll.find(x => str(x.id) === str(r.lead_id)) : null;
    out.push({ row: r, at: hit[1], what: hit[0] === 'outcome' ? 'Outcome' : hit[0] === 'executed' ? 'Execution' : 'Decision',
      status: hit[0] === 'outcome' ? str(r.outcome_state) : str(r.status),
      detail: str(r.recommendation) ? `Recommendation ${str(r.recommendation)}` : '',
      subject: lead && str(lead.name) ? displayName(str(lead.name), lead.id) : `Lead ${str(r.lead_id)}`,
      ref: `Lead ${str(r.lead_id)} · recovery action ${str(r.id)}`,
      /* lead_recovery_actions stores a staff id, not a name; the name is on the
         Lead Recovery queue view. Said rather than guessed. */
      by: 'See Lead Recovery' });
  });
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

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

/* Exported 7 Oct 2026 for screens/owner-brief.js, whose "Top risks" block is the
   top of THIS register and must not be a second derivation of it. The reads are
   exported with their reset so a second screen shares the same per-render
   memo rules rather than inventing its own. */
export { buildLeaks, buildLeadLeaks, MONEY_WORD, resetReads, readEngine, readQueue, readLeads, readAllLeads, readActions };
