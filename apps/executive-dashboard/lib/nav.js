/* NEXUS OS — lib/nav.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { $, el } from './dom.js';
import { esc } from './format.js';
import { stateError } from './states.js';
import { closeDrawer } from './ui.js';

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

function buildNav() {
  const nav = $('nav');
  nav.innerHTML = '';
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
  try {
    Promise.resolve(SCREENS[id](host)).catch(fail);
  } catch (e) {
    fail(e);
  }
}

/* ── Drawer ──────────────────────────────────────────────────────────────── */

export { NAV, SCREENS, flatNav, current, buildNav, go, currentGeneration, staleRender };
