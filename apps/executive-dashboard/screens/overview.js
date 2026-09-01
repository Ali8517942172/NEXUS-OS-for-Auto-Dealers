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
     · The database then held one customer and one lead, so nearly every figure
       on the strip was n=1. Each of them says so in its own words instead of
       standing there looking like a rate. (1 Sep 2026: three leads, two of them
       carrying a recorded response time. The n=1 wording is conditional on the
       counts and simply stops firing — which is what it was written for; the
       sentence above is left as the dated observation it was, not as a claim
       about the table today.)

   Every bullet above is an observation dated 24 Aug 2026, and none of them
   still describes the database. Counted live on 1 Sep 2026 at 14:18 UTC,
   v_needs_attention returns 13 items: 8 unanswered_chat, 2 workflow_failure,
   2 undercut and 1 inventory_aging. `competitors` refilled and holds 11 rows,
   so the undercut kind is firing again — which is what the paragraph above
   predicted would happen and the reason the kind was left handled rather than
   removed. `kyc_documents` went the other way and is now empty. The bullets
   are kept as the record of why the code is shaped this way; they are not a
   description of what is on screen.

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

   2. The KYC table can hold rows that were never KYC submissions — uncaptioned
      WhatsApp images auto-routed to the auditor. Those carry `void_reason`,
      and the view's own `kyc_archive_gap` branch excludes them. The archive-gap
      count computed here excludes them too (`void_reason is null`); the voided
      rows with no stored file are reported separately as what they are.
      Written as a rule rather than as a census, because it stopped being one:
      `kyc_documents` holds 0 rows on 1 Sep 2026 (counted live, 14:18 UTC), so
      there is nothing of either kind in it today and every branch below takes
      its empty path. The partitioning stays for the next time it fills.

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
      emergency at midnight. So the distinction is read off the view's columns,
      for every workflow, rather than from a list of which causes somebody
      believes are fixed — the list would be a hardcoded opinion and would rot
      within a day.

      Which columns changed on 31 Aug 2026, and the old ones were wrong. This
      screen used to compare `last_run` against `last_failure` and print, in
      green, "has completed a run since, and that run did not fail". `last_run`
      is `max(logged_at)` over rows of ANY status, and `audit_log.status` is not
      binary — it holds SUCCESS, FAILED, PARTIAL, NOT_EXECUTED, REJECTED and
      ESCALATED. So that comparison only ever proved "the newest row is not
      literally labelled FAILED". Finance Calc rendered here as recovered, in
      grey, at the bottom of the card, while its six newest rows were all
      NOT_EXECUTED — "Calculator ran but produced NO calculation" — and it had
      issued no quote for an hour. Customer 360 rendered as recovered on a
      PARTIAL row reading "Gmail read failed".

      `v_workflow_health` was rebuilt on public.nexus_outcome_class() and now
      carries `last_success`, `last_partial` and `last_incomplete` (the newer of
      the last failure and the last half-done run), plus the counts each outcome
      class earns. Recovery is now read off `last_success` — the only column
      that is evidence a run did the job — and only where that success is also
      the newest run there is. `lib/health.js` mirrors the same function and is
      the only place allowed to say what a status means; nothing in this file
      classifies one itself.

      It is still evidence, not a clean bill of health, and the screen says so:
      the audit log records only runs that COMPLETED, so a workflow hung right
      now leaves no row at all and cannot be distinguished from an idle one here.

   Everything below is a number Postgres produced. Nothing is estimated, and
   where a figure rests on a handful of rows the screen says how few — a single
   test record must not read as a trend. */
/* COUNTS, not a copy of it. badges.js exports the severity set precisely so
   this file cannot drift from it — see the note at the foot of badges.js. */
import { COUNTS as BADGE_SEVERITIES, LAST as BADGE_SNAPSHOT } from '../lib/badges.js';
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, ago, clock, esc, mins, n0, num, pct, pill, tone } from '../lib/format.js';
/* The only place in this app allowed to decide what a run outcome means. This
   screen reads the columns v_workflow_health already computed from the same
   rule and does not classify anything itself. */
import { healthWords, successRate } from '../lib/health.js';
import { leadDrawer } from '../lib/lead-drawer.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { kpi, panel, table, wireRows } from '../lib/ui.js';

/* The reply-gap analysis is windowed so it is provably complete rather than
   merely likely: a reply to a lead can only be logged at or after that lead was
   created, so if we read every outbound message inside the window we hold every
   message that could possibly be a reply to a lead created inside it. Reading
   "the newest N messages" instead would silently mark answered leads as
   unanswered the moment the dealership got busy.

   Reading them all is necessary and it is not sufficient, and this comment used
   to stop one sentence early — as did the code. Holding every candidate proves
   nothing until the at-or-after test is actually performed on each one, and it
   was not: membership of an address in the outbound set was the whole check, so
   a message sent weeks BEFORE a lead existed marked that lead answered. The
   comparison is done below, against each lead's own created_at. */
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

/* BADGE_SEVERITIES is imported from lib/badges.js above, not restated here.
   COLD is excluded there deliberately — a permanent number over a nav item for
   something nobody intends to act on today is how a badge stops being read at
   all — and this file has to apply the same rule when it works out the floor it
   is not allowed to go below. It used to be mirrored here as a literal with a
   comment saying "if badges.js ever changes this set, change this line too",
   which is a coupling nothing can check: the day one side gained COLD the badge
   would have silently disagreed with the panel under it. */

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

/* Failing now, or fixed earlier in the window and clean since? The two look
   identical on an alert list, and they are not the same call for an owner at
   midnight — one is a workflow to go and fix, the other is a workflow to check
   in the morning.

   The evidence is `last_success`, and nothing else will do. This function used
   to read `last_run > last_failure`, which is only ever proof that the newest
   row is not literally labelled FAILED: it printed "has completed a run since,
   and that run did not fail", in green, over Finance Calc's six consecutive
   NOT_EXECUTED rows and over a Customer 360 PARTIAL that read "Gmail read
   failed". A run that produced nothing is not a recovery.

   So there are four states and only one of them is green:

     failing    nothing has succeeded since the newest run that failed or went
                out half-done (`last_incomplete`), or nothing has succeeded at
                all in the window, or the view's own `health` says the workflow
                produces nothing usable. Red.
     stale      a run did succeed, and it is NOT the newest run: `last_run` is
                later, and because `last_success` is the newest success by
                construction, whatever ran last was not one. Amber, and the
                sentence says exactly that and no more — this file cannot tell a
                NOT_EXECUTED from a refusal without reading audit_log itself, so
                it claims neither.
     recovered  the newest run there is, is a success. Green.
     unknown    the view records no time for any run at all, so nothing can be
                told from here.

   The PRODUCING_NOTHING test is first and it is not decoration. `last_incomplete`
   is the newer of `last_failure` and `last_partial`, and a workflow that never
   fails and never goes half-done — it just returns nothing — has NEITHER, so it
   arrives here with `last_incomplete` null. Keyed on that column alone this
   function returned "unknown", in grey. Competitor Price Scraping is exactly
   that workflow: 94 of its 108 runs in the window produced nothing usable, and
   its last success landed 0.8 seconds before its newest run — both figures read
   live from v_workflow_health on 1 Sep 2026 at 14:18 UTC, and both were quoted
   here as 84 of 96 until then. So a recency test would also have called it
   stale rather than broken. Producing nothing is not an incident that a later
   run can be "since"; it is the current condition,
   and the view already computed it.

   This function never guesses upward: an alert wrongly softened is worse than
   one left loud. */
const failureState = w => {
  const health = String((w && w.health) || '').toUpperCase();
  const incompleteAt = Date.parse(w && w.last_incomplete);
  const partialAt = Date.parse(w && w.last_partial);
  const successAt = Date.parse(w && w.last_success);
  const ranAt = Date.parse(w && w.last_run);
  const hasIncomplete = !Number.isNaN(incompleteAt);
  if (health === 'PRODUCING_NOTHING') {
    return { key: 'failing',
      text: `<span class="t-hot">most of what it runs produces nothing usable, so a newer run is not evidence of recovery${
        Number.isNaN(successAt) ? ' — nothing it has run in the window succeeded outright' : `; its last outright success was ${esc(ago(w.last_success))}`}</span>` };
  }
  /* Which kind of not-clean the newest one was. last_incomplete is the newer of
     last_failure and last_partial, so an exact match on last_partial names it. */
  const halfDone = hasIncomplete && !Number.isNaN(partialAt) && partialAt === incompleteAt;
  const wording = halfDone ? 'went out half-done' : 'failed';
  if (Number.isNaN(successAt)) {
    if (hasIncomplete) {
      return { key: 'failing',
        text: `<span class="t-hot">nothing it has run in the window succeeded outright, and its newest run that was not clean ${wording} ${esc(ago(w.last_incomplete))}</span>` };
    }
    if (Number.isNaN(ranAt)) {
      return { key: 'unknown',
        text: '<span class="t-muted">the view records no time for any run, so whether anything has succeeded cannot be told from here</span>' };
    }
    return { key: 'failing',
      text: `<span class="t-hot">nothing it has run in the window succeeded outright; its newest run was ${esc(ago(w.last_run))} and it was not one</span>` };
  }
  if (hasIncomplete && successAt <= incompleteAt) {
    return { key: 'failing',
      text: `<span class="t-hot">its newest run that was not clean ${wording} ${esc(ago(w.last_incomplete))}, and nothing has succeeded outright since</span>` };
  }
  if (!Number.isNaN(ranAt) && ranAt > successAt) {
    return { key: 'stale',
      text: `<span class="t-warm">its newest run is not a success — something ran ${esc(ago(w.last_run))} that did not succeed, and its last outright success was ${esc(ago(w.last_success))}</span>` };
  }
  return { key: 'recovered',
    text: `<span class="t-ok">its newest run is a success, ${esc(ago(w.last_success))}</span>` };
};
/* Said wherever a row above claims to have recovered. The audit log holds one
   row per run that COMPLETED, so "it has succeeded since" is evidence about the
   last run that finished — not proof of health, and a workflow hung right now
   writes no row at all and is indistinguishable from an idle one from here. */
const RECOVERY_CAVEAT = 'A workflow marked as having succeeded since is read from v_workflow_health: last_success later than last_incomplete, and last_success being the newest run of any kind. That is evidence the most recent completed run did the job, not a clean bill of health — the audit log records only runs that finish, so a run hung right now leaves no row and cannot be seen from this screen. Recovery is never read off last_run: that column is the newest row of ANY status, and a run that produced nothing is not a recovery.';
/* Said wherever a row is amber rather than green. */
const STALE_CAVEAT = 'A workflow marked as having succeeded but not on its newest run is stating arithmetic, not a diagnosis: last_success is the newest success by construction, so a later last_run is a run that was not one. What it was instead — half-done, no result, refused by design or escalated to a person — is in the counts beside it and in full on Automation.';

/* The two numbers every workflow row on this screen is rated on, derived once
   so the triage card and the Needs-attention enrichment cannot print different
   arithmetic about the same workflow three panels apart.

   `failures_30d` is deliberately NOT one of them. It counts only rows the
   outcome rule classes as an outright failure, and a workflow can be DEGRADED
   with none: Finance Calc has zero, and has issued three quotes out of the
   twenty-nine runs that counted (v_workflow_health, live 1 Sep 2026 14:18 UTC;
   the denominator was twenty-seven when this was written). A Needs-attention
   item reading "2 failed runs in the last 24 h" beside an enrichment reading
   "0 failures in 30 days" is the
   screen arguing with itself, and both sentences were true — they were counting
   different things. `effective_runs_30d` excludes runs refused by design and
   runs escalated to a person on purpose; neither is the workflow failing to
   deliver, and leaving them in dilutes a real miss rate. */
const runCounts = w => {
  const eff = n0(w && w.effective_runs_30d);
  const succ = n0(w && w.successes_30d);
  return { eff, succ, notClean: (eff != null && succ != null) ? eff - succ : null };
};

/* ── One thing needing a human, listed once ──────────────────────────────────
   Until 1 Sep 2026 `v_needs_attention` had no DISTINCT ON, and its `undercut`
   branch selected straight from `competitors`, which accumulates one row per
   nightly scrape. The same Toyota Fortuner at the same price against the same
   rival therefore arrived as one item per night it had been checked — five rows
   that evening, refs 18, 20, 23, 24 and 25, identical in kind, title and detail
   and differing only in `scraped_at`. The panel listed all five, counted all
   five, and then closed with "This panel lists all 17 items the view returned"
   as though that were a reconciliation. Thirteen things actually needed a human.

   The right fix was a DISTINCT ON in the view, and the view has it now — see
   the dated note below. This file could not make that change and must not
   pretend the number is fine until someone does.

   SNAPSHOT_KINDS is the whole of the rule and it is deliberately narrow. It
   names the kinds whose `ref` identifies a LOG ROW rather than the subject —
   `undercut` is the only one today — and for those, and only those, rows that
   agree on kind, title and detail are one item and the newest is kept. Every
   other kind keys on a ref that IS the subject (a chat id, a lead id, a unit
   id, a workflow name), so nothing is collapsed and two same-named leads cannot
   silently become one. If the view gains its DISTINCT ON the groups become
   singletons, `collapsed` falls to zero and the sentence about it disappears on
   its own — this does not have to be unwound by hand. 
   As of 2026-09-01 the view itself de-duplicates: its undercut branch selects
   DISTINCT ON (competitor, model) the newest snapshot, so it should no longer
   emit these. This stays as defence in depth -- the scraper still appends
   rather than upserts, so the raw table keeps growing and any new branch that
   reads it unguarded reintroduces the fault. If it ever collapses anything
   again, the source has regressed.

   Confirmed rather than assumed on 1 Sep 2026: `competitors` holds 11 rows,
   `v_competitor_latest` and the view's own DISTINCT ON reduce them to 5 per
   (competitor, model), and `v_needs_attention` emits 2 undercut items — one
   each for the two whose price_diff_aed is negative. `collapsed` is 0 on this
   data, so every sentence below that is conditional on it stays silent.
*/
const SNAPSHOT_KINDS = new Set(['undercut']);
const collapseSnapshots = rows => {
  const seen = new Map();
  const out = [];
  let collapsed = 0;
  rows.forEach(it => {
    if (!SNAPSHOT_KINDS.has(it.kind)) { out.push(it); return; }
    const key = `${it.kind}|${str(it.title)}|${str(it.detail)}`;
    const at = seen.get(key);
    if (at == null) { seen.set(key, out.length); out.push(it); return; }
    collapsed += 1;
    /* Rows are already sorted newest-first inside a kind, so the one held is
       the most recent observation. Kept explicit rather than relied upon. */
    if (Date.parse(it.at) > Date.parse(out[at].at)) out[at] = it;
  });
  return { rows: out, collapsed };
};

/* Open or finished, taken straight out of the TONE table in lib/format.js so
   this screen cannot grow a second lead-lifecycle vocabulary. Three writers
   fill leads.status — the router writes HOT/WARM/COLD, the Slack Command Center
   writes CONTACTED/QUALIFIED/WON/LOST through an unconstrained $fromAI, the BDC
   agent writes DISQUALIFIED — and format.js is where those eight words are
   already mapped to 'won', 'dead' and 'open'. A status nobody has taught that
   table about tones to 'unknown' and is counted as open here: a lead is not
   finished because a word was not recognised. */
const TERMINAL_TONES = new Set(['won', 'dead']);
const isOpenLead = l => !TERMINAL_TONES.has(tone(l && l.status));

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
     that is failing now from one that failed earlier in the window and has
     succeeded since. Two reads could put a row in one state on one panel and
     the other state three lines below it, which is worse than not
     distinguishing them at all.

     The filter is `health`, not `failures_30d=gt.0`, and the difference is not
     cosmetic. Since v_workflow_health was rebuilt on nexus_outcome_class(), a
     workflow can be DEGRADED with zero rows labelled FAILED — Finance Calc is
     DEGRADED on 5 half-done runs and 21 that produced nothing (live 1 Sep 2026,
     14:18 UTC; 19 when this was written), and `failures_30d=gt.0` would have
     dropped it out of this panel entirely on the evening its calculator stopped
     issuing quotes. The rule is what matters here and it is not tonight's
     numbers: v_workflow_health raises DEGRADED on `failures_30d > 0` OR
     `partials_30d > 0` (view definition read live the same day), so a workflow
     that only ever goes half-done never touches the FAILED count and is still
     degraded. PRODUCING_NOTHING is here
     for the same reason: a workflow that runs clean and achieves nothing is not
     a workflow to leave off a triage card. UNKNOWN_OUTCOME is a workflow
     logging a status this system does not define, which is also not health.

     A workflow_failure item in v_needs_attention does NOT come from rows
     labelled FAILED, whatever this note said until 1 Sep 2026. Its branch —
     definition read live that day — counts audit_log rows in the last 24 h
     where `nexus_outcome_class(workflow, status, summary)` is FAILURE **or**
     PARTIAL, and its detail string says "N runs that did not deliver", not
     "failed". Two n8n Delivery Reports were changed the same day to stop
     writing FAILED on a partial delivery, so the two kinds of item genuinely
     separated rather than being a wording difference. The conclusion the old
     sentence drew is unchanged and now rests on the right premise: either class
     puts failures_30d or partials_30d above zero, and v_workflow_health raises
     DEGRADED on either, so the item's workflow is inside this set. An item with
     no match here is still reported as unmatched rather than assumed healthy. */
  const readHealth = shared(() => db('v_workflow_health?select=id,name,category,health,runs_30d,failures_30d,partials_30d,no_result_30d,rejected_30d,escalated_30d,successes_30d,unknown_30d,effective_runs_30d,success_rate_30d,last_run,last_success,last_failure,last_partial,last_incomplete,is_active'
    + '&health=in.(DEGRADED,PRODUCING_NOTHING,UNKNOWN_OUTCOME)'
    + '&order=failures_30d.desc,partials_30d.desc,name.asc&limit=50'));
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
     cut-off of its own — `created_at > 2026-08-17 16:01:48+00`, read off the
     view definition on 1 Sep 2026) is a compliance hole no badge would
     otherwise mention.

     On 24 Aug that refinement was the larger half of the badge: the view
     returned three items and there were eight unarchived submissions it said
     nothing about. It adds nothing today, and the sentence claiming those eight
     was still here a week after they stopped existing. `kyc_documents` holds
     0 rows — counted live 1 Sep 2026, 14:18 UTC — so there is no gap to find,
     the view lists none, `need.kycExtra` is 0 and rule 2 below leaves the badge
     exactly as badges.js painted it. The mechanism stays, because the table
     refills the first time the KYC auditor writes to it again. An empty table is
     also not an all-clear: KYC/AML Document Auditor (Phase 5) reads DEGRADED in
     v_workflow_health with 0 successes in 9 runs and nothing logged since
     17 Aug (same read), so what this panel is looking at is a stopped pipeline,
     not a clean book.

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
  /* Both floors collapse snapshot duplicates first, for the same reason the
     panel does: v_needs_attention emits one `undercut` row per stored
     competitor scrape, so a single car undercut at a single price arrives four
     times. Counting the raw rows made the badge read 17 while the panel below
     it listed 13 — the badge accusing the dealership of four problems that are
     one problem seen four times. badges.js applies the identical rule (it
     exports SNAPSHOT_KINDS and collapseAttention so the two cannot drift), and
     the floor has to be measured on the same footing as the number it is
     protecting or Math.max below re-inflates what the panel just collapsed. */
  const sharedFloor = () => {
    const rows = BADGE_SNAPSHOT && BADGE_SNAPSHOT.rows;
    if (!rows) return null;
    return collapseSnapshots(rows).rows
      .filter(r => BADGE_SEVERITIES.has(str(r.severity).toUpperCase())).length;
  };
  /* The same rule applied to the rows this screen read, so the first render has
     a floor before badges.js has polled once. */
  const ownFloor = items => collapseSnapshots(items || []).rows
    .filter(i => BADGE_SEVERITIES.has(str(i.severity).toUpperCase())).length;

  const setBadge = () => {
    const extra = need.kycExtra || 0;
    /* Named `sharedCount`, not `shared`: the memo helper at the top of this
       function is called `shared`, and a second `shared` declared here shadows
       it for the whole of setBadge's body. Nothing above this line calls the
       memo today, so there is no TDZ error today — which is exactly the shape
       of the `up is not defined` regression the 31 Aug hoist was written to
       fix, one added line away from taking the whole screen to the error card. */
    const sharedCount = sharedFloor();
    const own = need.attention == null ? 0 : ownFloor(need.items);
    /* max(), not a choice between them: whichever snapshot saw more rows is the
       one this badge must not fall below. badges.js reads 500 rows and this
       screen reads 200, so on a busy morning the shared count is the larger. */
    need.floor = sharedCount == null ? own : Math.max(sharedCount, own);
    need.floorFrom = sharedCount == null ? 'own' : 'shared';
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

  /* Hoisted out of the try below on 31 Aug 2026. Both were declared inside
     that block, but the lead-mix panel further down calls up() outside it —
     so Overview died with "up is not defined" the moment that panel rendered,
     and the whole screen showed the error card instead. Block scope, not a
     data problem: nothing about the try's success or failure changes it. */
  const up = s => String(s || '').toUpperCase();
  const norm = v => String(v || '').trim().toLowerCase();
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
         nothing at all. Read defensively, select nothing specific.

         One row, not two. This read asked for two and then compared against the
         second — the day-before-last — leaving the newest snapshot fetched and
         unused. Live on 31 Aug that meant reading the 08-29 row, whose
         avg_response_minutes is null, and printing "the 2026-08-29 snapshot
         records no comparable figure" directly under a tile whose 08-30
         snapshot, one row above the one it read, holds 0.00. Every figure on
         this strip is computed live from the current tables, so the only
         correct comparison is the most recent snapshot there is. */
      db('daily_metrics?select=*&order=snapshot_date.desc&limit=1').catch(() => []),
      /* `channel` is selected because `direction` alone cannot tell a reply to a
         customer from a marker this system wrote to itself. See the reply
         analysis below. */
      db(`communication_logs?select=lead_email,created_at,channel,direction&direction=eq.outbound&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=${OUTBOUND_LIMIT}`),
    ]);

    const hot = leads.filter(l => up(l.status) === 'HOT').length;
    const warm = leads.filter(l => up(l.status) === 'WARM').length;
    const cold = leads.filter(l => up(l.status) === 'COLD').length;

    /* Open leads are a subset of the table, and until 31 Aug this screen did
       not draw the distinction anywhere: the first tile on the first screen was
       labelled "Open leads" and rendered `leads.length`, the unfiltered row
       count. Live that printed 3 over 1 WARM and 2 DISQUALIFIED — a 3x
       overstatement of the working pipeline — and once the Slack Command Center
       starts writing WON and LOST at volume it becomes a lifetime lead counter
       that never goes down. `leads.length` still means every row and is still
       used as that below; the open count is its own name. */
    const openLeads = leads.filter(isOpenLead);
    const terminal = leads.filter(l => !isOpenLead(l));
    const terminalNames = [...new Set(terminal.map(l => up(l.status)).filter(Boolean))].sort();

    /* Response time is measured over every lead, terminal ones included: how
       fast the dealership answered an enquiry is a fact about that enquiry and
       does not stop being one when the lead is later lost. */
    const withResp = leads.filter(l => n0(l.response_time_minutes) != null);
    const avgResp = withResp.length ? withResp.reduce((a, l) => a + Number(l.response_time_minutes), 0) / withResp.length : null;
    /* Pipeline is the opposite case: a WON deal is money already taken and a
       DISQUALIFIED enquiry is money that was never there, so neither belongs in
       a forecast. And with nothing to add up the figure is null, not 0 —
       `reduce(…, 0)` used to render a large "AED 0" directly above a caption
       saying no pipeline figure exists, which is the number and the caption
       asserting opposite things with the number winning. Response time two
       tiles left has always handled this correctly; this is the same shape. */
    const withBudget = openLeads.filter(l => n0(l.budget_aed) != null);
    const pipeline = withBudget.length
      ? withBudget.reduce((a, l) => a + Number(l.budget_aed), 0)
      : null;
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
    /* ── What counts as a reply ──────────────────────────────────────────
       Two things were wrong here and they were wrong independently.

       Not every outbound row is a message to a customer. `channel` exists on
       communication_logs precisely to separate the two, and this filtered on
       `direction` alone — so the Silence Detector's own markers, written
       `channel='system'` and reading "[SILENCE-ESCALATED] Silent for 12h
       since …", counted as proof somebody had replied. Those rows exist
       BECAUSE nobody replied. The detector already fixed this on its writing
       side (it now writes direction 'internal'); the two legacy rows still
       carry direction 'outbound' and are excluded here by channel. Both
       spellings are excluded, so neither side has to be deployed first.

       And a set of addresses is not an answer. Membership alone marked a lead
       answered by any message to that address in the window, including one sent
       before the lead row existed — so a returning customer quoted in August
       and re-enquiring today is exempted from the five-minute rule on the
       strength of the earlier quote, silently, for exactly the segment with the
       highest close rate. The newest reply per address is kept and compared
       against the lead's own created_at. */
    const INTERNAL_CHANNELS = new Set(['system', 'internal']);
    const isInternal = c => INTERNAL_CHANNELS.has(norm(c.channel)) || norm(c.direction) === 'internal';
    const internalMarkers = outbound.filter(isInternal).length;
    const replies = outbound.filter(c => !isInternal(c));
    const lastReply = new Map();
    replies.forEach(c => {
      const k = norm(c.lead_email);
      const t = Date.parse(c.created_at);
      if (!k || Number.isNaN(t)) return;
      const seen = lastReply.get(k);
      if (seen == null || t > seen) lastReply.set(k, t);
    });
    /* At or after, not merely present. Equal timestamps are counted as an
       answer: the router writes the lead and the BDC agent's first message
       within the same second on a WhatsApp enquiry. */
    const answeredSince = l => {
      const t = lastReply.get(norm(l.email));
      const born = Date.parse(l.created_at);
      return t != null && !Number.isNaN(born) && t >= born;
    };
    /* communication_logs.lead_email holds an email when the lead is known and a
       raw WhatsApp handle when it is not, so some outbound messages in this
       window are filed against a handle and can never match a lead row. They
       are counted, not silently dropped: a lead answered on WhatsApp before it
       was identified would still be listed below as unanswered, and an operator
       has to be told that rather than left to discover it. */
    const outboundHandles = replies.filter(c => isHandle(c.lead_email)).length;
    const recent = leads.filter(l => Date.parse(l.created_at) >= sinceMs);
    /* Terminal leads are not people waiting for a call. A lead the BDC agent
       disqualified as spam was eligible for this queue, in red, as somebody who
       needed ringing. */
    const recentOpen = recent.filter(isOpenLead);
    const recentTerminal = recent.length - recentOpen.length;
    /* A lead with no email cannot be matched against communication_logs, which
       keys on lead_email; one with no readable created_at cannot be compared
       against a reply time. Neither is counted as unanswered — that would
       invent a queue — and neither is counted as answered either, which is what
       the all-clear sentence used to do by printing `recent.length` as its
       denominator while testing a strictly smaller set. `tested` is the cohort
       every claim on this strip is now made about, and the untested rows are
       reported as their own number rather than absorbed into a green line. */
    const noEmail = recentOpen.filter(l => !norm(l.email)).length;
    const tested = recentOpen.filter(l => norm(l.email) && !Number.isNaN(Date.parse(l.created_at)));
    const untestable = recentOpen.length - tested.length;
    const waiting = tested
      .filter(l => !answeredSince(l))
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

    core = { leads, inv, hot, warm, cold, avgResp, withResp, withBudget, pipeline,
             openCount: openLeads.length, terminalCount: terminal.length, terminalNames,
             risk, warning, riskHolding, riskList, holding, metrics, waiting,
             untestable, noEmail, recentTerminal, testedCount: tested.length,
             outboundHandles, outboundCount: replies.length, internalMarkers,
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
            openCount, terminalCount, terminalNames,
            risk, warning, riskHolding, riskList, holding, metrics, waiting, recentCount,
            testedCount, untestable, noEmail, recentTerminal,
            leadsCapped, invCapped } = core;

    /* Deltas only exist once there are two snapshots. Until then no delta line
       renders at all — an earlier build showed "-18s vs last week" as a
       hardcoded string with nothing behind it. */
    /* metrics[0], the newest snapshot. This read `metrics[1]` while asking for
       two rows, so it compared today's live figures against the day before
       last and left the newest snapshot fetched and unread. */
    const prev = metrics.length ? metrics[0] : null;
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
      /* What the headline leaves out, named. The tile counts leads still being
         worked; the table also holds the finished ones, and an owner comparing
         this number against a row count elsewhere has to be able to see the
         difference rather than discover it. */
      + (terminalCount
          ? `<br>${muted(`${num(terminalCount)} further ${plural(terminalCount, 'lead is', 'leads are')} closed — ${terminalNames.join(', ')} — and ${plural(terminalCount, 'is', 'are')} not counted above. The table holds ${num(leads.length)} ${plural(leads.length, 'row', 'rows')} in total.`)}`
          : '')
      + (leadsCapped
          ? `<br>${warn(`Capped at ${num(LEAD_LIMIT)} rows — the leads table holds more than this.`)}`
          : leads.length <= THIN
            ? `<br>${warn(`That is the whole leads table — ${num(leads.length)} ${plural(leads.length, 'row', 'rows')}, not a sample of it.`)}`
            : '')
      + (snapshotShrank
          ? `<br>${warn(`${snapshotWhen} counted ${num(prevOpen)} open leads and the table now holds ${num(leads.length)} in total, so it was counting rows that have since gone. Every comparison against it on this strip inherits that.`)}`
          : '');

    /* ── Awaiting first reply ─────────────────────────────────────────────
       Every sentence here is about `tested` and says so. The green line used to
       be printed over `recentCount`, which includes the leads the code had
       explicitly declined to check: live, it read "All 3 leads created in the
       last 30 days have an outbound message" while one of the three had no
       email address, was never tested, and was sitting two panels below as a
       HOT unanswered WhatsApp thread waiting since 26 Aug. A denominator that
       is larger than the cohort actually examined is an all-clear over rows
       nobody looked at. */
    const untestedNote = (untestable || recentTerminal)
      ? `<br>${warn([
          untestable
            ? `${num(untestable)} open ${plural(untestable, 'lead', 'leads')} in this window could not be checked${noEmail ? ` — ${num(noEmail)} ${plural(noEmail, 'has', 'have')} no email address, and communication_logs can only be matched on one` : ''}, so ${plural(untestable, 'it is', 'they are')} not in the figure above either way.`
            : '',
          recentTerminal
            ? `${num(recentTerminal)} further ${plural(recentTerminal, 'lead in this window is', 'leads in this window are')} already closed and ${plural(recentTerminal, 'is', 'are')} not counted as waiting.`
            : '',
        ].filter(Boolean).join(' '))}`
      : '';
    const waitSub = waiting.length
      ? `<span class="t-hot">Oldest arrived ${esc(ago(waiting[0].created_at))}, still unanswered</span>`
        + `<br>${muted(`Out of ${num(testedCount)} open ${plural(testedCount, 'lead', 'leads')} created in the last ${WINDOW_DAYS} days that could be checked`)}`
        + untestedNote
      : testedCount
        ? `<span class="t-ok">All ${num(testedCount)} open ${plural(testedCount, 'lead', 'leads')} created in the last ${WINDOW_DAYS} days that could be checked ${plural(testedCount, 'has', 'have')} an outbound message sent after ${plural(testedCount, 'it arrived', 'they arrived')}</span>`
          + (testedCount <= THIN ? `<br>${warn(`On ${num(testedCount)} ${plural(testedCount, 'lead', 'leads')} this says almost nothing about the reply habit.`)}` : '')
          + untestedNote
        : recentCount
          ? warn(`None of the ${num(recentCount)} ${plural(recentCount, 'lead', 'leads')} created in the last ${WINDOW_DAYS} days could be checked for a reply, so nothing is claimed about ${plural(recentCount, 'it', 'them')}.`)
            + untestedNote
          : muted(`No lead was created in the last ${WINDOW_DAYS} days, so there is nothing here to be waiting on`);

    /* ── Response time ──────────────────────────────────────────────────────
       The mean of one number is that number, and calling it an average was the
       single easiest way for this screen to lie back when the database held one
       lead. So the tile renames itself: with one measurement the label reads
       "Response time" and the subtitle says whose it is. The value is unchanged
       and correct either way — what changes is the claim made about it.

       The n=1 case is not today's case and the wording no longer implies it is.
       Live 1 Sep 2026: three leads, response_time_minutes 1, NULL and 4, so
       `withResp` is two and this tile reads "Avg response time" over two
       measurements with the THIN caveat under it. The NULL is the one to be
       careful about — `withResp` filters it out, which is the whole of what
       this screen does with it. A null response time means nobody measured
       that lead, NOT that nobody answered it. Lead 35 is the proof: its
       response_time_minutes is null, and the outbound WhatsApp message that
       answered it went at 06:40:38 on 26 Aug, 74 seconds BEFORE the lead row
       was written at 06:41:52 (both timestamps read live 1 Sep 2026). Nothing
       here treats a null as a breach, and nothing here should start — the
       view's own sla_breach branch does not either, since `response_time_minutes
       > 5` is null for that row and the comparison drops it. The reply-gap
       analysis two blocks up is what answers "was this lead answered", off
       communication_logs, and it does not read this column at all; on this
       particular lead it cannot answer it either, because that message is filed
       under a WhatsApp handle and the lead carries no email — which is exactly
       what the `outboundHandles` and `noEmail` counters below exist to say out
       loud rather than let it pass as an answered lead. */
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
    const noBudget = openCount - withBudget.length;
    const pipeSub = !withBudget.length
      ? muted(openCount
          ? `No open lead has a budget recorded, so there is no pipeline figure to report`
          : `No lead on file is still open, so there is no pipeline to report`)
        + (terminalCount
            ? `<br>${muted(`${num(terminalCount)} closed ${plural(terminalCount, 'lead is', 'leads are')} excluded: a won deal is money already taken and a lost one is money that was never there.`)}`
            : '')
      : muted(`Sum of the budget field on ${num(withBudget.length)} of ${num(openCount)} open ${plural(openCount, 'lead', 'leads')}`
              + (noBudget ? ` · ${num(noBudget)} with no budget recorded` : '')
              + (terminalCount ? ` · ${num(terminalCount)} closed ${plural(terminalCount, 'lead', 'leads')} excluded` : ''))
        + (withBudget.length <= THIN
            ? `<br>${warn(`This is ${num(withBudget.length)} ${plural(withBudget.length, 'budget field', 'budget fields')} added up, not a forecast.`)}`
            : '')
        /* No delta on this tile, and the reason is not that there is nothing to
           compare against. daily_metrics.pipeline_aed is written by
           capture_daily_metrics() as `coalesce(sum(budget_aed), 0)` over EVERY
           lead with a budget — no status filter, and zero where the answer is
           "none recorded". Those are precisely the two defects the headline
           above no longer has. Subtracting the two produces a number that moves
           when the cohort changes and not when the pipeline does, so the
           comparison is refused and the reason is printed instead of it. The
           response-time tile still carries its delta because the snapshot and
           the live figure there really are the same population. */
        + (prev
            ? `<br>${muted(`No comparison is drawn against ${snapshotWhen.replace(/^The/, 'the')}: its pipeline figure sums every lead with a budget, closed ones included, and records zero where none is recorded — a different figure from the one above, not an earlier value of it.`)}`
            : '');

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
      kpi('Open leads', num(openCount), leadsSub),
      /* The one number on this screen that maps to a person waiting. */
      kpi('Awaiting first reply', num(waiting.length), waitSub, waiting.length ? 't-hot' : ''),
      kpi(respLabel, mins(avgResp), respSub),
      kpi('Pipeline value', aed(pipeline), pipeSub),
      kpi('Units at risk', num(risk.length), riskSub, risk.length ? 't-hot' : ''),
    ].join('');

    const seg = [['HOT', hot, 'var(--hot)'], ['WARM', warm, 'var(--warm)'], ['COLD', cold, 'var(--cold)']];
    const graded = hot + warm + cold;
    /* "Everything that is not HOT, WARM or COLD has not been scored" was a
       false statement, and it was printed under the bar in plain words. The
       Slack Command Center writes CONTACTED, QUALIFIED, WON and LOST over the
       router's grade, and the BDC agent writes DISQUALIFIED, so a deal the
       dealership actually closed was being reported to the owner as a lead the
       router had never got round to. The two are counted apart here: a status
       the router does not write is not an absent one. */
    const otherStatus = leads.filter(l => {
      const st = up(l.status);
      return st && st !== 'HOT' && st !== 'WARM' && st !== 'COLD';
    });
    const otherNames = [...new Set(otherStatus.map(l => up(l.status)))].sort();
    const unscored = leads.length - graded - otherStatus.length;
    const stageRest = [
      otherStatus.length
        ? `${num(otherStatus.length)} ${plural(otherStatus.length, 'lead carries', 'leads carry')} a status the router does not write — ${otherNames.join(', ')} — so ${plural(otherStatus.length, 'it is', 'they are')} past the grading stage rather than missing from it.`
        : '',
      unscored > 0
        ? `${num(unscored)} ${plural(unscored, 'lead has', 'leads have')} no status on the row at all: the router has not scored ${plural(unscored, 'it', 'them')}.`
        : '',
    ].filter(Boolean);
    const stageRestHtml = stageRest.length
      ? `<div class="cell-sub" style="margin-top:6px">${stageRest.map(muted).join('<br>')}</div>`
      : '';
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
        ${stageRestHtml}`
      : graded
      ? `<div class="label-caps" style="margin-bottom:12px">Pipeline by stage</div>
        <div class="stackbar">${seg.map(([, v, c]) => `<i style="width:${(v / graded * 100).toFixed(1)}%;background:${c}"></i>`).join('')}</div>
        <div style="display:flex;gap:20px;margin-top:12px;flex-wrap:wrap">
          ${seg.map(([k, v, c]) => `<div style="display:flex;align-items:center;gap:8px">
            <span style="width:8px;height:8px;border-radius:50%;background:${c}"></span>
            <span style="font-weight:500">${esc(k)}</span><span class="t-muted num">${num(v)} ${plural(v, 'lead', 'leads')}</span></div>`).join('')}
        </div>
        ${stageRestHtml}
        ${graded <= THIN
          /* A full-width bar drawn from one row looks like a market share. It
             is one row, and the caption says so directly under it. */
          ? `<div class="cell-sub" style="margin-top:10px">${warn(`This bar is ${num(graded)} scored ${plural(graded, 'lead', 'leads')} in total. The proportions are shapes, not shares.`)}</div>`
          : ''}`
      : stateEmpty('Nothing to chart yet',
          leads.length
            ? `${leads.length === 1 ? 'The one lead on file is not' : `None of the ${leads.length} leads on file is`} HOT, WARM or COLD. The router writes that grade when it processes an enquiry, and the stage mix appears here once it has.`
              + (otherStatus.length
                  ? ` That is not the same as unprocessed: ${stageRest[0]}`
                  : '')
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
    sub: `Open leads created in the last ${WINDOW_DAYS} days with no outbound message in communication_logs sent after they arrived. Internal markers do not count as a reply, and closed leads are not listed`,
    actions: `<button class="btn sm" data-act="leads">Open Leads</button>`,
    load: async () => requireCore(),
    render: d => {
      const noPhone = d.waiting.filter(l => !str(l.phone)).length;
      const notes = [
        d.untestable
          ? `${num(d.untestable)} of the ${num(d.recentCount)} leads in this window could not be checked at all${d.noEmail ? ` — ${num(d.noEmail)} of them have no email address, and communication_logs keys on one` : ''}. They are neither listed above nor counted as answered.`
          : '',
        d.recentTerminal
          ? `${num(d.recentTerminal)} lead${d.recentTerminal === 1 ? '' : 's'} in this window ${plural(d.recentTerminal, 'is', 'are')} already closed — won, lost or disqualified — and ${plural(d.recentTerminal, 'is', 'are')} not listed as waiting for a reply.`
          : '',
        /* The markers exist because nobody replied, and they used to be read as
           proof that somebody had. Counted rather than silently dropped: two
           rows disappearing from a join is the kind of thing that should be
           visible on the screen that depends on it. */
        d.internalMarkers
          ? `${num(d.internalMarkers)} outbound row${d.internalMarkers === 1 ? '' : 's'} in this window ${plural(d.internalMarkers, 'is', 'are')} an internal marker rather than a message to a customer (channel 'system' or direction 'internal' — the silence detector writes one when a thread has gone quiet). ${plural(d.internalMarkers, 'It is', 'They are')} not counted as a reply.`
          : '',
        /* The join this panel rests on is lead.email = communication_logs.lead_email,
           and that column holds a WhatsApp handle whenever the message was sent
           to a thread with no identified lead behind it. Those messages cannot
           match any lead row, so the join is provably incomplete and says by how
           much rather than presenting itself as exact. */
        d.outboundHandles
          ? `${num(d.outboundHandles)} of the ${num(d.outboundCount)} outbound messages read in this window are filed under a WhatsApp handle rather than an email address, because communication_logs.lead_email holds whichever the thread had at the time. They cannot be matched to any lead, so a lead answered on WhatsApp before it was identified would still be listed above as unanswered.`
          : '',
        d.outboundCapped ? `Outbound history was capped at ${num(OUTBOUND_LIMIT)} messages for this window, so this list may be incomplete.` : '',
        d.testedCount && d.testedCount <= THIN ? `Only ${num(d.testedCount)} ${plural(d.testedCount, 'lead', 'leads')} in this window could be checked, so an empty list here is a very small sample.` : '',
        noPhone ? `${num(noPhone)} of these ${plural(noPhone, 'lead has', 'leads have')} no phone number on the lead record, so ${plural(noPhone, 'it', 'they')} can only be answered by email.` : '',
        d.waiting.length ? NO_STAFF_PHONE : '',
      ].filter(Boolean);
      const foot = notes.length
        ? `<div class="list-item" style="cursor:default"><span class="material-symbols-outlined t-muted" style="font-size:18px">info</span>
             <div class="cell-sub" style="white-space:normal">${notes.map(esc).join('<br>')}</div></div>`
        : '';
      if (!d.waiting.length) {
        /* The headline names the cohort it is about. "Every lead has been
           answered" over a set that excluded the untested ones is the same
           overclaim the KPI strip was making, one panel down. */
        return stateEmpty(
          d.testedCount ? 'Every lead we could check has been answered'
            : d.recentCount ? 'No lead in this window could be checked'
              : 'No leads in this window',
          d.testedCount
            ? `All ${d.testedCount} open ${plural(d.testedCount, 'lead', 'leads')} created in the last ${WINDOW_DAYS} days that could be checked ${plural(d.testedCount, 'has', 'have')} an outbound message against ${plural(d.testedCount, 'its', 'their')} address, sent after ${plural(d.testedCount, 'it', 'they')} arrived.`
            : d.recentCount
              ? `${d.recentCount} ${plural(d.recentCount, 'lead was', 'leads were')} created in the last ${WINDOW_DAYS} days and none of them could be matched to communication_logs, so this list is empty for want of evidence rather than because everyone was answered.`
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

  /* 2 · Workflows that are not delivering inside the health window. Everything
     here is read off v_workflow_health, which computes it over 30 days from
     public.nexus_outcome_class() — all-time `failures` would keep a long-fixed
     workflow red forever, and `status = 'FAILED'` alone would keep a workflow
     that runs cleanly and produces nothing off the card entirely. */
  panels.push(panel(flowHost, {
    title: 'Workflows degraded',
    sub: 'Any workflow that failed, went out half-done or produced nothing usable in the last 30 days, and whether it has succeeded since',
    actions: `<button class="btn sm" data-act="automation">Open Automation</button>`,
    load: () => readHealth(),
    render: rows => {
      if (!rows.length) {
        return stateEmpty('No workflow is degraded',
          'Nothing failed, went out half-done or produced nothing usable in the last 30 days. Workflows that do not write to the audit log cannot report health at all — Automation lists those separately.', 'task_alt');
      }
      /* Ordered so the ones still broken sit above the ones that recovered.
         The read is sorted by failure count, which put a workflow that failed
         five times this morning and has run clean all afternoon above a
         workflow that is failing right now — the wrong way round for a triage
         card. State first, then size.

         Size is `notClean`, the number the row actually prints, not
         `failures_30d` which the read ordered on. They can be far apart:
         Competitor Price Scraping has zero failures and zero half-done runs, so
         the read puts it last, and 94 of its 108 runs produced nothing (live
         1 Sep 2026, 14:18 UTC) — the largest miss on the card. Sorting on the
         displayed number is also the only ordering an operator can check
         against what is in front of them. */
      const state = new Map(rows.map(w => [w, failureState(w)]));
      const ORDER = { failing: 0, stale: 1, unknown: 2, recovered: 3 };
      const size = w => { const n = runCounts(w).notClean; return n == null ? -1 : n; };
      const sorted = [...rows].sort((a, b) => ORDER[state.get(a).key] - ORDER[state.get(b).key]
        || size(b) - size(a));
      const recovered = rows.filter(w => state.get(w).key === 'recovered').length;
      const stale = rows.filter(w => state.get(w).key === 'stale').length;
      const notes = [
        recovered ? RECOVERY_CAVEAT : '',
        stale ? STALE_CAVEAT : '',
        `A row here means a run failed, went out half-done or produced nothing usable inside the 30-day window that v_workflow_health.health is computed over. All-time failures are not used: they would keep a workflow that was fixed in June red forever. What each status means is decided in one place — public.nexus_outcome_class(), mirrored in lib/health.js — and never on this screen.`,
        /* Stated as a rule, not as tonight's example. An earlier draft of this
           note named a workflow and quoted its live figures in words; a
           hardcoded number in a footnote is the "-18s vs last week" this file
           already threw out once, and it is wrong by morning. The per-row
           counts beside each name carry the specifics. */
        `The count on the right is runs that did not succeed outright, not runs labelled FAILED. A workflow can be degraded with none labelled FAILED at all — a run that goes out half-done or returns nothing usable is neither a crash nor a delivery.`,
      ].filter(Boolean);
      return `<div>${sorted.map(w => {
        /* runCounts, shared with the Needs-attention enrichment so the same
           workflow cannot be rated on two different denominators three panels
           apart. `notClean` is every qualifying run that was not an outright
           success: a failure, a half-done run, a run that produced nothing, or
           a status this system does not recognise. */
        const { eff, succ, notClean } = runCounts(w);
        const rate = successRate(w.successes_30d, w.effective_runs_30d);
        const parts = n0(w.partials_30d), nores = n0(w.no_result_30d);
        const rej = n0(w.rejected_30d), esc30 = n0(w.escalated_30d), unk = n0(w.unknown_30d);
        /* "3 of 3 runs failed" and "124 of 202 runs failed" are different
           claims. A workflow that has barely run in the window is marked as
           such rather than being ranked on a rate nobody can trust. */
        const scarce = eff != null && eff <= THIN;
        const st = state.get(w);
        const hw = healthWords(w.health);
        /* A workflow that has succeeded since its last bad run is not an
           emergency at midnight, and the icon has to agree with the sentence
           three words to its right or the row is shouting and whispering at
           once. Amber is its own state and is not allowed to borrow either the
           red or the grey. The health pill is left exactly as the view computed
           it — that is the view's judgement and this panel does not overrule
           it, only spells it out. */
        const ICONS = {
          failing:   { name: 'error',   cls: 't-hot' },
          stale:     { name: 'history', cls: 't-warm' },
          recovered: { name: 'history', cls: 't-muted' },
          unknown:   { name: 'help',    cls: 't-muted' },
        };
        const icon = ICONS[st.key] || ICONS.unknown;
        const NUM_CLS = { failing: 't-hot', stale: 't-warm', recovered: 't-muted', unknown: 't-muted' };
        const outcomes = eff == null || eff <= 0
          ? muted('No run in this window counted toward a rate: every one of them was refused by design or handed to a person on purpose.')
          : muted(`${num(succ)} of ${num(eff)} qualifying ${plural(eff, 'run', 'runs')} succeeded outright (${pct(rate)})`
              + (parts ? ` · ${num(parts)} went out half-done` : '')
              + (nores ? ` · ${num(nores)} produced nothing usable` : '')
              + (unk ? ` · ${num(unk)} carry a status this system does not define` : '')
              + (rej ? ` · ${num(rej)} refused by design, not counted` : '')
              + (esc30 ? ` · ${num(esc30)} escalated to a person, not counted` : ''));
        return `<div class="list-item" role="button" tabindex="0" data-goto="automation"
             title="Open Automation, where this workflow's runs and failures are" style="align-items:flex-start">
          <span class="material-symbols-outlined ${icon.cls}" style="font-size:20px">${icon.name}</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-weight:500">${esc(w.name)}</span>
              <span title="${esc(hw.blurb)}">${pill(hw.label, hw.tone)}</span>
              ${w.is_active === false ? pill('Inactive', 'cold') : ''}
            </div>
            <div class="cell-sub">${esc(w.category || 'Uncategorised')}${w.last_incomplete ? ' · last bad run ' + esc(ago(w.last_incomplete)) : ''}${
              scarce ? ' · <span class="t-warm">too few runs in 30 days to rate</span>' : ''}</div>
            <div class="cell-sub">${st.text}</div>
            <div class="cell-sub">${outcomes}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="num ${NUM_CLS[st.key] || 't-muted'}" style="font-weight:500"
                 title="Runs in the last 30 days that did not succeed outright: failures, half-done runs, runs that produced nothing usable, and any status this system does not define. Runs refused by design and runs escalated to a person are excluded from both halves.">${num(notClean)}</div>
            <div class="cell-sub">${eff == null ? 'did not succeed' : `of ${num(eff)} that counted`}</div>
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
  /* What `at` means, branch by branch, taken from the view's own definition:

       unanswered_chat   v.last_message_at   when the customer wrote
       lead_unassigned   l.created_at        when the lead arrived
       sla_breach        l.created_at        when the lead arrived
       kyc_archive_gap   k.created_at        when the document was taken
       workflow_failure  max(logged_at)      when it last did not deliver
       undercut          c.scraped_at        when the price was last seen
       inventory_aging   now()               the moment the query ran

     Re-read off the view on 1 Sep 2026, and the workflow_failure row had gone
     stale: that max(logged_at) is taken over runs the outcome rule classes
     FAILURE **or** PARTIAL, so it is not "when it last failed". Live the same
     day, Customer 360 - Data Aggregation carried that item with an `at` equal
     to its last_partial and no failure since 23 Aug — the word "failed" under
     it was flatly wrong about the run it was pointing at. The verb below says
     "last did not deliver", which is what the view's own detail string says.

     Only the first four are a waiting time. `undercut` is an observation time —
     the gap is as old as the price, not as old as the scrape — and
     `inventory_aging` is not a time about the item at all: the view stamps it
     with now(), so every aging unit reads as having arrived this second and
     they all tie with each other in the secondary sort below. For that kind the
     age is in the view's own `detail` string ("148 days in stock"), which is
     the figure to read, so nothing is printed here rather than a number that
     contradicts the sentence beside it. */
  const AT_WORDS = {
    unanswered_chat:  { verb: 'waiting' },
    lead_unassigned:  { verb: 'waiting' },
    sla_breach:       { verb: 'waiting' },
    kyc_archive_gap:  { verb: 'waiting' },
    workflow_failure: { verb: 'last did not deliver' },
    undercut:         { verb: 'price last seen' },
    inventory_aging:  { none: true, blank: 'the view timestamps this kind with the moment the query ran, not a waiting time — the age is in the detail above' },
    _default:         { verb: 'recorded' },
  };
  /* Severity alone put four parked cars above a person who had already written
     in. A customer waiting on a reply decays in hours; a HOT lead with no owner
     in minutes-to-hours; a car aging on the lot over weeks. */
  const RANK = { unanswered_chat: 0, lead_unassigned: 1, sla_breach: 2, kyc_archive_gap: 3,
                 workflow_failure: 4, undercut: 5, inventory_aging: 6 };

  panels.push(panel(attnHost, {
    title: 'Needs attention',
    /* Not "Live". This panel reads once, when the screen opens, and nothing on
       this screen re-renders on a timer — the only poller in the app is
       lib/badges.js, and it repaints nav badges, not panels. A dashboard left
       open on the showroom floor was showing a list from whenever the tab was
       opened under a word that says otherwise. The word is gone and the read
       time is printed in the notes, where it can be checked. */
    sub: `Union of v_needs_attention — unanswered WhatsApp threads first, then unassigned HOT leads, SLA breaches, KYC archive gaps, workflow failures, undercuts and aging stock. The view bounds two of these itself: unanswered threads to ${CHAT_WINDOW_DAYS} days and SLA breaches to ${SLA_WINDOW_DAYS}, so this is what is still open, not everything that ever slipped`,
    load: async () => {
      const readAt = new Date().toISOString();
      const { items, threads } = await readAttention();
      const sorted = [...items].sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9)
        || new Date(b.at) - new Date(a.at));
      const { rows: distinct, collapsed } = collapseSnapshots(sorted);
      /* Soft: a failed KYC read must not take this panel down with it, but it
         does change what the badge can honestly claim, so it is reported. */
      const gapRows = await readKycGaps().catch(() => null);
      /* Both soft for the same reason: they add a sentence to a row or explain
         an absence. Neither is allowed to blank the list of things that need a
         human, which is the one thing this panel exists to show. */
      const health = await readHealth().catch(() => null);
      const rivals = await readRivals().catch(() => null);
      return { items: sorted, distinct, collapsed, threads, gapRows, health, rivals, readAt };
    },
    render: ({ items, distinct, collapsed, threads, gapRows, health, rivals, readAt }) => {
      /* `need.items` is every row the view returned, uncollapsed, because
         sharedFloor() and ownFloor() do their own collapsing and have to be
         handed the raw rows to do it on.

         What this note used to say — that the floor is counted over the raw
         rows and that "badges.js reads the same view without the collapse" —
         was wrong on both halves, and it contradicted the two functions
         directly above it. Read live on 1 Sep 2026: badges.js calls
         collapseAttention() BEFORE its severity filter and paints every badge,
         Overview's grand total included, from the collapsed list; and
         ownFloor() here collapses too. That is the point — the floor has to be
         measured on the same footing as the number it is protecting, or
         Math.max() re-inflates exactly what the panel just collapsed. The two
         cannot drift: badges.js exports SNAPSHOT_KINDS and collapseAttention
         for this file to share. */
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

      const body = distinct.map(it => {
        const target = SCREENS[it.screen] ? it.screen : (KIND_SCREEN[it.kind] || 'overview');
        const flow = healthFor(it);
        const flowState = flow ? failureState(flow) : null;
        if (it.kind === 'workflow_failure') {
          if (!flow) unmatchedFlows += 1;
          else if (flowState.key === 'recovered') recoveredFlows += 1;
        }
        /* A workflow whose newest run is a success is still on the list — the
           view raised it and this screen does not overrule the view — but it is
           not screaming. The clock icon says the row is about something that
           happened, not something happening. Only `recovered` earns it: a
           `stale` workflow has run since and that run was not a success, which
           is not a thing that has stopped. */
        const icon = flowState && flowState.key === 'recovered'
          ? 'history'
          : (KIND_ICON[it.kind] || 'warning');
        /* `at` is a real column on the view, but it is not one thing, and this
           line used to read it as though it were. Every branch was rendered as
           "waiting <ago(at)>", and NX-1010 — a Range Rover on the lot since
           April — printed "waiting just now" beside its own detail string
           reading "148 days in stock". AT_WORDS is read straight off the view's
           branches rather than guessed; a kind this file does not know about
           gets the neutral wording and claims nothing. */
        const meaning = AT_WORDS[it.kind] || AT_WORDS._default;
        const waited = meaning.none
          ? `<span class="t-muted">${esc(meaning.blank)}</span>`
          : it.at
            ? `<span class="t-muted">${esc(meaning.verb)} ${esc(ago(it.at))}</span>`
            : '<span class="t-muted">no timestamp on this item, so when it arrived is unknown</span>';
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
          const fc = flow ? runCounts(flow) : null;
          sub = `${esc(it.detail)} · ${waited}<div class="cell-sub">${
            flowState ? flowState.text
              : '<span class="t-muted">no row in v_workflow_health matched this item, so whether it has succeeded since cannot be told from here</span>'
          }${fc && fc.notClean != null
            ? ` <span class="t-muted">· ${esc(num(fc.notClean))} of ${esc(num(fc.eff))} ${plural(fc.eff, 'run', 'runs')} in 30 days that counted did not succeed outright</span>`
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
           workflow's newest run is a success — a red glyph beside "its newest
           run is a success" is the screen arguing with itself, and the operator
           believes the colour. The severity pill is untouched: that is the
           view's rating and it stays visible. */
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
      const coldItems = distinct.filter(i => !BADGE_SEVERITIES.has(str(i.severity).toUpperCase())).length;
      const unscreened = distinct.filter(i => !str(i.screen)).length;

      const notes = [
        /* First, because it governs how everything under it should be read. */
        `Read once at ${clock(readAt)}, when this screen opened. Nothing on this screen refreshes on a timer, so an item resolved since then is still listed and one raised since then is not — reopen Overview for a fresh read. The nav badges are the part that does poll, every 60 seconds.`,
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
        `This panel lists ${num(distinct.length)} distinct ${plural(distinct.length, 'item', 'items')}${
          coldItems ? `, including ${num(coldItems)} not marked HOT or WARM` : ''}${
          unscreened ? ` and ${num(unscreened)} the view attributes to no screen` : ''}.`,
        /* Says what was collapsed and why the sidebar still agrees. This
           sentence used to end "the nav badge — painted by badges.js from the
           same view without this collapse — counts those repeats and reads
           higher than the list", which was false about badges.js: it collapses
           with the same exported rule before it counts (read live 1 Sep 2026).
           A note that tells an operator to expect two numbers to disagree, when
           they are computed identically, teaches them to distrust a badge that
           is right. */
        collapsed
          ? `The view returned ${num(items.length)} rows to get there: ${num(collapsed)} of them ${plural(collapsed, 'is a repeat', 'are repeats')} of a price undercut already listed, one row per nightly scrape of the same vehicle at the same price, and ${plural(collapsed, 'it is', 'they are')} shown once. The nav badge does not double-count ${plural(collapsed, 'it', 'them')}: badges.js collapses the same way before it counts. As of 1 Sep 2026 v_needs_attention de-duplicates its undercut branch itself, so anything collapsing here means that has regressed and the raw table is being read unguarded again.`
          : '',
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
    /* Called a "Live lead feed" until 1 Sep 2026, and it was neither live nor a
       feed: one read when the screen opens, no timer anywhere on this screen to
       repaint it, and the word "Live" sitting over a table that had not moved
       since the tab was opened. A new enquiry does NOT appear here the moment
       the router receives it, which is exactly what an owner watching this
       panel would assume it meant. The name now says what it is and the read
       time is printed under the table. */
    title: 'Latest leads',
    sub: 'Newest first — a snapshot, read once when this screen opened',
    actions: `<button class="btn sm" data-act="leads">View all</button>`,
    /* `phone` is on the lead row, so the newest enquiry can be rung from the
       first screen an owner opens. `ai_score` is the router's score — there is
       no `lead_score` column on this table, whatever older code called it. */
    load: async () => ({
      readAt: new Date().toISOString(),
      rows: await db(`leads?select=id,name,phone,status,ai_score,vehicle_interest,source,created_at&order=created_at.desc&limit=${FEED_LIMIT}`),
    }),
    /* `card` is handed the rows so they can be wired to the drawer once this
       HTML is actually in the document — render() runs before it is. */
    render: ({ rows, readAt }, card) => {
      card.__rows = rows;
      if (!rows.length) {
        return stateEmpty('No leads yet',
          `Nothing in the leads table as of ${clock(readAt)}, when this panel read it. New enquiries appear here on the next read, not as they arrive — reopen Overview to check.`);
      }
      /* Fewer rows than the page size means this is not the top of a long list,
         it is the whole list — which reads very differently. */
      const notes = [
        `Read once at ${clock(readAt)}, when this screen opened. This table does not update on its own — a lead that arrived since is not on it. Reopen Overview for a fresh read.`,
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
