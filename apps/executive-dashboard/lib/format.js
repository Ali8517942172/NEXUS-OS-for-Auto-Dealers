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
   plus v_workflow_health.health, which is the one with a genuine fourth state:
   NOT_INSTRUMENTED is not health, it is the absence of evidence, so it maps to
   'cold' and never to 'ok'. Colouring an unmeasured workflow green is how a
   dashboard lies without anyone writing a false sentence. */
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
  NEVER_RAN:'cold', NOT_INSTRUMENTED:'cold', UNKNOWN:'cold', INACTIVE:'cold', VOIDED:'cold',
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
const tone = s => {
  const k = String(s ?? '').toUpperCase().replace(/[\s-]+/g, '_');
  return TONE[k] || (k ? 'unknown' : '');
};
const UNKNOWN_WHY = 'This dashboard has no wording for that status. It is shown exactly as the database holds it rather than folded into a state it might mean.';
const pill = (label, t) => {
  const k = t || tone(label);
  /* The hover text is the only place an unrecognised status can explain itself,
     and without it 'unknown' is just another grey pill. */
  return `<span class="pill ${k}"${k === 'unknown' ? ` title="${esc(UNKNOWN_WHY)}"` : ''}><span class="dot"></span>${esc(label)}</span>`;
};

/* ── States. Every panel has all four; a panel without them is not done. ─── */

export { esc, nf, n0, num, aed, aedSigned, pct, mins, ago, clock, initials, TONE, tone, pill, TZ, TZ_LABEL, dubaiDate, dubaiTime, dubaiStamp, UNKNOWN_WHY };
