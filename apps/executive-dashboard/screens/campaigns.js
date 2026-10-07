/* NEXUS OS — screens/campaigns.js
   Rebuilt on 19 Aug 2026 from "a list of leads with a Start drip button" into
   the drip surface proper: who is enrolled, what has actually been sent, and
   one guarded way to enrol somebody else. Given an alert strip on 24 Aug 2026.

   The thing this screen has to be honest about is that *enrolling* and
   *sending* are two different events. The 7-day sequence is queued inside n8n
   the moment `lead-trigger` returns 2xx, but every send step in that sequence
   goes out through Gmail, and today the Gmail credential is revoked. So the
   product can truthfully report a lead as enrolled while nothing whatsoever
   reaches the customer.

   Until today that gap was a hand-typed banner with nothing behind it. It is
   now a reading: `v_needs_attention` carries a live `workflow_failure` row
   whose detail is the n8n error verbatim — the Gmail OAuth2 credential needs to
   be reconnected — and `v_workflow_health` says how the drip workflow itself is
   behaving. The alert strip states which of those two sources it is speaking
   from, and where neither can prove anything it says that instead of guessing.

   The four checks this screen adds on top of the view are the four ways a drip
   embarrasses a dealership:
     · it is running and has sent nothing on either of its two channels,
     · somebody answered it and nobody here has answered them back,
     · somebody was enrolled into an *email* sequence with no email address,
     · the credential that does the sending is dead, so every "sent" is false.

   ── 31 Aug 2026. The second check was accusing the workflow of a fault it
   ── does not have. ──────────────────────────────────────────────────────────

   That check used to read "it is still sequencing somebody who already replied
   — the worst of them, because the customer answered and the machine kept
   talking over them", rendered CRITICAL, in red, with a disabled *Stop the
   sequence* button whose tooltip ended "Reply to these people by hand".

   `7_day_warm_lead_drip_campaign.json` carries FOUR reply gates. Before every
   send, `Replies Since Enrol (Day 1/3/5/7)` reads `communication_logs` on
   `direction=eq.inbound` since the enrolment across three key shapes, and
   `Still Enrolled? (Day N)` routes its false branch to `Stopped Report`; the
   gates also stop on a terminal lead status. Every send node in the workflow
   sits downstream of one of those gates, so no step can go out after a reply is
   recorded. `Stopped Report`'s own header comment names this screen as the
   reason it exists. So the screen was sending an operator to make an emergency
   phone call to prevent something the machine already prevents, and doing it in
   red, above a button that said the machine could not be stopped.

   What is left over after removing the false part is real and is what the alert
   says now: the customer answered and is waiting for a person. That is a
   WARNING about a human being, not a CRITICAL about a runaway workflow.

   ── 01 Sep 2026. Four more places the screen contradicted itself. ───────────

   · **"No drip run has ever been logged", printed above a list of five.** The
     roster is keyed on `audit_log.lead_email` and `continue`s on a null key.
     All five live drip rows were written by `NEXUS Error Handler`, which records
     the workflow and the error but not the lead, so `roster.size` was 0 while
     `dripRuns.length` was 5 — and the KPI, the roster empty state and the
     activity panel each drew their own conclusion from that. "No run has been
     logged" and "runs were logged but none carries a lead we can attribute" are
     now different sentences in all four places, and the second is an alert.
   · **The screen held credential evidence and asserted its absence.** It looked
     for a mail-credential failure only in `v_needs_attention`, whose
     `workflow_failure` branch keeps a row for 24 hours. Two of those same five
     drip rows read `The credential "Gmail OAuth2 API" needs to be reconnected ·
     Failed at node: Email: Welcome (Gmail)` and were already sitting in the
     local `audit` variable. From day two after any such failure the screen
     printed "No mail-credential failure is recorded in v_needs_attention, so
     this is the workflow failing for some other reason" and downgraded itself
     from CRITICAL to WARNING. Both sources are read now.
   · **The drip's WhatsApp legs were being discarded.** `isMail` is `/mail/i`,
     which does not match `whatsapp`, and the drip sends `WhatsApp: Welcome` on
     day 1 and `WhatsApp: Check-in` on day 5, each logging `channel: 'whatsapp'`.
     A lead who received both showed "0 / no mail logged" and a CRITICAL "The
     drip has sent nothing", beside a sentence claiming the test was "as generous
     as it can be made". Both channels are counted and named.
   · **One person, several keys.** `communication_logs.lead_email` holds an
     address, a `@c.us` chat id, a `@lid` handle and a `+digits@whatsapp.lead`
     key for the same customer. The workflow's own reply gates expand across
     those shapes before deciding to send; this screen did not, so half of a
     conversation was invisible to it. Expanded here through a private `keysFor`,
     written as an admitted duplicate of `lib/identity.js` while that module was
     still on another branch. **The duplicate was deleted later the same day**,
     when the resolver landed in this tree — see the block above `personCanon`.
     It matched less than the private rule was claimed to: the shared resolver
     bridges a `@lid` handle through `whatsapp_contacts` / `v_conversations`,
     which is the only way a LID can ever reach a person, and the counts below
     are what that is worth on today's data.

   And `['FAILED','REJECTED']`, the screen's private definition of failure, is
   gone: `lib/health.js` classifies every run, and the else-branch no longer
   asserts that everything else succeeded.

   Nothing here writes to the database. `communication_logs` and `audit_log` are
   service-role only; this screen reads them and calls exactly one n8n webhook.
   Every count below is a count of rows Postgres returned — there is no
   estimated, projected or example figure anywhere on this screen.

   ── Round 4, 24 Aug 2026. One audience member. ───────────────────────────────

   The database now holds one lead, and `communication_logs` holds 66 messages
   that are all his. So a campaign audience here is one person, and this screen
   is mostly empty states — which is the deliverable, not a failure of it. An
   empty state that names what is empty, why, and what would fill it is the most
   useful thing this screen can be today; a fabricated funnel would be the least.

   Those two figures are 24 Aug ones and have moved. Counted 01 Sep 2026 14:18
   UTC: `leads` holds 3 rows — 34 Siva and 35 Effco both DISQUALIFIED, 38 Ali
   WARM — and `communication_logs` holds 95 messages, which `v_conversations`
   resolves to 11 threads and not to one person. So the audience for a drip is
   the single WARM lead, and the paragraph above is still the right description
   of what this screen mostly is; it is the numbers in it that were stale.

   Three things it will not print, at any n, and each one is stated on the screen
   with the column that is missing:

     · **An open rate or a click rate.** Nothing in this database records an
       open, a click or an unsubscribe. A Gmail send leaves no event behind, and
       there is no table for one to land in.
     · **A send rate or a delivery confirmation.** A row in communication_logs is
       written by the workflow after it hands the message off. There is no
       provider message id, no bounce and no delivery status, so a row means "the
       workflow logged a send" and never "it arrived".
     · **A comparison between campaigns.** `communication_logs` carries no
       workflow id and no campaign id, so a day-3 drip mail and a hand-typed
       reply are the same shape to every query this screen can write. Every drip
       figure here is therefore "an outbound message on a mail OR a WhatsApp
       channel at or after the enrolment" — deliberately generous, and
       impossible to narrow with the
       columns that exist. And there is one sequence and one audience member to
       compare anyway.

   Two live facts about the workflow itself, both of which change what this
   screen should say:

     · **The 7-Day Warm Lead Drip is the one workflow in this system that carries
       no `executionTimeout`, and that is deliberate.** Fifteen of the other
       twenty carry a five-minute ceiling; five do not, and the banner used to
       say all twenty did. This one's Wait nodes at day 1, 3, 5 and 7 hold
       a single execution open for a week, so a five-minute ceiling would kill
       every enrolment four minutes into the first wait. The absence is correct
       and must not be tidied away, so it is stated on the enrolment card where
       somebody about to standardise the workflows will read it.
     · **The mail connection that stopped every send has been fixed.** A
       Customer 360 run at 19:46 came back `Gmail - Get Emails → ok`. A failure
       row is a fact about a moment, not a state, and this screen used to read
       one as "email delivery is broken right now" for as long as the row
       existed. It now checks the failure against what happened after it: a later
       run of a workflow that uses the same mailbox, completed successfully, is
       evidence the mailbox works again. Evidence, not a guarantee — audit_log
       records only runs that completed — and it is labelled as evidence. */
/* What a message is, and what an internal marker is. This screen used to decide
   it here — `message.startsWith('[SILENCE-ESCALATED]')`, the full string, with
   the channel never tested at all — which was one of the four private copies of
   the rule the header of lib/comm-events.js lists. That copy matched only the
   one marker spelling on file today: a `[SILENCE-WARNED]` row would have been
   drawn on this screen as a message to a customer and counted in no escalation
   figure. The library is a line-for-line mirror of
   `public.nexus_is_message(direction, channel, message)`. */
import { MARKER_PREFIXES, isInboundMessage, isMarkerText, isOutboundMessage, silenceCount, splitEvents } from '../lib/comm-events.js';
import { HOOK, db, myRole, n8n } from '../lib/data.js';
import { el } from '../lib/dom.js';
import { dealerText as vocabDealerText } from '../lib/vocabulary.js';
import { N8N_BASE } from '../lib/env.js';
import { aed, ago, clock, dubaiStamp, esc, n0, num, tone } from '../lib/format.js';
import { displayName, maskText } from '../lib/privacy.js';
/* The only place allowed to decide what an audit_log status means. This screen
   used to carry its own definition — `['FAILED', 'REJECTED'].includes(status)`
   — and then printed "Every logged drip run succeeded" of everything else,
   which is a false sentence over a PARTIAL row. */
import { OUTCOME, isIncomplete, isRefusal, isSuccess, outcomeOf, outcomeWords } from '../lib/health.js';
/* The only place allowed to decide whether two keys are the same person. This
   screen used to carry its own copy of that rule; see the block above
   `personCanon` for what the copy could not see. */
import { expandIdentity, normalizeKey } from '../lib/identity.js';
import { leadDrawer } from '../lib/lead-drawer.js';
import { BTN, openStitchModal, sectionHeader, statusChip, trustFooter } from '../lib/stitch-ui.js';
import { BANNER, SEG, segPaint, kpi, pill, stateEmpty, stateError, stateLoading, table, toneText } from '../lib/desk-kit.js';
import { SCREENS } from '../lib/nav.js';
import { wireRows } from '../lib/ui.js';

/* Bounded reads. An unbounded select is how a screen starts timing out once the
   dealership has a year of history behind it; where a cap is actually hit it is
   said out loud, because a truncated roster that looks complete is a lie about
   how many customers are mid-sequence. */
const LOG_LIMIT    = 1000;
const AUDIT_LIMIT  = 1000;
const ATTN_LIMIT   = 200;
const HEALTH_LIMIT = 200;
/* One row per person, so this is a ceiling on customers rather than on
   messages. It is read for one reason: to say how many people the messages
   belong to without counting distinct lead_email values, which over-counts. */
const CONV_LIMIT   = 200;

/* This screen's id in `v_needs_attention.screen`. */
const SCREEN_ID = 'campaigns';

/* The drip runs over seven days, on Wait nodes at day 1, day 3, day 5 and day 7.
   Used here only to say whether a lead's remaining steps are still queued —
   after seven days the sequence has run out on its own, which changes what an
   operator should do about a lead who replied halfway through. */
const SEQUENCE_DAYS = 7;

/* Why this workflow is the exception, said where somebody standardising the
   workflows will read it. The dashboard cannot read a workflow's timeout
   setting, so this is a stated fact with its provenance attached rather than a
   reading — and it is stated because "fixing" it would silently kill every
   enrolment four minutes into the first wait, with the webhook still returning
   200 and this screen still reporting people as enrolled. */
const NO_TIMEOUT_NOTE =
  'This is the one workflow in the system with no executionTimeout, and that is deliberate. This one\u2019s Wait nodes at '
  + 'day 1, day 3, day 5 and day 7 hold a single execution open for a week, so any ceiling would cut every enrolment off '
  + 'partway into the first wait — while the webhook still answered 200 and this screen still called the lead enrolled. '
  + 'Do not add one. There is no single house baseline to restore it to: of the other 20 workflows, 15 carry 300 s, '
  + 'Ask-AI \u2014 RAG Query Agent carries 120 s, Competitor Price Scraping carries 1200 s (raised from 300 on 30 Aug), and the '
  + 'three NEXUS Public pages carry 60 s. This banner said "every other workflow carries a five-minute ceiling" until '
  + '31 Aug 2026, when the 21 workflow JSONs were counted; it is addressed to whoever standardises them, which is exactly '
  + 'the reader who would have standardised on the wrong number. Counted from the workflow definitions this build was written '
  + 'against, not read live — the dashboard cannot read a workflow\u2019s timeout.';

/* Names shown inline on an alert before it collapses into "+N more". The row
   itself scrolls to and highlights the full set, so this is a glance. */
const PREVIEW = 4;

const low = s => String(s || '').trim().toLowerCase();
const up  = s => String(s || '').trim().toUpperCase();
const str = v => String(v == null ? '' : v).trim();
const ts  = v => { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; };
/* Asia/Dubai, labelled. A drip is scheduled by n8n on the showroom's clock, so
   the hour a campaign message went out has to be printed on that clock or the
   Day-1/Day-3/Day-7 cadence reads as if it fired at the wrong time of day. */
const stamp = v => dubaiStamp(v, 'no timestamp recorded');
const plural = (n, one, many) => (Number(n) === 1 ? one : many);
const muted = t => `<span class="text-outline">${esc(t)}</span>`;
const warn  = t => `<span class="text-amber-700">${esc(t)}</span>`;

/* A workflow run that proves the mailbox works. The bar is a MACHINE-WRITTEN
   step result naming the mailbox — the evidence that mattered on 24 Aug was a
   Customer 360 run reporting `Gmail - Get Emails → ok`, where the mailbox is
   named in the summary and not in the workflow's own name — or a workflow whose
   own name is the mailbox.

   Prose in a summary is not proof, and that is not a hypothetical. audit_log
   holds a Lead Escalation SUCCESS row from 30 Aug 02:39 whose summary is an
   AI-written recommendation ending "...and an email mirroring the same offer
   for record". The old test was /gmail|smtp|mailbox|e-?mail/i over workflow and
   summary together, so that paragraph read as proof the mail credential had
   recovered — eleven minutes after the same workflow logged `Escalation email
   failed: "Forbidden - perhaps check your credentials?"`. */
const MAILBOX_NAME_RE  = /gmail|smtp|mailbox/i;
const MAILBOX_PROOF_RE = /(gmail|smtp|mailbox|e-?mail)[^|·\n]{0,40}(?:→|->)\s*ok\b/i;

/* Resolve to [value, null] or [null, error] so one failed read cannot abort the
   others through Promise.all, and so every failure arrives as a fact the strip
   can print rather than as a rejection somebody has to catch again. */
const settle = p => p.then(v => [v, null], e => [null, e]);

/* Was a private severity map; lib/format.js now covers every vocabulary that
   reaches this screen. Kept as a name so the call sites read the same. */
const sevTone = s => tone(s);

/* Icons for the kinds the view can file against this screen. It files none
   today, so this map is a guess at nothing — the fallback is what renders, and
   the kind itself is printed as a chip so an unknown kind is still readable. */
const KIND_ICON = { workflow_failure:'error', campaign_stalled:'campaign', lead_unassigned:'person_alert' };

/* A WhatsApp chat handle. A LID carries no phone digits at all, so it
   identifies nobody and is never printed as a person's name. Leads are not
   supposed to carry one, but the router has written stranger things into
   `name`, and a handle rendered as a name is exactly the fault the 24 Aug
   addendum is about. */
const HANDLE = /@(lid|c\.us|s\.whatsapp\.net|g\.us)$/i;

/* Deliberately loose: enough to tell an address from a phone number or a name
   that landed in `lead_email`, not an RFC validator. Anything this rejects
   cannot be the destination of an email sequence, which is the only question
   being asked. */
const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/* And these are not addresses at all, however much they parse like one. The
   Master Router synthesises `+<digits>@whatsapp.lead` when a WhatsApp lead has
   no email — live lead 34 "Siva Thangavelu" carries exactly that string in
   `leads.email` — and `whatsapp.lead` contains a dot, so EMAILISH alone accepted
   it. That is not pedantry: such a lead was offered in the enrolment table with
   the Enrol button live, and the workflow's Gmail node would then have tried to
   send to it. The one question this pair is asked is whether a value can be the
   destination of an email sequence, and for a WhatsApp handle it is no.
   (`HANDLE` above answers a different question — whether a string is a chat
   handle being rendered as somebody's *name* — so the two stay separate.) */
const SYNTHETIC_ADDR = /@(whatsapp\.lead|lid|c\.us|s\.whatsapp\.net|g\.us)$/i;
const isRealEmail = v => { const k = low(v); return !!k && EMAILISH.test(k) && !SYNTHETIC_ADDR.test(k); };

/* What makes a `workflow_failure` row evidence about *email delivery* rather
   than about some other workflow: it has to name a credential problem and it
   has to name the mail transport. Both halves are required — "credential
   expired" on the WhatsApp session says nothing about the drip. */
const CREDENTIAL_RE = /credential|oauth|reconnect|re-?authenticat|invalid_grant|unauthori[sz]ed|401/i;
const MAILER_RE     = /gmail|smtp|e-?mail|sendgrid|mailer/i;

/* The drip has TWO send channels, not one, and counting only the first is how
   this screen came to print a red "The drip has sent nothing since it was
   started" beside a sentence claiming its own test was "as generous as it can be
   made". Read out of the workflow JSON on 31 Aug 2026:

     day 1  Email: Welcome (Gmail)      -> Log Welcome Email       channel 'email'
     day 1  WhatsApp: Welcome           -> Log WhatsApp Welcome    channel 'whatsapp'
     day 3  Email: Follow Up (Gmail)    -> Log Follow Up Email     channel 'email'
     day 5  WhatsApp: Check-in          -> Log WhatsApp Check-in   channel 'whatsapp'
     day 7  Email: Final Offer (Gmail)  -> Log Final Offer Email   channel 'email'

   /mail/i does not match 'whatsapp', so two of the five legs were discarded
   before the per-lead index was built. Both are counted now, and which channel
   a send was on is printed rather than averaged away.

   Every other channel stays excluded on purpose, `system` among them: by
   public.nexus_is_message() — mirrored in lib/comm-events.js — a message to a
   customer is on whatsapp, email or sms, and a row anywhere else is the
   dealership talking to itself. This is a statement about the two tests below
   and not about today's rows: `system` happens to carry only silence
   escalations on 1 Sep 2026, and the tests would still exclude it if it carried
   something else.

   communication_logs still records no workflow id, so a row the drip wrote
   cannot be told apart from one anything else wrote; the panels below say so
   rather than labelling all of it as drip output. */
const isMail     = c => /mail/i.test(String(c.channel || ''));
const isWhatsApp = c => /whats\s*-?app/i.test(String(c.channel || ''));
/* Which of the two to say out loud. Never averaged into "messages": a customer
   who got a WhatsApp and no email is a different situation from one who got
   both, and the operator's next move differs. */
const channelSummary = rows => {
  const m = rows.filter(isMail).length;
  const w = rows.filter(isWhatsApp).length;
  const bits = [];
  if (m) bits.push(`${num(m)} ${plural(m, 'email', 'emails')}`);
  if (w) bits.push(`${num(w)} ${plural(w, 'WhatsApp message', 'WhatsApp messages')}`);
  return bits.join(' and ');
};

/* ── One person, several keys. Resolved by lib/identity.js. ──────────────────
   `communication_logs.lead_email` is not an address, it is whichever key the
   writer happened to hold: a real address from the drip and the web form,
   `+<digits>@whatsapp.lead` and `<digits>@c.us` from the Master Router, and a
   bare `<digits>@lid` handle from WAHA. One person therefore sits under several
   values, and this screen used to read exactly one of them.

   Until 01 Sep 2026 the expansion was a private `keysFor()` here, written as an
   admitted duplicate while `lib/identity.js` was still on branch
   `frontend/identity-resolver`, with a comment saying it must not survive the
   resolver landing. It has landed: `lib/identity.js` is in this tree and five
   other modules read it — conversations.js, customers.js, deals.js, leads.js and
   lib/lead-drawer.js. The duplicate is deleted, and this screen now answers "is
   this the same person?" with the code they answer it with.

   That is not a tidying change; the two rules disagree on every lead in the
   database. Messages in `communication_logs` per lead, measured on the live
   database at 01 Sep 2026 14:18 UTC, private rule -> shared resolver:

     lead 38 Ali    shabbir53ujjainwala@gmail.com / +918517942172   27 -> 29
     lead 34 Siva   +971547484167@whatsapp.lead   / +971547484167    3 ->  8
     lead 35 Effco  email is the empty string     / +971505433953    0 -> 10

   Every one of those 17 extra rows is filed under a `@lid` handle and nothing
   else — 2 of Ali's under `158510264357112@lid`, 5 of Siva's under
   `155315328786434@lid`, all 10 of Effco's under `111948809162873@lid`. A LID
   carries no phone digits, so it can never be derived from a number; it is
   reached only through a `whatsapp_contacts` / `v_conversations` row that ties
   the handle to a phone, and `keysFor` had no way to read one. It skipped every
   `@lid` key by name — correctly, given what it had, because matching a machine
   id's tail against a phone number attaches a stranger's messages to a lead —
   and so found none of them. `convs` is passed in as `links` below, which is
   what supplies the bridge.

   Effco is the sharpest case and the reason 0 is in that table. `leads.email`
   for lead 35 is the EMPTY STRING, not null and not an address, so `keysFor`
   started from nothing, added the two phone-derived shapes no row is filed
   under, and matched zero of the ten messages that are demonstrably his.

   `expandIdentity` + `normalizeKey().canonical`, not `personFilter` /
   `personQuery`: those two build a PostgREST filter for a per-person read, and
   this screen issues none. It takes one bounded pass over communication_logs and
   matches in memory, so what it needs is the comparison form, not the query.
   That is the same shape screens/customers.js:556 and screens/leads.js:411 use.

   The rule is still not ours to choose. The n8n node `Resolve Lead Identity`
   (whatsapp_bdc_ai_agent.json) joins a chat to a lead on the LAST NINE DIGITS of
   the phone, every key in this column was written by a workflow that used that
   rule, and lib/identity.js is that rule — including its refusal to merge two
   leads whose numbers end in the same nine digits, which is why `leads` goes in
   as the candidate pool rather than being left out. */

/* Every canonical form this person's rows could be filed under. `canonical` is
   identity.js's comparison form: it collapses `@c.us`, `@s.whatsapp.net`,
   `@whatsapp.lead` and a bare number onto `phone:<last 9>` while keeping a LID
   as `lid:<digits>` and an address as `email:<address>`, so a LID whose digits
   happen to end like somebody's phone number can never compare equal to it. */
const personCanon = (seed, links, leads) => {
  const idn = expandIdentity(seed, { links: links || [], leads: leads || [] });
  return { identity: idn, canon: new Set((idn.keys || []).map(k => normalizeKey(k).canonical).filter(Boolean)) };
};
/* Every row filed under any canonical this person resolves to, newest first.
   Keyed on the canonical rather than on the raw string because the raw strings
   are what disagree: three of Ali's keys are one person and the index has to
   say so before the roster can count them together. */
const gather = (index, canon) => {
  const out = [];
  canon.forEach(c => { const rows = index.get(c); if (rows) out.push(...rows); });
  return out.sort((a, b) => ts(b.created_at) - ts(a.created_at));
};

/* The four gates run at the four Wait boundaries and nowhere else, so this is
   when a reply recorded now will actually end the sequence. Null once day 7 has
   gone by — by then it has run out on its own. */
/* ago() is backward-looking: its first branch is `d < 60`, and a future
   timestamp gives a negative d, so it renders the next gate as "just now" —
   the opposite of what it means. Forward-looking times get their own words. */
const inAbout = at => {
  const d = (at - Date.now()) / 1000;
  if (!Number.isFinite(d) || d <= 0) return 'now';
  if (d < 3600)  return `in about ${Math.max(1, Math.round(d / 60))} minutes`;
  if (d < 86400) return `in about ${Math.round(d / 3600)} hours`;
  return `in about ${Math.round(d / 86400)} days`;
};

const GATE_DAYS = [1, 3, 5, 7];
const nextGateAt = since => {
  if (!since) return null;
  const now = Date.now();
  for (const d of GATE_DAYS) { const at = since + d * 86400000; if (at > now) return at; }
  return null;
};

/* A deliberate exit, not a fault. `Stopped Report` is reached only from the
   false output of a `Still Enrolled? (Day N)` gate — the customer replied, or
   the lead went terminal — and it writes PARTIAL, because stopping always
   leaves the remaining steps unsent. The `Audit Log` node prefixes those
   summaries with "Stopped before <step> - "; a run that went the distance is
   prefixed "Completed - ". That prefix is the only thing in the row separating
   "the machine did the right thing" from "the machine dropped a step", and
   lib/health.js cannot draw it, because at the status level both are PARTIAL.
   So it is drawn here, once, and named at every call site. */
const STOPPED_PREFIX   = /^\s*stopped before\b/i;
const isDeliberateStop = a => outcomeOf(a) === OUTCOME.PARTIAL && STOPPED_PREFIX.test(String(a && a.summary || ''));

/* A run summary is written for whoever is on call, and whoever is on call is
   NEXUS. The Error Handler puts the execution's own URL, the failing node's
   name and the execution id into it — a workflow id, an execution id, a node
   name and a host, all four in CONTROL-PLANE.md Part 4's table. What the run
   was doing is the dealership's; where inside the system it stopped is not.
   Only the RENDERED text goes through here: every classifier on this screen
   reads the raw column, because redacting the evidence a verdict is computed
   from would change the verdict. The same function, worded the same way, is
   screens/automation.js's `dealerSummary`. */
/* One redactor, held in lib/vocabulary.js. Until 5 Sep 2026 this screen carried
   its own byte-similar copy, and so did two others — and all three stripped
   WHERE a run stopped (the URL, the node, the execution id, the host) while
   leaving WHO we buy from standing in the sentence. Measured by rendering: a
   failing mail credential printed the supplier's name and its API host to the
   dealership, who can act on neither. Three copies is how that divergence
   happened; there is now one. Only the RENDERED text goes through it — every
   classifier below reads the raw column, because redacting the evidence a
   verdict is computed from would change the verdict. */
const dealerText = vocabDealerText;
/* What is held against the workflow: FAILURE or PARTIAL, minus the deliberate
   stops. A customer who replied is not a failed run. */
const countsAgainst = a => isIncomplete(a) && !isDeliberateStop(a);

/* There is still no webhook that cancels an enrolment, and there no longer
   needs to be one. This used to be a disabled *Stop the sequence* button ending
   "Reply to these people by hand", which read as the operator being the last
   line of defence against a machine about to talk over a customer. The machine
   stops itself. The reply is the thing that needs a person. */
const SELF_STOPPING_NOTE =
  'There is no button here because there is nothing to stop: the workflow\u2019s own day-1/3/5/7 gates end the sequence at its '
  + 'next step. There is no cancel endpoint either — the only thing this dashboard can do is start a sequence — '
  + 'and this dashboard will not write straight into the record to fake one. Open the conversation and answer them.';

/* What the gates cannot see, stated because this screen leans on them to say a
   sequence stops itself. Each `Replies Since Enrol (Day N)` node builds its
   `or=` from the lead\u2019s email plus `<digits>@c.us` and
   `+<digits>@whatsapp.lead`, taking the digits from the phone on the leads row
   via `Lead State (Day N)`. So a reply filed only under a @lid handle, or a lead
   carrying no phone number, is invisible to the gate.

   Until 01 Sep 2026 this note also said the screen shared that blind spot, and
   it no longer does. lib/identity.js reaches a @lid through the
   whatsapp_contacts / v_conversations row that ties the handle to a phone, and
   the gate has no step that does. So the two now disagree, in one direction
   only: this screen can see a reply the gate cannot. That is the case where the
   sequence does NOT stop itself and SELF_STOPPING_NOTE would be wrong about it,
   which is why the divergence is printed rather than quietly enjoyed. */
/* The worked example that used to close this sentence — "on 01 Sep 2026 that
   bridge is the only thing attaching 17 of the 95 messages in
   communication_logs to a lead at all — 2 of Ali's 29, 5 of Siva's 8, and all
   10 of Effco's 10" — was three of THIS dealership's customers, by name, and
   three counts of their messages, frozen into a string literal. It rendered on
   every load of this screen for every signed-in user.

   Multi-tenancy landed on 2 Sep 2026, and a hard-coded sentence is the one
   thing RLS cannot scope: the second dealership on this database would read
   the first one's customer names in their own alert strip, above counts of
   messages that are not theirs and do not match anything they can open. The
   names are gone and the numbers with them — the divergence they illustrated
   is a property of the two lookup rules and is true without them. */
const GATE_BLIND_SPOT =
  'The gate builds its lookup from the lead\u2019s email plus the two WhatsApp key shapes it can derive from the phone number on '
  + 'the leads row, so a reply filed only under a @lid handle, or a lead with no phone number on it, is invisible to it. This screen '
  + 'is no longer blind to those rows: NEXUS’s identity rules bridges a @lid through the saved contact details / NEXUS row that ties '
  + 'the handle to a phone number, and the gate has no step that does. The two therefore '
  + 'disagree in one direction: a reply counted here may be one the gate cannot see, and a sequence the gate will not stop.';

/* n8n does not expose credential state to the browser directly. What the
   dashboard can see is the wreckage: a failure row in v_needs_attention and the
   drip workflow's health. Saying which it is matters, because the absence of a
   failure row is not the same as a working mailbox. */
const NOT_PROBED =
  'Nothing reports a connection\u2019s health to this dashboard directly, so this is read from failures the '
  + 'workflows recorded, not from the connection itself. No recorded failure is not proof that mail is going out.';

const FILTERS = [
  ['new', 'Not yet enrolled'],
  ['on',  'Enrolled'],
  ['all', 'All warm & cold'],
];

SCREENS.campaigns = async host => {
  /* `.ds-screen` is the class lib/design-system.css gates its handful of
     upgrades to existing chrome behind. It goes on a wrapper this screen
     appends, and NOT on `#screen`, because lib/nav.js empties `#screen` between
     renders without touching its classes: a class set there would follow the
     operator onto Leads or Money Leaks and restyle a screen nobody converted.
     A wrapper cannot leak — go() removes it with the rest of the subtree. Same
     pattern as screens/inventory.js, screens/leads.js, screens/overview.js,
     screens/money-leaks.js and screens/setup.js. */
  const root = el('div', 'nx-stitch flex flex-col gap-space-md');
  host.appendChild(root);

  /* ── The Stitch layout (7 Oct 2026) ─────────────────────────────────────
     design/stitch/campaigns-7-day-drip-outbound-telemetry--947632.html: needs
     attention, what this screen can answer, enrol a lead, who is enrolled,
     outbound mail (two columns) beside the silence detector (one column), and
     the activity stream. The summary strip under the alerts is this screen's
     own and is kept. The export's "Pause all active drips" and "New campaign
     rule" buttons are not drawn: no path exists to pause a workflow or to
     write a campaign rule from this dashboard, and a button that does nothing
     is worse than none. */
  const headHost = el('div');
  headHost.innerHTML = sectionHeader({ eyebrow: 'Work · Campaigns', title: 'Campaigns & Automated Drips',
    sub: 'The 7-day nurture sequence, what it has sent, and who has gone quiet.' });
  const alertCard  = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant/60 overflow-hidden shadow-sm');
  const strip      = el('div', 'grid grid-cols-2 lg:grid-cols-5 gap-space-md');
  /* With one drip-eligible lead — 3 leads on 01 Sep 2026, of which only 38 Ali
     is WARM — the list of questions this screen refuses to answer is more useful
     than anything it can answer, and each "no" is a specification: the column
     that is missing, and what would fill it. */
  const scopeCard  = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant/60 overflow-hidden shadow-sm');
  const enrolCard  = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant/60 overflow-hidden shadow-sm');
  const rosterCard = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant/60 overflow-hidden shadow-sm');
  const bento      = el('div', 'grid grid-cols-1 lg:grid-cols-3 gap-space-md items-start');
  const mailCard   = el('div', 'lg:col-span-2 rounded-xl bg-surface-container-lowest border border-outline-variant/60 overflow-hidden shadow-sm');
  const silenceCard  = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant/60 overflow-hidden shadow-sm');
  const activityCard = el('div', 'rounded-xl bg-surface-container-lowest border border-outline-variant/60 overflow-hidden shadow-sm');
  const footHost = el('div');
  bento.appendChild(mailCard); bento.appendChild(silenceCard);
  [headHost, alertCard, strip, scopeCard, enrolCard, rosterCard, bento, activityCard, footHost].forEach(n => root.appendChild(n));

  await boot();

  async function boot() {
    /* ── Loading ─────────────────────────────────────────────────────────── */
    alertCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant/60 flex flex-wrap items-center justify-between gap-space-sm"><div>
      <div class="font-headline-md text-headline-md text-on-surface">Needs attention</div>
      <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">The attention list for this screen, plus the checks this screen runs on the rows it just read</div>
    </div></div><div class="p-space-md" data-pbody>${stateLoading(3)}</div>`;
    strip.innerHTML = stateLoading(2);
    [scopeCard, enrolCard, rosterCard, mailCard, silenceCard, activityCard]
      .forEach(c => { c.innerHTML = stateLoading(5); });

    /* ── Alert-strip reads ───────────────────────────────────────────────────
       Started before the core read is awaited, so the whole screen costs one
       round of requests rather than one per alert.

       Why the whole view and not `?screen=eq.campaigns`: that filter returns
       nothing today, and the single row that decides whether this screen is
       telling the truth is filed against a *different* screen — a
       `workflow_failure` carrying the Gmail credential error. Reading the view
       once and splitting it here is one request, not two. Rows filed against
       campaigns are listed as this screen's alerts; the credential row is used
       only as evidence for the email-delivery alert and is labelled with the
       screen it actually belongs to, so nobody is told an automation row was
       raised about campaigns when it was not. */
    const attnRead = settle(db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen'
      + `&order=at.desc&limit=${ATTN_LIMIT}`));
    const healthRead = settle(db('v_workflow_health?select=name,category,'
      + 'is_active,writes_audit_log,runs,failures,success_rate,last_run,runs_30d,failures_30d,last_failure,health'
      + `&limit=${HEALTH_LIMIT}`));

    /* How many PEOPLE the messages belong to. Counting distinct
       communication_logs.lead_email would answer a different question and get it
       wrong in the direction that flatters the screen: the column holds an email
       when the lead is known and a WhatsApp handle when it is not, so one
       customer sits under several keys and would be counted as several
       customers. v_conversations was rebuilt on 24 Aug to resolve exactly that,
       one row per person, so it is asked instead of guessed at. */
    const convRead = settle(db('v_conversations?select=thread_key,chat_id,phone,push_name,lead_email,lead_name,'
      + 'display_name,identified,message_count,inbound_count,outbound_count,last_message_at,last_direction,awaiting_reply'
      + `&limit=${CONV_LIMIT}`));

    /* ── Core read ───────────────────────────────────────────────────────────
       One read feeds the strip, the roster, the mail log and the enrol table,
       so the four cannot contradict each other. If it fails, every region says
       so and offers a Retry that genuinely refetches. */
    let leads, comms, audit;
    try {
      [leads, comms, audit] = await Promise.all([
        db('leads?select=*,users(id,name)&order=created_at.desc&limit=1000'),
        db(`communication_logs?select=id,lead_email,direction,message,channel,created_at&order=created_at.desc&limit=${LOG_LIMIT}`),
        db(`audit_log?select=workflow,status,lead_name,lead_email,summary,logged_at&order=logged_at.desc&limit=${AUDIT_LIMIT}`),
      ]);
    } catch (e) {
      alertCard.querySelector('[data-pbody]').innerHTML = stateError('the alert strip', e);
      strip.innerHTML = stateError('the campaign summary', e);
      [['what this screen can answer', scopeCard], ['the enrolment list', enrolCard], ['the enrolment roster', rosterCard],
       ['the mail log', mailCard], ['the silence detector', silenceCard],
       ['campaign activity', activityCard]].forEach(([what, card]) => {
        card.innerHTML = stateError(what, e, 'reload');
        card.querySelector('[data-retry]')?.addEventListener('click', boot);
      });
      return;
    }

    const [attn, attnErr]     = await attnRead;
    const [health, healthErr] = await healthRead;
    const [convs, convsErr]   = await convRead;

    /* ── Which audit rows belong to the drip ─────────────────────────────────
       workflow_registry exists for exactly this mapping: `audit_name` plus
       `audit_aliases[]` tie a workflow's n8n name to the string it writes into
       audit_log. Reading it means the roster is not built on a guessed regex.
       Where the registry cannot be read, or holds no workflow this screen can
       recognise as a drip, the fallback is a name match on audit_log itself and
       the difference is stated on screen rather than hidden. */
    let registry = null;
    const notes = [];
    try {
      registry = await db('rpc/nexus_workflow_catalogue?select=name,audit_name,audit_aliases,category,is_active,writes_audit_log');
    } catch (e) {
      notes.push(`The automation register could not be read (${e.message}), so drip runs are matched on the workflow name instead of the registry's audit aliases.`);
    }

    /* The same test on both sources: a workflow is the drip if it is named or
       categorised as one. The webhook path would be the exact test and neither
       source can carry it — `trigger_detail` is a control-plane column, absent
       from `nexus_workflow_catalogue()`'s result type and not selected by
       `v_workflow_health` (CONTROL-PLANE.md 5.2; see `triggerReadable` in
       screens/automation.js). The clause that tested it sat first here, matched
       nothing on any row, and the captions downstream reported its failure as a
       finding about the register. Name and category are what this login may
       read, so they are the whole test and the captions now say so. */
    const looksLikeDrip = w => /drip|nurture|campaign/i.test(`${w.name || ''} ${w.category || ''}`);

    const dripFlows = (registry || []).filter(looksLikeDrip);
    const dripNames = new Set();
    for (const w of dripFlows) {
      [w.name, w.audit_name, ...(Array.isArray(w.audit_aliases) ? w.audit_aliases : [])]
        .filter(Boolean).forEach(n => dripNames.add(low(n)));
    }
    const matchedByRegistry = dripNames.size > 0;
    const isDrip = a => matchedByRegistry
      ? dripNames.has(low(a.workflow))
      : /drip|nurture/i.test(String(a.workflow || ''));

    if (registry && !matchedByRegistry) {
      notes.push('No row in the automation register is named or categorised as a drip, so runs are matched on the workflow name in the audit trail instead.');
    }
    /* An empty roster has two very different causes and they must not look
       alike: nobody enrolled, or the workflow never writes an audit row. */
    const instrumented = matchedByRegistry ? dripFlows.some(w => w.writes_audit_log) : null;
    const commsCapped = comms.length >= LOG_LIMIT;
    const auditCapped = audit.length >= AUDIT_LIMIT;
    if (commsCapped) notes.push(`Only the newest ${num(LOG_LIMIT)} messages were read, so older drip mail is not counted here.`);
    if (auditCapped) notes.push(`Only the newest ${num(AUDIT_LIMIT)} audit rows were read, so enrolments older than those are missing from the roster.`);

    /* ── Derive ──────────────────────────────────────────────────────────── */
    const dripRuns = audit.filter(isDrip);

    /* audit_log arrives newest first, so the first row seen for an address is
       the latest run and the last one seen is the original enrolment. */
    const roster = new Map();
    for (const a of dripRuns) {
      const k = low(a.lead_email);
      if (!k) continue;
      let r = roster.get(k);
      if (!r) { r = { key: k, email: a.lead_email, name: a.lead_name || null, runs: 0, failures: 0, stops: 0, last: a, first: a }; roster.set(k, r); }
      r.runs++;
      /* lib/health.js decides what the status means, and `countsAgainst` then
         removes the deliberate stops. A sequence that ended because the customer
         answered is the workflow working, and counting it as a failure against
         the lead is what `Stopped Report`'s own header comment warns about. */
      if (countsAgainst(a)) r.failures++;
      if (isDeliberateStop(a)) r.stops++;
      if (!r.name && a.lead_name) r.name = a.lead_name;
      r.first = a;                                   // overwritten until the oldest row wins
    }
    /* Indices, not ids: audit_log has no primary key in this select, and the
       activity list is what these alerts scroll to, so its row position is the
       only stable handle either side can agree on. */
    const unkeyedIdx  = dripRuns.map((a, i) => (low(a.lead_email) ? -1 : i)).filter(i => i >= 0);
    const nonEmailIdx = dripRuns.map((a, i) => {
      const k = low(a.lead_email);
      return (k && !isRealEmail(k)) ? i : -1;
    }).filter(i => i >= 0);
    /* Failures, stops and successes are three different things and the screen
       used to have a word for only the first. `countsAgainst` is FAILURE or
       PARTIAL minus the deliberate stops; `isDeliberateStop` is the gate doing
       its job; `isSuccess` is the only thing that licenses the word "succeeded".
       Everything left over — NO_RESULT, ENROLLED, UNKNOWN — is none of the three
       and is counted as such rather than being swept into the success branch. */
    const failedIdx  = dripRuns.map((a, i) => (countsAgainst(a) ? i : -1)).filter(i => i >= 0);
    const stoppedIdx = dripRuns.map((a, i) => (isDeliberateStop(a) ? i : -1)).filter(i => i >= 0);
    const successRuns = dripRuns.filter(isSuccess).length;
    const refusedRuns = dripRuns.filter(isRefusal).length;
    const otherRuns   = dripRuns.length - failedIdx.length - stoppedIdx.length - successRuns - refusedRuns;
    /* THE distinction the screen could not previously draw. All five drip rows
       live today were written by NEXUS Error Handler with lead_email NULL, so
       the roster loop skips every one of them and roster.size is 0 while
       dripRuns.length is 5. "No drip run has ever been logged" and "five runs
       are listed below" were both printed, 300 px apart. They are different
       facts and now have different names. Checked 01 Sep 2026 02:50 UTC:
       5 drip rows, 5 with lead_email NULL, 0 attributable. */
    const attributableRuns = dripRuns.length - unkeyedIdx.length;
    const runsButNobody    = dripRuns.length > 0 && roster.size === 0;

    /* Direction ALONE decided these three lists until 1 Sep 2026, which is the
       same body-blind hole screens/overview.js carried: a `[SILENCE-…]` row
       logged on channel 'whatsapp' satisfies `direction === 'outbound'` and was
       counted here as a message the drip had sent, and as a reply if it were
       ever written inbound. isOutboundMessage/isInboundMessage are
       lib/comm-events.js's mirror of public.nexus_is_message(), so all three
       tests — direction, channel and body — are applied once, in one place.
       On the live table (1 Sep 2026) both marker rows sit on channel 'system'
       and were already excluded by isMail/isWhatsApp below, so no figure on
       this screen moves today; the hole was in what would happen next. */
    const outbound = comms.filter(isOutboundMessage);
    const inbound  = comms.filter(isInboundMessage);
    /* isMail and isWhatsApp stay as they are and are deliberately NOT replaced
       by MESSAGE_CHANNELS. They ask a narrower question — which of the drip's
       two legs a send went out on — and /mail/i is wider than the library's
       exact 'email', so swapping them would silently drop a row logged on a
       channel spelled 'gmail'. isOutboundMessage above has already removed the
       rows that are not messages at all; these two only sort the rest. */
    const mail     = outbound.filter(isMail).sort((a, b) => ts(b.created_at) - ts(a.created_at));
    /* What the drip actually sends. Five legs, two channels: the day-1/3/7 Gmail
       sends and the day-1/day-5 WhatsApp sends, each with its own Log node
       writing channel 'email' or channel 'whatsapp'. Counting only /mail/i threw
       two of the five away and then called the result maximally generous. */
    const sends = outbound.filter(c => isMail(c) || isWhatsApp(c))
      .sort((a, b) => ts(b.created_at) - ts(a.created_at));
    /* Every distinct RAW key in communication_logs. Only for the sentence in
       identityNote that contrasts the raw column against v_conversations' person
       count — the matching below no longer walks this set looking for a phone
       tail, because lib/identity.js resolves a person's keys from the person. */
    const commKeys = new Set(comms.map(c => low(c.lead_email)).filter(Boolean));
    /* Indexed on identity.js's canonical form, not on the raw string. Three of
       Ali's keys are one person and the index has to say so before the roster
       can add them up; a row whose key canonicalises to nothing — a null, or the
       empty string lead 35 carries — identifies nobody and is dropped here
       rather than becoming a bucket everybody matches. */
    const canonOfRow = c => normalizeKey(c.lead_email).canonical;
    const indexBy = rows => {
      const m = new Map();
      for (const c of rows) {
        const k = canonOfRow(c);
        if (!k) continue;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(c);
      }
      return m;
    };
    const sendsBy   = indexBy(sends);
    const inboundBy = indexBy(inbound);
    /* canonical -> the raw lead_email values in communication_logs that collapse
       onto it. The roster says how many keys a person's messages were actually
       FOUND under, which is a fact about the database; the resolver's own key
       list also contains synthesised shapes nothing is filed under, and printing
       that count would overstate what was matched. */
    const rawKeysByCanon = new Map();
    for (const c of comms) {
      const k = low(c.lead_email);
      const cn = canonOfRow(c);
      if (!k || !cn) continue;
      if (!rawKeysByCanon.has(cn)) rawKeysByCanon.set(cn, new Set());
      rawKeysByCanon.get(cn).add(k);
    }
    const lastMail = mail[0] || null;
    const lastSend = sends[0] || null;

    /* ── The internal rows, and the silence escalations among them ──────────
       Two numbers, because they are two facts and this screen used to print one
       of them under the other's name.

       `internalRows` is everything communication_logs holds that is NOT a
       message to or from a customer — the taxonomy's own category, decided by
       lib/comm-events.js and therefore by nexus_is_message(). `silenceN` is how
       many of those the library can name as silence markers. Where the two
       differ, the panel is showing a row this screen cannot name, and it says
       so rather than labelling it an escalation.

       Before 1 Sep 2026 this line was
         comms.filter(c => String(c.message||'').startsWith('[SILENCE-ESCALATED]'))
       which tested one exact spelling and never the channel. Measured against
       the live table on 1 Sep 2026 both forms return 2 — the two escalations on
       channel 'system' — so nothing on screen moves today; the fix is
       structural. Add one `[SILENCE-WARNED]` row and the old test returns 2
       while this one returns 3. */
    const internalRows = splitEvents(comms).internal;
    const silenceN     = silenceCount(comms);
    /* Internal by channel or direction, but carrying no marker this library
       knows — a `system` row with an ordinary body is the live shape that would
       land here. Never zero by assumption: it is subtracted, and printed when
       it is not zero. */
    const unnamedInternal = internalRows.length - silenceN;
    /* Strip whichever marker a row actually carries, rather than the one
       spelling this screen used to hardcode. MARKER_PREFIXES holds the LIKE
       prefixes the database matches on — '[system]' is a whole token but
       '[SILENCE-' is deliberately short, so slicing the prefix off would leave
       "ESCALATED] Silent for 12h …" on screen. What is removed instead is the
       complete bracketed token the prefix identified, which is the same thing
       the old hardcoded `.replace('[SILENCE-ESCALATED]', '')` removed and works
       for a spelling nobody has written yet. A row whose body is only the
       marker leaves an empty string, and the panel then renders no detail line
       rather than a blank one. */
    const stripMarker = m => {
      const s = String(m || '');
      if (!MARKER_PREFIXES.some(x => s.startsWith(x))) return s.trim();
      const close = s.indexOf(']');
      return (close === -1 ? s : s.slice(close + 1)).trim();
    };

    const leadByEmail = new Map();
    leads.forEach(l => { const k = low(l.email); if (k && !leadByEmail.has(k)) leadByEmail.set(k, l); });
    roster.forEach(r => { if (!r.name) r.name = leadByEmail.get(r.key)?.name || null; });

    /* isRealEmail, not `low(l.email)`. The Master Router synthesises
       `+<digits>@whatsapp.lead` into `leads.email` for a WhatsApp lead with no
       address — live lead 34 "Siva Thangavelu" carries exactly that, checked
       01 Sep 2026 — and that string satisfies EMAILISH because `whatsapp.lead`
       contains a dot. Such a lead used to appear here with a live Enrol button,
       and the workflow's Gmail node would then have attempted a send to it. */
    const nurture  = leads.filter(l => ['WARM', 'COLD'].includes(up(l.status)));
    const eligible = nurture.filter(l => isRealEmail(l.email));
    /* Not "no email": a synthetic key, which is a third state and the one that
       used to be mistaken for an address. Kept separate so the alert can name
       the string rather than reporting these leads as simply unreachable. */
    const synthEmailLeads = nurture.filter(l => !isRealEmail(l.email) && low(l.email));
    /* There was a `notEnrolled` list here that nothing read — the enrolment
       table derives the same set inside visible() from the live filter. Removed
       rather than left as a second definition of "not enrolled" for the two to
       drift apart. */
    /* Warm and cold leads with no email at all. They never appear in the table
       below — the drip is addressed by email — so without this they are simply
       invisible on the screen that is supposed to be nurturing them. */
    const noEmailLeads = nurture.filter(l => !low(l.email));
    const unreachable  = noEmailLeads.concat(synthEmailLeads);
    const nurtureable  = nurture.length;
    const noEmailWithPhone = unreachable.filter(l => str(l.phone)).length;

    /* ── Who and what these rows actually are ────────────────────────────────
       Three descriptions of the data itself, each of which turns an empty panel
       from "no data" into a sentence naming what is missing and why. */
    const nLeads = leads.length;
    const statusMix = (() => {
      const m = new Map();
      leads.forEach(l => { const k = up(l.status) || 'UNSCORED'; m.set(k, (m.get(k) || 0) + 1); });
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${num(v)} ${k}`).join(', ');
    })();
    const channelMix = (() => {
      const m = new Map();
      comms.forEach(c => { const k = low(c.channel) || 'no channel recorded'; m.set(k, (m.get(k) || 0) + 1); });
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    })();
    const channelMixText = channelMix.length ? channelMix.map(([k, v]) => `${num(v)} ${k}`).join(', ') : 'none';

    /* How many PEOPLE, not how many keys. communication_logs.lead_email holds an
       email when the lead is known and a WhatsApp handle when it is not, so one
       customer sits under several values and a distinct count of that column
       reports more contacts than exist. v_conversations resolves it; where it
       could not be read, that is said rather than substituted for. */
    const personCount = convs ? convs.length : null;
    const identityNote = convsErr
      ? `NEXUS could not be read (${convsErr.message}), so how many people these ${num(comms.length)} messages belong to is not known here. `
        + 'The message history keys on the email on the lead record, which holds an email address when the lead is known and a WhatsApp handle when it is not, '
        + 'so counting distinct values in that column would over-count people rather than answer the question.'
      : personCount == null
        ? ''
        : (commsCapped
            ? `NEXUS resolves the whole of the message history to ${num(personCount)} ${plural(personCount, 'person', 'people')}; this screen read only the newest ${num(LOG_LIMIT)} messages of it`
            : `NEXUS resolves the ${num(comms.length)} ${plural(comms.length, 'message', 'messages')} read here to `
              + `${num(personCount)} ${plural(personCount, 'person', 'people')}`)
          + (commKeys.size > personCount
            ? `, filed in the message history under ${num(commKeys.size)} different the email on the lead record values. That column holds an email when the lead is known `
              + `and a WhatsApp handle when it is not, so the raw column looks like ${num(commKeys.size)} contacts and is ${num(personCount)}.`
            : '.');

    /* ── Per-enrolment evidence ──────────────────────────────────────────────
       Mail read is newest-first and capped. If it was capped, a lead enrolled
       before the oldest line we hold might have been mailed outside the window
       — so "nothing was sent to them" would be an accusation the data cannot
       support. Those enrolments are excluded from the zero-send check by name
       and counted, rather than being quietly reported as failures. */
    const commFloor = commsCapped ? ts(comms[comms.length - 1]?.created_at) : 0;
    const nowMs = Date.now();
    roster.forEach(r => {
      const since = ts(r.first.logged_at);
      r.since = since;
      r.lead = leadByEmail.get(r.key) || null;
      /* All of this person's keys, not just the one the drip was enrolled on.
         `convs` is v_conversations, and it is the links argument for one reason:
         it is the only thing here that ties a @lid handle to a phone number, and
         a LID cannot be derived from one. Where it could not be read the bridge
         is simply absent and the expansion is narrower — that is a real loss and
         it is not smoothed over, it is why convsErr is stated in identityNote.
         Without the lead row there is no phone number either, so the set
         collapses towards the single enrolment key, which the roster row says
         rather than silently producing a smaller count.

         `leads` is the candidate pool: two customers whose numbers end in the
         same nine digits are REPORTED by identity.js as a collision and left
         unmerged, instead of one person's drip history appearing in the other's
         row. There is no such collision in the database today — the three leads
         end 517942172, 547484167 and 505433953 — so this costs nothing now and
         is the difference between a wrong roster and an honest one later. */
      const resolved = personCanon(
        { leadId: r.lead && r.lead.id, email: r.key, phone: r.lead && r.lead.phone, name: r.name },
        convs || [], leads);
      r.identity = resolved.identity;
      r.canon    = resolved.canon;
      /* The raw keys actually carrying rows for this person, for the roster. */
      r.matchedKeys = new Set();
      r.canon.forEach(c => (rawKeysByCanon.get(c) || []).forEach(k => r.matchedKeys.add(k)));
      r.keyExpanded = r.matchedKeys.size > 1;
      r.sends   = gather(sendsBy, r.canon).filter(x => ts(x.created_at) >= since);
      r.mails   = r.sends.filter(isMail);
      r.waSends = r.sends.filter(isWhatsApp);
      r.replies = gather(inboundBy, r.canon).filter(x => ts(x.created_at) >= since);
      r.judgeable = since >= commFloor;
      /* Within the sequence window the remaining steps are still queued inside
         n8n; past it the sequence has run out by itself. The two need different
         actions from the operator, so they are not merged. */
      r.midSequence = since > 0 && (nowMs - since) < SEQUENCE_DAYS * 86400000;
      /* When a reply recorded now actually ends the sequence: at the next Wait
         boundary, because that is where the gate runs. Null past day 7. */
      r.nextGate = nextGateAt(since);
      r.addressable = isRealEmail(r.key);
    });
    const rosterAll   = [...roster.values()];
    const judgeable   = rosterAll.filter(r => r.judgeable);
    const unjudgeable = rosterAll.length - judgeable.length;
    /* Zero sends on EITHER channel. A lead who got both WhatsApp legs and no
       email has not been ignored by the drip, and used to be reported in red as
       having received nothing. */
    const zeroSend    = judgeable.filter(r => !r.sends.length)
      .sort((a, b) => a.since - b.since);
    const mailOnlyGap = judgeable.filter(r => r.sends.length && !r.mails.length);
    const replied     = rosterAll.filter(r => r.replies.length)
      .sort((a, b) => Number(b.midSequence) - Number(a.midSequence) || ts(b.replies[0].created_at) - ts(a.replies[0].created_at));
    const repliedMid  = replied.filter(r => r.midSequence);
    const unaddressable = rosterAll.filter(r => !r.addressable);

    /* Enrolments made in this browser session. Recorded only after a 2xx and
       always labelled as our own receipt — it is not a row in audit_log until
       the workflow puts one there. */
    const sent = new Map();

    /* ── Identity, in one place ──────────────────────────────────────────────
       The roster, the mail log, the silence list and the alert strip all key on
       an email address and nothing else, so the phone number has to be looked
       up on the leads table. Where no lead row matches the address the number
       is genuinely unknown, and the em dash says which of the two it is in its
       tooltip rather than leaving a blank that could mean either. */
    function nameHtml(name) {
      const n = str(name);
      if (!n) return '<span class="text-amber-700">Unnamed contact</span>';
      if (HANDLE.test(n)) {
        return '<span class="text-amber-700">Unnamed contact</span> '
          + `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap font-label-numeric-sm" title="This is a WhatsApp chat handle stored as a name, not a person's name. A LID contains no phone digits and identifies nobody.">${esc(n)}</span>`;
      }
      return esc(n);
    }
    const phoneHtml = (phone, lead) => str(phone)
      ? `<span class="font-label-numeric-sm">${esc(maskText(str(phone)))}</span>`
      : lead
        ? '<span class="text-outline" title="The lead row for this address carries no phone number">—</span>'
        : '<span class="text-outline" title="No lead row matches this address, so there is no phone number to look up">—</span>';

    function personOf(email, fallbackName) {
      const k = low(email);
      const lead = k ? leadByEmail.get(k) || null : null;
      return {
        lead,
        name: str(lead?.name) || str(fallbackName),
        email: str(email) || str(lead?.email),
        phone: str(lead?.phone),
      };
    }
    /* Name and number on one line, for the places that have no second line. */
    const personLine = p => `${nameHtml(p.name)} <span class="text-outline">·</span> ${phoneHtml(p.phone, p.lead)}`;

    const chipFor = p => p.lead
      ? `<button type="button" class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap" style="border:0;cursor:pointer;font-family:inherit" data-lead="${esc(p.lead.id)}"
          title="Open this lead">${personLine(p)}</button>`
      : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap" title="No lead row matches ${esc(maskText(p.email || 'this contact'))}, so there is nothing to open">${personLine(p)}</span>`;

    const previewOf = people => {
      const shown = people.slice(0, PREVIEW).map(chipFor).join(' ');
      const rest = people.length - Math.min(people.length, PREVIEW);
      return `${shown}${rest ? ` <span class="text-outline">+${num(rest)} more</span>` : ''}`;
    };

    /* ── Is email actually able to leave? ────────────────────────────────────
       Three states, and the difference between them is the whole point:
         broken   — a workflow recorded a mail-credential failure. Read verbatim.
         degraded — no credential row, but the drip workflow has failures inside
                    v_workflow_health's 30-day window.
         unknown  — nothing recorded. NOT the same as "working": the credential
                    itself is not readable from the browser. */
    const viewRowsAll   = (attn || []).slice().sort((a, b) => ts(b.at) - ts(a.at));
    const forThisScreen = viewRowsAll.filter(i => low(i.screen) === SCREEN_ID);
    const credFailures  = viewRowsAll.filter(i => low(i.kind) === 'workflow_failure'
      && CREDENTIAL_RE.test(`${str(i.title)} ${str(i.detail)}`)
      && MAILER_RE.test(`${str(i.title)} ${str(i.detail)}`));

    /* ── The screen held the evidence and asserted its absence. ───────────────
       v_needs_attention's workflow_failure branch is
       `WHERE a.status = 'FAILED' AND a.logged_at > now() - '24:00:00'`, so it
       ages a credential failure out after a day. This screen read only that view
       for credential evidence, and then printed "No mail-credential failure is
       recorded in v_needs_attention, so this is the workflow failing for some
       other reason" — while `audit`, already in hand two hundred lines above,
       held rows reading `The credential "Gmail OAuth2 API" needs to be
       reconnected · Failed at node: Email: Welcome (Gmail)`.

       Checked 01 Sep 2026 02:50 UTC: v_needs_attention carries no
       mail-credential row at all, and audit_log carries two of them, from
       17 Aug 14:21 and 23 Aug 04:28, both against the drip. From day two after
       any such failure the screen permanently blamed "some other reason" and
       downgraded the alert from CRITICAL to WARNING.

       Both sources are searched now, with the same two-part test — it must name
       a credential problem AND name the mail transport. The view row is the one
       that licenses the words "right now"; an audit row older than the view's
       window is evidence about the mailbox that nothing has since contradicted,
       which is a different and weaker sentence, and the alert says which it has. */
    const credLogged = audit
      .filter(a => outcomeOf(a) === OUTCOME.FAILURE
        && CREDENTIAL_RE.test(`${str(a.workflow)} ${str(a.summary)}`)
        && MAILER_RE.test(`${str(a.workflow)} ${str(a.summary)}`))
      .sort((a, b) => ts(b.logged_at) - ts(a.logged_at));
    /* One vocabulary over two shapes, so nothing downstream has to know which
       table a piece of evidence came from. */
    const credEvidence = [
      ...credFailures.map(i => ({
        at: i.at, detail: str(i.detail) || str(i.title), workflow: str(i.title),
        live: true, where: 'v_needs_attention', screen: str(i.screen),
      })),
      /* An audit summary is not a one-line detail the way a view row is: the
         Lead Escalation rows carry the whole AI-written escalation brief after
         the error, and printing it verbatim buries the alert under a page of
         sales advice. The error is at the front of the string, so the front of
         the string is what is shown, and it is marked as clipped. */
      ...credLogged.map(a => {
        const full = str(a.summary).replace(/\s+/g, ' ');
        return {
          at: a.logged_at,
          detail: full.length > 180 ? `${full.slice(0, 180)}…` : full,
          clipped: full.length > 180,
          workflow: str(a.workflow), live: false, where: 'audit_log', screen: '',
        };
      }),
    ].sort((a, b) => ts(b.at) - ts(a.at));
    const credLiveNow = credFailures.length > 0;

    const dripHealth = (health || []).filter(looksLikeDrip);
    const dripFail30 = dripHealth.reduce((s, w) => s + (n0(w.failures_30d) || 0), 0);
    const dripRun30  = dripHealth.reduce((s, w) => s + (n0(w.runs_30d) || 0), 0);
    const dripLastFailure = dripHealth.map(w => w.last_failure).filter(Boolean)
      .sort((a, b) => ts(b) - ts(a))[0] || null;
    /* last_run is the newest run of ANY status, which is exactly what makes it
       usable as evidence against a failure timestamp. */
    const dripLastRun = dripHealth.map(w => w.last_run).filter(Boolean)
      .sort((a, b) => ts(b) - ts(a))[0] || null;
    const dripOff = dripHealth.length
      ? dripHealth.every(w => w.is_active === false)
      : (dripFlows.length ? dripFlows.every(w => w.is_active === false) : false);

    /* A credential failure is a fact about a moment. Reading one as "broken
       right now" for as long as the row exists is how a fault fixed at 19:00
       still looks like an emergency at midnight — and this screen did exactly
       that until the Gmail credential was reconnected on 24 Aug and the banner
       stayed red. So the newest failure is checked against what happened after
       it: a later run of a workflow that touches the same mailbox, completed
       successfully, is evidence the mailbox works again.

       Evidence, not a clean bill of health. audit_log records only runs that
       COMPLETED, so a workflow hung on the mailbox right now leaves no row at
       all — which is why the wording below says what was observed rather than
       "email is working". */
    const newestCredFailure = credEvidence.length ? Math.max(...credEvidence.map(i => ts(i.at))) : 0;
    /* Proof has to be MACHINE-WRITTEN. `isSuccess` rather than a status string,
       and a step result naming the mailbox rather than any mention of mail:
       audit_log holds a Lead Escalation SUCCESS row from 30 Aug 02:39 whose
       summary is an AI-written recommendation ending "an email mirroring the
       same offer", eleven minutes after the same workflow logged
       `Escalation email failed: "Forbidden - perhaps check your credentials?"`.
       Verified 01 Sep 2026: that summary matches the old loose regex and does
       not match MAILBOX_PROOF_RE. A paragraph of advice is not a working
       mailbox. */
    const mailProof = newestCredFailure
      ? (audit.filter(a => isSuccess(a)
            && ts(a.logged_at) > newestCredFailure
            && (MAILBOX_PROOF_RE.test(str(a.summary)) || MAILBOX_NAME_RE.test(str(a.workflow))))
          .sort((a, b) => ts(b.logged_at) - ts(a.logged_at))[0] || null)
      : null;
    /* Four states, and 'broken' now covers evidence from either source. Which
       source it came from changes the wording, not the severity: a credential
       failure that nothing has contradicted is the last thing known about the
       mailbox whether or not a 24-hour view still lists it. `degraded` is now
       reachable only when NO credential evidence exists anywhere, which is what
       makes its "failing for some other reason" sentence true. */
    const delivery = credEvidence.length
      ? (mailProof ? 'recovered' : 'broken')
      : (dripFail30 > 0 ? 'degraded' : 'unknown');

    /* One sentence, used in the button titles and the confirm dialog. The
       dialog is where the irreversible click is taken, so it has to carry the
       same fact the strip carries — not a softer version of it. */
    const deliveryTitle = delivery === 'broken'
      ? (credLiveNow
          ? 'Email delivery is broken right now: a workflow recorded a mail credential failure in the last 24 hours. Enrolling queues the sequence, but no email leaves until the credential is reconnected.'
          : `The last thing recorded about this mailbox is a credential failure, ${ago(credEvidence[0].at)}, and nothing has succeeded on it since. `
            + 'It is out of the attention list\u2019s 24-hour window, so this is read from the activity log — evidence that the mailbox was dead and has not been shown working, not a live alarm. '
            + 'Enrolling queues the sequence; whether an email leaves is unproven.')
      : delivery === 'recovered'
        ? `The mail credential that stopped this drip has been reconnected: ${str(mailProof.workflow) || 'a later run'} completed successfully on the same mailbox at ${stamp(mailProof.logged_at)}, after the failure. `
          + 'Enrolling queues the sequence. That is evidence rather than a guarantee — only runs that completed are recorded.'
        : delivery === 'degraded'
          ? `The drip workflow logged ${dripFail30} ${plural(dripFail30, 'failure', 'failures')} in the last 30 days, so a queued sequence may not actually send.`
          : 'Enrolling queues the sequence with NEXUS. Whether the mail then leaves cannot be confirmed from this dashboard — no delivery fault is on record, but this screen cannot see the mail connection itself to check.';

    const deliveryEvidence = lastMail
      ? `The most recent outbound mail row in the message history was logged ${esc(ago(lastMail.created_at))} (${esc(stamp(lastMail.created_at))}).`
      : `No outbound mail row exists in the ${num(comms.length)} ${plural(comms.length, 'message', 'messages')} read, ever.`;

    const dripHealthLine = healthErr
      ? `The automation health figures could not be read (${esc(healthErr.message)}), so nothing here can say how the drip workflow itself is behaving.`
      : dripHealth.length
        ? `The automation health figures lists ${num(dripHealth.length)} drip ${plural(dripHealth.length, 'workflow', 'workflows')} `
          + `(${dripHealth.map(w => `<span class="font-label-numeric-sm">${esc(str(w.name) || 'unnamed')}</span> — ${esc(str(w.health) || 'no health state')}`).join(', ')}), `
          + `${num(dripRun30)} ${plural(dripRun30, 'run', 'runs')} and ${num(dripFail30)} ${plural(dripFail30, 'failure', 'failures')} in the last 30 days`
          + `${dripLastFailure ? `, most recent failure ${esc(ago(dripLastFailure))}` : ''}.`
          /* The same distinction overview.js draws: last_run is the newest run
             of any status, so when it is later than last_failure the workflow
             has completed a run since that failure and that run did not fail.
             Without this a fault fixed at 19:00 still reads as an emergency at
             midnight. It is evidence, not a clean bill — audit_log cannot record
             a run that hung, so an idle workflow and a stuck one look alike. */
          + (dripLastRun && dripLastFailure && ts(dripLastRun) > ts(dripLastFailure)
            ? ` It has completed a run since that failure, ${esc(ago(dripLastRun))}, and that run did not fail — evidence the fault is behind it rather than a clean bill of health.`
            : '')
        : 'No row in the automation health figures triggers on the lead-trigger webhook or is named as a drip, so the workflow behind this screen is not registered and its health cannot be reported.';

    /* ── Alerts ──────────────────────────────────────────────────────────────
       Every one of these is computed from rows already read above. `target` is
       the card the row scrolls to and `keys` the rows it highlights there; an
       alert with no target says why it cannot be opened instead of being a
       click that silently does nothing. */
    const alerts = [];

    if (delivery === 'broken') {
      const top = credEvidence[0];
      alerts.push({
        key: 'email',
        sev: 'CRITICAL',
        icon: 'unsubscribe',
        chip: 'email delivery',
        /* Same severity either way. What changes is the tense: a live view row
           licenses "right now", an aged-out audit row licenses "the last thing
           recorded". The screen used to have only the first sentence and no
           second source, so once the view aged the row out it printed the
           opposite claim instead. */
        title: credLiveNow
          ? 'Email delivery is broken right now — every “Enrolled” row on this screen means queued, not delivered'
          : 'The last thing recorded about the mailbox is a credential failure, and nothing has proved it working since',
        /* WAS: the verbatim text a workflow recorded, in a mono span. That
           string names the credential, quotes the provider's own error and
           sometimes names the node that raised it — CONTROL-PLANE.md 5.7 calls
           this out as the clearest illustration of the boundary rule, and it
           splits it exactly: theirs is "your drip campaign has not sent any
           email since 23 August, nothing reached a customer, we are on it";
           the credential's name and `invalid_grant` are the vendor's. The
           title above already carries the whole of the dealership's half, and
           the date is in `at`. So the quote goes and the consequence stays. */
        detailHtml: 'The connection this campaign sends email through is not working, and NEXUS is the only one who can restore it. '
          + 'What broke it, and where it is fixed, is on NEXUS\u2019s side. '
          /* Where the row is filed matters, and getting it wrong in either
             direction is a lie: claiming an automation row was raised about
             campaigns, or claiming a campaigns row belongs to somebody else. */
          + `Raised ${esc(ago(top.at))} by <span class="font-label-numeric-sm">${esc(top.workflow || 'an unnamed workflow')}</span>${top.live
            ? (!str(top.screen)
                ? ' and carried by the attention list'
                : low(top.screen) === SCREEN_ID
                  ? ' and filed by the attention list against this screen — it is listed above as well'
                  : ` and filed by the attention list against the <span class="font-label-numeric-sm">${esc(str(top.screen))}</span> screen, not this one; it is repeated here because every send step of the drip goes out through that same mailbox`)
            : '. The attention list no longer carries it — that view keeps a workflow_failure for 24 hours — so this is read from <span class="font-label-numeric-sm">The activity log</span>, which this screen had already loaded'}. `
          + `${credEvidence.length > 1
            ? `${num(credEvidence.length)} mail-credential ${plural(credEvidence.length, 'failure is', 'failures are')} recorded across the two sources, the oldest ${esc(ago(credEvidence[credEvidence.length - 1].at))}. `
            : ''}`
          + `${dripHealthLine} ${deliveryEvidence} `
          + 'Enrolling still works: it queues the sequence. '
          + 'The three email steps — day 1, day 3 and day 7 — cannot reach a customer until the credential is reconnected. '
          + 'The day-1 and day-5 WhatsApp steps go out over a different channel and are unaffected, so a lead with a phone number still hears something and a lead without one hears nothing at all.',
        target: mailCard,
        keys: null,
        hint: 'Show the outbound mail log',
      });
    } else if (delivery === 'degraded') {
      alerts.push({
        key: 'email',
        sev: 'WARNING',
        icon: 'error',
        chip: 'email delivery',
        title: `The drip workflow logged ${num(dripFail30)} ${plural(dripFail30, 'failure', 'failures')} in the last 30 days`,
        /* This sentence used to be printed while the screen held two rows saying
           the Gmail credential needed reconnecting, because it looked only in
           v_needs_attention and that view drops a failure after 24 hours. It is
           now reached only when BOTH sources come back empty, and it names them
           both so the next reader can see what was actually searched. */
        detailHtml: `${dripHealthLine} No mail-credential failure is recorded in the attention list, and none of the `
          + `${num(audit.length)} audit ${plural(audit.length, 'row', 'rows')} read names a credential problem on the mail transport either, `
          + 'so this is the workflow failing for some other reason. '
          + `${deliveryEvidence} ${esc(NOT_PROBED)}`,
        target: mailCard,
        keys: null,
        hint: 'Show the outbound mail log',
      });
    }

    if (replied.length) {
      const stale = replied.length - repliedMid.length;
      /* When the machine will act, so the operator is not left guessing whether
         they have to. The gates run only at the Wait boundaries. */
      const nextGate = repliedMid.map(r => r.nextGate).filter(Boolean).sort((a, b) => a - b)[0] || null;
      alerts.push({
        key: 'replied',
        /* WARNING, not CRITICAL, and it is a different alert. This used to be
           CRITICAL "they answered, and the sequence was still scheduled to talk
           over them", with a disabled Stop the sequence button whose tooltip
           ended "Reply to these people by hand" — i.e. the operator was told to
           make an emergency call to prevent something the workflow prevents by
           itself. What is actually wrong is that a customer is waiting for a
           person, which is a WARNING about a human being and not a CRITICAL
           about a runaway machine. */
        sev: 'WARNING',
        icon: 'reply',
        chip: 'waiting on a person',
        title: `${num(replied.length)} enrolled ${plural(replied.length, 'lead has', 'leads have')} replied and ${plural(replied.length, 'is', 'are')} waiting for an answer`,
        detailHtml: 'Each of these has at least one inbound row in the message history dated at or after their first drip run. '
          + 'The sequence is not going to talk over them: <span class="font-label-numeric-sm">7_day_warm_lead_drip_campaign.json</span> puts a '
          + '<span class="font-label-numeric-sm">Replies Since Enrol (Day N)</span> read and a <span class="font-label-numeric-sm">Still Enrolled? (Day N)</span> gate in front of '
          + `every one of its five sends, and the false branch of each gate goes to <span class="font-label-numeric-sm">Stopped Report</span>. `
          + (repliedMid.length
            ? `${num(repliedMid.length)} ${plural(repliedMid.length, 'was', 'were')} enrolled within the last ${SEQUENCE_DAYS} days, so ${plural(repliedMid.length, 'that sequence is', 'those sequences are')}" still running — `
              + `${nextGate
                ? `the next gate runs at ${esc(stamp(new Date(nextGate).toISOString()))}, ${esc(inAbout(nextGate))}, and stops it there. `
                : 'the next gate stops it at its next step. '}`
              + 'The gates also stop on a terminal lead status. '
            : '')
          + (stale
            ? `${num(stale)} ${plural(stale, 'was', 'were')} enrolled more than ${SEQUENCE_DAYS} days ago, so ${plural(stale, 'that sequence has', 'those sequences have')} run out on ${plural(stale, 'its', 'their')} own. `
            : '')
          + 'What is outstanding is the reply itself: nobody here has answered it. '
          + (commsCapped
            ? `The message read was capped at ${num(LOG_LIMIT)} rows, so a reply older than that would not be seen — this count can only be too low, never too high.`
            : `Counted across the ${num(comms.length)} ${plural(comms.length, 'message', 'messages')} read, across every key each person is filed under.`),
        peopleHtml: previewOf(replied.map(r => personOf(r.key, r.name))),
        /* No button. A disabled control implies the action is the right one and
           merely unavailable; here the action is not wanted. */
        footHtml: `<span class="font-body-sm text-body-sm text-on-surface-variant">${esc(SELF_STOPPING_NOTE)}</span>`,
        why: GATE_BLIND_SPOT,
        target: rosterCard,
        keys: new Set(replied.map(r => r.key)),
        hint: 'Show these people in the enrolment roster',
      });
    }

    if (zeroSend.length) {
      const allSilent = zeroSend.length === judgeable.length;
      alerts.push({
        key: 'zerosend',
        sev: 'CRITICAL',
        icon: 'mark_email_unread',
        chip: 'zero sends',
        title: allSilent
          ? `The drip has sent nothing on either channel since it was started — ${plural(judgeable.length, 'the single enrolment has', `all ${num(judgeable.length)} enrolments have`)} zero logged sends`
          : `${num(zeroSend.length)} of ${num(judgeable.length)} ${plural(judgeable.length, 'enrolment has', 'enrolments have')} zero logged sends on either channel`,
        /* "Either channel" is the whole correction. The drip sends five legs on
           two channels — Gmail on days 1, 3 and 7, WhatsApp on days 1 and 5,
           each with its own Log node writing channel 'email' or 'whatsapp' — and
           the old test was /mail/i, which does not match 'whatsapp'. A lead who
           received both WhatsApp legs was reported in red as having received
           nothing, beside a sentence calling the test maximally generous. */
        detailHtml: 'No outbound row on a mail <em>or</em> a WhatsApp channel exists in the message history at or after '
          + `${plural(zeroSend.length, 'this enrolment', 'these enrolments')}. `
          + `The oldest has been enrolled since ${esc(ago(zeroSend[0].first.logged_at))} (${esc(stamp(zeroSend[0].first.logged_at))}). `
          + 'The drip sends five steps across two channels — day 1, 3 and 7 by email and day 1 and 5 by WhatsApp — and both are counted. '
          + 'The message history records no workflow id, so <em>any</em> outbound row on either channel, filed under any key this person is known by, counts as a send here. '
          + 'Rows on any other channel are excluded — <span class="font-label-numeric-sm">system</span> is the one in this table — because by <span class="font-label-numeric-sm">NEXUS’s own test for what counts as a message</span> a message to a customer is on whatsapp, email or sms, and anything else is the dealership writing about a conversation rather than inside it. '
          + (delivery === 'broken'
            ? 'That is consistent with the credential failure above: the sequence is queueing and the mailbox is dead.'
            : delivery === 'recovered'
              ? 'The mail connection that would have explained this has since been checked and is working, so a dead mailbox no longer accounts for it. That makes it worth asking NEXUS to look at.'
              : 'Nothing above explains it, which makes it worth asking NEXUS to look at.')
          + (unjudgeable
            ? ` ${num(unjudgeable)} further ${plural(unjudgeable, 'enrolment is', 'enrolments are')} not judged by this check at all: ${plural(unjudgeable, 'it predates', 'they predate')} the oldest message this screen read, so mail sent to ${plural(unjudgeable, 'it', 'them')} could sit outside the ${num(LOG_LIMIT)}-row window.`
            : ''),
        peopleHtml: previewOf(zeroSend.map(r => personOf(r.key, r.name))),
        target: rosterCard,
        keys: new Set(zeroSend.map(r => r.key)),
        hint: 'Show these people in the enrolment roster',
      });
    }

    /* Two different faults that used to share one alert, and sharing it produced
       a false accusation. A run with NO lead_email is the error handler writing
       an anonymous record — nothing "enrolled a lead without checking it had an
       address" — and it is reported by the unattributable alert below. A run
       whose lead_email is a chat key rather than an address is the fault this
       alert is actually about, and only that one can be blamed on the enrolment. */
    if (nonEmailIdx.length || unaddressable.length) {
      const bad = Math.max(nonEmailIdx.length, unaddressable.length);
      alerts.push({
        key: 'unaddressed',
        sev: 'CRITICAL',
        icon: 'alternate_email',
        chip: 'not an address',
        title: `${num(bad)} drip ${plural(bad, 'run carries', 'runs carry')} a chat key in the email on the lead record rather than an email address`,
        detailHtml: `${num(nonEmailIdx.length)} ${plural(nonEmailIdx.length, 'run carries', 'runs carry')} a <span class="font-label-numeric-sm">The email on the lead record</span> that an email sequence cannot send to `
          + `(${unaddressable.slice(0, PREVIEW).map(r => `<span class="font-label-numeric-sm">${esc(maskText(r.email || r.key))}</span>`).join(', ')}${unaddressable.length > PREVIEW ? `, +${num(unaddressable.length - PREVIEW)} more` : ''}). `
          + 'A <span class="font-label-numeric-sm">+digits@whatsapp.lead</span> or <span class="font-label-numeric-sm">@lid</span> value parses like an address and is not one. '
          + 'Those runs cannot have delivered an email, and something upstream enrolled a lead without checking it had a real address.',
        target: activityCard,
        keys: new Set(nonEmailIdx.map(i => `run-${i}`)),
        hint: 'Show these runs in campaign activity',
      });
    }

    if (failedIdx.length) {
      alerts.push({
        key: 'failed',
        sev: 'CRITICAL',
        icon: 'error',
        chip: 'failed runs',
        title: `${num(failedIdx.length)} drip ${plural(failedIdx.length, 'run', 'runs')} failed or went out half-done`,
        /* Classified by lib/health.js, then with the deliberate stops removed.
           `['FAILED','REJECTED']` was the whole definition of failure here, which
           both missed PARTIAL and would have counted a sequence that stopped
           because the customer replied as a failure against the lead. */
        detailHtml: `Out of ${num(dripRuns.length)} drip ${plural(dripRuns.length, 'run', 'runs')} in the audit log`
          + `${stoppedIdx.length ? `, ${num(stoppedIdx.length)} of which stopped deliberately and ${plural(stoppedIdx.length, 'is', 'are')} not counted here` : ''}. `
          + 'Classified by NEXUS’s own rule for what a run achieved, applied in one place: a run counts against the workflow when it failed outright or went out half-done, and one stopped on purpose because the customer replied is the reply gate doing its job and is excluded. '
          + 'This is separate from whether the mail later went out.',
        target: activityCard,
        keys: new Set(failedIdx.map(i => `run-${i}`)),
        hint: 'Show these runs in campaign activity',
      });
    }

    /* The contradiction this screen used to print without noticing: five drip
       runs listed at the bottom of the page and "No drip run has ever been
       logged" in the headline KPI. Both were generated from the same array. The
       cause is that all five rows were written by NEXUS Error Handler, which
       records the workflow and the error but not the lead, so the roster loop
       skipped every one of them. It is now an alert in its own right, because a
       workflow whose only audit trail is anonymous is a real defect and not a
       rendering quirk. */
    if (unkeyedIdx.length) {
      alerts.push({
        key: 'unattributable',
        sev: 'WARNING',
        icon: 'person_off',
        chip: runsButNobody ? 'no lead on any run' : 'no lead on some runs',
        title: runsButNobody
          ? `${num(dripRuns.length)} drip ${plural(dripRuns.length, 'run is', 'runs are')} logged, and not one carries a lead this screen can attribute it to`
          : `${num(unkeyedIdx.length)} of ${num(dripRuns.length)} drip runs carry no lead, so ${plural(unkeyedIdx.length, 'it is', 'they are')} in no per-person figure on this screen`,
        detailHtml: `${runsButNobody
            ? `Every one of them has <span class="font-label-numeric-sm">The email on the lead record</span> NULL on the audit row, so the roster below is empty while campaign activity lists ${num(dripRuns.length)}. `
              + 'That is not "the campaign has never run" — it has run and nobody can be told who for. '
            : `${num(unkeyedIdx.length)} ${plural(unkeyedIdx.length, 'run has', 'runs have')} <span class="font-label-numeric-sm">The email on the lead record</span> NULL on the audit row. The roster below lists ${num(roster.size)} ${plural(roster.size, 'person', 'people')} and campaign activity lists ${num(dripRuns.length)} runs; the difference is these. `}`
          + `${dripRuns.filter(a => /error handler/i.test(str(a.workflow)) || /failed at node/i.test(str(a.summary))).length
            ? 'These rows were written by the error handler rather than by the drip\u2019s own <span class="font-label-numeric-sm">Audit: Enrolled</span> and <span class="font-label-numeric-sm">Audit Log</span> nodes, which do carry the lead — so a run that crashes before those nodes leaves an anonymous record. '
            : ''}`
          + 'The roster, the enrolment KPI and the activity panel below all say this the same way rather than three different ways.',
        target: activityCard,
        keys: new Set(unkeyedIdx.map(i => `run-${i}`)),
        hint: 'Show these runs in campaign activity',
      });
    }

    if (dripOff) {
      alerts.push({
        key: 'off',
        sev: 'CRITICAL',
        icon: 'toggle_off',
        chip: 'workflow off',
        title: 'Every registered drip workflow is switched off',
        detailHtml: (dripHealth.length ? 'v_workflow_health' : 'workflow_registry')
          + ' reports <span class="font-label-numeric-sm">is_active = false</span> on every workflow named or categorised as a drip. '
          + 'An enrolment posted from this screen would be accepted by the webhook and then picked up by nothing.',
        target: null,
        why: 'This is a workflow state, not a row on this screen. The Automation screen is where a workflow is switched back on.',
      });
    }

    if (unreachable.length) {
      alerts.push({
        key: 'noemail',
        sev: 'WARNING',
        icon: 'contact_page',
        chip: 'unreachable',
        title: `${num(unreachable.length)} warm or cold ${plural(unreachable.length, 'lead has', 'leads have')} no email address the drip can send to`,
        detailHtml: `Out of ${num(nurtureable)} warm and cold ${plural(nurtureable, 'lead', 'leads')} read here. `
          + (noEmailLeads.length
            ? `${num(noEmailLeads.length)} ${plural(noEmailLeads.length, 'carries', 'carry')} no address at all. `
            : '')
          /* The state that used to be invisible: a synthetic key that parses as
             an address. These leads were offered in the enrolment table with a
             live Enrol button, and the Gmail node would have attempted a send. */
          + (synthEmailLeads.length
            ? `${num(synthEmailLeads.length)} ${plural(synthEmailLeads.length, 'carries', 'carry')} a WhatsApp key in <span class="font-label-numeric-sm">The email on the lead record</span> rather than an address `
              + `(${synthEmailLeads.slice(0, PREVIEW).map(l => `<span class="font-label-numeric-sm">${esc(maskText(str(l.email)))}</span>`).join(', ')}${synthEmailLeads.length > PREVIEW ? `, +${num(synthEmailLeads.length - PREVIEW)} more` : ''}) — `
              + 'the Master Router synthesises those when a WhatsApp lead has no email, and they parse as addresses because the domain contains a dot. '
              + 'Until 31 Aug 2026 such a lead appeared in the table below with the Enrol button live, and the sequence would have tried to mail it. '
            : '')
          + 'The 7-day sequence is addressed by email, so these leads are excluded from the enrolment table below entirely — without this line they are simply invisible on the screen that is meant to be nurturing them. '
          + `${num(noEmailWithPhone)} of them ${plural(noEmailWithPhone, 'has', 'have')} a phone number, which is the only way anybody is reaching them today.`,
        peopleHtml: previewOf(unreachable.map(l => ({ lead: l, name: str(l.name), email: '', phone: str(l.phone) }))),
        target: null,
        why: 'These leads carry no address the drip can send to, so they do not appear in the enrolment table below and there is no row on this screen to scroll to.',
      });
    }

    /* ── Provenance. Every count above has to be explainable, including the
       ones that are missing. A read that failed is named, not silently folded
       into a smaller number. ─────────────────────────────────────────────── */
    const stripNotes = [
      attnErr
        ? `The attention list could not be read (${attnErr.message}), so anything NEXUS filed against this screen is missing from this strip — and the mail-connection failure it carries could not be checked either. Everything else above was computed here.`
        : forThisScreen.length
          ? `${num(forThisScreen.length)} ${plural(forThisScreen.length, 'row', 'rows')} above ${plural(forThisScreen.length, 'comes', 'come')} from the attention list filed against Campaigns.`
          : 'The attention list returned no row filed against Campaigns, so every alert above was computed on this screen from the rows it read.',
      healthErr
        ? `The automation health figures could not be read (${healthErr.message}), so the drip workflow's own health is missing from the email-delivery alert.`
        : '',
      delivery === 'unknown' ? `${NOT_PROBED} No mail-credential failure is recorded and the drip workflow logged no failure in the last 30 days.` : '',
      /* The good news, said once and with its evidence, so nobody has to
         remember whether last night's red banner was ever resolved. */
      delivery === 'recovered'
        ? `A mail credential failure is recorded in ${credEvidence[0].where} from ${ago(credEvidence[0].at)}, but it has been superseded: `
          + `${str(mailProof.workflow) || 'a later workflow run'} completed successfully on the same mailbox at ${stamp(mailProof.logged_at)}. `
          + `This screen therefore does not report email delivery as broken. ${NOT_PROBED}`
        : '',
      identityNote,
      /* Said whether or not the zero-send alert fired. Otherwise an enrolment
         the screen refused to judge would vanish from every count on the page
         without anybody being told it had been set aside. */
      unjudgeable
        ? `${num(unjudgeable)} ${plural(unjudgeable, 'enrolment is', 'enrolments are')} older than the oldest message this screen read, so whether anything was ever sent to ${plural(unjudgeable, 'them', 'them')} cannot be decided from the ${num(LOG_LIMIT)} rows read. ${plural(unjudgeable, 'It is', 'They are')} marked "not judged" in the roster and counted in no send figure above.`
        : '',
      /* The per-lead shape of a dead mailbox: WhatsApp went out, email did not.
         Worth saying separately from "nothing was sent", which is a different
         fault with a different first move. */
      mailOnlyGap.length
        ? `${num(mailOnlyGap.length)} ${plural(mailOnlyGap.length, 'enrolment has', 'enrolments have')} a logged WhatsApp send since enrolment and no logged email. That is the per-lead shape of a mail credential failure, and it is not counted as "nothing sent".`
        : '',
      /* Said once, because the roster, the reply KPI and the zero-send check all
         depend on it. The trigger used to be `some(r => !r.keyExpanded)` — a
         test for this screen's OWN expansion having collapsed to one key, which
         was the right question while the note was about this screen's blind
         spot. It is now about the divergence between the gate and lib/identity.js,
         and that divergence holds for every person on the roster regardless of
         how many keys any of them turned out to have. */
      rosterAll.length
        ? GATE_BLIND_SPOT
        : '',
      alerts.length > 1 ? 'A lead can satisfy more than one alert, so these counts overlap and do not add up to a total.' : '',
      ...notes,
    ].filter(Boolean);

    /* ── Render the strip ────────────────────────────────────────────────────
       Filled last, after the cards below exist, because the click handlers
       resolve `[data-key]` rows inside them. */
    const viewRowsHtml = forThisScreen.map(it => {
      const sev = str(it.severity);
      return `<div class="list-item" style="cursor:default">
        <span class="material-symbols-outlined ${toneText(sevTone(sev))}" style="font-size:20px" aria-hidden="true">${esc(KIND_ICON[low(it.kind)] || 'warning')}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${sev ? pill(sev, sevTone(sev), { verbatim: true }) : ''}${esc(str(it.title) || str(it.kind) || 'Attention item')}
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap">${esc(str(it.kind) || 'item')}</span>
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap" title="Raised by the attention list, the shared cross-screen alert view, not computed on this screen.">shared</span>
          </div>
          <div class="font-body-sm text-body-sm text-on-surface-variant" style="white-space:normal">${esc(str(it.detail) || 'The view recorded no detail for this row.')}</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant text-outline">${esc(str(it.ref) ? `Keyed on ${str(it.ref)} — ` : '')}${it.at
            ? `waiting since ${esc(stamp(it.at))}, ${esc(ago(it.at))}`
            : 'the view gave this item no timestamp, so how long it has been waiting is unknown'}</div>
        </div>
      </div>`;
    }).join('');

    const alertRowsHtml = alerts.map(a => `
      <div class="list-item"${a.target
          ? ` role="button" tabindex="0" data-alert="${esc(a.key)}" title="${esc(a.hint || 'Show the rows this is about')}"`
          : ' style="cursor:default"'}>
        <span class="material-symbols-outlined ${toneText(sevTone(a.sev))}" style="font-size:20px" aria-hidden="true">${esc(a.icon)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${pill(a.sev, sevTone(a.sev), { verbatim: false })}${esc(a.title)}
            ${a.chip ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap">${esc(a.chip)}</span>` : ''}
          </div>
          <div class="font-body-sm text-body-sm text-on-surface-variant" style="white-space:normal">${a.detailHtml}</div>
          ${a.peopleHtml ? `<div class="font-body-sm text-body-sm text-on-surface-variant" style="margin-top:6px">${a.peopleHtml}</div>` : ''}
          ${a.why ? `<div class="font-body-sm text-body-sm text-on-surface-variant text-outline" style="margin-top:4px">${esc(a.why)}</div>` : ''}
          ${a.footHtml ? `<div style="margin-top:8px;display:flex;align-items:center;flex-wrap:wrap">${a.footHtml}</div>` : ''}
        </div>
        ${a.target ? '<span class="material-symbols-outlined text-outline" style="font-size:18px" aria-hidden="true">chevron_right</span>' : ''}
      </div>`).join('');

    /* The honest empty case. Not a box with nothing in it: a sentence naming
       what was checked and what came back, so "no alerts" reads as a result
       rather than as a panel that failed to load.

       And with nobody enrolled it must not read as four checks passing. Four
       checks with nothing to judge is a different statement, and claiming
       "every enrolment has a logged send" of an empty roster is how a panel
       starts lying without anybody writing a false sentence. */
    /* Three different states, and the screen used to have wording for two. The
       middle one is the live one: runs exist, none can be attached to a person. */
    const checksLine = roster.size
      ? `Across the ${num(dripRuns.length)} drip ${plural(dripRuns.length, 'run', 'runs')} and ${num(comms.length)} `
        + `${plural(comms.length, 'message', 'messages')} read here: every judged enrolment has a logged send on one of the two channels, everyone who replied has been answered, `
        + 'every drip run carries a usable email address, and no run failed or went out half-done.'
      : runsButNobody
        ? `${num(dripRuns.length)} drip ${plural(dripRuns.length, 'run is', 'runs are')} logged in the ${num(audit.length)} audit ${plural(audit.length, 'row', 'rows')} read, and every one carries a NULL the email on the lead record, `
          + 'so there is nobody for these checks to judge. That is not the campaign being fine and it is not the campaign never having run — it is a campaign with no attributable record.'
        : `No drip run appears in the ${num(audit.length)} audit ${plural(audit.length, 'row', 'rows')} read, so nobody is enrolled and this screen's `
          + 'checks have nothing to judge — which is not the same as everything being fine. '
          + (eligible.length
            ? `${num(eligible.length)} ${plural(eligible.length, 'lead is', 'leads are')} eligible to enrol in the table below.`
            : 'No lead is eligible to enrol either, so there is nothing on this screen to start.');

    const nothingHtml = `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined ${attnErr ? 'text-amber-700' : roster.size ? 'text-emerald-700' : 'text-outline'}" style="font-size:20px" aria-hidden="true">${attnErr ? 'help' : roster.size ? 'task_alt' : 'inbox'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500">${attnErr
          ? 'Nothing this screen can check is wrong — but the shared alert view did not load'
          : roster.size
            ? 'Nothing on this screen needs attention right now'
            : runsButNobody
              ? 'The campaign has run, and none of its runs can be attached to a customer'
              : 'There is no campaign running for this screen to have anything wrong with'}</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant" style="white-space:normal">${attnErr
          ? 'The attention list could not be read, so anything the database itself would have raised — including the mail-credential failure that decides whether this screen can send at all — is unknown right now. '
          : delivery === 'recovered'
            ? 'The attention list returned no row filed against Campaigns. The mail-credential failure it still carries has been superseded by a later successful run on the same mailbox, so it is not raised here as a live fault. '
            : 'The attention list returned no row filed against Campaigns, and neither that view nor the audit rows read name a mail-credential failure. '}${esc(checksLine)}</div>
      </div>
    </div>`;

    const notesHtml = stripNotes.length ? `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined text-outline" style="font-size:18px" aria-hidden="true">info</span>
      <div class="font-body-sm text-body-sm text-on-surface-variant" style="white-space:normal">${stripNotes.map(esc).join('<br>')}</div>
    </div>` : '';

    /* ── Summary strip ───────────────────────────────────────────────────────
       Five counts and not one rate. The tile that used to sit here for failed
       runs has moved into the enrolment tile's subtitle to make room for the
       audience, because the audience is the number that decides what every
       other figure on this screen is allowed to claim: with one person in it,
       a percentage is a description of that person. */
    const failedRuns = failedIdx.length;
    /* "Every logged drip run succeeded" was the else-branch of a two-value test,
       so it was printed over PARTIAL, ENROLLED and NOT_EXECUTED rows alike. Only
       isSuccess licenses the word "succeeded"; a deliberate stop is reported as
       what it is; anything left is named as neither rather than counted as one. */
    const runOutcomeLine = [
      failedRuns ? `<span class="text-red-700">${num(failedRuns)} ${plural(failedRuns, 'run', 'runs')} failed or went out half-done</span>` : '',
      stoppedIdx.length ? muted(`${num(stoppedIdx.length)} ${plural(stoppedIdx.length, 'run', 'runs')} stopped deliberately — the customer replied or the lead went terminal`) : '',
      !failedRuns && successRuns === dripRuns.length && dripRuns.length
        ? muted('Every logged drip run succeeded')
        : successRuns
          ? muted(`${num(successRuns)} of ${num(dripRuns.length)} ${plural(dripRuns.length, 'run', 'runs')} succeeded outright`)
          : dripRuns.length ? muted('No run succeeded outright') : '',
      otherRuns > 0
        ? muted(`${num(otherRuns)} ${plural(otherRuns, 'run is', 'runs are')} neither a success nor a failure — enrolled, refused or logged with a status this system does not define`)
        : '',
    ].filter(Boolean).join('<br>');

    strip.innerHTML = [
      kpi('Campaign audience', num(eligible.length),
        [
          muted(eligible.length
            ? `${num(eligible.length)} of ${num(nLeads)} ${plural(nLeads, 'lead', 'leads')} on this dealership\u2019s books ${plural(eligible.length, 'is', 'are')} warm or cold with an email address`
            : nLeads
              ? `No lead on this dealership\u2019s books is warm or cold with an email address. By status they are ${statusMix}`
              : 'This dealership has no lead on its books at all'),
          unreachable.length
            ? warn(`${num(unreachable.length)} further warm or cold ${plural(unreachable.length, 'lead has', 'leads have')} no address the drip can send to`
                + (synthEmailLeads.length ? `, ${num(synthEmailLeads.length)} of ${plural(synthEmailLeads.length, 'which carries', 'which carry')} a WhatsApp key in the email column` : ''))
            : '',
          nLeads === 1
            ? warn('One lead on this dealership\u2019s books. A campaign audience of one person carries no rate, no segment and no comparison — see the panel below for what that rules out.')
            : '',
        ].filter(Boolean).join('<br>'),
        nLeads === 1 ? 't-warm' : ''),
      /* The headline that contradicted the rest of the page. It printed "No drip
         run has ever been logged" whenever roster.size was 0, including when
         dripRuns.length was 5 — the roster is built by lead_email and every one
         of those five rows has none. The count is people; the subtitle now says
         which of the three reasons a zero is a zero. */
      kpi('Leads enrolled', num(roster.size),
        roster.size
          ? `${num(dripRuns.length)} drip ${plural(dripRuns.length, 'run', 'runs')} in the audit log`
            + (attributableRuns < dripRuns.length
              ? `<br>${warn(`Only ${num(attributableRuns)} of them carry the email on the lead record; the other ${num(dripRuns.length - attributableRuns)} cannot be attached to anybody and are in no per-person figure here`)}`
              : '')
            + `<br>${runOutcomeLine}`
            + (zeroSend.length ? `<br><span class="text-red-700">${num(zeroSend.length)} with nothing sent on either channel since enrolment</span>` : '')
          : instrumented === false
            ? warn('The drip workflow does not write to the audit log, so enrolments cannot be counted')
            : runsButNobody
              ? warn(`${num(dripRuns.length)} drip ${plural(dripRuns.length, 'run is', 'runs are')} logged and every one has a NULL the email on the lead record, so no run can be attached to a person. `
                  + 'The campaign has run; who for is not recorded')
              : muted(eligible.length
                ? `No drip run has ever been logged. ${num(eligible.length)} ${plural(eligible.length, 'lead is', 'leads are')} eligible to start one on`
                : 'No drip run has ever been logged, and no lead is currently eligible to start one on')),
      kpi('Replied while enrolled', num(replied.length),
        replied.length
          ? [
              /* Not red any more, and not "still being sequenced". The gates stop
                 the sequence; what is open is the answer nobody has written. */
              warn(`${num(repliedMid.length)} still inside the ${SEQUENCE_DAYS}-day window — the next gate stops the sequence, the reply still needs a person`),
              muted('Counted across every key each person is filed under, not just the address they were enrolled on'),
            ].filter(Boolean).join('<br>')
          : roster.size
            ? muted('No enrolled lead has written back since being enrolled')
            : muted('Nobody is enrolled, so there is nothing to answer'),
        replied.length ? 't-warm' : ''),
      /* Counts what the drip actually sends. The tile used to read `mail.length`
         and so reported zero for a lead who had received both WhatsApp legs. */
      kpi('Outbound sends logged', num(sends.length),
        lastSend
          ? [
              muted(`${channelSummary(sends)} outbound`),
              muted(`Last one ${ago(lastSend.created_at)}`),
              mail.length ? '' : warn('None of them on a mail channel — every send logged here went out over WhatsApp'),
            ].filter(Boolean).join('<br>')
          : [
              muted(`Nothing on a mail or WhatsApp channel in the ${num(comms.length)} ${plural(comms.length, 'message', 'messages')} read`),
              muted(`Channels on those messages: ${channelMixText}`),
              delivery === 'broken' ? warn('Consistent with the mail credential failure above') : '',
            ].filter(Boolean).join('<br>'),
        lastSend ? '' : 't-hot'),
      /* The headline counts silence escalations specifically, because that is
         what the label says. Any other internal row in the same read is named
         on its own line instead of being silently added to this number — the
         two used to be the same figure only because the one marker spelling on
         file happened to be the only internal row there was. */
      kpi('Silence escalations', num(silenceN),
        [
          silenceN
            ? warn('Twelve hours with no reply')
            : muted('No lead has been escalated for going quiet'),
          unnamedInternal
            ? warn(`${num(unnamedInternal)} further internal ${plural(unnamedInternal, 'row is', 'rows are')} in this read that ${plural(unnamedInternal, 'is', 'are')} not a silence escalation — listed in the panel below, not counted here`)
            : '',
        ].filter(Boolean).join('<br>')),
    ].join('');

    /* ── What this screen can and cannot answer ──────────────────────────────
       Written as questions because that is how they arrive: somebody asks how
       the campaign is performing. Every "no" carries the column that is missing
       and what would fill it, so the panel reads as a specification rather than
       an apology — and so that nobody spends a week looking for an open rate
       that no part of this system has ever recorded.

       Every number in it is a count of rows read on this paint. */
    const scopeRow = (icon, cls, q, a) => `<div class="list-item" style="cursor:default;align-items:flex-start">
      <span class="material-symbols-outlined ${toneText(cls)}" style="font-size:20px" aria-hidden="true">${icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500">${esc(q)}</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant" style="white-space:normal">${esc(a)}</div>
      </div></div>`;

    const canAnswer = [
      ['Who has been enrolled, and when?',
        `From drip runs in the activity log: ${num(dripRuns.length)} ${plural(dripRuns.length, 'run', 'runs')} across ${num(roster.size)} ${plural(roster.size, 'person', 'people')}, `
        + `matched ${matchedByRegistry ? 'through the automation register\u2019s audit aliases' : 'on the workflow name'}. Each carries the status the workflow logged.`],
      ['What has actually been sent, and when?',
        `Every outbound row in the message history: ${num(comms.length)} ${plural(comms.length, 'message', 'messages')} read, `
        + `${num(sends.length)} of them outbound on a channel the drip uses (${num(mail.length)} mail, ${num(sends.length - mail.length)} WhatsApp). `
        + `The drip sends on both — days 1, 3 and 7 by email, days 1 and 5 by WhatsApp. Channels present: ${channelMixText}.`],
      ['Did the person answer after being enrolled?',
        'Inbound rows in the message history dated at or after their first drip run, gathered across every key that person is filed under — an address, a @c.us chat id and a +digits@whatsapp.lead key are all the same customer, matched on the last nine digits of the phone. '
        + 'This is the one question on this screen that changes what an operator should do in the next five minutes.'],
      ['Is the workflow itself failing?',
        healthErr
          ? 'Normally from the automation health figures over a 30-day window — but the view could not be read on this paint, so it is unknown right now rather than fine.'
          : dripHealth.length
            ? `From the automation health figures over a 30-day window: ${num(dripRun30)} ${plural(dripRun30, 'run', 'runs')}, ${num(dripFail30)} ${plural(dripFail30, 'failure', 'failures')}.`
            : 'Only if the workflow is registered. No row in the automation health figures triggers on the lead-trigger webhook or is named as a drip, so its health cannot be reported.'],
      ['Can mail leave at all?',
        delivery === 'broken'
          ? (credLiveNow
              ? 'Not right now — a workflow recorded a mail credential failure in the last 24 hours and nothing has succeeded on that mailbox since.'
              : 'Unproven, and the last evidence is bad: the most recent thing recorded about this mailbox is a credential failure, read from the activity log because the attention list keeps a failure for only 24 hours. Nothing has succeeded on it since.')
          : delivery === 'recovered'
            ? 'A credential failure is recorded, and a later run completed successfully on the same mailbox — evidence that it works again, read from what the workflows logged rather than from the credential itself.'
            : 'Only as far as the wreckage shows. Nothing reports a connection\u2019s state to this dashboard directly, so the absence of a recorded failure is not proof that mail is going out.'],
    ];

    const cannotAnswer = [
      ['What is the open rate? The click rate?',
        'Nothing NEXUS records an open, a click or an unsubscribe. Mail sent this way leaves no event behind and there is nowhere for one to be recorded, so this is not a figure that is missing — it is a figure that has never existed here. It would take a way of sending mail that reports opens and clicks back to NEXUS.'],
      ['How many of the sends actually arrived?',
        'A row in the message history is written by the workflow after it hands the message off. There is no provider message id, no bounce and no delivery status on the row, so a row means "the workflow logged a send" and never "it arrived". A delivery status column, written from the provider\u2019s webhook, is what would answer it.'],
      ['Which campaign did this message belong to?',
        'The message history carries no workflow id and no campaign id, so a day-3 drip mail and a hand-typed reply are the same shape to every query this screen can write. Every drip figure here is therefore "an outbound message on a mail OR a WhatsApp channel at or after the enrolment" — both legs of the sequence are counted, which is what the panels above say and what the code does; the wording here said "a mail channel" until 1 Sep 2026 and named half the test its own branch applies. Deliberately generous, and impossible to narrow with the columns that exist. A workflow_id on the message history, written by the sending workflow, would fix it.'],
      ['How does this campaign compare with the others?',
        `${dripFlows.length || dripHealth.length ? `There is ${num(Math.max(dripFlows.length, dripHealth.length))} drip ${plural(Math.max(dripFlows.length, dripHealth.length), 'sequence', 'sequences')} registered` : 'No drip sequence is registered'}, and no per-campaign attribution to compare with even if there were more. A comparison would need both: a second campaign, and a column that says which one a message came from.`],
      ['What is the send rate, the reply rate, the conversion rate?',
        (identityNote ? identityNote + ' ' : '')
        + `The audience is ${num(eligible.length)} ${plural(eligible.length, 'person', 'people')}. A percentage over one audience member is that audience member, so no rate is printed anywhere on this screen — the counts above are counts.`],
    ];

    scopeCard.innerHTML = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant/60 flex flex-wrap items-center justify-between gap-space-sm"><div>
        <div class="font-headline-md text-headline-md text-on-surface">What this screen can answer</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">And what it cannot, with the column that is missing and what would fill it</div>
      </div></div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-space-md items-start" style="gap:0">
        <div>
          <div class="font-table-header text-table-header uppercase text-outline tracking-wider font-semibold" style="padding:14px 16px 6px">Answered from the data</div>
          ${canAnswer.map(([q, a]) => scopeRow('check_circle', 'ok', q, a)).join('')}
        </div>
        <div>
          <div class="font-table-header text-table-header uppercase text-outline tracking-wider font-semibold" style="padding:14px 16px 6px">Not answerable here</div>
          ${cannotAnswer.map(([q, a]) => scopeRow('do_not_disturb_on', 'muted', q, a)).join('')}
        </div>
      </div>`;

    /* ── Enrol a lead ─────────────────────────────────────────────────────── */
    const blockedGlobal = !N8N_BASE
      ? 'This deployment is not configured to reach the automation service, so nothing can be started from here. Only NEXUS can change that.'
      : null;

    enrolCard.innerHTML = `
      <div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant/60 flex flex-wrap items-center justify-between gap-space-sm">
        <div>
          <div class="font-headline-md text-headline-md text-on-surface">Enrol a lead in the 7-day drip</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Four waits — day 1, day 3, day 5 and day 7 — held open inside one run across the following week, never sent by this browser.
            Warm and cold leads that have an email address. Any other lead can be enrolled from the Leads screen.</div>
        </div>
      </div>
      <div class="flex items-start gap-2.5 p-space-sm rounded-lg border border-sky-200 bg-sky-50/60 text-sky-950 font-body-sm text-body-sm" style="margin:14px 20px 0">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">timer_off</span>
        <div>${esc(NO_TIMEOUT_NOTE)}</div>
      </div>
      <div class="flex flex-wrap items-center gap-space-sm px-space-md py-3 border-b border-outline-variant/30">
        <div class="flex flex-wrap items-center gap-1.5" id="cpSeg" role="group" aria-label="Filter leads by enrolment">
          ${FILTERS.map(([k, label], i) => `<button type="button" data-f="${k}" class="${i === 0 ? SEG.on : SEG.off}"
            aria-pressed="${i === 0 ? 'true' : 'false'}">${esc(label)}</button>`).join('')}
        </div>
        <div class="flex-1 min-w-[200px]">
          <label class="sr-only" for="cpQ">Search leads</label>
          <input class="w-full px-3 py-2 bg-surface-container-lowest border border-outline-variant rounded font-body-sm text-body-sm text-on-surface focus:ring-1 focus:ring-primary focus:border-primary outline-none shadow-sm disabled:bg-surface-container-low disabled:text-outline" type="search" id="cpQ" placeholder="Search name, email, phone or vehicle" />
        </div>
        <div class="text-outline tabular-nums" id="cpCount"></div>
      </div>
      <div id="cpTable"></div>`;

    const qBox   = enrolCard.querySelector('#cpQ');
    const countEl = enrolCard.querySelector('#cpCount');
    const tableHost = enrolCard.querySelector('#cpTable');
    let filter = 'new', q = '';

    const cols = [
      /* Name and number together: almost every alert on this screen resolves to
         "phone them", and a roster that only carries an email address makes the
         operator go and look the number up somewhere else. */
      { label:'Lead', strong:true, render: l => `${nameHtml(l.name)} <span class="text-outline">·</span> ${phoneHtml(l.phone, l)}
          <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(maskText(str(l.email)))}</div>` },
      { label:'Status', render: l => pill(l.status || 'NEW', undefined, { verbatim: !!l.status }) },
      { label:'Interest', render: l => `<span class="text-on-surface-variant">${esc(l.vehicle_interest || '—')}</span>` },
      /* budget_aed is NULL for router-created leads. A zero here would understate
         the value of the people being nurtured, so it stays a dash. */
      { label:'Budget', align:'r', render: l => n0(l.budget_aed) == null ? '<span class="text-outline">—</span>' : aed(l.budget_aed) },
      { label:'Score', align:'r', render: l => n0(l.ai_score) == null ? '<span class="text-outline">—</span>' : num(l.ai_score) },
      { label:'Enrolment', render: l => {
          const r = roster.get(low(l.email));
          const mine = sent.get(low(l.email));
          const bits = [];
          if (r) {
            bits.push(`${pill('Enrolled', 'ok', { verbatim: false })} <span class="font-body-sm text-body-sm text-on-surface-variant">${esc(ago(r.first.logged_at))} · ${num(r.runs)} ${plural(r.runs, 'run', 'runs')}</span>`);
            if (r.replies.length) bits.push(`<div class="font-body-sm text-body-sm text-on-surface-variant text-amber-700">Replied ${esc(ago(r.replies[0].created_at))} — ${r.midSequence ? 'the next gate stops the sequence; the reply is waiting for a person' : 'after the sequence had finished'}</div>`);
            if (r.judgeable && !r.sends.length) bits.push('<div class="font-body-sm text-body-sm text-on-surface-variant text-red-700">Nothing sent on either channel since enrolment</div>');
            else if (r.judgeable && !r.mails.length) bits.push(`<div class="font-body-sm text-body-sm text-on-surface-variant text-amber-700">${esc(channelSummary(r.sends))} since enrolment, no email among them</div>`);
            if (r.failures) bits.push(`<div class="font-body-sm text-body-sm text-on-surface-variant text-red-700">${num(r.failures)} failed or went out half-done</div>`);
            if (r.stops) bits.push(`<div class="font-body-sm text-body-sm text-on-surface-variant text-outline">${num(r.stops)} stopped on purpose by the reply gate</div>`);
          }
          if (mine) bits.push(`<div class="font-body-sm text-body-sm text-on-surface-variant text-emerald-700">Queued ${esc(ago(mine))} · this session, not yet in the audit log</div>`);
          if (!bits.length) bits.push('<span class="text-outline">Not enrolled</span>');
          return bits.join('');
        } },
      { label:'', align:'r', render: l => {
          const title = blockedGlobal || deliveryTitle;
          return `<button class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container transition-colors font-body-sm text-body-sm text-on-surface font-semibold disabled:text-outline disabled:cursor-not-allowed" data-enrol="${esc(l.id)}"
            aria-label="Enrol ${esc(displayName(str(l.name) || str(l.email), l.id))} in the 7-day drip"
            title="${esc(title)}"${blockedGlobal ? ' disabled' : ''}>Enrol</button>`;
        } },
    ];

    function visible() {
      const base = filter === 'on'  ? eligible.filter(l => roster.has(low(l.email)))
                 : filter === 'new' ? eligible.filter(l => !roster.has(low(l.email)))
                 : eligible;
      if (!q) return base;
      return base.filter(l => `${l.name || ''} ${l.email || ''} ${l.phone || ''} ${l.vehicle_interest || ''}`.toLowerCase().includes(q));
    }

    function drawTable() {
      const rows = visible();
      countEl.textContent = `${rows.length} of ${eligible.length} warm & cold leads`;
      tableHost.innerHTML = eligible.length
        ? table(cols, rows, {
            onRow: true,
            empty: stateEmpty(
              q ? 'No lead matches this search' :
              filter === 'new' ? 'Every eligible lead is already enrolled' : 'No eligible lead is enrolled yet',
              q ? 'Try a different search term or another filter.'
                : filter === 'new' ? 'Every warm and cold lead with an email address already has a drip run in the audit log.'
                : 'No warm or cold lead has a drip run recorded against it.',
              q ? 'search_off' : 'campaign'),
          })
        /* Not "no data". Which leads exist, what they are, and the exact
           condition a lead has to meet before it appears here. */
        : stateEmpty('No lead can be enrolled in the drip right now',
            nLeads
              ? `The drip is addressed by email and nurtures warm and cold leads only. By status this dealership\u2019s leads are `
                + `${statusMix}${unreachable.length ? `, and ${num(unreachable.length)} of the warm or cold ones ${plural(unreachable.length, 'has', 'have')} no address the drip can send to` : ''}. `
                + 'A lead appears in this table when the router scores it WARM or COLD and carries a real email address — a synthesised '
                + '+digits@whatsapp.lead key is not one, and a lead holding one is listed in the alert strip above rather than offered here.'
              : 'This dealership has no lead on its books at all. Leads arrive from the WhatsApp router and the web form; this table fills as soon as one is scored warm or cold with an email address on it.',
            'campaign');
      wireRows(tableHost, rows, leadDrawer);
      tableHost.querySelectorAll('button[data-enrol]').forEach(b => b.addEventListener('click', ev => {
        /* The row opens the lead drawer; the action button must not do both. */
        ev.stopPropagation();
        const lead = rows.find(r => String(r.id) === b.dataset.enrol);
        if (lead) confirmEnrol(lead);
      }));
    }

    enrolCard.querySelectorAll('#cpSeg button').forEach(b => b.addEventListener('click', () => {
      filter = b.dataset.f;
      enrolCard.querySelectorAll('#cpSeg button').forEach(x => {
        const on = x === b;
        segPaint(x, on);
      });
      drawTable();
    }));
    qBox.addEventListener('input', e => { q = low(e.target.value); drawTable(); });
    drawTable();

    /* One confirm step, then one unambiguous outcome. The dialog stays open on
       failure carrying the error verbatim, because "it didn't work" without the
       reason sends the operator into n8n's execution list to guess.

       The delivery warning is repeated here on purpose: this is where the
       irreversible click is taken, and it now carries the live state rather
       than a sentence that was true when the file was written. */
    function confirmEnrol(lead) {
      const existing = roster.get(low(lead.email));
      const m = openStitchModal({ title: 'Enrol in the 7-day drip', wide: true, bodyHtml: `<div class="flex flex-col gap-space-sm">
        <div class="${BANNER[delivery === 'broken' ? 'hot' : delivery === 'recovered' ? 'info' : 'warm']}">
          <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">unsubscribe</span>
          <div>${esc(deliveryTitle)}</div>
        </div>
        ${existing ? `<div class="flex items-start gap-2.5 p-space-sm rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm">
          <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">repeat</span>
          <div>This lead is already enrolled — first run logged ${esc(ago(existing.first.logged_at))}, ${num(existing.runs)} ${plural(existing.runs, 'run', 'runs')} in total.
            Enrolling again starts a second sequence; the workflow does not de-duplicate.
            ${existing.replies.length ? `They replied ${esc(ago(existing.replies[0].created_at))} — enrolling them again means answering that reply with an automated welcome message.` : ''}</div>
        </div>` : ''}
        <p class="font-body-sm text-body-sm text-on-surface-variant my-space-sm">The sequence waits at day 1, day 3, day 5 and day 7, held open by NEXUS across
          the following week — this browser sends nothing and records nothing itself.</p>
        <dl class="grid grid-cols-[minmax(8rem,max-content)_1fr] gap-x-space-md gap-y-1.5 font-body-sm text-body-sm [&>dt]:text-outline [&>dd]:text-on-surface">
          <dt>Lead</dt><dd>${nameHtml(lead.name)}</dd>
          <dt>Phone</dt><dd>${phoneHtml(lead.phone, lead)}</dd>
          <dt>Email</dt><dd>${esc(maskText(str(lead.email)))}</dd>
          <dt>Vehicle</dt><dd>${esc(lead.vehicle_interest || '—')}</dd>
          <dt>Status</dt><dd>${pill(lead.status || 'NEW', undefined, { verbatim: !!lead.status })}</dd>
          <dt>AI score</dt><dd>${n0(lead.ai_score) == null ? '<span class="text-outline">Not scored</span>' : num(lead.ai_score)}</dd>
        </dl></div>`,
        footHtml: `<button type="button" class="${BTN.secondary}" id="cpCancel">Cancel</button>
         <button type="button" class="${BTN.primary}" id="cpGo">${existing ? 'Enrol again' : 'Enrol this lead'}</button>` });

      const goBtn = m.wrap.querySelector('#cpGo');
      const cancel = m.wrap.querySelector('#cpCancel');
      goBtn.focus();
      cancel.addEventListener('click', m.close);
      goBtn.addEventListener('click', async () => {
        const label = goBtn.textContent;
        goBtn.disabled = true; cancel.disabled = true; goBtn.textContent = 'Enrolling…';
        m.msg('<span class="text-outline">Calling the lead-trigger workflow…</span>');
        try {
          /* These three field names are not a free choice. Normalize Lead Input
             inside the workflow reads exactly these, and a dashboard/workflow
             vocabulary mismatch is what kept the drip at zero successful runs
             before — so it is written once, here, and matches what the Leads
             screen posts to the same hook. */
          await n8n(HOOK.warmDrip, {
            lead_email: lead.email,
            lead_name: lead.name || '',
            vehicle_interest: lead.vehicle_interest || '',
          });
          sent.set(low(lead.email), new Date().toISOString());
          goBtn.textContent = 'Enrolled';
          cancel.disabled = false; cancel.textContent = 'Close';
          m.msg('<span class="text-emerald-700">The workflow accepted the enrolment.</span> '
              + `<span class="${delivery === 'broken' ? 'text-red-700' : 'text-amber-700'}">${esc(deliveryTitle)}</span>`);
          drawTable();
        } catch (e) {
          goBtn.disabled = false; cancel.disabled = false; goBtn.textContent = label;
          m.msg(`<span class="text-red-700">Nothing was enrolled — ${esc(e.message)}</span>`);
        }
      });
    }

    /* ── Enrolment roster ─────────────────────────────────────────────────── */
    const rosterRows = rosterAll.slice().sort((a, b) => ts(b.last.logged_at) - ts(a.last.logged_at));

    rosterCard.innerHTML = `
      <div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant/60 flex flex-wrap items-center justify-between gap-space-sm"><div>
        <div class="font-headline-md text-headline-md text-on-surface">Who is enrolled</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Built from drip runs in <span class="font-label-numeric-sm">The activity log</span>, newest activity first.
          Counted per lead is every outbound row on a mail <em>or</em> WhatsApp channel logged at or after that lead's first run — the drip sends on both —
          gathered across every key that person is filed under in <span class="font-label-numeric-sm">The message history</span>, not just the address they were enrolled on.</div>
      </div></div>
      <div style="max-height:46vh;overflow-y:auto">${rosterRows.length
        ? rosterRows.map(r => {
            const p = personOf(r.key, r.name);
            /* One style attribute, not two: a second `style=` on the same tag is
               dropped by the parser, which silently lost the row's alignment. */
            return `<div class="list-item" data-key="${esc(r.key)}"${p.lead
                ? ` role="button" tabindex="0" data-lead-row="${esc(p.lead.id)}" title="Open this lead" style="align-items:flex-start"`
                : ' style="align-items:flex-start;cursor:default"'}>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <span style="font-weight:500">${personLine(p)}</span>
                  ${pill(r.last.status || 'Unknown', undefined, { verbatim: !!r.last.status })}
                  ${r.replies.length ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap text-amber-700" title="This contact wrote back after being enrolled. The workflow's day-1/3/5/7 gates stop the sequence at its next step; what is outstanding is a reply from a person.">replied ${esc(ago(r.replies[0].created_at))}</span>` : ''}
                  ${r.failures ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap text-red-700" title="Runs that failed outright or went out half-done, classified by NEXUS. Sequences that stopped because the customer replied are excluded.">${num(r.failures)} failed</span>` : ''}
                  ${r.stops ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap" title="The reply gate ended the sequence early — the customer answered, or the lead went terminal. This is the workflow working, not a fault.">${num(r.stops)} stopped on purpose</span>` : ''}
                  ${r.addressable ? '' : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap text-red-700" title="The audit row carries this in the email on the lead record, but it is not an address an email sequence can send to.">not an email address</span>'}
                </div>
                <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(maskText(str(r.email) || 'no email on the audit row'))} · enrolled ${esc(ago(r.first.logged_at))} · ${num(r.runs)} ${plural(r.runs, 'run', 'runs')}</div>
                ${r.keyExpanded
                  ? `<div class="font-body-sm text-body-sm text-on-surface-variant text-outline" title="the message history files one person under several keys — a real address, a @c.us chat id, a +digits@whatsapp.lead key and a @lid handle. Messages under all of them are counted for this person. NEXUS’s identity rules resolves them: the phone-shaped keys on the last nine digits of the number, the @lid handle through the saved contact details row that ties it to that number, because a LID carries no phone digits of its own.">Messages counted across ${num(r.matchedKeys.size)} keys this person is filed under</div>`
                  /* Not "only the enrolment key is searched" any more, which is
                     what this said until 01 Sep 2026 and stopped being true when
                     the private rule went: identity.js searches every canonical
                     the person resolves to, and it can reach a @lid handle from
                     the enrolment key alone through the conversation view. What
                     is worth saying here is the narrower true thing — the
                     expansion ran and the database has rows under at most one of
                     the identities it produced. */
                  : `<div class="font-body-sm text-body-sm text-on-surface-variant text-outline" title="${esc(`NEXUS’s identity rules resolved this enrolment to ${r.canon.size} ${plural(r.canon.size, 'identity', 'identities')} — the address, the last nine digits of the phone number, and any @lid handle the saved contact details or NEXUS row ties to that number. The message history holds rows under ${r.matchedKeys.size === 1 ? 'one of them' : 'none of them'}.${r.lead ? '' : ' No lead row matches the key the drip was enrolled on, so no phone number came from that side; whatever was reached came from the conversation view.'}`)}">${r.matchedKeys.size === 1
                    ? `Found under one key only, of ${num(r.canon.size)} ${plural(r.canon.size, 'identity', 'identities')} searched`
                    : `No message is filed under any of the ${num(r.canon.size)} ${plural(r.canon.size, 'identity', 'identities')} this person resolves to`}${r.lead ? '' : ' — no lead row matches this enrolment key'}</div>`}
                ${r.replies.length ? `<div class="font-body-sm text-body-sm text-on-surface-variant text-red-700">“${esc(String(r.replies[0].message || '').replace(/\s+/g, ' ').trim().slice(0, 140))}”</div>` : ''}
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div class="tabular-nums" style="font-weight:500">${num(r.sends.length)}</div>
                <div class="font-body-sm text-body-sm text-on-surface-variant">${r.sends.length
                  ? esc(`${channelSummary(r.sends)} since`)
                  : r.judgeable
                    ? '<span class="text-red-700">nothing logged on either channel</span>'
                    : '<span class="text-amber-700" title="This enrolment is older than the oldest message read, so a send to them could sit outside the window. It is not counted as a zero.">not judged</span>'}</div>
              </div>
            </div>`;
          }).join('')
          + (unkeyedIdx.length ? `<div class="list-item" style="cursor:default">
              <span class="material-symbols-outlined text-outline" style="font-size:18px" aria-hidden="true">info</span>
              <div class="font-body-sm text-body-sm text-on-surface-variant" style="white-space:normal">${num(unkeyedIdx.length)} drip ${plural(unkeyedIdx.length, 'run has', 'runs have')} no email address on the run and cannot be attached to anybody.</div>
            </div>` : '')
        /* This card said "No drip run has been logged in the 540 audit rows read"
           while the activity card below it listed five. The roster is keyed by
           lead_email and those rows have none; that is a third state, and it now
           has its own sentence rather than borrowing the never-ran one. */
        : stateEmpty(runsButNobody ? 'Runs are logged, but none names a lead' : 'Nobody is enrolled',
            instrumented === false
              ? 'The registered drip workflow does not write to the audit log, so enrolments cannot be listed here even if leads are mid-sequence. Instrument the workflow to see this roster.'
              : runsButNobody
                ? `${num(dripRuns.length)} drip ${plural(dripRuns.length, 'run is', 'runs are')} in the ${num(audit.length)} audit ${plural(audit.length, 'row', 'rows')} read — they are listed in Campaign activity below — and every one carries a NULL the email on the lead record, `
                  + 'so this roster has nobody to list. The campaign has run. This card cannot say who for, and it will not say the campaign never ran instead.'
                : `No drip run has been logged${auditCapped ? ` in the newest ${num(AUDIT_LIMIT)} audit rows read` : ` in the ${num(audit.length)} audit ${plural(audit.length, 'row', 'rows')} read`}. `
                  + (eligible.length
                    ? `Enrol one of the ${num(eligible.length)} eligible ${plural(eligible.length, 'lead', 'leads')} above and the workflow writes its first row here.`
                    : 'No lead is currently eligible to enrol either, so there is nothing to start. This roster fills the first time the drip workflow logs a run against a lead\u2019s email.'),
            'group_off')}</div>`;

    /* ── What has actually been sent ─────────────────────────────────────── */
    mailCard.innerHTML = `
      <div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant/60 flex flex-wrap items-center justify-between gap-space-sm"><div>
        <div class="font-headline-md text-headline-md text-on-surface">Outbound mail logged</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Every outbound message sent by mail, newest first.
          The drip's two WhatsApp legs are counted in the roster and the summary strip but are not listed here — this card is the mail log specifically, because mail is the leg the Gmail credential can kill.
          The table records no workflow id, so drip mail cannot be separated from other outbound mail.</div>
      </div></div>
      <div style="max-height:46vh;overflow-y:auto">${mail.length
        ? mail.map(msg => {
            const p = personOf(msg.lead_email, null);
            return `<div class="list-item" style="cursor:default;align-items:flex-start">
            <span class="font-label-numeric-sm text-outline" title="${esc(stamp(msg.created_at))}">${clock(msg.created_at)}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:500">${p.email ? personLine(p) : '<span class="text-amber-700">No recipient recorded</span>'}</div>
              <div class="font-body-sm text-body-sm text-on-surface-variant" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(maskText(str(msg.lead_email)))}</div>
              <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(String(msg.message || '').replace(/\s+/g, ' ').trim().slice(0, 160)) || '<span class="text-outline">No message text recorded</span>'}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap">${esc(String(msg.channel || '').trim() || 'unrecorded channel')}</span>
              <div class="font-body-sm text-body-sm text-on-surface-variant">${ago(msg.created_at)}</div>
            </div>
          </div>`;
          }).join('')
        : stateEmpty('No mail has been logged',
            `Nothing outbound on a mail channel exists in the ${num(comms.length)} ${plural(comms.length, 'message', 'messages')} read. `
            + `Those messages carry these channels: ${channelMixText}. `
            + (delivery === 'broken'
              ? 'With a mail credential failure recorded this is the expected state — enrolments queue, mail does not go out.'
              : delivery === 'recovered'
                ? 'The mail credential failure that would have explained it has since been superseded by a successful run on the same mailbox, so this is not the mailbox being dead. A row appears here the first time a workflow logs an outbound message on a mail channel.'
                : 'No mail credential failure is recorded either, so nothing here explains it. A row appears here the first time a workflow logs an outbound message on a mail channel.'),
            'unsubscribe')}</div>`;

    /* ── Silence detector ─────────────────────────────────────────────────── */
    /* Whether the detector is switched on, in the words of the two sources
       this login may read: the automation register (nexus_workflow_catalogue)
       and v_workflow_health. Both are hand-maintained mirrors of the n8n box and
       have disagreed with it before — CLAUDE.md records the register calling the
       detector active while it was deactivated on the box — so this states what
       the register SAYS, names it as the source, and never upgrades it into
       "running". If either source says it is off, the card says off. */
    const isSilenceFlow = w => /silence/i.test(`${w.name || ''} ${w.audit_name || ''} ${w.category || ''}`);
    const silHealth = (health || []).filter(isSilenceFlow);
    const silReg = (registry || []).filter(isSilenceFlow);
    const silKnown = silHealth.length || silReg.length;
    const silOff = [...silHealth, ...silReg].some(w => w.is_active === false);
    const silLastRun = silHealth.map(w => w.last_run).filter(Boolean).sort((x, y) => ts(y) - ts(x))[0] || null;
    const silWords = !silKnown
      ? (healthErr && !registry
        ? 'Neither the workflow health view nor the automation register could be read, so whether the detector is switched on is unknown here.'
        : 'No workflow named as a silence detector appears in the automation register or the health view, so whether one is running is unknown here — not "running".')
      : silOff
        ? 'The automation register reports the silence detector as SWITCHED OFF. While it is off, no lead is escalated for going quiet, and Lead Recovery loses the signal it reads.'
        : `The automation register reports the silence detector as switched on${silLastRun ? `; its last recorded run was ${ago(silLastRun)}` : ', with no run recorded in the health view'}. The register is maintained by hand and has disagreed with the automation box before, so this is its word, not a measurement of the box.`;
    const silChip = !silKnown ? statusChip('not-tested', 'Unknown') : silOff ? statusChip('blocked', 'Switched off') : statusChip('connected', 'On, per the register');
    silenceCard.innerHTML = `
      <div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant/60 flex flex-wrap items-center justify-between gap-space-sm"><div>
        <div class="flex items-center gap-2 flex-wrap"><span class="font-headline-md text-headline-md text-on-surface">Silence detector</span>${silChip}</div>
        <p class="font-body-sm text-body-sm ${silOff ? 'text-red-700' : 'text-on-surface-variant'} mt-1">${esc(silWords)}</p>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">A lead that has not replied for twelve hours is escalated once, then never again${
          unnamedInternal
            ? ` · every internal row in this read is listed, and ${num(unnamedInternal)} of ${num(internalRows.length)} ${plural(unnamedInternal, 'is', 'are')} not an escalation`
            : ''}</div>
      </div></div>
      <div style="max-height:40vh;overflow-y:auto">${internalRows.length
        ? internalRows.map(c => {
            const p = personOf(c.lead_email, null);
            /* Two kinds of row reach this list and they are labelled apart.
               A marker body is one of ours by its text; a row that is internal
               only by its channel or direction carries an ordinary body and
               must not be captioned as an escalation. `isMarkerText` is the
               library's test, not a second one written here. */
            const marked = isMarkerText(c.message);
            const detail = stripMarker(c.message);
            return `<div class="list-item flex-wrap" style="cursor:default;align-items:flex-start">
            <span class="font-label-numeric-sm text-outline" title="${esc(stamp(c.created_at))}">${clock(c.created_at)}</span>
            ${marked ? pill('Internal marker', 'warm', { verbatim: false }) : pill('Internal row', 'warm', { verbatim: false })}
            <div class="basis-full" style="flex:1;min-width:0">
              <div style="font-weight:500">${p.email ? personLine(p) : '<span class="text-amber-700">Unknown contact</span>'}</div>
              ${detail ? `<div class="font-body-sm text-body-sm text-on-surface-variant">${esc(detail)}</div>` : ''}
              ${marked ? '' : `<div class="font-body-sm text-body-sm text-on-surface-variant text-outline">Internal by its channel (<span class="font-label-numeric-sm">${esc(String(c.channel || 'none recorded'))}</span>) or direction (<span class="font-label-numeric-sm">${esc(String(c.direction || 'none recorded'))}</span>), not by its text. This screen cannot say what wrote it.</div>`}
            </div>
            <div class="font-body-sm text-body-sm text-on-surface-variant">${ago(c.created_at)}</div>
          </div>`;
          }).join('')
        : stateEmpty('Nobody has gone silent',
            'The detector fires once for a lead that received an outbound message and did not reply within twelve hours, and writes a [SILENCE-…] row into the message history. '
            + `None of the ${num(comms.length)} ${plural(comms.length, 'message', 'messages')} read is an internal row at all — every one of them is a message to or from a customer by NEXUS’s own test for what counts as a message`
            + (mail.length ? '.' : ', and no outbound mail has been logged either, so nothing has been sent for anybody to go quiet after.'),
            'notifications_off')}</div>`;

    /* ── Campaign activity ────────────────────────────────────────────────── */
    activityCard.innerHTML = `
      <div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant/60 flex flex-wrap items-center justify-between gap-space-sm"><div>
        <div class="font-headline-md text-headline-md text-on-surface">Campaign activity</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">Every drip run in the audit log, newest first${matchedByRegistry ? ' · matched through the automation register' : ' · matched on workflow name'}</div>
      </div></div>
      <div style="max-height:40vh;overflow-y:auto">${dripRuns.length
        ? dripRuns.map((x, i) => {
            const p = personOf(x.lead_email, x.lead_name);
            const keyed = low(x.lead_email);
            return `<div class="list-item" data-key="run-${i}" style="cursor:default;align-items:flex-start">
            <span class="font-label-numeric-sm text-outline" title="${esc(stamp(x.logged_at))}">${clock(x.logged_at)}</span>
            ${pill(x.status || 'Unknown', undefined, { verbatim: !!x.status })}
            ${(() => {
              /* The raw status stays, because it is what the row literally says.
                 Beside it, what lib/health.js makes of it — the two differ, and
                 the difference is the point: a FAILED row whose summary reads
                 "N of M claimed steps did not land" is a PARTIAL, and a PARTIAL
                 that begins "Stopped before" is the reply gate working. */
              const w = outcomeWords(outcomeOf(x));
              const stop = isDeliberateStop(x);
              const label = stop ? 'Stopped by the reply gate' : w.label;
              const blurb = stop
                ? 'The sequence exited early because the customer replied or the lead went terminal. Not counted against the workflow.'
                : w.blurb;
              return up(x.status) === up(label)
                ? ''
                : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap ${stop ? 'text-outline' : toneText(w.tone)}" title="${esc(blurb)}">${esc(label)}</span>`;
            })()}
            <div style="flex:1;min-width:0">
              <div style="font-weight:500">${keyed || str(x.lead_name)
                ? personLine(p)
                : `<span class="text-amber-700">No lead on this run</span> <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold whitespace-nowrap font-label-numeric-sm">${esc(str(x.workflow) || 'unnamed workflow')}</span>`}</div>
              ${keyed && !isRealEmail(keyed)
                ? `<div class="font-body-sm text-body-sm text-on-surface-variant text-red-700">The email on the lead record is <span class="font-label-numeric-sm">${esc(maskText(str(x.lead_email)))}</span>, which is a chat key rather than an address — an email sequence has nowhere to send.</div>`
                : ''}
              <div class="font-body-sm text-body-sm text-on-surface-variant">${esc(dealerText(x.summary).slice(0, 160)) || '<span class="text-outline">No summary recorded</span>'}</div>
            </div>
            <div class="font-body-sm text-body-sm text-on-surface-variant">${ago(x.logged_at)}</div>
          </div>`;
          }).join('')
        : stateEmpty('No campaign runs logged',
            instrumented === false
              ? 'The registered drip workflow does not write to the audit log, so its runs cannot appear here even if leads are mid-sequence.'
              : `The drip workflow writes a row here every time it starts a sequence. No row among the ${num(audit.length)} audit ${plural(audit.length, 'row', 'rows')} read `
                + `comes from ${matchedByRegistry ? 'a workflow the registry names as a drip' : 'a workflow whose name reads as a drip'}.`,
            'receipt_long')}</div>`;

    /* ── The strip, and the wiring that makes it actionable ─────────────────
       An alert that only describes a problem is a poster. Every alert that has
       somewhere to go scrolls to that card and highlights exactly the rows it
       is about; the ones with nowhere to go say so in their own text instead of
       being a click that appears to do nothing. */
    alertCard.querySelector('[data-pbody]').innerHTML =
      (forThisScreen.length || alerts.length ? viewRowsHtml + alertRowsHtml : nothingHtml) + notesHtml;

    const focusable = [rosterCard, mailCard, silenceCard, activityCard];
    function focusOn(card, keys) {
      focusable.forEach(c => c.querySelectorAll('.list-item.on').forEach(n => n.classList.remove('on')));
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!keys || !keys.size) return;
      let first = null;
      card.querySelectorAll('[data-key]').forEach(n => {
        const on = keys.has(n.dataset.key);
        n.classList.toggle('on', on);
        if (on && !first) first = n;
      });
      /* The list scrolls inside its own box, so bringing the card into view does
         not bring the highlighted row into view — the row has to be asked too,
         and without `behavior:smooth` so it does not race the card's own scroll. */
      first?.scrollIntoView({ block: 'nearest' });
    }

    const alertByKey = new Map(alerts.map(a => [a.key, a]));
    alertCard.querySelectorAll('[data-alert]').forEach(n => {
      const run = () => {
        const a = alertByKey.get(n.dataset.alert);
        if (a?.target) focusOn(a.target, a.keys);
      };
      n.addEventListener('click', run);
      /* Keyboard-operable, because this row is the only route from the alert to
         the rows it is about. */
      n.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
      });
    });
    alertCard.querySelectorAll('button[data-lead]').forEach(b => b.addEventListener('click', ev => {
      /* The chip sits inside a row that scrolls the roster; opening one lead and
         highlighting all of them at once would be two answers to one click. */
      ev.stopPropagation();
      const lead = leads.find(l => String(l.id) === b.dataset.lead);
      if (lead) leadDrawer(lead);
    }));
    rosterCard.querySelectorAll('[data-lead-row]').forEach(n => {
      const run = () => {
        const lead = leads.find(l => String(l.id) === n.dataset.leadRow);
        if (lead) leadDrawer(lead);
      };
      n.addEventListener('click', run);
      n.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
      });
    });

    footHost.innerHTML = trustFooter({
      source: 'leads · communication_logs · audit_log · v_workflow_health',
      asOf: dubaiStamp(new Date().toISOString()),
      evidence: `${num(leads.length)} ${plural(leads.length, 'lead', 'leads')} · ${num(comms.length)} ${plural(comms.length, 'message', 'messages')} · ${num(dripRuns.length)} drip ${plural(dripRuns.length, 'run', 'runs')}`,
      actor: myRole() || '—',
    });
  }
};

/* ==========================================================================
   S10 · Deals
   Closing a deal is what feeds the RAG memory: the Closed-Won workflow embeds
   the deal and writes it to pgvector so Ask AI can reason over real sales.
   Until now that workflow could only be triggered by hand outside the product.
   ========================================================================== */
