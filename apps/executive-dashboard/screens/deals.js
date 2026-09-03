/* NEXUS OS — screens/deals.js
   Closed-won revenue, and the vector memory that is supposed to be built from
   it. Two separate stories that this screen deliberately keeps separate:

     · purchase_history  — the money. Every recorded deal, what it was worth,
       and (where the columns exist) what it cost and what was made on it.
     · deals_embeddings  — what Ask AI can actually cite. It is written *only*
       by the Closed-Won workflow, never by this browser, so it can and does
       fall behind purchase_history. When it has no rows at all the screen says
       so in words; a silent zero next to a healthy revenue figure would read
       as "nothing to embed" rather than "the memory is empty".

   Recording a deal posts to n8n('deals/closed-won') via lib/deal-form.js. That
   round trip is what produces the embedding — a row written straight into
   purchase_history from here would be invisible to Ask AI forever. One write
   path, one source of truth.

   purchase_history is not in SCHEMA.md column by column, and the deployed table
   has grown columns at different times, so every money and date field is
   resolved against the keys the rows actually came back with. A figure whose
   column is absent is not estimated and not substituted — the tile says which
   column it wanted.

   24 Aug 2026 — the alert strip.

   `deals/closed-won` writes BOTH purchase_history and deals_embeddings. Until
   23 Aug it wrote only the embedding and the purchase row was silently lost:
   revenue on this screen was missing deals that Ask AI could nevertheless quote
   back. That is why the reconciliation between the two tables is the first
   thing in the strip and is stated even when it passes — a guard you can only
   see when it fires is a guard nobody notices has stopped working.

   The unit checks (no linked unit, and a unit still marked Available after its
   deal closed) need inventory, so inventory is read in the SAME wave as
   everything else rather than fetched afterwards for decoration. If it does not
   come back, those checks report as *unavailable*, never as zero — a check that
   could not run and a check that passed are opposite facts.

   There is deliberately no "sold unit with no sale date" check, because there is
   no sale date: `inventory` carries no sold_at column at all. That is stated
   once, as the schema fact it is, rather than as an alert on every row.

   The vector-coverage banners that used to sit under the KPI strip are gone:
   they are the same reconciliation, and two copies of one fact on one screen is
   how two disagreeing numbers for it end up on one screen. They live in the
   strip now, with the rows they counted one click away.

   1 Sep 2026 — the one purchase is gone too. Counted live today:

     select count(*) from purchase_history   →  0
     select count(*) from deals_embeddings   →  0
     select count(*) from finance_quotes     →  0
     select count(*) from inventory          →  12, every one of them Available

   The 24 Aug note this replaces said "one purchase, and it is a real one" and
   built the screen's caveats around n=1. Both closed-won tables are empty now,
   so that sentence had become a false live figure sitting in a comment, which
   is the thing this pass exists to stop. The caveats it motivated are kept and
   are still correct: the average-deal tile is withdrawn below two priced deals
   rather than reprinting the sale price under a second name, the month chart
   says a single bar is a value and not a trend, and the repeat-customer panel
   says one purchase cannot be repeat business rather than reporting that every
   customer is unique. At zero rows they all read as "nothing recorded", which
   is a different sentence again and is the one the screen shows today.

   The Closed-Won workflow has run twice ever — one FAILED on 17 Aug, one
   SUCCESS on 23 Aug — so an empty deals_embeddings today is not the pre-23-Aug
   regression firing again; it is a table that was emptied. The reconciliation
   in the strip is still stated in the passing case for exactly that reason.

   Two schema facts, both re-probed live today, now decide what this screen may
   claim about the car:

     · purchase_history has NO column linking a deal to an inventory unit. Its
       columns are id, deal_id, customer_name, email, phone, vehicle, amount_aed,
       purchase_date, created_at and — since 2 Sep 2026 — lead_id. `vehicle` is
       free text typed into the deal form, so which unit was sold is
       unanswerable from this side. lead_id links a deal to the PERSON, not to
       the car, and closes none of this: it is a foreign key to leads(id), and
       leads carries no inventory reference either.
     · inventory records NO sale date, and no reciprocal deal reference, so it is
       unanswerable from that side too.

   Together those two mean the sale and the stock cannot be reconciled row by
   row at all — which is why the "Mark unit sold" control is gone from the deal
   drawer when there is no link column. A disabled button implies a link that a
   fix could re-enable; there is no link, and the sentence in its place says so.
   What CAN still be said is a count against a count, and the screen says it
   whenever there is a sale to say it about: on 24 Aug that read "one sale
   recorded, not one unit marked Sold". Today there are no sales, and all 12
   units are Available, so the count check has nothing to compare and says that
   instead of reporting a clean reconciliation nobody earned.

   1 Sep 2026 — the third thing a deal cannot reach: the quote.

   A closed deal is the end of a finance conversation, and purchase_history has
   no reference to it either. There is no quote id, no calculation id, nothing.
   The only tie between a sale and the terms the customer was quoted is the
   person, so this screen matches deal to quote through lib/identity.js and says
   in words that it is matching a CUSTOMER and not following a link.

   That gap is not theoretical. Counted live today, finance_quotes holds 0 rows
   while audit_log holds five Finance Calc runs whose own summaries read
   "Quote issued | 1 of 1 claimed steps did not land [finance_quotes row (the
   quote the Finance Desk reads) — Bad request - please check your parameters]",
   the most recent at 04:03 on 31 Aug, all five for the same customer. The quote
   reached a human being; the record of it did not. So "no quote on file for
   this deal" must never be rendered as "this customer was never quoted" — this
   screen says which of the two it knows, which is the first one only.

   This screen renders NO finance figure of its own from that data, and none
   from anywhere else. There is no payment, no APR, no down payment and no
   equity anywhere in this file; the money it prints is amount_aed as stored,
   totalled, and a margin only where purchase_history carries the columns to
   subtract (it carries neither today). Finance figures belong to the Finance
   Calculator workflow and to finance_quotes, and are read on the Finance Desk. */
import { db } from '../lib/data.js';
import { dealForm } from '../lib/deal-form.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, esc, n0, num, pct, pill, tone } from '../lib/format.js';
/* One contact-matching rule for the whole product, new on 31 Aug 2026. This
   screen used to key a deal to a lead on lower(email) and nothing else, which
   is the read that shows a PARTIAL history and looks complete. Three matches on
   this screen go through it now: the phone fallback, the finance quote, and
   v_needs_attention.ref. The rule is not ours — the n8n node `Resolve Lead
   Identity` joins on the last nine digits of the phone number, so anything
   written by a workflow must be read back the same way. */
import { KEY_SHAPE, describeKey, expandIdentity, isHandle, keyShape, normalizeKey } from '../lib/identity.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, table, wireRows } from '../lib/ui.js';

/* Every read is capped, and every cap is disclosed when it is hit. A capped
   deal list that quietly claims to be lifetime revenue is the worst possible
   number on this screen; a capped vector read would mark genuinely embedded
   deals as missing, so the label changes wording when it is capped rather than
   asserting something it cannot know. The same applies to inventory: a unit
   beyond the cap is "not in the rows read", not "not in stock". */
const DEAL_LIMIT = 1000;
const VEC_LIMIT = 500;
const QUOTE_LIMIT = 500;
const LEAD_LIMIT = 1000;
const VEC_SHOWN = 50;
const INV_LIMIT = 2000;
const ATTN_LIMIT = 100;
const TREND_MONTHS = 12;
const SHOWN_REFS = 4;

/* At or below this many rows, a figure derived from them is described rather
   than presented: the count is the whole table, not a sample of it. At exactly
   one row the derived figures that are only meaningful across a population — an
   average, a monthly trend, repeat business — are withdrawn outright and say
   why, because a mean of one number is that number wearing a second label. */
const THIN = 5;

/* No endpoint re-sends one existing deal to the embedder. The Closed-Won
   webhook takes a whole deal record, not a purchase_history id, and nothing but
   that workflow may write deals_embeddings, so the honest control is a disabled
   one that says exactly what is missing.

   "Service-role only" — which this sentence used to say, and which the audit of
   31 Aug caught — is true of WRITES and not of reads. Checked against
   pg_policies today: deals_embeddings carries deals_embeddings_service_role_all
   (ALL, service_role) and deals_embeddings_authenticated_read (SELECT,
   authenticated). The second is why the read below works at all, so saying the
   table is closed to the browser contradicted the panel underneath it. */
const NO_REEMBED =
  'There is no re-embed endpoint. deals_embeddings is readable here but only the Closed-Won workflow may write it (service_role), so the browser cannot push an existing row into the vector store. Recording the deal again through "Record a deal" does re-send it, but this screen cannot pre-fill that form without a change to lib/deal-form.js.';

/* Nor is there one for the inventory side. The unit checks below can find a
   sold car still marked Available, but marking it Sold is an inventory edit and
   it belongs on the screen that owns that write path. */
const NO_UNIT_FIX =
  'This screen cannot change an inventory unit. inventory is writable from the browser, but unitForm() in lib/unit-form.js is the only writer in the product and it lives on the Inventory screen — fix the unit there so one file keeps owning that write.';

/* ── Column resolution ───────────────────────────────────────────────────── */
const CANDIDATES = {
  amount:   ['amount_aed', 'sale_price_aed', 'price_aed', 'deal_value_aed', 'total_aed'],
  cost:     ['cost_price_aed', 'cost_aed', 'vehicle_cost_aed', 'purchase_cost_aed', 'acquisition_cost_aed'],
  margin:   ['gross_margin_aed', 'margin_aed', 'gross_profit_aed', 'profit_aed', 'net_margin'],
  date:     ['purchase_date', 'closed_at', 'sold_at', 'created_at'],
  customer: ['customer_name', 'lead_name', 'name', 'full_name'],
  email:    ['email', 'lead_email', 'customer_email'],
  vehicle:  ['vehicle', 'vehicle_interest', 'vehicle_name', 'model'],
  phone:    ['phone', 'lead_phone', 'mobile'],
  /* What ties a deal to the car that left the lot. The deployed table may key
     it on the inventory row id, on the stock number or on the VIN, so whichever
     one is present is matched against all three inventory vocabularies rather
     than assuming which was meant. `vehicle` is NOT in this list: it is free
     text typed into the deal form ("Toyota Land Cruiser 2024") and matching a
     unit on it would invent a link that nobody recorded. */
  unit:     ['unit_id', 'inventory_id', 'inventory_unit_id', 'vehicle_id', 'stock_id', 'stock_number', 'vin'],
};

const str = v => String(v == null ? '' : v).trim();
const lower = v => str(v).toLowerCase();
const day10 = v => String(v ?? '').slice(0, 10);
const plural = (n, one, many) => (Number(n) === 1 ? one : many);

/* A WhatsApp handle. A LID contains no phone digits at all, so it identifies
   nobody — the deal form's Phone box accepts free text and one of these can be
   pasted into it. Rendered as a handle, in mono, and never as a phone number.
   The regex that used to live here was a fourth private copy of the one in
   lib/identity.js; isHandle and describeKey are imported from there now so that
   a handle is described in the same words on every screen. */

/* Severity colouring is tone()'s job, not this file's. It now knows CRITICAL
   and WARNING, and it maps a value it was never taught to its own 'unknown'
   tone rather than to nothing — so an unfamiliar severity from
   v_needs_attention renders as a pill somebody can see, and as one that admits
   it was not recognised, instead of as unstyled text that reads as "fine".
   'unknown' sorts where 'cold' does below, which is the correct place for a
   severity nobody can rank. This screen only decides the ORDER, which is the
   one thing tone() cannot know. */
const sevRank = s => ({ hot: 0, warm: 1, cold: 2, ok: 3 }[tone(s)] ?? 2);
const KIND_ICON = { deal_unembedded: 'psychology_alt', deal_no_unit: 'car_crash', workflow_failure: 'error' };

function resolveColumns(rows) {
  const keys = new Set();
  rows.forEach(r => Object.keys(r || {}).forEach(k => keys.add(k)));
  const out = { _keys: [...keys].sort() };
  for (const [role, list] of Object.entries(CANDIDATES)) out[role] = list.find(c => keys.has(c)) || null;
  return out;
}

/* A month bucket from a date-only column and from a timestamp are the same
   slice, and slicing is deliberate: parsing "2026-08-01" into a Date and
   reading it back locally moves a deal into July for anyone west of UTC. */
const monthOf = v => (/^\d{4}-\d{2}/.test(String(v ?? '')) ? String(v).slice(0, 7) : null);
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = m => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1] || m.slice(5, 7)} ${m.slice(0, 4)}`;
const stamp = v => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? t : null; };

const SORTS = {
  new:  'Newest close first',
  old:  'Oldest close first',
  high: 'Largest deal first',
  low:  'Smallest deal first',
  name: 'Customer A–Z',
};
const PERIODS = [['ALL', 'All time'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['365', 'Last 12 months']];

SCREENS.deals = async host => {
  const attnHost = el('div'); attnHost.style.marginBottom = '16px';
  attnHost.innerHTML = `<div class="card flush">${stateLoading(2)}</div>`;
  host.appendChild(attnHost);

  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const banners = el('div'); banners.style.marginTop = '16px'; host.appendChild(banners);

  const mid = el('div', 'grid g2 top'); mid.style.marginTop = '16px'; host.appendChild(mid);
  const trendCard = el('div', 'card'); trendCard.innerHTML = stateLoading(5); mid.appendChild(trendCard);
  const repeatCard = el('div', 'card flush'); repeatCard.innerHTML = stateLoading(5); mid.appendChild(repeatCard);

  const listCard = el('div', 'card flush'); listCard.style.marginTop = '16px';
  listCard.innerHTML = stateLoading(8); host.appendChild(listCard);
  const vecCard = el('div', 'card flush'); vecCard.style.marginTop = '16px';
  vecCard.innerHTML = stateLoading(4); host.appendChild(vecCard);

  /* allSettled, not catch(() => []). "The vector store is empty" and "the
     vector store could not be read" are opposite answers on this screen, and a
     swallowed error turns the second into the first. The same reasoning now
     covers inventory, v_needs_attention and finance_quotes: six reads, six
     separate verdicts, one wave — the strip costs no extra round-trip. */

  /* Set to false only if the ordered read below is rejected and the unordered
     one is used instead. It changes what the cap may be CALLED: 1,000 rows
     ordered by purchase_date really are the most recent, and 1,000 rows in
     whatever order Postgres returned them are an arbitrary thousand. Sorting
     them in the browser afterwards fixes the display order and cannot recover
     the 1,001st row, so the label has to move even though the table does not. */
  let dealsOrdered = true;
  const [dealsR, vecR, leadsR, attnR, invR, quoteR] = await Promise.allSettled([
    /* purchase_date is the close date on the deployed table, but it is not
       guaranteed by SCHEMA.md — if ordering on it is rejected, read the table
       unordered and sort in the browser, which this screen does anyway.

       A session that has expired is NOT a reason to retry. lib/data.js latches
       the end of a session and re-renders the login screen once no matter how
       many parallel reads discover it; re-issuing here would send a second
       doomed request and could only ever produce the same error twice. */
    db(`purchase_history?select=*&order=purchase_date.desc&limit=${DEAL_LIMIT}`)
      .catch(e => {
        if (/session expired/i.test(e?.message || '')) throw e;
        dealsOrdered = false;
        return db(`purchase_history?select=*&limit=${DEAL_LIMIT}`);
      }),
    db(`deals_embeddings?select=id,deal_id,content,created_at&order=created_at.desc&limit=${VEC_LIMIT}`),
    db('leads?select=id,name,email,phone,vehicle_interest,budget_aed,status&order=created_at.desc'
      + `&limit=${LEAD_LIMIT}`),
    db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen'
      + `&screen=eq.deals&order=at.desc&limit=${ATTN_LIMIT}`),
    /* Columns verified against the live table on 24 Aug 2026, NOT against
       SCHEMA.md — the doc lists stock_id, make, year, colour and sold_at, and
       none of the five exist. Asking for one returns PostgREST 42703, which
       rejects the WHOLE query rather than the offending field, so a single
       stale column name here would silently turn every unit check below into
       "inventory could not be read" forever. `id` IS the stock number. */
    db(`inventory?select=id,model,vin,status,acquired_at,days_in_stock&limit=${INV_LIMIT}`),
    /* The quote behind the sale. Deliberately NO money columns: the figures a
       quote carries — payment, APR, down payment, equity — are the Finance
       Calculator's output and they are read on the Finance Desk, which is the
       screen that owns them. Two screens printing one monthly payment is how
       two different monthly payments end up on two screens. What this screen
       needs is whether a record of the quote exists at all, and when.
       finance_quotes_authenticated_read (SELECT, authenticated) is what makes
       this readable from the browser; only the workflow may write it. */
    db('finance_quotes?select=id,lead_email,lead_name,created_at,calculated_at,source,quoted_by'
      + `&order=created_at.desc&limit=${QUOTE_LIMIT}`),
  ]);

  const deals    = dealsR.status === 'fulfilled' ? dealsR.value : null;
  const dealsErr = dealsR.status === 'rejected' ? (dealsR.reason?.message || 'Unknown error') : null;
  const vectors  = vecR.status === 'fulfilled' ? vecR.value : null;
  const vecErr   = vecR.status === 'rejected' ? (vecR.reason?.message || 'Unknown error') : null;
  const leads    = leadsR.status === 'fulfilled' ? leadsR.value : null;
  const leadsErr = leadsR.status === 'rejected' ? (leadsR.reason?.message || 'Unknown error') : null;
  const viewRows = attnR.status === 'fulfilled' ? attnR.value : null;
  const viewErr  = attnR.status === 'rejected' ? (attnR.reason?.message || 'Unknown error') : null;
  const inv      = invR.status === 'fulfilled' ? invR.value : null;
  const invErr   = invR.status === 'rejected' ? (invR.reason?.message || 'Unknown error') : null;
  const quotes   = quoteR.status === 'fulfilled' ? quoteR.value : null;
  const quoteErr = quoteR.status === 'rejected' ? (quoteR.reason?.message || 'Unknown error') : null;

  const col = resolveColumns(deals || []);
  const get  = (row, role) => (col[role] ? row[col[role]] : null);
  const amountOf = row => (col.amount ? n0(row[col.amount]) : null);
  const dateOf   = row => (col.date ? row[col.date] : null);
  const nameOf   = row => get(row, 'customer');
  const emailOf  = row => get(row, 'email');

  /* ── Identity ─────────────────────────────────────────────────────────────
     Every place this screen names a person it must show their phone number too,
     and show the absence as an absence. purchase_history carries its own phone
     column and that is always preferred — the deal is the record of what the
     customer gave us at the sale. A leads row for the same person is a fallback
     for a deal whose phone is null, and it is a different provenance, so it is
     labelled rather than blended in. If the leads read failed there is no
     fallback and the dash says why, instead of implying the customer has no
     number on file.

     31 Aug 2026 — "the same person" is no longer "lower(email) is equal".

     purchase_history.email and leads.email are the same free-text column family
     as communication_logs.lead_email, which holds four incompatible key shapes
     for one human being: a real address, `<digits>@c.us`, `<digits>@lid` and
     `+<digits>@whatsapp.lead`. Lead 38 is already filed under three of them. A
     deal recorded by anything other than this dashboard's own form can carry a
     WhatsApp address in its email column, and an equality test on the lowered
     string then finds no lead, prints "—", and the operator reads that as "this
     customer has no number" — which is the failure mode that looks complete.

     lib/identity.js is the shared rule, and the rule is not ours: the n8n node
     `Resolve Lead Identity` joins a chat to a lead on the LAST NINE DIGITS of
     the phone and nothing else, so every key in these columns was written under
     that rule and must be read back under it. A LID is never treated as a
     phone — its digits are a machine id. */
  const identityCache = new Map();
  const identityOf = row => {
    if (identityCache.has(row)) return identityCache.get(row);
    /* The phone goes in as a KEY rather than as `phone`, because `phone` only
       accepts a value that reads as a number and would silently drop a LID
       pasted into the deal form's Phone box. As a key it survives, and is
       compared as the opaque handle it is. */
    const id = expandIdentity({ email: emailOf(row), keys: [get(row, 'phone')].filter(Boolean) });
    identityCache.set(row, id);
    return id;
  };
  const canonicalsOf = id =>
    (id.keys || []).map(k => normalizeKey(k).canonical).filter(Boolean);

  /* canonical key -> the leads filed under it. A list, not a single lead: two
     different people whose numbers end in the same nine digits is a real
     possibility, and identity.js reports that rather than merging them. So must
     this — a phone shown against the wrong customer is worse than no phone. */
  const leadsByKey = new Map();
  (leads || []).forEach(l => {
    const id = expandIdentity({ leadId: l.id, email: l.email, keys: [l.phone].filter(Boolean) });
    if (!id.ok) return;
    new Set(canonicalsOf(id)).forEach(c => {
      const bucket = leadsByKey.get(c) || [];
      if (!bucket.includes(l)) bucket.push(l);
      leadsByKey.set(c, bucket);
    });
  });

  /* Every lead this deal's own recorded keys reach, and how. `basis` is kept
     because "matched on the email address" and "matched on the last nine digits
     of a phone number" are different degrees of confidence and the second one
     is the one that can be wrong. */
  const leadMatch = row => {
    const id = identityOf(row);
    if (!id.ok) return { hits: [], basis: '' };
    const hits = [];
    let basis = '';
    canonicalsOf(id).forEach(c => {
      (leadsByKey.get(c) || []).forEach(l => {
        if (!hits.includes(l)) hits.push(l);
        if (!basis) basis = c.startsWith('email:') ? 'the email address on both records'
          : c.startsWith('phone:') ? 'the last nine digits of the phone number, the rule the workflows join on'
          : c.startsWith('lid:') ? 'the same WhatsApp LID on both records'
          : 'an exact key match';
      });
    });
    return { hits, basis };
  };

  const phoneInfo = row => {
    const own = str(get(row, 'phone'));
    if (own) return { value: own, from: 'deal', handle: isHandle(own) };
    const { hits, basis } = leadMatch(row);
    /* One lead, or none. Two leads reachable from one deal is the suffix
       collision identity.js exists to report, and picking either number would
       be a coin toss printed as a fact. */
    if (hits.length === 1 && str(hits[0].phone)) {
      return { value: str(hits[0].phone), from: 'lead', basis, handle: isHandle(hits[0].phone) };
    }
    if (hits.length > 1) return { ambiguous: hits.length };
    return null;
  };
  /* Why there is no number, in the operator's words. "—" is honest; "—" that
     hides a failed read is not, and neither is one that hides two candidates. */
  const noPhoneWhy = row => {
    const { hits } = leadMatch(row);
    if (hits.length > 1) {
      return `${hits.length} different leads are reachable from this deal's recorded keys — more than one phone number ends in the same nine digits, which is the rule the workflows match on. No number is shown rather than showing one of two at random.`;
    }
    if (!col.phone && leadsErr) return `purchase_history carries no phone column, and the leads read failed (${leadsErr}), so there was nothing to fall back to. This is unknown, not absent.`;
    if (!col.phone && !identityOf(row).ok) return 'purchase_history carries no phone column and this row carries no key that identifies anybody, so there is no lead record to take a number from.';
    if (!col.phone) return 'purchase_history carries no phone column, and no lead matching this customer has a phone number stored.';
    if (leadsErr) return `No phone on this deal row, and the leads read failed (${leadsErr}), so no lead record could be checked for one.`;
    if (leadsCapped) return `No phone number on this deal row, and none on any lead reachable from the keys this customer is recorded under — but the lead read was capped at ${num(LEAD_LIMIT)} rows, so a lead beyond that window was never checked.`;
    return 'No phone number on this deal row, and none on any lead reachable from the keys this customer is recorded under.';
  };
  const phoneLine = row => {
    const p = phoneInfo(row);
    if (!p) return `<span class="t-muted" title="${esc(noPhoneWhy(row))}">—</span>`;
    if (p.ambiguous) return `<span class="t-warm" title="${esc(noPhoneWhy(row))}">Two candidates — not shown</span>`;
    if (p.handle) {
      /* A LID handle has no phone digits in it. It is not a number and must
         never be dialled or read as one. The wording comes from identity.js so
         that the same handle is described identically on every screen. */
      return `<span class="mono" title="${esc(describeKey(p.value))}">${esc(p.value)}</span> <span class="t-warm">handle, not a number</span>`;
    }
    return `<span class="mono">${esc(p.value)}</span>${
      p.from === 'lead' ? ` <span class="t-muted" title="${esc(`purchase_history has no phone for this deal. This number comes from a leads row matched on ${p.basis || 'a shared key'}.`)}">from the lead record</span>` : ''}`;
  };

  /* The EMAIL column, told apart from a WhatsApp address — the same problem as
     phoneLine and settled by the same rule.

     `purchase_history.email` is the four-shape column family, and the deal form
     posts whatever `leads.email` held: lead 34 is stored as
     `+971547484167@whatsapp.lead` in that column today, so a value arriving
     here is not necessarily an address. Printing one under the label "Email"
     asserts something the database never said, and an operator who copies it
     into a mail client gets a bounce with no idea why.

     The positive test is identity.js's own classifier and NOT isHandle(), which
     is deliberately narrow: it covers `@lid`, `@c.us`, `@s.whatsapp.net` and
     `@g.us` and returns false for `@whatsapp.lead`. Verified today —
     isHandle('+971547484167@whatsapp.lead') is false while
     keyShape(...) is 'whatsapp.lead'. Asking "is this shaped like an email"
     is the question with one right answer here; asking "is this a handle"
     would have let the very value that motivated this through. */
  const contactValue = v => {
    const raw = str(v);
    if (!raw) return '';
    if (keyShape(raw) === KEY_SHAPE.EMAIL) return esc(raw);
    return `<span class="mono" title="${esc(describeKey(raw))}">${esc(raw)}</span>`
      + ' <span class="t-warm">contact handle, not an email address</span>';
  };
  const contactLine = (row, empty) => contactValue(emailOf(row))
    || `<span class="t-muted">${esc(empty)}</span>`;

  /* Margin is taken from a margin column when the table has one. Otherwise it
     is amount − cost, and only when BOTH sides are present on that row —
     never amount alone, which would report the whole sale price as profit. */
  const marginOf = row => {
    if (col.margin) { const m = n0(row[col.margin]); if (m != null) return m; }
    if (col.amount && col.cost) {
      const a = n0(row[col.amount]), c = n0(row[col.cost]);
      if (a != null && c != null) return a - c;
    }
    return null;
  };
  const marginSource = col.margin
    ? `<span class="mono">${esc(col.margin)}</span>`
    : (col.amount && col.cost)
      ? `<span class="mono">${esc(col.amount)}</span> − <span class="mono">${esc(col.cost)}</span>`
      : null;

  const dealsCapped = !!deals && deals.length >= DEAL_LIMIT;
  const vecCapped = !!vectors && vectors.length >= VEC_LIMIT;
  const invCapped = !!inv && inv.length >= INV_LIMIT;
  const quotesCapped = !!quotes && quotes.length >= QUOTE_LIMIT;
  /* The lead read is capped like every other one, and the cap matters here: a
     deal whose lead sits beyond it gets no phone-number fallback, and "no lead
     has a number for this customer" would then be a statement about the window
     rather than about the table. */
  const leadsCapped = !!leads && leads.length >= LEAD_LIMIT;
  /* v_needs_attention is read with a limit like everything else, so its row
     count is a window and not a total. Live today it returns 12 rows across
     every screen and none at all for this one, so the cap is nowhere near —
     which is exactly when a count gets described as a total and nobody notices
     for a year. */
  const attnCapped = !!viewRows && viewRows.length >= ATTN_LIMIT;

  /* What the deal cap may be called, in one place, so the three sentences that
     disclose it cannot drift apart. */
  const CAP_WORDS = dealsOrdered
    ? `the ${num(DEAL_LIMIT)} most recent`
    : `${num(DEAL_LIMIT)} rows in the order the database happened to return them`;
  const CAP_WHY = dealsOrdered
    ? ''
    : ` Ordering on ${col.date ? col.date : 'purchase_date'} was rejected, so the table was read unordered: these are an arbitrary ${num(DEAL_LIMIT)} rows, not the newest ones. Sorting them here fixes the order they are shown in and cannot bring back a row the cap left behind.`;

  /* ── Vector matching ──────────────────────────────────────────────────────
     The Closed-Won workflow derives `auto:<email>|<closed_at>` when the caller
     supplies no deal_id, and closed_at arrives as a full ISO timestamp while
     the deal row stores a date. Comparing the ids whole would never match and
     every row would claim "Not embedded" forever — a status column that is
     always wrong is worse than no column. Match on an explicit id first, then
     fall back to the email and the calendar day. */
  const dayKey = (email, when) => `${lower(email)}|${day10(when)}`;
  const byId = new Map(), byDay = new Map();
  (vectors || []).forEach(v => {
    const id = String(v.deal_id ?? '');
    if (id && !byId.has(id)) byId.set(id, v);
    const m = /^auto:([^|]+)\|(.+)$/.exec(id);
    if (m) { const k = dayKey(m[1], m[2]); if (!byDay.has(k)) byDay.set(k, v); }
  });
  const usedVectors = new Set();
  const vectorFor = row => {
    if (!vectors) return null;
    for (const c of [row.deal_id, row.id]) {
      const s = c == null ? '' : String(c);
      if (s && byId.has(s)) return byId.get(s);
    }
    const k = dayKey(emailOf(row), dateOf(row));
    return byDay.get(k) || null;
  };
  (deals || []).forEach(d => { const v = vectorFor(d); if (v) usedVectors.add(v); });
  const orphanVectors = (vectors || []).filter(v => !usedVectors.has(v));
  const embeddedCount = (deals || []).filter(d => vectorFor(d)).length;
  const unembedded = deals ? deals.filter(d => !vectorFor(d)) : [];

  /* ── Deal → finance quote ─────────────────────────────────────────────────
     There is no link, and this block is careful to keep saying so.

     purchase_history carries no quote id and no calculation id; finance_quotes
     carries no deal id. The only thing the two share is the customer, so what
     follows matches a PERSON through lib/identity.js and is described that way
     everywhere it surfaces. finance_quotes.lead_email is the same four-shape
     column as everywhere else, which is precisely why the match cannot be an
     email equality: a quote issued off a WhatsApp thread is filed under
     `<digits>@c.us`, and the deal recorded from the showroom is filed under a
     real address. Same customer, and no string in common.

     What this can and cannot conclude, stated once so no sentence below
     overreaches it:
       · a quote row found  → a record of a quote exists for this customer.
       · no quote row found → NO RECORD exists. It does not mean no quote was
         issued. Counted live on 1 Sep 2026, finance_quotes holds 0 rows while
         audit_log holds five Finance Calc runs summarised "Quote issued | 1 of 1
         claimed steps did not land [finance_quotes row …]" — the customer has
         the quote and the database does not.
       · the read failing  → unknown. Not zero, and not "never quoted". */
  const quoteByKey = new Map();
  /* A quote whose lead_email identifies nobody can never be matched to a deal,
     and it is not the same thing as a deal with no quote. Counted so the note
     below can say so instead of letting the row vanish. */
  let unkeyedQuotes = 0;
  (quotes || []).forEach(q => {
    const id = expandIdentity({ keys: [q.lead_email].filter(Boolean) });
    if (!id.ok) { unkeyedQuotes++; return; }
    new Set(canonicalsOf(id)).forEach(c => {
      const bucket = quoteByKey.get(c) || [];
      if (!bucket.includes(q)) bucket.push(q);
      quoteByKey.set(c, bucket);
    });
  });
  const quotesFor = row => {
    if (!quotes) return null;                 /* unknown, not none */
    const id = identityOf(row);
    if (!id.ok) return [];
    const hits = [];
    canonicalsOf(id).forEach(c => (quoteByKey.get(c) || []).forEach(q => {
      if (!hits.includes(q)) hits.push(q);
    }));
    return hits.sort((a, b) => (stamp(b.created_at) ?? -Infinity) - (stamp(a.created_at) ?? -Infinity));
  };
  /* A quote row carries no money on this screen by design, so what is offered
     is the fact of it, when it was calculated, and where the numbers live. */
  const quoteLine = q => {
    const when = q.calculated_at || q.created_at;
    const who = str(q.quoted_by) || str(q.source);
    return `${when ? esc(ago(when)) : 'no timestamp on the row'}${who ? ` · ${esc(who)}` : ''}`;
  };

  /* ── Deal → inventory unit ────────────────────────────────────────────────
     An inventory row is addressed by `id` — which IS the stock number,
     "NX-1010", not a surrogate key — or by `vin`. There is no separate stock_id
     column. Index both, so the link resolves whichever the deal stored; first
     writer wins, so a VIN can never be shadowed by some other row's id. */
  const invIndex = new Map();
  (inv || []).forEach(u => [u.id, u.vin].forEach(v => {
    const k = lower(v);
    if (k && !invIndex.has(k)) invIndex.set(k, u);
  }));
  const unitRefOf = row => (col.unit ? str(row[col.unit]) : '');
  const unitFor = row => {
    if (!inv || !col.unit) return null;
    const k = lower(unitRefOf(row));
    return k ? (invIndex.get(k) || null) : null;
  };
  /* `id` is the stock number and is what the lot calls a car, so it leads; the
     model is appended only as a reading aid. There is no make or year column to
     build a fuller name from. */
  const unitLabel = u => {
    const id = str(u.id), model = str(u.model);
    if (id && model) return `${id} (${model})`;
    return id || model || 'unnamed unit';
  };

  /* ── Derived alerts ───────────────────────────────────────────────────────
     Everything here comes from rows already in memory. `notes` carries the
     sentences that qualify the alerts — a check that could not run is not a
     check that passed, and only the second one is allowed to leave the strip
     silent. */
  function deriveAlerts() {
    const alerts = [];
    const notes = [];
    const add = (key, severity, icon, title, detail, rows, extra = {}) => {
      const dates = (rows || []).map(r => str(dateOf(r))).filter(Boolean).sort();
      alerts.push({
        key, severity, icon, title, detail,
        rows: rows || [],
        /* These conditions carry no timestamp of their own — nothing records
           when a purchase row went missing or when a unit failed to be marked
           sold. The oldest close date in the group is the closest true thing,
           and the tooltip says that is what it is rather than letting it read
           as "waiting since". */
        at: dates.length ? dates[0] : null,
        atNote: dates.length
          ? 'Close date of the oldest deal in this alert. The condition itself carries no timestamp, so this is how long the deal has existed, not how long it has been wrong.'
          : 'This condition carries no timestamp of its own, and no deal in it has a readable close date.',
        ...extra,
      });
    };
    const dealRef = d => {
      const who = str(nameOf(d)) || str(emailOf(d)) || 'unnamed deal';
      const when = day10(dateOf(d));
      return when ? `${who} (${when})` : who;
    };
    const refList = rows => {
      const shown = rows.slice(0, SHOWN_REFS).map(dealRef);
      const more = rows.length - shown.length;
      return shown.join(', ') + (more > 0 ? ` and ${num(more)} more` : '');
    };

    if (!deals) {
      notes.push(`purchase_history could not be read (${dealsErr}), so none of the checks this screen derives could run. Nothing below is a zero — it is an unknown.`);
      return { alerts, notes };
    }
    if (dealsCapped) {
      notes.push(`The deal read was capped at ${num(DEAL_LIMIT)} rows, so every count below describes ${CAP_WORDS} and there may be more behind them.${CAP_WHY}`);
    }

    /* ── 1 · The two closed-won tables must agree ──────────────────────────
       `deals/closed-won` writes purchase_history AND deals_embeddings in one
       run. Until 23 Aug it wrote only the embedding, and every purchase was
       silently lost; a vector with no purchase row behind it is that
       regression's exact signature, which is why that direction is CRITICAL
       and reported separately from a deal that merely has not been embedded
       yet. Both directions are checked, and the passing case is stated in the
       notes rather than left silent. */
    if (!vectors) {
      notes.push(`deals_embeddings could not be read (${vecErr}), so purchase_history and the vector memory could not be reconciled at all. The number of deals missing from the memory is unknown here, not zero — and so is the number of embedded deals with no purchase row.`);
    } else {
      if (orphanVectors.length) {
        add('vector_without_deal', 'CRITICAL', 'money_off',
          `${num(orphanVectors.length)} embedded ${plural(orphanVectors.length, 'deal has', 'deals have')} no row in purchase_history`,
          `${plural(orphanVectors.length, 'A deal was', 'Deals were')} embedded into deals_embeddings that this screen cannot tie back to a purchase row. `
          + 'Both tables are written by the same Closed-Won run, so they are supposed to agree. Until 23 Aug that workflow wrote only the embedding and the purchase row was lost silently — Ask AI could quote a sale that revenue never counted. '
          + (dealsCapped
              ? `The deal read is capped at ${num(DEAL_LIMIT)} rows, so ${plural(orphanVectors.length, 'this one', 'some of these')} may belong to an older deal outside the window rather than to a missing row. Widen the cap before treating it as the regression.`
              : `The deal read was not capped, so ${plural(orphanVectors.length, 'that purchase row is', 'those purchase rows are')} genuinely absent from the ${num(deals.length)} ${plural(deals.length, 'row', 'rows')} in the table — or ${plural(orphanVectors.length, 'it carries', 'they carry')} a deal id this screen cannot match.`),
          [], { focus: 'vectors', noFocus: 'These are vector rows, not deals — the Vector memory panel below lists them.' });
      }

      if (deals.length && !vectors.length) {
        add('vector_empty', 'CRITICAL', 'database_off',
          `${num(deals.length)} closed-won ${plural(deals.length, 'deal is', 'deals are')} recorded and the vector memory is completely empty`,
          'deals_embeddings has no rows at all. It is written only by the Closed-Won workflow, so either that workflow has never run for these deals or its embedding step is failing. Until it writes, Ask AI answers questions about past deals from nothing.',
          deals.slice());
      } else if (unembedded.length) {
        add('deal_unembedded', 'WARNING', 'psychology_alt',
          `${num(unembedded.length)} recorded ${plural(unembedded.length, 'deal has', 'deals have')} no row in the vector memory`,
          `${refList(unembedded)}. `
          + (vecCapped
              ? `The vector read is capped at ${num(VEC_LIMIT)} rows, so ${plural(unembedded.length, 'this deal', 'some of these')} may be embedded outside the window that was read — this count is an upper bound, not a fact.`
              : 'Ask AI cannot quote these deals back. The two tables are written by the same Closed-Won run and are supposed to agree.'),
          unembedded, { filter: { memory: 'OUT' } });
      }

      /* A count check as well as a row check. The row matcher falls back to
         email-and-day, which can legitimately tie two deals to one vector; if
         it ever does, the row checks come back clean while the tables still do
         not agree. Comparing the totals catches that, and only fires when the
         row checks found nothing, so one divergence is never reported twice. */
      if (!orphanVectors.length && !unembedded.length && deals.length !== vectors.length) {
        const capped = dealsCapped || vecCapped;
        add('count_divergence', capped ? 'WARNING' : 'CRITICAL', 'balance',
          `purchase_history holds ${num(deals.length)} ${plural(deals.length, 'row', 'rows')} and deals_embeddings holds ${num(vectors.length)}`,
          'Every deal matched a vector row and every vector row matched a deal, yet the two totals differ — so the matcher has tied more than one deal to the same embedding. '
          + (capped
              ? 'At least one of the two reads was capped, so the difference may be the cap rather than the data. Compare the totals with the caps lifted before acting on this.'
              : 'Neither read was capped, so this is a real disagreement between the two tables the Closed-Won workflow writes together.'),
          [], { noFocus: 'This alert compares two totals, so there is no single row to open.' });
      }
    }

    /* ── 2 · The car behind the deal ───────────────────────────────────────
       The first thing to establish is whether the question can be asked at all.
       If purchase_history stores no link to inventory, then "no deal has a
       linked unit" is a fact about the schema, not about data entry, and
       reporting it per row would put the same single finding on every deal on
       the screen.

       There are only two per-row checks here — not linked, and linked to a unit
       still on sale — because the third one cannot exist. See the sale-date
       block below the chain. */
    if (!deals.length) {
      /* With no rows, PostgREST returns no keys either, so nothing can be said
         about which columns purchase_history has. Claiming it "carries no link
         column" from an empty result would be asserting a schema fact from an
         absence of evidence. */
      notes.push('purchase_history came back empty, so no column could be resolved from it and neither deal-level check — linked unit, and unit status after the sale — had anything to run against.');
    } else if (!col.unit) {
      add('no_unit_column', 'WARNING', 'link_off',
        'No deal on this screen can be tied to an inventory unit',
        `purchase_history carries none of the columns that would link a deal to a car (looked for ${CANDIDATES.unit.join(', ')}); the columns it does carry are ${col._keys.join(', ')}. `
        + 'The vehicle is stored as free text typed into the deal form, which is not a link — matching on it would invent one. '
        + 'inventory has no reciprocal reference either, and no sale date, so the question is unanswerable from both sides: which car left the lot for this money is not recorded anywhere in this database. '
        + 'So the check for a unit still marked Available after its deal closed could not run at all, and its count below is unavailable rather than zero. Closing that gap needs a column, not a query.',
        [], { noFocus: 'This is a fact about the table, not about one deal.' });

      /* No link means no row-by-row reconciliation. It does not mean nothing can
         be said: a count against a count is still evidence, and this one is the
         reason the missing column matters rather than a note about schema
         tidiness. Only raised on the no-link path — where the link exists, the
         per-row `unit_still_available` check below reports the same condition
         precisely, and one condition must not be reported twice. */
      if (!inv) {
        notes.push(`Inventory could not be read (${invErr}), so the recorded ${plural(deals.length, 'sale', 'sales')} could not even be counted against what is still in stock. That comparison is unknown here, not clean.`);
      } else if (!inv.length) {
        notes.push('The inventory table came back empty, so there is no stock for the recorded sales to be missing from.');
      } else {
        const statusCount = new Map();
        inv.forEach(u => {
          const s = str(u.status) || 'no status';
          statusCount.set(s, (statusCount.get(s) || 0) + 1);
        });
        const breakdown = [...statusCount.entries()].sort((a, b) => b[1] - a[1])
          .map(([s, n]) => `${num(n)} ${s}`).join(', ');
        const soldUnits = inv.filter(u => lower(u.status) === 'sold');

        if (!soldUnits.length) {
          add('stock_never_marked_sold', 'CRITICAL', 'inventory',
            `${num(deals.length)} ${plural(deals.length, 'sale is', 'sales are')} recorded and not one unit in inventory is marked Sold`,
            `purchase_history holds ${num(deals.length)} closed ${plural(deals.length, 'deal', 'deals')}. The ${num(inv.length)} ${plural(inv.length, 'unit', 'units')} read from inventory carry ${breakdown}${invCapped ? `, and that read was capped at ${num(INV_LIMIT)} rows` : ''} — none of them Sold. `
            + `Either the car that was sold was never marked, or it was never a row in this table; with no unit column on the deal and no deal reference on the unit, nothing in this database can tell those two apart, and which unit it was cannot be recovered. `
            + 'What is certain either way is that the sale was never reflected in stock: every unit is still counted in stock value, still quotable on the Finance Desk, still accruing holding cost and ageing alerts. The car that was sold, whichever one it is, is still on the forecourt as far as every other screen is concerned, and can be sold a second time.',
            [], { noFocus: 'There is no column tying a deal to a unit, so there is no row here to open — this is a count against a count.', fix: NO_UNIT_FIX });
        } else if (soldUnits.length < deals.length) {
          notes.push(`inventory marks ${num(soldUnits.length)} ${plural(soldUnits.length, 'unit', 'units')} Sold against ${num(deals.length)} recorded ${plural(deals.length, 'sale', 'sales')} (${breakdown}). With no column tying a deal to a unit, the two cannot be matched row by row — this is two totals that do not agree, and which sale is unaccounted for is not answerable here.`);
        }
      }
    } else if (!inv) {
      notes.push(`Inventory could not be read (${invErr}), so both unit checks — deal with no linked unit, and a unit still marked Available after its deal closed — could not run. Their counts are unknown, not zero.`);
    } else if (!inv.length) {
      notes.push('The inventory table came back empty, so there is no unit for any deal to link to and neither unit check had anything to run against.');
    } else {
      if (invCapped) {
        notes.push(`The inventory read was capped at ${num(INV_LIMIT)} rows, so a deal whose unit sits beyond the cap is reported below as linking to a unit that is not in inventory. That is "not in the rows read", not "not in stock".`);
      }
      const linked = [], unlinked = [], dangling = [];
      deals.forEach(d => {
        if (!unitRefOf(d)) { unlinked.push(d); return; }
        const u = unitFor(d);
        if (u) linked.push({ d, u }); else dangling.push(d);
      });

      if (unlinked.length) {
        add('deal_no_unit', 'WARNING', 'car_crash',
          `${num(unlinked.length)} closed ${plural(unlinked.length, 'deal is', 'deals are')} not linked to an inventory unit`,
          `${refList(unlinked)}. The ${col.unit} column is empty on ${plural(unlinked.length, 'this row', 'these rows')}, so the sale cannot be tied to the car that left the lot: the unit keeps ageing and accruing holding cost on the Inventory screen, and nothing reconciles what was sold against what is in stock. `
          + 'The deal form does not ask for a unit, so a deal recorded from this screen never carries one.',
          unlinked);
      }
      if (dangling.length) {
        add('deal_unit_missing', 'WARNING', 'search_off',
          `${num(dangling.length)} ${plural(dangling.length, 'deal names', 'deals name')} an inventory unit that is not there`,
          `${refList(dangling)}. Each carries a ${col.unit} value that matches no id (the stock number) or VIN among the ${num(inv.length)} ${plural(inv.length, 'unit', 'units')} read`
          + (invCapped ? `, and that read was capped at ${num(INV_LIMIT)} rows, so the unit may simply sit beyond it` : ', and that read was not capped')
          + '. Either the unit was deleted after the sale or the deal stores a reference in a vocabulary inventory does not use.',
          dangling);
      }

      const stillAvailable = linked.filter(({ u }) => lower(u.status) === 'available');
      if (stillAvailable.length) {
        add('unit_still_available', 'CRITICAL', 'directions_car',
          `${num(stillAvailable.length)} sold ${plural(stillAvailable.length, 'car is', 'cars are')} still marked Available in inventory`,
          `${refList(stillAvailable.map(x => x.d))} — ${stillAvailable.slice(0, SHOWN_REFS).map(x => unitLabel(x.u)).join(', ')}. `
          + `${plural(stillAvailable.length, 'This car', 'These cars')} closed as won and ${plural(stillAvailable.length, 'is', 'are')} still on the lot as far as every other screen is concerned: quotable on the Finance Desk, countable in stock value, and still accruing holding cost and ageing alerts. `
          + `${plural(stillAvailable.length, 'It', 'They')} can be sold a second time.`,
          stillAvailable.map(x => x.d), { fix: NO_UNIT_FIX });
      }
      const reserved = linked.filter(({ u }) => lower(u.status) === 'reserved');
      if (reserved.length) {
        notes.push(`${num(reserved.length)} further sold ${plural(reserved.length, 'car is', 'cars are')} marked Reserved rather than Sold. That is not counted above — Reserved at least takes the car off the forecourt — but it is not a closed sale either.`);
      }

    }

    /* ── 3 · The quote behind the sale ─────────────────────────────────────
       A closed deal is the end of a finance conversation. The terms the
       customer was quoted are the Finance Calculator's output and they live in
       finance_quotes — nowhere else, and certainly not derived here.

       Both directions of this are careful. A failed read is unknown. An empty
       finance_quotes over a table of closed deals is a count against a count,
       exactly like the stock check above, and it is stated as one: the quotes
       are missing from the DATABASE, which is not the same claim as the
       customers never having been quoted. Live on 1 Sep 2026 the second reading
       is the true one and the audit log proves it — five Finance Calc runs
       reading "Quote issued | 1 of 1 claimed steps did not land [finance_quotes
       row (the quote the Finance Desk reads) — Bad request - please check your
       parameters]", the last at 04:03 on 31 Aug, against 0 rows in the table.
       This screen does not read audit_log, so it does not assert that here; it
       says which of the two facts it actually has. */
    if (!quotes) {
      notes.push(`finance_quotes could not be read (${quoteErr}), so whether any of these sales has the quote behind it on file is unknown here, not none.`);
    } else if (deals.length) {
      const withQuote = deals.filter(d => (quotesFor(d) || []).length);
      if (!quotes.length) {
        add('no_quote_recorded', 'WARNING', 'request_quote',
          `${num(deals.length)} closed ${plural(deals.length, 'deal is', 'deals are')} recorded and finance_quotes is empty`,
          `Not one quote is on file for any customer on this screen. The Finance Calculator is the only thing that writes finance_quotes, and the Finance Desk is the only place its figures are read; with the table empty there is no record of what any of these customers was quoted, so a sale cannot be checked against its own terms. `
          + 'This says the RECORD is missing. It does not say no quote was issued — a quote that reached the customer and failed to be written lands here as an absence, and looks identical to one that was never asked for.',
          [], { noFocus: 'finance_quotes is empty, so there is no quote row to open. purchase_history carries no quote reference either — this is a count against a count.' });
      } else if (unkeyedQuotes && withQuote.length < deals.length) {
        notes.push(`${num(deals.length - withQuote.length)} of ${num(deals.length)} recorded ${plural(deals.length, 'sale has', 'sales have')} no finance quote on file, and separately ${num(unkeyedQuotes)} quote ${plural(unkeyedQuotes, 'row carries', 'rows carry')} a lead_email that identifies nobody, so ${plural(unkeyedQuotes, 'it', 'they')} could not be matched to any deal at all. Neither figure proves a customer was never quoted.`);
      } else if (withQuote.length < deals.length) {
        const n = deals.length - withQuote.length;
        notes.push(`${num(n)} of ${num(deals.length)} recorded ${plural(deals.length, 'sale has', 'sales have')} no finance quote on file. Deal and quote share no reference at all, so they are matched on the customer's recorded keys through lib/identity.js rather than followed down a link, and a quote issued under a key neither record carries would not be found${quotesCapped ? `; the quote read was also capped at ${num(QUOTE_LIMIT)} rows, so this is an upper bound` : ''}. A missing quote is a missing record, not proof that none was issued.`);
      }
    }

    /* ── 4 · The sale date that does not exist ──────────────────────────────
       Stated once, as a schema fact, and never as a per-row alert: there is no
       row-level variation to report. `inventory` has no sold_at column — the
       live columns are id, model, vin, status, acquired_at, cost_aed,
       price_aed, days_in_stock, holding_cost_accrued, gross_margin, net_margin,
       vat_amount, aging_alert, ai_recommendation and recommended_commission —
       so a "sold unit with no sale date" check would flag every sold unit for
       one reason that has nothing to do with any of them.

       This is asserted from the schema, not derived from the payload, and it
       has to be: the select above can only return columns it asked for, so a
       missing key would prove nothing either way. It is raised whenever a deal
       exists, because a closed deal is what makes the missing date matter. */
    if (deals.length) {
      add('no_sale_date_column', 'WARNING', 'event_busy',
        'Nothing in inventory records when a car was sold',
        'A deal records the day it closed; the car it was closed on records only that its status is now Sold. There is no sale-date column on inventory at all, so for every deal on this screen "how long did this car actually sit on the lot" and "what had it cost us in holding by the day it sold" cannot be answered from this database — not for one row, for any of them. '
        + 'days_in_stock is not a substitute: it counts from acquired_at and is recomputed nightly, so on a sold car it keeps growing after the sale and measures the age of the record rather than the length of the sale cycle. '
        + 'Closing the gap needs a column, not a correction — until then any holding-cost-at-sale figure anywhere in this product is an estimate.',
        [], { noFocus: 'This is a fact about the inventory table, not about one deal.' });
    }

    alerts.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || b.rows.length - a.rows.length);
    return { alerts, notes };
  }

  /* ── KPI strip ─────────────────────────────────────────────────────────── */
  if (!deals) {
    strip.classList.remove('grid', 'g5');
    strip.innerHTML = stateError('closed-won deals', dealsErr);
  } else {
    const amounts = deals.map(amountOf).filter(x => x != null);
    const revenue = amounts.reduce((a, b) => a + b, 0);
    const withMargin = deals.filter(d => marginOf(d) != null);
    const marginTotal = withMargin.reduce((a, d) => a + marginOf(d), 0);
    /* The margin percentage is taken against the revenue of the same rows the
       margin came from. Dividing by total revenue would silently understate it
       whenever a deal has an amount but no cost. */
    const marginBase = withMargin.map(amountOf).filter(x => x != null).reduce((a, b) => a + b, 0);
    const stamps = deals.map(d => stamp(dateOf(d))).filter(x => x != null).sort((a, b) => a - b);

    strip.innerHTML = [
      kpi('Deals closed', num(deals.length),
        deals.length
          ? (stamps.length
              /* One deal has no oldest and newest. Printing the same relative
                 time twice under two labels reads as a range. */
              ? (stamps.length === 1
                  ? `<span class="t-muted">Closed ${esc(ago(stamps[0]))} · the only dated row in the table</span>`
                  : `<span class="t-muted">Oldest ${esc(ago(stamps[0]))} · newest ${esc(ago(stamps[stamps.length - 1]))}</span>`)
              : '<span class="t-muted">No readable close date on any row</span>')
            + (dealsCapped ? `<br><span class="t-warm">Capped at ${CAP_WORDS} — older deals are not counted here${dealsOrdered ? '' : ', and "older" is a guess: the ordered read was rejected'}</span>` : '')
          : 'Nothing recorded in purchase_history yet'),

      /* An empty table returns no keys, so no column can be resolved from it.
         "purchase_history has no amount column" would then be a claim about the
         schema drawn from an absence of rows — which is how a brand-new table
         gets reported as a broken one. */
      kpi('Revenue', col.amount ? aed(revenue) : '—',
        !deals.length
          ? '<span class="t-muted">Nothing recorded, so there is no revenue to total and no row to read a column from</span>'
          : col.amount
            ? `<span class="t-muted">From ${num(amounts.length)} of ${num(deals.length)} ${plural(deals.length, 'deal', 'deals')} · column <span class="mono">${esc(col.amount)}</span></span>`
              + (deals.length <= THIN
                  ? `<br><span class="t-warm">That is the whole of purchase_history — ${num(deals.length)} ${plural(deals.length, 'row', 'rows')}, not a period's takings.</span>`
                  : '')
            : `<span class="t-warm">purchase_history has no amount column (looked for ${CANDIDATES.amount.map(c => `<span class="mono">${esc(c)}</span>`).join(', ')})</span>`),

      /* Withdrawn at one priced deal rather than printed. The mean of a single
         number is that number, so this tile would repeat the Revenue tile
         beside it under a word — "average" — that says a population was
         measured. Two tiles showing AED 275,000 is how one sale becomes a
         reader's idea of what a typical sale looks like. */
      kpi('Average deal', amounts.length > 1 ? aed(revenue / amounts.length) : '—',
        amounts.length > 1
          ? `<span class="t-muted">Mean over the ${num(amounts.length)} deals that carry an amount</span>`
            + (amounts.length <= THIN
                ? `<br><span class="t-warm">A mean of ${num(amounts.length)} deals is a description of those ${num(amounts.length)}, not a typical sale.</span>`
                : '')
          : amounts.length === 1
            ? `<span class="t-warm">Withdrawn: one priced deal is not an average</span>`
              + `<br><span class="t-muted">The single recorded sale is ${esc(aed(revenue))}, which is the Revenue figure beside this one. There is nothing to average it against, so no mean is shown.</span>`
            : `<span class="t-muted">${deals.length
                ? 'No deal carries a readable amount, so there is no average to take'
                : 'No deal has been recorded, so there is no average to take'}</span>`),

      kpi('Gross margin', withMargin.length ? aed(marginTotal) : '—',
        withMargin.length
          /* A margin as a percentage of nothing is neither 0% nor 100%. When
             the rows carrying a margin carry no sale amount to measure it
             against, the reason is printed where the percentage would be —
             which is the same rule health.js applies to a success rate with no
             qualifying runs, and the reason successRate() there returns null
             rather than a number. */
          ? `<span class="t-muted">${marginSource} · from ${num(withMargin.length)} of ${num(deals.length)} deals${
              marginBase > 0
                ? ` · ${esc(pct(marginTotal / marginBase * 100))} of their revenue`
                : ` · <span class="t-warm">no percentage: ${col.amount
                    ? `${plural(withMargin.length, 'the row', 'the rows')} carrying a margin ${plural(withMargin.length, 'has', 'have')} no sale amount to measure it against`
                    : 'purchase_history has no amount column to measure it against'}</span>`}</span>`
          : !deals.length
            ? '<span class="t-muted">Nothing recorded, so there is no margin to total</span>'
            /* Not "not recorded" — unsourceable. purchase_history stores what
               the car sold for and nothing about what it cost, and there is no
               unit reference to fetch a cost from inventory with, so no margin
               on this screen can be derived from anything. inventory does carry
               cost_aed, and reaching for it would mean guessing which unit this
               deal was, which is the one thing this screen refuses to do. */
            : `<span class="t-muted">Not recorded and not derivable. purchase_history carries no margin column (${
                CANDIDATES.margin.map(c => `<span class="mono">${esc(c)}</span>`).join(', ')}) and no cost column (${
                CANDIDATES.cost.map(c => `<span class="mono">${esc(c)}</span>`).join(', ')}) to subtract from the sale price. inventory holds a <span class="mono">cost_aed</span>, but no column ties a deal to a unit, so taking one from there would mean guessing which car this was. No margin is estimated here.</span>`),

      /* The reconciliation, stated in both directions and in both outcomes.
         "1 of 1 matched, no unmatched vectors" is the guard reporting that it
         ran and passed; a silent tile would look identical on the day the
         Closed-Won workflow stops writing one of the two tables. */
      kpi('In vector memory', vecErr ? '—' : num(vectors.length),
        vecErr
          ? `<span class="t-hot">deals_embeddings could not be read — ${esc(vecErr)}. Whether the two closed-won tables agree is unknown, not fine.</span>`
          : vectors.length
            ? `<span class="t-muted">${num(embeddedCount)} of ${num(deals.length)} recorded deal${deals.length === 1 ? '' : 's'} matched to a vector row</span>`
              + (orphanVectors.length
                  ? `<br><span class="t-hot">${num(orphanVectors.length)} vector row${orphanVectors.length === 1 ? '' : 's'} with no deal in purchase_history</span>`
                  : (embeddedCount === deals.length && deals.length === vectors.length
                      ? '<br><span class="t-ok">Both closed-won tables agree</span>'
                      : ''))
            : deals.length
              ? '<span class="t-hot">deals_embeddings has no rows — Ask AI cannot cite a single recorded deal</span>'
              : '<span class="t-muted">Nothing recorded and nothing embedded — the two agree, with nothing in them</span>',
        vecErr || orphanVectors.length || (!vecErr && !vectors.length && deals.length) ? 't-hot' : ''),
    ].join('');
  }

  /* ── Banners ───────────────────────────────────────────────────────────── */
  /* The vector-coverage banners that used to live here are now alerts in the
     strip at the top — same facts, one place, and each one hands over the exact
     rows it counted. What is left is the one condition that is not an alert
     about a deal: the deal FORM losing its lead picker. */
  let focusList = () => {};

  if (leadsErr) {
    const b = el('div', 'banner warm'); b.style.marginBottom = '12px';
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">person_off</span>
      <div>Leads could not be read (${esc(leadsErr)}), so the deal form cannot offer a lead to pick from and no deal row can fall back to a lead's phone number. Every field can still be typed in by hand.</div>`;
    banners.appendChild(b);
  }

  /* ── Deals over time ───────────────────────────────────────────────────── */
  if (!deals) {
    trendCard.innerHTML = stateError('the revenue trend', dealsErr);
  } else {
    const buckets = new Map();
    let undated = 0;
    deals.forEach(d => {
      const m = monthOf(dateOf(d));
      if (!m) { undated++; return; }
      const b = buckets.get(m) || { n: 0, revenue: 0, withAmount: 0 };
      b.n++;
      const a = amountOf(d);
      if (a != null) { b.revenue += a; b.withAmount++; }
      buckets.set(m, b);
    });

    const months = [...buckets.keys()].sort();
    if (!months.length) {
      trendCard.innerHTML = `<div class="label-caps">Deals over time</div>${stateEmpty(
        deals.length ? 'No deal carries a readable close date' : 'No deals to chart yet',
        deals.length
          ? `${col.date ? `The ${col.date} column is empty or unparseable on every row read.` : 'purchase_history has no close-date column, so the deals cannot be placed on a timeline.'}`
          : 'Record a closed-won deal and it appears here by month.', 'bar_chart')}`;
    } else {
      /* Months with no deal are shown as gaps rather than skipped: a row of
         bars that jumps March → September reads as continuous trade. The empty
         months are a fact of the table, not a filled-in value. */
      const span = [];
      let [y, mo] = months[0].split('-').map(Number);
      const [ly, lmo] = months[months.length - 1].split('-').map(Number);
      for (let i = 0; i < 240 && (y < ly || (y === ly && mo <= lmo)); i++) {
        span.push(`${y}-${String(mo).padStart(2, '0')}`);
        mo++; if (mo > 12) { mo = 1; y++; }
      }
      const shown = span.slice(-TREND_MONTHS);
      const useRevenue = !!col.amount;
      const peak = Math.max(...shown.map(m => (useRevenue ? (buckets.get(m)?.revenue || 0) : (buckets.get(m)?.n || 0))), 0);

      trendCard.innerHTML = `
        <div class="label-caps">Deals over time</div>
        <div class="card-sub" style="margin-bottom:12px">${useRevenue
          ? `Revenue per calendar month from <span class="mono">${esc(col.amount)}</span>, dated on <span class="mono">${esc(col.date)}</span>`
          : `Deals per calendar month, dated on <span class="mono">${esc(col.date)}</span>. purchase_history has no amount column, so this counts deals rather than money.`}</div>
        <div>${shown.map(m => {
          const b = buckets.get(m);
          const v = useRevenue ? (b?.revenue || 0) : (b?.n || 0);
          const w = peak > 0 ? (v / peak * 100) : 0;
          return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
            <div class="cell-sub" style="width:64px;flex-shrink:0">${esc(monthLabel(m))}</div>
            <div class="bar" style="flex:1"><i style="width:${w.toFixed(1)}%"></i></div>
            <div class="num" style="width:120px;text-align:right;flex-shrink:0">${
              b ? (useRevenue ? aed(b.revenue) : num(b.n)) : '<span class="t-muted">—</span>'}</div>
            <div class="cell-sub num" style="width:64px;text-align:right;flex-shrink:0">${
              b ? `${num(b.n)} deal${b.n === 1 ? '' : 's'}` : ''}</div>
          </div>`;
        }).join('')}</div>
        <div class="cell-sub" style="margin-top:10px;white-space:normal">
          ${span.length > shown.length ? `Showing the last ${num(shown.length)} of ${num(span.length)} months on record. ` : ''}
          ${undated ? `${num(undated)} deal${undated === 1 ? ' has' : 's have'} no readable close date and ${undated === 1 ? 'is' : 'are'} not on this chart. ` : ''}
          ${useRevenue && deals.some(d => amountOf(d) == null) ? 'Deals with no amount are counted but contribute nothing to the bars. ' : ''}
          ${/* A bar scaled against the largest month is drawn full-width when
                there is only one month, which is the shape of a peak. Said
                plainly: this is one value, and a chart of one value is a
                reading of it rather than a direction of travel. */
            deals.length <= THIN || months.length === 1
              ? `<span class="t-warm">${esc(months.length === 1
                  ? `This is ${num(deals.length)} ${plural(deals.length, 'deal', 'deals')} in a single month. Each bar is scaled against the largest month on the chart, so with one month that bar is full width by construction — it is a value, not a trend, and there is no earlier month to compare it with.`
                  : `${num(deals.length)} deals across ${num(months.length)} months is too little to read a direction from. These bars are the deals themselves, not a trend.`)}</span>`
              : ''}
        </div>`;
    }
  }

  /* ── Returning customers ───────────────────────────────────────────────── */
  if (!deals) {
    repeatCard.innerHTML = `<div class="card-head"><div><div class="card-title">Returning customers</div></div></div>${stateError('returning customers', dealsErr)}`;
  } else {
    /* Grouped on IDENTITY, not on lower(email).

       This panel used to key on the email string, which is the read that under-
       reports and looks certain doing it: a customer whose showroom deal is
       filed under a real address and whose WhatsApp-sourced deal is filed under
       `<digits>@c.us` is two rows with nothing in common, and the empty state
       below then states positively that no customer appears twice. Two
       purchases, one person, and the screen says the opposite.

       Merging is done in two passes on purpose, because the two rules do not
       carry the same weight. An email, a LID or an exact shared key IS the same
       person. The last-nine-digits rule is the one that can be wrong — two
       customers really can have numbers ending in the same nine digits — so it
       is applied second and refused whenever the two sides carry different
       email addresses. A refused merge is counted and said out loud rather than
       resolved silently in either direction. */
    const parent = deals.map((_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; return ra !== rb; };

    const cansOf = deals.map(d => {
      const id = identityOf(d);
      return id.ok ? [...new Set(canonicalsOf(id))] : [];
    });
    /* Rows that identify nobody at all. They fall back to the customer name,
       which two different people can share, so the grouping is a guess and the
       panel says which rows it applied to. Rows with neither are ungroupable
       and are counted separately — they are the ones the empty state must not
       claim to have compared. */
    const skip = new Set();
    const byNameRow = new Set();

    const strongOwner = new Map();
    deals.forEach((d, i) => {
      const strong = cansOf[i].filter(c => !c.startsWith('phone:'));
      if (strong.length) {
        strong.forEach(c => {
          if (strongOwner.has(c)) union(strongOwner.get(c), i);
          else strongOwner.set(c, i);
        });
        return;
      }
      if (cansOf[i].length) return;      /* phone-only: pass 2 will place it */
      const nm = lower(nameOf(d));
      if (!nm) { skip.add(i); return; }
      byNameRow.add(i);
      if (strongOwner.has(`name:${nm}`)) union(strongOwner.get(`name:${nm}`), i);
      else strongOwner.set(`name:${nm}`, i);
    });

    /* Which email addresses each merged group already carries, so pass 2 can
       refuse to put two of them together. */
    const emailsAt = new Map();
    deals.forEach((_, i) => {
      if (skip.has(i)) return;
      const r = find(i);
      const set = emailsAt.get(r) || new Set();
      cansOf[i].filter(c => c.startsWith('email:')).forEach(c => set.add(c));
      emailsAt.set(r, set);
    });

    let suffixRefused = 0;
    const phoneOwner = new Map();
    deals.forEach((_, i) => {
      if (skip.has(i)) return;
      cansOf[i].filter(c => c.startsWith('phone:')).forEach(c => {
        const other = phoneOwner.get(c);
        if (other == null) { phoneOwner.set(c, i); return; }
        const ra = find(other), rb = find(i);
        if (ra === rb) return;
        const ea = emailsAt.get(ra) || new Set(), eb = emailsAt.get(rb) || new Set();
        const clash = [...ea].some(x => !eb.has(x)) || [...eb].some(x => !ea.has(x));
        if (ea.size && eb.size && clash) { suffixRefused++; return; }
        union(ra, rb);
        const merged = new Set([...ea, ...eb]);
        emailsAt.set(find(ra), merged);
      });
    });

    const groups = new Map();
    deals.forEach((d, i) => {
      if (skip.has(i)) return;
      const key = find(i);
      const g = groups.get(key) || { email: '', name: '', n: 0, revenue: 0, withAmount: 0, last: null, byName: byNameRow.has(i), phoneRow: null };
      g.n++;
      if (!g.email && lower(emailOf(d))) g.email = str(emailOf(d));
      const a = amountOf(d);
      if (a != null) { g.revenue += a; g.withAmount++; }
      const t = stamp(dateOf(d));
      if (t != null && (g.last == null || t > g.last)) g.last = t;
      if (!g.name && nameOf(d)) g.name = nameOf(d);
      if (byNameRow.has(i)) g.byName = true;
      /* Hold the row this group's contact line is drawn from, preferring one
         that actually yields a number. Keeping the first row unconditionally
         would show "—" for a customer whose phone is on their second deal. */
      const yieldsNumber = r => { const p = phoneInfo(r); return !!(p && p.value); };
      if (!g.phoneRow) g.phoneRow = d;
      else if (!yieldsNumber(g.phoneRow) && yieldsNumber(d)) g.phoneRow = d;
      groups.set(key, g);
    });
    const repeat = [...groups.values()].filter(g => g.n > 1)
      .sort((a, b) => b.revenue - a.revenue || b.n - a.n);
    const noKey = skip.size;
    /* The rows that were actually compared with something. The empty state
       below may only speak for these — it used to say "no email or name appears
       twice across the N rows in purchase_history" with N as every row read,
       including the ones that were dropped before the comparison ran. */
    const compared = deals.length - noKey;

    /* Said in both outcomes, not only when there is repeat business to show.
       The audit of 31 Aug caught it nested inside the repeat branch: on the
       common day — no repeat business — the caveat naming the rows that were
       never compared disappeared, and the empty state asserted a clean result
       over a count that included them. */
    const groupingCaveats = [
      noKey ? `${num(noKey)} deal${noKey === 1 ? ' has' : 's have'} no key that identifies anybody and no customer name, so ${noKey === 1 ? 'it was' : 'they were'} not compared with anything.` : '',
      byNameRow.size ? `${num(byNameRow.size)} deal${byNameRow.size === 1 ? '' : 's'} carr${byNameRow.size === 1 ? 'ies' : 'y'} no email, phone or WhatsApp key and ${byNameRow.size === 1 ? 'was' : 'were'} grouped on the customer name, which two different people can share.` : '',
      suffixRefused ? `${num(suffixRefused)} pair${suffixRefused === 1 ? '' : 's'} of deals share the last nine digits of a phone number but carry different email addresses, so ${suffixRefused === 1 ? 'it was' : 'they were'} left apart rather than merged. They may be one person with two addresses or two people whose numbers end alike, and nothing in this database says which.` : '',
    ].filter(Boolean);
    const caveatLine = groupingCaveats.length
      ? `<div class="list-item" style="cursor:default"><div class="cell-sub" style="white-space:normal">${groupingCaveats.map(esc).join('<br>')}</div></div>`
      : '';

    repeatCard.innerHTML = `<div class="card-head"><div>
        <div class="card-title">Returning customers</div>
        <div class="card-sub">Contacts with more than one recorded deal, ranked by total spend. Deals are matched to each other on every key each row is recorded under — email, phone and WhatsApp address — using the same rule the workflows join on.</div>
      </div></div>
      ${repeat.length
        ? `<div style="max-height:340px;overflow-y:auto">${repeat.slice(0, 25).map(g => `
            <div class="list-item" style="cursor:default">
              ${pill(num(g.n) + ' deals', 'vip', { verbatim: false })}
              <div style="flex:1;min-width:0">
                <div style="font-weight:500">${esc(g.name
                  /* A WhatsApp address is not a person's name. identity.js keeps
                     handles out of the name slot everywhere else in the product
                     and the same classifier does it here: only an email-shaped
                     value may stand in for a missing name. */
                  || (keyShape(g.email) === KEY_SHAPE.EMAIL ? g.email : '')
                  || 'Unnamed customer')}</div>
                <div class="cell-sub">${contactValue(g.email) || esc(g.byName
                  ? 'No email, phone or WhatsApp key on these rows — grouped by customer name, which two people can share'
                  : 'No email on these rows — grouped on the phone or WhatsApp key they share')}${
                  g.last != null ? ` · last deal ${esc(ago(g.last))}` : ''}</div>
                <div class="cell-sub">${phoneLine(g.phoneRow)}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div class="num" style="font-weight:500">${g.withAmount ? aed(g.revenue) : '<span class="t-muted">—</span>'}</div>
                <div class="cell-sub">${g.withAmount === g.n ? 'total spend' : `${num(g.withAmount)} of ${num(g.n)} priced`}</div>
              </div>
            </div>`).join('')}
            ${repeat.length > 25 ? `<div class="list-item" style="cursor:default"><div class="cell-sub">${num(repeat.length - 25)} more returning customers not shown</div></div>` : ''}
          </div>`
        /* "Every recorded deal is a different customer" is a sentence about a
           book of business. Over one row it is arithmetically true and
           editorially false — it invites the reader to picture a spread of
           one-time buyers where there is a single purchase. Over fewer rows
           than were read it is not even arithmetically true, which is why the
           count below is the compared total and not deals.length. */
        : stateEmpty(
            !deals.length ? 'No deals recorded yet'
              : compared === 0 ? 'No deal on this screen could be compared with another'
                : compared === 1 ? 'One purchase could be compared, so there is no repeat business to report'
                  : 'No customer on this screen appears twice',
            !deals.length
              ? 'Repeat business appears here once the same customer buys twice.'
              : compared === 0
                ? `${num(deals.length)} deal${deals.length === 1 ? '' : 's'} were read and not one carries a key or a name to group on, so this panel is reporting that it could not check — not that customers do not come back.`
                : compared === 1
                  ? `${num(compared)} of the ${num(deals.length)} row${deals.length === 1 ? '' : 's'} read could be grouped${
                      groups.size === 1 ? ` — ${[...groups.values()][0].name || [...groups.values()][0].email || 'one customer'}` : ''
                    }. Repeat business needs a second purchase by the same person, so this panel stays empty until there is one; it is not reporting that customers do not come back.`
                  : `No customer appears twice across the ${num(compared)} of ${num(deals.length)} rows that could be grouped, matched on every key each row is recorded under rather than on the email alone, so there is no repeat business to report.`,
            'group')}
      ${caveatLine}`;
  }

  /* ── The lead picker on the deal form ────────────────────────────────────
     1 Sep 2026. Two defects, both counted against the live database BEFORE this
     block was written, not inferred from reading the code.

     ONE — the picker was a truthy test on a text column.

     lib/deal-form.js builds its <select> from `leads.filter(l => l.email)`.
     That asks whether a column is non-empty, which is not the same question as
     whether we know who somebody is. Counted live today:

       select count(*) from leads                        ->  3
       select count(*) from leads where email is null    ->  0
       select count(*) from leads where email = ''       ->  1     (lead 35)

     Lead 35 — Effco Contracting llc, +971505433953 — holds the EMPTY STRING,
     not null. `''` is falsy, so he was dropped from the picker with nothing on
     screen to say a lead had been withheld. He is not a stub: whatsapp_contacts
     ties chat `111948809162873@lid` to phone 971505433953 under his own push
     name, and communication_logs holds 10 messages under that chat. A real lead
     with a real conversation, and the form could not offer him.

     The list is built here now and the test is the one shared rule — does
     lib/identity.js identify this row. Run against all three leads today it
     returned ok:true, identified:'lead' for every one, so all three are offered.

     TWO — what the chosen option is worth as an anchor.

     dealForm posts the option's value as `lead_email`, and the Closed-Won
     workflow derives the deal id from it. `leads.email` is the same four-shape
     column family as communication_logs.lead_email, so the value being handed
     over is not necessarily an email address: lead 34 is stored as
     `+971547484167@whatsapp.lead`, a WhatsApp address, and the picker was
     already posting it as though it were one. identity.js is explicit that such
     a value is not an address — it returns email:'' for that row — so the
     anchor is taken from identity.js instead of from the raw column: the real
     address where there is one, otherwise the `@whatsapp.lead` form of the
     known phone number, which is the shape the WORKFLOWS synthesise and which
     identity.js resolves back to the same person by the last-nine-digits rule.

     Nothing here invents a key. For lead 34 the value is unchanged. For lead 35
     it is the shape his own workflows would have written, and the round trip
     was checked before shipping: a deal recorded under it — with the deal
     form's optional Phone box filled in and also with it left empty — resolves
     back through identity.js to lead 35 and to no other lead.

     THE RELATIONAL ANCHOR NOW EXISTS, AND THIS PARAGRAPH SAID THE OPPOSITE
     UNTIL 2 SEP 2026. What stood here — that purchase_history has nine columns
     and "not one of customer_id, lead_id, vehicle_id or conversation_id", that
     the lead's row id "cannot travel with" a sale, and that the gap "is not
     closed from here" — is false as of migration inv002_purchase_history_lead_id.

     Re-probed live today, against information_schema and pg_constraint rather
     than against the repo: purchase_history has TEN columns — id, customer_name,
     email, phone, vehicle, purchase_date, amount_aed, created_at, deal_id and
     lead_id. lead_id is `integer` (matching leads.id, which is integer/serial,
     not bigint), nullable, no default. It carries a real foreign key,
     purchase_history_lead_id_fkey -> leads(id) ON DELETE SET NULL, which is now
     the third FK in the public schema alongside leads.assigned_to_id and
     kyc_documents.reviewed_by, and it is indexed by purchase_history_lead_id_idx.
     lib/deal-form.js posts lead_id, and the two Closed-Won nodes carry it
     through: `Format Deal Text` coerces it to an integer or null, and
     `Record Purchase` names it in the body it POSTs.

     WHAT IS STILL TRUE, and is the reason the contact-key work above is not
     redundant. The id travels only when the picked lead's anchor still equals
     the contact key in the Email box at save time: pick Ali, retype the
     address, and deal-form drops the id rather than file it against a key it no
     longer matches. A hand-typed deal — no lead picked — files no lead_id at
     all. So NULL in that column means "provenance not recorded"; it never means
     "no lead exists", and nothing on this screen may read it as an absence of a
     customer. The contact key remains the anchor every deal carries, and the
     lead id is the stronger link laid on top of it where it is known to agree.

     STILL TRUE ALSO: there is no customers table and no deals table in this
     database, so leads.id remains the one canonical customer id there is.

     NOT PROVEN AT RUNTIME. This path is wired, not fired. purchase_history holds
     0 rows live today and the Closed-Won workflow has zero executions ever
     recorded, so no lead_id has ever actually been written by it. Nothing here
     or on screen may describe the link as demonstrated. */
  const pickerRefused = [];
  let pickerByHandle = 0;
  const pickerLeads = (leads || []).map(l => {
    const id = expandIdentity({ leadId: l.id, email: l.email, keys: [l.phone].filter(Boolean) });
    /* `id.email` rather than `l.email`: the raw column can hold a handle and
       identity.js is what knows the difference. The WhatsApp form is taken from
       the keys identity.js expanded, never assembled here. */
    const wa = (id.keys || []).find(k => keyShape(k) === KEY_SHAPE.WA_LEAD) || '';
    const anchor = id.ok ? (id.email || wa) : '';
    if (!anchor) { pickerRefused.push(l); return null; }
    if (!id.email) pickerByHandle += 1;
    /* A COPY. `leads` is read by leadsByKey and the phone fallback above and
       must keep the values the database returned. */
    return { ...l, email: anchor };
  }).filter(Boolean);

  /* The old rule kept alongside the new one, so the note states a delta it
     actually measured rather than asserting an improvement. */
  const pickerWasOffering = (leads || []).filter(l => l.email).length;
  const offeredIds = new Set(pickerLeads.map(l => l.id));
  const pickerRecovered = pickerLeads.filter(l => !(leads || []).some(o => o.id === l.id && o.email)).length;
  const pickerDropped = (leads || []).filter(l => l.email && !offeredIds.has(l.id)).length;

  const pickerNote = leadsErr
    ? `<span class="t-warm">The leads read failed (${esc(leadsErr)}), so the picker on that form has no lead to offer and every field has to be typed by hand. That is a failed read, not an empty lead table.</span>`
    : !leads.length
      ? 'There are no leads to offer, so every field on that form has to be typed by hand.'
      : [
        `Its lead picker offers ${num(pickerLeads.length)} of ${num(leads.length)} lead${plural(leads.length, '', 's')}, chosen by whether <span class="mono">lib/identity.js</span> can identify the row rather than by whether the email column happens to be non-empty.`,
        pickerRecovered
          ? `A truthy test on that column — which is what this picker used until today — offered ${num(pickerWasOffering)}: ${num(pickerRecovered)} lead${plural(pickerRecovered, ' whose email column holds the empty string was', 's whose email column holds the empty string were')} dropped from it silently, though identity.js identifies ${plural(pickerRecovered, 'that lead', 'those leads')} from the phone number.`
          : '',
        pickerDropped
          ? `<span class="t-warm">${num(pickerDropped)} lead${plural(pickerDropped, ' carries a non-empty email column that identifies nobody and is', 's carry a non-empty email column that identifies nobody and are')} not offered.</span>`
          : '',
        pickerRefused.length
          ? `${num(pickerRefused.length)} lead${plural(pickerRefused.length, ' carries', 's carry')} no email, phone or WhatsApp key at all, so ${plural(pickerRefused.length, 'it is', 'they are')} not offered — there would be nothing to file the deal under.`
          : '',
        pickerByHandle
          ? `${num(pickerByHandle)} of the ${num(pickerLeads.length)} offered ${plural(pickerByHandle, 'has', 'have')} no email address on file and ${plural(pickerByHandle, 'is', 'are')} anchored on the WhatsApp address the workflows synthesise from the phone number.`
          : '',
        'A deal recorded here is anchored on a contact key either way, and since 2 Sep 2026 it can also carry the lead\'s own row id: <span class="mono">purchase_history.lead_id</span> exists, with a foreign key to <span class="mono">leads(id)</span>. It is filed only while the lead you picked still matches the address in the Email box — retype that address and the id is dropped rather than attached to a key it no longer matches, and a deal typed in by hand files none at all. A blank <span class="mono">lead_id</span> therefore means the origin was not recorded; it never means no lead exists. No deal has been recorded through this path yet, so it is wired rather than proven.',
      ].filter(Boolean).join(' ');

  /* ── The deal list ─────────────────────────────────────────────────────── */
  const actions = `<button class="btn primary" id="newDeal">
    <span class="material-symbols-outlined">add</span> Record a deal</button>`;

  if (!deals) {
    listCard.innerHTML = `<div class="card-head"><div><div class="card-title">Closed-won deals</div>
        <div class="card-sub">${pickerNote}</div></div>
      <div style="flex:1"></div>${actions}</div>${stateError('closed-won deals', dealsErr)}`;
  } else {
    const f = { q: '', memory: 'ALL', period: 'ALL', sort: 'new', only: null };
    const dated = deals.filter(d => stamp(dateOf(d)) != null).length;

    listCard.innerHTML = `<div class="card-head"><div>
        <div class="card-title">Closed-won deals</div>
        <div class="card-sub">Straight from <span class="mono">purchase_history</span>. Recording a deal here posts to the Closed-Won workflow, which is what writes the pgvector memory — nothing on this screen writes the table directly. Click a row for the full record.${
          dealsCapped ? ` <span class="t-warm">Showing ${CAP_WORDS} — this read is capped.${esc(CAP_WHY)}</span>` : ''}${
          /* Said once, under the column it is about, rather than as a repeated
             sub-line on every row: it is one fact about the table. */
          col.unit ? '' : ' <span class="t-muted">The vehicle column is free text captured on the deal form, not a reference to a unit — purchase_history has no inventory column, so no row here can say which car was sold.</span>'}</div>
        <div class="card-sub">${pickerNote}</div>
      </div><div style="flex:1"></div>${actions}</div>
      <div class="toolbar">
        <div class="grow"><input type="search" id="dq" aria-label="Search closed-won deals"
          placeholder="Search customer, email, phone or vehicle" /></div>
        <select id="dPeriod" aria-label="Filter by close date" style="width:auto">
          ${PERIODS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}
        </select>
        <select id="dMem" aria-label="Filter by vector memory state" style="width:auto"
          ${vecErr ? `disabled title="deals_embeddings could not be read (${esc(vecErr)}), so this screen does not know which deals are embedded."` : ''}>
          <option value="ALL">All memory states</option>
          ${/* The counts come off the vector read, so they are only printed
                when there was one. With deals_embeddings unread, embeddedCount
                is 0 by construction and "In vector memory · 0" beside "Not
                embedded · 12" is a failed read wearing the face of a finding —
                the exact substitution this pass exists to remove. The control
                is disabled either way; the numbers had to go too. */''}
          <option value="IN">In vector memory${vecErr ? '' : ` · ${num(embeddedCount)}`}</option>
          <option value="OUT">Not embedded${vecErr ? '' : ` · ${num(deals.length - embeddedCount)}`}</option>
        </select>
        <select id="dSort" aria-label="Sort deals" style="width:auto">
          ${Object.entries(SORTS).map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}
        </select>
        <div class="t-muted num" id="dCount"></div>
      </div>
      <div id="dNote"></div>
      <div id="dTable"></div>`;

    const cols = [
      /* The phone sits with the name, not in a column of its own: this is the
         line an operator reads before picking up the handset, and splitting the
         two apart is how a number gets dialled against the wrong customer. */
      { label: 'Customer', strong: true, render: d => `${esc(nameOf(d) || 'Unnamed customer')}
          <div class="cell-sub">${contactLine(d, 'No email on this row')}</div>
          <div class="cell-sub">${phoneLine(d)}</div>` },
      { label: 'Vehicle', render: d => {
          const v = esc(get(d, 'vehicle') || '—');
          if (!col.unit) return v;
          const ref = unitRefOf(d);
          if (!ref) return `${v}<div class="cell-sub t-warm" title="The ${esc(col.unit)} column is empty on this row, so the sale is not tied to a car in inventory.">No unit linked</div>`;
          const u = unitFor(d);
          if (!inv) return `${v}<div class="cell-sub mono" title="Inventory could not be read, so this reference could not be resolved to a unit.">${esc(ref)}</div>`;
          if (!u) return `${v}<div class="cell-sub t-warm mono" title="No inventory row has this id, stock number or VIN among the rows read.">${esc(ref)} · not found</div>`;
          const s = str(u.status);
          return `${v}<div class="cell-sub mono">${esc(unitLabel(u))}${
            s ? ` · <span class="${lower(s) === 'available' ? 't-hot' : 't-muted'}">${esc(s)}</span>` : ''}</div>`;
        } },
      { label: 'Amount', align: 'r', render: d => {
          const a = amountOf(d);
          return a == null ? '<span class="t-muted">—</span>' : aed(a);
        } },
    ];
    if (col.margin || (col.amount && col.cost)) {
      cols.push({ label: 'Gross margin', align: 'r', render: d => {
        const m = marginOf(d), a = amountOf(d);
        if (m == null) return '<span class="t-muted">—</span>';
        /* A margin over a sale price of nothing is not 0% and not 100%. The two
           reasons it can happen are different facts and neither is a number, so
           the cell says which one it is. */
        const why = a == null
          ? 'No sale amount on this row, so the margin cannot be expressed as a percentage of one.'
          : 'The sale amount on this row is zero, so there is nothing to take a percentage of.';
        return `<span class="${m < 0 ? 't-hot' : ''}">${aed(m)}</span>${
          a ? `<div class="cell-sub">${esc(pct(m / a * 100))}</div>`
            : `<div class="cell-sub t-muted" title="${esc(why)}">no % — ${a == null ? 'no sale amount' : 'sale amount is zero'}</div>`}`;
      } });
    }
    cols.push(
      { label: 'Closed', render: d => {
          const raw = dateOf(d);
          if (!raw) return '<span class="t-muted">No date recorded</span>';
          return `<div>${esc(day10(raw))}</div><div class="cell-sub">${esc(ago(raw))}</div>`;
        } },
      { label: 'Vector memory', render: d => {
          if (vecErr) return `<span class="t-muted" title="deals_embeddings could not be read">Unknown</span>`;
          if (vectorFor(d)) return pill('Embedded', 'ok', { verbatim: false });
          return `<span class="t-muted">${vecCapped ? 'Not in the rows read' : 'Not embedded'}</span>`;
        } },
    );

    const th = listCard.querySelector('#dTable');
    const countEl = listCard.querySelector('#dCount');
    const noteEl = listCard.querySelector('#dNote');

    const visible = () => {
      const q = f.q.trim().toLowerCase();
      const cutoff = f.period === 'ALL' ? null : Date.now() - Number(f.period) * 86400000;
      return deals.filter(d => {
        if (f.only && !f.only.rows.has(d)) return false;
        if (cutoff != null) { const t = stamp(dateOf(d)); if (t == null || t < cutoff) return false; }
        if (f.memory === 'IN' && !vectorFor(d)) return false;
        if (f.memory === 'OUT' && vectorFor(d)) return false;
        if (!q) return true;
        const p = phoneInfo(d);
        return [nameOf(d), emailOf(d), get(d, 'vehicle'), get(d, 'phone'), p ? p.value : ''].some(v => lower(v).includes(q));
      });
    };

    const sortRows = rows => {
      const byDate = (a, b) => (stamp(dateOf(b)) ?? -Infinity) - (stamp(dateOf(a)) ?? -Infinity);
      if (f.sort === 'new') return rows.slice().sort(byDate);
      if (f.sort === 'old') return rows.slice().sort((a, b) => (stamp(dateOf(a)) ?? Infinity) - (stamp(dateOf(b)) ?? Infinity));
      if (f.sort === 'name') return rows.slice().sort((a, b) => lower(nameOf(a)).localeCompare(lower(nameOf(b))) || byDate(a, b));
      /* Deals with no amount cannot take part in a value sort. They are kept at
         the end in date order rather than treated as zero, which would rank a
         missing price alongside a giveaway. */
      const dir = f.sort === 'low' ? 1 : -1;
      const priced = rows.filter(r => amountOf(r) != null).sort((a, b) => dir * (amountOf(a) - amountOf(b)));
      return priced.concat(rows.filter(r => amountOf(r) == null).sort(byDate));
    };

    function draw() {
      if (!deals.length) {
        countEl.textContent = '';
        noteEl.innerHTML = '';
        th.innerHTML = stateEmpty('No deals recorded yet',
          'Record a closed-won deal and it becomes both revenue on this screen and something Ask AI can quote back.', 'handshake');
        return;
      }
      const rows = sortRows(visible());
      countEl.textContent = `${rows.length} of ${deals.length}`;
      const notes = [];
      if (f.period !== 'ALL' && dated < deals.length) {
        notes.push(`${num(deals.length - dated)} deal${deals.length - dated === 1 ? ' has' : 's have'} no readable close date and cannot appear while a period filter is set.`);
      }
      if (f.memory !== 'ALL' && vecCapped) {
        notes.push(`The vector read is capped at ${num(VEC_LIMIT)} rows, so a deal embedded outside that window is filtered as "not embedded".`);
      }
      /* When an alert has narrowed the list, say so in the list itself and
         offer the way back. A filter the operator did not set and cannot see is
         how a screen ends up accused of losing rows. */
      const onlyBar = f.only
        ? `<div class="list-item" style="cursor:default">
             <span class="material-symbols-outlined t-warm" style="font-size:18px" aria-hidden="true">filter_alt</span>
             <div class="cell-sub" style="white-space:normal;flex:1">Showing only the ${num(f.only.rows.size)} ${plural(f.only.rows.size, 'deal', 'deals')} in the alert &ldquo;${esc(f.only.label)}&rdquo;.</div>
             <button class="btn sm" id="dClearOnly">Show all ${num(deals.length)} deals</button>
           </div>`
        : '';
      noteEl.innerHTML = onlyBar + (notes.length
        ? `<div class="list-item" style="cursor:default">
             <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
             <div class="cell-sub" style="white-space:normal">${notes.map(esc).join('<br>')}</div></div>`
        : '');
      noteEl.querySelector('#dClearOnly')?.addEventListener('click', () => { f.only = null; draw(); });
      th.innerHTML = table(cols, rows, {
        onRow: true,
        empty: stateEmpty('No deal matches these filters',
          'Clear the search, widen the period or pick another memory state.', 'filter_alt_off'),
      });
      wireRows(th, rows, openDeal);
    }

    listCard.querySelector('#dq').addEventListener('input', e => { f.q = e.target.value; draw(); });
    listCard.querySelector('#dPeriod').addEventListener('change', e => { f.period = e.target.value; draw(); });
    listCard.querySelector('#dMem').addEventListener('change', e => { f.memory = e.target.value; draw(); });
    listCard.querySelector('#dSort').addEventListener('change', e => { f.sort = e.target.value; draw(); });

    /* An alert is only useful if it lands on the rows it is about, so this
       clears every filter that could hide them rather than narrowing whatever
       view the operator happens to be in and showing them nothing. */
    focusList = ({ memory = 'ALL', period = 'ALL', only = null } = {}) => {
      f.memory = memory; f.period = period; f.q = ''; f.only = only;
      listCard.querySelector('#dMem').value = memory;
      listCard.querySelector('#dPeriod').value = period;
      listCard.querySelector('#dq').value = '';
      draw();
      const first = th.querySelector('tbody tr');
      if (first) {
        first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        /* Re-adding the class alone does not restart a running animation;
           reading a layout property between the remove and the add does. */
        first.classList.remove('flash'); void first.offsetWidth; first.classList.add('flash');
      } else {
        listCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

    draw();
  }

  /* pickerLeads, not `leads`: see the block above. The list is chosen and
     anchored by lib/identity.js, and the raw `leads` array is left untouched
     for the phone fallback and leadsByKey, which need what the database
     actually returned. */
  $('newDeal')?.addEventListener('click', () => dealForm(pickerLeads, () => go('deals')));

  /* ── Vector memory ─────────────────────────────────────────────────────── */
  if (vecErr) {
    vecCard.innerHTML = `<div class="card-head"><div><div class="card-title">Vector memory</div>
      <div class="card-sub">What the Closed-Won workflow has embedded into pgvector</div></div></div>
      ${stateError('the vector memory', vecErr)}`;
  } else if (!vectors.length) {
    vecCard.innerHTML = `<div class="card-head"><div><div class="card-title">Vector memory</div>
      <div class="card-sub">What the Closed-Won workflow has embedded into pgvector</div></div></div>
      ${stateEmpty('deals_embeddings has no rows at all',
        deals && deals.length
          ? `The table is empty, not merely behind: none of the ${deals.length} recorded deals has been embedded, so Ask AI has no closed-deal memory to search. Only the Closed-Won workflow writes here.`
          : 'Nothing has been embedded yet. Recording a closed-won deal sends it to the workflow that writes this table.', 'database')}`;
  } else {
    const shown = vectors.slice(0, VEC_SHOWN);
    vecCard.innerHTML = `<div class="card-head"><div>
        <div class="card-title">Vector memory</div>
        <div class="card-sub">${num(vectors.length)} row${vectors.length === 1 ? '' : 's'} the Closed-Won workflow has embedded into pgvector${
          vecCapped ? ` · <span class="t-warm">capped at ${num(VEC_LIMIT)}, so this is a window rather than the whole store</span>` : ''}</div>
      </div></div>
      <div style="max-height:50vh;overflow-y:auto">${shown.map(x => `
        <div class="list-item" style="cursor:default;align-items:flex-start"${usedVectors.has(x) ? '' : ' data-orphan="1"'}>
          <div style="flex:1;min-width:0">
            <div class="mono" style="font-weight:500;font-size:12px">${esc(x.deal_id || 'no deal_id')}</div>
            <div class="cell-sub" style="white-space:normal">${esc(String(x.content || '').slice(0, 220))}${
              String(x.content || '').length > 220 ? '…' : ''}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="cell-sub">${esc(ago(x.created_at))}</div>
            ${usedVectors.has(x) ? '' : '<div class="cell-sub t-hot">no row in purchase_history</div>'}
          </div>
        </div>`).join('')}
        ${vectors.length > shown.length
          ? `<div class="list-item" style="cursor:default"><div class="cell-sub">${num(vectors.length - shown.length)} more embedded row${vectors.length - shown.length === 1 ? '' : 's'} not shown</div></div>`
          : ''}</div>`;
  }

  /* Sends the operator to the orphaned vector rows. They are not deals, so
     there is nothing in the deal list to select — the Vector memory panel is
     where they live and it marks them. */
  function focusVectors() {
    const first = vecCard.querySelector('[data-orphan]');
    (first || vecCard).scrollIntoView({ behavior: 'smooth', block: first ? 'center' : 'start' });
    if (first) { first.classList.remove('flash'); void first.offsetWidth; first.classList.add('flash'); }
  }

  /* ── The alert strip ───────────────────────────────────────────────────── */
  /* Painted last, because every alert has to be able to open the thing it is
     about and those targets are built above. */
  function paintAttention() {
    const derived = deriveAlerts();
    const jumps = [];

    const item = a => {
      const t = tone(a.severity);
      let idx = -1;
      if (a.focus === 'vectors') idx = jumps.push({ kind: 'vectors' }) - 1;
      else if (a.rows && a.rows.length && deals) idx = jumps.push({ kind: 'list', label: a.title, rows: a.rows, filter: a.filter }) - 1;
      const attrs = idx >= 0
        ? ` role="button" tabindex="0" data-jump="${idx}"`
        : ` style="cursor:default" title="${esc(a.noFocus || 'This alert is not about one row on this screen, so there is nothing here to open.')}"`;
      /* The flag has to follow the `||`, because the two sides of it have
         different provenance and pill()'s default gets both wrong here. With no
         severity the label is ALERT — a word this file wrote, nowhere in any
         column — and `t` is '' , so the default (`!t`) turned true and hung
         "shown exactly as the database holds it" on our own noun. With a
         severity the view invented, `t` is 'unknown' and truthy, so the default
         turned false and dropped the note from the one label it was written
         for. Every derived alert below is CRITICAL or WARNING and every one of
         those is in TONE, so the note can only ever appear on a genuinely
         unrecognised v_needs_attention.severity, which is exactly right. */
      return `<div class="list-item"${attrs}>
        <span class="material-symbols-outlined t-${t}" style="font-size:20px" aria-hidden="true">${esc(a.icon || 'warning')}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${pill(str(a.severity) || 'ALERT', t, { verbatim: !!str(a.severity) })}<span>${esc(a.title)}</span>
          </div>
          <div class="cell-sub" style="white-space:normal">${esc(a.detail)}</div>
          ${a.fix ? `<div class="cell-sub t-muted" style="white-space:normal;margin-top:4px">${esc(a.fix)}</div>` : ''}
        </div>
        <div class="cell-sub num" style="white-space:nowrap" title="${esc(a.atNote || '')}">${esc(a.at ? ago(a.at) : '—')}</div>
        ${idx >= 0 ? '<span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">chevron_right</span>' : ''}
      </div>`;
    };

    /* The view's own rows first — they are Postgres's judgement about this
       screen, not this file's — then the ones derived here, by severity. */
    const fromView = (viewRows || []).map(r => {
      const ref = str(r.ref);
      /* v_needs_attention.ref for a deals row could be a purchase_history id, a
         deal id or a contact key; match it against all three rather than
         guessing, and say plainly when it lands on nothing.

         The first two are surrogate ids and are compared as exact strings —
         that is all they are. The third is a contact key and goes through
         lib/identity.js, because the view is fed by the same workflows that
         write `<digits>@c.us` and `<digits>@lid` into their email columns: a
         ref of `971501234567@c.us` against a deal filed under a real address is
         the same person, and a lowered-string comparison sends the operator to
         a row that "matches no deal" while the deal is on the screen in front
         of them. */
      const refId = normalizeKey(ref);
      const hit = (deals || []).filter(d => {
        const ids = [d.id, d.deal_id].map(lower).filter(Boolean);
        if (ids.includes(lower(ref))) return true;
        if (!refId.usable) return false;
        return canonicalsOf(identityOf(d)).includes(refId.canonical);
      });
      return {
        severity: r.severity,
        icon: KIND_ICON[r.kind] || 'warning',
        title: str(r.title) || ref || 'Needs attention',
        detail: [str(r.detail), ref ? `Ref ${ref}` : ''].filter(Boolean).join(' · '),
        at: r.at,
        atNote: 'How long v_needs_attention has been reporting this row.',
        rows: hit,
        noFocus: deals
          ? `v_needs_attention reports ${ref || 'a deal'}, which matches no deal among the ${num(deals.length)} rows this screen loaded — it may sit beyond the row cap or key on something purchase_history does not carry.`
          : 'The deal read failed, so this row cannot be opened here.',
      };
    });
    const fromHere = derived.alerts;

    const notes = [
      viewErr
        ? `v_needs_attention did not load (${viewErr}), so anything the database itself flags for this screen is missing from this strip. Only the checks derived from the rows here are shown, and the total above counts those alone.`
        : '',
      ...derived.notes,
      /* The reconciliation is stated whether or not it fired. It is the guard
         against a regression that already happened once, and a guard nobody can
         see is a guard nobody notices has stopped working. */
      deals && vectors
        ? `Closed-won reconciliation: purchase_history holds ${num(deals.length)} ${plural(deals.length, 'row', 'rows')} and deals_embeddings holds ${num(vectors.length)}`
          + (!deals.length && !vectors.length
              /* Both empty is agreement in the arithmetic only. Saying "every
                 deal has an embedding" over two empty tables is a pass nobody
                 earned, and it would read identically on the day the workflow
                 stops writing either one. */
              ? ' — both are empty, so there is nothing to reconcile yet rather than a check that passed.'
              : !orphanVectors.length && !unembedded.length && deals.length === vectors.length
                ? ' — every deal has an embedding, every embedding has a deal, and the totals match.'
                : '.')
        : '',
    ].filter(Boolean);
    const foot = `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">info</span>
      <div class="cell-sub" style="white-space:normal">${notes.map(esc).join('<br>')}</div></div>`;

    if (!fromView.length && !fromHere.length) {
      /* "Nothing needs you" and "nothing could be checked" are opposite facts
         and must never share a sentence. The empty case names every check that
         actually ran, so it reads as a statement rather than as a blank. */
      const ranHere = !!deals;
      /* With nothing recorded, "every deal has an embedding" is vacuously true
         and reads as reassurance about a table that is empty. Say that instead. */
      const nothingYet = !!deals && !deals.length;
      const checked = nothingYet ? [] : [
        vectors ? 'every recorded deal has a row in the vector memory and every embedded deal has a row in purchase_history' : '',
        (deals && col.unit && inv && inv.length) ? 'every deal is linked to a unit in inventory that is no longer marked Available' : '',
        /* A quote found for every deal is a check that passed and is worth
           saying so, for the same reason the closed-won reconciliation is
           stated in its passing case: a guard nobody can see is a guard nobody
           notices has stopped working. It is only claimed when finance_quotes
           actually came back and actually held rows. */
        (deals && quotes && quotes.length) ? 'every deal has a finance quote on file for its customer' : '',
      ].filter(Boolean);
      /* Joined here rather than with a bare '; ' so that adding a fourth check
         cannot leave the sentence reading "a; b; c." with no conjunction. */
      const checkedList = checked.length < 2
        ? (checked[0] || '')
        : `${checked.slice(0, -1).join('; ')}; and ${checked[checked.length - 1]}`;
      const head = !ranHere ? 'Nothing on this screen could be checked'
        : nothingYet ? 'No deal has been recorded yet'
          : viewErr ? 'Nothing flagged by the checks that ran'
            : 'No closed-won deal needs a human right now';
      const line = !ranHere
        ? `purchase_history did not load, so none of the checks this screen derives could run, and v_needs_attention reported ${viewErr ? 'nothing usable' : 'nothing'} for it either.`
        : nothingYet
          ? `purchase_history is empty, so there is no deal to check and nothing here to act on. ${viewErr ? "v_needs_attention did not load either." : 'v_needs_attention returned no row for this screen.'}`
          : viewErr
            ? `${checked.length ? checkedList + '.' : 'None of the derived checks could run.'} That is only the half of this strip the screen derives itself — the database's own list did not load.`
            : `v_needs_attention returned no row for this screen, and ${checked.length ? checkedList + '.' : 'none of the derived checks could run.'}`;
      attnHost.innerHTML = `<div class="card" style="display:flex;gap:10px;align-items:flex-start">
        <span class="material-symbols-outlined t-${ranHere && !viewErr ? 'ok' : 'muted'}" aria-hidden="true">${ranHere && !viewErr ? 'task_alt' : 'help'}</span>
        <div style="flex:1">
          <div style="font-weight:500">${esc(head)}</div>
          <div class="cell-sub" style="white-space:normal">${esc(line)}${notes.length ? '<br>' + notes.map(esc).join('<br>') : ''}</div>
        </div></div>`;
      return;
    }

    /* The view's half of this count is a read with a limit on it, so it is a
       window and only says "total" when it demonstrably is one. A capped count
       described as a total is the class of error this pass is closing
       everywhere; live today the view returns 12 rows across every screen and
       none for this one, which is exactly the state in which nobody would
       notice the wording was wrong. */
    const counted = `${num(fromView.length)} from v_needs_attention${
        attnCapped ? ` — the read was capped at ${num(ATTN_LIMIT)} rows, so this is a window and there may be more` : ''
      } · ${num(fromHere.length)} derived here`
      + (deals == null ? ' · the deal rows did not load' : ` from the ${num(deals.length)} ${plural(deals.length, 'deal', 'deals')} on this screen`);
    attnHost.innerHTML = `<div class="card flush">
      <div class="card-head"><div>
        <div class="card-title">Needs attention</div>
        <div class="card-sub">${esc(counted)}</div>
      </div><div style="flex:1"></div></div>
      <div>${fromView.map(item).join('')}${fromHere.map(item).join('')}${foot}</div></div>`;

    /* Keyboard-operable: the row is the only way from the alert to the deals it
       is about, so a mouse-only affordance would strand anyone on a keyboard. */
    attnHost.querySelectorAll('[data-jump]').forEach(n => {
      const j = jumps[Number(n.dataset.jump)];
      const go_ = () => {
        if (j.kind === 'vectors') return focusVectors();
        focusList({ ...(j.filter || {}), only: { label: j.label, rows: new Set(j.rows) } });
      };
      n.addEventListener('click', go_);
      n.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go_(); }
      });
    });
  }
  paintAttention();

  /* ── One deal, in full ─────────────────────────────────────────────────── */
  function openDeal(d) {
    const v = vectorFor(d);
    const m = marginOf(d);
    const a = amountOf(d);
    const u = unitFor(d);
    const ref = unitRefOf(d);
    /* Every column the row actually came back with is listed. This is the
       screen an argument about a number ends on, so nothing is hidden behind a
       curated subset — money columns are formatted, everything else is printed
       as the database returned it. */
    const rowKeys = Object.keys(d).sort();
    const fmt = (k, val) => {
      if (val == null || val === '') return '<span class="t-muted">—</span>';
      if (/_aed$|^net_margin$/.test(k) && n0(val) != null) return esc(aed(val));
      if (typeof val === 'object') return `<span class="mono">${esc(JSON.stringify(val).slice(0, 200))}</span>`;
      return esc(String(val).slice(0, 300));
    };

    /* What we can and cannot say about the car, in that order. "Not linked",
       "linked to something that is not there" and "linked to a unit still on
       sale" are three different problems with three different fixes. When the
       unit does resolve, the line under it says what inventory cannot tell us:
       there is no sale-date column, so a resolved unit still leaves the sale
       cycle unmeasurable. */
    const unitBlock = !col.unit
      ? `<span class="t-warm">Not answerable.</span> <span class="t-muted">purchase_history has no column linking a deal to an inventory unit, and the vehicle above is free text typed into the deal form rather than a reference. inventory carries no deal reference and no sale date either, so which car left the lot for this money is not recorded on either side. It cannot be looked up, only re-entered — which is why there is no control below offering to fix it.</span>`
      : !ref
        ? `<span class="t-warm">Not linked.</span> <span class="t-muted">The ${esc(col.unit)} column is empty on this row.</span>`
        : !inv
          ? `<span class="mono">${esc(ref)}</span> <span class="t-muted">— inventory could not be read (${esc(invErr)}), so this reference could not be resolved.</span>`
          : !u
            ? `<span class="mono">${esc(ref)}</span> <span class="t-warm">— no inventory row has this id (the stock number) or VIN among the ${num(inv.length)} read${invCapped ? `, and that read was capped at ${num(INV_LIMIT)}` : ''}.</span>`
            : `<span class="mono">${esc(unitLabel(u))}</span> ${pill(str(u.status) || 'No status', lower(u.status) === 'available' ? 'hot' : lower(u.status) === 'sold' ? 'ok' : 'warm', { verbatim: !!str(u.status) })}
               <div class="cell-sub">${lower(u.status) === 'available'
                 ? '<span class="t-hot">Still marked Available — it can be sold again.</span> '
                 : ''}<span class="t-muted">inventory records no sale date, so this car\'s time on the lot cannot be measured against the deal above. ${
                 n0(u.days_in_stock) != null
                   ? `days_in_stock reads ${esc(num(u.days_in_stock))} and keeps counting from acquisition, so it is not that figure.`
                   : 'days_in_stock counts from acquisition and does not stop at a sale, so it is not that figure either.'}</span></div>`;

    /* The finance quote behind this sale, and the exact limit of what its
       absence proves. No figure from the quote is printed here: a payment, an
       APR, a down payment or an equity number is the Finance Calculator's
       output and it is read on the Finance Desk, which is the one screen that
       owns it. Printing it in two places is how one quote becomes two numbers.
       Nothing on this screen computes any of them. */
    const qs = quotesFor(d);
    const quoteBlock = !quotes
      ? `<span class="t-warm">Unknown.</span> <span class="t-muted">finance_quotes could not be read (${esc(quoteErr)}), so whether a quote is on file for this customer could not be checked. This is unknown, not none.</span>`
      : (qs && qs.length)
        ? `<span class="t-ok">${num(qs.length)} quote${qs.length === 1 ? '' : 's'} on file</span> <span class="cell-sub">${qs.slice(0, 3).map(quoteLine).join(' · ')}${qs.length > 3 ? ` · and ${num(qs.length - 3)} more` : ''}</span>
           <div class="cell-sub t-muted">Matched to this customer through lib/identity.js — purchase_history carries no quote reference, so this is the same PERSON, not a link between the two rows. The figures are on the Finance Desk; this screen does not restate them.</div>`
        : `<span class="t-warm">No record of one.</span> <span class="t-muted">${identityOf(d).ok
            ? `No finance_quotes row is filed under any of the ${num(identityOf(d).keys.length)} key${identityOf(d).keys.length === 1 ? '' : 's'} this customer is recorded under${quotesCapped ? `, within the ${num(QUOTE_LIMIT)} quotes that were read` : ''}.`
            : 'This deal row carries no key that identifies anybody, so it could not be matched against finance_quotes at all.'} That says the RECORD is missing. It does not say the customer was never quoted: the Finance Calculator has logged runs whose own summary is "Quote issued" beside a finance_quotes row that did not land, and a quote lost that way is indistinguishable here from one that was never asked for.</span>`;

    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1;min-width:0">
          <div class="card-title">${esc(nameOf(d) || 'Unnamed customer')}</div>
          <div class="card-sub">${esc(get(d, 'vehicle') || 'No vehicle recorded')}${
            a == null ? '' : ' · ' + esc(aed(a))}${dateOf(d) ? ' · closed ' + esc(day10(dateOf(d))) : ''}</div>
        </div>
        <button class="btn ghost" id="ddClose" aria-label="Close deal details">
          <span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        <div class="section">
          <div class="label-caps">Deal</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Customer</dt><dd>${esc(nameOf(d) || '—')}</dd>
            <dt>Phone</dt><dd>${phoneLine(d)}</dd>
            <dt>Email</dt><dd>${contactLine(d, '—')}</dd>
            <dt>Vehicle</dt><dd>${esc(get(d, 'vehicle') || '—')}</dd>
            <dt>Inventory unit</dt><dd>${unitBlock}</dd>
            <dt>Amount</dt><dd class="num">${a == null ? '<span class="t-muted">Not recorded</span>' : esc(aed(a))}</dd>
            <dt>Gross margin</dt><dd class="num">${m == null
              ? '<span class="t-muted">No margin column, and no amount and cost to subtract</span>'
              : `${esc(aed(m))}${a
                  ? ` <span class="cell-sub">(${esc(pct(m / a * 100))})</span>`
                  : ` <span class="cell-sub t-muted">(no percentage — ${a == null ? 'this row records no sale amount' : 'the sale amount on this row is zero'}, so there is nothing to take a percentage of)</span>`}`}</dd>
            <dt>Closed on</dt><dd>${dateOf(d) ? esc(day10(dateOf(d))) + ` <span class="cell-sub">${esc(ago(dateOf(d)))}</span>` : '<span class="t-muted">Not recorded</span>'}</dd>
            <dt>Finance quote</dt><dd>${quoteBlock}</dd>
          </dl>
        </div>

        <div class="section">
          <div class="label-caps">Vector memory</div>
          ${vecErr
            ? `<div class="cell-sub" style="margin-top:8px">deals_embeddings could not be read (${esc(vecErr)}), so whether this deal is embedded is unknown.</div>`
            : v
              ? `<div style="margin-top:8px">${pill('Embedded', 'ok', { verbatim: false })}</div>
                 <div class="cell-sub mono" style="margin-top:8px">${esc(v.deal_id || 'no deal_id')}</div>
                 <div class="quote" style="margin-top:8px;white-space:pre-wrap">${esc(String(v.content || 'The vector row carries no content.'))}</div>
                 <div class="cell-sub" style="margin-top:8px">Embedded ${esc(ago(v.created_at))}</div>`
              : `<div class="cell-sub" style="margin-top:8px">${vecCapped
                  ? `No match inside the ${num(VEC_LIMIT)} vector rows that were read. This deal may still be embedded outside that window.`
                  : 'No row in deals_embeddings matches this deal, so Ask AI cannot quote it.'}</div>`}
        </div>

        <div class="section">
          <div class="label-caps">Row as stored</div>
          <dl class="kv" style="margin-top:8px">
            ${rowKeys.map(k => `<dt class="mono">${esc(k)}</dt><dd>${fmt(k, d[k])}</dd>`).join('')}
          </dl>
        </div>
      </div>
      <div class="drawer-foot">
        <button class="btn" id="ddDone">Close</button>
        <button class="btn" disabled title="${esc(NO_REEMBED)}">Re-embed this deal</button>
        ${/* Only offered where there is a unit to mark. A disabled button says
              "this is blocked", which invites someone to go and unblock it; with
              no link column there is no unit to act on and nothing to unblock,
              so the control is absent and the Inventory unit row above carries
              the sentence instead. */
          col.unit ? `<button class="btn" disabled title="${esc(NO_UNIT_FIX)}">Mark unit sold</button>` : ''}
      </div>`);

    $('ddClose')?.addEventListener('click', closeDrawer);
    $('ddDone')?.addEventListener('click', closeDrawer);
  }
};
