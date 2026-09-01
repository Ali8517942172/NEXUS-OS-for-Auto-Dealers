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
   2. Nothing on this screen is computed locally from a quote. There is no
      exception any more, and the one there used to be is the reason this
      paragraph is longer than the others. Until 31 Aug 2026 this file amortised
      a monthly instalment in the browser, and the "amount financed" it
      amortised was `vehicle_value_aed × loan_to_value_pct / 100` — which
      cancels, exactly, to `loan_payoff_aed`: the outstanding loan on the car
      being TRADED IN. It was amortised at the new car's rate over a 60-month
      desk default and printed as the payment on the car being BOUGHT. A figure
      26–44% away from the truth was read out to a customer. Equity, LTV, credit
      band, APR, deposit, tenure, amount financed and instalment are read off
      the workflow response and off `finance_quotes`, and are never recomputed,
      defaulted or filled in here.
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
   5. Every money figure on this screen says where it came from, and since
      31 Aug 2026 there is only one place any of them can come from. Value and
      Payoff are what the rep typed. Equity, LTV, credit band, APR, deposit,
      tenure, amount financed, instalment and total cost of credit are what the
      Finance Calculator returned and stored. Where it returned nothing, this
      screen prints no number and says which of exactly three things happened:
      there is no quote, the calculator returned no figure for this one, or the
      calculator refused to price this file. An em dash is not one of those
      three answers, so none of them is rendered as one.

   6. An empty table is not an idle desk, and this screen may not imply that it
      is. finance_quotes is EMPTY while audit_log holds EIGHT runs whose summary
      says "Quote issued" — a customer was given a rate and this desk holds no
      record of any of them. Five of the eight also carry "| 1 of 1 claimed
      steps did not land [finance_quotes row ...]", the writer reporting its own
      insert failing; the other three reported every claimed step landed and are
      missing anyway. Until 1 Sep 2026 this screen could only see the five,
      because it looked for the outcome class PARTIAL — which is only reached
      when the writer NOTICES the write fail — and the three that failed quietly
      passed as ordinary successes. It now also asks the question the class
      cannot answer: does audit_log record a quote issued to somebody this desk
      holds nothing for? See QUOTE_ISSUED_RE. The two are shown apart, because
      what is known about them differs: for the five the workflow said the row
      did not land, and for the three all that is known is that no row is here
      now — which a deleted row would look exactly like, and this screen says so
      rather than choosing the dramatic reading. Those quotes cannot appear in
      the history below, so the alert strip names them and the empty state
      refuses to read as "nothing has happened here". What an audit_log status MEANS is decided in one place for
      the whole dashboard — lib/health.js, mirroring public.nexus_outcome_class()
      — and this file calls it rather than testing the string itself. The status
      on those five rows is FAILED; the module classifies them PARTIAL, because
      a run that quoted a customer and lost the record went out half-done rather
      than failing. As of 1 Sep 2026 no `audit_log.status` literal survives
      anywhere in this file's logic at all — not in a comparison, not in a
      colour, and not in a PostgREST filter. The last one was a
      `status=ilike.rejected` on the read behind the refusal panel, which is
      described at AUDIT_LIMIT and is gone. Statuses are still named in prose
      where the prose is about what the writers emit; nothing acts on them.

      Two things this file does NOT claim, because it does not know them and
      does not need to. It does not claim those five rows are all there will
      ever be: health.js reclassifies on the summary phrase, so a row spelled
      PARTIAL reaches the same panel by the same route. And it does not claim
      whether the two Delivery Report writers still emit FAILED for half-landed
      work — on 1 Sep 2026 two audits run the same day disagree, one having read
      the published node bodies off the n8n box and found the rung gone, the
      other having read the repo JSON and found it intact. health.js's rule 1 is
      a writer correction with a stated retirement condition; this screen renders
      identically before and after it is retired, which is the only property it
      is entitled to rely on.

   The workflow's own limits, mirrored below so the rep sees them before the
   round trip rather than after it: `vehicleValue` must be at least AED 5,000,
   `lead_email` is required and format-checked, and `finance_quotes.credit_score`
   carries a 300–900 CHECK constraint in Postgres. The field names the workflow
   accepts are exactly vehicleValue / loanPayoffAmount / creditScore — it logs a
   REJECTED audit row for anything else, so they are not renamed here.

   ── Round 4, 24 Aug 2026. Three quotes, one customer. ────────────────────────

   Read this section as the dated history it is. The three rows it describes are
   GONE: `finance_quotes` held 0 rows when this file was last measured against
   the live database, on 1 Sep 2026. What survives is the rule the three rows
   taught, and the rule is what the code below implements — every count on this
   screen counts people as well as quotes, and no mean is printed until enough
   different people are behind it. Nothing here reads as a live figure.

   `finance_quotes` held three rows and all three carried the same lead_email.
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

   ONE absence on `finance_quotes`, and it is the only one: there is no validity
   column under any name. **No quote here can be marked expired** — nothing on
   the row records when one stops standing. "More than 7 days old" in the alerts
   is this desk's own prompt to re-quote, labelled as such and never as a
   status.

   This file used to claim three. The other two — no term, no monthly payment —
   were never true, and asserting them on screen is what kept the browser
   arithmetic alive through review. `tenure_months`, `monthly_payment_low_aed`,
   `monthly_payment_high_aed`, `financed_aed`, `down_payment_aed`,
   `down_payment_pct`, `down_payment_assumed`, `total_cost_of_credit_low_aed`,
   `total_cost_of_credit_high_aed`, `max_ltv_pct`, `min_down_payment_aed`,
   `vehicle_price_aed`, `trade_in_equity_applied_aed`, `apr_source` and
   `ltv_policy_source` are all real columns (confirmed against
   information_schema on 31 Aug 2026) and always were. The screen looked for
   them under names nobody ever created — `monthly_payment_aed`,
   `loan_amount_aed`, `amount_financed_aed` — found nothing, and printed the
   absence as a fact about the database.

   They are EMPTY, not absent, which is a different sentence and the one this
   screen now says. `finance_quotes` holds no row at all today and the deployed
   calculator writes 13 of its 34 columns, none of them an instalment. So the
   honest output for each of these is no number and a statement of which
   absence it is.

   And a rejection from the workflow is an outcome, not a fault. finance-calc is
   live and JWT-guarded and it validates hard: `audit_log` carries real REJECTED
   rows reading "vehicleValue must be a realistic vehicle valuation of at least
   AED 5000" and "lead_email is required". So a refusal renders as the workflow
   declining the input with its reason attached — never red, never the word
   error, and never a "Couldn't load" that sends a rep hunting for a bug in a
   dashboard that is working exactly as designed. The same rendering is reached
   whether the workflow refuses with a 200 or a guard in front of it refuses with
   a 4xx, and the outcomes it has actually recorded are listed on the screen.

   This paragraph used to end "every one of those is a bad quote that never
   reached a customer", and the panel below it acted on that sentence: it
   selected on the raw status, painted every row with one red pill and printed
   one verdict over all of them. Not every one of those is the same event.
   lib/health.js — which mirrors public.nexus_outcome_class() and is the only
   module in this dashboard allowed to read that column — splits Finance Calc's
   46 REJECTED rows 33 / 13 (measured against the live database on 1 Sep 2026):
   33 REFUSED BY DESIGN, excluded from every success denominator, and 13 with no
   refusal marker on them at all, which it calls NO RESULT and counts. The panel
   now shows the two apart, in the module's words and the module's colours, and
   the word "amber" has left this paragraph because neither of them is amber:
   health.js tones both neutral, and a red pill over the sentence "it is not an
   error" was the exact contradiction this file's whole status policy exists to
   remove.

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
import { OUTCOME, isQualifying, isRefusal, outcomeOf, outcomeWords } from '../lib/health.js';
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

/* ── UAE consumer-finance policy, and what it is NOT ──────────────────────
   Three numbers that used to be two, because one constant was doing the work of
   two different ideas and the screen quoted the wrong one at a customer.
   Nothing below reaches arithmetic. They are printed as the policy they are —
   to say what a deposit or a tenure is measured against — and every deposit,
   tenure and instalment figure this screen shows comes off the row instead.

   The FLOOR. CBUAE Regulation 29/2011 caps a car loan at 80% of vehicle value,
   so 20% down is the LEAST a customer may legally put in. It is a legal
   minimum, not a market expectation, and it was previously used as the desk's
   "default deposit" — which produces the largest loan the law permits and
   understates the cash the customer has to find. Per quote the row carries the
   enforced figures in `max_ltv_pct` and `min_down_payment_aed`, with
   `ltv_policy_source` naming the regulation; where the row has them, the row
   wins and these are not shown at all. */
const MIN_DOWN_PAYMENT_PCT_CBUAE = 20;                            // legal floor
const MAX_LTV_PCT_CBUAE = 100 - MIN_DOWN_PAYMENT_PCT_CBUAE;       // 80%, the floor expressed as an LTV

/* The ASSUMPTION, kept deliberately apart from the floor above. UAE banks
   commercially cap USED cars at 70% LTV and ALBA CARS sells used cars, so a
   customer who states no deposit is assumed to bring 30%. Ten points of vehicle
   value separate the two — on a 290,000 car, 29,000 of the customer's own money
   — which is the whole reason they are not one constant. The CALCULATOR applies
   this, never this screen: `down_payment_assumed` on the row says whether the
   deposit was stated by the customer or assumed by the calculator, and that
   boolean exists precisely so the UI never has to guess which it is. */
const ASSUMED_DOWN_PAYMENT_PCT_USED = 30;

/* The MAXIMUM tenure, CBUAE again — not a desk default, though it was used as
   one. A 60-month assumption both minimises every monthly figure shown and
   maximises the total interest sitting behind it. `tenure_months` on the row is
   the only tenure this screen prints. */
const MAX_TENURE_MONTHS_CBUAE = 60;

/* Names shown per alert before it collapses into "+N more". Clicking the row
   filters the history to the full set, so this is a glance, not the list. */
const PREVIEW = 3;

/* Rows read from audit_log for this screen, in ONE request. There were two
   until 1 Sep 2026, and the first of them — `status=ilike.rejected` — was the
   last status literal left in this file's logic. It was wrong twice over.

   Wrong on meaning: REJECTED is not one outcome. lib/health.js splits the 46
   REJECTED rows Finance Calc has written into 33 REFUSED-BY-DESIGN and 13
   NO-RESULT (measured against the live database on 1 Sep 2026), and the panel
   was giving all 46 the single verdict "a refusal, not an error".

   Wrong on scope: the limit was applied to EVERY workflow's rejections, newest
   first, and the finance filter ran in the browser afterwards. On 1 Sep 2026
   that read returned 100 rows of which only 29 were Finance Calc's — 17 of its
   46 cut by the cap, and ALL 13 of the no-result rows outside the window. A
   busy hour on another workflow was silently deciding what this desk could see.
   The lost-quote read had already been given a server-side workflow filter for
   exactly that reason; this is the same fix applied to the same table.

   62 rows match the workflow filter today (1 Sep 2026), so the ceiling is not
   close — and it is stated on screen when it is reached rather than left to be
   inferred from a shorter list. */
const AUDIT_LIMIT = 300;

/* Which audit_log rows this screen claims as its own. workflow_registry is not
   read here — that is one more request for a panel that can say how it matched
   — so the match is on the workflow name and the panel states that, along with
   the fact that a refusal logged under a name mentioning none of these words
   would not be listed. */
const FINANCE_FLOW = /financ|quote|trade-?in|calc/i;

/* The phrase Finance Calc's Delivery Report writes at the head of the summary
   on every run that put a figure in front of a customer — "Quote issued", with
   or without a "| N of M claimed steps did not land" tail behind it.

   This is NOT a status and is not a second opinion on one: health.js still owns
   the column, and the PARTIAL split below is still health.js's. This matches on
   the sentence the writer emits about WHAT IT DID, which is a different
   question from how the run ended, and it is the only question that can find a
   quote the desk has no row for.

   Why it was needed. `lost` reads PARTIAL, and PARTIAL is only reached when the
   writer itself noticed the finance_quotes insert fail and said so. Measured
   against the live database on 1 Sep 2026, audit_log holds EIGHT Finance Calc
   rows whose summary begins "Quote issued" — 5 of them PARTIAL and 3 of them
   SUCCESS, the writer reporting every claimed step landed — while
   finance_quotes holds ZERO rows. So three customers were quoted on runs that
   reported themselves complete and this desk has no record of any of them, and
   the strip above named five of the eight. The three are not claimed to be
   failed writes: a row that was written and later deleted looks identical from
   here, and this screen cannot tell those apart and does not try. What it can
   say, and now does, is that audit_log records a quote issued to a person for
   whom this desk holds nothing. */
const QUOTE_ISSUED_RE = /\bquote\s+issued\b/i;

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
   fields" and stops there, so this screen asks for `*` (see loadQuotes) rather
   than naming columns in a `select=`, where one wrong name is PostgREST 42703
   and the *whole* query dies. Everything the row has therefore arrives on the
   row and is read below by its real name.

   That is what is left of a block that used to hold five lists of GUESSED
   names. Two of them — the monthly payment and the amount financed — guessed
   wrong on all eight candidates, so `cols2.monthly` and `cols2.financed` were
   permanently null: the screen concluded the columns did not exist, said so on
   screen as a fact about the database, disabled its own safety check on the
   strength of it, and modelled the money itself. The real names are in the
   header comment, confirmed against information_schema on 31 Aug 2026.

   ONE list survives, and only because the thing it looks for genuinely does not
   exist: no column of any name on `finance_quotes` records when a quote stops
   standing. If one is ever added under one of these names the age check picks
   it up and says which of the two dates it used. Note the structural weakness
   that made the original mismatch invisible — `hasCol` inspects returned ROWS,
   so an empty table reports every column absent regardless of name. That is
   survivable for a date this screen only ever prefers, and it is not survivable
   for a figure a customer hears, which is why nothing else is probed this way. */
const VALID_COLS = ['valid_until', 'quote_valid_until', 'valid_till', 'expires_at'];
const hasCol = (rows, key) => rows.some(r => r && Object.prototype.hasOwnProperty.call(r, key));
const pickCol = (rows, names) => names.find(k => hasCol(rows, k)) || null;

/* There was an `instalment()` here — the standard amortising formula, a
   `Math.pow`, and a `principal / months` branch for a zero rate. It was the
   only `Math.pow` in the entire application. It is gone, along with every call
   site, because the principal it was fed was the payoff on the trade-in (rule 2
   at the top of this file) and because `monthly_payment_low_aed` and
   `monthly_payment_high_aed` exist on the row and always did. The instalment
   this desk shows is now the one the calculator computed and stored, or none. */

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
      <div class="card-sub">v_needs_attention for this screen, plus five checks this screen runs on the quotes and leads it just read</div>
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
      <div class="card-sub">Straight from the workflow response. No figure on this card is worked out in this browser — the line that used to say one was, said it about the one figure that was wrong</div>
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
      <div class="card-title">Runs that produced no quote</div>
      <div class="card-sub">What Finance Calc recorded in <span class="mono">audit_log</span> on the runs that priced nothing,
        split the way <span class="mono">lib/health.js</span> splits them: a figure the workflow declined by design, and a run that
        went through and produced nothing usable. They are not the same event and are not counted the same way</div>
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
  let leadsCapped = false;              // the read hit LEAD_LIMIT, so "no such lead" is not knowable
  let attn = null, attnErr = null;      // v_needs_attention rows for this screen
  /* Only the validity date is probed by name now; everything else is read off
     the row directly. See the VALID_COLS comment for why this one is different. */
  let cols2 = { valid: null };
  let filter = 'all';
  let query = '';
  let focusKey = null;                  // an alert the history is filtered to
  let checks = [];
  const checkByKey = new Map();
  let people = new Map();               // lead_email -> the quotes filed under it
  /* One read of audit_log serves this whole screen, and lib/health.js is the
     only thing allowed to say what any row in it means. `audit` is every row
     the workflow-name filter matched; the three lists below are that set split
     by OUTCOME CLASS, never by status. null on any of them means the read
     failed, which is not the same as "none" and is never rendered as one. */
  let audit = null, auditErr = null, auditCapped = false;
  let refusals = null;   // REJECTED_EXPECTED — declined by design, not counted against the workflow
  let noResult = null;   // NO_RESULT — it ran, produced nothing usable, and IS counted
  let lost = null;       // PARTIAL — a quote reached the customer, its finance_quotes row did not
  /* Every run whose summary says a quote was issued, whatever outcome class it
     ended in. Not a fourth class and not a reading of the status column — the
     writer's own sentence about what the run did. Crossed against the quotes
     this screen actually holds, it finds the issued quotes `lost` cannot: the
     ones the writer believed it had stored. */
  let issued = null;

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
      return leadsCapped
        ? `<span class="t-muted" title="${esc(`The leads read stopped at its ${LEAD_LIMIT}-row ceiling, so whether a lead carries this email is not known — only that none of the ${LEAD_LIMIT} newest does. No phone number is shown and none is claimed absent.`)}">not looked up</span>`
        : `<span class="t-muted" title="No lead in the database carries this email address, so there is no phone number to show. finance_quotes stores no phone of its own.">—</span>`;
    }
    if (!str(lead.phone)) {
      return '<span class="t-muted" title="This lead has no phone number on file.">—</span>';
    }
    return `<span class="mono">${esc(str(lead.phone))}</span>`;
  }

  /* ── Three ways for a figure to be missing ───────────────────────────────
     `aed(null)` and `pct(null)` are both an em dash, so before 31 Aug 2026 a
     rep could not tell "there is no quote for this customer", "there is a quote
     and the calculator returned no figure for it" and "the calculator refused
     to price this file" apart. They are three different next actions — quote
     them, ask the calculator for the missing input, refer them to the bank —
     and the third is the one somebody fills in from memory if it looks like a
     loading failure.

     So each state gets its own words ON the page and not only in a tooltip: a
     screenshot, a printed quote and a shared screen all have no hover.

     Only two of the three are cell-level, because the third cannot be: where no
     quote exists there is no row to draw a cell in. That state is a whole-panel
     `stateEmpty` — "No quotes recorded yet" under the history table and "No
     quote yet" on the result card — and it is named here so the next person
     looking for a third key finds the reason rather than adding one. */
  const ABSENT = {
    unpriced: { text: 'not calculated',  cls: 't-muted' },
    declined: { text: 'not priced',      cls: 't-warm'  },
  };
  const absent = (state, why) =>
    `<span class="${ABSENT[state].cls}" title="${esc(why)}">${esc(ABSENT[state].text)}</span>`;

  /* ── What the calculator returned ────────────────────────────────────────
     A straight projection of the row onto the names this screen renders.
     Nothing here derives, defaults or falls back: every field is a column on
     `finance_quotes`, read by its real name, and where the column is null the
     field is null and stays null. The `basis()` that used to live here
     amortised the trade-in payoff at the new car's rate — rule 2 at the top of
     this file — and its removal is the whole of this change.

     `??` and not `||` throughout. A tenure of 0 or a deposit of 0 is a figure
     the calculator recorded; `||` silently replaced it with a desk default,
     which is the same fault as inventing one, arriving by a quieter route.

     `state` is what the rest of the screen renders off:
       'priced'   — the calculator returned an instalment. Show it.
       'unpriced' — there is a quote and no instalment on it. `why` says what
                    the calculator was missing, in its own words where the
                    response carried them.
       'declined' — the calculator would not put a rate on this file at all (an
                    AECB score below 541 returns quotable:false), or it failed.
                    There is nothing to show and nothing to work out. */
  function basis(q) {
    const rate = aprOf(q);
    /* `vehicle_price_aed` is the car being BOUGHT. `vehicle_value_aed` is the
       TRADE-IN and is not read here at all — reading it here is how the wrong
       car ended up in the instalment. It is rendered under Inputs, where it is
       labelled as what the rep typed. */
    const price = n0(q.vehicle_price_aed);
    const financed = n0(q.financed_aed);
    const tenure = n0(q.tenure_months);
    const down = n0(q.down_payment_aed);
    const downPct = n0(q.down_payment_pct);
    const downAssumed = q.down_payment_assumed === true;
    const minDown = n0(q.min_down_payment_aed);
    const maxLtv = n0(q.max_ltv_pct);
    const equityApplied = n0(q.trade_in_equity_applied_aed);
    const monthly = n0(q.monthly_payment_low_aed);
    const monthlyHigh = n0(q.monthly_payment_high_aed);
    const creditLow = n0(q.total_cost_of_credit_low_aed);
    const creditHigh = n0(q.total_cost_of_credit_high_aed);
    const aprSource = str(q.apr_source);
    const ltvSource = str(q.ltv_policy_source);
    /* The calculator's own account of why it produced no instalment. No column
       stores it and the DEPLOYED workflow does not return it — only the
       replacement calculator at fixes/finance/calc_new.js writes it — so it is
       absent everywhere today and this read is what makes it appear the day
       that workflow goes live. Where it is there it beats anything this screen
       could infer from the nulls, which is why it is preferred over both of the
       sentences below. */
    const calcReason = str(q.emi_unavailable_reason);

    /* 'declined' is a claim about something the CALCULATOR did, so it may only
       be read off evidence the calculator wrote: `quotable: false` on a live
       response (an AECB score below 541, for which no UAE lender publishes a
       band) or an error status on one. Neither is a column on finance_quotes,
       so no stored row is ever 'declined' — correctly, because a row exists
       only where a quote was issued.

       This test used to also read `|| rate.low == null`, which turned "this row
       records no rate" into "the calculator refused to price this file" and put
       a referral to the bank in front of a rep on the strength of an empty
       column. An absent figure is not evidence of a refusal. Asserting an
       unknown as a fact is the same fault as inventing a figure, one step to
       the left, and it is the fault this whole file is being corrected for. */
    const declined = q.quotable === false
      || ['error', 'input_error'].includes(lower(q.status));
    const state = declined ? 'declined' : (monthly == null ? 'unpriced' : 'priced');

    const why = declined
      ? 'The calculator would not put a rate on this file, so there is no instalment behind it and none may be worked out here. '
        + 'A file it declines to price is a referral to the bank, not a cheaper quote.'
      : state === 'unpriced'
        ? (calcReason
          /* Three different absences, and the screen says which one it is
             rather than collapsing them. The first deliberately declines to
             choose between two explanations it cannot tell apart. */
          || (rate.low == null
            ? 'This quote records no indicative APR in any of the three places one can be written — the column, the disclaimer prefix, or the live response — and no instalment either. '
              + 'Whether the calculator refused this file or the row was written incompletely is not something this screen can tell from empty columns, so it claims neither.'
            : price == null
              ? 'The calculator was never told the price of the car being BOUGHT, so it returned no instalment. '
                + 'This desk captures a trade-in value and a payoff and no purchase price at all — there is no field for one on '
                + 'this form — and a payment worked out without it is a payment on the wrong car. That is the 31 Aug 2026 incident exactly.'
              : 'The calculator returned no instalment for this quote: monthly_payment_low_aed on the row is empty. '
                + 'The row does not record why, and this screen will not guess at it.'))
        : '';

    const aprRanged = rate.low != null && rate.high != null && rate.low !== rate.high;
    const monthlyRanged = monthly != null && monthlyHigh != null && monthlyHigh !== monthly;
    return { state, why, apr: rate.low, aprHigh: rate.high, aprRanged, aprSource,
             maxLtv, ltvSource, price, financed, tenure,
             down, downPct, downAssumed, minDown, equityApplied,
             monthly, monthlyHigh, monthlyRanged, creditLow, creditHigh };
  }
  /* One quote is drawn in the table, in the drawer and in an alert on the same
     paint; the basis is identical each time and is worked out once. */
  const basisCache = new Map();
  const basisOf = q => {
    const k = keyOf(q);
    if (!basisCache.has(k)) basisCache.set(k, basis(q));
    return basisCache.get(k);
  };

  /* The sentence under any instalment. Where one exists it names the columns it
     was read from and whether the deposit behind it was stated or assumed —
     `down_payment_assumed` exists so that this sentence never has to guess.
     Where none exists it is `b.why`, which names the absence rather than
     describing arithmetic that no longer happens. */
  function instalmentBasis(b) {
    if (b.state !== 'priced') return b.why;
    const parts = [];
    parts.push(`Read off the quote, not worked out here: monthly_payment_low_aed`
      + `${b.monthlyRanged ? ' and monthly_payment_high_aed' : ''}, as the Finance Calculator stored ${b.monthlyRanged ? 'them' : 'it'}.`);
    if (b.financed != null) parts.push(`It is the instalment on ${aed(b.financed)} financed`
      + `${b.tenure == null ? '' : ` over ${num(b.tenure)} months`}`
      + `${b.apr == null ? '' : ` at ${b.aprRanged ? aprRange(b.apr, b.aprHigh) : pct(b.apr)} ${RATE_BASIS}`}.`);
    if (b.down != null) {
      parts.push(`Deposit ${aed(b.down)}${b.downPct == null ? '' : ` (${pct(b.downPct)} of the price)`}, `
        + (b.downAssumed
          ? `which the customer did NOT state — the calculator assumed it. Confirm it before this figure is repeated: a different deposit is a different payment.`
          : `as stated by the customer.`));
    }
    if (b.creditLow != null) {
      parts.push(`Total cost of credit ${b.creditHigh == null || b.creditHigh === b.creditLow
        ? aed(b.creditLow) : aedRange(b.creditLow, b.creditHigh)} over the term.`);
    }
    if (!b.monthlyRanged) {
      parts.push('Only one end of the payment is stored on this row, so it is a single figure and not the span the rate is quoted at.');
    }
    return parts.join(' ');
  }
  /* The span, or the one end that is stored named as an end. `num` on the far
     side rather than `aed`, for the same reason aedRange gives: "AED" twice in
     one cell reads as two separate prices. */
  const monthlyRange = b => (b.monthlyRanged ? `${aed(b.monthly)} – ${num(b.monthlyHigh)}` : aed(b.monthly));
  const monthlyCell = q => {
    const b = basisOf(q);
    const t = instalmentBasis(b);
    if (b.state !== 'priced') return absent(b.state, t);
    return `<span title="${esc(t)}">${monthlyRange(b)}</span>`
      + (b.monthlyRanged ? '' : ' <span class="t-warm" title="One figure, not a span. Only monthly_payment_low_aed is stored on this row, so this is the cheapest payment inside the quoted rate range and not the payment.">↓</span>')
      + (b.downAssumed ? ' <span class="t-warm" title="The deposit behind this payment was assumed by the calculator, not stated by the customer (down_payment_assumed is true on this row). A different deposit is a different payment.">≈</span>' : '');
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
      'Monthly is NOT modelled here any more. It is monthly_payment_low_aed and monthly_payment_high_aed off the row, as the Finance Calculator computed and stored them, '
        + 'together with the tenure, the amount financed and the deposit behind them. Until 31 Aug 2026 this browser amortised the figure itself and amortised the wrong '
        + 'number — the payoff on the trade-in rather than the loan on the car being bought. Nothing on this table is arithmetic performed in this browser.',
      'Monthly says which of three things it is when there is no figure, because they are three different next actions: "not calculated" is a quote the calculator returned no '
        + 'instalment for (hover it for what it was missing), "not priced" is a file it declined to put a rate on at all, and an empty table says so in its own words above. '
        + 'A ↓ marks a row storing only one end of the payment. A ≈ marks a row whose deposit the calculator ASSUMED rather than the customer stating it.',
      `A deposit is not a desk default. The calculator decides it and records down_payment_assumed to say whether the customer stated it: ${MIN_DOWN_PAYMENT_PCT_CBUAE}% is `
        + `the CBUAE 29/2011 legal floor (a ${MAX_LTV_PCT_CBUAE}% LTV ceiling), roughly ${ASSUMED_DOWN_PAYMENT_PCT_USED}% is what a UAE bank wants on a used car, and the two `
        + `are ${ASSUMED_DOWN_PAYMENT_PCT_USED - MIN_DOWN_PAYMENT_PCT_CBUAE} points of the price apart. Tenure comes from tenure_months; ${MAX_TENURE_MONTHS_CBUAE} months is `
        + 'the CBUAE ceiling and never an assumption made here.',
      `finance_quotes stores no validity date under any name, which is why no row on this table `
        + `is ever marked expired: nothing records when a quote stops standing. When is what the table shows, and "more than ${num(QUOTE_VALID_DAYS)} days old" above it is this desk's prompt to re-quote.`,
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
      /* The first of the three absences, and the only one that is a whole panel
         rather than a cell: there is no quote, as opposed to a quote the
         calculator returned no figure for ("not calculated") or a file it
         declined to price ("not priced"). finance_quotes is empty today, so
         this is what the desk actually shows. */
      /* The table is EMPTY, so every quote audit_log says was issued is missing
         from it — there is no need to ask which of them the writer noticed
         failing. `issued` is therefore the count here, not `lost`: on 1 Sep 2026
         those are 8 and 5, and the three-quote difference is three customers who
         were quoted on runs that reported themselves complete. The strip above
         splits them by what is known about each; this panel only has to say how
         many quotes exist that it cannot show. */
      const nIssued = issued ? issued.length : 0;
      body.innerHTML = stateEmpty(
        nIssued ? 'No quote recorded here — and some were issued' : 'No quotes recorded yet',
        'finance_quotes holds no row at all, so there is no figure on this desk to show or to withhold. '
        + 'Every calculation from this screen is stored here, with the customer and the rep it belongs to. '
        /* An empty table is not the same fact as an idle desk, and until the
           audit_log read existed this panel could not tell them apart. It said
           "no quotes recorded yet" over a month in which the calculator issued
           eight quotes to customers and kept none of them. */
        + (issued === null
          ? 'Whether any quote was issued without being recorded is unknown: the audit_log read failed, so an empty table here is not evidence of an empty desk.'
          : nIssued
            ? `It is NOT evidence that nothing has been quoted: ${num(nIssued)} ${plural(nIssued, 'run', 'runs')} in audit_log ${plural(nIssued, 'records a quote', 'record quotes')} issued to a customer, and with this table empty not one of them is here. `
              + 'They are named in the strip at the top of this screen and they cannot be listed below, because there is no row to list.'
            : 'audit_log records no quote issued at all, so nothing is missing from this table — it is empty because the desk has not quoted, not because quotes were lost.'),
        'receipt_long');
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
      /* Both are what the rep TYPED, not what the calculator returned, and both
         are legitimately empty for a cash buyer. So a blank here is either "no
         trade-in, and that is the answer" or "the rep recorded none", and the
         two are said apart rather than sharing an em dash with everything else
         on the row. */
      { label: 'Value', align: 'r', render: r => (n0(r.vehicle_value_aed) != null
        ? `<span title="As entered by the rep at quote time — no rate, term or down payment applied.">${aed(r.vehicle_value_aed)}</span>`
        : isNoTradeIn(r.equity_status)
          ? '<span class="t-muted" title="This customer had no trade-in, so there is no vehicle to value. The blank is the answer.">no trade-in</span>'
          : absent('unpriced', 'This quote records no trade-in value and is not marked as a no-trade-in quote either. The rep entered none, or the row was written without one.')) },
      { label: 'Payoff', align: 'r', render: r => (n0(r.loan_payoff_aed) != null
        ? `<span title="As entered by the rep at quote time — the loan outstanding on the trade-in.">${aed(r.loan_payoff_aed)}</span>`
        : isNoTradeIn(r.equity_status)
          ? '<span class="t-muted" title="This customer had no trade-in, so there is no loan on one to settle. The blank is the answer.">no trade-in</span>'
          : absent('unpriced', 'This quote records no payoff. A trade-in owned outright is written as 0 by the workflow, so an empty column here is an absent figure and not a settled loan.')) },
      { label: 'Equity', align: 'r', render: r => (isNoTradeIn(r.equity_status)
        ? '<span class="t-muted" title="This customer had no trade-in, so there is no equity to have. The blank is the answer, not a missing figure.">no trade-in</span>'
        : `<span class="${eqClass(r.equity_status)}" title="Vehicle value less the outstanding payoff, as the workflow returned it.">${aed(r.equity_aed)}</span>`) },
      /* Headed for what the column IS, not for what its name suggests. The
         workflow computes loan_to_value_pct as loanPayoffAmount ÷ vehicleValue
         — the payoff on the TRADE-IN over the trade-in's value — so it says how
         far underwater the old car is. It is not a loan-to-value on the
         purchase, and no column anywhere is: that would need financed_aed ÷
         vehicle_price_aed, and this desk captures no purchase price. Shown
         under "LTV" with no tooltip it was the one money cell on this screen a
         rep could read as a lending ratio and repeat as one. */
      { label: 'Payoff ÷ value', align: 'r', render: r => (n0(r.loan_to_value_pct) == null
        ? absent('unpriced', 'The workflow recorded no ratio on this quote. With no trade-in there is no payoff and no value to divide, so there is nothing to show.')
        : `<span title="${esc('The outstanding payoff on the TRADE-IN as a percentage of the trade-in’s value, as the workflow returned it (loan_to_value_pct). '
            + 'Above 100% the customer owes more than the old car is worth, which is the Negative equity column beside it. '
            + 'This is NOT a loan to value on the car being bought — that would be financed_aed ÷ vehicle_price_aed, and this desk captures no purchase price.')}">${pct(r.loan_to_value_pct)}</span>`) },
      /* `finance_tier` is the legacy column name — the workflow has written the
         AECB credit band into it since 30 Aug 2026 and the column was never
         renamed, so it is read under the old name and shown under the new one. */
      { label: 'Credit band', render: r => (r.finance_tier ? `<span class="chip">${esc(r.finance_tier)}</span>` : '<span class="t-muted">—</span>') },
      { label: 'APR reducing', align: 'r', render: r => {
        const rate = aprOf(r);
        /* The rate is the figure every other figure on this row rests on, so
           its absence is named rather than dashed. `indicative_apr_pct` is NOT
           NULL on the table, so a row reaching this branch was written by
           something other than the calculator — which is worth saying, not
           worth hiding behind the same glyph as a missing instalment. */
        if (rate.low == null) {
          return absent('unpriced', 'This quote records no APR in any of the three places one can be written — the indicative_apr_pct column, the disclaimer prefix, or a live response. '
            + 'The column is NOT NULL on finance_quotes, so this row did not come from the calculator. Nothing on it should be repeated to a customer until that is explained.');
        }
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
    /* Counted, not assumed. Whether this screen can answer "what is the monthly
       payment" is a fact about how many rows carry one, and it moves between
       the two columns below on its own as the calculator starts writing them. */
    const priced = rows.filter(r => n0(r.monthly_payment_low_aed) != null).length;

    const can = [
      ['What was quoted, to whom, and by whom',
        `Every row of finance_quotes, newest first, with the customer's name, their number from the lead record and the rep in quoted_by. ${basisLine} read here.`],
      ['What the workflow returned on each one',
        'Equity, equity status, the payoff-to-value ratio, the credit band and the indicative APR range are read off the row exactly as Finance Calc returned them, and are never recomputed on this screen. '
        + 'The APR is shown as the range it was quoted at, recovered from the row\u2019s disclaimer, because the column beside it stores only the low end.'],
      priced
        ? ['What the monthly instalment is',
          `Read off monthly_payment_low_aed and monthly_payment_high_aed on ${num(priced)} of the ${num(nQ)} ${plural(nQ, 'quote', 'quotes')} here, with the tenure, `
          + 'the amount financed, the deposit and the total cost of credit the calculator stored beside them. Nothing about a payment is worked out in this browser: '
          + 'until 31 Aug 2026 it was, and what it amortised was the payoff on the trade-in rather than the loan on the car being bought.']
        : null,
      ['Which quotes have a problem worth a phone call',
        'The checks in the strip above — a quote with no email, a quote whose customer has gone cold, a customer filed under more than one name, a quote old enough to re-run.'],
      ['What the workflow has refused, and why',
        'The runs finance-calc recorded in audit_log that left no quote behind, each with the reason it gave, split by lib/health.js into a figure the validator declined by design and a run that went through and produced nothing usable. Listed on this screen rather than left in n8n.'],
    ].filter(Boolean);

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
      ['What is our average APR, and our average payoff-to-value ratio?',
        enough
          ? null
          : `Withdrawn from the strip on 24 Aug for the same reason. ${nQ ? 'Both are still on every row of the table below, where they are what the workflow returned for that one customer — which is all they have ever been.' : 'Both reappear as soon as there are quotes from enough different customers for a mean to describe the desk rather than a person.'}`],
      ['What is the monthly payment on the rest of these quotes?',
        priced >= nQ
          ? null
          : `${nQ ? `${num(nQ - priced)} of the ${num(nQ)} ${plural(nQ, 'quote', 'quotes')} here ${plural(nQ - priced, 'carries', 'carry')} no monthly_payment_low_aed` : 'No quote on this desk carries a monthly_payment_low_aed'}, so no payment is shown against `
          + `${nQ - priced === 1 ? 'it' : 'them'} and none is worked out here. The column exists and is empty rather than absent: the deployed calculator writes 13 of the 34 columns on finance_quotes `
          + 'and none of the instalment ones, and it cannot price a payment at all without the price of the car being BOUGHT — which this desk has no field for. '
          + 'It would take vehicle_price_aed on the quote request and the newer calculator deployed. Each row says which of the two it is; hover the Monthly cell.'],
      ['What is our loan to value on a car we are selling?',
        'Not answerable, and the column named LTV is not it. finance_quotes.loan_to_value_pct is the payoff on the customer’s TRADE-IN over that trade-in’s value — how far underwater the old car is. '
        + `A real purchase LTV is financed_aed ÷ vehicle_price_aed, and while vehicle_price_aed exists it is never populated from this desk. The ${MAX_LTV_PCT_CBUAE}% CBUAE ceiling therefore has nothing on this screen to be `
        + 'compared against: max_ltv_pct and ltv_policy_source on the row carry the ceiling the calculator actually enforced, per quote.'],
      ['What share of quotes turns into a sale?',
        'Not answerable at any n. finance_quotes records no outcome — there is no accepted, declined, sold or lapsed column — and purchase_history carries no link back to a quote or to an inventory unit. Nothing in the database joins a quote to what happened next. It would take an outcome column on finance_quotes, written when the deal closes.'],
      ['What is in the finance pipeline?',
        'There is no pipeline here to show. A quote carries no stage, no expected close date and no outcome, so a row in this table is a number that was said out loud once — not a deal in progress. Treating the sum of these values as a pipeline would count the same trade-in three times.'],
      ['Which quotes have expired?',
        'Not answerable. finance_quotes stores no validity date under any name \u2014 that one absence is real, unlike the two this panel used to bundle with it. Nothing on the row records when a quote stops standing, so no quote on this screen is ever marked expired; the alerts say "more than ' + num(QUOTE_VALID_DAYS) + ' days old", which is a fact about the row and this desk\u2019s own prompt to re-quote.'],
      /* Added 1 Sep 2026, on the back of the strip learning to name quotes that
         audit_log records and this table does not hold. The obvious next
         question a rep or an engineer asks is "which run was that, then?", and
         the honest answer is that this dashboard cannot get there — which is
         worth stating with the missing column named, because that is what makes
         it fixable rather than just annoying. */
      ['Which n8n execution produced a given quote?',
        'Not answerable from this dashboard. finance_quotes carries calculation_id and execution_id on every row and audit_log carries neither, '
        + 'so the table that says a quote was ISSUED and the table that would say what it CONTAINED have no key in common. '
        + 'For a quote that landed the row names its own execution; for one that did not — which is every quote on this desk today — the only route left is matching the run’s logged time against the execution list in n8n by hand. '
        + 'It would take an execution_id column on audit_log, written by the same Delivery Report that already puts the number in the summary text on newer rows.'],
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

  /* ── The five checks this screen makes ───────────────────────────────────
     All five run on rows already fetched for the table and the lead picker — no
     read exists on this screen to feed an alert. Each states the denominator it
     counted against, and each one whose input is missing or truncated is
     withheld and named rather than reported as zero.

     There were six until 31 Aug 2026. The one that went was a CRITICAL claiming
     a STORED monthly payment disagreed with this browser's own arithmetic — the
     note above `out2` says why it was removed rather than repaired.

     The last of the five arrived with round 4 and is the one this dataset made
     visible: the same email under two different names. It is a data-quality
     fault, not a desk fault, which is exactly why nothing else on the screen
     would have shown it — the table renders whatever name each row carries and
     looks perfectly consistent doing so. */
  function buildChecks() {
    const now = Date.now();
    const quotesCapped = rows.length >= HISTORY_LIMIT;
    /* `leadsCapped` is now set once in loadLeads() and read here rather than
       recomputed. It used to be local to this function, which is why phoneCell
       — the other place that turns "not in the read" into a statement about the
       customer — went on asserting the database held no such lead. One flag,
       one meaning, both call sites. */
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
    /* There was a CRITICAL check here reading "N quotes have a stored monthly
       payment that does not match its own figures", which compared
       monthly_payment_* against an instalment this browser amortised and told
       the rep, in the drawer, not to repeat EITHER number. It has been removed
       rather than repaired. It had no standing: the stored figure is the
       authoritative one and a browser-side model is not entitled to contradict
       it. It was also permanently dead — it was gated on a column name that
       never existed — and had the names been corrected without removing the
       model, it would have amortised the trade-in payoff and raised CRITICAL on
       essentially every row, burying the five checks that are real.

       Nothing replaces it here. A cross-check between monthly_payment_low_aed
       and financed_aed, tenure_months and indicative_apr_*_pct is worth having,
       but it is a check between four columns the calculator wrote and it
       belongs inside the calculator, where the rounding and day-count
       conventions that decide it are known. DRIFT_AED and DRIFT_PCT went with
       it; they were the tolerance on a comparison that should never have been
       made in a browser. */

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
        /* Deliberately not "expired". finance_quotes has no validity column
           under any name — that one absence is real, and the two this comment
           used to bundle with it (no term, no monthly payment) were not — so
           nothing in the database knows when a quote stops standing and this
           screen must not imply that it does.
           Age is a fact about the row; expiry would be a status invented here
           and repeated to a customer as if the system had said it. */
        title: cols2.valid
          ? `${num(stale.length)} ${plural(stale.length, 'quote is', 'quotes are')} past the validity date on ${plural(stale.length, 'its', 'their')} row`
          : `${num(stale.length)} ${plural(stale.length, 'quote is', 'quotes are')} more than ${num(QUOTE_VALID_DAYS)} days old`,
        detail: (cols2.valid
            ? `${num(stale.length)} of the ${num(rows.length)} ${plural(rows.length, 'quote', 'quotes')} read here ${plural(stale.length, 'is', 'are')} past the validity date on the row (${cols2.valid}).`
            : `${num(stale.length)} of the ${num(rows.length)} ${plural(rows.length, 'quote', 'quotes')} read here ${plural(stale.length, 'was', 'were')} quoted more than ${num(QUOTE_VALID_DAYS)} days ago. `
              + `No quote here is marked expired and none can be: finance_quotes stores no validity date under any name, so nothing on the row records when it stops standing. `
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
      /* Counted, not asserted. This used to read "none of the quotes carries a
         stored monthly payment" on the strength of a probe for column names
         that were never real, which made a false statement about the schema the
         justification for computing the figure here instead. */
      rows.length && rows.every(q => n0(q.monthly_payment_low_aed) == null)
        ? 'No quote read here carries a monthly_payment_low_aed, so no monthly payment is shown against any of them. The column exists and is empty — it is not missing — and nothing is worked out in its place.'
        : '',
      rows.length && !cols2.valid
        ? `finance_quotes carries no validity date under any name. No quote on this screen can be marked expired, and none is: the age check reads "more than ${num(QUOTE_VALID_DAYS)} days old", which is this desk's prompt to re-quote rather than a status the row carries.`
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

    /* ── Quoted, and nothing on this desk to show for it ───────────────────
       `lostRow` below names the losses the WRITER noticed. This one names the
       ones it did not. A run whose summary says "Quote issued" and whose
       customer has no quote in finance_quotes is a figure that was said to a
       person and is not on this desk, and until 1 Sep 2026 the only such runs
       this screen could see were the ones that ended PARTIAL — the ones where
       the insert failed loudly enough for the writer to report it.

       On the live database that day: 8 rows say "Quote issued", 5 of them
       PARTIAL and 3 SUCCESS, and finance_quotes holds 0 rows. The strip named
       five of the eight and the other three passed as ordinary successes.

       What this row is careful NOT to say. It does not say the write failed.
       A row written and later deleted is indistinguishable from a row never
       written when all you can read is the table it is missing from, and this
       screen has no way to tell those apart — so it states the two facts it
       holds (audit_log says a quote was issued; this desk has no quote for that
       person) and names both readings rather than picking the dramatic one.

       Gated on the quote read having SUCCEEDED. With `rows` empty because the
       read failed, every issued quote in audit_log would look unrecorded and
       this row would announce a catastrophe made entirely of its own failure. */
    const lostSet = new Set(lost || []);
    const orphanPeople = [];
    let orphanNoEmail = 0;
    if (issued && !quotesErr) {
      const by = new Map();
      for (const a of issued) {
        /* Already named above, with the writer's own reason attached. Naming it
           twice in two severities reads as two separate incidents. */
        if (lostSet.has(a)) continue;
        const email = str(a.lead_email);
        const k = lower(email);
        /* This desk holds at least one quote for this person. Whether it is
           THIS quote is not knowable — audit_log carries no calculation_id and
           no execution_id, so there is nothing to join on — and a person with
           quotes on the desk is not the alarming case, so it is left alone. */
        if (k && people.has(k)) continue;
        const bk = k || `no-email:${lower(str(a.lead_name))}:${by.size}`;
        if (!k) orphanNoEmail += 1;
        if (!by.has(bk)) by.set(bk, { name: str(a.lead_name), email, n: 0, last: a.logged_at });
        const p = by.get(bk);
        p.n += 1;
        if (new Date(a.logged_at) > new Date(p.last)) p.last = a.logged_at;
      }
      orphanPeople.push(...by.values());
    }
    const orphanRuns = orphanPeople.reduce((s, p) => s + p.n, 0);
    /* Two alert rows about the same man read as two customers, and on the live
       data that is exactly what they are: all five confirmed losses and all
       three quiet ones carry lead_email shabbir53ujjainwala@gmail.com under
       three spellings of his name ("Shabbir Ujjainwala", "ALI ASGHER UJJAIN
       WALA", "Ali"). Eight quotes, one person, and a strip that let a reader
       add 5 and 3 and get eight customers would be repeating on this panel the
       precise error the rest of this screen exists to stop. */
    const lostEmails = new Set((lost || []).map(a => lower(str(a.lead_email))).filter(Boolean));
    const sharedWithLost = orphanPeople.filter(p => lostEmails.has(lower(p.email))).length;
    /* The honest empty case, which today is the only case: a sentence naming
       what was checked and what came back, so "no alerts" reads as a result
       rather than as a panel that failed to load. */
    const checked = [
      cols2.valid
        ? 'no quote is past the validity date on its row'
        : `no quote is more than ${num(QUOTE_VALID_DAYS)} days old`,
      'every quote carries a customer email',
      'no customer is recorded under more than one name',
      leads && !leadsCapped ? 'every quote matches a lead record' : '',
      leads ? 'no quote belongs to a lead that has gone cold' : '',
      /* The only entry here drawn from something other than finance_quotes, and
         the only one that stays true when the table is empty. Gated on the read
         having returned NONE, not merely on it having succeeded: this list is
         the all-clear's evidence, and an entry that would be false the moment a
         quote went missing does not belong in it.

         Both halves of the question, because until 1 Sep 2026 it only asked the
         easier one. `lost` is the workflow reporting its own write failing;
         `orphanRuns` is a run that claimed a quote and reported everything
         landed, for a customer this desk holds no quote for. On the live data
         that day the first was 5 and the second 3, and this sentence would have
         been printed over the three. */
      lost && !lost.length && issued && !orphanRuns
        ? 'no quote was issued to a customer this desk holds no record for'
        : '',
    ].filter(Boolean);
    /* Built as a sentence, not a comma salad: this line is the whole claim the
       panel is making on a day with no alerts, and it has to read like one. */
    const checkedText = checked.length > 1
      ? `${checked.slice(0, -1).join(', ')} and ${checked[checked.length - 1]}`
      : checked.join('');
    /* ── The quotes that never reached the table ──────────────────────────
       Rendered before every other row in the strip and never as a filter: the
       whole point of these is that there is no quote in the history to filter
       to. That is also why they cannot be one of the checks above, all of which
       are `.filter(c => c.quotes.length)` and take their evidence from rows
       this screen read out of finance_quotes.

       Severity is stated as CRITICAL and meant as it: a rep who does not know a
       figure was already given to this customer will either quote a second one
       or start the conversation from nothing, and the customer heard the first. */
    /* One person, five times — not five customers, and the difference decides
       what this row is allowed to look like. All five rows carry lead_email
       shabbir53ujjainwala@gmail.com and lead_name "Ali" (measured 1 Sep 2026),
       and three name chips followed by "+2 more" reads at a glance as five
       different people with five lost quotes. It is one man with five, which is
       a smaller problem for the dealership and a bigger one for him.

       So the identities are counted before anything is printed, the headline
       counts PEOPLE as well as quotes, and each chip carries how many runs sit
       behind it. Grouped by email, because that is what finance_quotes
       identifies a customer by and what the rest of this screen groups on; a
       row with no email is its own bucket rather than being folded into
       somebody else's, which would undercount the people. */
    const lostPeople = [];
    if (lost && lost.length) {
      const by = new Map();
      for (const a of lost) {
        const email = str(a.lead_email);
        const k = lower(email) || `no-email:${lower(str(a.lead_name))}:${by.size}`;
        if (!by.has(k)) by.set(k, { name: str(a.lead_name), email, n: 0, last: a.logged_at });
        const p = by.get(k);
        p.n += 1;
        if (new Date(a.logged_at) > new Date(p.last)) p.last = a.logged_at;
      }
      lostPeople.push(...by.values());
    }
    const lostRow = (lost && lost.length) ? `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined t-hot" style="font-size:20px">report</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${pill('CRITICAL', sevTone('CRITICAL'))}${esc(`${num(lost.length)} ${plural(lost.length, 'quote was', 'quotes were')} issued and never recorded, to ${
            lostPeople.length === 1 ? 'one customer' : `${num(lostPeople.length)} customers`}`)}
        </div>
        <div class="cell-sub">${esc(
          `Finance Calc logged ${plural(lost.length, 'this run', 'these runs')} as having quoted the customer while the finance_quotes row it claimed to write did not land. `
          + `The ${plural(lost.length, 'quote is', 'quotes are')} therefore NOT in the history below and cannot be — that absence is the fault itself, not a filter. `
          + `A rate was said out loud to the ${plural(lostPeople.length, 'person', 'people')} named here and this desk has no record of what it was. `
          + (lostPeople.length === 1 && lost.length > 1
            ? `All ${num(lost.length)} belong to the same customer, so this is one conversation that has been re-priced ${num(lost.length)} times with nothing kept — not ${num(lost.length)} customers each missing one. `
            : '')
          + 'Read the conversation before quoting them again: a second, different figure is how one lost row becomes a dispute.')}</div>
        <div class="cell-sub" style="margin-top:4px">${lostPeople.slice(0, PREVIEW).map(p => `<span class="chip">${
          personName(p.name, esc(p.email || 'Unnamed customer'))}${
          p.email && p.name ? ` <span class="t-muted">·</span> ${esc(p.email)}` : ''} <span class="t-muted">·</span> ${
          esc(`${num(p.n)} ${plural(p.n, 'quote', 'quotes')}`)} <span class="t-muted">·</span> ${esc(`last ${ago(p.last)}`)}</span>`).join(' ')}${
          lostPeople.length > PREVIEW ? ` <span class="t-muted">+${num(lostPeople.length - PREVIEW)} more</span>` : ''}</div>
        <div class="cell-sub t-muted" style="margin-top:4px;white-space:normal">${esc(
          /* This sentence used to state what the status on these rows is. It no
             longer does, and not for tidiness: the row spelling is the writers’
             to change, health.js already reads PARTIAL and FAILED-with-the-phrase
             to the same verdict, and a caption that named the spelling would go
             stale the first time a writer was corrected without a soul noticing.
             What the reader needs is which module decided, not which word the
             row happened to carry. */
          'Classified by lib/health.js, which mirrors nexus_outcome_class() in the database, and not by the status on the row — this screen never reads that column itself: '
          + 'a run that quoted a customer and lost the record went out half-done rather than failing, and one module decides that for the whole dashboard. '
          + 'These are what make Finance Calc DEGRADED on the automation screen — the same rows, counted rather than named.')}</div>
      </div>
    </div>` : '';

    const orphanRow = orphanRuns ? `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined t-hot" style="font-size:20px">receipt_long</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${pill('HIGH', sevTone('HIGH'))}${esc(`${num(orphanRuns)} ${plural(orphanRuns, 'quote was', 'quotes were')} issued that this desk holds no record of, to ${
            orphanPeople.length === 1 ? 'one customer' : `${num(orphanPeople.length)} customers`}`)}
        </div>
        <div class="cell-sub">${esc(
          `Finance Calc's own summary on ${plural(orphanRuns, 'this run', 'these runs')} says a quote was issued, and the run reported every step it claimed as landed — `
          + `it is not among the ${plural((lost || []).length, 'loss', 'losses')} named above, where the workflow itself reported the record failing to save. `
          + `finance_quotes carries no quote for ${plural(orphanPeople.length, 'this person', 'these people')} at all.`
          + (sharedWithLost
            ? ` ${sharedWithLost === orphanPeople.length && orphanPeople.length === 1
                ? 'This is the SAME customer as the row above, not another one'
                : `${num(sharedWithLost)} of ${plural(orphanPeople.length, 'this person', 'these people')} also ${plural(sharedWithLost, 'appears', 'appear')} in the row above`} — `
              + `add the two counts for a total of quotes, never for a count of customers.`
            : ''))}</div>
        <div class="cell-sub" style="margin-top:4px">${orphanPeople.slice(0, PREVIEW).map(p => `<span class="chip">${
          personName(p.name, esc(p.email || 'Unnamed customer'))}${
          p.email && p.name ? ` <span class="t-muted">·</span> ${esc(p.email)}` : ''} <span class="t-muted">·</span> ${
          esc(`${num(p.n)} ${plural(p.n, 'quote', 'quotes')}`)} <span class="t-muted">·</span> ${
          esc(`last ${ago(p.last)}`)}</span>`).join(' ')}${
          orphanPeople.length > PREVIEW ? ` <span class="t-muted">+${num(orphanPeople.length - PREVIEW)} more</span>` : ''}</div>
        <div class="cell-sub t-muted" style="margin-top:4px;white-space:normal">${esc(
          'Two readings fit this equally and this screen cannot choose between them, so it states both: the row never landed and nothing noticed, or it landed and was deleted afterwards. '
          + 'audit_log carries no calculation_id and no execution_id, and finance_quotes carries both — so there is nothing to join the two tables on and no way to settle it from this dashboard. '
          + 'The n8n execution for the run holds the answer; matching it by timestamp against the logged time on these rows is currently the only route to it. '
          + (orphanNoEmail
            ? `${num(orphanNoEmail)} of ${plural(orphanRuns, 'this run', 'these runs')} recorded no lead_email, so ${plural(orphanNoEmail, 'it', 'they')} could not be matched to a quote either way and ${plural(orphanNoEmail, 'is', 'are')} counted here for that reason rather than on evidence of a loss. `
            : '')
          + 'Either way a rate was said out loud to the customer and this desk does not hold it, which is the same next action: read the conversation before quoting again.')}</div>
      </div>
    </div>` : '';

    /* "Nothing needs attention" is a claim, and it may only be made when both
       halves of the strip actually reported. A failed read is not an all-clear,
       and the panel that says otherwise is worse than no panel: it is the one
       an operator stops checking.

       A failed audit_log read is now one of the ways it cannot be said. An
       all-clear drawn from finance_quotes alone is exactly the sentence this
       desk must never print: the table is EMPTY today while five quotes sit in
       audit_log as issued-and-unrecorded, and a strip reading only its own
       table would have announced all-clear over the worst state this desk has
       ever been in. */
    const clear = !attnErr && !quotesErr && !auditErr;
    const cannotSay = attnErr && quotesErr
      ? 'v_needs_attention could not be read and the quote read failed, so neither the database’s list nor this screen’s own checks could be produced. Nothing is being claimed here.'
      : attnErr
        ? `v_needs_attention could not be read, so the database’s own list for this screen is missing. `
          + (rows.length
            ? `This screen’s own checks did run, and across the ${num(rows.length)} ${plural(rows.length, 'quote', 'quotes')} read here ${checkedText} — that is those checks only, not an all-clear.`
            : 'There is no quote on the desk for this screen’s own checks to judge either, so nothing here is an all-clear.')
        : quotesErr
          ? `v_needs_attention returned no row for this screen. The quote read failed, so this screen’s own checks could not run and nothing here speaks for them.`
          /* The audit_log read is the only one of the three that can tell this
             screen a quote exists which its own table does not contain, so its
             failure is never quietly absorbed into an all-clear. */
          : `audit_log could not be read (${auditErr?.message}), so whether any quote was issued to a customer without its finance_quotes row landing is unknown. `
            + 'Everything else this screen checks did run; that is not the same as nothing being wrong.';
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
               empty table is how a panel starts lying quietly. The audit_log
               check is the exception and is stated separately: it is the one
               that has something to say about an empty table, because it reads
               what the workflow did rather than what it managed to store. */
            : 'v_needs_attention returned no row for this screen, and there is no quote on the desk for this screen’s own checks to judge.'
              /* Reached only when BOTH halves came back empty — the strip
                 prints a row instead of this sentence otherwise — so it is
                 allowed to say the stronger thing: not merely that no write was
                 reported failing, but that no run claims to have quoted anybody
                 this desk cannot show. */
              + (lost && issued
                ? ` audit_log records no quote issued that this desk holds no record for, across ${num((audit || []).length)} ${plural((audit || []).length, 'run', 'runs')} read under this workflow — so the empty table is an empty desk and not a lost one.`
                : ''))
          : esc(cannotSay)}</div>
      </div>
    </div>`;

    const notesRow = built.notes.length ? `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
      <div class="cell-sub" style="white-space:normal">${built.notes.map(esc).join('<br>')}</div>
    </div>` : '';

    /* `lostRow` and `orphanRow` each count as an item, so a strip carrying
       either never also prints the all-clear beneath it. They lead, because
       they are the only rows here about a quote that is not in the table below.
       lostRow first: it is the case the workflow itself confirmed. */
    body.innerHTML = (viewItems.length || checks.length || lostRow || orphanRow
      ? lostRow + orphanRow + viewRows + checkRows
      : nothing) + notesRow;

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
    cols2 = { valid: pickCol(rows, VALID_COLS) };
    basisCache.clear();
  }

  async function loadLeads() {
    try {
      leads = await db('leads?select=id,name,email,phone,vehicle_interest,budget_aed,status'
        + `&order=created_at.desc&limit=${LEAD_LIMIT}`);
      leadsErr = null;
    } catch (e) { leads = null; leadsErr = e; }
    /* A truncated leads read cannot support the sentence "no lead carries this
       email" — it can only support "no lead in the newest LEAD_LIMIT does". The
       checks list already refused to claim the first from the second; phoneCell
       did not, and said "—" under a tooltip asserting the database held nobody.
       3 leads exist today so the cap is nowhere near, which is exactly when a
       claim like that gets written and then stays wrong quietly. */
    leadsCapped = !!leads && leads.length >= LEAD_LIMIT;
    leadByEmail.clear();
    (leads || []).forEach(l => { const k = lower(str(l.email)); if (k) leadByEmail.set(k, l); });
  }

  /* ── One read of audit_log, one interpreter ──────────────────────────────
     Everything this screen says about a workflow run comes from here, and what
     each row MEANS is lib/health.js's to decide and nothing else's — it mirrors
     public.nexus_outcome_class() one for one and is the only module in the
     dashboard permitted to read that column. Nothing below tests a status
     string, and nothing below takes a colour from one.

     The workflow filter is server-side and mirrors FINANCE_FLOW word for word,
     so this read cannot be crowded out of its limit by a busy hour on another
     workflow — which is exactly what client-side filtering after a bare `limit`
     did to the refusal panel until 1 Sep 2026 (see AUDIT_LIMIT), and which
     would show an empty panel as though nothing had been refused or lost.

     ── The quotes that were issued and never recorded ───────────────────────
     The worst thing this screen can be asked about, and until 31 Aug 2026 it
     could not be asked at all: a customer was given an APR and the record of it
     never reached the table below. Finance Calc logs each run against the steps
     it claimed to complete, and on five of them the summary reads "Quote issued
     | 1 of 1 claimed steps did not land [finance_quotes row (the quote the
     Finance Desk reads) — Bad request…]". The history cannot show these — their
     absence from it IS the fault — so the strip above says they exist and names
     the customer, because a rep who reopens that conversation needs to know a
     figure was already said out loud.

     THE STATUS ON THOSE ROWS IS `FAILED` AND THIS SCREEN DOES NOT READ IT.
     health.js reclassifies exactly this case as PARTIAL on the structured
     phrase the writer already emits, because a workflow that quoted a customer
     and lost the record did not fail: it went out half-done. Four screens each
     invented their own reading of that column and each got a different answer,
     which is why there is now one module and why this file calls it.

     That reclassification is a WRITER CORRECTION and health.js says so —
     "when the writers are fixed, delete rule 1 here and in the SQL together".
     Whether they are fixed is, on 1 Sep 2026, genuinely disputed between two
     audits run the same day: one read the published node bodies off the n8n box
     and found no FAILED rung left in either Delivery Report, the other read the
     repo JSON (last touched 30 Aug) and found the rung intact. This screen does
     not need the answer and must not assert one. outcomeOf() returns PARTIAL
     for a row spelled FAILED with the "did not land" phrase AND for a row
     spelled PARTIAL, so the panel below reads the same either way, and the day
     the correction is retired nothing here changes.

     v_workflow_health COUNTS these rows but a count cannot say whose quote was
     lost. On 1 Sep 2026 Finance Calc reads 62 runs / 5 partials / 0 failures /
     21 no-result / 33 refused, 3 successes out of 29 qualifying runs — 10.3%,
     DEGRADED. Whose five is the one question worth asking here, so the rows are
     read directly and classified through the module: the case the module's own
     header names as the right reason to do so. */
  async function loadAudit() {
    try {
      const all = await db('audit_log?select=workflow,status,lead_name,lead_email,summary,logged_at'
        + '&or=(workflow.ilike.*financ*,workflow.ilike.*quote*,workflow.ilike.*trade-in*,workflow.ilike.*calc*)'
        + `&order=logged_at.desc&limit=${AUDIT_LIMIT}`);
      audit = all.filter(a => FINANCE_FLOW.test(str(a.workflow)));
      auditCapped = all.length >= AUDIT_LIMIT;
      auditErr = null;
    } catch (e) { audit = null; auditErr = e; auditCapped = false; }
    /* Split by class, never by status. isRefusal() is health.js's own predicate
       for REJECTED_EXPECTED; NO_RESULT and PARTIAL have no predicate of their
       own because nothing else asks for them by name, so they are compared
       against the OUTCOME vocabulary rather than against a string. */
    refusals = audit && audit.filter(isRefusal);
    noResult = audit && audit.filter(a => outcomeOf(a) === OUTCOME.NO_RESULT);
    lost     = audit && audit.filter(a => outcomeOf(a) === OUTCOME.PARTIAL);
    /* Not a class — see QUOTE_ISSUED_RE. Kept beside the three that are, so the
       one place that reads audit_log is also the one place that says which rows
       claimed to have quoted somebody. */
    issued   = audit && audit.filter(a => QUOTE_ISSUED_RE.test(str(a.summary)));
  }

  /* ── The two ways a run can end with no quote, kept apart ─────────────────
     They used to be one row type on this panel with one red pill and one
     sentence saying "it is not an error", and on 1 Sep 2026 that sentence sat
     over 29 rows in a colour that flatly contradicted it. health.js draws the
     line and this panel draws it too, because the two mean different things to
     the rep and carry different weight against the workflow:

       REFUSED (REJECTED_EXPECTED) — the workflow declined the input by design.
       Nothing was priced, nothing was written, and health.js excludes it from
       every success denominator, so it cannot dilute a real miss rate. Neutral,
       and genuinely not an error. 33 rows on 1 Sep 2026.

       NO RESULT (NO_RESULT) — it ran and produced nothing usable. Not a crash,
       not a success, and NOT excused: isQualifying() is true for these, so each
       one is in the denominator behind Finance Calc's 10.3%. 21 rows on 1 Sep
       2026 — the 13 REJECTED rows whose summary carries no refusal marker, plus
       8 NOT_EXECUTED. Neutral as well, because grey is the honest colour for a
       run that achieved nothing without breaking.

     Both are neutral and that is the point: the difference between them is a
     difference in WORDS and in WEIGHT, not in alarm. Neither is red, because
     neither is a fault the rep can act on by ringing somebody; a refusal is the
     validator working, and a no-result is a run to count, not to panic about.
     The two groups are therefore separated, headed, and counted separately,
     with the no-result group saying out loud that it is in the rate.

     Why 13 REJECTED rows land in the second group and 33 in the first is worth
     knowing and is NOT re-decided here: health.js promotes a REJECTED row to
     REFUSED only when the summary says so ("refused by validation",
     "unauthorized", and so on). Finance Calc only began emitting that phrase on
     30 Aug 2026 — measured on the live rows, every no-result REJECTED row falls
     between 16 and 28 Aug and every refused-by-validation row on or after
     30 Aug. So the older rows are almost certainly the same kind of event
     wearing less evidence, and the canonical layer declines to guess. This
     screen says what is known and does not upgrade them behind its back. */
  function drawRefusals() {
    const body = $('fxBody');
    if (!body) return;
    if (auditErr) { body.innerHTML = stateError('what the workflow recorded', auditErr.message); return; }
    if (!refusals || !noResult) { body.innerHTML = stateLoading(3); return; }

    const foot = `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">info</span>
      <div class="cell-sub" style="white-space:normal">${[
        'Every verdict and every colour above comes from lib/health.js, which mirrors nexus_outcome_class() in the database. Neither is taken from the status the row carries.',
        `Matched on the workflow name, not through workflow_registry, so a run logged under a name mentioning none of finance, quote, trade-in or calc would not be listed here. Rejections belonging to other workflows are not read at all, so no count of them is offered.`,
        auditCapped ? `The read stopped at ${num(AUDIT_LIMIT)} rows, so older runs are not counted.` : '',
      ].filter(Boolean).map(esc).join('<br>')}</div></div>`;

    /* pill() in lib/format.js attaches "This dashboard has no wording for that
       status" to anything it renders in the unknown tone, unless the LABEL it
       is handed is itself a key in that file's TONE table. The canonical layer's
       labels are human words — "Refused", "No result" — and "REFUSED" is not a
       TONE key, so pill('Refused', 'unknown') produces a grey pill whose hover
       reads "this dashboard has no wording for that status" directly above two
       paragraphs of wording for it. That is the same defect the 31 Aug audit
       caught on the automation screen, which is why automation.js grows its own
       wordPill(); this is that helper, in the markup pill() emits, carrying
       health.js's own sentence as the title instead. Every other pill on this
       screen still goes through pill(), because every other pill on this screen
       is labelled with a value TONE actually knows. */
    const wordPill = (label, tone, why) =>
      `<span class="pill ${esc(tone || '')}"${why ? ` title="${esc(why)}"` : ''}><span class="dot"></span>${esc(label)}</span>`;

    const head = (title, blurb) => `<div class="toolbar" style="background:var(--surface-sunken)">
      <div class="cell-sub" style="white-space:normal;flex:1"><strong>${esc(title)}</strong> ${esc(blurb)}</div></div>`;

    const row = a => {
      const w = outcomeWords(outcomeOf(a));
      const who = str(a.lead_name) || str(a.lead_email);
      return `<div class="list-item" style="cursor:default;align-items:flex-start">
        <span class="material-symbols-outlined t-muted" style="font-size:20px" aria-hidden="true">${isRefusal(a) ? 'gpp_maybe' : 'do_not_disturb_on'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${wordPill(w.label, w.tone, w.blurb)}<span class="chip mono">${esc(str(a.workflow) || 'unnamed workflow')}</span>
            ${who ? `<span class="cell-sub">${personName(who, '')}</span>` : ''}
          </div>
          <div class="cell-sub" style="white-space:normal">${esc(str(a.summary) || 'The workflow recorded no reason on this row.')}</div>
          <div class="cell-sub t-muted">${esc(stamp(a.logged_at))} — ${esc(ago(a.logged_at))}</div>
        </div>
      </div>`;
    };

    if (!refusals.length && !noResult.length) {
      /* Not "no data", and the two cases underneath it are not the same claim.
         Zero rows of this kind out of a set that HAS rows says the workflow
         priced everything it was asked to. Zero rows out of an empty set says
         nothing at all about the workflow, and the panel must not borrow the
         first sentence to describe the second — an empty read wearing a
         reassuring title is how a panel starts lying quietly. */
      const ran = (audit || []).length;
      body.innerHTML = stateEmpty(
        ran ? 'Every run this workflow recorded produced a quote' : 'This workflow has recorded no run here',
        (ran
          ? `All ${num(ran)} ${plural(ran, 'run', 'runs')} read under a workflow name this screen recognises as the finance calculator produced a figure: none was declined by the validator, and none ran through leaving nothing usable behind. `
          : `No row in audit_log carries a workflow name this screen recognises as the finance calculator, so there is nothing here to judge and nothing is being claimed about the calculator either way. `)
        + `A row appears here when Finance Calc declines an input — a trade-in valued under ${aed(MIN_VEHICLE_VALUE)}, or a quote sent with no customer email — `
        + `and it is written whether the request came from this desk or from anywhere else.`,
        'gpp_good') + foot;
      return;
    }

    /* Refusals first: the panel sits under the form, and a rep who has just
       been declined is looking for their own reason, not for a rate statistic. */
    const refusedBlock = refusals.length
      ? head(`Declined by the workflow — ${num(refusals.length)} ${plural(refusals.length, 'run', 'runs')}.`,
          'The validator refused the figure before anything could be quoted to anybody. Nothing was priced and nothing was written to finance_quotes. '
          + 'This is the workflow working, not a failure of this dashboard, and health.js keeps these out of the workflow’s success rate entirely so a refusal cannot dilute a real miss.')
        + refusals.map(row).join('')
      : head('Nothing was declined by the workflow.',
          'No run in this read was refused by the validator. The runs below went through and produced nothing usable, which is a different thing.');

    const noResultBlock = noResult.length
      ? head(`Ran and produced nothing usable — ${num(noResult.length)} ${plural(noResult.length, 'run', 'runs')}.`,
          'Not a crash and not a refusal: the workflow completed without leaving a quote behind. '
          /* Counted, not asserted. isQualifying() is health.js's own test for
             "belongs in a rate", so the number below is the module's answer
             rather than this screen's opinion about it — and if the module ever
             stops counting one of these, the sentence stops claiming it does. */
          + `Unlike the refusals above these ARE counted against Finance Calc: ${num(noResult.filter(isQualifying).length)} of them sit in the denominator behind its success rate on the automation screen. `
          + 'Each row carries the reason the workflow gave, where it gave one.')
        + noResult.map(row).join('')
      : head('Nothing ran through without producing a quote.',
          'Every run in this read either produced a figure or was refused outright by the validator. Nothing was left in between.');

    body.innerHTML = refusedBlock + noResultBlock + foot;
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
    await Promise.all([loadAttention(), loadQuotes(), loadLeads(), loadAudit()]);
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
                /* Was a bare em dash, which read the same as every other blank
                   in this drawer. indicative_apr_pct is NOT NULL, so a row with
                   no recoverable rate did not come from the calculator. */
                ? `${absent('unpriced', 'This quote records no APR in the column, in the disclaimer prefix, or anywhere else on the row. indicative_apr_pct is NOT NULL on finance_quotes, so this row was not written by the calculator.')}`
                  + `<div class="cell-sub">${esc('Every other figure in this drawer rests on a rate. There is none on this row to rest on.')}</div>`
                : `<span class="t-warm">${pct(qRate.low)}+</span><div class="cell-sub t-warm">${esc('Lower bound only — this is the low end of the range and the high end is not recorded on the row. Not the rate.')}</div>`}</dd>
            <!-- finance_tier is the legacy column name. The workflow has
                 written the AECB credit band into it since 30 Aug 2026 and the
                 column was never renamed. -->
            <dt>Credit band</dt><dd>${esc(q.finance_tier || '—')}</dd>
            <!-- Headed for what the column is, not for its name. See the table
                 column of the same figure for the full note: this is the payoff
                 on the TRADE-IN over the trade-in's value, not a loan to value
                 on the car being bought. It was headed "Loan to value" here and
                 "LTV" in the table, which is the one reading of it a rep could
                 repeat to a customer as a lending ratio. -->
            <dt>Payoff ÷ trade-in value</dt><dd class="num">${n0(q.loan_to_value_pct) == null
              ? absent('unpriced', 'The workflow recorded no ratio on this quote. With no trade-in there is no payoff and no value to divide.')
              : `${pct(q.loan_to_value_pct)}<div class="cell-sub">${esc('How much of the old car’s value is still owed on it. Not a loan to value on the purchase — no column anywhere records one.')}</div>`}</dd>
          </dl>
          <div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(
            `These four are what the Finance Calc workflow returned on ${stamp(q.created_at)} and are not recomputed here. `
            + `finance_quotes stores one APR figure and the workflow writes the LOW end of the quoted range into it; `
            + `the range above is read back out of the disclaimer, which carries both ends.`)}</div>
        </div>
        <!-- Every row of this section is one column off finance_quotes. It was
             headed "this desk's arithmetic" and it was: the Monthly was
             amortised here, "Down payment" printed the customer's TRADE-IN
             EQUITY (the same number this drawer already shows correctly two
             sections above, under Equity), and "Amount financed" printed the
             PAYOFF on the trade-in. Three wrong nouns over three figures a
             customer would repeat back. Each field is now blank independently
             when its own column is null — the three used to be gated together
             on whether a monthly figure existed, so a missing rate blanked the
             term and a missing vehicle value blanked the deposit, and nothing
             on screen said which input was the absent one. -->
        <div class="section">
          <div class="label-caps">Monthly instalment · as the calculator stored it</div>
          <dl class="kv">
            <dt>Monthly</dt><dd class="num">${b.state === 'priced'
              ? `<strong>${monthlyRange(b)}</strong>${b.monthlyRanged ? '' : '<div class="cell-sub t-warm">One figure, not a span — only monthly_payment_low_aed is stored on this row.</div>'}`
              : absent(b.state, b.why)}</dd>
            <dt>Rate</dt><dd class="num">${b.apr == null
              ? absent(b.state === 'declined' ? 'declined' : 'unpriced', b.state === 'declined'
                ? b.why
                : 'This quote records no indicative APR at all, under either the column or the disclaimer prefix.')
              : b.aprRanged
                ? `${aprRange(b.apr, b.aprHigh)}<div class="cell-sub">${esc(RATE_BASIS + ', from this quote' + (b.aprSource ? ` · ${b.aprSource}` : ''))}</div>`
                : `${pct(b.apr)}<div class="cell-sub t-warm">${esc('the LOW end of this quote’s range, ' + RATE_BASIS)}</div>`}</dd>
            <dt>Tenure</dt><dd>${b.tenure == null
              ? absent(b.state === 'declined' ? 'declined' : 'unpriced', 'tenure_months is empty on this row. No term is assumed in its place — a tenure assumed at the legal maximum flatters every monthly figure behind it.')
              : `${num(b.tenure)} months, from tenure_months on the quote`}</dd>
            <dt>Down payment</dt><dd class="num">${b.down == null
              ? absent(b.state === 'declined' ? 'declined' : 'unpriced', 'down_payment_aed is empty on this row. The deposit is the calculator’s to decide and this screen applies no default to anything.')
              : `${aed(b.down)}${b.downPct == null ? '' : ` · ${pct(b.downPct)} of the price`}<div class="cell-sub${b.downAssumed ? ' t-warm' : ''}">${esc(b.downAssumed
                  ? 'ASSUMED by the calculator — the customer did not state a deposit. Confirm it before the payment above is repeated.'
                  : 'As stated by the customer (down_payment_assumed is false).')}</div>`}</dd>
            <dt>Amount financed</dt><dd class="num">${b.financed == null
              ? absent(b.state === 'declined' ? 'declined' : 'unpriced', 'financed_aed is empty on this row. It is the loan on the car being BOUGHT and nothing on this screen can stand in for it.')
              : aed(b.financed)}</dd>
            <!-- The distinction the old "Down payment" row destroyed. Equity is
                 what the trade-in is worth net of its payoff; this is how much
                 of that equity the calculator actually put toward the new car.
                 They are different numbers and neither of them is the deposit. -->
            ${b.equityApplied == null ? '' : `<dt>Trade-in equity applied</dt><dd class="num">${aed(b.equityApplied)}<div class="cell-sub">${esc(
              'Part of the deposit above, not a separate payment. The Equity figure at the top of this drawer is what the trade-in is worth net of its payoff; this is how much of it went into this purchase.')}</div></dd>`}
            ${b.creditLow == null ? '' : `<dt>Total cost of credit</dt><dd class="num">${
              b.creditHigh == null || b.creditHigh === b.creditLow ? aed(b.creditLow) : aedRange(b.creditLow, b.creditHigh)}</dd>`}
            ${b.price == null ? '' : `<dt>Price of the car bought</dt><dd class="num">${aed(b.price)}</dd>`}
            ${b.minDown == null ? '' : `<dt>Minimum deposit allowed</dt><dd class="num">${aed(b.minDown)}<div class="cell-sub">${esc(
              (b.maxLtv == null ? '' : `${pct(b.maxLtv)} maximum LTV. `) + (b.ltvSource || 'The calculator recorded no source for this ceiling.'))}</div></dd>`}
          </dl>
          <div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(instalmentBasis(b))}</div>
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
          + 'Nothing was written to finance_quotes, so the history below is unchanged, and the workflow keeps its own record of the refusal in audit_log — it is listed under the form as soon as this screen is re-checked. '
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
    /* The same projection as the history table, over the response instead of a
       stored row — so the figure the rep reads out now and the figure in the
       history a week later are the same figure, because neither is worked out
       anywhere.

       This call used to be handed a SYNTHETIC object: the trade-in value under
       `vehicle_value_aed`, the trade-in's payoff ratio under
       `loan_to_value_pct`, and nothing else. `basis()` then amortised
       value × ltv ÷ 100 — the payoff on the old car — at the new car's rate
       over a 60-month default, and the result was printed under "Indicative
       monthly instalment" THIRTEEN LINES above where this same card prints the
       workflow's own instruction: "Do not convert to a monthly payment unless
       the customer asks and you know the vehicle price and down payment." This
       desk has never known the vehicle price; there is no field for one on the
       form above. The response is now passed through whole, so an instalment
       appears here only when the calculator returned one. */
    const b = basis(res);
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
      <!-- Headed "Loan to value" with a bar that turned red above 80 and read
           "Above 80% — most lenders will want a deposit." That advice was wrong
           for this number twice over: 80% is the CBUAE cap on a loan against
           the car being BOUGHT, and this ratio is the payoff on the car being
           TRADED IN over that car's value. A customer owing more than 80% of
           the old car's worth has a trade-in equity problem, not a lending-limit
           breach, and telling them to find a deposit does not address it. The
           bar keeps the clamp (it is a width, not a finance figure) and takes
           its colour from the equity status the workflow returned. The real
           ceiling, per quote, is max_ltv_pct with ltv_policy_source naming the
           regulation; it is shown in the drawer where the row carries it. -->
      ${ltv == null ? '' : `<div style="margin-top:16px">
        <div class="label-caps" style="margin-bottom:6px">Payoff against trade-in value · ${pct(ltv)}</div>
        <div class="bar"><i style="width:${Math.min(100, Math.max(0, ltv))}%;background:var(--${lower(res.equity_status) === 'negative' ? 'hot' : 'primary'})"></i></div>
        <div class="cell-sub" style="margin-top:6px;white-space:normal">${esc(
          'How much of the trade-in’s value is still owed on it, as the workflow returned it. This is not a loan to value on the car being bought — '
          + 'nothing in this quote records that car’s price. Above 100% the customer is underwater, which is what the Equity tile above says in dirhams.')}</div>
      </div>`}
      <div style="margin-top:16px">
        <div class="label-caps" style="margin-bottom:6px">Monthly instalment</div>
        <div class="kpi-value sm">${b.state === 'priced' ? monthlyRange(b) : absent(b.state, b.why)}</div>
        <div class="cell-sub" style="margin-top:6px;white-space:normal">${esc(instalmentBasis(b))}
          ${b.state === 'priced' ? esc(' Say it as a span, with the rate, the tenure and the deposit attached, or do not say it.') : ''}</div>
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

  await Promise.all([loadQuotes(), loadLeads(), loadAttention(), loadAudit()]);
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
