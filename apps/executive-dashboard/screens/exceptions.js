/* NEXUS OS — screens/exceptions.js

   EXCEPTIONS — ◐ PARTIAL in the navigation. Design:
   design/stitch/exceptions-operational-errors-system-health--a98152.html.

   Built 7 Oct 2026 from that export over three things the backend and this app
   already have, and nothing else:

     v_workflow_health    every automation's 30-day outcome counts and the
                          timestamps of its last run, success, failure and
                          half-done run — graded by lib/health.js and by
                          failureState() from screens/overview.js, which is the
                          ONE rule in this app for "failing now / not on its
                          newest run / recovered". Re-used, never restated.
     v_needs_attention    the workflow_failure branch (runs that did not deliver
                          in the last 24 h) and kyc_archive_gap
     runCheck()           lib/integrations.js's two read-only probes — the same
                          ones the topbar health popover runs. They write
                          nothing anywhere, which is why they may run on open.

   HOW THE GROUPS ARE DRAWN, and where the data stops them:
     Critical   failureState() says failing; a probe that did not answer; a KYC
                file that was never archived
     Warning    the newest run is not a success but an earlier one was (stale),
                or the workflow logs a status this system does not define
     Resolved   the newest run there is, is a success — "recovered", read off
                last_success and never off last_run

   WHAT THE EXPORT SHOWS AND THIS SCREEN CANNOT KNOW, said on the screen too:
     · a root cause. The audit log stores each run's outcome and summary, not a
       diagnosis, so "Root cause" says that rather than guessing one;
     · who is affected. Nothing links a workflow run to the customers it would
       have served, so the card names what the workflow is FOR (its catalogue
       description) and no count of people;
     · downtime. A run that is hung right now writes no row at all, so the gap
       shown for a resolved item is "last bad run → next success", and it says so;
     · snoozing and the export's "Export diagnostic log". Neither exists, so
       there is no button for either. */
import { ME, db } from '../lib/data.js';
import { ago, dubaiStamp, esc, n0, num, pct } from '../lib/format.js';
import { healthWords, successRate } from '../lib/health.js';
import { runCheck } from '../lib/integrations.js';
import { SCREENS, go } from '../lib/nav.js';
import { errorState, skeleton, trustFooter } from '../lib/stitch-ui.js';
import { RECOVERY_CAVEAT, STALE_CAVEAT, failureState, runCounts } from './overview.js';

const str = v => String(v == null ? '' : v).trim();
const up = v => str(v).toUpperCase();
const plural = (n, one, many) => (Number(n) === 1 ? one : many);
/* An automation's catalogue name — a workflow, never a customer. */
const wfName = w => str(w && w.name);
const settle = p => p.then(v => ({ v, err: null }), e => ({ v: null, err: e }));
const note = (body, label = 'Read in full') => (body
  ? `<details class="mt-1"><summary class="cursor-pointer list-none inline-flex items-center gap-0.5 font-body-sm text-[11px] text-primary font-medium underline">${esc(label)}<span class="material-symbols-outlined text-xs">expand_more</span></summary>`
    + `<div class="mt-1.5 font-body-sm text-[12px] text-on-surface-variant leading-relaxed space-y-1">${body}</div></details>`
  : '');
/* A duration between two timestamps, in words. Null when either is missing. */
const span = (from, to) => {
  const a = Date.parse(from), b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  const m = Math.round((b - a) / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};

const SEV = {
  critical: { chip: 'font-label-numeric-sm text-label-numeric-sm px-2 py-1 rounded bg-error-container text-error font-bold tracking-wide uppercase shrink-0', word: 'Critical' },
  warning:  { chip: 'font-label-numeric-sm text-label-numeric-sm px-2 py-1 rounded bg-secondary-container text-on-secondary-fixed font-bold tracking-wide uppercase shrink-0', word: 'Warning' },
  resolved: { chip: 'font-label-numeric-sm text-label-numeric-sm px-2 py-1 rounded bg-[#E6F4EF] text-[#157A5B] font-bold tracking-wide uppercase shrink-0', word: 'Resolved' },
};
const TAB = {
  on:  'px-4 py-2 rounded-lg bg-primary-container text-on-primary font-body-md text-body-md font-semibold shadow-sm flex items-center gap-2',
  off: 'px-4 py-2 rounded-lg bg-surface-container-lowest text-on-surface-variant hover:text-on-surface font-body-md text-body-md transition-colors flex items-center gap-2',
};
const TABN = {
  on:  'font-label-numeric-sm text-[10px] px-1.5 rounded bg-surface-container-lowest/20 text-on-primary',
  off: 'font-label-numeric-sm text-[10px] px-1.5 rounded bg-surface-container text-outline',
};
const DOT = { bad: 'w-2 h-2 rounded-full bg-error absolute -left-[14px] top-1', half: 'w-2 h-2 rounded-full bg-[#96570A] absolute -left-[14px] top-1', good: 'w-2 h-2 rounded-full bg-[#157A5B] absolute -left-[14px] top-1', run: 'w-2 h-2 rounded-full bg-outline-variant absolute -left-[14px] top-1' };

SCREENS.exceptions = async host => {
  const readAt = new Date().toISOString();
  const root = document.createElement('div');
  root.className = 'nx-stitch flex flex-col gap-space-md';
  host.appendChild(root);

  root.innerHTML = `<div class="w-full bg-surface-container-lowest rounded-xl px-6 py-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center gap-2">
          <span class="font-table-header text-table-header text-outline tracking-wider uppercase">Operations</span>
          <span class="font-table-header text-table-header text-outline-variant">/</span>
          <span class="font-table-header text-table-header text-primary font-bold tracking-wider uppercase">Exceptions</span>
          <span class="font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-secondary-container text-on-secondary-fixed font-semibold tracking-wide">◐ PARTIAL</span>
        </div>
        <h1 class="font-headline-lg text-headline-lg text-on-surface font-bold tracking-tight">Operational errors &amp; system health</h1>
        <p class="font-body-sm text-body-sm text-on-surface-variant max-w-3xl">What did not run as expected, what it is for, and whether it has run cleanly since — read from the automations' own outcome record and two read-only reachability checks.</p>
      </div>
      <div class="flex flex-col sm:flex-row items-start sm:items-center gap-3 shrink-0">
        <div class="flex items-center gap-2 px-3 py-1.5 rounded bg-surface-container-low">
          <span class="w-2 h-2 rounded-full bg-primary-container"></span>
          <span class="font-label-numeric-sm text-label-numeric-sm text-outline">Last read:</span>
          <span class="font-label-numeric-sm text-label-numeric-sm text-on-surface font-semibold">${esc(dubaiStamp(readAt))}</span>
        </div>
        <button type="button" data-rerun class="flex items-center gap-2 px-3.5 py-1.5 rounded bg-primary-container text-on-primary font-body-md text-body-md font-semibold hover:bg-primary transition-colors shadow-sm"><span class="material-symbols-outlined text-[18px]">stethoscope</span><span>Run health checks again</span></button>
      </div>
    </div>
    <div data-slot="body">${skeleton({ rows: 4 })}</div>
    <div data-slot="footer"></div>`;
  root.querySelector('[data-rerun]').addEventListener('click', () => go('exceptions'));

  const [wh, na, pData, pAuto] = await Promise.all([
    settle(db('v_workflow_health?select=name,category,description,is_active,health,runs_30d,failures_30d,partials_30d,'
      + 'no_result_30d,rejected_30d,escalated_30d,successes_30d,unknown_30d,effective_runs_30d,success_rate_30d,'
      + 'last_run,last_success,last_failure,last_partial,last_incomplete&order=name.asc&limit=200')),
    settle(db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen&limit=200')),
    runCheck('NEXUS data'), runCheck('Automation'),
  ]);
  if (!root.isConnected) return;
  const body = root.querySelector('[data-slot="body"]');
  if (wh.err && na.err) {
    body.innerHTML = errorState({ what: 'the exception register', err: wh.err, retry: 'exceptions' });
    body.querySelector('[data-retry]')?.addEventListener('click', () => go('exceptions'));
    return;
  }

  const flows = wh.err ? [] : (wh.v || []);
  const attn = na.err ? [] : (na.v || []);
  const failing24 = new Map(attn.filter(i => i.kind === 'workflow_failure').map(i => [str(i.title).toLowerCase(), i]));
  const kycGaps = attn.filter(i => i.kind === 'kyc_archive_gap');

  /* ── Build the register ──────────────────────────────────────────────── */
  const items = [];
  const BAD_HEALTH = new Set(['DEGRADED', 'PRODUCING_NOTHING', 'UNKNOWN_OUTCOME']);
  flows.forEach(w => {
    const h = up(w.health);
    const c = runCounts(w);
    const touched = BAD_HEALTH.has(h) || (c.notClean != null && c.notClean > 0) || failing24.has(str(w.name).toLowerCase());
    if (!touched) return;
    const st = failureState(w);
    const group = st.key === 'failing' ? 'critical' : st.key === 'recovered' ? 'resolved' : 'warning';
    items.push({ kind: 'workflow', group, w, st, id: `wf:${str(w.name)}`, title: str(w.name), category: str(w.category) || 'Uncategorised',
      at: w.last_incomplete || w.last_run, recent: failing24.get(str(w.name).toLowerCase()) || null });
  });
  const probes = [['NEXUS data', pData, 'The database behind every screen'], ['Automation', pAuto, 'The automation server that runs every workflow']];
  probes.filter(([, r]) => !r.ok).forEach(([name, r, what]) => items.push({ kind: 'probe', group: 'critical', id: `probe:${name}`,
    title: `${name} did not answer`, category: 'Reachability check', detail: r.detail, what, at: readAt }));
  if (kycGaps.length) {
    items.push({ kind: 'kyc', group: 'critical', id: 'kyc', title: `${num(kycGaps.length)} KYC ${plural(kycGaps.length, 'document was', 'documents were')} never archived`,
      category: 'Compliance archive', n: kycGaps.length, at: kycGaps.map(i => i.at).sort().pop() });
  }
  const unmeasurable = flows.filter(w => ['NOT_INSTRUMENTED', 'NEVER_RAN', 'NO_QUALIFYING_RUNS'].includes(up(w.health)) && w.is_active !== false);
  const ORDER = { critical: 0, warning: 1, resolved: 2 };
  items.sort((a, b) => ORDER[a.group] - ORDER[b.group] || Date.parse(b.at || 0) - Date.parse(a.at || 0));
  const count = g => items.filter(x => x.group === g).length;
  const active = items.filter(x => x.group !== 'resolved');
  const resolved = items.filter(x => x.group === 'resolved');
  const probesOk = probes.filter(([, r]) => r.ok).length;

  const state = { tab: 'active', q: '', sel: (active[0] || resolved[0] || {}).id || null };

  const kpi = (iconBox, iconCls, iconName, label, value, tagHtml) => `<div class="p-3.5 rounded-lg bg-surface-container-lowest shadow-sm flex items-center justify-between gap-2">
    <div class="flex items-center gap-3"><div class="w-10 h-10 rounded-lg ${iconBox} flex items-center justify-center shrink-0"><span class="material-symbols-outlined ${iconCls} text-[20px]">${esc(iconName)}</span></div>
      <div><span class="font-table-header text-table-header uppercase tracking-wider text-outline block">${esc(label)}</span><span class="font-headline-md text-headline-md font-bold text-on-surface">${esc(value)}</span></div></div>${tagHtml}</div>`;
  const kpis = `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
    ${kpi('bg-error-container/50', 'text-error', 'error', 'Critical', `${num(count('critical'))} active`, count('critical') ? '<span class="font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-error-container text-error font-bold">ACT NOW</span>' : '')}
    ${kpi('bg-secondary-container/40', 'text-on-secondary-fixed', 'warning', 'Warning', `${num(count('warning'))} active`, count('warning') ? '<span class="font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-secondary-container text-on-secondary-fixed font-semibold">NOT CLEAN</span>' : '')}
    ${kpi('bg-surface-container-high', 'text-[#157A5B]', 'check_circle', 'Recovered, 30 days', `${num(count('resolved'))} cleared`, '<span class="font-label-numeric-sm text-[10px] px-2 py-0.5 rounded bg-surface-container text-outline font-semibold">NEWEST RUN OK</span>')}
    ${kpi('bg-primary-fixed/50', 'text-primary', 'speed', 'Reachability', `${num(probesOk)} of ${num(probes.length)} answered`, `<span class="font-label-numeric-sm text-label-numeric-sm font-semibold ${probesOk === probes.length ? 'text-primary' : 'text-error'}">${probesOk === probes.length ? 'REACHABLE' : 'CHECK'}</span>`)}
  </div>`;

  const section = (icon, iconCls, label, html) => `<div class="space-y-1"><div class="flex items-center gap-1.5 font-table-header text-table-header uppercase text-outline font-semibold"><span class="material-symbols-outlined text-[14px] ${iconCls}">${esc(icon)}</span><span>${esc(label)}</span></div><div class="font-body-sm text-body-sm text-on-surface leading-relaxed">${html}</div></div>`;
  const goBtn = (id, label, primary) => (SCREENS[id] ? `<button type="button" data-go="${esc(id)}" class="${primary
    ? 'px-3 py-1.5 rounded-lg bg-primary-container text-on-primary font-body-sm text-body-sm font-semibold flex items-center gap-1.5 hover:bg-primary transition-colors'
    : 'px-3 py-1.5 rounded-lg bg-surface-container-high text-on-surface font-body-sm text-body-sm font-semibold flex items-center gap-1.5 hover:bg-surface-container-highest transition-colors'}"><span class="material-symbols-outlined text-[16px]">open_in_new</span><span>${esc(label)}</span></button>` : '');

  const card = x => {
    const s = SEV[x.group];
    let grid = '', foot = '', meta = '';
    if (x.kind === 'workflow') {
      const w = x.w, hw = healthWords(w.health), c = runCounts(w);
      const rate = successRate(w.successes_30d, w.effective_runs_30d);
      meta = `<span class="font-label-numeric-sm text-label-numeric-sm">Last bad run: ${esc(w.last_incomplete ? ago(w.last_incomplete) : 'none recorded')}</span>`
        + (x.recent ? `<span>•</span><span class="font-label-numeric-sm text-label-numeric-sm text-error font-medium">${esc(str(x.recent.detail).split(' · ')[0])}</span>` : '');
      grid = section('troubleshoot', 'text-error', 'What happened', `<span class="font-semibold">${esc(hw.label)}.</span> ${esc(hw.blurb)} <div class="mt-1">${x.st.text}</div>`)
        + section('psychology_alt', 'text-secondary', 'Root cause (why)', '<span class="text-outline">Not recorded. The audit log keeps each run’s outcome and summary, not a diagnosis — the summaries are on Automation.</span>')
        + section('group_off', 'text-on-surface-variant', 'What depends on it', str(w.description) ? esc(str(w.description)) : '<span class="text-outline">The catalogue holds no description for this workflow.</span>')
        + section('play_arrow', 'text-primary', 'Runs in 30 days', c.eff == null || c.eff <= 0
          ? '<span class="text-outline">No run counted toward a rate: every one was refused by design or handed to a person.</span>'
          : esc(`${num(c.succ)} of ${num(c.eff)} qualifying runs succeeded outright (${pct(rate)}); ${num(c.notClean)} did not.`));
      foot = `<span class="font-label-numeric-sm text-label-numeric-sm text-outline">Last success: ${esc(w.last_success ? dubaiStamp(w.last_success) : 'none in the window')}</span>`;
    } else if (x.kind === 'probe') {
      meta = `<span class="font-label-numeric-sm text-label-numeric-sm">Checked: ${esc(dubaiStamp(x.at))}</span>`;
      grid = section('troubleshoot', 'text-error', 'What happened', esc(`The read-only check answered: ${x.detail || 'no reason given'}.`))
        + section('group_off', 'text-on-surface-variant', 'What depends on it', esc(x.what))
        + section('psychology_alt', 'text-secondary', 'Root cause (why)', '<span class="text-outline">Not known from a browser. The check can say it did not answer; it cannot see why.</span>')
        + section('play_arrow', 'text-primary', 'Recommended', esc('Run the checks again; if it stays red, the server needs looking at — that is not something this screen can do.'));
    } else {
      meta = `<span class="font-label-numeric-sm text-label-numeric-sm">Newest: ${esc(x.at ? ago(x.at) : 'no time recorded')}</span>`;
      grid = section('troubleshoot', 'text-error', 'What happened', esc('A real KYC submission was audited and its file was never stored, and it was not purged on schedule. Retention cannot be proven for it.'))
        + section('group_off', 'text-on-surface-variant', 'Who is affected', esc(`${num(x.n)} ${plural(x.n, 'submission', 'submissions')} on the attention list. The people are named on Compliance, behind the privacy setting, not here.`))
        + section('psychology_alt', 'text-secondary', 'Root cause (why)', '<span class="text-outline">Not recorded: the archive step leaves no reason when it does not write the file.</span>')
        + section('play_arrow', 'text-primary', 'Recommended', esc('Re-archiving is NEXUS support’s to do; Compliance lists every row.'));
    }
    const target = x.kind === 'kyc' ? 'compliance' : x.kind === 'probe' ? 'integrations' : 'automation';
    return `<div data-item="${esc(x.id)}" class="bg-surface-container-lowest rounded-xl p-5 shadow-sm space-y-4">
      <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div class="flex items-start gap-3 min-w-0">
          <span class="${s.chip}">${esc(s.word)}</span>
          <div class="min-w-0"><h2 class="font-headline-md text-headline-md font-bold text-on-surface">${esc(x.title)}</h2>
            <div class="flex items-center gap-3 mt-1 font-body-sm text-body-sm text-outline flex-wrap">
              <span class="flex items-center gap-1.5"><span class="material-symbols-outlined text-[16px] text-tertiary-container">hub</span>${esc(x.category)}</span><span>•</span>${meta}
            </div></div>
        </div>
        <button type="button" data-inspect="${esc(x.id)}" class="px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-primary font-body-sm text-body-sm font-semibold transition-colors shrink-0 flex items-center gap-1.5"><span class="material-symbols-outlined text-[16px]">visibility</span><span>Inspect</span></button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 rounded-lg bg-surface-container-low">${grid}</div>
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-2 flex-wrap">${goBtn(target, target === 'automation' ? 'Open Automation' : target === 'compliance' ? 'Open Compliance' : 'Open Integrations', true)}</div>${foot}
      </div></div>`;
  };

  const inspector = x => {
    if (!x) {
      return `<div class="w-full xl:w-96 shrink-0 bg-surface-container-lowest rounded-xl p-5 shadow-sm space-y-3">
        <span class="font-table-header text-table-header uppercase text-outline tracking-wider">Inspector</span>
        <p class="font-body-sm text-body-sm text-on-surface-variant">Nothing is selected. Choose Inspect on an item to see its run chronology here.</p></div>`;
    }
    const s = SEV[x.group];
    let scope = '', chron = '';
    const row = (k, v, cls = 'text-on-surface') => `<div class="flex items-center justify-between gap-2"><span class="font-table-header text-table-header uppercase text-outline">${esc(k)}</span><span class="font-label-numeric-sm text-label-numeric-sm font-semibold ${cls}">${esc(v)}</span></div>`;
    if (x.kind === 'workflow') {
      const w = x.w;
      scope = row('Category', x.category) + row('Health', healthWords(w.health).label, x.group === 'critical' ? 'text-error' : 'text-on-surface')
        + row('Active', w.is_active === false ? 'Switched off' : w.is_active === true ? 'On' : 'Not recorded') + row('Runs, 30 days', num(w.runs_30d));
      const ev = [['Last failure', w.last_failure, 'bad'], ['Last half-done run', w.last_partial, 'half'], ['Last success', w.last_success, 'good'], ['Newest run of any kind', w.last_run, 'run']]
        .filter(([, t]) => t && !Number.isNaN(Date.parse(t))).sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
      chron = ev.length ? ev.map(([label, t, k]) => `<div class="relative pl-3"><span class="${DOT[k]}"></span>
          <div class="font-label-numeric-sm text-label-numeric-sm text-outline">${esc(dubaiStamp(t))}</div>
          <div class="font-body-sm text-body-sm text-on-surface font-medium leading-snug">${esc(label)} · ${esc(ago(t))}</div></div>`).join('')
        : '<p class="font-body-sm text-body-sm text-outline">The view records no time for any run.</p>';
    } else if (x.kind === 'probe') {
      scope = row('Check', x.title.replace(/ did not answer$/, '')) + row('Answer', x.detail || 'none', 'text-error');
      chron = `<div class="relative pl-3"><span class="${DOT.bad}"></span><div class="font-label-numeric-sm text-label-numeric-sm text-outline">${esc(dubaiStamp(x.at))}</div><div class="font-body-sm text-body-sm text-on-surface font-medium">Read-only check did not answer</div></div>`;
    } else {
      scope = row('Category', x.category) + row('Rows', num(x.n), 'text-error');
      chron = '<p class="font-body-sm text-body-sm text-outline">Each row’s audit trail is on Compliance.</p>';
    }
    const target = x.kind === 'kyc' ? 'compliance' : x.kind === 'probe' ? 'integrations' : 'automation';
    return `<div class="w-full xl:w-96 shrink-0 bg-surface-container-lowest rounded-xl p-5 shadow-sm space-y-5 xl:sticky xl:top-4">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0"><span class="font-table-header text-table-header uppercase text-outline tracking-wider">Inspector</span>
          <h3 class="font-headline-md text-headline-md font-bold text-on-surface">${esc(x.title)}</h3></div>
        <span class="${s.chip}">${esc(s.word)}</span></div>
      <div class="p-3 rounded-lg bg-surface-container-low space-y-1.5">${scope}</div>
      <div class="space-y-3"><span class="font-table-header text-table-header uppercase text-outline font-semibold tracking-wider block">Run chronology (Dubai time)</span>
        <div class="space-y-3 relative pl-3.5 border-l-2 border-surface-container-high ml-1">${chron}</div></div>
      ${x.kind === 'workflow' ? `<p class="font-body-sm text-[12px] text-on-surface-variant">${esc(x.group === 'resolved' ? RECOVERY_CAVEAT : x.st.key === 'stale' ? STALE_CAVEAT : 'A run that is hung right now writes no row, so the newest event above is the newest run that finished — not proof nothing is running.')}</p>` : ''}
      <div class="flex flex-col gap-2">${goBtn(target, target === 'automation' ? 'Open Automation — the runs in full' : target === 'compliance' ? 'Open Compliance' : 'Open Integrations', true)}</div>
    </div>`;
  };

  const resolvedTable = () => (resolved.length ? `<div class="bg-surface-container-lowest rounded-xl shadow-sm overflow-hidden"><div class="overflow-x-auto"><table class="w-full text-left">
      <thead><tr class="bg-surface-container-low h-9">
        <th class="px-4 font-table-header text-table-header uppercase text-outline">Recovered automation</th><th class="px-4 font-table-header text-table-header uppercase text-outline">Category</th>
        <th class="px-4 font-table-header text-table-header uppercase text-outline text-right">Last bad run</th><th class="px-4 font-table-header text-table-header uppercase text-outline text-right">Gap to next success</th>
        <th class="px-4 font-table-header text-table-header uppercase text-outline text-right">Succeeded at</th><th class="px-4 font-table-header text-table-header uppercase text-outline text-right">Runs</th></tr></thead>
      <tbody class="divide-y divide-surface-container">${resolved.map(x => `<tr class="h-12 hover:bg-surface-container-low/50 transition-colors">
        <td class="px-4"><div class="flex items-center gap-2.5"><span class="w-2 h-2 rounded-full bg-[#157A5B]"></span><span class="font-body-md text-body-md font-semibold text-on-surface">${esc(x.title)}</span></div></td>
        <td class="px-4"><span class="font-body-sm text-body-sm text-outline">${esc(x.category)}</span></td>
        <td class="px-4 text-right font-label-numeric-sm text-label-numeric-sm text-on-surface-variant">${esc(x.w.last_incomplete ? ago(x.w.last_incomplete) : '—')}</td>
        <td class="px-4 text-right font-label-numeric-sm text-label-numeric-sm text-on-surface-variant">${esc(span(x.w.last_incomplete, x.w.last_success) || '—')}</td>
        <td class="px-4 text-right font-label-numeric-sm text-label-numeric-sm text-on-surface">${esc(dubaiStamp(x.w.last_success))}</td>
        <td class="px-4 text-right">${SCREENS.automation ? '<button type="button" data-go="automation" class="font-body-sm text-body-sm text-primary font-semibold hover:underline">View runs</button>' : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="px-4 py-2 font-body-sm text-[11px] text-outline">"Gap to next success" is the time from the newest run that was not clean to the success after it — not downtime: a run that hangs writes no row, so real downtime cannot be measured here.${note(`<p>${esc(RECOVERY_CAVEAT)}</p>`, 'What "recovered" means')}</div></div>`
    : '<div class="bg-surface-container-lowest rounded-xl shadow-sm p-space-md font-body-sm text-body-sm text-on-surface-variant">No automation in the 30-day window recovered from a bad run. That is either nothing went wrong or nothing has been fixed yet — the active list above says which.</div>');

  const unknowns = `<div class="p-space-md rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest flex items-start gap-space-sm">
      <span class="material-symbols-outlined text-outline text-xl mt-0.5">help</span>
      <div class="font-body-sm text-body-sm text-on-surface-variant space-y-1">
        <div class="font-body-md text-body-md font-bold text-on-surface">What this screen cannot know</div>
        <p>${esc(`${num(unmeasurable.length)} active ${plural(unmeasurable.length, 'automation records', 'automations record')} nothing this screen can grade — never run, not logged, or nothing that qualified — so ${plural(unmeasurable.length, 'it is', 'they are')} absent from the groups above rather than healthy.`)}${unmeasurable.length ? note(`<p>${unmeasurable.map(w => esc(`${wfName(w)} — ${healthWords(w.health).label}`)).join('<br>')}</p>`, 'Which') : ''}</p>
        <p>A run that is hung right now writes no row, so it cannot be told apart from an idle one here.</p>
        <p>Messaging delivery, CRM sync, email delivery, finance calculations and AI answers cannot be checked from a browser without doing real work, so none of them has a reachability check on this screen. Their record is the run history above.</p>
        ${wh.err ? `<p class="text-error">The automation health figures could not be read, so no workflow is listed — not none failing.</p>` : ''}
        ${na.err ? `<p class="text-[#96570A]">The attention list could not be read, so KYC archive gaps and the last-24-hour failure counts are missing.</p>` : ''}
      </div></div>`;

  const render = () => {
    const list = (state.tab === 'active' ? active : resolved).filter(x => !state.q
      || `${x.title} ${x.category}`.toLowerCase().includes(state.q.toLowerCase()));
    const selected = items.find(x => x.id === state.sel) || list[0] || null;
    const tab = (key, label, n) => `<button type="button" data-tab="${key}" class="${state.tab === key ? TAB.on : TAB.off}"><span>${esc(label)}</span><span class="${state.tab === key ? TABN.on : TABN.off}">${esc(num(n))}</span></button>`;
    body.innerHTML = `<div class="flex flex-col gap-space-md">${kpis}
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div class="flex items-center gap-2 flex-wrap">${tab('active', 'Active exceptions', active.length)}${tab('resolved', 'Recovered', resolved.length)}</div>
        <div class="relative"><span class="material-symbols-outlined absolute left-3 top-2.5 text-outline text-[18px]">search</span>
          <input data-q type="text" value="${esc(state.q)}" placeholder="Filter by automation or category…" class="pl-9 pr-4 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant/40 font-body-sm text-body-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary-container w-64 md:w-72"></div>
      </div>
      <div class="flex flex-col xl:flex-row gap-6 items-start">
        <div class="flex-1 w-full space-y-4 min-w-0">${list.length ? list.map(card).join('')
          : `<div class="bg-surface-container-lowest rounded-xl p-5 shadow-sm font-body-md text-body-md text-on-surface">${esc(state.q ? 'Nothing matches that filter.'
            : state.tab === 'active' ? 'Nothing is failing or unclean in the 30-day window, and both reachability checks answered. Read the box below before treating that as an all-clear.'
              : 'No automation recovered from a bad run in the window.')}</div>`}</div>
        ${inspector(selected)}
      </div>
      <div class="space-y-3"><div class="flex items-center gap-2.5"><div class="w-6 h-6 rounded bg-[#E6F4EF] flex items-center justify-center"><span class="material-symbols-outlined text-[#157A5B] text-[16px]">verified</span></div>
        <h3 class="font-headline-md text-headline-md font-bold text-on-surface">Recently recovered</h3>
        <span class="font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded bg-surface-container text-outline font-semibold">${esc(num(resolved.length))} in 30 days</span></div>
        ${resolvedTable()}</div>
      ${unknowns}</div>`;
    body.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); }));
    body.querySelectorAll('[data-inspect]').forEach(b => b.addEventListener('click', () => { state.sel = b.dataset.inspect; render(); }));
    body.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
    const q = body.querySelector('[data-q]');
    q.addEventListener('change', () => { state.q = q.value; render(); });
  };
  render();

  root.querySelector('[data-slot="footer"]').innerHTML = trustFooter({
    source: 'v_workflow_health · v_needs_attention · read-only reachability checks',
    asOf: dubaiStamp(readAt),
    evidence: `${num(flows.length)} automations graded · ${num(items.length)} on this register`,
    actor: ME && ME.name ? ME.name : '',
  });
};
