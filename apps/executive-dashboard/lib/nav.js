/* NEXUS OS — lib/nav.js
   Split out of the original monolithic app.js on 17 Aug 2026. The NAV list,
   the sidebar and the dealership scope chip were rebuilt from the Google Stitch
   app-shell designs on 7 Oct 2026; routing (go()) is the original code. */
import { $, el } from './dom.js';
import { esc } from './format.js';
import { stateError, stateLoading } from './states.js';
import { closeDrawer } from './ui.js';
import { extraTenants, hasNoTenant, loadTenant, tenantLabel, tenantState } from './tenant.js';


/* ── The navigation, as designed in Google Stitch (7 Oct 2026) ──────────────
   design/stitch/app-shell-master-specification-navigation-hierarchy--2b6343
   .html is the visual reference: five groups — Work, Revenue Recovery, Assets,
   Intelligence, Operations — and a bottom block. Every id that existed before
   the redesign is still here, so every bookmark and deep link still lands; what
   moved is only which group a screen sits in, to match the design.

   Four kinds of item, and each says what it is in words as well as colour:
     · a working screen                   — no mark
     · `mark: 'partial'`                  — ◐ PARTIAL: real, but answers only part
                                            of its question today
     · `roadmap: 'soon' | 'planned'`      — ○ COMING SOON / ◇ PLANNED: a screen
                                            that renders no live data at all; it
                                            sits in the group's collapsed
                                            "+N coming soon" row, never among the
                                            working screens
     · `sidebar: false`                   — routable (a link from another screen
                                            reaches it) but has no sidebar row;
                                            Vehicle 360 is opened from Inventory

   The founder console is not in this list, and must never be again. It moved
   out of the dealer app on 22 Sep 2026 into its own page (founder/index.html,
   served at /founder) so that a dealer -- or a screen recording of this app
   made while the founder is signed in -- shows no founder UI at all. Every id
   below names a dealership's own screen.

   Ids are [a-z0-9_] on purpose: QUALITY_GATE.mjs S1 parses them out of this
   block, and a screen module registers itself as `SCREENS.<id> = …`. */
const NAV = [
  { group: 'Work', tag: 'CORE', items: [
    { id:'overview',      title:'Overview',            icon:'dashboard' },
    /* Today's Money Leaks is still the app's default landing screen (app.js and
       `current` below): it is the only one that answers a question rather than
       reporting a state. Stitch places it second in the group, under Overview. */
    { id:'moneyleaks',    title:"Today's Money Leaks", icon:'trending_down' },
    { id:'myqueue',       title:'My Queue',            icon:'inbox',         mark:'partial' },
    { id:'ownerbrief',    title:'Owner Brief',         icon:'shield_lock',   mark:'partial' },
    { id:'leads',         title:'Leads',               icon:'person_search' },
    /* Record a Lead: the only surface through which a walk-in or a phone call
       can be entered at all (18 Sep 2026). */
    { id:'recordlead',    title:'Record a Lead',       icon:'person_add' },
    { id:'deals',         title:'Deals',               icon:'handshake' },
    { id:'appointments',  title:'Appointments',        icon:'calendar_today' },
    { id:'conversations', title:'Conversations',       icon:'chat' },
    { id:'calls',         title:'Calls & Voice',       icon:'call',              roadmap:'planned' },
  ]},
  /* PRODUCT.md's thesis in one group: Revenue Recovery is the aggregate and the
     engines beneath it are what it summarises. The engine modules are loaded by
     glob in app.js, so a module that has not landed renders go()'s explicit
     "not part of this build" state rather than breaking the bundle. */
  { group: 'Revenue Recovery', items: [
    { id:'revenue',         title:'Revenue Recovery',          icon:'currency_exchange' },
    { id:'attribution',     title:'Attribution',               icon:'hub' },
    { id:'leadrecovery',    title:'Lead Recovery',             icon:'published_with_changes' },
    { id:'dealrescue',      title:'Deal Rescue',               icon:'emergency' },
    { id:'policy',          title:'Policy',                    icon:'gavel' },
    { id:'stockmatch',      title:'Stock-to-Lead Matching',    icon:'join_inner',      roadmap:'soon' },
    { id:'dealroom',        title:'Deal Room',                 icon:'meeting_room',    roadmap:'soon' },
    { id:'servicerecovery', title:'Service Revenue Recovery',  icon:'car_repair',      roadmap:'planned' },
  ]},
  { group: 'Assets', items: [
    { id:'inventory',   title:'Inventory',                icon:'directions_car' },
    { id:'vehicle360',  title:'Vehicle 360',              icon:'directions_car',  mark:'partial', sidebar:false },
    { id:'tradein',     title:'Trade-In Desk',            icon:'sync_alt',        roadmap:'planned' },
    { id:'acquisition', title:'Acquisition Advisor',      icon:'shopping_cart',   roadmap:'planned' },
    { id:'recon',       title:'Reconditioning Tracker',   icon:'build_circle',    roadmap:'planned' },
    { id:'marketplace', title:'Marketplace Performance',  icon:'storefront',      roadmap:'planned' },
  ]},
  { group: 'Intelligence', items: [
    { id:'customers',      title:'Customer 360',            icon:'badge' },
    { id:'ask',            title:'Ask AI',                  icon:'smart_toy' },
    { id:'finance',        title:'Finance Desk',            icon:'calculate' },
    { id:'competitors',    title:'Competitors',             icon:'monitoring' },
    { id:'ownership360',   title:'Ownership 360',           icon:'manage_history',  roadmap:'planned' },
    { id:'marketsentinel', title:'Market Sentinel',         icon:'radar',           roadmap:'planned' },
    { id:'eventgraph',     title:'Dealership Event Graph',  icon:'schema',          roadmap:'planned' },
    { id:'benchmarking',   title:'Dealer Benchmarking',     icon:'leaderboard',     roadmap:'planned' },
  ]},
  { group: 'Operations', items: [
    /* The Action Center: the only screen where a person is expected to answer
       something rather than read something. */
    { id:'actions',        title:'Action Center',   icon:'task_alt' },
    { id:'channels',       title:'Channels',        icon:'alt_route' },
    { id:'leadsources',    title:'Lead Sources',    icon:'source' },
    { id:'integrations',   title:'Integrations',    icon:'integration_instructions' },
    { id:'automation',     title:'Automation',      icon:'precision_manufacturing' },
    { id:'campaigns',      title:'Campaigns',       icon:'campaign' },
    { id:'exceptions',     title:'Exceptions',      icon:'error_outline',   mark:'partial' },
    { id:'compliance',     title:'Compliance',      icon:'verified_user' },
    { id:'team',           title:'Team',            icon:'groups' },
    { id:'customerportal', title:'Customer Portal', icon:'person_pin',      roadmap:'planned' },
  ]},
  /* The bottom block. Setup is read once at the beginning of a dealership's
     life, so it sits here rather than in a working group; Group & Branches and
     Markets & Localization are Settings' roadmap. */
  { group: '', bottom: true, items: [
    { id:'whatscoming',  title:"What's Coming",          icon:'rocket_launch' },
    { id:'setup',        title:'Setup',                  icon:'tune' },
    { id:'subscription', title:'Subscription',           icon:'workspace_premium' },
    { id:'settings',     title:'Settings',               icon:'settings' },
    { id:'branches',     title:'Group & Branches',       icon:'account_tree',  roadmap:'planned' },
    { id:'localization', title:'Markets & Localization', icon:'translate',     roadmap:'planned' },
  ]},
];
const SCREENS = {};
/* Every nav item, flattened. go() and buildNav() read it to decide what a
   signed-in account may navigate to; an id not in it (a stale #founder hash
   included) falls back to the default screen. */
const flatNav = () => NAV.flatMap(g => g.items);

/* The screen the app opens on. Kept in step with app.js, which passes the same
   id to go() when there is no hash to honour. */
let current = 'moneyleaks';


/* ── Which dealership is this? ───────────────────────────────────────────────
   Until 2 Sep 2026 there was one dealership and the question had no answer
   because it had no meaning. It has both now.

   Since the Stitch shell (7 Oct 2026) it is said in two places, both in the
   topbar: the first segment of the breadcrumb, and the scope chip with its
   menu (app-shell-scope-menu-active-latency-warning--068c5d). The brand in the
   sidebar names the PRODUCT; these name whose rows are underneath the page.

   It never renders a guess. Not-loaded, failed and unknown each get their own
   words, because "—" beside a dealership name reads as a dealership called
   "—", and this codebase has shipped that class of caption before. The menu
   offers no switch: this build answers as one dealership (see lib/tenant.js),
   and "All rooftops" is shown as COMING SOON rather than as a control. */
const SCOPE_BTN = {
  idle: 'flex items-center gap-1.5 px-space-sm py-1 rounded-lg bg-surface-container-low hover:bg-surface-container font-body-sm text-body-sm text-on-surface transition-colors',
  warn: 'flex items-center gap-1.5 px-space-sm py-1 rounded-lg bg-error-container text-on-error-container font-body-sm text-body-sm transition-colors',
};
function tenantWords(s = tenantState()) {
  if (!s.loaded) return { label: 'Checking account…', tone: 'idle',
    why: 'Reading which dealership this account belongs to.' };
  if (!s.ok) return { label: 'Dealership unknown', tone: 'warn',
    why: 'The membership read failed, so this page cannot say which dealership the rows below belong to. '
      + 'It is not a claim that they belong to none — the screens still read whatever the database allows this account to read.' };
  if (hasNoTenant(s)) return { label: 'No dealership', tone: 'warn',
    why: 'This account is not a member of any dealership, so every tenant-scoped table reads back empty for it.' };
  const label = tenantLabel(s);
  const extra = extraTenants(s);
  return { label: label || 'Dealership', tone: 'idle', dealership: label, extra,
    why: label
      ? `Every figure on every screen is scoped to ${label}. Rows belonging to any other dealership are refused by the database, not filtered here.`
        + (extra ? ` This account is also a member of ${extra} other ${extra === 1 ? 'dealership' : 'dealerships'}; the database answers as ${label} and this build has no way to switch, so nothing from the ${extra === 1 ? 'other one' : 'others'} appears anywhere.` : '')
      : 'The dealership this account belongs to has a membership row but no readable name.' };
}

function paintTenantPill() {
  const w = tenantWords();
  const crumb = $('crumbTenant');
  if (crumb) { crumb.textContent = w.label; crumb.title = w.why; }
  const btn = $('scopeBtn');
  if (btn) {
    btn.className = SCOPE_BTN[w.tone] || SCOPE_BTN.idle;
    btn.title = w.why;
    const lab = $('scopeLabel');
    if (lab) lab.textContent = w.label;
  }
  const menu = $('scopeMenuBody');
  if (menu) {
    const currentRow = w.dealership
      ? `<div class="group flex items-start gap-2.5 p-2.5 rounded-lg bg-surface-container-high/40">
           <div class="mt-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center text-on-primary flex-shrink-0">
             <span class="material-symbols-outlined text-[13px] font-bold">check</span></div>
           <div class="flex flex-col flex-1 min-w-0">
             <span class="font-body-sm text-body-sm font-semibold text-on-surface truncate">${esc(w.dealership)}</span>
             <div class="flex items-center gap-2 mt-1">
               <span class="font-label-numeric-sm text-table-header px-1.5 bg-tertiary-fixed text-on-tertiary-fixed rounded font-semibold uppercase">ACTIVE</span>
               <span class="font-body-sm text-table-header text-outline truncate">Every screen reads this dealership</span>
             </div></div></div>`
      : `<div class="p-2.5 font-body-sm text-body-sm text-on-surface-variant">${esc(w.why)}</div>`;
    const extra = w.extra
      ? `<div class="p-2.5 font-body-sm text-table-header text-on-surface-variant">This account also belongs to ${esc(w.extra)} other ${w.extra === 1 ? 'dealership' : 'dealerships'}. This build answers as ${esc(w.dealership)} and cannot switch.</div>`
      : '';
    menu.innerHTML = currentRow + extra;
  }
}

/* ── The sidebar ─────────────────────────────────────────────────────────────
   Markup and classes are the master spec's (…--2b6343). Two rules carried over
   from the pre-Stitch sidebar, because they are about truth rather than looks:

   · Every nav row owns a badge span, `badge-<id>`, that lib/badges.js fills
     from v_needs_attention. The span exists from the start and is hidden with
     the legacy `.hide` (display:none !important) until there is a count.
   · Active and idle are two COMPLETE class strings, swapped whole. A class
     assembled from fragments is one Tailwind never generates
     (scripts/stitch-classes.mjs). */
const NAV_ROW = {
  idle:    'nx-nav-item w-full flex items-center justify-between px-space-sm py-1.5 rounded-lg text-inverse-on-surface hover:bg-surface-variant hover:text-on-surface transition-colors',
  active:  'nx-nav-item w-full flex items-center justify-between px-space-sm py-1.5 transition-colors bg-primary-container text-on-primary font-medium rounded-lg shadow-sm',
  roadmap: 'nx-nav-item w-full flex items-center justify-between px-space-sm py-1.5 rounded-lg opacity-60 text-inverse-on-surface hover:bg-surface-variant hover:text-on-surface transition-colors',
};
const MARK = {
  partial: '<span class="font-label-numeric-sm text-table-header text-tertiary-fixed whitespace-nowrap">◐ PARTIAL</span>',
  soon:    '<span class="font-label-numeric-sm text-table-header text-outline-variant whitespace-nowrap">○ COMING SOON</span>',
  planned: '<span class="font-label-numeric-sm text-table-header text-outline-variant whitespace-nowrap">◇ PLANNED</span>',
};
const rowClass = (item, active) => (active ? NAV_ROW.active : (item.roadmap ? NAV_ROW.roadmap : NAV_ROW.idle));

function navRow(item) {
  const a = el('a', rowClass(item, false));
  a.href = `#${item.id}`;
  a.dataset.screen = item.id;
  a.innerHTML = `<div class="flex items-center gap-space-sm min-w-0">
      <span class="material-symbols-outlined text-[18px]">${esc(item.icon)}</span>
      <span class="font-body-sm text-body-sm truncate">${esc(item.title)}</span></div>
    <span class="flex items-center gap-1.5 shrink-0">
      <span class="nx-nav-badge hide font-label-numeric-sm text-table-header bg-error text-on-error px-1.5 rounded font-bold" id="badge-${esc(item.id)}"></span>
      ${MARK[item.roadmap || item.mark] || ''}</span>`;
  a.addEventListener('click', e => { e.preventDefault(); go(item.id); });
  return a;
}

/* The collapsed "+N coming soon" row that ends a group. It is a real button
   (the export draws a div) so it can be reached and opened from the keyboard. */
function comingSoonRow(items) {
  const wrap = el('div', 'flex flex-col space-y-0.5');
  const toggle = el('button', 'w-full flex items-center justify-between px-space-sm py-1 rounded text-outline hover:text-inverse-on-surface cursor-pointer text-table-header font-table-header');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = `<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">expand_more</span>+${items.length} coming soon</span>
    <span class="text-label-numeric-sm font-label-numeric-sm">${items.some(i => i.roadmap === 'soon') ? '○' : '◇'}</span>`;
  const list = el('div', 'hide flex flex-col space-y-0.5');
  items.forEach(i => list.appendChild(navRow(i)));
  toggle.addEventListener('click', () => {
    const open = list.classList.contains('hide');
    list.classList.toggle('hide', !open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.querySelector('.material-symbols-outlined').textContent = open ? 'expand_less' : 'expand_more';
  });
  wrap.appendChild(toggle);
  wrap.appendChild(list);
  return { wrap, list, toggle };
}

const OPENERS = new Map();   // roadmap id -> opens its collapsed group

function buildNav() {
  const nav = $('nav');
  const bottom = $('navBottom');
  nav.innerHTML = '';
  if (bottom) bottom.innerHTML = '';
  OPENERS.clear();
  /* Kicked off here because buildNav() is the first thing the shell does once
     a session exists, so by the time the first screen has awaited its own reads
     this is normally already resolved and go() below does not wait at all. */
  paintTenantPill();
  loadTenant().then(paintTenantPill);
  NAV.forEach(group => {
    const live = group.items.filter(i => !i.roadmap && i.sidebar !== false);
    const soon = group.items.filter(i => i.roadmap);
    const wrap = el('div', 'flex flex-col space-y-0.5');
    if (group.group) {
      wrap.appendChild(el('div', 'px-space-sm py-1 font-table-header text-table-header uppercase text-outline tracking-wider flex items-center justify-between',
        `<span>${esc(group.group)}</span>${group.tag ? `<span class="font-label-numeric-sm text-table-header text-outline-variant">${esc(group.tag)}</span>` : ''}`));
    }
    live.forEach(i => wrap.appendChild(navRow(i)));
    if (soon.length) {
      const row = comingSoonRow(soon);
      soon.forEach(i => OPENERS.set(i.id, () => {
        if (row.list.classList.contains('hide')) row.toggle.click();
      }));
      wrap.appendChild(row.wrap);
    }
    ((group.bottom && bottom) ? bottom : nav).appendChild(wrap);
  });
}

/* Repaints which row is active. A roadmap row's collapsed group is opened so
   the active row is visible — otherwise a deep link to #tradein would leave the
   sidebar showing nothing selected. */
function paintActive(id) {
  document.querySelectorAll('.nx-nav-item').forEach(a => {
    const item = flatNav().find(i => i.id === a.dataset.screen);
    if (!item) return;
    const on = item.id === id;
    a.className = rowClass(item, on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  OPENERS.get(id)?.();
}

/* ── Render generation ──────────────────────────────────────────────────────
   Every call to go() is a render, and only the newest one owns #screen.

   A screen module is a long async function: it clears the host, paints
   skeletons, awaits four reads, then finishes painting. Navigate away in the
   middle of that and the old render is still running — it has not been
   cancelled, because nothing here could cancel it. It then does what every
   screen does after an await, and looks its own elements up again by global id.
   They are gone (go() emptied the host), so it gets null, and `null.innerHTML`
   throws. The rejection landed in the catch below, which wrote "Couldn't load
   this screen" into `host` — and `host` by then held the screen the operator
   had just navigated TO. Clicking Leads and then Inventory quickly enough
   blanked Inventory and blamed it for an error Leads had.

   The counter fixes the blast radius without touching a single screen: an error
   from a render that is no longer the current one is dropped. It is also
   exported, so a screen with a long tail of work can ask whether it is still
   the one on screen before it paints — `const gen = generation(); … if (stale(gen)) return;`

   The try/catch matters just as much and is easy to miss: the old line invoked
   SCREENS[id](host) BEFORE Promise.resolve() wrapped it, so a synchronous throw
   — a bad destructure at the top of a screen, a missing import — escaped the
   .catch() entirely and left a permanently blank page with no error state at
   all. Now both shapes of failure reach the same handler. */
let generation = 0;
const currentGeneration = () => generation;
const staleRender = g => g !== generation;

/* The one state where a screen must not be drawn at all.

   A member of no dealership is refused every tenant-scoped row by RLS, and the
   screens have no way to tell that apart from a dealership that has not started
   yet. They would report it the way they report emptiness: "There is no lead in
   the database at all", "Every unit in inventory is marked sold". Each of those
   is a fact about the account, rendered as a fact about the business.

   Drawn here, once, instead of asking fourteen screens to learn a rule that is
   not theirs. */
function stateNoTenant() {
  return `<div class="state err"><span class="material-symbols-outlined">domain_disabled</span>
    <h3>This account is not attached to a dealership</h3>
    <p>Every table in NEXUS OS is scoped to one dealership, and this sign-in belongs to none of them, so the
       database returns no leads, no inventory, no conversations and no deals to it. That is an unfinished
       account, not an empty business — nothing has been lost and nothing is shown here rather than showing
       zeros that would read as findings. Whoever set this account up needs to add it to a dealership
       (a <span class="mono">The account memberships</span> row) before any screen can say anything true.</p></div>`;
}

/* The navigation offers a screen this bundle does not contain.

   This is a real state, not a hypothetical one: the four Revenue Recovery
   engine screens are separate modules, app.js loads them by glob so that a
   module which has not landed cannot break the build, and lib/nav.js offers all
   five ids either way. What must not happen is the old behaviour — falling
   through to `overview` — because the operator then clicks Deal Rescue, lands
   on Overview, and has no way to tell whether they mis-clicked, whether the
   screen was removed, or whether the app is broken. Silently substituting a
   different screen for the one that was asked for is the navigation lying about
   what it did.

   Note what this state does NOT say. It says nothing about deals, leads,
   attribution or policy, and in particular it does not say there is no data:
   the module is absent, so nothing has been read and nothing can be claimed
   either way. This codebase has rendered "no rows" for "no code" before. */
function stateNotInBuild(id) {
  const title = flatNav().find(i => i.id === id)?.title || id;
  return `<div class="state"><span class="material-symbols-outlined">construction</span>
    <h3>${esc(title)} is not part of this build</h3>
    <p>The navigation offers this screen and no module in this bundle registers it, so there is nothing to render.
       That is a missing file, not an empty engine — nothing has been read here, so nothing is being claimed about
       what it would have shown. Every other screen is unaffected. If you are expecting this one, the deployment is
       behind the navigation and needs rebuilding.</p></div>`;
}

function go(id) {
  /* Two different misses, told apart deliberately. An id the navigation has
     never heard of is a stale bookmark or a typed hash, and the home screen is
     the right answer for it. An id the navigation DOES offer, whose module is
     absent, gets said out loud above. */
  if (!SCREENS[id] && !flatNav().some(i => i.id === id)) id = 'moneyleaks';
  current = id;
  location.hash = id;
  paintActive(id);
  /* The breadcrumb: dealership / group / screen. The group is the sidebar's,
     so a reader can find the screen again. */
  const item = flatNav().find(i => i.id === id);
  $('pageTitle').textContent = item?.title || 'NEXUS OS';
  const grp = $('crumbGroup');
  if (grp) grp.textContent = NAV.find(g => g.items.includes(item))?.group || 'NEXUS OS';
  /* lib/shell.js times the freshness chip from this: a new screen starts with
     nothing loaded, whatever the previous one had read. */
  window.dispatchEvent(new CustomEvent('nexus:navigate', { detail: { id } }));
  closeDrawer();
  const host = $('screen');
  host.innerHTML = '';
  const gen = ++generation;
  /* Dropped rather than reported when it is stale: the screen that failed is no
     longer on screen, and the one that is has done nothing wrong. */
  const fail = e => {
    if (staleRender(gen)) return;
    host.innerHTML = stateError('this screen', e);
  };
  const paint = () => {
    if (staleRender(gen)) return;
    if (hasNoTenant()) { host.innerHTML = stateNoTenant(); return; }
    /* Checked here rather than at the top of go() so that the title, the active
       nav item and the hash are all set first: the operator sees the screen they
       asked for, named, explaining itself — not a silent bounce elsewhere. */
    if (!SCREENS[id]) { host.innerHTML = stateNotInBuild(id); return; }
    host.innerHTML = '';
    try {
      Promise.resolve(SCREENS[id](host)).catch(fail);
    } catch (e) {
      fail(e);
    }
  };
  /* Normally already answered — buildNav() asked at boot — in which case this
     is the same synchronous path it always was. Only the first render of a cold
     tab waits, and only for one small indexed read; a screen that waited would
     have awaited four of its own anyway.

     A FAILED membership read does not wait and does not block: paint() only
     stops on hasNoTenant(), which is false unless the read succeeded and came
     back empty. The pill says the dealership is unknown; the screens carry on
     and report their own reads. */
  const s = tenantState();
  if (s.loaded) { paint(); return; }
  host.innerHTML = stateLoading(4);
  loadTenant().then(st => { paintTenantPill(); if (!staleRender(gen)) paint(); return st; }).catch(fail);
}

/* ── Drawer ──────────────────────────────────────────────────────────────── */

export { NAV, SCREENS, flatNav, current, buildNav, go, currentGeneration, staleRender, paintTenantPill, tenantWords };
