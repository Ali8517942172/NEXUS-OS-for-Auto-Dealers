/* NEXUS OS — lib/shell.js

   The live parts of the Stitch topbar (index.html), added 7 Oct 2026:

     · the freshness chip   — how long ago the screen on view last read its data
     · the health chip      — and its popover, fed by lib/integrations.js probes
     · the scope menu       — the dealership chip's dropdown (lib/nav.js paints it)
     · the bell             — and the notifications slide-over, fed by the same
                              v_needs_attention snapshot as the sidebar badges
     · search / Ctrl K      — opens lib/command-palette.js
     · ? and the help icon  — the keyboard shortcuts

   Designs: app-shell-master-specification-navigation-hierarchy--2b6343 (the
   bar), app-shell-scope-menu-active-latency-warning--068c5d (scope menu and the
   "Data delayed" chip), app-shell-system-health-popover-active--cb7e59,
   app-shell-notifications-drawer-active--ef7a40.

   THE HONESTY RULES THAT SHAPE IT. A green dot is only ever drawn over a check
   that actually ran and passed in this browser; everything NEXUS cannot check
   from here says "Not tested" and names the screen that can. The bell counts
   exactly the rows lib/badges.js counted — one read, one snapshot — so the bell,
   the drawer and the sidebar can never disagree. Nothing here invents a number:
   before the first read the chips say they are loading. */
import { $ } from './dom.js';
import { LAST, COUNTS } from './badges.js';
import { openCommandPalette } from './command-palette.js';
import { ago, clock, esc } from './format.js';
import { runCheck } from './integrations.js';
import { flatNav, go } from './nav.js';
import { maskText } from './privacy.js';
import { openStitchModal } from './stitch-ui.js';

/* ── Popovers: one open at a time, Escape and an outside click close it ────── */
const POPS = [];
function closePops(except) {
  POPS.forEach(p => { if (p !== except) p.close(); });
}
function popover({ button, panel, onOpen }) {
  const p = {
    open() { closePops(p); panel.classList.remove('hide'); button.setAttribute('aria-expanded', 'true'); onOpen && onOpen(); },
    close() { panel.classList.add('hide'); button.setAttribute('aria-expanded', 'false'); },
    isOpen: () => !panel.classList.contains('hide'),
  };
  button.addEventListener('click', e => { e.stopPropagation(); p.isOpen() ? p.close() : p.open(); });
  POPS.push(p);
  return p;
}

/* ── Freshness ───────────────────────────────────────────────────────────────
   Measured from lib/data.js's `nexus:read` event: the time of the screen's last
   successful read since it was opened, ignoring background reads (the badge
   poller, the health probe). "Data delayed" when the last read of this screen
   failed, or when nothing has been re-read for DELAYED_MS — a screen left open
   on a showroom PC for an hour is an hour old, and the chip says so. Clicking it
   re-renders the screen (app.js wires #refreshBtn). */
const DELAYED_MS = 10 * 60 * 1000;
const FRESH = {
  loading: { cls: 'flex items-center gap-1.5 px-space-sm py-1 rounded bg-surface-container-low text-on-surface-variant font-label-numeric-sm text-label-numeric-sm',
             dot: '<span class="w-2 h-2 rounded-full bg-outline"></span>' },
  fresh:   { cls: 'flex items-center gap-1.5 px-space-sm py-1 rounded bg-surface-container-low text-on-surface-variant font-label-numeric-sm text-label-numeric-sm',
             dot: '<span class="w-2 h-2 rounded-full bg-tertiary animate-pulse"></span>' },
  delayed: { cls: 'flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-secondary-container/40 text-on-secondary-fixed border border-secondary/30 font-label-numeric-sm text-label-numeric-sm',
             dot: '<span class="material-symbols-outlined text-secondary text-[15px] animate-pulse">warning</span>' },
};
const fresh = { okAt: null, failedAt: null, openedAt: null };
/* A screen that has read nothing this long after opening says so, rather than
   "Loading…" for ever (the roadmap screens read nothing at all). */
const QUIET_MS = 4000;
function shortAgo(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}
function paintFreshness() {
  const chip = $('refreshBtn');
  if (!chip) return;
  const now = Date.now();
  let state = 'loading', words = 'Loading…', why = 'This screen has not finished reading its data yet.';
  if (!fresh.okAt && !fresh.failedAt && fresh.openedAt && now - fresh.openedAt > QUIET_MS) {
    words = 'Nothing read';
    why = 'This screen has not read any data since it opened — some screens, such as the roadmap ones, read none.';
  }
  if (fresh.failedAt && (!fresh.okAt || fresh.failedAt > fresh.okAt)) {
    state = 'delayed';
    words = fresh.okAt ? `Data delayed — last read failed, loaded ${shortAgo(now - fresh.okAt)} ago` : 'Data delayed — a read failed';
    why = 'The most recent read for this screen failed, so what is on screen may be out of date. Click to try again.';
  } else if (fresh.okAt && now - fresh.okAt > DELAYED_MS) {
    state = 'delayed';
    words = `Data delayed — loaded ${shortAgo(now - fresh.okAt)} ago`;
    why = 'This screen has not re-read its data for a while. Click to refresh it.';
  } else if (fresh.okAt) {
    state = 'fresh';
    words = `Updated ${shortAgo(now - fresh.okAt)} ago`;
    why = `This screen last read its data at ${clock(new Date(fresh.okAt).toISOString())}. Click to refresh it.`;
  }
  const f = FRESH[state];
  chip.className = f.cls;
  chip.title = why;
  chip.innerHTML = `${f.dot}<span class="${state === 'delayed' ? 'whitespace-nowrap font-semibold tracking-tight' : 'whitespace-nowrap'}">${esc(words)}</span>`;
}
function installFreshness() {
  window.addEventListener('nexus:navigate', () => {
    fresh.okAt = null; fresh.failedAt = null; fresh.openedAt = Date.now(); paintFreshness();
    setTimeout(paintFreshness, QUIET_MS + 100);
  });
  window.addEventListener('nexus:read', e => {
    const d = e.detail || {};
    if (d.background) return;
    if (d.ok) fresh.okAt = d.at; else fresh.failedAt = d.at;
    paintFreshness();
  });
  setInterval(() => { if (!document.hidden) paintFreshness(); }, 5000);
  paintFreshness();
}

/* ── System health ───────────────────────────────────────────────────────────
   Two checks run from the browser — the same two, by name, that the Settings
   and Automation tiles run (lib/integrations.js CHECKS): one indexed read of
   the dealership's data, and a GET on the automation engine's /healthz. Both
   write nothing. Every other row is something this browser cannot check, and it
   says "Not tested" and where it IS checked, rather than borrowing a colour. */
const HEALTH_CHIP = {
  checking: { cls: 'flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-container-low text-on-surface-variant font-label-numeric-sm text-table-header',
              dot: '<span class="w-2 h-2 rounded-full bg-outline"></span>', text: 'text-on-surface-variant font-medium' },
  working:  { cls: 'flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-container-low text-on-surface-variant font-label-numeric-sm text-table-header',
              dot: '<span class="w-2 h-2 rounded-full bg-tertiary"></span>', text: 'text-tertiary font-medium' },
  degraded: { cls: 'flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-container-low text-on-surface-variant font-label-numeric-sm text-table-header',
              dot: '<span class="w-2 h-2 rounded-full bg-secondary animate-ping"></span>', text: 'text-secondary font-medium' },
  down:     { cls: 'flex items-center gap-1 px-1.5 py-0.5 rounded bg-error-container text-on-error-container font-label-numeric-sm text-table-header',
              dot: '<span class="w-2 h-2 rounded-full bg-error animate-ping"></span>', text: 'text-error font-medium' },
};
/* The status words of the popover's rows — health export's five badges. */
const ROW_STATUS = {
  working:      '<span class="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-container text-tertiary font-label-numeric-sm text-table-header font-bold uppercase tracking-wider"><span class="material-symbols-outlined text-[12px]">check_circle</span>Working</span>',
  degraded:     '<span class="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant font-label-numeric-sm text-table-header font-bold uppercase tracking-wider"><span class="material-symbols-outlined text-[12px] text-error">warning</span>Degraded</span>',
  notconnected: '<span class="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-error text-on-error font-label-numeric-sm text-table-header font-bold uppercase tracking-wider"><span class="material-symbols-outlined text-[12px]">cancel</span>Not connected</span>',
  manual:       '<span class="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-container-high text-on-secondary-container font-label-numeric-sm text-table-header font-bold uppercase tracking-wider"><span class="material-symbols-outlined text-[12px]">touch_app</span>Manual</span>',
  nottested:    '<span class="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-variant text-outline font-label-numeric-sm text-table-header font-bold uppercase tracking-wider"><span class="material-symbols-outlined text-[12px]">hourglass_empty</span>Not tested</span>',
  checking:     '<span class="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-variant text-outline font-label-numeric-sm text-table-header font-bold uppercase tracking-wider"><span class="material-symbols-outlined text-[12px]">pending</span>Checking</span>',
};
const OVERALL = {
  checking: { box: 'px-space-md py-2.5 bg-surface-container-low text-on-surface flex items-center justify-between', icon: 'pending', iconCls: 'material-symbols-outlined text-[18px] text-outline', head: 'font-label-numeric-sm text-table-header uppercase tracking-widest font-bold text-outline' },
  partial:  { box: 'px-space-md py-2.5 bg-surface-container-low text-on-surface flex items-center justify-between', icon: 'rule', iconCls: 'material-symbols-outlined text-[18px] text-secondary', head: 'font-label-numeric-sm text-table-header uppercase tracking-widest font-bold text-secondary' },
  degraded: { box: 'px-space-md py-2.5 bg-error-container text-on-error-container flex items-center justify-between', icon: 'warning', iconCls: 'material-symbols-outlined text-[18px] text-error', head: 'font-label-numeric-sm text-table-header uppercase tracking-widest font-bold text-error' },
};
const health = { data: null, automation: null, checkedAt: null, running: false };
const HEALTH_ROWS = () => [
  { key: 'data', icon: 'database', label: 'Your NEXUS data',
    detail: health.data == null ? 'Checking now' : (health.data.ok ? 'One read of your records answered' : 'The read did not answer'),
    status: health.data == null ? 'checking' : (health.data.ok ? 'working' : 'notconnected') },
  { key: 'automation', icon: 'account_tree', label: 'Automation engine',
    detail: health.automation == null ? 'Checked when this panel opens' : (health.automation.ok ? 'The engine answered its health check' : health.automation.detail),
    status: health.automation == null ? 'nottested'
      : (health.automation.ok ? 'working' : (/configured/.test(health.automation.detail) ? 'nottested' : 'degraded')) },
  { key: 'whatsapp', icon: 'chat', label: 'WhatsApp', screen: 'channels',
    detail: 'Not checked from the browser — see Channels', status: 'nottested' },
  { key: 'forms', icon: 'campaign', label: 'Lead forms and ads', screen: 'leadsources',
    detail: 'Not checked from the browser — see Lead Sources', status: 'nottested' },
  { key: 'manual', icon: 'touch_app', label: 'Walk-ins and phone calls', screen: 'recordlead',
    detail: 'Entered by your team on Record a Lead', status: 'manual' },
];
function overallOf() {
  if (health.data == null) return { k: 'checking', head: 'Checking', line: 'Reading your data once to see that it answers' };
  if (!health.data.ok) return { k: 'degraded', head: 'Overall: not connected', line: 'This browser cannot reach your data right now' };
  if (health.automation && !health.automation.ok && !/configured/.test(health.automation.detail))
    return { k: 'degraded', head: 'Overall: degraded', line: 'Your data answers; the automation engine did not' };
  const ran = HEALTH_ROWS().filter(r => r.status === 'working').length;
  return { k: 'partial', head: 'Partly checked', line: `${ran} of ${HEALTH_ROWS().length} checked from here and working; the rest are checked on their own screens` };
}
function paintHealthChip() {
  const btn = $('healthBtn');
  if (!btn) return;
  let k = 'checking', words = 'Checking…', why = 'Checking that this browser can read your data.';
  if (health.data && !health.data.ok) { k = 'down'; words = 'No connection'; why = 'The dashboard cannot reach your data right now, so any screen that loads may be incomplete or empty. Refresh once; if it stays this way, contact NEXUS support.'; }
  else if (health.automation && !health.automation.ok && !/configured/.test(health.automation.detail)) { k = 'degraded'; words = 'Degraded'; why = 'Your data answers, but the automation engine did not answer its health check.'; }
  else if (health.data && health.data.ok) { k = 'working'; words = 'Connected'; why = 'Your data answered a read just now. Open for what was, and was not, checked.'; }
  const c = HEALTH_CHIP[k];
  btn.className = c.cls;
  btn.title = why;
  btn.innerHTML = `${c.dot}<span class="whitespace-nowrap ${c.text}">${esc(words)}</span>`;
}
function paintHealthPop() {
  const pop = $('healthPop');
  if (!pop) return;
  const o = overallOf();
  const oc = OVERALL[o.k];
  pop.innerHTML = `<div class="mt-2 bg-surface-container-lowest rounded-xl shadow-2xl overflow-hidden">
    <div class="p-space-md bg-surface-container-lowest">
      <div class="flex items-start justify-between gap-space-sm">
        <div class="flex flex-col min-w-0">
          <span class="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">System &amp; connectivity health</span>
          <p class="font-body-sm text-body-sm text-outline mt-0.5">${health.checkedAt ? `Checked at ${esc(clock(health.checkedAt))}` : 'Not checked yet'}</p>
        </div>
        <button class="shrink-0 p-1.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface-variant hover:text-primary transition-all flex items-center justify-center" data-health-recheck type="button" title="Check again" aria-label="Check again"${health.running ? ' disabled' : ''}>
          <span class="material-symbols-outlined text-[18px]">cached</span></button>
      </div>
    </div>
    <div class="${oc.box}">
      <div class="flex items-center gap-2">
        <span class="${oc.iconCls}">${oc.icon}</span>
        <div class="flex flex-col">
          <span class="${oc.head}">${esc(o.head)}</span>
          <span class="font-body-sm text-body-sm leading-none">${esc(o.line)}</span>
        </div>
      </div>
    </div>
    <div class="flex flex-col max-h-[380px] overflow-y-auto">
      ${HEALTH_ROWS().map(r => `<div class="p-space-sm hover:bg-surface-container-low/50 transition-colors flex items-start justify-between gap-space-sm">
        <div class="flex items-start gap-space-sm min-w-0">
          <div class="w-8 h-8 rounded bg-surface-container flex items-center justify-center shrink-0 text-primary">
            <span class="material-symbols-outlined text-[18px]">${esc(r.icon)}</span></div>
          <div class="flex flex-col min-w-0">
            <span class="font-body-sm text-body-sm font-semibold text-on-surface truncate">${esc(r.label)}</span>
            ${r.screen
              ? `<a class="font-label-numeric-sm text-label-numeric-sm text-primary hover:underline mt-0.5" href="#${esc(r.screen)}" data-screen-link="${esc(r.screen)}">${esc(r.detail)}</a>`
              : `<span class="font-label-numeric-sm text-label-numeric-sm text-outline mt-0.5">${esc(r.detail)}</span>`}
          </div>
        </div>
        ${ROW_STATUS[r.status]}
      </div>`).join('')}
    </div>
    <div class="p-space-sm bg-surface-container-low flex flex-col gap-2">
      <a class="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-surface-container-lowest hover:bg-surface-container transition-colors font-body-sm text-body-sm font-medium text-primary" href="#settings" data-screen-link="settings">
        <div class="flex items-center gap-2"><span class="material-symbols-outlined text-[18px]">tune</span><span>See every check in Settings</span></div>
        <span class="material-symbols-outlined text-[16px]">arrow_forward</span></a>
    </div>
  </div>`;
  pop.querySelector('[data-health-recheck]')?.addEventListener('click', () => runHealth(true));
}
async function runHealth(withAutomation) {
  if (health.running) return;
  health.running = true;
  paintHealthPop();
  const jobs = [runCheck('NEXUS data').then(r => { health.data = r; })];
  if (withAutomation) jobs.push(runCheck('Automation').then(r => { health.automation = r; }));
  await Promise.all(jobs);
  if (health.data && !health.data.ok) console.error('[NEXUS] connection check failed:', health.data.detail);
  health.running = false;
  health.checkedAt = new Date().toISOString();
  paintHealthChip();
  paintHealthPop();
}

/* ── Notifications ───────────────────────────────────────────────────────────
   The rows lib/badges.js read from v_needs_attention, after its collapse, in
   four tabs: Urgent (HOT), Action required (WARM), Info (everything else) and
   System (a workflow that did not deliver). The bell's number is Urgent plus
   Action required — the same HOT/WARM rule (COUNTS) the sidebar badges use. */
const TAB_BTN = {
  on:  'flex items-center gap-1.5 px-3 py-1.5 rounded-md font-body-sm text-body-sm font-semibold transition-all bg-surface-container-lowest text-primary shadow-sm',
  off: 'flex items-center gap-1.5 px-3 py-1.5 rounded-md font-body-sm text-body-sm font-medium transition-all text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest/60',
};
const TAB_COUNT = {
  urgent: 'font-label-numeric-sm text-table-header px-1.5 rounded font-bold bg-error text-on-error',
  action: 'font-label-numeric-sm text-table-header px-1.5 rounded font-bold bg-on-secondary-fixed text-tertiary-fixed-dim',
  info:   'font-label-numeric-sm text-table-header px-1.5 rounded font-medium bg-surface-container text-outline',
  system: 'font-label-numeric-sm text-table-header px-1.5 rounded font-medium bg-surface-container text-outline',
};
const TABS = [['urgent', 'Urgent'], ['action', 'Action required'], ['info', 'Info'], ['system', 'System']];
let notifTab = 'urgent';
const sevOf = r => String(r.severity || '').toUpperCase();
function tabOf(r) {
  if (r.kind === 'workflow_failure') return 'system';
  if (sevOf(r) === 'HOT') return 'urgent';
  if (sevOf(r) === 'WARM') return 'action';
  return 'info';
}
function screenTitle(id) { return flatNav().find(i => i.id === id)?.title || null; }
function notifItem(r) {
  const urgent = tabOf(r) === 'urgent';
  const title = maskText(String(r.title || r.kind || 'Needs attention'));
  const detail = r.detail ? maskText(String(r.detail)) : '';
  const target = screenTitle(r.screen) ? r.screen : null;
  return `<article class="${urgent ? 'p-space-md rounded-xl bg-error-container/25 shadow-sm' : 'p-space-md rounded-xl bg-surface-container-lowest shadow-sm'}">
    <div class="flex items-start gap-space-sm">
      <div class="${urgent ? 'w-8 h-8 rounded-lg bg-error text-on-error flex items-center justify-center shrink-0' : 'w-8 h-8 rounded-lg bg-surface-container-high text-primary flex items-center justify-center shrink-0'}">
        <span class="material-symbols-outlined text-[18px]">${urgent ? 'crisis_alert' : 'notifications'}</span></div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-1">
          <span class="${urgent ? 'font-headline-md text-body-md font-bold text-error truncate' : 'font-headline-md text-body-md font-bold text-on-surface truncate'}">${esc(title)}</span>
          <span class="font-label-numeric-sm text-label-numeric-sm text-outline shrink-0">${r.at ? esc(ago(r.at)) : ''}</span>
        </div>
        ${detail ? `<p class="font-body-sm text-body-sm text-on-surface-variant mt-1 leading-relaxed">${esc(detail)}</p>` : ''}
        ${target ? `<div class="mt-space-sm flex items-center justify-end">
          <button class="px-space-sm py-1 rounded-md bg-surface-container hover:bg-surface-container-high text-primary font-body-sm text-body-sm font-semibold flex items-center gap-1 transition-colors" type="button" data-screen-link="${esc(target)}">
            <span>Open ${esc(screenTitle(target))}</span><span class="material-symbols-outlined text-[14px]">arrow_forward</span></button></div>` : ''}
      </div>
    </div>
  </article>`;
}
function paintBell() {
  const n = LAST.distinct ? LAST.distinct.filter(r => COUNTS.has(sevOf(r))).length : 0;
  const b = $('bellCount');
  if (!b) return;
  b.textContent = n > 9 ? '9+' : String(n);
  b.classList.toggle('hide', !n);
  $('bellBtn').title = LAST.error ? 'Notifications — the attention list could not be read'
    : (LAST.distinct ? `${n} item${n === 1 ? '' : 's'} need attention` : 'Notifications');
}
function paintNotifications() {
  const d = $('notifDrawer');
  if (!d) return;
  const rows = LAST.distinct || [];
  const groups = { urgent: [], action: [], info: [], system: [] };
  rows.forEach(r => groups[tabOf(r)].push(r));
  let body;
  if (LAST.error) {
    body = `<div class="p-space-md rounded-xl bg-surface-container-lowest shadow-sm font-body-sm text-body-sm text-on-surface-variant">
      The attention list could not be read just now, so nothing is shown here rather than an empty list that would read as "nothing needs you". It is re-read every minute.</div>`;
  } else if (!LAST.distinct) {
    body = `<div class="p-space-md rounded-xl bg-surface-container-lowest shadow-sm font-body-sm text-body-sm text-on-surface-variant">Reading the attention list…</div>`;
  } else if (!groups[notifTab].length) {
    body = `<div class="p-space-md rounded-xl bg-surface-container-lowest shadow-sm font-body-sm text-body-sm text-on-surface-variant">Nothing in this tab right now.</div>`;
  } else {
    body = groups[notifTab].map(notifItem).join('');
  }
  d.innerHTML = `<div class="h-16 px-space-lg flex items-center justify-between bg-surface-container-lowest shrink-0 shadow-sm">
      <div class="flex items-center gap-space-sm">
        <div class="w-8 h-8 rounded-lg bg-primary-container/10 flex items-center justify-center text-primary">
          <span class="material-symbols-outlined text-[20px]">notifications_active</span></div>
        <div>
          <h2 class="font-headline-md text-headline-md font-bold text-on-surface leading-tight">Notifications</h2>
          <div class="flex items-center gap-1.5 font-label-numeric-sm text-label-numeric-sm text-outline">
            <span>${LAST.at ? `As of ${esc(clock(LAST.at))} · re-read every minute` : 'Not read yet'}</span></div>
        </div>
      </div>
      <button aria-label="Close notifications" class="w-8 h-8 rounded-lg hover:bg-surface-container-low text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors" data-notif-close type="button">
        <span class="material-symbols-outlined text-[20px]">close</span></button>
    </div>
    <div class="px-space-md py-2 bg-surface-container-low shrink-0 flex items-center justify-between gap-1 overflow-x-auto" role="tablist">
      ${TABS.map(([k, label]) => `<button class="${k === notifTab ? TAB_BTN.on : TAB_BTN.off}" type="button" role="tab" aria-selected="${k === notifTab}" data-notif-tab="${k}">
        <span>${label}</span><span class="${TAB_COUNT[k]}">${LAST.distinct ? groups[k].length : '—'}</span></button>`).join('')}
    </div>
    <div class="flex-1 overflow-y-auto p-space-md space-y-space-sm bg-surface-container-low/40">${body}</div>
    <div class="p-space-md bg-surface-container-lowest shrink-0 shadow-[0_-2px_6px_rgba(0,0,0,0.03)] flex items-center justify-between font-label-numeric-sm text-label-numeric-sm text-outline">
      <span>From the same list as the sidebar counts</span>
      <span>${LAST.distinct ? `${rows.length} item${rows.length === 1 ? '' : 's'}` : ''}</span>
    </div>`;
  d.querySelector('[data-notif-close]')?.addEventListener('click', () => notif.close());
  d.querySelectorAll('[data-notif-tab]').forEach(b => b.addEventListener('click', () => { notifTab = b.dataset.notifTab; paintNotifications(); }));
}
let notif = null;

/* ── Shortcuts ─────────────────────────────────────────────────────────────── */
function showShortcuts() {
  const row = (k, what) => `<div class="h-10 flex items-center justify-between border-b border-outline-variant/20">
    <span class="font-body-sm text-body-sm text-on-surface">${what}</span>
    <span class="font-label-numeric-sm text-table-header px-1.5 py-0.5 rounded bg-surface-container text-outline font-medium">${k}</span></div>`;
  openStitchModal({ title: 'Keyboard shortcuts', bodyHtml: `<div class="flex flex-col">
    ${row('Ctrl K', 'Search or ask NEXUS')}${row('?', 'Show these shortcuts')}${row('Esc', 'Close a panel, menu or dialog')}</div>` });
}
const typing = e => {
  const t = e.target;
  return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
};

/* ── Install ───────────────────────────────────────────────────────────────── */
/* boot() in app.js runs again after a session expires and the user signs back
   in, so this installs its listeners once and only repaints on later calls. */
let installed = false;
function initShell() {
  if (installed) { paintFreshness(); paintBell(); runHealth(false); return; }
  installed = true;
  installFreshness();

  popover({ button: $('scopeBtn'), panel: $('scopeMenu') });
  popover({ button: $('healthBtn'), panel: $('healthPop'), onOpen: () => { paintHealthPop(); runHealth(true); } });
  paintHealthChip();
  runHealth(false);

  const scrim = $('notifScrim');
  notif = popover({ button: $('bellBtn'), panel: $('notifDrawer'), onOpen: () => { scrim.classList.remove('hide'); paintNotifications(); } });
  const notifClose = notif.close;
  notif.close = () => { notifClose(); scrim.classList.add('hide'); };
  scrim.addEventListener('click', () => notif.close());
  window.addEventListener('nexus:attention', () => { paintBell(); if (notif.isOpen()) paintNotifications(); });
  paintBell();

  /* One document listener closes the overlays on an outside click, and routes
     any data-screen-link inside them through go(). The toggle buttons stop
     their own click from reaching it, so opening one does not close it. */
  document.addEventListener('click', e => {
    /* composedPath(), not target.closest(): a tab or a re-check button
       re-renders its panel inside its own handler, so by the time the click
       reaches the document its target is detached and .closest() finds no
       panel — which would close the panel the reader was using. */
    const path = e.composedPath ? e.composedPath() : [];
    const inPanel = path.some(n => n && (n.id === 'healthPop' || n.id === 'notifDrawer' || n.id === 'scopeMenu'));
    const a = inPanel && path.find(n => n && n.dataset && n.dataset.screenLink);
    if (a) { e.preventDefault(); closePops(); go(a.dataset.screenLink); return; }
    if (!inPanel) closePops();
  });

  const search = $('globalSearch');
  search.addEventListener('focus', () => openCommandPalette({}));
  search.addEventListener('click', () => openCommandPalette({}));
  $('helpBtn').addEventListener('click', showShortcuts);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openCommandPalette({}); return; }
    if (e.key === 'Escape') { closePops(); return; }
    if (e.key === '?' && !typing(e) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); showShortcuts(); }
  });
}

export { initShell, paintFreshness, runHealth };
