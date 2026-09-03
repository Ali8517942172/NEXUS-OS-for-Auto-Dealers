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

import { $ } from './lib/dom.js';
import { esc, initials } from './lib/format.js';
import { envErrors } from './lib/env.js';
import { ME, SESSION, db, sessionEnded, setMe, setMeReadFailed, setSession, setSessionEndedHandler, supabase } from './lib/data.js';
import { buildNav, current, go } from './lib/nav.js';
import { closeDrawer } from './lib/ui.js';
import { applyDensity } from './lib/prefs.js';
import { refreshBadges, startBadges, stopBadges } from './lib/badges.js';

/* Screen modules, imported for their registration side effect only. Removing
   one of these lines silently removes that screen from the app. */
import './screens/actions.js';
import './screens/ask.js';
import './screens/automation.js';
import './screens/campaigns.js';
import './screens/competitors.js';
import './screens/compliance.js';
import './screens/conversations.js';
import './screens/customers.js';
import './screens/deals.js';
import './screens/finance.js';
import './screens/inventory.js';
import './screens/leads.js';
import './screens/overview.js';
import './screens/revenue.js';
import './screens/settings.js';
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
  './screens/attribution.js',
  './screens/lead-recovery.js',
  './screens/deal-rescue.js',
  './screens/policy.js',
], { eager: true });

/* ==========================================================================
   Auth + boot
   ========================================================================== */
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
      <div class="cell-sub" style="margin-top:14px">Accounts are managed in Supabase Auth.</div>
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
    $('boot').innerHTML = `<div class="card login-card">
      <h2 style="font-size:16px;margin-bottom:10px">Configuration problem</h2>
      ${envErrors.map(e => `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">error</span><div>${esc(e)}</div></div>`).join('')}
      <div class="cell-sub">Fix these environment variables in Vercel, then redeploy.</div></div>`;
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

  $('boot').classList.add('hide');
  $('app').classList.remove('hide');
  $('userInitials').textContent = initials(ME?.name || SESSION.user.email);
  $('userName').textContent = ME?.name || SESSION.user.email;
  $('userRole').textContent = ME?.role || 'signed in';

  buildNav();
  applyDensity();
  $('signOutBtn').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });
  /* Refresh means "tell me the truth right now", so it re-reads the badges as
     well as the screen. Re-rendering the screen alone would leave the sidebar
     asserting a number the operator just asked to have re-checked. */
  $('refreshBtn').addEventListener('click', () => { go(current); refreshBadges(); });
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== current) go(h); });

  const conn = $('connState');
  db('leads?select=id&limit=1')
    .then(() => { conn.className = 'pill ok'; conn.innerHTML = '<span class="dot"></span>Live'; })
    .catch(e => { conn.className = 'pill hot'; conn.innerHTML = `<span class="dot"></span>${esc(String(e.message).slice(0,40))}`; });

  /* Started after the nav exists — the badges write into spans lib/nav.js
     creates — and before the first screen renders, so the sidebar is already
     truthful by the time anything is on screen. Failures inside are swallowed
     by design: a badge that cannot be computed must not stop the app booting. */
  startBadges();

  go(location.hash.slice(1) || 'overview');
}

boot();
