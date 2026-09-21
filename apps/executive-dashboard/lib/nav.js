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
    /* ── Today's Money Leaks ─────────────────────────────────────────────────
       First, and the app's default landing screen, because it is the only one
       that answers a question rather than reporting a state: where is money
       leaking right now, and what should be done about it. LAUNCH.md names it
       "the primary owner view".

       It sits ABOVE Overview rather than inside Revenue recovery on purpose.
       Revenue recovery is the group of engines and Revenue Recovery is their
       ledger, engine by engine; this screen is the morning order of work
       assembled across all of them, and a reader looking for "what do I do
       today" should not have to know which engine owns their problem. */
    { id:'moneyleaks',    title:"Today's Money Leaks", icon:'water_drop' },
    { id:'overview',      title:'Overview',        icon:'dashboard' },
    { id:'leads',         title:'Leads',           icon:'person_search' },
    /* ── Record a Lead ───────────────────────────────────────────────────────
       Added 18 Sep 2026, directly under Leads, because it is the only screen in
       the product through which a PERSON can put an enquiry in — and at this
       dealership that is the only lead path that works at all. Measured the day
       it was built: `lead_event` holds one row in its entire life, the two
       active ingest endpoints (`phone_call`, `walk_in`) are both manual with no
       provider behind either, and the four automatic ones are disabled.

       It sits in Work rather than beside Setup on purpose. Setup is read once
       and never again; this is the thing a salesperson does with a customer
       standing in front of them, several times a day, and a door that is not in
       the walking route is a door nobody opens. The dialog behind it already
       existed in lib/manual-lead-form.js and was reachable only from a button
       in the Leads filter bar, which is where it went unused. */
    { id:'recordlead',    title:'Record a Lead',   icon:'edit_note' },
    /* Lead Sources sits directly under Leads because it answers the question
       that screen cannot: not who enquired, but which door they came through,
       how much of that origin NEXUS could verify, and what arrived and was
       then lost before anybody saw it. */
    { id:'leadsources',   title:'Lead Sources',    icon:'alt_route' },
    { id:'channels',      title:'Channels',        icon:'hub' },
    { id:'conversations', title:'Conversations',   icon:'forum' },
    /* Appointments sits under Conversations because that is where a visit is
       arranged and this is the only screen that says what became of it. It
       renders the six words a showroom visit can be in separately and never
       averages them: asked, offered and agreed are three different facts and
       only the third is a booking. NX995 built the tables; until this screen
       there was nothing that could read them. */
    { id:'appointments',  title:'Appointments',    icon:'event' },
    { id:'compliance',    title:'Compliance',      icon:'verified_user' },
  ]},
  /* ── Revenue Recovery ────────────────────────────────────────────────────
     PRODUCT.md's thesis in one group: find where money is leaking, decide the
     next best action, execute it, and measure what came back. Revenue Recovery
     is the aggregate — the screen an owner opens first — and the four beneath
     it are the individual engines it summarises, in the order the money moves:
     the lead, then the deal, then the attribution of whatever the deal
     produced, then the rules all three of them apply.

     It sits above Assets rather than inside Operations because Operations is
     where work is carried out and this group is where the case for doing that
     work is made.

     THE FOUR ENGINE SCREENS ARE SEPARATE MODULES AND MAY NOT ALL BE PRESENT.
     They are offered here regardless, on purpose: a navigation that hides a
     screen when its module is missing gives the operator no way to tell a
     feature that does not exist from one that failed to load, and app.js loads
     them by glob precisely so a module that has not landed cannot break the
     build. go() below renders an explicit "not in this build" state for an id
     the registry does not hold. */
  { group: 'Revenue recovery', items: [
    { id:'revenue',      title:'Revenue Recovery', icon:'savings' },
    { id:'leadrecovery', title:'Lead Recovery',    icon:'restore' },
    { id:'dealrescue',   title:'Deal Rescue',      icon:'handyman' },
    { id:'attribution',  title:'Attribution',      icon:'hub' },
    { id:'policy',       title:'Policy',           icon:'gavel' },
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
    /* The Action Center. It sits at the top of Operations because it is the only
       screen in the app where a person is expected to answer something rather
       than read something: everything on it is waiting on a decision. */
    { id:'actions',    title:'Action Center', icon:'task_alt' },
    { id:'campaigns',  title:'Campaigns', icon:'campaign' },
    { id:'deals',      title:'Deals',     icon:'handshake' },
    { id:'automation', title:'Automation', icon:'account_tree' },
    { id:'team',       title:'Team',       icon:'groups' },
  ]},
  { group: '', items: [
    /* ── Setup ───────────────────────────────────────────────────────────────
       Added 14 Sep 2026. It sits beside Settings, at the bottom and outside
       every working group, because it is not a screen anybody works from: it
       is read once at the beginning of a dealership's life and then, ideally,
       never again. Putting it at the top would give a dealership that is
       already running a permanent reminder of a job it finished months ago.

       An owner who has NOT finished is not expected to find it here. The banner
       at the top of Today's Money Leaks brings them to it, and it renders only
       while something is still outstanding. */
    { id:'setup',        title:'Setup',        icon:'rocket_launch' },
    { id:'subscription', title:'Subscription', icon:'workspace_premium' },
    { id:'settings',     title:'Settings',     icon:'settings' },
  ]},
];
const SCREENS = {};
const flatNav = () => NAV.flatMap(g => g.items);

/* The screen the app opens on. Kept in step with app.js, which passes the same
   id to go() when there is no hash to honour. */
let current = 'moneyleaks';

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

export { NAV, SCREENS, flatNav, current, buildNav, go, currentGeneration, staleRender, paintTenantPill };
