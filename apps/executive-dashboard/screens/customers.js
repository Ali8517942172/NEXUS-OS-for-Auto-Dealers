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

     · v_customer_360        — live lifetime value, lead / message counts.
     · customer_360_profiles — the nightly job's own output. The ONLY source of
                               the email and Slack touch counts and last_synced_at.
     · whatsapp_contacts     — a messaging directory, NOT a customer list. A row
                               here is shown as a customer's WhatsApp channel only
                               when its lead_email matches a directory customer.

   Anything present in those three but absent from the directory is listed at the
   foot of the screen under a heading that says it is not a customer, with the
   reason. Nothing is hidden and nothing is promoted.

   THE SECOND CORRECTION: the nightly aggregation reports 0 emails and 0 Slack
   messages for every profile because the Gmail credential it authenticates with
   is revoked. A zero there means "collected nothing", not "this customer never
   contacted us", and this screen says so at every place that zero is rendered.

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

/* v_customer_directory is read with select=* on purpose. It is newer than this
   screen and its column list is not in SCHEMA.md, so naming columns in the
   select would turn a rename into a 42703 and take the whole customer list down.
   The two fields this screen needs are looked up tolerantly below, and the read
   is deliberately unordered for the same reason — sorting happens client-side
   over values that were actually returned. */
const DIR_EMAIL = ['email', 'lead_email', 'customer_email', 'contact_email'];
const DIR_NAME  = ['name', 'full_name', 'customer_name', 'lead_name', 'display_name'];

const str  = v => String(v == null ? '' : v).trim();
const norm = v => str(v).toLowerCase();
const pick = (row, names) => { for (const n of names) { const s = str(row && row[n]); if (s) return s; } return ''; };

/* Neither the aggregation nor the credential behind it can be repaired from the
   browser. Spelled out once so the disabled control and the prose agree. */
const NO_SYNC_HOOK =
  'customer_360_profiles is written by the nightly aggregation job and is service-role only. lib/data.js ' +
  'exposes no webhook for that job and none for reconnecting its Gmail credential, so the browser can neither ' +
  're-run the sync nor fix the reason it is returning zeros. This stays disabled until such an endpoint exists.';

/* The one sentence that has to travel with every touch count on this screen. */
const AGG_ZERO_CAUSE =
  'The nightly job reaches Gmail with a credential that has been revoked, so it has had nothing to count. ' +
  'A 0 here means "not collected" — it is not evidence that the customer never wrote to us. The message ' +
  'counts elsewhere on this screen come from communication_logs and are unaffected.';

/* A touch count is never rendered bare. Null means the job did not report one;
   zero means the job reported one and it is not trustworthy. */
function touchCell(v) {
  const x = n0(v);
  if (x == null) return '<span class="t-muted">— not reported by the aggregation</span>';
  if (x === 0) return '<span class="num">0</span> <span class="t-warm">· not collected — the job’s Gmail credential is revoked</span>';
  return `<span class="num">${num(x)}</span>`;
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
    const email = pick(r, DIR_EMAIL);
    const key = norm(email) || `dir:${i}`;
    const cur = map.get(key);
    if (cur) { cur.dupes++; if (!cur.name) cur.name = pick(r, DIR_NAME); return; }
    map.set(key, { key, email, name: pick(r, DIR_NAME), dupes: 0 });
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
  const add = (email, name) => {
    const key = norm(email);
    if (!key) return;
    const cur = map.get(key);
    if (cur) { if (!cur.name && name) cur.name = str(name); return; }
    map.set(key, { key, email: str(email), name: str(name), dupes: 0 });
  };
  (leads || []).forEach(l => add(l.email, l.name));
  (purchases || []).forEach(p => add(p.email, pick(p, DIR_NAME)));
  return map;
}

const nameOf  = c => c.name || (c.view && str(c.view.name)) || (c.profile && str(c.profile.name)) || c.email || 'Unnamed customer';
const phoneOf = c => (c.view && str(c.view.phone)) || (c.profile && str(c.profile.phone)) ||
                     (c.contacts.map(x => str(x.phone)).filter(Boolean)[0] || '');

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
    db(`leads?select=name,email,created_at&limit=${SOURCE_LIMIT}`),
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

  /* ── Aggregation health ────────────────────────────────────────────────── */
  const synced = profiles.map(p => p.last_synced_at).filter(Boolean).sort();
  const newest = synced.length ? synced[synced.length - 1] : null;
  const oldest = synced.length ? synced[0] : null;
  const reported = profiles.map(p => ({ e: n0(p.total_emails), s: n0(p.total_slack_messages) }));
  const anyTouch = reported.some(r => (r.e || 0) > 0 || (r.s || 0) > 0);
  const zeroProfiles = reported.filter(r => (r.e || 0) === 0 && (r.s || 0) === 0).length;

  /* ── KPI strip ─────────────────────────────────────────────────────────── */
  if (!spine) {
    strip.style.display = 'block';
    strip.innerHTML = stateError('the customer list', dirErr || leadErr || buyErr || 'Unknown error');
  } else {
    strip.innerHTML = [
      kpi('Customers', num(customers.length),
        `<span class="t-muted">${esc(spineSource)} · a lead or a purchase on file</span>`),
      kpi('Recorded purchase value', aed(purchaseValue),
        buyErr
          ? '<span class="t-warm">purchase_history could not be read</span>'
          : purchaseRows
            ? `<span class="t-muted">amount_aed summed over ${num(purchaseRows)} purchase row${purchaseRows === 1 ? '' : 's'} from ${num(buyers)} customer${buyers === 1 ? '' : 's'}</span>`
            : '<span class="t-muted">No purchase recorded against any customer</span>'),
      kpi('Contacts who are not customers', waErr && !otherList.length ? '—' : num(otherList.length),
        waErr
          ? '<span class="t-warm">whatsapp_contacts could not be read, so this is incomplete</span>'
          : `<span class="t-muted">${num(contacts.length)} whatsapp_contacts row${contacts.length === 1 ? '' : 's'} read · ${num(linkedContacts)} linked to a customer</span>`),
      kpi('Unified profiles', profErr ? '—' : num(profiles.length),
        profErr
          ? '<span class="t-warm">customer_360_profiles could not be read</span>'
          : `<span class="t-muted">${num(withProfile)} of ${num(customers.length)} customers have one${orphanProfiles ? ` · ${num(orphanProfiles)} belong${orphanProfiles === 1 ? 's' : ''} to somebody who is not a customer` : ''}</span>`),
      kpi('Last aggregation run', profErr ? '—' : ago(newest),
        profErr
          ? '<span class="t-warm">Unknown — the profile table could not be read</span>'
          : newest
            ? `<span class="t-muted">Newest last_synced_at${oldest && oldest !== newest ? ` · oldest ${esc(ago(oldest))}` : ''}</span>`
            : '<span class="t-muted">No profile carries a last_synced_at value</span>'),
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
    notes.push(`<div class="banner hot"><span class="material-symbols-outlined">sync_problem</span>
      <div><strong>Email and Slack touch counts are not being collected.</strong> All ${esc(String(profiles.length))}
      profile${profiles.length === 1 ? '' : 's'} written by the nightly Customer 360 job report 0 emails and 0 Slack
      messages. ${esc(AGG_ZERO_CAUSE)}</div></div>`);
  } else if (zeroProfiles) {
    notes.push(`<div class="banner warm"><span class="material-symbols-outlined">sync_problem</span>
      <div>${esc(String(zeroProfiles))} of ${esc(String(profiles.length))} profiles report 0 emails and 0 Slack
      messages. ${esc(AGG_ZERO_CAUSE)}</div></div>`);
  } else if (!profiles.length) {
    notes.push(`<div class="banner info"><span class="material-symbols-outlined">schedule</span>
      <div>The nightly Customer 360 aggregation has not written a single profile row, so there are no email or
      Slack touch counts anywhere on this screen. Everything else is read live.</div></div>`);
  }
  if (viewErr) {
    notes.push(`<div class="banner warm"><span class="material-symbols-outlined">warning</span>
      <div>v_customer_360 could not be read (${esc(viewErr)}), so lifetime value, lead counts and message counts
      are blank for every customer. The customer list itself is unaffected.</div></div>`);
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
            <button type="button" data-f="buyers" aria-pressed="false" ${buyErr ? 'disabled' : ''}
              title="${buyErr ? esc('purchase_history could not be read (' + buyErr + '), so buyers cannot be separated from enquiries.') : 'Customers with at least one row in purchase_history.'}">Buyers ${buyErr ? '—' : num(buyers)}</button>
            <button type="button" data-f="enquiry" aria-pressed="false" ${buyErr ? 'disabled' : ''}
              title="${buyErr ? esc('purchase_history could not be read (' + buyErr + '), so buyers cannot be separated from enquiries.') : 'Customers with a lead on file but no purchase recorded.'}">Enquiries ${buyErr ? '—' : num(customers.length - buyers)}</button>
          </div>
          <button class="btn sm" disabled title="${esc(NO_SYNC_HOOK)}">Re-run sync</button>
        </div>
        <div id="custList" style="overflow-y:auto;flex:1"></div>
      </div>
      <div id="custPane" style="overflow-y:auto;min-width:0"></div>`;
  }

  let q = '', filter = 'all', selected = null;

  const visible = () => customers.filter(c => {
    if (filter === 'buyers' && !c.purchases.length) return false;
    if (filter === 'enquiry' && c.purchases.length) return false;
    if (!q) return true;
    return `${nameOf(c)} ${c.email} ${phoneOf(c)}`.toLowerCase().includes(q);
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
              : '<span class="t-muted">enquiry only</span>';
          return `<div class="list-item${c.key === selected ? ' on' : ''}" role="button" tabindex="0" data-k="${esc(c.key)}">
            <div class="avatar">${esc(initials(nameOf(c)))}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(nameOf(c))}
                ${c.view && c.view.is_vip ? '<span class="pill vip"><span class="dot"></span>VIP</span>' : ''}</div>
              <div class="cell-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.email || 'No email on the directory row')}</div>
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
          grab(db(`leads?select=id,name,status,ai_score,vehicle_interest,budget_aed,source,created_at&email=ilike.${qs}&order=created_at.desc`)),
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
        ? '<span class="t-warm">Summed from purchase_history — v_customer_360 has no row for this customer</span>'
        : '<span class="t-muted">No lifetime value in v_customer_360 and no purchase amount recorded</span>';

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
                <div class="cell-sub">${str(w.phone) ? esc(str(w.phone)) : '<span class="t-muted">no phone stored</span>'}</div>
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
            ${v.is_vip ? '<span class="pill vip"><span class="dot"></span>Returning customer</span>' : ''}
            ${buyErr ? '' : c.purchases.length ? pill('Buyer', 'ok') : '<span class="chip">Enquiry — no purchase on file</span>'}</div>
          <div class="card-sub">${esc(c.email || 'No email on the directory row')}${phoneOf(c) ? ' · ' + esc(phoneOf(c)) : ''}</div>
        </div>
        ${leads.rows && leads.rows.length ? '<button class="btn sm" data-act="leads">Open in Leads</button>' : ''}
      </div>
      <div style="padding:20px">
        <div class="grid g4">
          ${kpi('Lifetime value', aed(ltvValue), ltvSub)}
          ${kpi('Leads', viewErr ? num(c.leads.length) : num(v.lead_count),
            viewErr
              ? '<span class="t-warm">Counted from the leads table — v_customer_360 is unavailable</span>'
              : v.latest_status ? pill(v.latest_status) : '<span class="t-muted">No status on the latest lead</span>')}
          ${kpi('Best AI score', num(v.best_ai_score),
            n0(v.best_ai_score) == null
              ? '<span class="t-muted">No lead scored by the router yet</span>'
              : '<span class="t-muted">Highest score across this customer’s leads</span>')}
          ${kpi('Messages logged', num(v.message_count),
            v.last_contact_at
              ? `<span class="t-muted">Last contact ${esc(ago(v.last_contact_at))}</span>`
              : '<span class="t-muted">No last-contact timestamp in v_customer_360</span>')}
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
            <dt>Email key</dt><dd class="mono" style="word-break:break-all">${esc(c.email || '—')}</dd>
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
                   <dt>Email touches</dt><dd>${touchCell(c.profile.total_emails)}</dd>
                   <dt>Slack messages</dt><dd>${touchCell(c.profile.total_slack_messages)}</dd>
                   <dt>Last synced</dt><dd>${esc(ago(c.profile.last_synced_at))}${c.profile.last_synced_at ? '' : ' <span class="t-muted">(the row exists but carries no timestamp)</span>'}</dd>
                   <dt>Name on profile</dt><dd>${esc(str(c.profile.name) || '—')}</dd>
                   <dt>Phone on profile</dt><dd>${esc(str(c.profile.phone) || '—')}</dd>
                 </dl>
                 <div class="cell-sub" style="margin-top:10px;white-space:normal">${esc(AGG_ZERO_CAUSE)}</div>`
              : noSource('The nightly Customer 360 aggregation has not written a row for this customer, so there are no email or Slack touch counts and no last_synced_at. Identity, leads, purchases and logged messages below are read live and are current.')}
        </div>

        ${section('Purchase history', purch, 'No purchase recorded for this customer.', rows => `
          ${rows.map(x => `<div class="quote" style="margin-top:8px">
            <strong>${esc(pick(x, ['vehicle', 'vehicle_interest', 'model']) || 'Vehicle not recorded')}</strong>${n0(x.amount_aed) == null ? '' : ' · ' + aed(x.amount_aed)}
            <div class="cell-sub">${esc(str(x.purchase_date) || 'No purchase date recorded')}</div></div>`).join('')}
          ${purchTotal == null ? '' : `<div class="cell-sub num" style="margin-top:10px">${esc(String(rows.length))} purchase${rows.length === 1 ? '' : 's'} · ${aed(purchTotal)} total</div>`}`)}

        ${section('Leads', leads, 'No lead recorded for this customer.', rows => `
          <div class="timeline" style="margin-top:8px">${rows.map(l => `
            <div class="tl-item"><span class="tl-dot" style="background:var(--${tone(l.status) || 'neutral'})"></span>
              <div class="tl-body">
                <div class="tl-meta">${esc(ago(l.created_at))}${l.source ? ' · ' + esc(l.source) : ''}${n0(l.ai_score) == null ? '' : ' · score ' + num(l.ai_score)}</div>
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
      ? esc(o.phone)
      : '<span class="t-muted">Not stored</span>' },
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
            'Every row in the aggregation and WhatsApp tables matches a customer in the directory. Nothing here is being presented as a customer that is not one.',
            'done_all'),
        })}`}</div>`;

  wireRows(otherHost, otherSorted, () => go('conversations'));
};

/* ==========================================================================
   S11 · Team
   ========================================================================== */
