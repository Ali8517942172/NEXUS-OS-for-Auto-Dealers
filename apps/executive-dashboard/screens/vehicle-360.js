/* NEXUS OS — screens/vehicle-360.js · Vehicle 360

   ◐ PARTIAL. One unit from the lot, in full. Opened from Inventory — the unit
   card's open-in-new button and the unit drawer's "Open Vehicle 360 →" — and
   never from the sidebar (lib/nav.js marks the route `sidebar: false`).

   Design: design/stitch/vehicle-360-dossier-asset-telemetry--b25c7a.html. Built
   7 Oct 2026 by the Wave 1 migration. Every panel of that export is here, and
   each one says where its rows come from or why it has none:

     breadcrumb + header card ...... v_inventory_profit_sentinel (via
                                     sentinel_inventory_actions()), the unit's row
     Specs & dossier ............... the five facts inventory actually holds; the
                                     GCC spec sheet, photos, Mulkiya and plate are
                                     not recorded anywhere, and say so
     Acquisition & cost ............ RESTRICTED: cost, capital tied up, holding
                                     cost and net margin, shown to an owner or
                                     admin only (the same people the database lets
                                     set a cost — canSetCost / rbac_05)
     Pricing history ............... NEXUS keeps no price log; what it does keep
                                     is every repricing DECISION in
                                     v_inventory_action_queue, which is shown
     Market benchmark .............. the engine's own comparable and note; no
                                     decile strip, because there is no verified
                                     distribution to draw one from
     Matched demand ................ the engine's enquiry count, plus the leads
                                     whose stated interest contains this model's
                                     name — a TEXT match, labelled as one
     Desk log & deals .............. v_inventory_action_queue for this unit:
                                     proposals, decisions, outcomes and any sale
                                     the outcome was tied to
     Repairs & recon ............... ◇ PLANNED — no repair-order or recon-cost table
     Predicted days-to-sell ........ ◇ PLANNED — no model has been trained or tested

   ── How the unit id arrives ────────────────────────────────────────────────
   lib/nav.js routes by id only; it has no parameters, and a hash like
   `#vehicle360/NX-1010` would be read as an unknown id and sent home. So the
   caller hands the id to openVehicle360(), which keeps it in this module and
   then navigates. A cold load of `#vehicle360` (a reload, a bookmark) has no
   unit, and the screen offers the lot to pick from rather than guessing one.

   ── What this file computes ───────────────────────────────────────────────
   Nothing on money. Every figure is the engine's column, printed as the engine
   wrote it; a state the engine would not compute (NOT_COMPUTABLE, UNKNOWN_*) is
   printed as that state with the engine's note, never as a zero or a dash. */
import { canEditUnit, canSetCost, db, myRole } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, dubaiDate, dubaiStamp, esc, n0, num, tone } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { displayName } from '../lib/privacy.js';
import { BTN, comingSoonPanel, emptyState, errorState, skeleton, statusChip, trustFooter } from '../lib/stitch-ui.js';
import { CHIP, pill, table } from '../lib/desk-kit.js';
import { wireRows } from '../lib/ui.js';
import { unitForm } from '../lib/unit-form.js';

const str = v => String(v == null ? '' : v).trim();
const up = v => str(v).toUpperCase();
const plural = (n, one, many) => (Number(n) === 1 ? one : many);

let UNIT_ID = null;
let TAB = 'specs';

/* The one way in with a unit. Exported for screens/inventory.js. */
function openVehicle360(unitId) {
  UNIT_ID = unitId == null ? null : String(unitId);
  TAB = 'specs';
  go('vehicle360');
}

const RISK_TONE = { SEVERE: 'hot', HIGH: 'hot', ELEVATED: 'warm', LOW: 'cold', UNKNOWN: 'unknown' };
const riskTone = v => RISK_TONE[up(v)] || tone(v) || 'unknown';
const REC_TONE = { HOLD: 'ok', PROMOTE: 'cold', REPRICE: 'warm', INSPECT: 'warm', RECON: 'warm', TRANSFER: 'warm', MANAGER_REVIEW: 'hot', WHOLESALE: 'hot' };
const recTone = v => REC_TONE[up(v)] || 'unknown';

/* The same three-state rule screens/inventory.js prints: NOT_COMPUTABLE is
   words plus the engine's reason, PLACEHOLDER is the number with an "assumed"
   mark ON it, anything else is the number. */
function stateFigure(state, value, note) {
  const s = up(state);
  if (s === 'NOT_COMPUTABLE') {
    return `<span class="text-amber-700 font-semibold">Not computable</span>${str(note) ? `<div class="font-body-sm text-body-sm text-on-surface-variant whitespace-normal">${esc(str(note))}</div>` : ''}`;
  }
  if (s === 'PLACEHOLDER') return `${aed(value)} ${pill('assumed', 'warm', { verbatim: false })}`;
  return aed(value);
}

const TABS = [
  { key: 'specs',    icon: 'featured_play_list', label: 'Specs & dossier' },
  { key: 'cost',     icon: 'lock',               label: 'Acquisition & cost' },
  { key: 'pricing',  icon: 'show_chart',         label: 'Pricing history' },
  { key: 'market',   icon: 'radar',              label: 'Market benchmark' },
  { key: 'leads',    icon: 'contacts',           label: 'Matched demand' },
  { key: 'deals',    icon: 'contract',           label: 'Desk log & deals' },
  { key: 'recon',    icon: 'build',              label: 'Repairs & recon', planned: true },
  { key: 'forecast', icon: 'bolt',               label: 'Predicted days-to-sell', planned: true },
];
const TAB_CLS = {
  on: 'px-3 py-2 rounded-lg bg-primary-container text-on-primary font-body-sm text-body-sm font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap',
  off: 'px-3 py-2 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface font-body-sm text-body-sm font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap',
  planned: 'px-3 py-2 rounded-lg text-on-surface-variant/70 hover:bg-surface-container font-body-sm text-body-sm font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap',
};
const TAB_BADGE = {
  plain: 'px-1.5 py-0.5 rounded bg-surface-container font-label-numeric-sm text-[10px] text-outline',
  planned: 'px-1.5 py-0.5 rounded bg-surface-container-highest text-secondary font-label-numeric-sm text-[10px]',
};

const PANEL = 'bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-outline-variant/40 flex flex-col gap-space-md';
const EYEBROW = 'font-table-header text-table-header text-outline uppercase tracking-wider';
const H2 = 'font-headline-md text-headline-md text-on-surface';
const NOTE = 'font-body-sm text-body-sm text-on-surface-variant';
const FACT = 'p-space-sm rounded-lg bg-surface-container-low flex flex-col gap-1 min-w-0';
const FACT_K = 'font-table-header text-table-header text-on-surface-variant uppercase';
const FACT_V = 'font-body-md text-body-md font-semibold text-on-surface break-words';
const fact = (k, vHtml, subHtml) => `<div class="${FACT}"><span class="${FACT_K}">${esc(k)}</span><span class="${FACT_V}">${vHtml}</span>${subHtml ? `<span class="font-label-numeric-sm text-label-numeric-sm text-outline">${subHtml}</span>` : ''}</div>`;

/* ── No unit in hand: the lot, to pick from ───────────────────────────────── */
async function picker(host, why) {
  host.innerHTML = `<div class="nx-stitch flex flex-col gap-space-md">${crumb(null)}${skeleton({ rows: 3 })}</div>`;
  let rows;
  try { rows = await db('rpc/sentinel_inventory_actions'); } catch (e) {
    host.innerHTML = `<div class="nx-stitch flex flex-col gap-space-md">${crumb(null)}${errorState({ what: 'the lot', err: e, retry: 'v360' })}</div>`;
    host.querySelector('[data-retry]')?.addEventListener('click', () => go('vehicle360'));
    wireCrumb(host);
    return;
  }
  rows = Array.isArray(rows) ? rows : [];
  const cols = [
    { label: 'Stock #', strong: true, render: r => `<span class="font-label-numeric-sm text-primary font-bold">${esc(str(r.id))}</span>` },
    { label: 'Vehicle', render: r => esc(str(r.model) || 'Unnamed unit') },
    { label: 'Status', render: r => esc(str(r.status) || '—') },
    { label: 'Days', align: 'r', render: r => (n0(r.days_in_stock) == null ? '<span class="text-outline">Undated</span>' : num(r.days_in_stock)) },
    { label: 'Recommendation', render: r => (up(r.recommendation) ? pill(up(r.recommendation), recTone(r.recommendation), { verbatim: true }) : '<span class="text-outline">None</span>') },
  ];
  host.innerHTML = `<div class="nx-stitch flex flex-col gap-space-md">${crumb(null)}
    <div class="${PANEL}">
      <div><span class="${EYEBROW}">Pick a unit</span><h2 class="${H2}">Which vehicle?</h2>
        <p class="${NOTE} mt-1">${esc(why || 'Vehicle 360 opens one unit from Inventory. Pick one from the lot below.')}</p></div>
      ${table(cols, rows, { onRow: true, empty: emptyState({ icon: 'directions_car', title: 'No vehicles on the lot', body: 'The engine returned no units, so there is nothing to open.' }) })}
    </div>
    ${trustFooter({ source: 'sentinel_inventory_actions()', asOf: dubaiStamp(new Date().toISOString()), evidence: `${num(rows.length)} ${plural(rows.length, 'unit', 'units')}`, actor: myRole() || '—' })}
  </div>`;
  wireRows(host, rows, r => openVehicle360(str(r.id)));
  wireCrumb(host);
}

function crumb(r) {
  return `<div class="px-space-md py-space-sm rounded-lg bg-surface-container-low flex flex-wrap items-center justify-between gap-y-2">
    <div class="flex items-center gap-2">
      <span class="font-table-header text-table-header text-secondary uppercase tracking-wider">Assets</span>
      <span class="text-outline-variant font-label-numeric-sm text-label-numeric-sm">/</span>
      <span class="font-table-header text-table-header text-secondary uppercase tracking-wider">Inventory</span>
      <span class="text-outline-variant font-label-numeric-sm text-label-numeric-sm">/</span>
      <span class="font-table-header text-table-header text-primary uppercase tracking-wider font-semibold">Vehicle 360</span>
      ${r ? `<span class="text-outline-variant font-label-numeric-sm text-label-numeric-sm">/</span>
      <span class="font-label-numeric-sm text-label-numeric-sm px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface font-semibold">${esc(str(r.id))}</span>` : ''}
    </div>
    <div class="flex items-center gap-space-md">
      ${r ? `<div class="flex items-center gap-1.5 text-on-surface-variant font-label-numeric-sm text-label-numeric-sm">
        <span class="inline-block w-2 h-2 rounded-full bg-tertiary"></span>
        <span>Engine computed: <span class="font-semibold text-on-surface">${esc(dubaiStamp(r.computed_at))}</span></span></div>` : ''}
      <button type="button" data-back class="inline-flex items-center gap-1 text-primary hover:text-primary-container font-label-numeric-sm text-label-numeric-sm font-semibold transition-colors">
        <span class="material-symbols-outlined text-[16px]">arrow_back</span><span>Back to Inventory</span></button>
    </div>
  </div>`;
}
const wireCrumb = host => host.querySelector('[data-back]')?.addEventListener('click', () => go('inventory'));

SCREENS.vehicle360 = async host => {
  if (!UNIT_ID) { await picker(host); return; }
  const unitId = UNIT_ID;
  host.innerHTML = `<div class="nx-stitch flex flex-col gap-space-md">${crumb({ id: unitId })}${skeleton({ rows: 3 })}${skeleton({ rows: 4 })}</div>`;
  wireCrumb(host);

  /* The unit's engine row. The function, not the view, for the same reason
     Inventory uses it: it is the read path that carries the engine's rules. */
  let r;
  try {
    const all = await db('rpc/sentinel_inventory_actions');
    r = (Array.isArray(all) ? all : []).find(x => str(x.id) === unitId) || null;
  } catch (e) {
    host.innerHTML = `<div class="nx-stitch flex flex-col gap-space-md">${crumb({ id: unitId })}${errorState({ what: 'this vehicle', err: e, retry: 'v360' })}</div>`;
    host.querySelector('[data-retry]')?.addEventListener('click', () => go('vehicle360'));
    wireCrumb(host);
    return;
  }
  if (!r) {
    UNIT_ID = null;
    await picker(host, `Stock number ${unitId} is not on the lot the engine returned — it may have been deleted or renamed. Pick a unit below.`);
    return;
  }

  /* Three side reads, settled separately: a failed one is reported on its own
     tab and never empties the others. ai_recommendation is read for the same
     reason Inventory reads it — the Edit form writes it back, and saving a row
     that never carried it would blank the pricing workflow's note. */
  const model = str(r.model);
  const [recR, actR, leadR] = await Promise.allSettled([
    db(`inventory?select=id,ai_recommendation&id=eq.${encodeURIComponent(unitId)}&limit=1`),
    db(`v_inventory_action_queue?select=id,recommendation,status,engine_reason,engine_impact_aed,engine_impact_kind,proposed_at,proposed_by_name,decided_at,decided_by_name,decision_reason_label,decision_note,executed_at,executed_by_name,outcome_state,outcome_sentence,outcome_sale_vehicle,outcome_sale_amount_aed,outcome_sale_date,created_at&unit_id=eq.${encodeURIComponent(unitId)}&order=created_at.desc&limit=100`),
    model
      ? db(`leads?select=id,name,status,vehicle_interest,source,created_at&vehicle_interest=ilike.${encodeURIComponent(`*${model}*`)}&order=created_at.desc&limit=50`)
      : Promise.resolve([]),
  ]);
  const recErr = recR.status === 'rejected' ? recR.reason : null;
  const unit = { ...r, ai_recommendation: recErr ? undefined : ((recR.value || [])[0] || {}).ai_recommendation };
  const actions = actR.status === 'fulfilled' && Array.isArray(actR.value) ? actR.value : null;
  const leads = leadR.status === 'fulfilled' && Array.isArray(leadR.value) ? leadR.value : null;

  const mayCost = canSetCost(r.tenant_id);
  const canEdit = !recErr && canEditUnit(r.tenant_id);
  const d = n0(r.days_in_stock);
  const band = up(r.aging_band);
  const holdState = up(r.holding_cost_state);
  const marketUnknown = !str(r.market_position) || up(r.market_position).startsWith('UNKNOWN');
  const demandUnknown = up(r.demand_signal).startsWith('UNKNOWN');
  const exposed = up(r.impact_kind) === 'MARGIN_EXPOSED' && n0(r.impact_aed) != null;
  const repricing = (actions || []).filter(a => up(a.recommendation) === 'REPRICE');

  const DAYS_CHIP = {
    CRITICAL: 'inline-flex items-center gap-1 font-label-numeric-sm text-label-numeric-sm font-semibold px-2 py-0.5 rounded bg-error-container text-on-error-container',
    WARNING: 'inline-flex items-center gap-1 font-label-numeric-sm text-label-numeric-sm font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-900',
    OTHER: 'inline-flex items-center gap-1 font-label-numeric-sm text-label-numeric-sm font-semibold px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant',
  };

  const tabBadge = {
    pricing: actions ? `${num(repricing.length)} ${plural(repricing.length, 'DECISION', 'DECISIONS')}` : '',
    leads: leads ? `${num(leads.length)} ${plural(leads.length, 'LEAD', 'LEADS')}` : '',
    deals: actions ? `${num(actions.length)} ${plural(actions.length, 'ACTION', 'ACTIONS')}` : '',
  };

  const header = `<div class="${PANEL}">
    <div class="flex flex-col 2xl:flex-row items-start 2xl:items-center justify-between gap-space-lg">
      <div class="flex flex-col sm:flex-row items-start sm:items-center gap-space-md flex-1 min-w-0">
        <div class="w-36 h-28 sm:w-44 sm:h-32 rounded-lg bg-surface-container-high flex-shrink-0 flex flex-col items-center justify-center text-outline gap-1">
          <span class="material-symbols-outlined text-[36px]">directions_car</span><span class="font-label-numeric-sm text-[10px]">No photo on record</span>
        </div>
        <div class="flex flex-col gap-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            ${statusChip('partial', 'Partial dossier')}
            <span class="${DAYS_CHIP[band] || DAYS_CHIP.OTHER}"><span class="material-symbols-outlined text-[14px]">timer</span>${d == null ? 'NO ACQUISITION DATE' : `${num(d)} DAYS IN STOCK`}</span>
            ${str(r.status) ? `<span class="${CHIP}">${esc(str(r.status))}</span>` : ''}
            ${band ? pill(band, tone(band), { verbatim: true }) : ''}
          </div>
          <h1 class="font-headline-lg text-headline-lg text-on-surface tracking-tight mt-1">${esc(model || 'Unnamed unit')}</h1>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 font-label-numeric-sm text-label-numeric-sm text-outline mt-1">
            <span class="inline-flex items-center gap-1 whitespace-nowrap"><span class="text-on-surface-variant font-medium">STOCK:</span><span class="text-on-surface font-semibold select-all">${esc(str(r.id))}</span></span>
            <span>•</span>
            <span class="inline-flex items-center gap-1 whitespace-nowrap"><span class="text-on-surface-variant font-medium">VIN:</span>
              ${str(r.vin) ? `<span class="text-on-surface font-semibold select-all">${esc(str(r.vin))}</span>
              <button type="button" class="text-primary hover:text-primary-container" data-copy-vin title="Copy VIN"><span class="material-symbols-outlined text-[14px]">content_copy</span></button>` : '<span>not on record</span>'}</span>
            <span>•</span>
            <span class="inline-flex items-center gap-1 whitespace-nowrap"><span class="text-on-surface-variant font-medium">ACQUIRED:</span><span class="text-on-surface font-semibold">${r.acquired_at ? esc(dubaiDate(r.acquired_at)) : 'not on record'}</span></span>
          </div>
        </div>
      </div>
      <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-space-md w-full 2xl:w-auto flex-shrink-0">
        <div class="flex flex-col justify-center px-space-md py-space-sm rounded-lg bg-surface-container-low min-w-[200px]">
          <span class="${EYEBROW}">Current list price</span>
          <div class="font-headline-lg text-headline-lg text-primary font-bold tracking-tight mt-0.5">${aed(r.price_aed)}</div>
          <span class="text-[11px] font-label-numeric-sm text-outline mt-1">${marketUnknown ? 'Market position unknown — no verified comparable' : `Market: ${esc(str(r.market_position))}`}</span>
        </div>
        <div class="flex flex-col justify-center px-space-md py-space-sm rounded-lg bg-surface-container-low min-w-[190px]">
          <span class="${EYEBROW}">Holding accrual</span>
          <div class="font-label-numeric-lg text-label-numeric-lg font-bold mt-0.5">${stateFigure(holdState, r.holding_cost_accrued_aed, holdState === 'NOT_COMPUTABLE' ? 'No holding rate on record.' : '')}</div>
          <span class="text-[11px] font-label-numeric-sm text-outline mt-1">${n0(r.days_to_critical) == null ? 'No day count' : n0(r.days_to_critical) === 0 ? 'Past the critical threshold' : `${num(r.days_to_critical)} days to critical`}</span>
        </div>
        <div class="flex flex-wrap sm:flex-col gap-2 justify-center">
          <button type="button" id="vEdit" class="${BTN.primary}"${canEdit ? '' : ` disabled title="${esc(recErr
            ? 'inventory.ai_recommendation did not load, so saving from here would blank it. Reload before editing.'
            : 'Changing a vehicle is an owner, admin or manager decision at this dealership.')}"`}><span class="material-symbols-outlined text-[16px]">tune</span>Edit unit</button>
          <button type="button" id="vComp" class="${BTN.secondary}"><span class="material-symbols-outlined text-[16px]">radar</span>Competitors</button>
        </div>
      </div>
    </div>
  </div>`;

  const tabsHtml = () => `<div class="bg-surface-container-lowest rounded-xl px-space-md border border-outline-variant/40">
    <div class="flex items-center gap-1 overflow-x-auto py-1" role="tablist">
      ${TABS.map(t => `<button type="button" role="tab" data-tab="${t.key}" aria-selected="${t.key === TAB}" class="${t.key === TAB ? TAB_CLS.on : t.planned ? TAB_CLS.planned : TAB_CLS.off}">
        <span class="material-symbols-outlined text-[16px]">${t.icon}</span>${esc(t.label)}
        ${t.key === 'cost' && !mayCost ? `<span class="${TAB_BADGE.plain}">RESTRICTED</span>` : ''}
        ${t.planned ? `<span class="${TAB_BADGE.planned}">◇ PLANNED</span>` : ''}
        ${tabBadge[t.key] ? `<span class="${TAB_BADGE.plain}">${esc(tabBadge[t.key])}</span>` : ''}
      </button>`).join('')}
    </div></div>`;

  /* ── Panels ──────────────────────────────────────────────────────────── */
  const panels = {
    specs: () => `<div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
      <div class="lg:col-span-8 ${PANEL}">
        <div><span class="${EYEBROW}">What inventory holds for this unit</span><h2 class="${H2}">Specification & dossier</h2></div>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
          ${fact('Stock number', esc(str(r.id)))}
          ${fact('Model', esc(model || 'Unnamed unit'))}
          ${fact('VIN', str(r.vin) ? `<span class="font-label-numeric-sm">${esc(str(r.vin))}</span>` : '<span class="text-outline">Not on record</span>')}
          ${fact('Status', esc(str(r.status) || 'Not on record'))}
          ${fact('Acquired', r.acquired_at ? esc(dubaiDate(r.acquired_at)) : '<span class="text-outline">Not on record</span>', d == null ? 'no day count' : `${num(d)} days on the lot`)}
          ${fact('Age band', band ? pill(band, tone(band), { verbatim: true }) : '<span class="text-outline">Not banded</span>', `warning ${num(r.warn_days)} · critical ${num(r.crit_days)} days`)}
        </div>
        <p class="${NOTE}">Powertrain, odometer, colour, trim, options and photos are not recorded anywhere in NEXUS — inventory holds the stock number, model, VIN, status, acquisition date and the two prices. They are left out rather than filled from the model name.</p>
        <div class="bg-surface-container-low p-space-md rounded-xl flex flex-col gap-2">
          <div class="flex items-center gap-2 flex-wrap"><span class="${EYEBROW}">Sentinel verdict</span>
            ${up(r.recommendation) ? pill(up(r.recommendation), recTone(r.recommendation), { verbatim: true }) : ''}
            ${up(r.overall_risk) ? pill(up(r.overall_risk), riskTone(r.overall_risk), { verbatim: true }) : ''}
            ${r.human_approval_required === true ? pill('approval required', 'warm', { verbatim: false }) : ''}</div>
          <p class="font-body-sm text-body-sm text-on-surface">${esc(str(r.reason) || 'The engine gave no reason for this unit.')}</p>
          <p class="${NOTE}">${esc(str(r.confidence_basis))}</p>
        </div>
      </div>
      <div class="lg:col-span-4 flex flex-col gap-space-lg">
        ${comingSoonPanel({ kind: 'coming-soon', icon: 'badge', title: 'Mulkiya, registration & keys',
          body: 'Registration card, plate, insurance and key status are not recorded. They appear here when a DMS or registration source is connected.',
          prerequisite: 'Needs your DMS connected' })}
        <div class="${PANEL}">
          <span class="${EYEBROW}">Pricing workflow note</span>
          <p class="p-2.5 rounded bg-surface-container-low font-body-sm text-body-sm text-on-surface italic">${recErr
            ? 'inventory.ai_recommendation could not be read, so whether the pricing workflow has written anything for this unit is unknown here.'
            : esc(str(unit.ai_recommendation) || 'No recommendation has been written for this unit by the pricing workflow.')}</p>
        </div>
      </div>
    </div>`,

    /* Restricted. canSetCost answers TRUE when the membership read itself
       failed (unknown is not "no"), and the view is security_invoker either
       way — this panel decides only what the product puts in front of a
       salesperson, not what the database lets them read. */
    cost: () => (!mayCost
      ? `<div class="${PANEL}">
          <div class="flex items-center gap-2 flex-wrap"><span class="${EYEBROW}">Restricted</span>${statusChip('restricted', 'Owner or admin only')}</div>
          <h2 class="${H2}">Acquisition & cost</h2>
          <p class="${NOTE}">What this vehicle cost, the capital tied up in it, its holding cost and its net margin are shown to the dealership's owner and admins — the same people who may set a cost. Your account (${esc(myRole() || 'role unknown')}) sees the list price and the Sentinel's verdict on the other tabs.</p>
        </div>`
      : `<div class="${PANEL}">
          <div class="flex items-center justify-between gap-2 flex-wrap"><div><span class="${EYEBROW}">Restricted · owner and admin</span><h2 class="${H2}">Acquisition & cost ledger</h2></div>${statusChip('restricted', 'Restricted')}</div>
          <div class="grid grid-cols-2 lg:grid-cols-3 gap-3">
            ${fact('Acquisition cost', aed(r.cost_aed))}
            ${fact('List price', aed(r.price_aed))}
            ${fact('Capital tied up', aed(r.capital_tied_aed))}
            ${fact('Gross margin', `<span class="${n0(r.gross_margin_aed) != null && n0(r.gross_margin_aed) < 0 ? 'text-red-700' : ''}">${aed(r.gross_margin_aed)}</span>`, str(r.gross_margin_pct) ? `${esc(str(r.gross_margin_pct))}% of list` : '')}
            ${fact('Holding cost accrued', stateFigure(r.holding_cost_state, r.holding_cost_accrued_aed, r.holding_cost_note))}
            ${fact('Net margin', stateFigure(r.net_margin_state, r.net_margin_aed, r.net_margin_note))}
          </div>
          <p class="${NOTE}">${n0(r.holding_cost_per_day_aed) == null
            ? 'No holding rate is on record for this dealership, so holding cost and net margin are not computable — not zero. Record what a day of floor costs, with a source, and both become figures.'
            : `Holding rate ${aed(r.holding_cost_per_day_aed)} a day, ${esc(str(r.holding_cost_basis) || 'basis not stated')}${str(r.holding_cost_source) ? ` — source: ${esc(str(r.holding_cost_source))}` : ''}.`}
            Reconditioning cost is not recorded anywhere, so it is not in any figure above.</p>
        </div>`),

    pricing: () => `<div class="${PANEL}">
      <div><span class="${EYEBROW}">Repositioning log</span><h2 class="${H2}">Pricing history</h2></div>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
        ${fact('Current list price', aed(r.price_aed))}
        ${fact('Days on the lot', d == null ? '<span class="text-outline">Undated</span>' : num(d))}
        ${fact('Engine recommendation', up(r.recommendation) ? pill(up(r.recommendation), recTone(r.recommendation), { verbatim: true }) : '<span class="text-outline">None</span>')}
      </div>
      <p class="${NOTE}">NEXUS stores the current list price only — there is no price-change log, so a stepped price chart cannot be drawn without inventing its steps. What is recorded is every repricing decision taken on this unit, below.</p>
      ${actions == null
        ? errorState({ what: 'the repricing decisions', err: actR.reason })
        : table([
          { label: 'Proposed', render: a => esc(dubaiStamp(a.proposed_at || a.created_at)) },
          { label: 'Status', render: a => pill(up(a.status) || 'UNSTATED', tone(a.status), { verbatim: true }) },
          { label: 'Decided by', render: a => (str(a.decided_by_name) ? esc(str(a.decided_by_name)) : '<span class="text-outline">Not decided</span>') },
          { label: 'Reason', render: a => esc(str(a.decision_reason_label) || str(a.engine_reason)) },
        ], repricing, { empty: emptyState({ icon: 'show_chart', title: 'No repricing decision on record', body: 'The engine has not put a REPRICE action on this unit, or none was recorded.' }) })}
    </div>`,

    market: () => `<div class="${PANEL}">
      <div class="flex items-center justify-between gap-2 flex-wrap"><div><span class="${EYEBROW}">Competitive benchmark</span><h2 class="${H2}">Market benchmark</h2></div>
        ${str(r.market_position) ? pill(up(r.market_position), marketUnknown ? 'unknown' : tone(r.market_position), { verbatim: true }) : statusChip('not-tested', 'Not stated')}</div>
      ${str(r.market_competitor) ? `<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${fact('Competitor', esc(str(r.market_competitor)))}
        ${fact('Their price', aed(r.market_price_aed))}
        ${fact('Match quality', str(r.market_match_quality) ? esc(str(r.market_match_quality)) : '<span class="text-outline">Not recorded</span>')}
        ${fact('Scraped', esc(dubaiStamp(r.market_scraped_at)))}
      </div>` : ''}
      <p class="${NOTE}">${esc(str(r.market_note) || 'The engine wrote no market note for this unit.')}</p>
      ${marketUnknown ? emptyState({ icon: 'leaderboard', title: 'No distribution to draw',
        body: 'A decile strip needs verified comparables for this exact model. The engine holds none it will stand behind, so no percentile and no median are shown.' }) : ''}
      <div><button type="button" class="${BTN.secondary}" data-go-comp><span class="material-symbols-outlined text-[16px]">radar</span>Open Competitors</button></div>
    </div>`,

    leads: () => `<div class="${PANEL}">
      <div class="flex items-center justify-between gap-2 flex-wrap"><div><span class="${EYEBROW}">Matched buyer demand</span><h2 class="${H2}">Matched demand</h2></div>
        ${str(r.demand_signal) ? pill(up(r.demand_signal), demandUnknown ? 'unknown' : 'cold', { verbatim: true }) : ''}</div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${fact(`Enquiries · ${num(r.enquiry_window_days)} days`, num(r.enquiries_in_window), 'the engine\'s count')}
        ${fact('From leads · messages', `${num(r.enquiry_leads)} · ${num(r.enquiry_messages)}`)}
        ${fact('Last enquiry', r.enquiry_last_at ? esc(ago(r.enquiry_last_at)) : '<span class="text-outline">None in the window</span>')}
        ${fact('Coverage', esc(str(r.enquiry_coverage) || 'not stated'))}
      </div>
      <p class="${NOTE}">${esc(str(r.enquiry_note))}</p>
      <div class="flex flex-col gap-1"><span class="${EYEBROW}">Leads whose stated interest contains “${esc(model || '—')}”</span>
        <p class="${NOTE}">A text match on what the customer typed, not a confirmed link to this car — the engine's count above uses stricter rules, and the two may differ.</p></div>
      ${leads == null
        ? errorState({ what: 'the matching leads', err: leadR.reason })
        : table([
          { label: 'Lead', strong: true, render: l => esc(displayName(l.name, l.id) || `Lead ${l.id}`) },
          { label: 'Status', render: l => (str(l.status) ? pill(up(l.status), tone(l.status), { verbatim: true }) : '<span class="text-outline">No status</span>') },
          { label: 'Stated interest', render: l => esc(str(l.vehicle_interest)) },
          { label: 'Source', render: l => esc(str(l.source) || '—') },
          { label: 'Arrived', render: l => esc(ago(l.created_at)) },
        ], leads, { empty: emptyState({ icon: 'person_search', title: 'No lead names this model', body: 'No lead\'s stated interest contains this model\'s name as it is written in inventory. That is a statement about the text, not proof nobody wants the car.' }) })}
    </div>`,

    deals: () => `<div class="${PANEL}">
      <div><span class="${EYEBROW}">Desk log</span><h2 class="${H2}">Desk log & deals</h2></div>
      <p class="${NOTE}">Every action the Sentinel proposed on this unit, who decided it and what came of it. A closed deal is linked here only when an action's outcome was tied to a recorded sale; purchase_history itself carries no stock number, so a sale recorded without that tie cannot be placed on this car.</p>
      ${actions == null
        ? errorState({ what: 'the desk log', err: actR.reason })
        : table([
          { label: 'Raised', render: a => esc(dubaiStamp(a.proposed_at || a.created_at)) },
          { label: 'Action', render: a => (up(a.recommendation) ? pill(up(a.recommendation), recTone(a.recommendation), { verbatim: true }) : '—') },
          { label: 'Status', render: a => pill(up(a.status) || 'UNSTATED', tone(a.status), { verbatim: true }) },
          { label: 'Decided by', render: a => (str(a.decided_by_name) ? `${esc(str(a.decided_by_name))}<div class="text-[11px] text-outline">${esc(dubaiStamp(a.decided_at))}</div>` : '<span class="text-outline">Not decided</span>') },
          { label: 'Outcome', render: a => (str(a.outcome_sentence) ? esc(str(a.outcome_sentence)) : str(a.outcome_state) ? esc(str(a.outcome_state)) : '<span class="text-outline">No outcome recorded</span>') },
          { label: 'Sale tied', align: 'r', render: a => (n0(a.outcome_sale_amount_aed) == null ? '<span class="text-outline">—</span>' : `${aed(a.outcome_sale_amount_aed)}<div class="text-[11px] text-outline">${esc(dubaiDate(a.outcome_sale_date))}</div>`) },
        ], actions, { empty: emptyState({ icon: 'contract', title: 'No desk activity on this unit', body: 'The Sentinel has not raised an action on this unit, and no sale has been tied to it.' }) })}
    </div>`,

    recon: () => comingSoonPanel({ kind: 'planned', icon: 'build', title: 'Repairs, workshop orders & reconditioning',
      body: 'Repair orders, recon jobs and their cost will show here. NEXUS has no repair-order table and no recon-cost column today, so there is nothing to list and no cost is assumed.',
      prerequisite: 'Needs your DMS or workshop system connected' }),

    forecast: () => comingSoonPanel({ kind: 'planned', icon: 'bolt', title: 'Predicted days-to-sell',
      body: 'A forecast of how long this unit will take to sell. No model has been trained or tested on this dealership\'s sales, so no prediction is made — a guessed number of days would read as a fact.',
      prerequisite: 'Needs a sales history long enough to test a model against' }),
  };

  const recoveryBar = exposed
    ? `<div class="rounded-lg border border-amber-200 bg-amber-50/60 px-space-md py-space-sm flex flex-wrap items-center justify-between gap-space-sm">
        <div class="flex items-center gap-2 font-body-sm text-body-sm text-amber-950"><span class="material-symbols-outlined text-[18px]">warning</span>
          <span><strong class="font-semibold">Margin exposed: ${aed(r.impact_aed)}.</strong> ${esc(str(r.impact_basis))}</span></div>
        <span class="font-label-numeric-sm text-label-numeric-sm text-amber-900">Exposed: the amount at risk — not lost, not revenue, not recovered</span>
      </div>`
    : '';

  const paint = () => {
    const root = el('div', 'nx-stitch flex flex-col gap-space-md');
    root.innerHTML = `${crumb(r)}${header}${tabsHtml()}<div data-panel>${panels[TAB] ? panels[TAB]() : panels.specs()}</div>${recoveryBar}
      ${trustFooter({
        source: 'sentinel_inventory_actions() · v_inventory_action_queue · leads',
        asOf: dubaiStamp(r.computed_at),
        evidence: `unit ${str(r.id)} · ${actions ? `${num(actions.length)} ${plural(actions.length, 'action', 'actions')}` : 'desk log unread'} · ${leads ? `${num(leads.length)} text-matched ${plural(leads.length, 'lead', 'leads')}` : 'leads unread'}`,
        actor: myRole() || '—',
      })}`;
    host.innerHTML = '';
    host.appendChild(root);
    wireCrumb(root);
    root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { TAB = b.dataset.tab; paint(); }));
    root.querySelector('[data-copy-vin]')?.addEventListener('click', () => { navigator.clipboard?.writeText(str(r.vin)).catch(() => {}); });
    $('vComp')?.addEventListener('click', () => go('competitors'));
    root.querySelector('[data-go-comp]')?.addEventListener('click', () => go('competitors'));
    $('vEdit')?.addEventListener('click', () => {
      if (!canEdit) return;
      unitForm(unit, [unit], () => go('vehicle360'));
    });
  };
  paint();
};

export { openVehicle360 };
