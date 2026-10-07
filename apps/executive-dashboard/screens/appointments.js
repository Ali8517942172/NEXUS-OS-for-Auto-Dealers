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

import { ME, db, dbWrite, onIdentityChange } from '../lib/data.js';
import { el } from '../lib/dom.js';
import { loadSubscription, isReadOnly } from '../lib/subscription.js';
import { ago, dubaiDate, dubaiStamp, esc, n0 } from '../lib/format.js';
import { leadDrawer, bookVisitDialog } from '../lib/lead-drawer.js';
import { displayName, maskPhone } from '../lib/privacy.js';
import { BTN, comingSoonPanel, emptyState, errorState, kpiTile, openStitchDrawer, openStitchModal, skeleton, statusChip, trustFooter } from '../lib/stitch-ui.js';
import { SCREENS, go } from '../lib/nav.js';

/* ── Small local vocabulary ───────────────────────────────────────────────── */
const str = v => String(v == null ? '' : v).trim();
const up  = v => str(v).toUpperCase();
const plural = (c, one, many) => (Number(c) === 1 ? one : many);
const muted = h => `<div class="ds-cell-sub">${h}</div>`;
const hot   = h => `<div class="ds-cell-sub t-hot">${h}</div>`;
const warm  = h => `<div class="ds-cell-sub t-warm">${h}</div>`;
const bold  = h => `<div style="font-weight:600">${h}</div>`;
const wrap  = h => `<div style="white-space:normal">${h}</div>`;
const chip  = t => `<span class="chip">${esc(t)}</span>`;

/* ── Stitch vocabulary (complete, literal class strings) ───────────────────
   Copied from the appointments-* exports in design/stitch/. The dialogs keep
   lib/modal.js's contract through openStitchModal(), which returns the same
   { wrap, close, msg }; this one-line adapter keeps their call sites intact. */
const openModal = (title, bodyHtml, footHtml) => openStitchModal({ title, bodyHtml, footHtml });
const FIELD = 'w-full h-9 px-3 rounded-lg bg-surface-container-low border border-outline-variant/50 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary';
const ACT_BTN = {
  attend:  'inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-body-sm text-[12px] font-semibold hover:bg-emerald-100 transition-colors disabled:text-outline disabled:bg-surface-container-low disabled:border-outline-variant disabled:cursor-not-allowed',
  no_show: 'inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-50 text-rose-700 border border-rose-200 font-body-sm text-[12px] font-semibold hover:bg-rose-100 transition-colors disabled:text-outline disabled:bg-surface-container-low disabled:border-outline-variant disabled:cursor-not-allowed',
  cancel:  'inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-container-lowest text-on-surface-variant border border-outline-variant font-body-sm text-[12px] font-semibold hover:bg-surface-container transition-colors disabled:text-outline disabled:cursor-not-allowed',
  offer:   'inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-container-lowest text-primary border border-outline-variant font-body-sm text-[12px] font-semibold hover:bg-surface-container transition-colors disabled:text-outline disabled:cursor-not-allowed',
  confirm: 'inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-primary text-on-primary font-body-sm text-[12px] font-semibold hover:bg-primary-container transition-colors disabled:bg-outline-variant/40 disabled:text-outline disabled:cursor-not-allowed',
};
const NOTE = {
  info: 'flex items-start gap-2.5 p-3 rounded-lg border border-blue-200 bg-blue-50/60 text-blue-950 font-body-sm text-body-sm',
  warm: 'flex items-start gap-2.5 p-3 rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm',
  hot:  'flex items-start gap-2.5 p-3 rounded-lg border border-red-200 bg-red-50/60 text-red-950 font-body-sm text-body-sm',
};
const note = (t, icon, html) =>
  `<div class="${NOTE[t] || NOTE.info}"><span class="material-symbols-outlined text-[18px] shrink-0">${esc(icon)}</span><div class="min-w-0 flex-1">${html}</div></div>`;
/* The six words, each with its own chip. Icon + word, never colour alone. */
const STATE_CHIP = {
  REQUESTED: 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-label-numeric-sm text-[11px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700',
  OFFERED:   'inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-label-numeric-sm text-[11px] font-bold uppercase tracking-wider bg-amber-50 text-amber-800',
  CONFIRMED: 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-label-numeric-sm text-[11px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700',
  ATTENDED:  'inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-label-numeric-sm text-[11px] font-bold uppercase tracking-wider bg-sky-50 text-sky-700',
  NO_SHOW:   'inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-label-numeric-sm text-[11px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700',
  CANCELLED: 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-label-numeric-sm text-[11px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-600',
  OTHER:     'inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-label-numeric-sm text-[11px] font-bold uppercase tracking-wider bg-zinc-100 text-zinc-700',
};
const STATE_DOT = {
  REQUESTED: 'w-1.5 h-1.5 rounded-full bg-slate-500', OFFERED: 'w-1.5 h-1.5 rounded-full bg-amber-500',
  CONFIRMED: 'w-1.5 h-1.5 rounded-full bg-emerald-600', ATTENDED: 'w-1.5 h-1.5 rounded-full bg-sky-600',
  NO_SHOW: 'w-1.5 h-1.5 rounded-full bg-rose-600', CANCELLED: 'w-1.5 h-1.5 rounded-full bg-zinc-400', OTHER: 'w-1.5 h-1.5 rounded-full bg-zinc-400',
};
const stateChip = s => {
  const k = STATE[up(s)] ? up(s) : 'OTHER';
  return `<span class="${STATE_CHIP[k]}"${k === 'OTHER' ? ' title="This screen does not recognise that state, so it is shown exactly as the database returned it."' : ''}><span class="${STATE_DOT[k]}"></span>${esc(str(s) || 'NO STATE RECORDED')}</span>`;
};
const SLOT_BAR = { CONFIRMED: 'w-1 self-stretch rounded-full bg-primary', OFFERED: 'w-1 self-stretch rounded-full bg-amber-400', REQUESTED: 'w-1 self-stretch rounded-full bg-slate-300', ATTENDED: 'w-1 self-stretch rounded-full bg-sky-500', NO_SHOW: 'w-1 self-stretch rounded-full bg-rose-500', CANCELLED: 'w-1 self-stretch rounded-full bg-zinc-300', OTHER: 'w-1 self-stretch rounded-full bg-zinc-300' };
const TAB = {
  on:  'px-3 py-1 rounded-md bg-surface-container-lowest text-primary font-body-sm text-body-sm font-semibold shadow-sm',
  off: 'px-3 py-1 rounded-md text-on-surface-variant hover:text-on-surface font-body-sm text-body-sm font-medium transition-colors',
};
const SECTION = 'rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm';
const TH = 'px-3 py-2.5 font-table-header text-table-header uppercase tracking-wider text-outline text-left';
const TD = 'px-3 py-2.5 align-top font-body-sm text-body-sm text-on-surface';
const actorName = () => String((ME && (ME.name || ME.email)) || 'Signed-in user');

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
  ? `<button type="button" class="${BTN.secondary}" data-go="${esc(id)}">${esc(label)}</button>`
  : `<button type="button" class="${BTN.secondary}" disabled title="${esc(label)} is not part of this build: the navigation offers the screen and no module in this bundle registers it.">${esc(label)} — not in this build</button>`);
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

   A read-only subscription (lib/subscription.js's isReadOnly(), backed by
   nexus_my_subscription() -- task A's single subscription-access mechanism,
   the same one setWriteGuard() enforces app-wide) disables every one of
   them, shown and disabled rather than hidden, the same rule as the rest of
   this product. An unread or failed subscription read is never read-only
   (see lib/subscription.js), so nothing here blocks on a read that has not
   resolved yet. */
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
    `<button type="button" class="${ACT_BTN[action] || ACT_BTN.offer}" data-appt-id="${esc(r.appointment_id)}" data-appt-action="${action}"${ro ? ' disabled' : ''}${roTitle}>${esc(label)}</button>`
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
    return `<select id="apSales" class="${FIELD}"><option value="">Unassigned</option>${users.map(u =>
      `<option value="${esc(u.id)}"${u.id === selectedId ? ' selected' : ''}>${esc(u.name)}${u.status === 'pending_invite' ? ' (pending invite)' : ''}</option>`
    ).join('')}</select>`;
  } catch (e) {
    return `<span class="t-hot">The staff list could not be read (${esc(e.message || String(e))}).</span>`;
  }
}

function offerDialog(row) {
  const m = openModal(`Offer times \u2014 appointment ${row.appointment_id}`, `
    <div class="ds-cell-sub" style="margin-bottom:12px">Up to three times to propose. At least one is required. This
      replaces any times previously offered on this visit \u2014 nexus_appointment_offer_slots' own rule, not this
      dialog's.</div>
    <label class="ds-cell-sub" for="apSlot1" style="display:block">Slot 1</label>
    <input id="apSlot1" type="datetime-local" class="${FIELD}">
    <label class="ds-cell-sub" for="apSlot2" style="display:block;margin-top:8px">Slot 2 (optional)</label>
    <input id="apSlot2" type="datetime-local" class="${FIELD}">
    <label class="ds-cell-sub" for="apSlot3" style="display:block;margin-top:8px">Slot 3 (optional)</label>
    <input id="apSlot3" type="datetime-local" class="${FIELD}">
  `, `<button type="button" class="${BTN.secondary}" id="apCancel">Cancel</button><button type="button" class="${BTN.primary}" id="apGo">Offer</button>`);
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
    <div class="ds-cell-sub" style="margin-bottom:12px">Books this visit for one specific time. The EXCLUDE USING gist
      double-booking constraint still applies: a salesperson or resource already booked over this time is refused,
      in nexus_appointment_confirm's own words, below.</div>
    <label class="ds-cell-sub" for="apWhen" style="display:block">When</label>
    <input id="apWhen" type="datetime-local" class="${FIELD}">
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">
      <div style="flex:1;min-width:160px">
        <label class="ds-cell-sub" for="apDuration" style="display:block">Duration (minutes)</label>
        <input id="apDuration" type="number" min="5" step="5" value="45" class="${FIELD}">
      </div>
      <div style="flex:1;min-width:220px">
        <label class="ds-cell-sub" for="apSalesWrap" style="display:block">Salesperson (optional)</label>
        <div id="apSalesWrap" class="ds-cell-sub">Loading staff\u2026</div>
      </div>
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px">
      <div style="flex:1;min-width:160px">
        <label class="ds-cell-sub" for="apLocation" style="display:block">Location (optional)</label>
        <input id="apLocation" type="text" maxlength="120" class="${FIELD}">
      </div>
      <div style="flex:1;min-width:160px">
        <label class="ds-cell-sub" for="apResource" style="display:block">Resource (optional)</label>
        <input id="apResource" type="text" maxlength="120" class="${FIELD}" placeholder="bay, desk, demo car">
      </div>
    </div>
  `, `<button type="button" class="${BTN.secondary}" id="apCancel">Cancel</button><button type="button" class="${BTN.primary}" id="apGo">Confirm</button>`);
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
    <div class="ds-cell-sub" style="margin-bottom:12px">Recorded as a human's own account of what happened. NEXUS never
      infers this from the clock \u2014 see "The clock is not a witness" at the top of this screen.</div>
    <label class="ds-cell-sub" for="apReason" style="display:block">Reason / note (optional)</label>
    <input id="apReason" type="text" maxlength="400" class="${FIELD}">
  `, `<button type="button" class="${BTN.secondary}" id="apCancel">Cancel</button><button type="button" class="${BTN.primary}" id="apGo">${esc(label)}</button>`);
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
    <div class="ds-cell-sub" style="margin-bottom:12px">nexus_appointment_cancel refuses a cancel with no reason given,
      in its own words \u2014 this dialog does not duplicate that check client-side.</div>
    <label class="ds-cell-sub" for="apReason" style="display:block">Reason</label>
    <input id="apReason" type="text" maxlength="400" class="${FIELD}" placeholder="e.g. customer asked to cancel">
  `, `<button type="button" class="${BTN.secondary}" id="apBack">Back</button><button type="button" class="${BTN.destructive}" id="apGo">Cancel visit</button>`);
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
      '<div class="ds-cell-sub">This dealership\u2019s subscription is in a read-only state, so nothing on this '
      + 'appointment can be written until it is resolved.</div>',
      `<button type="button" class="${BTN.secondary}" id="apClose">Close</button>`);
    m.wrap.querySelector('#apClose').addEventListener('click', () => m.close());
    return;
  }
  if (kind === 'offer') return offerDialog(row);
  if (kind === 'confirm') return confirmDialog(row);
  if (kind === 'attend' || kind === 'no_show') return outcomeDialog(kind, row);
  if (kind === 'cancel') return cancelDialog(row);
}

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
   SCREEN — Stitch layout, 7 Oct 2026
   ══════════════════════════════════════════════════════════════════════════
   design/stitch/appointments-showroom-visits-contextual-drawer--5a2c6d.html is
   the layout (header, state tabs, list/calendar switch, the diary table and the
   per-visit drawer). From --43862a: the six-word tiles, "Passed, and nobody has
   said what happened" with its row actions, and "What this screen cannot tell
   you". From --a539b3: the calendar-sync banner, the day timeline and the three
   side panels — bay capacity, consultant roster and no-show prevention — each of
   which has no backing data and is shown COMING SOON with the reason.

   Every count still comes from nexus_appointment_status(), every booking claim
   from its own `counts_as_booked`, and the clock still produces exactly one
   thing: `awaiting_outcome`. */
const dayKey = r => (r.starts_at ? dubaiDate(r.starts_at, '') : '');

/* The per-visit drawer: what the row says, in the order a visit happens. The
   journey is built from the row's own timestamps — requested, offered,
   confirmed, starts, closed — and a stamp the row does not carry is not drawn. */
function apptDrawer(r, mode, onAct) {
  const steps = [
    r.requested_at ? ['Requested', r.requested_at, 'A customer asked to come in.'] : null,
    Array.isArray(r.offered_slots) && r.offered_slots.length
      ? ['Times offered', null, r.offered_slots.map(t => dubaiStamp(t)).join(' · ')] : null,
    r.confirmed_at ? ['Confirmed', r.confirmed_at, 'The customer agreed to one time.'] : null,
    r.starts_at ? ['Slot', r.starts_at, r.ends_at ? `Ends ${dubaiStamp(r.ends_at)}` : 'No end time recorded.'] : null,
    r.closed_at ? [`Closed as ${str(r.state)}`, r.closed_at, str(r.evidence) || 'No explanation recorded.'] : null,
  ].filter(Boolean);
  const list = ACTIONS_BY_STATE[up(r.state)] || [];
  const ro = !!(mode && mode.readOnly);
  const d = openStitchDrawer({
    icon: 'event',
    title: displayName(str(r.customer_name) || 'No customer name recorded', r.lead_id),
    sub: `Appointment ${str(r.appointment_id).slice(0, 8)} · ${str(r.channel) || 'no channel'}`,
    bodyHtml: `
      <div class="bg-surface-container-lowest rounded-lg border border-outline-variant/40 p-space-md flex flex-col gap-2">
        <div class="flex items-center gap-2 flex-wrap">${stateChip(r.state)}
          <span class="font-label-numeric-sm text-label-numeric-sm text-outline">${isBooked(r) ? 'The database counts this as booked.' : 'The database does NOT count this as booked.'}</span></div>
        <div class="font-body-sm text-body-sm text-on-surface">${str(r.state_meaning) ? esc(str(r.state_meaning)) : 'The state lookup returned no meaning for this word.'}</div>
        ${str(r.evidence) ? `<div class="ds-cell-sub" style="white-space:normal">${esc(str(r.evidence))}</div>` : ''}
        ${isAwaiting(r) ? note('warm', 'help', 'The slot has ended and no person has said what happened. NEXUS does not decide this from the clock.') : ''}
        ${isUnprotected(r) ? note('hot', 'warning', 'No salesperson and no resource are attached, so nothing in the database stops this slot being double-booked.') : ''}
      </div>
      <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Customer context</div>
      <div class="bg-surface-container-lowest rounded-lg border border-outline-variant/40 p-space-md grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2 font-body-sm text-body-sm">
        <span class="text-outline">Customer</span><span>${esc(displayName(str(r.customer_name) || 'No customer name recorded', r.lead_id))}</span>
        <span class="text-outline">Lead</span><span>${r.lead_id != null ? `#${esc(String(r.lead_id))}` : 'No lead attached'}</span>
        <span class="text-outline">Channel</span><span>${esc(str(r.channel) || '—')}</span>
        <span class="text-outline">Expected by</span><span>${esc(str(r.assigned_to_name) || 'No salesperson assigned')}</span>
        <span class="text-outline">Where</span><span>${esc(str(r.location) || 'No location recorded')}${str(r.resource) ? ` · ${esc(str(r.resource))}` : ''}</span>
      </div>
      <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Vehicle</div>
      <div class="bg-surface-container-lowest rounded-lg border border-outline-variant/40 p-space-md font-body-sm text-body-sm">
        ${str(r.vehicle_model) ? `<div class="font-semibold">${esc(str(r.vehicle_model))}</div>` : '<div class="text-outline">No vehicle is attached to this visit.</div>'}
        ${str(r.inventory_id) ? `<div class="ds-cell-sub">Stock ${esc(str(r.inventory_id))}</div>` : ''}
      </div>
      ${comingSoonPanel({ icon: 'checklist', title: 'Vehicle prep status',
        body: 'Fuel, trade plate, key location and valet checks for the car this customer is coming to see.',
        prerequisite: 'A prep checklist per unit; nothing in the database records one today.' })}
      <div class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">Visit journey</div>
      <div class="bg-surface-container-lowest rounded-lg border border-outline-variant/40 p-space-md flex flex-col gap-3">
        ${steps.length ? steps.map(([label, at, sub]) => `<div class="flex gap-3">
          <span class="w-2.5 h-2.5 rounded-full bg-primary mt-1.5 shrink-0"></span>
          <div class="min-w-0 flex-1"><div class="flex items-center justify-between gap-2"><span class="font-body-sm text-body-sm font-semibold">${esc(label)}</span>
            ${at ? `<span class="font-label-numeric-sm text-label-numeric-sm text-outline">${esc(dubaiStamp(at))}</span>` : ''}</div>
            <div class="ds-cell-sub" style="white-space:normal">${esc(sub)}</div></div></div>`).join('')
          : '<div class="ds-cell-sub">This visit carries no timestamps beyond its state.</div>'}
      </div>`,
    footHtml: `<div class="flex items-center gap-2 flex-wrap">
        ${r.lead_id != null ? `<button type="button" class="${BTN.secondary}" data-open-lead="${esc(String(r.lead_id))}"><span class="material-symbols-outlined text-[18px]">person</span>Open lead</button>` : ''}
        ${list.map(([action, label]) => `<button type="button" class="${action === 'attend' || action === 'confirm' ? BTN.primary : BTN.secondary}" data-drawer-act="${action}"${ro ? ' disabled title="This dealership’s subscription is in a read-only state."' : ''}>${esc(label)}</button>`).join('')}
      </div>
      ${list.length ? '' : `<div class="ds-cell-sub">${STATE[up(r.state)] ? `No further action — this visit is already ${esc(str(r.state))}.` : 'This screen does not recognise this state, so it offers no action on it rather than guessing one.'}</div>`}
      <div class="ds-cell-sub" data-drawer-msg></div>`,
  });
  d.querySelectorAll('[data-drawer-act]').forEach(b => b.addEventListener('click', () => onAct(b.dataset.drawerAct, r)));
  d.querySelector('[data-open-lead]')?.addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const rows = await db(`leads?select=*,users(id,name)&id=eq.${encodeURIComponent(b.dataset.openLead)}&limit=1`);
      if (rows && rows.length) leadDrawer(rows[0]);
      else d.querySelector('[data-drawer-msg]').innerHTML = '<span class="t-warm">That lead is not readable now — it may have been removed.</span>';
    } catch (err) {
      d.querySelector('[data-drawer-msg]').innerHTML = `<span class="t-hot">The lead could not be read — ${esc(err.message || String(err))}</span>`;
    } finally { b.disabled = false; }
  });
}

/* "Schedule appointment". A visit always belongs to a lead in this database
   (nexus_my_appointment_request takes p_lead_id), so the button picks the lead
   first and then opens the same Book visit dialog the lead drawer uses — one
   write path, not a second. */
async function scheduleDialog() {
  const m = openStitchModal({
    title: 'Schedule an appointment',
    bodyHtml: `<div class="flex flex-col gap-3">
      <p class="font-body-sm text-body-sm text-on-surface-variant">Every visit belongs to a lead. Pick the lead, then choose the time on the next step. A walk-in who is not a lead yet is recorded on Record a Lead first.</p>
      <input type="search" data-pick-q class="${FIELD}" placeholder="Search leads by name or number" aria-label="Search leads">
      <div data-pick-list class="flex flex-col gap-1 max-h-[320px] overflow-y-auto"><div class="ds-cell-sub">Loading leads…</div></div>
    </div>`,
    footHtml: `<button type="button" class="${BTN.secondary}" data-pick-cancel>Cancel</button>`,
  });
  m.wrap.querySelector('[data-pick-cancel]').addEventListener('click', m.close);
  let leads = [];
  try {
    leads = await db('leads?select=*,users(id,name)&order=created_at.desc&limit=200') || [];
  } catch (e) {
    m.wrap.querySelector('[data-pick-list]').innerHTML = `<span class="t-hot">Your leads could not be read (${esc(e.message || String(e))}), so there is nothing to book a visit for from here.</span>`;
    return;
  }
  const draw = qx => {
    const qq = String(qx || '').trim().toLowerCase();
    const rows = leads.filter(l => !qq || `${l.name || ''} ${l.phone || ''} ${l.id}`.toLowerCase().includes(qq)).slice(0, 50);
    const box = m.wrap.querySelector('[data-pick-list]');
    box.innerHTML = rows.length ? rows.map(l => `<button type="button" data-pick-lead="${esc(String(l.id))}" class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-surface-container-low text-left">
        <span class="font-body-sm text-body-sm font-semibold text-on-surface">${esc(displayName(l.name, l.id))}</span>
        <span class="font-label-numeric-sm text-label-numeric-sm text-outline">#${esc(String(l.id))}${l.phone ? ` · ${esc(maskPhone(l.phone))}` : ''}</span></button>`).join('')
      : '<div class="ds-cell-sub">No lead matches.</div>';
    box.querySelectorAll('[data-pick-lead]').forEach(b => b.addEventListener('click', async () => {
      const lead = leads.find(l => String(l.id) === b.dataset.pickLead);
      if (!lead) return;
      await loadSubscription();
      if (isReadOnly()) { m.msg('<span class="t-hot">This dealership’s subscription is in a read-only state, so a visit cannot be booked until it is resolved.</span>'); return; }
      m.close();
      bookVisitDialog(lead);
    }));
  };
  draw('');
  m.wrap.querySelector('[data-pick-q]').addEventListener('input', e => draw(e.target.value));
}

SCREENS.appointments = async host => {
  /* `nx-stitch` on a wrapper this screen appends, never on `#screen`. */
  const root = el('div', 'nx-stitch flex flex-col gap-space-md');
  host.appendChild(root);
  resetReads();
  const readAt = new Date();

  root.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-space-sm">
      <div class="min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="font-table-header text-table-header uppercase tracking-wider text-outline">Work</span>
          <span class="font-table-header text-table-header text-outline-variant">/</span>
          <span class="font-table-header text-table-header uppercase tracking-wider text-primary font-semibold">Calendar &amp; visits</span>
          <span data-head-chip></span>
        </div>
        <h1 class="font-headline-lg text-headline-lg text-on-surface mt-1">Appointments</h1>
        <p class="font-body-md text-body-md text-on-surface-variant mt-0.5 max-w-3xl">Every showroom visit on record, and which of six different things is actually true of it. Asked, offered and agreed are three different words, and only the third is a booking.</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        ${linkBtn('leads', 'Open Leads')}
        <button type="button" class="${BTN.primary}" data-schedule><span class="material-symbols-outlined text-[18px]">add_circle</span>Schedule appointment</button>
      </div>
    </div>
    <div class="rounded-xl border border-indigo-200 bg-indigo-50/30 p-space-md flex items-start gap-3">
      <span class="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[20px]">sync_disabled</span></span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap"><span class="font-headline-md text-body-lg font-semibold text-indigo-950">Not connected — there is no calendar sync</span>${statusChip('planned')}</div>
        <p class="font-body-sm text-body-sm text-indigo-900 mt-0.5">This diary lives in NEXUS and nowhere else. Nothing is synchronised to Google, Outlook or a showroom kiosk, and NEXUS sends no confirmation or reminder about any visit — a salesperson who never opens this screen has no way of knowing a customer is coming.</p>
      </div>
      <button type="button" disabled class="px-3 py-1.5 rounded-lg bg-surface-container-high text-outline font-body-sm text-body-sm font-semibold cursor-not-allowed shrink-0" title="Calendar integration is planned, not built.">Connect calendar (planned)</button>
    </div>
    <div data-tiles>${skeleton({ rows: 2 })}</div>
    <div data-awaiting></div>
    <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-space-md items-start">
      <div data-diary>${skeleton({ rows: 4 })}</div>
      <div class="flex flex-col gap-space-md">
        ${comingSoonPanel({ icon: 'garage', title: 'Floor bay capacity', body: 'How many bays, desks and demo cars are free at each hour.', prerequisite: 'A capacity model — nothing here knows how many customers the showroom can take at once or how long a test drive occupies a car.' })}
        ${comingSoonPanel({ icon: 'badge', title: 'Consultant roster', body: 'Who is on the floor, with a client, or off duty right now.', prerequisite: 'A staff roster or shift record; the users table carries no presence or rota.' })}
        ${comingSoonPanel({ icon: 'notifications_active', title: 'No-show prevention', body: 'Confirmation pings to customers who have not confirmed close to their slot.', prerequisite: 'A reminder workflow and an approved WhatsApp template; NEXUS sends nothing about visits today.' })}
      </div>
    </div>
    <div data-limits></div>
    <div data-foot></div>`;
  const q = s => root.querySelector(s);
  q('[data-schedule]').addEventListener('click', scheduleDialog);
  wireGo(root);

  let rows = null, readErr = null, mode = { readOnly: false };
  try {
    const [r] = await Promise.all([readAppointments(), loadSubscription()]);
    rows = Array.isArray(r) ? r : [];
    mode = { readOnly: isReadOnly() };
  } catch (e) { readErr = e; }
  if (!root.isConnected) return;

  const act = (kind, r) => openApptAction(kind, r, mode);

  if (readErr) {
    q('[data-tiles]').innerHTML = errorState({ what: 'the appointment diary', err: readErr });
    q('[data-diary]').innerHTML = '';
  } else {
    const all = rows;
    const unrecognised = all.filter(r => !STATE[up(r.state)]);
    const booked = all.filter(isBooked);
    const attended = all.filter(isAttended);
    const awaiting = all.filter(isAwaiting);
    const risky = all.filter(isUnprotected);

    q('[data-head-chip]').innerHTML = `<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-container text-on-surface font-label-numeric-sm text-label-numeric-sm"><span class="w-1.5 h-1.5 rounded-full bg-primary"></span>${count(all.length)} on record · ${count(booked.length)} counted as booked</span>`;

    /* ── P1 · The six words, counted separately ─────────────────────────── */
    const BLURB = {
      REQUESTED: ['A customer asked to come in and no time has been proposed. This is not a booking — every one is waiting on somebody here.', 'Nobody is waiting on us for a time to be offered.'],
      OFFERED:   ['Times were proposed and the customer has not agreed to any. Not a booking either.', 'Nothing is sitting with a customer waiting for them to pick a time.'],
      CONFIRMED: ['The customer agreed to one specific time. The only state that is a booking — and still a promise.', 'Nobody has agreed to a time. There is no booking in this window at all.'],
      ATTENDED:  ['A person recorded that the customer walked in — the only figure describing somebody who was actually here.', 'Nobody has been recorded as walking in. That is not a statement that nobody came.'],
      NO_SHOW:   ['A person recorded that the customer did not walk in. Recorded, never inferred from the clock.', 'No visit has been called a no-show by anybody.'],
      CANCELLED: ['Called off, by the customer or the dealership. Not counted as a booking.', 'Nothing in this window has been called off.'],
    };
    const tile = s => {
      const n = isState(all, s).length;
      return `<div class="bg-surface-container-lowest rounded-xl border border-outline-variant/40 shadow-sm p-space-md flex flex-col gap-2">
        <div class="flex items-center justify-between">${stateChip(s)}</div>
        <div class="font-label-numeric-lg text-[2rem] leading-none font-bold text-on-surface">${count(n)}</div>
        <p class="font-body-sm text-body-sm text-on-surface-variant pt-2 border-t border-outline-variant/30">${esc(BLURB[s][n ? 0 : 1])}</p>
      </div>`;
    };
    q('[data-tiles]').innerHTML = `<div class="flex flex-col gap-space-md">
      <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-space-md">${STATES.map(tile).join('')}</div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-space-md">
        ${kpiTile({ label: 'Counted as booked by the database', value: count(booked.length), sub: 'Read from the accessor’s own counts_as_booked — true for CONFIRMED, ATTENDED and NO_SHOW. Never re-decided here.' })}
        ${kpiTile({ label: 'Recorded by a person as having walked in', value: count(attended.length), sub: 'counts_as_attended is true for ATTENDED alone. Nothing sets it automatically.' })}
        ${kpiTile({ label: 'Passed, and nobody has said what happened', value: count(awaiting.length), sub: awaiting.length ? 'Neither attended nor no-shows — listed below, and this screen will not guess.' : 'No confirmed slot has passed without somebody recording the outcome.' })}
      </div>
      ${unrecognised.length ? note('hot', 'report', `<strong>Some visits came back in a state this screen does not recognise.</strong> ${esc(count(unrecognised.length))} of ${esc(count(all.length))} ${plural(all.length, 'entry carries', 'entries carry')} a word that is none of the six. They are listed at face value and counted in none of the six figures.`) : ''}
      ${note('info', 'schedule', `<strong>The window is ${esc(String(WINDOW_DAYS))} days, and three kinds of row ignore it.</strong> Counts cover visits starting between yesterday and ${esc(String(WINDOW_DAYS))} days from now. On top of that the accessor always returns everything still REQUESTED or OFFERED, and every confirmed slot that passed with no outcome, however old — so a forgotten visit appears here rather than ageing out of view.`)}
    </div>`;

    /* ── P3 · The rows the clock cannot answer ─────────────────────────────
       Separated out deliberately: mixed into the diary these look like ordinary
       confirmed bookings and get counted as though the customer came. */
    q('[data-awaiting]').innerHTML = (risky.length ? note('hot', 'warning', `<strong>${esc(count(risky.length))} confirmed ${plural(risky.length, 'visit has', 'visits have')} neither a salesperson nor a resource attached.</strong> The database reports that per row as slot_is_protected = false: the double-booking constraint only bites when one is named, so these slots can be booked over without anything refusing it.`) : '')
      + (awaiting.length ? `<section class="rounded-xl border border-amber-200 overflow-hidden shadow-sm bg-surface-container-lowest ${risky.length ? 'mt-space-md' : ''}">
        <div class="px-space-md py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-start gap-3"><span class="w-8 h-8 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center"><span class="material-symbols-outlined text-[18px]">pending_actions</span></span>
            <div><div class="font-headline-md text-body-lg font-semibold text-amber-950">Passed, and nobody has said what happened</div>
            <div class="font-body-sm text-body-sm text-amber-900">Confirmed slots whose end time is behind us with no outcome recorded. A person calls it ATTENDED or NO_SHOW; until they do, this screen says only that nobody has.</div></div></div>
          <span class="px-2.5 py-1 rounded-full bg-amber-700 text-white font-label-numeric-sm text-label-numeric-sm font-bold">${count(awaiting.length)} unresolved</span>
        </div>
        <div class="divide-y divide-outline-variant/20">${awaiting.map(r => `
          <div class="px-space-md py-3 flex items-start gap-4 flex-wrap">
            <div class="min-w-[180px]"><span class="inline-flex px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-label-numeric-sm text-[11px] font-bold uppercase">Unresolved</span>
              <div class="font-label-numeric-sm text-label-numeric-sm font-semibold mt-1">${r.starts_at ? esc(dubaiStamp(r.starts_at)) : 'No time recorded'}</div>
              ${r.ends_at ? `<div class="font-label-numeric-sm text-[11px] text-red-700">Ended ${esc(ago(r.ends_at))}</div>` : ''}</div>
            <div class="flex-1 min-w-[220px]"><div class="font-body-md text-body-sm font-semibold">${esc(displayName(str(r.customer_name) || 'No customer name recorded', r.lead_id))}</div>
              <div class="ds-cell-sub">${esc(str(r.vehicle_model) || 'No vehicle attached')} · ${esc(str(r.assigned_to_name) ? `Rep: ${str(r.assigned_to_name)}` : 'No salesperson assigned, so there is no obvious person to ask')}</div>
              <div class="ds-cell-sub">${r.confirmed_at ? `Agreed ${esc(dubaiStamp(r.confirmed_at))}` : 'No confirmation time is recorded, although the row is CONFIRMED.'}</div></div>
            <div class="flex items-center gap-2 flex-wrap">${actionsCell(r, mode)}</div>
          </div>`).join('')}</div>
      </section>` : '');

    /* ── P2 · The diary ───────────────────────────────────────────────────── */
    let filter = 'ALL', view = 'list';
    const tabs = [['ALL', all.length], ...STATES.map(s => [s, isState(all, s).length])];
    const drawDiary = () => {
      const shown = filter === 'ALL' ? all : isState(all, filter);
      const head = `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center p-0.5 bg-surface-container rounded-lg flex-wrap" role="group" aria-label="Filter by state">
            ${tabs.map(([k, n]) => `<button type="button" data-ftab="${k}" class="${filter === k ? TAB.on : TAB.off}">${esc(k === 'ALL' ? 'All' : k.replace('_', '-').toLowerCase().replace(/^./, c => c.toUpperCase()))} (${count(n)})</button>`).join('')}
          </div>
          <div class="flex items-center p-0.5 bg-surface-container rounded-lg" role="group" aria-label="Layout">
            <button type="button" data-view="list" class="${view === 'list' ? TAB.on : TAB.off}"><span class="material-symbols-outlined text-[16px] align-middle">view_list</span> List</button>
            <button type="button" data-view="day" class="${view === 'day' ? TAB.on : TAB.off}"><span class="material-symbols-outlined text-[16px] align-middle">calendar_view_day</span> By day</button>
          </div>
        </div>`;
      let bodyHtml;
      if (!all.length) {
        bodyHtml = `<div class="p-space-md">${emptyState({ icon: 'event_busy', title: 'No showroom visit is on record for this dealership',
          body: 'The accessor returned nothing. Either no visit has ever been written to this database, or you are signed in with no dealership membership, in which case it deliberately returns no rows rather than somebody else’s diary.' })}</div>`;
      } else if (!shown.length) {
        bodyHtml = `<div class="p-space-md">${emptyState({ icon: 'filter_alt_off', title: 'No visit is in this state', body: 'Pick All to see every visit on record.' })}</div>`;
      } else if (view === 'day') {
        /* Grouped by the Dubai calendar day of the slot; a visit with no time yet
           is grouped under its own heading rather than dated by the clock. */
        const groups = new Map();
        shown.forEach(r => { const k = dayKey(r) || 'No time yet'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
        bodyHtml = `<div class="p-space-md flex flex-col gap-space-md">${[...groups.entries()].map(([day, rs]) => `
          <div class="flex gap-3">
            <div class="w-28 shrink-0 font-label-numeric-sm text-label-numeric-sm text-outline pt-2">${esc(day)}</div>
            <div class="flex-1 flex flex-col gap-2 border-l border-outline-variant/40 pl-3">${rs.map(r => {
              const k = STATE[up(r.state)] ? up(r.state) : 'OTHER';
              return `<div class="flex gap-3 p-3 rounded-lg bg-surface-container-low hover:bg-surface-container cursor-pointer transition-colors" role="button" tabindex="0" data-appt-open="${esc(str(r.appointment_id))}">
                <span class="${SLOT_BAR[k]}"></span>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">${stateChip(r.state)}<span class="font-label-numeric-sm text-label-numeric-sm font-semibold">${r.starts_at ? esc(dubaiStamp(r.starts_at)) : 'No time proposed'}</span>${str(r.location) ? `<span class="ds-cell-sub">· ${esc(str(r.location))}</span>` : ''}</div>
                  <div class="font-body-md text-body-md font-semibold text-on-surface mt-1">${esc(displayName(str(r.customer_name) || 'No customer name recorded', r.lead_id))}</div>
                  <div class="ds-cell-sub">${esc(str(r.vehicle_model) || 'No vehicle attached')}</div>
                </div>
                <div class="text-right font-body-sm text-body-sm text-on-surface-variant shrink-0">${esc(str(r.assigned_to_name) || 'Nobody assigned')}</div>
              </div>`;
            }).join('')}</div>
          </div>`).join('')}</div>`;
      } else {
        bodyHtml = `<div class="overflow-x-auto"><table class="w-full border-collapse">
          <thead><tr class="bg-surface-container-low border-b border-outline-variant/30">
            <th class="${TH}">Time slot</th><th class="${TH}">Customer</th><th class="${TH}">Vehicle</th><th class="${TH}">State</th>
            <th class="${TH}">Who is expecting them</th><th class="${TH}">Act on it</th>
          </tr></thead>
          <tbody class="divide-y divide-outline-variant/20">${shown.map(r => {
            const k = STATE[up(r.state)] ? up(r.state) : 'OTHER';
            const who = str(r.assigned_to_name);
            const res = str(r.resource);
            return `<tr class="hover:bg-surface-container-low cursor-pointer transition-colors" data-appt-open="${esc(str(r.appointment_id))}">
              <td class="${TD}"><div class="flex gap-2"><span class="${SLOT_BAR[k]}"></span><div style="white-space:normal">${whenCell(r)}</div></div></td>
              <td class="${TD}"><div class="font-semibold">${esc(displayName(str(r.customer_name) || 'No customer name recorded', r.lead_id))}</div>
                <div class="ds-cell-sub">${[str(r.channel) ? 'via ' + str(r.channel) : '', r.lead_id != null ? `lead #${r.lead_id}` : ''].filter(Boolean).map(esc).join(' · ') || 'No channel recorded'}</div></td>
              <td class="${TD}" style="white-space:normal">${str(r.vehicle_model) ? esc(str(r.vehicle_model)) : muted(str(r.inventory_id) ? 'Stock ' + esc(str(r.inventory_id)) + ', no model recorded.' : 'No vehicle attached — nothing here can say what they came to see.')}</td>
              <td class="${TD}"><div>${stateChip(r.state)}</div>${muted(isBooked(r) ? 'Counted as booked.' : 'Not counted as booked.')}</td>
              <td class="${TD}" style="white-space:normal">${who || res
                ? `<div class="font-semibold">${esc(who || 'No salesperson assigned')}</div>${muted(res ? 'Resource: ' + esc(res) : 'No resource attached.')}`
                : (isUnprotected(r) ? hot('Nobody — no salesperson and no resource, so nothing stops a double booking.') : muted('No salesperson and no resource attached.'))}</td>
              <td class="${TD}"><div class="flex gap-1.5 flex-wrap">${actionsCell(r, mode)}</div></td>
            </tr>`;
          }).join('')}</tbody></table></div>`;
      }
      q('[data-diary]').innerHTML = `<section class="${SECTION}">
        <div class="px-space-md pt-3 pb-1"><div class="font-headline-md text-headline-md text-on-surface">Every visit on record, and what is actually true of it</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant">In the accessor’s order — by the time they are for, or by when they were asked for when no time exists yet. Click a visit for its detail.</div></div>
        ${head}${bodyHtml}
        <div class="px-space-md py-2.5 bg-surface-container-low border-t border-outline-variant/30 font-label-numeric-sm text-label-numeric-sm text-outline">Showing ${count(shown.length)} of ${count(all.length)} visits read</div>
      </section>`;
      q('[data-diary]').querySelectorAll('[data-ftab]').forEach(b => b.addEventListener('click', () => { filter = b.dataset.ftab; drawDiary(); }));
      q('[data-diary]').querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { view = b.dataset.view; drawDiary(); }));
      q('[data-diary]').querySelectorAll('[data-appt-open]').forEach(n => {
        const open = e => {
          if (e && e.target.closest('button[data-appt-action]')) return;
          const r = all.find(x => str(x.appointment_id) === n.dataset.apptOpen);
          if (r) apptDrawer(r, mode, act);
        };
        n.addEventListener('click', open);
        n.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      });
      wireActions(q('[data-diary]'));
    };
    /* The action buttons, wherever they are drawn. A click on one never also
       opens the drawer. */
    const wireActions = box => box.querySelectorAll('[data-appt-action]').forEach(btn => {
      if (btn.disabled) return;
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        const r = all.find(x => str(x.appointment_id) === btn.dataset.apptId);
        if (r) act(btn.dataset.apptAction, r);
      });
    });
    drawDiary();
    wireActions(q('[data-awaiting]'));
  }

  /* ── P4 · The limits of this screen ───────────────────────────────────────
     Fixed rows, true whether or not the read succeeded. */
  {
    const all = rows;
    const risky = all ? all.filter(isUnprotected) : null;
    const awaiting = all ? all.filter(isAwaiting) : null;
    const limits = [
      ['edit_calendar', 'Nothing books itself.', 'Every row here was written by a person, through this screen or the lead drawer. No workflow and no channel writes to the diary automatically, so a customer who asked for a visit anywhere else does not appear until somebody records it.'],
      ['sync_disabled', 'There is no calendar anywhere.', 'Nothing is synchronised to Google, Outlook or a showroom diary. A confirmed slot lives in this database and nowhere else.'],
      ['notifications_off', 'Nobody is reminded of anything.', 'NEXUS sends no confirmation, reminder or follow-up about any visit. A CONFIRMED chip is not evidence that the customer still remembers.'],
      ['garage', 'There is no capacity model.', 'Nothing here knows how many customers the showroom can take at once or who is rostered on. Twenty visits in one hour render as calmly as two.'],
      ['lock_open', 'A visit with no salesperson and no resource is outside the double-booking constraint.',
        risky == null ? 'The diary could not be read on this visit, so no count is stated.'
          : risky.length ? `${count(risky.length)} of the ${count(all.length)} ${plural(all.length, 'row', 'rows')} read ${plural(risky.length, 'is', 'are')} in exactly that position.` : 'No row read on this visit is in that position.'],
      ['person_check', 'Attendance is only ever what a person wrote down.',
        awaiting == null ? 'The diary could not be read on this visit.'
          : awaiting.length ? `${count(awaiting.length)} ${plural(awaiting.length, 'slot is', 'slots are')} waiting on somebody right now.` : 'Nothing is waiting on somebody right now.'],
    ];
    q('[data-limits]').innerHTML = `<section class="${SECTION}">
      <div class="px-space-md py-3 flex items-center gap-2 border-b border-outline-variant/30"><span class="material-symbols-outlined text-primary">info</span>
        <span class="font-headline-md text-headline-md text-on-surface">What this screen cannot tell you</span></div>
      ${readErr ? `<div class="px-space-md pt-space-md">${note('warm', 'warning', '<strong>The appointment diary could not be read on this visit.</strong> The limits below are true regardless. The panels above are unread rather than empty — no visit is being confirmed and none is being written off.')}</div>` : ''}
      <div class="p-space-md grid grid-cols-1 md:grid-cols-3 gap-space-md">${limits.map(([icon, t, why]) => `
        <div class="p-space-md rounded-lg bg-surface-container-low">
          <div class="flex items-center gap-2"><span class="material-symbols-outlined text-[18px] text-outline">${esc(icon)}</span><span class="font-body-md text-body-sm font-semibold text-on-surface">${esc(t)}</span></div>
          <p class="font-body-sm text-body-sm text-on-surface-variant mt-1">${esc(why)}</p>
        </div>`).join('')}</div>
    </section>`;
  }

  q('[data-foot]').innerHTML = trustFooter({
    source: `nexus_appointment_status(p_days => ${WINDOW_DAYS})`,
    asOf: dubaiStamp(readAt),
    evidence: readErr ? 'The diary could not be read' : `${count(rows.length)} ${plural(rows.length, 'visit', 'visits')} read`,
    actor: actorName(),
  });
};
