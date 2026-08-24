/* NEXUS OS — screens/inventory.js
   Split out of the original monolithic app.js on 17 Aug 2026, then reworked on
   19 Aug 2026 into a lot-management view: filter by status and ageing alert,
   sort by days in stock and by margin, and totals that describe the rows
   actually on screen rather than the whole table.

   The write path is untouched. Create, edit and delete all still go through
   unitForm() in lib/unit-form.js — it is the only writer in the product and
   this screen only ever calls it and reloads.

   24 Aug 2026: gained an alert strip. It merges what Postgres already says
   about this screen (`v_needs_attention?screen=eq.inventory`) with the checks
   the view has no branch for, all derived from the stock rows this screen had
   to fetch anyway. Every alert lands on the rows it is about, and every count
   in the strip says which read it came from — a strip that quietly drops the
   half it could not load is worse than no strip.

   Written against the probed column list in SCHEMA.md's CORRECTION section, not
   the stale table above it: `inventory` is id, model, vin, status, acquired_at,
   cost_aed, price_aed and the derived columns. `id` IS the stock number
   ("NX-1010"), which is why v_needs_attention.ref matches it directly, and
   there is no sold_at anywhere on the table — see the sale-date note below.

   24 Aug 2026, evening. Twelve units, all of them the dealership's real stock:
   this is the largest genuine dataset in the product and the one screen whose
   totals are worth trusting, so it states that plainly instead of hedging like
   the screens that hold a single row. Three things changed with the cleanup:

     · Every unit reads `status = 'Available'` and not one is marked Sold, while
       `purchase_history` holds a completed sale. That contradiction belongs on
       the screen that owns stock status, because an unsold-on-paper car is still
       in the stock value, still quotable, still accruing holding cost and can be
       sold twice. `unmarked_sale` says it, and says how weak the link is.
     · The provenance of every ageing figure is now stated under the toolbar.
       This screen recomputes live from `acquired_at`; Overview reads the stored
       nightly columns and does not import deriveUnit(). The two can legitimately
       print different counts for the same lot, and a reader who is not told
       which one they are looking at cannot tell staleness from error.
     · The drawer's competitor comparison leads to an empty table now, so it is
       read once and disabled with the reason rather than promising a comparison
       that no longer exists. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, esc, n0, num, pill, tone } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, table, wireRows } from '../lib/ui.js';
import { INV, deriveUnit, unitForm } from '../lib/unit-form.js';

const low = s => String(s == null ? '' : s).toLowerCase();
const up = s => String(s == null ? '' : s).toUpperCase();
const isSold = u => low(u.status) === 'sold';

/* A unit with neither a list price nor a cost has no margin — it has a missing
   record. deriveUnit() has to return a number for those columns, so it returns
   zero; showing "AED 0" would read as a break-even car. They render as "—" and
   sort to the bottom of both margin orders instead. */
const priced = u => n0(u.price_aed) != null || n0(u.cost_aed) != null;

const ALERTS = ['CRITICAL', 'WARNING', 'HEALTHY'];
/* Was a private map `{ CRITICAL:'hot', WARNING:'warm', HEALTHY:'ok' }`. Its three
   values agreed with lib/format.js `tone()`, so it never rendered anything wrong
   — but it was the fifth copy of that table in this app, and the other four had
   drifted apart (DEGRADED was red on three screens and amber in the shared table
   until 24 Aug). A duplicate that happens to agree today is a disagreement
   waiting for the next edit, so the call sites go straight to `tone()`. */
const ALERT_WHY = {
  CRITICAL: `${INV.CRITICAL_DAYS} days or more on the lot`,
  WARNING: `${INV.WARN_DAYS}–${INV.CRITICAL_DAYS - 1} days on the lot`,
  HEALTHY: `under ${INV.WARN_DAYS} days on the lot, or already sold`,
};

const SORTS = {
  days_desc: 'Longest in stock',
  days_asc: 'Newest in stock',
  margin_asc: 'Worst net margin',
  margin_desc: 'Best net margin',
  holding_desc: 'Highest holding cost',
};

/* Sums the rows that actually carry the figure and reports how many did. A
   total over four of nine rows is a different fact from a total over nine. */
function sum(rows, pick) {
  let total = 0, n = 0;
  for (const r of rows) { const v = n0(pick(r)); if (v != null) { total += v; n += 1; } }
  return { total: n ? total : null, n, of: rows.length };
}

/* ── Alerts ───────────────────────────────────────────────────────────────
   Two sources, deliberately kept apart.

   `v_needs_attention` is what the database itself says about this screen —
   today an `inventory_aging` branch whose `ref` is the stock number. It is read
   in the same Promise.all as the stock, so the strip costs no extra round-trip.

   Everything else is derived from rows already in memory and covers the faults
   the view has no branch for: a unit listed under its cost, a unit with no list
   price at all, a missing VIN, and the stored aging columns disagreeing with
   what deriveUnit() computes live.

   Ageing itself is deliberately NOT re-derived here. The view's own branch, the
   banner under the toolbar and the Ageing-alerts KPI already carry it; a fourth
   copy of one fact is how four numbers for it end up on one screen disagreeing. */

const INV_LIMIT = 1000;
const ATTN_LIMIT = 100;

/* How far the stored columns may lag before they are called wrong. They are
   recomputed nightly, so a row is legitimately a day stale for most of the
   working day; two days means a run was missed. Holding cost is days × the
   daily rate, so the same tolerance converts straight into money, and net
   margin moves with holding cost. */
const DRIFT_DAYS = 2;
const DRIFT_AED = DRIFT_DAYS * INV.HOLDING_PER_DAY;
const SHOWN_REFS = 4;

const str = v => String(v == null ? '' : v).trim();
const plural = (n, one, many) => (Number(n) === 1 ? one : many);

/* Dates that are days, not moments. purchase_date is a calendar date; parsing it
   bare makes it UTC midnight, which in Dubai is still the same day but is one
   timezone change away from not being. Anchoring it to local midnight the way
   deriveUnit() anchors acquired_at keeps the two comparable. */
const dateLabel = d => {
  const v = str(d);
  if (!v) return 'a date the record does not carry';
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T00:00:00' : v);
  return Number.isNaN(t.getTime()) ? v
    : t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/* ── Sales that this table does not know about ────────────────────────────
   `purchase_history` has no reference to a stock number and `inventory` has no
   sale date, so the only bridge between a completed sale and a unit is the
   sale's free-text `vehicle` against the unit's free-text `model`. That is a
   guess and every sentence built on it has to say so — which is also why the
   match is never used to change a status, only to name the units worth looking
   at. Two shared words is the floor: "2024" alone, or "Toyota" alone, matches
   half a lot. */
const SALE_NOISE = new Set(['the', 'a', 'and', 'aed', 'edition', 'model', 'used', 'new', 'car', 'suv']);
const words = v => str(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  .split(' ').filter(w => w && !SALE_NOISE.has(w));

function saleCandidates(sale, inv) {
  const want = words(sale && sale.vehicle);
  if (want.length < 2) return [];
  const scored = inv.map(u => {
    const have = new Set(words(u.model));
    return { u, hit: want.filter(w => have.has(w)).length };
  }).filter(x => x.hit >= 2);
  if (!scored.length) return [];
  /* Ties are kept rather than broken. Two Land Cruisers that match a sale
     equally well are two units to check, and picking one of them by row order
     would be inventing the very link the database does not hold. */
  const best = Math.max(...scored.map(x => x.hit));
  return scored.filter(x => x.hit === best).map(x => x.u);
}

/* A sale is accounted for when some unit that could be it is marked Sold.
   Everything else is a sale this table cannot show. */
function reconcileSales(inv, sales) {
  if (!sales) return null;
  const byUnit = new Map();
  const unreconciled = [];
  for (const sale of sales) {
    const cands = saleCandidates(sale, inv);
    for (const u of cands) {
      const k = String(u.id);
      if (!byUnit.has(k)) byUnit.set(k, []);
      byUnit.get(k).push(sale);
    }
    if (!cands.some(isSold)) unreconciled.push({ sale, candidates: cands.filter(u => !isSold(u)) });
  }
  return { unreconciled, byUnit, total: sales.length };
}

/* PostgREST returns every selected column on every row, nulls included, so a
   key absent from the payload is a column absent from the table — not a row
   that happens to be empty. That difference decides whether "no unit has a VIN"
   is forty alerts or one sentence saying the check could not run. */
const columnsOf = rows => {
  const s = new Set();
  (rows || []).forEach(r => Object.keys(r || {}).forEach(k => s.add(k)));
  return s;
};

/* v_needs_attention.severity is HOT | WARM | COLD and the derived alerts below
   use CRITICAL | WARNING | LOW. lib/format.js now colours all of them and sends
   anything it does not recognise to 'cold' rather than to an unstyled pill that
   would read as "fine", so this screen keeps no severity map of its own. */
const sevRank = s => ({ hot: 0, warm: 1, cold: 2, ok: 3 }[tone(s)] ?? 2);

/* The stored column says OK where deriveUnit() says HEALTHY: the same band
   under two names. Normalising before any comparison stops every healthy unit
   reading as a disagreement — and, the way that actually bites, stops a real
   OK-stored / CRITICAL-live flip being dropped as an unrecognised word. */
const band = v => (up(v) === 'OK' ? 'HEALTHY' : up(v));
const KIND_ICON = { inventory_aging:'directions_car', undercut:'trending_down' };

/* Derives every inventory-specific alert from rows already fetched. Returns the
   alerts and, separately, the sentences that qualify them — a check that could
   not run is not the same as a check that passed, and only the second one is
   allowed to leave the strip silent. */
function deriveAlerts(inv, raw, recon, salesErr) {
  const notes = [];
  if ((raw || []).length >= INV_LIMIT) {
    notes.push(`The stock read was capped at ${num(INV_LIMIT)} rows, oldest first, so every alert below describes the oldest ${num(INV_LIMIT)} units and there may be more behind them.`);
  }
  if (!inv.length) {
    notes.push('No unit is on the lot, so the checks this screen derives had nothing to run against.');
    if (recon && recon.total) {
      notes.push(`purchase_history still records ${num(recon.total)} completed ${plural(recon.total, 'sale', 'sales')}, which cannot be tied to anything while this table is empty — a purchase carries no stock number and inventory carries no sale date.`);
    }
    return { alerts: [], notes };
  }

  const cols = columnsOf(raw);
  const has = c => cols.has(c);
  const alerts = [];
  const add = (key, severity, icon, title, detail, units, opts = {}) => {
    const dates = (units || []).map(u => str(u.acquired_at)).filter(Boolean).sort();
    alerts.push({
      key, severity, icon, title, detail, noFocus: opts.noFocus,
      ids: (units || []).map(u => u.id),
      /* Most of these conditions carry no timestamp of their own — nothing
         records when a VIN went missing. The oldest acquisition date in the
         group is the closest true thing, and the tooltip says that is what it is
         rather than letting it read as "waiting since". An alert built on a row
         that IS dated — a sale has a purchase date — passes its own instead,
         because dating it by a unit it was only guessed onto would be worse than
         showing nothing. */
      at: opts.at || (dates.length ? `${dates[0]}T00:00:00` : null),
      atNote: opts.at ? (opts.atNote || '')
        : dates.length
          ? 'Acquisition date of the oldest unit in this alert. The condition itself carries no timestamp, so this is how long the record has existed, not how long it has been wrong.'
          : 'This condition carries no timestamp of its own, and no unit in it has an acquisition date.',
    });
  };
  const refList = units => {
    const names = units.slice(0, SHOWN_REFS).map(u => str(u.id) || 'unnamed unit');
    const more = units.length - names.length;
    return names.join(', ') + (more > 0 ? ` and ${num(more)} more` : '');
  };

  /* price_aed and cost_aed, probed live — deriveUnit() was reading the right
     columns all along and it was SCHEMA.md's older table that was stale. No
     fallback to list_price_aed / cost_price_aed: those names do not exist on
     this table, so a guard for them would be a branch that can never run. The
     block below is only there to keep the two predicates out of the rest of
     this function. */
  {
    const money = u => ({ price: n0(u.price_aed), cost: n0(u.cost_aed) });
    const under = u => { const { price, cost } = money(u); return price != null && cost != null && price > 0 && price < cost; };

    const belowCost = inv.filter(u => !isSold(u) && under(u));
    if (belowCost.length) {
      const shortfall = belowCost.reduce((t, u) => t + (n0(u.cost_aed) - n0(u.price_aed)), 0);
      const soldUnder = inv.filter(u => isSold(u) && under(u)).length;
      add('below_cost', 'CRITICAL', 'trending_down',
        `${num(belowCost.length)} unsold ${plural(belowCost.length, 'unit is', 'units are')} listed below cost`,
        `${refList(belowCost)}. Selling at the current ask gives up ${aed(shortfall)} against what ${plural(belowCost.length, 'it', 'they')} cost, before a single day of holding is counted`
        + (soldUnder ? `. ${num(soldUnder)} already-sold ${plural(soldUnder, 'unit', 'units')} also closed below cost — that is history and is not counted here` : '') + '.',
        belowCost);
    }

    const noPrice = inv.filter(u => !isSold(u) && (n0(u.price_aed) == null || n0(u.price_aed) === 0));
    if (noPrice.length) {
      const zeros = noPrice.filter(u => n0(u.price_aed) === 0).length;
      const blanks = noPrice.length - zeros;
      const withCost = noPrice.filter(u => n0(u.cost_aed) != null).length;
      add('no_price', 'WARNING', 'money_off',
        `${num(noPrice.length)} unsold ${plural(noPrice.length, 'unit has', 'units have')} no list price`,
        `${refList(noPrice)}. `
        + (zeros && blanks ? `${num(zeros)} ${plural(zeros, 'carries', 'carry')} a list price of exactly zero and ${num(blanks)} ${plural(blanks, 'carries', 'carry')} none at all. `
          : zeros ? `The price is stored as exactly zero, which is a value somebody typed, not a blank. ` : '')
        + 'Nothing on the lot can be quoted from a price that is not there'
        + (withCost ? `, and where a cost is on record the Gross margin column reads minus that cost — ${num(withCost)} of ${num(noPrice.length)} here. deriveUnit() treats a missing price as zero, so what reads as a loss is the purchase price` : '') + '.',
        noPrice);
    }
  }

  /* The sale this table does not show.

     Stock status is this screen's subject, so a completed sale with nothing
     marked Sold has to be said here rather than left to whoever reads the deals
     screen. It is not a bookkeeping nicety: a unit that stays Available is
     counted in the stock value above, is quotable, keeps accruing holding cost,
     and can be sold a second time to somebody else. */
  if (salesErr) {
    notes.push(`purchase_history did not load (${salesErr}), so recorded sales could not be checked against stock status — a car that was sold and never marked Sold would not appear anywhere below.`);
  } else if (recon && recon.total && recon.unreconciled.length) {
    const open = recon.unreconciled;
    const cands = [...new Set(open.flatMap(o => o.candidates))];
    const soldUnits = inv.filter(isSold);
    const one = open.length === 1 ? open[0].sale : null;
    const money = one && n0(one.amount_aed) != null ? ` for ${aed(one.amount_aed)}` : '';
    /* Named with the number beside it, or with the absence of one stated —
       purchase_history carries its own phone column, so a blank here is a blank
       record rather than a join this screen chose not to make. */
    const saleDates = open.map(o => str(o.sale.purchase_date)).filter(Boolean).sort();
    const newest = saleDates[saleDates.length - 1];
    const saleAt = !newest ? null
      : /^\d{4}-\d{2}-\d{2}$/.test(newest) ? newest + 'T00:00:00' : newest;
    const who = one && str(one.customer_name)
      ? ` Buyer ${str(one.customer_name)} · ${str(one.phone) || 'no phone on the purchase record'}.`
      : '';
    add('unmarked_sale', cands.length ? 'CRITICAL' : 'WARNING', 'sell',
      `${num(open.length)} recorded ${plural(open.length, 'sale is', 'sales are')} not reflected in stock status`,
      (one
        ? `purchase_history records ${str(one.vehicle) || 'a vehicle'}${money} on ${dateLabel(one.purchase_date)}.`
        : `purchase_history records ${num(open.length)} completed sales.`)
      + (soldUnits.length
        ? ` None of the ${num(soldUnits.length)} ${plural(soldUnits.length, 'unit', 'units')} marked Sold matches ${plural(open.length, 'it', 'them')} by description.`
        : ` Not one of the ${num(inv.length)} units on this table is marked Sold.`)
      + who
      + (cands.length
        ? ` ${refList(cands)} ${plural(cands.length, 'matches that description and is', 'match that description and are')} still on the lot — matched only on the sale's vehicle text against the unit's model, because purchase_history carries no stock number and inventory carries no sale date.`
        : ' No unit on this table matches the description at all.')
      + ' Nothing in the database can settle which it is: whether the car was sold and never marked, or was never a row here.'
      + (cands.length
        ? ` Until one is marked Sold it stays inside the stock value, stays quotable, keeps accruing ${aed(INV.HOLDING_PER_DAY)} a day, and can be sold a second time. Status is editable from the unit itself — inventory is one of the three tables this browser is allowed to write — but marking it Sold records only the status: there is no sale date column, so the day it left the lot will still be unrecorded and its true days on the lot will still not be reconstructable.`
        : ''),
      cands,
      {
        noFocus: 'No unit on this table matches the sale by description, so there is no row here to open.',
        /* The one date in this alert that is a fact: purchase_history records
           when the sale happened. The candidate unit's acquisition date is the
           age of a guess, not of the finding. */
        at: saleAt,
        atNote: open.length === 1 ? 'The date of the recorded sale.'
          : 'The most recent of the recorded sales in this alert.',
      });
  }

  if (has('vin')) {
    const noVin = inv.filter(u => !str(u.vin));
    if (noVin.length) {
      const onLot = noVin.filter(u => !isSold(u)).length;
      const sold = noVin.length - onLot;
      add('no_vin', onLot ? 'WARNING' : 'LOW', 'tag',
        `${num(noVin.length)} ${plural(noVin.length, 'unit has', 'units have')} no VIN on record`,
        `${refList(noVin)}. `
        + (!sold ? `${plural(noVin.length, 'It is', 'All of them are')} still on the lot`
          : !onLot ? `${plural(noVin.length, 'It is', 'All of them are')} already sold`
            : `${num(onLot)} ${plural(onLot, 'is', 'are')} still on the lot and ${num(sold)} ${plural(sold, 'is', 'are')} already sold`)
        + `. The unit form accepts a blank VIN, so ${plural(noVin.length, 'it was', 'these were')} saved rather than rejected — but a car cannot be registered, insured or handed over on a stock number.`,
        noVin);
    }
  } else {
    notes.push('The inventory rows carry no vin column, so units missing a VIN could not be checked.');
  }

  /* Stored versus live. `days_in_stock`, `holding_cost_accrued`, `net_margin`
     and `aging_alert` are written to the table by the nightly job AND computed
     live by deriveUnit(); this screen shows the live figure, while n8n and the
     Finance Desk read the stored one. Where the two disagree, neither is
     "the truth" to quietly prefer — the disagreement is the finding. */
  const storedCols = ['days_in_stock', 'holding_cost_accrued', 'net_margin', 'aging_alert'].filter(has);
  if (!storedCols.length) {
    notes.push('None of the stored aging columns came back with these rows, so the stored figures could not be compared against the live recompute.');
  } else {
    const rawById = new Map((raw || []).map(r => [String(r.id), r]));
    const drift = [];
    for (const u of inv) {
      /* Sold units are excluded by construction, not by choice: deriveUnit()
         hands a sold unit its stored holding cost straight back, so that column
         can never disagree, while its day count keeps running from acquisition
         after the sale. Comparing them would need a rule for what a sold unit's
         day count means, and inventing one here would manufacture alerts. */
      if (isSold(u)) continue;
      const r = rawById.get(String(u.id));
      if (!r) continue;
      const why = [];
      /* Without an acquisition date deriveUnit() falls back to the stored day
         count, so comparing the two would be comparing a number with itself. */
      const dated = !!u.acquired_at;
      if (dated && has('days_in_stock')) {
        const v = n0(r.days_in_stock);
        if (v != null && Math.abs(v - u.days_in_stock) > DRIFT_DAYS) why.push(`days ${num(v)} stored vs ${num(u.days_in_stock)} live`);
      }
      if (dated && has('holding_cost_accrued')) {
        const v = n0(r.holding_cost_accrued);
        if (v != null && Math.abs(v - u.holding_cost_accrued) > DRIFT_AED) why.push(`holding cost ${aed(v)} stored vs ${aed(u.holding_cost_accrued)} live`);
      }
      let flipped = false;
      if (has('aging_alert')) {
        const v = band(r.aging_alert);
        if (ALERTS.includes(v) && v !== band(u.aging_alert)) { flipped = true; why.push(`band ${v} stored vs ${band(u.aging_alert)} live`); }
      }
      if (has('net_margin') && priced(u)) {
        const v = n0(r.net_margin);
        /* Net margin legitimately moves with holding cost, so it is allowed the
           same slack plus a rounding dirham; anything past that is a price or a
           cost that changed after the last nightly run. */
        if (v != null && Math.abs(v - u.net_margin) > DRIFT_AED + 1) why.push(`net margin ${aed(v)} stored vs ${aed(u.net_margin)} live`);
      }
      if (why.length) drift.push({ u, why, flipped });
    }
    if (drift.length) {
      const flips = drift.filter(d => d.flipped).length;
      const shown = drift.slice(0, SHOWN_REFS)
        .map(d => `${str(d.u.id)} (${d.why.join(', ')})`).join('; ');
      const more = drift.length - Math.min(drift.length, SHOWN_REFS);
      add('stored_drift', flips ? 'CRITICAL' : 'WARNING', 'sync_problem',
        `${num(drift.length)} unsold ${plural(drift.length, 'unit disagrees', 'units disagree')} with ${plural(drift.length, 'its', 'their')} stored figures`,
        `${shown}${more > 0 ? `; and ${num(more)} more` : ''}. This screen shows the live recompute; the workflows and the Finance Desk read the stored columns, so the two are acting on different numbers`
        + (flips ? `, and on ${num(flips)} of them the stored ageing band differs from the live one — an aging campaign keyed on the stored column will not fire for ${plural(flips, 'it', 'them')}` : '')
        + `. Anything beyond ${num(DRIFT_DAYS)} days of lag means the nightly recompute has not run, not that the clock moved. Every ageing and margin figure on this screen is the live one; saving a unit from its Edit form writes the same live recompute back to the stored columns, which is what clears this.`,
        drift.map(d => d.u));
    } else if (storedCols.length < 4) {
      notes.push(`Only ${storedCols.join(', ')} came back, so the stored-versus-live comparison covered ${plural(storedCols.length, 'that column', 'those columns')} alone.`);
    }
  }

  /* The sale date, said once rather than as an alert per sold unit. It is not a
     row somebody can go and fix: `inventory` has no sold_at column at all, so
     "when did we sell it" is not a question this table can answer, and
     days_in_stock is no stand-in because deriveUnit() keeps counting it from
     acquisition after the sale. Only worth saying where there are sold units on
     screen for it to be true of. */
  const soldCount = inv.filter(isSold).length;
  if (soldCount) {
    notes.push(`inventory records no sale date — there is no sold_at column — so for the ${num(soldCount)} sold ${plural(soldCount, 'unit', 'units')} here neither the true days on the lot nor the holding cost at the moment of sale is reconstructable, and days_in_stock is not a stand-in because it keeps counting after the sale.`
      + (storedCols.length ? ` ${plural(soldCount, 'It is', 'They are')} also left out of the stored-versus-live comparison: deriveUnit() hands back ${plural(soldCount, 'its', 'their')} stored holding cost unchanged, so it cannot disagree with itself.` : ''));
  }
  alerts.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || b.ids.length - a.ids.length);
  return { alerts, notes };
}

SCREENS.inventory = async host => {
  const attnHost = el('div'); attnHost.style.marginBottom = '16px'; host.appendChild(attnHost);
  attnHost.innerHTML = `<div class="card flush">${stateLoading(2)}</div>`;
  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const body = el('div'); body.style.marginTop = '16px'; host.appendChild(body);
  body.innerHTML = `<div class="card flush">${stateLoading(8)}</div>`;

  /* Both reads leave together; they are awaited apart. The attention read is
     soft — it is an extra opinion about rows this screen already has, so losing
     it degrades the strip and is reported there rather than taking the stock
     table down with it. Awaiting them in one Promise.all would have thrown away
     a perfectly good attention result whenever the stock read failed, which is
     precisely the moment the operator most needs to be told what is wrong. */
  let viewErr = null, salesErr = null;
  const stockRead = db(`inventory?select=*&order=acquired_at.asc&limit=${INV_LIMIT}`);
  const attnRead = db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen'
    + `&screen=eq.inventory&order=at.desc&limit=${ATTN_LIMIT}`)
    .catch(e => { viewErr = e.message; return null; });
  /* Two more soft reads, for the same reason the attention read is soft: neither
     is this screen's subject and neither may take the stock table down with it.

     purchase_history is the only evidence in the database that a car ever left
     the lot — inventory records no sale date — so without it the difference
     between "everything is in stock" and "everything is still marked in stock"
     is invisible. Columns are the probed list: it carries its own phone, so no
     join to leads is needed to show a buyer with their number.

     competitors is read for one fact only: whether the drawer's compare button
     leads anywhere. `limit=1` is enough to tell empty from not, and asking for
     more would be reading a table this screen does not render. */
  const salesRead = db('purchase_history?select=id,customer_name,phone,vehicle,amount_aed,purchase_date'
    + '&order=purchase_date.desc&limit=50')
    .catch(e => { salesErr = e.message; return null; });
  const compRead = db('competitors?select=id&limit=1').catch(() => null);
  let raw = [], viewRows = null;
  try { raw = await stockRead; }
  catch (e) {
    viewRows = await attnRead;
    strip.remove();
    /* The view's rows are still worth showing even when the stock read died —
       they are the database's own list of what needs a human here. They just
       cannot be opened, and paintAttention() says so rather than hiding them. */
    paintAttention(viewRows, viewErr, null, null, null);
    body.innerHTML = `<div class="card">${stateError('inventory', e.message, 'inventory')}</div>`;
    body.querySelector('[data-retry]')?.addEventListener('click', () => go('inventory'));
    return;
  }
  viewRows = await attnRead;
  const sales = await salesRead;
  const compRows = await compRead;

  /* Derived live from acquired_at rather than read off the stored columns, so the
     aging numbers are true on the day you look at them, not on the day they were written. */
  const inv = raw.map(deriveUnit);
  const reload = () => go('inventory');

  /* Sales matched to units by description, once, so the alert strip, the stock
     value caveat and the drawer all speak from the same pairing rather than
     three that could disagree. Null when the read failed — which is not the
     same fact as "no sale is recorded" and is never rendered as one. */
  const recon = reconcileSales(inv, sales);
  const saleSuspect = new Set(recon
    ? recon.unreconciled.flatMap(o => o.candidates).map(u => String(u.id)) : []);
  /* Empty is a fact; unreadable is not. A failed competitors read leaves the
     button enabled rather than disabling it on a guess. */
  const compEmpty = Array.isArray(compRows) && compRows.length === 0;
  const compUnknown = compRows == null;
  const capped = raw.length >= INV_LIMIT;

  /* v_needs_attention.ref is the stock number, and on this table the stock
     number IS `id` (probed: there is no separate stock_id column), so the match
     is direct. Indexed lower-cased anyway, because a ref that differs from the
     row only in case would otherwise silently render as un-openable. */
  const byRef = new Map();
  inv.forEach(u => {
    const k = str(u.id).toLowerCase();
    if (k && !byRef.has(k)) byRef.set(k, u);
  });
  const derived = deriveAlerts(inv, raw, recon, salesErr);

  /* The form suggests the next stock number and rejects a duplicate by reading
     the rows this screen loaded. Under the row cap that list is partial, so both
     can be wrong — the insert would then be refused by the primary key rather
     than by the form, and the operator should hear that from the button and not
     from a raw PostgREST error. Not a hypothetical worth hiding: the suggestion
     is derived from the existing ids, so a partial list can suggest a taken one. */
  const addBtn = (id, cls = 'btn primary sm') => `<button class="${cls}" id="${id}"${
    capped ? ` title="Only the oldest ${num(INV_LIMIT)} units were loaded, so the suggested stock number and the duplicate check are drawn from a partial list. A collision beyond the cap is refused by the database, not by the form."` : ''
  }>
    <span class="material-symbols-outlined">add</span>Add vehicle</button>`;

  if (!inv.length) {
    strip.remove();
    paintAttention(viewRows, viewErr, derived, byRef, 0);
    body.innerHTML = `<div class="card flush">
      <div class="card-head"><div><div class="card-title">Stock</div>
        <div class="card-sub">Nothing on the lot yet</div></div>
        <div style="flex:1"></div>${addBtn('invAdd')}</div>
      ${stateEmpty('No vehicles in stock',
        'Add the first unit to start tracking days in stock, holding cost and margin.', 'directions_car')}</div>`;
    $('invAdd').addEventListener('click', () => unitForm(null, inv, reload));
    return;
  }

  /* Filter vocabularies come from the rows, not from a hardcoded list — a status
     the ERP wrote that nobody here expected must still be selectable. */
  const statuses = [...new Set(inv.map(u => String(u.status || '').trim()).filter(Boolean))]
    .sort((a, b) => {
      const ia = INV.STATUSES.findIndex(s => low(s) === low(a));
      const ib = INV.STATUSES.findIndex(s => low(s) === low(b));
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.localeCompare(b);
    });
  const alertCount = a => inv.filter(u => up(u.aging_alert) === a).length;
  const crit = alertCount('CRITICAL');
  const warn = alertCount('WARNING');

  const f = { status: 'ALL', alert: 'ALL', q: '', sort: 'days_desc', only: null };

  function visible() {
    const q = f.q.trim().toLowerCase();
    return inv.filter(u => {
      /* Set by the alert strip, not by the toolbar, so it has to clear itself:
         see focusUnits() and the bar it paints above the table. */
      if (f.only && !f.only.ids.has(String(u.id))) return false;
      if (f.status !== 'ALL' && low(u.status) !== low(f.status)) return false;
      if (f.alert !== 'ALL' && up(u.aging_alert) !== f.alert) return false;
      if (q && ![u.id, u.model, u.vin].map(low).join(' ').includes(q)) return false;
      return true;
    });
  }

  /* Rows the sort key cannot speak about (no acquisition date, no price at all)
     go to the bottom in stock-number order rather than being ranked as if they
     were the oldest or the least profitable unit on the lot. */
  function sorted(rows) {
    const key = f.sort.startsWith('days') ? (r => n0(r.days_in_stock))
      : f.sort.startsWith('holding') ? (r => n0(r.holding_cost_accrued))
        : (r => (priced(r) ? n0(r.net_margin) : null));
    const dir = f.sort.endsWith('_asc') ? 1 : -1;
    const known = rows.filter(r => key(r) != null).sort((a, b) => dir * (key(a) - key(b)));
    const unknown = rows.filter(r => key(r) == null)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return known.concat(unknown);
  }

  /* Only the three statuses this product defines get a coloured pill. Anything
     else the ERP wrote is shown verbatim as a plain chip — tone() would read
     "HOT" as a hot-lead pill and paint an unknown status red. */
  const statusPill = r => {
    const s = String(r.status || '').trim();
    if (!s) return '<span class="t-muted">—</span>';
    if (isSold(r)) return pill(s, 'ok');
    if (low(s) === 'reserved') return pill(s, 'cold');
    if (low(s) === 'available') return pill(s);   // neutral, as it was
    return `<span class="chip">${esc(s)}</span>`;
  };
  const alertPill = r => {
    const a = up(r.aging_alert);
    return ALERTS.includes(a)
      ? `<span title="${esc(ALERT_WHY[a])}">${pill(a, tone(a))}</span>`
      : '<span class="t-muted">—</span>';
  };
  const marginCell = (r, field) => (priced(r)
    ? `<span class="${(n0(r[field]) || 0) < 0 ? 't-hot' : ''}">${aed(r[field])}</span>`
    : `<span class="t-muted" title="This unit has neither a list price nor a cost on record, so no margin can be derived.">—</span>`);

  const cols = [
    {
      label: 'Vehicle', strong: true, render: r => {
        const a = up(r.aging_alert);
        const flag = a === 'CRITICAL' || a === 'WARNING'
          ? `<span class="material-symbols-outlined t-${tone(a)}" style="font-size:16px;vertical-align:-3px;margin-right:4px"
               title="${esc(a)} — ${esc(ALERT_WHY[a])}" aria-hidden="true">warning</span>` : '';
        return `${flag}${esc(r.model || 'Unnamed unit')}
          <div class="cell-sub mono">${esc(r.id)}${r.vin ? ' · ' + esc(r.vin) : ''}</div>`;
      }
    },
    { label: 'Status', render: statusPill },
    {
      label: 'Days', align: 'r', render: r => {
        const d = n0(r.days_in_stock);
        if (d == null) return '<span class="t-muted" title="No acquisition date on record.">—</span>';
        const t = tone(r.aging_alert) || 'cold';
        const w = Math.max(2, Math.min(100, (d / INV.CRITICAL_DAYS) * 100));
        /* deriveUnit() counts from acquired_at whether or not the unit sold, so a
           sold car keeps ticking. Say so rather than letting it read as lot age. */
        const why = isSold(r)
          ? `${num(d)} days since acquisition — sold, so it no longer accrues holding cost`
          : `${num(d)} of ${INV.CRITICAL_DAYS} days to critical`;
        return `<div class="t-${t}" style="font-weight:500">${num(d)}</div>
                <div class="bar" style="width:56px;margin-left:auto"
                     title="${esc(why)}"><i style="width:${w.toFixed(0)}%;background:var(--${t})"></i></div>`;
      }
    },
    { label: 'Price', align: 'r', render: r => aed(r.price_aed) },
    { label: 'Gross margin', align: 'r', render: r => marginCell(r, 'gross_margin') },
    {
      label: 'Holding cost', align: 'r', render: r => {
        const h = n0(r.holding_cost_accrued);
        if (h == null) return '<span class="t-muted">—</span>';
        const eats = priced(r) && n0(r.gross_margin) != null && h > (n0(r.gross_margin) || 0);
        return `<span class="${eats ? 't-hot' : ''}"${eats ? ' title="Holding cost has overtaken this unit\'s gross margin."' : ''}>${aed(h)}</span>`;
      }
    },
    { label: 'Net margin', align: 'r', strong: true, render: r => marginCell(r, 'net_margin') },
    { label: 'Commission', align: 'r', render: r => (priced(r) ? aed(r.recommended_commission) : '<span class="t-muted">—</span>') },
    { label: 'Alert', render: alertPill },
  ];

  /* ── Which of the two numbers this screen is showing ─────────────────────
     Said once, up front, because it is the difference between a reader trusting
     this screen and a reader trusting Overview. Everything in the table below is
     deriveUnit() run in this browser against `acquired_at`, so it is true today.
     The identically-named columns stored on the row were last written by the
     nightly job, and those are what Overview, the n8n workflows and the Finance
     Desk read. Neither is the truth to quietly prefer; printing both, and saying
     which is which, is what makes the two screens explainable instead of one of
     them looking broken. */
  const storedCount = a => raw.filter(r => band(r.aging_alert) === a).length;
  /* inv is raw.map(deriveUnit) — the same rows in the same order — so pairing by
     index here needs no id lookup and cannot mis-pair. */
  const bandDiff = inv.filter((u, i) => band(raw[i].aging_alert) !== band(u.aging_alert)).length;
  const spread = count => ALERTS.map(a => `${num(count(a))} ${a.toLowerCase()}`).join(' · ');
  const provenance = `<div style="padding:14px 20px 0"><div class="cell-sub" style="white-space:normal">
      <strong>${num(inv.length)} ${plural(inv.length, 'unit', 'units')}, read in full.</strong>
      ${capped
        ? `The read stopped at the ${num(INV_LIMIT)}-row cap, oldest first, so there is stock behind these that no figure here counts.`
        : 'Nothing was capped or sampled, so every count, total and band on this screen describes the whole lot.'}
      Days in stock, holding cost and the ageing band are recomputed in this browser from each unit's acquisition date, which makes them true as of today.
      The same figures stored on the row were last written by the nightly job, and the stored ones are what Overview, the workflows and the Finance Desk read.
      Live today: ${esc(spread(alertCount))}. Stored: ${esc(spread(storedCount))}.
      ${bandDiff
        ? `${num(bandDiff)} ${plural(bandDiff, 'unit sits', 'units sit')} in a different band under the two, and the alert above names ${plural(bandDiff, 'it', 'them')}. Neither is wrong — this screen counts today, the stored column counts the last nightly run.`
        : 'The two agree on every unit today, so this screen and Overview are counting the same lot the same way.'}
    </div></div>`;

  /* ── Chrome. Everything below the toolbar is repainted by draw(). ───────── */
  const banner = crit || warn ? `<div class="banner ${crit ? 'hot' : 'warm'}" style="margin:14px 20px 0">
      <span class="material-symbols-outlined">warning</span>
      <div style="flex:1">${crit ? `${num(crit)} unit${crit === 1 ? '' : 's'} past ${INV.CRITICAL_DAYS} days` : ''}${crit && warn ? ' · ' : ''}${warn ? `${num(warn)} past ${INV.WARN_DAYS} days` : ''}
        — each one accrues ${aed(INV.HOLDING_PER_DAY)} a day against its margin.</div>
      <button class="btn sm" id="invFocus">Show ${crit ? 'critical' : 'warning'} only</button>
    </div>` : '';

  const card = el('div', 'card flush');
  card.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="segAlert" role="group" aria-label="Filter by ageing alert">
        ${[['ALL', inv.length], ...ALERTS.map(a => [a, alertCount(a)])]
      .map(([k, c]) => `<button data-v="${k}" title="${esc(k === 'ALL' ? 'Every unit' : ALERT_WHY[k])}">${k === 'ALL' ? 'All' : k[0] + k.slice(1).toLowerCase()} · ${c}</button>`).join('')}
      </div>
      <div class="grow"><input type="search" id="invQ" aria-label="Search stock"
        placeholder="Search model, stock number or VIN" /></div>
      <select id="invStatus" aria-label="Filter by status" style="width:auto">
        <option value="ALL">All statuses</option>
        ${statuses.map(s => `<option value="${esc(s)}">${esc(s)} · ${inv.filter(u => low(u.status) === low(s)).length}</option>`).join('')}
      </select>
      <select id="invSort" aria-label="Sort stock" style="width:auto">
        ${Object.entries(SORTS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
      </select>
      <div class="t-muted num" id="invCount"></div>
      ${addBtn('invAdd')}
    </div>
    <div id="invOnly"></div>
    ${banner}
    ${provenance}
    <div id="invAging"></div>
    <div id="invTable"></div>`;
  body.innerHTML = '';
  body.appendChild(card);

  function paintTotals(rows) {
    const onLot = rows.filter(u => !isSold(u));
    const soldShown = rows.length - onLot.length;
    const value = sum(onLot, u => u.price_aed);
    const hold = sum(rows, u => u.holding_cost_accrued);
    const age = sum(onLot, u => u.days_in_stock);
    const shownCrit = rows.filter(u => up(u.aging_alert) === 'CRITICAL').length;
    const shownWarn = rows.filter(u => up(u.aging_alert) === 'WARNING').length;
    const byStatus = statuses
      .map(s => `${rows.filter(u => low(u.status) === low(s)).length} ${low(s)}`).join(' · ');

    /* Units a recorded sale may already have sold are still in this total,
       because they are still marked Available — which is the whole point of the
       alert. The caveat rides on the number rather than being left to the strip. */
    const suspect = onLot.filter(u => saleSuspect.has(String(u.id))).length;

    strip.innerHTML = [
      kpi('Units shown', num(rows.length),
        `of ${num(inv.length)} in stock${byStatus ? ' · ' + esc(byStatus) : ''}`),
      kpi('Stock value', aed(value.total),
        value.n ? `Listed price of ${num(value.n)} unsold unit${value.n === 1 ? '' : 's'} shown${soldShown ? ` · ${num(soldShown)} sold excluded` : ''}`
          + (suspect ? ` · ${num(suspect)} of them a recorded sale may already have sold` : '')
          : 'No unsold unit in this view carries a list price'),
      kpi('Holding cost accrued', aed(hold.total),
        hold.n ? `${aed(INV.HOLDING_PER_DAY)} per unit per day, counted live to today · ${num(hold.n)} of ${num(hold.of)} rows shown`
          : 'No row in this view carries a holding figure'),
      /* One row is not an average and must not be labelled as one. With a single
         unsold unit in view this is that unit's age, and it says so — the label
         changes too, because "Average" over n=1 is the kind of sentence that
         survives being screenshotted into a meeting. */
      kpi(age.n === 1 ? 'Days in stock' : 'Average days in stock',
        age.n ? num(age.n === 1 ? age.total : age.total / age.n) : '—',
        age.n === 0 ? 'No dated unsold unit in this view'
          : age.n === 1 ? 'One unsold unit in this view — this is its age, not an average'
            : `Mean across ${num(age.n)} unsold units shown, from their acquisition dates`),
      kpi('Ageing alerts · live', num(shownCrit), `${num(shownWarn)} warning · ${num(rows.length - shownCrit - shownWarn)} healthy`,
        shownCrit ? 't-hot' : ''),
    ].join('');
  }

  /* Bands are the product's own thresholds, not decorative buckets: the split
     is exactly where WARNING and CRITICAL are raised. */
  function paintAging(rows) {
    const onLot = rows.filter(u => !isSold(u) && n0(u.days_in_stock) != null);
    const host2 = $('invAging');
    if (!onLot.length) {
      host2.innerHTML = `<div style="padding:14px 20px 0"><div class="cell-sub">No dated unsold unit in this view, so there is no ageing spread to show.</div></div>`;
      return;
    }
    const bands = [
      { a: 'HEALTHY', label: `0–${INV.WARN_DAYS - 1} d`, tone: 'ok' },
      { a: 'WARNING', label: `${INV.WARN_DAYS}–${INV.CRITICAL_DAYS - 1} d`, tone: 'warm' },
      { a: 'CRITICAL', label: `${INV.CRITICAL_DAYS}+ d`, tone: 'hot' },
    ].map(b => ({ ...b, n: onLot.filter(u => up(u.aging_alert) === b.a).length }));
    /* A stacked bar over one row is a solid block at 100%, which reads as a
       distribution and is not one. Say what the single unit is instead; the band
       buttons stay, because they are filters rather than a claim about spread. */
    const only1 = onLot.length === 1 ? onLot[0] : null;
    host2.innerHTML = `<div style="padding:16px 20px 4px">
      <div class="label-caps" style="margin-bottom:10px">Days in stock · ${num(onLot.length)} unsold unit${onLot.length === 1 ? '' : 's'} shown</div>
      ${only1
        ? `<div class="cell-sub" style="white-space:normal">One unsold unit in this view — ${esc(str(only1.id))}, ${esc(band(only1.aging_alert).toLowerCase())} at ${num(only1.days_in_stock)} days. A spread needs more than one row, so none is drawn.</div>`
        : `<div class="stackbar">${bands.filter(b => b.n)
          .map(b => `<i style="width:${(b.n / onLot.length * 100).toFixed(1)}%;background:var(--${b.tone})" title="${esc(b.a)} · ${b.n}"></i>`).join('')}</div>`}
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        ${bands.map(b => `<button class="btn ghost sm" data-band="${b.a}"
          aria-label="Show only ${esc(b.a.toLowerCase())} units — ${esc(ALERT_WHY[b.a])}"
          title="${esc(ALERT_WHY[b.a])}"${b.n ? '' : ' disabled'}>
          <span style="width:8px;height:8px;border-radius:50%;background:var(--${b.tone})"></span>
          ${esc(b.label)}<span class="t-muted num">${b.n}</span></button>`).join('')}
      </div></div>`;
    host2.querySelectorAll('button[data-band]').forEach(b => b.addEventListener('click', () => {
      f.alert = f.alert === b.dataset.band ? 'ALL' : b.dataset.band;
      draw();
    }));
  }

  function drawer(unit) {
    const d = n0(unit.days_in_stock);
    /* Sales whose description could be this unit. "Could be" is the strongest
       claim available: there is no key joining the two tables. */
    const saleRows = recon ? (recon.byUnit.get(String(unit.id)) || []) : [];
    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1"><h2 style="font-size:18px">${esc(unit.model || 'Unnamed unit')}</h2>
          <div class="cell-sub mono">${esc(unit.id)}${unit.vin ? ' · ' + esc(unit.vin) : ''}</div></div>
        <button class="btn ghost sm" id="dClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        <div class="section" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${statusPill(unit)}${alertPill(unit)}
          <span class="chip">${d == null ? 'No acquisition date' : `${num(d)} days in stock`}</span>
        </div>
        ${up(unit.aging_alert) === 'CRITICAL' || up(unit.aging_alert) === 'WARNING' ? `<div class="banner ${tone(unit.aging_alert)}">
          <span class="material-symbols-outlined">warning</span>
          <div>${esc(ALERT_WHY[up(unit.aging_alert)])}. Holding cost so far is ${aed(unit.holding_cost_accrued)} and grows by ${aed(INV.HOLDING_PER_DAY)} a day while it stays on the lot.</div></div>` : ''}
        ${saleRows.length ? `<div class="section"><div class="label-caps">Recorded sale</div>
          <div class="banner ${isSold(unit) ? 'info' : 'warm'}" style="margin-top:8px">
            <span class="material-symbols-outlined" aria-hidden="true">sell</span>
            <div>${saleRows.map(sr => `${esc(str(sr.vehicle) || 'A vehicle')}${n0(sr.amount_aed) != null ? ` — ${aed(sr.amount_aed)}` : ''} on ${esc(dateLabel(sr.purchase_date))}${str(sr.customer_name) ? ` · ${esc(str(sr.customer_name))} · ${esc(str(sr.phone) || 'no phone on the purchase record')}` : ''}`).join('<br>')}
            <div style="margin-top:6px">${isSold(unit)
              ? 'This unit is marked Sold, which is consistent with the record above.'
              : `This unit is still marked ${esc(str(unit.status) || 'without a status')}, so it is counted in stock value, is quotable, and keeps accruing ${aed(INV.HOLDING_PER_DAY)} a day. Edit it to set the status — which stops the accrual, but records no date: inventory has no sale date column.`}
              The pairing is a text match of the sale's vehicle description against this unit's model — purchase_history holds no stock number and inventory holds no sale date, so it cannot be confirmed from the data.</div></div>
          </div></div>` : ''}
        <div class="section"><div class="label-caps">AI recommendation</div>
          <div class="quote" style="margin-top:8px">${esc(unit.ai_recommendation || 'No recommendation generated for this unit.')}</div></div>
        <div class="section"><div class="label-caps">Financials</div>
          <dl class="kv" style="margin-top:8px">
            <dt>List price</dt><dd class="num">${aed(unit.price_aed)}</dd>
            <dt>Cost</dt><dd class="num">${aed(unit.cost_aed)}</dd>
            <dt>Gross margin</dt><dd class="num">${marginCell(unit, 'gross_margin')}</dd>
            <dt>Holding cost</dt><dd class="num">${aed(unit.holding_cost_accrued)}</dd>
            <dt>Net margin</dt><dd class="num"><strong>${marginCell(unit, 'net_margin')}</strong></dd>
            <dt>VAT</dt><dd class="num">${aed(unit.vat_amount)}</dd>
            <dt>Recommended commission</dt><dd class="num">${priced(unit) ? aed(unit.recommended_commission) : '<span class="t-muted">—</span>'}</dd>
            <dt>Acquired</dt><dd>${esc(unit.acquired_at || '—')}</dd>
            <dt>Days in stock</dt><dd class="num">${num(unit.days_in_stock)}</dd>
          </dl></div>
      </div>
      <div class="drawer-foot">
        <button class="btn primary" id="dEdit">Edit</button>
        <button class="btn" id="dComp"${compEmpty
          ? ' disabled title="The competitors table holds no rows — every scraped price in it was removed as unusable, and the scraper next runs at 05:00 UTC. There is nothing to compare this unit against yet."'
          : compUnknown ? ' title="The competitors table could not be read, so this may open a screen with nothing on it."' : ''
        }>Compare against competitors</button>
      </div>`);
    $('dClose').addEventListener('click', closeDrawer);
    $('dComp').addEventListener('click', () => { closeDrawer(); go('competitors'); });
    $('dEdit').addEventListener('click', () => { closeDrawer(); unitForm(unit, inv, reload); });
  }

  /* Renders the strip from whatever we have. A failed attention read still
     leaves the derived alerts; a failed stock read still leaves the view's
     rows. Whichever half is missing is named in the footnote, because a strip
     that silently drops one of them is a smaller number presented as the whole
     truth — exactly the failure this round is about. */
  function paintAttention(rows, err, alerts, index, total) {
    const clickable = [];
    const item = a => {
      /* tone() sends anything it does not recognise to 'cold'; only an empty
         severity comes back blank, and blank would render as an unstyled pill. */
      const t = tone(a.severity) || 'cold';
      const idx = (a.ids && a.ids.length) ? clickable.push({ label: a.title, ids: a.ids }) - 1 : -1;
      const attrs = idx >= 0
        ? ` role="button" tabindex="0" data-focus="${idx}"`
        : ` style="cursor:default" title="${esc(a.noFocus || 'This alert is not about one row, so there is nothing here to open.')}"`;
      return `<div class="list-item"${attrs}>
        <span class="material-symbols-outlined t-${t}" style="font-size:20px" aria-hidden="true">${esc(a.icon || 'warning')}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${pill(str(a.severity) || 'ALERT', t)}<span>${esc(a.title)}</span>
          </div>
          <div class="cell-sub" style="white-space:normal">${esc(a.detail)}</div>
        </div>
        <div class="cell-sub num" style="white-space:nowrap" title="${esc(a.atNote || '')}">${esc(a.at ? ago(a.at) : '—')}</div>
        ${idx >= 0 ? '<span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">chevron_right</span>' : ''}
      </div>`;
    };

    /* The view's own rows first — they are Postgres's judgement about this
       screen, not this file's — then the derived ones by severity. */
    const fromView = (rows || []).map(r => {
      const ref = str(r.ref);
      const u = index ? index.get(ref.toLowerCase()) : null;
      return {
        severity: r.severity,
        icon: KIND_ICON[r.kind] || 'warning',
        title: str(r.title) || ref || 'Needs attention',
        detail: [str(r.detail), ref ? `Stock ${ref}` : ''].filter(Boolean).join(' · '),
        at: r.at,
        atNote: 'How long v_needs_attention has been reporting this row.',
        ids: u ? [u.id] : [],
        noFocus: index
          ? `v_needs_attention reports ${ref || 'a unit'}, which is not among the stock rows this screen loaded — it may sit beyond the row cap or have been removed since the view was refreshed.`
          : 'The stock read failed, so this row cannot be opened here.',
      };
    });
    const fromHere = (alerts && alerts.alerts) || [];

    const notes = [
      err ? `Needs attention did not load (${err}), so anything the database flags for this screen is missing from this strip — only the checks derived from the stock rows are shown.` : '',
      !index ? 'The stock read failed, so nothing in this strip can be opened and no derived check could run.' : '',
      ...((alerts && alerts.notes) || []),
      total ? 'Ageing is not repeated here: v_needs_attention carries its own inventory_aging branch, and the banner and the Ageing-alerts KPI below already count it.' : '',
    ].filter(Boolean);
    const foot = `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">info</span>
      <div class="cell-sub" style="white-space:normal">${notes.map(esc).join('<br>')}</div></div>`;

    if (!fromView.length && !fromHere.length) {
      /* "Nothing needs you" and "nothing could be checked" are opposite facts
         and must never share a sentence. Plainly, and in one line — an empty
         card with a heading and a chevron reads as something to click. */
      const ranHere = !!alerts;
      const CHECKS = 'below cost, missing a list price or a VIN, sold on paper but not in stock, or disagreeing with its stored figures';
      const head = !ranHere ? 'Nothing on this screen could be checked'
        : err ? 'Nothing flagged by the checks that ran'
          : 'Nothing on the lot needs a human right now';
      const line = !ranHere
        ? 'The stock rows did not load, so none of the checks this screen derives could run, and v_needs_attention reported nothing for it either.'
        : err ? `No unit is ${CHECKS} — but that is only the half of this strip the screen derives itself.`
          : `v_needs_attention lists no inventory row, and no unit is ${CHECKS}.`;
      attnHost.innerHTML = `<div class="card" style="display:flex;gap:10px;align-items:flex-start">
        <span class="material-symbols-outlined t-${ranHere && !err ? 'ok' : 'muted'}" aria-hidden="true">${ranHere && !err ? 'task_alt' : 'help'}</span>
        <div style="flex:1">
          <div style="font-weight:500">${esc(head)}</div>
          <div class="cell-sub" style="white-space:normal">${esc(line)}${notes.length ? '<br>' + notes.map(esc).join('<br>') : ''}</div>
        </div></div>`;
      return;
    }

    const counted = `${num(fromView.length)} from v_needs_attention · ${num(fromHere.length)} derived here`
      + (total == null ? ' · the stock rows did not load' : ` from the ${num(total)} ${plural(total, 'unit', 'units')} on this screen`);
    attnHost.innerHTML = `<div class="card flush">
      <div class="card-head"><div>
        <div class="card-title">Needs attention</div>
        <div class="card-sub">${esc(counted)}</div>
      </div><div style="flex:1"></div></div>
      <div>${fromView.map(item).join('')}${fromHere.map(item).join('')}${foot}</div></div>`;

    /* Keyboard-operable for the same reason as the overview list: the row is
       the only way from the alert to the unit it is about. */
    attnHost.querySelectorAll('[data-focus]').forEach(n => {
      const c = clickable[Number(n.dataset.focus)];
      const jump = () => focusUnits(c.label, c.ids);
      n.addEventListener('click', jump);
      n.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
      });
    });
  }

  /* An alert is only useful if it lands on the rows it is about, so this clears
     every filter that could hide them rather than narrowing the view the
     operator happens to be in and showing them nothing. */
  function focusUnits(label, ids) {
    f.status = 'ALL'; f.alert = 'ALL'; f.q = '';
    const q = $('invQ'); if (q) q.value = '';
    f.only = { label, ids: new Set(ids.map(String)) };
    draw();
    const th = $('invTable');
    const first = th ? th.querySelector('tbody tr') : null;
    if (first) {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      /* Re-adding the class alone does not restart a running animation; reading
         a layout property between the remove and the add does. */
      first.classList.remove('flash'); void first.offsetWidth; first.classList.add('flash');
    } else if (th) {
      th.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function draw() {
    card.querySelectorAll('#segAlert button').forEach(b => b.classList.toggle('on', b.dataset.v === f.alert));
    $('invStatus').value = f.status;
    $('invSort').value = f.sort;

    const only = $('invOnly');
    only.innerHTML = f.only ? `<div class="banner info" style="margin:14px 20px 0">
        <span class="material-symbols-outlined" aria-hidden="true">filter_alt</span>
        <div style="flex:1">Showing only the ${num(f.only.ids.size)} ${plural(f.only.ids.size, 'unit', 'units')} behind the alert “${esc(f.only.label)}”. Every total and band below describes those rows.</div>
        <button class="btn sm" id="invOnlyClear">Show all stock</button></div>` : '';
    $('invOnlyClear')?.addEventListener('click', () => { f.only = null; draw(); });

    const rows = sorted(visible());
    $('invCount').textContent = `${rows.length} of ${inv.length} units`;
    paintTotals(rows);
    paintAging(rows);

    const th = $('invTable');
    th.innerHTML = table(cols, rows, {
      onRow: true,
      empty: `${stateEmpty('No vehicles match these filters',
        'Clear the search or widen the status and ageing filters to see stock again.', 'search_off')}
        <div style="text-align:center;padding:0 20px 32px">
          <button class="btn" id="invClear">Clear filters</button></div>`,
    });
    wireRows(th, rows, drawer);
    $('invClear')?.addEventListener('click', () => {
      f.status = 'ALL'; f.alert = 'ALL'; f.q = ''; f.only = null; $('invQ').value = ''; draw();
    });
  }

  card.querySelectorAll('#segAlert button').forEach(b =>
    b.addEventListener('click', () => { f.alert = b.dataset.v; draw(); }));
  $('invQ').addEventListener('input', e => { f.q = e.target.value; draw(); });
  $('invStatus').addEventListener('change', e => { f.status = e.target.value; draw(); });
  $('invSort').addEventListener('change', e => { f.sort = e.target.value; draw(); });
  $('invAdd').addEventListener('click', () => unitForm(null, inv, reload));
  $('invFocus')?.addEventListener('click', () => { f.alert = crit ? 'CRITICAL' : 'WARNING'; draw(); });

  draw();
  paintAttention(viewRows, viewErr, derived, byRef, inv.length);
};

/* ==========================================================================
   S5 · Competitors
   ========================================================================== */
