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
       nightly columns and does not import deriveUnit().
     · The drawer's competitor comparison leads to an empty table now, so it is
       read once and disabled with the reason rather than promising a comparison
       that no longer exists.

   1 Sep 2026, the platform-truth pass. Two of the three notes above stopped being
   true of the database — the sale is gone and the competitors table is not empty
   — and one thing this screen had never said turned out to be the most important
   fact on it.

     · THE TWO AGEING DEFINITIONS DO NOT AGREE, and nothing here knew it. This
       screen derives the band live through lib/unit-form.js INV: WARNING at 75
       days, CRITICAL at 120. The nightly job is Postgres
       `recompute_inventory_derived()` — its body read live on 1 Sep 2026, and
       architecture/schema.sql:826 says it in words — which raises WARNING at 90.
       CRITICAL agrees at 120; WARNING does not. A unit between 75 and 89 days is
       therefore WARNING here and HEALTHY in the stored column on the same day
       with both jobs working perfectly, and the drift alert used to report
       exactly that as "the nightly recompute has not run" — sending somebody to
       restart a job that was never late. It is now a finding of its own,
       `band_definition`, and the drift alert is only about lag again.
     · Which is also why the two currently agree. On 1 Sep 2026 the lot runs 21,
       23, 25, 28, 31, 34, 37, 44, 54, 107, 113 and 148 days in stock, so not one
       unit sits in the 75–89 window and the stored bands match the live ones on
       all twelve. That is a property of today's dates, not of the two jobs
       agreeing, and the provenance block now says which of the two it is.
     · `purchase_history` is empty — 0 rows, read 1 Sep 2026. The 24 Aug
       contradiction is gone because the sale row is gone, not because anything
       was reconciled, and nothing on this screen asserts it any more. The check
       itself stays: it is the only thing in the product that would catch the
       next one. It also stopped lying about its own reach — a sale whose vehicle
       text is too short to match now says the matcher declined to try, rather
       than "no unit on this table matches", which is a claim about the lot that
       was never tested.
     · `competitors` is no longer empty: 11 rows, 5 of them newest-per-(competitor,
       model) in `v_competitor_latest` (counted live 1 Sep 2026, 14:18 UTC; it
       was 9 and 3 earlier the same day, and the scraper appends, so expect both
       to keep climbing). The disabled button and its sentence about the table
       having been emptied are both false now, so the drawer reads the view and
       says what it found for THIS unit. Nine of the 11 predate the scraper's
       `match_quality` columns and carry NULL there — UNRATED, which is not the
       same as weak — and the two written since the scraper rewrite are both
       rated `weak`. Neither answer entitles this screen to a comparison, so no
       pricing conclusion is drawn from any of the 11: only the scraped price
       and the reason it cannot settle anything. The two reasons are different
       and MATCH_WORDS keeps them apart — "nothing on the page tied that price
       to this car" is evidence, "nothing was recorded either way" is not.
     · The nightly job is checked rather than assumed. This screen told the
       reader the stored columns "were last written by the nightly job" without
       ever asking whether it had run; that is a provenance claim, and it is now
       read from `v_workflow_health` through lib/health.js, the only module
       allowed to interpret an audit_log status. Live on 1 Sep 2026, 09:44 UTC:
       Inventory Ageing Recompute, HEALTHY, 17 runs in 30 days, 17 of them
       SUCCESS, last run 31 Aug 20:15 UTC. Its audit_log summaries were read too,
       because a job that succeeds while touching nothing is the shape of a job
       not doing its work: 15 of those 17 runs say "for 12 units" and only the
       two oldest, 14 and 15 Aug, say "for 0 units" — from before the lot was
       loaded. So there is no live finding there, and none is manufactured. That
       is a fact about the summaries, not about the view, and the view carries no
       summary column, so this screen does not assert it on the page.

   1 Sep 2026, second pass. The pass above split the definition gap out of the
   drift alert but left three claims behind it that the data can reach.

     · THE DRIFT ALERT DIAGNOSED A CAUSE IT HAD NOT ESTABLISHED. It ended with a
       flat "This is lag: more than one day of it means the nightly recompute has
       not run" whatever had actually differed — so a list price raised this
       morning (net margin moves, nothing else does) and a stored band flip that
       nothing explains both read as a job that had failed overnight. That is the
       same fault as the 75-versus-90 confusion, one layer down: a real
       disagreement reported under the wrong cause, sending somebody to restart a
       job that ran. The three causes are now counted apart and said apart.
     · THE COMPARISON RAN ON UNDATED UNITS, where it cannot mean anything. Days
       and holding cost were gated on an acquisition date; the band and net
       margin were not. `recompute_inventory_derived()` updates `where
       acquired_at is not null`, so the nightly job never touches an undated row —
       its stored columns are frozen, not stale — while deriveUnit() derives the
       "live" side of all four from the stored day count. An undated unit at 80
       stored days therefore produced a CRITICAL reading "band HEALTHY stored vs
       WARNING live … in a way the threshold difference does not account for",
       when it is exactly the threshold difference measured against a fallback,
       about a unit whose Days, Holding cost, Net margin and Alert cells all read
       "—" three inches below because this screen had already ruled it could not
       state them. All four columns are gated now, and the skipped units are
       counted out loud.
     · THE HEADLINE CONTRADICTED THE ALERTS IT CLAIMED TO SUMMARISE. The
       provenance block counted a unit whose stored band is empty or unrecognised
       as sitting "in a different band under the two, and the alerts above name
       them", while the alert for those same units said the stored band "was not
       compared against the live one at all". Both sentences on one screen. Only
       readable bands are compared now; the rest are reported as uncompared. The
       "only these stored columns came back" caveat also stopped being an
       `else if` on the drift alert — it used to vanish at exactly the moment the
       comparison found something, which is when a reader most needs to know how
       much of it ran.

   1 Sep 2026, third pass. A SAVE NO LONGER TOUCHES THE STORED COLUMNS, and two
   alerts on this screen were telling operators the opposite.

   lib/unit-form.js unitRow() — read as it stands today, not remembered — sends
   exactly id, model, vin, status, acquired_at, price_aed, cost_aed and
   ai_recommendation. Every derived column it used to recompute in the browser
   and write alongside them is gone: days_in_stock, holding_cost_accrued,
   gross_margin, net_margin, vat_amount, recommended_commission, aging_alert.
   The reason is the `inventory` table comment at architecture/schema.sql:160,
   which says those columns "are DERIVED and are recomputed wholesale by
   recompute_inventory_derived() ... Do not hand-edit them", and the browser was
   hand-editing them under a different threshold rule — so a save was
   manufacturing the very stored_drift alert this screen raises, clearing it,
   and having the next nightly run bring it straight back. Neither event meant
   anything about the data.

   Two sentences here were written for the old behaviour and are now corrected.
   `stored_drift` ended "saving a unit from its Edit form writes the same live
   recompute back to the stored columns, which is what clears this" — a save
   will not clear it, and sending an operator to save twelve units to fix a lag
   is the same shape of wrong answer as sending them to restart a job that ran.
   `band_definition` claimed a save "writes 75-day banding into the stored
   column"; it no longer writes any band. What clears the drift is the
   Inventory Ageing Recompute workflow calling recompute_inventory_derived().
   That workflow lives in n8n and runs at 00:15 Asia/Dubai — its audit_log rows
   land at 20:15 UTC every night, which is the same instant — and it is NOT a
   pg_cron job. Comments elsewhere in this repo have called the recompute
   "nightly Postgres" and some have implied cron; `cron.job` on the live
   database holds exactly one entry, nexus-daily-metrics, running
   capture_daily_metrics() at 19:50 UTC (read live 1 Sep 2026). The function is
   Postgres; the schedule is not.

   The cost of that change, stated here because this screen is where it shows:
   a unit added or edited with a backdated acquisition date carries empty or
   previous stored figures until the recompute next runs, so this screen and
   Overview will legitimately disagree for up to a day. That is the lag arm of
   stored_drift doing its job, not a fault.

   What Overview does, read out of overview.js again on 1 Sep 2026 rather than
   remembered. overview.js:650 selects exactly
   `id,model,days_in_stock,price_aed,holding_cost_accrued,aging_alert` and the
   file's import list carries no deriveUnit(), so Overview is reading the stored
   nightly columns — the structural fact the provenance block below depends on.
   Its "units at risk" figures are overview.js:709-720, `up(i.aging_alert) ===
   'CRITICAL'`, and the holding and list totals beside them are summed over that
   same filtered set. There is no `status` in its select and it needs none: both
   band definitions force a sold unit to HEALTHY — lib/unit-form.js deriveUnit(),
   and `when d.sold then 'HEALTHY'` in recompute_inventory_derived(), both read
   on 1 Sep 2026 — so a sold unit is excluded from its money-at-risk by the band
   before status could matter. With one exception worth naming rather than
   glossing: a SOLD unit with no acquisition date is not covered by either rule,
   because the Postgres update skips it and deriveUnit() now returns null for
   it, so whatever band was last written to that row stands and Overview would
   still count it. No such row exists today — all twelve units carry a date
   (read live 1 Sep 2026) — and this screen's no_acquired_at alert is what would
   surface one.

   Those line numbers were re-taken from overview.js on 1 Sep 2026 after that
   file was edited the same day; they are dated for the same reason the figures
   are, and a line number in another file is the fastest of all of these to rot.

   What this file deliberately does NOT say about Overview is anything about
   Overview's on-screen wording. An older note here claimed a reader "is not told
   which of the two they are looking at"; that is a sentence in another file,
   which is not this one's to characterise and goes stale the first time somebody
   rewrites it. (For the record, and only as a dated observation rather than a
   claim this screen renders: on 1 Sep 2026 Overview names the stored/live split
   in a code comment at overview.js:993 and not in any string it paints.)
   Everything said above about Overview is a fact about what it reads, checked
   against the file, and dated so the next reader knows to check it again rather
   than trust it. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, dubaiDate, dubaiStamp, esc, n0, num, pill, tone } from '../lib/format.js';
import { healthWords, successRate } from '../lib/health.js';
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

/* deriveUnit() USED TO be unable to hand back an unknown day count. With no
   `acquired_at` it fell back to `n0(u.days_in_stock) || 0`, and that `|| 0`
   turned an empty stored column into a zero — so an undated unit arrived on
   this screen as 0 days, HEALTHY, with a green bar reading "0 of 120 days to
   critical", and was averaged into "Average days in stock" as a zero under a
   caption saying the mean came "from their acquisition dates". A missing record
   rendering as the newest car on the lot is the plausible-zero failure this
   pass exists to end, and three guards in this file were written against a null
   that could never arrive.

   That fallback is gone: read on 1 Sep 2026, lib/unit-form.js deriveUnit()
   returns null for days_in_stock, holding_cost_accrued, net_margin,
   recommended_commission and aging_alert on a unit with no acquired_at, so the
   guards below can finally reach the null they were written for. The guards
   stay exactly as they are, and deliberately so: they decide from the raw
   `acquired_at` column rather than from what deriveUnit() happened to return,
   which is why this screen was correct through the old behaviour and is correct
   through the new one. No date, no day count, no band, no holding figure, and it
   says so in each place rather than printing a number it cannot stand behind.
   Nothing below should be rewritten to trust deriveUnit()'s null instead — a
   guard that only works while another module keeps its current shape is how
   this failure got here. */
const dated = u => !!String(u.acquired_at == null ? '' : u.acquired_at).trim();
const daysOf = u => (dated(u) ? n0(u.days_in_stock) : null);
/* Same rule for the two figures that are days × a rate. A unit with no date has
   no live holding cost either. deriveUnit() answers null for it now; it used to
   answer the stored day count times fifty dirhams, a stored figure wearing a
   live label, and this guard predates the fix. */
const holdingOf = u => (dated(u) ? n0(u.holding_cost_accrued) : null);
/* The live band, or nothing. `aging_alert` on an undated unit is null from
   deriveUnit() today and was whatever band the fabricated day count fell into
   before that. Neither is a fact about the car. */
const bandOf = u => (dated(u) ? up(u.aging_alert) : '');

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
/* v_competitor_latest is already one row per (competitor, model); this bound is
   only so the read cannot become unbounded if the scraper is pointed at a
   catalogue. If it is ever hit the drawer says so rather than presenting the
   listings it happened to get as everything there is. */
const COMP_LIMIT = 500;

/* How far the stored columns may lag before they are called wrong. They are
   recomputed nightly, so a row is legitimately a day stale for most of the
   working day; two days means a run was missed. The test below is therefore
   "more than one day of lag", not "more than two" — until 1 Sep 2026 the
   constant was 2 and the comparison was `> DRIFT_DAYS`, so the exact case the
   comment named as a missed run was the one case that could never fire, and the
   alert did not fire on the condition it claimed. Holding cost is days × the
   daily rate, so the same tolerance converts straight into money, and net margin
   moves with holding cost. */
const LAG_DAYS = 1;
const LAG_AED = LAG_DAYS * INV.HOLDING_PER_DAY;
const SHOWN_REFS = 4;

/* The nightly job's WARNING threshold, which is NOT this screen's, and the
   single most consequential disagreement in this file.

   `recompute_inventory_derived()` — body read live on 1 Sep 2026, and
   architecture/schema.sql:826 states it as "WARNING at 90 days and CRITICAL at
   120" — raises WARNING at 90. lib/unit-form.js raises it at INV.WARN_DAYS = 75.
   CRITICAL is 120 on both sides, so the two only part company between 75 and 89
   days, where the same car is amber on this screen and green in every consumer
   of the stored column: Overview, the n8n workflows and the Finance Desk.

   Neither number is wrong here; only one of them can be the dealership's policy,
   and that is a decision for a person. What this file must not do is what it did
   before today, which was report the difference as staleness. */
const STORED_WARN_DAYS = 90;
/* Live-WARNING, stored-HEALTHY, and correct under both definitions. */
const inBandGap = d => d != null && d >= INV.WARN_DAYS && d < STORED_WARN_DAYS;

/* The recompute's own name in workflow_registry / v_workflow_health. Matched
   exactly rather than by pattern: two workflows whose names both contain
   "inventory" would otherwise be averaged into one health verdict. */
const RECOMPUTE_WORKFLOW = 'Inventory Ageing Recompute';
/* The stored columns are only as fresh as the last run, so a run older than
   this is itself the explanation for any drift below. One nightly cycle plus
   the slack the lag tolerance already allows. */
const RECOMPUTE_STALE_HOURS = 48;

const str = v => String(v == null ? '' : v).trim();
const plural = (n, one, many) => (Number(n) === 1 ? one : many);

/* Dates that are days, not moments. purchase_date is a calendar date, so it is
   anchored to UTC midnight and then read back on the showroom's clock: Dubai is
   UTC+4 and never moves, so UTC midnight is always the same calendar day there
   and the printed day cannot drift with the reader's browser. Anchoring to the
   browser's local midnight, as this did, showed a purchase made on the 7th as
   the 6th to anyone east of Dubai. */
const dateLabel = d => {
  const v = str(d);
  if (!v) return 'a date the record does not carry';
  return dubaiDate(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T00:00:00Z' : v, v);
};

/* ── Sales that this table does not know about ────────────────────────────
   `purchase_history` has no reference to a stock number and `inventory` has no
   sale date, so the only bridge between a completed sale and a unit is the
   sale's free-text `vehicle` against the unit's free-text `model`. That is a
   guess and every sentence built on it has to say so — which is also why the
   match is never used to change a status, only to name the units worth looking
   at. Two shared words is the floor: "2024" alone, or "Toyota" alone, matches
   half a lot.

   "No reference to a stock number" was re-checked against information_schema on
   1 Sep 2026 rather than carried forward, because purchase_history does carry a
   `deal_id` and that looks like the missing key. It is not one: there is no
   `deals` table on this database at all — only `deals_embeddings`, whose own
   deal_id leads nowhere near a stock number — so the column joins to nothing
   and the text match above is still the only bridge there is. */
const SALE_NOISE = new Set(['the', 'a', 'and', 'aed', 'edition', 'model', 'used', 'new', 'car', 'suv']);
const words = v => str(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  .split(' ').filter(w => w && !SALE_NOISE.has(w));

/* Null when the matcher declined to try; an array — possibly empty — when it
   did. Both used to come back as `[]`, and the alert then printed "No unit on
   this table matches the description at all", which is a statement about the
   lot made without looking at it: a sale recorded as "Patrol", "Wrangler" or
   "Used Patrol" is one word after the noise list, so the matcher refused, and a
   dozen Nissan Patrols could have been sitting on the lot behind that sentence.
   It cost twice over, because the same empty array also downgraded the alert
   from CRITICAL to WARNING — painting the one sale nobody can trace amber. */
function saleCandidates(sale, inv) {
  const want = words(sale && sale.vehicle);
  if (want.length < 2) return null;
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
    const tried = saleCandidates(sale, inv);
    const cands = tried || [];
    for (const u of cands) {
      const k = String(u.id);
      if (!byUnit.has(k)) byUnit.set(k, []);
      byUnit.get(k).push(sale);
    }
    /* `untried` travels with the sale so the alert can tell the operator which
       of the two silences this is. */
    if (!cands.some(isSold)) {
      unreconciled.push({ sale, candidates: cands.filter(u => !isSold(u)), untried: tried === null });
    }
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
   use CRITICAL | WARNING | LOW. lib/format.js now colours all of them and gives
   anything it does not recognise its own 'unknown' tone rather than an unstyled
   pill that would read as "fine", so this screen keeps no severity map of its
   own. An unrankable severity sorts where cold does below. */
const sevRank = s => ({ hot: 0, warm: 1, cold: 2, ok: 3 }[tone(s)] ?? 2);

/* The stored column says OK where deriveUnit() says HEALTHY: the same band
   under two names. Normalising before any comparison stops every healthy unit
   reading as a disagreement — and, the way that actually bites, stops a real
   OK-stored / CRITICAL-live flip being dropped as an unrecognised word. */
const band = v => (up(v) === 'OK' ? 'HEALTHY' : up(v));
const KIND_ICON = { inventory_aging:'directions_car', undercut:'trending_down' };

/* v_needs_attention does not use `at` to mean the same thing on every arm. The
   `inventory_aging` arm — read from the view definition on 1 Sep 2026 — is
   `now() AS at`, the moment the query ran, so ago() printed "just now" for a car
   that has been on the lot since April, under a tooltip claiming it was how long
   the view had been reporting it. That is a provenance sentence about a column
   that carries no such fact. Overview states the same thing for the same kind;
   this screen must not contradict it. The age that matters for this kind is in
   the view's own detail text, built from days_in_stock. */
const AT_IS_QUERY_TIME = new Set(['inventory_aging']);

/* What the scraper recorded about how it tied a listing to one of our cars, and
   what each answer entitles this screen to say. The columns arrived with the
   scraper rewrite; every row written before it carries NULL, which is UNRATED —
   nothing was recorded either way — and unrated is not weak. Both of them stop a
   price comparison, for different reasons, and the difference is said out loud
   rather than collapsed into one hedge.

   The rule this table exists to enforce: a price is only a comparison when
   something on the competitor's page tied it to this car. Otherwise the number
   is shown as a number and no conclusion is drawn from it. */
const MATCH_WORDS = {
  exact_year: { compare: true, say: 'matched on model and year' },
  model_only: { compare: false, say: 'matched on model alone — the year was never checked, and a model year is a large part of the price of a car' },
  weak: { compare: false, say: 'rated a weak match by the scraper: nothing on the page tied that price to this car' },
};
const UNRATED_MATCH = { compare: false, say: 'unrated — this row predates the scraper\'s match columns, so nothing was recorded about what was compared. That is not the same as a weak match; it is no evidence either way' };
const matchWords = c => MATCH_WORDS[String(c && c.match_quality || '').toLowerCase()] || UNRATED_MATCH;

/* Is the stored figure older than one nightly cycle plus the slack the lag
   tolerance already allows? Null when there is nothing to date it by, which is
   not the same as fresh. */
const jobStale = job => {
  const t = job && job.row && job.row.last_run ? Date.parse(job.row.last_run) : NaN;
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3600000 > RECOMPUTE_STALE_HOURS;
};

/* One sentence about the job that writes the stored columns, or an honest
   absence. "The stored figures were last written by the nightly job" is a claim
   about a workflow, and this screen asserted it for a week without ever asking
   whether the workflow had run. It is read from v_workflow_health now, and every
   word for a health state comes from lib/health.js — the only module allowed to
   say what an audit_log status means. Plain text: the caller escapes it. */
function jobLine(job) {
  if (!job || job.err) {
    return `Whether that job has actually run could not be checked${job && job.err ? ` (${job.err})` : ''}, so nothing here states when the stored columns were last written.`;
  }
  if (!job.row) {
    return job.ambiguous
      ? `More than one row in v_workflow_health is named "${RECOMPUTE_WORKFLOW}", so which of them writes the stored columns cannot be told apart from here and none of them is reported — attributing one workflow's runs to another would be worse than saying nothing.`
      : `No row in v_workflow_health is named "${RECOMPUTE_WORKFLOW}", so whether the job that writes the stored columns still runs is unknown from here — which is itself worth fixing.`;
  }
  const w = job.row;
  const hw = healthWords(w.health);
  const rate = successRate(w.successes_30d, w.effective_runs_30d);
  const runs = n0(w.runs_30d);
  const stale = jobStale(job);
  return `${RECOMPUTE_WORKFLOW}: ${hw.label} — ${hw.blurb}`
    + (runs
      ? ` ${num(runs)} ${plural(runs, 'run', 'runs')} logged in 30 days`
        + (rate == null
          ? ', none of them rated, so no success rate is quoted rather than a 0% or a 100% that would both be inventions.'
          : `, ${num(Math.round(rate))}% of the rated ones succeeding.`)
      : ' No run at all is logged for it in the last 30 days.')
    + (w.last_run ? ` Last run ${ago(w.last_run)}, ${dubaiStamp(w.last_run)}.` : ' Nothing has ever been logged for it.')
    + (stale === true ? ` That is more than ${num(RECOMPUTE_STALE_HOURS)} hours ago, so the stored columns are behind by at least one nightly cycle and any lag below is explained by that before anything else.` : '');
}

/* Derives every inventory-specific alert from rows already fetched. Returns the
   alerts and, separately, the sentences that qualify them — a check that could
   not run is not the same as a check that passed, and only the second one is
   allowed to leave the strip silent. */
function deriveAlerts(inv, raw, recon, salesErr, job) {
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
      /* An explicit note wins even when there is no date to attach it to: an
         alert about a workflow has no acquisition date and must not inherit the
         sentence written for one that does. */
      atNote: opts.atNote != null ? opts.atNote
        : opts.at ? ''
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
    /* Sales the matcher would not touch. Counted, because "nothing matched" and
       "nothing was compared" have to reach the reader as different sentences. */
    const untried = open.filter(o => o.untried).length;
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
    /* An untried sale is not a quieter finding than a matched one. It is the
       loudest: a completed sale that cannot be tied to any row, and not because
       the lot was searched and came up empty. */
    add('unmarked_sale', (cands.length || untried) ? 'CRITICAL' : 'WARNING', 'sell',
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
        : untried === open.length
          ? ` No unit was checked. ${plural(open.length, 'The sale carries', 'The sales carry')} too little vehicle text to match on — fewer than two words once "used", "new", "model" and the like are dropped — so the matcher declined to guess rather than pairing a car to a single word. Whether the vehicle is on this table is unknown, not answered.`
          : untried
            ? ` ${num(open.length - untried)} of ${plural(open.length, 'it was', 'them were')} checked against every unit here and matched nothing; the other ${num(untried)} ${plural(untried, 'carries', 'carry')} too little vehicle text to check at all, so ${plural(untried, 'it was', 'they were')} not compared with anything.`
            : ' Every unit on this table was checked against the description and none matched.')
      + ' Nothing in the database can settle which it is: whether the car was sold and never marked, or was never a row here.'
      + (cands.length
        ? ` Until one is marked Sold it stays inside the stock value, stays quotable, keeps accruing ${aed(INV.HOLDING_PER_DAY)} a day, and can be sold a second time. Status is editable from the unit itself — inventory is one of the three tables this browser is allowed to write — but marking it Sold records only the status: there is no sale date column, so the day it left the lot will still be unrecorded and its true days on the lot will still not be reconstructable.`
        : ''),
      cands,
      {
        noFocus: untried === open.length
          ? 'The sale carries too little vehicle text to match against anything, so no unit was identified and there is no row here to open. That is the matcher declining, not the lot being searched.'
          : 'No unit on this table matches the sale by description, so there is no row here to open.',
        /* The one date in this alert that is a fact: purchase_history records
           when the sale happened. The candidate unit's acquisition date is the
           age of a guess, not of the finding. */
        at: saleAt,
        atNote: open.length === 1 ? 'The date of the recorded sale.'
          : 'The most recent of the recorded sales in this alert.',
      });
  }

  /* No acquisition date, and therefore no ageing at all. Raised as a finding
     rather than absorbed, because every ageing and margin figure on this screen
     counts from that one column and deriveUnit() answers zero where it is
     empty — so before today an undated unit was not merely unmeasured, it was
     measured as brand new. */
  const undated = inv.filter(u => !dated(u));
  if (undated.length) {
    const onLot = undated.filter(u => !isSold(u)).length;
    add('no_acquired_at', onLot ? 'WARNING' : 'LOW', 'event_busy',
      `${num(undated.length)} ${plural(undated.length, 'unit has', 'units have')} no acquisition date`,
      `${refList(undated)}. Days in stock, holding cost, the ageing band and the net margin are all counted from that date, so none of them can be stated for ${plural(undated.length, 'this unit', 'these units')}. `
      + `deriveUnit() used to fall back to the stored days_in_stock and to zero where that was empty, which is why ${plural(undated.length, 'it read', 'they read')} as the newest ${plural(undated.length, 'car', 'cars')} on the lot; it returns nothing at all for an undated unit as of 1 Sep 2026. This screen prints "—" either way and leaves ${plural(undated.length, 'it', 'them')} out of every live count, average and band on the page, so they are missing from those totals rather than flattering them. `
      + `The stored columns are no fallback either: recompute_inventory_derived() updates only rows where acquired_at is not null (body read live 1 Sep 2026), so the nightly job has never written ${plural(undated.length, 'this row', 'these rows')} and never will — whatever the stored days, holding cost and band hold is frozen wherever it was last written, which is why ${plural(undated.length, 'it is', 'they are')} left out of the stored-versus-live comparison rather than reported as stale. `
      + `The unit form requires a date, so ${plural(undated.length, 'this row', 'these rows')} did not come from it — an ERP import or a hand-written insert is where to look.`,
      undated);
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

  /* ── Stored versus live ──────────────────────────────────────────────────
     `days_in_stock`, `holding_cost_accrued`, `net_margin` and `aging_alert` are
     written to the table by the nightly job AND computed live by deriveUnit();
     this screen shows the live figure, while Overview, n8n and the Finance Desk
     read the stored one. Where the two disagree, neither is "the truth" to
     quietly prefer — the disagreement is the finding.

     But there are two different disagreements here and they were being reported
     as one. LAG is the stored column being behind the calendar, and it is fixed
     by the nightly job running. A DEFINITION GAP is the two recomputes using
     different thresholds — 75 days here, 90 in Postgres — and no amount of
     running the job will close it; only a person deciding which number is the
     dealership's policy will. Until 1 Sep 2026 a unit at 80 days produced
     "the nightly recompute has not run" on a night it had run perfectly. */
  /* The job itself, before its output is judged. A recompute that has stopped
     explains every stored figure on the page, and it is the one fault here that
     no amount of reading the rows would reveal. */
  if (job && job.err) {
    notes.push(`v_workflow_health could not be read (${job.err}), so this screen cannot say when the stored ageing columns were last written or whether the job that writes them is still running. Everything below is the live recompute and is unaffected.`);
  } else if (job && !job.row) {
    notes.push(jobLine(job));
  } else if (job && job.row) {
    const stale = jobStale(job);
    const hw = healthWords(job.row.health);
    if (stale === true || hw.tone === 'hot') {
      add('recompute_job', stale === true ? 'CRITICAL' : 'WARNING', 'schedule',
        stale === true ? 'The nightly ageing recompute is overdue'
          : `The nightly ageing recompute is ${hw.label.toLowerCase()}`,
        `${jobLine(job)} Nothing on this screen depends on it — every figure here is recomputed in this browser — but Overview, the n8n ageing campaigns and the Finance Desk read the stored columns, so they are working from whatever that job last wrote.`,
        [],
        {
          noFocus: 'This is about a workflow, not a unit, so there is no row here to open. The Automation screen holds its run history.',
          at: job.row.last_run || null,
          atNote: job.row.last_run
            ? 'When the recompute last logged a run of any kind — not necessarily a successful one.'
            : 'Nothing has ever been logged for this workflow, so there is no date to show.',
        });
    }
  }

  const storedCols = ['days_in_stock', 'holding_cost_accrued', 'net_margin', 'aging_alert'].filter(has);
  if (!storedCols.length) {
    notes.push('None of the stored aging columns came back with these rows, so the stored figures could not be compared against the live recompute.');
  } else {
    const rawById = new Map((raw || []).map(r => [String(r.id), r]));
    const drift = [];
    const defGap = [];
    /* Counted so a silent comparison cannot be reported as a passing one: a
       stored band that is absent, or is a word this screen does not recognise,
       is a check that did not run. The two are counted apart because they are
       different faults — an empty column is a row the nightly job has never
       written, and an unrecognised word is a writer this app does not know
       about. */
    let unreadableBand = 0;
    let missingBand = 0;
    /* Unsold units the comparison could not cover at all, because they carry no
       acquisition date. See the gate inside the loop. */
    let undatedSkipped = 0;
    for (const u of inv) {
      /* Sold units are excluded by construction, not by choice: deriveUnit()
         hands a sold unit its stored holding cost straight back, so that column
         can never disagree, while its day count keeps running from acquisition
         after the sale. Comparing them would need a rule for what a sold unit's
         day count means, and inventing one here would manufacture alerts. */
      if (isSold(u)) continue;
      const r = rawById.get(String(u.id));
      if (!r) continue;
      /* THE WHOLE COMPARISON IS GATED ON AN ACQUISITION DATE, all four columns,
         and until 1 Sep 2026 only two of them were.

         Two independent reasons, and either alone is enough. There is no live
         side to compare on an undated row: deriveUnit() returns null for all
         four as of 1 Sep 2026, and before that it fell back to the stored day
         count, which made the "live" side a restatement of the stored one and
         the comparison a number against itself. And `recompute_inventory_derived()`
         — body read live on 1 Sep 2026 — updates `from … where acquired_at is
         not null`, so the nightly job never touches an undated row at all: its
         stored columns are frozen wherever they were last written, and no
         amount of the job running will ever reconcile them.

         Ungated, the band check turned that into a CRITICAL. An undated unit
         with a stored day count of 80 was HEALTHY in the stored column (90-day
         threshold) and WARNING off deriveUnit's fallback (75), and since
         daysOf() is null for it the defGap test could not catch it — so it was
         reported as a real flip, "in a way the threshold difference does not
         account for", about a unit whose Days, Holding cost, Net margin and
         Alert cells on the same page all read "—" because this screen had
         already decided it could not state them. Net margin did the same in
         money: it quoted a live figure the table refuses to print.

         Undated units are not silently dropped — they have the no_acquired_at
         alert above, and the count below keeps the gap visible. */
      const hasDate = dated(u);
      if (!hasDate) { undatedSkipped += 1; continue; }
      /* What actually differs, kept apart from what it means. `lag` is the
         stored figure trailing the calendar and is what a missed nightly run
         looks like; `repriced` is net margin alone, which moves the moment
         somebody edits a price or a cost and says nothing about the job;
         `flipped` is a band difference the two thresholds do not explain. */
      const why = [];
      let lagged = false, repriced = false, flipped = false;
      if (has('days_in_stock')) {
        const v = n0(r.days_in_stock);
        if (v != null && Math.abs(v - u.days_in_stock) > LAG_DAYS) { lagged = true; why.push(`days ${num(v)} stored vs ${num(u.days_in_stock)} live`); }
      }
      if (has('holding_cost_accrued')) {
        const v = n0(r.holding_cost_accrued);
        if (v != null && Math.abs(v - u.holding_cost_accrued) > LAG_AED) { lagged = true; why.push(`holding cost ${aed(v)} stored vs ${aed(u.holding_cost_accrued)} live`); }
      }
      if (has('aging_alert')) {
        const v = band(r.aging_alert);
        const liveBand = band(u.aging_alert);
        if (!v) {
          missingBand += 1;
        } else if (!ALERTS.includes(v)) {
          unreadableBand += 1;
        } else if (v !== liveBand) {
          /* The 75–89 window, and only that window: HEALTHY stored, WARNING
             live, both correct under their own threshold. Anything else — a
             CRITICAL that has not appeared in the stored column, a band that
             moved the wrong way — is a real flip and stays in the drift alert. */
          if (v === 'HEALTHY' && liveBand === 'WARNING' && inBandGap(daysOf(u))) {
            defGap.push(u);
          } else {
            flipped = true;
            why.push(`band ${v} stored vs ${liveBand} live`);
          }
        }
      }
      if (has('net_margin') && priced(u)) {
        const v = n0(r.net_margin);
        /* Net margin legitimately moves with holding cost, so it is allowed the
           same slack plus a rounding dirham; anything past that is a price or a
           cost that changed after the last nightly run — an edit, not a late
           job, which is why it is flagged separately below rather than being
           reported as staleness. */
        if (v != null && Math.abs(v - u.net_margin) > LAG_AED + 1) { repriced = true; why.push(`net margin ${aed(v)} stored vs ${aed(u.net_margin)} live`); }
      }
      if (why.length) drift.push({ u, why, lagged, repriced, flipped });
    }

    /* The definition gap first: it is the one a reader will otherwise "fix" by
       restarting a job, and it is the one that makes this screen and Overview
       print different counts on a day when everything is working. */
    if (defGap.length) {
      add('band_definition', 'WARNING', 'rule',
        `${num(defGap.length)} unsold ${plural(defGap.length, 'unit is', 'units are')} WARNING here and HEALTHY in the stored column`,
        `${refList(defGap)}. Nothing is stale and nothing has failed. This screen raises WARNING at ${num(INV.WARN_DAYS)} days (lib/unit-form.js INV.WARN_DAYS) and the nightly Postgres job recompute_inventory_derived() raises it at ${num(STORED_WARN_DAYS)} (architecture/schema.sql:826); CRITICAL is ${num(INV.CRITICAL_DAYS)} on both sides. Between those two numbers the same car is amber here and green in Overview, in the n8n workflows and on the Finance Desk, and an ageing campaign keyed on the stored column will not fire for ${plural(defGap.length, 'it', 'them')}. Only one of the two can be the dealership's policy, and choosing is not something this screen can do. It is not something a save can do either, any more: until 1 Sep 2026 saving the unit from its Edit form wrote ${num(INV.WARN_DAYS)}-day banding into the stored column, which changed the answer without settling the question and manufactured the drift alert below. The form stopped writing the derived columns that day, so the stored side now stays on the ${num(STORED_WARN_DAYS)}-day rule until a person changes one of the two thresholds.`,
        defGap);
    }

    if (drift.length) {
      const flips = drift.filter(d => d.flipped).length;
      const lags = drift.filter(d => d.lagged).length;
      /* Rows whose ONLY disagreement is net margin. A row that is also lagging
         is already explained by the lag. */
      const edits = drift.filter(d => d.repriced && !d.lagged && !d.flipped).length;
      const shown = drift.slice(0, SHOWN_REFS)
        .map(d => `${str(d.u.id)} (${d.why.join(', ')})`).join('; ');
      const more = drift.length - Math.min(drift.length, SHOWN_REFS);
      /* Three causes, said apart. Until 1 Sep 2026 this alert ended with a flat
         "This is lag: more than one day of it means the nightly recompute has
         not run" regardless of what had actually differed — so a price raised
         this morning, and a band flip nothing explains, both read as a job that
         had failed to run overnight. Diagnosing a cause the screen has not
         established is the same fault as the 75-versus-90 confusion this file
         was rewritten to end, one layer down. */
      const onN = n => (drift.length === 1 ? 'On this unit' : `On ${num(n)} of them`);
      const causes = [
        lags ? `${onN(lags)} the stored day count or holding figure trails the calendar by more than ${num(LAG_DAYS)} day, which is what a missed nightly run looks like — and is the only one of these that the job running will fix.` : '',
        edits ? `${onN(edits)} the only difference is net margin, which moves the moment a price or a cost is edited and says nothing about the job: the stored figure is simply older than the edit.` : '',
        flips ? `${onN(flips)} the stored ageing band differs from the live one in a way the ${num(INV.WARN_DAYS)}-versus-${num(STORED_WARN_DAYS)}-day threshold difference does not account for, and nothing on this screen explains it — an ageing campaign keyed on the stored column is acting on the stored answer.` : '',
      ].filter(Boolean).join(' ');
      add('stored_drift', flips ? 'CRITICAL' : 'WARNING', 'sync_problem',
        `${num(drift.length)} unsold ${plural(drift.length, 'unit disagrees', 'units disagree')} with ${plural(drift.length, 'its', 'their')} stored figures`,
        `${shown}${more > 0 ? `; and ${num(more)} more` : ''}. This screen shows the live recompute; Overview, the workflows and the Finance Desk read the stored columns, so the two are acting on different numbers. `
        + causes
        + ` ${jobLine(job)} Every ageing and margin figure on this screen is the live one. Saving the unit from its Edit form does NOT clear this: since 1 Sep 2026 the form writes only what a person typed — stock number, model, VIN, status, acquisition date, price, cost and recommendation — and no derived column at all, because architecture/schema.sql:160 says those columns are recomputed wholesale by recompute_inventory_derived() and are not to be hand-edited. What rewrites them is the ${RECOMPUTE_WORKFLOW} workflow, which calls that function; it runs in n8n at 00:15 Asia/Dubai and is NOT a pg_cron job, whatever older comments say — cron.job holds only capture_daily_metrics (checked live 1 Sep 2026). Until it next runs, the stored figures stay exactly where they are.`,
        drift.map(d => d.u));
    }
    /* Unconditional. This was `else if (drift.length)` until 1 Sep 2026, so the
       sentence saying how much of the comparison had actually been possible
       disappeared at exactly the moment the comparison found something — the
       findings were then read as complete. A caveat that only shows up when
       there is nothing to caveat is not a caveat. */
    if (storedCols.length < 4) {
      const absent = ['days_in_stock', 'holding_cost_accrued', 'net_margin', 'aging_alert'].filter(c => !has(c));
      notes.push(`Only ${storedCols.join(', ')} came back with these rows, so the stored-versus-live comparison covered ${plural(storedCols.length, 'that column', 'those columns')} alone and says nothing about ${absent.join(', ')}.`);
    }
    if (undatedSkipped) {
      notes.push(`${num(undatedSkipped)} unsold ${plural(undatedSkipped, 'unit has', 'units have')} no acquisition date and ${plural(undatedSkipped, 'was', 'were')} left out of the stored-versus-live comparison entirely. Two reasons, and the second alone is enough: there is no live side to compare — deriveUnit() returns nothing for an undated unit as of 1 Sep 2026, and before that it returned the stored day count, so the comparison was the stored side against itself; and recompute_inventory_derived() only updates rows where acquired_at is not null, so the nightly job has never written ${plural(undatedSkipped, 'that row', 'those rows')} and never will. Whatever ${plural(undatedSkipped, 'its stored figures say', 'their stored figures say')} is unreconcilable, not stale.`);
    }
    if (missingBand) {
      notes.push(`${num(missingBand)} unsold ${plural(missingBand, 'unit carries', 'units carry')} no stored aging_alert at all — the column is empty on ${plural(missingBand, 'that row', 'those rows')}, not holding a value this screen failed to read — so for ${plural(missingBand, 'it', 'them')} there was no stored band to compare the live one against.`);
    }
    if (unreadableBand) {
      notes.push(`${num(unreadableBand)} unsold ${plural(unreadableBand, 'unit carries', 'units carry')} a stored aging_alert this screen does not recognise as one of ${ALERTS.join(', ')}, so for ${plural(unreadableBand, 'that unit', 'those units')} the stored band was not compared against the live one at all — that check did not run rather than passing.`);
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
  let viewErr = null, salesErr = null, compErr = null, jobErr = null;
  const stockRead = db(`inventory?select=*&order=acquired_at.asc&limit=${INV_LIMIT}`);
  const attnRead = db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen'
    + `&screen=eq.inventory&order=at.desc&limit=${ATTN_LIMIT}`)
    .catch(e => { viewErr = e.message; return null; });
  /* Three more soft reads, for the same reason the attention read is soft: none
     of them is this screen's subject and none may take the stock table down.

     purchase_history is the only evidence in the database that a car ever left
     the lot — inventory records no sale date — so without it the difference
     between "everything is in stock" and "everything is still marked in stock"
     is invisible. Columns are the probed list: it carries its own phone, so no
     join to leads is needed to show a buyer with their number.

     `v_competitor_latest` replaces what was `competitors?select=id&limit=1`.
     That read answered one question — is the table empty — and the drawer then
     disabled its compare button with a sentence about every scraped price having
     been removed as unusable and the scraper next running at 05:00 UTC. On
     1 Sep 2026 at 14:18 UTC the table holds 11 rows and the view holds 5, so
     both halves of that sentence were false and the button was disabled on a
     memory. The view is one row per (competitor, model), newest snapshot, and
     it is indexed;
     reading it lets the drawer say what exists for THIS unit instead of
     guessing from a table-level count. `competitors` itself stays an
     append-only log and is not read here.

     v_workflow_health is read for the one workflow that writes the stored
     ageing columns. Until today this screen asserted those columns had been
     "last written by the nightly job" without checking that any such run
     existed — a provenance claim with nothing behind it. */
  const salesRead = db('purchase_history?select=id,customer_name,phone,vehicle,amount_aed,purchase_date'
    + '&order=purchase_date.desc&limit=50')
    .catch(e => { salesErr = e.message; return null; });
  const compRead = db('v_competitor_latest?select=competitor,model,price_aed,our_price_aed,'
    + `price_diff_aed,scraped_at,listing_title,source_host,source_kind,match_quality,match_note&order=scraped_at.desc&limit=${COMP_LIMIT}`)
    .catch(e => { compErr = e.message; return null; });
  const jobRead = db('v_workflow_health?select=name,health,runs_30d,successes_30d,failures_30d,'
    + `partials_30d,no_result_30d,rejected_30d,effective_runs_30d,last_run,last_success&name=eq.${encodeURIComponent(RECOMPUTE_WORKFLOW)}`)
    .catch(e => { jobErr = e.message; return null; });
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
  const jobRows = await jobRead;
  /* One row or none. Matched on the exact registry name, so a second workflow
     with a similar name cannot be silently averaged in; more than one row under
     the same name is a registry fault and is treated as no answer rather than
     as the first row. */
  const job = {
    err: jobErr,
    row: Array.isArray(jobRows) && jobRows.length === 1 ? jobRows[0] : null,
    ambiguous: Array.isArray(jobRows) && jobRows.length > 1,
  };

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
  const compCapped = Array.isArray(compRows) && compRows.length >= COMP_LIMIT;

  /* Exact model text, normalised for case and runs of whitespace and nothing
     else. `v_competitor_latest` is keyed on (competitor, model) and the model
     string on the two sides is written by two different processes, so anything
     looser than equality would be this file inventing a vehicle match — the
     same guess the sale reconciliation above has to apologise for on every line
     it prints, and there it at least has no alternative. A unit with no listing
     under its exact model gets told that, rather than being shown somebody
     else's car's price. */
  const modelKey = v => str(v).toLowerCase().replace(/\s+/g, ' ');
  const compByModel = new Map();
  (compRows || []).forEach(c => {
    const k = modelKey(c.model);
    if (!k) return;
    if (!compByModel.has(k)) compByModel.set(k, []);
    compByModel.get(k).push(c);
  });
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
  const derived = deriveAlerts(inv, raw, recon, salesErr, job);

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
  /* Live bands only, and only for units that have a date to count from. An
     undated unit has no live band at all — see bandOf() — so it is absent from
     every one of these counts rather than padding HEALTHY. `undatedCount` is
     what keeps that absence visible instead of silent. */
  const alertCount = a => inv.filter(u => bandOf(u) === a).length;
  const crit = alertCount('CRITICAL');
  const warn = alertCount('WARNING');
  const undatedCount = inv.filter(u => !dated(u)).length;

  const f = { status: 'ALL', alert: 'ALL', q: '', sort: 'days_desc', only: null };

  function visible() {
    const q = f.q.trim().toLowerCase();
    return inv.filter(u => {
      /* Set by the alert strip, not by the toolbar, so it has to clear itself:
         see focusUnits() and the bar it paints above the table. */
      if (f.only && !f.only.ids.has(String(u.id))) return false;
      if (f.status !== 'ALL' && low(u.status) !== low(f.status)) return false;
      if (f.alert !== 'ALL' && bandOf(u) !== f.alert) return false;
      if (q && ![u.id, u.model, u.vin].map(low).join(' ').includes(q)) return false;
      return true;
    });
  }

  /* Rows the sort key cannot speak about (no acquisition date, no price at all)
     go to the bottom in stock-number order rather than being ranked as if they
     were the oldest or the least profitable unit on the lot. */
  function sorted(rows) {
    const key = f.sort.startsWith('days') ? daysOf
      : f.sort.startsWith('holding') ? holdingOf
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
    if (!dated(r)) {
      return '<span class="t-muted" title="No acquisition date on record, so this unit has no ageing band. It is not HEALTHY and it is not anything else — the absence of a date is not a young car. The nightly recompute skips rows with no acquired_at, so nothing will fill this in either.">—</span>';
    }
    const a = bandOf(r);
    return ALERTS.includes(a)
      ? `<span title="${esc(ALERT_WHY[a])}">${pill(a, tone(a))}</span>`
      : '<span class="t-muted">—</span>';
  };
  /* Gross margin is price minus cost and needs no date. Net margin is gross
     minus holding cost, and holding cost is days x a rate — so on an undated
     unit the net figure is the gross one wearing a zero it has not earned, and
     it printed as a clean margin. The recommended commission is 5% of the same
     number and inherits the same fault. */
  const marginCell = (r, field) => {
    if (!priced(r)) {
      return '<span class="t-muted" title="This unit has neither a list price nor a cost on record, so no margin can be derived.">—</span>';
    }
    if (field !== 'gross_margin' && !dated(r)) {
      return '<span class="t-muted" title="Net margin is gross margin less holding cost, and holding cost cannot be counted without an acquisition date. There is no net margin to show for this unit — it used to render as the gross margin with a holding cost of zero, which read as a better car than the record supports.">—</span>';
    }
    return `<span class="${(n0(r[field]) || 0) < 0 ? 't-hot' : ''}">${aed(r[field])}</span>`;
  };

  const cols = [
    {
      label: 'Vehicle', strong: true, render: r => {
        const a = bandOf(r);
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
        /* daysOf(), not the derived column. deriveUnit() answers zero for an
           undated unit and that zero rendered here as a green bar reading "0 of
           120 days to critical" — the newest car on the lot, drawn from a
           missing record. Reachable again now, which is the point: the guard
           below was written for a null that could never arrive. */
        const d = daysOf(r);
        if (d == null) {
          return '<span class="t-muted" title="No acquisition date on record, so days in stock cannot be counted for this unit, and the nightly recompute skips it too. Nothing is shown rather than a number. This cell used to print the stored column, or zero where that was empty, neither of which was a live figure.">—</span>';
        }
        const t = tone(bandOf(r)) || 'cold';
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
        /* Days x the daily rate, so an undated unit has no live holding figure
           either — what deriveUnit() returns for one is a stored day count
           wearing a live label. */
        const h = holdingOf(r);
        if (h == null) {
          return `<span class="t-muted" title="${dated(r) ? 'No holding cost on record for this unit.' : 'No acquisition date on record, so nothing here can say what this unit has cost to hold.'}">—</span>`;
        }
        const eats = priced(r) && n0(r.gross_margin) != null && h > (n0(r.gross_margin) || 0);
        return `<span class="${eats ? 't-hot' : ''}"${eats ? ' title="Holding cost has overtaken this unit\'s gross margin."' : ''}>${aed(h)}</span>`;
      }
    },
    { label: 'Net margin', align: 'r', strong: true, render: r => marginCell(r, 'net_margin') },
    { label: 'Commission', align: 'r', render: r => (priced(r) && dated(r) ? aed(r.recommended_commission) : marginCell(r, 'recommended_commission')) },
    { label: 'Alert', render: alertPill },
  ];

  /* ── Which of the two numbers this screen is showing ─────────────────────
     Said once, up front, because it is the difference between a reader trusting
     this screen and a reader trusting Overview. Everything in the table below is
     deriveUnit() run in this browser against `acquired_at`, so it is true today.
     The identically-named columns stored on the row are what Overview (verified
     1 Sep 2026: overview.js:650 selects days_in_stock, holding_cost_accrued and
     aging_alert, and that file does not import deriveUnit), the n8n workflows
     and the Finance Desk read. Neither is the truth to quietly prefer; printing
     both, and saying which is which, is what makes the two screens explainable
     instead of one of them looking broken.

     What this block used to get wrong was the last line. When the two counts
     matched it said "the two agree on every unit today, so this screen and
     Overview are counting the same lot the same way" — and they are not counting
     it the same way. They agree because no unit currently sits between 75 and 89
     days, the window where the two WARNING thresholds part company. That is a
     property of today's acquisition dates, and it will stop being true the week
     NX-1002 crosses 75 days. Agreement is now reported as what it is. */
  /* Whether the stored band came back at all, as opposed to coming back empty.
     The read is select=*, so PostgREST returns every column of the table on
     every row — a key that is absent is a column that is not on the table any
     more, which is a schema change and not a data fault. Without this the
     "Stored:" line below printed "0 critical · 0 warning · 0 healthy · 12 with
     no band at all" for a dropped column, which reads as twelve broken rows. */
  const hasStoredBand = raw.length > 0 && columnsOf(raw).has('aging_alert');
  const storedCount = a => raw.filter(r => band(r.aging_alert) === a).length;
  /* inv is raw.map(deriveUnit) — the same rows in the same order — so pairing by
     index here needs no id lookup and cannot mis-pair.

     Only unsold, dated units with a READABLE stored band are compared, because
     they are the only ones the alerts above will name. A sold unit is forced
     HEALTHY live and left alone in the stored column; an undated unit has no
     live band at all and is not touched by the nightly job either; and a row
     whose stored band is empty or is a word this screen does not know was not
     compared at all — the alerts say so in as many words. Counting any of them
     as a disagreement produced a headline larger than the alerts that were
     supposed to explain it, and in the unreadable case a headline that flatly
     contradicted them: "2 units sit in a different band" directly above "for
     those units the stored band was not compared against the live one at all".
     Reconciled on 1 Sep 2026. */
  const comparableBand = (u, i) => !isSold(u) && dated(u) && ALERTS.includes(band(raw[i].aging_alert));
  const bandDiff = inv.filter((u, i) => comparableBand(u, i)
    && band(raw[i].aging_alert) !== band(u.aging_alert)).length;
  /* Unsold, dated units the stored band cannot speak for — so the line below can
     say the comparison was partial instead of implying it was complete. */
  const bandUncomparable = inv.filter((u, i) => !isSold(u) && dated(u) && !ALERTS.includes(band(raw[i].aging_alert))).length;
  /* Units the two definitions genuinely disagree about, separated from units
     one of the two is merely late on. */
  const gapUnits = inv.filter(u => !isSold(u) && dated(u) && inBandGap(daysOf(u))).length;
  /* The three bands, plus whatever they do not account for. Without the
     remainder the two lines read as complete counts of the lot when a row with
     no band — undated live, or an empty stored column — is simply missing from
     both, and a reader adding them up would come out short with nothing saying
     why. */
  const spread = (count, total) => {
    const parts = ALERTS.map(a => `${num(count(a))} ${a.toLowerCase()}`);
    const rest = total - ALERTS.reduce((t, a) => t + count(a), 0);
    if (rest > 0) parts.push(`${num(rest)} with no band at all`);
    return parts.join(' · ');
  };
  const provenance = `<div style="padding:14px 20px 0"><div class="cell-sub" style="white-space:normal">
      <strong>${num(inv.length)} ${plural(inv.length, 'unit', 'units')}, read in full.</strong>
      ${capped
        ? `The read stopped at the ${num(INV_LIMIT)}-row cap, oldest first, so there is stock behind these that no figure here counts.`
        : 'Nothing was capped or sampled, so every count, total and band on this screen describes the whole lot.'}
      Days in stock, holding cost and the ageing band are recomputed in this browser from each unit's acquisition date, which makes them true as of today.
      The same figures stored on the row are what Overview, the workflows and the Finance Desk read; ${esc(jobLine(job))}
      ${undatedCount
        ? `${num(undatedCount)} ${plural(undatedCount, 'unit has', 'units have')} no acquisition date and ${plural(undatedCount, 'is', 'are')} therefore in none of the live counts, averages or bands below — not counted as healthy, not counted at all.`
        : ''}
      Live today: ${esc(spread(alertCount, inv.length))}. Stored: ${hasStoredBand ? esc(spread(storedCount, raw.length)) : 'not shown — these rows carry no aging_alert column at all, so there is no stored band to count and no comparison below'}.
      ${!hasStoredBand ? ''
        : bandDiff
          ? `${num(bandDiff)} ${plural(bandDiff, 'unit sits', 'units sit')} in a different band under the two, and the alerts above name ${plural(bandDiff, 'it', 'them')}.`
          : 'The two put every unit they can both speak for in the same band today.'}
      ${hasStoredBand && bandUncomparable
        ? `${num(bandUncomparable)} unsold ${plural(bandUncomparable, 'unit is', 'units are')} outside that comparison because ${plural(bandUncomparable, 'its', 'their')} stored band is empty or is a word this screen does not recognise — ${plural(bandUncomparable, 'it was', 'they were')} not compared rather than found to agree.`
        : ''}
      ${/* Three cases, not two. The old else-branch asserted "they match today"
            unconditionally whenever no unit sat in the 75–89 window, so a real
            band flip printed "N units sit in a different band under the two"
            and "They match today" one sentence apart. */
        !hasStoredBand
        ? `The two definitions still differ whether or not the column is there to show it: this screen raises WARNING at ${num(INV.WARN_DAYS)} days and the nightly Postgres job raises it at ${num(STORED_WARN_DAYS)}, and nothing here can say which band the stored side would have given.`
        : gapUnits
          ? `${num(gapUnits)} of that difference is definition, not lag: this screen raises WARNING at ${num(INV.WARN_DAYS)} days and the nightly Postgres job at ${num(STORED_WARN_DAYS)}, so between those two numbers the same car is amber here and green on Overview with both sides working.`
          : bandDiff
            ? `None of that difference is the threshold gap: this screen raises WARNING at ${num(INV.WARN_DAYS)} days and the nightly Postgres job raises it at ${num(STORED_WARN_DAYS)}, and no unit is currently between those two numbers — so the disagreements above need another explanation, and the alerts give what this screen can establish of one.`
            : `That is not the same as the two agreeing on how to count: this screen raises WARNING at ${num(INV.WARN_DAYS)} days and the nightly Postgres job raises it at ${num(STORED_WARN_DAYS)}. They match today only because no unit is between those two numbers, and they will part company on the day one is.`}
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
    /* "Carries a list price" and "has no list price" were being decided by two
       different tests on the same row. sum() counted a row whenever n0() was not
       null, and n0(0) is 0 — so a unit listed at exactly zero was inside this
       tile's "listed price of N units" while the no_price alert an inch above
       named the same unit as having none. A price of zero is a value somebody
       typed and it is not a price; it is excluded here and counted out loud. */
    const listed = onLot.filter(u => (n0(u.price_aed) || 0) > 0);
    const zeroPriced = onLot.filter(u => n0(u.price_aed) === 0).length;
    const value = sum(listed, u => u.price_aed);
    /* Unsold rows only. deriveUnit() hands a sold unit its stored holding cost
       straight back — frozen at the sale, neither live nor to-today — and this
       tile's own sub-label says "counted live to today", which was false for
       every dirham of it. A sold car's holding cost is history, and history is
       not money at risk on stock the dealership still owns. */
    const hold = sum(onLot, holdingOf);
    const soldHold = sum(rows.filter(isSold), u => n0(u.holding_cost_accrued));
    const age = sum(onLot, daysOf);
    const shownCrit = rows.filter(u => bandOf(u) === 'CRITICAL').length;
    const shownWarn = rows.filter(u => bandOf(u) === 'WARNING').length;
    const shownHealthy = rows.filter(u => bandOf(u) === 'HEALTHY').length;
    const shownUnrated = rows.length - shownCrit - shownWarn - shownHealthy;
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
          + (zeroPriced ? ` · ${num(zeroPriced)} more ${plural(zeroPriced, 'is', 'are')} listed at exactly zero and left out of this total` : '')
          + (suspect ? ` · ${num(suspect)} of them a recorded sale may already have sold` : '')
          : onLot.length
            ? `None of the ${num(onLot.length)} unsold ${plural(onLot.length, 'unit', 'units')} in this view carries a list price above zero${zeroPriced ? `, and ${num(zeroPriced)} of them ${plural(zeroPriced, 'is', 'are')} listed at exactly zero` : ''}`
            : 'No unsold unit is in this view'),
      kpi('Holding cost accrued', aed(hold.total),
        hold.n ? `${aed(INV.HOLDING_PER_DAY)} per unsold unit per day, counted live to today · ${num(hold.n)} of ${num(hold.of)} unsold ${plural(hold.of, 'row', 'rows')} shown`
          + (soldHold.n ? ` · a further ${aed(soldHold.total)} on ${num(soldHold.n)} sold ${plural(soldHold.n, 'unit', 'units')} is frozen at the sale and not counted here` : '')
          : onLot.length
            ? 'No unsold row in this view carries a holding figure that can be counted live'
            : 'No unsold row is in this view'),
      /* One row is not an average and must not be labelled as one. With a single
         unsold unit in view this is that unit's age, and it says so — the label
         changes too, because "Average" over n=1 is the kind of sentence that
         survives being screenshotted into a meeting. */
      kpi(age.n === 1 ? 'Days in stock' : 'Average days in stock',
        age.n ? num(age.n === 1 ? age.total : age.total / age.n) : '—',
        age.n === 0 ? 'No unsold unit in this view has an acquisition date to count from'
          : age.n === 1 ? 'One dated unsold unit in this view — this is its age, not an average'
            : `Mean across ${num(age.n)} of the ${num(age.of)} unsold ${plural(age.of, 'unit', 'units')} shown, from their acquisition dates`,
        ''),
      kpi('Ageing alerts · live', num(shownCrit),
        `${num(shownWarn)} warning · ${num(shownHealthy)} healthy`
        + (shownUnrated ? ` · ${num(shownUnrated)} with no acquisition date and therefore no band` : ''),
        shownCrit ? 't-hot' : ''),
    ].join('');
  }

  /* Bands are the product's own thresholds, not decorative buckets: the split
     is exactly where WARNING and CRITICAL are raised. */
  function paintAging(rows) {
    const unsold = rows.filter(u => !isSold(u));
    const onLot = unsold.filter(u => daysOf(u) != null);
    const undatedHere = unsold.length - onLot.length;
    const host2 = $('invAging');
    if (!onLot.length) {
      /* Two different empties, and the old wording said "no dated unsold unit"
         for both. A view with no unsold rows at all is not the same fact as a
         view whose unsold rows have no acquisition dates, and the second one is
         a data fault somebody can go and fix. */
      host2.innerHTML = `<div style="padding:14px 20px 0"><div class="cell-sub" style="white-space:normal">${
        !unsold.length
          ? 'No unsold unit is in this view, so there is no ageing spread to show.'
          : `None of the ${num(unsold.length)} unsold ${plural(unsold.length, 'unit', 'units')} in this view has an acquisition date, so none of them can be aged and there is no spread to draw.`
      }</div></div>`;
      return;
    }
    const bands = [
      { a: 'HEALTHY', label: `0–${INV.WARN_DAYS - 1} d`, tone: 'ok' },
      { a: 'WARNING', label: `${INV.WARN_DAYS}–${INV.CRITICAL_DAYS - 1} d`, tone: 'warm' },
      { a: 'CRITICAL', label: `${INV.CRITICAL_DAYS}+ d`, tone: 'hot' },
    ].map(b => ({ ...b, n: onLot.filter(u => bandOf(u) === b.a).length }));
    /* A stacked bar over one row is a solid block at 100%, which reads as a
       distribution and is not one. Say what the single unit is instead; the band
       buttons stay, because they are filters rather than a claim about spread. */
    const only1 = onLot.length === 1 ? onLot[0] : null;
    host2.innerHTML = `<div style="padding:16px 20px 4px">
      <div class="label-caps" style="margin-bottom:10px">Days in stock · ${num(onLot.length)} dated unsold unit${onLot.length === 1 ? '' : 's'} shown${undatedHere ? ` · ${num(undatedHere)} undated and not in this spread` : ''}</div>
      ${only1
        ? `<div class="cell-sub" style="white-space:normal">One dated unsold unit in this view — ${esc(str(only1.id))}, ${esc(bandOf(only1).toLowerCase())} at ${num(daysOf(only1))} days. A spread needs more than one row, so none is drawn.</div>`
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

  /* ── Competitor listings for one unit ────────────────────────────────────
     Until 1 Sep 2026 this screen said nothing about competitor prices and merely
     disabled a button with a sentence about the table having been emptied, which
     had stopped being true. It now reads `v_competitor_latest` — one row per
     (competitor, model), newest snapshot — and shows what exists for this exact
     model.

     What it will not do is turn a scraped number into a pricing conclusion it
     has not earned. On 1 Sep 2026 at 14:18 UTC the table holds 11 rows: 9 with
     match_quality NULL (unrated — they predate the columns) and 2 rated `weak`
     by the scraper itself, one of them recording that the price came from a
     language model asked for the lowest advertised figure. Nothing in the table
     is `exact_year`, so this section prints prices and refuses comparisons on
     every line, which is the correct output and not a bug — but it now refuses
     them for two different reasons and says which. An earlier version of this
     note claimed all 9 rows were unrated and drew that conclusion from their
     being unrated alone, which stopped being true within the day.
     `our_price_aed` is the scraper's snapshot of our price at scrape time,
     not the current one, so where the two differ that is said rather than left
     to be read as a stale comparison. */
  function compSection(unit, comps) {
    if (compUnknown) {
      return `<div class="section"><div class="label-caps">Competitor listings</div>
        <div class="cell-sub" style="white-space:normal;margin-top:8px">v_competitor_latest could not be read (${esc(str(compErr) || 'no reason given')}), so whether anybody is listing this model, and at what, is unknown here. That is not the same as nothing having been scraped.</div></div>`;
    }
    if (!comps.length) {
      return `<div class="section"><div class="label-caps">Competitor listings</div>
        <div class="cell-sub" style="white-space:normal;margin-top:8px">${
          compEmpty
            ? 'v_competitor_latest holds no rows at all, so nothing has been scraped for any vehicle.'
            : `No scraped listing carries this unit's exact model text. Matching is exact-string only — the model on a scraped listing and the model on this row are written by two different processes, and pairing them any more loosely would be this screen inventing a comparison.${compCapped ? ` The read also stopped at the ${num(COMP_LIMIT)}-row cap, so a listing for this model could exist behind it.` : ''}`
        }</div></div>`;
    }
    const ourNow = n0(unit.price_aed);
    const rows = comps.map(c => {
      const m = matchWords(c);
      const diff = n0(c.price_diff_aed);
      const theirs = n0(c.price_aed);
      const oursThen = n0(c.our_price_aed);
      const drifted = ourNow != null && oursThen != null && ourNow !== oursThen;
      const head = `${esc(str(c.competitor) || 'An unnamed competitor')} · ${aed(theirs)}`
        + (str(c.source_host) ? ` · ${esc(str(c.source_host))}` : '')
        + (str(c.source_kind) ? ` (${esc(str(c.source_kind))})` : '')
        + ` · scraped ${esc(ago(c.scraped_at))}`;
      const line = m.compare && diff != null
        ? `${aed(Math.abs(diff))} ${diff < 0 ? 'cheaper than' : 'more than'} our ${aed(oursThen)} at the time of the scrape — ${esc(m.say)}.`
        : `No pricing conclusion is drawn from this row: ${esc(m.say)}. The scraped price is shown as a number; our own list price is ${aed(ourNow)}, and the difference between the two is deliberately not stated as a comparison.`;
      return `<div class="cell-sub" style="white-space:normal;margin-top:8px">
        <strong>${head}</strong>
        ${str(c.listing_title) ? `<br>${esc(str(c.listing_title))}` : '<br>No listing title was recorded for this row, so what was actually on the page is not shown.'}
        <br>${line}
        ${str(c.match_note) ? `<br>${esc(str(c.match_note))}` : ''}
        ${drifted ? `<br>Our list price has moved since that scrape: ${aed(oursThen)} then, ${aed(ourNow)} now, so any difference the scraper recorded is against the older figure.` : ''}
      </div>`;
    }).join('');
    return `<div class="section"><div class="label-caps">Competitor listings · ${num(comps.length)} for this model</div>
      ${rows}
      <div class="cell-sub" style="white-space:normal;margin-top:8px">Newest snapshot per competitor, from v_competitor_latest; competitors itself is an append-only log and every earlier scrape of the same listing is still in it.${compCapped ? ` The read stopped at the ${num(COMP_LIMIT)}-row cap, so this may not be every listing there is.` : ''}</div></div>`;
  }

  function drawer(unit) {
    const d = daysOf(unit);
    const liveBand = bandOf(unit);
    /* Every competitor listing whose model text is exactly this unit's. Empty is
       a fact about this car; compUnknown is a failed read and is never rendered
       as one. */
    const comps = compByModel.get(modelKey(unit.model)) || [];
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
        ${liveBand === 'CRITICAL' || liveBand === 'WARNING' ? `<div class="banner ${tone(liveBand)}">
          <span class="material-symbols-outlined">warning</span>
          <div>${esc(ALERT_WHY[liveBand])}. Holding cost so far is ${aed(holdingOf(unit))} and grows by ${aed(INV.HOLDING_PER_DAY)} a day while it stays on the lot.${
            liveBand === 'WARNING' && inBandGap(d)
              ? ` At ${num(d)} days this unit is still HEALTHY in the stored column, which raises WARNING at ${num(STORED_WARN_DAYS)} days rather than ${num(INV.WARN_DAYS)} — so Overview, the ageing campaigns and the Finance Desk do not see it as ageing yet.`
              : ''}</div></div>` : ''}
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
            <dt>Holding cost</dt><dd class="num">${d == null ? '<span class="t-muted">—</span>' : aed(holdingOf(unit))}</dd>
            <dt>Net margin</dt><dd class="num"><strong>${marginCell(unit, 'net_margin')}</strong></dd>
            <dt>VAT</dt><dd class="num">${aed(unit.vat_amount)}</dd>
            <dt>Recommended commission</dt><dd class="num">${priced(unit) && dated(unit) ? aed(unit.recommended_commission) : marginCell(unit, 'recommended_commission')}</dd>
            <dt>Acquired</dt><dd>${esc(unit.acquired_at || 'No acquisition date on record')}</dd>
            <dt>Days in stock</dt><dd class="num">${d == null ? '<span class="t-muted">—</span>' : num(d)}</dd>
          </dl></div>
        ${compSection(unit, comps)}
      </div>
      <div class="drawer-foot">
        <button class="btn primary" id="dEdit">Edit</button>
        <button class="btn" id="dComp"${compEmpty
          ? ' disabled title="v_competitor_latest returned no rows at all, so there is nothing on the Competitors screen to compare this or any other unit against."'
          : compUnknown ? ` title="v_competitor_latest could not be read (${esc(str(compErr) || 'no reason given')}), so this may open a screen with nothing on it."`
            : comps.length ? ` title="${esc(`${comps.length} scraped listing${comps.length === 1 ? '' : 's'} carries this exact model text. The Competitors screen holds the full comparison.`)}"`
              : ' title="No scraped listing carries this unit\'s exact model text, so the Competitors screen will show other vehicles rather than this one."'
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
      /* tone() answers 'unknown' for anything it does not recognise, which is
         a visible pill in its own right; only an empty severity comes back
         blank, and blank would render as an unstyled pill. */
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
      const kind = str(r.kind);
      /* `at` is not one thing across this view's arms. On the inventory_aging
         arm it is `now()`, so ago() printed "just now" for a Range Rover that
         has been on the lot since 6 April under a tooltip claiming it was how
         long the view had been reporting it — a provenance sentence about a
         column that holds no such fact. No age is shown for those rows at all;
         the age is in the view's own detail, which it builds from
         days_in_stock. Overview says the same thing about the same kind, and
         the two must not contradict each other. */
      const queryTime = AT_IS_QUERY_TIME.has(kind);
      return {
        severity: r.severity,
        icon: KIND_ICON[kind] || 'warning',
        title: str(r.title) || ref || 'Needs attention',
        detail: [
          str(r.detail),
          ref ? `Stock ${ref}` : '',
          /* The view builds this line from the stored columns. This screen's
             table shows the live recompute, so where the two differ the strip
             and the row below it will print different day counts, and a reader
             is entitled to know which is which before they reconcile them. */
          kind === 'inventory_aging' ? 'Figures from the stored nightly columns, not the live recompute in the table below' : '',
        ].filter(Boolean).join(' · '),
        at: queryTime ? null : r.at,
        atNote: queryTime
          ? 'v_needs_attention stamps this kind with the moment the query ran rather than with an event time, so there is no waiting time to show. How long the unit has been on the lot is in the line above.'
          : 'How long v_needs_attention has been reporting this row.',
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
      const CHECKS = 'below cost, missing a list price, a VIN or an acquisition date, sold on paper but not in stock, or disagreeing with its stored figures by more than the nightly job can explain';
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
