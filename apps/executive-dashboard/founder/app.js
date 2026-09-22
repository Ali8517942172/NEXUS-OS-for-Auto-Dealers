/* ============================================================================
   NEXUS OS — founder/app.js
   The entry point of the SEPARATE founder page, served at /founder. Added
   22 Sep 2026, when every founder control moved out of the dealer app so that
   a dealer -- or a screen recording of the dealer app made while the founder
   is signed in -- shows no founder UI at all.

   It reuses the dealer app's own plumbing (lib/data.js for the session and
   every read and write, lib/platform.js for the platform-admin check) and
   renders screens/founder.js's console. It does not import lib/nav.js or any
   dealer screen.

   THE GATE HERE IS NOT THE SECURITY BOUNDARY. Every nexus_founder_* RPC and
   the founder-invite Edge Function re-run nexus_is_platform_admin()
   server-side on every call. This page only decides what is drawn: the
   console for the platform admin, and "Not authorised" for anyone else,
   including when the answer cannot be read (fail closed).
   ========================================================================== */
import '../styles.css';
import '../lib/design-system.css';

import { $ } from '../lib/dom.js';
import { esc } from '../lib/format.js';
import { envErrors } from '../lib/env.js';
import { SESSION, sessionEnded, setSession, setSessionEndedHandler, supabase } from '../lib/data.js';
import { isPlatformAdmin, loadPlatformAdmin } from '../lib/platform.js';
import { closeDrawer } from '../lib/ui.js';
import { renderFounderConsole } from '../screens/founder.js';

const brand = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
    <div class="brand-mark">N</div><div class="brand-name">NEXUS OS</div>
  </div>`;

function showBoot(html) {
  $('app').classList.add('hide');
  $('boot').classList.remove('hide');
  $('boot').innerHTML = `<div class="card login-card">${brand}${html}</div>`;
}

function renderLogin(msg) {
  showBoot(`
    ${msg ? `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">error</span><div>${esc(msg)}</div></div>` : ''}
    <div class="grid" style="gap:14px">
      <div class="field"><label for="li">Email</label><input type="email" id="li" autocomplete="username" /></div>
      <div class="field"><label for="lp">Password</label><input type="password" id="lp" autocomplete="current-password" /></div>
      <button class="btn primary" id="lgo">Sign in</button>
    </div>`);
  const submit = async () => {
    const btn = $('lgo'); btn.disabled = true; btn.textContent = 'Signing in…';
    const { error } = await supabase.auth.signInWithPassword({ email: $('li').value.trim(), password: $('lp').value });
    if (error) { renderLogin(error.message); return; }
    boot();
  };
  $('lgo').addEventListener('click', submit);
  $('lp').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

/* The only thing a non-founder ever sees on this page. */
function renderNotAuthorised() {
  showBoot(`
    <div class="state err" style="padding:8px 0 0">
      <span class="material-symbols-outlined">lock</span>
      <h3>Not authorised</h3>
      <p>This page is not available to your account.</p>
      <a class="btn primary" href="/">Back to the dashboard</a>
    </div>`);
}

setSessionEndedHandler(msg => renderLogin(msg));

async function paint() {
  const host = $('screen');
  host.innerHTML = '';
  try {
    await renderFounderConsole(host);
  } catch (e) {
    console.error('[NEXUS] founder console failed to render:', e && e.message);
    host.innerHTML = `<div class="state err"><span class="material-symbols-outlined">error</span>
      <h3>The console could not load</h3><p>Refresh to try again.</p></div>`;
  }
}

async function boot() {
  if (envErrors.length) {
    console.error('[NEXUS] This deployment is missing configuration it needs:', envErrors.join(' | '));
    showBoot(`<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">error</span>
      <div>NEXUS cannot start on this installation.</div></div>`);
    return;
  }

  const { data } = await supabase.auth.getSession();
  setSession(data.session);
  if (!SESSION) { renderLogin(); return; }

  supabase.auth.onAuthStateChange((event, session) => {
    setSession(session);
    if (!session && event !== 'INITIAL_SESSION') sessionEnded();
  });

  /* loadPlatformAdmin() never throws; an unreadable answer is "no". */
  await loadPlatformAdmin();
  if (!isPlatformAdmin()) { renderNotAuthorised(); return; }

  $('boot').classList.add('hide');
  $('app').classList.remove('hide');
  $('userName').textContent = SESSION.user.email || '';
  $('signOutBtn').addEventListener('click', async () => { await supabase.auth.signOut(); location.reload(); });
  $('refreshBtn').addEventListener('click', paint);
  $('scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
  paint();
}

boot();
