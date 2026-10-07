/* NEXUS OS — lib/command-palette.js

   The global command palette ("Search or ask NEXUS", Ctrl K), built 7 Oct 2026
   from design/stitch/command-palette-shortcuts-global-quick-actions--2e7ab4.html:
   the input bar with "Esc to close", the mode switcher, a results column and a
   context column, the key-hint bar and the hotkey sheet.

   lib/shell.js opens it from the topbar search box and from Ctrl K / Cmd K.

   What each part is wired to, and what it is not:

   · RECORDS — leads, customers and inventory, read through db() with the same
     columns the screens already read, at most five of each, matched with
     PostgREST ilike. Every name, phone and email goes through lib/privacy.js.
     A read that fails says so in its own group; it never reads as "no match".
     A lead opens in the shared lead drawer; a customer or a unit opens its
     screen (there is no per-record route for either yet).
   · GO TO — every route in lib/nav.js's NAV, roadmap ones marked as such.
   · ACTIONS — "Record a walk-in" opens lib/manual-lead-form.js's dialog,
     imported, not copied. Nothing else is offered: an action the palette cannot
     actually perform is not listed.
   · ASK — routes the typed question to the Ask AI screen and puts it in that
     screen's question box. It does not send it: Ask AI shows its own
     knowledge-base and workflow health before a question goes, and the reader
     presses Enter there.
   · ACTION PREVIEW — Stitch's "Grounded explain" column (a rule, an evidence
     chain and a one-click recommended action) has no backend that produces
     a grounded explanation for an arbitrary record. It is drawn as COMING SOON,
     with no numbers in it.

   SHORTCUTS. The palette's own keys (↑ ↓ Enter Tab Esc) work while it is open.
   The hotkey sheet's "G then L / I / C / D" and "N" are installed here, once,
   on window in the CAPTURE phase. The same capture listener honours the
   "Keyboard shortcuts" preference in Settings → My preferences: when it is
   off, Ctrl K and ? are stopped here before lib/shell.js's document listener
   sees them, so turning shortcuts off really turns them off. Clicking the
   search box still opens the palette — that is a click, not a shortcut. */
import { db } from './data.js';
import { esc } from './format.js';
import { NAV, go } from './nav.js';
import { readFlag } from './prefs.js';
import { displayName, maskPhone, maskEmail } from './privacy.js';
import { manualLeadDialog } from './manual-lead-form.js';
import { leadDrawer } from './lead-drawer.js';
import { statusChip, comingSoonPanel } from './stitch-ui.js';

/* Preference keys, owned here and read by screens/settings.js. */
const PREF = {
  shortcuts: 'nexus.pref.shortcuts',          // default on
};
const shortcutsOn = () => readFlag(PREF.shortcuts, true);

const MODES = [
  ['search', 'travel_explore', 'Search & go to'],
  ['ask',    'psychology',     'Ask NEXUS'],
];
const MODE_BTN = {
  on:  'px-3 py-1.5 rounded font-body-sm text-body-sm font-semibold transition-all flex items-center gap-1.5 bg-primary-container text-on-primary',
  off: 'px-3 py-1.5 rounded font-body-sm text-body-sm font-semibold transition-all flex items-center gap-1.5 text-on-surface-variant hover:text-on-surface',
};
const ROW = {
  on:  'w-full text-left flex items-center justify-between gap-space-sm p-2.5 rounded-lg bg-surface-container cursor-pointer transition-colors',
  off: 'w-full text-left flex items-center justify-between gap-space-sm p-2.5 rounded-lg hover:bg-surface-container-low cursor-pointer transition-colors',
};
const SHEET = { open: 'px-space-lg py-3 bg-surface-container-low', closed: 'hide' };

let wrap = null, mode = 'search', items = [], sel = 0, seq = 0, sheetOpen = false;
let recState = { q: '', leads: null, customers: null, units: null, errs: {} };

const flat = () => NAV.flatMap(g => g.items.map(i => ({ ...i, group: g.group || 'Settings' })));
const clean = q => String(q || '').replace(/[^\p{L}\p{N} @.+\-]/gu, ' ').trim().slice(0, 60);

/* ── Records ─────────────────────────────────────────────────────────────── */
async function searchRecords(q) {
  const my = ++seq;
  const term = clean(q);
  recState = { q: term, leads: null, customers: null, units: null, errs: {} };
  if (term.length < 2) { paint(); return; }
  paint();
  const like = encodeURIComponent(`*${term}*`);
  const digits = term.replace(/\D+/g, '');
  const dLike = digits.length >= 3 ? encodeURIComponent(`*${digits}*`) : null;
  const run = (k, path) => db(path, { background: true }).then(
    rows => { if (my === seq) { recState[k] = Array.isArray(rows) ? rows : []; paint(); } },
    e => { if (my === seq) { recState[k] = []; recState.errs[k] = e; paint(); } });
  await Promise.all([
    run('leads', `leads?select=*&or=(name.ilike.${like},email.ilike.${like}${dLike ? `,phone.ilike.${dLike}` : ''})&order=created_at.desc&limit=5`),
    run('customers', `customer?select=id,display_name,phone_digits,email&or=(display_name.ilike.${like},email.ilike.${like}${dLike ? `,phone_digits.ilike.${dLike}` : ''})&limit=5`),
    run('units', `inventory?select=id,model,vin,status,days_in_stock&or=(model.ilike.${like},vin.ilike.${like})&limit=5`),
  ]);
}

/* ── The item list for the current mode ──────────────────────────────────── */
function buildItems(q) {
  const t = q.trim().toLowerCase();
  const out = [];
  if (mode === 'ask') {
    out.push({ group: 'Ask', icon: 'smart_toy', title: t ? `Ask NEXUS: “${q.trim()}”` : 'Type a question, then press Enter',
      sub: 'Opens Ask AI with this question in its box. Ask AI answers from your indexed documents only.', run: () => askAI(q) });
    return out;
  }
  const walkIn = { group: 'Actions', icon: 'person_add', title: 'Record a walk-in', sub: 'Add a lead by hand for someone who walked in or phoned', run: () => { close(); manualLeadDialog(() => {}); } };
  if (!t || 'record a walk-in lead phone call add'.includes(t) || t.includes('walk')) out.push(walkIn);
  const nav = flat().filter(i => !t || i.title.toLowerCase().includes(t) || i.group.toLowerCase().includes(t));
  nav.slice(0, t ? 8 : 6).forEach(i => out.push({ group: 'Go to', icon: i.icon, title: i.title,
    sub: `${i.group}${i.roadmap ? (i.roadmap === 'soon' ? ' · Coming soon' : ' · Planned') : i.mark === 'partial' ? ' · Partial' : ''}`,
    run: () => { close(); go(i.id); } }));
  if (t.length >= 2) {
    (recState.leads || []).forEach(l => out.push({ group: 'Leads', icon: 'person', title: displayName(l.name, l.id) || 'Unnamed lead',
      sub: [l.status, maskPhone(l.phone), maskEmail(l.email)].filter(Boolean).join(' · '), run: () => { close(); leadDrawer(l); } }));
    (recState.customers || []).forEach(c => out.push({ group: 'Customers', icon: 'badge', title: displayName(c.display_name, c.id) || 'Unnamed customer',
      sub: [maskPhone(c.phone_digits), maskEmail(c.email)].filter(Boolean).join(' · ') || 'No contact recorded', run: () => { close(); go('customers'); } }));
    (recState.units || []).forEach(u => out.push({ group: 'Inventory', icon: 'directions_car', title: u.model || 'Unit with no model recorded',
      sub: [u.vin ? `VIN ${u.vin}` : null, u.status, u.days_in_stock != null ? `${u.days_in_stock} days in stock` : null].filter(Boolean).join(' · '), run: () => { close(); go('inventory'); } }));
    out.push({ group: 'Ask', icon: 'smart_toy', title: `Ask NEXUS: “${q.trim()}”`, sub: 'Open Ask AI with this question', run: () => askAI(q) });
  }
  return out;
}

function recordNote() {
  if (mode !== 'search' || recState.q.length < 2) return '';
  const parts = [['leads', 'Leads'], ['customers', 'Customers'], ['units', 'Inventory']].map(([k, label]) => {
    if (recState.errs[k]) return `${label}: could not be searched just now`;
    if (recState[k] == null) return `${label}: searching…`;
    return recState[k].length ? null : `${label}: no match for “${recState.q}”`;
  }).filter(Boolean);
  return parts.length ? `<div class="px-space-xs pt-1 font-body-sm text-body-sm text-outline">${parts.map(esc).join(' · ')}</div>` : '';
}

/* ── Ask: hand the question to the Ask AI screen ─────────────────────────── */
function askAI(q) {
  const text = String(q || '').trim();
  close();
  go('ask');
  if (!text) return;
  let tries = 0;
  const put = () => {
    const box = document.querySelector('#screen textarea');
    if (box) { box.value = text; box.dispatchEvent(new Event('input', { bubbles: true })); box.focus(); return; }
    if (++tries < 40) setTimeout(put, 75);
  };
  put();
}

/* ── Paint ───────────────────────────────────────────────────────────────── */
function paint() {
  if (!wrap) return;
  const input = wrap.querySelector('[data-cp-input]');
  items = buildItems(input.value);
  if (sel >= items.length) sel = Math.max(0, items.length - 1);
  wrap.querySelectorAll('[data-cp-mode]').forEach(b => { b.className = b.dataset.cpMode === mode ? MODE_BTN.on : MODE_BTN.off; });
  let last = '';
  const list = items.map((it, i) => {
    const head = it.group !== last ? `<div class="flex items-center justify-between px-space-xs ${i ? 'mt-space-sm' : ''} mb-1.5"><span class="font-table-header text-table-header uppercase text-outline tracking-wider">${esc(it.group)}</span></div>` : '';
    last = it.group;
    return `${head}<button type="button" class="${i === sel ? ROW.on : ROW.off}" data-cp-item="${i}">
      <span class="flex items-center gap-space-sm min-w-0"><span class="material-symbols-outlined text-primary text-[20px]">${esc(it.icon)}</span>
        <span class="flex flex-col min-w-0"><span class="font-body-md text-body-md font-semibold text-on-surface truncate">${esc(it.title)}</span>
          ${it.sub ? `<span class="font-body-sm text-body-sm text-on-surface-variant truncate">${esc(it.sub)}</span>` : ''}</span></span>
      <span class="material-symbols-outlined text-outline text-[18px]">${i === sel ? 'keyboard_return' : 'chevron_right'}</span></button>`;
  }).join('');
  wrap.querySelector('[data-cp-list]').innerHTML = (list || `<div class="p-space-md font-body-sm text-body-sm text-on-surface-variant">Nothing in the navigation matches. Records are searched once you type two characters.</div>`) + recordNote();
  wrap.querySelectorAll('[data-cp-item]').forEach(b => {
    b.addEventListener('click', () => { sel = Number(b.dataset.cpItem); items[sel]?.run(); });
    b.addEventListener('mousemove', () => { if (sel !== Number(b.dataset.cpItem)) { sel = Number(b.dataset.cpItem); paintSel(); } });
  });
  paintPreview();
}
function paintSel() {
  wrap.querySelectorAll('[data-cp-item]').forEach(b => { b.className = Number(b.dataset.cpItem) === sel ? ROW.on : ROW.off; });
  wrap.querySelector(`[data-cp-item="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  paintPreview();
}
function paintPreview() {
  const it = items[sel];
  wrap.querySelector('[data-cp-preview]').innerHTML = `
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-[22px]">verified</span>
        <span class="font-headline-md text-headline-md font-bold text-on-surface">Selected</span></div>
      ${it ? `<span class="font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-surface-container-lowest text-on-surface-variant font-semibold uppercase">${esc(it.group)}</span>` : ''}
    </div>
    <div class="p-space-md rounded-lg bg-surface-container-lowest flex flex-col gap-1">
      <span class="font-body-md text-body-md font-semibold text-on-surface">${it ? esc(it.title) : 'Nothing selected'}</span>
      <span class="font-body-sm text-body-sm text-on-surface-variant">${it && it.sub ? esc(it.sub) : 'Use ↑ ↓ to choose and Enter to open.'}</span>
    </div>
    ${comingSoonPanel({ kind: 'coming-soon', icon: 'psychology', title: 'Grounded explanation & action preview',
      body: 'Why a record is flagged, the evidence behind it and a recommended next action, shown here before you open it. No backend produces this for an arbitrary record yet, so nothing is shown rather than a guess.',
      prerequisite: 'An explanation service that cites the rule and the rows behind each flag.' })}`;
}

/* ── Open / close ────────────────────────────────────────────────────────── */
let searchTimer = null;
function onKey(e) {
  if (!wrap) return;
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paintSel(); return; }
  if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paintSel(); return; }
  if (e.key === 'Enter') { e.preventDefault(); items[sel]?.run(); return; }
  if (e.key === 'Tab') {
    e.preventDefault();
    /* Tab moves to the first row of the next group. */
    const g = items[sel]?.group;
    const next = items.findIndex((it, i) => i > sel && it.group !== g);
    sel = next >= 0 ? next : 0; paintSel();
  }
}

function openCommandPalette({ query = '' } = {}) {
  if (wrap) { wrap.querySelector('[data-cp-input]')?.focus(); return; }
  document.activeElement?.blur?.();
  mode = 'search'; sel = 0; sheetOpen = false;
  recState = { q: '', leads: null, customers: null, units: null, errs: {} };
  wrap = document.createElement('div');
  wrap.id = 'cmdPalette';
  wrap.className = 'nx-stitch fixed inset-0 bg-inverse-surface/40 backdrop-blur-sm z-[70] flex items-start justify-center pt-8 px-4 overflow-y-auto';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', 'Search or ask NEXUS');
  wrap.innerHTML = `<div class="w-full max-w-[1040px] bg-surface-container-lowest rounded-2xl shadow-2xl overflow-hidden flex flex-col mb-12 text-on-surface font-body-md text-body-md">
    <div class="px-space-lg py-4 bg-surface-container-lowest flex items-center gap-space-md">
      <span class="material-symbols-outlined text-primary-container text-[24px]">search</span>
      <input class="flex-1 bg-transparent font-headline-md text-headline-md text-on-surface focus:outline-none placeholder:text-outline" data-cp-input type="text" autocomplete="off" spellcheck="false" placeholder="Search leads, customers, inventory, screens — or ask NEXUS…" />
      <div class="flex items-center gap-space-sm">
        <button type="button" class="w-7 h-7 rounded flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-container-low transition-colors" data-cp-clear title="Clear input"><span class="material-symbols-outlined text-[18px]">close</span></button>
        <kbd class="px-2 py-1 rounded bg-surface-container-low font-label-numeric-sm text-label-numeric-sm text-outline uppercase tracking-wider">Esc to close</kbd>
      </div>
    </div>
    <div class="px-space-lg py-2.5 bg-surface-container-low flex items-center justify-between gap-space-sm">
      <div class="flex items-center gap-1.5">
        ${MODES.map(([k, icon, label]) => `<button type="button" class="${MODE_BTN.off}" data-cp-mode="${k}"><span class="material-symbols-outlined text-[16px]">${icon}</span><span>${label}</span></button>`).join('')}
        <span class="px-3 py-1.5 rounded font-body-sm text-body-sm font-semibold flex items-center gap-1.5 text-outline" title="Not available yet"><span class="material-symbols-outlined text-[16px]">bolt</span><span>Explain & act</span>${statusChip('coming-soon')}</span>
      </div>
      <span class="font-label-numeric-sm text-label-numeric-sm text-outline uppercase">Reads only what your account can see</span>
    </div>
    <div class="grid grid-cols-12 min-h-[460px] bg-surface-container-lowest">
      <div class="col-span-12 lg:col-span-7 p-space-md overflow-y-auto max-h-[540px]" data-cp-list></div>
      <div class="col-span-12 lg:col-span-5 p-space-md bg-surface-container-low flex flex-col gap-space-md" data-cp-preview></div>
    </div>
    <div class="px-space-lg py-3 bg-surface-container-lowest flex flex-wrap items-center justify-between gap-y-2">
      <div class="flex items-center gap-space-md font-label-numeric-sm text-label-numeric-sm text-outline">
        <span class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-surface-container text-on-surface font-semibold">↑↓</kbd> Navigate</span>
        <span class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-surface-container text-on-surface font-semibold">↵</kbd> Select</span>
        <span class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-surface-container text-on-surface font-semibold">Tab</kbd> Next group</span>
        <span class="flex items-center gap-1.5"><kbd class="px-1.5 py-0.5 rounded bg-surface-container text-on-surface font-semibold">Esc</kbd> Close</span>
      </div>
      <button type="button" class="flex items-center gap-1 text-primary hover:text-on-surface font-body-sm text-body-sm font-semibold transition-colors" data-cp-sheet>
        <span class="material-symbols-outlined text-[16px]">keyboard</span><span>Keyboard shortcuts</span><span class="material-symbols-outlined text-[16px]" data-cp-sheet-icon>expand_less</span></button>
    </div>
    <div class="${SHEET.closed}" data-cp-sheet-body>${shortcutSheet()}</div>
  </div>`;
  document.body.appendChild(wrap);
  const input = wrap.querySelector('[data-cp-input]');
  input.value = query || '';
  input.addEventListener('input', () => {
    sel = 0; paint();
    clearTimeout(searchTimer);
    if (mode === 'search') searchTimer = setTimeout(() => searchRecords(input.value), 220);
  });
  wrap.querySelector('[data-cp-clear]').addEventListener('click', () => { input.value = ''; recState = { q: '', leads: null, customers: null, units: null, errs: {} }; sel = 0; paint(); input.focus(); });
  wrap.querySelectorAll('[data-cp-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.cpMode; sel = 0; paint(); input.focus(); if (mode === 'search') searchRecords(input.value); }));
  wrap.querySelector('[data-cp-sheet]').addEventListener('click', () => {
    sheetOpen = !sheetOpen;
    wrap.querySelector('[data-cp-sheet-body]').className = sheetOpen ? SHEET.open : SHEET.closed;
    wrap.querySelector('[data-cp-sheet-icon]').textContent = sheetOpen ? 'expand_more' : 'expand_less';
  });
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', onKey, true);
  paint();
  if (input.value) searchRecords(input.value);
  input.focus();
}

function closeCommandPalette() {
  document.removeEventListener('keydown', onKey, true);
  clearTimeout(searchTimer);
  seq++;
  wrap?.remove();
  wrap = null;
}
const close = closeCommandPalette;

/* ── The hotkey sheet, and the hotkeys themselves ────────────────────────── */
const HOTKEYS = [
  ['Ctrl K', 'Search or ask NEXUS'],
  ['G then L', 'Go to Leads'],
  ['G then I', 'Go to Inventory'],
  ['G then C', 'Customer 360'],
  ['G then D', 'Go to Deals'],
  ['N', 'Record a walk-in'],
  ['?', 'Show shortcuts'],
];
function shortcutSheet() {
  const off = !shortcutsOn();
  return `${off ? '<div class="mb-2 font-body-sm text-body-sm text-on-surface-variant">Keyboard shortcuts are switched off in Settings → My preferences on this device, so only the keys inside this panel work.</div>' : ''}
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">${HOTKEYS.map(([k, what]) => `<div class="flex items-center justify-between p-2 rounded bg-surface-container-lowest">
      <span class="font-body-sm text-body-sm text-on-surface">${esc(what)}</span>
      <kbd class="px-1.5 py-0.5 rounded bg-surface-container font-label-numeric-sm text-label-numeric-sm text-primary font-bold">${esc(k)}</kbd></div>`).join('')}</div>`;
}

const typing = e => {
  const t = e.target;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
};
let gPending = 0;
const G_TARGET = { l: 'leads', i: 'inventory', c: 'customers', d: 'deals' };
function installHotkeys() {
  window.addEventListener('keydown', e => {
    const on = shortcutsOn();
    const ctrlK = (e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K');
    if (!on) {
      /* Off means off: stop the shell's Ctrl K and ? before they reach it. */
      if (ctrlK || (e.key === '?' && !typing(e))) e.stopImmediatePropagation();
      return;
    }
    if (wrap || typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!document.getElementById('app') || document.getElementById('app').classList.contains('hide')) return;
    if (document.getElementById('modalWrap')) return;
    const k = String(e.key || '').toLowerCase();
    if (gPending && Date.now() - gPending < 1200 && G_TARGET[k]) { gPending = 0; e.preventDefault(); go(G_TARGET[k]); return; }
    gPending = k === 'g' ? Date.now() : 0;
    if (k === 'n') { e.preventDefault(); manualLeadDialog(() => {}); }
  }, true);
}
if (typeof window !== 'undefined') installHotkeys();

export { openCommandPalette, closeCommandPalette, PREF as PALETTE_PREF };
