/* NEXUS OS — screens/record-lead.js
   RECORD A LEAD. The screen a salesperson opens when the customer is standing
   in front of them or is on the telephone, and the only surface in this product
   through which a person — rather than another system — can put an enquiry into
   NEXUS.

   ═══════════════════════════════════════════════════════════════════════════
   WHY THIS SCREEN EXISTS
   ═══════════════════════════════════════════════════════════════════════════
   Measured across this database on 17 September 2026, and none of it softened
   for the page:

     · `lead_event` holds ONE row in its entire life. One. A walk-in, recorded
       on 7 September 2026. That is every enquiry this system has ever been
       told about by a person.
     · Of the six lead ingest endpoints registered to this dealership, exactly
       two are active — `phone_call` and `walk_in` — and both of those are
       MANUAL: there is no provider on the other end of either, and no wire that
       could ever fire on its own. A person types them in or they do not exist.
     · The four that are not manual — Google Ads lead forms, marketplace email
       notifications, and Meta lead ads on Facebook and on Instagram — are all
       DISABLED. A delivery to any of them today would be refused at the door.
     · Instagram direct messages are not built at all.
     · WhatsApp Business Cloud is genuinely receiving — two inbound messages,
       the newest on 14 September 2026 — and a message is not an enquiry: it
       arrives on the Conversations plane, not as a lead.

   Put together, that is a dealership whose ONLY working lead path is a person
   typing, and until this screen the app offered that person a button buried in
   a filter bar on the Leads screen. The two active endpoints were registered,
   active and production; the promoter existed; the provenance ladder existed;
   and a salesperson had nowhere obvious to go.

   So the number this screen leads with is not a vanity figure. "1 enquiry has
   ever been recorded by hand" is the finding, and a screen that rendered it as
   a quiet zero-ish nothing — or worse, showed an empty table under a neutral
   caption — would be doing what this whole codebase exists to stop: printing
   silence as though it were calm.

   ═══════════════════════════════════════════════════════════════════════════
   WHAT THIS SCREEN DOES NOT DO
   ═══════════════════════════════════════════════════════════════════════════
   · IT DOES NOT WRITE TO `leads`. The recording goes through
     `rpc/nexus_lead_record_manual`, which walks the same
     record → hydrate → promote path every provider lead walks, so a walk-in
     arrives with a real origin and a `lead_event` behind it naming who recorded
     it and when. A lead created by a direct INSERT would have no arrival at
     all, and the Leads screen would show it as "No arrival recorded" — the
     exact legacy shape this layer exists to stop producing.
   · IT DOES NOT REBUILD THE FORM. lib/manual-lead-form.js already holds the
     dialog, the source picker, the CSPRNG request id and the duplicate-aware
     reporting, and it is already proven in CI. One implementation of a write
     is worth more than a second one that looks nicer. This screen is the place
     that dialog was always missing — a door, not a second door frame.
   · IT DOES NOT SAY WHETHER A SOURCE IS CONNECTED. That question belongs to
     Lead Sources and to Channels, which compute it in the database. Nothing
     here infers a connection and nothing here contradicts one.
   · NO MONEY. Nothing in this database records what an enquiry was worth, and
     a currency figure on this page would be fabricated.

   ═══════════════════════════════════════════════════════════════════════════
   THE DOUBLE-CLICK, AND WHY IT CANNOT MAKE TWO CUSTOMERS
   ═══════════════════════════════════════════════════════════════════════════
   The idempotency key is minted ONCE, in the browser, when the dialog opens,
   and re-sent on every attempt — from `crypto.randomUUID()`, falling back to
   `crypto.getRandomValues`, never from an arithmetic generator seeded per realm
   (two tabs opened in the same millisecond is a plausible collision there, and
   a collision means two different customers silently share one lead). A second
   click therefore returns the SAME lead and says so — `was_duplicate` is
   reported to the rep, not hidden behind a second cheerful "Saved". That is
   proved server-side; the browser's half is only to keep the key stable.

   Two reps entering the same walk-in separately produce two leads, and that is
   correct: they are two acts of recording. Merging two people into one row is
   identity resolution, a different problem, and it is not quietly done here.

   ═══════════════════════════════════════════════════════════════════════════
   WHERE THE ANSWER COMES FROM
   ═══════════════════════════════════════════════════════════════════════════
     lead_source_catalogue    filtered to `delivery_shape=MANUAL_ENTRY` — the
                              set of sources a PERSON is entitled to record
                              under. A new manual source appears here the day it
                              is seeded, and nothing appears here that a person
                              may not record. The server refuses anything else
                              regardless; this list is a convenience, not the
                              control.
     nexus_lead_source_readiness()
                              per-dealership connection state, already computed.
                              Rendered verbatim beside each manual source and
                              never re-derived.
     v_lead_origin            one row per arrival. Read newest-first and CAPPED,
                              so every count below is a floor over the most
                              recent window, never a claim about all time.

   All three are tenant-scoped and read as the signed-in user. Nothing here
   filters by dealership — the database refuses another dealership's rows, this
   file does not hide them. */

import { db, onIdentityChange } from '../lib/data.js';
import { ago, dubaiStamp, esc, n0, num, pill } from '../lib/format.js';
import { manualLeadDialog } from '../lib/manual-lead-form.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty } from '../lib/states.js';
import { kpi, panel, table } from '../lib/ui.js';
import { connectionState, leadPhase } from '../lib/vocabulary.js';

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

/* A null is not a zero and is never printed as one. "No figure came back" and
   "nothing was recorded" are different facts and only the second is a finding. */
const count = v => { const x = n0(v); return x == null ? '—' : String(x); };

/* ── The memo is per RENDER, not per page load ─────────────────────────────
   Three panels share these reads. Module state survives the re-auth path, which
   does not reload the page — so a memo that is never cleared would show a
   second dealership signing in on the same machine the FIRST one's arrivals,
   under a caption saying they had just been read. resetReads() therefore runs
   at the top of the mount function AND on every identity change; the two events
   are not the same and only one of them is under this file's control.
   screens/lead-sources.js carries the full account. */
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
   Reads
   ══════════════════════════════════════════════════════════════════════════
   Columns are named rather than `*` because these are published contracts and a
   hand-typed list is what lets the quality gate check every name against the
   live catalogue.

   The arrivals cap is a fact about every figure on this screen and not an
   implementation detail: newest first, so what is counted is the most recent
   window. When the cap is reached the counts are floors and the last panel says
   so with the number in it. */
const ARRIVALS_LIMIT = 1000;

const readManualSources = shared(() => db('lead_source_catalogue'
  + '?select=source_key,display_name,delivery_shape&delivery_shape=eq.MANUAL_ENTRY'
  + '&order=display_name.asc'));

const readReadiness = shared(() => db('rpc/nexus_lead_source_readiness'));

const readOrigin = shared(() => db('v_lead_origin?select=event_id,source_key,source,channel_family,'
  + 'phase,disposition_reason,received_at,occurred_at,lead_id,'
  + 'origin_cryptographically_verified,origin_strength,origin_explanation,is_test_traffic'
  + `&order=received_at.desc&limit=${ARRIVALS_LIMIT}`));

/* A read that failed says where the figure would have been. Never a bare dash:
   a dash beside "recorded by hand" reads as zero, and zero on this screen is a
   finding made on purpose that has to be able to be made credibly. */
const readFailed = (what, err) =>
  hot(esc(what) + ' could not be read ('
    + esc(str(err && err.message) || 'no reason given')
    + '), so nothing is claimed here and nothing is ruled out. An unread check is not a clear one.');

/* THE THREE-WAY SPLIT ON TEST TRAFFIC. Two buckets would be a bug. The marking
   is a boolean that can also be absent, and an absent one is not a false:
   counting it as business inflates the number a dealership acts on, and
   counting it as test hides a real enquiry. All three are stated; the headline
   uses only the first. */
function splitTraffic(rows) {
  const all = Array.isArray(rows) ? rows : [];
  return {
    all,
    business:     all.filter(r => r.is_test_traffic === false),
    test:         all.filter(r => r.is_test_traffic === true),
    unclassified: all.filter(r => r.is_test_traffic !== true && r.is_test_traffic !== false),
  };
}

/* The set of source keys a person may record under, from the catalogue and from
   nowhere else. A source missing a key is counted as unreadable rather than
   dropped: an entry nobody can account for is exactly the one worth naming. */
function manualRows(rows) {
  const usable = [];
  let unreadable = 0;
  (Array.isArray(rows) ? rows : []).forEach(r => {
    const key = str(r && r.source_key);
    if (!key) { unreadable += 1; return; }
    usable.push({ key, name: str(r.display_name) });
  });
  return { usable, unreadable, keys: new Set(usable.map(x => x.key)) };
}

/* Readiness, indexed by source key. The state is rendered verbatim; nothing
   here computes one and nothing here overrides one. */
function readinessByKey(rows) {
  const m = new Map();
  (Array.isArray(rows) ? rows : []).forEach(r => {
    const key = str(r && r.source_key);
    if (key) m.set(key, { state: up(r.connection_state), note: str(r.evidence_note), endpoints: n0(r.active_endpoints) });
  });
  return m;
}

/* ══════════════════════════════════════════════════════════════════════════
   SCREEN
   ══════════════════════════════════════════════════════════════════════════ */
SCREENS.recordlead = async host => {
  /* Every visit re-reads. See the note on `shared` above for what that repairs
     and why a stale picture of what has been recorded is worse than a slow one. */
  resetReads();

  /* A save re-renders the whole screen rather than splicing the new lead in by
     hand. The row a salesperson needs to see is the one the DATABASE made —
     with its real origin, its event id and its promoted state — not a
     client-side guess at what it probably looks like. `host` is emptied first
     because this screen APPENDS its panels rather than replacing them. */
  const rerender = () => { host.innerHTML = ''; SCREENS.recordlead(host); };
  const openDialog = () => manualLeadDialog(() => rerender());
  const wireRecord = card => {
    card.querySelectorAll('[data-record]').forEach(b => b.addEventListener('click', openDialog));
    wireGo(card);
  };

  const loadSources = () => readManualSources();
  const loadSourcesAndState = async () => {
    const [s, d] = await Promise.all([settle(readManualSources()), settle(readReadiness())]);
    if (s.err) throw s.err;   /* Without the catalogue there is no list to draw. */
    return { s, d };
  };
  const loadArrivals = async () => {
    const [o, s] = await Promise.all([settle(readOrigin()), settle(readManualSources())]);
    if (o.err && s.err) throw o.err;
    return { o, s };
  };
  /* Never throws. The last panel's whole job is to state what this screen
     cannot tell you, and handing it a "couldn't load" card would silence the one
     panel that is still true when everything else failed. */
  const loadSoft = async () => {
    const [o, s] = await Promise.all([settle(readOrigin()), settle(readManualSources())]);
    return { o, s };
  };

  /* ────────────────────────────────────────────────────────────────────────
     P1 · The door itself
     ──────────────────────────────────────────────────────────────────────
     The button is the point of the screen, so it is rendered before any figure
     and it is rendered whether or not the readiness read succeeded: the server
     decides what may be recorded, not this page, and hiding the only working
     lead path in the product because a decorative read failed would be the
     worst trade available here. */
  panel(host, {
    title: 'Record a walk-in or a phone call',
    sub: 'The only path in this product through which a person can put an enquiry into NEXUS. It is recorded as your '
       + 'word that this enquiry happened, with your name and the time on it, and it arrives with a real origin '
       + 'rather than as a lead nobody can place',
    actions: linkBtn('leads', 'Open Leads') + ' ' + linkBtn('leadsources', 'Open Lead Sources'),
    load: loadSourcesAndState,
    render: ({ s, d }) => {
      const { usable, unreadable } = manualRows(s.v);
      const ready = d.err ? null : readinessByKey(d.v);

      if (!usable.length) {
        return stateEmpty('No source in the catalogue can be recorded by a person',
          unreadable
            ? 'The catalogue was read and every entry in it came back without a key this screen can file an enquiry '
              + 'under. That is not a claim that no manual source exists — it is a claim that none could be read, and '
              + 'nothing has been saved.'
            : 'The catalogue was read and holds no source whose enquiries arrive as a person rather than as a message '
              + 'from another system, so there is nothing to file a walk-in or a phone call under. Nothing has been '
              + 'saved and nothing is being ruled out about enquiries arriving by other means.',
          'inbox');
      }

      const shapeFault = unreadable
        ? `<div class="banner hot">
             <span class="material-symbols-outlined" style="font-size:20px">report</span>
             <div>${bold('Part of the catalogue came back in a shape this screen cannot read.')}
               ${muted(esc(count(unreadable)) + ' '
                 + plural(unreadable, 'entry carries', 'entries carry')
                 + ' no key an enquiry could be filed under, so '
                 + plural(unreadable, 'it is', 'they are')
                 + ' neither offered below nor counted. '
                 + plural(unreadable, 'It is', 'They are')
                 + ' reported rather than dropped.')}</div></div>`
        : '';

      const btn = `<div style="margin-top:4px;margin-bottom:16px">
          <button class="btn primary" data-record="1">
            <span class="material-symbols-outlined">person_add</span> Record a walk-in or phone call
          </button></div>`;

      const stateUnread = d.err
        ? `<div class="banner warm" style="margin-top:12px">
             <span class="material-symbols-outlined" style="font-size:20px">warning</span>
             <div>${bold('Whether each source is set up for this dealership could not be read.')}
               ${muted(esc(str(d.err.message) || 'No reason was given.')
                 + ' The sources below are still offered and recording still works — the database decides what may be '
                 + 'filed, not this page. What is missing is only the line describing how each one is set up, so none '
                 + 'is being cleared and none is being blamed.')}</div></div>`
        : '';

      const rows = usable.map(m => ({ ...m, r: ready ? ready.get(m.key) : undefined }));

      return btn + shapeFault + table([
        { label: 'What you may record', strong: true, render: m => wrap(
            bold(esc(m.name || m.key)) + muted(chip('Entered by a person'))) },
        { label: 'How this dealership is set up for it', render: m => {
            if (!ready) return wrap(muted('Not read on this visit, so nothing is being stated about it.'));
            if (!m.r) return wrap(warm('This source is in the catalogue and does not appear in this dealership’s '
              + 'readiness answer at all, so nothing here can say how it is set up. Recording under it may still be '
              + 'refused by the database, which is the thing that decides.'));
            const st = connectionState(m.r.state);
            const label = str(m.r.state) || 'NO STATE RECORDED';
            /* Provenance is the caller's to state. Our own words when the state
               is recognised; the database's own string, verbatim, when it is
               not — and only the second earns pill()'s "no wording for that
               status" note. */
            return `<div>${pill(st ? st.label : label, st ? st.tone : 'unknown', { verbatim: !st })}</div>`
              + (st ? '' : muted('This screen does not recognise that state, so it is shown exactly as the database '
                  + 'returned it and nothing is inferred from it.'))
              + (m.r.note ? muted(esc(m.r.note)) : '');
          } },
        { label: 'What that means here', render: () => wrap(muted(
            'That state is the database’s answer about an automatic feed — whether a provider could deliver an '
            + 'enquiry on its own. A walk-in and a telephone call have no feed and never will: the deliverer is the '
            + 'person reading this screen, and the button above is the whole of the path. Nothing will arrive under '
            + 'these sources that somebody does not type.')) },
      ], rows) + stateUnread;
    },
  }).then(wireRecord);

  /* ────────────────────────────────────────────────────────────────────────
     P2 · What has ever actually been recorded by hand
     ──────────────────────────────────────────────────────────────────────
     The finding, stated at the size of a finding. One arrival in the life of
     this database is not a quiet week and is not rendered as one. */
  panel(host, {
    title: 'Everything ever recorded by hand',
    sub: 'Every enquiry a person has put into NEXUS, newest first. Test traffic is counted nowhere in the headline, '
       + 'and an arrival whose marking is absent is counted in neither figure',
    actions: linkBtn('leads', 'Open Leads'),
    load: loadArrivals,
    render: ({ o, s }) => {
      const { usable, keys } = manualRows(s.v);

      if (o.err) {
        return `<div class="state err"><span class="material-symbols-outlined">error</span>
          <h3>Couldn't load the arrivals record</h3>
          <p>How many enquiries have been recorded by hand cannot be answered without the arrivals record, which did
             not come back${esc(str(o.err.message) ? ' (' + str(o.err.message) + ')' : '')}. Showing an empty table
             here would be reporting a failed read as a finding, and "nothing has ever been recorded" is exactly the
             finding this panel exists to make — so it is not being made on a read that did not happen.</p></div>`;
      }

      const T = splitTraffic(o.v);
      /* If the catalogue failed, the set of manual keys is unknown. Rather than
         guessing which sources are manual — and there is no column on an arrival
         that says so — the panel says the filter could not be applied. */
      const filterUnknown = s.err || !usable.length;
      const mine = filterUnknown ? [] : T.business.filter(r => keys.has(str(r.source_key)));
      const mineTest = filterUnknown ? [] : T.test.filter(r => keys.has(str(r.source_key)));
      const mineUnclassified = filterUnknown
        ? [] : T.unclassified.filter(r => keys.has(str(r.source_key)));

      if (filterUnknown) {
        return `<div class="state err"><span class="material-symbols-outlined">error</span>
          <h3>Which arrivals were recorded by hand could not be determined</h3>
          <p>The arrivals record was read and holds ${esc(count(T.all.length))}
             ${esc(plural(T.all.length, 'arrival', 'arrivals'))} in the window read here. Which of them a person typed
             in is decided by the source they arrived under, and the list of sources a person may record under
             ${esc(s.err ? 'could not be read' : 'came back empty')}. There is no column on an arrival that says
             "a person typed this", so nothing is being guessed and no count is being stated.</p></div>`;
      }

      const capped = T.all.length >= ARRIVALS_LIMIT;
      const newest = mine.length ? mine[0].received_at : null;

      const totalTile = kpi('Recorded by hand', count(mine.length),
        muted(mine.length
          ? `${plural(mine.length, 'This enquiry was', 'These enquiries were')} typed in by a person and
             ${plural(mine.length, 'carries', 'carry')} that as ${plural(mine.length, 'its', 'their')} origin. `
            + (capped
                ? `Counted over the ${esc(count(ARRIVALS_LIMIT))} most recent arrivals, so this is a floor and not a
                   total.`
                : 'Counted over every arrival this screen can read.')
          : 'Nothing has ever been recorded by hand in this database. Both of the lead paths that actually work at '
            + 'this dealership are manual ones, so that is not a quiet week — it is the whole funnel sitting unused.'),
        mine.length ? 't-ok' : 't-hot');

      const newestTile = kpi('Most recent', newest ? esc(ago(newest)) : 'None',
        muted(newest
          ? esc(dubaiStamp(newest)) + ', Dubai time.'
          : 'No hand-recorded enquiry has a time against it, because none has been recorded.'));

      const sideTile = kpi('Counted nowhere above', count(mineTest.length + mineUnclassified.length),
        muted(`${esc(count(mineTest.length))} ${plural(mineTest.length, 'arrival is', 'arrivals are')} marked as test `
          + `traffic and ${esc(count(mineUnclassified.length))} `
          + `${plural(mineUnclassified.length, 'does', 'do')} not say which `
          + `${plural(mineUnclassified.length, 'it is', 'they are')}. Neither is added into the headline: counting an `
          + 'unclassified arrival as business inflates the number a dealership acts on, and counting it as test hides '
          + 'a real enquiry.'),
        (mineTest.length + mineUnclassified.length) ? 't-warm' : '');

      const tiles = `<div class="grid g3">${totalTile}${newestTile}${sideTile}</div>`;

      if (!mine.length) {
        return tiles + stateEmpty('Nothing has ever been recorded by hand',
          'The arrivals record was read and holds no enquiry under any source a person may record. This dealership’s '
          + 'only active lead endpoints are the manual ones, so an empty table here is not the absence of a feed having '
          + 'a slow month — it is the absence of anybody using the one path that works. The button above is that path.',
          'edit_note');
      }

      return tiles + `<div style="margin-top:12px">` + table([
        { label: 'Arrived', render: r => wrap(
            `<div title="${esc(dubaiStamp(r.received_at))}">${esc(ago(r.received_at))}</div>`
            + muted(esc(dubaiStamp(r.received_at)) + ', Dubai time.')) },
        { label: 'Recorded under', strong: true, render: r => wrap(
            bold(esc(str(r.source) || str(r.source_key) || 'A source with no name recorded'))
            + muted(str(r.channel_family) ? chip(str(r.channel_family)) : 'No channel family recorded.')) },
        { label: 'How far it got', render: r => {
            const ph = leadPhase(r.phase);
            const label = str(r.phase) || 'NO STAGE RECORDED';
            return `<div>${pill(ph ? ph.label : label, ph ? ph.tone : 'unknown', { verbatim: !ph })}</div>`
              + (ph ? muted(esc(ph.blurb))
                    : hot('This screen does not recognise that stage, so it is shown exactly as the database returned '
                        + 'it. A stage nobody recognises decides whether this arrival is a lead that made it through '
                        + 'or one that was lost, and neither is being assumed.'))
              + (str(r.disposition_reason) ? muted(esc(str(r.disposition_reason))) : '');
          } },
        { label: 'Became a lead', render: r => (r.lead_id
            ? wrap(`<div>${esc(String(r.lead_id))}</div>` + muted('This arrival was promoted and exists on the Leads '
                + 'screen under that id.'))
            : wrap(warm('No lead id is recorded against this arrival, so it was recorded but never became a lead '
                + 'anybody can work. That is a loss with a record of it, not an enquiry that never happened.'))) },
        { label: 'How the origin is attested', render: r => wrap(
            (str(r.origin_explanation)
              ? esc(str(r.origin_explanation))
              : muted('The database recorded no explanation of how this origin is attested, so none is being '
                  + 'invented here.'))
            + muted('A hand-recorded enquiry is attested by the person who typed it and by nothing stronger. That is '
                + 'not a weakness to hide — it is exactly what a walk-in is.')) },
      ], mine) + `</div>`;
    },
  }).then(wireRecord);

  /* ────────────────────────────────────────────────────────────────────────
     P3 · The limits of this screen
     ──────────────────────────────────────────────────────────────────────
     Fixed rows, true whether or not the reads above succeeded, which is why
     this panel takes the soft load: a panel whose job is to state what it cannot
     tell you must not go blank at exactly the moment it knows least. */
  panel(host, {
    title: 'What this screen cannot tell you',
    sub: 'Five things that are outside what the database can answer. They are listed because a screen that only shows '
       + 'what it knows reads as though it knows everything',
    load: loadSoft,
    render: ({ o, s }) => {
      const all = o.err ? null : (Array.isArray(o.v) ? o.v : []);
      const capped = all ? all.length >= ARRIVALS_LIMIT : null;
      const manualCount = s.err ? null : manualRows(s.v).usable.length;

      const rows = [
        { limit: 'It counts what was recorded, never what happened.',
          why: 'Every figure here is a count of enquiries somebody typed in. A customer who walked onto the forecourt '
             + 'and was never entered is invisible to this database and to this screen, and no number on this page is '
             + 'evidence about how many people came through the door. The gap between those two is exactly what this '
             + 'screen exists to shrink, and it cannot measure itself.' },
        { limit: 'It cannot tell two reps recording one customer from two customers.',
          why: 'Two people entering the same walk-in produce two leads, and that is deliberate: they are two separate '
             + 'acts of recording. Nothing here merges them, and the duplicate guard only stops the SAME dialog being '
             + 'submitted twice — it does not look at names, phone numbers or faces.' },
        { limit: 'It says nothing about whether anybody followed up.',
          why: 'A lead recorded here is a lead that exists. Whether it was called back, quoted, or left to go cold is '
             + 'answered on the Leads screen and by the follow-up engines, and a healthy count on this page is not '
             + 'evidence about any of that.' },
        { limit: capped == null
            ? 'The arrivals record is read in a capped window, and it could not be read on this visit.'
            : capped
              ? `The counts above are floors, not totals — the cap of ${num(ARRIVALS_LIMIT)} arrivals was reached.`
              : 'The arrivals record is read in a capped window, and on this visit the window held everything.',
          why: `This screen reads the ${num(ARRIVALS_LIMIT)} most recent arrivals, newest first. `
             + (capped == null
                  ? 'Whether that cap was reached on this visit is unknown, because the read failed, so no count above '
                    + 'should be treated as a total.'
                  : capped
                    ? 'That many came back, so an older hand-recorded enquiry may exist outside the window and would '
                      + 'not be counted above.'
                    : 'Fewer than the cap came back, so nothing was truncated on this visit — though that is a fact '
                      + 'about this read, not a permanent property.') },
        { limit: 'It does not decide what you are allowed to record.',
          why: 'The picker offers the sources whose enquiries arrive as a person, and the database refuses anything '
             + 'else regardless of what this page offers. '
             + (manualCount == null
                  ? 'Which sources those are could not be read on this visit, so none is being named here.'
                  : `${num(manualCount)} ${plural(manualCount, 'source is', 'sources are')} offered in this build. `)
             + 'A source a person could record under that never appears here is a seeding question, not something '
               + 'this screen can add.' },
      ];

      const head = (o.err || s.err)
        ? `<div class="banner warm">
             <span class="material-symbols-outlined" style="font-size:20px">warning</span>
             <div>${bold('Part of this screen could not be read on this visit.')}
               ${muted(esc(str(o.err && o.err.message) || str(s.err && s.err.message) || 'No reason was given.')
                 + ' The limits below are true regardless, so they are still shown. The panels above are unread rather '
                 + 'than empty — nothing is being cleared and nothing is being blamed.')}</div></div>`
        : '';

      return head + table([
        { label: 'What it cannot tell you', strong: true, render: r => wrap(esc(r.limit)) },
        { label: 'Why', render: r => wrap(esc(r.why)) },
      ], rows);
    },
  }).then(wireRecord);
};
