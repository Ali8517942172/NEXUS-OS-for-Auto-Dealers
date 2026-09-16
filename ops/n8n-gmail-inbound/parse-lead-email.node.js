/* The exact body of the "Parse Lead Email" Code node in the n8n workflow
 * "Gmail Inbound - Lead Email Receiver".
 *
 * WHAT THIS NODE IS ALLOWED TO CLAIM
 *
 * It turns ONE Gmail message into the arguments for nexus_record_lead_event.
 * It authenticates nothing. It is downstream of a Gmail Trigger polling a
 * mailbox we hold an OAuth token for, and that is the whole of the provenance:
 *
 *   origin_verified = 'mailbox_read_oauth'
 *
 * Read that literally. It attests THE FETCH, not THE MESSAGE:
 *
 *   - It says: these bytes were really in that inbox, and we really are the
 *     account that read them. Nobody can hand us this payload over HTTP; they
 *     have to get mail delivered to a mailbox we control.
 *   - It does NOT say the sender is who the From header claims. SPF is a
 *     statement about the connecting IP, and it breaks across a forward BY
 *     DESIGN -- the moment a dealer auto-forwards their enquiry address to our
 *     inbox, SPF for the original domain fails and means nothing. DKIM would
 *     survive a plain forward, but this node does NOT verify DKIM: it reads
 *     Gmail's already-parsed headers and has no access to the raw signed
 *     message or the sender's public key. Authentication-Results, if present,
 *     is Gmail's opinion recorded as evidence, never used as a gate.
 *   - Therefore the ONLY thing standing between this pipeline and a stranger
 *     injecting a fake customer is the SECRECY OF THE INGEST ADDRESS. That is
 *     a weak gate and it must be written down as one. Anyone who learns the
 *     address can post a lead into a dealership's funnel.
 *
 * Nothing here is inferred. A field that is not literally written in the
 * message is absent from `normalized`. That rule is the point of this file, and
 * every place it would be convenient to break it is marked below.
 */

/* ------------------------------------------------------------------ headers */

/* The Gmail Trigger's output shape is NOT stable across n8n versions. With
   "Simplify" on, headers arrive as a flat object with lowercase keys. With it
   off, they arrive as payload.headers, an ARRAY of { name, value } with the
   original mixed case. A node that handles only one of them works on the box it
   was written on and silently stops finding Message-ID after an upgrade -- and
   "no Message-ID" is a refusal, so the failure is total, not partial. Both
   shapes are handled here and both are covered by the tests. */
function headerIndex(msg) {
  const out = {};
  const put = (name, value) => {
    const k = String(name || '').trim().toLowerCase();
    if (!k) return;
    const v = String(value == null ? '' : value).trim();
    if (out[k] === undefined) out[k] = v; else out[k] += '\n' + v;
  };
  const payload = msg.payload || {};
  if (Array.isArray(payload.headers)) {
    for (const h of payload.headers) if (h && typeof h === 'object') put(h.name, h.value);
  }
  if (Array.isArray(msg.headers)) {
    for (const h of msg.headers) if (h && typeof h === 'object') put(h.name, h.value);
  }
  if (msg.headers && typeof msg.headers === 'object' && !Array.isArray(msg.headers)) {
    for (const k of Object.keys(msg.headers)) put(k, msg.headers[k]);
  }
  if (payload.headers && typeof payload.headers === 'object' && !Array.isArray(payload.headers)) {
    for (const k of Object.keys(payload.headers)) put(k, payload.headers[k]);
  }
  return out;
}

/* --------------------------------------------------------------------- body */

function decodeB64Url(s) {
  try { return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); }
  catch (e) { return ''; }
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    /* A two-cell table row IS a labelled field -- "Name | Khalid Al Marri" is
       how most marketplace notifications are laid out -- so the cell boundary
       becomes a tab and labelMap() treats a tab exactly like a colon. The tab
       must therefore survive the whitespace collapse below, which is why only
       runs of SPACES are collapsed here and tabs are collapsed separately. */
    .replace(/<\/?(td|th)[^>]*>/gi, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/ +/g, ' ')
    .replace(/\t+/g, '\t')
    .replace(/\n{3,}/g, '\n\n');
}

function walkParts(part, acc) {
  if (!part || typeof part !== 'object') return;
  const mime = String(part.mimeType || '').toLowerCase();
  const data = part.body && part.body.data;
  if (data) {
    if (mime === 'text/plain') acc.plain.push(decodeB64Url(data));
    else if (mime === 'text/html') acc.html.push(decodeB64Url(data));
  }
  if (Array.isArray(part.parts)) for (const p of part.parts) walkParts(p, acc);
}

function bodyText(msg) {
  const acc = { plain: [], html: [] };
  walkParts(msg.payload, acc);
  /* The simplified trigger output puts the body on the item directly. */
  for (const k of ['text', 'textPlain', 'body']) {
    if (typeof msg[k] === 'string' && msg[k].trim()) acc.plain.push(msg[k]);
  }
  for (const k of ['html', 'textHtml', 'textAsHtml']) {
    if (typeof msg[k] === 'string' && msg[k].trim()) acc.html.push(msg[k]);
  }
  const plain = acc.plain.join('\n').trim();
  if (plain) return { text: plain, from: 'text/plain' };
  const html = acc.html.join('\n').trim();
  if (html) return { text: stripHtml(html), from: 'text/html' };
  /* The snippet is Gmail's own truncated preview. It is a LAST resort and is
     recorded as such, because a truncated body can cut a phone number in half
     and a half phone number is worse than none. */
  const snip = String(msg.snippet || '').trim();
  return { text: snip, from: snip ? 'snippet_only' : 'none' };
}

/* ------------------------------------------------------------- the addresses */

/* Addresses we will never store as "the customer". A marketplace notification
   is sent BY the marketplace, so the From address is the marketplace's robot,
   and writing it into leads.email gives the dealership a contact that bounces
   or, worse, replies to a no-reply queue nobody reads. */
const ROBOT_LOCALPART = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|notification[s]?|notify|mailer[-_.]?daemon|postmaster|bounce[s]?|auto[-_.]?reply|alerts?|noreply)$/i;

function parseAddress(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  /* "Display Name" <local@domain>   |   local@domain   |   <local@domain> */
  const m = s.match(/^\s*(?:"?([^"<]*?)"?\s*)?<\s*([^>\s]+@[^>\s]+)\s*>\s*$/) ||
            s.match(/^\s*()([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)\s*$/);
  if (!m) return null;
  const display = String(m[1] || '').trim().replace(/^'+|'+$/g, '');
  const address = String(m[2] || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(address)) return null;
  const local = address.split('@')[0];
  return { display, address, local, is_robot: ROBOT_LOCALPART.test(local) };
}

/* ------------------------------------------------------------------- phones */

/* E.164 or nothing. Identical rule, and deliberately identical code, to
   ops/n8n-google-lead-form/verify-and-redact.node.js. A number that does not
   land in +[1-9][0-9]{7,14} is REPORTED as unparseable and dropped from
   `normalized`: a mangled number is a customer the dealer cannot reach wearing
   the shape of one who can, and it is worse than an obviously missing field,
   because nobody goes looking for it. */
function toE164(rawPhone) {
  const s = String(rawPhone || '').replace(/[^\d+]/g, '');
  if (/^\+[1-9][0-9]{7,14}$/.test(s)) return s;
  const dg = s.replace(/\D/g, '');
  if (/^00[1-9]\d{7,14}$/.test(dg)) return '+' + dg.slice(2);
  if (/^971\d{9}$/.test(dg)) return '+' + dg;
  if (/^0?5\d{8}$/.test(dg)) return '+971' + dg.replace(/^0/, '');
  if (/^91[6-9]\d{9}$/.test(dg)) return '+' + dg;
  return null;
}

/* -------------------------------------------------------------- body labels */

/* Labelled fields ONLY. The body is not scanned for a loose run of digits that
   "looks like" a phone number: a marketplace notification is full of stock
   numbers, prices, mileages, VINs and listing ids, and the first one that
   happens to be nine digits long would be handed to a salesperson as a
   customer's mobile. If the message does not say "Phone:", this message does
   not contain a phone number as far as this node is concerned. */
const LABELS = {
  full_name: ['name', 'full name', 'customer name', 'buyer name', 'contact name',
              'sender name', 'lead name', 'from name', 'client name', 'enquirer'],
  email:     ['email', 'e-mail', 'email address', 'customer email', 'buyer email',
              'contact email', 'reply to', 'reply-to'],
  phone:     ['phone', 'phone number', 'mobile', 'mobile number', 'telephone',
              'tel', 'contact number', 'whatsapp', 'cell'],
  vehicle:   ['vehicle', 'vehicle of interest', 'car', 'car model', 'model',
              'listing', 'listing title', 'ad title', 'stock', 'interested in'],
  message:   ['message', 'comments', 'comment', 'enquiry', 'inquiry', 'note',
              'notes', 'question', 'customer message'],
};

function labelMap(text) {
  const found = {};
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    /* "Label: value" and "Label\tvalue" (the shape an HTML table collapses to).
       A label is short by definition; anything long before the colon is prose
       that happens to contain one, e.g. "Note: he said ...". */
    const m = line.match(/^[ \t]*([A-Za-z][A-Za-z \-_/]{1,28}?)[ ]*[:\t]+[ \t]*(.+?)[ \t]*$/);
    if (!m) continue;
    const key = m[1].trim().toLowerCase().replace(/[_\-/]+/g, ' ').replace(/\s+/g, ' ');
    const val = m[2].trim();
    if (!val) continue;
    if (found[key] === undefined) found[key] = val;
  }
  return found;
}

function pickLabel(found, names) {
  for (const n of names) if (found[n]) return found[n];
  return '';
}

/* --------------------------------------------------------------------- main */

const out = [];

/* pairedItem is set on EVERY emitted item, including refusals. This node runs
   in runOnceForAllItems mode because one poll can return several messages, and
   in that mode n8n does not infer item linking for you. Without pairedItem the
   downstream expressions that reach back with $('Parse Lead Email').item throw
   "Can't determine which item to use" -- and they are the expressions that
   carry the Gmail message id to the label and mark-read nodes, so the failure
   is: the lead is ingested, the mail is never marked read, and the next poll
   ingests it again. The database deduplicates it on Message-ID, so nothing is
   corrupted, but the inbox grows forever and every poll does needless work. */
const all = $input.all();

for (let idx = 0; idx < all.length; idx++) {
  const item = all[idx];
  const msg = (item && item.json) || {};
  const H = headerIndex(msg);
  const gmail_message_id = String(msg.id || msg.messageId || '').trim() || null;
  const gmail_thread_id = String(msg.threadId || '').trim() || null;

  const refuse = (code, why, extra) => {
    out.push({ pairedItem: { item: idx }, json: Object.assign({
      verdict: 'REFUSED',
      reason_code: code,
      why,
      wrote_nothing: true,
      gmail_message_id,
      gmail_thread_id,
      subject: String(H.subject || '').slice(0, 300) || null,
    }, extra || {}) });
  };

  /* ---- idempotency, and why nothing else will do -------------------------
     The RFC 5322 Message-ID is the ONLY stable identifier of this message as a
     message. Gmail's own `id` is stable per mailbox, but the poll is the thing
     that repeats: a re-poll, a workflow re-run, a restored backup or a manual
     "execute" replays the same customer, and without a key that is a property
     of the MESSAGE we cannot tell a replay from a second person asking about a
     second car.

     A hash of the body is explicitly NOT a substitute, and the temptation to
     use one is the defect this comment exists to prevent. Two different
     customers on the same marketplace listing can produce byte-identical
     notifications -- same template, same vehicle, same "A buyer is interested"
     text -- and hashing them collapses two real people into one lead. The
     failure is silent and the second customer is simply never called.

     So: no Message-ID, no ingestion. The message stays unread in the inbox and
     a human can look at it. That is a loud, recoverable failure; a wrong
     dedup key is a quiet, unrecoverable one. */
  const rawMessageId = String(H['message-id'] || '').trim();
  const messageId = rawMessageId.replace(/^</, '').replace(/>$/, '').trim();
  if (!messageId) {
    refuse('NO_RFC_MESSAGE_ID',
      'This message carries no Message-ID header, so a re-poll of it could not be ' +
      'told apart from a second customer. It is left unread for a human. A hash of ' +
      'the body is not an acceptable substitute: two customers enquiring about the ' +
      'same listing produce identical bytes.');
    continue;
  }

  const body = bodyText(msg);
  const labels = labelMap(body.text);

  const fromAddr = parseAddress(H.from);
  const replyToAddr = parseAddress(H['reply-to']);

  /* ---- the customer's name ----------------------------------------------
     Three sources are considered and one is BANNED.

     BANNED: the email local-part. "khalid.almarri@example.com" is not evidence
     that anyone is called Khalid Al Marri -- it is a string a mail admin chose.
     Splitting it on a dot and title-casing it produces a name that looks real,
     is never flagged, and is read aloud on a phone call to a stranger. Also
     banned for the same reason: the marketplace's own display name. "Dubizzle
     Notifications" is the robot, not the buyer, and a lead row reading
     full_name = 'Dubizzle Notifications' is a fabricated person. */
  let full_name = pickLabel(labels, LABELS.full_name);
  let full_name_source = full_name ? 'body_label' : null;

  if (!full_name && fromAddr && !fromAddr.is_robot && fromAddr.display) {
    const d = fromAddr.display;
    const flat = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    const looksLikeAddress = /@/.test(d);
    const isJustTheLocalPart = flat(d) === flat(fromAddr.local);
    if (!looksLikeAddress && !isJustTheLocalPart && /[A-Za-z]{2}/.test(d)) {
      /* A display name the sender themselves set on a message they themselves
         sent. That is a claim literally present in the message, so it is
         allowed -- and recorded as the weaker source it is. */
      full_name = d;
      full_name_source = 'from_display_name';
    }
  }
  full_name = String(full_name || '').replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 120);

  /* ---- the customer's email ---------------------------------------------- */
  let email = '';
  let email_source = null;
  const labelledEmail = parseAddress(pickLabel(labels, LABELS.email));
  if (labelledEmail && !labelledEmail.is_robot) {
    email = labelledEmail.address; email_source = 'body_label';
  } else if (replyToAddr && !replyToAddr.is_robot) {
    email = replyToAddr.address; email_source = 'reply_to_header';
  } else if (fromAddr && !fromAddr.is_robot) {
    email = fromAddr.address; email_source = 'from_header';
  }

  /* Recorded so the dealership can see WHY no email was stored, rather than
     wondering whether the parser lost one. */
  const discarded_robot_addresses = [];
  if (labelledEmail && labelledEmail.is_robot) discarded_robot_addresses.push(labelledEmail.address);
  if (replyToAddr && replyToAddr.is_robot) discarded_robot_addresses.push(replyToAddr.address);
  if (fromAddr && fromAddr.is_robot) discarded_robot_addresses.push(fromAddr.address);

  /* ---- the customer's phone ---------------------------------------------- */
  const phoneRaw = pickLabel(labels, LABELS.phone);
  const phone_e164 = toE164(phoneRaw);

  const vehicle = pickLabel(labels, LABELS.vehicle).slice(0, 200);
  const message = pickLabel(labels, LABELS.message).slice(0, 1500);

  /* ---- normalized: only what was literally there -------------------------- */
  const normalized = {};
  if (full_name) normalized.full_name = full_name;
  if (phone_e164) normalized.phone_e164 = phone_e164;
  if (email) normalized.email = email;
  if (vehicle) normalized.vehicle_of_interest = vehicle;
  if (message) normalized.message = message;

  /* The same contract nexus_lead_normalized_defect enforces, checked here so
     the refusal names the missing field instead of arriving as an opaque 500
     from a database function nobody outside this repo can read. */
  let defect = null;
  if (!full_name) defect = 'NORMALIZED_FULL_NAME_REQUIRED';
  else if (!phone_e164 && !email) defect = 'NORMALIZED_NEEDS_EMAIL_OR_PHONE';

  /* ---- occurred_at ------------------------------------------------------- */
  let occurred_at = null;
  const dateHeader = String(H.date || '').trim();
  if (dateHeader) {
    const t = Date.parse(dateHeader);
    if (!isNaN(t)) occurred_at = new Date(t).toISOString();
  }
  if (!occurred_at && msg.internalDate) {
    const t = Number(msg.internalDate);
    if (!isNaN(t) && t > 0) occurred_at = new Date(t).toISOString();
  }

  const payload_raw = {
    provider: 'email',
    transport: 'gmail_poll',
    rfc_message_id: messageId,
    gmail_message_id,
    gmail_thread_id,
    from: fromAddr ? fromAddr.address : null,
    from_display: fromAddr ? (fromAddr.display || null) : null,
    reply_to: replyToAddr ? replyToAddr.address : null,
    to: String(H.to || '').slice(0, 320) || null,
    delivered_to: String(H['delivered-to'] || '').slice(0, 320) || null,
    subject: String(H.subject || '').slice(0, 300) || null,
    date_header: dateHeader || null,
    body_source: body.from,
    body_excerpt: body.text.slice(0, 4000),
    label_keys_seen: Object.keys(labels).slice(0, 40),
    full_name_source,
    email_source,
    phone_unparseable: phone_e164 ? null : (phoneRaw || null),
    discarded_robot_addresses,
    /* Gmail's opinion, recorded as evidence and used as a gate by nothing. */
    authentication_results: String(H['authentication-results'] || '').slice(0, 500) || null,
    received_spf: String(H['received-spf'] || '').slice(0, 300) || null,
    origin_note:
      'origin_verified=mailbox_read_oauth attests that these bytes were read from ' +
      'a mailbox we hold an OAuth token for. It does NOT attest the sender. SPF ' +
      'does not survive a forward, DKIM is not verified in this node, and the ' +
      'secrecy of the ingest address is the only gate on who can put a lead here.',
  };

  out.push({ pairedItem: { item: idx }, json: {
    verdict: 'PARSED',
    reason_code: defect === null ? 'EMAIL_PARSED' : defect,
    external_event_id: messageId,
    origin_verified: 'mailbox_read_oauth',
    occurred_at,
    gmail_message_id,
    gmail_thread_id,
    subject: payload_raw.subject,
    payload_raw,
    normalized,
    normalized_defect: defect,
    can_promote: defect === null,
  } });
}

return out;
