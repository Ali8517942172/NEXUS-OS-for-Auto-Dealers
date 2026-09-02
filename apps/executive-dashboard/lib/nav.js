/* NEXUS OS — lib/nav.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { $, el } from './dom.js';
import { esc } from './format.js';
import { stateError, stateLoading } from './states.js';
import { closeDrawer } from './ui.js';
import { extraTenants, hasNoTenant, loadTenant, tenantLabel, tenantState } from './tenant.js';

const NAV = [
  { group: 'Work', items: [
    { id:'overview',      title:'Overview',        icon:'dashboard' },
    { id:'leads',         title:'Leads',           icon:'person_search' },
    { id:'conversations', title:'Conversations',   icon:'forum' },
    { id:'compliance',    title:'Compliance',      icon:'verified_user' },
  ]},
  { group: 'Assets', items: [
    { id:'inventory',   title:'Inventory',   icon:'directions_car' },
    { id:'competitors', title:'Competitors', icon:'trending_up' },
  ]},
  { group: 'Intelligence', items: [
    { id:'ask',      title:'Ask AI',        icon:'auto_awesome' },
    { id:'finance',  title:'Finance Desk',  icon:'calculate' },
    { id:'customers',title:'Customer 360',  icon:'contacts' },
  ]},
  { group: 'Operations', items: [
    { id:'campaigns',  title:'Campaigns', icon:'campaign' },
    { id:'deals',      title:'Deals',     icon:'handshake' },
    { id:'automation', title:'Automation', icon:'account_tree' },
    { id:'team',       title:'Team',       icon:'groups' },
  ]},
  { group: '', items: [
    { id:'settings', title:'Settings', icon:'settings' },
  ]},
];
const SCREENS = {};
const flatNav = () => NAV.flatMap(g => g.items);

let current = 'overview';

/* ── Which dealership is this? ───────────────────────────────────────────────
   Until 2 Sep 2026 there was one dealership and the question had no answer
   because it had no meaning. It has both now, and a signed-in user could still
   not see it anywhere on any of the fourteen screens.

   It goes in the topbar rather than the sidebar brand because the brand names
   the PRODUCT — the sidebar says NEXUS OS to every customer — and this names
   whose rows are underneath the page title. It reuses the existing `.pill`, so
   no stylesheet changes and it sits with the connection pill, which is the
   other thing on the page that describes the session rather than the data.

   It never renders a guess. Not-loaded, failed and unknown each get their own
   words, because "—" beside a dealership name reads as a dealership called
   "—", and this codebase has shipped that class of caption before. */
function tenantPill() {
  const bar = document.querySelector('.topbar');
  if (!bar) return null;
  let pill = $('tenantState');
  if (!pill) {
    pill = el('div', 'pill', '<span class="dot"></span>…');
    pill.id = 'tenantState';
    const conn = $('connState');
    if (conn && conn.parentNode === bar) bar.insertBefore(pill, conn);
    else bar.appendChild(pill);
  }
  return pill;
}

function paintTenantPill() {
  const pill = tenantPill();
  if (!pill) return;
  const s = tenantState();
  if (!s.loaded) {
    pill.className = 'pill';
    pill.innerHTML = '<span class="dot"></span>Checking account…';
    pill.title = 'Reading which dealership this account belongs to.';
    return;
  }
  if (!s.ok) {
    pill.className = 'pill warm';
    pill.innerHTML = '<span class="dot"></span>Dealership unknown';
    pill.title = `The membership read failed (${s.error}), so this page cannot say which dealership the rows below belong to. `
      + 'It is not a claim that they belong to none — the screens still read whatever the database allows this account to read.';
    return;
  }
  if (hasNoTenant(s)) {
    pill.className = 'pill hot';
    pill.innerHTML = '<span class="dot"></span>No dealership';
    pill.title = 'This account is not a member of any dealership, so every tenant-scoped table reads back empty for it.';
    return;
  }
  const label = tenantLabel(s);
  const extra = extraTenants(s);
  pill.className = 'pill vip';
  pill.innerHTML = `<span class="dot"></span>${esc(label || 'Dealership')}`;
  pill.title = label
    ? `Every figure on every screen is scoped to ${label}. Rows belonging to any other dealership are refused by the database, not filtered here.`
      + (extra
        ? ` This account is also a member of ${extra} other ${extra === 1 ? 'dealership' : 'dealerships'}; the database answers as ${label} and this build has no way to switch, so nothing from the ${extra === 1 ? 'other one' : 'others'} appears anywhere.`
        : '')
    : 'The dealership this account belongs to has a membership row but no readable name.';
}

function buildNav() {
  const nav = $('nav');
  nav.innerHTML = '';
  /* Kicked off here because buildNav() is the first thing the shell does once
     a session exists, so by the time the first screen has awaited its own reads
     this is normally already resolved and go() below does not wait at all. */
  paintTenantPill();
  loadTenant().then(paintTenantPill);
  NAV.forEach(group => {
    const wrap = el('div', 'nav-group');
    if (group.group) wrap.appendChild(el('div', 'nav-group-label', esc(group.group)));
    group.items.forEach(item => {
      const b = el('button', 'nav-item', `<span class="material-symbols-outlined">${item.icon}</span><span>${esc(item.title)}</span><span class="nav-badge hide" id="badge-${item.id}"></span>`);
      b.dataset.screen = item.id;
      b.addEventListener('click', () => go(item.id));
      wrap.appendChild(b);
    });
    nav.appendChild(wrap);
  });
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
       (a <span class="mono">tenant_members</span> row) before any screen can say anything true.</p></div>`;
}

function go(id) {
  if (!SCREENS[id]) id = 'overview';
  current = id;
  location.hash = id;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.screen === id));
  $('pageTitle').textContent = flatNav().find(i => i.id === id)?.title || 'NEXUS OS';
  closeDrawer();
  const host = $('screen');
  host.innerHTML = '';
  const gen = ++generation;
  /* Dropped rather than reported when it is stale: the screen that failed is no
     longer on screen, and the one that is has done nothing wrong. */
  const fail = e => {
    if (staleRender(gen)) return;
    host.innerHTML = stateError('this screen', (e && e.message) || String(e));
  };
  const paint = () => {
    if (staleRender(gen)) return;
    if (hasNoTenant()) { host.innerHTML = stateNoTenant(); return; }
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

export { NAV, SCREENS, flatNav, current, buildNav, go, currentGeneration, staleRender, paintTenantPill };
