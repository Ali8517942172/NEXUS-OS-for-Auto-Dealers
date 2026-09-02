/* NEXUS OS — lib/unit-form.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { dbWrite } from './data.js';
import { $ } from './dom.js';
import { TZ, aed, esc, n0, num, pill } from './format.js';
import { modalError, openModal } from './modal.js';

const INV = {
  HOLDING_PER_DAY: 50,      // AED per unit per day
  VAT_RATE: 0.05,           // UAE VAT on the list price
  COMMISSION_RATE: 0.05,    // of net margin
  WARN_DAYS: 75,
  CRITICAL_DAYS: 120,
  STATUSES: ['Available', 'Reserved', 'Sold'],
};

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
function deriveUnit(u) {
  const price = n0(u.price_aed) || 0;
  const cost = n0(u.cost_aed) || 0;
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

     Two things about that freeze are now said out loud. It is a DISPLAY freeze
     only: recompute_inventory_derived() sets `days_in_stock = d.days` for sold
     and unsold rows alike, so whatever this froze into the column was re-counted
     from acquisition the same night. Since unitRow() stopped writing derived
     columns that is no longer a fight, but it does mean the frozen figure a sold
     unit reads back is the nightly job's running count, not a days-to-sale.
     And it is gated on having a date: on an undated unit it would hand the
     stored column back under a live label, which is the fabrication three lines
     of comment above exist to end. */
  if (days != null && sold && storedDays != null) days = storedDays;
  /* No date, no holding cost. On a sold unit the stored figure is the record,
     and where that column is empty too the answer is still not zero — an empty
     accrual column is a figure nobody has written, not a car that cost nothing
     to keep. */
  const holding = days == null ? null
    : sold ? n0(u.holding_cost_accrued)
      : days * INV.HOLDING_PER_DAY;
  const gross = price - cost;
  const net = holding == null ? null : gross - holding;
  return {
    ...u,
    days_in_stock: days,
    holding_cost_accrued: holding,
    gross_margin: gross,
    net_margin: net,
    vat_amount: Math.round(price * INV.VAT_RATE),
    recommended_commission: net == null ? null : Math.round(net * INV.COMMISSION_RATE),
    aging_alert: days == null ? null
      : sold ? 'HEALTHY'
        : days >= INV.CRITICAL_DAYS ? 'CRITICAL'
          : days >= INV.WARN_DAYS ? 'WARNING' : 'HEALTHY',
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
function unitRow(u) {
  return {
    id: u.id, model: u.model, vin: u.vin || null,
    status: u.status, acquired_at: u.acquired_at,
    price_aed: n0(u.price_aed) || 0, cost_aed: n0(u.cost_aed) || 0,
    ai_recommendation: u.ai_recommendation || null,
  };
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
      ${f('uCost', 'Cost (AED)', `<input type="number" min="0" id="uCost" value="${esc(u.cost_aed)}" placeholder="250000" />`)}
    </div>
    ${f('uRec', 'AI recommendation (optional)', `<textarea id="uRec" rows="2">${esc(u.ai_recommendation || '')}</textarea>`,
        'Normally written by the pricing workflow. Editable here for a manual override.')}
    <div class="card" style="background:var(--sunken);margin-top:4px">
      <div class="label-caps" style="margin-bottom:10px">Calculated</div>
      <dl class="kv" id="uCalc"></dl>
      <div class="cell-sub" style="margin-top:10px">
        Holding cost accrues at ${aed(INV.HOLDING_PER_DAY)} a day and stops when a unit is marked Sold.
        VAT is ${(INV.VAT_RATE * 100)}% of list; commission is ${(INV.COMMISSION_RATE * 100)}% of net margin.
        Days are counted on the Dubai calendar, the same one the database counts on.
      </div>
      <div class="cell-sub" style="margin-top:8px">
        These are worked out here for you and are not what gets saved. Saving stores the
        stock number, model, VIN, status, acquisition date, price, cost and recommendation;
        every figure above is recomputed from those by the nightly ageing job, which owns
        those columns. Until it next runs, Overview and the Finance Desk may still show this
        unit's previous figures, or none at all if it is new.
      </div>
    </div>`,
    `<button class="btn primary" id="uSave">${isNew ? 'Add vehicle' : 'Save changes'}</button>
     <button class="btn" id="uCancel">Cancel</button>
     <div style="flex:1"></div>
     ${isNew ? '' : '<button class="btn danger" id="uDelete">Delete</button>'}`);

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

  const paint = () => {
    const d = deriveUnit(read());
    /* The aging band below passes verbatim: false, deliberately. The word is
       deriveUnit()'s and not the column's — this file raises WARNING at 75 days
       and recompute_inventory_derived() raises it at 90, so between 75 and 89
       the band shown here is a word inventory.aging_alert does not hold, and
       "shown exactly as the database holds it" would be the wrong claim about
       the one figure on this panel the two rules disagree on. It is
       HEALTHY | WARNING | CRITICAL either way and TONE knows all three, so the
       note could not have fired regardless; the flag says which rule wrote it. */
    $('uCalc').innerHTML = `
      <dt>Days in stock</dt><dd class="num">${d.days_in_stock == null ? NO_DATE : num(d.days_in_stock)}</dd>
      <dt>Aging alert</dt><dd>${d.aging_alert ? pill(d.aging_alert, undefined, { verbatim: false }) : NO_DATE}</dd>
      <dt>Gross margin</dt><dd class="num ${d.gross_margin < 0 ? 't-hot' : ''}">${aed(d.gross_margin)}</dd>
      <dt>Holding cost</dt><dd class="num">${aed(d.holding_cost_accrued)}</dd>
      <dt>Net margin</dt><dd class="num"><strong class="${d.net_margin < 0 ? 't-hot' : ''}">${aed(d.net_margin)}</strong></dd>
      <dt>VAT</dt><dd class="num">${aed(d.vat_amount)}</dd>
      <dt>Recommended commission</dt><dd class="num">${aed(d.recommended_commission)}</dd>`;
  };
  ['uStatus', 'uAcq', 'uPrice', 'uCost'].forEach(id =>
    $(id).addEventListener('input', paint));
  paint();

  m.wrap.querySelector('#uCancel').addEventListener('click', m.close);

  m.wrap.querySelector('#uSave').addEventListener('click', async () => {
    const v = read();
    if (!v.id) return m.msg('<span class="t-hot">A stock number is required.</span>');
    if (!v.model) return m.msg('<span class="t-hot">A model is required.</span>');
    if (!v.acquired_at) return m.msg('<span class="t-hot">An acquisition date is required.</span>');
    if (v.price_aed === '' || v.cost_aed === '')
      return m.msg('<span class="t-hot">List price and cost are both required — every margin on this screen is derived from them.</span>');
    /* `min="0"` on a number input is a spinner hint, not a constraint: typing
       -5000 submits happily. Gross margin, net margin, VAT and the recommended
       commission are all derived from these two, so one negative number here
       propagates into five stored columns and into whatever the workflows and
       the Finance Desk read out of them afterwards. */
    if (Number(v.price_aed) < 0 || Number(v.cost_aed) < 0)
      return m.msg('<span class="t-hot">List price and cost cannot be negative — every margin, the VAT figure and the commission are derived from them.</span>');
    if (!Number.isFinite(Number(v.price_aed)) || !Number.isFinite(Number(v.cost_aed)))
      return m.msg('<span class="t-hot">List price and cost must both be numbers.</span>');
    if (isNew && inv.some(x => String(x.id) === v.id))
      return m.msg(`<span class="t-hot">Stock number ${esc(v.id)} already exists.</span>`);

    const btn = m.wrap.querySelector('#uSave');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (isNew) await dbWrite('POST', 'inventory', unitRow(v));
      else await dbWrite('PATCH', `inventory?id=eq.${encodeURIComponent(v.id)}`, unitRow(v));
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
        const gone = await dbWrite('DELETE', `inventory?id=eq.${encodeURIComponent(u.id)}`, undefined);
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

export { INV, today0, deriveUnit, unitRow, nextStockId, isoDate, unitForm };
