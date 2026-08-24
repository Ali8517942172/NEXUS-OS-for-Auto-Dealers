/* NEXUS OS — screens/campaigns.js
   Rebuilt on 19 Aug 2026 from "a list of leads with a Start drip button" into
   the drip surface proper: who is enrolled, what has actually been sent, and
   one guarded way to enrol somebody else. Given an alert strip on 24 Aug 2026.

   The thing this screen has to be honest about is that *enrolling* and
   *sending* are two different events. The 7-day sequence is queued inside n8n
   the moment `lead-trigger` returns 2xx, but every send step in that sequence
   goes out through Gmail, and today the Gmail credential is revoked. So the
   product can truthfully report a lead as enrolled while nothing whatsoever
   reaches the customer.

   Until today that gap was a hand-typed banner with nothing behind it. It is
   now a reading: `v_needs_attention` carries a live `workflow_failure` row
   whose detail is the n8n error verbatim — the Gmail OAuth2 credential needs to
   be reconnected — and `v_workflow_health` says how the drip workflow itself is
   behaving. The alert strip states which of those two sources it is speaking
   from, and where neither can prove anything it says that instead of guessing.

   The four checks this screen adds on top of the view are the four ways a drip
   embarrasses a dealership:
     · it is running and has sent nothing,
     · it is still sequencing somebody who already replied — the worst of them,
       because the customer answered and the machine kept talking over them,
     · somebody was enrolled into an *email* sequence with no email address,
     · the credential that does the sending is dead, so every "sent" is false.

   Nothing here writes to the database. `communication_logs` and `audit_log` are
   service-role only; this screen reads them and calls exactly one n8n webhook.
   Every count below is a count of rows Postgres returned — there is no
   estimated, projected or example figure anywhere on this screen. */
import { HOOK, db, n8n } from '../lib/data.js';
import { el } from '../lib/dom.js';
import { N8N_BASE } from '../lib/env.js';
import { aed, ago, clock, esc, n0, num, pill, tone } from '../lib/format.js';
import { leadDrawer } from '../lib/lead-drawer.js';
import { openModal } from '../lib/modal.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi, table, wireRows } from '../lib/ui.js';

/* Bounded reads. An unbounded select is how a screen starts timing out once the
   dealership has a year of history behind it; where a cap is actually hit it is
   said out loud, because a truncated roster that looks complete is a lie about
   how many customers are mid-sequence. */
const LOG_LIMIT    = 1000;
const AUDIT_LIMIT  = 1000;
const ATTN_LIMIT   = 200;
const HEALTH_LIMIT = 200;

/* This screen's id in `v_needs_attention.screen`. */
const SCREEN_ID = 'campaigns';

/* The drip is a fixed three-step sequence over seven days. Used only to say
   whether a lead's remaining steps are still queued — after seven days the
   sequence has run out on its own, which changes what an operator should do
   about a lead who replied halfway through. */
const SEQUENCE_DAYS = 7;

/* Names shown inline on an alert before it collapses into "+N more". The row
   itself scrolls to and highlights the full set, so this is a glance. */
const PREVIEW = 4;

const low = s => String(s || '').trim().toLowerCase();
const up  = s => String(s || '').trim().toUpperCase();
const str = v => String(v == null ? '' : v).trim();
const ts  = v => { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; };
const stamp = v => { const t = Date.parse(v); return Number.isNaN(t) ? 'no timestamp recorded' : new Date(t).toLocaleString('en-GB'); };
const plural = (n, one, many) => (Number(n) === 1 ? one : many);

/* Resolve to [value, null] or [null, error] so one failed read cannot abort the
   others through Promise.all, and so every failure arrives as a fact the strip
   can print rather than as a rejection somebody has to catch again. */
const settle = p => p.then(v => [v, null], e => [null, e]);

/* `v_needs_attention.severity` uses the view's vocabulary, not TONE's. TONE has
   no WARNING key, so `tone('WARNING')` returns '' and `t-${tone(sev)}` renders
   the class `t-` — no colour at all, and no error anywhere to notice it by.
   Map the view's words here and fall back to TONE for the ones it does hold. */
/* Was a private severity map; lib/format.js now covers every vocabulary that
   reaches this screen. Kept as a name so the call sites read the same. */
const sevTone = s => tone(s);

/* Icons for the kinds the view can file against this screen. It files none
   today, so this map is a guess at nothing — the fallback is what renders, and
   the kind itself is printed as a chip so an unknown kind is still readable. */
const KIND_ICON = { workflow_failure:'error', campaign_stalled:'campaign', lead_unassigned:'person_alert' };

/* A WhatsApp chat handle. A LID carries no phone digits at all, so it
   identifies nobody and is never printed as a person's name. Leads are not
   supposed to carry one, but the router has written stranger things into
   `name`, and a handle rendered as a name is exactly the fault the 24 Aug
   addendum is about. */
const HANDLE = /@(lid|c\.us|s\.whatsapp\.net|g\.us)$/i;

/* Deliberately loose: enough to tell an address from a phone number or a name
   that landed in `lead_email`, not an RFC validator. Anything this rejects
   cannot be the destination of an email sequence, which is the only question
   being asked. */
const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* What makes a `workflow_failure` row evidence about *email delivery* rather
   than about some other workflow: it has to name a credential problem and it
   has to name the mail transport. Both halves are required — "credential
   expired" on the WhatsApp session says nothing about the drip. */
const CREDENTIAL_RE = /credential|oauth|reconnect|re-?authenticat|invalid_grant|unauthori[sz]ed|401/i;
const MAILER_RE     = /gmail|smtp|e-?mail|sendgrid|mailer/i;

/* A drip message is an outbound row whose channel mentions mail, which catches
   "email" and "gmail" both. communication_logs records no workflow id, so mail
   the drip sent cannot be told apart from mail anything else sent; the panel
   below says so rather than labelling all of it as drip output. */
const isMail = c => /mail/i.test(String(c.channel || ''));

/* There is no webhook that stops a sequence. HOOK lists `lead-trigger`, which
   only starts one. Faking a stop by writing to audit_log or communication_logs
   is not available either — both are service-role only — so the control that an
   operator actually wants here is rendered and disabled with the reason. */
const NO_CANCEL_HOOK =
  'There is no webhook for cancelling a drip enrolment. HOOK in lib/data.js exposes lead-trigger, '
  + 'which only starts a sequence; n8n exposes nothing that stops one, and this dashboard will not '
  + 'write to a service-role table to fake it. Reply to these people by hand.';

/* n8n does not expose credential state to the browser directly. What the
   dashboard can see is the wreckage: a failure row in v_needs_attention and the
   drip workflow's health. Saying which it is matters, because the absence of a
   failure row is not the same as a working mailbox. */
const NOT_PROBED =
  'n8n does not expose credential health to the dashboard, so this is read from failures the '
  + 'workflows recorded, not from the credential itself. No recorded failure is not proof that mail is going out.';

const FILTERS = [
  ['new', 'Not yet enrolled'],
  ['on',  'Enrolled'],
  ['all', 'All warm & cold'],
];

SCREENS.campaigns = async host => {
  const alertCard  = el('div', 'card flush');
  const strip      = el('div', 'grid g5');
  const enrolCard  = el('div', 'card flush');
  const midRow     = el('div', 'grid g2 top');
  const rosterCard = el('div', 'card flush');
  const mailCard   = el('div', 'card flush');
  const lowRow     = el('div', 'grid g2 top');
  const silenceCard  = el('div', 'card flush');
  const activityCard = el('div', 'card flush');

  strip.style.marginTop     = '16px';
  enrolCard.style.marginTop = '16px';
  midRow.style.marginTop    = '16px';
  lowRow.style.marginTop    = '16px';
  midRow.appendChild(rosterCard); midRow.appendChild(mailCard);
  lowRow.appendChild(silenceCard); lowRow.appendChild(activityCard);
  [alertCard, strip, enrolCard, midRow, lowRow].forEach(n => host.appendChild(n));

  await boot();

  async function boot() {
    /* ── Loading ─────────────────────────────────────────────────────────── */
    alertCard.innerHTML = `<div class="card-head"><div>
      <div class="card-title">Needs attention</div>
      <div class="card-sub">v_needs_attention for this screen, plus the checks this screen runs on the rows it just read</div>
    </div></div><div class="pbody">${stateLoading(3)}</div>`;
    strip.innerHTML = stateLoading(2);
    [enrolCard, rosterCard, mailCard, silenceCard, activityCard]
      .forEach(c => { c.innerHTML = stateLoading(5); });

    /* ── Alert-strip reads ───────────────────────────────────────────────────
       Started before the core read is awaited, so the whole screen costs one
       round of requests rather than one per alert.

       Why the whole view and not `?screen=eq.campaigns`: that filter returns
       nothing today, and the single row that decides whether this screen is
       telling the truth is filed against a *different* screen — a
       `workflow_failure` carrying the Gmail credential error. Reading the view
       once and splitting it here is one request, not two. Rows filed against
       campaigns are listed as this screen's alerts; the credential row is used
       only as evidence for the email-delivery alert and is labelled with the
       screen it actually belongs to, so nobody is told an automation row was
       raised about campaigns when it was not. */
    const attnRead = settle(db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen'
      + `&order=at.desc&limit=${ATTN_LIMIT}`));
    const healthRead = settle(db('v_workflow_health?select=id,name,category,trigger_type,trigger_detail,'
      + 'is_active,writes_audit_log,runs,failures,success_rate,last_run,runs_30d,failures_30d,last_failure,health'
      + `&limit=${HEALTH_LIMIT}`));

    /* ── Core read ───────────────────────────────────────────────────────────
       One read feeds the strip, the roster, the mail log and the enrol table,
       so the four cannot contradict each other. If it fails, every region says
       so and offers a Retry that genuinely refetches. */
    let leads, comms, audit;
    try {
      [leads, comms, audit] = await Promise.all([
        db('leads?select=*,users(id,name)&order=created_at.desc&limit=1000'),
        db(`communication_logs?select=id,lead_email,direction,message,channel,created_at&order=created_at.desc&limit=${LOG_LIMIT}`),
        db(`audit_log?select=workflow,status,lead_name,lead_email,summary,logged_at&order=logged_at.desc&limit=${AUDIT_LIMIT}`),
      ]);
    } catch (e) {
      alertCard.querySelector('.pbody').innerHTML = stateError('the alert strip', e.message);
      strip.innerHTML = stateError('the campaign summary', e.message);
      [['the enrolment list', enrolCard], ['the enrolment roster', rosterCard],
       ['the mail log', mailCard], ['the silence detector', silenceCard],
       ['campaign activity', activityCard]].forEach(([what, card]) => {
        card.innerHTML = stateError(what, e.message, 'reload');
        card.querySelector('[data-retry]')?.addEventListener('click', boot);
      });
      return;
    }

    const [attn, attnErr]     = await attnRead;
    const [health, healthErr] = await healthRead;

    /* ── Which audit rows belong to the drip ─────────────────────────────────
       workflow_registry exists for exactly this mapping: `audit_name` plus
       `audit_aliases[]` tie a workflow's n8n name to the string it writes into
       audit_log. Reading it means the roster is not built on a guessed regex.
       Where the registry cannot be read, or holds no workflow pointing at the
       lead-trigger webhook, the fallback is a name match and the difference is
       stated on screen rather than hidden. */
    let registry = null;
    const notes = [];
    try {
      registry = await db('workflow_registry?select=name,audit_name,audit_aliases,category,trigger_detail,is_active,writes_audit_log');
    } catch (e) {
      notes.push(`workflow_registry could not be read (${e.message}), so drip runs are matched on the workflow name instead of the registry's audit aliases.`);
    }

    /* The same test on both sources: a workflow is the drip if it triggers on
       the lead-trigger webhook, or if it is named or categorised as one. */
    const looksLikeDrip = w => low(w.trigger_detail).includes(HOOK.warmDrip)
      || /drip|nurture|campaign/i.test(`${w.name || ''} ${w.category || ''}`);

    const dripFlows = (registry || []).filter(looksLikeDrip);
    const dripNames = new Set();
    for (const w of dripFlows) {
      [w.name, w.audit_name, ...(Array.isArray(w.audit_aliases) ? w.audit_aliases : [])]
        .filter(Boolean).forEach(n => dripNames.add(low(n)));
    }
    const matchedByRegistry = dripNames.size > 0;
    const isDrip = a => matchedByRegistry
      ? dripNames.has(low(a.workflow))
      : /drip|nurture/i.test(String(a.workflow || ''));

    if (registry && !matchedByRegistry) {
      notes.push('No workflow_registry row points at the lead-trigger webhook or is named as a drip, so runs are matched on the workflow name.');
    }
    /* An empty roster has two very different causes and they must not look
       alike: nobody enrolled, or the workflow never writes an audit row. */
    const instrumented = matchedByRegistry ? dripFlows.some(w => w.writes_audit_log) : null;
    const commsCapped = comms.length >= LOG_LIMIT;
    const auditCapped = audit.length >= AUDIT_LIMIT;
    if (commsCapped) notes.push(`Only the newest ${num(LOG_LIMIT)} messages were read, so older drip mail is not counted here.`);
    if (auditCapped) notes.push(`Only the newest ${num(AUDIT_LIMIT)} audit rows were read, so enrolments older than those are missing from the roster.`);

    /* ── Derive ──────────────────────────────────────────────────────────── */
    const dripRuns = audit.filter(isDrip);

    /* audit_log arrives newest first, so the first row seen for an address is
       the latest run and the last one seen is the original enrolment. */
    const roster = new Map();
    for (const a of dripRuns) {
      const k = low(a.lead_email);
      if (!k) continue;
      let r = roster.get(k);
      if (!r) { r = { key: k, email: a.lead_email, name: a.lead_name || null, runs: 0, failures: 0, last: a, first: a }; roster.set(k, r); }
      r.runs++;
      if (['FAILED', 'REJECTED'].includes(up(a.status))) r.failures++;
      if (!r.name && a.lead_name) r.name = a.lead_name;
      r.first = a;                                   // overwritten until the oldest row wins
    }
    /* Indices, not ids: audit_log has no primary key in this select, and the
       activity list is what these alerts scroll to, so its row position is the
       only stable handle either side can agree on. */
    const unkeyedIdx  = dripRuns.map((a, i) => (low(a.lead_email) ? -1 : i)).filter(i => i >= 0);
    const nonEmailIdx = dripRuns.map((a, i) => {
      const k = low(a.lead_email);
      return (k && !EMAILISH.test(k)) ? i : -1;
    }).filter(i => i >= 0);
    const failedIdx   = dripRuns.map((a, i) => (['FAILED', 'REJECTED'].includes(up(a.status)) ? i : -1)).filter(i => i >= 0);

    const outbound = comms.filter(c => low(c.direction) === 'outbound');
    const inbound  = comms.filter(c => low(c.direction) === 'inbound');
    const mail     = outbound.filter(isMail).sort((a, b) => ts(b.created_at) - ts(a.created_at));
    const mailBy   = new Map();
    for (const m of mail) {
      const k = low(m.lead_email);
      if (!k) continue;
      if (!mailBy.has(k)) mailBy.set(k, []);
      mailBy.get(k).push(m);
    }
    const inboundBy = new Map();
    for (const c of inbound) {
      const k = low(c.lead_email);
      if (!k) continue;
      if (!inboundBy.has(k)) inboundBy.set(k, []);
      inboundBy.get(k).push(c);
    }
    const lastMail = mail[0] || null;

    const silenced = comms.filter(c => String(c.message || '').startsWith('[SILENCE-ESCALATED]'));

    const leadByEmail = new Map();
    leads.forEach(l => { const k = low(l.email); if (k && !leadByEmail.has(k)) leadByEmail.set(k, l); });
    roster.forEach(r => { if (!r.name) r.name = leadByEmail.get(r.key)?.name || null; });

    const eligible = leads.filter(l => ['WARM', 'COLD'].includes(up(l.status)) && low(l.email));
    const notEnrolled = eligible.filter(l => !roster.has(low(l.email)));
    /* Warm and cold leads with no email at all. They never appear in the table
       below — the drip is addressed by email — so without this they are simply
       invisible on the screen that is supposed to be nurturing them. */
    const noEmailLeads = leads.filter(l => ['WARM', 'COLD'].includes(up(l.status)) && !low(l.email));
    const nurtureable  = eligible.length + noEmailLeads.length;
    const noEmailWithPhone = noEmailLeads.filter(l => str(l.phone)).length;

    /* ── Per-enrolment evidence ──────────────────────────────────────────────
       Mail read is newest-first and capped. If it was capped, a lead enrolled
       before the oldest line we hold might have been mailed outside the window
       — so "nothing was sent to them" would be an accusation the data cannot
       support. Those enrolments are excluded from the zero-send check by name
       and counted, rather than being quietly reported as failures. */
    const commFloor = commsCapped ? ts(comms[comms.length - 1]?.created_at) : 0;
    const nowMs = Date.now();
    roster.forEach(r => {
      const since = ts(r.first.logged_at);
      r.since = since;
      r.mails   = (mailBy.get(r.key) || []).filter(x => ts(x.created_at) >= since);
      r.replies = (inboundBy.get(r.key) || []).filter(x => ts(x.created_at) >= since)
        .sort((a, b) => ts(b.created_at) - ts(a.created_at));
      r.judgeable = since >= commFloor;
      /* Within the sequence window the remaining steps are still queued inside
         n8n; past it the sequence has run out by itself. The two need different
         actions from the operator, so they are not merged. */
      r.midSequence = since > 0 && (nowMs - since) < SEQUENCE_DAYS * 86400000;
      r.lead = leadByEmail.get(r.key) || null;
      r.addressable = EMAILISH.test(r.key);
    });
    const rosterAll   = [...roster.values()];
    const judgeable   = rosterAll.filter(r => r.judgeable);
    const unjudgeable = rosterAll.length - judgeable.length;
    const zeroSend    = judgeable.filter(r => !r.mails.length)
      .sort((a, b) => a.since - b.since);
    const replied     = rosterAll.filter(r => r.replies.length)
      .sort((a, b) => Number(b.midSequence) - Number(a.midSequence) || ts(b.replies[0].created_at) - ts(a.replies[0].created_at));
    const repliedMid  = replied.filter(r => r.midSequence);
    const unaddressable = rosterAll.filter(r => !r.addressable);

    /* Enrolments made in this browser session. Recorded only after a 2xx and
       always labelled as our own receipt — it is not a row in audit_log until
       the workflow puts one there. */
    const sent = new Map();

    /* ── Identity, in one place ──────────────────────────────────────────────
       The roster, the mail log, the silence list and the alert strip all key on
       an email address and nothing else, so the phone number has to be looked
       up on the leads table. Where no lead row matches the address the number
       is genuinely unknown, and the em dash says which of the two it is in its
       tooltip rather than leaving a blank that could mean either. */
    function nameHtml(name) {
      const n = str(name);
      if (!n) return '<span class="t-warm">Unnamed contact</span>';
      if (HANDLE.test(n)) {
        return '<span class="t-warm">Unnamed contact</span> '
          + `<span class="chip mono" title="This is a WhatsApp chat handle stored as a name, not a person's name. A LID contains no phone digits and identifies nobody.">${esc(n)}</span>`;
      }
      return esc(n);
    }
    const phoneHtml = (phone, lead) => str(phone)
      ? `<span class="mono">${esc(str(phone))}</span>`
      : lead
        ? '<span class="t-muted" title="The lead row for this address carries no phone number">—</span>'
        : '<span class="t-muted" title="No lead row matches this address, so there is no phone number to look up">—</span>';

    function personOf(email, fallbackName) {
      const k = low(email);
      const lead = k ? leadByEmail.get(k) || null : null;
      return {
        lead,
        name: str(lead?.name) || str(fallbackName),
        email: str(email) || str(lead?.email),
        phone: str(lead?.phone),
      };
    }
    /* Name and number on one line, for the places that have no second line. */
    const personLine = p => `${nameHtml(p.name)} <span class="t-muted">·</span> ${phoneHtml(p.phone, p.lead)}`;

    const chipFor = p => p.lead
      ? `<button type="button" class="chip" style="border:0;cursor:pointer;font-family:inherit" data-lead="${esc(p.lead.id)}"
          title="Open this lead">${personLine(p)}</button>`
      : `<span class="chip" title="No lead row matches ${esc(p.email || 'this contact')}, so there is nothing to open">${personLine(p)}</span>`;

    const previewOf = people => {
      const shown = people.slice(0, PREVIEW).map(chipFor).join(' ');
      const rest = people.length - Math.min(people.length, PREVIEW);
      return `${shown}${rest ? ` <span class="t-muted">+${num(rest)} more</span>` : ''}`;
    };

    /* ── Is email actually able to leave? ────────────────────────────────────
       Three states, and the difference between them is the whole point:
         broken   — a workflow recorded a mail-credential failure. Read verbatim.
         degraded — no credential row, but the drip workflow has failures inside
                    v_workflow_health's 30-day window.
         unknown  — nothing recorded. NOT the same as "working": the credential
                    itself is not readable from the browser. */
    const viewRowsAll   = (attn || []).slice().sort((a, b) => ts(b.at) - ts(a.at));
    const forThisScreen = viewRowsAll.filter(i => low(i.screen) === SCREEN_ID);
    const credFailures  = viewRowsAll.filter(i => low(i.kind) === 'workflow_failure'
      && CREDENTIAL_RE.test(`${str(i.title)} ${str(i.detail)}`)
      && MAILER_RE.test(`${str(i.title)} ${str(i.detail)}`));

    const dripHealth = (health || []).filter(looksLikeDrip);
    const dripFail30 = dripHealth.reduce((s, w) => s + (n0(w.failures_30d) || 0), 0);
    const dripRun30  = dripHealth.reduce((s, w) => s + (n0(w.runs_30d) || 0), 0);
    const dripLastFailure = dripHealth.map(w => w.last_failure).filter(Boolean)
      .sort((a, b) => ts(b) - ts(a))[0] || null;
    const dripOff = dripHealth.length
      ? dripHealth.every(w => w.is_active === false)
      : (dripFlows.length ? dripFlows.every(w => w.is_active === false) : false);

    const delivery = credFailures.length ? 'broken' : (dripFail30 > 0 ? 'degraded' : 'unknown');

    /* One sentence, used in the button titles and the confirm dialog. The
       dialog is where the irreversible click is taken, so it has to carry the
       same fact the strip carries — not a softer version of it. */
    const deliveryTitle = delivery === 'broken'
      ? 'Email delivery is broken right now: a workflow recorded a mail credential failure. Enrolling queues the sequence, but no email leaves until the credential is reconnected.'
      : delivery === 'degraded'
        ? `The drip workflow logged ${dripFail30} ${plural(dripFail30, 'failure', 'failures')} in the last 30 days, so a queued sequence may not actually send.`
        : 'Enrolling queues the sequence inside n8n. Whether the mail then leaves cannot be confirmed from this dashboard — no credential failure is recorded, but the credential itself is not readable from the browser.';

    const deliveryEvidence = lastMail
      ? `The most recent outbound mail row in communication_logs was logged ${esc(ago(lastMail.created_at))} (${esc(stamp(lastMail.created_at))}).`
      : `No outbound mail row exists in the ${num(comms.length)} ${plural(comms.length, 'message', 'messages')} read, ever.`;

    const dripHealthLine = healthErr
      ? `v_workflow_health could not be read (${esc(healthErr.message)}), so nothing here can say how the drip workflow itself is behaving.`
      : dripHealth.length
        ? `v_workflow_health lists ${num(dripHealth.length)} drip ${plural(dripHealth.length, 'workflow', 'workflows')} `
          + `(${dripHealth.map(w => `<span class="mono">${esc(str(w.name) || 'unnamed')}</span> — ${esc(str(w.health) || 'no health state')}`).join(', ')}), `
          + `${num(dripRun30)} ${plural(dripRun30, 'run', 'runs')} and ${num(dripFail30)} ${plural(dripFail30, 'failure', 'failures')} in the last 30 days`
          + `${dripLastFailure ? `, most recent failure ${esc(ago(dripLastFailure))}` : ''}.`
        : 'No row in v_workflow_health triggers on the lead-trigger webhook or is named as a drip, so the workflow behind this screen is not registered and its health cannot be reported.';

    /* ── Alerts ──────────────────────────────────────────────────────────────
       Every one of these is computed from rows already read above. `target` is
       the card the row scrolls to and `keys` the rows it highlights there; an
       alert with no target says why it cannot be opened instead of being a
       click that silently does nothing. */
    const alerts = [];

    if (delivery === 'broken') {
      const top = credFailures[0];
      alerts.push({
        key: 'email',
        sev: 'CRITICAL',
        icon: 'unsubscribe',
        chip: 'email delivery',
        title: 'Email delivery is broken right now — every “Enrolled” row on this screen means queued, not delivered',
        detailHtml: `A workflow recorded this verbatim: <span class="mono">${esc(str(top.detail) || str(top.title) || 'no detail on the row')}</span>. `
          /* Where the row is filed matters, and getting it wrong in either
             direction is a lie: claiming an automation row was raised about
             campaigns, or claiming a campaigns row belongs to somebody else. */
          + `Raised ${esc(ago(top.at))}${!str(top.screen) ? ''
            : low(top.screen) === SCREEN_ID
              ? ' and filed by v_needs_attention against this screen — it is listed above as well'
              : ` and filed by v_needs_attention against the <span class="mono">${esc(str(top.screen))}</span> screen, not this one; it is repeated here because every send step of the drip goes out through that same mailbox`}. `
          + `${credFailures.length > 1 ? `${num(credFailures.length)} such failures are recorded. ` : ''}`
          + `${dripHealthLine} ${deliveryEvidence} `
          + `Enrolling still works: <span class="mono">${esc(HOOK.warmDrip)}</span> queues the sequence inside n8n. Nothing in that sequence can reach a customer until the credential is reconnected.`,
        target: mailCard,
        keys: null,
        hint: 'Show the outbound mail log',
      });
    } else if (delivery === 'degraded') {
      alerts.push({
        key: 'email',
        sev: 'WARNING',
        icon: 'error',
        chip: 'email delivery',
        title: `The drip workflow logged ${num(dripFail30)} ${plural(dripFail30, 'failure', 'failures')} in the last 30 days`,
        detailHtml: `${dripHealthLine} No mail-credential failure is recorded in v_needs_attention, so this is the workflow failing for some other reason. `
          + `${deliveryEvidence} ${esc(NOT_PROBED)}`,
        target: mailCard,
        keys: null,
        hint: 'Show the outbound mail log',
      });
    }

    if (repliedMid.length || replied.length) {
      const stale = replied.length - repliedMid.length;
      alerts.push({
        key: 'replied',
        sev: repliedMid.length ? 'CRITICAL' : 'WARNING',
        icon: 'reply',
        chip: 'answered you',
        title: `${num(replied.length)} enrolled ${plural(replied.length, 'lead has', 'leads have')} replied since being enrolled`,
        detailHtml: `Each of these has at least one inbound row in communication_logs dated at or after their first drip run — they answered, and the sequence was still scheduled to talk over them. `
          + (repliedMid.length
            ? `${num(repliedMid.length)} ${plural(repliedMid.length, 'was', 'were')} enrolled within the last ${SEQUENCE_DAYS} days, so the remaining steps of ${plural(repliedMid.length, 'that sequence is', 'those sequences are')} still queued inside n8n; the workflow has no reply-detection step, so nothing stops them. `
            : '')
          + (stale
            ? `${num(stale)} ${plural(stale, 'was', 'were')} enrolled more than ${SEQUENCE_DAYS} days ago, so ${plural(stale, 'that sequence has', 'those sequences have')} run out on ${plural(stale, 'its', 'their')} own — the reply is still unanswered by anybody here. `
            : '')
          + (commsCapped
            ? `The message read was capped at ${num(LOG_LIMIT)} rows, so a reply older than that would not be seen — this count can only be too low, never too high.`
            : `Counted across the ${num(comms.length)} ${plural(comms.length, 'message', 'messages')} read.`),
        peopleHtml: previewOf(replied.map(r => personOf(r.key, r.name))),
        footHtml: `<button class="btn sm" type="button" disabled title="${esc(NO_CANCEL_HOOK)}">Stop the sequence</button>
          <span class="cell-sub" style="margin-left:8px">No webhook exists to cancel an enrolment — see the button's tooltip.</span>`,
        target: rosterCard,
        keys: new Set(replied.map(r => r.key)),
        hint: 'Show these people in the enrolment roster',
      });
    }

    if (zeroSend.length) {
      const allSilent = zeroSend.length === judgeable.length;
      alerts.push({
        key: 'zerosend',
        sev: 'CRITICAL',
        icon: 'mark_email_unread',
        chip: 'zero sends',
        title: allSilent
          ? `The drip has sent nothing since it was started — all ${num(judgeable.length)} ${plural(judgeable.length, 'enrolment', 'enrolments')} have zero logged sends`
          : `${num(zeroSend.length)} of ${num(judgeable.length)} ${plural(judgeable.length, 'enrolment has', 'enrolments have')} zero logged sends`,
        detailHtml: `No outbound mail row exists in communication_logs at or after ${plural(zeroSend.length, 'this enrolment', 'these enrolments')}. `
          + `The oldest has been enrolled since ${esc(ago(zeroSend[0].first.logged_at))} (${esc(stamp(zeroSend[0].first.logged_at))}). `
          + 'communication_logs records no workflow id, so <em>any</em> outbound mail row on or after the enrolment counts as a send here — the test is as generous as it can be made, and it still comes back zero. '
          + (delivery === 'broken'
            ? 'That is consistent with the credential failure above: the sequence is queueing and the mailbox is dead.'
            : 'Nothing above explains it, which makes it worth opening n8n on.')
          + (unjudgeable
            ? ` ${num(unjudgeable)} further ${plural(unjudgeable, 'enrolment is', 'enrolments are')} not judged by this check at all: ${plural(unjudgeable, 'it predates', 'they predate')} the oldest message this screen read, so mail sent to ${plural(unjudgeable, 'it', 'them')} could sit outside the ${num(LOG_LIMIT)}-row window.`
            : ''),
        peopleHtml: previewOf(zeroSend.map(r => personOf(r.key, r.name))),
        target: rosterCard,
        keys: new Set(zeroSend.map(r => r.key)),
        hint: 'Show these people in the enrolment roster',
      });
    }

    if (unkeyedIdx.length || unaddressable.length) {
      const bad = unkeyedIdx.length + nonEmailIdx.length;
      alerts.push({
        key: 'unaddressed',
        sev: 'CRITICAL',
        icon: 'alternate_email',
        chip: 'no address',
        title: `${num(bad)} drip ${plural(bad, 'run has', 'runs have')} no usable email address on the audit row`,
        detailHtml: (unkeyedIdx.length
            ? `${num(unkeyedIdx.length)} ${plural(unkeyedIdx.length, 'run carries', 'runs carry')} no <span class="mono">lead_email</span> at all. `
            : '')
          + (nonEmailIdx.length
            ? `${num(nonEmailIdx.length)} ${plural(nonEmailIdx.length, 'run carries', 'runs carry')} a <span class="mono">lead_email</span> that is not an email address `
            + `(${unaddressable.slice(0, PREVIEW).map(r => `<span class="mono">${esc(r.email || r.key)}</span>`).join(', ')}${unaddressable.length > PREVIEW ? `, +${num(unaddressable.length - PREVIEW)} more` : ''}). `
            : '')
          + 'This is an email sequence with nowhere to send to: those runs cannot have delivered anything, and they cannot be attached to a customer either. '
          + 'A run reaching this state means something upstream enrolled a lead without checking it had an address.',
        target: activityCard,
        keys: new Set([...unkeyedIdx, ...nonEmailIdx].map(i => `run-${i}`)),
        hint: 'Show these runs in campaign activity',
      });
    }

    if (failedIdx.length) {
      alerts.push({
        key: 'failed',
        sev: 'CRITICAL',
        icon: 'error',
        chip: 'failed runs',
        title: `${num(failedIdx.length)} drip ${plural(failedIdx.length, 'run', 'runs')} logged FAILED or REJECTED`,
        detailHtml: `Out of ${num(dripRuns.length)} drip ${plural(dripRuns.length, 'run', 'runs')} in the audit log. `
          + 'The workflow itself recorded these as failures, so the enrolment did not even queue cleanly — this is separate from whether the mail later went out.',
        target: activityCard,
        keys: new Set(failedIdx.map(i => `run-${i}`)),
        hint: 'Show these runs in campaign activity',
      });
    }

    if (dripOff) {
      alerts.push({
        key: 'off',
        sev: 'CRITICAL',
        icon: 'toggle_off',
        chip: 'workflow off',
        title: 'Every registered drip workflow is switched off',
        detailHtml: (dripHealth.length ? 'v_workflow_health' : 'workflow_registry')
          + ` reports <span class="mono">is_active = false</span> on every workflow that triggers on <span class="mono">${esc(HOOK.warmDrip)}</span> or is named as a drip. `
          + 'An enrolment posted from this screen would be accepted by the webhook and then picked up by nothing.',
        target: null,
        why: 'This is a workflow state, not a row on this screen. The Automation screen is where a workflow is switched back on.',
      });
    }

    if (noEmailLeads.length) {
      alerts.push({
        key: 'noemail',
        sev: 'WARNING',
        icon: 'contact_page',
        chip: 'unreachable',
        title: `${num(noEmailLeads.length)} warm or cold ${plural(noEmailLeads.length, 'lead has', 'leads have')} no email address, so the drip cannot reach ${plural(noEmailLeads.length, 'them', 'any of them')}`,
        detailHtml: `Out of ${num(nurtureable)} warm and cold ${plural(nurtureable, 'lead', 'leads')} read here. `
          + 'The 7-day sequence is addressed by email, so these leads are excluded from the enrolment table below entirely — without this line they are simply invisible on the screen that is meant to be nurturing them. '
          + `${num(noEmailWithPhone)} of them ${plural(noEmailWithPhone, 'has', 'have')} a phone number, which is the only way anybody is reaching them today.`,
        peopleHtml: previewOf(noEmailLeads.map(l => ({ lead: l, name: str(l.name), email: '', phone: str(l.phone) }))),
        target: null,
        why: 'These leads have no email address, so they do not appear in the enrolment table below and there is no row on this screen to scroll to.',
      });
    }

    /* ── Provenance. Every count above has to be explainable, including the
       ones that are missing. A read that failed is named, not silently folded
       into a smaller number. ─────────────────────────────────────────────── */
    const stripNotes = [
      attnErr
        ? `v_needs_attention could not be read (${attnErr.message}), so anything the database filed against this screen is missing from this strip — and the Gmail credential failure it carries could not be checked either. Everything else above was computed here.`
        : forThisScreen.length
          ? `${num(forThisScreen.length)} ${plural(forThisScreen.length, 'row', 'rows')} above ${plural(forThisScreen.length, 'comes', 'come')} from v_needs_attention filed against Campaigns.`
          : 'v_needs_attention returned no row filed against Campaigns, so every alert above was computed on this screen from the rows it read.',
      healthErr
        ? `v_workflow_health could not be read (${healthErr.message}), so the drip workflow's own health is missing from the email-delivery alert.`
        : '',
      delivery === 'unknown' ? `${NOT_PROBED} No mail-credential failure is recorded and the drip workflow logged no failure in the last 30 days.` : '',
      /* Said whether or not the zero-send alert fired. Otherwise an enrolment
         the screen refused to judge would vanish from every count on the page
         without anybody being told it had been set aside. */
      unjudgeable
        ? `${num(unjudgeable)} ${plural(unjudgeable, 'enrolment is', 'enrolments are')} older than the oldest message this screen read, so whether anything was ever sent to ${plural(unjudgeable, 'them', 'them')} cannot be decided from the ${num(LOG_LIMIT)} rows read. ${plural(unjudgeable, 'It is', 'They are')} marked "not judged" in the roster and counted in no send figure above.`
        : '',
      alerts.length > 1 ? 'A lead can satisfy more than one alert, so these counts overlap and do not add up to a total.' : '',
      ...notes,
    ].filter(Boolean);

    /* ── Render the strip ────────────────────────────────────────────────────
       Filled last, after the cards below exist, because the click handlers
       resolve `[data-key]` rows inside them. */
    const viewRowsHtml = forThisScreen.map(it => {
      const sev = str(it.severity);
      return `<div class="list-item" style="cursor:default">
        <span class="material-symbols-outlined t-${esc(sevTone(sev) || 'muted')}" style="font-size:20px" aria-hidden="true">${esc(KIND_ICON[low(it.kind)] || 'warning')}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${sev ? pill(sev, sevTone(sev)) : ''}${esc(str(it.title) || str(it.kind) || 'Attention item')}
            <span class="chip">${esc(str(it.kind) || 'item')}</span>
            <span class="chip" title="Raised by v_needs_attention, the shared cross-screen alert view, not computed on this screen.">shared</span>
          </div>
          <div class="cell-sub" style="white-space:normal">${esc(str(it.detail) || 'The view recorded no detail for this row.')}</div>
          <div class="cell-sub t-muted">${esc(str(it.ref) ? `Keyed on ${str(it.ref)} — ` : '')}${it.at
            ? `waiting since ${esc(stamp(it.at))}, ${esc(ago(it.at))}`
            : 'the view gave this item no timestamp, so how long it has been waiting is unknown'}</div>
        </div>
      </div>`;
    }).join('');

    const alertRowsHtml = alerts.map(a => `
      <div class="list-item"${a.target
          ? ` role="button" tabindex="0" data-alert="${esc(a.key)}" title="${esc(a.hint || 'Show the rows this is about')}"`
          : ' style="cursor:default"'}>
        <span class="material-symbols-outlined t-${esc(sevTone(a.sev) || 'muted')}" style="font-size:20px" aria-hidden="true">${esc(a.icon)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${pill(a.sev, sevTone(a.sev))}${esc(a.title)}
            ${a.chip ? `<span class="chip">${esc(a.chip)}</span>` : ''}
          </div>
          <div class="cell-sub" style="white-space:normal">${a.detailHtml}</div>
          ${a.peopleHtml ? `<div class="cell-sub" style="margin-top:6px">${a.peopleHtml}</div>` : ''}
          ${a.why ? `<div class="cell-sub t-muted" style="margin-top:4px">${esc(a.why)}</div>` : ''}
          ${a.footHtml ? `<div style="margin-top:8px;display:flex;align-items:center;flex-wrap:wrap">${a.footHtml}</div>` : ''}
        </div>
        ${a.target ? '<span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">chevron_right</span>' : ''}
      </div>`).join('');

    /* The honest empty case. Not a box with nothing in it: a sentence naming
       what was checked and what came back, so "no alerts" reads as a result
       rather than as a panel that failed to load. */
    const nothingHtml = `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined t-${attnErr ? 'warm' : 'ok'}" style="font-size:20px" aria-hidden="true">${attnErr ? 'help' : 'task_alt'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500">${attnErr
          ? 'Nothing this screen can check is wrong — but the shared alert view did not load'
          : 'Nothing on this screen needs attention right now'}</div>
        <div class="cell-sub" style="white-space:normal">${attnErr
          ? 'v_needs_attention could not be read, so anything the database itself would have raised — including the mail-credential failure that decides whether this screen can send at all — is unknown right now. '
          : 'v_needs_attention returned no row filed against Campaigns, no mail-credential failure is recorded anywhere in it, and '}Across the
          ${num(dripRuns.length)} drip ${plural(dripRuns.length, 'run', 'runs')} and ${num(comms.length)} ${plural(comms.length, 'message', 'messages')} read here:
          every judged enrolment has a logged send, nobody who replied is still being sequenced, every drip run carries a usable email address,
          and no run is logged as failed.</div>
      </div>
    </div>`;

    const notesHtml = stripNotes.length ? `<div class="list-item" style="cursor:default">
      <span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">info</span>
      <div class="cell-sub" style="white-space:normal">${stripNotes.map(esc).join('<br>')}</div>
    </div>` : '';

    /* ── Summary strip ───────────────────────────────────────────────────── */
    const failedRuns = failedIdx.length;

    strip.innerHTML = [
      kpi('Leads enrolled', num(roster.size),
        roster.size
          ? `${num(dripRuns.length)} drip ${plural(dripRuns.length, 'run', 'runs')} in the audit log`
            + (zeroSend.length ? `<br><span class="t-hot">${num(zeroSend.length)} with nothing sent since enrolment</span>` : '')
          : instrumented === false
            ? '<span class="t-warm">The drip workflow does not write to the audit log, so enrolments cannot be counted</span>'
            : '<span class="t-muted">No drip run has ever been logged</span>'),
      kpi('Replied while enrolled', num(replied.length),
        replied.length
          ? `<span class="t-hot">${num(repliedMid.length)} still inside the ${SEQUENCE_DAYS}-day sequence</span>`
          : roster.size
            ? '<span class="t-muted">No enrolled lead has written back since being enrolled</span>'
            : '<span class="t-muted">Nobody is enrolled, so there is nothing to answer</span>',
        replied.length ? 't-hot' : ''),
      kpi('Runs failed', num(failedRuns),
        failedRuns
          ? '<span class="t-hot">Logged FAILED or REJECTED by the workflow</span>'
          : dripRuns.length
            ? '<span class="t-ok">Every logged drip run succeeded</span>'
            : '<span class="t-muted">Nothing logged to judge</span>',
        failedRuns ? 't-hot' : ''),
      kpi('Outbound mail logged', num(mail.length),
        lastMail
          ? `Last one ${ago(lastMail.created_at)}`
          : delivery === 'broken'
            ? '<span class="t-hot">Nothing recorded — consistent with the mail credential failure above</span>'
            : '<span class="t-hot">Nothing recorded in the messages read</span>',
        lastMail ? '' : 't-hot'),
      kpi('Silence escalations', num(silenced.length),
        silenced.length
          ? '<span class="t-warm">Twelve hours with no reply</span>'
          : '<span class="t-muted">Nobody has gone quiet</span>'),
    ].join('');

    /* ── Enrol a lead ─────────────────────────────────────────────────────── */
    const blockedGlobal = !N8N_BASE
      ? 'VITE_N8N_BASE_URL is not set in this build, so no n8n workflow can be called from the browser.'
      : null;

    enrolCard.innerHTML = `
      <div class="card-head">
        <div>
          <div class="card-title">Enrol a lead in the 7-day drip</div>
          <div class="card-sub">Day 1 welcome, day 3 follow-up, day 7 final offer — queued by n8n over the following week, never sent by this browser.
            Warm and cold leads that have an email address. Any other lead can be enrolled from the Leads screen.</div>
        </div>
      </div>
      <div class="toolbar">
        <div class="seg" id="cpSeg" role="group" aria-label="Filter leads by enrolment">
          ${FILTERS.map(([k, label], i) => `<button type="button" data-f="${k}" class="${i === 0 ? 'on' : ''}"
            aria-pressed="${i === 0 ? 'true' : 'false'}">${esc(label)}</button>`).join('')}
        </div>
        <div class="grow">
          <label class="sr-only" for="cpQ">Search leads</label>
          <input type="search" id="cpQ" placeholder="Search name, email, phone or vehicle" />
        </div>
        <div class="t-muted num" id="cpCount"></div>
      </div>
      <div id="cpTable"></div>`;

    const qBox   = enrolCard.querySelector('#cpQ');
    const countEl = enrolCard.querySelector('#cpCount');
    const tableHost = enrolCard.querySelector('#cpTable');
    let filter = 'new', q = '';

    const cols = [
      /* Name and number together: almost every alert on this screen resolves to
         "phone them", and a roster that only carries an email address makes the
         operator go and look the number up somewhere else. */
      { label:'Lead', strong:true, render: l => `${nameHtml(l.name)} <span class="t-muted">·</span> ${phoneHtml(l.phone, l)}
          <div class="cell-sub">${esc(str(l.email))}</div>` },
      { label:'Status', render: l => pill(l.status || 'NEW') },
      { label:'Interest', render: l => `<span class="t-2">${esc(l.vehicle_interest || '—')}</span>` },
      /* budget_aed is NULL for router-created leads. A zero here would understate
         the value of the people being nurtured, so it stays a dash. */
      { label:'Budget', align:'r', render: l => n0(l.budget_aed) == null ? '<span class="t-muted">—</span>' : aed(l.budget_aed) },
      { label:'Score', align:'r', render: l => n0(l.ai_score) == null ? '<span class="t-muted">—</span>' : num(l.ai_score) },
      { label:'Enrolment', render: l => {
          const r = roster.get(low(l.email));
          const mine = sent.get(low(l.email));
          const bits = [];
          if (r) {
            bits.push(`${pill('Enrolled', 'ok')} <span class="cell-sub">${esc(ago(r.first.logged_at))} · ${num(r.runs)} ${plural(r.runs, 'run', 'runs')}</span>`);
            if (r.replies.length) bits.push(`<div class="cell-sub t-hot">Replied ${esc(ago(r.replies[0].created_at))} — ${r.midSequence ? 'the rest of the sequence is still queued' : 'after the sequence had finished'}</div>`);
            if (r.judgeable && !r.mails.length) bits.push('<div class="cell-sub t-hot">Nothing sent since enrolment</div>');
            if (r.failures) bits.push(`<div class="cell-sub t-hot">${num(r.failures)} logged as failed</div>`);
          }
          if (mine) bits.push(`<div class="cell-sub t-ok">Queued ${esc(ago(mine))} · this session, not yet in the audit log</div>`);
          if (!bits.length) bits.push('<span class="t-muted">Not enrolled</span>');
          return bits.join('');
        } },
      { label:'', align:'r', render: l => {
          const title = blockedGlobal || deliveryTitle;
          return `<button class="btn sm" data-enrol="${esc(l.id)}"
            aria-label="Enrol ${esc(str(l.name) || str(l.email))} in the 7-day drip"
            title="${esc(title)}"${blockedGlobal ? ' disabled' : ''}>Enrol</button>`;
        } },
    ];

    function visible() {
      const base = filter === 'on'  ? eligible.filter(l => roster.has(low(l.email)))
                 : filter === 'new' ? eligible.filter(l => !roster.has(low(l.email)))
                 : eligible;
      if (!q) return base;
      return base.filter(l => `${l.name || ''} ${l.email || ''} ${l.phone || ''} ${l.vehicle_interest || ''}`.toLowerCase().includes(q));
    }

    function drawTable() {
      const rows = visible();
      countEl.textContent = `${rows.length} of ${eligible.length} warm & cold leads`;
      tableHost.innerHTML = eligible.length
        ? table(cols, rows, {
            onRow: true,
            empty: stateEmpty(
              q ? 'No lead matches this search' :
              filter === 'new' ? 'Every eligible lead is already enrolled' : 'No eligible lead is enrolled yet',
              q ? 'Try a different search term or another filter.'
                : filter === 'new' ? 'Every warm and cold lead with an email address already has a drip run in the audit log.'
                : 'No warm or cold lead has a drip run recorded against it.',
              q ? 'search_off' : 'campaign'),
          })
        : stateEmpty('No warm or cold leads with an email address',
            'The drip is addressed by email, so a lead needs one to qualify. Every other lead is either HOT, unscored, or has no email on record.',
            'campaign');
      wireRows(tableHost, rows, leadDrawer);
      tableHost.querySelectorAll('button[data-enrol]').forEach(b => b.addEventListener('click', ev => {
        /* The row opens the lead drawer; the action button must not do both. */
        ev.stopPropagation();
        const lead = rows.find(r => String(r.id) === b.dataset.enrol);
        if (lead) confirmEnrol(lead);
      }));
    }

    enrolCard.querySelectorAll('#cpSeg button').forEach(b => b.addEventListener('click', () => {
      filter = b.dataset.f;
      enrolCard.querySelectorAll('#cpSeg button').forEach(x => {
        const on = x === b;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      drawTable();
    }));
    qBox.addEventListener('input', e => { q = low(e.target.value); drawTable(); });
    drawTable();

    /* One confirm step, then one unambiguous outcome. The dialog stays open on
       failure carrying the error verbatim, because "it didn't work" without the
       reason sends the operator into n8n's execution list to guess.

       The delivery warning is repeated here on purpose: this is where the
       irreversible click is taken, and it now carries the live state rather
       than a sentence that was true when the file was written. */
    function confirmEnrol(lead) {
      const existing = roster.get(low(lead.email));
      const m = openModal('Enrol in the 7-day drip', `
        <div class="banner ${delivery === 'broken' ? 'hot' : 'warm'}">
          <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">unsubscribe</span>
          <div>${esc(deliveryTitle)}</div>
        </div>
        ${existing ? `<div class="banner warm">
          <span class="material-symbols-outlined" style="font-size:20px" aria-hidden="true">repeat</span>
          <div>This lead is already enrolled — first run logged ${esc(ago(existing.first.logged_at))}, ${num(existing.runs)} ${plural(existing.runs, 'run', 'runs')} in total.
            Enrolling again starts a second sequence; the workflow does not de-duplicate.
            ${existing.replies.length ? `They replied ${esc(ago(existing.replies[0].created_at))} — enrolling them again means answering that reply with an automated welcome message.` : ''}</div>
        </div>` : ''}
        <p class="t-2" style="margin:0 0 16px">Day 1 welcome, day 3 follow-up, day 7 final offer. The sequence is queued inside n8n over the
          following week — this browser sends nothing and writes nothing to the database.</p>
        <dl class="kv">
          <dt>Lead</dt><dd>${nameHtml(lead.name)}</dd>
          <dt>Phone</dt><dd>${phoneHtml(lead.phone, lead)}</dd>
          <dt>Email</dt><dd>${esc(str(lead.email))}</dd>
          <dt>Vehicle</dt><dd>${esc(lead.vehicle_interest || '—')}</dd>
          <dt>Status</dt><dd>${pill(lead.status || 'NEW')}</dd>
          <dt>AI score</dt><dd>${n0(lead.ai_score) == null ? '<span class="t-muted">Not scored</span>' : num(lead.ai_score)}</dd>
        </dl>`,
        `<button class="btn primary" id="cpGo">${existing ? 'Enrol again' : 'Enrol this lead'}</button>
         <button class="btn" id="cpCancel">Cancel</button>`);

      const goBtn = m.wrap.querySelector('#cpGo');
      const cancel = m.wrap.querySelector('#cpCancel');
      goBtn.focus();
      cancel.addEventListener('click', m.close);
      goBtn.addEventListener('click', async () => {
        const label = goBtn.textContent;
        goBtn.disabled = true; cancel.disabled = true; goBtn.textContent = 'Enrolling…';
        m.msg('<span class="t-muted">Calling the lead-trigger workflow…</span>');
        try {
          /* These three field names are not a free choice. Normalize Lead Input
             inside the workflow reads exactly these, and a dashboard/workflow
             vocabulary mismatch is what kept the drip at zero successful runs
             before — so it is written once, here, and matches what the Leads
             screen posts to the same hook. */
          await n8n(HOOK.warmDrip, {
            lead_email: lead.email,
            lead_name: lead.name || '',
            vehicle_interest: lead.vehicle_interest || '',
          });
          sent.set(low(lead.email), new Date().toISOString());
          goBtn.textContent = 'Enrolled';
          cancel.disabled = false; cancel.textContent = 'Close';
          m.msg('<span class="t-ok">The workflow accepted the enrolment.</span> '
              + `<span class="${delivery === 'broken' ? 't-hot' : 't-warm'}">${esc(deliveryTitle)}</span>`);
          drawTable();
        } catch (e) {
          goBtn.disabled = false; cancel.disabled = false; goBtn.textContent = label;
          m.msg(`<span class="t-hot">Nothing was enrolled — ${esc(e.message)}</span>`);
        }
      });
    }

    /* ── Enrolment roster ─────────────────────────────────────────────────── */
    const rosterRows = rosterAll.slice().sort((a, b) => ts(b.last.logged_at) - ts(a.last.logged_at));

    rosterCard.innerHTML = `
      <div class="card-head"><div>
        <div class="card-title">Who is enrolled</div>
        <div class="card-sub">Built from drip runs in <span class="mono">audit_log</span>, newest activity first.
          Mail counted per lead is every outbound mail row logged at or after that lead's first run.</div>
      </div></div>
      <div style="max-height:46vh;overflow-y:auto">${rosterRows.length
        ? rosterRows.map(r => {
            const p = personOf(r.key, r.name);
            /* One style attribute, not two: a second `style=` on the same tag is
               dropped by the parser, which silently lost the row's alignment. */
            return `<div class="list-item" data-key="${esc(r.key)}"${p.lead
                ? ` role="button" tabindex="0" data-lead-row="${esc(p.lead.id)}" title="Open this lead" style="align-items:flex-start"`
                : ' style="align-items:flex-start;cursor:default"'}>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <span style="font-weight:500">${personLine(p)}</span>
                  ${pill(r.last.status || 'Unknown')}
                  ${r.replies.length ? `<span class="chip t-hot" title="This contact wrote back after being enrolled. Continuing a sequence after someone has answered is the thing this screen exists to catch.">replied ${esc(ago(r.replies[0].created_at))}</span>` : ''}
                  ${r.failures ? `<span class="chip t-hot">${num(r.failures)} failed</span>` : ''}
                  ${r.addressable ? '' : '<span class="chip t-hot" title="The audit row carries this in lead_email, but it is not an email address, so an email sequence has nowhere to send.">not an email address</span>'}
                </div>
                <div class="cell-sub">${esc(str(r.email) || 'no email on the audit row')} · enrolled ${esc(ago(r.first.logged_at))} · ${num(r.runs)} ${plural(r.runs, 'run', 'runs')}</div>
                ${r.replies.length ? `<div class="cell-sub t-hot">“${esc(String(r.replies[0].message || '').replace(/\s+/g, ' ').trim().slice(0, 140))}”</div>` : ''}
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div class="num" style="font-weight:500">${num(r.mails.length)}</div>
                <div class="cell-sub">${r.mails.length
                  ? 'mail logged since'
                  : r.judgeable
                    ? '<span class="t-hot">no mail logged</span>'
                    : '<span class="t-warm" title="This enrolment is older than the oldest message read, so mail sent to them could sit outside the window. It is not counted as a zero.">not judged</span>'}</div>
              </div>
            </div>`;
          }).join('')
          + (unkeyedIdx.length ? `<div class="list-item" style="cursor:default">
              <span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">info</span>
              <div class="cell-sub" style="white-space:normal">${num(unkeyedIdx.length)} drip ${plural(unkeyedIdx.length, 'run has', 'runs have')} no lead_email on the audit row and cannot be attached to anybody.</div>
            </div>` : '')
        : stateEmpty('Nobody is enrolled',
            instrumented === false
              ? 'The registered drip workflow does not write to the audit log, so enrolments cannot be listed here even if leads are mid-sequence. Instrument the workflow to see this roster.'
              : 'No drip run has been logged. Enrol a warm or cold lead above and the workflow writes its first row here.',
            'group_off')}</div>`;

    /* ── What has actually been sent ─────────────────────────────────────── */
    mailCard.innerHTML = `
      <div class="card-head"><div>
        <div class="card-title">Outbound mail logged</div>
        <div class="card-sub">Every outbound row in <span class="mono">communication_logs</span> whose channel mentions mail, newest first.
          The table records no workflow id, so drip mail cannot be separated from other outbound mail.</div>
      </div></div>
      <div style="max-height:46vh;overflow-y:auto">${mail.length
        ? mail.map(msg => {
            const p = personOf(msg.lead_email, null);
            return `<div class="list-item" style="cursor:default;align-items:flex-start">
            <span class="mono t-muted" title="${esc(stamp(msg.created_at))}">${clock(msg.created_at)}</span>
            <div style="flex:1;min-width:0">
              <div style="font-weight:500">${p.email ? personLine(p) : '<span class="t-warm">No recipient recorded</span>'}</div>
              <div class="cell-sub" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(str(msg.lead_email))}</div>
              <div class="cell-sub">${esc(String(msg.message || '').replace(/\s+/g, ' ').trim().slice(0, 160)) || '<span class="t-muted">No message text recorded</span>'}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <span class="chip">${esc(String(msg.channel || '').trim() || 'unrecorded channel')}</span>
              <div class="cell-sub">${ago(msg.created_at)}</div>
            </div>
          </div>`;
          }).join('')
        : stateEmpty('No mail has been logged',
            `Nothing outbound on a mail channel exists in the ${num(comms.length)} messages read. `
            + (delivery === 'broken'
              ? 'With a mail credential failure recorded this is the expected state — enrolments queue, mail does not go out.'
              : 'No mail credential failure is recorded either, so nothing here explains it.'),
            'unsubscribe')}</div>`;

    /* ── Silence detector ─────────────────────────────────────────────────── */
    silenceCard.innerHTML = `
      <div class="card-head"><div>
        <div class="card-title">Silence detector</div>
        <div class="card-sub">A lead that has not replied for twelve hours is escalated once, then never again</div>
      </div></div>
      <div style="max-height:40vh;overflow-y:auto">${silenced.length
        ? silenced.map(c => {
            const p = personOf(c.lead_email, null);
            return `<div class="list-item" style="cursor:default;align-items:flex-start">
            <span class="mono t-muted" title="${esc(stamp(c.created_at))}">${clock(c.created_at)}</span>
            ${pill('Escalated', 'warm')}
            <div style="flex:1;min-width:0">
              <div style="font-weight:500">${p.email ? personLine(p) : '<span class="t-warm">Unknown contact</span>'}</div>
              <div class="cell-sub">${esc(String(c.message || '').replace('[SILENCE-ESCALATED]', '').trim())}</div>
            </div>
            <div class="cell-sub">${ago(c.created_at)}</div>
          </div>`;
          }).join('')
        : stateEmpty('Nobody has gone silent',
            'The detector only fires for leads that received an outbound message and did not reply within twelve hours.',
            'notifications_off')}</div>`;

    /* ── Campaign activity ────────────────────────────────────────────────── */
    activityCard.innerHTML = `
      <div class="card-head"><div>
        <div class="card-title">Campaign activity</div>
        <div class="card-sub">Every drip run in the audit log, newest first${matchedByRegistry ? ' · matched through workflow_registry' : ' · matched on workflow name'}</div>
      </div></div>
      <div style="max-height:40vh;overflow-y:auto">${dripRuns.length
        ? dripRuns.map((x, i) => {
            const p = personOf(x.lead_email, x.lead_name);
            const keyed = low(x.lead_email);
            return `<div class="list-item" data-key="run-${i}" style="cursor:default;align-items:flex-start">
            <span class="mono t-muted" title="${esc(stamp(x.logged_at))}">${clock(x.logged_at)}</span>
            ${pill(x.status || 'Unknown')}
            <div style="flex:1;min-width:0">
              <div style="font-weight:500">${keyed || str(x.lead_name)
                ? personLine(p)
                : `<span class="t-warm">No lead on this run</span> <span class="chip mono">${esc(str(x.workflow) || 'unnamed workflow')}</span>`}</div>
              ${keyed && !EMAILISH.test(keyed)
                ? `<div class="cell-sub t-hot">lead_email is <span class="mono">${esc(str(x.lead_email))}</span>, which is not an email address — an email sequence has nowhere to send.</div>`
                : ''}
              <div class="cell-sub">${esc(String(x.summary || '').replace(/\s+/g, ' ').trim().slice(0, 160)) || '<span class="t-muted">No summary recorded</span>'}</div>
            </div>
            <div class="cell-sub">${ago(x.logged_at)}</div>
          </div>`;
          }).join('')
        : stateEmpty('No campaign runs logged',
            instrumented === false
              ? 'The registered drip workflow does not write to the audit log, so its runs cannot appear here.'
              : 'The drip workflow writes a row here every time it starts a sequence.',
            'receipt_long')}</div>`;

    /* ── The strip, and the wiring that makes it actionable ─────────────────
       An alert that only describes a problem is a poster. Every alert that has
       somewhere to go scrolls to that card and highlights exactly the rows it
       is about; the ones with nowhere to go say so in their own text instead of
       being a click that appears to do nothing. */
    alertCard.querySelector('.pbody').innerHTML =
      (forThisScreen.length || alerts.length ? viewRowsHtml + alertRowsHtml : nothingHtml) + notesHtml;

    const focusable = [rosterCard, mailCard, silenceCard, activityCard];
    function focusOn(card, keys) {
      focusable.forEach(c => c.querySelectorAll('.list-item.on').forEach(n => n.classList.remove('on')));
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!keys || !keys.size) return;
      let first = null;
      card.querySelectorAll('[data-key]').forEach(n => {
        const on = keys.has(n.dataset.key);
        n.classList.toggle('on', on);
        if (on && !first) first = n;
      });
      /* The list scrolls inside its own box, so bringing the card into view does
         not bring the highlighted row into view — the row has to be asked too,
         and without `behavior:smooth` so it does not race the card's own scroll. */
      first?.scrollIntoView({ block: 'nearest' });
    }

    const alertByKey = new Map(alerts.map(a => [a.key, a]));
    alertCard.querySelectorAll('[data-alert]').forEach(n => {
      const run = () => {
        const a = alertByKey.get(n.dataset.alert);
        if (a?.target) focusOn(a.target, a.keys);
      };
      n.addEventListener('click', run);
      /* Keyboard-operable, because this row is the only route from the alert to
         the rows it is about. */
      n.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
      });
    });
    alertCard.querySelectorAll('button[data-lead]').forEach(b => b.addEventListener('click', ev => {
      /* The chip sits inside a row that scrolls the roster; opening one lead and
         highlighting all of them at once would be two answers to one click. */
      ev.stopPropagation();
      const lead = leads.find(l => String(l.id) === b.dataset.lead);
      if (lead) leadDrawer(lead);
    }));
    rosterCard.querySelectorAll('[data-lead-row]').forEach(n => {
      const run = () => {
        const lead = leads.find(l => String(l.id) === n.dataset.leadRow);
        if (lead) leadDrawer(lead);
      };
      n.addEventListener('click', run);
      n.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
      });
    });
  }
};

/* ==========================================================================
   S10 · Deals
   Closing a deal is what feeds the RAG memory: the Closed-Won workflow embeds
   the deal and writes it to pgvector so Ask AI can reason over real sales.
   Until now that workflow could only be triggered by hand outside the product.
   ========================================================================== */
