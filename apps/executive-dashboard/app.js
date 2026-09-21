/* ============================================================================
   NEXUS OS — dashboard entry point

   Fourteen screens, all rendered from live Supabase data and live n8n webhooks.

   Two rules run through this whole app:
     1. Never invent a row. If a fetch fails the panel says so. An operator
        cannot tell a fabricated HOT lead from a real one, and acting on a fake
        one is worse than seeing nothing.
     2. Never render a number the database did not produce. No hardcoded KPI
        deltas, no placeholder rows, no "example" data.

   Layout (split out of a single 117 KB app.js on 17 Aug 2026, so that screens
   can be worked on one file at a time instead of every change colliding in the
   same file):

     lib/      shared plumbing — env, dom, format, states, data, nav, ui, modal,
               and the three big shared forms (lead drawer, unit form, deal form)
     screens/  one module per screen. Each registers itself into the SCREENS
               registry from lib/nav.js on import; this file imports them purely
               for that side effect, which is why the imports look unused.
     app.js    environment check, auth, boot. Nothing screen-specific.
   ========================================================================== */
import './styles.css';
/* The design-system layer, imported AFTER styles.css so its scoped upgrades sit
   later in the cascade. It is additive: every token is `--ds-` and every class
   `.ds-`, and the handful of rules that restyle existing chrome are gated on
   `.ds-screen`, which only a converted screen sets on its host. Importing it
   changes the rendering of no screen that has not asked for it. */
import './lib/design-system.css';

import { $ } from './lib/dom.js';
import { esc, initials } from './lib/format.js';
import { envErrors } from './lib/env.js';
import { ME, SESSION, db, myRole, sessionEnded, setMe, setMeReadFailed, setMembership, setSession, setSessionEndedHandler, supabase } from './lib/data.js';
import { loadSubscription, paintSubscriptionBanner, refreshSubscription, startWriteLockObserver } from './lib/subscription.js';
import { buildNav, current, go } from './lib/nav.js';
import { loadPlatformAdmin } from './lib/platform.js';
import { closeDrawer } from './lib/ui.js';
import { applyDensity } from './lib/prefs.js';
import { refreshBadges, startBadges, stopBadges } from './lib/badges.js';

/* Screen modules, imported for their registration side effect only. Removing
   one of these lines silently removes that screen from the app. */
import './screens/actions.js';
import './screens/appointments.js';
import './screens/ask.js';
import './screens/automation.js';
import './screens/campaigns.js';
import './screens/channels.js';
import './screens/competitors.js';
import './screens/compliance.js';
import './screens/conversations.js';
import './screens/customers.js';
import './screens/deals.js';
import './screens/finance.js';
/* Founder Console. Registers screens.founder, and is what makes lib/nav.js's
   NAV entry for it something other than a dead link -- see the long comment
   above that entry for why the button itself is still gated separately. */
import './screens/founder.js';
import './screens/inventory.js';
/* Lead Sources is a plain static import, not part of the import.meta.glob
   block below: that block exists for the five Revenue Recovery engine
   modules, which may legitimately not have landed yet. This one is on disk,
   so it is listed here with the rest — and removing this line removes the
   screen from the app exactly as it does for every other. */
import './screens/lead-sources.js';
import './screens/leads.js';
import './screens/overview.js';
/* Record a Lead. A plain static import like the rest: the file is on disk, and
   removing this line removes from the app the only surface through which a
   walk-in or a phone call can be entered at all. */
import './screens/record-lead.js';
import './screens/revenue.js';
import './screens/settings.js';
import './screens/subscription.js';
import './screens/setup.js';
import './screens/team.js';

/* ── The Revenue Recovery engine screens ────────────────────────────────────
   Lead Recovery, Deal Rescue, Attribution and Policy are being built as four
   separate modules. lib/nav.js offers all four ids whether or not every module
   has landed yet, and a plain `import './screens/policy.js'` for a file that
   does not exist is not a missing screen — it is a build failure that takes the
   ENTIRE dashboard down, every one of the sixteen screens with it. Trading
   fifteen working screens for one that is not written yet is never the right
   trade.

   import.meta.glob resolves at build time against the files that are actually
   on disk, so a module that has not landed is simply absent from the bundle and
   the build succeeds; `eager: true` makes each match a static import, which is
   exactly what the fifteen lines above are, so a screen that IS present
   registers itself identically and at the same moment.

   The patterns are listed one per screen rather than as a wildcard on purpose:
   a wildcard would silently pick up anything dropped into screens/, and this
   file is meant to be the readable list of what the app contains. Removing a
   line here removes that screen from the app, exactly as above.

   The value is deliberately unused — like the imports above, this is for the
   registration side effect only. lib/nav.js renders an explicit "not part of
   this build" state for an id whose module never arrived. */
import.meta.glob([
  './screens/money-leaks.js',
  './screens/attribution.js',
  './screens/lead-recovery.js',
  './screens/deal-rescue.js',
  './screens/policy.js',
], { eager: true });

/* ==========================================================================
   Auth + boot
   ========================================================================== */
/* The sub-line under the sign-in form named the identity supplier until 5 Sep
   2026 ("Accounts are managed in Supabase Auth") — on the one card that
   renders to a reader who is not signed in and may not be a customer at all.
   Which supplier holds the password is NEXUS's implementation; who to ask for
   an account is the reader's half. The note is a JS comment rather than an
   HTML one on purpose: an HTML comment inside this template is shipped into
   the page and readable with View Source, which is not a smaller audience. */
function renderLogin(msg) {
  $('boot').classList.remove('hide');
  $('app').classList.add('hide');
  $('boot').innerHTML = `
    <div class="card login-card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
        <div class="brand-mark">N</div><div class="brand-name">NEXUS OS</div>
      </div>
      ${msg ? `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">error</span><div>${esc(msg)}</div></div>` : ''}
      <div class="grid" style="gap:14px">
        <div class="field"><label for="li">Email</label><input type="email" id="li" autocomplete="username" /></div>
        <div class="field"><label for="lp">Password</label><input type="password" id="lp" autocomplete="current-password" /></div>
        <button class="btn primary" id="lgo">Sign in</button>
      </div>
      <div class="cell-sub" style="margin-top:14px">Accounts are created by NEXUS. Ask NEXUS support to add one, or to reset a password.</div>
    </div>`;
  const go2 = async () => {
    const btn = $('lgo'); btn.disabled = true; btn.textContent = 'Signing in…';
    const { error } = await supabase.auth.signInWithPassword({ email: $('li').value.trim(), password: $('lp').value });
    if (error) { renderLogin(error.message); return; }
    boot();
  };
  $('lgo').addEventListener('click', go2);
  $('lp').addEventListener('keydown', e => { if (e.key === 'Enter') go2(); });
}

/* lib/data.js drops the session and needs the login screen back, but it must
   not import this module — that is the cycle. Hand it the function instead.

   Stopping the badge poller is part of ending the session and belongs here, at
   the one place that knows a session has ended: left running, it polls every
   sixty seconds with a dead token, and each 401 re-rendered this login screen
   under whoever was typing into it. lib/data.js makes sure this handler runs
   once per expiry however many requests hit the 401 together. */
setSessionEndedHandler(msg => { stopBadges(); renderLogin(msg); });

async function boot() {
  if (envErrors.length) {
    /* ── The boundary, inverted, and put back the right way up ─────────────
       Until 5 Sep 2026 this card printed each `envErrors` string — which
       begins with the build-time VARIABLE NAME — and then said "Fix these
       environment variables in Vercel, then redeploy."

       Three things were wrong with that, and only the third is about vendor
       names. It named the hosting supplier. It named NEXUS's own deployment
       configuration. And it issued an instruction to a reader who cannot
       carry it out: a dealership has no login to that account, no build to
       redeploy, and this is the FIRST card they ever see — it renders before
       the login form, so the person reading it may not even be signed in.
       An unactionable instruction on a dead screen reads as "you have broken
       this", which is the opposite of true.

       What is theirs: the dashboard will not start, their data is untouched,
       and the fix is a phone call. What is ours goes to the console, where a
       support call can retrieve it, and is not painted. */
    console.error('[NEXUS] This deployment is missing configuration it needs:', envErrors.join(' | '));
    $('boot').innerHTML = `<div class="card login-card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
        <div class="brand-mark">N</div><div class="brand-name">NEXUS OS</div>
      </div>
      <div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">error</span>
        <div>NEXUS cannot start on this installation.</div></div>
      <div class="cell-sub" style="margin-top:14px">A setting NEXUS needs in order to reach your data was not
        supplied when this dashboard was installed, so no screen would be able to load anything and none is
        offered. Nothing has happened to your data, and nothing has been lost.</div>
      <div class="cell-sub" style="margin-top:10px">This is not something that can be corrected from this screen,
        from this browser, or by signing in. Contact NEXUS support &mdash; the details they need are already
        recorded.</div></div>`;
    return;
  }

  const { data } = await supabase.auth.getSession();
  setSession(data.session);
  if (!SESSION) { renderLogin(); return; }

  /* Keep SESSION in step with the client's own refresh cycle. Without this the
     app holds the boot-time token forever and starts 401-ing after an hour. */
  supabase.auth.onAuthStateChange((event, session) => {
    setSession(session);
    if (!session && event !== 'INITIAL_SESSION') sessionEnded();
  });

  /* `.catch(() => null)` made ME === null mean two different things: "this
     account genuinely has no row in `users`" and "the read failed". Settings
     believed the first and said so three times — a warm banner, a phone
     explanation, and a WARNING in its alert strip, all asserting the staff
     record does not exist when the query had merely died. Keep the failure so
     the difference is expressible. */
  try {
    setMe(await db(`users?select=*&email=eq.${encodeURIComponent(SESSION.user.email)}`).then(r => r[0] || null));
    setMeReadFailed(null);
  } catch (e) {
    setMe(null);
    setMeReadFailed(String(e.message || e).slice(0, 160));
  }

  /* Account authority, read from the same table the database's own inventory
     and leads policies read. `users.role` above is a job title and decides
     nothing; this decides what the screens offer. tenant_members carries a
     self-read policy, so this returns only this account's own row(s).

     A FAILED read leaves membership unknown rather than empty, and unknown
     means the screens keep offering the action and let the database answer.
     Hiding a button on a failed read would tell an owner they are not one. */
  try {
    setMembership(await db('tenant_members?select=tenant_id,role,staff_user_id'));
  } catch {
    setMembership(null);
  }

  /* The subscription read and its banner. Not awaited: a slow or failed read
     must not hold the whole app off screen, the same reasoning as the
     membership read above. loadSubscription() paints nothing itself; the
     banner and the write-lock sweep both run off its resolution. */
  loadSubscription().then(paintSubscriptionBanner);
  startWriteLockObserver();

  /* Whether THIS account is the NEXUS founder, not a dealership question at
     all -- read from public.nexus_is_platform_admin(), never guessed from
     role or email. Awaited here, before buildNav(), for the same reason the
     membership read above is: buildNav() decides the Founder Console button's
     presence synchronously, and a founder who has to refresh once to see
     their own console is a worse morning than one extra await at boot.
     loadPlatformAdmin() never throws -- an unreadable answer resolves to
     "no", which is the fail-closed default lib/platform.js documents. */
  await loadPlatformAdmin();

  $('boot').classList.add('hide');
  $('app').classList.remove('hide');
  $('userInitials').textContent = initials(ME?.name || SESSION.user.email);
  $('userName').textContent = ME?.name || SESSION.user.email;
  /* Two different facts, and the header used to show only the first. The job
     title says what this person does; the account role says what the product
     will let them do, and it is the one that explains a refused action. */
  $('userRole').textContent = [ME?.role, myRole()].filter(Boolean).join(' · ') || 'signed in';

  buildNav();
  applyDensity();
  $('signOutBtn').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });
  /* Refresh means "tell me the truth right now", so it re-reads the badges as
     well as the screen. Re-rendering the screen alone would leave the sidebar
     asserting a number the operator just asked to have re-checked. */
  $('refreshBtn').addEventListener('click', () => { go(current); refreshBadges(); refreshSubscription(); });
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== current) go(h); });

  const conn = $('connState');
  /* The failure branch used to paint the first 40 characters of the error into
     the header pill, on every screen, permanently. Those 40 characters are
     whatever the data layer said — a PostgREST code, a relation name, a
     permission-denied naming a table — and a truncated one at that, so the
     reader got a fragment of our schema and no idea what to do. The pill has
     room for the state; the tooltip carries the dealership's half, and the
     diagnostic goes to the console for NEXUS. */
  db('leads?select=id&limit=1')
    .then(() => { conn.className = 'pill ok'; conn.title = 'The dashboard is reading your live data.'; conn.innerHTML = '<span class="dot"></span>Live'; })
    .catch(e => {
      console.error('[NEXUS] connection check failed:', e && e.message);
      conn.className = 'pill hot';
      conn.title = 'The dashboard cannot reach your data right now, so any screen that loads may be incomplete or empty. '
        + 'Refresh once; if it stays this way, contact NEXUS support.';
      conn.innerHTML = '<span class="dot"></span>No connection';
    });

  /* Started after the nav exists — the badges write into spans lib/nav.js
     creates — and before the first screen renders, so the sidebar is already
     truthful by the time anything is on screen. Failures inside are swallowed
     by design: a badge that cannot be computed must not stop the app booting. */
  startBadges();

  /* The default landing screen. Changed from 'overview' to 'moneyleaks' on
     6 Sep 2026: LAUNCH.md names Today's Money Leaks "the primary owner view",
     and it is the only screen that answers a question rather than reporting a
     state. Only the FALLBACK moved — a hash still wins, so every existing
     bookmark and every deep link lands exactly where it did before, and
     lib/nav.js holds the same id so the two cannot drift. */
  go(location.hash.slice(1) || 'moneyleaks');
}

boot();
