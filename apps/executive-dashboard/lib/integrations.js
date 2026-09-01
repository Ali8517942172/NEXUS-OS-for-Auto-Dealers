/* NEXUS OS — lib/integrations.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { db, n8n } from './data.js';
import { N8N_BASE } from './env.js';
import { clock, esc } from './format.js';

async function renderIntegrations(node) {
  const checks = [
    { name: 'Supabase', probe: async () => { await db('leads?select=id&limit=1'); return 'Connected'; } },
    { name: 'n8n', probe: async () => {
        if (!N8N_BASE) throw new Error('VITE_N8N_BASE_URL not set');
        const r = await fetch(`${N8N_BASE}/healthz`).catch(() => null);
        if (!r) throw new Error('Unreachable from the browser');
        /* This line used to return the string "HTTP <status>" on the non-ok
           branch, and a probe that RETURNS is a probe that succeeded: the loop below
           painted the green dot with the caption "HTTP 502". The n8n box is a
           single small VM and has crashed twice; a 502 out of its reverse proxy
           is the exact state this tile exists to catch. screens/settings.js
           reads this tile back by its colour, so the green dot classified n8n
           as up, suppressed the n8n-down CRITICAL alert and printed
           "connectivity: Supabase and n8n both answered" while every workflow
           call — Ask AI, the finance desk, drip enrolment, WhatsApp replies —
           was dead. An answer is not a healthy answer. */
        if (!r.ok) throw new Error(`HTTP ${r.status}${r.statusText ? ` ${r.statusText}` : ''}`);
        return 'Reachable';
      }},
    /* Finance Calc used to be probed here, on the grounds that the calculator
       is pure JavaScript inside n8n and therefore free. The calculation is
       free; the invocation is not. The workflow's `Audit Log` node POSTs a row
       to audit_log on EVERY call, rejections included, and this helper runs on
       mount of both Settings and Automation and again on every "Re-run checks"
       click. It manufactured 52 of Finance Calc's 60 runs in the 30-day window
       — 46 REJECTED ("quote refused by validation", empty error list) and 6
       NOT_EXECUTED inside one hour on 31 Aug — so the health page was
       generating the runs the health page reports, and the success rate shown
       on the same screen was computed over its own noise. A health check must
       not create business activity.

       Do not re-add it. There is no read-only substitute: the only endpoint is
       POST /webhook/finance-calc, which runs the workflow; a GET is not
       registered and its 404 would prove nothing the n8n tile above does not
       already prove. Sending a `healthcheck: true` marker would be the same
       execution and the same audit row — the deployed workflow has no branch
       that honours one — so pretending otherwise here would only move the lie.
       It is listed as unprobed below, which is what this panel already does
       with everything it cannot check for free.

       Ask AI is likewise not probed on load: every call spends OpenRouter
       tokens, and a health dot is not worth paying for on every page view. It
       gets a manual Test button instead. */
  ];
  const manual = [
    { name: 'Ask AI (RAG)', run: async () => {
        const r = await n8n('ask-ai', { question: 'ping' });
        /* Same defect the n8n tile had: returning 'No answer' painted the green
           dot next to the words "No answer". A 200 carrying no answer is a
           failed RAG call, not a healthy one. */
        if (!r || !r.answer) throw new Error('Answered, but with no answer in the body');
        const docs = Number(r.documents_consulted);
        return Number.isFinite(docs) ? `Responding · ${docs} docs` : 'Responding';
      }},
  ];
  const unprobed = ['Finance Calc', 'WhatsApp (WAHA)', 'Bitrix24', 'Slack', 'Gmail', 'OpenRouter'];

  node.innerHTML = `<div class="grid g4">${checks.map((c, i) =>
    `<div class="card" style="padding:14px" id="ig${i}">
       <div style="font-weight:500">${esc(c.name)}</div>
       <div class="cell-sub">Checking…</div></div>`).join('')}
    ${manual.map((m, i) => `<div class="card" style="padding:14px" id="mg${i}">
       <div style="font-weight:500">${esc(m.name)}</div>
       <div class="cell-sub">Costs tokens — not auto-checked</div>
       <button class="btn sm" data-manual="${i}" style="margin-top:8px">Test</button></div>`).join('')}</div>
    <div style="margin-top:14px">
      <div class="label-caps" style="margin-bottom:8px">Not probed from the browser</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${unprobed.map(u => `<span class="chip">${esc(u)}</span>`).join('')}
      </div>
      <div class="cell-sub" style="margin-top:8px">None of these has a browser-reachable health endpoint. Most run server-side inside n8n; Finance Calc has only its live webhook, and calling that runs a real quote and writes a row to audit_log, which is how this panel came to manufacture most of that workflow's logged runs. Their real status is visible in the activity log above — a green dot here would be decoration, not a check.</div>
    </div>`;

  /* Every tile is found inside `node` and never by global id, and a tile that
     is no longer there is simply not painted.

     Both loops here outlive the screen that started them: a probe is a network
     call, and Settings can be navigated away from while three of them are in
     flight. `$('ig0')` is a document-wide lookup, so it returned null once the
     host had been emptied — and the *catch* branch then did `null.innerHTML`,
     which threw a second time from inside the error handler, uncaught, with the
     real failure lost. Scoping to `node` also means a late result writes into a
     detached subtree rather than into whichever screen is on screen now. */
  const paint = (sel, dot, name, sub, subClass = '') => {
    const box = node.querySelector(sel);
    if (!box) return;
    box.innerHTML = `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:var(--${dot})"></span>
        <span style="font-weight:500">${esc(name)}</span></div><div class="cell-sub${subClass}">${sub}</div>`;
  };

  node.querySelectorAll('[data-manual]').forEach(btn => btn.addEventListener('click', async () => {
    const i = Number(btn.dataset.manual);
    btn.disabled = true; btn.textContent = 'Testing…';
    try {
      const msg = await manual[i].run();
      paint(`#mg${i}`, 'ok', manual[i].name, esc(msg));
    } catch (e) {
      paint(`#mg${i}`, 'hot', manual[i].name, esc(String(e.message).slice(0, 90)), ' t-hot');
    }
  }));

  checks.forEach(async (c, i) => {
    try {
      const msg = await c.probe();
      paint(`#ig${i}`, 'ok', c.name, `${esc(msg)} · ${esc(clock(Date.now()))}`);
    } catch (e) {
      paint(`#ig${i}`, 'hot', c.name, esc(String(e.message).slice(0, 90)), ' t-hot');
    }
  });
}

/* ==========================================================================
   S10 · Customer 360
   ========================================================================== */

export { renderIntegrations };
