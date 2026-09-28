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
import { canAddUnit, canEditUnit, db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, dubaiDate, dubaiStamp, esc, n0, num, pill, tone } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, table, wireRows } from '../lib/ui.js';
import { holdingSettings, unitForm } from '../lib/unit-form.js';

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
    return '<span class="ds-t-warning">Not computable</span>'
      + (lines.length ? `<div class="ds-cell-sub" style="white-space:normal;text-align:right">${lines.map(esc).join('<br>')}</div>` : '');
  }
  if (s === 'PLACEHOLDER') {
    return `${aed(value)} <span class="pill warm" title="${esc(str(note)
      || 'Derived from a holding rate recorded as a PLACEHOLDER — a working assumption, not a figure this dealership has stood behind.')}"><span class="dot"></span>assumed</span>`;
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
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return '<span class="ds-t-tertiary">—</span>';
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


SCREENS.inventory = async (host) => {
  /* `.ds-screen` is the class lib/design-system.css gates its handful of
     upgrades to existing chrome behind. It goes on a wrapper this screen
     appends, and NOT on `#screen`, because lib/nav.js empties `#screen` between
     renders without touching its classes: a class set there would follow the
     operator onto Leads or Money Leaks and restyle a screen nobody converted.
     A wrapper cannot leak — go() removes it with the rest of the subtree. Same
     pattern as screens/leads.js, screens/overview.js, screens/money-leaks.js
     and screens/setup.js. */
  const root = el('div', 'ds-screen');
  host.appendChild(root);

  const provHost = el('div'); provHost.style.marginBottom = '16px'; root.appendChild(provHost);
  provHost.innerHTML = `<div class="card flush">${stateLoading(2)}</div>`;
  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); root.appendChild(strip);
  const body = el('div'); body.style.marginTop = '16px'; root.appendChild(body);
  body.innerHTML = `<div class="card flush">${stateLoading(8)}</div>`;

  const reload = () => go('inventory');

  /* The unfiltered engine output. Every summary figure describes THIS set — the
     whole lot — and never the filtered table below it, so a filter can never
     shrink a total while the total still reads as the dealership's. */
  let all;
  try {
    all = await readSentinel();
  } catch (e) {
    provHost.remove(); strip.remove();
    body.innerHTML = `<div class="card flush">${stateError('the Inventory Profit Sentinel', e, 'sentinel')}
      <div class="ds-cell-sub" style="white-space:normal;padding:0 20px 20px">Nothing on this screen is derived in the browser, so with the engine unreadable there is no partial view to fall back to. That is deliberate: a lot summary assembled from whatever happened to load is the failure this screen was rebuilt to end.</div></div>`;
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

  /* Only reached when the engine returned nothing at all — with units on the
     lot every setting below comes off the rows themselves. */
  const fallbackSettings = rows.length ? null : await holdingSettings();

  if (!rows.length) {
    strip.remove();
    provHost.innerHTML = '';
    const why = fallbackSettings && fallbackSettings.state === 'UNREADABLE'
      ? ` The configuration row could not be read either, so this screen cannot even say whether a holding rate is on record: ${str(fallbackSettings.why)}`
      : '';
    body.innerHTML = `<div class="card flush">
      <div class="card-head"><div><div class="card-title">Profit Sentinel</div>
        <div class="card-sub">The engine returned no units</div></div><div style="flex:1"></div>
        ${canAddUnit() ? '<button class="btn primary sm" id="invAdd"><span class="material-symbols-outlined">add</span>Add vehicle</button>' : ''}</div>
      ${stateEmpty('No vehicles on the lot',
        'The Sentinel reads one row per unit in inventory. Add the first unit and it will start reporting ageing, margin and a recommendation for it.', 'directions_car')}
      ${why ? `<div class="ds-cell-sub" style="white-space:normal;padding:0 20px 20px">${esc(why)}</div>` : ''}</div>`;
    $('invAdd')?.addEventListener('click', () => unitForm(null, rows, reload));
    return;
  }

  const first = rows[0];
  const cfgDefaults = first.settings_are_defaults === true;
  const rate = n0(first.holding_cost_per_day_aed);
  const basis = up(first.holding_cost_basis);

  /* ── The summary band ──────────────────────────────────────────────────
     Three of these five tiles add something up, and each one carries the count
     it was computed over plus the count it had to leave out. */

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

  /* The engine's own first row among the units that need somebody — the
     function orders `coalesce(overall_risk_rank, 99) desc`, so an UNKNOWN risk
     sorts to the top ahead of SEVERE, and "worst" would have been the wrong
     word for it. This is the top of the list, and it is described as that. */
  const topOfList = actionable[0] || null;

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
  ].join('');

  /* ── Provenance. What the engine could not know, said out loud. ─────────
     Three of these are UNKNOWN on every unit today. Hiding them would make the
     screen look more confident than the data is, which is the one thing an
     owner cannot forgive after they have acted on it. */
  const confWords = [...confCount.entries()];
  /* Already escaped internally — the call site must not escape it a second
     time or an ampersand in a status word comes out as &amp;amp;. */
  const confLine = confWords.length === 1
    ? `Confidence is ${esc(confWords[0][0])} on ${confWords[0][1] === 1 ? 'the one unit' : `all ${num(confWords[0][1])} units`}, and the engine gives a per-unit reason — open any unit to read it.`
    : `Confidence: ${esc(spread(confCount, ['HIGH', 'MEDIUM', 'LOW']))}. The reason is per unit; open a unit to read it.`;

  const noComparable = marketCount.get('UNKNOWN_NO_COMPARABLE') || 0;
  const unverified = marketCount.get('UNKNOWN_UNVERIFIED_COMPARABLE') || 0;
  const stale = marketCount.get('UNKNOWN_STALE_COMPARABLE') || 0;
  const noPrice = marketCount.get('UNKNOWN_NO_PRICE') || 0;
  const positioned = rows.length - noComparable - unverified - stale - noPrice;
  /* The engine writes one enquiry note per unit and it quotes THAT unit's own
     count, so on a lot where one car has two enquiries and eleven have none
     there are two distinct notes saying the same thing about coverage. The
     worst unit's note is shown — it is the one an owner reads first — and the
     fact that the wording varies is stated rather than papered over by
     concatenating near-identical sentences. */
  const enquiryNotes = [...new Set(rows.map(r => str(r.enquiry_note)).filter(Boolean))];

  provHost.innerHTML = `<div class="card flush">
    <div class="card-head"><div>
      <div class="card-title">Profit Sentinel</div>
      <div class="card-sub">${num(rows.length)} ${plural(rows.length, 'unit', 'units')}, worst first, from public.sentinel_inventory_actions() · computed ${esc(dubaiStamp(first.computed_at))}</div>
    </div><div style="flex:1"></div></div>
    <div style="padding:0 20px 18px"><div class="ds-cell-sub" style="white-space:normal">
      <strong>No figure on this screen is derived in the browser.</strong>
      Every band, risk word, recommendation and money figure on a unit is read from
      <span class="mono">The margin review</span>, which is
      <span class="mono">security_invoker</span> — this is your lot and no one else's.
      The only arithmetic done here is in the three summary totals above, each of which
      adds up a column the engine produced and says how many units it had to leave out.
      ${confLine}
      <br><br>
      <strong>Holding cost and net margin.</strong>
      ${rate == null
        ? `No holding rate is on record for this dealership, so the engine reports both as NOT COMPUTABLE on ${num(holdingNC)} of ${num(rows.length)} ${plural(rows.length, 'unit', 'units')} and shows the inputs instead — capital tied up and days on the lot. `
          + 'It is not zero and it is not small; it is not known. Until 2 September this screen filled the gap with AED 50 a day — a rate nobody here ever quoted — and subtracted it from every unit\'s margin. '
          + 'That figure is gone rather than corrected, because it had no source. Record what one day of floor actually costs you, with where the number comes from, and holding cost and net margin appear on every unit on this screen.'
        : basis === 'PLACEHOLDER'
          ? `The holding rate on record is ${aed(rate)} a day and it is recorded as a PLACEHOLDER — a working assumption, not a figure this dealership has stood behind${str(first.holding_cost_set_by) ? `, put there by ${esc(str(first.holding_cost_set_by))}` : ''}${str(first.holding_cost_source) ? ` (${esc(str(first.holding_cost_source))})` : ''}. Every figure derived from it carries an “assumed” mark on the figure itself.`
          : `The holding rate on record is ${aed(rate)} a day${str(first.holding_cost_set_by) ? `, on record from ${esc(str(first.holding_cost_set_by))}` : ''}${str(first.holding_cost_source) ? ` — source: ${esc(str(first.holding_cost_source))}` : ''}${first.holding_cost_verified_at ? `, last confirmed ${esc(dubaiDate(first.holding_cost_verified_at))}` : ''}.`}
      <br><br>
      <strong>${noComparable + unverified + stale + noPrice > 0
        ? `Market position is UNKNOWN on ${num(noComparable + unverified + stale + noPrice)} of ${num(rows.length)} ${plural(rows.length, 'unit', 'units')}.`
        : 'Every unit has a market position against a verified comparable.'}</strong>
      ${noComparable ? `${num(noComparable)} ${plural(noComparable, 'has', 'have')} no competitor row for that exact model. ` : ''}
      ${unverified ? `${num(unverified)} ${plural(unverified, 'has', 'have')} a scraped competitor row that nothing ties to the car — those rows are shown on the unit as evidence, with the scraper's own note, and no position and no price move is derived from them. ` : ''}
      ${stale ? `${num(stale)} ${plural(stale, 'has', 'have')} a comparable older than the ${num(first.market_max_age_days)}-day staleness limit. ` : ''}
      ${noPrice ? `${num(noPrice)} ${plural(noPrice, 'is', 'are')} missing a price on one side of the comparison. ` : ''}
      ${positioned > 0 ? `${num(positioned)} ${plural(positioned, 'unit has', 'units have')} a position against a verified comparable.` : 'Unknown, never an average and never inferred.'}
      <br><br>
      <strong>Demand.</strong> ${esc(spread(demandCount, ['ENQUIRIES_PRESENT', 'NO_ENQUIRIES_IN_WINDOW', 'UNKNOWN_LOW_COVERAGE']))} across the lot.
      ${esc(str(first.enquiry_note))}${enquiryNotes.length > 1
        ? ' Each unit\'s own note quotes its own enquiry count, so the wording differs slightly per unit — open a unit to read its own.'
        : ''}
      <br><br>
      <strong>Who acts.</strong> ${esc(str((rows.find(r => up(r.suggested_owner_state) === 'ROLE_ONLY')
        || rows.find(r => str(r.suggested_owner_note))
        || {}).suggested_owner_note)
        || 'The engine attached no owner note to any unit on this lot.')}
      ${recErr ? `<br><br><strong>One read failed.</strong> inventory.ai_recommendation could not be loaded (${esc(recErr)}), so the pricing workflow's own note is missing from every unit below and the Edit form would blank it on save. Editing is disabled until that read succeeds.` : ''}
    </div></div></div>`;

  /* ── Table and filters ────────────────────────────────────────────────
     Both filters are the ENGINE's filters: they are passed to
     sentinel_inventory_actions() and the rows come back re-ranked by it. That
     matters for the risk floor in particular, whose rule — a unit whose risk is
     UNKNOWN is never removed by a minimum, because unknown is not low — lives
     in the function body and would have to be duplicated here otherwise.
     Only the search box filters in the browser, and it matches text, not
     verdicts. */
  /* Two independent reasons this screen may not open the edit form, and they
     are different sentences to the person reading it:

       recErr        the ai_recommendation column did not load, so saving would
                     blank it — a data problem, fixed by reloading;
       canEditUnit() this account is not owner, admin or manager at this
                     dealership — an authority problem, and no reload fixes it.

     rbac_02's inventory_role_update policy refuses the write either way. This
     only decides whether the product offers a button that is going to fail.
     canEditUnit() returns true when the membership read itself failed, so an
     unknown answer still shows the button and lets the database reply. */
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

  const f = { rec: '', risk: '', q: '' };
  /* The last set the ENGINE returned, before the search box narrows it. Typing
     in the search box must re-filter that set, not the set the previous
     keystroke left behind — otherwise deleting a character never brings a row
     back, because the rows to bring back are no longer in the array being
     filtered. */
  let engineRows = rows;

  const card = el('div', 'card flush');
  card.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="segRec" role="group" aria-label="Filter by recommendation">
        <button data-v="" title="Every unit the engine reported">All · ${num(rows.length)}</button>
        ${recWords.map(w => `<button data-v="${esc(w)}" title="${esc(`Units the engine recommends ${w} for`)}">${esc(w)} · ${num(recCount.get(w))}</button>`).join('')}
      </div>
      <div class="grow"><input type="search" id="invQ" aria-label="Search stock"
        placeholder="Search model, stock number or VIN" /></div>
      <select id="invRisk" aria-label="Minimum overall risk" style="width:auto"
        title="Passed to the engine as p_min_risk_rank. A unit whose risk is UNKNOWN is never removed by this floor — unknown is not low, so it stays visible for a person to look at.">
        ${RISK_FLOORS.map(r => `<option value="${r.v}">${esc(r.label)}</option>`).join('')}
      </select>
      <div class="ds-t-tertiary num" id="invCount"></div>
      ${canAddUnit() ? '<button class="btn primary sm" id="invAdd"><span class="material-symbols-outlined">add</span>Add vehicle</button>' : ''}
    </div>
    <div id="invTable"></div>`;
  body.innerHTML = '';
  body.appendChild(card);

  const cols = [
    {
      label: 'Unit', strong: true, render: r => `<span class="mono">${esc(str(r.id))}</span>`
        + (str(r.vin) ? `<div class="ds-cell-sub mono">${esc(str(r.vin))}</div>` : '<div class="ds-cell-sub">No VIN on record</div>'),
    },
    {
      label: 'Model', render: r => `${esc(str(r.model) || 'Unnamed unit')}`
        + `<div class="ds-cell-sub">${esc(str(r.status) || 'no status')}</div>`,
    },
    {
      label: 'Days', align: 'r', render: (r) => {
        const d = n0(r.days_in_stock);
        if (d == null) {
          return `<span class="ds-t-tertiary" title="${esc('No acquisition date on record, so the engine cannot count days for this unit and does not band it. It is not a new car; it is an undated one.')}">Undated</span>`;
        }
        const toCrit = n0(r.days_to_critical);
        return `<div>${num(d)}</div><div class="ds-cell-sub">${toCrit == null ? '' : toCrit > 0
          ? `${num(toCrit)} to critical` : 'past critical'}</div>`;
      },
    },
    {
      label: 'Band', render: (r) => {
        const b = up(r.aging_band);
        if (!b) return `<span class="ds-t-tertiary" title="${esc('The engine did not band this unit — there is no day count to band it by.')}">Not banded</span>`;
        return `<span title="${esc(`Warning at ${num(r.warn_days)} days, critical at ${num(r.crit_days)}.`)}">${pill(b, tone(b), { verbatim: true })}</span>`;
      },
    },
    { label: 'Cost', align: 'r', render: r => aed(r.cost_aed) },
    { label: 'Price', align: 'r', render: r => aed(r.price_aed) },
    {
      label: 'Gross margin', align: 'r', render: (r) => {
        const g = n0(r.gross_margin_aed);
        return `<span class="${g != null && g < 0 ? 'ds-t-danger' : ''}">${aed(r.gross_margin_aed)}</span>`;
      },
    },
    { label: 'Margin %', align: 'r', render: r => marginPct(r.gross_margin_pct) },
    {
      label: 'Overall risk', render: (r) => {
        const w = up(r.overall_risk);
        if (!w) return `<span class="ds-t-tertiary">Not rated</span>`;
        return `<span title="${esc(str(r.risk_basis))}">${pill(w, riskTone(w), { verbatim: true })}</span>`;
      },
    },
    {
      label: 'Recommendation', render: (r) => {
        const w = up(r.recommendation);
        if (!w) return `<span class="ds-t-tertiary">None</span>`;
        return `<span title="${esc(str(r.reason))}">${pill(w, recTone(w), { verbatim: true })}</span>`
          + (r.human_approval_required === true
            ? '<div class="ds-cell-sub">approval required</div>' : '');
      },
    },
  ];

  function paintTable(list, err) {
    const th = $('invTable');
    if (!err) engineRows = list;
    const q = f.q.trim().toLowerCase();
    const view = q
      ? list.filter(r => [r.id, r.model, r.vin].map(v => str(v).toLowerCase()).join(' ').includes(q))
      : list;
    $('invCount').textContent = `${view.length} of ${rows.length} units`;
    if (err) {
      th.innerHTML = `${stateError('that view of the Sentinel', err, 'filter')}
        <div class="ds-cell-sub" style="white-space:normal;padding:0 20px 24px">The filter is applied by the engine, not here, so a failed filter leaves no rows to show rather than a guess at which ones would have matched.</div>`;
      th.querySelector('[data-retry]')?.addEventListener('click', refilter);
      return;
    }
    th.innerHTML = table(cols, view, {
      onRow: true,
      empty: `${stateEmpty('No unit matches',
        f.q ? 'No unit on the lot matches that search within the current filter.'
          : 'The engine returned no unit under this filter. That is an answer about the lot, not an error.', 'search_off')}
        <div style="text-align:center;padding:0 20px 32px"><button class="btn" id="invClear">Clear filters</button></div>`,
    });
    wireRows(th, view, drawer);
    $('invClear')?.addEventListener('click', () => {
      f.rec = ''; f.risk = ''; f.q = '';
      $('invQ').value = ''; $('invRisk').value = '';
      card.querySelectorAll('#segRec button').forEach(b => b.classList.toggle('on', b.dataset.v === ''));
      refilter();
    });
  }

  async function refilter() {
    card.querySelectorAll('#segRec button').forEach(b => b.classList.toggle('on', b.dataset.v === f.rec));
    /* No filter, no round trip: the unfiltered set is already in memory and is
       the same rows in the same engine order. */
    if (!f.rec && !f.risk) { paintTable(rows, null); return; }
    $('invTable').innerHTML = stateLoading(5);
    try {
      const got = await readSentinel(f.rec || null, f.risk === '' ? null : Number(f.risk));
      paintTable(withRec(Array.isArray(got) ? got : []), null);
    } catch (e) {
      paintTable([], e);
    }
  }

  /* ── One unit, in the order an owner asks the questions ────────────────
     What is wrong · why · the evidence · what to do · who does it · does it
     need approval. Every line is a column on the row; nothing here is inferred
     from a combination of them. */
  function drawer(r) {
    const holdState = up(r.holding_cost_state);
    const netState = up(r.net_margin_state);
    const inputs = holdingInputs(r);
    const evidence = Array.isArray(r.evidence) ? r.evidence : [];
    const noAction = up(r.suggested_owner_state) === 'NO_ACTION';
    const marketUnknown = up(r.market_position).startsWith('UNKNOWN');

    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1"><h2 style="font-size:18px">${esc(str(r.model) || 'Unnamed unit')}</h2>
          <div class="ds-cell-sub mono">${esc(str(r.id))}${str(r.vin) ? ' · ' + esc(str(r.vin)) : ''}</div></div>
        <button class="btn ghost sm" id="dClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        <div class="section" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${str(r.status) ? `<span class="chip">${esc(str(r.status))}</span>` : ''}
          ${up(r.aging_band) ? pill(up(r.aging_band), tone(r.aging_band), { verbatim: true }) : '<span class="chip">Not banded</span>'}
          ${up(r.overall_risk) ? pill(up(r.overall_risk), riskTone(r.overall_risk), { verbatim: true }) : ''}
          ${up(r.recommendation) ? pill(up(r.recommendation), recTone(r.recommendation), { verbatim: true }) : ''}
          <span class="chip">${n0(r.days_in_stock) == null ? 'No acquisition date' : `${num(r.days_in_stock)} days in stock`}</span>
        </div>

        <div class="section">
          <div class="label-caps">${noAction ? 'Nothing is wrong with this unit' : 'What is wrong'}</div>
          <div class="quote" style="margin-top:8px">${esc(str(r.reason) || 'The engine gave no reason for this unit.')}</div>
          <div class="ds-cell-sub" style="white-space:normal;margin-top:8px">${esc(str(r.risk_basis))}</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Age risk</dt><dd>${up(r.age_risk) ? pill(up(r.age_risk), riskTone(r.age_risk), { verbatim: true }) : '<span class="ds-t-tertiary">not rated</span>'}</dd>
            <dt>Margin risk</dt><dd>${up(r.margin_risk) ? pill(up(r.margin_risk), riskTone(r.margin_risk), { verbatim: true }) : '<span class="ds-t-tertiary">not rated</span>'}</dd>
            <dt>Days to warning</dt><dd class="num">${n0(r.days_to_warning) == null ? '<span class="ds-t-tertiary">no day count</span>' : n0(r.days_to_warning) === 0 ? 'past it' : num(r.days_to_warning)}</dd>
            <dt>Days to critical</dt><dd class="num">${n0(r.days_to_critical) == null ? '<span class="ds-t-tertiary">no day count</span>' : n0(r.days_to_critical) === 0 ? 'past it' : num(r.days_to_critical)}</dd>
          </dl>
        </div>

        <div class="section">
          <div class="label-caps">What to do</div>
          <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${up(r.recommendation) ? pill(up(r.recommendation), recTone(r.recommendation), { verbatim: true }) : '<span class="chip">No recommendation</span>'}
            ${r.human_approval_required === true
              ? '<span class="pill warm" title="The engine will not let this be actioned without a person approving it."><span class="dot"></span>approval required</span>'
              : '<span class="chip" title="The engine does not require a person to approve anything for this unit.">no approval needed</span>'}
            <span class="chip" title="${esc('Whether NEXUS may execute this on its own. MANUAL_ONLY means a person does it; NONE_NEEDED means there is nothing to execute.')}">${esc(str(r.automation_state) || 'automation state not stated')}</span>
          </div>
          <dl class="kv" style="margin-top:10px">
            <dt>Who</dt><dd>${noAction
              ? `<span class="ds-t-tertiary">${esc(str(r.suggested_owner_note) || 'No action, so no owner.')}</span>`
              : `${esc(str(r.suggested_owner_role) || 'not stated')}<div class="ds-cell-sub" style="white-space:normal">${esc(str(r.suggested_owner_note))}</div>`}</dd>
            <dt>Impact</dt><dd class="num">${
              up(r.impact_kind) === 'MARGIN_EXPOSED' && n0(r.impact_aed) != null
                ? `${aed(r.impact_aed)}<div class="ds-cell-sub">${esc(impactWord(r.impact_kind))}</div>`
                : `<span class="ds-t-tertiary">${esc(impactWord(r.impact_kind))}</span>`}</dd>
          </dl>
          <div class="ds-cell-sub" style="white-space:normal;margin-top:8px">${esc(str(r.impact_basis))}</div>
        </div>

        <div class="section">
          <div class="label-caps">How sure the engine is</div>
          <div style="margin-top:8px">${up(r.confidence)
            ? pill(up(r.confidence), tone(r.confidence), { verbatim: true })
            : '<span class="chip">not stated</span>'}</div>
          <div class="ds-cell-sub" style="white-space:normal;margin-top:8px">${esc(str(r.confidence_basis))}</div>
        </div>

        <div class="section">
          <div class="label-caps">Money</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Cost</dt><dd class="num">${aed(r.cost_aed)}</dd>
            <dt>List price</dt><dd class="num">${aed(r.price_aed)}</dd>
            <dt>Gross margin</dt><dd class="num"><strong class="${n0(r.gross_margin_aed) != null && n0(r.gross_margin_aed) < 0 ? 'ds-t-danger' : ''}">${aed(r.gross_margin_aed)}</strong> <span class="ds-t-tertiary">${marginPct(r.gross_margin_pct)}</span></dd>
            <dt>Capital tied up</dt><dd class="num">${aed(r.capital_tied_aed)}</dd>
            <dt>Holding cost</dt><dd class="num">${stateFigure(holdState, r.holding_cost_accrued_aed, r.holding_cost_note, holdState === 'NOT_COMPUTABLE' ? inputs : '')}</dd>
            <dt>Net margin</dt><dd class="num">${stateFigure(netState, r.net_margin_aed, r.net_margin_note, netState === 'NOT_COMPUTABLE' ? inputs : '')}</dd>
          </dl>
          ${holdState === 'PLACEHOLDER'
            ? `<div class="banner warm" style="margin-top:10px"><span class="material-symbols-outlined">warning</span>
               <div>The holding rate behind those two figures is recorded as a PLACEHOLDER, not as a rate this dealership supplied. They are assumptions and are marked as such wherever they appear.${str(r.holding_cost_note) ? ` ${esc(str(r.holding_cost_note))}` : ''}</div></div>`
            : ''}
        </div>

        <div class="section">
          <div class="label-caps">Market</div>
          <div style="margin-top:8px">${str(r.market_position)
            ? pill(up(r.market_position), marketUnknown ? 'unknown' : tone(r.market_position), { verbatim: true })
            : '<span class="chip">not stated</span>'}</div>
          ${str(r.market_competitor) ? `<dl class="kv" style="margin-top:8px">
            <dt>Competitor</dt><dd>${esc(str(r.market_competitor))}</dd>
            <dt>Their price</dt><dd class="num">${aed(r.market_price_aed)}</dd>
            <dt>Match quality</dt><dd>${str(r.market_match_quality) ? esc(str(r.market_match_quality)) : '<span class="ds-t-tertiary">not recorded</span>'}</dd>
            <dt>Scraped</dt><dd>${esc(dubaiStamp(r.market_scraped_at))}</dd>
          </dl>` : ''}
          <div class="ds-cell-sub" style="white-space:normal;margin-top:8px">${esc(str(r.market_note))}</div>
        </div>

        <div class="section">
          <div class="label-caps">Demand</div>
          <div style="margin-top:8px">${str(r.demand_signal)
            ? pill(up(r.demand_signal), up(r.demand_signal).startsWith('UNKNOWN') ? 'unknown' : 'cold', { verbatim: true })
            : '<span class="chip">not stated</span>'}</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Enquiries in ${num(r.enquiry_window_days)} days</dt><dd class="num">${num(r.enquiries_in_window)}</dd>
            <dt>From leads · messages</dt><dd class="num">${num(r.enquiry_leads)} · ${num(r.enquiry_messages)}</dd>
            <dt>Last enquiry</dt><dd>${r.enquiry_last_at ? esc(dubaiStamp(r.enquiry_last_at)) : '<span class="ds-t-tertiary">none in the window</span>'}</dd>
            <dt>Coverage</dt><dd>${esc(str(r.enquiry_coverage) || 'not stated')}</dd>
          </dl>
          <div class="ds-cell-sub" style="white-space:normal;margin-top:8px">${esc(str(r.enquiry_note))}</div>
        </div>

        <div class="section">
          <div class="label-caps">Evidence · ${num(evidence.length)}</div>
          ${evidence.length
            ? evidence.map(x => `<div class="ds-cell-sub" style="white-space:normal;margin-top:8px">
                <strong>${esc(str(x && x.fact))}</strong><br>${esc(str(x && x.source))}</div>`).join('')
            : '<div class="ds-cell-sub" style="white-space:normal;margin-top:8px">The engine attached no evidence to this unit. A leak with no evidence is not displayed, so there is nothing to act on here.</div>'}
        </div>

        <div class="section">
          <div class="label-caps">The thresholds this verdict was measured against</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Warning · critical</dt><dd class="num">${num(r.warn_days)} · ${num(r.crit_days)} days</dd>
            <dt>Promote · wholesale</dt><dd class="num">${num(r.promote_days)} · ${num(r.wholesale_days)} days</dd>
            <dt>Reprice margin floor</dt><dd class="num">${esc(str(r.min_margin_pct))}%</dd>
            <dt>Market tolerance</dt><dd class="num">${esc(str(r.tol_pct))}%</dd>
            <dt>Enquiry floor · model words</dt><dd class="num">${num(r.min_enq_sources)} · ${num(r.min_model_token_overlap)}</dd>
            <dt>Comparable goes stale after</dt><dd class="num">${num(r.market_max_age_days)} days</dd>
          </dl>
          <div class="ds-cell-sub" style="white-space:normal;margin-top:8px">${r.settings_are_defaults === true
            ? 'These are the engine’s built-in defaults. No configuration row exists for this dealership yet, so nothing here has been agreed with them.'
            : 'These come from this dealership’s own configuration row, not from a constant in this dashboard.'}</div>
        </div>

        <div class="section">
          <div class="label-caps">Pricing workflow note</div>
          <div class="quote" style="margin-top:8px">${recErr
            ? esc(`inventory.ai_recommendation could not be read (${recErr}), so whether the pricing workflow has written anything for this unit is unknown here.`)
            : esc(str(r.ai_recommendation) || 'No recommendation has been written for this unit by the pricing workflow.')}</div>
        </div>
      </div>
      <div class="drawer-foot">
        <button class="btn primary" id="dEdit"${canEdit ? '' : ` disabled title="${esc(!mayEditUnits
            ? 'Changing a vehicle is an owner, admin or manager decision at this dealership. Your account can read the Sentinel but not edit the unit.'
            : 'inventory.ai_recommendation did not load, so saving from here would blank it. Reload the screen before editing.')}"`}>Edit</button>
        <button class="btn" id="dComp" title="${esc('The Competitors screen holds the scraped listings behind the market section above.')}">Open Competitors</button>
      </div>`);
    $('dClose').addEventListener('click', closeDrawer);
    $('dComp').addEventListener('click', () => { closeDrawer(); go('competitors'); });
    $('dEdit').addEventListener('click', () => {
      if (!canEdit) return;
      closeDrawer(); unitForm(r, rows, reload);
    });
  }

  card.querySelectorAll('#segRec button').forEach(b =>
    b.addEventListener('click', () => { f.rec = b.dataset.v; refilter(); }));
  $('invRisk').addEventListener('change', (e) => { f.risk = e.target.value; refilter(); });
  $('invQ').addEventListener('input', (e) => { f.q = e.target.value; paintTable(engineRows, null); });
  $('invAdd')?.addEventListener('click', () => unitForm(null, rows, reload));

  refilter();
};
