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

   Nothing here processes a card. There is no card processor. Every AED 399
   this dealership will ever pay NEXUS arrives by bank transfer or cash, and
   the only record of it having happened is Ali typing a reference into the
   founder panel at the bottom of this screen (visible only to Ali) and
   subscription_event holding what he typed, forever, unchangeable.

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

   `public.nexus_is_platform_admin()` decides whether the founder panel draws
   at all. A `false` here is not this screen refusing to show a button — the
   function itself refuses the write regardless of what this file renders, so
   the check here is purely about not showing a form that would only ever
   answer refused.

   ═══════════════════════════════════════════════════════════════════════════
   NX1008 — WHERE "HOW TO PAY" NOW COMES FROM
   ═══════════════════════════════════════════════════════════════════════════
   This screen used to hard-code NEXUS's own bank details as a JS object
   right here in this file, with a comment telling Ali to type the real
   account in and redeploy. That would have shipped a real bank account
   inside this app's public JS bundle -- readable by anyone, signed in or
   not -- and turned every correction to it into a code change. NX1008 moved
   the account to public.platform_payment_details (RLS on, no policies --
   reachable only through a SECURITY DEFINER RPC) and gave Ali a form for it
   on the Founder Console instead of a file to edit.
   public.nexus_payment_instructions() is that RPC's dealer-facing half: it
   returns nothing at all until Ali has filled the details in, and this
   screen shows a plain "being set up" message for exactly that shape --
   never a placeholder someone could mistake for a real account. */
import { db, dbWrite, onIdentityChange } from '../lib/data.js';
import { esc, n0 } from '../lib/format.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty } from '../lib/states.js';
import { kpi, panel, table } from '../lib/ui.js';
import { openModal } from '../lib/modal.js';
import { refreshSubscription } from '../lib/subscription.js';
import { loadPlatformAdmin } from '../lib/platform.js';

const str = v => String(v == null ? '' : v).trim();
const muted = h => `<div class="cell-sub">${h}</div>`;
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
  resetReads();

  /* ────────────────────────────────────────────────────────────────────────
     P1 · What this dealership is on
     ──────────────────────────────────────────────────────────────────────── */
  panel(host, {
    title: 'Your subscription',
    sub: 'NEXUS Dealer, AED 399/month, first month free. There is no card on file -- every payment is a bank '
       + 'transfer or cash that Ali records by hand once it arrives',
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
  panel(host, {
    title: 'How to pay',
    sub: 'Bank transfer only. NEXUS holds no card processor and takes no payment through this screen -- this is '
       + 'where to send it, not a checkout',
    load: () => readPay(),
    render: rows => {
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row) {
        return stateEmpty('Payment details are being set up — contact NEXUS',
          'NEXUS has not finished recording its bank account for this platform yet. There is nothing to fix on '
          + 'your side -- this is set from the Founder Console, and this message is replaced the moment it is.',
          'hourglass_empty');
      }
      return table([
        { label: 'Field', strong: true, render: r => bold(esc(r.label)) },
        { label: 'Value', render: r => wrap(`<span class="mono">${esc(r.value)}</span>`) },
      ], [
        { label: 'Amount', value: 'AED 399 / month' },
        { label: 'Account holder', value: str(row.account_holder) },
        { label: 'Bank name', value: str(row.bank_name) },
        { label: 'IBAN', value: str(row.iban) },
        { label: 'SWIFT / BIC', value: str(row.swift_bic) },
        { label: 'Currency', value: str(row.currency) || 'AED' },
        { label: 'Reference', value: str(row.reference) },
      ]) + muted(`Use <span class="mono">${esc(str(row.reference))}</span> as your transfer reference so the `
        + 'payment can be matched to your dealership. After transfer, send the receipt to '
        + '<span class="mono">aliasgher892@gmail.com</span> -- access is extended when the founder records the '
        + 'payment.');
    },
  });

  /* ────────────────────────────────────────────────────────────────────────
     P3 · Founder panel — renders only for a platform admin, and the RPC
     refuses regardless of whether this draws
     ──────────────────────────────────────────────────────────────────────── */
  /* The tenant id the button below needs comes back from load(); the click
     handler is wired separately via .then(), so it is captured here rather
     than re-read from the DOM or re-queried on click. */
  let founderTenantId = null;
  panel(host, {
    title: 'Founder: record a payment',
    sub: 'Visible only to a NEXUS platform admin. Marks THIS dealership paid by hand -- nexus_founder_mark_paid() '
       + 'refuses this even if you can somehow see the button, so this is convenience, not the security boundary',
    load: async () => {
      const [isAdmin, subRows] = await Promise.all([loadPlatformAdmin(), readSub()]);
      return { isAdmin, tenantId: Array.isArray(subRows) && subRows[0] ? subRows[0].tenant_id : null };
    },
    render: ({ isAdmin, tenantId }) => {
      founderTenantId = tenantId;
      if (!isAdmin) {
        return stateEmpty('Not visible to your account',
          'This panel only draws for a NEXUS platform admin. It refusing to show you a form is not an error -- it '
          + 'is the same rule nexus_founder_mark_paid() enforces at the database either way.', 'lock');
      }
      if (!tenantId) {
        return stateEmpty('No dealership to mark paid', 'Your own subscription record has no tenant id.', 'error');
      }
      return `<button class="btn primary" id="markPaidBtn">Record a payment for this dealership</button>`
        + muted('Opens a small form: how many months this payment covers, and the bank/cash reference to reconcile '
          + 'it against later. Extends from the current paid-through date if there is time left on it, otherwise '
          + 'starts from today.');
    },
  }).then(card => {
    card.querySelector('#markPaidBtn')?.addEventListener('click', async () => {
      const tenantId = founderTenantId;
      const body = `<div class="grid" style="gap:14px">
        <div class="field"><label for="mpMonths">Months paid for</label>
          <input type="number" id="mpMonths" min="1" max="12" value="1" /></div>
        <div class="field"><label for="mpRef">Payment reference</label>
          <input type="text" id="mpRef" placeholder="Bank transfer id, receipt number, etc." /></div>
      </div>`;
      const m = openModal('Record a payment', body,
        `<button class="btn primary" id="mpGo">Record</button><button class="btn ghost" id="mpCancel">Cancel</button>`);
      m.wrap.querySelector('#mpCancel').addEventListener('click', m.close);
      m.wrap.querySelector('#mpGo').addEventListener('click', async () => {
        const btn = m.wrap.querySelector('#mpGo');
        const months = Number(m.wrap.querySelector('#mpMonths').value);
        const reference = m.wrap.querySelector('#mpRef').value.trim();
        if (!reference) { m.msg('A reference is required -- nexus_founder_mark_paid() will refuse without one.'); return; }
        btn.disabled = true; btn.textContent = 'Recording…';
        try {
          await dbWrite('POST', 'rpc/nexus_founder_mark_paid', {
            p_tenant: tenantId, p_months: months, p_reference: reference,
          });
          m.close();
          resetReads();
          await refreshSubscription();
          location.hash = 'subscription';
        } catch (e) {
          btn.disabled = false; btn.textContent = 'Record';
          m.msg(esc(str(e && e.message) || 'The database refused this. Nothing was recorded.'));
        }
      });
    });
  });

  /* ────────────────────────────────────────────────────────────────────────
     P4 · Payment history
     ──────────────────────────────────────────────────────────────────────── */
  panel(host, {
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
