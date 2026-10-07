/* NEXUS OS — screens/my-queue.js

   MY QUEUE — ◐ PARTIAL in the navigation. Design:
   design/stitch/my-queue-role-worklists-priority-triage--a1901e.html.

   Built 7 Oct 2026 from that export over objects the backend already holds and
   other screens already read. Nothing here is a new engine and nothing is
   scored by a model:

     Sales Manager tab   recovery actions still PROPOSED (lead_recovery_actions,
                         through screens/money-leaks.js's read), unit decisions
                         waiting on a person, deferrals come due and escalations
                         with no approver (v_inventory_action_queue), and HOT
                         leads with no owner (v_needs_attention lead_unassigned)
     BDC / Inbound tab   WhatsApp threads waiting on a reply and slow first
                         replies (v_needs_attention unanswered_chat /
                         sla_breach), and open enquiries that arrived in the
                         last 24 hours (leads)
     F&I                 COMING SOON — finance desk work has no queue in the
                         database, and a tab that listed nothing would read as
                         "nothing to do"
     Service             PLANNED — there is no service table at all

   FOCUS MODE ranks the active tab's real items by two stored facts and nothing
   else: severity as the source wrote it (HOT before WARM before the rest), then
   how long the item has been waiting, oldest first. It never invents an item to
   make five, and with fewer than five it shows fewer.

   WHAT THE EXPORT HAS AND THIS SCREEN DOES NOT: the showroom picker (there is
   one dealership per login and no branch table), the "Export desk CSV" button
   and the 60-second dispatch cadence (neither exists), and the export's own
   lead-dossier drawer — a row opens the app's existing lead drawer
   (lib/lead-drawer.js), which is where owner assignment, notes and booking
   already live, rather than a second dossier. */
import { ME, db, myStaffId } from '../lib/data.js';
import { leadDrawer } from '../lib/lead-drawer.js';
import { displayName, isHiddenLead, maskPhone } from '../lib/privacy.js';
import { ago, dubaiStamp, esc, num } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { comingSoonPanel, errorState, skeleton, trustFooter } from '../lib/stitch-ui.js';
import { readFlag, writeFlag } from '../lib/prefs.js';
import { readActions, readQueue, resetReads } from './money-leaks.js';

const str = v => String(v == null ? '' : v).trim();
const up = v => str(v).toUpperCase();
const plural = (n, one, many) => (Number(n) === 1 ? one : many);
const settle = p => p.then(v => ({ v, err: null }), e => ({ v: null, err: e }));
const DAY = 86400000;

/* Per-viewer conveniences. Focus mode is kept in the browser through
   lib/prefs.js (the one module allowed to touch browser storage, gate S2); the
   role tab and the owner filter live for this tab's session only. */
const SESSION_PREF = { tab: 'sm', owner: 'all' };

/* ── Categories, each a COMPLETE class string ────────────────────────────── */
const CAT = {
  RECOVERY:   { label: 'Recovery decision', cls: 'font-label-numeric-sm text-[10px] px-2 py-0.5 rounded bg-error-container text-error font-bold uppercase tracking-wider' },
  UNIT:       { label: 'Unit decision',     cls: 'font-label-numeric-sm text-[10px] px-2 py-0.5 rounded bg-[#FEF3E2] text-[#96570A] font-bold uppercase tracking-wider' },
  DEFERRAL:   { label: 'Deferral due',      cls: 'font-label-numeric-sm text-[10px] px-2 py-0.5 rounded bg-[#FEF3E2] text-[#96570A] font-bold uppercase tracking-wider' },
  NOAPPROVER: { label: 'No approver',       cls: 'font-label-numeric-sm text-[10px] px-2 py-0.5 rounded bg-error-container text-error font-bold uppercase tracking-wider' },
  UNOWNED:    { label: 'HOT lead, no owner', cls: 'font-label-numeric-sm text-[10px] px-2 py-0.5 rounded bg-error-container text-error font-bold uppercase tracking-wider' },
  CHAT:       { label: 'Waiting on a reply', cls: 'font-label-numeric-sm text-[10px] px-2 py-0.5 rounded bg-error-container text-error font-bold uppercase tracking-wider' },
  SLOW:       { label: 'Slow first reply',  cls: 'font-label-numeric-sm text-[10px] px-2 py-0.5 rounded bg-surface-container-highest text-on-surface-variant font-bold uppercase tracking-wider' },
  NEW:        { label: 'New enquiry, 24 h', cls: 'font-label-numeric-sm text-[10px] px-2 py-0.5 rounded bg-[#E8F1FB] text-[#2563A8] font-bold uppercase tracking-wider' },
};
const SEV_RANK = { HOT: 2, WARM: 1 };
const SEV_CLS = {
  HOT:  'font-label-numeric-sm text-[10px] px-1 rounded bg-error-container text-error font-semibold uppercase',
  WARM: 'font-label-numeric-sm text-[10px] px-1 rounded bg-[#FEF3E2] text-[#96570A] font-semibold uppercase',
  '':   'font-label-numeric-sm text-[10px] px-1 rounded bg-surface-container-highest text-on-surface-variant font-semibold uppercase',
};
const TAB = {
  on:  'flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container-lowest text-on-surface font-semibold text-body-sm shadow-sm transition-all',
  off: 'flex items-center gap-2 px-3 py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface font-medium text-body-sm transition-all',
  dim: 'flex items-center gap-2 px-3 py-1.5 rounded-lg text-outline hover:text-on-surface-variant font-medium text-body-sm transition-all',
};
const TABCOUNT = {
  on:  'font-label-numeric-sm text-[10px] px-1.5 rounded bg-primary-container text-on-primary font-bold',
  off: 'font-label-numeric-sm text-[10px] px-1.5 rounded bg-surface-container-highest text-on-surface-variant font-bold',
  dim: 'font-label-numeric-sm text-[10px] px-1.5 rounded bg-surface-container text-outline font-medium',
};
const FOCUS = {
  on:  'flex items-center gap-1.5 px-2 py-0.5 rounded text-label-numeric-sm font-semibold bg-primary-container text-on-primary transition-colors',
  off: 'flex items-center gap-1.5 px-2 py-0.5 rounded text-label-numeric-sm font-semibold bg-surface-container-high text-on-surface-variant transition-colors',
};

SCREENS.myqueue = async host => {
  resetReads();
  const readAt = new Date().toISOString();
  const root = document.createElement('div');
  root.className = 'nx-stitch flex flex-col gap-space-md';
  host.appendChild(root);
  const state = { tab: SESSION_PREF.tab, focus: readFlag('nx.myqueue.focus', true), owner: SESSION_PREF.owner, cat: '' };
  if (!['sm', 'bdc', 'fi', 'service'].includes(state.tab)) state.tab = 'sm';

  root.innerHTML = `<section class="bg-surface-container-lowest rounded-xl px-6 py-4 shadow-sm">
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="font-table-header text-table-header text-outline uppercase tracking-wider">Work</span>
            <span class="font-table-header text-table-header text-outline-variant">/</span>
            <span class="font-table-header text-table-header text-on-surface uppercase tracking-wider font-semibold">My queue</span>
            <span class="font-label-numeric-sm text-[10px] px-2 py-0.5 rounded bg-secondary-container text-on-secondary-fixed font-semibold uppercase tracking-wider ml-2">◐ Partial</span>
          </div>
          <div class="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-container-high text-primary font-label-numeric-sm text-label-numeric-sm font-semibold">
            <span class="w-2 h-2 rounded-full bg-primary"></span><span>Read ${esc(dubaiStamp(readAt))}</span>
          </div>
        </div>
        <div>
          <h1 class="font-headline-xl text-headline-xl text-on-surface tracking-tight">My Queue — role worklists &amp; priority triage</h1>
          <p class="font-body-md text-body-md text-on-surface-variant mt-0.5 max-w-3xl">What is waiting on a person, by role, most urgent first. Every item is a row the database already holds; a role with no queue in the database says so instead of showing an empty list.</p>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3 pt-2" data-slot="controls"></div>
      </div>
    </section>
    <div data-slot="body">${skeleton({ rows: 4 })}</div>
    <div data-slot="footer"></div>`;

  const [na, ac, iq, ld, us] = await Promise.all([
    settle(db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen&limit=200')),
    settle(readActions()), settle(readQueue()),
    settle(db('leads?select=id,name,phone,status,vehicle_interest,assigned_to_id,assigned_to,created_at&order=created_at.desc&limit=2000')),
    settle(db('users?select=id,name&limit=500')),
  ]);
  if (!root.isConnected) return;

  const leads = ld.err ? null : (ld.v || []);
  const leadById = new Map((leads || []).map(l => [str(l.id), l]));
  const staff = new Map((us.err ? [] : (us.v || [])).map(u => [str(u.id), str(u.name)]));
  const me = myStaffId();

  /* ── Items, one shape for every source ─────────────────────────────────── */
  const item = o => ({ sev: '', leadId: null, vehicle: '', screen: '', ...o });
  const leadItem = (o, id) => {
    const l = leadById.get(str(id)) || null;
    return item({ ...o, leadId: str(id), lead: l, vehicle: l ? str(l.vehicle_interest) : '',
      ownerId: l ? str(l.assigned_to_id) : '', ownerName: l ? (staff.get(str(l.assigned_to_id)) || str(l.assigned_to)) : '' });
  };
  const attn = na.err ? null : (na.v || []);
  const sm = [], bdc = [], unread = { sm: [], bdc: [] };

  if (ac.err) unread.sm.push('the recovery action queue');
  else (ac.v || []).filter(a => up(a.status) === 'PROPOSED' && !isHiddenLead(a.lead_id)).forEach(a => sm.push(leadItem({
    cat: 'RECOVERY', sev: up(a.engine_risk_level) === 'HIGH' ? 'HOT' : 'WARM', at: a.proposed_at,
    why: str(a.engine_reason) || 'The engine recorded no reason for this recommendation.', action: 'Open lead', ref: `#${str(a.lead_id)}`,
  }, a.lead_id)));
  if (iq.err) unread.sm.push('the unit decision queue');
  else (iq.v || []).forEach(u => {
    const base = { ref: `Unit ${str(u.unit_id)}`, title: str(u.unit_model) || `Unit ${str(u.unit_id)}`, vehicle: str(u.unit_model), screen: 'actions', action: 'Open Action Center' };
    if (u.awaiting_decision === true) sm.push(item({ ...base, cat: 'UNIT', sev: 'WARM', at: u.proposed_at, why: str(u.cost_of_doing_nothing) || str(u.engine_reason) || 'Raised by the Profit Sentinel and not yet answered.' }));
    else if (u.deferral_now_due === true) sm.push(item({ ...base, cat: 'DEFERRAL', sev: 'WARM', at: u.defer_until, why: 'The date somebody deferred this to has passed.' }));
    else if (str(u.escalated_at) && u.is_live === true) sm.push(item({ ...base, cat: 'NOAPPROVER', sev: 'HOT', at: u.escalated_at, why: str(u.escalation_reason) || 'Escalated with no reason recorded.' }));
  });
  if (attn == null) { unread.sm.push('the attention feed'); unread.bdc.push('the attention feed'); }
  else attn.forEach(i => {
    const k = str(i.kind);
    if (k === 'lead_unassigned' && !isHiddenLead(i.ref)) sm.push(leadItem({ cat: 'UNOWNED', sev: up(i.severity), at: i.at, why: str(i.detail), action: 'Assign owner', ref: `#${str(i.ref)}` }, i.ref));
    if (k === 'sla_breach' && !isHiddenLead(i.ref)) bdc.push(leadItem({ cat: 'SLOW', sev: up(i.severity), at: i.at, why: str(i.detail), action: 'Open lead', ref: `#${str(i.ref)}` }, i.ref));
    /* A chat title is a profile name or a raw handle, never a verified person:
       masked, and the row routes to Conversations, which owns the thread. */
    if (k === 'unanswered_chat') bdc.push(item({ cat: 'CHAT', sev: up(i.severity), at: i.at, why: str(i.detail), ref: 'Chat', title: displayName(str(i.title), str(i.ref)), screen: 'conversations', action: 'Open thread' }));
  });
  if (leads == null) unread.bdc.push('the leads table');
  else leads.filter(l => Date.now() - Date.parse(l.created_at) <= DAY && !['WON', 'LOST', 'DISQUALIFIED'].includes(up(l.status)) && !isHiddenLead(l.id))
    .forEach(l => bdc.push(leadItem({ cat: 'NEW', sev: up(l.status) === 'HOT' ? 'HOT' : up(l.status) === 'WARM' ? 'WARM' : '', at: l.created_at,
      why: 'Arrived in the last 24 hours and still open.', action: 'Open lead', ref: `#${str(l.id)}` }, l.id)));

  /* Severity first, then oldest first. Two stored facts, no model. */
  const rank = list => list.slice().sort((a, b) => ((SEV_RANK[b.sev] || 0) - (SEV_RANK[a.sev] || 0))
    || ((Date.parse(a.at) || Infinity) - (Date.parse(b.at) || Infinity)));
  const QUEUES = { sm: rank(sm), bdc: rank(bdc) };

  const who = x => {
    if (x.title) return esc(x.title);
    if (x.lead) return esc(str(x.lead.name) ? displayName(str(x.lead.name), x.lead.id) : 'Unnamed lead');
    return esc(x.leadId ? `Lead ${x.leadId}` : '—');
  };
  const phoneOf = x => (x.lead && str(x.lead.phone) ? esc(maskPhone(str(x.lead.phone))) : '');
  const ownerOf = x => {
    if (!x.leadId) return '<span class="text-outline">Not a lead — no owner applies</span>';
    if (!x.lead) return '<span class="text-outline">Lead not read</span>';
    return x.ownerId || x.ownerName
      ? `<span class="font-medium text-on-surface-variant">${esc(x.ownerName || `Staff #${x.ownerId}`)}</span>`
      : '<span class="font-label-numeric-sm text-[10px] px-2 py-0.5 rounded bg-error-container text-error font-bold">Unassigned</span>';
  };
  const ownerPass = x => (state.owner === 'all' ? true
    : !x.leadId ? false
      : state.owner === 'mine' ? (me != null && x.ownerId === me)
        : !x.ownerId && !x.ownerName);

  const put = (id, html) => { const n = root.querySelector(`[data-slot="${id}"]`); if (n) n.innerHTML = html; return n; };

  const renderControls = () => {
    const tab = (key, label, count, dim) => {
      const on = state.tab === key;
      const k = on ? 'on' : dim ? 'dim' : 'off';
      return `<button type="button" data-tab="${key}" class="${TAB[k]}"><span>${esc(label)}</span><span class="${TABCOUNT[k]}">${esc(count)}</span></button>`;
    };
    const live = state.tab === 'sm' || state.tab === 'bdc';
    put('controls', `<div class="flex items-center gap-1.5 p-1 rounded-lg bg-surface-container-low flex-wrap">
        ${tab('sm', 'Sales Manager', num(QUEUES.sm.length), false)}
        ${tab('bdc', 'BDC / Inbound', num(QUEUES.bdc.length), false)}
        ${tab('fi', 'F&I (○ COMING SOON)', '—', true)}
        ${tab('service', 'Service (◇ PLANNED)', '—', true)}
      </div>
      ${live ? `<div class="flex items-center gap-2 flex-wrap">
        <div class="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-surface-container-low">
          <span class="font-body-sm text-body-sm text-on-surface-variant">Focus mode:</span>
          <button type="button" data-focus class="${state.focus ? FOCUS.on : FOCUS.off}"><span class="w-1.5 h-1.5 rounded-full bg-surface-container-lowest"></span><span>${state.focus ? `On (${esc(num(Math.min(5, QUEUES[state.tab].length)))} priorities)` : 'Off'}</span></button>
        </div>
        <div class="relative">
          <select data-owner class="appearance-none bg-surface-container-lowest text-on-surface text-body-sm pl-2.5 pr-7 py-1.5 rounded-lg border border-outline-variant/40 focus:outline-none focus:ring-1 focus:ring-primary">
            <option value="all"${state.owner === 'all' ? ' selected' : ''}>Assigned to: anyone</option>
            <option value="mine"${state.owner === 'mine' ? ' selected' : ''}${me == null ? ' disabled' : ''}>Assigned to: me${me == null ? ' (your staff record is not linked)' : ''}</option>
            <option value="none"${state.owner === 'none' ? ' selected' : ''}>Unassigned leads</option>
          </select>
          <span class="material-symbols-outlined pointer-events-none absolute right-2 top-2 text-outline text-[16px]">expand_more</span>
        </div>
      </div>` : ''}`);
    root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; state.cat = ''; SESSION_PREF.tab = state.tab; renderAll(); }));
    root.querySelector('[data-focus]')?.addEventListener('click', () => { state.focus = !state.focus; writeFlag('nx.myqueue.focus', state.focus); renderAll(); });
    root.querySelector('[data-owner]')?.addEventListener('change', ev => { state.owner = ev.target.value; SESSION_PREF.owner = state.owner; renderAll(); });
  };

  const renderBody = () => {
    if (state.tab === 'fi') {
      return put('body', comingSoonPanel({ kind: 'coming-soon', icon: 'account_balance', title: 'F&I worklist',
        body: 'The finance desk keeps its quotes in Finance Desk, but nothing in the database marks a quote as waiting on a person, so there is no queue to list. No item is shown rather than an empty list that would read as nothing to do.',
        prerequisite: 'A finance-desk work state on each quote (requested, awaiting documents, awaiting lender) recorded in NEXUS.',
        actionsHtml: SCREENS.finance ? '<button type="button" data-go="finance" class="px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant font-body-sm text-body-sm font-semibold">Open Finance Desk</button>' : '' }));
    }
    if (state.tab === 'service') {
      return put('body', comingSoonPanel({ kind: 'planned', icon: 'build', title: 'Service worklist',
        body: 'There is no service table, no repair order and no workshop record in this database, so there is nothing a service advisor could be asked to do here.',
        prerequisite: 'A connection to the dealership’s DMS service module.' }));
    }
    const full = QUEUES[state.tab];
    const missing = unread[state.tab];
    const owned = full.filter(ownerPass);
    const list = state.cat ? owned.filter(x => x.cat === state.cat) : owned;
    const focus = state.focus ? owned.slice(0, 5) : [];

    const focusHtml = state.focus ? `<div class="bg-surface-container-lowest rounded-xl p-5 shadow-sm space-y-3.5">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2.5">
          <div class="w-6 h-6 rounded bg-primary-container flex items-center justify-center text-on-primary"><span class="material-symbols-outlined text-[16px]">bolt</span></div>
          <span class="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">Today's ${esc(num(focus.length))} ${plural(focus.length, 'priority', 'priorities')}</span>
        </div>
        <span class="font-label-numeric-sm text-label-numeric-sm text-outline">RANKED BY SEVERITY, THEN LONGEST WAITING — NO MODEL</span>
      </div>
      ${focus.length ? `<div class="grid grid-cols-1 md:grid-cols-5 gap-3">${focus.map((x, i) => `<div class="flex flex-col justify-between p-3.5 rounded-lg bg-surface-container-low hover:bg-surface-container transition-colors">
          <div class="space-y-1.5">
            <div class="flex items-center justify-between gap-1"><span class="font-label-numeric-sm text-label-numeric-sm font-bold ${i === 0 ? 'text-primary' : 'text-secondary'}">${esc(String(i + 1).padStart(2, '0'))} / ${esc(CAT[x.cat].label.toUpperCase())}</span>${x.sev ? `<span class="${SEV_CLS[x.sev] || SEV_CLS['']}">${esc(x.sev)}</span>` : ''}</div>
            <p class="font-body-sm text-body-sm text-on-surface font-semibold leading-snug">${who(x)}</p>
            ${x.vehicle ? `<p class="font-label-numeric-sm text-[11px] text-on-surface-variant font-medium">${esc(x.vehicle)}</p>` : ''}
            <p class="font-body-sm text-[11px] text-on-surface-variant font-medium leading-tight">${esc(x.why)}</p>
            <p class="font-label-numeric-sm text-[10px] text-outline">Waiting · ${esc(ago(x.at))}</p>
          </div>
          <button type="button" data-open="${esc(String(QUEUES[state.tab].indexOf(x)))}" class="mt-3 w-full py-1.5 px-2 ${i === 0 ? 'bg-primary text-on-primary hover:bg-primary-container' : 'bg-surface-container-highest text-on-surface hover:bg-primary hover:text-on-primary'} text-body-sm font-semibold rounded-lg transition-colors text-center truncate">${esc(x.action || 'Open')}</button>
        </div>`).join('')}</div>`
        : '<p class="font-body-sm text-body-sm text-on-surface-variant">Nothing in this queue matches the filter above. That is a measured empty queue for the sources that were read — see the list below for any that were not.</p>'}
    </div>` : '';

    const cats = [...new Set(full.map(x => x.cat))];
    const cards = cats.map(c => {
      const n = owned.filter(x => x.cat === c).length;
      return `<div class="bg-surface-container-lowest rounded-xl p-4 shadow-sm flex flex-col justify-between space-y-3">
        <div class="flex items-center justify-between gap-2"><span class="font-table-header text-table-header uppercase text-outline">${esc(CAT[c].label)}</span></div>
        <div class="font-label-numeric-lg text-headline-xl font-bold text-on-surface">${esc(num(n))} <span class="text-body-md font-normal text-on-surface-variant">${plural(n, 'item', 'items')}</span></div>
        <button type="button" data-cat="${esc(c)}" class="w-full py-1 px-3 rounded-lg ${state.cat === c ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-primary hover:bg-primary hover:text-on-primary'} text-body-sm font-semibold transition-colors flex items-center justify-between"><span>${state.cat === c ? 'Showing only these' : 'Filter to these'}</span><span class="material-symbols-outlined text-[16px]">tune</span></button>
      </div>`;
    }).join('');

    const missingHtml = missing.length
      ? `<div class="p-space-md rounded-lg bg-[#FEF3E2]/60 border border-[#F3DFBD] font-body-sm text-body-sm text-[#96570A]">Could not be read: ${esc(missing.join(', '))}. Anything those sources would have added is missing from this queue — not cleared.</div>` : '';

    const rows = list.map(x => {
      const idx = QUEUES[state.tab].indexOf(x);
      return `<tr class="h-11 hover:bg-surface-container-low/70 cursor-pointer transition-colors group" data-open="${esc(String(idx))}">
        <td class="px-5 whitespace-nowrap"><div class="flex items-center gap-2"><span class="font-label-numeric-sm text-label-numeric-sm font-bold text-primary">${esc(x.ref || '')}</span><span class="font-label-numeric-sm text-[11px] text-outline">${esc(ago(x.at))}</span></div></td>
        <td class="px-4"><div class="flex flex-col"><span class="font-semibold text-on-surface group-hover:text-primary transition-colors">${who(x)}</span>${phoneOf(x) ? `<span class="font-label-numeric-sm text-[11px] text-outline">${phoneOf(x)}</span>` : ''}</div></td>
        <td class="px-4">${x.vehicle ? `<span class="font-medium">${esc(x.vehicle)}</span>` : '<span class="text-outline">Not recorded</span>'}</td>
        <td class="px-4 whitespace-nowrap"><span class="${CAT[x.cat].cls}">${esc(CAT[x.cat].label)}</span></td>
        <td class="px-4"><span class="font-body-sm text-[12px] text-on-surface-variant">${esc(x.why)}</span></td>
        <td class="px-4 whitespace-nowrap">${ownerOf(x)}</td>
        <td class="px-5 whitespace-nowrap text-right"><button type="button" data-open="${esc(String(idx))}" class="px-3 py-1 rounded bg-primary-container text-on-primary hover:bg-primary font-semibold text-body-sm transition-colors">${esc(x.action || 'Open')}</button></td>
      </tr>`;
    }).join('');
    const table = `<div class="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden flex flex-col">
      <div class="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3 flex-wrap"><span class="font-headline-md text-body-lg font-bold text-on-surface">Worklist</span>
          ${state.cat || state.owner !== 'all' ? '<span class="font-label-numeric-sm text-[10px] px-2 py-0.5 rounded bg-primary-container text-on-primary font-semibold">FILTER APPLIED</span>' : ''}
          <span class="font-label-numeric-sm text-label-numeric-sm text-outline">Showing <span class="text-on-surface font-semibold">${esc(num(list.length))}</span> of ${esc(num(full.length))} items</span></div>
        ${state.cat || state.owner !== 'all' ? '<button type="button" data-clear class="text-body-sm font-medium text-primary hover:underline px-2 py-1">Clear filter</button>' : ''}
      </div>
      ${list.length ? `<div class="w-full overflow-x-auto"><table class="w-full border-collapse text-left">
        <thead><tr class="h-10 bg-surface-container-low text-outline font-table-header text-table-header uppercase tracking-wider">
          <th class="px-5 font-semibold">Ref / waiting</th><th class="px-4 font-semibold">Lead / buyer</th><th class="px-4 font-semibold">Vehicle of interest</th>
          <th class="px-4 font-semibold">Queue category</th><th class="px-4 font-semibold">Why it is here</th><th class="px-4 font-semibold">Assigned consultant</th><th class="px-5 font-semibold text-right">Primary action</th></tr></thead>
        <tbody class="font-body-md text-body-sm text-on-surface divide-y divide-surface-container-low">${rows}</tbody></table></div>`
        : `<div class="px-5 pb-5 font-body-sm text-body-sm text-on-surface-variant">${full.length
          ? 'Nothing matches the filter. Clear it to see the whole queue.'
          : missing.length ? 'Nothing was listed from the sources that answered, and some sources did not answer — so this is not a confirmed empty queue.'
            : 'Every source this queue is built from answered and none holds an item waiting on this role. That is a measured empty queue, not an unread one.'}</div>`}
      ${state.owner !== 'all' ? '<div class="px-5 pb-3 font-body-sm text-[11px] text-outline">The owner filter applies to leads only; unit decisions and chat threads have no consultant on the row, so they are shown only under "anyone".</div>' : ''}
    </div>`;

    put('body', `<div class="flex flex-col gap-space-md">${missingHtml}${focusHtml}
      ${cards ? `<div class="grid grid-cols-1 md:grid-cols-4 gap-4">${cards}</div>` : ''}${table}</div>`);
  };

  const wire = () => {
    root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
    root.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); state.cat = state.cat === b.dataset.cat ? '' : b.dataset.cat; renderAll(); }));
    root.querySelector('[data-clear]')?.addEventListener('click', () => { state.cat = ''; state.owner = 'all'; SESSION_PREF.owner = 'all'; renderAll(); });
    root.querySelectorAll('[data-open]').forEach(n => n.addEventListener('click', async e => {
      e.stopPropagation();
      const x = QUEUES[state.tab] && QUEUES[state.tab][Number(n.dataset.open)];
      if (!x) return;
      if (!x.leadId) { if (x.screen && SCREENS[x.screen]) go(x.screen); return; }
      if (n.dataset.busy) return;
      n.dataset.busy = '1';
      try {
        const rows = await db(`leads?select=*,users(id,name)&id=eq.${encodeURIComponent(x.leadId)}&limit=1`);
        if (rows.length) await leadDrawer(rows[0]);
        else if (SCREENS.leads) go('leads');
      } catch (err) {
        n.setAttribute('aria-label', `Could not open this lead — ${err.message}`);
      } finally { delete n.dataset.busy; }
    }));
  };

  const renderAll = () => { renderControls(); renderBody(); wire(); };
  if (ac.err && iq.err && na.err && ld.err) {
    put('body', errorState({ what: 'your queue', err: na.err, retry: 'myqueue' }));
    root.querySelector('[data-retry]')?.addEventListener('click', () => go('myqueue'));
  } else renderAll();

  put('footer', trustFooter({
    source: 'lead_recovery_actions · v_inventory_action_queue · v_needs_attention · leads',
    asOf: dubaiStamp(readAt),
    evidence: `${num(QUEUES.sm.length)} Sales Manager and ${num(QUEUES.bdc.length)} BDC items`,
    actor: ME && ME.name ? ME.name : '',
  }));
};
