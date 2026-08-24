/* NEXUS OS — screens/finance.js
   The finance desk.

   One job above all others: a rep types four numbers and reads back an equity
   figure, a finance tier and an APR that they are about to say out loud to a
   customer. Everything on this screen is built around not getting that wrong.

   Five rules this file follows:

   1. The Finance Calc workflow validates hard and rejects with
      `{status:'error', errors:[…]}` and an HTTP 200 — a raw rejection is not an
      error the rep can act on ("lead_email is required" is workflow language,
      not desk language). So the form validates against the same contract
      *before* sending, per field, and a rejection that still comes back is
      rendered as prose rather than as a dump.
   2. Nothing on this screen is computed locally from a quote, with exactly one
      declared exception — the monthly instalment of rule 5, which the workflow
      does not return at all. Equity, LTV, tier and APR are read off the workflow
      response and off `finance_quotes` and are never recomputed here.
   3. A quote is a promise made to a named person. Attribution (`lead_name`,
      `lead_email`, `quoted_by`) travels with every request — `quoted_by` from
      the session, never from a field a rep can type into. Since 24 Aug the
      person's phone number travels with their name everywhere it is shown,
      because "call them back before the quote lapses" is the action almost
      every alert on this screen resolves to. Where there is no number the cell
      says so with an em dash; a `…@lid` WhatsApp handle is never printed as if
      it were a name.
   4. The alert strip at the top is `v_needs_attention?screen=eq.finance` plus
      five checks the view does not make, every one of them computed from rows
      this screen had already read — no read exists on this screen purely to
      decorate it. The view returns no finance row today, so "nothing right now"
      is the normal case and is written as a sentence naming what was checked
      and what came back, never as an empty box. A check whose read failed or
      was truncated is withheld and named rather than reported as a reassuring
      zero.
   5. Every money figure on this screen states its assumptions. The stored ones
      say they are stored (Value and Payoff are what the rep typed; equity, LTV,
      tier and APR are what the workflow returned). The one modelled figure —
      the monthly instalment — never appears without its rate, its term and its
      down payment, because a monthly payment with hidden assumptions is not a
      quote, it is a number a customer will hold us to.

   The workflow's own limits, mirrored below so the rep sees them before the
   round trip rather than after it: `vehicleValue` must be at least AED 5,000,
   `lead_email` is required and format-checked, and `finance_quotes.credit_score`
   carries a 300–900 CHECK constraint in Postgres. The field names the workflow
   accepts are exactly vehicleValue / loanPayoffAmount / creditScore — it logs a
   REJECTED audit row for anything else, so they are not renamed here. */
import { HOOK, ME, SESSION, db, n8n } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { N8N_BASE } from '../lib/env.js';
import { aed, ago, esc, n0, num, pct, pill, tone } from '../lib/format.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, table, wireRows } from '../lib/ui.js';
import { INV, deriveUnit } from '../lib/unit-form.js';

const MIN_VEHICLE_VALUE = 5000;              // workflow: vehicleValue >= 5000
const SCORE_MIN = 300, SCORE_MAX = 900;      // finance_quotes.credit_score CHECK
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* Read ceilings. Each one is stated on screen when it is hit: a count drawn
   from a truncated read is a smaller number, not a wrong-looking one, and
   nothing else on the page would reveal it. */
const HISTORY_LIMIT = 200;
const LEAD_LIMIT = 500;
const ATTN_LIMIT = 100;

/* How long a quote is good for. There is no company policy in the database that
   says this, so it is this screen's assumption and the alert says so in full
   ("older than 7 days") rather than using the word "expired" as if the row
   carried a flag. If a row turns out to carry its own validity date (see
   VALID_COLS) that date wins and the alert says which it used. */
const QUOTE_VALID_DAYS = 7;

/* The instalment model, in one place. The term is a desk default because no
   column carries one; the down payment is preferably the quote's own
   loan-to-value and only falls back to this default when the row has no LTV.
   Both are printed next to every figure they produce. */
const TERM_MONTHS = 60;
const DOWN_PAYMENT_PCT = 20;

/* Tolerance before a stored monthly payment and this desk's arithmetic are
   called a disagreement. Rounding and day-count conventions move an instalment
   by a few dirhams; anything past this is the two sides having drifted apart,
   which is the fault nobody notices until a customer is quoted the wrong
   number. */
const DRIFT_AED = 25;
const DRIFT_PCT = 2;

/* Names shown per alert before it collapses into "+N more". Clicking the row
   filters the history to the full set, so this is a glance, not the list. */
const PREVIEW = 3;

/* A lead in one of these states should not be sitting behind a live quote. WON,
   CONVERTED and DELIVERED are deliberately absent: a quote for a customer who
   bought is not a problem. */
const GONE = new Set(['COLD', 'LOST', 'DEAD', 'JUNK', 'SPAM', 'UNQUALIFIED', 'ARCHIVED']);

/* v_needs_attention's severity vocabulary is the view's, not TONE's. TONE has no
   WARNING key, so `t-${tone('WARNING')}` renders the class `t-` — no colour at
   all, and no error anywhere to notice. Map the view's words locally and fall
   back to TONE for the ones it does share. */
/* Was a private severity map; lib/format.js now covers every vocabulary that
   reaches this screen. Kept as a name so the call sites read the same. */
const sevTone = s => tone(s);
const SEV_RANK = { CRITICAL:0, HIGH:1, WARNING:2, MEDIUM:3, LOW:4, INFO:5 };
const sevRank = s => (SEV_RANK[String(s || '').toUpperCase()] ?? 9);

/* A WhatsApp handle. A LID carries no phone digits at all, so it identifies
   nobody — it is never printed as a name (24 Aug addendum). Leads are not
   supposed to carry one in `name`, but the router has written stranger things
   into that column and a quote inherits whatever it found. */
const HANDLE = /@(lid|c\.us|s\.whatsapp\.net|g\.us)$/i;

const NO_N8N = 'VITE_N8N_BASE_URL is not set in this build, so the Finance Calc '
  + 'workflow cannot be reached from the browser. Set it and redeploy.';

/* Averages over rows Postgres returned, reporting how many rows actually
   carried the column so a mean over three quotes never reads like a mean over
   two hundred. */
function mean(rows, key) {
  const xs = rows.map(r => n0(r[key])).filter(v => v != null);
  return { avg: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, n: xs.length };
}
const lower = v => String(v == null ? '' : v).toLowerCase();
const str = v => String(v == null ? '' : v).trim();
const up = v => str(v).toUpperCase();
const ts = v => { const t = new Date(v).getTime(); return Number.isNaN(t) ? 0 : t; };
const plural = (n, one, many) => (Number(n) === 1 ? one : many);
const eqTone = s => (lower(s) === 'negative' ? 'hot' : lower(s) === 'positive' ? 'ok' : '');
const eqClass = s => (lower(s) === 'negative' ? 't-hot' : lower(s) === 'positive' ? 't-ok' : '');
const stamp = ts2 => (ts2 ? new Date(ts2).toLocaleString('en-GB', { hour12: false }) : '—');

/* SCHEMA.md documents `finance_quotes` as "lead_email, lead_name, and the quote
   fields" and stops there, so which optional columns exist is not knowable from
   the contract. Naming one that does not exist in a `select=` is not a blank
   column, it is PostgREST 42703 and the *whole* query dies — so this screen asks
   for `*` and then looks at what actually arrived. Every check that depends on
   one of these says out loud when it is absent instead of quietly not running. */
const MONTHLY_COLS  = ['monthly_payment_aed', 'monthly_payment', 'monthly_installment_aed', 'installment_aed', 'estimated_monthly_aed'];
const VALID_COLS    = ['valid_until', 'quote_valid_until', 'valid_till', 'expires_at'];
const TERM_COLS     = ['term_months', 'loan_term_months', 'tenure_months'];
const FINANCED_COLS = ['loan_amount_aed', 'financed_amount_aed', 'amount_financed_aed'];
const DOWN_COLS     = ['down_payment_aed', 'deposit_aed', 'downpayment_aed'];
const hasCol = (rows, key) => rows.some(r => r && Object.prototype.hasOwnProperty.call(r, key));
const pickCol = (rows, names) => names.find(k => hasCol(rows, k)) || null;

/* Standard amortising instalment. This is the one piece of arithmetic on this
   screen that is not the workflow's (rule 2) — the workflow returns equity, a
   tier and an APR and no payment at all, and a rep who needs a monthly figure
   will otherwise work it out on a phone calculator with assumptions nobody can
   see afterwards. A zero rate is not a division by zero here, it is principal
   over term. */
function instalment(principal, aprPct, months) {
  if (principal == null || aprPct == null || !months || months <= 0 || principal <= 0) return null;
  const r = aprPct / 100 / 12;
  if (r === 0) return principal / months;
  return principal * r / (1 - Math.pow(1 + r, -months));
}

SCREENS.finance = async host => {
  /* ── Layout ────────────────────────────────────────────────────────────── */
  const alertCard = el('div', 'card flush');
  alertCard.innerHTML = `<div class="card-head"><div>
      <div class="card-title">Needs attention</div>
      <div class="card-sub">v_needs_attention for this screen, plus five checks this screen runs on the quotes and leads it just read</div>
    </div><div style="flex:1"></div>
    <button class="btn sm" id="fqRecheck"><span class="material-symbols-outlined">refresh</span> Re-check</button></div>
    <div class="pbody">${stateLoading(2)}</div>`;
  host.appendChild(alertCard);

  const strip = el('div', 'grid g4');
  strip.style.marginTop = '16px';
  strip.innerHTML = stateLoading(2);
  host.appendChild(strip);

  const cols = el('div', 'grid g2 top');
  cols.style.marginTop = '16px';
  host.appendChild(cols);

  const leftCol = el('div');
  const rightCol = el('div');
  cols.appendChild(leftCol);
  cols.appendChild(rightCol);

  const histCard = el('div', 'card flush');
  histCard.style.marginTop = '16px';
  host.appendChild(histCard);

  /* ── The quote form ────────────────────────────────────────────────────── */
  const formCard = el('div', 'card');
  leftCol.appendChild(formCard);

  const field = (id, label, input, hint) => `
    <div class="field">
      <label for="${id}">${label}</label>
      ${input}
      ${hint ? `<div class="hint">${hint}</div>` : ''}
      <div class="hint t-hot" id="err-${id}" role="alert"></div>
    </div>`;

  formCard.innerHTML = `
    <div class="card-title" style="margin-bottom:4px">Quote a trade-in</div>
    <div class="card-sub" style="margin-bottom:16px">
      Runs the live Finance Calc workflow, which returns the equity, tier and APR
      and records the quote in <span class="mono">finance_quotes</span>.</div>
    <div class="grid" style="gap:14px">
      ${field('fLead', 'Lead',
        `<select id="fLead" disabled><option value="">Loading leads…</option></select>`,
        'Picking a lead fills in the customer. You can still type the details by hand.')}
      <div id="fLeadCtx"></div>
      <div class="grid g2" style="gap:14px">
        ${field('fVal', 'Trade-in vehicle value (AED)',
          `<input type="number" id="fVal" min="${MIN_VEHICLE_VALUE}" step="1000" inputmode="numeric" placeholder="185000" />`,
          `Minimum ${aed(MIN_VEHICLE_VALUE)} — the workflow rejects anything lower.`)}
        ${field('fPay', 'Outstanding loan payoff (AED)',
          `<input type="number" id="fPay" min="0" step="1000" inputmode="numeric" placeholder="60000" />`,
          'Enter 0 if the customer owns the car outright.')}
      </div>
      ${field('fScore', 'AECB credit score',
        `<input type="number" id="fScore" min="${SCORE_MIN}" max="${SCORE_MAX}" step="1" inputmode="numeric" placeholder="720" />`,
        `${SCORE_MIN}–${SCORE_MAX}. Entered by hand from the customer's AECB report — real-time bureau
         lookups need a licensed financial-institution agreement in the UAE.`)}
      <div class="grid g2" style="gap:14px">
        ${field('fName', 'Customer name', `<input type="text" id="fName" placeholder="Full name" />`)}
        ${field('fEmail', 'Customer email', `<input type="email" id="fEmail" placeholder="name@example.com" />`,
          'Required by the workflow. Without it the quote is stored attached to nobody.')}
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn primary" id="fGo"${N8N_BASE ? '' : ` disabled title="${esc(NO_N8N)}"`}>
          <span class="material-symbols-outlined">calculate</span> Calculate quote</button>
        <button class="btn ghost" id="fClear">Clear</button>
        <div style="flex:1"></div>
        <span class="cell-sub">Quoted by ${esc(ME?.name || SESSION?.user?.email || 'the signed-in user')}</span>
      </div>
      ${N8N_BASE ? '' : `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">link_off</span>
        <div>${esc(NO_N8N)}</div></div>`}
    </div>`;

  /* ── The result card ───────────────────────────────────────────────────── */
  const resultCard = el('div', 'card flush');
  resultCard.innerHTML = `<div class="card-head"><div>
      <div class="card-title">Quote result</div>
      <div class="card-sub">Straight from the workflow response — the only figure worked out here is the monthly instalment, and it carries its assumptions</div>
    </div></div><div class="pbody" id="fOut"></div>`;
  rightCol.appendChild(resultCard);

  const out = () => $('fOut');
  out().innerHTML = stateEmpty('No quote yet',
    'Fill in the trade-in value, the payoff, the credit score and the customer, then calculate.', 'calculate');

  /* ── The commission card ───────────────────────────────────────────────── */
  const commCard = el('div', 'card flush');
  commCard.style.marginTop = '16px';
  commCard.innerHTML = `<div class="card-head"><div>
      <div class="card-title">Commission on a unit</div>
      <div class="card-sub">Recomputed live from acquisition date, list price and cost, the same way Inventory does it</div>
    </div></div>
    <div class="pbody" id="cBody">${stateLoading(3)}</div>`;
  rightCol.appendChild(commCard);

  /* ── Form plumbing ─────────────────────────────────────────────────────── */
  const FIELDS = ['fVal', 'fPay', 'fScore', 'fName', 'fEmail'];
  let touched = false;   // no red text before the rep has tried to submit once

  const read = () => ({
    vehicleValue: $('fVal').value.trim(),
    loanPayoffAmount: $('fPay').value.trim(),
    creditScore: $('fScore').value.trim(),
    lead_name: $('fName').value.trim(),
    lead_email: $('fEmail').value.trim(),
  });

  /* Mirrors the workflow's own validation. Everything caught here is a round
     trip the customer does not wait through, and a REJECTED audit row that
     never gets written. */
  function validate(v) {
    const e = {};
    const val = n0(v.vehicleValue);
    if (!v.vehicleValue) e.fVal = 'Required — the workflow will not price a trade-in without a value.';
    else if (val == null) e.fVal = 'Enter a number.';
    else if (val < MIN_VEHICLE_VALUE) e.fVal = `Must be at least ${aed(MIN_VEHICLE_VALUE)}. The workflow rejects anything lower.`;

    const pay = n0(v.loanPayoffAmount);
    if (v.loanPayoffAmount === '') e.fPay = 'Required — enter 0 if there is no outstanding loan.';
    else if (pay == null) e.fPay = 'Enter a number.';
    else if (pay < 0) e.fPay = 'A payoff cannot be negative.';

    const score = n0(v.creditScore);
    if (!v.creditScore) e.fScore = 'Required.';
    else if (score == null || !Number.isInteger(score)) e.fScore = 'Enter a whole number.';
    else if (score < SCORE_MIN || score > SCORE_MAX) e.fScore = `AECB scores run from ${SCORE_MIN} to ${SCORE_MAX}.`;

    if (!v.lead_name) e.fName = 'Required — a quote with no name on it cannot be traced back to anyone.';
    if (!v.lead_email) e.fEmail = 'Required by the workflow.';
    else if (!EMAIL_RE.test(v.lead_email)) e.fEmail = 'That does not look like an email address.';
    return e;
  }

  function paintErrors(e) {
    FIELDS.forEach(id => {
      const box = $(`err-${id}`);
      const msg = touched ? (e[id] || '') : '';
      box.textContent = msg;
      $(id).setAttribute('aria-invalid', msg ? 'true' : 'false');
    });
    /* Not an error — the two figures are simply the wrong way round, which is a
       real and common situation and produces a negative-equity quote. */
    const v = read();
    const val = n0(v.vehicleValue), pay = n0(v.loanPayoffAmount);
    const warn = $('err-fPay');
    const showWarn = !e.fPay && val != null && pay != null && pay > val;
    warn.classList.toggle('t-hot', !showWarn);
    if (showWarn) warn.textContent = 'Payoff is above the vehicle value, so expect a negative-equity result.';
  }

  FIELDS.forEach(id => $(id).addEventListener('input', () => { if (touched) paintErrors(validate(read())); }));

  $('fClear').addEventListener('click', () => {
    FIELDS.forEach(id => { $(id).value = ''; });
    $('fLead').value = '';
    $('fLeadCtx').innerHTML = '';
    touched = false;
    paintErrors({});
    out().innerHTML = stateEmpty('No quote yet',
      'Fill in the trade-in value, the payoff, the credit score and the customer, then calculate.', 'calculate');
  });

  /* ── Screen state ──────────────────────────────────────────────────────── */
  let rows = [], quotesErr = null;      // finance_quotes
  let leads = null, leadsErr = null;    // null = the read failed, not "no leads"
  let attn = null, attnErr = null;      // v_needs_attention rows for this screen
  let cols2 = { monthly: null, valid: null, term: null, financed: null, down: null };
  let filter = 'all';
  let query = '';
  let focusKey = null;                  // an alert the history is filtered to
  let checks = [];
  const checkByKey = new Map();

  const keyOf = r => (r && r.id != null ? String(r.id) : 'row-' + rows.indexOf(r));
  const leadByEmail = new Map();
  const leadFor = q => (leads ? leadByEmail.get(lower(str(q.lead_email))) || null : null);

  /* ── Identity ───────────────────────────────────────────────────────────
     A name and a number, together, everywhere a person appears. `leads.phone`
     is the only phone this screen can reach — finance_quotes carries none — so
     an unmatched quote has no number to show and says that, rather than showing
     an em dash that reads like "this customer has no phone". */
  const personName = (name, fallback) => {
    const n = str(name);
    if (!n) return fallback || '<span class="t-muted">Unnamed customer</span>';
    if (HANDLE.test(n)) {
      return `<span class="mono" title="This is a WhatsApp chat handle, not a name. A LID contains no phone digits and identifies nobody on its own.">${esc(n)}</span>`;
    }
    return esc(n);
  };
  function phoneCell(q) {
    if (!leads) {
      return `<span class="t-muted" title="${esc('The leads read failed' + (leadsErr ? ` (${leadsErr.message})` : '')
        + ', so no phone number could be looked up for any quote on this screen.')}">phone unavailable</span>`;
    }
    const lead = leadFor(q);
    if (!lead) {
      return `<span class="t-muted" title="No lead in the database carries this email address, so there is no phone number to show. finance_quotes stores no phone of its own.">—</span>`;
    }
    if (!str(lead.phone)) {
      return '<span class="t-muted" title="This lead has no phone number on file.">—</span>';
    }
    return `<span class="mono">${esc(str(lead.phone))}</span>`;
  }

  /* ── The money model ────────────────────────────────────────────────────
     Everything the monthly figure rests on, per quote, plus where each input
     came from — the row itself or this desk. Nothing here is ever shown without
     the sentence that `assumptions()` builds from it. */
  function basis(q) {
    const value = n0(q.vehicle_value_aed);
    const apr = n0(q.indicative_apr_pct);
    const ltv = n0(q.loan_to_value_pct);
    const rowTerm = cols2.term ? n0(q[cols2.term]) : null;
    const term = rowTerm || TERM_MONTHS;
    const termFrom = rowTerm ? 'the quote row' : `this desk's ${TERM_MONTHS}-month default`;

    let principal = null, downFrom = null;
    const rowFinanced = cols2.financed ? n0(q[cols2.financed]) : null;
    const rowDown = cols2.down ? n0(q[cols2.down]) : null;
    if (rowFinanced != null) { principal = rowFinanced; downFrom = 'the amount financed recorded on the quote'; }
    else if (rowDown != null && value != null) { principal = value - rowDown; downFrom = 'the down payment recorded on the quote'; }
    else if (value != null && ltv != null) { principal = value * ltv / 100; downFrom = `the quote's own loan to value of ${pct(ltv)}`; }
    else if (value != null) { principal = value * (1 - DOWN_PAYMENT_PCT / 100); downFrom = `this desk's ${DOWN_PAYMENT_PCT}% down-payment default`; }

    const down = (value != null && principal != null) ? value - principal : null;
    const downPct = (value && down != null) ? down / value * 100 : null;
    const stored = cols2.monthly ? n0(q[cols2.monthly]) : null;
    const monthly = instalment(principal, apr, term);
    const gap = (stored != null && monthly != null) ? Math.abs(stored - monthly) : null;
    const drifted = gap != null && gap > Math.max(DRIFT_AED, Math.abs(stored) * DRIFT_PCT / 100);
    return { value, apr, ltv, term, termFrom, principal, down, downPct, downFrom, stored, monthly, gap, drifted };
  }
  /* One quote is drawn in the table, in the drawer and in an alert on the same
     paint; the basis is identical each time and is worked out once. */
  const basisCache = new Map();
  const basisOf = q => {
    const k = keyOf(q);
    if (!basisCache.has(k)) basisCache.set(k, basis(q));
    return basisCache.get(k);
  };

  function assumptions(b) {
    if (b.apr == null) {
      return 'No indicative APR is recorded on this quote, so no monthly figure is shown. '
        + 'A payment worked out at a rate this screen invented would be worse than no payment at all.';
    }
    if (b.principal == null) {
      return 'This quote records no vehicle value, so there is no amount to amortise and no monthly figure is shown.';
    }
    return `Monthly is this desk's arithmetic, not the workflow's: ${pct(b.apr)} APR taken from this quote, `
      + `a ${num(b.term)}-month term from ${b.termFrom}, and ${aed(b.down)} down`
      + `${b.downPct == null ? '' : ` (${pct(b.downPct)} of the vehicle value)`} from ${b.downFrom}. `
      + `It amortises ${aed(b.principal)}.`;
  }
  const monthlyCell = q => {
    const b = basisOf(q);
    const t = esc(assumptions(b));
    return b.monthly == null
      ? `<span class="t-muted" title="${t}">—</span>`
      : `<span title="${t}">${aed(b.monthly)}</span>${b.drifted ? ' <span class="t-hot" title="The monthly payment stored on this row disagrees with the same sum worked out from the row’s own figures.">≠</span>' : ''}`;
  };

  /* ── Quote history ─────────────────────────────────────────────────────── */
  histCard.innerHTML = `
    <div class="card-head"><div>
      <div class="card-title">Quote history</div>
      <div class="card-sub">Every calculation is recorded, newest first, with the customer, their number and the rep it belongs to</div>
    </div><div style="flex:1"></div>
    <button class="btn sm" id="fqRefresh"><span class="material-symbols-outlined">refresh</span> Refresh</button></div>
    <div class="toolbar">
      <input class="grow" type="search" id="fqSearch" placeholder="Search customer, phone, tier or rep"
             aria-label="Search quote history" />
      <div class="seg" role="group" aria-label="Filter by equity">
        <button data-f="all" class="on">All</button>
        <button data-f="Positive">Positive equity</button>
        <button data-f="Negative">Negative equity</button>
      </div>
    </div>
    <div id="fqBody">${stateLoading(4)}</div>`;

  const matches = r => {
    const focus = focusKey ? checkByKey.get(focusKey) : null;
    if (focus && !focus.keys.has(keyOf(r))) return false;
    if (filter !== 'all' && r.equity_status !== filter) return false;
    if (!query) return true;
    const lead = leadFor(r);
    return [r.lead_name, r.lead_email, r.finance_tier, r.quoted_by, r.equity_status, lead?.phone, lead?.name]
      .some(v => lower(v).includes(query));
  };

  /* The money footnote. Said under the table rather than per cell because it is
     the same sentence for every row, and said at all because a column of
     dirham figures with no stated basis is the thing this round is about. */
  function moneyNote() {
    const bits = [
      'Value and Payoff are the figures the rep entered. Equity, LTV, tier and APR are what the Finance Calc workflow returned '
        + 'and are not recomputed here.',
      `Monthly is the only modelled figure on this table: it amortises the amount financed at the quote's own indicative APR over `
        + `${cols2.term ? 'the term on the row' : `a ${TERM_MONTHS}-month term (this desk's default — these rows carry no term column)`}, `
        + `with the down payment taken from ${cols2.down || cols2.financed ? 'the figures on the row' : 'the quote’s own loan to value, or from this desk’s ' + DOWN_PAYMENT_PCT + '% default where the row has no LTV'}. `
        + 'Hover a Monthly cell for that row’s exact rate, term and down payment.',
      'A quote with no APR shows no monthly figure at all rather than one at a rate this screen made up.',
      cols2.monthly
        ? `A ≠ marks a row whose stored ${cols2.monthly} disagrees with that sum by more than ${aed(DRIFT_AED)} or ${DRIFT_PCT}%.`
        : 'These rows carry no stored monthly payment, so nothing here can be checked against one.',
    ];
    return `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
      <div class="cell-sub" style="white-space:normal">${bits.map(esc).join('<br>')}</div>
    </div>`;
  }

  function drawHistory() {
    const body = $('fqBody');
    if (!body) return;
    if (quotesErr) { body.innerHTML = stateError('quote history', quotesErr.message); return; }
    if (!rows.length) {
      body.innerHTML = stateEmpty('No quotes recorded yet',
        'Every calculation from this screen is stored here, with the customer and the rep it belongs to.', 'receipt_long');
      return;
    }
    const shown = rows.filter(matches);
    const focus = focusKey ? checkByKey.get(focusKey) : null;
    const focusNote = focus ? `<div style="padding:14px 20px 0">
        <div class="banner info"><span class="material-symbols-outlined">filter_alt</span>
        <div style="flex:1">Showing only the ${num(focus.quotes.length)} ${plural(focus.quotes.length, 'quote', 'quotes')} behind
          “${esc(focus.title)}”. The search and equity filters were cleared so that set is not hidden by them.</div>
        <button class="btn sm" id="fqFocusClear">Show all quotes</button></div></div>` : '';

    body.innerHTML = focusNote + table([
      { label: 'When', render: r => `<span title="${esc(stamp(r.created_at))}">${ago(r.created_at)}</span>` },
      { label: 'Customer', strong: true, render: r =>
        `${personName(r.lead_name, personName(leadFor(r)?.name, '<span class="t-muted">Unnamed</span>'))}
         <div class="cell-sub">${phoneCell(r)} · ${r.lead_email
           ? esc(str(r.lead_email))
           : '<span class="t-hot" title="This quote has no lead_email, so it can never be matched back to a person.">no email recorded</span>'}</div>` },
      { label: 'Score', align: 'r', render: r => num(r.credit_score) },
      { label: 'Value', align: 'r', render: r => `<span title="As entered by the rep at quote time — no rate, term or down payment applied.">${aed(r.vehicle_value_aed)}</span>` },
      { label: 'Payoff', align: 'r', render: r => `<span title="As entered by the rep at quote time — the loan outstanding on the trade-in.">${aed(r.loan_payoff_aed)}</span>` },
      { label: 'Equity', align: 'r', render: r =>
        `<span class="${eqClass(r.equity_status)}" title="Vehicle value less the outstanding payoff, as the workflow returned it.">${aed(r.equity_aed)}</span>` },
      { label: 'LTV', align: 'r', render: r => pct(r.loan_to_value_pct) },
      { label: 'Tier', render: r => (r.finance_tier ? `<span class="chip">${esc(r.finance_tier)}</span>` : '<span class="t-muted">—</span>') },
      { label: 'APR', align: 'r', render: r => pct(r.indicative_apr_pct) },
      { label: 'Monthly', align: 'r', render: monthlyCell },
      { label: 'Quoted by', render: r =>
        `${esc(r.quoted_by || '—')}<div class="cell-sub">${esc(r.source || '')}</div>` },
    ], shown, {
      empty: stateEmpty('Nothing matches that filter',
        'No recorded quote matches the current search or equity filter.', 'filter_alt_off'),
      onRow: quoteDrawer,
    }) + (shown.length ? moneyNote() : '');
    wireRows(body, shown, quoteDrawer);
    $('fqFocusClear')?.addEventListener('click', () => { focusKey = null; drawHistory(); });
  }

  function drawStrip() {
    if (quotesErr) { strip.innerHTML = stateError('the quote figures', quotesErr.message); return; }
    const negative = rows.filter(r => r.equity_status === 'Negative').length;
    const priced = rows.filter(r => r.equity_status).length;
    const apr = mean(rows, 'indicative_apr_pct');
    const ltv = mean(rows, 'loan_to_value_pct');
    const capped = rows.length >= HISTORY_LIMIT;
    strip.innerHTML = [
      kpi('Quotes recorded', num(rows.length),
        rows.length
          ? (capped
            ? `<span class="t-muted">Newest ${num(HISTORY_LIMIT)} shown · latest ${ago(rows[0].created_at)}</span>`
            : `<span class="t-muted">Latest ${ago(rows[0].created_at)}</span>`)
          : '<span class="t-muted">Nothing quoted from this desk yet</span>'),
      kpi('Negative equity', num(negative),
        priced
          ? `<span class="${negative ? 't-hot' : 't-ok'}">${pct(negative / priced * 100)} of ${num(priced)} quotes</span>`
          : '<span class="t-muted">No quote carries an equity status</span>',
        negative ? 't-hot' : ''),
      kpi('Avg indicative APR', pct(apr.avg),
        apr.n ? `<span class="t-muted">Across ${num(apr.n)} quotes with an APR</span>`
              : '<span class="t-muted">No quote carries an APR</span>'),
      kpi('Avg loan to value', pct(ltv.avg),
        ltv.n ? `<span class="t-muted">Across ${num(ltv.n)} quotes with an LTV</span>`
              : '<span class="t-muted">No quote carries an LTV</span>'),
    ].join('');
  }

  /* ── The five checks this screen makes ───────────────────────────────────
     All five run on rows already fetched for the table and the lead picker —
     no read exists on this screen to feed an alert. Each states the denominator
     it counted against, and each one whose input is missing or truncated is
     withheld and named rather than reported as zero. */
  function buildChecks() {
    const now = Date.now();
    const quotesCapped = rows.length >= HISTORY_LIMIT;
    const leadsCapped = !!leads && leads.length >= LEAD_LIMIT;
    /* A quote whose lead sits outside the newest LEAD_LIMIT leads would look
       orphaned when it is only unread. False accusations of a missing customer
       record are worse than a withheld check, so the check is withheld. */
    const canProveMissing = !!leads && !leadsCapped;

    const validOf = q => {
      const rowDate = cols2.valid ? q[cols2.valid] : null;
      if (rowDate && ts(rowDate)) return { at: ts(rowDate), source: 'row' };
      const made = ts(q.created_at);
      return made ? { at: made + QUOTE_VALID_DAYS * 86400000, source: 'desk' } : null;
    };
    const expired = rows.filter(q => { const v = validOf(q); return v && v.at < now; })
      .sort((a, b) => ts(a.created_at) - ts(b.created_at));

    const noEmail = rows.filter(q => !str(q.lead_email));
    const withEmail = rows.filter(q => str(q.lead_email));
    const orphan = canProveMissing ? withEmail.filter(q => !leadFor(q)) : [];
    const coldLead = leads
      ? withEmail.filter(q => { const l = leadFor(q); return l && GONE.has(up(l.status)); })
      : [];
    const drifted = cols2.monthly ? rows.filter(q => basisOf(q).drifted) : [];

    const out2 = [
      {
        key: 'drift',
        sev: 'CRITICAL',
        icon: 'rule',
        title: `${num(drifted.length)} ${plural(drifted.length, 'quote has', 'quotes have')} a stored monthly payment that does not match its own figures`,
        detail: `The monthly payment stored in ${cols2.monthly} disagrees with the same instalment worked out from the row's own `
          + `vehicle value, APR and loan to value by more than ${aed(DRIFT_AED)} or ${DRIFT_PCT}% on `
          + `${num(drifted.length)} of the ${num(rows.length)} ${plural(rows.length, 'quote', 'quotes')} read here. `
          + 'Either the stored figure was computed on assumptions this screen does not have, or the calculator and the row have drifted apart — '
          + 'and a customer quoted from the stored number is being told something the rest of the row does not support. '
          + 'Hover the Monthly cell on each row for the rate, term and down payment used here.',
        quotes: drifted,
        skip: !cols2.monthly,
      },
      {
        key: 'noemail',
        sev: 'CRITICAL',
        icon: 'alternate_email',
        title: `${num(noEmail.length)} ${plural(noEmail.length, 'quote has', 'quotes have')} no customer email`,
        detail: `${num(noEmail.length)} of the ${num(rows.length)} ${plural(rows.length, 'quote', 'quotes')} read here `
          + `${plural(noEmail.length, 'carries', 'carry')} no lead_email. finance_quotes is keyed to a person by that column and by nothing else, `
          + 'so these can never be matched to a lead, a phone number or a conversation — the promise was made to nobody. '
          + 'The workflow has required lead_email since 13 Aug 2026, so a row here is older than that fix or was written by something else.',
        quotes: noEmail,
      },
      {
        key: 'expired',
        sev: 'WARNING',
        icon: 'event_busy',
        title: `${num(expired.length)} ${plural(expired.length, 'quote is', 'quotes are')} past ${plural(expired.length, 'its', 'their')} validity`,
        detail: `${num(expired.length)} of the ${num(rows.length)} ${plural(rows.length, 'quote', 'quotes')} read here ${plural(expired.length, 'is', 'are')} past `
          + (cols2.valid
            ? `the validity date on the row (${cols2.valid}).`
            : `${QUOTE_VALID_DAYS} days old. No column on finance_quotes carries a validity date, so ${QUOTE_VALID_DAYS} days is this screen's assumption and not a company policy the database knows about.`)
          + ` The oldest was quoted ${ago(expired[0]?.created_at)}. `
          + 'The equity, tier and APR on an expired quote were priced against that day’s rate sheet and that day’s vehicle value; re-run it before it is repeated to the customer.',
        quotes: expired,
      },
      {
        key: 'orphan',
        sev: 'WARNING',
        icon: 'person_off',
        title: `${num(orphan.length)} ${plural(orphan.length, 'quote has', 'quotes have')} no matching lead record`,
        detail: `${num(orphan.length)} of the ${num(withEmail.length)} ${plural(withEmail.length, 'quote', 'quotes')} with an email address `
          + `${plural(orphan.length, 'names', 'name')} an address that matches none of the ${num(leads?.length || 0)} leads read here. `
          + 'The lead was deleted or merged after the quote was made, so there is no phone number, no status and no conversation behind the figure.',
        quotes: orphan,
        skip: !canProveMissing,
      },
      {
        key: 'cold',
        sev: 'WARNING',
        icon: 'ac_unit',
        title: `${num(coldLead.length)} live ${plural(coldLead.length, 'quote belongs', 'quotes belong')} to a lead that has gone cold`,
        detail: `${num(coldLead.length)} ${plural(coldLead.length, 'quote names', 'quotes name')} a lead whose status is now `
          + `${[...GONE].slice(0, 3).join(', ')} or similar. Either the quote is the reason to call them back, or the status is stale — `
          + 'both are worth a minute, and neither is visible from the history table on its own.'
          + (leadsCapped ? ` The leads read stopped at ${num(LEAD_LIMIT)} rows, so a quote whose lead was not among them is not counted here.` : ''),
        quotes: coldLead,
        skip: !leads,
      },
    ].filter(c => !c.skip && c.quotes.length);

    out2.forEach(c => { c.keys = new Set(c.quotes.map(keyOf)); });

    /* Everything the strip cannot claim, said out loud. A count quietly computed
       from a failed or truncated read is the failure mode this file is written
       against. */
    const notes = [
      quotesErr
        ? `The quote read failed (${quotesErr.message}), so none of this screen's own checks could run.`
          + (attnErr ? '' : ' Only what v_needs_attention returned is shown above.')
        : '',
      attnErr
        ? `v_needs_attention could not be read (${attnErr.message}), so anything the database would have listed for this screen is missing from this strip.`
          + (quotesErr ? '' : ' The checks below still ran.')
        : '',
      leadsErr
        ? `The leads read failed (${leadsErr.message}), so no quote could be matched to a customer record: no phone number is shown on any row, and the missing-lead and gone-cold checks did not run. They are absent from this strip rather than shown as zero.`
        : '',
      quotesCapped
        ? `The quote read stopped at ${num(HISTORY_LIMIT)} rows, so every count here covers the newest ${num(HISTORY_LIMIT)} quotes and not necessarily the whole table.`
        : '',
      leadsCapped
        ? `The leads read stopped at the ${num(LEAD_LIMIT)} newest leads. A quote whose customer is older than those would look like it had no lead record, so the missing-lead check is withheld rather than accusing a customer record of not existing.`
        : '',
      rows.length && !cols2.monthly
        ? 'None of the quotes read here carries a stored monthly payment, so the stored-versus-calculated check could not run at all. The Monthly column is this desk’s own arithmetic and there is nothing to disagree with it.'
        : '',
      rows.length && !cols2.valid
        ? `finance_quotes carries no validity date in these rows, so "past its validity" means older than ${QUOTE_VALID_DAYS} days — this screen's assumption, stated so nobody reads it as a policy.`
        : '',
      out2.length > 1
        ? 'A quote can satisfy more than one check, so these counts overlap and do not add up to a total.'
        : '',
    ].filter(Boolean);

    return { checks: out2, notes };
  }

  /* ── The alert strip ───────────────────────────────────────────────────── */
  function drawAlerts() {
    const body = alertCard.querySelector('.pbody');
    if (!body) return;
    basisCache.clear();
    const built = buildChecks();
    checks = built.checks;
    checkByKey.clear();
    checks.forEach(c => checkByKey.set(c.key, c));

    const viewItems = [...(attn || [])].sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || ts(b.at) - ts(a.at));

    /* The view's `ref` for a finance row is not documented, so it is matched
       against both things it could plausibly be — a quote id and a customer
       email — and where it matches neither the row is rendered as text rather
       than as a button that does nothing. */
    const matchRef = ref => {
      const r = str(ref);
      if (!r) return null;
      return rows.find(q => keyOf(q) === r || lower(str(q.lead_email)) === lower(r)) || null;
    };

    const viewRows = viewItems.map(it => {
      const q = matchRef(it.ref);
      const sev = str(it.severity);
      const idLine = q
        ? `<div class="cell-sub">${personName(q.lead_name, '<span class="t-muted">Unnamed customer</span>')} <span class="t-muted">·</span> ${phoneCell(q)}</div>`
        : `<div class="cell-sub t-muted">Refers to ${esc(str(it.ref) || 'no ref')}, which is not among the ${num(rows.length)} ${plural(rows.length, 'quote', 'quotes')} loaded here, so it cannot be opened from this screen.</div>`;
      return `<div class="list-item"${q
          ? ` role="button" tabindex="0" data-quote="${esc(keyOf(q))}" title="Open this quote"`
          : ' style="cursor:default"'}>
        <span class="material-symbols-outlined t-${esc(sevTone(sev) || 'muted')}" style="font-size:20px">warning</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${sev ? pill(sev, sevTone(sev)) : ''}${esc(str(it.title) || str(it.kind) || 'Attention item')}
            <span class="chip">${esc(str(it.kind) || 'item')}</span>
          </div>
          <div class="cell-sub">${esc(str(it.detail))}</div>
          ${idLine}
          <div class="cell-sub t-muted">${it.at
            ? `Waiting since ${esc(stamp(it.at))} — ${esc(ago(it.at))}`
            : 'The view gave this item no timestamp, so how long it has been waiting is unknown.'}</div>
        </div>
        ${q ? '<span class="material-symbols-outlined t-muted" style="font-size:18px">chevron_right</span>' : ''}
      </div>`;
    }).join('');

    const previewOf = qs => {
      const shown = qs.slice(0, PREVIEW).map(q =>
        `<button type="button" class="chip" style="border:0;cursor:pointer;font-family:inherit" data-open="${esc(keyOf(q))}"
          title="Open this quote">${personName(q.lead_name, personName(leadFor(q)?.name, '<span class="t-muted">Unnamed</span>'))}
          <span class="t-muted">·</span> ${phoneCell(q)}</button>`).join(' ');
      const rest = qs.length - Math.min(qs.length, PREVIEW);
      return `${shown}${rest ? ` <span class="t-muted">+${num(rest)} more</span>` : ''}`;
    };

    const checkRows = checks.map(c => `
      <div class="list-item" role="button" tabindex="0" data-focus="${esc(c.key)}"
        title="Show these ${esc(String(c.quotes.length))} quotes in the history below">
        <span class="material-symbols-outlined t-${esc(sevTone(c.sev))}" style="font-size:20px">${c.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${pill(c.sev, sevTone(c.sev))}${esc(c.title)}
          </div>
          <div class="cell-sub">${esc(c.detail)}</div>
          <div class="cell-sub" style="margin-top:4px">${previewOf(c.quotes)}</div>
        </div>
        <span class="material-symbols-outlined t-muted" style="font-size:18px">filter_alt</span>
      </div>`).join('');

    /* The honest empty case, which today is the only case: a sentence naming
       what was checked and what came back, so "no alerts" reads as a result
       rather than as a panel that failed to load. */
    const checked = [
      `no quote is past ${cols2.valid ? 'the validity date on its row' : `${QUOTE_VALID_DAYS} days old`}`,
      'every quote carries a customer email',
      leads && leads.length < LEAD_LIMIT ? 'every quote matches a lead record' : '',
      leads ? 'no quote belongs to a lead that has gone cold' : '',
      cols2.monthly ? 'no stored monthly payment disagrees with its own figures' : '',
    ].filter(Boolean);
    /* Built as a sentence, not a comma salad: this line is the whole claim the
       panel is making on a day with no alerts, and it has to read like one. */
    const checkedText = checked.length > 1
      ? `${checked.slice(0, -1).join(', ')} and ${checked[checked.length - 1]}`
      : checked.join('');
    /* "Nothing needs attention" is a claim, and it may only be made when both
       halves of the strip actually reported. A failed read is not an all-clear,
       and the panel that says otherwise is worse than no panel: it is the one
       an operator stops checking. */
    const clear = !attnErr && !quotesErr;
    const cannotSay = attnErr && quotesErr
      ? 'v_needs_attention could not be read and the quote read failed, so neither the database’s list nor this screen’s own five checks could be produced. Nothing is being claimed here.'
      : attnErr
        ? `v_needs_attention could not be read, so the database’s own list for this screen is missing. `
          + (rows.length
            ? `This screen’s five checks did run, and across the ${num(rows.length)} ${plural(rows.length, 'quote', 'quotes')} read here ${checkedText} — that is those five checks only, not an all-clear.`
            : 'There is no quote on the desk for this screen’s own checks to judge either, so nothing here is an all-clear.')
        : `v_needs_attention returned no row for this screen. The quote read failed, so this screen’s own five checks could not run and nothing here speaks for them.`;
    const nothing = `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined t-${clear ? 'ok' : 'warm'}" style="font-size:20px">${clear ? 'task_alt' : 'help'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500">${clear
          ? 'Nothing on the finance desk needs attention right now'
          : 'Whether anything needs attention here is not known right now'}</div>
        <div class="cell-sub">${clear
          ? (rows.length
            ? `v_needs_attention returned no row for this screen, and across the ${num(rows.length)} ${plural(rows.length, 'quote', 'quotes')} read here ${checkedText}.`
            /* Zero quotes is not five checks passing — it is five checks with
               nothing to judge, and saying "every quote carries an email" of an
               empty table is how a panel starts lying quietly. */
            : 'v_needs_attention returned no row for this screen, and there is no quote on the desk for this screen’s own checks to judge.')
          : esc(cannotSay)}</div>
      </div>
    </div>`;

    const notesRow = built.notes.length ? `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
      <div class="cell-sub" style="white-space:normal">${built.notes.map(esc).join('<br>')}</div>
    </div>` : '';

    body.innerHTML = (viewItems.length || checks.length ? viewRows + checkRows : nothing) + notesRow;

    /* Every alert row is the only route from the alert to the quotes it is
       about, so all of them are keyboard-operable. */
    const wire = (sel, run) => body.querySelectorAll(sel).forEach(n => {
      const go2 = ev => { ev.stopPropagation(); run(n); };
      n.addEventListener('click', go2);
      n.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go2(e); }
      });
    });
    wire('[data-focus]', n => focusCheck(n.dataset.focus));
    wire('[data-quote]', n => openQuote(n.dataset.quote));
    /* The chip sits inside a row that filters the table; opening one quote and
       filtering to all of them at once would be two answers to one click. */
    wire('[data-open]', n => openQuote(n.dataset.open));
  }

  function openQuote(key) {
    const q = rows.find(r => keyOf(r) === key);
    if (q) quoteDrawer(q);
  }

  /* Clicking an alert answers "which quotes?" in the table below it. The search
     and equity filters are cleared first, because a focused set half-hidden by
     a filter the operator set ten minutes ago is a wrong answer. */
  function focusCheck(key) {
    if (!checkByKey.has(key)) return;
    focusKey = key;
    filter = 'all';
    query = '';
    const search = $('fqSearch');
    if (search) search.value = '';
    histCard.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x.dataset.f === 'all'));
    drawHistory();
    histCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── Reads ───────────────────────────────────────────────────────────────
     Three reads, started together so the screen costs one round of requests.
     Each records its own failure instead of throwing: a failed leads read must
     not take the quote table down, and a failed attention read must not take
     the checks down — but neither is allowed to look like an answer. */
  async function loadQuotes() {
    try {
      rows = await db(`finance_quotes?select=*&order=created_at.desc&limit=${HISTORY_LIMIT}`);
      quotesErr = null;
    } catch (e) { rows = []; quotesErr = e; }
    cols2 = {
      monthly: pickCol(rows, MONTHLY_COLS),
      valid: pickCol(rows, VALID_COLS),
      term: pickCol(rows, TERM_COLS),
      financed: pickCol(rows, FINANCED_COLS),
      down: pickCol(rows, DOWN_COLS),
    };
    basisCache.clear();
  }

  async function loadLeads() {
    try {
      leads = await db('leads?select=id,name,email,phone,vehicle_interest,budget_aed,status'
        + `&order=created_at.desc&limit=${LEAD_LIMIT}`);
      leadsErr = null;
    } catch (e) { leads = null; leadsErr = e; }
    leadByEmail.clear();
    (leads || []).forEach(l => { const k = lower(str(l.email)); if (k) leadByEmail.set(k, l); });
  }

  async function loadAttention() {
    try {
      attn = await db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen'
        + `&screen=eq.finance&limit=${ATTN_LIMIT}`);
      attnErr = null;
    } catch (e) { attn = null; attnErr = e; }
  }

  function renderAll() { drawStrip(); drawHistory(); drawAlerts(); }

  $('fqRefresh').addEventListener('click', async () => {
    const body = $('fqBody');
    if (body) body.innerHTML = stateLoading(4);
    strip.innerHTML = stateLoading(2);
    await loadQuotes();
    focusKey = null;              // the focused set was built from the old rows
    renderAll();
  });
  $('fqRecheck').addEventListener('click', async () => {
    alertCard.querySelector('.pbody').innerHTML = stateLoading(2);
    await Promise.all([loadAttention(), loadQuotes(), loadLeads()]);
    focusKey = null;
    fillLeadPicker();
    renderAll();
  });
  $('fqSearch').addEventListener('input', e => {
    query = lower(e.target.value).trim();
    /* Typing a search while an alert is focused is the operator asking for the
       whole table back; keeping the focus would silently hide matches. */
    if (query) focusKey = null;
    drawHistory();
  });
  histCard.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    filter = b.dataset.f;
    focusKey = null;
    histCard.querySelectorAll('.seg button').forEach(x => x.classList.toggle('on', x === b));
    drawHistory();
  }));

  /* ── One recorded quote, in full ───────────────────────────────────────── */
  function quoteDrawer(q) {
    const b = basisOf(q);
    const lead = leadFor(q);
    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1;min-width:0">
          <h2 style="font-size:18px">${personName(q.lead_name, personName(lead?.name, 'Unnamed customer'))}</h2>
          <div class="cell-sub" style="margin-top:4px">${phoneCell(q)}</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
            ${q.equity_status ? pill(q.equity_status, eqTone(q.equity_status)) : ''}
            ${q.finance_tier ? `<span class="chip">${esc(q.finance_tier)}</span>` : ''}
            ${q.source ? `<span class="chip">${esc(q.source)}</span>` : ''}
            ${lead?.status ? pill(lead.status) : ''}
          </div>
        </div>
        <button class="btn ghost sm" id="fqClose" aria-label="Close quote">
          <span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        <div class="section">
          <div class="label-caps">Quote</div>
          <dl class="kv">
            <dt>Equity</dt><dd class="num ${eqClass(q.equity_status)}"><strong>${aed(q.equity_aed)}</strong></dd>
            <dt>Indicative APR</dt><dd class="num">${pct(q.indicative_apr_pct)}</dd>
            <dt>Finance tier</dt><dd>${esc(q.finance_tier || '—')}</dd>
            <dt>Loan to value</dt><dd class="num">${pct(q.loan_to_value_pct)}</dd>
          </dl>
          <div class="cell-sub" style="margin-top:8px;white-space:normal">
            These four are what the Finance Calc workflow returned on ${esc(stamp(q.created_at))} and are not recomputed here.</div>
        </div>
        <div class="section">
          <div class="label-caps">Monthly instalment · this desk's arithmetic</div>
          <dl class="kv">
            <dt>Monthly</dt><dd class="num"><strong>${b.monthly == null ? '—' : aed(b.monthly)}</strong></dd>
            <dt>Rate</dt><dd class="num">${b.apr == null ? '—' : pct(b.apr) + ' APR, from this quote'}</dd>
            <dt>Term</dt><dd>${b.monthly == null ? '—' : `${num(b.term)} months, from ${esc(b.termFrom)}`}</dd>
            <dt>Down payment</dt><dd class="num">${b.monthly == null ? '—' : `${aed(b.down)}${b.downPct == null ? '' : ` · ${pct(b.downPct)}`}`}</dd>
            <dt>Amount financed</dt><dd class="num">${b.monthly == null ? '—' : aed(b.principal)}</dd>
            ${cols2.monthly ? `<dt>Stored on the row</dt><dd class="num ${b.drifted ? 't-hot' : ''}">${aed(b.stored)}</dd>` : ''}
          </dl>
          <div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(assumptions(b))}${
            b.drifted
              ? `<br><span class="t-hot">The ${esc(cols2.monthly)} stored on this row is ${esc(aed(b.gap))} away from that figure. Do not repeat either number to the customer until the two agree.</span>`
              : ''}</div>
        </div>
        <div class="section">
          <div class="label-caps">Inputs</div>
          <dl class="kv">
            <dt>Vehicle value</dt><dd class="num">${aed(q.vehicle_value_aed)}</dd>
            <dt>Loan payoff</dt><dd class="num">${aed(q.loan_payoff_aed)}</dd>
            <dt>Credit score</dt><dd class="num">${num(q.credit_score)}</dd>
          </dl>
          <div class="cell-sub" style="margin-top:8px;white-space:normal">
            As entered by the rep at quote time. No rate, term or down payment is applied to these two figures.</div>
        </div>
        <div class="section">
          <div class="label-caps">Attribution</div>
          <dl class="kv">
            <dt>Customer</dt><dd>${personName(q.lead_name, '—')}</dd>
            <dt>Phone</dt><dd>${phoneCell(q)}</dd>
            <dt>Email</dt><dd>${q.lead_email ? esc(str(q.lead_email)) : '<span class="t-hot">— no email, so this quote matches no person</span>'}</dd>
            <dt>Lead record</dt><dd>${leads
              ? (lead
                ? `${personName(lead.name, '<span class="t-muted">Unnamed lead</span>')}${lead.status ? ' · ' + esc(str(lead.status)) : ''}`
                : '<span class="t-warm">No lead in the database carries this email</span>')
              : '<span class="t-muted">Leads could not be read, so this was not checked</span>'}</dd>
            <dt>Quoted by</dt><dd>${esc(q.quoted_by || '—')}</dd>
            <dt>Recorded</dt><dd>${esc(stamp(q.created_at))}</dd>
          </dl>
        </div>
        ${q.disclaimer ? `<div class="section">
          <div class="label-caps">Disclaimer given</div>
          <div class="quote">${esc(q.disclaimer)}</div></div>` : ''}
      </div>
      <div class="drawer-foot">
        <button class="btn" id="fqReuse">
          <span class="material-symbols-outlined">edit_note</span> Load into the calculator</button>
      </div>`);
    $('fqClose').addEventListener('click', closeDrawer);
    $('fqReuse').addEventListener('click', () => {
      $('fVal').value = n0(q.vehicle_value_aed) ?? '';
      $('fPay').value = n0(q.loan_payoff_aed) ?? '';
      $('fScore').value = n0(q.credit_score) ?? '';
      $('fName').value = q.lead_name || '';
      $('fEmail').value = q.lead_email || '';
      if (touched) paintErrors(validate(read()));
      closeDrawer();
      formCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('fVal').focus();
    });
  }

  /* ── Calculate ─────────────────────────────────────────────────────────── */
  $('fGo').addEventListener('click', async () => {
    touched = true;
    const v = read();
    const errs = validate(v);
    paintErrors(errs);
    const bad = Object.keys(errs);
    if (bad.length) {
      out().innerHTML = `<div class="banner warm">
        <span class="material-symbols-outlined" style="font-size:20px">edit</span>
        <div>${bad.length === 1 ? 'One field needs fixing' : `${esc(String(bad.length))} fields need fixing`}
        before this can be sent — see the messages on the form.</div></div>`;
      $(bad[0]).focus();
      return;
    }

    const btn = $('fGo');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-symbols-outlined">hourglass_top</span> Calculating…';
    out().innerHTML = stateLoading(3);

    try {
      const r = await n8n(HOOK.finance, {
        vehicleValue: v.vehicleValue,
        loanPayoffAmount: v.loanPayoffAmount,
        creditScore: v.creditScore,
        lead_name: v.lead_name,
        lead_email: v.lead_email,
        quoted_by: ME?.name || SESSION?.user?.email || null,
      });
      renderQuote(r, v);
    } catch (e) {
      const msg = String(e?.message || e);
      out().innerHTML = /VITE_N8N_BASE_URL/.test(msg)
        ? `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">link_off</span>
             <div>${esc(NO_N8N)}</div></div>`
        : stateError('the quote', msg);
    } finally {
      btn.disabled = !N8N_BASE;
      btn.innerHTML = '<span class="material-symbols-outlined">calculate</span> Calculate quote';
    }
  });

  /* The workflow answers 200 for everything, including its own rejections, so
     the shape of the body is what decides which of the three outcomes this is:
     a rejection, an answer with no quote in it, or a quote. */
  function renderQuote(r, sent) {
    const res = r && typeof r === 'object' ? r : {};
    const listed = Array.isArray(res.errors) ? res.errors.filter(Boolean).map(String) : [];
    const rejected = lower(res.status) === 'error' || (listed.length && lower(res.status) !== 'success');

    if (rejected) {
      const unauth = listed.some(m => /unauthor|forbidden|token|jwt/i.test(m));
      out().innerHTML = `<div class="banner hot">
          <span class="material-symbols-outlined" style="font-size:20px">block</span>
          <div><strong>The finance workflow would not price this.</strong>
            <div style="margin-top:6px">${
              unauth
                ? 'It did not accept this session. Sign out and sign back in, then try again.'
                : (listed.length ? listed.map(esc).join('<br>') : 'It rejected the request without saying why.')
            }</div>
            <div class="cell-sub" style="margin-top:6px;white-space:normal">Nothing was written to the quote history.</div>
          </div></div>`;
      return;
    }

    const hasQuote = n0(res.equity_aed) != null || res.finance_tier || n0(res.indicative_apr_pct) != null;
    if (!hasQuote) {
      out().innerHTML = `<div class="banner warm">
          <span class="material-symbols-outlined" style="font-size:20px">help</span>
          <div><strong>The workflow replied, but with no quote in it.</strong>
            <div style="margin-top:6px">Nothing is shown here rather than a figure that was not returned.
              Check the Finance Calc execution in n8n.</div></div></div>`;
      return;
    }

    const ltv = n0(res.loan_to_value_pct);
    /* Same model as the history table, on the response instead of a stored row,
       so the figure the rep reads out now and the figure in the history a week
       later are the same arithmetic. */
    const b = basis({
      vehicle_value_aed: sent.vehicleValue,
      indicative_apr_pct: res.indicative_apr_pct,
      loan_to_value_pct: res.loan_to_value_pct,
    });
    out().innerHTML = `
      <div class="grid g2">
        ${kpi('Equity', `<span class="${eqClass(res.equity_status)}">${aed(res.equity_aed)}</span>`,
          res.equity_status ? pill(res.equity_status, eqTone(res.equity_status)) : '')}
        ${kpi('Indicative APR', pct(res.indicative_apr_pct),
          res.finance_tier ? `<span class="chip">${esc(res.finance_tier)}</span>` : '')}
      </div>
      ${ltv == null ? '' : `<div style="margin-top:16px">
        <div class="label-caps" style="margin-bottom:6px">Loan to value · ${pct(ltv)}</div>
        <div class="bar"><i style="width:${Math.min(100, Math.max(0, ltv))}%;background:var(--${ltv > 80 ? 'hot' : 'primary'})"></i></div>
        ${ltv > 80 ? '<div class="cell-sub t-hot" style="margin-top:6px">Above 80% — most lenders will want a deposit.</div>' : ''}
      </div>`}
      <div style="margin-top:16px">
        <div class="label-caps" style="margin-bottom:6px">Indicative monthly instalment</div>
        <div class="kpi-value sm">${b.monthly == null ? '—' : aed(b.monthly)}</div>
        <div class="cell-sub" style="margin-top:6px;white-space:normal">${esc(assumptions(b))}
          ${b.monthly == null ? '' : esc(' Say it with the rate, the term and the deposit attached, or do not say it.')}</div>
      </div>
      <dl class="kv" style="margin-top:16px">
        <dt>Quoted for</dt><dd>${personName(sent.lead_name, '—')}<div class="cell-sub">${esc(sent.lead_email)}</div></dd>
        <dt>On a value of</dt><dd class="num">${aed(sent.vehicleValue)}</dd>
        <dt>Payoff</dt><dd class="num">${aed(sent.loanPayoffAmount)}</dd>
        <dt>Credit score</dt><dd class="num">${num(sent.creditScore)}</dd>
      </dl>
      ${res.disclaimer ? `<div class="quote" style="margin-top:16px">${esc(res.disclaimer)}</div>` : ''}
      <div class="cell-sub" style="margin-top:12px;white-space:normal">
        Recorded by the workflow in finance_quotes. If it is not in the history below, refresh it.</div>`;

    /* The workflow writes the row; this screen only re-reads it. A failed
       re-read must not make a successful quote look like it failed, so the
       result above stays exactly as it is. */
    loadQuotes().then(() => { focusKey = null; renderAll(); });
  }

  /* ── The lead picker ───────────────────────────────────────────────────── */
  function fillLeadPicker() {
    const sel = $('fLead');
    if (!sel) return;
    if (!leads) {
      sel.innerHTML = '<option value="">Lead list unavailable</option>';
      sel.disabled = true;
      sel.title = `Leads could not be loaded (${leadsErr ? leadsErr.message : 'unknown error'}). Type the customer name and email in by hand.`;
      $('fLeadCtx').innerHTML = `<div class="hint t-hot">Lead list unavailable — ${esc(leadsErr ? leadsErr.message : 'unknown error')}. Type the customer in by hand.</div>`;
      return;
    }
    const usable = leads.filter(l => l.email);
    if (!usable.length) {
      sel.innerHTML = '<option value="">No lead has an email address on file</option>';
      sel.disabled = true;
      sel.title = 'The workflow keys a quote on the customer email, and no lead in the database has one.';
      return;
    }
    sel.disabled = false;
    sel.innerHTML = '<option value="">— pick a lead, or type the customer in by hand —</option>'
      + usable.map(l => `<option value="${esc(l.email)}"
           data-name="${esc(l.name || '')}"
           data-phone="${esc(l.phone || '')}"
           data-veh="${esc(l.vehicle_interest || '')}"
           data-budget="${esc(l.budget_aed == null ? '' : l.budget_aed)}"
           data-status="${esc(l.status || '')}"
         >${esc(l.name || l.email)}${l.phone ? ' — ' + esc(l.phone) : ''}${l.vehicle_interest ? ' — ' + esc(l.vehicle_interest) : ''}</option>`).join('');
    sel.onchange = e => {
      const o = e.target.selectedOptions[0];
      const ctx = $('fLeadCtx');
      if (!o || !o.value) { ctx.innerHTML = ''; return; }
      $('fEmail').value = o.value;
      $('fName').value = o.dataset.name || '';
      if (touched) paintErrors(validate(read()));
      /* Context only. The lead's budget is what they intend to spend on the
         next car — it is not the trade-in's value, so it is never written
         into the value field. */
      ctx.innerHTML = `<div class="quote">
          ${o.dataset.status ? pill(o.dataset.status) + ' ' : ''}
          ${o.dataset.phone
            ? `<span class="mono">${esc(o.dataset.phone)}</span>. `
            : '<span class="t-muted">No phone number on this lead.</span> '}
          ${o.dataset.veh ? `Interested in ${esc(o.dataset.veh)}. ` : ''}
          ${o.dataset.budget ? `Budget on file ${aed(o.dataset.budget)}` : 'No budget captured by the router'}
          <div class="cell-sub" style="margin-top:4px">Shown for context — the trade-in value below is a different number.</div>
        </div>`;
    };
  }

  await Promise.all([loadQuotes(), loadLeads(), loadAttention()]);
  fillLeadPicker();
  renderAll();

  db('inventory?select=*&order=model')
    .then(inv => {
      const body = $('cBody');
      if (!body) return;
      if (!inv.length) {
        body.innerHTML = stateEmpty('No inventory', 'There is no unit to compute a commission on.', 'directions_car');
        return;
      }
      const units = inv.map(deriveUnit);
      body.innerHTML = `
        <div class="field"><label for="cVeh">Vehicle</label>
          <select id="cVeh">${units.map((u, i) =>
            `<option value="${esc(String(i))}">${esc(u.model || u.id || 'Unnamed unit')}${u.status ? ' · ' + esc(u.status) : ''}</option>`).join('')}
          </select></div>
        <div id="cOut" style="margin-top:16px"></div>`;
      const sel = $('cVeh');
      const draw = () => {
        const u = units[Number(sel.value)] || units[0];
        $('cOut').innerHTML = `
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
            ${u.aging_alert ? pill(u.aging_alert) : ''}
            <span class="chip">${esc(u.id || '—')}</span>
            <span class="chip">${num(u.days_in_stock)} days in stock</span>
          </div>
          <dl class="kv">
            <dt>List price</dt><dd class="num">${aed(u.price_aed)}</dd>
            <dt>Cost</dt><dd class="num">${aed(u.cost_aed)}</dd>
            <dt>Gross margin</dt><dd class="num ${(n0(u.gross_margin) || 0) < 0 ? 't-hot' : ''}">${aed(u.gross_margin)}</dd>
            <dt>Holding cost</dt><dd class="num ${(n0(u.holding_cost_accrued) || 0) > 5000 ? 't-hot' : 't-muted'}">${aed(u.holding_cost_accrued)}</dd>
            <dt>Net margin</dt><dd class="num"><strong class="${(n0(u.net_margin) || 0) < 0 ? 't-hot' : ''}">${aed(u.net_margin)}</strong></dd>
            <dt>VAT</dt><dd class="num">${aed(u.vat_amount)}</dd>
            <dt>Commission</dt><dd class="num" style="font-size:18px;font-weight:600">${aed(u.recommended_commission)}</dd>
          </dl>
          <div class="cell-sub" style="margin-top:10px;white-space:normal">
            ${esc(`List price and cost are the figures on the unit. Everything under them is worked out here on stated rates, not read off the row: `
              + `holding cost at ${aed(INV.HOLDING_PER_DAY)} per day since acquisition (a sold unit stops accruing), `
              + `VAT at ${INV.VAT_RATE * 100}% of the list price, and commission at ${INV.COMMISSION_RATE * 100}% of net margin. `
              + `Recomputed from the unit's acquisition date each time this is opened, so it matches Inventory even between nightly recomputes.`)}</div>`;
      };
      sel.addEventListener('change', draw);
      draw();
    })
    .catch(e => {
      const body = $('cBody');
      if (body) body.innerHTML = stateError('inventory', e.message);
    });
};
