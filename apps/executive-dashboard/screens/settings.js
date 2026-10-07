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
     · This screen starts no workflow execution of its own. Not on mount, not
       on "Re-run checks", not on a timer. Webhook endpoints are listed and
       never probed — firing lead-trigger to see whether it answers would enrol
       a real customer in a real drip campaign.
       That rule was written here on 20 Aug and broken in the same breath: the
       shared connectivity panel probed `finance-calc` on every mount and on
       every re-check, and that workflow writes an audit_log row on every
       invocation, refusals included. 52 of Finance Calc's 60 runs inside the
       30-day window were manufactured by people opening this page — written
       into the very table the Workflows and Credentials cards below read and
       report on, so the success rate printed here was computed over this
       screen's own noise. A monitoring screen may not mutate the state it is
       monitoring. What runs automatically now is a one-row Supabase select and
       a GET on n8n's /healthz, and the screen names that pair where it mounts
       the panel rather than inheriting whatever the shared helper decides.
     · One control here does call a workflow, and a person has to press it:
       "Test" on the Ask AI tile posts to ask-ai. That spends OpenRouter tokens
       and Ask-AI — RAG Query Agent writes an audit row, so a click adds a run
       to the numbers below. It is never automatic and it says what it costs
       before it is pressed. "Side-effect-free" is a claim about what this
       screen does by itself, and it must not be written any wider than that.
     · A second control writes, added nx1004 on 21 Sep 2026: the Team card's
       invite button, for an account this dealership's own tenant_members
       marks OWNER (canInviteTeam — fail-open on an unread membership, the
       same as every other canX() in lib/data.js, because the refusal that
       matters is the Edge Function's, not this card's guess). It posts to
       the founder-invite Edge Function over lib/data.js's edgeFn(), carrying
       only the signed-in user's own JWT — never a service-role key, which
       exists nowhere in this bundle. The Edge Function re-derives the
       caller's authority itself (nexus_is_platform_admin(), then this
       dealership's own tenant_members row) before doing anything, so an
       admin who is not an owner would be refused there even if this card's
       own gate were deleted entirely. See screens/founder.js and
       supabase/functions/founder-invite/README.md for the shared contract —
       this card is the OWNER half of it; the founder half lives there.
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
import { HOOK, ME, SESSION, canInviteTeam, db, edgeFn, meReadFailed } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { N8N_BASE, SUPABASE_URL, envErrors } from '../lib/env.js';
import { ago, clock, dubaiTime, esc, initials, n0, num, pct, tone } from '../lib/format.js';
import { HEALTH_WORDS, OUTCOME, healthWords, outcomeOf, outcomeWords } from '../lib/health.js';
import { renderIntegrations } from '../lib/integrations.js';
import { NAV, SCREENS, flatNav, go } from '../lib/nav.js';
import { applyDensity, readFlag, writeFlag } from '../lib/prefs.js';
import { PALETTE_PREF } from '../lib/command-palette.js';
import { sectionHeader, statusChip, trustFooter } from '../lib/stitch-ui.js';
import { hiddenTestCount, privacyOn, setPrivacy, setShowTestRecords, showTestRecords } from '../lib/privacy.js';
import { tenantLabel, tenantState } from '../lib/tenant.js';
import { closeDrawer, wireRows } from '../lib/ui.js';
import { BTN, bannerClass, openDrawer, pill, stateEmpty, stateError, stateLoading, table, toneText } from '../lib/admin-kit.js';

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
  'Density applies to this session only. NEXUS can read a saved preference but nothing here can save one yet, so this choice is not remembered.';

const NO_KB_EDIT =
  'Editing the knowledge base is not built. Your documents is written by the ingestion workflow and no endpoint accepts a document from the browser.';

/* The control exists and is disabled, rather than absent, so nobody is left
   wondering whether it was ever built. What it must NOT do is hand the
   dealership the vendor's repair runbook: which console the credential lives
   in, what it is called there and why no endpoint exists are CONTROL-PLANE.md
   Part 4 material, and a disabled button's tooltip is still a panel someone
   reads. The dealership's half is that it is broken, that NEXUS reconnects it,
   and that this screen can only report what the break caused. */
const NO_CRED_FIX =
  'Reconnecting this is NEXUS\u2019s to do — there is no way to do it from this dashboard, by design. What this screen can do is report what the broken connection has cost you, which is below.';

/* v_needs_attention has no branch that files anything against this screen. Its
   seven UNION ALL branches emit screen = leads (twice), inventory, competitors,
   automation, compliance and conversations, and there is no settings arm at
   all. So the partition this screen filters out of it is empty on every read
   and always will be, and an empty partition must not be reported as the
   database having looked at Settings and found it clean. It never looked. */
const NO_ATTN_BRANCH =
  'The attention list files nothing against this screen — its rows carry screen = leads, inventory, competitors, automation, compliance or conversations, and the view has no settings branch — so an empty result here is the view never having been asked about Settings, not a verdict that Settings is clean. Everything in this strip is worked out on this screen from its own reads.';

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

/* ── A few register entries are published web pages, not automations ───────
   `NEXUS Public — Home`, `— Privacy` and `— Terms` are pages NEXUS publishes.
   They will never log a run — a page view is not a workflow run — so a silent
   one is correct rather than a blind spot, and they are labelled rather than
   hidden.

   WHY the vendor publishes them, over which hostname, and at which paths was
   spelled out here until 5 Sep 2026 and is now gone: it is the vendor's
   operational arrangement and its infrastructure topology, which
   CONTROL-PLANE.md Part 4 puts on Ali's side of the glass. The webhook-path
   arm of the test below went with it — `trigger_detail` is a control-plane
   column and no longer reaches this screen at all (see the note in
   screens/automation.js), so a test against it would silently match nothing
   while looking like it still worked.

   The same rule lives in screens/automation.js. It is stated twice rather than
   shared because lib/ is not this task's to change; if a third screen needs it,
   it belongs in lib/format.js beside tone(). */
const isPublicPage = w =>
  /nexus\s*public/i.test(String(w?.name || ''))
  || /^\s*[—-]\s*(?:privacy|terms)\s*$/i.test(String(w?.name || ''));
/* What starts a workflow, and why this screen never says it is unrecorded.
   `trigger_type` and `trigger_detail` are control-plane columns: the n8n
   trigger kind, the cron expressions and the webhook paths. A dealership is
   entitled to know whether its automation is running; where the job lives and
   how it is reached is the vendor's. So an empty trigger here is never evidence
   of an empty register — it is a column this session did not ask for and may
   not have. Worded the same way as screens/automation.js's TRIGGER_NOT_AVAILABLE
   deliberately: one fact, one sentence, two screens. */
const TRIGGER_NOT_AVAILABLE =
  'NEXUS operates the trigger and the schedule for this workflow, and this dashboard is not permitted to read either \u2014 a boundary, not a gap. The cadence is on file, on the vendor\u2019s side of it; nothing here is waiting for you to enter one.';

/* One reason, worded once, so the chip tooltip and the alert cannot drift. */
const PAGE_WHY =
  'It is a page NEXUS publishes rather than an automation of yours.';
const PAGE_NOTE = `This is a web page, not an automation — ${PAGE_WHY} It logs nothing because a page view is not a workflow run, and it never will.`;

/* Icons for the kinds v_needs_attention emits. Only a fallback: the view names
   its own `screen`, and a kind this file has never seen still renders. */
const KIND_ICON = {
  unanswered_chat: 'mark_chat_unread', lead_unassigned: 'person_alert', sla_breach: 'timer',
  kyc_archive_gap: 'folder_off', workflow_failure: 'error', undercut: 'trending_down',
  inventory_aging: 'directions_car',
};

/* ── Health vocabulary ─────────────────────────────────────────────
   The label, the tone and the blurb are no longer written here. They come from
   lib/health.js, which mirrors public.nexus_outcome_class() and is the only
   place in this app allowed to decide what an audit_log status means.

   This file used to carry its own HEALTH_WORDS, and a private vocabulary is a
   private opinion about production: four screens each had one, each counted
   only FAILED as a failure, and Competitor Price Scraping therefore read
   “Clean, 30 d — every run inside the window succeeded” while 73 of its 84 runs
   produced no price at all. The states the view can now return are seven, not
   four, and this screen is not entitled to invent wording for any of them.

   What stays local is presentation — an icon and a sort rank per state —
   because neither is a claim about the data. The icons are the ones the alert
   strip uses for the same states, read from here rather than typed twice, so
   the strip and the table cannot illustrate one state two different ways.
   Worst first: the two states that need a human, then the states that are an
   absence of evidence, then the one green state last. The tone comes from HEALTH_WORDS rather than from tone() in
   lib/format.js, because that table has never been taught PRODUCING_NOTHING,
   NO_QUALIFYING_RUNS or UNKNOWN_OUTCOME and its fallback for a word it does not
   know is the neutral 'unknown' grey — right for two of those three, and wrong
   for PRODUCING_NOTHING, which is a fault. */
const HEALTH_LOOK = {
  DEGRADED:           { icon: 'error',             rank: 0 },
  PRODUCING_NOTHING:  { icon: 'block',             rank: 1 },
  UNKNOWN_OUTCOME:    { icon: 'help',              rank: 2 },
  NEVER_RAN:          { icon: 'schedule',          rank: 3 },
  NO_QUALIFYING_RUNS: { icon: 'do_not_disturb_on', rank: 4 },
  NOT_INSTRUMENTED:   { icon: 'visibility_off',    rank: 5 },
  HEALTHY:            { icon: 'check_circle',      rank: 6 },
};
/* A health string lib/health.js has no entry for is deliberately NOT folded
   into UNKNOWN_OUTCOME. That is a real state of the view and it means one
   specific thing — the workflow logged a status the database has no class for.
   This is the other case: the VIEW returned a word this frontend has never
   heard. Both are unknowns, and they are unknowns about different things. */
const UNKNOWN_HEALTH = {
  label: 'Unrecognised', t: 'unknown', icon: 'help', rank: 2,
  blurb: 'The automation health figures returned a health state neither this screen nor NEXUS has wording for. It is shown verbatim rather than folded into one of the states it might mean — a word nobody taught the shared vocabulary is not a pass, and it is not cold either.',
};
const stateKey = w => (Object.prototype.hasOwnProperty.call(HEALTH_WORDS, up(w?.health)) ? up(w.health) : 'UNKNOWN');
const healthOf = w => {
  const k = stateKey(w);
  if (k === 'UNKNOWN') return UNKNOWN_HEALTH;
  const words = healthWords(k);
  return { ...words, ...HEALTH_LOOK[k], t: words.tone };
};

/* The 30-day rate is the view's figure, read rather than recomputed.

   What stood here until 31 Aug 2026 was `(runs_30d - failures_30d) / runs_30d`,
   and because failures_30d counted only status='FAILED', every REJECTED,
   PARTIAL and NOT_EXECUTED row scored as a success: Competitor Price Scraping
   printed 100.0% over 84 runs of which 73 produced no price, and Finance Calc
   printed 91.7% on three successes in sixty runs. v_workflow_health now
   classifies every row through nexus_outcome_class() and divides successes_30d
   by effective_runs_30d, with refusals and deliberate escalations out of the
   denominator so that an unauthorised call cannot dilute a real miss rate.
   There is no arithmetic left to do here, and this screen must not invent any.

   null means no qualifying run. That is not 0% and it is not 100%; the caller
   renders the reason instead of a number. */
const rate30 = w => n0(w?.success_rate_30d);
/* Runs that did not deliver: outright failures plus half-landed deliveries. A
   PARTIAL is not a lesser failure — the customer got the reply and the record
   of it did not land — so the two are added, and broken apart again wherever
   there is room to say which was which. */
const incomplete30 = w => {
  const f = n0(w?.failures_30d), p = n0(w?.partials_30d);
  return f == null && p == null ? null : (f || 0) + (p || 0);
};
/* Runs that did not deliver at all: the two above plus the runs that completed
   without erroring and produced nothing usable. The three are added because the
   dealership feels them identically — no quote, no message, no record — and
   broken apart wherever there is room, because the fix for each is different.
   Refusals and deliberate escalations are NOT in here: those are the system
   working, and counting them as misses is how a real miss rate gets diluted. */
const undelivered30 = w => {
  const bad = incomplete30(w), none = n0(w?.no_result_30d);
  return bad == null && none == null ? null : (bad || 0) + (none || 0);
};
const NO_RATE_WHY = 'No run inside the 30-day window counts toward a rate — either nothing ran, or every run was refused by design, and refusals are excluded from the denominator. There is no percentage to state: it is not 0% and it is not 100%.';
/* Three different absences reach the no-rate branch and they are not the same
   fact. A workflow that never ran, a workflow that cannot report, and a
   workflow whose every run was refused by design are told apart here rather
   than sharing one em dash and one sentence. */
const noRateWhy = w => {
  switch (stateKey(w)) {
    case 'NEVER_RAN':
      return 'Nothing has been logged for this workflow, so there is no rate. That is an absence of evidence, not a score of zero.';
    case 'NOT_INSTRUMENTED':
      return 'This workflow writes no audit row at all, so nothing it did can be counted here. From this screen, running perfectly and failing every time look identical.';
    case 'NO_QUALIFYING_RUNS':
      return 'Every run inside the window was refused by design. Refusals are excluded from the denominator so an unauthorised caller cannot dilute a real miss rate, which leaves nothing to divide by.';
    default:
      return NO_RATE_WHY;
  }
};
/* The same seven counters as rows, for the drawer, where there is room to show
   every one instead of a sentence. Label, column, and what the column means —
   the wording follows OUTCOME_WORDS in lib/health.js, because these ARE those
   outcomes counted up, and two names for one thing is how the last set of
   private vocabularies started. */
const OUTCOME_ROWS = [
  ['Succeeded', 'successes_30d', 'Did the whole job it was started to do.'],
  ['Landed half-done', 'partials_30d', 'A step the workflow claimed did not land. The customer may hold a reply the database has no record of.'],
  ['Failed', 'failures_30d', 'The run could not complete.'],
  ['Produced nothing usable', 'no_result_30d', 'It ran without erroring and produced no result. Not a crash, and not a success either.'],
  ['Refused by design', 'rejected_30d', 'An unauthorised or invalid request the workflow was right to turn away. Excluded from the rate so it cannot dilute a real miss rate.'],
  ['Escalated to a person', 'escalated_30d', 'Handed to a human on purpose. Excluded from the rate.'],
  ['Unrecognised status', 'unknown_30d', 'The row carried a status NEXUS’s own rule for what a run achieved has no class for, so nothing is claimed about it.'],
];

/* The breakdown behind the rate, in one sentence, entirely out of the view's
   own counters. Shown on hover next to every figure derived from them, so the
   number and the rows it came from are never more than a pointer apart. */
const runsBreakdown = w => {
  const r = n0(w?.runs_30d);
  if (r == null) return 'The automation health figures reports no 30-day counters for this workflow.';
  if (!r) return 'No run at all was logged inside the 30-day window.';
  const parts = [
    [n0(w?.successes_30d), 'succeeded outright'],
    [n0(w?.partials_30d), 'went out half-done'],
    [n0(w?.failures_30d), 'failed'],
    [n0(w?.no_result_30d), 'ran and produced nothing usable'],
    [n0(w?.rejected_30d), 'were refused by design and are excluded from the rate'],
    [n0(w?.escalated_30d), 'were handed to a person on purpose and are excluded from the rate'],
    [n0(w?.unknown_30d), 'logged a status this system has no class for'],
  ].filter(([n]) => n).map(([n, word]) => `${num(n)} ${word}`);
  return parts.length
    ? `${num(r)} logged ${plural(r, 'run', 'runs')} in the window: ${parts.join(', ')}.`
    : `${num(r)} logged ${plural(r, 'run', 'runs')} in the window, none of which the view classified — which is a fault in the writer, not a pass.`;
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
/* What stops working, keyed by the CHANNEL the evidence names, and matched
   against each failing row's own text rather than against the group it landed
   in. Until 31 Aug this was one `find()` over the group name concatenated with
   every workflow name in the group, so whichever member matched first spoke for
   all of them: seven failing escalation emails and two failing Bitrix reads
   shared a single row that read "the ERP/CRM sync cannot write". A manager saw
   one broken credential where there were two, was sent to the wrong system, and
   was never told that hot-lead escalation had been failing for a fortnight.

   The word boundaries are deliberate. `erp` unanchored matches "interpret" and
   `meta` matches "metallic", and these regexes are run over free text a model
   wrote — an escalation briefing runs to kilobytes of prose about a customer. */
const CRED_IMPACT = [
  { key: 'email', label: 'Email',
    re: /gmail|smtp|\be-?mail\b|outlook|sendgrid|resend|postmark/i,
    line: 'Outbound email is dead. Anything that mails a customer — hot-lead escalation briefings, the cold-lead drip, quote mail, and the nightly mail aggregation the Customer 360 totals are built from — reaches the send step and fails there. Enrolments still queue; nothing leaves.' },
  { key: 'slack', label: 'Slack',
    re: /slack/i,
    line: 'Slack alerting is dead. A hot lead can be scored and routed correctly and still reach nobody, because the last step is the one that cannot authenticate.' },
  { key: 'whatsapp', label: 'WhatsApp',
    re: /whatsapp|waha|twilio|\bmeta\b/i,
    line: 'WhatsApp sending is affected: a reply posted from Conversations can be accepted by the workflow and still never reach the customer.' },
  { key: 'erp', label: 'ERP/CRM',
    re: /odoo|bitrix|\berp\b|\bcrm\b|xml-?rpc/i,
    /* Writes are the half that works on the current Bitrix24 plan — `crm.*`
       reads already answer 403 there regardless of credential, which is a plan
       limit and not a fault this panel can see. So a credential failure on this
       channel takes out the only direction that was still working. */
    line: 'The CRM sync cannot write, so records created here stop mirroring outward and the two systems drift apart silently. Writing is the only direction that works at all — nothing is ever read back from the CRM — so this fault removes the half that was functioning.' },
  { key: 'model', label: 'Model provider',
    re: /openrouter|openai|anthropic|\bgpt\b|gemini/i,
    line: 'The model calls fail, so leads arrive unscored and Ask AI answers nothing.' },
  { key: 'db', label: 'Database',
    re: /supabase|postgres|database/i,
    line: 'The workflow cannot reach the database, so whatever it was supposed to record was not recorded.' },
];
/* Only the head of a summary is scanned for a channel. These writers put the
   error first and the payload after, and the payload is not evidence about a
   credential: an escalation briefing quotes the customer's own gmail address
   two kilobytes in, and a Lexus spec sheet is not a statement about Bitrix. */
const CRED_SCAN_CHARS = 300;
const credScan = text => String(text || '').slice(0, CRED_SCAN_CHARS);
const credChannels = text => CRED_IMPACT.filter(c => c.re.test(String(text || ''))).map(c => c.key);
const CRED_IMPACT_UNKNOWN = 'Every run listed here fails at the step that presents this credential. Which channel that is cannot be read out of the text those runs logged, so nothing narrower is claimed.';
/* One sentence per channel the group's own rows actually name. A group whose
   evidence names two channels is two faults, and it says both, labelled —
   never the first one speaking for the rest. */
const credImpact = channels => {
  const hits = CRED_IMPACT.filter(c => channels.includes(c.key));
  if (!hits.length) return CRED_IMPACT_UNKNOWN;
  if (hits.length === 1) return hits[0].line;
  return hits.map(h => `${h.label} — ${h.line}`).join(' ');
};
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
/* ── There is deliberately no "verified working" state ─────────────────────
   There was one until 31 Aug 2026, and it was a fact about production asserted
   from a literal in this source file: a hard-coded `at: '2026-08-24T19:46:00Z'`
   with the note that a manual Customer 360 run had returned Gmail → ok. It
   softened the Gmail row to a green "Verified working" pill and dropped its
   severity out of the tally. It stayed green because the panel read only
   status=eq.FAILED, so the eight newer PARTIAL rows from Customer 360 — the
   newest 2026-08-29, reading "Gmail read failed" — were invisible to the very
   comparison that was supposed to keep it honest. A date typed into a source
   file outranked six days of contradicting evidence sitting in the table below.

   Two rules come out of that and both are enforced here. A credential's state
   is read from data or it is not claimed at all: nothing in this file may
   assert that a credential works. And the read must be wide enough to see the
   evidence that would disagree, which is why the failure read below now takes
   PARTIAL rows too — a half-landed delivery is exactly where a credential fault
   surfaces once the workflow has learned to carry on around it.

   What survives is the staleness rule above, which claims nothing: it says only
   that nothing has named this credential for a day, and says in the same breath
   that silence is not proof of repair. */

const CRED_STALE_LINE = 'No logged failure has named it since, so it may already have been reconnected — but this panel reads failure history, not the credential, so a fixed credential and one whose workflows simply have not run again look identical from here. The next run is what settles it.';

/* ── The only checks this screen lets run without a person asking ──────────
   Both are reads: one row out of Supabase, and a GET on n8n's /healthz. This
   list is passed INTO renderIntegrations rather than left to the helper's own
   defaults, and it is the same list the strip is entitled to raise an alarm
   about, so "what was checked" and "what may be complained about" cannot drift
   apart.

   The constraint, written here so nobody re-adds it: a check that runs by
   itself on this screen may not cause a workflow execution. Every execution
   this dashboard causes lands in audit_log, and audit_log is what the Workflows
   and Credentials cards below read and report on — a monitoring screen that
   writes to the table it monitors is reporting on itself. `finance-calc` was
   probed here until 31 Aug on the grounds that the calculator is pure
   JavaScript and therefore free; the calculation is free and the invocation is
   not, and 52 of that workflow's 60 runs in the window were people opening this
   page. Anything that can only be checked by running it is listed as unprobed.

   The Ask AI tile is excluded for a second reason: it is not auto-probed at all
   (a call spends OpenRouter tokens), so "not green" there means "not asked",
   which is not "down" and must never be alarmed on. */
const AUTO_PROBE = /^(nexus data|automation)$/i;

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

/* ── My preferences (7 Oct 2026) ───────────────────────────────────────────
   Per-person, per-device settings, kept by lib/prefs.js (localStorage, wrapped
   so a blocked store simply means "the default"). Nothing here is shared with
   the dealership or stored in the database, and the section says so. What each
   one actually does TODAY is stated on it, because a switch that is saved and
   honoured by nothing would be the product pretending:

     Default landing screen — HONOURED. When the app opens with no screen in the
       address, the block below sends it to the saved screen instead of Today's
       Money Leaks. It runs at module load (this file is imported eagerly by
       app.js, before boot() chooses its first screen) and only fills an EMPTY
       hash, so every bookmark and deep link still wins.
     Reduce motion — HONOURED, by the two Tailwind classes in REDUCE_MOTION on
       <body>, applied here at load and on change.
     Keyboard shortcuts — HONOURED by lib/command-palette.js, which owns the
       shortcuts and stops Ctrl K / ? / G-then-X when this is off.
     Notification categories — SAVED ONLY. The bell and its drawer (lib/shell.js)
       do not read them yet, and each row says so.

   lib/prefs.js stores flags ('1'/'0'), so the landing screen is one flag per
   screen id with exactly one set. */
const PREF_LANDING = id => `nexus.pref.landing.${id}`;
const PREF_REDUCE_MOTION = 'nexus.pref.reduceMotion';
const PREF_NOTIFY = k => `nexus.pref.notify.${k}`;
const REDUCE_MOTION = ['[&_*]:!transition-none', '[&_*]:!animate-none'];
const landingChoices = () => flatNav().filter(i => !i.roadmap && i.sidebar !== false);
const savedLanding = () => landingChoices().find(i => readFlag(PREF_LANDING(i.id), false)) || null;
const applyReduceMotion = on => { try { REDUCE_MOTION.forEach(c => document.body.classList.toggle(c, !!on)); } catch { /* no body yet */ } };
if (typeof document !== 'undefined') {
  applyReduceMotion(readFlag(PREF_REDUCE_MOTION, false));
  const land = savedLanding();
  if (land && !location.hash.slice(1)) location.hash = land.id;
}
const NOTIFY_CATS = [
  ['urgent', 'Urgent', 'HOT items on the attention list: a customer waiting, a lead with no owner.'],
  ['action', 'Action required', 'WARM items that need someone to act today.'],
  ['info', 'Info', 'Everything else the attention list files.'],
  ['system', 'System', 'Automation failures — a workflow that did not deliver.'],
];
const SWITCH = {
  on:  'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-primary transition-colors',
  off: 'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-surface-container-high transition-colors',
};
const KNOB = { on: 'inline-block h-5 w-5 translate-x-5 rounded-full bg-white shadow transition-transform', off: 'inline-block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform' };
const toggle = (key, on, label) => `<button type="button" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-pref="${esc(key)}" class="${on ? SWITCH.on : SWITCH.off}"><span class="${on ? KNOB.on : KNOB.off}"></span></button>`;
const prefCard = (icon, title, sub, tagHtml, bodyHtml) => `<section class="rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-md flex flex-col gap-space-md">
    <div class="flex items-start justify-between gap-space-sm"><div class="flex items-start gap-2.5">
      <div class="w-9 h-9 rounded-lg bg-primary-container/10 text-primary flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[20px]">${icon}</span></div>
      <div><h2 class="font-headline-md text-headline-md text-on-surface">${title}</h2><p class="font-body-sm text-body-sm text-on-surface-variant">${sub}</p></div></div>
      ${tagHtml}</div>${bodyHtml}</section>`;
const tag = t => `<span class="font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-semibold uppercase whitespace-nowrap">${esc(t)}</span>`;

function buildPrefs(host) {
  const draw = () => {
    const land = savedLanding();
    const sc = readFlag(PALETTE_PREF.shortcuts, true);
    const rm = readFlag(PREF_REDUCE_MOTION, false);
    const opts = landingChoices().map(i => `<option value="${esc(i.id)}"${land && land.id === i.id ? ' selected' : ''}>${esc(i.title)}</option>`).join('');
    host.innerHTML = `
      ${prefCard('desktop_windows', 'Operational defaults', 'Where NEXUS opens for you on this device.', tag('This device'), `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-space-md">
          <div class="p-space-md rounded-lg bg-surface-container-low flex flex-col gap-space-sm">
            <div class="flex items-center justify-between gap-2"><span class="font-body-md text-body-md font-semibold text-on-surface">Default landing screen</span>${statusChip('live', 'Applied')}</div>
            <p class="font-body-sm text-body-sm text-on-surface-variant">The screen NEXUS opens on when you start it without a link to a particular screen.</p>
            <select data-landing class="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest font-body-md text-body-md text-on-surface">
              <option value=""${land ? '' : ' selected'}>Today's Money Leaks (the default)</option>${opts}</select>
            <p class="font-label-numeric-sm text-label-numeric-sm text-outline">A bookmark or link to a screen always wins over this.</p>
          </div>
          <div class="p-space-md rounded-lg bg-surface-container-low flex flex-col gap-space-sm">
            <div class="flex items-center justify-between gap-2"><span class="font-body-md text-body-md font-semibold text-on-surface">Default showroom branch</span>${statusChip('planned')}</div>
            <p class="font-body-sm text-body-sm text-on-surface-variant">This build answers as one dealership with one rooftop, so there is no branch to choose. It arrives with Group & Branches.</p>
            <select disabled class="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container font-body-md text-body-md text-outline"><option>—</option></select>
          </div>
        </div>`)}
      ${prefCard('notifications', 'Notification categories', 'Which kinds of attention item you want to be told about.', statusChip('partial', 'Saved only'), `
        <p class="font-body-sm text-body-sm text-on-surface-variant -mt-space-sm">Saved on this device. The bell and the notifications drawer do not read these yet — they still list every category — so turning one off here hides nothing today.</p>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-space-md">${NOTIFY_CATS.map(([k, label, why]) => {
          const on = readFlag(PREF_NOTIFY(k), true);
          return `<div class="p-space-md rounded-lg bg-surface-container-low flex items-start justify-between gap-space-md">
            <div><div class="font-body-md text-body-md font-semibold text-on-surface">${esc(label)}</div><p class="font-body-sm text-body-sm text-on-surface-variant">${esc(why)}</p></div>
            ${toggle(PREF_NOTIFY(k), on, label)}</div>`;
        }).join('')}</div>`)}
      ${prefCard('accessibility_new', 'Interface & accessibility', 'How NEXUS behaves under your keyboard and on your screen.', tag('This device'), `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-space-md">
          <div class="p-space-md rounded-lg bg-surface-container-low flex flex-col justify-between gap-space-sm">
            <div><div class="font-body-md text-body-md font-semibold text-on-surface">Keyboard shortcuts</div>
              <p class="font-body-sm text-body-sm text-on-surface-variant">Ctrl K to search or ask, G then L / I / C / D to jump, N for a walk-in, ? for the list.</p></div>
            <div class="flex items-center justify-between"><span class="font-label-numeric-sm text-label-numeric-sm ${sc ? 'text-primary' : 'text-outline'}">${sc ? 'ENABLED' : 'DISABLED'}</span>${toggle(PALETTE_PREF.shortcuts, sc, 'Keyboard shortcuts')}</div>
          </div>
          <div class="p-space-md rounded-lg bg-surface-container-low flex flex-col justify-between gap-space-sm">
            <div><div class="font-body-md text-body-md font-semibold text-on-surface">Reduce motion</div>
              <p class="font-body-sm text-body-sm text-on-surface-variant">Stops animations and transitions — the pulsing dots, sliding panels and fades.</p></div>
            <div class="flex items-center justify-between"><span class="font-label-numeric-sm text-label-numeric-sm ${rm ? 'text-primary' : 'text-outline'}">${rm ? 'ENABLED' : 'DISABLED'}</span>${toggle(PREF_REDUCE_MOTION, rm, 'Reduce motion')}</div>
          </div>
          <div class="p-space-md rounded-lg bg-surface-container-low flex flex-col justify-between gap-space-sm">
            <div><div class="font-body-md text-body-md font-semibold text-on-surface">Timezone & clock</div>
              <p class="font-body-sm text-body-sm text-on-surface-variant">Every time in NEXUS is shown in Gulf Standard Time, whatever this computer is set to.</p></div>
            <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-container-lowest font-label-numeric-sm text-label-numeric-sm text-on-surface"><span class="material-symbols-outlined text-[16px] text-outline">schedule</span>Asia/Dubai · GST (UTC+4)</div>
          </div>
        </div>`)}
      <div data-pref-note class="font-body-sm text-body-sm text-on-surface-variant"></div>`;
    host.querySelector('[data-landing]').addEventListener('change', e => {
      const id = e.target.value;
      let ok = true;
      landingChoices().forEach(i => { ok = writeFlag(PREF_LANDING(i.id), i.id === id) && ok; });
      host.querySelector('[data-pref-note]').textContent = ok
        ? (id ? 'Saved on this device. NEXUS will open on that screen next time it starts without a link.' : 'Saved on this device. NEXUS will open on Today’s Money Leaks.')
        : 'This browser would not let NEXUS remember that (site data is blocked or this is a private window), so nothing was saved.';
    });
    host.querySelectorAll('[data-pref]').forEach(b => b.addEventListener('click', () => {
      const key = b.dataset.pref;
      const def = key === PREF_REDUCE_MOTION ? false : true;
      const on = !readFlag(key, def);
      const ok = writeFlag(key, on);
      if (key === PREF_REDUCE_MOTION) applyReduceMotion(on);
      draw();
      host.querySelector('[data-pref-note]').textContent = ok ? 'Saved on this device.' : 'This browser would not let NEXUS remember that, so it lasts until you reload.';
    }));
  };
  draw();
}

/* ── Role home screens (7 Oct 2026) ────────────────────────────────────────
   Stitch's table of "which screen each role lands on". There is no per-role
   default stored anywhere in NEXUS — no table, no column — so this is display
   only and says what is true: every role opens on the same screen unless the
   person sets their own landing screen above. The roles are the six
   tenant_members roles lib/data.js knows; the permission column says what each
   is allowed, from the same lists canX() in lib/data.js uses. */
const ROLE_ROWS = [
  ['owner', 'Owner', 'Everything, including granting owner and the unit cost.'],
  ['admin', 'Admin', 'Everything except granting owner.'],
  ['manager', 'Manager', 'Reassigning leads, managing access below owner.'],
  ['sales', 'Sales', 'Their own leads and conversations.'],
  ['technician', 'Technician', 'Read-only outside their own work.'],
  ['member', 'Member', 'Read-only.'],
];
function roleHomes(host) {
  const def = flatNav().find(i => i.id === 'moneyleaks')?.title || "Today's Money Leaks";
  host.innerHTML = `<section class="rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm overflow-hidden">
    <div class="px-space-md py-3 flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
      <div class="flex items-start gap-2.5"><span class="material-symbols-outlined text-primary text-[22px]">admin_panel_settings</span>
        <div><h2 class="font-headline-md text-headline-md text-on-surface">Role-based default home screens</h2>
          <p class="font-body-sm text-body-sm text-on-surface-variant">What each role sees first when it signs in. Display only: NEXUS stores no per-role home screen today, so every role opens on ${esc(def)} unless the person picks their own landing screen under My preferences.</p></div></div>
      <div class="flex items-center gap-2">${statusChip('coming-soon', 'Per-role defaults')}</div>
    </div>
    <div class="overflow-x-auto"><table class="w-full text-left border-collapse">
      <thead><tr class="bg-surface-container-low border-b border-outline-variant/30 text-outline font-table-header text-table-header uppercase">
        <th class="py-3 px-4">Role</th><th class="py-3 px-4">Default home screen</th><th class="py-3 px-4">Route</th><th class="py-3 px-4">What the role may do</th><th class="py-3 px-4 text-right">Person can override</th></tr></thead>
      <tbody class="divide-y divide-outline-variant/20 font-body-sm text-body-sm text-on-surface">${ROLE_ROWS.map(([id, label, may]) => `<tr class="h-11 hover:bg-surface-container-low transition-colors">
        <td class="px-4"><span class="inline-flex items-center gap-2 font-semibold"><span class="w-2 h-2 rounded-full bg-primary"></span>${esc(label)}</span></td>
        <td class="px-4">${esc(def)}</td><td class="px-4 font-label-numeric-sm text-label-numeric-sm text-primary">#moneyleaks</td>
        <td class="px-4 text-on-surface-variant">${esc(may)}</td>
        <td class="px-4 text-right"><span class="font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-surface-container text-on-surface font-semibold">YES · PER DEVICE</span></td></tr>`).join('')}</tbody></table></div>
  </section>`;
}

const SET_TABS = [
  ['prefs', 'tune', 'My preferences'],
  ['roles', 'account_tree', 'Role home screens'],
  ['dealer', 'storefront', 'Dealership & team'],
  ['health', 'monitor_heart', 'System health & probes'],
  ['kb', 'menu_book', 'Knowledge base'],
];
const SET_TAB = {
  on:  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-container text-on-primary font-body-sm text-body-sm font-semibold shadow-sm',
  off: 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface font-body-sm text-body-sm font-semibold transition-colors',
};
const PANE = { on: 'flex flex-col gap-space-md', off: 'hide' };
const INTG_TILE = ['rounded-xl', 'bg-surface-container-low', 'border', 'border-outline-variant/40'];
let setTab = 'prefs';

/* ── S14 · Settings ───────────────────────────────────────────────────────── */
SCREENS.settings = async host => {
  /* `.ds-screen` is the class lib/design-system.css gates its handful of
     upgrades to existing chrome behind. It goes on a wrapper this screen
     appends, and NOT on `#screen`, because lib/nav.js empties `#screen` between
     renders without touching its classes: a class set there would follow the
     operator onto Leads or Money Leaks and restyle a screen nobody converted.
     A wrapper cannot leak — go() removes it with the rest of the subtree. Same
     pattern as screens/inventory.js, screens/leads.js, screens/overview.js,
     screens/money-leaks.js and screens/setup.js. */
  /* 7 Oct 2026 — the Stitch layout (settings-workspace-governance-preferences
     --7e840f primary, settings-workspace-system-configuration--137c0f): a page
     header and five tabs. Every card that was on this screen before is still on
     it, unchanged in what it reads and says; the tabs only decide where it sits.
     buildPrefs() and roleHomes() below are the two sections that are new. */
  const root = el('div', 'nx-stitch flex flex-col gap-space-md');
  host.appendChild(root);
  root.innerHTML = `${sectionHeader({ eyebrow: 'Settings / Workspace configuration', title: 'Settings — Workspace & System Configuration',
      sub: 'Your own preferences on this device, how this dealership is set up, and whether the services NEXUS runs for it are healthy.' })}
    <div class="flex flex-wrap items-center gap-1 -mt-space-sm" role="tablist" aria-label="Settings sections">
      ${SET_TABS.map(([k, icon, label]) => `<button type="button" role="tab" data-set-tab="${k}" aria-selected="${k === setTab}" class="${k === setTab ? SET_TAB.on : SET_TAB.off}">
        <span class="material-symbols-outlined text-[18px]">${icon}</span><span>${label}</span><span data-set-tab-count="${k}"></span></button>`).join('')}
    </div>
    ${SET_TABS.map(([k]) => `<div data-pane="${k}" class="${k === setTab ? PANE.on : PANE.off}"></div>`).join('')}`;
  const pane = Object.fromEntries(SET_TABS.map(([k]) => [k, root.querySelector(`[data-pane="${k}"]`)]));
  const showTab = k => {
    setTab = k;
    root.querySelectorAll('[data-set-tab]').forEach(b => {
      const on = b.dataset.setTab === k;
      b.className = on ? SET_TAB.on : SET_TAB.off;
      b.setAttribute('aria-selected', String(on));
    });
    Object.entries(pane).forEach(([key, node]) => { node.className = key === k ? PANE.on : PANE.off; });
  };
  root.querySelectorAll('[data-set-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.setTab)));
  /* An alert row jumps to the card it is about; the card may sit in another tab. */
  const reveal = node => { const p = node && node.closest('[data-pane]'); if (p) showTab(p.dataset.pane); };

  /* ── The system-health strip ────────────────────────────────────────────
     Rendered first and filled last. Its inputs arrive at three different
     times — the database reads, the connectivity probes the tiles run, and the
     knowledge-base read — so it is recomputed as each lands rather than showing
     nothing until the slowest one is in. */
  const alertCard = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm');
  alertCard.id = 'setAlerts';
  alertCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center gap-space-sm">
      <div>
        <div class="font-headline-md text-headline-md text-on-surface">System health</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" id="setAlertSub">Reading the attention list, the automation health figures and the newest failed runs…</div>
      </div>
      <div style="flex:1"></div>
      <div id="setAlertCount"></div>
    </div><div class="p-space-md" id="setAlertBody">${stateLoading(2)}</div>`;
  pane.health.appendChild(alertCard);

  const top = el('div', 'grid grid-cols-1 lg:grid-cols-12 gap-space-md items-start'); pane.prefs.appendChild(top);
  const prefsMain = el('div', 'lg:col-span-8 flex flex-col gap-space-md');

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
    ? `<span class="text-on-surface-variant" title="${esc(`users could not be read: ${meErr}`)}">unknown — <span class="font-label-numeric-sm">users</span> could not be read</span>`
    : `<span class="text-on-surface-variant">${esc(whenAbsent)}</span>`;

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
    'NEXUS holds no phone number for any member of staff — nowhere in the product is there a field for one, so this is a gap in what NEXUS records rather than something missing from this account. Customer and lead numbers do exist and are shown beside those people. Staff numbers are recorded nowhere this dashboard can read.';
  const hasPhoneCol = !!ME && Object.prototype.hasOwnProperty.call(ME, 'phone');
  const mePhone = hasPhoneCol ? str(ME.phone) : '';
  const phoneWhy = hasPhoneCol && !mePhone
    ? 'This account has somewhere to record a phone number and nothing is recorded in it.'
    : NO_STAFF_PHONE;
  const phoneCell = mePhone
    ? `<span class="font-label-numeric-sm">${esc(mePhone)}</span>`
    : `<span class="text-on-surface-variant" title="${esc(phoneWhy)}">no number on record</span>`;

  const prof = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-md');
  prof.id = 'setProfile';
  prof.innerHTML = `<div class="flex items-center justify-between mb-space-sm"><span class="font-table-header text-table-header uppercase tracking-wider text-on-surface-variant font-semibold">Session profile</span>${ME?.role ? statusChip('connected', ME.role) : ''}</div>
    <div class="flex items-center gap-3 p-space-sm rounded-lg bg-surface-container-low mb-space-sm">
      <div class="w-12 h-12 rounded-lg bg-primary-container text-on-primary flex items-center justify-center font-label-numeric-md text-label-numeric-md font-bold shrink-0">${esc(initials(ME?.name || email || '?'))}</div>
      <div class="min-w-0"><div class="font-headline-md text-headline-md text-on-surface truncate">Signed in</div>
        <div class="font-label-numeric-sm text-label-numeric-sm text-on-surface-variant truncate">${esc(email || 'unknown')}</div></div></div>
    <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-bottom:14px">Identity as the sign-in service and the staff record each see it</div>
    ${noMeRow ? `<div class="flex items-start gap-3 p-space-md rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm mb-space-sm"><span class="material-symbols-outlined" style="font-size:20px">person_alert</span>
      <div>No row in <span class="font-label-numeric-sm">users</span> matches ${esc(email || 'this account')}. The read succeeded and came back empty, which is what makes this a real absence: the account can sign in, but it has no name, role or status on record, so anything keyed on role treats it as unassigned.</div></div>` : ''}
    ${meUnknown ? `<div class="flex items-start gap-3 p-space-md rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm mb-space-sm"><span class="material-symbols-outlined" style="font-size:20px">help</span>
      <div>The <span class="font-label-numeric-sm">users</span> table could not be read for ${esc(email || 'this account')}, so whether this account has a staff record is <strong>unknown</strong> — not absent. The read failed with <span class="font-label-numeric-sm">${esc(meErr)}</span>. Name, role and status below are blank for that reason and no other; they are not evidence that nothing is stored. Role-keyed behaviour elsewhere in the dashboard is running without a role until this read succeeds.</div></div>` : ''}
    <dl class="grid grid-cols-[minmax(120px,180px)_1fr] gap-x-4 gap-y-2.5 font-body-sm text-body-sm [&>dt]:font-table-header [&>dt]:text-table-header [&>dt]:uppercase [&>dt]:tracking-wider [&>dt]:text-outline [&>dt]:font-semibold [&>dt]:pt-0.5 [&>dd]:text-on-surface [&>dd]:min-w-0">
      <dt>Email</dt><dd>${esc(email || 'unknown')}</dd>
      <dt>Name</dt><dd>${ME?.name ? esc(ME.name) : meMissing('not set in users')}
        <span class="text-on-surface-variant">·</span> ${phoneCell}</dd>
      <dt>Role</dt><dd>${ME?.role ? esc(ME.role) : meMissing('no role on record')}</dd>
      <dt>Account status</dt><dd>${ME?.status ? esc(ME.status) : meMissing('not set')}</dd>
      <dt>Auth user id</dt><dd class="font-label-numeric-sm">${esc(SESSION?.user?.id || 'unknown')}</dd>
      <dt>Access token</dt><dd>${exp
        ? `<span class="${exp.bad ? 'text-red-700' : ''}">${esc(exp.text)}</span>`
        : '<span class="text-on-surface-variant">no expiry on the session object</span>'}</dd>
    </dl>
    <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:14px">${mePhone ? '' : esc(phoneWhy) + ' '}Passwords, email changes and account creation are handled by the sign-in service, not by this dashboard. Roles are edited on the Team screen.</div>`;
  prof.className = 'lg:col-span-4 rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-md';
  top.appendChild(prof);
  top.appendChild(prefsMain);
  const prefsBox = el('div', 'flex flex-col gap-space-md');
  prefsMain.appendChild(prefsBox);
  buildPrefs(prefsBox);
  roleHomes(pane.roles);

  /* ── Dealership (the "Showroom & legal entity" tab of the design) ───────────
     Only what this account can read about its own dealership: the membership
     read lib/tenant.js already made. Trade licence, tax registration and
     showroom addresses are not recorded anywhere in NEXUS, so the card says
     that instead of drawing empty fields that read like unfilled forms. */
  {
    const ts = tenantState();
    const t = ts.active;
    /* tenantLabel() is lib/tenant.js's own reading of the dealership's name
       (name, else slug) — the same words the scope chip in the topbar shows. */
    const dealerTitle = t ? str(tenantLabel()) : '';
    const role = ts.ok && Array.isArray(ts.memberships) && t ? (ts.memberships.find(m => m.tenant_id === t.id) || {}).role : null;
    const dl = el('section', 'rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-md flex flex-col gap-space-md');
    dl.innerHTML = `<div class="flex items-start justify-between gap-space-sm"><div class="flex items-start gap-2.5">
        <div class="w-9 h-9 rounded-lg bg-primary-container/10 text-primary flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[20px]">storefront</span></div>
        <div><h2 class="font-headline-md text-headline-md text-on-surface">Dealership</h2><p class="font-body-sm text-body-sm text-on-surface-variant">The dealership every screen in NEXUS is scoped to for this account.</p></div></div>
        ${!ts.loaded ? statusChip('pending', 'Reading') : !ts.ok ? statusChip('not-tested', 'Unknown') : t ? statusChip(str(t.status) === 'active' ? 'live' : 'restricted', str(t.status) || 'Status not recorded') : statusChip('blocked', 'No dealership')}</div>
      <dl class="grid grid-cols-[minmax(120px,180px)_1fr] gap-x-4 gap-y-2.5 font-body-sm text-body-sm [&>dt]:font-table-header [&>dt]:text-table-header [&>dt]:uppercase [&>dt]:tracking-wider [&>dt]:text-outline [&>dt]:font-semibold [&>dt]:pt-0.5 [&>dd]:text-on-surface [&>dd]:min-w-0">
        <dt>Name</dt><dd>${t ? esc(dealerTitle || 'No name recorded') : '—'}</dd>
        <dt>Account id</dt><dd class="font-label-numeric-sm">${t ? esc(str(t.slug) || '—') : '—'}</dd>
        <dt>Your role here</dt><dd>${role ? esc(role) : '—'}</dd>
        <dt>Rooftops</dt><dd>One. This build answers as one dealership; several rooftops arrive with Group &amp; Branches (planned).</dd>
        <dt>Legal entity &amp; tax</dt><dd class="text-on-surface-variant">Not recorded in NEXUS — there is no field for a trade licence or tax registration number.</dd>
      </dl>
      ${!ts.ok && ts.loaded ? '<p class="font-body-sm text-body-sm text-on-surface-variant">The membership read failed, so which dealership this account belongs to is unknown — not none.</p>' : ''}`;
    pane.dealer.appendChild(dl);
  }

  /* ── Connection ─────────────────────────────────────────────────────────
     "Which project am I actually looking at?" is the first question of every
     incident where staging data turns up in production — and it is the ON-CALL
     ENGINEER'S question, which is to say the vendor's. The project ref, the
     host and the build mode that used to answer it here are gone
     (CONTROL-PLANE.md 5.3); what a dealership is entitled to is whether the
     services NEXUS runs for them are configured and reachable, which is what
     is below. The values themselves stay in the deploy configuration, where
     whoever deploys this can read them. */
  const hooks = Object.values(HOOK);

  /* Each piece of configuration this bundle needs, and — the only half that is
     rendered — what stops working without it. env.js validates the two that
     must exist; it measures the value rather than testing it for truthiness,
     because a whole .env file pasted into one variable is a thing that actually
     happened here. The `name` is kept because envBroken is derived from the
     same list and a future reviewer needs to see which row is which; it is not
     rendered anywhere on this screen. */
  const ENV_VARS = [
    { name: 'VITE_SUPABASE_URL', value: SUPABASE_URL,
      dead: 'No screen on this dashboard can load anything — every one of them reads from NEXUS.' },
    { name: 'VITE_SUPABASE_ANON_KEY', opaque: true,
      dead: 'Every request is refused before it reaches your data, so every screen renders its error state.' },
    { name: 'VITE_N8N_BASE_URL', value: N8N_BASE,
      dead: 'Ask AI, the Finance Desk, drip enrolment, the ERP sync and WhatsApp replies all refuse outright — the request is not made at all.' },
  ];
  const anonBroken = envErrors.some(e => /ANON_KEY/.test(e));

  /* ── What this card used to be, and why it is a connection state now ────
     Until 5 Sep 2026 this card printed the Supabase project ref, the Supabase
     URL, the n8n base host, the Vite build mode, the serving origin and the
     three build-time variable NAMES, with a per-variable set/missing line.
     CONTROL-PLANE.md 5.3 is the finding, and its verdict is quoted rather than
     paraphrased: “the whole Environment card and the endpoint chip list are
     control-plane diagnostics. On the dealership’s Settings, replace with a
     connection state — connected / degraded / down — and nothing else.”

     The defence written here before was that the values are compiled into a
     public bundle and so reveal nothing further. That is true and it is not
     the point: the bundle is public but nobody reads it, and a panel is read.
     Presentation is what turns discoverable into known.

     What the card keeps, because it is the dealership's and they are badly
     served without it: whether this deployment is misconfigured, and what
     stops working while it is. The FACT of a broken build stays; the values
     and the variable names go. `ENV_VARS[].dead` is what survives from each
     row — the consequence, which is the dealership's — and the name, which is
     the vendor's, does not.

     What it must not become is a green light. A missing value is still stated
     in full, in red, because a dealership whose Ask AI has been dead for a week
     is entitled to know that it is dead by configuration rather than by fault. */
  const envBroken = ENV_VARS.filter(v => (v.opaque ? anonBroken : !str(v.value)));
  const envCard = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-md');
  envCard.id = 'setEnvCard';
  envCard.innerHTML = `<div class="font-headline-md text-headline-md text-on-surface" style="margin-bottom:4px">Connection</div>
    <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-bottom:14px">Whether this deployment is configured to reach the services NEXUS runs for you</div>
    <dl class="grid grid-cols-[minmax(120px,180px)_1fr] gap-x-4 gap-y-2.5 font-body-sm text-body-sm [&>dt]:font-table-header [&>dt]:text-table-header [&>dt]:uppercase [&>dt]:tracking-wider [&>dt]:text-outline [&>dt]:font-semibold [&>dt]:pt-0.5 [&>dd]:text-on-surface [&>dd]:min-w-0">
      <dt>NEXUS data</dt><dd>${envErrors.length || !SUPABASE_URL
        ? '<span class="text-red-700">not configured — no screen on this dashboard can load</span>'
        : 'configured'}</dd>
      <dt>Automation</dt><dd>${N8N_BASE
        ? 'configured'
        : '<span class="text-red-700">not configured — nothing on this dashboard can start a workflow</span>'}</dd>
      <dt>Credentials</dt><dd>${anonBroken
        ? '<span class="text-red-700">missing or malformed</span>'
        : 'held by NEXUS <span class="text-on-surface-variant">· never shown here, in full or masked</span>'}</dd>
    </dl>
    ${envBroken.length ? `<div class="flex items-start gap-3 p-space-md rounded-lg border border-red-200 bg-red-50/40 text-red-950 font-body-sm text-body-sm mb-space-sm" style="margin-top:14px">
      <span class="material-symbols-outlined" style="font-size:20px">error</span>
      <div><strong>This deployment is missing configuration NEXUS supplies, and ${envBroken.length === 1 ? 'something is' : 'things are'} switched off because of it.</strong>
      ${envBroken.map(v => `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:6px;white-space:normal">${esc(v.dead)}</div>`).join('')}
      <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:6px;white-space:normal">Nothing here can be fixed from this screen or by this dealership — it is set when NEXUS deploys the dashboard. Report it and it can be redeployed.</div></div></div>` : ''}
    <div class="flex items-start gap-3 p-space-md rounded-lg border border-sky-200 bg-sky-50/50 text-sky-950 font-body-sm text-body-sm mb-space-sm" style="margin-top:16px;margin-bottom:0">
      <span class="material-symbols-outlined" style="font-size:20px">lock</span>
      <div>Keys, credentials and secrets are never displayed or accepted on this screen, masked or otherwise. Neither are the addresses of the services behind it: which host, which project and which build this dashboard points at is NEXUS's operational configuration, and this screen states only whether each one is reachable.</div>
    </div>`;
  pane.health.appendChild(envCard);

  /* ── Connectivity ───────────────────────────────────────────────────────
     renderIntegrations owns the probes themselves; this screen owns which of
     them may run without a person asking, and passes that list in. Two do: a
     one-row Supabase select and a GET on the n8n /healthz endpoint. Both are
     reads. See AUTO_PROBE above for why the third one — a finance-calc round
     trip, described here until 31 Aug as "free" — is gone and must not return.

     It is the same helper the Automation screen uses, so the two screens cannot
     disagree about what "reachable" means; naming the allow-list at the call
     site is what stops them disagreeing about what may be *called*, since a
     probe added for Automation's benefit would otherwise start firing here. */
  const conn = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-md'); conn.id = 'setConn'; pane.health.appendChild(conn);
  conn.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center gap-space-sm" style="padding:0 0 14px">
      <div><div class="font-headline-md text-headline-md text-on-surface">Connectivity</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" id="setConnSub">Live checks, from this browser, against the services this dashboard depends on</div></div>
      <div style="flex:1"></div>
      <button class="${BTN.secondary}" id="setRecheck">Re-run checks</button>
    </div>
    <div id="setIntg">${stateLoading(2)}</div>
    ${/* CONTROL-PLANE.md 5.3. This block printed every webhook this build can
          call as a full URL chip — the automation host plus the path, once per
          endpoint — and then named which third-party service each one spends.
          Both are Part 4 material: infrastructure topology, and which supplier
          sits behind which feature. What replaced it is the count and the
          capability, which is the half that is the dealership's. */ ''}
    <div style="margin-top:18px">
      <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold" style="margin-bottom:8px">Automations this dashboard can start</div>
      <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${N8N_BASE
        ? `${hooks.length} of them: asking a question of your documents, calculating finance, enrolling a customer in a drip, recording a closed deal, auditing an uploaded document, escalating a lead, syncing the ERP and sending a WhatsApp reply.`
        : '<span class="text-red-700">None. This deployment is not configured to reach the automation host, so every one of them refuses outright rather than failing halfway.</span>'}</div>
      <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:8px">Their addresses are not shown: where an automation lives is NEXUS's operational configuration, not a fact this dashboard puts in front of you. Nothing on this card calls one, and none of these is probed by this screen — calling one to see whether it answers does real work, and a check that enrols a real customer or bills a real run is not a check. What they actually did is in the workflow table below, which reads what they recorded.</div>
      <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:8px">No key, token or webhook secret is rendered anywhere on this screen, in full or masked.</div>
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
      const msg = str(tile.querySelector('.ds-cell-sub')?.textContent);
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
    /* The allow-list travels with the call: renderIntegrations may run only the
       checks named here, and everything else it knows about is to be listed as
       unprobed rather than fired. lib/integrations.js belongs to someone else,
       and its automatic list today is already exactly these two — this argument
       is what keeps that true from this screen's side if a third is ever added
       there for Automation's benefit. Monitoring does not get to write to the
       table it monitors, and "opening Settings" is not a business event. */
    renderIntegrations($('setIntg'), { autoProbe: AUTO_PROBE });
    /* lib/integrations.js draws legacy tiles (`.card`, `.btn`), and inside this
       screen's Stitch scope the scoped reset strips a legacy button's padding
       and a card's border. The tiles keep their `.card` class and inline styles
       — readProbes() below reads them back by exactly those — and gain the
       Stitch surface; the buttons, which carry their data-* hooks, become
       Stitch buttons. Re-applied on every re-check, since that re-renders. */
    const intg = $('setIntg');
    intg?.querySelectorAll('.card').forEach(t => t.classList.add(...INTG_TILE));
    intg?.querySelectorAll('button.btn').forEach(b => { b.className = BTN.secondary; });
    watchProbes();
  };
  $('setRecheck').addEventListener('click', runChecks);
  runChecks();

  /* ── Wiring: workflows and credentials ──────────────────────────────────
     Placeholders now, filled when the batch below lands, so the cards sit in
     their final order instead of appearing underneath the knowledge base. */
  const wfCard = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm'); wfCard.id = 'setWfCard';
  pane.health.appendChild(wfCard);
  wfCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center gap-space-sm"><div><div class="font-headline-md text-headline-md text-on-surface">Workflows</div>
    <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Reading the automation health figures…</div></div></div><div class="p-space-md">${stateLoading(5)}</div>`;

  const credCard = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm'); credCard.id = 'setCredsCard';
  pane.health.appendChild(credCard);
  credCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center gap-space-sm"><div><div class="font-headline-md text-headline-md text-on-surface">Credentials</div>
    <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Reading the newest failed runs…</div></div></div><div class="p-space-md">${stateLoading(2)}</div>`;

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
    /* Every 30-day counter the view computes is selected, not just runs and
       failures. The rate, the state pill and the breakdown under each figure
       are all read from these columns; this screen does no arithmetic on them
       beyond adding the ones it says out loud that it is adding. */
    settle(db('v_workflow_health?select=name,category,description,is_active,'
      + 'writes_audit_log,runs,failures,success_rate,last_run,last_success,last_partial,last_incomplete,'
      + 'runs_30d,effective_runs_30d,successes_30d,failures_30d,partials_30d,no_result_30d,rejected_30d,'
      + `escalated_30d,unknown_30d,success_rate_30d,last_failure,health&limit=${HEALTH_LIMIT}`)),
    /* Runs that did not complete, in the writers' own words. Per-workflow
       totals come from v_workflow_health, whose windows are documented; this
       read exists to carry the TEXT, which is the only place a broken
       credential names itself.

       The filter was status=eq.FAILED until 31 Aug 2026, and that is how the
       Gmail credential held a green pill for six days. The newest evidence
       against it is eight PARTIAL rows from Customer 360 reading "Gmail read
       failed" — invisible to a read that only asks for FAILED, so the panel
       could not see the thing that would have contradicted it. A half-landed
       delivery is where a credential fault surfaces once a workflow has learned
       to carry on around it, so PARTIAL rows are read here too. */
    settle(db(`audit_log?select=workflow,status,summary,logged_at&status=in.(FAILED,PARTIAL)&order=logged_at.desc&limit=${FAIL_LIMIT}`)),
    /* The registry is what ties an n8n workflow to the string it writes into
       audit_log. Without it the failure list falls back to matching on the
       display name, which is a weaker join — so the difference is stated rather
       than hidden behind a suspiciously short failure history. */
    settle(db('rpc/nexus_workflow_catalogue?select=name,audit_name,audit_aliases')),
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
  /* What makes two faults two rows.

     A quoted credential name is the best identifier there is, and where the
     text carries one it is the key. Where it carries none — "Forbidden -
     perhaps check your credentials?" names nothing — the key is the workflow
     that broke, because that is a real distinction and "we could not read a
     name" is not. Grouping every un-named failure together is what produced a
     single top-of-card row reading "unnamed credential · CRITICAL · the ERP/CRM
     sync cannot write" out of seven failing escalation emails and two failing
     Bitrix reads: one broken credential shown where there were two, the manager
     pointed at the wrong system, and nothing said about hot-lead escalation
     having been dead for a fortnight.

     Grouping by workflow errs the other way — two workflows failing on one
     shared credential appear twice — and that is the safer error: it overstates
     how many things to look at and understates nothing. The card says so. */
  const credGroups = () => {
    const s = sysState;
    if (!s || !s.fails) return null;
    const groups = new Map();
    const take = (name, workflow) => {
      const key = name ? `name:${low(name)}` : `wf:${low(workflow) || '(unattributed)'}`;
      let g = groups.get(key);
      if (!g) {
        g = { key, name: name || null, workflow: workflow || null, rows: [], workflows: new Set(), channels: new Set(), viewItems: [] };
        groups.set(key, g);
      }
      return g;
    };
    /* Channel attribution reads the row's own head text plus its workflow name
       and, where there is one, the credential name. Never the other members'
       text: one row's Bitrix is not another row's evidence. */
    const learn = (g, text, workflow, name) =>
      credChannels(`${credScan(text)} ${workflow || ''} ${name || ''}`).forEach(c => g.channels.add(c));

    for (const rowF of s.fails) {
      const text = str(rowF.summary);
      if (!CRED_RE.test(text)) continue;
      const wf = str(rowF.workflow);
      const name = credName(text);
      const g = take(name, wf);
      g.rows.push(rowF);
      if (wf) g.workflows.add(wf);
      learn(g, text, wf, name);
    }
    /* The same fault as reported by v_needs_attention. It is the same incident,
       so it joins the group rather than being counted a second time; where the
       view names a credential this read did not see, it becomes its own group,
       so a fault is never dropped for being in the wrong place. The view's
       `ref` on a workflow_failure row is the workflow name, which is what makes
       it groupable on the same key as an un-named audit row. */
    for (const it of (s.attn || [])) {
      const text = `${str(it.title)} ${str(it.detail)}`;
      if (!CRED_RE.test(text)) continue;
      const wf = str(it.ref) || str(it.title);
      const name = credName(text);
      const g = take(name, wf);
      g.viewItems.push(it);
      if (wf) g.workflows.add(wf);
      learn(g, text, wf, name);
    }
    return [...groups.values()].map(g => {
      const times = g.rows.map(r => Date.parse(r.logged_at))
        .concat(g.viewItems.map(v => Date.parse(v.at)))
        .filter(t => !Number.isNaN(t));
      /* Failed and half-landed are counted apart. "Nine failed runs" over a
         set that is really seven failures and two partial deliveries describes
         neither, and the partial is the one that reached a customer. */
      const partial = g.rows.filter(r => outcomeOf(r) === OUTCOME.PARTIAL).length;
      return {
        name: g.name,
        workflow: g.workflow,
        named: !!g.name,
        /* How the card and the alert name it. An un-named credential is never
           given a made-up name; it is described by what it broke. */
        /* ── What this card is allowed to call the thing that broke ────────
           `g.name` is the credential's own name as the failing run wrote it —
           "Gmail OAuth2", "Bitrix Webhook", "Slack". It names the
           SUPPLIER, and until 5 Sep 2026 it was the headline of this card and
           the title of the alert. A dealership can do nothing with it: they
           have no login to that supplier, the card's own Reconnect button is
           disabled by design, and the supplier is NEXUS's choice and changes.
           What they can act on is which of their channels has stopped — and
           `channels` already carries exactly that, derived from the same
           evidence and shown in the sentence underneath.

           The name is NOT discarded. It still keys the grouping above, so two
           faults on one channel stay two rows and are never merged into one
           reassuring line; it is simply not rendered. `named` still drives the
           "the text named nothing, so this is keyed on the workflow" note,
           which is a statement about the EVIDENCE and stays true. */
        display: g.channels.size
          ? `${[...g.channels].map(k => (CRED_IMPACT.find(c => c.key === k) || {}).label).filter(Boolean).join(' and ')} — connection failing`
          : (g.workflow ? `A connection used by ${g.workflow}` : 'A connection NEXUS holds'),
        subject: g.channels.size
          ? `The ${[...g.channels].map(k => low((CRED_IMPACT.find(c => c.key === k) || {}).label || '')).filter(Boolean).join(' and ')} connection`
          : g.workflow
            ? `The connection ${g.workflow} uses`
            : 'A connection this dashboard cannot identify',
        channels: [...g.channels],
        workflows: [...g.workflows],
        count: g.rows.length,
        partialCount: partial,
        failedCount: g.rows.length - partial,
        viewCount: g.viewItems.length,
        newest: times.length ? new Date(Math.max(...times)).toISOString() : null,
        oldest: times.length ? new Date(Math.min(...times)).toISOString() : null,
      };
    }).sort((a, b) => (b.count + b.viewCount) - (a.count + a.viewCount));
  };
  /* "3 failed runs and 1 partial delivery" rather than "4 runs". Written once
     so the strip and the card cannot describe the same rows differently. */
  const credEvidence = g => {
    if (!g.count) return 'No logged run in this window names it';
    const bits = [
      g.failedCount ? `${num(g.failedCount)} failed ${plural(g.failedCount, 'run', 'runs')}` : '',
      g.partialCount ? `${num(g.partialCount)} partial ${plural(g.partialCount, 'delivery', 'deliveries')}` : '',
    ].filter(Boolean);
    return `${bits.join(' and ')} among the newest ${num(FAIL_LIMIT)} logged incomplete runs name it`;
  };

  function computeAlerts() {
    const out = [];
    const s = sysState;

    /* 1 · Configuration. No timestamp on these: they are the state of the
       build, not an event, and dressing them with an age would be invention. */
    envErrors.forEach((e, i) => out.push({
      key: `env${i}`, sev: 'CRITICAL', icon: 'settings_alert',
      title: 'This deployment is missing configuration it needs',
      /* The variable NAME and its value are in `e`, and both are NEXUS's
         deployment configuration (CONTROL-PLANE.md Part 4). The fact is the
         dealership's; the identifier is not. */
      detail: 'Something this dashboard needs was not supplied when it was deployed. Which setting it is, and what it should hold, is NEXUS\u2019s to fix.',
      foot: 'Compiled into the dashboard when it is built — fixing it means redeploying, not changing anything from here.',
      target: 'setEnvCard',
    }));
    if (!N8N_BASE) out.push({
      key: 'env-n8n', sev: 'CRITICAL', icon: 'link_off',
      title: 'This deployment cannot reach the automation service, so no workflow can be started',
      detail: 'The request is refused before it is made, which means Ask AI, the Finance Desk, drip enrolment, WhatsApp replies from Conversations and the ERP sync are all dead in this build — not slow, not intermittent: refused at the first line.',
      foot: 'Set when NEXUS deploys this dashboard; nothing here can change it. The workflow table below still reads what the automations recorded, which is held separately and is unaffected.',
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
      detail: `Looking up ${esc(email || 'the signed-in account')} in <span class="font-label-numeric-sm">users</span> failed with: ${esc(meErr)}. Whether a staff row exists, and what role it carries, cannot be stated either way from here. This is not the finding above — it is the absence of the evidence that would settle it — and this screen used to report the two as the same thing.`,
      foot: 'Reload once the database is answering. Until then everything keyed on role is running without one, which is not the same as running as unassigned.',
      target: 'setProfile',
    });

    /* 3 · Reachability. Supabase is judged by this screen's own reads — the
       most direct evidence there is — and cross-checked against the tile. n8n
       has no evidence except the tile, and where the tile cannot be read the
       strip says exactly that rather than assuming either answer. */
    const probeFor = re => (probeState || []).find(p => re.test(p.name)) || null;
    const sbProbe = probeFor(/^nexus data$/i);
    const n8nProbe = probeFor(/^automation$/i);

    if (s && s.attnErr && s.healthErr && s.failsErr) out.push({
      key: 'sb-down', sev: 'CRITICAL', icon: 'cloud_off',
      title: 'Every read this screen made failed',
      detail: 'All four queries came back with an error. Nothing below this strip is a count of anything; the panels are empty because the database did not answer, not because the system is quiet.',
      target: 'setConn',
    });
    else if (sbProbe?.state === 'down') out.push({
      key: 'sb-probe-down', sev: 'CRITICAL', icon: 'cloud_off',
      title: 'The connectivity check on your data failed',
      detail: `The check reported: ${esc(sbProbe.msg || 'no detail')}.${s && !s.healthErr ? ' This screen’s own reads did succeed, so the fault is narrower than “everything is down” — read what the check actually said.' : ''}`,
      target: 'setConn',
    });

    if (N8N_BASE && n8nProbe?.state === 'down') out.push({
      key: 'n8n-down', sev: 'CRITICAL', icon: 'power_off',
      title: 'The automation service is not reachable from this browser',
      detail: `Its health check answered: ${esc(n8nProbe.msg || 'no detail')}. Every workflow this dashboard starts goes there, so Ask AI, the Finance Desk, drip enrolment and WhatsApp replies will all fail while this is true. Automations that run on their own may still be running — this check says nothing about them.`,
      target: 'setConn',
    });

    /* 4 · Workflow states from v_workflow_health. Each of these findings is a
       different sentence, and only some of them are faults. */
    if (s?.healthErr) out.push({
      key: 'wf-read', sev: 'WARNING', icon: 'error',
      title: 'The workflow health view could not be read',
      detail: `The automation health figures returned: ${esc(s.healthErr)}. This screen therefore cannot say whether any workflow is degraded, and the absence of a degraded-workflow alert below means nothing at all.`,
      target: 'setWfCard',
    });
    if (s?.health) {
      const rows = s.health;
      const deg = rows.filter(w => stateKey(w) === 'DEGRADED');
      const noOutput = rows.filter(w => stateKey(w) === 'PRODUCING_NOTHING');
      const unrated = rows.filter(w => stateKey(w) === 'NO_QUALIFYING_RUNS');
      const oddStatus = rows.filter(w => stateKey(w) === 'UNKNOWN_OUTCOME');
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
        const p30 = deg.reduce((a, w) => a + (n0(w.partials_30d) || 0), 0);
        const last = deg.map(w => w.last_incomplete || w.last_failure).filter(Boolean).sort().pop();
        const stillOn = deg.filter(w => w.is_active !== false).length;
        out.push({
          key: 'wf-degraded', sev: 'CRITICAL', icon: HEALTH_LOOK.DEGRADED.icon,
          title: `${num(deg.length)} ${plural(deg.length, 'workflow is', 'workflows are')} degraded`,
          /* Failures and partial deliveries are named separately. They are both
             the dealership's problem, which is why the view puts both in this
             state, but they are not the same problem: one workflow never got
             there, and the other told the customer it had. */
          detail: `${esc(deg.map(w => str(w.name)).join(', '))} — inside the 30-day window the automation health figures measures, ${
            f30 ? `${num(f30)} ${plural(f30, 'run', 'runs')} failed outright` : 'no run failed outright'}${
            p30 ? ` and ${num(p30)} went out half-done — a step the workflow claimed did not land, so a customer may hold a reply the database has no record of` : ''}.${
            stillOn ? ` ${num(stillOn)} of ${plural(deg.length, 'them is', 'them are')} still switched on, which means ${plural(stillOn, 'it keeps', 'they keep')} running and ${plural(stillOn, 'it keeps', 'they keep')} doing this.` : ''}`,
          foot: last ? `Most recent failed or half-landed run ${esc(ago(last))}.` : 'The automation health figures recorded no last_incomplete timestamp for these.',
          target: 'setWfCard', wf: 'DEGRADED',
        });
      }
      /* Deliberately its own alert, and not folded into the one above. A
         PRODUCING_NOTHING workflow is not failing: n8n reports its runs as
         completed, no error is raised, no failure count moves, and every
         dashboard that counted only FAILED called it healthy. Competitor Price
         Scraping sat on a green "Clean, 30 d · 100.0%" pill for a month while
         84 of its 96 runs produced no price. Ran-and-achieved-nothing needs its
         own sentence or it will keep hiding inside a clean one. */
      if (noOutput.length) out.push({
        key: 'wf-nothing', sev: 'CRITICAL', icon: HEALTH_LOOK.PRODUCING_NOTHING.icon,
        title: `${num(noOutput.length)} ${plural(noOutput.length, 'workflow runs', 'workflows run')} cleanly and ${plural(noOutput.length, 'produces', 'produce')} nothing`,
        detail: `${noOutput.map(w => `${esc(str(w.name))} (${esc(pct(rate30(w)))} of ${num(n0(w.effective_runs_30d) ?? n0(w.runs_30d))} counted runs delivered)`).join(', ')}. Nothing here failed — the runs completed, no error was logged, and a screen counting only failures reports ${plural(noOutput.length, 'it', 'them')} as clean. The work is simply not getting done.`,
        foot: 'This state exists because the old success rate on this screen was (runs − failures) ÷ runs, which scored every refusal, every no-result and every half-landed delivery as a success.',
        target: 'setWfCard', wf: 'PRODUCING_NOTHING',
      });
      if (unrated.length) out.push({
        key: 'wf-unrated', sev: 'WARNING', icon: HEALTH_LOOK.NO_QUALIFYING_RUNS.icon,
        title: `${num(unrated.length)} ${plural(unrated.length, 'workflow has', 'workflows have')} run, and no run counts toward a rate`,
        detail: `${esc(unrated.map(w => str(w.name)).join(', '))} — every run inside the window was refused by design, so there is nothing to divide by and no success rate exists. Refusals are excluded from the denominator on purpose, so that an unauthorised caller hammering a webhook cannot dilute a real miss rate; the effect is that a workflow doing nothing but turning callers away reports no rate at all rather than a flattering one.`,
        target: 'setWfCard', wf: 'NO_QUALIFYING_RUNS',
      });
      if (oddStatus.length) out.push({
        key: 'wf-odd-status', sev: 'WARNING', icon: HEALTH_LOOK.UNKNOWN_OUTCOME.icon,
        title: `${num(oddStatus.length)} ${plural(oddStatus.length, 'workflow logged a status', 'workflows logged statuses')} the database has no class for`,
        detail: `${esc(oddStatus.map(w => str(w.name)).join(', '))} wrote the activity log status that NEXUS’s own rule for what a run achieved does not define, so ${plural(oddStatus.length, 'its', 'their')} health cannot be stated either way. This is a writer emitting a word nobody agreed on, not a workflow failing — and it is reported rather than rounded to the nearest state it might have meant.`,
        target: 'setWfCard', wf: 'UNKNOWN_OUTCOME',
      });
      if (never.length) out.push({
        key: 'wf-never', sev: 'WARNING', icon: HEALTH_LOOK.NEVER_RAN.icon,
        title: `${num(never.length)} ${plural(never.length, 'workflow has', 'workflows have')} never recorded a run`,
        detail: `${esc(never.map(w => str(w.name)).join(', '))} ${plural(never.length, 'is', 'are')} registered as writing to the activity log and ${plural(never.length, 'has', 'have')} never written a row. That is not evidence of health, it is the absence of evidence — ${plural(never.length, 'this workflow has', 'these workflows have')} never been observed working in this deployment.`,
        target: 'setWfCard', wf: 'NEVER_RAN',
      });
      if (blind.length) out.push({
        key: 'wf-blind', sev: 'INFO', icon: HEALTH_LOOK.NOT_INSTRUMENTED.icon,
        title: `${num(blind.length)} ${plural(blind.length, 'workflow reports', 'workflows report')} nothing at all`,
        detail: `${plural(blind.length, 'It has', 'They have')} no Audit Log node, so nothing ${plural(blind.length, 'it does', 'they do')} reaches the activity log and this dashboard cannot see ${plural(blind.length, 'it', 'them')} succeed or fail. Counted as healthy nowhere on this screen: unmeasured is not the same as working.`,
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
        foot: 'Publishing that consent screen is what stopped the mail connection expiring every seven days, so these are load-bearing. They are excluded from the not-logged count above: a page that logs nothing is not a blind spot.',
        target: 'setWfCard', wf: 'ALL',
      });
      if (off.length) out.push({
        key: 'wf-off', sev: 'WARNING', icon: 'toggle_off',
        title: `${num(off.length)} registered ${plural(off.length, 'workflow is', 'workflows are')} switched off`,
        detail: `${esc(off.map(w => str(w.name)).join(', '))} — an inactive workflow has no live webhook, so anything posting to it gets a 404 however well-formed the request is.`,
        target: 'setWfCard', wf: 'INACTIVE',
      });
      /* Not the same finding as wf-odd-status above, and the difference
         matters: that one is the DATABASE saying a workflow logged a status it
         has no class for. This one is the VIEW returning a health word neither
         this screen nor lib/health.js has ever heard — a shared vocabulary that
         has moved on without the frontend. Two unknowns, about two things. */
      if (odd.length) out.push({
        key: 'wf-odd', sev: 'WARNING', icon: UNKNOWN_HEALTH.icon,
        title: `${num(odd.length)} ${plural(odd.length, 'workflow reports', 'workflows report')} a health state this build has no wording for`,
        detail: `Reported verbatim as ${esc([...new Set(odd.map(w => str(w.health) || 'null'))].join(', '))} rather than folded into one of the states it might mean. NEXUS is the shared vocabulary and it does not carry ${plural(odd.length, 'this word', 'these words')}, so this bundle is older than the view it is reading.`,
        target: 'setWfCard', wf: 'ALL',
      });
    }

    /* 5 · Credentials. Why this belongs on Settings rather than Automation: a
       broken credential is not one workflow misbehaving, it is a whole channel
       switched off underneath every workflow that uses it. */
    if (s?.failsErr) out.push({
      key: 'cred-read', sev: 'WARNING', icon: 'error',
      title: 'Incomplete runs could not be read, so credential faults cannot be reported',
      detail: `The activity log returned: ${esc(s.failsErr)}. A broken credential names itself only in the text of the run it broke, so with this read down the credentials panel is blank for lack of evidence, not for lack of faults.`,
      target: 'setCredsCard',
    });
    /* Severity is CRITICAL and stays CRITICAL. The tense softens after a day
       of silence — "is failing" about a fault repaired this morning sends
       someone to reconnect a credential that already works — but the severity
       does not, because nothing this screen can read proves a repair. There is
       no green branch here any more; see the CRED_VERIFIED note above for the
       one that used to be, and what it cost. */
    (credGroups() || []).forEach(g => {
      const stale = credStale(g.newest);
      out.push({
        /* Keyed on the credential's own name, which is still carried on the
           group — NOT on `display`, which is now a channel and is deliberately
           shared by every fault on that channel. Keying on the display would
           have collapsed two separate broken connections into one alert. */
        key: `cred-${low(g.name || g.workflow || g.display)}`,
        sev: 'CRITICAL',
        icon: 'key_off',
        title: stale
          ? `${g.subject} was failing, and nothing since proves it is fixed`
          : `${g.subject} is failing`,
        detail: `${stale ? 'While it was failing: ' : ''}${esc(credImpact(g.channels))}<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:4px">${esc(credEvidence(g))}${
          g.viewCount ? `, and the attention list reports ${num(g.viewCount)} open ${plural(g.viewCount, 'item', 'items')} about it` : ''}${
          g.workflows.length ? ` · seen in ${esc(g.workflows.join(', '))}` : ''}.${
          g.named ? '' : ' The text names no credential, so this row is keyed on the workflow it broke rather than merged with every other un-named fault.'}</div>`,
        foot: g.newest
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
      detail: `Your documents returned: ${esc(kbState.err)}. What Ask AI is allowed to answer from is therefore unknown from here.`,
      target: 'setKbCard',
    });
    else if (kbState && kbState.count === 0) out.push({
      key: 'kb-empty', sev: 'WARNING', icon: 'description',
      title: 'The knowledge base is empty',
      detail: 'Your documents holds no rows, so Ask AI has nothing to retrieve and nothing to cite. A question asked there is answered from the model alone or not at all.',
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
    /* `mine` is structurally empty — see NO_ATTN_BRANCH — so this sum is this
       screen's own findings and nothing else. It is written as a sum anyway,
       because the day a settings branch is added to the view its rows must
       start counting here without anybody remembering to come back. */
    const durable = alerts.filter(a => a.sev === 'CRITICAL' || a.sev === 'WARNING');
    const tabCount = root.querySelector('[data-set-tab-count="health"]');
    if (tabCount) tabCount.innerHTML = (durable.length + mine.length) ? `<span class="px-1.5 rounded bg-error text-on-error font-label-numeric-sm text-table-header font-bold">${num(durable.length + mine.length)}</span>` : '';
    const tally = $('setAlertCount');
    if (tally) {
      const n = durable.length + mine.length;
      tally.innerHTML = n
        ? pill(`${n} need${n === 1 ? 's' : ''} attention`, durable.some(a => a.sev === 'CRITICAL') ? 'hot' : 'warm', { verbatim: false })
        : (s ? pill('clear', 'ok', { verbatim: false }) : '');
    }

    const viewRows = mine.map(it => {
      const sev = str(it.severity);
      return `<div class="flex items-start gap-3 px-space-md py-3 border-b border-outline-variant/30 last:border-b-0 hover:bg-surface-container-low transition-colors" style="cursor:default">
        <span class="material-symbols-outlined ${toneText(sevTone(sev))}" style="font-size:20px">${esc(KIND_ICON[it.kind] || 'warning')}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${sev ? pill(sev, sevTone(sev), { verbatim: true }) : ''}${esc(str(it.title) || str(it.kind) || 'Attention item')}
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap">${esc(str(it.kind) || 'item')}</span>
          </div>
          <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${esc(str(it.detail))}</div>
          <div class="font-body-sm text-body-sm text-outline mt-0.5">${it.at
            ? `Waiting since ${esc(clock(it.at))} — ${esc(ago(it.at))}`
            : 'The view gave this item no timestamp, so how long it has been waiting is unknown.'}</div>
        </div></div>`;
    }).join('');

    const derivedRows = alerts.map(a => `
      <div class="flex items-start gap-3 px-space-md py-3 border-b border-outline-variant/30 last:border-b-0 hover:bg-surface-container-low transition-colors" role="button" tabindex="0" data-target="${esc(a.target)}"${a.wf ? ` data-wf="${esc(a.wf)}"` : ''}
        title="Show the panel this is about">
        <span class="material-symbols-outlined ${toneText(sevTone(a.sev))}" style="font-size:20px">${esc(a.icon)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${pill(a.sev, sevTone(a.sev), { verbatim: false })}${esc(a.title)}
          </div>
          <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${a.detail}</div>
          ${a.foot ? `<div class="font-body-sm text-body-sm text-outline mt-0.5">${a.foot}</div>` : ''}
        </div>
        <span class="material-symbols-outlined text-outline" style="font-size:18px">chevron_right</span>
      </div>`).join('');

    /* What was actually checked, and what could not be. A screen that quietly
       drops a failed read reports fewer alerts and looks healthier for it. */
    const checked = [
      !s ? 'The attention list: still reading'
        : s.attnErr ? 'The attention list: unreadable'
        : mine.length
          ? `The attention list: ${num(mine.length)} row${plural(mine.length, '', 's')} for this screen`
          /* Not "0 rows". The view files nothing against Settings, and a zero
             here reads as a clean bill of health from the database. */
          : 'The attention list: files nothing against this screen',
      !s ? 'The automation health figures: still reading'
        : s.healthErr ? 'workflow health: unreadable'
        : `workflow health: ${num(s.health.length)} workflow${plural(s.health.length, '', 's')}`,
      !s ? 'incomplete runs: still reading'
        : s.failsErr ? 'run history: unreadable'
        : `run history: newest ${num(s.fails.length)} failed or half-landed run${plural(s.fails.length, '', 's')}`,
      !probeState ? 'connectivity: probing'
        : (() => {
            const named = probeState.filter(p => AUTO_PROBE.test(p.name));
            const down = named.filter(p => p.state === 'down').map(p => p.name);
            const unread = named.filter(p => p.state !== 'up' && p.state !== 'down').map(p => p.name);
            if (down.length) return `connectivity: ${down.join(', ')} down`;
            if (unread.length) return `connectivity: ${unread.join(', ')} not readable`;
            return 'connectivity: your data and the automation service both answered';
          })(),
      !kbState ? 'knowledge base: still reading'
        : kbState.err ? 'knowledge base: unreadable'
        : `knowledge base: ${num(kbState.count)}${kbState.capped ? '+' : ''} section${plural(kbState.count, '', 's')}`,
    ];
    const subNode = $('setAlertSub');
    if (subNode) subNode.textContent = checked.join(' · ');

    const probeUnread = (probeState || []).filter(p => AUTO_PROBE.test(p.name) && p.state !== 'up' && p.state !== 'down');
    const notes = [
      s?.attnErr ? `The attention list is unreadable (${s.attnErr}), so any item the database itself filed against this screen is missing from the list above, and the count in the header covers only what this screen worked out for itself. The nav badge is painted from that same read, so it is blank right now for the same reason — not because there is nothing behind it.` : '',
      s && s.attn && s.attn.length >= ATTN_LIMIT ? `The attention read is capped at ${num(ATTN_LIMIT)} rows and hit the cap, so items beyond it are outside this window rather than absent.` : '',
      s && s.fails && s.fails.length >= FAIL_LIMIT ? `The read of failed and partial runs is capped at ${num(FAIL_LIMIT)} rows and hit the cap, so a credential whose last incomplete run is older than that is not counted above. Per-workflow totals in the table below come from the automation health figures and are unaffected by this cap.` : '',
      s?.regErr ? `The automation register is unreadable (${s.regErr}), so failures are matched to workflows by display name only. A workflow that logs under a different name than it is registered with will show fewer failures here than it really had.` : '',
      probeState && probeUnread.length ? `The connectivity tile for ${probeUnread.map(p => p.name).join(', ')} did not resolve into a result this strip could read, so no claim is made either way about it — read the tile itself.` : '',
      wfElsewhere.length ? `${num(wfElsewhere.length)} workflow-failure ${plural(wfElsewhere.length, 'item is', 'items are')} filed by the attention list against the Automation screen rather than this one. ${plural(wfElsewhere.length, 'It is', 'They are')} not listed above as this screen's work; ${plural(wfElsewhere.length, 'it feeds', 'they feed')} the credential check only.` : '',
      NO_ATTN_BRANCH,
      `The count beside this card's title is ${num(durable.length)} critical or warning ${plural(durable.length, 'item', 'items')} this screen derived${mine.length ? ` plus ${num(mine.length)} v_needs_attention ${plural(mine.length, 'row', 'rows')} filed against this screen` : ' and nothing else'}${s ? '' : ' so far — the database reads have not landed yet, so this figure can only rise'}. Informational findings are listed but not counted.`,
      `That count is deliberately not the nav badge. Every badge is painted from one read of the attention list, so the sidebar counts only the rows that view files against this screen — a missing environment variable, an expired token or a credential named inside a failure exist nowhere but here and cannot be reproduced from it. This screen used to write its own badge, and the sidebar then disagreed with itself a minute later, when badges.js repainted from the view.`,
    ].filter(Boolean);

    /* Two things this row must never say. It must not claim the view returned
       nothing when the view could not be read — that is the difference between
       a clean screen and a blind one — and it must not appear at all while the
       reads are still in flight, because "nothing needs attention" arriving
       half a second before the first alert is exactly the reassurance this
       strip exists to withhold. */
    const attnUnread = !!(s && s.attnErr);
    const nothing = `<div class="flex items-start gap-3 px-space-md py-3 border-b border-outline-variant/30 last:border-b-0 hover:bg-surface-container-low transition-colors" style="cursor:default">
      <span class="material-symbols-outlined ${attnUnread ? 'text-outline' : 'text-emerald-700'}" style="font-size:20px">${attnUnread ? 'help' : 'task_alt'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500">${attnUnread
          ? 'Nothing this screen could check for itself is wrong'
          : 'Nothing this screen checks is wrong right now'}</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${attnUnread
          ? 'The attention list could not be read, so whether the database has filed anything against this screen is unknown — though it has no settings branch to file from in the first place'
          /* Never "the view returned none today". It has no settings branch;
             its silence about this screen is structural, not a finding. */
          : 'The attention list has no settings branch, so it files nothing here either way'}${s && !s.healthErr
          ? ', no registered workflow is degraded, inactive or still waiting for its first run, and no failed run in the window read here names a credential'
          : ''}${envErrors.length ? '' : ', and every environment variable this build needs is set'}.</div>
      </div></div>`;

    const stillReading = `<div class="flex items-start gap-3 px-space-md py-3 border-b border-outline-variant/30 last:border-b-0 hover:bg-surface-container-low transition-colors" style="cursor:default">
      <span class="material-symbols-outlined text-outline" style="font-size:20px">hourglass_top</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500">Still checking</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">The attention list, the automation health figures and the newest failed runs have not answered yet, so anything they would report is missing from this list. The configuration findings above do not depend on them.</div>
      </div></div>`;

    const notesRow = notes.length ? `<div class="flex items-start gap-3 px-space-md py-3 border-b border-outline-variant/30 last:border-b-0 hover:bg-surface-container-low transition-colors" style="cursor:default">
      <span class="material-symbols-outlined text-outline" style="font-size:18px">info</span>
      <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal">${notes.map(esc).join('<br>')}</div></div>` : '';

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
        reveal(dest);
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
  /* Every state the view can return gets a filter, in the same worst-first
     order the table sorts in, and the labels are read from HEALTH_WORDS rather
     than typed here — a chip that says "Clean" over rows whose pills say
     something else is a second vocabulary by the back door. Only chips with a
     non-zero count are rendered, so adding the four new states costs nothing on
     an instance that has none of them. */
  const WF_FILTERS = [
    { key: 'ALL', label: 'All' },
    ...Object.keys(HEALTH_LOOK)
      .sort((a, b) => HEALTH_LOOK[a].rank - HEALTH_LOOK[b].rank)
      .map(key => ({ key, label: healthWords(key).label })),
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
      wfCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center gap-space-sm"><div><div class="font-headline-md text-headline-md text-on-surface">Workflows</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">The automation health figures could not be read</div></div></div>
        <div class="p-space-md">${stateError('workflow health', s.healthErr)}</div>`;
      credCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center gap-space-sm"><div><div class="font-headline-md text-headline-md text-on-surface">Credentials</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Faults named in the text of a failed run</div></div></div>
        <div class="p-space-md">${renderCreds()}</div>`;
      wireCreds();
      return;
    }

    const rows = (s.health || []).slice().sort((a, b) =>
      healthOf(a).rank - healthOf(b).rank
      /* Tie-break on runs that did not deliver, not on failures_30d. Sorting a
         list of degraded workflows by a column that counts only FAILED puts the
         one that half-landed eleven customer replies below the one that erred
         once. */
      || ((undelivered30(b) || 0) - (undelivered30(a) || 0))
      || String(a.name || '').localeCompare(String(b.name || '')));

    const active = rows.filter(w => w.is_active !== false).length;
    const counts = {};
    WF_FILTERS.forEach(f => { counts[f.key] = rows.filter(w => matchFilter(w, f.key)).length; });

    /* The registry join, used only to attribute failures. Where it is missing
       the fallback is the display name, and the shortfall is stated rather than
       shown as a shorter, healthier-looking history. */
    const regByName = new Map((s.reg || []).map(r => [low(r.name), r]));
    const namesFor = w => {
      const r = regByName.get(low(w.name));
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

    wfCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center gap-space-sm">
        <div><div class="font-headline-md text-headline-md text-on-surface">Workflows</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${num(rows.length)} registered · ${num(active)} switched on · state and 30-day counts read ${esc(clock(s.readAt))}</div></div>
        <div style="flex:1"></div>
        <button class="${BTN.secondary}" id="setWfAutomation">Open Automation</button>
      </div>
      <div class="px-space-md py-3 flex flex-wrap items-center gap-space-sm border-b border-outline-variant/40">
        <div class="inline-flex flex-wrap gap-0.5 p-0.5 rounded-lg bg-surface-container [&>button]:px-3 [&>button]:py-1 [&>button]:rounded-md [&>button]:font-body-sm [&>button]:text-body-sm [&>button]:font-semibold [&>button]:text-on-surface-variant [&>button:hover]:text-on-surface [&>button.on]:bg-surface-container-lowest [&>button.on]:text-on-surface [&>button.on]:shadow-sm" id="setWfSeg" role="group" aria-label="Filter workflows by state">
          ${WF_FILTERS.filter(f => f.key === 'ALL' || counts[f.key])
            .map(f => `<button type="button" data-f="${f.key}" class="${f.key === wfFilter ? 'on' : ''}"
              aria-pressed="${f.key === wfFilter ? 'true' : 'false'}">${esc(f.label)} <span class="text-on-surface-variant">${num(counts[f.key])}</span></button>`).join('')}
        </div>
      </div>
      <div id="setWfList"></div>
      <div class="p-space-md" style="padding-top:0">
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal">${[
          'Active means the workflow is switched on and will run. It does not mean it succeeds — an active workflow with a broken connection runs on every trigger and fails on every trigger, and both of those are true at once.',
          'Success is successes ÷ the runs that counted, computed once by NEXUS rather than by this screen. Runs refused by design and runs escalated to a person on purpose are excluded from the denominator, so an unauthorised caller cannot dilute a real miss rate — which is why “Runs 30 d” can be larger than the number the rate is taken over, and says so where it is.',
          'No output is not Degraded and is not a milder version of it. Those workflows are not failing: the run completes, no error is raised, and every screen that counted only failures called them clean. They simply produce nothing — Competitor Price Scraping held a green “Clean, 30 d · 100.0%” pill for a month while 84 of its 96 runs returned no price.',
          'Not logged is not a pass. Those workflows record nothing about their own runs, so nothing they do reaches the activity log; they are left uncoloured because this dashboard has no evidence either way, and colouring them green would manufacture some.',
          'No runs yet is the same kind of absence: registered to log, never logged, never observed working.',
          'This list is the register of the automations NEXUS runs for you. Every count beside them is this dealership’s alone — “no runs yet” means none for you. A few entries are pages NEXUS publishes rather than automations; where one of those is registered it is labelled "web page" and left out of the not-logged count, because a page that logs nothing is not a blind spot.',
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
            isPublicPage(w) ? ` <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap" title="${esc(PAGE_NOTE)}">web page</span>` : ''}</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${esc(str(w.category) || 'no category recorded')}${
            w.is_active === false
              ? ' · <span class="text-amber-700">switched off — it will not run</span>'
              : ' · <span class="text-on-surface-variant" title="This workflow is switched on and will run. That is all it means: it says nothing about whether the run succeeds.">active</span>'}</div>` },
        { label: 'State', render: w => {
          const h = healthOf(w);
          return `<span title="${esc(h.blurb)}">${pill(h.label, h.t, { verbatim: false })}</span>${
            stateKey(w) === 'UNKNOWN' ? `<div class="font-label-numeric-sm text-label-numeric-sm text-on-surface-variant mt-0.5">${esc(str(w.health) || 'null')}</div>` : ''}`;
        } },
        { label: 'Runs 30 d', align: 'r', render: w => {
          const r = n0(w.runs_30d);
          if (r == null) return '<span class="text-on-surface-variant">—</span>';
          /* Two numbers where the view excludes some: runs logged, and runs
             that count toward the rate. Printing only the first invites the
             reader to do the division themselves and get a different answer
             from the one in the next-but-one column. */
          const eff = n0(w.effective_runs_30d);
          const excluded = eff == null ? 0 : r - eff;
          return `<span title="${esc(runsBreakdown(w))}">${num(r)}</span>${
            excluded > 0 ? `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${num(eff)} count toward the rate</div>` : ''}`;
        } },
        /* Was "Failed 30 d", reading straight off failures_30d — a column that
           counted status='FAILED' and nothing else, so a workflow whose every
           run was REJECTED or NOT_EXECUTED showed a proud 0 here and 100% in
           the next column. What the dealership feels is a run that did not
           deliver, whatever the writer called it, so all three shapes of that
           are added and then broken apart underneath. */
        { label: 'Did not deliver 30 d', align: 'r', render: w => {
          const total = undelivered30(w);
          if (total == null) return '<span class="text-on-surface-variant">—</span>';
          const f = n0(w.failures_30d) || 0, pa = n0(w.partials_30d) || 0, none = n0(w.no_result_30d) || 0;
          const parts = [
            f ? `${num(f)} failed` : '',
            pa ? `${num(pa)} half-landed` : '',
            none ? `${num(none)} produced nothing` : '',
          ].filter(Boolean);
          return total
            ? `<span class="text-red-700">${num(total)}</span><div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${esc(parts.join(' · '))}</div>`
            : num(0);
        } },
        { label: 'Success 30 d', align: 'r', render: w => {
          const r = rate30(w);
          /* successes_30d ÷ effective_runs_30d, computed by the view against
             nexus_outcome_class(). Null is not 0% and not 100%: it is no
             qualifying run, and the reason differs by state. */
          return r == null
            ? `<span class="text-on-surface-variant" title="${esc(noRateWhy(w))}">—</span>`
            : `<span title="${esc(runsBreakdown(w))}">${esc(pct(r))}</span>`;
        } },
        { label: 'Last run', align: 'r', render: w => w.last_run
          ? esc(ago(w.last_run))
          : '<span class="text-on-surface-variant">never</span>' },
      ], list, {
        empty: stateEmpty('No workflow in that state', 'Nothing in the automation health figures matches this filter right now.', 'filter_alt'),
        onRow: true,
      });
      wireRows(listHost, list, openWf);
    };

    function openWf(w) {
      const h = healthOf(w);
      const fails = failsFor(w);
      const shown = (fails || []).slice(0, 6);
      const r30 = n0(w.runs_30d), eff30 = n0(w.effective_runs_30d);
      const viewRate = n0(w.success_rate);
      const own30 = rate30(w);
      openDrawer(`
        <div class="px-space-lg py-space-md flex items-start justify-between gap-space-sm bg-surface-container-lowest shadow-sm shrink-0">
          <div style="flex:1">
            <h2 style="font-size:18px">${esc(str(w.name) || 'Unnamed workflow')}</h2>
            <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${esc(str(w.category) || 'no category recorded')}</div>
            ${/* This line used to join `category`, `trigger_type` and
                 `trigger_detail` and print “no trigger recorded” when all three
                 were empty. The last two are control-plane columns — absent from
                 `nexus_workflow_catalogue()`'s result type, not selected by
                 `v_workflow_health` (CONTROL-PLANE.md 5.2) — so they were empty
                 on every row and any workflow with a blank category told this
                 dealership its own register held no trigger. It holds one; this
                 login may not read it. screens/automation.js reached the same
                 verdict and replaced the same wording; this is that fix carried
                 across, and the line below states the boundary instead of
                 asserting an absence. */ ''}
            <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal;margin-top:2px">${esc(TRIGGER_NOT_AVAILABLE)}</div>
          </div>
          <button class="${BTN.tertiary}" id="wfClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div class="flex-1 overflow-y-auto p-space-md space-y-space-md bg-surface-container-low/40">
          <div class="flex flex-col gap-1">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${pill(h.label, h.t, { verbatim: false })}
              ${w.is_active === false
                ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap" title="Switched off. Nothing will trigger it.">Inactive</span>'
                : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap" title="Switched on and will run. It is not a statement about whether the run succeeds.">Active</span>'}
              ${w.writes_audit_log ? '' : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap" title="No Audit Log node, so nothing it does reaches the activity log.">Writes no audit row</span>'}</div>
            <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:8px;white-space:normal">${esc(h.blurb)}</div>
            ${w.description ? `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:8px;white-space:normal">${esc(str(w.description))}</div>` : ''}
          </div>
          <div class="flex flex-col gap-1" style="margin-top:20px">
            <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">What the view reports</div>
            <dl class="grid grid-cols-[minmax(120px,180px)_1fr] gap-x-4 gap-y-2.5 font-body-sm text-body-sm [&>dt]:font-table-header [&>dt]:text-table-header [&>dt]:uppercase [&>dt]:tracking-wider [&>dt]:text-outline [&>dt]:font-semibold [&>dt]:pt-0.5 [&>dd]:text-on-surface [&>dd]:min-w-0" style="margin-top:10px">
              <dt>Runs, 30 days</dt><dd>${r30 == null ? '<span class="text-on-surface-variant">not reported</span>' : num(r30)}</dd>
              <dt>Counted toward the rate</dt><dd>${eff30 == null
                ? '<span class="text-on-surface-variant">not reported</span>'
                : `${num(eff30)}${r30 != null && r30 !== eff30
                    ? ` <span class="text-on-surface-variant">· ${num(r30 - eff30)} excluded: refused by design or escalated to a person on purpose</span>`
                    : ''}`}</dd>
              ${OUTCOME_ROWS.map(([label, key, why]) => {
                const v = n0(w[key]);
                /* Every outcome the view separates is shown, and a zero is
                   shown as a zero — the point of the row is that this workflow
                   was measured on it. A column the view did not return is the
                   only thing that reads "not reported". */
                return `<dt title="${esc(why)}">${esc(label)}</dt><dd>${v == null
                  ? '<span class="text-on-surface-variant">not reported</span>'
                  : (v ? `${num(v)}` : '<span class="text-on-surface-variant">0</span>')}</dd>`;
              }).join('')}
              <dt>Success, 30 days</dt><dd>${own30 == null
                ? `<span class="text-on-surface-variant">${esc(noRateWhy(w))}</span>`
                : `${esc(pct(own30))} <span class="text-on-surface-variant">· successes_30d ÷ effective_runs_30d, computed by the view</span>`}</dd>
              <dt>Runs, all time</dt><dd>${num(n0(w.runs) ?? 0)}</dd>
              <dt>Failures, all time</dt><dd>${num(n0(w.failures) ?? 0)}</dd>
              <dt>success_rate</dt><dd>${viewRate == null
                ? '<span class="text-on-surface-variant">not reported</span>'
                : `${esc(pct(viewRate))} <span class="text-on-surface-variant">· the view's all-time column, over its own window</span>`}</dd>
              <dt>Last run</dt><dd>${w.last_run ? esc(ago(w.last_run)) + ` <span class="text-on-surface-variant font-label-numeric-sm">${esc(clock(w.last_run))}</span>` : '<span class="text-on-surface-variant">never</span>'}</dd>
              <dt>Last success</dt><dd>${w.last_success ? esc(ago(w.last_success)) + ` <span class="text-on-surface-variant font-label-numeric-sm">${esc(clock(w.last_success))}</span>` : '<span class="text-on-surface-variant">no run has ever succeeded outright</span>'}</dd>
              <dt>Last failure</dt><dd>${w.last_failure ? `<span class="text-red-700">${esc(ago(w.last_failure))}</span>` : '<span class="text-on-surface-variant">none recorded</span>'}</dd>
              <dt>Last half-landed</dt><dd>${w.last_partial ? `<span class="text-red-700">${esc(ago(w.last_partial))}</span>` : '<span class="text-on-surface-variant">none recorded</span>'}</dd>
            </dl>
            <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:8px;white-space:normal">${esc(runsBreakdown(w))}</div>
            ${own30 != null && viewRate != null && Math.abs(own30 - viewRate) > 0.1
              ? '<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:8px;white-space:normal">The two rates differ, and they are not the same measurement: the first is the 30-day window classified through NEXUS’s own rule for what a run achieved, the second is the view’s own all-time column. Neither is corrected against the other here.</div>'
              : ''}
          </div>
          <div class="flex flex-col gap-1" style="margin-top:20px">
            <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Recent incomplete runs</div>
            ${fails == null
              ? `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:8px;white-space:normal">${esc(`The activity log could not be read (${s.failsErr || 'unknown error'}), so the text of any failure is unavailable. The counts above come from the automation health figures and are unaffected.`)}</div>`
              : shown.length
                ? shown.map(f => {
                    /* The row is labelled with what it actually was. A FAILED
                       whose own summary says "n of m claimed steps did not
                       land" is a partial delivery, and lib/health.js is the one
                       place allowed to make that call. */
                    const o = outcomeWords(outcomeOf(f));
                    return `<div class="flex items-start gap-3 px-space-md py-3 border-b border-outline-variant/30 last:border-b-0 hover:bg-surface-container-low transition-colors" style="cursor:default;align-items:flex-start;flex-direction:column;gap:4px">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span title="${esc(o.blurb)}">${pill(o.label, o.tone, { verbatim: false })}</span>
                      <span class="font-label-numeric-sm text-label-numeric-sm text-on-surface-variant mt-0.5">${esc(clock(f.logged_at))} · ${esc(ago(f.logged_at))}</span></div>
                    <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:pre-wrap">${esc(str(f.summary) || 'The run logged no summary text.')}</div>
                  </div>`;
                  }).join('')
                : `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:8px;white-space:normal">${esc(`No row among the newest ${FAIL_LIMIT} failed or half-landed runs is attributed to this workflow. ${w.writes_audit_log ? 'Either nothing of either kind happened inside that window, or it logs under a name the registry does not list. Note that a run which produced nothing usable is neither, and would not appear here — the counters above are where those are counted.' : 'It writes no audit row at all, so it could not appear here whatever it did.'}`)}</div>`}
            ${fails && fails.length > shown.length ? `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:8px">${esc(`${fails.length - shown.length} older rows in this window are not shown. The Automation screen holds the full history.`)}</div>` : ''}
          </div>
        </div>
        <div class="p-space-md bg-surface-container-lowest flex flex-wrap items-center gap-space-sm shrink-0 border-t border-outline-variant/40">
          <button class="${BTN.secondary}" id="wfClose2">Close</button>
          <div style="flex:1"></div>
          <button class="${BTN.secondary}" disabled title="This dashboard only starts a workflow when it has a real subject to start it against — a customer, a deal, a document. Firing one from here just to see whether it works would do real work: enrol a customer, send a message, bill a run.">Run now</button>
        </div>`);
      $('wfClose').addEventListener('click', closeDrawer);
      $('wfClose2').addEventListener('click', closeDrawer);
    }

    drawWf();
    $('setWfSeg').querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => setWfFilter(b.dataset.f)));

    credCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center gap-space-sm"><div><div class="font-headline-md text-headline-md text-on-surface">Credentials</div>
      <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Faults named in the text of a failed or half-landed run — the only evidence about a connection this dashboard can have. Nothing here claims a connection works: this panel reports faults and their age, and never a clean bill of health.</div></div></div>
      <div class="p-space-md">${renderCreds()}</div>`;
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
      /* The read's own words used to be pasted in front of this sentence. The
         sentence is what matters and it is ours; what the database said about
         itself goes to the console with the rest. */
      return stateError('credential faults', s.failsErr, null,
        'A broken credential names itself only inside the run it breaks, so with the activity log unreadable this panel has no evidence to show — which is not the same as there being none.');
    }
    const groups = credGroups() || [];
    if (!groups.length) {
      return stateEmpty('No credential fault in this window',
        `None of the newest ${FAIL_LIMIT} failed or half-landed runs mentions a credential. That covers the runs that were logged: a workflow with no Audit Log node could be failing on a credential right now and would not appear here.`,
        'key');
    }
    return `<div>${groups.map(g => {
      const stale = credStale(g.newest);
      return `
      <div class="flex items-start gap-3 px-space-md py-3 border-b border-outline-variant/30 last:border-b-0 hover:bg-surface-container-low transition-colors" style="cursor:default;align-items:flex-start;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:100%">
          <span class="material-symbols-outlined text-red-700" style="font-size:20px">key_off</span>
          <span style="font-weight:500">${esc(g.display)}</span>
          ${pill('CRITICAL', 'hot', { verbatim: false })}
          <div style="flex:1"></div>
          <button class="${BTN.secondary}" disabled title="${esc(NO_CRED_FIX)}">Reconnect</button>
        </div>
        ${g.named ? '' : `<div class="font-body-sm text-body-sm text-outline mt-0.5" style="white-space:normal">The text of these runs names no credential — “Forbidden - perhaps check your credentials?” names nothing — so this row is keyed on the workflow that broke rather than pooled with every other un-named fault. Two workflows failing on one shared credential will therefore appear here twice, which is the safer error: it overstates how many things to look at and hides nothing.</div>`}
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal">${stale ? 'While it was failing: ' : ''}${esc(credImpact(g.channels))}</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${esc(credEvidence(g))}${
          g.viewCount ? ` · the attention list reports ${num(g.viewCount)} open ${plural(g.viewCount, 'item', 'items')} about it` : ''}${
          g.newest ? ` · most recent ${esc(ago(g.newest))}` : ''}</div>
        ${stale ? `<div class="font-body-sm text-body-sm text-outline mt-0.5" style="white-space:normal">${esc(CRED_STALE_LINE)}</div>` : ''}
        ${g.workflows.length
          ? `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Seen in: ${g.workflows.map(w =>
              `<button type="button" class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap" style="border:0;cursor:pointer;font-family:inherit" data-wf-name="${esc(w)}"
                title="Show this in the workflow table above">${esc(w)}</button>`).join(' ')}</div>`
          : '<div class="font-body-sm text-body-sm text-outline mt-0.5">No run in this window records which workflow it belongs to.</div>'}
      </div>`;
    }).join('')}
      <div class="flex items-start gap-3 px-space-md py-3 border-b border-outline-variant/30 last:border-b-0 hover:bg-surface-container-low transition-colors" style="cursor:default">
        <span class="material-symbols-outlined text-outline" style="font-size:18px">info</span>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:normal">${esc(NO_CRED_FIX)}</div>
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
        reveal(dest);
        if (dest) dest.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  /* ── Knowledge base ─────────────────────────────────────────────────────
     The documents Ask AI is permitted to answer from. Sections are the unit
     actually retrieved, so both counts are shown: an operator who sees "6
     documents" and gets a thin answer needs to know whether those six were
     chunked into 400 sections or into 6. */
  const kb = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm'); kb.id = 'setKbCard'; pane.kb.appendChild(kb);

  const kbShell = (sub, body) => {
    kb.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-center gap-space-sm">
        <div><div class="font-headline-md text-headline-md text-on-surface">Knowledge base</div><div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${sub}</div></div>
        <div style="flex:1"></div>
        <button class="${BTN.tertiary}" id="kbReload" aria-label="Reload the knowledge base">
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
            'Your documents is empty, so Ask AI has nothing to retrieve and nothing to cite. A document has to be ingested before it can answer anything.',
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
      kbShell('What Ask AI is allowed to answer from', stateError('the knowledge base', e));
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
      ${capped ? `<div class="flex items-start gap-3 p-space-md rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm mb-space-sm" style="margin:16px 16px 0"><span class="material-symbols-outlined" style="font-size:20px">filter_alt</span>
        <div>Showing the first ${num(KB_LIMIT)} sections only. The knowledge base is larger than this listing, so the totals above are a floor rather than a count.</div></div>` : ''}
      ${untitled ? `<div class="flex items-start gap-3 p-space-md rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm mb-space-sm" style="margin:16px 16px 0"><span class="material-symbols-outlined" style="font-size:20px">help</span>
        <div>${num(untitled)} section${untitled === 1 ? ' has' : 's have'} no <span class="font-label-numeric-sm">${esc(titleKey || 'title')}</span> value, so ${untitled === 1 ? 'it cannot' : 'they cannot'} be attributed to a document. Ask AI can still retrieve ${untitled === 1 ? 'it' : 'them'}, but a citation will have nothing to name.</div></div>` : ''}
      ${!titleKey ? `<div class="flex items-start gap-3 p-space-md rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm mb-space-sm" style="margin:16px 16px 0"><span class="material-symbols-outlined" style="font-size:20px">info</span>
        <div>Nothing in your documents records which document a section came from, so sections cannot be grouped by document. NEXUS can correct that when the documents are next loaded.</div></div>` : ''}
      ${!dateKey ? `<div class="flex items-start gap-3 p-space-md rounded-lg border border-sky-200 bg-sky-50/50 text-sky-950 font-body-sm text-body-sm mb-space-sm" style="margin:16px 16px 0"><span class="material-symbols-outlined" style="font-size:20px">schedule</span>
        <div>Your documents carry no date of any kind — nothing recording when a section was added or last changed. So <strong>how fresh this knowledge base is cannot be answered from the data</strong>, and this panel does not guess one: inferring a load date from the order the sections were stored in would be invention dressed as a fact. If Ask AI is citing a price list that was superseded a month ago, nothing on this screen will show it — the only way to know is to load the documents again and compare.</div></div>` : ''}
      <div class="px-space-md py-3 flex flex-wrap items-center gap-space-sm border-b border-outline-variant/40">
        <div class="inline-flex flex-wrap gap-0.5 p-0.5 rounded-lg bg-surface-container [&>button]:px-3 [&>button]:py-1 [&>button]:rounded-md [&>button]:font-body-sm [&>button]:text-body-sm [&>button]:font-semibold [&>button]:text-on-surface-variant [&>button:hover]:text-on-surface [&>button.on]:bg-surface-container-lowest [&>button.on]:text-on-surface [&>button.on]:shadow-sm" id="kbSeg" role="group" aria-label="Sort documents">
          <button type="button" data-s="name" class="on" aria-pressed="true">By name</button>
          <button type="button" data-s="size" aria-pressed="false">${textKey ? 'Largest first' : 'Most sections'}</button>
        </div>
        <div class="flex-1 min-w-0">
          <label class="sr-only" for="kbQ">Search the knowledge base</label>
          <input type="search" id="kbQ" class="w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm text-on-surface focus:outline-none focus:border-primary" placeholder="Search document, section or source file" />
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
          <div>${g.title ? esc(g.title) : '<span class="text-on-surface-variant">Untitled sections</span>'}</div>
          ${g.sources.size
            ? `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${esc([...g.sources].slice(0, 2).join(', '))}${g.sources.size > 2 ? ` +${g.sources.size - 2} more` : ''}</div>`
            : hasSrc ? '<div class="font-body-sm text-body-sm text-outline mt-0.5">no source file recorded</div>' : ''}` },
        { label: 'Sections', align: 'r', render: g => num(g.secs.length) },
      ];
      if (textKey) tcols.push({ label: 'Size', align: 'r', render: g => charText(g.chars) });
      if (hasPage) tcols.push({ label: 'Pages', align: 'r', render: g => {
        if (!g.pages.length) return '<span class="text-on-surface-variant">—</span>';
        const lo = Math.min(...g.pages), hi = Math.max(...g.pages);
        return esc(lo === hi ? String(lo) : `${lo}–${hi}`);
      } });
      if (dateKey) tcols.push({ label: 'Indexed', align: 'r', render: g =>
        g.last ? esc(ago(new Date(g.last).toISOString())) : '<span class="text-on-surface-variant">—</span>' });

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
        <div class="px-space-lg py-space-md flex items-start justify-between gap-space-sm bg-surface-container-lowest shadow-sm shrink-0">
          <div style="flex:1">
            <h2 style="font-size:18px">${g.title ? esc(g.title) : 'Untitled sections'}</h2>
            <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${num(g.secs.length)} retrievable section${g.secs.length === 1 ? '' : 's'}${
              textKey ? ` · ${charText(g.chars)}` : ''}</div>
          </div>
          <button class="${BTN.tertiary}" id="kbClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div class="flex-1 overflow-y-auto p-space-md space-y-space-md bg-surface-container-low/40">
          <div class="flex flex-col gap-1">
            <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Document</div>
            <dl class="grid grid-cols-[minmax(120px,180px)_1fr] gap-x-4 gap-y-2.5 font-body-sm text-body-sm [&>dt]:font-table-header [&>dt]:text-table-header [&>dt]:uppercase [&>dt]:tracking-wider [&>dt]:text-outline [&>dt]:font-semibold [&>dt]:pt-0.5 [&>dd]:text-on-surface [&>dd]:min-w-0" style="margin-top:10px">
              <dt>Source files</dt><dd>${g.sources.size ? esc([...g.sources].join(', ')) : '<span class="text-on-surface-variant">none recorded</span>'}</dd>
              <dt>Sections</dt><dd>${num(g.secs.length)}</dd>
              ${textKey ? `<dt>Indexed size</dt><dd>${charText(g.chars)}</dd>` : ''}
              ${hasPage ? `<dt>Pages</dt><dd>${g.pages.length
                ? esc(`${Math.min(...g.pages)}–${Math.max(...g.pages)}`)
                : '<span class="text-on-surface-variant">not recorded</span>'}</dd>` : ''}
              ${dateKey ? `<dt>Last indexed</dt><dd>${g.last
                ? esc(ago(new Date(g.last).toISOString()))
                : '<span class="text-on-surface-variant">not recorded</span>'}</dd>` : ''}
            </dl>
          </div>
          <div class="flex flex-col gap-1" style="margin-top:20px">
            <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Sections as stored</div>
            ${secs.map((r, i) => {
              const body = textKey ? String(r[textKey] ?? '') : '';
              const meta = [
                hasPage && n0(r.page_number) != null ? `page ${n0(r.page_number)}` : null,
                hasSrc && r.source_file ? String(r.source_file) : null,
                textKey ? charText(body.length) : null,
              ].filter(Boolean);
              return `<div class="flex items-start gap-3 px-space-md py-3 border-b border-outline-variant/30 last:border-b-0 hover:bg-surface-container-low transition-colors" style="cursor:default;align-items:flex-start;flex-direction:column;gap:4px">
                <div style="font-weight:500">${hasSect && r.section ? esc(r.section) : `Section ${i + 1}`}</div>
                <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${meta.length ? esc(meta.join(' · ')) : '<span class="text-on-surface-variant">no section metadata</span>'}</div>
                ${textKey
                  ? (body
                      ? `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="white-space:pre-wrap;margin-top:4px">${esc(body.slice(0, PREVIEW_CHARS))}${body.length > PREVIEW_CHARS ? '…' : ''}</div>`
                      : '<div class="font-body-sm text-body-sm text-outline mt-0.5" style="margin-top:4px">This section is stored empty, so retrieving it returns nothing.</div>')
                  : ''}
              </div>`;
            }).join('')}
          </div>
          ${!textKey ? `<div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:14px">Nothing in your documents holds the text of a section, so section contents and sizes cannot be shown. What NEXUS is storing for them is not what this panel needs, and only NEXUS can change that.</div>` : ''}
        </div>
        <div class="p-space-md bg-surface-container-lowest flex flex-wrap items-center gap-space-sm shrink-0 border-t border-outline-variant/40">
          <button class="${BTN.secondary}" id="kbClose2">Close</button>
          <div style="flex:1"></div>
          <button class="${BTN.secondary}" disabled title="${esc(NO_KB_EDIT)}">Edit document</button>
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

  const look = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-md'); prefsMain.appendChild(look);
  look.innerHTML = `<div class="flex items-start gap-2.5 mb-space-sm"><span class="material-symbols-outlined text-primary text-[22px]">palette</span>
      <div><h2 class="font-headline-md text-headline-md text-on-surface">Appearance &amp; locale</h2>
        <p class="font-body-sm text-body-sm text-on-surface-variant">Table density, and how times are shown.</p></div></div>
    <div class="flex flex-col divide-y divide-outline-variant/30">
      <div class="py-3 flex items-center justify-between gap-space-md">
        <div><div class="font-body-md text-body-md font-semibold text-on-surface">Data table density</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant" id="setDensityHint">${esc(DENSITIES.find(d => isOn(d.id)).hint)}</div></div>
        <div class="inline-flex flex-wrap gap-0.5 p-0.5 rounded-lg bg-surface-container [&>button]:px-3 [&>button]:py-1 [&>button]:rounded-md [&>button]:font-body-sm [&>button]:text-body-sm [&>button]:font-semibold [&>button]:text-on-surface-variant [&>button:hover]:text-on-surface [&>button.on]:bg-surface-container-lowest [&>button.on]:text-on-surface [&>button.on]:shadow-sm" id="setDensity" role="group" aria-label="Table density">
          ${DENSITIES.map(d => `<button type="button" data-d="${d.id}" class="${isOn(d.id) ? 'on' : ''}"
            aria-pressed="${isOn(d.id) ? 'true' : 'false'}">${esc(d.label)}</button>`).join('')}
        </div>
      </div>
      <div class="py-3 flex items-center justify-between gap-space-md">
        <div><div class="font-body-md text-body-md font-semibold text-on-surface">Timestamp standard</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant">Gulf Standard Time (GST, UTC+04:00), 24-hour, on every screen.</div></div>
        <span class="font-label-numeric-sm text-label-numeric-sm px-2 py-1 rounded bg-surface-container text-on-surface font-semibold whitespace-nowrap">24-HOUR · GST</span>
      </div>
    </div>
    <div class="flex items-start gap-2 pt-space-sm font-body-sm text-body-sm text-on-surface-variant">
      <span class="material-symbols-outlined text-[18px] text-outline">info</span><span>${esc(NO_PERSIST)}</span>
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

  /* ── Privacy and test records (lib/privacy.js) ───────────────────────────
     Both are per-browser switches, remembered by lib/prefs.js. Privacy mode is
     also on the top bar; it is repeated here so it can be found. Test records
     are the fixtures NEXUS's own checks write (NEXUS TEST …, Preflight …): hidden
     from every list and count unless this is on. */
  const priv = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-md'); prefsMain.appendChild(priv);
  const hidden = hiddenTestCount();
  const ROW_BOX = 'flex items-center justify-between gap-space-md p-space-sm rounded-lg bg-surface-container-low cursor-pointer';
  const CHECK = 'w-5 h-5 shrink-0 accent-primary cursor-pointer';
  priv.innerHTML = `<div class="flex items-start justify-between gap-space-sm mb-space-sm">
      <div class="flex items-start gap-2.5"><span class="material-symbols-outlined text-primary text-[22px]">visibility_off</span>
        <div><h2 class="font-headline-md text-headline-md text-on-surface">Showroom privacy mode</h2>
          <p class="font-body-sm text-body-sm text-on-surface-variant">Masks customer names, phones and emails on every screen, for screen sharing and floor displays. Remembered by this browser.</p></div></div>
      ${privacyOn() ? statusChip('live', 'Active protection') : statusChip('not-tested', 'Off')}</div>
    <div class="flex flex-col gap-space-sm">
      <label class="${ROW_BOX}"><span><span class="font-body-md text-body-md font-semibold text-on-surface">Privacy mode</span>
        <span class="block font-body-sm text-body-sm text-on-surface-variant">Masks customer names, phones and emails. Also on the top bar.</span></span>
        <input type="checkbox" id="setPrivacy" class="${CHECK}" ${privacyOn() ? 'checked' : ''} /></label>
      <label class="${ROW_BOX}"><span><span class="font-body-md text-body-md font-semibold text-on-surface">Show internal test records</span>
        <span class="block font-body-sm text-body-sm text-on-surface-variant">Records created by NEXUS's own system checks. Hidden from lists and counts unless this is on.</span></span>
        <input type="checkbox" id="setShowTests" class="${CHECK}" ${showTestRecords() ? 'checked' : ''} /></label>
    </div>
    ${hidden && !showTestRecords() ? `<div class="font-body-sm text-body-sm text-outline mt-space-sm">${num(hidden)} test ${hidden === 1 ? 'record' : 'records'} hidden</div>` : ''}`;
  $('setPrivacy').addEventListener('change', e => setPrivacy(e.target.checked));
  $('setShowTests').addEventListener('change', e => setShowTestRecords(e.target.checked));  // app.js re-renders on the change

  /* -- Team --------------------------------------------------------------
     Added 21 Sep 2026 (nx1004). See the header rule above for the honesty
     account of why this screen writes here at all. This card offers ONE
     dealership -- the one tenantState() resolves for this account, the same
     tenant every other screen scopes itself to -- and never a picker,
     because that IS the whole difference between this control and
     screens/founder.js's own invite panel: a founder names which
     dealership; an owner has exactly one to name, and the Edge Function
     would refuse any id that were not it. */
  const teamTenant = tenantState().active;
  const teamTenantId = teamTenant?.id || null;
  const teamTenantName = teamTenant?.name || teamTenant?.slug || null;
  if (teamTenantId && canInviteTeam(teamTenantId)) {
    const team = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-md'); pane.dealer.appendChild(team);
    let tBusy = false, tMsg = '', tTone = 'ok';
    /* The same shape screens/founder.js's refusalText() reads, narrowed to
       the one body shape this card can ever receive -- founder-invite's own
       {"outcome":"error","message":"…","detail":"NX_INVITE_…"} -- because
       this card never calls an nexus_founder_* RPC and has no NX001 body to
       read. */
    const teamErrText = e => {
      const raw = String(e && e.technical || '');
      const i = raw.indexOf('{');
      if (i >= 0) {
        try {
          const j = JSON.parse(raw.slice(i));
          if (j && j.outcome === 'error' && typeof j.message === 'string') return j.message;
        } catch { /* not the Edge Function's own JSON -- fall through */ }
      }
      return String(e && e.message || 'The invite did not go through.');
    };
    const tDraw = () => {
      team.innerHTML = `<div class="font-headline-md text-headline-md text-on-surface">Team</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-bottom:14px">Invite a teammate into ${esc(teamTenantName || 'this dealership')}. NEXUS sends them a real invite email. The invite is sent from NEXUS&rsquo;s servers; no privileged key ever reaches this browser.</div>
        ${tMsg ? `<div class="${bannerClass(tTone === 'ok' ? 'info' : 'hot')}" style="margin-bottom:14px"><span class="material-symbols-outlined" style="font-size:20px">${tTone === 'ok' ? 'check_circle' : 'error'}</span><div>${esc(tMsg)}</div></div>` : ''}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-space-md" style="gap:12px">
          <div class="flex flex-col gap-1 [&>label]:font-table-header [&>label]:text-table-header [&>label]:uppercase [&>label]:tracking-wider [&>label]:text-outline [&>label]:font-semibold [&_input]:w-full [&_input]:px-3 [&_input]:py-2 [&_input]:rounded-lg [&_input]:border [&_input]:border-outline-variant [&_input]:bg-surface-container-lowest [&_input]:text-on-surface [&_input:focus]:outline-none [&_input:focus]:border-primary [&_select]:w-full [&_select]:px-3 [&_select]:py-2 [&_select]:rounded-lg [&_select]:border [&_select]:border-outline-variant [&_select]:bg-surface-container-lowest [&_select]:text-on-surface [&_textarea]:w-full [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-outline-variant [&_textarea]:bg-surface-container-lowest"><label for="teamEmail">Email</label><input id="teamEmail" type="email" placeholder="colleague@dealer.com" /></div>
          <div class="flex flex-col gap-1 [&>label]:font-table-header [&>label]:text-table-header [&>label]:uppercase [&>label]:tracking-wider [&>label]:text-outline [&>label]:font-semibold [&_input]:w-full [&_input]:px-3 [&_input]:py-2 [&_input]:rounded-lg [&_input]:border [&_input]:border-outline-variant [&_input]:bg-surface-container-lowest [&_input]:text-on-surface [&_input:focus]:outline-none [&_input:focus]:border-primary [&_select]:w-full [&_select]:px-3 [&_select]:py-2 [&_select]:rounded-lg [&_select]:border [&_select]:border-outline-variant [&_select]:bg-surface-container-lowest [&_select]:text-on-surface [&_textarea]:w-full [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-outline-variant [&_textarea]:bg-surface-container-lowest"><label for="teamRole">Role</label><select id="teamRole">
            ${['admin', 'manager', 'sales', 'technician', 'member'].map(r => `<option value="${esc(r)}"${r === 'sales' ? ' selected' : ''}>${esc(r)}</option>`).join('')}
          </select></div>
        </div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5" style="margin-top:8px">The owner role is not offered here -- granting it is a roster action (nexus_team_set_role, on the Team screen), and team_05's own rule restricts setting or removing owner to an existing owner acting on that roster, not to an invite.</div>
        <button class="${BTN.primary}" id="teamGo" style="margin-top:14px"${tBusy ? ' disabled' : ''}>${tBusy ? 'Sending…' : 'Send invite'}</button>`;
      $('teamGo')?.addEventListener('click', teamSend);
    };
    const teamSend = async () => {
      if (tBusy) return;
      const email = ($('teamEmail')?.value || '').trim().toLowerCase();
      const role = $('teamRole')?.value || 'sales';
      if (!email || email.indexOf('@') < 1) { tMsg = 'That is not an email address.'; tTone = 'hot'; tDraw(); return; }
      tBusy = true; tMsg = ''; tDraw();
      try {
        const back = await edgeFn('founder-invite', { tenant_id: teamTenantId, email, role });
        tMsg = back.outcome === 'invited'
          ? `An invite email was sent to ${back.email} as ${back.role}.`
          : back.outcome === 'already_member'
            ? `${back.email} already has access -- nothing was changed.`
            : `${back.email} already had a NEXUS login; they now have access as ${back.role}.`;
        tTone = 'ok';
      } catch (e) {
        tMsg = teamErrText(e); tTone = 'hot';
      } finally {
        tBusy = false; tDraw();
      }
    };
    tDraw();
  } else {
    const team = el('section', 'rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-md flex items-start justify-between gap-space-md');
    team.innerHTML = `<div><h2 class="font-headline-md text-headline-md text-on-surface">Team</h2>
      <p class="font-body-sm text-body-sm text-on-surface-variant">${teamTenantId
        ? 'Inviting a teammate is an owner’s action, and this account is not recorded as this dealership’s owner. The roster and roles are on the Team screen.'
        : 'Which dealership this account belongs to could not be read, so no invite can be offered here.'}</p></div>
      <button type="button" class="${BTN.secondary}" data-go-team>Open Team</button>`;
    team.querySelector('[data-go-team]').addEventListener('click', () => go('team'));
    pane.dealer.appendChild(team);
  }

  /* The screen is not finished until its own reads are: returning earlier would
     let nav.js call it done while three panels still say "loading". */
  await sysRead;
  const foot = el('div', '');
  foot.innerHTML = trustFooter({ source: 'users · v_workflow_health · audit_log · rag_documents · this device',
    asOf: sysState ? dubaiTime(sysState.readAt) : null,
    evidence: sysState && sysState.health ? `${num(sysState.health.length)} workflows read` : null,
    actor: (ME && (ME.name || ME.email)) || email });
  root.appendChild(foot);
};
