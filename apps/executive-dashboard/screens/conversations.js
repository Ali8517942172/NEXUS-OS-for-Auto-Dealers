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

   ── 2. How many conversations there actually are ────────────────────────────
   Every thread that was not a customer was deleted on 24 Aug — thirteen handles
   belonging to the owner's personal phone book. For a while afterwards the inbox
   held exactly one person, and this file was written around that: a 360px column
   with a search box, four filter tabs and a single row in it reads as a screen
   that failed to load the rest.

   That is no longer the shape of the data. Read live 1 Sep 2026: v_conversations
   returns 11 rows for 10 people (the eleventh is Ali's second key, §1a). The
   solo layout below is kept because it is still correct when it applies and the
   count can fall back — not because it describes today.

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
import { db, n8n, HOOK } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { N8N_BASE } from '../lib/env.js';
import { TZ, ago, dubaiDate, dubaiStamp, esc, initials, num, pct, pill } from '../lib/format.js';
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
   claim that goes stale without anybody touching this file. */
const SILENCE_MARKER = '[SILENCE-ESCALATED]';
const INTERNAL_CHANNELS = new Set(['system', 'internal']);
const isMarkerText = v => String(v == null ? '' : v).trimStart().startsWith(SILENCE_MARKER);
/* A whole communication_logs row. The view does not expose a per-thread
   `last_channel`, so at thread level only the message text is available and
   `isMarkerText` is used on `last_message`; here, where the row itself is in
   hand, channel and direction are checked too. */
const isInternalRow = r => INTERNAL_CHANNELS.has(String(r && r.channel || '').trim().toLowerCase())
  || String(r && r.direction || '').trim().toLowerCase() === 'internal'
  || isMarkerText(r && r.message);

/* The two registry rows this screen depends on, named exactly as
   workflow_registry.name so v_workflow_health can be filtered on them. */
const WF_BDC = 'WhatsApp BDC AI Agent';
const WF_SEND = 'WhatsApp Send (Dashboard Reply)';
const HEALTH_COLS = 'name,is_active,writes_audit_log,health,runs_30d,failures_30d,partials_30d,'
  + 'no_result_30d,rejected_30d,successes_30d,effective_runs_30d,success_rate_30d,last_run,last_failure';

const plural = (n, one, many) => (Number(n) === 1 ? one : many);

const VIEW_COLS = 'thread_key,chat_id,phone,push_name,lead_email,lead_name,lead_status,'
  + 'display_name,identified,message_count,inbound_count,outbound_count,'
  + 'last_message_at,last_message,last_direction,awaiting_reply';

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

/* Half of the bot's reply rule, and an honest account of the other half. */
const NOT_A_LEAD =
  'No row in the leads table matches this contact. The WhatsApp bot replies automatically only to numbers '
  + 'already in leads, or to messages containing dealership keywords — anything else is logged and left for a '
  + 'human on purpose, because the business number is a personal one. Whether a particular message hit a keyword '
  + 'is not recorded anywhere the dashboard can read, so this tells you one half of that rule and not the other.';
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
    note: 'This thread is matched to a row in the leads table by email address.',
  },
  whatsapp_profile: {
    label: 'WhatsApp profile name',
    short: 'Profile name',
    tone: 'cold',
    named: true,
    note: 'The name below is whatever this contact typed into their own WhatsApp profile. '
        + 'Nobody has verified it and there is no lead record for them.',
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
        + 'either. The last-9 rule in lib/identity.js is applied on top of this and will say so above if it links '
        + 'the thread to another row in the list.',
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
    count: Number(r.message_count) || 0,
    inbound: Number(r.inbound_count) || 0,
    outbound: Number(r.outbound_count) || 0,
    last_at: r.last_message_at || null,
    last_message: r.last_message == null ? '' : String(r.last_message),
    last_direction: low(r.last_direction),
    /* The newest row in this thread is the silence detector's own marker, not a
       message anybody sent or received. The view has no last_channel, so this is
       decided on the text — the marker is a literal prefix the detector writes.
       Everywhere `last_message`, `last_direction` or `outbound` would otherwise
       be spoken about as a message, this flag is consulted first. */
    lastIsMarker: isMarkerText(r.last_message),
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
const groupIdentity = t => expandIdentity(
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
  },
);
/* A sibling that has a name, for a row that does not. Returned with the sibling
   attached so every caller can attribute it rather than printing it flat. */
const namedSibling = t => (t.siblings || []).find(x => x.name) || null;
const groupCount = t => groupOf(t).reduce((s, x) => s + x.count, 0);

/* The view's outbound_count with the one marker this screen can see taken out.

   `outbound_count` is `count(*) FILTER (WHERE direction = 'outbound')`, and the
   two [SILENCE-ESCALATED] rows written before the detector was fixed carry
   direction 'outbound'. So the view counts each of them as a message sent to the
   customer: live 1 Sep 2026 Ali's thread reports 9 outbound when eight messages
   were sent to him and the ninth is the dealership's note that he went quiet.

   v_conversations exposes no per-row channel, so only the NEWEST row can be
   tested from a thread row. This therefore discounts at most one marker and is a
   FLOOR, not a corrected total — `outboundIsFloor` is what says so wherever the
   number is printed. The exact count, with every marker in the history removed,
   is only available once loadMessages() has the rows, and that is where it is
   given. A marker written the new way (direction 'internal') was never in
   outbound_count to begin with and is not discounted twice. */
const outboundIsFloor = t => t.lastIsMarker && t.last_direction === 'outbound';
const realOutbound = t => Math.max(0, t.outbound - (outboundIsFloor(t) ? 1 : 0));

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
const titleWhy = t => t.name
  ? ''
  : (linkWhy(t)
      || (anyPhone(t)
          ? 'We have this contact\u2019s phone number but no name: no lead record matches it and they have set no WhatsApp profile name.'
          : identOf(t).note));
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

/* The line under the name. The phone has moved up beside it, so what is left
   here is the rest of what we hold: the matched lead\u2019s email, or — when
   nothing in leads matches — the fact that the bot is not allowed to answer them
   automatically, which is the reason a human is looking at this row at all. The
   raw handle appears only when there is no name, and only labelled as an
   address. */
function subLine(t) {
  const bits = [];
  if (t.lead_email) bits.push(esc(t.lead_email));
  /* "Not in leads" is a claim about the leads table, and on a linked row it was
     a false one: Ali's whatsapp.lead thread has no lead_email of its own and IS
     in leads, under the sibling's address. Added 1 Sep 2026 — the sibling's
     answer is stated as the sibling's. */
  else if (t.siblings.some(s => s.lead_email)) {
    const s = t.siblings.find(x => x.lead_email);
    bits.push(`<span class="t-muted" title="${esc('v_conversations returned no lead_email for this thread, because it matches leads on an exact address and this thread is keyed on "' + t.key + '". The same person’s other thread is matched, to ' + s.lead_email + ', and the two share the last ' + SUFFIX_LEN + ' digits ' + t.suffix + '.')}">In leads as ${esc(s.lead_email)}, via the linked thread</span>`);
  } else bits.push(`<span class="t-muted" title="${esc(NOT_A_LEAD)}">Not in leads</span>`);
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
          detail: `The 12-hour silence detector escalated this thread ${ago(t.last_at)} and wrote its `
            + `${SILENCE_MARKER} marker as the newest row${d != null ? `, ${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'} ago` : ''}. `
            + 'Nothing has been logged on the thread since. The marker is the dealership’s own note that the '
            + 'customer went quiet — it is not a message to them and not a reply — but because it sits in the '
            + 'direction column as an outbound, v_conversations reads this thread as answered and '
            + 'v_needs_attention.unanswered_chat, which keys on that, cannot list it at all.',
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
      return `<div class="list-item" ${t ? `role="button" tabindex="0" data-a="${i}"` : ''}
           style="align-items:flex-start;cursor:${t ? 'pointer' : 'default'}">
          <span class="material-symbols-outlined" aria-hidden="true"
                style="font-size:20px">${a.kind === 'unanswered_chat' ? 'mark_chat_unread'
                    : (a.kind === 'no_whatsapp_address' ? 'link_off'
                    : (a.kind === 'silence_escalated' ? 'notifications_paused' : 'schedule'))}</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
              ${pill(a.severity)}
              <span style="font-weight:500${name ? '' : ';font-style:italic'}" class="${name ? '' : 't-muted'}">${esc(name || 'Unidentified contact')}</span>
              ${phone}
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
    const msgs = threads.reduce((s, t) => s + t.count, 0);
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
          ? `<span class="t-warm">Escalated for silence ${esc(ago(t.last_at))}.</span> The newest row in this thread `
            + `is the detector’s own ${esc(SILENCE_MARKER)} note, not a message. The last real message was ours and `
            + 'the customer has not answered it.'
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
            <div class="kpi-value sm" style="white-space:normal">${num(msgs)} ${plural(msgs, 'message', 'messages')}, ${t.lead_email ? 'one customer' : 'one contact'}</div>
            <div class="kpi-sub" style="white-space:normal">
              ${num(t.inbound)} from ${esc(who)}, ${num(realOutbound(t))} sent back${outboundIsFloor(t)
                ? ` <span class="t-muted" title="${esc('v_conversations.outbound_count is ' + t.outbound + ' because it counts every row with direction \'outbound\', and the newest row here is the silence detector\'s ' + SILENCE_MARKER + ' marker, written with that direction before the detector was fixed. One marker is visible from the thread row and has been taken out; any older marker in this history is not, so this figure is a floor. Open the thread for the exact count.')}">(v_conversations says ${num(t.outbound)}; one of those is a silence marker, not a message)</span>`
                : ''}, newest ${esc(ago(t.last_at))}.
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
        `${num(msgs)} ${plural(msgs, 'message', 'messages')} logged`
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
        + ` · ${num(by.lead)} matched to a lead · ${num(by.whatsapp_profile)} WhatsApp name · ${num(by.phone_only)} number only`
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
      count: () => threads.filter(t => !t.lead_email).length,
      /* The count is `!lead_email` on the view row, and it stays that, because
         every count on this screen has to keep agreeing with the view. But a
         linked row whose sibling IS in leads is counted here while its own
         sub-line reads "In leads as <address>, via the linked thread" — so the
         tab says what it counts rather than letting the two disagree silently.
         Added 1 Sep 2026. */
      title: NOT_A_LEAD + ' This tab counts what v_conversations returned for each thread on its own. A thread the '
           + 'last-9-digit rule links to another one that IS in leads is still counted here, because the view '
           + 'returned no lead_email for this row — the row itself says so where that happens.' },
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
  const haystack = t => [
    t.name, linkedName(t), t.key, t.chat_id || '', t.phone || '', addressPhone(t.phone),
    t.keyDigits || '', addressPhone(t.keyDigits), t.lead_email || '', t.push_name || '',
    ...(t.siblings || []).map(s => `${s.name} ${s.lead_email || ''} ${s.key}`),
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
    if (filter === 'notlead' && t.lead_email) return false;
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
    notes.push('Search covers names, numbers, handles, lead emails and the newest message only — older message text is not '
      + 'loaded until a thread is opened. A number matches however it is typed: spaces, a leading + and a leading 0 are ignored.');
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
                           title="${esc('The newest row on this thread is the 12-hour silence detector’s own ' + SILENCE_MARKER + ' marker on the system channel. It is not a message to or from the customer.')}">notifications_paused</span>
                     <span class="t-warm">Escalated for silence</span>
                     <span class="t-muted">— no message either way since ${esc(ago(t.last_at))}</span>`
                  : `<span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px"
                      aria-hidden="true"
                      title="${esc(t.last_direction === 'inbound' ? 'Newest message came from them' : (t.last_direction === 'outbound' ? 'Newest message was sent by us' : 'communication_logs recorded no direction on the newest message'))}"
                      >${t.last_direction === 'inbound' ? 'south_west' : (t.last_direction === 'outbound' ? 'north_east' : 'help')}</span>
                ${preview(t.last_message)}`}
              </div>
            </div>
            <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:4px">
              <span class="cell-sub" title="${esc(stamp(t.last_at))}">${esc(ago(t.last_at))}</span>
              ${t.awaiting ? pill('Reply due', 'hot') : `<span class="cell-sub">${num(t.count)} msg</span>`}
              ${t.identified === 'lead' ? '' : `<span class="chip" title="${esc(id.label)} — ${esc(id.note)}">${esc(id.short)}</span>`}
              ${t.siblings.length ? `<span class="chip" title="${esc(sameAsWhy(t))}">Linked thread</span>` : ''}
            </div>
          </div>`;
      }).join('')
      : stateEmpty('No conversation matches',
          filter === 'all'
            ? `No conversation matches "${q}". Search covers the name, the number, the WhatsApp address, the lead email and the newest message of each of the ${num(threads.length)} threads read — not the older message text, which is only loaded when a thread is opened.`
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
    const id = identOf(t);
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
        <div>${esc(id.note)}
        ${t.siblings.length
          ? 'A linked thread above does name this person; nothing in THIS row does, which is why the label still reads Unidentified.'
          : 'Treat nothing in this thread as a known customer, and read the handle below as an address, not a name.'}</div>
      </div>`);
    } else if (t.identified === 'whatsapp_profile' || t.identified === 'phone_only') {
      out.push(`<div class="banner info">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">info</span>
        <div>${esc(id.note)}</div>
      </div>`);
    }
    if (t.awaiting) {
      const d = daysSince(t.last_at);
      const stale = d != null && d > CHAT_WINDOW_DAYS;
      out.push(`<div class="banner ${stale ? 'warm' : 'hot'}">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">schedule</span>
        <div>The newest message is inbound, logged ${esc(ago(t.last_at))}, and no outbound message has been recorded after it.
        ${stale
          ? `That is more than ${esc(String(CHAT_WINDOW_DAYS))} days ago, so v_needs_attention has dropped it from `
            + 'unanswered_chat and the nav badge no longer counts it. Nothing is reminding anyone about this thread except this screen.'
          : `v_needs_attention lists this as an unanswered_chat at HOT severity until somebody answers it or it passes ${esc(String(CHAT_WINDOW_DAYS))} days old.`}</div>
      </div>`);
    }
    /* The silence marker, stated in the pane as well as the alert strip: an
       operator who opened the thread from the list should not have to go back
       up to find out why the newest bubble is not a message. Added 1 Sep 2026,
       with the date the detector fired and the fact that no alert covers it. */
    if (t.lastIsMarker) {
      out.push(`<div class="banner warm">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">notifications_paused</span>
        <div>The newest row on this thread is not a message. The 12-hour silence detector wrote its
        ${esc(SILENCE_MARKER)} marker at ${esc(stamp(t.last_at))} because the customer had not answered our last
        message, and escalated the thread to a person on Slack at the same time. It is on the
        <span class="mono">system</span> channel and is shown below as an internal note, never as an outbound
        bubble.${outboundIsFloor(t)
          ? ' It was written with direction ‘outbound’, which is why v_conversations counts it in outbound_count and reads this thread as answered.'
          : ''}
        Nothing in v_needs_attention covers this thread — unanswered_chat requires awaiting_reply, and this row
        makes that false — so this screen and the strip above it are the only things reporting it.</div>
      </div>`);
    }
    /* Both branches below read v_conversations' inbound_count and outbound_count,
       and outbound_count includes the marker. `realOutbound` takes out the one
       marker visible from the thread row, so a thread whose ONLY outbound row is
       a silence marker now correctly says nothing was ever sent to the contact
       rather than suppressing that banner on the strength of a note we wrote to
       ourselves. Corrected 1 Sep 2026. */
    const outReal = realOutbound(t);
    if (t.inbound === 0 && outReal > 0) {
      out.push(`<div class="banner info">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">send</span>
        <div>Only outbound messages are logged for this contact, so this thread shows one side of the conversation.</div>
      </div>`);
    } else if (outReal === 0 && t.inbound > 0) {
      /* This was a red banner reading like a broken workflow. It is usually the
         opposite. The bot answers automatically only when the number is already
         in `leads` or the message carries a dealership keyword; everything else
         is logged and left for a human on purpose, because the WhatsApp number
         is a personal one. Silence here is the allowlist doing its job, and
         painting it as a failure trains an operator to ignore the strip that
         does mean something. What still needs saying — that nobody has replied —
         is the awaiting banner above, which is a different fact. */
      out.push(`<div class="banner ${t.awaiting ? 'warm' : 'info'}">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">forum</span>
        <div>Nothing has ever been sent to this contact — every message here came from them.
        ${t.lead_email
          ? 'They are in the leads table, so the bot is allowed to answer them automatically; it has not, and no human has either.'
          : esc(NOT_A_LEAD)}</div>
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
        <span title="${esc(id.note)}">${pill(id.label, id.tone)}</span>
        ${t.lead_status ? pill(t.lead_status) : ''}
        <button class="btn sm" id="cvRefresh"><span class="material-symbols-outlined">refresh</span>Refresh</button>
        ${/* The disabled tooltip used to say flatly "No lead record resolves for
              this thread". On a linked row the sub-line two lines above it says
              "In leads as <address>, via the linked thread", and both cannot be
              true. Corrected 1 Sep 2026. The button stays disabled either way —
              this row has no lead_email of its own and the drawer is opened by
              address — but the reason it gives is now the true one, and it names
              the row that does open. */''}
        ${t.lead_email
          ? `<button class="btn sm" id="cvLead">Open lead</button>`
          : (t.siblings.find(s => s.lead_email)
              ? `<button class="btn sm" disabled title="${esc('This thread has no lead_email of its own, and the drawer is opened by address, so there is nothing here to open it with. The same person IS in leads, as ' + t.siblings.find(s => s.lead_email).lead_email + ', on the linked thread keyed "' + t.siblings.find(s => s.lead_email).key + '" — open that row and the button works there.')}">Open lead</button>`
              : `<button class="btn sm" disabled title="${esc('No lead record resolves for this thread — v_conversations returned no lead_email, and no other thread in the list is the same person, so there is nothing to open. ' + NOT_A_LEAD)}">Open lead</button>`)}
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
      b.disabled = true; b.textContent = 'Opening…';
      try {
        const rows = await db(`leads?select=*,users(id,name)&email=eq.${encodeURIComponent(t.lead_email)}&limit=1`);
        if (rows.length) { setNote(''); leadDrawer(rows[0]); }
        else setNote(`<span class="t-warm">No row in the leads table has the address ${esc(t.lead_email)} any more, so there is no lead record to open.</span>`);
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
    const markerNote = markers.length
      ? `<div style="margin-top:6px"><span class="t-muted">${num(markers.length)} of these `
        + `${plural(markers.length, 'row is', 'rows are')} the silence detector’s own ${esc(SILENCE_MARKER)} `
        + `${plural(markers.length, 'marker', 'markers')} on the <span class="mono">system</span> channel, shown as `
        + 'internal notes. They are not messages to or from the customer and are not counted in the inbound and '
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
            const note = text.replace(SILENCE_MARKER, '').trim();
            return `${sep}<div class="cell-sub" style="text-align:center;margin:8px 20px;white-space:normal">
              <span class="material-symbols-outlined t-warm" style="font-size:14px;vertical-align:-2px" aria-hidden="true">notifications_paused</span>
              <span class="t-warm">Internal note</span>
              <span class="t-muted">— ${note ? esc(note) : esc('the silence detector logged an escalation and recorded no detail')}.
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
      <div class="banner ${t.identified === 'lead' ? 'info' : 'warm'}">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">
          ${t.identified === 'lead' ? 'info' : 'person_search'}</span>
        <div>${esc(id.note)}</div>
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
              : `<span class="t-muted" title="${esc(NOT_A_LEAD)}">No — the bot does not answer this number automatically, so this reply is the first one they get from a person.</span>`)}</dd>
        <dt>WhatsApp address</dt><dd>${chatHtml(t, '')}</dd>
        <dt>Thread keyed on</dt><dd><span class="mono">${esc(t.key)}</span> <span class="t-muted">— ${esc(keyKind(t.key))}. This is who the thread is, not where it goes; the message is addressed to the line above.</span></dd>
        <dt>Identified as</dt><dd>${pill(id.label, id.tone)}</dd>
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
