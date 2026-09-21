/* NEXUS OS — screens/appointments.js
   APPOINTMENTS. Every showroom visit this dealership has on record, and which
   of the six different things that could be true of it is actually true.

   ═══════════════════════════════════════════════════════════════════════════
   WHY THIS SCREEN EXISTS
   ═══════════════════════════════════════════════════════════════════════════
   Migration NX995 gave the database appointments — a table, a state lookup, a
   transition log, an event log, five service_role write verbs and one read
   accessor. Nothing called it. A booking nobody can see is not a feature, and
   until this file existed the only way to find out whether a customer was
   expected in the showroom this afternoon was to read SQL.

   UPDATE, NX1005 (21 Sep 2026): "nothing called it" stopped being fully true.
   Six tenant-scoped wrapper RPCs now sit in front of NX995's five verbs —
   request, offer, confirm, attend, no-show, cancel — each re-deriving the
   caller's own dealership from the JWT and checking that the appointment (or,
   for a brand new one, the lead) actually belongs to it before doing anything.
   This file calls them: "Book visit" in lib/lead-drawer.js chains request
   then confirm for one lead, and the "Act on it" column in P2 below offers
   whichever of the six verbs the row's own state allows. Nothing about the
   six-state machine, the double-booking constraint or the write path itself
   moved for this — these are doors into the same room NX995 built, not a new
   room.

   The whole screen turns on one distinction the product keeps trying to
   collapse, and collapsing it is how a dashboard tells a dealership it has a
   diary full of customers when it has a diary full of hopes. There are SIX
   different sentences here, not one, and not two:

     REQUESTED  — a customer asked to come in. No time has been proposed and
                  nothing is in anyone's diary. This is NOT a booking.

     OFFERED    — we proposed one or more times. The customer has not agreed to
                  any of them. This is NOT a booking.

     CONFIRMED  — the customer agreed to one specific time. This is the ONLY
                  state that is a booking, and it is still only a promise: the
                  customer has not walked in yet and may not.

     ATTENDED   — a human recorded that the customer walked in. Never, under
                  any circumstances, inferred from the clock.

     NO_SHOW    — a human recorded that the customer did not walk in.

     CANCELLED  — called off, by the customer or by the dealership.
                  outcome_reason says which, in words.

   Averaging those into a "booking rate" is the same defect the Channels screen
   refuses for REGISTERED/CONNECTED/RECEIVING, and it costs more here: a dealer
   told "12 booked" about twelve people who merely asked a question will staff
   a Saturday for twelve customers and find out at the worst possible moment.
   So the six words are shown verbatim, counted separately, never summed into a
   score, and never reduced to a two-way toggle.

   ═══════════════════════════════════════════════════════════════════════════
   THE CLOCK IS NOT A WITNESS
   ═══════════════════════════════════════════════════════════════════════════
   A confirmed slot whose end time has passed with nobody marking it is NOT
   attended and NOT a no-show. It is a question nobody has answered. The
   accessor computes exactly one thing from the clock — `awaiting_outcome` —
   and that is the only thing the clock is permitted to produce anywhere in
   this system. This screen surfaces it as its own count, in its own panel,
   under its own words, because these rows are the ones that quietly rot into a
   fake attendance number if anything ever starts guessing.

   ═══════════════════════════════════════════════════════════════════════════
   WHERE THE ANSWER COMES FROM
   ═══════════════════════════════════════════════════════════════════════════
   `public.nexus_appointment_status(p_days)` — one SECURITY DEFINER accessor,
   scoped to the caller's own dealership(s) by `nexus_current_tenant_ids()`,
   EXECUTE granted to `authenticated` so the browser calls it as the signed-in
   user. A caller with no membership gets NO ROWS, never a default dealership.

   It returns `state`, `state_meaning`, `counts_as_booked`, `counts_as_attended`,
   `awaiting_outcome`, `slot_is_protected` and a plain-English `evidence` line
   ALREADY COMPUTED. That matters: this file derives none of them. In
   particular "booked" is read out of `counts_as_booked` — the database's own
   answer, true for CONFIRMED, ATTENDED and NO_SHOW — rather than re-decided in
   JavaScript, so a change to what counts as a booking happens in one place and
   this screen follows it without anyone finding this file.

   Nothing here filters by dealership. The database refuses another
   dealership's rows; this file does not hide them. */

import { db, dbWrite, onIdentityChange, subscriptionAccessMode } from '../lib/data.js';
import { ago, dubaiStamp, esc, n0, pill } from '../lib/format.js';
import { openModal } from '../lib/modal.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty } from '../lib/states.js';
import { kpi, panel, table } from '../lib/ui.js';

/* ── Small local vocabulary ───────────────────────────────────────────────── */
const str = v => String(v == null ? '' : v).trim();
const up  = v => str(v).toUpperCase();
const plural = (c, one, many) => (Number(c) === 1 ? one : many);
const muted = h => `<div class="cell-sub">${h}</div>`;
const hot   = h => `<div class="cell-sub t-hot">${h}</div>`;
const warm  = h => `<div class="cell-sub t-warm">${h}</div>`;
const bold  = h => `<div style="font-weight:600">${h}</div>`;
const wrap  = h => `<div style="white-space:normal">${h}</div>`;
const chip  = t => `<span class="chip">${esc(t)}</span>`;

/* A null is not a zero and is never printed as one — "no figure was returned"
   and "nothing is on the diary" are different facts, and only the second is a
   finding this screen is entitled to make. */
const count = v => { const x = n0(v); return x == null ? '—' : String(x); };

/* ── The window ───────────────────────────────────────────────────────────
   The accessor's own default. It is stated on the page rather than implied,
   because every count here is a count within a window and a reader who does
   not know the window cannot tell a quiet fortnight from a short one. Note
   what the accessor does NOT clip to it: anything still REQUESTED or OFFERED,
   and any confirmed slot that has passed with no outcome, come back however
   old they are. Those are the rows that go wrong by being forgotten. */
const WINDOW_DAYS = 7;

/* ── The six states, verbatim, and nothing else ───────────────────────────
   The order is the order a visit moves through, which is also the order a
   reader needs: what is still waiting on us, then what is actually booked,
   then what has already been called by a human. A state this file has never
   heard of sorts last and renders `unknown` rather than being guessed into one
   of the six — a seventh word invented in the database must appear here as
   unrecognised, never as a silent promotion into "booked". */
const STATES = ['REQUESTED', 'OFFERED', 'CONFIRMED', 'ATTENDED', 'NO_SHOW', 'CANCELLED'];
const STATE = {
  REQUESTED: { rank: 0, tone: 'cold' },
  OFFERED:   { rank: 1, tone: 'warm' },
  CONFIRMED: { rank: 2, tone: 'ok' },
  ATTENDED:  { rank: 3, tone: 'ok' },
  NO_SHOW:   { rank: 4, tone: 'hot' },
  CANCELLED: { rank: 5, tone: 'unknown' },
};
const stateOf = row => STATE[up(row && row.state)] || { rank: 6, tone: 'unknown' };
const isState = (rows, key) => (rows || []).filter(r => up(r.state) === key);

/* The database's own answer to "is this a booking", never re-derived here. */
const isBooked   = r => r && r.counts_as_booked === true;
const isAttended = r => r && r.counts_as_attended === true;
const isAwaiting = r => r && r.awaiting_outcome === true;
/* slot_is_protected is TRUE when the row is outside the double-booking risk —
   either it is not CONFIRMED at all, or it has a salesperson or a resource
   attached. FALSE is the finding, and it is only ever false for a CONFIRMED
   row with neither. Read as the database returns it; a missing value is not
   treated as either answer. */
const isUnprotected = r => r && r.slot_is_protected === false;

/* ── The memo is per RENDER, not per page load ─────────────────────────────
   Four panels share one read. Module state survives the re-auth path, which
   does not reload the page — so a memo that is never cleared would show a
   second dealership signing in on the same machine the FIRST one's diary,
   under a caption saying it had just been read. resetReads() therefore runs at
   the top of the mount function AND on every identity change. The two events
   are not the same and only one of them is under this file's control, which is
   why both are wired. screens/channels.js carries the full account. */
const MEMOS = new Set();
const shared = make => {
  let p = null;
  const f = () => {
    if (!p) { p = make(); p.catch(() => { p = null; }); }
    return p;
  };
  MEMOS.add(() => { p = null; });
  return f;
};
const resetReads = () => { MEMOS.forEach(reset => reset()); };
onIdentityChange(resetReads);
const settle = pr => pr.then(v => ({ v, err: null }), e => ({ v: null, err: e }));

const linkBtn = (id, label) => (SCREENS[id]
  ? `<button class="btn sm" data-go="${esc(id)}">${esc(label)}</button>`
  : `<button class="btn sm ghost" disabled title="${esc(label)} is not part of this build: the navigation offers the screen and no module in this bundle registers it.">${esc(label)} — not in this build</button>`);
const wireGo = card => {
  card.querySelectorAll('[data-go]').forEach(b => {
    if (b.disabled) return;
    b.addEventListener('click', () => go(b.dataset.go));
  });
};

/* ══════════════════════════════════════════════════════════════════════════
   NX1005 — the six write verbs, as buttons on a row
   ══════════════════════════════════════════════════════════════════════════
   Same door as the Book visit button in lib/lead-drawer.js — the tenant-
   scoped wrappers in supabase/migrations/20260921120000_nx1005_*.sql, not a
   new one. Which buttons a row gets is read off its OWN `state`, never off a
   copy of the database's transition table (this file keeps none): a state
   this screen does not recognise gets no buttons at all rather than a guess
   at which ones might apply to it.

   A read-only subscription (nexus_my_subscription(), if it exists — see
   subscriptionAccessMode() in lib/data.js) disables every one of them, shown
   and disabled rather than hidden, the same rule as the rest of this product.
   If the function does not exist yet, mode.known is false and mode.readOnly
   is always false, so nothing here is blocked by a feature that has not
   landed — this screen works with or without task A's gate. */
const ACTIONS_BY_STATE = {
  REQUESTED: [['offer', 'Offer times'], ['confirm', 'Confirm visit'], ['cancel', 'Cancel']],
  OFFERED:   [['offer', 'Offer times again'], ['confirm', 'Confirm visit'], ['cancel', 'Cancel']],
  CONFIRMED: [['attend', 'Attended'], ['no_show', 'No-show'], ['cancel', 'Cancel']],
};
const actionsCell = (r, mode) => {
  const list = ACTIONS_BY_STATE[up(r.state)];
  if (!list) {
    return muted(STATE[up(r.state)]
      ? 'No further action — this visit is already ' + esc(str(r.state)) + '.'
      : 'This screen does not recognise this state, so it offers no action on it rather than guessing one.');
  }
  const ro = !!(mode && mode.readOnly);
  const roTitle = ro
    ? ' title="This dealership\u2019s subscription is in a read-only state, so nothing here can be written until it is resolved."'
    : '';
  return `<div style="display:flex;gap:6px;flex-wrap:wrap">${list.map(([action, label]) =>
    `<button class="btn sm" data-appt-id="${esc(r.appointment_id)}" data-appt-action="${action}"${ro ? ' disabled' : ''}${roTitle}>${esc(label)}</button>`
  ).join('')}</div>`;
};

/* Loads the roster once per dialog, the same list and the same "no accounts"
   / "could not be read" wording as bookVisitDialog and assignDialog in
   lib/lead-drawer.js use for the same read. Not shared as code across the two
   files because the two dialogs differ in everything around this one list. */
async function staffSelectHtml(selectedId) {
  try {
    const users = await db('users?select=id,name,status&order=name') || [];
    if (!users.length) return '<span class="t-muted">No staff accounts to offer.</span>';
    return `<select id="apSales" style="width:100%"><option value="">Unassigned</option>${users.map(u =>
      `<option value="${esc(u.id)}"${u.id === selectedId ? ' selected' : ''}>${esc(u.name)}${u.status === 'pending_invite' ? ' (pending invite)' : ''}</option>`
    ).join('')}</select>`;
  } catch (e) {
    return `<span class="t-hot">The staff list could not be read (${esc(e.message || String(e))}).</span>`;
  }
}

function offerDialog(row) {
  const m = openModal(`Offer times \u2014 appointment ${row.appointment_id}`, `
    <div class="cell-sub" style="margin-bottom:12px">Up to three times to propose. At least one is required. This
      replaces any times previously offered on this visit \u2014 nexus_appointment_offer_slots' own rule, not this
      dialog's.</div>
    <label class="cell-sub" for="apSlot1" style="display:block">Slot 1</label>
    <input id="apSlot1" type="datetime-local" style="width:100%">
    <label class="cell-sub" for="apSlot2" style="display:block;margin-top:8px">Slot 2 (optional)</label>
    <input id="apSlot2" type="datetime-local" style="width:100%">
    <label class="cell-sub" for="apSlot3" style="display:block;margin-top:8px">Slot 3 (optional)</label>
    <input id="apSlot3" type="datetime-local" style="width:100%">
  `, `<button class="btn primary" id="apGo">Offer</button><button class="btn" id="apCancel">Cancel</button>`);
  const $$ = id => m.wrap.querySelector(id);
  $$('#apCancel').addEventListener('click', () => m.close());
  $$('#apGo').addEventListener('click', async () => {
    const vals = ['#apSlot1', '#apSlot2', '#apSlot3'].map(id => ($$(id).value || '').trim()).filter(Boolean);
    if (!vals.length) { m.msg('<span class="t-hot">At least one slot is required.</span>'); return; }
    const dts = [];
    for (const v of vals) {
      const dt = new Date(v);
      if (Number.isNaN(dt.getTime())) {
        m.msg('<span class="t-hot">One of those times could not be read. Please re-enter it.</span>');
        return;
      }
      dts.push(dt.toISOString());
    }
    $$('#apGo').disabled = true;
    m.msg('Offering\u2026');
    try {
      await dbWrite('POST', 'rpc/nexus_my_appointment_offer_slots', { p_appointment_id: row.appointment_id, p_slots: dts });
      m.msg('<span class="t-ok">Offered. Reopen the Appointments screen to see it reflected in the diary.</span>');
    } catch (e) {
      m.msg(`<span class="t-hot">${esc(e.message || String(e))}</span>`);
      $$('#apGo').disabled = false;
    }
  });
}

function confirmDialog(row) {
  const m = openModal(`Confirm visit \u2014 appointment ${row.appointment_id}`, `
    <div class="cell-sub" style="margin-bottom:12px">Books this visit for one specific time. The EXCLUDE USING gist
      double-booking constraint still applies: a salesperson or resource already booked over this time is refused,
      in nexus_appointment_confirm's own words, below.</div>
    <label class="cell-sub" for="apWhen" style="display:block">When</label>
    <input id="apWhen" type="datetime-local" style="width:100%">
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">
      <div style="flex:1;min-width:160px">
        <label class="cell-sub" for="apDuration" style="display:block">Duration (minutes)</label>
        <input id="apDuration" type="number" min="5" step="5" value="45" style="width:100%">
      </div>
      <div style="flex:1;min-width:220px">
        <label class="cell-sub" for="apSalesWrap" style="display:block">Salesperson (optional)</label>
        <div id="apSalesWrap" class="cell-sub">Loading staff\u2026</div>
      </div>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">
      <div style="flex:1;min-width:160px">
        <label class="cell-sub" for="apLocation" style="display:block">Location (optional)</label>
        <input id="apLocation" type="text" maxlength="120" style="width:100%">
      </div>
      <div style="flex:1;min-width:160px">
        <label class="cell-sub" for="apResource" style="display:block">Resource (optional)</label>
        <input id="apResource" type="text" maxlength="120" style="width:100%" placeholder="bay, desk, demo car">
      </div>
    </div>
  `, `<button class="btn primary" id="apGo">Confirm</button><button class="btn" id="apCancel">Cancel</button>`);
  const $$ = id => m.wrap.querySelector(id);
  $$('#apCancel').addEventListener('click', () => m.close());
  staffSelectHtml(row.assigned_to_id).then(html => { $$('#apSalesWrap').innerHTML = html; });
  $$('#apGo').addEventListener('click', async () => {
    const whenVal = ($$('#apWhen').value || '').trim();
    if (!whenVal) { m.msg('<span class="t-hot">A time is required.</span>'); return; }
    const dt = new Date(whenVal);
    if (Number.isNaN(dt.getTime())) { m.msg('<span class="t-hot">That time could not be read. Please re-enter it.</span>'); return; }
    const duration = Number(($$('#apDuration').value || '45').trim()) || 45;
    const salesSel = m.wrap.querySelector('#apSales');
    const salesId = salesSel ? (salesSel.value || null) : null;
    const location = ($$('#apLocation').value || '').trim() || null;
    const resource = ($$('#apResource').value || '').trim() || null;
    $$('#apGo').disabled = true;
    m.msg('Confirming\u2026');
    try {
      await dbWrite('POST', 'rpc/nexus_my_appointment_confirm', {
        p_appointment_id: row.appointment_id, p_starts_at: dt.toISOString(),
        p_duration_minutes: duration, p_assigned_to_id: salesId, p_location: location, p_resource: resource,
      });
      m.msg('<span class="t-ok">Confirmed. Reopen the Appointments screen to see it reflected in the diary.</span>');
    } catch (e) {
      m.msg(`<span class="t-hot">${esc(e.message || String(e))}</span>`);
      $$('#apGo').disabled = false;
    }
  });
}

function outcomeDialog(kind, row) {
  const label = kind === 'no_show' ? 'No-show' : 'Attended';
  const rpc = kind === 'no_show' ? 'nexus_my_appointment_no_show' : 'nexus_my_appointment_attend';
  const m = openModal(`${label} \u2014 appointment ${row.appointment_id}`, `
    <div class="cell-sub" style="margin-bottom:12px">Recorded as a human's own account of what happened. NEXUS never
      infers this from the clock \u2014 see "The clock is not a witness" at the top of this screen.</div>
    <label class="cell-sub" for="apReason" style="display:block">Reason / note (optional)</label>
    <input id="apReason" type="text" maxlength="400" style="width:100%">
  `, `<button class="btn primary" id="apGo">${esc(label)}</button><button class="btn" id="apCancel">Cancel</button>`);
  const $$ = id => m.wrap.querySelector(id);
  $$('#apCancel').addEventListener('click', () => m.close());
  $$('#apGo').addEventListener('click', async () => {
    const reason = ($$('#apReason').value || '').trim() || null;
    $$('#apGo').disabled = true;
    m.msg('Recording\u2026');
    try {
      await dbWrite('POST', `rpc/${rpc}`, { p_appointment_id: row.appointment_id, p_reason: reason });
      m.msg('<span class="t-ok">Recorded. Reopen the Appointments screen to see it reflected in the diary.</span>');
    } catch (e) {
      m.msg(`<span class="t-hot">${esc(e.message || String(e))}</span>`);
      $$('#apGo').disabled = false;
    }
  });
}

function cancelDialog(row) {
  const m = openModal(`Cancel visit \u2014 appointment ${row.appointment_id}`, `
    <div class="cell-sub" style="margin-bottom:12px">nexus_appointment_cancel refuses a cancel with no reason given,
      in its own words \u2014 this dialog does not duplicate that check client-side.</div>
    <label class="cell-sub" for="apReason" style="display:block">Reason</label>
    <input id="apReason" type="text" maxlength="400" style="width:100%" placeholder="e.g. customer asked to cancel">
  `, `<button class="btn primary" id="apGo">Cancel visit</button><button class="btn" id="apBack">Back</button>`);
  const $$ = id => m.wrap.querySelector(id);
  $$('#apBack').addEventListener('click', () => m.close());
  $$('#apGo').addEventListener('click', async () => {
    const reason = ($$('#apReason').value || '').trim() || null;
    $$('#apGo').disabled = true;
    m.msg('Cancelling\u2026');
    try {
      await dbWrite('POST', 'rpc/nexus_my_appointment_cancel', { p_appointment_id: row.appointment_id, p_reason: reason });
      m.msg('<span class="t-ok">Cancelled. Reopen the Appointments screen to see it reflected in the diary.</span>');
    } catch (e) {
      m.msg(`<span class="t-hot">${esc(e.message || String(e))}</span>`);
      $$('#apGo').disabled = false;
    }
  });
}

function openApptAction(kind, row, mode) {
  if (mode && mode.readOnly) {
    const m = openModal('Read-only subscription',
      '<div class="cell-sub">This dealership\u2019s subscription is in a read-only state, so nothing on this '
      + 'appointment can be written until it is resolved.</div>',
      '<button class="btn" id="apClose">Close</button>');
    m.wrap.querySelector('#apClose').addEventListener('click', () => m.close());
    return;
  }
  if (kind === 'offer') return offerDialog(row);
  if (kind === 'confirm') return confirmDialog(row);
  if (kind === 'attend' || kind === 'no_show') return outcomeDialog(kind, row);
  if (kind === 'cancel') return cancelDialog(row);
}

/* Reads the rows and the subscription mode the render pass stashed on the
   card (`card.__apptRows` / `card.__apptMode`) — the same pattern
   lib/ui.js's own comment on panel() names for a caller that needs state
   `render` computed, rather than re-deriving it from the DOM. */
const wireApptActions = card => {
  const rows = card.__apptRows || [];
  card.querySelectorAll('[data-appt-action]').forEach(btn => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => {
      const row = rows.find(r => str(r.appointment_id) === btn.dataset.apptId);
      if (row) openApptAction(btn.dataset.apptAction, row, card.__apptMode);
    });
  });
};

/* ══════════════════════════════════════════════════════════════════════════
   The read
   ══════════════════════════════════════════════════════════════════════════ */
const readAppointments = shared(() => db(`rpc/nexus_appointment_status?p_days=${WINDOW_DAYS}`));

/* ── Time, in the showroom's own clock ────────────────────────────────────
   Asia/Dubai wall clock, through the repo's own formatter, so this screen
   cannot drift from every other date on the product. The accessor also returns
   `starts_at_dubai`, its own rendering of the same instant; it is used only
   when the timestamp itself is absent, and never silently preferred — two
   renderings of one instant that disagree would be a defect nobody could see.
   A row with no start time at all says so in words: a REQUESTED visit has no
   time because nobody has proposed one, and an em dash there reads as a
   missing value rather than as the fact it is. */
const whenCell = r => {
  const t = r.starts_at;
  if (t) {
    return bold(esc(dubaiStamp(t)))
      + muted(esc(ago(t)) + (r.ends_at ? ' · ends ' + esc(dubaiStamp(r.ends_at)) : ' · no end time recorded'));
  }
  const dbSaid = str(r.starts_at_dubai);
  if (dbSaid) return bold(esc(dbSaid)) + muted('Rendered by the database; no machine-readable start time came back with it.');
  return warm('No time — nobody has put this visit in a diary yet.')
    + muted(r.requested_at
        ? 'Asked for ' + esc(dubaiStamp(r.requested_at))
        : 'No request time is recorded against it either.');
};

/* ══════════════════════════════════════════════════════════════════════════
   SCREEN
   ══════════════════════════════════════════════════════════════════════════ */
SCREENS.appointments = async host => {
  resetReads();

  /* Throws on failure, so the panels that report on the diary get the standard
     unread card rather than inventing an empty one. An empty diary and an
     unread diary are opposite facts and this screen makes both. */
  const load = () => readAppointments();

  /* NX1005: P2 alone also needs to know whether this dealership's subscription
     is read-only, to decide whether the "Act on it" buttons are live. Bundled
     into one load rather than a second panel-level read, so a failure of
     EITHER half shows P2 as unread rather than half-drawn. subscriptionAccessMode()
     never throws (see lib/data.js) — it resolves { known:false, readOnly:false }
     on any failure, including "the function does not exist yet" — so this can
     only reject if readAppointments() itself does. */
  const loadDiary = () => Promise.all([readAppointments(), subscriptionAccessMode()])
    .then(([rows, mode]) => ({ rows, mode }));

  /* The same read, and this one never throws. It is for the last panel, whose
     entire job is to state what this screen cannot tell you: handing it a
     "couldn't load" card would silence the one panel still true when the read
     fails. */
  const loadSoft = () => settle(readAppointments());

  /* ────────────────────────────────────────────────────────────────────────
     P1 · The six words, counted separately
     ──────────────────────────────────────────────────────────────────────── */
  panel(host, {
    title: 'Every showroom visit, counted by the word it is actually in',
    sub: 'Six separate figures, never added together and never rolled into a booking rate. Somebody who asked a '
       + 'question and somebody who agreed to a time on Saturday are opposite facts, and only one of them is a booking',
    actions: linkBtn('leads', 'Open Leads') + ' ' + linkBtn('conversations', 'Open Conversations'),
    load,
    render: rows => {
      const all = Array.isArray(rows) ? rows : [];
      const unrecognised = all.filter(r => !STATE[up(r.state)]);

      /* "Booked" is the database's column, not this file's opinion. */
      const booked   = all.filter(isBooked);
      const attended = all.filter(isAttended);
      const awaiting = all.filter(isAwaiting);

      const TONE_WHEN_PRESENT = {
        REQUESTED: 't-warm', OFFERED: 't-warm', CONFIRMED: 't-ok',
        ATTENDED: 't-ok',   NO_SHOW: 't-hot',  CANCELLED: '',
      };
      const BLURB = {
        REQUESTED: ['A customer asked to come in and no time has been proposed. Nothing is in anyone’s diary and this '
                  + 'is not a booking. Every one of these is waiting on somebody here.',
                    'Nobody is waiting on us for a time to be offered.'],
        OFFERED:   ['Times were proposed and the customer has not agreed to any of them. This is not a booking either '
                  + '— the diary entry exists on our side only.',
                    'Nothing is sitting with a customer waiting for them to pick a time.'],
        CONFIRMED: ['The customer agreed to one specific time. This is the only state that is a booking, and it is '
                  + 'still a promise: nobody has walked in yet.',
                    'Nobody has agreed to a time. There is no booking in this window at all.'],
        ATTENDED:  ['A human recorded that the customer walked in. This is the only figure on the screen that '
                  + 'describes somebody who was actually in the showroom.',
                    'Nobody has been recorded as walking in. That is not a statement that nobody came — only that no '
                  + 'human has said one did.'],
        NO_SHOW:   ['A human recorded that the customer did not walk in. Recorded, not inferred — the clock never '
                  + 'produces this word.',
                    'No visit has been called a no-show by anybody.'],
        CANCELLED: ['Called off, by the customer or by the dealership. The reason is in the row’s own words below, '
                  + 'and it is not counted as a booking.',
                    'Nothing in this window has been called off.'],
      };

      const tiles = STATES.map(s => {
        const n = isState(all, s).length;
        return kpi(s, count(n), muted(esc(BLURB[s][n ? 0 : 1])), n ? TONE_WHEN_PRESENT[s] : '');
      }).join('');

      const bookedTile = kpi('Counted as booked by the database', count(booked.length),
        muted('This figure is read out of the accessor’s own `counts_as_booked` column — true for CONFIRMED, ATTENDED '
          + 'and NO_SHOW, false for REQUESTED and OFFERED. It is not re-decided here, so a visit nobody agreed to can '
          + 'never be counted as one, whatever a later edit to this screen does.'),
        booked.length ? 't-ok' : '');

      const attendedTile = kpi('Recorded by a human as having walked in', count(attended.length),
        muted('`counts_as_attended` is true for ATTENDED alone. Nothing in NEXUS sets that state automatically: a '
          + 'confirmed slot stays CONFIRMED until a person says what happened, however long ago it was.'),
        attended.length ? 't-ok' : '');

      const awaitingTile = kpi('Passed, and nobody has said what happened', count(awaiting.length),
        muted(awaiting.length
          ? 'The slot has ended and no human has called it. These are neither attended nor no-shows, and this screen '
            + 'will not guess. They are listed separately below.'
          : 'No confirmed slot has passed without somebody recording the outcome.'),
        awaiting.length ? 't-hot' : '');

      const odd = unrecognised.length
        ? `<div class="banner hot" style="margin-top:12px">
             <span class="material-symbols-outlined" style="font-size:20px">report</span>
             <div>${bold('Some visits came back in a state this screen does not recognise.')}
               ${muted(esc(count(unrecognised.length)) + ' of ' + esc(count(all.length))
                 + ` ${plural(all.length, 'entry', 'entries')} carries a word that is none of the six. They are listed `
                 + 'below at face value and are counted in none of the six figures above. They are reported rather '
                 + 'than dropped: a visit nobody can account for is exactly the one worth naming.')}</div></div>`
        : '';

      const rule = `<div class="banner info" style="margin-top:16px">
          <span class="material-symbols-outlined" style="font-size:20px">info</span>
          <div>${bold('Asked, offered and agreed are three different things, and only the third is a booking.')}
            ${muted('REQUESTED means a customer asked and nothing has been proposed. OFFERED means we proposed times '
              + 'and they have not picked one. CONFIRMED means they agreed to a specific time — and even that is a '
              + 'promise rather than a visit, until a human records ATTENDED or NO_SHOW. Nothing on this page is '
              + 'averaged into a rate, because a rate would make all six of those read as fractions of the same '
              + 'thing.')}</div></div>`;

      const windowLine = `<div class="banner info" style="margin-top:12px">
          <span class="material-symbols-outlined" style="font-size:20px">schedule</span>
          <div>${bold('The window is ' + esc(String(WINDOW_DAYS)) + ' days, and three kinds of row ignore it.')}
            ${muted('These counts cover visits starting between yesterday and '
              + esc(String(WINDOW_DAYS)) + ' days from now. On top of that the accessor always returns everything '
              + 'still REQUESTED or OFFERED, and every confirmed slot that has passed with no outcome recorded, '
              + 'however old — so a visit forgotten in March appears here rather than ageing quietly out of view.')}
          </div></div>`;

      return `<div class="grid g3">${tiles}</div>`
        + `<div class="grid g3" style="margin-top:12px">${bookedTile}${attendedTile}${awaitingTile}</div>`
        + odd + rule + windowLine;
    },
  }).then(wireGo);

  /* ────────────────────────────────────────────────────────────────────────
     P2 · The diary itself
     ──────────────────────────────────────────────────────────────────────── */
  panel(host, {
    title: 'Every visit on record, and what is actually true of it',
    sub: 'In the order the accessor returns them — by the time they are for, or by the time they were asked for when '
       + 'no time exists yet. Every line carries the database’s own account, in words, of what state it is in, and '
       + 'NX1005’s own write actions where the row’s state allows one',
    load: loadDiary,
    render: ({ rows, mode }, card) => {
      const all = Array.isArray(rows) ? rows : [];
      card.__apptRows = all;
      card.__apptMode = mode;
      if (!all.length) {
        return stateEmpty('No showroom visit is on record for this dealership',
          'The accessor returned nothing. That is not a failure and it is not an all-clear either. It means one of '
          + 'two things this screen cannot tell apart: either no visit has ever been written to this database, or '
          + 'you are signed in with no dealership membership, in which case the accessor deliberately returns no '
          + 'rows rather than somebody else’s diary. Nothing is being ruled out about customers who arranged to come '
          + 'in by phone, by WhatsApp or at the door without anybody recording it here.',
          'event_busy');
      }
      return table([
        { label: 'When', strong: true, render: r => wrap(whenCell(r)) },
        { label: 'State', render: r => {
            const s = stateOf(r);
            const label = str(r.state) || 'NO STATE RECORDED';
            return `<div>${pill(label, s.tone, { verbatim: true })}</div>`
              + (STATE[up(r.state)]
                  ? muted(str(r.state_meaning)
                      ? esc(str(r.state_meaning))
                      : 'The state lookup returned no meaning for this word.')
                  : muted('This screen does not recognise that word, so it is shown exactly as the database returned '
                      + 'it and is counted in none of the figures above.'))
              + (isBooked(r)
                  ? muted('The database counts this as booked.')
                  : muted('The database does NOT count this as booked.'));
          } },
        { label: 'Customer', render: r => wrap(
            bold(esc(str(r.customer_name) || 'No customer name recorded'))
            + muted([str(r.channel) ? 'via ' + str(r.channel) : '', str(r.tenant_name)]
                .filter(Boolean).map(chip).join(' ')
              || 'No channel and no dealership name came back on this row.')) },
        { label: 'Vehicle', render: r => wrap(str(r.vehicle_model)
            ? esc(str(r.vehicle_model))
            : muted(str(r.inventory_id)
                ? 'Stock ' + esc(str(r.inventory_id)) + ', with no model recorded against it.'
                : 'No vehicle is attached to this visit. That is not a smaller visit — it is a visit nobody tied to '
                  + 'a car, so nothing here can say what they came to see.')) },
        { label: 'Who is expecting them', render: r => {
            const who = str(r.assigned_to_name);
            const res = str(r.resource);
            if (who || res) {
              return wrap(bold(esc(who || 'No salesperson assigned'))
                + muted(res ? 'Resource: ' + esc(res) : 'No resource (bay, desk or demo car) is attached.'));
            }
            return wrap(isUnprotected(r)
              ? hot('Nobody. No salesperson and no resource are attached, so nothing in the database stops this slot '
                  + 'being double-booked.')
              : muted('No salesperson and no resource are attached. The database does not treat this row as being at '
                  + 'risk of a double booking.'));
          } },
        { label: 'Where', render: r => wrap(str(r.location)
            ? esc(str(r.location))
            : muted('No location recorded.')) },
        { label: 'What this means', render: r => wrap(str(r.evidence)
            ? esc(str(r.evidence))
            : warm('The database recorded no explanation for this visit’s state, so none is being invented here.')) },
        { label: 'Act on it', render: r => actionsCell(r, mode) },
      ], all);
    },
  }).then(card => { wireGo(card); wireApptActions(card); });

  /* ────────────────────────────────────────────────────────────────────────
     P3 · The rows the clock cannot answer
     ──────────────────────────────────────────────────────────────────────
     Separated out deliberately. Mixed into the diary these look like ordinary
     confirmed bookings and get counted as though the customer came. They are
     the single most likely source of a fake attendance number in this product,
     which is why they get their own panel and their own words. */
  panel(host, {
    title: 'Passed, and nobody has said what happened',
    sub: 'Confirmed slots whose end time is behind us with no outcome recorded. NEXUS does not decide this from the '
       + 'clock — a person calls it ATTENDED or NO_SHOW, and until they do, this screen says only that nobody has',
    load,
    render: rows => {
      const all = Array.isArray(rows) ? rows : [];
      const open = all.filter(isAwaiting);
      const risky = all.filter(isUnprotected);

      const riskBanner = risky.length
        ? `<div class="banner hot" style="margin-top:12px">
             <span class="material-symbols-outlined" style="font-size:20px">warning</span>
             <div>${bold(esc(count(risky.length)) + ' confirmed '
                 + plural(risky.length, 'visit has', 'visits have')
                 + ' neither a salesperson nor a resource attached.')}
               ${muted('The database reports that per row as `slot_is_protected = false`: the double-booking '
                 + 'constraint only bites when a salesperson or a resource is named, so these slots can be booked '
                 + 'over without anything refusing it. They are marked in the diary above.')}</div></div>`
        : '';

      if (!open.length) {
        return riskBanner + stateEmpty('No confirmed slot has passed without an outcome',
          'Either nothing confirmed has finished yet, or a person has already recorded what happened to everything '
          + 'that has. This is not a claim that everybody turned up — it is a claim that nothing is sitting '
          + 'unanswered.',
          'task_alt');
      }

      return riskBanner + table([
        { label: 'The slot', strong: true, render: r => wrap(whenCell(r)) },
        { label: 'Customer', render: r => wrap(esc(str(r.customer_name) || 'No customer name recorded')) },
        { label: 'Agreed on', render: r => wrap(r.confirmed_at
            ? bold(esc(dubaiStamp(r.confirmed_at))) + muted(esc(ago(r.confirmed_at)))
            : muted('No confirmation time is recorded, although the row is CONFIRMED.')) },
        { label: 'Who was expecting them', render: r => wrap(str(r.assigned_to_name)
            ? esc(str(r.assigned_to_name))
            : muted('No salesperson assigned, so there is no obvious person to ask what happened.')) },
        { label: 'What this means', render: r => wrap(str(r.evidence)
            ? esc(str(r.evidence))
            : warm('The database recorded no explanation, so none is being invented here.')) },
      ], open);
    },
  }).then(wireGo);

  /* ────────────────────────────────────────────────────────────────────────
     P4 · The limits of this screen
     ──────────────────────────────────────────────────────────────────────
     Fixed rows. They are true whether or not the read above succeeded, which is
     why this panel takes the soft load: a screen whose job is to state what it
     cannot tell you must not go blank at exactly the moment it knows least. */
  panel(host, {
    title: 'What this screen cannot tell you',
    sub: 'Six things outside what the database can answer. They are listed because a dashboard that only shows what '
       + 'it knows reads as though it knows everything',
    load: loadSoft,
    render: ({ v, err }) => {
      const all = err ? null : (Array.isArray(v) ? v : []);
      const risky = all ? all.filter(isUnprotected) : null;
      const awaiting = all ? all.filter(isAwaiting) : null;

      const rows = [
        { limit: 'Nothing books itself. Every row here was written by a person, through this screen or the lead drawer.',
          why: 'NX995 built the write path — request, offer, confirm, attend, cancel — granted to service_role alone. '
             + 'NX1005 (21 Sep 2026) put tenant-scoped wrappers in front of it so a signed-in dealer can call it '
             + 'directly — "Book visit" on a lead, and the Act on it buttons above — but no workflow and no channel '
             + 'writes to it automatically. So this diary only ever contains what somebody put in it deliberately, '
             + 'and a customer who asked for a visit through any channel does NOT appear here until a person opens '
             + 'this product and writes the row themselves.' },
        { limit: 'There is no calendar anywhere.',
          why: 'Nothing on this page is synchronised to Google, Outlook or any showroom diary. A confirmed slot lives '
             + 'in this database and nowhere else, so a salesperson who never opens this screen has no way of knowing '
             + 'the customer is coming.' },
        { limit: 'Nobody is reminded of anything.',
          why: 'NEXUS sends no confirmation, no reminder and no follow-up about any visit on this page. A customer '
             + 'who agreed to Saturday has heard nothing from this system since, and a CONFIRMED pill is not '
             + 'evidence that they still remember.' },
        { limit: 'There is no capacity model.',
          why: 'Nothing here knows how many customers the showroom can take at once, how long a test drive really '
             + 'occupies a car, or who is rostered on. Twenty confirmed visits in one hour would render exactly as '
             + 'calmly as two.' },
        { limit: 'A confirmed visit with no salesperson and no resource is outside the double-booking constraint.',
          why: 'The constraint that stops two customers being promised the same slot only applies when a salesperson '
             + 'or a resource is attached to the row. With neither, nothing refuses an overlap. The accessor reports '
             + 'that per row as `slot_is_protected`, and it is surfaced above rather than left implicit. '
             + (risky == null
                  ? 'The diary could not be read on this visit, so no count of those rows is being stated here.'
                  : risky.length
                    ? `${esc(String(risky.length))} of the ${esc(String(all.length))} ${plural(all.length, 'row', 'rows')} read on this visit `
                      + `${plural(risky.length, 'is', 'are')} in exactly that position.`
                    : 'No row read on this visit is in that position.') },
        { limit: 'Attendance is only ever what a human wrote down.',
          why: 'ATTENDED and NO_SHOW are set by a person. This screen will never promote a passed slot into either, '
             + 'and a passed slot with no outcome is reported as a question rather than an answer. '
             + (awaiting == null
                  ? 'The diary could not be read on this visit, so no count of those rows is being stated here.'
                  : awaiting.length
                    ? `${esc(String(awaiting.length))} ${plural(awaiting.length, 'slot is', 'slots are')} waiting on somebody `
                      + 'right now.'
                    : 'Nothing is waiting on somebody right now.') },
      ];

      const head = err
        ? `<div class="banner warm">
             <span class="material-symbols-outlined" style="font-size:20px">warning</span>
             <div>${bold('The appointment diary could not be read on this visit.')}
               ${muted(esc(str(err.message) || 'No reason was given.')
                 + ' The six limits below are true regardless, so they are still shown. The panels above are unread '
                 + 'rather than empty — no visit is being confirmed and none is being written off.')}</div></div>`
        : '';

      return head + table([
        { label: 'What it cannot tell you', strong: true, render: r => wrap(esc(r.limit)) },
        { label: 'Why', render: r => wrap(esc(r.why)) },
      ], rows);
    },
  }).then(wireGo);
};
