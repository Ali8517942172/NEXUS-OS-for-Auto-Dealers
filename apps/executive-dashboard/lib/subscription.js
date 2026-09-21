/* NEXUS OS — lib/subscription.js
   Added 21 Sep 2026 by NX1003, the migration that first made a dealer's own
   subscription visible to the dealer.

   WHAT THIS IS. The frontend half of TRIAL (30 days) -> GRACE (7 days) ->
   READ_ONLY, until Ali marks a dealership paid by hand. Modelled directly on
   lib/tenant.js: read the caller's own answer once per signed-in identity,
   hold it, and reset it on every identity change — for the same reason
   lib/tenant.js does. A dealer's commercial terms left in memory across a
   re-authentication on a shared showroom machine is the same class of leak
   lib/tenant.js was written to close for membership.

   WHAT THIS IS NOT. It is not the enforcement. public.nexus_my_subscription()
   REPORTS `access`; it does not gate a single write anywhere in the database.
   The actual backstop against a read-only dealership writing anyway is
   lib/data.js's writeGuard, registered below — every dbWrite() and n8n() call
   in the app passes through it. What THIS file adds on top is the part a
   database function cannot: telling the dealer, on every screen, before they
   click, rather than after the request comes back refused. Disabling the
   button is UX; the guard in lib/data.js is what actually stops the write.

   FAIL OPEN, DELIBERATELY, same as lib/tenant.js. A subscription read that
   has not happened yet, or that failed, must never lock every write button in
   the app -- a network blip is not a billing decision, and locking on an
   unknown answer would turn "we could not check" into "we are refusing you",
   which is a much larger claim than this file is entitled to make. Only a
   read that SUCCEEDED and came back access = 'read_only' locks anything. */
import { db, onIdentityChange, setWriteGuard } from './data.js';
import { requestFailure } from './errors.js';

const READ_PATH = 'rpc/nexus_my_subscription';

const EMPTY = { loaded: false, ok: false, row: null, error: null };
let STATE = EMPTY;
let inflight = null;

/* One read per signed-in identity, same caching shape as lib/tenant.js's
   loadTenant() and for the same reason: several screens (the shell banner,
   the Subscription screen itself, every write-button sweep) want the same
   answer within the same second, not a fresh network round trip each. */
function loadSubscription() {
  if (STATE.loaded && STATE.ok) return Promise.resolve(STATE);
  if (inflight) return inflight;
  inflight = db(READ_PATH)
    .then(rows => {
      const row = Array.isArray(rows) ? (rows[0] || null) : null;
      STATE = { loaded: true, ok: true, row, error: null };
      inflight = null;
      sweepWriteLocks();
      return STATE;
    })
    .catch(e => {
      /* Not cached -- a failed read must not stick a stale "unknown" answer
         across a whole session the way a cached failure would. */
      STATE = { loaded: true, ok: false, row: null, error: String(e?.message || e).slice(0, 180) };
      inflight = null;
      return STATE;
    });
  return inflight;
}

const subscriptionState = () => STATE;

/* Forces the next loadSubscription() to hit the network rather than hand back
   a cached success -- what the refresh button needs, for the same reason
   refreshBadges() exists beside go(current): "refresh" has to mean "go read
   it again", not "tell me what you already knew". */
function refreshSubscription() {
  STATE = EMPTY;
  inflight = null;
  return loadSubscription().then(paintSubscriptionBanner);
}

/* The three predicates a screen actually needs. Every one answers false on an
   unread, failed, or empty state -- unknown is never read-only, exactly as
   lib/data.js's membership predicates never read an unknown role as "no". */
const accessOf = () => (STATE.loaded && STATE.ok && STATE.row) ? String(STATE.row.access || '') : null;
const isReadOnly = () => accessOf() === 'read_only';
const isGrace    = () => accessOf() === 'grace';
const isTrial    = () => STATE.loaded && STATE.ok && STATE.row && String(STATE.row.status) === 'TRIAL';

onIdentityChange(() => { STATE = EMPTY; inflight = null; sweepWriteLocks(); });

/* ── The hard backstop ───────────────────────────────────────────────────
   Registered once, at import time (app.js imports this module unconditionally
   at boot), so it is live before the first screen can render a write button.
   See the long comment on writeGuard in lib/data.js for why this is a
   registration rather than an import in the other direction. */
setWriteGuard(() => (isReadOnly()
  ? requestFailure('readOnly', { technical: 'blocked client-side: nexus_my_subscription().access = read_only' })
  : null));

/* ── The soft paywall: disable every write button, app-wide, with no screen
   needing to know this file exists ─────────────────────────────────────────
   `.btn.primary` is the app's own convention for a button that WRITES —
   verified against every screen that calls dbWrite()/n8n(): Approve, Record
   rejection, Add Lead, Record, Approve/Reject/Defer, Convert, Send. A
   navigation button (`linkBtn` in screens/channels.js and elsewhere) is
   always `.btn.sm` without `.primary`; Cancel/ghost buttons are `.btn.ghost`.
   Locking that one class, everywhere, disables every write surface in the
   app without editing any of the ~20 screens that create one.

   Buttons are painted asynchronously — a panel's own promise resolves after
   the screen function returns, and a drawer or modal opens later still on a
   click — so a single sweep right after go() renders would miss most of
   them. A MutationObserver on #app and #drawer, sweeping on every DOM change,
   catches a button the moment it exists rather than only the ones that
   existed at mount. */
const LOCK_MSG = 'This dealership is read-only until a payment is recorded. Open Subscription to see why, and reads keep working while you sort it out.';

function lockButton(btn) {
  if (btn.dataset.nxLocked === '1') return;
  btn.dataset.nxLocked = '1';
  btn.dataset.nxPrevTitle = btn.title || '';
  btn.disabled = true;
  btn.title = LOCK_MSG;
}
function unlockButton(btn) {
  if (btn.dataset.nxLocked !== '1') return;
  btn.disabled = false;
  btn.title = btn.dataset.nxPrevTitle || '';
  delete btn.dataset.nxLocked;
  delete btn.dataset.nxPrevTitle;
}

function sweepWriteLocks() {
  const nodes = document.querySelectorAll('#screen .btn.primary, #drawer .btn.primary');
  if (isReadOnly()) nodes.forEach(lockButton);
  else nodes.forEach(unlockButton);
}

let observing = false;
function startWriteLockObserver() {
  if (observing) return;
  observing = true;
  const screenHost = document.getElementById('screen');
  const drawerHost = document.getElementById('drawer');
  const mo = new MutationObserver(() => sweepWriteLocks());
  if (screenHost) mo.observe(screenHost, { childList: true, subtree: true });
  if (drawerHost) mo.observe(drawerHost, { childList: true, subtree: true });
  sweepWriteLocks();
}

/* ── The shell banner: trial / grace / read-only, on every screen ─────────
   Painted into #subBanner, a fixed element in index.html sitting between the
   topbar and the screen content -- not inside #screen, so it survives every
   navigation and every screen's own re-render without any screen having to
   carry it. Silent (hidden) once a dealership is ACTIVE/PAST_DUE and not
   close to a boundary: a banner that is always on screen is one nobody reads
   by the second week. */
function bannerHtml(s) {
  if (!s.loaded) return '';
  if (!s.ok) {
    return `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">warning</span>
      <div><strong>Subscription status could not be read</strong> (${escapeHtml(s.error || 'no reason given')}).
      Nothing is being restricted because of this on its own -- an unread check is not a read-only dealership.</div></div>`;
  }
  const r = s.row;
  if (!r) return '';
  const days = r.days_left;
  const openSub = `<button class="btn sm ghost" data-nx-open-subscription>Open Subscription</button>`;
  if (r.access === 'read_only') {
    return `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">lock</span>
      <div style="flex:1"><strong>This dealership is read-only.</strong>
      ${escapeHtml(r.evidence || '')}</div></div>`.replace('</div></div>', `</div>${openSub}</div>`);
  }
  if (r.access === 'grace') {
    return `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">hourglass_bottom</span>
      <div style="flex:1"><strong>Grace period${days != null ? ` — ${days} day${days === 1 ? '' : 's'} left` : ''}.</strong>
      ${escapeHtml(r.evidence || '')}</div></div>`.replace('</div></div>', `</div>${openSub}</div>`);
  }
  if (r.status === 'TRIAL') {
    return `<div class="banner info"><span class="material-symbols-outlined" style="font-size:20px">redeem</span>
      <div style="flex:1"><strong>Free trial${days != null ? ` — ${days} day${days === 1 ? '' : 's'} left` : ''}.</strong>
      ${escapeHtml(r.evidence || '')}</div></div>`.replace('</div></div>', `</div>${openSub}</div>`);
  }
  if (r.status === 'PAST_DUE') {
    return `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">error</span>
      <div style="flex:1"><strong>Payment did not arrive.</strong> ${escapeHtml(r.evidence || '')}</div></div>`
      .replace('</div></div>', `</div>${openSub}</div>`);
  }
  return '';
}
function escapeHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function paintSubscriptionBanner() {
  const host = document.getElementById('subBanner');
  if (!host) return;
  const html = bannerHtml(STATE);
  host.innerHTML = html;
  host.classList.toggle('hide', !html);
  const openBtn = host.querySelector('[data-nx-open-subscription]');
  /* location.hash rather than importing lib/nav.js's go(): lib/nav.js already
     listens for hashchange and calls go() with it, and this file staying
     independent of lib/nav.js avoids the two modules importing each other --
     lib/nav.js's own tenant pill takes the same route into lib/tenant.js. */
  if (openBtn) openBtn.addEventListener('click', () => { location.hash = 'subscription'; });
}

export {
  loadSubscription, subscriptionState, refreshSubscription, accessOf, isReadOnly, isGrace, isTrial,
  startWriteLockObserver, sweepWriteLocks, paintSubscriptionBanner,
};
