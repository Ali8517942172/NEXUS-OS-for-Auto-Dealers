/* NEXUS OS — lib/unit-form.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { canAddUnit, canDeleteUnit, canEditUnit, canSetCost, db, dbWrite, onIdentityChange } from './data.js';
import { $ } from './dom.js';
import { TZ, aed, esc, n0, num, pill } from './format.js';
import { modalError, openModal } from './modal.js';

/* 2 Sep 2026 — HOLDING_PER_DAY: 50 IS GONE, AND IT WAS THE LARGEST FABRICATION
   IN THIS PRODUCT.

   It sat here as `HOLDING_PER_DAY: 50, // AED per unit per day` with no source
   and no dealership behind it, and deriveUnit() multiplied it by the day count
   on every render. Twelve units on this lot, 677 days between them: the browser
   was printing AED 33,850 of holding cost across the lot and AED 7,450 against
   NX-1010 alone, subtracting both from margin, and taking 5% of the remainder
   as a recommended commission — four figures deep off one number nobody had
   ever quoted. `recompute_inventory_derived()` asserted the same 50 in the
   database and Lane A removed it there on 2 Sep 2026: `holding_cost_accrued`
   and `net_margin` are NULL on all twelve `inventory` rows, and
   `inventory_profit_settings.holding_cost_per_day_aed` is NULL with a column
   comment saying so deliberately — "NOT seeded to the AED 50/day asserted by
   recompute_inventory_derived() and lib/unit-form.js INV.HOLDING_PER_DAY:
   neither cites a source, so neither is evidence."

   Removing the key rather than zeroing it is the point. A zero would have been
   the same lie with a smaller number, and a null left under this name invites
   the next reader to write `|| 50`. The rate is now DATA — one row per
   dealership in `inventory_profit_settings`, with a source, a person and a
   confirmation date the table's own constraint requires — and it is read
   through holdingSettings() below.

   What still lives here and why: VAT_RATE and COMMISSION_RATE are the same
   shape of un-sourced constant and are NOT fixed by this pass; they belong in
   the Policy Engine (PRODUCT.md) and moving them is a decision about
   jurisdiction data, not a display fix. WARN_DAYS 75 stays as the FALLBACK band
   only — screens/competitors.js and screens/finance.js call deriveUnit() with
   no settings and have banded at 75 for weeks, so changing what they see is not
   this pass's to do. The Sentinel and the settings row both say 90; a caller
   that passes settings gets 90. That disagreement is now visible at the call
   site rather than hidden in a constant.

   Two files outside this one read `INV.HOLDING_PER_DAY` and will now read
   `undefined`: screens/finance.js:3194 prints it into a sentence, so that
   sentence needs its own pass. Named, not touched. */
const INV = {
  VAT_RATE: 0.05,           // of the list price. Un-sourced; see the note above.
  COMMISSION_RATE: 0.05,    // of net margin. Un-sourced; see the note above.
  WARN_DAYS: 75,            // FALLBACK only. inventory_profit_settings says 90.
  CRITICAL_DAYS: 120,       // agreed by every definition in the product.
  STATUSES: ['Available', 'Reserved', 'Sold'],
};

/* ── The holding rate, read rather than asserted ──────────────────────────
   One row per dealership, RLS-scoped, so this returns THIS dealership's rate or
   nothing. The three states it can come back in are kept apart, because they
   are three different sentences on screen:

     DEALERSHIP_SUPPLIED  the dealership stated the rate and stands behind it.
                          Figures derived from it are figures.
     PLACEHOLDER          a working assumption. Every figure derived from it is
                          an assumption and must be labelled as one AT THE POINT
                          THE FIGURE IS SHOWN — not in a footnote under it.
     absent               no rate on record. Holding cost and net margin are
                          NOT COMPUTABLE and the inputs are shown instead.

   `limit=2` on purpose: a second row means this browser cannot tell which
   dealership's rate it is holding, and the honest answer to that is the absent
   state, not the first row that happened to sort first.

   Memoised per signed-in identity. lib/data.js fires onIdentityChange when the
   signed-in user actually changes, which is the one path in this app where a
   second dealership's session can inherit the first one's memory without a page
   reload — a stale holding rate crossing that boundary would put one
   dealership's floorplan cost against another's cars. */
const SETTINGS_COLS = 'holding_cost_per_day_aed,holding_cost_basis,holding_cost_source,'
  + 'holding_cost_set_by,holding_cost_verified_at,aging_warn_days,aging_critical_days';

const NO_RATE = Object.freeze({
  rate: null, basis: null, source: null, setBy: null, verifiedAt: null,
  warnDays: INV.WARN_DAYS, critDays: INV.CRITICAL_DAYS,
  state: 'NO_RATE',
  why: 'This dealership has not recorded what a day of floor costs, so holding cost and net margin cannot be worked out for any unit.',
});

let RATE_PROMISE = null;
onIdentityChange(() => { RATE_PROMISE = null; });

function holdingSettings() {
  if (!RATE_PROMISE) {
    RATE_PROMISE = db(`inventory_profit_settings?select=${SETTINGS_COLS}&limit=2`)
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        if (list.length > 1) {
          return { ...NO_RATE, state: 'AMBIGUOUS',
            why: 'More than one configuration row came back, so which dealership\'s holding rate this is cannot be told from here. No holding figure is derived from any of them.' };
        }
        const r = list[0];
        if (!r) {
          return { ...NO_RATE, state: 'NO_SETTINGS_ROW',
            why: 'No configuration row exists for this dealership yet, so there is no holding rate, and none of the Sentinel\'s thresholds shown elsewhere came from here.' };
        }
        const warn = n0(r.aging_warn_days);
        const crit = n0(r.aging_critical_days);
        const rate = n0(r.holding_cost_per_day_aed);
        const basis = String(r.holding_cost_basis || '').trim().toUpperCase() || null;
        return {
          rate: rate == null ? null : rate,
          basis,
          source: r.holding_cost_source || null,
          setBy: r.holding_cost_set_by || null,
          verifiedAt: r.holding_cost_verified_at || null,
          warnDays: warn == null ? INV.WARN_DAYS : warn,
          critDays: crit == null ? INV.CRITICAL_DAYS : crit,
          state: rate == null ? 'NO_RATE' : (basis === 'PLACEHOLDER' ? 'PLACEHOLDER' : 'DEALERSHIP_SUPPLIED'),
          why: rate == null ? NO_RATE.why : null,
        };
      })
      .catch(e => ({ ...NO_RATE, state: 'UNREADABLE',
        why: `The configuration row could not be read (${e && e.message ? e.message : 'no reason given'}), so whether a holding rate exists is unknown here. That is not the same as there being none.` }));
  }
  return RATE_PROMISE;
}

const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

/* The day count was the browser's, and it has to be the dealership's.

   `today0()` is midnight wherever the laptop is sitting, and the old count
   subtracted two Date objects, which drags that offset in twice. Postgres does
   not: recompute_inventory_derived() — body read live on 1 Sep 2026 via
   pg_get_functiondef, and it matches architecture/schema.sql:829 exactly —
   opens with `today_dubai date := (now() at time zone 'Asia/Dubai')::date` and
   counts `greatest(0, today_dubai - acquired_at)`, a difference of two calendar
   dates in one fixed zone. So a rep opening the same unit from London after
   20:00, or from New York any time after noon, was a full day behind Dubai's
   calendar and saw the car one day younger than the nightly job had recorded
   it — and the Inventory screen, comparing the two, reported that day as the
   recompute being late.

   These two helpers reproduce the Postgres expression rather than approximating
   it: resolve today to a calendar date in Asia/Dubai, resolve acquired_at to a
   calendar date, subtract whole days. TZ is lib/format.js's single 'Asia/Dubai'
   constant — the same one every timestamp on every screen is formatted through,
   so there is one place where this dealership's zone is written down. Nothing
   below subtracts two Date objects. */
const DUBAI_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const dubaiToday = () => {
  const p = {};
  for (const part of DUBAI_YMD.formatToParts(new Date())) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
};
/* Whole days since the epoch for a plain YYYY-MM-DD. Date.UTC anchors both
   operands identically, so the difference is exactly the number of dates
   between them and no zone survives into the answer. Returns null for anything
   that is not a date — including 2026-13-01 and 2026-02-31, which Date.UTC
   otherwise rolls silently forward into a real date weeks away and would have
   produced a confident day count off a typo. */
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const dayNo = (ymd) => {
  const m = YMD.exec(String(ymd == null ? '' : ymd).trim().slice(0, 10));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return t / 86400000;
};
/* null, never zero, when there is no date to count from. */
const daysInStock = (acquired) => {
  const a = dayNo(acquired);
  return a == null ? null : Math.max(0, dayNo(dubaiToday()) - a);
};

/* acquired_at is the source of truth; everything else falls out of it. Units
   that are Sold stop accruing — a sold car is not costing the lot anything.

   Where there is no acquired_at, nothing falls out of it, and since 1 Sep 2026
   this says so with a null instead of returning a number anyway. It used to
   answer `n0(u.days_in_stock) || 0`, and that `|| 0` turned an empty column into
   a zero that is indistinguishable from a real one: an undated unit arrived on
   the Inventory screen as the newest car on the lot — 0 days, HEALTHY, a green
   bar reading "0 of 120 days to critical" — and was averaged into "Average days
   in stock" under a caption saying the mean came from acquisition dates.

   The database settles this rather than this file guessing at it.
   recompute_inventory_derived() updates `from … where acquired_at is not null`,
   so the one writer that owns these columns has never written a figure for an
   undated row and never will. There is no stored answer to fall back to; the
   fallback was inventing one.

   null is the sentinel rather than a second return field or a magic number,
   because the shared formatters already speak it: num() and aed() in
   lib/format.js render null as "—". A consumer that does nothing at all now
   prints an em dash where it used to print a confident zero. Two consumers were
   already written against this null and could never reach it — screens/
   competitors.js has three `n0(u.days_in_stock) == null ? 'no acquisition date'`
   branches that were dead code until today, and screens/inventory.js built
   dated()/daysOf()/holdingOf()/bandOf() to work around the number it got
   instead. Neither has to change; competitors' branches simply start firing.

   Five fields can now be unknown — days_in_stock, holding_cost_accrued,
   net_margin, recommended_commission, aging_alert. gross_margin and vat_amount
   stay numbers: they come off price and cost, which have nothing to do with the
   date. (A unit with neither price nor cost is a separate plausible zero and is
   deliberately left alone here; screens/inventory.js priced() guards it and is
   load-bearing today.) */
/* `cfg` is the settings row from holdingSettings(), or nothing.

   Nothing is the SAFE argument, not the convenient one: with no settings the
   holding rate is unknown, so holding cost, net margin and the recommended
   commission all come back null with a state saying why. That is the answer
   screens/competitors.js and screens/finance.js now get — they call
   `inv.map(deriveUnit)`, and Array#map passes (value, index, array), so the
   second argument they hand this function is a NUMBER. `typeof cfg === 'object'`
   is what stops index 1 being read as a configuration whose `.rate` is
   undefined and whose `.warnDays` is undefined; without that guard the first
   unit in every list would band correctly and every unit after it would not.
   Both files keep the 75-day fallback band they have always had, and both stop
   printing a holding cost nobody quoted. */
function deriveUnit(u, cfg) {
  const c = (cfg && typeof cfg === 'object') ? { ...NO_RATE, ...cfg } : NO_RATE;
  /* Both raw, and deliberately NOT coalesced to zero. `n0(x) || 0` turned
     "nobody recorded this" into "this car cost nothing", and `price - cost`
     then rendered the WHOLE ASKING PRICE as gross margin on a unit with no
     acquisition cost - AED 235,000 on the demo dealership's DEMO-2130.
     recompute_inventory_derived() carried the identical defect and was fixed in
     the database on 6 Sep 2026 (migration 20260906065739, plus a CHECK that
     refuses the write outright). This is that defect in the browser, and the
     browser is the copy a dealership actually reads: every caller spreads
     `...u` and then overwrites, so what this returns replaces what the database
     sent. Missing either input is null with a state saying WHICH one, in the
     vocabulary of inventory.gross_margin_state and
     v_inventory_profit_sentinel. */
  const price = n0(u.price_aed);
  const cost = n0(u.cost_aed);
  const sold = String(u.status || '').toLowerCase() === 'sold';
  const storedDays = n0(u.days_in_stock);
  let days = daysInStock(u.acquired_at);
  /* Holding cost was already frozen on a sale. The day count was not, so every
     time anyone saved a sold unit its stored `days_in_stock` climbed again —
     the column quietly became "days since we bought it" rather than "days it
     sat on the lot", and the two only agree until the car sells. `inventory`
     records no sale date, so the freeze has to happen the moment the status
     says sold: the last figure written while it was still on the lot is the
     closest thing to a true days-to-sale this schema can hold.

     It is a DISPLAY freeze only: recompute_inventory_derived() sets
     `days_in_stock = d.days` for sold and unsold rows alike, so whatever this
     froze into the column was re-counted from acquisition the same night. And
     it is gated on having a date: on an undated unit it would hand the stored
     column back under a live label. */
  if (days != null && sold && storedDays != null) days = storedDays;

  /* ── Holding cost. THE FIX. ────────────────────────────────────────────
     This line used to read `days * INV.HOLDING_PER_DAY`, and because every
     consumer spreads `...u` and then overwrites, that product replaced whatever
     `inventory.holding_cost_accrued` actually held on every render. Lane A has
     since set that column to NULL on all twelve rows precisely BECAUSE the rate
     behind it was invented — so the browser was reinstating, in front of the
     operator, the exact figure the database had just retracted.

     Two inputs, both required, neither guessable: a rate on record and a day
     count. Missing either is NOT_COMPUTABLE — never zero, and never the gross
     margin wearing a holding cost of nothing. The states and the arithmetic
     mirror public.v_inventory_profit_sentinel, which is the engine that owns
     this figure; this function exists only so the Add/Edit form can show an
     operator what the engine will say about what they are typing before they
     save it.

     The sold-unit branch is gone with the rate. It used to hand back
     `holding_cost_accrued` for a sold unit — a stored figure that was itself
     written from the 50/day assertion, so "the record" was the same invention
     one hop away. A sold unit is now computed on the same two inputs as any
     other, or is not computed at all. */
  const holdingState = (c.rate == null || days == null) ? 'NOT_COMPUTABLE'
    : c.basis === 'PLACEHOLDER' ? 'PLACEHOLDER' : 'COMPUTED';
  const holding = holdingState === 'NOT_COMPUTABLE' ? null : Math.round(c.rate * days);
  const holdingWhy = holdingState !== 'NOT_COMPUTABLE' ? null
    : c.rate == null
      ? (c.why || NO_RATE.why)
      : 'No acquisition date on record, so there is no day count to charge a holding rate against.';

  const grossState = (price == null && cost == null) ? 'NOT_COMPUTABLE_NO_PRICE_NO_COST'
    : price == null ? 'NOT_COMPUTABLE_NO_PRICE'
      : cost == null ? 'NOT_COMPUTABLE_NO_COST' : 'COMPUTED';
  const gross = grossState === 'COMPUTED' ? price - cost : null;
  const grossWhy = grossState === 'COMPUTED' ? null
    : 'Missing ' + (grossState === 'NOT_COMPUTABLE_NO_PRICE_NO_COST' ? 'both a list price and an acquisition cost'
      : grossState === 'NOT_COMPUTABLE_NO_PRICE' ? 'a list price' : 'an acquisition cost')
      + ', so margin cannot be computed and no recommendation is safe.';
  const net = (holding == null || gross == null) ? null : gross - holding;
  return {
    ...u,
    days_in_stock: days,
    /* Null, with the reason beside it. Every caller must render the reason
       rather than the null: aed(null) prints an em dash, and an em dash where a
       cost belongs reads as nothing owed. */
    holding_cost_accrued: holding,
    holding_cost_state: holdingState,
    holding_cost_note: holdingWhy,
    holding_cost_basis: c.basis,
    holding_cost_per_day_aed: c.rate,
    /* Price minus cost, when both are on record - and null with a reason when
       either is not. Neither input has anything to do with the date or the
       rate, so this is unaffected by the two states above; it has a state of
       its own because it has inputs of its own. */
    gross_margin: gross,
    gross_margin_state: grossState,
    gross_margin_note: grossWhy,
    net_margin: net,
    net_margin_state: gross == null ? 'NOT_COMPUTABLE' : holdingState,
    net_margin_note: gross == null ? grossWhy
      : holdingState === 'NOT_COMPUTABLE'
        ? `Net margin is gross margin less holding cost. ${holdingWhy} Gross is shown; net is withheld rather than guessed.`
        : null,
    /* Five per cent OF A PRICE. With no price on record there is no VAT figure,
       and zero is not one. */
    vat_amount: price == null ? null : Math.round(price * INV.VAT_RATE),
    recommended_commission: net == null ? null : Math.round(net * INV.COMMISSION_RATE),
    aging_alert: days == null ? null
      : sold ? 'HEALTHY'
        : days >= c.critDays ? 'CRITICAL'
          : days >= c.warnDays ? 'WARNING' : 'HEALTHY',
    aging_warn_days: c.warnDays,
    aging_critical_days: c.critDays,
  };
}

/* What actually goes to Postgres — and since 1 Sep 2026 that is the facts a
   person typed, and nothing derived from them.

   This used to send all seven derived columns as well, recomputed in the
   browser, on every save. That made the browser a second writer of columns that
   already have one, working from a different rule:

     - The band. This file raises WARNING at INV.WARN_DAYS = 75.
       recompute_inventory_derived() raises it at 90 (function body read live on
       1 Sep 2026 with pg_get_functiondef; architecture/schema.sql:826 states the
       same, and CRITICAL is 120 on both sides). So between 75 and 89 days every
       save silently rebanded a car under a rule no other reader of that column
       uses — Overview, the n8n ageing campaigns and the Finance Desk all read
       the stored word.
     - The day count on a sold unit, which this file freezes and Postgres
       re-counts from acquisition.
     - The day count's zone, until the fix above.

   A column with two writers and two rules does not settle on either; it holds
   whichever ran last. Worse, screens/inventory.js deliberately reports the
   stored-versus-live difference as a finding, so this form was manufacturing
   the very alert that screen raises — a save cleared it, the next nightly run
   brought it back, and neither event meant anything about the data.

   The honest options were to write exactly what the database would write, or to
   stop writing these columns. This stops writing them:

     - The schema says so, in the `inventory` table comment at
       architecture/schema.sql:160 — the money columns "are DERIVED and are
       recomputed wholesale by recompute_inventory_derived() ... Do not
       hand-edit them." Writing the database's own rule from here is still
       hand-editing them.
     - This module cannot reproduce that rule faithfully anyway. Postgres does
       not freeze days_in_stock on a sale and this file deliberately does, so
       "write what the database would write" means silently dropping that freeze
       — a policy change a save is not entitled to make.
     - Writing the 90-day band would also make the Calculated panel in the form
       a lie: it shows the 75-day band, which is the number this form and the
       Inventory screen agree on and show the operator. Only a person can decide
       which threshold is the dealership's policy. A save is not that decision,
       and picking one by writing it is how the question stays unasked.

   The cost, stated rather than hidden: a unit added with a BACKDATED
   acquisition date carries empty derived columns until the recompute next runs
   — Inventory Ageing Recompute, n8n, nightly 00:15 Asia/Dubai, and NOT pg_cron
   (schema.sql:1482; cron.job holds only capture_daily_metrics, confirmed live
   1 Sep 2026). An edit leaves the previous stored figures in place for the same
   window. Empty renders as "—" in Overview and on the Finance Desk, and stale
   is stale rather than wrong — either beats a band computed by a rule neither
   of them uses. The form says this to the operator before they save.

   Calling the recompute directly from here would be better than both and is not
   available: the RPC is granted to postgres and service_role only (proacl read
   live 1 Sep 2026), so a browser JWT gets 403. The repo migration
   supabase/2026-08-14_rls_and_inventory_ageing.sql:92 grants it to
   `authenticated`; that line is NOT in effect on the live database. Granting it
   is a schema decision, not this file's. */
/* `withCost` is false for anyone who may not set a cost price, and the column
   is then LEFT OUT of the payload rather than sent unchanged.

   That is not belt-and-braces, it is the difference between the form working
   and not working for a manager. rbac_05's trigger is `BEFORE UPDATE OF
   cost_aed`, which fires whenever the column appears in the SET list at all —
   PostgREST builds that list from the request body, so sending cost_aed on a
   save that was really about the status would drag the whole PATCH in front of
   a check it does not need to face. It would usually pass (the value has not
   moved), and would fail exactly once: on a unit whose cost is null, where
   `n0(null) || 0` sends 0 and null -> 0 IS a change.

   The database is still the control. This only keeps the request honest about
   what it is asking to do. */
function unitRow(u, withCost) {
  const row = {
    id: u.id, model: u.model, vin: u.vin || null,
    status: u.status, acquired_at: u.acquired_at,
    price_aed: Number.isFinite(n0(u.price_aed)) ? n0(u.price_aed) : null,
    ai_recommendation: u.ai_recommendation || null,
  };
  if (withCost) row.cost_aed = Number.isFinite(n0(u.cost_aed)) ? n0(u.cost_aed) : null;
  return row;
}

/* This hardcoded `VH-` and a 3-digit pad, but every unit in the database is
   `NX-1001` … `NX-1012`. So the only ids this ever matched were ones it had
   minted itself, and a vehicle added from the browser landed in a namespace of
   its own — which also means `v_needs_attention.ref`, which carries the stock
   number for an ageing unit, could never resolve it back to a row.

   Read the prefix and the width off the rows we already hold instead of
   asserting either. The fallback only applies to a genuinely empty inventory. */
function nextStockId(inv) {
  const seen = (inv || [])
    .map(u => /^([A-Za-z]+)-(\d+)$/.exec(String(u.id || '')))
    .filter(Boolean);
  if (!seen.length) return 'NX-1001';
  const counts = new Map();
  seen.forEach(m => counts.set(m[1].toUpperCase(), (counts.get(m[1].toUpperCase()) || 0) + 1));
  const prefix = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const mine = seen.filter(m => m[1].toUpperCase() === prefix);
  const width = Math.max(...mine.map(m => m[2].length));
  const next = Math.max(...mine.map(m => Number(m[2]))) + 1;
  return `${prefix}-${String(next).padStart(width, '0')}`;
}

/* Local calendar date, not UTC. toISOString() on local midnight in Dubai (UTC+4)
   rolls back to the previous day, which defaulted "acquired on" to yesterday and
   showed a brand new car as already 1 day old.

   That fix was right about UTC and still wrong about whose calendar: it reads
   the browser's. The form now defaults and bounds "Acquired on" with
   dubaiToday() instead, so a car bought in Dubai today can be entered as today
   from any desk — from Los Angeles the local date is still yesterday and the
   `max` attribute was refusing it. isoDate() and today0() stay exported and
   unchanged for anything outside this module; nothing in the app imports either
   today, and neither is used below any more. */
const isoDate = d => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

function unitForm(existing, inv, onDone) {
  const isNew = !existing;
  /* Asked once, per dealership of the unit being edited, so a modal opened on
     another tenant's row could never be judged against this one's role. Both
     answer TRUE when the membership read failed — see lib/data.js. The
     database refuses either way; hiding a control on an unknown answer would
     tell an owner they are not one. */
  const tid = existing && existing.tenant_id;
  const mayCost   = canSetCost(tid);
  const mayDelete = canDeleteUnit(tid);
  /* Whether this form can be SAVED at all. Four screens open it — Inventory's
     table and drawer, and two panels on Competitors — and gating each call
     site separately is how one of them ends up missed. Gate it here, once, so
     a form that cannot be saved says so on the button instead of PATCHing and
     coming back "0 rows changed", which is what RLS returns and which reads
     to the operator as though nothing was wrong. */
  const mayEdit = isNew ? canAddUnit(tid) : canEditUnit(tid);
  const u = existing || {
    id: nextStockId(inv), model: '', vin: '', status: 'Available',
    acquired_at: dubaiToday(), price_aed: '', cost_aed: '', ai_recommendation: '',
  };
  const f = (id, label, input, hint) => `<div class="field">
    <label for="${id}">${label}</label>${input}
    ${hint ? `<div class="cell-sub">${hint}</div>` : ''}</div>`;

  const m = openModal(isNew ? 'Add vehicle' : `Edit ${u.model}`, `
    <div class="grid g2">
      ${f('uId', 'Stock number', `<input id="uId" value="${esc(u.id)}" ${isNew ? '' : 'disabled'} />`,
          isNew ? 'Must be unique. Used as the row key everywhere.' : 'The stock number cannot be changed once a unit exists.')}
      ${f('uStatus', 'Status', `<select id="uStatus">${INV.STATUSES
          .map(s => `<option ${s === u.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`)}
    </div>
    ${f('uModel', 'Model', `<input id="uModel" value="${esc(u.model)}" placeholder="Toyota Land Cruiser 2024" />`)}
    <div class="grid g2">
      ${f('uVin', 'VIN (optional)', `<input id="uVin" value="${esc(u.vin || '')}" />`)}
      ${f('uAcq', 'Acquired on', `<input type="date" id="uAcq" value="${esc(u.acquired_at || '')}" max="${dubaiToday()}" />`,
          'Days in stock, holding cost and the aging alert are all counted from this date, on the Dubai calendar. Without it none of the three can be worked out at all.')}
    </div>
    <div class="grid g2">
      ${f('uPrice', 'List price (AED)', `<input type="number" min="0" id="uPrice" value="${esc(u.price_aed)}" placeholder="290000" />`)}
      ${f('uCost', 'Cost (AED)',
          `<input type="number" min="0" id="uCost" value="${esc(u.cost_aed)}" placeholder="250000" ${mayCost ? '' : 'disabled'} />`,
          mayCost ? '' : 'Cost price is an owner or admin decision at this dealership, so it is shown here but not editable. Everything else on this vehicle can still be saved.')}
    </div>
    ${f('uRec', 'AI recommendation (optional)', `<textarea id="uRec" rows="2">${esc(u.ai_recommendation || '')}</textarea>`,
        'Normally written by the pricing workflow. Editable here for a manual override.')}
    <div class="card" style="background:var(--sunken);margin-top:4px">
      <div class="label-caps" style="margin-bottom:10px">Calculated</div>
      <dl class="kv" id="uCalc"></dl>
      <div class="cell-sub" style="margin-top:10px" id="uRateNote"></div>
      <div class="cell-sub" style="margin-top:8px">
        These are worked out here for you and are not what gets saved. Saving stores the
        stock number, model, VIN, status, acquisition date, price, cost and recommendation;
        the figures above are the Inventory Profit Sentinel's, recomputed from those inputs
        the moment this screen next reads it.
      </div>
    </div>`,
    `<button class="btn primary" id="uSave"${mayEdit ? '' : ` disabled title="${esc(isNew
       ? 'Adding a vehicle states what it cost, so it is an owner or admin decision at this dealership.'
       : 'Changing a vehicle is an owner, admin or manager decision at this dealership. You can read everything on this form.')}"`}>${isNew ? 'Add vehicle' : 'Save changes'}</button>
     <button class="btn" id="uCancel">Cancel</button>
     <div style="flex:1"></div>
     ${isNew || !mayDelete ? '' : '<button class="btn danger" id="uDelete">Delete</button>'}`);

  const read = () => ({
    id: $('uId').value.trim(),
    model: $('uModel').value.trim(),
    vin: $('uVin').value.trim(),
    status: $('uStatus').value,
    acquired_at: $('uAcq').value,
    price_aed: $('uPrice').value,
    cost_aed: $('uCost').value,
    ai_recommendation: $('uRec').value.trim(),
  });

  /* Five of these seven can be unknown, and clearing the date field is all it
     takes — `<input type="date">` empties on demand. num() and aed() already
     print "—" for a null, so the money rows need nothing. The band does: pill()
     given a null renders `<span class="pill "><span class="dot"></span></span>`,
     an empty grey chip that reads as a state rather than the absence of one, so
     it is spelled out with the reason attached. */
  const NO_DATE = `<span class="t-muted" title="${esc(
    'No acquisition date, so there is no day count to band this unit by. '
    + 'The nightly recompute skips rows with no acquired_at, so nothing will fill this in either.',
  )}">—</span>`;

  /* A figure that cannot be worked out is shown as words plus its inputs, never
     as an em dash. aed(null) prints "—", and an em dash in a money row reads as
     nothing owed — which for a holding cost is exactly the zero this pass
     exists to stop printing. */
  const notComputable = (why, inputs) =>
    `<span class="t-warm" title="${esc(why)}">Not computable</span>`
    + `<div class="cell-sub" style="white-space:normal;text-align:right">${esc(why)}${
      inputs ? `<br>${esc(inputs)}` : ''}</div>`;

  /* PLACEHOLDER is marked on the figure itself and not underneath it. A rate the
     dealership has not stood behind produces a number that looks exactly like a
     real one, and a caveat two rows below is a caveat nobody screenshots. */
  const assumed = (html, why) =>
    `${html} <span class="pill warm" title="${esc(why)}"><span class="dot"></span>assumed</span>`;

  /* CFG is null until the settings read lands, and null means "no rate", which
     is the state that shows the inputs instead of a figure. So the panel is
     correct before the read returns and correct after it — it never shows a
     number that later turns out to have been derived from nothing. */
  let CFG = null;

  const paint = () => {
    const d = deriveUnit(read(), CFG);
    const placeholder = d.holding_cost_state === 'PLACEHOLDER';
    const rateWhy = CFG && CFG.rate != null
      ? `Rate ${aed(CFG.rate)} a day${CFG.setBy ? `, put on record by ${CFG.setBy}` : ''}${CFG.source ? `, source: ${CFG.source}` : ''}.`
        + (placeholder ? ' Recorded as a PLACEHOLDER — a working assumption, not a figure this dealership has stood behind.' : '')
      : (d.holding_cost_note || NO_RATE.why);
    const inputs = `Capital tied up ${aed(n0(read().cost_aed))}`
      + (d.days_in_stock == null ? ', no day count' : `, ${num(d.days_in_stock)} days on the lot`)
      + '.';

    /* The aging band passes verbatim: false, deliberately. The word is
       deriveUnit()'s, and which threshold produced it depends on whether the
       settings row was read — 90 when it was, the 75-day fallback when it was
       not — so it is not a value any column is holding, and the band is printed
       with the two numbers that made it. */
    const bandWhy = `WARNING at ${num(d.aging_warn_days)} days, CRITICAL at ${num(d.aging_critical_days)}`
      + (CFG ? ', from this dealership\'s Sentinel settings.' : ', the built-in fallback — the settings row has not been read.');

    $('uCalc').innerHTML = `
      <dt>Days in stock</dt><dd class="num">${d.days_in_stock == null ? NO_DATE : num(d.days_in_stock)}</dd>
      <dt>Aging alert</dt><dd>${d.aging_alert
        ? `<span title="${esc(bandWhy)}">${pill(d.aging_alert, undefined, { verbatim: false })}</span>`
        : NO_DATE}</dd>
      <dt>Gross margin</dt><dd class="num ${d.gross_margin < 0 ? 't-hot' : ''}">${d.gross_margin_state !== 'COMPUTED'
        ? notComputable(d.gross_margin_note, '')
        : aed(d.gross_margin)}</dd>
      <dt>Holding cost</dt><dd class="num">${d.holding_cost_state === 'NOT_COMPUTABLE'
        ? notComputable(rateWhy, inputs)
        : placeholder ? assumed(aed(d.holding_cost_accrued), rateWhy) : aed(d.holding_cost_accrued)}</dd>
      <dt>Net margin</dt><dd class="num">${d.net_margin_state === 'NOT_COMPUTABLE'
        ? notComputable(d.gross_margin == null
            ? d.net_margin_note
            : `Gross margin of ${aed(d.gross_margin)} is real; the holding cost that would be subtracted from it is not on record.`,
          d.gross_margin == null ? '' : inputs)
        : placeholder
          ? assumed(`<strong class="${d.net_margin < 0 ? 't-hot' : ''}">${aed(d.net_margin)}</strong>`, rateWhy)
          : `<strong class="${d.net_margin < 0 ? 't-hot' : ''}">${aed(d.net_margin)}</strong>`}</dd>
      <dt>VAT</dt><dd class="num">${aed(d.vat_amount)}</dd>
      <dt>Recommended commission</dt><dd class="num">${d.recommended_commission == null
        ? notComputable('Commission is a share of net margin, and net margin is not computable for this unit.', '')
        : placeholder ? assumed(aed(d.recommended_commission), rateWhy) : aed(d.recommended_commission)}</dd>`;

    const note = $('uRateNote');
    if (note) {
      note.innerHTML = esc(
        (CFG && CFG.rate != null
          ? `Holding cost is ${aed(CFG.rate)} a day from this dealership's Sentinel settings`
            + `${CFG.setBy ? `, on record from ${CFG.setBy}` : ''}${CFG.source ? ` (${CFG.source})` : ''}`
            + `${placeholder ? '. That rate is a PLACEHOLDER, so every figure derived from it above is marked as an assumption.' : '.'}`
          : `No holding rate is on record for this dealership, so holding cost, net margin and the commission are not computable and this form will not invent them. `
            + `${CFG ? (CFG.why || NO_RATE.why) : 'The settings row has not come back yet.'}`)
        + ` VAT is ${INV.VAT_RATE * 100}% of list and commission is ${INV.COMMISSION_RATE * 100}% of net margin; neither of those two rates is sourced from this dealership.`
        + ' Days are counted on the Dubai calendar, the same one the database counts on.',
      );
    }
  };

  /* Fire-and-forget: paint() is already correct without it, and this repaints
     with the rate once it lands. A failure resolves to the no-rate state rather
     than rejecting, so there is nothing here that can throw into the modal. */
  holdingSettings().then((cfg) => { CFG = cfg; if ($('uCalc')) paint(); });
  ['uStatus', 'uAcq', 'uPrice', 'uCost'].forEach(id =>
    $(id).addEventListener('input', paint));
  paint();

  m.wrap.querySelector('#uCancel').addEventListener('click', m.close);

  m.wrap.querySelector('#uSave').addEventListener('click', async () => {
    /* The button is already disabled in this case; this is the second lock on
       the same rule, because a disabled attribute is one DOM edit away from
       gone. The real one is rbac_02's inventory_role_update policy. */
    if (!mayEdit) return;
    const v = read();
    if (!v.id) return m.msg('<span class="t-hot">A stock number is required.</span>');
    if (!v.model) return m.msg('<span class="t-hot">A model is required.</span>');
    if (!v.acquired_at) return m.msg('<span class="t-hot">An acquisition date is required.</span>');
    if (v.price_aed === '' || (mayCost && v.cost_aed === ''))
      return m.msg(`<span class="t-hot">${mayCost ? 'List price and cost are both required' : 'A list price is required'} — every margin on this screen is derived from them.</span>`);
    /* `min="0"` on a number input is a spinner hint, not a constraint: typing
       -5000 submits happily. Gross margin, net margin, VAT and the recommended
       commission are all derived from these two, so one negative number here
       propagates into five stored columns and into whatever the workflows and
       the Finance Desk read out of them afterwards. */
    if (Number(v.price_aed) < 0 || (mayCost && Number(v.cost_aed) < 0))
      return m.msg('<span class="t-hot">List price and cost cannot be negative — every margin, the VAT figure and the commission are derived from them.</span>');
    if (!Number.isFinite(Number(v.price_aed)) || (mayCost && !Number.isFinite(Number(v.cost_aed))))
      return m.msg('<span class="t-hot">List price and cost must both be numbers.</span>');
    if (isNew && inv.some(x => String(x.id) === v.id))
      return m.msg(`<span class="t-hot">Stock number ${esc(v.id)} already exists.</span>`);

    const btn = m.wrap.querySelector('#uSave');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      /* Same reasoning as the delete branch below, and it became true of the
         save path on 5 Sep 2026 when the role model gave `inventory` a
         RESTRICTIVE write policy. A PATCH the policy filters out is not an
         error: PostgREST answers 200 with [], which is indistinguishable from
         success until the screen reloads and the change is not there. So check
         what came back before closing the modal and telling the operator it
         saved. Three explanations fit an empty result and the message names all
         three rather than guessing between them. */
      const saved = isNew
        ? await dbWrite('POST', 'inventory', unitRow(v, true))
        : await dbWrite('PATCH', `inventory?id=eq.${encodeURIComponent(v.id)}`, unitRow(v, mayCost));
      if (Array.isArray(saved) && saved.length === 0) {
        btn.disabled = false; btn.textContent = isNew ? 'Add vehicle' : 'Save changes';
        return m.msg(`<span class="t-hot">Nothing was saved. No row in stock has stock number ${esc(v.id)} any more,
          or your account is not allowed to change this vehicle. Nothing was changed either way.</span>`);
      }
      m.close(); onDone();
    } catch (e) {
      btn.disabled = false; btn.textContent = isNew ? 'Add vehicle' : 'Save changes';
      modalError(m, e);
    }
  });

  m.wrap.querySelector('#uDelete')?.addEventListener('click', () => {
    m.msg(`<span class="t-hot">Delete ${esc(u.id)} — ${esc(u.model)}? This cannot be undone.</span>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn danger" id="uDelYes">Yes, delete it</button>
        <button class="btn" id="uDelNo">Keep it</button></div>`);
    $('uDelNo').addEventListener('click', () => m.msg(''));
    $('uDelYes').addEventListener('click', async () => {
      try {
        /* dbWrite sends `Prefer: return=representation`, so a DELETE that matched
           nothing comes back 200 with []. Closing the modal on that reported a
           deletion that never happened — the row is still there when the screen
           reloads, and the operator has been told otherwise. Check what came
           back before claiming anything. */
        /* rpc/inventory_delete_unit rather than DELETE on the table. Both are
           gated in the database, but the table path refuses by RLS, which is
           200 with an empty body — indistinguishable from "already gone", and
           the branch below has to guess between three explanations. The RPC
           raises NX001 and says which one it is, and it will not silently
           erase a unit that has recommendation history behind it. */
        const gone = await dbWrite('POST', 'rpc/inventory_delete_unit', { p_unit_id: u.id });
        if (Array.isArray(gone) && gone.length === 0) {
          m.msg(`<span class="t-hot">Nothing was deleted — no row in inventory has stock number ${esc(u.id)} any more.
            It may already be gone, or your account may not be allowed to delete it. The list is unchanged.</span>`);
          return;
        }
        m.close(); onDone();
      } catch (e) { modalError(m, e); }
    });
  });
}

/* holdingSettings is exported so screens/inventory.js reads the holding rate
   through the same memoised call this form uses. One read, one answer: the
   form and the table beside it cannot disagree about whether a rate exists. */
export { INV, NO_RATE, holdingSettings, today0, deriveUnit, unitRow, nextStockId, isoDate, unitForm };
