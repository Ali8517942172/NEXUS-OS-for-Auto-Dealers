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

import { db, onIdentityChange } from '../lib/data.js';
import { ago, dubaiStamp, esc, n0, pill } from '../lib/format.js';
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
       + 'no time exists yet. Every line carries the database’s own account, in words, of what state it is in',
    load,
    render: rows => {
      const all = Array.isArray(rows) ? rows : [];
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
      ], all);
    },
  }).then(wireGo);

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
        { limit: 'Nothing books itself. Every row here was written by hand.',
          why: 'NX995 built the write path — request, offer, confirm, attend, cancel — and granted it to service_role '
             + 'alone. No workflow in production calls it. So this diary only ever contains what somebody put in it '
             + 'deliberately, and a customer who asked for a visit through any channel does NOT appear here until a '
             + 'person or a workflow that does not yet exist writes the row.' },
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
