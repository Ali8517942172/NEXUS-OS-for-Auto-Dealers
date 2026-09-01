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
       free; the invocation is not. The workflow's `Audit Log` node writes a row
       on EVERY call, rejections included, and this helper runs on mount of both
       Settings and Automation and again on every "Re-run checks" click.

       The probe sent { vehicleValue: 1, loanPayoffAmount: 0, creditScore: 700 }
       and no lead_email — unchanged since the probe was written — so every call
       it made is identifiable in audit_log by the rejection that payload and
       only that payload produces: "vehicleValue must be a realistic vehicle
       valuation of at least AED 5000. lead_email is required…". There are
       exactly 10 such rows (one 17 Aug, seven through the 24 Aug working
       session, one 28 Aug), plus the 6 NOT_EXECUTED input_error rows of 31 Aug,
       once the workflow began classifying bad input that way — consecutive
       execution ids 7722-7724 and 7741-7743, which is what repeatedly opening a
       page looks like. So 16 of Finance Calc's 60 logged runs in the 30-day
       window were manufactured by opening a health page: the dashboard was
       generating better than a quarter of the runs the dashboard reports, and
       the success rate shown on the same screen was computed over its own
       noise. A health check must not create business activity.

       It also painted green either way. `r.status === 'success' ? 'Responding'
       : 'Reachable'` RETURNS on both branches, and a probe that returns is a
       probe that succeeded — the same defect fixed on the n8n tile above, so a
       refused quote drew the same green dot as a good one.

       Do not re-add it. There is no read-only substitute: the only endpoint is
       POST /webhook/finance-calc, which runs the workflow; a GET is not
       registered and its 404 would prove nothing the n8n tile above does not
       already prove. Sending a `healthcheck: true` marker would be the same
       execution and the same audit row — the deployed workflow has no branch
       that honours one — so pretending otherwise here would only move the lie.
       It is listed as unprobed below, which is what this panel already does
       with everything it cannot check for free.

       One correction to the audit that raised this, so the number is not
       re-derived wrongly later: it reported 52 of 60, treating all 46 REJECTED
       rows as the probe's and describing them as "quote refused by validation"
       with an empty error list. Only one row in the table has an empty error
       list, and the largest REJECTED group — 23 rows inside half an hour on
       30 Aug — complains that the AECB credit score is missing, which this
       probe always supplied. Those are somebody using the finance desk, not
       this file. The real figure is 16, the defect is identical, and one
       manufactured run would have been one too many. */
  ];
  /* The one thing in this module that still calls a workflow, and it stays
     manual for that reason: it spends OpenRouter tokens, and — like the finance
     probe above — the Ask-AI workflow logs every call, so each press adds a row
     to the run history the Ask AI screen presents as that workflow's own record.
     A button a person chooses to press is a different thing from a call this
     module makes on mount, which is the line Finance Calc crossed. It is not
     re-armed to run automatically for exactly that reason.

     The question is worded to identify itself rather than sent as "ping": the
     workflow logs `Q: <question>`, so the row it leaves reads as the health
     check it was instead of sitting in the history looking like a customer who
     asked something meaningless. That makes the row legible; it does not make
     the call free, and nothing in the deployed workflow treats it specially. */
  const manual = [
    { name: 'Ask AI (RAG)', run: async () => {
        const r = await n8n('ask-ai', { question: 'Dashboard connectivity check, not a customer question' });
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
       <div class="cell-sub">Runs a real query — spends tokens and logs a run</div>
       <button class="btn sm" data-manual="${i}" style="margin-top:8px">Test</button></div>`).join('')}</div>
    <div style="margin-top:14px">
      <div class="label-caps" style="margin-bottom:8px">Not probed from the browser</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${unprobed.map(u => `<span class="chip">${esc(u)}</span>`).join('')}
      </div>
      <div class="cell-sub" style="margin-top:8px">None of these has a browser-reachable health endpoint. Most run server-side inside n8n; Finance Calc has only its live webhook, and calling that runs a real quote and writes a row to audit_log, which is how this panel came to manufacture 16 of that workflow's 60 logged runs before the check was withdrawn. Their real status is visible in the activity log above — a green dot here would be decoration, not a check.</div>
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
