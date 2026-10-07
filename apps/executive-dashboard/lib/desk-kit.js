/* NEXUS OS — lib/desk-kit.js

   Stitch-styled drop-ins for the legacy renderers, written for the Wave 1
   migration of the "desk" screens (Inventory, Vehicle 360, Competitors, Deals,
   Finance, Campaigns) on 7 Oct 2026.

   WHY THIS FILE EXISTS. Those six screens hold roughly ten thousand lines of
   reasoning about what a figure may claim — every read, refusal, privacy call
   and dated comment in them still binds. Rewriting their logic to restyle them
   would be the riskiest way to change how they look. So the logic keeps calling
   the same five renderers it always has (kpi, table, pill and the three state
   panels), with the same signatures and the same rules about unknowns, and this
   module answers them in the Stitch component anatomy instead of the legacy
   one. lib/stitch-ui.js is used underneath wherever its contract fits.

   Class strings are literal and complete (the build fails otherwise — see
   scripts/stitch-classes.mjs). Every variant is picked from a map.

   What this module does NOT change: `pill()` keeps lib/format.js's provenance
   rule (the "no wording for that status" note is attached only to a verbatim
   database value), `stateError()` still never prints the backend's words, and
   `table()` still renders `tbody tr.clickable[data-i]`, which is what
   lib/ui.js wireRows() binds to. */
import { esc, tone as toneOf, TONE, UNKNOWN_WHY } from './format.js';
import { emptyState, errorState, skeleton } from './stitch-ui.js';
import { el } from './dom.js';
import { openDrawer } from './ui.js';

const isBlank = v => v == null || (typeof v === 'string' && v.trim() === '');

/* ── Text tones ───────────────────────────────────────────────────────────
   The legacy screens colour a figure with one of a handful of classes. Each is
   mapped to its Stitch equivalent; anything else passes through untouched. */
const TEXT = {
  'ds-t-warning': 'text-amber-700',
  'ds-t-danger': 'text-red-700',
  'ds-t-tertiary': 'text-outline',
  't-hot': 'text-red-700',
  't-warm': 'text-amber-700',
  't-ok': 'text-emerald-700',
  't-muted': 'text-outline',
  't-cold': 'text-sky-700',
};
const textTone = cls => String(cls || '').split(/\s+/).filter(Boolean).map(c => TEXT[c] || '').filter(Boolean).join(' ');

/* tone word ('hot' | 'warm' | 'cold' | 'ok' | 'won' | 'dead' | 'open' | 'unknown')
   → a text colour, for the handful of places a legacy `t-${tone}` class was
   assembled at runtime. */
const TONE_TEXT = {
  hot: 'text-red-700', warm: 'text-amber-700', cold: 'text-sky-700', ok: 'text-emerald-700',
  won: 'text-emerald-700', dead: 'text-outline', open: 'text-violet-700', unknown: 'text-on-surface-variant', '': 'text-on-surface-variant',
};
const toneText = t => TONE_TEXT[t] || TONE_TEXT.unknown;

/* ── KPI tile ─────────────────────────────────────────────────────────────
   Same signature as lib/ui.js kpi(): `value` and `sub` are TRUSTED markup the
   caller escaped (the legacy screens build them with aed()/num()/esc()). The
   anatomy is inventory-assets-profit-sentinel--a81092 "Executive Profit
   Sentinel KPI Strip" / states-components §3. */
const VALUE_TONE = {
  '': 'text-on-surface',
  'text-amber-700': 'text-amber-700',
  'text-red-700': 'text-red-700',
  'text-outline': 'text-outline',
  'text-emerald-700': 'text-emerald-700',
  'text-sky-700': 'text-sky-700',
};
function kpi(label, value, sub, cls = '') {
  const t = VALUE_TONE[textTone(cls).split(' ')[0] || ''] || VALUE_TONE[''];
  const long = String(value == null ? '' : value).replace(/<[^>]*>/g, '').length > 8;
  const size = long ? 'font-label-numeric-lg text-label-numeric-lg font-semibold tracking-tight' : 'font-label-numeric-lg text-headline-lg font-semibold tracking-tight';
  return `<div class="bg-surface-container-lowest p-space-md rounded-xl border border-outline-variant/40 shadow-sm flex flex-col gap-space-xs min-w-0">
    <span class="font-table-header text-table-header uppercase text-outline tracking-wider font-semibold">${esc(label)}</span>
    <div class="${size} ${t}">${isBlank(value) ? '—' : value}</div>
    ${isBlank(sub) ? '' : `<div class="font-body-sm text-[12px] leading-snug text-on-surface-variant">${sub}</div>`}
  </div>`;
}

/* ── Chips ────────────────────────────────────────────────────────────────
   lib/format.js pill(), same arguments and the same provenance rule, in the
   states-components §1 chip anatomy. Tone decides the colour; the word is
   always printed, so no state differs by colour alone. */
const CHIP_BASE = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-label-numeric-sm text-[11px] font-semibold uppercase tracking-wider w-fit max-w-full border';
const CHIP_TONE = {
  hot: 'bg-rose-50 text-rose-700 border-rose-200/60',
  warm: 'bg-amber-50 text-amber-800 border-amber-200/60',
  cold: 'bg-sky-50 text-sky-700 border-sky-200/60',
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200/60',
  won: 'bg-[#E6F4EF] text-[#157A5B] border-emerald-200/60',
  dead: 'bg-[#E4E6EC] text-[#3F4757] border-slate-300',
  open: 'bg-[#F1EAFA] text-[#5B2E8C] border-violet-200',
  unknown: 'bg-zinc-100 text-zinc-700 border-zinc-300',
  '': 'bg-zinc-100 text-zinc-700 border-zinc-300',
};
const DOT_TONE = {
  hot: 'w-1.5 h-1.5 rounded-full bg-rose-600', warm: 'w-1.5 h-1.5 rounded-full bg-amber-500',
  cold: 'w-1.5 h-1.5 rounded-full bg-sky-600', ok: 'w-1.5 h-1.5 rounded-full bg-emerald-600',
  won: 'w-1.5 h-1.5 rounded-full bg-emerald-600', dead: 'w-1.5 h-1.5 rounded-full bg-slate-500',
  open: 'w-1.5 h-1.5 rounded-full bg-violet-600', unknown: 'w-1.5 h-1.5 rounded-full bg-zinc-400', '': 'w-1.5 h-1.5 rounded-full bg-zinc-400',
};
const toneKey = s => String(s ?? '').toUpperCase().replace(/[\s-]+/g, '_');
const pill = (label, t, opts) => {
  const k = t || toneOf(label);
  const named = TONE[toneKey(label)] != null;
  const stated = opts && typeof opts === 'object' && 'verbatim' in opts;
  const verbatim = stated ? !!opts.verbatim : !t;
  const why = k === 'unknown' && !named && verbatim;
  /* A verbatim engine state such as UNKNOWN_UNVERIFIED_COMPARABLE has no space
     to wrap at, so a zero-width space after each underscore lets it break there
     (and only there) inside a narrow cell. The visible text is unchanged. */
  const text = esc(label).replace(/_/g, '_\u200b');
  return `<span class="${CHIP_BASE} ${CHIP_TONE[k] || CHIP_TONE.unknown}"${why ? ` title="${esc(UNKNOWN_WHY)}"` : ''}><span class="${DOT_TONE[k] || DOT_TONE.unknown} shrink-0"></span><span>${text}</span></span>`;
};
/* A plain neutral tag (the legacy `.chip`). */
const CHIP = 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap';
const chip = text => `<span class="${CHIP}">${esc(text)}</span>`;

/* ── Data table ───────────────────────────────────────────────────────────
   lib/ui.js table(): same `cols` ({ label, align: 'r', strong, render }) and
   opts ({ onRow, empty }). Rows keep `clickable` + `data-i` for wireRows(). */
const TH = { l: 'py-2.5 px-4 text-left whitespace-nowrap', r: 'py-2.5 px-4 text-right whitespace-nowrap' };
const TD = {
  l: 'px-4 py-2 text-left align-top', r: 'px-4 py-2 text-right align-top font-label-numeric-sm text-label-numeric-sm',
  ls: 'px-4 py-2 text-left align-top font-semibold text-on-surface', rs: 'px-4 py-2 text-right align-top font-label-numeric-sm text-label-numeric-sm font-semibold',
};
const ROW = {
  plain: 'min-h-[44px] hover:bg-surface-container-low transition-colors',
  click: 'clickable min-h-[44px] hover:bg-surface-container-low transition-colors cursor-pointer',
};
function table(cols, rows, opts = {}) {
  if (!rows.length) return opts.empty || stateEmpty('Nothing here yet', 'No rows matched.');
  const head = cols.map(c => `<th class="${c.align === 'r' ? TH.r : TH.l}">${esc(c.label)}</th>`).join('');
  const body = rows.map((r, i) => {
    const tds = cols.map(c => `<td class="${TD[(c.align === 'r' ? 'r' : 'l') + (c.strong ? 's' : '')]}">${c.render(r)}</td>`).join('');
    return `<tr class="${opts.onRow ? ROW.click : ROW.plain}" data-i="${i}">${tds}</tr>`;
  }).join('');
  return `<div class="overflow-x-auto"><table class="w-full text-left border-collapse">
    <thead><tr class="bg-surface-container-low border-b border-outline-variant/30 text-outline font-table-header text-table-header uppercase">${head}</tr></thead>
    <tbody class="divide-y divide-outline-variant/20 font-body-sm text-body-sm text-on-surface">${body}</tbody></table></div>`;
}

/* ── State panels ─────────────────────────────────────────────────────────
   lib/states.js signatures. stateError keeps the "Couldn't load" heading the
   gate looks for, never prints the backend's words (stitch-ui errorState does
   that), and keeps the `note` argument: a sentence the screen knows first-hand. */
const stateEmpty = (title, body, icon = 'inbox') => emptyState({ icon, title, body });
function stateError(what, err, retry, note) {
  if (err == null && note) {
    return `<div class="bg-surface-container-lowest p-space-lg rounded border border-red-200 bg-red-50/20 flex flex-col gap-3">
      <div class="flex items-start gap-3"><div class="w-10 h-10 rounded bg-red-100 text-red-700 flex items-center justify-center shrink-0">
        <span class="material-symbols-outlined text-[20px]">sync_problem</span></div>
      <div><h3 class="font-headline-md text-body-lg font-semibold text-red-950">Couldn't load ${esc(what)}</h3>
        <p class="font-body-sm text-body-sm text-red-900 mt-1">${esc(note)}</p></div></div>
      ${retry ? `<div><button type="button" class="px-3 py-1.5 bg-red-700 text-white rounded font-body-sm text-body-sm font-semibold hover:bg-red-800 transition-colors" data-retry="${esc(retry)}">Retry</button></div>` : ''}</div>`;
  }
  const panel = errorState({ what, err, retry });
  return note ? panel.replace(/<\/div>\s*$/, `<p class="font-body-sm text-body-sm text-red-900">${esc(note)}</p></div>`) : panel;
}
const stateLoading = (rows = 5) => skeleton({ rows });
const noSource = msg => emptyState({ icon: 'link_off', title: 'No data source yet', body: msg });

/* ── Segmented control ────────────────────────────────────────────────────
   The filter pills of inventory-…--3fd9e5 "Filter Pills". The legacy screens
   toggled a bare `on` class; Tailwind cannot follow that, so the whole class
   string is swapped. */
const SEG = {
  on: 'px-space-sm py-1 rounded bg-primary text-on-primary font-body-sm text-body-sm font-semibold flex items-center gap-1 shadow-sm',
  off: 'px-space-sm py-1 rounded bg-surface-container-low hover:bg-surface-container-high text-on-surface font-body-sm text-body-sm flex items-center gap-1 transition-colors',
};
const segPaint = (btn, on) => { btn.className = on ? SEG.on : SEG.off; btn.setAttribute('aria-pressed', on ? 'true' : 'false'); };

/* Form controls. Inside `.nx-stitch` the scoped preflight strips an unclassed
   control of its border and background, so every one carries these. */
const FIELD = {
  input: 'w-full px-3 py-2 bg-surface-container-lowest border border-outline-variant rounded font-body-sm text-body-sm text-on-surface focus:ring-1 focus:ring-primary focus:border-primary outline-none shadow-sm disabled:bg-surface-container-low disabled:text-outline',
  select: 'w-full px-3 py-2 bg-surface-container-lowest border border-outline-variant rounded font-body-sm text-body-sm text-on-surface focus:ring-1 focus:ring-primary outline-none shadow-sm cursor-pointer disabled:bg-surface-container-low',
  inline: 'px-3 py-1.5 bg-surface-container-low border border-outline-variant/60 rounded font-body-sm text-body-sm text-on-surface focus:ring-1 focus:ring-primary outline-none',
  label: 'block font-table-header text-table-header uppercase text-on-surface-variant mb-1',
  hint: 'font-body-sm text-body-sm text-on-surface-variant mt-1',
  check: 'w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary',
};

/* Callouts — the legacy `.banner warm|hot|ok|info`, as complete strings. */
const BANNER = {
  warm: 'flex items-start gap-2.5 p-space-sm rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm',
  hot: 'flex items-start gap-2.5 p-space-sm rounded-lg border border-red-200 bg-red-50/60 text-red-950 font-body-sm text-body-sm',
  ok: 'flex items-start gap-2.5 p-space-sm rounded-lg border border-emerald-200 bg-emerald-50/60 text-emerald-950 font-body-sm text-body-sm',
  info: 'flex items-start gap-2.5 p-space-sm rounded-lg border border-sky-200 bg-sky-50/60 text-sky-950 font-body-sm text-body-sm',
  '': 'flex items-start gap-2.5 p-space-sm rounded-lg border border-outline-variant/60 bg-surface-container-low text-on-surface font-body-sm text-body-sm',
};

/* ── Async panel ──────────────────────────────────────────────────────────
   lib/ui.js panel(), unchanged in contract — the same stable card element,
   the same replay of `.then` wirings after a Retry, the same loading / error
   states — drawn as a Stitch card. The body carries `data-pbody`. */
const CARD = 'rounded-xl bg-surface-container-lowest border border-outline-variant/60 overflow-hidden shadow-sm';
function panel(host, { title, sub, actions, load, render, cols = '' }) {
  const card = el('div', CARD);
  if (cols) card.style.gridColumn = cols;
  host.appendChild(card);
  const wirings = [];
  const rewire = () => {
    for (const fn of wirings) {
      try { fn(card); } catch (e) { console.error('panel: re-wiring failed after retry', e); }
    }
  };
  const attempt = async () => {
    card.innerHTML = `${title ? `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant/60 flex flex-wrap items-center justify-between gap-space-sm">
        <div class="min-w-0"><div class="font-headline-md text-headline-md text-on-surface">${esc(title)}</div>${sub ? `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${sub}</div>` : ''}</div>
        ${actions ? `<div class="flex items-center gap-space-sm shrink-0">${actions}</div>` : ''}</div>` : ''}<div data-pbody>${stateLoading(4)}</div>`;
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

/* The legacy drawers hand `openDrawer()` a head / body / foot triple. This
   wraps it in the Stitch drawer surface so the scoped reset and tokens apply. */
function openDeskDrawer(html) {
  openDrawer(`<div class="nx-stitch flex flex-col h-full bg-surface-container-lowest text-on-surface font-body-md text-body-md">${html}</div>`);
}

export { BANNER, CARD, panel, TEXT, textTone, toneText, kpi, pill, chip, CHIP, table, stateEmpty, stateError, stateLoading, noSource, SEG, segPaint, FIELD, openDeskDrawer };
