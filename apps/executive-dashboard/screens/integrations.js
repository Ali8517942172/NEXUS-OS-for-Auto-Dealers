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
import { ago, esc, pill } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { table } from '../lib/ui.js';
import { openModal, modalError } from '../lib/modal.js';
import { el } from '../lib/dom.js';
import { SUPABASE_URL } from '../lib/env.js';

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
const muted = t => `<span class="t-muted">${t}</span>`;
const code = t => `<div class="mono" style="padding:12px;background:var(--surface-sunken);border-radius:8px;white-space:pre-wrap;word-break:break-all;overflow-x:auto;max-width:100%">${esc(t)}</div>`;
const when = v => (v ? esc(ago(v)) : muted('Never'));
const cnt = v => esc(String(Number(v) || 0));
const one = r => (Array.isArray(r) ? r[0] : r) || {};


const copyBtn = (id, label = 'Copy') => `<button class="btn sm" data-copy="${esc(id)}">${esc(label)}</button>`;
const wireCopy = (root, get) => root.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
  const clip = navigator.clipboard;
  const text = get(b.dataset.copy);
  if (!clip || !clip.writeText) { b.textContent = 'Select and copy manually'; return; }
  clip.writeText(text).then(() => { b.textContent = 'Copied'; }, () => { b.textContent = 'Copy blocked'; });
}));
const goBtn = (id, label) => (SCREENS[id]
  ? `<button class="btn sm" data-go="${esc(id)}">${esc(label)}</button>`
  : `<button class="btn sm ghost" disabled>${esc(label)} — not in this build</button>`);
const wireGo = (root, after) => root.querySelectorAll('[data-go]').forEach(b => {
  if (!b.disabled) b.addEventListener('click', () => { after && after(); go(b.dataset.go); });
});
const checks = (name, list, checked = true) => `<div style="display:flex;flex-wrap:wrap;gap:8px 16px">${list.map(v =>
  `<label style="display:flex;gap:6px;align-items:center;font-size:14px"><input type="checkbox" name="${esc(name)}" value="${esc(v)}"${checked ? ' checked' : ''}/> <span class="mono">${esc(v)}</span></label>`).join('')}</div>`;
const picked = (root, name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);
const ol = items => `<ol style="margin:8px 0 0 18px;padding:0;font-size:14px;line-height:1.6">${items.map(i => `<li>${i}</li>`).join('')}</ol>`;

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
  'Create an <b>API key</b> below (scope <span class="mono">leads:write</span>) so your system can send leads to NEXUS.',
  'Add a <b>webhook</b> below pointing at your system (or a Zapier / Make “Catch Hook” / “Custom webhook” URL) so NEXUS can send lead and appointment events back.',
  'In Zapier or Make: trigger = “Webhooks — Catch Hook”, action = your CRM’s “Create / Update Lead”. For the other direction: trigger = your CRM’s “New Lead”, action = “Webhooks — POST” to <span class="mono">' + esc(API_BASE) + '/leads</span> with header <span class="mono">Authorization: Bearer YOUR_API_KEY</span>.',
  'Use “Send test” on the webhook to confirm delivery, then check the deliveries log.',
];
const TILES = [
  { id: 'dms', icon: 'dns', title: 'Your DMS / CRM', sub: 'Any system that can call a REST API or receive a webhook.',
    body: () => `<div class="ds-cell-sub">NEXUS does not replace your DMS or CRM. Your system pushes leads in through the REST API, and NEXUS pushes events (new lead, score, appointment, inbound message) back out through signed webhooks.</div>
      ${ol(webhookSteps)}
      <div class="label-caps" style="margin-top:16px">Send a lead</div>${code(CURL_LEAD)}
      <div class="label-caps" style="margin-top:12px">Read leads</div>${code(CURL_LIST)}` },
  { id: 'bitrix', icon: 'hub', title: 'Bitrix24', sub: 'Outbound webhooks from Bitrix24, NEXUS webhooks back.',
    body: () => `<div class="ds-cell-sub">There is no one-click Bitrix24 connection for your own portal on this screen — connect it with the API and webhooks:</div>
      ${ol([
        'In Bitrix24: <b>Developer resources → Other → Outbound webhook</b>, event <span class="mono">ONCRMLEADADD</span>. Point it at a small relay (or a Zapier/Make scenario) that calls <span class="mono">POST /v1/leads</span> with your NEXUS API key.',
        'In Bitrix24: <b>Developer resources → Other → Inbound webhook</b> with CRM permission. Copy the URL.',
        'Here: add a NEXUS webhook (events <span class="mono">lead.scored</span>, <span class="mono">appointment.created</span>) pointing at a Zapier/Make hook that calls Bitrix24 <span class="mono">crm.lead.update</span> via that inbound URL.',
        'Use “Send test” and check the deliveries log.'])}` },
  { id: 'crms', icon: 'contacts', title: 'Zoho CRM · HubSpot · Salesforce · Odoo', sub: 'Via webhooks + API, or Zapier / Make “Webhooks” apps.',
    body: () => `<div class="ds-cell-sub">All four can send and receive HTTP webhooks natively (Zoho Workflow Rules → Webhook, HubSpot Workflows → Send webhook, Salesforce Flow → HTTP Callout, Odoo Automated Actions → Send Webhook), or through Zapier / Make.</div>
      ${ol(webhookSteps)}
      <div class="label-caps" style="margin-top:16px">Body your CRM should POST</div>${code(CURL_LEAD)}` },
  { id: 'calls', icon: 'call', title: 'Call system / telephony', sub: '3CX, Aircall, Twilio, or any PBX that can POST call logs.',
    body: () => `<div class="ds-cell-sub">Every answered or missed call becomes activity on the matching lead (matched by phone number). Configure your PBX’s “call ended” / CDR webhook to POST to <span class="mono">${esc(API_BASE)}/calls</span> with an API key that has the <span class="mono">calls:write</span> scope.</div>
      ${ol([
        '<b>3CX</b>: Settings → CRM Integration → custom template / call journaling URL.',
        '<b>Aircall</b>: Integrations → Webhooks, event <span class="mono">call.ended</span> (via Zapier/Make to reshape the body).',
        '<b>Twilio</b>: Voice status callback URL → a Twilio Function / relay that adds the Authorization header.',
        'Any other PBX: POST one JSON object per call, as below.'])}
      <div class="label-caps" style="margin-top:16px">Example</div>${code(CURL_CALL)}` },
  { id: 'web', icon: 'language', title: 'Website · Facebook · Google', sub: 'Lead forms and ads.', link: ['leadsources', 'Open Lead Sources'],
    body: () => `<div class="ds-cell-sub">Website forms, Facebook / Instagram Lead Ads and Google lead forms are set up on the Lead Sources screen. A custom website form can also POST straight to <span class="mono">/v1/leads</span> from your server (never put an API key in browser JavaScript).</div>` },
  { id: 'wa', icon: 'chat', title: 'WhatsApp', sub: 'Your own WhatsApp Business number.', link: ['channels', 'Open Channels'],
    body: () => `<div class="ds-cell-sub">Connect your WhatsApp Business Cloud number on the Channels screen. Inbound messages then fire the <span class="mono">message.received</span> webhook to your systems.</div>` },
];
const openGuide = t => {
  const m = openModal(t.title, `<div style="font-size:14px">${t.body()}</div>`,
    (t.link ? goBtn(t.link[0], t.link[1]) : '')
    + `<a class="btn" href="${esc(DOCS)}" target="_blank" rel="noopener">Full API docs →</a><button class="btn" id="igClose">Close</button>`);
  m.wrap.querySelector('#igClose').addEventListener('click', m.close);
  wireGo(m.wrap, m.close);
};

/* ── Screen ─────────────────────────────────────────────────────────────── */
SCREENS.integrations = async host => {
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

  const canWrite = canManageAccess();
  const roNote = canWrite ? '' : ' title="Only an owner or admin at this dealership can change integrations."';

  const head = el('div', 'card');
  head.innerHTML = `<div class="card-head"><div>
      <div class="card-title" style="font-size:20px">Keep your existing software. NEXUS connects to it.</div>
      <div class="card-sub">Your DMS, CRM and phone system stay exactly where they are. They send leads and calls to NEXUS through the REST API, and NEXUS sends events back to them through signed webhooks.</div></div>
      <div style="flex:1"></div>
      <a class="btn sm" href="${esc(DOCS)}" target="_blank" rel="noopener">Full API docs →</a></div>`;
  root.appendChild(head);

  /* 1 · Connect your software */
  const tiles = el('div', 'card');
  tiles.innerHTML = `<div class="card-head"><div><div class="card-title">Connect your software</div>
      <div class="card-sub">Pick what you use to see the steps.</div></div></div>
    <div class="pbody"><div class="grid g3">${TILES.map(t => `
      <button class="card" data-tile="${esc(t.id)}" style="text-align:left;cursor:pointer;display:flex;gap:12px;align-items:flex-start;width:100%;font:inherit;color:inherit">
        <span class="material-symbols-outlined t-muted">${esc(t.icon)}</span>
        <span><span class="card-title" style="display:block">${esc(t.title)}</span><span class="ds-cell-sub" style="display:block">${esc(t.sub)}</span></span>
      </button>`).join('')}</div></div>`;
  root.appendChild(tiles);
  tiles.querySelectorAll('[data-tile]').forEach(b => b.addEventListener('click', () => openGuide(TILES.find(t => t.id === b.dataset.tile))));

  /* 2 · API keys */
  const keys = el('div', 'card');
  root.appendChild(keys);
  const paintKeys = (rows, err) => {
    const hd = `<div class="card-head"><div><div class="card-title">API keys</div>
        <div class="card-sub">Let your own software call NEXUS. A key is shown once, when it is created. ${canWrite ? '' : 'Owner/admin only — read-only for your role.'}</div></div>
        <div style="flex:1"></div>
        <button class="btn primary sm" id="igKeyNew"${canWrite ? '' : ' disabled' + roNote}>Create key</button></div>`;
    let body;
    if (err) body = stateError('this dealership’s API keys', err, null, 'Creating a key is disabled until this can be read.');
    else if (!rows) body = stateLoading(2);
    else if (!rows.length) body = stateEmpty('No API keys yet', 'Create one to let your DMS, CRM or phone system send data to NEXUS.', 'key');
    else body = table([
      { label: 'Name', strong: true, render: r => `<b>${esc(str(r.name) || 'Unnamed')}</b><div class="ds-cell-sub mono">${esc(str(r.key_prefix))}…</div>` },
      { label: 'Scopes', render: r => arr(r.scopes).map(s => `<span class="chip mono">${esc(s)}</span>`).join(' ') || muted('None') },
      { label: 'Created', render: r => when(r.created_at) },
      { label: 'Last used', render: r => when(r.last_used_at) },
      { label: 'Status', render: r => (r.revoked_at ? pill('REVOKED', 'cold') : pill('ACTIVE', 'ok')) },
      { label: '', align: 'r', render: r => (r.revoked_at || !canWrite ? '' : `<button class="btn sm ghost" data-revoke="${esc(r.key_id)}" data-name="${esc(str(r.name))}">Revoke</button>`) },
    ], rows);
    keys.innerHTML = hd + `<div class="pbody">${body}
      <div class="label-caps" style="margin-top:16px">Quickstart</div>
      <div class="ds-cell-sub" style="margin-bottom:6px">Base URL <span class="mono">${esc(API_BASE)}</span>. Replace <span class="mono">${KEY_PH}</span> with your key.</div>
      ${code(CURL_LEAD)}</div>`;
    const nb = keys.querySelector('#igKeyNew');
    if (nb && canWrite && !err) nb.addEventListener('click', openCreateKey);
    keys.querySelectorAll('[data-revoke]').forEach(b => b.addEventListener('click', () => openRevoke(b.dataset.revoke, b.dataset.name)));
  };
  const reloadKeys = async () => {
    paintKeys(null, null);
    try { const r = await db('rpc/nexus_api_keys_list'); paintKeys(Array.isArray(r) ? r : [], null); }
    catch (e) { paintKeys(null, e); }
  };
  const openCreateKey = () => {
    const m = openModal('Create API key', `
      <div class="field"><label for="igKeyName">Name</label><input id="igKeyName" maxlength="80" placeholder="e.g. DMS production, 3CX phone system" /></div>
      <div class="field"><label>Scopes</label>${checks('igScope', SCOPES)}
        <div class="ds-cell-sub">Untick anything this system does not need.</div></div>`,
      `<button class="btn primary" id="igKeyGo">Create key</button><button class="btn" id="igKeyCancel">Cancel</button>`);
    m.wrap.querySelector('#igKeyCancel').addEventListener('click', m.close);
    m.wrap.querySelector('#igKeyGo').addEventListener('click', async () => {
      const name = m.wrap.querySelector('#igKeyName').value.trim();
      const scopes = picked(m.wrap, 'igScope');
      if (!name) return m.msg('<span class="t-hot">Give the key a name so you can tell it apart later.</span>');
      if (!scopes.length) return m.msg('<span class="t-hot">Pick at least one scope.</span>');
      const btn = m.wrap.querySelector('#igKeyGo');
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const row = one(await dbWrite('POST', 'rpc/nexus_api_key_create', { p_name: name, p_scopes: scopes }));
        let secret = str(row.api_key_once);
        m.wrap.querySelector('#modalBody').innerHTML = `
          <div class="banner warm">Copy this key now. It will not be shown again — NEXUS only keeps a hash of it.</div>
          <div style="margin-top:12px">${code(secret)}</div>
          <div style="margin-top:8px">${copyBtn('key', 'Copy key')}</div>
          <div class="ds-cell-sub" style="margin-top:12px">Send it as <span class="mono">Authorization: Bearer &lt;key&gt;</span>.</div>`;
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
    const m = openModal('Revoke API key', `<div class="ds-cell-sub">Revoke <b>${esc(name || 'this key')}</b>? Any system using it stops working immediately. This cannot be undone.</div>`,
      `<button class="btn primary" id="igRevGo">Revoke key</button><button class="btn" id="igRevCancel">Cancel</button>`);
    m.wrap.querySelector('#igRevCancel').addEventListener('click', m.close);
    m.wrap.querySelector('#igRevGo').addEventListener('click', async e => {
      e.target.disabled = true;
      try { await dbWrite('POST', 'rpc/nexus_api_key_revoke', { p_key_id: id }); m.close(); reloadKeys(); }
      catch (err) { e.target.disabled = false; modalError(m, err); }
    });
  };

  /* 3 · Webhooks */
  const hooks = el('div', 'card');
  root.appendChild(hooks);
  const hookTone = s => ({ active: 'ok', disabled: 'cold' }[str(s).toLowerCase()] || 'cold');  // NX1013: active | disabled
  const paintHooks = (rows, err) => {
    const hd = `<div class="card-head"><div><div class="card-title">Outgoing webhooks</div>
        <div class="card-sub">NEXUS POSTs a signed JSON event to your URL when something happens. ${canWrite ? '' : 'Owner/admin only — read-only for your role.'}</div></div>
        <div style="flex:1"></div>
        <button class="btn primary sm" id="igHookNew"${canWrite ? '' : ' disabled' + roNote}>Add webhook</button></div>`;
    let body;
    if (err) body = stateError('this dealership’s webhooks', err, null, 'Adding a webhook is disabled until this can be read.');
    else if (!rows) body = stateLoading(2);
    else if (!rows.length) body = stateEmpty('No webhooks yet', 'Add one to have NEXUS notify your CRM or DMS of new leads, scores, appointments and messages.', 'webhook');
    else body = table([
      { label: 'URL', strong: true, render: r => `<span class="mono" style="word-break:break-all">${esc(str(r.url))}</span><div class="ds-cell-sub">${arr(r.events).map(v => esc(v)).join(', ')}</div>` },
      { label: 'Status', render: r => pill(str(r.status).toUpperCase() || 'UNKNOWN', hookTone(r.status), { verbatim: true })
          + (Number(r.consecutive_failures) > 0 ? `<div class="ds-cell-sub t-hot">${cnt(r.consecutive_failures)} failures in a row</div>` : '') },
      { label: 'Last 24h', render: r => `${cnt(r.deliveries_24h)} sent<div class="ds-cell-sub${Number(r.failures_24h) > 0 ? ' t-hot' : ''}">${cnt(r.failures_24h)} failed</div>` },
      { label: 'Last delivery', render: r => when(r.last_delivery_at) },
      { label: '', align: 'r', render: r => `<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          <button class="btn sm" data-log="${esc(r.webhook_id)}">Deliveries</button>
          ${canWrite ? `<button class="btn sm" data-test="${esc(r.webhook_id)}">Send test</button>
          <button class="btn sm ghost" data-del="${esc(r.webhook_id)}" data-url="${esc(str(r.url))}">Delete</button>` : ''}</div>` },
    ], rows);
    hooks.innerHTML = hd + `<div class="pbody">${body}
      <div class="label-caps" style="margin-top:16px">Verifying the signature</div>
      <div class="ds-cell-sub">Every delivery carries <span class="mono">X-Nexus-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</span>, where
        <span class="mono">v1 = hex(hmac_sha256(signing_secret, t + "." + raw_body))</span>. Recompute it over the raw request body, compare in constant time, and reject if <span class="mono">t</span> is more than 5 minutes old.</div>
      <div class="ds-cell-sub" style="margin-top:6px">Events: ${EVENTS.map(v => `<span class="mono">${esc(v)}</span>`).join(', ')}.</div></div>`;
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
      <div class="field"><label for="igHookUrl">Endpoint URL (https)</label><input id="igHookUrl" type="url" placeholder="https://crm.example.com/nexus/webhook" /></div>
      <div class="field"><label>Events</label>${checks('igEvent', EVENTS)}</div>`,
      `<button class="btn primary" id="igHookGo">Add webhook</button><button class="btn" id="igHookCancel">Cancel</button>`);
    m.wrap.querySelector('#igHookCancel').addEventListener('click', m.close);
    m.wrap.querySelector('#igHookGo').addEventListener('click', async () => {
      const url = m.wrap.querySelector('#igHookUrl').value.trim();
      const events = picked(m.wrap, 'igEvent');
      let ok = false;
      try { const u = new URL(url); ok = u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; } catch { ok = false; }
      if (!ok) return m.msg('<span class="t-hot">Enter a full https:// URL.</span>');
      if (!events.length) return m.msg('<span class="t-hot">Pick at least one event.</span>');
      const btn = m.wrap.querySelector('#igHookGo');
      btn.disabled = true; btn.textContent = 'Adding…';
      try {
        const row = one(await dbWrite('POST', 'rpc/nexus_webhook_create', { p_url: url, p_events: events }));
        let secret = str(row.signing_secret_once);
        m.wrap.querySelector('#modalBody').innerHTML = `
          <div class="banner warm">Copy this signing secret now. It will not be shown again.</div>
          <div style="margin-top:12px">${code(secret)}</div>
          <div style="margin-top:8px">${copyBtn('sec', 'Copy secret')}</div>
          <div class="ds-cell-sub" style="margin-top:12px">Use it to verify <span class="mono">X-Nexus-Signature: t=&lt;unix&gt;,v1=&lt;hex hmac_sha256(secret, t + "." + body)&gt;</span> on every delivery.</div>`;
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
    const m = openModal('Delete webhook', `<div class="ds-cell-sub">Stop sending events to <span class="mono" style="word-break:break-all">${esc(url)}</span>? This cannot be undone.</div>`,
      `<button class="btn primary" id="igDelGo">Delete webhook</button><button class="btn" id="igDelCancel">Cancel</button>`);
    m.wrap.querySelector('#igDelCancel').addEventListener('click', m.close);
    m.wrap.querySelector('#igDelGo').addEventListener('click', async e => {
      e.target.disabled = true;
      try { await dbWrite('POST', 'rpc/nexus_webhook_delete', { p_webhook_id: id }); m.close(); reloadHooks(); }
      catch (err) { e.target.disabled = false; modalError(m, err); }
    });
  };
  const openLog = async id => {
    const m = openModal('Recent deliveries', `<div id="igLog">${stateLoading(3)}</div>`,
      `<button class="btn" id="igLogRe">Refresh</button><button class="btn" id="igLogClose">Close</button>`);
    m.wrap.querySelector('#igLogClose').addEventListener('click', m.close);
    const load = async () => {
      const box = m.wrap.querySelector('#igLog');
      if (!box) return;
      box.innerHTML = stateLoading(3);
      try {
        const r = await db(`rpc/nexus_webhook_deliveries?p_webhook_id=${encodeURIComponent(id)}&p_limit=50`);
        const rows = Array.isArray(r) ? r : [];
        box.innerHTML = rows.length ? `<div style="overflow-x:auto">${table([
          { label: 'Event', strong: true, render: d => `<span class="mono">${esc(str(d.event))}</span>` },
          { label: 'Status', render: d => pill(str(d.status).toUpperCase() || 'UNKNOWN', ({ delivered: 'ok', pending: 'warm', failed: 'hot', dead: 'cold' })[str(d.status).toLowerCase()] || 'cold') },
          { label: 'Attempts', render: d => cnt(d.attempts) },
          { label: 'HTTP', render: d => (d.last_status_code != null ? `<span class="mono">${esc(str(d.last_status_code))}</span>` : muted('—')) },
          { label: 'Created', render: d => when(d.created_at) },
          { label: 'Delivered', render: d => when(d.delivered_at) },
        ], rows)}</div>` : stateEmpty('No deliveries yet', 'Nothing has been sent to this endpoint. Use “Send test” to send one.', 'schedule_send');
      } catch (e) { box.innerHTML = stateError('the delivery log', e); }
    };
    m.wrap.querySelector('#igLogRe').addEventListener('click', load);
    load();
  };

  const foot = el('div', 'card');
  foot.innerHTML = `<div class="card-head"><div><div class="card-title">Building something custom?</div>
    <div class="card-sub">Endpoints, payloads, errors, rate limits and signature examples in Node, Python and PHP.</div></div>
    <div style="flex:1"></div><a class="btn primary sm" href="${esc(DOCS)}" target="_blank" rel="noopener">Full API docs →</a></div>`;
  root.appendChild(foot);

  reloadKeys();
  reloadHooks();
};
