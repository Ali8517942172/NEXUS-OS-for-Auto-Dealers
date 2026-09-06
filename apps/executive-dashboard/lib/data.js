/* NEXUS OS — lib/data.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { createClient } from '@supabase/supabase-js';
import { N8N_BASE, SUPABASE_ANON, SUPABASE_URL, envErrors } from './env.js';
import { caseFromStatus, logError, requestFailure } from './errors.js';

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
  if (next !== IDENTITY) {
    IDENTITY = next;
    /* Account authority is per person, and this is the one path where a
       different person arrives without the document being discarded. Carrying
       the previous signer's role forward would show a rep the owner's buttons
       until boot() finished re-reading. Back to unknown, not to empty: the
       screens then offer the action and let the database answer, which is the
       same rule as a failed read. */
    MEMBERSHIP = null;
    fireIdentityChange();
  }
  SESSION = s; if (s) ENDED = false;
}
function setMe(m) { ME = m; }
function setMeReadFailed(e) { ME_READ_FAILED = e; }
function meReadFailed() { return ME_READ_FAILED; }

/* ── Account authority ─────────────────────────────────────────────────
   What this person may DO, which is a different question from who they are.

   Read from public.tenant_members.role — the same column the database's own
   inventory and leads policies read, and the same one action_02 already uses
   for approval. NOT from public.users.role, which is a job title ('senior_rep'
   here) and grants nothing. Two sources would drift, and the one that lost the
   argument would be this one, because the database is where the refusal
   actually happens.

   MEMBERSHIP is null when the read FAILED, and [] when it succeeded and the
   account belongs to no dealership. Those are different, for the same reason
   ME_READ_FAILED exists: "we could not find out" must never render as "you
   have no permissions". On an unknown authority the UI shows the action and
   lets the database answer, rather than hiding a button this person may well
   be entitled to press.

   None of this is a security control. Every rule below is enforced in the
   database against the same JWT, and PostgREST is reachable directly. The only
   thing this buys is that the dashboard does not offer an action that is going
   to come back refused. */
let MEMBERSHIP = null;
function setMembership(rows) { MEMBERSHIP = Array.isArray(rows) ? rows : null; }
function membershipKnown() { return MEMBERSHIP !== null; }

/* The role at the dealership currently in view. One dealership per login
   today, so this is the first row; written as a lookup so a second one does
   not silently pick the wrong answer. */
function myRole(tenantId) {
  if (!Array.isArray(MEMBERSHIP) || !MEMBERSHIP.length) return null;
  const row = tenantId
    ? MEMBERSHIP.find(r => String(r.tenant_id) === String(tenantId))
    : MEMBERSHIP[0];
  return row ? String(row.role || '') : null;
}

/* The public.users id this login is linked to. leads.assigned_to_id holds a
   STAFF id, not an auth id, and the leads policy matches on exactly this, so
   "is this lead mine" has to be asked with the same key the database uses. */
function myStaffId(tenantId) {
  if (!Array.isArray(MEMBERSHIP) || !MEMBERSHIP.length) return null;
  const row = tenantId
    ? MEMBERSHIP.find(r => String(r.tenant_id) === String(tenantId))
    : MEMBERSHIP[0];
  return row && row.staff_user_id ? String(row.staff_user_id) : null;
}

/* The four questions the screens actually ask. Each mirrors one rule that is
   enforced in the database, and each answers TRUE when authority is unknown —
   see MEMBERSHIP above. Keep these and the migrations in step: rbac_02
   (inventory), rbac_04 (leads), rbac_05 (the cost trigger). */
const OWNER_ADMIN = ['owner', 'admin'];
const MANAGER_UP  = ['owner', 'admin', 'manager'];
function held(list, tenantId) {
  if (!membershipKnown()) return true;          // unknown ≠ no
  const r = myRole(tenantId);
  return r ? list.includes(r) : false;
}
/* Cost price. rbac_05's inventory_guard_cost_change trigger raises NX001 for
   anyone else, and inventory_set_cost() refuses them too. */
function canSetCost(tenantId)      { return held(OWNER_ADMIN, tenantId); }
/* Deleting a vehicle. rbac_02's inventory_role_delete policy. */
function canDeleteUnit(tenantId)   { return held(OWNER_ADMIN, tenantId); }
/* Adding a vehicle — owner/admin, because adding one states its cost.
   rbac_02's inventory_role_insert policy. */
function canAddUnit(tenantId)      { return held(OWNER_ADMIN, tenantId); }
/* Everything else on a vehicle, asking price included. rbac_02's
   inventory_role_update policy. */
function canEditUnit(tenantId)     { return held(MANAGER_UP, tenantId); }
/* Moving a lead to a different owner. rbac_04's leads_role_update policy puts
   assigned_to_id inside both USING and WITH CHECK for a sales login, so a rep
   cannot reassign a lead — not even one of their own. */
function canReassignLead(tenantId) { return held(MANAGER_UP, tenantId); }
/* Adding a colleague, changing somebody's role, linking them to a staff record,
   or taking their access away. team_02 and team_03/team_05 all begin with the
   same lookup — the target's membership row intersected with
   nexus_tenant_ids_for_roles(['owner','admin']) — so this predicate mirrors one
   rule and not a family of them. */
function canManageAccess(tenantId)  { return held(OWNER_ADMIN, tenantId); }
/* Granting or removing the OWNER role specifically. team_05's
   NX_TEAM_OWNER_ROLE_IS_OWNER_ONLY tests the roles rather than the people, so
   it covers an admin naming itself as well as an admin naming a colleague —
   which is what stops an admin promoting itself. Unknown authority answers true
   here for the same reason as the rest: the database gets to say no, not this
   file. */
function canGrantOwner(tenantId)    { return held(['owner'], tenantId); }

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

/* ── What a failed request throws ───────────────────────────────────────────
   Everything this app knows about a failure is learned here — the four fetches
   in this file are the only network calls in the bundle — so this is where the
   two audiences separate. Before 5 Sep 2026 these threw the wire's own words:
   `403 Forbidden — {"code":"42501","message":"permission denied for table
   leads","hint":null}`. That string was then rendered to the user by
   lib/states.js on fifteen screens, and interpolated into screen prose in about
   twenty more places.

   Now the thrown Error carries a user-safe clause as its `.message` (so every
   one of those prose sentences is safe without being touched), the case on
   `.nexusErrorCase`, and the wire's own account on `.technical` — console only,
   plus the one caller that legitimately parses a workflow's refusal out of it.
   The status and SQLSTATE ride along so a screen can tell a refusal from an
   outage without reading text.

   A rejected fetch is the one case this app can call the network with a
   straight face: the request never produced a response. Anything else — 400,
   404, 500, a body that will not parse — is generic, because the app cannot
   tell those apart from here and will not pretend to. */
function codeFrom(body) {
  try { const j = JSON.parse(body); return j && typeof j === 'object' ? (j.code || null) : null; }
  catch { return null; }
}

async function request(url, init, label) {
  try {
    return await fetch(url, init);
  } catch (e) {
    /* fetch only rejects when no response was produced: DNS, TLS, a refused
       connection, a dropped one, a CORS preflight that never landed. */
    const err = requestFailure('offline', { technical: `${label} — ${String(e && e.message || e)}`, cause: e });
    logError(label, err, e);
    throw err;
  }
}

async function failure(res, label) {
  const body = await res.text().catch(() => '');
  if (isAuthFailure(res.status, body)) {
    sessionEnded();
    const err = requestFailure('session', { status: res.status, code: codeFrom(body), technical: `${label} — ${res.status} ${res.statusText} ${body.slice(0, 400)}` });
    logError(label, err);
    return err;
  }
  const code = codeFrom(body);
  const err = requestFailure(caseFromStatus(res.status, code) || 'generic', {
    status: res.status, code,
    technical: `${label} — ${res.status} ${res.statusText}${body ? ' — ' + body.slice(0, 400) : ''}`,
  });
  logError(label, err);
  return err;
}

async function db(path) {
  const label = `GET /rest/v1/${path}`;
  const res = await request(`${SUPABASE_URL}/rest/v1/${path}`, { headers: await headers() }, label);
  if (!res.ok) throw await failure(res, label);
  try {
    return await res.json();
  } catch (e) {
    const err = requestFailure('generic', { status: res.status, technical: `${label} — response body did not parse: ${String(e && e.message || e)}`, cause: e });
    logError(label, err, e);
    throw err;
  }
}
async function dbWrite(method, path, body) {
  const label = `${method} /rest/v1/${path}`;
  const res = await request(`${SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: { ...(await headers()), Prefer: 'return=representation' }, body: JSON.stringify(body),
  }, label);
  if (!res.ok) throw await failure(res, label);
  try {
    return await res.json();
  } catch (e) {
    const err = requestFailure('generic', { status: res.status, technical: `${label} — response body did not parse: ${String(e && e.message || e)}`, cause: e });
    logError(label, err, e);
    throw err;
  }
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
  const label = `POST /webhook/${path}`;
  const res = await request(`${N8N_BASE}/webhook/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && token !== SUPABASE_ANON ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload || {}),
  }, label);
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    /* `.technical` keeps the shape the previous `.message` had — status, a dash,
       then the body — because screens/finance.js reads a quote workflow's own
       refusal reasons out of it and renders them as a decline, which is a
       considered "no" from the validator and not an error at all. That parse is
       now pointed at `.technical`; nothing renders the string itself. */
    const err = requestFailure(caseFromStatus(res.status, codeFrom(text)) || 'generic', {
      status: res.status, code: codeFrom(text),
      technical: `${res.status} — ${text.slice(0, 400)}`,
    });
    logError(label, err);
    throw err;
  }
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
  if (!supabase) throw new Error('This installation is not configured to reach your data. Only NEXUS can correct that.');
  if (!path) throw new Error('No storage path on this record.');
  const { data, error } = await supabase.storage
    .from('kyc-documents').createSignedUrl(path, expiresIn);
  /* Storage speaks for a backend too — "Object not found", a bucket name, a
     policy name. The reason goes to the console; the user gets the sentence
     this app wrote. */
  if (error) {
    const err = requestFailure(caseFromStatus(error.status, error.code) || 'generic',
      { status: error.status ?? null, code: error.code ?? null, technical: `storage sign ${path} — ${String(error.message || error)}`, cause: error });
    logError(`storage sign ${path}`, err, error);
    throw err;
  }
  if (!data?.signedUrl) throw new Error('The stored file could not be opened.');
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

export { supabase, SESSION, ME, setMeReadFailed, meReadFailed, authToken, headers, isAuthFailure, sessionEnded, db, dbWrite, n8n, signedUrl, HOOK, setSessionEndedHandler, setSession, setMe, onIdentityChange, setMembership, membershipKnown, myRole, myStaffId, canSetCost, canDeleteUnit, canAddUnit, canEditUnit, canReassignLead, canManageAccess, canGrantOwner };
