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
/* ═══════════════════════════════════════════════════════════════════════════
   7 OCT 2026 — THE STITCH LAYOUT
   ═══════════════════════════════════════════════════════════════════════════
   design/stitch/subscription-plan-capabilities-billing--1818da.html (primary)
   and --aa3177. Sections, top to bottom, and what each is wired to:

     Header                        — no "Download tax summary" / "Update payment
                                     method": neither exists in NEXUS, so neither
                                     button is drawn.
     Status banner                 — nexus_my_subscription(): status, evidence,
                                     days left.
     Plan tier card                — the same read: price, status, access,
                                     countdown, the period the countdown runs to.
     Payment desk                  — nexus_payment_instructions(): Pay now link
                                     and this dealership's reference. Stitch's
                                     card-on-file and tax-registration rows have
                                     no data in NEXUS (no card is ever stored
                                     here) and are said to be absent, not drawn
                                     as "—" cells pretending to be fields.
     What your plan includes       — nexus_subscription_status() and
                                     nexus_my_tenant_capabilities() as before,
                                     plus the roadmap screens from lib/nav.js,
                                     each with its LIVE / PARTIAL / COMING SOON /
                                     PLANNED / NOT ENABLED chip and a legend
                                     counting them.
     Payment history               — subscription_event, as before. Stitch's
                                     "official tax invoices" column has no
                                     backend: NEXUS issues no invoice documents,
                                     and the card says so.

   Every read is independent: one failing shows its own error panel, never a
   blank or a zero in another. */
import { ME, SESSION, db, onIdentityChange } from '../lib/data.js';
import { dubaiStamp, esc, n0 } from '../lib/format.js';
import { NAV, SCREENS } from '../lib/nav.js';
import { BTN, sectionHeader, statusChip, emptyState, errorState, skeleton, trustFooter } from '../lib/stitch-ui.js';
import { table } from '../lib/admin-kit.js';

const str = v => String(v == null ? '' : v).trim();

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

const ACCESS_LABEL = { full: 'Full access', grace: 'Grace period', read_only: 'Read-only' };
const ACCESS_CHIP = { full: 'live', grace: 'degraded', read_only: 'restricted' };
const BANNER_BAR = { full: 'absolute left-0 top-0 bottom-0 w-1.5 bg-[#157a5b]', grace: 'absolute left-0 top-0 bottom-0 w-1.5 bg-[#96570a]', read_only: 'absolute left-0 top-0 bottom-0 w-1.5 bg-red-700', none: 'absolute left-0 top-0 bottom-0 w-1.5 bg-outline' };
const BANNER_ICON = { full: 'w-8 h-8 rounded-lg bg-[#e6f4ef] text-[#157a5b] flex items-center justify-center shrink-0', grace: 'w-8 h-8 rounded-lg bg-[#fef3e2] text-[#96570a] flex items-center justify-center shrink-0', read_only: 'w-8 h-8 rounded-lg bg-red-100 text-red-700 flex items-center justify-center shrink-0', none: 'w-8 h-8 rounded-lg bg-surface-container text-outline flex items-center justify-center shrink-0' };
const DAYS_ICON = { hot: 'material-symbols-outlined text-[16px] text-error', calm: 'material-symbols-outlined text-[16px] text-outline' };
const date = v => (v ? new Date(v).toDateString() : null);

/* The Stitch module-card chip, five states, each a complete class string. */
const CAP = {
  live:    { chip: 'font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-[#e6f4ef] text-[#157a5b] font-bold whitespace-nowrap', word: 'LIVE', dot: 'w-2 h-2 rounded-full bg-[#157a5b]', foot: 'flex items-center gap-1 text-[11px] font-body-sm text-[#157a5b] font-medium pt-space-sm mt-space-xs' },
  partial: { chip: 'font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-[#fef3e2] text-[#96570a] font-bold whitespace-nowrap', word: '◐ PARTIAL', dot: 'w-2 h-2 rounded-full bg-[#96570a]', foot: 'flex items-center gap-1 text-[11px] font-body-sm text-[#96570a] font-medium pt-space-sm mt-space-xs' },
  soon:    { chip: 'font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-[#f1eafa] text-[#5b2e8c] font-bold whitespace-nowrap', word: '○ COMING SOON', dot: 'w-2 h-2 rounded-full bg-[#5b2e8c]', foot: 'flex items-center gap-1 text-[11px] font-body-sm text-[#5b2e8c] font-medium pt-space-sm mt-space-xs' },
  planned: { chip: 'font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-bold whitespace-nowrap', word: '◇ PLANNED', dot: 'w-2 h-2 rounded-full bg-outline', foot: 'flex items-center gap-1 text-[11px] font-body-sm text-outline font-medium pt-space-sm mt-space-xs' },
  off:     { chip: 'font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-error-container text-on-error-container font-bold whitespace-nowrap', word: 'NOT ENABLED', dot: 'w-2 h-2 rounded-full bg-error', foot: 'flex items-center gap-1 text-[11px] font-body-sm text-on-surface-variant font-medium pt-space-sm mt-space-xs' },
};
const capCard = (state, title, body, footIcon, foot) => `<div class="rounded-xl bg-surface-container-low p-space-md flex flex-col justify-between hover:bg-surface-container transition-colors">
    <div class="space-y-space-xs">
      <div class="flex items-start justify-between gap-2"><span class="font-headline-md text-headline-md font-semibold text-on-surface">${esc(title)}</span>
        <span class="${CAP[state].chip}">${CAP[state].word}</span></div>
      <p class="font-body-sm text-body-sm text-on-surface-variant">${esc(body)}</p>
    </div>
    ${foot ? `<div class="${CAP[state].foot}"><span class="material-symbols-outlined text-[14px]">${esc(footIcon)}</span><span>${esc(foot)}</span></div>` : ''}
  </div>`;

/* One section that loads, shows a skeleton, and fails on its own. */
async function section(slot, what, load, render) {
  slot.innerHTML = skeleton({ rows: 3 });
  try {
    const v = await load();
    slot.innerHTML = render(v);
    return v;
  } catch (e) {
    slot.innerHTML = errorState({ what, err: e, retry: 'r' });
    slot.querySelector('[data-retry]')?.addEventListener('click', () => section(slot, what, load, render));
    return undefined;
  }
}

SCREENS.subscription = async host => {
  resetReads();
  host.innerHTML = `<div class="nx-stitch flex flex-col gap-space-md">
    ${sectionHeader({ eyebrow: 'Account', title: 'Subscription & Billing',
      sub: 'NEXUS Dealer: one flat monthly price, first month free. No card is stored in this app — you pay through the Pay now link, by bank transfer or in cash, and the payment is recorded by hand once it arrives.' })}
    <div data-s="banner"></div>
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
      <div class="lg:col-span-7" data-s="plan"></div>
      <div class="lg:col-span-5" data-s="pay"></div>
    </div>
    <div data-s="caps"></div>
    <div data-s="history"></div>
    <div data-s="foot"></div>
  </div>`;
  const root = host.firstElementChild;
  const slot = k => root.querySelector(`[data-s="${k}"]`);

  /* ── Status banner + plan tier: nexus_my_subscription() ─────────────── */
  const subRow = rows => (Array.isArray(rows) ? rows[0] : null);
  const noSub = emptyState({ icon: 'receipt_long', title: 'No subscription is recorded for this dealership',
    body: 'nexus_my_subscription() returned nothing for your account. If you can read this screen at all you have a membership somewhere, so this should not happen — tell NEXUS support.' });
  section(slot('banner'), 'your subscription', () => readSub(), rows => {
    const r = subRow(rows);
    if (!r) return '';
    const k = BANNER_BAR[r.access] ? r.access : 'none';
    const days = n0(r.days_left);
    return `<div class="relative overflow-hidden rounded-xl bg-surface-container-low p-space-md shadow-sm">
      <div class="${BANNER_BAR[k]}"></div>
      <div class="flex flex-col xl:flex-row xl:items-center justify-between gap-space-sm pl-2">
        <div class="flex items-start md:items-center gap-space-sm">
          <div class="${BANNER_ICON[k]}"><span class="material-symbols-outlined text-[20px]">${r.access === 'read_only' ? 'lock' : r.access === 'grace' ? 'hourglass_bottom' : 'verified'}</span></div>
          <div><div class="flex items-center flex-wrap gap-x-space-sm gap-y-0.5">
              <span class="font-headline-md text-headline-md font-semibold text-on-surface">${esc(str(r.status) || 'Status not recorded')} · ${esc(ACCESS_LABEL[r.access] || str(r.access) || 'access not recorded')}</span>
              ${statusChip(ACCESS_CHIP[r.access] || 'not-tested', ACCESS_LABEL[r.access] || 'Unknown')}</div>
            <p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${esc(str(r.evidence) || 'No further detail recorded.')}</p></div>
        </div>
        <div class="flex items-center gap-space-sm shrink-0 pl-10 xl:pl-0">
          <div class="flex items-center gap-1.5 px-3 py-1 rounded bg-surface-container-lowest font-label-numeric-md text-label-numeric-md text-on-surface font-semibold">
            <span class="${days != null && days <= 7 ? DAYS_ICON.hot : DAYS_ICON.calm}">hourglass_bottom</span>
            <span>${days != null ? `${days} day${days === 1 ? '' : 's'} remaining` : 'No countdown applies'}</span></div>
        </div>
      </div></div>`;
  });
  section(slot('plan'), 'your plan', () => readSub(), rows => {
    const r = subRow(rows);
    if (!r) return noSub;
    const days = n0(r.days_left);
    const until = r.status === 'TRIAL' ? date(r.trial_ends_at) : r.access === 'grace' ? date(r.grace) : date(r.current_period_end);
    const untilWord = r.status === 'TRIAL' ? 'Trial ends' : r.access === 'grace' ? 'Read-only begins' : 'Paid through';
    const tile = (label, icon, value, sub) => `<div class="p-space-sm rounded-lg bg-surface-container-low flex flex-col gap-1">
        <div class="flex items-center justify-between"><span class="font-table-header text-table-header uppercase tracking-wider text-outline font-semibold">${label}</span><span class="material-symbols-outlined text-[18px] text-outline">${icon}</span></div>
        <span class="font-label-numeric-lg text-headline-md font-bold text-on-surface">${value}</span>
        <span class="font-body-sm text-body-sm text-on-surface-variant">${sub}</span></div>`;
    return `<div class="h-full flex flex-col justify-between rounded-xl bg-surface-container-lowest p-space-lg shadow-sm gap-space-md">
      <div class="flex items-start justify-between gap-space-md">
        <div><div class="flex items-center gap-2"><span class="font-table-header text-table-header uppercase tracking-wider text-outline">Current plan</span>${statusChip(ACCESS_CHIP[r.access] || 'not-tested', str(r.status) || 'Unknown')}</div>
          <h2 class="font-headline-lg text-headline-lg font-bold text-on-surface mt-1">NEXUS Dealer</h2>
          <p class="font-body-sm text-body-sm text-on-surface-variant">Every module on one flat price. No usage tiers, no per-seat charge.</p></div>
        <div class="text-right shrink-0"><div class="font-table-header text-table-header uppercase tracking-wider text-outline">Billed monthly</div>
          <div class="font-label-numeric-lg text-headline-lg font-bold text-primary">${r.price_aed != null ? `AED ${esc(String(n0(r.price_aed)))}` : '—'}<span class="font-body-sm text-body-sm text-outline font-normal"> / mo</span></div>
          ${r.price_aed == null ? '<div class="font-body-sm text-body-sm text-outline">No price is recorded on this subscription.</div>' : ''}</div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-space-sm">
        ${tile('Status', 'badge', esc(str(r.status) || '—'), 'As the subscription record states it.')}
        ${tile('Access', 'shield', esc(ACCESS_LABEL[r.access] || str(r.access) || '—'), r.access === 'read_only'
          ? 'Reads keep working everywhere. Every write button is disabled until this is resolved.'
          : r.access === 'grace' ? 'Full access continues for now, on borrowed time.' : 'Nothing is restricted.')}
        ${tile(r.access === 'grace' ? 'Grace ends in' : r.status === 'TRIAL' ? 'Trial ends in' : 'Countdown', 'hourglass_bottom',
          days != null ? `${days} day${days === 1 ? '' : 's'}` : '—', days != null ? 'Counted by the database, not this page.' : 'No countdown applies to this state.')}
      </div>
      <div class="p-space-sm rounded-lg bg-surface-container-low flex items-center justify-between gap-2 font-label-numeric-sm text-label-numeric-sm">
        <span class="text-on-surface font-semibold">${esc(untilWord)}</span>
        <span class="text-on-surface-variant">${until ? esc(until) : 'No date recorded'}</span>
      </div>
      <div class="flex items-center gap-2 font-body-sm text-body-sm text-on-surface-variant"><span class="material-symbols-outlined text-[16px] text-outline">info</span>
        <span>Trial (30 days) → grace (7 days) → read-only, until paid. Changing plan or cancelling is done with NEXUS directly; there is no self-serve control for it yet.</span></div>
    </div>`;
  });

  /* ── Payment desk: nexus_payment_instructions() ─────────────────────── */
  section(slot('pay'), 'payment details', () => readPay(), rows => {
    const row = Array.isArray(rows) ? rows[0] : null;
    const head = `<div class="flex items-center justify-between gap-2"><h2 class="font-headline-md text-headline-md font-bold text-on-surface">Payment</h2>
      <span class="font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-surface-container text-secondary font-semibold">CARD BY ZIINA</span></div>`;
    if (!row) {
      return `<div class="h-full rounded-xl bg-surface-container-lowest p-space-lg shadow-sm flex flex-col gap-space-md">${head}
        ${emptyState({ icon: 'receipt_long', title: 'Payment details are being set up',
          body: 'nexus_payment_instructions() returned nothing for your account. Contact NEXUS support at aliasgher892@gmail.com.' })}</div>`;
    }
    const displayName = str(row.display_name) || 'Adqonic';
    const amount = row.amount_aed != null ? n0(row.amount_aed) : null;
    const currency = str(row.currency) || 'AED';
    const link = str(row.payment_link_url);
    const reference = str(row.reference);
    const line = (k, v) => `<div class="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-surface-container-low"><span class="font-body-sm text-body-sm text-on-surface-variant">${k}</span><span class="font-label-numeric-sm text-label-numeric-sm text-on-surface font-semibold text-right">${v}</span></div>`;
    return `<div class="h-full rounded-xl bg-surface-container-lowest p-space-lg shadow-sm flex flex-col gap-space-md">${head}
      <div class="rounded-xl bg-surface-container-low p-space-md flex flex-col gap-1">
        <span class="font-label-numeric-sm text-label-numeric-sm text-primary font-bold uppercase tracking-wider">NEXUS by ${esc(displayName)}</span>
        <span class="font-label-numeric-lg text-headline-md font-bold text-on-surface">${esc(currency)} ${amount != null ? esc(String(amount)) : '—'} <span class="font-body-sm text-body-sm text-outline font-normal">/ month</span></span>
        <span class="font-body-sm text-body-sm text-on-surface-variant">No card is kept on file in NEXUS. Ziina takes the card on its own checkout page.</span>
      </div>
      <div class="flex flex-col gap-1.5">
        ${line('Payment reference', reference ? `<span id="payRefText">${esc(reference)}</span>` : 'None issued')}
        ${line('Tax registration (TRN)', 'Not recorded in NEXUS')}
      </div>
      ${link
        ? `<a class="w-full ${BTN.primary}" href="${esc(link)}" target="_blank" rel="noopener noreferrer"><span class="material-symbols-outlined text-[18px]">bolt</span><span>Pay now</span></a>`
        : `<div class="font-body-sm text-body-sm text-on-surface-variant">Online payment is being set up — contact <span class="font-label-numeric-sm">aliasgher892@gmail.com</span>.</div>`}
      ${reference ? `<button class="w-full ${BTN.secondary}" id="payRefCopyBtn" type="button"><span class="material-symbols-outlined text-[18px]">content_copy</span><span>Copy reference for the payment note</span></button>` : ''}
      <p class="font-body-sm text-body-sm text-outline">Your access is extended once your payment is confirmed (usually within one business day).</p>
    </div>`;
  }).then(() => {
    const copyBtn = slot('pay').querySelector('#payRefCopyBtn');
    if (!copyBtn) return;
    copyBtn.addEventListener('click', () => {
      const text = slot('pay').querySelector('#payRefText')?.textContent || '';
      const clip = navigator.clipboard;
      if (!clip || typeof clip.writeText !== 'function') {
        copyBtn.disabled = true;
        copyBtn.title = 'This browser exposes no clipboard API to the page.';
        return;
      }
      clip.writeText(text).then(
        () => { copyBtn.lastElementChild.textContent = 'Copied'; },
        () => { copyBtn.lastElementChild.textContent = 'Copy blocked'; copyBtn.title = 'The browser refused clipboard access for this page.'; });
    });
  });

  /* ── What your plan includes ────────────────────────────────────────────
     Added 7 Oct 2026 (before the restyle). Two accessors that already existed
     "for the dashboard" and that nothing called:

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

     A capability being NOT_AVAILABLE (chip: NOT ENABLED) is about what data or
     integration this dealership has connected, not about what the plan sells:
     the plan is one flat price and every feature is on it. The PARTIAL /
     COMING SOON / PLANNED cards are the screens lib/nav.js marks that way, so
     the plan page and the sidebar cannot disagree. */
  section(slot('caps'), 'what your plan includes', async () => {
    const [s, c] = await Promise.all([
      db('rpc/nexus_subscription_status').then(v => ({ v, err: null }), e => ({ v: null, err: e })),
      db('rpc/nexus_my_tenant_capabilities').then(v => ({ v, err: null }), e => ({ v: null, err: e })),
    ]);
    if (s.err && c.err) throw s.err;
    return { s, c };
  }, ({ s, c }) => {
    const st = s.err ? null : (Array.isArray(s.v) ? s.v[0] : null);
    const entitlement = s.err
      ? 'Whether this dealership is entitled to the plan could not be read on this visit, so nothing is said either way.'
      : !st ? 'No subscription state came back for this account.' : null;
    const caps = c.err ? null : (Array.isArray(c.v) ? c.v : []);
    const navItems = NAV.flatMap(g => g.items);
    const partial = navItems.filter(i => i.mark === 'partial');
    const soon = navItems.filter(i => i.roadmap === 'soon');
    const planned = navItems.filter(i => i.roadmap === 'planned');
    const live = (caps || []).filter(k => str(k.state) === 'AVAILABLE');
    const off = (caps || []).filter(k => str(k.state) !== 'AVAILABLE');
    const cards = [
      ...live.map(k => capCard('live', str(k.label) || str(k.capability_key), str(k.what_it_unlocks) || 'No description recorded.', 'check_circle', str(k.evidence) || 'Recorded as available for your dealership.')),
      ...partial.map(i => capCard('partial', i.title, 'Real and reading your data, but answering only part of its question today.', 'contrast', 'Opens from the sidebar')),
      ...off.map(k => capCard('off', str(k.label) || str(k.capability_key), str(k.absent_means) || 'The catalogue says nothing about what its absence means.', 'link_off', str(k.requires) ? `Needs: ${str(k.requires)}` : 'Requirement not stated.')),
      ...soon.map(i => capCard('soon', i.title, 'Designed and next to be built. Shows no data yet.', 'schedule', 'On the plan when it ships — no extra charge')),
      ...planned.map(i => capCard('planned', i.title, 'Designed and on the roadmap; the data it needs does not exist in NEXUS yet.', 'flag', 'On the plan when it ships — no extra charge')),
    ];
    const legend = [['live', live.length, caps == null], ['partial', partial.length], ['soon', soon.length], ['planned', planned.length], ['off', off.length, caps == null]]
      .map(([k, n, unknown]) => `<div class="flex items-center gap-1"><span class="${CAP[k].dot}"></span><span class="text-on-surface-variant">${CAP[k].word.replace(/^[◐○◇] /, '')} (${unknown ? '—' : n})</span></div>`).join('');
    const ent = st ? `<div class="grid grid-cols-1 md:grid-cols-3 gap-space-sm">
        <div class="p-space-sm rounded-lg bg-surface-container-low"><div class="font-table-header text-table-header uppercase tracking-wider text-outline">Entitled</div>
          <div class="font-body-md text-body-md font-semibold ${st.entitled === true ? 'text-[#157a5b]' : 'text-red-700'}">${st.entitled === true ? 'Yes' : 'No'}</div>
          <div class="font-body-sm text-body-sm text-on-surface-variant">As the subscription record states it. This is a report, not a switch.</div></div>
        <div class="p-space-sm rounded-lg bg-surface-container-low"><div class="font-table-header text-table-header uppercase tracking-wider text-outline">State</div>
          <div class="font-body-md text-body-md font-semibold text-on-surface">${esc(str(st.state) || 'not recorded')}</div>
          ${st.state_is_stale === true ? `<div class="font-body-sm text-body-sm text-amber-700">The stored state still reads ${esc(str(st.stored_state))}; the state above is what it actually is today.</div>` : ''}</div>
        <div class="p-space-sm rounded-lg bg-surface-container-low"><div class="font-table-header text-table-header uppercase tracking-wider text-outline">What that means</div>
          <div class="font-body-sm text-body-sm text-on-surface">${esc(str(st.evidence) || 'No explanation recorded.')}</div></div>
      </div>` : `<p class="font-body-sm text-body-sm text-on-surface-variant">${esc(entitlement)}</p>`;
    return `<section class="rounded-xl bg-surface-container-lowest p-space-lg shadow-sm flex flex-col gap-space-md">
      <div class="flex flex-col md:flex-row md:items-end justify-between gap-space-sm">
        <div><div class="flex items-center gap-space-xs"><h2 class="font-headline-lg text-headline-lg font-bold text-on-surface">What your plan includes</h2>
            <span class="font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-surface-container text-secondary font-semibold">ONE PLAN, EVERY MODULE</span></div>
          <p class="font-body-md text-body-md text-on-surface-variant mt-0.5">What changes from one dealership to the next is what NEXUS has to work with — below is what is connected for yours, and what each missing piece would unlock.</p></div>
        <div class="flex items-center flex-wrap gap-2 text-[11px] font-label-numeric-sm">${legend}</div>
      </div>
      ${ent}
      ${caps == null ? '<p class="font-body-sm text-body-sm text-on-surface-variant">The capability list could not be read on this visit, so no capability is shown as present or missing. The roadmap cards below come from this build, not from that read.</p>' : ''}
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-space-md pt-space-xs">${cards.join('')}</div>
    </section>`;
  });

  /* ── Payment history: subscription_event ────────────────────────────── */
  let evCount = null;
  await section(slot('history'), 'payment history', () => readEvents(), rows => {
    const list = Array.isArray(rows) ? rows : [];
    evCount = list.length;
    const body = !list.length
      ? emptyState({ icon: 'history', title: 'No subscription events yet', body: "Nothing has changed this dealership's subscription state since it was created." })
      : table([
          { label: 'When', render: r => esc(r.occurred_at ? dubaiStamp(r.occurred_at) : '—') },
          { label: 'Event', strong: true, render: r => esc(str(r.event_type) || '—') },
          { label: 'From → to', render: r => `${esc(str(r.from_state) || '—')} → ${esc(str(r.to_state) || '—')}` },
          { label: 'Price', align: 'r', render: r => (r.price_aed != null ? `AED ${esc(String(n0(r.price_aed)))}` : '—') },
          { label: 'Recorded by', render: r => esc(str(r.actor) || 'Not recorded') },
          { label: 'Reason', render: r => `<div class="whitespace-normal">${esc(str(r.reason) || '—')}</div>` },
        ], list);
    return `<section class="rounded-xl bg-surface-container-lowest p-space-lg shadow-sm flex flex-col gap-space-md">
      <div class="flex items-start justify-between gap-2"><div><h2 class="font-headline-lg text-headline-lg font-bold text-on-surface">Payment history</h2>
        <p class="font-body-sm text-body-sm text-on-surface-variant">Every change to your subscription state, in order — subscription_event can only be appended to, never edited.</p></div>
        <span class="font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-surface-container text-on-surface font-semibold whitespace-nowrap">${list.length} EVENT${list.length === 1 ? '' : 'S'}</span></div>
      ${body}
      <div class="flex items-start gap-3 p-space-md rounded-lg border border-cyan-200 bg-cyan-50/20">
        <span class="material-symbols-outlined text-[20px] text-cyan-700 shrink-0">receipt_long</span>
        <div class="min-w-0 flex flex-col gap-1"><div class="flex items-center gap-2 flex-wrap"><span class="font-body-md text-body-md font-semibold text-cyan-950">Official tax invoices</span>${statusChip('planned')}</div>
          <p class="font-body-sm text-body-sm text-cyan-900">NEXUS does not issue invoice documents from this app, so there is nothing here to view or download. The payment provider sends its own receipt.</p>
          <p class="font-label-numeric-sm text-label-numeric-sm text-cyan-900">Prerequisite: an invoicing record per payment, with the dealership’s tax registration on file.</p></div>
      </div>
    </section>`;
  });

  slot('foot').innerHTML = trustFooter({ source: 'nexus_my_subscription · nexus_payment_instructions · subscription_event',
    asOf: dubaiStamp(new Date().toISOString()), evidence: evCount == null ? null : `${evCount} subscription event${evCount === 1 ? '' : 's'}`,
    actor: (ME && (ME.name || ME.email)) || (SESSION && SESSION.user && SESSION.user.email) || null });
};
