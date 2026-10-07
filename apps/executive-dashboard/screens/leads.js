/* NEXUS OS — screens/leads.js
   Split out of the original monolithic app.js on 17 Aug 2026, reworked on
   19 Aug 2026 into a workable pipeline (filter, sort, search, the two workflow
   actions a rep actually takes), and given an alert strip on 24 Aug 2026.

   What the strip is, and what it deliberately is not:

   `v_needs_attention` is the only source here that speaks for the whole
   database. It emits `lead_unassigned` and `sla_breach` rows with
   `screen = 'leads'`. Read live on 1 Sep 2026 the view returns 12 rows and none
   of them is for this screen — but the reason matters and it has changed.
   `lead_unassigned` is quiet because no lead is HOT. `sla_breach` is quiet
   because its arm is `response_time_minutes > 5 AND created_at > now() - 30
   days`, and the two leads that carry a figure were answered in 1 and 4
   minutes. Until 31 Aug that arm could not fire on anything, because the column
   held 0 on every row — so its silence meant nothing at all. It now means
   something, which is why nothing on this screen calls it an unmeasured promise
   any more.

   So "nothing right now" is the normal case and is written as a sentence rather
   than as an empty box; the day a row does appear it renders on the view's own
   terms (severity, title, detail, how long it has been waiting) and clicking it
   opens that lead here.

   Below the view's rows sit four checks the view does not make. Every one is
   computed from rows this screen had already read, except "never contacted",
   which needs communication_logs and therefore shares one bounded windowed read
   with nothing else on the screen. None of them estimates: each states the
   denominator it counted against, and a check whose read failed is withheld and
   named rather than quietly reported as zero — a zero the operator would trust.

   Identity, and why this file no longer does its own matching. Until 1 Sep the
   two contact checks joined `communication_logs.lead_email` to `leads.email` by
   string equality. That column is not one key space: it holds a real email, a
   `@c.us` chat id, a `@lid` handle and a synthetic `+digits@whatsapp.lead` key,
   and one person is filed under several of them at once. Live proof on 1 Sep
   2026: lead 38's 29 log rows are split 15 under his gmail address, 12 under
   `+918517942172@whatsapp.lead` and 2 under `158510264357112@lid`; lead 35
   carries an EMPTY email string and every one of his 10 rows is under
   `111948809162873@lid`, so this screen could not see him at all and said so as
   though that were a property of the lead rather than of the join. The backend
   already fixed this class of bug once — see the D1 IDENTITY note in
   phase_6_12_hour_silence_detector.json, where the same single-key lookup made
   an hourly job run green with zero output. Matching now goes through
   `lib/identity.js`, which applies the same last-nine-digit rule the n8n
   `Resolve Lead Identity` node used when it wrote those keys, and the drawer
   this table opens uses the same module against the same rule. One
   implementation, two access modes: this screen matches rows it has already
   read on `normalizeKey().canonical`, the drawer issues `personQuery()`.

   Naming a lead on screen, which is a separate problem from matching one. A
   lead's phone number sits under the name in every place a lead is named — the
   table, the alert strip, the confirm dialog — because "call them" is the action
   almost every alert here resolves to. Where there is no
   number the cell says so with an em dash. A `…@lid` WhatsApp handle is never
   printed as if it were a person's name (see the 24 Aug addendum); leads are not
   supposed to carry one, but the router has written stranger things into `name`
   and a handle rendered as a name is exactly the fault that addendum is about.

   1 Sep 2026, read from the database rather than remembered: three leads on
   file — 34 Siva Thangavelu (DISQUALIFIED), 35 Effco Contracting llc
   (DISQUALIFIED), 38 Ali (WARM).

   Two consequences, both of which are the reason this file changed today.

   First: n=3 is not a population. Nothing on this screen divides one row by
   another, and the counts that could be mistaken for a distribution — the
   status segments across the top of the table — carry a sentence saying they
   are the whole table rather than a sample of it. There is no funnel here, no
   conversion rate and no trend, because three rows cannot support one.

   Second, and this is a correction rather than an addition. Until today this
   file asserted in three places that `response_time_minutes` was null on every
   lead and that the 5-minute rule therefore had nothing measuring it. That was
   never true. The column held 0 on every lead: a BEFORE INSERT trigger on
   `leads` measured a reply that predated the lead row — the WhatsApp bot answers
   the conversation and only then does the router mint the lead — and
   `greatest(0, …)` rendered that negative interval as instant service. Three
   leads therefore read "answered in 0 minutes" while this screen printed a
   paragraph about nobody measuring anything, and both were wrong.

   That trigger has been deleted. The sole writer is now
   `trg_comm_logs_first_response`, AFTER INSERT on `communication_logs`, which
   resolves the row to a lead through `nexus_lead_for_comm_key` (integer-returning
   as of 1 Sep 2026 — the `RETURNS uuid` defect the 31 Aug audit filed under L2 is
   gone) and stamps `round(seconds / 60)` between the lead's `created_at` and the
   first reply it can attribute to it. The three live rows were repaired and on
   1 Sep 2026 read: lead 34 → 1, lead 38 → 4, lead 35 → NULL.

   What a NULL means, stated no more strongly than the function supports. Read
   out of `nexus_mark_first_response` on 1 Sep 2026: it counts only an OUTBOUND
   whatsapp / email / sms row that is not a `[system]` or `[SILENCE-` message; it
   writes once, and only while the column is still null; and a reply older than
   the lead row is admitted as 0 only when it is under 90 seconds older AND no
   inbound message was already on file — a clock-skew allowance between n8n
   (Asia/Dubai) and Postgres, not a floor under a real wait.

   So NULL does NOT mean "nobody has answered this customer", and lead 35 is the
   live proof: its one outbound message was logged at 06:40:38 on 26 Aug, its lead
   row was minted 74 seconds later at 06:41:52, and eight inbound messages were
   already on file — the conversation began before the lead did, so the trigger
   declined to call that a response time. The customer was answered; the wait was
   not measurable. NULL means no measured wait. It does not mean nobody measured,
   it is not a zero, and it must never render as a blank — a blank in a response
   column reads as "fast" to everyone who has ever looked at one. */
import { HOOK, ME, db, dbWrite, myStaffId, n8n } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { N8N_BASE } from '../lib/env.js';
import { aed, ago, dubaiStamp, esc, initials, mins, n0, num, pill, tone } from '../lib/format.js';
import { displayName, maskEmail, maskPhone, maskText } from '../lib/privacy.js';
/* audit_log.status is not ours to read literally. lib/health.js is the only
   module allowed to say what one means — it mirrors public.nexus_outcome_class()
   — and a row whose summary says a step "did not land" is a PARTIAL however it
   labelled itself. The workflow-history line in the Actions cell used to print
   the raw status beside the workflow name, which is a verdict, not a quote. */
import { outcomeOf, outcomeWords } from '../lib/health.js';
import { attributionCompleteness, attributionConfidence, ORIGIN_NOT_RECORDED, WRITER_COLUMN_LABEL, WRITER_COLUMN_NOTE }
  from '../lib/vocabulary.js';
import { AMBIGUITY, describeKey, expandIdentity, KEY_SHAPE, keyShape, normalizeKey } from '../lib/identity.js';
import { leadDrawer } from '../lib/lead-drawer.js';
import { manualLeadDialog } from '../lib/manual-lead-form.js';
import { readFlag, writeFlag } from '../lib/prefs.js';
import { SCREENS } from '../lib/nav.js';
import { BTN, emptyState, errorState, kpiTile, openStitchModal, sectionHeader, skeleton, statusChip, tempChip, trustFooter } from '../lib/stitch-ui.js';

const up  = s => String(s || '').toUpperCase();
const low = s => String(s || '').trim().toLowerCase();
const str = v => String(v == null ? '' : v).trim();
const ts  = v => { const t = new Date(v).getTime(); return Number.isNaN(t) ? 0 : t; };
/* Pinned to Asia/Dubai and labelled, like every other absolute time in this
   build: the workflows that wrote these rows all run on "timezone":
   "Asia/Dubai", and a manager reading the dashboard from London was being shown
   the showroom's day shifted four hours with nothing saying so. */
const when = v => dubaiStamp(v, '');
const plural = (n, one, many) => (Number(n) === 1 ? one : many);
/* null and 0 are different answers here and this must not collapse them. Since
   the trigger rewrite of 31 Aug the database keeps them apart on purpose: 0 is
   reserved for a genuine sub-30-second reply, and null means no reply the
   trigger could attribute to the lead has ever been logged. Before that rewrite
   `greatest(0, …)` wrote 0 for both, which is how three leads read "answered
   instantly" for a week. n0() returns null for null, '' and NaN and keeps a
   real 0. */
const respOf = l => n0(l.response_time_minutes);

/* Read ceilings. Each one is stated on screen when it is hit, because a count
   drawn from a truncated read is a smaller number, not a wrong-looking one, and
   nothing about the page would otherwise reveal it. */
const LEAD_LIMIT = 1000;
const ATTN_LIMIT = 200;
const COMM_LIMIT = 5000;
/* whatsapp_contacts is a directory, not a feed: one row per chat, 10 of them on
   1 Sep 2026. It is read whole because it is the only thing that can attach a
   `@lid` to a person — a LID contains no phone digits, so it can never be
   derived, only looked up. compliance.js reads it at the same ceiling. */
const CONTACT_LIMIT = 2000;
/* The audit read behind the per-row workflow history. Ceiling disclosed like
   every other one on this screen; 555 rows on 1 Sep 2026, so it is not near it. */
const AUDIT_LIMIT = 1000;
/* purchase_history, behind the VIP badge. Empty on 1 Sep 2026 — nobody in this
   table can be a returning customer yet — but until today this read carried no
   `limit` at all, which does not mean unbounded: PostgREST applies its own server
   ceiling and returns the truncated page with a 200. A repeat buyer whose row
   fell outside it would have rendered as a first-timer with nothing on screen
   saying the set was cut, which is the failure mode the rest of this file is
   written against. Stated when it is hit, like every other ceiling here. */
const PURCHASE_LIMIT = 5000;

/* The "never contacted" check is windowed so it is provably complete rather
   than merely likely: a message to a lead can only be logged at or after that
   lead was created, so reading *every* log line inside the window tells us the
   true contact state of every lead created inside the same window. Reading "the
   newest N log lines" instead would start accusing reps of ignoring leads they
   had answered, the moment the dealership got busy. Leads older than the window
   are therefore not judged by this check at all. */
const CONTACT_WINDOW_DAYS = 30;

/* No contact for this long is stale. Two weeks is the assumption in this
   number — it is not a company policy the database knows about — so the alert
   says "no contact in 14 days" rather than the word "stale" on its own. */
const STALE_DAYS = 14;

/* The router scores 1–100. Where its own Hot cut-off sits is a Make.com prompt,
   not a column we can read, so this threshold is ours and the alert states it
   in full ("scored 70 or higher") instead of claiming the router called them
   hot. */
const HIGH_SCORE = 70;

/* Statuses that mean the lead is finished. A won deal that nobody has touched
   in a month is not a neglected lead, and listing it as one trains people to
   ignore the strip. */
/* DISQUALIFIED was missing until 30 Aug 2026 and it is the one the bot writes:
   the WhatsApp BDC agent and the silence detector both set it and both read it
   back as final. Without it here, a lead the bot had written off stayed "open"
   for this screen forever — named in the "no contact in 14 days" alert every
   day for the rest of time, because nobody was ever going to contact it. */
const TERMINAL = new Set(['WON','LOST','CLOSED','CONVERTED','DELIVERED','DEAD','JUNK','SPAM','UNQUALIFIED','DISQUALIFIED','ARCHIVED']);

/* The 5-minute rule. It is a promise the dealership made, not a column
   constraint, and `leads.response_time_minutes` is the only place in the
   database where it is ever measured.

   `v_needs_attention` files `sla_breach` off the same column but NOT off the
   same predicate. Read from the live view definition on 1 Sep 2026 its arm is
   `response_time_minutes > 5 AND created_at > now() - 30 days`. So a lead older
   than thirty days that breached is counted by this screen and is invisible to
   the view, and every sentence here that prints a breach count says which of the
   two sets it is counting rather than implying they are one set. A lead carrying
   no figure at all is invisible to both, and that stays worth printing. */
const SLA_MINUTES = 5;
/* The view's own age window on the sla_breach arm, mirrored here only so the
   divergence above can be stated in words. Nothing on this screen filters by it. */
const SLA_VIEW_WINDOW_DAYS = 30;

/* At or below this, a set of rows is the whole book rather than a sample of it,
   and the captions say so. The arithmetic does not change — this screen counts
   rows and never divides one by another — but "1 HOT" beside "0 WARM" reads as
   a distribution unless something tells the reader it is one row. */
const THIN = 5;

/* Names shown per alert before it collapses into "+N more". The row itself
   filters the table to the full set, so this is a glance, not the list. */
const PREVIEW = 3;

/* A WhatsApp handle. A LID carries no phone digits at all, so it identifies
   nobody — it is never printed as a name. */
const HANDLE = /@(lid|c\.us|s\.whatsapp\.net|g\.us)$/i;

/* Whatever is in `leads.email`, is it somewhere a person can be WRITTEN TO?
   That is a different question from "which rows belong to this person", which is
   lib/identity.js's job and is answered by matching on every key including the
   ones nobody can post to. Live on 1 Sep 2026 lead 34's email column holds
   `+971547484167@whatsapp.lead` and lead 35's holds an empty string; neither is
   an address, and screens/campaigns.js already refuses to enrol either of them
   (its `isRealEmail`, which names lead 34 in its own comment). This screen fires
   the same drip webhook and did not, so one screen guarded the send and the other
   offered it. KEY_SHAPE.EMAIL is the same test expressed through the shared
   module rather than through a second private regex. */
const realEmail = l => keyShape(l && l.email) === KEY_SHAPE.EMAIL
  ? String(l.email).toLowerCase()
  : '';

/* `v_needs_attention.severity` is HOT | WARM | COLD, and TONE covers all three
   (plus an unknown value, which it gives its own 'unknown' tone rather than
   leaving unstyled or filing under COLD).
   So there is no severity map here: the checks below are labelled in the view's
   own vocabulary so that one strip does not speak two of them. */
const KIND_ICON = { lead_unassigned:'person_alert', sla_breach:'timer' };

/* ── The two workflows this screen may trigger ────────────────────────────────
   Both already exist in n8n and both verify the caller's Supabase JWT, which
   n8n() attaches. Nothing here writes to the database: escalation and the drip
   are n8n's job, and the row keeps whatever status and owner it had. The field
   vocabularies below are not free choices — a dashboard/workflow mismatch is
   what kept the drip at zero successful runs before, so `drip` posts exactly
   what the Campaigns screen posts, and `escalate` posts the identity fields the
   Lead Escalation agent resolves its session on (email → lead_email → name)
   plus `reason`, which is the field that routes the alert to
   #escalation-alerts rather than the hot-lead channel. */
const ACTIONS = {
  escalate: {
    key: 'escalate',
    hook: HOOK.escalation,
    label: 'Escalate',
    title: 'Escalate this lead',
    confirm: 'Escalate now',
    done: 'Escalated',
    blurb: 'Hands the lead to the Lead Escalation workflow, which posts a briefing into Slack for a human to pick up. '
         + 'Nothing on this screen changes — the lead keeps its current status and owner.',
    blocker: l => (!l.email && !l.name)
      ? 'This lead has neither a name nor an email address, so the alert would arrive unidentifiable.'
      : null,
    payload: l => ({
      email: l.email || null,
      lead_email: l.email || null,
      name: l.name || null,
      lead_name: l.name || null,
      phone: l.phone || null,
      vehicle_interest: l.vehicle_interest || null,
      /* A field name in the escalation webhook's payload, not a column: the
         workflow reads `lead_score`, and the leads table has no such column
         (selecting one is what blanked team.js in production). The value is
         ai_score, which is the score the table actually stores. */
      lead_score: n0(l.ai_score),
      status: l.status || null,
      reason: 'Escalated by hand from the Leads screen',
    }),
  },
  drip: {
    key: 'drip',
    hook: HOOK.warmDrip,
    label: 'Start drip',
    title: 'Enrol in the 7-day warm drip',
    confirm: 'Start the drip',
    done: 'Drip started',
    blurb: 'Day 1 welcome, day 3 follow-up, day 7 final offer — sent by NEXUS over the following week, not by this browser. '
         + 'Starting it twice enrols the lead twice.',
    blocker: l => realEmail(l)
      ? null
      : str(l.email)
        ? `The drip is addressed by email, and this lead's email column holds ${str(l.email)} — the key its messages are filed under, not an address. Enrolling it would aim an email at something nobody can deliver to.`
        : 'The drip is addressed by email and this lead has no email address on record.',
    payload: l => ({
      lead_email: realEmail(l),
      lead_name: l.name || '',
      vehicle_interest: l.vehicle_interest || '',
    }),
  },
  /* NX1005. A FAILED lead is not a dead end: nexus_my_lead_retry_scoring resets
     scoring_state to PENDING with scoring_attempts back at 0, and the hourly
     rescore workflow (dCRmzWHCz7bniIBr) picks it up from there. This is a
     database write via rpc/, not an n8n webhook -- `rpc` in place of `hook` is
     how the two action kinds below are told apart. */
  retryScoring: {
    key: 'retryScoring',
    rpc: 'nexus_my_lead_retry_scoring',
    label: 'Retry scoring',
    title: 'Retry AI scoring for this lead',
    confirm: 'Retry scoring',
    done: 'Queued for rescoring',
    blurb: 'Resets this lead to PENDING with a fresh attempt budget, so the next hourly rescore '
         + '(dCRmzWHCz7bniIBr) picks it up. Nothing is scored by this click -- it only asks the pipeline to look again.',
    blocker: l => up(l.scoring_state) === 'FAILED'
      ? null
      : `Only a FAILED lead can be retried this way. This lead's scoring_state is ${str(l.scoring_state) || 'PENDING'}.`,
    payload: l => ({ p_lead_id: l.id }),
    describeResult: res => {
      const r = Array.isArray(res) ? res[0] : res;
      return r && up(r.scoring_state) === 'PENDING'
        ? 'It is PENDING again with scoring_attempts reset to 0.'
        : 'The database accepted the request.';
    },
  },
};

const SORTS = {
  new:   'Newest first',
  old:   'Oldest first',
  score: 'Highest AI score',
  low:   'Lowest AI score',
};

/* A 2xx from the webhook is the only thing we actually know. Echo whatever the
   workflow said if it said anything; never dress up silence as a result. */
function replyNote(res) {
  const t = res && typeof res === 'object' ? (res.status || res.message || res.raw) : null;
  return typeof t === 'string' && t.trim()
    ? `The workflow replied: ${t.trim().slice(0, 160)}`
    : 'The workflow accepted the request.';
}

/* Resolve to [value, null] or [null, error] so one failed read cannot abort the
   others through Promise.all, and so every failure arrives as a fact the strip
   can print rather than as a rejection somebody has to catch again. */
const settle = p => p.then(v => [v, null], e => [null, e]);

/* How a lead is NAMED on screen, in one place, so the table, the strip and the
   dialog cannot drift apart on what a nameless lead looks like. Distinct from
   lib/identity.js, which decides which database rows are the same person. */
function leadName(l) {
  const n = str(l.name);
  if (!n) return '<span class="ds-t-warning">Unnamed lead</span>';
  /* A chat handle is not a name. Leads should never carry one, but the router
     has written worse into this column, and the whole point of the 24 Aug
     addendum is that a handle printed as a name misleads whoever reads it. */
  if (HANDLE.test(n)) {
    return '<span class="ds-t-warning">Unnamed lead</span> '
      + `<span class="chip mono" title="This is a WhatsApp chat handle stored in the name column, not a person's name. A LID contains no phone digits and identifies nobody.">${esc(n)}</span>`;
  }
  return esc(displayName(n, l.id));
}
const phoneText = l => str(l.phone)
  ? `<span class="mono">${esc(maskPhone(str(l.phone)))}</span>`
  : '<span class="ds-t-tertiary" title="No phone number on this lead">—</span>';
/* Name and number on one line, for the places that have no second line. */
const nameAndPhone = l => `${leadName(l)} <span class="ds-t-tertiary">·</span> ${phoneText(l)}`;

/* ── Stitch class vocabulary for this screen ─────────────────────────────────
   Every class string is complete and literal (scripts/stitch-classes.mjs fails
   the build on one assembled at runtime). They are copied from the leads-*
   exports in design/stitch/; the shared pieces come from lib/stitch-ui.js. */
const TOOL_BTN = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface font-body-md text-body-sm font-medium transition-colors';
const LAYOUT_BTN = {
  on:  'flex items-center gap-1.5 px-3 py-1 rounded bg-surface-container-lowest text-primary font-body-md text-body-sm font-semibold shadow-sm',
  off: 'flex items-center gap-1.5 px-3 py-1 rounded text-outline hover:text-on-surface font-body-md text-body-sm font-medium transition-colors',
};
const STAGE_BTN = 'px-1.5 py-0.5 rounded bg-surface-container text-on-surface hover:bg-surface-container-highest transition-colors';
const STAGE_BTN_ON = 'px-1.5 py-0.5 rounded bg-primary-fixed text-primary font-bold';
const FIELD = 'h-9 pr-4 rounded-lg bg-surface-container-low text-body-md text-on-surface placeholder:text-outline focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary';
const FILTER_PILL = 'flex items-center gap-1.5 px-2.5 h-9 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface font-body-md text-body-sm font-medium whitespace-nowrap';
const PILL_SELECT = 'bg-transparent font-semibold text-primary focus:outline-none cursor-pointer max-w-[130px]';
const ROW_BTN = 'w-8 h-8 inline-flex items-center justify-center rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container text-primary transition-colors disabled:text-outline-variant disabled:bg-surface-container-low disabled:cursor-not-allowed';
const ACT_ICON = { escalate: 'campaign', drip: 'mark_email_unread', retryScoring: 'refresh' };
const VIP_TAG = 'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-label-numeric-sm font-bold bg-surface-container-highest text-primary';
const PREVIEW_CHIP = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container text-on-surface font-body-sm text-[12px] whitespace-nowrap hover:bg-surface-container-high transition-colors';
const CHECK = 'rounded text-primary focus:ring-primary w-4 h-4 cursor-pointer';
const TH_L = 'px-3 py-2 font-table-header text-table-header uppercase tracking-wider text-left';
const TH_R = 'px-3 py-2 font-table-header text-table-header uppercase tracking-wider text-right';
const TD_L = 'px-3 py-2 align-top text-left';
const TD_R = 'px-3 py-2 align-top text-right';
const ROW = {
  off: 'hover:bg-surface-container-low transition-colors cursor-pointer',
  on:  'bg-secondary-fixed/30 hover:bg-secondary-fixed/50 transition-colors cursor-pointer',
};
const ATTN_ROW = {
  open:  'flex items-start gap-3 px-space-md py-3 hover:bg-surface-container-low cursor-pointer transition-colors',
  still: 'flex items-start gap-3 px-space-md py-3',
};
const ALERT_CARD = 'bg-surface-container-lowest rounded-xl border border-outline-variant/40 shadow-sm p-space-md flex flex-col gap-2 cursor-pointer hover:border-primary transition-colors';
const ALERT_CARD_ON = 'bg-surface-container-lowest rounded-xl border-2 border-primary shadow-sm p-space-md flex flex-col gap-2 cursor-pointer transition-colors';
const SEV_TEXT = { HOT: 'text-red-700', WARM: 'text-amber-700', COLD: 'text-sky-700' };
const SCORE_BAR = {
  hot: 'bg-red-600', warm: 'bg-amber-500', cold: 'bg-sky-600', ok: 'bg-emerald-600', won: 'bg-emerald-600',
  open: 'bg-violet-600', dead: 'bg-zinc-400', unknown: 'bg-zinc-400',
};
const NOTE = {
  info: 'flex items-start gap-2.5 p-3 rounded-lg border border-blue-200 bg-blue-50/60 text-blue-950 font-body-sm text-body-sm',
  warm: 'flex items-start gap-2.5 p-3 rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm',
  hot:  'flex items-start gap-2.5 p-3 rounded-lg border border-red-200 bg-red-50/60 text-red-950 font-body-sm text-body-sm',
};
/* A Stitch note band, in place of the legacy `.banner`. `html` is trusted
   markup the caller escaped. */
const note = (t, icon, html) =>
  `<div class="${NOTE[t] || NOTE.info}"><span class="material-symbols-outlined text-[18px] shrink-0">${esc(icon)}</span><div class="min-w-0 flex-1">${html}</div></div>`;
/* Lead status and severity words. HOT / WARM / COLD / WON / LOST / OPEN take
   the Stitch temperature chip; every other word keeps lib/format.js pill(),
   whose provenance note (`verbatim`) is the reason it exists. */
const TEMP_WORDS = new Set(['HOT', 'WARM', 'COLD', 'WON', 'LOST', 'OPEN']);
const statusTag = (label, verbatim = true) => (TEMP_WORDS.has(up(label))
  ? tempChip(label)
  : pill(label, undefined, { verbatim }));
/* The signed-in person, for the trust footer. A staff name, never a customer's. */
const actorName = () => String((ME && (ME.name || ME.email)) || 'Signed-in user');

SCREENS.leads = async host => {
  /* Stitch redesign, 7 Oct 2026 — design/stitch/leads-saved-views-board-
     inspector-drawer--088011.html is the layout; the alert cards come from
     leads-pipeline-audit-drawer--0e162f and the KPI row from
     leads-pipeline-inspector--930cc7. `nx-stitch` turns on the scoped reset the
     Stitch classes were designed against. It sits on a wrapper this screen
     appends and never on `#screen`, for the reason the `.ds-screen` wrapper
     always did: lib/nav.js empties `#screen` between renders without touching
     its classes, so a class set there would follow the operator onto a screen
     nobody migrated. Every read, refusal and caveat below is unchanged; only the
     markup moved. */
  const root = el('div', 'nx-stitch flex flex-col gap-space-md');
  host.appendChild(root);

  const headHost = el('div'); root.appendChild(headHost);
  headHost.innerHTML = sectionHeader({ eyebrow: 'Work / Leads & intake', title: 'Leads Desk',
    sub: 'Every enquiry on file, who owns it, and what is waiting on somebody.' });
  const kpiHost = el('div', 'grid grid-cols-2 xl:grid-cols-4 gap-space-md'); root.appendChild(kpiHost);
  const alertCard = el('section', 'flex flex-col gap-space-sm'); root.appendChild(alertCard);
  alertCard.innerHTML = skeleton({ rows: 2 });
  const card = el('div', 'flex flex-col gap-space-sm'); root.appendChild(card);
  card.innerHTML = skeleton({ rows: 4 });
  const footHost = el('div'); root.appendChild(footHost);
  const readAt = new Date();


  /* The strip's three extra reads are started before the leads read is awaited,
     so the whole screen costs one round of requests rather than one per alert. */
  const since = new Date(Date.now() - CONTACT_WINDOW_DAYS * 86400000).toISOString();
  const attnRead = db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen'
    + `&screen=eq.leads&limit=${ATTN_LIMIT}`);
  const commRead = db('communication_logs?select=lead_email,direction,created_at'
    + `&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=${COMM_LIMIT}`);
  /* The `@lid` bridge. Without this read a lead's LID-keyed messages cannot be
     attached to it at all, and the two contact checks below go back to accusing
     reps of ignoring customers they answered — which is exactly the bug this
     pass is closing. It is therefore a precondition of those checks, not a
     nice-to-have, and its failure withholds them. */
  const contactsRead = db('whatsapp_contacts?select=chat_id,phone,push_name,lead_email'
    + `&limit=${CONTACT_LIMIT}`);
  /* Where each lead actually came from. This is a SEPARATE read from `leads`
     on purpose: leads.source is the workflow that WROTE the row, and for every
     real lead this dealership has it reads `nexus-master-router`. The origin
     lives in the lead-ingestion layer, on columns the dealer plane is denied by
     column grant, and nexus_lead_attribution() is the accessor that projects it.
     A lead with no row here has no recorded arrival — which is a different fact
     from an unknown platform, and the cell below keeps them apart. */
  const attribRead = db('rpc/nexus_lead_attribution');
  /* Marked handled now: all three are awaited later, and an early rejection
     would otherwise surface in the console instead of in the strip that
     reports it. */
  attnRead.catch(() => {});
  commRead.catch(() => {});
  contactsRead.catch(() => {});
  attribRead.catch(() => {});

  let all = [];
  let leadsErr = null;
  try {
    // `users(id,name)` and not `users:assigned_to_id(...)` — the colon form is an
    // alias, not an FK hint, and PostgREST would look for a table called
    // `assigned_to_id`. leads has exactly one FK to users, so this is unambiguous.
    all = await db(`leads?select=*,users(id,name)&order=created_at.desc&limit=${LEAD_LIMIT}`);
  } catch (e) { leadsErr = e; }

  const [attn, attnErr] = await settle(attnRead);
  const [comms, commsErr] = await settle(commRead);
  const [contacts, contactsErr] = await settle(contactsRead);
  const [attribRows, attribErr] = await settle(attribRead);

  /* One attribution row per lead, newest arrival wins. A lead can have more than
     one lead_event — a re-enquiry is a second arrival, not a second customer —
     and the most recent one is the one a salesperson is working from. */
  const attribByLead = new Map();
  for (const a of (attribRows || [])) {
    if (a.lead_id == null) continue;                 /* an arrival that never became a lead */
    const prev = attribByLead.get(a.lead_id);
    if (!prev || String(a.received_at || '') > String(prev.received_at || '')) attribByLead.set(a.lead_id, a);
  }

  /* ── Identity ────────────────────────────────────────────────────────────
     One expansion per lead, seeded from the row and bridged through
     whatsapp_contacts, done once here so the strip, the table and the drawer
     cannot drift apart on who a lead is. `all` goes in as the candidate pool so
     that two people whose numbers end in the same nine digits are REPORTED as a
     collision rather than silently merged into one customer.

     `canon` is the comparison form: normalizeKey() collapses `@c.us`,
     `@s.whatsapp.net`, `@whatsapp.lead` and a bare number onto `phone:<last 9>`
     while keeping a LID as `lid:<digits>` and an email as `email:<address>`, so
     a LID whose digits happen to end like somebody's phone number can never
     compare equal to it. */
  const identOf = new Map();
  const canonOf = new Map();
  for (const l of all) {
    const idn = expandIdentity(
      { leadId: l.id, email: l.email, phone: l.phone, name: l.name },
      { links: contacts || [], leads: all });
    identOf.set(String(l.id), idn);
    canonOf.set(String(l.id), new Set(idn.keys.map(k => normalizeKey(k).canonical).filter(Boolean)));
  }
  const identKeys = l => canonOf.get(String(l.id)) || new Set();
  /* A lead nothing can be matched on: no email, no phone, no chat id. It is
     neither contacted nor uncontacted as far as this screen can prove, and it is
     counted in the notes rather than folded into an alert. */
  const matchable = l => identKeys(l).size > 0;
  const collided = all.filter(l =>
    (identOf.get(String(l.id))?.ambiguityCodes || []).includes(AMBIGUITY.PHONE_SUFFIX_COLLISION));

  const commCanon = c => normalizeKey(c.lead_email).canonical;

  const byId = new Map(all.map(l => [String(l.id), l]));
  /* The view keys `lead_unassigned` and `sla_breach` on `l.id::text`, so byId is
     the hit in practice; the canonical index is the fallback for a ref that
     arrives as some address instead, and it uses the same rule as everything
     else on this screen rather than a second private one. */
  const byCanon = new Map();
  for (const l of all) for (const k of identKeys(l)) if (!byCanon.has(k)) byCanon.set(k, l);

  /* ── The view's own rows ─────────────────────────────────────────────────
     `ref` is whatever the view chose to key the item on. Match it to a loaded
     lead by id and then by any key that identifies one — not by email, which is
     what this did while `leads.email` was assumed to hold an address. If neither
     hits, the row is still shown — it is a real item — but it is not made
     clickable, and it says why, because a click that silently does nothing is
     worse than a row that admits it cannot be opened from here. */
  const viewItems = (attn || []).slice().sort((a, b) => ts(b.at) - ts(a.at));
  const matchRef = ref => byId.get(str(ref))
    || byCanon.get(normalizeKey(ref).canonical)
    || null;

  /* Refs the view already reported, so a check below does not repeat an item
     the operator has just read three lines higher up. Kept per kind: only
     `lead_unassigned` asks the same question as one of our checks. */
  const unassignedIds = new Set(viewItems.filter(i => i.kind === 'lead_unassigned')
    .map(i => str(i.ref)).filter(Boolean));
  const unassignedCanon = new Set(viewItems.filter(i => i.kind === 'lead_unassigned')
    .map(i => normalizeKey(i.ref).canonical).filter(Boolean));
  const listedUnassigned = l => unassignedIds.has(String(l.id))
    || [...identKeys(l)].some(k => unassignedCanon.has(k));

  /* ── The four checks ────────────────────────────────────────────────────── */
  const nowMs = Date.now();
  const windowStart = nowMs - CONTACT_WINDOW_DAYS * 86400000;
  const staleCut = nowMs - STALE_DAYS * 86400000;
  const leadsCapped = all.length >= LEAD_LIMIT;
  const commsCapped = !!comms && comms.length >= COMM_LIMIT;
  const contactsCapped = !!contacts && contacts.length >= CONTACT_LIMIT;

  /* Ownership, in one place. `leads` carries BOTH `assigned_to_id` and a plain
     `assigned_to` name, and this screen used to read only the first two of the
     three while the drawer read all three — so a row owned through `assigned_to`
     alone rendered "Unassigned" in the table and showed the rep's name in the
     drawer opened from that very row. lib/lead-drawer.js has carried a comment
     about that since it was split out. One rule now, used by the alert, the
     dropdown, the filter and the cell alike. */
  const repOf = l => str(l.users?.name) || str(l.assigned_to);
  const owned = l => !!(l.assigned_to_id || repOf(l));

  const hot = all.filter(l => up(l.status) === 'HOT');
  const hotNoRepAll = hot.filter(l => !owned(l));
  const hotNoRep = hotNoRepAll.filter(l => !listedUnassigned(l));
  const hotNoRepDup = hotNoRepAll.length - hotNoRep.length;

  const inWindow = all.filter(l => ts(l.created_at) >= windowStart);
  /* A lead nothing identifies — no email, no phone, no chat id — cannot be
     matched to communication_logs in either direction, so it is neither
     contacted nor uncontacted as far as this screen can prove: it is excluded
     here and counted in the notes, not silently folded into the alert. This
     used to read `low(l.email)`, which threw away lead 35, whose email column
     holds an empty string and whose ten messages are all filed under a LID. */
  const windowMatchable = inWindow.filter(matchable);
  const loggedAny = new Set((comms || []).map(commCanon).filter(Boolean));
  const loggedOut = new Set((comms || []).filter(c => low(c.direction) === 'outbound')
    .map(commCanon).filter(Boolean));
  const anyLogged = l => [...identKeys(l)].some(k => loggedAny.has(k));
  const anyOutbound = l => [...identKeys(l)].some(k => loggedOut.has(k));
  /* Withheld when any read the match depends on failed or hit its ceiling: with
     a partial log, or without the whatsapp_contacts bridge that attaches a
     `@lid` to a person, "never contacted" would name leads that were in fact
     answered. That is not a smaller number, it is a false accusation about a
     named customer, so it is not shown at all. */
  const contactUsable = !!comms && !commsErr && !commsCapped
    && !!contacts && !contactsErr && !contactsCapped;
  const neverContacted = contactUsable
    ? windowMatchable.filter(l => !anyLogged(l)).sort((a, b) => ts(a.created_at) - ts(b.created_at))
    : [];
  const inboundOnly = contactUsable
    ? windowMatchable.filter(l => anyLogged(l) && !anyOutbound(l))
    : [];

  /* What is measuring the 5-minute rule, counted rather than averaged.
     `measured` is the denominator of every sentence this screen writes about
     reply speed, and it is printed in all of them. No mean is taken here at any
     size: an average over a handful of measurements is not a performance figure,
     and over none of them it is not a figure at all.

     Read from the database on 1 Sep 2026: `measured` is 2 of 3 — leads 34 at
     1 minute and 38 at 4 — and `breached` is empty. Lead 35 carries no figure
     because nobody has replied to it since its row was created, which is a
     statement about the customer rather than about the instrument. */
  const measured = all.filter(l => respOf(l) != null);
  const breached = measured.filter(l => Number(respOf(l)) > SLA_MINUTES);
  /* The subset the view would also file as sla_breach. Counting both is the only
     way to say "N breached, of which M are recent enough for v_needs_attention
     to raise them" without implying the two sets are one. */
  const slaViewCut = nowMs - SLA_VIEW_WINDOW_DAYS * 86400000;
  const breachedInViewWindow = breached.filter(l => ts(l.created_at) > slaViewCut);

  const scored = all.filter(l => n0(l.ai_score) != null);
  const hotButNew = scored.filter(l => Number(l.ai_score) >= HIGH_SCORE
    && (up(l.status) === 'NEW' || !str(l.status)))
    .sort((a, b) => Number(b.ai_score) - Number(a.ai_score));

  /* Staleness, measured from something that exists.

     `leads` has no updated_at column at all — probed live on 24 Aug — so this
     table carries no row-modified timestamp, and an earlier draft of this check
     read `l.updated_at` and got `undefined` on every single row. That does not
     throw and it does not look wrong: it quietly collapses into "created more
     than 14 days ago", i.e. an age, while the caption still talks about
     staleness. Age is not staleness. A lead created three months ago and
     phoned yesterday is not neglected.

     So it is measured from the events themselves: the newest communication_logs
     row filed under ANY key that identifies the lead, and `escalated_at` on the
     row. Until 1 Sep this read the lead's email alone, which is how a customer
     messaged yesterday under a `@lid` could be named in a "no contact in 14
     days" alert. That is a better signal than a row-modified stamp would have
     been — it is a last *contact* time, not a last-edited time — at the cost of
     one honest complication. The
     log read covers a 30-day window, so a lead with nothing logged inside it is
     one of two different things that look identical: never contacted (provable
     when the lead is younger than the window), or last contacted before the
     window opened, in which case the date is unknown and only "at least 30 days
     ago" is known. Those two are counted apart and named, because an unknown
     last contact is not an old one.

     Leads that nothing identifies cannot be matched to communication_logs in
     either direction, so they are excluded here and counted in the notes rather
     than declared quiet. */
  const lastLogged = new Map();
  for (const c of (comms || [])) {
    const k = commCanon(c); if (!k) continue;
    const t = ts(c.created_at);
    if (t > (lastLogged.get(k) || 0)) lastLogged.set(k, t);
  }
  const staleTouch = l => Math.max(
    ...[...identKeys(l)].map(k => lastLogged.get(k) || 0),
    ts(l.escalated_at), 0);
  const openLeads = all.filter(l => !TERMINAL.has(up(l.status)));
  const openMatchable = openLeads.filter(matchable);
  const openUnmatchable = openLeads.length - openMatchable.length;
  /* Counted while filtering, so the breakdown is the same pass as the list and
     the two cannot disagree. */
  const staleParts = { measured: 0, never: 0, beforeWindow: 0 };
  const staleLeads = (!contactUsable ? [] : openMatchable.filter(l => {
    const touch = staleTouch(l);
    if (touch) { if (touch >= staleCut) return false; staleParts.measured++; return true; }
    /* Nothing logged and never escalated. A lead cannot have been contacted
       before it existed, so one younger than the threshold is new, not
       neglected — that is the trap the old created_at fallback fell into. */
    const born = ts(l.created_at);
    if (!born || born >= staleCut) return false;
    if (born >= windowStart) staleParts.never++; else staleParts.beforeWindow++;
    return true;
  })).sort((a, b) => (staleTouch(a) || ts(a.created_at)) - (staleTouch(b) || ts(b.created_at)));
  const oldestMeasured = staleLeads.map(staleTouch).filter(Boolean).sort((a, b) => a - b)[0] || null;

  const checks = [
    {
      key: 'unassigned',
      sev: 'HOT',
      icon: 'person_alert',
      title: `${num(hotNoRep.length)} HOT ${plural(hotNoRep.length, 'lead has', 'leads have')} no assigned rep`,
      detail: `${num(hotNoRep.length)} of the ${num(hot.length)} HOT ${plural(hot.length, 'lead', 'leads')} read here `
        + `${plural(hotNoRep.length, 'carries', 'carry')} none of the three things that could name an owner — no assigned_to_id, no assigned_to name, and no rep on the joined users row. `
        + 'Nobody owns the follow-up.'
        + (hotNoRepDup ? ` ${num(hotNoRepDup)} further unassigned HOT ${plural(hotNoRepDup, 'lead is', 'leads are')} already listed above by the attention list and ${plural(hotNoRepDup, 'is', 'are')} not counted twice here.` : ''),
      leads: hotNoRep,
    },
    {
      key: 'nocontact',
      sev: 'HOT',
      icon: 'phone_missed',
      title: `${num(neverContacted.length)} ${plural(neverContacted.length, 'lead has', 'leads have')} no logged contact attempt`,
      detail: `Of the ${num(windowMatchable.length)} ${plural(windowMatchable.length, 'lead', 'leads')} created in the last `
        + `${CONTACT_WINDOW_DAYS} days that anything identifies, ${num(neverContacted.length)} ${plural(neverContacted.length, 'has', 'have')} `
        + 'no row in the message history under any key they are filed under — not their email, not their WhatsApp chat id, not the synthetic address the router mints — inbound or outbound. '
        + `The oldest arrived ${ago(neverContacted[0]?.created_at)}. `
        + `Leads created before that ${CONTACT_WINDOW_DAYS}-day window are not judged by this check, because the log read covers the window only.`,
      leads: neverContacted,
      skip: !contactUsable,
    },
    {
      key: 'untriaged',
      sev: 'WARM',
      icon: 'rocket_launch',
      title: `${num(hotButNew.length)} high-scoring ${plural(hotButNew.length, 'lead is', 'leads are')} still NEW`,
      detail: `${num(hotButNew.length)} of the ${num(scored.length)} scored ${plural(scored.length, 'lead', 'leads')} `
        + `${plural(hotButNew.length, 'was', 'were')} scored ${HIGH_SCORE} or higher by the router, but the status on the row is still NEW — `
        + 'the score arrived and nobody triaged it.'
        /* Said only when there are unscored leads: this check can say nothing
           at all about them, and silence about that is what makes the count
           look like it covered the whole table. */
        + (all.length - scored.length
          ? ` ${num(all.length - scored.length)} ${plural(all.length - scored.length, 'lead', 'leads')} on this screen ${plural(all.length - scored.length, 'has', 'have')} no score at all and cannot be checked this way.`
          : ''),
      leads: hotButNew,
    },
    {
      key: 'stale',
      sev: 'WARM',
      icon: 'hourglass_empty',
      title: `${num(staleLeads.length)} open ${plural(staleLeads.length, 'lead has', 'leads have')} had no contact in ${STALE_DAYS} days`,
      detail: `${num(staleLeads.length)} of the ${num(openMatchable.length)} open ${plural(openMatchable.length, 'lead', 'leads')} that anything identifies `
        + `${plural(staleLeads.length, 'has', 'have')} had no logged message and no escalation for ${STALE_DAYS} days `
        + `(${[...TERMINAL].slice(0, 4).join(', ')}… count as finished and are not open). `
        + 'Your leads has no updated_at column at all, so this is measured from real events — the newest the message history row filed under any key '
        + 'that identifies the lead, and escalated_at on the row — and never from a row-modified timestamp, which does not exist here. '
        + (staleParts.measured
          ? `${num(staleParts.measured)} of them ${plural(staleParts.measured, 'has', 'have')} a real last-contact date; the ${plural(staleParts.measured, 'only one', 'oldest')} was last touched ${ago(oldestMeasured)}. `
          : '')
        + (staleParts.never
          ? `${num(staleParts.never)} ${plural(staleParts.never, 'has', 'have')} never been contacted at all — ${plural(staleParts.never, 'it was', 'they were')} created inside the ${CONTACT_WINDOW_DAYS}-day log window, so nothing was missed by reading only that window. `
          : '')
        + (staleParts.beforeWindow
          ? `${num(staleParts.beforeWindow)} ${plural(staleParts.beforeWindow, 'was', 'were')} created before that window with nothing logged inside it: ${plural(staleParts.beforeWindow, 'its', 'their')} last contact is unknown rather than old — all that can be said is that there has been none for at least ${CONTACT_WINDOW_DAYS} days.`
          : ''),
      leads: staleLeads,
      skip: !contactUsable,
    },
  ].filter(c => !c.skip && c.leads.length);

  const checkByKey = new Map(checks.map(c => [c.key, c]));
  checks.forEach(c => { c.ids = new Set(c.leads.map(l => String(l.id))); });

  /* Everything the strip cannot claim, said out loud. An operator reading a
     count needs to know which reads it rests on; a count quietly computed from
     a failed or truncated read is the failure mode this whole file is written
     against. */
  const stripNotes = [
    leadsErr
      ? `The leads read failed (${leadsErr.message}), so none of this screen's own checks could run. Only what the attention list returned is shown above.`
      : '',
    attnErr
      ? `The attention list could not be read (${attnErr.message}), so anything the database would have listed for this screen is missing from this strip. The checks below still ran.`
      : '',
    leadsCapped
      ? `The leads read stopped at ${num(LEAD_LIMIT)} rows, so every count below covers those ${num(LEAD_LIMIT)} leads and not necessarily the whole table.`
      : '',
    commsErr
      ? `The message history could not be read (${commsErr.message}), so neither the "no logged contact attempt" check nor the staleness check ran. Your leads has no updated_at column, so those logs are the only record of a lead being touched — both checks are missing from this strip rather than shown as zero.`
      : '',
    commsCapped
      ? `The contact-log read hit its ${num(COMM_LIMIT)}-row ceiling, so a message may be missing from it. The contact and staleness checks are withheld rather than accusing a rep who did in fact reply.`
      : '',
    contactsErr
      ? `The saved contact details could not be read (${contactsErr.message}), so a lead's @lid messages cannot be attached to the lead — a LID carries no phone digits and can only be bridged through that table. The contact and staleness checks are withheld rather than run on a partial identity, because a lead whose whole conversation is LID-keyed would otherwise be named as never contacted.`
      : '',
    contactsCapped
      ? `The saved contact details read hit its ${num(CONTACT_LIMIT)}-row ceiling, so some chat-to-lead bridges are missing and the contact and staleness checks are withheld for the same reason.`
      : '',
    collided.length
      ? `${num(collided.length)} ${plural(collided.length, 'lead shares', 'leads share')} the last nine digits of a phone number with another lead. That is the rule the workflows matched on when they wrote these log rows, so their messages cannot be told apart here; ${plural(collided.length, 'that lead was', 'those leads were')} matched on exact keys only rather than merged with somebody else.`
      : '',
    contactUsable && openUnmatchable
      ? `${num(openUnmatchable)} open ${plural(openUnmatchable, 'lead', 'leads')} ${plural(openUnmatchable, 'carries', 'carry')} nothing that identifies ${plural(openUnmatchable, 'it', 'them')} — no email, no phone number, no WhatsApp address. There is no key to look ${plural(openUnmatchable, 'it', 'them')} up in the message history by, so ${plural(openUnmatchable, 'it sits', 'they sit')} outside both the contact and the staleness check and ${plural(openUnmatchable, 'is', 'are')} in no count above.`
      : '',
    contactUsable && inboundOnly.length
      ? `${num(inboundOnly.length)} further ${plural(inboundOnly.length, 'lead', 'leads')} in that window ${plural(inboundOnly.length, 'has', 'have')} inbound messages logged but no outbound one — the customer wrote and nothing went back. They are not counted above, which counts only leads with no log line at all.`
      : '',
    checks.length > 1
      ? 'A lead can satisfy more than one check, so these counts overlap and do not add up to a total.'
      : '',
    /* The absence an owner should be told about rather than shown as a blank
       cell. It is stated here and nowhere else on this screen at the table
       level, so there is one sentence about it and not two that can drift.

       Corrected 1 Sep 2026. This sentence used to say the router would have to
       write the figure. The router has never written it. The sole writer is
       `trg_comm_logs_first_response`, an AFTER INSERT trigger on
       communication_logs, and the reason every lead read the same value was a
       second, BEFORE INSERT trigger on `leads` that has since been deleted. An
       owner who read the old sentence went and edited a Make.com prompt over a
       Postgres trigger. */
    !leadsErr && all.length && !measured.length
      ? `response_time_minutes is null on ${plural(all.length, 'the only lead on file', `all ${num(all.length)} leads on file`)}. `
        + `That column is the only record this database keeps of how long a lead waited for its first answer, so the ${SLA_MINUTES}-minute rule is currently being measured by nothing here: `
        + `The attention list can raise an sla_breach only against a lead that carries a figure, and no average response time anywhere in this dashboard has an input. `
        + 'A null means the column was never stamped: nothing has gone back since the lead row was created, or the only reply on file predates the lead row, which the trigger declines to measure. Either way there is no measured wait. It is measured by NEXUS at the moment a reply is recorded and by nothing else — not by the router, and nothing in this browser can supply it.'
      : '',
    !leadsErr && measured.length && measured.length < all.length
      ? `${num(all.length - measured.length)} of the ${num(all.length)} ${plural(all.length, 'lead', 'leads')} read here ${plural(all.length - measured.length, 'carries', 'carry')} no response_time_minutes. `
        + `Since 31 Aug that is a statement about the record, not about the instrument: the trigger on the message history stamps the column for the first reply it can match to the lead, and it has not stamped ${plural(all.length - measured.length, 'this one', 'these')}. Usually that means nothing has gone back since the lead row was created; it can also mean the only reply on file predates the lead row, which the trigger will not measure — that is why lead 35 carries no figure despite having been answered. `
        + `The ${SLA_MINUTES}-minute rule cannot be applied to ${plural(all.length - measured.length, 'it', 'them')} at all — there is no measured wait, which is not the same as a fast one.`
      : '',
    !leadsErr && measured.length
      ? `${num(breached.length)} of the ${num(measured.length)} ${plural(measured.length, 'lead', 'leads')} that do carry a first-reply time ${plural(breached.length, 'is', 'are')} over ${SLA_MINUTES} minutes.`
        /* Said only when the two sets differ. v_needs_attention's sla_breach arm
           also requires created_at inside 30 days, so a count printed here
           without that caveat would look like a promise the strip above had
           broken. */
        + (breached.length !== breachedInViewWindow.length
          ? ` The attention list will raise ${num(breachedInViewWindow.length)} of ${plural(breached.length, 'it', 'them')}: its sla_breach arm also requires the lead to have been created in the last ${SLA_VIEW_WINDOW_DAYS} days, so ${num(breached.length - breachedInViewWindow.length)} older ${plural(breached.length - breachedInViewWindow.length, 'breach is', 'breaches are')} counted here and will never appear in the strip above.`
          : '')
        + (measured.length <= THIN
          ? ` ${num(measured.length)} ${plural(measured.length, 'measurement is', 'measurements are')} not a performance figure, so no average is taken from ${plural(measured.length, 'it', 'them')} on this screen.`
          : '')
      : '',
  ].filter(Boolean);


  const previewOf = ls => {
    const shown = ls.slice(0, PREVIEW).map(l =>
      `<button type="button" class="${PREVIEW_CHIP}" data-lead="${esc(l.id)}"
        title="Open this lead">${nameAndPhone(l)}</button>`).join(' ');
    const rest = ls.length - Math.min(ls.length, PREVIEW);
    return `${shown}${rest ? ` <span class="font-label-numeric-sm text-label-numeric-sm text-outline">+${num(rest)} more</span>` : ''}`;
  };

  /* The view's own rows: one line each, in the view's own terms. */
  /* The view's own rows, as cards in the same row as the checks below (the
     audit-drawer export's alert cards), in the view's own terms. */
  const viewRows = viewItems.map(it => {
    const lead = matchRef(it.ref);
    const icon = KIND_ICON[it.kind] || 'warning';
    const sev = str(it.severity);
    const openable = !!lead;
    return `<div class="${ALERT_CARD}"${openable
        ? ` role="button" tabindex="0" data-open-lead="${esc(lead.id)}" title="Open this lead"`
        : ''}>
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-1.5 flex-wrap">${sev ? statusTag(sev) : ''}<span class="chip">${esc(str(it.kind) || 'item')}</span></div>
        <span class="material-symbols-outlined text-[20px] ${SEV_TEXT[up(sev)] || 'text-outline'}">${icon}</span>
      </div>
      <div class="font-body-md text-body-md font-semibold text-on-surface leading-snug">${esc(str(it.title) || str(it.kind) || 'Attention item')}</div>
      <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(str(it.detail))}</div>
      ${lead
        ? `<div class="ds-cell-sub">${nameAndPhone(lead)}</div>`
        : `<div class="ds-cell-sub ds-t-tertiary">Refers to ${esc(str(it.ref) || 'no ref')}, which is not among the ${num(all.length)} ${plural(all.length, 'lead', 'leads')} loaded here, so it cannot be opened from this screen.</div>`}
      <div class="mt-auto pt-2 border-t border-outline-variant/30 flex items-center justify-between gap-2">
        <span class="font-label-numeric-sm text-[11px] text-outline">${it.at ? `Waiting since ${esc(when(it.at))}` : 'No timestamp given'}</span>
        ${openable ? '<span class="inline-flex items-center gap-1 font-body-sm text-body-sm font-semibold text-primary">Open<span class="material-symbols-outlined text-[16px]">arrow_forward</span></span>' : ''}
      </div>
    </div>`;
  }).join('');

  /* The four checks as the audit-drawer export's alert cards: severity tag, the
     count at the size of a finding, the sentence, and "Filter" — which is the
     only thing the card does. The long "how this was counted" sentence is kept
     whole behind a disclosure rather than cut, because it names the denominator
     the count was taken against. */
  const checkRows = checks.map(c => `
    <div class="${ALERT_CARD}" role="button" tabindex="0" data-focus="${esc(c.key)}"
      title="Show these ${esc(String(c.leads.length))} leads in the table below">
      <div class="flex items-start justify-between gap-2">
        ${statusTag(c.sev)}
        <span class="material-symbols-outlined text-[20px] ${SEV_TEXT[c.sev] || 'text-outline'}">${c.icon}</span>
      </div>
      <div class="flex items-baseline gap-2">
        <span class="font-label-numeric-lg text-[2rem] leading-none font-bold ${SEV_TEXT[c.sev] || 'text-on-surface'}">${num(c.leads.length)}</span>
        <span class="font-body-md text-body-sm text-on-surface-variant">${plural(c.leads.length, 'lead', 'leads')}</span>
      </div>
      <div class="font-body-md text-body-md font-semibold text-on-surface leading-snug">${esc(c.title)}</div>
      <details class="font-body-sm text-body-sm text-on-surface-variant" data-stop>
        <summary class="cursor-pointer text-primary font-semibold">How this was counted · who</summary>
        <p class="mt-1">${esc(c.detail)}</p>
        <div class="flex flex-wrap gap-1 mt-2">${previewOf(c.leads)}</div>
      </details>
      <div class="mt-auto pt-2 border-t border-outline-variant/30 flex justify-end">
        <span class="inline-flex items-center gap-1 font-body-sm text-body-sm font-semibold text-primary">Filter
          <span class="material-symbols-outlined text-[16px]">arrow_forward</span></span>
      </div>
    </div>`).join('');

  const nLeads = `${num(all.length)} ${plural(all.length, 'lead', 'leads')}`;
  const nothingLines = [
    `The attention list returned no row with screen = 'leads'. Its two branches here are lead_unassigned, which fires on a HOT lead with no assigned_to_id, and sla_breach, which fires on a first reply over ${SLA_MINUTES} minutes on a lead created in the last ${SLA_VIEW_WINDOW_DAYS} days — neither is filed against anything in your leads right now.`,
    leadsErr
      ? ''
      : !all.length
      ? 'Your leads is empty, so the four checks this screen runs of its own had nothing to weigh — none of them passed, they simply did not apply.'
      : `Checked here, against the ${nLeads} read from the table: `
        + (hot.length
            ? `${plural(hot.length, 'the one HOT lead has', `all ${num(hot.length)} HOT leads have`)} a rep on the row; `
            : 'no lead is HOT, so that check had nothing to weigh; ')
        + (scored.length
            ? `no lead scored ${HIGH_SCORE} or higher by the router is still sitting at NEW (${num(scored.length)} of ${nLeads} ${plural(scored.length, 'carries', 'carry')} a score); `
            : 'no lead carries a router score at all, so nothing could be untriaged by that check; ')
        + (contactUsable
            ? `${plural(windowMatchable.length, 'the one lead', `each of the ${num(windowMatchable.length)} leads`)} created in the last ${CONTACT_WINDOW_DAYS} days that anything identifies has at least one line in the message history under one of their keys; and no open lead that anything identifies has gone ${STALE_DAYS} days without a logged message or an escalation (${num(openMatchable.length)} checked).`
            : `the contact and staleness checks could not run this time, so nothing was checked about who has been spoken to — see the note below.`),
    /* Reply speed, said as a separate sentence because it is the one thing the
       four checks above cannot speak for. Which of the three cases is printed
       depends on what the rows actually carry, not on an assumption about the
       column: it held 0 on every lead until 31 Aug while this screen asserted it
       was null, and neither the screen nor the reader could tell. */
    leadsErr || !all.length
      ? ''
      : !measured.length
      ? `None of that is a statement about how fast anyone was answered: response_time_minutes is null on ${plural(all.length, 'the only lead here', 'every lead here')}, so nothing here has a measured wait — either nothing has gone back since the lead row was created, or the only reply on file predates it, which the trigger will not measure. The sla_breach branch above has nothing to fire on and neither does this screen.`
      : `On reply speed, which those checks say nothing about: ${num(measured.length)} of ${nLeads} ${plural(measured.length, 'carries', 'carry')} a first-reply time and ${plural(breached.length, `${num(breached.length)} of those is`, `${num(breached.length)} of those are`)} over ${SLA_MINUTES} minutes.`
        + (measured.length < all.length
          ? ` The other ${num(all.length - measured.length)} ${plural(all.length - measured.length, 'carries', 'carry')} no measured wait at all, which is not the same as a fast one — see the note below for what a null does and does not say.`
          : ''),
  ].filter(Boolean);

  const nothing = `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant/40 shadow-sm p-space-md flex items-start gap-3">
    <span class="material-symbols-outlined text-[22px] text-emerald-700">task_alt</span>
    <div class="flex-1 min-w-0">
      <div class="font-body-md text-body-md font-semibold text-on-surface">Nothing on this screen needs attention right now</div>
      <div class="ds-cell-sub" style="white-space:normal">${nothingLines.map(esc).join('<br>')}</div>
    </div>
  </div>`;

  /* Every caveat on these counts, kept whole and one click away rather than
     printed as a wall above the table. */
  const notesRow = stripNotes.length ? `<details class="${NOTE.info}" style="display:block">
      <summary class="cursor-pointer font-semibold">Notes on these counts (${num(stripNotes.length)})</summary>
      <div class="mt-1">${stripNotes.map(esc).join('<br>')}</div></details>` : '';

  alertCard.innerHTML = (viewItems.length || checks.length
      ? `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md">${viewRows}${checkRows}</div>`
      : nothing)
    + notesRow;

  if (leadsErr) {
    /* The strip above still says what the view reported and why the checks are
       missing; the table is the thing that is actually broken. */
    card.innerHTML = errorState({ what: 'leads', err: leadsErr });
    kpiHost.innerHTML = '';
    footHost.innerHTML = trustFooter({ source: 'leads', asOf: dubaiStamp(readAt), evidence: 'The leads read failed', actor: actorName() });
    return;
  }

  /* Two secondary reads. Neither is allowed to take the screen down, but a
     failure is not allowed to look like an answer either: with no purchase
     history no VIP badge is shown *and no lead is claimed to be a first-timer*,
     and with no audit log the workflow-history line is withheld rather than
     rendered as "never run". Both say so in a banner. */
  let vipSet = null, hist = null;
  const notes = [];
  try {
    const purchases = await db(`purchase_history?select=email&limit=${PURCHASE_LIMIT}`);
    /* Empty keys dropped. A purchase row with a blank email would otherwise match
       lead 35, whose email column is an empty string, and badge a disqualified
       wrong-number lead as a returning customer. */
    vipSet = new Set(purchases.map(p => low(p.email)).filter(Boolean));
    if (purchases.length >= PURCHASE_LIMIT) {
      notes.push(`The purchase-history read stopped at ${num(PURCHASE_LIMIT)} rows, so the VIP badge covers only the buyers in those rows. A lead without one is not being shown as a first-time buyer — it may simply be outside the rows read.`);
    }
  } catch (e) {
    notes.push(`Purchase history is unavailable (${e.message}), so returning customers are not flagged.`);
  }
  try {
    /* `summary` is selected because outcomeOf() needs it: a row whose summary
       says a step "did not land" is a PARTIAL whatever status it carries, and
       that correction lives in lib/health.js rather than in this file. */
    const audit = await db('audit_log?select=workflow,status,summary,lead_email,logged_at'
      + `&order=logged_at.desc&limit=${AUDIT_LIMIT}`);
    if (audit.length >= AUDIT_LIMIT) {
      notes.push(`The workflow-history read stopped at ${num(AUDIT_LIMIT)} activity-log rows, so an older escalation or drip may be missing from the Actions column. A missing line there means "not in the rows read", not "never happened".`);
    }
    /* Keyed on the canonical identity, not on lead_email. The audit log carries
       the same four key shapes communication_logs does — on 1 Sep 2026 its two
       non-null keys are one gmail address and one `+971547484167@whatsapp.lead`
       — so an escalation filed under the synthetic address was invisible to a
       lead the dashboard held under a real one, and vice versa. */
    hist = new Map();
    for (const a of audit) {
      const k = normalizeKey(a.lead_email).canonical; if (!k) continue;
      const slot = /drip/i.test(a.workflow || '') ? 'drip'
                 : /escalat/i.test(a.workflow || '') ? 'escalate' : null;
      if (!slot) continue;
      const cur = hist.get(k) || {};
      if (!cur[slot]) { cur[slot] = a; hist.set(k, cur); }   // rows arrive newest first
    }
  } catch (e) {
    notes.push(`The audit log is unavailable (${e.message}), so previous escalations and drips are not shown. That is a missing record, not an absence of one.`);
  }
  /* The newest run of one workflow for one lead, across every key that lead is
     filed under. Ties are broken by logged_at because two keys can both carry a
     row and only the later one is "the last time this ran". */
  const lastRun = (lead, slot) => {
    let best = null;
    for (const k of identKeys(lead)) {
      const row = hist?.get(k)?.[slot];
      if (row && (!best || ts(row.logged_at) > ts(best.logged_at))) best = row;
    }
    return best;
  };

  const sources = [...new Set(all.map(l => l.source).filter(Boolean))].sort();
  /* Built from the same repOf() the cell and the filter use, so a lead owned
     through `assigned_to` alone gets an entry here instead of being reachable
     from no option in the dropdown at all. */
  const reps = [...new Set(all.map(repOf).filter(Boolean))].sort();

  /* Actions fired in this browser session. Recorded only after a 2xx, and
     labelled as this session's doing — it is our own receipt, not a DB row. */
  const sent = new Map();

  const f = { status: 'ALL', q: '', source: 'ALL', rep: 'ALL', scoring: 'ALL', sort: 'new', alert: null, untimed: false, mine: false };

  function filtered() {
    const focus = f.alert ? checkByKey.get(f.alert) : null;
    return all.filter(l => {
      if (focus && !focus.ids.has(String(l.id))) return false;
      if (f.status === NO_STATUS) { if (str(l.status)) return false; }
      else if (f.status !== 'ALL' && up(l.status) !== f.status) return false;
      if (f.source !== 'ALL' && l.source !== f.source) return false;
      /* Both arms read the same thing the Assigned cell renders. They did not:
         the filter tested assigned_to_id while the cell painted users.name, so a
         lead the table had just labelled "Unassigned" was hidden the moment the
         operator selected the Unassigned option. A filter that hides the rows it
         is named after is worse than no filter. */
      if (f.rep === '__none' && owned(l)) return false;
      if (f.rep !== 'ALL' && f.rep !== '__none' && repOf(l) !== f.rep) return false;
      /* Saved views. "No first reply timed" reads the same null the First reply
         column paints; "My leads" matches assigned_to_id against this login's
         staff id, the key the leads policy itself uses. */
      if (f.untimed && respOf(l) != null) return false;
      if (f.mine && String(l.assigned_to_id || '') !== String(myStaffId() || '')) return false;
      if (f.scoring !== 'ALL' && (up(l.scoring_state) || 'PENDING') !== f.scoring) return false;
      if (f.q) {
        const hay = [l.name, l.email, l.phone, l.vehicle_interest].join(' ').toLowerCase();
        if (!hay.includes(f.q.toLowerCase())) return false;
      }
      return true;
    });
  }

  /* Leads with no AI score are not zero-scored — the router simply never scored
     them. They sort to the bottom of both score orders, newest first among
     themselves, rather than pretending to be the worst leads in the pipeline. */
  function sorted(rows) {
    if (f.sort === 'new') return rows.slice().sort((a, b) => ts(b.created_at) - ts(a.created_at));
    if (f.sort === 'old') return rows.slice().sort((a, b) => ts(a.created_at) - ts(b.created_at));
    const dir = f.sort === 'low' ? 1 : -1;
    const scoredRows = rows.filter(r => n0(r.ai_score) != null)
      .sort((a, b) => dir * (Number(a.ai_score) - Number(b.ai_score)));
    const unscored = rows.filter(r => n0(r.ai_score) == null)
      .sort((a, b) => ts(b.created_at) - ts(a.created_at));
    return scoredRows.concat(unscored);
  }

  /* The tabs are built from the statuses that are actually in the table, not
     from the router's three.

     `leads.status` is written by three different things — HOT/WARM/COLD by the
     Master Router, CONTACTED/QUALIFIED/WON/LOST by the Slack Command Center
     through an unconstrained $fromAI, DISQUALIFIED by the BDC agent — and this
     toolbar knew only the first three. A lead the sales manager marked WON in
     Slack was then reachable from no tab at all: not in HOT, WARM or COLD, and
     visible only in All, where the four counts underneath silently stopped
     adding up to it. Nothing on screen explained the gap, so the arithmetic
     just looked wrong.

     Every status present gets a tab, in lifecycle order, with anything this
     build has never seen appended after them rather than dropped — $fromAI can
     invent a word tomorrow and it will appear here the day it does. Rows with
     no status at all get the last tab. So the tabs sum to All, exactly, by
     construction. */
  const SEG_ORDER = ['HOT','WARM','COLD','NEW','CONTACTED','QUALIFIED','WON','LOST','DISQUALIFIED'];
  const NO_STATUS = '__nostatus';
  const segCounts = new Map();
  all.forEach(l => {
    const k = str(l.status) ? up(l.status) : NO_STATUS;
    segCounts.set(k, (segCounts.get(k) || 0) + 1);
  });
  const segKnown = SEG_ORDER.filter(k => segCounts.has(k));
  const segNovel = [...segCounts.keys()]
    .filter(k => k !== NO_STATUS && !SEG_ORDER.includes(k)).sort();
  const segs = [['ALL', all.length], ...[...segKnown, ...segNovel].map(k => [k, segCounts.get(k)])]
    .concat(segCounts.has(NO_STATUS) ? [[NO_STATUS, segCounts.get(NO_STATUS)]] : []);
  const segLabel = k => k === 'ALL' ? 'All' : k === NO_STATUS ? 'No status' : k;
  /* Said only when there is something to explain. With the router's three
     statuses and nothing else, the toolbar reads as it always did. */
  const segNote = segNovel.length
    ? `${num(segNovel.length)} of the tabs above (${segNovel.join(', ')}) ${plural(segNovel.length, 'is a status', 'are statuses')} this dashboard has no wording for — shown exactly as the database holds ${plural(segNovel.length, 'it', 'them')}, not folded into one of the router's three.`
    : segs.length > 4
      ? 'The tabs are the statuses actually in the table, not just the router\'s three, so they add up to All. HOT, WARM and COLD are written by the Master Router; CONTACTED, QUALIFIED, WON and LOST by the Slack Command Center; DISQUALIFIED by the BDC agent.'
      : '';


  /* ── KPI row (leads-pipeline-inspector--930cc7) ─────────────────────────
     Counts of the rows just read, never a rate or an average: the 5-minute
     figure is "N of the M that carry a measured first reply", because a mean
     over a handful of measurements is not a performance figure. The Stitch
     tile "Active pipeline value" is kept as a tile and deliberately left
     unsummed — `budget_aed` is what a customer said they might spend, not a
     figure NEXUS worked out, and adding those up would put an estimate in a
     money position with nothing behind it. */
  const openCount = all.filter(l => !TERMINAL.has(up(l.status))).length;
  const withBudget = all.filter(l => n0(l.budget_aed) != null).length;
  /* Compact KPI tiles, the shape of leads-pipeline-inspector--930cc7's row:
     label, figure, one line, icon. The full sentence is on the tile's hover. */
  const kpiC = (label, value, sub, icon, tone = '') => `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant/40 shadow-sm px-space-md py-3 flex items-center justify-between gap-3 min-w-0" title="${esc(sub)}">
      <div class="min-w-0">
        <div class="font-table-header text-table-header uppercase tracking-wider ${tone === 'hot' ? 'text-red-700' : 'text-outline'} font-semibold">${esc(label)}</div>
        <div class="font-label-numeric-lg text-[1.5rem] leading-tight font-bold ${tone === 'hot' ? 'text-red-700' : 'text-on-surface'}">${value == null ? '—' : esc(value)}</div>
        <div class="font-body-sm text-[12px] text-on-surface-variant line-clamp-2">${esc(sub)}</div>
      </div>
      <span class="w-10 h-10 rounded-lg ${tone === 'hot' ? 'bg-red-50 text-red-700' : 'bg-primary-fixed text-primary'} flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[20px]">${esc(icon)}</span></span>
    </div>`;
  kpiHost.innerHTML = [
    kpiC('Leads on file', num(all.length),
      `${num(openCount)} still open · ${num(all.length - openCount)} finished${leadsCapped ? ` · read stopped at ${num(LEAD_LIMIT)}` : ''}`
      /* At this size the counts are the whole book, not a sample: said on the
         tile so the stage tally is not read as a distribution. */
      + (all.length && all.length <= THIN ? `. That is every lead on file, not a sample — ${plural(all.length, 'one row', `${num(all.length)} rows`)} cannot carry a share, a conversion rate or a trend, so none is printed.` : ''), 'hub'),
    kpiC(`Over the ${SLA_MINUTES}-minute rule`, measured.length ? num(breached.length) : null,
      measured.length
        ? `Of the ${num(measured.length)} ${plural(measured.length, 'lead that carries', 'leads that carry')} a measured first reply. A lead with no figure is not fast — it was never timed.`
        : 'No lead carries a measured first reply, so nothing can be over the rule — or under it.', 'timer_off', breached.length ? 'hot' : ''),
    kpiC('First reply timed', `${num(measured.length)} / ${num(all.length)}`,
      'No average is taken. A null means no measured wait, never a fast one.', 'speed'),
    kpiC('Active pipeline value', null,
      `Not summed. ${num(withBudget)} of ${num(all.length)} ${plural(all.length, 'lead carries', 'leads carry')} a budget the customer stated — that is not a figure NEXUS calculated, so it is not added up into one.`, 'payments'),
  ].join('');

  /* ── Saved views ─────────────────────────────────────────────────────────
     Named presets over the filters that already exist, remembered PER BROWSER
     through lib/prefs.js — which only stores on/off switches, so a view is a
     preset and "Save view" makes the selected one this browser's default. A
     free-form saved filter combination is not stored anywhere yet and nothing
     here pretends otherwise. "My leads" needs the signed-in account's staff id
     (myStaffId(), the key the leads policy matches on); with no id it is not
     offered rather than offered and empty. */
  const myId = myStaffId();
  const VIEWS = [
    { id: 'all',        label: 'All leads' },
    ...(myId ? [{ id: 'mine', label: 'My leads' }] : []),
    { id: 'hot',        label: 'HOT leads' },
    { id: 'unassigned', label: 'Unassigned' },
    { id: 'untimed',    label: 'No first reply timed' },
    { id: 'failed',     label: 'Scoring failed' },
  ];
  const viewFlag = id => `nexus.leads.view.${id}`;
  let currentView = (VIEWS.find(v => v.id !== 'all' && readFlag(viewFlag(v.id))) || VIEWS[0]).id;
  function applyView(id) {
    currentView = id;
    f.status = 'ALL'; f.source = 'ALL'; f.rep = 'ALL'; f.scoring = 'ALL'; f.untimed = false; f.mine = false; f.alert = null;
    if (id === 'hot') f.status = 'HOT';
    if (id === 'unassigned') f.rep = '__none';
    if (id === 'untimed') f.untimed = true;
    if (id === 'failed') f.scoring = 'FAILED';
    if (id === 'mine') f.mine = true;
  }
  applyView(currentView);

  /* ── Columns ─────────────────────────────────────────────────────────────
     Which columns show is a per-browser switch, one flag per column. Email is
     off by default because the column so often holds a routing key rather than
     an address; Budget and Scoring are off by default to keep the row to the
     Stitch column set. All three are one click away under Columns, and the
     drawer always shows them. A FAILED scoring state still reaches the operator
     through the "Scoring failed" view and the Retry scoring button. */
  const colFlag = key => `nexus.leads.col.${key}`;
  const COL_DEFAULT_OFF = new Set(['email', 'budget', 'scoring']);
  const colOn = key => readFlag(colFlag(key), !COL_DEFAULT_OFF.has(key));

  let layout = readFlag('nexus.leads.board') ? 'board' : 'table';
  const picked = new Set();
  let bulkOpen = false;

  /* The stage strip, from the statuses actually in the table (segs), in the
     same lifecycle order and with the same "no status" bucket. */
  const stageStrip = segs.filter(([k]) => k !== 'ALL').map(([k, c], i) =>
    `${i ? '<span class="text-outline-variant">›</span>' : ''}<button type="button" data-stage="${esc(k)}" class="${STAGE_BTN}">${esc(segLabel(k))} (${num(c)})</button>`).join('');

  const headChip = measured.length && breached.length
    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-error-container text-on-error-container font-label-numeric-sm text-label-numeric-sm font-semibold"><span class="w-1.5 h-1.5 rounded-full bg-error"></span>${num(breached.length)} over the ${SLA_MINUTES}-minute rule</span>`
    : (all.length && !measured.length
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-50 text-amber-800 font-label-numeric-sm text-label-numeric-sm font-semibold"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>No first reply timed on any lead</span>`
      : '');

  headHost.innerHTML = `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant/40 shadow-sm px-space-md py-space-sm flex flex-col gap-3">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="flex items-center gap-2">
        <span class="font-table-header text-table-header uppercase tracking-wider text-outline">Work</span>
        <span class="font-table-header text-table-header text-outline-variant">/</span>
        <span class="font-table-header text-table-header uppercase tracking-wider text-on-surface font-semibold">Leads &amp; intake</span>
      </div>
      <div class="flex items-center gap-3 flex-wrap">
        <div class="flex items-center p-0.5 bg-surface-container rounded-lg" role="group" aria-label="Layout">
          <button type="button" data-layout="table" class="${LAYOUT_BTN.off}"><span class="material-symbols-outlined text-[16px]">view_list</span>Table</button>
          <button type="button" data-layout="board" class="${LAYOUT_BTN.off}"><span class="material-symbols-outlined text-[16px]">view_kanban</span>Board</button>
        </div>
        ${stageStrip ? `<div class="hidden xl:flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-container-low text-on-surface-variant font-label-numeric-sm text-label-numeric-sm flex-wrap" title="${esc(segNote || 'The stages are the statuses actually in the table, so they add up to all leads.')}"><span class="text-outline">Stages:</span>${stageStrip}</div>` : ''}
      </div>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-baseline gap-3 flex-wrap">
        <h1 class="font-headline-lg text-headline-lg text-on-surface tracking-tight">Leads Desk</h1>
        <span class="font-label-numeric-md text-label-numeric-md text-outline"><strong class="text-on-surface font-bold">${num(openCount)}</strong> open ${plural(openCount, 'enquiry', 'enquiries')} of ${num(all.length)}</span>
        ${headChip}
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <label class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface font-body-md text-body-sm font-semibold transition-colors">
          <span class="material-symbols-outlined text-primary text-[18px]">bookmark</span>
          <span>View:</span>
          <select id="fView" aria-label="Saved view" class="bg-transparent font-semibold text-on-surface focus:outline-none cursor-pointer">
            ${VIEWS.map(v => `<option value="${esc(v.id)}"${v.id === currentView ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}
          </select>
        </label>
        <button type="button" id="saveView" class="${TOOL_BTN}" title="Remembers the selected view as this browser's default. Saving a custom filter combination is not available yet.">
          <span class="material-symbols-outlined text-[16px] text-outline">save</span>Save view</button>
        <div class="relative">
          <button type="button" id="colBtn" class="${TOOL_BTN}" aria-haspopup="true" aria-expanded="false" title="Choose which table columns are shown">
            <span class="material-symbols-outlined text-[16px] text-outline">view_column</span>Columns</button>
          <div id="colMenu" class="hidden absolute right-0 top-full mt-1 z-20 w-56 bg-surface-container-lowest rounded-lg shadow-lg border border-outline-variant/40 p-2 flex flex-col gap-1"></div>
        </div>
        <div class="h-6 w-px bg-surface-container-high mx-1"></div>
        <!-- The walk-in and phone-call entry path. It writes nothing itself — it
             opens a dialog that calls rpc/nexus_lead_record_manual, which walks
             the same record -> hydrate -> promote path a provider lead walks. -->
        <button type="button" id="addLead" class="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-primary-container text-on-primary hover:bg-primary font-body-md text-body-sm font-semibold shadow-sm transition-colors">
          <span class="material-symbols-outlined text-[18px]">add_circle</span>Record a lead</button>
      </div>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2 flex-wrap flex-1">
        <div class="relative w-full max-w-[260px]">
          <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">search</span>
          <input type="search" id="q" aria-label="Search leads" class="${FIELD} w-full pl-9" placeholder="Search name, email, phone or vehicle" />
        </div>
        <!-- Every option carries an explicit value: without one,
             HTMLOptionElement.value falls back to whitespace-collapsed text and a
             source or rep name with a double space can never match. -->
        <!-- leads.source is the WRITER, so the filter is labelled as the writer. -->
        <label class="${FILTER_PILL}" title="${esc(WRITER_COLUMN_NOTE)}"><span class="text-outline">Written by:</span>
          <select id="fSource" aria-label="Filter by which part of NEXUS wrote the row" class="${PILL_SELECT}"><option value="ALL">Any</option>${sources.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></label>
        <label class="${FILTER_PILL}"><span class="text-outline">Rep:</span>
          <select id="fRep" aria-label="Filter by assigned rep" class="${PILL_SELECT}"><option value="ALL">All reps</option><option value="__none">Unassigned</option>${reps.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></label>
        <!-- NX1005: PENDING is "still in the queue", FAILED is "stuck and needs a
             Retry scoring click". -->
        <label class="${FILTER_PILL}"><span class="text-outline">Scoring:</span>
          <select id="fScoring" aria-label="Filter by scoring state" class="${PILL_SELECT}">
            <option value="ALL">Any</option><option value="PENDING">Pending</option><option value="FAILED">Failed</option>
          </select></label>
        <label class="${FILTER_PILL}"><span class="text-outline">Status:</span>
          <select id="fStatus" aria-label="Filter by status" class="${PILL_SELECT}">
            ${segs.map(([k, c]) => `<option value="${esc(k)}">${esc(segLabel(k))} · ${num(c)}</option>`).join('')}
          </select></label>
      </div>
      <div class="flex items-center gap-3 font-label-numeric-sm text-label-numeric-sm text-outline">
        <label>Sort: <select id="fSort" aria-label="Sort leads" class="${PILL_SELECT}">${Object.entries(SORTS)
          .map(([k, label]) => `<option value="${k}">${esc(label)}</option>`).join('')}</select></label>
        <span id="resultCount"></span>
      </div>
    </div>
  </div>`;

  card.innerHTML = `
    <div id="bulkHost"></div>
    <div id="focusNote"></div>
    ${notes.map(n => note('warm', 'warning', esc(n))).join('')}
    <div id="leadTable"></div>`;

  function actionCell(r) {
    const buttons = [ACTIONS.escalate, ACTIONS.drip, ACTIONS.retryScoring].map(a => {
      /* Only the two n8n-hook actions depend on N8N_BASE being configured; the
         rpc action (retryScoring) is a direct database write and is blocked,
         if at all, only by its own a.blocker(). */
      const blocked = (a.hook && !N8N_BASE)
        ? 'This deployment is not configured to reach the automation service, so nothing can be started from here. Only NEXUS can change that.'
        : a.blocker(r);
      /* Icon buttons, so one row stays one row; the label is the button's
         accessible name and its hover text says what it does or why not. */
      return `<button type="button" class="${ROW_BTN}" data-act="${a.key}" data-id="${esc(r.id)}"
        aria-label="${esc(a.label)} — ${esc(maskText(r.name || r.email || 'this lead'))}"
        title="${esc(`${a.label}: ${blocked || a.title}`)}"${blocked ? ' disabled' : ''}><span class="material-symbols-outlined text-[18px]">${ACT_ICON[a.key] || 'bolt'}</span></button>`;
    }).join('');

    const lines = [];
    for (const a of [ACTIONS.escalate, ACTIONS.drip, ACTIONS.retryScoring]) {
      const at = sent.get(`${r.id}|${a.key}`);
      /* This session's own receipt, and it says so: a 2xx from the webhook is
         the only thing we know, and it is not an audit_log row. */
      if (at) lines.push(`<span class="ds-t-success">${esc(a.done)} ${ago(at)} · this session</span>`);
      const past = lastRun(r, a.key);
      if (past) {
        /* lib/health.js mirrors nexus_outcome_class() and is the only place
           allowed to say what a run's status means; the raw status stays on
           hover so the row can still be traced. */
        const w = outcomeWords(outcomeOf(past));
        lines.push(`${esc(past.workflow)} · <span class="t-${esc(w.tone)}" title="${esc(
          `${w.blurb} That run was recorded as ${str(past.status) || '(no status)'}.`)}">${esc(w.label)}</span> · ${ago(past.logged_at)}`);
      }
    }
    return `<div class="flex gap-1 justify-end">${buttons}</div>
      ${lines.length ? `<div class="ds-cell-sub" style="text-align:right">${lines.join('<br>')}</div>` : ''}`;
  }

  const cols = [
    { key: 'status', label: 'Status', render: r => statusTag(r.status || 'NEW', !!r.status) },
    /* Name and phone in one cell, because every alert on this screen resolves to
       somebody picking up a phone. */
    { key: 'lead', label: 'Lead', fixed: true, render: r =>
        /* Matched on a real address only: purchase_history is keyed on one. */
        `<div class="flex items-center gap-2 min-w-0">
          <div class="w-7 h-7 rounded-full bg-primary-container text-on-primary font-bold text-[11px] flex items-center justify-center shrink-0">${esc(maskText(initials(r.name)))}</div>
          <div class="min-w-0">
            <div class="font-body-md text-body-sm font-semibold text-on-surface flex items-center gap-1.5 whitespace-nowrap">${leadName(r)}${realEmail(r) && vipSet?.has(realEmail(r)) ? ` <span class="${VIP_TAG}" title="A purchase is on file for this email address.">VIP</span>` : ''}</div>
            <div class="font-label-numeric-sm text-label-numeric-sm text-outline whitespace-nowrap">#${esc(String(r.id))} · ${phoneText(r)}</div>
          </div></div>` },
    /* `leads.email` is not always an email: a `+digits@whatsapp.lead` routing
       key or an empty string are both live. Shown, labelled for what it is. */
    { key: 'email', label: 'Email', render: r => {
        const shape = keyShape(r.email);
        if (shape === KEY_SHAPE.NONE) return '<span class="ds-t-tertiary" title="The email column on this row is empty.">—</span>';
        if (shape === KEY_SHAPE.EMAIL) return esc(maskText(r.email));
        return `<span class="mono ds-t-warning" title="${esc(maskText(
          `Not an email address — ${describeKey(r.email)}. The email column on this lead holds a key the workflows file its messages under, not something a person can be written to.`))}">${esc(maskText(str(r.email)))}</span>
          <div class="ds-cell-sub">Not an address</div>`;
      }},
    { key: 'vehicle', label: 'Vehicle interest', render: r => r.vehicle_interest
        ? `<div class="font-body-md text-body-sm font-semibold text-on-surface">${esc(r.vehicle_interest)}</div>`
        : '<span class="ds-t-tertiary">—</span>' },
    /* ── Where it came from ──────────────────────────────────────────────
       leads.source is the WRITER; the origin lives in the ingestion layer and
       nexus_lead_attribution() projects it. Three cases kept apart: an arrival
       recorded, no arrival recorded, and the read failing. Nothing maps a
       workflow name onto a platform, and UNKNOWN renders as UNKNOWN. */
    { key: 'source', label: 'Came from', render: r => {
        if (attribErr) {
          return `${pill('Not read', 'unknown', { verbatim: false })}
                  <div class="ds-cell-sub">Where this lead came from could not be read, so nothing is claimed either way.</div>`;
        }
        const a = attribByLead.get(r.id);
        if (!a) {
          /* The full sentence rides on the hover: it is the same sentence on
             every such row, and printed in each one it made every row of the
             table ten lines tall. */
          return `<span title="${esc(ORIGIN_NOT_RECORDED)}">${pill('No arrival recorded', 'unknown', { verbatim: false })}</span>
                  <div class="ds-cell-sub"><span class="font-semibold">${esc(WRITER_COLUMN_LABEL)}</span> ${esc(r.source || '—')}</div>`;
        }
        const conf = attributionConfidence(a.ad_platform_confidence);
        const comp = attributionCompleteness(a.attribution_completeness);
        const platformKnown = a.ad_platform && String(a.ad_platform).toUpperCase() !== 'UNKNOWN';
        return `<div>${platformKnown
                  ? pill(String(a.ad_platform), conf ? conf.tone : 'unknown', { verbatim: true })
                  : pill('Unknown platform', 'unknown', { verbatim: false })}</div>`
             + (conf ? `<div class="ds-cell-sub">${esc(conf.label)}</div>` : '')
             + (comp ? `<div class="ds-cell-sub">${esc(comp.label)}</div>` : '')
             + (a.campaign_name ? `<div class="ds-cell-sub">${esc(a.campaign_name)}</div>` : '')
             + (a.is_test_traffic
                 ? `<div class="ds-cell-sub"><span class="ds-t-danger">Test traffic — counted nowhere as business.</span></div>` : '');
      }},
    /* Three columns can name an owner and this cell reads all three, in the same
       order lib/lead-drawer.js does. */
    { key: 'owner', label: 'Assigned owner', render: r => {
        const name = repOf(r);
        if (!name) {
          return r.assigned_to_id
            ? `${pill('Owner not resolved', 'unknown', { verbatim: false })}
               <div class="ds-cell-sub">assigned_to_id ${esc(str(r.assigned_to_id))} is set, but no users row came back for it and assigned_to is empty.</div>`
            : `<span class="inline-flex items-center gap-1 text-error font-body-sm text-body-sm font-semibold"><span class="material-symbols-outlined text-[16px]">warning</span>Unassigned</span>`;
        }
        return `<span class="font-body-sm text-body-sm text-on-surface">${esc(name)}</span>${r.users?.name || r.assigned_to_id ? '' : '<div class="ds-cell-sub">Named on the lead\'s assigned_to column; there is no rep id on the row.</div>'}`;
      }},
    /* budget_aed is NULL for router-created leads: rendering 0 would understate
       the pipeline silently. */
    { key: 'budget', label: 'Budget', align: 'r', render: r => n0(r.budget_aed) == null ? '<span class="ds-t-tertiary">—</span>' : aed(r.budget_aed) },
    { key: 'score', label: 'AI score', align: 'r', render: r => {
        const s = n0(r.ai_score); if (s == null) return '<span class="ds-t-tertiary" title="Not scored">—</span>';
        const bar = SCORE_BAR[tone(r.status)] || SCORE_BAR.cold;
        return `<div class="flex items-center gap-2 justify-end">
          <div class="w-12 h-1.5 rounded-full bg-surface-container overflow-hidden"><div class="h-full rounded-full ${bar}" style="width:${Math.max(0, Math.min(100, s))}%"></div></div>
          <span class="font-label-numeric-sm text-label-numeric-sm font-semibold min-w-[22px] text-right">${s}</span></div>`;
      }},
    /* NX1005: what the scoring pipeline says about this row. A FAILED row's
       attempts and last error are shown here, because "why is this lead stuck"
       is exactly the question this column exists to answer without a click. */
    { key: 'scoring', label: 'Scoring', render: r => {
        const state = up(r.scoring_state) || 'PENDING';
        const statePill = state === 'SCORED'
          ? pill(state, 'ok', { verbatim: true })
          : pill(state, undefined, { verbatim: true });
        const source = str(r.score_source);
        const rules = n0(r.rules_score);
        const attempts = n0(r.scoring_attempts);
        const err = str(r.scoring_last_error);
        return `<div>${statePill}</div>`
          + (source ? `<div class="ds-cell-sub"><span class="chip mono">${esc(source)}</span></div>` : '')
          + (rules != null ? `<div class="ds-cell-sub">rules_score ${esc(String(rules))}</div>` : '')
          + (state === 'FAILED'
              ? `<div class="ds-cell-sub ds-t-danger">${esc(String(attempts ?? 0))} attempt${attempts === 1 ? '' : 's'}`
                + (err ? ` -- ${esc(err.length > 90 ? err.slice(0, 90) + '…' : err)}` : ' -- no error text recorded')
                + '</div>'
              : (attempts ? `<div class="ds-cell-sub">${esc(String(attempts))} attempt${attempts === 1 ? '' : 's'}</div>` : ''));
      }},
    { key: 'age', label: 'Age', align: 'r', render: r => `<span class="ds-t-tertiary" title="${esc(when(r.created_at))}">${ago(r.created_at)}</span>` },
    /* An empty response-time cell reads as "answered instantly". A null here
       means the wait was never timed — see the file header. */
    { key: 'reply', label: 'First reply', align: 'r', render: r => {
        const m = respOf(r);
        if (m == null) return `<span class="ds-t-warning" title="${esc(
          'response_time_minutes is null on this row. The trigger on the message history stamps it for the first reply it can match to this lead, and it has not stamped this one. Usually that means nothing has gone back since the lead row was created; it can also mean the only reply on file predates the lead row, which the trigger will not measure. '
          + `Either way there is no measured wait: this is not a fast reply and not a slow one, the ${SLA_MINUTES}-minute rule cannot be applied to this lead at all, and the attention list cannot raise an sla_breach for it either.`)}">Not timed</span>`;
        return `<span class="${m > SLA_MINUTES ? 'ds-t-danger' : 'ds-t-success'}" title="${esc(
          `The minutes between the lead being created and the first outbound whatsapp, email or sms message the message history trigger could attribute to it, rounded to the nearest whole minute. A reply logged up to 90 seconds before the lead row is recorded as 0 when no inbound message was already on file — an allowance for the two clocks involved disagreeing — and anything earlier is left unmeasured rather than clamped. The ${SLA_MINUTES}-minute rule is the dealership's own promise, not a database constraint.`)}">${esc(mins(m))}</span>`;
      }},
    { key: 'actions', label: 'Actions', align: 'r', fixed: true, render: actionCell },
  ];

  /* One confirm step, then one unambiguous outcome. The dialog stays open on
     failure with the error verbatim. */
  function confirmAction(a, lead) {
    const shape = keyShape(lead.email);
    const emailHtml = shape === KEY_SHAPE.NONE
      ? '<span class="ds-t-tertiary">No email address on this lead</span>'
      : shape === KEY_SHAPE.EMAIL
        ? esc(maskEmail(lead.email))
        : `<span class="mono ds-t-warning">${esc(maskText(str(lead.email)))}</span>`
          + `<div class="ds-cell-sub">Not an address — ${esc(maskText(describeKey(lead.email)))}. It is the key this lead's messages are filed under.</div>`;
    const m = openStitchModal({
      title: a.title,
      bodyHtml: `<p class="font-body-md text-body-sm text-on-surface-variant mb-space-md">${esc(a.blurb)}</p>
        <dl class="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 font-body-sm text-body-sm">
          <dt class="text-outline">Lead</dt><dd>${leadName(lead)}</dd>
          <dt class="text-outline">Phone</dt><dd>${phoneText(lead)}</dd>
          <dt class="text-outline">Email</dt><dd>${emailHtml}</dd>
          <dt class="text-outline">Vehicle</dt><dd>${esc(lead.vehicle_interest || '—')}</dd>
          <dt class="text-outline">Status</dt><dd>${statusTag(lead.status || 'NEW', !!lead.status)}</dd>
          <dt class="text-outline">AI score</dt><dd>${n0(lead.ai_score) == null ? '<span class="ds-t-tertiary">Not scored</span>' : num(lead.ai_score)}</dd>
        </dl>`,
      footHtml: `<button type="button" class="${BTN.secondary}" id="actCancel">Cancel</button>
        <button type="button" class="${BTN.primary}" id="actGo">${esc(a.confirm)}</button>`,
    });

    const go = m.wrap.querySelector('#actGo');
    const cancel = m.wrap.querySelector('#actCancel');
    go.focus();
    cancel.addEventListener('click', m.close);
    go.addEventListener('click', async () => {
      const label = go.textContent;
      go.disabled = true; cancel.disabled = true; go.textContent = 'Sending…';
      m.msg('<span class="ds-t-tertiary">Calling the workflow…</span>');
      try {
        /* Two kinds of action share this one confirm step: an n8n webhook
           (`a.hook`) or a direct database write via rpc/ (`a.rpc`). */
        const res = a.rpc
          ? await dbWrite('POST', `rpc/${a.rpc}`, a.payload(lead))
          : await n8n(a.hook, a.payload(lead));
        sent.set(`${lead.id}|${a.key}`, Date.now());
        m.msg(`<span class="ds-t-success">${esc(a.done)}. ${esc((a.describeResult || replyNote)(res))}</span>`);
        go.textContent = 'Done';
        cancel.disabled = false; cancel.textContent = 'Close';
        draw();
      } catch (e) {
        go.disabled = false; cancel.disabled = false; go.textContent = label;
        m.msg(`<span class="ds-t-danger">Nothing was sent — ${esc(e.message)}</span>`);
      }
    });
  }

  const visibleCols = () => cols.filter(c => c.fixed || colOn(c.key));

  function tableHtml(rows) {
    const vc = visibleCols();
    const allPicked = rows.length && rows.every(r => picked.has(String(r.id)));
    return `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant/40 shadow-sm overflow-hidden">
      <div class="overflow-x-auto"><table class="w-full text-left border-collapse">
      <thead><tr class="bg-surface-container-low h-9 text-outline border-b border-outline-variant/30">
        <th class="w-10 px-3 text-center"><input type="checkbox" id="pickAll" aria-label="Select every lead shown" class="${CHECK}"${allPicked ? ' checked' : ''}></th>
        ${vc.map(c => `<th class="${c.align === 'r' ? TH_R : TH_L}">${esc(c.label)}</th>`).join('')}
      </tr></thead>
      <tbody class="divide-y divide-outline-variant/20 font-body-sm text-body-sm text-on-surface">
        ${rows.map((r, i) => `<tr class="${picked.has(String(r.id)) ? ROW.on : ROW.off}" data-i="${i}">
          <td class="px-3 pt-3 align-top text-center"><input type="checkbox" data-pick="${esc(r.id)}" aria-label="Select this lead" class="${CHECK}"${picked.has(String(r.id)) ? ' checked' : ''}></td>
          ${vc.map(c => `<td class="${c.align === 'r' ? TD_R : TD_L}">${c.render(r)}</td>`).join('')}
        </tr>`).join('')}
      </tbody></table></div>
      <div class="px-space-md py-2.5 bg-surface-container-low border-t border-outline-variant/30 font-label-numeric-sm text-label-numeric-sm text-outline flex items-center justify-between">
        <span>Showing ${num(rows.length)} of ${num(all.length)} ${plural(all.length, 'lead', 'leads')}</span>
        <span>Click a row to open the lead</span>
      </div>
    </div>`;
  }

  /* The board groups by the real `leads.status` values, in the same lifecycle
     order the stage strip uses, with "No status" last. A column per status
     actually present — nothing invented, and the columns add up to the rows. */
  function boardHtml(rows) {
    const groups = segs.filter(([k]) => k !== 'ALL').map(([k]) => [k, rows.filter(l =>
      k === NO_STATUS ? !str(l.status) : up(l.status) === k)]);
    return `<div class="flex gap-space-md overflow-x-auto pb-2">${groups.map(([k, ls]) => `
      <div class="w-72 shrink-0 bg-surface-container-low rounded-xl border border-outline-variant/40 flex flex-col max-h-[640px]">
        <div class="px-3 py-2.5 flex items-center justify-between border-b border-outline-variant/30">
          ${k === NO_STATUS ? `<span class="font-table-header text-table-header uppercase text-outline">No status</span>` : statusTag(k)}
          <span class="font-label-numeric-sm text-label-numeric-sm text-outline">${num(ls.length)}</span>
        </div>
        <div class="p-2 flex flex-col gap-2 overflow-y-auto">${ls.length ? ls.map(l => `
          <div class="bg-surface-container-lowest rounded-lg border border-outline-variant/40 shadow-sm p-3 flex flex-col gap-1.5 cursor-pointer hover:border-primary transition-colors" role="button" tabindex="0" data-card="${esc(l.id)}">
            <div class="flex items-center justify-between gap-2">
              <div class="font-body-md text-body-sm font-semibold text-on-surface truncate">${leadName(l)}</div>
              <span class="font-label-numeric-sm text-label-numeric-sm text-outline">#${esc(String(l.id))}</span>
            </div>
            <div class="font-label-numeric-sm text-label-numeric-sm text-outline">${phoneText(l)}</div>
            ${l.vehicle_interest ? `<div class="font-body-sm text-body-sm text-on-surface-variant truncate">${esc(l.vehicle_interest)}</div>` : ''}
            <div class="flex items-center justify-between gap-2 pt-1 border-t border-outline-variant/20">
              <span class="font-body-sm text-body-sm ${repOf(l) ? 'text-on-surface' : 'text-error'}">${esc(repOf(l) || 'Unassigned')}</span>
              <span class="font-label-numeric-sm text-label-numeric-sm text-outline">${n0(l.ai_score) == null ? 'Not scored' : `Score ${num(l.ai_score)}`} · ${ago(l.created_at)}</span>
            </div>
          </div>`).join('') : '<div class="ds-cell-sub" style="padding:8px">No lead in this status matches the filters.</div>'}</div>
      </div>`).join('')}</div>`;
  }

  /* Bulk selection. Assigning one owner to several leads is a Stitch section
     whose backend does not exist — nexus_lead_assign_owner takes one lead — so
     the preview is shown as COMING SOON with its confirm disabled. Tags and an
     archive state do not exist in the database at all. */
  function drawBulk() {
    const h = $('bulkHost');
    if (!h) return;
    if (!picked.size) { h.innerHTML = ''; bulkOpen = false; return; }
    h.innerHTML = `<div class="px-4 py-2.5 rounded-lg bg-secondary-fixed text-on-secondary-fixed flex items-center justify-between gap-3 flex-wrap shadow-sm">
        <div class="flex items-center gap-3">
          <div class="flex items-center justify-center w-5 h-5 rounded bg-primary text-on-primary text-[12px] font-bold">✓</div>
          <span class="font-label-numeric-md text-label-numeric-md font-bold">${num(picked.size)} ${plural(picked.size, 'lead', 'leads')} selected</span>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button type="button" id="bulkAssign" class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-container-lowest text-primary font-body-md text-body-sm font-bold shadow-xs hover:bg-surface-container-high transition-colors">
            <span class="material-symbols-outlined text-[17px]">person_add</span>Assign owner</button>
          <button type="button" disabled title="Coming soon — NEXUS has no lead tags yet." class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-container-lowest text-outline font-body-md text-body-sm font-medium cursor-not-allowed">
            <span class="material-symbols-outlined text-[17px]">label</span>Apply tag</button>
          <button type="button" disabled title="Coming soon — a lead has no archived state in the database yet." class="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-container-lowest text-outline font-body-md text-body-sm font-medium cursor-not-allowed">
            <span class="material-symbols-outlined text-[17px]">archive</span>Archive</button>
          <button type="button" id="bulkClear" class="px-2 py-1 text-on-secondary-fixed-variant hover:text-on-secondary-fixed text-body-sm">Clear selection</button>
        </div>
      </div>
      ${bulkOpen ? `<div class="mt-2 p-4 rounded-xl bg-surface-container-lowest border border-outline-variant/40 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div class="flex items-start gap-3.5">
          <div class="p-2.5 rounded-lg bg-tertiary-fixed text-on-tertiary-fixed shrink-0"><span class="material-symbols-outlined text-[24px]">published_with_changes</span></div>
          <div>
            <div class="flex items-center gap-2 flex-wrap"><h2 class="font-headline-md text-headline-md text-on-surface">Bulk reassignment preview</h2>${statusChip('coming-soon')}</div>
            <p class="font-body-md text-body-sm text-outline mt-0.5">${num(picked.size)} ${plural(picked.size, 'lead is', 'leads are')} selected. Reassigning several leads in one step is not built yet. Each lead can be reassigned now from its own drawer (Assign owner), where the change and the reason given are recorded.</p>
          </div>
        </div>
        <div class="flex items-center gap-3 w-full md:w-auto">
          <select disabled aria-label="Target rep (coming soon)" class="h-9 pl-3 pr-8 rounded-lg bg-surface-container text-body-sm text-outline min-w-[200px]"><option>Select target rep…</option>${reps.map(s => `<option>${esc(s)}</option>`).join('')}</select>
          <button type="button" disabled class="px-4 py-2 rounded-lg bg-surface-container-high text-outline font-body-md text-body-sm font-bold cursor-not-allowed">Confirm (coming soon)</button>
          <button type="button" id="bulkDismiss" class="px-3 py-2 rounded-lg text-outline hover:text-on-surface font-body-md text-body-sm">Dismiss</button>
        </div>
      </div>` : ''}`;
    $('bulkAssign')?.addEventListener('click', () => { bulkOpen = true; drawBulk(); });
    $('bulkDismiss')?.addEventListener('click', () => { bulkOpen = false; drawBulk(); });
    $('bulkClear')?.addEventListener('click', () => { picked.clear(); bulkOpen = false; draw(); });
  }

  function syncControls() {
    const set = (id, v) => { const n = $(id); if (n) n.value = v; };
    set('fStatus', f.status); set('fSource', f.source); set('fRep', f.rep); set('fScoring', f.scoring);
    set('fSort', f.sort); set('fView', currentView); set('q', f.q);
  }

  function draw() {
    /* The screen may have been replaced while a webhook was in flight: this
       runs from an async click handler, where lib/nav.js's generation guard
       cannot catch a throw. If this card is no longer in the document, there is
       nothing to repaint. */
    if (card.isConnected === false) return;
    headHost.querySelectorAll('[data-layout]').forEach(b => { b.className = b.dataset.layout === layout ? LAYOUT_BTN.on : LAYOUT_BTN.off; });
    headHost.querySelectorAll('[data-stage]').forEach(b => { b.className = b.dataset.stage === f.status ? STAGE_BTN_ON : STAGE_BTN; });
    const focus = f.alert ? checkByKey.get(f.alert) : null;
    const rows = sorted(filtered());
    $('resultCount').textContent = `${rows.length} of ${all.length} ${plural(all.length, 'lead', 'leads')}`;

    const noteHost = $('focusNote');
    noteHost.innerHTML = focus
      ? note('info', 'filter_alt', `<div class="flex items-center gap-3 flex-wrap"><div class="flex-1">Showing only the ${num(focus.leads.length)} ${plural(focus.leads.length, 'lead', 'leads')} behind
         “${esc(focus.title)}”. The status, source, rep and search filters were cleared so that set is not hidden by them.</div>
         <button type="button" class="${BTN.secondary}" id="focusClear">Show all leads</button></div>`)
      : '';
    noteHost.querySelector('#focusClear')?.addEventListener('click', () => { f.alert = null; draw(); });
    alertCard.querySelectorAll('[data-focus]').forEach(n => {
      n.className = n.dataset.focus === f.alert ? ALERT_CARD_ON : ALERT_CARD;
    });

    const host2 = $('leadTable');
    host2.innerHTML = !all.length
      ? emptyState({ icon: 'inbox', title: 'No leads yet', body: 'They appear here the moment a lead is recorded or a provider delivers one.' })
      : !rows.length
        ? emptyState({ icon: 'search_off', title: 'No leads match these filters', body: 'Try clearing the search or widening the status filter.' })
        : layout === 'board' ? boardHtml(rows) : tableHtml(rows);

    host2.querySelectorAll('tbody tr[data-i]').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('input,button,a,select,label')) return;
      const lead = rows[Number(tr.dataset.i)];
      if (lead) leadDrawer(lead);
    }));
    host2.querySelectorAll('[data-card]').forEach(n => {
      const run = () => openLead(n.dataset.card);
      n.addEventListener('click', run);
      n.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); } });
    });
    host2.querySelectorAll('input[data-pick]').forEach(b => b.addEventListener('change', () => {
      if (b.checked) picked.add(String(b.dataset.pick)); else picked.delete(String(b.dataset.pick));
      draw();
    }));
    host2.querySelector('#pickAll')?.addEventListener('change', e => {
      rows.forEach(r => { if (e.target.checked) picked.add(String(r.id)); else picked.delete(String(r.id)); });
      draw();
    });
    host2.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', ev => {
      /* The row itself opens the drawer; an action button must not do both. */
      ev.stopPropagation();
      const lead = rows.find(r => String(r.id) === b.dataset.id);
      const a = ACTIONS[b.dataset.act];
      if (lead && a) confirmAction(a, lead);
    }));
    drawBulk();
  }

  function drawColMenu() {
    const menu = $('colMenu');
    menu.innerHTML = cols.filter(c => !c.fixed).map(c => `<label class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-container-low font-body-sm text-body-sm text-on-surface cursor-pointer">
        <input type="checkbox" data-col="${esc(c.key)}" class="${CHECK}"${colOn(c.key) ? ' checked' : ''}>${esc(c.label)}</label>`).join('')
      + '<div class="ds-cell-sub" style="padding:4px 8px;white-space:normal">Remembered on this browser.</div>';
    menu.querySelectorAll('[data-col]').forEach(b => b.addEventListener('change', () => {
      writeFlag(colFlag(b.dataset.col), b.checked);
      draw();
    }));
  }

  /* An alert that only describes a problem is a poster. Clicking a check filters
     the table to exactly its leads — and clears the other filters first, because
     a focus inside a HOT-only or searched view would show a shorter list than
     the alert just promised. */
  function focusCheck(key) {
    f.alert = key; f.status = 'ALL'; f.source = 'ALL'; f.rep = 'ALL'; f.scoring = 'ALL'; f.q = ''; f.untimed = false; f.mine = false;
    syncControls();
    draw();
    $('leadTable').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openLead(id) {
    const lead = byId.get(String(id));
    if (lead) leadDrawer(lead);
  }

  alertCard.querySelectorAll('[data-focus]').forEach(n => {
    const run = () => focusCheck(n.dataset.focus);
    n.addEventListener('click', e => { if (e.target.closest('[data-stop],[data-lead]')) return; run(); });
    /* Keyboard-operable: this card is the only route from the alert to the
       leads it is about. */
    n.addEventListener('keydown', e => {
      if (e.target !== n) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
    });
  });
  alertCard.querySelectorAll('[data-open-lead]').forEach(n => {
    const run = () => openLead(n.dataset.openLead);
    n.addEventListener('click', run);
    n.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
    });
  });
  alertCard.querySelectorAll('[data-lead]').forEach(b => b.addEventListener('click', ev => {
    /* The chip sits inside a card that filters the table; opening one lead and
       filtering to all of them at once would be two answers to one click. */
    ev.stopPropagation();
    openLead(b.dataset.lead);
  }));

  headHost.querySelectorAll('[data-layout]').forEach(b => b.addEventListener('click', () => {
    layout = b.dataset.layout; writeFlag('nexus.leads.board', layout === 'board'); draw();
  }));
  headHost.querySelectorAll('[data-stage]').forEach(b => b.addEventListener('click', () => {
    f.status = f.status === b.dataset.stage ? 'ALL' : b.dataset.stage; f.alert = null; syncControls(); draw();
  }));
  $('fView').addEventListener('change', e => { applyView(e.target.value); syncControls(); draw(); });
  $('saveView').addEventListener('click', () => {
    VIEWS.forEach(v => writeFlag(viewFlag(v.id), v.id === currentView && v.id !== 'all'));
    const b = $('saveView');
    b.title = `“${(VIEWS.find(v => v.id === currentView) || VIEWS[0]).label}” is now this browser's default view.`;
    b.innerHTML = '<span class="material-symbols-outlined text-[16px] text-emerald-700">check</span>Saved as default';
  });
  $('colBtn').addEventListener('click', () => {
    const menu = $('colMenu');
    const open = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !open);
    $('colBtn').setAttribute('aria-expanded', String(open));
    if (open) drawColMenu();
  });
  $('fStatus').addEventListener('change', e => { f.status = e.target.value; f.alert = null; draw(); });
  $('q').addEventListener('input', e => { f.q = e.target.value; draw(); });
  /* Reloads the screen on a save rather than splicing the new lead in by hand:
     the row a salesperson needs is the one the DATABASE made. `host` is emptied
     first because SCREENS.leads APPENDS its root. */
  $('addLead')?.addEventListener('click', () => manualLeadDialog(() => {
    host.innerHTML = '';
    SCREENS.leads(host);
  }));
  $('fSource').addEventListener('change', e => { f.source = e.target.value; draw(); });
  $('fRep').addEventListener('change', e => { f.rep = e.target.value; draw(); });
  $('fScoring').addEventListener('change', e => { f.scoring = e.target.value; draw(); });
  $('fSort').addEventListener('change', e => { f.sort = e.target.value; draw(); });
  syncControls();
  draw();

  footHost.innerHTML = trustFooter({
    source: 'leads · v_needs_attention · communication_logs · whatsapp_contacts · nexus_lead_attribution',
    asOf: dubaiStamp(readAt),
    evidence: `${num(all.length)} ${plural(all.length, 'lead', 'leads')} read${leadsCapped ? ` (stopped at ${num(LEAD_LIMIT)})` : ''}`,
    actor: actorName(),
  });
};
