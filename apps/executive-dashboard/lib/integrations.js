/* NEXUS OS — lib/integrations.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body below is
   the original code, moved not rewritten. */
import { db, n8n } from './data.js';
import { N8N_BASE } from './env.js';
import { clock, esc } from './format.js';

/* ── Which checks may fire by themselves ─────────────────────────────────────
   The constraint, stated once so nobody has to rediscover it: MONITORING MUST
   NOT MUTATE BUSINESS STATE. A health check that runs on mount is a check that
   runs every time anybody opens a page, and every execution this dashboard
   causes lands in audit_log — the same table the Workflows card, the Automation
   screen and the 30-day success rates all read back as the business's own
   record. The finance-calc probe removed on 31 Aug (see the long note below)
   had manufactured 16 of Finance Calc's 60 logged runs in the window: better
   than a quarter of a workflow's month, invented by opening a page, and then
   reported on the same screen as though the workflow had done it.

   `opts.autoProbe` is the guard against that returning. It is an allow-list
   supplied by the CALLER, because the caller is the screen that knows what it
   is willing to cause: screens/settings.js passes /^(supabase|n8n)$/i and names
   the rule at its call site. A check not on the list is still rendered and
   still runnable — it gets a button, exactly like the Ask-AI tile, because a
   person choosing to press it is a different thing from this module firing it —
   it simply does not run on mount.

   Absent the option, everything auto-runs, which is today's behaviour and is
   what screens/automation.js:2099 (which passes nothing) keeps getting. That
   default is safe only because of what `checks` currently holds: one indexed
   SELECT and one GET on /healthz, both reads that write nothing anywhere. It is
   NOT a licence to add a third. Anything that causes a workflow execution
   belongs in `manual`, not in `checks` behind an allow-list nobody passed.

   An autoProbe value this function cannot interpret fails CLOSED — nothing
   auto-runs — because a guard that fails open on a typo is not a guard. The
   tiles then visibly say they were not run, so it cannot fail silently. */
function autoAllowed(autoProbe, name) {
  if (autoProbe == null) return true;                 // no constraint declared
  if (autoProbe instanceof RegExp) return autoProbe.test(name);
  if (typeof autoProbe === 'function') return !!autoProbe(name);
  if (Array.isArray(autoProbe)) return autoProbe.some(x => String(x).toLowerCase() === name.toLowerCase());
  return false;
}

/* The two read-only checks, at module scope since 7 Oct 2026 so that the
   topbar's system-health popover (lib/shell.js, via runCheck below) runs the
   SAME probes the Settings and Automation tiles run, rather than a second copy
   that could drift. Everything said inside renderIntegrations() about what may
   and may not be added here applies to both callers. */
const CHECKS = [
  { name: 'NEXUS data', probe: async () => { await db('leads?select=id&limit=1', { background: true }); return 'Connected'; } },
  { name: 'Automation', probe: async () => {
      if (!N8N_BASE) throw new Error('This deployment is not configured to reach it');
      const r = await fetch(`${N8N_BASE}/healthz`, { cache: 'no-store' }).catch(() => null);
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

/* One check by name: { ok: true, detail } or { ok: false, detail }. Never
   throws. `detail` is the probe's own short sentence. */
async function runCheck(name) {
  const c = CHECKS.find(x => x.name === name);
  if (!c) return { ok: false, detail: 'No such check' };
  try { return { ok: true, detail: await c.probe() }; }
  catch (e) { return { ok: false, detail: String((e && e.message) || e).slice(0, 120) }; }
}

async function renderIntegrations(node, opts = {}) {
  /* The TILE NAMES are what a dealership reads, so they name the capability
     rather than the supplier behind it (CONTROL-PLANE.md 5.5 and Part 4: which
     SaaS is behind which feature is the vendor's). screens/settings.js matches
     these names in its auto-probe allow-list and again when it reads the tiles
     back, so the three places have to agree — if you rename one, rename all
     three. */
  const checks = CHECKS;
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
    { name: 'Ask AI', run: async () => {
        const r = await n8n('ask-ai', { question: 'Dashboard connectivity check, not a customer question' });
        /* Same defect the n8n tile had: returning 'No answer' painted the green
           dot next to the words "No answer". A 200 carrying no answer is a
           failed RAG call, not a healthy one. */
        if (!r || !r.answer) throw new Error('Answered, but with no answer in the body');
        const docs = Number(r.documents_consulted);
        return Number.isFinite(docs) ? `Responding · ${docs} docs` : 'Responding';
      }},
  ];
  /* Was ['Finance Calc', 'WhatsApp (WAHA)', 'Bitrix24', 'Slack', 'Gmail',
     'OpenRouter'] — the vendor's supplier list, rendered as chips on both
     Settings and Automation, from which a dealership could price the stack and
     discover in one search that their WhatsApp runs through an unofficial
     client. CONTROL-PLANE.md 5.5. Named by the capability the dealership buys
     instead, which is the half that is theirs and is also the half that is
     stable when a supplier is swapped. */
  const unprobed = ['Finance calculations', 'WhatsApp messaging', 'CRM sync', 'Team notifications', 'Email delivery', 'AI answers'];

  /* Decided once, before anything is rendered, so the tile a check gets and the
     decision to fire it cannot come apart: a tile saying "Checking…" for a probe
     that will never run is the stuck state this panel already had once. */
  const auto = checks.map(c => autoAllowed(opts && opts.autoProbe, c.name));

  node.innerHTML = `<div class="grid g4">${checks.map((c, i) =>
    `<div class="card" style="padding:14px" id="ig${i}">
       <div style="font-weight:500">${esc(c.name)}</div>
       ${auto[i]
         ? '<div class="cell-sub">Checking…</div>'
         : `<div class="cell-sub">Not run automatically on this screen</div>
            <button class="btn sm" data-deferred="${i}" style="margin-top:8px">Check</button>`}</div>`).join('')}
    ${manual.map((m, i) => `<div class="card" style="padding:14px" id="mg${i}">
       <div style="font-weight:500">${esc(m.name)}</div>
       <div class="cell-sub">Runs a real query and records it, like any other</div>
       <button class="btn sm" data-manual="${i}" style="margin-top:8px">Test</button></div>`).join('')}</div>
    <div style="margin-top:14px">
      <div class="label-caps" style="margin-bottom:8px">Not probed from the browser</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${unprobed.map(u => `<span class="chip">${esc(u)}</span>`).join('')}
      </div>
      <div class="cell-sub" style="margin-top:8px">None of these can be checked from a browser without doing real work — the only way to test finance calculations is to run a real quote, which records a real run. Their true state is in the activity log above, which reads what they actually did. A green dot here would be decoration, not a check.</div>
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

  const runCheck = async i => {
    const c = checks[i];
    try {
      const msg = await c.probe();
      paint(`#ig${i}`, 'ok', c.name, `${esc(msg)} · ${esc(clock(Date.now()))}`);
    } catch (e) {
      paint(`#ig${i}`, 'hot', c.name, esc(String(e.message).slice(0, 90)), ' t-hot');
    }
  };

  /* A deferred check is not a disabled one — the person pressing the button is
     the authorisation the mount did not have. */
  node.querySelectorAll('[data-deferred]').forEach(btn => btn.addEventListener('click', () => {
    const i = Number(btn.dataset.deferred);
    btn.disabled = true; btn.textContent = 'Checking…';
    runCheck(i);
  }));

  checks.forEach((c, i) => { if (auto[i]) runCheck(i); });
}

/* ==========================================================================
   S10 · Customer 360
   ========================================================================== */

export { renderIntegrations, runCheck, CHECKS };
