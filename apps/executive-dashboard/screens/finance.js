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
   REJECTED audit row for anything else, so they are not renamed here.

   ── Round 4, 24 Aug 2026. Three quotes, one customer. ────────────────────────

   `finance_quotes` holds three rows and all three carry the same lead_email.
   The vehicle value on them is 152,000, then 280,000, then 100,000. That is one
   negotiation being re-priced, not a book of business, and the difference
   decides what this screen is allowed to say out loud.

   So the two averages this strip used to print — mean indicative APR and mean
   loan to value — are withdrawn, and the negative-equity percentage with them.
   A mean across one customer's three attempts is that customer's middle offer
   wearing the clothes of a market figure. What replaces them is a count of
   people, the range of values quoted, and a panel that names every question
   this screen cannot answer and says what would make it answerable. Counts and
   ranges are true at any n; a rate is not.

   The same email carries two different names — "Shabbir Ujjainwala" on one row
   and "ALI ASGHER UJJAIN WALA" on the other two. That is not cosmetic.
   `finance_quotes` stores whatever the rep typed and identifies the customer by
   email alone, so one man is filed twice: anything that groups by name splits
   him, his KYC and Customer 360 records match one spelling and not the other,
   and the next rep who searches for him by name finds two thirds of his
   history. A screen that silently picks one name hides a fault the dealership
   will hit again the next time two people type a customer differently, so it is
   raised as a check and every row says which of his names it carries.

   Three absences on `finance_quotes`, restated because each is a sentence
   somebody will otherwise invent: no term, no monthly payment, no validity
   date. The Monthly column is therefore modelled in this browser and says so on
   every row, and **no quote here can be marked expired** — nothing on the row
   records when one expires. "More than 7 days old" in the alerts is this desk's
   own prompt to re-quote, labelled as such and never as a status.

   And a rejection from the workflow is an outcome, not a fault. finance-calc is
   live and JWT-guarded and it validates hard: `audit_log` carries real REJECTED
   rows reading "vehicleValue must be a realistic vehicle valuation of at least
   AED 5000" and "lead_email is required". Every one of those is a bad quote that
   never reached a customer. So a refusal renders as the workflow declining the
   input with its reason attached — amber, not red, never the word error, and
   never a "Couldn't load" that sends a rep hunting for a bug in a dashboard
   that is working exactly as designed. The same rendering is reached whether the
   workflow refuses with a 200 or a guard in front of it refuses with a 4xx, and
   the refusals it has actually recorded are listed on the screen.

   ── 30 Aug 2026. The workflow changed and this screen had not. ──────────────

   Finance Calc was rewritten and every one of the five rules above still holds,
   but three of the names in them are gone. Read them with this:

     `finance_tier` (a string) is now `credit_band`, on ADCB's published AECB
     cut-offs rather than on US FICO ones.

     `indicative_apr_pct` (one number) is now `indicative_apr_range_pct` with
     `indicative_apr_low_pct` / `indicative_apr_high_pct` beside it, on the
     stated basis "reducing-balance APR, inclusive of fees". No point rate is
     quoted by anybody any more: every UAE lender publishes a range and states
     the bank sets the final rate on approval, and a percentage that does not
     say it is reducing-balance is heard as the advertised flat rate — roughly
     half the true cost over 60 months.

     `{status:'error', errors:[…]}` is now `{status:'input_error', instruction,
     problems, expected}`. Rule 1 above is unchanged in substance; only the keys
     it names have moved.

   Two behaviours changed with them. A trade-in is now optional — a cash buyer
   asking "what rate do I get?" gets an answer, and the trade-in fields come back
   NULL with `equity_status: 'No trade-in'` rather than zeroed. And a file below
   541 on the AECB scale returns `quotable: false` with no rate at all: there is
   no published UAE band that weak, so the honest answer is a referral and this
   screen shows no APR field for one whatsoever.

   One thing did NOT change and is the reason for half the code below:
   `finance_quotes` was never migrated. It still has a `finance_tier` column and
   a single `indicative_apr_pct`, and the workflow now writes the LOW end of the
   range into that column — the most favourable figure the bank might offer,
   standing alone, which is precisely what the rewrite existed to stop. The full
   range survives as a prefix on the `disclaimer` column, so every stored rate on
   this screen is read back out of there and shown as the span it was quoted at.
   Where a row has no such prefix its one figure is shown as a lower bound and
   labelled as one. Both legacy column names are still read, and every place
   they are read says why. */
import { HOOK, ME, SESSION, db, n8n } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { N8N_BASE } from '../lib/env.js';
import { aed, ago, dubaiStamp, esc, n0, num, pct, pill, tone } from '../lib/format.js';
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

/* How old a quote gets before this desk prompts a re-quote. `finance_quotes`
   carries no validity column and the database holds no policy that says one, so
   this is the desk's own prompt and is never called an expiry: a quote here
   cannot be marked expired, because nothing anywhere records when it expires.
   The alert says "more than 7 days old", which is a fact about the row, instead
   of "expired", which would be a status the data does not have. If a row ever
   turns up carrying its own validity date (see VALID_COLS) that date wins and
   the check says which of the two it used. */
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

/* Rows read for the refusal panel. A refusal is not an error, so the workflow's
   own REJECTED rows are shown as the outcomes they are rather than being left
   to be discovered in n8n. */
const REJECT_LIMIT = 100;

/* Which audit_log rows this screen claims as its own. workflow_registry is not
   read here — that is one more request for a panel that can say how it matched
   — so the match is on the workflow name and the panel states that, along with
   the fact that a refusal logged under a name mentioning none of these words
   would not be listed. */
const FINANCE_FLOW = /financ|quote|trade-?in|calc/i;

/* Below this many distinct customers, a mean over this table is a mean over one
   negotiation, so the strip prints the range instead and says why. It is a
   stated floor, not a computed one: there is no sample size at which three
   quotes to one man become a market figure, and this number only decides when
   the screen stops pretending otherwise. */
const STAT_MIN_CUSTOMERS = 5;

/* A lead in one of these states should not be sitting behind a live quote. WON,
   CONVERTED and DELIVERED are deliberately absent: a quote for a customer who
   bought is not a problem. */
const GONE = new Set(['COLD', 'LOST', 'DEAD', 'JUNK', 'SPAM', 'UNQUALIFIED', 'ARCHIVED']);

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

/* There was a mean() here, used for the average indicative APR and the average
   loan to value on the strip. Both figures are gone and so is it: with every
   quote in the table belonging to one customer, reporting how many rows carried
   the column does not rescue the average — the sample is one negotiation
   however many rows it has. The range is shown instead. */
const lower = v => String(v == null ? '' : v).toLowerCase();
const str = v => String(v == null ? '' : v).trim();
const up = v => str(v).toUpperCase();
const ts = v => { const t = new Date(v).getTime(); return Number.isNaN(t) ? 0 : t; };
const plural = (n, one, many) => (Number(n) === 1 ? one : many);
/* `equity_status` has three values, not two. The workflow gained NO_TRADE_IN as
   'No trade-in' on 30 Aug 2026, when it stopped demanding a trade-in before it
   would price anything, and the two-value version of these helpers returned ''
   for it — no tone, no colour, and a row that matched neither equity filter tab
   while still being counted in every total above the table. A cash buyer is not
   a quote with a missing equity figure; there is simply no equity to have. */
const NO_TRADE_IN = 'No trade-in';
const isNoTradeIn = s => lower(s) === 'no trade-in';
const eqTone = s => (lower(s) === 'negative' ? 'hot' : lower(s) === 'positive' ? 'ok' : isNoTradeIn(s) ? 'cold' : '');
const eqClass = s => (lower(s) === 'negative' ? 't-hot' : lower(s) === 'positive' ? 't-ok' : isNoTradeIn(s) ? 't-muted' : '');
/* Was a bare toLocaleString(), which re-read a Dubai timestamp in whichever
   zone the browser sat in — a quote raised at 16:20 GST printed as 12:20 to a
   manager in London, with nothing on screen to say which clock it was. Pinned
   and labelled by dubaiStamp(); the '—' placeholder is its default. */
const stamp = ts2 => dubaiStamp(ts2);
const muted = t => `<span class="t-muted">${esc(t)}</span>`;
const warn  = t => `<span class="t-warm">${esc(t)}</span>`;
/* Two dirham figures side by side overflow a KPI tile, and "AED" twice in one
   value reads as two prices rather than as the ends of one span. */
const aedRange = (lo, hi) => (lo === hi ? aed(lo) : `${aed(lo)} – ${num(hi)}`);

/* ── The rate is a range ────────────────────────────────────────────────────
   Rewritten 30 Aug 2026, the day the workflow stopped returning a single point
   APR. It now returns `indicative_apr_low_pct` and `indicative_apr_high_pct`
   with `indicative_apr_range_pct` as the pre-formatted string, on the stated
   basis "reducing-balance APR, inclusive of fees" — because a UAE lender
   advertises a FLAT rate, an unlabelled percentage is read as flat, and a flat
   rate understates the true cost by roughly half over 60 months. No lender
   publishes a point rate either: the bank sets the final one on approval, so a
   dealer asserting one exact figure is asserting something it does not control.

   Nothing on this screen may print one end of that range on its own. Where only
   one end is available it is named as the end it is. */
const RATE_BASIS = 'reducing-balance APR, inclusive of fees';
const aprRange = (lo, hi) => {
  const a = n0(lo), b = n0(hi);
  if (a == null && b == null) return '—';
  if (a == null || b == null) return pct(a == null ? b : a);
  return a === b ? pct(a) : `${pct(a)} – ${pct(b)}`;
};

/* `finance_quotes` was never migrated. `indicative_apr_pct` still holds ONE
   number and the workflow now writes the LOW end of the range into it, so the
   column on its own is the most favourable figure the bank might offer and
   nothing else — exactly the single flattering number the 30 Aug change set out
   to stop being quoted. The full range survives in the `disclaimer` column,
   which the workflow prefixes with "APR 8.2 - 9.65% reducing balance incl.
   fees." before the standing disclaimer text. Recovering the high end from that
   prefix is what lets a stored row be shown as the range it was quoted at
   rather than as its own best case. A row with no such prefix (written before
   30 Aug, or by something else) yields nothing and is labelled a lower bound. */
const DISCLAIMER_APR_RE = /^\s*APR\s+([\d.]+)\s*-\s*([\d.]+)\s*%\s*reducing/i;
/* Both ends of the rate, from whichever of the three places carries them. A
   live workflow response has the pair as its own fields; a stored row has only
   the low end in its column and the pair inside its disclaimer prefix; a row
   written before 30 Aug has neither and yields a low end with no high. */
function aprOf(q) {
  const m = DISCLAIMER_APR_RE.exec(str(q?.disclaimer));
  const low = n0(q?.indicative_apr_low_pct) ?? (m ? n0(m[1]) : null) ?? n0(q?.indicative_apr_pct);
  const high = n0(q?.indicative_apr_high_pct) ?? (m ? n0(m[2]) : null);
  return { low, high, ranged: low != null && high != null && low !== high };
}

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

/* ── Refusals ───────────────────────────────────────────────────────────────
   The workflow refuses bad input, and it is supposed to: audit_log carries
   REJECTED rows reading "vehicleValue must be a realistic vehicle valuation of
   at least AED 5000" and "lead_email is required". Those are the workflow
   protecting a customer from a quote that should never have been priced, and
   the rep needs to read the reason, not a stack of JSON.

   Every shape a refusal can arrive in, collected in one place. The workflow
   answers HTTP 200 for its own rejections, but the JWT guard in front of it and
   n8n itself both answer 4xx with a body in the same family, and all of those
   are the same event to the person at the desk.

   The 30 Aug 2026 rewrite renamed the refusal: it is now
   `{status:'input_error', instruction, problems:[…], expected:{…}}` and carries
   no `errors` array at all. Until that shape was read here, a refusal came back
   with nothing to list, failed the `rejected` test, and fell through to "the
   workflow replied, but with no quote in it" — the one sentence on this screen
   that tells a rep to go and find somebody technical about a workflow that had
   just correctly said no. `instruction` leads because it is the sentence that
   says what to do next; `problems` are what to do it to.

   `instruction` is on the SUCCESS payloads too — there it is advice on how to
   read the quote out, not a refusal — so it is only collected when the status
   is something other than success. */
function reasonsFrom(res) {
  const out = [];
  const push = v => { const t = str(v); if (t) out.push(t); };
  if (lower(res?.status) !== 'success') push(res?.instruction);
  if (Array.isArray(res?.problems)) res.problems.forEach(push);
  if (Array.isArray(res?.errors)) res.errors.forEach(push); else push(res?.errors);
  push(res?.error);
  push(res?.message);
  push(res?.reason);
  return [...new Set(out)];
}

/* Wording a refusal uses and a transport failure does not. Used only to decide
   whether an Error carries a refusal; anything this does not recognise stays an
   error, which is what an unrecognised failure actually is. */
const VALIDATION_RE = /\b(is required|must be|realistic|at least|not a valid|invalid|missing)\b/i;

/* n8n() throws `"<status> — <body>"` on a non-2xx, so a refusal answered with a
   400 reaches the catch block carrying the same body a 200 refusal would have
   carried in the response. Recovering it is what stops one deployment choice
   inside n8n deciding whether the rep sees "the workflow declined this value" or
   a red dashboard error about a bug that does not exist. */
function declineFromError(msg) {
  const m = String(msg || '');
  const status = Number((m.match(/^(\d{3})\b/) || [])[1]);
  /* A 5xx is the workflow falling over, not declining, and must not be dressed
     up as a considered refusal. */
  if (status && (status < 400 || status >= 500)) return [];
  const brace = m.indexOf('{');
  if (brace >= 0) {
    try {
      const found = reasonsFrom(JSON.parse(m.slice(brace)));
      if (found.length) return found;
    } catch { /* n8n() truncates the body at 200 chars, so fall through to text */ }
  }
  const tail = m.replace(/^\d{3}\s+—\s+/, '').trim();
  return VALIDATION_RE.test(tail) ? [tail] : [];
}

SCREENS.finance = async host => {
  /* ── Layout ────────────────────────────────────────────────────────────── */
  const alertCard = el('div', 'card flush');
  alertCard.innerHTML = `<div class="card-head"><div>
      <div class="card-title">Needs attention</div>
      <div class="card-sub">v_needs_attention for this screen, plus six checks this screen runs on the quotes and leads it just read</div>
    </div><div style="flex:1"></div>
    <button class="btn sm" id="fqRecheck"><span class="material-symbols-outlined">refresh</span> Re-check</button></div>
    <div class="pbody">${stateLoading(2)}</div>`;
  host.appendChild(alertCard);

  const strip = el('div', 'grid g4');
  strip.style.marginTop = '16px';
  strip.innerHTML = stateLoading(2);
  host.appendChild(strip);

  /* The panel that keeps the strip above it honest. With three quotes belonging
     to one man, the interesting half of this screen is the list of questions it
     refuses to answer — and an unanswerable question stated with its reason and
     with what would fill it is worth more to the dealership than a percentage
     computed over one negotiation. */
  const scopeCard = el('div', 'card flush');
  scopeCard.style.marginTop = '16px';
  scopeCard.innerHTML = `<div class="card-head"><div>
      <div class="card-title">What this screen can answer</div>
      <div class="card-sub">And what it cannot, with the column that is missing and what would fill it</div>
    </div></div><div class="pbody" id="fScope">${stateLoading(3)}</div>`;
  host.appendChild(scopeCard);

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
      Runs the live Finance Calc workflow, which returns the equity, the credit band and a
      range of indicative APRs, and records the quote in <span class="mono">finance_quotes</span>.
      A trade-in is optional — a customer with nothing to trade still gets a rate off their credit score.</div>
    <div class="grid" style="gap:14px">
      ${field('fLead', 'Lead',
        `<select id="fLead" disabled><option value="">Loading leads…</option></select>`,
        'Picking a lead fills in the customer. You can still type the details by hand.')}
      <div id="fLeadCtx"></div>
      <div class="grid g2" style="gap:14px">
        ${field('fVal', 'Trade-in vehicle value (AED) <span class="t-muted">— optional</span>',
          `<input type="number" id="fVal" min="${MIN_VEHICLE_VALUE}" step="1000" inputmode="numeric" placeholder="185000" />`,
          `Leave blank if there is no trade-in — the customer still gets a rate. If there is one it must be at least
           ${aed(MIN_VEHICLE_VALUE)}; the workflow rejects anything lower as not a real vehicle.`)}
        ${field('fPay', 'Outstanding loan payoff (AED) <span class="t-muted">— optional</span>',
          `<input type="number" id="fPay" min="0" step="1000" inputmode="numeric" placeholder="60000" />`,
          'Enter 0 if the customer owns the trade-in outright. Leave blank when there is no trade-in — the workflow takes a payoff with no vehicle value as an error, not as a cash buyer.')}
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

  /* ── What the workflow has refused ─────────────────────────────────────────
     Sits under the form because the form is what produces these. A rep who has
     just been declined can see that the refusal is a normal, recorded outcome
     of a working validator rather than something that went wrong on this page,
     and can read what the workflow said to somebody else in the same position. */
  const refuseCard = el('div', 'card flush');
  refuseCard.style.marginTop = '16px';
  refuseCard.innerHTML = `<div class="card-head"><div>
      <div class="card-title">Inputs the workflow refused</div>
      <div class="card-sub">REJECTED rows the Finance Calc workflow wrote to <span class="mono">audit_log</span>.
        A refusal is the workflow declining a figure before it can be quoted to anybody — not a failure of this dashboard</div>
    </div></div><div class="pbody" id="fxBody">${stateLoading(3)}</div>`;
  leftCol.appendChild(refuseCard);

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
     never gets written.

     The trade-in became optional on 30 Aug 2026, and this function is the reason
     that change had no effect from this desk until now: it demanded a vehicle
     value and a payoff before it would let the form be submitted at all, so a
     cash buyer asking "what rate do I get?" — the exact customer the workflow
     change exists for — could not be sent. The only argument the workflow always
     needs is the credit score. */
  function validate(v) {
    const e = {};
    const val = n0(v.vehicleValue);
    const pay = n0(v.loanPayoffAmount);
    const hasTradeIn = val != null && val >= MIN_VEHICLE_VALUE;
    if (v.vehicleValue) {
      if (val == null) e.fVal = 'Enter a number, or leave it blank if there is no trade-in.';
      else if (val < MIN_VEHICLE_VALUE) e.fVal = `Must be at least ${aed(MIN_VEHICLE_VALUE)} — the workflow rejects anything lower as not a real vehicle. Clear the field if there is no trade-in.`;
    }

    if (v.loanPayoffAmount !== '') {
      if (pay == null) e.fPay = 'Enter a number, or leave it blank if there is no trade-in.';
      else if (pay < 0) e.fPay = 'A payoff cannot be negative. Enter 0 when the trade-in is owned outright.';
      /* The workflow refuses this pair outright rather than guessing which of
         the two the rep meant, so the form refuses it here instead of spending
         a round trip finding out. */
      else if (pay > 0 && !hasTradeIn) e.fPay = 'A payoff needs the vehicle it is secured against. Enter the trade-in value above, or clear this field.';
    }

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
    /* Named warnBox, not warn: `warn` is the module-level amber-text helper this
       file uses everywhere else, and a DOM node shadowing it inside one function
       is a trap for the next person to edit this block. */
    const warnBox = $('err-fPay');
    const showWarn = !e.fPay && val != null && pay != null && pay > val;
    warnBox.classList.toggle('t-hot', !showWarn);
    if (showWarn) warnBox.textContent = 'Payoff is above the vehicle value, so expect a negative-equity result.';
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
  let people = new Map();               // lead_email -> the quotes filed under it
  let refusals = null, refusalsErr = null, refusalOther = 0;

  const keyOf = r => (r && r.id != null ? String(r.id) : 'row-' + rows.indexOf(r));
  const leadByEmail = new Map();
  const leadFor = q => (leads ? leadByEmail.get(lower(str(q.lead_email))) || null : null);

  /* ── Who these quotes belong to ───────────────────────────────────────────
     Every rate this screen used to print divided by rows.length. The
     denominator that matters is people, and today the two differ by a factor of
     three: one email, three quotes. Rows with no email are attributable to
     nobody and are counted apart rather than being folded into a phantom
     customer, which would make the people count look healthier than it is.

     The names are kept per email, with how many quotes carry each, because the
     variance is the finding — not a tie to break. */
  function indexPeople() {
    const by = new Map();
    for (const q of rows) {
      const k = lower(str(q.lead_email));
      if (!k) continue;
      let p = by.get(k);
      if (!p) { p = { key: k, email: str(q.lead_email), quotes: [], names: new Map() }; by.set(k, p); }
      p.quotes.push(q);
      const n = str(q.lead_name);
      if (n) p.names.set(n, (p.names.get(n) || 0) + 1);
    }
    by.forEach(p => p.quotes.sort((a, b) => ts(b.created_at) - ts(a.created_at)));
    return by;
  }
  const personFor = q => people.get(lower(str(q.lead_email))) || null;
  /* "ALI ASGHER UJJAIN WALA" (2 quotes) and "Shabbir Ujjainwala" (1 quote) —
     spelled out in full because the whole point is that both spellings exist. */
  const namesList = p => [...p.names.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([n, c]) => `"${n}" (${c} ${plural(c, 'quote', 'quotes')})`)
    .join(' and ');

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
  /* Marks a row whose customer is filed under more than one name. Without it
     the table looks perfectly consistent — each row shows the name it carries,
     and nothing on screen reveals that the row above it carries a different one
     for the same person. */
  function nameVariantChip(q) {
    const p = personFor(q);
    if (!p || p.names.size < 2) return '';
    return ` <span class="chip t-warm" title="${esc(`${p.email} is recorded under ${p.names.size} different names across its ${p.quotes.length} quotes: ${namesList(p)}. finance_quotes stores the name typed at quote time; the email is the identity, and this is one person, not ${p.names.size}.`)}">1 of ${p.names.size} names</span>`;
  }

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
     the sentence that `assumptions()` builds from it.

     Since 30 Aug 2026 the rate is a range, so the instalment is one too. It is
     amortised at BOTH ends and shown as a span. Amortising only at the low end
     and calling the answer "the monthly" would put the cheapest payment the
     bank might ever offer into a rep's mouth as though it were the payment —
     the same single flattering number, one step further downstream and harder
     to spot, because a dirham figure does not look like a rate. Where only one
     end is known, `b.ranged` is false and every caller says which end it is. */
  function basis(q) {
    const value = n0(q.vehicle_value_aed);
    const rate = aprOf(q);
    const apr = rate.low;
    const aprHigh = rate.high;
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
    const monthlyHigh = aprHigh == null ? null : instalment(principal, aprHigh, term);
    const ranged = monthly != null && monthlyHigh != null && monthlyHigh !== monthly;
    /* A stored payment is compared against the whole band, not against one end
       of it: an instalment priced anywhere inside the range the bank quoted is
       not a disagreement, and calling it one would raise a CRITICAL alert on
       every row the moment the rate became a range. */
    const tol = stored == null ? 0 : Math.max(DRIFT_AED, Math.abs(stored) * DRIFT_PCT / 100);
    const lo = monthly, hi = monthlyHigh == null ? monthly : monthlyHigh;
    const gap = (stored != null && lo != null)
      ? (stored < lo ? lo - stored : stored > hi ? stored - hi : 0)
      : null;
    const drifted = gap != null && gap > tol;
    return { value, apr, aprHigh, ranged, ltv, term, termFrom, principal, down, downPct, downFrom,
             stored, monthly, monthlyHigh, gap, drifted };
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
      return 'This quote records no vehicle value, so there is no amount to amortise and no monthly figure is shown. '
        + 'A customer with no trade-in gets a rate, not an instalment: nothing here says what car they are buying.';
    }
    const rate = b.ranged
      ? `the ${aprRange(b.apr, b.aprHigh)} ${RATE_BASIS} on this quote`
      : `${pct(b.apr)} ${RATE_BASIS}, which is the LOW end of the range this quote was given — `
        + 'the high end is not recorded on this row, so the figure is the best case and not the payment';
    return `Monthly is this desk's arithmetic, not the workflow's: ${rate}, `
      + `a ${num(b.term)}-month term from ${b.termFrom}, and ${aed(b.down)} down`
      + `${b.downPct == null ? '' : ` (${pct(b.downPct)} of the vehicle value)`} from ${b.downFrom}. `
      + `It amortises ${aed(b.principal)}.`;
  }
  /* The span, or the one end that is known named as an end. `num` on the far
     side rather than `aed`, for the same reason aedRange gives: "AED" twice in
     one cell reads as two separate prices. */
  const monthlyRange = b => (b.ranged ? `${aed(b.monthly)} – ${num(b.monthlyHigh)}` : aed(b.monthly));
  const monthlyCell = q => {
    const b = basisOf(q);
    const t = esc(assumptions(b));
    if (b.monthly == null) return `<span class="t-muted" title="${t}">—</span>`;
    return `<span title="${t}">${monthlyRange(b)}</span>`
      + (b.ranged ? '' : ' <span class="t-warm" title="Best case only. The high end of this quote’s rate is not recorded on the row, so this is the cheapest instalment the bank might offer and not the instalment.">↓</span>')
      + (b.drifted ? ' <span class="t-hot" title="The monthly payment stored on this row falls outside the instalment range worked out from the row’s own figures.">≠</span>' : '');
  };

  /* ── Quote history ─────────────────────────────────────────────────────── */
  histCard.innerHTML = `
    <div class="card-head"><div>
      <div class="card-title">Quote history</div>
      <div class="card-sub">Every calculation is recorded, newest first, with the customer, their number and the rep it belongs to</div>
    </div><div style="flex:1"></div>
    <button class="btn sm" id="fqRefresh"><span class="material-symbols-outlined">refresh</span> Refresh</button></div>
    <div class="toolbar">
      <input class="grow" type="search" id="fqSearch" placeholder="Search customer, phone, credit band or rep"
             aria-label="Search quote history" />
      <div class="seg" role="group" aria-label="Filter by equity">
        <button data-f="all" class="on">All</button>
        <button data-f="Positive">Positive equity</button>
        <button data-f="Negative">Negative equity</button>
        <!-- The third value equity_status actually has. Without this tab a
             no-trade-in quote matched neither of the two above and vanished
             from every filtered view while still being counted above them. -->
        <button data-f="${esc(NO_TRADE_IN)}">No trade-in</button>
      </div>
    </div>
    <div id="fqBody">${stateLoading(4)}</div>`;

  const matches = r => {
    const focus = focusKey ? checkByKey.get(focusKey) : null;
    if (focus && !focus.keys.has(keyOf(r))) return false;
    if (filter !== 'all' && r.equity_status !== filter) return false;
    if (!query) return true;
    const lead = leadFor(r);
    /* `finance_tier` is the legacy column name; the workflow writes the credit
       band into it and the column was never renamed. It is searched, not shown
       under that name. */
    return [r.lead_name, r.lead_email, r.finance_tier, r.quoted_by, r.equity_status, lead?.phone, lead?.name]
      .some(v => lower(v).includes(query));
  };

  /* The money footnote. Said under the table rather than per cell because it is
     the same sentence for every row, and said at all because a column of
     dirham figures with no stated basis is the thing this round is about. */
  function moneyNote() {
    const bits = [
      'Value and Payoff are the figures the rep entered. Equity, LTV, credit band and APR are what the Finance Calc workflow returned '
        + 'and are not recomputed here.',
      `APR is a range and is quoted as one, on the stated basis of ${RATE_BASIS}. A UAE lender advertises a FLAT rate and the reducing-balance figure is roughly `
        + 'twice it over 60 months, so an unlabelled percentage read out to a customer understates what they will pay by about half.',
      `finance_quotes stores a single APR number and the workflow writes the LOW end of the range into it. The full range survives in the row's disclaimer, which is `
        + 'where the range above is read from. A row whose disclaimer carries no range shows its one figure with a + and in amber: that is a lower bound, not a rate.',
      `Monthly is the only modelled figure on this table: it amortises the amount financed at BOTH ends of the quote's own APR range over `
        + `${cols2.term ? 'the term on the row' : `a ${TERM_MONTHS}-month term (this desk's default — these rows carry no term column)`}, `
        + `with the down payment taken from ${cols2.down || cols2.financed ? 'the figures on the row' : 'the quote’s own loan to value, or from this desk’s ' + DOWN_PAYMENT_PCT + '% default where the row has no LTV'}. `
        + 'A ↓ marks a row where only the low end of the rate is recoverable, so the instalment beside it is the best case and not the payment. '
        + 'Hover a Monthly cell for that row’s exact rate, term and down payment.',
      'A quote with no APR shows no monthly figure at all rather than one at a rate this screen made up, and a quote with no trade-in shows none either — nothing on the row says what car is being bought.',
      `finance_quotes stores no term, no monthly payment and no validity date. That is why Monthly is modelled here rather than read, and why no row on this table `
        + `is ever marked expired: nothing records when a quote stops standing. When is what the table shows, and "more than ${num(QUOTE_VALID_DAYS)} days old" above it is this desk's prompt to re-quote.`,
      cols2.monthly
        ? `A ≠ marks a row whose stored ${cols2.monthly} falls outside that instalment range by more than ${aed(DRIFT_AED)} or ${DRIFT_PCT}%. A figure inside the range is not a disagreement.`
        : 'These rows carry no stored monthly payment — the table has no such column — so there is nothing for the modelled figure to disagree with.',
      'Where one customer appears more than once, these are repeat quotes to the same person and not separate pieces of business. The Customer column marks a row whose customer is filed under more than one name.',
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
        `${personName(r.lead_name, personName(leadFor(r)?.name, '<span class="t-muted">Unnamed</span>'))}${nameVariantChip(r)}
         <div class="cell-sub">${phoneCell(r)} · ${r.lead_email
           ? esc(str(r.lead_email))
           : '<span class="t-hot" title="This quote has no lead_email, so it can never be matched back to a person.">no email recorded</span>'}</div>` },
      { label: 'Score', align: 'r', render: r => num(r.credit_score) },
      { label: 'Value', align: 'r', render: r => `<span title="As entered by the rep at quote time — no rate, term or down payment applied.">${aed(r.vehicle_value_aed)}</span>` },
      { label: 'Payoff', align: 'r', render: r => `<span title="As entered by the rep at quote time — the loan outstanding on the trade-in.">${aed(r.loan_payoff_aed)}</span>` },
      { label: 'Equity', align: 'r', render: r => (isNoTradeIn(r.equity_status)
        ? '<span class="t-muted" title="This customer had no trade-in, so there is no equity to have. The blank is the answer, not a missing figure.">no trade-in</span>'
        : `<span class="${eqClass(r.equity_status)}" title="Vehicle value less the outstanding payoff, as the workflow returned it.">${aed(r.equity_aed)}</span>`) },
      { label: 'LTV', align: 'r', render: r => pct(r.loan_to_value_pct) },
      /* `finance_tier` is the legacy column name — the workflow has written the
         AECB credit band into it since 30 Aug 2026 and the column was never
         renamed, so it is read under the old name and shown under the new one. */
      { label: 'Credit band', render: r => (r.finance_tier ? `<span class="chip">${esc(r.finance_tier)}</span>` : '<span class="t-muted">—</span>') },
      { label: 'APR reducing', align: 'r', render: r => {
        const rate = aprOf(r);
        if (rate.low == null) return '<span class="t-muted">—</span>';
        /* Ranged, or named as the end it is. `indicative_apr_pct` holds the LOW
           end of the range and nothing else, so a bare number off that column is
           the cheapest rate the bank might offer being read out as the rate. */
        return rate.ranged
          ? `<span title="${esc(`Reducing-balance APR including fees, as quoted. The bank sets the final rate on approval; ${RATE_BASIS} is the basis this range is on.`)}">${aprRange(rate.low, rate.high)}</span>`
          : `<span class="t-warm" title="${esc('Lower bound only. finance_quotes stores one APR figure and the workflow writes the LOW end of the quoted range into it; this row carries no disclaimer recording the high end, so the range it was quoted at cannot be recovered. Do not read this figure out as the rate.')}">${pct(rate.low)}+</span>`;
      } },
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

  /* ── The strip ────────────────────────────────────────────────────────────
     Four tiles, and not one of them is a rate. Two used to be: the mean
     indicative APR and the mean loan to value, both computed across every row
     in the table. With every row belonging to the same customer those were
     descriptions of one man's negotiation presented as descriptions of the
     desk, so they are gone and the panel underneath names them as withdrawn
     rather than letting them disappear quietly. What is left — how many quotes,
     how many people, what range of values, how many came out negative — is true
     whether the table holds three rows or three thousand. */
  function drawStrip() {
    if (quotesErr) { strip.innerHTML = stateError('the quote figures', quotesErr.message); return; }
    const capped = rows.length >= HISTORY_LIMIT;
    const ppl = [...people.values()];
    const oneCustomer = ppl.length === 1 && rows.length > 1;
    const enough = ppl.length >= STAT_MIN_CUSTOMERS;
    const unattributed = rows.filter(r => !str(r.lead_email)).length;
    const negative = rows.filter(r => r.equity_status === 'Negative').length;
    /* Only a trade-in can come out negative, so only a trade-in belongs in the
       denominator. A no-trade-in quote carries an equity_status like any other
       row and would otherwise sit in the bottom of that fraction as a quote that
       "did not come out negative", quietly making the share look better the more
       cash buyers the desk quotes. */
    const priced = rows.filter(r => r.equity_status && !isNoTradeIn(r.equity_status)).length;
    const noTradeIn = rows.filter(r => isNoTradeIn(r.equity_status)).length;
    const values = rows.map(r => n0(r.vehicle_value_aed)).filter(v => v != null).sort((a, b) => a - b);

    strip.innerHTML = [
      kpi('Quotes recorded', num(rows.length),
        rows.length
          ? (capped
              ? muted(`Newest ${num(HISTORY_LIMIT)} shown · latest ${ago(rows[0].created_at)}`)
              : muted(`Latest ${ago(rows[0].created_at)}`))
            + (unattributed
              ? `<br>${warn(`${num(unattributed)} of them ${plural(unattributed, 'carries', 'carry')} no customer email and ${plural(unattributed, 'belongs', 'belong')} to nobody`)}`
              : '')
          : muted('Nothing quoted from this desk yet')),

      /* The tile the rest of the screen hangs off. It is not decoration: it is
         the denominator, and every figure that is missing from this strip is
         missing because of what it says. */
      kpi('Customers quoted', num(ppl.length),
        ppl.length
          ? (oneCustomer
              ? `${warn(`All ${num(rows.length)} quotes belong to one email address`)}<br>${muted(ppl[0].email)}`
                + `<br>${muted('One customer re-priced is a negotiation, not a book of business. Nothing on this screen is divided by it.')}`
              : muted(`Across ${num(ppl.length)} email addresses`))
          : muted(rows.length
              ? 'No quote carries a customer email, so none of them can be attributed to a person'
              : 'Nothing quoted from this desk yet'),
        oneCustomer ? 't-warm' : ''),

      /* A range, never a mean. The lowest and highest figures actually typed are
         two facts; the number between them would be an invention with a
         customer's name on it. */
      kpi('Vehicle value quoted',
        values.length ? aedRange(values[0], values[values.length - 1]) : '—',
        values.length
          ? muted(values.length === 1
              ? 'The only quote that carries a vehicle value'
              : `Lowest and highest of the ${num(values.length)} ${plural(values.length, 'quote', 'quotes')} that carry a value`)
            + (oneCustomer && values.length > 1
              ? `<br>${warn(`One customer's trade-in, valued ${num(values.length)} different ways. No average is shown — the mean of one negotiation is that customer's middle offer.`)}`
              : '')
          : muted('No quote records a vehicle value')),

      kpi('Negative equity', num(negative),
        (priced
          ? (enough
              ? `<span class="${negative ? 't-hot' : 't-ok'}">${pct(negative / priced * 100)} of ${num(priced)} trade-ins</span>`
              /* A share of three quotes to one person is that person, expressed
                 as a percentage. The count is real and stays; the rate does not
                 exist and is not printed. */
              : muted(`${num(negative)} of the ${num(priced)} ${plural(priced, 'trade-in', 'trade-ins')} the workflow priced`)
                + `<br>${warn(`No rate is shown: ${num(ppl.length)} ${plural(ppl.length, 'customer', 'customers')} ${plural(ppl.length, 'is', 'are')} below the ${num(STAT_MIN_CUSTOMERS)} this screen needs before a percentage says anything about the desk.`)}`)
          : muted(noTradeIn
              ? 'No quote here involves a trade-in, so none of them can come out negative'
              : 'No quote carries an equity status'))
          /* Named rather than folded into the denominator above: a cash buyer is
             a quote this desk made, and a count that silently excluded them
             would not add up against the Quotes recorded tile. */
          + (noTradeIn
            ? `<br>${muted(`${num(noTradeIn)} further ${plural(noTradeIn, 'quote has', 'quotes have')} no trade-in and ${plural(noTradeIn, 'is', 'are')} outside this count entirely`)}`
            : ''),
        negative ? 't-hot' : ''),
    ].join('');
  }

  /* ── What this screen can and cannot answer ───────────────────────────────
     Written as questions because that is how they arrive: somebody asks the
     dealership's owner what the average quote is worth, and he asks the
     dashboard. Every "no" here carries the column that is missing and what
     would fill it, so it reads as a specification rather than an apology. */
  function drawScope() {
    const body = $('fScope');
    if (!body) return;
    if (quotesErr) { body.innerHTML = stateError('the quote figures', quotesErr.message); return; }

    const ppl = [...people.values()];
    const nQ = rows.length, nP = ppl.length;
    const enough = nP >= STAT_MIN_CUSTOMERS;
    const basisLine = `${num(nQ)} ${plural(nQ, 'quote', 'quotes')} belonging to ${num(nP)} ${plural(nP, 'customer', 'customers')}`;

    const can = [
      ['What was quoted, to whom, and by whom',
        `Every row of finance_quotes, newest first, with the customer's name, their number from the lead record and the rep in quoted_by. ${basisLine} read here.`],
      ['What the workflow returned on each one',
        'Equity, equity status, loan to value, the credit band and the indicative APR range are read off the row exactly as Finance Calc returned them, and are never recomputed on this screen. '
        + 'The APR is shown as the range it was quoted at, recovered from the row\u2019s disclaimer, because the column beside it stores only the low end.'],
      ['What a monthly instalment would be, on stated assumptions',
        `Modelled here, not stored: both ends of the quote's own APR range over ${cols2.term ? 'the term on the row' : `a ${num(TERM_MONTHS)}-month term`}, with the deposit taken from the quote's own loan to value. Every figure carries its rate, term and deposit, and the instalment is a span for the same reason the rate is.`],
      ['Which quotes have a problem worth a phone call',
        'The checks in the strip above — a quote with no email, a quote whose customer has gone cold, a customer filed under more than one name, a quote old enough to re-run.'],
      ['What the workflow has refused, and why',
        'The REJECTED rows finance-calc wrote to audit_log, with the reason it gave, listed on this screen rather than left in n8n.'],
    ];

    /* The same reason, phrased for the three cases it actually has: nothing on
       the desk, one customer quoted repeatedly, or a few customers. */
    const smallN = !nQ
      ? 'There is no quote on this desk to average.'
      : `The ${basisLine} on this desk, so a mean here is a mean over ${nP === 1 ? 'one negotiation' : 'a handful of negotiations'}.`;

    const cannot = [
      ['What is the average quote worth?',
        enough
          ? null
          : `Withdrawn. ${smallN} The range in the strip above is shown instead. This becomes a real figure at ${num(STAT_MIN_CUSTOMERS)} customers, not at ${num(STAT_MIN_CUSTOMERS)} quotes.`],
      ['What is our average APR, and our average loan to value?',
        enough
          ? null
          : `Withdrawn from the strip on 24 Aug for the same reason. ${nQ ? 'Both are still on every row of the table below, where they are what the workflow returned for that one customer — which is all they have ever been.' : 'Both reappear as soon as there are quotes from enough different customers for a mean to describe the desk rather than a person.'}`],
      ['What share of quotes turns into a sale?',
        'Not answerable at any n. finance_quotes records no outcome — there is no accepted, declined, sold or lapsed column — and purchase_history carries no link back to a quote or to an inventory unit. Nothing in the database joins a quote to what happened next. It would take an outcome column on finance_quotes, written when the deal closes.'],
      ['What is in the finance pipeline?',
        'There is no pipeline here to show. A quote carries no stage, no expected close date and no outcome, so a row in this table is a number that was said out loud once — not a deal in progress. Treating the sum of these values as a pipeline would count the same trade-in three times.'],
      ['Which quotes have expired?',
        'Not answerable. finance_quotes stores no validity date, no term and no monthly payment. Nothing on the row records when a quote stops standing, so no quote on this screen is ever marked expired; the alerts say "more than ' + num(QUOTE_VALID_DAYS) + ' days old", which is a fact about the row and this desk\u2019s own prompt to re-quote.'],
      ['How has quoting changed over time?',
        !nQ
          ? 'There is nothing recorded to plot. finance_quotes keeps created_at, so a series appears here once the desk has quoted enough different customers for the line to mean something.'
          : nQ > 1
            ? `There are ${num(nQ)} rows from ${num(nP)} ${plural(nP, 'customer', 'customers')}. A trend drawn through ${nP === 1 ? 'one conversation' : 'them'} is a picture of that conversation, not of the desk, so none is drawn.`
            : 'One row is not a series. Nothing here is plotted over time.'],
    ].filter(([, a]) => a);

    const row = (icon, cls, q, a) => `<div class="list-item" style="cursor:default;align-items:flex-start">
      <span class="material-symbols-outlined t-${cls}" style="font-size:20px" aria-hidden="true">${icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500">${esc(q)}</div>
        <div class="cell-sub" style="white-space:normal">${esc(a)}</div>
      </div></div>`;

    body.innerHTML = `<div class="grid g2 top" style="gap:0">
      <div>
        <div class="label-caps" style="padding:14px 16px 6px">Answered from the data</div>
        ${can.map(([q, a]) => row('check_circle', 'ok', q, a)).join('')}
      </div>
      <div>
        <div class="label-caps" style="padding:14px 16px 6px">Not answerable here</div>
        ${cannot.length
          ? cannot.map(([q, a]) => row('do_not_disturb_on', 'muted', q, a)).join('')
          : `<div class="list-item" style="cursor:default">${muted(`Every question this screen sets aside at small n is back: ${num(nP)} customers is at or above the ${num(STAT_MIN_CUSTOMERS)} it needs.`)}</div>`}
      </div>
    </div>`;
  }

  /* ── The six checks this screen makes ────────────────────────────────────
     All six run on rows already fetched for the table and the lead picker — no
     read exists on this screen to feed an alert. Each states the denominator it
     counted against, and each one whose input is missing or truncated is
     withheld and named rather than reported as zero.

     The sixth arrived with round 4 and is the one this dataset made visible:
     the same email under two different names. It is a data-quality fault, not a
     desk fault, which is exactly why nothing else on the screen would have
     shown it — the table renders whatever name each row carries and looks
     perfectly consistent doing so. */
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
    const stale = rows.filter(q => { const v = validOf(q); return v && v.at < now; })
      .sort((a, b) => ts(a.created_at) - ts(b.created_at));

    const noEmail = rows.filter(q => !str(q.lead_email));
    const withEmail = rows.filter(q => str(q.lead_email));
    const orphan = canProveMissing ? withEmail.filter(q => !leadFor(q)) : [];
    const coldLead = leads
      ? withEmail.filter(q => { const l = leadFor(q); return l && GONE.has(up(l.status)); })
      : [];
    const drifted = cols2.monthly ? rows.filter(q => basisOf(q).drifted) : [];

    /* One email, more than one spelling of the person behind it. finance_quotes
       stores the name the rep typed at quote time and identifies the customer by
       lead_email and nothing else, so this is one person filed twice — and every
       downstream thing that keys on a name (a search, a KYC match, a Customer
       360 lookup) sees two people with a fraction of the history each. The
       check needs no extra read: the variance is sitting in the rows the table
       is already drawing, which is precisely why nobody notices it. */
    const splitNames = [...people.values()].filter(p => p.names.size > 1);
    const splitQuotes = splitNames.flatMap(p => p.quotes);

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
        key: 'stale',
        sev: 'WARNING',
        icon: 'event_busy',
        /* Deliberately not "expired". finance_quotes has no term, no monthly
           payment and no validity column, so nothing in the database knows when
           a quote stops standing and this screen must not imply that it does.
           Age is a fact about the row; expiry would be a status invented here
           and repeated to a customer as if the system had said it. */
        title: cols2.valid
          ? `${num(stale.length)} ${plural(stale.length, 'quote is', 'quotes are')} past the validity date on ${plural(stale.length, 'its', 'their')} row`
          : `${num(stale.length)} ${plural(stale.length, 'quote is', 'quotes are')} more than ${num(QUOTE_VALID_DAYS)} days old`,
        detail: (cols2.valid
            ? `${num(stale.length)} of the ${num(rows.length)} ${plural(rows.length, 'quote', 'quotes')} read here ${plural(stale.length, 'is', 'are')} past the validity date on the row (${cols2.valid}).`
            : `${num(stale.length)} of the ${num(rows.length)} ${plural(rows.length, 'quote', 'quotes')} read here ${plural(stale.length, 'was', 'were')} quoted more than ${num(QUOTE_VALID_DAYS)} days ago. `
              + `No quote here is marked expired and none can be: finance_quotes stores no validity date, no term and no monthly payment, so nothing on the row records when it stops standing. `
              + `${num(QUOTE_VALID_DAYS)} days is this desk's own prompt to re-quote — not a policy, not a status, and not something the database would agree with if asked.`)
          + ` The oldest was quoted ${ago(stale[0]?.created_at)}. `
          + 'The equity, the credit band and the APR range on it were priced against that day\u2019s rate sheet and that day\u2019s vehicle value; re-run it before it is repeated to the customer.',
        quotes: stale,
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
      {
        key: 'names',
        sev: 'WARNING',
        icon: 'badge',
        title: `${num(splitNames.length)} ${plural(splitNames.length, 'customer is', 'customers are')} recorded under more than one name`,
        detail: splitNames.map(p => `${p.email} is recorded as ${namesList(p)}`).join('. ')
          + '. finance_quotes stores the name typed at quote time and identifies the customer by email alone, so this is one person filed two ways, not two customers. '
          + 'Anything that groups these rows by name splits them; a rep searching the name on one quote finds none of the others; and a screen that silently picks one spelling hides it entirely. '
          + 'The email is the only identity these rows have. Correct the name on the lead record so the next quote inherits one spelling, and treat the older rows as the same person.',
        quotes: splitQuotes,
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
        ? `finance_quotes carries no validity date, no term and no monthly payment. No quote on this screen can be marked expired, and none is: the age check reads "more than ${num(QUOTE_VALID_DAYS)} days old", which is this desk's prompt to re-quote rather than a status the row carries.`
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
      cols2.valid
        ? 'no quote is past the validity date on its row'
        : `no quote is more than ${num(QUOTE_VALID_DAYS)} days old`,
      'every quote carries a customer email',
      'no customer is recorded under more than one name',
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
      ? 'v_needs_attention could not be read and the quote read failed, so neither the database’s list nor this screen’s own checks could be produced. Nothing is being claimed here.'
      : attnErr
        ? `v_needs_attention could not be read, so the database’s own list for this screen is missing. `
          + (rows.length
            ? `This screen’s own checks did run, and across the ${num(rows.length)} ${plural(rows.length, 'quote', 'quotes')} read here ${checkedText} — that is those checks only, not an all-clear.`
            : 'There is no quote on the desk for this screen’s own checks to judge either, so nothing here is an all-clear.')
        : `v_needs_attention returned no row for this screen. The quote read failed, so this screen’s own checks could not run and nothing here speaks for them.`;
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

  /* The refusals the workflow actually recorded. Read with an ilike on status
     rather than eq, because a vocabulary that is REJECTED in one workflow and
     rejected in another would otherwise come back empty and be rendered as
     "nothing has ever been refused" — a reassuring sentence produced by a
     case-sensitive filter. The workflow is matched by name here, and the panel
     says so along with how many REJECTED rows belong to other workflows. */
  async function loadRefusals() {
    try {
      const all = await db('audit_log?select=workflow,status,lead_name,lead_email,summary,logged_at'
        + `&status=ilike.rejected&order=logged_at.desc&limit=${REJECT_LIMIT}`);
      refusals = all.filter(a => FINANCE_FLOW.test(str(a.workflow)));
      refusalOther = all.length - refusals.length;
      refusalsErr = null;
    } catch (e) { refusals = null; refusalsErr = e; refusalOther = 0; }
  }

  function drawRefusals() {
    const body = $('fxBody');
    if (!body) return;
    if (refusalsErr) { body.innerHTML = stateError('the refusals the workflow recorded', refusalsErr.message); return; }
    if (!refusals) { body.innerHTML = stateLoading(3); return; }

    const capped = (refusals.length + refusalOther) >= REJECT_LIMIT;
    const foot = `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">info</span>
      <div class="cell-sub" style="white-space:normal">${[
        'A refusal is the workflow declining a figure before it is priced, and the row above is the record it kept of doing so. It is not an error and nothing was written to finance_quotes.',
        `Matched on the workflow name, not through workflow_registry, so a refusal logged under a name mentioning none of finance, quote, trade-in or calc would not be listed here.`,
        refusalOther
          ? `${num(refusalOther)} further REJECTED ${plural(refusalOther, 'row belongs', 'rows belong')} to other workflows and ${plural(refusalOther, 'is', 'are')} not shown.`
          : '',
        capped ? `The read stopped at ${num(REJECT_LIMIT)} rows, so older refusals are not counted.` : '',
      ].filter(Boolean).map(esc).join('<br>')}</div></div>`;

    if (!refusals.length) {
      /* Not "no data". The two rules the workflow enforces are named, so an
         empty panel is a statement about what has happened rather than about
         what this screen managed to fetch. */
      body.innerHTML = stateEmpty('The workflow has refused nothing it recorded',
        `No REJECTED row in audit_log names a workflow this screen recognises as the finance calculator. `
        + `A row appears here when Finance Calc declines an input — a trade-in valued under ${aed(MIN_VEHICLE_VALUE)}, or a quote sent with no customer email — `
        + `and it is written whether the request came from this desk or from anywhere else.`,
        'gpp_good') + foot;
      return;
    }

    body.innerHTML = refusals.map(a => {
      const who = str(a.lead_name) || str(a.lead_email);
      return `<div class="list-item" style="cursor:default;align-items:flex-start">
        <span class="material-symbols-outlined t-warm" style="font-size:20px" aria-hidden="true">gpp_maybe</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${pill('REJECTED')}<span class="chip mono">${esc(str(a.workflow) || 'unnamed workflow')}</span>
            ${who ? `<span class="cell-sub">${personName(who, '')}</span>` : ''}
          </div>
          <div class="cell-sub" style="white-space:normal">${esc(str(a.summary) || 'The workflow recorded no reason on this row.')}</div>
          <div class="cell-sub t-muted">${esc(stamp(a.logged_at))} — ${esc(ago(a.logged_at))}</div>
        </div>
      </div>`;
    }).join('') + foot;
  }

  async function loadAttention() {
    try {
      attn = await db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen'
        + `&screen=eq.finance&limit=${ATTN_LIMIT}`);
      attnErr = null;
    } catch (e) { attn = null; attnErr = e; }
  }

  /* people is rebuilt here rather than inside drawStrip, because the strip, the
     table, the checks and the scope panel must all be counting the same
     customers on the same paint. */
  function renderAll() {
    people = indexPeople();
    drawStrip();
    drawScope();
    drawHistory();
    drawAlerts();
    drawRefusals();
  }

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
    $('fxBody').innerHTML = stateLoading(3);
    await Promise.all([loadAttention(), loadQuotes(), loadLeads(), loadRefusals()]);
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
    const qRate = aprOf(q);
    const lead = leadFor(q);
    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1;min-width:0">
          <h2 style="font-size:18px">${personName(q.lead_name, personName(lead?.name, 'Unnamed customer'))}</h2>
          <div class="cell-sub" style="margin-top:4px">${phoneCell(q)}</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
            ${q.equity_status ? pill(q.equity_status, eqTone(q.equity_status)) : ''}
            <!-- legacy column name; the workflow writes the credit band into it -->
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
            <dt>Equity</dt><dd class="num ${eqClass(q.equity_status)}">${isNoTradeIn(q.equity_status)
              ? '<span class="t-muted">No trade-in — there is no equity on this quote</span>'
              : `<strong>${aed(q.equity_aed)}</strong>`}</dd>
            <dt>Indicative APR</dt><dd class="num">${qRate.ranged
              ? `${aprRange(qRate.low, qRate.high)}<div class="cell-sub">${esc(RATE_BASIS)}</div>`
              : qRate.low == null
                ? '—'
                : `<span class="t-warm">${pct(qRate.low)}+</span><div class="cell-sub t-warm">${esc('Lower bound only — this is the low end of the range and the high end is not recorded on the row. Not the rate.')}</div>`}</dd>
            <!-- finance_tier is the legacy column name. The workflow has
                 written the AECB credit band into it since 30 Aug 2026 and the
                 column was never renamed. -->
            <dt>Credit band</dt><dd>${esc(q.finance_tier || '—')}</dd>
            <dt>Loan to value</dt><dd class="num">${pct(q.loan_to_value_pct)}</dd>
          </dl>
          <div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(
            `These four are what the Finance Calc workflow returned on ${stamp(q.created_at)} and are not recomputed here. `
            + `finance_quotes stores one APR figure and the workflow writes the LOW end of the quoted range into it; `
            + `the range above is read back out of the disclaimer, which carries both ends.`)}</div>
        </div>
        <div class="section">
          <div class="label-caps">Monthly instalment · this desk's arithmetic</div>
          <dl class="kv">
            <dt>Monthly</dt><dd class="num"><strong>${b.monthly == null ? '—' : monthlyRange(b)}</strong>${
              b.monthly == null || b.ranged ? '' : '<div class="cell-sub t-warm">Best case only — amortised at the low end of the rate.</div>'}</dd>
            <dt>Rate</dt><dd class="num">${b.apr == null
              ? '—'
              : b.ranged
                ? `${aprRange(b.apr, b.aprHigh)}<div class="cell-sub">${esc(RATE_BASIS + ', from this quote')}</div>`
                : `${pct(b.apr)}<div class="cell-sub t-warm">${esc('the LOW end of this quote’s range, ' + RATE_BASIS)}</div>`}</dd>
            <dt>Term</dt><dd>${b.monthly == null ? '—' : `${num(b.term)} months, from ${esc(b.termFrom)}`}</dd>
            <dt>Down payment</dt><dd class="num">${b.monthly == null ? '—' : `${aed(b.down)}${b.downPct == null ? '' : ` · ${pct(b.downPct)}`}`}</dd>
            <dt>Amount financed</dt><dd class="num">${b.monthly == null ? '—' : aed(b.principal)}</dd>
            ${cols2.monthly ? `<dt>Stored on the row</dt><dd class="num ${b.drifted ? 't-hot' : ''}">${aed(b.stored)}</dd>` : ''}
          </dl>
          <div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(assumptions(b))}${
            b.drifted
              ? `<br><span class="t-hot">The ${esc(cols2.monthly)} stored on this row falls ${esc(aed(b.gap))} outside ${b.ranged ? 'that range' : 'that figure'}. Do not repeat either number to the customer until the two agree.</span>`
              : ''}</div>
        </div>
        <div class="section">
          <div class="label-caps">Inputs</div>
          <dl class="kv">
            <dt>Vehicle value</dt><dd class="num">${isNoTradeIn(q.equity_status) ? '<span class="t-muted">none</span>' : aed(q.vehicle_value_aed)}</dd>
            <dt>Loan payoff</dt><dd class="num">${isNoTradeIn(q.equity_status) ? '<span class="t-muted">none</span>' : aed(q.loan_payoff_aed)}</dd>
            <dt>Credit score</dt><dd class="num">${num(q.credit_score)}</dd>
          </dl>
          <div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(isNoTradeIn(q.equity_status)
            ? 'This customer had no trade-in, so the workflow stored nothing in either field and priced the rate off the credit score alone. The blanks are the answer, not missing data.'
            : 'As entered by the rep at quote time. No rate, term or down payment is applied to these two figures.')}</div>
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
      /* No trade-in means the two trade-in fields are omitted, not sent empty.
         The workflow reads an omitted vehicleValue as "this customer has nothing
         to trade" and a supplied one as a valuation to price, so sending a blank
         string is asking it to interpret an empty field on our behalf. */
      const r = await n8n(HOOK.finance, {
        ...(v.vehicleValue ? { vehicleValue: v.vehicleValue } : {}),
        ...(v.loanPayoffAmount === '' ? {} : { loanPayoffAmount: v.loanPayoffAmount }),
        creditScore: v.creditScore,
        lead_name: v.lead_name,
        lead_email: v.lead_email,
        quoted_by: ME?.name || SESSION?.user?.email || null,
      });
      renderQuote(r, v);
    } catch (e) {
      const msg = String(e?.message || e);
      /* A refusal answered with a 4xx lands here rather than in renderQuote, and
         rendering it as "Couldn't load the quote" would blame the dashboard for
         the workflow correctly saying no. Whether the refusal arrives as a 200
         body or an HTTP error is a deployment detail inside n8n; the rep should
         not be able to tell the difference. Anything that is not recognisably a
         refusal stays an error, because that is what it is. */
      const declined = declineFromError(msg);
      if (/VITE_N8N_BASE_URL/.test(msg)) {
        out().innerHTML = `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">link_off</span>
             <div>${esc(NO_N8N)}</div></div>`;
      } else if (declined.length) {
        renderDecline(declined, 'http');
      } else {
        out().innerHTML = stateError('the quote', msg);
      }
    } finally {
      btn.disabled = !N8N_BASE;
      btn.innerHTML = '<span class="material-symbols-outlined">calculate</span> Calculate quote';
    }
  });

  /* ── A refusal is an outcome ─────────────────────────────────────────────
     The workflow validates hard, and it should: audit_log carries real REJECTED
     rows reading "vehicleValue must be a realistic vehicle valuation of at least
     AED 5000" and "lead_email is required". Each of those is a quote that never
     reached a customer because the system stopped it, which is the validator
     working, not the dashboard breaking.

     So this renders amber and says "declined", never red and never "error". The
     distinction is not decoration: a red error box sends a rep to find somebody
     technical, while a decline with the reason on it sends them back to the
     field named in the message, which is where the fix is. */
  function renderDecline(reasons, via) {
    const unauth = reasons.some(m => /unauthor|forbidden|token|jwt/i.test(m));
    const body = unauth
      ? 'It did not accept this session, so it never looked at the figures. Sign out and sign back in, then calculate again.'
      : reasons.length
        ? `<ul style="margin:0;padding-left:18px">${reasons.map(m => `<li>${esc(m)}</li>`).join('')}</ul>`
        : 'It declined the request without saying why, which is unusual — the Finance Calc execution in n8n will carry the reason.';
    out().innerHTML = `<div class="banner warm">
      <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">gpp_maybe</span>
      <div><strong>The Finance Calc workflow declined these figures.</strong>
        <div style="margin-top:6px">${body}</div>
        <div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(
          `This is the workflow checking its inputs before it prices anything — a trade-in valued under ${aed(MIN_VEHICLE_VALUE)} or a quote with no customer email is refused rather than stored. `
          + 'Nothing was written to finance_quotes, so the history below is unchanged, and the workflow keeps its own REJECTED row in audit_log — it is listed under the form as soon as this screen is re-checked. '
          + 'Correct the field the message names and calculate again. '
          + 'The wording above is the workflow’s own: it is written for the WhatsApp agent that also calls this calculator, so it names the argument rather than the field on this form. '
          + 'vehicleValue is the trade-in value, loanPayoffAmount is the payoff, creditScore is the AECB score.'
          + (via === 'http' ? ' (The refusal arrived as an HTTP error rather than in the response body; it is the same refusal either way.)' : ''))}</div>
      </div></div>`;
  }

  /* Not quotable is not a decline and not a failure ─────────────────────────
     Below an AECB score of 541 the workflow returns `status:'success'` with
     `quotable:false`, no rate of any kind, and an `instruction` saying what to
     do instead. There is no published UAE band for a file that weak, so the
     honest answer is a referral rather than a worse number — and the one thing
     this screen must not do is render it as a quote with an empty APR beside it,
     which is what a rep reads as "the figure didn't load" and goes hunting for.

     No APR field appears here at all. A blank labelled "Indicative APR" invites
     somebody to fill it in from memory. */
  function renderReferral(res, sent) {
    const band = str(res.credit_band);
    const instruction = str(res.instruction);
    const equity = isNoTradeIn(res.equity_status) || res.has_trade_in === false ? null : n0(res.equity_aed);
    out().innerHTML = `<div class="banner warm">
        <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">support_agent</span>
        <div style="flex:1;min-width:0"><strong>No rate is quoted for this customer — refer them to the bank.</strong>
          <div style="margin-top:6px">${esc(
            'The workflow priced this file and declined to put a percentage on it. This is a complete answer, not a missing one: '
            + 'every rate this dealership can honestly offer sits inside a published band, and there is no published UAE band this low.')}</div>
        </div></div>
      ${instruction ? `<div style="margin-top:16px">
        <div class="label-caps" style="margin-bottom:6px">What the workflow says to do</div>
        <div class="quote">${esc(instruction)}</div></div>` : ''}
      <dl class="kv" style="margin-top:16px">
        <dt>Credit band</dt><dd>${band ? esc(band) : '—'}</dd>
        <dt>Credit score</dt><dd class="num">${num(res.credit_score ?? sent.creditScore)}</dd>
        ${equity == null ? '' : `<dt>Equity on the trade-in</dt><dd class="num ${eqClass(res.equity_status)}">${aed(equity)}</dd>`}
        <dt>Quoted for</dt><dd>${personName(sent.lead_name, '—')}<div class="cell-sub">${esc(sent.lead_email)}</div></dd>
      </dl>
      ${res.disclaimer ? `<div class="quote" style="margin-top:16px">${esc(res.disclaimer)}</div>` : ''}
      <div class="cell-sub" style="margin-top:12px;white-space:normal">${esc(
        'Recorded by the workflow in finance_quotes with no APR against it. A row in the history below with an empty rate column is this outcome, not a lost figure.')}</div>`;

    /* Same re-read as a priced quote: the row exists either way. */
    loadQuotes().then(() => { focusKey = null; renderAll(); });
  }

  /* The workflow answers 200 for everything, including its own refusals, so the
     shape of the body is what decides which of the four outcomes this is: a
     refusal, a customer no rate may be quoted for, an answer with no quote in
     it, or a quote. */
  function renderQuote(r, sent) {
    const res = r && typeof r === 'object' ? r : {};
    const listed = reasonsFrom(res);
    /* `input_error` is the 30 Aug 2026 name for what used to arrive as
       `{status:'error', errors:[…]}`. Named explicitly as well as caught by the
       general test below, because it is the shape this desk now meets most. */
    const rejected = ['error', 'input_error'].includes(lower(res.status))
      || (listed.length && lower(res.status) !== 'success');

    if (rejected) { renderDecline(listed, 'body'); return; }

    if (res.quotable === false) { renderReferral(res, sent); return; }

    /* What counts as a quote, restated for the shape the workflow returns now.
       This used to test `finance_tier` and `indicative_apr_pct`, neither of
       which the workflow has emitted since 30 Aug — and `equity_aed`, which is
       null by design for a customer with no trade-in. A perfectly good rate for
       a cash buyer therefore satisfied none of the three and was thrown away
       with "the workflow replied, but with no quote in it". */
    const rate = aprOf(res);
    const hasQuote = rate.low != null || str(res.credit_band) || n0(res.equity_aed) != null;
    if (!hasQuote) {
      out().innerHTML = `<div class="banner warm">
          <span class="material-symbols-outlined" style="font-size:20px">help</span>
          <div><strong>The workflow replied, but with no quote in it.</strong>
            <div style="margin-top:6px">Nothing is shown here rather than a figure that was not returned.
              Check the Finance Calc execution in n8n.</div></div></div>`;
      return;
    }

    const ltv = n0(res.loan_to_value_pct);
    const noTradeIn = res.has_trade_in === false || isNoTradeIn(res.equity_status);
    /* Same model as the history table, on the response instead of a stored row,
       so the figure the rep reads out now and the figure in the history a week
       later are the same arithmetic. The live response carries both ends of the
       rate as their own fields, so the instalment here is always a range. */
    const b = basis({
      vehicle_value_aed: noTradeIn ? null : sent.vehicleValue,
      indicative_apr_low_pct: res.indicative_apr_low_pct,
      indicative_apr_high_pct: res.indicative_apr_high_pct,
      loan_to_value_pct: res.loan_to_value_pct,
    });
    /* The APR tile is the range and only the range, carrying the band and the
       basis it is on. It used to read `res.indicative_apr_pct` and
       `res.finance_tier`, neither of which the workflow has returned since
       30 Aug: every live quote rendered "Indicative APR —" with no band beside
       it, which is a rep watching a working workflow look broken. */
    out().innerHTML = `
      <div class="grid g2">
        ${kpi('Equity', noTradeIn
            ? '<span class="t-muted">No trade-in</span>'
            : `<span class="${eqClass(res.equity_status)}">${aed(res.equity_aed)}</span>`,
          noTradeIn
            ? muted('This customer has nothing to trade in, so there is no equity to have. The rate below is priced off the credit score alone.')
            : (res.equity_status ? pill(res.equity_status, eqTone(res.equity_status)) : ''))}
        ${kpi('Indicative APR', aprRange(res.indicative_apr_low_pct, res.indicative_apr_high_pct),
          `${res.credit_band ? `<span class="chip">${esc(str(res.credit_band))}</span> ` : ''}`
          + muted(str(res.rate_basis) || RATE_BASIS))}
      </div>
      ${str(res.equivalent_flat_rate_range_pct) ? `<div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(
        `The same rate quoted the way UAE banks advertise it is ${str(res.equivalent_flat_rate_range_pct)}% flat. `
        + 'Never say the flat figure on its own — it is roughly half the reducing-balance rate over 60 months and the customer will hear it as the cost.')}</div>` : ''}
      ${ltv == null ? '' : `<div style="margin-top:16px">
        <div class="label-caps" style="margin-bottom:6px">Loan to value · ${pct(ltv)}</div>
        <div class="bar"><i style="width:${Math.min(100, Math.max(0, ltv))}%;background:var(--${ltv > 80 ? 'hot' : 'primary'})"></i></div>
        ${ltv > 80 ? '<div class="cell-sub t-hot" style="margin-top:6px">Above 80% — most lenders will want a deposit.</div>' : ''}
      </div>`}
      <div style="margin-top:16px">
        <div class="label-caps" style="margin-bottom:6px">Indicative monthly instalment</div>
        <div class="kpi-value sm">${b.monthly == null ? '—' : monthlyRange(b)}</div>
        <div class="cell-sub" style="margin-top:6px;white-space:normal">${esc(assumptions(b))}
          ${b.monthly == null ? '' : esc(' Say it as a span, with the rate, the term and the deposit attached, or do not say it.')}</div>
      </div>
      <dl class="kv" style="margin-top:16px">
        <dt>Quoted for</dt><dd>${personName(sent.lead_name, '—')}<div class="cell-sub">${esc(sent.lead_email)}</div></dd>
        <dt>On a value of</dt><dd class="num">${noTradeIn ? '<span class="t-muted">no trade-in</span>' : aed(sent.vehicleValue)}</dd>
        <dt>Payoff</dt><dd class="num">${noTradeIn ? '<span class="t-muted">none</span>' : aed(sent.loanPayoffAmount)}</dd>
        <dt>Credit score</dt><dd class="num">${num(sent.creditScore)}</dd>
      </dl>
      ${str(res.assumes) ? `<div class="cell-sub" style="margin-top:12px;white-space:normal">${esc(
        `The workflow priced this on ${str(res.assumes)}.`
        + (str(res.without_salary_transfer_note) ? ` ${str(res.without_salary_transfer_note)}` : ''))}</div>` : ''}
      ${str(res.instruction) ? `<div style="margin-top:16px">
        <div class="label-caps" style="margin-bottom:6px">How to say this</div>
        <div class="quote">${esc(str(res.instruction))}</div></div>` : ''}
      ${res.disclaimer ? `<div class="quote" style="margin-top:16px">${esc(res.disclaimer)}</div>` : ''}
      ${res.email_from_model ? `<div class="cell-sub t-warm" style="margin-top:12px;white-space:normal">${esc(
        'The workflow flagged that the customer email on this quote did not come from the caller — it was recovered from what the model sent. '
        + 'The identity behind this promise was not established by the workflow; check it before the figure is repeated.')}</div>` : ''}
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

  await Promise.all([loadQuotes(), loadLeads(), loadAttention(), loadRefusals()]);
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
