/* NEXUS OS — screens/whats-coming.js

   What's Coming. Design: design/stitch/what-s-coming-where-nexus-is-going--b970d9.html
   (7 Oct 2026): page header, the lifecycle-states legend, a filter by domain,
   one section per navigation group with a card per module, and the closing
   "feature request" callout.

   Every row comes from lib/nav.js — the same NAV the sidebar draws — and every
   roadmap sentence and prerequisite from screens/roadmap.js's ROADMAP, so this
   page, the sidebar and each roadmap screen cannot disagree. The state word is
   derived, never typed here:

     LIVE         a working screen (no mark in NAV)
     PARTIAL      `mark: 'partial'` — real, answers part of its question
     COMING SOON  `roadmap: 'soon'`
     PLANNED      `roadmap: 'planned'`

   Nothing here is a date, a version, a percentage or a metric. Stitch's mock
   carried none of those in its cards either, and its "phase" and "Q1" phrasing
   is not reproduced: COMING SOON and PLANNED are states, not delivery promises.

   "Notify me" is remembered on this device only (lib/prefs.js) — see the
   header of screens/roadmap.js for why: there is no backend object that records
   interest, so nothing is sent and the page says so. */
import { NAV, SCREENS, go } from '../lib/nav.js';
import { esc } from '../lib/format.js';
import { readFlag, writeFlag } from '../lib/prefs.js';
import { BTN, sectionHeader, openStitchModal } from '../lib/stitch-ui.js';
import { ROADMAP, notifyWanted } from './roadmap.js';

const STATE = {
  live:    { chip: 'shrink-0 px-2.5 py-0.5 rounded font-label-numeric-sm text-label-numeric-sm font-semibold bg-[#e6f4ef] text-[#157a5b] tracking-wider uppercase', word: '● LIVE' },
  partial: { chip: 'shrink-0 px-2.5 py-0.5 rounded font-label-numeric-sm text-label-numeric-sm font-semibold bg-[#fef3e2] text-[#96570a] tracking-wider uppercase', word: '◐ PARTIAL' },
  soon:    { chip: 'shrink-0 px-2.5 py-0.5 rounded font-label-numeric-sm text-label-numeric-sm font-semibold bg-[#f1eafa] text-[#5b2e8c] tracking-wider uppercase', word: '○ COMING SOON' },
  planned: { chip: 'shrink-0 px-2.5 py-0.5 rounded font-label-numeric-sm text-label-numeric-sm font-semibold bg-surface-variant text-on-surface-variant tracking-wider uppercase', word: '◇ PLANNED' },
};
const stateOf = i => (i.roadmap === 'soon' ? 'soon' : i.roadmap === 'planned' ? 'planned' : i.mark === 'partial' ? 'partial' : 'live');

const GROUP_ICON = { 'Work': 'bolt', 'Revenue Recovery': 'currency_exchange', 'Assets': 'directions_car', 'Intelligence': 'psychology', 'Operations': 'settings_suggest', 'Settings': 'tune' };
const PARTIAL_WHY = 'Real and reading your data today, but it answers only part of its question until more of the data it needs is connected.';

const FILTER = {
  on:  'px-3 py-1.5 rounded-lg bg-primary-container text-on-primary font-body-sm text-body-sm font-semibold whitespace-nowrap',
  off: 'px-3 py-1.5 rounded-lg bg-surface-container text-on-surface-variant hover:text-on-surface font-body-sm text-body-sm whitespace-nowrap',
};
const NOTIFY = {
  off: 'px-space-md py-1.5 rounded-lg bg-surface-container text-on-surface font-body-sm text-body-sm hover:bg-surface-container-high transition-colors flex items-center gap-1.5',
  on:  'px-space-md py-1.5 rounded-lg bg-[#e6f4ef] text-[#157a5b] font-body-sm text-body-sm font-semibold transition-colors flex items-center gap-1.5',
};
const ALL_KEY = 'nexus.roadmap.notify.all';
let filter = 'all';

function moduleCard(i) {
  const st = stateOf(i);
  const r = ROADMAP[i.id];
  const body = r ? r.body : PARTIAL_WHY;
  const pre = r ? r.prerequisite : null;
  const wanted = r ? notifyWanted(i.id) : false;
  return `<div class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col justify-between gap-space-md hover:bg-surface-container-low transition-colors">
    <div class="space-y-space-sm">
      <div class="flex items-start justify-between gap-space-sm">
        <div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-[20px]">${esc(i.icon)}</span>
          <h3 class="font-headline-md text-headline-md text-on-surface font-bold">${esc(i.title)}</h3></div>
        <span class="${STATE[st].chip}">${STATE[st].word}</span>
      </div>
      <p class="font-body-md text-body-md text-on-surface-variant">${esc(body)}</p>
    </div>
    <div class="space-y-space-sm pt-space-xs">
      ${pre ? `<div class="flex items-center gap-2 px-space-sm py-1.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-label-numeric-sm" title="${esc(pre)}">
        <span class="material-symbols-outlined text-[16px] text-outline">link</span><span class="text-on-surface font-semibold">Prerequisite:</span><span class="truncate">${esc(pre)}</span></div>` : ''}
      <div class="flex items-center justify-end gap-space-sm pt-1">
        ${r ? `<button class="${wanted ? NOTIFY.on : NOTIFY.off}" type="button" data-wc-notify="${esc(i.id)}" aria-pressed="${wanted}">
          <span class="material-symbols-outlined text-[16px]">${wanted ? 'notifications_active' : 'notifications'}</span><span>${wanted ? 'Saved on this device' : 'Notify me'}</span></button>` : ''}
        <button class="px-space-md py-1.5 rounded-lg bg-surface-container-high text-primary font-body-sm text-body-sm font-semibold hover:bg-primary-container hover:text-on-primary transition-colors flex items-center gap-1.5" type="button" data-wc-open="${esc(i.id)}">
          <span class="material-symbols-outlined text-[16px]">${r ? 'visibility' : 'arrow_forward'}</span><span>${r ? 'Preview' : 'Open'}</span></button>
      </div>
    </div>
  </div>`;
}

function groupSection(g, n) {
  const groupLabel = g.group || 'Settings';
  const items = g.items.filter(i => i.sidebar !== false || i.mark);
  const cards = items.filter(i => stateOf(i) !== 'live');
  const live = items.filter(i => stateOf(i) === 'live');
  const cols = cards.length >= 3 ? 'grid grid-cols-1 lg:grid-cols-3 gap-space-md' : 'grid grid-cols-1 lg:grid-cols-2 gap-space-md';
  return `<section class="space-y-space-md" data-wc-group="${esc(groupLabel)}">
    <div class="flex items-center gap-3">
      <div class="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-primary"><span class="material-symbols-outlined text-[20px]">${esc(GROUP_ICON[groupLabel] || 'apps')}</span></div>
      <div><h2 class="font-headline-md text-headline-md text-on-surface tracking-tight font-bold">${n}. ${esc(groupLabel.toUpperCase())}</h2>
        <p class="font-body-sm text-body-sm text-outline">${live.length} working ${live.length === 1 ? 'screen' : 'screens'} · ${cards.length} partial or on the roadmap</p></div>
    </div>
    ${live.length ? `<div class="flex flex-wrap items-center gap-space-sm">
      ${live.map(i => `<button type="button" class="inline-flex items-center gap-1.5 px-space-sm py-1 rounded-lg bg-surface-container-lowest shadow-sm hover:bg-surface-container-low transition-colors font-body-sm text-body-sm text-on-surface" data-wc-open="${esc(i.id)}">
        <span class="material-symbols-outlined text-[16px] text-outline">${esc(i.icon)}</span><span>${esc(i.title)}</span><span class="${STATE.live.chip}">${STATE.live.word}</span></button>`).join('')}
    </div>` : ''}
    ${cards.length ? `<div class="${cols}">${cards.map(moduleCard).join('')}</div>` : ''}
  </section>`;
}

function legendCard(state, icon, iconCls, text) {
  return `<div class="p-space-md rounded-lg bg-surface-container-low flex flex-col justify-between gap-space-sm">
    <div class="flex items-center justify-between"><span class="${STATE[state].chip}">${STATE[state].word}</span>
      <span class="material-symbols-outlined ${iconCls} text-[18px]">${icon}</span></div>
    <p class="font-body-sm text-body-sm text-on-surface-variant">${text}</p></div>`;
}

SCREENS.whatscoming = async host => {
  const groups = NAV.filter(g => g.items.length);
  const names = groups.map(g => g.group || 'Settings');
  const draw = () => {
    const allOn = readFlag(ALL_KEY, false);
    const shown = groups.map((g, i) => ({ g, n: i + 1 })).filter(({ g }) => filter === 'all' || (g.group || 'Settings') === filter);
    host.innerHTML = `<div class="nx-stitch flex flex-col gap-space-md">
      ${sectionHeader({ eyebrow: 'Roadmap & capabilities', title: 'Where NEXUS is going',
        sub: 'Every screen in NEXUS and the state it is in today. COMING SOON and PLANNED are states, not dates — nothing on this page is a delivery promise or reads your data.',
        actionsHtml: `<button type="button" class="${allOn ? BTN.secondary : BTN.primary}" data-wc-all aria-pressed="${allOn}">
            <span class="material-symbols-outlined text-[18px]">${allOn ? 'notifications_active' : 'notifications'}</span><span class="whitespace-nowrap">${allOn ? 'Saved on this device' : 'Notify me on all releases'}</span></button>
          <button type="button" class="${BTN.secondary}" data-wc-learn><span class="material-symbols-outlined text-[18px]">help_outline</span><span>Learn more</span></button>` })}
      <div data-wc-note class="font-body-sm text-body-sm text-on-surface-variant"></div>
      <div class="bg-surface-container-lowest rounded-xl p-space-md lg:p-space-lg shadow-sm space-y-space-md">
        <div class="flex items-center justify-between pb-space-sm">
          <div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-[20px]">tune</span>
            <span class="font-table-header text-table-header uppercase tracking-wider text-outline">What each state means</span></div>
          <span class="font-label-numeric-sm text-label-numeric-sm text-outline">Same marks as the sidebar</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md">
          ${legendCard('live', 'verified', 'text-[#157a5b]', 'Working today, on your own dealership’s data.')}
          ${legendCard('partial', 'pending', 'text-[#96570a]', 'Real and reading your data, but answering only part of its question until more is connected.')}
          ${legendCard('soon', 'engineering', 'text-[#5b2e8c]', 'Designed, and next to be built on data NEXUS mostly already has. Shows no data yet.')}
          ${legendCard('planned', 'flag', 'text-outline', 'Designed and on the roadmap; the data it needs does not exist in NEXUS yet.')}
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-space-sm">
        <span class="font-table-header text-table-header uppercase tracking-wider text-outline">Filter domain:</span>
        <button type="button" class="${filter === 'all' ? FILTER.on : FILTER.off}" data-wc-filter="all">All groups</button>
        ${names.map(g => `<button type="button" class="${filter === g ? FILTER.on : FILTER.off}" data-wc-filter="${esc(g)}">${esc(g)}</button>`).join('')}
      </div>
      <div class="space-y-space-xl">${shown.map(({ g, n }) => groupSection(g, n)).join('')}</div>
      <div class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-space-md">
        <div class="flex items-center gap-space-md">
          <div class="w-12 h-12 rounded-xl bg-surface-container flex items-center justify-center text-primary shrink-0"><span class="material-symbols-outlined text-[28px]">terminal</span></div>
          <div><h3 class="font-headline-md text-headline-md text-on-surface font-bold">Have a feature request or need a connector?</h3>
            <p class="font-body-md text-body-md text-on-surface-variant">Tell NEXUS what your dealership needs next. There is no request form inside the app yet, so this opens an email.</p></div>
        </div>
        <div class="flex flex-wrap items-center gap-space-sm shrink-0 w-full md:w-auto">
          <a class="flex-1 md:flex-none px-space-md py-2 rounded-lg bg-primary-container text-on-primary font-body-md text-body-md font-semibold hover:bg-primary transition-colors shadow-sm" href="mailto:aliasgher892@gmail.com?subject=NEXUS%20feature%20request">Email a request</a>
        </div>
      </div>
    </div>`;
    const root = host.firstElementChild;
    root.querySelectorAll('[data-wc-filter]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.wcFilter; draw(); }));
    root.querySelectorAll('[data-wc-open]').forEach(b => b.addEventListener('click', () => go(b.dataset.wcOpen)));
    root.querySelectorAll('[data-wc-notify]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.wcNotify;
      const ok = writeFlag(`nexus.roadmap.notify.${id}`, !notifyWanted(id));
      draw();
      host.querySelector('[data-wc-note]').textContent = ok
        ? 'Saved on this device only. NEXUS has no shared waiting list yet, so nobody is told and no email is sent.'
        : 'This browser would not let NEXUS remember that (site data is blocked or this is a private window).';
    }));
    root.querySelector('[data-wc-all]').addEventListener('click', () => {
      const ok = writeFlag(ALL_KEY, !readFlag(ALL_KEY, false));
      draw();
      host.querySelector('[data-wc-note]').textContent = ok
        ? 'Saved on this device only. Nothing is sent: NEXUS has no release mailing list yet.'
        : 'This browser would not let NEXUS remember that.';
    });
    root.querySelector('[data-wc-learn]').addEventListener('click', () => openStitchModal({ title: 'How to read this page',
      bodyHtml: `<div class="flex flex-col gap-space-sm font-body-md text-body-md text-on-surface">
        <p>Every screen in the sidebar is listed here under its sidebar group, with the same mark the sidebar gives it.</p>
        <p>A COMING SOON or PLANNED screen can be opened: it shows its designed layout with every value as —, because it reads no data.</p>
        <p class="text-on-surface-variant">Notify me is remembered in this browser only. NEXUS does not yet keep a list of who asked, so nothing is emailed when a screen ships.</p></div>` }));
  };
  draw();
};
