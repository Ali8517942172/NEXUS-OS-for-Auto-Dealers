/* NEXUS OS — screens/compliance.js
   The KYC / AML register. This is the screen an auditor or a buyer's lawyer is
   pointed at, so it holds itself to a stricter standard than the rest of the
   product: every field the auditor extracted is shown, and the retention story
   is stated explicitly rather than implied by an empty cell.

   `kyc_documents` held nine rows filed by one customer after the 24 Aug 2026
   cleanup and holds NONE as of 31 Aug 2026 (counted against the live table, not
   inferred). Both shapes are still shapes this screen has to be right about, and
   neither is assumed anywhere below — every claim about how many people are in
   the register is computed from the rows that actually loaded.

   1. ONE PERSON IS A BIOGRAPHY, NOT A POPULATION. When the register does hold
      one contact's attempts, three approvals against four rejections is that
      man's history and not an approval rate, so this file computes no rate,
      share, average or trend over it anywhere. A percentage drawn across nine
      rows filed by one person would read as a fact about the dealership's
      compliance and it is not one — there is nobody there to compare him with.
      Where a proportion is drawn at all (the retention bar) the caption says how
      few rows it rests on and that the shapes are not shares.

   2. THE ARCHIVE GAP IS THE VIEW'S NUMBER, NOT THIS SCREEN'S. Retention cannot
      be proven for a document whose file was never stored, and the database
      files exactly that hole as `v_needs_attention.kyc_archive_gap`. This screen
      used to count it a second time locally, over `storage_path IS NULL AND
      purged_at IS NULL`, and asserted in four places that its number and the
      view's could not disagree. They did: the view also requires `void_reason IS
      NULL` and `created_at > 2026-08-17 16:01:48+00`, so every row audited
      before archiving shipped sat in this screen's count and not in the view's —
      and the archive banner printed the size of that discrepancy one line below
      the claim that there could not be one, on the screen an auditor is handed.
      The local count is gone. The view is read directly, its `ref` (the
      kyc_documents id) decides membership row by row, and when that read fails
      the gap is reported as unknown rather than reconstructed here. One fact,
      one source, and no second opinion to drift from it.

   3. THE VOID PARTITION IS EMPTY, AND THE BRANCH STAYS. Nine rows that were
      never submissions — greeting cards, a religious banner, a Sikh prayer text
      — were deleted, and the gate that auto-routed every uncaptioned WhatsApp
      image to the auditor is fixed. Every `void_reason` path below is kept and
      still correct, because the partition can refill: the register is computed
      over `live` and never over the raw read. What must not happen is a heading
      with nothing under it, so when nothing is voided the section is not
      rendered at all rather than rendered as an empty box.

   Identity is resolved through `whatsapp_contacts` and confirmed against
   `leads`, never taken from whatever string the workflow wrote on the row, and a
   chat id is never printed where a name goes. One person also reaches this
   screen under two different keys — `communication_logs.lead_email` holds an
   email when the lead is known and a WhatsApp handle when it is not — so keys
   are joined through the contact directory before anything is matched, exactly
   as the rebuilt `v_conversations` now joins them.

   Retention has several distinct meanings and they must never be conflated. The
   full vocabulary, and where every word in it came from, is the RETENTION table
   below; it is the only place on this screen that decides what a row's archive,
   retention or purge state is, and the pill, the filter, the stacked bar, the
   drawer and the Open-file button all read that one verdict.
   Nothing on this screen is estimated and no row is fabricated: if a table
   cannot be read, the panel that depends on it says so. */
import { db, signedUrl } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { ago, clock, esc, n0, num, pill, tone } from '../lib/format.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, table, wireRows } from '../lib/ui.js';

/* The moment the archive step went live, matching `v_needs_attention` and the
   KYC workflow's own archive-gap monitor, both of which carry this same instant.
   It is used here for exactly one purpose: to EXPLAIN why the view did not file
   a fileless row as a gap. It is never a predicate on any count — the view
   decides what is in the gap and this screen does not second-guess it. If a
   fileless row is absent from the view and this timestamp does not explain the
   absence, the row says so rather than being folded into either side. */
const ARCHIVE_EPOCH = '2026-08-17T16:01:48Z';
const ARCHIVE_EPOCH_MS = Date.parse(ARCHIVE_EPOCH);
const ARCHIVE_EPOCH_LABEL = '17 Aug 2026 16:01 UTC';

/* The register is read newest-first with a hard cap. An auditor is entitled to
   know when they are looking at a window rather than the whole book, so when the
   read comes back exactly full the screen says so, rather than letting a capped
   page imply the dealership has only ever audited this many documents. */
const ROW_LIMIT = 500;

/* Every write path this screen would need is service-role only. Stating the
   exact missing piece on the disabled control is the difference between "this
   product is broken" and "this step is not built yet". */
const NO_DECISION_HOOK =
  'No KYC decision endpoint exists yet. kyc_documents is service-role only, and the audit-kyc webhook audits a document — it does not accept a human verdict — so the browser cannot record an approval or a rejection.';
const NO_REASK_HOOK =
  'No re-request endpoint exists yet. Asking the customer for another upload needs a KYC re-request webhook, and none is deployed.';
/* Said on every row with no file, so it says the whole thing rather than
   "nothing to open": what is missing and why no button here can fix it. Whether
   the database files this particular row as an archive gap is NOT stated here —
   that is the view's verdict, it is carried on the row's retention state, and
   this constant would be a second, unchecked assertion of the same fact. */
const NO_FILE_LINK =
  'This record has no storage_path and no purged_at, so nothing was deleted on schedule — the file was simply never archived, and there is nothing to open. Re-running the archive step needs a service-role job and no webhook exists for it, so the browser cannot repair it either.';
const PURGED_FILE =
  'This file was deleted on schedule under the retention policy. There is nothing left to open.';
/* Signing is deliberately short-lived: long enough to click through, short
   enough that the URL is dead by the time anyone forwards it. The number is in
   the button's title so a reviewer knows the link they just opened is perishable
   before they try to share it. */
const SIGNED_URL_TTL = 60;
const CAN_OPEN_FILE =
  `Opens the archived document through a ${SIGNED_URL_TTL}-second signed URL. The bucket stays private — the link expires and cannot be reused.`;

/* Date-only columns (date_of_birth, expiry_date, retain_until) are rendered
   verbatim. Parsing "2026-08-17" into a Date and formatting it locally shifts
   it a day either side of UTC midnight, and a passport expiry that moves by a
   day depending on who is looking at it is worse than an unformatted one.

   "Today", though, has to be the showroom's today. Every n8n workflow runs on
   Asia/Dubai and lib/format.js pins every absolute date on this product to it;
   a UTC today is Dubai minus four hours, so between 00:00 and 04:00 GST this
   comparison used yesterday's date and a retain_until that lapsed that morning
   did not read as due. en-CA is named only because it is the locale that formats
   as YYYY-MM-DD, which is the shape these DATE columns already hold. */
const DUBAI_DAY = new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' });
const todayISO = () => DUBAI_DAY.format(new Date());
const isPastDate = v => {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && s < todayISO();
};

/* Two different facts hide behind one expired date and a reviewer cares about
   only one of them. An identity document that had already expired on the day it
   was audited was accepted expired — a control failure, and the first thing a
   money-laundering review looks for. One that has merely lapsed since is
   ordinary aging and is stated without alarm. Both dates come straight off the
   row; neither is inferred. */
const expiredAtAudit = d => {
  const exp = String(d.expiry_date || '').slice(0, 10);
  const aud = String(d.created_at || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(exp) && /^\d{4}-\d{2}-\d{2}$/.test(aud) && exp < aud;
};

/* Matching keys are compared exactly, lower-cased and trimmed — never by name,
   which two customers can share. Note that communication_logs.lead_email holds
   the chat id for a WhatsApp-only contact, which is what makes it possible to
   show a voided contact the message they were actually sent. */
const key = v => String(v == null ? '' : v).trim().toLowerCase();

/* A row is a compliance decision only if the backend did not void it. This is
   the single predicate the whole screen partitions on. */
const isVoid = d => !!(d && d.void_reason);

const plural = (n, one, many) => (Number(n) === 1 ? one : many);

/* The archive gap, defined exactly as `v_needs_attention.kyc_archive_gap` and
   the Overview panel define it: audited, no file in Storage, and not purged
   either. Deliberately not `retentionOf(d).key === 'failed'`, which would drop
   the pre-archive rows and leave this screen reporting fewer unprovable
   documents than the view does about the same table. */
const neverArchived = d => !d.purged_at && !d.storage_path;

/* ── The retention verdict for one row ───────────────────────────────────── */
const RETENTION = {
  archived: { label: 'Archived',        tone: 'ok',   icon: 'inventory_2' },
  purged:   { label: 'Purged',          tone: '',     icon: 'delete_sweep' },
  failed:   { label: 'Archive failure', tone: 'hot',  icon: 'folder_off' },
  legacy:   { label: 'Pre-archive',     tone: '',     icon: 'history' },
  unknown:  { label: 'Undated',         tone: 'warm', icon: 'help' },
};

function retentionOf(d) {
  if (d.purged_at) return { key: 'purged', detail: `File deleted on schedule ${ago(d.purged_at)}.` };
  if (d.storage_path) return { key: 'archived', detail: 'File is stored in the private kyc-documents bucket.' };
  const t = Date.parse(d.created_at);
  if (!Number.isFinite(t)) {
    return { key: 'unknown', detail: 'This row has no readable created_at timestamp, so it cannot be placed either side of the archive cut-over. It is deliberately not counted as a failure.' };
  }
  if (t < ARCHIVE_EPOCH_MS) {
    return { key: 'legacy', detail: `Audited before archiving shipped (${ARCHIVE_EPOCH_LABEL}), so no file was ever stored for it. That is explained history rather than a step that failed — but the document is still unprovable, so it is counted in the archive gap alongside the failures.` };
  }
  return { key: 'failed', detail: 'The document was audited but never written to storage, and it was not purged either. The evidence behind this verdict no longer exists.' };
}

const retentionPill = r => {
  const m = RETENTION[r.key];
  return pill(m.label, m.tone || undefined);
};

/* The other half of the retention story: a stored file whose retain_until has
   passed means the purge schedule did not run. Purged rows are excluded —
   those are the ones that worked. */
const overdueRetention = d => !d.purged_at && !!d.storage_path && isPastDate(d.retain_until);

/* The handful of row-level facts the register is actually read for. Each is a
   plain statement about one row — no score, no weighting, nothing the database
   did not say — and each is filterable so a banner can hand the reviewer the
   exact set it just counted instead of a number and a hunt. */
const finalAttempt = d => {
  const a = n0(d.attempt_number), m = n0(d.max_attempts);
  return a != null && m != null && a >= m;
};
const FLAGS = {
  /* First, because it is the finding this register is currently about, and
     because it is the set every archive-gap banner hands the reviewer. Its count
     and the banner's count come from the same predicate, so they cannot drift. */
  gap:       { label: 'No archived file',      match: neverArchived },
  expired:   { label: 'Expired when audited',  match: expiredAtAudit },
  tampering: { label: 'Tampering detected',    match: d => !!d.tampering },
  invalid:   { label: 'Marked not valid',      match: d => d.is_valid === false },
  final:     { label: 'Final attempt reached', match: finalAttempt },
  overdue:   { label: 'Purge overdue',         match: overdueRetention },
};
const FLAG_KEYS = Object.keys(FLAGS);

/* ── Who a row is actually about ─────────────────────────────────────────────
   kyc_documents.lead_name is whatever the workflow had to hand when it wrote the
   row, and for the auto-routed images that was the sender's WhatsApp profile
   name. Printing it in a Customer column is how "Abdul" and "~S" came to look
   like customers of this dealership. The resolution below is deliberately
   pessimistic: a row is only called a lead when an email on the record (or on
   the WhatsApp contact) matches an actual row in `leads`. Everything weaker is
   named as the weaker thing it is. */
const IDENTITY = {
  lead:             { label: 'Lead on file',       chip: '' },
  email_only:       { label: 'No lead row',        chip: 'No lead row' },
  whatsapp_profile: { label: 'WhatsApp profile',   chip: 'WhatsApp profile name' },
  phone_only:       { label: 'Phone only',         chip: 'Phone only' },
  unidentified:     { label: 'Unidentified',       chip: 'Unidentified' },
};
/* When the leads table itself could not be read, "no lead row" would be a claim
   the database never made. The label says unconfirmed instead. */
const UNCONFIRMED = { label: 'Lead unconfirmed', chip: 'Lead unconfirmed' };

function makeResolver({ contacts, contactsErr, leads, leadsErr }) {
  const byChat = new Map();
  (contacts || []).forEach(c => { const k = key(c.chat_id); if (k) byChat.set(k, c); });
  const byEmail = new Map();
  (leads || []).forEach(l => { const k = key(l.email); if (k) byEmail.set(k, l); });

  return function who(d) {
    const chatId = String(d.chat_id || '').trim();
    const contact = chatId ? byChat.get(key(chatId)) || null : null;
    const email = String(d.lead_email || (contact && contact.lead_email) || '').trim();
    const lead = email && !leadsErr ? byEmail.get(key(email)) || null : null;
    const push = String((contact && contact.push_name) || '').trim();
    /* Two different phone numbers can exist for one person and they are not
       interchangeable: `leads.phone` is the number the dealership captured on
       the enquiry, `whatsapp_contacts.phone` is the number WAHA resolved from
       the chat. The lead record wins because that is the number a rep dials,
       and which one is on screen is stated — a number with no provenance is a
       number nobody acts on. `users.phone` does not exist, so no staff number
       is available anywhere on this screen; that is said where staff appear. */
    const leadPhone = String((lead && lead.phone) || '').trim();
    const contactPhone = String((contact && contact.phone) || '').trim();
    const phone = leadPhone || contactPhone;
    const phoneFrom = leadPhone ? 'from the lead record'
      : contactPhone ? 'from the WhatsApp contact' : '';
    const rowName = String(d.lead_name || d.full_name || '').trim();

    let kind, name;
    if (email && lead) { kind = 'lead'; name = String(lead.name || '').trim() || rowName || email; }
    else if (email) { kind = 'email_only'; name = rowName || email; }
    else if (push || rowName) { kind = 'whatsapp_profile'; name = push || rowName; }
    else if (phone) { kind = 'phone_only'; name = phone; }
    else { kind = 'unidentified'; name = ''; }

    /* One plain-text line, assembled from facts only. It says what we have and,
       just as importantly, what we do not: a historic contact genuinely has no
       phone stored, and inventing one would be worse than the gap. */
    const bits = [];
    if (kind === 'lead') bits.push(`${email} · matched to a lead record`);
    else if (kind === 'email_only') {
      bits.push(email);
      bits.push(leadsErr ? 'the leads table could not be read, so this email is unconfirmed' : 'no matching row in leads');
    } else {
      bits.push(push
        ? 'WhatsApp profile name — not a customer record'
        : name
          ? 'name taken from the KYC row, which for these is the sender’s WhatsApp profile name — not a customer record'
          : 'no name captured for this contact');
      bits.push('no lead behind this row');
    }
    if (chatId) bits.push(chatId);
    else bits.push('no chat id on the row');
    if (contactsErr && !contact) bits.push('WhatsApp contact directory could not be read');

    const marks = kind === 'email_only' && leadsErr ? UNCONFIRMED : IDENTITY[kind];
    return { kind, name, email, phone, phoneFrom, chatId, contact, lead,
             contactMissing: !!chatId && !contact,
             label: marks.label, chip: marks.chip, line: bits.join(' · ') };
  };
}

const whoLabel = w => w.name || w.chatId || 'Unidentified contact';

/* The phone sits beside the name, not buried in the detail line: it is the one
   field on this row somebody might act on, and a reviewer who has found a
   problem needs to be able to ring the person about it. When there is no number
   the cell says so — a blank there reads as "not looked up" rather than "never
   captured", and the two call for different work. */
function whoCell(w) {
  const dup = w.phone && w.phone === w.name;
  return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      ${w.name ? esc(w.name) : '<span class="t-muted">No name on record</span>'}
      ${w.phone && !dup ? `<span class="mono">${esc(w.phone)}</span>` : ''}
      ${w.chip ? `<span class="chip">${esc(w.chip)}</span>` : ''}
    </div>
    <div class="cell-sub ${w.kind === 'lead' ? '' : 't-warm'}" style="white-space:normal">${
      w.phone ? esc(w.phoneFrom) : 'no phone stored for this contact'} · ${esc(w.line)}</div>`;
}

SCREENS.compliance = async host => {
  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const banners = el('div'); banners.style.marginTop = '16px'; host.appendChild(banners);
  const body = el('div'); body.style.marginTop = '16px'; host.appendChild(body);
  body.innerHTML = `<div class="card">${stateLoading(6)}</div>`;

  /* allSettled, not catch(() => []): a table that failed to load and a table
     with no rows look identical once the error is swallowed, and on this screen
     "there are no rejected documents" and "we could not read the register" are
     opposite answers. */
  const [docsR, contactsR, leadsR, auditR, commsR] = await Promise.allSettled([
    db(`kyc_documents?select=*&order=created_at.desc&limit=${ROW_LIMIT}`),
    /* The WhatsApp contact directory is what turns an opaque @lid handle into
       the profile name and phone number WAHA actually captured. */
    db('whatsapp_contacts?select=chat_id,phone,push_name,lead_email&limit=2000'),
    /* Read to answer two questions per row: is there a lead behind this at all,
       and what number would a reviewer ring. `leads.phone` exists; `users.phone`
       does not, which is why no staff number appears anywhere on this screen. */
    db('leads?select=name,email,phone&limit=2000'),
    /* ilike rather than one exact workflow name, so a renamed or versioned KYC
       workflow keeps appearing here instead of silently dropping out. */
    db('audit_log?select=*&workflow=ilike.*KYC*&order=logged_at.desc&limit=200'),
    db('communication_logs?select=lead_email,message,created_at&order=created_at.desc&limit=500'),
  ]);

  const val = r => r.status === 'fulfilled' ? r.value : null;
  const err = r => r.status === 'rejected' ? (r.reason?.message || 'Unknown error') : null;

  const docs = val(docsR);      const docsErr = err(docsR);
  const contacts = val(contactsR); const contactsErr = err(contactsR);
  const leads = val(leadsR);    const leadsErr = err(leadsR);
  const audit = val(auditR);    const auditErr = err(auditR);
  const comms = val(commsR);    const commsErr = err(commsR);

  body.innerHTML = '';

  /* One person reaches this screen under two different keys and they have to be
     treated as one. `communication_logs.lead_email` holds an email when the lead
     is known and a WhatsApp handle when it is not, and `kyc_documents` carries
     both columns with either one possibly null. `whatsapp_contacts` is the
     bridge — chat_id on one side, lead_email on the other — so every key that
     belongs to the same contact is joined here before anything is matched
     against anything else. Without it a document filed under an email and a
     message logged under that same customer's @lid look like two different
     people, which is precisely the split the rebuilt `v_conversations` was
     written to end, and it would produce a false "approvals messaged to a
     contact with no row in this register" line on the KPI strip. */
  const ALIAS = new Map();
  const link = (a, b) => {
    if (!a || !b || a === b) return;
    const merged = new Set([...(ALIAS.get(a) || [a]), ...(ALIAS.get(b) || [b])]);
    merged.forEach(k => ALIAS.set(k, merged));
  };
  (contacts || []).forEach(c => link(key(c.chat_id), key(c.lead_email)));
  (docs || []).forEach(d => link(key(d.chat_id), key(d.lead_email)));
  /* Every key that identifies the same contact as `raw`, `raw` included. */
  const alike = raw => {
    const k = key(raw);
    if (!k) return [];
    const set = ALIAS.get(k);
    return set ? [...set] : [k];
  };
  const keysOf = d => [...new Set([...alike(d.chat_id), ...alike(d.lead_email)])];
  /* One stable id per contact, so rows can be grouped without picking a column
     that happens to be null on half of them. */
  const canonKey = d => { const ks = keysOf(d).slice().sort(); return ks.length ? ks[0] : ''; };

  const who = makeResolver({ contacts, contactsErr, leads, leadsErr });
  /* Resolved once per row so the register, the banners, the voided section and
     the drawer cannot disagree about who somebody is. */
  const WHO = new Map();
  (docs || []).forEach(d => WHO.set(d, who(d)));
  const whoOf = d => WHO.get(d) || who(d);

  /* THE partition. `live` is the compliance register; `voided` is the incident.
     Nothing below may count the two together. */
  const live = (docs || []).filter(d => !isVoid(d));
  const voided = (docs || []).filter(isVoid);

  /* Keys that belong only to voided rows. A customer-facing message addressed to
     one of these went to somebody who never submitted anything, so it must not
     be counted as an approval or a rejection either. A key that also appears on
     a live row is deliberately left out of this set — that contact is a real
     submitter and their messages are real. */
  const liveKeys = new Set();
  live.forEach(d => { keysOf(d).forEach(k => liveKeys.add(k)); });
  const voidKeys = new Set();
  voided.forEach(d => { keysOf(d).forEach(k => { if (!liveKeys.has(k)) voidKeys.add(k); }); });

  /* How many distinct people the live register is actually about, and whether it
     is exactly one. This is the number that decides whether any proportion on
     this screen means anything: a bar drawn across nine rows filed by one man is
     a shape, not a share, and a verdict split across them is a history, not a
     rate. A row that carries neither a chat id nor an email cannot be attributed
     to anybody, so its presence disqualifies the single-trail claim rather than
     being quietly folded into it. */
  const liveContacts = new Set(live.map(canonKey).filter(Boolean));
  const liveUnkeyed = live.filter(d => !canonKey(d)).length;
  const oneTrail = live.length > 0 && liveContacts.size === 1 && liveUnkeyed === 0;

  const kycComms = (comms || []).filter(c => String(c.message || '').startsWith('[KYC-'));
  const kycCommsVoid = kycComms.filter(c => voidKeys.has(key(c.lead_email)));
  /* Every contact key that has a row in the register at all, voided or not.
     A [KYC-APPROVED] message to one of these is NOT "an approval that survives
     only in the message log" — that contact has rows, and communication_logs
     carries no document id, so which row the message belongs to is unknowable.
     The earlier version of this counted every message that was not addressed to
     a void-only chat, which meant a contact who sent both a real document and a
     greeting card had the greeting card's message counted as an extra approval
     under the Approved tile. Restricting the count to keys with no row at all
     is the only version of the claim the data supports. */
  const docKeys = new Set();
  (docs || []).forEach(d => { keysOf(d).forEach(k => docKeys.add(k)); });
  const kycCommsUnlinked = kycComms.filter(c => !docKeys.has(key(c.lead_email)));
  /* Voided rows are identified from the register. If the register could not be
     read there is no void list, so anything below that filters on one has to
     say it could not. Silently reporting an unfiltered count as a filtered one
     is the precise failure this screen exists to prevent. */
  const voidFilterKnown = !!docs;
  /* audit_log carries no void marker, so voided routings are excluded the only
     honest way available: by the contact key they were logged against. */
  const escalations = (audit || []).filter(a =>
    a.status === 'ESCALATED' && !voidKeys.has(key(a.lead_email)));

  const commKind = m => String(m || '').startsWith('[KYC-APPROVED]') ? 'APPROVED'
    : String(m || '').startsWith('[KYC-REJECT]') ? 'REJECTED' : 'KYC MESSAGE';

  /* Messages actually delivered to the chat behind a row. Returns null — not an
     empty list — when the message log could not be read, because "we sent them
     nothing" and "we cannot tell" are different answers and the second one must
     never be printed as the first. */
  const commsFor = d => {
    if (!comms) return null;
    const ks = keysOf(d);
    if (!ks.length) return [];
    return kycComms.filter(c => ks.includes(key(c.lead_email)));
  };

  /* One display name and one phone number per contact key, resolved from
     whatsapp_contacts and leads rather than from whatever string the workflow
     logged into the row. Defined here, above the banners, because the alert
     strip has to be able to name the person an escalation is about — a banner
     that says "1 case needs a human" without saying who is not actionable. */
  const contactByKey = new Map();
  (contacts || []).forEach(c => { const k = key(c.chat_id); if (k) contactByKey.set(k, c); });
  const leadByEmail = new Map();
  (leads || []).forEach(l => { const k = key(l.email); if (k) leadByEmail.set(k, l); });
  const nameFor = raw => {
    const k = key(raw);
    if (!k) return { name: null, phone: '', note: 'no contact key on this log row' };
    const lead = leadByEmail.get(k);
    const c = contactByKey.get(k);
    /* leads.phone first, then the number WAHA resolved for the chat. Neither is
       invented and neither is derived from the chat id, which for a @lid handle
       contains no phone digits at all. */
    const phone = String((lead && lead.phone) || (c && c.phone) || '').trim();
    if (lead) return { name: String(lead.name || '').trim() || String(raw), phone, note: 'lead on file' };
    if (c && String(c.push_name || '').trim()) {
      return { name: String(c.push_name).trim(), phone, note: 'WhatsApp profile name · no lead record' };
    }
    if (phone) return { name: phone, phone, note: 'phone only · no lead record' };
    /* Falls through to the raw key, which for a WhatsApp-only contact is a chat
       id. It is rendered as an id in mono, never as a name. */
    return { name: null, phone: '', note: String(raw) };
  };

  /* ── KPI strip ─────────────────────────────────────────────────────────── */
  if (!docs) {
    /* A full-width failure notice, not one squeezed into the first of five
       columns where it reads as a broken tile rather than a message. */
    strip.classList.remove('grid', 'g5');
    strip.innerHTML = stateError('the KYC register', docsErr);
  } else {
    const verdict = v => live.filter(d => String(d.verdict || '').toUpperCase() === v).length;
    /* Counted the way the view counts it — no file and no purge — so this tile
       and the Overview panel can never report the same rows as two numbers. */
    const gaps = live.filter(neverArchived).length;
    const legacyApproved = kycCommsUnlinked.filter(c => c.message.startsWith('[KYC-APPROVED]')).length;
    const legacyRejected = kycCommsUnlinked.filter(c => c.message.startsWith('[KYC-REJECT]')).length;
    const noVerdict = live.filter(d => !d.verdict).length;

    strip.innerHTML = [
      kpi('Genuine submissions', num(live.length),
        voided.length
          ? `<span class="t-warm">${num(voided.length)} further row${voided.length === 1 ? ' was' : 's were'} voided and ${voided.length === 1 ? 'is' : 'are'} excluded from every figure here</span>`
          : (live.length
              ? (oneTrail
                  /* The single most load-bearing sentence on this strip. Without
                     it "9" reads as nine customers, and every tile beside it
                     reads as a picture of the dealership's compliance rather
                     than of one man's repeated attempts to send an ID. */
                  ? `<span class="t-warm">All ${num(live.length)} filed by one customer — this is a single document trail, not a book of them${
                      noVerdict ? `, and ${num(noVerdict)} of them carr${noVerdict === 1 ? 'ies' : 'y'} no verdict yet` : ''}</span>`
                  : noVerdict
                    ? `<span class="t-warm">${num(noVerdict)} carr${noVerdict === 1 ? 'ies' : 'y'} no verdict yet</span>`
                    : '<span class="t-muted">Every row carries an auditor verdict</span>')
              : 'The audit-kyc workflow has not written a record yet')),
      /* Counts, never a share of the tile beside them. With one customer on
         file an "approval rate" would be a statistic about a single person's
         paperwork dressed up as a statistic about the business, so no tile here
         divides by any other and the subtitle says why. */
      kpi('Approved', num(verdict('APPROVED')),
        legacyApproved
          ? `<span class="t-muted">${num(legacyApproved)} older approval${legacyApproved === 1 ? ' was messaged to a contact' : 's were messaged to contacts'} with no row in this register at all</span>`
          : (oneTrail ? `<span class="t-muted">Attempts by one customer — counted, not rated</span>` : '')),
      kpi('Rejected', num(verdict('REJECTED')),
        legacyRejected
          ? `<span class="t-muted">${num(legacyRejected)} older rejection${legacyRejected === 1 ? ' was messaged to a contact' : 's were messaged to contacts'} with no row in this register at all</span>`
          : (oneTrail ? `<span class="t-muted">Re-uploads from the same person, not ${num(verdict('REJECTED'))} rejected customers</span>` : '')),
      kpi('Escalated to a human', num(verdict('ESCALATED')),
        escalations.length
          ? `<span class="t-warm">${num(escalations.length)} escalation${escalations.length === 1 ? '' : 's'} logged by the auditor workflow</span>`
          : (auditErr ? '<span class="t-muted">Audit log could not be read</span>' : '')),
      kpi('No archived file', num(gaps),
        gaps
          ? `<span class="t-hot">${num(gaps)} of ${num(live.length)} audited and never stored — retention cannot be proven for ${plural(gaps, 'it', 'them')}</span>`
          : (live.length
              ? '<span class="t-ok">Every genuine document is either archived or purged on schedule</span>'
              : '<span class="t-muted">Nothing genuine to archive yet</span>'),
        gaps ? 't-hot' : ''),
    ].join('');
  }

  /* ── Banners ───────────────────────────────────────────────────────────── */
  /* Every banner states a count and then hands the reviewer that exact set.
     A banner that reports "3 documents have no archived file" and then leaves
     you to reconstruct the filter by hand is a dead end, and the two can drift
     apart. They all drive one setter, which moves the controls and the rows
     together, so the filter row can never disagree with the list under it. */
  let focusRegister = () => {};
  let focusVoided = () => {};
  let focusTrail = () => {};

  /* The incident banner leads, because a reviewer who reads the register without
     knowing about it will draw the wrong conclusion from every other number. */
  if (voided.length) {
    const chats = new Set(voided.map(v => key(v.chat_id)).filter(Boolean)).size;
    const b = el('div', 'banner hot');
    b.style.marginBottom = '12px';
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">report</span>
      <div style="flex:1">
        <strong>${num(voided.length)} row${voided.length === 1 ? '' : 's'} in kyc_documents ${voided.length === 1 ? 'was' : 'were'} never a KYC submission.</strong>
        Uncaptioned WhatsApp images were auto-routed to the auditor, so the table holds machine verdicts on pictures nobody asked for${
          chats ? `, from ${num(chats)} chat${chats === 1 ? '' : 's'}` : ''}.
        They carry <span class="mono">void_reason</span> and are excluded from every count, rate, verdict and retention figure on this screen.
        ${comms
          ? (kycCommsVoid.length
              ? `<span class="t-hot">${num(kycCommsVoid.length)} KYC message${kycCommsVoid.length === 1 ? ' was' : 's were'} delivered to those chats.</span>`
              : 'No KYC message to those chats appears in the message log read here.')
          : 'The message log could not be read, so it is not known here how many of those people were messaged back.'}
      </div>
      <button class="btn sm" id="cShowVoid">Show ${voided.length === 1 ? 'it' : 'them'}</button>`;
    banners.appendChild(b);
    b.querySelector('#cShowVoid').addEventListener('click', () => focusVoided());
  }

  if (docs) {
    /* The whole story of this screen as it stands. Taken over `neverArchived`
       rather than over the 'failed' retention key, so the number matches what
       `v_needs_attention` and the Overview panel count over the same rows; the
       pre-archive nuance is stated inside the banner instead of shaving rows off
       the front of it. */
    const gaps = live.filter(neverArchived);
    const legacyGaps = gaps.filter(d => retentionOf(d).key === 'legacy').length;
    const overdue = live.filter(overdueRetention);

    if (gaps.length) {
      /* docs arrive newest-first, so the last gap in the list is the oldest one
         — the row that has been unprovable the longest. */
      const oldest = gaps[gaps.length - 1];
      const b = el('div', 'banner hot');
      b.style.marginBottom = '12px';
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">folder_off</span>
        <div style="flex:1">
          <strong>${num(gaps.length)} of ${num(live.length)} genuine document${live.length === 1 ? '' : 's'} ${plural(gaps.length, 'has', 'have')} no archived file.</strong>
          <span class="mono">storage_path</span> is null and there is no <span class="mono">purged_at</span>, so nothing was deleted on schedule —
          the file simply was never stored, and retention cannot be proven for a document whose file does not exist.
          This is the gap <span class="mono">v_needs_attention</span> files as <span class="mono">kyc_archive_gap</span>.
          Oldest audited ${esc(ago(oldest.created_at))}.
          ${legacyGaps
            ? `${num(legacyGaps)} of them predate the archive step (${esc(ARCHIVE_EPOCH_LABEL)}) and are labelled Pre-archive rather than Archive failure — explained history, but still unprovable, so still counted here.`
            : ''}
          ${oneTrail
            ? `Every one of them belongs to the same customer: this is one submission trail failing repeatedly, not a gap spread across a book of customers.`
            : ''}
          ${voided.length ? 'Voided rows are not counted here.' : ''}
        </div>
        <button class="btn sm" id="cShowFailed">Show ${plural(gaps.length, 'it', 'them')}</button>`;
      banners.appendChild(b);
      b.querySelector('#cShowFailed').addEventListener('click', () => focusRegister({ flag: 'gap' }));
    }

    if (overdue.length) {
      const b = el('div', 'banner warm');
      b.style.marginBottom = '12px';
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">schedule</span>
        <div style="flex:1"><strong>${num(overdue.length)} archived file${overdue.length === 1 ? ' is' : 's are'} past retain_until and still stored.</strong>
        The purge schedule has not run for ${overdue.length === 1 ? 'it' : 'them'}. Deleting stored documents is a service-role job; nothing in the browser can do it.</div>
        <button class="btn sm" id="cShowOverdue">Show ${overdue.length === 1 ? 'it' : 'them'}</button>`;
      banners.appendChild(b);
      b.querySelector('#cShowOverdue').addEventListener('click', () => focusRegister({ flag: 'overdue' }));
    }

    /* Accepted-while-expired is the one finding on this screen that is about the
       decision rather than the paperwork around it: the auditor approved an
       identity document that had already lapsed on the day it read it. Only
       APPROVED rows are counted — a rejected expired document is the control
       working, not failing. */
    const acceptedExpired = live.filter(d =>
      expiredAtAudit(d) && String(d.verdict || '').toUpperCase() === 'APPROVED');
    if (acceptedExpired.length) {
      const b = el('div', 'banner warm');
      b.style.marginBottom = '12px';
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">event_busy</span>
        <div style="flex:1"><strong>${num(acceptedExpired.length)} approved document${acceptedExpired.length === 1 ? ' had' : 's had'} already expired when audited.</strong>
        The expiry date on the document predates the day it was checked, so ${acceptedExpired.length === 1 ? 'that identity was' : 'those identities were'} accepted on lapsed ID.</div>
        <button class="btn sm" id="cShowExpired">Show ${acceptedExpired.length === 1 ? 'it' : 'them'}</button>`;
      banners.appendChild(b);
      b.querySelector('#cShowExpired').addEventListener('click', () =>
        focusRegister({ flag: 'expired', verdict: 'APPROVED' }));
    }
  }

  if (escalations.length) {
    /* The newest escalation, because audit_log came back logged_at.desc. An
       escalation lives in audit_log, not in the register, so the button goes
       where the thing it names actually is: the document row when the same
       contact has one, and the activity trail when it does not. A banner that
       counts something and then leaves the reviewer to find it by hand is how
       these end up ignored. */
    const first = escalations[0];
    /* Matched through the contact alias graph: audit_log records whichever key
       the workflow had, and the register may hold the other one for the same
       person. A bare string compare here would send the reviewer to the trail
       for an escalation whose document is sitting in the table above. */
    const fks = new Set(alike(first.lead_email));
    const inRegister = fks.size
      ? live.find(d => keysOf(d).some(k => fks.has(k))) || null
      : null;
    const n = nameFor(first.lead_email || first.lead_name);
    const b = el('div', 'banner warm');
    b.style.marginBottom = '12px';
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">block</span>
      <div style="flex:1">
        <strong>${num(escalations.length)} KYC case${escalations.length === 1 ? '' : 's'} the auditor handed to a human.</strong>
        Newest ${esc(ago(first.logged_at))} —
        ${n.name
          ? esc(n.name)
          : `<span class="mono t-muted">${esc(n.note)}</span>`}${
          n.phone && n.phone !== n.name ? ` <span class="mono">${esc(n.phone)}</span>` : ''}${
          n.phone ? '' : ' <span class="t-muted">(no phone stored for this contact)</span>'}.
        ${esc(first.summary || 'The retry loop gave up.')}
        ${escalations.length > 1 ? `The other ${num(escalations.length - 1)} ${escalations.length - 1 === 1 ? 'is' : 'are'} in the activity trail at the foot of this screen.` : ''}
        ${voidFilterKnown
          ? ''
          : '<span class="t-warm">The register could not be read, so escalations logged against voided rows could not be excluded from this count.</span>'}
      </div>
      <button class="btn sm" id="cShowEsc">${inRegister ? 'Show the document' : 'Show in the trail'}</button>`;
    banners.appendChild(b);
    b.querySelector('#cShowEsc').addEventListener('click', () => {
      /* Searched on the register row's own address, not on whatever key
         audit_log happened to log — the two can be the email and the @lid handle
         for the same person, and searching the wrong one lands on an empty
         table under a banner that just said there was something to see. */
      if (inRegister) focusRegister({ q: String(inRegister.lead_email || inRegister.chat_id || '') });
      else focusTrail();
    });
  }

  /* ── Retention position, and — while there is one customer — the whole trail ──
     With a single submitter the register stops being a population and becomes a
     biography, so the card above it is written as one: who he is, what he sent,
     what came back and what survives in Storage, in the order he lived it. The
     numbers are the same numbers; what changes is that they are labelled as one
     person's history rather than left to read as the dealership's compliance
     record. The moment a second contact appears the card falls back to the plain
     retention breakdown, because then the proportions mean something again. */
  const retCard = el('div', 'card'); body.appendChild(retCard);
  if (!docs) {
    retCard.innerHTML = stateError('the retention breakdown', docsErr);
  } else if (!live.length) {
    retCard.innerHTML = `<div class="label-caps">Retention position</div>${stateEmpty(
      'Nothing to retain yet',
      voided.length
        ? 'No genuine KYC document has been audited. The rows on file were voided as non-submissions, so there is no compliance retention position to report. A row appears here the first time the audit-kyc workflow reads an identity document from a matched lead.'
        : 'No KYC document has been audited yet, so there is no retention position to report. The audit-kyc workflow writes a row the first time a customer sends an identity document on WhatsApp; retention state appears with it.',
      'shield')}`;
  } else {
    const order = ['archived', 'purged', 'legacy', 'unknown', 'failed'];
    const colour = { archived: 'var(--ok)', purged: 'var(--cold)', legacy: 'var(--neutral)', unknown: 'var(--warm)', failed: 'var(--hot)' };
    const counts = {};
    live.forEach(d => { const k = retentionOf(d).key; counts[k] = (counts[k] || 0) + 1; });
    const present = order.filter(k => counts[k]);
    const total = live.length;
    const withRetain = live.filter(d => d.retain_until).length;
    const gaps = live.filter(neverArchived).length;

    const bar = `<div class="stackbar">${present.map(k => `<i style="width:${(counts[k] / total * 100).toFixed(1)}%;background:${colour[k]}"></i>`).join('')}</div>
      <div style="display:flex;gap:20px;margin-top:12px;flex-wrap:wrap">
        ${present.map(k => `<div style="display:flex;align-items:center;gap:8px">
          <span style="width:8px;height:8px;border-radius:50%;background:${colour[k]}"></span>
          <span style="font-weight:500">${esc(RETENTION[k].label)}</span>
          <span class="t-muted num">${num(counts[k])}</span></div>`).join('')}
      </div>`;

    /* The caption carries the honesty, not the bar. A stacked bar is read as a
       distribution whatever is under it, so under one customer it is named for
       what it is before a reviewer can take a share off it. */
    const barNote = `<div class="cell-sub" style="margin-top:12px;white-space:normal">
        ${gaps
          ? `${num(total - gaps)} of ${num(total)} ${plural(total, 'document', 'documents')} ${plural(total - gaps, 'has', 'have')} a file that can still be produced${
              counts.purged ? ` (${num(counts.purged)} of those by having been purged on schedule, which is the policy working)` : ''}; ${num(gaps)} ${plural(gaps, 'has', 'have')} none.`
          : `Every one of the ${num(total)} ${plural(total, 'document', 'documents')} is either archived or purged on schedule.`}
        ${num(withRetain)} of ${num(total)} ${plural(total, 'row', 'rows')} ${plural(withRetain, 'carries', 'carry')} a retain_until date.
        ${counts.legacy ? `Rows audited before ${esc(ARCHIVE_EPOCH_LABEL)} predate the archive step and are labelled Pre-archive; they are still counted in the archive gap.` : ''}
        ${oneTrail ? `<span class="t-warm">This bar is ${num(total)} ${plural(total, 'row', 'rows')} from one customer. The proportions are shapes, not shares.</span>` : ''}
        ${voided.length ? `${num(voided.length)} voided ${plural(voided.length, 'row is', 'rows are')} not part of this breakdown; their files are accounted for in the voided section below.` : ''}
      </div>`;

    if (!oneTrail) {
      retCard.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Retention position · ${num(total)} genuine ${plural(total, 'document', 'documents')}${
        liveContacts.size ? ` from ${num(liveContacts.size)} ${plural(liveContacts.size, 'contact', 'contacts')}` : ''}</div>
        ${bar}${barNote}`;
    } else {
      const w0 = whoOf(live[0]);
      const vCounts = ['APPROVED', 'REJECTED', 'ESCALATED']
        .map(v => [v, live.filter(d => String(d.verdict || '').toUpperCase() === v).length])
        .filter(([, c]) => c);
      const noVerdictN = live.filter(d => !d.verdict).length;
      const types = [...new Set(live.map(d => String(d.document_type || '').trim()).filter(Boolean))];
      const untyped = live.filter(d => !String(d.document_type || '').trim()).length;
      const attemptNos = live.map(d => n0(d.attempt_number)).filter(v => v != null);
      const maxAttempt = attemptNos.length ? Math.max(...attemptNos) : null;
      /* Ordered the way he lived it: by the attempt counter, falling back to the
         audit timestamp where the counter is missing so an uncounted row still
         lands in the right place instead of at the front. */
      const trail = live.slice().sort((x, y) =>
        ((n0(x.attempt_number) || 0) - (n0(y.attempt_number) || 0)) ||
        (new Date(x.created_at) - new Date(y.created_at)));

      retCard.innerHTML = `
        <div class="label-caps">This register is one customer's document trail</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px">
          <span style="font-size:18px;font-weight:600">${w0.name ? esc(w0.name) : 'Unidentified contact'}</span>
          ${w0.phone
            ? `<span class="mono">${esc(w0.phone)}</span>`
            : '<span class="t-warm">No phone stored for this contact</span>'}
          ${w0.chip ? `<span class="chip">${esc(w0.chip)}</span>` : `<span class="chip">${esc(w0.label)}</span>`}
        </div>
        <div class="cell-sub" style="white-space:normal;margin-top:4px">${esc(w0.line)}</div>

        <div style="display:flex;gap:22px;flex-wrap:wrap;margin-top:18px;align-items:center">
          <div><span class="num" style="font-size:22px;font-weight:600">${num(total)}</span>
            <span class="t-muted"> ${esc(plural(total, 'document on file', 'documents on file'))}</span></div>
          ${vCounts.map(([v, c]) => `<div style="display:flex;gap:8px;align-items:center">
            ${pill(v)}<span class="num" style="font-weight:600">${num(c)}</span></div>`).join('')}
          ${noVerdictN ? `<div class="t-muted">${num(noVerdictN)} with no verdict</div>` : ''}
        </div>
        <div class="cell-sub" style="white-space:normal;margin-top:10px">
          Those are counts of one person's attempts, and they are deliberately not divided by one another.
          ${num(total)} ${plural(total, 'upload', 'uploads')} by one customer cannot produce an approval rate,
          an average confidence or a trend: a percentage taken across them would read as a fact about this
          dealership's compliance, and there is nobody else in the register to compare him with.
          Every figure on this screen is a count for that reason.
        </div>
        <div class="cell-sub" style="white-space:normal;margin-top:6px">
          ${types.length
            ? `${num(types.length)} distinct document ${plural(types.length, 'type', 'types')} across ${num(total)} ${plural(total, 'attempt', 'attempts')}${
                untyped ? `, plus ${num(untyped)} ${plural(untyped, 'row that records', 'rows that record')} no type at all` : ''} — ${types.map(esc).join(', ')}.`
            : `No row records a document type.`}
          ${maxAttempt != null ? ` The attempt counter on these rows reaches ${num(maxAttempt)}.` : ''}
        </div>

        <div style="margin-top:20px">${bar}</div>
        ${barNote}

        <div class="label-caps" style="margin-top:24px">Every attempt, in order</div>
        <div class="cell-sub" style="margin-top:6px;white-space:normal">One line per row in the register, ordered by attempt number. Open any of them for the full record.</div>
        <div class="timeline" style="margin-top:12px">${trail.map((x, i) => {
          const xa = n0(x.attempt_number);
          const conf = n0(x.confidence_score);
          return `<div class="tl-item" role="button" tabindex="0" data-trail="${i}" style="cursor:pointer">
            <span class="tl-dot" style="background:var(--${tone(x.verdict) || 'neutral'})"></span>
            <div class="tl-body">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <span style="font-weight:500">Attempt ${xa == null ? '—' : num(xa)}</span>
                ${x.verdict ? pill(x.verdict) : '<span class="t-muted">No verdict</span>'}
                ${neverArchived(x) ? pill('No archived file', 'hot') : retentionPill(retentionOf(x))}
              </div>
              <div class="tl-meta">${x.document_type ? esc(x.document_type) : 'No document type recorded'}
                · audited ${esc(ago(x.created_at))}${conf == null ? '' : ` · ${num(conf)}% confidence`}</div>
            </div></div>`;
        }).join('')}</div>`;

      /* The rows are the same objects the table below opens, so the drawer that
         appears is byte-for-byte the same record either way. */
      retCard.querySelectorAll('[data-trail]').forEach(node => {
        const open = () => openDoc(trail[Number(node.dataset.trail)]);
        node.addEventListener('click', open);
        node.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
      });
    }
  }

  /* ── The register ──────────────────────────────────────────────────────── */
  const queue = el('div', 'card flush'); queue.style.marginTop = '16px'; body.appendChild(queue);

  if (!docs) {
    queue.innerHTML = `<div class="card-head"><div><div class="card-title">KYC register</div></div></div>
      ${stateError('the KYC register', docsErr)}`;
  } else {
    const up = s => String(s || '').toUpperCase();
    const low = s => String(s || '').toLowerCase();
    const f = { verdict: 'ALL', retention: 'ALL', flag: 'ALL', q: '' };

    const vCount = v => live.filter(d => up(d.verdict) === v).length;
    const noVerdict = live.filter(d => !d.verdict).length;
    const segs = [['ALL', live.length], ['APPROVED', vCount('APPROVED')], ['REJECTED', vCount('REJECTED')], ['ESCALATED', vCount('ESCALATED')]];
    if (noVerdict) segs.push(['NONE', noVerdict]);
    const retCounts = {};
    live.forEach(d => { const k = retentionOf(d).key; retCounts[k] = (retCounts[k] || 0) + 1; });
    const flagCounts = {};
    FLAG_KEYS.forEach(k => { flagCounts[k] = live.filter(FLAGS[k].match).length; });
    /* Exactly full means the cap was hit, which is the only thing the browser can
       know without a count query. Saying "the newest 500" is honest; saying
       nothing would let a capped page read as the complete book. */
    const capped = docs.length >= ROW_LIMIT;

    queue.innerHTML = `<div class="card-head"><div>
        <div class="card-title">KYC register · genuine submissions</div>
        <div class="card-sub">Every audited document that is a real submission, with its extracted identity fields, attempt counter and retention state. Click a row for the full record.${
          oneTrail ? ' Every row in it belongs to the same customer, so the columns read as one person\u2019s attempts rather than as a comparison between people.' : ''}${
          voided.length ? ` <span class="t-warm">${num(voided.length)} voided row${voided.length === 1 ? ' is' : 's are'} excluded from this table and every count on it — they are listed separately below.</span>` : ''}${
          capped ? ` <span class="t-warm">The underlying read is capped at the ${num(ROW_LIMIT)} most recent rows, so older documents are not on this page.</span>` : ''}</div>
      </div></div>
      <div class="toolbar">
        <div class="seg" id="cSegVerdict" role="group" aria-label="Filter by verdict">
          ${segs.map(([k, c], i) => `<button data-v="${esc(k)}" class="${i === 0 ? 'on' : ''}">${k === 'ALL' ? 'All' : k === 'NONE' ? 'No verdict' : esc(k)} · ${num(c)}</button>`).join('')}
        </div>
        <div class="grow"><input type="search" id="cq" aria-label="Search KYC documents"
          placeholder="Search name, email, phone, document type or chat id" /></div>
        <select id="cRet" aria-label="Filter by retention state" style="width:auto">
          <option value="ALL">All retention states</option>
          ${['archived', 'purged', 'failed', 'legacy', 'unknown'].map(k =>
            `<option value="${k}">${esc(RETENTION[k].label)} · ${num(retCounts[k] || 0)}</option>`).join('')}
        </select>
        <select id="cFlag" aria-label="Filter by finding" style="width:auto">
          <option value="ALL">All findings</option>
          ${FLAG_KEYS.map(k =>
            `<option value="${esc(k)}">${esc(FLAGS[k].label)} · ${num(flagCounts[k])}</option>`).join('')}
        </select>
        <div class="t-muted num" id="cCount"></div>
      </div>
      <div id="cTable"></div>`;

    const cols = [
      { label: 'Who', strong: true, render: d => whoCell(whoOf(d)) },
      { label: 'Document', render: d => `${d.document_type ? esc(d.document_type) : '<span class="t-muted">No document type recorded</span>'}
          ${d.chat_id ? `<div class="cell-sub mono">${esc(d.chat_id)}</div>` : ''}` },
      { label: 'Verdict', render: d => `${d.verdict ? pill(d.verdict) : '<span class="t-muted">Not decided</span>'}
          ${d.reviewed_by ? `<div class="cell-sub">by ${esc(d.reviewed_by)}${d.reviewed_at ? ' · ' + esc(ago(d.reviewed_at)) : ''}</div>` : ''}` },
      { label: 'Extracted identity', render: d => {
          if (!d.full_name && !d.date_of_birth && !d.expiry_date) return '<span class="t-muted">Nothing extracted</span>';
          /* Expired when audited is red; expired since is amber. Painting both
             the same colour makes a paperwork chore look like a control failure
             and buries the rows that are one. */
          const atAudit = expiredAtAudit(d);
          const lapsed = !atAudit && isPastDate(d.expiry_date);
          const note = atAudit ? ' (expired when audited)' : lapsed ? ' (expired since)' : '';
          const cls = atAudit ? 't-hot' : lapsed ? 't-warm' : '';
          return `<div>${esc(d.full_name || '—')}</div>
            <div class="cell-sub">DOB ${d.date_of_birth ? esc(d.date_of_birth) : '—'} · expires
              ${d.expiry_date ? `<span class="${cls}">${esc(d.expiry_date)}${note}</span>` : '—'}</div>`;
        } },
      { label: 'Checks', render: d => {
          const bits = [d.tampering ? pill('Tampering', 'hot') : '<span class="t-muted">No tampering</span>'];
          if (d.is_valid === false) bits.push(pill('Not valid', 'hot'));
          else if (d.is_valid === true) bits.push(pill('Valid', 'ok'));
          if (expiredAtAudit(d)) bits.push(pill('Expired when audited', 'hot'));
          if (finalAttempt(d) && String(d.verdict || '').toUpperCase() !== 'APPROVED') bits.push(pill('Retries exhausted', 'warm'));
          return `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${bits.join('')}</div>`;
        } },
      { label: 'Confidence', align: 'r', render: d => {
          const c = n0(d.confidence_score);
          if (c == null) return '<span class="t-muted">—</span>';
          const w = Math.max(0, Math.min(100, c));
          return `<div>${num(c)}%</div><div class="bar" style="width:56px;margin-left:auto"><i style="width:${w}%;background:var(--${c > 70 ? 'ok' : c > 40 ? 'warm' : 'hot'})"></i></div>`;
        } },
      { label: 'Attempt', align: 'r', render: d => {
          const a = n0(d.attempt_number), m = n0(d.max_attempts);
          if (a == null) return '<span class="t-muted">—</span>';
          const last = m != null && a >= m;
          return `<span class="${last ? 't-hot' : ''}">${num(a)}${m != null ? ` of ${num(m)}` : ''}</span>
            ${last ? '<div class="cell-sub t-hot">Final attempt</div>' : ''}`;
        } },
      { label: 'Retention', render: d => {
          const r = retentionOf(d);
          const od = overdueRetention(d);
          const sub = d.purged_at
            ? `purged ${esc(ago(d.purged_at))}`
            : d.retain_until
              ? `retain until ${esc(d.retain_until)}${od ? ' · overdue' : ''}`
              : 'no retain_until set';
          return `${retentionPill(r)}<div class="cell-sub ${od ? 't-warm' : ''}">${sub}</div>`;
        } },
      { label: 'Submitted', render: d => `<span class="t-muted">${esc(ago(d.created_at))}</span>` },
      { label: 'Decision', align: 'r', render: d => {
          const w = whoOf(d);
          const btn = (label, title) => `<button class="btn sm" disabled
            aria-label="${esc(label)} — ${esc(whoLabel(w))}" title="${esc(title)}">${esc(label)}</button>`;
          return `<div style="display:flex;gap:6px;justify-content:flex-end">
            ${btn('Approve', NO_DECISION_HOOK)}${btn('Reject', NO_DECISION_HOOK)}${btn('Re-ask', NO_REASK_HOOK)}</div>`;
        } },
    ];

    const th = queue.querySelector('#cTable');
    const countEl = queue.querySelector('#cCount');

    const visible = () => {
      const q = f.q.trim().toLowerCase();
      return live.filter(d => {
        if (f.verdict === 'NONE') { if (d.verdict) return false; }
        else if (f.verdict !== 'ALL' && up(d.verdict) !== f.verdict) return false;
        if (f.retention !== 'ALL' && retentionOf(d).key !== f.retention) return false;
        if (f.flag !== 'ALL' && !FLAGS[f.flag].match(d)) return false;
        if (!q) return true;
        const w = whoOf(d);
        return [w.name, w.email, w.phone, d.lead_name, d.full_name, d.lead_email, d.document_type, d.chat_id]
          .some(v => low(v).includes(q));
      });
    };

    function draw() {
      if (!live.length) {
        countEl.textContent = '';
        th.innerHTML = stateEmpty(
          voided.length ? 'No genuine submission in the register' : 'No documents in the register',
          voided.length
            ? `Every one of the ${num(docs.length)} rows loaded here was voided as a non-submission. Nothing in this register is a compliance decision.`
            : 'The audit-kyc workflow writes a row here each time a customer sends an identity document on WhatsApp and the lead behind it is matched. Nothing has reached it yet. Any historic auditor activity is shown in the trail below.',
          'verified_user');
        return;
      }
      const rows = visible();
      countEl.textContent = `${rows.length} of ${live.length}`;
      th.innerHTML = table(cols, rows, {
        onRow: true,
        empty: stateEmpty('No document matches these filters',
          'Clear the search or pick another verdict, retention state or finding.', 'filter_alt_off'),
      });
      wireRows(th, rows, openDoc);
    }

    queue.querySelectorAll('#cSegVerdict button').forEach(b => b.addEventListener('click', () => {
      queue.querySelectorAll('#cSegVerdict button').forEach(x => x.classList.toggle('on', x === b));
      f.verdict = b.dataset.v; draw();
    }));
    queue.querySelector('#cq').addEventListener('input', e => { f.q = e.target.value; draw(); });
    queue.querySelector('#cRet').addEventListener('change', e => { f.retention = e.target.value; draw(); });
    queue.querySelector('#cFlag').addEventListener('change', e => { f.flag = e.target.value; draw(); });

    /* Every banner's "Show them" lands here: it sets the whole filter state at
       once, writes it back into the controls, and scrolls the register into
       view. Clearing the fields it was not asked for is deliberate — a leftover
       search box silently hiding half of the rows the banner just counted is
       the failure mode this exists to prevent. */
    focusRegister = ({ verdict = 'ALL', retention = 'ALL', flag = 'ALL', q = '' } = {}) => {
      f.verdict = verdict; f.retention = retention; f.flag = flag; f.q = q;
      queue.querySelector('#cRet').value = retention;
      queue.querySelector('#cFlag').value = flag;
      queue.querySelector('#cq').value = q;
      queue.querySelectorAll('#cSegVerdict button').forEach(x => x.classList.toggle('on', x.dataset.v === verdict));
      draw();
      queue.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    draw();
  }

  /* ── Voided rows — the incident, kept as evidence ──────────────────────────
     Deliberately a separate card below the register rather than a filter inside
     it: the point is that these are not the same kind of thing. There is no
     Approve, no Reject and no Re-ask here, and their absence is the design —
     there is no submission to decide on and nobody who is waiting for an answer.
     What a reviewer needs from this section is the opposite: who these people
     actually were, what the machine said about them, and what the dealership
     told them. */
  /* Built only when there is something in it. The void partition is empty as of
     the 24 Aug cleanup — the nine non-submissions were deleted and the gate that
     produced them is fixed — and a card headed "Voided — not KYC submissions"
     with an empty state under it would leave a standing accusation on the screen
     an auditor reads, about rows that no longer exist. Nothing to show means
     nothing on the page, not a heading with a shrug under it.

     A failed read is not reported here either. The register card above already
     says the whole table could not be read; repeating it under this heading
     would imply there are voided rows behind the error, which is the one thing
     the failure means we do not know. */
  if (docs && voided.length) {
    const voidCard = el('div', 'card flush'); voidCard.style.marginTop = '16px'; body.appendChild(voidCard);
    const voidHead = `<div class="card-head"><div>
        <div class="card-title">Voided — not KYC submissions</div>
        <div class="card-sub">Rows the backend marked with <span class="mono">void_reason</span>. They are evidence of a routing fault, not compliance decisions, and nothing above counts them.</div>
      </div></div>`;

    const reasons = [...new Set(voided.map(v => String(v.void_reason || '').trim()).filter(Boolean))];
    const stillStored = voided.filter(v => v.storage_path && !v.purged_at).length;
    const chats = new Set(voided.map(v => key(v.chat_id)).filter(Boolean)).size;
    const withLead = voided.filter(v => whoOf(v).kind === 'lead').length;

    const vcols = [
      { label: 'Who this actually was', strong: true, render: d => whoCell(whoOf(d)) },
      { label: 'What the image was', render: d => {
          const t = String(d.document_type || '').trim();
          return `${t ? esc(t) : '<span class="t-muted">The vision model returned no description</span>'}
            <div class="cell-sub" style="white-space:normal">Described by the vision model, not read off a document.</div>`;
        } },
      { label: 'Machine output', render: d => {
          const c = n0(d.confidence_score);
          /* A chip, never a verdict pill. An APPROVED pill here is exactly the
             thing that made a greeting card look like a cleared identity check. */
          return `<span class="chip">${d.verdict ? esc(String(d.verdict)) : 'no verdict'} · void</span>
            <div class="cell-sub" style="white-space:normal">Auto-generated on an image nobody requested${
              c == null ? '' : ` · confidence ${num(c)}%`}. Not a decision.</div>`;
        } },
      /* Counted per chat, never per row. communication_logs carries no document
         id, so pinning one message to one image would be a guess — and a guess
         that says "we told this person APPROVED" is exactly the kind of claim
         this screen exists to stop making. */
      { label: 'Sent to this chat', render: d => {
          const cs = commsFor(d);
          if (cs == null) return '<span class="t-muted">Message log could not be read</span>';
          if (!cs.length) return '<span class="t-muted">No KYC message to this chat in the log</span>';
          const ap = cs.filter(c => commKind(c.message) === 'APPROVED').length;
          const rj = cs.filter(c => commKind(c.message) === 'REJECTED').length;
          const other = cs.length - ap - rj;
          const bits = [];
          if (ap) bits.push(`<span class="t-hot">${num(ap)} × [KYC-APPROVED]</span>`);
          if (rj) bits.push(`<span class="t-warm">${num(rj)} × [KYC-REJECT]</span>`);
          if (other) bits.push(`<span class="t-muted">${num(other)} other KYC message${other === 1 ? '' : 's'}</span>`);
          return `<div style="display:flex;gap:8px;flex-wrap:wrap">${bits.join('')}</div>
            <div class="cell-sub" style="white-space:normal">Across the whole chat, not matched to this one image · newest ${esc(ago(cs[0].created_at))}</div>`;
        } },
      { label: 'Evidence', render: d => {
          const r = retentionOf(d);
          return `${retentionPill(r)}<div class="cell-sub">${d.purged_at
            ? `purged ${esc(ago(d.purged_at))}`
            : d.storage_path ? 'image still in the private bucket' : 'no file stored'}</div>`;
        } },
      { label: 'Voided', render: d => `<span class="t-muted">${esc(ago(d.voided_at))}</span>
          <div class="cell-sub">audited ${esc(ago(d.created_at))}</div>` },
    ];

    voidCard.innerHTML = `${voidHead}
      <div style="padding:14px 20px 0">
        <div class="banner hot">
          <span class="material-symbols-outlined" style="font-size:20px">policy</span>
          <div style="flex:1">
            <strong>${num(voided.length)} row${voided.length === 1 ? '' : 's'}${chats ? ` across ${num(chats)} WhatsApp chat${chats === 1 ? '' : 's'}` : ''}.</strong>
            No Approve, Reject or Re-ask control appears in this table on purpose: nothing was submitted, so there is no decision to record and nobody is waiting for one.
            ${withLead
              ? `<span class="t-warm">${num(withLead)} of them ${withLead === 1 ? 'does' : 'do'} resolve to a lead on file — read ${withLead === 1 ? 'that row' : 'those rows'} carefully before assuming the void was correct.</span>`
              : leadsErr
                ? '<span class="t-warm">The leads table could not be read, so whether any of these resolves to a lead on file is not known on this page — the absence of a match here is not evidence there is none.</span>'
                : 'None of them resolves to a lead on file.'}
          </div>
        </div>
        ${reasons.map(r => `<div class="quote" style="margin-top:12px">${esc(r)}</div>`).join('')}
        <div class="cell-sub" style="margin-top:12px;white-space:normal">
          ${comms
            ? (kycCommsVoid.length
                ? `${num(kycCommsVoid.length)} customer-facing KYC message${kycCommsVoid.length === 1 ? ' was' : 's were'} delivered to these chats and cannot be recalled.`
                : 'No customer-facing KYC message to these chats appears in the message log read here.')
            : `The message log could not be read (${esc(commsErr || 'unknown error')}), so what was sent to these chats is unknown on this page.`}
          ${stillStored
            ? ` ${num(stillStored)} of these images ${stillStored === 1 ? 'is' : 'are'} still held in the private kyc-documents bucket. Deleting a stored object is a service-role job; nothing in the browser can do it.`
            : ' None of these images is still held in storage.'}
        </div>
      </div>
      <div id="cVoidTable"></div>`;

    const vth = voidCard.querySelector('#cVoidTable');
    /* No `empty` needed: this card only exists when `voided` has rows in it. */
    vth.innerHTML = table(vcols, voided, { onRow: true });
    wireRows(vth, voided, openDoc);

    focusVoided = () => voidCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── One document, in full ─────────────────────────────────────────────── */
  function openDoc(d) {
    const w = whoOf(d);
    const voidedRow = isVoid(d);
    const r = retentionOf(d);
    const m = RETENTION[r.key];
    const od = overdueRetention(d);
    const conf = n0(d.confidence_score);
    const a = n0(d.attempt_number), mx = n0(d.max_attempts);
    const atAudit = expiredAtAudit(d);
    const lapsed = !atAudit && isPastDate(d.expiry_date);
    /* Three distinct cases, and they must not be collapsed: the object is there
       and signable; it was purged on schedule (signing it would hand back a URL
       that 404s); or it was never archived at all. */
    const canOpen = !d.purged_at && !!d.storage_path;
    const fileTitle = canOpen ? CAN_OPEN_FILE : (d.purged_at ? PURGED_FILE : NO_FILE_LINK);

    const cs = commsFor(d);
    const commsHtml = cs == null
      ? `<div class="cell-sub" style="white-space:normal">The message log could not be read (${esc(commsErr || 'unknown error')}), so what this contact was told cannot be shown here.</div>`
      : !cs.length
        ? '<div class="cell-sub">No KYC message to this contact appears in the 500 most recent message-log rows.</div>'
        /* Every KYC message to this contact, not the ones belonging to this row:
           communication_logs has no document id to join on. Said plainly rather
           than implied by a suspiciously long list. */
        : `<div class="cell-sub" style="white-space:normal">Every KYC message logged to this contact. The message log carries no document id, so these are not matched to this individual upload.</div>
           <div class="thread" style="margin-top:8px">${cs.map(c =>
             `<div class="bubble out"><div>${esc(String(c.message || '').slice(0, 400))}</div><div class="bubble-meta">${esc(clock(c.created_at))} · ${esc(ago(c.created_at))}</div></div>`).join('')}</div>`;

    /* Who-section. It is the first thing in the drawer because every other fact
       below is only meaningful once you know whether there is a person with a
       file behind this row. */
    const whoHtml = `<div class="section">
        <div class="label-caps">Who this is</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
          ${w.name ? `<span style="font-weight:500">${esc(w.name)}</span>` : '<span class="t-muted">No name on record</span>'}
          <span class="chip">${esc(w.label)}</span>
        </div>
        <dl class="kv" style="margin-top:12px">
          <dt>Lead record</dt><dd>${w.kind === 'lead'
            ? `${esc(w.email)} <span class="t-ok">· matched in leads</span>`
            : w.kind === 'email_only'
              ? `${esc(w.email)} <span class="t-warm">· ${leadsErr ? 'the leads table could not be read, so this is unconfirmed' : 'no matching row in leads'}</span>`
              : '<span class="t-warm">No lead behind this row</span>'}</dd>
          <dt>WhatsApp profile name</dt><dd>${w.contact && w.contact.push_name
            ? `${esc(w.contact.push_name)} <span class="t-muted">· the name this person set on WhatsApp, not a customer record</span>`
            : (w.contactMissing
                ? '<span class="t-muted">No whatsapp_contacts row for this chat id</span>'
                : '<span class="t-muted">Not captured</span>')}</dd>
          <dt>Phone</dt><dd>${w.phone
            ? `<span class="mono">${esc(w.phone)}</span> <span class="t-muted">· ${esc(w.phoneFrom)}</span>`
            : '<span class="t-muted">Not stored — historic contacts predate phone capture, and none is inferred from the chat id</span>'}</dd>
          <dt>Chat id</dt><dd class="mono" style="word-break:break-all">${w.chatId
            ? esc(w.chatId)
            : '<span class="t-muted">none</span>'}</dd>
          <dt>Name on the KYC row</dt><dd>${d.lead_name
            ? esc(d.lead_name)
            : '<span class="t-muted">none</span>'}</dd>
        </dl>
      </div>`;

    if (voidedRow) {
      openDrawer(`
        <div class="drawer-head">
          <div style="flex:1">
            <h2 style="font-size:18px">${esc(whoLabel(w))}</h2>
            <div class="cell-sub"><span class="chip">Voided — not a KYC submission</span></div>
            <div class="cell-sub mono">${esc(d.id ?? '')}</div>
          </div>
          <button class="btn ghost sm" id="cClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div class="drawer-body">
          <div class="section">
            <div class="label-caps">Why this is not a decision</div>
            <div class="quote" style="margin-top:8px">${esc(d.void_reason || '')}</div>
            <dl class="kv" style="margin-top:12px">
              <dt>Voided</dt><dd>${d.voided_at ? esc(ago(d.voided_at)) : '<span class="t-muted">no voided_at timestamp</span>'}</dd>
              <dt>Auto-audited</dt><dd>${esc(ago(d.created_at))}</dd>
            </dl>
          </div>

          ${whoHtml}

          <div class="section">
            <div class="label-caps">What the machine produced</div>
            <div class="cell-sub" style="margin-top:8px;white-space:normal">Kept verbatim as evidence. None of it is a verdict on a person, and none of it is counted anywhere on this screen.</div>
            <dl class="kv" style="margin-top:12px">
              <dt>Described as</dt><dd>${d.document_type ? esc(d.document_type) : '<span class="t-muted">nothing recorded</span>'}</dd>
              <dt>Machine verdict</dt><dd><span class="chip">${d.verdict ? esc(String(d.verdict)) : 'none'} · void</span></dd>
              <dt>Confidence</dt><dd class="num">${conf == null ? '<span class="t-muted">Not scored</span>' : num(conf) + '%'}</dd>
              <dt>Extracted name</dt><dd>${d.full_name ? esc(d.full_name) : '<span class="t-muted">Nothing extracted</span>'}</dd>
            </dl>
            ${d.remarks ? `<div class="quote" style="margin-top:12px">${esc(d.remarks)}</div>` : ''}
          </div>

          <div class="section">
            <div class="label-caps">What this contact was told</div>
            ${commsHtml}
          </div>

          <div class="section">
            <div class="label-caps">Evidence held</div>
            <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
              <span class="material-symbols-outlined ${r.key === 'archived' ? 't-ok' : 't-muted'}">${esc(m.icon)}</span>
              ${retentionPill(r)}
            </div>
            <div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(r.detail)}
              This is a private photograph somebody sent to a business number, not a KYC document. It is retained as evidence of the routing fault; purging it is a service-role job.</div>
            <dl class="kv" style="margin-top:12px">
              <dt>storage_path</dt><dd class="mono" style="word-break:break-all">${d.storage_path ? esc(d.storage_path) : '<span class="t-muted">null</span>'}</dd>
              <dt>retain_until</dt><dd>${d.retain_until ? esc(d.retain_until) : '<span class="t-muted">null</span>'}</dd>
              <dt>purged_at</dt><dd>${d.purged_at ? esc(ago(d.purged_at)) : '<span class="t-muted">null</span>'}</dd>
            </dl>
          </div>
        </div>
        <div class="drawer-foot">
          <span class="cell-sub" style="flex:1;white-space:normal">No approve, reject or re-ask here — there was no submission and nobody is waiting on an answer.</span>
          <button class="btn ghost" id="cOpenFile" ${canOpen ? '' : 'disabled'} title="${esc(fileTitle)}">Open file</button>
        </div>`);
      $('cClose').addEventListener('click', closeDrawer);
      wireFileButton(d, canOpen);
      return;
    }

    /* Re-uploads from the same customer are separate rows that relate to each
       other only through attempt_number, so a reviewer reading one row cannot
       see that it is the fourth try. Three rejections then an approval is a
       different story from a single clean pass, and the story is the thing the
       lawyer asked for. Rows are matched on the exact lead_email or chat_id the
       workflow wrote — never on a name, which two customers can share — and
       voided rows are excluded, so a greeting card can never appear in a
       customer's attempt history. The match runs through the contact alias graph
       so a row filed under an email and a row filed under that same customer's
       @lid land in one chain instead of two — otherwise a re-upload looks like a
       first attempt purely because the workflow had a different key to hand. */
    const ks = new Set(keysOf(d));
    const chain = live.filter(x => keysOf(x).some(k => ks.has(k)))
    .slice().sort((x, y) =>
      ((n0(x.attempt_number) || 0) - (n0(y.attempt_number) || 0)) ||
      (new Date(x.created_at) - new Date(y.created_at)));
    const chainHtml = chain.length > 1
      ? `<div class="timeline" style="margin-top:8px">${chain.map(x => {
          const xa = n0(x.attempt_number);
          const here = x === d;
          return `<div class="tl-item">
            <span class="tl-dot" style="background:var(--${here ? 'primary' : 'neutral'})"></span>
            <div class="tl-body">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <span style="font-weight:500">Attempt ${xa == null ? '—' : num(xa)}</span>
                ${x.verdict ? pill(x.verdict) : '<span class="t-muted">No verdict</span>'}
                ${here ? '<span class="chip">Viewing</span>' : ''}
              </div>
              <div class="tl-meta">${esc(x.document_type || 'Unknown document')} · ${esc(ago(x.created_at))}
                ${n0(x.confidence_score) == null ? '' : ' · ' + num(x.confidence_score) + '% confidence'}
                · ${esc(RETENTION[retentionOf(x).key].label.toLowerCase())}</div>
            </div></div>`;
        }).join('')}</div>`
      : (n0(d.attempt_number) || 0) > 1
        ? `<div class="cell-sub" style="margin-top:8px;white-space:normal">This is attempt ${num(d.attempt_number)}, but no earlier genuine attempt for this customer is in the ${num(ROW_LIMIT)} rows loaded here. The earlier rows may simply be older than this page reaches.</div>`
        : '<div class="cell-sub" style="margin-top:8px">Only one genuine upload from this customer is on file.</div>';

    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1">
          <h2 style="font-size:18px">${esc(whoLabel(w))}</h2>
          <div class="cell-sub">${esc(d.document_type || 'Unknown document')} · submitted ${esc(ago(d.created_at))}</div>
          <div class="cell-sub mono">${esc(d.id ?? '')}</div>
        </div>
        <button class="btn ghost sm" id="cClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        <div class="section">
          <div class="label-caps">Verdict</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
            ${d.verdict ? pill(d.verdict) : '<span class="t-muted">No verdict recorded</span>'}
            ${d.tampering ? pill('Tampering detected', 'hot') : ''}
            ${d.is_valid === false ? pill('Not valid', 'hot') : d.is_valid === true ? pill('Valid', 'ok') : ''}
          </div>
          <dl class="kv" style="margin-top:12px">
            <dt>Confidence</dt><dd class="num">${conf == null ? '<span class="t-muted">Not scored</span>' : num(conf) + '%'}</dd>
            <dt>Attempt</dt><dd class="num">${a == null ? '<span class="t-muted">—</span>' : num(a) + (mx != null ? ` of ${num(mx)}` : '')}</dd>
            <dt>Reviewed by</dt><dd>${d.reviewed_by
              ? `${esc(d.reviewed_by)}<div class="cell-sub" style="white-space:normal">The name the workflow wrote on the row. Staff contact details are not recorded anywhere this dashboard reads — the users table holds no phone number — so this name cannot be turned into somebody to call.</div>`
              : '<span class="t-muted">Not reviewed by a human</span>'}</dd>
            <dt>Reviewed at</dt><dd>${d.reviewed_at ? esc(ago(d.reviewed_at)) : '<span class="t-muted">—</span>'}</dd>
          </dl>
          ${d.remarks ? `<div class="quote" style="margin-top:12px">${esc(d.remarks)}</div>` : ''}
        </div>

        ${whoHtml}

        <div class="section">
          <div class="label-caps">Extracted identity</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Full name</dt><dd>${d.full_name ? esc(d.full_name) : '<span class="t-muted">Not extracted</span>'}</dd>
            <dt>Date of birth</dt><dd>${d.date_of_birth ? esc(d.date_of_birth) : '<span class="t-muted">Not extracted</span>'}</dd>
            <dt>Expiry date</dt><dd>${d.expiry_date
              ? `<span class="${atAudit ? 't-hot' : lapsed ? 't-warm' : ''}">${esc(d.expiry_date)}${
                  atAudit ? ' · already expired on the day it was audited' : lapsed ? ' · expired since it was audited' : ''}</span>`
              : '<span class="t-muted">Not extracted</span>'}</dd>
          </dl>
        </div>

        <div class="section">
          <div class="label-caps">Attempt history</div>
          ${chainHtml}
        </div>

        <div class="section">
          <div class="label-caps">Messages to this contact</div>
          ${commsHtml}
        </div>

        <div class="section">
          <div class="label-caps">Retention</div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
            <span class="material-symbols-outlined ${neverArchived(d) ? 't-hot' : r.key === 'archived' ? 't-ok' : 't-muted'}">${esc(m.icon)}</span>
            ${retentionPill(r)}
          </div>
          <div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(r.detail)}</div>
          ${od ? `<div class="banner warm" style="margin-top:12px"><span class="material-symbols-outlined">schedule</span>
            <div>retain_until has passed and the file is still stored. The purge schedule has not run for this row.</div></div>` : ''}
          <dl class="kv" style="margin-top:12px">
            <dt>storage_path</dt><dd class="mono" style="word-break:break-all">${d.storage_path ? esc(d.storage_path) : '<span class="t-muted">null</span>'}</dd>
            <dt>retain_until</dt><dd>${d.retain_until ? `<span class="${od ? 't-warm' : ''}">${esc(d.retain_until)}</span>` : '<span class="t-muted">null</span>'}</dd>
            <dt>purged_at</dt><dd>${d.purged_at ? esc(ago(d.purged_at)) : '<span class="t-muted">null</span>'}</dd>
            <dt>Audited</dt><dd>${esc(ago(d.created_at))}</dd>
          </dl>
        </div>
      </div>
      <div class="drawer-foot">
        <button class="btn primary" disabled title="${esc(NO_DECISION_HOOK)}">Approve</button>
        <button class="btn danger" disabled title="${esc(NO_DECISION_HOOK)}">Reject</button>
        <button class="btn" disabled title="${esc(NO_REASK_HOOK)}">Re-request upload</button>
        <button class="btn ghost" id="cOpenFile" ${canOpen ? '' : 'disabled'} title="${esc(fileTitle)}">Open file</button>
      </div>`);
    $('cClose').addEventListener('click', closeDrawer);
    wireFileButton(d, canOpen);
  }

  function wireFileButton(d, canOpen) {
    if (!canOpen) return;
    const btn = $('cOpenFile');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      /* The tab is opened BEFORE the await. A popup blocker only trusts a
         window.open that happens inside the click's own task; opening it after
         the signing round-trip gets it blocked, and the reviewer sees nothing
         happen at all. */
      const tab = window.open('', '_blank', 'noopener');
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Signing…';
      try {
        const url = await signedUrl(d.storage_path, SIGNED_URL_TTL);
        if (tab) tab.location = url; else window.location.assign(url);
      } catch (e) {
        if (tab) tab.close();
        btn.title = `Could not open the document: ${e.message}`;
        btn.textContent = 'Could not open';
        /* Leave the failure on the button rather than throwing it away: the
           reviewer needs to know the archive did not answer, and this drawer
           has no other place to say so. */
        return;
      } finally {
        if (btn.textContent === 'Signing…') { btn.textContent = label; btn.disabled = false; }
      }
    });
  }

  /* ── Activity trail ────────────────────────────────────────────────────── */
  /* Unlike everything above, this is a log of things that actually happened, so
     the messages sent to voided contacts belong here — they were sent. What must
     not happen is presenting them as decisions, or printing a chat id in the
     place a person's name goes. Both are handled per row.

     With the void partition empty the void-marking branch is currently inert and
     no row carries the chip. It is kept because the branch has to stay correct
     for the day a row is voided again, and the card's own subtitle no longer
     promises marking that nothing on the page shows. */
  const hist = el('div', 'card flush'); hist.style.marginTop = '16px'; body.appendChild(hist);
  const down = [auditErr ? 'the audit log' : '', commsErr ? 'the message log' : ''].filter(Boolean);

  const events = [
    ...kycComms.map(c => ({ at: c.created_at, who: c.lead_email, text: c.message,
      kind: commKind(c.message), voided: voidKeys.has(key(c.lead_email)), source: 'message' })),
    ...(audit || []).map(a => ({ at: a.logged_at, who: a.lead_email || a.lead_name, text: a.summary,
      kind: a.status, voided: voidKeys.has(key(a.lead_email)), source: 'audit' })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  const trailBody = (auditErr && commsErr)
    ? stateError('KYC activity', auditErr)
    : events.length
      ? events.map(e => {
          const n = nameFor(e.who);
          return `
        <div class="list-item" style="cursor:default">
          <span class="mono t-muted">${esc(clock(e.at))}</span>
          ${e.voided ? `<span class="chip">${esc(e.kind || 'LOGGED')} · void</span>` : pill(e.kind || 'LOGGED')}
          <div style="flex:1;min-width:0">
            <div style="font-weight:500">${n.name
              ? esc(n.name)
              : `<span class="mono t-muted">${esc(n.note)}</span>`}${
              n.phone && n.phone !== n.name ? ` <span class="mono t-muted" style="font-weight:400">${esc(n.phone)}</span>` : ''}</div>
            <div class="cell-sub" style="white-space:normal">${n.name ? esc(n.note) + ' · ' : ''}${
              n.phone ? '' : 'no phone stored · '}${esc(String(e.text || '').slice(0, 180))}</div>
            ${e.voided ? '<div class="cell-sub t-hot">Sent about a voided row — this was not a compliance decision, and the recipient was never a customer.</div>' : ''}
          </div>
          <div class="cell-sub">${esc(ago(e.at))}</div>
        </div>`;
        }).join('')
      : stateEmpty('No KYC activity recorded',
          'No run by the KYC auditor appears in audit_log and no [KYC-…] message appears in the message log. Both fill the moment a customer sends an identity document on WhatsApp and the audit-kyc workflow runs.',
          'history');

  hist.innerHTML = `<div class="card-head"><div><div class="card-title">KYC activity</div>
      <div class="card-sub">Auditor runs from audit_log and customer-facing KYC messages from communication_logs.${
        voided.length ? ' Messages sent about voided rows are shown — they were really sent — but marked as void so they are never read as decisions.' : ''}${
        voidFilterKnown ? '' : ' <span class="t-warm">The register could not be read on this page load, so nothing here could be checked against void_reason and no row is marked.</span>'}</div></div></div>
    ${down.length && !(auditErr && commsErr) ? `<div style="padding:14px 20px 0"><div class="banner warm">
      <span class="material-symbols-outlined">warning</span>
      <div>Could not read ${esc(down.join(' or '))} (${esc(auditErr || commsErr)}), so this trail is incomplete.</div></div></div>` : ''}
    <div>${trailBody}</div>`;

  /* The escalation banner's fallback target. Assigned after the card exists;
     the banner's handler cannot run before this line. */
  focusTrail = () => hist.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

/* ==========================================================================
   S9 · Campaigns
   The 7-day warm drip and the 12-hour silence detector both ran entirely inside
   n8n with nothing in the product to show for them, and no way to start one.
   A campaign nobody can see or trigger is indistinguishable from a broken one —
   which is exactly how the drip sat failing on every run without being noticed.
   ========================================================================== */
