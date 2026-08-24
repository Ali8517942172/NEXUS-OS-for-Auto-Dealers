/* NEXUS OS — screens/competitors.js
   Reworked on 19 Aug 2026 to answer one question: am I priced right?

   The old screen printed the scrape's own `price_diff_aed` column and trusted
   it. That number is a snapshot of what our list price was at scrape time, so
   after any re-price it quietly describes a price we no longer ask. This screen
   matches each scraped row against the stock we actually hold — make + model,
   and the year when the scrape recorded one — and computes the gap against the
   live list price in `inventory`. The stored figure is still shown in the
   drawer, labelled as the scrape's own snapshot, and flagged when the two
   disagree, because that disagreement is itself information.

   Freshness is stated rather than implied. A price comparison is only as good
   as the day it was collected, so the age of the newest row is on the screen at
   all times and a scrape that has missed a cycle says so in a banner.

   24 Aug 2026 — alerts. A price-comparison screen that does not say how old its
   prices are is lying, so the freshness statement was promoted out of a banner
   half-way down the page into the header of an alert strip that sits above even
   the KPI row: it is now the first sentence on the screen, and it is rendered
   whether the data is fresh or not. `v_needs_attention?screen=eq.competitors`
   is read and its rows are listed there, each one re-checked against the list
   price we ask today — the view's `undercut` rows carry the gap as it was at
   scrape time, and that figure is currently over a month old.

   Three failures the view does not model are raised here as well, because each
   is a way this screen can be quietly wrong rather than visibly empty:
     · rows the latest scrape did not refresh (the job still runs, but it has
       stopped covering those listings) and rows with no scrape date at all;
     · a competitor every one of whose rows arrived with no price — it inflates
       "Scraped prices" and contributes to no gap;
     · an unsold unit of ours that no scraped row matches. That is the undercut
       we would never detect, and it is invisible by construction: there is no
       row to look at, which is exactly why it needs saying out loud.
   Every alert scrolls to and opens the comparison row it is about, or filters
   the table down to the rows it names.

   Two figures in that strip are computed here rather than by the shared
   helpers, and both for the same reason — a helper that rounds or blanks is
   worse than no helper on a screen whose whole subject is how old a number is.
   Severity is coloured from a local map because `tone()` returns '' for a
   severity it has never seen, and a waiting time past a week is spelled out in
   days because `ago()` collapses every one of the view's mid-July rows into the
   same "1 mo ago". */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, aedSigned, ago, esc, n0, num, pct, pill, tone } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, panel, table, wireRows } from '../lib/ui.js';
import { deriveUnit, unitForm } from '../lib/unit-form.js';

/* The scraping workflow is documented as a daily job. One missed cycle is the
   point at which the numbers stop being safe to quote at a customer. */
const SCRAPE_EVERY_HOURS = 24;
const STALE_AFTER_HOURS = 48;
const ROW_LIMIT = 500;
const ATTN_LIMIT = 100;

/* Past a week the wording stops hedging. "Missed a cycle" is a scheduling
   hiccup an operator can shrug at; a price collected last month is a different
   claim about the world and is coloured as the harder failure it is. */
const VERY_STALE_DAYS = 7;

/* A row whose own timestamp trails the newest row in the table by more than one
   further cycle was not picked up by the last scrape. That is a different fault
   from the whole table being old — the job is still running and still writing
   rows, it has just stopped covering these listings — and it hides inside a
   healthy-looking "last scrape" figure, which is why it is counted separately. */
const REFRESH_LAG_HOURS = 48;

/* Matches the aging threshold the inventory screen uses when it starts calling a
   unit old. Used only to qualify how bad a blind spot is, never to compute one. */
const AGING_DAYS = 60;

const low = s => String(s == null ? '' : s).toLowerCase();
const isSold = u => low(u.status) === 'sold';
/* Model names arrive punctuated differently from every source — "Land-Cruiser",
   "LAND CRUISER", "Land Cruiser 300". Compare on letters and digits only. */
const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const plural = (n, one, many) => (Number(n) === 1 ? one : many);
/* Days, spelled out. `ago()` collapses anything past 30 days to "1 mo ago",
   which is the one place this screen must not round: "1 mo" and "43 days" feel
   like different amounts of wrong to the person about to quote the price. */
const dayWord = n => `${num(n)} ${Number(n) === 1 ? 'day' : 'days'}`;
const dt = ts => new Date(ts).toLocaleString('en-GB');

/* Reads the first column that actually carries a value. The competitor feed and
   the inventory table were built by different workflows and do not agree on
   names; this resolves them without inventing a value when none is present. */
function pick(row, names) {
  for (const k of names) {
    const v = row?.[k];
    if (v != null && String(v).trim() !== '') return v;
  }
  return null;
}

const cName  = r => pick(r, ['competitor', 'competitor_name', 'dealer', 'dealership', 'name', 'source']);
const cMake  = r => pick(r, ['make', 'brand', 'manufacturer']);
const cModel = r => pick(r, ['model', 'vehicle_model', 'vehicle']);
const cYear  = r => n0(pick(r, ['year', 'model_year']));
const cPrice = r => n0(pick(r, ['price_aed', 'competitor_price_aed', 'listed_price_aed', 'price']));
const cAt    = r => pick(r, ['scraped_at', 'checked_at', 'collected_at', 'updated_at', 'created_at']);
/* The only person-shaped value a competitor row can carry: whoever the listing
   named as its contact. The feed has never been guaranteed to record one, and
   `select=*` means asking costs nothing and cannot 42703 the query, so it is
   read defensively and rendered only where it actually exists. */
const cContact = r => pick(r, ['contact_name', 'sales_contact', 'contact', 'agent_name', 'salesperson']);
const cPhone   = r => pick(r, ['contact_phone', 'phone', 'phone_number', 'mobile', 'contact_number']);

const uMake  = u => pick(u, ['make', 'brand']);
const uModel = u => pick(u, ['model', 'vehicle']);
const uYear  = u => n0(pick(u, ['year', 'model_year']));
const uPrice = u => n0(pick(u, ['list_price_aed', 'price_aed']));
const uRef   = u => pick(u, ['stock_id', 'id']);

const vehicleLabel = (make, model, year) =>
  [year == null ? '' : String(year), make || '', model || ''].filter(Boolean).join(' ').trim();

const BASIS = {
  exact:  { chip: 'make · model · year', why: 'Same make, model and year as a unit on the lot.' },
  mm:     { chip: 'make · model',        why: 'Same make and model. The scrape did not record a year, so the year is not part of this match.' },
  model:  { chip: 'model only',          why: 'Matched on the model name alone — the scrape or the stock record is missing a make, so this comparison is looser.' },
  none:   { chip: 'no unit in stock',    why: 'Nothing on the lot matches this make and model, so there is no price of ours to compare.' },
};

/* The first five are always offered. The last two exist so an alert has
   somewhere to land, and are only rendered when they would match something —
   a filter chip reading "Not refreshed · 0" is a control that does nothing. */
const FILTERS = {
  ALL:    'All',
  ABOVE:  'We ask more',
  BELOW:  'We undercut',
  LEVEL:  'Level',
  NOSTOCK:'Not stocked',
  STALE:  'Not refreshed',
  NOPRICE:'No price',
};
const ALWAYS_SHOWN = new Set(['ALL', 'ABOVE', 'BELOW', 'LEVEL', 'NOSTOCK']);
const SORTS = {
  above_first: 'Most overpriced first',
  below_first: 'Biggest undercut first',
  newest:      'Newest scrape first',
  oldest:      'Oldest scrape first',
  name:        'Competitor A–Z',
};

/* One competitor row, joined to the stock it can legitimately be compared with.
   Everything here is either a column Postgres returned or arithmetic over two
   of them; nothing is filled in when a side is missing. */
function compare(r, index) {
  const make = cMake(r), model = cModel(r), year = cYear(r), price = cPrice(r);
  const keyed = index.lookup(make, model);
  let units = keyed.units, basis = keyed.basis, yearNote = '';

  if (units.length && year != null) {
    const sameYear = units.filter(u => uYear(u) === year);
    if (sameYear.length) { units = sameYear; basis = basis === 'mm' ? 'exact' : basis; }
    else {
      const years = [...new Set(units.map(uYear).filter(y => y != null))].sort();
      yearNote = years.length
        ? `We do not stock a ${year}; comparing against ${years.join(', ')}.`
        : `The scrape says ${year}; our matching stock has no year recorded.`;
    }
  }

  /* A sold car is not a car we are pricing. It is only used as the comparable
     when it is the only thing that matches, and then it is labelled. */
  const onLot = units.filter(u => !isSold(u));
  const soldOnly = units.length > 0 && onLot.length === 0;
  if (onLot.length) units = onLot;

  const pricedUnits = units.filter(u => uPrice(u) != null);
  const prices = pricedUnits.map(uPrice);
  /* Several units of the same car rarely carry the same sticker. The shopper
     compares against the cheapest one we advertise, so that is the figure the
     gap is measured from; the spread is shown next to it. */
  const ourPrice = prices.length ? Math.min(...prices) : null;
  const ourHigh = prices.length ? Math.max(...prices) : null;
  const delta = (ourPrice != null && price != null) ? ourPrice - price : null;

  return {
    raw: r, id: pick(r, ['id']), name: cName(r), make, model, year, price,
    contactName: cContact(r), contactPhone: cPhone(r),
    label: vehicleLabel(make, model, year) || String(model || '') || 'Unnamed vehicle',
    at: cAt(r),
    storedOur: n0(pick(r, ['our_price_aed'])),
    storedDiff: n0(pick(r, ['price_diff_aed'])),
    rec: pick(r, ['ai_recommendation', 'recommendation', 'notes']),
    units, pricedUnits, unmatched: units.length === 0,
    basis: units.length ? basis : 'none',
    yearNote, soldOnly, ourPrice, ourHigh, delta,
    deltaPct: (delta != null && price) ? (delta / price) * 100 : null,
  };
}

/* make+model first, model alone as the fallback, so a feed that puts the make
   inside the model string still finds the car. */
function buildIndex(inv) {
  const byMakeModel = new Map(), byModel = new Map();
  const add = (map, key, u) => { if (!key) return; if (!map.has(key)) map.set(key, []); map.get(key).push(u); };
  inv.forEach(u => {
    const m = norm(uModel(u));
    add(byModel, m, u);
    add(byMakeModel, norm(`${uMake(u) || ''} ${uModel(u) || ''}`), u);
  });
  return {
    lookup(make, model) {
      const m = norm(model);
      if (make) {
        const hit = byMakeModel.get(norm(`${make} ${model}`));
        if (hit) return { units: hit, basis: 'mm' };
      }
      const both = byMakeModel.get(m);        // feed put "Toyota Land Cruiser" in one field
      if (both) return { units: both, basis: make ? 'mm' : 'model' };
      const only = byModel.get(m);
      if (only) return { units: only, basis: make ? 'model' : 'model' };
      return { units: [], basis: 'none' };
    },
  };
}

const deltaCell = c => {
  if (c.delta == null) {
    const why = c.unmatched ? BASIS.none.why
      : c.price == null ? 'This row has no competitor price recorded.'
        : 'The matching unit has no list price on record.';
    return `<span class="t-muted" title="${esc(why)}">—</span>`;
  }
  if (c.delta === 0) return '<span class="t-muted">level</span>';
  const worse = c.delta > 0;
  return `<span class="${worse ? 't-hot' : 't-ok'}" style="font-weight:500"
      title="${esc(`Our ${aed(c.ourPrice)} against their ${aed(c.price)}`)}">
      <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px" aria-hidden="true">${worse ? 'arrow_upward' : 'arrow_downward'}</span>
      ${aedSigned(c.delta)}</span>
    ${c.deltaPct == null ? '' : `<div class="cell-sub">${pct(Math.abs(c.deltaPct))} ${worse ? 'above' : 'below'} theirs</div>`}`;
};

/* The obvious answer to "these prices are old" is "run the scrape again", and
   there is no way to do that from here: the competitors table is written by a
   scheduled workflow with no webhook in the HOOK map, so the control is rendered
   disabled and says what is missing rather than being left off the screen — an
   absent button reads as "not possible", a disabled one as "not wired yet". */
const NO_SCRAPE_HOOK = {
  label: 'Re-run scrape',
  why: 'No webhook exists for the price scrape. The competitors table is written by a scheduled workflow that has no manual trigger in the HOOK map, so it cannot be re-run from the browser.',
};

/* Icons for the kinds `v_needs_attention` routes to this screen. `undercut` is
   the only one it emits today; anything it grows later still renders, with a
   generic icon rather than nothing. */
const KIND_ICON = { undercut: 'trending_down', price_stale: 'update_disabled' };

/* Severity is coloured from a map that lives here rather than through `tone()`
   in lib/format.js. TONE there has no WARNING key, so `tone('WARNING')` returns
   the empty string — and an empty class is not a missing colour, it is a pill
   rendered with no tone at all, which reads as a neutral note rather than as a
   warning. `v_needs_attention` is a shared view this screen does not own and is
   free to emit a severity nobody here has seen, so anything unrecognised is
   coloured as a warning rather than losing its colour silently. */
/* 24 Aug: the private map above is gone — lib/format.js `tone()` now carries
   every vocabulary that reaches this screen (HOT/WARM/COLD, CRITICAL/WARNING/OK,
   HIGH/MEDIUM/LOW/INFO, and the workflow-health words) and maps anything it does
   not recognise to 'cold' instead of ''. This screen keeps its own preference
   for the unrecognised case: a severity nobody here has seen, arriving from a
   shared view this screen does not own, is more usefully shown as a warning than
   as a note nobody looks at. That single decision is all that is left local. */
const sevTone = s => {
  const t = tone(s);
  if (!t) return '';                 // genuinely blank severity — say nothing
  return t === 'cold' && !/^(cold|low|info|notice)$/i.test(String(s).trim()) ? 'warm' : t;
};

SCREENS.competitors = async host => {
  /* The alert strip is appended before the KPI row on purpose. The first thing
     an operator needs from this screen is not a count of undercuts, it is how
     old the prices behind that count are — so the freshness statement is the
     header of the topmost card and cannot be scrolled past. */
  const alertHost = el('div'); host.appendChild(alertHost);

  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const body = el('div'); body.style.marginTop = '16px'; host.appendChild(body);
  body.innerHTML = `<div class="card flush">${stateLoading(8)}</div>`;
  const below = el('div', 'grid g2 top'); below.style.marginTop = '16px'; host.appendChild(below);
  const byCompHost = el('div'); const blindHost = el('div');
  below.appendChild(byCompHost); below.appendChild(blindHost);

  /* Three reads, started together rather than one after another. Inventory and
     the attention view used to wait on the competitors fetch for no reason; on
     a single-core box that is two round-trips of dead time. Both are marked
     handled the moment they are created — if the competitors read fails first
     and this function returns, a rejection with no handler surfaces in the
     console instead of in the panel that is supposed to report it. */
  const invP = db('inventory?select=*&limit=1000');
  const attnP = db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen'
    + `&screen=eq.competitors&limit=${ATTN_LIMIT}`);
  invP.catch(() => {}); attnP.catch(() => {});

  /* Ordering is deliberately left to the client. The competitors feed is
     written by a scraping workflow and the column set has changed before;
     ordering server-side on a column that has been renamed returns a 400 and
     takes the whole screen down, while sorting here cannot. */
  let rows = [];
  try { rows = await db(`competitors?select=*&limit=${ROW_LIMIT}`); }
  catch (e) {
    strip.remove(); below.remove(); alertHost.remove();
    body.innerHTML = `<div class="card">${stateError('competitor pricing', e.message, 'competitors')}</div>`;
    body.querySelector('[data-retry]')?.addEventListener('click', () => go('competitors'));
    return;
  }

  /* Inventory is a second, independent failure. Losing it costs the deltas, not
     the screen — the scraped prices are still worth seeing, so the comparison
     columns say why they are blank instead of the page showing an error. */
  let inv = [], invErr = null;
  try { inv = (await invP).map(deriveUnit); }
  catch (e) { invErr = e; }

  /* The shared attention view is an enrichment too. Its failure costs the
     centrally-raised alerts, not the locally-derived ones, and the strip says
     which half is missing rather than showing a shorter list as if complete. */
  let attn = null, attnErr = null;
  try { attn = await attnP; }
  catch (e) { attnErr = e; }

  const index = buildIndex(inv);
  const all = rows.map(r => compare(r, index));
  const reload = () => go('competitors');

  const dated = c => !!(c.at && !Number.isNaN(Date.parse(c.at)));
  const stamped = all.filter(dated);
  const newest = stamped.length ? stamped.reduce((a, c) => (Date.parse(c.at) > Date.parse(a.at) ? c : a)).at : null;
  const oldest = stamped.length ? stamped.reduce((a, c) => (Date.parse(c.at) < Date.parse(a.at) ? c : a)).at : null;
  const ageHours = newest ? (Date.now() - Date.parse(newest)) / 3600000 : null;
  const stale = ageHours != null && ageHours > STALE_AFTER_HOURS;
  const daysOld = ageHours == null ? null : Math.floor(ageHours / 24);
  const veryStale = daysOld != null && daysOld >= VERY_STALE_DAYS;
  /* How many runs of a job scheduled every SCRAPE_EVERY_HOURS have produced
     nothing. One cycle of age is normal for a daily job, hence the -1. */
  const missed = ageHours == null ? null : Math.max(0, Math.floor(ageHours / SCRAPE_EVERY_HOURS) - 1);

  /* The sentence this screen exists to make impossible to miss. It renders
     whether the prices are fresh or not: "collected 2 hours ago" is as much a
     part of an honest comparison as "collected 43 days ago". */
  const freshLine = !newest
    ? 'No row here carries a scrape timestamp, so how old these prices are cannot be established at all.'
    : `Newest price collected ${esc(ago(newest))} (${esc(dt(newest))})`
      + (oldest && oldest !== newest ? `, oldest ${esc(ago(oldest))} (${esc(dt(oldest))})` : '')
      + `. The scrape is expected every ${SCRAPE_EVERY_HOURS} h`
      + (stale ? `, so it has missed about ${num(missed)} ${plural(missed, 'cycle', 'cycles')}.` : '.');

  if (!all.length) {
    strip.remove(); below.remove();
    /* An undercut alert that survives an empty competitors table is a real
       contradiction — the view read rows this screen cannot see — and saying
       nothing about it would leave the operator with an unexplained nav badge. */
    const orphan = (attn || []).length;
    alertHost.innerHTML = orphan
      ? `<div class="banner warm"><span class="material-symbols-outlined">rule</span>
          <div>${num(orphan)} ${plural(orphan, 'alert', 'alerts')} in v_needs_attention ${plural(orphan, 'is', 'are')} filed against this screen, but the competitors table returned no rows at all, so none of them can be shown against the price it was raised on.</div></div>`
      : '';
    body.innerHTML = `<div class="card flush">
      <div class="card-head"><div><div class="card-title">Price comparison</div>
        <div class="card-sub">Nothing has been scraped yet</div></div></div>
      ${stateEmpty('No competitor prices yet',
        `The scraping workflow writes this table and is expected to run every ${SCRAPE_EVERY_HOURS} hours. Until it has run once there is no market price to compare our stock against.`,
        'trending_up')}</div>`;
    return;
  }

  /* ── Headline figures. Every one is a count or a difference of two stored
     prices; where a side is missing the row is excluded and said so. ─────── */
  const comparable = all.filter(c => c.delta != null);
  const above = comparable.filter(c => c.delta > 0);
  const level = comparable.filter(c => c.delta === 0);
  const belowMkt = comparable.filter(c => c.delta < 0);
  const notStocked = all.filter(c => c.unmatched);
  const worstAbove = above.length ? above.reduce((a, c) => (c.delta > a.delta ? c : a)) : null;
  const bestBelow = belowMkt.length ? belowMkt.reduce((a, c) => (c.delta < a.delta ? c : a)) : null;
  const competitorCount = new Set(all.map(c => norm(c.name)).filter(Boolean)).size;
  const modelCount = new Set(all.map(c => norm(c.label)).filter(Boolean)).size;
  const capped = all.length >= ROW_LIMIT;

  strip.innerHTML = [
    kpi('Scraped prices', num(all.length),
      `${num(competitorCount)} competitor${competitorCount === 1 ? '' : 's'} · ${num(modelCount)} vehicle${modelCount === 1 ? '' : 's'}${capped ? ` · capped at ${num(ROW_LIMIT)} rows` : ''}`),
    /* When inventory did not load nothing could be compared, so the honest
       value is "—", not the zero that arithmetic over an empty list produces.
       A zero here reads as "we checked and found none". */
    kpi('Comparable to our stock', invErr ? '—' : num(comparable.length),
      invErr
        ? '<span class="t-hot">Inventory did not load, so no comparison could be made</span>'
        : `<span class="t-muted">${num(notStocked.length)} not stocked · ${num(all.length - comparable.length - notStocked.length)} missing a price</span>`),
    kpi('We ask more', invErr ? '—' : num(above.length),
      invErr
        ? '<span class="t-hot">Not counted — our own prices are unknown</span>'
        : above.length
          ? `<span class="t-hot">Worst ${aedSigned(worstAbove.delta)} on ${esc(worstAbove.label)}</span>`
          : comparable.length ? '<span class="t-ok">No matched unit is above its scraped market price</span>' : '',
      above.length && !invErr ? 't-hot' : ''),
    kpi('We undercut', invErr ? '—' : num(belowMkt.length),
      invErr
        ? '<span class="t-hot">Not counted — our own prices are unknown</span>'
        : bestBelow
          ? `<span class="t-ok">Best ${aedSigned(bestBelow.delta)} on ${esc(bestBelow.label)}</span>`
          : `<span class="t-muted">${num(level.length)} priced level</span>`),
    /* Stated in days rather than through ago(), which collapses everything past
       a month into "1 mo ago" — the exact rounding this KPI must not do. */
    kpi('Prices collected', newest ? (daysOld >= 1 ? `${dayWord(daysOld)} ago` : ago(newest)) : '—',
      newest
        ? (stale
          ? `<span class="t-hot">Missed about ${num(missed)} ${plural(missed, 'cycle', 'cycles')}</span> <span class="t-muted">· ${esc(dt(newest))}</span>`
          : `<span class="t-muted">${esc(dt(newest))}</span>`)
        : '<span class="t-muted">No row carries a scrape timestamp</span>',
      stale ? 't-hot' : ''),
  ].join('');

  /* ── Derived sets the alerts and the panels below both read ──────────────
     Computed once. The alert strip claiming one number and the panel under it
     showing another is the specific failure this avoids. */

  /* A row the latest scrape did not touch: its own timestamp trails the newest
     row in the table by more than a further cycle. Rows with no timestamp at
     all join them — not because they are known to be old, but because they are
     invisible to every freshness figure on the screen, which is its own fault. */
  const lagHours = c => (newest && dated(c)) ? (Date.parse(newest) - Date.parse(c.at)) / 3600000 : null;
  const trailing = all.filter(c => { const l = lagHours(c); return l != null && l > REFRESH_LAG_HOURS; });
  const undatedRows = all.filter(c => !dated(c));
  const notRefreshed = trailing.concat(undatedRows);
  const staleSet = new Set(notRefreshed);
  const oldestTrail = trailing.length
    ? trailing.reduce((a, c) => (Date.parse(c.at) < Date.parse(a.at) ? c : a)) : null;

  const pricelessRows = all.filter(c => c.price == null);

  /* One grouping, shared by the alert and by the By-competitor panel. */
  const groups = (() => {
    const by = new Map();
    all.forEach(c => {
      const k = c.name || 'Unnamed source';
      if (!by.has(k)) by.set(k, { name: k, rows: [], above: 0, below: 0, cmp: 0, priced: 0, newest: null, stale: 0 });
      const g = by.get(k);
      g.rows.push(c);
      if (c.price != null) g.priced += 1;
      if (staleSet.has(c)) g.stale += 1;
      if (c.delta != null) { g.cmp += 1; if (c.delta > 0) g.above += 1; else if (c.delta < 0) g.below += 1; }
      if (dated(c) && (!g.newest || Date.parse(c.at) > Date.parse(g.newest))) g.newest = c.at;
    });
    return [...by.values()].sort((a, b) => b.above - a.above || b.rows.length - a.rows.length);
  })();
  const silentSources = groups.filter(g => g.priced === 0);

  /* Our own stock that no scraped row matches. This is the blind spot the whole
     screen is blind to by construction: there is no row to look at, so without
     naming it here a competitor could undercut one of these units indefinitely
     and nothing on this page would ever change. */
  const covered = new Set();
  all.forEach(c => c.units.forEach(u => covered.add(String(uRef(u)))));
  const blindUnits = invErr ? [] : inv
    .filter(u => !isSold(u) && !covered.has(String(uRef(u))))
    .sort((a, b) => (n0(b.days_in_stock) || 0) - (n0(a.days_in_stock) || 0));

  /* ── Alerts ──────────────────────────────────────────────────────────────
     `titleHtml` and `detailHtml` hold HTML that is already escaped at the point
     it is built. The names carry the -Html suffix because this app has had a
     real XSS finding and competitor names arrive from a scraper; a field called
     `title` invites the next person to pass raw text into it. */
  const alerts = [];
  const push = a => alerts.push({ sev: 'WARM', icon: 'warning', source: 'local', ...a });

  /* Order is deliberate. Freshness first because it qualifies every other item
     — an undercut measured on a month-old price may not be an undercut at all.
     Then failed reads, because they change what the numbers below can claim.
     Then the view's own rows, then the data-quality faults this screen derives. */
  if (!newest) {
    push({
      sev: 'HOT', icon: 'schedule',
      titleHtml: 'These prices are undated',
      detailHtml: 'Not one row carries a scrape timestamp, so nothing on this screen can be said to be current. Every gap below is a comparison against a price of unknown age.',
      agoHtml: '<span class="t-hot">age unknown</span>',
      noHook: NO_SCRAPE_HOOK,
      why: 'There is no timestamp to sort or filter on, so there is no row this can open.',
    });
  } else if (stale) {
    push({
      sev: veryStale ? 'HOT' : 'WARM', icon: 'update_disabled',
      titleHtml: `The newest price here is ${dayWord(daysOld)} old`,
      detailHtml: `${freshLine} Every gap on this screen is measured against prices that old, so none of them is safe to quote at a customer without being re-checked first.`,
      agoHtml: `<span title="${esc(dt(newest))}">price ${esc(dayWord(daysOld))} old</span>`,
      noHook: NO_SCRAPE_HOOK,
      actLabel: 'Oldest first',
      act: () => focusFilter('ALL', '', 'oldest'),
    });
  }

  if (invErr) {
    push({
      sev: 'HOT', icon: 'error',
      titleHtml: 'Our own stock did not load, so no gap could be computed',
      detailHtml: `${esc(invErr.message)} — every "Our list price" and "Gap" cell below is blank for that reason, the three comparison figures above read "—" rather than zero, and the check for stock with no market reference could not run at all.`,
      agoHtml: 'this page load',
      actLabel: 'Retry',
      act: reload,
    });
  }

  /* ── The centrally-raised rows ──────────────────────────────────────────
     `ref` is matched against the scraped row's id first, then against the stock
     id of a unit the row was matched to, then against the vehicle name. Which
     one hit is reported, because a match on a name is a weaker claim than a
     match on a key and the operator should know which they are looking at. */
  const byId = new Map(); all.forEach(c => { if (c.id != null) byId.set(String(c.id), c); });
  const byStock = new Map();
  all.forEach(c => c.units.forEach(u => { const k = String(uRef(u)); if (k && !byStock.has(k)) byStock.set(k, c); }));
  /* Names are compared as a bag of words, not as a string. The view builds its
     title from the same parts this screen builds `label` from but not in the
     same order — "Nissan Patrol Nismo 2023" against "2023 Nissan Patrol Nismo"
     — and a straight comparison silently fails on every row. Sorting the tokens
     makes the two forms the same key; dropping the year gives a second, looser
     key for a title that does not carry one. */
  const tokenKey = s => norm(s).split(' ').filter(Boolean).sort().join(' ');
  const tokenKeyNoYear = s => norm(s).split(' ')
    .filter(t => t && !/^(19|20)\d{2}$/.test(t)).sort().join(' ');
  const byLabel = new Map(), byLabelLoose = new Map();
  all.forEach(c => {
    const k = tokenKey(c.label); if (k && !byLabel.has(k)) byLabel.set(k, c);
    const l = tokenKeyNoYear(c.label); if (l && !byLabelLoose.has(l)) byLabelLoose.set(l, c);
  });

  const resolveAttn = it => {
    const ref = String(it.ref == null ? '' : it.ref).trim();
    if (ref && byId.has(ref)) return { c: byId.get(ref), how: 'the scraped row id' };
    if (ref && byStock.has(ref)) return { c: byStock.get(ref), how: 'our stock id' };
    const t = tokenKey(it.title);
    if (t && byLabel.has(t)) return { c: byLabel.get(t), how: 'the vehicle name' };
    const l = tokenKeyNoYear(it.title);
    if (l && byLabelLoose.has(l)) return { c: byLabelLoose.get(l), how: 'the vehicle name without its year' };
    return { c: null, how: null };
  };

  let unresolved = 0;
  (attn || []).forEach(it => {
    const { c, how } = resolveAttn(it);
    if (!c) unresolved += 1;
    const extra = [];
    /* The view's detail carries the gap as it stood when the row was scraped.
       This screen's entire thesis is that a stored gap describes a price we may
       no longer ask, so the alert is re-checked against the live list price and
       the two are shown together rather than the older one being trusted. */
    if (c && c.delta != null) {
      extra.push(`Against the list price we ask today the gap is ${esc(aedSigned(c.delta))}.`);
    } else if (c) {
      extra.push('This screen cannot re-check that figure: '
        + (c.unmatched ? 'we hold no unit matching this make and model.'
          : c.price == null ? 'the scraped row carries no price.'
            : 'the matching unit has no list price on record.'));
    }
    if (it.at && !Number.isNaN(Date.parse(it.at))) {
      const d = Math.floor((Date.now() - Date.parse(it.at)) / 86400000);
      if (d >= VERY_STALE_DAYS) extra.push(`It rests on a price collected ${dayWord(d)} ago.`);
    }
    if (how && how.startsWith('the vehicle name')) {
      extra.push(`Matched to a scraped row by ${how}, not by id — a weaker match than a key, so check it is the same car.`);
    }
    push({
      source: 'view',
      sev: String(it.severity || 'WARM').toUpperCase(),
      icon: KIND_ICON[it.kind] || 'warning',
      titleHtml: esc(it.title || 'Untitled alert'),
      detailHtml: [esc(it.detail || ''), ...extra].filter(Boolean).join(' '),
      at: it.at,
      actLabel: 'Open row',
      act: c ? () => focusRow(c) : null,
      why: c ? null : `v_needs_attention raised this against ref ${esc(String(it.ref == null ? '—' : it.ref))}, and no row loaded here carries that id or that vehicle name — so there is no comparison row on this screen to open.`,
    });
  });

  if (notRefreshed.length) {
    push({
      sev: 'WARM', icon: 'sync_problem',
      titleHtml: `${num(notRefreshed.length)} ${plural(notRefreshed.length, 'row was', 'rows were')} not refreshed by the latest scrape`,
      detailHtml: [
        trailing.length
          ? `${num(trailing.length)} ${plural(trailing.length, 'row trails', 'rows trail')} the newest row in this table by more than ${REFRESH_LAG_HOURS} h${oldestTrail ? `, the oldest by ${esc(ago(oldestTrail.at))} (${esc(oldestTrail.name || 'unnamed source')} · ${esc(oldestTrail.label)})` : ''}. The scrape is still writing rows, so this is not the job being down — it has stopped covering these listings.`
          : '',
        undatedRows.length
          ? `${num(undatedRows.length)} ${plural(undatedRows.length, 'row carries', 'rows carry')} no scrape date at all, so ${plural(undatedRows.length, 'its', 'their')} age cannot be established and ${plural(undatedRows.length, 'it is', 'they are')} invisible to every freshness figure on this screen.`
          : '',
      ].filter(Boolean).join(' '),
      agoHtml: oldestTrail
        ? `<span title="${esc(dt(oldestTrail.at))}">oldest ${esc(ago(oldestTrail.at))}</span>`
        : '<span class="t-warm">no dates at all</span>',
      actLabel: 'Show them',
      act: () => focusFilter('STALE', '', 'oldest'),
    });
  }

  if (silentSources.length) {
    const one = silentSources.length === 1 ? silentSources[0] : null;
    const silentRows = silentSources.reduce((a, g) => a + g.rows.length, 0);
    push({
      sev: 'WARM', icon: 'money_off',
      titleHtml: one
        ? `${esc(one.name)} sent no price at all`
        : `${num(silentSources.length)} competitors sent no price at all`,
      detailHtml: `${one
        ? `Every one of ${esc(one.name)}'s ${num(one.rows.length)} scraped ${plural(one.rows.length, 'row', 'rows')} arrived without a price`
        : `${esc(silentSources.map(g => g.name).join(', '))} — ${num(silentRows)} rows between them — arrived without a price`}, so nothing they list can be compared with ours. Those rows are counted in "Scraped prices" above and contribute to no gap anywhere on this screen.${pricelessRows.length > silentRows ? ` ${num(pricelessRows.length)} rows have no price in total, across every source.` : ''}`,
      agoHtml: one && one.newest
        ? `<span title="${esc(dt(one.newest))}">last seen ${esc(ago(one.newest))}</span>`
        : '',
      actLabel: 'Show them',
      act: () => focusFilter('NOPRICE', one ? one.name : ''),
    });
  } else if (pricelessRows.length) {
    push({
      sev: 'COLD', icon: 'money_off',
      titleHtml: `${num(pricelessRows.length)} scraped ${plural(pricelessRows.length, 'row has', 'rows have')} no price`,
      detailHtml: `${plural(pricelessRows.length, 'It is', 'They are')} counted in "Scraped prices" above but ${plural(pricelessRows.length, 'contributes', 'contribute')} to no gap, so the comparable count is smaller than the row count by at least this much. Every source here did record a price on some of its rows.`,
      agoHtml: '',
      actLabel: 'Show them',
      act: () => focusFilter('NOPRICE', ''),
    });
  }

  if (!invErr && blindUnits.length) {
    const aged = blindUnits.filter(u => (n0(u.days_in_stock) || 0) >= AGING_DAYS);
    const critical = blindUnits.filter(u => String(u.aging_alert || '').toUpperCase() === 'CRITICAL');
    const listValue = blindUnits.reduce((a, u) => a + (uPrice(u) || 0), 0);
    const longest = blindUnits.reduce((a, u) => Math.max(a, n0(u.days_in_stock) || 0), 0);
    push({
      sev: critical.length ? 'HOT' : 'WARM', icon: 'price_check',
      titleHtml: `${num(blindUnits.length)} unsold ${plural(blindUnits.length, 'unit has', 'units have')} no competitor price at all`,
      detailHtml: `No scraped row matches ${plural(blindUnits.length, 'its', 'their')} make and model, so if a rival undercut ${plural(blindUnits.length, 'it', 'one of them')} today nothing on this screen would show it — this is the undercut we would never detect.${aged.length ? ` ${num(aged.length)} of them ${plural(aged.length, 'has', 'have')} been in stock ${AGING_DAYS} days or more${critical.length ? `, ${num(critical.length)} flagged CRITICAL` : ''}.` : ''}${listValue ? ` Together they list at ${esc(aed(listValue))}.` : ''}`,
      agoHtml: longest ? `${esc(dayWord(longest))} in stock` : '',
      actLabel: 'Show them',
      act: () => focusBlind(),
    });
  }

  /* ── Strip rendering ────────────────────────────────────────────────────── */
  const viewCount = alerts.filter(a => a.source === 'view').length;
  const localCount = alerts.length - viewCount;

  /* Every count on this screen has to be explainable, and the two that are not
     obvious are "why is this list this long" and "what is missing from it". */
  const notes = [
    attnErr
      ? `v_needs_attention did not load (${esc(attnErr.message)}), so alerts raised centrally for this screen — the nightly undercut check among them — are missing from this list entirely. The ${num(localCount)} above ${plural(localCount, 'was', 'were')} derived here from the ${num(all.length)} scraped ${plural(all.length, 'row', 'rows')} this screen loaded.`
      : `${num(viewCount)} ${plural(viewCount, 'row', 'rows')} from v_needs_attention where screen = competitors${viewCount ? '' : ' (it returned none for this screen)'}, and ${num(localCount)} derived here from the ${num(all.length)} scraped ${plural(all.length, 'row', 'rows')} and ${invErr ? 'no inventory rows' : `${num(inv.length)} inventory ${plural(inv.length, 'row', 'rows')}`} loaded.`,
    unresolved
      ? `${num(unresolved)} of the view's ${plural(unresolved, 'alert', 'alerts')} could not be matched to a row loaded here, so ${plural(unresolved, 'it opens', 'they open')} nothing.`
      : '',
    capped
      ? `The competitors read was capped at ${num(ROW_LIMIT)} rows, so every count on this screen — these alerts included — may be short.`
      : '',
    invErr
      ? 'Inventory did not load, so the check for stock with no market reference could not run and is absent from this list rather than empty.'
      : '',
  ].filter(Boolean);
  const notesHtml = notes.join('<br>');

  /* "How long has this been waiting" is the second figure on this screen that
     ago() is not allowed to round. Every row v_needs_attention files against
     this screen today was raised in mid-July, and ago() renders all of them as
     the same "1 mo ago" — which makes a 43-day-old undercut sound like a
     rounding error rather than a decision that has been pending for six weeks.
     Past VERY_STALE_DAYS the wait is spelled out in days and coloured; the
     exact timestamp stays in the tooltip either way. */
  const waitedHtml = at => {
    if (!at || Number.isNaN(Date.parse(at))) {
      return '<span class="t-muted" title="This alert carries no timestamp, so how long it has been waiting cannot be established.">no timestamp</span>';
    }
    const d = Math.floor((Date.now() - Date.parse(at)) / 86400000);
    return d >= VERY_STALE_DAYS
      ? `<span class="t-hot" title="${esc(dt(at))}">waiting ${esc(dayWord(d))}</span>`
      : `<span title="${esc(dt(at))}">raised ${esc(ago(at))}</span>`;
  };

  const alertItem = (a, i) => {
    const clickable = typeof a.act === 'function';
    /* "How long has this been waiting" only means something for the view's own
       rows, which carry the moment the condition was recorded. A locally derived
       alert states the age of the thing it is about instead, and where neither
       is meaningful it says nothing rather than inventing a clock. */
    const waited = a.agoHtml != null ? a.agoHtml : waitedHtml(a.at);
    return `<div class="list-item"${clickable ? ` role="button" tabindex="0" data-alert="${i}"` : ' style="cursor:default"'}>
      <span class="material-symbols-outlined t-${sevTone(a.sev)}" style="font-size:20px" aria-hidden="true">${esc(a.icon)}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${a.titleHtml}${pill(a.sev, sevTone(a.sev))}${a.source === 'view' ? '<span class="chip" title="Raised by v_needs_attention, the shared cross-screen alert view, not computed on this screen.">shared</span>' : ''}
        </div>
        <div class="cell-sub" style="white-space:normal">${a.detailHtml}${a.why ? ` <span class="t-muted">${a.why}</span>` : ''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0" class="cell-sub">${waited}
        ${clickable ? `<div class="t-muted">${esc(a.actLabel || 'Open')}</div>` : ''}</div>
      ${a.noHook ? `<button class="btn sm" disabled title="${esc(a.noHook.why)}">${esc(a.noHook.label)}</button>` : ''}
      ${clickable ? '<span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">chevron_right</span>' : ''}
    </div>`;
  };

  const headSub = `<div class="card-sub ${stale || !newest ? 't-hot' : ''}" style="white-space:normal">${freshLine}</div>`;

  if (!alerts.length) {
    /* No empty box. One line saying what was checked, so "nothing here" is a
       result rather than a panel that failed to render. */
    alertHost.innerHTML = `<div class="card" style="margin-bottom:16px">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <span class="material-symbols-outlined t-ok" style="font-size:20px" aria-hidden="true">task_alt</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500">Nothing on this screen needs a human right now</div>
          ${headSub}
          <div class="cell-sub" style="white-space:normal;margin-top:6px">Checked: rows the last scrape did not refresh, sources that sent no price, and unsold stock with no market reference. ${notesHtml}</div>
        </div></div></div>`;
  } else {
    alertHost.innerHTML = `<div class="card flush" style="margin-bottom:16px">
      <div class="card-head"><div style="min-width:0">
        <div class="card-title">Needs attention · ${num(alerts.length)}</div>
        ${headSub}</div></div>
      <div>${alerts.map(alertItem).join('')}</div>
      <div class="list-item" style="cursor:default">
        <span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">info</span>
        <div class="cell-sub" style="white-space:normal">${notesHtml}</div></div></div>`;
    const fire = i => { const a = alerts[Number(i)]; if (a && typeof a.act === 'function') a.act(); };
    alertHost.querySelectorAll('[data-alert]').forEach(node => {
      node.addEventListener('click', () => fire(node.dataset.alert));
      node.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(node.dataset.alert); }
      });
    });
  }

  /* ── Table chrome ────────────────────────────────────────────────────────── */
  const f = { view: 'ALL', q: '', sort: 'above_first' };
  const counts = {
    ALL: all.length, ABOVE: above.length, BELOW: belowMkt.length,
    LEVEL: level.length, NOSTOCK: notStocked.length,
    STALE: notRefreshed.length, NOPRICE: pricelessRows.length,
  };
  const offered = Object.entries(FILTERS).filter(([k]) => ALWAYS_SHOWN.has(k) || counts[k] > 0);

  const visible = () => {
    const q = f.q.trim().toLowerCase();
    return all.filter(c => {
      if (f.view === 'ABOVE' && !(c.delta > 0)) return false;
      if (f.view === 'BELOW' && !(c.delta < 0)) return false;
      if (f.view === 'LEVEL' && c.delta !== 0) return false;
      if (f.view === 'NOSTOCK' && !c.unmatched) return false;
      if (f.view === 'STALE' && !staleSet.has(c)) return false;
      if (f.view === 'NOPRICE' && c.price != null) return false;
      if (q && ![c.name, c.label, c.make, c.model].map(low).join(' ').includes(q)) return false;
      return true;
    });
  };

  /* Rows the sort key cannot speak about sink to the bottom in name order
     rather than being ranked as if they were the best or the worst. */
  const sorted = list => {
    if (f.sort === 'name') return [...list].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const key = f.sort.startsWith('above') || f.sort.startsWith('below')
      ? (c => c.delta)
      : (c => (dated(c) ? Date.parse(c.at) : null));
    const dir = (f.sort === 'below_first' || f.sort === 'oldest') ? 1 : -1;
    const known = list.filter(c => key(c) != null).sort((a, b) => dir * (key(a) - key(b)));
    const unknown = list.filter(c => key(c) == null)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return known.concat(unknown);
  };

  const matchChip = c => {
    const b = BASIS[c.basis] || BASIS.none;
    return `<span class="chip" title="${esc(b.why)}">${esc(b.chip)}</span>
      ${c.soldOnly ? '<div class="cell-sub">Only a sold unit matches</div>' : ''}
      ${c.yearNote ? `<div class="cell-sub" style="white-space:normal">${esc(c.yearNote)}</div>` : ''}`;
  };

  /* The age of the price is in the first column of every row, coloured. A table
     of gaps where the dates are one uniform grey invites the reader to treat a
     six-week-old number the same as this morning's. */
  const ageCell = c => {
    if (!dated(c)) return '<div class="cell-sub t-warm" title="This row carries no scrape timestamp, so its age is unknown.">no scrape date</div>';
    const cls = staleSet.has(c) ? 't-hot' : stale ? 't-warm' : 't-muted';
    const why = staleSet.has(c)
      ? `Collected ${dt(c.at)}. This row trails the newest row in the table by more than ${REFRESH_LAG_HOURS} h — the last scrape did not refresh it.`
      : `Collected ${dt(c.at)}.`;
    return `<div class="cell-sub ${cls}" title="${esc(why)}">${esc(ago(c.at))}${staleSet.has(c) ? ' · not refreshed' : ''}</div>`;
  };

  const cols = [
    { label: 'Competitor', strong: true, render: c => `${esc(c.name || 'Unnamed source')}
        ${ageCell(c)}` },
    { label: 'Vehicle', render: c => `${esc(c.label)}
        ${c.units.length > 1 ? `<div class="cell-sub">${num(c.units.length)} comparable units in stock</div>` : ''}` },
    { label: 'Their price', align: 'r', render: c => (c.price == null
      ? '<span class="t-muted" title="This row has no competitor price recorded.">—</span>'
      : aed(c.price)) },
    { label: 'Our list price', align: 'r', render: c => {
      if (invErr) return '<span class="t-muted" title="Inventory did not load.">—</span>';
      if (c.unmatched) return '<span class="t-muted" title="We do not stock this make and model.">not stocked</span>';
      if (c.ourPrice == null) return '<span class="t-muted" title="The matching unit carries no list price.">no price on record</span>';
      return `${aed(c.ourPrice)}${c.ourHigh !== c.ourPrice
        ? `<div class="cell-sub">lowest of ${aed(c.ourPrice)}–${aed(c.ourHigh)}</div>` : ''}`;
    } },
    { label: 'Gap vs their price', align: 'r', render: deltaCell },
    { label: 'Match', render: matchChip },
  ];

  const card = el('div', 'card flush');
  card.innerHTML = `
    <div class="card-head"><div><div class="card-title">Price comparison</div>
      <div class="card-sub">Every scraped price against the cheapest comparable unit we hold. A positive gap means we are asking more than they are.</div></div></div>
    <div class="toolbar">
      <div class="seg" id="cSeg" role="group" aria-label="Filter by where our price sits">
        ${offered.map(([k, l]) => `<button data-v="${k}">${esc(l)} · ${num(counts[k])}</button>`).join('')}
      </div>
      <div class="grow"><input type="search" id="cQ" aria-label="Search competitors and vehicles"
        placeholder="Search competitor, make or model" /></div>
      <select id="cSort" aria-label="Sort rows" style="width:auto">
        ${Object.entries(SORTS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
      </select>
      <div class="t-muted num" id="cCount"></div>
      <button class="btn sm" id="cInv">Open Inventory</button>
    </div>
    ${!invErr && !inv.length ? `<div class="banner info" style="margin:14px 20px 0">
      <span class="material-symbols-outlined">directions_car</span>
      <div>There are no vehicles in stock, so there is nothing of ours to price against these rows.</div></div>` : ''}
    <div id="cTable"></div>`;
  body.innerHTML = '';
  body.appendChild(card);
  $('cInv').addEventListener('click', () => go('inventory'));

  /* ── Making an alert land somewhere ──────────────────────────────────────
     An alert the operator cannot follow is a notification, not a tool. Each of
     these puts the thing the alert is about on screen: the row itself, the
     filtered set it belongs to, or the panel that lists it. */

  /* A brief wash of colour on the thing that was jumped to. The stylesheet's
     `.flash` rule fades out over 400 ms, which is too quick to find after a
     smooth scroll has finished moving, so the background is held inline for a
     couple of seconds and then handed back to the sheet. */
  function highlight(node) {
    if (!node) return;
    node.style.background = 'var(--primary-subtle)';
    setTimeout(() => { node.style.background = ''; }, 2200);
  }

  function focusRow(c) {
    /* Filters are cleared first: an alert must never fail to open its row
       because the operator happened to leave a filter on that excludes it. */
    f.view = 'ALL'; f.q = '';
    const q = $('cQ'); if (q) q.value = '';
    draw();
    const i = sorted(visible()).indexOf(c);
    const tr = i >= 0 ? $('cTable').querySelector(`tbody tr[data-i="${i}"]`) : null;
    (tr || card).scrollIntoView({ behavior: 'smooth', block: tr ? 'center' : 'start' });
    highlight(tr);
    drawer(c);
  }

  function focusFilter(view, q, sort) {
    f.view = view; f.q = q || '';
    if (sort) f.sort = sort;
    const box = $('cQ'); if (box) box.value = f.q;
    draw();
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* The blind-spot panel is built after this runs, so the card is read from the
     closure at click time rather than captured now. */
  let blindCard = null;
  function focusBlind() {
    const target = blindCard || blindHost;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    highlight(blindCard);
  }

  /* ── Drawer: the whole case for one row ──────────────────────────────────── */
  function drawer(c) {
    const disagrees = c.storedOur != null && c.ourPrice != null && c.storedOur !== c.ourPrice;
    const best = c.pricedUnits.length
      ? c.pricedUnits.reduce((a, u) => (uPrice(u) < uPrice(a) ? u : a))
      : null;
    const rowStale = staleSet.has(c);

    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1"><h2 style="font-size:18px">${esc(c.label)}</h2>
          <div class="cell-sub">${esc(c.name || 'Unnamed source')} · ${c.at ? `scraped ${esc(ago(c.at))}` : 'no scrape date recorded'}</div></div>
        <button class="btn ghost sm" id="dClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        ${!dated(c) ? `<div class="banner warm"><span class="material-symbols-outlined">schedule</span>
          <div>This row carries no scrape date, so there is no way to say how old the price below is.</div></div>`
        : rowStale ? `<div class="banner hot"><span class="material-symbols-outlined">sync_problem</span>
          <div>Collected ${esc(dt(c.at))} — ${esc(ago(c.at))}. The last scrape did not refresh this row: it trails the newest row in the table by more than ${REFRESH_LAG_HOURS} h, so this listing may not even exist any more.</div></div>`
        : stale ? `<div class="banner hot"><span class="material-symbols-outlined">update_disabled</span>
          <div>Collected ${esc(dt(c.at))} — ${esc(ago(c.at))}. Even the newest price on this screen is ${esc(dayWord(daysOld))} old, so the scrape has missed about ${num(missed)} ${plural(missed, 'cycle', 'cycles')}. Confirm this figure before quoting it to a customer.</div></div>`
        : `<div class="banner info"><span class="material-symbols-outlined">schedule</span>
          <div>Collected ${esc(dt(c.at))} — ${esc(ago(c.at))}.</div></div>`}
        ${c.delta == null ? `<div class="banner info"><span class="material-symbols-outlined">info</span>
          <div>${esc(c.unmatched ? BASIS.none.why : c.price == null
            ? 'This row has no competitor price, so no gap can be calculated.'
            : 'The matching unit has no list price on record, so no gap can be calculated.')}</div></div>`
          : `<div class="banner ${c.delta > 0 ? 'hot' : c.delta < 0 ? 'info' : 'warm'}">
              <span class="material-symbols-outlined">${c.delta > 0 ? 'trending_up' : c.delta < 0 ? 'trending_down' : 'trending_flat'}</span>
              <div>${c.delta === 0
                ? `We are asking exactly what ${esc(c.name || 'this competitor')} asks for this vehicle.`
                /* The sign already lives in the words "more"/"less", so the figure
                   itself is stated unsigned here; the columns above keep aedSigned(). */
                : `We are asking <strong>${esc(aed(Math.abs(c.delta)))}</strong>${c.deltaPct == null ? '' : ` (${esc(pct(Math.abs(c.deltaPct)))})`}
                   ${c.delta > 0 ? 'more than' : 'less than'} ${esc(c.name || 'this competitor')} on this vehicle.`}</div></div>`}

        <dl class="kv">
          <dt>Their price</dt><dd class="num">${c.price == null ? '—' : aed(c.price)}</dd>
          <dt>Our list price</dt><dd class="num">${c.ourPrice == null ? '—' : aed(c.ourPrice)}</dd>
          <dt>Gap</dt><dd class="num">${c.delta == null ? '—' : aedSigned(c.delta)}</dd>
          <dt>Match basis</dt><dd>${esc((BASIS[c.basis] || BASIS.none).chip)}</dd>
          <dt>Scraped</dt><dd>${c.at ? `${esc(dt(c.at))} <span class="cell-sub">· ${esc(ago(c.at))}</span>` : '—'}</dd>
        </dl>

        ${c.yearNote ? `<div class="cell-sub" style="white-space:normal;margin-top:8px">${esc(c.yearNote)}</div>` : ''}

        ${(c.contactName || c.contactPhone) ? `<div style="margin-top:20px"><div class="label-caps">Listing contact</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Name</dt><dd>${c.contactName ? esc(c.contactName) : '<span class="t-muted">—</span>'}</dd>
            <dt>Phone</dt><dd class="mono">${c.contactPhone ? esc(c.contactPhone) : '<span class="t-muted">—</span>'}</dd>
          </dl>
          <div class="cell-sub" style="white-space:normal;margin-top:6px">Recorded by the scrape from the listing itself. Where one half is missing it is shown as —; nothing here is looked up or filled in.</div></div>` : ''}

        <div style="margin-top:20px"><div class="label-caps">Comparable stock${c.units.length ? ` · ${num(c.units.length)}` : ''}</div>
          ${c.units.length ? c.units.map(u => {
            const p = uPrice(u), d = (p != null && c.price != null) ? p - c.price : null;
            return `<div class="list-item" style="cursor:default;align-items:flex-start">
              <div style="flex:1;min-width:0">
                <div style="font-weight:500">${esc(uModel(u) || 'Unnamed unit')}${uYear(u) == null ? '' : ` · ${esc(String(uYear(u)))}`}</div>
                <div class="cell-sub mono">${esc(String(uRef(u) ?? '—'))}</div>
                <div class="cell-sub">${esc(String(u.status || 'status unknown'))}${n0(u.days_in_stock) == null ? '' : ` · ${num(u.days_in_stock)} days in stock`}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div class="num">${p == null ? '—' : aed(p)}</div>
                <div class="cell-sub">${d == null ? 'no gap' : esc(aedSigned(d))}</div>
                ${String(u.aging_alert || '').toUpperCase() === 'CRITICAL' ? pill('CRITICAL', 'hot') : ''}
              </div></div>`;
          }).join('')
          : `<div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(BASIS.none.why)}</div>`}
        </div>

        <div style="margin-top:20px"><div class="label-caps">As recorded by the scrape</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Our price at scrape time</dt><dd class="num">${c.storedOur == null ? '<span class="t-muted">not recorded</span>' : aed(c.storedOur)}</dd>
            <dt>Difference at scrape time</dt><dd class="num">${c.storedDiff == null ? '<span class="t-muted">not recorded</span>' : aedSigned(c.storedDiff)}</dd>
          </dl>
          ${disagrees ? `<div class="cell-sub" style="white-space:normal;margin-top:8px">The scrape recorded our price as ${esc(aed(c.storedOur))}; inventory currently lists ${esc(aed(c.ourPrice))}. The gap above uses the live list price.</div>` : ''}
          ${c.storedDiff != null ? `<div class="cell-sub" style="white-space:normal;margin-top:6px">The stored difference is signed by the scraping workflow's own convention and is shown here unchanged, not re-derived.</div>` : ''}
        </div>

        ${c.rec ? `<div style="margin-top:20px"><div class="label-caps">AI recommendation</div>
          <div class="cell-sub" style="white-space:normal;margin-top:8px">${esc(c.rec)}</div></div>` : ''}
      </div>
      <div class="drawer-foot">
        <button class="btn primary" id="dPrice"${best ? '' : ' disabled title="No comparable unit with a list price is in stock, so there is nothing here to re-price."'}>Adjust our list price</button>
        <button class="btn" id="dInv">Open Inventory</button>
      </div>`);
    $('dClose').addEventListener('click', closeDrawer);
    $('dInv').addEventListener('click', () => { closeDrawer(); go('inventory'); });
    if (best) $('dPrice').addEventListener('click', () => { closeDrawer(); unitForm(best, inv, reload); });
  }

  function draw() {
    card.querySelectorAll('#cSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === f.view));
    $('cSort').value = f.sort;
    const list = sorted(visible());
    $('cCount').textContent = `${list.length} of ${all.length} rows`;

    const th = $('cTable');
    th.innerHTML = table(cols, list, {
      onRow: true,
      empty: `${stateEmpty('No rows match these filters',
        'Clear the search or widen the filter to see the scraped prices again.', 'search_off')}
        <div style="text-align:center;padding:0 20px 32px"><button class="btn" id="cClear">Clear filters</button></div>`,
    });
    wireRows(th, list, drawer);
    $('cClear')?.addEventListener('click', () => { f.view = 'ALL'; f.q = ''; $('cQ').value = ''; draw(); });
  }

  card.querySelectorAll('#cSeg button').forEach(b =>
    b.addEventListener('click', () => { f.view = b.dataset.v; draw(); }));
  $('cQ').addEventListener('input', e => { f.q = e.target.value; draw(); });
  $('cSort').addEventListener('change', e => { f.sort = e.target.value; draw(); });
  draw();

  /* ── Per-competitor summary and our blind spots ──────────────────────────── */
  const requireInv = () => { if (invErr) throw invErr; return true; };

  await Promise.all([
    panel(byCompHost, {
      title: 'By competitor',
      sub: 'Where each source has us beaten, and how old its data is',
      load: async () => groups,
      render: gs => (gs.length ? `<div>${gs.map((g, i) => `
        <div class="list-item" role="button" tabindex="0" data-comp="${i}" style="align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="font-weight:500">${esc(g.name)}</div>
            <div class="cell-sub">${num(g.rows.length)} price${g.rows.length === 1 ? '' : 's'} · ${g.priced === 0
              ? '<span class="t-warm">no price on any row</span>'
              : g.cmp ? `${num(g.cmp)} comparable` : 'none comparable to our stock'}
              ${g.newest ? ` · scraped ${esc(ago(g.newest))}` : ' · <span class="t-warm">no scrape date</span>'}</div>
            ${g.stale ? `<div class="cell-sub t-hot">${num(g.stale)} of its ${plural(g.rows.length, 'row', 'rows')} ${plural(g.stale, 'was', 'were')} not refreshed by the last scrape</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="${g.above ? 't-hot' : 't-muted'}" style="font-weight:500">${num(g.above)}</div>
            <div class="cell-sub">we ask more${g.below ? ` · ${num(g.below)} lower` : ''}</div>
          </div></div>`).join('')}</div>`
        : stateEmpty('No sources yet', 'No scraped row carries a competitor name.', 'storefront')),
    }).then(c => {
      /* Clicking a source filters the table to it — the same landing an alert
         about that source uses, so the two behave identically. */
      const open = i => { const g = groups[Number(i)]; if (g) focusFilter('ALL', g.name); };
      c.querySelectorAll('[data-comp]').forEach(node => {
        node.addEventListener('click', () => open(node.dataset.comp));
        node.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(node.dataset.comp); }
        });
      });
    }),

    panel(blindHost, {
      title: 'Stock with no market reference',
      sub: 'Unsold units no scraped row matches — priced on instinct, not on evidence. A rival undercutting one of these would not appear anywhere on this screen.',
      actions: '<button class="btn sm" data-act="inv">Open Inventory</button>',
      load: async () => { requireInv(); return blindUnits; },
      render: units => (units.length ? `<div>${units.slice(0, 12).map((u, i) => `
        <div class="list-item" role="button" tabindex="0" data-unit="${i}" style="align-items:flex-start">
          <span class="material-symbols-outlined t-muted" style="font-size:20px" aria-hidden="true">price_check</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:500">${esc(vehicleLabel(uMake(u), uModel(u), uYear(u)) || 'Unnamed unit')}</div>
            <div class="cell-sub mono">${esc(String(uRef(u) ?? '—'))}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="num">${uPrice(u) == null ? '—' : aed(uPrice(u))}</div>
            <div class="cell-sub">${n0(u.days_in_stock) == null ? 'no acquisition date' : `${num(u.days_in_stock)} days in stock`}</div>
          </div></div>`).join('')}
        ${units.length > 12 ? `<div class="list-item" style="cursor:default"><div class="cell-sub">${num(units.length - 12)} more unit${units.length - 12 === 1 ? '' : 's'} have no scraped comparison</div></div>` : ''}</div>`
        : stateEmpty('Every unsold unit has a market reference',
          'Each car on the lot is matched by at least one scraped competitor price.', 'price_check')),
    }).then(c => {
      blindCard = c;
      c.querySelector('[data-act="inv"]')?.addEventListener('click', () => go('inventory'));
      /* There is no comparison row to open for these — that is the whole point
         of the panel — so the row opens the unit's own price form instead. */
      const open = i => { const u = blindUnits[Number(i)]; if (u) unitForm(u, inv, reload); };
      c.querySelectorAll('[data-unit]').forEach(node => {
        node.addEventListener('click', () => open(node.dataset.unit));
        node.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(node.dataset.unit); }
        });
      });
    }),
  ]);
};

/* ==========================================================================
   S6 · Ask AI
   ========================================================================== */
