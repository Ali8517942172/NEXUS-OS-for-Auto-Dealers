/* NEXUS OS — screens/automation.js
   The workflow health screen. Rebuilt on 20 Aug 2026.

   Until two days ago this screen was quietly wrong: it read the all-time `runs`
   and `failures` columns and called anything with a non-zero failure count
   "Failing" forever, so a workflow that broke once in March and has been clean
   since looked identical to one that is failing right now. `v_workflow_health`
   now carries `runs_30d`, `failures_30d` and `last_failure` beside the all-time
   totals and computes `health` on a rolling 30-day window, so this screen leads
   with the recent window and keeps the all-time figures as context behind it.

   Three rules this screen holds itself to:

     · The 30-day success rate is computed here from `runs_30d` and
       `failures_30d` — the two columns whose window is documented — rather than
       taken on trust from `success_rate`. The view's own figure is still shown
       in the detail drawer, and if the two disagree the screen says so instead
       of silently picking one.
     · "No failures" and "nothing is being measured" are opposite findings and
       never share a colour. Most of the registered workflows do not write to
       audit_log; they are NOT_INSTRUMENTED, and a blank health record for those
       is reported as a blind spot, not as good news.
     · One exception to that, added 24 Aug 2026: a request/response endpoint the
       dashboard itself calls — whatsapp-send, ask-ai, finance-calc — returns its
       outcome in the HTTP reply and is read by the operator at the moment of the
       call. When such a workflow is registered with writes_audit_log false, the
       missing audit row is the design, not a gap, and this screen says so in a
       neutral voice instead of filing it under "blind spot". It still refuses to
       claim those runs succeeded: no history is kept here, and that is stated.
     · A manual trigger only exists where an n8n webhook in HOOK really exists
       AND can be fired without inventing a subject record. Everything else is a
       disabled button whose title names exactly what is missing. No webhook
       path is guessed, and nothing here writes to a service-role table. */
import { HOOK, db, n8n } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { N8N_BASE } from '../lib/env.js';
import { ago, clock, esc, n0, num, pct, pill } from '../lib/format.js';
import { renderIntegrations } from '../lib/integrations.js';
import { modalError, openModal } from '../lib/modal.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, table, wireRows } from '../lib/ui.js';

/* Bounded read. Where the cap is actually hit the screen says so — an activity
   log that looks complete but is a window is the same class of lie this screen
   was rebuilt to stop telling. */
const AUDIT_LIMIT = 500;

/* audit_log has no execution_id column, which is why "Open in n8n" used to be a
   permanently disabled button. But the Error Handler already writes the
   execution's own n8n URL into the summary text:

     "… · Failed at node: Model Ladder · Execution 3213 ·
      https://…/workflow/BiyHk9ZXxJUVGbf6/executions/3213"

   So the deep-link exists for exactly the runs that need one — the failures.
   Match the n8n execution URL shape specifically rather than any URL, so a link
   that happens to appear inside some other workflow's summary can never turn
   into a button claiming to open a stack trace. */
const EXEC_URL_RE = /https?:\/\/[^\s·"'<>]+\/workflow\/[A-Za-z0-9_-]+\/executions\/\d+/;
const execUrl = row => (String(row?.summary || '').match(EXEC_URL_RE) || [null])[0];

const low = s => String(s || '').trim().toLowerCase();
const up  = s => String(s || '').trim().toUpperCase();

/* ── Health vocabulary ─────────────────────────────────────────────────────
   `rank` orders the list worst-first. NOT_INSTRUMENTED deliberately sorts above
   HEALTHY: an unmeasured workflow is a worse position to be in than a measured
   clean one, even though it cannot be coloured red. */
const HEALTH = {
  DEGRADED: {
    label: 'Degraded', tone: 'hot', icon: 'error', rank: 0,
    detail: 'At least one run failed inside the 30-day window. This is the state that needs a human.',
  },
  NEVER_RAN: {
    label: 'No runs yet', tone: '', icon: 'schedule', rank: 1,
    detail: 'The workflow writes to audit_log but has not logged a single run, so there is nothing to measure yet.',
  },
  NOT_INSTRUMENTED: {
    label: 'Not logged', tone: '', icon: 'visibility_off', rank: 2,
    detail: 'This workflow has no Audit Log node, so nothing it does reaches audit_log. Its health is unknown rather than good — the dashboard cannot see it succeed or fail.',
  },
  HEALTHY: {
    label: 'Healthy', tone: 'ok', icon: 'check_circle', rank: 3,
    detail: 'Every logged run inside the 30-day window succeeded.',
  },
};
const UNKNOWN_HEALTH = {
  label: 'Unrecognised', tone: 'warm', icon: 'help', rank: 1,
  detail: 'v_workflow_health returned a health state this screen does not know how to describe. It is shown verbatim rather than folded into one of the states it might mean.',
};

/* ── Endpoints that answer their caller ────────────────────────────────────
   A workflow with no Audit Log node is normally a blind spot: it may be running
   perfectly or failing every time and nothing here can tell. That reading is
   wrong for the handful of webhooks the dashboard itself calls and waits on. A
   request/response endpoint hands its outcome straight back to the caller, and
   the screen that made the call shows it to the operator there and then. For
   those, no audit row is the correct design, not a missing one.

   The entries below are facts about this bundle, not about the database: each
   one is a HOOK path some screen in this build posts to and reads a reply from.
   The classification only ever applies when the registry itself says the
   workflow writes no audit log — this screen never overrides what the database
   reported, it only refuses to call a deliberate choice a fault.

   What it does NOT claim: that those runs succeeded. There is no history for
   them here, and every surface below says so plainly. */
const RESPONDS_TO_CALLER = {
  [HOOK.whatsappSend]: {
    answer: "{ status: 'sent' | 'error' }",
    where: 'Conversations',
    line: 'Replies sent from Conversations post here and wait for the answer, so the operator is told at that moment whether the message actually left WAHA.',
  },
  [HOOK.askAi]: {
    answer: 'the answer and the documents it consulted',
    where: 'Ask AI',
    line: 'Ask AI posts the question and renders whatever comes back, so a failure is visible in the reply rather than after the fact.',
  },
  [HOOK.finance]: {
    answer: 'the calculated quote',
    where: 'Finance Desk',
    line: 'The Finance Desk posts the figures and renders the quote it gets back, so a failure is visible in the reply rather than after the fact.',
  },
};
/* hookFor is declared further down; this is only ever called at render time. */
const respondsToCaller = w =>
  w.writes_audit_log === false && !!RESPONDS_TO_CALLER[hookFor(w)];
const callerInfo = w => RESPONDS_TO_CALLER[hookFor(w)] || null;

const RETURNS_RESULT = {
  label: 'Answers the caller', tone: '', icon: 'sync_alt', rank: 3.5,
  detail: 'This endpoint is called by the dashboard and answers in the reply, so the screen that called it shows the outcome immediately. It is registered as writing no audit row, and for a request/response endpoint that is the right design rather than a gap. The trade-off is real and worth knowing: no run history is kept, so nothing here can tell you how it behaved yesterday.',
};

/* The state a workflow is presented under. Everything except RETURNS_RESULT is
   the view's own `health` value, unchanged. */
const STATES = { ...HEALTH, RETURNS_RESULT };
const stateKey = w => (respondsToCaller(w) ? 'RETURNS_RESULT' : up(w.health));
const healthOf = w => STATES[stateKey(w)] || UNKNOWN_HEALTH;
const healthLabel = w => (STATES[stateKey(w)] ? STATES[stateKey(w)].label : (w.health || 'Unrecognised'));

/* Rates are computed from the two count columns rather than read from
   success_rate, because runs_30d / failures_30d are the pair whose window is
   documented. Both are plain arithmetic over numbers Postgres produced. */
const rateOf = (runs, failures) => {
  const r = n0(runs);
  if (r == null || r <= 0) return null;
  const f = Math.max(0, Math.min(n0(failures) || 0, r));
  return ((r - f) / r) * 100;
};
const rate30 = w => rateOf(w.runs_30d, w.failures_30d);
const rateAll = w => rateOf(w.runs, w.failures);

const runBar = w => {
  const r = n0(w.runs_30d) || 0;
  if (!r) return '';
  const f = Math.max(0, Math.min(n0(w.failures_30d) || 0, r));
  const ok = r - f;
  return `<div class="stackbar" style="height:6px;max-width:220px;margin-top:8px">
    ${ok ? `<i style="width:${(ok / r * 100).toFixed(1)}%;background:var(--ok)"></i>` : ''}
    ${f ? `<i style="width:${(f / r * 100).toFixed(1)}%;background:var(--hot)"></i>` : ''}
  </div>`;
};

/* ── Manual triggers ───────────────────────────────────────────────────────
   HOOK is the complete list of webhooks this bundle knows about. A workflow
   earns a live "Run now" only when its registry trigger_detail names one of
   those paths AND the workflow can be started without a subject record. Every
   other button is rendered and disabled with the specific reason, because
   "there is no button" and "the button is not built yet" read very differently
   to whoever is standing in front of a broken workflow. */
const HOOK_PATHS = Object.values(HOOK).slice().sort((a, b) => b.length - a.length);
const hookFor = w => {
  const d = low(w.trigger_detail);
  if (!d) return null;
  return HOOK_PATHS.find(p => d.includes(p)) || null;
};

/* The one webhook that means something with no subject attached: an ERP sync is
   a batch job over whatever Odoo and Supabase currently hold. */
const NO_SUBJECT_HOOKS = { [HOOK.erpSync]: 'Sync now' };

/* Hooks that exist, are reachable, and still must never be fired from here.
   whatsapp-send puts a message on the owner's real WhatsApp number: it needs a
   chat_id and the text, and with neither attached it would either send nothing
   or send something nobody wrote. The composer that owns both lives on
   Conversations, so that is where the button belongs. */
const NO_MANUAL_RUN = {
  [HOOK.whatsappSend]:
    'This screen deliberately offers no manual run for whatsapp-send. It sends a WhatsApp message to a real person and needs a chat_id and the message text; firing it with an empty body would accomplish nothing. It is driven from the Conversations screen, which holds the thread, supplies both fields and shows whether the message left.',
};

const NEEDS_SUBJECT = {
  [HOOK.askAi]:      'a question to answer, and every call spends OpenRouter tokens. Ask AI is the screen that supplies one.',
  [HOOK.finance]:    'a vehicle value, a payoff amount and a credit score. The Finance Desk screen supplies them.',
  [HOOK.warmDrip]:   'a specific lead to enrol. Campaigns and Leads both start it against a chosen customer.',
  [HOOK.closedWon]:  'a specific closed deal. The Deals screen records one.',
  [HOOK.kyc]:        'a specific uploaded document to audit. Compliance holds the register it reads from.',
  [HOOK.escalation]: 'a specific lead to escalate. The Leads screen picks one.',
};
const SUBJECT_SCREEN = {
  [HOOK.askAi]:      { id: 'ask',        title: 'Ask AI' },
  [HOOK.finance]:    { id: 'finance',    title: 'Finance Desk' },
  [HOOK.warmDrip]:   { id: 'campaigns',  title: 'Campaigns' },
  [HOOK.closedWon]:  { id: 'deals',      title: 'Deals' },
  [HOOK.kyc]:        { id: 'compliance', title: 'Compliance' },
  [HOOK.escalation]: { id: 'leads',      title: 'Leads' },
  [HOOK.whatsappSend]: { id: 'conversations', title: 'Conversations' },
};

const NO_N8N_BASE =
  'VITE_N8N_BASE_URL is not set in this deployment, so the browser has no n8n host to call. Every manual trigger is unavailable until it is configured.';

function triggerState(w) {
  const hook = hookFor(w);
  if (!hook) {
    const how = w.trigger_type
      ? `It runs on ${w.trigger_type}${w.trigger_detail ? ` (${w.trigger_detail})` : ''}`
      : 'Its trigger is not recorded in workflow_registry';
    return { hook: null, can: false, label: 'Run now',
      why: `No manual trigger exists for this workflow. ${how}, and no webhook in the dashboard's HOOK list maps to it, so there is no endpoint to call. Inventing one would post into the void.` };
  }
  if (!N8N_BASE) return { hook, can: false, label: 'Run now', why: NO_N8N_BASE };
  if (NO_MANUAL_RUN[hook]) return { hook, can: false, label: 'Run now', why: NO_MANUAL_RUN[hook] };
  if (NO_SUBJECT_HOOKS[hook]) return { hook, can: true, label: NO_SUBJECT_HOOKS[hook], why: '' };
  return { hook, can: false, label: 'Run now',
    why: `The ${hook} webhook exists, but it needs ${NEEDS_SUBJECT[hook] || 'a subject record this screen does not have'} Firing it from here with nothing attached would either fail or act on the wrong record.` };
}

SCREENS.automation = async host => {
  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const banners = el('div'); banners.style.marginTop = '16px'; host.appendChild(banners);
  const healthCard = el('div', 'card flush'); healthCard.style.marginTop = '16px'; host.appendChild(healthCard);
  healthCard.innerHTML = stateLoading(6);
  const logCard = el('div', 'card flush'); logCard.style.marginTop = '16px'; host.appendChild(logCard);
  logCard.innerHTML = stateLoading(5);
  const intg = el('div', 'card'); intg.style.marginTop = '16px'; host.appendChild(intg);

  /* allSettled, not a shared catch: "the health view is down" and "the audit log
     is down" are different sentences and each panel is entitled to the right
     one. Swallowing either into an empty array would render a green screen over
     a dead system, which is the exact failure this screen exists to prevent. */
  const [healthR, auditR, regR] = await Promise.allSettled([
    db('v_workflow_health?select=*'),
    db(`audit_log?select=workflow,status,lead_name,lead_email,lead_score,intent,summary,logged_at&order=logged_at.desc&limit=${AUDIT_LIMIT}`),
    db('workflow_registry?select=id,name,audit_name,audit_aliases'),
  ]);

  const health = healthR.status === 'fulfilled' ? healthR.value : null;
  const healthErr = healthR.status === 'rejected' ? (healthR.reason?.message || 'Unknown error') : null;
  const audit = auditR.status === 'fulfilled' ? auditR.value : null;
  const auditErr = auditR.status === 'rejected' ? (auditR.reason?.message || 'Unknown error') : null;
  const registry = regR.status === 'fulfilled' ? regR.value : null;

  /* The registry is what ties an n8n workflow to the string it writes into
     audit_log. Without it the drawer falls back to matching on the display
     name, which is a weaker join, so the difference is stated rather than
     hidden behind a suspiciously short history. */
  const regById = new Map((registry || []).map(r => [String(r.id), r]));
  const namesFor = w => {
    const r = regById.get(String(w.id));
    const s = new Set();
    [w.name, r?.name, r?.audit_name, ...(Array.isArray(r?.audit_aliases) ? r.audit_aliases : [])]
      .filter(Boolean).forEach(n => s.add(low(n)));
    return s;
  };
  const auditFor = w => {
    const names = namesFor(w);
    return (audit || []).filter(a => names.has(low(a.workflow)));
  };

  const rows = (health || []).slice().sort((a, b) =>
    (healthOf(a).rank - healthOf(b).rank)
    || ((rate30(a) ?? 101) - (rate30(b) ?? 101))
    || ((n0(b.failures_30d) || 0) - (n0(a.failures_30d) || 0))
    || String(a.name || '').localeCompare(String(b.name || '')));

  const degraded = rows.filter(w => stateKey(w) === 'DEGRADED');
  /* Split deliberately: a workflow that answers its caller is not part of the
     blind-spot count and must not inflate it. */
  const blind = rows.filter(w => stateKey(w) === 'NOT_INSTRUMENTED');
  const byDesign = rows.filter(w => stateKey(w) === 'RETURNS_RESULT');
  const auditCapped = (audit || []).length >= AUDIT_LIMIT;

  /* ── KPI strip ─────────────────────────────────────────────────────────── */
  if (!health) {
    strip.classList.remove('grid', 'g5');
    strip.innerHTML = stateError('workflow health', healthErr);
  } else if (!rows.length) {
    strip.classList.remove('grid', 'g5');
    strip.innerHTML = stateEmpty('No workflows registered',
      'v_workflow_health returned no rows, so there is nothing to report on. workflow_registry is what populates it.', 'account_tree');
  } else {
    const sum = k => rows.reduce((a, w) => a + (n0(w[k]) || 0), 0);
    const runs30 = sum('runs_30d'), fails30 = sum('failures_30d');
    const runsAll = sum('runs'), failsAll = sum('failures');
    const esc30 = sum('escalations');
    const active = rows.filter(w => w.is_active !== false).length;
    const logged = rows.filter(w => w.writes_audit_log).length;
    const lastFail = rows.map(w => w.last_failure).filter(Boolean)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || null;
    const r30 = rateOf(runs30, fails30);
    const rAll = rateOf(runsAll, failsAll);

    strip.innerHTML = [
      kpi('Workflows registered', num(rows.length),
        `${active} active · ${logged} of ${rows.length} write to audit_log${
          byDesign.length ? ` · ${num(byDesign.length)} answer${byDesign.length === 1 ? 's' : ''} the caller instead` : ''}`),
      kpi('Degraded now', num(degraded.length),
        degraded.length
          ? `<span class="t-hot">${esc(degraded.map(w => w.name).slice(0, 2).join(', '))}${degraded.length > 2 ? ` +${degraded.length - 2} more` : ''}</span>`
          : (logged
              ? '<span class="t-ok">No logged workflow failed inside the 30-day window</span>'
              : '<span class="t-muted">Nothing writes to audit_log, so nothing can be measured</span>'),
        degraded.length ? 't-hot' : ''),
      kpi('Runs · last 30 days', num(runs30),
        runsAll
          ? `<span class="t-muted">${num(runsAll)} logged all-time</span>`
          : '<span class="t-muted">No run has ever been logged</span>'),
      kpi('Failures · last 30 days', num(fails30),
        fails30
          ? `<span class="t-hot">Most recent ${esc(ago(lastFail))}</span>`
          : (failsAll
              ? `<span class="t-muted">${num(failsAll)} all-time, none inside the window</span>`
              : '<span class="t-muted">None logged, ever</span>'),
        fails30 ? 't-hot' : ''),
      kpi('Success rate · 30 days', r30 == null ? '—' : pct(r30),
        r30 == null
          ? '<span class="t-muted">No runs inside the window to divide by</span>'
          : `Across ${num(runs30)} logged run${runs30 === 1 ? '' : 's'}${rAll == null ? '' : ` · ${pct(rAll)} all-time`}${esc30 ? ` · ${num(esc30)} escalation${esc30 === 1 ? '' : 's'}` : ''}`,
        r30 == null ? '' : (fails30 ? 't-hot' : 't-ok')),
    ].join('');
  }

  /* ── Banners ───────────────────────────────────────────────────────────── */
  /* Each banner states a count and then hands over the exact set it counted.
     A degraded workflow must be impossible to miss and impossible to lose. */
  let focusHealth = () => {};
  let focusLog = () => {};

  if (degraded.length) {
    /* rows are already worst-first, so the first degraded entry is the one with
       the lowest 30-day success rate. */
    const worst = degraded[0];
    const wr = rate30(worst);
    const b = el('div', 'banner hot');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">error</span>
      <div style="flex:1">
        <strong>${num(degraded.length)} workflow${degraded.length === 1 ? ' is' : 's are'} degraded right now.</strong>
        ${esc(worst.name || 'One workflow')} is the worst of them${wr == null ? '' : ` at ${esc(pct(wr))} success`}
        over the last 30 days — ${num(n0(worst.failures_30d) || 0)} of ${num(n0(worst.runs_30d) || 0)} logged run${(n0(worst.runs_30d) || 0) === 1 ? '' : 's'} failed${
          worst.last_failure ? `, most recently ${esc(ago(worst.last_failure))}` : ''}.
      </div>
      <button class="btn sm" id="aShowDegraded">Show ${degraded.length === 1 ? 'it' : 'them'}</button>`;
    banners.appendChild(b);
    b.querySelector('#aShowDegraded').addEventListener('click', () => focusHealth('DEGRADED'));
  } else if (health && rows.length && rows.some(w => w.writes_audit_log)) {
    const b = el('div', 'banner info');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">check_circle</span>
      <div>No instrumented workflow has failed inside the 30-day window. This statement only covers the
      ${num(rows.filter(w => w.writes_audit_log).length)} of ${num(rows.length)} workflows that write to audit_log.</div>`;
    banners.appendChild(b);
  }

  if (blind.length) {
    const b = el('div', 'banner warm');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">visibility_off</span>
      <div style="flex:1"><strong>${num(blind.length)} workflow${blind.length === 1 ? '' : 's'} write${blind.length === 1 ? 's' : ''} nothing to audit_log.</strong>
      ${blind.length === 1 ? 'It' : 'They'} may be running perfectly or failing every time — the dashboard cannot tell, because there is no Audit Log node to read.
      Adding one inside n8n is the only thing that closes this gap.</div>
      <button class="btn sm" id="aShowBlind">Show ${blind.length === 1 ? 'it' : 'them'}</button>`;
    banners.appendChild(b);
    b.querySelector('#aShowBlind').addEventListener('click', () => focusHealth('NOT_INSTRUMENTED'));
  }

  /* Not a warning. These are request/response endpoints: the caller is told the
     outcome in the reply, so the absence of an audit row is the design. The
     banner still names the one thing it costs — no history — rather than
     presenting it as free. */
  if (byDesign.length) {
    const one = byDesign.length === 1;
    const names = byDesign.map(w => w.name).filter(Boolean);
    const b = el('div', 'banner info');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">sync_alt</span>
      <div style="flex:1"><strong>${num(byDesign.length)} workflow${one ? '' : 's'} answer${one ? 's' : ''} the caller instead of writing to audit_log.</strong>
      ${names.length ? `${esc(names.join(', '))} ${names.length === 1 ? 'is' : 'are'}` : `${one ? 'It is' : 'They are'}`} called by the dashboard and read on the spot,
      so ${one ? 'the' : 'each'} outcome is shown by the screen that made the call. For a request/response endpoint that is the right design,
      so ${one ? 'it is' : 'they are'} not counted as a blind spot above. It does mean no run history is kept here — this screen cannot tell you
      how ${one ? 'it' : 'they'} behaved yesterday, only the calling screen can, as it happens.</div>
      <button class="btn sm" id="aShowByDesign">Show ${one ? 'it' : 'them'}</button>`;
    banners.appendChild(b);
    b.querySelector('#aShowByDesign').addEventListener('click', () => focusHealth('RETURNS_RESULT'));
  }

  /* Names that show up in audit_log but match no registered workflow. Those runs
     are real work nobody is holding a health record for, and the count above
     silently excludes them. */
  if (audit && rows.length) {
    const known = new Set();
    rows.forEach(w => namesFor(w).forEach(n => known.add(n)));
    const orphans = [...new Set((audit || []).map(a => a.workflow).filter(w => w && !known.has(low(w))))];
    if (orphans.length) {
      const b = el('div', 'banner warm');
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">help</span>
        <div style="flex:1"><strong>${num(orphans.length)} name${orphans.length === 1 ? '' : 's'} in the activity log match no registered workflow.</strong>
        ${esc(orphans.slice(0, 4).join(', '))}${orphans.length > 4 ? ` and ${orphans.length - 4} more` : ''}.
        Runs logged under ${orphans.length === 1 ? 'that name' : 'those names'} are not counted in any health figure above until
        workflow_registry records ${orphans.length === 1 ? 'it' : 'them'} as an audit_name or alias.</div>`;
      banners.appendChild(b);
    }
  }

  if (!registry) {
    const b = el('div', 'banner warm');
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">warning</span>
      <div>workflow_registry could not be read (${esc(regR.status === 'rejected' ? (regR.reason?.message || 'Unknown error') : 'no rows')}),
      so a workflow's run history is matched on its display name alone. A workflow that logs under an alias will look quieter than it is.</div>`;
    banners.appendChild(b);
  }

  /* ── Workflow health, grouped by category ──────────────────────────────── */
  if (!health) {
    healthCard.innerHTML = `<div class="card-head"><div><div class="card-title">Workflow health</div></div></div>
      ${stateError('workflow health', healthErr)}`;
  } else if (!rows.length) {
    healthCard.innerHTML = `<div class="card-head"><div><div class="card-title">Workflow health</div></div></div>
      ${stateEmpty('No workflows registered', 'workflow_registry is empty, so v_workflow_health has nothing to report.', 'account_tree')}`;
  } else {
    const f = { health: 'ALL', q: '' };
    const hCount = k => rows.filter(w => stateKey(w) === k).length;
    const segs = [['ALL', rows.length], ['DEGRADED', hCount('DEGRADED')], ['HEALTHY', hCount('HEALTHY')],
                  ['NEVER_RAN', hCount('NEVER_RAN')], ['NOT_INSTRUMENTED', hCount('NOT_INSTRUMENTED')],
                  ['RETURNS_RESULT', hCount('RETURNS_RESULT')]]
      .filter(([k, c]) => k === 'ALL' || c > 0);

    healthCard.innerHTML = `<div class="card-head"><div>
        <div class="card-title">Workflow health by category</div>
        <div class="card-sub">Headline figures are the rolling 30-day window from <span class="mono">v_workflow_health</span>; all-time totals sit underneath as context. Click a workflow for its full record and recent runs.</div>
      </div></div>
      <div class="toolbar">
        <div class="seg" id="aSegHealth" role="group" aria-label="Filter workflows by health">
          ${segs.map(([k, c], i) => `<button data-h="${esc(k)}" class="${i === 0 ? 'on' : ''}">${
            k === 'ALL' ? 'All' : esc(STATES[k] ? STATES[k].label : k)} · ${num(c)}</button>`).join('')}
        </div>
        <div class="grow"><input type="search" id="aWfQ" aria-label="Search workflows"
          placeholder="Search workflow, category, trigger or description" /></div>
        <div class="t-muted num" id="aWfCount"></div>
      </div>
      <div id="aWfList"></div>`;

    const listHost = healthCard.querySelector('#aWfList');
    const countEl = healthCard.querySelector('#aWfCount');

    const visible = () => {
      const q = f.q.trim().toLowerCase();
      return rows.filter(w => {
        if (f.health !== 'ALL' && stateKey(w) !== f.health) return false;
        if (!q) return true;
        return [w.name, w.category, w.trigger_type, w.trigger_detail, w.description, healthLabel(w)]
          .some(v => low(v).includes(q));
      });
    };

    const wfRow = (w, i) => {
      const h = healthOf(w);
      const r30 = rate30(w), rAll = rateAll(w);
      const runs30 = n0(w.runs_30d), fails30 = n0(w.failures_30d);
      const t = triggerState(w);
      const answers = respondsToCaller(w) ? callerInfo(w) : null;
      return `<div class="list-item" data-wf="${i}" role="button" tabindex="0"
        aria-label="Open ${esc(w.name || 'workflow')} — ${esc(healthLabel(w))}" style="align-items:flex-start">
        <span class="material-symbols-outlined ${h.tone === 'hot' ? 't-hot' : h.tone === 'ok' ? 't-ok' : 't-muted'}"
          style="margin-top:2px">${esc(h.icon)}</span>
        <div style="flex:1;min-width:0">
          <div class="wf-head">
            <span style="font-weight:500">${esc(w.name || 'Unnamed workflow')}</span>
            ${pill(healthLabel(w), h.tone || undefined)}
            ${w.is_active === false ? pill('Inactive', 'warm') : ''}
            <span class="chip">${esc(w.trigger_type || 'trigger not recorded')}${w.trigger_detail ? ' · ' + esc(w.trigger_detail) : ''}</span>
          </div>
          <div class="cell-sub" style="margin-top:4px;white-space:normal">${esc(w.description || 'No description in workflow_registry.')}</div>
          ${runBar(w)}
          <div class="cell-sub" style="margin-top:6px;white-space:normal">
            ${runs30 == null || runs30 === 0
              ? (w.writes_audit_log
                  ? 'No runs logged in the last 30 days.'
                  : answers
                    ? `Answers its caller in the reply instead of logging, so there is no run count here by design — ${esc(answers.where)} reports each call as it happens.`
                    : 'Not instrumented — nothing reaches audit_log, so no run can be counted.')
              : `${num(runs30)} run${runs30 === 1 ? '' : 's'} in the window · ${
                  fails30 ? `<span class="t-hot">${num(fails30)} failed</span>` : 'none failed'}`}
            ${w.runs ? ` · <span class="t-muted">all-time ${num(w.runs)} run${(n0(w.runs) || 0) === 1 ? '' : 's'}, ${num(n0(w.failures) || 0)} failed${rAll == null ? '' : ` (${pct(rAll)})`}</span>` : ''}
          </div>
          ${w.last_failure ? `<div class="cell-sub t-hot" style="margin-top:2px">Last failure ${esc(ago(w.last_failure))}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0;display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          <div class="num" style="font-weight:500;font-size:16px"
            ><span class="${r30 == null ? 't-muted' : fails30 ? 't-hot' : 't-ok'}">${r30 == null ? '—' : esc(pct(r30))}</span></div>
          <div class="cell-sub">${r30 == null ? (answers ? 'no rate kept here' : 'no 30-day rate') : '30-day success'}</div>
          <div class="cell-sub">${w.last_run
            ? 'ran ' + esc(ago(w.last_run))
            : (answers ? 'no run log kept' : 'never logged a run')}</div>
          <button class="btn sm" data-run="${i}" ${t.can ? '' : 'disabled'}
            aria-label="${esc(t.label)} — ${esc(w.name || 'workflow')}"
            title="${esc(t.can ? `POSTs to the ${t.hook} webhook with your session token.` : t.why)}">${esc(t.label)}</button>
        </div>
      </div>`;
    };

    function drawWf() {
      const vis = visible();
      countEl.textContent = `${vis.length} of ${rows.length}`;
      if (!vis.length) {
        listHost.innerHTML = stateEmpty('No workflow matches these filters',
          'Clear the search or pick another health state.', 'filter_alt_off');
        return;
      }
      /* Grouped by category, categories ordered by the worst workflow inside
         them so the section that needs attention is the one you land on. */
      const groups = new Map();
      vis.forEach(w => {
        const k = w.category || 'Uncategorised';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(w);
      });
      const ordered = [...groups.entries()].sort((a, b) =>
        (Math.min(...a[1].map(w => healthOf(w).rank)) - Math.min(...b[1].map(w => healthOf(w).rank)))
        || a[0].localeCompare(b[0]));

      listHost.innerHTML = ordered.map(([cat, list]) => {
        const bad = list.filter(w => up(w.health) === 'DEGRADED').length;
        const catRuns = list.reduce((a, w) => a + (n0(w.runs_30d) || 0), 0);
        const catFails = list.reduce((a, w) => a + (n0(w.failures_30d) || 0), 0);
        const cr = rateOf(catRuns, catFails);
        return `<div class="toolbar" style="background:var(--surface-sunken)">
            <div class="label-caps" style="flex:1">${esc(cat)}</div>
            ${bad ? pill(`${bad} degraded`, 'hot') : ''}
            <span class="cell-sub">${list.length} workflow${list.length === 1 ? '' : 's'}${
              catRuns ? ` · ${num(catRuns)} run${catRuns === 1 ? '' : 's'} in 30 days · ${esc(pct(cr))} success` : ' · no runs logged in 30 days'}</span>
          </div>
          ${list.map(w => wfRow(w, rows.indexOf(w))).join('')}`;
      }).join('');

      listHost.querySelectorAll('[data-wf]').forEach(node => {
        const open = () => openWorkflow(rows[Number(node.dataset.wf)]);
        node.addEventListener('click', ev => {
          if (ev.target.closest('[data-run]')) return;
          open();
        });
        /* The row is a div because it carries a nested button, and a button
           inside a button is invalid. Giving it the button role without the key
           handling would announce it as operable to a screen reader and then
           ignore every keystroke, which is worse than leaving it a div. */
        node.addEventListener('keydown', ev => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          if (ev.target.closest('[data-run]')) return;
          ev.preventDefault();
          open();
        });
      });
      listHost.querySelectorAll('[data-run]').forEach(btn => {
        btn.addEventListener('click', ev => {
          ev.stopPropagation();
          confirmRun(rows[Number(btn.dataset.run)]);
        });
      });
    }

    healthCard.querySelectorAll('#aSegHealth button').forEach(b => b.addEventListener('click', () => {
      healthCard.querySelectorAll('#aSegHealth button').forEach(x => x.classList.toggle('on', x === b));
      f.health = b.dataset.h; drawWf();
    }));
    healthCard.querySelector('#aWfQ').addEventListener('input', e => { f.q = e.target.value; drawWf(); });

    /* Banner hand-off. The search box is cleared on purpose: a leftover query
       silently hiding half the set the banner just counted is the drift this
       exists to prevent. */
    focusHealth = state => {
      f.health = state; f.q = '';
      healthCard.querySelector('#aWfQ').value = '';
      healthCard.querySelectorAll('#aSegHealth button').forEach(x => x.classList.toggle('on', x.dataset.h === state));
      drawWf();
      healthCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    drawWf();
  }

  /* ── One workflow, in full ─────────────────────────────────────────────── */
  function openWorkflow(w) {
    if (!w) return;
    const h = healthOf(w);
    const r30 = rate30(w), rAll = rateAll(w);
    const viewRate = n0(w.success_rate);
    /* Cross-check rather than trust. If the view's success_rate ever stops
       agreeing with runs_30d/failures_30d the window behind it has moved, and
       the reader is told instead of being handed the wrong denominator. */
    const drift = (viewRate != null && r30 != null && Math.abs(viewRate - r30) > 0.6);
    const t = triggerState(w);
    const history = auditFor(w);
    const known = registry ? 'workflow_registry aliases' : 'the display name only';
    const answers = respondsToCaller(w) ? callerInfo(w) : null;

    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1">
          <h2 style="font-size:18px">${esc(w.name || 'Unnamed workflow')}</h2>
          <div class="cell-sub">${esc(w.category || 'Uncategorised')} · ${esc(w.trigger_type || 'trigger not recorded')}${
            w.trigger_detail ? ' · ' + esc(w.trigger_detail) : ''}</div>
          <div class="cell-sub mono">${esc(w.id ?? '')}</div>
        </div>
        <button class="btn ghost sm" id="aClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        <div class="section">
          <div class="label-caps">Health</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
            ${pill(healthLabel(w), h.tone || undefined)}
            ${w.is_active === false ? pill('Inactive', 'warm') : pill('Active', 'ok')}
            ${w.writes_audit_log ? '' : (answers ? pill('Answers the caller', 'cold') : pill('No audit node', 'warm'))}
          </div>
          <div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(h.detail)}</div>
          ${answers ? `<div class="cell-sub" style="margin-top:8px;white-space:normal">It replies with <span class="mono">${esc(answers.answer)}</span>. ${esc(answers.line)}</div>` : ''}
          ${w.description ? `<div class="quote" style="margin-top:12px">${esc(w.description)}</div>` : ''}
        </div>

        <div class="section">
          <div class="label-caps">Last 30 days</div>
          ${runBar(w) || `<div class="cell-sub" style="margin-top:8px;white-space:normal">${
            answers
              ? 'Nothing is logged for this endpoint at all, so there is no bar to draw and the figures below stay empty. That is expected here — it is not evidence that it did or did not run.'
              : 'Nothing logged in the window, so there is no bar to draw.'}</div>`}
          <dl class="kv" style="margin-top:12px">
            <dt>Runs</dt><dd class="num">${w.runs_30d == null ? '<span class="t-muted">—</span>' : num(w.runs_30d)}</dd>
            <dt>Failures</dt><dd class="num ${n0(w.failures_30d) ? 't-hot' : ''}">${w.failures_30d == null ? '<span class="t-muted">—</span>' : num(w.failures_30d)}</dd>
            <dt>Success rate</dt><dd class="num">${r30 == null ? '<span class="t-muted">no runs to divide by</span>' : esc(pct(r30))}</dd>
            <dt>Last failure</dt><dd>${w.last_failure ? `<span class="t-hot">${esc(ago(w.last_failure))}</span>` : '<span class="t-muted">none recorded</span>'}</dd>
          </dl>
          ${drift ? `<div class="banner warm" style="margin-top:12px"><span class="material-symbols-outlined">warning</span>
            <div>The view reports <span class="mono">success_rate</span> ${esc(pct(viewRate))}, but ${esc(pct(r30))} is what
            <span class="mono">runs_30d</span> and <span class="mono">failures_30d</span> divide out to. The headline above uses the two count
            columns, whose window is documented. Treat the difference as a signal that the view's window has moved.</div></div>` : ''}
        </div>

        <div class="section">
          <div class="label-caps">All time</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Runs</dt><dd class="num">${w.runs == null ? '<span class="t-muted">—</span>' : num(w.runs)}</dd>
            <dt>Failures</dt><dd class="num">${w.failures == null ? '<span class="t-muted">—</span>' : num(w.failures)}</dd>
            <dt>Escalations</dt><dd class="num">${w.escalations == null ? '<span class="t-muted">—</span>' : num(w.escalations)}</dd>
            <dt>Success rate</dt><dd class="num">${rAll == null ? '<span class="t-muted">no runs to divide by</span>' : esc(pct(rAll))}</dd>
            <dt>success_rate (view)</dt><dd class="num">${viewRate == null ? '<span class="t-muted">null</span>' : esc(pct(viewRate))}</dd>
            <dt>Last run</dt><dd>${w.last_run ? esc(ago(w.last_run)) : '<span class="t-muted">never logged</span>'}</dd>
          </dl>
          <div class="cell-sub" style="margin-top:8px;white-space:normal">All-time counts start from the day each workflow gained an Audit Log node, not from the day it was built, so they understate anything older than instrumentation.</div>
        </div>

        <div class="section">
          <div class="label-caps">Recent logged runs</div>
          ${auditErr
            ? stateError('this workflow’s run history', auditErr)
            : history.length
              ? `<div class="timeline" style="margin-top:8px">${history.slice(0, 25).map(a => `
                  <div class="tl-item">
                    <span class="tl-dot" style="background:var(--${up(a.status) === 'FAILED' || up(a.status) === 'REJECTED' ? 'hot' : up(a.status) === 'ESCALATED' ? 'warm' : 'ok'})"></span>
                    <div class="tl-body">
                      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                        ${pill(a.status || 'LOGGED')}
                        <span class="cell-sub">${esc(ago(a.logged_at))}</span>
                        ${a.lead_name ? `<span class="chip">${esc(a.lead_name)}</span>` : ''}
                      </div>
                      <div class="tl-meta" style="white-space:normal">${esc(String(a.summary || 'No summary written.').slice(0, 240))}</div>
                    </div>
                  </div>`).join('')}</div>
                 <div class="cell-sub" style="margin-top:10px;white-space:normal">${num(history.length)} run${history.length === 1 ? '' : 's'} for this workflow inside the ${num(AUDIT_LIMIT)} most recent audit rows, matched on ${esc(known)}.</div>`
              : (w.writes_audit_log
                  ? stateEmpty('No runs in the loaded window',
                      `This workflow writes to audit_log but none of the ${AUDIT_LIMIT} most recent rows belong to it.`, 'history')
                  : answers
                    ? stateEmpty('No history, by design',
                        `This endpoint returns its result to whoever called it rather than logging, so it will never appear in the activity log. ${answers.where} shows the outcome of each call at the moment it is made; nothing is retained for it here, and this screen cannot say how it has been behaving.`, 'sync_alt')
                    : stateEmpty('Not instrumented',
                        'This workflow has no Audit Log node, so it will never appear in the activity log no matter how often it runs.', 'visibility_off'))}
        </div>
      </div>
      <div class="drawer-foot">
        <button class="btn primary" id="aRunDrawer" ${t.can ? '' : 'disabled'}
          title="${esc(t.can ? `POSTs to the ${t.hook} webhook with your session token.` : t.why)}">${esc(t.label)}</button>
        ${t.hook && !t.can && SUBJECT_SCREEN[t.hook]
          ? `<button class="btn" id="aGoSubject">Open ${esc(SUBJECT_SCREEN[t.hook].title)}</button>`
          : ''}
      </div>`);
    $('aClose').addEventListener('click', closeDrawer);
    if (t.can) $('aRunDrawer').addEventListener('click', () => confirmRun(w));
    if (t.hook && !t.can && SUBJECT_SCREEN[t.hook]) {
      $('aGoSubject').addEventListener('click', () => go(SUBJECT_SCREEN[t.hook].id));
    }
  }

  /* ── Firing a workflow by hand ─────────────────────────────────────────── */
  /* The dialog names the exact path and the exact body before the irreversible
     click, and afterwards it says plainly that nothing on this screen will move
     until the workflow writes an audit row — a confirmation that implied the
     list had updated would be the same kind of lie this rebuild removed. */
  function confirmRun(w) {
    const t = triggerState(w);
    if (!t.can) return;
    const m = openModal(`${t.label} — ${w.name || 'workflow'}`, `
      <div class="banner info">
        <span class="material-symbols-outlined">bolt</span>
        <div>This posts to <span class="mono">/webhook/${esc(t.hook)}</span> with your Supabase session token attached.
        The workflow decides what it does with an empty body; the dashboard does not choose records for it.</div>
      </div>
      <dl class="kv">
        <dt>Workflow</dt><dd>${esc(w.name || '—')}</dd>
        <dt>Category</dt><dd>${esc(w.category || 'Uncategorised')}</dd>
        <dt>Webhook</dt><dd class="mono">${esc(t.hook)}</dd>
        <dt>Body</dt><dd class="mono">{}</dd>
        <dt>Last run</dt><dd>${w.last_run ? esc(ago(w.last_run)) : 'never logged'}</dd>
        <dt>30-day health</dt><dd>${esc(healthLabel(w))}</dd>
      </dl>
      <div class="cell-sub" style="margin-top:12px;white-space:normal">
        The counts on this screen come from audit_log. They will not change until the workflow writes a row and the screen is reloaded.
      </div>`,
      `<button class="btn primary" id="aGo">${esc(t.label)}</button>
       <button class="btn ghost" id="aCancel">Cancel</button>`);

    m.wrap.querySelector('#aCancel').addEventListener('click', m.close);
    m.wrap.querySelector('#aGo').addEventListener('click', async ev => {
      const btn = ev.currentTarget;
      btn.disabled = true; btn.textContent = 'Running…';
      m.msg('<span class="t-muted">Waiting for the workflow to answer…</span>');
      try {
        const res = await n8n(t.hook, {});
        const line = res && typeof res === 'object'
          ? String(res.message || res.status || res.raw || 'accepted')
          : 'accepted';
        m.msg(`<span class="t-ok">${esc(t.hook)} answered: ${esc(String(line).slice(0, 200))}</span>
          <div class="cell-sub" style="margin-top:6px">Reload this screen once the workflow has written its audit row to see the counts move.</div>`);
        btn.textContent = 'Ran';
      } catch (e) {
        modalError(m, e);
        btn.disabled = false; btn.textContent = t.label;
      }
    });
  }

  /* ── Activity log ──────────────────────────────────────────────────────── */
  if (!audit) {
    logCard.innerHTML = `<div class="card-head"><div><div class="card-title">Activity log</div></div></div>
      ${stateError('the activity log', auditErr)}`;
  } else {
    const STATUSES = ['SUCCESS', 'FAILED', 'REJECTED', 'ESCALATED'];
    const sCount = s => audit.filter(a => up(a.status) === s).length;
    const other = audit.filter(a => a.status && !STATUSES.includes(up(a.status))).length;
    const unset = audit.filter(a => !a.status).length;
    const failedCount = sCount('FAILED');

    const wfNames = [...new Set(audit.map(a => a.workflow).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b)));

    const segs = [['ALL', audit.length], ...STATUSES.map(s => [s, sCount(s)]).filter(([, c]) => c > 0)];
    if (other) segs.push(['OTHER', other]);
    if (unset) segs.push(['NONE', unset]);

    const lf = { status: 'ALL', wf: 'ALL', q: '' };

    logCard.innerHTML = `<div class="card-head"><div>
        <div class="card-title">Activity log</div>
        <div class="card-sub">Every row <span class="mono">audit_log</span> holds for the ${num(AUDIT_LIMIT)} most recent runs, newest first.${
          auditCapped ? ` <span class="t-warm">This read is capped at ${num(AUDIT_LIMIT)} rows, so anything older is not on this page.</span>` : ''}</div>
      </div></div>
      <div class="toolbar">
        <div class="seg" id="aSegStatus" role="group" aria-label="Filter runs by status">
          ${segs.map(([k, c], i) => `<button data-s="${esc(k)}" class="${i === 0 ? 'on' : ''}">${
            k === 'ALL' ? 'All' : k === 'OTHER' ? 'Other' : k === 'NONE' ? 'No status' : esc(k)} · ${num(c)}</button>`).join('')}
        </div>
        <div class="grow"><input type="search" id="aLogQ" aria-label="Search the activity log"
          placeholder="Search workflow, customer, intent or summary" /></div>
        <select id="aLogWf" aria-label="Filter runs by workflow" style="width:auto">
          <option value="ALL">All workflows · ${num(audit.length)}</option>
          ${wfNames.map(n => `<option value="${esc(n)}">${esc(n)} · ${num(audit.filter(a => a.workflow === n).length)}</option>`).join('')}
        </select>
        <div class="t-muted num" id="aLogCount"></div>
      </div>
      <div id="aLogTable"></div>`;

    const isBad = a => ['FAILED', 'REJECTED'].includes(up(a.status));

    const cols = [
      { label: 'Logged', render: a => `<span class="mono t-muted">${esc(clock(a.logged_at))}</span>
          <div class="cell-sub">${esc(ago(a.logged_at))}</div>` },
      { label: 'Status', render: a => a.status
          ? `${pill(a.status)}${isBad(a) ? '<div class="cell-sub t-hot">Needs investigation</div>' : ''}`
          : '<span class="t-muted">No status written</span>' },
      { label: 'Workflow', strong: true, render: a => `${esc(a.workflow || 'Unnamed')}
          ${a.intent ? `<div class="cell-sub">${esc(a.intent)}</div>` : ''}` },
      { label: 'Customer', render: a => a.lead_name || a.lead_email
          ? `${esc(a.lead_name || '—')}<div class="cell-sub">${esc(a.lead_email || 'no email on the row')}</div>`
          : '<span class="t-muted">Not a per-customer run</span>' },
      { label: 'Score', align: 'r', render: a => n0(a.lead_score) == null ? '<span class="t-muted">—</span>' : num(a.lead_score) },
      { label: 'Summary', render: a => a.summary
          ? `<span class="${isBad(a) ? 't-hot' : ''}" style="white-space:normal">${esc(String(a.summary).slice(0, 200))}</span>`
          : '<span class="t-muted">No summary written</span>' },
    ];

    const th = logCard.querySelector('#aLogTable');
    const cnt = logCard.querySelector('#aLogCount');

    const visibleLog = () => {
      const q = lf.q.trim().toLowerCase();
      return audit.filter(a => {
        if (lf.status === 'NONE') { if (a.status) return false; }
        else if (lf.status === 'OTHER') { if (!a.status || STATUSES.includes(up(a.status))) return false; }
        else if (lf.status !== 'ALL' && up(a.status) !== lf.status) return false;
        if (lf.wf !== 'ALL' && a.workflow !== lf.wf) return false;
        if (!q) return true;
        return [a.workflow, a.lead_name, a.lead_email, a.intent, a.summary, a.status]
          .some(v => low(v).includes(q));
      });
    };

    function drawLog() {
      if (!audit.length) {
        cnt.textContent = '';
        th.innerHTML = stateEmpty('No runs logged yet',
          'Only workflows with an Audit Log node write here. Until one runs, this stays empty — an empty log is not evidence that nothing ran.', 'receipt_long');
        return;
      }
      const vis = visibleLog();
      cnt.textContent = `${vis.length} of ${audit.length}`;
      th.innerHTML = table(cols, vis, {
        onRow: true,
        empty: stateEmpty('No run matches these filters',
          'Clear the search or pick another status or workflow.', 'filter_alt_off'),
      });
      wireRows(th, vis, openRun);
    }

    logCard.querySelectorAll('#aSegStatus button').forEach(b => b.addEventListener('click', () => {
      logCard.querySelectorAll('#aSegStatus button').forEach(x => x.classList.toggle('on', x === b));
      lf.status = b.dataset.s; drawLog();
    }));
    logCard.querySelector('#aLogQ').addEventListener('input', e => { lf.q = e.target.value; drawLog(); });
    logCard.querySelector('#aLogWf').addEventListener('change', e => { lf.wf = e.target.value; drawLog(); });

    focusLog = (status = 'ALL', wf = 'ALL') => {
      lf.status = status; lf.wf = wf; lf.q = '';
      logCard.querySelector('#aLogQ').value = '';
      logCard.querySelector('#aLogWf').value = wf;
      logCard.querySelectorAll('#aSegStatus button').forEach(x => x.classList.toggle('on', x.dataset.s === status));
      drawLog();
      logCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    /* The failure banner is placed after the log is wired so its button can hand
       over a filter that really exists. Its count is the failures actually
       loaded here, which is a narrower claim than the 30-day KPI above and is
       worded that way. */
    if (failedCount) {
      const b = el('div', 'banner hot');
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">report</span>
        <div style="flex:1"><strong>${num(failedCount)} logged run${failedCount === 1 ? '' : 's'} failed.</strong>
        Counted across the ${num(audit.length)} most recent audit rows loaded here, not the 30-day window used by the health figures above.</div>
        <button class="btn sm" id="aShowFailed">Show failed runs</button>`;
      banners.appendChild(b);
      b.querySelector('#aShowFailed').addEventListener('click', () => focusLog('FAILED'));
    }

    drawLog();
  }

  /* ── Integration probes ────────────────────────────────────────────────── */
  /* Real probes only. A hardcoded green dot next to a dead WhatsApp session is
     the one component on this screen that can cause a worse outcome than having
     no screen at all. Anything we cannot probe says so. */
  intg.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Integration status</div><div id="intgRow">${stateLoading(1)}</div>`;
  renderIntegrations($('intgRow'));

  /* ── One logged run, in full ───────────────────────────────────────────── */
  function openRun(a) {
    if (!a) return;
    const bad = ['FAILED', 'REJECTED'].includes(up(a.status));
    const trace = execUrl(a);
    const wf = (health || []).find(w => namesFor(w).has(low(a.workflow))) || null;
    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1">
          <h2 style="font-size:18px">${esc(a.workflow || 'Unnamed workflow')}</h2>
          <div class="cell-sub">Logged ${esc(ago(a.logged_at))} · ${esc(clock(a.logged_at))}</div>
        </div>
        <button class="btn ghost sm" id="aRunClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        <div class="section">
          <div class="label-caps">Outcome</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
            ${a.status ? pill(a.status) : '<span class="t-muted">No status written</span>'}
            ${a.intent ? `<span class="chip">${esc(a.intent)}</span>` : ''}
          </div>
          <div class="quote" style="margin-top:12px;white-space:pre-wrap">${esc(a.summary || 'The workflow wrote no summary for this run.')}</div>
          ${bad ? `<div class="banner hot" style="margin-top:12px"><span class="material-symbols-outlined">error</span>
            <div>This run did not complete. ${trace
              ? 'The Error Handler recorded the execution\'s own n8n URL in the summary — <b>Open in n8n</b> below goes straight to the stack trace.'
              : 'audit_log records the outcome and the summary above but not the n8n execution id, and this summary carries no execution link either, so the stack trace has to be found in the n8n execution list by timestamp.'}</div></div>` : ''}
        </div>
        <div class="section">
          <div class="label-caps">Subject</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Customer</dt><dd>${a.lead_name ? esc(a.lead_name) : '<span class="t-muted">not a per-customer run</span>'}</dd>
            <dt>Email</dt><dd>${a.lead_email ? esc(a.lead_email) : '<span class="t-muted">—</span>'}</dd>
            <dt>Lead score</dt><dd class="num">${n0(a.lead_score) == null ? '<span class="t-muted">—</span>' : num(a.lead_score)}</dd>
          </dl>
        </div>
        <div class="section">
          <div class="label-caps">Workflow</div>
          ${wf
            ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
                 ${pill(healthLabel(wf), healthOf(wf).tone || undefined)}
                 <span class="chip">${esc(wf.category || 'Uncategorised')}</span>
               </div>
               <div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(wf.description || 'No description in workflow_registry.')}</div>`
            : `<div class="cell-sub" style="margin-top:8px;white-space:normal">No registered workflow claims the name
               <span class="mono">${esc(a.workflow || '')}</span>, so this run is not counted in any health figure on this screen.</div>`}
        </div>
      </div>
      <div class="drawer-foot">
        ${wf ? '<button class="btn" id="aOpenWf">Open workflow</button>' : ''}
        ${trace
          ? `<a class="btn ghost" href="${esc(trace)}" target="_blank" rel="noopener noreferrer">Open in n8n</a>`
          : `<button class="btn ghost" disabled title="This run's summary carries no n8n execution link, and audit_log has no execution_id column. The Error Handler writes the link on failures it catches; runs logged by a workflow's own Audit Log node do not carry one. Adding the execution id to those nodes is what would make this work everywhere.">Open in n8n</button>`}
      </div>`);
    $('aRunClose').addEventListener('click', closeDrawer);
    if (wf) $('aOpenWf').addEventListener('click', () => openWorkflow(wf));
  }
};
