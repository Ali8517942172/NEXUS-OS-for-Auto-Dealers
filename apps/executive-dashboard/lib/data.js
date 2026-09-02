/* NEXUS OS — lib/data.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { createClient } from '@supabase/supabase-js';
import { N8N_BASE, SUPABASE_ANON, SUPABASE_URL, envErrors } from './env.js';

const supabase = envErrors.length ? null : createClient(SUPABASE_URL, SUPABASE_ANON);
let SESSION = null;
let ME = null;
/* Non-null when the `users` read FAILED, as opposed to succeeding and finding
   nothing. Screens must check this before saying "you have no staff record" —
   that sentence is only true when this is null. */
let ME_READ_FAILED = null;

/* Supabase access tokens expire after an hour. supabase-js refreshes them in the
   background, but SESSION was captured once at boot and never updated, so every
   request kept presenting the original token. After an hour the dashboard died
   with a raw PostgREST error — `401 PGRST303 {"message":"JWT expired"}` — on
   whichever screen you happened to open, and the n8n webhooks (which now verify
   the same token) rejected everything too.

   getSession() returns the current token and refreshes it when it is close to
   expiry, so asking it per request is what keeps the token live. It reads from
   memory in the normal case, so this is not a network call per request. */
async function authToken() {
  if (!supabase) return SUPABASE_ANON;
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session) SESSION = data.session;
  } catch { /* fall through to whatever we already hold */ }
  return SESSION?.access_token || SUPABASE_ANON;
}

async function headers() {
  return {
    apikey: SUPABASE_ANON,
    Authorization: `Bearer ${await authToken()}`,
    'Content-Type': 'application/json',
  };
}

/* An expired or missing session is not a data error, and rendering it as one
   ("Couldn't load team performance — 401 PGRST303…") tells the user nothing
   they can act on. Send them back to the login screen instead. */
function isAuthFailure(status, body) {
  return status === 401 && /JWT|token|expired|PGRST30/i.test(String(body || ''));
}
/* app.js registers the real handler at boot. Importing renderLogin here
   instead would make lib/data.js depend on the entry module, and the entry
   module already depends on this one. */
let onSessionEnded = () => {};
function setSessionEndedHandler(fn) { onSessionEnded = fn; }
/* ── Whose data is in memory ────────────────────────────────────────────────
   Multi-tenancy landed in the database on 2 Sep 2026. RLS is the security
   boundary and it is enforced per request, so nothing here is a second lock.
   What RLS cannot reach is memory: this app re-authenticates WITHOUT a page
   reload on one path — a token expires, lib/data.js calls sessionEnded(),
   app.js paints the login card over the running app, and a successful sign-in
   from that card calls boot() again. The document is never discarded, so every
   module-level array, snapshot and memo from the PREVIOUS session is still
   there, and on a showroom floor machine the next person to sign in is
   routinely not the previous one. With one dealership that only meant stale;
   with two it means one dealership's rows rendered inside another's session.

   So: any module holding data across renders registers a reset here, and
   setSession() fires them the moment the signed-in identity changes. Sign-out
   still reloads the page (app.js) and is unaffected — this covers the path
   that does not.

   Registered, not automatic: a module that keeps nothing needs nothing, and a
   list of resets that can be read in one place is the only way to answer "what
   survives a tenant switch" without re-reading every screen. */
const RESETTERS = new Set();
let IDENTITY = null;
function onIdentityChange(fn) { RESETTERS.add(fn); return fn; }
function fireIdentityChange() {
  RESETTERS.forEach(fn => { try { fn(); } catch { /* a reset must never break sign-in */ } });
}

/* A live session clears the latch below, so signing back in re-arms it.

   The identity check compares auth user ids, so the background token refresh
   (same user, new token, fired every hour by supabase-js) does NOT clear
   anything — only an actual change of who is signed in does, including the
   transition to signed-out. */
function setSession(s) {
  const next = s?.user?.id || null;
  if (next !== IDENTITY) { IDENTITY = next; fireIdentityChange(); }
  SESSION = s; if (s) ENDED = false;
}
function setMe(m) { ME = m; }
function setMeReadFailed(e) { ME_READ_FAILED = e; }
function meReadFailed() { return ME_READ_FAILED; }

/* Once, per expiry. A screen fires four or five reads in parallel and the badge
   poller adds its own, so an expired token produces six simultaneous 401s —
   and each one used to re-render the login screen, throwing away anything
   already typed into it five more times in the same tick. The end of a session
   is one event no matter how many requests discover it. */
let ENDED = false;
function sessionEnded() {
  if (ENDED) return;
  ENDED = true;
  SESSION = null;
  onSessionEnded('Your session expired. Please sign in again.');
}

async function db(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: await headers() });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (isAuthFailure(res.status, body)) { sessionEnded(); throw new Error('Session expired'); }
    throw new Error(`${res.status} ${res.statusText}${body ? ' — ' + body.slice(0, 180) : ''}`);
  }
  return res.json();
}
async function dbWrite(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: { ...(await headers()), Prefer: 'return=representation' }, body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (isAuthFailure(res.status, text)) { sessionEnded(); throw new Error('Session expired'); }
    throw new Error(`${res.status} — ${text.slice(0, 180)}`);
  }
  return res.json();
}

/* n8n webhooks. Kept separate from db() because a missing VITE_N8N_BASE_URL is
   a recoverable condition — those screens degrade, the rest of the app works. */
async function n8n(path, payload) {
  if (!N8N_BASE) throw new Error('VITE_N8N_BASE_URL is not set, so workflow calls are disabled.');
  /* The GCP URL ships inside a public JS bundle, so anyone who opens devtools can
     read it and call these — and ask-ai spends OpenRouter tokens on every call.
     Every workflow therefore verifies the signed-in user's Supabase JWT and
     rejects the request without one; verified live on whatsapp-send, which
     answers `Unauthorized. A valid Supabase session token is required`. A shared
     secret compiled into this bundle would be equally public and prove nothing;
     a JWT is identity the browser cannot forge.
     (This comment used to end "harmless until the workflows check it, which is
     the next step" — that step landed on 22 Aug.) */
  const token = await authToken();
  const res = await fetch(`${N8N_BASE}/webhook/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && token !== SUPABASE_ANON ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload || {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} — ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/* Short-lived signed URL for a private Storage object.

   The kyc-documents bucket is private and must stay private — a KYC document is
   a customer's passport or Emirates ID. Storage RLS already carries exactly the
   two policies this needs: `kyc_objects_staff_read` (SELECT for `authenticated`
   where bucket_id = 'kyc-documents') and `kyc_objects_no_anon` (everything
   denied for `anon`). So a signed-in member of staff can mint a link and a
   logged-out visitor cannot, without any of it going through a service-role key
   or a public URL.

   Default TTL is 60 seconds: long enough to click through, short enough that a
   link pasted into a chat is dead by the time anyone else opens it.

   A row whose `purged_at` is set has had its object deleted by the retention job
   — signing that path returns a URL that 404s. Callers must skip those rows
   rather than offering a link that breaks. */
async function signedUrl(path, expiresIn = 60) {
  if (!supabase) throw new Error('Supabase is not configured in this build.');
  if (!path) throw new Error('No storage path on this record.');
  const { data, error } = await supabase.storage
    .from('kyc-documents').createSignedUrl(path, expiresIn);
  if (error) throw new Error(error.message || 'Could not sign that document.');
  if (!data?.signedUrl) throw new Error('Storage returned no URL for that path.');
  return data.signedUrl;
}

/* Webhook paths, in one place. Every one of these is guarded by the Supabase JWT
   check inside n8n, so n8n() sending the session token is what makes them work —
   an unauthenticated call is rejected by the workflow, not by this file. */
const HOOK = {
  askAi:      'ask-ai',
  finance:    'finance-calc',
  warmDrip:   'lead-trigger',
  closedWon:  'deals/closed-won',
  kyc:        'audit-kyc',
  erpSync:    'erp-sync',
  escalation: 'lead-escalation',
  /* Operator replies from the conversations screen. Guarded by the same JWT as
     the rest, and NOT fire-and-forget: it answers with a status of sent or
     error, so the UI can tell the operator whether the message actually left.
     No braces in this comment on purpose — SCHEMA_PROBE.mjs reads the HOOK
     block with a non-greedy match to the first closing brace, and a brace here
     truncates the map and makes it report this very hook as undefined. */
  whatsappSend: 'whatsapp-send',
};

/* ── Screen registry ─────────────────────────────────────────────────────── */

export { supabase, SESSION, ME, setMeReadFailed, meReadFailed, authToken, headers, isAuthFailure, sessionEnded, db, dbWrite, n8n, signedUrl, HOOK, setSessionEndedHandler, setSession, setMe, onIdentityChange };
