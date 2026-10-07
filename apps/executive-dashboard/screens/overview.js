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

   Identity, 1 Sep 2026. Three places in this file decided that a database row
   belonged to a person, and all three did it with a private rule of their own:
   the reply-gap analysis on `lower(leads.email) === lower(lead_email)`, the
   Needs-attention lead lookup on the same, and the KYC contact count on
   `lower(kyc_documents.lead_email)`. All three now go through lib/identity.js,
   which applies the last-nine-digit rule the n8n `Resolve Lead Identity` node
   used to WRITE these keys and bridges a `@lid` through whatsapp_contacts.
   `communication_logs.lead_email` is not an email column — it holds four
   incompatible key shapes for one person — and reading it as one is what let
   this screen attach 8 of 19 replies while its own disclosure sentence claimed
   it had missed only 5. The measurements are in the notes at each site.

   ── 2 Sep 2026 · Revenue Command Center ────────────────────────────────────

   PRODUCT.md gives this screen one commercial job — "where is this dealership
   losing money today, and what should I do about it?" in under thirty seconds —
   and until tonight it answered a different question: how much activity was
   there. Activity is not leakage. The leak panel added below is the answer, and
   three rules shaped every line of it.

   1. THE SENTINEL OWNS INVENTORY ECONOMICS AND THIS SCREEN NOW READS IT.
      Overview used to select `inventory.holding_cost_accrued` and
      `inventory.aging_alert` straight off the table — a second source for two
      figures `public.v_inventory_profit_sentinel` computes and states the
      provenance of. That is the "one figure, one derivation" rule in
      NEXUS_INVARIANTS.md broken in the open, and it is what let this screen sum
      a NULL column with `|| 0` and print "AED 0 holding cost" across twelve
      cars. The inventory read is now `rpc/sentinel_inventory_actions()`, the
      same worst-first read path screens/inventory.js and screens/actions.js
      use, and nothing here re-derives ageing, margin or holding cost. The
      `inventory` table is not read by this file at all any more.

   2. AN AGGREGATE OVER AN UNKNOWN MUST SAY WHAT IT COULD NOT INCLUDE.
      Every money figure on the leak panel goes through `expose()`, which
      returns the total, the rows that carried a figure, and the rows that did
      not — and returns null rather than zero when none did. It also refuses to
      total across two different `impact_kind` values, because "margin exposed"
      and any future kind are not the same currency of claim and adding them
      would produce a number nothing in the database holds.

   3. ESTIMATED, ATTRIBUTED AND CONFIRMED ARE THREE DIFFERENT WORDS.
      `impact_aed` / `engine_impact_aed` are EXPOSURE in the engine's own sense:
      gross margin (list minus acquisition cost) sitting in a unit that has not
      sold. The panel says "exposed" and never loss, revenue, saved or
      recovered. `recovered_value_aed` is null on every action on this box and
      renders as "not recorded", never as AED 0 — the column comment is explicit
      that a missing outcome is a state with a reason, not a zero. And the word
      ATTRIBUTED is earned on this screen rather than assumed: a figure is only
      counted where the row also carries outcome_state ATTRIBUTED, a linked
      purchase_history row, an attribution basis and a value basis, which is the
      four-column rule the database itself enforces. A row with the amount and
      not the evidence is reported as a fault and its amount is withheld.

   What the data actually looked like when this was written, read live at
   18:45 UTC on 2 Sep 2026 — recorded as a dated observation, exactly like the
   bullets above, and NOT encoded anywhere in the code below:

     · 12 units. overall_risk 1 SEVERE / 2 HIGH / 9 LOW; aging_band 1 CRITICAL /
       2 WARNING / 9 HEALTHY; recommendation 3 REPRICE / 9 HOLD. AED 82,000 of
       gross margin exposed across the three, all three carrying an impact
       figure, none omitted.
     · holding_cost_state NOT_COMPUTABLE on all 12 — no sourced holding rate on
       record — so net margin is withheld on all 12 too. market_position UNKNOWN
       on 12 of 12; demand_signal UNKNOWN_LOW_COVERAGE on 12 of 12 (86 enquiry
       rows in the window, 2 of which resolve to a unit, against a floor of 50).
     · 3 action records: one APPROVED and not carried out, one PROPOSED and
       waiting, one REJECTED with a reason. None escalated, none executed,
       recovered_value_aed null on all three.
     · 3 lead rows: 1 open (WARM, unassigned) and 2 closed DISQUALIFIED.
     · 9 WhatsApp threads awaiting a reply, 7 of them inside the view's 7-day
       window, and `identified` is `whatsapp_profile` on all nine — not one has
       a lead record behind it.

   THE NUMBER THIS SCREEN DELIBERATELY DOES NOT PRINT is "3 leads". It is
   arithmetically true and commercially false: two of the three are wrong
   numbers the WhatsApp router auto-created from uncaptioned images, and the
   rows themselves carry that diagnosis in `vehicle_interest`. A tile reading 3
   invites an owner — or a buyer being shown this screen — to read lead flow
   into a table that has one open enquiry in it. So the leak panel counts OPEN
   enquiries, names the closed ones and the reason they are closed, and says in
   words that one enquiry is a record and not a rate. The same refusal applies
   to the nine waiting threads: nine is the honest count of threads, and "nine
   customers are waiting" is not a claim this database supports, because not one
   of them resolves to a lead.

   Everything below is a number Postgres produced. Nothing is estimated, and
   where a figure rests on a handful of rows the screen says how few — a single
   test record must not read as a trend. */
/* COUNTS, not a copy of it. badges.js exports the severity set precisely so
   this file cannot drift from it — see the note at the foot of badges.js. */
/* The recovered-value evidence test is imported, never re-implemented. It is
   the one derivation for the only money in this product that claims to be
   real, and screens/actions.js owns it. */
import { recoveryEvidence, unsupportedRecoverySentence } from './actions.js';
import { COUNTS as BADGE_SEVERITIES, LAST as BADGE_SNAPSHOT } from '../lib/badges.js';
/* What counts as a reply. This screen used to decide it here — channel in
   {system, internal} OR direction === 'internal', with the message body never
   read at all — which is the mirror image of the copy screens/campaigns.js
   carried: that one tested only the text, this one tested everything but. A
   marker body written on channel 'whatsapp' passed this test as a real message
   to a customer and was counted as somebody having answered the lead.
   lib/comm-events.js is a line-for-line mirror of
   `public.nexus_is_message(direction, channel, message)`, which tests all
   three. */
import { isInternalRow, isReply } from '../lib/comm-events.js';
import { ME, db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { UNKNOWN_WHY, aed, ago, clock, dubaiStamp, esc, mins, n0, num, pct, tone } from '../lib/format.js';
import { displayName, maskText } from '../lib/privacy.js';
/* ── The Google Stitch designs, 7 Oct 2026 ──────────────────────────────────
   design/stitch/overview-revenue-command-center--af6246.html is the visual
   reference; --99a45c (where money is leaking, revenue recovery, no reply sent,
   KYC archive gaps, needs attention, latest leads, pipeline by stage) and
   --74e5c2 (the KPI row, today's leaks, the audit feed) contribute sections.
   This replaced the 27 Sep design-system pass (lib/design-system.js) and, like
   that pass, it changed HOW the panels paint and nothing about what they read,
   count or refuse to say: every read, every derivation and every caveat below
   is the one that was here. The design-system helpers this file used —
   dsChip, dsStat, dsTable, dsEmpty and lib/ui.js's panel() — are re-declared
   just below with the same signatures and Stitch markup, so not one call site
   changed its arguments. A long caveat may be DEMOTED behind a <details> (in
   the DOM open or closed); it may not be deleted. */
/* The only place in this app allowed to decide what a run outcome means. This
   screen reads the columns v_workflow_health already computed from the same
   rule and does not classify anything itself. */
import { healthWords, successRate } from '../lib/health.js';
/* The shared identity resolver, and the only rule this screen is allowed to use
   to decide that a communication_logs row belongs to a lead. Until 1 Sep 2026
   this file matched `lower(leads.email) === lower(lead_email)` and nothing else
   — see the note above the reply analysis in the core read for what that cost
   and what it was measured at. */
import { expandIdentity, isHandle, normalizeKey } from '../lib/identity.js';
import { leadDrawer } from '../lib/lead-drawer.js';
import { SCREENS, flatNav, go } from '../lib/nav.js';
/* Open pipeline, defined once. TERMINAL_TONES/isOpenLead and the read ceiling
   used to be declared here AND verbatim in screens/team.js with a different
   LEAD_LIMIT (2000 here, 1000 there), so the same rule could report two totals.
   See the header of lib/pipeline.js for what the database's own pipeline_aed
   is. As of 2 Sep 2026 it is on the same open-lead rule as these figures and no
   longer answers a different question; it is still never substituted for them,
   because these are the ones this screen can attribute row by row and disclose a
   truncation on. */
import { CAP_NOTE, LEAD_LIMIT, isOpenLead, openPipeline } from '../lib/pipeline.js';
import { BTN, comingSoonPanel, errorState, moneyTile, skeleton, trustFooter } from '../lib/stitch-ui.js';

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
/* LEAD_LIMIT now lives in lib/pipeline.js and is imported above: it is 2000 —
   unchanged for this screen — and screens/team.js, which used to read 1000, now
   reads the same number so that "open pipeline" cannot mean two windows. */
/* whatsapp_contacts is the ONLY thing that can attach a `@lid`-keyed message to
   a lead: a LID's digits are a machine id, not a phone number, so the handle can
   never be derived from what the lead row holds and can only be looked up. The
   table is a directory with one row per chat — 11 rows live on 1 Sep 2026 — so
   this ceiling is a guard, not a window. Same value as screens/leads.js:152,
   deliberately, so the two screens cannot read different slices of it. */
const CONTACT_LIMIT = 2000;
/* The Inventory Profit Sentinel, read through the function rather than the view
   — the same call screens/inventory.js and screens/actions.js make, for the same
   reasons its header gives: the function orders worst-first and it holds the
   "unknown is not low" rule that a client-side filter would quietly drop.
   `authenticated` holds EXECUTE on it and `anon` does not (checked live 2 Sep
   2026), and it is STABLE, which is what makes it reachable over the GET that
   lib/data.js db() speaks.

   No `select` is passed. inventory.js does not pass one either, and matching it
   exactly matters more here than trimming a twelve-row payload: two spellings of
   the same read are two things that can drift. */
const SENTINEL_RPC = 'rpc/sentinel_inventory_actions';
const QUEUE_LIMIT = 200;
/* Every column the leak panel reads off v_inventory_action_queue, named rather
   than `*`. screens/actions.js selects `*` because it renders the whole record;
   this screen reads a summary and a named list is the only form in which a
   stale column shows up as a 42703 at the gate instead of as `undefined` on a
   card. All 27 were confirmed against the live catalogue on 2 Sep 2026.

   Three more added 3 Sep 2026 — outcome_purchase_id, attribution_basis and
   recovered_value_basis — and they are not decoration. They are the other
   three quarters of the evidence that makes `recovered_value_aed` sayable at
   all (see recoveryEvidence() in screens/actions.js). Without them selected
   this screen could only ever test one column while asserting four, which is
   the defect this list is being widened to close. Confirmed present on
   v_inventory_action_queue against the live catalogue on 3 Sep 2026. */
const QUEUE_COLS = ['id', 'unit_id', 'unit_model', 'status', 'is_live', 'awaiting_decision',
  'deferral_now_due', 'recommendation', 'engine_impact_aed', 'engine_impact_kind',
  'engine_days_in_stock', 'engine_still_agrees', 'engine_now_recommendation',
  'proposed_at', 'decided_at', 'decided_by_name', 'decision_reason_label',
  'escalated_at', 'escalation_reason', 'executed_at', 'assigned_role', 'assigned_to_name',
  'outcome_state', 'outcome_purchase_id', 'attribution_basis', 'recovered_value_basis',
  'recovered_value_aed', 'outcome_sentence', 'cost_of_doing_nothing',
  'days_open'].join(',');
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
const warn = msg => `<span class="text-[#96570A]">${esc(msg)}</span>`;
const muted = msg => `<span class="text-outline">${esc(msg)}</span>`;
/* A chip for a raw database value whose colour is DERIVED rather than given —
   the design-system equivalent of calling lib/format.js's pill() with no
   explicit tone. `verbatim` is the caller's claim, never a guess: true says
   this exact word came off the row, so a tone this table has no word for
   explains why in the chip's own tooltip (dsChip's `title`) rather than
   silently pretending the app recognises it — the same UNKNOWN_WHY sentence
   pill() attaches under the same condition (see lib/format.js). */
const rawChip = (label, verbatim) => {
  const i = dsIntent(tone(label));
  return dsChip(label, i, { verbatim: !!verbatim, title: i === 'unknown' && verbatim ? UNKNOWN_WHY : '' });
};

/* Why the reply-gap check was withheld, in the operator's words. Said the same
   way in the KPI subtitle and in the panel below it, so the two cannot describe
   the same outage differently. A capped read is reported as a failed one on
   purpose: it means some chat-to-lead bridges are missing and nothing on this
   screen can say which. */
const bridgeWhy = (err, capped) => (err
  ? `The saved contact details could not be read (${err.message}), and that table is the only thing that can attach a @lid-keyed message to a lead — a LID carries no phone digits, so the handle can only be looked up, never derived.`
  : capped
    ? `The saved contact details read hit its ${CONTACT_LIMIT}-row ceiling, so some chat-to-lead bridges are missing and there is no way to tell from here which leads are affected.`
    : '');

/* `isHandle` is imported from lib/identity.js above rather than restated here.
   It used to be a private copy of the same regex, and a private copy is how the
   disclosure sentence in the reply-gap panel came to be wrong: identity.js's
   handle set is the four WAHA address shapes, and `+<digits>@whatsapp.lead` —
   the key the workflows synthesise from a phone number — is not one of them.
   Reading that as "everything this screen cannot match" was the error. What the
   screen cannot match is now measured directly rather than inferred from a key
   shape; this predicate is left for what it is actually for, which is refusing
   to print a machine handle where a person's name goes.
   A LID contains no phone digits at all, so it identifies nobody. */
const str = v => String(v == null ? '' : v).trim();

/* ══════════════════════════════════════════════════════════════════════════
   The Stitch component layer for this screen
   ══════════════════════════════════════════════════════════════════════════
   Same names and signatures as the lib/design-system.js helpers they replace,
   so the panels below are untouched; Stitch markup out. Every variant is a
   COMPLETE class string picked from a map (scripts/stitch-classes.mjs fails the
   build on a class glued to an interpolation). */
const TONE_TO_INTENT = { hot: 'danger', warm: 'warning', cold: 'info', ok: 'success', unknown: 'unknown', won: 'success', dead: 'neutral', open: 'info', '': 'neutral' };
const dsIntent = t => TONE_TO_INTENT[String(t || '').toLowerCase()] || 'neutral';
/* Text colour per intent, for an icon or a figure that must agree with the chip
   beside it. `tertiary` is the quiet grey a recovered row is allowed. */
const TXT = { danger: 'text-error', warning: 'text-[#96570A]', info: 'text-[#2563A8]', success: 'text-[#157A5B]', neutral: 'text-secondary', unknown: 'text-outline', tertiary: 'text-outline' };
const CHIP_CLS = {
  danger:  'inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-numeric-sm text-[10px] font-bold uppercase tracking-wider w-fit bg-[#FDECEA] text-[#C8321F]',
  warning: 'inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-numeric-sm text-[10px] font-bold uppercase tracking-wider w-fit bg-[#FEF3E2] text-[#96570A]',
  info:    'inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-numeric-sm text-[10px] font-bold uppercase tracking-wider w-fit bg-[#E8F1FB] text-[#2563A8]',
  success: 'inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-numeric-sm text-[10px] font-bold uppercase tracking-wider w-fit bg-[#E6F4EF] text-[#157A5B]',
  neutral: 'inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-numeric-sm text-[10px] font-bold uppercase tracking-wider w-fit bg-surface-container-high text-on-surface-variant',
  unknown: 'inline-flex items-center gap-1 px-2 py-0.5 rounded font-label-numeric-sm text-[10px] font-bold uppercase tracking-wider w-fit border border-dashed border-outline text-outline',
};
/* `title` is kept as an attribute ONLY where the old chip carried one, and it
   never holds the only copy of a caveat: every such sentence is also in a
   panel note. */
const dsChip = (label, intent = 'neutral', { title = '' } = {}) =>
  `<span class="${CHIP_CLS[intent] || CHIP_CLS.neutral}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</span>`;
/* The demotion affordance: in the DOM open or closed, never a tooltip. */
const note = (body, label = 'More') => (body
  ? `<details class="mt-1"><summary class="cursor-pointer list-none inline-flex items-center gap-0.5 font-body-sm text-[11px] text-primary font-medium underline">${esc(label)}<span class="material-symbols-outlined text-xs">expand_more</span></summary>`
    + `<div class="mt-1.5 font-body-sm text-[12px] text-on-surface-variant leading-relaxed space-y-1">${body}</div></details>`
  : '');
/* KPI tile — states-components §3 / overview--af6246's KPI row. `meta` is the
   old tile's sub-line HTML: its first line stays on the surface and the rest
   is demoted, never dropped. */
const STAT_VAL = {
  danger:  'font-label-numeric-lg text-[1.75rem] leading-none font-bold text-error tracking-tight',
  warning: 'font-label-numeric-lg text-[1.75rem] leading-none font-bold text-[#96570A] tracking-tight',
  '':      'font-label-numeric-lg text-[1.75rem] leading-none font-bold text-on-surface tracking-tight',
};
const dsStat = ({ label, value, valueHtml, meta = '', intent = '' }) => {
  const painted = valueHtml != null ? valueHtml : esc(String(value == null ? '—' : value));
  const parts = String(meta || '').split('<br>');
  return `<div class="bg-surface-container-lowest p-space-md rounded-xl border border-outline-variant/40 shadow-sm flex flex-col gap-space-sm min-w-0">
    <span class="font-table-header text-table-header uppercase text-outline tracking-wider font-semibold">${esc(label)}</span>
    <div class="${STAT_VAL[intent] || STAT_VAL['']}">${painted}</div>
    ${parts[0] ? `<div class="font-body-sm text-[12px] text-on-surface-variant">${parts[0]}</div>` : ''}
    ${parts.length > 1 ? note(parts.slice(1).map(x => `<div>${x}</div>`).join(''), 'How this is counted') : ''}
  </div>`;
};
const dsStatRow = html => `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-space-md">${html}</div>`;
/* Table — states-components §4/§6, 44px rows. A clickable row keeps the
   `ds-row--clickable` marker the feed panel wires on. */
const dsTable = (cols, rows, opts = {}) => {
  if (!rows || !rows.length) return opts.empty || '';
  const th = c => `<th class="${c.align === 'r' ? 'py-3 px-4 text-right' : 'py-3 px-4 text-left'}">${esc(c.label)}</th>`;
  const td = c => (c.align === 'r' ? 'px-4 py-2 text-right font-label-numeric-sm text-label-numeric-sm'
    : c.strong ? 'px-4 py-2 text-left font-semibold' : 'px-4 py-2 text-left');
  return `<div class="overflow-x-auto"><table class="w-full text-left border-collapse">
    <thead><tr class="bg-surface-container-low border-b border-outline-variant/30 text-outline font-table-header text-table-header uppercase">${cols.map(th).join('')}</tr></thead>
    <tbody class="divide-y divide-outline-variant/20 font-body-sm text-body-sm text-on-surface">${rows.map((r, i) =>
      `<tr class="${opts.onRow ? 'ds-row--clickable h-11 hover:bg-surface-container-low transition-colors cursor-pointer' : 'h-11'}" data-i="${i}">${cols.map(c => `<td class="${td(c)}">${c.render(r, i)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
};
/* The design-system icon names this file passed, mapped to Material Symbols. */
const EMPTY_ICON = { coins: 'payments', check: 'task_alt', gauge: 'speed', shield: 'shield', scan: 'search' };
const dsEmpty = ({ title, body = '', name: iconKey = 'scan' } = {}) =>
  `<div class="p-space-lg flex flex-col items-center text-center justify-center min-h-[180px] space-y-3">
    <div class="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-outline"><span class="material-symbols-outlined text-[24px]">${esc(EMPTY_ICON[iconKey] || iconKey)}</span></div>
    <div class="space-y-1"><h3 class="font-headline-md text-body-lg font-semibold text-on-surface">${esc(title)}</h3>
    ${body ? `<p class="font-body-sm text-body-sm text-on-surface-variant max-w-md">${esc(body)}</p>` : ''}</div></div>`;
/* lib/ui.js's panel(), same contract — load/render, a working Retry that
   calls `load` again, and a thenable that replays its wirings after a retry —
   in overview--af6246's card anatomy ("Priority actions": header strip on
   surface-container-low, title, right-hand actions). The long sub-line is the
   panel's own definition of what it counts: its first sentence stays visible,
   the rest is one click away. */
const firstSentence = t => { const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(String(t || '')); return m ? m[0] : String(t || ''); };
function panel(host, { title, sub, actions, load, render }) {
  const card = document.createElement('section');
  card.className = 'rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm';
  host.appendChild(card);
  const wirings = [];
  const rewire = () => { for (const fn of wirings) { try { fn(card); } catch (e) { console.error('panel: re-wiring failed after retry', e); } } };
  const head = sub && firstSentence(sub) !== sub
    ? `<p class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${firstSentence(sub)}</p>${note(`<p>${sub}</p>`, 'What this panel counts')}`
    : (sub ? `<p class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${sub}</p>` : '');
  const attempt = async () => {
    card.innerHTML = `${title ? `<div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex flex-wrap items-start justify-between gap-space-sm">
        <div class="min-w-0 flex-1 basis-48"><h2 class="font-headline-md text-headline-md text-on-surface">${esc(title)}</h2>${head}</div>
        ${actions ? `<div class="flex items-center gap-space-sm shrink-0">${actions}</div>` : ''}</div>` : ''}<div data-pbody>${skeleton({ rows: 3 })}</div>`;
    const body = card.querySelector('[data-pbody]');
    try {
      const data = await load();
      body.innerHTML = render(data, card);
    } catch (e) {
      body.innerHTML = `<div class="p-space-md">${errorState({ what: title || 'this panel', err: e, retry: 'x' })}</div>`;
      body.querySelector('[data-retry]')?.addEventListener('click', () => { attempt().then(rewire); });
    }
  };
  const first = attempt().then(() => card);
  return {
    then(onOk, onErr) { if (typeof onOk === 'function') wirings.push(onOk); return first.then(onOk, onErr); },
    catch(onErr) { return first.catch(onErr); },
    finally(onDone) { return first.finally(onDone); },
  };
}
/* A row inside a panel (was the legacy `.list-item`). */
const ROW = 'flex items-start gap-3 px-space-md py-3 border-b border-outline-variant/20 hover:bg-surface-container-low transition-colors cursor-pointer';
const ROW_STILL = 'flex items-start gap-3 px-space-md py-3 bg-surface-container-low/40';

/* ── Adding up money the engine emitted ─────────────────────────────────────
   The single most expensive habit this screen has ever had is
   `rows.reduce((a, r) => a + (n0(r.x) || 0), 0)`. It turns a column nobody has
   filled in into a confident zero, and it did exactly that to holding cost on
   2 September: twelve cars, a NULL rate withdrawn for having no source, and a
   headline reading "AED 0 holding cost accrued in total". Nil and not-known are
   opposite claims about a dealership's money.

   So money is never reduced on this screen. It is TALLIED, and a tally carries
   its own denominator:

     total    the sum of the rows that actually carried a figure, or NULL when
              none did — never 0. aed(null) renders an em dash, and the caption
              beside it states the absence in words.
     n / of   how many rows were included, out of how many were considered.
     missing  the rows that could not be included, so any tile aggregating an
              unknown can say how many it left out. That sentence is mandatory,
              not decorative: an aggregate whose denominator is hidden is the
              same lie as a coalesced null, one level up.
     kinds    the distinct impact_kind values seen. `impact_kind` exists because
              the engine's figures are not all the same claim, and two different
              kinds added together produce a number nothing in the database
              holds. Where more than one kind is present NO TOTAL IS SHOWN —
              the caller renders the kinds instead. NONE is not a kind: it is
              the engine saying it claims no impact for that row, so it is not
              collected and the row simply has no figure to include.

   This is the whole of the arithmetic this screen performs on money. Every
   figure inside it — margin, exposure, the impact of an action — was computed
   by public.v_inventory_profit_sentinel and is copied, never recomputed. */
export const expose = (rows, getValue, getKind) => {
  let total = 0, n = 0;
  const kinds = new Set();
  for (const r of rows) {
    const k = str(getKind ? getKind(r) : '').toUpperCase();
    if (k && k !== 'NONE') kinds.add(k);
    const v = n0(getValue(r));
    if (v == null) continue;
    total += v; n += 1;
  }
  return { total: n ? total : null, n, of: rows.length, missing: rows.length - n, kinds: [...kinds] };
};
/* The engine's impact vocabulary, in the operator's words. MARGIN_EXPOSED is
   the only kind the Sentinel emits today and it is deliberately not shortened
   to "at risk" here — the whole point of the phrase is that it names what the
   money IS (gross margin that has not been realised) rather than what might
   happen to it. A kind this file has not been taught is printed as the engine
   spelled it, with the absence of wording stated, rather than folded into the
   one phrase we do have. */
const IMPACT_WORDS = {
  MARGIN_EXPOSED: 'of gross margin exposed',
};
export const impactPhrase = kind => IMPACT_WORDS[str(kind).toUpperCase()]
  || `of impact the engine labels ${str(kind) || 'nothing recognisable'}, which this dashboard has no wording for`;
/* One tally, rendered. Every branch names its denominator. */
export const exposureLine = (t, what) => {
  if (t.kinds.length > 1) {
    return `No total is shown across ${what}: they do not carry one kind of impact — ${t.kinds.join(', ')} — and figures of different kinds are not added together. The per-unit figures are on Inventory.`;
  }
  if (t.total == null) {
    return `No monetary figure is attached to ${what}. ${num(t.of)} ${plural(t.of, 'row', 'rows')} ${plural(t.of, 'was', 'were')} considered and none carried an impact figure, so this is unknown rather than nil.`;
  }
  /* The denominator is printed the same way whether or not anything was left
     out — "3 of 3 included, none omitted" — because a disclosure that only
     appears when there is bad news is a disclosure nobody learns to look for. */
  return `${aed(t.total)} ${impactPhrase(t.kinds[0])} across ${what} · ${num(t.n)} of ${num(t.of)} included`
    + (t.missing
        ? `, ${num(t.missing)} ${plural(t.missing, 'carries', 'carry')} no impact figure and ${plural(t.missing, 'is', 'are')} not in that total`
        : ', none omitted');
};
/* Said once wherever an exposure figure appears, and never abbreviated.

   EXPORTED, together with expose(), impactPhrase() and exposureLine() above, on
   6 Sep 2026 when screens/money-leaks.js landed. That screen totals the same
   exposure under the same rules, and a second copy of a money derivation is a
   second thing that has to be kept true — this file already imports
   recoveryEvidence() from screens/actions.js for exactly that reason. Nothing
   about the four moved or changed; only the keyword in front of them. */
export const EXPOSURE_CAVEAT = 'Exposure is gross margin — list price minus what the dealership paid — sitting in a unit that has not sold. It is the amount AT RISK. It is not an expected loss, not revenue, not money saved and not money recovered, and it is never added to anything that is.';

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
export const failureState = w => {
  const health = String((w && w.health) || '').toUpperCase();
  const incompleteAt = Date.parse(w && w.last_incomplete);
  const partialAt = Date.parse(w && w.last_partial);
  const successAt = Date.parse(w && w.last_success);
  const ranAt = Date.parse(w && w.last_run);
  const hasIncomplete = !Number.isNaN(incompleteAt);
  if (health === 'PRODUCING_NOTHING') {
    return { key: 'failing',
      text: `<span class="text-error">most of what it runs produces nothing usable, so a newer run is not evidence of recovery${
        Number.isNaN(successAt) ? ' — nothing it has run in the window succeeded outright' : `; its last outright success was ${esc(ago(w.last_success))}`}</span>` };
  }
  /* Which kind of not-clean the newest one was. last_incomplete is the newer of
     last_failure and last_partial, so an exact match on last_partial names it. */
  const halfDone = hasIncomplete && !Number.isNaN(partialAt) && partialAt === incompleteAt;
  const wording = halfDone ? 'went out half-done' : 'failed';
  if (Number.isNaN(successAt)) {
    if (hasIncomplete) {
      return { key: 'failing',
        text: `<span class="text-error">nothing it has run in the window succeeded outright, and its newest run that was not clean ${wording} ${esc(ago(w.last_incomplete))}</span>` };
    }
    if (Number.isNaN(ranAt)) {
      return { key: 'unknown',
        text: '<span class="text-outline">the view records no time for any run, so whether anything has succeeded cannot be told from here</span>' };
    }
    return { key: 'failing',
      text: `<span class="text-error">nothing it has run in the window succeeded outright; its newest run was ${esc(ago(w.last_run))} and it was not one</span>` };
  }
  if (hasIncomplete && successAt <= incompleteAt) {
    return { key: 'failing',
      text: `<span class="text-error">its newest run that was not clean ${wording} ${esc(ago(w.last_incomplete))}, and nothing has succeeded outright since</span>` };
  }
  if (!Number.isNaN(ranAt) && ranAt > successAt) {
    return { key: 'stale',
      text: `<span class="text-[#96570A]">its newest run is not a success — something ran ${esc(ago(w.last_run))} that did not succeed, and its last outright success was ${esc(ago(w.last_success))}</span>` };
  }
  return { key: 'recovered',
    text: `<span class="text-[#157A5B]">its newest run is a success, ${esc(ago(w.last_success))}</span>` };
};
/* Said wherever a row above claims to have recovered. The audit log holds one
   row per run that COMPLETED, so "it has succeeded since" is evidence about the
   last run that finished — not proof of health, and a workflow hung right now
   writes no row at all and is indistinguishable from an idle one from here. */
export const RECOVERY_CAVEAT = 'A workflow marked as having succeeded since is read from the automation health figures: last_success later than last_incomplete, and last_success being the newest run of any kind. That is evidence the most recent completed run did the job, not a clean bill of health — the audit log records only runs that finish, so a run hung right now leaves no row and cannot be seen from this screen. Recovery is never read off last_run: that column is the newest row of ANY status, and a run that produced nothing is not a recovery.';
/* Said wherever a row is amber rather than green. */
export const STALE_CAVEAT = 'A workflow marked as having succeeded but not on its newest run is stating arithmetic, not a diagnosis: last_success is the newest success by construction, so a later last_run is a run that was not one. What it was instead — half-done, no result, refused by design or escalated to a person — is in the counts beside it and in full on Automation.';

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
export const runCounts = w => {
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

/* Open or finished is lib/pipeline.js's isOpenLead, imported above. The rule —
   TONE from lib/format.js, with an unrecognised status counted as OPEN — used
   to be spelled out here and again, word for word, in screens/team.js. The
   paragraph that explained it now lives with the rule. */
SCREENS.overview = async host => {
  /* ── The layout: overview-revenue-command-center--af6246 ───────────────────
     One root carrying `nx-stitch` (the scoped reset the Stitch classes were
     designed against), appended rather than set on `#screen`, so go() removes
     it with the rest of the subtree.

     The ORDER is the export's, and the export's order is the same argument the
     old order made: what needs a human and what is costing money come before
     what happened. Top to bottom — the header; the attention banner; the two
     money cards (exposed margin, attributed recovery); Priority actions (the
     Needs-attention list); the KPI row; then two columns — where money is
     leaking and the latest leads on the left, Revenue Recovery, visits, no
     reply sent, workflows degraded and KYC archive gaps on the right; then the
     two analysis cards (pipeline by stage, margin against days in stock); then
     the roadmap row and the trust footer. */
  const readAtScreen = new Date().toISOString();
  const root = el('div', 'nx-stitch flex flex-col gap-space-md');
  host.appendChild(root);
  const box = cls => { const n = el('div', cls || ''); return n; };
  const headHost = box(); root.appendChild(headHost);
  headHost.innerHTML = `<div class="flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
    <div class="min-w-0">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="w-2 h-2 rounded-full bg-primary"></span>
        <span class="font-table-header text-table-header uppercase tracking-wider text-secondary">Revenue command center</span>
        <span class="text-outline-variant">•</span>
        <span class="font-label-numeric-sm text-[11px] text-outline">Read ${esc(dubaiStamp(readAtScreen))} — once, when this screen opened</span>
      </div>
      <h1 class="font-headline-lg text-headline-lg text-on-surface">Overview</h1>
    </div>
    <div class="flex items-center gap-space-sm self-start md:self-auto">
      <button type="button" data-ov-refresh class="${BTN.secondary}"><span class="material-symbols-outlined text-[16px]">refresh</span><span>Read again</span></button>
      ${SCREENS.actions ? `<button type="button" data-ov-go="actions" class="${BTN.primary}"><span class="material-symbols-outlined text-[16px]">task_alt</span><span>Open Action Center</span></button>` : ''}
    </div></div>`;
  headHost.querySelector('[data-ov-refresh]').addEventListener('click', () => go('overview'));
  headHost.querySelector('[data-ov-go]')?.addEventListener('click', () => go('actions'));

  const bannerHost = box(); root.appendChild(bannerHost);
  const moneyHost = box('grid grid-cols-1 md:grid-cols-2 gap-space-md'); root.appendChild(moneyHost);
  moneyHost.innerHTML = skeleton({ rows: 2 }) + skeleton({ rows: 2 });
  /* Priority actions — the Needs-attention list, full width as the export
     draws it. */
  const attnHost = box(); root.appendChild(attnHost);

  const strip = box(); strip.innerHTML = skeleton({ rows: 2 }); root.appendChild(strip);

  const cols = box('grid grid-cols-1 lg:grid-cols-3 gap-space-md items-start'); root.appendChild(cols);
  const leftCol = box('lg:col-span-2 flex flex-col gap-space-md min-w-0'); cols.appendChild(leftCol);
  const rightCol = box('flex flex-col gap-space-md min-w-0'); cols.appendChild(rightCol);
  /* First in the left column, because it is what is costing money and who has
     to answer for it. */
  const leakHost = box(); leftCol.appendChild(leakHost);
  const feedHost = box(); leftCol.appendChild(feedHost);
  /* Directly beside the leak panel, because it answers the question that panel
     raises and cannot close: what about the customers and the sales? */
  const recoveryHost = box(); rightCol.appendChild(recoveryHost);
  const apptHost = box(); rightCol.appendChild(apptHost);
  const replyHost = box(); rightCol.appendChild(replyHost);
  const flowHost = box(); rightCol.appendChild(flowHost);
  const kycHost = box(); rightCol.appendChild(kycHost);

  const analysis = box('grid grid-cols-1 md:grid-cols-2 gap-space-md items-start'); root.appendChild(analysis);
  const pipeCard = box('rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-lg'); analysis.appendChild(pipeCard);
  pipeCard.innerHTML = skeleton({ rows: 2 });
  const marginHost = box(); analysis.appendChild(marginHost);
  const roadmapHost = box(); root.appendChild(roadmapHost);
  const footHost = box(); root.appendChild(footHost);

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
  const readHealth = shared(() => db('v_workflow_health?select=name,category,health,runs_30d,failures_30d,partials_30d,no_result_30d,rejected_30d,escalated_30d,successes_30d,unknown_30d,effective_runs_30d,success_rate_30d,last_run,last_success,last_failure,last_partial,last_incomplete,is_active'
    + '&health=in.(DEGRADED,PRODUCING_NOTHING,UNKNOWN_OUTCOME)'
    + '&order=failures_30d.desc,partials_30d.desc,name.asc&limit=50'));
  /* Read for one reason only: to explain an absence. `undercut` is one of the
     kinds the Needs-attention list enumerates, and when `competitors` is empty
     that branch cannot fire at all — so an operator reading "no undercuts"
     would be reading a silence as an all-clear. One row is enough to tell the
     two apart, which is all this asks for. */
  const readRivals = shared(() => db('competitors?select=id&limit=1'));
  /* Every recorded decision about a unit, open and closed. The leak panel is
     the only consumer today, but it is shared for the same reason the others
     are: `v_inventory_action_queue` is what makes "approved but not carried
     out" distinguishable from "waiting on a person", and two reads of it could
     put one action in two states on the same screen.

     Closed rows are read too, deliberately. A REJECTED action is not noise —
     it is the record that a human answered the engine and said no, which is the
     single most valuable row in the table (see the column comment on
     decision_reason_code), and a panel that filtered to is_live would show an
     owner an empty queue while reporting the unit under it as undecided. */
  const readQueue = shared(() => db(`v_inventory_action_queue?select=${QUEUE_COLS}`
    + `&order=proposed_at.desc&limit=${QUEUE_LIMIT}`));
  /* Started here, not at first use. The core read below is awaited before any
     panel exists, so a read that waits for its panel would queue behind it
     instead of running alongside it — five round trips in series on the screen
     an owner opens first. */
  readAttention(); readKycGaps(); readHealth(); readRivals(); readQueue();

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
     was still here a week after they stopped existing. It adds nothing today,
     and the REASON it adds nothing has already changed once since that sentence
     was written, which is why it is dated rather than stated as a fact about
     the table. On 1 Sep 2026 `kyc_documents` was empty. Re-counted live on
     2 Sep 2026 it holds three rows, all three written that morning, all three
     carrying a `void_reason` — the vision auditor classified the image as not
     an identity document — and all three with their file archived. So the gap
     read (`storage_path is null`) still returns nothing, `need.kycExtra` is
     still 0, and rule 2 below still leaves the badge exactly as badges.js
     painted it; the table being empty is no longer the reason and has not been
     for a day. The mechanism stays either way, because the next real submission
     that fails to archive is the case it exists for. An absence of gaps is also
     not an all-clear about KYC itself: what those three rows record is the
     auditor rejecting three non-documents, which is the pipeline working on
     input that was never KYC.

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
      + ` that the attention list does not list`;
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
    const [leads, sentinelRes, metrics, outbound, contactsRes] = await Promise.all([
      /* `phone` and `assigned_to` are real columns on leads (probed 24 Aug) and
         both are read below: a lead waiting for a reply is a person somebody has
         to ring, and the rep's name is what makes "unanswered" somebody's job.
         There is no `lead_score` and no `updated_at` on this table — the score
         is `ai_score`, and nothing records when a lead was last modified. */
      db(`leads?select=id,name,email,phone,status,ai_score,vehicle_interest,source,budget_aed,response_time_minutes,created_at,assigned_to,assigned_to_id&order=created_at.desc&limit=${LEAD_LIMIT}`),
      /* THE SENTINEL, NOT THE TABLE. Until 2 Sep 2026 this line read
         `inventory?select=id,model,days_in_stock,price_aed,holding_cost_accrued,aging_alert`
         — a second source for two figures public.v_inventory_profit_sentinel
         already owns, computes and states the provenance of.

         Both stored columns are what a second source looks like when it goes
         wrong. `holding_cost_accrued` was written by recompute_inventory_derived()
         from an AED 50/day rate that cites no source; Lane A withdrew the rate
         on 2 September, so the column is NULL on all twelve rows and the sum
         this screen printed over it — with `|| 0` — read "AED 0". The Sentinel
         answers the same question with holding_cost_state NOT_COMPUTABLE and a
         sentence saying why, which is the true answer and the one Inventory
         shows. `aging_alert` is the other half: the Sentinel's `aging_band` is
         computed from the same 90/120-day thresholds, but it also carries
         `overall_risk`, which is what an owner is actually asking about — a
         WARNING car with 65% of its margin intact is not the same problem as a
         CRITICAL one, and the table cannot tell them apart.

         `inventory` is now read nowhere in this file. Every ageing, margin,
         exposure and recommendation figure below is copied out of the engine's
         own columns; none is recomputed here.

         The function is not given p_min_risk_rank. It must not be: filtering to
         the risky units would leave this screen unable to say what the healthy
         ones are, and "9 of 12 are LOW and the engine says do nothing" is half
         the honest answer to "where am I losing money".

         SETTLED, NOT AWAITED WITH THE REST, and that is a deliberate change of
         behaviour rather than defensive noise. The `inventory` read this line
         replaced sat inside this Promise.all and took the WHOLE screen to the
         error card if it failed — the KPI strip, the reply-gap panel and the
         stage bar with it. That was tolerable for a plain table read; it is
         not for a function call, and it would mean an owner who cannot reach
         the Sentinel also cannot see who is waiting for a reply. The rejection
         becomes a value here, exactly as the whatsapp_contacts bridge does, so
         a Sentinel failure withholds the stock figures and NOTHING ELSE — and
         it is rendered as a withheld figure rather than as an empty lot. */
      db(SENTINEL_RPC).then(rows => ({ rows, err: null }), e => ({ rows: null, err: e })),
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
      /* `channel` AND `message` are both selected, because neither one alone can
         tell a reply to a customer from a marker this system wrote to itself.
         `message` was added on 1 Sep 2026: without it isReply() below could not
         run its third test at all, and this screen's private predicate — which
         read the channel and never the body — passed a `[SILENCE-…]` row logged
         on channel 'whatsapp' as a message somebody sent a customer. The column
         is read for that test only; nothing renders it. */
      db(`communication_logs?select=lead_email,created_at,channel,direction,message&direction=eq.outbound&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=${OUTBOUND_LIMIT}`),
      /* The `@lid` bridge, added 1 Sep 2026. Settled rather than awaited with
         the rest: this read is a precondition of the reply-gap check and not of
         anything else on the strip, so its failure must withhold that one check
         and take nothing else down with it. Rejections are turned into a value
         here for the same reason lib/lead-drawer.js does it — a consumer may not
         assert an absence whose source errored. */
      db(`whatsapp_contacts?select=chat_id,phone,push_name,lead_email&limit=${CONTACT_LIMIT}`)
        .then(rows => ({ rows, err: null }), e => ({ rows: [], err: e })),
    ]);
    /* Empty on failure so every partition below is empty too — and NOTHING
       below may present that emptiness as an answer. `sentinelErr` is what
       separates "the engine says there is nothing to do" from "the engine did
       not answer", and every caption about stock tests it first. */
    const sentinel = sentinelRes.rows || [];
    const sentinelErr = sentinelRes.err;
    const contacts = contactsRes.rows || [];
    const contactsErr = contactsRes.err;
    const contactsCapped = !contactsErr && contacts.length >= CONTACT_LIMIT;

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
    const leadsCapped = leads.length >= LEAD_LIMIT;
    /* One derivation, shared with screens/team.js. `openLeads`, the closed
       count and the pipeline sum all come out of the same call, so the tile
       cannot say "3 open leads" over a total computed from a different set. */
    const pipe = openPipeline(leads, leadsCapped);
    const openLeads = pipe.open;
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
       tiles left has always handled this correctly; this is the same shape.
       Both the filter and the null-not-zero sum now come from lib/pipeline.js,
       which screens/team.js reads too; the paragraph stays because it is the
       reason the shared function is shaped that way. */
    const withBudget = pipe.withBudget;
    const pipeline = pipe.value;
    /* ── What the Sentinel says about the lot ────────────────────────────
       Every line below is a partition of the engine's own columns. Nothing is
       recomputed and nothing is inferred; where the engine says UNKNOWN or
       NOT_COMPUTABLE that word is carried through to the screen.

       A DECISION IS ASKED FOR WHEN THE RECOMMENDATION IS NOT `HOLD`. That is
       the engine's own convention, stated in the column comment on
       inventory_actions.recommendation: "HOLD is never proposed — it is the
       engine saying there is nothing to do". So this is not a severity filter
       and must not become one. A unit can sit at LOW risk and still be asked
       about, and — the case that matters more — nine LOW/HOLD units are nine
       cars with nothing wrong with them, which this screen has to be able to
       say without dressing them as a problem.

       `needsDecision` is therefore keyed on recommendation, and the risk split
       under it is descriptive of that set rather than the thing that selected
       it. Units the engine cannot classify arrive with overall_risk UNKNOWN;
       they are counted separately, because unknown is not low. */
    const HOLD = 'HOLD';
    const needsDecision = sentinel.filter(u => up(u.recommendation) && up(u.recommendation) !== HOLD);
    const holdUnits = sentinel.filter(u => up(u.recommendation) === HOLD);
    const unRecommended = sentinel.length - needsDecision.length - holdUnits.length;
    const byRisk = k => needsDecision.filter(u => up(u.overall_risk) === k).length;
    const riskSplit = ['SEVERE', 'HIGH', 'ELEVATED', 'LOW'].map(k => [k, byRisk(k)]).filter(([, n]) => n);
    const riskUnknown = needsDecision.filter(u => {
      const r = up(u.overall_risk);
      return !r || !['SEVERE', 'HIGH', 'ELEVATED', 'LOW'].includes(r);
    }).length;
    /* Worst risk present among the units being asked about, for the tone of the
       tile. Read off the engine's own rank column, never off the order of the
       words above — the engine ranks them and this screen does not get a vote. */
    const worstRank = needsDecision.reduce((a, u) => {
      const r = n0(u.overall_risk_rank);
      return r != null && (a == null || r > a) ? r : a;
    }, null);
    const worstRisk = worstRank == null ? '' :
      up((needsDecision.find(u => n0(u.overall_risk_rank) === worstRank) || {}).overall_risk);
    /* The exposure. See expose() above for why this is not a reduce. */
    const exposed = expose(needsDecision, u => u.impact_aed, u => u.impact_kind);
    /* Ageing, from the engine's band rather than inventory.aging_alert. Counted
       across the WHOLE lot, not just the units being asked about, because the
       band and the recommendation answer different questions and an owner reads
       both — a CRITICAL car the engine says HOLD on would otherwise vanish. */
    const band = k => sentinel.filter(u => up(u.aging_band) === k).length;
    const bandSplit = { critical: band('CRITICAL'), warning: band('WARNING'), healthy: band('HEALTHY') };
    const oldestDays = sentinel.reduce((a, u) => {
      const d = n0(u.days_in_stock);
      return d != null && (a == null || d > a) ? d : a;
    }, null);
    /* The three unknowns, counted rather than described, so every sentence
       about them carries its own denominator. `holding_cost_state` is the one
       that used to be printed as AED 0; the other two decide what a REPRICE is
       allowed to mean on this screen. */
    const stateCount = (rows, col, ok) => rows.filter(u => up(u[col]) !== ok).length;
    const noHolding = stateCount(sentinel, 'holding_cost_state', 'COMPUTED');
    const noNetMargin = stateCount(sentinel, 'net_margin_state', 'COMPUTED');
    const noMarket = sentinel.filter(u => up(u.market_position).startsWith('UNKNOWN')).length;
    const noDemand = sentinel.filter(u => up(u.demand_signal).startsWith('UNKNOWN')).length;
    /* One computed_at for the whole set — the function computes them in one
       pass, so they agree; taken off the first row and shown, not assumed. */
    const computedAt = sentinel.length ? sentinel[0].computed_at : null;
    const defaultSettings = sentinel.some(u => u.settings_are_defaults === true);

    const sinceMs = Date.parse(since);
    /* ── What counts as a reply ──────────────────────────────────────────
       Three things were wrong here and they were wrong independently.

       Not every outbound row is a message to a customer. `channel` exists on
       communication_logs precisely to separate the two, and this filtered on
       `direction` alone — so the Silence Detector's own markers, written
       `channel='system'` and reading "[SILENCE-ESCALATED] Silent for 12h
       since …", counted as proof somebody had replied. Those rows exist
       BECAUSE nobody replied. The detector already fixed this on its writing
       side (it now writes direction 'internal'); the two legacy rows still
       carry direction 'outbound' and are excluded by channel. Both spellings
       are excluded, so neither side has to be deployed first.

       And then the fix for that grew its own hole, which is the one closed on
       1 Sep 2026. It read

         channel in {system, internal} || direction === 'internal'

       and never looked at the message body — the exact mirror image of the copy
       screens/campaigns.js carried, which looked at nothing but the body. A
       marker written on channel 'whatsapp' satisfies neither half of that test
       and was drawn on the front page as a reply to a customer; the database's
       own nexus_is_message() has always excluded it. There is now one rule:
       lib/comm-events.js, which mirrors that function line for line. Measured
       against the live table on 1 Sep 2026 the two forms agree exactly — 2
       internal rows and 19 replies in the 30-day window, by both the old
       predicate and the new one and by the SQL function — so nothing on this
       tile moved today. Add one `[SILENCE-…]` row on channel 'whatsapp' and the
       old test reports 20 replies where this one reports 19.

       `direction === 'internal'` was already unreachable when it was written,
       and that is worth saying rather than deleting quietly: the query above
       carries `direction=eq.outbound`, so a row with direction 'internal' never
       arrives here to be tested. It is excluded by the read, not by the
       predicate. isReply() below is nexus_is_message() restricted to outbound,
       which over an outbound-only read is the same set as isMessageRow(), so
       the two names describe the identical partition here.

       And a set of addresses is not an answer. Membership alone marked a lead
       answered by any message to that address in the window, including one sent
       before the lead row existed — so a returning customer quoted in August
       and re-enquiring today is exempted from the five-minute rule on the
       strength of the earlier quote, silently, for exactly the segment with the
       highest close rate. The newest reply per PERSON is kept and compared
       against the lead's own created_at.

       And the third thing, which was the largest and was still here on the
       morning of 1 Sep 2026. "Per person" was `lower(leads.email)` compared to
       `lower(communication_logs.lead_email)` — string equality on one column,
       no resolver, no phone rule, no whatsapp_contacts read on this screen at
       all. That column is not an email column. It holds four incompatible key
       shapes for the same human being (a real address, `<digits>@c.us`,
       `<lid>@lid`, `+<digits>@whatsapp.lead`), the backend joins them on the
       LAST NINE DIGITS of the phone number, and a `@lid` carries no phone
       digits and bridges only through whatsapp_contacts. Measured against the
       live database on 1 Sep 2026, the old rule attached 8 of the 19 real
       replies in the window; per lead it reached 3 of 8, 0 of 10 and 15 of 29
       where lib/identity.js reaches all of them. Lead 35's `email` column is
       the empty string, so `norm('')` was `''` and every one of its ten
       messages was dropped.

       The conclusions survived by luck — 34 and 38 read ANSWERED either way and
       35 is DISQUALIFIED so it never entered this queue — but a WhatsApp-only
       lead answered only under a `@lid` would have been printed on the front
       page as awaiting its first reply. The rule is not this screen's to choose:
       lib/identity.js is the same rule the n8n `Resolve Lead Identity` node used
       to WRITE these keys, and eight other consumers now read on it. */
    /* One rule, imported. isInternalRow is the exact complement of the message
       test inside lib/comm-events.js, so these two lists partition `outbound`
       by construction and no row can be counted in both or in neither. */
    const replies = outbound.filter(isReply);
    const internalMarkers = outbound.filter(isInternalRow).length;

    /* ── Who each lead is ────────────────────────────────────────────────
       One expansion per lead, seeded from the row and bridged through
       whatsapp_contacts, exactly as screens/leads.js:407 does it. `leads` goes
       in as the candidate pool so that two people whose numbers end in the same
       nine digits are REPORTED as a collision and merged into neither, rather
       than silently becoming one customer on the front page.

       `canonical` is the comparison form. It collapses `@c.us`,
       `@s.whatsapp.net`, `@whatsapp.lead` and a bare number onto
       `phone:<last 9>` while keeping a LID as `lid:<digits>` and an address as
       `email:<address>` — so a LID whose digits happen to end like somebody's
       phone number can never compare equal to it. Matching happens in memory
       over the window this screen already reads, not as one query per person:
       the panel is about every recent lead at once, and 2000 personFilter reads
       to answer one KPI is not a trade this screen can make. */
    const canonOf = new Map();
    for (const l of leads) {
      const idn = expandIdentity(
        { leadId: l.id, email: l.email, phone: l.phone, name: l.name },
        { links: contacts, leads });
      canonOf.set(String(l.id), new Set(idn.keys.map(k => normalizeKey(k).canonical).filter(Boolean)));
    }
    /* canonical -> the leads filed under it. A list and not a single lead: if
       two leads ever do resolve to the same canonical, a reply under it answers
       both of them and neither is quietly given away to the other. */
    const leadsForCanon = new Map();
    for (const l of leads) {
      for (const k of canonOf.get(String(l.id))) {
        if (!leadsForCanon.has(k)) leadsForCanon.set(k, []);
        leadsForCanon.get(k).push(String(l.id));
      }
    }
    const owners = c => leadsForCanon.get(normalizeKey(c.lead_email).canonical) || [];

    /* Newest reply per lead, not per address — a person filed under three keys
       has one answer time, and it is the latest of them. */
    const lastReply = new Map();
    replies.forEach(c => {
      const t = Date.parse(c.created_at);
      if (Number.isNaN(t)) return;
      owners(c).forEach(id => {
        const seen = lastReply.get(id);
        if (seen == null || t > seen) lastReply.set(id, t);
      });
    });
    /* At or after, not merely present. Equal timestamps are counted as an
       answer: the router writes the lead and the BDC agent's first message
       within the same second on a WhatsApp enquiry. */
    const answeredSince = l => {
      const t = lastReply.get(String(l.id));
      const born = Date.parse(l.created_at);
      return t != null && !Number.isNaN(born) && t >= born;
    };
    /* ── The screen's own blind spot, measured rather than guessed ────────
       Some outbound messages in this window belong to a WhatsApp thread with no
       lead record behind it at all. Those can never match a lead, so the join
       is provably incomplete and this is by how much.

       It is counted from the matching OUTCOME — a reply no lead claimed — and
       not, as it was until 1 Sep 2026, from the key's shape. That test was
       `isHandle(lead_email)`, whose handle set is the four WAHA address forms
       and does NOT include `+<digits>@whatsapp.lead`. So on 1 Sep it reported 5
       where the true number the screen could not match was 11: the six missing
       were one customer's own replies under `+918517942172@whatsapp.lead`. The
       screen understated its own blind spot by more than half, in the single
       sentence written to admit it. Counting the outcome cannot drift from the
       rule again, because it IS the rule's output. Measured live the same day
       with the resolver in place: 2 of 19, both under `61207646060562@lid`,
       a chat that has no lead. */
    const unmatchedReplies = replies.filter(c => owners(c).length === 0).length;
    const recent = leads.filter(l => Date.parse(l.created_at) >= sinceMs);
    /* Terminal leads are not people waiting for a call. A lead the BDC agent
       disqualified as spam was eligible for this queue, in red, as somebody who
       needed ringing. */
    const recentOpen = recent.filter(isOpenLead);
    const recentTerminal = recent.length - recentOpen.length;
    /* A lead the resolver cannot key on at all — no address, no phone, no chat
       id — cannot be matched against communication_logs; one with no readable
       created_at cannot be compared against a reply time. Neither is counted as
       unanswered — that would invent a queue — and neither is counted as
       answered either, which is what the all-clear sentence used to do by
       printing `recent.length` as its denominator while testing a strictly
       smaller set. `tested` is the cohort every claim on this strip is made
       about, and the untested rows are reported as their own number rather than
       absorbed into a green line.

       "No email address" was the old test and it was the wrong one twice over:
       it excluded lead 35, which has an empty email and a phone number the
       backend matches on perfectly well, and it would have admitted a lead
       carrying an address the log has never once been keyed under. What decides
       it now is whether the resolver produced a usable key. */
    const unkeyed = recentOpen.filter(l => !canonOf.get(String(l.id)).size).length;
    const tested = recentOpen.filter(l => canonOf.get(String(l.id)).size
      && !Number.isNaN(Date.parse(l.created_at)));
    const untestable = recentOpen.length - tested.length;
    /* Without whatsapp_contacts there is no `@lid` bridge, and a lead whose
       whole conversation is LID-keyed would be named on the front page as never
       answered. That is a false accusation against a rep, so the check is
       withheld rather than run on a partial identity — the same call
       screens/leads.js:670 makes for the same reason. A capped read is treated
       as a failed one: some bridges would be missing and there is no way to
       know which. */
    const bridgeOk = !contactsErr && !contactsCapped;
    const waiting = bridgeOk
      ? tested.filter(l => !answeredSince(l))
        .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
      : [];

    /* An open enquiry nobody owns. This is a leak with a name on it and it is
       counted off the same column v_needs_attention's own lead_unassigned
       branch uses — `assigned_to_id IS NULL` — with the free-text `assigned_to`
       tested as well, because a row carrying a rep's name and no id is a lead
       somebody has claimed and the id is the thing that is missing. Terminal
       leads are excluded: a DISQUALIFIED enquiry with no owner is not work.

       Note the view's branch fires only for HOT leads. This one does not filter
       by grade, so it can be LARGER than the view's count and is never
       presented as the same number. */
    const openUnassigned = openLeads.filter(l => !str(l.assigned_to_id) && !str(l.assigned_to));
    /* Response time, partitioned rather than averaged, for the leak panel. The
       KPI two tiles over reports the mean; this reports how many were measured
       at all, because a lead with no recorded response time is UNMEASURED, not
       compliant, and folding it into either side of the five-minute rule is the
       lie the whole strip is written to avoid. */
    const slaBreached = withResp.filter(l => Number(l.response_time_minutes) > 5).length;
    const noResponseTime = leads.length - withResp.length;

    core = { leads, sentinel, hot, warm, cold, avgResp, withResp, withBudget, pipeline,
             openCount: openLeads.length, terminalCount: terminal.length, terminalNames,
             metrics, waiting,
             untestable, unkeyed, recentTerminal, testedCount: tested.length,
             unmatchedReplies, outboundCount: replies.length, internalMarkers,
             recentCount: recent.length, canonOf,
             bridgeOk, contactsErr, contactsCapped, contactCount: contacts.length,
             leadsCapped,
             /* The Sentinel summary, derived once and read by both the KPI strip
                and the leak panel, so the tile and the panel under it cannot
                report two different counts of the same twelve cars. */
             sentinelErr,
             needsDecision, holdUnits, unRecommended, riskSplit, riskUnknown,
             worstRisk, exposed, bandSplit, oldestDays,
             noHolding, noNetMargin, noMarket, noDemand, computedAt, defaultSettings,
             openUnassignedCount: openUnassigned.length, slaBreached, noResponseTime,
             outboundCapped: outbound.length >= OUTBOUND_LIMIT };
  } catch (e) {
    coreErr = e;
  }

  /* Dependent panels re-raise the core failure so panel() renders its own error
     card with a working Retry, instead of five cards quietly showing nothing. */
  const requireCore = () => { if (coreErr) throw coreErr; return core; };

  if (coreErr) {
    strip.innerHTML = errorState({ what: 'the overview', err: coreErr });
    pipeCard.innerHTML = errorState({ what: 'pipeline by stage', err: coreErr });
  } else {
    const { leads, sentinel, hot, warm, cold, avgResp, withResp, withBudget, pipeline,
            openCount, terminalCount, terminalNames,
            metrics, waiting, recentCount,
            testedCount, untestable, unkeyed, recentTerminal, bridgeOk,
            contactsErr, contactsCapped, leadsCapped, sentinelErr,
            needsDecision, holdUnits, unRecommended, riskSplit, riskUnknown, worstRisk,
            exposed, bandSplit, oldestDays, noHolding, computedAt } = core;

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
      if (before == null) return `<span class="text-outline">${when.charAt(0).toUpperCase() + when.slice(1)} records no comparable figure, so no change is shown</span>`;
      const d = Number(now) - Number(before);
      if (!d) return `<span class="text-outline">No change against ${when}</span>`;
      const good = lowerIsBetter ? d < 0 : d > 0;
      return `<span class="${good ? 'text-[#157A5B]' : 'text-error'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</span> <span class="text-outline">against ${when}</span>`;
    };

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
    const leadsSub = `${dsChip(`${hot} HOT`, dsIntent('hot'))} ${dsChip(`${warm} WARM`, dsIntent('warm'))} ${dsChip(`${cold} COLD`, dsIntent('cold'))}`
      /* What the headline leaves out, named. The tile counts leads still being
         worked; the table also holds the finished ones, and an owner comparing
         this number against a row count elsewhere has to be able to see the
         difference rather than discover it. */
      + (terminalCount
          ? `<br>${muted(`${num(terminalCount)} further ${plural(terminalCount, 'lead is', 'leads are')} closed — ${terminalNames.join(', ')} — and ${plural(terminalCount, 'is', 'are')} not counted above. The table holds ${num(leads.length)} ${plural(leads.length, 'row', 'rows')} in total.`)}`
          : '')
      + (leadsCapped
          ? `<br>${warn(`Capped at ${num(LEAD_LIMIT)} rows — Your leads holds more than this.`)}`
          : leads.length <= THIN
            ? `<br>${warn(`That is the whole your leads — ${num(leads.length)} ${plural(leads.length, 'row', 'rows')}, not a sample of it.`)}`
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
            ? `${num(untestable)} open ${plural(untestable, 'lead', 'leads')} in this window could not be checked${unkeyed ? ` — ${num(unkeyed)} ${plural(unkeyed, 'carries', 'carry')} no address, no phone number and no chat id, so there is nothing to match ${plural(unkeyed, 'it', 'them')} to the message history on` : ''}, so ${plural(untestable, 'it is', 'they are')} not in the figure above either way.`
            : '',
          recentTerminal
            ? `${num(recentTerminal)} further ${plural(recentTerminal, 'lead in this window is', 'leads in this window are')} already closed and ${plural(recentTerminal, 'is', 'are')} not counted as waiting.`
            : '',
        ].filter(Boolean).join(' '))}`
      : '';
    /* An empty list is only good news when the check actually ran. Without the
       whatsapp_contacts bridge every `@lid` message is unattachable, so the
       zero above would be a green all-clear painted over a check that was
       never performed — the same overclaim `untestedNote` exists to prevent,
       arriving from the read side instead of the data side. */
    const waitSub = !bridgeOk
      ? warn(`This check did not run. ${bridgeWhy(contactsErr, contactsCapped)} No lead is being claimed as answered or unanswered.`)
      : waiting.length
      ? `<span class="text-error">Oldest arrived ${esc(ago(waiting[0].created_at))}, still unanswered</span>`
        + `<br>${muted(`Out of ${num(testedCount)} open ${plural(testedCount, 'lead', 'leads')} created in the last ${WINDOW_DAYS} days that could be checked`)}`
        + untestedNote
      : testedCount
        ? `<span class="text-[#157A5B]">All ${num(testedCount)} open ${plural(testedCount, 'lead', 'leads')} created in the last ${WINDOW_DAYS} days that could be checked ${plural(testedCount, 'has', 'have')} an outbound message sent after ${plural(testedCount, 'it arrived', 'they arrived')}</span>`
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
       communication_logs, and it does not read this column at all.

       That last sentence used to continue "on this particular lead it cannot
       answer it either, because that message is filed under a WhatsApp handle
       and the lead carries no email". That stopped being true on 1 Sep 2026,
       when the reply analysis moved onto lib/identity.js. It CAN answer it now:
       lead 35's phone is +971505433953, whatsapp_contacts ties that number to
       `111948809162873@lid`, and all ten of its messages — the 06:40:38 outbound
       included — resolve to it. Measured live the same day: 0 rows under the old
       rule, 10 under the resolver. The lead stays out of the queue because it is
       DISQUALIFIED, which is a different reason and the correct one. */
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
          ? `<span class="text-error">Breaches the 5-minute rule</span><br>${respBasis}`
          : `<span class="text-[#157A5B]">Inside the 5-minute rule</span><br>${respBasis}`)
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
        /* "No open lead has a budget recorded" is a claim about the table, and
           on a truncated read this screen has only seen part of it. The
           sentence is qualified rather than withdrawn: none of the rows read
           carries one, which is still true and still worth saying. */
        + (leadsCapped ? `<br>${warn(CAP_NOTE(num(LEAD_LIMIT)))}` : '')
      : muted(`Sum of the budget field on ${num(withBudget.length)} of ${num(openCount)} open ${plural(openCount, 'lead', 'leads')}`
              + (noBudget ? ` · ${num(noBudget)} with no budget recorded` : '')
              + (terminalCount ? ` · ${num(terminalCount)} closed ${plural(terminalCount, 'lead', 'leads')} excluded` : ''))
        + (withBudget.length <= THIN
            ? `<br>${warn(`This is ${num(withBudget.length)} ${plural(withBudget.length, 'budget field', 'budget fields')} added up, not a forecast.`)}`
            : '')
        /* The cap was disclosed on the Open-leads tile and nowhere else, so a
           truncated read printed a partial sum here as though it were the
           table's total. Same read, same truncation, so the same warning is
           owed on both tiles. The wording is CAP_NOTE from lib/pipeline.js —
           shared with Team so the two screens cannot disclose the identical
           truncation in two different strengths. */
        + (leadsCapped ? `<br>${warn(CAP_NOTE(num(LEAD_LIMIT)))}` : '')
        /* No delta on this tile. THE REASON CHANGED ON 2 Sep 2026 AND THIS
           COMMENT ASSERTED THE OLD ONE. It said daily_metrics.pipeline_aed is
           written as `coalesce(sum(budget_aed), 0)` over EVERY lead with a
           budget, no status filter, zero where the answer is "none recorded" —
           "precisely the two defects the headline above no longer has". Read off
           the live function body today, capture_daily_metrics() writes
           `(SELECT sum(budget_aed) FROM leads WHERE nexus_lead_is_open(status))`:
           open leads only, no coalesce. Both defects are gone, and the 2026-09-02
           row live records pipeline_aed as NULL where 09-01 recorded 0.

           THE REFUSAL IS KEPT ANYWAY, on a reason that is true rather than the
           one that has expired, and it is deliberately not narrowed here.
           The snapshot HISTORY is mixed-rule: every row before 2026-09-02 was
           written under the old definition, and the function stamps which one it
           used into `pipeline_aed_rule` ('all_leads_coalesce_0' then,
           'open_leads_null_when_unknown' now), backfilled across the old rows.
           This read takes the newest row and does not look at that column, so it
           cannot tell a post-migration snapshot from a pre-migration one — and
           the newest row is only post-migration for as long as the nightly
           capture keeps running. Subtracting across that boundary is subtracting
           two different definitions, which is the same failure as before for a
           different reason. Gating the delta on pipeline_aed_rule would fix it
           and is a behaviour change, not a comment: it is not made here.

           WITHIN one post-migration row the rules now agree, and that changed
           while this file was being edited on 2 Sep 2026 — an earlier draft of
           this comment said `open_leads` in the same row still counted
           `status <> 'CLOSED'` and so disagreed with pipeline_aed. Re-read off
           the live function body afterwards: `open_leads` is now
           `count(*) FROM leads WHERE nexus_lead_is_open(status)`, stamped into a
           new `open_leads_rule` column ('nexus_lead_is_open' today,
           'status_not_closed' on the backfilled older rows). Live, the 09-02 row
           records open_leads 1 against the 09-01 row's 3 — the same three leads
           either way, counted by two different rules on two different days.
           So a snapshot row is internally consistent from 2026-09-02 onward, and
           the mixed history is the whole of the remaining problem.

           The response-time tile still carries its delta because the snapshot
           and the live figure there really are the same population. */
        + (prev
            ? `<br>${muted(`No comparison is drawn against ${snapshotWhen.replace(/^The/, 'the')}. Snapshots taken before 2 Sep 2026 summed every lead with a budget, closed ones included, and recorded zero where none was recorded; snapshots taken since count open leads only, on the same rule as the figure above. This screen does not check which of the two wrote the row it read, so subtracting them could be subtracting two different definitions rather than showing a change.`)}`
            : '');

    /* ── Units needing a decision ────────────────────────────────────────
       This tile was "Units at risk" and counted `inventory.aging_alert =
       'CRITICAL'`. Two things were wrong with that and only one of them was the
       second source.

       The label was the other. "At risk" is a severity word, and the number
       under it was a count of cars that had crossed a date threshold — which is
       not the same question an owner is asking, and not the question the engine
       answers. A car can be CRITICAL on age and still be the right car to keep;
       a car can be inside every threshold and still need a price looked at. The
       engine emits a RECOMMENDATION per unit and says HOLD when there is
       nothing to do, so what this tile counts now is the units where the engine
       is asking for a person, and the risk words appear underneath as a
       description of that set rather than as its definition.

       The healthy majority is stated in the same breath and in the engine's own
       words. Nine cars the engine says HOLD on are nine cars with nothing wrong
       with them, and a front page that leaves them out of the sentence makes a
       twelve-car lot look like a crisis. */
    const holdWords = holdUnits.length
      ? `${num(holdUnits.length)} further ${plural(holdUnits.length, 'unit is', 'units are')} on HOLD — the engine's word for nothing to do`
      : '';
    const riskWords = riskSplit.length
      ? riskSplit.map(([k, n]) => `${num(n)} ${k}`).join(' · ')
        + (riskUnknown ? ` · ${num(riskUnknown)} at a risk the engine could not classify` : '')
      : '';
    const decisionSub = (sentinelErr
        /* Withheld, not zero. A "0" over "the Sentinel could not be read" is
           the same class of lie as the AED 0 this tile used to print: it turns
           an unanswered question into a clean answer, and it is the one thing
           this tile is not allowed to do. */
        ? warn(`The Profit Sentinel could not be read (${sentinelErr.message}), so nothing is claimed about stock, margin or ageing. No figure is shown rather than a zero — this is a question that went unanswered, not a lot with nothing wrong with it.`)
      : needsDecision.length
        ? `<span class="${worstRisk === 'SEVERE' || worstRisk === 'HIGH' ? 'text-error' : 'text-[#96570A]'}">${esc(riskWords)}</span>`
          + `<br>${muted(exposureLine(exposed, plural(needsDecision.length, 'that unit', 'those units')))}`
        : sentinel.length
          ? muted(`The engine recommends HOLD on every one of the ${num(sentinel.length)} ${plural(sentinel.length, 'unit', 'units')} it scored, so it is not asking for a decision on any of them`)
          : muted('The Profit Sentinel returned no units to score'))
      + (holdWords ? `<br>${muted(holdWords + '.')}` : '')
      + (unRecommended ? `<br>${warn(`${num(unRecommended)} ${plural(unRecommended, 'unit carries', 'units carry')} no recommendation at all and ${plural(unRecommended, 'is', 'are')} in neither figure.`)}` : '')
      /* The unknown that used to be printed as AED 0. It is the first thing an
         owner will try to work out from this tile — "how fast is that costing
         me" — and the answer is that nobody knows, because nobody has told the
         system what a day of floor costs. Said as a count over a denominator,
         because "holding cost is unknown" without one is not checkable. */
      + (noHolding
          ? `<br>${warn(`Holding cost is NOT COMPUTABLE on ${num(noHolding)} of ${num(sentinel.length)} ${plural(sentinel.length, 'unit', 'units')}: this dealership has never recorded what a day of floor costs, so how fast that margin is being eaten is unknown, not nil. Net margin is withheld for the same reason.`)}`
          : '')
      + (bandSplit.critical || bandSplit.warning
          ? `<br>${muted(`On age alone the engine bands the lot ${num(bandSplit.critical)} CRITICAL · ${num(bandSplit.warning)} WARNING · ${num(bandSplit.healthy)} HEALTHY${
              oldestDays != null ? `, oldest ${num(oldestDays)} days in stock` : ''}. Ageing and the recommendation are different questions and this tile counts the second.`)}`
          : oldestDays != null
            ? `<br>${muted(`No unit is banded WARNING or CRITICAL on age; the oldest has been in stock ${num(oldestDays)} days.`)}`
            : '')
      + (computedAt ? `<br>${muted(`Computed by the Sentinel at ${dubaiStamp(computedAt)}.`)}` : '')
      /* The absence an owner will look for next, said in words. Ageing is
         measured from `days_in_stock`, which the nightly job keeps; there is no
         counterpart for the other end of the unit's life, on the table or in
         the engine. */
      + `<br>${muted('Inventory records no sale date, so this screen cannot show what sold, what it sold for, or how long a sold unit sat on the lot. Days in stock is the only ageing figure the database keeps.')}`;

    strip.innerHTML = dsStatRow([
      dsStat({ label: 'Open leads', value: num(openCount), meta: leadsSub }),
      /* The one number on this screen that maps to a person waiting. */
      dsStat({ label: 'Awaiting first reply', value: num(waiting.length), meta: waitSub,
               intent: waiting.length ? 'danger' : '' }),
      dsStat({ label: respLabel, value: mins(avgResp), meta: respSub }),
      dsStat({ label: 'Pipeline value', value: aed(pipeline), meta: pipeSub }),
      /* `num(null)` is an em dash, and that is the whole point on the error
         branch: the value slot says "not known", the subtitle says why, and
         neither of them says nought. */
      dsStat({ label: 'Units needing a decision', value: sentinelErr ? num(null) : num(needsDecision.length),
               meta: decisionSub,
               intent: sentinelErr || !needsDecision.length ? ''
                 : (worstRisk === 'SEVERE' || worstRisk === 'HIGH' ? 'danger' : 'warning') }),
    ].join(''));

    const seg = [['HOT', hot, '#C8321F'], ['WARM', warm, '#96570A'], ['COLD', cold, '#2563A8']];
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
      ? `<div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5" style="margin-top:6px">${stageRest.map(muted).join('<br>')}</div>`
      : '';
    /* One scored lead paints a full-width bar in one colour, and a full-width
       bar is read as a share before any caption under it is. A caption cannot
       undo that — the shape has already made the claim — so at n=1 the chart is
       not drawn at all and the same fact is stated in a sentence instead. This
       is the one place on the screen where the honest rendering is no chart. */
    const single = graded === 1;
    const onlyStage = single ? (seg.find(([, v]) => v === 1) || [null])[0] : null;
    pipeCard.innerHTML = single
      ? `<div class="font-table-header text-table-header uppercase text-outline tracking-wider font-semibold" style="margin-bottom:12px">Pipeline by stage</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          ${onlyStage ? dsChip(onlyStage, dsIntent(tone(onlyStage))) : ''}
          <span>Exactly one lead has been scored${onlyStage ? `, and it is ${esc(onlyStage)}` : ''}.</span>
        </div>
        <div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5" style="margin-top:10px">${muted('No bar is drawn: one row has no distribution, and a full-width band of one colour would read as a market share of the pipeline. The stage mix reappears here as soon as a second lead is scored.')}</div>
        ${stageRestHtml}`
      : graded
      ? `<div class="font-table-header text-table-header uppercase text-outline tracking-wider font-semibold" style="margin-bottom:12px">Pipeline by stage</div>
        <div class="flex h-3 w-full rounded-full overflow-hidden bg-surface-container">${seg.map(([, v, c]) => `<i class="block h-full" style="width:${(v / graded * 100).toFixed(1)}%;background:${c}"></i>`).join('')}</div>
        <div style="display:flex;gap:20px;margin-top:12px;flex-wrap:wrap">
          ${seg.map(([k, v, c]) => `<div style="display:flex;align-items:center;gap:8px">
            <span style="width:8px;height:8px;border-radius:50%;background:${c}"></span>
            <span style="font-weight:500">${esc(k)}</span><span class="text-outline font-label-numeric-sm">${num(v)} ${plural(v, 'lead', 'leads')}</span></div>`).join('')}
        </div>
        ${stageRestHtml}
        ${graded <= THIN
          /* A full-width bar drawn from one row looks like a market share. It
             is one row, and the caption says so directly under it. */
          ? `<div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5" style="margin-top:10px">${warn(`This bar is ${num(graded)} scored ${plural(graded, 'lead', 'leads')} in total. The proportions are shapes, not shares.`)}</div>`
          : ''}`
      : dsEmpty({ title: 'Nothing to chart yet', name: 'gauge', body:
          leads.length
            ? `${leads.length === 1 ? 'The one lead on file is not' : `None of the ${leads.length} leads on file is`} HOT, WARM or COLD. The router writes that grade when it processes an enquiry, and the stage mix appears here once it has.`
              + (otherStatus.length
                  ? ` That is not the same as unprocessed: ${stageRest[0]}`
                  : '')
            : 'Your leads is empty, so there are no stages to chart. The first row arrives when the router webhook receives an enquiry.' });
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
      say('<span class="text-outline">Opening…</span>');
      const rows = await db(`leads?select=*,users(id,name)&id=eq.${encodeURIComponent(id)}&limit=1`);
      /* Awaited, not fired: the drawer does its own reads, and an unawaited
         rejection would land in the console instead of in the row that was
         clicked. */
      if (rows.length) { say(''); await leadDrawer(rows[0]); }
      else say(`<span class="text-[#96570A]">${esc('That lead is no longer in your leads, so there is nothing to open.')}</span>`);
    } catch (e) {
      say(`<span class="text-error">${esc(`Could not open this lead — ${e.message}`)}</span>`);
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
  const NO_STAFF_PHONE = 'Staff phone numbers are stored nowhere the dashboard can read: the users table has no phone column, so a rep is named but cannot be called from here. Customer numbers below come from the phone number on the lead record and the number saved for this contact, which do exist.';

  /* ── Triage row ─────────────────────────────────────────────────────────── */

  const panels = [];

  /* ── 0 · Where money is leaking ─────────────────────────────────────────
     The Revenue Command Center, and the reason PRODUCT.md gives this screen a
     commercial role rather than a description. Everything on it is a leak with
     a figure, an owner and a link into the screen that can close it.

     FOUR RULES, ALL OF THEM LEARNED FROM SOMETHING THIS FILE GOT WRONG.

     1. A ZERO CHECK IS NOT AN OMITTED CHECK. Every leak this panel knows how to
        find is either a row or a named line in the all-clear sentence at the
        bottom. A check that finds nothing and then says nothing is
        indistinguishable from a check that never ran, and this screen has
        shipped that confusion in six places.

     2. NO HEADLINE TOTAL ACROSS THE WHOLE PANEL. There is no "AED X leaking
        today" number here and there must not be. Margin exposed in a car,
        margin frozen behind an unanswered approval and a lead nobody owns are
        not the same quantity and cannot be added; a single confident figure
        made of the three would be the most sellable sentence on this screen and
        the least true. Each leak carries its own figure, in the engine's own
        units, and the arithmetic stops there.

     3. THE HEALTHY MAJORITY IS PART OF THE ANSWER. Nine of twelve units are LOW
        risk with a HOLD recommendation. A leak panel that lists three cars and
        says nothing about the other nine is technically complete and reads as
        an emergency.

     4. A PARTIAL READ DEGRADES, IT DOES NOT BLANK. The three sections come from
        three independent reads. One failing withholds its own section and says
        so; only losing all three raises to panel()'s error card, where the
        Retry button is. A section that quietly renders nothing would be read as
        "no leaks here". */
  panels.push(panel(leakHost, {
    title: 'Where money is leaking',
    sub: 'Every figure here is one the engine produced, next to the screen that can act on it. '
       + 'Exposure is margin at risk in a car that has not sold — never loss, revenue, savings or recovery',
    actions: `<button type="button" class="${BTN.secondary}" data-act="actions">Open Action Center</button>`,
    load: async () => {
      const readAt = new Date().toISOString();
      /* Settled, not awaited together: each of these answers a different
         section and one failing must not withhold the other two. */
      const [q, att] = await Promise.all([
        readQueue().then(rows => ({ rows, err: null }), e => ({ rows: null, err: e })),
        readAttention().then(v => ({ v, err: null }), e => ({ v: null, err: e })),
      ]);
      /* `core` and `coreErr` are settled before any panel is constructed — the
         core read is awaited above — so reading them here is reading a value,
         not racing one. */
      if (coreErr && q.err && att.err) throw coreErr;
      return { readAt, queue: q.rows, queueErr: q.err,
               threads: att.v ? att.v.threads : null, attItems: att.v ? att.v.items : null,
               attErr: att.err };
    },
    render: ({ readAt, queue, queueErr, threads, attItems, attErr }) => {
      const rows = [];
      /* Checks that came back empty, named one by one. See rule 1. */
      const clear = [];
      const notes = [];

      const row = ({ icon, iconTone, head, badge, lines, right, rightNote, target }) => {
        /* iconTone here is always one of the 'hot'/'warm' tone words a caller
           below states directly — dsIntent() is the same tone→intent map
           dsChip already applies to `badge`, so the glyph and the figure next
           to it agree with the chip beside them rather than carrying their own
           colour vocabulary. */
        const iconIntent = dsIntent(iconTone);
        return `
        <div class="${ROW}" role="button" tabindex="0" data-goto="${esc(target)}"
             title="Open ${esc(target)}" style="align-items:flex-start">
          <span class="material-symbols-outlined ${TXT[iconIntent] || TXT.neutral}" style="font-size:20px">${esc(icon)}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${head}${badge || ''}</div>
            ${lines.filter(Boolean).map(l => `<div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${l}</div>`).join('')}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="font-label-numeric-md ${TXT[iconIntent] || TXT.neutral}" style="font-weight:600;font-size:18px">${right}</div>
            ${rightNote ? `<div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${esc(rightNote)}</div>` : ''}
          </div>
          <span class="material-symbols-outlined text-outline" style="font-size:18px">chevron_right</span>
        </div>`;
      };

      /* ── Inventory ─────────────────────────────────────────────────────
         Straight off rpc/sentinel_inventory_actions(), partitioned in the core
         read. The KPI strip above renders the same object, so the tile and this
         row cannot report two counts of the same twelve cars. */
      if (coreErr) {
        notes.push(`The core read failed (${coreErr.message}), so nothing is claimed here about stock, margin or ageing — not that there is nothing wrong with it.`);
      } else if (core.sentinelErr) {
        notes.push(`The Profit Sentinel could not be read (${core.sentinelErr.message}), so no stock leak is listed above and none is ruled out. This is a question that went unanswered, not a lot with nothing wrong with it.`);
      } else if (!core.sentinel.length) {
        notes.push('The Profit Sentinel returned no units, so there is no stock for it to score. That is an empty lot or a read that matched nothing, and this screen cannot tell those apart.');
      } else if (core.needsDecision.length) {
        const worst = core.worstRisk === 'SEVERE' || core.worstRisk === 'HIGH' ? 'hot' : 'warm';
        rows.push(row({
          icon: 'directions_car', iconTone: worst,
          head: `${num(core.needsDecision.length)} of ${num(core.sentinel.length)} ${plural(core.sentinel.length, 'unit', 'units')} ${plural(core.needsDecision.length, 'needs', 'need')} a pricing or stock decision`,
          badge: core.riskSplit.map(([k, n]) => dsChip(`${n} ${k}`, dsIntent(tone(k)))).join(' '),
          lines: [
            esc(exposureLine(core.exposed, plural(core.needsDecision.length, 'that unit', 'those units'))),
            muted(EXPOSURE_CAVEAT),
            core.noHolding
              ? warn(`How fast it is being eaten is NOT COMPUTABLE on ${num(core.noHolding)} of ${num(core.sentinel.length)} ${plural(core.sentinel.length, 'unit', 'units')} — no holding rate is on record for this dealership, so holding cost and net margin are unknown rather than nil. Enter a sourced rate in Settings and both become figures.`)
              : '',
            /* Why a REPRICE here is a request for a person and not a price. Both
               halves are counted, because "we have no market data" without a
               denominator is a claim nobody can check. */
            (core.noMarket || core.noDemand)
              ? muted(`Market position is UNKNOWN on ${num(core.noMarket)} of ${num(core.sentinel.length)} and demand on ${num(core.noDemand)} of ${num(core.sentinel.length)}. NEXUS therefore names no new price and cannot: a recommendation to reprice is a request for a person to look at the price, not a figure it computed.`)
              : '',
            core.holdUnits.length
              ? muted(`${num(core.holdUnits.length)} further ${plural(core.holdUnits.length, 'unit is', 'units are')} on HOLD — the engine's own word for nothing to do — and ${plural(core.holdUnits.length, 'is', 'are')} not a problem waiting to be found.`)
              : '',
          ],
          right: num(core.needsDecision.length),
          rightNote: `of ${num(core.sentinel.length)} scored`,
          target: 'inventory',
        }));
      } else {
        clear.push(`the engine recommends HOLD on all ${num(core.sentinel.length)} scored ${plural(core.sentinel.length, 'unit', 'units')}, so it is asking for no stock decision today`);
      }

      /* ── Actions outstanding ───────────────────────────────────────────
         v_inventory_action_queue. `is_live`, `awaiting_decision` and
         `deferral_now_due` are the view's own booleans and are read, never
         re-derived from `status` — the view is where that rule lives. */
      if (queueErr) {
        notes.push(`The action queue could not be read (${queueErr.message}), so nothing is claimed about what is waiting on a person. An empty queue and an unread one are not the same thing.`);
      } else {
        const q = queue || [];
        const capped = q.length >= QUEUE_LIMIT;
        const awaiting = q.filter(a => a.awaiting_decision === true);
        /* Approved and not carried out. This is the leak an owner most often
           does not know they have: the decision was made, the money is still
           sitting in the car, and nothing in the building is chasing it. The
           view says it in its own words and they are quoted rather than
           paraphrased — "an approval is a decision, not money". */
        const approvedOpen = q.filter(a => up(a.status) === 'APPROVED' && !a.executed_at);
        const dueAgain = q.filter(a => a.deferral_now_due === true);
        /* Escalated because nobody at this dealership may approve. The column
           comment is explicit that the action stays PROPOSED — an escalation is
           a request for a person, not a decision — so these are counted as
           their own leak and are NOT subtracted from `awaiting`. */
        const escalated = q.filter(a => a.escalated_at);
        const closed = q.filter(a => a.is_live === false);
        const executed = q.filter(a => a.executed_at);
        /* Recovery, partitioned by the EVIDENCE and not by the amount column.
           `n0(a.recovered_value_aed) != null` was a test of one column beneath
           a sentence claiming four ("a recorded sale tied to it by a person"),
           so a row whose columns disagreed was totalled as attributed money.
           recoveryEvidence() is the shared test; UNSUPPORTED rows are pulled
           out and reported as a fault, never added into a figure. */
        const recovery = q.map(a => ({ a, ev: recoveryEvidence(a) }));
        const attributed  = recovery.filter(x => x.ev.state === 'ATTRIBUTED').map(x => x.a);
        const unsupported = recovery.filter(x => x.ev.state === 'UNSUPPORTED');
        const disagreed = q.filter(a => a.engine_still_agrees === false);

        if (awaiting.length) {
          const t = expose(awaiting, a => a.engine_impact_aed, a => a.engine_impact_kind);
          const oldest = awaiting.reduce((a, b) => (Date.parse(b.proposed_at) < Date.parse(a.proposed_at) ? b : a), awaiting[0]);
          rows.push(row({
            icon: 'pending_actions', iconTone: 'warm',
            head: `${num(awaiting.length)} ${plural(awaiting.length, 'action is', 'actions are')} waiting on a decision`,
            badge: dsChip('Nobody has answered', dsIntent('warm')),
            lines: [
              esc(exposureLine(t, plural(awaiting.length, 'that action', 'those actions'))
                + `. ${plural(awaiting.length, 'That figure is', 'Those figures are')} frozen at what the engine said when ${plural(awaiting.length, 'it was', 'each was')} raised, not recomputed tonight.`),
              /* The engine's own sentence about the cost of waiting, rendered
                 verbatim. It already carries the NOT COMPUTABLE caveat, so
                 restating it here would be this screen writing its own version
                 of a sentence the database owns. */
              str(oldest.cost_of_doing_nothing) ? muted(str(oldest.cost_of_doing_nothing)) : '',
              muted(`Oldest raised ${ago(oldest.proposed_at)}${str(oldest.unit_model) ? ` on the ${str(oldest.unit_model)}` : ''}.`),
            ],
            right: num(awaiting.length),
            rightNote: 'awaiting a person',
            target: 'actions',
          }));
        } else {
          clear.push('no action is waiting on a decision');
        }

        if (approvedOpen.length) {
          const t = expose(approvedOpen, a => a.engine_impact_aed, a => a.engine_impact_kind);
          const oldest = approvedOpen.reduce((a, b) => (Date.parse(b.decided_at || b.proposed_at) < Date.parse(a.decided_at || a.proposed_at) ? b : a), approvedOpen[0]);
          rows.push(row({
            icon: 'task_alt', iconTone: 'hot',
            head: `${num(approvedOpen.length)} approved ${plural(approvedOpen.length, 'action has', 'actions have')} not been carried out`,
            badge: dsChip('Decided, not done', dsIntent('hot')),
            lines: [
              esc(exposureLine(t, plural(approvedOpen.length, 'that unit', 'those units'))),
              str(oldest.outcome_sentence) ? muted(str(oldest.outcome_sentence)) : '',
              muted(`Approved ${ago(oldest.decided_at || oldest.proposed_at)}${str(oldest.decided_by_name) ? ` by ${str(oldest.decided_by_name)}` : ''}${
                str(oldest.assigned_to_name) ? `, assigned to ${str(oldest.assigned_to_name)}`
                : str(oldest.assigned_role) ? `, assigned to the ${str(oldest.assigned_role)} role and to nobody by name`
                : ', and assigned to nobody'}.`),
            ],
            right: num(approvedOpen.length),
            rightNote: 'not yet done',
            target: 'actions',
          }));
        } else {
          clear.push('no approved action is sitting uncarried-out');
        }

        if (escalated.length) {
          rows.push(row({
            icon: 'escalator_warning', iconTone: 'hot',
            head: `${num(escalated.length)} ${plural(escalated.length, 'action was', 'actions were')} escalated because nobody here may approve ${plural(escalated.length, 'it', 'them')}`,
            badge: dsChip('No approver', dsIntent('hot')),
            lines: [
              muted(str(escalated[0].escalation_reason) || 'The database recorded no reason on this escalation.'),
              muted('An escalation is a request for a person, not a decision: these stay PROPOSED and nothing about the unit has changed.'),
            ],
            right: num(escalated.length),
            rightNote: 'need an approver',
            target: 'actions',
          }));
        } else {
          clear.push('nothing has been escalated for want of somebody able to approve it');
        }

        if (dueAgain.length) {
          rows.push(row({
            icon: 'event_repeat', iconTone: 'warm',
            head: `${num(dueAgain.length)} deferred ${plural(dueAgain.length, 'action is', 'actions are')} due again`,
            badge: dsChip('Deferral expired', dsIntent('warm')),
            lines: [muted('Somebody chose to wait and the date they chose has passed. The decision is open again.')],
            right: num(dueAgain.length),
            rightNote: 'due again',
            target: 'actions',
          }));
        } else {
          clear.push('no deferred action has come due');
        }

        /* A unit the engine is asking about that nobody has even been asked
           about. Distinct from "waiting on a decision": there is no record at
           all, so it appears on no queue and nobody is late. This is the leak
           that is invisible everywhere else in the product. */
        if (!coreErr && !core.sentinelErr) {
          const hasAction = new Set(q.map(a => str(a.unit_id)));
          const liveOn = new Set(q.filter(a => a.is_live === true).map(a => str(a.unit_id)));
          const unraised = core.needsDecision.filter(u => !hasAction.has(str(u.id)));
          const answeredStill = core.needsDecision.filter(u => !liveOn.has(str(u.id)) && hasAction.has(str(u.id)));
          if (unraised.length) {
            const t = expose(unraised, u => u.impact_aed, u => u.impact_kind);
            rows.push(row({
              icon: 'help', iconTone: 'warm',
              head: `${num(unraised.length)} ${plural(unraised.length, 'unit the engine is asking about has', 'units the engine is asking about have')} never been put to a person`,
              badge: dsChip('No record', dsIntent('warm')),
              lines: [
                esc(exposureLine(t, plural(unraised.length, 'that unit', 'those units'))),
                muted(`There is no action record for ${plural(unraised.length, 'it', 'them')}, so ${plural(unraised.length, 'it appears', 'they appear')} on no queue and nobody is late answering. Raising one freezes what the engine says today onto a record somebody then answers.`),
              ],
              right: num(unraised.length),
              rightNote: 'never raised',
              target: 'actions',
            }));
          } else if (core.needsDecision.length) {
            clear.push(`every unit the engine is asking about has an action record against it`);
          }
          if (answeredStill.length) {
            notes.push(`${num(answeredStill.length)} ${plural(answeredStill.length, 'unit', 'units')} the engine still recommends acting on ${plural(answeredStill.length, 'has', 'have')} already been answered and closed — a person decided, and that decision is the record. It is not counted as outstanding above.`);
          }
        }

        /* Recovery. Rendered every time, whether or not anything is attributed,
           because this is the sentence the whole product is most tempted to
           get wrong. `recovered_value_aed` is null on every row on this box and
           null is not zero: the column comment says a missing outcome is a
           state with a reason, and the view spells that reason out per row.

           The total below is built from `attributed` only, which now means the
           rows that carry outcome_state ATTRIBUTED, a linked purchase, an
           attribution basis and a value basis — not the rows that merely carry
           a number. The words "a recorded sale tied to it by a person" are
           therefore a description of the filter and not a hope about it. */
        if (attributed.length) {
          const t = expose(attributed, a => a.recovered_value_aed, () => 'ATTRIBUTED_MARGIN');
          notes.push(`${num(attributed.length)} of ${num(q.length)} ${plural(q.length, 'action', 'actions')} ${plural(attributed.length, 'has', 'have')} a recorded sale tied to ${plural(attributed.length, 'it', 'them')} by a person: ${aed(t.total)} of realised gross margin, ATTRIBUTED and not confirmed as caused. NEXUS does not claim the action produced the sale.`);
        } else if (q.length) {
          notes.push(`No action has an attributed outcome. Recovered value is not zero on ${num(q.length)} ${plural(q.length, 'action', 'actions')} — it is not recorded, and it stays that way until a person ties a real recorded sale to a unit, which today they must do by hand because the recorded sales carries no reference to an inventory unit at all.`);
        }
        /* A row carrying an amount the evidence does not support. The database
           CHECK inventory_actions_recovered_needs_real_sale makes it unstorable,
           so one arriving here means something upstream is wrong. It is stated
           and the amount is withheld: reporting the count without the figure is
           the only way to say "this is broken" without repeating the fabricated
           claim while doing so. */
        if (unsupported.length) {
          notes.push(`${num(unsupported.length)} ${plural(unsupported.length, 'action carries', 'actions carry')} a recovered amount with no evidence behind ${plural(unsupported.length, 'it', 'them')}, and ${plural(unsupported.length, 'that amount is', 'those amounts are')} not shown and not counted anywhere above. ${unsupportedRecoverySentence(unsupported[0].ev)} Action Center names ${plural(unsupported.length, 'the row', 'each row')}.`);
        }
        if (executed.length) {
          notes.push(`${num(executed.length)} ${plural(executed.length, 'action has', 'actions have')} been marked carried out. Whether ${plural(executed.length, 'it', 'they')} produced anything is the separate question above.`);
        }
        if (closed.length) {
          notes.push(`${num(closed.length)} ${plural(closed.length, 'action is', 'actions are')} closed — rejected, withdrawn or already carried out — and ${plural(closed.length, 'is', 'are')} not counted as outstanding.`);
        }
        if (disagreed.length) {
          notes.push(`${num(disagreed.length)} open ${plural(disagreed.length, 'action no longer matches', 'actions no longer match')} what the engine recommends for that unit today. The figures above are the ones frozen when each was raised; Action Center shows both side by side.`);
        }
        if (!q.length) {
          notes.push('No action has ever been recorded against a unit. The engine has been recommending and nobody has answered it yet — which is a state, not a clean sheet.');
        }
        if (capped) {
          notes.push(`The action queue read was capped at ${num(QUEUE_LIMIT)} rows, so the counts above are a floor.`);
        }
      }

      /* ── Leads and silence ─────────────────────────────────────────────
         THE COUNT THIS SECTION REFUSES TO PRINT is the row count of the leads
         table. See the header of this file: two of the three rows on this box
         are wrong numbers the router auto-created from uncaptioned WhatsApp
         images, and they carry that diagnosis on the row. "3 leads" is true and
         sells a lead flow that does not exist. What is counted here is OPEN
         enquiries, with the closed ones named and the reason given, and the
         sample size stated in words wherever a rate could be read into it. */
      if (coreErr) {
        notes.push('The leads read failed, so nothing is claimed here about response, ownership or reply gaps.');
      } else {
        if (core.openUnassignedCount) {
          rows.push(row({
            icon: 'person_alert', iconTone: 'warm',
            head: `${num(core.openUnassignedCount)} open ${plural(core.openUnassignedCount, 'enquiry has', 'enquiries have')} no rep on the record`,
            badge: dsChip('Unowned', dsIntent('warm')),
            lines: [
              muted(`Of ${num(core.openCount)} open ${plural(core.openCount, 'enquiry', 'enquiries')} in the table. An enquiry with no owner is nobody's to follow up, whatever its grade — this is not the view's HOT-only unassigned check and the two counts are not the same number.`),
              core.terminalCount
                ? muted(`${num(core.terminalCount)} further ${plural(core.terminalCount, 'row is', 'rows are')} closed (${core.terminalNames.join(', ')}) and ${plural(core.terminalCount, 'is', 'are')} not counted: a closed enquiry needs no owner.`)
                : '',
              core.openCount <= THIN
                ? warn(`${num(core.openCount)} open ${plural(core.openCount, 'enquiry is a record', 'enquiries are records')}, not a pipeline. Nothing on this line is a rate and none of it says anything about how this dealership performs.`)
                : '',
            ],
            right: num(core.openUnassignedCount),
            rightNote: `of ${num(core.openCount)} open`,
            target: 'leads',
          }));
        } else if (core.openCount) {
          clear.push(`all ${num(core.openCount)} open ${plural(core.openCount, 'enquiry has', 'enquiries have')} a rep on the record`);
        } else {
          clear.push('no enquiry in the table is still open, so none is waiting on an owner');
        }

        if (core.bridgeOk && core.waiting.length) {
          rows.push(row({
            icon: 'mark_email_unread', iconTone: 'hot',
            head: `${num(core.waiting.length)} open ${plural(core.waiting.length, 'enquiry has', 'enquiries have')} had no reply since ${plural(core.waiting.length, 'it', 'they')} arrived`,
            badge: dsChip('No reply sent', dsIntent('hot')),
            lines: [
              muted(`Out of ${num(core.testedCount)} open ${plural(core.testedCount, 'enquiry', 'enquiries')} from the last ${WINDOW_DAYS} days that could be checked against the message history. The oldest arrived ${ago(core.waiting[0].created_at)}.`),
              core.untestable ? warn(`${num(core.untestable)} could not be checked at all and ${plural(core.untestable, 'is', 'are')} in neither figure.`) : '',
            ],
            right: num(core.waiting.length),
            rightNote: `of ${num(core.testedCount)} checked`,
            target: 'leads',
          }));
        } else if (!core.bridgeOk) {
          notes.push(`The reply-gap check did not run. ${bridgeWhy(core.contactsErr, core.contactsCapped)} No enquiry is being claimed as answered or unanswered.`);
        } else if (core.testedCount) {
          clear.push(`all ${num(core.testedCount)} open ${plural(core.testedCount, 'enquiry', 'enquiries')} from the last ${WINDOW_DAYS} days that could be checked ${plural(core.testedCount, 'has', 'have')} a reply after ${plural(core.testedCount, 'it', 'they')} arrived`);
        }

        /* SLA, stated as a partition and never as a percentage. Two measured
           leads is not a response-time record, and the unmeasured ones are
           reported as unmeasured — a null response_time_minutes means nobody
           timed that enquiry, NOT that nobody answered it. */
        if (core.slaBreached) {
          rows.push(row({
            icon: 'timer', iconTone: 'hot',
            head: `${num(core.slaBreached)} of ${num(core.withResp.length)} timed ${plural(core.withResp.length, 'enquiry', 'enquiries')} ${plural(core.slaBreached, 'breached', 'breached')} the five-minute rule`,
            badge: dsChip('SLA breach', dsIntent('hot')),
            lines: [
              core.noResponseTime ? warn(`${num(core.noResponseTime)} further ${plural(core.noResponseTime, 'enquiry has', 'enquiries have')} no recorded response time. That is unmeasured, not compliant, and ${plural(core.noResponseTime, 'it is', 'they are')} in neither figure.`) : '',
              core.withResp.length <= THIN ? warn(`${num(core.withResp.length)} ${plural(core.withResp.length, 'measurement is', 'measurements are')} not a response-time record.`) : '',
            ],
            right: num(core.slaBreached),
            rightNote: `of ${num(core.withResp.length)} timed`,
            target: 'leads',
          }));
        } else if (core.withResp.length) {
          clear.push(`none of the ${num(core.withResp.length)} timed ${plural(core.withResp.length, 'enquiry', 'enquiries')} breached the five-minute rule`
            + (core.noResponseTime ? ` — though ${num(core.noResponseTime)} further ${plural(core.noResponseTime, 'row carries', 'rows carry')} no recorded response time and ${plural(core.noResponseTime, 'is', 'are')} unmeasured rather than compliant` : ''));
        } else if (core.leads.length) {
          notes.push(`No enquiry on file carries a recorded response time, so nothing is claimed about the five-minute rule in either direction.`);
        }
      }

      /* ── Silence ───────────────────────────────────────────────────────
         v_conversations, via the shared attention read. `identified` is what
         decides whether a waiting thread is a person we know: 'lead' is the
         only value that means we hold a record for them, and the rest are the
         weaker thing they are. A count of waiting threads is honest; calling
         them customers is not, and on this box not one of them resolves to a
         lead. That distinction is the whole of this row. */
      if (attErr || !threads) {
        notes.push('NEXUS did not load, so waiting WhatsApp threads could not be counted. That is a missing read, not a quiet inbox.');
      } else if (threads.length) {
        const known = threads.filter(t => str(t.identified) === 'lead').length;
        const inWindow = (attItems || []).filter(i => i.kind === 'unanswered_chat').length;
        rows.push(row({
          icon: 'mark_chat_unread', iconTone: 'hot',
          head: `${num(threads.length)} WhatsApp ${plural(threads.length, 'thread is', 'threads are')} waiting on a reply`,
          badge: known ? dsChip(`${known} identified`, dsIntent('ok')) : dsChip('None identified', dsIntent('warm')),
          lines: [
            attItems
              ? muted(`${num(inWindow)} of them fall inside the ${CHAT_WINDOW_DAYS}-day window Needs attention uses; the rest are older and appear only on Conversations.`)
              : '',
            known === 0
              ? warn(`Not one of these threads resolves to a lead record — every one is identified only by the name its owner typed into their own WhatsApp profile. So this is ${num(threads.length)} ${plural(threads.length, 'conversation', 'conversations')} nobody has answered, and NEXUS cannot say which of them, if any, is a customer enquiry.`)
              : muted(`${num(known)} of ${num(threads.length)} ${plural(known, 'resolves', 'resolve')} to a lead record; the rest are identified only by a WhatsApp profile name, so nothing is claimed about who they are.`),
          ],
          right: num(threads.length),
          rightNote: 'awaiting a reply',
          target: 'conversations',
        }));
      } else {
        clear.push('no WhatsApp thread is waiting on a reply');
      }

      /* Read once, said first, because it governs everything above it. */
      notes.unshift(`Read once at ${clock(readAt)}, when this screen opened. Nothing on this screen refreshes on a timer, so a leak closed since then is still listed and one opened since then is not — reopen Overview for a fresh read.`);
      if (!coreErr && !core.sentinelErr && core.defaultSettings) {
        notes.push('The Sentinel is running on its default thresholds for this dealership, not on figures they supplied. The ageing bands come from the nightly job the database already runs; the promote, wholesale and margin-floor days are chosen defaults and are marked as chosen, not measured, in the database.');
      }
      notes.push('There is no single "total leaking" figure on this panel and there will not be one. Margin exposed in a car, an approval nobody has acted on and an enquiry nobody owns are three different quantities; adding them would produce a number that is nowhere in the database.');

      const clearLine = clear.length
        ? `<div class="${ROW_STILL}">
             <span class="material-symbols-outlined text-[#157A5B]" style="font-size:20px">check_circle</span>
             <div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5" style="white-space:normal">${esc(`Checked and clear right now: ${clear.join('; ')}.`)} ${
               esc('Each of these ran and found nothing — that is not the same as a check this panel does not make.')}</div>
           </div>`
        : '';
      const foot = `<div class="${ROW_STILL}">
        <span class="material-symbols-outlined text-outline" style="font-size:18px">info</span>
        <div class="min-w-0 flex-1">${note(notes.map(x => `<p>${esc(x)}</p>`).join(''), `How to read this panel — ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`)}</div></div>`;

      if (!rows.length) {
        /* 'savings' is not in the design system's small icon set (lib/icons.js)
           — 'coins' is the nearest it has. */
        return dsEmpty({ title: 'No leak this screen can measure is open', name: 'coins', body:
          'Every check this panel makes came back empty. It measures inventory decisions, the action queue, lead ownership, reply gaps, response time and waiting WhatsApp threads — and nothing else, so this is not a statement about the parts of the business NEXUS cannot see.' }) + clearLine + foot;
      }
      return `<div>${rows.join('')}${clearLine}${foot}</div>`;
    },
  }).then(card => {
    card.querySelector('[data-act]')?.addEventListener('click', () => go('actions'));
    wireGoto(card);
  }));

  /* ── Revenue Recovery, in three figures ──────────────────────────────────
     Added 3 Sep 2026 alongside screens/revenue.js, and rendered directly BELOW
     the leak panel (recoveryHost is appended after leakHost). That panel
     measures inventory decisions, the action queue, lead ownership, reply gaps,
     response time and waiting threads — and says so in its own empty state.
     These three figures are the questions it does not ask, because they belong
     to the lead recovery, deal rescue and attribution engines rather than to it.

     ALL THREE READ ZERO TODAY, WHICH IS WHY THEY ARE HERE. A panel that only
     ever shows non-zero rows teaches an operator that silence means nothing was
     checked; a stated zero is a check that ran and came back clear, and it is
     what makes the non-zero rows above it believable.

     Two aggregate reads, neither recomputed from anything else on this screen.
     Nothing here is added to anything in the leak panel: that one measures
     margin sitting inside unsold stock, these measure customers and sales, and
     the two are not the same quantity. The full page is one click away, and
     every claim wider than these two reads belongs on it rather than here. */
  panels.push(panel(recoveryHost, {
    title: 'Revenue Recovery',
    sub: 'The three questions the panel above does not ask, because they belong to the lead, deal and '
       + 'attribution engines rather than to inventory',
    actions: `<button type="button" class="${BTN.secondary}" data-act="revenue">Open Revenue Recovery</button>`,
    load: async () => {
      const [cov, inFlight] = await Promise.all([
        db('v_lead_recovery_coverage?select=*'),
        db('v_deal_rescue?select=lead_id&limit=200'),
      ]);
      return { c: cov[0] || null, inFlight };
    },
    render: ({ c, inFlight }) => {
      if (!c) {
        return dsEmpty({ title: 'The Lead Recovery coverage view returned no row', name: 'coins', body:
          'It reports one row per dealership, so an empty answer means this account matched none of them. No count is '
          + 'shown rather than a zero, because a zero here would read as a finding about the business.' });
      }
      /* Each caption states the denominator its figure came out of, and each is
         written for the branch it sits in — the zero wording and the non-zero
         wording are separate strings, not one sentence with a number in it. */
      return `<div class="grid grid-cols-1 gap-space-sm p-space-md">${[
        dsStat({ label: 'Leads at risk', value: num(c.leads_at_risk),
          meta: `<div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${esc(n0(c.leads_at_risk)
            ? `Of ${num(c.leads_total)} scored. Each one is listed on Revenue Recovery with its evidence.`
            : `Of ${num(c.leads_total)} scored, and ${num(c.leads_risk_unknown)} whose risk could not be determined. `
              + 'No measurable recovery opportunity is currently detected: the engine scored every lead and flagged '
              + 'none. Its reason for each is on Revenue Recovery.')}</div>`,
          intent: n0(c.leads_at_risk) ? 'danger' : '' }),
        dsStat({ label: 'Deals in flight', value: num(inFlight.length),
          meta: `<div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${esc(inFlight.length
            ? 'Deals the rescue engine is tracking. Each is ranked by what it is stuck on.'
            : 'No deal record exists while a deal is in progress — the sale record is written at the moment of sale — '
              + 'so this engine has nothing to rank. A gap in the schema, not a quiet sales floor.')}</div>`,
          intent: inFlight.length ? 'danger' : '' }),
        dsStat({ label: 'Sales linked to a recovery action', value: num(c.sales_attributed_to_a_recovery_action),
          meta: `<div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${esc(n0(c.sales_attributed_to_a_recovery_action)
            ? `Of ${num(c.leads_with_a_confirmed_sale)} confirmed on file.`
            /* Scoped to what this panel actually read — the lead recovery lane.
               Whether ANY lane has attributed an outcome is a wider claim than
               these two queries support, and it is made on Revenue Recovery,
               which reads both lanes. */
            : `${num(c.leads_with_a_confirmed_sale)} confirmed ${Number(c.leads_with_a_confirmed_sale) === 1 ? 'sale is' : 'sales are'} `
              + `on file (${aed(c.confirmed_revenue_aed)}), and none is linked to a recovery action. `
              + 'Confirmed is not attributed.')}</div>` }),
      ].join('')}</div>`;
    },
  }).then(card => {
    card.querySelector('[data-act]')?.addEventListener('click', () => go('revenue'));
  }));

  /* 1 · Leads nobody has replied to. */
  panels.push(panel(replyHost, {
    title: 'No reply sent',
    sub: `Open leads created in the last ${WINDOW_DAYS} days with no outbound message in the message history sent after they arrived. A message counts for a lead when it is filed under any key that lead resolves to — NEXUS’s identity rules, the same last-nine-digit rule the workflows used to write those keys. Internal markers do not count as a reply, and closed leads are not listed`,
    actions: `<button type="button" class="${BTN.secondary}" data-act="leads">Open Leads</button>`,
    load: async () => requireCore(),
    render: d => {
      const noPhone = d.waiting.filter(l => !str(l.phone)).length;
      const notes = [
        d.untestable
          ? `${num(d.untestable)} of the ${num(d.recentCount)} leads in this window could not be checked at all${d.unkeyed ? ` — ${num(d.unkeyed)} of them ${plural(d.unkeyed, 'carries', 'carry')} no address, no phone number and no chat id, so there is nothing to match ${plural(d.unkeyed, 'it', 'them')} to the message history on` : ''}. They are neither listed above nor counted as answered.`
          : '',
        d.recentTerminal
          ? `${num(d.recentTerminal)} lead${d.recentTerminal === 1 ? '' : 's'} in this window ${plural(d.recentTerminal, 'is', 'are')} already closed — won, lost or disqualified — and ${plural(d.recentTerminal, 'is', 'are')} not listed as waiting for a reply.`
          : '',
        /* The markers exist because nobody replied, and they used to be read as
           proof that somebody had. Counted rather than silently dropped: two
           rows disappearing from a join is the kind of thing that should be
           visible on the screen that depends on it. */
        d.internalMarkers
          ? `${num(d.internalMarkers)} outbound row${d.internalMarkers === 1 ? '' : 's'} in this window ${plural(d.internalMarkers, 'is', 'are')} an internal row rather than a message to a customer. A message is on whatsapp, email or sms and does not begin with one of this system's own markers, [system] or [SILENCE- — which is NEXUS’s own test for what counts as a message in the database, mirrored in this browser and applied here unchanged. The silence detector writes such a row when a thread has gone quiet; it exists because nobody replied, so ${plural(d.internalMarkers, 'it is', 'they are')} not counted as a reply.`
          : '',
        /* How incomplete this panel's join is, measured on the join's own
           output. Until 1 Sep 2026 this counted `isHandle(lead_email)` — a key
           SHAPE — and that regex has no `@whatsapp.lead` branch, so on the live
           database it printed 5 where the true unmatchable count was 11. It is
           now the number of replies no lead claimed, which is the same quantity
           the sentence has always been trying to name and cannot drift from the
           matching rule because it is that rule's output. */
        d.unmatchedReplies
          ? `${num(d.unmatchedReplies)} of the ${num(d.outboundCount)} outbound messages read in this window could not be matched to any lead. ${d.bridgeOk
              ? 'They belong to WhatsApp threads with no lead record behind them. A lead answered on such a thread before it was identified would still be listed above as unanswered.'
              : 'Some of those threads do have a lead behind them — without the saved contact details bridge this screen cannot tell which, so this number is larger than it would otherwise be.'}`
          : '',
        d.outboundCapped ? `Outbound history was capped at ${num(OUTBOUND_LIMIT)} messages for this window, so this list may be incomplete.` : '',
        !d.bridgeOk ? `${bridgeWhy(d.contactsErr, d.contactsCapped)} The check above was withheld rather than run without it — a lead whose whole conversation is filed under a @lid would otherwise be named here as never answered.` : '',
        d.testedCount && d.testedCount <= THIN ? `Only ${num(d.testedCount)} ${plural(d.testedCount, 'lead', 'leads')} in this window could be checked, so an empty list here is a very small sample.` : '',
        noPhone ? `${num(noPhone)} of these ${plural(noPhone, 'lead has', 'leads have')} no phone number on the lead record, so ${plural(noPhone, 'it', 'they')} can only be answered by email.` : '',
        d.waiting.length ? NO_STAFF_PHONE : '',
      ].filter(Boolean);
      const foot = notes.length
        ? `<div class="${ROW_STILL}"><span class="material-symbols-outlined text-outline" style="font-size:18px">info</span>
             <div class="min-w-0 flex-1">${note(notes.map(x => `<p>${esc(x)}</p>`).join(''), `How to read this panel — ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`)}</div></div>`
        : '';
      if (!d.waiting.length) {
        /* The headline names the cohort it is about. "Every lead has been
           answered" over a set that excluded the untested ones is the same
           overclaim the KPI strip was making, one panel down. */
        /* 'mark_email_read' is not in the design system's icon set; 'check' is
           the nearest — every branch here is a form of "nothing outstanding",
           whether because everyone was answered or because there was nothing
           to check, so one settled-looking glyph fits all four. */
        return dsEmpty({
          title: !d.bridgeOk ? 'This check could not be run'
            : d.testedCount ? 'Every lead we could check has been answered'
            : d.recentCount ? 'No lead in this window could be checked'
              : 'No leads in this window',
          name: 'check',
          body: !d.bridgeOk
            ? 'An empty list here would be an all-clear over a check that never ran, so nothing is claimed either way. The note below says what could not be read.'
            : d.testedCount
            ? `All ${d.testedCount} open ${plural(d.testedCount, 'lead', 'leads')} created in the last ${WINDOW_DAYS} days that could be checked ${plural(d.testedCount, 'has', 'have')} an outbound message filed under one of the keys ${plural(d.testedCount, 'it resolves', 'they resolve')} to, sent after ${plural(d.testedCount, 'it', 'they')} arrived.`
            : d.recentCount
              ? `${d.recentCount} ${plural(d.recentCount, 'lead was', 'leads were')} created in the last ${WINDOW_DAYS} days and none of them could be matched to the message history, so this list is empty for want of evidence rather than because everyone was answered.`
              : `No lead was created in the last ${WINDOW_DAYS} days, so there is nothing to answer.`,
        }) + foot;
      }
      const shown = d.waiting.slice(0, 8);
      return `<div>${shown.map(l => `
        <div class="${ROW}" role="button" tabindex="0" data-lead="${esc(l.id)}"
             title="Open this lead" style="align-items:flex-start">
          ${rawChip(l.status || 'Unscored', !!l.status)}
          <div style="flex:1;min-width:0">
            <div style="font-weight:500;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
              <span>${esc(str(l.name) ? displayName(str(l.name), l.id) : 'Unnamed lead')}</span>
              ${str(l.phone)
                ? `<span class="font-label-numeric-sm text-[12px] text-on-surface-variant">${esc(maskText(str(l.phone)))}</span>`
                : `<span class="font-body-sm text-[12px] text-[#96570A] mt-0.5" title="The router captured no phone number for this lead. The phone number on the lead record is empty on this row.">No phone on the lead</span>`}
            </div>
            <div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${esc(str(l.vehicle_interest) || 'No vehicle recorded')}${str(l.source) ? ' · ' + esc(str(l.source)) : ''}</div>
            <div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5" aria-live="polite" data-leadmsg></div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="text-error">${esc(ago(l.created_at))}</div>
            <div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${str(l.assigned_to)
              ? esc(str(l.assigned_to))
              : l.assigned_to_id ? 'assigned' : '<span class="text-[#96570A]">unassigned</span>'}</div>
          </div>
        </div>`).join('')}
        ${d.waiting.length > shown.length
          ? `<div class="${ROW_STILL}"><div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${num(d.waiting.length - shown.length)} more waiting — see Leads</div></div>`
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
    actions: `<button type="button" class="${BTN.secondary}" data-act="automation">Open Automation</button>`,
    load: () => readHealth(),
    render: rows => {
      if (!rows.length) {
        /* 'task_alt' is not in the design system's icon set; 'check' is nearest. */
        return dsEmpty({ title: 'No workflow is degraded', name: 'check', body:
          'Nothing failed, went out half-done or produced nothing usable in the last 30 days. Workflows that do not write to the audit log cannot report health at all — Automation lists those separately.' });
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
        `A row here means a run failed, went out half-done or produced nothing usable inside the 30-day window the automation health figures are computed over. All-time failures are not used: they would keep a workflow that was fixed in June red forever. What each status means is decided in one place — public.nexus_outcome_class(), mirrored in NEXUS — and never on this screen.`,
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
          failing:   { name: 'error',   cls: 'text-error' },
          stale:     { name: 'history', cls: 'text-[#96570A]' },
          recovered: { name: 'history', cls: 'text-outline' },
          unknown:   { name: 'help',    cls: 'text-outline' },
        };
        const icon = ICONS[st.key] || ICONS.unknown;
        const NUM_CLS = { failing: 'text-error', stale: 'text-[#96570A]', recovered: 'text-outline', unknown: 'text-outline' };
        const outcomes = eff == null || eff <= 0
          ? muted('No run in this window counted toward a rate: every one of them was refused by design or handed to a person on purpose.')
          : muted(`${num(succ)} of ${num(eff)} qualifying ${plural(eff, 'run', 'runs')} succeeded outright (${pct(rate)})`
              + (parts ? ` · ${num(parts)} went out half-done` : '')
              + (nores ? ` · ${num(nores)} produced nothing usable` : '')
              + (unk ? ` · ${num(unk)} carry a status this system does not define` : '')
              + (rej ? ` · ${num(rej)} refused by design, not counted` : '')
              + (esc30 ? ` · ${num(esc30)} escalated to a person, not counted` : ''));
        return `<div class="${ROW}" role="button" tabindex="0" data-goto="automation"
             title="Open Automation, where this workflow's runs and failures are" style="align-items:flex-start">
          <span class="material-symbols-outlined ${icon.cls}" style="font-size:20px">${icon.name}</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-weight:500">${esc(w.name)}</span>
              <span title="${esc(hw.blurb)}">${dsChip(hw.label, dsIntent(hw.tone))}</span>
              ${w.is_active === false ? dsChip('Inactive', dsIntent('cold')) : ''}
            </div>
            <div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${esc(w.category || 'Uncategorised')}${w.last_incomplete ? ' · last bad run ' + esc(ago(w.last_incomplete)) : ''}${
              scarce ? ' · <span class="text-[#96570A]">too few runs in 30 days to rate</span>' : ''}</div>
            <div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${st.text}</div>
            <div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${outcomes}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="font-label-numeric-md ${NUM_CLS[st.key] || 'text-outline'}" style="font-weight:500"
                 title="Runs in the last 30 days that did not succeed outright: failures, half-done runs, runs that produced nothing usable, and any status this system does not define. Runs refused by design and runs escalated to a person are excluded from both halves.">${num(notClean)}</div>
            <div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${eff == null ? 'did not succeed' : `of ${num(eff)} that counted`}</div>
          </div>
        </div>`;
      }).join('')}<div class="${ROW_STILL}">
        <span class="material-symbols-outlined text-outline" style="font-size:18px">info</span>
        <div class="min-w-0 flex-1">${note(notes.map(x => `<p>${esc(x)}</p>`).join(''), `How to read this panel — ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`)}</div></div></div>`;
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
    actions: `<button type="button" class="${BTN.secondary}" data-act="compliance">Open Compliance</button>`,
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

      /* How many PEOPLE these gaps belong to, and therefore a question about
         identity rather than about strings. `lower(lead_email)` was the rule
         until 1 Sep 2026 and it is the same one the reply analysis was carrying:
         kyc_documents.lead_email is the same free-text column as
         communication_logs.lead_email, so one person filed once under a real
         address and once under a `@lid` counted as two contacts and the note
         below said the trail was spread across the book when it was not.
         normalizeKey() collapses the phone-derived shapes onto the last nine
         digits; the name is kept as the fallback for a row with no usable key
         at all, which is what it always was. Latent today either way —
         kyc_documents held 0 rows on 1 Sep 2026, counted live — so this is a
         wrong rule removed before its first document, not a wrong number
         corrected. Bridging a `@lid` here would need a whatsapp_contacts read
         this panel does not make; that is a narrower rule than the reply
         analysis uses, and it is narrower in the direction of splitting one
         person into two rather than merging two people into one. */
      const keyOf = r => normalizeKey(r.lead_email).canonical || str(r.lead_name).toLowerCase();
      const contactKeys = [...new Set(live.map(keyOf).filter(Boolean))];
      const contacts = contactKeys.length;
      /* Where every gap belongs to one person, name them. "All 8 belong to 1
         contact" leaves an owner to go and find out who; the address is already
         in the rows being counted. */
      /* Named from the row, never from `contactKeys` — those are canonical
         forms now (`email:…`, `phone:<last 9>`, `lid:<digits>`), which is the
         right thing to COUNT on and the wrong thing to show a person. */
      const soleContact = contacts === 1
        ? (str(live[0].lead_name) || str(live[0].full_name) || str(live[0].lead_email))
        : '';

      const notes = [
        voided.length
          ? `${num(voided.length)} further ${plural(voided.length, 'row has', 'rows have')} no stored file but ${plural(voided.length, 'carries', 'carry')} a void_reason — ${plural(voided.length, 'it was', 'they were')} never a KYC submission, so ${plural(voided.length, 'it is', 'they are')} not counted as an audit gap here. Compliance shows ${plural(voided.length, 'it', 'them')} in full.`
          : '',
        !att
          ? 'Needs attention did not load, so these could not be cross-checked against the attention list.'
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
        live.length ? 'The ID documents stores no phone number, so these contacts are shown by the address the submission was filed under. Their number, if there is one, is on the lead record in Leads.' : '',
      ].filter(Boolean);

      const foot = `<div class="${ROW_STILL}">
          <span class="material-symbols-outlined text-outline" style="font-size:18px">info</span>
          <div class="min-w-0 flex-1">${note(notes.map(x => `<p>${esc(x)}</p>`).join('') + `<p>${esc('Repairing these is NEXUS’s to do. There is also nothing here to open: this dashboard can open a stored document, but no archived file was ever recorded for any row in this list — the missing file is the gap.')}</p>`, `How to read this panel — ${notes.length + 1} notes`)}</div>
        </div>`;

      if (!live.length) {
        /* 'inventory_2' is not in the design system's icon set; 'shield' is
           the nearest — this card's subject is a compliance archive gap. */
        return dsEmpty({
          title: voided.length ? 'No genuine submission is missing its file' : 'Every audited document is archived',
          name: 'shield',
          body: voided.length
            ? `The ${voided.length} ${plural(voided.length, 'row', 'rows')} here with no stored file ${plural(voided.length, 'was', 'were')} voided as ${plural(voided.length, 'a non-submission', 'non-submissions')}. Rows already purged on schedule are not counted either.`
            : 'No KYC row is missing its stored file. Rows already purged on schedule are not counted here.',
        }) + foot;
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
        <div class="${ROW}" role="button" tabindex="0" data-goto="compliance"
             title="Open Compliance, where this document's audit trail is" style="align-items:flex-start">
          <span class="material-symbols-outlined text-[#96570A]" style="font-size:20px">folder_off</span>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-weight:500">${esc(maskText(str(d.lead_name) || str(d.full_name) || str(d.lead_email) || 'Unknown contact'))}</span>
              ${d.verdict ? rawChip(d.verdict, true) : ''}
            </div>
            <div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${esc(str(d.document_type) || 'No document type recorded')} · audited ${esc(ago(d.created_at))}${
              attempt != null ? ' · attempt ' + esc(num(attempt)) + (maxAttempt != null ? ' of ' + esc(num(maxAttempt)) : '') : ''}${
              d.retain_until ? ' · retain until ' + esc(d.retain_until) : ''}</div>
            <div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${str(d.lead_email)
              ? `<span class="font-label-numeric-sm text-[12px]">${esc(maskText(str(d.lead_email)))}</span>`
              : '<span class="text-[#96570A]">No address on the submission</span>'}</div>
          </div>
          <button type="button" class="${BTN.secondary}" disabled
            title="Re-archiving is not something this dashboard can start. The documents and the store they live in are NEXUS’s to write, and there is nothing here that can re-run the archive step. Ask NEXUS support.">Re-archive</button>
        </div>`;
      }).join('')}${rest > 0
        ? `<div class="${ROW_STILL}"><div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${esc(`${num(rest)} older ${plural(rest, 'gap is', 'gaps are')} not listed here — all ${num(live.length)} are counted above and every one of them is in Compliance.`)}</div></div>`
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
    /* The `blank` sentence used to end "— the age is in the detail above", and
       on 2 Sep 2026 that became a caption asserting the opposite of its own
       branch. The view builds this item's detail as
       `days_in_stock || ' days in stock · AED ' || to_char(holding_cost_accrued, …)`,
       and Postgres concatenation with NULL yields NULL — so the moment
       `inventory.holding_cost_accrued` was nulled (the un-sourced AED 50/day
       rate was withdrawn), the whole detail string went null and the row
       rendered an empty detail under a sentence pointing at it. The pointer is
       gone; what replaces the detail is the Sentinel's own figures, and the row
       says which of the two it is showing. */
    inventory_aging:  { none: true, blank: 'the view timestamps this kind with the moment the query ran, so there is no waiting time here to show' },
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
    sub: `Union of the attention list — unanswered WhatsApp threads first, then unassigned HOT leads, SLA breaches, KYC archive gaps, workflow failures, undercuts and aging stock. The view bounds two of these itself: unanswered threads to ${CHAT_WINDOW_DAYS} days and SLA breaches to ${SLA_WINDOW_DAYS}, so this is what is still open, not everything that ever slipped`,
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
         that opens that record rather than the screen it lives on.

         The fallback index used to be `lower(leads.email)`, which is the same
         private rule the reply analysis was carrying and was fixed on 1 Sep
         2026: it cannot match a ref that arrives as a chat id, and on the live
         data it holds `+971547484167@whatsapp.lead` as if it were an address
         while lead 35's empty email produces no entry at all. It is the
         canonical index now — the same one the reply analysis matches on, built
         once in the core read — so a ref in any of the four key shapes resolves
         to the lead it belongs to. `screens/leads.js:436` does exactly this.
         In practice the view keys both of these kinds on `l.id::text`, so the id
         lookup is the hit; this is the fallback, and a wrong fallback is still
         a wrong rule waiting for the view to change. */
      const leadById = new Map(), leadByCanon = new Map();
      (core?.leads || []).forEach(l => {
        leadById.set(str(l.id), l);
        for (const k of (core.canonOf.get(String(l.id)) || [])) {
          if (!leadByCanon.has(k)) leadByCanon.set(k, l);
        }
      });
      const LEAD_KINDS = new Set(['lead_unassigned', 'sla_breach']);
      const leadFor = it => (LEAD_KINDS.has(it.kind)
        ? leadById.get(str(it.ref)) || leadByCanon.get(normalizeKey(it.ref).canonical) || null
        : null);

      const byChat = new Map();
      (threads || []).forEach(t => { const k = str(t.chat_id); if (k) byChat.set(k, t); });

      /* The Sentinel, indexed by stock number, for the one kind whose detail
         string the view can no longer build. `inventory_aging` keys its `ref`
         on `inventory.id` and the Sentinel keys on the same column, so this is
         an exact join and not a heuristic. It is used for one purpose — to say
         how old a unit is when the view's own sentence came back empty — and
         it never overrules a detail the view did produce. */
      const unitById = new Map();
      (core?.sentinel || []).forEach(u => { const k = str(u.id); if (k) unitById.set(k, u); });
      let unmatchedUnits = 0, agedFromEngine = 0;

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
          chips.push(`<span class="inline-flex items-center px-2 py-0.5 rounded font-label-numeric-sm text-[10px] font-bold uppercase tracking-wider bg-surface-container-high text-on-surface-variant" title="NEXUS did not load, so this thread's identity could not be resolved. The label shown is the view's display_name, which falls back to the raw chat handle.">Identity unresolved</span>`);
        } else if (meta) {
          chips.push(`<span class="inline-flex items-center px-2 py-0.5 rounded font-label-numeric-sm text-[10px] font-bold uppercase tracking-wider bg-surface-container-high text-on-surface-variant" title="${esc(meta.note)}">${esc(meta.short)}</span>`);
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
          ? `<span class="text-outline">${esc(meaning.blank)}</span>`
          : it.at
            ? `<span class="text-outline">${esc(meaning.verb)} ${esc(ago(it.at))}</span>`
            : '<span class="text-outline">no timestamp on this item, so when it arrived is unknown</span>';
        const lead = leadFor(it);
        if (LEAD_KINDS.has(it.kind)) { if (lead) matchedLeads += 1; else unmatchedLeadRefs += 1; }
        let head, sub;
        if (it.kind === 'unanswered_chat') {
          const c = chatRow(it);
          head = `${c.named ? esc(displayName(c.name)) : '<span class="text-[#96570A]">Unidentified WhatsApp contact</span>'} ${c.chips.join(' ')}`;
          sub = `${esc(it.detail)} · ${waited}<div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${
            c.phone ? `<span class="font-label-numeric-sm text-[12px]">${esc(maskText(c.phone))}</span>` : '<span class="text-outline">No phone number stored for this thread</span>'
          } · <span class="font-label-numeric-sm text-[12px]" title="WhatsApp chat handle — a LID contains no phone digits and identifies nobody on its own">${esc(c.ref)}</span></div>`;
        } else if (lead) {
          head = esc(it.title);
          sub = `${esc(it.detail)} · ${waited}<div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${
            str(lead.phone) ? `<span class="font-label-numeric-sm text-[12px]">${esc(maskText(str(lead.phone)))}</span>`
              : '<span class="text-[#96570A]">No phone number on this lead record</span>'
          }${str(lead.email) ? ` · <span class="font-label-numeric-sm text-[12px]">${esc(maskText(str(lead.email)))}</span>` : ''}</div>`;
        } else if (it.kind === 'workflow_failure') {
          head = esc(it.title);
          /* The second line is the whole point of the enrichment: "failed 6
             hours ago" and "failing right now" are the same row until something
             says which. Where v_workflow_health had no row to match, that is
             said too — an unmatched item is not evidence of anything. */
          const fc = flow ? runCounts(flow) : null;
          sub = `${esc(it.detail)} · ${waited}<div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${
            flowState ? flowState.text
              : '<span class="text-outline">no row in the automation health figures matched this item, so whether it has succeeded since cannot be told from here</span>'
          }${fc && fc.notClean != null
            ? ` <span class="text-outline">· ${esc(num(fc.notClean))} of ${esc(num(fc.eff))} ${plural(fc.eff, 'run', 'runs')} in 30 days that counted did not succeed outright</span>`
            : ''}</div>`;
        } else if (it.kind === 'inventory_aging') {
          /* The view's detail for this kind is
             `days_in_stock || ' days in stock · AED ' || to_char(holding_cost_accrued, …)`
             and concatenating with NULL in Postgres yields NULL. The holding
             rate was withdrawn on 2 Sep 2026 for having no source, so the
             column is null on every unit and this item now arrives with NO
             DETAIL AT ALL — an empty line where the car's age used to be, and
             a caption beside it that used to point at it.

             The age is not lost, it is in the engine: the Sentinel keys on the
             same `inventory.id` this item's ref carries. So where the view's
             sentence is empty the row shows the engine's own days in stock and
             ageing band and SAYS it came from there, and where the view does
             produce a detail that detail is shown unchanged. Neither case
             invents a holding cost, because there is not one to state. */
          const unit = unitById.get(str(it.ref)) || null;
          const detail = str(it.detail);
          head = esc(it.title);
          if (detail) {
            sub = `${esc(detail)} · ${waited}`;
          } else if (unit) {
            agedFromEngine += 1;
            const days = n0(unit.days_in_stock);
            sub = `${esc(days == null ? 'Days in stock are not recorded for this unit' : `${num(days)} days in stock`)}`
              + `${str(unit.aging_band) ? ` · ${rawChip(str(unit.aging_band), true)}` : ''} · ${waited}`
              + `<div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${muted('The view could not build a sentence for this item: it prints the unit’s accrued holding cost, and there is none on record. The age beside the name is the Profit Sentinel’s, read from the same unit.')}</div>`;
          } else {
            unmatchedUnits += 1;
            sub = `<span class="text-[#96570A]">${esc(core?.sentinelErr
              ? 'This item arrived with no detail and the Profit Sentinel could not be read, so nothing is claimed about how old this unit is.'
              : 'This item arrived with no detail and its unit is not in the Sentinel read, so nothing is claimed about how old it is.')}</span> · ${waited}`;
          }
        } else {
          head = esc(it.title);
          sub = `${str(it.detail) ? `${esc(str(it.detail))} · ` : `<span class="text-outline">${esc('The view recorded no detail for this item.')}</span> · `}${waited}`;
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
        const iconIntent = flowState && flowState.key === 'recovered' ? 'tertiary' : dsIntent(tone(it.severity));
        return `<div class="${ROW}" role="button" tabindex="0" ${jump}>
          <span class="material-symbols-outlined ${TXT[iconIntent] || TXT.neutral}" style="font-size:20px">${icon}</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${head}${
              rawChip(str(it.severity) || 'Unrated', !!str(it.severity))}</div>
            <div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">${sub}</div>
            ${lead ? '<div class="font-body-sm text-[12px] text-on-surface-variant mt-0.5" aria-live="polite" data-leadmsg></div>' : ''}
          </div>
          <span class="material-symbols-outlined text-outline" style="font-size:18px">chevron_right</span>
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
        !threads ? 'NEXUS did not load, so WhatsApp threads above could not be checked against their contact records, and threads waiting outside this list could not be counted.' : '',
        stale ? `${num(stale)} further ${plural(stale, 'thread is', 'threads are')} awaiting a reply but older than the ${CHAT_WINDOW_DAYS}-day window this list uses — see Conversations.` : '',
        other ? `${num(other)} further ${plural(other, 'thread is', 'threads are')} marked whether the newest message is theirs in NEXUS but ${plural(other, 'does', 'do')} not appear above.` : '',
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
          ? 'The automation health figures did not load, so the workflow items above are shown as the view worded them — this screen cannot say which of them have run cleanly since they failed.'
          : unmatchedFlows
            ? `${num(unmatchedFlows)} workflow ${plural(unmatchedFlows, 'item', 'items')} above could not be matched to a row in the automation health figures, so nothing is claimed about whether ${plural(unmatchedFlows, 'it has', 'they have')} run since.`
            : '',
        /* An absence an operator would otherwise read as an all-clear. The
           undercut branch of the view compares competitors.our_price_aed
           against our own; with no rows to compare it cannot fire at all, which
           is a different thing from our prices being competitive. */
        rivals && rivals.length === 0
          ? 'No undercut item can appear on this list at present: the competitors table is empty, so the view has nothing to compare our prices against. That is a silent scraper, not a clean sheet — the rows return when the price scrape next runs.'
          : '',
        /* Where a row above is showing the engine's age rather than the view's
           own sentence, and why. Reported rather than done silently: a figure
           that came from somewhere other than the row's stated source has to be
           labelled, or the next person to read this list cannot reconcile it
           against v_needs_attention. */
        agedFromEngine
          ? `${num(agedFromEngine)} aging-stock ${plural(agedFromEngine, 'item', 'items')} above arrived from the attention list with an empty detail: its branch prints the unit's accrued holding cost and there is none on record, so the whole sentence came back null. The days in stock shown ${plural(agedFromEngine, 'is', 'are')} the Profit Sentinel's, joined on the same unit id. No holding cost is stated, because none exists.`
          : '',
        unmatchedUnits
          ? `${num(unmatchedUnits)} aging-stock ${plural(unmatchedUnits, 'item', 'items')} above arrived with no detail and could not be matched to a unit${
              core?.sentinelErr ? ' because the Profit Sentinel could not be read' : ' in the Sentinel read'}, so nothing is claimed about ${plural(unmatchedUnits, 'its', 'their')} age.`
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
          ? `The view returned ${num(items.length)} rows to get there: ${num(collapsed)} of them ${plural(collapsed, 'is a repeat', 'are repeats')} of a price undercut already listed, one row per nightly scrape of the same vehicle at the same price, and ${plural(collapsed, 'it is', 'they are')} shown once. The nav badge does not double-count ${plural(collapsed, 'it', 'them')}: badges.js collapses the same way before it counts. As of 1 Sep 2026 the attention list de-duplicates its undercut branch itself, so anything collapsing here means that has regressed and the raw table is being read unguarded again.`
          : '',
        `Nav badges are painted from one read of the attention list every 60 seconds and count HOT and WARM only — COLD is left out on purpose so a badge stays worth reading. Items the view files against no screen have no nav item to sit on, so they are counted into the Overview badge and nowhere else.`,
        gapRows == null
          ? `The KYC archive-gap read failed, so the badge is the shared count alone${need.floor == null ? '' : ` (${num(need.floor)})`} and any gap it would have added is missing from it.`
          : need.kycExtra
            /* Written as the sum, both terms named, because a badge an owner
               cannot reconstruct from the screen under it is a number they
               learn to ignore — and this one is now mostly made of rows that
               are not on this list at all. */
            ? `The Overview badge reads ${num(need.badge)} = ${num(need.floor)} + ${num(need.kycExtra)}: ${num(need.floor)} HOT or WARM ${plural(need.floor, 'item', 'items')} in the attention list across every screen${
                need.floorFrom === 'own' ? ', counted from this panel because the shared badge read has not returned yet' : ''
              }, plus ${num(need.kycExtra)} KYC archive ${plural(need.kycExtra, 'gap', 'gaps')} from the KYC archive-gaps panel above, which the view does not list at all. badges.js repaints the ${num(need.floor)} on its own next poll; the gaps are added back the next time this screen renders, and the KYC panel above lists them either way.`
            : `Nothing here is missing from that count, so the Overview badge is left exactly as badges.js painted it${need.floor == null ? '' : ` — ${num(need.floor)}`}.`,
      ].filter(Boolean);
      const foot = `<div class="${ROW_STILL}">
        <span class="material-symbols-outlined text-outline" style="font-size:18px">info</span>
        <div class="min-w-0 flex-1">${note(notes.map(x => `<p>${esc(x)}</p>`).join(''), `How to read this panel — ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`)}</div></div>`;

      if (!items.length) {
        /* 'task_alt' is not in the design system's icon set; 'check' is nearest. */
        return dsEmpty({ title: 'Nothing needs you right now', name: 'check', body:
          'No unanswered WhatsApp thread inside the 7-day window, no unassigned HOT lead, SLA breach, KYC archive gap, workflow failure, undercut or aging unit.' }) + foot;
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
    actions: `<button type="button" class="${BTN.secondary}" data-act="leads">View all</button>`,
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
        return dsEmpty({ title: 'No leads yet', body:
          `Nothing in your leads as of ${clock(readAt)}, when this panel read it. New enquiries appear here on the next read, not as they arrive — reopen Overview to check.` });
      }
      /* Fewer rows than the page size means this is not the top of a long list,
         it is the whole list — which reads very differently. */
      const notes = [
        `Read once at ${clock(readAt)}, when this screen opened. This table does not update on its own — a lead that arrived since is not on it. Reopen Overview for a fresh read.`,
        rows.length < FEED_LIMIT
          ? `The query asked for the newest ${FEED_LIMIT} leads and got ${rows.length}, so this is the whole your leads, not the top of it.`
          : '',
        'A row opens that lead. Leads has no last-modified timestamp, so this is ordered by when each one arrived, which is the only time the table records.',
      ].filter(Boolean);
      const feedNote = `<div class="${ROW_STILL}"><span class="material-symbols-outlined text-outline" style="font-size:18px">info</span>
             <div class="min-w-0 flex-1">${note(notes.map(x => `<p>${esc(x)}</p>`).join(''), `How to read this table — ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`)}
               <div class="font-body-sm text-[12px] text-on-surface-variant" aria-live="polite" data-feedmsg></div></div></div>`;
      return dsTable([
        { label:'When', render: r => `<div class="text-outline">${esc(ago(r.created_at))}</div><div class="font-label-numeric-sm text-[12px] text-on-surface-variant mt-0.5">${esc(clock(r.created_at))}</div>` },
        { label:'Status',  render: r => rawChip(str(r.status) || 'Unscored', !!str(r.status)) },
        { label:'Name',    strong: true, render: r => esc(maskText(str(r.name) || 'Unnamed lead')) },
        { label:'Phone',   render: r => str(r.phone)
            ? `<span class="font-label-numeric-sm text-[12px]">${esc(maskText(str(r.phone)))}</span>`
            : `<span class="font-body-sm text-[12px] text-[#96570A] mt-0.5">Not captured</span>` },
        { label:'Interest',render: r => `<span class="text-on-surface-variant">${str(r.vehicle_interest) ? esc(str(r.vehicle_interest)) : '<span class="font-body-sm text-[12px] text-on-surface-variant mt-0.5">Not recorded</span>'}</span>` },
        { label:'Score', align:'r', render: r => num(r.ai_score) },
      ], rows, { onRow: true }) + feedNote;
    },
  }).then(card => {
    card.querySelector('[data-act]')?.addEventListener('click', () => go('leads'));
    /* The same drawer the Leads screen opens, on the row that was clicked. A
       failed read reports itself in the footnote under the table rather than
       leaving a click that did nothing.

       Not lib/ui.js's wireRows(): dsTable() (lib/design-system.js) marks a
       clickable row `ds-row--clickable`, not wireRows()'s `clickable`, so that
       helper's selector would silently match nothing. Same handler and same
       `data-i` index into the rows the render just set on the card — only the
       selector changes, to the one the design-system table actually emits. */
    const rows = card.__rows || [];
    card.querySelectorAll('tbody tr.ds-row--clickable').forEach(tr => {
      tr.addEventListener('click', () => openLead(rows[Number(tr.dataset.i)]?.id, card.querySelector('[data-feedmsg]')));
    });
  }));

  /* ════════════════════════════════════════════════════════════════════════
     The sections the Stitch export adds around the panels. Each is built from a
     read this screen already makes (or, for visits, the read Appointments
     makes) and none of them computes a figure the panels do not.
     ════════════════════════════════════════════════════════════════════════ */

  /* ── The attention banner (af6246: "N things need your attention today") ──
     Counted on exactly the rule the nav badge uses — HOT and WARM rows of the
     attention list, snapshot duplicates collapsed — so the banner, the badge and
     the Priority actions list below cannot disagree about one moment. */
  readAttention().then(({ items }) => {
    const distinct = collapseSnapshots(items || []).rows;
    const urgent = distinct.filter(i => BADGE_SEVERITIES.has(str(i.severity).toUpperCase()));
    if (!urgent.length) {
      bannerHost.innerHTML = `<div class="p-space-md rounded-xl bg-[#E6F4EF]/60 border border-emerald-200 flex items-center gap-space-md">
        <span class="material-symbols-outlined text-[#157A5B] text-2xl">task_alt</span>
        <div><div class="font-headline-md text-headline-md text-on-surface">Nothing on the attention list is marked HOT or WARM</div>
        <p class="font-body-sm text-body-sm text-on-surface-variant">${esc(`${num(distinct.length)} ${plural(distinct.length, 'item is', 'items are')} listed below in all. That is the attention list as read just now — not a statement about anything it does not cover.`)}</p></div></div>`;
      return;
    }
    const byKind = new Map();
    urgent.forEach(i => byKind.set(i.kind, (byKind.get(i.kind) || 0) + 1));
    const KIND_WORDS = { unanswered_chat: ['WhatsApp thread waiting on a reply', 'WhatsApp threads waiting on a reply'],
      lead_unassigned: ['HOT lead with no owner', 'HOT leads with no owner'], sla_breach: ['slow first reply', 'slow first replies'],
      kyc_archive_gap: ['KYC file never archived', 'KYC files never archived'], workflow_failure: ['automation that did not deliver', 'automations that did not deliver'],
      undercut: ['competitor undercut', 'competitor undercuts'], inventory_aging: ['unit past the critical age', 'units past the critical age'] };
    const summary = [...byKind.entries()].map(([k, n]) => `${num(n)} ${KIND_WORDS[k] ? plural(n, KIND_WORDS[k][0], KIND_WORDS[k][1]) : k}`).join(', ');
    bannerHost.innerHTML = `<div class="p-space-md rounded-xl bg-error-container/40 border border-red-200 flex flex-col md:flex-row md:items-center justify-between gap-space-md">
      <div class="flex items-start gap-space-md min-w-0">
        <div class="w-11 h-11 rounded-lg bg-error text-on-error flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-2xl">notifications_active</span></div>
        <div class="min-w-0"><div class="flex items-center gap-2 flex-wrap"><span class="font-headline-md text-headline-md text-on-surface">${esc(num(urgent.length))} ${plural(urgent.length, 'thing needs', 'things need')} your attention</span>
          <span class="px-2 py-0.5 rounded bg-error text-on-error font-label-numeric-sm text-[10px] font-bold uppercase">HOT or WARM</span></div>
          <p class="font-body-sm text-body-sm text-on-surface-variant">${esc(summary)}.</p></div>
      </div>
      <button type="button" data-ov-jump class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-error text-on-error font-body-sm text-body-sm font-semibold shrink-0"><span>See them below</span><span class="material-symbols-outlined text-[16px]">arrow_downward</span></button>
    </div>`;
    bannerHost.querySelector('[data-ov-jump]')?.addEventListener('click', () => attnHost.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }).catch(() => { bannerHost.innerHTML = ''; });

  /* ── The two money cards (af6246) ──────────────────────────────────────────
     LEFT: the export says "Estimated revenue at risk". No engine estimates
     revenue at risk; what exists is gross margin EXPOSED in unsold stock, from
     the Sentinel, through expose() — so the card carries the export's dashed
     amber anatomy and the word EXPOSED, never "estimated".
     RIGHT: the export says "Confirmed revenue recovered". What the database can
     support is ATTRIBUTED recovery — the four-column test in screens/actions.js
     — beside the count of confirmed sales on file, which are confirmed and
     credited to nothing. moneyTile() prints the word on the tile. */
  readQueue().then(q => q, () => null).then(queue => {
    const exposedTile = (() => {
      if (coreErr || core.sentinelErr) {
        return `<div class="border-2 border-dashed border-amber-300 bg-amber-50/50 p-space-md rounded-lg flex flex-col gap-2 min-h-[11rem]">
          <div class="flex items-center justify-between"><span class="font-table-header text-table-header uppercase tracking-wider font-bold text-amber-900/80">Gross margin exposed</span><span class="font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded font-semibold uppercase bg-amber-200/50 text-amber-900">Exposed</span></div>
          <div class="font-label-numeric-lg text-headline-lg font-bold text-amber-950">—</div>
          <p class="font-body-sm text-body-sm text-amber-900">The Profit Sentinel could not be read, so no exposure is stated — not a nil one.</p></div>`;
      }
      const t = core.exposed;
      return `<div class="border-2 border-dashed border-amber-300 bg-amber-50/50 p-space-md rounded-lg flex flex-col justify-between min-h-[11rem] gap-2">
        <div class="flex items-center justify-between gap-2"><span class="font-table-header text-table-header uppercase tracking-wider font-bold text-amber-900/80">Gross margin exposed in unsold stock</span><span class="font-label-numeric-sm text-label-numeric-sm px-2 py-0.5 rounded font-semibold uppercase bg-amber-200/50 text-amber-900">Exposed</span></div>
        <div class="my-auto space-y-1">
          <div class="flex items-baseline gap-1.5">${t.total == null ? '<span class="font-label-numeric-lg text-headline-lg font-bold tracking-tight text-amber-950">—</span>'
            : `<span class="font-label-numeric-sm text-label-numeric-sm text-amber-800/70">AED</span><span class="font-label-numeric-lg text-headline-lg font-bold tracking-tight text-amber-950">${esc(num(t.total))}</span>`}</div>
          <p class="font-body-sm text-body-sm font-medium text-amber-900">${esc(t.total == null ? 'No unit the engine is asking about carries an impact figure.' : `Across ${num(core.needsDecision.length)} ${plural(core.needsDecision.length, 'unit', 'units')} the engine is asking a person about`)}</p>
          ${note(`<p>${esc(exposureLine(t, plural(core.needsDecision.length, 'that unit', 'those units')))}</p><p>${esc(EXPOSURE_CAVEAT)}</p><p>${esc('No engine in NEXUS produces an estimate of revenue at risk, so this card does not carry that word.')}</p>`, 'What this figure is')}
        </div>
        <div class="pt-2 border-t border-amber-200/60 flex items-center justify-between text-[11px] font-label-numeric-sm text-amber-800">
          <span>${esc(`${num(t.n)} of ${num(t.of)} carry a figure`)}</span>
          ${SCREENS.moneyleaks ? '<button type="button" data-ov-go="moneyleaks" class="inline-flex items-center gap-1 font-semibold text-primary">View breakdown<span class="material-symbols-outlined text-[14px]">arrow_forward</span></button>' : ''}
        </div></div>`;
    })();
    let recTile;
    if (!queue) {
      recTile = moneyTile({ kind: 'attributed', label: 'Recovered — attributed to an action', amount: null,
        unknownWhy: 'The action queue could not be read, so nothing is claimed either way.' });
    } else {
      const ev = queue.map(a => recoveryEvidence(a));
      const ok = ev.filter(x => x.state === 'ATTRIBUTED');
      const t = expose(ok, x => x.amount, () => 'ATTRIBUTED_MARGIN');
      recTile = moneyTile({ kind: 'attributed', label: 'Recovered — attributed to an action', amount: t.total,
        sub: `${num(ok.length)} ${plural(ok.length, 'action passes', 'actions pass')} the four-column evidence test`,
        unknownWhy: `No action carries a recovered figure with all four evidence columns — ${num(queue.length)} tested. Not zero: not recorded.`,
        footLeft: 'Attributed is not confirmed', footRight: 'Action lane' });
    }
    moneyHost.innerHTML = exposedTile + recTile;
    moneyHost.querySelectorAll('[data-ov-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.ovGo)));
  });

  /* ── Visits & drives (af6246), from the read Appointments makes ──────────── */
  const APPT_DAYS = 7;
  db(`rpc/nexus_appointment_status?p_days=${APPT_DAYS}`).then(rows => {
    const list = Array.isArray(rows) ? rows : [];
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
    const dayOf = t => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
    const todays = list.filter(r => r.starts_at && dayOf(r.starts_at) === today);
    const booked = todays.filter(r => r.counts_as_booked === true).length;
    const attended = todays.filter(r => r.counts_as_attended === true).length;
    const waitingOutcome = todays.filter(r => r.awaiting_outcome === true).length;
    const next = list.filter(r => r.starts_at && Date.parse(r.starts_at) >= Date.now()).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)).slice(0, 3);
    const stat = (n, label, cls) => `<div class="rounded-lg p-2.5 text-center ${cls}"><div class="font-label-numeric-lg text-headline-md font-bold">${esc(num(n))}</div><div class="font-body-sm text-[11px]">${esc(label)}</div></div>`;
    apptHost.innerHTML = `<section class="rounded-xl bg-surface-container-lowest border border-outline-variant overflow-hidden shadow-sm">
      <div class="px-space-md py-3 bg-surface-container-low border-b border-outline-variant flex items-center justify-between gap-2">
        <div class="flex items-center gap-2"><span class="material-symbols-outlined text-primary text-xl">directions_car</span><h2 class="font-headline-md text-headline-md text-on-surface">Visits &amp; drives</h2></div>
        <span class="font-label-numeric-sm text-[11px] text-outline">Today (${esc(num(todays.length))} total)</span></div>
      <div class="p-space-md space-y-space-sm">
        <div class="grid grid-cols-3 gap-2">${stat(booked, 'Booked', 'bg-[#E8F1FB] text-[#2563A8]')}${stat(attended, 'Attended', 'bg-[#E6F4EF] text-[#157A5B]')}${stat(waitingOutcome, 'Awaiting outcome', 'bg-[#FEF3E2] text-[#96570A]')}</div>
        ${next.length ? next.map(r => `<div class="p-2.5 rounded-lg border border-outline-variant/40 flex items-start gap-2">
            <span class="material-symbols-outlined text-[18px] text-primary">schedule</span>
            <div class="min-w-0"><div class="font-body-sm text-body-sm font-semibold text-on-surface">${esc(clock(r.starts_at))} · ${esc(str(r.vehicle_model) || 'No vehicle recorded')}</div>
            <div class="font-body-sm text-[11px] text-on-surface-variant">${esc(str(r.customer_name) ? displayName(str(r.customer_name)) : 'No customer named')} · ${esc(str(r.state) || 'no state')}</div></div></div>`).join('')
          : '<p class="font-body-sm text-[12px] text-on-surface-variant">No visit is booked from now on in the window read.</p>'}
        ${SCREENS.appointments ? '<button type="button" data-ov-go="appointments" class="inline-flex items-center gap-1 font-body-sm text-body-sm font-semibold text-primary">Open Appointments<span class="material-symbols-outlined text-[16px]">arrow_forward</span></button>' : ''}
      </div></section>`;
    apptHost.querySelectorAll('[data-ov-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.ovGo)));
  }).catch(e => { apptHost.innerHTML = errorState({ what: 'visits and drives', err: e }); });

  /* ── Margin against days in stock (af6246's second analysis card) ──────────
     The export draws margin decaying with age. That curve needs a holding cost
     per day, and the Sentinel says how many units have one. Where none do, the
     card says so and draws nothing — a decay curve drawn from a list price and
     no cost of carrying it would be a shape with no evidence behind it. */
  if (coreErr || core.sentinelErr) {
    marginHost.innerHTML = errorState({ what: 'margin against days in stock', err: coreErr || core.sentinelErr });
  } else {
    const computed = core.sentinel.length - core.noHolding;
    marginHost.innerHTML = computed
      ? `<section class="rounded-xl bg-surface-container-lowest border border-outline-variant shadow-sm p-space-lg space-y-2">
          <h2 class="font-headline-md text-headline-md text-on-surface">Margin against days in stock</h2>
          <p class="font-body-sm text-body-sm text-on-surface-variant">${esc(`${num(computed)} of ${num(core.sentinel.length)} units carry a computed holding cost. The per-unit net margin is on Inventory; no curve is drawn here from a partial set.`)}</p>
        </section>`
      : comingSoonPanel({ kind: 'coming-soon', icon: 'show_chart', title: 'Margin against days in stock',
          body: `How fast margin is being eaten cannot be drawn: holding cost is NOT COMPUTABLE on all ${num(core.sentinel.length)} ${plural(core.sentinel.length, 'unit', 'units')} the Profit Sentinel scored, because this dealership has not recorded what a day on the lot costs. Unknown, not nil.`,
          prerequisite: 'One number — the daily holding cost per unit — entered on Inventory.' });
  }

  /* ── The roadmap row (af6246 "Upcoming intelligence automations") ─────────
     Taken from the navigation's own roadmap entries rather than from the
     export's three invented product names, so the row can only ever name
     something the product already lists as COMING SOON or PLANNED. */
  const upcoming = flatNav().filter(i => i.roadmap === 'soon').concat(flatNav().filter(i => i.roadmap === 'planned')).slice(0, 3);
  if (upcoming.length) {
    roadmapHost.innerHTML = `<div class="flex items-center justify-between gap-2 pb-space-sm">
        <div class="flex items-center gap-2"><span class="material-symbols-outlined text-secondary text-xl">science</span><h2 class="font-headline-md text-headline-md text-on-surface">Upcoming</h2></div>
        ${SCREENS.whatscoming ? '<button type="button" data-ov-go="whatscoming" class="inline-flex items-center gap-1 font-body-sm text-body-sm font-semibold text-primary">What’s coming<span class="material-symbols-outlined text-[16px]">arrow_forward</span></button>' : ''}
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-space-md">${upcoming.map(i => comingSoonPanel({
        kind: i.roadmap === 'soon' ? 'coming-soon' : 'planned', icon: i.icon, title: i.title,
        body: 'On the roadmap and not part of this build. Nothing on it reads your data yet.',
        actionsHtml: SCREENS[i.id] ? `<button type="button" data-ov-go="${esc(i.id)}" class="${BTN.secondary}">Preview</button>` : '' })).join('')}</div>`;
    roadmapHost.querySelectorAll('[data-ov-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.ovGo)));
  }

  footHost.innerHTML = trustFooter({
    source: 'leads · rpc/sentinel_inventory_actions · v_inventory_action_queue · v_needs_attention · v_workflow_health · communication_logs',
    asOf: dubaiStamp(readAtScreen),
    evidence: coreErr ? 'The core read failed' : `${num(core.leads.length)} leads, ${num(core.sentinel.length)} units scored`,
    actor: ME && ME.name ? ME.name : '',
  });

  await Promise.all(panels);
};

/* ==========================================================================
   S2 · Leads
   ========================================================================== */
