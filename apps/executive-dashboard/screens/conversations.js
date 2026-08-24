/* NEXUS OS — screens/conversations.js
   Rebuilt on 24 Aug 2026 against v_conversations.

   The thread list used to be built in the browser by grouping communication_logs
   on `lead_email`, and it printed that key as the contact's name. For a WhatsApp
   thread the key is an opaque LID handle, so the inbox listed people as
   "163188003877036@lid". v_conversations now does the resolution in the database
   — lead name → WhatsApp profile name → phone → the raw key — and reports which
   of those it managed with `identified`. This screen reads that view and refuses
   to flatten the four cases into one confident-looking name:

     · lead              a row in `leads` matches. We know who this is.
     · whatsapp_profile  the name is what the contact typed into their own
                         WhatsApp profile. Unverified, and no lead record.
     · phone_only        a number and nothing else.
     · unidentified      nothing but the chat handle, which for a LID contains
                         no phone digits at all. This is NOT a name and is never
                         rendered as one, even though `display_name` falls back
                         to it — the guard is `display_name === thread_key`.

   `phone` is null on every historic contact because it was never captured; the
   absence is rendered as an absence and never filled in.

   Sending is live now (HOOK.whatsappSend) and it goes out on the dealership's
   real WhatsApp number, so:
     · the composer never sends on Enter — Enter is a line break, and the send
       button opens a confirmation naming the exact address the message goes to;
     · the message is shown in flight, and the workflow's own answer decides the
       outcome. {status:'sent'} is success, {status:'error'} is a failure stated
       verbatim, and anything else is reported as "unknown" rather than assumed;
     · nothing is optimistically appended to the thread. The workflow writes the
       outbound to communication_logs, so a successful send re-reads the thread
       and shows only what the database actually holds.
     · a thread with no chat_id (the older email-keyed rows) cannot be sent to at
       all, and the composer says which field is missing.

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

const VIEW_COLS = 'thread_key,chat_id,phone,push_name,lead_email,lead_name,lead_status,'
  + 'display_name,identified,message_count,inbound_count,outbound_count,'
  + 'last_message_at,last_message,last_direction,awaiting_reply';

const low = s => String(s == null ? '' : s).trim().toLowerCase();
const str = v => String(v == null ? '' : v).trim();
const ts  = v => { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; };
const stamp = v => { const t = Date.parse(v); return Number.isNaN(t) ? 'no timestamp recorded' : new Date(t).toLocaleString('en-GB'); };
const clockOf = v => { const t = Date.parse(v); return Number.isNaN(t) ? null : new Date(t).toLocaleString('en-GB'); };

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
    label: 'Phone number only',
    short: 'Phone only',
    tone: 'warm',
    named: true,
    note: 'We hold a phone number for this contact and nothing else — no lead record and no profile name.',
  },
  unidentified: {
    label: 'Unidentified',
    short: 'Unidentified',
    tone: 'warm',
    named: false,
    note: 'We do not know who this is. The only handle stored is the WhatsApp chat id, '
        + 'which for a LID contact contains no phone digits, and no lead or contact row matches it.',
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
  + 'only arrives when the contact messages the business number.';

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
  /* The view falls back to the raw key when it has nothing better. That
     fallback is a machine handle, never a name — so it is not used as one, and
     the guard holds even if `identified` is ever wrong. */
  const isKey = !shown || shown === key;
  const named = IDENT[ident].named && !isKey;
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

const titleOf = t => t.name || 'Unidentified contact';
const avatarOf = t => t.name ? esc(initials(t.name)) : '?';

/* The second line of every thread row and of the pane header. It says what we
   hold, including when that is nothing. */
function contactLine(t) {
  const bits = [];
  if (t.phone) bits.push(`<span class="mono">${esc(t.phone)}</span>`);
  else bits.push('<span class="t-muted">No phone number stored</span>');
  if (!t.name || t.identified === 'unidentified') {
    bits.push(`<span class="mono" title="${esc(keyKind(t.key))}">${esc(t.key)}</span>`);
  }
  return bits.join(' · ');
}

SCREENS.conversations = async host => {
  const strip = el('div', 'grid g4');
  const wrap  = el('div', 'card flush');
  wrap.style.marginTop = '16px';
  host.appendChild(strip);
  host.appendChild(wrap);

  let threads = [], dropped = 0, capped = false;
  let q = '', filter = 'all', selected = null;

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

  async function boot() {
    strip.innerHTML = stateLoading(2);
    wrap.style.display = 'block';
    wrap.style.minHeight = '';
    wrap.innerHTML = stateLoading(8);

    let read;
    try {
      read = await readThreads();
    } catch (e) {
      strip.innerHTML = stateError('the inbox summary', e.message);
      wrap.innerHTML = stateError('conversations', e.message, 'reload');
      wrap.querySelector('[data-retry]')?.addEventListener('click', boot);
      return;
    }
    threads = read.list; dropped = read.dropped; capped = read.capped;

    renderStrip();

    if (!threads.length) {
      wrap.innerHTML = stateEmpty(
        dropped ? 'No conversation can be addressed' : 'No conversations yet',
        dropped
          ? `${num(dropped)} ${dropped === 1 ? 'row has' : 'rows have'} no thread_key in v_conversations, `
            + 'so there is no contact to attach those messages to.'
          : 'Threads appear here once the WhatsApp agent writes its first row to communication_logs.',
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

  /* ── Summary strip. Every number here is a count of rows the view returned. */
  function renderStrip() {
    const awaiting = threads.filter(t => t.awaiting);
    const oldest = oldestWaiting();
    const msgs = threads.reduce((s, t) => s + t.count, 0);
    const by = { lead: 0, whatsapp_profile: 0, phone_only: 0, unidentified: 0 };
    threads.forEach(t => { by[t.identified] = (by[t.identified] || 0) + 1; });
    const withChat = threads.filter(t => t.chat_id).length;
    const noChat = threads.length - withChat;

    strip.innerHTML = [
      kpi('Conversations', num(threads.length),
        `${num(msgs)} ${msgs === 1 ? 'message' : 'messages'} logged`
        + (capped ? ` · <span class="t-warm">only the newest ${num(THREAD_LIMIT)} threads were read</span>` : '')
        + (dropped ? ` · <span class="t-warm">${num(dropped)} row(s) had no thread key</span>` : '')),

      kpi('Reply due', num(awaiting.length),
        awaiting.length
          ? `<span class="t-hot">Oldest waiting since ${esc(ago(oldest.last_at))}</span>`
          : '<span class="t-ok">Every thread ends with a message we sent</span>',
        awaiting.length ? 't-hot' : ''),

      kpi('Unidentified', num(by.unidentified),
        `${num(by.lead)} matched to a lead · ${num(by.whatsapp_profile)} WhatsApp name · ${num(by.phone_only)} phone only`,
        by.unidentified ? 't-warm' : ''),

      kpi('Repliable from here', num(withChat),
        !N8N_BASE
          ? '<span class="t-hot">n8n host not configured — sending is off</span>'
          : noChat
            ? `<span class="t-warm">${num(noChat)} thread(s) have no chat_id and cannot be replied to</span>`
            : '<span class="t-ok">Every thread has a WhatsApp address</span>'),
    ].join('');
  }

  /* ── Shell ───────────────────────────────────────────────────────────── */
  function renderShell() {
    const awaiting = threads.filter(t => t.awaiting).length;
    const unknown = threads.filter(t => t.identified === 'unidentified').length;
    wrap.style.display = 'grid';
    wrap.style.gridTemplateColumns = '360px minmax(0,1fr)';
    wrap.style.minHeight = '640px';
    wrap.innerHTML = `
      <div style="border-right:1px solid var(--border);display:flex;flex-direction:column;min-width:0">
        <div class="toolbar" style="border-bottom:1px solid var(--border-subtle)">
          <div class="grow">
            <label class="sr-only" for="cvQ">Search conversations</label>
            <input type="search" id="cvQ" placeholder="Search name, number, handle, last message" />
          </div>
        </div>
        <div class="toolbar" style="padding-top:0;border-bottom:1px solid var(--border-subtle)">
          <div class="seg" role="group" aria-label="Filter conversations">
            <button type="button" data-f="all" class="on" aria-pressed="true">All ${num(threads.length)}</button>
            <button type="button" data-f="await" aria-pressed="false"
              title="Threads whose newest message is inbound with nothing sent after it (awaiting_reply in v_conversations). communication_logs has no read state, so this is derived from direction — it is not an unread flag.">Reply due ${num(awaiting)}</button>
            <button type="button" data-f="unknown" aria-pressed="false"
              title="Threads where no lead, profile name or phone number resolves — all we hold is the chat handle.">Unidentified ${num(unknown)}</button>
          </div>
        </div>
        <div id="cvList" style="overflow-y:auto;flex:1"></div>
      </div>
      <div style="display:flex;flex-direction:column;min-width:0" id="cvPane"></div>`;

    $('cvQ').addEventListener('input', e => { q = low(e.target.value); drawList(); });
    wrap.querySelectorAll('.seg button').forEach(b => {
      b.addEventListener('click', () => {
        filter = b.dataset.f;
        wrap.querySelectorAll('.seg button').forEach(x => {
          const on = x === b;
          x.classList.toggle('on', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        drawList();
      });
    });
  }

  const haystack = t => `${t.name} ${t.key} ${t.phone || ''} ${t.lead_email || ''} ${t.push_name || ''} ${t.last_message}`.toLowerCase();

  const visible = () => threads.filter(t => {
    if (filter === 'await' && !t.awaiting) return false;
    if (filter === 'unknown' && t.identified !== 'unidentified') return false;
    return !q || haystack(t).includes(q);
  });

  function drawList() {
    const rows = visible();
    const notes = [];
    if (capped) notes.push(`Only the newest ${num(THREAD_LIMIT)} threads were read, so older conversations are missing from this list.`);
    if (dropped) notes.push(`${num(dropped)} row(s) in v_conversations have no thread_key and cannot be opened.`);
    notes.push('Search covers names, numbers, handles and the newest message only — older message text is not loaded until a thread is opened.');
    const footHtml = `<div class="list-item" style="cursor:default;align-items:flex-start">
        <span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">info</span>
        <div class="cell-sub" style="white-space:normal">${notes.map(esc).join('<br>')}</div>
      </div>`;

    $('cvList').innerHTML = (rows.length
      ? rows.map(t => {
        const id = identOf(t);
        return `
          <div class="list-item${t.key === selected ? ' on' : ''}" role="button" tabindex="0"
               data-k="${esc(t.key)}" aria-current="${t.key === selected ? 'true' : 'false'}"
               style="align-items:flex-start">
            <div class="avatar" aria-hidden="true">${avatarOf(t)}</div>
            <div style="flex:1;min-width:0">
              <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                <span style="font-weight:500${t.name ? '' : ';font-style:italic'}"
                      class="${t.name ? '' : 't-muted'}">${esc(titleOf(t))}</span>
              </div>
              <div class="cell-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                ${contactLine(t)}
              </div>
              <div class="cell-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                <span class="material-symbols-outlined" style="font-size:14px;vertical-align:-2px"
                      aria-hidden="true">${t.last_direction === 'inbound' ? 'south_west' : 'north_east'}</span>
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
          filter === 'all' ? 'Try a different search term.' : 'Try a different search term or filter.',
          'search_off')) + footHtml;

    $('cvList').querySelectorAll('[data-k]').forEach(node => {
      node.addEventListener('click', () => openThread(node.dataset.k));
      node.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openThread(node.dataset.k); return; }
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const all = [...$('cvList').querySelectorAll('[data-k]')];
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
    $('cvList').querySelectorAll('[data-k]').forEach(n => {
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
      out.push(`<div class="banner warm">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">schedule</span>
        <div>The newest message is inbound, logged ${esc(ago(t.last_at))}, and no outbound message has been recorded after it.</div>
      </div>`);
    }
    if (t.inbound === 0) {
      out.push(`<div class="banner info">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">send</span>
        <div>Only outbound messages are logged for this contact, so this thread shows one side of the conversation.</div>
      </div>`);
    } else if (t.outbound === 0) {
      out.push(`<div class="banner hot">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">mark_email_unread</span>
        <div>No outbound message has ever been logged for this contact — every message here came from them.</div>
      </div>`);
    }
    return out.join('');
  }

  function renderPane(t, note) {
    const id = identOf(t);
    const canSend = Boolean(t.chat_id) && Boolean(N8N_BASE);
    const why = !N8N_BASE ? NO_N8N : (!t.chat_id ? noChatWhy(t) : '');
    const dis = canSend ? '' : ` disabled title="${esc(why)}"`;

    $('cvPane').innerHTML = `
      <div class="card-head">
        <div class="avatar" aria-hidden="true">${avatarOf(t)}</div>
        <div style="min-width:0">
          <div class="card-title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            <span class="${t.name ? '' : 't-muted'}">${esc(titleOf(t))}</span>
          </div>
          <div class="card-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${contactLine(t)}${t.lead_email ? ' · ' + esc(t.lead_email) : ''}
          </div>
        </div>
        <div style="flex:1"></div>
        <span title="${esc(id.note)}">${pill(id.label, id.tone)}</span>
        ${t.lead_status ? pill(t.lead_status) : ''}
        <button class="btn sm" id="cvRefresh"><span class="material-symbols-outlined">refresh</span>Refresh</button>
        ${t.lead_email
          ? `<button class="btn sm" id="cvLead">Open lead</button>`
          : `<button class="btn sm" disabled title="No lead record resolves for this thread — v_conversations returned no lead_email, so there is nothing to open.">Open lead</button>`}
      </div>
      <div class="cell-sub" id="cvNote" style="padding:0 20px" aria-live="polite"></div>
      <div style="padding:16px 20px 0">${banners(t)}</div>
      <div style="flex:1;overflow-y:auto" id="cvBody">${stateLoading(5)}</div>
      <div style="padding:16px 20px;border-top:1px solid var(--border-subtle)">
        <div class="field">
          <label for="cvReply">Reply on WhatsApp${t.name ? ' to ' + esc(t.name) : ''}</label>
          <textarea id="cvReply" rows="3"${dis}
            placeholder="${canSend ? 'Type a reply. Enter adds a line break — nothing is sent until you confirm.' : 'Replying from the dashboard is unavailable for this thread'}"></textarea>
          <div class="hint">${canSend
            ? `Enter adds a line break. <strong>Review and send</strong> opens a confirmation showing the exact WhatsApp address; the message only leaves after you confirm it there. Ctrl+Enter opens the same confirmation. This goes out on the dealership's live number and cannot be recalled.`
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

  /* Messages are read per thread, keyed on the same column the view groups on.
     Newest-first with a cap, then reversed, so a long history shows its most
     recent window rather than its oldest one. */
  async function loadMessages(t) {
    const body = $('cvBody');
    if (!body) return;
    body.innerHTML = stateLoading(5);
    let msgs;
    try {
      msgs = await db(`communication_logs?select=id,direction,message,channel,created_at&lead_email=eq.${encodeURIComponent(t.key)}&order=created_at.desc&limit=${MSG_LIMIT}`);
    } catch (e) {
      body.innerHTML = stateError('this conversation', e.message, 'thread');
      body.querySelector('[data-retry]')?.addEventListener('click', () => loadMessages(t));
      return;
    }
    const truncated = msgs.length >= MSG_LIMIT;
    const list = [...msgs].reverse();

    if (!list.length) {
      body.innerHTML = stateEmpty('No messages in this thread',
        `v_conversations counted ${num(t.count)} message(s) for this contact, but communication_logs returned none for `
        + `"${t.key}". Nothing is being shown rather than guessing at the history.`, 'forum');
      return;
    }

    const channels = new Map();
    list.forEach(m => {
      const c = str(m.channel) || 'unrecorded channel';
      channels.set(c, (channels.get(c) || 0) + 1);
    });
    const chips = [...channels.entries()].map(([c, n]) => `<span class="chip">${esc(c)} · ${num(n)}</span>`).join(' ');

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
        ${num(list.length)} message(s) shown · ${num(t.inbound)} inbound · ${num(t.outbound)} outbound in this thread
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
        <dt>To</dt><dd>${t.name ? esc(t.name) : '<span class="t-muted">Unidentified contact — we do not know whose number this is</span>'}</dd>
        <dt>Phone</dt><dd>${t.phone ? `<span class="mono">${esc(t.phone)}</span>` : '<span class="t-muted">Not stored for this contact</span>'}</dd>
        <dt>WhatsApp address</dt><dd><span class="mono">${esc(t.chat_id)}</span></dd>
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
      renderStrip();
      drawList();
      if (threads.some(x => x.key === t.key)) openThread(t.key, sentNote);
      else { loadMessages(t); setSendMsg(sentNote); }
    } catch (e) {
      /* The send outcome stands on its own; only the refresh failed. */
      loadMessages(t);
      setSendMsg(sentNote + ` <span class="t-warm">The conversation list could not be re-read (${esc(e.message)}), so the counts beside it may be stale.</span>`);
    }
  }

  /* Last, not first: the helpers above are const arrows, so booting before this
     line would run them inside their own temporal dead zone and take the whole
     screen down with a ReferenceError. */
  await boot();
};
