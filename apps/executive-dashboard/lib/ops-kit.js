/* NEXUS OS — lib/ops-kit.js

   Stitch-styled drop-ins for the legacy renderers, written for the Wave 1
   migration of the "operations" screens (Lead Sources, Channels, Integrations,
   Compliance, Ask AI, Automation) on 7 Oct 2026.

   WHY THIS FILE EXISTS. Those six screens hold close to ten thousand lines of
   reasoning about what a figure may claim — every read, refusal, privacy call
   and dated comment in them still binds. Rewriting their logic to restyle them
   would be the riskiest way to change how they look. So they keep calling the
   renderers they always called — kpi, table, panel, pill, the three state
   panels, openModal, openDrawer — with the same signatures and the same rules
   about unknowns, and this module answers in the Stitch component anatomy
   (design/stitch/states-components-design-system-specification--1efa65.html
   and the route exports named in design/stitch/MAP.md). lib/stitch-ui.js is
   used underneath wherever its contract fits.

   Class strings are literal and complete — scripts/stitch-classes.mjs fails
   the build otherwise. Every variant is picked from a map.

   What this module does NOT change:
     · pill() keeps lib/format.js's provenance rule: the "no wording for that
       status" note is attached only to a verbatim database value.
     · stateError() never prints the backend's words; the heading keeps
       "Couldn't load", which QUALITY_GATE.mjs detects.
     · table() still renders `tbody tr.clickable[data-i]`, which lib/ui.js
       wireRows() binds to.
     · panel() keeps lib/ui.js's thenable contract — the card element is stable
       across retries and every `.then(card => …)` wiring is replayed after one. */
import { el } from './dom.js';
import { ME, SESSION } from './data.js';
import { esc, tone as toneOf, TONE, UNKNOWN_WHY } from './format.js';
import { describe, classify, logError } from './errors.js';
import { BTN, emptyState, skeleton, openStitchModal } from './stitch-ui.js';
import { openDrawer as uiOpenDrawer } from './ui.js';

const isBlank = v => v == null || (typeof v === 'string' && v.trim() === '');

/* ── Class vocabulary ─────────────────────────────────────────────────────
   The legacy screens name a handful of roles by class (card-head, card-title,
   ds-cell-sub, t-hot …). C holds the Stitch class string for each role, so a
   screen writes `class="${C.sub}"` where it used to write `class="ds-cell-sub"`. */
const C = {
  card:   'rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm',
  head:   'px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center justify-between gap-space-sm',
  title:  'font-headline-md text-headline-md text-on-surface',
  sub:    'font-body-sm text-body-sm text-on-surface-variant mt-0.5',
  body:   'p-space-md',
  muted:  'text-on-surface-variant',
  faint:  'text-outline',
  hot:    'text-red-700',
  warm:   'text-amber-700',
  ok:     'text-emerald-700',
  unknown:'text-zinc-600',
  mono:   'font-label-numeric-sm',
  caps:   'font-table-header text-table-header uppercase tracking-wider text-outline font-semibold',
  section:'mt-space-md',
  chip:   'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap',
  kv:     'grid grid-cols-[140px_1fr] gap-x-3 gap-y-2 font-body-sm text-body-sm',
  quote:  'p-3 rounded-lg bg-surface-container-low border-l-4 border-outline-variant font-body-sm text-body-sm text-on-surface whitespace-pre-wrap break-words',
  grid2:  'grid grid-cols-1 md:grid-cols-2 gap-space-md',
  grid3:  'grid grid-cols-1 md:grid-cols-3 gap-space-md',
  grid4:  'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md',
  grid5:  'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-space-md',
  toolbar:'px-space-md py-3 flex flex-wrap items-center gap-space-sm border-b border-outline-variant/40',
  label:  'block font-table-header text-table-header uppercase tracking-wider text-outline font-semibold mb-1',
  input:  'w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest font-body-md text-body-md text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary',
  field:  'flex flex-col gap-1 mb-space-sm',
  hint:   'font-body-sm text-body-sm text-on-surface-variant',
  code:   'block p-3 rounded-lg bg-surface-container-low border border-outline-variant/40 font-label-numeric-sm text-[12px] text-on-surface whitespace-pre-wrap break-all overflow-x-auto max-w-full',
  tl:     'flex flex-col gap-space-sm',
  tlItem: 'flex gap-3',
  tlDot:  'w-2 h-2 rounded-full bg-outline mt-1.5 shrink-0',
  tlBody: 'flex-1 min-w-0',
  tlMeta: 'font-label-numeric-sm text-[11px] text-outline',
  listItem: 'block w-full text-left px-space-md py-3 border-b border-outline-variant/30 hover:bg-surface-container-low transition-colors',
  bar:    'h-1 rounded bg-surface-container overflow-hidden',
  stackbar: 'flex h-2.5 rounded-full overflow-hidden bg-surface-container',
  bubble: 'max-w-[78%] self-end px-3.5 py-2.5 rounded-xl bg-primary-container/10 border border-outline-variant/40 font-body-sm text-body-sm whitespace-pre-wrap break-words',
  bubbleMeta: 'font-label-numeric-sm text-[11px] text-outline mt-1.5 flex gap-2',
};

/* Buttons — the four legacy shapes onto lib/stitch-ui.js BTN. */
const B = {
  primary: `${BTN.primary} whitespace-nowrap`,
  secondary: `${BTN.secondary} whitespace-nowrap`,
  ghost: `${BTN.tertiary} whitespace-nowrap`,
  danger: `${BTN.destructive} whitespace-nowrap`,
  icon: BTN.icon,
};

/* ── Text in a cell ────────────────────────────────────────────────────── */
const muted = h => `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${h}</div>`;
const hot   = h => `<div class="font-body-sm text-body-sm text-red-700 mt-0.5">${h}</div>`;
const warm  = h => `<div class="font-body-sm text-body-sm text-amber-700 mt-0.5">${h}</div>`;
const bold  = h => `<div class="font-semibold text-on-surface">${h}</div>`;
const wrap  = h => `<div class="whitespace-normal">${h}</div>`;
const chip  = (t, title) => `<span class="${C.chip}"${title ? ` title="${esc(title)}"` : ''}>${esc(t)}</span>`;

/* tone word → text colour, for the places a legacy `t-${tone}` was chosen at runtime. */
const TONE_TEXT = {
  hot: 'text-red-700', warm: 'text-amber-700', cold: 'text-sky-700', ok: 'text-emerald-700',
  won: 'text-emerald-700', dead: 'text-outline', open: 'text-violet-700', unknown: 'text-on-surface-variant', '': 'text-on-surface',
};
const toneText = t => TONE_TEXT[t] || TONE_TEXT.unknown;
/* legacy `t-hot` / `t-warm` … class strings (as passed to kpi()) → Stitch. */
const LEGACY_TEXT = { 't-hot': 'text-red-700', 't-warm': 'text-amber-700', 't-ok': 'text-emerald-700', 't-cold': 'text-sky-700', 't-muted': 'text-outline', 't-unknown': 'text-zinc-600' };
const legacyText = cls => String(cls || '').split(/\s+/).map(c => LEGACY_TEXT[c] || '').filter(Boolean).join(' ');

/* ── Pill → status chip ───────────────────────────────────────────────────
   Same signature and provenance rule as lib/format.js pill(). The colour comes
   from the tone word; the label is always printed, so no state is colour only. */
const CHIP_BASE = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-label-numeric-sm text-[11px] font-semibold uppercase tracking-wider w-fit border whitespace-nowrap';
const CHIP_TONE = {
  ok:      'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  hot:     'bg-rose-50 text-rose-700 border-rose-200/60',
  warm:    'bg-amber-50 text-amber-700 border-amber-200/60',
  cold:    'bg-sky-50 text-sky-700 border-sky-200/60',
  open:    'bg-violet-50 text-violet-700 border-violet-200/60',
  won:     'bg-emerald-50 text-emerald-800 border-emerald-300',
  dead:    'bg-slate-100 text-slate-600 border-slate-300',
  unknown: 'bg-zinc-100 text-zinc-700 border-zinc-300',
};
const DOT_TONE = {
  ok: 'bg-emerald-600', hot: 'bg-rose-600', warm: 'bg-amber-500', cold: 'bg-sky-600',
  open: 'bg-violet-600', won: 'bg-emerald-700', dead: 'bg-slate-500', unknown: 'bg-zinc-400',
};
const toneKey = s => String(s ?? '').toUpperCase().replace(/[\s-]+/g, '_');
const pill = (label, t, opts) => {
  const k = t || toneOf(label) || 'unknown';
  const named = TONE[toneKey(label)] != null;
  const stated = opts && typeof opts === 'object' && 'verbatim' in opts;
  const verbatim = stated ? !!opts.verbatim : !t;
  const why = k === 'unknown' && !named && verbatim;
  return `<span class="${CHIP_BASE} ${CHIP_TONE[k] || CHIP_TONE.unknown}"${why ? ` title="${esc(UNKNOWN_WHY)}"` : ''}>`
    + `<span class="w-1.5 h-1.5 rounded-full ${DOT_TONE[k] || DOT_TONE.unknown}"></span>${esc(label)}</span>`;
};

/* ── KPI tile ─────────────────────────────────────────────────────────────
   Same signature as lib/ui.js kpi(): `value` and `sub` are TRUSTED markup the
   caller escaped. states-components §3 anatomy. */
function kpi(label, value, sub, cls = '') {
  const long = String(value).replace(/<[^>]*>/g, '').length > 12;
  const size = long ? 'text-[1.35rem] leading-tight' : 'text-[2rem] leading-none';
  return `<div class="bg-surface-container-lowest p-space-md rounded-xl border border-outline-variant/40 shadow-sm flex flex-col gap-space-sm min-w-0">
    <div class="font-table-header text-table-header uppercase text-outline tracking-wider font-semibold">${esc(label)}</div>
    <div class="font-label-numeric-lg ${size} font-bold tracking-tight ${legacyText(cls) || 'text-on-surface'} break-words">${value}</div>
    ${sub ? `<div class="font-body-sm text-body-sm text-on-surface-variant">${sub}</div>` : ''}
  </div>`;
}

/* ── Table ─────────────────────────────────────────────────────────────────
   Same column API as lib/ui.js table(): { label, align: 'r', strong, render }.
   Keeps `tr.clickable[data-i]` for wireRows(). */
const TH = { l: 'py-2.5 px-4 text-left align-bottom', r: 'py-2.5 px-4 text-right align-bottom' };
const TD = {
  l: 'py-2.5 px-4 text-left align-top',
  r: 'py-2.5 px-4 text-right align-top font-label-numeric-sm text-label-numeric-sm',
  ls: 'py-2.5 px-4 text-left align-top font-semibold',
  rs: 'py-2.5 px-4 text-right align-top font-label-numeric-sm text-label-numeric-sm font-semibold',
};
const ROW = {
  plain: 'hover:bg-surface-container-low transition-colors',
  click: 'clickable hover:bg-surface-container-low transition-colors cursor-pointer',
};
function table(cols, rows, opts = {}) {
  if (!rows.length) return opts.empty || stateEmpty('Nothing here yet', 'No rows matched.');
  const head = cols.map(c => `<th class="${c.align === 'r' ? TH.r : TH.l}">${esc(c.label)}</th>`).join('');
  const body = rows.map((r, i) => `<tr class="${opts.onRow ? ROW.click : ROW.plain}" data-i="${i}">${cols.map(c => {
    const k = (c.align === 'r' ? 'r' : 'l') + (c.strong ? 's' : '');
    return `<td class="${TD[k]}">${c.render(r)}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="overflow-x-auto"><table class="w-full text-left border-collapse">
    <thead><tr class="bg-surface-container-low border-b border-outline-variant/30 text-outline font-table-header text-table-header uppercase">${head}</tr></thead>
    <tbody class="divide-y divide-outline-variant/20 font-body-sm text-body-sm text-on-surface">${body}</tbody></table></div>`;
}

/* ── State panels ──────────────────────────────────────────────────────── */
const stateEmpty = (title, body, icon = 'inbox') => emptyState({ icon, title, body });
const stateLoading = (rows = 5) => skeleton({ rows });
/* The contract of lib/states.js stateError(): `err` goes to the console only;
   `note` is the screen's own reviewed sentence and is shown; no retry on a dead
   session. The heading keeps "Couldn't load". */
function stateError(what, err, retry, note) {
  const noteOnly = err == null && note;
  if (!noteOnly) logError(`could not load ${what}`, err);
  const c = describe(err);
  const said = noteOnly ? esc(note) : `${esc(c.line)} ${esc(c.next)}${note ? `</p><p class="font-body-sm text-body-sm text-red-900 mt-1">${esc(note)}` : ''}`;
  const canRetry = retry && (noteOnly || classify(err) !== 'session');
  return `<div class="bg-surface-container-lowest p-space-lg rounded-lg border border-red-200 bg-red-50/20 flex flex-col gap-3">
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 rounded bg-red-100 text-red-700 flex items-center justify-center shrink-0">
        <span class="material-symbols-outlined text-[20px]">sync_problem</span></div>
      <div><h3 class="font-headline-md text-body-lg font-semibold text-red-950">Couldn't load ${esc(what)}</h3>
        <p class="font-body-sm text-body-sm text-red-900 mt-1">${said}</p></div>
    </div>
    ${canRetry ? `<div><button type="button" class="${BTN.destructive}" data-retry="${esc(retry)}">Retry</button></div>` : ''}
  </div>`;
}
/* A screen's own "unread, not empty" panel — the legacy `state err` block with
   a heading and paragraphs the screen wrote itself (no backend words). */
const unreadPanel = (title, parasHtml) => `<div class="bg-surface-container-lowest p-space-lg rounded-lg border border-red-200 bg-red-50/20 flex items-start gap-3">
    <div class="w-10 h-10 rounded bg-red-100 text-red-700 flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[20px]">error</span></div>
    <div class="space-y-1"><h3 class="font-headline-md text-body-lg font-semibold text-red-950">${title}</h3>
      ${parasHtml.map(p => `<p class="font-body-sm text-body-sm text-red-900">${p}</p>`).join('')}</div></div>`;

/* ── Banner ────────────────────────────────────────────────────────────────
   The Stitch callout (lead-sources--c3ca1e verdict box, channels--dec649 24-hour
   window note): icon, a bold first line, the rest underneath. */
const BANNER = {
  hot:  { box: 'flex items-start gap-3 p-space-md rounded-lg border border-red-200 bg-red-50/40 text-red-950', icon: 'text-red-700' },
  warm: { box: 'flex items-start gap-3 p-space-md rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950', icon: 'text-amber-700' },
  info: { box: 'flex items-start gap-3 p-space-md rounded-lg border border-sky-200 bg-sky-50/50 text-sky-950', icon: 'text-sky-700' },
  ok:   { box: 'flex items-start gap-3 p-space-md rounded-lg border border-emerald-200 bg-emerald-50/50 text-emerald-950', icon: 'text-emerald-700' },
};
const banner = (kind, icon, innerHtml) => {
  const b = BANNER[kind] || BANNER.info;
  return `<div class="${b.box}"><span class="material-symbols-outlined text-[20px] ${b.icon} shrink-0">${esc(icon)}</span><div class="min-w-0 font-body-sm text-body-sm">${innerHtml}</div></div>`;
};
/* For the screens that build a banner with el(): the element's class string. */
const bannerClass = kind => (BANNER[kind] || BANNER.info).box;

/* ── Panel ─────────────────────────────────────────────────────────────────
   lib/ui.js panel(), in the Stitch card anatomy (overview--af6246 "Priority
   actions"). Same thenable contract; see lib/ui.js for why it is a thenable. */
function panel(host, { title, sub, actions, load, render, cols = '', icon = '' }) {
  const card = el('section', C.card);
  if (cols) card.style.gridColumn = cols;
  host.appendChild(card);
  const wirings = [];
  const rewire = () => {
    for (const fn of wirings) {
      try { fn(card); } catch (e) { console.error('panel: re-wiring failed after retry', e); }
    }
  };
  const headHtml = title ? `<div class="${C.head}">
      <div class="flex items-start gap-2.5 min-w-0 flex-1">
        ${icon ? `<span class="material-symbols-outlined text-primary text-xl mt-0.5">${esc(icon)}</span>` : ''}
        <div class="min-w-0"><h2 class="${C.title}">${esc(title)}</h2>${sub ? `<p class="${C.sub}">${sub}</p>` : ''}</div>
      </div>${actions ? `<div class="flex flex-wrap items-center gap-space-sm shrink-0">${actions}</div>` : ''}</div>` : '';
  const attempt = async () => {
    card.innerHTML = `${headHtml}<div class="${C.body}" data-pbody>${stateLoading(4)}</div>`;
    const body = card.querySelector('[data-pbody]');
    try {
      const data = await load();
      body.innerHTML = render(data, card);
    } catch (e) {
      body.innerHTML = stateError(title || 'data', e, 'x');
      body.querySelector('[data-retry]')?.addEventListener('click', () => { attempt().then(rewire); });
    }
  };
  const first = attempt().then(() => card);
  return {
    then(onOk, onErr) {
      if (typeof onOk === 'function') wirings.push(onOk);
      return first.then(onOk, onErr);
    },
    catch(onErr) { return first.catch(onErr); },
    finally(onDone) { return first.finally(onDone); },
  };
}

/* A card shell for screens that paint their own card bodies (el + innerHTML). */
const cardHead = (title, subHtml = '', actionsHtml = '', icon = '') => `<div class="${C.head}">
    <div class="flex items-start gap-2.5 min-w-0 flex-1">
      ${icon ? `<span class="material-symbols-outlined text-primary text-xl mt-0.5">${esc(icon)}</span>` : ''}
      <div class="min-w-0"><h2 class="${C.title}">${esc(title)}</h2>${subHtml ? `<div class="${C.sub}">${subHtml}</div>` : ''}</div>
    </div>${actionsHtml ? `<div class="flex flex-wrap items-center gap-space-sm shrink-0">${actionsHtml}</div>` : ''}</div>`;

/* ── Segmented control ─────────────────────────────────────────────────── */
const SEG = {
  box: 'inline-flex flex-wrap gap-0.5 p-0.5 rounded-lg bg-surface-container',
  off: 'px-3 py-1 rounded-md font-body-sm text-body-sm font-semibold text-on-surface-variant hover:text-on-surface transition-colors',
  on:  'px-3 py-1 rounded-md font-body-sm text-body-sm font-semibold bg-surface-container-lowest text-on-surface shadow-sm',
};

/* ── Modal ─────────────────────────────────────────────────────────────────
   lib/modal.js openModal(title, bodyHtml, footHtml) on openStitchModal. Two
   legacy hooks callers reach for are kept: the body carries id="modalBody" and
   the close button id="mClose". */
function openModal(title, bodyHtml, footHtml) {
  const m = openStitchModal({ title, bodyHtml, footHtml });
  const body = m.wrap.querySelector('[data-modal-body]');
  if (body) body.id = 'modalBody';
  const x = m.wrap.querySelector('[data-modal-close]');
  if (x) x.id = 'mClose';
  return m;
}
function modalError(m, e) { m.msg(`<span class="text-red-700">${esc((e && e.message) || String(e))}</span>`); }

/* ── Drawer ────────────────────────────────────────────────────────────────
   A legacy drawer body painted inside the Stitch scope. The #drawer element,
   scrim, Escape handling and identity wiping are lib/ui.js's, unchanged. */
const DRAWER = {
  head: 'px-space-lg py-space-md flex items-start justify-between gap-space-sm bg-surface-container-lowest shadow-sm shrink-0',
  body: 'flex-1 overflow-y-auto p-space-md space-y-space-md bg-surface-container-low/40',
  foot: 'p-space-md bg-surface-container-lowest flex flex-wrap items-center gap-space-sm shrink-0 border-t border-outline-variant/40',
};
function openDrawer(html) {
  uiOpenDrawer(`<div class="nx-stitch flex flex-col h-full bg-surface-container-lowest text-on-surface font-body-md text-body-md">${html}</div>`);
}

/* ── Readiness checklist ──────────────────────────────────────────────────
   channels-readiness-status-engine--54b35c / lead-sources--c3ca1e drawer: five
   gates, each PASSED / FAILED / NOT TESTED (or NOT APPLICABLE), and a verdict.
   The rule the export prints is the rule here: one NOT TESTED makes the verdict
   PARTIAL, never green; one FAILED makes it FAILED. `gates` is
   [{ gate, state: 'passed'|'failed'|'not-tested'|'n/a', detail }]; every detail
   is a sentence the caller derived from a real fact, already escaped. */
const GATE = {
  'passed':     { box: 'bg-emerald-50/40 border-emerald-200', icon: 'bg-emerald-100 text-emerald-700', mark: 'check', word: 'Passed', wordCls: 'text-emerald-700' },
  'failed':     { box: 'bg-red-50/40 border-red-200', icon: 'bg-red-100 text-red-700', mark: 'close', word: 'Failed', wordCls: 'text-red-700' },
  'not-tested': { box: 'bg-surface-container-lowest border-outline-variant/60', icon: 'bg-zinc-100 text-zinc-600', mark: 'remove', word: 'Not tested', wordCls: 'text-zinc-600' },
  'n/a':        { box: 'bg-surface-container-lowest border-outline-variant/40', icon: 'bg-surface-container text-outline', mark: 'block', word: 'Not applicable', wordCls: 'text-outline' },
};
const VERDICT = {
  passed:  { box: 'p-space-md rounded-lg border border-emerald-300 bg-emerald-50/60', head: 'text-emerald-900', icon: 'verified', word: 'VERDICT: PASSED' },
  partial: { box: 'p-space-md rounded-lg border border-amber-300 bg-amber-50/60', head: 'text-amber-900', icon: 'report_problem', word: 'VERDICT: PARTIAL' },
  failed:  { box: 'p-space-md rounded-lg border border-red-300 bg-red-50/60', head: 'text-red-900', icon: 'error', word: 'VERDICT: FAILED' },
};
function readinessVerdict(gates) {
  const applicable = gates.filter(g => g.state !== 'n/a');
  const passed = applicable.filter(g => g.state === 'passed').length;
  const failed = applicable.filter(g => g.state === 'failed').length;
  const untested = applicable.filter(g => g.state === 'not-tested').length;
  const key = failed ? 'failed' : (untested || !applicable.length) ? 'partial' : 'passed';
  return { key, passed, failed, untested, applicable: applicable.length };
}
function readinessChecklist(gates) {
  const v = readinessVerdict(gates);
  const V = VERDICT[v.key];
  const line = v.key === 'failed'
    ? `${v.failed} of ${v.applicable} gates failed. Readiness is FAILED until each one is fixed and re-checked.`
    : v.key === 'partial'
      ? `${v.untested} of ${v.applicable} gates ${v.untested === 1 ? 'is' : 'are'} NOT TESTED, so readiness stays PARTIAL. It is never shown green until every gate has passed on a real fact.`
      : `All ${v.applicable} applicable gates passed on recorded facts.`;
  return `<div class="${V.box}">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 ${V.head}"><span class="material-symbols-outlined text-[20px]">${V.icon}</span>
          <span class="font-label-numeric-sm text-label-numeric-sm font-bold">${V.word}</span></div>
        <span class="font-label-numeric-sm text-label-numeric-sm font-bold ${V.head}">${v.passed} OF ${v.applicable} PASSED</span>
      </div>
      <p class="font-body-sm text-body-sm mt-1 ${V.head}">${esc(line)}</p>
      <p class="font-body-sm text-body-sm mt-2 p-2 rounded bg-white/70 text-on-surface-variant">Rule: one gate NOT TESTED keeps readiness at PARTIAL. A gate passes only on a fact this dealership's records hold — never on configuration alone.</p>
    </div>
    <div class="flex items-center justify-between mt-space-md mb-2">
      <span class="${C.caps}">Gate checklist</span></div>
    <div class="flex flex-col gap-2">${gates.map((g, i) => {
      const G = GATE[g.state] || GATE['not-tested'];
      return `<div class="flex items-start gap-3 p-3 rounded-lg border ${G.box}">
        <span class="w-6 h-6 rounded-full ${G.icon} flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[16px]">${G.mark}</span></span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2"><span class="font-body-sm text-body-sm font-semibold text-on-surface">${i + 1}. ${esc(g.gate)}</span>
            <span class="font-label-numeric-sm text-[11px] font-bold uppercase ${G.wordCls}">${G.word}</span></div>
          <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${g.detail}</div>
        </div></div>`;
    }).join('')}</div>`;
}

/* The signed-in person, for the trust footer's Actor. A staff record, never a customer. */
const actor = () => (ME && (ME.name || ME.email)) || (SESSION && SESSION.user && SESSION.user.email) || null;

export {
  actor, C, B, BTN, isBlank, muted, hot, warm, bold, wrap, chip, toneText, legacyText,
  pill, kpi, table, stateEmpty, stateError, stateLoading, unreadPanel,
  banner, bannerClass, panel, cardHead, SEG, openModal, modalError,
  DRAWER, openDrawer, readinessChecklist, readinessVerdict,
};
