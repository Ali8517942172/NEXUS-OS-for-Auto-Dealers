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
import { ago, dubaiStamp, esc, n0, pill } from '../lib/format.js';
import { isPlatformAdmin, loadPlatformAdmin } from '../lib/platform.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi, panel, table } from '../lib/ui.js';

const str = v => String(v == null ? '' : v).trim();
const ROLES = ['owner', 'admin', 'manager', 'sales', 'technician', 'member'];
const STATUS_TONE = { active: 'ok', suspended: 'hot', archived: 'unknown' };
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
  return `<div class="state err"><span class="material-symbols-outlined">shield_person</span>
    <h3>This is the NEXUS founder console</h3>
    <p>Every dealership's onboarding, status and invite controls live here, and none of them are scoped to one
       dealership the way the rest of this app is -- so this screen is not shown, and its RPCs refuse, to anyone
       whose account is not the platform admin. If that should be you, sign in as that account.</p></div>`;
}

/* ==========================================================================
   SCREEN
   ========================================================================== */
export async function renderFounderConsole(host) {
  resetReads();

  /* Usually already resolved -- founder/app.js awaits this at boot, before
     this console is ever rendered -- so this is
     normally a synchronous read of a settled cache, not a second round-trip. */
  await loadPlatformAdmin();
  if (!isPlatformAdmin()) { host.innerHTML = stateFounderOnly(); return; }

  const load = () => readTenants();

  /* Filled in once the tenants table (P4) and the invite dropdown (P3) exist
     below, so P2's onboarding form can ask both to catch up on the dealer it
     just created without this screen re-rendering itself wholesale. Declared
     here, ahead of P2, so P2's own submit handler -- which only ever runs
     later, on a click -- closes over whichever functions end up assigned. */
  let reloadTenantsTable = async () => {};
  let reloadInviteList = async () => {};

  /* ------------------------------------------------------------------------
     P1 · Every dealership, counted
     ------------------------------------------------------------------------ */
  panel(host, {
    title: 'Every dealership on NEXUS',
    sub: 'Counted from nexus_founder_list_tenants() -- real and test tenants both, told apart below rather than mixed into one figure.',
    load,
    render: rows => {
      const all = Array.isArray(rows) ? rows : [];
      const real = all.filter(r => !r.is_test);
      const test = all.filter(r => r.is_test);
      const active = real.filter(r => str(r.status) === 'active');
      const suspended = real.filter(r => str(r.status) === 'suspended');

      const totalTile = kpi('Dealerships', count(real.length),
        `<div class="cell-sub">${esc(count(test.length))} more ${test.length === 1 ? 'is' : 'are'} test ${test.length === 1 ? 'fixture' : 'fixtures'} (slug starting <span class="mono">test-</span>) and counted separately below.</div>`);
      const activeTile = kpi('Active', count(active.length), '', active.length ? 't-ok' : '');
      const suspendedTile = kpi('Suspended', count(suspended.length), '', suspended.length ? 't-hot' : '');
      const testTile = kpi('Test tenants', count(test.length),
        `<div class="cell-sub">${test.length ? 'Never a real dealership’s activity -- see the labelled list further down.' : 'None on this platform right now.'}</div>`,
        test.length ? 't-warm' : '');

      return `<div class="grid g4">${totalTile}${activeTile}${suspendedTile}${testTile}</div>`;
    },
  });

  /* ------------------------------------------------------------------------
     P2 · Onboard a dealer
     ------------------------------------------------------------------------ */
  const onboard = el('div', 'card');
  onboard.style.marginTop = '16px';
  host.appendChild(onboard);
  {
    let busy = false, msg = '', msgTone = 'ok';
    const draw = () => {
      onboard.innerHTML = `<div class="card-title">Onboard a dealer</div>
        <div class="card-sub" style="margin-bottom:14px">Calls nexus_founder_onboard_dealer(), which wraps the existing nexus_onboard_dealership() -- it does not create the tenant, the owner membership or the owner's login itself.</div>
        ${msg ? `<div class="banner ${msgTone === 'ok' ? 'info' : 'hot'}" style="margin-bottom:14px"><span class="material-symbols-outlined" style="font-size:20px">${msgTone === 'ok' ? 'check_circle' : 'error'}</span><div>${esc(msg)}</div></div>` : ''}
        <div class="grid g2" style="gap:12px">
          <div class="field"><label for="obName">Dealership name</label><input id="obName" placeholder="Al Reem Motors" /></div>
          <div class="field"><label for="obSlug">Slug</label><input id="obSlug" placeholder="al-reem-motors" /></div>
          <div class="field"><label for="obEmail">Owner's email</label><input id="obEmail" type="email" placeholder="owner@dealer.com" /></div>
          <div class="field"><label for="obPhone">Owner's phone (optional)</label><input id="obPhone" placeholder="+971 5…" /></div>
        </div>
        <div class="cell-sub" style="margin-top:10px">The owner's Supabase Auth login is not created by this button. Once the dealership exists it appears in the table below, and you invite the owner from the "Invite someone to a dealership" panel underneath -- that step is what actually sends them a way to sign in.</div>
        <button class="btn primary" id="obGo" style="margin-top:14px"${busy ? ' disabled' : ''}>${busy ? 'Onboarding…' : 'Onboard dealer'}</button>`;
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
        msg = `"${name}" was onboarded (id ${str(tenantId)}). It now appears in the table below -- invite ${email} to it from the panel above to give them a login.`;
        msgTone = 'ok';
        resetReads();
        await Promise.all([reloadTenantsTable(), reloadInviteList()]);
      } catch (e) {
        msg = errorText(e); msgTone = 'hot';
      } finally {
        busy = false; draw();
      }
    };
    draw();
  }

  /* ------------------------------------------------------------------------
     P3 · Invite somebody into a dealership
     ------------------------------------------------------------------------ */
  const invite = el('div', 'card');
  invite.style.marginTop = '16px';
  host.appendChild(invite);
  {
    let busy = false, msg = '', msgTone = 'ok', rows = null, rowsErr = null;
    const draw = () => {
      const opts = rows
        ? rows.map(r => `<option value="${esc(r.tenant_id)}">${esc(r.name || r.slug)}${r.is_test ? ' (test)' : ''}</option>`).join('')
        : '';
      invite.innerHTML = `<div class="card-title">Invite someone to a dealership</div>
        <div class="card-sub" style="margin-bottom:14px">Calls the founder-invite Edge Function -- the one place in NEXUS that holds a service-role key, and it never leaves that function. This sends a real Supabase Auth invite email.</div>
        ${!rows && !rowsErr ? stateLoading(2) : ''}
        ${rowsErr ? `<div class="cell-sub t-hot">The dealership list could not be read (${esc(errorText(rowsErr))}), so nothing can be chosen here.</div>` : ''}
        ${rows ? `
        ${msg ? `<div class="banner ${msgTone === 'ok' ? 'info' : 'hot'}" style="margin-bottom:14px"><span class="material-symbols-outlined" style="font-size:20px">${msgTone === 'ok' ? 'check_circle' : 'error'}</span><div>${esc(msg)}</div></div>` : ''}
        <div class="grid g3" style="gap:12px">
          <div class="field"><label for="ivTenant">Dealership</label><select id="ivTenant">${opts}</select></div>
          <div class="field"><label for="ivEmail">Email</label><input id="ivEmail" type="email" placeholder="person@example.com" /></div>
          <div class="field"><label for="ivRole">Role</label><select id="ivRole">${ROLES.map(r => `<option value="${esc(r)}"${r === 'sales' ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
        </div>
        <button class="btn primary" id="ivGo" style="margin-top:14px"${busy ? ' disabled' : ''}>${busy ? 'Sending…' : 'Send invite'}</button>` : ''}`;
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
     P4 · Every dealership, with suspend / activate controls

     Built as a self-contained load/draw pair rather than through lib/ui.js's
     panel(), on purpose: panel() re-renders from ITS OWN retry button and
     replays wiring closures registered via `.then()`, which is exactly right
     for a card that only ever reads (see channels.js) and awkward for one
     that must re-fetch and redraw itself in response to a save made from
     inside its own rows -- the same reason screens/team.js's "who has
     access" card (acLoad/acDraw/acCall) is hand-rolled instead of going
     through panel() too. This is that same shape, applied to dealerships
     instead of teammates.
     ------------------------------------------------------------------------ */
  const tenants = el('div', 'card flush');
  tenants.style.marginTop = '16px';
  host.appendChild(tenants);
  {
    let rows = null, rowsErr = null, saveMsg = '', saveTone = 'hot', savingId = null;

    const tDraw = () => {
      const head = `<div class="card-head"><div><div class="card-title">Dealerships</div>
          <div class="card-sub">Status is read and written here exactly as nexus_founder_set_tenant_status() enforces it: active, suspended or archived. The quarantine tenant is not a dealership and is never listed or offered a control.</div></div></div>`;
      let body;
      if (!rows && !rowsErr) body = stateLoading(4);
      else if (rowsErr) body = stateError('dealerships', rowsErr, 'treload');
      else {
        const list = rows.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        body = (saveMsg ? `<div class="banner ${saveTone === 'ok' ? 'info' : 'hot'}" style="margin:12px 16px 0"><span class="material-symbols-outlined" style="font-size:20px">${saveTone === 'ok' ? 'check_circle' : 'error'}</span><div>${esc(saveMsg)}</div></div>` : '')
          + table(
            [
              { label: 'Dealership', render: r => `${esc(r.name || r.slug)}${r.is_test ? ' <span class="chip">test</span>' : ''}<div class="cell-sub">${esc(r.slug)}</div>` },
              { label: 'Status', render: r => pill(str(r.status) || 'unknown', STATUS_TONE[str(r.status)] || 'unknown') },
              { label: 'Members', render: r => count(r.member_count), align: 'r' },
              { label: 'Leads', render: r => count(r.leads_count), align: 'r' },
              { label: 'Subscription', render: r => esc(str(r.subscription_status) || 'none on record') },
              { label: 'Last activity', render: r => `<span title="${esc(dubaiStamp(r.last_activity_at))}">${esc(ago(r.last_activity_at))}</span>` },
              { label: 'Created', render: r => esc(dubaiStamp(r.created_at)) },
              { label: '', align: 'r', render: r => `
                  <select data-st="${esc(r.tenant_id)}" aria-label="Status for ${esc(r.name || r.slug)}"${savingId === r.tenant_id ? ' disabled' : ''}>
                    ${['active', 'suspended', 'archived'].map(s => `<option value="${esc(s)}"${s === str(r.status) ? ' selected' : ''}>${esc(s)}</option>`).join('')}
                  </select>
                  <button class="btn sm" data-savest="${esc(r.tenant_id)}"${savingId === r.tenant_id ? ' disabled' : ''}>${savingId === r.tenant_id ? 'Saving…' : 'Save'}</button>` },
            ],
            list,
            { empty: stateEmpty('No dealerships yet', 'Onboard the first one above.') },
          );
      }
      tenants.innerHTML = head + `<div class="pbody">${body}</div>`;
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
     P5 · Test tenants, named separately
     ------------------------------------------------------------------------ */
  panel(host, {
    title: 'Test tenants',
    sub: 'Every dealership whose slug starts "test-" -- nexus_founder_list_tenants()’s own is_test flag, not a second guess at the same rule. Fixtures, not customers; never counted in the real-dealership tile above.',
    cols: '1 / -1',
    load,
    render: rows => {
      const test = (Array.isArray(rows) ? rows : []).filter(r => r.is_test);
      return table(
        [
          { label: 'Slug', render: r => `<span class="mono">${esc(r.slug)}</span>` },
          { label: 'Name', render: r => esc(r.name) },
          { label: 'Status', render: r => pill(str(r.status) || 'unknown', STATUS_TONE[str(r.status)] || 'unknown') },
          { label: 'Created', render: r => esc(dubaiStamp(r.created_at)) },
        ],
        test,
        { empty: stateEmpty('No test tenants', 'Nothing on this platform has a slug starting "test-" right now.') },
      );
    },
  });

  /* ------------------------------------------------------------------------
     P6 · Quarantine census
     ------------------------------------------------------------------------ */
  panel(host, {
    title: 'Quarantine census',
    sub: 'nexus_founder_quarantine_census(), wrapping nexus_quarantine_census(): rows sitting in the UNATTRIBUTED tenant, by table, because they arrived with no dealership NEXUS could attribute them to.',
    cols: '1 / -1',
    load: () => dbWrite('POST', 'rpc/nexus_founder_quarantine_census', {}),
    render: rows => table(
      [
        { label: 'Table', render: r => `<span class="mono">${esc(r.tbl)}</span>` },
        { label: 'Rows', render: r => count(r.rows), align: 'r' },
        { label: 'Newest', render: r => r.newest ? esc(dubaiStamp(r.newest)) : '—' },
      ],
      Array.isArray(rows) ? rows : [],
      { empty: stateEmpty('Quarantine is empty', 'Nothing is sitting unattributed right now.') },
    ),
  });

  /* ------------------------------------------------------------------------
     P7 . Pay now link -- what a dealer's Subscription screen shows and opens

     NX1010 (owner decision, 21 Sep 2026): a dealer must never see a bank
     name, an account holder name or an IBAN. NEXUS is paid through a
     Ziina hosted payment link instead -- the founder pastes that link
     here, and nexus_founder_set_payment_link() rejects anything that is
     not an https:// URL on ziina.com, pay.ziina.com, or a *.ziina.com
     subdomain, because this link is shown, unauthenticated in effect, to
     every dealership on the platform. There is no founder-facing READ of
     the stored row on load, same as NX1008's payment form: this card
     shows nothing until a successful save, then shows exactly what was
     just saved, from that save's own response.
     ------------------------------------------------------------------------ */
  const payment = el('div', 'card');
  payment.style.marginTop = '16px';
  host.appendChild(payment);
  {
    let busy = false, msg = '', msgTone = 'ok', saved = null;
    const draw = () => {
      payment.innerHTML = `<div class="card-title">Pay now link</div>
        <div class="card-sub" style="margin-bottom:14px">What every dealer's Subscription screen shows and opens: "NEXUS by {display name} -- AED 399/month -- Pay now". No card processor integration, no API keys -- the link IS the integration. Stored in platform_payment_details (RLS on, no policies) and read back by dealers only through nexus_payment_instructions().</div>
        ${msg ? `<div class="banner ${msgTone === 'ok' ? 'info' : 'hot'}" style="margin-bottom:14px"><span class="material-symbols-outlined" style="font-size:20px">${msgTone === 'ok' ? 'check_circle' : 'error'}</span><div>${esc(msg)}</div></div>` : ''}
        ${saved ? `<div class="cell-sub" style="margin-bottom:14px">On file now: "${esc(saved.displayName)}", link ending <span class="mono">…${esc(saved.linkTail)}</span>.</div>` : ''}
        <div class="grid g2" style="gap:12px">
          <div class="field"><label for="plUrl">Payment link (Ziina)</label><input id="plUrl" placeholder="https://pay.ziina.com/..." class="mono" /></div>
          <div class="field"><label for="plName">Display name</label><input id="plName" value="Adqonic" /></div>
        </div>
        <div class="cell-sub" style="margin-top:10px">Must be an https:// link on ziina.com, ziina.me, or a subdomain of either -- nexus_founder_set_payment_link() refuses anything else, because this link is shown to every dealer on the platform.</div>
        <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn primary" id="plGo"${busy ? ' disabled' : ''}>${busy ? 'Saving…' : 'Save'}</button>
          <button class="btn ghost" id="plTest" type="button">Test link</button>
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
      const host = m[1].toLowerCase();
      return host === 'ziina.com' || host === 'pay.ziina.com' || host.slice(-10) === '.ziina.com' || host === 'ziina.me' || host.slice(-9) === '.ziina.me';
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

  /* ------------------------------------------------------------------------
     P8 . Record a payment -- moved here from screens/subscription.js on
     22 Sep 2026, where it used to draw (for the founder only) at the bottom
     of the dealer's own Subscription screen. Here the founder names the
     dealership explicitly, from the same nexus_founder_list_tenants() list
     every other card on this console reads. nexus_founder_mark_paid()
     re-checks nexus_is_platform_admin() server-side and refuses without a
     reference, whatever this form does.
     ------------------------------------------------------------------------ */
  const paid = el('div', 'card');
  paid.style.marginTop = '16px';
  host.appendChild(paid);
  {
    let busy = false, msg = '', msgTone = 'ok', rows = null, rowsErr = null;
    const draw = () => {
      const opts = rows
        ? rows.map(r => `<option value="${esc(r.tenant_id)}">${esc(r.name || r.slug)}${r.is_test ? ' (test)' : ''}</option>`).join('')
        : '';
      paid.innerHTML = `<div class="card-title">Record a payment</div>
        <div class="card-sub" style="margin-bottom:14px">Marks a dealership paid by hand through nexus_founder_mark_paid(). Extends from the current paid-through date if there is time left on it, otherwise starts from today. The reference is kept forever in subscription_event.</div>
        ${!rows && !rowsErr ? stateLoading(2) : ''}
        ${rowsErr ? `<div class="cell-sub t-hot">The dealership list could not be read (${esc(errorText(rowsErr))}), so nothing can be chosen here.</div>` : ''}
        ${rows ? `
        ${msg ? `<div class="banner ${msgTone === 'ok' ? 'info' : 'hot'}" style="margin-bottom:14px"><span class="material-symbols-outlined" style="font-size:20px">${msgTone === 'ok' ? 'check_circle' : 'error'}</span><div>${esc(msg)}</div></div>` : ''}
        <div class="grid g3" style="gap:12px">
          <div class="field"><label for="mpTenant">Dealership</label><select id="mpTenant">${opts}</select></div>
          <div class="field"><label for="mpMonths">Months paid for</label><input type="number" id="mpMonths" min="1" max="12" value="1" /></div>
          <div class="field"><label for="mpRef">Payment reference</label><input type="text" id="mpRef" placeholder="Ziina receipt, bank transfer id, etc." /></div>
        </div>
        <button class="btn primary" id="mpGo" style="margin-top:14px"${busy ? ' disabled' : ''}>${busy ? 'Recording…' : 'Record payment'}</button>` : ''}`;
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
    (async () => {
      try { rows = await readTenants(); rowsErr = null; } catch (e) { rowsErr = e; }
      draw();
    })();
  }
}
