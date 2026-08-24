/* NEXUS OS — screens/overview.js
   The executive landing screen. Its job is not to mirror the other thirteen
   screens; it is to answer one question — "what needs a human right now?" —
   and then get out of the way with a link into the screen that can fix it.

   Rewritten 24 Aug 2026 against three production faults:

   1. `v_needs_attention` gained an `unanswered_chat` branch — a WhatsApp thread
      whose newest message is inbound, inside a 7-day window. That is the item
      an operator can act on right now, so it sorts above everything else here:
      a person who has already spoken and is waiting decays faster than a car
      parked on the lot. Its `ref` is a chat_id and its `title` is
      `display_name`, which the view falls back to the raw handle for when it
      knows nothing else — so `163188003877036@lid` arrives in the `title`
      column. That is a machine handle, never a person's name, and this screen
      resolves it against `v_conversations` (`identified`, `phone`) rather than
      printing it as one.

   2. The KYC table contains rows that were never KYC submissions — uncaptioned
      WhatsApp images auto-routed to the auditor. They now carry `void_reason`,
      and the view's own `kyc_archive_gap` branch excludes them. The archive-gap
      count computed here excludes them too (`void_reason is null`); the voided
      rows with no stored file are reported separately as what they are.

   3. The nav badge used to be the attention count plus a locally-computed KYC
      number, which double-counted the moment the view grew a KYC branch. It is
      now a union keyed on `ref`, and the panel says out loud what it adds up to.

   Everything below is a number Postgres produced. Nothing is estimated, and
   where a figure rests on a handful of rows the screen says how few — a single
   test record must not read as a trend. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, clock, esc, mins, n0, num, pill, tone } from '../lib/format.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi, panel, table } from '../lib/ui.js';

/* The reply-gap analysis is windowed so it is provably complete rather than
   merely likely: a reply to a lead can only be logged at or after that lead was
   created, so if we read every outbound message inside the window we know the
   true reply state of every lead created inside the same window. Reading
   "the newest N messages" instead would silently mark answered leads as
   unanswered the moment the dealership got busy. */
const WINDOW_DAYS = 30;
const OUTBOUND_LIMIT = 5000;
const LEAD_LIMIT = 2000;
const INV_LIMIT = 2000;
const ATTN_LIMIT = 200;
const AWAITING_LIMIT = 200;
const KYC_LIMIT = 200;

/* Mirrors the 7-day cut-off inside `v_needs_attention.unanswered_chat`. It is
   used only to explain why a thread that is awaiting a reply is absent from the
   list — never to compute a headline number, which stays the view's own. */
const CHAT_WINDOW_DAYS = 7;

/* Below this many source rows a figure is a sample, not a signal, and the KPI
   says so instead of letting the number stand on its own. */
const THIN = 5;

const plural = (n, one, many) => (Number(n) === 1 ? one : many);
const warn = msg => `<span class="t-warm">${esc(msg)}</span>`;
const muted = msg => `<span class="t-muted">${esc(msg)}</span>`;

/* A WhatsApp handle. A LID contains no phone digits at all, so it identifies
   nobody — it is rendered as a handle, in mono, and never as a name. */
const HANDLE = /@(lid|c\.us|s\.whatsapp\.net|g\.us)$/i;
const isHandle = v => HANDLE.test(String(v == null ? '' : v).trim());
const str = v => String(v == null ? '' : v).trim();

/* What `identified` means, in the operator's words. `lead` is the only value
   that means "we know who this is"; the rest are named as the weaker thing they
   are, exactly as the Conversations screen does. */
const IDENT = {
  lead: null,
  whatsapp_profile: { short: 'Profile name', note: 'This name is what the contact typed into their own WhatsApp profile. It is unverified and there is no lead record behind it.' },
  phone_only: { short: 'Phone only', note: 'We hold a phone number for this contact and nothing else — no lead record and no profile name.' },
  unidentified: { short: 'Unidentified', note: 'We do not know who this is. The only handle stored is the WhatsApp chat id, which for a LID contains no phone digits, and no lead or contact row matches it.' },
};

SCREENS.overview = async host => {
  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); host.appendChild(strip);

  const triage = el('div', 'grid g3 top'); triage.style.marginTop = '16px'; host.appendChild(triage);
  const replyHost = el('div'); const flowHost = el('div'); const kycHost = el('div');
  triage.appendChild(replyHost); triage.appendChild(flowHost); triage.appendChild(kycHost);

  const mid = el('div', 'grid g2 top'); mid.style.marginTop = '16px'; host.appendChild(mid);
  const attnHost = el('div'); const feedHost = el('div');
  mid.appendChild(attnHost); mid.appendChild(feedHost);

  const pipeCard = el('div', 'card'); pipeCard.style.marginTop = '16px'; host.appendChild(pipeCard);
  pipeCard.innerHTML = stateLoading(2);

  /* ── The attention read, done once ──────────────────────────────────────
     Both the Needs-attention panel and the KYC panel depend on it — the second
     one so it can say which of its gaps the view already lists — and the badge
     depends on both. Reading it twice would let the two disagree on screen.

     `v_conversations` is an enrichment, not the source of truth, so its failure
     degrades identity resolution rather than killing the panel. That
     degradation is rendered, not swallowed. */
  const attentionRead = (async () => {
    const [items, threads] = await Promise.all([
      db(`v_needs_attention?select=kind,severity,ref,title,detail,at,screen&limit=${ATTN_LIMIT}`),
      db('v_conversations?select=chat_id,display_name,identified,phone,push_name,last_message_at'
        + `&awaiting_reply=is.true&order=last_message_at.desc&limit=${AWAITING_LIMIT}`).catch(() => null),
    ]);
    return { items, threads };
  })();
  /* Read once here too. The KYC panel renders it and the Needs-attention panel
     needs the same rows to state what the badge adds up to; two reads could
     disagree, and a badge that disagrees with the panel under it is worse than
     no badge. */
  const kycGapRead = db('kyc_documents?select=id,lead_name,full_name,lead_email,document_type,verdict,created_at,retain_until,void_reason'
    + `&storage_path=is.null&purged_at=is.null&order=created_at.desc&limit=${KYC_LIMIT}`);
  /* Both are created well before anything awaits them. Marking them handled now
     keeps a failed read from surfacing as an unhandled rejection in the console
     instead of in the panel that is supposed to report it. */
  attentionRead.catch(() => {});
  kycGapRead.catch(() => {});

  /* A row is an audit gap only if it was a real submission. `void_reason` marks
     the rows that were never KYC at all, and they are excluded here exactly as
     v_needs_attention's own kyc_archive_gap branch excludes them. */
  const liveGaps = rows => (rows || []).filter(r => !str(r.void_reason));
  /* Gaps the view has not already reported, so the badge counts each one once. */
  const extraGaps = (rows, items) => {
    const viewRefs = new Set((items || [])
      .filter(i => i.kind === 'kyc_archive_gap').map(i => str(i.ref)));
    return liveGaps(rows).filter(r => !viewRefs.has(str(r.id)));
  };

  /* The badge is a union keyed on `ref`, not a sum. `v_needs_attention` already
     emits `sla_breach`, `workflow_failure` and — since 24 Aug — `kyc_archive_gap`
     rows, so adding a locally-counted KYC number on top would count the same
     incident twice, which is a number the database did not produce. The KYC
     panel contributes only the gaps the view did NOT list (its branch carries a
     recency cut-off of its own), and the Needs-attention panel prints the
     arithmetic so the badge is never an unexplained number. */
  const need = { attention: null, kycExtra: null };
  const setBadge = () => {
    const badge = $('badge-overview');
    if (!badge || need.attention == null) return;
    const n = need.attention + (need.kycExtra || 0);
    badge.textContent = String(n);
    badge.classList.toggle('hide', n === 0);
  };

  /* ── Core read ──────────────────────────────────────────────────────────
     One fetch feeds the KPI strip, the reply-gap panel and the stage bar, so
     the three cannot disagree with each other. If it fails, every dependent
     surface says so rather than rendering a plausible-looking zero. */
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
  let core = null, coreErr = null;
  try {
    const [leads, inv, metrics, outbound] = await Promise.all([
      db(`leads?select=id,name,email,status,ai_score,vehicle_interest,source,budget_aed,response_time_minutes,created_at,assigned_to_id&order=created_at.desc&limit=${LEAD_LIMIT}`),
      db(`inventory?select=id,model,status,days_in_stock,price_aed,holding_cost_accrued,aging_alert&limit=${INV_LIMIT}`),
      /* daily_metrics is the snapshot table the deltas below are read from. It
         is optional — where it has not been provisioned no delta line renders
         at all, which is the correct outcome. It is never substituted for. */
      db('daily_metrics?select=*&order=snapshot_date.desc&limit=2').catch(() => []),
      db(`communication_logs?select=lead_email,created_at&direction=eq.outbound&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=${OUTBOUND_LIMIT}`),
    ]);

    const up = s => String(s || '').toUpperCase();
    const norm = v => String(v || '').trim().toLowerCase();
    const hot = leads.filter(l => up(l.status) === 'HOT').length;
    const warm = leads.filter(l => up(l.status) === 'WARM').length;
    const cold = leads.filter(l => up(l.status) === 'COLD').length;

    const withResp = leads.filter(l => n0(l.response_time_minutes) != null);
    const avgResp = withResp.length ? withResp.reduce((a, l) => a + Number(l.response_time_minutes), 0) / withResp.length : null;
    const withBudget = leads.filter(l => n0(l.budget_aed) != null);
    const pipeline = withBudget.reduce((a, l) => a + Number(l.budget_aed), 0);
    const risk = inv.filter(i => up(i.aging_alert) === 'CRITICAL');
    const warning = inv.filter(i => up(i.aging_alert) === 'WARNING');
    /* Two different sums. The holding cost of the units actually at risk is the
       number the "units at risk" KPI is about; the total across the lot is a
       different figure and used to be printed beside it as though it were the
       same one. */
    const riskHolding = risk.reduce((a, i) => a + (n0(i.holding_cost_accrued) || 0), 0);
    const holding = inv.reduce((a, i) => a + (n0(i.holding_cost_accrued) || 0), 0);

    const sinceMs = Date.parse(since);
    const answered = new Set(outbound.map(c => norm(c.lead_email)).filter(Boolean));
    const recent = leads.filter(l => Date.parse(l.created_at) >= sinceMs);
    /* A lead with no email cannot be matched against communication_logs, which
       keys on lead_email. Counting those as "unanswered" would invent a queue;
       they are excluded and reported separately so the gap is visible. */
    const unmatchable = recent.filter(l => !norm(l.email)).length;
    const waiting = recent
      .filter(l => norm(l.email) && !answered.has(norm(l.email)))
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

    core = { leads, inv, hot, warm, cold, avgResp, withResp, withBudget, pipeline,
             risk, warning, riskHolding, holding, metrics, waiting, unmatchable,
             recentCount: recent.length,
             leadsCapped: leads.length >= LEAD_LIMIT,
             invCapped: inv.length >= INV_LIMIT,
             outboundCapped: outbound.length >= OUTBOUND_LIMIT };
  } catch (e) {
    coreErr = e;
  }

  /* Dependent panels re-raise the core failure so panel() renders its own error
     card with a working Retry, instead of five cards quietly showing nothing. */
  const requireCore = () => { if (coreErr) throw coreErr; return core; };

  if (coreErr) {
    strip.innerHTML = stateError('the overview', coreErr.message);
    pipeCard.innerHTML = stateError('pipeline by stage', coreErr.message);
  } else {
    const { leads, inv, hot, warm, cold, avgResp, withResp, withBudget, pipeline,
            risk, warning, riskHolding, holding, metrics, waiting, recentCount,
            leadsCapped, invCapped } = core;

    /* Deltas only exist once there are two snapshots. Until then no delta line
       renders at all — an earlier build showed "-18s vs last week" as a
       hardcoded string with nothing behind it. */
    const prev = metrics.length > 1 ? metrics[1] : null;
    const delta = (now, before, fmt, lowerIsBetter) => {
      if (!prev || before == null || now == null) return '';
      const when = prev.snapshot_date ? `the ${esc(prev.snapshot_date)} snapshot` : 'the previous snapshot';
      const d = Number(now) - Number(before);
      if (!d) return `<span class="t-muted">No change against ${when}</span>`;
      const good = lowerIsBetter ? d < 0 : d > 0;
      return `<span class="${good ? 't-ok' : 't-hot'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</span> <span class="t-muted">against ${when}</span>`;
    };

    const oldestRisk = risk.length ? Math.max(...risk.map(r => n0(r.days_in_stock) || 0)) : null;

    /* ── Open leads ─────────────────────────────────────────────────────── */
    const leadsSub = `${pill(`${hot} HOT`, 'hot')} ${pill(`${warm} WARM`, 'warm')} ${pill(`${cold} COLD`, 'cold')}`
      + (leadsCapped
          ? `<br>${warn(`Capped at ${num(LEAD_LIMIT)} rows — the leads table holds more than this.`)}`
          : leads.length <= THIN
            ? `<br>${warn(`That is the whole leads table — ${num(leads.length)} ${plural(leads.length, 'row', 'rows')}, not a sample of it.`)}`
            : '');

    /* ── Awaiting first reply ───────────────────────────────────────────── */
    const waitSub = waiting.length
      ? `<span class="t-hot">Oldest arrived ${esc(ago(waiting[0].created_at))}, still unanswered</span>`
        + `<br>${muted(`Out of ${num(recentCount)} ${plural(recentCount, 'lead', 'leads')} created in the last ${WINDOW_DAYS} days`)}`
      : recentCount
        ? `<span class="t-ok">All ${num(recentCount)} ${plural(recentCount, 'lead', 'leads')} created in the last ${WINDOW_DAYS} days ${plural(recentCount, 'has', 'have')} an outbound message</span>`
          + (recentCount <= THIN ? `<br>${warn(`On ${num(recentCount)} ${plural(recentCount, 'lead', 'leads')} this says almost nothing about the reply habit.`)}` : '')
        : muted(`No lead was created in the last ${WINDOW_DAYS} days, so there is nothing here to be waiting on`);

    /* ── Average response time ──────────────────────────────────────────── */
    const respBasis = muted(`From ${num(withResp.length)} of ${num(leads.length)} ${plural(leads.length, 'lead', 'leads')} with a recorded response time`);
    const respSub = avgResp == null
      ? muted(!leads.length
          ? 'No leads on file'
          : leads.length === 1
            ? 'The only lead on file has no response time recorded, so there is no average to report'
            : `None of the ${num(leads.length)} leads on file has a response time recorded, so there is no average to report`)
      : (avgResp > 5
          ? `<span class="t-hot">Breaches the 5-minute rule</span><br>${respBasis}`
          : `<span class="t-ok">Inside the 5-minute rule</span><br>${respBasis}`)
        + (withResp.length <= THIN ? `<br>${warn(`An average of ${num(withResp.length)} ${plural(withResp.length, 'measurement', 'measurements')} is not a performance figure.`)}` : '')
        + ((() => { const d = delta(avgResp, prev?.avg_response_minutes, v => mins(v), true); return d ? `<br>${d}` : ''; })());

    /* ── Pipeline value ─────────────────────────────────────────────────── */
    const noBudget = leads.length - withBudget.length;
    const pipeSub = !withBudget.length
      ? muted(`No lead on file has a budget recorded, so there is no pipeline figure to report`)
      : muted(`Sum of the budget field on ${num(withBudget.length)} of ${num(leads.length)} ${plural(leads.length, 'lead', 'leads')}`
              + (noBudget ? ` · ${num(noBudget)} with no budget recorded` : ''))
        + (withBudget.length <= THIN
            ? `<br>${warn(`This is ${num(withBudget.length)} ${plural(withBudget.length, 'budget field', 'budget fields')} added up, not a forecast.`)}`
            : '')
        + ((() => { const d = delta(pipeline, prev?.pipeline_aed, v => aed(v)); return d ? `<br>${d}` : ''; })());

    /* ── Units at risk ──────────────────────────────────────────────────── */
    const riskSub = (risk.length
        ? `<span class="t-hot">Oldest ${num(oldestRisk)} days in stock</span> ${muted(`· ${num(risk.length)} of ${num(inv.length)} ${plural(inv.length, 'unit', 'units')} read`)}`
          + `<br>${muted(`${aed(riskHolding)} holding cost on ${plural(risk.length, 'that unit', 'those units')} · ${aed(holding)} across all ${num(inv.length)}`)}`
        : muted(`No unit is flagged CRITICAL across the ${num(inv.length)} ${plural(inv.length, 'unit', 'units')} read · ${aed(holding)} holding cost accrued in total`))
      + (warning.length ? `<br>${warn(`${num(warning.length)} further ${plural(warning.length, 'unit is', 'units are')} flagged WARNING and not counted above.`)}` : '')
      + (invCapped ? `<br>${warn(`Inventory read was capped at ${num(INV_LIMIT)} rows.`)}` : '');

    strip.innerHTML = [
      kpi('Open leads', num(leads.length), leadsSub),
      /* The one number on this screen that maps to a person waiting. */
      kpi('Awaiting first reply', num(waiting.length), waitSub, waiting.length ? 't-hot' : ''),
      kpi('Avg response time', mins(avgResp), respSub),
      kpi('Pipeline value', aed(pipeline), pipeSub),
      kpi('Units at risk', num(risk.length), riskSub, risk.length ? 't-hot' : ''),
    ].join('');

    const seg = [['HOT', hot, 'var(--hot)'], ['WARM', warm, 'var(--warm)'], ['COLD', cold, 'var(--cold)']];
    const graded = hot + warm + cold;
    pipeCard.innerHTML = graded
      ? `<div class="label-caps" style="margin-bottom:12px">Pipeline by stage</div>
        <div class="stackbar">${seg.map(([, v, c]) => `<i style="width:${(v / graded * 100).toFixed(1)}%;background:${c}"></i>`).join('')}</div>
        <div style="display:flex;gap:20px;margin-top:12px;flex-wrap:wrap">
          ${seg.map(([k, v, c]) => `<div style="display:flex;align-items:center;gap:8px">
            <span style="width:8px;height:8px;border-radius:50%;background:${c}"></span>
            <span style="font-weight:500">${esc(k)}</span><span class="t-muted num">${num(v)} ${plural(v, 'lead', 'leads')}</span></div>`).join('')}
          ${graded < leads.length ? `<div class="cell-sub">${num(leads.length - graded)} not yet scored by the router</div>` : ''}
        </div>
        ${graded <= THIN
          /* A full-width bar drawn from one row looks like a market share. It
             is one row, and the caption says so directly under it. */
          ? `<div class="cell-sub" style="margin-top:10px">${warn(`This bar is ${num(graded)} scored ${plural(graded, 'lead', 'leads')} in total. The proportions are shapes, not shares.`)}</div>`
          : ''}`
      : stateEmpty('Nothing to chart yet', 'No lead has been scored HOT, WARM or COLD.', 'donut_small');
  }

  /* ── Triage row ─────────────────────────────────────────────────────────── */

  const panels = [];

  /* 1 · Leads nobody has replied to. */
  panels.push(panel(replyHost, {
    title: 'No reply sent',
    sub: `Leads created in the last ${WINDOW_DAYS} days with no outbound message in communication_logs`,
    actions: `<button class="btn sm" data-act="leads">Open Leads</button>`,
    load: async () => requireCore(),
    render: d => {
      const notes = [
        d.unmatchable ? `${num(d.unmatchable)} of the ${num(d.recentCount)} leads in this window have no email address, so communication_logs cannot be matched to them.` : '',
        d.outboundCapped ? `Outbound history was capped at ${num(OUTBOUND_LIMIT)} messages for this window, so this list may be incomplete.` : '',
        d.recentCount && d.recentCount <= THIN ? `Only ${num(d.recentCount)} ${plural(d.recentCount, 'lead was', 'leads were')} created in this window, so an empty list here is a very small sample.` : '',
      ].filter(Boolean);
      const foot = notes.length
        ? `<div class="list-item" style="cursor:default"><span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
             <div class="cell-sub" style="white-space:normal">${notes.map(esc).join('<br>')}</div></div>`
        : '';
      if (!d.waiting.length) {
        return stateEmpty(d.recentCount ? 'Every lead has been answered' : 'No leads in this window',
          d.recentCount
            ? `All ${d.recentCount} ${plural(d.recentCount, 'lead', 'leads')} created in the last ${WINDOW_DAYS} days ${plural(d.recentCount, 'has', 'have')} an outbound message against ${plural(d.recentCount, 'its', 'their')} address.`
            : `No lead was created in the last ${WINDOW_DAYS} days, so there is nothing to answer.`, 'mark_email_read') + foot;
      }
      const shown = d.waiting.slice(0, 8);
      return `<div>${shown.map(l => `
        <div class="list-item" style="cursor:default;align-items:flex-start">
          ${pill(l.status || 'NEW')}
          <div style="flex:1;min-width:0">
            <div style="font-weight:500">${esc(l.name || 'Unnamed lead')}</div>
            <div class="cell-sub">${esc(l.vehicle_interest || 'No vehicle recorded')}${l.source ? ' · ' + esc(l.source) : ''}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="t-hot">${esc(ago(l.created_at))}</div>
            <div class="cell-sub">${l.assigned_to_id ? 'assigned' : 'unassigned'}</div>
          </div>
        </div>`).join('')}
        ${d.waiting.length > shown.length
          ? `<div class="list-item" style="cursor:default"><div class="cell-sub">${num(d.waiting.length - shown.length)} more waiting — see Leads</div></div>`
          : ''}${foot}</div>`;
    },
  }).then(card => card.querySelector('[data-act]')?.addEventListener('click', () => go('leads'))));

  /* 2 · Workflows that actually failed inside the health window. `health` is
     computed over 30 days, so failures_30d is the column that agrees with it —
     all-time `failures` would keep a long-fixed workflow red forever. */
  panels.push(panel(flowHost, {
    title: 'Workflows degraded',
    sub: 'Any workflow with at least one failure in the last 30 days',
    actions: `<button class="btn sm" data-act="automation">Open Automation</button>`,
    load: () => db('v_workflow_health?select=id,name,category,health,runs_30d,failures_30d,last_failure,is_active&failures_30d=gt.0&order=failures_30d.desc,name.asc&limit=50'),
    render: rows => {
      if (!rows.length) {
        return stateEmpty('No workflow has failed in 30 days',
          'Workflows that do not write to the audit log cannot report health — Automation lists those separately.', 'task_alt');
      }
      return `<div>${rows.map(w => {
        const runs = n0(w.runs_30d), fails = n0(w.failures_30d);
        /* "3 of 3 runs failed" and "124 of 202 runs failed" are different
           claims. A workflow that has barely run in the window is marked as
           such rather than being ranked on a rate nobody can trust. */
        const scarce = runs != null && runs <= THIN;
        return `<div class="list-item" style="cursor:default;align-items:flex-start">
          <span class="material-symbols-outlined t-hot" style="font-size:20px">error</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-weight:500">${esc(w.name)}</span>
              ${pill(w.health === 'DEGRADED' ? 'Degraded' : String(w.health || 'Unknown'), w.health === 'DEGRADED' ? 'hot' : '')}
              ${w.is_active === false ? pill('Inactive', 'cold') : ''}
            </div>
            <div class="cell-sub">${esc(w.category || 'Uncategorised')}${w.last_failure ? ' · last failed ' + esc(ago(w.last_failure)) : ''}${
              scarce ? ' · <span class="t-warm">too few runs in 30 days to rate</span>' : ''}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="num t-hot" style="font-weight:500">${num(fails)}</div>
            <div class="cell-sub">${runs == null ? 'failed' : `of ${num(runs)} runs`}</div>
          </div>
        </div>`;
      }).join('')}</div>`;
    },
  }).then(card => card.querySelector('[data-act]')?.addEventListener('click', () => go('automation'))));

  /* 3 · KYC archive gaps.
     Three separate conditions live in this table and only one of them is a
     compliance hole:
       · purged_at IS NOT NULL — the file was deleted on schedule. Not a problem.
       · void_reason IS NOT NULL — the row was never a KYC submission at all
         (an uncaptioned WhatsApp image auto-routed to the auditor). A missing
         file for something nobody ever submitted is not an audit gap, and
         counting it as one inflates the compliance number with an incident that
         has already been diagnosed.
       · storage_path IS NULL, not purged, not voided — the archive step never
         wrote the file for a real submission. That, and only that, is counted. */
  panels.push(panel(kycHost, {
    title: 'KYC archive gaps',
    sub: 'Genuine submissions whose file was never stored, and which were not purged on schedule',
    actions: `<button class="btn sm" data-act="compliance">Open Compliance</button>`,
    load: async () => {
      /* One read, partitioned in the browser, so the voided count and the live
         count cannot come from two different moments in time. */
      const rows = await kycGapRead;
      const att = await attentionRead.catch(() => null);
      return { rows, att };
    },
    render: ({ rows, att }) => {
      const live = liveGaps(rows);
      const voided = (rows || []).filter(r => str(r.void_reason));
      const capped = (rows || []).length >= KYC_LIMIT;

      /* Which of these the operator has already been told about upstairs. The
         badge arithmetic itself lives in the Needs-attention panel, which holds
         both halves of it. */
      const extra = att ? extraGaps(rows, att.items) : [];

      const contacts = new Set(live.map(r => str(r.lead_email).toLowerCase() || str(r.lead_name).toLowerCase()).filter(Boolean)).size;

      const notes = [
        voided.length
          ? `${num(voided.length)} further ${plural(voided.length, 'row has', 'rows have')} no stored file but ${plural(voided.length, 'carries', 'carry')} a void_reason — ${plural(voided.length, 'it was', 'they were')} never a KYC submission, so ${plural(voided.length, 'it is', 'they are')} not counted as an audit gap here. Compliance shows ${plural(voided.length, 'it', 'them')} in full.`
          : '',
        !att
          ? 'Needs attention did not load, so these could not be cross-checked against v_needs_attention.'
          : live.length && extra.length === live.length
            ? `None of these appear in Needs attention — the view's kyc_archive_gap branch applies a recency cut-off of its own, so older gaps are visible only here.`
            : extra.length
              ? `${num(live.length - extra.length)} of these also appear in Needs attention; ${num(extra.length)} ${plural(extra.length, 'does', 'do')} not.`
              : '',
        live.length > 1 && contacts && contacts <= 2
          ? `All ${num(live.length)} belong to ${num(contacts)} ${plural(contacts, 'contact', 'contacts')} — this is one submission trail failing repeatedly, not a problem spread across the book.`
          : live.length === 1
            ? 'This is a single row. It is a real gap, but it is one.'
            : '',
        capped ? `Read was capped at ${num(KYC_LIMIT)} rows, so there may be more.` : '',
      ].filter(Boolean);

      const foot = `<div class="list-item" style="cursor:default">
          <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
          <div class="cell-sub" style="white-space:normal">${notes.map(esc).join('<br>')}${notes.length ? '<br>' : ''}Repairing these needs a service-role job. The document itself cannot be opened from the browser either — private-bucket files require a short-lived signed URL and there is no helper for that yet.</div>
        </div>`;

      if (!live.length) {
        return stateEmpty(
          voided.length ? 'No genuine submission is missing its file' : 'Every audited document is archived',
          voided.length
            ? `The ${voided.length} ${plural(voided.length, 'row', 'rows')} here with no stored file ${plural(voided.length, 'was', 'were')} voided as ${plural(voided.length, 'a non-submission', 'non-submissions')}. Rows already purged on schedule are not counted either.`
            : 'No KYC row is missing its stored file. Rows already purged on schedule are not counted here.',
          'inventory_2') + foot;
      }

      return `<div>${live.map(d => `
        <div class="list-item" style="cursor:default;align-items:flex-start">
          <span class="material-symbols-outlined t-warm" style="font-size:20px">folder_off</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-weight:500">${esc(str(d.lead_name) || str(d.full_name) || str(d.lead_email) || 'Unknown contact')}</span>
              ${d.verdict ? pill(d.verdict) : ''}
            </div>
            <div class="cell-sub">${esc(str(d.document_type) || 'No document type recorded')} · audited ${esc(ago(d.created_at))}${d.retain_until ? ' · retain until ' + esc(d.retain_until) : ''}</div>
          </div>
          <button class="btn sm" disabled
            title="No re-archive endpoint exists. kyc_documents and the private kyc-documents bucket are service-role only, and there is no n8n webhook for re-running the archive step, so the browser cannot repair this row.">Re-archive</button>
        </div>`).join('')}${foot}</div>`;
    },
  }).then(card => {
    card.querySelector('[data-act]')?.addEventListener('click', () => go('compliance'));
  }));

  /* ── Needs attention + the live feed ────────────────────────────────────── */

  /* Icons and fallback destinations. The view supplies its own `screen` column,
     which is used whenever it names a screen that actually exists; the map is
     only a fallback for a kind the view adds before this file knows about it. */
  const KIND_ICON = {
    unanswered_chat: 'mark_chat_unread', lead_unassigned: 'person_alert', sla_breach: 'timer',
    kyc_archive_gap: 'folder_off', workflow_failure: 'error', undercut: 'trending_down',
    inventory_aging: 'directions_car',
  };
  const KIND_SCREEN = {
    unanswered_chat: 'conversations', lead_unassigned: 'leads', sla_breach: 'leads',
    kyc_archive_gap: 'compliance', workflow_failure: 'automation', undercut: 'competitors',
    inventory_aging: 'inventory',
  };
  /* Severity alone put four parked cars above a person who had already written
     in. A customer waiting on a reply decays in hours; a HOT lead with no owner
     in minutes-to-hours; a car aging on the lot over weeks. */
  const RANK = { unanswered_chat: 0, lead_unassigned: 1, sla_breach: 2, kyc_archive_gap: 3,
                 workflow_failure: 4, undercut: 5, inventory_aging: 6 };

  panels.push(panel(attnHost, {
    title: 'Needs attention',
    sub: 'Live union from v_needs_attention — unanswered WhatsApp threads first, then unassigned HOT leads, SLA breaches, KYC archive gaps, workflow failures, undercuts and aging stock',
    load: async () => {
      const { items, threads } = await attentionRead;
      const sorted = [...items].sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9)
        || new Date(b.at) - new Date(a.at));
      /* Soft: a failed KYC read must not take this panel down with it, but it
         does change what the badge can honestly claim, so it is reported. */
      const gapRows = await kycGapRead.catch(() => null);
      return { items: sorted, threads, gapRows };
    },
    render: ({ items, threads, gapRows }) => {
      need.attention = items.length;
      need.kycExtra = gapRows ? extraGaps(gapRows, items).length : null;
      setBadge();

      const byChat = new Map();
      (threads || []).forEach(t => { const k = str(t.chat_id); if (k) byChat.set(k, t); });

      /* An unanswered_chat row arrives with `title = display_name`, and the view
         falls back to the raw chat handle when it has nothing better — so the
         title column can literally be "163188003877036@lid". Resolve it against
         v_conversations and say which of the four identity cases we are in;
         where the enrichment did not load, refuse to treat the title as a name
         unless it is plainly not a handle, and label it unresolved either way. */
      const chatRow = it => {
        const ref = str(it.ref);
        const t = byChat.get(ref) || null;
        const shown = str(t ? t.display_name : it.title);
        const identKey = t ? str(t.identified) : '';
        const looksLikeHandle = !shown || shown === ref || isHandle(shown);
        const named = !looksLikeHandle && identKey !== 'unidentified';
        const meta = Object.prototype.hasOwnProperty.call(IDENT, identKey) ? IDENT[identKey] : IDENT.unidentified;
        const phone = t ? str(t.phone) : '';
        const chips = [];
        if (!t) {
          chips.push(`<span class="chip" title="v_conversations did not load, so this thread's identity could not be resolved. The label shown is the view's display_name, which falls back to the raw chat handle.">Identity unresolved</span>`);
        } else if (meta) {
          chips.push(`<span class="chip" title="${esc(meta.note)}">${esc(meta.short)}</span>`);
        }
        return { ref, named, name: named ? shown : '', phone, chips };
      };

      const shownRefs = new Set(items.filter(i => i.kind === 'unanswered_chat').map(i => str(i.ref)));

      const body = items.map(it => {
        const target = SCREENS[it.screen] ? it.screen : (KIND_SCREEN[it.kind] || 'overview');
        const icon = KIND_ICON[it.kind] || 'warning';
        let head, sub;
        if (it.kind === 'unanswered_chat') {
          const c = chatRow(it);
          head = `${c.named ? esc(c.name) : '<span class="t-warm">Unidentified WhatsApp contact</span>'} ${c.chips.join(' ')}`;
          sub = `${esc(it.detail)}<div class="cell-sub">${
            c.phone ? `<span class="mono">${esc(c.phone)}</span>` : '<span class="t-muted">No phone number stored</span>'
          } · <span class="mono" title="WhatsApp chat handle — a LID contains no phone digits and identifies nobody on its own">${esc(c.ref)}</span></div>`;
        } else {
          head = esc(it.title);
          sub = esc(it.detail);
        }
        return `<div class="list-item" role="button" tabindex="0" data-goto="${esc(target)}">
          <span class="material-symbols-outlined t-${tone(it.severity)}" style="font-size:20px">${icon}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${head}</div>
            <div class="cell-sub">${sub}</div>
          </div>
          <span class="material-symbols-outlined t-muted" style="font-size:18px">chevron_right</span>
        </div>`;
      }).join('');

      /* Threads that are awaiting a reply but are not on this list. The view's
         branch is bounded at 7 days, so an older one is silently absent — and an
         operator who reads this list as "everyone who is waiting" would be
         wrong. Counted from v_conversations, not asserted. */
      const missing = (threads || []).filter(t => !shownRefs.has(str(t.chat_id)));
      const cutoff = Date.now() - CHAT_WINDOW_DAYS * 86400000;
      const stale = missing.filter(t => Date.parse(t.last_message_at) < cutoff).length;
      const other = missing.length - stale;

      const notes = [
        !threads ? 'v_conversations did not load, so WhatsApp threads above could not be checked against their contact records, and threads waiting outside this list could not be counted.' : '',
        stale ? `${num(stale)} further ${plural(stale, 'thread is', 'threads are')} awaiting a reply but older than the ${CHAT_WINDOW_DAYS}-day window this list uses — see Conversations.` : '',
        other ? `${num(other)} further ${plural(other, 'thread is', 'threads are')} marked awaiting_reply in v_conversations but ${plural(other, 'does', 'do')} not appear above.` : '',
        gapRows == null
          ? `Nav badge counts the ${num(items.length)} ${plural(items.length, 'item', 'items')} here only — the KYC archive-gap read failed, so any gap it would have added is missing from the badge.`
          : `Nav badge counts ${num(items.length)} ${plural(items.length, 'item', 'items')} here${need.kycExtra ? ` plus ${num(need.kycExtra)} KYC archive ${plural(need.kycExtra, 'gap', 'gaps')} this view does not list` : ' and nothing else'}.`,
      ].filter(Boolean);
      const foot = `<div class="list-item" style="cursor:default">
        <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
        <div class="cell-sub" style="white-space:normal">${notes.map(esc).join('<br>')}</div></div>`;

      if (!items.length) {
        return stateEmpty('Nothing needs you right now',
          'No unanswered WhatsApp thread inside the 7-day window, no unassigned HOT lead, SLA breach, KYC archive gap, workflow failure, undercut or aging unit.',
          'task_alt') + foot;
      }
      return `<div>${body}${foot}</div>`;
    },
  }).then(card => {
    /* These rows are keyboard-operable: the row is the only way into the screen
       that can act on the item, so a mouse-only affordance would strand anyone
       navigating by keyboard. */
    card.querySelectorAll('[data-goto]').forEach(n => {
      const jump = () => go(n.dataset.goto);
      n.addEventListener('click', jump);
      n.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
      });
    });
  }));

  const FEED_LIMIT = 8;
  panels.push(panel(feedHost, {
    title: 'Live lead feed',
    sub: 'Newest first',
    actions: `<button class="btn sm" data-act="leads">View all</button>`,
    load: () => db(`leads?select=id,name,status,ai_score,vehicle_interest,source,created_at&order=created_at.desc&limit=${FEED_LIMIT}`),
    render: rows => {
      if (!rows.length) return stateEmpty('No leads yet', 'They appear here the moment the router webhook receives one.');
      /* Fewer rows than the page size means this is not the top of a long list,
         it is the whole list — which reads very differently. */
      const note = rows.length < FEED_LIMIT
        ? `<div class="list-item" style="cursor:default"><span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
             <div class="cell-sub" style="white-space:normal">${esc(`The query asked for the newest ${FEED_LIMIT} leads and got ${rows.length}, so this is the whole leads table, not the top of it.`)}</div></div>`
        : '';
      return table([
        { label:'When', render: r => `<div class="t-muted">${esc(ago(r.created_at))}</div><div class="cell-sub mono">${esc(clock(r.created_at))}</div>` },
        { label:'Status',  render: r => pill(r.status || 'NEW') },
        { label:'Name',    strong: true, render: r => esc(r.name) },
        { label:'Interest',render: r => `<span class="t-2">${esc(r.vehicle_interest || '—')}</span>` },
        { label:'Score', align:'r', render: r => num(r.ai_score) },
      ], rows) + note;
    },
  }).then(card => card.querySelector('[data-act]')?.addEventListener('click', () => go('leads'))));

  await Promise.all(panels);
};

/* ==========================================================================
   S2 · Leads
   ========================================================================== */
