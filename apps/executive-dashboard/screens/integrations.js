/* NEXUS OS — screens/integrations.js
   INTEGRATIONS. The dealer keeps the DMS / CRM / call system they already run;
   NEXUS connects to it through two wires the dealer owns:
     · REST API keys  — their software calls NEXUS (POST leads, call logs, …)
     · Outgoing webhooks — NEXUS calls their software when something happens.
   Keys and signing secrets are shown ONCE, in the modal that created them, and
   are never written into the page after it closes. Writes are owner/admin
   (canManageAccess); everyone else sees the lists read-only. Every value from
   the database is passed through esc(). */
import { db, dbWrite, canManageAccess } from '../lib/data.js';
import { ago, dubaiStamp, esc } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { el } from '../lib/dom.js';
import { SUPABASE_URL } from '../lib/env.js';
import { HEALTH_WORDS } from '../lib/health.js';
/* The Stitch migration (7 Oct 2026, design/stitch/MAP.md: primary
   integrations-connected-ecosystem-api-keys--b610ac). table, pill, the state
   panels and openModal keep their signatures and answer in the Stitch anatomy
   (lib/ops-kit.js). */
import { actor, B, C, banner, cardHead, modalError, openModal, pill, stateEmpty, stateError, stateLoading, table } from '../lib/ops-kit.js';
import { sectionHeader, statusChip, trustFooter } from '../lib/stitch-ui.js';

/* This was the literal `https://dsvuoovivysszdoiorch.supabase.co/...` until
   27 Sep 2026 — the VENDOR's own production project ref, printed on this screen
   as the reader's API base and pasted into every curl example, every Zapier /
   Make instruction and the PBX webhook line below. CLAUDE.md: "A fact that is
   really one dealership's configuration belongs in per-tenant data, never in a
   constant and never in code." This was a step worse than that: it was not even
   the reader's own configuration, so a second dealership on its own deployment
   would have been handed Tenant A's endpoint and told it was theirs.

   Derived from SUPABASE_URL instead, which lib/env.js has already trimmed of
   trailing slashes — the exact defect that turned every path into `//functions`
   and answered 404. On Tenant A's deployment the derived string is byte-identical
   to the literal it replaces, so nothing a reader sees changes today; on any
   other deployment it now follows that deployment.

   It cannot render empty: app.js boot() stops at the configuration card before
   any screen is reached when VITE_SUPABASE_URL is missing, so there is no path
   on which this screen paints with SUPABASE_URL unset. */
const API_BASE = `${SUPABASE_URL}/functions/v1/api-v1/v1`;
/* Checked 27 Sep 2026 rather than assumed: `public/developers/index.html` is on
   disk (31,564 bytes), Vite copies public/ verbatim so it lands at
   `dist/developers/index.html`, and the repository-root vercel.json rewrites
   `/developers`, `/developers/` AND `/developers/index.html` to that file —
   ahead of the `/(.*)` catch-all, so the link does not fall through to the SPA.
   The link resolves. What it resolves TO still carries the hardcoded vendor
   project ref in its own curl blocks; that file is not this screen's and is
   reported rather than edited here. */
const DOCS = '/developers/';
const EVENTS = ['lead.created', 'lead.updated', 'lead.scored', 'appointment.created', 'appointment.updated', 'message.received'];
const SCOPES = ['leads:read', 'leads:write', 'inventory:read', 'inventory:write', 'calls:write', 'appointments:read'];
const KEY_PH = 'YOUR_API_KEY';

const str = v => (v == null ? '' : String(v));
const arr = v => (Array.isArray(v) ? v : (v == null || v === '' ? [] : String(v).replace(/[{}"]/g, '').split(',').filter(Boolean)));
const muted = t => `<span class="${C.faint}">${t}</span>`;
const code = t => `<div class="${C.code}">${esc(t)}</div>`;
const mono = t => `<span class="font-label-numeric-sm">${t}</span>`;
const when = v => (v ? esc(ago(v)) : muted('Never'));
const cnt = v => esc(String(Number(v) || 0));
const one = r => (Array.isArray(r) ? r[0] : r) || {};


const copyBtn = (id, label = 'Copy') => `<button class="${B.secondary}" data-copy="${esc(id)}">${esc(label)}</button>`;
const wireCopy = (root, get) => root.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
  const clip = navigator.clipboard;
  const text = get(b.dataset.copy);
  if (!clip || !clip.writeText) { b.textContent = 'Select and copy manually'; return; }
  clip.writeText(text).then(() => { b.textContent = 'Copied'; }, () => { b.textContent = 'Copy blocked'; });
}));
const goBtn = (id, label) => (SCREENS[id]
  ? `<button class="${B.secondary}" data-go="${esc(id)}">${esc(label)}</button>`
  : `<button class="${B.ghost}" disabled>${esc(label)} — not in this build</button>`);
const wireGo = (root, after) => root.querySelectorAll('[data-go]').forEach(b => {
  if (!b.disabled) b.addEventListener('click', () => { after && after(); go(b.dataset.go); });
});
const checks = (name, list, checked = true) => `<div class="flex flex-wrap gap-x-4 gap-y-2">${list.map(v =>
  `<label class="inline-flex items-center gap-1.5 font-body-sm text-body-sm"><input type="checkbox" class="w-4 h-4 rounded border border-outline-variant accent-primary" name="${esc(name)}" value="${esc(v)}"${checked ? ' checked' : ''}/> ${mono(esc(v))}</label>`).join('')}</div>`;
const picked = (root, name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);
const ol = items => `<ol class="list-decimal ml-5 mt-2 space-y-1 font-body-sm text-body-sm text-on-surface">${items.map(i => `<li>${i}</li>`).join('')}</ol>`;

/* ── Guides ─────────────────────────────────────────────────────────────── */
const CURL_LEAD = `curl -X POST "${API_BASE}/leads" \\
  -H "Authorization: Bearer ${KEY_PH}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: crm-lead-10045" \\
  -d '{"name":"Ahmed Ali","phone":"+971501234567","email":"ahmed@example.com","vehicle_interest":"Toyota Land Cruiser 2025","budget_aed":250000,"source_detail":"Your CRM web form","notes":"Wants a test drive on Saturday"}'`;
const CURL_CALL = `curl -X POST "${API_BASE}/calls" \\
  -H "Authorization: Bearer ${KEY_PH}" \\
  -H "Content-Type: application/json" \\
  -d '{"external_call_id":"pbx-20260921-000123","direction":"inbound","from_number":"+971501234567","to_number":"+97143334444","duration_sec":184,"started_at":"2026-09-21T10:15:00+04:00","caller_name":"Ahmed Ali","recording_url":"https://pbx.example.com/rec/123.mp3"}'`;
const CURL_LIST = `curl "${API_BASE}/leads?limit=5" \\
  -H "Authorization: Bearer ${KEY_PH}"`;

const webhookSteps = [
  'Create an <b>API key</b> below (scope <span class="font-label-numeric-sm">leads:write</span>) so your system can send leads to NEXUS.',
  'Add a <b>webhook</b> below pointing at your system (or a Zapier / Make “Catch Hook” / “Custom webhook” URL) so NEXUS can send lead and appointment events back.',
  'In Zapier or Make: trigger = “Webhooks — Catch Hook”, action = your CRM’s “Create / Update Lead”. For the other direction: trigger = your CRM’s “New Lead”, action = “Webhooks — POST” to <span class="font-label-numeric-sm">' + esc(API_BASE) + '/leads</span> with header <span class="font-label-numeric-sm">Authorization: Bearer YOUR_API_KEY</span>.',
  'Use “Send test” on the webhook to confirm delivery, then check the deliveries log.',
];
const TILES = [
  { id: 'dms', icon: 'dns', title: 'Your DMS / CRM', sub: 'Any system that can call a REST API or receive a webhook.',
    body: () => `<div class="${C.hint}">NEXUS does not replace your DMS or CRM. Your system pushes leads in through the REST API, and NEXUS pushes events (new lead, score, appointment, inbound message) back out through signed webhooks.</div>
      ${ol(webhookSteps)}
      <div class="${C.caps} mt-space-md mb-1">Send a lead</div>${code(CURL_LEAD)}
      <div class="${C.caps} mt-3 mb-1">Read leads</div>${code(CURL_LIST)}` },
  { id: 'bitrix', icon: 'hub', title: 'Bitrix24', sub: 'Outbound webhooks from Bitrix24, NEXUS webhooks back.',
    body: () => `<div class="${C.hint}">There is no one-click Bitrix24 connection for your own portal on this screen — connect it with the API and webhooks:</div>
      ${ol([
        'In Bitrix24: <b>Developer resources → Other → Outbound webhook</b>, event <span class="font-label-numeric-sm">ONCRMLEADADD</span>. Point it at a small relay (or a Zapier/Make scenario) that calls <span class="font-label-numeric-sm">POST /v1/leads</span> with your NEXUS API key.',
        'In Bitrix24: <b>Developer resources → Other → Inbound webhook</b> with CRM permission. Copy the URL.',
        'Here: add a NEXUS webhook (events <span class="font-label-numeric-sm">lead.scored</span>, <span class="font-label-numeric-sm">appointment.created</span>) pointing at a Zapier/Make hook that calls Bitrix24 <span class="font-label-numeric-sm">crm.lead.update</span> via that inbound URL.',
        'Use “Send test” and check the deliveries log.'])}` },
  { id: 'crms', icon: 'contacts', title: 'Zoho CRM · HubSpot · Salesforce · Odoo', sub: 'Via webhooks + API, or Zapier / Make “Webhooks” apps.',
    body: () => `<div class="${C.hint}">All four can send and receive HTTP webhooks natively (Zoho Workflow Rules → Webhook, HubSpot Workflows → Send webhook, Salesforce Flow → HTTP Callout, Odoo Automated Actions → Send Webhook), or through Zapier / Make.</div>
      ${ol(webhookSteps)}
      <div class="${C.caps} mt-space-md mb-1">Body your CRM should POST</div>${code(CURL_LEAD)}` },
  { id: 'calls', icon: 'call', title: 'Call system / telephony', sub: '3CX, Aircall, Twilio, or any PBX that can POST call logs.',
    body: () => `<div class="${C.hint}">Every answered or missed call becomes activity on the matching lead (matched by phone number). Configure your PBX’s “call ended” / CDR webhook to POST to <span class="font-label-numeric-sm">${esc(API_BASE)}/calls</span> with an API key that has the <span class="font-label-numeric-sm">calls:write</span> scope.</div>
      ${ol([
        '<b>3CX</b>: Settings → CRM Integration → custom template / call journaling URL.',
        '<b>Aircall</b>: Integrations → Webhooks, event <span class="font-label-numeric-sm">call.ended</span> (via Zapier/Make to reshape the body).',
        '<b>Twilio</b>: Voice status callback URL → a Twilio Function / relay that adds the Authorization header.',
        'Any other PBX: POST one JSON object per call, as below.'])}
      <div class="${C.caps} mt-space-md mb-1">Example</div>${code(CURL_CALL)}` },
  { id: 'web', icon: 'language', title: 'Website · Facebook · Google', sub: 'Lead forms and ads.', link: ['leadsources', 'Open Lead Sources'],
    body: () => `<div class="${C.hint}">Website forms, Facebook / Instagram Lead Ads and Google lead forms are set up on the Lead Sources screen. A custom website form can also POST straight to <span class="font-label-numeric-sm">/v1/leads</span> from your server (never put an API key in browser JavaScript).</div>` },
  { id: 'wa', icon: 'chat', title: 'WhatsApp', sub: 'Your own WhatsApp Business number.', link: ['channels', 'Open Channels'],
    body: () => `<div class="${C.hint}">Connect your WhatsApp Business Cloud number on the Channels screen. Inbound messages then fire the <span class="font-label-numeric-sm">message.received</span> webhook to your systems.</div>` },
];
const openGuide = t => {
  const m = openModal(t.title, `<div class="font-body-sm text-body-sm">${t.body()}</div>`,
    (t.link ? goBtn(t.link[0], t.link[1]) : '')
    + `<a class="${B.secondary}" href="${esc(DOCS)}" target="_blank" rel="noopener">Full API docs →</a><button class="${B.primary}" id="igClose">Close</button>`);
  m.wrap.querySelector('#igClose').addEventListener('click', m.close);
  wireGo(m.wrap, m.close);
};

/* ── Connector tiles — integrations-connected-ecosystem-api-keys--b610ac ────
   The export shows a status on every connector. Each status here is read from
   something this dealership's records hold, and nothing else:
     · DMS / CRM / telephony — through the API keys this dealership issued
       (whether one exists, its scopes, and when it was last used). NEXUS has no
       native DMS connector; the tile says so rather than showing "Disconnected"
       from a product that does not exist.
     · CRM sync and the team-chat command center — the health word
       v_workflow_health computes for those automations from this dealership's
       own run record. The export's "Blocked by Plan" is NOT copied: the record
       can say a run ended needing setup outside NEXUS (NEEDS_SETUP); it cannot
       say why — a plan, a permission or a configuration all look the same from
       here — so the tile says "blocked — needs setup" and stops there.
     · Lead forms and WhatsApp — owned by Lead Sources and Channels, so the tile
       links there instead of restating a status those screens measure. */
/* The words are lib/health.js's (HEALTH_WORDS), so a connector and the
   Automation screen can never name one health state two ways. NEEDS_SETUP is a
   state v_workflow_health emits that health.js has no entry for yet; it is
   worded here, once, and never painted green. */
const HEALTH_KIND = { ok: 'live', hot: 'failed', unknown: 'not-tested' };
const healthChip = w => {
  if (!w) return statusChip('not-tested', 'Not set up for you');
  const key = String(w.health || '').toUpperCase();
  if (key === 'NEEDS_SETUP') return statusChip('blocked', 'Blocked — needs setup');
  const hw = HEALTH_WORDS[key];
  if (!hw) return statusChip('degraded', `Unrecognised: ${String(w.health || 'no health word')}`);
  return statusChip(key === 'DEGRADED' ? 'degraded' : (HEALTH_KIND[hw.tone] || 'not-tested'), hw.label);
};
const n = v => (v == null ? null : Number(v));
const healthLine = (w, what) => {
  if (!w) return `No ${what} automation is registered that this dealership can see, so nothing here is connected and nothing is broken.`;
  const runs = n(w.runs_30d);
  const parts = [];
  parts.push(runs == null ? 'Runs in the last 30 days: not stated.' : `${runs} ${runs === 1 ? 'run' : 'runs'} in the last 30 days.`);
  if (w.last_success) parts.push(`Last success ${ago(w.last_success)}.`); else parts.push('No success on record.');
  if (n(w.config_required_30d)) parts.push(`${n(w.config_required_30d)} ended needing a change outside NEXUS — the other system refused the call (a plan, permission or configuration on its side; the record does not say which).`);
  return parts.join(' ');
};
const CONNECTORS = [
  { id: 'dms', icon: 'garage_home', title: 'Your DMS / CRM', sub: 'Through the REST API and webhooks', kind: 'api' },
  { id: 'bitrix', icon: 'corporate_fare', title: 'Bitrix24 CRM sync', sub: 'NEXUS pushes leads into a Bitrix24 portal', kind: 'workflow', match: /bitrix/i, what: 'CRM sync' },
  { id: 'crms', icon: 'cloud_sync', title: 'Zoho · HubSpot · Salesforce · Odoo', sub: 'No native connector — API and webhooks', kind: 'api' },
  { id: 'calls', icon: 'ring_volume', title: 'Call system / telephony', sub: 'Your PBX posts call logs', kind: 'calls' },
  { id: 'web', icon: 'ads_click', title: 'Web, Meta & Google lead forms', sub: 'Set up on Lead Sources', kind: 'link', link: ['leadsources', 'Go to Lead Sources'] },
  { id: 'wa', icon: 'chat', title: 'WhatsApp Cloud API', sub: 'Set up on Channels', kind: 'link', link: ['channels', 'Go to Channels'] },
  { id: 'slack', icon: 'tag', title: 'Slack Command Center', sub: 'Ask NEXUS from a team chat channel', kind: 'workflow', match: /slack command center/i, what: 'team-chat' },
];

/* ── Screen ─────────────────────────────────────────────────────────────── */
SCREENS.integrations = async host => {
  /* Since 7 Oct 2026 the wrapper is the Stitch root (`nx-stitch`). It is still a
     wrapper this screen appends, NOT `#screen`, because lib/nav.js empties
     `#screen` between renders without touching its classes. */
  const root = el('div', 'nx-stitch flex flex-col gap-space-md');
  host.appendChild(root);

  const canWrite = canManageAccess();
  const roNote = canWrite ? '' : ' title="Only an owner or admin at this dealership can change integrations."';

  const head = el('div');
  head.innerHTML = sectionHeader({
    eyebrow: 'Operations / Integrations',
    title: 'Keep your existing software. NEXUS connects to it.',
    sub: 'Your DMS, CRM and phone system stay exactly where they are. They send leads and calls to NEXUS through the '
       + 'REST API, and NEXUS sends events back to them through signed webhooks.',
    actionsHtml: `<a class="${B.secondary}" href="${esc(DOCS)}" target="_blank" rel="noopener"><span class="material-symbols-outlined text-[18px]">menu_book</span>Full API docs</a>`,
  });
  root.appendChild(head);

  /* 1 · Connectors — status from real reads, setup steps one click away. */
  const tiles = el('section', C.card);
  root.appendChild(tiles);
  const connectorState = { keys: null, keysErr: null, wf: null, wfErr: null };
  const tileStatus = t => {
    const S = connectorState;
    if (t.kind === 'link') return statusChip('pending', 'Status on that screen');
    if (t.kind === 'workflow') {
      if (S.wfErr) return statusChip('not-tested', 'Status unread');
      if (!S.wf) return statusChip('pending', 'Checking…');
      return healthChip(S.wf.find(w => t.match.test(String(w.name || ''))));
    }
    if (S.keysErr) return statusChip('not-tested', 'Status unread');
    if (!S.keys) return statusChip('pending', 'Checking…');
    const live = S.keys.filter(k => !k.revoked_at && (t.kind !== 'calls' || arr(k.scopes).includes('calls:write')));
    const used = live.filter(k => k.last_used_at).sort((a, b) => Date.parse(b.last_used_at) - Date.parse(a.last_used_at));
    if (used.length) return statusChip('connected', `Key used ${ago(used[0].last_used_at)}`);
    if (live.length) return statusChip('partial', 'Key issued, never used');
    return statusChip('not-tested', 'Not connected');
  };
  const tileLine = t => {
    const S = connectorState;
    if (t.kind === 'link') return t.id === 'web'
      ? 'Website forms, Facebook / Instagram Lead Ads and Google lead forms are connected and checked on Lead Sources.'
      : 'Your WhatsApp Business number, templates and messaging usage are on Channels.';
    if (t.kind === 'workflow') {
      if (S.wfErr) return 'The automation health record could not be read, so nothing is claimed about this connector.';
      if (!S.wf) return 'Reading the automation health record…';
      const w = S.wf.find(x => t.match.test(String(x.name || '')));
      const base = healthLine(w, t.what);
      return t.id === 'slack' && w ? `${base} A run finishing is not proof that a message reached a channel; NEXUS keeps no delivery receipt from Slack.` : base;
    }
    if (S.keysErr) return 'The API key list could not be read, so whether this is connected is unknown.';
    if (!S.keys) return 'Reading this dealership’s API keys…';
    const live = S.keys.filter(k => !k.revoked_at && (t.kind !== 'calls' || arr(k.scopes).includes('calls:write')));
    if (!live.length) return t.kind === 'calls'
      ? 'No active API key carries the calls:write scope, so no call system can post call logs yet.'
      : 'No active API key exists, so no system of yours can send data to NEXUS yet.';
    return `${live.length} active ${live.length === 1 ? 'key' : 'keys'}${t.kind === 'calls' ? ' with calls:write' : ''}. A key used recently is evidence a system is calling; it says nothing about how complete that system’s data is.`;
  };
  const paintTiles = () => {
    tiles.innerHTML = cardHead('Connectors', `${CONNECTORS.length} ways your software meets NEXUS. Each status is read from this dealership’s own records.`, '', 'hub')
      + `<div class="${C.body}"><div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-space-md">${CONNECTORS.map(t => {
        const guide = TILES.find(g => g.id === t.id);
        return `<div class="p-space-md rounded-lg border border-outline-variant/60 bg-surface-container-lowest flex flex-col gap-2 min-w-0">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="w-9 h-9 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0"><span class="material-symbols-outlined text-[20px]">${esc(t.icon)}</span></span>
            <div class="min-w-0"><div class="font-body-md text-body-md font-semibold text-on-surface">${esc(t.title)}</div>
              <div class="font-body-sm text-body-sm text-outline">${esc(t.sub)}</div></div></div>
          <div class="whitespace-nowrap">${tileStatus(t)}</div>
          <p class="font-body-sm text-body-sm text-on-surface-variant flex-1">${esc(tileLine(t))}</p>
          <div class="flex flex-wrap items-center gap-2 pt-2 border-t border-outline-variant/30">
            ${t.link ? goBtn(t.link[0], t.link[1]) : ''}
            ${guide ? `<button class="${B.ghost}" data-tile="${esc(guide.id)}">Setup steps<span class="material-symbols-outlined text-[16px]">arrow_forward</span></button>` : ''}
          </div></div>`;
      }).join('')}</div></div>`;
    tiles.querySelectorAll('[data-tile]').forEach(b => b.addEventListener('click', () => openGuide(TILES.find(t => t.id === b.dataset.tile))));
    wireGo(tiles);
  };
  paintTiles();
  /* `select=*` rather than a column list: config_required_30d and
     last_config_required are newer than the schema snapshot the quality gate
     checks named columns against, and a row without them simply reads as
     "no runs needed setup" — healthLine() treats an absent count as nothing. */
  db('v_workflow_health?select=*')
    .then(r => { connectorState.wf = Array.isArray(r) ? r : []; }, e => { connectorState.wfErr = e; })
    .then(() => { paintTiles(); paintTrust(); });

  /* 2 · API keys */
  const keys = el('section', C.card);
  root.appendChild(keys);
  const paintKeys = (rows, err) => {
    const hd = cardHead('API keys & bearer tokens', `Let your own software call NEXUS. A key is shown once, when it is created. ${canWrite ? '' : 'Owner/admin only — read-only for your role.'}`,
      `<button class="${B.primary}" id="igKeyNew"${canWrite ? '' : ' disabled' + roNote}><span class="material-symbols-outlined text-[18px]">add</span>Create key</button>`, 'key');
    let body;
    if (err) body = stateError('this dealership’s API keys', err, null, 'Creating a key is disabled until this can be read.');
    else if (!rows) body = stateLoading(2);
    else if (!rows.length) body = stateEmpty('No API keys yet', 'Create one to let your DMS, CRM or phone system send data to NEXUS.', 'key');
    else body = table([
      { label: 'Name', strong: true, render: r => `<b>${esc(str(r.name) || 'Unnamed')}</b><div class="${C.hint} font-label-numeric-sm">${esc(str(r.key_prefix))}…</div>` },
      { label: 'Scopes', render: r => `<div class="flex flex-wrap gap-1">${arr(r.scopes).map(s => `<span class="${C.chip}">${esc(s)}</span>`).join('')}</div>` || muted('None') },
      { label: 'Created', render: r => when(r.created_at) },
      { label: 'Last used', render: r => when(r.last_used_at) },
      { label: 'Status', render: r => (r.revoked_at ? pill('REVOKED', 'cold') : pill('ACTIVE', 'ok')) },
      { label: '', align: 'r', render: r => (r.revoked_at || !canWrite ? '' : `<button class="${B.ghost}" data-revoke="${esc(r.key_id)}" data-name="${esc(str(r.name))}">Revoke</button>`) },
    ], rows);
    keys.innerHTML = hd + `<div class="${C.body}">${body}
      <div class="${C.caps} mt-space-md mb-1">Quickstart</div>
      <div class="${C.hint} mb-1.5">Base URL <span class="font-label-numeric-sm">${esc(API_BASE)}</span>. Replace <span class="font-label-numeric-sm">${KEY_PH}</span> with your key.</div>
      ${code(CURL_LEAD)}</div>`;
    const nb = keys.querySelector('#igKeyNew');
    if (nb && canWrite && !err) nb.addEventListener('click', openCreateKey);
    keys.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', () => openRevoke(b.dataset.revoke, b.dataset.name)));
  };
  const reloadKeys = async () => {
    paintKeys(null, null);
    try {
      const r = await db('rpc/nexus_api_keys_list'); const list = Array.isArray(r) ? r : [];
      paintKeys(list, null); connectorState.keys = list; connectorState.keysErr = null;
    } catch (e) { paintKeys(null, e); connectorState.keysErr = e; }
    paintTiles();
  };
  const openCreateKey = () => {
    const m = openModal('Create API key', `
      <div class="${C.field}"><label class="${C.label}" for="igKeyName">Name</label><input class="${C.input}" id="igKeyName" maxlength="80" placeholder="e.g. DMS production, 3CX phone system" /></div>
      <div class="${C.field}"><label class="${C.label}">Scopes</label>${checks('igScope', SCOPES)}
        <div class="${C.hint}">Untick anything this system does not need.</div></div>`,
      `<button class="${B.secondary}" id="igKeyCancel">Cancel</button><button class="${B.primary}" id="igKeyGo">Create key</button>`);
    m.wrap.querySelector('#igKeyCancel').addEventListener('click', m.close);
    m.wrap.querySelector('#igKeyGo').addEventListener('click', async () => {
      const name = m.wrap.querySelector('#igKeyName').value.trim();
      const scopes = picked(m.wrap, 'igScope');
      if (!name) return m.msg(`<span class="${C.hot}">Give the key a name so you can tell it apart later.</span>`);
      if (!scopes.length) return m.msg(`<span class="${C.hot}">Pick at least one scope.</span>`);
      const btn = m.wrap.querySelector('#igKeyGo');
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const row = one(await dbWrite('POST', 'rpc/nexus_api_key_create', { p_name: name, p_scopes: scopes }));
        let secret = str(row.api_key_once);
        m.wrap.querySelector('#modalBody').innerHTML = `
          ${banner('warm', 'warning', 'Copy this key now. It will not be shown again — NEXUS only keeps a hash of it.')}
          <div class="mt-3">${code(secret)}</div>
          <div class="mt-2">${copyBtn('key', 'Copy key')}</div>
          <div class="${C.hint} mt-3">Send it as <span class="font-label-numeric-sm">Authorization: Bearer &lt;key&gt;</span>.</div>`;
        wireCopy(m.wrap, () => secret);
        btn.remove();
        const c = m.wrap.querySelector('#igKeyCancel');
        const fresh = c.cloneNode(true); fresh.textContent = 'Done'; c.replaceWith(fresh);
        fresh.addEventListener('click', () => { secret = ''; m.close(); reloadKeys(); });
        m.wrap.querySelector('#mClose').addEventListener('click', () => { secret = ''; reloadKeys(); });
      } catch (e) { btn.disabled = false; btn.textContent = 'Create key'; modalError(m, e); }
    });
  };
  const openRevoke = (id, name) => {
    const m = openModal('Revoke API key', `<div class="${C.hint}">Revoke <b>${esc(name || 'this key')}</b>? Any system using it stops working immediately. This cannot be undone.</div>`,
      `<button class="${B.secondary}" id="igRevCancel">Cancel</button><button class="${B.danger}" id="igRevGo">Revoke key</button>`);
    m.wrap.querySelector('#igRevCancel').addEventListener('click', m.close);
    m.wrap.querySelector('#igRevGo').addEventListener('click', async e => {
      e.target.disabled = true;
      try { await dbWrite('POST', 'rpc/nexus_api_key_revoke', { p_key_id: id }); m.close(); reloadKeys(); }
      catch (err) { e.target.disabled = false; modalError(m, err); }
    });
  };

  /* 3 · Webhooks */
  const hooks = el('section', C.card);
  root.appendChild(hooks);
  const hookTone = s => ({ active: 'ok', disabled: 'cold' }[str(s).toLowerCase()] || 'cold');  // NX1013: active | disabled
  const paintHooks = (rows, err) => {
    const hd = cardHead('Outgoing webhook subscriptions', `NEXUS POSTs a signed JSON event to your URL when something happens. ${canWrite ? '' : 'Owner/admin only — read-only for your role.'}`,
      `<button class="${B.primary}" id="igHookNew"${canWrite ? '' : ' disabled' + roNote}><span class="material-symbols-outlined text-[18px]">add_link</span>Add webhook</button>`, 'webhook');
    let body;
    if (err) body = stateError('this dealership’s webhooks', err, null, 'Adding a webhook is disabled until this can be read.');
    else if (!rows) body = stateLoading(2);
    else if (!rows.length) body = stateEmpty('No webhooks yet', 'Add one to have NEXUS notify your CRM or DMS of new leads, scores, appointments and messages.', 'webhook');
    else body = table([
      { label: 'URL', strong: true, render: r => `<span class="font-label-numeric-sm break-all">${esc(str(r.url))}</span><div class="${C.hint}">${arr(r.events).map(v => esc(v)).join(', ')}</div>` },
      { label: 'Status', render: r => pill(str(r.status).toUpperCase() || 'UNKNOWN', hookTone(r.status), { verbatim: true })
          + (Number(r.consecutive_failures) > 0 ? `<div class="font-body-sm text-body-sm text-red-700">${cnt(r.consecutive_failures)} failures in a row</div>` : '') },
      { label: 'Last 24h', render: r => `${cnt(r.deliveries_24h)} sent<div class="${Number(r.failures_24h) > 0 ? 'font-body-sm text-body-sm text-red-700' : 'font-body-sm text-body-sm text-on-surface-variant'}">${cnt(r.failures_24h)} failed</div>` },
      { label: 'Last delivery', render: r => when(r.last_delivery_at) },
      { label: '', align: 'r', render: r => `<div class="flex flex-wrap gap-1.5 justify-end">
          <button class="${B.secondary}" data-log="${esc(r.webhook_id)}">Deliveries</button>
          ${canWrite ? `<button class="${B.secondary}" data-test="${esc(r.webhook_id)}"><span class="material-symbols-outlined text-[16px]">send</span>Send test</button>
          <button class="${B.ghost}" data-del="${esc(r.webhook_id)}" data-url="${esc(str(r.url))}">Delete</button>` : ''}</div>` },
    ], rows);
    hooks.innerHTML = hd + `<div class="${C.body}">${body}
      <div class="${C.caps} mt-space-md mb-1">Verifying the signature</div>
      <div class="${C.hint}">Every delivery carries <span class="font-label-numeric-sm">X-Nexus-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</span>, where
        <span class="font-label-numeric-sm">v1 = hex(hmac_sha256(signing_secret, t + "." + raw_body))</span>. Recompute it over the raw request body, compare in constant time, and reject if <span class="font-label-numeric-sm">t</span> is more than 5 minutes old.</div>
      <div class="${C.hint} mt-1.5">Events: ${EVENTS.map(v => `<span class="font-label-numeric-sm">${esc(v)}</span>`).join(', ')}.</div></div>`;
    const nb = hooks.querySelector('#igHookNew');
    if (nb && canWrite && !err) nb.addEventListener('click', openAddHook);
    hooks.querySelectorAll('[data-log]').forEach(b => b.addEventListener('click', () => openLog(b.dataset.log)));
    hooks.querySelectorAll('[data-test]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Sending…';
      try { await dbWrite('POST', 'rpc/nexus_webhook_send_test', { p_webhook_id: b.dataset.test }); b.textContent = 'Test queued'; setTimeout(() => openLog(b.dataset.test), 1500); }
      catch (e) { b.disabled = false; b.textContent = 'Send test'; b.title = str(e && e.message); }
    }));
    hooks.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => openDelete(b.dataset.del, b.dataset.url)));
  };
  const reloadHooks = async () => {
    paintHooks(null, null);
    try { const r = await db('rpc/nexus_webhooks_list'); paintHooks(Array.isArray(r) ? r : [], null); }
    catch (e) { paintHooks(null, e); }
  };
  const openAddHook = () => {
    const m = openModal('Add webhook', `
      <div class="${C.field}"><label class="${C.label}" for="igHookUrl">Endpoint URL (https)</label><input class="${C.input}" id="igHookUrl" type="url" placeholder="https://crm.example.com/nexus/webhook" /></div>
      <div class="${C.field}"><label class="${C.label}">Events</label>${checks('igEvent', EVENTS)}</div>`,
      `<button class="${B.secondary}" id="igHookCancel">Cancel</button><button class="${B.primary}" id="igHookGo">Add webhook</button>`);
    m.wrap.querySelector('#igHookCancel').addEventListener('click', m.close);
    m.wrap.querySelector('#igHookGo').addEventListener('click', async () => {
      const url = m.wrap.querySelector('#igHookUrl').value.trim();
      const events = picked(m.wrap, 'igEvent');
      let ok = false;
      try { const u = new URL(url); ok = u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; } catch { ok = false; }
      if (!ok) return m.msg(`<span class="${C.hot}">Enter a full https:// URL.</span>`);
      if (!events.length) return m.msg(`<span class="${C.hot}">Pick at least one event.</span>`);
      const btn = m.wrap.querySelector('#igHookGo');
      btn.disabled = true; btn.textContent = 'Adding…';
      try {
        const row = one(await dbWrite('POST', 'rpc/nexus_webhook_create', { p_url: url, p_events: events }));
        let secret = str(row.signing_secret_once);
        m.wrap.querySelector('#modalBody').innerHTML = `
          ${banner('warm', 'warning', 'Copy this signing secret now. It will not be shown again.')}
          <div class="mt-3">${code(secret)}</div>
          <div class="mt-2">${copyBtn('sec', 'Copy secret')}</div>
          <div class="${C.hint} mt-3">Use it to verify <span class="font-label-numeric-sm">X-Nexus-Signature: t=&lt;unix&gt;,v1=&lt;hex hmac_sha256(secret, t + "." + body)&gt;</span> on every delivery.</div>`;
        wireCopy(m.wrap, () => secret);
        btn.remove();
        const c = m.wrap.querySelector('#igHookCancel');
        const fresh = c.cloneNode(true); fresh.textContent = 'Done'; c.replaceWith(fresh);
        fresh.addEventListener('click', () => { secret = ''; m.close(); reloadHooks(); });
        m.wrap.querySelector('#mClose').addEventListener('click', () => { secret = ''; reloadHooks(); });
      } catch (e) { btn.disabled = false; btn.textContent = 'Add webhook'; modalError(m, e); }
    });
  };
  const openDelete = (id, url) => {
    const m = openModal('Delete webhook', `<div class="${C.hint}">Stop sending events to <span class="font-label-numeric-sm break-all">${esc(url)}</span>? This cannot be undone.</div>`,
      `<button class="${B.secondary}" id="igDelCancel">Cancel</button><button class="${B.danger}" id="igDelGo">Delete webhook</button>`);
    m.wrap.querySelector('#igDelCancel').addEventListener('click', m.close);
    m.wrap.querySelector('#igDelGo').addEventListener('click', async e => {
      e.target.disabled = true;
      try { await dbWrite('POST', 'rpc/nexus_webhook_delete', { p_webhook_id: id }); m.close(); reloadHooks(); }
      catch (err) { e.target.disabled = false; modalError(m, err); }
    });
  };
  const openLog = async id => {
    const m = openModal('Recent deliveries', `<div id="igLog">${stateLoading(3)}</div>`,
      `<button class="${B.secondary}" id="igLogRe">Refresh</button><button class="${B.primary}" id="igLogClose">Close</button>`);
    m.wrap.querySelector('#igLogClose').addEventListener('click', m.close);
    const load = async () => {
      const box = m.wrap.querySelector('#igLog');
      if (!box) return;
      box.innerHTML = stateLoading(3);
      try {
        const r = await db(`rpc/nexus_webhook_deliveries?p_webhook_id=${encodeURIComponent(id)}&p_limit=50`);
        const rows = Array.isArray(r) ? r : [];
        box.innerHTML = rows.length ? `<div class="overflow-x-auto">${table([
          { label: 'Event', strong: true, render: d => `<span class="font-label-numeric-sm">${esc(str(d.event))}</span>` },
          { label: 'Status', render: d => pill(str(d.status).toUpperCase() || 'UNKNOWN', ({ delivered: 'ok', pending: 'warm', failed: 'hot', dead: 'cold' })[str(d.status).toLowerCase()] || 'cold') },
          { label: 'Attempts', render: d => cnt(d.attempts) },
          { label: 'HTTP', render: d => (d.last_status_code != null ? `<span class="font-label-numeric-sm">${esc(str(d.last_status_code))}</span>` : muted('—')) },
          { label: 'Created', render: d => when(d.created_at) },
          { label: 'Delivered', render: d => when(d.delivered_at) },
        ], rows)}</div>` : stateEmpty('No deliveries yet', 'Nothing has been sent to this endpoint. Use “Send test” to send one.', 'schedule_send');
      } catch (e) { box.innerHTML = stateError('the delivery log', e); }
    };
    m.wrap.querySelector('#igLogRe').addEventListener('click', load);
    load();
  };

  /* b610ac "Building something custom?" — a call-out to the developer docs. */
  const foot = el('section', 'rounded-xl bg-primary-container/10 border border-primary/20 p-space-md flex flex-col md:flex-row md:items-center justify-between gap-space-sm');
  foot.innerHTML = `<div class="flex items-start gap-3"><span class="w-10 h-10 rounded-lg bg-primary text-on-primary flex items-center justify-center shrink-0"><span class="material-symbols-outlined">code</span></span>
    <div><h2 class="${C.title}">Building something custom?</h2>
    <p class="${C.sub}">Endpoints, payloads, errors, rate limits and signature examples in Node, Python and PHP.</p></div></div>
    <a class="${B.primary}" href="${esc(DOCS)}" target="_blank" rel="noopener">Open developer docs<span class="material-symbols-outlined text-[18px]">north_east</span></a>`;
  root.appendChild(foot);
  const trust = el('div');
  root.appendChild(trust);
  const paintTrust = () => {
    const S = connectorState;
    trust.innerHTML = trustFooter({
      source: 'API keys · webhooks · automation health',
      asOf: dubaiStamp(new Date()),
      evidence: S.keysErr ? 'API keys unread' : S.keys ? `${S.keys.length} ${S.keys.length === 1 ? 'key' : 'keys'} · ${S.wfErr ? 'health unread' : `${(S.wf || []).length} automations read`}` : 'Reading…',
      actor: actor(),
    });
  };

  reloadKeys().then(paintTrust);
  reloadHooks();
};
