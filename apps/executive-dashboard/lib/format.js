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
const clock = ts => ts ? new Date(ts).toLocaleTimeString('en-GB', { hour12:false }) : '--:--:--';
const initials = name => (name || '?').split(/\s+/).filter(Boolean).slice(0,2).map(w => w[0]).join('').toUpperCase();

/* Every severity vocabulary in the system maps through this one table.
   WARNING was missing until 24 Aug 2026, and its absence was silent in the
   worst possible way: tone('WARNING') returned '', pill() then emitted
   `class="pill "`, and a warning rendered identically to a neutral note — a
   thing that needs a human looked like a thing that does not. Five separate
   screens had independently grown a private severity map to work around it.

   Three vocabularies land here and they must all be covered:
     v_needs_attention.severity   HOT | WARM | COLD
     inventory.aging_alert        CRITICAL | WARNING | OK
     audit_log.status             SUCCESS | FAILED | REJECTED | ESCALATED
   plus v_workflow_health.health, which is the one with a genuine fourth state:
   NOT_INSTRUMENTED is not health, it is the absence of evidence, so it maps to
   'cold' and never to 'ok'. Colouring an unmeasured workflow green is how a
   dashboard lies without anyone writing a false sentence. */
const TONE = {
  HOT:'hot', WARM:'warm', COLD:'cold',
  GOOD:'ok', OK:'ok', SUCCESS:'ok', APPROVED:'ok', HEALTHY:'ok', ACTIVE:'ok', SENT:'ok',
  FAILED:'hot', REJECTED:'hot', CRITICAL:'hot', ERROR:'hot', BREACHED:'hot',
  ESCALATED:'warm', PENDING:'warm', WARNING:'warm', DEGRADED:'warm', PENDING_INVITE:'warm',
  NEVER_RAN:'cold', NOT_INSTRUMENTED:'cold', UNKNOWN:'cold', INACTIVE:'cold', VOIDED:'cold',
  /* The screens' own derived alerts speak a second vocabulary. It lives here
     rather than in five private maps so that one severity can never be two
     colours on two screens. */
  HIGH:'hot', MEDIUM:'warm', LOW:'cold', INFO:'cold',
};
/* An unrecognised value is not neutral — it is a value nobody taught this table
   about, and rendering it as a plain pill hides that. 'cold' at least makes it
   visibly not-a-pass. Callers that must distinguish can read TONE directly. */
const tone = s => {
  const k = String(s ?? '').toUpperCase().replace(/[\s-]+/g, '_');
  return TONE[k] || (k ? 'cold' : '');
};
const pill = (label, t) => `<span class="pill ${t || tone(label)}"><span class="dot"></span>${esc(label)}</span>`;

/* ── States. Every panel has all four; a panel without them is not done. ─── */

export { esc, nf, n0, num, aed, aedSigned, pct, mins, ago, clock, initials, TONE, tone, pill };
