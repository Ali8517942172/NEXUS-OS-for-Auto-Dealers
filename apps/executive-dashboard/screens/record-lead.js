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
     form (since 7 Oct 2026 rendered INLINE here as well as in the dialog —
     one template, one request-id rule, one RPC), the
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

import { ME, db, onIdentityChange } from '../lib/data.js';
import { el } from '../lib/dom.js';
import { aed, ago, dubaiDate, dubaiStamp, esc, n0, num, pill } from '../lib/format.js';
import { leadDrawer } from '../lib/lead-drawer.js';
import { manualLeadForm, recordedCard } from '../lib/manual-lead-form.js';
import { SCREENS, go } from '../lib/nav.js';
import { displayName, maskPhone } from '../lib/privacy.js';
import { BTN, emptyState, errorState, kpiTile, skeleton, trustFooter } from '../lib/stitch-ui.js';
import { connectionState, leadPhase } from '../lib/vocabulary.js';

/* ── Small local vocabulary ───────────────────────────────────────────────── */
const str = v => String(v == null ? '' : v).trim();
const up  = v => str(v).toUpperCase();
const plural = (c, one, many) => (Number(c) === 1 ? one : many);
const muted = h => `<div class="ds-cell-sub">${h}</div>`;
const hot   = h => `<div class="ds-cell-sub t-hot">${h}</div>`;
const warm  = h => `<div class="ds-cell-sub t-warm">${h}</div>`;

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
  ? `<button type="button" class="${BTN.secondary}" data-go="${esc(id)}">${esc(label)}</button>`
  : `<button type="button" class="${BTN.secondary}" disabled title="${esc(label)} is not part of this build: the navigation offers the screen and no module in this bundle registers it.">${esc(label)} — not in this build</button>`);
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
   SCREEN — Stitch layout, 7 Oct 2026
   ══════════════════════════════════════════════════════════════════════════
   design/stitch/record-a-lead-manual-floor-intake-history--e75a21.html is the
   layout: header with the one call to action, a KPI row, the intake form, the
   manual intake ledger and "What this screen cannot tell you". The result card
   beside the form is record-a-lead-form--78385b's. The form is
   lib/manual-lead-form.js rendered inline — the same template, request-id rule
   and RPC as the dialog on the Leads screen, so this is still one
   implementation of the write, now with a door that is open by default. */
const CARD_HEAD = 'px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex items-center justify-between gap-space-sm flex-wrap';
const SECTION = 'rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm';
const TH = 'px-4 py-2.5 font-table-header text-table-header uppercase tracking-wider text-outline text-left';
const TD = 'px-4 py-2.5 align-top font-body-sm text-body-sm text-on-surface';
const NOTE = {
  info: 'flex items-start gap-2.5 p-3 rounded-lg border border-blue-200 bg-blue-50/60 text-blue-950 font-body-sm text-body-sm',
  warm: 'flex items-start gap-2.5 p-3 rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm',
  hot:  'flex items-start gap-2.5 p-3 rounded-lg border border-red-200 bg-red-50/60 text-red-950 font-body-sm text-body-sm',
};
const note = (t, icon, html) =>
  `<div class="${NOTE[t] || NOTE.info}"><span class="material-symbols-outlined text-[18px] shrink-0">${esc(icon)}</span><div class="min-w-0 flex-1">${html}</div></div>`;
const SRC_TAG = {
  walk_in:    'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface font-label-numeric-sm text-[11px] font-semibold uppercase',
  phone_call: 'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-50 text-cyan-800 font-label-numeric-sm text-[11px] font-semibold uppercase',
  other:      'inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-on-surface-variant font-label-numeric-sm text-[11px] font-semibold uppercase',
};
const SRC_ICON = { walk_in: 'directions_walk', phone_call: 'call' };
/* Midnight in Dubai, for "today's" count. The showroom's day, not the
   reader's — every absolute time in this build is pinned to Asia/Dubai. */
const dubaiDay = v => dubaiDate(v, '');

const actorName = () => String((ME && (ME.name || ME.email)) || 'Signed-in user');

SCREENS.recordlead = async host => {
  /* `nx-stitch` on a wrapper this screen appends, never on `#screen` — a class
     set there would follow the operator onto a screen nobody migrated. */
  const root = el('div', 'nx-stitch flex flex-col gap-space-md');
  host.appendChild(root);

  /* Every visit re-reads. See the note on `shared` above for what that repairs
     and why a stale picture of what has been recorded is worse than a slow one. */
  resetReads();
  const readAt = new Date();

  /* A save re-renders the whole screen rather than splicing the new lead in by
     hand: the row a salesperson needs to see is the one the DATABASE made.
     `host` is emptied first because this screen APPENDS its root. The result
     card survives the re-render through `lastRecorded`. */
  const rerender = r => { host.innerHTML = ''; SCREENS.recordlead(host).then(() => { if (r) showRecorded(host, r); }); };

  root.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-end justify-between gap-space-sm">
      <div class="min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-container text-primary font-label-numeric-sm text-label-numeric-sm font-semibold uppercase"><span class="w-1.5 h-1.5 rounded-full bg-primary"></span>Showroom intake</span>
          <span class="font-label-numeric-sm text-label-numeric-sm text-outline">Work · Record a lead</span>
        </div>
        <h1 class="font-headline-lg text-headline-lg text-on-surface mt-1">Record a Lead</h1>
        <p class="font-body-md text-body-md text-on-surface-variant mt-0.5 max-w-3xl">The only path in this product through which a person can put an enquiry into NEXUS — for the customer who walked in or telephoned. It is recorded as your word that the enquiry happened, with your name and the time on it, and it arrives with a real origin rather than as a lead nobody can place.</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        ${linkBtn('leads', 'Open Leads')}${linkBtn('leadsources', 'Open Lead Sources')}
        <button type="button" class="${BTN.primary}" data-jump-form><span class="material-symbols-outlined text-[18px]">add_circle</span>Record a walk-in or a phone call</button>
      </div>
    </div>
    <div class="grid grid-cols-2 xl:grid-cols-4 gap-space-md" data-kpis>${skeleton({ rows: 1 })}</div>
    <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-space-md items-start">
      <div data-form></div>
      <div class="flex flex-col gap-space-md" data-side>
        <div data-recorded></div>
        <div data-ready>${skeleton({ rows: 2 })}</div>
      </div>
    </div>
    <div data-ledger>${skeleton({ rows: 3 })}</div>
    <div data-limits></div>
    <div data-foot></div>`;

  const q = s => root.querySelector(s);
  manualLeadForm(q('[data-form]'), { onSaved: r => rerender(r) });
  q('[data-jump-form]').addEventListener('click', () => {
    q('[data-form]').scrollIntoView({ behavior: 'smooth', block: 'start' });
    q('[data-form] #mlName')?.focus();
  });
  wireGo(root);

  const [s, d, o] = await Promise.all([settle(readManualSources()), settle(readReadiness()), settle(readOrigin())]);
  if (!root.isConnected) return;
  const { usable, unreadable, keys } = s.err ? { usable: [], unreadable: 0, keys: new Set() } : manualRows(s.v);

  /* ── The readiness card: what a person may record here ─────────────────
     Rendered whether or not the readiness read succeeded: the server decides
     what may be recorded, not this page, and hiding the working lead path
     because a decorative read failed would be the worst trade available. */
  {
    const ready = d.err ? null : readinessByKey(d.v);
    let bodyHtml;
    if (s.err) {
      bodyHtml = errorState({ what: 'the list of sources a person may record', err: s.err });
    } else if (!usable.length) {
      bodyHtml = emptyState({ icon: 'inbox', title: 'No source in the catalogue can be recorded by a person',
        body: unreadable
          ? 'The catalogue was read and every entry in it came back without a key this screen can file an enquiry under. That is not a claim that no manual source exists — it is a claim that none could be read, and nothing has been saved.'
          : 'The catalogue was read and holds no source whose enquiries arrive as a person rather than as a message from another system, so there is nothing to file a walk-in or a phone call under.' });
    } else {
      bodyHtml = `<div class="flex flex-col divide-y divide-outline-variant/20">${usable.map(m => {
        const r = ready ? ready.get(m.key) : undefined;
        let stateHtml;
        if (!ready) stateHtml = muted('Not read on this visit, so nothing is being stated about it.');
        else if (!r) stateHtml = warm('This source is in the catalogue and does not appear in this dealership’s readiness answer at all, so nothing here can say how it is set up. Recording under it may still be refused by the database, which is the thing that decides.');
        else {
          const st = connectionState(r.state);
          const label = str(r.state) || 'NO STATE RECORDED';
          /* Our own words when the state is recognised; the database's own
             string, verbatim, when it is not. */
          stateHtml = `<div>${pill(st ? st.label : label, st ? st.tone : 'unknown', { verbatim: !st })}</div>`
            + (st ? '' : muted('This screen does not recognise that state, so it is shown exactly as the database returned it and nothing is inferred from it.'))
            + (r.note ? muted(esc(r.note)) : '');
        }
        return `<div class="py-3 flex items-start gap-3">
          <span class="material-symbols-outlined text-[20px] text-primary">${esc(SRC_ICON[m.key] || 'edit_note')}</span>
          <div class="min-w-0 flex-1"><div class="font-body-md text-body-sm font-semibold text-on-surface">${esc(m.name || m.key)}</div>${stateHtml}</div>
        </div>`;
      }).join('')}</div>`
      + (unreadable ? note('hot', 'report', `<strong>Part of the catalogue came back in a shape this screen cannot read.</strong> ${esc(count(unreadable))} ${plural(unreadable, 'entry carries', 'entries carry')} no key an enquiry could be filed under, so ${plural(unreadable, 'it is', 'they are')} neither offered nor counted.`) : '')
      + (d.err ? note('warm', 'warning', '<strong>Whether each source is set up for this dealership could not be read.</strong> The sources are still offered and recording still works — the database decides what may be filed, not this page.') : '')
      + `<p class="ds-cell-sub" style="white-space:normal">That state is the database’s answer about an automatic feed. A walk-in and a telephone call have no feed and never will: the deliverer is the person reading this screen, and the form is the whole of the path.</p>`;
    }
    q('[data-ready]').innerHTML = `<section class="${SECTION}"><div class="${CARD_HEAD}"><div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary">fact_check</span>
      <span class="font-headline-md text-headline-md text-on-surface">What you may record</span></div></div><div class="p-space-md flex flex-col gap-2">${bodyHtml}</div></section>`;
  }

  /* ── KPI row and ledger ─────────────────────────────────────────────────
     THE THREE-WAY SPLIT ON TEST TRAFFIC is kept: business, test and
     unclassified are counted apart and only the first is the headline. */
  const filterUnknown = s.err || !usable.length;
  const T = o.err ? null : splitTraffic(o.v);
  const mine = T && !filterUnknown ? T.business.filter(r => keys.has(str(r.source_key))) : [];
  const mineTest = T && !filterUnknown ? T.test.filter(r => keys.has(str(r.source_key))) : [];
  const mineUnclassified = T && !filterUnknown ? T.unclassified.filter(r => keys.has(str(r.source_key))) : [];
  const capped = T ? T.all.length >= ARRIVALS_LIMIT : null;
  const newest = mine.length ? mine[0].received_at : null;
  const today = dubaiDay(readAt);
  const mineToday = mine.filter(r => dubaiDay(r.received_at) === today);
  const known = !o.err && !filterUnknown;

  q('[data-kpis]').innerHTML = [
    kpiTile({ label: 'Recorded today', value: known ? count(mineToday.length) : null,
      sub: known ? `Enquiries typed in since midnight, Dubai time (${esc(today)}).` : 'Not countable — the arrivals or the source list could not be read.' }),
    kpiTile({ label: 'Recorded by hand', value: known ? count(mine.length) : null,
      sub: !known ? 'Not countable on this visit.'
        : mine.length
          ? (capped ? `Counted over the ${count(ARRIVALS_LIMIT)} most recent arrivals, so this is a floor and not a total.` : 'Counted over every arrival this screen can read.')
          : 'Nothing has ever been recorded by hand in this database. The manual paths are the ones that work today, so that is the whole funnel sitting unused.' }),
    kpiTile({ label: 'Most recent', value: newest ? ago(newest) : (known ? 'None' : null),
      sub: newest ? `${dubaiStamp(newest)}, Dubai time.` : 'No hand-recorded enquiry has a time against it.' }),
    kpiTile({ label: 'Counted nowhere above', value: known ? count(mineTest.length + mineUnclassified.length) : null,
      sub: `${count(mineTest.length)} marked as test traffic and ${count(mineUnclassified.length)} that do not say which. Neither is added into the headline.` }),
  ].join('');

  /* The ledger joins each arrival to the lead it became, so the row can carry
     the customer, the number and what they asked about. One read, by id, of
     rows the dealership already owns; masked through lib/privacy.js. */
  let leadById = new Map(), leadErr = null;
  const ids = [...new Set(mine.map(r => r.lead_id).filter(v => v != null))].slice(0, 200);
  if (ids.length) {
    try {
      const rows = await db(`leads?select=id,name,phone,vehicle_interest,budget_aed&id=in.(${ids.map(encodeURIComponent).join(',')})`);
      leadById = new Map((rows || []).map(l => [String(l.id), l]));
    } catch (e) { leadErr = e; }
  }
  if (!root.isConnected) return;

  const ledgerHead = `<div class="${CARD_HEAD}">
      <div class="min-w-0">
        <div class="flex items-center gap-2 flex-wrap"><span class="font-headline-md text-headline-md text-on-surface">Manual intake ledger</span>
          ${known ? `<span class="px-2 py-0.5 rounded bg-surface-container-highest font-label-numeric-sm text-label-numeric-sm font-bold text-primary">${count(mine.length)} ${plural(mine.length, 'record', 'records')}</span>` : ''}</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant">Every enquiry a person has put into NEXUS, newest first. Test traffic is counted nowhere in the headline.</div>
      </div>
      <div class="relative"><span class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-outline text-[16px]">search</span>
        <input type="search" data-ledger-q aria-label="Filter ledger records" placeholder="Filter ledger records…" class="h-9 pl-8 pr-3 rounded-lg bg-surface-container-lowest border border-outline-variant/50 font-body-sm text-body-sm focus:outline-none focus:ring-2 focus:ring-primary"></div>
    </div>`;

  const drawLedger = filterText => {
    if (o.err) {
      /* An empty table here would report a failed read as a finding, and
         "nothing has ever been recorded" is exactly the finding this panel
         exists to make — so it is not made on a read that did not happen. */
      return errorState({ what: 'the arrivals record', err: o.err });
    }
    if (filterUnknown) {
      return emptyState({ icon: 'help', title: 'Which arrivals were recorded by hand could not be determined',
        body: `The arrivals record holds ${count(T.all.length)} ${plural(T.all.length, 'arrival', 'arrivals')} in the window read here. Which of them a person typed in is decided by the source they arrived under, and the list of sources a person may record under ${s.err ? 'could not be read' : 'came back empty'}. Nothing is being guessed.` });
    }
    if (!mine.length) {
      return emptyState({ icon: 'edit_note', title: 'Nothing has ever been recorded by hand',
        body: 'The arrivals record was read and holds no enquiry under any source a person may record. That is not a slow month for a feed — it is nobody using the one path that works. The form above is that path.' });
    }
    const qx = String(filterText || '').trim().toLowerCase();
    const rows = mine.filter(r => {
      if (!qx) return true;
      const l = leadById.get(String(r.lead_id)) || {};
      return [r.source, r.source_key, r.lead_id, l.name, l.phone, l.vehicle_interest].join(' ').toLowerCase().includes(qx);
    });
    if (!rows.length) return `<div class="p-space-md">${emptyState({ icon: 'search_off', title: 'No ledger record matches', body: 'Nothing in the hand-recorded arrivals matches what is typed in the filter.' })}</div>`;
    return `<div class="overflow-x-auto"><table class="w-full border-collapse">
      <thead><tr class="bg-surface-container-low border-b border-outline-variant/30">
        <th class="${TH}">Recorded at</th><th class="${TH}">Intake source</th><th class="${TH}">Customer</th>
        <th class="${TH}">Phone</th><th class="${TH}">Vehicle asked about</th><th class="${TH}">Stated budget</th>
        <th class="${TH}">How far it got</th><th class="${TH}">How the origin is attested</th>
      </tr></thead>
      <tbody class="divide-y divide-outline-variant/20">${rows.map(r => {
        const l = r.lead_id != null ? leadById.get(String(r.lead_id)) : null;
        const ph = leadPhase(r.phase);
        const label = str(r.phase) || 'NO STAGE RECORDED';
        const key = str(r.source_key);
        return `<tr class="hover:bg-surface-container-low transition-colors">
          <td class="${TD}"><div class="font-label-numeric-sm text-label-numeric-sm" title="${esc(dubaiStamp(r.received_at))}">${esc(dubaiStamp(r.received_at))}</div><div class="ds-cell-sub">${esc(ago(r.received_at))}</div></td>
          <td class="${TD}"><span class="${SRC_TAG[key] || SRC_TAG.other}"><span class="material-symbols-outlined text-[13px]">${esc(SRC_ICON[key] || 'edit_note')}</span>${esc(str(r.source) || key || 'No source name')}</span></td>
          <td class="${TD}">${r.lead_id == null
            ? warm('No lead id is recorded against this arrival, so it was recorded but never became a lead anybody can work. That is a loss with a record of it, not an enquiry that never happened.')
            : l ? `<div class="font-semibold">${esc(displayName(l.name, l.id))}</div><div class="ds-cell-sub">Lead #${esc(String(r.lead_id))}</div>`
              : `<div>Lead #${esc(String(r.lead_id))}</div>${muted(leadErr ? 'The lead row could not be read.' : 'The lead row did not come back on this read.')}`}</td>
          <td class="${TD} font-label-numeric-sm">${l && str(l.phone) ? esc(maskPhone(str(l.phone))) : '<span class="ds-t-tertiary">—</span>'}</td>
          <td class="${TD}">${l && str(l.vehicle_interest) ? esc(str(l.vehicle_interest)) : '<span class="ds-t-tertiary">—</span>'}</td>
          <td class="${TD} font-label-numeric-sm">${l && n0(l.budget_aed) != null ? esc(aed(l.budget_aed)) : '<span class="ds-t-tertiary">—</span>'}</td>
          <td class="${TD}"><div>${pill(ph ? ph.label : label, ph ? ph.tone : 'unknown', { verbatim: !ph })}</div>${ph ? '' : hot('This screen does not recognise that stage, so it is shown exactly as the database returned it.')}${str(r.disposition_reason) ? muted(esc(str(r.disposition_reason))) : ''}</td>
          <td class="${TD}" style="white-space:normal;max-width:260px">${str(r.origin_explanation) ? esc(str(r.origin_explanation)) : muted('The database recorded no explanation of how this origin is attested, so none is being invented here.')}</td>
        </tr>`;
      }).join('')}</tbody></table></div>
      <div class="px-space-md py-2.5 bg-surface-container-low border-t border-outline-variant/30 font-label-numeric-sm text-label-numeric-sm text-outline">Showing ${count(rows.length)} of ${count(mine.length)} hand-recorded arrivals · a hand-recorded enquiry is attested by the person who typed it and by nothing stronger — that is exactly what a walk-in is${leadErr ? ' · the lead rows could not be read, so customer columns are blank' : ''}</div>`;
  };
  q('[data-ledger]').innerHTML = `<section class="${SECTION}">${ledgerHead}<div data-ledger-body>${drawLedger('')}</div></section>`;
  q('[data-ledger-q]').addEventListener('input', e => { q('[data-ledger-body]').innerHTML = drawLedger(e.target.value); });

  /* ── The limits of this screen ──────────────────────────────────────────
     Fixed, true whether or not the reads succeeded. */
  const manualCount = s.err ? null : usable.length;
  const limits = [
    { icon: 'groups', limit: 'It counts what was recorded, never what happened.',
      why: 'Every figure here is a count of enquiries somebody typed in. A customer who walked onto the forecourt and was never entered is invisible to this database, and no number on this page is evidence about how many people came through the door.' },
    { icon: 'content_copy', limit: 'It cannot tell two reps recording one customer from two customers.',
      why: 'Two people entering the same walk-in produce two leads, deliberately: they are two acts of recording. The duplicate guard only stops the SAME form being submitted twice — it does not look at names, phone numbers or faces.' },
    { icon: 'call_missed', limit: 'It says nothing about whether anybody followed up.',
      why: 'A lead recorded here is a lead that exists. Whether it was called back, quoted or left to go cold is answered on the Leads screen and by the follow-up engines.' },
    { icon: 'history', limit: capped == null
        ? 'The arrivals record is read in a capped window, and it could not be read on this visit.'
        : capped ? `The counts above are floors, not totals — the cap of ${num(ARRIVALS_LIMIT)} arrivals was reached.`
          : 'The arrivals record is read in a capped window, and on this visit the window held everything.',
      why: `This screen reads the ${num(ARRIVALS_LIMIT)} most recent arrivals, newest first.` },
    { icon: 'rule', limit: 'It does not decide what you are allowed to record.',
      why: 'The form offers the sources whose enquiries arrive as a person, and the database refuses anything else regardless. '
        + (manualCount == null ? 'Which sources those are could not be read on this visit.' : `${num(manualCount)} ${plural(manualCount, 'source is', 'sources are')} offered in this build.`) },
  ];
  q('[data-limits]').innerHTML = `<section class="${SECTION}">
    <div class="px-space-md py-3 flex items-start gap-3 border-b border-outline-variant/30">
      <span class="w-9 h-9 rounded-lg bg-surface-container text-primary flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[20px]">info</span></span>
      <div><div class="font-headline-md text-headline-md text-on-surface">What this screen cannot tell you</div>
        <div class="font-body-sm text-body-sm text-on-surface-variant">Listed because a screen that only shows what it knows reads as though it knows everything.</div></div>
    </div>
    ${(o.err || s.err) ? `<div class="px-space-md pt-space-md">${note('warm', 'warning', '<strong>Part of this screen could not be read on this visit.</strong> The limits below are true regardless. The panels above are unread rather than empty — nothing is being cleared and nothing is being blamed.')}</div>` : ''}
    <div class="p-space-md grid grid-cols-1 md:grid-cols-2 gap-space-md">${limits.map(l => `
      <div class="p-space-md rounded-lg bg-surface-container-low flex items-start gap-3">
        <span class="material-symbols-outlined text-[18px] text-outline">${esc(l.icon)}</span>
        <div><div class="font-body-md text-body-sm font-semibold text-on-surface">${esc(l.limit)}</div>
          <p class="font-body-sm text-body-sm text-on-surface-variant mt-1">${esc(l.why)}</p></div>
      </div>`).join('')}</div>
  </section>`;

  q('[data-foot]').innerHTML = trustFooter({
    source: 'lead_source_catalogue · nexus_lead_source_readiness · v_lead_origin',
    asOf: dubaiStamp(readAt),
    evidence: o.err ? 'The arrivals record could not be read' : `${count(T.all.length)} arrivals read${capped ? ` (capped at ${num(ARRIVALS_LIMIT)})` : ''}`,
    actor: actorName(),
  });
};

/* The result card goes into the side column after a save, and its Open lead
   button reads the lead the database made and opens it in the lead drawer. */
function showRecorded(host, r) {
  const slot = host.querySelector('[data-recorded]');
  if (!slot || !r) return;
  slot.innerHTML = recordedCard(r);
  slot.querySelector('[data-screen-link]')?.addEventListener('click', () => go('leads'));
  slot.querySelector('[data-open-recorded]')?.addEventListener('click', async e => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const rows = await db(`leads?select=*,users(id,name)&id=eq.${encodeURIComponent(b.dataset.openRecorded)}&limit=1`);
      if (rows && rows.length) leadDrawer(rows[0]);
      else slot.insertAdjacentHTML('beforeend', `<div class="mt-2">${muted('That lead is not readable right now — it may have been removed since it was recorded.')}</div>`);
    } catch (err) {
      slot.insertAdjacentHTML('beforeend', `<div class="mt-2">${hot('The lead could not be read — ' + esc(err.message || String(err)))}</div>`);
    } finally { b.disabled = false; }
  });
}
