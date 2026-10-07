/* NEXUS OS — lib/stitch-ui.js

   The shared component helpers for screens migrated to the Google Stitch
   designs. Every class string below is copied from a Stitch export in
   design/stitch/ — mostly `states-components-design-system-specification
   --1efa65.html`, the canonical component anatomy — and the export it came from
   is named beside it. Nothing here is a style of our own.

   THREE RULES, and design/stitch/COMPONENTS.md says each at more length:

   1. CLASS STRINGS ARE LITERAL. Tailwind only generates a class it can read in
      a source file. A variant is therefore picked from a map of COMPLETE class
      strings (CHIP, TEMP, MONEY, BTN below), never assembled from fragments.
      scripts/stitch-classes.mjs fails the build on `bg-${x}` or `'text-' + y`.

   2. EVERY VALUE IS ESCAPED. Parameters named `...Html` are trusted markup the
      caller built (and escaped) itself; every other string parameter is passed
      through esc() here. Customer names and phones must already have been
      through lib/privacy.js (displayName / maskPhone / maskEmail) — this module
      cannot tell a customer's name from a column header.

   3. UNKNOWN IS NOT ZERO. A value of null or undefined renders "—" and never a
      0; a money tile without an amount says so in words. That is the house rule
      in CLAUDE.md, and Stitch's mock numbers are placeholders, never data.

   The helpers return HTML strings, like the rest of this codebase (lib/ui.js,
   lib/states.js). The two that open something (openStitchModal,
   openStitchDrawer) return the same handles their legacy counterparts do. */
import { $, el } from './dom.js';
import { describe, classify, logError } from './errors.js';
import { esc, nf } from './format.js';
import { openDrawer, closeDrawer } from './ui.js';

const isBlank = v => v == null || (typeof v === 'string' && v.trim() === '');
const txt = v => (isBlank(v) ? '—' : esc(v));

/* ── Status chips ─────────────────────────────────────────────────────────
   states-components…--1efa65 §1 "Status Chips Matrix (Icon + Label)". Icon +
   word, never colour alone. `live` carries the ping dot the export draws. */
const CHIP_BASE = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-label-numeric-sm text-table-header uppercase tracking-wider w-fit border';
const CHIP = {
  'live':        { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200/60', label: 'Live',
                   icon: '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span><span class="-ml-1.5 w-1.5 h-1.5 rounded-full bg-emerald-600"></span>' },
  'connected':   { cls: 'bg-sky-50 text-sky-700 border-sky-200/60', label: 'Connected', icon: '<span class="material-symbols-outlined text-[14px]">link</span>' },
  'receiving':   { cls: 'bg-purple-50 text-purple-700 border-purple-200/60', label: 'Receiving', icon: '<span class="material-symbols-outlined text-[14px] animate-pulse">sensors</span>' },
  'partial':     { cls: 'bg-amber-50 text-amber-700 border-amber-200/60', label: 'Partial', icon: '<span class="material-symbols-outlined text-[14px]">contrast</span>' },
  'blocked':     { cls: 'bg-rose-50 text-rose-700 border-rose-200/60', label: 'Blocked', icon: '<span class="material-symbols-outlined text-[14px]">block</span>' },
  'failed':      { cls: 'bg-red-100/70 text-red-700 border-red-300', label: 'Failed', icon: '<span class="material-symbols-outlined text-[14px]">emergency</span>' },
  'pending':     { cls: 'bg-slate-100 text-slate-700 border-slate-300', label: 'Pending', icon: '<span class="material-symbols-outlined text-[14px]">schedule</span>' },
  'not-tested':  { cls: 'bg-zinc-100 text-zinc-700 border-zinc-300', label: 'Not tested', icon: '<span class="material-symbols-outlined text-[14px]">radio_button_unchecked</span>' },
  'degraded':    { cls: 'bg-orange-50 text-orange-700 border-orange-200', label: 'Degraded', icon: '<span class="material-symbols-outlined text-[14px]">warning</span>' },
  'restricted':  { cls: 'bg-violet-50 text-violet-700 border-violet-200', label: 'Restricted', icon: '<span class="material-symbols-outlined text-[14px]">lock</span>' },
  'coming-soon': { cls: 'bg-indigo-50 text-indigo-700 border-indigo-200', label: 'Coming soon', icon: '<span class="font-label-numeric-sm text-[12px] leading-none">○</span>' },
  'planned':     { cls: 'bg-cyan-50 text-cyan-700 border-cyan-200', label: 'Planned', icon: '<span class="font-label-numeric-sm text-[12px] leading-none">◇</span>' },
};
const CHIP_KINDS = Object.keys(CHIP);

/* An unknown kind renders as "not tested" with the caller's label: a state this
   module was not taught must never borrow a healthy colour. */
function statusChip(kind, label) {
  const c = CHIP[kind] || CHIP['not-tested'];
  return `<span class="${CHIP_BASE} ${c.cls}">${c.icon}<span>${esc(isBlank(label) ? c.label : label)}</span></span>`;
}

/* ── Lead temperature / deal outcome chips ────────────────────────────────
   The hex palette Stitch used for these across leads-*, deals-pipeline-* and
   overview-* (e.g. deals-pipeline-deal-360-desk--80d495: WON / OPEN / LOST). */
const TEMP_BASE = 'inline-flex items-center px-2 py-0.5 rounded-[4px] font-label-numeric-sm text-[11px] font-bold tracking-wider uppercase';
const TEMP = {
  HOT:  'bg-[#FDECEA] text-[#C8321F]',
  WARM: 'bg-[#FEF3E2] text-[#96570A]',
  COLD: 'bg-[#E8F1FB] text-[#2563A8]',
  WON:  'bg-[#E6F4EF] text-[#157A5B]',
  LOST: 'bg-[#E4E6EC] text-[#3F4757]',
  OPEN: 'bg-[#F1EAFA] text-[#5B2E8C]',
};
const TEMP_UNKNOWN = 'bg-surface-container text-on-surface-variant';
function tempChip(value) {
  const k = String(value == null ? '' : value).trim().toUpperCase();
  if (!k) return `<span class="${TEMP_BASE} ${TEMP_UNKNOWN}">Unknown</span>`;
  return `<span class="${TEMP_BASE} ${TEMP[k] || TEMP_UNKNOWN}">${esc(k)}</span>`;
}

/* ── Buttons ──────────────────────────────────────────────────────────────
   overview-revenue-command-center--af6246 (page actions) and the button matrix
   in states-components…--1efa65 §4. Use as `<button class="${BTN.primary}">`. */
const BTN = {
  primary:     'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary-container text-on-primary font-body-sm text-body-sm font-semibold transition-colors shadow-sm disabled:bg-outline-variant/40 disabled:text-outline disabled:cursor-not-allowed disabled:shadow-none',
  secondary:   'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors font-body-sm text-body-sm text-on-surface font-semibold disabled:text-outline disabled:cursor-not-allowed',
  tertiary:    'inline-flex items-center gap-1 font-body-sm text-body-sm font-semibold text-primary hover:text-primary-container transition-colors disabled:text-outline disabled:cursor-not-allowed',
  destructive: 'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-red-700 text-white font-body-sm text-body-sm font-semibold hover:bg-red-800 transition-colors disabled:bg-outline-variant/40 disabled:text-outline disabled:cursor-not-allowed',
  icon:        'w-8 h-8 rounded-lg hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors disabled:text-outline disabled:cursor-not-allowed',
};

/* ── KPI tile ─────────────────────────────────────────────────────────────
   states-components…--1efa65 §3 (label + info, mono value, honest telemetry
   line) with the footer link of overview-…--af6246 ("View breakdown →").
   `value` is shown as given (format it with lib/format.js first); null/'' is
   "—". `href` is a screen id: the link carries data-screen-link so the caller
   (or the shell) can route it with go(). */
function kpiTile({ label, value, sub, href, linkLabel = 'View', info } = {}) {
  return `<div class="bg-surface-container-lowest p-space-lg rounded-xl border border-outline-variant/40 shadow-sm flex flex-col gap-space-sm">
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="font-table-header text-table-header uppercase text-outline tracking-wider font-semibold truncate">${esc(label)}</span>
        ${info ? `<span class="material-symbols-outlined text-[16px] text-outline" title="${esc(info)}">info</span>` : ''}
      </div>
    </div>
    <div class="font-label-numeric-lg text-[2.25rem] leading-none font-bold text-on-surface tracking-tight">${txt(value)}</div>
    ${isBlank(sub) ? '' : `<div class="font-body-sm text-body-sm text-on-surface-variant">${esc(sub)}</div>`}
    ${href ? `<div class="pt-space-sm border-t border-outline-variant/20 flex justify-end">
      <a class="inline-flex items-center gap-1 font-body-sm text-body-sm font-semibold text-primary hover:text-primary-container transition-colors" href="#${esc(href)}" data-screen-link="${esc(href)}">
        <span>${esc(linkLabel)}</span><span class="material-symbols-outlined text-[16px]">arrow_forward</span></a></div>` : ''}
  </div>`;
}

/* ── Money tile ───────────────────────────────────────────────────────────
   states-components…--1efa65 §2 "Money Tiles Anatomy & Border Styles".
   Estimated is DASHED; attributed, confirmed and recovered are solid; the word
   is printed on the tile, so the four never differ by colour alone. `amount`
   is a number in AED or null — null renders "—" and the reason in `unknownWhy`
   (default: "Not known yet"). Do not pass an estimate as `confirmed`. */
const MONEY = {
  estimated:  { box: 'border-2 border-dashed border-amber-300 bg-amber-50/50', head: 'text-amber-900/80', tag: 'bg-amber-200/50 text-amber-900', cur: 'text-amber-800/70', val: 'text-amber-950', sub: 'text-amber-900', rule: 'border-amber-200/60 text-amber-800', word: 'Estimated' },
  attributed: { box: 'border border-solid border-blue-200 bg-blue-50/40', head: 'text-blue-900', tag: 'bg-blue-100 text-blue-900', cur: 'text-blue-800/70', val: 'text-blue-950', sub: 'text-blue-900', rule: 'border-blue-200 text-blue-800', word: 'Attributed' },
  confirmed:  { box: 'border border-solid border-emerald-300 bg-emerald-50/50', head: 'text-emerald-900', tag: 'bg-emerald-100 text-emerald-900', cur: 'text-emerald-800/70', val: 'text-emerald-950', sub: 'text-emerald-900', rule: 'border-emerald-200 text-emerald-800', word: 'Confirmed' },
  recovered:  { box: 'border-2 border-solid border-emerald-600 bg-emerald-100/60 shadow-sm', head: 'text-emerald-950', tag: 'bg-emerald-600 text-white', cur: 'text-emerald-900/80', val: 'text-emerald-950', sub: 'text-emerald-950', rule: 'border-emerald-300 text-emerald-900', word: 'Recovered' },
};
function moneyTile({ kind = 'estimated', label, amount, sub, unknownWhy = 'Not known yet', footLeft, footRight } = {}) {
  const m = MONEY[kind] || MONEY.estimated;
  const n = amount == null || amount === '' || Number.isNaN(Number(amount)) ? null : Number(amount);
  const value = n == null
    ? `<span class="font-label-numeric-lg text-headline-lg font-bold tracking-tight ${m.val}">—</span>`
    : `<span class="font-label-numeric-sm text-label-numeric-sm ${m.cur}">AED</span><span class="font-label-numeric-lg text-headline-lg font-bold tracking-tight ${m.val}">${esc(nf.format(Math.round(n)))}</span>`;
  const subLine = n == null ? unknownWhy : sub;
  return `<div class="${m.box} p-space-md rounded-lg flex flex-col justify-between min-h-[11rem] gap-2">
    <div class="flex items-center justify-between gap-2">
      <span class="font-table-header text-table-header uppercase tracking-wider font-bold ${m.head}">${esc(label)}</span>
      <span class="font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded font-semibold uppercase ${m.tag}">${m.word}</span>
    </div>
    <div class="my-auto space-y-1">
      <div class="flex items-baseline gap-1.5">${value}</div>
      ${isBlank(subLine) ? '' : `<p class="font-body-sm text-body-sm font-medium ${m.sub}">${esc(subLine)}</p>`}
    </div>
    ${isBlank(footLeft) && isBlank(footRight) ? '' : `<div class="pt-2 border-t flex items-center justify-between text-[11px] font-label-numeric-sm ${m.rule}">
      <span>${esc(footLeft || '')}</span><span>${esc(footRight || '')}</span></div>`}
  </div>`;
}

/* ── Card / panel ─────────────────────────────────────────────────────────
   overview-…--af6246 "Priority actions": rounded-xl surface, a header strip on
   surface-container-low with icon + title + right-hand meta/actions. `flush`
   drops the body padding (for a table or a divided list). */
function card({ icon, title, sub, actionsHtml = '', bodyHtml = '', flush = false, id } = {}) {
  return `<section class="rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm"${id ? ` id="${esc(id)}"` : ''}>
    ${isBlank(title) ? '' : `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex items-center justify-between gap-space-sm">
      <div class="flex items-center gap-2.5 min-w-0">
        ${icon ? `<span class="material-symbols-outlined text-primary text-xl">${esc(icon)}</span>` : ''}
        <div class="min-w-0"><div class="font-headline-md text-headline-md text-on-surface truncate">${esc(title)}</div>
        ${isBlank(sub) ? '' : `<div class="font-label-numeric-sm text-label-numeric-sm text-outline truncate">${esc(sub)}</div>`}</div>
      </div>
      ${actionsHtml ? `<div class="flex items-center gap-space-sm shrink-0">${actionsHtml}</div>` : ''}
    </div>`}
    <div class="${flush ? '' : 'p-space-md'}">${bodyHtml}</div>
  </section>`;
}

/* ── Section / page header ────────────────────────────────────────────────
   overview-…--af6246 "Top Command Context Bar": an uppercase eyebrow, a
   headline-lg title and right-aligned actions. */
function sectionHeader({ eyebrow, title, sub, actionsHtml = '' } = {}) {
  return `<div class="flex flex-col md:flex-row md:items-center justify-between gap-space-sm pb-space-md">
    <div class="min-w-0">
      ${isBlank(eyebrow) ? '' : `<div class="flex items-center gap-2"><span class="font-table-header text-table-header uppercase tracking-wider text-secondary">${esc(eyebrow)}</span></div>`}
      <h1 class="font-headline-lg text-headline-lg text-on-surface">${esc(title)}</h1>
      ${isBlank(sub) ? '' : `<p class="font-body-md text-body-md text-on-surface-variant mt-0.5">${esc(sub)}</p>`}
    </div>
    ${actionsHtml ? `<div class="flex items-center gap-space-sm self-start md:self-auto">${actionsHtml}</div>` : ''}
  </div>`;
}

/* ── Data table ───────────────────────────────────────────────────────────
   states-components…--1efa65 §4 (thead) and §6 ("Standard Lead Row — 44px
   Fixed Height", h-11). `columns` is [{ label, align: 'left'|'right' }];
   `rows` is an array of arrays of CELL HTML (escape inside the cell yourself);
   `rowAttrs(i)` may return extra attribute markup for row i (e.g. a data-id,
   already escaped). An empty `rows` renders `emptyHtml` (default: emptyState). */
const TH = { left: 'py-3 px-4 text-left', right: 'py-3 px-4 text-right' };
const TD = { left: 'px-4 text-left', right: 'px-4 text-right font-label-numeric-sm text-label-numeric-sm' };
function dataTable({ columns = [], rows = [], rowAttrs, emptyHtml, clickable = false } = {}) {
  if (!rows.length) return emptyHtml != null ? emptyHtml : emptyState({ title: 'Nothing to show', body: 'No rows were returned for this view.' });
  const rowCls = clickable
    ? 'h-11 hover:bg-surface-container-low transition-colors cursor-pointer'
    : 'h-11 hover:bg-surface-container-low transition-colors';
  return `<div class="overflow-x-auto"><table class="w-full text-left border-collapse">
    <thead><tr class="bg-surface-container-low border-b border-outline-variant/30 text-outline font-table-header text-table-header uppercase">
      ${columns.map(c => `<th class="${TH[c.align] || TH.left}">${esc(c.label)}</th>`).join('')}
    </tr></thead>
    <tbody class="divide-y divide-outline-variant/20 font-body-sm text-body-sm text-on-surface">
      ${rows.map((r, i) => `<tr class="${rowCls}"${rowAttrs ? ' ' + rowAttrs(i) : ''}>${r.map((cell, j) =>
        `<td class="${TD[(columns[j] || {}).align] || TD.left}">${cell == null || cell === '' ? '—' : cell}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>`;
}

/* ── Standard state panels ────────────────────────────────────────────────
   states-components…--1efa65 §5. */
function emptyState({ icon = 'inbox', title, body } = {}) {
  return `<div class="bg-surface-container-lowest p-space-lg rounded border border-outline-variant/30 flex flex-col items-center text-center justify-center min-h-[260px] space-y-3">
    <div class="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-outline">
      <span class="material-symbols-outlined text-[24px]">${esc(icon)}</span></div>
    <div class="space-y-1">
      <h3 class="font-headline-md text-body-lg font-semibold text-on-surface">${esc(title)}</h3>
      ${isBlank(body) ? '' : `<p class="font-body-sm text-body-sm text-on-surface-variant max-w-xs">${esc(body)}</p>`}
    </div></div>`;
}

/* The error panel never prints what the backend said: `err` goes to the
   console and the reader gets one of lib/errors.js's sentences, the contract
   lib/states.js stateError() already keeps. The heading keeps the words
   "Couldn't load" because QUALITY_GATE.mjs detects an errored screen by them.
   `retry` becomes data-retry on the button; the screen wires it. */
function errorState({ what = 'this panel', err, retry } = {}) {
  logError(`could not load ${what}`, err);
  const c = describe(err);
  const canRetry = retry && classify(err) !== 'session';
  return `<div class="bg-surface-container-lowest p-space-lg rounded border border-red-200 bg-red-50/20 flex flex-col justify-between min-h-[260px] space-y-3">
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 rounded bg-red-100 text-red-700 flex items-center justify-center shrink-0">
        <span class="material-symbols-outlined text-[20px]">sync_problem</span></div>
      <div><h3 class="font-headline-md text-body-lg font-semibold text-red-950">Couldn't load ${esc(what)}</h3>
        <p class="font-body-sm text-body-sm text-red-900 mt-1">${esc(c.line)} ${esc(c.next)}</p></div>
    </div>
    ${canRetry ? `<div class="flex items-center gap-2 pt-2">
      <button type="button" class="px-3 py-1.5 bg-red-700 text-white rounded font-body-sm text-body-sm font-semibold hover:bg-red-800 transition-colors" data-retry="${esc(retry)}">Retry</button></div>` : ''}
  </div>`;
}

/* data-skeleton is what QUALITY_GATE.mjs R2 looks for to call a screen stuck
   loading, alongside the legacy `.skeleton`. */
function skeleton({ rows = 3 } = {}) {
  const lines = ['w-full', 'w-5/6', 'w-4/6', 'w-3/6'];
  return `<div class="bg-surface-container-lowest p-space-lg rounded border border-outline-variant/30 flex flex-col justify-between min-h-[160px] space-y-4" data-skeleton aria-busy="true" aria-label="Loading">
    <div class="flex items-center justify-between">
      <div class="h-4 bg-surface-container-high rounded w-28 animate-pulse"></div>
      <div class="h-4 bg-surface-container-high rounded w-16 animate-pulse"></div></div>
    <div class="space-y-2.5">
      <div class="h-8 bg-surface-container-high rounded w-44 animate-pulse"></div>
      ${Array.from({ length: Math.max(1, Math.min(rows, lines.length)) }, (_, i) => `<div class="h-3 bg-surface-container rounded ${lines[i]} animate-pulse"></div>`).join('')}
    </div></div>`;
}

/* states-components…--1efa65 §5.6 "Coming-Soon Panel". `kind` is
   'coming-soon' (○) or 'planned' (◇). Nothing on it is a number. */
const SOON = {
  'coming-soon': { box: 'border-indigo-200 bg-indigo-50/20', icon: 'bg-indigo-100 text-indigo-700', title: 'text-indigo-950', tag: 'bg-indigo-100 text-indigo-800', body: 'text-indigo-900', pre: 'border-indigo-200 text-indigo-900', mark: '○ COMING SOON' },
  'planned':     { box: 'border-cyan-200 bg-cyan-50/20', icon: 'bg-cyan-100 text-cyan-700', title: 'text-cyan-950', tag: 'bg-cyan-100 text-cyan-800', body: 'text-cyan-900', pre: 'border-cyan-200 text-cyan-900', mark: '◇ PLANNED' },
};
function comingSoonPanel({ kind = 'coming-soon', icon = 'auto_awesome', title, body, prerequisite, actionsHtml = '' } = {}) {
  const s = SOON[kind] || SOON['coming-soon'];
  return `<div class="bg-surface-container-lowest p-space-lg rounded border ${s.box} flex flex-col justify-between min-h-[260px] space-y-3">
    <div class="flex items-start gap-3">
      <div class="w-10 h-10 rounded ${s.icon} flex items-center justify-center shrink-0">
        <span class="material-symbols-outlined text-[20px]">${esc(icon)}</span></div>
      <div class="space-y-1">
        <div class="flex items-center gap-2 flex-wrap">
          <h3 class="font-headline-md text-body-lg font-semibold ${s.title}">${esc(title)}</h3>
          <span class="px-1.5 py-0.5 rounded ${s.tag} font-label-numeric-sm text-[10px] font-bold">${s.mark}</span>
        </div>
        ${isBlank(body) ? '' : `<p class="font-body-sm text-body-sm ${s.body}">${esc(body)}</p>`}
      </div>
    </div>
    ${isBlank(prerequisite) ? '' : `<div class="p-2.5 bg-white/80 rounded border ${s.pre} font-label-numeric-sm text-label-numeric-sm">Prerequisite: ${esc(prerequisite)}</div>`}
    ${actionsHtml ? `<div class="flex items-center gap-2">${actionsHtml}</div>` : ''}
  </div>`;
}

/* ── Trust footer ─────────────────────────────────────────────────────────
   states-components…--1efa65 §7 "Universal Trust Footer Standard": Source ·
   As of · Evidence · Actor. Any part left blank prints "—", never a guess. */
function trustFooter({ source, asOf, evidence, actor } = {}) {
  const part = (k, v) => `<div class="flex items-center gap-2"><span class="text-outline font-table-header uppercase">${k}:</span><span class="font-semibold text-on-surface">${txt(v)}</span></div>`;
  const rule = '<div class="hidden md:block w-px h-4 bg-outline-variant/30"></div>';
  return `<div class="bg-surface-container-low border border-outline-variant/40 rounded-lg px-space-md py-2.5 flex flex-wrap items-center justify-between gap-3 text-on-surface-variant font-label-numeric-sm text-label-numeric-sm">
    ${part('Source', source)}${rule}${part('As of', asOf)}${rule}${part('Evidence', evidence)}${rule}${part('Actor', actor)}
  </div>`;
}

/* ── Drawer ───────────────────────────────────────────────────────────────
   app-shell-notifications-drawer-active--ef7a40: header (icon tile, title,
   sub-line, close), scrolling body, footer. drawerShell() is the inner markup;
   openStitchDrawer() puts it into the app's one #drawer through lib/ui.js
   openDrawer(), so the scrim, Escape and identity-change wiping all keep
   working exactly as they do for every legacy drawer. The close button carries
   data-drawer-close and is wired here. */
function drawerShell({ icon = 'info', title, sub, bodyHtml = '', footHtml = '' } = {}) {
  return `<div class="nx-stitch flex flex-col h-full bg-surface-container-lowest text-on-surface font-body-md text-body-md">
    <div class="h-16 px-space-lg flex items-center justify-between bg-surface-container-lowest shrink-0 shadow-sm">
      <div class="flex items-center gap-space-sm min-w-0">
        <div class="w-8 h-8 rounded-lg bg-primary-container/10 flex items-center justify-center text-primary shrink-0">
          <span class="material-symbols-outlined text-[20px]">${esc(icon)}</span></div>
        <div class="min-w-0"><h2 class="font-headline-md text-headline-md font-bold text-on-surface leading-tight truncate">${esc(title)}</h2>
          ${isBlank(sub) ? '' : `<div class="font-label-numeric-sm text-label-numeric-sm text-outline truncate">${esc(sub)}</div>`}</div>
      </div>
      <button type="button" aria-label="Close" data-drawer-close class="w-8 h-8 rounded-lg hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors">
        <span class="material-symbols-outlined text-[20px]">close</span></button>
    </div>
    <div class="flex-1 overflow-y-auto p-space-md space-y-space-sm bg-surface-container-low/40">${bodyHtml}</div>
    ${footHtml ? `<div class="p-space-md bg-surface-container-lowest shrink-0 shadow-[0_-2px_6px_rgba(0,0,0,0.03)] flex flex-col gap-space-sm">${footHtml}</div>` : ''}
  </div>`;
}
function openStitchDrawer(opts) {
  openDrawer(drawerShell(opts));
  $('drawer')?.querySelector('[data-drawer-close]')?.addEventListener('click', closeDrawer);
  return $('drawer');
}

/* ── Modal ────────────────────────────────────────────────────────────────
   The behaviour of lib/modal.js openModal() — one dialog at a time, Escape,
   backdrop mousedown and the X all close it, one keydown listener removed on
   every path out, first field focused — with the Stitch panel anatomy
   (command-palette-shortcuts-global-quick-actions--2e7ab4 overlay: dimmed
   backdrop, rounded-xl surface, header strip). Same return value:
   { wrap, close, msg } where msg(html) writes the status line. */
function openStitchModal({ title, bodyHtml = '', footHtml = '', wide = false } = {}) {
  document.getElementById('modalWrap')?.remove();
  const wrap = el('div', 'nx-stitch fixed inset-0 z-[60] bg-on-surface/30 backdrop-blur-[2px] overflow-auto flex items-start justify-center p-space-lg');
  wrap.id = 'modalWrap';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', String(title || 'Dialog'));
  wrap.innerHTML = `<div class="${wide ? 'max-w-3xl' : 'max-w-lg'} w-full my-auto bg-surface-container-lowest rounded-xl shadow-2xl overflow-hidden text-on-surface font-body-md text-body-md">
      <div class="px-space-lg py-space-md bg-surface-container-low flex items-center justify-between gap-space-sm">
        <h2 class="font-headline-md text-headline-md font-semibold text-on-surface">${esc(title)}</h2>
        <button type="button" aria-label="Close" data-modal-close class="w-8 h-8 rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors">
          <span class="material-symbols-outlined text-[20px]">close</span></button>
      </div>
      <div class="p-space-lg" data-modal-body>${bodyHtml}</div>
      ${footHtml ? `<div class="px-space-lg py-space-md bg-surface-container-low flex items-center justify-end gap-space-sm">${footHtml}</div>` : ''}
      <div class="px-space-lg pb-space-md font-body-sm text-body-sm text-on-surface-variant" data-modal-msg></div>
    </div>`;
  document.body.appendChild(wrap);
  const onKey = e => { if (e.key === 'Escape') close(); };
  const close = () => { document.removeEventListener('keydown', onKey); wrap.remove(); };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('[data-modal-close]').addEventListener('click', close);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  wrap.querySelector('input,select,textarea')?.focus();
  return { wrap, close, msg: html => { wrap.querySelector('[data-modal-msg]').innerHTML = html; } };
}

export {
  CHIP_KINDS, statusChip, TEMP, tempChip, BTN,
  kpiTile, MONEY, moneyTile, card, sectionHeader, dataTable,
  emptyState, errorState, skeleton, comingSoonPanel, trustFooter,
  drawerShell, openStitchDrawer, openStitchModal,
};
