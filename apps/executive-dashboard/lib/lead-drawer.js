/* NEXUS OS — lib/lead-drawer.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { db, dbWrite } from './data.js';
import { $, el } from './dom.js';
import { aed, ago, esc, initials, mins, n0, pill, tone } from './format.js';
import { go } from './nav.js';
import { stateEmpty, stateLoading } from './states.js';
import { closeDrawer, openDrawer } from './ui.js';

async function leadDrawer(lead) {
  const email = String(lead.email || '').toLowerCase();
  openDrawer(`
    <div class="drawer-head">
      <div class="avatar">${esc(initials(lead.name))}</div>
      <div style="flex:1;min-width:0">
        <h2 style="font-size:18px">${esc(lead.name)}</h2>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${pill(lead.status || 'NEW')}
          ${n0(lead.ai_score) != null ? `<span class="chip">AI score ${lead.ai_score}</span>` : ''}</div>
      </div>
      <button class="btn ghost sm" id="dClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
    </div>
    <div class="drawer-body">
      <div class="section">
        <div class="label-caps">Contact</div>
        <dl class="kv">
          <dt>Email</dt><dd>${esc(lead.email || '—')}</dd>
          <dt>Phone</dt><dd>${lead.phone
            ? esc(lead.phone)
            : '<span class="cell-sub">No phone number is recorded on this lead.</span>'}</dd>
          <dt>Source</dt><dd>${esc(lead.source || '—')}</dd>
          <dt>Vehicle</dt><dd>${esc(lead.vehicle_interest || '—')}</dd>
          <dt>Budget</dt><dd>${n0(lead.budget_aed) == null ? '<span class="t-muted">Not captured by the router</span>' : aed(lead.budget_aed)}</dd>
          <dt>Assigned to</dt><dd>${
            /* `users?.name` only resolves when the caller selected the
               `users(id,name)` embed. Overview and Conversations do not, so a
               perfectly well-owned lead read "Unassigned" — the plain
               `assigned_to` column is what every caller gets. */
            esc(lead.users?.name || lead.assigned_to || '') || 'Unassigned'
          }${lead.assigned_to_id ? '' : '<span class="cell-sub"> · no rep id on the row</span>'}</dd>
          <dt>Response time</dt><dd>${n0(lead.response_time_minutes) == null
            /* Not a blank. `response_time_minutes` is the only record of how
               long this customer waited for a first answer, and the 5-minute
               rule is the founding promise of this product — so a null here is
               not "fast", it is nobody measuring. A dash reads as instant. */
            ? '<span class="t-warm">Not measured</span><span class="cell-sub"> · no first-reply time was recorded on this lead, so it is neither fast nor slow, and v_needs_attention cannot raise an SLA breach for it</span>'
            : `${mins(lead.response_time_minutes)} ${Number(lead.response_time_minutes) > 5 ? '<span class="t-hot">· breaches the 5-minute rule</span>' : '<span class="t-ok">· within SLA</span>'}`}</dd>
          <dt>Created</dt><dd>${ago(lead.created_at)}</dd>
        </dl>
      </div>
      <div class="section" id="dVip"></div>
      <div class="section">
        <div class="label-caps">Activity</div>
        <div id="dTimeline">${stateLoading(3)}</div>
      </div>
    </div>
    <div class="drawer-foot">
      <button class="btn" id="dWhats"><span class="material-symbols-outlined">chat</span>Open conversation</button>
      <button class="btn" id="dAssign">Assign to…</button>
    </div>`);

  $('dClose').addEventListener('click', closeDrawer);
  $('dWhats').addEventListener('click', () => { closeDrawer(); go('conversations'); });
  $('dAssign').addEventListener('click', () => assignDialog(lead));

  /* These three used to be `.catch(() => [])`, and that turned every failed read
     into a confident false statement. A dead `communication_logs` fetch rendered
     "Nothing has been logged against this email address yet" — indistinguishable
     from a 500, an RLS change, or a token edge — on the screen a rep reads
     immediately before phoning the customer. A dead `purchase_history` fetch was
     worse: the returning-customer box collapsed to an empty string, so a repeat
     buyer silently became a first-timer with no dash and no error to notice.

     allSettled keeps the drawer opening when one read dies, and `ok` carries
     whether we actually know. Nothing below may assert an absence unless its
     read succeeded. */
  const [purchR, commsR, auditR] = await Promise.allSettled([
    db(`purchase_history?select=*&email=eq.${encodeURIComponent(lead.email || '')}`),
    db(`communication_logs?select=*&lead_email=eq.${encodeURIComponent(lead.email || '')}&order=created_at.desc&limit=30`),
    db(`audit_log?select=*&lead_email=eq.${encodeURIComponent(lead.email || '')}&order=logged_at.desc&limit=30`),
  ]);
  const settle = r => r.status === 'fulfilled'
    ? { ok: true,  rows: r.value || [], err: null }
    : { ok: false, rows: [], err: String(r.reason?.message || r.reason).slice(0, 140) };
  const purchase = settle(purchR), comm = settle(commsR), aud = settle(auditR);
  const purch = purchase.rows, comms = comm.rows, audit = aud.rows;

  const vipBox = $('dVip');
  if (vipBox) {
    vipBox.innerHTML = purch.length
      ? `<div class="label-caps">Purchase history · returning customer</div>
         ${purch.map(p => `<div class="quote" style="margin-top:8px">
            <strong>${esc(p.vehicle)}</strong> · ${aed(p.amount_aed)}
            <div class="cell-sub">${esc(p.purchase_date || '')}</div></div>`).join('')}`
      : purchase.ok
        ? ''                       /* read succeeded and there are none — silence is honest */
        : `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">error</span>
           <div>Purchase history could not be read (${esc(purchase.err)}), so this customer is
           <strong>not</strong> being shown as a first-time buyer — we do not know either way.</div></div>`;
  }

  const events = [
    ...comms.map(c => ({ at: c.created_at, kind: c.channel, dir: c.direction, text: c.message })),
    ...audit.map(a => ({ at: a.logged_at, kind: a.workflow, dir: a.status, text: a.summary })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  $('dTimeline').innerHTML = events.length ? `<div class="timeline">${events.map(e => `
    <div class="tl-item">
      <span class="tl-dot" style="background:var(--${tone(e.dir) ? tone(e.dir).replace('ok','ok') : 'neutral'})"></span>
      <div class="tl-body">
        <div class="tl-meta"><span class="chip">${esc(e.kind)}</span> ${ago(e.at)}</div>
        <div style="margin-top:4px;white-space:pre-wrap">${esc(String(e.text || '').slice(0, 400))}</div>
      </div>
    </div>`).join('')}</div>`
    : (comm.ok && aud.ok)
      ? stateEmpty('No activity recorded', 'Nothing has been logged against this email address yet.', 'history')
      : `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">error</span>
         <div><strong>This timeline is incomplete — it is not empty.</strong>
         ${!comm.ok ? `Messages could not be read (${esc(comm.err)}). ` : ''}
         ${!aud.ok ? `Workflow activity could not be read (${esc(aud.err)}). ` : ''}
         Do not treat this as "we have never contacted them".</div></div>`;

  /* Even a populated timeline is a lie by omission if one of its two halves
     failed — the rep sees messages and concludes that is everything. */
  if (events.length && (!comm.ok || !aud.ok)) {
    $('dTimeline').insertAdjacentHTML('afterbegin',
      `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">warning</span>
       <div>Showing only part of the history —
       ${!comm.ok ? 'messages' : 'workflow activity'} could not be read
       (${esc((!comm.ok ? comm.err : aud.err))}).</div></div>`);
  }
}

async function assignDialog(lead) {
  /* An empty roster with a live Save button was a trap: `#assignSel.value` is ''
     and Save issued PATCH {assigned_to_id: '', assigned_to: null}, silently
     UNASSIGNING the lead the operator was trying to assign. */
  let users = [], rosterErr = null;
  try { users = await db('users?select=id,name,status&order=name') || []; }
  catch (e) { rosterErr = String(e.message || e).slice(0, 140); }
  const body = $('drawer').querySelector('.drawer-body');
  if (!body) return;
  body.scrollTop = 0;
  const box = el('div', 'card');
  box.style.marginBottom = '16px';
  const canAssign = users.length > 0;
  box.innerHTML = `<div class="label-caps" style="margin-bottom:10px">Assign this lead</div>
    ${rosterErr
      ? `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">error</span>
         <div>The staff list could not be read (${esc(rosterErr)}), so there is nobody to pick.
         This is not an empty team — reload and try again.</div></div>`
      : !canAssign
        ? `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">warning</span>
           <div>There are no staff accounts to assign to.</div></div>`
        : ''}
    <select id="assignSel" ${canAssign ? '' : 'disabled'}>${users.map(u => `<option value="${esc(u.id)}" ${u.id === lead.assigned_to_id ? 'selected' : ''}>${esc(u.name)}${u.status === 'pending_invite' ? ' (pending invite)' : ''}</option>`).join('')}</select>
    <div style="display:flex;gap:8px;margin-top:12px">
    <button class="btn primary" id="assignGo" ${canAssign ? '' : 'disabled title="No staff list was loaded, so saving could only clear the current owner."'}>Save</button>
    <button class="btn" id="assignCancel">Cancel</button></div>
    <div class="cell-sub" id="assignMsg" style="margin-top:8px"></div>`;
  body.prepend(box);
  box.querySelector('#assignCancel').addEventListener('click', () => box.remove());
  box.querySelector('#assignGo').addEventListener('click', async () => {
    const id = box.querySelector('#assignSel').value;
    if (!id) {                          /* belt and braces: never PATCH a blank owner */
      box.querySelector('#assignMsg').innerHTML =
        '<span class="t-hot">No rep selected — refusing to save, because that would clear the current owner.</span>';
      return;
    }
    const name = users.find(u => u.id === id)?.name || null;
    try {
      await dbWrite('PATCH', `leads?id=eq.${lead.id}`, { assigned_to_id: id, assigned_to: name });
      box.querySelector('#assignMsg').innerHTML = '<span class="t-ok">Saved. Reopen the screen to see it in the table.</span>';
    } catch (e) {
      box.querySelector('#assignMsg').innerHTML = `<span class="t-hot">${esc(e.message)}</span>`;
    }
  });
}

/* ==========================================================================
   S3 · Conversations
   ========================================================================== */

export { leadDrawer, assignDialog };
