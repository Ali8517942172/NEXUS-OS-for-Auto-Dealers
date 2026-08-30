/* NEXUS OS — screens/settings.js
   Settings and diagnostics. Rebuilt on 20 Aug 2026; extended 24 Aug 2026 to
   carry the system-health alerts nobody else owns.

   This screen exists to answer, without hedging, the questions an operator or
   an on-call engineer asks when something looks wrong:

     · Who am I signed in as, and what does the database think my role is?
     · Which Supabase project and which n8n instance is THIS bundle talking to?
     · Are those two reachable right now, from this browser, at this moment?
     · Is the automation actually wired up — every registered workflow, its
       state, and which of them have never proved they work?
     · Is a credential broken, and what has stopped working because of it?
     · What is Ask AI actually allowed to answer from?

   Rules it holds itself to:

     · No secret is rendered, not even partially. There is no masked key, no
       first-four-last-four, no truncated token. Only presence — configured or
       not — is ever stated. A masked key still confirms which key is installed,
       and a dashboard that can show a key is a dashboard that can leak one.
     · A count this screen derives stays on this screen. lib/badges.js owns
       every nav badge and repaints all of them from one read of
       v_needs_attention; a badge written from here was overwritten inside a
       minute, and the number it wrote could not be reproduced from that view,
       so the sidebar said one thing while this screen was open and another
       thing a minute later. The tally lives in the alert strip below instead.
     · `ME === null` is two different facts and this screen must say which one
       it means. A `users` read that failed is not evidence that the account has
       no staff record; meReadFailed() is what tells them apart.
     · Nothing here is a guess. The environment panel prints the exact values
       compiled into the bundle; the knowledge-base panel prints the columns
       rag_documents really returned, and where a column it would like does not
       exist it says so rather than showing a plausible zero.
     · Webhook endpoints are listed but never probed. Firing lead-trigger to see
       whether it answers would enrol a real customer in a real drip campaign.
       The connectivity panel probes only what is free and side-effect-free;
       everything else is named, not called.
     · Two honesty rules added 24 Aug and enforced below. A workflow whose
       health is NOT_INSTRUMENTED has not been proven working — it has merely
       never reported — so it is never coloured green, and the word used for it
       is "not logged", not "fine". And `is_active` means only that n8n will run
       the workflow: an active workflow with a revoked credential runs, and
       fails, every single time. Neither state is allowed to read as success.
     · Nothing on this screen writes. Every table it touches except `leads`,
       `inventory` and `finance_quotes` is service-role only, and n8n exposes no
       credential API to a browser, so the repairs this screen can *diagnose*
       are deliberately rendered as disabled controls naming what is missing. */
import { HOOK, ME, SESSION, db, meReadFailed } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { N8N_BASE, SUPABASE_URL, envErrors } from '../lib/env.js';
import { ago, clock, dubaiTime, esc, n0, num, pct, pill, tone } from '../lib/format.js';
import { renderIntegrations } from '../lib/integrations.js';
import { SCREENS, go } from '../lib/nav.js';
import { applyDensity } from '../lib/prefs.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, openDrawer, table, wireRows } from '../lib/ui.js';

/* Bounded read of the knowledge base. Where the cap is hit the panel says so —
   a KB listing that looks complete but is a window would understate what Ask AI
   can reach, which is the opposite of what this panel is for. */
const KB_LIMIT = 1000;
const PREVIEW_CHARS = 400;

/* Bounded reads for the health strip. Each cap is reported where it is hit,
   for the same reason: a window that looks like a census is a lie. */
const ATTN_LIMIT = 200;
const HEALTH_LIMIT = 200;
const FAIL_LIMIT = 300;

/* rag_documents is populated by the ingestion workflow rather than by a
   migration this repo owns, so its exact column names are not guaranteed here.
   The panel discovers them from one probe row instead of assuming: asking
   PostgREST for a column that does not exist returns a 400 and would collapse
   the whole panel into an error for a cosmetic reason. First match wins. */
const TITLE_KEYS = ['doc_title', 'title', 'document_title', 'doc_name', 'name'];
const TEXT_KEYS  = ['content', 'chunk', 'chunk_text', 'text', 'body', 'page_content', 'section_text'];
const META_KEYS  = ['section', 'source_file', 'page_number', 'category', 'doc_type', 'created_at', 'updated_at', 'inserted_at', 'id'];
const DATE_KEYS  = ['updated_at', 'created_at', 'inserted_at'];
/* An embedding is 1536 floats per row. Selecting it would turn a listing of a
   few hundred sections into a multi-megabyte download for no visible benefit. */
const HEAVY_KEYS = ['embedding', 'embeddings', 'vector'];

const NO_PERSIST =
  'Density applies to this session only. lib/prefs.js exports applyDensity(), which reads the saved preference, but no setter — and a screen may not write to browser storage directly — so this choice cannot be saved from here yet.';

const NO_KB_EDIT =
  'Editing the knowledge base is not built. rag_documents is written by the ingestion workflow and no endpoint accepts a document from the browser.';

/* n8n's credential store is not reachable from a browser at all: there is no
   webhook in HOOK for it, the n8n REST API needs an owner API key that must
   never ship in a public bundle, and workflow_registry is service-role only.
   So the control exists, disabled, and names exactly what is missing. */
const NO_CRED_FIX =
  'Reconnecting a credential is done in the n8n UI under Credentials — n8n exposes no browser-reachable endpoint for it, there is no webhook in HOOK for it, and its API key must not ship inside this bundle. This dashboard can only report the failures the credential caused.';

const low = s => String(s || '').trim().toLowerCase();
const str = v => String(v == null ? '' : v).trim();
const up  = s => str(s).toUpperCase();
const plural = (n, one, many) => (Number(n) === 1 ? one : many);
const pickKey = (cols, list) => list.find(k => cols.includes(k)) || null;
const charText = c => c == null ? '—' : `${num(c)} char${c === 1 ? '' : 's'}`;

/* Was a private severity map, from back when TONE had no WARNING key and
   `t-${tone('WARNING')}` rendered the colourless class `t-`. lib/format.js now
   carries every vocabulary this screen can be handed — the view's
   HOT/WARM/COLD, the CRITICAL/WARNING/INFO words the derived alerts speak, and
   the workflow-health states — so the map is gone and only the name survives,
   because `sevTone(a.sev)` reads better at the call sites than a bare tone()
   would. One severity cannot be two colours on two screens. */
const sevTone = s => tone(s);
const SEV_RANK = { CRITICAL: 0, HIGH: 0, WARNING: 1, MEDIUM: 1, LOW: 2, INFO: 2 };
const sevRank = s => SEV_RANK[up(s)] ?? 3;

/* ── Three of the workflows on this instance are web pages ─────────────────
   `NEXUS Public — Home`, `— Privacy` and `— Terms` are published and active in
   n8n and automate nothing. Google will not publish an OAuth consent screen to
   production without a home page, a privacy policy and a terms URL, and it
   rejects vercel.app as a public suffix — nip.io was the only registrable
   domain available, so n8n serves the three pages itself at /webhook/nexus,
   /webhook/privacy and /webhook/terms. Publishing that consent screen is what
   stopped Gmail's refresh token expiring every seven days, so they are
   load-bearing, but they will never log a run and a silent one is correct.

   The same rule lives in screens/automation.js. It is stated twice rather than
   shared because lib/ is not this task's to change; if a third screen needs it,
   it belongs in lib/format.js beside tone(). */
const isPublicPage = w =>
  /nexus\s*public/i.test(String(w?.name || ''))
  || /^\s*[—-]\s*(?:privacy|terms)\s*$/i.test(String(w?.name || ''))
  || /\/webhook\/(?:nexus|privacy|terms)\b/i.test(String(w?.trigger_detail || ''));
/* One reason, worded once, so the chip tooltip and the alert cannot drift. */
const PAGE_WHY =
  'n8n serves it so that Google’s OAuth consent screen can be published: a home page, a privacy policy and a terms URL are mandatory for production, and vercel.app is rejected as a public suffix, so the pages are served from n8n over nip.io.';
const PAGE_NOTE = `This is a web page, not an automation — ${PAGE_WHY} It logs nothing because a page view is not a workflow run, and it never will.`;

/* Icons for the kinds v_needs_attention emits. Only a fallback: the view names
   its own `screen`, and a kind this file has never seen still renders. */
const KIND_ICON = {
  unanswered_chat: 'mark_chat_unread', lead_unassigned: 'person_alert', sla_breach: 'timer',
  kyc_archive_gap: 'folder_off', workflow_failure: 'error', undercut: 'trending_down',
  inventory_aging: 'directions_car',
};

/* ── Health vocabulary ─────────────────────────────────────────────────────
   Wording, icon and sort rank — and nothing else. The COLOUR is not decided
   here. This map used to carry a `t` on every entry, which made it a private
   severity map, and private severity maps disagree: DEGRADED was red on this
   screen, on Automation, on Ask and on Overview while the shared table said
   amber, so the same workflow was two colours depending on where you looked at
   it. tone() in lib/format.js now owns all of it, DEGRADED included, and it is
   'hot' — a workflow failing in production is not a note to read later.

   What tone() answers for the rest, and why it matters: NEVER_RAN and
   NOT_INSTRUMENTED are both 'cold', never 'ok'. Both are the absence of
   evidence rather than evidence of health, and colouring an unmeasured workflow
   green is how a dashboard lies without anyone writing a false sentence. Only
   HEALTHY is green, and it is green about the 30-day window, not about the
   workflow forever. */
const HEALTH_WORDS = {
  DEGRADED: {
    label: 'Degraded', icon: 'error', rank: 0,
    blurb: 'At least one run failed inside the 30-day window. This is the state that needs a human.',
  },
  NEVER_RAN: {
    label: 'No runs yet', icon: 'schedule', rank: 1,
    blurb: 'This workflow is registered as writing to audit_log and has never written a row. That is not evidence of health, it is the absence of evidence: it has never been observed working in this deployment.',
  },
  NOT_INSTRUMENTED: {
    label: 'Not logged', icon: 'visibility_off', rank: 2,
    blurb: 'This workflow has no Audit Log node, so nothing it does reaches audit_log. Its health is unknown rather than good — from here, running perfectly and failing every time look identical.',
  },
  HEALTHY: {
    label: 'Clean, 30 d', icon: 'check_circle', rank: 3,
    blurb: 'Every run this workflow logged inside the 30-day window succeeded.',
  },
};
const UNKNOWN_HEALTH = {
  label: 'Unrecognised', icon: 'help', rank: 1,
  blurb: 'v_workflow_health returned a health state this screen has no wording for. It is shown verbatim rather than folded into one of the states it might mean, and tone() gives it the unknown tone — a word nobody taught the shared table is not a pass, and it is not cold either.',
};
const stateKey = w => (Object.prototype.hasOwnProperty.call(HEALTH_WORDS, up(w?.health)) ? up(w.health) : 'UNKNOWN');
const healthOf = w => {
  const k = stateKey(w);
  const words = k === 'UNKNOWN' ? UNKNOWN_HEALTH : HEALTH_WORDS[k];
  /* One call, one source of truth. An unrecognised state is handed to tone()
     verbatim rather than as the placeholder key, so it lands on the same
     unknown-word rule as everything else the shared table has never seen. */
  return { ...words, t: tone(k === 'UNKNOWN' ? str(w?.health) : k) };
};

/* 30-day rate computed here from the two columns whose window is documented,
   rather than taken on trust from `success_rate`, whose window is not. */
const rate30 = w => {
  const r = n0(w.runs_30d), f = n0(w.failures_30d);
  if (r == null || !r) return null;
  return ((r - (f || 0)) / r) * 100;
};

/* ── Credential failures ───────────────────────────────────────────────────
   n8n reports a broken credential in the text of the failure it causes — the
   worked example is: The credential "Gmail OAuth2 API" needs to be
   reconnected, which is the wording the Gmail fault produced here for days
   before it was fixed. There is no credential table to read and no n8n API this bundle
   may call, so a workflow failure is the only evidence a browser can have, and
   the match stays deliberately narrow: a bare 401 is NOT treated as a
   credential fault, because calling every auth error a revoked credential would
   send someone to reconnect a credential that was never the problem. */
const CRED_RE = /\bcredentials?\b|\bre-?connect(?:ed|ion)?\b|\boauth\b/i;
const CRED_NAME_RES = [
  /credentials?\s+["“”'`]([^"“”'`]{2,80})["“”'`]/i,
  /["“]([^"”]{2,80})["”]\s+credentials?\b/i,
  /credentials?\s+for\s+["“]?([^"”\n·]{2,60})["”]?\s+(?:are|is|has)\b/i,
];
const credName = txt => {
  for (const re of CRED_NAME_RES) {
    const m = String(txt || '').match(re);
    if (m && str(m[1])) return str(m[1]);
  }
  return null;
};
/* What stops working, stated only where the credential names the channel. The
   sentence is about the channel; the workflows actually seen failing are listed
   beside it from the audit rows themselves, never assumed. */
const CRED_IMPACT = [
  { re: /gmail|smtp|\bmail\b|outlook|sendgrid|resend|postmark/i,
    line: 'Outbound email is dead. Anything that mails a customer — the cold-lead drip, quote mail, and the nightly Gmail aggregation the Customer 360 totals are built from — reaches the send step and fails there. Enrolments still queue; nothing leaves.' },
  { re: /slack/i,
    line: 'Slack alerting is dead. A hot lead can be scored and routed correctly and still reach nobody, because the last step is the one that cannot authenticate.' },
  { re: /whatsapp|waha|twilio|meta/i,
    line: 'WhatsApp sending is affected: a reply posted from Conversations can be accepted by the workflow and still never reach the customer.' },
  { re: /odoo|bitrix|erp|crm|xml-?rpc/i,
    /* Writes are the half that works on the current Bitrix24 plan — `crm.*`
       reads already answer 403 there regardless of credential, which is a plan
       limit and not a fault this panel can see. So a credential failure on this
       channel takes out the only direction that was still working. */
    line: 'The ERP/CRM sync cannot write, so records created here stop mirroring outward and the two systems drift apart silently. On the current Bitrix24 plan writing is the only direction that works at all — crm.* reads answer 403 whatever credential is presented — so this fault removes the half that was functioning.' },
  { re: /openrouter|openai|anthropic|gpt|gemini/i,
    line: 'The model calls fail, so leads arrive unscored and Ask AI answers nothing.' },
  { re: /supabase|postgres|database/i,
    line: 'The workflow cannot reach the database, so whatever it was supposed to record was not recorded.' },
];
/* This panel reads failure HISTORY, not the credential itself — there is no
   credential API a browser may call — so a credential repaired ten minutes ago
   looks exactly like one still broken, until enough time passes with no new
   failure. That is not a hypothetical: the Gmail OAuth2 credential really was
   dead for days (the OAuth consent screen for the nexus-os-backend GCP project
   was stuck in "Testing", where Google expires refresh tokens after seven days;
   it is now published to production, which stops the expiry), and for hours
   after the fix the newest logged failures still named it. A panel that said
   "is failing" through that window would have sent someone to reconnect a
   credential that was already working. Twenty-four hours is chosen against the
   slowest workflow that uses a credential — the nightly aggregations — so that
   "nothing since" means at least one run has had the chance to disagree. */
const CRED_STALE_MS = 24 * 3600 * 1000;
const credStale = newest => {
  const t = Date.parse(newest || '');
  return !Number.isNaN(t) && Date.now() - t > CRED_STALE_MS;
};
/* ── A credential a live run has since proved working ──────────────────────
   The 24-hour rule below is the general case: silence is weak evidence, so the
   panel waits before softening its tense. But silence is not the only evidence
   there is. Where a credential has actually been exercised since its last
   failure and answered, that is a stronger fact than anything the failure
   history can offer, and continuing to say "is failing" over the top of it
   sends someone to reconnect a credential that already works.

   n8n's credential store is not reachable from a browser and audit_log records
   no successful Gmail fetch of its own, so the confirmation cannot be read — it
   is recorded here with what confirmed it and when, and it only ever applies to
   failures OLDER than that confirmation. A failure logged after the check would
   mean the credential broke again, and this table must never hide that. */
const CRED_VERIFIED = [
  {
    re: /gmail|google\s*oauth|google/i,
    at: '2026-08-24T19:46:00Z',
    how: 'a manual Customer 360 - Data Aggregation run at 19:46 returned Gmail - Get Emails \u2192 ok',
    fix: 'The OAuth consent screen for the nexus-os-backend GCP project was stuck in \u201cTesting\u201d, where Google expires every refresh token after seven days \u2014 so the credential died on a timer no amount of reconnecting could beat. The app is now published to production, which is what stops the expiry; the home, privacy and terms pages Google requires for that are served by n8n itself over nip.io, because vercel.app is rejected as a public suffix.',
  },
];
/* Returns the confirmation only when it post-dates the newest failure naming
   this credential — an older confirmation says nothing about a newer failure. */
const credVerified = (name, newestFailure) => {
  const hit = CRED_VERIFIED.find(v => v.re.test(String(name || '')));
  if (!hit) return null;
  const at = Date.parse(hit.at);
  if (Number.isNaN(at) || at > Date.now()) return null;
  /* No usable failure timestamp means the ordering cannot be established, and
     "verified since" is a claim about ordering. Stay critical rather than
     softening a fault whose age is unknown. */
  const f = Date.parse(newestFailure || '');
  if (Number.isNaN(f) || f >= at) return null;
  return hit;
};

const CRED_STALE_LINE = 'No logged failure has named it since, so it may already have been reconnected — but this panel reads failure history, not the credential, so a fixed credential and one whose workflows simply have not run again look identical from here. The next run is what settles it.';

const credImpact = (name, workflows) => {
  const hay = `${name} ${workflows.join(' ')}`;
  const hit = CRED_IMPACT.find(c => c.re.test(hay));
  return hit ? hit.line : 'Every run of the workflows listed here that reaches this credential fails at that step. Whatever those workflows were supposed to do is not being done.';
};

/* Which connectivity tiles the strip is entitled to raise an alarm about. The
   Ask AI tile is deliberately excluded: it is not auto-probed (it spends
   OpenRouter tokens), so "not green" there means "not asked", not "down". */
const AUTO_PROBE = /^(supabase|n8n)$/i;

/* Session expiry as a number the operator can act on. supabase-js refreshes in
   the background, so a small figure here is normal — it is a negative one that
   explains a screen full of 401s. */
function expiryText(expiresAt) {
  const ms = Number(expiresAt) * 1000;
  if (!expiresAt || !Number.isFinite(ms)) return null;
  const left = Math.round((ms - Date.now()) / 60000);
  const at = dubaiTime(ms);
  if (left <= 0) return { text: `expired at ${at} — the next request will sign you out`, bad: true };
  return { text: `valid until ${at}, ${left} min from now`, bad: false };
}

/* ── S14 · Settings ───────────────────────────────────────────────────────── */
SCREENS.settings = async host => {
  /* ── The system-health strip ────────────────────────────────────────────
     Rendered first and filled last. Its inputs arrive at three different
     times — the database reads, the connectivity probes the tiles run, and the
     knowledge-base read — so it is recomputed as each lands rather than showing
     nothing until the slowest one is in. */
  const alertCard = el('div', 'card flush');
  alertCard.id = 'setAlerts';
  alertCard.innerHTML = `<div class="card-head">
      <div>
        <div class="card-title">System health</div>
        <div class="card-sub" id="setAlertSub">Reading v_needs_attention, v_workflow_health and the newest failed runs…</div>
      </div>
      <div style="flex:1"></div>
      <div id="setAlertCount"></div>
    </div><div class="pbody" id="setAlertBody">${stateLoading(2)}</div>`;
  host.appendChild(alertCard);

  const top = el('div', 'grid g2 top'); top.style.marginTop = '16px'; host.appendChild(top);

  /* Screen-scoped state. Each field is null until its read lands and carries
     its own error, because "the health view is down" and "the audit log is
     down" are different sentences and the strip is entitled to the right one. */
  let sysState = null;    // { attn, attnErr, health, healthErr, fails, failsErr, reg, regErr, readAt }
  let probeState = null;  // [{ name, state, msg }] read back off the connectivity tiles
  let kbState = null;     // { count, docs, capped, err }

  /* ── Identity ───────────────────────────────────────────────────────────
     SESSION comes from Supabase Auth; ME is the matching row in `users`. They
     are separate sources and can disagree — a signed-in account with no users
     row has no role at all, which is worth stating rather than printing an em
     dash and letting the operator assume the role is merely blank. */
  const email = SESSION?.user?.email || null;
  const exp = expiryText(SESSION?.expires_at);

  /* `ME === null` used to mean two different things at once. app.js read
     `users` with `.catch(() => null)`, so a query that died and a query that
     succeeded and found nothing arrived here identically — and this screen
     asserted the second, three times: in the banner below, in the phone
     explanation, and in a WARNING in the strip. All three were confident
     sentences about a read that had merely failed.

     meReadFailed() returns the error string when the read failed and null when
     it succeeded, which is what makes the two sayable apart. "This account has
     no staff record" is only sayable when it is null. When it is not, the
     honest line is that the staff table could not be read and we therefore do
     not know — which is a different finding, with a different fix. */
  const meErr = meReadFailed();
  const noMeRow  = !!SESSION && !ME && !meErr;   // read succeeded, found nothing: a real absence
  const meUnknown = !!SESSION && !ME && !!meErr;  // read failed: absence is not established

  /* Everything the users row would have told us is unknown rather than unset in
     that case, and "not set" cannot carry the difference. */
  const meMissing = whenAbsent => meUnknown
    ? `<span class="t-muted" title="${esc(`users could not be read: ${meErr}`)}">unknown — <span class="mono">users</span> could not be read</span>`
    : `<span class="t-muted">${esc(whenAbsent)}</span>`;

  /* The one person this screen lists is the one reading it, and a person is
     shown with their number beside their name. There is no number to show, and
     the reason is a property of the SCHEMA, not of this account: `users` has no
     phone column at all. That sentence stays true whether the row exists, is
     genuinely missing, or could not be read — so it is stated unconditionally.
     The old wording pinned a table-wide absence on whoever was signed in ("no
     row in users matches this account, so no number is stored for it"), which
     was both wrong about the cause and, when the read had merely failed, wrong
     about the row too.

     The column check survives as belt and braces for a future migration that
     adds one; the sentence does not depend on it, and no plausible-looking
     number is ever invented to fill the gap. */
  const NO_STAFF_PHONE =
    'The users table has no phone column, so this dashboard holds no number for any member of staff — that is a property of the schema, not of this account. Customer and lead numbers do exist and are shown beside those people: leads.phone, purchase_history.phone, v_conversations.phone and v_customer_360.phone. Staff numbers are recorded nowhere this dashboard can read.';
  const hasPhoneCol = !!ME && Object.prototype.hasOwnProperty.call(ME, 'phone');
  const mePhone = hasPhoneCol ? str(ME.phone) : '';
  const phoneWhy = hasPhoneCol && !mePhone
    ? 'This account’s users row carries a phone column and it is empty.'
    : NO_STAFF_PHONE;
  const phoneCell = mePhone
    ? `<span class="mono">${esc(mePhone)}</span>`
    : `<span class="t-muted" title="${esc(phoneWhy)}">no number on record</span>`;

  const prof = el('div', 'card');
  prof.id = 'setProfile';
  prof.innerHTML = `<div class="card-title" style="margin-bottom:4px">Signed in</div>
    <div class="card-sub" style="margin-bottom:14px">Identity as Supabase Auth and the <span class="mono">users</span> table each see it</div>
    ${noMeRow ? `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">person_alert</span>
      <div>No row in <span class="mono">users</span> matches ${esc(email || 'this account')}. The read succeeded and came back empty, which is what makes this a real absence: the account can sign in, but it has no name, role or status on record, so anything keyed on role treats it as unassigned.</div></div>` : ''}
    ${meUnknown ? `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">help</span>
      <div>The <span class="mono">users</span> table could not be read for ${esc(email || 'this account')}, so whether this account has a staff record is <strong>unknown</strong> — not absent. The read failed with <span class="mono">${esc(meErr)}</span>. Name, role and status below are blank for that reason and no other; they are not evidence that nothing is stored. Role-keyed behaviour elsewhere in the dashboard is running without a role until this read succeeds.</div></div>` : ''}
    <dl class="kv">
      <dt>Email</dt><dd>${esc(email || 'unknown')}</dd>
      <dt>Name</dt><dd>${ME?.name ? esc(ME.name) : meMissing('not set in users')}
        <span class="t-muted">·</span> ${phoneCell}</dd>
      <dt>Role</dt><dd>${ME?.role ? esc(ME.role) : meMissing('no role on record')}</dd>
      <dt>Account status</dt><dd>${ME?.status ? esc(ME.status) : meMissing('not set')}</dd>
      <dt>Auth user id</dt><dd class="mono">${esc(SESSION?.user?.id || 'unknown')}</dd>
      <dt>Access token</dt><dd>${exp
        ? `<span class="${exp.bad ? 't-hot' : ''}">${esc(exp.text)}</span>`
        : '<span class="t-muted">no expiry on the session object</span>'}</dd>
    </dl>
    <div class="cell-sub" style="margin-top:14px">${mePhone ? '' : esc(phoneWhy) + ' '}Passwords, email changes and account creation are handled by Supabase Auth, not by this dashboard. Roles are edited on the Team screen.</div>`;
  top.appendChild(prof);

  /* ── Environment ────────────────────────────────────────────────────────
     Exactly what this bundle was built against. "Which project am I actually
     looking at?" is the first question of every incident where staging data
     turns up in production, and until now it could only be answered by opening
     the deploy configuration. */
  let sbHost = null;
  try { sbHost = new URL(SUPABASE_URL).host; } catch { sbHost = null; }
  const projectRef = sbHost ? sbHost.split('.')[0] : null;
  const mode = import.meta.env.MODE || null;
  const hooks = Object.values(HOOK);

  /* Every VITE_ variable this bundle reads, and what breaks without it. env.js
     validates the two that must exist — it measures the value rather than
     testing it for truthiness, because a whole .env file pasted into one
     variable is a thing that actually happened here. The n8n base is optional
     in the sense that the app still boots, and precisely enumerated here in the
     sense that nothing which calls a workflow works without it. */
  const ENV_VARS = [
    { name: 'VITE_SUPABASE_URL', value: SUPABASE_URL,
      dead: 'Nothing on this dashboard can load — every screen reads through PostgREST.' },
    { name: 'VITE_SUPABASE_ANON_KEY', opaque: true,
      dead: 'Every request is rejected before it reaches a table, so every screen renders its error state.' },
    { name: 'VITE_N8N_BASE_URL', value: N8N_BASE,
      dead: 'Ask AI, the Finance Desk, drip enrolment, the ERP sync and WhatsApp replies all refuse outright — n8n() throws before it calls anything.' },
  ];
  const anonBroken = envErrors.some(e => /ANON_KEY/.test(e));

  const envCard = el('div', 'card');
  envCard.id = 'setEnvCard';
  envCard.innerHTML = `<div class="card-title" style="margin-bottom:4px">Environment</div>
    <div class="card-sub" style="margin-bottom:14px">What this build points at — configuration values only, never secrets</div>
    ${envErrors.length ? `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">error</span>
      <div>${envErrors.map(e => esc(e)).join('<br>')}</div></div>` : ''}
    ${!N8N_BASE ? `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">link_off</span>
      <div><span class="mono">VITE_N8N_BASE_URL</span> is not set, so every workflow call is disabled: Ask AI, Finance Desk, drip enrolment, WhatsApp replies and the ERP sync will refuse outright rather than fail halfway.</div></div>` : ''}
    <dl class="kv">
      <dt>Supabase project</dt><dd class="mono">${projectRef ? esc(projectRef) : '<span class="t-hot">could not be parsed</span>'}</dd>
      <dt>Supabase URL</dt><dd class="mono">${esc(SUPABASE_URL || 'not set')}</dd>
      <dt>Anon key</dt><dd>${anonBroken
        ? '<span class="t-hot">missing or malformed — see above</span>'
        : 'configured <span class="t-muted">· never shown here, in full or masked</span>'}</dd>
      <dt>n8n base</dt><dd class="mono">${N8N_BASE ? esc(N8N_BASE) : '<span class="t-hot">not set</span>'}</dd>
      <dt>Build mode</dt><dd class="mono">${mode ? esc(mode) : '<span class="t-muted">unknown</span>'}</dd>
      <dt>Served from</dt><dd class="mono">${esc(location.origin)}</dd>
    </dl>
    <div style="margin-top:16px">
      <div class="label-caps" style="margin-bottom:8px">Build-time variables</div>
      ${ENV_VARS.map(v => {
        const bad = v.opaque ? anonBroken : !str(v.value);
        return `<div class="list-item" style="cursor:default">
          <span class="material-symbols-outlined t-${bad ? 'hot' : 'ok'}" style="font-size:18px">${bad ? 'error' : 'check_circle'}</span>
          <div style="flex:1;min-width:0">
            <div class="mono" style="font-weight:500">${esc(v.name)}</div>
            <div class="cell-sub">${bad ? `<span class="t-hot">Missing or unusable.</span> ${esc(v.dead)}` : 'Set in this build.'}</div>
          </div></div>`;
      }).join('')}
    </div>
    <div class="banner info" style="margin-top:16px;margin-bottom:0">
      <span class="material-symbols-outlined" style="font-size:20px">lock</span>
      <div>API keys, service-role keys and webhook secrets are never displayed or accepted on this screen, masked or otherwise. They live in n8n and in the server environment.</div>
    </div>`;
  top.appendChild(envCard);

  /* ── Connectivity ───────────────────────────────────────────────────────
     renderIntegrations owns the probes themselves — a one-row Supabase read,
     the n8n /healthz endpoint, and a free finance-calc round trip. It is the
     same helper the Automation screen uses, so the two screens cannot disagree
     about what "reachable" means. */
  const conn = el('div', 'card'); conn.id = 'setConn'; conn.style.marginTop = '16px'; host.appendChild(conn);
  conn.innerHTML = `<div class="card-head" style="padding:0 0 14px">
      <div><div class="card-title">Connectivity</div>
        <div class="card-sub" id="setConnSub">Live checks against ${esc(projectRef || 'Supabase')} and the n8n health endpoint</div></div>
      <div style="flex:1"></div>
      <button class="btn sm" id="setRecheck">Re-run checks</button>
    </div>
    <div id="setIntg">${stateLoading(2)}</div>
    <div style="margin-top:18px">
      <div class="label-caps" style="margin-bottom:8px">Workflow endpoints this build will call</div>
      ${N8N_BASE
        ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${hooks
            .map(p => `<span class="chip mono">${esc(N8N_BASE)}/webhook/${esc(p)}</span>`).join('')}</div>`
        : `<div class="cell-sub t-hot">No base URL is configured, so none of these can be called: ${
            hooks.map(p => esc(p)).join(', ')}.</div>`}
      <div class="cell-sub" style="margin-top:8px">These are listed, not probed. Calling them to see whether they answer would do real work — <span class="mono">lead-trigger</span> enrols a customer in a drip campaign and <span class="mono">ask-ai</span> spends tokens — so a green dot here would cost more than it is worth. What they actually did is in the workflow table below, which reads what they logged.</div>
    </div>`;

  /* The tiles report into their own DOM and return nothing, and this screen may
     not re-run the checks itself: a screen calling the network directly is
     outside the helper contract, and a second probe would double the load on a
     one-vCPU box that has already been crashed twice by concurrent traffic. So
     the strip reads the result back off the tiles renderIntegrations rendered.
     Both outcomes are detected explicitly — the green dot and the red one — and
     anything else is reported as unreadable rather than as healthy: a silent
     fallback here would paint an outage green, which is the one thing this
     screen must never do. */
  const readProbes = () => {
    const node = $('setIntg');
    if (!node) return null;
    const out = [];
    node.querySelectorAll('.card').forEach(tile => {
      /* Not `div[...]`: renderIntegrations writes the name into a <div> while a
         check is pending and into a <span> once it resolves, so keying on the
         element type would read every finished tile as nameless and leave this
         strip saying "probing" through an outage. Match on the style only. */
      const name = str(tile.querySelector('[style*="font-weight:500"]')?.textContent);
      if (!name) return;
      const okDot  = tile.querySelector('span[style*="var(--ok)"]');
      const badDot = tile.querySelector('span[style*="var(--hot)"]');
      const msg = str(tile.querySelector('.cell-sub')?.textContent);
      out.push({
        name,
        state: okDot ? 'up' : badDot ? 'down' : /checking/i.test(msg) ? 'pending' : 'unknown',
        msg,
      });
    });
    return out.length ? out : null;
  };

  const PROBE_POLL_MS = 500;
  const PROBE_WINDOW_MS = 20000;
  let probeTimer = null;
  const watchProbes = () => {
    if (probeTimer) clearInterval(probeTimer);
    const started = Date.now();
    probeTimer = setInterval(() => {
      const node = $('setIntg');
      /* Navigating away replaces #screen wholesale; a timer left polling a
         detached tree would run until the tab closed. */
      if (!node || !document.body.contains(node)) { clearInterval(probeTimer); probeTimer = null; return; }
      probeState = readProbes();
      const done = (probeState || []).filter(p => AUTO_PROBE.test(p.name))
        .every(p => p.state === 'up' || p.state === 'down');
      if ((probeState && done) || Date.now() - started > PROBE_WINDOW_MS) {
        clearInterval(probeTimer); probeTimer = null;
      }
      renderAlerts();
    }, PROBE_POLL_MS);
  };

  const runChecks = () => {
    const sub = $('setConnSub');
    if (sub) sub.textContent = `Checks started ${clock(new Date().toISOString())} — each tile stamps its own result`;
    probeState = null;
    renderIntegrations($('setIntg'));
    watchProbes();
  };
  $('setRecheck').addEventListener('click', runChecks);
  runChecks();

  /* ── Wiring: workflows and credentials ──────────────────────────────────
     Placeholders now, filled when the batch below lands, so the cards sit in
     their final order instead of appearing underneath the knowledge base. */
  const wfCard = el('div', 'card flush'); wfCard.id = 'setWfCard';
  wfCard.style.marginTop = '16px'; host.appendChild(wfCard);
  wfCard.innerHTML = `<div class="card-head"><div><div class="card-title">Workflows</div>
    <div class="card-sub">Reading v_workflow_health…</div></div></div><div class="pbody">${stateLoading(5)}</div>`;

  const credCard = el('div', 'card flush'); credCard.id = 'setCredsCard';
  credCard.style.marginTop = '16px'; host.appendChild(credCard);
  credCard.innerHTML = `<div class="card-head"><div><div class="card-title">Credentials</div>
    <div class="card-sub">Reading the newest failed runs…</div></div></div><div class="pbody">${stateLoading(2)}</div>`;

  /* ── The system read ────────────────────────────────────────────────────
     One batch, settled individually. A shared catch would put one silence over
     four different faults, and naming which thing is broken is this screen's
     entire job.

     v_needs_attention is read WITHOUT the screen=eq.settings filter on purpose.
     This screen's own rows are the ones where screen='settings', and they are
     the only ones rendered as its own — but a workflow_failure row is
     system-health evidence wherever the view files it, and reading the view
     once and partitioning it here costs one request instead of two. Rows
     belonging to other screens are never presented as this screen's work: they
     are counted, attributed, and left where they belong. */
  const settle = p => p.then(v => ({ ok: true, value: v }), e => ({ ok: false, err: e?.message || 'Unknown error' }));
  const sysRead = Promise.all([
    settle(db(`v_needs_attention?select=kind,severity,ref,title,detail,at,screen&order=at.desc&limit=${ATTN_LIMIT}`)),
    settle(db('v_workflow_health?select=id,name,category,trigger_type,trigger_detail,description,is_active,'
      + `writes_audit_log,runs,failures,success_rate,last_run,runs_30d,failures_30d,last_failure,health&limit=${HEALTH_LIMIT}`)),
    /* Failures only. Per-workflow totals come from v_workflow_health, whose
       windows are documented; this read exists to carry the text of the
       failure, which is the only place a broken credential names itself. */
    settle(db(`audit_log?select=workflow,status,summary,logged_at&status=eq.FAILED&order=logged_at.desc&limit=${FAIL_LIMIT}`)),
    /* The registry is what ties an n8n workflow to the string it writes into
       audit_log. Without it the failure list falls back to matching on the
       display name, which is a weaker join — so the difference is stated rather
       than hidden behind a suspiciously short failure history. */
    settle(db('workflow_registry?select=id,name,audit_name,audit_aliases')),
  ]).then(([attn, health, fails, reg]) => {
    sysState = {
      attn: attn.ok ? attn.value : null, attnErr: attn.ok ? null : attn.err,
      health: health.ok ? health.value : null, healthErr: health.ok ? null : health.err,
      fails: fails.ok ? fails.value : null, failsErr: fails.ok ? null : fails.err,
      reg: reg.ok ? reg.value : null, regErr: reg.ok ? null : reg.err,
      readAt: new Date().toISOString(),
    };
    return sysState;
  });

  /* ── Alert computation ──────────────────────────────────────────────────
     Everything below is derived from reads this screen already made. Nothing
     here costs a round trip of its own, and every count names the read it came
     from so a smaller number can never quietly mean a failed one. */
  const credGroups = () => {
    const s = sysState;
    if (!s || !s.fails) return null;
    const groups = new Map();
    for (const rowF of s.fails) {
      const text = str(rowF.summary);
      if (!CRED_RE.test(text)) continue;
      const name = credName(text) || 'unnamed credential';
      let g = groups.get(low(name));
      if (!g) { g = { name, rows: [], workflows: new Set(), viewItems: [] }; groups.set(low(name), g); }
      g.rows.push(rowF);
      if (str(rowF.workflow)) g.workflows.add(str(rowF.workflow));
    }
    /* The same fault as reported by v_needs_attention. It is the same incident,
       so it joins the group rather than being counted a second time; where the
       view names a credential this read did not see, it becomes its own group,
       so a fault is never dropped for being in the wrong place. */
    for (const it of (s.attn || [])) {
      const text = `${str(it.title)} ${str(it.detail)}`;
      if (!CRED_RE.test(text)) continue;
      const name = credName(text) || 'unnamed credential';
      let g = groups.get(low(name));
      if (!g) { g = { name, rows: [], workflows: new Set(), viewItems: [] }; groups.set(low(name), g); }
      g.viewItems.push(it);
    }
    return [...groups.values()].map(g => {
      const times = g.rows.map(r => Date.parse(r.logged_at))
        .concat(g.viewItems.map(v => Date.parse(v.at)))
        .filter(t => !Number.isNaN(t));
      return {
        name: g.name,
        workflows: [...g.workflows],
        count: g.rows.length,
        viewCount: g.viewItems.length,
        newest: times.length ? new Date(Math.max(...times)).toISOString() : null,
        oldest: times.length ? new Date(Math.min(...times)).toISOString() : null,
      };
    }).sort((a, b) => (b.count + b.viewCount) - (a.count + a.viewCount));
  };

  function computeAlerts() {
    const out = [];
    const s = sysState;

    /* 1 · Configuration. No timestamp on these: they are the state of the
       build, not an event, and dressing them with an age would be invention. */
    envErrors.forEach((e, i) => out.push({
      key: `env${i}`, sev: 'CRITICAL', icon: 'settings_alert',
      title: 'This build is missing a required environment variable',
      detail: esc(e),
      foot: 'Compiled into the bundle at build time — fixing it means redeploying with the variable set, not changing anything from here.',
      target: 'setEnvCard',
    }));
    if (!N8N_BASE) out.push({
      key: 'env-n8n', sev: 'CRITICAL', icon: 'link_off',
      title: 'VITE_N8N_BASE_URL is not set, so no workflow can be called',
      detail: 'n8n() throws before it makes a request, which means Ask AI, the Finance Desk, drip enrolment, WhatsApp replies from Conversations and the ERP sync are all dead in this build — not slow, not intermittent: refused at the first line.',
      foot: 'Build-time configuration. The workflow table below still reads what n8n logged, because that comes from Supabase, not from n8n.',
      target: 'setEnvCard',
    });

    /* 2 · Session. An expired token is what a screen full of 401s looks like,
       and it is fixed by signing in again, not by anything on this page. */
    if (exp?.bad) out.push({
      key: 'session', sev: 'CRITICAL', icon: 'lock_clock',
      title: 'The access token on this session has expired',
      detail: `It ${esc(exp.text)}. supabase-js refreshes tokens in the background, so an expired one usually means the refresh itself is failing.`,
      target: 'setProfile',
    });
    /* Two different findings that were one alert until 24 Aug, and which of
       them is true depends entirely on meReadFailed(). Only the first is
       allowed to say the row does not exist. */
    if (noMeRow) out.push({
      key: 'no-me', sev: 'WARNING', icon: 'person_alert',
      title: 'This account has no row in users',
      detail: `${esc(email || 'The signed-in account')} can authenticate but has no name, role or status on record, so anything keyed on role treats it as unassigned. The users read succeeded and returned no row — that is what makes this an absence rather than a hole in what this screen knows.`,
      foot: 'Rows in users are created on the Team screen.',
      target: 'setProfile',
    });
    if (meUnknown) out.push({
      key: 'me-unread', sev: 'WARNING', icon: 'help',
      title: 'The users table could not be read, so this account’s staff record is unknown',
      detail: `Looking up ${esc(email || 'the signed-in account')} in <span class="mono">users</span> failed with: ${esc(meErr)}. Whether a staff row exists, and what role it carries, cannot be stated either way from here. This is not the finding above — it is the absence of the evidence that would settle it — and this screen used to report the two as the same thing.`,
      foot: 'Reload once the database is answering. Until then everything keyed on role is running without one, which is not the same as running as unassigned.',
      target: 'setProfile',
    });

    /* 3 · Reachability. Supabase is judged by this screen's own reads — the
       most direct evidence there is — and cross-checked against the tile. n8n
       has no evidence except the tile, and where the tile cannot be read the
       strip says exactly that rather than assuming either answer. */
    const probeFor = re => (probeState || []).find(p => re.test(p.name)) || null;
    const sbProbe = probeFor(/^supabase$/i);
    const n8nProbe = probeFor(/^n8n$/i);

    if (s && s.attnErr && s.healthErr && s.failsErr) out.push({
      key: 'sb-down', sev: 'CRITICAL', icon: 'cloud_off',
      title: 'Every Supabase read from this screen failed',
      detail: `All four queries came back with an error — v_workflow_health said: ${esc(s.healthErr)}. Nothing below this strip is a count of anything; the panels are empty because the database did not answer, not because the system is quiet.`,
      target: 'setConn',
    });
    else if (sbProbe?.state === 'down') out.push({
      key: 'sb-probe-down', sev: 'CRITICAL', icon: 'cloud_off',
      title: 'The Supabase connectivity check failed',
      detail: `The probe reported: ${esc(sbProbe.msg || 'no detail')}.${s && !s.healthErr ? ' This screen’s own reads did succeed, so the fault is narrower than “Supabase is down” — read what the probe actually said.' : ''}`,
      target: 'setConn',
    });

    if (N8N_BASE && n8nProbe?.state === 'down') out.push({
      key: 'n8n-down', sev: 'CRITICAL', icon: 'power_off',
      title: 'n8n is not reachable from this browser',
      detail: `The health endpoint at <span class="mono">${esc(N8N_BASE)}/healthz</span> reported: ${esc(n8nProbe.msg || 'no detail')}. Every workflow this dashboard calls goes to that host, so Ask AI, the Finance Desk, drip enrolment and WhatsApp replies will all fail while this is true. Workflows triggered inside n8n itself may still be running — this check says nothing about them.`,
      target: 'setConn',
    });

    /* 4 · Workflow states from v_workflow_health. Each of these findings is a
       different sentence, and only some of them are faults. */
    if (s?.healthErr) out.push({
      key: 'wf-read', sev: 'WARNING', icon: 'error',
      title: 'The workflow health view could not be read',
      detail: `v_workflow_health returned: ${esc(s.healthErr)}. This screen therefore cannot say whether any workflow is degraded, and the absence of a degraded-workflow alert below means nothing at all.`,
      target: 'setWfCard',
    });
    if (s?.health) {
      const rows = s.health;
      const deg = rows.filter(w => stateKey(w) === 'DEGRADED');
      const never = rows.filter(w => stateKey(w) === 'NEVER_RAN');
      /* Pages are split out of the blind-spot count deliberately. "Nothing it
         does reaches audit_log" is true of a static page and completely
         misleading — there is nothing to see inside it, so unmeasured is not a
         gap. Counting them here would put three URLs in a list of automations
         nobody can monitor. */
      const pages = rows.filter(isPublicPage);
      const blind = rows.filter(w => stateKey(w) === 'NOT_INSTRUMENTED' && !isPublicPage(w));
      const off = rows.filter(w => w.is_active === false);
      const odd = rows.filter(w => stateKey(w) === 'UNKNOWN');

      if (deg.length) {
        const f30 = deg.reduce((a, w) => a + (n0(w.failures_30d) || 0), 0);
        const last = deg.map(w => w.last_failure).filter(Boolean).sort().pop();
        const stillOn = deg.filter(w => w.is_active !== false).length;
        out.push({
          key: 'wf-degraded', sev: 'CRITICAL', icon: 'error',
          title: `${num(deg.length)} ${plural(deg.length, 'workflow is', 'workflows are')} degraded`,
          detail: `${esc(deg.map(w => str(w.name)).join(', '))} — ${num(f30)} failed ${plural(f30, 'run', 'runs')} inside the 30-day window v_workflow_health measures.${
            stillOn ? ` ${num(stillOn)} of ${plural(deg.length, 'them is', 'them are')} still active in n8n, which means n8n keeps running ${plural(stillOn, 'it', 'them')} and ${plural(stillOn, 'it keeps', 'they keep')} failing.` : ''}`,
          foot: last ? `Most recent failure ${esc(ago(last))}.` : 'v_workflow_health recorded no last_failure timestamp for these.',
          target: 'setWfCard', wf: 'DEGRADED',
        });
      }
      if (never.length) out.push({
        key: 'wf-never', sev: 'WARNING', icon: 'schedule',
        title: `${num(never.length)} ${plural(never.length, 'workflow has', 'workflows have')} never recorded a run`,
        detail: `${esc(never.map(w => str(w.name)).join(', '))} ${plural(never.length, 'is', 'are')} registered as writing to audit_log and ${plural(never.length, 'has', 'have')} never written a row. That is not evidence of health, it is the absence of evidence — ${plural(never.length, 'this workflow has', 'these workflows have')} never been observed working in this deployment.`,
        target: 'setWfCard', wf: 'NEVER_RAN',
      });
      if (blind.length) out.push({
        key: 'wf-blind', sev: 'INFO', icon: 'visibility_off',
        title: `${num(blind.length)} ${plural(blind.length, 'workflow reports', 'workflows report')} nothing at all`,
        detail: `${plural(blind.length, 'It has', 'They have')} no Audit Log node, so nothing ${plural(blind.length, 'it does', 'they do')} reaches audit_log and this dashboard cannot see ${plural(blind.length, 'it', 'them')} succeed or fail. Counted as healthy nowhere on this screen: unmeasured is not the same as working.`,
        foot: `The Automation screen separates out the few of these that answer their caller directly — those hand their result back in the HTTP reply, so a missing audit row is the design rather than a gap.${
          pages.length ? ` ${num(pages.length)} further registered ${plural(pages.length, 'row is a web page', 'rows are web pages')} and ${plural(pages.length, 'is', 'are')} excluded from this count — see below.` : ''}`,
        target: 'setWfCard', wf: 'NOT_INSTRUMENTED',
      });
      /* Its own row rather than a clause on the blind-spot alert, because it is
         true whether or not there is a blind spot to hang it off — and an
         operator counting workflows in n8n and here needs the difference
         explained wherever they look. */
      if (pages.length) out.push({
        key: 'wf-pages', sev: 'INFO', icon: 'public',
        title: `${num(pages.length)} registered ${plural(pages.length, 'row is a web page', 'rows are web pages')}, not ${plural(pages.length, 'an automation', 'automations')}`,
        detail: `${esc(pages.map(w => str(w.name)).join(', '))}. ${esc(PAGE_WHY)} ${plural(pages.length, 'It logs', 'They log')} nothing because a page view is not a workflow run, and a silent one here is correct rather than suspicious.`,
        foot: 'Publishing that consent screen is what stopped the Gmail refresh token expiring every seven days, so these are load-bearing. They are excluded from the not-logged count above: a page that logs nothing is not a blind spot.',
        target: 'setWfCard', wf: 'ALL',
      });
      if (off.length) out.push({
        key: 'wf-off', sev: 'WARNING', icon: 'toggle_off',
        title: `${num(off.length)} registered ${plural(off.length, 'workflow is', 'workflows are')} inactive in n8n`,
        detail: `${esc(off.map(w => str(w.name)).join(', '))} — an inactive workflow has no live webhook, so anything posting to it gets a 404 however well-formed the request is.`,
        target: 'setWfCard', wf: 'INACTIVE',
      });
      if (odd.length) out.push({
        key: 'wf-odd', sev: 'WARNING', icon: 'help',
        title: `${num(odd.length)} ${plural(odd.length, 'workflow reports', 'workflows report')} a health state this screen has no wording for`,
        detail: `Reported verbatim as ${esc([...new Set(odd.map(w => str(w.health) || 'null'))].join(', '))} rather than folded into one of the states it might mean.`,
        target: 'setWfCard', wf: 'ALL',
      });
    }

    /* 5 · Credentials. Why this belongs on Settings rather than Automation: a
       broken credential is not one workflow misbehaving, it is a whole channel
       switched off underneath every workflow that uses it. */
    if (s?.failsErr) out.push({
      key: 'cred-read', sev: 'WARNING', icon: 'error',
      title: 'Failed runs could not be read, so credential faults cannot be reported',
      detail: `audit_log returned: ${esc(s.failsErr)}. A broken credential names itself only in the text of the failure it causes, so with this read down the credentials panel is blank for lack of evidence, not for lack of faults.`,
      target: 'setCredsCard',
    });
    /* Severity stays CRITICAL even where the newest evidence is a day old — a
       credential nobody has proved fixed is not a lesser fault — but the tense
       does not. "Is failing" about a fault repaired this morning sends someone
       to reconnect a credential that already works. */
    (credGroups() || []).forEach(g => {
      const stale = credStale(g.newest);
      /* A run that exercised this credential after its last failure and got an
         answer. Stronger evidence than the silence `stale` reasons about, so it
         is checked first and it changes the severity, not just the tense: a
         credential proved working is not a critical fault, and leaving it red
         is how a strip full of resolved incidents stops being read. */
      const ok = credVerified(g.name, g.newest);
      out.push({
        key: `cred-${low(g.name)}`,
        sev: ok ? 'INFO' : 'CRITICAL',
        icon: ok ? 'key' : 'key_off',
        title: ok
          ? `The ${g.name} credential was failing and has since been verified working`
          : stale
            ? `The ${g.name} credential was failing, and nothing since proves it is fixed`
            : `The ${g.name} credential is failing`,
        detail: `${ok || stale ? 'While it was failing: ' : ''}${esc(credImpact(g.name, g.workflows))}<div class="cell-sub" style="margin-top:4px">${
          g.count ? `${num(g.count)} failed ${plural(g.count, 'run', 'runs')} among the newest ${num(FAIL_LIMIT)} logged failures name it` : 'No failed audit row in this window names it'}${
          g.viewCount ? `, and v_needs_attention reports ${num(g.viewCount)} open ${plural(g.viewCount, 'item', 'items')} about it` : ''}${
          g.workflows.length ? ` · seen failing in ${esc(g.workflows.join(', '))}` : ''}.${
          ok ? ` Those rows are the incident, not the current state: ${esc(ok.how)}, after the newest of them. They will keep appearing here until they fall out of the ${num(FAIL_LIMIT)}-row window, and v_needs_attention will keep listing them until its own 24-hour window ages them out.` : ''}</div>`,
        foot: ok
          ? `${esc(ok.fix)} Most recent failure ${esc(ago(g.newest))}; confirmed working ${esc(ago(ok.at))}.`
          : g.newest
            ? `Most recent ${esc(ago(g.newest))}${g.oldest && g.oldest !== g.newest ? `, first seen in this window ${esc(ago(g.oldest))}` : ''}.${stale ? ` ${esc(CRED_STALE_LINE)}` : ''}`
            : '',
        target: 'setCredsCard',
      });
    });

    /* 6 · Ask AI has nothing to answer from. Derived from the knowledge-base
       read this screen already performs — no extra request. */
    if (kbState?.err) out.push({
      key: 'kb-read', sev: 'WARNING', icon: 'error',
      title: 'The knowledge base could not be read',
      detail: `rag_documents returned: ${esc(kbState.err)}. What Ask AI is allowed to answer from is therefore unknown from here.`,
      target: 'setKbCard',
    });
    else if (kbState && kbState.count === 0) out.push({
      key: 'kb-empty', sev: 'WARNING', icon: 'description',
      title: 'The knowledge base is empty',
      detail: 'rag_documents holds no rows, so Ask AI has nothing to retrieve and nothing to cite. A question asked there is answered from the model alone or not at all.',
      target: 'setKbCard',
    });

    return out.sort((a, b) => sevRank(a.sev) - sevRank(b.sev));
  }

  /* ── The strip ──────────────────────────────────────────────────────────── */
  function renderAlerts() {
    const bodyHost = $('setAlertBody');
    if (!bodyHost) return; /* navigated away while a read was in flight */
    const s = sysState;

    /* The view's own rows for this screen, kept separate from what this screen
       worked out for itself: one is the database's finding and the other is
       this file's, and merging them would let a bug here look like a row
       there. */
    const mine = (s?.attn || []).filter(it => str(it.screen) === 'settings');
    const elsewhere = (s?.attn || []).filter(it => str(it.screen) !== 'settings');
    const wfElsewhere = elsewhere.filter(it => it.kind === 'workflow_failure');

    const alerts = computeAlerts();
    /* What needs a human: CRITICAL and WARNING, not the informational findings.

       This number used to be written straight into `#badge-settings`, and it is
       not any more. lib/badges.js owns every nav badge: it clears all of them
       and repaints them from ONE read of v_needs_attention on boot, every 60
       seconds and on visibilitychange. So a write from here survived less than a
       minute — and worse, `durable.length + mine.length` is not reproducible
       from that view at all, because most of these findings are derived on this
       screen and exist nowhere else. The sidebar therefore said one number while
       Settings was open and a different one a minute later, and neither could be
       explained by opening anything. The count belongs here, next to the rows it
       counts, where clicking it lands on the evidence. */
    const durable = alerts.filter(a => a.sev === 'CRITICAL' || a.sev === 'WARNING');
    const tally = $('setAlertCount');
    if (tally) {
      const n = durable.length + mine.length;
      tally.innerHTML = n
        ? pill(`${n} need${n === 1 ? 's' : ''} attention`, durable.some(a => a.sev === 'CRITICAL') ? 'hot' : 'warm')
        : (s ? pill('clear', 'ok') : '');
    }

    const viewRows = mine.map(it => {
      const sev = str(it.severity);
      return `<div class="list-item" style="cursor:default">
        <span class="material-symbols-outlined t-${esc(sevTone(sev) || 'muted')}" style="font-size:20px">${esc(KIND_ICON[it.kind] || 'warning')}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${sev ? pill(sev, sevTone(sev)) : ''}${esc(str(it.title) || str(it.kind) || 'Attention item')}
            <span class="chip">${esc(str(it.kind) || 'item')}</span>
          </div>
          <div class="cell-sub">${esc(str(it.detail))}</div>
          <div class="cell-sub t-muted">${it.at
            ? `Waiting since ${esc(clock(it.at))} — ${esc(ago(it.at))}`
            : 'The view gave this item no timestamp, so how long it has been waiting is unknown.'}</div>
        </div></div>`;
    }).join('');

    const derivedRows = alerts.map(a => `
      <div class="list-item" role="button" tabindex="0" data-target="${esc(a.target)}"${a.wf ? ` data-wf="${esc(a.wf)}"` : ''}
        title="Show the panel this is about">
        <span class="material-symbols-outlined t-${esc(sevTone(a.sev) || 'muted')}" style="font-size:20px">${esc(a.icon)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${pill(a.sev, sevTone(a.sev))}${esc(a.title)}
          </div>
          <div class="cell-sub">${a.detail}</div>
          ${a.foot ? `<div class="cell-sub t-muted">${a.foot}</div>` : ''}
        </div>
        <span class="material-symbols-outlined t-muted" style="font-size:18px">chevron_right</span>
      </div>`).join('');

    /* What was actually checked, and what could not be. A screen that quietly
       drops a failed read reports fewer alerts and looks healthier for it. */
    const checked = [
      !s ? 'v_needs_attention: still reading'
        : s.attnErr ? 'v_needs_attention: unreadable'
        : `v_needs_attention: ${num(mine.length)} row${plural(mine.length, '', 's')} for this screen`,
      !s ? 'v_workflow_health: still reading'
        : s.healthErr ? 'v_workflow_health: unreadable'
        : `v_workflow_health: ${num(s.health.length)} workflow${plural(s.health.length, '', 's')}`,
      !s ? 'failed runs: still reading'
        : s.failsErr ? 'audit_log: unreadable'
        : `audit_log: newest ${num(s.fails.length)} failed run${plural(s.fails.length, '', 's')}`,
      !probeState ? 'connectivity: probing'
        : (() => {
            const named = probeState.filter(p => AUTO_PROBE.test(p.name));
            const down = named.filter(p => p.state === 'down').map(p => p.name);
            const unread = named.filter(p => p.state !== 'up' && p.state !== 'down').map(p => p.name);
            if (down.length) return `connectivity: ${down.join(', ')} down`;
            if (unread.length) return `connectivity: ${unread.join(', ')} not readable`;
            return 'connectivity: Supabase and n8n both answered';
          })(),
      !kbState ? 'knowledge base: still reading'
        : kbState.err ? 'knowledge base: unreadable'
        : `knowledge base: ${num(kbState.count)}${kbState.capped ? '+' : ''} section${plural(kbState.count, '', 's')}`,
    ];
    const subNode = $('setAlertSub');
    if (subNode) subNode.textContent = checked.join(' · ');

    const probeUnread = (probeState || []).filter(p => AUTO_PROBE.test(p.name) && p.state !== 'up' && p.state !== 'down');
    const notes = [
      s?.attnErr ? `v_needs_attention is unreadable (${s.attnErr}), so any item the database itself filed against this screen is missing from the list above, and the count in the header covers only what this screen worked out for itself. The nav badge is painted from that same view by lib/badges.js, so it is blank right now for the same reason — not because there is nothing behind it.` : '',
      s && s.attn && s.attn.length >= ATTN_LIMIT ? `The attention read is capped at ${num(ATTN_LIMIT)} rows and hit the cap, so items beyond it are outside this window rather than absent.` : '',
      s && s.fails && s.fails.length >= FAIL_LIMIT ? `The failure read is capped at ${num(FAIL_LIMIT)} rows and hit the cap, so a credential that last failed before that is not counted above. Per-workflow failure totals in the table below come from v_workflow_health and are unaffected by this cap.` : '',
      s?.regErr ? `workflow_registry is unreadable (${s.regErr}), so failures are matched to workflows by display name only. A workflow that logs under a different name than it is registered with will show fewer failures here than it really had.` : '',
      probeState && probeUnread.length ? `The connectivity tile for ${probeUnread.map(p => p.name).join(', ')} did not resolve into a result this strip could read, so no claim is made either way about it — read the tile itself.` : '',
      wfElsewhere.length ? `${num(wfElsewhere.length)} workflow-failure ${plural(wfElsewhere.length, 'item is', 'items are')} filed by v_needs_attention against the Automation screen rather than this one. ${plural(wfElsewhere.length, 'It is', 'They are')} not listed above as this screen's work; ${plural(wfElsewhere.length, 'it feeds', 'they feed')} the credential check only.` : '',
      `The count beside this card's title is ${num(durable.length)} critical or warning ${plural(durable.length, 'item', 'items')} this screen derived${mine.length ? ` plus ${num(mine.length)} v_needs_attention ${plural(mine.length, 'row', 'rows')} filed against this screen` : ' and nothing else'}${s ? '' : ' so far — the database reads have not landed yet, so this figure can only rise'}. Informational findings are listed but not counted.`,
      `That count is deliberately not the nav badge. lib/badges.js paints every badge from one read of v_needs_attention, so the sidebar counts only the rows that view files against this screen — a missing environment variable, an expired token or a credential named inside a failure exist nowhere but here and cannot be reproduced from it. This screen used to write its own badge, and the sidebar then disagreed with itself a minute later, when badges.js repainted from the view.`,
    ].filter(Boolean);

    /* Two things this row must never say. It must not claim the view returned
       nothing when the view could not be read — that is the difference between
       a clean screen and a blind one — and it must not appear at all while the
       reads are still in flight, because "nothing needs attention" arriving
       half a second before the first alert is exactly the reassurance this
       strip exists to withhold. */
    const attnUnread = !!(s && s.attnErr);
    const nothing = `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined t-${attnUnread ? 'muted' : 'ok'}" style="font-size:20px">${attnUnread ? 'help' : 'task_alt'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500">${attnUnread
          ? 'Nothing this screen could check for itself is wrong'
          : 'Nothing on this screen needs attention right now'}</div>
        <div class="cell-sub">${attnUnread
          ? 'v_needs_attention could not be read, so whether the database has filed anything against this screen is unknown'
          : 'v_needs_attention returned no row for this screen'}${s && !s.healthErr
          ? ', no registered workflow is degraded, inactive or still waiting for its first run, and no failed run in the window read here names a credential'
          : ''}${envErrors.length ? '' : ', and every environment variable this build needs is set'}.</div>
      </div></div>`;

    const stillReading = `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined t-muted" style="font-size:20px">hourglass_top</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500">Still checking</div>
        <div class="cell-sub">v_needs_attention, v_workflow_health and the newest failed runs have not answered yet, so anything they would report is missing from this list. The configuration findings above do not depend on them.</div>
      </div></div>`;

    const notesRow = notes.length ? `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
      <div class="cell-sub" style="white-space:normal">${notes.map(esc).join('<br>')}</div></div>` : '';

    bodyHost.innerHTML = viewRows + derivedRows
      + (!s ? stillReading : (alerts.length || mine.length ? '' : nothing))
      + notesRow;

    /* An alert that only describes a problem is a poster. Every derived alert
       carries the id of the panel showing the thing it is about, and the
       workflow ones also set that panel's filter, so the click lands on the
       rows rather than near them. Keyboard-operable, because this row is the
       only route from the alert to its evidence. */
    bodyHost.querySelectorAll('[data-target]').forEach(node => {
      const jump = () => {
        if (node.dataset.wf) setWfFilter(node.dataset.wf);
        const dest = $(node.dataset.target);
        if (dest) dest.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
      node.addEventListener('click', jump);
      node.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
      });
    });
  }
  renderAlerts();

  /* ── Workflows ──────────────────────────────────────────────────────────
     Every registered workflow and the state v_workflow_health reports for it.
     Automation owns the deep history; this table answers the narrower Settings
     question — is the automation wired up, and which parts of it have never
     proved they work. */
  const WF_FILTERS = [
    { key: 'ALL', label: 'All' },
    { key: 'DEGRADED', label: 'Degraded' },
    { key: 'NEVER_RAN', label: 'Never ran' },
    { key: 'NOT_INSTRUMENTED', label: 'Not logged' },
    { key: 'HEALTHY', label: 'Clean' },
    { key: 'INACTIVE', label: 'Inactive' },
  ];
  const matchFilter = (w, key) =>
    key === 'ALL' ? true : key === 'INACTIVE' ? w.is_active === false : stateKey(w) === key;

  let wfFilter = 'ALL';
  let drawWf = null;          /* assigned once the table has rendered */
  const setWfFilter = key => {
    wfFilter = key;
    if (drawWf) drawWf();
  };

  sysRead.then(s => {
    renderAlerts();

    if (s.healthErr) {
      wfCard.innerHTML = `<div class="card-head"><div><div class="card-title">Workflows</div>
        <div class="card-sub">v_workflow_health could not be read</div></div></div>
        <div class="pbody">${stateError('workflow health', s.healthErr)}</div>`;
      credCard.innerHTML = `<div class="card-head"><div><div class="card-title">Credentials</div>
        <div class="card-sub">Faults n8n reported in the text of a failed run</div></div></div>
        <div class="pbody">${renderCreds()}</div>`;
      wireCreds();
      return;
    }

    const rows = (s.health || []).slice().sort((a, b) =>
      healthOf(a).rank - healthOf(b).rank
      || ((n0(b.failures_30d) || 0) - (n0(a.failures_30d) || 0))
      || String(a.name || '').localeCompare(String(b.name || '')));

    const active = rows.filter(w => w.is_active !== false).length;
    const counts = {};
    WF_FILTERS.forEach(f => { counts[f.key] = rows.filter(w => matchFilter(w, f.key)).length; });

    /* The registry join, used only to attribute failures. Where it is missing
       the fallback is the display name, and the shortfall is stated rather than
       shown as a shorter, healthier-looking history. */
    const regById = new Map((s.reg || []).map(r => [String(r.id), r]));
    const namesFor = w => {
      const r = regById.get(String(w.id));
      const set = new Set();
      [w.name, r?.name, r?.audit_name, ...(Array.isArray(r?.audit_aliases) ? r.audit_aliases : [])]
        .filter(Boolean).forEach(n => set.add(low(n)));
      return set;
    };
    const failsFor = w => {
      if (!s.fails) return null;
      const names = namesFor(w);
      return s.fails.filter(f => names.has(low(f.workflow)));
    };

    wfCard.innerHTML = `<div class="card-head">
        <div><div class="card-title">Workflows</div>
          <div class="card-sub">${num(rows.length)} registered · ${num(active)} active in n8n · state and 30-day counts from <span class="mono">v_workflow_health</span>, read ${esc(clock(s.readAt))}</div></div>
        <div style="flex:1"></div>
        <button class="btn sm" id="setWfAutomation">Open Automation</button>
      </div>
      <div class="toolbar">
        <div class="seg" id="setWfSeg" role="group" aria-label="Filter workflows by state">
          ${WF_FILTERS.filter(f => f.key === 'ALL' || counts[f.key])
            .map(f => `<button type="button" data-f="${f.key}" class="${f.key === wfFilter ? 'on' : ''}"
              aria-pressed="${f.key === wfFilter ? 'true' : 'false'}">${esc(f.label)} <span class="t-muted">${num(counts[f.key])}</span></button>`).join('')}
        </div>
      </div>
      <div id="setWfList"></div>
      <div class="pbody" style="padding-top:0">
        <div class="cell-sub" style="white-space:normal">${[
          'Active means n8n will run the workflow. It does not mean the workflow succeeds — an active workflow with a revoked credential runs on every trigger and fails on every trigger, and both of those are true at once.',
          'Not logged is not a pass. Those workflows have no Audit Log node, so nothing they do reaches audit_log; they are left uncoloured because this dashboard has no evidence either way, and colouring them green would manufacture some.',
          'No runs yet is the same kind of absence: registered to log, never logged, never observed working.',
          'This list is the automation register. The n8n instance also carries the three published workflows that serve NEXUS’s public home, privacy and terms pages — Google requires all three before an OAuth consent screen can go to production, and it rejects vercel.app as a public suffix — so a count taken in n8n is larger than the count here. Where one of those pages is registered it is labelled "web page" and left out of the not-logged count: a page that logs nothing is not a blind spot.',
          rows.length >= HEALTH_LIMIT ? `The read is capped at ${num(HEALTH_LIMIT)} workflows and hit the cap, so this is a window rather than the whole register.` : '',
          s.failsErr ? `Failure detail is unavailable (${s.failsErr}), so a workflow's drawer shows its counts but not the text of what went wrong.` : '',
        ].filter(Boolean).map(esc).join('<br>')}</div>
      </div>`;

    $('setWfAutomation').addEventListener('click', () => go('automation'));

    drawWf = () => {
      const seg = $('setWfSeg');
      if (!seg) return;
      seg.querySelectorAll('button').forEach(b => {
        const on = b.dataset.f === wfFilter;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      const list = rows.filter(w => matchFilter(w, wfFilter));
      const listHost = $('setWfList');
      if (!listHost) return;
      listHost.innerHTML = table([
        { label: 'Workflow', strong: true, render: w => `
          <div>${esc(str(w.name) || 'Unnamed workflow')}${
            isPublicPage(w) ? ` <span class="chip" title="${esc(PAGE_NOTE)}">web page</span>` : ''}</div>
          <div class="cell-sub">${esc([str(w.category), str(w.trigger_type)].filter(Boolean).join(' · ') || 'no category recorded')}${
            w.is_active === false
              ? ' · <span class="t-warm">inactive in n8n — its webhook is not live</span>'
              : ' · <span class="t-muted" title="n8n will run this workflow. That is all it means: it says nothing about whether the run succeeds.">active</span>'}</div>` },
        { label: 'State', render: w => {
          const h = healthOf(w);
          return `<span title="${esc(h.blurb)}">${pill(h.label, h.t)}</span>${
            stateKey(w) === 'UNKNOWN' ? `<div class="cell-sub mono">${esc(str(w.health) || 'null')}</div>` : ''}`;
        } },
        { label: 'Runs 30 d', align: 'r', render: w => {
          const r = n0(w.runs_30d);
          return r == null ? '<span class="t-muted">—</span>' : num(r);
        } },
        { label: 'Failed 30 d', align: 'r', render: w => {
          const f = n0(w.failures_30d);
          if (f == null) return '<span class="t-muted">—</span>';
          return f ? `<span class="t-hot">${num(f)}</span>` : num(0);
        } },
        { label: 'Success 30 d', align: 'r', render: w => {
          const r = rate30(w);
          /* No runs means no rate. Printing 0% or 100% for a workflow that has
             never run would state a result the data does not contain. */
          return r == null
            ? '<span class="t-muted" title="No logged runs inside the 30-day window, so there is no rate to compute.">—</span>'
            : esc(pct(r));
        } },
        { label: 'Last run', align: 'r', render: w => w.last_run
          ? esc(ago(w.last_run))
          : '<span class="t-muted">never</span>' },
      ], list, {
        empty: stateEmpty('No workflow in that state', 'Nothing in v_workflow_health matches this filter right now.', 'filter_alt'),
        onRow: true,
      });
      wireRows(listHost, list, openWf);
    };

    function openWf(w) {
      const h = healthOf(w);
      const fails = failsFor(w);
      const shown = (fails || []).slice(0, 6);
      const r30 = n0(w.runs_30d), f30 = n0(w.failures_30d);
      const viewRate = n0(w.success_rate);
      const own30 = rate30(w);
      openDrawer(`
        <div class="drawer-head">
          <div style="flex:1">
            <h2 style="font-size:18px">${esc(str(w.name) || 'Unnamed workflow')}</h2>
            <div class="cell-sub">${esc([str(w.category), str(w.trigger_type), str(w.trigger_detail)].filter(Boolean).join(' · ') || 'no trigger recorded')}</div>
          </div>
          <button class="btn ghost sm" id="wfClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div class="drawer-body">
          <div class="section">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${pill(h.label, h.t)}
              ${w.is_active === false
                ? '<span class="chip" title="No live webhook in n8n. Anything posting to it gets a 404.">Inactive</span>'
                : '<span class="chip" title="n8n will run this workflow. It is not a statement about whether the run succeeds.">Active in n8n</span>'}
              ${w.writes_audit_log ? '' : '<span class="chip" title="No Audit Log node, so nothing it does reaches audit_log.">Writes no audit row</span>'}</div>
            <div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(h.blurb)}</div>
            ${w.description ? `<div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(str(w.description))}</div>` : ''}
          </div>
          <div class="section" style="margin-top:20px">
            <div class="label-caps">What the view reports</div>
            <dl class="kv" style="margin-top:10px">
              <dt>Runs, 30 days</dt><dd>${r30 == null ? '<span class="t-muted">not reported</span>' : num(r30)}</dd>
              <dt>Failures, 30 days</dt><dd>${f30 == null ? '<span class="t-muted">not reported</span>' : num(f30)}</dd>
              <dt>Success, 30 days</dt><dd>${own30 == null
                ? '<span class="t-muted">no runs in the window, so no rate exists</span>'
                : `${esc(pct(own30))} <span class="t-muted">· computed here from runs_30d and failures_30d</span>`}</dd>
              <dt>Runs, all time</dt><dd>${num(n0(w.runs) ?? 0)}</dd>
              <dt>Failures, all time</dt><dd>${num(n0(w.failures) ?? 0)}</dd>
              <dt>success_rate</dt><dd>${viewRate == null
                ? '<span class="t-muted">not reported</span>'
                : `${esc(pct(viewRate))} <span class="t-muted">· the view's own figure, over its own window</span>`}</dd>
              <dt>Last run</dt><dd>${w.last_run ? esc(ago(w.last_run)) + ` <span class="t-muted mono">${esc(clock(w.last_run))}</span>` : '<span class="t-muted">never</span>'}</dd>
              <dt>Last failure</dt><dd>${w.last_failure ? `<span class="t-hot">${esc(ago(w.last_failure))}</span>` : '<span class="t-muted">none recorded</span>'}</dd>
            </dl>
            ${own30 != null && viewRate != null && Math.abs(own30 - viewRate) > 0.1
              ? '<div class="cell-sub" style="margin-top:8px;white-space:normal">The two rates differ. They are not the same measurement — the first is the documented 30-day window, the second is the view’s own column over its own window — so neither is corrected against the other here.</div>'
              : ''}
          </div>
          <div class="section" style="margin-top:20px">
            <div class="label-caps">Recent failures</div>
            ${fails == null
              ? `<div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(`audit_log could not be read (${s.failsErr || 'unknown error'}), so the text of any failure is unavailable. The counts above come from v_workflow_health and are unaffected.`)}</div>`
              : shown.length
                ? shown.map(f => `<div class="list-item" style="cursor:default;align-items:flex-start;flex-direction:column;gap:4px">
                    <div class="cell-sub mono">${esc(clock(f.logged_at))} · ${esc(ago(f.logged_at))}</div>
                    <div class="cell-sub" style="white-space:pre-wrap">${esc(str(f.summary) || 'The workflow logged a failure with no summary text.')}</div>
                  </div>`).join('')
                : `<div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(`No row among the newest ${FAIL_LIMIT} failed runs is attributed to this workflow. ${w.writes_audit_log ? 'Either it has not failed inside that window, or it logs under a name the registry does not list.' : 'It writes no audit row at all, so it could not appear here whatever it did.'}`)}</div>`}
            ${fails && fails.length > shown.length ? `<div class="cell-sub" style="margin-top:8px">${esc(`${fails.length - shown.length} older failures in this window are not shown. The Automation screen holds the full history.`)}</div>` : ''}
          </div>
        </div>
        <div class="drawer-foot">
          <button class="btn ghost" id="wfClose2">Close</button>
          <div style="flex:1"></div>
          <button class="btn" disabled title="Running a workflow by hand needs an n8n endpoint for it. The HOOK map holds only the webhooks this dashboard is meant to call with a real subject record, and firing one from here to see whether it works would do real work — enrol a customer, send a message, spend tokens.">Run now</button>
        </div>`);
      $('wfClose').addEventListener('click', closeDrawer);
      $('wfClose2').addEventListener('click', closeDrawer);
    }

    drawWf();
    $('setWfSeg').querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => setWfFilter(b.dataset.f)));

    credCard.innerHTML = `<div class="card-head"><div><div class="card-title">Credentials</div>
      <div class="card-sub">Faults n8n reported in the text of a failed run — the only credential evidence a browser can have</div></div></div>
      <div class="pbody">${renderCreds()}</div>`;
    wireCreds();
  });

  /* Rendered from the same failure read the strip used — no second round trip.
     There is deliberately no repair control: n8n's credential store is not
     reachable from a browser, and the only honest button is a disabled one that
     says where the fix actually happens. */
  function renderCreds() {
    const s = sysState;
    if (!s) return stateLoading(2);
    if (s.failsErr) {
      return stateError('credential faults',
        `${s.failsErr}. A broken credential names itself only inside the failure it causes, so with audit_log unreadable this panel has no evidence to show — which is not the same as there being none.`);
    }
    const groups = credGroups() || [];
    if (!groups.length) {
      return stateEmpty('No credential fault in this window',
        `None of the newest ${FAIL_LIMIT} failed runs mentions a credential. That covers the failures that were logged: a workflow with no Audit Log node could be failing on a credential right now and would not appear here.`,
        'key');
    }
    return `<div>${groups.map(g => {
      const ok = credVerified(g.name, g.newest);
      return `
      <div class="list-item" style="cursor:default;align-items:flex-start;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%">
          <span class="material-symbols-outlined t-${ok ? 'ok' : 'hot'}" style="font-size:20px">${ok ? 'key' : 'key_off'}</span>
          <span style="font-weight:500">${esc(g.name)}</span>
          ${ok ? pill('Verified working', 'ok') : pill('CRITICAL', 'hot')}
          <div style="flex:1"></div>
          <button class="btn sm" disabled title="${esc(NO_CRED_FIX)}">Reconnect</button>
        </div>
        ${ok ? `<div class="cell-sub" style="white-space:normal"><strong>This is history, not the current state.</strong> ${esc(ok.how)} — after the newest failure below. ${esc(ok.fix)}</div>` : ''}
        <div class="cell-sub" style="white-space:normal">${ok || credStale(g.newest) ? 'While it was failing: ' : ''}${esc(credImpact(g.name, g.workflows))}</div>
        <div class="cell-sub">${g.count
          ? `${num(g.count)} failed ${plural(g.count, 'run', 'runs')} among the newest ${num(FAIL_LIMIT)} logged failures name it`
          : 'No failed audit row in this window names it'}${
          g.viewCount ? ` · v_needs_attention reports ${num(g.viewCount)} open ${plural(g.viewCount, 'item', 'items')} about it` : ''}${
          g.newest ? ` · most recent ${esc(ago(g.newest))}` : ''}</div>
        ${!ok && credStale(g.newest) ? `<div class="cell-sub t-muted" style="white-space:normal">${esc(CRED_STALE_LINE)}</div>` : ''}
        ${g.workflows.length
          ? `<div class="cell-sub">Seen failing in: ${g.workflows.map(w =>
              `<button type="button" class="chip" style="border:0;cursor:pointer;font-family:inherit" data-wf-name="${esc(w)}"
                title="Show this in the workflow table above">${esc(w)}</button>`).join(' ')}</div>`
          : '<div class="cell-sub t-muted">No failed run in this window records which workflow it belongs to.</div>'}
      </div>`;
    }).join('')}
      <div class="list-item" style="cursor:default">
        <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
        <div class="cell-sub" style="white-space:normal">${esc(NO_CRED_FIX)}</div>
      </div></div>`;
  }

  /* The workflow chips are the route from "this credential is broken" to the
     rows it broke, which is the point of listing them at all. The filter is
     cleared first, so the table cannot come up empty on a workflow the chip
     just promised was there. */
  function wireCreds() {
    credCard.querySelectorAll('[data-wf-name]').forEach(node => {
      node.addEventListener('click', () => {
        setWfFilter('ALL');
        const dest = $('setWfCard');
        if (dest) dest.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /* ── Knowledge base ─────────────────────────────────────────────────────
     The documents Ask AI is permitted to answer from. Sections are the unit
     actually retrieved, so both counts are shown: an operator who sees "6
     documents" and gets a thin answer needs to know whether those six were
     chunked into 400 sections or into 6. */
  const kb = el('div', 'card flush'); kb.id = 'setKbCard'; kb.style.marginTop = '16px'; host.appendChild(kb);

  const kbShell = (sub, body) => {
    kb.innerHTML = `<div class="card-head">
        <div><div class="card-title">Knowledge base</div><div class="card-sub">${sub}</div></div>
        <div style="flex:1"></div>
        <button class="btn ghost sm" id="kbReload" aria-label="Reload the knowledge base">
          <span class="material-symbols-outlined">refresh</span></button>
      </div><div id="kbBody">${body}</div>`;
    $('kbReload').addEventListener('click', loadKb);
  };

  async function loadKb() {
    kbShell('What Ask AI is allowed to answer from', stateLoading(4));
    try {
      /* One probe row to learn the shape, then a targeted select. Two round
         trips is the price of not guessing a column name. */
      const probe = await db('rag_documents?select=*&limit=1');
      if (!probe.length) {
        /* An empty knowledge base is a finding, not just an empty panel: Ask AI
           answers from nothing. The strip is told from this read; it does not
           repeat it. */
        kbState = { count: 0, docs: 0, capped: false, err: null };
        renderAlerts();
        kbShell('What Ask AI is allowed to answer from',
          stateEmpty('No documents indexed',
            'rag_documents is empty, so Ask AI has nothing to retrieve and nothing to cite. A document has to be ingested before it can answer anything.',
            'description'));
        return;
      }
      const cols = Object.keys(probe[0]);
      const titleKey = pickKey(cols, TITLE_KEYS);
      const textKey  = pickKey(cols, TEXT_KEYS);
      const dateKey  = pickKey(cols, DATE_KEYS);
      let sel = [...new Set([titleKey, textKey, ...META_KEYS].filter(k => k && cols.includes(k)))];
      if (!sel.length) sel = cols.filter(c => !HEAVY_KEYS.includes(c));

      const rows = await db(`rag_documents?select=${sel.join(',')}${titleKey ? `&order=${titleKey}` : ''}&limit=${KB_LIMIT}`);
      renderKb({
        rows, cols, titleKey, textKey, dateKey,
        hasPage: cols.includes('page_number'),
        hasSrc:  cols.includes('source_file'),
        hasSect: cols.includes('section'),
        capped:  rows.length >= KB_LIMIT,
        readAt:  new Date().toISOString(),
      });
    } catch (e) {
      kbState = { count: null, docs: null, capped: false, err: e.message };
      renderAlerts();
      kbShell('What Ask AI is allowed to answer from', stateError('the knowledge base', e.message));
    }
  }

  function renderKb(d) {
    const { rows, cols, titleKey, textKey, dateKey, hasPage, hasSrc, hasSect, capped, readAt } = d;

    /* Group sections into documents. A section with no title cannot be
       attributed to one, so it is bucketed explicitly and counted — folding
       those into the first real document would overstate that document. */
    const groups = new Map();
    let untitled = 0;
    for (const r of rows) {
      const raw = titleKey ? String(r[titleKey] ?? '').trim() : '';
      if (!raw) untitled++;
      const key = raw || ' untitled';
      let g = groups.get(key);
      if (!g) {
        g = { title: raw, secs: [], chars: textKey ? 0 : null, sources: new Set(), pages: [], last: null };
        groups.set(key, g);
      }
      g.secs.push(r);
      if (textKey) g.chars += String(r[textKey] ?? '').length;
      if (hasSrc && r.source_file) g.sources.add(String(r.source_file));
      if (hasPage) { const p = n0(r.page_number); if (p != null) g.pages.push(p); }
      if (dateKey && r[dateKey]) {
        const t = Date.parse(r[dateKey]);
        if (!Number.isNaN(t) && (g.last == null || t > g.last)) g.last = t;
      }
    }
    const docs = [...groups.values()];
    const totalChars = textKey ? docs.reduce((a, g) => a + g.chars, 0) : null;

    kbState = { count: rows.length, docs: docs.length, capped, err: null };
    renderAlerts();

    const sub = `${num(docs.length)} document${docs.length === 1 ? '' : 's'} · ${num(rows.length)} retrievable section${rows.length === 1 ? '' : 's'}${
      totalChars != null ? ` · ${charText(totalChars)} indexed` : ''} · read ${esc(clock(readAt))}`;

    kbShell(sub, `
      ${capped ? `<div class="banner warm" style="margin:16px 16px 0"><span class="material-symbols-outlined" style="font-size:20px">filter_alt</span>
        <div>Showing the first ${num(KB_LIMIT)} sections only. The knowledge base is larger than this listing, so the totals above are a floor rather than a count.</div></div>` : ''}
      ${untitled ? `<div class="banner warm" style="margin:16px 16px 0"><span class="material-symbols-outlined" style="font-size:20px">help</span>
        <div>${num(untitled)} section${untitled === 1 ? ' has' : 's have'} no <span class="mono">${esc(titleKey || 'title')}</span> value, so ${untitled === 1 ? 'it cannot' : 'they cannot'} be attributed to a document. Ask AI can still retrieve ${untitled === 1 ? 'it' : 'them'}, but a citation will have nothing to name.</div></div>` : ''}
      ${!titleKey ? `<div class="banner warm" style="margin:16px 16px 0"><span class="material-symbols-outlined" style="font-size:20px">info</span>
        <div>rag_documents has no recognised title column, so sections cannot be grouped by document. Columns returned: <span class="mono">${esc(cols.join(', '))}</span>.</div></div>` : ''}
      ${!dateKey ? `<div class="banner info" style="margin:16px 16px 0"><span class="material-symbols-outlined" style="font-size:20px">schedule</span>
        <div><span class="mono">rag_documents</span> carries no timestamp of any kind — no <span class="mono">created_at</span>, no <span class="mono">updated_at</span>, nothing this read could find. So <strong>how fresh this knowledge base is cannot be answered from the data</strong>, and this panel does not guess one: inferring an ingest date from <span class="mono">id</span> order would be invention dressed as a fact. If Ask AI is citing a price list that was superseded a month ago, nothing on this screen will show it — the only way to know is to re-run the ingestion and compare. Columns returned: <span class="mono">${esc(cols.join(', '))}</span>.</div></div>` : ''}
      <div class="toolbar">
        <div class="seg" id="kbSeg" role="group" aria-label="Sort documents">
          <button type="button" data-s="name" class="on" aria-pressed="true">By name</button>
          <button type="button" data-s="size" aria-pressed="false">${textKey ? 'Largest first' : 'Most sections'}</button>
        </div>
        <div class="grow">
          <label class="sr-only" for="kbQ">Search the knowledge base</label>
          <input type="search" id="kbQ" placeholder="Search document, section or source file" />
        </div>
      </div>
      <div id="kbList"></div>`);

    const f = { sort: 'name', q: '' };

    const draw = () => {
      const q = low(f.q);
      const list = docs.filter(g => !q
        || low(g.title).includes(q)
        || [...g.sources].some(s => low(s).includes(q))
        || (hasSect && g.secs.some(r => low(r.section).includes(q))));

      list.sort((a, b) => f.sort === 'size'
        ? (textKey ? b.chars - a.chars : b.secs.length - a.secs.length)
        : String(a.title || 'zzzz').localeCompare(String(b.title || 'zzzz')));

      const tcols = [
        { label: 'Document', strong: true, render: g => `
          <div>${g.title ? esc(g.title) : '<span class="t-muted">Untitled sections</span>'}</div>
          ${g.sources.size
            ? `<div class="cell-sub">${esc([...g.sources].slice(0, 2).join(', '))}${g.sources.size > 2 ? ` +${g.sources.size - 2} more` : ''}</div>`
            : hasSrc ? '<div class="cell-sub t-muted">no source file recorded</div>' : ''}` },
        { label: 'Sections', align: 'r', render: g => num(g.secs.length) },
      ];
      if (textKey) tcols.push({ label: 'Size', align: 'r', render: g => charText(g.chars) });
      if (hasPage) tcols.push({ label: 'Pages', align: 'r', render: g => {
        if (!g.pages.length) return '<span class="t-muted">—</span>';
        const lo = Math.min(...g.pages), hi = Math.max(...g.pages);
        return esc(lo === hi ? String(lo) : `${lo}–${hi}`);
      } });
      if (dateKey) tcols.push({ label: 'Indexed', align: 'r', render: g =>
        g.last ? esc(ago(new Date(g.last).toISOString())) : '<span class="t-muted">—</span>' });

      const listHost = $('kbList');
      listHost.innerHTML = table(tcols, list, {
        empty: stateEmpty('No document matches', 'Nothing in the knowledge base matches that search.', 'search_off'),
        onRow: true,
      });
      wireRows(listHost, list, openDoc);
    };

    function openDoc(g) {
      const secs = g.secs.slice().sort((a, b) => (n0(a.page_number) ?? 0) - (n0(b.page_number) ?? 0));
      openDrawer(`
        <div class="drawer-head">
          <div style="flex:1">
            <h2 style="font-size:18px">${g.title ? esc(g.title) : 'Untitled sections'}</h2>
            <div class="cell-sub">${num(g.secs.length)} retrievable section${g.secs.length === 1 ? '' : 's'}${
              textKey ? ` · ${charText(g.chars)}` : ''}</div>
          </div>
          <button class="btn ghost sm" id="kbClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div class="drawer-body">
          <div class="section">
            <div class="label-caps">Document</div>
            <dl class="kv" style="margin-top:10px">
              <dt>Source files</dt><dd>${g.sources.size ? esc([...g.sources].join(', ')) : '<span class="t-muted">none recorded</span>'}</dd>
              <dt>Sections</dt><dd>${num(g.secs.length)}</dd>
              ${textKey ? `<dt>Indexed size</dt><dd>${charText(g.chars)}</dd>` : ''}
              ${hasPage ? `<dt>Pages</dt><dd>${g.pages.length
                ? esc(`${Math.min(...g.pages)}–${Math.max(...g.pages)}`)
                : '<span class="t-muted">not recorded</span>'}</dd>` : ''}
              ${dateKey ? `<dt>Last indexed</dt><dd>${g.last
                ? esc(ago(new Date(g.last).toISOString()))
                : '<span class="t-muted">not recorded</span>'}</dd>` : ''}
            </dl>
          </div>
          <div class="section" style="margin-top:20px">
            <div class="label-caps">Sections as stored</div>
            ${secs.map((r, i) => {
              const body = textKey ? String(r[textKey] ?? '') : '';
              const meta = [
                hasPage && n0(r.page_number) != null ? `page ${n0(r.page_number)}` : null,
                hasSrc && r.source_file ? String(r.source_file) : null,
                textKey ? charText(body.length) : null,
              ].filter(Boolean);
              return `<div class="list-item" style="cursor:default;align-items:flex-start;flex-direction:column;gap:4px">
                <div style="font-weight:500">${hasSect && r.section ? esc(r.section) : `Section ${i + 1}`}</div>
                <div class="cell-sub">${meta.length ? esc(meta.join(' · ')) : '<span class="t-muted">no section metadata</span>'}</div>
                ${textKey
                  ? (body
                      ? `<div class="cell-sub" style="white-space:pre-wrap;margin-top:4px">${esc(body.slice(0, PREVIEW_CHARS))}${body.length > PREVIEW_CHARS ? '…' : ''}</div>`
                      : '<div class="cell-sub t-muted" style="margin-top:4px">This section is stored empty, so retrieving it returns nothing.</div>')
                  : ''}
              </div>`;
            }).join('')}
          </div>
          ${!textKey ? `<div class="cell-sub" style="margin-top:14px">rag_documents returned no recognised text column, so section contents and sizes cannot be shown. Columns available: <span class="mono">${esc(cols.join(', '))}</span>.</div>` : ''}
        </div>
        <div class="drawer-foot">
          <button class="btn ghost" id="kbClose2">Close</button>
          <div style="flex:1"></div>
          <button class="btn" disabled title="${esc(NO_KB_EDIT)}">Edit document</button>
        </div>`);
      $('kbClose').addEventListener('click', closeDrawer);
      $('kbClose2').addEventListener('click', closeDrawer);
    }

    const seg = $('kbSeg');
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      f.sort = b.dataset.s;
      seg.querySelectorAll('button').forEach(x => {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
      });
      draw();
    }));
    $('kbQ').addEventListener('input', e => { f.q = e.target.value; draw(); });
    draw();
  }

  loadKb();

  /* ── Appearance ─────────────────────────────────────────────────────────
     applyDensity() reads the saved preference and puts the `compact` class on
     <body>. It is the only thing lib/prefs.js exports. Calling it first means
     the control below starts on whatever was actually saved, read back off the
     body class rather than out of storage — a screen may not touch storage
     directly, and reimplementing the read here would let the two disagree.
     Changing the setting therefore lasts for this session only, which the panel
     states outright rather than quietly forgetting the choice on reload. */
  applyDensity();
  const savedCompact = document.body.classList.contains('compact');
  const DENSITIES = [
    { id: 'comfortable', label: 'Comfortable', hint: 'Roomier rows, easier to scan across a wide table.' },
    { id: 'compact',     label: 'Compact',     hint: 'More rows per screen, for long registers like Compliance and Automation.' },
  ];
  const isOn = id => (id === 'compact') === savedCompact;

  const look = el('div', 'card'); look.style.marginTop = '16px'; host.appendChild(look);
  look.innerHTML = `<div class="card-title" style="margin-bottom:4px">Appearance</div>
    <div class="card-sub" style="margin-bottom:14px">How tightly tables are packed</div>
    <div class="seg" id="setDensity" role="group" aria-label="Table density">
      ${DENSITIES.map(d => `<button type="button" data-d="${d.id}" class="${isOn(d.id) ? 'on' : ''}"
        aria-pressed="${isOn(d.id) ? 'true' : 'false'}">${esc(d.label)}</button>`).join('')}
    </div>
    <div class="cell-sub" id="setDensityHint" style="margin-top:10px">${
      esc(DENSITIES.find(d => isOn(d.id)).hint)}</div>
    <div class="banner info" style="margin-top:16px;margin-bottom:0">
      <span class="material-symbols-outlined" style="font-size:20px">info</span>
      <div>${esc(NO_PERSIST)}</div>
    </div>`;

  const dseg = $('setDensity');
  dseg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    document.body.classList.toggle('compact', b.dataset.d === 'compact');
    dseg.querySelectorAll('button').forEach(x => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', x === b ? 'true' : 'false');
    });
    $('setDensityHint').textContent = DENSITIES.find(d => d.id === b.dataset.d).hint;
  }));

  /* The screen is not finished until its own reads are: returning earlier would
     let nav.js call it done while three panels still say "loading". */
  await sysRead;
};
