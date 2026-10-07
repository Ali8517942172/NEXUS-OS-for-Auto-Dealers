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
/* The theme layer. Order is the contract: tokens first, then the four
   surface-specific files, all AFTER design-system.css so a theme rule wins a
   tie without needing !important. Split by surface rather than by screen so
   four people can work at once without touching one another's file. */
import './lib/theme-tokens.css';
import './lib/theme-shell.css';
import './lib/theme-surfaces.css';
import './lib/theme-controls.css';
import './lib/theme-data.css';
import './lib/theme-auth.css';
import './lib/theme-modal.css';
import './lib/theme-table.css';
import './lib/theme-forms.css';
/* The Google Stitch layer (7 Oct 2026): Tailwind, compiled at build time from
   the theme the Stitch exports carry, plus a reset scoped to `.nx-stitch`.
   LAST, so that on a specificity tie the Stitch rule wins; every utility is
   scoped under `.nx-tw` (on <html>) and out-ranks the legacy element rules.
   lib/stitch.css says why preflight is off and what replaced it. */
import './lib/stitch.css';

import { $ } from './lib/dom.js';
import { esc, initials } from './lib/format.js';
import { envErrors } from './lib/env.js';
import { ME, SESSION, db, myRole, sessionEnded, setMe, setMeReadFailed, setMembership, setSession, setSessionEndedHandler, supabase } from './lib/data.js';
import { loadSubscription, paintSubscriptionBanner, refreshSubscription, startWriteLockObserver } from './lib/subscription.js';
import { buildNav, current, go } from './lib/nav.js';
import { closeDrawer } from './lib/ui.js';
import { applyDensity } from './lib/prefs.js';
import { installPrivacyGuard, onPrivacyChange, privacyOn, setPrivacy } from './lib/privacy.js';
import { refreshBadges, startBadges, stopBadges } from './lib/badges.js';
import { initShell } from './lib/shell.js';

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
/* No founder screen is imported here, on purpose: the founder console lives on
   its own page (founder/index.html, served at /founder) and nothing of it is
   part of the dealer app's bundle, nav or routing. */
import './screens/integrations.js';
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
/* Added with the Stitch shell, 7 Oct 2026. My Queue, Owner Brief, Exceptions
   and Vehicle 360 are marked ◐ PARTIAL in the navigation; What's Coming and the
   fifteen roadmap routes (screens/roadmap.js) render no live data at all. */
import './screens/my-queue.js';
import './screens/owner-brief.js';
import './screens/exceptions.js';
import './screens/whats-coming.js';
import './screens/vehicle-360.js';
import './screens/roadmap.js';

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
/* The sign-in card is design/stitch/sign-in-nexus-os-dealership-authentication
   --60425b.html, with three things deliberately not carried over:

   1. Its claims. The export's left column says the product is "TDRA Registered",
      "Trusted by premier UAE dealerships", that MFA is active and that latency
      is 38 ms; its form pre-fills a tenant code and a "Remember this terminal"
      box. None of that is true of this build, and a sign-in page is the first
      thing a prospective customer reads. The three pillars describe what NEXUS
      does, in words this repository can back.
   2. Its width. The export wraps a two-column card in `max-w-md`, which crushes
      both columns into 448px (rendered side by side with the export, 7 Oct).
      The card is the design; `max-w-5xl` is the container that lets it render.
   3. Its auth. The logic below is the original: the same fields (#li, #lp,
      #lgo — QUALITY_GATE.mjs signs in through them), the same call, the same
      error path. The error text is still Supabase's own sentence, escaped.

   The sub-line under the form names who to ask, never the identity supplier
   (5 Sep 2026): which supplier holds the password is NEXUS's implementation. */
const SIGNIN_FRAME = (rightHtml) => `
  <div class="min-h-screen flex items-center justify-center p-space-lg bg-background text-on-surface font-body-md text-body-md">
  <main class="w-full max-w-5xl">
  <div class="w-full bg-surface-container-lowest rounded-xl shadow-xl overflow-hidden flex flex-col lg:flex-row min-h-[640px]">
    <div class="w-full lg:w-[45%] bg-on-surface text-surface flex flex-col justify-between p-space-lg lg:p-space-xl relative overflow-hidden">
      <div class="absolute inset-0 opacity-10 pointer-events-none">
        <svg class="w-full h-full" height="100%" width="100%" xmlns="http://www.w3.org/2000/svg"><defs>
          <pattern height="36" id="tech-grid" patternUnits="userSpaceOnUse" width="36"><path d="M 36 0 L 0 0 0 36" fill="none" stroke="#afc6ff" stroke-width="0.75"></path></pattern>
        </defs><rect fill="url(#tech-grid)" height="100%" width="100%"></rect></svg>
      </div>
      <div class="absolute -top-24 -left-24 w-80 h-80 rounded-full bg-primary-container/20 blur-3xl pointer-events-none"></div>
      <div class="absolute -bottom-24 -right-24 w-80 h-80 rounded-full bg-tertiary-container/30 blur-3xl pointer-events-none"></div>
      <div class="relative z-10 flex flex-col gap-space-lg">
        <div class="flex items-center gap-space-sm">
          <span class="relative inline-flex rounded-full h-3 w-3 bg-tertiary-fixed"></span>
          <span class="font-headline-md text-headline-md tracking-wider text-surface-container-lowest">NEXUS OS</span>
        </div>
        <div class="flex flex-col gap-space-sm mt-space-sm">
          <span class="font-label-numeric-sm text-label-numeric-sm text-tertiary-fixed uppercase tracking-wider">Revenue recovery for dealerships</span>
          <h1 class="font-headline-lg text-headline-lg text-surface-container-lowest leading-snug">Find the money your dealership is leaking — and recover it.</h1>
        </div>
        <div class="flex flex-col gap-space-md mt-space-xs">
          <div class="flex items-start gap-space-sm bg-surface-container-high/5 p-space-sm rounded-lg">
            <span class="material-symbols-outlined text-tertiary-fixed text-[20px] mt-0.5">radar</span>
            <div class="flex flex-col"><span class="font-body-md text-body-md text-surface-container-lowest font-medium">Where money is leaking</span>
              <span class="font-body-sm text-body-sm text-outline-variant">Enquiries waiting for a reply, deals that stalled and stock that is ageing, in one place.</span></div>
          </div>
          <div class="flex items-start gap-space-sm bg-surface-container-high/5 p-space-sm rounded-lg">
            <span class="material-symbols-outlined text-tertiary-fixed text-[20px] mt-0.5">auto_mode</span>
            <div class="flex flex-col"><span class="font-body-md text-body-md text-surface-container-lowest font-medium">The next best action</span>
              <span class="font-body-sm text-body-sm text-outline-variant">Each leak comes with a step your team can take — and your team decides.</span></div>
          </div>
          <div class="flex items-start gap-space-sm bg-surface-container-high/5 p-space-sm rounded-lg">
            <span class="material-symbols-outlined text-tertiary-fixed text-[20px] mt-0.5">hub</span>
            <div class="flex flex-col"><span class="font-body-md text-body-md text-surface-container-lowest font-medium">Above your existing systems</span>
              <span class="font-body-sm text-body-sm text-outline-variant">NEXUS sits on top of the tools your dealership already uses and replaces none of them.</span></div>
          </div>
        </div>
      </div>
    </div>
    <div class="w-full lg:w-[55%] bg-surface-bright flex flex-col justify-center p-space-lg lg:p-space-xl">
      <div class="w-full max-w-lg mx-auto flex flex-col gap-space-md">${rightHtml}</div>
    </div>
  </div>
  </main></div>`;

function renderLogin(msg) {
  $('boot').classList.remove('hide');
  $('app').classList.add('hide');
  $('boot').innerHTML = SIGNIN_FRAME(`
      <div class="flex flex-col gap-space-xs">
        <span class="font-label-numeric-sm text-label-numeric-sm uppercase tracking-wider text-secondary">Sign in</span>
        <h2 class="font-headline-lg text-headline-lg text-on-surface">Dealership Sign In</h2>
        <p class="font-body-md text-body-md text-on-surface-variant">Sign in with the account NEXUS created for you.</p>
      </div>
      ${msg ? `<div class="bg-error-container text-on-error-container p-space-sm rounded-lg flex items-start gap-space-sm" role="alert">
        <span class="material-symbols-outlined text-error text-[20px] mt-0.5 shrink-0">error</span>
        <div class="flex-1 flex flex-col"><span class="font-body-md text-body-md font-semibold text-error">Couldn't sign you in</span>
          <span class="font-body-sm text-body-sm text-on-error-container leading-tight mt-0.5">${esc(msg)}</span></div>
      </div>` : ''}
      <form class="flex flex-col gap-space-md" id="loginForm" novalidate>
        <div class="flex flex-col gap-1.5">
          <label class="font-body-sm text-body-sm font-semibold text-on-surface" for="li">Work email address</label>
          <div class="relative flex items-center">
            <span class="material-symbols-outlined text-outline absolute left-3 pointer-events-none text-[20px]">alternate_email</span>
            <input class="w-full bg-surface-container-lowest text-on-surface font-body-md text-body-md pl-10 pr-3 py-2.5 rounded-lg shadow-sm border border-outline-variant/60 focus:outline-none focus:ring-2 focus:ring-primary-container" id="li" type="email" autocomplete="username" placeholder="name@dealership.ae" />
          </div>
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="font-body-sm text-body-sm font-semibold text-on-surface" for="lp">Password</label>
          <div class="relative flex items-center">
            <span class="material-symbols-outlined text-outline absolute left-3 pointer-events-none text-[20px]">lock</span>
            <input class="w-full bg-surface-container-lowest text-on-surface font-label-numeric-md text-label-numeric-md tracking-widest pl-10 pr-10 py-2.5 rounded-lg shadow-sm border border-outline-variant/60 focus:outline-none focus:ring-2 focus:ring-primary-container" id="lp" type="password" autocomplete="current-password" placeholder="Enter password" />
            <button class="absolute right-3 text-outline hover:text-on-surface focus:outline-none p-0.5" id="lpShow" type="button" aria-label="Show password" aria-pressed="false">
              <span class="material-symbols-outlined text-[20px]">visibility</span></button>
          </div>
        </div>
        <button class="w-full bg-primary-container hover:bg-primary text-on-primary py-3 rounded-lg font-body-md text-body-md font-semibold flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-primary-container focus:ring-offset-2 disabled:opacity-70" id="lgo" type="submit">
          <span>Sign in to NEXUS OS</span><span class="material-symbols-outlined text-[18px]">arrow_forward</span>
        </button>
      </form>
      <div class="bg-surface-container-low p-space-sm rounded-lg flex items-start gap-space-sm mt-space-xs">
        <span class="material-symbols-outlined text-secondary text-[20px] shrink-0 mt-0.5">vpn_key_alert</span>
        <p class="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
          <span class="font-semibold text-on-surface">Accounts are created by NEXUS.</span> Ask NEXUS support to add one, or to reset a password.</p>
      </div>`);
  const go2 = async () => {
    const btn = $('lgo'); btn.disabled = true; btn.querySelector('span').textContent = 'Signing in…';
    const { error } = await supabase.auth.signInWithPassword({ email: $('li').value.trim(), password: $('lp').value });
    if (error) { renderLogin(error.message); return; }
    boot();
  };
  $('loginForm').addEventListener('submit', e => { e.preventDefault(); go2(); });
  $('lpShow').addEventListener('click', () => {
    const p = $('lp'); const show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    $('lpShow').setAttribute('aria-pressed', show ? 'true' : 'false');
    $('lpShow').querySelector('span').textContent = show ? 'visibility_off' : 'visibility';
  });
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
    $('boot').innerHTML = SIGNIN_FRAME(`
      <div class="bg-error-container text-on-error-container p-space-sm rounded-lg flex items-start gap-space-sm" role="alert">
        <span class="material-symbols-outlined text-error text-[20px] mt-0.5 shrink-0">error</span>
        <span class="font-body-md text-body-md font-semibold text-error">NEXUS cannot start on this installation.</span>
      </div>
      <p class="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">A setting NEXUS needs in order to reach your data was not
        supplied when this dashboard was installed, so no screen would be able to load anything and none is
        offered. Nothing has happened to your data, and nothing has been lost.</p>
      <p class="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">This is not something that can be corrected from this screen,
        from this browser, or by signing in. Contact NEXUS support &mdash; the details they need are already
        recorded.</p>`);
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

  $('boot').classList.add('hide');
  $('app').classList.remove('hide');
  $('userInitials').textContent = initials(ME?.name || SESSION.user.email);
  $('userName').textContent = ME?.name || SESSION.user.email;
  $('sideUserName').textContent = ME?.name || SESSION.user.email;
  /* Two different facts, and the header used to show only the first. The job
     title says what this person does; the account role says what the product
     will let them do, and it is the one that explains a refused action. */
  $('userRole').textContent = [ME?.role, myRole()].filter(Boolean).join(' · ') || 'signed in';

  buildNav();
  /* The live parts of the Stitch topbar: freshness, health, scope menu, bell,
     search and shortcuts (lib/shell.js). After buildNav(), whose scope chip and
     breadcrumb it shares; the health check it starts replaces the connection
     pill that used to be painted further down this function. */
  initShell();
  applyDensity();

  /* Privacy mode (lib/privacy.js): the top-bar toggle, and the guard that masks
     customer names, phones and emails wherever they are painted while it is on.
     Flipping it re-renders the screen so helpers that mask at render time
     (displayName and friends) repaint too. */
  installPrivacyGuard(document.body);
  const pBtn = $('privacyBtn');
  /* Two complete class strings, swapped whole (the Stitch rule — see
     scripts/stitch-classes.mjs). The legacy `#privacyBtn.on` rule in styles.css
     is no longer triggered: the pressed state is the Stitch active style. */
  const PRIVACY_BTN = {
    off: 'p-1.5 rounded-lg hover:bg-surface-container-low hover:text-on-surface transition-colors',
    on:  'p-1.5 rounded-lg bg-primary-container text-on-primary transition-colors',
  };
  const paintPrivacy = on => {
    pBtn.className = on ? PRIVACY_BTN.on : PRIVACY_BTN.off;
    pBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    pBtn.querySelector('.material-symbols-outlined').textContent = on ? 'visibility_off' : 'visibility';
  };
  paintPrivacy(privacyOn());
  pBtn.addEventListener('click', () => setPrivacy(!privacyOn()));
  onPrivacyChange(on => { paintPrivacy(on); go(current); });
  $('signOutBtn').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });
  /* Refresh means "tell me the truth right now", so it re-reads the badges as
     well as the screen. Re-rendering the screen alone would leave the sidebar
     asserting a number the operator just asked to have re-checked. */
  $('refreshBtn').addEventListener('click', () => { go(current); refreshBadges(); refreshSubscription(); });
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== current) go(h); });

  /* The connection pill that used to be painted here is now the health chip in
     the Stitch topbar (lib/shell.js): the same one indexed read of `leads`, run
     through lib/integrations.js's 'NEXUS data' check so Settings and the topbar
     cannot disagree, with the same rule — the state on the chip, the
     dealership's half in its tooltip, the diagnostic in the console. */

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
  /* One read of every lead's id and name before the first screen: it lets
     lib/privacy.js know which lead ids are internal test records (so a row that
     only carries a lead_id is hidden with its lead) and which names to mask,
     before anything is painted. A failure costs nothing but that head start. */
  /* WhatsApp contacts and customer records too: a contact with no lead is still
     a person, and a screen that is opened first (Attribution, Revenue) may name
     them before any screen that reads them has run. */
  await Promise.all([
    'leads?select=id,name,phone,email&limit=5000',
    'v_conversations?select=display_name,push_name,lead_name,phone&limit=5000',
    'whatsapp_contacts?select=push_name,phone&limit=5000',
    'customer?select=display_name,phone_digits,email&limit=5000',
  ].map(q => db(q).catch(() => null)));   // the screens report their own reads
  go(location.hash.slice(1) || 'moneyleaks');
}

boot();
