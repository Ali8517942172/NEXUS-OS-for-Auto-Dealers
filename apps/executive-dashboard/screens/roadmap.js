/* NEXUS OS — screens/roadmap.js

   The fifteen roadmap routes the Stitch navigation carries under each group's
   "+N coming soon" row (lib/nav.js, `roadmap:` entries). One module, fifteen
   registrations, each written out as `SCREENS.<id> = …` because
   QUALITY_GATE.mjs S1 reads the registry from that literal form.

   Built 7 Oct 2026 from each route's own Stitch export (MAP.md "Roadmap
   screens"). Every screen is the same four parts:

     1. The header, with the COMING SOON / PLANNED badge, one honest sentence
        and the only three actions a roadmap screen may offer: Notify me,
        Preview and Learn more.
     2. A compact coming-soon note (the canonical panel's colours), carrying
        the prerequisite line.
     3. The route's Stitch layout, generated into lib/roadmap-layouts.js
        with every number, name and amount replaced by "—" (that file's header
        says exactly what the generator stripped). It is drawn inert — no
        pointer events, hidden from assistive tech — because nothing in it is
        a control and nothing in it is data. It loads with a dynamic import(),
        so the working screens never download it.
     4. Nothing else. No route here reads any data, so none can claim any.

   NOTIFY ME DOES NOT FAKE A BACKEND. There is no table or RPC in the database
   that records interest in a roadmap item (checked 7 Oct 2026: no
   interest / waitlist / notify object in `public`). So the button remembers
   the request in this browser through lib/prefs.js and says exactly that —
   "Saved on this device" — and says that nobody is told automatically. A
   button that implied NEXUS would email you, when nothing could, would be the
   product promising something it does not do.

   The prerequisites are facts recorded in CLAUDE.md and PRODUCT.md (no service
   table, no reconditioning-cost column, no Dubizzle leads feed, messages joined
   by email address), not estimates. */
import { NAV, SCREENS, go, staleRender, currentGeneration } from '../lib/nav.js';
import { esc } from '../lib/format.js';
import { readFlag, writeFlag } from '../lib/prefs.js';
import { BTN, sectionHeader, statusChip, emptyState, openStitchModal } from '../lib/stitch-ui.js';

/* ── Notify me, remembered on this device only ───────────────────────────── */
const notifyKey = id => `nexus.roadmap.notify.${id}`;
const notifyWanted = id => readFlag(notifyKey(id), false);
const setNotify = (id, on) => writeFlag(notifyKey(id), on);

/* The roadmap catalogue. Exported so What's Coming lists the same sentence and
   prerequisite the screen itself shows — one derivation, not two. */
const ROADMAP = {
  stockmatch: { kind: 'coming-soon', icon: 'join_inner', design: 'stock-to-lead-matching-stalled-inventory-matcher--f0cc94.html',
    body: 'Matches ageing stock to the people who asked about similar cars.',
    prerequisite: 'Enough leads with a recorded vehicle of interest to match against.' },
  dealroom: { kind: 'coming-soon', icon: 'meeting_room', design: 'deal-room-transaction-delivery-desk--504ea2.html',
    body: 'One place to carry a deal from agreement to delivery.',
    prerequisite: 'Deal stages recorded beyond closed-won.' },
  servicerecovery: { kind: 'planned', icon: 'car_repair', design: 'service-revenue-recovery-aftersales-workshop-leak-desk--cf4df8.html',
    body: 'Finds customers who are due back in the workshop and have not booked.',
    prerequisite: 'A service and appointment history from the workshop system — NEXUS holds none today.' },
  tradein: { kind: 'planned', icon: 'sync_alt', design: 'trade-in-desk-appraisal-valuation-engine--5dd9a2.html',
    body: 'Records a trade-in appraisal alongside the deal it belongs to.',
    prerequisite: 'A trade-in appraisal record, which does not exist yet.' },
  acquisition: { kind: 'planned', icon: 'shopping_cart', design: 'acquisition-advisor-inventory-procurement-intelligence--022747.html',
    body: 'Suggests which vehicles to buy next from what is selling.',
    prerequisite: 'Market prices for vehicles the dealership does not yet own.' },
  recon: { kind: 'planned', icon: 'build_circle', design: 'reconditioning-tracker-workshop-frontline-speed--256de8.html',
    body: 'Tracks each unit from purchase to front line, and what it cost to get there.',
    prerequisite: 'A reconditioning cost per unit — inventory has no such column today.' },
  marketplace: { kind: 'planned', icon: 'storefront', design: 'marketplace-performance-portal-roi-ingestion--27d9b0.html',
    body: 'Shows which listing portals bring enquiries that turn into sales.',
    prerequisite: 'Enquiries delivered from the portals; Dubizzle has no public leads feed.' },
  ownership360: { kind: 'planned', icon: 'manage_history', design: 'ownership-360-vehicle-lifecycle-relationship-dossier--069a9f.html',
    body: 'Follows a sold vehicle and its owner after the sale.',
    prerequisite: 'A service history linked to each sold vehicle.' },
  marketsentinel: { kind: 'planned', icon: 'radar', design: 'market-sentinel-competitor-demand-telemetry--c8b236.html',
    body: 'Watches competitor pricing and local demand together.',
    prerequisite: 'Demand data beyond the current competitor price checks.' },
  eventgraph: { kind: 'planned', icon: 'schema', design: 'dealership-event-graph-unified-customer-journey-node-telemetry--a1a5b9.html',
    body: "Draws one customer's whole journey across every channel.",
    prerequisite: 'A lead reference on every message and audit row; today some are joined by email address only.' },
  benchmarking: { kind: 'planned', icon: 'leaderboard', design: 'dealer-benchmarking-anonymous-regional-peer-telemetry--39d2e5.html',
    body: 'Compares your figures with anonymised dealerships like yours.',
    prerequisite: 'Several dealerships agreeing to share anonymised figures.' },
  calls: { kind: 'planned', icon: 'call', design: 'calls-voice-telephony-voice-ai--161aef.html',
    body: 'Brings phone calls into NEXUS as enquiries and history.',
    prerequisite: "A connection to the dealership's phone system." },
  customerportal: { kind: 'planned', icon: 'person_pin', design: 'customer-portal-buyer-facing-deal-tracker-vault--242e13.html',
    body: 'Lets a buyer follow their own deal and documents.',
    prerequisite: "A buyer sign-in that is separate from the dealership's." },
  branches: { kind: 'planned', icon: 'account_tree', design: 'group-branches-multi-entity-management--ed025f.html',
    body: 'Runs several rooftops under one dealership group.',
    prerequisite: 'More than one rooftop per account; this build answers as one dealership.' },
  localization: { kind: 'planned', icon: 'translate', design: 'markets-localization-regional-country-packs--1ab4b6.html',
    body: 'Adds country packs beyond the UAE.',
    prerequisite: 'A second market to localise for.' },
};

const navItem = id => NAV.flatMap(g => g.items.map(i => ({ ...i, group: g.group || 'Settings' }))).find(i => i.id === id);

/* The canonical coming-soon panel's colours (lib/stitch-ui.js comingSoonPanel,
   states-components §5.6) in a compact row: the full panel's 260px minimum
   height left a blank band above the layout preview. */
const NOTE = {
  'coming-soon': { box: 'flex items-start gap-3 p-space-md rounded-lg border border-indigo-200 bg-indigo-50/20', icon: 'w-10 h-10 rounded bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0', title: 'font-headline-md text-body-lg font-semibold text-indigo-950', body: 'font-body-sm text-body-sm text-indigo-900', pre: 'font-label-numeric-sm text-label-numeric-sm text-indigo-900' },
  'planned':     { box: 'flex items-start gap-3 p-space-md rounded-lg border border-cyan-200 bg-cyan-50/20', icon: 'w-10 h-10 rounded bg-cyan-100 text-cyan-700 flex items-center justify-center shrink-0', title: 'font-headline-md text-body-lg font-semibold text-cyan-950', body: 'font-body-sm text-body-sm text-cyan-900', pre: 'font-label-numeric-sm text-label-numeric-sm text-cyan-900' },
};

/* Two complete class strings for the layout frame: collapsed and expanded. */
const FRAME = {
  closed: 'relative max-h-[560px] overflow-hidden',
  open:   'relative',
};
const FADE = {
  closed: 'absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-surface-container-lowest to-transparent',
  open:   'hide',
};

function notifyButton(id) {
  return notifyWanted(id)
    ? `<button type="button" class="${BTN.secondary}" data-rm-notify aria-pressed="true"><span class="material-symbols-outlined text-[18px]">notifications_active</span><span>Saved on this device</span></button>`
    : `<button type="button" class="${BTN.primary}" data-rm-notify aria-pressed="false"><span class="material-symbols-outlined text-[18px]">notifications</span><span>Notify me</span></button>`;
}

function learnMore(id) {
  const r = ROADMAP[id];
  const item = navItem(id);
  const m = openStitchModal({
    title: item?.title || id,
    bodyHtml: `<div class="flex flex-col gap-space-sm">
      <div>${r.kind === 'planned' ? statusChip('planned') : statusChip('coming-soon')}</div>
      <p class="font-body-md text-body-md text-on-surface">${esc(r.body)}</p>
      <div class="p-2.5 bg-surface-container-low rounded border border-outline-variant/40 font-label-numeric-sm text-label-numeric-sm text-on-surface-variant">Prerequisite: ${esc(r.prerequisite)}</div>
      <p class="font-body-sm text-body-sm text-on-surface-variant">${r.kind === 'planned'
        ? 'PLANNED means it is designed and on the roadmap, and the data it needs does not exist in NEXUS yet.'
        : 'COMING SOON means it is the next thing being built on data NEXUS mostly has already.'}
        Neither word is a delivery date, and this screen reads none of your data.</p>
    </div>`,
    footHtml: `<button type="button" class="${BTN.secondary}" data-rm-all>See everything on the roadmap</button>`,
  });
  m.wrap.querySelector('[data-rm-all]')?.addEventListener('click', () => { m.close(); go('whatscoming'); });
}

const roadmap = id => async host => {
  const r = ROADMAP[id];
  const item = navItem(id);
  const title = item?.title || id;
  const gen = currentGeneration();
  const word = r.kind === 'planned' ? 'Planned' : 'Coming soon';
  host.innerHTML = `<div class="nx-stitch flex flex-col gap-space-md" data-stitch-design="${esc(r.design)}">
    ${sectionHeader({ eyebrow: `${item?.group || 'Roadmap'} · ${word}`, title, sub: r.body,
      actionsHtml: `<button type="button" class="${BTN.secondary}" data-rm-preview><span class="material-symbols-outlined text-[18px]">visibility</span><span>Preview</span></button>
        <button type="button" class="${BTN.secondary}" data-rm-learn><span class="material-symbols-outlined text-[18px]">help_outline</span><span>Learn more</span></button>
        <span data-rm-notify-slot>${notifyButton(id)}</span>` })}
    <div data-rm-note class="font-body-sm text-body-sm text-on-surface-variant"></div>
    <div class="${NOTE[r.kind].box}">
      <div class="${NOTE[r.kind].icon}"><span class="material-symbols-outlined text-[20px]">${esc(r.icon)}</span></div>
      <div class="min-w-0 flex flex-col gap-1">
        <div class="flex items-center gap-2 flex-wrap"><span class="${NOTE[r.kind].title}">${esc(title)}</span>${r.kind === 'planned' ? statusChip('planned') : statusChip('coming-soon')}</div>
        <p class="${NOTE[r.kind].body}">Not part of this build yet — nothing on this screen reads your data, so no figure on it is real.</p>
        <p class="${NOTE[r.kind].pre}">Prerequisite: ${esc(r.prerequisite)}</p>
      </div>
    </div>
    <section class="rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm">
      <div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex items-center justify-between gap-space-sm">
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="material-symbols-outlined text-primary text-xl">dashboard_customize</span>
          <div class="min-w-0"><div class="font-headline-md text-headline-md text-on-surface truncate">Planned layout</div>
            <div class="font-label-numeric-sm text-label-numeric-sm text-outline truncate">The designed screen with every value shown as —. Nothing here is a control or a figure.</div></div>
        </div>
        ${r.kind === 'planned' ? statusChip('planned') : statusChip('coming-soon')}
      </div>
      <div class="${FRAME.closed}" data-rm-frame>
        <div class="p-space-md pointer-events-none select-none opacity-80 flex flex-col gap-space-md" aria-hidden="true" data-rm-layout>
          <div class="font-body-sm text-body-sm text-outline">Loading the planned layout…</div>
        </div>
        <div class="${FADE.closed}" data-rm-fade></div>
      </div>
    </section>
  </div>`;

  const root = host.firstElementChild;
  const note = root.querySelector('[data-rm-note]');
  const wireNotify = () => root.querySelector('[data-rm-notify]')?.addEventListener('click', () => {
    const on = !notifyWanted(id);
    const saved = setNotify(id, on);
    root.querySelector('[data-rm-notify-slot]').innerHTML = notifyButton(id);
    wireNotify();
    note.textContent = !saved
      ? 'This browser would not let NEXUS remember that (site data is blocked or this is a private window), so nothing was saved.'
      : on
        ? `Saved on this device. NEXUS has no shared waiting list yet, so nobody is told and no email is sent — this browser remembers you asked, and ${title} is marked on What's Coming.`
        : 'Removed from this device.';
  });
  wireNotify();
  root.querySelector('[data-rm-learn]').addEventListener('click', () => learnMore(id));
  root.querySelector('[data-rm-preview]').addEventListener('click', () => {
    const frame = root.querySelector('[data-rm-frame]');
    const open = frame.className === FRAME.closed;
    frame.className = open ? FRAME.open : FRAME.closed;
    root.querySelector('[data-rm-fade]').className = open ? FADE.open : FADE.closed;
    if (open) frame.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  let layouts = null;
  try { ({ LAYOUTS: layouts } = await import('../lib/roadmap-layouts.js')); } catch { layouts = null; }
  if (staleRender(gen)) return;
  const slot = root.querySelector('[data-rm-layout]');
  slot.innerHTML = layouts && layouts[id]
    ? layouts[id]
    : emptyState({ icon: 'dashboard_customize', title: 'The planned layout could not be loaded',
        body: 'It is a static picture of the design and holds no data; everything above still applies.' });
};

SCREENS.stockmatch = roadmap('stockmatch');
SCREENS.dealroom = roadmap('dealroom');
SCREENS.servicerecovery = roadmap('servicerecovery');
SCREENS.tradein = roadmap('tradein');
SCREENS.acquisition = roadmap('acquisition');
SCREENS.recon = roadmap('recon');
SCREENS.marketplace = roadmap('marketplace');
SCREENS.ownership360 = roadmap('ownership360');
SCREENS.marketsentinel = roadmap('marketsentinel');
SCREENS.eventgraph = roadmap('eventgraph');
SCREENS.benchmarking = roadmap('benchmarking');
SCREENS.calls = roadmap('calls');
SCREENS.customerportal = roadmap('customerportal');
SCREENS.branches = roadmap('branches');
SCREENS.localization = roadmap('localization');

export { ROADMAP, notifyWanted };
