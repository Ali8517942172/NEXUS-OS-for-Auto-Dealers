/* NEXUS OS — screens/founder.js
   THE FOUNDER CONSOLE. Added 21 Sep 2026 (nx1004).

   ===========================================================================
   WHY THIS SCREEN EXISTS
   ===========================================================================
   Every other screen in this app answers a question about ONE dealership --
   the one nexus_current_tenant_id() resolves for the signed-in account. This
   one answers questions about NEXUS itself: how many dealerships exist, which
   of them are real and which are test fixtures, and how to bring a new one
   onto the platform and hand its owner a working login -- all without anyone
   opening the Supabase SQL Editor, which is what the job required before this
   screen existed.

   ===========================================================================
   WHO MAY EVEN SEE THIS, AND WHY THAT IS NOT WHAT MAKES IT SAFE
   ===========================================================================
   Since 22 Sep 2026 this console is NOT part of the dealer app at all. It
   is rendered only by the separate founder page (founder/index.html and
   founder/app.js, served at /founder), which calls renderFounderConsole()
   below directly. The dealer app (app.js) never imports this module, and
   lib/nav.js carries no founder item, so a dealer -- or a screen recording
   of the dealer app made while the founder is signed in -- has no founder
   UI to show. The founder page's own gate reads lib/platform.js's
   isPlatformAdmin(), and lib/platform.js says outright, in its own header
   comment, that this is not a security boundary. It is repeated here
   because it is the single most
   important fact about this file: every read and every write below runs
   through an RPC (nexus_founder_list_tenants, nexus_founder_onboard_dealer,
   nexus_founder_set_tenant_status, nexus_founder_quarantine_census) or the
   founder-invite Edge Function, and EVERY ONE of those independently calls
   nexus_is_platform_admin() again, server-side, before doing anything. If
   every line of JavaScript in this file were deleted and somebody hand-built
   a client that skipped straight to the RPCs, a non-founder's calls would be
   refused in exactly the same way. This screen only decides what a founder is
   shown; the database decides what a founder is allowed.

   Because of that, this screen renders one more guard at its own top: it
   awaits loadPlatformAdmin() and, on a "no" or an unreadable answer, paints a
   polite explanation instead of the console. That guard exists for the one
   path the founder page's gate cannot cover -- a render already in flight at
   the instant an identity changes -- and it fails CLOSED like the rest of
   lib/platform.js, not because it is load-bearing, but because a screen that
   might show "1,204 dealerships" to the wrong person for one frame does not
   get to say "the RPC would have refused it anyway" as its defence.

   ===========================================================================
   WHERE THE ANSWERS COME FROM, AND WHAT THIS FILE DELIBERATELY DOES NOT DO
   ===========================================================================
   nexus_founder_list_tenants() computes every count itself -- member_count,
   leads_count, subscription_status, last_activity_at, is_test -- and this
   file reads them rather than deriving a single one of them a second way. The
   is_test flag in particular (`slug LIKE 'test-%'`) is the database's own
   rule, copied here in prose only, never re-implemented as a second regex
   that could quietly drift from the one the migration actually enforces.

   nexus_founder_onboard_dealer() is a THIN WRAPPER over the existing
   nexus_onboard_dealership() (tenancy_quarantine_replaces_dealership_default,
   5 Sep 2026) -- it does not create a tenant, a membership or an owner row
   itself, it calls the function that already does and then records an
   optional phone number the older function has no column for. This screen
   therefore cannot say anything about HOW a dealership is onboarded beyond
   "the founder RPC did it"; that account belongs to the migration, not here.

   The invite control does not touch tenant_members directly and cannot --
   the browser holds only the anon key, and creating a Supabase Auth login
   needs the service-role key, which lives nowhere in this bundle. It posts to
   the founder-invite Edge Function instead, over lib/data.js's edgeFn(),
   which carries the signed-in user's own JWT and nothing else. See
   supabase/functions/founder-invite/README.md for the full contract; the
   short version is that the same function also serves a dealership OWNER
   inviting into their OWN tenant, from screens/settings.js's Team card, and
   the two callers are told apart there, not here. */

import { db, dbWrite, edgeFn, onIdentityChange } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { ago, dubaiStamp, esc, n0 } from '../lib/format.js';
import { isPlatformAdmin, loadPlatformAdmin } from '../lib/platform.js';
import { HEALTH_WORDS, healthWords } from '../lib/health.js';
import { BTN, actor, bannerClass, panel, pill, stateEmpty, stateError, stateLoading, table } from '../lib/admin-kit.js';
import { emptyState, statusChip, trustFooter } from '../lib/stitch-ui.js';

/* 7 Oct 2026 — THE STITCH LAYOUT. design/stitch/founder-console-nexus-platform-
   administration--d6c87c.html (primary) and --a38ee6. Sections, top to bottom:

     Console banner                — no "platform pulse" or "edge latency": this
                                     page measures neither, so neither is drawn.
     Four KPI tiles, kept separate — Downloads, Activated, Active dealerships,
                                     Paying subscriptions. Each is either counted
                                     from nexus_founder_list_tenants() with its
                                     rule printed on the tile, or "—" with why.
     Ops controls                  — jump links to the six existing founder
                                     actions below. Every action that worked
                                     before still works, unchanged.
     Every dealership              — the tenants table with its status control.
     Quarantine census             — nexus_founder_quarantine_census().
     Notification gateway          — nexus_notification_outbox is service-role
                                     only (RLS: never end users), so this page
                                     cannot read it; an honest empty state.
     Infrastructure health probes  — no table records a probe result; the probe
                                     workflow runs on the automation box and
                                     writes nowhere this page can read.
     Workflow health               — v_workflow_health, which IS readable here,
                                     labelled for what it is: the register is
                                     platform-wide, but the run counts are the
                                     signed-in account's own dealership's.
     Feature availability          — tenant_capability is readable only for the
                                     caller's own dealership and no founder RPC
                                     reads it across dealerships: COMING SOON.
     Release readiness             — nothing records a release: COMING SOON.

   The platform-admin authorisation logic is untouched: the guard at the top of
   renderFounderConsole() and the server-side checks in every RPC. */
const str = v => String(v == null ? '' : v).trim();
const ROLES = ['owner', 'admin', 'manager', 'sales', 'technician', 'member'];
const count = v => { const x = n0(v); return x == null ? '—' : String(x); };
/* -- The read, memoised per render, reset on identity change ---------------
   One list backs the KPI strip, the invite dropdown, the tenants table and
   the test-tenant callout -- the same `shared()` shape screens/channels.js
   uses, for the same reason: four independent db() calls for one register
   would not disagree today, but nothing stops them disagreeing after a retry
   lands between two of them. */
const MEMOS = new Set();
const shared = make => {
  let p = null;
  const f = () => { if (!p) { p = make(); p.catch(() => { p = null; }); } return p; };
  MEMOS.add(() => { p = null; });
  return f;
};
const resetReads = () => { MEMOS.forEach(reset => reset()); };
onIdentityChange(resetReads);

const readTenants = shared(() => db('rpc/nexus_founder_list_tenants'));
const readWorkflows = shared(() => db('v_workflow_health?select=name,category,is_active,health,runs_30d,success_rate_30d,last_run&order=name.asc&limit=200'));

/* -- Reading a founder-shaped refusal out of the wire -----------------------
   The same problem screens/team.js solved for nexus_team_* (see its
   accessRefusal/accessError, TEAM_CODE), applied to TWO different backends at
   once, because this screen calls both an RPC and an Edge Function and the
   two do not carry a refusal in the same shape.

   An RPC's raise exception reaches this file as `.technical`, a string
   ending in the PostgREST JSON body -- {"code":"NX001","message":"…",
   "details":"NX_FOUNDER_…","hint":"…"} for every nexus_founder_* guard in
   nx1004, and {"code":"P0001","message":"nexus_onboard_dealership: …"} for a
   plain `raise exception` inside the OLDER function nexus_founder_onboard_
   dealer wraps (a duplicate slug, a missing auth.users row) -- P0001 is
   Postgres's own code for a raise with no custom SQLSTATE, and is shown here
   because it already IS the sentence a human wrote for a human, unlike a bare
   constraint or permission violation, which is never surfaced verbatim on
   this screen or any other.

   An Edge Function refusal reaches this file the same way -- `.technical`
   ending in the response body -- but founder-invite's own body shape is
   {"outcome":"error","message":"…","detail":"NX_INVITE_…"}, chosen in that
   file to read naturally as JSON returned from a function that also returns
   {"outcome":"invited",…} on success. Different field names, same idea: a
   short machine code this file can recognise, and a message already written
   for a person. */
function refusalText(e) {
  const raw = String(e && e.technical || '');
  const i = raw.indexOf('{');
  if (i < 0) return null;
  let j;
  try { j = JSON.parse(raw.slice(i)); } catch { return null; }
  if (!j || typeof j.message !== 'string') return null;
  const code = String(j.code || '');
  if (code === 'NX001' && /^NX_FOUNDER_/.test(String(j.details || ''))) {
    return j.message + (j.hint ? ' ' + j.hint : '');
  }
  if (code === 'P0001') return j.message;
  if (j.outcome === 'error' && typeof j.detail === 'string' && /^NX_INVITE_/.test(j.detail)) {
    return j.message;
  }
  return null;
}
const errorText = e => refusalText(e) || String(e && e.message || 'The request did not go through.');

/* -- The one state where nothing else on this screen renders ---------------
   See the header comment: this is a courtesy, repeated here because
   the founder page's gate cannot see a render already in flight. */
function stateFounderOnly() {
  return emptyState({ icon: 'shield_person', title: 'This is the NEXUS founder console',
    body: "Every dealership's onboarding, status and invite controls live here, and none of them are scoped to one dealership the way the rest of this app is -- so this screen is not shown, and its RPCs refuse, to anyone whose account is not the platform admin. If that should be you, sign in as that account." });
}

/* -- Stitch pieces used only here -------------------------------------------- */
const CARD = 'bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant/40 overflow-hidden';
const CARD_HEAD = 'px-space-lg py-space-md flex flex-wrap items-start justify-between gap-space-sm border-b border-outline-variant/30';
const FORM_GRID2 = 'grid grid-cols-1 md:grid-cols-2 gap-space-md';
const FORM_GRID3 = 'grid grid-cols-1 md:grid-cols-3 gap-space-md';
const FIELD = 'flex flex-col gap-1 [&>label]:font-table-header [&>label]:text-table-header [&>label]:uppercase [&>label]:tracking-wider [&>label]:text-outline [&>label]:font-semibold [&_input]:w-full [&_input]:px-3 [&_input]:py-2 [&_input]:rounded-lg [&_input]:border [&_input]:border-outline-variant [&_input]:bg-surface-container-lowest [&_input]:text-on-surface [&_input:focus]:outline-none [&_input:focus]:border-primary [&_select]:w-full [&_select]:px-3 [&_select]:py-2 [&_select]:rounded-lg [&_select]:border [&_select]:border-outline-variant [&_select]:bg-surface-container-lowest [&_select]:text-on-surface';
const SUB = 'font-body-sm text-body-sm text-on-surface-variant';
const SEL_SM = 'px-2 py-1 rounded-lg border border-outline-variant bg-surface-container-lowest font-body-sm text-body-sm text-on-surface';
const STATUS_CHIP = { active: 'live', suspended: 'blocked', archived: 'restricted' };
const statusOf = r => statusChip(STATUS_CHIP[str(r.status)] || 'not-tested', str(r.status) || 'unknown');

const cardHead = (icon, title, subHtml, tagHtml = '') => `<div class="${CARD_HEAD}">
    <div class="flex items-start gap-2.5 min-w-0"><span class="material-symbols-outlined text-primary text-[22px]">${icon}</span>
      <div class="min-w-0"><h2 class="font-headline-md text-headline-md text-on-surface font-semibold">${esc(title)}</h2>${subHtml ? `<p class="${SUB} mt-0.5">${subHtml}</p>` : ''}</div></div>
    ${tagHtml}</div>`;
const msgBox = (msg, tone) => (msg ? `<div class="${bannerClass(tone === 'ok' ? 'ok' : 'hot')}"><span class="material-symbols-outlined text-[20px]">${tone === 'ok' ? 'check_circle' : 'error'}</span><div>${esc(msg)}</div></div>` : '');
const KPI_ICON = 'w-9 h-9 rounded-lg bg-primary-container/10 text-primary flex items-center justify-center';
const kpiTile = (label, icon, value, subHtml, footHtml) => `<div class="bg-surface-container-lowest rounded-xl p-space-lg shadow-sm border border-outline-variant/40 flex flex-col gap-space-sm">
    <div class="flex items-center justify-between"><span class="font-table-header text-table-header uppercase tracking-wider text-on-surface-variant font-semibold">${label}</span>
      <div class="${KPI_ICON}"><span class="material-symbols-outlined text-[20px]">${icon}</span></div></div>
    <div class="font-label-numeric-lg text-[2.25rem] leading-none font-bold text-on-surface">${value}</div>
    <div class="${SUB}">${subHtml}</div>
    ${footHtml ? `<div class="pt-space-sm border-t border-outline-variant/30 font-label-numeric-sm text-label-numeric-sm text-outline">${footHtml}</div>` : ''}
  </div>`;
const soon = (kind, icon, title, body, prerequisite) => `<section class="${CARD}">${cardHead(icon, title, '', statusChip(kind))}
    <div class="p-space-lg flex flex-col gap-space-sm"><p class="${SUB}">${esc(body)}</p>
      <p class="font-label-numeric-sm text-label-numeric-sm text-on-surface-variant">Prerequisite: ${esc(prerequisite)}</p></div></section>`;

/* ==========================================================================
   SCREEN
   ========================================================================== */
export async function renderFounderConsole(host) {
  const root = el('div', 'nx-stitch flex flex-col gap-space-lg');
  host.appendChild(root);

  resetReads();

  /* Usually already resolved -- founder/app.js awaits this at boot, before
     this console is ever rendered -- so this is
     normally a synchronous read of a settled cache, not a second round-trip. */
  await loadPlatformAdmin();
  if (!isPlatformAdmin()) { root.innerHTML = stateFounderOnly(); return; }

  const load = () => readTenants();

  /* Filled in once the tenants table and the invite / payment dropdowns exist
     below, so the onboarding form can ask them to catch up on the dealer it
     just created without this screen re-rendering itself wholesale. */
  let reloadTenantsTable = async () => {};
  let reloadInviteList = async () => {};
  let reloadPaidList = async () => {};

  /* ------------------------------------------------------------------------
     Banner
     ------------------------------------------------------------------------ */
  const banner = el('div', 'relative overflow-hidden rounded-xl bg-gradient-to-r from-primary to-[#032860] text-on-primary p-space-lg shadow-md');
  banner.innerHTML = `<div class="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-space-md">
      <div class="flex items-start gap-space-md">
        <div class="w-12 h-12 rounded-lg bg-surface-container-lowest/15 flex items-center justify-center shrink-0 border border-white/20"><span class="material-symbols-outlined text-[28px] text-tertiary-fixed">shield_with_heart</span></div>
        <div class="space-y-0.5">
          <div class="flex items-center gap-space-sm flex-wrap"><span class="font-headline-md text-headline-md font-bold tracking-tight text-white">NEXUS Founder Console</span>
            <span class="font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-tertiary-fixed/20 text-tertiary-fixed font-semibold tracking-wider uppercase border border-tertiary-fixed/40">PLATFORM ADMIN</span></div>
          <p class="font-body-md text-body-sm text-on-primary-container max-w-3xl">Every dealership on NEXUS, and the controls that act across them. Each action below is re-checked by the database against the platform-admin rule before it runs — this page only decides what is drawn.</p>
        </div>
      </div>
    </div>`;
  root.appendChild(banner);

  /* ------------------------------------------------------------------------
     Four KPI tiles, separate on purpose: each answers a different question
     and none is derived from another.
     ------------------------------------------------------------------------ */
  panelBare(root, load, rows => {
    const all = Array.isArray(rows) ? rows : [];
    const real = all.filter(r => !r.is_test);
    const test = all.filter(r => r.is_test);
    const active = real.filter(r => str(r.status) === 'active');
    const activated = real.filter(r => (n0(r.member_count) || 0) > 0);
    const paying = real.filter(r => str(r.subscription_status) === 'ACTIVE');
    const pastDue = real.filter(r => str(r.subscription_status) === 'PAST_DUE');
    const trial = real.filter(r => str(r.subscription_status) === 'TRIAL');
    return `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
      ${kpiTile('Downloads & installs', 'download', '—', 'NEXUS records no download or install count. The dealer app is a web page, so there is nothing installed to count.', 'No source')}
      ${kpiTile('Activated', 'how_to_reg', count(activated.length), `Real dealerships with at least one member account (member_count above 0), of ${count(real.length)} real.`, `${count(test.length)} test ${test.length === 1 ? 'tenant' : 'tenants'} not counted`)}
      ${kpiTile('Active dealerships', 'storefront', count(active.length), `Real dealerships whose status is active. ${count(real.length - active.length)} suspended or archived.`, 'tenants.status')}
      ${kpiTile('Paying subscriptions', 'payments', count(paying.length), `Subscription state ACTIVE. ${count(trial.length)} in trial, ${count(pastDue.length)} past due — neither is counted as paying.`, 'tenant_subscription.state')}
    </div>`;
  });

  /* ------------------------------------------------------------------------
     Ops controls — jumps to the real actions further down.
     ------------------------------------------------------------------------ */
  const ops = el('section', `${CARD} px-space-lg py-space-md flex flex-wrap items-center gap-space-sm`);
  ops.innerHTML = `<span class="flex items-center gap-1.5 font-table-header text-table-header uppercase tracking-wider text-on-surface font-semibold mr-space-sm"><span class="material-symbols-outlined text-[18px] text-primary">terminal</span>Ops controls:</span>
    <button type="button" class="${BTN.primary}" data-jump="fcOnboard"><span class="material-symbols-outlined text-[18px]">add_business</span>Onboard a dealer</button>
    <button type="button" class="${BTN.secondary}" data-jump="fcInvite"><span class="material-symbols-outlined text-[18px]">person_add</span>Invite staff to a dealership</button>
    <button type="button" class="${BTN.secondary}" data-jump="fcPay"><span class="material-symbols-outlined text-[18px]">link</span>Pay now link</button>
    <button type="button" class="${BTN.secondary}" data-jump="fcPaid"><span class="material-symbols-outlined text-[18px]">receipt_long</span>Record a payment</button>
    <span class="flex-1"></span>
    <button type="button" class="${BTN.secondary}" data-jump="fcTest">Test tenants</button>
    <button type="button" class="${BTN.secondary}" data-jump="fcQuarantine"><span class="material-symbols-outlined text-[18px]">shield</span>Quarantine census</button>`;
  root.appendChild(ops);
  ops.querySelectorAll('[data-jump]').forEach(b => b.addEventListener('click', () => {
    $(b.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  /* ------------------------------------------------------------------------
     Every dealership, with suspend / activate controls

     Built as a self-contained load/draw pair rather than through panel(), on
     purpose: panel() re-renders from ITS OWN retry button and replays wiring
     closures registered via `.then()`, which is exactly right for a card that
     only ever reads (see channels.js) and awkward for one that must re-fetch
     and redraw itself in response to a save made from inside its own rows --
     the same reason screens/team.js's "who has access" card is hand-rolled.
     ------------------------------------------------------------------------ */
  const tenants = el('section', CARD); tenants.id = 'fcTenants';
  root.appendChild(tenants);
  {
    let rows = null, rowsErr = null, saveMsg = '', saveTone = 'hot', savingId = null;

    const tDraw = () => {
      const n = rows ? rows.filter(r => !r.is_test).length : null;
      const head = cardHead('domain', 'Every dealership on NEXUS',
        'Status is read and written here exactly as nexus_founder_set_tenant_status() enforces it: active, suspended or archived. The quarantine tenant is not a dealership and is never listed or offered a control.',
        n == null ? '' : `<span class="font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-surface-container text-on-surface font-semibold">${esc(count(n))} REAL · ${esc(count(rows.length - n))} TEST</span>`);
      let body;
      if (!rows && !rowsErr) body = `<div class="p-space-md">${stateLoading(4)}</div>`;
      else if (rowsErr) body = `<div class="p-space-md">${stateError('dealerships', rowsErr, 'treload')}</div>`;
      else {
        const list = rows.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        body = (saveMsg ? `<div class="px-space-md pt-space-md">${msgBox(saveMsg, saveTone)}</div>` : '')
          + table(
            [
              { label: 'Dealership', strong: true, render: r => `<div class="flex items-center gap-2"><span>${esc(r.name || r.slug)}</span>${r.is_test ? statusChip('pending', 'test') : ''}</div><div class="font-label-numeric-sm text-label-numeric-sm text-outline">${esc(r.slug)}</div>` },
              { label: 'Status', render: r => statusOf(r) },
              { label: 'Members', align: 'r', render: r => count(r.member_count) },
              { label: 'Leads', align: 'r', render: r => count(r.leads_count) },
              { label: 'Subscription', render: r => esc(str(r.subscription_status) || 'none on record') },
              { label: 'Last activity', render: r => `<span title="${esc(dubaiStamp(r.last_activity_at))}">${esc(ago(r.last_activity_at))}</span>` },
              { label: 'Created', render: r => esc(dubaiStamp(r.created_at)) },
              { label: 'Action', align: 'r', render: r => `<div class="flex items-center justify-end gap-1.5">
                  <select class="${SEL_SM}" data-st="${esc(r.tenant_id)}" aria-label="Status for ${esc(r.name || r.slug)}"${savingId === r.tenant_id ? ' disabled' : ''}>
                    ${['active', 'suspended', 'archived'].map(st => `<option value="${esc(st)}"${st === str(r.status) ? ' selected' : ''}>${esc(st)}</option>`).join('')}
                  </select>
                  <button type="button" class="${BTN.secondary}" data-savest="${esc(r.tenant_id)}"${savingId === r.tenant_id ? ' disabled' : ''}>${savingId === r.tenant_id ? 'Saving…' : 'Save'}</button></div>` },
            ],
            list,
            { empty: stateEmpty('No dealerships yet', 'Onboard the first one below.') },
          );
      }
      tenants.innerHTML = head + body;
      tenants.querySelector('[data-retry]')?.addEventListener('click', tLoad);
      tenants.querySelectorAll('[data-savest]').forEach(b => b.addEventListener('click', () => saveStatus(b.dataset.savest)));
    };

    const tLoad = async () => {
      resetReads();
      try { rows = await readTenants(); rowsErr = null; }
      catch (e) { rows = null; rowsErr = e; }
      tDraw();
    };

    async function saveStatus(id) {
      if (savingId) return;
      const sel = tenants.querySelector(`[data-st="${id}"]`);
      if (!sel) return;
      savingId = id; saveMsg = ''; tDraw();
      try {
        await dbWrite('POST', 'rpc/nexus_founder_set_tenant_status', { p_tenant: id, p_status: sel.value });
        saveMsg = ''; saveTone = 'ok';
        savingId = null;
        await tLoad();
        await reloadInviteList();
        await reloadPaidList();
      } catch (e) {
        savingId = null;
        saveMsg = errorText(e); saveTone = 'hot';
        tDraw();
      }
    }

    reloadTenantsTable = tLoad;
    await tLoad();
  }

  /* ------------------------------------------------------------------------
     Onboard a dealer · Invite someone — side by side, as in the design
     ------------------------------------------------------------------------ */
  const actionsRow = el('div', 'grid grid-cols-1 xl:grid-cols-2 gap-space-lg');
  root.appendChild(actionsRow);

  const onboard = el('section', CARD); onboard.id = 'fcOnboard';
  actionsRow.appendChild(onboard);
  {
    let busy = false, msg = '', msgTone = 'ok';
    const draw = () => {
      onboard.innerHTML = cardHead('add_business', 'Onboard a dealer', "Calls nexus_founder_onboard_dealer(), which wraps the existing nexus_onboard_dealership() -- it does not create the tenant, the owner membership or the owner's login itself.")
        + `<div class="p-space-lg flex flex-col gap-space-md">
          ${msgBox(msg, msgTone)}
          <div class="${FORM_GRID2}">
            <div class="${FIELD}"><label for="obName">Dealership name</label><input id="obName" placeholder="Al Reem Motors" /></div>
            <div class="${FIELD}"><label for="obSlug">Slug</label><input id="obSlug" placeholder="al-reem-motors" /></div>
            <div class="${FIELD}"><label for="obEmail">Owner's email</label><input id="obEmail" type="email" placeholder="owner@dealer.com" /></div>
            <div class="${FIELD}"><label for="obPhone">Owner's phone (optional)</label><input id="obPhone" placeholder="+971 5…" /></div>
          </div>
          <p class="${SUB}">The owner's Supabase Auth login is not created by this button. Once the dealership exists it appears in the table above, and you invite the owner from "Invite someone to a dealership" -- that step is what actually sends them a way to sign in.</p>
          <div><button type="button" class="${BTN.primary}" id="obGo"${busy ? ' disabled' : ''}>${busy ? 'Onboarding…' : 'Onboard dealer'}</button></div>
        </div>`;
      $('obGo')?.addEventListener('click', submit);
    };
    const submit = async () => {
      if (busy) return;
      const name = str($('obName')?.value);
      const slug = str($('obSlug')?.value).toLowerCase();
      const email = str($('obEmail')?.value);
      const phone = str($('obPhone')?.value) || null;
      if (!name) { msg = 'A dealership name is required.'; msgTone = 'hot'; draw(); return; }
      if (!slug) { msg = 'A slug is required -- it is the id nexus_onboard_dealership() keys the dealership on.'; msgTone = 'hot'; draw(); return; }
      if (!email || email.indexOf('@') < 1) { msg = "That is not an owner's email address."; msgTone = 'hot'; draw(); return; }
      busy = true; msg = ''; draw();
      try {
        const tenantId = await dbWrite('POST', 'rpc/nexus_founder_onboard_dealer', {
          p_name: name, p_slug: slug, p_owner_email: email, p_phone: phone,
        });
        msg = `"${name}" was onboarded (id ${str(tenantId)}). It now appears in the table above -- invite ${email} to it from the panel beside this one to give them a login.`;
        msgTone = 'ok';
        resetReads();
        await Promise.all([reloadTenantsTable(), reloadInviteList(), reloadPaidList()]);
      } catch (e) {
        msg = errorText(e); msgTone = 'hot';
      } finally {
        busy = false; draw();
      }
    };
    draw();
  }

  const invite = el('section', CARD); invite.id = 'fcInvite';
  actionsRow.appendChild(invite);
  {
    let busy = false, msg = '', msgTone = 'ok', rows = null, rowsErr = null;
    const draw = () => {
      const opts = rows
        ? rows.map(r => `<option value="${esc(r.tenant_id)}">${esc(r.name || r.slug)}${r.is_test ? ' (test)' : ''}</option>`).join('')
        : '';
      invite.innerHTML = cardHead('person_add', 'Invite someone to a dealership', 'Calls the founder-invite Edge Function -- the one place in NEXUS that holds a service-role key, and it never leaves that function. This sends a real Supabase Auth invite email.')
        + `<div class="p-space-lg flex flex-col gap-space-md">
          ${!rows && !rowsErr ? stateLoading(2) : ''}
          ${rowsErr ? `<p class="font-body-sm text-body-sm text-red-700">The dealership list could not be read (${esc(errorText(rowsErr))}), so nothing can be chosen here.</p>` : ''}
          ${rows ? `${msgBox(msg, msgTone)}
          <div class="${FORM_GRID3}">
            <div class="${FIELD}"><label for="ivTenant">Dealership</label><select id="ivTenant">${opts}</select></div>
            <div class="${FIELD}"><label for="ivEmail">Email</label><input id="ivEmail" type="email" placeholder="person@example.com" /></div>
            <div class="${FIELD}"><label for="ivRole">Role</label><select id="ivRole">${ROLES.map(r => `<option value="${esc(r)}"${r === 'sales' ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
          </div>
          <div><button type="button" class="${BTN.primary}" id="ivGo"${busy ? ' disabled' : ''}>${busy ? 'Sending…' : 'Send invite'}</button></div>` : ''}
        </div>`;
      $('ivGo')?.addEventListener('click', send);
    };
    const send = async () => {
      if (busy) return;
      const tenant_id = $('ivTenant')?.value;
      const email = str($('ivEmail')?.value).toLowerCase();
      const role = $('ivRole')?.value || 'sales';
      if (!tenant_id) { msg = 'Choose a dealership first.'; msgTone = 'hot'; draw(); return; }
      if (!email || email.indexOf('@') < 1) { msg = 'That is not an email address.'; msgTone = 'hot'; draw(); return; }
      busy = true; msg = ''; draw();
      try {
        const back = await edgeFn('founder-invite', { tenant_id, email, role });
        msg = back.outcome === 'invited'
          ? `An invite email was sent to ${back.email} for "${back.tenant_name}" as ${back.role}.`
          : back.outcome === 'already_member'
            ? `${back.email} already has access to "${back.tenant_name}" -- nothing was changed.`
            : `${back.email} already had a NEXUS login, so no invite email was sent; they now have access to "${back.tenant_name}" as ${back.role}.`;
        msgTone = 'ok';
      } catch (e) {
        msg = errorText(e); msgTone = 'hot';
      } finally {
        busy = false; draw();
      }
    };
    reloadInviteList = async () => {
      try { rows = await readTenants(); rowsErr = null; } catch (e) { rowsErr = e; }
      draw();
    };
    reloadInviteList();
  }

  /* ------------------------------------------------------------------------
     Pay now link · Record a payment
     ------------------------------------------------------------------------ */
  const moneyRow = el('div', 'grid grid-cols-1 xl:grid-cols-2 gap-space-lg');
  root.appendChild(moneyRow);

  /* Pay now link -- what a dealer's Subscription screen shows and opens.

     NX1010 (owner decision, 21 Sep 2026): a dealer must never see a bank
     name, an account holder name or an IBAN. NEXUS is paid through a
     Ziina hosted payment link instead -- the founder pastes that link
     here, and nexus_founder_set_payment_link() rejects anything that is
     not an https:// URL on ziina.com, pay.ziina.com, or a *.ziina.com
     subdomain, because this link is shown, unauthenticated in effect, to
     every dealership on the platform. There is no founder-facing READ of
     the stored row on load, same as NX1008's payment form: this card
     shows nothing until a successful save, then shows exactly what was
     just saved, from that save's own response. */
  const payment = el('section', CARD); payment.id = 'fcPay';
  moneyRow.appendChild(payment);
  {
    let busy = false, msg = '', msgTone = 'ok', saved = null;
    const draw = () => {
      payment.innerHTML = cardHead('link', 'Pay now link', "What every dealer's Subscription screen shows and opens: \"NEXUS by {display name} -- AED 399/month -- Pay now\". No card processor integration, no API keys -- the link IS the integration. Stored in platform_payment_details (RLS on, no policies) and read back by dealers only through nexus_payment_instructions().")
        + `<div class="p-space-lg flex flex-col gap-space-md">
          ${msgBox(msg, msgTone)}
          ${saved ? `<p class="${SUB}">On file now: "${esc(saved.displayName)}", link ending <span class="font-label-numeric-sm">…${esc(saved.linkTail)}</span>.</p>` : ''}
          <div class="${FORM_GRID2}">
            <div class="${FIELD}"><label for="plUrl">Payment link (Ziina)</label><input id="plUrl" placeholder="https://pay.ziina.com/..." class="font-label-numeric-sm" /></div>
            <div class="${FIELD}"><label for="plName">Display name</label><input id="plName" value="Adqonic" /></div>
          </div>
          <p class="${SUB}">Must be an https:// link on ziina.com, ziina.me, or a subdomain of either -- nexus_founder_set_payment_link() refuses anything else, because this link is shown to every dealer on the platform.</p>
          <div class="flex gap-space-sm flex-wrap">
            <button type="button" class="${BTN.primary}" id="plGo"${busy ? ' disabled' : ''}>${busy ? 'Saving…' : 'Save'}</button>
            <button type="button" class="${BTN.secondary}" id="plTest">Test link</button>
          </div>
        </div>`;
      $('plGo')?.addEventListener('click', submit);
      $('plTest')?.addEventListener('click', () => {
        const url = str($('plUrl')?.value);
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
      });
    };
    const sameHost = url => {
      const m = /^https:\/\/([a-zA-Z0-9.-]+)(?::[0-9]{1,5})?(?:\/[^\s]*)?$/.exec(url);
      if (!m) return false;
      const h = m[1].toLowerCase();
      return h === 'ziina.com' || h === 'pay.ziina.com' || h.slice(-10) === '.ziina.com' || h === 'ziina.me' || h.slice(-9) === '.ziina.me';
    };
    const submit = async () => {
      if (busy) return;
      const url = str($('plUrl')?.value);
      const name = str($('plName')?.value) || 'Adqonic';
      if (!url) { msg = 'A payment link is required.'; msgTone = 'hot'; draw(); return; }
      if (!/^https:\/\//.test(url) || !sameHost(url)) {
        msg = 'The payment link must be an https:// URL on ziina.com, ziina.me, or a subdomain of either.';
        msgTone = 'hot'; draw(); return;
      }
      if (name.length > 60) { msg = 'The display name must be 60 characters or fewer.'; msgTone = 'hot'; draw(); return; }
      busy = true; msg = ''; draw();
      try {
        const row = await dbWrite('POST', 'rpc/nexus_founder_set_payment_link', {
          p_payment_link_url: url, p_display_name: name,
        });
        const linkBack = str(row && row.payment_link_url);
        saved = {
          displayName: str(row && row.display_name) || 'Adqonic',
          linkTail: linkBack ? linkBack.slice(-16) : '—',
        };
        msg = 'Payment link saved. Every dealer now sees this through their own Subscription screen.';
        msgTone = 'ok';
      } catch (e) {
        msg = errorText(e); msgTone = 'hot';
      } finally {
        busy = false; draw();
      }
    };
    draw();
  }

  /* Record a payment -- moved here from screens/subscription.js on 22 Sep
     2026, where it used to draw (for the founder only) at the bottom of the
     dealer's own Subscription screen. Here the founder names the dealership
     explicitly, from the same nexus_founder_list_tenants() list every other
     card on this console reads. nexus_founder_mark_paid() re-checks
     nexus_is_platform_admin() server-side and refuses without a reference,
     whatever this form does. */
  const paid = el('section', CARD); paid.id = 'fcPaid';
  moneyRow.appendChild(paid);
  {
    let busy = false, msg = '', msgTone = 'ok', rows = null, rowsErr = null;
    const draw = () => {
      const opts = rows
        ? rows.map(r => `<option value="${esc(r.tenant_id)}">${esc(r.name || r.slug)}${r.is_test ? ' (test)' : ''}</option>`).join('')
        : '';
      paid.innerHTML = cardHead('receipt_long', 'Record a payment', 'Marks a dealership paid by hand through nexus_founder_mark_paid(). Extends from the current paid-through date if there is time left on it, otherwise starts from today. The reference is kept forever in subscription_event.')
        + `<div class="p-space-lg flex flex-col gap-space-md">
          ${!rows && !rowsErr ? stateLoading(2) : ''}
          ${rowsErr ? `<p class="font-body-sm text-body-sm text-red-700">The dealership list could not be read (${esc(errorText(rowsErr))}), so nothing can be chosen here.</p>` : ''}
          ${rows ? `${msgBox(msg, msgTone)}
          <div class="${FORM_GRID3}">
            <div class="${FIELD}"><label for="mpTenant">Dealership</label><select id="mpTenant">${opts}</select></div>
            <div class="${FIELD}"><label for="mpMonths">Months paid for</label><input type="number" id="mpMonths" min="1" max="12" value="1" /></div>
            <div class="${FIELD}"><label for="mpRef">Payment reference</label><input type="text" id="mpRef" placeholder="Ziina receipt, bank transfer id, etc." /></div>
          </div>
          <div><button type="button" class="${BTN.primary}" id="mpGo"${busy ? ' disabled' : ''}>${busy ? 'Recording…' : 'Record payment'}</button></div>` : ''}
        </div>`;
      $('mpGo')?.addEventListener('click', submit);
    };
    const submit = async () => {
      if (busy) return;
      const tenant = $('mpTenant')?.value;
      const months = Number($('mpMonths')?.value);
      const reference = str($('mpRef')?.value);
      if (!tenant) { msg = 'Choose a dealership first.'; msgTone = 'hot'; draw(); return; }
      if (!Number.isInteger(months) || months < 1 || months > 12) { msg = 'Months must be a whole number from 1 to 12.'; msgTone = 'hot'; draw(); return; }
      if (!reference) { msg = 'A reference is required -- nexus_founder_mark_paid() will refuse without one.'; msgTone = 'hot'; draw(); return; }
      busy = true; msg = ''; draw();
      try {
        await dbWrite('POST', 'rpc/nexus_founder_mark_paid', {
          p_tenant: tenant, p_months: months, p_reference: reference,
        });
        const hit = (rows || []).find(r => r.tenant_id === tenant);
        msg = `Payment recorded for ${hit ? (hit.name || hit.slug) : 'that dealership'}: ${months} month${months === 1 ? '' : 's'}, reference ${reference}.`;
        msgTone = 'ok';
        resetReads();
        await reloadTenantsTable();
      } catch (e) {
        msg = errorText(e); msgTone = 'hot';
      } finally {
        busy = false; draw();
      }
    };
    reloadPaidList = async () => {
      try { rows = await readTenants(); rowsErr = null; } catch (e) { rowsErr = e; }
      draw();
    };
    reloadPaidList();
  }

  /* ------------------------------------------------------------------------
     Quarantine census · Notification gateway
     ------------------------------------------------------------------------ */
  const opsRow = el('div', 'grid grid-cols-1 xl:grid-cols-2 gap-space-lg items-start');
  root.appendChild(opsRow);
  const quarantine = el('div'); quarantine.id = 'fcQuarantine';
  opsRow.appendChild(quarantine);
  panel(quarantine, {
    title: 'Quarantine census',
    icon: 'gpp_maybe',
    sub: 'nexus_founder_quarantine_census(), wrapping nexus_quarantine_census(): rows sitting in the UNATTRIBUTED tenant, by table, because they arrived with no dealership NEXUS could attribute them to.',
    load: () => dbWrite('POST', 'rpc/nexus_founder_quarantine_census', {}),
    render: rows => table(
      [
        { label: 'Table', render: r => `<span class="font-label-numeric-sm">${esc(r.tbl)}</span>` },
        { label: 'Rows', align: 'r', render: r => count(r.rows) },
        { label: 'Newest', render: r => (r.newest ? esc(dubaiStamp(r.newest)) : '—') },
      ],
      Array.isArray(rows) ? rows : [],
      { empty: stateEmpty('Quarantine is empty', 'Nothing is sitting unattributed right now.') },
    ),
  });
  const gateway = el('section', CARD);
  gateway.innerHTML = cardHead('outgoing_mail', 'Platform notification gateway', 'What NEXUS has queued and sent to people, across dealerships.', statusChip('not-tested', 'Not readable here'))
    + `<div class="p-space-md">${emptyState({ icon: 'lock', title: 'The outbox is not readable from this page',
      body: 'nexus_notification_outbox is service-role only — its row policy refuses every signed-in account, the founder’s included — and no founder RPC reads it. So nothing is shown rather than counts this page cannot see. Delivered, failed and queued totals need a founder read of the outbox first.' })}</div>`;
  opsRow.appendChild(gateway);

  /* ------------------------------------------------------------------------
     Infrastructure probes · Workflow health
     ------------------------------------------------------------------------ */
  const healthRow = el('div', 'grid grid-cols-1 xl:grid-cols-2 gap-space-lg items-start');
  root.appendChild(healthRow);
  const infra = el('section', CARD);
  infra.innerHTML = cardHead('dns', 'Infrastructure health probes', 'Database, automation host, WhatsApp session and the rest of the stack.', statusChip('not-tested', 'No source'))
    + `<div class="p-space-md">${emptyState({ icon: 'monitor_heart', title: 'No probe result is recorded anywhere this page can read',
      body: 'The infrastructure probe runs as a workflow on the automation host and keeps its results in that host’s own execution history, not in the database. Until a probe writes its result to a table the founder can read, this panel shows nothing rather than a green light it has not measured.' })}</div>`;
  healthRow.appendChild(infra);
  const wfHost = el('div');
  healthRow.appendChild(wfHost);
  panel(wfHost, {
    title: 'Workflow health',
    icon: 'account_tree',
    sub: 'v_workflow_health. The list of automations is NEXUS’s own register and the same for every dealership; the run counts and health beside them are read through THIS account’s own dealership, so they describe that dealership’s runs, not the platform’s.',
    load: () => readWorkflows(),
    render: rows => table(
      [
        { label: 'Workflow', strong: true, render: r => `${esc(str(r.name) || 'Unnamed workflow')}<div class="font-body-sm text-body-sm text-outline">${esc(str(r.category) || 'no category')}${r.is_active === false ? ' · switched off' : ''}</div>` },
        /* The health word is lib/health.js's, the one place allowed to say
           what a v_workflow_health state means; a word it does not know is
           shown verbatim as unknown rather than guessed at. */
        { label: 'Health', render: r => {
          const k = str(r.health).toUpperCase();
          if (!Object.prototype.hasOwnProperty.call(HEALTH_WORDS, k)) return pill(str(r.health) || 'unknown', 'unknown', { verbatim: true });
          const h = healthWords(k);
          return `<span title="${esc(h.blurb)}">${pill(h.label, h.tone, { verbatim: false })}</span>`;
        } },
        { label: 'Runs 30 d', align: 'r', render: r => (n0(r.runs_30d) == null ? '—' : count(r.runs_30d)) },
        { label: 'Success 30 d', align: 'r', render: r => (n0(r.success_rate_30d) == null ? '—' : `${esc(String(n0(r.success_rate_30d)))}%`) },
        { label: 'Last run', render: r => (r.last_run ? esc(ago(r.last_run)) : 'never') },
      ],
      Array.isArray(rows) ? rows : [],
      { empty: stateEmpty('No workflow rows came back', 'This account reads the register through its own dealership membership; an account in no dealership gets no rows. That is a scope, not an empty register.') },
    ),
  });

  /* ------------------------------------------------------------------------
     Feature availability by dealership · Release readiness (a38ee6)
     ------------------------------------------------------------------------ */
  const roadRow = el('div', 'grid grid-cols-1 xl:grid-cols-2 gap-space-lg');
  roadRow.innerHTML = soon('coming-soon', 'grid_view', 'Feature availability by dealership',
      'Which capability is live, partial or missing for each dealership, side by side. Every dealership’s own Subscription screen already shows its own list (nexus_my_tenant_capabilities); the cross-dealership matrix has no founder read yet, so no cell is drawn.',
      'A founder RPC that reads tenant_capability across dealerships under the platform-admin check.')
    + soon('planned', 'rocket_launch', 'Release readiness',
      'Which release is live, what is waiting to ship and what it was checked against. NEXUS records no release, version or deploy event in the database, so there is nothing to list.',
      'A release record written by the deploy, with the checks it passed.');
  root.appendChild(roadRow);

  /* ------------------------------------------------------------------------
     Test tenants, named separately
     ------------------------------------------------------------------------ */
  const testHost = el('div'); testHost.id = 'fcTest';
  root.appendChild(testHost);
  panel(testHost, {
    title: 'Test tenants',
    icon: 'science',
    sub: 'Every dealership whose slug starts "test-" -- nexus_founder_list_tenants()’s own is_test flag, not a second guess at the same rule. Fixtures, not customers; never counted in the tiles above.',
    load,
    render: rows => {
      const test = (Array.isArray(rows) ? rows : []).filter(r => r.is_test);
      return table(
        [
          { label: 'Slug', render: r => `<span class="font-label-numeric-sm">${esc(r.slug)}</span>` },
          { label: 'Name', render: r => esc(r.name) },
          { label: 'Status', render: r => statusOf(r) },
          { label: 'Created', render: r => esc(dubaiStamp(r.created_at)) },
        ],
        test,
        { empty: stateEmpty('No test tenants', 'Nothing on this platform has a slug starting "test-" right now.') },
      );
    },
  });

  const foot = el('div');
  foot.innerHTML = trustFooter({ source: 'nexus_founder_list_tenants · nexus_founder_quarantine_census · v_workflow_health', asOf: dubaiStamp(new Date().toISOString()), evidence: 'Platform-admin RPCs, re-checked server-side', actor: actor() });
  root.appendChild(foot);
}

/* A KPI row that loads once with its own skeleton and error panel. */
function panelBare(host, load, render) {
  const box = el('div');
  host.appendChild(box);
  box.innerHTML = stateLoading(2);
  load().then(v => { box.innerHTML = render(v); }, e => { box.innerHTML = stateError('the dealership counts', e); });
}
