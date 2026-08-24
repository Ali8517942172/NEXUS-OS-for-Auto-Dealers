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
   and 20 under his LID. The view now resolves every log row to a canonical
   person before grouping, which means:

     · `thread_key` is the identity — one value per person, stable, and the key
       this screen selects, filters, searches and opens rows on;
     · `chat_id` is the address — the only thing WAHA can send to.

   They are no longer the same string and nothing may be sent to `thread_key`.
   The one place that was still keyed wrongly was the per-thread message read:
   selecting `lead_email=eq.thread_key` returned only the rows that happened to
   be logged under that key — two thirds of this customer's history, rendered as
   though it were all of it. Messages are now read under every key the view
   resolved onto the person, and the pane says which keys those were.

   `whatsapp_contacts.phone` was backfilled from WAHA on 24 Aug, so
   `display_name` falls back to a chat id for nobody and `unidentified` and "no
   phone number stored" both now describe something the data does not contain.
   Both branches are kept, because a row that arrives before the contact lookup
   answers would land there and must not be dressed up as a known customer.
   Neither gets headline space: a KPI permanently reading 0 and a filter tab that
   can only ever be empty are how an operator learns to stop reading the strip.

   The phone is shown beside the name in every place a thread is listed — alert
   strip, list row, pane header and send confirmation. It is the one identifier
   that is true for everybody, and it is what an operator dials or searches for
   in WhatsApp. It is formatted for reading (+971 50 123 4567) and the stored
   value is on the `title` of every one of them, because the grouping is a
   rendering and the digits are the record.

   ── 2. One conversation ─────────────────────────────────────────────────────
   Every thread that was not a customer was deleted on 24 Aug — thirteen handles
   belonging to the owner's personal phone book, and with them both open
   `unanswered_chat` rows. The inbox now holds exactly one person, and a list
   built for forty threads looks broken holding one: a 360px column with a search
   box, four filter tabs and a single row in it reads as a screen that failed to
   load the rest.

   So the layout follows the data. Below SPLIT_MIN threads there is no list
   column, no search and no filter tabs — there is nothing to choose between, and
   a control that cannot change what is on screen is furniture. The summary above
   says plainly that what is shown is the whole of the inbox. Above SPLIT_MIN the
   list, the search and the tabs come back, and a tab whose count is zero is not
   drawn at all rather than sitting there able only to say "no conversation
   matches".

   Nothing here is averaged, rated or distributed. Every figure on this screen is
   a count of rows the view returned, which is the only kind of number that
   survives an inbox of one.

   ── 3. Silence is not always a failure ──────────────────────────────────────
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
import { ago, esc, initials, num, pill } from '../lib/format.js';
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

const plural = (n, one, many) => (Number(n) === 1 ? one : many);

const VIEW_COLS = 'thread_key,chat_id,phone,push_name,lead_email,lead_name,lead_status,'
  + 'display_name,identified,message_count,inbound_count,outbound_count,'
  + 'last_message_at,last_message,last_direction,awaiting_reply';

const low = s => String(s == null ? '' : s).trim().toLowerCase();
const str = v => String(v == null ? '' : v).trim();
const ts  = v => { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; };
const stamp = v => { const t = Date.parse(v); return Number.isNaN(t) ? 'no timestamp recorded' : new Date(t).toLocaleString('en-GB'); };
const clockOf = v => { const t = Date.parse(v); return Number.isNaN(t) ? null : new Date(t).toLocaleString('en-GB'); };
const daysSince = v => { const t = Date.parse(v); return Number.isNaN(t) ? null : (Date.now() - t) / 86400000; };

/* A WhatsApp handle, in any of the shapes WAHA emits. A LID carries no phone
   digits, so it names nobody — anything matching this is an address and is
   rendered as one, in mono, never in a name position. */
const HANDLE = /@(lid|c\.us|s\.whatsapp\.net|g\.us)$/i;
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
   A group id belongs to nobody and an email is not dialable. So an address is
   only read as a number when the shape of the address says it is one. */
const LID_OR_GROUP = /@(lid|g\.us)$/i;
const DIALABLE_SUFFIX = /@(c\.us|s\.whatsapp\.net)$/i;
function addressPhone(v) {
  const a = str(v);
  if (!a) return '';
  if (LID_OR_GROUP.test(a)) return '';
  if (a.includes('@') && !DIALABLE_SUFFIX.test(a)) return '';
  return fmtPhone(a);
}

/* Half of the bot's reply rule, and an honest account of the other half. */
const NOT_A_LEAD =
  'No row in the leads table matches this contact. The WhatsApp bot replies automatically only to numbers '
  + 'already in leads, or to messages containing dealership keywords — anything else is logged and left for a '
  + 'human on purpose, because the business number is a personal one. Whether a particular message hit a keyword '
  + 'is not recorded anywhere the dashboard can read, so this tells you one half of that rule and not the other.';
const NO_PHONE_WHY =
  'Every WhatsApp contact was backfilled with a real number from WAHA on 24 Aug 2026, so a thread with none is '
  + 'either newer than that job or was missed by it. It is an exception worth reporting, not an ordinary blank.';

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
    /* Since the 24 Aug backfill this branch describes nothing in the data. It
       stays because a contact whose lookup has not answered yet would land here,
       and the one thing that must never happen is a bare chat handle being shown
       as a person. The wording says plainly that it is now an anomaly, so that
       an operator who does see it treats it as something to report rather than
       as an ordinary stranger. */
    note: 'No lead, no profile name and no phone number resolves for this thread — all that is stored is the chat '
        + 'handle, which for a LID contains no phone digits. Every historic contact was backfilled with a real '
        + 'number on 24 Aug 2026, so this state should no longer occur; a thread showing it is newer than that '
        + 'backfill or was missed by it.',
  },
};
const identOf = t => IDENT[t.identified] || IDENT.unidentified;

/* What the thread key actually is, said plainly, so nobody mistakes a machine
   handle for something a human chose. */
function keyKind(key) {
  const k = low(key);
  if (!k) return 'no thread key recorded';
  if (k.endsWith('@lid')) return 'WhatsApp LID handle — it contains no phone number';
  if (k.endsWith('@c.us')) return 'WhatsApp chat id';
  if (k.endsWith('@g.us')) return 'WhatsApp group id';
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(k)) return 'email address';
  return 'thread key';
}

const NO_N8N =
  'VITE_N8N_BASE_URL is not set in this build, so the browser has no n8n host to call and the '
  + 'whatsapp-send webhook cannot be reached. Replies have to go out from WhatsApp itself.';
const noChatWhy = t =>
  `This thread is keyed on "${t.key}" (${keyKind(t.key)}) and no chat_id is stored for it in `
  + 'v_conversations, so WAHA has no WhatsApp address to send to. Replying needs a chat_id, which '
  + 'only arrives when the contact messages the business number. If they are waiting, the reply has to be '
  + 'typed inside WhatsApp itself — nothing on this screen can send it for you.';

const dayLabel = v => {
  const t = Date.parse(v);
  if (Number.isNaN(t)) return 'Undated';
  const d = new Date(t), now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= midnight) return 'Today';
  if (t >= midnight - 86400000) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
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
  return {
    key,
    chat_id: str(r.chat_id) || null,
    phone: str(r.phone) || null,
    push_name: str(r.push_name) || null,
    lead_email: str(r.lead_email) || null,
    lead_name: str(r.lead_name) || null,
    lead_status: str(r.lead_status) || null,
    identified: ident,
    name: named ? shown : '',
    count: Number(r.message_count) || 0,
    inbound: Number(r.inbound_count) || 0,
    outbound: Number(r.outbound_count) || 0,
    last_at: r.last_message_at || null,
    last_message: r.last_message == null ? '' : String(r.last_message),
    last_direction: low(r.last_direction),
    awaiting: r.awaiting_reply === true,
  };
}

/* Three states, and they are three different sentences. We know their name; we
   know their number but not their name; we know neither. The middle one is now
   the floor — the backfill guaranteed a number for everybody — so it reads as an
   ordinary, workable thread rather than as a failure. */
const titleOf = t => t.name || (addressPhone(t.phone) ? 'Name not known' : 'Unidentified contact');
const titleWhy = t => t.name
  ? ''
  : (addressPhone(t.phone)
      ? 'We have this contact\u2019s phone number but no name: no lead record matches it and they have set no WhatsApp profile name.'
      : identOf(t).note);
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
  else bits.push(`<span class="t-muted" title="${esc(NOT_A_LEAD)}">Not in leads</span>`);
  if (!t.name && t.key) bits.push(`<span class="mono" title="${esc(keyKind(t.key))}">${esc(t.key)}</span>`);
  return bits.join(' · ');
}

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
    return { list: uniq, dropped: bad, capped: rows.length >= THREAD_LIMIT };
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
     rows already in memory — no second round-trip for a decoration. Both are
     about the same person the view cares about; they exist because the view's
     unanswered_chat branch has two edges it cannot reach past.

     One: the branch looks back seven days, so a thread that has been waiting
     eight is waiting just as hard and is reported by nothing. Two: `ref` is a
     chat_id, so a thread that has no chat_id cannot appear in it at all — and
     that same missing chat_id is what makes it unanswerable from this dashboard,
     so it has to be answered in WhatsApp itself by a human who is told to. */
  function derivedAlerts(viewRefs) {
    const out = [];
    threads.forEach(t => {
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
              + 'gone unanswered. A row appears here when one does, stays for the '
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
                style="font-size:20px">${a.kind === 'unanswered_chat' ? 'mark_chat_unread' : (a.kind === 'no_whatsapp_address' ? 'link_off' : 'schedule')}</span>
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
     that row wearing a chart's clothes. */
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

    /* One thread is not an inbox, and four KPI tiles reading 1 / 0 / 1 / 1 make
       it look like one that has been emptied by an outage. The same facts are
       stated as facts instead, and the tiles come back when there is more than
       one thread to compare. */
    if (threads.length === 1) {
      const t = threads[0];
      const who = t.name || (addressPhone(t.phone) ? addressPhone(t.phone) : 'this contact');
      const reply = t.awaiting
        ? `<span class="t-hot">Reply due.</span> The newest message is theirs, logged ${esc(ago(t.last_at))}, and nothing has gone back.`
        : (t.outbound
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
              ${num(t.inbound)} from ${esc(who)}, ${num(t.outbound)} sent back, newest ${esc(ago(t.last_at))}.
              ${whole}One thread is not a sample, so nothing on this screen is averaged, ranked or shown as a share.
              ${capNote}${capNote && dropNote ? ' ' : ''}${dropNote}
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
    const withPhone = threads.filter(t => addressPhone(t.phone)).length;
    const noPhone = threads.length - withPhone;
    /* Waiting, but older than the view looks back — so nobody is being reminded
       about them except this screen. Named beside the headline rather than
       folded into it, because the headline is the view's number and this is not. */
    const outsideWindow = awaiting.filter(t => {
      const d = daysSince(t.last_at);
      return d != null && d > CHAT_WINDOW_DAYS;
    }).length;

    strip.className = 'grid g4';
    strip.innerHTML = [
      kpi('Conversations', num(threads.length),
        `${num(msgs)} ${plural(msgs, 'message', 'messages')} logged`
        + (capped ? ` · ${capNote}` : '')
        + (dropped ? ` · ${dropNote}` : '')),

      kpi('Reply due', num(awaiting.length),
        awaiting.length
          ? `<span class="t-hot">Oldest waiting since ${esc(ago(oldest.last_at))}</span>`
            + (outsideWindow
              ? ` · <span class="t-warm">${num(outsideWindow)} past the ${num(CHAT_WINDOW_DAYS)}-day alert window</span>`
              : '')
          : '<span class="t-ok">Every thread ends with a message we sent</span>',
        awaiting.length ? 't-hot' : ''),

      /* This tile used to count the people we could not identify, which after
         the backfill is a permanent zero — a number that never moves teaches an
         operator to stop reading the strip it sits in. It now counts the thing
         the backfill actually delivered, and keeps the identity breakdown in the
         sub-line where it is still worth knowing. Unidentified is named only
         when there is one, and then loudly, because it is now an anomaly. */
      kpi('Numbers on file', num(withPhone),
        (noPhone
          ? `<span class="t-warm">${num(noPhone)} ${plural(noPhone, 'thread has', 'threads have')} none</span>`
          : '<span class="t-ok">Every thread has a real phone number</span>')
        + ` · ${num(by.lead)} matched to a lead · ${num(by.whatsapp_profile)} WhatsApp name · ${num(by.phone_only)} number only`
        + (by.unidentified ? ` · <span class="t-hot">${num(by.unidentified)} unidentified</span>` : ''),
        noPhone ? 't-warm' : ''),

      kpi('Repliable from here', num(withChat),
        !N8N_BASE
          ? '<span class="t-hot">n8n host not configured — sending is off</span>'
          : noChat
            ? `<span class="t-warm">${num(noChat)} ${plural(noChat, 'thread has', 'threads have')} no chat_id and cannot be replied to</span>`
            : '<span class="t-ok">Every thread has a WhatsApp address</span>'),
    ].join('');
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
      count: () => threads.filter(t => !t.lead_email).length, title: NOT_A_LEAD },
    { f: 'unknown', label: 'Unidentified', optional: true,
      count: () => threads.filter(t => t.identified === 'unidentified').length,
      title: 'Threads where no lead, profile name or phone number resolves — all we hold is the chat handle. Every '
           + 'historic contact was backfilled with a real number on 24 Aug 2026, so this should be empty; it is '
           + 'shown because it is not.' },
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
  const haystack = t => `${t.name} ${t.key} ${t.chat_id || ''} ${t.phone || ''} ${addressPhone(t.phone)} ${t.lead_email || ''} ${t.push_name || ''} ${t.last_message}`.toLowerCase();

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
    const d = phoneDigits(t.phone);
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
                <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px"
                      aria-hidden="true"
                      title="${esc(t.last_direction === 'inbound' ? 'Newest message came from them' : (t.last_direction === 'outbound' ? 'Newest message was sent by us' : 'communication_logs recorded no direction on the newest message'))}"
                      >${t.last_direction === 'inbound' ? 'south_west' : (t.last_direction === 'outbound' ? 'north_east' : 'help')}</span>
                ${preview(t.last_message)}
              </div>
            </div>
            <div style="flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:4px">
              <span class="cell-sub" title="${esc(stamp(t.last_at))}">${esc(ago(t.last_at))}</span>
              ${t.awaiting ? pill('Reply due', 'hot') : `<span class="cell-sub">${num(t.count)} msg</span>`}
              ${t.identified === 'lead' ? '' : `<span class="chip" title="${esc(id.label)} — ${esc(id.note)}">${esc(id.short)}</span>`}
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
    if (t.identified === 'unidentified') {
      out.push(`<div class="banner warm">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">person_search</span>
        <div>${esc(id.note)} Treat nothing in this thread as a known customer, and read the handle below as an address, not a name.</div>
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
    if (t.inbound === 0 && t.outbound > 0) {
      out.push(`<div class="banner info">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">send</span>
        <div>Only outbound messages are logged for this contact, so this thread shows one side of the conversation.</div>
      </div>`);
    } else if (t.outbound === 0 && t.inbound > 0) {
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
        ${t.lead_email
          ? `<button class="btn sm" id="cvLead">Open lead</button>`
          : `<button class="btn sm" disabled title="${esc('No lead record resolves for this thread — v_conversations returned no lead_email, so there is nothing to open. ' + NOT_A_LEAD)}">Open lead</button>`}
      </div>
      <div class="cell-sub" id="cvNote" style="padding:0 20px" aria-live="polite"></div>
      ${bannerHtml ? `<div style="padding:16px 20px 0">${bannerHtml}</div>` : ''}
      <div style="flex:1;overflow-y:auto" id="cvBody">${stateLoading(5)}</div>
      <div style="padding:16px 20px;border-top:1px solid var(--border-subtle)">
        <div class="field">
          <label for="cvReply">Reply on WhatsApp to ${t.name ? esc(t.name) : (addressPhone(t.phone) ? esc(addressPhone(t.phone)) : 'this contact')}</label>
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
     number had already been matched, the WhatsApp handle if it had not. The
     rebuilt view resolves all of those onto one person, which is why this
     customer is now one thread of 66 messages instead of two of 46 and 20 — but
     the log rows still carry the key they arrived under. Reading on `thread_key`
     alone would return whichever subset shares that key and render it as the
     whole conversation, which is the more dangerous kind of wrong: it looks
     complete. Both the identity and the address are read, de-duplicated, and the
     pane says underneath which keys it read. */
  const msgKeys = t => [...new Set([t.key, t.chat_id, t.lead_email].filter(Boolean))];
  const keyRole = (t, k) => (k === t.chat_id && k !== t.key ? 'WhatsApp address' : (k === t.lead_email ? 'lead email' : keyKind(k)));
  /* PostgREST wants an in-list of double-quoted values. The quotes are written
     as %22 and each key is percent-encoded on its own, so the commas and quotes
     that delimit the list survive as delimiters whatever the key contains; a
     quote or backslash inside a key is escaped rather than closing the value. */
  const inList = keys => keys.map(k => '%22' + encodeURIComponent(String(k).replace(/["\\]/g, m => '\\' + m)) + '%22').join(',');

  /* Newest-first with a cap, then reversed, so a long history shows its most
     recent window rather than its oldest one. */
  async function loadMessages(t) {
    const body = $('cvBody');
    if (!body) return;
    body.innerHTML = stateLoading(5);
    const keys = msgKeys(t);
    let msgs;
    try {
      msgs = await db('communication_logs?select=id,direction,message,channel,created_at'
        + `&lead_email=in.(${inList(keys)})&order=created_at.desc&limit=${MSG_LIMIT}`);
    } catch (e) {
      body.innerHTML = stateError('this conversation', e.message, 'thread');
      body.querySelector('[data-retry]')?.addEventListener('click', () => loadMessages(t));
      return;
    }
    const truncated = msgs.length >= MSG_LIMIT;
    const list = [...msgs].reverse();

    if (!list.length) {
      body.innerHTML = stateEmpty('No messages in this thread',
        `v_conversations counts ${num(t.count)} ${plural(t.count, 'message', 'messages')} for this contact, but `
        + `communication_logs returned none under ${plural(keys.length, 'the key', 'any of the keys')} the view `
        + `resolved onto them (${keys.join(', ')}). Nothing is being shown rather than guessing at the history.`,
        'forum');
      return;
    }

    const channels = new Map();
    list.forEach(m => {
      const c = str(m.channel) || 'unrecorded channel';
      channels.set(c, (channels.get(c) || 0) + 1);
    });
    const chips = [...channels.entries()].map(([c, n]) => `<span class="chip">${esc(c)} · ${num(n)}</span>`).join(' ');

    /* Two numbers counted by two different pieces of software over the same
       rows. They agree, or the discrepancy is the thing worth reading — it means
       the view resolved a row onto this person that this query did not fetch,
       and the history on screen is not the history the summary claims. */
    const countNote = (!truncated && list.length !== t.count)
      ? `<div style="margin-top:6px"><span class="t-warm">v_conversations counts ${num(t.count)} for this contact `
        + `and ${num(list.length)} ${plural(list.length, 'was', 'were')} read from communication_logs, so this thread `
        + 'is not the whole of it. The view resolves rows onto a person by more than the keys read here.</span></div>'
      : '';
    /* Which keys this history was assembled from. It is the honest version of a
       merge: the customer is one person, the rows are filed under two names, and
       an operator who opens the thread can see that rather than wondering why
       the pane holds more messages than the address at the top would suggest. */
    const keyNote = keys.length > 1
      ? `<div style="margin-top:6px">Assembled from ${num(keys.length)} keys in communication_logs.lead_email — `
        + keys.map(k => `<span class="mono">${esc(k)}</span> <span class="t-muted">(${esc(keyRole(t, k))})</span>`).join(', ')
        + ' — which v_conversations resolves onto the same person.</div>'
      : '';

    body.innerHTML = `
      ${truncated ? `<div style="padding:16px 20px 0"><div class="banner info">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">history</span>
        <div>Only the newest ${num(MSG_LIMIT)} messages of this thread were read. Anything older is not shown.</div>
      </div></div>` : ''}
      <div class="thread">
        ${list.map((m, i) => {
          const inbound = low(m.direction) === 'inbound';
          const day = dayLabel(m.created_at);
          const sep = (i === 0 || day !== dayLabel(list[i - 1].created_at))
            ? `<div class="label-caps" style="text-align:center;margin-top:6px">${esc(day)}</div>` : '';
          const text = String(m.message == null ? '' : m.message).trim();
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
        ${num(list.length)} ${plural(list.length, 'message', 'messages')} shown · ${num(t.inbound)} inbound · ${num(t.outbound)} outbound in this thread
        ${countNote}
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
          : (addressPhone(t.phone)
              ? '<span class="t-muted">We have this number but not a name for it</span>'
              : '<span class="t-muted">Unidentified contact — we do not know whose number this is</span>')}</dd>
        <dt>Phone</dt><dd>${addressPhone(t.phone)
          ? `<span class="mono" title="Stored as ${esc(t.phone)}">${esc(addressPhone(t.phone))}</span>`
          : (t.phone
              ? `<span class="mono">${esc(t.phone)}</span> <span class="t-muted">— stored as something that does not read as a dialable number, so it is shown exactly as stored</span>`
              : `<span class="t-warm">Not stored for this contact</span> <span class="t-muted">${esc(NO_PHONE_WHY)}</span>`)}</dd>
        <dt>In leads</dt><dd>${t.lead_email
          ? esc(t.lead_email)
          : `<span class="t-muted" title="${esc(NOT_A_LEAD)}">No — the bot does not answer this number automatically, so this reply is the first one they get from a person.</span>`}</dd>
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
      threads = read.list; dropped = read.dropped; capped = read.capped;
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
