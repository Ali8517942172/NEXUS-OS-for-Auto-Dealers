/* NEXUS OS — screens/overview.js
   The executive landing screen. Its job is not to mirror the other thirteen
   screens; it is to answer one question — "what needs a human right now?" —
   and then get out of the way with a link into the screen that can fix it.

   Re-checked 24 Aug 2026 (evening) against the CORRECTION section of SCHEMA.md,
   which was read off the live database. Every column this screen selects and
   every property it reads off a row was confirmed to exist there. Two absences
   shape what this screen can say at all:

     · `inventory` records no sale date — no `sold_at`, no `updated_at`, and no
       link from `purchase_history` back to a unit. So "what did we sell this
       month" and "how long did that car take to sell" are not answerable from
       this database, and the Units-at-risk tile says so in words rather than
       leaving an executive to assume the number is simply zero.
     · `users` has no phone column. Where this screen names a member of staff it
       says that their number is recorded nowhere, instead of printing a dash
       that looks like a lookup failure. Customer numbers do exist and are shown:
       `leads.phone` and `v_conversations.phone`.

   Re-read again the same night, after the database was cleaned of everything
   that was not this dealership's real data. The cleanup took most of this
   screen's numbers with it, and which alerts went matters more than the new
   totals do:

     · Five `undercut` items are gone because all fifteen `competitors` rows
       were deleted. Twelve of them held an `our_price_aed` that contradicted
       the inventory table — a Land Cruiser quoted at AED 290,000 against a
       list price of 385,000, and three models that were never in stock — so
       those five alerts were fabricated, not resolved. The kind is still
       handled below, because the scraper refills that table; while it is empty
       the panel says so, rather than letting a whole category go quietly
       missing and look like good news.
     · Two `unanswered_chat` items are gone with the 136 messages from thirteen
       WhatsApp handles belonging to the owner's personal phone book. They were
       never customers.
     · The database now holds one customer and one lead, so nearly every figure
       on the strip is n=1. Each of them says so in its own words instead of
       standing there looking like a rate.

   Nothing below is written against the rows that happen to be there tonight.
   There is no list of expected items in this file: a screen that hardcodes
   today's data is wrong by tomorrow morning, and would go on claiming three
   things need attention long after they stopped.

   Rewritten 24 Aug 2026 against four production faults:

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

   3. The nav badge is no longer this screen's to own. `lib/badges.js` paints
      every badge — including this one — from one read of `v_needs_attention`
      grouped by its `screen` column, every 60 seconds, counting HOT and WARM
      only. Overview may refine its own badge upward, because it can see KYC
      archive gaps the view does not list, and only upward: the shared count is
      a floor this file cannot go below. Where there is nothing to add, this
      file does not write the badge at all. The floor counts every HOT or WARM
      row in the view, screen-less ones included, because badges.js adds those
      to the Overview total too — see the note on `sharedFloor` for why getting
      that wrong would let the refinement shrink the badge.

   4. A `workflow_failure` item says a run failed inside the window. It does not
      say the workflow is failing now, and on this screen those read identically
      — which is how a fault that was fixed at 19:00 still looks like an
      emergency at midnight. `v_workflow_health` carries `last_failure` and
      `last_run`, and `last_run` is the newest run of any status: when it is
      later than `last_failure`, the workflow has completed a run since that
      failure and that run did not fail. So the distinction is read off two
      columns, for every workflow, rather than from a list of which causes
      somebody believes are fixed — the list would be a hardcoded opinion and
      would rot within a day.

      It is evidence, not a clean bill of health, and the screen says so: the
      audit log records only runs that COMPLETED, so a workflow hung right now
      leaves no row at all and cannot be distinguished from an idle one here.

   Everything below is a number Postgres produced. Nothing is estimated, and
   where a figure rests on a handful of rows the screen says how few — a single
   test record must not read as a trend. */
import { LAST as BADGE_SNAPSHOT } from '../lib/badges.js';
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, clock, esc, mins, n0, num, pill, tone } from '../lib/format.js';
import { leadDrawer } from '../lib/lead-drawer.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi, panel, table, wireRows } from '../lib/ui.js';

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
/* How many gaps the triage card lists before it starts counting instead. The
   read is not narrowed — every gap is counted, and the badge and the notes are
   computed from all of them; this bounds the height of one card in a
   three-across row, nothing else. */
const KYC_SHOWN = 5;

/* Mirrors the 7-day cut-off inside `v_needs_attention.unanswered_chat`. It is
   used only to explain why a thread that is awaiting a reply is absent from the
   list — never to compute a headline number, which stays the view's own. */
const CHAT_WINDOW_DAYS = 7;
/* And the bound on its `sla_breach` branch, added the same day. It used to be
   unbounded, so every lead that ever missed the five-minute rule stayed on this
   list forever and the list stopped being read. Stated on screen for the same
   reason the chat window is: a bounded list that looks unbounded is a lie of
   omission the moment an operator reads it as "everything that ever slipped". */
const SLA_WINDOW_DAYS = 30;

/* The severities `lib/badges.js` counts. COLD is excluded there deliberately —
   a permanent number over a nav item for something nobody intends to act on
   today is how a badge stops being read at all — and this file must apply the
   same rule when it works out the floor it is not allowed to go below. If
   badges.js ever changes this set, this line has to change with it; the
   consequence of missing that is a badge that shrinks when Overview renders. */
const BADGE_SEVERITIES = new Set(['HOT', 'WARM']);

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

/* Failing now, or failed earlier in the window and quiet since? The two look
   identical on an alert list, and they are not the same call for an owner at
   midnight — one is a workflow to go and fix, the other is a workflow to check
   in the morning. `v_workflow_health.last_run` is the newest run of any status
   and `last_failure` the newest failed one, so a `last_run` strictly later than
   `last_failure` is arithmetic proof that a run completed after that failure
   and did not itself fail. Equal timestamps mean the failure IS the last run.

   Anything less than that — no last_failure, an unparseable date, a last_run at
   or before it — returns "not known to have recovered". This function never
   guesses upward: an alert wrongly softened is worse than one left loud. */
const failureState = w => {
  const failedAt = Date.parse(w && w.last_failure);
  const ranAt = Date.parse(w && w.last_run);
  if (Number.isNaN(failedAt)) {
    return { key: 'unknown',
      text: '<span class="t-muted">the view records no time for the last failure, so whether anything has run since cannot be told from here</span>' };
  }
  if (!Number.isNaN(ranAt) && ranAt > failedAt) {
    return { key: 'recovered',
      text: `<span class="t-ok">has completed a run since, ${esc(ago(w.last_run))}, and that run did not fail</span>` };
  }
  return { key: 'failing',
    text: '<span class="t-hot">its most recent completed run is the failure</span>' };
};
/* Said wherever a row above claims to have recovered. The audit log holds one
   row per run that COMPLETED, so "it has run since" is evidence about the last
   run that finished — not proof of health, and a workflow hung right now writes
   no row at all and is indistinguishable from an idle one from here. */
const RECOVERY_CAVEAT = 'A workflow marked as having run since its failure is read from v_workflow_health: last_run later than last_failure. That is evidence the most recent completed run did not fail, not a clean bill of health — the audit log records only runs that finish, so a run hung right now leaves no row and cannot be seen from this screen.';

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

  /* ── Reads more than one panel depends on ───────────────────────────────
     Shared so that two panels describing the same rows cannot describe two
     different moments — and memoised in a way a Retry can actually retry.

     panel() rebuilds itself with the same `load` when its Retry is pressed. A
     load that hands back one already-settled promise therefore gives the
     operator a button whose only possible outcome is the same failure again,
     which is worse than no button: it looks like the database is down when the
     truth might be one dropped request. So the promise is kept while it is
     pending or fulfilled, and dropped on rejection — the next caller issues a
     fresh query. The internal catch is what keeps a rejection from surfacing as
     an unhandled promise in the console rather than in the panel that is meant
     to report it; every consumer still handles its own. */
  const shared = make => {
    let p = null;
    return () => {
      if (!p) { p = make(); p.catch(() => { p = null; }); }
      return p;
    };
  };

  /* Both the Needs-attention panel and the KYC panel depend on this one — the
     second so it can say which of its gaps the view already lists — and the
     badge depends on both.

     `v_conversations` is an enrichment, not the source of truth, so its failure
     degrades identity resolution rather than killing the panel. That
     degradation is rendered, not swallowed. */
  const readAttention = shared(async () => {
    const [items, threads] = await Promise.all([
      db(`v_needs_attention?select=kind,severity,ref,title,detail,at,screen&limit=${ATTN_LIMIT}`),
      /* `push_name` is not selected: `display_name` already falls back through
         it (lead name → profile name → phone → chat id), so a row where
         display_name is still a raw handle has no push_name either. */
      db('v_conversations?select=chat_id,display_name,identified,phone,last_message_at'
        + `&awaiting_reply=is.true&order=last_message_at.desc&limit=${AWAITING_LIMIT}`).catch(() => null),
    ]);
    return { items, threads };
  });
  /* Read once here too. The KYC panel renders it and the Needs-attention panel
     needs the same rows to state what the badge adds up to; two reads could
     disagree, and a badge that disagrees with the panel under it is worse than
     no badge. */
  /* `attempt_number` / `max_attempts` are selected because a list of gaps that
     all belong to one person is a resubmission trail, and the attempt number is
     what makes that legible: eight names in a column look like eight problems.
     Both columns are on the table (CORRECTION section, 24 Aug). */
  const readKycGaps = shared(() => db('kyc_documents?select=id,lead_name,full_name,lead_email,document_type,verdict,created_at,retain_until,void_reason,attempt_number,max_attempts'
    + `&storage_path=is.null&purged_at=is.null&order=created_at.desc&limit=${KYC_LIMIT}`));
  /* Workflow health, read once and shared. The Workflows-degraded panel renders
     it, and the Needs-attention panel needs the same rows to tell a workflow
     that is failing now from one that failed earlier in the window and has run
     clean since. Two reads could put a row in one state on one panel and the
     other state three lines below it, which is worse than not distinguishing
     them at all. `failures_30d=gt.0` is the panel's own filter and it is also
     exactly the set a workflow_failure item can come from, so one read serves
     both; a workflow_failure item with no match here is reported as unmatched
     rather than assumed healthy. */
  const readHealth = shared(() => db('v_workflow_health?select=id,name,category,health,runs_30d,failures_30d,last_run,last_failure,is_active'
    + '&failures_30d=gt.0&order=failures_30d.desc,name.asc&limit=50'));
  /* Read for one reason only: to explain an absence. `undercut` is one of the
     kinds the Needs-attention list enumerates, and when `competitors` is empty
     that branch cannot fire at all — so an operator reading "no undercuts"
     would be reading a silence as an all-clear. One row is enough to tell the
     two apart, which is all this asks for. */
  const readRivals = shared(() => db('competitors?select=id&limit=1'));
  /* Started here, not at first use. The core read below is awaited before any
     panel exists, so a read that waits for its panel would queue behind it
     instead of running alongside it — four round trips in series on the screen
     an owner opens first. */
  readAttention(); readKycGaps(); readHealth(); readRivals();

  /* A row is an audit gap only if it was a real submission. `void_reason` marks
     the rows that were never KYC at all, and they are excluded here exactly as
     v_needs_attention's own kyc_archive_gap branch excludes them. */
  const liveGaps = rows => (rows || []).filter(r => !str(r.void_reason));
  /* Gaps the view has not already reported, so the badge counts each one once.
     A gap the view DOES list is left entirely to the view — including one it
     marked COLD, which badges.js therefore does not count. That is the view's
     severity judgement and this screen does not overrule it: the alternative is
     a badge that promotes an item the shared rule deliberately demotes, and the
     two counts stop being reconcilable. The gap is still listed in the panel. */
  const extraGaps = (rows, items) => {
    const viewRefs = new Set((items || [])
      .filter(i => i.kind === 'kyc_archive_gap').map(i => str(i.ref)));
    return liveGaps(rows).filter(r => !viewRefs.has(str(r.id)));
  };

  /* ── The badge ──────────────────────────────────────────────────────────
     `lib/badges.js` owns every nav badge and paints this one, every 60 seconds,
     as the grand total of HOT and WARM rows in `v_needs_attention` grouped by
     `screen`. Overview is the one documented exception allowed to refine its
     own badge, and it exists for exactly one reason: a KYC archive gap that the
     view's `kyc_archive_gap` branch does not list (its branch carries a recency
     cut-off of its own) is a compliance hole no badge would otherwise mention.
     Tonight that is the larger half of the number: the view returns three items
     and there are eight unarchived submissions it says nothing about.

     Two rules make that refinement safe rather than a second opinion:

       1. It is a superset or it is nothing. The number written here is the
          shared count plus the gaps the view did not list — never a count of
          this panel's own rows, which include COLD items badges.js deliberately
          leaves out and would therefore make the badge mean two different
          things depending on which screen you were last looking at.
       2. If there is nothing to add, nothing is written. badges.js keeps it.

     The floor comes from badges.js's own snapshot (`LAST`, a live binding) so
     the two cannot be counting different moments, with this panel's own rows as
     a fallback for the first render, before the first badge poll has returned.
     Note that the refinement is transient by design: the next 60-second poll
     repaints the floor. That is the documented direction of travel and not a
     bug — the KYC panel below still shows the gap either way. */
  const need = { attention: null, items: null, kycExtra: null, floor: null, floorFrom: null, badge: null };

  /* Counted the way badges.js counts the OVERVIEW badge specifically, from the
     snapshot badges.js last read: every HOT or WARM row, whether or not the
     view files it against a screen. Null when it has not read yet.

     The `&& str(r.screen)` this line used to carry was a real defect, not a
     stylistic one. badges.js paints the per-screen badges from rows that name a
     screen and then adds its `homeless` count — the HOT/WARM rows that name
     none — into the Overview grand total, precisely so an item with nowhere to
     live is still visible somewhere. Filtering them out here made this file's
     floor smaller than the number badges.js had just painted, so the one thing
     the refinement is forbidden to do — move the badge DOWN — became possible
     the moment the view emitted a row with a null screen. It never has in the
     data we have seen, which is exactly why it would have shipped. */
  const sharedFloor = () => {
    const rows = BADGE_SNAPSHOT && BADGE_SNAPSHOT.rows;
    if (!rows) return null;
    return rows.filter(r => BADGE_SEVERITIES.has(str(r.severity).toUpperCase())).length;
  };
  /* The same rule applied to the rows this screen read, so the first render has
     a floor before badges.js has polled once. */
  const ownFloor = items => (items || [])
    .filter(i => BADGE_SEVERITIES.has(str(i.severity).toUpperCase())).length;

  const setBadge = () => {
    const extra = need.kycExtra || 0;
    const shared = sharedFloor();
    const own = need.attention == null ? 0 : ownFloor(need.items);
    /* max(), not a choice between them: whichever snapshot saw more rows is the
       one this badge must not fall below. badges.js reads 500 rows and this
       screen reads 200, so on a busy morning the shared count is the larger. */
    need.floor = shared == null ? own : Math.max(shared, own);
    need.floorFrom = shared == null ? 'own' : 'shared';
    need.badge = need.floor + extra;
    const badge = $('badge-overview');
    if (!badge) return;
    /* Nothing to add — badges.js owns this badge outright, and writing the same
       number again would only risk disagreeing with it on the next poll. */
    if (!extra) return;
    badge.textContent = need.badge > 99 ? '99+' : String(need.badge);
    badge.classList.toggle('hide', need.badge === 0);
    /* The homeless count is badges.js's own — it is the reason the floor above
       is not filtered by screen, so the title has to be able to explain it. */
    const homeless = BADGE_SNAPSHOT && BADGE_SNAPSHOT.rows ? (BADGE_SNAPSHOT.homeless || 0) : 0;
    badge.title = `${need.floor} item${need.floor === 1 ? '' : 's'} need attention across all screens`
      + ` (HOT and WARM only)`
      + (homeless ? `, ${homeless} of which belong to no screen and can only be seen here` : '')
      + `, plus ${extra} KYC archive gap${extra === 1 ? '' : 's'}`
      + ` that v_needs_attention does not list`;
  };

  /* ── Core read ──────────────────────────────────────────────────────────
     One fetch feeds the KPI strip, the reply-gap panel and the stage bar, so
     the three cannot disagree with each other. If it fails, every dependent
     surface says so rather than rendering a plausible-looking zero. */
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
  let core = null, coreErr = null;
  try {
    const [leads, inv, metrics, outbound] = await Promise.all([
      /* `phone` and `assigned_to` are real columns on leads (probed 24 Aug) and
         both are read below: a lead waiting for a reply is a person somebody has
         to ring, and the rep's name is what makes "unanswered" somebody's job.
         There is no `lead_score` and no `updated_at` on this table — the score
         is `ai_score`, and nothing records when a lead was last modified. */
      db(`leads?select=id,name,email,phone,status,ai_score,vehicle_interest,source,budget_aed,response_time_minutes,created_at,assigned_to,assigned_to_id&order=created_at.desc&limit=${LEAD_LIMIT}`),
      /* `id` is the stock number ("NX-1010"); money on this table is
         `price_aed` / `cost_aed`, and there is no `sold_at`, `make` or `year`.
         Nothing below reads a sale date, because none is recorded. */
      db(`inventory?select=id,model,days_in_stock,price_aed,holding_cost_accrued,aging_alert&limit=${INV_LIMIT}`),
      /* daily_metrics is the snapshot table the deltas below are read from. It
         is optional — where it has not been provisioned no delta line renders
         at all, which is the correct outcome. It is never substituted for.

         It is the one table on this screen that was NOT probed on 24 Aug, so
         the select stays `*` and no column is ever named in it: an invented
         name in a select is a 42703 that takes the whole query down, while an
         invented name read off a returned row is merely `undefined` — which
         delta() already treats as "no comparison available" and renders as
         nothing at all. Read defensively, select nothing specific. */
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
    /* Asking price, not capital and not realised revenue: `price_aed` is what
       the unit is listed at. `cost_aed` would be the money actually tied up and
       is not read here; nothing on this table records what a unit sold for. */
    const riskList = risk.reduce((a, i) => a + (n0(i.price_aed) || 0), 0);

    const sinceMs = Date.parse(since);
    const answered = new Set(outbound.map(c => norm(c.lead_email)).filter(Boolean));
    /* communication_logs.lead_email holds an email when the lead is known and a
       raw WhatsApp handle when it is not, so some outbound messages in this
       window are filed against a handle and can never match a lead row. They
       are counted, not silently dropped: a lead answered on WhatsApp before it
       was identified would still be listed below as unanswered, and an operator
       has to be told that rather than left to discover it. */
    const outboundHandles = outbound.filter(c => isHandle(c.lead_email)).length;
    const recent = leads.filter(l => Date.parse(l.created_at) >= sinceMs);
    /* A lead with no email cannot be matched against communication_logs, which
       keys on lead_email. Counting those as "unanswered" would invent a queue;
       they are excluded and reported separately so the gap is visible. */
    const unmatchable = recent.filter(l => !norm(l.email)).length;
    const waiting = recent
      .filter(l => norm(l.email) && !answered.has(norm(l.email)))
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

    core = { leads, inv, hot, warm, cold, avgResp, withResp, withBudget, pipeline,
             risk, warning, riskHolding, riskList, holding, metrics, waiting, unmatchable,
             outboundHandles, outboundCount: outbound.length,
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
            risk, warning, riskHolding, riskList, holding, metrics, waiting, recentCount,
            leadsCapped, invCapped } = core;

    /* Deltas only exist once there are two snapshots. Until then no delta line
       renders at all — an earlier build showed "-18s vs last week" as a
       hardcoded string with nothing behind it. */
    const prev = metrics.length > 1 ? metrics[1] : null;
    const delta = (now, before, fmt, lowerIsBetter) => {
      if (!prev || now == null) return '';
      const when = prev.snapshot_date ? `the ${esc(prev.snapshot_date)} snapshot` : 'the previous snapshot';
      /* A snapshot exists but carries nothing comparable for this figure. Said
         once, plainly, rather than leaving the KPI looking as though nothing
         has changed since yesterday. daily_metrics is the one table on this
         screen whose columns were never probed, so this is a real possibility
         and not a defensive flourish. */
      if (before == null) return `<span class="t-muted">${when.charAt(0).toUpperCase() + when.slice(1)} records no comparable figure, so no change is shown</span>`;
      const d = Number(now) - Number(before);
      if (!d) return `<span class="t-muted">No change against ${when}</span>`;
      const good = lowerIsBetter ? d < 0 : d > 0;
      return `<span class="${good ? 't-ok' : 't-hot'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</span> <span class="t-muted">against ${when}</span>`;
    };

    const oldestRisk = risk.length ? Math.max(...risk.map(r => n0(r.days_in_stock) || 0)) : null;

    /* A snapshot that counted more open leads than the table now holds in total
       is, by arithmetic, counting rows that are no longer there — open leads are
       a subset of all leads, so there is no reading of the two figures under
       which that gap is ordinary movement. Every delta on this strip is drawn
       against that same snapshot, so it is said once, here, at the top: those
       comparisons are measuring rows leaving the database as much as anything
       the dealership did. Derived from the two counts, not from knowing that a
       cleanup happened tonight — next month the same sentence still holds. */
    const prevOpen = prev ? n0(prev.open_leads) : null;
    const snapshotShrank = prevOpen != null && prevOpen > leads.length;
    /* Raw, not escaped: every use below goes through warn()/muted(), which
       escape. Escaping twice would print the entities. */
    const snapshotWhen = prev && prev.snapshot_date ? `The ${prev.snapshot_date} snapshot` : 'The previous snapshot';

    /* ── Open leads ─────────────────────────────────────────────────────── */
    const leadsSub = `${pill(`${hot} HOT`, 'hot')} ${pill(`${warm} WARM`, 'warm')} ${pill(`${cold} COLD`, 'cold')}`
      + (leadsCapped
          ? `<br>${warn(`Capped at ${num(LEAD_LIMIT)} rows — the leads table holds more than this.`)}`
          : leads.length <= THIN
            ? `<br>${warn(`That is the whole leads table — ${num(leads.length)} ${plural(leads.length, 'row', 'rows')}, not a sample of it.`)}`
            : '')
      + (snapshotShrank
          ? `<br>${warn(`${snapshotWhen} counted ${num(prevOpen)} open leads and the table now holds ${num(leads.length)} in total, so it was counting rows that have since gone. Every comparison against it on this strip inherits that.`)}`
          : '');

    /* ── Awaiting first reply ───────────────────────────────────────────── */
    const waitSub = waiting.length
      ? `<span class="t-hot">Oldest arrived ${esc(ago(waiting[0].created_at))}, still unanswered</span>`
        + `<br>${muted(`Out of ${num(recentCount)} ${plural(recentCount, 'lead', 'leads')} created in the last ${WINDOW_DAYS} days`)}`
      : recentCount
        ? `<span class="t-ok">All ${num(recentCount)} ${plural(recentCount, 'lead', 'leads')} created in the last ${WINDOW_DAYS} days ${plural(recentCount, 'has', 'have')} an outbound message</span>`
          + (recentCount <= THIN ? `<br>${warn(`On ${num(recentCount)} ${plural(recentCount, 'lead', 'leads')} this says almost nothing about the reply habit.`)}` : '')
        : muted(`No lead was created in the last ${WINDOW_DAYS} days, so there is nothing here to be waiting on`);

    /* ── Response time ──────────────────────────────────────────────────────
       The mean of one number is that number, and calling it an average is the
       single easiest way for this screen to lie now that the database holds one
       lead. So the tile renames itself: with one measurement the label reads
       "Response time" and the subtitle says whose it is. The value is unchanged
       and correct either way — what changes is the claim made about it. */
    const oneMeasure = withResp.length === 1;
    const respLabel = oneMeasure ? 'Response time' : 'Avg response time';
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
        + (oneMeasure
            ? `<br>${warn('This is one lead’s recorded response time, not an average of anything. It says how fast that enquiry was answered and nothing about how the dealership performs.')}`
            : withResp.length <= THIN
              ? `<br>${warn(`An average of ${num(withResp.length)} ${plural(withResp.length, 'measurement', 'measurements')} is not a performance figure.`)}`
              : '')
        /* A delta on a single measurement compares one lead against a snapshot
           mean. It is arithmetic without a meaning, so it is not drawn. */
        + (oneMeasure
            ? `<br>${muted('No comparison against the previous snapshot is shown: one measurement against a daily mean is not a change in response time.')}`
            : (() => { const d = delta(avgResp, prev?.avg_response_minutes, v => mins(v), true); return d ? `<br>${d}` : ''; })());

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
          + `<br>${muted(`${plural(risk.length, 'It is', 'They are')} listed at ${aed(riskList)} in total`)}`
        : muted(`No unit is flagged CRITICAL across the ${num(inv.length)} ${plural(inv.length, 'unit', 'units')} read · ${aed(holding)} holding cost accrued in total`))
      + (warning.length ? `<br>${warn(`${num(warning.length)} further ${plural(warning.length, 'unit is', 'units are')} flagged WARNING and not counted above.`)}` : '')
      + (invCapped ? `<br>${warn(`Inventory read was capped at ${num(INV_LIMIT)} rows.`)}` : '')
      /* The absence an owner will look for first on this strip, said in words.
         Ageing is measured from `days_in_stock`, which the nightly job keeps;
         there is no counterpart for the other end of the unit's life. */
      + `<br>${muted('Inventory records no sale date, so this screen cannot show what sold, what it sold for, or how long a sold unit sat on the lot. Days in stock is the only ageing figure the database keeps.')}`;

    strip.innerHTML = [
      kpi('Open leads', num(leads.length), leadsSub),
      /* The one number on this screen that maps to a person waiting. */
      kpi('Awaiting first reply', num(waiting.length), waitSub, waiting.length ? 't-hot' : ''),
      kpi(respLabel, mins(avgResp), respSub),
      kpi('Pipeline value', aed(pipeline), pipeSub),
      kpi('Units at risk', num(risk.length), riskSub, risk.length ? 't-hot' : ''),
    ].join('');

    const seg = [['HOT', hot, 'var(--hot)'], ['WARM', warm, 'var(--warm)'], ['COLD', cold, 'var(--cold)']];
    const graded = hot + warm + cold;
    const unscored = leads.length - graded;
    /* One scored lead paints a full-width bar in one colour, and a full-width
       bar is read as a share before any caption under it is. A caption cannot
       undo that — the shape has already made the claim — so at n=1 the chart is
       not drawn at all and the same fact is stated in a sentence instead. This
       is the one place on the screen where the honest rendering is no chart. */
    const single = graded === 1;
    const onlyStage = single ? (seg.find(([, v]) => v === 1) || [null])[0] : null;
    pipeCard.innerHTML = single
      ? `<div class="label-caps" style="margin-bottom:12px">Pipeline by stage</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          ${onlyStage ? pill(onlyStage) : ''}
          <span>Exactly one lead has been scored${onlyStage ? `, and it is ${esc(onlyStage)}` : ''}.</span>
        </div>
        <div class="cell-sub" style="margin-top:10px">${muted('No bar is drawn: one row has no distribution, and a full-width band of one colour would read as a market share of the pipeline. The stage mix reappears here as soon as a second lead is scored.')}</div>
        ${unscored > 0 ? `<div class="cell-sub" style="margin-top:6px">${muted(`${num(unscored)} further ${plural(unscored, 'lead has', 'leads have')} not been scored by the router.`)}</div>` : ''}`
      : graded
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
      : stateEmpty('Nothing to chart yet',
          leads.length
            ? `${leads.length === 1 ? 'The one lead on file has not been scored' : `None of the ${leads.length} leads on file has been scored`} HOT, WARM or COLD yet. The router writes that status when it processes an enquiry, and the stage mix appears here once it has.`
            : 'The leads table is empty, so there are no stages to chart. The first row arrives when the router webhook receives an enquiry.',
          'donut_small');
  }

  /* ── Opening the row an item is about ───────────────────────────────────
     A line that names a waiting customer and then hands the operator a list to
     find them in again is half an alert. Every lead named on this screen opens
     the same drawer the Leads screen opens, on that lead, with its phone number
     and its history in it.

     The row is re-read with `select=*,users(id,name)` — the convention the
     Leads and Conversations screens already use — because the drawer renders
     fields this screen has no reason to fetch for a list, and a drawer full of
     dashes reads as missing data rather than as an unfetched column. The
     failure is reported into the row itself; a click that silently does nothing
     is the one outcome that must not happen. */
  const openLead = async (id, msg) => {
    const say = html => { if (msg) msg.innerHTML = html; };
    try {
      say('<span class="t-muted">Opening…</span>');
      const rows = await db(`leads?select=*,users(id,name)&id=eq.${encodeURIComponent(id)}&limit=1`);
      /* Awaited, not fired: the drawer does its own reads, and an unawaited
         rejection would land in the console instead of in the row that was
         clicked. */
      if (rows.length) { say(''); await leadDrawer(rows[0]); }
      else say(`<span class="t-warm">${esc('That lead is no longer in the leads table, so there is nothing to open.')}</span>`);
    } catch (e) {
      say(`<span class="t-hot">${esc(`Could not open this lead — ${e.message}`)}</span>`);
    }
  };
  /* Keyboard-operable for the same reason the attention rows are: this is the
     only route from the alert to the record it is about. */
  const wireLeadRows = card => {
    card.querySelectorAll('[data-lead]').forEach(n => {
      const run = () => {
        if (n.dataset.busy) return;
        n.dataset.busy = '1';
        openLead(n.dataset.lead, n.querySelector('[data-leadmsg]'))
          .finally(() => { delete n.dataset.busy; });
      };
      n.addEventListener('click', run);
      n.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); }
      });
    });
  };

  /* The other half of "click through to the thing it is about": where there is
     no row to open from here — a workflow, a KYC document nobody can repair
     from the browser — the row still goes to the screen that can act on it,
     rather than leaving the operator to find the nav item themselves. Keyboard
     operable for the same reason the lead rows are. */
  const wireGoto = card => {
    card.querySelectorAll('[data-goto]').forEach(n => {
      const jump = () => go(n.dataset.goto);
      n.addEventListener('click', jump);
      n.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
      });
    });
  };

  /* Staff numbers. `users` has no phone column — probed live — so a rep's name
     is the whole of what can be shown, and the screen says that rather than
     printing an empty field next to it. */
  const NO_STAFF_PHONE = 'Staff phone numbers are stored nowhere the dashboard can read: the users table has no phone column, so a rep is named but cannot be called from here. Customer numbers below come from leads.phone and v_conversations.phone, which do exist.';

  /* ── Triage row ─────────────────────────────────────────────────────────── */

  const panels = [];

  /* 1 · Leads nobody has replied to. */
  panels.push(panel(replyHost, {
    title: 'No reply sent',
    sub: `Leads created in the last ${WINDOW_DAYS} days with no outbound message in communication_logs`,
    actions: `<button class="btn sm" data-act="leads">Open Leads</button>`,
    load: async () => requireCore(),
    render: d => {
      const noPhone = d.waiting.filter(l => !str(l.phone)).length;
      const notes = [
        d.unmatchable ? `${num(d.unmatchable)} of the ${num(d.recentCount)} leads in this window have no email address, so communication_logs cannot be matched to them.` : '',
        /* The join this panel rests on is lead.email = communication_logs.lead_email,
           and that column holds a WhatsApp handle whenever the message was sent
           to a thread with no identified lead behind it. Those messages cannot
           match any lead row, so the join is provably incomplete and says by how
           much rather than presenting itself as exact. */
        d.outboundHandles
          ? `${num(d.outboundHandles)} of the ${num(d.outboundCount)} outbound messages read in this window are filed under a WhatsApp handle rather than an email address, because communication_logs.lead_email holds whichever the thread had at the time. They cannot be matched to any lead, so a lead answered on WhatsApp before it was identified would still be listed above as unanswered.`
          : '',
        d.outboundCapped ? `Outbound history was capped at ${num(OUTBOUND_LIMIT)} messages for this window, so this list may be incomplete.` : '',
        d.recentCount && d.recentCount <= THIN ? `Only ${num(d.recentCount)} ${plural(d.recentCount, 'lead was', 'leads were')} created in this window, so an empty list here is a very small sample.` : '',
        noPhone ? `${num(noPhone)} of these ${plural(noPhone, 'lead has', 'leads have')} no phone number on the lead record, so ${plural(noPhone, 'it', 'they')} can only be answered by email.` : '',
        d.waiting.length ? NO_STAFF_PHONE : '',
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
        <div class="list-item" role="button" tabindex="0" data-lead="${esc(l.id)}"
             title="Open this lead" style="align-items:flex-start">
          ${pill(l.status || 'Unscored')}
          <div style="flex:1;min-width:0">
            <div style="font-weight:500;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
              <span>${esc(str(l.name) || 'Unnamed lead')}</span>
              ${str(l.phone)
                ? `<span class="mono cell-sub">${esc(str(l.phone))}</span>`
                : `<span class="cell-sub t-warm" title="The router captured no phone number for this lead. leads.phone is empty on this row.">No phone on the lead</span>`}
            </div>
            <div class="cell-sub">${esc(str(l.vehicle_interest) || 'No vehicle recorded')}${str(l.source) ? ' · ' + esc(str(l.source)) : ''}</div>
            <div class="cell-sub" aria-live="polite" data-leadmsg></div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="t-hot">${esc(ago(l.created_at))}</div>
            <div class="cell-sub">${str(l.assigned_to)
              ? esc(str(l.assigned_to))
              : l.assigned_to_id ? 'assigned' : '<span class="t-warm">unassigned</span>'}</div>
          </div>
        </div>`).join('')}
        ${d.waiting.length > shown.length
          ? `<div class="list-item" style="cursor:default"><div class="cell-sub">${num(d.waiting.length - shown.length)} more waiting — see Leads</div></div>`
          : ''}${foot}</div>`;
    },
  }).then(card => {
    card.querySelector('[data-act]')?.addEventListener('click', () => go('leads'));
    wireLeadRows(card);
  }));

  /* 2 · Workflows that actually failed inside the health window. `health` is
     computed over 30 days, so failures_30d is the column that agrees with it —
     all-time `failures` would keep a long-fixed workflow red forever. */
  panels.push(panel(flowHost, {
    title: 'Workflows degraded',
    sub: 'Any workflow with at least one failure in the last 30 days, and whether it has run cleanly since',
    actions: `<button class="btn sm" data-act="automation">Open Automation</button>`,
    load: () => readHealth(),
    render: rows => {
      if (!rows.length) {
        return stateEmpty('No workflow has failed in 30 days',
          'Workflows that do not write to the audit log cannot report health — Automation lists those separately.', 'task_alt');
      }
      /* Ordered so the ones still broken sit above the ones that recovered.
         The read is already sorted by failure count, which put a workflow that
         failed five times this morning and has run clean all afternoon above a
         workflow that is failing right now — the wrong way round for a triage
         card. Recovery first, failure count second, so the sort inside each
         group is unchanged. */
      const state = new Map(rows.map(w => [w, failureState(w)]));
      const ORDER = { failing: 0, unknown: 1, recovered: 2 };
      const sorted = [...rows].sort((a, b) => ORDER[state.get(a).key] - ORDER[state.get(b).key]);
      const recovered = rows.filter(w => state.get(w).key === 'recovered').length;
      const notes = [
        recovered ? RECOVERY_CAVEAT : '',
        `A row here means a run failed inside the 30-day window that v_workflow_health.health is computed over. All-time failures are not used: they would keep a workflow that was fixed in June red forever.`,
      ].filter(Boolean);
      return `<div>${sorted.map(w => {
        const runs = n0(w.runs_30d), fails = n0(w.failures_30d);
        /* "3 of 3 runs failed" and "124 of 202 runs failed" are different
           claims. A workflow that has barely run in the window is marked as
           such rather than being ranked on a rate nobody can trust. */
        const scarce = runs != null && runs <= THIN;
        const st = state.get(w);
        /* A workflow that has run clean since its last failure is not an
           emergency at midnight, and the icon has to agree with the sentence
           three words to its right or the row is shouting and whispering at
           once. The health pill is left exactly as the view computed it — that
           is the view's judgement and this panel does not overrule it. */
        const icon = st.key === 'recovered'
          ? { name: 'history', cls: 't-muted' }
          : { name: 'error', cls: 't-hot' };
        return `<div class="list-item" role="button" tabindex="0" data-goto="automation"
             title="Open Automation, where this workflow's runs and failures are" style="align-items:flex-start">
          <span class="material-symbols-outlined ${icon.cls}" style="font-size:20px">${icon.name}</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-weight:500">${esc(w.name)}</span>
              ${pill(w.health === 'DEGRADED' ? 'Degraded' : String(w.health || 'Unknown'), tone(w.health))}
              ${w.is_active === false ? pill('Inactive', 'cold') : ''}
            </div>
            <div class="cell-sub">${esc(w.category || 'Uncategorised')}${w.last_failure ? ' · last failed ' + esc(ago(w.last_failure)) : ''}${
              scarce ? ' · <span class="t-warm">too few runs in 30 days to rate</span>' : ''}</div>
            <div class="cell-sub">${st.text}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="num ${st.key === 'recovered' ? 't-muted' : 't-hot'}" style="font-weight:500">${num(fails)}</div>
            <div class="cell-sub">${runs == null ? 'failed' : `of ${num(runs)} runs`}</div>
          </div>
        </div>`;
      }).join('')}<div class="list-item" style="cursor:default">
        <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
        <div class="cell-sub" style="white-space:normal">${notes.map(esc).join('<br>')}</div></div></div>`;
    },
  }).then(card => {
    card.querySelector('[data-act]')?.addEventListener('click', () => go('automation'));
    wireGoto(card);
  }));

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
      const rows = await readKycGaps();
      const att = await readAttention().catch(() => null);
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

      const keyOf = r => str(r.lead_email).toLowerCase() || str(r.lead_name).toLowerCase();
      const contactKeys = [...new Set(live.map(keyOf).filter(Boolean))];
      const contacts = contactKeys.length;
      /* Where every gap belongs to one person, name them. "All 8 belong to 1
         contact" leaves an owner to go and find out who; the address is already
         in the rows being counted. */
      const soleContact = contacts === 1
        ? (str(live[0].lead_name) || str(live[0].full_name) || contactKeys[0])
        : '';

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
        live.length > 1 && soleContact
          ? `All ${num(live.length)} were filed under one contact, ${soleContact} — this is one submission trail failing over and over, not a compliance problem spread across the book. It is still ${num(live.length)} missing files, and each one is its own audit gap.`
          : live.length > 1 && contacts && contacts <= 2
            ? `All ${num(live.length)} belong to ${num(contacts)} ${plural(contacts, 'contact', 'contacts')} — this is one submission trail failing repeatedly, not a problem spread across the book.`
            : live.length === 1
              ? 'This is a single row. It is a real gap, but it is one.'
              : '',
        capped ? `Read was capped at ${num(KYC_LIMIT)} rows, so there may be more.` : '',
        /* Rule: where a person is shown, show their phone. This table does not
           hold one — it holds lead_email and chat_id — so the address is shown
           instead and the absence is stated rather than left as a blank field. */
        live.length ? 'kyc_documents stores no phone number, so these contacts are shown by the address the submission was filed under. Their number, if there is one, is on the lead record in Leads.' : '',
      ].filter(Boolean);

      const foot = `<div class="list-item" style="cursor:default">
          <span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
          <div class="cell-sub" style="white-space:normal">${notes.map(esc).join('<br>')}${notes.length ? '<br>' : ''}${esc('Repairing these needs a service-role job. There is also nothing here to open: signing a private-bucket file is possible now (signedUrl in lib/data.js mints a 60-second link), but storage_path is null on every row in this list — the missing file is the gap.')}</div>
        </div>`;

      if (!live.length) {
        return stateEmpty(
          voided.length ? 'No genuine submission is missing its file' : 'Every audited document is archived',
          voided.length
            ? `The ${voided.length} ${plural(voided.length, 'row', 'rows')} here with no stored file ${plural(voided.length, 'was', 'were')} voided as ${plural(voided.length, 'a non-submission', 'non-submissions')}. Rows already purged on schedule are not counted either.`
            : 'No KYC row is missing its stored file. Rows already purged on schedule are not counted here.',
          'inventory_2') + foot;
      }

      /* This card sits in a three-across triage row, and every row in it is
         three lines tall. Listing every gap makes the tallest card on the
         screen a column of the same name repeated — so the newest few are
         shown and the remainder is counted, in the same words the leads panel
         uses. The count above is always the full one; only the list is cut. */
      const shown = live.slice(0, KYC_SHOWN);
      const rest = live.length - shown.length;
      return `<div>${shown.map(d => {
        const attempt = n0(d.attempt_number), maxAttempt = n0(d.max_attempts);
        return `
        <div class="list-item" role="button" tabindex="0" data-goto="compliance"
             title="Open Compliance, where this document's audit trail is" style="align-items:flex-start">
          <span class="material-symbols-outlined t-warm" style="font-size:20px">folder_off</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-weight:500">${esc(str(d.lead_name) || str(d.full_name) || str(d.lead_email) || 'Unknown contact')}</span>
              ${d.verdict ? pill(d.verdict) : ''}
            </div>
            <div class="cell-sub">${esc(str(d.document_type) || 'No document type recorded')} · audited ${esc(ago(d.created_at))}${
              attempt != null ? ' · attempt ' + esc(num(attempt)) + (maxAttempt != null ? ' of ' + esc(num(maxAttempt)) : '') : ''}${
              d.retain_until ? ' · retain until ' + esc(d.retain_until) : ''}</div>
            <div class="cell-sub">${str(d.lead_email)
              ? `<span class="mono">${esc(str(d.lead_email))}</span>`
              : '<span class="t-warm">No address on the submission</span>'}</div>
          </div>
          <button class="btn sm" disabled
            title="No re-archive endpoint exists. kyc_documents and the private kyc-documents bucket are service-role only, and there is no n8n webhook for re-running the archive step, so the browser cannot repair this row.">Re-archive</button>
        </div>`;
      }).join('')}${rest > 0
        ? `<div class="list-item" style="cursor:default"><div class="cell-sub">${esc(`${num(rest)} older ${plural(rest, 'gap is', 'gaps are')} not listed here — all ${num(live.length)} are counted above and every one of them is in Compliance.`)}</div></div>`
        : ''}${foot}</div>`;
    },
  }).then(card => {
    card.querySelector('[data-act]')?.addEventListener('click', () => go('compliance'));
    wireGoto(card);
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
    sub: `Live union from v_needs_attention — unanswered WhatsApp threads first, then unassigned HOT leads, SLA breaches, KYC archive gaps, workflow failures, undercuts and aging stock. The view bounds two of these itself: unanswered threads to ${CHAT_WINDOW_DAYS} days and SLA breaches to ${SLA_WINDOW_DAYS}, so this is what is still live, not everything that ever slipped`,
    load: async () => {
      const { items, threads } = await readAttention();
      const sorted = [...items].sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9)
        || new Date(b.at) - new Date(a.at));
      /* Soft: a failed KYC read must not take this panel down with it, but it
         does change what the badge can honestly claim, so it is reported. */
      const gapRows = await readKycGaps().catch(() => null);
      /* Both soft for the same reason: they add a sentence to a row or explain
         an absence. Neither is allowed to blank the list of things that need a
         human, which is the one thing this panel exists to show. */
      const health = await readHealth().catch(() => null);
      const rivals = await readRivals().catch(() => null);
      return { items: sorted, threads, gapRows, health, rivals };
    },
    render: ({ items, threads, gapRows, health, rivals }) => {
      need.attention = items.length;
      need.items = items;
      need.kycExtra = gapRows ? extraGaps(gapRows, items).length : null;
      setBadge();

      /* Leads already read for the strip, indexed both ways the view keys its
         refs. A matched ref means the item is about a lead we hold, which buys
         two things: the customer's phone number beside their name, and a click
         that opens that record rather than the screen it lives on. */
      const leadById = new Map(), leadByEmail = new Map();
      (core?.leads || []).forEach(l => {
        leadById.set(str(l.id), l);
        const e = str(l.email).toLowerCase();
        if (e) leadByEmail.set(e, l);
      });
      const LEAD_KINDS = new Set(['lead_unassigned', 'sla_breach']);
      const leadFor = it => (LEAD_KINDS.has(it.kind)
        ? leadById.get(str(it.ref)) || leadByEmail.get(str(it.ref).toLowerCase()) || null
        : null);

      const byChat = new Map();
      (threads || []).forEach(t => { const k = str(t.chat_id); if (k) byChat.set(k, t); });

      /* Workflow health, indexed by both of the things the view's `ref` could
         be. `v_needs_attention` documents `ref` only as an opaque reference, so
         the id is tried first and the name second — the title the view prints
         for a workflow_failure is the workflow's name, and matching on it is
         the fallback. An item that matches neither is reported as unmatched
         rather than quietly treated as still-failing or as recovered. */
      const healthById = new Map(), healthByName = new Map();
      (health || []).forEach(w => {
        if (str(w.id)) healthById.set(str(w.id), w);
        if (str(w.name)) healthByName.set(str(w.name).toLowerCase(), w);
      });
      const healthFor = it => (it.kind === 'workflow_failure'
        ? healthById.get(str(it.ref)) || healthByName.get(str(it.title).toLowerCase()) || null
        : null);
      let recoveredFlows = 0, unmatchedFlows = 0;

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

      let matchedLeads = 0, unmatchedLeadRefs = 0;

      const body = items.map(it => {
        const target = SCREENS[it.screen] ? it.screen : (KIND_SCREEN[it.kind] || 'overview');
        const flow = healthFor(it);
        const flowState = flow ? failureState(flow) : null;
        if (it.kind === 'workflow_failure') {
          if (!flow) unmatchedFlows += 1;
          else if (flowState.key === 'recovered') recoveredFlows += 1;
        }
        /* A workflow that has run clean since the failure that raised this item
           is still on the list — the view raised it and this screen does not
           overrule the view — but it is not screaming. The clock icon says the
           row is about something that happened, not something happening. */
        const icon = flowState && flowState.key === 'recovered'
          ? 'history'
          : (KIND_ICON[it.kind] || 'warning');
        /* `at` is a real column on the view. How long a thing has been waiting
           is most of what ranks it, so it is shown — and where the view left it
           null that is said, not rendered as an em dash. */
        const waited = it.at
          ? `<span class="t-muted">waiting ${esc(ago(it.at))}</span>`
          : '<span class="t-muted">no timestamp on this item, so how long it has waited is unknown</span>';
        const lead = leadFor(it);
        if (LEAD_KINDS.has(it.kind)) { if (lead) matchedLeads += 1; else unmatchedLeadRefs += 1; }
        let head, sub;
        if (it.kind === 'unanswered_chat') {
          const c = chatRow(it);
          head = `${c.named ? esc(c.name) : '<span class="t-warm">Unidentified WhatsApp contact</span>'} ${c.chips.join(' ')}`;
          sub = `${esc(it.detail)} · ${waited}<div class="cell-sub">${
            c.phone ? `<span class="mono">${esc(c.phone)}</span>` : '<span class="t-muted">No phone number stored for this thread</span>'
          } · <span class="mono" title="WhatsApp chat handle — a LID contains no phone digits and identifies nobody on its own">${esc(c.ref)}</span></div>`;
        } else if (lead) {
          head = esc(it.title);
          sub = `${esc(it.detail)} · ${waited}<div class="cell-sub">${
            str(lead.phone) ? `<span class="mono">${esc(str(lead.phone))}</span>`
              : '<span class="t-warm">No phone number on this lead record</span>'
          }${str(lead.email) ? ` · <span class="mono">${esc(str(lead.email))}</span>` : ''}</div>`;
        } else if (it.kind === 'workflow_failure') {
          head = esc(it.title);
          /* The second line is the whole point of the enrichment: "failed 6
             hours ago" and "failing right now" are the same row until something
             says which. Where v_workflow_health had no row to match, that is
             said too — an unmatched item is not evidence of anything. */
          sub = `${esc(it.detail)} · ${waited}<div class="cell-sub">${
            flowState ? flowState.text
              : '<span class="t-muted">no row in v_workflow_health matched this item, so whether it has run since cannot be told from here</span>'
          }${flow && n0(flow.failures_30d) != null
            ? ` <span class="t-muted">· ${esc(num(flow.failures_30d))} ${plural(n0(flow.failures_30d), 'failure', 'failures')} in 30 days${
                n0(flow.runs_30d) != null ? ` of ${esc(num(flow.runs_30d))} ${plural(n0(flow.runs_30d), 'run', 'runs')}` : ''}</span>`
            : ''}</div>`;
        } else {
          head = esc(it.title);
          sub = `${esc(it.detail)} · ${waited}`;
        }
        /* A matched lead opens that lead. Everything else goes to the screen the
           view named, which is as close to the row as this app can get from
           here — there is no cross-screen deep link. */
        const jump = lead
          ? `data-lead="${esc(lead.id)}" title="Open this lead"`
          : `data-goto="${esc(target)}" title="Open ${esc(target)}"`;
        /* Severity colours the icon, except where the row has just said the
           thing has already run clean since — a red glyph beside "has completed
           a run since, and that run did not fail" is the screen arguing with
           itself, and the operator believes the colour. The severity pill is
           untouched: that is the view's rating and it stays visible. */
        const iconTone = flowState && flowState.key === 'recovered' ? 'muted' : tone(it.severity);
        return `<div class="list-item" role="button" tabindex="0" ${jump}>
          <span class="material-symbols-outlined t-${iconTone}" style="font-size:20px">${icon}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${head}${
              pill(str(it.severity) || 'Unrated')}</div>
            <div class="cell-sub">${sub}</div>
            ${lead ? '<div class="cell-sub" aria-live="polite" data-leadmsg></div>' : ''}
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

      /* The badge and this list are two different counts and always will be:
         the badge is the sidebar's summary of what needs doing, the list is
         everything the view returned. Rather than quietly differing, the
         difference is named — item counts, the COLD exclusion, and the one
         thing this screen adds that the view cannot see. */
      const coldItems = items.filter(i => !BADGE_SEVERITIES.has(str(i.severity).toUpperCase())).length;
      const unscreened = items.filter(i => !str(i.screen)).length;

      const notes = [
        !threads ? 'v_conversations did not load, so WhatsApp threads above could not be checked against their contact records, and threads waiting outside this list could not be counted.' : '',
        stale ? `${num(stale)} further ${plural(stale, 'thread is', 'threads are')} awaiting a reply but older than the ${CHAT_WINDOW_DAYS}-day window this list uses — see Conversations.` : '',
        other ? `${num(other)} further ${plural(other, 'thread is', 'threads are')} marked awaiting_reply in v_conversations but ${plural(other, 'does', 'do')} not appear above.` : '',
        items.length >= ATTN_LIMIT ? `This read was capped at ${num(ATTN_LIMIT)} items, so there may be more than are listed.` : '',
        coreErr
          ? 'The leads read failed, so SLA and unassigned-lead items above are shown as the view worded them, without a phone number or a link into the record.'
          : unmatchedLeadRefs
            ? `${num(unmatchedLeadRefs)} lead ${plural(unmatchedLeadRefs, 'item', 'items')} above could not be matched to a row in the ${num((core?.leads || []).length)} leads read, so ${plural(unmatchedLeadRefs, 'it opens', 'they open')} the Leads screen rather than the record.`
            : '',
        matchedLeads
          ? `${num(matchedLeads)} of these ${plural(matchedLeads, 'item opens', 'items open')} the lead record itself, with the customer's number on it; the rest open the screen that can act on them.`
          : '',
        /* The workflow enrichment, explained where its effect is visible. Both
           halves matter: what "has run since" is read from, and what it is not
           proof of. */
        recoveredFlows ? RECOVERY_CAVEAT : '',
        health == null && items.some(i => i.kind === 'workflow_failure')
          ? 'v_workflow_health did not load, so the workflow items above are shown as the view worded them — this screen cannot say which of them have run cleanly since they failed.'
          : unmatchedFlows
            ? `${num(unmatchedFlows)} workflow ${plural(unmatchedFlows, 'item', 'items')} above could not be matched to a row in v_workflow_health, so nothing is claimed about whether ${plural(unmatchedFlows, 'it has', 'they have')} run since.`
            : '',
        /* An absence an operator would otherwise read as an all-clear. The
           undercut branch of the view compares competitors.our_price_aed
           against our own; with no rows to compare it cannot fire at all, which
           is a different thing from our prices being competitive. */
        rivals && rivals.length === 0
          ? 'No undercut item can appear on this list at present: the competitors table is empty, so the view has nothing to compare our prices against. That is a silent scraper, not a clean sheet — the rows return when the price scrape next runs.'
          : '',
        /* Badge arithmetic, in words, every time — a badge nobody can reproduce
           from the screen under it is a number people learn to ignore. */
        `This panel lists all ${num(items.length)} ${plural(items.length, 'item', 'items')} the view returned${
          coldItems ? `, including ${num(coldItems)} not marked HOT or WARM` : ''}${
          unscreened ? ` and ${num(unscreened)} the view attributes to no screen` : ''}.`,
        `Nav badges are painted by lib/badges.js from one read of v_needs_attention every 60 seconds and count HOT and WARM only — COLD is left out on purpose so a badge stays worth reading. Items the view files against no screen have no nav item to sit on, so they are counted into the Overview badge and nowhere else.`,
        gapRows == null
          ? `The KYC archive-gap read failed, so the badge is the shared count alone${need.floor == null ? '' : ` (${num(need.floor)})`} and any gap it would have added is missing from it.`
          : need.kycExtra
            /* Written as the sum, both terms named, because a badge an owner
               cannot reconstruct from the screen under it is a number they
               learn to ignore — and this one is now mostly made of rows that
               are not on this list at all. */
            ? `The Overview badge reads ${num(need.badge)} = ${num(need.floor)} + ${num(need.kycExtra)}: ${num(need.floor)} HOT or WARM ${plural(need.floor, 'item', 'items')} in v_needs_attention across every screen${
                need.floorFrom === 'own' ? ', counted from this panel because the shared badge read has not returned yet' : ''
              }, plus ${num(need.kycExtra)} KYC archive ${plural(need.kycExtra, 'gap', 'gaps')} from the KYC archive-gaps panel above, which the view does not list at all. badges.js repaints the ${num(need.floor)} on its own next poll; the gaps are added back the next time this screen renders, and the KYC panel above lists them either way.`
            : `Nothing here is missing from that count, so the Overview badge is left exactly as badges.js painted it${need.floor == null ? '' : ` — ${num(need.floor)}`}.`,
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
    wireLeadRows(card);
    wireGoto(card);
  }));

  const FEED_LIMIT = 8;
  panels.push(panel(feedHost, {
    title: 'Live lead feed',
    sub: 'Newest first',
    actions: `<button class="btn sm" data-act="leads">View all</button>`,
    /* `phone` is on the lead row, so the newest enquiry can be rung from the
       first screen an owner opens. `ai_score` is the router's score — there is
       no `lead_score` column on this table, whatever older code called it. */
    load: () => db(`leads?select=id,name,phone,status,ai_score,vehicle_interest,source,created_at&order=created_at.desc&limit=${FEED_LIMIT}`),
    /* `card` is handed the rows so they can be wired to the drawer once this
       HTML is actually in the document — render() runs before it is. */
    render: (rows, card) => {
      card.__rows = rows;
      if (!rows.length) return stateEmpty('No leads yet', 'They appear here the moment the router webhook receives one.');
      /* Fewer rows than the page size means this is not the top of a long list,
         it is the whole list — which reads very differently. */
      const notes = [
        rows.length < FEED_LIMIT
          ? `The query asked for the newest ${FEED_LIMIT} leads and got ${rows.length}, so this is the whole leads table, not the top of it.`
          : '',
        'A row opens that lead. Leads has no last-modified timestamp, so this is ordered by when each one arrived, which is the only time the table records.',
      ].filter(Boolean);
      const note = `<div class="list-item" style="cursor:default"><span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
             <div class="cell-sub" style="white-space:normal">${notes.map(esc).join('<br>')}
               <div aria-live="polite" data-feedmsg></div></div></div>`;
      return table([
        { label:'When', render: r => `<div class="t-muted">${esc(ago(r.created_at))}</div><div class="cell-sub mono">${esc(clock(r.created_at))}</div>` },
        { label:'Status',  render: r => pill(str(r.status) || 'Unscored') },
        { label:'Name',    strong: true, render: r => esc(str(r.name) || 'Unnamed lead') },
        { label:'Phone',   render: r => str(r.phone)
            ? `<span class="mono">${esc(str(r.phone))}</span>`
            : `<span class="cell-sub t-warm">Not captured</span>` },
        { label:'Interest',render: r => `<span class="t-2">${str(r.vehicle_interest) ? esc(str(r.vehicle_interest)) : '<span class="cell-sub">Not recorded</span>'}</span>` },
        { label:'Score', align:'r', render: r => num(r.ai_score) },
      ], rows, { onRow: true }) + note;
    },
  }).then(card => {
    card.querySelector('[data-act]')?.addEventListener('click', () => go('leads'));
    /* The same drawer the Leads screen opens, on the row that was clicked. A
       failed read reports itself in the footnote under the table rather than
       leaving a click that did nothing. */
    wireRows(card, card.__rows || [], r => openLead(r.id, card.querySelector('[data-feedmsg]')));
  }));

  await Promise.all(panels);
};

/* ==========================================================================
   S2 · Leads
   ========================================================================== */
