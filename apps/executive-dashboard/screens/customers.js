/* NEXUS OS — screens/customers.js
   Customer 360.

   THE CORRECTION THIS FILE EXISTS FOR (24 Aug 2026)
   -------------------------------------------------
   This screen used to build its customer list out of v_customer_360 and
   customer_360_profiles. Both are aggregation outputs: they pick up whoever the
   nightly job saw, which includes the people in `whatsapp_contacts` who messaged
   the owner's personal WhatsApp number and were never customers of anything.
   Printing one of them here, in a list with a lifetime-value column, is the same
   class of mistake as sending [KYC-APPROVED] to somebody who sent a greeting
   card. A person reading this screen must not come away believing the dealership
   has a relationship it does not have.

   So the spine of this screen is `v_customer_directory` — leads UNION
   purchase_history, keyed on lower(email). That view is the definition of a
   customer: somebody who enquired, or somebody who bought. Everything else hangs
   off it as enrichment and can never add a person to the list:

     · v_customer_360        — live lifetime value, lead / message counts, phone,
                               and a second copy of the email / Slack touch counts
                               with no sync timestamp against them.
     · customer_360_profiles — the nightly job's own output, and the only source
                               of last_synced_at, which is what makes a touch
                               count readable at all (see below).
     · whatsapp_contacts     — a messaging directory, NOT a customer list. A row
                               here is shown as a customer's WhatsApp channel only
                               when its lead_email matches a directory customer.

   Anything present in those three but absent from the directory is listed at the
   foot of the screen under a heading that says it is not a customer, with the
   reason. Nothing is hidden and nothing is promoted.

   THE SECOND CORRECTION, AND WHERE IT STANDS TONIGHT: every profile the nightly
   job has written reports 0 emails and 0 Slack messages. For days that was not
   what the customers did — it was what the job collected. Customer 360's Gmail
   half authenticates with an OAuth2 credential that had been dead: the Google
   consent screen was left in Testing, and Google expires a Testing app's refresh
   token after seven days, so the token the job held stopped working and every
   run counted nothing.

   That is now repaired. The app has been published to production, the credential
   re-authorised, and a Customer 360 run completed afterwards — later than
   GMAIL_FIXED_AT below — so the single profile in the database carries a
   last_synced_at from a run that could reach the mailbox. Its 0 is therefore a
   counted zero: the mailbox holds no mail for that address. That is a fact about
   the customer, not a gap in the pipeline, and this screen now says so.

   The distinction is kept in code rather than hard-coded to today's answer,
   because the next credential expiry looks identical from the database side: a
   0 written by a run older than the fix means "not counted", a 0 written by a
   run after it means "counted, and it is none". This screen decides between
   those two per profile from that profile's own last_synced_at, and says which
   one it is every single time it prints one of these numbers.

   THE DUPLICATE THAT WAS: a second customer_360_profiles row (customer_id '25',
   a leftover from the Bitrix era) pointed at the same address as the live one
   and has been deleted. One person is no longer two profiles. The collapse
   handling below stays exactly where it is — two rows for one email is what an
   import does, and it will happen again — but nothing on this screen is
   currently collapsing anything, and the note that reports a collapse only
   renders when there is one.

   THE THIRD CORRECTION: the customer list is read from Supabase and never from
   Bitrix24. Bitrix's crm.* read methods answer 403 on the dealership's current
   plan, so no record here came from Bitrix and none can. Bitrix *writes* do
   work — leads raised and updated by the workflows land there. The screen must
   not compress that into "Bitrix is synced" or into "Bitrix is down"; it is a
   plan restriction on reading, and only on reading.

   AND: purchase_history records the car as a free-text `vehicle` string with no
   reference to an inventory unit. Nothing here joins to inventory and nothing
   here claims to know which stock number a customer drove away in.

   Nothing here is estimated. A count the database did not return is an em dash. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, esc, initials, n0, num, pill, tone } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { noSource, stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi, table, wireRows } from '../lib/ui.js';

const PROFILE_COLS = 'customer_id,name,email,phone,total_emails,total_slack_messages,last_synced_at';
const CONTACT_COLS = 'chat_id,phone,push_name,lead_email,message_count,first_seen,last_seen';
const DIR_LIMIT = 1000;
const VIEW_LIMIT = 500;
const PROFILE_LIMIT = 1000;
const CONTACT_LIMIT = 2000;
const SOURCE_LIMIT = 2000;
const MSG_LIMIT = 50;

/* v_customer_directory is read with select=* on purpose, and its columns are now
   known rather than guessed: id, name, email, phone, source_records,
   last_seen_at, read off the live database on 24 Aug 2026. They are still not
   named in the select, because this view is the spine of the screen and a future
   rename would answer 42703 and take the entire customer list down with it — a
   missing column read off a `select=*` row is a gap in one cell, which this file
   can render honestly. The read is deliberately unordered for the same reason;
   sorting happens client-side over values that were actually returned.

   The alias lists that used to sit here (`lead_email`, `full_name`,
   `display_name`, …) were guesses at columns this view does not have, and one of
   them was being applied to purchase_history rows, where `vehicle_interest` and
   `model` do not exist either. Both are gone: every column below is one the
   database was observed to return. */
const str  = v => String(v == null ? '' : v).trim();
const norm = v => str(v).toLowerCase();

/* Neither the aggregation nor the credential behind it can be repaired from the
   browser. Spelled out once so the disabled control and the prose agree. */
const NO_SYNC_HOOK =
  'customer_360_profiles is written by the nightly aggregation job and is service-role only. The HOOK map in ' +
  'lib/data.js exposes no webhook for that job, so the browser cannot make it run early. The Gmail credential ' +
  'behind it has already been repaired in the Google console — that was never something this button could have ' +
  'done — and the figures will change when the next scheduled run completes. This stays disabled until a ' +
  'run-now endpoint exists.';

/* The paragraph that has to travel with every touch count on this screen. It
   states the outage AND its repair, because a reader who is told only "the
   credential is broken" will not know to expect the numbers to change tonight,
   and a reader told only "it is fixed" will trust a zero that is still an
   outage. */
const AGG_ZERO_CAUSE =
  'Customer 360 aggregates Gmail through an OAuth2 credential that had stopped working: its consent screen was ' +
  'left in Testing, and Google expires a Testing app’s refresh token after seven days, so the job has been ' +
  'authenticating with a dead token and counting nothing. The app has since been published and the credential ' +
  're-authorised, so the cause is fixed — but a figure here is whatever the last aggregation run wrote. A 0 from ' +
  'a run older than that fix means “not counted”; it is not evidence that the customer never wrote to us. The ' +
  'message counts elsewhere on this screen come from communication_logs and were never affected.';

/* The same paragraph for the case the fix finally produced: a run that happened
   after the credential was repaired, reporting nothing. The outage still has to
   be told — a reader who remembers the warning needs to know why it is gone —
   but the conclusion is the opposite one, and burying that in the outage wording
   would leave a counted answer looking like a fault. */
const AGG_ZERO_COUNTED =
  'This is an answer, not a gap. Customer 360 aggregates Gmail through an OAuth2 credential that had stopped ' +
  'working: its consent screen was left in Testing, and Google expires a Testing app’s refresh token after ' +
  'seven days, so for days the job authenticated with a dead token and counted nothing. The app has since been ' +
  'published and the credential re-authorised, and the run behind the figures here finished after that repair — ' +
  'so the job could reach the mailbox and found nothing in it for this address. A 0 here means no mail, not no ' +
  'count. The message counts elsewhere on this screen come from communication_logs and were never affected.';

/* When the Gmail credential was repaired, in UTC. A profile written before this
   was written by a run that could not read Gmail at all, so its 0 counted
   nothing; a profile written after it was written by a run that could, so its 0
   is a real answer. Every touch count on this screen is decided by that
   comparison, which is the whole difference between an outage and a fact.

   As of 24 Aug 2026 this branch has a live case for the first time: Customer 360
   was re-run by hand at 19:46 UTC, after this timestamp, and the profile it
   wrote still reports 0 emails. That 0 now resolves to “counted, and it is
   none”, which is what the mailbox actually holds for that address.

   The value is written here, not read from the database — nothing in Supabase
   records when a credential was re-authorised — so it is stated as this screen's
   own assumption wherever it decides a number, and it is deliberately set
   earlier in the evening than the repair rather than later: erring early can
   only mislabel a run that straddles the fix, while erring late would call a
   genuinely counted zero an outage and hide a real answer behind a warning. */
const GMAIL_FIXED_AT = '2026-08-24T18:00:00Z';
const GMAIL_FIXED_MS = Date.parse(GMAIL_FIXED_AT);
const syncedAfterFix = ts => {
  const t = Date.parse(str(ts));
  return Number.isNaN(t) ? false : t >= GMAIL_FIXED_MS;
};

/* Which of the two paragraphs a given figure has earned, decided by the run that
   wrote it rather than by what is true tonight. */
const aggNote = syncedAt => (syncedAfterFix(syncedAt) ? AGG_ZERO_COUNTED : AGG_ZERO_CAUSE);

/* Where this screen's customers come from, and — just as important — where they
   do not. Both halves of the Bitrix position are stated, because "Bitrix is
   down" and "Bitrix is synced" are each half-true and both misleading. */
const BITRIX_NOTE =
  'Read from Supabase, never from Bitrix24. Bitrix’s crm.* read methods answer 403 on the dealership’s current ' +
  'plan, so no customer record on this screen came from Bitrix and none can. Writes into Bitrix do succeed — ' +
  'leads raised and updated by the workflows reach it — so this is a plan restriction on reading, not a broken ' +
  'integration, and nothing here reflects what Bitrix itself holds.';

/* Said wherever a purchase is shown, because the obvious next question is "which
   car?" and the honest answer is a string somebody typed. */
const NO_INVENTORY_LINK =
  'purchase_history stores the car as free text in `vehicle` and carries no reference to an inventory unit, so a ' +
  'purchase cannot be tied to a stock number. Which unit was sold, what it cost us and how long it sat are not ' +
  'answerable from here — and inventory records no sale date either, so they are not answerable from that side.';

/* A touch count is never rendered bare, and never as a number whose meaning
   depends on something the reader cannot see from where the number is. */
function touchCell(v, syncedAt) {
  const x = n0(v);
  if (x == null) return '<span class="t-muted">— not reported by the aggregation</span>';
  if (x > 0) return `<span class="num">${num(x)}</span>`;
  const when = ` title="Compared against ${esc(GMAIL_FIXED_AT)}, the recorded time the Gmail credential was re-authorised. That timestamp is written into this screen, not read from the database."`;
  if (syncedAfterFix(syncedAt)) {
    return `<span class="num">0</span> <span class="t-muted"${when}>· counted by a run that finished after the Gmail credential was fixed — a real zero, not a missing figure</span>`;
  }
  return str(syncedAt)
    ? `<span class="num">0</span> <span class="t-warm"${when}>· not counted — the run that wrote this finished before the Gmail credential was fixed</span>`
    : '<span class="num">0</span> <span class="t-warm">· not counted — this source carries no sync timestamp, so which run produced it is unknown</span>';
}

/* A rejected sub-fetch must reach the section that needed it rather than
   vanishing into an empty list that reads as "this customer has no purchases". */
const grab = promise => promise.then(rows => ({ rows }), e => ({ err: e.message }));
const val = r => (r.status === 'fulfilled' ? r.value : null);
const err = r => (r.status === 'rejected' ? (r.reason && r.reason.message) || 'Unknown error' : null);

/* ── The spine ───────────────────────────────────────────────────────────── */
/* One entry per customer, keyed on lower(email) exactly as the view is. Rows
   sharing an email collapse and the collapse is reported, never hidden. */
function spineFromDirectory(rows) {
  const map = new Map();
  rows.forEach((r, i) => {
    const email = str(r.email);
    const key = norm(email) || `dir:${i}`;
    const cur = map.get(key);
    if (cur) {
      cur.dupes++;
      if (!cur.name)  cur.name  = str(r.name);
      if (!cur.phone) cur.phone = str(r.phone);
      return;
    }
    map.set(key, {
      key, email,
      id: r.id == null ? '' : String(r.id),
      name: str(r.name),
      phone: str(r.phone),
      /* Kept as the view returned it. This screen reports the value and says
         whose it is; it does not decide what the view meant by it. */
      sourceRecords: r.source_records == null ? null : r.source_records,
      lastSeen: r.last_seen_at || null,
      dupes: 0,
    });
  });
  return map;
}

/* Used only when v_customer_directory cannot be read. The view is defined as
   leads UNION purchase_history keyed on lower(email), so this rebuilds exactly
   that from the two base tables rather than falling back to the aggregation
   outputs — falling back to those would put non-customers in the list again,
   which is the bug this screen was rewritten to remove. */
function spineFromSources(leads, purchases) {
  const map = new Map();
  const add = (email, name, phone, at) => {
    const key = norm(email);
    if (!key) return;
    const cur = map.get(key);
    if (cur) {
      if (!cur.name && name) cur.name = str(name);
      if (!cur.phone && phone) cur.phone = str(phone);
      if (at && (!cur.lastSeen || String(at) > String(cur.lastSeen))) cur.lastSeen = at;
      return;
    }
    map.set(key, { key, id: '', email: str(email), name: str(name), phone: str(phone),
                   sourceRecords: null, lastSeen: at || null, dupes: 0 });
  };
  /* leads.phone and purchase_history.phone both exist, so the rebuilt spine
     carries numbers too and the fallback is not a downgrade in reachability.
     purchase_history's name column is `customer_name`, not `name`. */
  (leads || []).forEach(l => add(l.email, l.name, l.phone, l.created_at));
  (purchases || []).forEach(p => add(p.email, p.customer_name, p.phone, p.purchase_date || p.created_at));
  return map;
}

const nameOf = c => c.name || (c.view && str(c.view.name)) || (c.profile && str(c.profile.name)) || c.email || 'Unnamed customer';

/* The phone, and where it was found. Five sources this screen reads carry one —
   v_customer_directory, v_customer_360, customer_360_profiles, purchase_history
   and whatsapp_contacts — so a customer with nothing here has no number anywhere
   the dashboard can see, which is a fact about this dealership's records and is
   said as one rather than left as a blank cell. */
function phoneOf(c) {
  if (str(c.phone)) return { phone: str(c.phone), from: 'v_customer_directory' };
  if (c.view && str(c.view.phone)) return { phone: str(c.view.phone), from: 'v_customer_360' };
  if (c.profile && str(c.profile.phone)) return { phone: str(c.profile.phone), from: 'customer_360_profiles' };
  const bought = (c.purchases || []).map(p => str(p.phone)).filter(Boolean)[0];
  if (bought) return { phone: bought, from: 'purchase_history' };
  const wa = (c.contacts || []).map(x => str(x.phone)).filter(Boolean)[0];
  if (wa) return { phone: wa, from: 'whatsapp_contacts' };
  return { phone: '', from: '' };
}
const phoneStr = c => phoneOf(c).phone;
const NO_PHONE_LONG =
  'No phone number on the v_customer_directory row, on v_customer_360, on the unified profile, on any purchase ' +
  'row or on any linked WhatsApp contact. This customer cannot be called from anything the dashboard reads.';

/* How a WhatsApp row is allowed to be labelled. Never the chat id — a LID
   handle contains no phone digits and is not a name. */
function contactLabel(c) {
  const push = str(c.push_name);
  if (push) return { name: push, basis: 'WhatsApp profile name — the name this person set on WhatsApp' };
  const phone = str(c.phone);
  if (phone) return { name: phone, basis: 'Phone number only — no profile name was captured' };
  return { name: '', basis: 'Unidentified — no profile name and no phone number was ever stored for this chat' };
}

SCREENS.customers = async host => {
  const strip = el('div', 'grid g5');
  strip.innerHTML = stateLoading(2);
  host.appendChild(strip);

  const noteHost = el('div');
  noteHost.style.marginTop = '16px';
  host.appendChild(noteHost);

  const grid = el('div', 'card flush');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = '340px minmax(0,1fr)';
  grid.style.minHeight = '620px';
  grid.innerHTML = stateLoading(6);
  host.appendChild(grid);

  const otherHost = el('div', 'card flush');
  otherHost.style.marginTop = '16px';
  otherHost.innerHTML = stateLoading(4);
  host.appendChild(otherHost);

  /* Every source is read independently. "The aggregation is down" and "the
     customer list is down" are different events and the screen stays useful
     under either, so nothing here is allowed to reject the whole render. */
  const [dirR, viewR, profR, waR, leadR, buyR] = await Promise.allSettled([
    db(`v_customer_directory?select=*&limit=${DIR_LIMIT}`),
    db(`v_customer_360?select=*&order=lifetime_value_aed.desc,lead_count.desc&limit=${VIEW_LIMIT}`),
    db(`customer_360_profiles?select=${PROFILE_COLS}&order=last_synced_at.desc.nullslast&limit=${PROFILE_LIMIT}`),
    db(`whatsapp_contacts?select=${CONTACT_COLS}&limit=${CONTACT_LIMIT}`),
    db(`leads?select=name,email,phone,created_at&limit=${SOURCE_LIMIT}`),
    db(`purchase_history?select=*&limit=${SOURCE_LIMIT}`),
  ]);

  const dirRows  = val(dirR),  dirErr  = err(dirR);
  const viewRows = val(viewR) || [], viewErr = err(viewR);
  const profiles = val(profR) || [], profErr = err(profR);
  const contacts = val(waR)   || [], waErr   = err(waR);
  const leadRows = val(leadR), leadErr = err(leadR);
  const buyRows  = val(buyR),  buyErr  = err(buyR);

  /* ── Build the customer list ───────────────────────────────────────────── */
  let spine = null, spineSource = '', spineNote = '';
  if (dirRows) {
    spine = spineFromDirectory(dirRows);
    spineSource = 'v_customer_directory';
    spineNote = 'A row exists here for every address with a lead or a purchase behind it.';
  } else if (leadRows || buyRows) {
    spine = spineFromSources(leadRows, buyRows);
    spineSource = 'leads + purchase_history';
    spineNote = 'Rebuilt from the two tables v_customer_directory is defined over, because the view itself could not be read.';
  }

  const customers = spine ? [...spine.values()] : [];
  customers.forEach(c => { c.view = null; c.profile = null; c.contacts = []; c.leads = []; c.purchases = []; });

  /* ── Hang the enrichment off it. None of this may create a customer. ───── */
  const others = new Map();
  const other = (key, seed) => {
    let o = others.get(key);
    if (!o) { o = { key, name: '', email: '', phone: '', chatId: '', basis: '', sources: new Set(), messages: null, lastSeen: null }; others.set(key, o); }
    if (seed) Object.keys(seed).forEach(k => { if (seed[k] && !o[k]) o[k] = seed[k]; });
    return o;
  };

  viewRows.forEach((r, i) => {
    const key = norm(r.email) || `view:${i}`;
    const hit = spine && spine.get(key);
    if (hit) { if (!hit.view) hit.view = r; return; }
    const o = other(key, { name: str(r.name), email: str(r.email), phone: str(r.phone) });
    o.sources.add('v_customer_360');
    if (!o.basis) o.basis = 'In v_customer_360 but with no lead and no purchase behind the address, so the directory does not carry it.';
  });

  profiles.forEach((p, i) => {
    const key = norm(p.email) || `profile:${i}`;
    const hit = spine && spine.get(key);
    if (hit) { if (!hit.profile) hit.profile = p; return; }
    const o = other(key, { name: str(p.name), email: str(p.email), phone: str(p.phone) });
    o.sources.add('customer_360_profiles');
    if (!o.basis) o.basis = 'The nightly aggregation wrote a profile for this address, but there is no lead and no purchase behind it.';
  });

  contacts.forEach((w, i) => {
    const linked = norm(w.lead_email);
    const hit = linked && spine ? spine.get(linked) : null;
    if (hit) { hit.contacts.push(w); return; }
    const key = linked || norm(w.chat_id) || `wa:${i}`;
    const lab = contactLabel(w);
    const o = other(key, { name: lab.name, email: str(w.lead_email), phone: str(w.phone), chatId: str(w.chat_id) });
    o.sources.add('whatsapp_contacts');
    o.basis = 'Messaged this WhatsApp number. There is no lead and no purchase for them, so they are not a customer.';
    o.idBasis = lab.basis;
    const m = n0(w.message_count);
    if (m != null) o.messages = (o.messages || 0) + m;
    if (w.last_seen && (!o.lastSeen || String(w.last_seen) > String(o.lastSeen))) o.lastSeen = w.last_seen;
  });

  (leadRows || []).forEach(l => { const hit = spine && spine.get(norm(l.email)); if (hit) hit.leads.push(l); });
  (buyRows  || []).forEach(p => { const hit = spine && spine.get(norm(p.email)); if (hit) hit.purchases.push(p); });

  const buyers  = buyRows ? customers.filter(c => c.purchases.length).length : null;
  const purchaseRows = buyRows ? customers.reduce((a, c) => a + c.purchases.length, 0) : null;
  const purchaseValue = (() => {
    if (!buyRows) return null;
    const vals = customers.flatMap(c => c.purchases.map(p => n0(p.amount_aed))).filter(v => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  })();
  const withProfile = customers.filter(c => c.profile).length;
  /* A profile row that belongs to nobody in the directory is the aggregation
     having built a "customer" out of somebody who never was one. Counted and
     stated next to the total rather than quietly averaged away. */
  const orphanProfiles = spine ? profiles.filter(p => !spine.get(norm(p.email))).length : null;
  const otherList = [...others.values()];
  const linkedContacts = customers.reduce((a, c) => a + c.contacts.length, 0);
  const collapsed = customers.reduce((a, c) => a + c.dupes, 0);
  /* Counted after every source has been hung off the spine, so it is the number
     of customers this dealership genuinely cannot phone, not the number missing
     one particular column. */
  const withPhone = customers.filter(c => phoneStr(c)).length;
  const noPhone = customers.length - withPhone;
  /* Both base tables are read with a limit. If a read came back full, rows were
     almost certainly left behind, so anything counted per-customer off it is a
     floor rather than a total and is never printed as a total. */
  const leadsCapped = !!leadRows && leadRows.length >= SOURCE_LIMIT;
  const buysCapped  = !!buyRows  && buyRows.length  >= SOURCE_LIMIT;

  /* ── Aggregation health ────────────────────────────────────────────────── */
  const synced = profiles.map(p => p.last_synced_at).filter(Boolean).sort();
  const newest = synced.length ? synced[synced.length - 1] : null;
  const oldest = synced.length ? synced[0] : null;
  const reported = profiles.map(p => ({ e: n0(p.total_emails), s: n0(p.total_slack_messages) }));
  const anyTouch = reported.some(r => (r.e || 0) > 0 || (r.s || 0) > 0);
  const zeroProfiles = reported.filter(r => (r.e || 0) === 0 && (r.s || 0) === 0).length;
  /* The question every zero on this screen turns on: has the aggregation run at
     all since the Gmail credential was repaired? Until it has, none of these
     numbers has been collected by a job that could reach the mailbox. */
  const postFix = profiles.filter(p => syncedAfterFix(p.last_synced_at)).length;
  const noStamp = profiles.filter(p => !str(p.last_synced_at)).length;

  /* ── KPI strip ─────────────────────────────────────────────────────────── */
  if (!spine) {
    strip.style.display = 'block';
    strip.innerHTML = stateError('the customer list', dirErr || leadErr || buyErr || 'Unknown error');
  } else {
    strip.innerHTML = [
      kpi('Customers', num(customers.length),
        `<span class="t-muted">${esc(spineSource)} · a lead or a purchase on file</span>
         <div>${noPhone
            ? `<span class="t-warm">${num(noPhone)} with no phone number on any source</span>`
            : customers.length === 1
              ? '<span class="t-ok">The one customer on file has a phone number</span>'
              : `<span class="t-ok">All ${num(withPhone)} reachable by phone</span>`}</div>`),
      kpi('Recorded purchase value', aed(purchaseValue),
        buyErr
          ? '<span class="t-warm">purchase_history could not be read</span>'
          : purchaseRows
            ? `<span class="t-muted">amount_aed summed over ${num(purchaseRows)} purchase row${purchaseRows === 1 ? '' : 's'} from ${num(buyers)} customer${buyers === 1 ? '' : 's'}</span>${buysCapped
                ? `<div><span class="t-warm">purchase_history came back at the ${num(SOURCE_LIMIT)}-row read limit, so this is a floor, not the total</span></div>`
                : ''}`
            : '<span class="t-muted">No purchase recorded against any customer</span>'),
      kpi('Contacts who are not customers', waErr && !otherList.length ? '—' : num(otherList.length),
        waErr
          ? '<span class="t-warm">whatsapp_contacts could not be read, so this is incomplete</span>'
          : `<span class="t-muted">${num(contacts.length)} whatsapp_contacts row${contacts.length === 1 ? '' : 's'} read · ${num(linkedContacts)} linked to a customer</span>`
            + (otherList.length
                ? ''
                /* Worth saying out loud rather than leaving as a bare 0: the 136
                   messages from the owner's personal phone book that used to
                   fill this list were deleted, and this is the count that proves
                   none of them is being carried as a customer. */
                : '<div><span class="t-ok">Nobody in the messaging or aggregation tables is being presented as a customer</span></div>')),
      kpi('Unified profiles', profErr ? '—' : num(profiles.length),
        profErr
          ? '<span class="t-warm">customer_360_profiles could not be read</span>'
          : `<span class="t-muted">${num(withProfile)} of ${num(customers.length)} customer${customers.length === 1 ? '' : 's'} ${withProfile === 1 ? 'has' : 'have'} one${orphanProfiles ? ` · ${num(orphanProfiles)} belong${orphanProfiles === 1 ? 's' : ''} to somebody who is not a customer` : ''}</span>`),
      kpi('Last aggregation run', profErr ? '—' : ago(newest),
        profErr
          ? '<span class="t-warm">Unknown — the profile table could not be read</span>'
          : newest
            ? `<span class="t-muted">Newest last_synced_at${oldest && oldest !== newest ? ` · oldest ${esc(ago(oldest))}` : ''}</span>
               <div>${syncedAfterFix(newest)
                  ? `<span class="t-ok">Ran after the Gmail credential was fixed${anyTouch ? '' : ', so the zeros below were counted'}</span>`
                  : `<span class="t-warm">No run since the Gmail credential was fixed</span>`}</div>`
            : '<span class="t-muted">No profile carries a last_synced_at value, so when this last ran is not knowable</span>'),
    ].join('');
  }

  /* ── Banners. Each one names the exact source that is missing or wrong. ── */
  const notes = [];
  if (dirErr && spine) {
    notes.push(`<div class="banner warm"><span class="material-symbols-outlined">warning</span>
      <div>v_customer_directory could not be read (${esc(dirErr)}), so this list was rebuilt from leads and
      purchase_history — the two tables that view is defined over. It should match, but it has not been
      confirmed against the view. Nothing from the aggregation tables was used to fill the gap.</div></div>`);
  }
  if (profErr) {
    notes.push(`<div class="banner warm"><span class="material-symbols-outlined">warning</span>
      <div>customer_360_profiles could not be read (${esc(profErr)}), so no email or Slack touch counts and no
      sync times are shown. Identity, leads, purchases and messages below are read live and are current.</div></div>`);
  } else if (profiles.length && !anyTouch) {
    /* Three different sentences, and which one is true is decided by
       last_synced_at against GMAIL_FIXED_AT — never by the fact that the number
       is zero. Every profile counted after the repair is the case this branch
       waited days for: the figure is zero because the mailbox is empty, so it is
       reported as an answer, in the neutral banner, and the warning is withdrawn
       rather than left standing over a number that no longer deserves it. */
    const allPostFix = postFix === profiles.length;
    notes.push(`<div class="banner ${allPostFix ? 'info' : postFix ? 'warm' : 'hot'}">
      <span class="material-symbols-outlined">${allPostFix ? 'mark_email_read' : 'sync_problem'}</span>
      <div><strong>${allPostFix
        ? 'Every email and Slack touch count on this screen is zero — and this time it was counted.'
        : postFix
          ? 'Every email and Slack touch count on this screen is zero.'
          : 'Email and Slack touch counts have not been collected — read every 0 on this screen as “not counted”.'}</strong>
      ${profiles.length === 1
        ? 'The one profile the nightly Customer 360 job has written reports'
        : `All ${esc(String(profiles.length))} profiles written by the nightly Customer 360 job report`}
      0 emails and 0 Slack messages.
      ${allPostFix
        ? `${esc(AGG_ZERO_COUNTED)} The mailbox is genuinely empty for ${profiles.length === 1 ? 'this address' : 'these addresses'};
           nothing here is waiting on another run.`
        : `${esc(AGG_ZERO_CAUSE)} ${postFix
            ? `<strong>${esc(String(postFix))} of ${esc(String(profiles.length))}</strong> ${postFix === 1 ? 'was' : 'were'}
               synced after the fix and still report zero, so ${postFix === 1 ? 'that one is a counted zero' : 'those are counted zeros'};
               the ${esc(String(profiles.length - postFix))} written before it ${profiles.length - postFix === 1 ? 'is' : 'are'} not evidence of anything yet.`
            : 'No profile has been synced since the fix, so nothing here has been counted by a job that could reach the mailbox. The next run is what will make these figures mean anything.'}`}
      ${noStamp ? `${esc(String(noStamp))} profile${noStamp === 1 ? ' carries' : 's carry'} no last_synced_at at all, so which run wrote ${noStamp === 1 ? 'it' : 'them'} is unknown.` : ''}</div></div>`);
  } else if (zeroProfiles) {
    notes.push(`<div class="banner warm"><span class="material-symbols-outlined">sync_problem</span>
      <div>${esc(String(zeroProfiles))} of ${esc(String(profiles.length))} profiles report 0 emails and 0 Slack
      messages, while others report figures — so the aggregation is collecting for some customers and not for
      others. ${esc(AGG_ZERO_CAUSE)} Each profile below says which run wrote its numbers.</div></div>`);
  } else if (!profiles.length) {
    notes.push(`<div class="banner info"><span class="material-symbols-outlined">schedule</span>
      <div>The nightly Customer 360 aggregation has not written a single profile row, so there are no email or
      Slack touch counts anywhere on this screen. Everything else is read live.</div></div>`);
  }
  if (viewErr) {
    notes.push(`<div class="banner warm"><span class="material-symbols-outlined">warning</span>
      <div>v_customer_360 could not be read (${esc(viewErr)}), so no lifetime value, VIP flag or aggregate count
      comes from it. Where the same figure can be rebuilt from a table this screen reads directly — leads,
      purchase_history, communication_logs — the detail pane does that and says so on the figure itself; where it
      cannot, it shows an em dash rather than a guess. The customer list itself is unaffected.</div></div>`);
  }
  noteHost.innerHTML = notes.join('');

  /* ── Customer list ─────────────────────────────────────────────────────── */
  if (!spine) {
    grid.style.display = 'block';
    grid.innerHTML = stateError('customers', dirErr || leadErr || buyErr || 'Unknown error');
  } else if (!customers.length) {
    grid.style.display = 'block';
    grid.innerHTML = stateEmpty(
      'No customers yet',
      `${spineSource} returned no rows. A person appears here as soon as a lead or a purchase is recorded ` +
      'against their email address. Somebody messaging the WhatsApp number does not make them a customer, ' +
      'and contacts who have only done that are listed further down this page.',
      'contacts');
  } else {
    renderList();
  }

  function renderList() {
    grid.innerHTML = `
      <div style="border-right:1px solid var(--border);display:flex;flex-direction:column;min-width:0">
        <div class="toolbar">
          <div class="grow">
            <label class="sr-only" for="cq">Search customers</label>
            <input type="search" id="cq" placeholder="Search name, email or phone" />
          </div>
        </div>
        <div class="toolbar" style="padding-top:0">
          <div class="seg" id="cSeg" role="group" aria-label="Filter customers">
            <button type="button" data-f="all" class="on" aria-pressed="true">All ${num(customers.length)}</button>
            <button type="button" data-f="buyers" aria-pressed="false" ${buyErr || !buyers ? 'disabled' : ''}
              title="${buyErr
                ? esc('purchase_history could not be read (' + buyErr + '), so buyers cannot be separated from enquiries.')
                : buyers ? 'Customers with at least one row in purchase_history.'
                         : 'No customer has a purchase recorded, so this filter would come back empty.'}">Buyers ${buyErr ? '—' : num(buyers)}</button>
            <button type="button" data-f="enquiry" aria-pressed="false" ${buyErr || customers.length === buyers ? 'disabled' : ''}
              title="${buyErr
                ? esc('purchase_history could not be read (' + buyErr + '), so buyers cannot be separated from enquiries.')
                : customers.length === buyers ? 'Every customer on file has bought, so this filter would come back empty.'
                                              : 'Customers with a lead on file but no purchase recorded.'}">Enquiries ${buyErr ? '—' : num(customers.length - buyers)}</button>
            <button type="button" data-f="nophone" aria-pressed="false" ${noPhone ? '' : 'disabled'}
              title="${esc(noPhone ? 'Customers with no phone number on v_customer_directory, v_customer_360, customer_360_profiles, purchase_history or whatsapp_contacts — nothing the dashboard reads can call them.' : 'Every customer has a phone number on at least one source, so there is nothing to filter to.')}">No phone ${num(noPhone)}</button>
          </div>
          <button class="btn sm" disabled title="${esc(NO_SYNC_HOOK)}">Re-run sync</button>
        </div>
        <div id="custList" style="overflow-y:auto;flex:1"></div>
        <div class="cell-sub" style="padding:12px 20px;border-top:1px solid var(--border-subtle);white-space:normal">
          ${esc(BITRIX_NOTE)}
        </div>
      </div>
      <div id="custPane" style="overflow-y:auto;min-width:0"></div>`;
  }

  let q = '', filter = 'all', selected = null;

  const visible = () => customers.filter(c => {
    if (filter === 'buyers' && !c.purchases.length) return false;
    if (filter === 'enquiry' && c.purchases.length) return false;
    if (filter === 'nophone' && phoneStr(c)) return false;
    if (!q) return true;
    return `${nameOf(c)} ${c.email} ${phoneStr(c)}`.toLowerCase().includes(q);
  }).sort((a, b) => {
    const av = n0(a.view && a.view.lifetime_value_aed) || 0;
    const bv = n0(b.view && b.view.lifetime_value_aed) || 0;
    if (av !== bv) return bv - av;
    return nameOf(a).localeCompare(nameOf(b));
  });

  function drawList() {
    const rows = visible();
    const foot = collapsed
      ? `<div class="list-item" style="cursor:default;align-items:flex-start">
           <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
           <div class="cell-sub" style="white-space:normal">${esc(String(collapsed))} further
           ${collapsed === 1 ? 'row' : 'rows'} from ${esc(spineSource)} shared an email address with a customer
           above and ${collapsed === 1 ? 'was' : 'were'} collapsed into it, because leads, purchases and messages
           are all keyed on email.</div>
         </div>`
      : '';

    $('custList').innerHTML = (rows.length
      ? rows.map(c => {
          const ltv = n0(c.view && c.view.lifetime_value_aed);
          const basis = buyErr
            ? '<span class="t-warm">purchase state unknown</span>'
            : c.purchases.length
              ? `${esc(String(c.purchases.length))} purchase${c.purchases.length === 1 ? '' : 's'}`
              : leadErr || leadsCapped
                ? '<span class="t-muted">no purchase on file</span>'
                : `<span class="t-muted">${esc(String(c.leads.length))} enquir${c.leads.length === 1 ? 'y' : 'ies'}, no purchase</span>`;
          const ph = phoneOf(c);
          return `<div class="list-item${c.key === selected ? ' on' : ''}" role="button" tabindex="0" data-k="${esc(c.key)}">
            <div class="avatar">${esc(initials(nameOf(c)))}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nameOf(c))}
                ${c.view && c.view.is_vip
                  ? '<span class="pill vip" title="is_vip is set on this customer’s v_customer_360 row. The view decides the rule; this screen does not know what it is."><span class="dot"></span>VIP</span>'
                  : ''}</div>
              <div class="cell-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ph.phone
                ? `<span class="mono" title="${esc('From ' + ph.from)}">${esc(ph.phone)}</span>`
                : '<span class="t-warm">No phone on any source</span>'}
                · ${esc(c.email || 'No email on the directory row')}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div class="cell-sub num">${ltv == null ? '' : aed(ltv)}</div>
              <div class="cell-sub">${basis}</div>
            </div>
          </div>`;
        }).join('')
      : stateEmpty('No match', 'No customer matches this search and filter.', 'search_off')) + foot;

    $('custList').querySelectorAll('[data-k]').forEach(n => {
      const openIt = () => open(n.dataset.k);
      n.addEventListener('click', openIt);
      n.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt(); }
      });
    });
  }

  /* ── Detail pane ──────────────────────────────────────────────────────── */
  async function open(key) {
    const c = customers.find(x => x.key === key);
    if (!c) return;
    selected = key;
    $('custList').querySelectorAll('[data-k]').forEach(n => n.classList.toggle('on', n.dataset.k === key));

    const pane = $('custPane');
    pane.innerHTML = stateLoading(5);
    const email = c.email;
    const qs = email ? encodeURIComponent(email) : null;

    /* Every linked read keys on email. A directory row without one is listed but
       cannot be cross-referenced, and saying so is the only honest option. */
    const [leads, purch, comms] = email
      ? await Promise.all([
          grab(db(`leads?select=id,name,phone,status,ai_score,vehicle_interest,budget_aed,source,created_at&email=ilike.${qs}&order=created_at.desc`)),
          grab(db(`purchase_history?select=*&email=ilike.${qs}&order=purchase_date.desc`)),
          grab(db(`communication_logs?select=channel,direction,message,created_at&lead_email=ilike.${qs}&order=created_at.desc&limit=${MSG_LIMIT}`)),
        ])
      : [{ rows: null }, { rows: null }, { rows: null }];

    /* Guard against a slower earlier click landing after a newer one. */
    if (selected !== key) return;

    const v = c.view || {};
    const noEmailNote = '<div class="cell-sub" style="margin-top:8px">This directory row carries no email address, and leads, purchases and messages are all keyed on email — so none of them can be matched to it.</div>';
    const section = (title, res, empty, body) => {
      if (res.err) return `<div class="section"><div class="label-caps">${esc(title)}</div>${stateError(title.toLowerCase(), res.err, 'x')}</div>`;
      if (res.rows == null) return `<div class="section"><div class="label-caps">${esc(title)}</div>${noEmailNote}</div>`;
      if (!res.rows.length) return `<div class="section"><div class="label-caps">${esc(title)}</div><div class="cell-sub" style="margin-top:8px">${esc(empty)}</div></div>`;
      return `<div class="section"><div class="label-caps">${esc(title)}</div>${body(res.rows)}</div>`;
    };

    const ph = phoneOf(c);

    /* "The view has no row for this person" and "the view has a row and left
       that column null" are different facts and lead to different next steps.
       Every substitution below names the one that actually happened. */
    const viewGap = c.view
      ? 'v_customer_360 has a row for this customer but no value in that column'
      : 'v_customer_360 has no row for this customer';

    /* v_customer_360 is the preferred source for these three because it counts
       across everything, not just the capped page just read. When it has no row
       for this customer the same figure is derived from the rows that were read,
       and the substitution is named — an operator who cannot tell which of the
       two produced a number cannot tell how much to trust it. */
    const viewLeads = n0(v.lead_count);
    const leadCount = viewLeads != null ? viewLeads : (leads.rows ? leads.rows.length : null);
    const leadSub = viewLeads != null
      ? (v.latest_status ? pill(v.latest_status) : '<span class="t-muted">No status on the latest lead</span>')
      : leads.rows
        ? `<span class="t-warm">Counted from the leads table — ${esc(viewGap)}</span>`
        : leads.err
          ? '<span class="t-warm">Neither v_customer_360 nor the leads table could be read</span>'
          : '<span class="t-muted">Not countable — this directory row has no email to match on</span>';

    const viewScore = n0(v.best_ai_score);
    const leadScores = (leads.rows || []).map(l => n0(l.ai_score)).filter(x => x != null);
    const bestScore = viewScore != null ? viewScore : (leadScores.length ? Math.max(...leadScores) : null);
    const scoreSub = viewScore != null
      ? (leadCount === 1
          /* A maximum over one row is that row. Calling it "highest across their
             leads" dresses a single score up as a comparison. */
          ? '<span class="t-muted">The score on their only lead · v_customer_360</span>'
          : '<span class="t-muted">Highest score across this customer’s leads · v_customer_360</span>')
      : leadScores.length
        ? `<span class="t-warm">${leadScores.length === 1 ? 'The ai_score on the one lead read here' : 'Highest ai_score on the leads read here'} — ${esc(viewGap)}</span>`
        : '<span class="t-muted">No lead of this customer’s carries an ai_score</span>';

    const viewMsgs = n0(v.message_count);
    const commCount = comms.rows ? comms.rows.length : null;
    const msgValue = viewMsgs != null ? viewMsgs : commCount;
    const msgSub = viewMsgs != null
      ? (v.last_contact_at
          ? `<span class="t-muted">Last contact ${esc(ago(v.last_contact_at))} · v_customer_360</span>`
          : '<span class="t-muted">No last-contact timestamp in v_customer_360</span>')
      : commCount == null
        ? '<span class="t-muted">Not countable — communication_logs is keyed on email and this row has none</span>'
        : commCount >= MSG_LIMIT
          ? `<span class="t-warm">At least ${esc(String(MSG_LIMIT))} — this read is capped and ${esc(viewGap)}</span>`
          : `<span class="t-warm">Counted from communication_logs — ${esc(viewGap)}</span>`;

    const purchTotal = purch.rows && purch.rows.length
      ? (() => { const xs = purch.rows.map(x => n0(x.amount_aed)).filter(x => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) : null; })()
      : null;

    /* Lifetime value comes from v_customer_360. When that view has no row for
       this customer the purchase rows just read are summed instead, and the
       substitution is stated — a figure the operator cannot trace is worse than
       no figure at all. */
    const ltvFromView = n0(v.lifetime_value_aed);
    const ltvValue = ltvFromView != null ? ltvFromView : purchTotal;
    const ltvSub = ltvFromView != null
      ? (n0(v.purchase_count) == null
          ? '<span class="t-muted">From v_customer_360</span>'
          : `<span class="t-muted">From v_customer_360 · ${num(v.purchase_count)} purchase${Number(v.purchase_count) === 1 ? '' : 's'}</span>`)
      : purchTotal != null
        ? `<span class="t-warm">Summed from purchase_history — ${esc(viewGap)}</span>`
        : `<span class="t-muted">No purchase amount recorded, and ${esc(viewGap.replace('that column', 'lifetime_value_aed'))}</span>`;

    const waHtml = waErr
      ? `<div class="cell-sub" style="margin-top:8px;white-space:normal">whatsapp_contacts could not be read (${esc(waErr)}), so any WhatsApp channel for this customer cannot be shown.</div>`
      : c.contacts.length
        ? `<div style="margin-top:8px">${c.contacts.map(w => {
            const lab = contactLabel(w);
            return `<div class="list-item" style="cursor:default;align-items:flex-start">
              <span class="material-symbols-outlined t-muted" style="font-size:18px">chat</span>
              <div style="flex:1;min-width:0">
                <div style="font-weight:500">${lab.name ? esc(lab.name) : '<span class="t-muted">No name captured on this chat</span>'}</div>
                <div class="cell-sub" style="white-space:normal">${esc(lab.basis)} · linked to this customer by lead_email.</div>
                <div class="cell-sub mono" style="word-break:break-all">${esc(str(w.chat_id) || 'no chat id')}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div class="cell-sub">${str(w.phone) ? `<span class="mono">${esc(str(w.phone))}</span>` : '<span class="t-muted">no phone stored</span>'}</div>
                <div class="cell-sub">${n0(w.message_count) == null ? '' : num(w.message_count) + ' msgs'} · ${esc(ago(w.last_seen))}</div>
              </div>
            </div>`;
          }).join('')}</div>`
        : '<div class="cell-sub" style="margin-top:8px;white-space:normal">No whatsapp_contacts row is linked to this email. Most of the WhatsApp contacts in this system are not customers, so the absence of one here is normal.</div>';

    pane.innerHTML = `
      <div class="card-head">
        <div class="avatar" style="width:40px;height:40px;font-size:14px">${esc(initials(nameOf(c)))}</div>
        <div style="flex:1;min-width:0">
          <div class="card-title">${esc(nameOf(c))}
            ${v.is_vip ? '<span class="pill vip" title="is_vip is set on this customer’s v_customer_360 row. The view decides the rule; this screen does not know what it is."><span class="dot"></span>VIP</span>' : ''}
            ${buyErr ? '' : c.purchases.length ? pill('Buyer', 'ok') : '<span class="chip">Enquiry — no purchase on file</span>'}</div>
          <div class="card-sub">${ph.phone
            ? `<span class="mono">${esc(ph.phone)}</span> <span class="t-muted">· ${esc(ph.from)}</span>`
            : '<span class="t-warm">No phone number on any source</span>'}
            · ${esc(c.email || 'No email on the directory row')}</div>
        </div>
        ${leads.rows && leads.rows.length ? '<button class="btn sm" data-act="leads">Open in Leads</button>' : ''}
      </div>
      <div style="padding:20px">
        <div class="grid g4">
          ${kpi('Lifetime value', aed(ltvValue), ltvSub)}
          ${kpi('Leads', num(leadCount), leadSub)}
          ${kpi('Best AI score', num(bestScore), scoreSub)}
          ${kpi('Messages logged', num(msgValue), msgSub)}
        </div>

        <div class="section" style="margin-top:24px">
          <div class="label-caps">Why this person is a customer</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Directory</dt><dd>${dirErr
              ? '<span class="t-warm">Rebuilt from leads and purchase_history — v_customer_directory could not be read</span>'
              : 'In v_customer_directory <span class="t-ok">· leads UNION purchase_history</span>'}</dd>
            <dt>Leads on file</dt><dd>${leads.err
              ? `<span class="t-warm">Could not be read — ${esc(leads.err)}</span>`
              : leads.rows == null
                ? '<span class="t-muted">Cannot be matched without an email address</span>'
                : esc(String(leads.rows.length))}</dd>
            <dt>Purchases on file</dt><dd>${purch.err
              ? `<span class="t-warm">Could not be read — ${esc(purch.err)}</span>`
              : purch.rows == null
                ? '<span class="t-muted">Cannot be matched without an email address</span>'
                : esc(String(purch.rows.length))}</dd>
            <dt>Directory row</dt><dd>${c.id
              ? `<span class="mono">${esc(c.id)}</span> <span class="cell-sub">· v_customer_directory.id</span>`
              : '<span class="t-muted">Rebuilt from leads and purchase_history — there is no directory row behind it</span>'}</dd>
            <dt>Underlying records</dt><dd>${dirErr
              ? '<span class="t-muted">Not available — the view that reports it could not be read</span>'
              : c.sourceRecords == null
                ? '<span class="t-muted">v_customer_directory returned no source_records value for this address</span>'
                : n0(c.sourceRecords) != null
                  ? `${num(c.sourceRecords)} <span class="cell-sub">source_records, as v_customer_directory counts them</span>`
                  : `<span class="mono">${esc(String(c.sourceRecords))}</span> <span class="cell-sub">source_records, exactly as v_customer_directory reports it</span>`}</dd>
            <dt>Last seen</dt><dd>${c.lastSeen
              ? `${esc(ago(c.lastSeen))} <span class="cell-sub">· the newest last_seen_at on this address</span>`
              : '<span class="t-muted">No last_seen_at on this row</span>'}</dd>
            <dt>Email key</dt><dd class="mono" style="word-break:break-all">${esc(c.email || '—')}</dd>
            <dt>Phone</dt><dd>${ph.phone
              ? `<span class="mono">${esc(ph.phone)}</span> <span class="cell-sub">· found on ${esc(ph.from)}</span>`
              : `<span class="t-warm">Not recorded</span>
                 <div class="cell-sub" style="white-space:normal">${esc(NO_PHONE_LONG)}</div>`}</dd>
            <dt>Source system</dt><dd>Supabase <span class="t-muted">· not Bitrix24</span>
              <div class="cell-sub" style="white-space:normal">${esc(BITRIX_NOTE)}</div></dd>
          </dl>
        </div>

        <div class="section">
          <div class="label-caps">WhatsApp channel</div>
          ${waHtml}
        </div>

        <div class="section">
          <div class="label-caps">Unified profile · customer_360_profiles</div>
          ${profErr
            ? `<div class="cell-sub" style="margin-top:8px;white-space:normal">The profile table could not be read (${esc(profErr)}).</div>`
            : c.profile
              ? `<dl class="kv" style="margin-top:8px">
                   <dt>Customer ID</dt><dd class="mono">${esc(c.profile.customer_id == null ? '—' : String(c.profile.customer_id))}</dd>
                   <dt>Email touches</dt><dd>${touchCell(c.profile.total_emails, c.profile.last_synced_at)}</dd>
                   <dt>Slack messages</dt><dd>${touchCell(c.profile.total_slack_messages, c.profile.last_synced_at)}</dd>
                   <dt>Last synced</dt><dd>${esc(ago(c.profile.last_synced_at))}${c.profile.last_synced_at
                     ? ` <span class="cell-sub">· ${syncedAfterFix(c.profile.last_synced_at)
                          ? 'after the Gmail credential was fixed'
                          : 'before the Gmail credential was fixed'}</span>`
                     : ' <span class="t-muted">(the row exists but carries no timestamp, so which run wrote it is unknown)</span>'}</dd>
                   <dt>Name on profile</dt><dd>${esc(str(c.profile.name) || '—')}</dd>
                   <dt>Phone on profile</dt><dd>${str(c.profile.phone)
                     ? `<span class="mono">${esc(str(c.profile.phone))}</span>`
                     : '<span class="t-muted">None on this profile row</span>'}</dd>
                 </dl>
                 <div class="cell-sub" style="margin-top:10px;white-space:normal">${esc(aggNote(c.profile.last_synced_at))}</div>`
              : (n0(v.total_emails) != null || n0(v.total_slack_messages) != null)
                ? `<div class="cell-sub" style="white-space:normal">The nightly job has written no customer_360_profiles row for this customer.
                     v_customer_360 carries the same two counters for them and they are shown here — but that view records no sync
                     timestamp, so when these were collected, and therefore whether they predate the Gmail fix, cannot be told from it.</div>
                   <dl class="kv" style="margin-top:8px">
                     <dt>Email touches</dt><dd>${touchCell(v.total_emails, null)}</dd>
                     <dt>Slack messages</dt><dd>${touchCell(v.total_slack_messages, null)}</dd>
                   </dl>
                   <div class="cell-sub" style="margin-top:10px;white-space:normal">${esc(AGG_ZERO_CAUSE)}</div>`
                : noSource('The nightly Customer 360 aggregation has not written a row for this customer, and v_customer_360 reports no touch counts for them either, so there are no email or Slack figures to show and no last_synced_at. Identity, phone, leads, purchases and logged messages on this screen are read live and are current.')}
        </div>

        ${section('Purchase history', purch, 'No purchase recorded for this customer.', rows => `
          ${rows.map(x => {
            const vehicle = str(x.vehicle);
            const rowPhone = str(x.phone);
            return `<div class="quote" style="margin-top:8px">
              <strong>${vehicle
                ? esc(vehicle)
                : '<span class="t-muted">No vehicle recorded on this purchase</span>'}</strong>${n0(x.amount_aed) == null ? '' : ' · ' + aed(x.amount_aed)}
              <div class="cell-sub">${x.purchase_date
                ? `${esc(str(x.purchase_date))} · ${esc(ago(x.purchase_date))}`
                : 'No purchase date recorded'}${x.deal_id ? ` · deal ${esc(String(x.deal_id))}` : ''}</div>
              <div class="cell-sub">Recorded as ${esc(str(x.customer_name) || nameOf(c))} ·
                ${rowPhone
                  ? `<span class="mono">${esc(rowPhone)}</span>`
                  : '<span class="t-muted">no phone on this purchase row</span>'}</div>
            </div>`;
          }).join('')}
          ${purchTotal == null ? '' : `<div class="cell-sub num" style="margin-top:10px">${esc(String(rows.length))} purchase${rows.length === 1 ? '' : 's'} · ${aed(purchTotal)} total</div>`}
          <div class="cell-sub" style="margin-top:10px;white-space:normal">${esc(NO_INVENTORY_LINK)}</div>`)}

        ${section('Leads', leads, 'No lead recorded for this customer.', rows => `
          <div class="timeline" style="margin-top:8px">${rows.map(l => `
            <div class="tl-item"><span class="tl-dot" style="background:var(--${tone(l.status) || 'neutral'})"></span>
              <div class="tl-body">
                <div class="tl-meta">${esc(ago(l.created_at))}${l.source ? ' · ' + esc(l.source) : ''}${n0(l.ai_score) == null ? '' : ' · score ' + num(l.ai_score)}
                  · ${str(l.phone)
                       ? `<span class="mono">${esc(str(l.phone))}</span>`
                       : '<span class="t-muted">no phone on this lead</span>'}</div>
                <div>${esc(str(l.vehicle_interest) || 'No vehicle recorded')} ${pill(l.status || 'NEW')}</div>
                ${n0(l.budget_aed) == null ? '' : `<div class="cell-sub">Budget ${aed(l.budget_aed)}</div>`}
              </div></div>`).join('')}</div>`)}

        ${section('Recent messages', comms, 'No message logged for this customer.', rows => `
          <div class="timeline" style="margin-top:8px">${rows.slice(0, 10).map(m => `
            <div class="tl-item"><span class="tl-dot"></span><div class="tl-body">
              <div class="tl-meta"><span class="chip">${esc(str(m.channel) || 'unknown channel')}</span> ${esc(str(m.direction))} · ${esc(ago(m.created_at))}</div>
              <div style="white-space:pre-wrap">${esc(String(m.message || '').slice(0, 240))}</div></div></div>`).join('')}</div>
          <div class="cell-sub" style="margin-top:10px;white-space:normal">${rows.length > 10 ? `Showing the newest 10 of ${esc(String(rows.length))} messages read${rows.length >= MSG_LIMIT ? ` (capped at ${esc(String(MSG_LIMIT))})` : ''}. ` : ''}These come from communication_logs and are counted independently of the aggregation's email and Slack figures above.</div>`)}
      </div>`;

    const leadsBtn = pane.querySelector('[data-act="leads"]');
    if (leadsBtn) leadsBtn.addEventListener('click', () => go('leads'));
    /* stateError() renders its own Retry; re-running open() is exactly the
       retry, since each section re-reads on every open. */
    pane.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => open(key)));
  }

  if (spine && customers.length) {
    $('cq').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); drawList(); });
    $('cSeg').querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        filter = b.dataset.f;
        $('cSeg').querySelectorAll('button').forEach(x => {
          const on = x === b;
          x.classList.toggle('on', on);
          x.setAttribute('aria-pressed', String(on));
        });
        drawList();
      });
    });
    drawList();
    await open(customers[0].key);
  }

  /* ── Everyone who is NOT a customer ────────────────────────────────────── */
  /* This section is the point of the rewrite. These people are in the system —
     most of them because they messaged the owner's personal WhatsApp number —
     and they must be visible, because pretending they are not there is how one
     of them ends up being treated as a customer. They are just never counted as
     one, never given a lifetime value, and never given an action. */
  const otherSorted = otherList.slice().sort((a, b) => (n0(b.messages) || 0) - (n0(a.messages) || 0));
  const allOtherSourcesDown = !!waErr && !!profErr && !!viewErr;

  const otherCols = [
    { label: 'Contact', strong: true, render: o => o.name
      ? `${esc(o.name)}<div class="cell-sub" style="white-space:normal">${esc(o.idBasis || 'Name as recorded by the source table')}</div>`
      : `<span class="mono t-muted" style="word-break:break-all">${esc(o.chatId || o.email || o.key)}</span>
         <div class="cell-sub t-warm" style="white-space:normal">${esc(o.idBasis || 'No name on record — this is an identifier, not a person’s name')}</div>` },
    { label: 'Why this is not a customer', render: o => `<span class="cell-sub" style="white-space:normal">${esc(o.basis)}</span>` },
    { label: 'Phone', render: o => o.phone
      ? `<span class="mono">${esc(o.phone)}</span>`
      : '<span class="t-muted">Not stored on any row for this contact</span>' },
    { label: 'Where it appears', render: o => [...o.sources].map(s => `<span class="chip">${esc(s)}</span>`).join(' ') },
    { label: 'Messages', align: 'r', render: o => o.messages == null ? '<span class="t-muted">—</span>' : num(o.messages) },
    { label: 'Last seen', align: 'r', render: o => esc(ago(o.lastSeen)) },
  ];

  otherHost.innerHTML = `
    <div class="card-head">
      <div>
        <div class="card-title">Contacts who are not customers</div>
        <div class="card-sub">Everyone who appears in whatsapp_contacts, customer_360_profiles or v_customer_360
        without a lead or a purchase behind them. Most are people who messaged the owner's WhatsApp number.
        They are listed so nobody has to guess where a name came from — none of them is a customer, none has a
        lifetime value, and none can be actioned from here. Rows open Conversations.</div>
      </div>
    </div>
    <div class="pbody">${allOtherSourcesDown
      ? stateError('the contact directory', waErr)
      : `${waErr ? `<div class="banner warm" style="margin-bottom:12px"><span class="material-symbols-outlined">warning</span>
          <div>whatsapp_contacts could not be read (${esc(waErr)}), so WhatsApp-only contacts are missing from this list.</div></div>` : ''}
        ${table(otherCols, otherSorted, {
          /* Marks the rows clickable; wireRows() below is what binds them. */
          onRow: true,
          empty: stateEmpty('Nothing outside the customer list',
            'Every row in whatsapp_contacts, customer_360_profiles and v_customer_360 matches a customer in the directory, so nothing is being presented as a customer that is not one. '
            + 'A row appears here the moment somebody messages the WhatsApp number, or the nightly job writes a profile, for an address with no lead and no purchase behind it — which is how thirteen people from a personal phone book once ended up on this screen.',
            'done_all'),
        })}`}</div>`;

  wireRows(otherHost, otherSorted, () => go('conversations'));
};

/* ==========================================================================
   S11 · Team
   ========================================================================== */
