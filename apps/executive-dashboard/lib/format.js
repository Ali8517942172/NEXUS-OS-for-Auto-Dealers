/* NEXUS OS — lib/format.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { $ } from './dom.js';

function esc(v) {
  if (v == null) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
const nf = new Intl.NumberFormat('en-AE');
const n0 = v => (v == null || v === '' || Number.isNaN(Number(v))) ? null : Number(v);
const num  = v => { const x = n0(v); return x == null ? '—' : nf.format(Math.round(x)); };
const aed  = v => { const x = n0(v); return x == null ? '—' : 'AED ' + nf.format(Math.round(x)); };
const aedSigned = v => { const x = n0(v); if (x == null) return '—'; return (x < 0 ? '−' : '+') + 'AED ' + nf.format(Math.abs(Math.round(x))); };
const pct  = v => { const x = n0(v); return x == null ? '—' : x.toFixed(1) + '%'; };
const mins = v => {
  const x = n0(v);
  if (x == null) return '—';
  /* Deliberately stays in minutes up to 2 h. The 5-minute rule is the founding
     promise of this product; "73 min" is uncomfortable in a way "1.2 h" is not,
     and that discomfort is the point. */
  if (x < 120) return `${Math.round(x)} min`;
  return `${(x / 60).toFixed(1)} h`;
};

function ago(ts) {
  if (!ts) return '—';
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (Number.isNaN(d)) return '—';
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d/60)} m ago`;
  if (d < 86400) return `${Math.floor(d/3600)} h ago`;
  if (d < 2592000) return `${Math.floor(d/86400)} d ago`;
  /* Stay relative past 30 days. The Age column was switching to an absolute
     date mid-list ("29 d ago" then "7 Jul 2026"), so two rows one day apart
     looked unrelated and could not be compared at a glance. */
  const mo = Math.floor(d / 2592000);
  if (mo < 12) return `${mo} mo ago`;
  return `${Math.floor(mo / 12)} y ago`;
}
/* ── Dates and times, pinned to the showroom's clock ──────────────────────
   Every workflow in n8n carries "timezone": "Asia/Dubai", so every timestamp
   in this database is a moment in the showroom's day. Rendering it with a bare
   toLocaleString() re-reads it in whatever zone the browser is sitting in, and
   the two disagree silently: a manager opening this dashboard from London saw
   an enquiry that arrived at 16:20 in Dubai printed as 12:20, with nothing on
   screen to say which clock it was. Four hours is exactly the size of error
   that still looks like a plausible time, which is what makes it dangerous.

   So there is one formatter and it is fixed to Asia/Dubai. The UAE has not
   observed daylight saving, so the offset is a constant +04:00 and GST is the
   only label these ever need to carry. Anywhere a bare time could be read as
   the reader's own, it is labelled; a full date-and-time is labelled for the
   same reason. `ago()` needs none of this — an elapsed interval is the same
   number of minutes in every zone — which is why it is left alone below. */
const TZ = 'Asia/Dubai';
const TZ_LABEL = 'GST';
const dubaiFmt = opts => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts });
const F_DATE  = dubaiFmt({ day:'numeric', month:'short', year:'numeric' });
const F_TIME  = dubaiFmt({ hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
const F_STAMP = dubaiFmt({ day:'numeric', month:'short', year:'numeric',
                           hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });

/* Null, '' and an unparseable string are all "no timestamp", and they must not
   render as 1970. The caller chooses the placeholder because '—' is right in a
   table cell and '--:--:--' is right where a running clock used to be. */
const tsDate = v => {
  if (v == null || v === '') return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : new Date(t);
};
const dubaiDate  = (ts, fb = '—') => { const d = tsDate(ts); return d ? F_DATE.format(d) : fb; };
const dubaiTime  = (ts, fb = '—') => { const d = tsDate(ts); return d ? `${F_TIME.format(d)} ${TZ_LABEL}` : fb; };
const dubaiStamp = (ts, fb = '—') => { const d = tsDate(ts); return d ? `${F_STAMP.format(d)} ${TZ_LABEL}` : fb; };
/* The topbar/mono clock. Same formatter, same label, older placeholder. */
const clock = ts => dubaiTime(ts, '--:--:--');
const initials = name => (name || '?').split(/\s+/).filter(Boolean).slice(0,2).map(w => w[0]).join('').toUpperCase();

/* Every severity vocabulary in the system maps through this one table.
   WARNING was missing until 24 Aug 2026, and its absence was silent in the
   worst possible way: tone('WARNING') returned '', pill() then emitted
   `class="pill "`, and a warning rendered identically to a neutral note — a
   thing that needs a human looked like a thing that does not. Five separate
   screens had independently grown a private severity map to work around it.

   Five vocabularies land here and they must all be covered:
     v_needs_attention.severity   HOT | WARM | COLD
     inventory.aging_alert        HEALTHY | WARNING | CRITICAL   (counted live 24 Aug:
                                  9 / 2 / 1. An earlier note here said OK; the
                                  database has never held that value. Both
                                  spellings are covered below so nothing renders
                                  wrong, but HEALTHY is the real one.)
     audit_log.status             SUCCESS | FAILED | REJECTED | ESCALATED
     leads.status                 HOT | WARM | COLD from the router, plus
                                  CONTACTED | QUALIFIED | WON | LOST from the
                                  Slack Command Center and DISQUALIFIED from the
                                  BDC agent — eight values, written by three
                                  different things. See the lifecycle block
                                  below; it is the reason this table grew a
                                  'won', a 'dead' and an 'open'.
   plus v_workflow_health.health and the outcome classes behind it, which are
   the vocabulary with a genuine fourth state: NOT_INSTRUMENTED is not health,
   it is the absence of evidence, so it never maps to 'ok'. Colouring an
   unmeasured workflow green is how a dashboard lies without anyone writing a
   false sentence.

   Those last two vocabularies are NOT this table's to define. lib/health.js
   mirrors nexus_outcome_class() and already declares a tone for every value of
   HEALTH_WORDS and OUTCOME_WORDS; the entries below are copied from it, and if
   the two ever disagree health.js is right. Both were audited against it on
   1 Sep 2026 and three of its values were simply absent — PRODUCING_NOTHING
   worst among them. A workflow that runs without failing and achieves nothing
   is a fault, and with no entry here tone() fell through to the neutral grey
   reserved for words nobody has taught this table: Competitor Price Scraping,
   96 runs and 12 successes in the window with 84 producing no usable price,
   was painted as though the dashboard had no opinion about it. */
const TONE = {
  HOT:'hot', WARM:'warm', COLD:'cold',
  GOOD:'ok', OK:'ok', SUCCESS:'ok', APPROVED:'ok', HEALTHY:'ok', ACTIVE:'ok', SENT:'ok',
  FAILED:'hot', REJECTED:'hot', CRITICAL:'hot', ERROR:'hot', BREACHED:'hot',
  ESCALATED:'warm', PENDING:'warm', WARNING:'warm', PENDING_INVITE:'warm',
  /* DEGRADED is 'hot', not 'warm', and the disagreement is worth settling here
     rather than in five private maps. Automation, Settings, Ask and Overview had
     each independently decided it was red; only this table said amber, so the
     same workflow was two colours on two screens. A workflow that is failing in
     production is not a note to read later — DEGRADED is exactly the state the
     dead Gmail credential put Lead Escalation in, and it stopped every
     escalation email the dealership sends. */
  DEGRADED:'hot',
  /* ── v_workflow_health.health, in full, copied from HEALTH_WORDS ──────────
     PRODUCING_NOTHING is 'hot' for the same reason DEGRADED is: it is a fault,
     not a note. NEVER_RAN and NOT_INSTRUMENTED moved from 'cold' to 'unknown'
     to match health.js — 'cold' is a graded low state, and neither of these is
     graded at all; they are the absence of evidence, which is what the
     'unknown' tone exists to say. Nothing turns green either way. */
  PRODUCING_NOTHING:'hot',
  UNKNOWN_OUTCOME:'unknown', NO_QUALIFYING_RUNS:'unknown',
  NEVER_RAN:'unknown', NOT_INSTRUMENTED:'unknown',
  /* ── The outcome classes, copied from OUTCOME_WORDS ───────────────────────
     SUCCESS is already 'ok' above. These are the CLASS names returned by
     outcomeOf(), not the raw audit_log.status spellings — FAILURE is the class,
     FAILED is the status the row carries, and both must be red. NO_RESULT and
     REJECTED_EXPECTED were reaching the neutral grey by fallback, which was the
     right colour for the wrong reason: they are neutral because health.js says
     a run that produced nothing is neither a crash nor a success, not because
     nobody had heard of them. Naming them is what makes that checkable.

     Two words in this table are shared with a vocabulary health.js does not
     govern and are therefore deliberately NOT aligned to it:
       ESCALATED — health.js tones it neutral, because an escalated workflow run
         is deliberate and excluded from every rate. But kyc_documents.verdict
         also spells a document handed to a human ESCALATED, and that one is
         waiting on somebody. It stays 'warm' above. A screen reading workflow
         outcomes must take its tone from OUTCOME_WORDS, not from here.
       REJECTED — likewise the KYC verdict for a refused document, which stays
         'hot'. The outcome class for a refused workflow call is spelled
         REJECTED_EXPECTED and is neutral, which is the entry below. */
  PARTIAL:'hot', FAILURE:'hot',
  NO_RESULT:'unknown', REJECTED_EXPECTED:'unknown',
  /* UNKNOWN was 'cold', which contradicted this table's own fallback four lines
     below: a word nobody has taught it tones 'unknown', while the word UNKNOWN
     itself toned like a graded cold item. */
  UNKNOWN:'unknown', INACTIVE:'cold', VOIDED:'cold',
  /* The screens' own derived alerts speak a second vocabulary. It lives here
     rather than in five private maps so that one severity can never be two
     colours on two screens. */
  HIGH:'hot', MEDIUM:'warm', LOW:'cold', INFO:'cold',

  /* ── The lead lifecycle, added 30 Aug 2026 ──────────────────────────────
     Three vocabularies write to `leads.status` and only the first was ever in
     this table. The Master Router writes HOT | WARM | COLD. The Slack Command
     Center writes CONTACTED, QUALIFIED, WON and LOST through an unconstrained
     $fromAI, so the model picks the word. The BDC agent and the silence
     detector both write and read DISQUALIFIED. Eight values reach the browser;
     three were known here, and the other five fell through to 'cold' — which
     meant a WON deal was painted in exactly the blue of a lead that never
     replied. A closed sale and a dead lead are the two ends of this table and
     they must never share a colour.

     Three outcomes, three tones: 'won' for money in, 'dead' for the ones that
     are finished and lost, 'open' for everything still being worked. 'ok' is
     deliberately not reused for WON — 'ok' means a system is healthy, and a
     workflow running normally is not the same claim as a car being sold. */
  NEW:'open', CONTACTED:'open', QUALIFIED:'open', WORKING:'open',
  IN_PROGRESS:'open', FOLLOW_UP:'open', NEGOTIATING:'open', OPEN:'open',
  WON:'won', CLOSED_WON:'won', CONVERTED:'won', DELIVERED:'won', SOLD:'won',
  LOST:'dead', CLOSED_LOST:'dead', DISQUALIFIED:'dead', UNQUALIFIED:'dead',
  CLOSED:'dead', DEAD:'dead', JUNK:'dead', SPAM:'dead', ARCHIVED:'dead',
};
/* An unrecognised value is not neutral — it is a value nobody taught this table
   about — but it is not cold either, and that is what the old fallback claimed.
   `$fromAI` writes this column, so the next word it invents will arrive here
   without a deploy, and painting it in the COLD blue files it under a state the
   router never gave it. 'unknown' is its own tone: legible, obviously not one
   of the graded states, and carrying a title that says so on hover. Callers
   that must distinguish can read TONE directly. */
const toneKey = s => String(s ?? '').toUpperCase().replace(/[\s-]+/g, '_');
const tone = s => {
  const k = toneKey(s);
  return TONE[k] || (k ? 'unknown' : '');
};
const UNKNOWN_WHY = 'This dashboard has no wording for that status. It is shown exactly as the database holds it rather than folded into a state it might mean.';
/* pill(label, tone, opts)

   The hover text above is the only place an unrecognised status can explain
   itself, and without it 'unknown' is just another grey pill. But it is a claim
   about PROVENANCE — it says this label is a value the database handed us — and
   until 1 Sep 2026 evening this helper attached it to any grey pill whose label
   was not a TONE key. It cannot see provenance, so on a label a caller wrote
   deliberately both halves of the sentence are false: the dashboard plainly has
   wording for it (the caller supplied the words), and the database holds no
   such string. `pill('No status written', 'unknown')` hovered as "shown exactly
   as the database holds it" over a phrase no row anywhere contains.

   That is not a cosmetic defect, it is a shared module telling a lie on behalf
   of its callers, and three screens had already fled the helper over it rather
   than fix it here: automation.js and finance.js each grew a private wordPill(),
   and compliance.js a private casePill(), all three re-emitting pill()'s own
   markup by hand purely to be rid of this title. A shared helper that screens
   route around is worse than no helper.

   So provenance is now the CALLER'S to state, through `opts.verbatim`:

     { verbatim: true }   this label is a status value taken verbatim from the
                          database. Attach the note if we have no wording for it.
     { verbatim: false }  these words are mine. Never claim otherwise.
     omitted              fall back to the one thing this function can actually
                          observe: whether IT derived the tone. With no `t` the
                          helper looked `label` up in TONE and failed, which is
                          the shape a raw status word arrives in and is what the
                          note was written for. With a `t` the caller had its own
                          opinion about how to paint this, so the label is not
                          something this helper can vouch for and it says nothing.

   The default is a fallback, not a proof, and it can be wrong in BOTH
   directions. A caller that passes no tone and a literal of its own
   ("Unscored", "Unrated") still gets the note and still should not: pass
   `{ verbatim: false }`. A caller that renders a RAW column value but computes
   its tone itself — `pill(sev, sevTone(sev))`, `pill(h, tone(h))`,
   `pill(a, tone(a))` — takes the explicit path and so loses the note on a value
   that genuinely came from the database: pass `{ verbatim: true }`. Those two
   flags are the whole of the fix at a call site; nothing else has to move.
   The `!named` guard below is unchanged and independent — a label the TONE table
   knows (NO_RESULT, REJECTED_EXPECTED, NO_QUALIFYING_RUNS, NOT_INSTRUMENTED,
   NEVER_RAN are all toned neutral on purpose) never carries the note, whatever
   the caller claims, because "no wording for that status" would be false about
   a state this file has a whole paragraph of wording for. */
const pill = (label, t, opts) => {
  const k = t || tone(label);
  const named = TONE[toneKey(label)] != null;
  const stated = opts && typeof opts === 'object' && 'verbatim' in opts;
  const verbatim = stated ? !!opts.verbatim : !t;
  const why = k === 'unknown' && !named && verbatim;
  return `<span class="pill ${k}"${why ? ` title="${esc(UNKNOWN_WHY)}"` : ''}><span class="dot"></span>${esc(label)}</span>`;
};

/* ── States. Every panel has all four; a panel without them is not done. ─── */

export { esc, nf, n0, num, aed, aedSigned, pct, mins, ago, clock, initials, TONE, tone, pill, TZ, TZ_LABEL, dubaiDate, dubaiTime, dubaiStamp, UNKNOWN_WHY };
