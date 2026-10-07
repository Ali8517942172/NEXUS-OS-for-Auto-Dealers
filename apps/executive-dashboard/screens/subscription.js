/* NEXUS OS — screens/subscription.js
   Added 21 Sep 2026 by NX1003. The one screen that answers, for a signed-in
   dealer, "are we still paying for this, and what happens if we don't".

   ═══════════════════════════════════════════════════════════════════════════
   WHY THIS SCREEN EXISTS
   ═══════════════════════════════════════════════════════════════════════════
   NX990 built a subscription ledger nobody could see. This migration's own
   backfill puts every existing dealership into a 30-day free trial the moment
   it ships, and a countdown nobody can read is not a trial, it is a surprise.
   The rule this screen explains, plainly, is the whole commercial model:

       TRIAL (30 days) -> GRACE (7 days) -> READ_ONLY, until paid.

   Nothing here processes a card directly. There is no card processor
   integration in this app -- Pay now opens Ali's own hosted Ziina payment
   link in a new tab, and Ziina handles the card. Either way, the only
   record of a payment having happened on NEXUS's side is Ali typing a
   reference into the separate founder page (/founder -- never part of this
   dealer app since 22 Sep 2026) and subscription_event holding what he
   typed, forever, unchangeable.

   ═══════════════════════════════════════════════════════════════════════════
   WHERE THE ANSWER COMES FROM
   ═══════════════════════════════════════════════════════════════════════════
   `public.nexus_my_subscription()` — one SECURITY DEFINER accessor, scoped to
   the caller's own dealership(s) by nexus_current_tenant_ids(), shaped exactly
   like nexus_channel_status() and nexus_subscription_status() before it: it
   returns `access` and `evidence` ALREADY COMPUTED. This file infers nothing
   about grace-period arithmetic — if the 30/7-day rule ever changes, it
   changes in the migration and this screen changes with it untouched.

   `subscription_event`, read directly (RLS already scopes it to the caller's
   own tenant — NX990's `subscription_event_authenticated_read` policy), is
   the payment history: append-only, so what it shows cannot have been quietly
   edited after the fact.

   Nothing on this screen is founder-only. The "record a payment" control
   that used to draw here for a platform admin moved to the founder page on
   22 Sep 2026, so a dealer's Subscription screen is the same for every
   account, the founder's included.

   ═══════════════════════════════════════════════════════════════════════════
   NX1008/NX1010 — WHERE "HOW TO PAY" NOW COMES FROM
   ═══════════════════════════════════════════════════════════════════════════
   This screen used to hard-code NEXUS's own bank details as a JS object
   right here in this file, with a comment telling Ali to type the real
   account in and redeploy. That would have shipped a real bank account
   inside this app's public JS bundle -- readable by anyone, signed in or
   not -- and turned every correction to it into a code change. NX1008 moved
   the account to public.platform_payment_details (RLS on, no policies --
   reachable only through a SECURITY DEFINER RPC) and gave Ali a form for it
   on the Founder Console instead of a file to edit.

   NX1010 changed WHAT is shown, not the mechanism: the owner decided a
   dealer must never see a bank name, an account holder name or an IBAN at
   all. public.nexus_payment_instructions() now returns only display_name,
   a fixed amount_aed of 399, currency, payment_link_url (a Ziina hosted
   payment link Ali pastes into the Founder Console) and this dealership's
   own reference -- never a bank field, because the RPC's return table has
   no column for one. A dealer always gets a row back once it has an active
   membership; payment_link_url is null until Ali sets it, and this screen
   renders that as "online payment is being set up", never as an error. */
import { db, onIdentityChange } from '../lib/data.js';
import { el } from '../lib/dom.js';
import { esc, n0 } from '../lib/format.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty } from '../lib/states.js';
import { kpi, panel, table } from '../lib/ui.js';

const str = v => String(v == null ? '' : v).trim();
const muted = h => `<div class="ds-cell-sub">${h}</div>`;
const bold  = h => `<div style="font-weight:600">${h}</div>`;
const wrap  = h => `<div style="white-space:normal">${h}</div>`;

/* ── The memo, reset per identity, same pattern as screens/channels.js ───── */
const MEMOS = new Set();
const shared = make => {
  let p = null;
  const f = () => { if (!p) { p = make(); p.catch(() => { p = null; }); } return p; };
  MEMOS.add(() => { p = null; });
  return f;
};
const resetReads = () => { MEMOS.forEach(reset => reset()); };
onIdentityChange(resetReads);

const readSub    = shared(() => db('rpc/nexus_my_subscription'));
const readEvents = shared(() => db('subscription_event?select=event_id,event_type,from_state,to_state,price_aed,occurred_at,actor,reason&order=occurred_at.desc&limit=50'));
/* readPay never rejects: nexus_payment_instructions() failing (network blip,
   a stale offline schema snapshot that predates NX1008, or any other RPC
   error) is not a reason to show this dealer a red error card for a panel
   that is informational, not actionable. It is treated exactly like the
   RPC's own "nothing filled in yet" zero-row response -- both render as the
   same "Payment details are being set up" empty state below. A genuine
   defect in the RPC still shows up wherever P1's own readSub() call reads
   the same connection and fails loudly. */
const readPay    = shared(() => db('rpc/nexus_payment_instructions').catch(() => []));

const ACCESS_TONE = { full: 't-ok', grace: 't-warm', read_only: 't-hot' };
const ACCESS_LABEL = { full: 'Full access', grace: 'Grace period', read_only: 'Read-only' };

SCREENS.subscription = async host => {
  /* `.ds-screen` is the class lib/design-system.css gates its handful of
     upgrades to existing chrome behind. It goes on a wrapper this screen
     appends, and NOT on `#screen`, because lib/nav.js empties `#screen` between
     renders without touching its classes: a class set there would follow the
     operator onto Leads or Money Leaks and restyle a screen nobody converted.
     A wrapper cannot leak — go() removes it with the rest of the subtree. Same
     pattern as screens/inventory.js, screens/leads.js, screens/overview.js,
     screens/money-leaks.js, screens/conversations.js and screens/setup.js. */
  const root = el('div', 'ds-screen');
  host.appendChild(root);

  resetReads();

  /* ────────────────────────────────────────────────────────────────────────
     P1 · What this dealership is on
     ──────────────────────────────────────────────────────────────────────── */
  panel(root, {
    title: 'Your subscription',
    sub: 'NEXUS Dealer, AED 399/month, first month free. There is no card on file in this app -- pay online via '
       + 'the Pay now link below, or by bank transfer or cash, and Ali records it by hand once it arrives',
    load: () => readSub(),
    render: rows => {
      const r = Array.isArray(rows) ? rows[0] : null;
      if (!r) {
        return stateEmpty('No subscription is recorded for this dealership',
          'nexus_my_subscription() returned nothing for your account. If you can read this screen at all you have a '
          + 'membership somewhere, so this should not happen -- tell NEXUS support.', 'receipt_long');
      }
      const statusTile = kpi('Status', esc(str(r.status) || '—'),
        muted(esc(str(r.evidence) || 'No further detail recorded.')));
      const accessTile = kpi('Access', ACCESS_LABEL[r.access] || esc(str(r.access) || '—'),
        muted(r.access === 'read_only'
          ? 'Reads keep working everywhere in NEXUS. Every write button is disabled until this is resolved.'
          : r.access === 'grace'
            ? 'Full access continues for now, on borrowed time -- see the countdown below.'
            : 'Nothing is restricted.'),
        ACCESS_TONE[r.access] || '');
      const priceTile = kpi('Price', r.price_aed != null ? `AED ${n0(r.price_aed)}/month` : '—',
        muted('Flat rate. No usage tiers, no per-seat charge.'));
      const days = n0(r.days_left);
      const countdownTile = kpi(
        r.access === 'grace' ? 'Grace ends in' : r.status === 'TRIAL' ? 'Trial ends in' : 'Countdown',
        days != null ? `${days} day${days === 1 ? '' : 's'}` : '—',
        muted(r.status === 'TRIAL'
          ? (r.trial_ends_at ? `Ends ${esc(new Date(r.trial_ends_at).toDateString())}.` : 'No end date recorded.')
          : r.access === 'grace'
            ? (r.grace ? `Read-only begins ${esc(new Date(r.grace).toDateString())} unless paid before then.` : '')
            : r.current_period_end
              ? `Paid through ${esc(new Date(r.current_period_end).toDateString())}.`
              : 'No countdown applies to this state.'),
        days != null && days <= 3 ? 't-hot' : days != null && days <= 7 ? 't-warm' : '');

      return `<div class="grid g4">${statusTile}${accessTile}${priceTile}${countdownTile}</div>`;
    },
  });

  /* ────────────────────────────────────────────────────────────────────────
     P2 · How to pay
     ──────────────────────────────────────────────────────────────────────── */
  panel(root, {
    title: 'How to pay',
    sub: 'Secure card payment by Ziina. Pay now opens the checkout in a new tab.',
    load: () => readPay(),
    render: rows => {
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) {
        return stateEmpty('Nothing to show',
          'nexus_payment_instructions() returned nothing for your account. If you can read this screen at all you '
          + 'have a membership somewhere, so this should not happen -- tell NEXUS support.', 'receipt_long');
      }
      const displayName = str(row.display_name) || 'Adqonic';
      const amount = row.amount_aed != null ? n0(row.amount_aed) : '399';
      const currency = str(row.currency) || 'AED';
      const link = str(row.payment_link_url);
      const reference = str(row.reference);
      const heading = `<div style="font-weight:600;font-size:1.05em">NEXUS by ${esc(displayName)}</div>`
        + muted(`${esc(currency)} ${esc(amount)} / month`);
      const payButton = link
        ? `<div style="margin-top:14px"><a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Pay now</a></div>`
        : muted('Online payment is being set up -- contact <span class="mono">aliasgher892@gmail.com</span>.');
      const refBlock = reference
        ? `<div style="margin-top:14px">${muted('Add this reference in the payment note:')}
            <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
              <span class="mono" id="payRefText">${esc(reference)}</span>
              <button class="btn sm ghost" id="payRefCopyBtn" type="button">Copy</button>
            </div>
          </div>`
        : '';
      return heading + payButton + refBlock
        + muted('Your access is extended once your payment is confirmed (usually within one business day).');
    },
  }).then(card => {
    const copyBtn = card.querySelector('#payRefCopyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const text = card.querySelector('#payRefText')?.textContent || '';
        const clip = navigator.clipboard;
        if (!clip || typeof clip.writeText !== 'function') {
          copyBtn.disabled = true;
          copyBtn.title = 'This browser exposes no clipboard API to the page.';
          return;
        }
        clip.writeText(text).then(
          () => { copyBtn.textContent = 'Copied'; },
          () => { copyBtn.textContent = 'Copy blocked'; copyBtn.title = 'The browser refused clipboard access for this page.'; });
      });
    }
  });

  /* ────────────────────────────────────────────────────────────────────────
     P3 · What your plan includes
     ────────────────────────────────────────────────────────────────────────
     Added 7 Oct 2026. Two accessors that already existed "for the dashboard"
     and that nothing called:

       nexus_subscription_status()     entitlement, and whether the stored state
                                       has gone stale (a lapsed trial still
                                       stored as TRIAL). It REPORTS entitlement
                                       and enforces nothing.
       nexus_my_tenant_capabilities()  one row per capability in the catalogue:
                                       AVAILABLE only where it is recorded as
                                       such for this dealership, NOT_AVAILABLE
                                       otherwise, with the catalogue's own
                                       `absent_means` sentence — rendered
                                       verbatim rather than as an empty chart.

     A capability being NOT_AVAILABLE is about what data or integration this
     dealership has connected, not about what the plan sells: the plan is one
     flat price and every feature is on it. Both reads are separate so one
     failing does not blank the other. */
  panel(root, {
    title: 'What your plan includes',
    sub: 'One plan, every feature. What changes from one dealership to the next is what NEXUS has to work with — '
       + 'below is what is connected for yours, and what each missing piece would unlock',
    load: async () => {
      const [s, c] = await Promise.all([
        db('rpc/nexus_subscription_status').then(v => ({ v, err: null }), e => ({ v: null, err: e })),
        db('rpc/nexus_my_tenant_capabilities').then(v => ({ v, err: null }), e => ({ v: null, err: e })),
      ]);
      if (s.err && c.err) throw s.err;
      return { s, c };
    },
    render: ({ s, c }) => {
      const st = s.err ? null : (Array.isArray(s.v) ? s.v[0] : null);
      const entitlement = s.err
        ? muted('Whether this dealership is entitled to the plan could not be read on this visit, so nothing is said either way.')
        : !st
          ? muted('No subscription state came back for this account.')
          : `<div class="section"><dl class="kv">
              <dt>Entitled</dt><dd>${st.entitled === true
                ? '<span class="t-ok">Yes</span>'
                : '<span class="t-hot">No</span>'}${muted('As the subscription record states it. This is a report, not a switch — nothing turns off on this answer.')}</dd>
              <dt>State</dt><dd>${esc(str(st.state) || 'not recorded')}${st.state_is_stale === true
                ? `<div class="ds-cell-sub t-warm">The stored state still reads ${esc(str(st.stored_state))}; the effective state above is what it actually is today.</div>`
                : ''}</dd>
              <dt>What that means</dt><dd>${wrap(esc(str(st.evidence) || 'No explanation recorded.'))}</dd>
            </dl></div>`;
      const caps = c.err ? null : (Array.isArray(c.v) ? c.v : []);
      const capBlock = caps == null
        ? muted('The capability list could not be read on this visit, so no feature is shown as present or missing.')
        : !caps.length
          ? stateEmpty('No capability list came back', 'The capability catalogue returned nothing for this account.', 'checklist')
          : table([
              { label: 'Capability', strong: true, render: k => `<div>${esc(str(k.label) || str(k.capability_key))}</div>`
                  + muted(esc(str(k.what_it_unlocks))) },
              { label: 'For your dealership', render: k => (str(k.state) === 'AVAILABLE'
                  ? '<span class="pill ok"><span class="dot"></span>Available</span>'
                    + (str(k.evidence) ? muted(esc(str(k.evidence))) : '')
                  : '<span class="pill unknown"><span class="dot"></span>Not connected</span>'
                    + muted(esc(str(k.absent_means)) || 'The catalogue says nothing about what its absence means.')) },
              { label: 'Needs', render: k => wrap(muted(esc(str(k.requires)) || 'Not stated.')) },
            ], caps);
      return entitlement + capBlock;
    },
  });

  /* ────────────────────────────────────────────────────────────────────────
     P4 · Payment history
     ──────────────────────────────────────────────────────────────────────── */
  panel(root, {
    title: 'Payment history',
    sub: 'Every change to your subscription state, in order, oldest reasoning intact -- subscription_event cannot '
       + 'be edited, only appended to',
    load: () => readEvents(),
    render: rows => {
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) {
        return stateEmpty('No subscription events yet',
          "Nothing has changed this dealership's subscription state since it was created.", 'history');
      }
      return table([
        { label: 'When', render: r => wrap(esc(r.occurred_at ? new Date(r.occurred_at).toLocaleString() : '—')) },
        { label: 'Event', strong: true, render: r => bold(esc(str(r.event_type) || '—')) },
        { label: 'From → to', render: r => wrap(esc(str(r.from_state) || '—') + ' → ' + esc(str(r.to_state) || '—')) },
        { label: 'Price', align: 'r', render: r => wrap(r.price_aed != null ? `AED ${n0(r.price_aed)}` : '—') },
        { label: 'Recorded by', render: r => wrap(esc(str(r.actor) || 'Not recorded')) },
        { label: 'Reason', render: r => wrap(esc(str(r.reason) || '—')) },
      ], list);
    },
  });
};
