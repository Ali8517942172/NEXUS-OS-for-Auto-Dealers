/* NEXUS OS — screens/inventory.js · Inventory Profit Sentinel

   Rebuilt 2 September 2026. The commercial role of this screen, from
   PRODUCT.md, is Profit Sentinel: an owner must be able to answer, in five
   seconds, WHICH OF MY CARS IS COSTING ME MONEY, WHY, AND WHAT DO I DO.

   ── The engine is the source of truth, and this file computes nothing ──────

   Everything on this screen comes out of `public.v_inventory_profit_sentinel`,
   read through `public.sentinel_inventory_actions(p_recommendation,
   p_min_risk_rank)` — the intended read path, which orders worst-first and
   carries one rule this browser must not reimplement: a unit whose risk is
   UNKNOWN is never removed by a minimum-risk floor, because unknown is not low.
   Passing the filter to the function is what keeps that rule in one place.

   The view is `security_invoker`, so a dealership sees only its own lot, and
   its own comment states the contract this file is written against: "Unknown
   inputs produce explicit UNKNOWN / NOT_COMPUTABLE states with a note naming
   the missing input — never a zero and never an average."

   So there is no arithmetic on money in this file. Not one figure in a cell is
   multiplied, divided or netted here. The only sums are the three summary
   tiles, and each of them adds a column the engine already produced and then
   says how many units it could not include. Where a figure is an engine state
   rather than a number — NOT_COMPUTABLE, PLACEHOLDER, UNKNOWN_* — the state and
   the engine's own note are rendered, never an em dash: an em dash in a money
   row reads as nothing owed.

   ── What this screen used to do, and why it was the P0 ────────────────────

   Until today this file rendered `lib/unit-form.js deriveUnit()`, which
   multiplied each unit's day count by a hardcoded `INV.HOLDING_PER_DAY = 50`
   and spread the product over whatever `inventory.holding_cost_accrued`
   actually held. Nobody at this dealership had ever quoted 50. The screen
   printed AED 7,450 of holding cost against NX-1010 (149 days), AED 33,850
   across the twelve units in the "Holding cost accrued" tile, subtracted it
   from gross margin to make a "Net margin" column, and took 5% of that as a
   recommended commission — four columns and a KPI, all of them downstream of a
   number with no source.

   Lane A removed that assertion from the database on 2 Sep 2026:
   `holding_cost_accrued` and `net_margin` are NULL on all twelve `inventory`
   rows, and `inventory_profit_settings.holding_cost_per_day_aed` is NULL with a
   column comment that names this file's constant as one of the two things it
   deliberately was NOT seeded from. So the browser was reinstating, in front of
   the operator, the exact figure the database had just retracted.

   The rate is data now. Where it is absent the engine says NOT_COMPUTABLE and
   hands over the inputs instead — capital tied up, days on the lot — and that
   is what this screen shows. Where a rate exists but is recorded as a
   PLACEHOLDER rather than DEALERSHIP_SUPPLIED, every figure derived from it is
   marked as an assumption ON THE FIGURE, not in a footnote under it.

   ── What today's data actually looks like, so nothing here is designed for a
      busier fiction ────────────────────────────────────────────────────────

   Read live from the engine on 2 Sep 2026, computed_at 17:32 UTC:

     · 12 units. Bands: 1 CRITICAL, 2 WARNING, 9 HEALTHY. Oldest 149 days.
     · Recommendations: 3 REPRICE, 9 HOLD. Overall risk: 1 SEVERE, 2 HIGH,
       9 LOW. Nine healthy cars must not be made to look alarming.
     · Margin exposed on the three units carrying an action: AED 82,000
       (43,000 + 16,000 + 23,000). `impact_kind` is MARGIN_EXPOSED, and
       `impact_basis` spells out what that is not: "not expected loss, not
       attributed revenue and not recovered revenue". The word on this screen is
       EXPOSED, everywhere, for that reason.
     · Capital tied up: AED 2,667,000 across 12 of 12 units.
     · holding_cost_state is NOT_COMPUTABLE on 12 of 12, and so is
       net_margin_state.
     · market_position is UNKNOWN on all twelve — 7 UNKNOWN_NO_COMPARABLE and
       5 UNKNOWN_UNVERIFIED_COMPARABLE. The five have a real scraped competitor
       row behind them (toyota.ae and drivearabia.com); the engine attaches it
       as EVIDENCE and refuses to derive a position from it. Those rows are
       shown here for the same reason and with the same refusal.
     · demand_signal is UNKNOWN_LOW_COVERAGE on all twelve: 86 enquiry rows in
       30 days resolve to a unit only twice, under the floor of 50, so an
       enquiry count of 0 is a statement about our records and cannot move a
       recommendation. Shown, with that sentence, rather than hidden.
     · confidence is MEDIUM on all twelve and `confidence_basis` says why per
       unit — no verified market comparable, and enquiry coverage below the
       floor. Surfaced on every row's detail, not buried.
     · suggested_owner_state is ROLE_ONLY: there is one staff member and no
       manager, and NEXUS holds no role directory, so the engine names a ROLE
       and refuses to name a person. This screen prints no name.

   ── What this file deliberately does NOT read ─────────────────────────────

   `inventory.aging_alert`, `days_in_stock`, `holding_cost_accrued`,
   `net_margin`, `vat_amount` and `recommended_commission` — the stored derived
   columns — are not read here at all. The engine recomputes the first two from
   `acquired_at` against this dealership's own thresholds and states the rest
   explicitly. Reading both and reconciling them was most of the old file, and
   it existed only because the browser was a second writer of the same figures.
   It is not one any more.

   One base-table column IS read, and only one: `inventory.ai_recommendation`,
   which the view does not carry. It is fetched separately because the Edit form
   writes that column back and would blank it if the row it was handed did not
   hold it. That read adds no derivation and is reported if it fails. */
import { canAddUnit, canEditUnit, db, myRole } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, dubaiDate, dubaiStamp, esc, n0, num, tone } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { readFlag, writeFlag } from '../lib/prefs.js';
import { closeDrawer, wireRows } from '../lib/ui.js';
import { BTN, comingSoonPanel, emptyState, errorState, sectionHeader, skeleton, statusChip, trustFooter } from '../lib/stitch-ui.js';
import { CHIP, kpi, openDeskDrawer, pill, SEG, segPaint, table } from '../lib/desk-kit.js';
import { holdingSettings, unitForm } from '../lib/unit-form.js';
import { openVehicle360 } from './vehicle-360.js';

const str = v => String(v == null ? '' : v).trim();
const up = v => str(v).toUpperCase();
const plural = (n, one, many) => (Number(n) === 1 ? one : many);

/* ── Reads ────────────────────────────────────────────────────────────────
   The function, not the view. It orders worst-first and it holds the
   "unknown is not low" rule that a client-side filter would quietly drop.
   PostgREST exposes a STABLE function over GET, which is what lib/data.js db()
   speaks; `authenticated` holds EXECUTE on it and `anon` does not. */
const RPC = 'rpc/sentinel_inventory_actions';
const REC_LIMIT = 1000;

function readSentinel(recommendation, minRiskRank) {
  const args = [];
  if (recommendation) args.push(`p_recommendation=${encodeURIComponent(recommendation)}`);
  if (minRiskRank != null) args.push(`p_min_risk_rank=${encodeURIComponent(minRiskRank)}`);
  return db(args.length ? `${RPC}?${args.join('&')}` : RPC);
}

/* ── Vocabulary the engine speaks, and the colours it does not ────────────
   lib/format.js TONE is the one severity table in this app and every screen
   takes its colours from it. Two of the engine's five risk words are not in it:
   SEVERE and ELEVATED. tone() answers 'unknown' for both — a legible grey chip
   that says "this dashboard has no wording for that status" — so SEVERE, the
   worst state the engine can return, would have been the only risk on the
   screen with no colour, sitting next to a red HIGH.

   The right fix is two rows in TONE. lib/format.js is not this lane's file
   today, so this map is the narrow alternative: it names all five words rather
   than only the two that are missing, because a map that silently delegates
   half its keys is a map nobody can check. It agrees with TONE on the three
   they share — HIGH 'hot', LOW 'cold', UNKNOWN 'unknown' — and that agreement
   is the thing to re-check if TONE ever gains SEVERE. */
const RISK_TONE = { SEVERE: 'hot', HIGH: 'hot', ELEVATED: 'warm', LOW: 'cold', UNKNOWN: 'unknown' };
const riskTone = v => RISK_TONE[up(v)] || tone(v) || 'unknown';

/* Rank → word, straight off the view's own CASE (read live 2 Sep 2026):
   3 SEVERE, 2 HIGH, 1 ELEVATED, 0 LOW, anything else UNKNOWN. Used only to
   label the risk-floor filter; every risk word rendered on a row comes off the
   row itself. */
const RANK_WORD = { 3: 'SEVERE', 2: 'HIGH', 1: 'ELEVATED', 0: 'LOW' };

/* A recommendation is not a severity, and colouring it like one is how nine
   healthy cars end up looking alarming. HOLD is the engine saying there is
   nothing to do, so it reads calm; the rest are graded by how much money the
   action puts at stake. The words are the engine's and are shown verbatim. */
const REC_TONE = {
  HOLD: 'ok',
  PROMOTE: 'cold',
  REPRICE: 'warm',
  INSPECT: 'warm',
  RECON: 'warm',
  TRANSFER: 'warm',
  MANAGER_REVIEW: 'hot',
  WHOLESALE: 'hot',
};
const recTone = v => REC_TONE[up(v)] || 'unknown';

/* The engine's impact vocabulary, kept as the engine's words. `impact_basis`
   opens with EXPOSURE and then says, in as many words, that this is not
   expected loss, not attributed revenue and not recovered revenue. Nothing on
   this screen may shorten that into "at risk revenue" or "recoverable". */
const IMPACT_WORD = {
  MARGIN_EXPOSED: 'Margin exposed',
  NONE: 'No impact claimed',
};
const impactWord = v => IMPACT_WORD[up(v)] || str(v) || 'Not stated';

/* ── Rendering a figure the engine would not state ────────────────────────
   Three states, three different sentences, and none of them is a blank.

     NOT_COMPUTABLE  the words, the engine's reason, and the inputs it would
                     have used. Never a number; never an em dash, because
                     aed(null) prints "—" and an em dash in a money row reads as
                     nothing owed.
     PLACEHOLDER     the number, with an "assumed" chip ON the figure. A caveat
                     underneath is a caveat nobody screenshots.
     COMPUTED        the number. */
function stateFigure(state, value, note, inputs) {
  const s = up(state);
  if (s === 'NOT_COMPUTABLE') {
    /* The reason is rendered, not hidden in a title. A hover is not an
       explanation on a screen somebody screenshots into a meeting. */
    const lines = [str(note), str(inputs)].filter(Boolean);
    return '<span class="text-amber-700 font-semibold">Not computable</span>'
      + (lines.length ? `<div class="font-body-sm text-body-sm text-on-surface-variant whitespace-normal">${lines.map(esc).join('<br>')}</div>` : '');
  }
  if (s === 'PLACEHOLDER') {
    return `${aed(value)} <span title="${esc(str(note)
      || 'Derived from a holding rate recorded as a PLACEHOLDER — a working assumption, not a figure this dealership has stood behind.')}">${pill('assumed', 'warm', { verbatim: false })}</span>`;
  }
  return aed(value);
}

/* The inputs the engine offers in place of a holding cost it will not invent.
   Both come straight off the row.

   Labelled "Inputs" rather than written as prose, because the engine's own
   NOT_COMPUTABLE note already names them in a sentence and two sentences saying
   the same thing read as a bug. A labelled pair under the note reads as the
   structured restatement it is — and it survives the engine rewording its note,
   which a cleverer de-duplication would not. */
const holdingInputs = r => `Inputs — ${aed(r.capital_tied_aed)} capital tied up`
  + (n0(r.days_in_stock) == null ? ' · no day count on record' : ` · ${num(r.days_in_stock)} days on the lot`);

/* gross_margin_pct arrives already rounded to two places by the engine, and the
   per-unit `reason` quotes it to two places too ("still carrying 10.89% gross
   margin"). pct() in lib/format.js re-rounds to one, which would put 10.9% in a
   column an inch above 10.89% in the same unit's reason. Printed as the engine
   wrote it, with no arithmetic. */
function marginPct(v) {
  const s = str(v);
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return '<span class="text-outline">—</span>';
  return `${esc(s)}%`;
}

/* Sums one engine column and reports what it could not include. Every summary
   tile that adds anything goes through this, because "AED 82,000" over three of
   twelve units is a different fact from "AED 82,000" over twelve, and the tile
   has to say which. */
function tally(rows, pick) {
  let total = 0, n = 0;
  const missing = [];
  for (const r of rows) {
    const v = n0(pick(r));
    if (v == null) missing.push(r); else { total += v; n += 1; }
  }
  return { total: n ? total : null, n, of: rows.length, missing };
}

const countBy = (rows, pick) => {
  const m = new Map();
  rows.forEach((r) => { const k = up(pick(r)) || 'UNSTATED'; m.set(k, (m.get(k) || 0) + 1); });
  return m;
};
const spread = (m, order) => [...m.entries()]
  .sort((a, b) => (order.indexOf(a[0]) < 0 ? 99 : order.indexOf(a[0])) - (order.indexOf(b[0]) < 0 ? 99 : order.indexOf(b[0])))
  .map(([k, v]) => `${num(v)} ${k.toLowerCase().replace(/_/g, ' ')}`).join(' · ');


/* ── The Stitch layout (7 Oct 2026) ───────────────────────────────────────
   design/stitch/inventory-assets-profit-sentinel--3fd9e5.html is the visual
   reference, with --a81092's KPI strip and unit inspector folded in. Every
   section of both exports is accounted for below; where an export draws a
   section NEXUS holds no data for, the section is rendered with the honest
   reason instead of the mock's numbers:

     cockpit sub-header ............ sectionHeader + the engine's computed_at
     KPI snapshot strip ............ the five engine tallies above + market position
     filter pills .................. the engine's own recommendation words
     saved views / grid-table ...... built-in presets, remembered per browser
                                     through lib/prefs.js (it stores switches,
                                     not free text, so "Save view" remembers a
                                     preset rather than inventing a named one)
     search omnibar ................ text search + the engine's risk floor + sort
     export CSV .................... the rows on screen, engine columns verbatim
     makes / GCC spec selects ...... NOT drawn: inventory has no make and no
                                     spec column, so a filter on them would
                                     filter on nothing
     unit card photo ............... "No photo on record" — NEXUS stores none
     open repair orders ............ COMING SOON, needs a DMS integration
     unit drawer ................... engine verdicts, demand, evidence, plus the
                                     Vehicle 360 hand-off
     AED / USD toggle .............. NOT drawn: no exchange rate is on record */

/* Built-in saved views. Each is a filter the ENGINE applies (recommendation
   and risk floor go to sentinel_inventory_actions) or a filter on a column the
   engine produced — never a verdict worked out here. */
const VIEWS = [
  { key: 'all',      label: 'All active stock',     rec: '', risk: '', pick: null },
  { key: 'decision', label: 'Needs a decision',     rec: '', risk: '', pick: r => up(r.suggested_owner_state) !== 'NO_ACTION' },
  { key: 'critical', label: 'Past critical age',    rec: '', risk: '', pick: r => up(r.aging_band) === 'CRITICAL' },
  { key: 'high',     label: 'HIGH risk and worse',  rec: '', risk: '2', pick: null },
];
const VIEW_FLAG = key => `nexus.inventory.view.${key}`;
const LAYOUT_FLAG = 'nexus.inventory.table';

const SORTS = [
  { key: 'engine', label: 'Engine order (worst first)' },
  { key: 'days',   label: 'Days on lot (high → low)' },
  { key: 'price',  label: 'List price (high → low)' },
];
const sorters = {
  engine: null,
  /* An undated unit has no day count; it sorts last, not as zero days. */
  days: (a, b) => (n0(b.days_in_stock) ?? -1) - (n0(a.days_in_stock) ?? -1),
  price: (a, b) => (n0(b.price_aed) ?? -1) - (n0(a.price_aed) ?? -1),
};

/* The age banner on each unit card. Three bands the engine emits, plus the
   undated case, each a complete class string. */
const BAND_STRIP = {
  CRITICAL: 'px-space-md py-1.5 bg-error-container text-on-error-container flex items-center justify-between gap-2 font-label-numeric-sm text-label-numeric-sm',
  WARNING:  'px-space-md py-1.5 bg-amber-50 text-amber-900 flex items-center justify-between gap-2 font-label-numeric-sm text-label-numeric-sm',
  HEALTHY:  'px-space-md py-1.5 bg-surface-container-low text-on-surface-variant flex items-center justify-between gap-2 font-label-numeric-sm text-label-numeric-sm',
  NONE:     'px-space-md py-1.5 bg-surface-container text-outline flex items-center justify-between gap-2 font-label-numeric-sm text-label-numeric-sm',
};
const BAND_DAYS = {
  CRITICAL: 'px-1.5 py-0.5 rounded bg-error text-on-error uppercase font-bold tracking-wider',
  WARNING:  'px-1.5 py-0.5 rounded bg-amber-600 text-white uppercase font-bold tracking-wider',
  HEALTHY:  'px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface uppercase font-bold tracking-wider',
  NONE:     'px-1.5 py-0.5 rounded bg-surface-container-highest text-outline uppercase font-bold tracking-wider',
};
const BAND_ICON = { CRITICAL: 'fmd_bad', WARNING: 'schedule', HEALTHY: 'check_circle', NONE: 'event_busy' };
const BAND_WORD = {
  CRITICAL: 'PAST THE CRITICAL THRESHOLD', WARNING: 'PAST THE WARNING THRESHOLD',
  HEALTHY: 'WITHIN AGE THRESHOLDS', NONE: 'NO ACQUISITION DATE — NOT BANDED',
};
const bandOf = r => (BAND_STRIP[up(r.aging_band)] ? up(r.aging_band) : 'NONE');

const csvCell = v => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const CSV_COLS = ['id', 'vin', 'model', 'status', 'days_in_stock', 'aging_band', 'price_aed', 'cost_aed',
  'gross_margin_aed', 'gross_margin_pct', 'market_position', 'demand_signal', 'overall_risk', 'recommendation',
  'reason', 'holding_cost_state', 'net_margin_state', 'confidence', 'computed_at'];

SCREENS.inventory = async (host) => {
  const root = el('div', 'nx-stitch flex flex-col gap-space-md');
  host.appendChild(root);
  const reload = () => go('inventory');

  const headHost = el('div'); root.appendChild(headHost);
  const strip = el('div', 'grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-space-md'); root.appendChild(strip);
  const provHost = el('div'); root.appendChild(provHost);
  const body = el('div', 'flex flex-col gap-space-md'); root.appendChild(body);
  const footHost = el('div'); root.appendChild(footHost);

  const head = (sub, actionsHtml = '') => sectionHeader({
    eyebrow: 'Assets', title: 'Inventory — Assets & Profit Sentinel', sub, actionsHtml,
  });
  const addBtn = canAddUnit()
    ? `<button type="button" class="${BTN.primary}" id="invAdd"><span class="material-symbols-outlined text-[18px]">add</span>Add vehicle</button>`
    : '';
  headHost.innerHTML = head('Which of your cars is costing you money, why, and what to do.');
  strip.innerHTML = skeleton({ rows: 2 });
  body.innerHTML = skeleton({ rows: 4 });

  /* The unfiltered engine output. Every summary figure describes THIS set — the
     whole lot — and never the filtered view below it, so a filter can never
     shrink a total while the total still reads as the dealership's. */
  let all;
  try {
    all = await readSentinel();
  } catch (e) {
    strip.remove(); provHost.remove();
    body.innerHTML = `${errorState({ what: 'the Inventory Profit Sentinel', err: e, retry: 'sentinel' })}
      <p class="font-body-sm text-body-sm text-on-surface-variant">Nothing on this screen is derived in the browser, so with the engine unreadable there is no partial view to fall back to. That is deliberate: a lot summary assembled from whatever happened to load is the failure this screen was rebuilt to end.</p>`;
    body.querySelector('[data-retry]')?.addEventListener('click', reload);
    return;
  }
  if (!Array.isArray(all)) all = [];

  /* ai_recommendation is the one column the view does not carry and the Edit
     form does write. It is fetched separately and merged, and if that read
     fails the Edit button is DISABLED rather than degraded: unitRow() sends
     `ai_recommendation: u.ai_recommendation || null`, so saving a row that
     never carried the column would silently overwrite the pricing workflow's
     note with NULL. A disabled button that says why beats a save that destroys
     a column the operator could not see. */
  let recErr = null;
  const recRows = await db(`inventory?select=id,ai_recommendation&limit=${REC_LIMIT}`)
    .catch((e) => { recErr = e.message; return null; });
  const recById = new Map((recRows || []).map(r => [String(r.id), r.ai_recommendation]));
  /* Applied to EVERY engine result, not only the first one. A filtered read
     comes back from the same function without this column, and a row missing it
     that reached unitForm() would have written NULL over the pricing workflow's
     note on save. */
  const withRec = list => (list || []).map(r => (recById.has(String(r.id))
    ? { ...r, ai_recommendation: recById.get(String(r.id)) }
    : r));
  const rows = withRec(all);
  const readAt = new Date().toISOString();

  /* Only reached when the engine returned nothing at all — with units on the
     lot every setting below comes off the rows themselves. */
  const fallbackSettings = rows.length ? null : await holdingSettings();

  if (!rows.length) {
    strip.remove(); provHost.remove();
    headHost.innerHTML = head('The Sentinel reads one row per unit in inventory.', addBtn);
    const why = fallbackSettings && fallbackSettings.state === 'UNREADABLE'
      ? ` The configuration row could not be read either, so this screen cannot even say whether a holding rate is on record: ${str(fallbackSettings.why)}`
      : '';
    body.innerHTML = emptyState({ icon: 'directions_car', title: 'No vehicles on the lot',
      body: 'The engine returned no units. Add the first unit and it will start reporting ageing, margin and a recommendation for it.' + why });
    footHost.innerHTML = trustFooter({ source: 'sentinel_inventory_actions()', asOf: dubaiStamp(readAt), evidence: '0 units', actor: myRole() || '—' });
    $('invAdd')?.addEventListener('click', () => unitForm(null, rows, reload));
    return;
  }

  const first = rows[0];
  const cfgDefaults = first.settings_are_defaults === true;
  const rate = n0(first.holding_cost_per_day_aed);
  const basis = up(first.holding_cost_basis);

  /* The engine's own statement of whether a unit needs a person, rather than
     this file inferring it from the recommendation word: NO_ACTION is what the
     view sets alongside `automation_state = 'NONE_NEEDED'` and the note "No
     action, so no owner." */
  const actionable = rows.filter(r => up(r.suggested_owner_state) !== 'NO_ACTION');
  const recCount = countBy(rows, r => r.recommendation);
  const bandCount = countBy(rows, r => r.aging_band);
  const riskCount = countBy(rows, r => r.overall_risk);
  const confCount = countBy(rows, r => r.confidence);
  const marketCount = countBy(rows, r => r.market_position);
  const demandCount = countBy(rows, r => r.demand_signal);

  /* Exposure, and only exposure. Units the engine tagged MARGIN_EXPOSED are
     summed; units it tagged NONE are not a gap in the total, they are the
     engine declining to claim an impact, and the two are counted apart. */
  const exposedRows = rows.filter(r => up(r.impact_kind) === 'MARGIN_EXPOSED');
  const exposed = tally(exposedRows, r => r.impact_aed);
  const actionNoImpact = actionable.filter(r => up(r.impact_kind) !== 'MARGIN_EXPOSED' || n0(r.impact_aed) == null).length;
  const capital = tally(rows, r => r.capital_tied_aed);
  const holdingComputable = rows.filter(r => up(r.holding_cost_state) !== 'NOT_COMPUTABLE');
  const holding = tally(holdingComputable, r => r.holding_cost_accrued_aed);
  const holdingNC = rows.length - holdingComputable.length;
  const dayed = rows.map(r => n0(r.days_in_stock)).filter(d => d != null);
  const oldest = dayed.length ? Math.max(...dayed) : null;
  const undated = rows.length - dayed.length;
  const crit = bandCount.get('CRITICAL') || 0;
  const warnB = bandCount.get('WARNING') || 0;
  const healthy = bandCount.get('HEALTHY') || 0;
  const topOfList = actionable[0] || null;

  const noComparable = marketCount.get('UNKNOWN_NO_COMPARABLE') || 0;
  const unverified = marketCount.get('UNKNOWN_UNVERIFIED_COMPARABLE') || 0;
  const stale = marketCount.get('UNKNOWN_STALE_COMPARABLE') || 0;
  const noPrice = marketCount.get('UNKNOWN_NO_PRICE') || 0;
  const marketUnknownN = rows.filter(r => !str(r.market_position) || up(r.market_position).startsWith('UNKNOWN')).length;
  const positioned = rows.length - marketUnknownN;

  headHost.innerHTML = head(
    `${num(rows.length)} ${plural(rows.length, 'unit', 'units')}, worst first · computed ${dubaiStamp(first.computed_at)}`,
    `${statusChip(cfgDefaults ? 'partial' : 'connected', cfgDefaults ? 'Default thresholds' : 'Your thresholds')}${addBtn}`);

  /* ── KPI snapshot strip ────────────────────────────────────────────────
     Three of these tiles add something up, and each one carries the count it
     was computed over plus the count it had to leave out. */
  strip.innerHTML = [
    kpi('Units needing a decision', num(actionable.length),
      `of ${num(rows.length)} on the lot · ${esc(spread(recCount, ['MANAGER_REVIEW', 'WHOLESALE', 'REPRICE', 'INSPECT', 'RECON', 'TRANSFER', 'PROMOTE', 'HOLD']))}`
      + `<br>Risk: ${esc(spread(riskCount, ['SEVERE', 'HIGH', 'ELEVATED', 'LOW', 'UNKNOWN']))}`
      + (actionable.length
        ? `<br>Top of the list: ${esc(str(topOfList.id))} — ${esc(str(topOfList.overall_risk) || 'risk not rated')}, ${n0(topOfList.days_in_stock) != null ? `${num(topOfList.days_in_stock)} days on the lot` : 'no day count'}`
        : '<br>The engine attaches an owner to none of them: nothing on this lot needs a person today'),
      actionable.length ? 'ds-t-warning' : ''),

    /* EXPOSED. The engine's impact_basis: "This is the amount AT RISK. It is not
       expected loss, not attributed revenue and not recovered revenue." */
    kpi('Gross margin exposed', exposed.total == null ? 'None claimed' : aed(exposed.total),
      (exposed.total == null
        ? `The engine claims no impact for any of the ${num(rows.length)} ${plural(rows.length, 'unit', 'units')} on the lot.`
        : `Margin sitting in ${num(exposed.n)} of ${num(rows.length)} ${plural(rows.length, 'unit', 'units')} that ${plural(exposed.n, 'has', 'have')} not sold. `
          + 'Exposed — not lost, not expected loss, not revenue, not recovered.'
          + `<br>${num(rows.length - exposed.n)} ${plural(rows.length - exposed.n, 'unit is', 'units are')} outside this total because the engine claims no impact for ${plural(rows.length - exposed.n, 'it', 'them')}`)
      + (actionNoImpact ? ` · ${num(actionNoImpact)} ${plural(actionNoImpact, 'carries an action', 'carry an action')} whose impact it could not put a number on` : ''),
      exposed.total == null ? '' : 'ds-t-warning'),

    kpi('Capital tied up', capital.total == null ? 'Unknown' : aed(capital.total),
      capital.total == null
        ? `No unit on the lot carries an acquisition cost, so what this stock has cost to buy is unknown rather than nil (${num(capital.of)} ${plural(capital.of, 'unit', 'units')}).`
        : `Acquisition cost of ${num(capital.n)} of ${num(capital.of)} ${plural(capital.of, 'unit', 'units')}`
          + (capital.missing.length
            ? ` · ${num(capital.missing.length)} ${plural(capital.missing.length, 'has', 'have')} no cost on record and ${plural(capital.missing.length, 'is', 'are')} not in this total`
            : ' · none is missing a cost')),

    /* The tile that used to read AED 33,850 off a rate nobody quoted. */
    kpi('Holding cost accrued',
      holding.total == null ? 'Not computable'
        : basis === 'PLACEHOLDER' ? stateFigure('PLACEHOLDER', holding.total, null)
          : aed(holding.total),
      holding.total == null
        ? (rate == null
          ? `No holding rate is on record for this dealership, so the engine will not state a holding cost or a net margin for any of the ${num(rows.length)} ${plural(rows.length, 'unit', 'units')}. `
            + (capital.total == null ? '' : `What it states instead: ${aed(capital.total)} of capital tied up${oldest != null ? `, the oldest unit ${num(oldest)} days on the lot` : ''}. `)
            + 'Record what a day of floor costs you, with a source, and this becomes a number.'
          : `A rate of ${aed(rate)} a day is on record, but no unit produced a figure from it — all ${num(rows.length)} are missing the day count it would be charged against.`)
        : `${num(holding.n)} of ${num(rows.length)} ${plural(rows.length, 'unit', 'units')} counted`
          + (holdingNC ? ` · ${num(holdingNC)} not computable` : '')
          + (basis === 'PLACEHOLDER'
            ? ' · the rate behind this is a PLACEHOLDER, so this total is an assumption and every figure derived from it is marked as one'
            : basis === 'DEALERSHIP_SUPPLIED' ? ` · ${aed(rate)} a day, on record from this dealership` : ''),
      holding.total == null ? 'ds-t-tertiary' : ''),

    kpi('Past the critical threshold', num(crit),
      `${num(warnB)} more past the warning threshold · ${num(healthy)} healthy`
      + (undated ? ` · ${num(undated)} with no acquisition date and therefore no band` : '')
      + `<br>Warning at ${num(first.warn_days)} days, critical at ${num(first.crit_days)}, `
      + `${cfgDefaults ? 'the engine’s built-in defaults — no configuration row exists for this dealership' : 'from this dealership’s own configuration'}`,
      crit ? 'ds-t-danger' : ''),

    /* Stitch's "Price Position index" tile. The engine states a position only
       against a VERIFIED comparable; this tile counts how many units have one
       and never averages a percentile it does not hold. */
    kpi('Market position known', `${num(positioned)} of ${num(rows.length)}`,
      positioned === rows.length
        ? 'Every unit has a position against a verified comparable.'
        : `${num(marketUnknownN)} ${plural(marketUnknownN, 'unit has', 'units have')} no verified comparable, so the engine states UNKNOWN rather than a percentile. Unknown, never an average and never inferred.`,
      positioned ? '' : 'ds-t-tertiary'),
  ].join('');

  /* ── How these figures were produced ─────────────────────────────────────
     What the engine could not know, said out loud. Three of these are UNKNOWN
     on every unit today; hiding them would make the screen look more confident
     than the data is. Drawn as the export's "Strategy Suggestion Box" callout
     and collapsed by default, so the strip above stays the five-second read. */
  const confWords = [...confCount.entries()];
  /* Already escaped internally — the call site must not escape it a second
     time or an ampersand in a status word comes out as &amp;amp;. */
  const confLine = confWords.length === 1
    ? `Confidence is ${esc(confWords[0][0])} on ${confWords[0][1] === 1 ? 'the one unit' : `all ${num(confWords[0][1])} units`}, and the engine gives a per-unit reason — open any unit to read it.`
    : `Confidence: ${esc(spread(confCount, ['HIGH', 'MEDIUM', 'LOW']))}. The reason is per unit; open a unit to read it.`;
  /* The engine writes one enquiry note per unit and it quotes THAT unit's own
     count; the worst unit's note is shown and the variation is stated. */
  const enquiryNotes = [...new Set(rows.map(r => str(r.enquiry_note)).filter(Boolean))];
  const P = 'font-body-sm text-body-sm text-on-surface';

  provHost.innerHTML = `<details class="bg-surface-container p-space-sm rounded-lg group"${recErr ? ' open' : ''}>
    <summary class="flex items-start gap-2.5 cursor-pointer list-none">
      <span class="material-symbols-outlined text-primary text-[20px] shrink-0">lightbulb</span>
      <span class="${P}"><strong class="font-semibold text-primary">No figure on this screen is derived in the browser.</strong>
        Every band, risk word, recommendation and money figure on a unit is read from the margin review, which is security_invoker — this is your lot and no one else's. ${confLine}
        <span class="text-primary font-semibold">How these figures were produced</span></span>
    </summary>
    <div class="mt-space-sm pl-8 flex flex-col gap-space-sm">
      <p class="${P}"><strong class="font-semibold">Holding cost and net margin.</strong>
      ${rate == null
        ? `No holding rate is on record for this dealership, so the engine reports both as NOT COMPUTABLE on ${num(holdingNC)} of ${num(rows.length)} ${plural(rows.length, 'unit', 'units')} and shows the inputs instead — capital tied up and days on the lot. `
          + 'It is not zero and it is not small; it is not known. Until 2 September this screen filled the gap with AED 50 a day — a rate nobody here ever quoted — and subtracted it from every unit\'s margin. '
          + 'That figure is gone rather than corrected, because it had no source. Record what one day of floor actually costs you, with where the number comes from, and holding cost and net margin appear on every unit on this screen.'
        : basis === 'PLACEHOLDER'
          ? `The holding rate on record is ${aed(rate)} a day and it is recorded as a PLACEHOLDER — a working assumption, not a figure this dealership has stood behind${str(first.holding_cost_set_by) ? `, put there by ${esc(str(first.holding_cost_set_by))}` : ''}${str(first.holding_cost_source) ? ` (${esc(str(first.holding_cost_source))})` : ''}. Every figure derived from it carries an “assumed” mark on the figure itself.`
          : `The holding rate on record is ${aed(rate)} a day${str(first.holding_cost_set_by) ? `, on record from ${esc(str(first.holding_cost_set_by))}` : ''}${str(first.holding_cost_source) ? ` — source: ${esc(str(first.holding_cost_source))}` : ''}${first.holding_cost_verified_at ? `, last confirmed ${esc(dubaiDate(first.holding_cost_verified_at))}` : ''}.`}</p>
      <p class="${P}"><strong class="font-semibold">${marketUnknownN > 0
        ? `Market position is UNKNOWN on ${num(marketUnknownN)} of ${num(rows.length)} ${plural(rows.length, 'unit', 'units')}.`
        : 'Every unit has a market position against a verified comparable.'}</strong>
      ${noComparable ? `${num(noComparable)} ${plural(noComparable, 'has', 'have')} no competitor row for that exact model. ` : ''}
      ${unverified ? `${num(unverified)} ${plural(unverified, 'has', 'have')} a scraped competitor row that nothing ties to the car — those rows are shown on the unit as evidence, with the scraper's own note, and no position and no price move is derived from them. ` : ''}
      ${stale ? `${num(stale)} ${plural(stale, 'has', 'have')} a comparable older than the ${num(first.market_max_age_days)}-day staleness limit. ` : ''}
      ${noPrice ? `${num(noPrice)} ${plural(noPrice, 'is', 'are')} missing a price on one side of the comparison. ` : ''}
      ${positioned > 0 ? `${num(positioned)} ${plural(positioned, 'unit has', 'units have')} a position against a verified comparable.` : 'Unknown, never an average and never inferred.'}</p>
      <p class="${P}"><strong class="font-semibold">Demand.</strong> ${esc(spread(demandCount, ['ENQUIRIES_PRESENT', 'NO_ENQUIRIES_IN_WINDOW', 'UNKNOWN_LOW_COVERAGE']))} across the lot.
      ${esc(str(first.enquiry_note))}${enquiryNotes.length > 1
        ? ' Each unit\'s own note quotes its own enquiry count, so the wording differs slightly per unit — open a unit to read its own.'
        : ''}</p>
      <p class="${P}"><strong class="font-semibold">Who acts.</strong> ${esc(str((rows.find(r => up(r.suggested_owner_state) === 'ROLE_ONLY')
        || rows.find(r => str(r.suggested_owner_note))
        || {}).suggested_owner_note)
        || 'The engine attached no owner note to any unit on this lot.')}</p>
      ${recErr ? `<p class="${P} text-red-700"><strong class="font-semibold">One read failed.</strong> inventory.ai_recommendation could not be loaded (${esc(recErr)}), so the pricing workflow's own note is missing from every unit below and the Edit form would blank it on save. Editing is disabled until that read succeeds.</p>` : ''}
    </div>
  </details>`;

  /* ── Filter bar, saved views, layout switch, search ──────────────────────
     The recommendation pills and the risk floor are the ENGINE's filters: they
     are passed to sentinel_inventory_actions() and the rows come back re-ranked
     by it. That matters for the risk floor in particular, whose rule — a unit
     whose risk is UNKNOWN is never removed by a minimum, because unknown is not
     low — lives in the function body and would have to be duplicated here
     otherwise. The search box, the saved views that pick on an engine column
     and the sort only arrange what the engine returned; none of them decides a
     verdict. */
  const mayEditUnits = canEditUnit();
  const canEdit = !recErr && mayEditUnits;
  const RISK_FLOORS = [
    { v: '', label: 'Any risk' },
    { v: '1', label: `${RANK_WORD[1]} and worse` },
    { v: '2', label: `${RANK_WORD[2]} and worse` },
    /* Not "SEVERE only": the engine keeps an unrated unit at every floor, so
       a label promising only one word would be false the first time one appears. */
    { v: '3', label: RANK_WORD[3] },
  ];
  const recWords = [...recCount.keys()].sort((a, b) => (recTone(a) === 'ok' ? 1 : 0) - (recTone(b) === 'ok' ? 1 : 0) || a.localeCompare(b));
  const REC_DOT = { hot: 'w-2 h-2 rounded-full bg-error', warm: 'w-2 h-2 rounded-full bg-amber-500', cold: 'w-2 h-2 rounded-full bg-sky-600', ok: 'w-2 h-2 rounded-full bg-emerald-600', unknown: 'w-2 h-2 rounded-full bg-outline' };

  const savedView = VIEWS.find(v => readFlag(VIEW_FLAG(v.key), false)) || VIEWS[0];
  const f = { rec: savedView.rec, risk: savedView.risk, q: '', view: savedView.key, sort: 'engine', table: readFlag(LAYOUT_FLAG, false) };
  /* The last set the ENGINE returned, before the search box narrows it. */
  let engineRows = rows;
  let shown = rows;

  const LAYOUT = {
    on: 'p-1 px-2.5 rounded bg-surface-container-lowest text-primary shadow-sm flex items-center gap-1 font-body-sm text-body-sm font-semibold transition-all',
    off: 'p-1 px-2.5 rounded text-outline hover:text-on-surface flex items-center gap-1 font-body-sm text-body-sm font-medium transition-all',
  };
  const ctl = 'w-auto h-auto bg-surface-container-low text-on-surface font-body-sm text-body-sm px-space-sm py-2 rounded focus:outline-none focus:ring-2 focus:ring-primary/20';

  const bar = el('div', 'bg-surface-container-lowest p-space-md rounded-lg flex flex-col gap-space-md shadow-sm border border-outline-variant/40');
  bar.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-space-md">
      <div class="flex flex-wrap items-center gap-1.5" id="segRec" role="group" aria-label="Filter by recommendation">
        <button type="button" class="${SEG.off}" data-v="" title="Every unit the engine reported"><span>All stock</span><span class="font-label-numeric-sm text-label-numeric-sm px-1">${num(rows.length)}</span></button>
        ${recWords.map(w => `<button type="button" class="${SEG.off}" data-v="${esc(w)}" title="${esc(`Units the engine recommends ${w} for`)}"><span class="${REC_DOT[recTone(w)] || REC_DOT.unknown}"></span><span>${esc(w)}</span><span class="font-label-numeric-sm text-label-numeric-sm px-1">${num(recCount.get(w))}</span></button>`).join('')}
      </div>
      <div class="flex flex-wrap items-center gap-space-sm">
        <label class="px-space-sm py-1.5 rounded bg-surface-container-low text-on-surface font-body-sm text-body-sm flex items-center gap-2" title="Built-in views. The one you pick is remembered in this browser.">
          <span class="material-symbols-outlined text-[18px] text-outline">tune</span>
          <span>Saved views:</span>
          <select id="invView" class="bg-transparent font-semibold focus:outline-none cursor-pointer" aria-label="Saved view">
            ${VIEWS.map(v => `<option value="${esc(v.key)}"${v.key === f.view ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}
          </select>
        </label>
        <button type="button" id="invSaveView" class="px-space-sm py-1.5 rounded bg-surface-container-low hover:bg-surface-container text-on-surface-variant font-body-sm text-body-sm flex items-center gap-1"
          title="Remembers the selected view and layout in this browser. Views are the built-in presets; a custom named view needs a place to store it that this build does not have.">
          <span class="material-symbols-outlined text-[16px]">bookmark_add</span><span>Save view</span></button>
        <div class="flex items-center bg-surface-container-low rounded p-0.5" role="group" aria-label="Layout">
          <button type="button" id="invGrid" class="${LAYOUT.on}"><span class="material-symbols-outlined text-[18px]">grid_view</span><span>Grid</span></button>
          <button type="button" id="invTableBtn" class="${LAYOUT.off}"><span class="material-symbols-outlined text-[18px]">table_rows</span><span>Table</span></button>
        </div>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-space-sm">
      <div class="relative flex-1 min-w-[260px]">
        <span class="material-symbols-outlined absolute left-3 top-2.5 text-outline text-[18px]">search</span>
        <input type="search" id="invQ" aria-label="Search stock" placeholder="Search model, stock number or VIN"
          class="w-full pl-9 pr-space-md py-2 bg-surface-container-low rounded text-on-surface placeholder:text-outline font-body-sm text-body-sm focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20 transition-all" />
      </div>
      <select id="invRisk" aria-label="Minimum overall risk" class="${ctl}"
        title="Passed to the engine as p_min_risk_rank. A unit whose risk is UNKNOWN is never removed by this floor — unknown is not low, so it stays visible for a person to look at.">
        ${RISK_FLOORS.map(r => `<option value="${r.v}"${r.v === f.risk ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}
      </select>
      <select id="invSort" aria-label="Sort" class="${ctl}">
        ${SORTS.map(s => `<option value="${s.key}">Sort: ${esc(s.label)}</option>`).join('')}
      </select>
      <span class="font-label-numeric-sm text-label-numeric-sm text-outline" id="invCount"></span>
      <button type="button" id="invCsv" class="px-space-md py-2 bg-surface-container-high text-on-surface font-body-sm text-body-sm font-semibold rounded hover:bg-surface-variant flex items-center gap-1.5 transition-colors"
        title="Downloads the units on screen with the engine's own columns, unchanged.">
        <span class="material-symbols-outlined text-[18px]">file_download</span><span>Export CSV</span></button>
    </div>`;
  body.innerHTML = '';
  body.appendChild(bar);
  const viewHost = el('div'); body.appendChild(viewHost);

  /* ── One unit as a card (the export's grid view) ─────────────────────── */
  const card1 = (r, i) => {
    const b = bandOf(r);
    const d = n0(r.days_in_stock);
    const mkt = str(r.market_position);
    const mktUnknown = !mkt || up(r.market_position).startsWith('UNKNOWN');
    const g = n0(r.gross_margin_aed);
    const demandUnknown = up(r.demand_signal).startsWith('UNKNOWN');
    return `<div class="bg-surface-container-lowest rounded-xl overflow-hidden flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow border border-outline-variant/40">
      <div class="${BAND_STRIP[b]}" title="${esc(`Warning at ${num(r.warn_days)} days, critical at ${num(r.crit_days)}.`)}">
        <div class="flex items-center gap-1.5 font-semibold min-w-0"><span class="material-symbols-outlined text-[16px]">${BAND_ICON[b]}</span><span class="truncate">${BAND_WORD[b]}</span></div>
        <span class="${BAND_DAYS[b]}">${d == null ? 'UNDATED' : `${num(d)} DAYS ON LOT`}</span>
      </div>
      <div class="relative h-28 w-full bg-surface-container flex items-center justify-center text-outline">
        <div class="flex flex-col items-center gap-1"><span class="material-symbols-outlined text-[36px]">directions_car</span><span class="font-label-numeric-sm text-[11px]">No photo on record</span></div>
        <div class="absolute top-2 left-2 flex flex-wrap gap-1">
          <span class="px-2 py-0.5 rounded bg-inverse-surface/90 text-inverse-on-surface font-label-numeric-sm text-label-numeric-sm font-semibold">${esc(str(r.id))}</span>
          ${str(r.status) ? `<span class="px-2 py-0.5 rounded bg-surface-container-lowest/95 text-on-surface font-label-numeric-sm text-label-numeric-sm font-semibold">${esc(str(r.status))}</span>` : ''}
        </div>
      </div>
      <div class="p-space-md flex flex-col gap-space-sm flex-1">
        <div class="flex items-start justify-between gap-space-sm">
          <div class="min-w-0">
            <h2 class="font-headline-md text-headline-md text-on-surface tracking-tight">${esc(str(r.model) || 'Unnamed unit')}</h2>
            <p class="font-body-sm text-body-sm text-on-surface-variant font-label-numeric-sm truncate">${str(r.vin) ? esc(str(r.vin)) : 'No VIN on record'}</p>
          </div>
          <div class="text-right shrink-0">
            <span class="font-label-numeric-sm text-label-numeric-sm text-outline uppercase font-semibold">List price</span>
            <div class="font-label-numeric-lg text-label-numeric-lg text-primary font-bold">${aed(r.price_aed)}</div>
          </div>
        </div>
        <div class="bg-surface-container-low p-space-sm rounded-lg flex flex-col gap-1.5">
          <div class="flex items-center justify-between gap-2 text-body-sm">
            <span class="text-on-surface-variant font-medium flex items-center gap-1"><span class="material-symbols-outlined text-[16px] text-secondary">pie_chart</span> Market benchmark</span>
            ${mkt ? pill(up(r.market_position), mktUnknown ? 'unknown' : tone(r.market_position), { verbatim: true }) : statusChip('not-tested', 'Not stated')}
          </div>
          <p class="font-body-sm text-body-sm text-on-surface-variant line-clamp-2">${esc(str(r.market_note) || 'The engine wrote no market note for this unit.')}</p>
        </div>
        <div class="px-2.5 py-2 rounded bg-surface-container flex items-start gap-2">
          <span class="material-symbols-outlined text-primary text-[18px] shrink-0 mt-0.5">auto_awesome</span>
          <div class="flex flex-col gap-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap"><span class="font-table-header text-table-header text-primary uppercase font-bold tracking-wider">Sentinel recommendation</span>
              ${up(r.recommendation) ? pill(up(r.recommendation), recTone(r.recommendation), { verbatim: true }) : ''}
              ${r.human_approval_required === true ? pill('approval required', 'warm', { verbatim: false }) : ''}</div>
            <span class="font-body-sm text-body-sm text-on-surface font-medium leading-tight line-clamp-3">${esc(str(r.reason) || 'The engine gave no reason for this unit.')}</span>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2 pt-1 font-body-sm">
          <div class="bg-surface-container-low p-2 rounded flex flex-col">
            <span class="text-outline text-table-header uppercase">Gross margin</span>
            <span class="font-label-numeric-sm text-label-numeric-sm font-bold mt-0.5 ${g != null && g < 0 ? 'text-red-700' : 'text-on-surface'}">${aed(r.gross_margin_aed)} <span class="font-normal text-outline">${marginPct(r.gross_margin_pct)}</span></span>
          </div>
          <div class="bg-surface-container-low p-2 rounded flex flex-col" title="${esc(str(r.enquiry_note))}">
            <span class="text-outline text-table-header uppercase">Enquiries · ${num(r.enquiry_window_days)} days</span>
            <span class="font-label-numeric-sm text-label-numeric-sm font-bold mt-0.5 ${demandUnknown ? 'text-outline' : 'text-tertiary'}">${num(r.enquiries_in_window)} <span class="font-normal text-outline">${esc(str(r.enquiry_coverage) || 'coverage not stated')}</span></span>
          </div>
        </div>
        <div class="flex items-center justify-between text-outline px-1">
          <span class="flex items-center gap-1 text-[12px]"><span class="w-2 h-2 rounded-full bg-outline-variant"></span>Open repair orders: coming soon (needs a DMS connected)</span>
        </div>
      </div>
      <div class="p-space-md pt-0 flex items-center gap-space-sm">
        <button type="button" data-inspect="${i}" class="flex-1 py-2 rounded bg-primary text-on-primary font-body-sm text-body-sm font-semibold flex items-center justify-center gap-1.5 hover:bg-primary-container transition-colors shadow-sm"><span>Inspect unit</span><span class="material-symbols-outlined text-[16px]">arrow_forward</span></button>
        <button type="button" data-v360="${i}" class="p-2 rounded bg-surface-container-low hover:bg-surface-container text-on-surface-variant transition-colors" title="Open Vehicle 360"><span class="material-symbols-outlined text-[18px]">open_in_new</span></button>
      </div>
    </div>`;
  };

  /* ── The dense table (the export's table view) ──────────────────────── */
  const cols = [
    { label: 'Stock #', strong: true, render: r => `<span class="font-label-numeric-sm text-primary font-bold">${esc(str(r.id))}</span>` },
    { label: 'VIN', render: r => (str(r.vin) ? `<span class="font-label-numeric-sm text-on-surface-variant">${esc(str(r.vin))}</span>` : '<span class="text-outline">No VIN on record</span>') },
    { label: 'Vehicle', render: r => `<div class="font-semibold text-on-surface">${esc(str(r.model) || 'Unnamed unit')}</div><div class="text-[11px] text-outline">${esc(str(r.status) || 'no status')}</div>` },
    { label: 'Price', align: 'r', render: r => aed(r.price_aed) },
    { label: 'Cost', align: 'r', render: r => aed(r.cost_aed) },
    {
      label: 'Days', align: 'r', render: (r) => {
        const d = n0(r.days_in_stock);
        if (d == null) {
          return `<span class="text-outline" title="${esc('No acquisition date on record, so the engine cannot count days for this unit and does not band it. It is not a new car; it is an undated one.')}">Undated</span>`;
        }
        const toCrit = n0(r.days_to_critical);
        return `<div>${num(d)}</div><div class="text-[11px] text-outline">${toCrit == null ? '' : toCrit > 0 ? `${num(toCrit)} to critical` : 'past critical'}</div>`;
      },
    },
    {
      label: 'Band', render: (r) => {
        const b = up(r.aging_band);
        if (!b) return `<span class="text-outline" title="${esc('The engine did not band this unit — there is no day count to band it by.')}">Not banded</span>`;
        return `<span title="${esc(`Warning at ${num(r.warn_days)} days, critical at ${num(r.crit_days)}.`)}">${pill(b, tone(b), { verbatim: true })}</span>`;
      },
    },
    { label: 'Market position', render: r => (str(r.market_position)
      ? pill(up(r.market_position), up(r.market_position).startsWith('UNKNOWN') ? 'unknown' : tone(r.market_position), { verbatim: true })
      : '<span class="text-outline">Not stated</span>') },
    {
      label: 'Margin', align: 'r', render: (r) => {
        const g = n0(r.gross_margin_aed);
        return `<span class="${g != null && g < 0 ? 'text-red-700' : ''}">${aed(r.gross_margin_aed)}</span><div class="text-[11px] text-outline">${marginPct(r.gross_margin_pct)}</div>`;
      },
    },
    {
      label: 'Overall risk', render: (r) => {
        const w = up(r.overall_risk);
        if (!w) return '<span class="text-outline">Not rated</span>';
        return `<span title="${esc(str(r.risk_basis))}">${pill(w, riskTone(w), { verbatim: true })}</span>`;
      },
    },
    {
      label: 'Sentinel recommendation', render: (r) => {
        const w = up(r.recommendation);
        if (!w) return '<span class="text-outline">None</span>';
        return `<span title="${esc(str(r.reason))}">${pill(w, recTone(w), { verbatim: true })}</span>`
          + (r.human_approval_required === true ? '<div class="text-[11px] text-outline">approval required</div>' : '');
      },
    },
  ];

  function paintView(list, err) {
    if (!err) engineRows = list;
    const q = f.q.trim().toLowerCase();
    const preset = VIEWS.find(v => v.key === f.view);
    let view = list;
    if (preset && preset.pick) view = view.filter(preset.pick);
    if (q) view = view.filter(r => [r.id, r.model, r.vin].map(v => str(v).toLowerCase()).join(' ').includes(q));
    if (sorters[f.sort]) view = [...view].sort(sorters[f.sort]);
    shown = view;
    $('invCount').textContent = `${view.length} of ${rows.length} units`;
    $('invGrid').className = f.table ? LAYOUT.off : LAYOUT.on;
    $('invTableBtn').className = f.table ? LAYOUT.on : LAYOUT.off;
    if (err) {
      viewHost.innerHTML = `${errorState({ what: 'that view of the Sentinel', err, retry: 'filter' })}
        <p class="font-body-sm text-body-sm text-on-surface-variant mt-2">The filter is applied by the engine, not here, so a failed filter leaves no rows to show rather than a guess at which ones would have matched.</p>`;
      viewHost.querySelector('[data-retry]')?.addEventListener('click', refilter);
      return;
    }
    if (!view.length) {
      viewHost.innerHTML = `${emptyState({ icon: 'search_off', title: 'No unit matches',
        body: f.q ? 'No unit on the lot matches that search within the current filter.'
          : 'The engine returned no unit under this filter. That is an answer about the lot, not an error.' })}
        <div class="flex justify-center mt-space-sm"><button type="button" class="${BTN.secondary}" id="invClear">Clear filters</button></div>`;
      $('invClear')?.addEventListener('click', () => {
        f.rec = ''; f.risk = ''; f.q = ''; f.view = 'all';
        $('invQ').value = ''; $('invRisk').value = ''; $('invView').value = 'all';
        refilter();
      });
      return;
    }
    if (f.table) {
      viewHost.innerHTML = `<div class="bg-surface-container-lowest rounded-xl overflow-hidden shadow-sm border border-outline-variant/40">${table(cols, view, { onRow: true })}</div>`;
      wireRows(viewHost, view, drawer);
    } else {
      viewHost.innerHTML = `<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-space-lg">${view.map(card1).join('')}</div>`;
      viewHost.querySelectorAll('[data-inspect]').forEach(b => b.addEventListener('click', () => drawer(view[Number(b.dataset.inspect)])));
      viewHost.querySelectorAll('[data-v360]').forEach(b => b.addEventListener('click', () => openVehicle360(str(view[Number(b.dataset.v360)].id))));
    }
  }

  async function refilter() {
    bar.querySelectorAll('#segRec button').forEach(b => segPaint(b, b.dataset.v === f.rec));
    /* No engine filter, no round trip: the unfiltered set is already in memory
       and is the same rows in the same engine order. */
    if (!f.rec && !f.risk) { paintView(rows, null); return; }
    viewHost.innerHTML = skeleton({ rows: 4 });
    try {
      const got = await readSentinel(f.rec || null, f.risk === '' ? null : Number(f.risk));
      paintView(withRec(Array.isArray(got) ? got : []), null);
    } catch (e) {
      paintView([], e);
    }
  }

  /* ── One unit, in the order an owner asks the questions ────────────────
     The export's unit drawer: header with the Vehicle 360 hand-off, the risk &
     profit summary, interested demand, open repair orders. Below those, the
     sections this screen already owed an owner and the export has no slot
     for are kept rather than dropped — what to do and who, how sure the engine
     is, the evidence, the thresholds and the pricing workflow's note — because
     each answers "why" for a verdict printed above it. */
  function drawer(r) {
    const holdState = up(r.holding_cost_state);
    const netState = up(r.net_margin_state);
    const inputs = holdingInputs(r);
    const evidence = Array.isArray(r.evidence) ? r.evidence : [];
    const noAction = up(r.suggested_owner_state) === 'NO_ACTION';
    const marketUnknown = up(r.market_position).startsWith('UNKNOWN');
    const demandUnknown = up(r.demand_signal).startsWith('UNKNOWN');
    const b = bandOf(r);
    const g = n0(r.gross_margin_aed);
    const SEC = 'flex flex-col gap-space-sm';
    const H = 'font-headline-md text-headline-md text-on-surface tracking-tight';
    const TILE = 'bg-surface-container-lowest p-2.5 rounded-lg flex flex-col min-w-0';
    const KV = 'grid grid-cols-[minmax(8rem,max-content)_1fr] gap-x-space-md gap-y-1.5 font-body-sm text-body-sm [&>dt]:text-outline [&>dd]:text-on-surface [&>dd]:text-right';
    const NOTE = 'font-body-sm text-body-sm text-on-surface-variant';
    const BOX = 'bg-surface-container-low p-space-md rounded-xl flex flex-col gap-space-sm';
    const chipOr = (v, t) => (up(v) ? pill(up(v), t, { verbatim: true }) : '<span class="text-outline">not rated</span>');

    openDeskDrawer(`
      <div class="p-space-lg bg-surface-container-low flex flex-col gap-space-sm shrink-0">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 flex-wrap min-w-0">
            <span class="px-2 py-0.5 rounded bg-primary text-on-primary font-label-numeric-sm text-label-numeric-sm font-semibold">${esc(str(r.id))}</span>
            <span class="${BAND_DAYS[b]} font-label-numeric-sm text-label-numeric-sm">${n0(r.days_in_stock) == null ? 'NO ACQUISITION DATE' : `${num(r.days_in_stock)} DAYS ON LOT`}</span>
            <span class="text-outline font-label-numeric-sm text-label-numeric-sm truncate">${str(r.vin) ? esc(str(r.vin)) : 'No VIN on record'}</span>
          </div>
          <button type="button" class="${BTN.icon}" id="dClose" aria-label="Close"><span class="material-symbols-outlined text-[20px]">close</span></button>
        </div>
        <div class="flex items-start justify-between gap-space-sm">
          <div class="min-w-0">
            <h2 class="font-headline-md text-headline-md text-on-surface tracking-tight leading-snug">${esc(str(r.model) || 'Unnamed unit')}</h2>
            <div class="flex items-center gap-1.5 flex-wrap mt-1">
              ${str(r.status) ? `<span class="${CHIP}">${esc(str(r.status))}</span>` : ''}
              ${up(r.aging_band) ? pill(up(r.aging_band), tone(r.aging_band), { verbatim: true }) : `<span class="${CHIP}">Not banded</span>`}
              ${up(r.overall_risk) ? pill(up(r.overall_risk), riskTone(r.overall_risk), { verbatim: true }) : ''}
            </div>
          </div>
          <div class="text-right shrink-0">
            <span class="font-table-header text-table-header uppercase text-outline">List price</span>
            <div class="font-label-numeric-lg text-label-numeric-lg text-primary font-bold">${aed(r.price_aed)}</div>
          </div>
        </div>
        <button type="button" id="dV360" class="mt-1 w-full py-2 rounded bg-primary text-on-primary font-body-sm text-body-sm font-semibold flex items-center justify-center gap-2 hover:bg-primary-container shadow-sm transition-all">
          <span>Open Vehicle 360 →</span></button>
      </div>
      <div class="flex-1 overflow-y-auto p-space-lg flex flex-col gap-space-lg">
        <div class="${BOX}">
          <div class="flex items-center justify-between gap-2">
            <span class="font-table-header text-table-header uppercase text-outline tracking-wider flex items-center gap-1.5"><span class="material-symbols-outlined text-primary text-[16px]">analytics</span>Risk &amp; profit summary</span>
            ${up(r.recommendation) ? pill(up(r.recommendation), recTone(r.recommendation), { verbatim: true }) : `<span class="${CHIP}">No recommendation</span>`}
          </div>
          <div class="grid grid-cols-3 gap-2">
            <div class="${TILE}"><span class="font-table-header text-table-header text-outline uppercase">Holding cost</span>
              <div class="font-label-numeric-md text-label-numeric-md font-bold mt-1">${stateFigure(holdState, r.holding_cost_accrued_aed, r.holding_cost_note, holdState === 'NOT_COMPUTABLE' ? inputs : '')}</div></div>
            <div class="${TILE}"><span class="font-table-header text-table-header text-outline uppercase">Gross margin</span>
              <div class="font-label-numeric-md text-label-numeric-md font-bold mt-1 ${g != null && g < 0 ? 'text-red-700' : 'text-on-surface'}">${aed(r.gross_margin_aed)}</div>
              <span class="text-[11px] text-outline mt-0.5">${marginPct(r.gross_margin_pct)} of list</span></div>
            <div class="${TILE}"><span class="font-table-header text-table-header text-outline uppercase">Market position</span>
              <div class="mt-1">${str(r.market_position) ? pill(up(r.market_position), marketUnknown ? 'unknown' : tone(r.market_position), { verbatim: true }) : `<span class="${CHIP}">not stated</span>`}</div></div>
          </div>
          <div class="bg-surface-container p-space-sm rounded-lg flex items-start gap-2.5">
            <span class="material-symbols-outlined text-primary text-[20px] shrink-0 mt-0.5">lightbulb</span>
            <div class="font-body-sm text-body-sm text-on-surface"><strong class="font-semibold text-primary">${noAction ? 'Nothing is wrong with this unit.' : 'What is wrong:'}</strong>
              ${esc(str(r.reason) || 'The engine gave no reason for this unit.')}
              <div class="${NOTE} mt-1">${esc(str(r.risk_basis))}</div></div>
          </div>
          <dl class="${KV}">
            <dt>Age risk</dt><dd>${chipOr(r.age_risk, riskTone(r.age_risk))}</dd>
            <dt>Margin risk</dt><dd>${chipOr(r.margin_risk, riskTone(r.margin_risk))}</dd>
            <dt>Days to warning</dt><dd class="tabular-nums">${n0(r.days_to_warning) == null ? '<span class="text-outline">no day count</span>' : n0(r.days_to_warning) === 0 ? 'past it' : num(r.days_to_warning)}</dd>
            <dt>Days to critical</dt><dd class="tabular-nums">${n0(r.days_to_critical) == null ? '<span class="text-outline">no day count</span>' : n0(r.days_to_critical) === 0 ? 'past it' : num(r.days_to_critical)}</dd>
          </dl>
        </div>

        <div class="${SEC}">
          <div class="flex items-center justify-between gap-2"><span class="${H}">Interested demand</span>
            ${str(r.demand_signal) ? pill(up(r.demand_signal), demandUnknown ? 'unknown' : 'cold', { verbatim: true }) : `<span class="${CHIP}">not stated</span>`}</div>
          <p class="${NOTE}">How many enquiries the engine could tie to this unit. It does not list people here: the named leads whose stated interest mentions this model are on Vehicle 360, as a text match and labelled as one.</p>
          <dl class="${KV} bg-surface-container-low p-space-md rounded-xl">
            <dt>Enquiries in ${num(r.enquiry_window_days)} days</dt><dd class="tabular-nums">${num(r.enquiries_in_window)}</dd>
            <dt>From leads · messages</dt><dd class="tabular-nums">${num(r.enquiry_leads)} · ${num(r.enquiry_messages)}</dd>
            <dt>Last enquiry</dt><dd>${r.enquiry_last_at ? esc(dubaiStamp(r.enquiry_last_at)) : '<span class="text-outline">none in the window</span>'}</dd>
            <dt>Coverage</dt><dd>${esc(str(r.enquiry_coverage) || 'not stated')}</dd>
          </dl>
          <p class="${NOTE}">${esc(str(r.enquiry_note))}</p>
        </div>

        <div class="${SEC}">
          <div class="flex items-center justify-between"><span class="${H}">Open repair orders &amp; workshop</span><span class="font-label-numeric-sm text-label-numeric-sm text-outline">DMS connector</span></div>
          ${comingSoonPanel({ kind: 'coming-soon', icon: 'build_circle', title: 'Workshop job sheet sync',
            body: 'Reconditioning and repair orders appear here once a dealer management system is connected. NEXUS holds no repair-order or recon-cost table today, so nothing is shown rather than a zero.',
            prerequisite: 'Needs your DMS connected' })}
        </div>

        <div class="${SEC}">
          <span class="${H}">What to do, and who</span>
          <div class="flex gap-2 items-center flex-wrap">
            ${r.human_approval_required === true
              ? `<span title="The engine will not let this be actioned without a person approving it.">${pill('approval required', 'warm', { verbatim: false })}</span>`
              : `<span class="${CHIP}" title="The engine does not require a person to approve anything for this unit.">no approval needed</span>`}
            <span class="${CHIP}" title="${esc('Whether NEXUS may execute this on its own. MANUAL_ONLY means a person does it; NONE_NEEDED means there is nothing to execute.')}">${esc(str(r.automation_state) || 'automation state not stated')}</span>
          </div>
          <dl class="${KV} bg-surface-container-low p-space-md rounded-xl">
            <dt>Who</dt><dd>${noAction
              ? `<span class="text-outline">${esc(str(r.suggested_owner_note) || 'No action, so no owner.')}</span>`
              : `${esc(str(r.suggested_owner_role) || 'not stated')}<div class="${NOTE}">${esc(str(r.suggested_owner_note))}</div>`}</dd>
            <dt>Impact</dt><dd class="tabular-nums">${
              up(r.impact_kind) === 'MARGIN_EXPOSED' && n0(r.impact_aed) != null
                ? `${aed(r.impact_aed)}<div class="${NOTE}">${esc(impactWord(r.impact_kind))}</div>`
                : `<span class="text-outline">${esc(impactWord(r.impact_kind))}</span>`}</dd>
          </dl>
          <p class="${NOTE}">${esc(str(r.impact_basis))}</p>
        </div>

        <div class="${SEC}">
          <span class="${H}">Money</span>
          <dl class="${KV} bg-surface-container-low p-space-md rounded-xl">
            <dt>Cost</dt><dd class="tabular-nums">${aed(r.cost_aed)}</dd>
            <dt>List price</dt><dd class="tabular-nums">${aed(r.price_aed)}</dd>
            <dt>Gross margin</dt><dd class="tabular-nums"><strong class="${g != null && g < 0 ? 'text-red-700' : ''}">${aed(r.gross_margin_aed)}</strong> <span class="text-outline">${marginPct(r.gross_margin_pct)}</span></dd>
            <dt>Capital tied up</dt><dd class="tabular-nums">${aed(r.capital_tied_aed)}</dd>
            <dt>Holding cost</dt><dd class="tabular-nums">${stateFigure(holdState, r.holding_cost_accrued_aed, r.holding_cost_note, holdState === 'NOT_COMPUTABLE' ? inputs : '')}</dd>
            <dt>Net margin</dt><dd class="tabular-nums">${stateFigure(netState, r.net_margin_aed, r.net_margin_note, netState === 'NOT_COMPUTABLE' ? inputs : '')}</dd>
          </dl>
          ${holdState === 'PLACEHOLDER'
            ? `<div class="flex items-start gap-2.5 p-space-sm rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm"><span class="material-symbols-outlined">warning</span>
               <div>The holding rate behind those two figures is recorded as a PLACEHOLDER, not as a rate this dealership supplied. They are assumptions and are marked as such wherever they appear.${str(r.holding_cost_note) ? ` ${esc(str(r.holding_cost_note))}` : ''}</div></div>`
            : ''}
        </div>

        <div class="${SEC}">
          <span class="${H}">Market</span>
          ${str(r.market_competitor) ? `<dl class="${KV} bg-surface-container-low p-space-md rounded-xl">
            <dt>Competitor</dt><dd>${esc(str(r.market_competitor))}</dd>
            <dt>Their price</dt><dd class="tabular-nums">${aed(r.market_price_aed)}</dd>
            <dt>Match quality</dt><dd>${str(r.market_match_quality) ? esc(str(r.market_match_quality)) : '<span class="text-outline">not recorded</span>'}</dd>
            <dt>Scraped</dt><dd>${esc(dubaiStamp(r.market_scraped_at))}</dd>
          </dl>` : ''}
          <p class="${NOTE}">${esc(str(r.market_note))}</p>
        </div>

        <div class="${SEC}">
          <span class="${H}">How sure the engine is</span>
          <div>${up(r.confidence) ? pill(up(r.confidence), tone(r.confidence), { verbatim: true }) : `<span class="${CHIP}">not stated</span>`}</div>
          <p class="${NOTE}">${esc(str(r.confidence_basis))}</p>
        </div>

        <div class="${SEC}">
          <span class="${H}">Evidence · ${num(evidence.length)}</span>
          ${evidence.length
            ? evidence.map(x => `<div class="p-2.5 rounded bg-surface-container-low font-body-sm text-body-sm"><strong class="font-semibold">${esc(str(x && x.fact))}</strong><br><span class="text-on-surface-variant">${esc(str(x && x.source))}</span></div>`).join('')
            : `<p class="${NOTE}">The engine attached no evidence to this unit. A leak with no evidence is not displayed, so there is nothing to act on here.</p>`}
        </div>

        <div class="${SEC}">
          <span class="${H}">The thresholds this verdict was measured against</span>
          <dl class="${KV} bg-surface-container-low p-space-md rounded-xl">
            <dt>Warning · critical</dt><dd class="tabular-nums">${num(r.warn_days)} · ${num(r.crit_days)} days</dd>
            <dt>Promote · wholesale</dt><dd class="tabular-nums">${num(r.promote_days)} · ${num(r.wholesale_days)} days</dd>
            <dt>Reprice margin floor</dt><dd class="tabular-nums">${esc(str(r.min_margin_pct))}%</dd>
            <dt>Market tolerance</dt><dd class="tabular-nums">${esc(str(r.tol_pct))}%</dd>
            <dt>Enquiry floor · model words</dt><dd class="tabular-nums">${num(r.min_enq_sources)} · ${num(r.min_model_token_overlap)}</dd>
            <dt>Comparable goes stale after</dt><dd class="tabular-nums">${num(r.market_max_age_days)} days</dd>
          </dl>
          <p class="${NOTE}">${r.settings_are_defaults === true
            ? 'These are the engine’s built-in defaults. No configuration row exists for this dealership yet, so nothing here has been agreed with them.'
            : 'These come from this dealership’s own configuration row, not from a constant in this dashboard.'}</p>
        </div>

        <div class="${SEC}">
          <span class="${H}">Pricing workflow note</span>
          <div class="p-2.5 rounded bg-surface-container-low font-body-sm text-body-sm text-on-surface italic">${recErr
            ? esc(`inventory.ai_recommendation could not be read (${recErr}), so whether the pricing workflow has written anything for this unit is unknown here.`)
            : esc(str(r.ai_recommendation) || 'No recommendation has been written for this unit by the pricing workflow.')}</div>
        </div>
      </div>
      <div class="p-space-md bg-surface-container-low flex flex-wrap items-center justify-between gap-space-sm shrink-0">
        <div class="flex items-center gap-2"><span class="material-symbols-outlined text-outline text-[18px]">lock</span>
          <span class="font-body-sm text-body-sm text-outline">Signed in as ${esc(myRole() || 'role unknown')}</span></div>
        <div class="flex items-center gap-space-sm">
          <button type="button" class="${BTN.secondary}" id="dComp" title="${esc('The Competitors screen holds the scraped listings behind the market section above.')}">Open Competitors</button>
          <button type="button" class="${BTN.primary}" id="dEdit"${canEdit ? '' : ` disabled title="${esc(!mayEditUnits
            ? 'Changing a vehicle is an owner, admin or manager decision at this dealership. Your account can read the Sentinel but not edit the unit.'
            : 'inventory.ai_recommendation did not load, so saving from here would blank it. Reload the screen before editing.')}"`}><span class="material-symbols-outlined text-[16px]">edit</span>Edit</button>
        </div>
      </div>`);
    $('dClose').addEventListener('click', closeDrawer);
    $('dComp').addEventListener('click', () => { closeDrawer(); go('competitors'); });
    $('dV360').addEventListener('click', () => { closeDrawer(); openVehicle360(str(r.id)); });
    $('dEdit').addEventListener('click', () => {
      if (!canEdit) return;
      closeDrawer(); unitForm(r, rows, reload);
    });
  }

  bar.querySelectorAll('#segRec button').forEach(b =>
    b.addEventListener('click', () => { f.rec = b.dataset.v; refilter(); }));
  $('invRisk').addEventListener('change', (e) => { f.risk = e.target.value; refilter(); });
  $('invSort').addEventListener('change', (e) => { f.sort = e.target.value; paintView(engineRows, null); });
  $('invQ').addEventListener('input', (e) => { f.q = e.target.value; paintView(engineRows, null); });
  $('invView').addEventListener('change', (e) => {
    const v = VIEWS.find(x => x.key === e.target.value) || VIEWS[0];
    f.view = v.key; f.rec = v.rec; f.risk = v.risk; $('invRisk').value = v.risk;
    refilter();
  });
  $('invSaveView').addEventListener('click', () => {
    VIEWS.forEach(v => writeFlag(VIEW_FLAG(v.key), v.key === f.view));
    writeFlag(LAYOUT_FLAG, f.table);
    $('invSaveView').querySelector('span:last-child').textContent = 'View saved';
  });
  $('invGrid').addEventListener('click', () => { f.table = false; writeFlag(LAYOUT_FLAG, false); paintView(engineRows, null); });
  $('invTableBtn').addEventListener('click', () => { f.table = true; writeFlag(LAYOUT_FLAG, true); paintView(engineRows, null); });
  $('invCsv').addEventListener('click', () => {
    const lines = [CSV_COLS.join(',')].concat(shown.map(r => CSV_COLS.map(c => csvCell(r[c])).join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `inventory-sentinel-${String(first.computed_at || readAt).slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('invAdd')?.addEventListener('click', () => unitForm(null, rows, reload));

  footHost.innerHTML = trustFooter({
    source: 'sentinel_inventory_actions() over v_inventory_profit_sentinel',
    asOf: dubaiStamp(first.computed_at),
    evidence: `${num(rows.length)} ${plural(rows.length, 'unit', 'units')} · ${num(actionable.length)} needing a decision`,
    actor: myRole() || '—',
  });

  refilter();
};
