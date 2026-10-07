/* NEXUS OS — screens/owner-brief.js

   OWNER BRIEF — ◐ PARTIAL in the navigation. Design:
   design/stitch/owner-brief-executive-daily-briefing--6eaf47.html.

   Built 7 Oct 2026 from that export, and from NOTHING the backend does not
   already hold. Every figure on this page is a read another screen already
   makes, re-used through the module that owns it, so the brief cannot become a
   second derivation of anything:

     Top risks            buildLeaks() / buildLeadLeaks() from
                          screens/money-leaks.js — the top of THAT register,
                          not a ranking of this screen's own
     Gross margin exposed expose() from screens/overview.js, over those lines
     Recovered            recoveryEvidence() from screens/actions.js — the
                          four-column test, never re-implemented
     Hot leads            leads.status, the column the router writes
     Aged vehicles        the Profit Sentinel's own aging_band
     Appointments         rpc/nexus_appointment_status, the read
                          screens/appointments.js makes
     First reply          v_lead_recovery.sla_state, against the dealership's
                          own first-response target

   WHAT THE STITCH MOCK ASKS FOR AND THIS PAGE REFUSES TO PRINT:

   · "Revenue at risk — ESTIMATED". No engine in NEXUS produces an estimate of
     revenue at risk (screens/money-leaks.js MONEY_WORD says so in as many
     words). The tile keeps its label and its word, shows "—", and names the
     nearest real figure — gross margin EXPOSED in unsold stock — as what it is.
   · "Recovered — CONFIRMED" as an amount. A recovery is CONFIRMED here only by
     a recorded sale linked to the action, and the tile counts those outcomes.
     The money attached to them is ATTRIBUTED (a person tied the sale to the
     action and recorded on what basis) and is printed under that word.
   · "Top opportunities". There is no opportunity engine. The block is drawn as
     the export draws it — COMING SOON — with no figure on it.
   · "Export Dossier (PDF)". Nothing in this build produces one, so there is no
     button for it.

   Unknown is not zero: every tile whose read failed says "Not read" in words. */
import { ME, db } from '../lib/data.js';
import { aed, dubaiDate, dubaiStamp, esc, n0, num } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { BTN, comingSoonPanel, errorState, skeleton, trustFooter } from '../lib/stitch-ui.js';
import { buildLeaks, buildLeadLeaks, MONEY_WORD, readAllLeads, readActions, readEngine, readLeads,
         readQueue, resetReads } from './money-leaks.js';
import { EXPOSURE_CAVEAT, expose } from './overview.js';
import { recoveryEvidence } from './actions.js';

const str = v => String(v == null ? '' : v).trim();
const up = v => str(v).toUpperCase();
const plural = (n, one, many) => (Number(n) === 1 ? one : many);
const settle = p => p.then(v => ({ v, err: null }), e => ({ v: null, err: e }));
const para = h => `<p>${h}</p>`;
/* The same <details> affordance money-leaks.js uses for a demoted sentence: in
   the DOM open or closed, never a tooltip. */
const note = (body, label = 'Why') => (body
  ? `<details class="mt-1"><summary class="cursor-pointer list-none inline-flex items-center gap-0.5 font-body-sm text-[11px] text-primary font-medium underline">${esc(label)}<span class="material-symbols-outlined text-xs">help</span></summary>`
    + `<div class="mt-1.5 p-space-sm bg-surface-container-lowest border border-outline-variant/40 rounded-lg font-body-sm text-[12px] text-on-surface-variant leading-relaxed space-y-1.5">${body}</div></details>`
  : '');

/* The same window screens/appointments.js reads, so the two screens ask the
   accessor the same question. */
const APPT_DAYS = 7;

/* ── The export's tile, six variants of the value colour and the tag ─────── */
const TAG = {
  estimated: 'px-2 py-0.5 rounded text-[10px] font-label-numeric-sm bg-error-container text-on-error-container font-semibold',
  confirmed: 'px-2 py-0.5 rounded text-[10px] font-label-numeric-sm bg-surface-container-high text-primary font-semibold',
};
const VAL = {
  danger: 'font-label-numeric-lg text-label-numeric-lg text-error font-bold tracking-tight',
  primary: 'font-label-numeric-lg text-label-numeric-lg text-primary font-bold tracking-tight',
  plain: 'font-label-numeric-lg text-label-numeric-lg text-on-surface font-bold tracking-tight',
  muted: 'font-label-numeric-lg text-label-numeric-lg text-outline font-bold tracking-tight',
};
const ICON = {
  primary: 'material-symbols-outlined text-primary text-base',
  secondary: 'material-symbols-outlined text-secondary text-base',
  tertiary: 'material-symbols-outlined text-tertiary text-base',
};
/* `value` and `sub` are TEXT; `noteHtml` is HTML; `href` a screen id. */
const tile = ({ label, tag, iconName, iconTone = 'primary', value, valTone = 'plain', sub, noteHtml = '', href }) =>
  `<div class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
    <div class="flex items-start justify-between gap-2 mb-space-sm">
      <span class="font-table-header text-table-header uppercase text-outline tracking-wider">${esc(label)}</span>
      ${tag ? `<span class="${TAG[tag]}">${esc(tag.toUpperCase())}</span>` : `<span class="${ICON[iconTone] || ICON.primary}">${esc(iconName)}</span>`}
    </div>
    <div class="my-space-xs"><div class="${VAL[value == null ? 'muted' : valTone] || VAL.plain}">${esc(value == null ? '—' : value)}</div></div>
    <div class="pt-space-sm text-body-sm font-body-sm text-on-surface-variant flex flex-col">
      <span>${esc(sub)}</span>${note(noteHtml, 'How this is counted')}
      ${href && SCREENS[href] ? `<button type="button" data-go="${esc(href)}" class="${BTN.tertiary} mt-1.5 self-start"><span>Open</span><span class="material-symbols-outlined text-[16px]">arrow_forward</span></button>` : ''}
    </div>
  </div>`;

const notRead = (label, err, iconName) => tile({ label, iconName, value: null,
  sub: 'Not read — this figure could not be fetched, so nothing is claimed either way.',
  noteHtml: para(`The read failed (${esc(str(err && err.message) || 'no reason given')}). An unread figure is not a zero, and none is printed.`) });

SCREENS.ownerbrief = async host => {
  resetReads();
  const readAt = new Date().toISOString();
  const root = document.createElement('div');
  root.className = 'nx-stitch flex flex-col gap-space-md';
  host.appendChild(root);
  const actor = ME && ME.name ? ME.name : '';

  root.innerHTML = `
    <div class="w-full bg-surface-container-lowest rounded-xl p-space-xl shadow-sm">
      <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-space-lg">
        <div class="space-y-space-xs">
          <div class="flex items-center gap-space-sm flex-wrap">
            <span class="px-2 py-0.5 rounded text-[11px] font-label-numeric-sm bg-surface-container-high text-secondary font-semibold uppercase tracking-wider">Work / Executive desk</span>
            <span class="px-2.5 py-0.5 rounded-full text-[11px] font-label-numeric-sm bg-surface-container-highest font-bold flex items-center gap-1.5 shadow-sm text-on-secondary-container"><span class="w-2 h-2 rounded-full bg-secondary"></span>◐ PARTIAL</span>
            <span class="text-outline text-body-sm">•</span>
            <span class="font-body-sm text-body-sm text-on-surface-variant font-medium">Executive daily briefing</span>
          </div>
          <h1 class="font-headline-xl text-headline-xl text-on-surface tracking-tight font-bold">Owner Brief</h1>
        </div>
        <div class="flex items-center gap-space-sm self-start lg:self-center">
          <button type="button" data-refresh class="flex items-center gap-2 px-space-md py-2 bg-surface-container-low text-on-surface hover:bg-surface-container rounded-lg font-body-sm text-body-sm font-semibold transition-all shadow-sm"><span class="material-symbols-outlined text-lg text-primary">sync</span><span>Refresh data</span></button>
          ${SCREENS.moneyleaks ? `<button type="button" data-go="moneyleaks" class="flex items-center gap-2 px-space-md py-2 bg-primary text-on-primary hover:bg-primary-container rounded-lg font-body-sm text-body-sm font-semibold shadow-sm transition-all"><span class="material-symbols-outlined text-lg">trending_down</span><span>Open Today's Money Leaks</span></button>` : ''}
        </div>
      </div>
      <div class="mt-space-lg bg-surface-container-low rounded-lg px-space-md py-space-sm flex flex-col md:flex-row md:items-center justify-between gap-space-sm text-body-sm font-body-sm">
        <div class="flex items-center gap-2 text-on-surface-variant flex-wrap">
          <span class="material-symbols-outlined text-base text-tertiary">sensors</span>
          <span>Compiled: <strong class="text-on-surface font-semibold">${esc(dubaiStamp(readAt))}</strong></span>
          <span class="text-outline-variant hidden sm:inline">•</span>
          <span data-slot="sources">Reading seven sources…</span>
        </div>
        <div class="flex items-center gap-2 text-on-surface-variant font-label-numeric-sm text-label-numeric-sm">
          <span class="w-2 h-2 rounded-full bg-tertiary"></span><span>Read on this visit — nothing is cached</span>
        </div>
      </div>
    </div>
    <div data-slot="tiles">${skeleton({ rows: 2 })}</div>
    <div data-slot="risks">${skeleton({ rows: 3 })}</div>
    <div data-slot="opps"></div>
    <div data-slot="footer"></div>`;
  root.querySelector('[data-refresh]').addEventListener('click', () => go('ownerbrief'));
  const put = (id, html) => {
    const n = root.querySelector(`[data-slot="${id}"]`);
    if (!n) return;
    n.innerHTML = html;
    n.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
    n.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => go('ownerbrief')));
  };
  root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));

  const [ld, ac, e, q, l, ap] = await Promise.all([
    settle(readAllLeads()), settle(readActions()), settle(readEngine()), settle(readQueue()), settle(readLeads()),
    settle(db(`rpc/nexus_appointment_status?p_days=${APPT_DAYS}`)),
  ]);
  if (!root.isConnected) return;
  const reads = [ld, ac, e, q, l, ap];
  const failed = reads.filter(x => x.err).length;
  put('sources', failed
    ? `<span>${esc(num(reads.length - failed))} of ${esc(num(reads.length))} reads answered — <strong class="text-error">${esc(num(failed))} could not be read</strong>, and the tiles that rest on them say so</span>`
    : `<span>All ${esc(num(reads.length))} reads answered</span>`);

  const leadsAll = ld.err ? null : (ld.v || []);
  const engine = e.err ? null : (e.v || []);
  const queue = q.err ? null : (q.v || []);
  const recovery = l.err ? null : (l.v || []);
  const today = dubaiDate(Date.now());

  /* The register, built by the module that owns it. */
  const leaks = (engine && queue) ? buildLeaks(engine, queue) : null;
  const all = leaks ? leaks.concat(recovery ? buildLeadLeaks(recovery) : []) : null;
  const sized = leaks ? leaks.filter(x => up(x.size.word) === 'EXPOSED') : [];
  const exposed = expose(sized, x => x.size.amount, x => x.size.kind);

  /* ── 1 · Revenue at risk — ESTIMATED, and no engine estimates it ─────────── */
  const riskTile = tile({ label: 'Revenue at risk', tag: 'estimated', value: null,
    sub: leaks == null ? 'No estimate exists, and the exposure figure could not be read either.'
      : exposed.total == null ? 'No estimate exists. No exposed-margin figure is on file either.'
        : `No estimate exists. Gross margin exposed in unsold stock is ${aed(exposed.total)} — exposed, not estimated.`,
    noteHtml: para('No engine in NEXUS produces an estimate of revenue at risk, so this tile carries no figure rather than a number nobody computed.')
      + para(esc(MONEY_WORD.ESTIMATED.gloss))
      + (exposed.total != null ? para(esc(EXPOSURE_CAVEAT)) : '')
      + para('No enquiry in this database carries an opportunity value, so the customer half of a true "revenue at risk" does not exist at any confidence.'),
    href: 'moneyleaks' });

  /* ── 2 · Recovered — CONFIRMED by a recorded sale, counted ─────────────── */
  let recoveredTile;
  if (ac.err && q.err) recoveredTile = notRead('Recovered', ac.err, 'verified');
  else {
    const rows = [...(ac.err ? [] : (ac.v || [])), ...(queue || [])];
    const evs = rows.map(r => recoveryEvidence(r));
    const ok = evs.filter(x => x.state === 'ATTRIBUTED');
    const att = expose(ok, x => x.amount, () => 'ATTRIBUTED_MARGIN');
    const bad = evs.filter(x => x.state === 'UNSUPPORTED').length;
    recoveredTile = tile({ label: 'Recovered', tag: 'confirmed', valTone: 'primary',
      value: ok.length ? `${num(ok.length)} ${plural(ok.length, 'outcome', 'outcomes')}` : null,
      sub: ok.length
        ? `A recorded sale is linked to each. ${att.total == null ? 'No attributed figure is on file.' : `${aed(att.total)} is attributed to them — attributed, not confirmed.`}`
        : `No recovery has a recorded sale behind it yet — ${num(rows.length)} action ${plural(rows.length, 'record', 'records')} tested.`,
      noteHtml: para('A recovery is confirmed here only when all four evidence columns are on the action: an ATTRIBUTED outcome, a linked recorded sale, a basis for tying the two together and a basis for the figure. The test is the one in the Action Center, imported rather than repeated.')
        + para('The count is of outcomes. Any money beside it is the ATTRIBUTED value somebody recorded, which is not confirmed revenue — the sale itself is.')
        + (bad ? para(`${esc(num(bad))} ${plural(bad, 'action claims', 'actions claim')} a recovered amount without all four columns. ${plural(bad, 'It is', 'They are')} withheld, and the Action Center names what is missing.`) : '')
        + ((ac.err || q.err) ? para(`${ac.err ? 'The recovery action queue' : 'The inventory action queue'} could not be read, so its outcomes are missing from this count.`) : ''),
      href: 'actions' });
  }

  /* ── 3 · Hot leads ───────────────────────────────────────────────────── */
  const hotTile = leadsAll == null ? notRead('Hot leads', ld.err, 'local_fire_department') : (() => {
    const hot = leadsAll.filter(x => up(x.status) === 'HOT');
    const fresh = hot.filter(x => Date.now() - Date.parse(x.created_at) <= 86400000).length;
    return tile({ label: 'Hot leads', iconName: 'local_fire_department', value: num(hot.length),
      sub: `${num(fresh)} arrived in the last 24 h · of ${num(leadsAll.length)} on file`,
      noteHtml: para('Counted on leads.status — the same column the router writes and every other screen routes on.'),
      href: 'leads' });
  })();

  /* ── 4 · Aged vehicles — the Sentinel's band, never inventory.aging_alert ─ */
  const agedTile = engine == null ? notRead('Aged vehicles', e.err, 'timer') : (() => {
    const aged = engine.filter(u => ['CRITICAL', 'WARNING'].includes(up(u.aging_band)));
    const oldest = engine.reduce((a, u) => { const d = n0(u.days_in_stock); return d != null && (a == null || d > a) ? d : a; }, null);
    const noHold = engine.filter(u => up(u.holding_cost_state) !== 'COMPUTED').length;
    return tile({ label: 'Aged vehicles', iconName: 'timer', iconTone: 'secondary', value: `${num(aged.length)} ${plural(aged.length, 'unit', 'units')}`,
      sub: `of ${num(engine.length)} in stock${oldest != null ? ` · oldest ${num(oldest)} days` : ''}`,
      noteHtml: para('Units the Profit Sentinel bands WARNING or CRITICAL on age, against this dealership’s own ageing thresholds.')
        + (noHold ? para(`What a day on the lot costs is not recorded for ${esc(num(noHold))} of ${esc(num(engine.length))} units, so the capital tied up and the rate it is being eaten are unknown — not nil — and no figure is shown.`) : ''),
      href: 'inventory' });
  })();

  /* ── 5 · Appointments booked for today ──────────────────────────────────── */
  const apptTile = ap.err ? notRead('Appointments', ap.err, 'calendar_month') : (() => {
    const rows = Array.isArray(ap.v) ? ap.v : [];
    const todays = rows.filter(r => r.counts_as_booked === true && r.starts_at && dubaiDate(r.starts_at) === today);
    const requested = rows.filter(r => up(r.state) === 'REQUESTED').length;
    return tile({ label: 'Appointments', iconName: 'calendar_month', iconTone: 'tertiary', value: `${num(todays.length)} today`,
      sub: `${num(requested)} ${plural(requested, 'request', 'requests')} still waiting for a time · ${num(rows.length)} in the ${APPT_DAYS}-day window`,
      noteHtml: para('Booked visits whose start time falls on today’s Dubai date, counted on the accessor’s own counts_as_booked flag — the same read the Appointments screen makes.'),
      href: 'appointments' });
  })();

  /* ── 6 · First reply — measured enquiries only, against the dealership's own target ── */
  const replyTile = recovery == null ? notRead('First-reply rate', l.err, 'bolt') : (() => {
    const open = recovery.filter(x => x.lead_is_open === true);
    const ok = open.filter(x => up(x.sla_state) === 'WITHIN_SLA').length;
    const late = open.filter(x => up(x.sla_state) === 'BREACHED_SLA').length;
    const measured = ok + late;
    const target = recovery.length ? n0(recovery[0].sla_first_response_minutes) : null;
    return tile({ label: 'First-reply rate', iconName: 'bolt',
      value: measured ? `${Math.round((ok / measured) * 100)}%` : null,
      sub: measured
        ? `${num(ok)} of ${num(measured)} measured open enquiries answered within ${target == null ? 'the target' : `${num(target)} min`}`
        : `No open enquiry carries a measurable first response — ${num(open.length)} open.`,
      noteHtml: para('Counted on v_lead_recovery.sla_state over OPEN enquiries: WITHIN_SLA against BREACHED_SLA. An enquiry with no measurable first response is counted in neither, rather than as fast or slow.')
        + (open.length - measured > 0 ? para(`${esc(num(open.length - measured))} open ${plural(open.length - measured, 'enquiry carries', 'enquiries carry')} no measurable first response and ${plural(open.length - measured, 'is', 'are')} outside this rate.`) : ''),
      href: 'leadrecovery' });
  })();

  put('tiles', `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-space-md">${riskTile}${recoveredTile}${hotTile}${agedTile}${apptTile}${replyTile}</div>`);

  /* ── Top risks: the first three complete lines of the leak register ─────── */
  if (all == null) {
    put('risks', `<div class="w-full bg-surface-container-lowest rounded-xl p-space-xl shadow-sm">${errorState({ what: 'the top risks', err: q.err || e.err, retry: 'ownerbrief' })}</div>`);
  } else {
    const top = all.filter(x => !x.missing.length).slice(0, 3);
    const BADGE = {
      hot: 'px-2 py-0.5 rounded-full text-[10px] font-label-numeric-sm bg-error-container text-on-error-container font-semibold',
      warm: 'px-2 py-0.5 rounded-full text-[10px] font-label-numeric-sm bg-[#FEF3E2] text-[#96570A] font-semibold',
    };
    const risk = x => {
      const word = MONEY_WORD[up(x.size.word)];
      const amount = up(x.size.word) === 'NOT_COMPUTABLE' ? null : n0(x.size.amount);
      return `<div class="bg-surface-container-low rounded-xl p-space-lg shadow-sm flex flex-col xl:flex-row gap-space-lg items-stretch justify-between">
        <div class="flex-1 space-y-space-sm min-w-0">
          <div class="flex flex-wrap items-center gap-space-sm">
            <span class="px-2 py-0.5 rounded text-[10px] font-label-numeric-sm bg-surface-container-high text-primary font-bold">${x.rank ? `#${esc(String(x.rank))}` : 'UNRANKED'}</span>
            <h3 class="font-headline-md text-headline-md text-on-surface font-bold">${esc(x.what)}</h3>
            <span class="${x.tone === 'hot' ? BADGE.hot : BADGE.warm}">${esc(up(x.badge))}</span>
          </div>
          <div class="flex items-center gap-space-sm text-body-sm font-body-sm text-on-surface flex-wrap">
            <span class="material-symbols-outlined text-base text-primary">hub</span>
            <span class="text-on-surface-variant">${esc(x.kind === 'LEAD_AT_RISK' ? 'Raised by the Lead Recovery engine' : 'Raised by the Inventory Profit Sentinel')}</span>
            ${x.heldDays != null ? `<span class="text-outline">•</span><span class="text-secondary font-label-numeric-sm">Open ${esc(num(x.heldDays))} ${plural(x.heldDays, 'day', 'days')}</span>` : ''}
          </div>
          <div class="bg-surface-container-lowest rounded-lg p-space-md text-body-sm font-body-sm text-on-surface space-y-1">
            <div class="flex items-start gap-2"><span class="material-symbols-outlined text-error text-base shrink-0 mt-0.5">warning</span>
              <p class="text-on-surface font-medium leading-relaxed">${esc(x.why)}</p></div>
          </div>
        </div>
        <div class="xl:w-80 flex flex-col justify-between bg-surface-container-lowest rounded-xl p-space-md gap-space-md">
          <div class="space-y-1">
            <span class="font-table-header text-table-header uppercase text-outline tracking-wider">Financial exposure</span>
            <div class="font-label-numeric-md text-label-numeric-md font-bold ${amount == null ? 'text-outline' : 'text-error'} flex items-center justify-between gap-2">
              <span>${esc(amount == null ? 'Not computable' : aed(amount))}</span>
              <span class="text-[10px] font-semibold bg-error-container text-on-error-container px-2 py-0.5 rounded">${esc((word ? word.label : 'unsized').toUpperCase())}</span>
            </div>
            <p class="text-[11px] font-body-sm text-on-surface-variant">${esc(firstSentence(x.size.basis) || (word ? word.gloss : ''))}</p>
          </div>
          <div class="flex flex-col gap-2">
            <p class="text-[12px] font-body-sm text-on-surface"><span class="font-semibold">Recommended:</span> ${esc(x.action.ask)}</p>
            ${SCREENS[x.action.screen] ? `<button type="button" data-go="${esc(x.action.screen)}" class="w-full py-2 px-3 bg-primary text-on-primary hover:bg-primary-container rounded-lg font-body-sm text-body-sm font-semibold transition-colors flex items-center justify-center gap-1.5"><span class="material-symbols-outlined text-base">open_in_new</span><span>${esc(x.action.label)}</span></button>` : ''}
            ${SCREENS.moneyleaks ? `<button type="button" data-go="moneyleaks" class="py-1.5 px-2 bg-surface-container hover:bg-surface-container-high text-on-surface rounded font-body-sm text-[12px] font-semibold transition-colors text-center">See its evidence in Today's Money Leaks</button>` : ''}
          </div>
        </div>
      </div>`;
    };
    put('risks', `<div class="w-full bg-surface-container-lowest rounded-xl p-space-xl shadow-sm">
      <div class="flex flex-col md:flex-row md:items-center justify-between pb-space-lg gap-space-sm">
        <div class="space-y-1">
          <div class="flex items-center gap-2"><span class="material-symbols-outlined text-error text-xl">gavel</span>
            <h2 class="font-headline-lg text-headline-lg text-on-surface font-bold tracking-tight">Top risks requiring the owner's oversight</h2></div>
          <p class="font-body-md text-body-md text-on-surface-variant">The ${esc(num(top.length))} highest lines of today's leak register, ranked by the money behind each — the same lines, in the same order, as Today's Money Leaks.</p>
        </div>
        <span class="px-3 py-1 bg-surface-container-high rounded text-xs font-label-numeric-sm text-primary font-bold">LEAK LINES TODAY: ${esc(num(all.length))}</span>
      </div>
      ${top.length ? `<div class="flex flex-col gap-space-lg">${top.map(risk).join('')}</div>`
        : `<div class="bg-surface-container-low rounded-lg p-space-lg font-body-md text-body-md text-on-surface">Nothing is leaking that this product can evidence today. Every engine that holds real data was asked and came back clear — and the checks that could not run are listed on Today's Money Leaks, because a question nobody could ask is not one that came back clean.</div>`}
      ${l.err ? `<p class="mt-space-md font-body-sm text-body-sm text-[#96570A]">Lead Recovery could not be read, so the customer side of this list is missing rather than clear.</p>` : ''}
    </div>`);
  }

  /* ── Top opportunities — COMING SOON, exactly as the export draws it ────── */
  put('opps', `<div class="w-full bg-surface-container-lowest rounded-xl p-space-xl shadow-sm">
    <div class="flex items-center gap-space-sm mb-space-md"><span class="material-symbols-outlined text-tertiary text-xl">auto_graph</span>
      <h2 class="font-headline-lg text-headline-lg text-on-surface font-bold tracking-tight">Top opportunities</h2></div>
    ${comingSoonPanel({ kind: 'coming-soon', icon: 'model_training', title: 'No opportunity engine yet',
      body: 'Nothing in NEXUS scores opportunities today, so no customer, vehicle or amount is listed here. This block exists so the brief has a place for them the day an engine earns one.',
      prerequisite: 'An enquiry that carries a value, and a link from an enquiry to a unit — neither exists in this database yet.' })}
  </div>`);

  put('footer', `<div class="w-full bg-surface-container-low rounded-xl px-space-lg py-space-md flex flex-col sm:flex-row items-center justify-between gap-space-sm text-on-surface-variant font-body-sm text-body-sm shadow-sm">
      <div class="flex items-center gap-2"><span class="material-symbols-outlined text-base text-primary">verified_user</span>
        <span>This brief is compiled for <strong class="text-on-surface">${esc(actor || 'the signed-in account')}</strong> from live reads. Decisions are recorded on the screens each line links to, not here.</span></div>
    </div>
    <div class="mt-space-md">${trustFooter({
      source: 'money-leaks register · leads · lead_recovery_actions · rpc/sentinel_inventory_actions · v_lead_recovery · rpc/nexus_appointment_status',
      asOf: dubaiStamp(readAt),
      evidence: `${num(reads.length - failed)} of ${num(reads.length)} reads answered${all ? ` · ${num(all.length)} leak lines` : ''}`,
      actor,
    })}</div>`);
};

const firstSentence = t => {
  const s0 = str(t);
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(s0);
  return m ? m[0] : s0;
};
