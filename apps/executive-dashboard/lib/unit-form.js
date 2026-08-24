/* NEXUS OS — lib/unit-form.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { dbWrite } from './data.js';
import { $ } from './dom.js';
import { aed, esc, n0, num, pill } from './format.js';
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

/* acquired_at is the source of truth; everything else falls out of it. Units
   that are Sold stop accruing — a sold car is not costing the lot anything. */
function deriveUnit(u) {
  const price = n0(u.price_aed) || 0;
  const cost = n0(u.cost_aed) || 0;
  let days;
  if (u.acquired_at) {
    days = Math.max(0, Math.round((today0() - new Date(u.acquired_at + 'T00:00:00')) / 86400000));
  } else {
    days = n0(u.days_in_stock) || 0;   // pre-migration rows, if any survive
  }
  const sold = String(u.status || '').toLowerCase() === 'sold';
  const holding = sold ? (n0(u.holding_cost_accrued) || 0) : days * INV.HOLDING_PER_DAY;
  const gross = price - cost;
  const net = gross - holding;
  return {
    ...u,
    days_in_stock: days,
    holding_cost_accrued: holding,
    gross_margin: gross,
    net_margin: net,
    vat_amount: Math.round(price * INV.VAT_RATE),
    recommended_commission: Math.round(net * INV.COMMISSION_RATE),
    aging_alert: sold ? 'HEALTHY'
      : days >= INV.CRITICAL_DAYS ? 'CRITICAL'
      : days >= INV.WARN_DAYS ? 'WARNING' : 'HEALTHY',
  };
}

/* What actually goes to Postgres. The derived columns are stored as well as shown,
   because n8n workflows and the Finance Desk read them straight off the table. */
function unitRow(u) {
  const d = deriveUnit(u);
  return {
    id: d.id, model: d.model, vin: d.vin || null,
    status: d.status, acquired_at: d.acquired_at,
    price_aed: n0(d.price_aed) || 0, cost_aed: n0(d.cost_aed) || 0,
    days_in_stock: d.days_in_stock, holding_cost_accrued: d.holding_cost_accrued,
    gross_margin: d.gross_margin, net_margin: d.net_margin,
    vat_amount: d.vat_amount, recommended_commission: d.recommended_commission,
    aging_alert: d.aging_alert,
    ai_recommendation: d.ai_recommendation || null,
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
   showed a brand new car as already 1 day old. */
const isoDate = d => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

function unitForm(existing, inv, onDone) {
  const isNew = !existing;
  const u = existing || {
    id: nextStockId(inv), model: '', vin: '', status: 'Available',
    acquired_at: isoDate(today0()), price_aed: '', cost_aed: '', ai_recommendation: '',
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
      ${f('uAcq', 'Acquired on', `<input type="date" id="uAcq" value="${esc(u.acquired_at || '')}" max="${isoDate(today0())}" />`,
          'Days in stock, holding cost and the aging alert are all counted from this date.')}
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

  const paint = () => {
    const d = deriveUnit(read());
    $('uCalc').innerHTML = `
      <dt>Days in stock</dt><dd class="num">${num(d.days_in_stock)}</dd>
      <dt>Aging alert</dt><dd>${pill(d.aging_alert)}</dd>
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
      try { await dbWrite('DELETE', `inventory?id=eq.${encodeURIComponent(u.id)}`, undefined); m.close(); onDone(); }
      catch (e) { modalError(m, e); }
    });
  });
}

export { INV, today0, deriveUnit, unitRow, nextStockId, isoDate, unitForm };
