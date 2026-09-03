/* NEXUS OS — screens/conversations.js
   Rebuilt 24 Aug 2026 against v_conversations, and revised twice the same
   evening as the data underneath it changed.

   ── 1. Who the person is, and where a reply goes ────────────────────────────
   The thread list used to be built in the browser by grouping communication_logs
   on `lead_email` and printing that key as the contact's name, so a WhatsApp
   thread appeared in the inbox as "163188003877036@lid". A LID handle contains
   no phone digits at all: it identifies nobody. v_conversations now resolves the
   contact in the database — lead name → WhatsApp profile name → phone → the raw
   key — and reports in `identified` which of those it managed.

   The view was then rebuilt again, and the rebuild changed a shape this file
   depends on. `communication_logs.lead_email` holds an email when the lead was
   known at the time the message was logged and a WhatsApp handle when it was
   not, so one person could be logged under two keys and the old view grouped on
   the raw value — the same customer appeared twice, 46 messages under his email
   and 20 under his LID. The view resolves a log row to a person before grouping,
   which means:

     · `thread_key` is the identity — the key this screen selects, filters,
       searches and opens rows on;
     · `chat_id` is the address — the only thing WAHA can send to.

   They are no longer the same string and nothing may be sent to `thread_key`.
   The one place that was still keyed wrongly was the per-thread message read:
   selecting `lead_email=eq.thread_key` returned only the rows that happened to
   be logged under that key — two thirds of this customer's history, rendered as
   though it were all of it.

   ── 1a. The view does NOT close that loop, and this file used to claim it did ─
   Corrected 1 Sep 2026. The sentence above used to read "one value per person,
   stable". It is not. `v_conversations` resolves a log key to a person with two
   exact joins — `lower(leads.email) = lower(cl.lead_email)` and
   `whatsapp_contacts.chat_id = cl.lead_email` — and nothing else. Neither can
   see a key of the fourth shape the workflows write, `+<digits>@whatsapp.lead`,
   when the lead has a real email address: there is no leads row with that
   address and no contact row with that chat id, so the key falls through to
   `lower(cl.lead_email)` and becomes a thread of its own.

   Live at the time of writing, that is not hypothetical. Lead 38, Ali, is TWO
   rows in this inbox:

     shabbir53ujjainwala@gmail.com   17 rows   identified 'lead',  named Ali
     +918517942172@whatsapp.lead     12 rows   identified 'unidentified'

   Rows and not messages, and the difference is §3's: one of those 17 is the
   silence detector's own marker, so the person has 29 log rows and 28 messages.

   The second row carries no name, no phone and no chat_id, and this screen
   rendered it as "Unidentified contact · Not in leads · No number on file",
   composer disabled — a stranger, next to himself. The number is sitting in that
   row's own key.

   The database already knows better. `nexus_lead_for_comm_key()` returns 38 for
   all three of Ali's keys — the gmail address, the LID and the whatsapp.lead one
   — because it falls back to the LAST NINE DIGITS of the phone. `v_conversations`
   simply does not call it. So the fix here is not a second matching rule
   invented in the browser: it is `lib/identity.js`, which is that same last-9
   rule, shared, and tested against the four key shapes.

   What this screen now does with it, and the limits it keeps:

     · every thread row is expanded through `expandIdentity`, giving the phone
       digits a key carries even when `v_conversations.phone` is null, and the
       nine-digit comparison suffix;
     · two rows that share that suffix are the same person, and both say so and
       name each other. They are NOT merged into one row — the counts on this
       screen have to keep agreeing with `v_needs_attention`, the nav badge and
       Overview, all of which count v_conversations rows;
     · the message pane reads the WHOLE person through `personFilter`, so either
       of Ali's two rows opens the same 29 log rows — 28 messages and one marker
       — and the pane says which keys and which patterns that history was
       actually matched on, not which keys exist. It is also `ilike`, which
       incidentally fixes the case-sensitivity the 31 Aug audit filed as C2;
     · `identified` stays the view's word. A row the view called 'unidentified'
       is not relabelled 'lead' here. It gets the sibling's name with the
       attribution attached — "linked by the last 9 digits" — and never in a bare
       name slot.

   `whatsapp_contacts.phone` was backfilled from WAHA on 24 Aug, so a thread
   whose chat_id is in that table has a number. A thread keyed on
   `+<digits>@whatsapp.lead` is not in that table at all, which is the real
   reason `unidentified` and "no number on file" still render — not a missed
   backfill row, which is what this file used to say.

   The phone is shown beside the name in every place a thread is listed — alert
   strip, list row, pane header and send confirmation. It is the one identifier
   that is true for everybody, and it is what an operator dials or searches for
   in WhatsApp. It is formatted for reading (+971 50 123 4567) and the stored
   value is on the `title` of every one of them, because the grouping is a
   rendering and the digits are the record.

   ── 1b. …and the same blindness ran the other way, into `leads` ─────────────
   New 1 Sep 2026, evening. §1a widened the MESSAGE read to the whole person and
   left the LEAD read where it was: one line, `leads?email=eq.<lead_email>`,
   where `lead_email` is whatever `v_conversations` managed to resolve with its
   two exact joins. Everything on this screen that says anything about the leads
   table — the "Not in leads" sub-line and filter tab, the Open lead button, the
   "matched to a lead" figure in the strip, the send confirmation's In-leads row,
   and the allowlist sentence that explains why a thread has no reply — was
   reading that one nullable column.

   Lead 35 is what that costs. Effco Contracting llc is row 35 of `leads`,
   +971505433953, DISQUALIFIED, and his ten messages are filed under
   `111948809162873@lid`. His `email` column is the empty string, so
   `v_conversations` resolves no lead for the thread and this screen rendered,
   live and in words: **"No row in the leads table matches this contact"**, plus
   "there is no lead record for them", plus — under a HOT alert asking a rep to
   answer him — "the WhatsApp bot replies automatically only to numbers already
   in leads", which is an explanation for the dealership's silence that blames
   the customer for an absence that is not there. His number IS in leads. Six
   other paths already agreed it was: `lib/identity.js`, the `v_lead_messages`
   view, the lead drawer's timeline, `screens/overview.js`'s reply check and two
   database functions all attribute those ten rows to lead 35.

   The screen was holding the answer the whole time. `v_conversations.phone` for
   that thread is `971505433953`, read out of `whatsapp_contacts` — which is the
   only bridge a `@lid` has, because a LID carries no phone digits of its own —
   and the last nine of those digits are lead 35's. So the fix is the one §1a
   already made for messages, applied to leads: a bounded read of the `leads`
   table at boot, and `expandIdentity(thread, { leads: pool })` per thread, which
   is the same last-nine-digit rule `nexus_lead_for_comm_key()` uses and the same
   call `screens/leads.js:407`, `screens/overview.js:840` and
   `lib/lead-drawer.js:253` make. Nothing is matched here that identity.js would
   not match, and where two leads end in the same nine digits it refuses and this
   screen says so rather than opening the wrong customer.

   Two things this deliberately does NOT do. It does not relabel `identified` —
   that column stays v_conversations' own answer, and the strip now reports both
   figures side by side rather than overwriting the view's with ours. And it does
   not merge Ali's two rows: the counts on this screen still have to agree with
   v_needs_attention and the nav badge, which count view rows.

   `v_lead_messages` was considered for this and not used. It resolves a
   communication_logs row to a lead server-side with exactly this rule, and it is
   the right tool when the question is "whose messages are these". The question
   here is "is this contact in leads", which is not the same question: a thread
   whose keys have no matched log row would come back empty from that view, and
   an empty answer there is indistinguishable from "not a lead". It also cannot
   report the collision refusal to the browser, only act on it. So the lead rows
   themselves are read, and the two are cross-checked in the report rather than
   one being trusted.

   ── 2. How many conversations there actually are ────────────────────────────
   Every thread that was not a customer was deleted on 24 Aug — thirteen handles
   belonging to the owner's personal phone book. For a while afterwards the inbox
   held exactly one person, and this file was written around that: a 360px column
   with a search box, four filter tabs and a single row in it reads as a screen
   that failed to load the rest.

   That is no longer the shape of the data. Read live 1 Sep 2026 19:00 UTC:
   v_conversations returns 12 rows for 11 people (one of the twelve is Ali's
   second key, §1a). This sentence said 11 rows and 10 people earlier the same
   day and was already stale by the evening — a twelfth thread arrived at 14:52
   UTC — which is the reason every live figure in this file carries the hour it
   was read. The solo layout below is kept because it is still correct when it
   applies and the count can fall back — not because it describes today.

   So the layout follows the data. Below SPLIT_MIN threads there is no list
   column, no search and no filter tabs — there is nothing to choose between, and
   a control that cannot change what is on screen is furniture. The summary above
   says plainly that what is shown is the whole of the inbox. Above SPLIT_MIN the
   list, the search and the tabs come back, and a tab whose count is zero is not
   drawn at all rather than sitting there able only to say "no conversation
   matches". Zero threads is a third case, and it used to fall through the crack
   between the two: `renderStrip()` ran before the empty-state return and painted
   "Every thread ends with a message we sent", "Every thread has a real phone
   number" and "Every thread has a WhatsApp address" — three green claims about a
   set with no members, over a card saying there were none. Filed as C1 by the
   31 Aug audit, fixed 1 Sep: zero threads gets its own branch that states the
   absence.

   Nothing here is averaged or distributed. Almost every figure on this screen is
   a count of rows the view returned. The one rate is the WhatsApp BDC agent's
   30-day success rate, which is not this screen's arithmetic — it comes from
   `v_workflow_health` through `lib/health.js`, the only module allowed to say
   what an audit_log status means.

   ── 3. Silence is not always a failure, and a marker is not a reply ─────────
   The bot answers automatically only when the number is already in `leads`, or
   when the message carries a dealership keyword. Everything else is logged and
   left alone, deliberately, while the business WhatsApp number is Ali's own
   personal number. So a thread with no outbound message is usually the allowlist
   working exactly as intended, and this screen no longer paints it red as though
   a workflow had crashed. What it does say is the part that is still true:
   somebody wrote to the dealership and no human has answered yet. That is
   `v_needs_attention.unanswered_chat` — HOT, newest message inbound, inside a
   seven-day window — and it is the first thing on the screen.

   The dashboard can see one half of the allowlist rule and not the other: it can
   tell whether the number is in `leads`, and it cannot tell whether a message
   tripped a keyword, because the keyword list is not in the database. Wherever
   that distinction matters it is stated rather than glossed over.

   And there is a third thing silence can be, which this screen was reading as
   its opposite. The 12-hour silence detector writes a row into
   communication_logs when a customer stops answering — `channel='system'`,
   message beginning `[SILENCE-ESCALATED]`. It writes those rows BECAUSE nobody
   answered. It now writes them `direction:'internal'`, but the two rows already
   in the table carry `direction:'outbound'`, and both of them are the NEWEST row
   in their thread. Read live 1 Sep 2026:

     shabbir53ujjainwala@gmail.com   marker 31 Aug 17:00, last real message ours
     +971547484167@whatsapp.lead     marker 26 Aug 19:03, last real message ours

   The view counts each of those as an outbound. So Ali's row says "9 sent back"
   when eight messages were sent to him, and the ninth is the dealership's own
   note that he went quiet. Worse, `last_message` is the marker, so the list row
   previewed "[SILENCE-ESCALATED] Silent for 12h since …" under a north-east
   arrow captioned "Newest message was sent by us", and the pane drew it as an
   outbound chat bubble — the internal note rendered as something we said to the
   customer.

   `awaiting_reply` is NOT wrong on these two, and it is deliberately left alone:
   the last real message in both threads is ours, so the dealership does not owe
   a reply and the view's false is a true false. That is why nothing here
   recomputes it. What is corrected is everything the marker was being counted
   into: a marker is never an outbound message, never a chat bubble, never the
   list preview without a label, and a thread sitting on one gets a derived alert
   of its own, because the detector escalated it and `unanswered_chat` — which
   keys on `awaiting_reply` — cannot see it at all.

   ── 3a. The agent that fills this inbox is failing ──────────────────────────
   New 1 Sep 2026. §3 tells an operator that a quiet thread is the allowlist
   working as designed. That is only safe to say while the agent is working.
   Read live from v_workflow_health: WhatsApp BDC AI Agent is DEGRADED, 119
   successes over 286 rated runs in 30 days — 41.6% — with 166 failures. It is
   read through `lib/health.js`, never by comparing `status` to 'FAILED' here.
   The strip states it beside the inbox, because "nobody is waiting on a reply"
   and "the workflow that logs replies crashed on 58% of its runs" are two things
   an operator has to see together.

   ── 4. Sending ──────────────────────────────────────────────────────────────
   HOOK.whatsappSend is live and goes out on the dealership's real number, so:
     · it is addressed to `chat_id`, never to `thread_key`, and the address is
       printed under the composer as well as in the confirmation, because the two
       are now different strings and an operator must be able to see which one a
       message is going to;
     · the composer never sends on Enter — Enter is a line break, and the send
       button opens a confirmation naming the exact address the message goes to;
     · the workflow's own answer decides the outcome. {status:'sent'} is success,
       {status:'error'} is a failure stated verbatim, and anything else is
       reported as "unknown" rather than assumed;
     · nothing is optimistically appended. The workflow writes the outbound to
       communication_logs, so a confirmed send re-reads the thread, the list and
       the alert strip, and shows only what the database actually holds;
     · a thread with no chat_id has no WhatsApp address at all, so the composer
       is disabled and names the missing field.

   communication_logs has no read state and no delivery state, so "Reply due" is
   `awaiting_reply` from the view — newest message inbound, nothing sent after —
   and never claims to be an unread flag. */
import { SILENCE_MARKER, isInternalRow, isMarkerText, silenceCount } from '../lib/comm-events.js';
import { db, n8n, HOOK } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { N8N_BASE } from '../lib/env.js';
/* `tone` is imported alongside `pill` from 1 Sep 2026 so this screen can label a
   pill and keep its colour. `pill(label)` derives the tone from the label, and
   the moment a label stops being the bare status word — "HOT severity" rather
   than "HOT" — that derivation falls through to the neutral grey. See the
   severity pill in renderAlerts(). */
import { TZ, ago, dubaiDate, dubaiStamp, esc, initials, num, pct, pill, tone } from '../lib/format.js';
/* The only module allowed to interpret audit_log.status or v_workflow_health.
   `status === 'FAILED'` is never written on a screen; see lib/health.js. */
import { HEALTH_WORDS, healthWords, successRate } from '../lib/health.js';
/* The shared contact-matching rule — the backend's last-nine-digits join,
   expressed once. See §1a: this screen used to hold its own smaller version of
   it (`msgKeys`, a three-element in-list) and that version could not see the
   `+<digits>@whatsapp.lead` half of a customer. Nothing here invents a second
   rule; every identity decision below goes through these four functions. */
import { AMBIGUITY, SUFFIX_LEN, describeKey, expandIdentity, normalizeKey, personFilter, personQuery } from '../lib/identity.js';
import { leadDrawer } from '../lib/lead-drawer.js';
import { openModal } from '../lib/modal.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi } from '../lib/ui.js';

/* Caps. An inbox that has been running a year has more history than a screen
   needs to paint, and an unbounded select is how a screen starts timing out in
   production. Where a cap is hit it is said out loud — a truncated inbox that
   looks complete is a lie about how many people are waiting. */
const THREAD_LIMIT = 500;
const MSG_LIMIT = 400;
const ATTN_LIMIT = 100;
/* The leads pool §1b matches threads against. Read whole and matched in memory,
   the way screens/overview.js:840 does it, rather than one query per thread: an
   inbox of 500 threads is 500 round trips to answer one strip figure, and the
   URL for a single or=() over 500 phone suffixes is longer than PostgREST will
   accept. 1000 is screens/leads.js's own LEAD_LIMIT, so the two screens cover
   the same rows. Where the cap is hit it is said out loud — a lead past the cap
   reads as "not in leads", which is the exact false sentence this work removes,
   so it may never be reached silently. Live 1 Sep 2026 19:00 UTC the table holds
   3 rows. */
const LEAD_POOL_LIMIT = 1000;
const LEAD_POOL_COLS = 'id,name,email,phone,status';

/* The look-back inside `v_needs_attention.unanswered_chat`. It is used here only
   to explain why a thread that is plainly waiting is absent from the alert strip
   — never to recompute the view's own headline, which stays the view's. A thread
   that crossed this line is still waiting; it is simply no longer being
   reported by anything but this screen, and that is worth saying out loud. */
const CHAT_WINDOW_DAYS = 7;

/* Below this many threads the inbox is not a list. One row in a 360px column
   beside a search box and four tabs looks like a list that failed to load the
   rest of itself; the same row rendered as the screen's only subject looks like
   what it is. Two, because a chooser needs something to choose between. */
const SPLIT_MIN = 2;

/* The silence detector's own bookkeeping row, and the three ways it is
   recognisable. `phase_6_12_hour_silence_detector.json` writes
   { channel:'system', direction:'internal', message:'[SILENCE-ESCALATED] …' };
   the two rows written before that fix carry direction 'outbound' instead, so
   all three spellings are tested and neither side has to be deployed first.

   Two other screens exclude the same rows and each sees half of it: overview.js
   holds its own `INTERNAL_CHANNELS` set and tests channel and direction but not
   the message text, and campaigns.js tests the `[SILENCE-ESCALATED]` prefix but
   not the channel. Either is enough for the two rows live today, which carry
   both marks. This file tests all three because it is the screen that renders
   the row itself, and a row that is internal by only one of the three marks
   would be drawn here as a message to a customer. No line numbers are cited:
   those two files are being edited alongside this one and a line number is a
   claim that goes stale without anybody touching this file.

   All three spellings, and the whole taxonomy around them, now live in
   lib/comm-events.js — imported at the top of this file — and mirror
   public.nexus_is_message() in the database line for line. Two things changed
   when they moved out of here on 1 Sep 2026, and both were disagreements:

     · the text test was `trimStart().startsWith('[SILENCE-ESCALATED]')`. SQL
       LIKE does not trim, and the database has always matched the shorter
       prefix `[SILENCE-`, so this file was the one out of step. The shared
       version matches untrimmed on the prefix, exactly as the SQL does. Live
       1 Sep 2026: 0 rows carry leading whitespace and 0 carry a second marker
       kind, so no row changes verdict today.
     · nothing here tested `[system]%`, which nexus_is_reply() has excluded from
       the reply meter since it was written. The shared test excludes it too, so
       a `[system]` note can no longer be drawn as a chat bubble here while the
       response-time trigger correctly ignores it. */

/* The two registry rows this screen depends on, named exactly as
   workflow_registry.name so v_workflow_health can be filtered on them. */
const WF_BDC = 'WhatsApp BDC AI Agent';
const WF_SEND = 'WhatsApp Send (Dashboard Reply)';
const HEALTH_COLS = 'name,is_active,writes_audit_log,health,runs_30d,failures_30d,partials_30d,'
  + 'no_result_30d,rejected_30d,successes_30d,effective_runs_30d,success_rate_30d,last_run,last_failure';

const plural = (n, one, many) => (Number(n) === 1 ? one : many);

/* The view's own columns, and then the same questions asked of MESSAGES only.
   `message_count`, `inbound_count`, `outbound_count`, `last_message_at`,
   `last_message`, `last_direction` and `awaiting_reply` count and date EVERY row
   in communication_logs, markers included — that is what they have always meant
   and other screens sort and alert on them, so they are untouched. The
   `msg_*` / `last_msg_*` columns were appended by migration
   `comm_taxonomy_views_own_the_rule` and are the same aggregates restricted to
   rows public.nexus_is_message() accepts. Where this screen speaks about a
   message it reads the second set; where it speaks about the newest ROW —
   "the detector escalated this thread", "the newest row is not a message" — it
   reads the first, because that is the row it means. */
const VIEW_COLS = 'thread_key,chat_id,phone,push_name,lead_email,lead_name,lead_status,'
  + 'display_name,identified,message_count,inbound_count,outbound_count,'
  + 'last_message_at,last_message,last_direction,awaiting_reply,'
  + 'msg_count,internal_count,msg_inbound_count,msg_outbound_count,'
  + 'last_msg_at,last_msg,last_msg_direction,awaiting_msg_reply';

const low = s => String(s == null ? '' : s).trim().toLowerCase();
const str = v => String(v == null ? '' : v).trim();
const ts  = v => { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; };
/* Asia/Dubai, labelled GST. WhatsApp timestamps are the one thing on this
   screen an operator compares against their own memory of the shift — "she
   wrote at nine and nobody answered" — and a browser in another zone quietly
   restated that as five in the morning. */
const stamp = v => dubaiStamp(v, 'no timestamp recorded');
const clockOf = v => dubaiStamp(v, null);
const daysSince = v => { const t = Date.parse(v); return Number.isNaN(t) ? null : (Date.now() - t) / 86400000; };

/* A WhatsApp handle, in any of the shapes WAHA emits. A LID carries no phone
   digits, so it names nobody — anything matching this is an address and is
   rendered as one, in mono, never in a name position. The shape list is the one
   in lib/identity.js, kept here as a regex only because this is a rendering
   question ("may this string sit where a name goes?") and not a matching one. */
const HANDLE = /@(lid|c\.us|s\.whatsapp\.net|g\.us|whatsapp\.lead)$/i;
const isHandle = v => HANDLE.test(str(v));

/* The number, formatted to be read and never altered. WAHA stores it as bare
   digits (971501234567), occasionally still carrying the chat suffix; both are
   the same number and neither is scannable in a list of forty rows. The grouping
   is presentation only, which is why every caller puts the stored value on the
   element's `title`: the digits are the record, this is a rendering of them.
   A value with no digits at all comes back empty rather than as a stray '+'.
   Note what this function does NOT decide: whether the thing it was handed is a
   phone number in the first place. It will format any digits it is given, so
   every caller goes through addressPhone() below instead. */
function phoneDigits(v) {
  return str(v).replace(/@.*$/, '').replace(/\D+/g, '');
}
function fmtPhone(v) {
  const d = phoneDigits(v);
  if (!d) return '';
  /* UAE mobile, 971 + 9 digits: the shape every backfilled contact came back in. */
  if (d.length === 12 && d.startsWith('971')) return `+971 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  /* UAE landline, 971 + 8 digits. */
  if (d.length === 11 && d.startsWith('971')) return `+971 ${d.slice(3, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (d.length <= 7) return '+' + d;
  /* Any other country. The last seven digits are grouped so the number can be
     read back over a phone; nothing before them is regrouped, because guessing
     where a foreign country code ends would be inventing structure. */
  return `+${d.slice(0, -7)} ${d.slice(-7, -4)} ${d.slice(-4)}`;
}

/* Whether an address is a number at all. `971501234567@c.us` is the number with
   a suffix on it, and reading it as one is correct. `163188003877036@lid` is
   not: its digits are an opaque handle, and fmtPhone would happily render them
   as "+16318800 387 7036" — a phone number that does not exist, manufactured out
   of a machine id, which is the precise failure this screen was written to undo.
   A group id belongs to nobody and an email is not dialable.

   That question is not this file's to answer any more. It used to be decided
   here by a local `DIALABLE_SUFFIX = /@(c\.us|s\.whatsapp\.net)$/`, which had a
   hole exactly the width of the fourth key shape: `+918517942172@whatsapp.lead`
   has an '@' and is not one of those two suffixes, so it was refused, and Ali's
   second thread reported "No number on file" for a row whose key IS his number.
   `normalizeKey().phoneDerived` is the shared answer — true for c.us,
   s.whatsapp.net, whatsapp.lead and a bare number, false for lid and g.us — and
   it is the same function the last-9 matching is built on, so the thing that
   decides whether a key carries a phone and the thing that matches on that phone
   can no longer disagree. fmtPhone still owns the rendering; identity.js does no
   formatting. */
function addressPhone(v) {
  const n = normalizeKey(v);
  if (!n.phoneDerived || !n.digits) return '';
  return fmtPhone(n.digits);
}

/* Half of the bot's reply rule, and an honest account of the other half.

   Rewritten 1 Sep 2026, evening, and the rewrite is §1b's: this string used to
   be printed wherever `v_conversations.lead_email` was null, which is not the
   same set as "not in leads" and on lead 35 was its opposite. It now says what
   was actually checked, and it is rendered ONLY where leadOf() returns 'none' —
   every key the thread is filed under, plus the last-nine-digit rule, tested
   against a leads read that succeeded. The allowlist half is unchanged and is
   still only half a rule, for the reason the last sentence gives. */
const NOT_A_LEAD =
  'No row in the leads table matches this contact — checked against every key this thread is filed under and '
  + 'against the last nine digits of its number, which is the rule nexus_lead_for_comm_key() and the workflows '
  + 'join a chat to a lead on, not only the exact address v_conversations matches. The WhatsApp bot replies '
  + 'automatically only to numbers already in leads, or to messages containing dealership keywords — anything '
  + 'else is logged and left for a human on purpose, because the business number is a personal one. Whether a '
  + 'particular message hit a keyword is not recorded anywhere the dashboard can read, so this tells you one '
  + 'half of that rule and not the other.';
/* The third state, and it is not "not in leads". A failed or unfinished leads
   read means the question was not answered, and this screen may not answer it
   with a no — that is the shape of the bug §1b removed, arrived at from the
   other direction. */
const LEADS_UNKNOWN =
  'Whether this contact is in the leads table is not known right now: the leads read this screen matches '
  + 'threads against did not come back. That is not the same as "not in leads", so nothing here says it is — '
  + 'and the bot’s reply rule turns on that answer, so no claim is made about why this thread has or has '
  + 'not been answered automatically either.';
/* Two leads end in the same nine digits. lib/identity.js refuses the merge and
   so does this screen: opening the wrong customer's record from a thread is
   worse than opening none. */
const LEADS_AMBIGUOUS =
  'More than one row in the leads table has a phone number ending in this thread’s last nine digits. The '
  + 'rule the backend joins on cannot tell them apart, so lib/identity.js matched neither and neither is '
  + 'offered here. Merging on those digits would attach this conversation to a customer it may not belong to.';
/* Rewritten 1 Sep 2026, and corrected again the same day. This used to say a
   blank number meant the 24 Aug WAHA backfill had missed the row. That was wrong
   about the only blank in the data: `v_conversations.phone` is
   `COALESCE(wc.phone, wc2.phone)` over TWO joins onto whatsapp_contacts —
   `wc.chat_id = t.chat_id` and `lower(wc2.lead_email) = t.thread_key` — and a
   thread keyed on `+<digits>@whatsapp.lead` satisfies neither, because it has no
   chat_id and no contact row carries that address in lead_email either. Read
   live 1 Sep 2026: whatsapp_contacts holds exactly one row for Ali, keyed
   chat_id `158510264357112@lid` with lead_email his gmail address. His second
   thread was never missed by the backfill; it was never reachable by it. The
   number is in the key, and the key is now read for it (§1a), so this sentence
   is reserved for a thread that genuinely holds no digits anywhere.

   Naming only the chat_id join, as the first rewrite did, understates what was
   checked — and "we looked in one place" is a weaker claim than the one this
   sentence is making. */
const NO_PHONE_WHY =
  'Nothing on this thread carries a phone number: whatsapp_contacts has no row for it under either join the view '
  + 'makes — on chat_id, which this thread has none of, or on lead_email — and the thread key itself contains no '
  + 'dialable digits either. A LID handle is the usual case, because its digits are a machine id and reading them '
  + 'as a number would invent one.';

/* How well we know the person on the other end. The wording is deliberately
   flat: an operator must be able to tell a matched customer from a stranger at
   a glance, because the same composer sends to both. */
const IDENT = {
  lead: {
    label: 'Lead',
    short: 'Lead',
    tone: 'ok',
    named: true,
    note: 'v_conversations matched this thread to a row in the leads table on an exact address — its key is '
        + 'the string in that lead’s email column.',
  },
  whatsapp_profile: {
    label: 'WhatsApp profile name',
    short: 'Profile name',
    tone: 'cold',
    named: true,
    /* The second sentence used to read "Nobody has verified it and there is no
       lead record for them." Half of that is a fact about the NAME and half is a
       claim about the LEADS TABLE, and only the first half is knowable from
       `identified`. Live on 1 Sep 2026 the second half was false for Effco
       Contracting llc, who is lead 35 — the view could not see it, this constant
       asserted it anyway, and the sentence sat directly under his name. The name
       half stays here; the leads half is computed per thread by leadOf() and
       appended by identNote(), where it can be right. */
    note: 'The name below is whatever this contact typed into their own WhatsApp profile. Nobody has verified '
        + 'it, and v_conversations found no leads row whose email column holds this thread’s key.',
  },
  phone_only: {
    label: 'Number only',
    short: 'Number only',
    /* Amber, until the backfill made this the ordinary state of a contact who
       has simply never given a name. A warning colour on the commonest row on
       the screen is a warning about nothing, and it drains the colour of meaning
       for the rows that do need one. Neutral: it is a thing to know. */
    tone: 'cold',
    named: true,
    note: 'We hold this contact\u2019s phone number and nothing else — no lead record and no WhatsApp profile name. '
        + 'The number itself is real: it came from WAHA\u2019s own contact lookup, not from parsing the chat id.',
  },
  unidentified: {
    label: 'Unidentified',
    short: 'Unidentified',
    tone: 'warm',
    named: false,
    /* Rewritten 1 Sep 2026. This used to claim the state "should no longer
       occur" after the 24 Aug backfill. Live it occurs once, on
       +918517942172@whatsapp.lead, and the reason has nothing to do with the
       backfill: `identified` is computed from the two exact joins in
       v_conversations, and a whatsapp.lead key matches neither, so the view can
       only report what it could not find. Telling an operator that a routine,
       explainable state is an anomaly to escalate is its own kind of false
       alarm. The one thing that must never happen — a bare chat handle shown as
       a person — is still enforced, in normalise() and titleOf(). */
    note: 'v_conversations resolved no lead, no WhatsApp profile name and no phone number for this thread. It '
        + 'tries three exact joins and no others — leads.email against the thread key, whatsapp_contacts.chat_id '
        + 'against the thread’s chat_id, and whatsapp_contacts.lead_email against the thread key — so a key of the '
        + 'synthetic +<digits>@whatsapp.lead shape lands here whatever else is known about the person: no leads '
        + 'row carries that address, the thread has no chat_id, and no contact row carries it in lead_email '
        + 'either. The last-9 rule in lib/identity.js is applied on top of this, against the other rows in this '
        + 'list AND against the leads table, and says so wherever it finds something — so "unidentified" here '
        + 'means the view could not resolve the thread, never that nobody knows who this is.',
  },
};
const identOf = t => IDENT[t.identified] || IDENT.unidentified;

/* What the thread key actually is, said plainly, so nobody mistakes a machine
   handle for something a human chose.

   Delegated to identity.js on 1 Sep 2026. The local version tested for an email
   with /^[^@\s]+@[^@\s]+\.[^@\s]+$/ AFTER the three WhatsApp suffixes, and
   `+918517942172@whatsapp.lead` passes that test: local part, '@', a dotted
   domain. So the key the router synthesises out of a phone number was labelled
   "email address" in the send confirmation, in the list sub-line and in the
   thread-key tooltip — a provenance claim about where an address came from,
   made confidently and wrong. describeKey() knows the fourth shape because it is
   built on the same table of shapes the matching uses. */
function keyKind(key) {
  const k = str(key);
  if (!k) return 'no thread key recorded';
  return describeKey(k);
}

const NO_N8N =
  'VITE_N8N_BASE_URL is not set in this build, so the browser has no n8n host to call and the '
  + 'whatsapp-send webhook cannot be reached. Replies have to go out from WhatsApp itself.';
const noChatWhy = t =>
  `This thread is keyed on "${t.key}" (${keyKind(t.key)}) and no chat_id is stored for it in `
  + 'v_conversations, so WAHA has no WhatsApp address to send to. Replying needs a chat_id, which '
  + 'only arrives when the contact messages the business number. If they are waiting, the reply has to be '
  + 'typed inside WhatsApp itself — nothing on this screen can send it for you.';

/* "Today" is today in Dubai. Comparing against the browser's own midnight put
   the separator in the wrong place for anyone outside the UAE — a message sent
   at 01:00 Dubai was filed under Yesterday for a reader in London — so the day
   is decided by comparing formatted Dubai dates rather than local midnights. */
/* The weekday is worth keeping on a separator, and it is the one shape the
   shared helpers do not emit — so the formatter is built here from the shared
   TZ constant rather than from a second copy of the zone name. */
const F_DAY = new Intl.DateTimeFormat('en-GB',
  { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const dayLabel = v => {
  const t = Date.parse(v);
  if (Number.isNaN(t)) return 'Undated';
  const day = dubaiDate(t, '');
  if (!day) return 'Undated';
  if (day === dubaiDate(Date.now(), '')) return 'Today';
  if (day === dubaiDate(Date.now() - 86400000, '')) return 'Yesterday';
  return F_DAY.format(new Date(t));
};

const preview = v => {
  const text = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!text) return '<span class="t-muted">No message text recorded</span>';
  return esc(text.length > 68 ? text.slice(0, 68) + '…' : text);
};

/* One view row → one thread. A row with no thread_key cannot be opened, replied
   to, or attributed to anybody, so it is dropped and counted rather than shown
   as a nameless conversation. */
function normalise(r) {
  const key = str(r.thread_key);
  if (!key) return null;
  const ident = IDENT[r.identified] ? r.identified : 'unidentified';
  const shown = str(r.display_name);
  /* The view falls back to the raw key when it has nothing better. Since the
     backfill it never has to, but the guard stays: it costs one comparison and
     it is the only thing standing between a LID handle and the name column if a
     contact lookup is ever slower than the first inbound message. */
  const isKey = !shown || shown === key;
  /* The other fallback in that chain is the phone number itself, which is what
     `phone_only` means. A number is an identifier, not a name, and printing it
     in the name slot with the same number formatted beside it reads as two
     different facts about the same person. So a display_name that is just the
     phone is not treated as a name: the number moves to the phone slot, where it
     is formatted, and the name slot says we do not have one. The 6-digit floor
     keeps a genuinely name-less row with no phone from matching '' === ''. */
  const shownDigits = phoneDigits(shown);
  const isPhoneAsName = shownDigits.length >= 6 && shownDigits === phoneDigits(r.phone);
  const named = IDENT[ident].named && !isKey && !isPhoneAsName;
  /* The shared identity for this one row, and nothing borrowed from any other.
     `links` is deliberately empty here — the transitive closure across rows is
     done once in linkThreads() below, with the whole list in hand, so that a
     thread cannot quietly absorb a neighbour's email during a per-row pass. */
  const identity = expandIdentity({
    threadKey: key,
    chatId: str(r.chat_id) || '',
    email: str(r.lead_email) || '',
    phone: str(r.phone) || '',
    name: str(r.lead_name) || (named ? shown : ''),
  });
  /* The digits a key carries when the view has no phone for the thread. This is
     a fact about the row itself — `+918517942172@whatsapp.lead` IS the number —
     and it is kept separate from `phone` so that phoneHtml can say which of the
     two it is showing rather than presenting both as "stored in
     v_conversations.phone". Empty for a LID, whose digits are a machine id. */
  const keyDigits = phoneDigits(r.phone) ? '' : (identity.digits || '');
  return {
    key,
    chat_id: str(r.chat_id) || null,
    phone: str(r.phone) || null,
    keyDigits: keyDigits || null,
    push_name: str(r.push_name) || null,
    lead_email: str(r.lead_email) || null,
    lead_name: str(r.lead_name) || null,
    lead_status: str(r.lead_status) || null,
    identified: ident,
    name: named ? shown : '',
    identity,
    /* The nine-digit comparison form the backend joins on. '' when the row
       carries no phone at all, and an empty suffix never matches another empty
       one — identity.js is explicit about that and linkThreads relies on it. */
    suffix: identity.suffix || '',
    /* Filled by linkThreads(): other rows in this same list that are the same
       person. Never a name, always the sibling rows themselves. */
    siblings: [],
    /* EVERY row the view filed under this person, markers included. `count` is
       what loadMessages() checks its own read against, and that read is over
       every row too, so the two have to be counted the same way. */
    count: Number(r.message_count) || 0,
    inbound: Number(r.inbound_count) || 0,
    outbound: Number(r.outbound_count) || 0,
    last_at: r.last_message_at || null,
    last_message: r.last_message == null ? '' : String(r.last_message),
    last_direction: low(r.last_direction),
    /* MESSAGES only, straight from the view. Until 1 Sep 2026 this screen had no
       such figures: it subtracted one marker back out of outbound_count and
       called the answer a floor, because v_conversations exposed no per-row
       channel and only the NEWEST row could be tested from a thread row.
       `comm_taxonomy_views_own_the_rule` moved the test into the view, where
       every row can be tested, so these are exact. `msgCount == null` means the
       column did not come back — an older view, or a select that lost it — and
       every caller falls back to the old floor and says which it used, rather
       than printing an exact-looking number it did not get. */
    msgCount: r.msg_count == null ? null : Number(r.msg_count) || 0,
    msgInbound: r.msg_inbound_count == null ? null : Number(r.msg_inbound_count) || 0,
    msgOutbound: r.msg_outbound_count == null ? null : Number(r.msg_outbound_count) || 0,
    internalCount: r.internal_count == null ? null : Number(r.internal_count) || 0,
    /* The newest thing anybody actually said, either direction. NOT last_at: on
       a thread the silence detector has escalated they are different moments,
       and the gap between them is the twelve hours of silence that made it fire.
       null when this thread holds no message at all. */
    last_msg_at: r.last_msg_at || null,
    last_msg: r.last_msg == null ? '' : String(r.last_msg),
    last_msg_direction: low(r.last_msg_direction),
    /* The newest row in this thread is one of the dealership's own internal
       notes, not a message anybody sent or received. The view now answers this
       directly with `internal_count` and `last_msg_at`; the text test is kept as
       the fallback for the same reason the counts have one, and both spellings
       agree on every row on file. Everywhere `last_message`, `last_direction` or
       `outbound` would otherwise be spoken about as a message, this flag is
       consulted first. */
    lastIsMarker: r.last_msg_at != null && r.last_message_at != null
      ? Date.parse(r.last_msg_at) !== Date.parse(r.last_message_at)
      : isMarkerText(r.last_message),
    awaiting: r.awaiting_reply === true,
  };
}

/* Which rows in this list are the same human being.

   The rule is the backend's, not ours: `nexus_lead_for_comm_key()` resolves a
   log key to a lead by the last nine digits of the phone, and every key in
   communication_logs was written by a workflow that used that rule.
   `expandIdentity` is the same rule in the browser, so grouping on
   `identity.suffix` reproduces the join v_conversations does not do.

   Two guards, both load-bearing. A LID contributes no suffix — identity.js
   refuses to read its digits as a number — so two unrelated LIDs can never be
   welded together here. And a group of more than two rows is left UNLINKED and
   flagged: three rows sharing nine digits is either one person filed three ways
   or a genuine suffix collision between two people, the last-9 rule cannot tell
   which, and merging on it would put two customers' histories in one pane. That
   is the same refusal identity.js makes in AMBIGUITY.PHONE_SUFFIX_COLLISION. */
function linkThreads(list) {
  const bySuffix = new Map();
  list.forEach(t => {
    if (!/^[0-9]{9}$/.test(t.suffix)) return;
    if (!bySuffix.has(t.suffix)) bySuffix.set(t.suffix, []);
    bySuffix.get(t.suffix).push(t);
  });
  const collisions = [];
  bySuffix.forEach((group, suffix) => {
    if (group.length < 2) return;
    if (group.length > 2) {
      collisions.push({ suffix, threads: group });
      return;
    }
    group.forEach(t => { t.siblings = group.filter(x => x !== t); });
  });
  return collisions;
}

/* Every key the whole person is filed under, across the row and its siblings.
   One identity for a linked pair means the pane holds the same history whichever
   of the two rows was clicked — the alternative is two panes of 17 and 12 for
   one customer, which is the split this screen exists to stop showing. */
const groupOf = t => [t, ...(t.siblings || [])];
/* `pool` added 1 Sep 2026 (§1b). Passing the leads rows in is what turns this
   from "which keys is this person filed under" into "and which lead is that",
   and it is the same second argument screens/leads.js:407,
   screens/overview.js:840 and lib/lead-drawer.js:253 pass. It is also the only
   way the PHONE_SUFFIX_COLLISION refusal can fire: with no pool, expandIdentity
   has nothing to collide against and reports a clean match it has not made.
   Default `[]` keeps the message read (loadMessages) matching exactly the keys
   it matched before — a lead row must not widen a history read. */
const groupIdentity = (t, pool) => expandIdentity(
  {
    threadKey: t.key,
    chatId: t.chat_id || '',
    email: t.lead_email || '',
    phone: t.phone || t.keyDigits || '',
    name: t.name || '',
  },
  {
    links: groupOf(t).map(x => ({
      thread_key: x.key,
      chat_id: x.chat_id || undefined,
      lead_email: x.lead_email || undefined,
      phone: x.phone || x.keyDigits || undefined,
      identified: x.identified,
    })),
    leads: Array.isArray(pool) ? pool : [],
  },
);
/* A sibling that has a name, for a row that does not. Returned with the sibling
   attached so every caller can attribute it rather than printing it flat. */
const namedSibling = t => (t.siblings || []).find(x => x.name) || null;
const groupCount = t => groupOf(t).reduce((s, x) => s + x.count, 0);

/* How many messages were actually SENT to this contact.

   `outbound_count` is `count(*) FILTER (WHERE direction = 'outbound')` over every
   row, and the two [SILENCE-ESCALATED] rows written before the detector was
   fixed carry direction 'outbound'. So the view counted each of them as a
   message sent to the customer: on 1 Sep 2026 Ali's thread reported 9 outbound
   when eight messages were sent to him and the ninth is the dealership's note
   that he went quiet, and Siva's reported 3 against 2.

   Until that day this screen subtracted the ONE marker it could see — the newest
   row — and printed the result as a floor, because v_conversations exposed no
   per-row channel and an older marker in the same history was invisible from a
   thread row. `comm_taxonomy_views_own_the_rule` put nexus_is_message() inside
   the view, so `msg_outbound_count` is the exact figure over every row, and the
   floor is now only the fallback for a view that has not been migrated.
   `outboundIsFloor` says which of the two a number is, wherever it is printed,
   and it is false whenever the exact column came back. */
const outboundIsFloor = t => t.msgOutbound == null
  && t.lastIsMarker && t.last_direction === 'outbound';
const realOutbound = t => (t.msgOutbound != null
  ? t.msgOutbound
  : Math.max(0, t.outbound - (t.lastIsMarker && t.last_direction === 'outbound' ? 1 : 0)));
/* The same two answers for the other three figures. Each returns the view's
   message-only column when it is there and the all-rows column when it is not,
   and `figuresAreExact` is what a caption consults before calling any of them a
   message count. */
const realInbound  = t => (t.msgInbound != null ? t.msgInbound : t.inbound);
const realCount    = t => (t.msgCount   != null ? t.msgCount   : t.count);
const figuresAreExact = t => t.msgCount != null;
/* The newest thing anybody said in this thread, as opposed to the newest row in
   it. They differ only on a thread the silence detector has escalated. */
const lastSaidAt = t => (t.last_msg_at != null ? t.last_msg_at : (t.lastIsMarker ? null : t.last_at));

/* Three states, and they are three different sentences. We know their name; we
   know their number but not their name; we know neither. The middle one is now
   the floor — the backfill guaranteed a number for everybody — so it reads as an
   ordinary, workable thread rather than as a failure. */
/* A fourth state was added on 1 Sep 2026, and it is the one to be careful with:
   the view does not know this row's name but another row in this same list does.
   A name reached through the last-9 rule is NOT the same claim as a name the
   view resolved, so it never appears alone \u2014 `linkWhy` travels with it into
   every title= that shows it, and `identified` stays whatever the view said. The
   alternative was leaving Ali's second thread reading "Unidentified contact"
   directly under his first, which is how one customer gets answered twice or not
   at all. The older rule is unchanged: a raw handle is never a name, whatever
   route it arrives by. */
const linkedName = t => (t.name ? '' : ((namedSibling(t) || {}).name || ''));
/* Where a borrowed name came from is two questions, not one: which row lent it,
   and how well that row knew it. Added 1 Sep 2026 \u2014 `namedSibling` will hand
   back a `whatsapp_profile` row's name just as readily as a `lead` row's, and a
   name the contact typed into their own WhatsApp profile is not the same claim
   as a name on a leads record. Borrowing it across a digit match and then
   presenting it with the confidence of the stronger one is two unverified steps
   stacked and reported as none. */
const NAME_SOURCE = {
  lead: 'that row is matched to a leads record, so the name is the dealership\u2019s own',
  whatsapp_profile: 'that row is not in leads either \u2014 the name is whatever the contact typed into their own '
    + 'WhatsApp profile, and nobody has verified it',
  phone_only: 'that row holds only a number, so the name did not come from the view at all',
  unidentified: 'that row is unidentified too, so the name did not come from the view at all',
};
const linkWhy = t => {
  const s = t.name ? null : namedSibling(t);
  if (!s) return '';
  return `This name is not v_conversations\u2019 answer for this thread \u2014 the view resolved nothing for it. It is `
    + `"${s.name}", taken from the thread keyed on "${s.key}", because both keys carry the same last ${SUFFIX_LEN} `
    + `digits (${t.suffix}) and that is the rule the backend joins a chat to a lead on. The two rows are one person; `
    + 'the view lists them separately because it matches on exact keys only. As for the name itself: '
    + `${NAME_SOURCE[s.identified] || NAME_SOURCE.unidentified}.`;
};
const anyPhone = t => addressPhone(t.phone) || addressPhone(t.keyDigits);
const titleOf = t => t.name || linkedName(t) || (anyPhone(t) ? 'Name not known' : 'Unidentified contact');
/* The middle branch used to say "no lead record matches it" unconditionally,
   which is a claim about the leads table made from the absence of a NAME.
   Corrected 1 Sep 2026 alongside §1b: a contact can be a lead and still have no
   name on this screen, and Effco Contracting llc — lead 35 — was one. */
const titleWhy = t => t.name
  ? ''
  : (linkWhy(t)
      || (anyPhone(t)
          ? 'We have this contact\u2019s phone number but no name: v_conversations resolved no lead name for it and '
            + 'they have set no WhatsApp profile name. ' + leadWhy(t)
          : identNote(t)));
/* Initials off a borrowed name would read as though the view had named the row,
   and an avatar cannot carry the attribution that name requires. */
const avatarOf = t => t.name ? esc(initials(t.name)) : '?';

/* The phone, beside the name, everywhere a thread is listed. This is the whole
   point of the LID backfill: the number is the one identifier that is now true
   for every contact, and it is the thing an operator actually acts on — dials
   it, searches WhatsApp for it, reads it back to a colleague. So it travels with
   the name into the list rows, the pane header, the alert strip and the send
   confirmation, instead of living only in the detail view. */
function phoneHtml(t, cls) {
  const c = cls == null ? 'cell-sub' : cls;
  const readable = addressPhone(t.phone);
  if (readable) return `<span class="mono ${c}" title="Stored in v_conversations.phone as ${esc(t.phone)}">${esc(readable)}</span>`;
  /* Something is stored but it does not read as a number. Show it exactly as
     stored — formatting it would turn a handle into a phone number nobody has. */
  if (t.phone) return `<span class="mono ${c}" title="${esc('Stored in v_conversations.phone as-is. It reads as a ' + keyKind(t.phone) + ', not a dialable number, so it is shown exactly as stored and not formatted as one.')}">${esc(t.phone)}</span>`;
  /* The view has no phone and the key carries one. Added 1 Sep 2026: this is the
     row that read "No number on file" for +918517942172@whatsapp.lead — a
     warning, in amber, about a number sitting in the string beside it. It is a
     different fact from the line above and it says so: the digits come from the
     thread key, not from whatsapp_contacts, and nobody has verified that the
     workflow which minted that key had the number right. */
  const fromKey = addressPhone(t.keyDigits);
  if (fromKey) {
    return `<span class="mono ${c}" title="${esc('Not stored in v_conversations.phone — whatsapp_contacts has no row for this thread on either of the joins the view makes, chat_id or lead_email. These digits are read out of the thread key itself ("' + t.key + '", a ' + keyKind(t.key) + '), which the workflows synthesise from the number they were handed. Nobody has verified that number against WAHA the way a whatsapp_contacts row has been. It is the same last-' + SUFFIX_LEN + '-digit form the backend matches on.')}">${esc(fromKey)}</span>`;
  }
  return `<span class="t-warm ${c}" title="${esc(NO_PHONE_WHY)}">No number on file</span>`;
}

/* The reply address, as itself. Since the view was rebuilt the identity and the
   address are two different strings — this customer is keyed on his email and
   answered on a LID handle — so anywhere a message is about to be sent, the
   address it is going to is printed rather than inferred from the name above it.
   Rendered in mono and never in a name position: a chat id names nobody. */
function chatHtml(t, cls) {
  const c = cls == null ? 'cell-sub' : cls;
  if (!t.chat_id) return `<span class="t-warm ${c}">no WhatsApp address stored</span>`;
  return `<span class="mono ${c}" title="${esc('v_conversations.chat_id — the WhatsApp address WAHA sends to (' + keyKind(t.chat_id) + '). The thread itself is keyed on "' + t.key + '", which identifies the person; it is not an address and nothing is ever sent to it.')}">${esc(t.chat_id)}</span>`;
}

/* ── What this contact is in the leads table (§1b) ───────────────────────────

   `t.leadMatch` is written once per thread by resolveLead() inside the screen,
   because the answer needs a database read while every renderer here has to
   stay pure and synchronous — none of them may issue a query. Four states, and
   the difference between them is the whole point of this block:

     matched    — lib/identity.js reached one or more rows in `leads`.
     none       — it reached none, and the read it looked in succeeded.
     ambiguous  — two leads end in the same nine digits; it refused to pick.
     unknown    — the leads read failed or has not finished. NOT "none".

   A thread rendered before annotateLeads() has run carries no `leadMatch` at
   all, which is `unknown` for the same reason. Nothing below ever says "not in
   leads" from anything except `none`. */
const LEAD_UNRESOLVED = { state: 'unknown', leads: [], via: '', suffix: '', capped: false, message: '' };
const leadOf = t => (t && t.leadMatch) || LEAD_UNRESOLVED;
/* Only ever the row of a settled, single match. An 'ambiguous' result carries
   its candidates so they can be NAMED in the explanation, and this must not
   hand one of them out as though it were the answer. */
const leadRow = t => (leadOf(t).state === 'matched' ? leadOf(t).leads[0] : null) || null;
/* The status to print for this contact. v_conversations' own column first — it
   is what the rest of the product reads — and otherwise the status on the row
   lib/identity.js reached. Both are `leads.status`; the second exists only
   because the view's exact joins could not see the lead. */
const leadStatusOf = t => str(t.lead_status) || str((leadRow(t) || {}).status);
const LEAD_POOL_CAP_WHY =
  `The leads read stopped at ${LEAD_POOL_LIMIT} rows, so a lead older than those was not in the set this was `
  + 'checked against and would read as no match here.';

/* The long form, for a title=. Said once, so the sub-line, the pane, the Open
   lead button and the send confirmation cannot describe the same match four
   different ways — which is exactly how the old lead_email-only rule survived in
   five places at once. */
const leadWhy = t => {
  const m = leadOf(t);
  if (m.state === 'unknown') return LEADS_UNKNOWN;
  if (m.state === 'ambiguous') return m.message ? `${LEADS_AMBIGUOUS} ${m.message}` : LEADS_AMBIGUOUS;
  if (m.state === 'none') return NOT_A_LEAD + (m.capped ? ' ' + LEAD_POOL_CAP_WHY : '');
  const l = m.leads[0];
  const rest = m.leads.length - 1;
  return `This contact is row ${str(l.id)} of the leads table`
    + (str(l.name) ? ` (${str(l.name)})` : '')
    + `, status ${str(l.status) || 'not recorded'}, phone ${str(l.phone) || 'not recorded'}, email `
    + `${str(l.email) || 'the empty string'}. `
    + (m.via === 'address'
        ? 'It was matched on an address this thread is already filed under.'
        : `It was matched on the last ${SUFFIX_LEN} digits of the phone number (${m.suffix}) — the rule `
          + 'nexus_lead_for_comm_key() and every workflow that wrote these rows use to join a chat to a lead. '
          + 'lib/identity.js applies it here. A @lid handle carries no phone digits of its own; the number came '
          + 'from the whatsapp_contacts row v_conversations already read it out of.')
    + (t.lead_email
        ? ''
        : ' v_conversations returned no lead_email for this thread, because it matches leads on an exact '
          + 'address and this thread’s key is not one — so the view on its own would have reported this '
          + 'contact as unknown to the dealership.')
    + (rest > 0 ? ` ${num(rest)} further leads ${plural(rest, 'row matches', 'rows match')} the same person.` : '');
};

/* The short form, for the sub-line under a name. */
const leadBit = t => {
  const m = leadOf(t);
  if (m.state === 'unknown') return `<span class="t-warm" title="${esc(LEADS_UNKNOWN)}">Lead match unchecked</span>`;
  if (m.state === 'ambiguous') return `<span class="t-warm" title="${esc(leadWhy(t))}">Two leads share these digits — not matched</span>`;
  if (m.state === 'none') return `<span class="t-muted" title="${esc(NOT_A_LEAD)}">Not in leads</span>`;
  const l = m.leads[0];
  return `<span class="t-muted" title="${esc(leadWhy(t))}">In leads as ${esc(str(l.email) || 'lead ' + str(l.id))}`
    + `${m.via === 'suffix' ? `, matched on the last ${SUFFIX_LEN} digits` : ''}</span>`;
};

/* The identity pill's hover text, with the leads answer attached to it.
   `identified` is v_conversations' verdict and stays the view's; what the leads
   table holds is a second, independent fact — and before 1 Sep 2026 the first
   was quietly asserting the second. IDENT.whatsapp_profile carried the words
   "there is no lead record for them" for every thread the view could not
   resolve, Effco Contracting llc among them, who is lead 35. */
const identNote = t => {
  const base = identOf(t).note;
  const m = leadOf(t);
  if (m.state === 'matched') return `${base} The leads table itself, matched through lib/identity.js: ${leadWhy(t)}`;
  if (m.state === 'none') {
    return `${base} lib/identity.js finds no leads row for it on the last-${SUFFIX_LEN}-digit rule either`
      + `${m.capped ? ', within the rows read. ' + LEAD_POOL_CAP_WHY : '.'}`;
  }
  return `${base} ${leadWhy(t)}`;
};

/* The lead's status, as a pill that cannot be read as anything else.

   See the severity pill in renderAlerts() for the collision this labelling ends.
   `WARM` and `HOT` are BOTH lead statuses and alert severities in this product,
   rendered by the same component out of the same table of tones. Measured live
   1 Sep 2026: Siva Thangavelu wore `pill dead` DISQUALIFIED on screens/leads.js
   and a bare `pill warm` WARM in this screen's alert strip, beside his name, in
   one session — and nothing on either screen said which vocabulary its pill was
   speaking. Every pill this file renders beside a person now carries the noun. */
const leadStatusPill = t => {
  const s = leadStatusOf(t);
  if (!s) return '';
  const own = Boolean(str(t.lead_status));
  const why = 'leads.status — this contact’s stage in the lead lifecycle. It is not the severity of any '
    + 'alert; the two vocabularies share the words HOT, WARM and COLD. '
    + (own
        ? 'Read from v_conversations.lead_status for this thread.'
        : `v_conversations resolved no lead for this thread, so this is the status of the row lib/identity.js `
          + `matched. ${leadWhy(t)}`);
  return `<span title="${esc(why)}">${pill(`${s} lead`, tone(s), { verbatim: false })}</span>`;
};

/* The line under the name. The phone has moved up beside it, so what is left
   here is the rest of what we hold: the matched lead\u2019s email, or — when
   nothing in leads matches — the fact that the bot is not allowed to answer them
   automatically, which is the reason a human is looking at this row at all. The
   raw handle appears only when there is no name, and only labelled as an
   address. */
function subLine(t) {
  const bits = [];
  /* Order matters, and it is order of specificity. v_conversations' own answer
     first, because it is the one the rest of the product reads; then the linked
     thread's, which names the row that IS matched; then lib/identity.js's, which
     is the only one of the three that can see lead 35. Each says whose answer it
     is rather than being folded into a single "In leads". */
  if (t.lead_email) bits.push(esc(t.lead_email));
  /* "Not in leads" is a claim about the leads table, and on a linked row it was
     a false one: Ali's whatsapp.lead thread has no lead_email of its own and IS
     in leads, under the sibling's address. Added 1 Sep 2026 — the sibling's
     answer is stated as the sibling's. Kept ahead of leadBit() deliberately:
     both are true for that row, and the sibling sentence is the one that
     explains why there are two rows on this screen at all. */
  else if (t.siblings.some(s => s.lead_email)) {
    const s = t.siblings.find(x => x.lead_email);
    bits.push(`<span class="t-muted" title="${esc('v_conversations returned no lead_email for this thread, because it matches leads on an exact address and this thread is keyed on "' + t.key + '". The same person’s other thread is matched, to ' + s.lead_email + ', and the two share the last ' + SUFFIX_LEN + ' digits ' + t.suffix + '.')}">In leads as ${esc(s.lead_email)}, via the linked thread</span>`);
  } else bits.push(leadBit(t));
  if (t.siblings.length) {
    bits.push(`<span class="chip" title="${esc(sameAsWhy(t))}">Same person as ${esc(t.siblings.map(s => titleOf(s)).join(', '))}</span>`);
  }
  if (!t.name && !linkedName(t) && t.key) bits.push(`<span class="mono" title="${esc(keyKind(t.key))}">${esc(t.key)}</span>`);
  return bits.join(' · ');
}

/* Said once, so the list row, the pane banner and the send confirmation cannot
   describe the same link three different ways. */
const sameAsWhy = t =>
  `v_conversations lists ${num(1 + t.siblings.length)} separate threads for this person because it groups on exact `
  + `keys: this one on "${t.key}", ${t.siblings.map(s => '"' + s.key + '"').join(' and ')}. All of them carry the `
  + `same last ${SUFFIX_LEN} phone digits (${t.suffix}), which is the rule nexus_lead_for_comm_key() and every `
  + 'workflow that wrote these rows use to join a chat to a lead, and lib/identity.js applies it here. The rows are '
  + 'left separate so the counts on this screen keep agreeing with v_needs_attention and the nav badge, which count '
  + 'view rows — but the message pane reads the whole person, so opening either row shows the same history.';

SCREENS.conversations = async host => {
  /* Order on the page is order of urgency. The alert strip is what somebody is
     waiting on right now; the KPIs are the shape of the inbox; the inbox itself
     is where the work happens. */
  const alertHost = el('div');
  alertHost.style.marginBottom = '16px';
  const strip = el('div', 'grid g4');
  const wrap  = el('div', 'card flush');
  wrap.style.marginTop = '16px';
  host.appendChild(alertHost);
  host.appendChild(strip);
  host.appendChild(wrap);

  let threads = [], dropped = 0, capped = false;
  let attn = [], attnError = null;
  /* Rows the last-9 rule found more than two of. Not linked, deliberately —
     see linkThreads() — and reported rather than swallowed. */
  let collisions = [];
  /* v_workflow_health for the two workflows this screen depends on, and the
     read's own outcome. `null` is "we have not been told", which is not the same
     as DEGRADED and not the same as healthy; every branch below distinguishes
     the three rather than letting an unread view render as an all-clear. */
  let bdcHealth = null, sendHealth = null, healthError = null, healthRead = false;
  let q = '', filter = 'all', selected = null;
  /* Which of the two layouts is currently on screen. The shell is a function of
     how many threads there are, so a re-read that crosses SPLIT_MIN has to
     rebuild it — otherwise a second thread arrives into a screen with nowhere to
     list it, or the last one leaves a list column holding one row. */
  let shellSolo = null;

  /* ── Thread → leads (§1b) ─────────────────────────────────────────────────
     The pool this screen matches threads against, and the outcome of reading it.
     `leadPoolRead === false` and `leadPoolError !== null` are two different
     states and NEITHER of them is "not in leads"; resolveLead() collapses both
     to 'unknown' and every renderer distinguishes 'unknown' from 'none'. Getting
     that wrong is the same class of fault as the one this block exists to
     remove: a screen answering a question it did not ask. */
  let leadPool = [], leadPoolRead = false, leadPoolError = null, leadPoolCapped = false;

  async function readLeadPool() {
    const rows = await db(`leads?select=${LEAD_POOL_COLS}&order=created_at.desc&limit=${LEAD_POOL_LIMIT}`);
    return { rows, capped: rows.length >= LEAD_POOL_LIMIT };
  }

  /* One expansion per thread, over the whole linked group, against the pool.

     This is the identical call the lead drawer and Overview make in the other
     direction — a person in, every key they could be filed under out — with the
     leads rows supplied as candidates so that expandIdentity can either absorb
     one or REFUSE. The refusal matters as much as the match: two customers whose
     numbers end in the same nine digits cannot be told apart by the rule the
     backend joins on, and picking either would attach a conversation to the
     wrong person's record with an Open lead button on top of it.

     Live 1 Sep 2026 19:00 UTC, over 12 threads and 3 leads: four threads match
     (+971547484167@whatsapp.lead → 34, 111948809162873@lid → 35,
     shabbir53ujjainwala@gmail.com → 38, +918517942172@whatsapp.lead → 38 through
     its linked sibling), eight match nothing, and no suffix is shared, so the
     collision branch is inert on today's data. It is still written and still
     tested first, because a thirteenth contact is one WhatsApp message away. */
  function resolveLead(t) {
    if (!leadPoolRead || leadPoolError) {
      return { state: 'unknown', leads: [], via: '', suffix: t.suffix || '', capped: false, message: '' };
    }
    const idn = groupIdentity(t, leadPool);
    const collision = (idn.ambiguityCodes || []).includes(AMBIGUITY.PHONE_SUFFIX_COLLISION);
    const rows = (idn.leadIds || [])
      .map(id => leadPool.find(l => l && String(l.id) === String(id)))
      .filter(Boolean);
    if (collision && !rows.length) {
      const a = (idn.ambiguity || []).find(x => x.code === AMBIGUITY.PHONE_SUFFIX_COLLISION);
      return {
        state: 'ambiguous', leads: [], via: '', suffix: idn.suffix || '',
        capped: leadPoolCapped, message: (a && a.message) || '',
      };
    }
    /* A second refusal, and it is NOT redundant with the one above.

       Found while testing this change on 1 Sep 2026 and reported rather than
       patched, because lib/identity.js is not this screen's file:
       AMBIGUITY.PHONE_SUFFIX_COLLISION is raised by counting DISTINCT EMAIL
       ADDRESSES among the leads sharing the suffix, and a lead whose email
       column is the empty string contributes none. Probed directly against the
       shipped module — two leads ending 505433953, one of them email-less —
       expandIdentity returns leadIds ['35','99'], ambiguous:false, and adopts
       the other lead's address as this person's email. With BOTH email-less it
       does the same. That is precisely lead 35's shape, so the one row this
       screen most needed the refusal for is the row the refusal cannot see.

       So the count of matched leads is checked here as well. More than one lead
       row is never opened from a thread on this screen: either two people share
       nine digits, or one person is duplicated in `leads`, and nothing in the
       database says which. Offering a button that opens one of them is a guess
       made silently, which is the same fault as the sentence this whole change
       removed, wearing better clothes. */
    if (rows.length > 1) {
      return {
        state: 'ambiguous', leads: rows, via: '', suffix: idn.suffix || '', capped: leadPoolCapped,
        message: `${num(rows.length)} leads rows match this thread — `
          + rows.map(l => `${str(l.id)} ${str(l.name) || 'unnamed'} (${str(l.phone) || 'no phone'})`).join(', ')
          + '. They may be one customer entered twice or two people whose numbers end in the same nine digits, '
          + 'and the last-nine-digit rule the backend joins on cannot tell those apart, so none of them is '
          + 'opened from here.',
      };
    }
    /* Which of the two rules found it. An exact key this thread is already filed
       under is a stronger statement than nine matching digits, and the screen
       prints which one it was rather than presenting both as "matched". */
    const rawKeys = new Set((idn.keys || []).map(k => str(k).toLowerCase()));
    const byAddress = rows.length > 0 && rows.every(l => str(l.email) && rawKeys.has(str(l.email).toLowerCase()));
    return {
      state: rows.length ? 'matched' : 'none',
      leads: rows,
      via: byAddress ? 'address' : 'suffix',
      suffix: idn.suffix || '',
      capped: leadPoolCapped,
      message: '',
    };
  }

  /* Written onto the thread rows so every renderer reads one answer computed
     once, rather than each calling expandIdentity again and getting to disagree.
     Called after readThreads() everywhere readThreads() is called. */
  function annotateLeads(list) {
    list.forEach(t => { t.leadMatch = resolveLead(t); });
  }

  /* ── Read the view ───────────────────────────────────────────────────── */
  async function readThreads() {
    const rows = await db(`v_conversations?select=${VIEW_COLS}&order=last_message_at.desc&limit=${THREAD_LIMIT}`);
    const list = [];
    let bad = 0;
    for (const r of rows) {
      const t = normalise(r);
      if (t) list.push(t); else bad++;
    }
    /* The view is keyed one row per thread, but a defensive de-dupe keeps a
       repeated key from opening two rows onto the same conversation. */
    const seen = new Set();
    const uniq = list.filter(t => (seen.has(t.key) ? false : (seen.add(t.key), true)));
    uniq.sort((a, b) => ts(b.last_at) - ts(a.last_at));
    /* Linking happens here, on the finished list, so every consumer of
       `threads` — strip, list, pane, alerts, send confirmation — sees the same
       sibling sets. Doing it per row inside normalise() could not, because a
       row cannot see the rows that come after it. */
    const clash = linkThreads(uniq);
    return { list: uniq, dropped: bad, capped: rows.length >= THREAD_LIMIT, collisions: clash };
  }

  /* The health of the workflow that fills this inbox, and of the one the Send
     button calls. Read as its own query so it can fail on its own: an
     unreadable v_workflow_health must not take the conversations down with it,
     and — the rule this screen keeps everywhere — must not come back as an
     all-clear either. Nothing here interprets `status`; lib/health.js owns
     that, and the view has already applied nexus_outcome_class(). */
  async function readHealth() {
    const rows = await db(`v_workflow_health?select=${HEALTH_COLS}`
      + `&name=in.(${[WF_BDC, WF_SEND].map(n => '%22' + encodeURIComponent(n) + '%22').join(',')})`);
    /* A workflow missing from the registry comes back as null here, and null is
       carried into `bdcHealth` / `sendHealth` unchanged. That is what makes the
       three states distinguishable downstream: healthError is "the read failed",
       null is "the read worked and the registry has no such row", and a row is a
       row. A count of returned rows was also being handed back with a comment
       saying the absence "is reported as one" — nothing read it, and the report
       it described is the null branch in healthLine(). Removed 1 Sep 2026 rather
       than left as a field that looks like it is doing that work. */
    return {
      bdc: rows.find(r => str(r.name) === WF_BDC) || null,
      send: rows.find(r => str(r.name) === WF_SEND) || null,
    };
  }

  /* v_needs_attention is the one place that decides what needs a human, and it
     already says which screen each row belongs to. Reading our own slice of it
     — rather than recomputing "who is waiting" locally — is what keeps this
     strip, the nav badge and Overview from being three different answers to the
     same question asked at three different moments. A failed read is reported as
     a failed read; it never silently degrades into a shorter list. */
  async function readAlerts() {
    return db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen'
      + `&screen=eq.conversations&order=at.desc&limit=${ATTN_LIMIT}`);
  }

  const threadFor = ref => {
    const r = str(ref);
    if (!r) return null;
    return threads.find(t => t.chat_id === r)
        || threads.find(t => t.key === r)
        || threads.find(t => t.lead_email === r)
        || null;
  };

  /* Alerts this screen can see that the view cannot, derived from the thread
     rows already in memory — no second round-trip for a decoration. All three
     are about the same population the view cares about; they exist because the
     unanswered_chat branch has edges it cannot reach past.

     One: the branch looks back seven days, so a thread that has been waiting
     eight is waiting just as hard and is reported by nothing. Two: `ref` is a
     chat_id, so a thread that has no chat_id cannot appear in it at all — and
     that same missing chat_id is what makes it unanswerable from this dashboard,
     so it has to be answered in WhatsApp itself by a human who is told to.

     Three, added 1 Sep 2026: unanswered_chat is `WHERE v.awaiting_reply`, and
     awaiting_reply is `last_direction = 'inbound'`. A thread whose newest row is
     the silence detector's own [SILENCE-ESCALATED] marker therefore cannot
     appear in it, whatever state it is in — and that marker exists precisely
     because the thread had gone twelve hours without an answer and was escalated
     to a person. Live 1 Sep 2026 that is two threads, Ali and Siva Thangavelu,
     and before this branch existed the strip said "Nobody is waiting on a reply"
     over both of them. WARM and not HOT: a human was pinged on Slack when the
     marker was written, so this is "check that landed", not "nobody knows". */
  function derivedAlerts(viewRefs) {
    const out = [];
    threads.forEach(t => {
      if (t.lastIsMarker && !viewRefs.has(t.chat_id) && !viewRefs.has(t.key)) {
        const d = daysSince(t.last_at);
        out.push({
          kind: 'silence_escalated', severity: 'WARM', ref: t.chat_id || t.key, thread: t,
          title: titleOf(t), at: t.last_at, derived: true,
          detail: (isMarkerText(t.last_message)
              ? `The 12-hour silence detector escalated this thread ${ago(t.last_at)} and wrote its `
                + `${SILENCE_MARKER} marker as the newest row${d != null ? `, ${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'} ago` : ''}. `
                + 'Nothing has been logged on the thread since. The marker is the dealership’s own note that the '
                + 'customer went quiet — it is not a message to them and not a reply'
              : `The newest row on this thread, written ${ago(t.last_at)}, is one of the dealership’s own internal `
                + 'rows rather than a message. Its body is not the silence detector’s, so what wrote it is not '
                + 'named here — it is not a message to the customer and not a reply')
            + (t.last_direction === 'outbound'
                ? ' — but because it sits in the direction column as an outbound, v_conversations reads this thread '
                  + 'as answered and v_needs_attention.unanswered_chat, which keys on that, cannot list it at all.'
                : `. The last thing anybody actually said on it was ${lastSaidAt(t) ? ago(lastSaidAt(t)) : 'never — no row on this thread is a message'}, `
                  + 'and v_needs_attention.unanswered_chat keys on awaiting_reply, which this row makes false.'),
        });
        return;
      }
      if (!t.awaiting) return;
      if (viewRefs.has(t.chat_id) || viewRefs.has(t.key)) return;
      const d = daysSince(t.last_at);
      if (!t.chat_id) {
        out.push({
          kind: 'no_whatsapp_address', severity: 'HOT', ref: t.key, thread: t,
          title: titleOf(t), at: t.last_at, derived: true,
          detail: `Waiting since ${ago(t.last_at)}, and this thread has no chat_id in v_conversations, so it `
            + 'cannot be replied to from here at all and never reaches the unanswered_chat alert, whose ref is a '
            + 'chat_id. Somebody has to answer it inside WhatsApp.',
        });
        return;
      }
      if (d != null && d > CHAT_WINDOW_DAYS) {
        out.push({
          kind: 'waiting_past_window', severity: 'WARM', ref: t.chat_id, thread: t,
          title: titleOf(t), at: t.last_at, derived: true,
          detail: `Waiting ${Math.floor(d)} days — past the ${CHAT_WINDOW_DAYS}-day window that `
            + 'v_needs_attention.unanswered_chat looks back over, so it has dropped off that list and off the nav '
            + 'badge. It is still unanswered.',
        });
      }
    });
    return out.sort((a, b) => ts(a.at) - ts(b.at));
  }

  function renderAlerts() {
    const viewRefs = new Set((attn || []).map(a => str(a.ref)).filter(Boolean));
    const fromView = (attn || []).map(a => ({
      kind: str(a.kind) || 'attention',
      severity: str(a.severity) || 'HOT',
      ref: str(a.ref),
      title: str(a.title),
      detail: str(a.detail),
      at: a.at,
      thread: threadFor(a.ref),
      derived: false,
    }));
    const derived = derivedAlerts(viewRefs);
    /* Urgency first, then oldest first inside each band. Sorting by timestamp
       alone would put a three-hour-old HOT under a six-day-old WARM; sorting by
       severity alone would leave the person who has waited longest at the
       bottom of the HOT block. Both are the wrong first row. */
    const RANK = { hot: 0, warm: 1, cold: 2 };
    const rank = s => (RANK[low(s)] == null ? 3 : RANK[low(s)]);
    const rows = [...fromView, ...derived]
      .sort((a, b) => rank(a.severity) - rank(b.severity) || ts(a.at) - ts(b.at));

    if (!rows.length) {
      /* No box. An empty bordered card with a heading over it reads as a panel
         that failed to load, and it takes up the space the real thing needs.

         What goes here instead is a sentence that says what is empty, why it is
         empty and what would put a row in it. Since the non-customer threads
         were deleted this is the branch that renders every day, so it has to
         read as an answer rather than as an absence. */
      const waitingNow = threads.filter(t => t.awaiting).length;
      const icon = attnError ? 'error' : (waitingNow ? 'schedule' : 'check_circle');
      const cls  = attnError ? 't-warm' : (waitingNow ? 't-warm' : 't-ok');
      const why = attnError
        ? `<span class="t-warm">v_needs_attention could not be read (${esc(attnError)}), so whether anybody is `
          + 'waiting on a human is unknown right now. The conversations below are complete; none of them has been '
          + 'triaged.</span>'
        : !threads.length
          ? '<span class="t-muted">Nothing to triage, because there are no conversations. A row appears here the '
            + 'moment somebody messages the dealership number and no answer goes back.</span>'
          : waitingNow
            ? `<span class="t-warm">${num(waitingNow)} ${plural(waitingNow, 'conversation', 'conversations')} below `
              + `${plural(waitingNow, 'ends', 'end')} on a message from the customer, but v_needs_attention has filed `
              + 'none of them against this screen.</span> <span class="t-muted">Nothing outside this page is '
              + 'reminding anyone about them — check the thread before assuming it is handled.</span>'
            : `<span class="t-ok">Nobody is waiting on a reply.</span> <span class="t-muted">v_needs_attention lists `
              + `no unanswered chat for this screen, and ${threads.length === 1
                  ? 'the one conversation in the inbox does not end'
                  : `none of the ${num(threads.length)} conversations ends`} on a message from a customer that has `
              + 'gone unanswered, nor on a silence-escalation marker. A row appears here when one does, stays for the '
              + `${num(CHAT_WINDOW_DAYS)} days the view looks back over, and after that this screen goes on `
              + 'reporting it here on its own.</span>';
      alertHost.innerHTML = `<div class="cell-sub" style="padding:2px 2px 0;display:flex;gap:8px;align-items:flex-start">
          <span class="material-symbols-outlined ${cls}" aria-hidden="true" style="font-size:18px">${icon}</span>
          <span style="white-space:normal">${why}</span>
        </div>`;
      return;
    }

    const items = rows.map((a, i) => {
      const t = a.thread;
      /* The view puts `display_name` in `title`, and display_name is allowed to
         fall back to the chat handle. It no longer does, but this strip is not
         the place to find out the hard way: a handle is rendered as an address,
         and the thread we resolved is what supplies the name and the number. */
      const name = t ? titleOf(t) : (isHandle(a.title) ? '' : a.title);
      const handle = t ? '' : (isHandle(a.title) ? a.title : '');
      const phone = t
        ? phoneHtml(t)
        : (addressPhone(a.ref) ? `<span class="mono cell-sub" title="From the alert\u2019s ref: ${esc(a.ref)}">${esc(addressPhone(a.ref))}</span>` : '');
      /* An alert we cannot resolve to a row is still a real alert, so it is
         listed — but it is not made to look clickable, and it says why it is
         not, rather than silently doing nothing when it is clicked. */
      const dead = t ? '' : ` <span class="t-muted">No thread in the list below matches this alert\u2019s ref (${esc(a.ref) || 'none recorded'})`
        + `, so it cannot be opened from here — it is either older than the newest ${num(THREAD_LIMIT)} threads read, or keyed on something the view does not group on.</span>`;
      /* THE PILL. Until 1 Sep 2026 evening this was `${pill(a.severity)}` — the
         bare word, in the shared component, immediately left of a person's name.
         `HOT`, `WARM` and `COLD` are the vocabulary of v_needs_attention.severity
         AND of leads.status, and lib/format.js tones them from one table, so the
         same component renders both in the same colour with nothing to say which
         is meant. Measured live on 1 Sep 2026 19:00 UTC: Siva Thangavelu is
         `pill dead` DISQUALIFIED on screens/leads.js and was `pill warm` WARM
         here, beside his name and his number, in one session. Ali's row read
         WARM and IS WARM, which made the collision harder to notice rather than
         easier — and that agreement is a coincidence, because every derived row
         row on this screen assigns its own severity from its kind — WARM for
         silence_escalated and waiting_past_window, HOT for no_whatsapp_address,
         see derivedAlerts — and Ali's lead status happens to be the word his
         row's kind was already going to print.

         The noun is now in the label, which is why `tone()` has to be passed
         explicitly: pill() derives its colour from the label, and "WARM severity"
         is not a word its table knows. Where the thread resolves to a lead, the
         lead's own status is printed beside it with its own noun, so the two can
         be read together instead of one being mistaken for the other — which on
         lead 35 is the difference between "HOT, answer this person" and
         "DISQUALIFIED, somebody already took them out of the queue".

         Provenance is on the hover, because the two severities on this strip do
         not come from the same place: a v_needs_attention row is the view's
         triage, a derived row is this screen's own and was never triaged by
         anything. */
      const sevWhy = (a.derived
        ? 'The severity of this alert, decided by this screen from the kind of gap it is: nothing in '
          + 'v_needs_attention covers this thread, so nothing outside this page has triaged it. '
          + (a.kind === 'silence_escalated'
              ? 'A silence escalation is filed WARM rather than HOT because a human was pinged on Slack when the '
                + 'marker was written — it is "check that landed", not "nobody knows".'
              : a.kind === 'no_whatsapp_address'
                ? 'A thread with no chat_id is filed HOT: it cannot be answered from this dashboard at all, so '
                  + 'somebody has to be told to answer it inside WhatsApp.'
                : 'A thread past the view\u2019s look-back window is filed WARM: it is still unanswered, but it '
                  + 'is not new.')
        : 'v_needs_attention.severity — the view\u2019s triage of this alert. Every unanswered_chat row it emits '
          + 'is HOT; the value is a constant in the view, not a judgement about this particular person.')
        + ' It is not a lead status. HOT, WARM and COLD are words in both vocabularies and this product renders '
        + 'them with the same component, which is why this one carries the noun.';
      const sevTone = tone(a.severity) || 'unknown';
      return `<div class="list-item" ${t ? `role="button" tabindex="0" data-a="${i}"` : ''}
           style="align-items:flex-start;cursor:${t ? 'pointer' : 'default'}">
          <span class="material-symbols-outlined" aria-hidden="true"
                style="font-size:20px">${a.kind === 'unanswered_chat' ? 'mark_chat_unread'
                    : (a.kind === 'no_whatsapp_address' ? 'link_off'
                    : (a.kind === 'silence_escalated' ? 'notifications_paused' : 'schedule'))}</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
              <span title="${esc(sevWhy)}">${pill(`${a.severity} severity`, sevTone, { verbatim: false })}</span>
              <span style="font-weight:500${name ? '' : ';font-style:italic'}" class="${name ? '' : 't-muted'}">${esc(name || 'Unidentified contact')}</span>
              ${phone}
              ${t ? leadStatusPill(t) : ''}
              ${handle ? `<span class="mono cell-sub" title="${esc(keyKind(handle))}">${esc(handle)}</span>` : ''}
              <span class="chip">${esc(a.kind)}</span>
            </div>
            <div class="cell-sub" style="white-space:normal">${esc(a.detail)}${dead}</div>
          </div>
          <span class="cell-sub" style="flex-shrink:0" title="${esc(stamp(a.at))}">${esc(ago(a.at))}</span>
        </div>`;
    }).join('');

    const hot = rows.filter(a => low(a.severity) === 'hot').length;
    alertHost.innerHTML = `<div class="card flush">
        <div class="card-head">
          <div>
            <div class="card-title">Waiting on a human</div>
            <div class="card-sub">${num(rows.length)} item${rows.length === 1 ? '' : 's'}${hot ? ` · ${num(hot)} urgent` : ''}
              · ${num(fromView.length)} from v_needs_attention for this screen${derived.length
                ? `, ${num(derived.length)} this screen can see that the view cannot`
                : ''}.
              A thread the bot chose not to answer is not a failure — that is the allowlist working — but somebody still has to reply.</div>
          </div>
        </div>
        ${attnError ? `<div style="padding:0 20px 12px"><div class="banner warm">
          <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">error</span>
          <div>v_needs_attention could not be read (${esc(attnError)}), so only the items this screen derived for itself are listed. The triaged list is missing, not empty.</div>
        </div></div>` : ''}
        ${items}
      </div>`;

    alertHost.querySelectorAll('[data-a]').forEach(node => {
      const open = () => {
        const a = rows[Number(node.dataset.a)];
        if (!a || !a.thread) return;
        /* Clear the search and filter first. An alert that selects a row hidden
           behind a filter looks like a click that did nothing. */
        q = ''; filter = 'all';
        const box = $('cvQ'); if (box) box.value = '';
        pressFilter();
        drawList();
        openThread(a.thread.key);
        $('cvPane')?.scrollIntoView({ block: 'nearest' });
      };
      node.addEventListener('click', open);
      node.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
  }

  async function refreshAlerts() {
    try { attn = await readAlerts(); attnError = null; }
    catch (e) { attn = []; attnError = e.message; }
    renderAlerts();
  }

  async function boot() {
    alertHost.innerHTML = `<div class="cell-sub" style="padding:2px">${esc('Checking what needs a human\u2026')}</div>`;
    /* The strip chooses its own layout once the rows are counted, so it loads
       and fails as one box rather than as a quarter of a four-up grid. */
    strip.className = 'card flush';
    strip.innerHTML = stateLoading(2);
    wrap.style.display = 'block';
    wrap.style.minHeight = '';
    wrap.innerHTML = stateLoading(8);

    /* Both reads start together — the attention view does not depend on the
       thread list — but the strip is only painted once the threads are in, since
       resolving an alert to the row it is about is the whole reason it is
       clickable. Its failure is captured rather than thrown: an unreadable
       attention view must not take the inbox down with it. */
    const alertsRead = readAlerts().then(
      rows => ({ rows, error: null }),
      e => ({ rows: [], error: e.message }));
    /* Third independent read, settled the same way. The workflow health belongs
       in the summary strip beside the inbox, and it must be able to fail without
       either taking the inbox down or coming back as silence — see §3a. */
    const healthP = readHealth().then(
      h => ({ h, error: null }),
      e => ({ h: null, error: e.message }));
    /* Fourth independent read, settled the same way: the leads pool §1b matches
       threads against. It is started here rather than lazily on the first pane
       because the strip's "matched to a lead" figure and the "Not in leads" tab
       both need it before anything is drawn — and because a lazy read would mean
       the list rows said one thing on first paint and another a moment later. Its
       failure is a stated absence, never a "no". */
    const leadsP = readLeadPool().then(
      r => ({ r, error: null }),
      e => ({ r: null, error: e.message }));

    let read;
    try {
      read = await readThreads();
    } catch (e) {
      const a = await alertsRead;
      attn = a.rows; attnError = a.error;
      renderAlerts();
      strip.className = 'card flush';
      strip.innerHTML = stateError('the inbox summary', e.message);
      wrap.innerHTML = stateError('conversations', e.message, 'reload');
      wrap.querySelector('[data-retry]')?.addEventListener('click', boot);
      return;
    }
    threads = read.list; dropped = read.dropped; capped = read.capped;
    collisions = read.collisions;

    /* Awaited before anything is painted, so no renderer ever sees the
       'unknown' state on a read that was merely still in flight. */
    const lp = await leadsP;
    leadPoolRead = true; leadPoolError = lp.error;
    leadPool = lp.r ? lp.r.rows : [];
    leadPoolCapped = Boolean(lp.r && lp.r.capped);
    annotateLeads(threads);

    const hp = await healthP;
    healthRead = true; healthError = hp.error;
    bdcHealth = hp.h ? hp.h.bdc : null;
    sendHealth = hp.h ? hp.h.send : null;

    const a = await alertsRead;
    attn = a.rows; attnError = a.error;
    renderAlerts();
    renderStrip();

    if (!threads.length) {
      wrap.innerHTML = stateEmpty(
        dropped ? 'No conversation can be addressed' : 'No conversations yet',
        dropped
          ? `${num(dropped)} ${plural(dropped, 'row has', 'rows have')} no thread_key in v_conversations, so there is `
            + 'no contact to attach those messages to and no thread that could be opened or replied to.'
          : 'v_conversations returned no rows, so no message in communication_logs resolves to a person. A thread '
            + 'appears here as soon as somebody messages the dealership WhatsApp number, or the agent sends its '
            + 'first message — the view groups every log row onto one contact, so the first message is also the '
            + 'first thread.',
        'forum');
      return;
    }

    renderShell();
    drawList();
    const oldest = oldestWaiting();
    openThread((oldest || threads[0]).key);
  }

  const oldestWaiting = () => {
    const w = threads.filter(t => t.awaiting);
    return w.length ? w.reduce((a, t) => (ts(t.last_at) < ts(a.last_at) ? t : a)) : null;
  };

  /* ── Summary strip ──────────────────────────────────────────────────────
     Every number here is a count of rows the view returned. Nothing is averaged
     or expressed as a share: with one thread in the inbox a percentage is a
     restatement of 100%, and a "distribution" over one row is a sentence about
     that row wearing a chart's clothes.

     The one exception is the WhatsApp BDC agent's 30-day success rate, which is
     not this screen's arithmetic — see §3a and healthLine() below. */

  /* The state of the agent that fills this inbox, in one sentence, in the strip.

     Added 1 Sep 2026 for a specific reason. §3 tells an operator that a quiet
     thread is the allowlist working as designed rather than a workflow that
     crashed. That is only a safe thing to say while the workflow is not, in
     fact, crashing. Read live 1 Sep 2026: WhatsApp BDC AI Agent is DEGRADED,
     119 successes over 286 rated runs in 30 days — 41.6% — with 166 failures.
     Counted against the same window on 1 Sep 2026: 139 of those 166 name a
     timeout, 11 a runner that went unresponsive and 15 the Model Ladder node;
     the newest is 31 Aug 15:06, "Task request timed out after 60 seconds",
     failed at WAHA Auth Gate.
     An inbox with nothing in the outbound column and a healthy agent is the
     allowlist; the same inbox with an agent failing three runs in five is
     something else, and the strip must not let the operator read the first
     while the second is true.

     Three rules, all from lib/health.js:
       · the words for a health value come from HEALTH_WORDS, never from a
         comparison written here, and a value not in that closed set is printed
         verbatim rather than mapped to a verdict it may not mean;
       · the rate is recomputed with successRate(successes_30d,
         effective_runs_30d) rather than taken from success_rate_30d, so the
         screen and the view can disagree out loud instead of one being trusted;
       · a zero denominator is not 0% and not 100%. successRate returns null and
         the absence is named.
     And a failed read is not a healthy workflow: healthError renders as its own
     sentence, not as silence. */
  function healthLine() {
    if (!healthRead) return '';
    if (healthError) {
      return `<div style="margin-top:6px"><span class="t-warm">v_workflow_health could not be read `
        + `(${esc(healthError)}), so whether the WhatsApp agent behind this inbox is working is unknown right `
        + 'now.</span> <span class="t-muted">The conversations above are unaffected — they come from '
        + 'v_conversations, which loaded.</span></div>';
    }
    if (!bdcHealth) {
      return `<div style="margin-top:6px"><span class="t-warm">v_workflow_health has no row named `
        + `<span class="mono">${esc(WF_BDC)}</span></span> <span class="t-muted">— it is the workflow that logs `
        + 'every message in this inbox, and nothing here can say whether it is running. Its absence from '
        + 'workflow_registry is itself worth fixing.</span></div>';
    }
    const h = str(bdcHealth.health).toUpperCase();
    const known = Object.prototype.hasOwnProperty.call(HEALTH_WORDS, h);
    const words = healthWords(h);
    const eff = Number(bdcHealth.effective_runs_30d);
    const ok30 = Number(bdcHealth.successes_30d);
    const rate = successRate(ok30, eff);
    const bad = Number(bdcHealth.failures_30d) + Number(bdcHealth.partials_30d);
    /* A rate with a zero denominator is the reason, not a number. */
    const rateText = rate == null
      ? (Number.isFinite(eff) && eff === 0
          ? 'no rated runs in the last 30 days, so there is no success rate to report — every run in the window was refused by design or escalated on purpose'
          : 'v_workflow_health did not return the counts a success rate is computed from, so none is shown')
      : `${pct(rate)} of its ${num(eff)} rated ${plural(eff, 'run', 'runs')} succeeded in the last 30 days`;
    /* The screen's own arithmetic against the view's column, said aloud where
       they differ rather than one being quietly preferred. */
    const viewRate = bdcHealth.success_rate_30d == null ? null : Number(bdcHealth.success_rate_30d);
    const disagree = (rate != null && viewRate != null && Math.abs(rate - viewRate) >= 0.05)
      ? ` <span class="t-warm">v_workflow_health’s own success_rate_30d column says ${esc(String(viewRate))}%, which is not what its counts come to.</span>`
      : '';
    const tone = h === 'HEALTHY' ? 't-ok' : (words.tone === 'ok' ? 't-ok' : (words.tone === 'hot' ? 't-hot' : 't-muted'));
    return `<div style="margin-top:6px"><span class="${tone}">The WhatsApp agent behind this inbox is `
      + `${esc(known ? words.label : h)}.</span> <span class="t-muted">${esc(known ? words.blurb : 'v_workflow_health returned a health value lib/health.js does not define, so it is printed as it came rather than mapped to a verdict.')} `
      + `${esc(rateText)}${bad ? `, with ${num(bad)} ${plural(bad, 'run that failed or went out half-done', 'runs that failed or went out half-done')}` : ''}. `
      + `A thread with no reply in it may be the allowlist working as intended — but while this workflow is `
      + `${esc(known ? words.label.toLowerCase() : 'in this state')}, it may equally be a run that never finished.</span>${disagree}</div>`;
  }
  function renderStrip() {
    const awaiting = threads.filter(t => t.awaiting);
    const oldest = oldestWaiting();
    /* MESSAGES across the whole inbox, not rows. `t.count` is every row the view
       filed under each person and it includes the silence detector's own notes,
       so the headline read "N messages" over a total that had internal
       bookkeeping in it. `realCount` is the view's message-only column where it
       came back. `msgsExact` is false if any thread fell back, and the caption
       says so rather than printing a total that is exact for some rows and not
       others without distinguishing them. */
    const msgs = threads.reduce((s, t) => s + realCount(t), 0);
    const msgsExact = threads.every(figuresAreExact);
    const internalTotal = threads.reduce((s, t) => s + (t.internalCount || 0), 0);
    const capNote = capped
      ? `<span class="t-warm">Only the newest ${num(THREAD_LIMIT)} threads were read, so this is not the whole inbox.</span>`
      : '';
    const dropNote = dropped
      ? `<span class="t-warm">${num(dropped)} ${plural(dropped, 'row has', 'rows have')} no thread_key in v_conversations and could not be attached to anybody.</span>`
      : '';

    /* Zero threads. Filed as C1 by the 31 Aug audit and fixed here on 1 Sep:
       this function ran before boot()'s empty-state return, and the solo branch
       below tests `=== 1`, so an inbox of nothing fell into the four-tile branch
       and printed "Every thread ends with a message we sent", "Every thread has
       a real phone number" and "Every thread has a WhatsApp address" — three
       green statements universally quantified over the empty set, directly above
       a card saying there were no conversations. All three are vacuously true
       and every one of them reads as an all-clear. An empty inbox is not an
       all-clear; it is either a dealership nobody has messaged or a read that
       came back with nothing, and the two are worth telling apart. */
    if (!threads.length) {
      strip.className = 'card';
      strip.innerHTML = `
        <div style="display:flex;gap:12px;align-items:flex-start">
          <span class="material-symbols-outlined t-muted" aria-hidden="true" style="font-size:20px">inbox</span>
          <div style="min-width:0">
            <div class="label-caps">The whole inbox</div>
            <div class="kpi-value sm" style="white-space:normal">No conversations</div>
            <div class="kpi-sub" style="white-space:normal">
              v_conversations returned no rows${dropped ? `, and ${num(dropped)} ${plural(dropped, 'row was', 'rows were')} dropped for having no thread_key` : ''}.
              Nothing is claimed about reply times, phone coverage or whether anything is repliable — there is
              nothing to claim it about, and a tile reading 0 beside the words "every thread" is a statement about
              an empty set dressed as an all-clear.
              ${capNote}${dropNote}
              ${healthLine()}
            </div>
          </div>
        </div>`;
      return;
    }

    /* One thread is not an inbox, and four KPI tiles reading 1 / 0 / 1 / 1 make
       it look like one that has been emptied by an outage. The same facts are
       stated as facts instead, and the tiles come back when there is more than
       one thread to compare. */
    if (threads.length === 1) {
      const t = threads[0];
      const who = t.name || linkedName(t) || (anyPhone(t) || 'this contact');
      /* The middle branch used to read "The newest message in the thread is one
         the dealership sent." On a thread sitting on a [SILENCE-ESCALATED] row
         that is false twice over: nothing was sent, and the row is there because
         the customer stopped answering. Corrected 1 Sep 2026 — the marker gets
         its own sentence and never borrows the reply one. */
      const reply = t.awaiting
        ? `<span class="t-hot">Reply due.</span> The newest message is theirs, logged ${esc(ago(t.last_at))}, and nothing has gone back.`
        : t.lastIsMarker
          ? `<span class="t-warm">${isMarkerText(t.last_message) ? `Escalated for silence ${esc(ago(t.last_at))}` : `An internal note was logged ${esc(ago(t.last_at))}`}.</span> The newest row in this thread `
            + `is ${isMarkerText(t.last_message) ? `the detector’s own ${esc(SILENCE_MARKER)} note` : 'one of the dealership’s own internal rows'}, not a message. `
            /* Was "The last real message was ours and the customer has not
               answered it" — asserted flat, on every marker thread, with nothing
               behind it. It is true of both live ones, and it is a claim about a
               row this screen can now actually read: `last_msg_direction`. */
            + (t.last_msg_direction === 'outbound'
                ? `The last real message was ours, ${esc(ago(lastSaidAt(t)))}, and the customer has not answered it.`
                : t.last_msg_direction === 'inbound'
                  ? `The last real message was theirs, ${esc(ago(lastSaidAt(t)))}, and nothing has gone back.`
                  : 'v_conversations returned no direction for the last message on this thread, so which side spoke last is not stated here.')
          : (realOutbound(t)
              ? '<span class="t-ok">No reply due.</span> The newest message in the thread is one the dealership sent.'
              : '<span class="t-muted">No reply due, and nothing has ever been sent to this contact either.</span>');
      const send = !N8N_BASE
        ? `<span class="t-hot">Sending is off.</span> ${esc(NO_N8N)}`
        : (t.chat_id
            ? `<span class="t-ok">Repliable from here.</span> Replies go to ${chatHtml(t, '')}.`
            : '<span class="t-warm">Not repliable from here.</span> No chat_id is stored for this thread, so there is no WhatsApp address to send to.');
      /* "Customer" is a claim about a person, not a synonym for "contact": it is
         only made when a row in leads matches. */
      const whole = (capped || dropped)
        ? ''
        : 'This is every conversation the view holds — not a page of a longer list. ';
      strip.className = 'card';
      strip.innerHTML = `
        <div style="display:flex;gap:28px;flex-wrap:wrap;align-items:flex-start">
          <div style="flex:1 1 340px;min-width:0">
            <div class="label-caps">The whole inbox</div>
            ${/* "Customer" is a claim about a person and it was being made from
                  v_conversations.lead_email, which is null for a lead the view's
                  exact joins cannot see. It follows the resolved answer from
                  1 Sep 2026 evening, and says "one contact" where the leads read
                  did not come back rather than either word. */''}
            <div class="kpi-value sm" style="white-space:normal">${num(msgs)} ${plural(msgs, 'message', 'messages')}, <span title="${esc(leadWhy(t))}">${leadOf(t).state === 'matched' ? 'one customer' : 'one contact'}</span></div>
            <div class="kpi-sub" style="white-space:normal">
              ${num(realInbound(t))} from ${esc(who)}, ${num(realOutbound(t))} sent back${outboundIsFloor(t)
                ? ` <span class="t-warm" title="${esc('v_conversations.outbound_count is ' + t.outbound + ' because it counts every row with direction \'outbound\', and the newest row here is the silence detector\'s ' + SILENCE_MARKER + ' marker, written with that direction before the detector was fixed. The view\'s msg_outbound_count column, which counts messages only, did not come back on this read — so one marker has been taken out here and any older marker in this history has not. This figure is a floor. Open the thread for the exact count.')}">(a floor — v_conversations says ${num(t.outbound)} and its message-only count did not load)</span>`
                : (t.internalCount
                    ? ` <span class="t-muted" title="${esc('v_conversations counts ' + t.count + ' rows for this contact and ' + t.internalCount + ' of them are the dealership\'s own internal notes — the silence detector\'s ' + SILENCE_MARKER + ' marker and rows like it. The figures here are msg_inbound_count and msg_outbound_count, which count only rows public.nexus_is_message() accepts.')}">(${num(t.internalCount)} further ${plural(t.internalCount, 'row is', 'rows are')} an internal note, not a message)</span>`
                    : '')}${lastSaidAt(t)
                ? `, newest ${esc(ago(lastSaidAt(t)))}`
                : ', and nothing in it is a message'}.
              ${whole}One thread is not a sample, so nothing on this screen is averaged, ranked or shown as a share.
              ${capNote}${capNote && dropNote ? ' ' : ''}${dropNote}
              ${healthLine()}
            </div>
          </div>
          <div style="flex:1 1 260px;min-width:0">
            <div class="label-caps">Where it stands</div>
            <div class="cell-sub" style="margin-top:8px;white-space:normal">${reply}</div>
            <div class="cell-sub" style="margin-top:6px;white-space:normal">${send}</div>
          </div>
        </div>`;
      return;
    }

    const by = { lead: 0, whatsapp_profile: 0, phone_only: 0, unidentified: 0 };
    threads.forEach(t => { by[t.identified] = (by[t.identified] || 0) + 1; });
    /* The leads answer, beside the view's (§1b). `by.lead` is how many threads
       v_conversations resolved with its exact joins; `inLeads` is how many are
       actually a lead once lib/identity.js has applied the last-nine-digit rule.
       Live 1 Sep 2026 19:00 UTC those are 2 and 4 — the tile read "2 matched to
       a lead" over an inbox in which Effco Contracting llc (lead 35) and Ali's
       second thread (lead 38) were both leads and both uncounted. Threads and
       not people: everything else on this screen counts view rows, and the two
       numbers are printed together rather than one replacing the other. */
    const inLeads = threads.filter(t => leadOf(t).state === 'matched');
    const leadPeople = new Set(inLeads.flatMap(t => leadOf(t).leads.map(l => String(l.id)))).size;
    const notInLeads = threads.filter(t => leadOf(t).state === 'none').length;
    const leadUnknown = threads.filter(t => leadOf(t).state === 'unknown').length;
    const leadAmbiguous = threads.filter(t => leadOf(t).state === 'ambiguous').length;
    const withChat = threads.filter(t => t.chat_id).length;
    const noChat = threads.length - withChat;
    /* Counts the number wherever it is — v_conversations.phone, or the digits a
       whatsapp.lead / c.us key carries. Before 1 Sep this counted only the first,
       and Ali's second thread went into "no number on file" holding his number. */
    const withPhone = threads.filter(t => anyPhone(t)).length;
    const noPhone = threads.length - withPhone;
    const fromKeyOnly = threads.filter(t => !addressPhone(t.phone) && addressPhone(t.keyDigits)).length;
    /* Rows that are one person. `people` is the headline the operator actually
       has in mind; `threads.length` is what v_needs_attention and the nav badge
       count, so it stays the number on the tile and the difference is named. */
    const linked = threads.filter(t => t.siblings.length);
    const people = threads.length - linked.reduce((s, t) => s + t.siblings.length, 0) / 2;
    const markerThreads = threads.filter(t => t.lastIsMarker);
    /* Waiting, but older than the view looks back — so nobody is being reminded
       about them except this screen. Named beside the headline rather than
       folded into it, because the headline is the view's number and this is not. */
    const outsideWindow = awaiting.filter(t => {
      const d = daysSince(t.last_at);
      return d != null && d > CHAT_WINDOW_DAYS;
    }).length;

    /* The grid moved inside a wrapper on 1 Sep 2026 so the agent-health sentence
       (§3a) can sit under the tiles at full width. It is a sentence and not a
       fifth tile deliberately: it is not a count of this inbox, it is the state
       of the workflow that fills it, and a number in the same row as four inbox
       counts would read as one of them. */
    strip.className = '';
    const tiles = [
      /* The tile counts view rows, because that is what everything else on the
         product counts. When the last-9 rule finds two of those rows to be one
         person the sub-line says so rather than the headline moving — a headline
         that disagreed with the nav badge would be a worse problem than the one
         it fixed. */
      kpi('Conversations', num(threads.length),
        `<span title="${esc(msgsExact
            ? `Summed from v_conversations.msg_count, which counts only rows public.nexus_is_message() accepts.${internalTotal ? ` A further ${internalTotal} row${internalTotal === 1 ? '' : 's'} across this inbox ${internalTotal === 1 ? 'is' : 'are'} the dealership's own internal notes — the 12-hour silence detector's markers and rows like them — and ${internalTotal === 1 ? 'is' : 'are'} not counted here.` : ''}`
            : 'At least one thread fell back to v_conversations.message_count, which counts every row filed under a contact including the dealership\'s own internal notes, because the message-only column did not come back on this read. This total therefore mixes two populations.')}">${num(msgs)} ${plural(msgs, 'message', 'messages')} logged</span>`
        + (msgsExact ? '' : ' <span class="t-warm">(not all message-only)</span>')
        + (linked.length
          ? ` · <span class="t-warm" title="${esc(sameAsWhy(linked[0]))}">${num(threads.length)} rows, ${num(people)} people — `
            + `${num(linked.length / 2)} ${plural(linked.length / 2, 'pair is', 'pairs are')} one customer filed under two keys</span>`
          : '')
        + (collisions.length
          ? ` · <span class="t-hot" title="${esc('The last-' + SUFFIX_LEN + '-digit rule matched more than two threads to the same number. That is either one person filed three ways or two people whose numbers end in the same nine digits, and the rule cannot tell which — so none of them has been linked. lib/identity.js refuses the same merge for the same reason.')}">${num(collisions.length)} ${plural(collisions.length, 'group', 'groups')} share a number suffix and were deliberately not linked</span>`
          : '')
        + (capped ? ` · ${capNote}` : '')
        + (dropped ? ` · ${dropNote}` : '')),

      /* "Every thread ends with a message we sent" is the sentence the silence
         markers made false. Live 1 Sep 2026 two threads end on a marker, which
         is a row we wrote about a customer, not a message we sent to one — and
         because awaiting_reply is false for both, they were being counted into
         this green all-clear. Named separately, in amber, 1 Sep 2026. */
      kpi('Reply due', num(awaiting.length),
        (awaiting.length
          ? `<span class="t-hot">Oldest waiting since ${esc(ago(oldest.last_at))}</span>`
            + (outsideWindow
              ? ` · <span class="t-warm">${num(outsideWindow)} past the ${num(CHAT_WINDOW_DAYS)}-day alert window</span>`
              : '')
          : (markerThreads.length
              ? '<span class="t-muted">No thread ends on a customer message</span>'
              : '<span class="t-ok">Every thread ends with a message we sent</span>'))
        + (markerThreads.length
          ? ` · <span class="t-warm" title="${esc('v_needs_attention.unanswered_chat is WHERE awaiting_reply, and awaiting_reply is last_direction = \'inbound\'. A thread whose newest row is a ' + SILENCE_MARKER + ' marker can never satisfy it, so these threads appear in no alert anywhere. They are listed in the strip above instead.')}">${num(markerThreads.length)} ${plural(markerThreads.length, 'thread sits', 'threads sit')} on a silence-escalation marker and ${plural(markerThreads.length, 'is', 'are')} in no alert</span>`
          : ''),
        awaiting.length ? 't-hot' : ''),

      /* This tile used to count the people we could not identify, which after
         the backfill is a permanent zero — a number that never moves teaches an
         operator to stop reading the strip it sits in. It now counts the thing
         the backfill actually delivered, and keeps the identity breakdown in the
         sub-line where it is still worth knowing. `unidentified` is the view's
         word and stays the view's; where the last-9 rule has linked such a row
         to a named one, the sub-line says how many, because "unidentified" and
         "unidentified but we know who this is" are different things to act on. */
      kpi('Numbers on file', num(withPhone),
        (noPhone
          ? `<span class="t-warm">${num(noPhone)} ${plural(noPhone, 'thread has', 'threads have')} none</span>`
          : '<span class="t-ok">Every thread has a number</span>')
        + (fromKeyOnly
          ? ` · <span class="t-muted" title="${esc('v_conversations.phone comes from whatsapp_contacts, joined twice — on chat_id and on lead_email. A thread that matches neither has no row there and no phone from the view — but a key of the +<digits>@whatsapp.lead or <digits>@c.us shape carries the number itself, and those digits are read here. A LID is excluded: its digits are a machine id. A number read this way came from a workflow that minted the key; it has not been through WAHA’s contact lookup the way a stored one has.')}">${num(fromKeyOnly)} of them read out of the thread key, not from whatsapp_contacts</span>`
          : '')
        + ` · <span title="${esc('Threads whose contact lib/identity.js matches to a row in the leads table — on an address the '
              + 'thread is filed under, or on the last ' + SUFFIX_LEN + ' digits of its number, which is the rule '
              + 'nexus_lead_for_comm_key() and the workflows join on. Threads, not people: a person filed under two keys '
              + 'is two rows here, the same way every other count on this screen counts view rows.')}">${num(inLeads.length)} matched to a lead`
          + `${leadPeople && leadPeople !== inLeads.length ? ` (${num(leadPeople)} ${plural(leadPeople, 'person', 'people')})` : ''}</span>`
        + (leadUnknown
          ? ` · <span class="t-warm" title="${esc(LEADS_UNKNOWN)}">${num(leadUnknown)} unchecked — the leads read failed</span>`
          : ` · <span class="t-muted" title="${esc('v_conversations resolves a thread to a lead with exact joins only — lower(leads.email) against the thread key, and whatsapp_contacts by chat_id or lead_email. The identified column is that answer and is left as that answer everywhere on this screen. The figure beside it is lib/identity.js applying the backend’s last-nine-digit rule on top, which is what reaches a lead whose email column is empty or whose thread is keyed on a @lid.')}">v_conversations itself resolved ${num(by.lead)} of ${plural(inLeads.length, 'it', 'them')}</span>`)
        + (leadAmbiguous ? ` · <span class="t-warm" title="${esc(LEADS_AMBIGUOUS)}">${num(leadAmbiguous)} share a number suffix with more than one lead and were not matched</span>` : '')
        + (leadPoolCapped ? ` · <span class="t-warm">${esc(LEAD_POOL_CAP_WHY)}</span>` : '')
        + ` · ${num(notInLeads)} not in leads · ${num(by.whatsapp_profile)} WhatsApp name · ${num(by.phone_only)} number only`
        + (by.unidentified
          ? ` · <span class="t-warm" title="${esc(IDENT.unidentified.note)}">${num(by.unidentified)} the view could not identify`
            + `${linked.filter(t => t.identified === 'unidentified').length
                ? `, ${num(linked.filter(t => t.identified === 'unidentified').length)} of which the last-${SUFFIX_LEN}-digit rule links to a named thread`
                : ''}</span>`
          : ''),
        noPhone ? 't-warm' : ''),

      /* "Repliable from here" is a claim about a workflow as much as about a
         chat_id, and the workflow's own health is now beside it. whatsapp-send
         is registered writes_audit_log:false ON PURPOSE — a request/response
         endpoint the dashboard calls returns its outcome in the HTTP reply and
         this screen reads it at the moment of the send (§4). So NOT_INSTRUMENTED
         here is the design and is said as the design, not as a blind spot. */
      kpi('Repliable from here', num(withChat),
        (!N8N_BASE
          ? '<span class="t-hot">n8n host not configured — sending is off</span>'
          : noChat
            ? `<span class="t-warm">${num(noChat)} ${plural(noChat, 'thread has', 'threads have')} no chat_id and cannot be replied to</span>`
            : '<span class="t-ok">Every thread has a WhatsApp address</span>')
        + sendHealthNote()),
    ].join('');
    const hl = healthLine();
    strip.innerHTML = `<div class="grid g4">${tiles}</div>`
      + (hl ? `<div class="cell-sub" style="padding:12px 2px 0;white-space:normal">${hl}</div>` : '');
  }

  /* What v_workflow_health can and cannot tell us about the Send button. */
  function sendHealthNote() {
    if (!healthRead || healthError) return '';
    if (!sendHealth) {
      return ` · <span class="t-muted" title="${esc('workflow_registry has no row named "' + WF_SEND + '", so nothing describes the endpoint this button calls.')}">nothing registered for the send endpoint</span>`;
    }
    const h = str(sendHealth.health).toUpperCase();
    if (h === 'NOT_INSTRUMENTED' && sendHealth.writes_audit_log === false) {
      return ` · <span class="t-muted" title="${esc('The send workflow is registered with writes_audit_log false. That is deliberate: it answers the dashboard directly and this screen reads {status:\'sent\'} or {status:\'error\'} out of that reply, so the outcome of every send is known at the moment it happens without an audit row. Its health being unrated is therefore not a gap in the monitoring.')}">the send endpoint reports its outcome in its reply, not to audit_log</span>`;
    }
    const words = healthWords(h);
    if (h === 'HEALTHY') return '';
    return ` · <span class="t-warm" title="${esc(words.blurb)}">v_workflow_health reports the send workflow ${esc(Object.prototype.hasOwnProperty.call(HEALTH_WORDS, h) ? words.label : h)}</span>`;
  }

  /* ── Shell ───────────────────────────────────────────────────────────── */

  /* The tabs, described once. `optional` means the tab is drawn only when
     something is behind it: a filter that can only ever answer "no conversation
     matches" is furniture, and three of them in a row above a single conversation
     make a working screen look broken. `all` is never optional, because it is
     what the others return to. */
  const TABS = [
    { f: 'all', label: 'All', optional: false, count: () => threads.length, title: '' },
    { f: 'await', label: 'Reply due', optional: true,
      count: () => threads.filter(t => t.awaiting).length,
      title: 'Threads whose newest message is inbound with nothing sent after it (awaiting_reply in '
           + 'v_conversations). communication_logs has no read state, so this is derived from direction — it is not '
           + 'an unread flag.' },
    /* Not in leads is the distinction that decides whether anyone is coming: a
       number in `leads` may get an automatic reply, a number that is not only
       gets one if the message happened to carry a dealership keyword — and that
       keyword list is not in the database, so this tab is honest about being
       half the rule. */
    { f: 'notlead', label: 'Not in leads', optional: true,
      /* The count was `!t.lead_email` — v_conversations' nullable column — with a
         comment arguing that it had to stay that way so every count on this
         screen agreed with the view. That argument does not hold for this tab.
         It is not a count of view rows the way "Reply due" is; it is the answer
         to "is anyone coming for this person", and on 1 Sep 2026 it read 10 of
         12 while two of those ten were leads 35 and 38 — a filter offering an
         operator a list of strangers with two customers in it, one of them
         DISQUALIFIED. Counted on the resolved answer from 1 Sep 2026 evening
         (§1b): 8. A thread whose lead match is unknown because the leads read
         failed is NOT counted here, so the tab disappears rather than asserting
         a no it cannot support. */
      count: () => threads.filter(t => leadOf(t).state === 'none').length,
      title: NOT_A_LEAD + ' Counted per thread through lib/identity.js, not from v_conversations.lead_email: a '
           + 'thread the view could not resolve — a @lid key, or a lead whose email column is empty — is still '
           + 'in leads if the last-nine-digit rule reaches one, and is not counted here. Threads whose lead '
           + 'match could not be checked at all are also not counted, because "unchecked" is not "no".' },
    { f: 'unknown', label: 'Unidentified', optional: true,
      count: () => threads.filter(t => t.identified === 'unidentified').length,
      /* Rewritten 1 Sep 2026 alongside IDENT.unidentified.note, which said the
         same retracted thing: that the 24 Aug backfill made this state an
         anomaly. It did not. The state is what the view's three exact joins
         report when none of them matches, and a +<digits>@whatsapp.lead key
         matches none of them by construction. "All we hold is the chat handle"
         was false too — for the one such thread live, the handle IS the
         number. */
      title: 'Threads for which v_conversations resolved no lead, no WhatsApp profile name and no phone number. '
           + 'That is a statement about its three exact joins, not about how much is knowable: a thread keyed on '
           + '+<digits>@whatsapp.lead matches none of them however well the dealership knows the person, and the '
           + 'number is inside the key. Where the last-9-digit rule links such a thread to a named one, the row '
           + 'says so and stays in this tab, because the view’s answer is still "unidentified".' },
  ];

  function renderShell() {
    /* One conversation needs no chooser. A search box, four tabs and a 360px
       column holding a single row is a list that looks like it failed to load
       the rest of itself; the reading pane simply becomes the screen, and the
       summary above it says that this is the whole inbox rather than a page of
       it. The list comes back the moment there is a second thread. */
    shellSolo = threads.length < SPLIT_MIN;
    if (shellSolo) {
      wrap.style.display = 'block';
      wrap.style.gridTemplateColumns = '';
      wrap.style.minHeight = '';
      wrap.innerHTML = '<div style="display:flex;flex-direction:column;min-width:0;min-height:560px" id="cvPane"></div>';
      return;
    }

    const tabs = TABS.filter(t => !t.optional || t.count() > 0);
    wrap.style.display = 'grid';
    wrap.style.gridTemplateColumns = '360px minmax(0,1fr)';
    wrap.style.minHeight = '640px';
    wrap.innerHTML = `
      <div style="border-right:1px solid var(--border);display:flex;flex-direction:column;min-width:0">
        <div class="toolbar" style="border-bottom:1px solid var(--border-subtle)">
          <div class="grow">
            <label class="sr-only" for="cvQ">Search conversations</label>
            <input type="search" id="cvQ" placeholder="Search name, number, email, handle, last message" />
          </div>
        </div>
        ${tabs.length > 1 ? `<div class="toolbar" id="cvTabs" style="padding-top:0;border-bottom:1px solid var(--border-subtle)">
          <div class="seg" role="group" aria-label="Filter conversations">
            ${tabs.map(t => `<button type="button" data-f="${esc(t.f)}"${t.f === filter ? ' class="on"' : ''}
              aria-pressed="${t.f === filter ? 'true' : 'false'}"${t.title ? ` title="${esc(t.title)}"` : ''}
              >${esc(t.label)} ${num(t.count())}</button>`).join('')}
          </div>
        </div>` : ''}
        <div id="cvList" style="overflow-y:auto;flex:1"></div>
      </div>
      <div style="display:flex;flex-direction:column;min-width:0" id="cvPane"></div>`;

    $('cvQ').addEventListener('input', e => { q = low(e.target.value); drawList(); });
    wrap.querySelectorAll('.seg button').forEach(b => {
      b.addEventListener('click', () => { filter = b.dataset.f; pressFilter(); drawList(); });
    });
  }

  /* The pressed tab is painted from `filter`, never from which button was
     clicked, because a tab can also be removed underneath the operator — a reply
     empties "Reply due" — and the filter falls back to All when that happens. */
  function pressFilter() {
    wrap.querySelectorAll('.seg button').forEach(x => {
      const on = x.dataset.f === filter;
      x.classList.toggle('on', on);
      x.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* `chat_id` is in here as well as `thread_key`. They are different strings
     since the view was rebuilt — the identity and the address — and the address
     is the one printed under the composer and in the send confirmation, so it is
     the one an operator is most likely to paste back in to find the thread. */
  /* Widened 1 Sep 2026, and this was left half-done by the identity work. The
     list row for Ali's second thread shows the name "Ali" (borrowed from the
     linked thread) and his number (read out of the thread key) — and neither was
     in this string, so typing either one made the row he was looking at
     disappear. A screen may not be searchable by less than it displays: whatever
     titleOf() and phoneHtml() put on the row is what an operator will type. The
     sibling's lead_email is in here for the same reason — the sub-line prints
     "In leads as <address>, via the linked thread". None of this makes the
     borrowed name any more the view's answer; it makes the row findable. */
  /* The matched lead's own id, name, email and status joined 1 Sep 2026 evening
     for the same reason the borrowed name did: the list row for lead 35 now
     prints "In leads as lead 35" and the pane prints DISQUALIFIED beside his
     name, and neither string was searchable. */
  const haystack = t => [
    t.name, linkedName(t), t.key, t.chat_id || '', t.phone || '', addressPhone(t.phone),
    t.keyDigits || '', addressPhone(t.keyDigits), t.lead_email || '', t.push_name || '',
    ...(t.siblings || []).map(s => `${s.name} ${s.lead_email || ''} ${s.key}`),
    ...leadOf(t).leads.map(l => `${str(l.id)} lead ${str(l.id)} ${str(l.name)} ${str(l.email)} ${str(l.status)}`),
    t.last_message,
  ].join(' ').toLowerCase();

  /* Searching for a number has to work however the operator types it. The stored
     form is bare digits, the rendered form has spaces and a plus, and the person
     at the desk is reading it off a phone screen in a third shape again — so any
     query containing digits is also compared digits-to-digits. Three digits is
     the floor; below that every number in the inbox matches and the search stops
     meaning anything. */
  const matches = t => {
    if (!q) return true;
    if (haystack(t).includes(q)) return true;
    const qd = q.replace(/\D+/g, '');
    if (qd.length < 3) return false;
    /* Both places a number can live. `phone` is whatsapp_contacts' answer;
       `keyDigits` is the number sitting inside a whatsapp.lead or c.us thread
       key, which is the only number Ali's second thread has. Before 1 Sep this
       read `phone` alone, so the row that PRINTS +91 851 794 2172 could not be
       found by typing it with spaces in — the literal-string pass above only
       catches it typed exactly as the key spells it. A LID contributes nothing
       here, because normalise() leaves keyDigits empty for one. */
    const d = phoneDigits(t.phone) + ' ' + (t.keyDigits || '');
    /* A UAE number written the way it is dialled locally starts 050…, and the
       same number is stored 97150…. Dropping a leading zero is what makes the
       number on the operator's own phone screen find the row. */
    return d.includes(qd) || (qd.startsWith('0') && d.includes(qd.replace(/^0+/, '')));
  };

  const visible = () => threads.filter(t => {
    if (filter === 'await' && !t.awaiting) return false;
    if (filter === 'unknown' && t.identified !== 'unidentified') return false;
    if (filter === 'notlead' && leadOf(t).state !== 'none') return false;
    return matches(t);
  });

  /* The filter counts are painted from the current threads on every draw, not
     baked into the shell once. A reply changes the "Reply due" number the moment
     it is confirmed, and a tab reading 3 above a list showing 2 is the kind of
     small lie that makes an operator stop trusting the whole strip.

     A tab whose count reaches zero is removed rather than left reading 0: it can
     no longer do anything except answer "no conversation matches", and if it was
     the active filter it would be answering that right now — so the filter falls
     back to All. When nothing but All is left the whole bar goes, because a
     single filter that filters nothing is a control with no purpose. */
  function paintFilterCounts() {
    const seg = wrap.querySelector('.seg');
    if (!seg) return;
    let changed = false;
    TABS.forEach(t => {
      const b = seg.querySelector(`button[data-f="${t.f}"]`);
      if (!b) return;
      const n = t.count();
      if (t.optional && !n) {
        b.remove();
        if (filter === t.f) { filter = 'all'; changed = true; }
        return;
      }
      b.textContent = `${t.label} ${num(n)}`;
    });
    if (seg.querySelectorAll('button').length < 2) {
      $('cvTabs')?.remove();
      if (filter !== 'all') { filter = 'all'; changed = true; }
    } else if (changed) {
      pressFilter();
    }
  }

  function drawList() {
    /* Below SPLIT_MIN threads the shell draws no list at all, so there is
       nothing to paint and nothing to reconcile. Callers — the alert strip, a
       confirmed send — do not have to know which layout is on screen. */
    const listHost = $('cvList');
    if (!listHost) return;
    paintFilterCounts();
    const rows = visible();
    const notes = [];
    if (capped) notes.push(`Only the newest ${num(THREAD_LIMIT)} threads were read, so older conversations are missing from this list.`);
    if (dropped) notes.push(`${num(dropped)} ${plural(dropped, 'row', 'rows')} in v_conversations ${plural(dropped, 'has', 'have')} no thread_key and cannot be opened.`);
    notes.push('Search covers names, numbers, handles, the matched lead’s row (id, name, email and status) and the '
      + 'newest message only — older message text is not loaded until a thread is opened. A number matches however '
      + 'it is typed: spaces, a leading + and a leading 0 are ignored.');
    const footHtml = `<div class="list-item" style="cursor:default;align-items:flex-start">
        <span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">info</span>
        <div class="cell-sub" style="white-space:normal">${notes.map(esc).join('<br>')}</div>
      </div>`;

    listHost.innerHTML = (rows.length
      ? rows.map(t => {
        const id = identOf(t);
        return `
          <div class="list-item${t.key === selected ? ' on' : ''}" role="button" tabindex="0"
               data-k="${esc(t.key)}" aria-current="${t.key === selected ? 'true' : 'false'}"
               style="align-items:flex-start">
            <div class="avatar" aria-hidden="true">${avatarOf(t)}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:baseline;gap:8px;min-width:0">
                <span title="${esc(titleWhy(t))}"
                      style="font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${t.name ? '' : ';font-style:italic'}"
                      class="${t.name ? '' : 't-muted'}">${esc(titleOf(t))}</span>
                <span style="flex:0 0 auto">${phoneHtml(t)}</span>
              </div>
              <div class="cell-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${subLine(t)}
              </div>
              <div class="cell-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${t.lastIsMarker
                  /* The newest row is the detector's marker. Before 1 Sep this
                     line rendered "[SILENCE-ESCALATED] Silent for 12h since …"
                     under a north-east arrow captioned "Newest message was sent
                     by us" — an internal note shown as something we said to the
                     customer, in the row an operator scans to decide whether to
                     open the thread. It is now labelled as what it is, and the
                     marker's boilerplate is not repeated as message text. */
                  ? `<span class="material-symbols-outlined t-warm" style="font-size:14px;vertical-align:-2px" aria-hidden="true"
                           title="${esc(isMarkerText(t.last_message)
                             ? 'The newest row on this thread is the 12-hour silence detector’s own ' + SILENCE_MARKER + ' marker. It is not a message to or from the customer, and public.nexus_is_message() rejects it.'
                             : 'The newest row on this thread is one of the dealership’s own internal rows — public.nexus_is_message() rejects it, so v_conversations.last_msg_at skips past it. Its body is not the silence detector’s, so what wrote it is not named here.')}">notifications_paused</span>
                     <span class="t-warm">${isMarkerText(t.last_message) ? 'Escalated for silence' : 'Newest row is an internal note'}</span>
                     ${/* `t.last_at` is the MARKER's own timestamp, and this
                          sentence is about the last MESSAGE — two moments the
                          detector's twelve hours apart. Printing the marker time
                          here understated Siva Thangavelu's silence by half a
                          day: "no message either way since 5 d ago" under a
                          thread whose last real message was 6 d ago. It reads
                          `last_msg_at` from the view now, and where that is null
                          the thread holds no message at all and says so. */''}
                     <span class="t-muted">— ${lastSaidAt(t)
                       ? `no message either way since <span title="${esc(stamp(lastSaidAt(t)))}">${esc(ago(lastSaidAt(t)))}</span>`
                       : 'and nothing in this thread is a message — every row in it is an internal note'}</span>`
                  : `<span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px"
                      aria-hidden="true"
                      title="${esc(t.last_direction === 'inbound' ? 'Newest message came from them' : (t.last_direction === 'outbound' ? 'Newest message was sent by us' : 'communication_logs recorded no direction on the newest message'))}"
                      >${t.last_direction === 'inbound' ? 'south_west' : (t.last_direction === 'outbound' ? 'north_east' : 'help')}</span>
                ${preview(t.last_message)}`}
              </div>
            </div>
            <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:4px">
              <span class="cell-sub" title="${esc(stamp(t.last_at))}">${esc(ago(t.last_at))}</span>
              ${/* "msg" was v_conversations.message_count, which counts every
                    row including the detector's notes — so a thread the badge
                    called 17 msg sat directly under a line saying the newest row
                    was not a message. It is the message-only count now, with the
                    rows it leaves out named in the title. */''}
              ${t.awaiting ? pill('Reply due', 'hot', { verbatim: false }) : `<span class="cell-sub" title="${esc(figuresAreExact(t)
                  ? `v_conversations.msg_count — rows public.nexus_is_message() accepts.${t.internalCount ? ` ${t.internalCount} further row${t.internalCount === 1 ? '' : 's'} on this thread ${t.internalCount === 1 ? 'is' : 'are'} an internal note and ${t.internalCount === 1 ? 'is' : 'are'} not counted here.` : ''}`
                  : 'v_conversations.message_count. That column counts every row filed under this contact, internal notes included; the message-only count did not come back on this read.')}">${num(realCount(t))} msg</span>`}
              ${t.identified === 'lead' ? '' : `<span class="chip" title="${esc(id.label)} — ${esc(identNote(t))}">${esc(id.short)}</span>`}
              ${t.siblings.length ? `<span class="chip" title="${esc(sameAsWhy(t))}">Linked thread</span>` : ''}
            </div>
          </div>`;
      }).join('')
      : stateEmpty('No conversation matches',
          filter === 'all'
            ? `No conversation matches "${q}". Search covers the name, the number, the WhatsApp address, the matched lead’s row and the newest message of each of the ${num(threads.length)} threads read — not the older message text, which is only loaded when a thread is opened.`
            : `No conversation is both in the "${filter === 'await' ? 'Reply due' : (filter === 'notlead' ? 'Not in leads' : 'Unidentified')}" tab and a match for what is typed in the search box.`,
          'search_off')) + footHtml;

    listHost.querySelectorAll('[data-k]').forEach(node => {
      node.addEventListener('click', () => openThread(node.dataset.k));
      node.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openThread(node.dataset.k); return; }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const all = [...listHost.querySelectorAll('[data-k]')];
        const next = all[all.indexOf(node) + (e.key === 'ArrowDown' ? 1 : -1)];
        if (next) { next.focus(); openThread(next.dataset.k); }
      });
    });
  }

  /* ── One thread ──────────────────────────────────────────────────────── */
  function openThread(key, note) {
    const t = threads.find(x => x.key === key);
    if (!t) return;
    selected = key;
    /* No list to highlight when the inbox is a single conversation. */
    const listHost = $('cvList');
    if (listHost) listHost.querySelectorAll('[data-k]').forEach(n => {
      const on = n.dataset.k === key;
      n.classList.toggle('on', on);
      n.setAttribute('aria-current', on ? 'true' : 'false');
    });
    renderPane(t, note);
    loadMessages(t);
  }

  function banners(t) {
    /* The identity note with the leads answer attached (§1b). identOf(t).note
       alone is v_conversations' verdict, and on a thread the view could not
       resolve it used to carry the words "there is no lead record for them"
       into three banners at once. Nothing in here reads the raw note any more,
       which is why identOf() is no longer called at the top of this function. */
    const note = identNote(t);
    const out = [];
    /* The link banner comes first, because it changes what every banner under it
       means. "Treat nothing in this thread as a known customer" is exactly the
       wrong instruction on Ali's second thread. */
    if (t.siblings.length) {
      const named = namedSibling(t);
      out.push(`<div class="banner info">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">merge</span>
        <div>${esc(sameAsWhy(t))}
        ${named && !t.name ? ` The name above (${esc(named.name)}) is that thread’s, not this one’s.` : ''}</div>
      </div>`);
    }
    if (t.identified === 'unidentified') {
      out.push(`<div class="banner warm">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">person_search</span>
        <div>${esc(note)}
        ${t.siblings.length
          ? 'A linked thread above does name this person; nothing in THIS row does, which is why the label still reads Unidentified.'
          /* "Treat nothing in this thread as a known customer" is an instruction,
             and it was being given on the strength of one nullable column. It is
             given only where the leads read actually came back empty. */
          : (leadOf(t).state === 'none'
              ? 'Treat nothing in this thread as a known customer, and read the handle below as an address, not a name.'
              : 'Read the handle below as an address, not a name.')}</div>
      </div>`);
    } else if (t.identified === 'whatsapp_profile' || t.identified === 'phone_only') {
      out.push(`<div class="banner info">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">info</span>
        <div>${esc(note)}</div>
      </div>`);
    }
    if (t.awaiting) {
      const d = daysSince(t.last_at);
      const stale = d != null && d > CHAT_WINDOW_DAYS;
      /* Added 1 Sep 2026, evening. This screen files a thread as waiting on a
         human; screens/leads.js may be showing the same person as closed. Live
         that is lead 35, queued here as a HOT unanswered_chat and rendered
         DISQUALIFIED there, and neither screen mentioned the other. The alert is
         not wrong — unanswered_chat is `SELECT … FROM v_conversations WHERE
         awaiting_reply AND last_message_at > now() - 7 days`, verified against
         pg_get_viewdef on 1 Sep 2026 19:00 UTC, and there is no reference to
         leads.status anywhere in it — so the status is named here rather than
         the queue being second-guessed. */
      const status = leadStatusOf(t);
      out.push(`<div class="banner ${stale ? 'warm' : 'hot'}">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">schedule</span>
        <div>The newest message is inbound, logged ${esc(ago(t.last_at))}, and no outbound message has been recorded after it.
        ${stale
          ? `That is more than ${esc(String(CHAT_WINDOW_DAYS))} days ago, so v_needs_attention has dropped it from `
            + 'unanswered_chat and the nav badge no longer counts it. Nothing is reminding anyone about this thread except this screen.'
          : `v_needs_attention lists this as an unanswered_chat at HOT severity until somebody answers it or it passes ${esc(String(CHAT_WINDOW_DAYS))} days old.`}
        ${status
          ? `<span class="t-muted" title="${esc(leadWhy(t))}">This contact is a lead with status <strong>${esc(status)}</strong>. `
            + 'unanswered_chat is computed from v_conversations.awaiting_reply alone and reads no lead status at all, '
            + 'so a lead somebody has already closed or quarantined is still queued here for a reply.</span>'
          : ''}</div>
      </div>`);
    }
    /* The silence marker, stated in the pane as well as the alert strip: an
       operator who opened the thread from the list should not have to go back
       up to find out why the newest bubble is not a message. Added 1 Sep 2026,
       with the date the detector fired and the fact that no alert covers it. */
    if (t.lastIsMarker) {
      out.push(`<div class="banner warm">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">notifications_paused</span>
        ${/* Every clause here used to be asserted flat. `lastIsMarker` is now
              true of ANY internal row — the view answers it with
              last_msg_at ≠ last_message_at — so naming the silence detector, its
              reason, its Slack escalation and its channel on every one of them
              would be four guesses about a row this screen has only the text of.
              They are stated where the text is the detector's and withheld where
              it is not. */''}
        <div>The newest row on this thread is not a message. ${isMarkerText(t.last_message)
          ? `The 12-hour silence detector wrote its ${esc(SILENCE_MARKER)} marker at ${esc(stamp(t.last_at))} because the customer had not answered our last
             message, and escalated the thread to a person on Slack at the same time. It is on the
             <span class="mono">system</span> channel and is shown below as an internal note, never as an outbound bubble.`
          : `One of the dealership’s own internal rows was written at ${esc(stamp(t.last_at))} — v_conversations counts it in
             message_count and dates last_message_at from it, and public.nexus_is_message() does not accept it as a message.
             Its body is not the silence detector’s, so what wrote it is not named here; it is shown below as an internal
             note rather than as a bubble.`}${t.last_direction === 'outbound'
          ? ' It was written with direction ‘outbound’, which is why v_conversations counts it in outbound_count and reads this thread as answered.'
          : ''}
        Nothing in v_needs_attention covers this thread — unanswered_chat requires awaiting_reply, and this row
        makes that false — so this screen and the strip above it are the only things reporting it.</div>
      </div>`);
    }
    /* Both branches below are statements about MESSAGES, and v_conversations'
       inbound_count / outbound_count are counts of rows — outbound_count has the
       silence markers in it. `realOutbound` and `realInbound` read the view's
       message-only columns, so a thread whose ONLY outbound row is a silence
       marker correctly says nothing was ever sent to the contact rather than
       suppressing that banner on the strength of a note we wrote to ourselves.
       Corrected 1 Sep 2026; made exact rather than a floor the same evening,
       when nexus_is_message() moved into the view.

       `inbound` was still the raw column until then, which was the same defect
       standing on the other foot: nothing on file is an inbound marker today,
       but the test that decides whether to tell a rep "every message here came
       from them" should not depend on that staying true. */
    const outReal = realOutbound(t);
    const inReal = realInbound(t);
    if (inReal === 0 && outReal > 0) {
      out.push(`<div class="banner info">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">send</span>
        <div>Only outbound messages are logged for this contact, so this thread shows one side of the conversation.</div>
      </div>`);
    } else if (outReal === 0 && inReal > 0) {
      /* This was a red banner reading like a broken workflow. It is usually the
         opposite. The bot answers automatically only when the number is already
         in `leads` or the message carries a dealership keyword; everything else
         is logged and left for a human on purpose, because the WhatsApp number
         is a personal one. Silence here is the allowlist doing its job, and
         painting it as a failure trains an operator to ignore the strip that
         does mean something. What still needs saying — that nobody has replied —
         is the awaiting banner above, which is a different fact. */
      /* The second sentence is the allowlist explanation, and until 1 Sep 2026
         evening it was chosen by `t.lead_email` — so a contact who IS in leads
         but whom v_conversations could not resolve was told, under a HOT alert
         asking a human to answer them, that the bot had stayed silent because
         their number was not in leads. It was. That sentence blamed the customer
         for the dealership's silence and it was the false half of §4's class.
         It now follows the resolved answer, and says nothing at all where the
         answer is unknown. */
      const m = leadOf(t);
      out.push(`<div class="banner ${t.awaiting ? 'warm' : 'info'}">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">forum</span>
        <div>Nothing has ever been sent to this contact — every message here came from them.
        ${m.state === 'matched'
          ? `<span title="${esc(leadWhy(t))}">They are in the leads table, so the bot is allowed to answer them automatically; it has not, and no human has either.</span>`
          : m.state === 'none'
            ? esc(NOT_A_LEAD)
            : esc(leadWhy(t))}</div>
      </div>`);
    }
    return out.join('');
  }

  function renderPane(t, note) {
    const id = identOf(t);
    /* A thread that is matched, answered and inside the window has nothing to
       warn about, and an empty padded strip above the messages reads as a banner
       that failed to render. Nothing is nothing. */
    const bannerHtml = banners(t);
    const canSend = Boolean(t.chat_id) && Boolean(N8N_BASE);
    const why = !N8N_BASE ? NO_N8N : (!t.chat_id ? noChatWhy(t) : '');
    const dis = canSend ? '' : ` disabled title="${esc(why)}"`;

    $('cvPane').innerHTML = `
      <div class="card-head">
        <div class="avatar" aria-hidden="true">${avatarOf(t)}</div>
        <div style="min-width:0">
          <div class="card-title" style="display:flex;align-items:baseline;gap:10px;min-width:0">
            <span class="${t.name ? '' : 't-muted'}" title="${esc(titleWhy(t))}"
                  style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap${t.name ? '' : ';font-style:italic'}">${esc(titleOf(t))}</span>
            <span style="flex:0 0 auto">${phoneHtml(t, 'card-sub')}</span>
          </div>
          <div class="card-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${subLine(t)}
          </div>
        </div>
        <div style="flex:1"></div>
        <span title="${esc(identNote(t))}">${pill(id.label, id.tone, { verbatim: false })}</span>
        ${/* Was `t.lead_status ? pill(t.lead_status) : ''` — the view's column,
              and a bare `WARM` or `DISQUALIFIED` with no noun on it, in the same
              component and the same colour vocabulary this screen's alert strip
              uses for severity. leadStatusPill() labels it and falls back to the
              status of the row lib/identity.js matched, so Effco Contracting llc
              now shows DISQUALIFIED here instead of nothing at all. */''}
        ${leadStatusPill(t)}
        <button class="btn sm" id="cvRefresh"><span class="material-symbols-outlined">refresh</span>Refresh</button>
        ${/* The disabled tooltip used to say flatly "No lead record resolves for
              this thread". On a linked row the sub-line two lines above it says
              "In leads as <address>, via the linked thread", and both cannot be
              true. Corrected 1 Sep 2026. The button stays disabled either way —
              this row has no lead_email of its own and the drawer is opened by
              address — but the reason it gives is now the true one, and it names
              the row that does open. */''}
        ${/* Rewritten 1 Sep 2026, evening (§1b). Both branches of the previous
              version turned on `t.lead_email`: the button was enabled only when
              v_conversations had resolved an address, and its disabled tooltip
              said "No row in the leads table matches this contact" whenever it
              had not. For Effco Contracting llc that sentence was rendered
              beside a name the dealership holds a leads row for, and the button
              that would have opened it was greyed out.

              The drawer is now opened by lead id rather than by address, which
              also retires a second, quieter fault: `email=eq.<address>` is
              case-SENSITIVE, so a leads row stored in a different case from the
              view's copy would have answered "no row has that address any more"
              about a row that was sitting there. Same call as
              screens/overview.js:1241. */''}
        ${leadOf(t).state === 'matched'
          ? `<button class="btn sm" id="cvLead" data-lead="${esc(str(leadRow(t).id))}" title="${esc(leadWhy(t))}">Open lead</button>`
          : (t.siblings.find(s => s.lead_email)
              /* This branch is now only reached when the lead match itself could
                 not be made — the leads read failed, or two leads share the
                 thread's nine digits. Its old text said the drawer "is opened by
                 address, so there is nothing here to open it with"; that stopped
                 being the reason when the button started opening by lead id, so
                 the reason it gives is the real one and it still names the row
                 that does open. */
              ? `<button class="btn sm" disabled title="${esc(leadWhy(t) + ' The same person IS in leads, as ' + t.siblings.find(s => s.lead_email).lead_email + ', on the linked thread keyed "' + t.siblings.find(s => s.lead_email).key + '" — open that row and the button may work there.')}">Open lead</button>`
              : `<button class="btn sm" disabled title="${esc((leadOf(t).state === 'none'
                    ? 'No lead record resolves for this thread. '
                    : 'No lead record can be offered for this thread. ') + leadWhy(t))}">Open lead</button>`)}
      </div>
      <div class="cell-sub" id="cvNote" style="padding:0 20px" aria-live="polite"></div>
      ${bannerHtml ? `<div style="padding:16px 20px 0">${bannerHtml}</div>` : ''}
      <div style="flex:1;overflow-y:auto" id="cvBody">${stateLoading(5)}</div>
      <div style="padding:16px 20px;border-top:1px solid var(--border-subtle)">
        <div class="field">
          ${/* The same ladder as the confirmation dialog's To field, and it was
                left off this label by the identity work on 1 Sep 2026: the pane
                header said "Ali", the phone beside it said his number, and the
                box underneath said "Reply on WhatsApp to this contact". A
                borrowed name is carried here with the sentence that says where
                it came from, on the title — never bare, and never as though
                v_conversations had answered with it. */''}
          <label for="cvReply">Reply on WhatsApp to ${t.name
            ? esc(t.name)
            : (linkedName(t)
                ? `<span title="${esc(linkWhy(t))}">${esc(linkedName(t))}</span> <span class="t-muted">(named by the linked thread, not by this one)</span>`
                : (anyPhone(t) ? esc(anyPhone(t)) : 'this contact'))}</label>
          <textarea id="cvReply" rows="3"${dis}
            placeholder="${canSend ? 'Type a reply. Enter adds a line break — nothing is sent until you confirm.' : 'Replying from the dashboard is unavailable for this thread'}"></textarea>
          <div class="hint">${canSend
            /* The address is printed here, not only in the confirmation. The
               thread is named and keyed on one string and answered on another,
               and the operator should be able to see which one their message is
               going to before they have written it. */
            ? `Goes to ${chatHtml(t, '')}. Enter adds a line break. <strong>Review and send</strong> opens a confirmation showing that address again; the message only leaves after you confirm it there. Ctrl+Enter opens the same confirmation. This goes out on the dealership's live number and cannot be recalled.`
            : esc(why)}</div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap">
          <button class="btn primary" id="cvSend"${dis}>
            <span class="material-symbols-outlined">send</span>Review and send</button>
          <span class="cell-sub" id="cvSendMsg" aria-live="polite">${note || ''}</span>
        </div>
      </div>`;

    $('cvRefresh').addEventListener('click', () => { loadMessages(t); });

    $('cvLead')?.addEventListener('click', async () => {
      const b = $('cvLead');
      const label = b.innerHTML;
      const leadId = str(b.dataset.lead);
      b.disabled = true; b.textContent = 'Opening…';
      try {
        /* The full row, freshly read: the pool this button was offered from
           carries five columns, and the drawer renders the whole lead. Read by
           id, so nothing here depends on how an address is spelled. */
        const rows = await db(`leads?select=*,users(id,name)&id=eq.${encodeURIComponent(leadId)}&limit=1`);
        if (rows.length) { setNote(''); leadDrawer(rows[0]); }
        else setNote(`<span class="t-warm">Lead ${esc(leadId)} was matched to this thread when the screen loaded but is not in the leads table now, so there is no record to open. It has been deleted or merged since.</span>`);
      } catch (e) {
        setNote(`<span class="t-hot">The lead record could not be read — ${esc(e.message)}</span>`);
      } finally {
        b.disabled = false; b.innerHTML = label;
      }
    });

    if (canSend) {
      const ta = $('cvReply');
      const send = $('cvSend');
      send.addEventListener('click', () => {
        const text = ta.value.trim();
        if (!text) {
          setSendMsg('<span class="t-warm">Nothing to send — the reply box is empty.</span>');
          ta.focus();
          return;
        }
        confirmSend(t, text);
      });
      /* Enter is a line break, deliberately. The only keyboard route to the
         confirmation is a modifier the operator has to mean. */
      ta.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send.click(); }
      });
    }
  }

  const setNote = html => { const n = $('cvNote'); if (n) n.innerHTML = html; };
  const setSendMsg = html => { const n = $('cvSendMsg'); if (n) n.innerHTML = html; };

  /* Every key this person's messages could have been logged under.

     communication_logs stores one column, `lead_email`, and what goes in it
     depends on what was known when the row was written: the lead's email if the
     number had already been matched, the WhatsApp handle if it had not. Reading
     on `thread_key` alone returns whichever subset shares that key and renders
     it as the whole conversation, which is the more dangerous kind of wrong: it
     looks complete.

     Replaced 1 Sep 2026. This used to be a local three-element list —
     [thread_key, chat_id, lead_email] — sent as a PostgREST `in.()`. Two things
     were wrong with it, and both are the reason lib/identity.js exists:

       · `in.()` is case-SENSITIVE equality, and the view lower-cases
         `thread_key` while `lead_email` keeps whatever case leads.email is
         stored in. A log row written `Shabbir53Ujjainwala@Gmail.com` is grouped
         into the thread by the view and not returned by the read. Filed as C2 by
         the 31 Aug audit. personFilter uses `ilike`, which ends it.
       · the three keys were only the ones on THIS view row. Ali's rows sit under
         three keys and the view puts two of them on one thread and the third on
         another, so this read returned 17 of his 29 rows and said nothing about
         the other 12. The count check underneath it could not catch that either:
         it compared the read against `t.count`, which is that same one view
         row's total, so both numbers were 17 and agreed. Two figures drawn from
         the same narrow scope cannot disagree about the scope being narrow —
         which is why `expected` is now the whole linked group's count.

     personQuery builds the filter from expandIdentity's key set plus the
     last-nine-digit patterns the backend matches on, over the whole linked group
     (§1a). It is the same rule nexus_lead_for_comm_key() applies server-side.
     Where identity.js refuses to apply the suffix rule — two leads ending in the
     same nine digits — the read narrows to exact keys and the pane says so
     rather than merging two customers into one history. */
  const keyRole = (t, k) => (k === t.chat_id && k !== t.key ? 'WhatsApp address' : (k === t.lead_email ? 'lead email' : keyKind(k)));

  /* Newest-first with a cap, then reversed, so a long history shows its most
     recent window rather than its oldest one. */
  async function loadMessages(t) {
    const body = $('cvBody');
    if (!body) return;
    body.innerHTML = stateLoading(5);
    const identity = groupIdentity(t);
    const collision = (identity.ambiguityCodes || []).includes(AMBIGUITY.PHONE_SUFFIX_COLLISION);
    const readOpts = {
      select: 'id,direction,message,channel,created_at',
      order: 'created_at.desc',
      limit: MSG_LIMIT,
    };
    /* The filter is asked for twice — once as a path to send, once as the list
       of things it matched on — from the same identity and the same options, so
       what this pane SAYS it read under cannot drift from what it read under.

       Corrected 1 Sep 2026. The note below used to print `identity.keys`, and
       that is not the read. expandIdentity SYNTHESISES `<digits>@c.us` and
       `<digits>@s.whatsapp.net` for a number it has only ever seen written some
       other way, and personFilter then drops those in favour of the suffix
       patterns that already cover them. Live, Ali's identity carries five keys
       and the query goes out on two of them plus three patterns — so the pane
       named three addresses as sources of his history that had never been
       looked for and, for two of them, do not exist in the column at all. */
    const matched = personFilter(identity, readOpts);
    const keys = matched.keys || [];
    const patterns = matched.patterns || [];
    const path = personQuery('communication_logs', identity, readOpts);
    /* No usable key at all. personQuery returns '' rather than a filter that
       would quietly match every row in the table, and this is the one branch
       that must never be confused with "this person has no messages". */
    if (!path) {
      body.innerHTML = stateError('this conversation',
        'No key on this thread can be matched against communication_logs.lead_email — the thread key identifies '
        + 'nobody and there is no email, phone or chat id to read under. Nothing was queried, so nothing here is '
        + 'evidence that this person has no history.', 'thread');
      body.querySelector('[data-retry]')?.addEventListener('click', () => loadMessages(t));
      return;
    }
    let msgs;
    try {
      msgs = await db(path);
    } catch (e) {
      body.innerHTML = stateError('this conversation', e.message, 'thread');
      body.querySelector('[data-retry]')?.addEventListener('click', () => loadMessages(t));
      return;
    }
    const truncated = msgs.length >= MSG_LIMIT;
    const list = [...msgs].reverse();
    /* What the view says this pane should hold. For a linked pair that is the
       sum of both rows, because the read is over the whole person. */
    const expected = groupCount(t);

    if (!list.length) {
      body.innerHTML = stateEmpty('No messages in this thread',
        `v_conversations counts ${num(expected)} ${plural(expected, 'row', 'rows')} for this contact, but `
        + `communication_logs returned none under ${plural(keys.length, 'the key', 'any of the keys')} this read `
        + `matched on (${keys.join(', ')}${patterns.length ? `, and any key ending ${identity.suffix}` : ''}). `
        + 'Nothing is being shown rather than guessing at the history.',
        'forum');
      return;
    }

    const channels = new Map();
    list.forEach(m => {
      const c = str(m.channel) || 'unrecorded channel';
      channels.set(c, (channels.get(c) || 0) + 1);
    });
    const chips = [...channels.entries()].map(([c, n]) => `<span class="chip">${esc(c)} · ${num(n)}</span>`).join(' ');

    /* Markers are counted apart from messages, because the line at the bottom of
       the pane is a claim about a conversation and they are not part of one.
       This is the exact count the thread row could only give a floor for. */
    const markers = list.filter(isInternalRow);
    const real = list.filter(m => !isInternalRow(m));
    const inboundReal = real.filter(m => low(m.direction) === 'inbound').length;
    const outboundReal = real.length - inboundReal;

    /* Two numbers counted by two different pieces of software over the same
       rows. They agree, or the discrepancy is the thing worth reading — and it
       can now run in BOTH directions, which is new on 1 Sep 2026 and is the
       whole point of §1a:

         fetched < expected — the view resolved a row onto this person that this
           query did not fetch. The history on screen is not the history the
           summary claims, and it looks complete.
         fetched > expected — the read found rows the VIEW filed under a
           different thread. That is not an error here; it is the split the last-9
           rule closes. It is still stated, because a pane holding 29 messages
           beside a list row reading 17 is otherwise unexplained.

       The old version tested `!==` and printed only the first sentence, so once
       the read was widened it would have reported a correct merge as a
       truncation. */
    const countNote = truncated
      ? ''
      : list.length < expected
        ? `<div style="margin-top:6px"><span class="t-warm">v_conversations counts ${num(expected)} for this contact `
          + `and ${num(list.length)} ${plural(list.length, 'was', 'were')} read from communication_logs, so this thread `
          + 'is not the whole of it. The view resolves rows onto a person by something these keys do not cover'
          + `${collision ? ', and the last-nine-digit patterns were deliberately left out of this read because more than one lead ends in those digits' : ''}.</span></div>`
        : list.length > expected
          ? `<div style="margin-top:6px"><span class="t-muted">v_conversations counts ${num(expected)} for `
            + `${t.siblings.length ? 'these ' + num(1 + t.siblings.length) + ' rows' : 'this row'} and ${num(list.length)} `
            + `${plural(list.length, 'was', 'were')} read. The extra ${num(list.length - expected)} `
            + `${plural(list.length - expected, 'row is', 'rows are')} filed under a key the view groups onto a `
            + `different thread but the last-${SUFFIX_LEN}-digit rule puts on this person. Nothing is hidden; the `
            + 'list beside this pane counts view rows and this pane counts the person.</span></div>'
          : '';
    /* Which keys this history was assembled from. It is the honest version of a
       merge: the customer is one person, the rows are filed under several names,
       and an operator who opens the thread can see that rather than wondering
       why the pane holds more messages than the address at the top would
       suggest. The suffix patterns are named too — they are the part of the read
       that is a rule rather than a key, and an operator is entitled to know that
       a message arrived here by digit-matching. Both lists come off the filter
       that was actually issued, never re-derived here: a second derivation is a
       second chance to describe a read that did something else. */
    const keyNote = (keys.length > 1 || patterns.length)
      ? `<div style="margin-top:6px">Assembled from ${num(keys.length)} ${plural(keys.length, 'key', 'keys')} in communication_logs.lead_email — `
        + keys.map(k => `<span class="mono">${esc(k)}</span> <span class="t-muted">(${esc(keyRole(t, k))})</span>`).join(', ')
        + (patterns.length
          ? ` — plus any key ending in the last ${SUFFIX_LEN} digits of the number `
            + `(<span class="mono">${esc(identity.suffix)}</span>) on ${num(patterns.length)} address `
            + `${plural(patterns.length, 'shape', 'shapes')}: `
            + patterns.map(p => `<span class="mono">${esc(p)}</span>`).join(', ')
            + '. That is the rule the workflows and nexus_lead_for_comm_key() join on. A '
            + '<span class="mono">@lid</span> is never matched that way: its digits are a machine id.'
          : ' — which resolve onto the same person.')
        + '</div>'
      : '';
    /* Refused, and why. A read that deliberately did less has to say so, or the
       shorter history reads as the whole one. */
    const collisionNote = collision
      ? `<div style="margin-top:6px"><span class="t-warm">More than one lead has a phone number ending `
        + `${esc(identity.suffix)}, so the last-${SUFFIX_LEN}-digit patterns were left out of this read and only `
        + 'exact keys were matched. Merging on those digits would have put two customers’ histories in this '
        + 'pane.</span></div>'
      : '';
    /* Counted from the rows in hand rather than described from memory. Until
       1 Sep 2026 this sentence called every excluded row "the silence detector's
       own marker on the system channel" — two claims about rows it had not
       looked at. A row is internal by its channel, its direction OR its body,
       and only the body says which workflow wrote it. */
    const silenceN = silenceCount(markers);
    const otherN = markers.length - silenceN;
    const markerChannels = [...new Set(markers.map(m => str(m.channel) || 'no channel recorded'))];
    const markerNote = markers.length
      ? `<div style="margin-top:6px"><span class="t-muted">${num(markers.length)} of these `
        + `${plural(markers.length, 'row is', 'rows are')} the dealership’s own internal `
        + `${plural(markers.length, 'note', 'notes')}`
        + (silenceN === markers.length
            ? ` — the silence detector’s ${esc(SILENCE_MARKER)} ${plural(markers.length, 'marker', 'markers')}`
            : silenceN
              ? ` — ${num(silenceN)} the silence detector’s ${esc(SILENCE_MARKER)} ${plural(silenceN, 'marker', 'markers')} and ${num(otherN)} written by something this screen cannot name from the row`
              : ' — written by something this screen cannot name from the row')
        + `, on the <span class="mono">${esc(markerChannels.join('</span>, <span class="mono">'))}</span> `
        + `${plural(markerChannels.length, 'channel', 'channels')}, shown as internal notes. `
        + 'They are not messages to or from the customer and are not counted in the inbound and '
        + 'outbound figures above.</span></div>'
      : '';

    body.innerHTML = `
      ${truncated ? `<div style="padding:16px 20px 0"><div class="banner info">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">history</span>
        <div>Only the newest ${num(MSG_LIMIT)} messages of this thread were read. Anything older is not shown.</div>
      </div></div>` : ''}
      <div class="thread">
        ${list.map((m, i) => {
          const day = dayLabel(m.created_at);
          const sep = (i === 0 || day !== dayLabel(list[i - 1].created_at))
            ? `<div class="label-caps" style="text-align:center;margin-top:6px">${esc(day)}</div>` : '';
          const text = String(m.message == null ? '' : m.message).trim();
          /* An internal marker is not a chat bubble. Until 1 Sep this fell into
             the `out` branch — a row saying "[SILENCE-ESCALATED] Silent for 12h
             since …" drawn in the same shape and on the same side as the
             messages the dealership actually sent Ali, above a meta line reading
             "outbound", because that is the direction the old detector wrote.
             It is rendered as a centred internal note instead, with the marker's
             prefix stripped off the front of the text: keeping it would repeat
             in the note what the note already says. */
          if (isInternalRow(m)) {
            const note = text.startsWith(SILENCE_MARKER) ? text.replace(SILENCE_MARKER, '').trim() : text;
            return `${sep}<div class="cell-sub" style="text-align:center;margin:8px 20px;white-space:normal">
              <span class="material-symbols-outlined t-warm" style="font-size:14px;vertical-align:-2px" aria-hidden="true">notifications_paused</span>
              <span class="t-warm">Internal note</span>
              <span class="t-muted">— ${note ? esc(note) : esc(text.startsWith(SILENCE_MARKER) ? 'the silence detector logged an escalation and recorded no detail' : 'this row carries no text at all')}.
              Written by the dealership’s own workflow on the <span class="mono">${esc(str(m.channel) || 'unrecorded channel')}</span>
              channel with direction <span class="mono">${esc(low(m.direction) || 'not recorded')}</span>; it was never sent to the customer.</span>
              <span class="t-muted" title="${esc(stamp(m.created_at))}"> ${esc(ago(m.created_at))}</span>
            </div>`;
          }
          const inbound = low(m.direction) === 'inbound';
          return `${sep}<div class="bubble ${inbound ? 'in' : 'out'}">${text ? esc(text) : '<span class="t-muted">No message text recorded</span>'}
            <div class="bubble-meta">
              <span class="chip">${esc(str(m.channel) || 'unrecorded channel')}</span>
              <span>${esc(low(m.direction) || 'direction not recorded')}</span>
              <span title="${esc(stamp(m.created_at))}">${esc(ago(m.created_at))}</span>
            </div>
          </div>`;
        }).join('')}
      </div>
      <div class="cell-sub" style="padding:0 20px 16px;text-align:center">
        ${num(real.length)} ${plural(real.length, 'message', 'messages')} shown · ${num(inboundReal)} inbound · ${num(outboundReal)} outbound${markers.length ? ` · ${num(markers.length)} internal ${plural(markers.length, 'note', 'notes')}` : ''}
        ${countNote}
        ${markerNote}
        ${collisionNote}
        ${keyNote}
        ${chips ? '<div style="margin-top:8px">' + chips + '</div>' : ''}
      </div>`;
    body.scrollTop = body.scrollHeight;
  }

  /* ── Sending ─────────────────────────────────────────────────────────── */
  function confirmSend(t, text) {
    const id = identOf(t);
    const m = openModal('Send this WhatsApp message?', `
      ${/* The banner's colour used to be chosen by `identified` alone, so a
            contact the view could not resolve but lib/identity.js matched to a
            leads row got the amber "we do not know who this is" treatment on the
            confirmation for a message about to leave on the dealership's live
            number. Both the colour and the sentence follow the resolved answer
            from 1 Sep 2026 evening; amber is now reserved for a contact who
            really is unmatched, or whose match could not be checked. */''}
      <div class="banner ${t.identified === 'lead' || leadOf(t).state === 'matched' ? 'info' : 'warm'}">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">
          ${t.identified === 'lead' || leadOf(t).state === 'matched' ? 'info' : 'person_search'}</span>
        <div>${esc(identNote(t))}</div>
      </div>
      <dl class="kv" style="margin-top:16px">
        <dt>To</dt><dd>${t.name
          ? esc(t.name)
          /* A name borrowed from a linked thread is shown here — an operator
             about to send on the dealership's live number should know who they
             are writing to — but never without the sentence that says where it
             came from. Added 1 Sep 2026. */
          : (linkedName(t)
              ? `${esc(linkedName(t))} <span class="t-muted">— ${esc(linkWhy(t))}</span>`
              : (anyPhone(t)
                  ? '<span class="t-muted">We have this number but not a name for it</span>'
                  : '<span class="t-muted">Unidentified contact — we do not know whose number this is</span>'))}</dd>
        <dt>Phone</dt><dd>${addressPhone(t.phone)
          ? `<span class="mono" title="Stored as ${esc(t.phone)}">${esc(addressPhone(t.phone))}</span>`
          : addressPhone(t.keyDigits)
            ? `<span class="mono">${esc(addressPhone(t.keyDigits))}</span> <span class="t-muted">— not stored in v_conversations.phone; these digits are read out of the thread key <span class="mono">${esc(t.key)}</span>, which a workflow minted from the number it was given</span>`
            : (t.phone
                ? `<span class="mono">${esc(t.phone)}</span> <span class="t-muted">— stored as something that does not read as a dialable number, so it is shown exactly as stored</span>`
                : `<span class="t-warm">Not stored for this contact</span> <span class="t-muted">${esc(NO_PHONE_WHY)}</span>`)}</dd>
        <dt>In leads</dt><dd>${t.lead_email
          ? esc(t.lead_email)
          : (t.siblings.find(s => s.lead_email)
              ? `${esc(t.siblings.find(s => s.lead_email).lead_email)} <span class="t-muted">— not on this thread’s own row. v_conversations matched it to the linked thread <span class="mono">${esc(t.siblings.find(s => s.lead_email).key)}</span>, which is the same person by the last ${SUFFIX_LEN} digits. The bot may therefore answer this number automatically.</span>`
              /* The last branch used to be an unconditional "No — the bot does
                 not answer this number automatically", printed from a null
                 column, on the dialog that sends a real WhatsApp message. On
                 lead 35 it was a false statement about a customer, made at the
                 moment an operator was deciding what to say to them. */
              : (leadOf(t).state === 'matched'
                  ? `${esc(str(leadRow(t).email) || 'lead ' + str(leadRow(t).id))} <span class="t-muted">— not on this thread’s own row and not resolved by v_conversations. ${esc(leadWhy(t))}</span>`
                  : leadOf(t).state === 'none'
                    ? `<span class="t-muted" title="${esc(NOT_A_LEAD)}">No — the bot does not answer this number automatically, so this reply is the first one they get from a person.</span>`
                    : `<span class="t-warm">${esc(leadWhy(t))}</span>`))}</dd>
        <dt>WhatsApp address</dt><dd>${chatHtml(t, '')}</dd>
        <dt>Thread keyed on</dt><dd><span class="mono">${esc(t.key)}</span> <span class="t-muted">— ${esc(keyKind(t.key))}. This is who the thread is, not where it goes; the message is addressed to the line above.</span></dd>
        <dt>Identified as</dt><dd>${pill(id.label, id.tone, { verbatim: false })}${leadStatusPill(t) ? ' ' + leadStatusPill(t) : ''}</dd>
      </dl>
      <div class="label-caps" style="margin-top:16px">Message as it will be sent</div>
      <div class="bubble out" style="max-width:100%;margin-top:8px">${esc(text)}</div>
      <p class="cell-sub" style="margin-top:12px">This is sent from the dealership's live WhatsApp number and cannot be recalled or edited afterwards.</p>`,
      `<button class="btn primary" id="cvGo"><span class="material-symbols-outlined">send</span>Send on WhatsApp</button>
       <button class="btn" id="cvCancel">Cancel</button>`);

    const go = m.wrap.querySelector('#cvGo');
    const cancel = m.wrap.querySelector('#cvCancel');
    go.focus();
    cancel.addEventListener('click', m.close);

    go.addEventListener('click', async () => {
      go.disabled = true; cancel.disabled = true;
      go.innerHTML = '<span class="material-symbols-outlined">hourglass_top</span>Sending…';
      m.msg('<span class="t-muted">The message is with the send workflow. Nothing has left WhatsApp until it answers.</span>');
      setSendMsg('<span class="t-muted">Sending…</span>');

      let res;
      try {
        res = await n8n(HOOK.whatsappSend, { chat_id: t.chat_id, text });
      } catch (e) {
        go.disabled = false; cancel.disabled = false;
        go.innerHTML = '<span class="material-symbols-outlined">send</span>Send on WhatsApp';
        const msg = /VITE_N8N_BASE_URL/.test(String(e.message)) ? NO_N8N : e.message;
        m.msg(`<span class="t-hot">The send workflow could not be reached, so nothing was sent — ${esc(msg)}</span>`);
        setSendMsg(`<span class="t-hot">Not sent — ${esc(msg)}</span>`);
        return;
      }

      /* The workflow answers 200 for its own failures too, so the body decides
         the outcome — never the status code, and never optimism. */
      const status = low(res && res.status);
      if (status === 'sent') {
        const when = clockOf(res.sent_at);
        m.msg(`<span class="t-ok">WhatsApp accepted the message${when ? ' at ' + esc(when) : ''}.</span>`);
        go.innerHTML = 'Sent';
        cancel.disabled = false; cancel.textContent = 'Close';
        const ta = $('cvReply');
        if (ta) ta.value = '';
        await afterSend(t, when);
      } else if (status === 'error') {
        const why = str(res.error) || 'the workflow gave no reason';
        go.disabled = false; cancel.disabled = false;
        go.innerHTML = '<span class="material-symbols-outlined">send</span>Send on WhatsApp';
        m.msg(`<span class="t-hot">WhatsApp did not send it — ${esc(why)}. Nothing left the dealership number.</span>`);
        setSendMsg(`<span class="t-hot">Not sent — ${esc(why)}</span>`);
      } else {
        /* Unknown shape. It may or may not have gone out, and guessing either
           way is how somebody sends a message twice. */
        const raw = str(JSON.stringify(res)).slice(0, 200);
        cancel.disabled = false; cancel.textContent = 'Close';
        go.innerHTML = 'Outcome unknown';
        m.msg(`<span class="t-warm">The send workflow answered without a status of "sent" or "error", so whether the message left cannot be told from here. Check WhatsApp before sending again. Reply was: <span class="mono">${esc(raw)}</span></span>`);
        setSendMsg('<span class="t-warm">Outcome unknown — check WhatsApp before resending.</span>');
      }
    });
  }

  /* A successful send is not a message in the thread. The workflow writes the
     outbound to communication_logs, so the thread and the list are re-read and
     whatever the database actually holds is what gets shown. */
  async function afterSend(t, when) {
    const sentNote = `<span class="t-ok">Sent${when ? ' at ' + esc(when) : ''}.</span> `
      + '<span class="t-muted">The workflow logs the outbound itself — if it is not in the thread yet, use Refresh in a moment.</span>';
    try {
      const read = await readThreads();
      /* `collisions` is reassigned with the rest. It is a property of the list
         and a re-read can change it — a send that creates the first log row
         under a new key can turn a linked pair into an unlinkable group of
         three — and a stale collision note is a claim about rows that are no
         longer on screen. */
      threads = read.list; dropped = read.dropped; capped = read.capped;
      collisions = read.collisions;
      /* Re-annotated against the pool read at boot, not against a fresh one. A
         send does not create or change a lead, and re-reading the table here
         would let a failure on this path turn a matched contact into "not in
         leads" the moment somebody answered them. */
      annotateLeads(threads);
      if (shellSolo !== (threads.length < SPLIT_MIN)) renderShell();
      renderStrip();
      drawList();
      /* A reply is exactly the thing that clears an unanswered_chat, so the
         attention view is re-read rather than assumed to have changed — the
         strip must agree with the database, not with what we just did. */
      await refreshAlerts();
      if (threads.some(x => x.key === t.key)) openThread(t.key, sentNote);
      /* The thread is no longer in the list — the view regrouped it, or it fell
         past the read cap. The pane is redrawn on the row we still hold rather
         than left as whatever the previous layout had in it. */
      else { renderPane(t, sentNote); loadMessages(t); }
    } catch (e) {
      /* The send outcome stands on its own; only the refresh failed. The alert
         strip is re-read anyway: it is a different query and it may well have
         succeeded, and a stale "waiting on a human" row after a reply has just
         gone out is the one thing on this screen nobody should be reading. */
      refreshAlerts();
      loadMessages(t);
      setSendMsg(sentNote + ` <span class="t-warm">The conversation list could not be re-read (${esc(e.message)}), so the counts beside it may be stale.</span>`);
    }
  }

  /* Last, not first: the helpers above are const arrows, so booting before this
     line would run them inside their own temporal dead zone and take the whole
     screen down with a ReferenceError. */
  await boot();
};
