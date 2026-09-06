/* NEXUS OS — screens/compliance.js
   The KYC / AML register. This is the screen an auditor or a buyer's lawyer is
   pointed at, so it holds itself to a stricter standard than the rest of the
   product: every field the auditor extracted is shown, and the retention story
   is stated explicitly rather than implied by an empty cell.

   `kyc_documents` held nine rows filed by one customer after the 24 Aug 2026
   cleanup and holds NONE as of 1 Sep 2026 (counted against the live table, not
   inferred). Both shapes are still shapes this screen has to be right about, and
   neither is assumed anywhere below — every claim about how many people are in
   the register is computed from the rows that actually loaded.

   0. AN EMPTY REGISTER IS NOT AN EMPTY AUDIT HISTORY, AND THE TWO ARE SAID
      TOGETHER OR NOT AT ALL. Until 1 Sep 2026 the retention panel printed "No
      KYC document has been audited yet" while, some 400px above it, the
      escalation banner named a customer, quoted the auditor's own finding on his
      document — a future expiry date and possible signs of tampering — and said
      the re-upload loop had given up after three attempts. Both sentences were
      rendered from live rows and neither was reconciled with the other. Read
      alone the first understates a KYC failure to nothing; read beside the
      second it makes the screen untrustworthy in both directions, on the page an
      auditor is handed.

      They are scoped to different tables and only one of them is the audit
      history. `kyc_documents` is the REGISTER — what survives of an audit. The
      audit itself is in `audit_log`, and a run there that reached a verdict is a
      document that was read and judged whatever the register does or does not
      hold. An audited document that was never filed is not the same thing as a
      document that was never audited, and this screen may not print the second
      sentence while it is holding evidence of the first.

      Which runs count as "a verdict was reached" is not decided here.
      lib/health.js classifies the row, and SUCCESS, PARTIAL and ESCALATED are
      the outcomes that mean the auditor got as far as a document; a run that
      died at the vision call or the auth gate audited nothing and counts as
      nothing. Taken from the live database on 1 Sep 2026: nine runs of the KYC
      auditor, seven of them failures at `OpenRouter Vision (KYC Analysis)` or
      `Auth Gate`, and two escalations carrying a document-level finding — with
      no register row for either escalation. Every one of those figures is read
      live on each load and none of them is hard-coded below.

      The reconciliation is computed once, in `registerVsAudit()`, and stated
      once, in the retention panel. The register's own empty state and the two
      KPI tiles whose zeroes it explains point at that one sentence rather than
      restating it, so there is no second wording for the first to drift from.

      A sentence was not enough on its own, though, because the screen had no
      WORD for the position a case is in — so a case with no register row had
      only silence to be rendered as, and silence reads as denial. That is what
      the six-state vocabulary further down (`CASE_STATE`) exists for, and the
      invariant it enforces is UNKNOWN IS NOT ABSENCE: a missing register row
      renders as `Unknown · not recorded` everywhere it appears, and nowhere on
      this screen as "no document exists" or "never audited". It is stated on
      two axes — what the auditor did, and what the register holds — because on
      the live data those differ, and it is said in three places that read one
      memoised computation: the escalation banner, the case ledger in the
      retention panel, and the row for the run itself in the activity trail.

      What this screen must NOT say is WHY the register row is missing. The
      auditor's escalation path fans out to `Record KYC (Rejected)` as well as to
      `Log KYC Escalation` — the connections in
      n8n-workflows/kyc_aml_document_auditor_re_upload_loop_phase_5.json — so an
      escalation is supposed to leave a register row behind. Whether that row was
      never written or was written and later removed is in nothing the browser
      can read; no deletion appears in `audit_log`, and — checked against
      information_schema on 1 Sep 2026 — no table in `public` records a deletion
      at all, so there is no deletion log for anything to appear in. The panel
      says that it does not know, because both answers are compliance findings
      and picking one would be inventing the record this screen exists to
      protect.

   1. ONE PERSON IS A BIOGRAPHY, NOT A POPULATION. When the register does hold
      one contact's attempts, three approvals against four rejections is that
      man's history and not an approval rate, so this file computes no rate,
      share, average or trend over it anywhere. A percentage drawn across nine
      rows filed by one person would read as a fact about the dealership's
      compliance and it is not one — there is nobody there to compare him with.
      Where a proportion is drawn at all (the retention bar) the caption says how
      few rows it rests on and that the shapes are not shares.

   2. THE ARCHIVE GAP IS THE VIEW'S NUMBER, NOT THIS SCREEN'S. Retention cannot
      be proven for a document whose file was never stored, and the database
      files exactly that hole as `v_needs_attention.kyc_archive_gap`. This screen
      used to count it a second time locally, over `storage_path IS NULL AND
      purged_at IS NULL`, and asserted in four places that its number and the
      view's could not disagree. They did: the view also requires `void_reason IS
      NULL` and `created_at > 2026-08-17 16:01:48+00`, so every row audited
      before archiving shipped sat in this screen's count and not in the view's —
      and the archive banner printed the size of that discrepancy one line below
      the claim that there could not be one, on the screen an auditor is handed.
      The local count is gone. The view is read directly, its `ref` (the
      kyc_documents id) decides membership row by row, and when that read fails
      the gap is reported as unknown rather than reconstructed here. One fact,
      one source, and no second opinion to drift from it.

   3. THE VOID PARTITION IS EMPTY, AND THE BRANCH STAYS. Nine rows that were
      never submissions — greeting cards, a religious banner, a Sikh prayer text
      — were deleted, and the gate that auto-routed every uncaptioned WhatsApp
      image to the auditor is fixed. Every `void_reason` path below is kept and
      still correct, because the partition can refill: the register is computed
      over `live` and never over the raw read. What must not happen is a heading
      with nothing under it, so when nothing is voided the section is not
      rendered at all rather than rendered as an empty box.

   IDENTITY IS lib/identity.js AND NOTHING ELSE. Until 1 Sep 2026 this file kept
   a private rule: a union-find that linked `whatsapp_contacts.chat_id` to
   `whatsapp_contacts.lead_email` as exact lower-cased strings and called the
   closure a person. That is not the rule the backend used to WRITE those rows.
   `Resolve Lead Identity` in whatsapp_bdc_ai_agent.json joins a chat to a lead
   on the last nine digits of the phone number, and the workflows file one human
   being under an email, a `@lid`, a `@c.us` and a `+…@whatsapp.lead` — four
   shapes, only two of which a string union-find can bridge.

   Measured against the live tables on 1 Sep 2026, for leads 34 / 35 / 38, the
   local rule attributed 8 / 0 / 17 `communication_logs` rows where the shared
   resolver, `nexus_lead_for_comm_key()` and `nexus_comm_keys_for_lead()` all
   reach 8 / 10 / 29. It lost all twelve of lead 38's rows filed under
   `+918517942172@whatsapp.lead`, a key reachable from neither column it joined,
   and all ten of lead 35's, because that lead's `email` column holds `''` and
   the empty key matches nothing. Lead 34 agreed only by accident: its `email`
   column literally contains the `@whatsapp.lead` string, and a real address
   there would have dropped it to 5.

   None of that reached the REGISTER, because `kyc_documents` is empty and no
   message begins `[KYC-` — counted live on 1 Sep 2026: 0 register rows, and 0
   of the 99 message-log rows carry the prefix. That is why it was worth
   replacing and not why it could be kept: a register that splits one customer's
   document trail in two, or shows a rejection history with a third of it
   missing, is wrong in the exact direction this screen exists to prevent, and it
   would be wrong from the first document filed.

   It does reach the screen elsewhere, though, and that correction belongs here
   rather than being left implied. The two escalated cases in `audit_log` are
   resolved by name, phone and lead through this same resolver — in the
   escalation banner, in the case ledger and in the activity trail — so identity
   has a live surface on this screen today even with an empty register.

   Which is how a second false absence came to light on 1 Sep 2026 and was fixed
   with it. The `leads` read selected `name,email,phone` and NOT `id`, while
   lib/identity.js populates `leadIds` only from `l.id` and both `who()` and
   `nameFor()` report a lead only through `leadIds`. So the pool could never
   absorb anybody: every contact on this screen resolved to "No lead row" / "no
   lead record", including the customer behind both escalations, whose address
   `shabbir53ujjainwala@gmail.com` is lead 38 in the live database. The screen
   was asserting that a customer did not exist. `id` is now selected and the
   claim is only made when the resolver actually reports no lead.

   Every key question here now goes through `personOf()`, which is
   `expandIdentity` from lib/identity.js (305 assertions, re-run against this
   build on 1 Sep 2026) seeded with the row's own keys, given `whatsapp_contacts`
   as links and `leads` as the candidate pool. Two things about that call are
   deliberate, and neither is a way around the module:

     · the row's `lead_email` and `chat_id` go in through `keys:`, never through
       `email:`/`chatId:`. `kyc_documents.lead_email` is the same free-text
       column as everywhere else and holds `+918517942172@whatsapp.lead` as
       readily as an address; the `keys:` path dispatches on the value's SHAPE,
       so a phone-derived value becomes a phone anchor instead of being observed
       as an inert string. Passing it as `email:` measures 12 rows for lead 38
       where `keys:` measures 29.
     · a row carrying only a `chat_id` is resolved TWICE. The first pass learns
       the person's number from the linked `whatsapp_contacts` row, but the lead
       pool has already been scanned by then, so no lead is absorbed and the row
       would be labelled "WhatsApp profile · no lead row" about a customer who
       has one. The second pass re-seeds with the number the first pass found.
       Both passes are the shared resolver; nothing here re-derives a key.

   A person and a log row are matched on `normalizeKey().canonical`, never on the
   raw string — that is what stops a 15-digit LID whose last nine digits happen
   to match a phone number from colliding with that phone. And when the resolver
   reports a phone-suffix collision it is rendered rather than swallowed: two
   customers whose numbers end in the same nine digits are not merged, the key
   set narrows to the exact keys, and the row says so.

   Retention has several distinct meanings and they must never be conflated. The
   full vocabulary, and where every word in it came from, is the RETENTION table
   below; it is the only place on this screen that decides what a row's archive,
   retention or purge state is, and the pill, the filter, the stacked bar, the
   drawer and the Open-file button all read that one verdict.

   4. WORKFLOW OUTCOMES ARE NOT THIS FILE'S TO INTERPRET. Two workflows write
      everything on this screen — the KYC auditor fills the register, the
      retention purge empties it — and both of them are currently not working.
      `lib/health.js` is the only module allowed to say what an `audit_log`
      status or a `v_workflow_health.health` value means, so this screen reads it
      and never compares a status string itself. That matters most in the empty
      case: with no rows at all, "nothing has been submitted yet" and "the
      auditor has failed every run it made" look identical from `kyc_documents`
      alone, and only the first of those is good news. Taken from the live
      database on 1 Sep 2026: `KYC/AML Document Auditor (Phase 5)` is DEGRADED
      with 9 runs and 0 successes in 30 days, last run 17 Aug; `NEXUS Retention
      Purge` is NEVER_RAN with no logged run at all. Both figures are read live
      on every load and nothing below hard-codes them.

   Nothing on this screen is estimated and no row is fabricated: if a table
   cannot be read, the panel that depends on it says so. */
import { db, signedUrl } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { ago, clock, esc, n0, num, pill } from '../lib/format.js';
/* The canonical identity resolver. This screen holds no rule of its own for
   deciding whether two keys name the same person — see the header. */
import { KEY_SHAPE, expandIdentity, normalizeKey } from '../lib/identity.js';
/* The canonical interpreter for audit_log statuses and v_workflow_health.health.
   Nothing in this file may test a status string directly — the rebuilt
   v_workflow_health and public.nexus_outcome_class() are the record, and this
   module mirrors them. */
import { OUTCOME, healthWords, outcomeOf, outcomeWords, successRate } from '../lib/health.js';
import { SCREENS } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, table, wireRows } from '../lib/ui.js';

/* The moment the archive step went live, matching `v_needs_attention` and the
   KYC workflow's own archive-gap monitor, both of which carry this same instant.
   It is used here for exactly one purpose: to EXPLAIN why the view did not file
   a fileless row as a gap. It is never a predicate on any count — the view
   decides what is in the gap and this screen does not second-guess it. If a
   fileless row is absent from the view and this timestamp does not explain the
   absence, the row says so rather than being folded into either side. */
const ARCHIVE_EPOCH = '2026-08-17T16:01:48Z';
const ARCHIVE_EPOCH_MS = Date.parse(ARCHIVE_EPOCH);
const ARCHIVE_EPOCH_LABEL = '17 Aug 2026 16:01 UTC';

/* The register is read newest-first with a hard cap. An auditor is entitled to
   know when they are looking at a window rather than the whole book, so when the
   read comes back exactly full the screen says so, rather than letting a capped
   page imply the dealership has only ever audited this many documents. */
const ROW_LIMIT = 500;

/* The message log is read whole and newest-first, then filtered here for
   `[KYC-…]` lines. That cap therefore bounds how far back the "older approvals
   messaged to a contact with no row in this register" line can see, and it is
   named on that line — an undisclosed ceiling reads as "there are no older
   approvals" when what it means is "we did not look that far back". Live count
   on 1 Sep 2026: 99 rows, none of them a `[KYC-…]` line, so the cap is not
   biting yet; it arms itself as the log grows. */
const COMM_LIMIT = 500;
/* The auditor's own runs. Capped like every other read here, and the cap is
   disclosed the moment it is reached: the reconciliation between this log and
   the register is the load-bearing sentence on the screen, and it must never be
   drawn from a window that is silently a window. Live count on 1 Sep 2026: 9
   rows under two workflow spellings, so the cap is not biting. */
const AUDIT_LIMIT = 200;
/* `v_needs_attention` files one row per unarchived document. The ceiling is
   generous because this is the number an auditor is shown, and it is disclosed
   the moment it is reached rather than silently truncating the gap. */
const GAP_LIMIT = 2000;

/* Every write path this screen would need is service-role only. Stating the
   exact missing piece on the disabled control is the difference between "this
   product is broken" and "this step is not built yet". */
/* These two are the evidence behind the em dash on the three verdict tiles: no
   decision a person takes can be recorded from this dashboard, and no request
   for another upload can be sent from it. The controls are rendered and
   refused rather than hidden, so nobody is left wondering whether the feature
   exists — but what the tooltip must NOT do is hand the dealership the reason
   in the vendor's terms (which table, which role, which webhook path). That is
   CONTROL-PLANE.md Part 4, and it is the same correction made to team.js's
   NO_INVITE. If either capability is ever built, the tiles above stop printing
   the dash on their own — they key on whether a decision is on file, not on
   these constants. */
const NO_DECISION_HOOK =
  'Recording a decision here is not built yet. The document auditor is the only thing that can write a verdict, so an approval or a rejection taken by a person cannot be filed from this dashboard.';
const NO_REASK_HOOK =
  'Asking the customer for another upload is not built yet. Nothing here can send that request.';
/* Said on every row with no file, so it says the whole thing rather than
   "nothing to open": what is missing and why no button here can fix it. Whether
   the database files this particular row as an archive gap is NOT stated here —
   that is the view's verdict, it is carried on the row's retention state, and
   this constant would be a second, unchecked assertion of the same fact. */
const NO_FILE_LINK =
  'No archived file was ever recorded for this document and none was deleted, so nothing was removed on schedule — the file was simply never archived, and there is nothing to open. Re-running the archive step is NEXUS’s to do; nothing in this dashboard can repair it.';
const PURGED_FILE =
  'This file was deleted on schedule under the retention policy. There is nothing left to open.';
/* Signing is deliberately short-lived: long enough to click through, short
   enough that the URL is dead by the time anyone forwards it. The number is in
   the button's title so a reviewer knows the link they just opened is perishable
   before they try to share it. */
const SIGNED_URL_TTL = 60;
const CAN_OPEN_FILE =
  `Opens the archived document through a ${SIGNED_URL_TTL}-second signed URL. The bucket stays private — the link expires and cannot be reused.`;

/* The three date-shaped columns are rendered verbatim. Parsing "2026-08-17"
   into a Date and formatting it locally shifts it a day either side of UTC
   midnight, and a passport expiry that moves by a day depending on who is
   looking at it is worse than an unformatted one.

   Only ONE of them is a DATE column. Checked against information_schema on the
   live database, 1 Sep 2026: `retain_until` is `date`; `date_of_birth` and
   `expiry_date` are both `text`, because they are written from whatever the
   vision model read off the document and the workflow does not cast them. So
   nothing here may assume either of those parses — an unreadable expiry is a
   third case beside expired and current, and it is said in words rather than
   left to look like a date that is fine.

   "Today", though, has to be the showroom's today. Every n8n workflow runs on
   Asia/Dubai and lib/format.js pins every absolute date on this product to it;
   a UTC today is Dubai minus four hours, so between 00:00 and 04:00 GST this
   comparison used yesterday's date and a retain_until that lapsed that morning
   did not read as due. en-CA is named only because it is the locale that formats
   as YYYY-MM-DD, which is the shape these DATE columns already hold. */
const DUBAI_DAY = new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' });
const todayISO = () => DUBAI_DAY.format(new Date());
const isPastDate = v => {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && s < todayISO();
};

/* Two different facts hide behind one expired date and a reviewer cares about
   only one of them. An identity document that had already expired on the day it
   was audited was accepted expired — a control failure, and the first thing a
   money-laundering review looks for. One that has merely lapsed since is
   ordinary aging and is stated without alarm. Both dates come straight off the
   row; neither is inferred. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const expiredAtAudit = d => {
  const exp = String(d.expiry_date || '').slice(0, 10);
  const aud = String(d.created_at || '').slice(0, 10);
  return ISO_DAY.test(exp) && ISO_DAY.test(aud) && exp < aud;
};
/* `expiry_date` is text. A value that is present but does not read as a date is
   neither expired nor current, and rendering it plain is how "12 MAR 26" or a
   model's apology would sit in an identity column looking checked. */
const expiryUnreadable = d => {
  const v = String(d.expiry_date || '').trim();
  return !!v && !ISO_DAY.test(v.slice(0, 10));
};

/* Exact, lower-cased, trimmed. This is NOT an identity rule and is no longer
   used as one: identity goes through lib/identity.js and compares canonical
   forms, because two spellings of the same person's key are not the same string.
   What is left for this is the one lookup where an exact match is the whole
   truth — `kyc_documents.reviewed_by` against `users.id`, a uuid on both sides,
   where a near miss is a different person and must stay one. */
import { dealerText as vocabDealerText } from '../lib/vocabulary.js';

const key = v => String(v == null ? '' : v).trim().toLowerCase();

/* A row is a compliance decision only if the backend did not void it. This is
   the single predicate the whole screen partitions on. */
const isVoid = d => !!(d && d.void_reason);

/* A run summary is written for whoever is on call, and whoever is on call is
   NEXUS. Measured 5 Sep 2026 by rendering this screen against a failed KYC run:
   the audit trail and the retention ledger both printed the summary verbatim,
   and a summary the Error Handler wrote carries the execution's own URL, the
   failing node's name, the execution id and the host's address — four items in
   CONTROL-PLANE.md Part 4's table, on a screen that document did not audit.
   What the run was doing stays; where inside the system it stopped does not.
   Only the RENDERED text goes through here: every classifier on this screen
   reads the raw column, because redacting the evidence a verdict is computed
   from would change the verdict. Same function, same wording, as
   screens/automation.js `dealerSummary`. */
/* One redactor, held in lib/vocabulary.js. Until 5 Sep 2026 this screen carried
   its own byte-similar copy, and so did two others — and all three stripped
   WHERE a run stopped (the URL, the node, the execution id, the host) while
   leaving WHO we buy from standing in the sentence. Measured by rendering: a
   failing mail credential printed the supplier's name and its API host to the
   dealership, who can act on neither. Three copies is how that divergence
   happened; there is now one. Only the RENDERED text goes through it — every
   classifier below reads the raw column, because redacting the evidence a
   verdict is computed from would change the verdict. */
const dealerText = vocabDealerText;

const plural = (n, one, many) => (Number(n) === 1 ? one : many);

/* ── The verdict vocabulary ──────────────────────────────────────────────────
   Not invented here. `kyc_documents.verdict` is NOT NULL DEFAULT 'PENDING' and
   carries the CHECK constraint kyc_documents_verdict_check, read off the live
   database on 1 Sep 2026:

     CHECK (verdict = ANY (ARRAY['PENDING','APPROVED','REJECTED','ESCALATED']))

   so those four are the whole of it and there is no fifth. The writers confirm
   which of them are reachable: `Record KYC (Approved)` writes APPROVED,
   `Record KYC (Rejected)` writes REJECTED or ESCALATED depending on
   `withinLimit`, and `Record Non-Document` writes ESCALATED when the vision
   auditor was unavailable and REJECTED when it ran and said the image was not a
   document. Nothing writes PENDING — it arrives from the column default on any
   row inserted without a verdict, which is what a service-role backfill or a
   half-written row looks like.

   PENDING mattered enough to be worth this note. The screen used to test
   `!d.verdict` for "no verdict yet", which the NOT NULL constraint makes
   permanently false, and offered verdict tabs for only APPROVED, REJECTED and
   ESCALATED — so a PENDING row appeared under All and under nothing else, and
   the tabs did not sum to the table. An undecided KYC document silently missing
   from every filter on the compliance screen is the kind of omission this
   register exists to make impossible. */
const VERDICTS = {
  PENDING:   { label: 'Pending',   tone: 'warm', blurb: 'No decision has been recorded on this document yet.' },
  APPROVED:  { label: 'Approved',  tone: 'ok',   blurb: 'The auditor accepted the document.' },
  REJECTED:  { label: 'Rejected',  tone: 'hot',  blurb: 'The auditor refused the document and the customer was asked to send another.' },
  ESCALATED: { label: 'Escalated', tone: 'warm', blurb: 'Handed to a person: the retry limit was reached, or the auditor could not run at all.' },
};
const VERDICT_KEYS = Object.keys(VERDICTS);
const verdictKey = d => String((d && d.verdict) || '').trim().toUpperCase();
/* An unrecognised verdict is left to fall through to the shared `unknown` pill,
   which carries the hover text saying the dashboard has no wording for it. That
   is the honest outcome for a value the CHECK constraint does not permit and
   this file therefore cannot describe. A missing verdict is not a status at all
   and is said in words instead of painted as one. */
const verdictPill = d => {
  const k = verdictKey(d);
  if (!k) return '<span class="t-muted">No verdict recorded</span>';
  const m = VERDICTS[k];
  return m ? pill(m.label, m.tone, { verbatim: false }) : pill(k, undefined, { verbatim: true });
};
const verdictTone = d => {
  const m = VERDICTS[verdictKey(d)];
  return m ? m.tone : 'unknown';
};

/* ── The case-state vocabulary ───────────────────────────────────────────────
   SIX STATES, AND THE INVARIANT THAT UNKNOWN IS NOT ABSENCE.

   Until 1 Sep 2026 this screen had no word for the position a KYC CASE is in.
   It had a verdict vocabulary for register rows and a retention vocabulary for
   their files, and for a case with no register row at all it had only silence —
   which it printed as "No KYC document has been audited yet" beside two
   ESCALATED cases whose own audit rows quote the auditor's findings on the
   documents it read. Turning "I hold no row" into "it never happened" is the
   one mistake a compliance register may not make, and it needed a vocabulary to
   stop making it rather than a better sentence.

   These six are the whole of it and nothing here invents a seventh. Every one
   is a positive statement backed by a row somebody wrote; none is inferred from
   the absence of one, and `unknown` exists precisely so that an absence has
   somewhere to go that is not a denial.

     not_registered     No document was ever due in the register — read from the
                        AUDIT LOG's own record that the run stopped before it
                        reached one, never from the register being empty.
     pending            A register row exists and carries no decision yet.
     audited            A document was read and judged: a register row with a
                        decided verdict, or an auditor run that reached one.
     escalated          Handed to a person on purpose.
     deleted_or_purged  The file was deleted under the retention policy and
                        `purged_at` records it. This is the ONLY deletion this
                        system writes down anywhere.
     unknown            The position cannot be established. A document that WAS
                        audited and has no register row lands here, and so does
                        a read that failed. It is not a claim that nothing
                        exists — it is the refusal to make one.

   Applied on TWO axes, both out of this one vocabulary, because the data has
   two. The AUDIT side answers "what did the auditor do"; the REGISTER side
   answers "what survives of it". For the two live escalations those differ —
   escalated on one side, unknown on the other — and collapsing them to a single
   verdict would have to throw one away. They are stated together instead.

   THE MAPPING. Every value either column actually holds has exactly one
   destination, and there is no residual bucket:

     audit_log.status → lib/health.js outcome → audit-side state
       ESCALATED      → ESCALATED             → escalated
       SUCCESS        → SUCCESS               → audited
       PARTIAL        → PARTIAL               → audited
       FAILED         → FAILURE               → not_registered
       NOT_EXECUTED   → NO_RESULT             → not_registered
       REJECTED       → REJECTED_EXPECTED
                        or NO_RESULT          → not_registered
       anything else  → UNKNOWN               → unknown, and rendered as
                                                unrecognised rather than filed
                                                quietly under the same word

     kyc_documents.verdict → register-side state
       purged_at set  → deleted_or_purged, whatever the verdict says
       PENDING        → pending
       APPROVED       → audited
       REJECTED       → audited
       ESCALATED      → escalated
       anything else  → unknown. kyc_documents_verdict_check permits no fifth
                        value, so a row reaching that branch is itself a finding
                        and the pill says the state is unrecognised.

   Counted against the live database on 1 Sep 2026, `audit_log` holds FAILED,
   SUCCESS, REJECTED, PARTIAL, NOT_EXECUTED and ESCALATED and nothing else — six
   values, all six mapped above. The nine rows in KYC scope are seven FAILED and
   two ESCALATED. `kyc_documents` holds no row at all, so its verdict column
   contributes no live value and the mapping above is drawn over the CHECK
   constraint instead, which is complete. None of those counts is hard-coded
   below: every figure this screen prints is counted from the rows that loaded. */
const CASE_STATE = {
  not_registered:    { label: 'Not registered',        tone: 'cold',    icon: 'do_not_disturb_on',
    why: 'The audit log records that this run stopped before the auditor read a document, so no register row was ever due for it. Read from the run, not from the register being empty.' },
  pending:           { label: 'Pending',               tone: 'warm',    icon: 'hourglass_empty',
    why: 'A register row exists and carries no decision yet. PENDING is the column default, so this is also what a half-written or backfilled row looks like.' },
  audited:           { label: 'Audited',               tone: 'ok',      icon: 'fact_check',
    why: 'A document was read and judged — either a register row with a decided verdict, or an auditor run that reached one.' },
  escalated:         { label: 'Escalated',             tone: 'warm',    icon: 'front_hand',
    why: 'Handed to a person on purpose: the re-upload loop was exhausted, or the auditor could not run at all.' },
  deleted_or_purged: { label: 'Deleted or purged',     tone: 'cold',    icon: 'delete_sweep',
    why: 'purged_at is set, so the file was deleted under the retention policy and the deletion is recorded. This is the only kind of deletion this system writes down anywhere.' },
  unknown:           { label: 'Unknown · not recorded', tone: 'unknown', icon: 'help',
    why: 'The position could not be established. This is the refusal to make a claim, not a claim that nothing exists — a document that was audited and has no register row lands here, and so does a read that failed.' },
};
/* This re-emitted `pill()`'s markup by hand, because pill() attached "This
   dashboard has no wording for that status. It is shown exactly as the database
   holds it" to any grey pill whose LABEL is not a TONE key — which
   `Unknown · not recorded` is not. Both halves of that sentence are false here:
   the dashboard has a whole vocabulary block for this state, and the database
   holds nothing at all, which is the entire point of the state.

   `{ verbatim: false }` says that to pill() directly, so the markup is shared
   again. What stays is the only thing pill() cannot do: give each of the six
   its own hover text. That sits on a wrapper, the same shape overview.js,
   settings.js and ask.js already use to hang a blurb on a shared pill. */
const casePill = k => {
  const m = CASE_STATE[k];
  return `<span title="${esc(m.label)} — ${esc(m.why)}">${pill(m.label, m.tone, { verbatim: false })}</span>`;
};

/* The sentence this vocabulary exists to make sayable. Checked against
   information_schema on 1 Sep 2026: no table in `public` records a deletion —
   there is no tombstone table, no row history, nothing. So the two explanations
   for a missing register row cannot be told apart from the browser or from the
   database, and neither may be printed as the answer. */
const NOT_RECORDED =
  'The register holds no row for this case. Nothing this page can read says whether a row was never written or was written and later removed: no deletion appears in the activity log, and the schema carries no deletion log at all. That is unknown — which is not the same as nothing having happened, because the auditor’s own run for this case is on file.';

/* Audit-side. `outcomeOf` is lib/health.js's call and no status string is
   compared here; this table only decides what its answer means for a DOCUMENT.
   SUCCESS and PARTIAL reached a verdict on one. FAILURE, NO_RESULT and
   REJECTED_EXPECTED stopped before there was one to reach, so nothing was ever
   due in the register — a reading of the RUN, not of the register. */
const RUN_TO_CASE = {
  [OUTCOME.ESCALATED]:         'escalated',
  [OUTCOME.SUCCESS]:           'audited',
  [OUTCOME.PARTIAL]:           'audited',
  [OUTCOME.FAILURE]:           'not_registered',
  [OUTCOME.NO_RESULT]:         'not_registered',
  [OUTCOME.REJECTED_EXPECTED]: 'not_registered',
  [OUTCOME.UNKNOWN]:           'unknown',
};
const auditCaseState = a => RUN_TO_CASE[outcomeOf(a)] || 'unknown';

/* Register-side, off one row. The purge outranks the verdict because the file
   is gone either way and that is the fact a retention reviewer is reading for;
   the verdict is still shown beside it in its own column. */
const rowCaseState = d => {
  if (d.purged_at) return 'deleted_or_purged';
  const v = verdictKey(d);
  if (v === 'ESCALATED') return 'escalated';
  if (v === 'PENDING') return 'pending';
  if (v === 'APPROVED' || v === 'REJECTED') return 'audited';
  return 'unknown';
};
/* Worst-first, so a contact holding one purged row and one escalated row is
   reported as escalated rather than as the tidy half of itself. */
const CASE_SEVERITY = ['unknown', 'escalated', 'pending', 'audited', 'deleted_or_purged'];
/* Display order, worst-first, and it is the whole vocabulary — a state with a
   word but no place in this order would be counted and then not drawn. */
const CASE_ORDER = ['unknown', 'escalated', 'pending', 'audited', 'deleted_or_purged', 'not_registered'];

/* ── The retention vocabulary ────────────────────────────────────────────────
   WHERE THIS CAME FROM. `kyc_documents` is empty as of 1 Sep 2026, so the words
   below cannot be read off the data and were derived from the schema and from
   the two workflows that write these columns, both in /home/claude/repo:

     · the columns and their nullability — information_schema on the live
       database: storage_path text NULL, retain_until date NULL, purged_at
       timestamptz NULL, void_reason text NULL, created_at timestamptz NOT NULL
       DEFAULT now(), attempt_number int NOT NULL DEFAULT 1, max_attempts int
       NOT NULL DEFAULT 3.
     · `n8n-workflows/kyc_aml_document_auditor_re_upload_loop_phase_5.json`,
       node `Prepare Archive`: retain_until is computed as the audit date plus
       seven years and is written on EVERY path, including the ones where the
       upload is skipped or fails. So a row with a null retain_until was not
       written by this auditor.
     · same file, node `Merge Archive Result`: storage_path is set only when
       Storage returned a Key or an Id, and is explicitly nulled otherwise —
       "a NULL storage_path on a kyc_documents row is a visible compliance gap".
     · `n8n-workflows/nexus_retention_purge.json`, node `Find Expired
       Documents`: the purge selects exactly `storage_path IS NOT NULL AND
       purged_at IS NULL AND retain_until < today`. A null retain_until can
       never satisfy that, so such a row is never selected and is kept for ever.
     · same file, node `Mark Rows Purged`: purged_at is written ONLY for the
       objects Supabase confirmed it deleted, and `Reconcile Storage Deletions`
       leaves the rest deliberately unmarked so the next run retries them. A row
       still past retain_until with its file present is therefore a purge that
       did not complete, not a purge that has not been reached.
     · `v_needs_attention.kyc_archive_gap` (pg_get_viewdef, 1 Sep 2026) for what
       does and does not count as an archive gap.

   Every entry carries an explicit tone. Passing `undefined` and letting
   lib/format.js infer one from the label is what made Purged and Pre-archive
   render grey under the hover text "This dashboard has no wording for that
   status" — a sentence that was false twice over, since the purge working
   exactly as designed is the one retention outcome this dealership wants, and
   neither string is held in the database at all. */
const RETENTION = {
  retained:    { label: 'Archived',                     tone: 'ok',      icon: 'inventory_2' },
  overdue:     { label: 'Purge overdue',                tone: 'warm',    icon: 'schedule' },
  no_term:     { label: 'Archived, no retention term',  tone: 'warm',    icon: 'event_busy' },
  purged:      { label: 'Purged on schedule',           tone: 'cold',    icon: 'delete_sweep' },
  gap:         { label: 'No archived file',             tone: 'hot',     icon: 'folder_off' },
  gap_unknown: { label: 'No file · gap unconfirmed',    tone: 'warm',    icon: 'help' },
  unfiled:     { label: 'No file · not filed as a gap', tone: 'warm',    icon: 'help' },
  pre_archive: { label: 'Pre-archive',                  tone: 'cold',    icon: 'history' },
  voided:      { label: 'No file · voided row',         tone: 'cold',    icon: 'block' },
  undated:     { label: 'Undated',                      tone: 'warm',    icon: 'help' },
  /* The genuine fallback, and nothing routes here today: the branches in
     makeRetentionVerdict cover every combination of the four columns it reads.
     It exists so a future branch cannot crash a RETENTION[key] lookup, and so
     that if one is ever added without a word for it the screen says it does not
     recognise the state instead of guessing a nearby one. */
  unknown:     { label: 'Unrecognised retention state', tone: 'unknown', icon: 'help' },
};

const retentionPill = r => pill(RETENTION[r.key].label, RETENTION[r.key].tone, { verbatim: false });

/* ONE verdict per row, and the only place on this screen that decides one.
   `gapRefs` is the set of kyc_documents ids `v_needs_attention` files as
   `kyc_archive_gap`; `gapKnown` says whether that read succeeded. Membership of
   the archive gap is read from the view and is never recomputed here — see the
   header. Everything else is a plain reading of the row's own columns. */
function makeRetentionVerdict({ gapRefs, gapKnown }) {
  return function retentionOf(d) {
    if (d.purged_at) {
      return { key: 'purged', detail: `The file was deleted ${ago(d.purged_at)}, and the deletion was recorded only after the stored file was confirmed gone. This is the retention policy working.` };
    }
    if (d.storage_path) {
      if (!d.retain_until) {
        return { key: 'no_term', detail: 'The file is stored in the private kyc-documents bucket but the row carries no retain_until date. The nightly purge selects on retain_until, so a row without one is never selected and this document will be kept indefinitely. Every path through the KYC auditor writes a retain_until, so this row did not come from it.' };
      }
      if (isPastDate(d.retain_until)) {
        return { key: 'overdue', detail: `retain_until (${d.retain_until}) has passed and the file is still in the bucket. The purge either has not run or could not confirm the deletion — it deliberately leaves a row unmarked rather than claim a delete it did not verify, so the row is retried on the next run.` };
      }
      return { key: 'retained', detail: `The file is stored in the private kyc-documents bucket and is retained until ${d.retain_until}.` };
    }
    /* No file and no purge. Whether that is a compliance gap is the view's call,
       not this screen's, so the view is consulted before anything else. */
    if (!gapKnown) {
      return { key: 'gap_unknown', detail: 'No archived file was ever recorded for this document and none was deleted. Whether NEXUS files it as an archive gap could not be checked, because the attention list did not load on this page — so it is not claimed either way.' };
    }
    if (gapRefs.has(String(d.id))) {
      return { key: 'gap', detail: 'The document was audited but its file was never archived, and it was not deleted either. NEXUS files it as an archive gap: retention cannot be proven for a document whose file does not exist.' };
    }
    if (isVoid(d)) {
      return { key: 'voided', detail: 'No file was stored for this row, and the view excludes it from the archive gap because it is voided — it was never a KYC submission, so there is no retention obligation to fail. The image itself was not archived.' };
    }
    const t = Date.parse(d.created_at);
    if (!Number.isFinite(t)) {
      return { key: 'undated', detail: 'This row has no readable created_at timestamp, so it cannot be placed either side of the archive cut-over and nothing is claimed about why the view does not file it as a gap.' };
    }
    if (t <= ARCHIVE_EPOCH_MS) {
      return { key: 'pre_archive', detail: `Audited before archiving shipped (${ARCHIVE_EPOCH_LABEL}), so no file was ever stored for it. The attention list excludes rows older than that instant from the archive gap on the ground that they predate the feature. The document is still unprovable; it is simply not counted as a failure of a step that did not exist yet.` };
    }
    return { key: 'unfiled', detail: 'No archived file was ever recorded for this document and none was deleted, and it is newer than the archive cut-over, yet the attention list does not file it as an archive gap. Nothing here explains that, and it is deliberately not folded into either side. The most ordinary cause is timing — the row was written between the view read and the register read on this page load.' };
  };
}

/* The handful of row-level facts the register is actually read for. Each is a
   plain statement about one row — no score, no weighting, nothing the database
   did not say — and each is filterable so a banner can hand the reviewer the
   exact set it just counted instead of a number and a hunt. Built per page load
   rather than at module scope because the three retention findings read the
   retention verdict, which reads the view. */
const finalAttempt = d => {
  const a = n0(d.attempt_number), m = n0(d.max_attempts);
  return a != null && m != null && a >= m;
};
function makeFlags(retentionOf) {
  return {
    /* First, because it is the finding this register exists to surface. It
       matches on the retention verdict, which reads the view — so the filter,
       the pill, the KPI and the banner are one number by construction and there
       is no second predicate for them to drift from. */
    gap:       { label: 'No archived file',      match: d => retentionOf(d).key === 'gap' },
    expired:   { label: 'Expired when audited',  match: expiredAtAudit },
    tampering: { label: 'Tampering detected',    match: d => !!d.tampering },
    invalid:   { label: 'Marked not valid',      match: d => d.is_valid === false },
    final:     { label: 'Final attempt reached', match: finalAttempt },
    overdue:   { label: 'Purge overdue',         match: d => retentionOf(d).key === 'overdue' },
    no_term:   { label: 'No retention term',     match: d => retentionOf(d).key === 'no_term' },
  };
}

/* ── Who a row is actually about ─────────────────────────────────────────────
   kyc_documents.lead_name is whatever the workflow had to hand when it wrote the
   row, and for the auto-routed images that was the sender's WhatsApp profile
   name. Printing it in a Customer column is how "Abdul" and "~S" came to look
   like customers of this dealership. The resolution below is deliberately
   pessimistic: a row is only called a lead when an email on the record (or on
   the WhatsApp contact) matches an actual row in `leads`. Everything weaker is
   named as the weaker thing it is. */
const IDENTITY = {
  lead:             { label: 'Lead on file',       chip: '' },
  email_only:       { label: 'No lead row',        chip: 'No lead row' },
  whatsapp_profile: { label: 'WhatsApp profile',   chip: 'WhatsApp profile name' },
  phone_only:       { label: 'Phone only',         chip: 'Phone only' },
  unidentified:     { label: 'Unidentified',       chip: 'Unidentified' },
};
/* When the leads table itself could not be read, "no lead row" would be a claim
   the database never made. The label says unconfirmed instead. */
const UNCONFIRMED = { label: 'Lead unconfirmed', chip: 'Lead unconfirmed' };

function makeResolver({ personOf, canonOf, contacts, contactsErr, leads, leadsErr }) {
  return function who(d) {
    const id = personOf(d);
    const canon = canonOf(d);
    const chatId = String(d.chat_id || '').trim();
    /* The WhatsApp contact is found by CANONICAL key, not by an exact compare on
       this row's chat_id. A row filed under the customer's email reaches his
       contact row through the resolver, and the profile name and number on it
       are the same person's — which the old exact lookup could not see. */
    const contact = (contacts || []).find(c => {
      const k = normalizeKey(c.chat_id).canonical;
      return !!k && canon.has(k);
    }) || null;
    /* A lead only where the resolver absorbed one. `leadIds` is empty both when
       there is genuinely no lead and when the leads read failed and the pool was
       therefore empty; `leadsErr` is what separates those two, here as before —
       an absence with a failed read behind it is never reported as "no lead". */
    const lead = (leads || []).find(l => id.leadIds.includes(String(l.id))) || null;
    /* The address the resolver adopted, which is only ever a real email: a
       `+9715…@whatsapp.lead` in this column is a phone key wearing an address's
       clothes, and printing it under "Lead record" is how a synthesised routing
       key came to look like somewhere a customer could be written to. */
    const email = String(id.email || '').trim();
    /* What the lead row itself carries, which is a different question. Lead 34's
       `email` column literally holds `+971547484167@whatsapp.lead`. */
    const leadAddress = lead ? String(lead.email || '').trim() : '';
    const leadAddressIsEmail = normalizeKey(leadAddress).shape === KEY_SHAPE.EMAIL;
    const push = String((contact && contact.push_name) || '').trim();
    /* Two different phone numbers can exist for one person and they are not
       interchangeable: `leads.phone` is the number the dealership captured on
       the enquiry, `whatsapp_contacts.phone` is the number WAHA resolved from
       the chat. The lead record wins because that is the number a rep dials,
       and which one is on screen is stated — a number with no provenance is a
       number nobody acts on. Neither is taken from `identity.phone`, which
       holds whichever raw KEY the resolver anchored on and can be a
       `@whatsapp.lead` string rather than a dialable number. `users.phone` does
       not exist, so no staff number is available anywhere on this screen; that
       is said where staff appear. */
    const leadPhone = String((lead && lead.phone) || '').trim();
    const contactPhone = String((contact && contact.phone) || '').trim();
    const phone = leadPhone || contactPhone;
    const phoneFrom = leadPhone ? 'from the lead record'
      : contactPhone ? 'from the WhatsApp contact' : '';
    const rowName = String(d.lead_name || d.full_name || '').trim();

    let kind, name;
    if (lead) { kind = 'lead'; name = String(lead.name || '').trim() || rowName || email; }
    else if (email) { kind = 'email_only'; name = rowName || email; }
    else if (push || rowName) { kind = 'whatsapp_profile'; name = push || rowName; }
    else if (phone) { kind = 'phone_only'; name = phone; }
    else { kind = 'unidentified'; name = ''; }

    /* One plain-text line, assembled from facts only. It says what we have and,
       just as importantly, what we do not: a historic contact genuinely has no
       phone stored, and inventing one would be worse than the gap. */
    const bits = [];
    if (kind === 'lead') {
      bits.push(leadAddress
        ? (leadAddressIsEmail
            ? `${leadAddress} · matched to a lead record`
            : `matched to a lead record, whose own address column holds ${leadAddress} — a routing key, not somewhere this customer can be written to`)
        : 'matched to a lead record that carries no address at all');
    } else if (kind === 'email_only') {
      bits.push(email);
      bits.push(leadsErr ? 'Your leads could not be read, so this email is unconfirmed' : 'no matching row in leads');
    } else {
      bits.push(push
        ? 'WhatsApp profile name — not a customer record'
        : name
          ? 'name taken from the KYC row, which for these is the sender’s WhatsApp profile name — not a customer record'
          : 'no name captured for this contact');
      bits.push(leadsErr
        ? 'Your leads could not be read, so whether there is a lead behind this row is unconfirmed'
        : 'no lead behind this row');
    }
    /* PROVENANCE. The name shown is the one the customer record carries, but a
       KYC row IS an identity record and the name written on it is part of what
       is being audited. Where the two differ the row's own string is kept
       beside the resolved one rather than silently replaced — the substitution
       that made an audit_log escalation naming "Shabbir Ujjainwala" render as
       "Ali" with the recorded name nowhere on the page. */
    if (rowName && name && rowName !== name) bits.push(`recorded on this row as ${rowName}`);
    if (chatId) bits.push(chatId);
    else bits.push('no chat id on the row');
    if (contactsErr && !contact) bits.push('WhatsApp contact directory could not be read');
    /* Never swallowed. Two customers whose numbers end in the same nine digits
       are not merged by the resolver, and a register that quietly showed only
       the exact-key half of somebody's trail would be understating it with no
       sign on screen. */
    (id.ambiguity || []).forEach(a => bits.push(a.message));

    const marks = kind === 'email_only' && leadsErr ? UNCONFIRMED : IDENTITY[kind];
    return { kind, name, email, leadAddress, leadAddressIsEmail, phone, phoneFrom,
             chatId, contact, lead, rowName,
             ambiguous: !!id.ambiguous,
             contactMissing: !!chatId && !contact,
             label: marks.label, chip: marks.chip, line: bits.join(' · ') };
  };
}

const whoLabel = w => w.name || w.chatId || 'Unidentified contact';

/* The phone sits beside the name, not buried in the detail line: it is the one
   field on this row somebody might act on, and a reviewer who has found a
   problem needs to be able to ring the person about it. When there is no number
   the cell says so — a blank there reads as "not looked up" rather than "never
   captured", and the two call for different work. */
function whoCell(w) {
  const dup = w.phone && w.phone === w.name;
  return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      ${w.name ? esc(w.name) : '<span class="t-muted">No name on record</span>'}
      ${w.phone && !dup ? `<span class="mono">${esc(w.phone)}</span>` : ''}
      ${w.chip ? `<span class="chip">${esc(w.chip)}</span>` : ''}
    </div>
    <div class="cell-sub ${w.kind === 'lead' ? '' : 't-warm'}" style="white-space:normal">${
      w.phone ? esc(w.phoneFrom) : 'no phone stored for this contact'} · ${esc(w.line)}</div>`;
}

SCREENS.compliance = async host => {
  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const banners = el('div'); banners.style.marginTop = '16px'; host.appendChild(banners);
  const body = el('div'); body.style.marginTop = '16px'; host.appendChild(body);
  body.innerHTML = `<div class="card">${stateLoading(6)}</div>`;

  /* allSettled, not catch(() => []): a table that failed to load and a table
     with no rows look identical once the error is swallowed, and on this screen
     "there are no rejected documents" and "we could not read the register" are
     opposite answers. */
  const [docsR, contactsR, leadsR, auditR, commsR, gapR, healthR, usersR] = await Promise.allSettled([
    db(`kyc_documents?select=*&order=created_at.desc&limit=${ROW_LIMIT}`),
    /* The WhatsApp contact directory is what turns an opaque @lid handle into
       the profile name and phone number WAHA actually captured. */
    db('whatsapp_contacts?select=chat_id,phone,push_name,lead_email&limit=2000'),
    /* Read to answer two questions per row: is there a lead behind this at all,
       and what number would a reviewer ring. `leads.phone` exists; `users.phone`
       does not, which is why no staff number appears anywhere on this screen. */
    /* `id` is not optional here and its absence was a false-absence bug. The
       shared resolver reports an absorbed lead ONLY through `leadIds`, which
       lib/identity.js fills from `l.id` — so a pool selected without that column
       yields an empty `leadIds` for everybody, and both `who()` and `nameFor()`
       then printed "No lead row" / "no lead record" about customers who have
       one. Verified against the live database on 1 Sep 2026: the two escalated
       KYC cases carry shabbir53ujjainwala@gmail.com, which is lead 38, and the
       screen was calling that contact a WhatsApp profile with no lead behind
       it. Asserting a customer does not exist is the exact class of claim this
       screen is not allowed to make. */
    db('leads?select=id,name,email,phone&limit=2000'),
    /* ilike rather than one exact workflow name, so a renamed or versioned KYC
       workflow keeps appearing here instead of silently dropping out. */
    db(`audit_log?select=*&workflow=ilike.*KYC*&order=logged_at.desc&limit=${AUDIT_LIMIT}`),
    db(`communication_logs?select=lead_email,message,created_at&order=created_at.desc&limit=${COMM_LIMIT}`),
    /* THE archive gap. Not a second opinion on one — the only one. The view is
       the same row set the Overview panel and the nav badge count, its `ref` is
       `kyc_documents.id::text`, and it is read unfiltered so the count is over
       the whole table rather than over the capped page below. */
    db(`v_needs_attention?select=kind,ref,title,at&kind=eq.kyc_archive_gap&order=at.asc&limit=${GAP_LIMIT}`),
    /* Whether the two workflows behind this screen are working. Read whole and
       matched by name here, exactly as Ask AI does, so a renamed workflow drops
       out visibly rather than being matched to the wrong row. */
    db('v_workflow_health?select=name,category,is_active,writes_audit_log,runs_30d,failures_30d,partials_30d,no_result_30d,rejected_30d,successes_30d,effective_runs_30d,success_rate_30d,last_run,health&limit=200'),
    /* kyc_documents.reviewed_by is a uuid FK to users(id), not a name. Printing
       the raw column in a "Reviewed by" field puts an opaque id where a person
       goes, which is the same mistake as printing a chat id as a customer. */
    db('users?select=id,name&limit=2000'),
  ]);

  const val = r => r.status === 'fulfilled' ? r.value : null;
  const err = r => r.status === 'rejected' ? (r.reason?.message || 'Unknown error') : null;

  const docs = val(docsR);      const docsErr = err(docsR);
  const contacts = val(contactsR); const contactsErr = err(contactsR);
  const leads = val(leadsR);    const leadsErr = err(leadsR);
  const audit = val(auditR);    const auditErr = err(auditR);
  const comms = val(commsR);    const commsErr = err(commsR);
  const attn = val(gapR);       const attnErr = err(gapR);
  const health = val(healthR);  const healthErr = err(healthR);
  const users = val(usersR);    const usersErr = err(usersR);

  /* ── The single source for the archive gap ───────────────────────────────
     `gapKnown` is the difference between "no document is missing its file" and
     "we could not check", and on this screen those must never print the same
     sentence. Note the count is `gapRefs.size`, taken over the whole table,
     while `docs` is capped — so the gap can legitimately exceed the number of
     rows on the page, and where that happens the screen says so rather than
     quietly clamping one to the other. */
  const gapKnown = !!attn;
  const gapRefs = new Set((attn || []).map(a => String(a.ref)).filter(Boolean));
  const gapTotal = gapKnown ? gapRefs.size : null;
  const retentionOf = makeRetentionVerdict({ gapRefs, gapKnown });
  const FLAGS = makeFlags(retentionOf);
  /* The gap finding is only offered as a filter when its membership is known.
     A filter that silently matches nothing because a view did not load is worse
     than an absent one: it reads as an all-clear. */
  const FLAG_KEYS = Object.keys(FLAGS).filter(k => k !== 'gap' || gapKnown);

  /* ── What the two workflows behind this screen are actually doing ─────────
     Matched on the registry name because `audit_log.workflow` and
     `workflow_registry.name` are not the same strings — the auditor logs under
     two different names already. Every word about health comes from
     lib/health.js; nothing here compares a status. */
  const findHealth = re => {
    const hits = (health || []).filter(w => re.test(String(w.name || '')));
    /* Exactly one, or none. Two rows matching the same pattern means the
       registry has grown a second workflow this screen cannot tell apart, and
       silently reporting whichever came back first would attribute one
       workflow's failures to another. */
    return hits.length === 1 ? hits[0] : null;
  };
  const kycWf = findHealth(/kyc/i);
  const purgeWf = findHealth(/retention\s*purge/i);
  /* One sentence about a workflow, or an honest absence. `healthWords` covers
     every value v_workflow_health can return, including the three that are
     absences of evidence rather than health. */
  const wfLine = (w, label) => {
    if (healthErr) return `<span class="t-warm">The automation health figures could not be read (${esc(healthErr)}), so nothing is known here about ${esc(label)}.</span>`;
    if (!w) return `<span class="t-warm">No row in the automation health figures names ${esc(label)}, so its health is not known from here — which is itself worth fixing.</span>`;
    const hw = healthWords(w.health);
    const rate = successRate(w.successes_30d, w.effective_runs_30d);
    const runs = n0(w.runs_30d);
    return `<span class="t-${hw.tone === 'ok' ? 'ok' : hw.tone === 'hot' ? 'hot' : 'warm'}">${esc(label)}: ${esc(hw.label)}.</span> ${esc(hw.blurb)}${
      runs ? ` ${num(runs)} run${plural(runs, '', 's')} logged in the last 30 days${
        rate == null ? ', none of them rated' : `, ${num(Math.round(rate))}% of the rated ones succeeding`}.` : ''}${
      w.last_run ? ` Last run ${esc(ago(w.last_run))}.` : ' Nothing has been logged for it at all.'}`;
  };

  body.innerHTML = '';

  /* ── Identity, once, through the shared resolver ─────────────────────────
     One person reaches this screen under as many as four different keys.
     `communication_logs.lead_email` and `kyc_documents.lead_email` are the same
     free-text column: an address when the lead is known, a `@lid`, a `@c.us` or
     a synthesised `+…@whatsapp.lead` when it is not. lib/identity.js is the only
     thing on this product allowed to say that two of those name one human being,
     because it applies the last-nine-digit rule the workflows used to WRITE the
     rows. The private union-find that used to sit here compared exact strings
     and measured 8 / 0 / 17 rows for leads 34 / 35 / 38 where this reaches
     8 / 10 / 29 — see the header for what it lost and why it never showed.

     `whatsapp_contacts` goes in as the links and `leads` as the candidate pool,
     both whole, so every row is resolved against the same evidence and two rows
     for one person cannot land on two different answers. When a read failed the
     corresponding side is simply empty here; the panels that would otherwise
     assert an absence check `contactsErr` / `leadsErr` themselves. */
  const LINKS = contacts || [];
  const POOL = leads || [];
  const resolvePerson = rawKeys => {
    const seed = { keys: rawKeys.filter(k => String(k || '').trim()) };
    const first = expandIdentity(seed, { links: LINKS, leads: POOL });
    /* The second pass exists for exactly one shape: a row that carries only a
       chat id. The first pass learns the person's number from the linked
       whatsapp_contacts row, but the lead pool was scanned before that link was
       absorbed, so no lead is adopted and the row would be labelled "WhatsApp
       profile · no lead row" about a customer who has one. Re-seeding with the
       number the first pass found lets the same resolver answer the same
       question with the evidence it now has. It is the shared rule run twice,
       not a second rule: a phone-suffix collision is still detected and still
       refuses to merge, and a row that already resolved to a lead never gets
       here. */
    if (first.leadIds.length || !first.digits) return first;
    return expandIdentity({ ...seed, phone: first.digits }, { links: LINKS, leads: POOL });
  };
  /* Resolved once per row object. Every panel below reads these, so the register,
     the banners, the voided section, the trail and the drawer cannot disagree
     about who somebody is. */
  const PERSON = new Map();
  const personOf = d => {
    if (!PERSON.has(d)) PERSON.set(d, resolvePerson([d.lead_email, d.chat_id]));
    return PERSON.get(d);
  };
  /* THE comparison form. A person is a set of `normalizeKey().canonical` values,
     never a set of raw strings: the same address appears in more than one casing,
     the same number under three suffixes, and — the reason this is canonical and
     not lower-cased — a 15-digit `@lid` whose last nine digits happen to match a
     phone number is a machine id and must never collide with that phone. */
  const canonSet = id => new Set((id.keys || [])
    .map(k => normalizeKey(k).canonical).filter(Boolean));
  const CANON = new Map();
  const canonOf = d => {
    if (!CANON.has(d)) CANON.set(d, canonSet(personOf(d)));
    return CANON.get(d);
  };
  /* Does this raw key off a communication_logs or audit_log row belong to that
     person? An unusable key — empty, a group id, a fragment — canonicalises to
     '' and belongs to nobody, which is the answer rather than a match on
     everybody. */
  const owns = (set, raw) => {
    const c = normalizeKey(raw).canonical;
    return !!c && set.has(c);
  };
  const unionOf = rows => {
    const out = new Set();
    rows.forEach(d => canonOf(d).forEach(c => out.add(c)));
    return out;
  };
  /* One stable id per person. This is the resolver's own answer (`personKey`),
     not a column picked here — and it converges across a person's rows because
     every call is given the whole contacts table, so a row filed under an email
     and a row filed under that customer's chat id reach the same closure. A row
     that identifies nobody has no personKey and is counted as unattributable
     rather than grouped with the other unattributable ones. */
  const canonKey = d => String(personOf(d).personKey || '');

  const who = makeResolver({ personOf, canonOf, contacts, contactsErr, leads, leadsErr });
  /* Resolved once per row so the register, the banners, the voided section and
     the drawer cannot disagree about who somebody is. */
  const WHO = new Map();
  (docs || []).forEach(d => WHO.set(d, who(d)));
  const whoOf = d => WHO.get(d) || who(d);

  /* THE partition. `live` is the compliance register; `voided` is the incident.
     Nothing below may count the two together. */
  const live = (docs || []).filter(d => !isVoid(d));
  const voided = (docs || []).filter(isVoid);

  /* Keys that belong only to voided rows. A customer-facing message addressed to
     one of these went to somebody who never submitted anything, so it must not
     be counted as an approval or a rejection either. A key that also appears on
     a live row is deliberately left out of this set — that contact is a real
     submitter and their messages are real. */
  const liveCanon = unionOf(live);
  const voidCanon = new Set();
  voided.forEach(d => canonOf(d).forEach(c => { if (!liveCanon.has(c)) voidCanon.add(c); }));

  /* How many distinct people the live register is actually about, and whether it
     is exactly one. This is the number that decides whether any proportion on
     this screen means anything: a bar drawn across nine rows filed by one man is
     a shape, not a share, and a verdict split across them is a history, not a
     rate. A row that carries neither a chat id nor an email cannot be attributed
     to anybody, so its presence disqualifies the single-trail claim rather than
     being quietly folded into it. */
  const liveContacts = new Set(live.map(canonKey).filter(Boolean));
  const liveUnkeyed = live.filter(d => !canonKey(d)).length;
  const oneTrail = live.length > 0 && liveContacts.size === 1 && liveUnkeyed === 0;

  const kycComms = (comms || []).filter(c => String(c.message || '').startsWith('[KYC-'));
  const kycCommsVoid = kycComms.filter(c => owns(voidCanon, c.lead_email));
  /* Every contact key that has a row in the register at all, voided or not.
     A [KYC-APPROVED] message to one of these is NOT "an approval that survives
     only in the message log" — that contact has rows, and communication_logs
     carries no document id, so which row the message belongs to is unknowable.
     The earlier version of this counted every message that was not addressed to
     a void-only chat, which meant a contact who sent both a real document and a
     greeting card had the greeting card's message counted as an extra approval
     under the Approved tile. Restricting the count to keys with no row at all
     is the only version of the claim the data supports. */
  const docCanon = unionOf(docs || []);
  const kycCommsUnlinked = kycComms.filter(c => !owns(docCanon, c.lead_email));
  /* Voided rows are identified from the register. If the register could not be
     read there is no void list, so anything below that filters on one has to
     say it could not. Silently reporting an unfiltered count as a filtered one
     is the precise failure this screen exists to prevent. */
  const voidFilterKnown = !!docs;
  /* audit_log carries no void marker, so voided routings are excluded the only
     honest way available: by the contact key they were logged against.
     Classified through lib/health.js rather than by comparing `a.status` here:
     that module mirrors public.nexus_outcome_class(), which is what the rebuilt
     v_workflow_health counts on, and a private status comparison on this screen
     is exactly how four screens came to disagree about what a run had done. */
  const escalations = (audit || []).filter(a =>
    outcomeOf(a) === OUTCOME.ESCALATED && !owns(voidCanon, a.lead_email));

  /* ── THE register against THE audit history ──────────────────────────────
     The one place on this screen that reconciles "the register is empty" with
     "the auditor has been auditing", and the reason it exists is in the header.
     `kyc_documents` is what SURVIVES an audit; `audit_log` is the audit. Two
     panels were stating those two facts about the same afternoon in words that
     contradicted each other, so both statements now come from here.

     Which runs got as far as a document is lib/health.js's call and not this
     screen's — no status string is compared anywhere below. SUCCESS, PARTIAL and
     ESCALATED all mean the auditor reached a verdict; a run that died at the
     vision call or the auth gate read nothing and is deliberately not counted,
     because counting it would turn an outage into an accusation.

     Escalations already exclude runs logged against voided contacts; the same
     exclusion is applied to the wider set for the same reason — a machine
     verdict on a greeting card is not a KYC audit. */
  const VERDICT_REACHED = new Set([OUTCOME.SUCCESS, OUTCOME.PARTIAL, OUTCOME.ESCALATED]);
  const auditRows = (audit || []).filter(a => !owns(voidCanon, a.lead_email));
  const reachedVerdict = auditRows.filter(a => VERDICT_REACHED.has(outcomeOf(a)));
  const auditCapped = !!audit && audit.length >= AUDIT_LIMIT;
  const auditCapNote = auditCapped
    ? ` Counted within the ${num(AUDIT_LIMIT)} most recent auditor runs; older ones are not on this page.`
    : '';

  /* ── The six-state position of every auditor run ─────────────────────────
     One entry per run, carrying BOTH axes of the vocabulary at the top of this
     file: what the auditor did, and what the register holds of it. They are
     computed separately because on the live data they disagree — two runs that
     reached a document and escalated it, against a register that holds neither
     — and a screen with only one of them has to either invent a deletion or
     deny the audit. It does neither; it says both and names what is unknowable.

     The register side is looked up through the SHARED resolver, so a run logged
     under an address and a row filed under that same customer's @lid land on
     one another. A raw string compare here would report "no register row" for a
     case whose row is sitting in the table above, which is the same false
     absence this whole block exists to stop. */
  const caseOf = a => {
    const audit = auditCaseState(a);
    const ks = canonSet(resolvePerson([a.lead_email]));
    /* `docs`, not `live`. A voided row is still a row, and reporting "no row"
       while one sits in the voided table below would be the same false absence
       wearing a different hat. Which rows those are is said in the note. */
    const rows = ks.size && docs
      ? docs.filter(d => [...canonOf(d)].some(k => ks.has(k)))
      : [];
    if (!docs) {
      return { audit, register: 'unknown', rows,
        note: `The register could not be read on this page load (${docsErr || 'unknown error'}), so where this case stands in it is unknown here. That is not a claim that it holds nothing.` };
    }
    if (rows.length) {
      const states = rows.map(rowCaseState);
      const k = CASE_SEVERITY.find(s => states.includes(s)) || 'unknown';
      const voidedHere = rows.filter(isVoid).length;
      return { audit, register: k, rows,
        note: `${num(rows.length)} register row${rows.length === 1 ? '' : 's'} ${plural(rows.length, 'belongs', 'belong')} to this contact${
          voidedHere ? `, ${num(voidedHere)} of ${plural(rows.length, 'which is', 'them')} voided as a non-submission` : ''}.` };
    }
    if (audit === 'unknown') {
      return { audit, register: 'unknown', rows,
        note: 'This run carries a status NEXUS does not define, so what it reached is unrecognised — and with it unknown whether anything was ever due in the register. Nothing is claimed either way.' };
    }
    /* The ONLY branch allowed to say a document is not in the register, and it
       says it from the run rather than from the register's silence: the audit
       log records that this run stopped before the auditor read a document, so
       there was never a row to write. It is tested BEFORE the missing-key check
       below, because whether a contact key resolves is irrelevant to a run that
       was never going to file anything — reporting those as unknown made the
       trail print "Unknown · not recorded" against seven auth-gate and vision
       failures, which overstates a plain outage as a possible lost record. */
    if (audit === 'not_registered') {
      return { audit, register: 'not_registered', rows,
        note: 'No document was ever due in the register for this run: the audit log records that it stopped before the auditor reached one. That is read from the run itself, not from the register being empty.' };
    }
    /* From here the run DID reach a document, so a register row was owed and
       its absence is a finding. Without a resolvable key we cannot even look,
       which is a weaker position again and is said as one. */
    if (!ks.size) {
      return { audit, register: 'unknown', rows,
        note: 'This run reached a document but carries no contact key that resolves to anybody, so no register row can be looked up for it at all. Its position in the register is unknown, not empty.' };
    }
    return { audit, register: 'unknown', rows, note: NOT_RECORDED };
  };
  /* Memoised per row object — the banner, the reconciliation list and the trail
     all ask about the same runs, and resolving identity three times is three
     chances to answer differently. */
  const CASES = new Map();
  const caseFor = a => {
    if (!CASES.has(a)) CASES.set(a, caseOf(a));
    return CASES.get(a);
  };
  /* Cases the auditor got as far as a document on, whose register position this
     page cannot establish. This is the set the old "No KYC document has been
     audited yet" sentence was silently reporting as zero. */
  /* Cases the auditor got as far as a document on whose register position this
     page cannot establish — the set the old "No KYC document has been audited
     yet" sentence was silently reporting as nothing at all. */
  const unrecorded = reachedVerdict.filter(a => caseFor(a).register === 'unknown');
  /* Plain text, not markup: stateEmpty escapes its body, and this sentence has
     to read identically wherever it is shown. */
  function registerVsAudit() {
    if (auditErr) {
      return { known: false, reached: 0, escalated: 0,
        text: `The audit log could not be read (${auditErr}), so whether anything has been audited cannot be checked against this register on this page. An empty register on its own does not answer it.`,
        short: 'The audit log could not be read, so the emptiness of this register proves nothing either way.' };
    }
    const reached = reachedVerdict.length;
    const esc_ = escalations.length;
    if (!reached) {
      const dead = auditRows.length - reached;
      return { known: true, reached: 0, escalated: 0,
        text: `No document is on file in the register, and no run of the KYC auditor read on this page got as far as a verdict on one either. That is consistent with nothing having been submitted, but it is not proof of it: a document whose audit run failed before the verdict leaves no row in either place`
          + (dead ? `, and ${dead} of the ${auditRows.length} runs here did exactly that` : '')
          + `.${auditCapNote}`,
        short: 'No auditor run on this page reached a verdict either — which is consistent with nothing having been submitted, but is not proof of it.' };
    }
    return { known: true, reached, escalated: esc_,
      text: `The register holds no row, and that is NOT the same as nothing having been audited. The audit log read on this page records ${reached} run${reached === 1 ? '' : 's'} of the KYC auditor that got as far as a verdict on a document`
        + (esc_ ? `, ${esc_ === reached ? (esc_ === 1 ? 'and it was' : 'and all of them were') : `${esc_} of them`} handed to a person after the re-upload loop was exhausted` : '')
        + `. Those documents were read and judged. The register row each of those runs should have left behind is not here, and nothing this page can read says whether it was never written or was written and later removed — no deletion appears in the audit log. Retention cannot be proven for a document the register does not hold, so this is a finding in its own right and not an absence of activity.${auditCapNote}`,
      short: `${reached} auditor run${reached === 1 ? '' : 's'} on this page reached a verdict on a document and left no register row.` };
  }
  const recon = registerVsAudit();

  /* ── Every compliance figure on this screen, computed exactly once ────────
     The KPI, the banner, the alert strip, the stacked bar, the filter counts
     and the detail table are five renderings of the same handful of numbers.
     Each of them used to derive its own — three separate tallies of the verdict
     split, two of the retention split, four of the archive gap — and numbers
     computed twice are numbers that can disagree. They are computed here, once,
     and every panel below reads these and nothing else. */
  const liveGaps = gapKnown ? live.filter(d => retentionOf(d).key === 'gap') : [];
  /* The gap this screen reports is the view's count over the whole table.
     `liveGaps` is only the part of it the capped page can actually show, and
     where the two differ the difference is stated rather than reconciled. */
  const gapsOffPage = gapTotal == null ? null : Math.max(0, gapTotal - liveGaps.length);
  const overdueRows = live.filter(d => retentionOf(d).key === 'overdue');
  const noTermRows = live.filter(d => retentionOf(d).key === 'no_term');
  const retentionCounts = {};
  live.forEach(d => { const k = retentionOf(d).key; retentionCounts[k] = (retentionCounts[k] || 0) + 1; });
  /* Keyed on the CHECK vocabulary, with a tail for anything outside it, so the
     verdict tabs always sum to the table underneath them. */
  const verdictCounts = {};
  VERDICT_KEYS.forEach(v => { verdictCounts[v] = 0; });
  let verdictUnrecognised = 0;
  let verdictMissing = 0;
  live.forEach(d => {
    const k = verdictKey(d);
    if (!k) verdictMissing += 1;
    else if (VERDICTS[k]) verdictCounts[k] += 1;
    else verdictUnrecognised += 1;
  });
  const verdictOther = verdictUnrecognised + verdictMissing;
  const voidedChats = new Set(voided
    .map(v => normalizeKey(v.chat_id).canonical).filter(Boolean)).size;
  /* Only APPROVED rows count: a rejected expired document is the control
     working, not failing. */
  const acceptedExpired = live.filter(d => expiredAtAudit(d) && verdictKey(d) === 'APPROVED');

  const commKind = m => String(m || '').startsWith('[KYC-APPROVED]') ? 'APPROVED'
    : String(m || '').startsWith('[KYC-REJECT]') ? 'REJECTED' : 'KYC MESSAGE';
  /* The three shapes a [KYC-…] line can take, each with an explicit tone. The
     generic one used to be spelled 'KYC MESSAGE' and handed to pill() with no
     tone, which resolved it to the unrecognised-status grey and the hover text
     saying the dashboard has no wording for it — for a string this file writes
     itself, three lines above. */
  const COMM_KIND_TONE = { APPROVED: 'ok', REJECTED: 'hot', 'KYC MESSAGE': 'cold' };

  /* Messages actually delivered to the chat behind a row. Returns null — not an
     empty list — when the message log could not be read, because "we sent them
     nothing" and "we cannot tell" are different answers and the second one must
     never be printed as the first. */
  const commsFor = d => {
    if (!comms) return null;
    const ks = canonOf(d);
    if (!ks.size) return [];
    return kycComms.filter(c => owns(ks, c.lead_email));
  };

  /* One display name and one phone number per contact key, resolved from
     whatsapp_contacts and leads rather than from whatever string the workflow
     logged into the row. Defined here, above the banners, because the alert
     strip has to be able to name the person an escalation is about — a banner
     that says "1 case needs a human" without saying who is not actionable. */
  /* The same resolver, seeded from the single key an audit_log or
     communication_logs row carries. It used to be two exact-match maps —
     `chat_id` on one side, `leads.email` on the other — which could not resolve
     a `+9185…@whatsapp.lead` key at all and rendered it raw in the trail, in the
     place a person's name goes. Memoised on the key string because the trail
     calls it once per row. */
  const NAMED = new Map();
  const nameFor = (raw, recorded) => {
    const k = String(raw == null ? '' : raw).trim();
    const rec = String(recorded == null ? '' : recorded).trim();
    const memoKey = k + '\u0000' + rec;
    if (NAMED.has(memoKey)) return NAMED.get(memoKey);
    const out = (() => {
      if (!k) return { name: null, phone: '', note: 'no contact key on this log row', recorded: rec };
      const id = resolvePerson([k]);
      const lead = POOL.find(l => id.leadIds.includes(String(l.id))) || null;
      const set = canonSet(id);
      const c = LINKS.find(x => {
        const ck = normalizeKey(x.chat_id).canonical;
        return !!ck && set.has(ck);
      }) || null;
      /* leads.phone first, then the number WAHA resolved for the chat. Neither is
         invented and neither is derived from the chat id, which for a @lid handle
         contains no phone digits at all. Never taken from identity.phone, which
         holds a raw key and can be a `@whatsapp.lead` string. */
      const phone = String((lead && lead.phone) || (c && c.phone) || '').trim();
      const amb = (id.ambiguity || []).map(a => a.message).join(' ');
      /* "No lead record" is a claim about the leads table, and it may only be
         made when that table was actually read. With `leadsErr` set the pool was
         empty, so every row would resolve to no lead — printing that as a fact
         would turn a failed read into an assertion about a customer, on the
         screen where that is least acceptable. */
      const noLead = leadsErr
        ? 'Your leads could not be read, so whether there is a lead record is unknown here'
        : 'no lead record';
      if (lead) return { name: String(lead.name || '').trim() || k, phone,
                         note: 'lead on file' + (amb ? ' · ' + amb : ''), recorded: rec };
      if (c && String(c.push_name || '').trim()) {
        return { name: String(c.push_name).trim(), phone,
                 note: `WhatsApp profile name · ${noLead}` + (amb ? ' · ' + amb : ''), recorded: rec };
      }
      if (phone) return { name: phone, phone,
                          note: `phone only · ${noLead}` + (amb ? ' · ' + amb : ''), recorded: rec };
      /* Falls through to the raw key, which for a WhatsApp-only contact is a chat
         id. It is rendered as an id in mono, never as a name. */
      return { name: null, phone: '', note: k, recorded: rec };
    })();
    NAMED.set(memoKey, out);
    return out;
  };

  /* `kyc_documents.reviewed_by` is uuid REFERENCES users(id) ON DELETE SET NULL
     — not a name. It used to be printed straight into a "Reviewed by" field,
     which put a uuid where a person goes, and a reviewer reading "by
     3f2a…" cannot tell whether that is a colleague or a service account. It is
     resolved through the users table; when it does not resolve the id is shown
     as an id and labelled as one, rather than dressed up as a name. */
  const userById = new Map();
  (users || []).forEach(u => { const k = key(u.id); if (k) userById.set(k, String(u.name || '').trim()); });
  const reviewerOf = d => {
    const id = String((d && d.reviewed_by) || '').trim();
    if (!id) return null;
    const name = userById.get(key(id)) || '';
    return { id, name, note: name ? 'staff record in users' : (usersErr
      ? 'the users table could not be read, so this id could not be resolved to a person'
      : 'no row in users carries this id — the staff record may have been deleted') };
  };
  const reviewerCell = d => {
    const r = reviewerOf(d);
    if (!r) return '';
    return r.name
      ? `by ${esc(r.name)}`
      : `by <span class="mono">${esc(r.id)}</span> <span class="t-muted">(user id — ${esc(r.note)})</span>`;
  };

  /* ── KPI strip ─────────────────────────────────────────────────────────── */
  if (!docs) {
    /* A full-width failure notice, not one squeezed into the first of five
       columns where it reads as a broken tile rather than a message. */
    strip.classList.remove('grid', 'g5');
    strip.innerHTML = stateError('the KYC register', docsErr);
  } else {
    const legacyApproved = kycCommsUnlinked.filter(c => c.message.startsWith('[KYC-APPROVED]')).length;
    const legacyRejected = kycCommsUnlinked.filter(c => c.message.startsWith('[KYC-REJECT]')).length;
    const pending = verdictCounts.PENDING;
    /* Every message-derived line on this strip is bounded by the message-log
       read. Saying so is the difference between "no older approval exists" and
       "we read the newest COMM_LIMIT rows and found none". */
    const commCapped = !!comms && comms.length >= COMM_LIMIT;

    /* ── STAGE 1.9 · three zeros that were not measurements ────────────────
       AUDIT-2026-09-04.md, the one frontend defect it found: this strip
       rendered `Approved 0`, `Rejected 0` and `Escalated 0` as bare numbers
       with no caption, and a dealer reads three zeros beside the word
       "Compliance" as "no problems today".

       They are not that. A verdict lands on a row here only when the document
       auditor writes one; NOTHING IN THIS DASHBOARD CAN RECORD A KYC DECISION —
       this screen makes no write and calls no endpoint, and there is no control
       anywhere in the build that files one. So a zero on these three tiles is
       the register holding no such row. It is not a count of documents that
       were considered and not approved, and it is emphatically not evidence
       that no decision was ever taken: `legacyApproved` and `legacyRejected`
       below count decisions that WERE messaged to a customer and left no
       register row at all, which is the same zero standing over real events.

       PRODUCT.md forbids exactly this shape, and lib/health.js already carries
       the rule in one line — "a rate may only be shown when something
       qualified; zero qualifying runs is not 0% and it is not 100%". The same
       reasoning applies to a count: with no decision on file there is nothing
       to count, so the tile prints the em dash this screen already uses for an
       unknown ("No archived file" does it three tiles along) and says which
       absence it is.

       The condition is deliberately "no decision of ANY kind is on file", not
       "this particular verdict is zero". Once the auditor has decided anything,
       the register is demonstrably being written and a zero on one of the three
       is then a real measurement of that verdict — so it prints as a number
       from that moment on, and this branch stops firing on its own. */
    const decidedOnFile =
      verdictCounts.APPROVED + verdictCounts.REJECTED + verdictCounts.ESCALATED;
    const NO_DECISION_CAPABILITY =
      'Not zero \u2014 nothing to count. No decision of any kind is on file, and nothing here can record one; the document auditor is the only writer.';
    /* One tile builder for the three, so they cannot drift apart: the same
       condition, the same words, the same em dash. */
    const verdictTile = (label, k, caption, evidence) => kpi(
      label,
      decidedOnFile ? num(verdictCounts[k]) : '\u2014',
      decidedOnFile
        /* A real count, so the tile's own caption applies. */
        ? caption
        /* No count, so the caption written for one does not: "not 0 rejected
           customers" beside an em dash is a sentence about a number that is not
           there. Only the evidence that decisions DID happen off-register
           survives, because that is the thing which makes the dash mean
           something rather than look like a shrug. */
        : `<span class="t-warm">${esc(NO_DECISION_CAPABILITY)}</span>${evidence ? ` ${evidence}` : ''}`);
    const commCap = commCapped ? ` <span class="t-muted">Counted within the ${num(COMM_LIMIT)} most recent message-log rows; older ones are not on this page.</span>` : '';

    strip.innerHTML = [
      kpi('Genuine submissions', num(live.length),
        voided.length
          ? `<span class="t-warm">${num(voided.length)} further row${voided.length === 1 ? ' was' : 's were'} voided and ${voided.length === 1 ? 'is' : 'are'} excluded from every figure here</span>`
          : (live.length
              ? (oneTrail
                  /* The single most load-bearing sentence on this strip. Without
                     it "9" reads as nine customers, and every tile beside it
                     reads as a picture of the dealership's compliance rather
                     than of one man's repeated attempts to send an ID. */
                  ? `<span class="t-warm">All ${num(live.length)} filed by one customer — this is a single document trail, not a book of them${
                      pending ? `, and ${num(pending)} of them ${plural(pending, 'is', 'are')} still Pending` : ''}</span>`
                  : pending
                    ? `<span class="t-warm">${num(pending)} ${plural(pending, 'is', 'are')} still Pending — no decision recorded</span>`
                    : '<span class="t-muted">Every row carries a decided verdict</span>')
              /* The empty register is where this screen is most easily wrong.
                 "Nothing has been submitted", "the auditor failed every run it
                 made" and "it audited documents that were never filed" all
                 produce the same zero, and only the first is good news. The tile
                 states the scope of its own number and points at the one place
                 the three are told apart, rather than carrying a second wording
                 of it. */
              : `<span class="t-warm">No genuine document on file in the register.</span> <span class="t-muted">${esc(recon.short)} Set out in the retention panel below.</span>`)),
      /* Counts, never a share of the tile beside them. With one customer on
         file an "approval rate" would be a statistic about a single person's
         paperwork dressed up as a statistic about the business, so no tile here
         divides by any other and the subtitle says why. */
      verdictTile('Approved', 'APPROVED',
        legacyApproved
          ? `<span class="t-muted">${num(legacyApproved)} older approval${legacyApproved === 1 ? ' was messaged to a contact' : 's were messaged to contacts'} with no row in this register at all.</span>${commCap}`
          : (oneTrail ? `<span class="t-muted">Attempts by one customer — counted, not rated</span>` : ''),
        legacyApproved
          ? `<span class="t-muted">${num(legacyApproved)} approval${legacyApproved === 1 ? ' was' : 's were'} messaged to a contact with no row in this register at all.</span>${commCap}`
          : ''),
      verdictTile('Rejected', 'REJECTED',
        legacyRejected
          ? `<span class="t-muted">${num(legacyRejected)} older rejection${legacyRejected === 1 ? ' was messaged to a contact' : 's were messaged to contacts'} with no row in this register at all.</span>${commCap}`
          : (oneTrail ? `<span class="t-muted">Re-uploads from the same person, not ${num(verdictCounts.REJECTED)} rejected customers</span>` : ''),
        legacyRejected
          ? `<span class="t-muted">${num(legacyRejected)} rejection${legacyRejected === 1 ? ' was' : 's were'} messaged to a contact with no row in this register at all.</span>${commCap}`
          : ''),
      /* The number is the REGISTER's, like every other verdict tile here, and
         the caption says so — a zero beside "2 escalations logged" reads as a
         contradiction until the two are named as counts of different things. */
      verdictTile('Escalated to a human', 'ESCALATED',
        escalations.length
          ? `<span class="t-warm">${num(escalations.length)} escalation${escalations.length === 1 ? '' : 's'} logged by the auditor${
              verdictCounts.ESCALATED ? '' : `, and no escalated document appears among the ${num(docs.length)} register row${docs.length === 1 ? '' : 's'} loaded here`}.</span> <span class="t-muted">This tile counts rows in the register; the escalations are runs the auditor recorded. Where a case is escalated and this register holds no row for it, its register position is <strong>${esc(CASE_STATE.unknown.label)}</strong> — not proof the document does not exist. Set out case by case in the retention panel below.</span>`
          : (auditErr ? '<span class="t-muted">The run history could not be read</span>' : ''),
        escalations.length
          ? `<span class="t-warm">${num(escalations.length)} escalation${escalations.length === 1 ? ' was' : 's were'} recorded by the auditor with no matching register row.</span>`
          : (auditErr ? '<span class="t-muted">The run history could not be read either, so nothing rules an escalation in or out.</span>' : '')),
      /* One number, one source. This tile, the banner below it, the nav badge
         and the Overview panel all count the rows v_needs_attention files as
         kyc_archive_gap, and this screen no longer holds a predicate of its own
         that could return a different answer. */
      kpi('No archived file', gapKnown ? num(gapTotal) : '—',
        !gapKnown
          ? `<span class="t-warm">The attention list could not be read (${esc(attnErr || 'unknown error')}), so how many documents cannot be produced is not known on this page. That is not zero.</span>`
          : gapTotal
            ? `<span class="t-hot">Filed as an archive gap — audited, and its file was never archived, so retention cannot be proven for ${plural(gapTotal, 'it', 'them')}.</span>${
                gapsOffPage ? ` <span class="t-muted">${num(gapsOffPage)} of ${plural(gapTotal, 'it', 'them')} ${plural(gapsOffPage, 'is', 'are')} older than the ${num(ROW_LIMIT)} rows this page loads and ${plural(gapsOffPage, 'is', 'are')} not in the table below.</span>` : ''}`
            : (live.length
                ? '<span class="t-ok">The database files no document as an archive gap</span>'
                : '<span class="t-muted">Nothing genuine to archive yet</span>'),
        gapKnown && gapTotal ? 't-hot' : ''),
    ].join('');
  }

  /* ── Banners ───────────────────────────────────────────────────────────── */
  /* Every banner states a count and then hands the reviewer that exact set.
     A banner that reports "3 documents have no archived file" and then leaves
     you to reconstruct the filter by hand is a dead end, and the two can drift
     apart. They all drive one setter, which moves the controls and the rows
     together, so the filter row can never disagree with the list under it. */
  let focusRegister = () => {};
  let focusVoided = () => {};
  let focusTrail = () => {};

  /* The incident banner leads, because a reviewer who reads the register without
     knowing about it will draw the wrong conclusion from every other number. */
  if (voided.length) {
    const chats = voidedChats;
    const b = el('div', 'banner hot');
    b.style.marginBottom = '12px';
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">report</span>
      <div style="flex:1">
        <strong>${num(voided.length)} row${voided.length === 1 ? '' : 's'} in the ID documents ${voided.length === 1 ? 'was' : 'were'} never a KYC submission.</strong>
        Uncaptioned WhatsApp images were auto-routed to the auditor, so the table holds machine verdicts on pictures nobody asked for${
          chats ? `, from ${num(chats)} chat${chats === 1 ? '' : 's'}` : ''}.
        They carry <span class="mono">void_reason</span> and are excluded from every count, rate, verdict and retention figure on this screen.
        ${comms
          ? (kycCommsVoid.length
              ? `<span class="t-hot">${num(kycCommsVoid.length)} KYC message${kycCommsVoid.length === 1 ? ' was' : 's were'} delivered to those chats.</span>`
              : 'No KYC message to those chats appears in the message log read here.')
          : 'The message log could not be read, so it is not known here how many of those people were messaged back.'}
      </div>
      <button class="btn sm" id="cShowVoid">Show ${voided.length === 1 ? 'it' : 'them'}</button>`;
    banners.appendChild(b);
    b.querySelector('#cShowVoid').addEventListener('click', () => focusVoided());
  }

  /* The gap banner does not depend on the register loading: v_needs_attention is
     what says a document cannot be produced, and that is worth stating even when
     the table under it is unreadable. When the view itself is the thing that did
     not load, the banner says the count is unknown — never that it is zero. */
  if (!gapKnown) {
    const b = el('div', 'banner warm');
    b.style.marginBottom = '12px';
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">help</span>
      <div style="flex:1"><strong>How many documents have no archived file is not known on this page.</strong>
      <span class="mono">The attention list</span> is the register of archive gaps and it could not be read (${esc(attnErr || 'unknown error')}).
      This screen deliberately holds no second way of counting them, so there is nothing here to fall back on and nothing below claims a document is provable.</div>`;
    banners.appendChild(b);
  } else if (gapTotal) {
    /* docs arrive newest-first, so the last gap on the page is the oldest one
       there — the row that has been unprovable the longest. The view is read
       oldest-first, so when the page cannot show them all its own first row is
       the older answer and is preferred. */
    const oldestAt = (attn && attn.length && attn[0].at)
      || (liveGaps.length ? liveGaps[liveGaps.length - 1].created_at : null);
    const b = el('div', 'banner hot');
    b.style.marginBottom = '12px';
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">folder_off</span>
      <div style="flex:1">
        <strong>${num(gapTotal)} document${gapTotal === 1 ? '' : 's'} in <span class="mono">The ID documents</span> ${plural(gapTotal, 'has', 'have')} no archived file.</strong>
        No archived file was ever recorded for it and none was deleted, so nothing was removed on schedule —
        the file simply was never stored, and retention cannot be proven for a document whose file does not exist.
        This count is the attention list's own, which is also what the Overview panel and the sidebar badge show;
        the screen holds no second count of its own to disagree with it.
        ${oldestAt ? `Oldest audited ${esc(ago(oldestAt))}.` : ''}
        The view excludes voided rows and rows audited before the archive step shipped (${esc(ARCHIVE_EPOCH_LABEL)}) — those documents are equally unprovable, and the register below labels them for what they are rather than folding them into this number.
        ${gapsOffPage
          ? `<span class="t-warm">${num(gapsOffPage)} of them ${plural(gapsOffPage, 'is', 'are')} older than the ${num(ROW_LIMIT)} rows this page loads, so the table cannot show ${plural(gapsOffPage, 'it', 'them')}.</span>`
          : ''}
        ${oneTrail && liveGaps.length
          ? `Every one of them on this page belongs to the same customer: this is one submission trail failing repeatedly, not a gap spread across a book of customers.`
          : ''}
      </div>
      ${liveGaps.length ? `<button class="btn sm" id="cShowFailed">Show ${plural(liveGaps.length, 'it', 'them')}</button>` : ''}`;
    banners.appendChild(b);
    const showFailed = b.querySelector('#cShowFailed');
    if (showFailed) showFailed.addEventListener('click', () => focusRegister({ flag: 'gap' }));
  }

  if (docs) {
    if (overdueRows.length) {
      const b = el('div', 'banner warm');
      b.style.marginBottom = '12px';
      /* What the purge is actually doing is not inferable from these rows. It
         leaves a row unmarked both when it never ran and when it ran and could
         not confirm the delete, and those call for different work — so the
         workflow's own record is quoted rather than guessed at. */
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">schedule</span>
        <div style="flex:1"><strong>${num(overdueRows.length)} archived file${overdueRows.length === 1 ? ' is' : 's are'} past retain_until and still stored.</strong>
        The nightly purge selects exactly these documents and records a deletion only once the stored file is confirmed gone, so a document in this state is one it either never reached or could not verify.
        ${wfLine(purgeWf, 'NEXUS Retention Purge')}
        Deleting stored documents is NEXUS’s to do; nothing in this dashboard can.</div>
        <button class="btn sm" id="cShowOverdue">Show ${overdueRows.length === 1 ? 'it' : 'them'}</button>`;
      banners.appendChild(b);
      b.querySelector('#cShowOverdue').addEventListener('click', () => focusRegister({ flag: 'overdue' }));
    }

    if (noTermRows.length) {
      const b = el('div', 'banner warm');
      b.style.marginBottom = '12px';
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">event_busy</span>
        <div style="flex:1"><strong>${num(noTermRows.length)} stored file${noTermRows.length === 1 ? ' has' : 's have'} no retain_until date.</strong>
        The purge selects on <span class="mono">retain_until</span>, and a null never satisfies that test — so ${plural(noTermRows.length, 'this document', 'these documents')} will be held indefinitely and no schedule will ever pick ${plural(noTermRows.length, 'it', 'them')} up.
        Every path through the KYC auditor writes a retention term, so ${plural(noTermRows.length, 'this row was', 'these rows were')} not written by it.</div>
        <button class="btn sm" id="cShowNoTerm">Show ${plural(noTermRows.length, 'it', 'them')}</button>`;
      banners.appendChild(b);
      b.querySelector('#cShowNoTerm').addEventListener('click', () => focusRegister({ flag: 'no_term' }));
    }

    /* Accepted-while-expired is the one finding on this screen that is about the
       decision rather than the paperwork around it: the auditor approved an
       identity document that had already lapsed on the day it read it. */
    if (acceptedExpired.length) {
      const b = el('div', 'banner warm');
      b.style.marginBottom = '12px';
      b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">event_busy</span>
        <div style="flex:1"><strong>${num(acceptedExpired.length)} approved document${acceptedExpired.length === 1 ? ' had' : 's had'} already expired when audited.</strong>
        The expiry date on the document predates the day it was checked, so ${acceptedExpired.length === 1 ? 'that identity was' : 'those identities were'} accepted on lapsed ID.</div>
        <button class="btn sm" id="cShowExpired">Show ${acceptedExpired.length === 1 ? 'it' : 'them'}</button>`;
      banners.appendChild(b);
      b.querySelector('#cShowExpired').addEventListener('click', () =>
        focusRegister({ flag: 'expired', verdict: 'APPROVED' }));
    }
  }

  if (escalations.length) {
    /* The newest escalation, because audit_log came back logged_at.desc. An
       escalation lives in audit_log, not in the register, so the button goes
       where the thing it names actually is: the document row when the same
       contact has one, and the activity trail when it does not. A banner that
       counts something and then leaves the reviewer to find it by hand is how
       these end up ignored. */
    const first = escalations[0];
    /* Matched through the shared resolver: audit_log records whichever key the
       workflow had, and the register may hold another of that same person's
       keys. A raw string compare here would send the reviewer to the trail for
       an escalation whose document is sitting in the table above. */
    const fks = canonSet(resolvePerson([first.lead_email]));
    const inRegister = fks.size
      ? live.find(d => [...canonOf(d)].some(k => fks.has(k))) || null
      : null;
    const n = nameFor(first.lead_email || first.lead_name, first.lead_name);
    /* THE reconciliation, said where the escalation is named rather than 400px
       below it. Every one of these cases is `escalated` on the audit side by
       construction — that is what put them in this list. What differs is what
       the register holds of them, and that second axis is the fact this banner
       used to leave unsaid while a panel further down printed its absence as
       "no document has been audited yet". Counted from the rows that loaded. */
    const escCases = escalations.map(caseFor);
    const escReg = {};
    escCases.forEach(c => { escReg[c.register] = (escReg[c.register] || 0) + 1; });
    const escRegKeys = CASE_ORDER.filter(k => escReg[k]);
    const escUnknown = escReg.unknown || 0;
    const b = el('div', 'banner warm');
    b.style.marginBottom = '12px';
    b.innerHTML = `<span class="material-symbols-outlined" style="font-size:20px">block</span>
      <div style="flex:1">
        <strong>${num(escalations.length)} KYC case${escalations.length === 1 ? '' : 's'} the auditor handed to a human.</strong>
        Newest ${esc(ago(first.logged_at))} —
        ${n.name
          ? esc(n.name)
          : `<span class="mono t-muted">${esc(n.note)}</span>`}${
          n.phone && n.phone !== n.name ? ` <span class="mono">${esc(n.phone)}</span>` : ''}${
          n.phone ? '' : ' <span class="t-muted">(no phone stored for this contact)</span>'}${
          /* A KYC escalation IS an identity record. Where the customer record
             and the name on the case disagree, both are shown: replacing one
             with the other silently is a provenance claim this screen cannot
             support, and it is the name on the case that a regulator will have
             been handed. */
          n.recorded && n.recorded !== n.name
            ? ` <span class="t-warm">(recorded on this KYC case as ${esc(n.recorded)})</span>`
            : ''}.
        ${esc(first.summary || 'The retry loop gave up.')}
        ${escalations.length > 1 ? `The other ${num(escalations.length - 1)} ${escalations.length - 1 === 1 ? 'is' : 'are'} in the activity trail at the foot of this screen.` : ''}
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:8px">
          <span class="t-muted">Where ${plural(escalations.length, 'this case sits', 'these cases sit')} in the register:</span>
          ${escRegKeys.map(k => `<span style="display:inline-flex;gap:6px;align-items:center">${casePill(k)}<span class="num">${num(escReg[k])}</span></span>`).join('')}
        </div>
        ${escUnknown
          /* Two different reasons land on `unknown` and they may not share a
             sentence. With the register READ, the row is genuinely not there
             and NOT_RECORDED is the right words. With the register UNREADABLE
             we do not even know that much, and printing "the register holds no
             row" would be the same false absence one layer up — so the cases'
             own notes are quoted instead of the constant. */
          ? `<div style="margin-top:6px">${num(escUnknown)} of ${plural(escalations.length, 'it', 'them')} ${plural(escUnknown, 'is', 'are')} <strong>unknown, not absent</strong>. ${
              docs
                ? `${esc(NOT_RECORDED)} ${plural(escUnknown, 'That document was', 'Those documents were')} read and judged — the auditor\u2019s finding is quoted above — so this is a compliance finding in its own right and not an absence of activity.`
                : `${esc([...new Set(escCases.filter(c => c.register === 'unknown').map(c => c.note))].join(' '))}`}</div>`
          : ''}
        ${voidFilterKnown
          ? ''
          : '<span class="t-warm">The register could not be read, so escalations logged against voided rows could not be excluded from this count.</span>'}
      </div>
      <button class="btn sm" id="cShowEsc">${inRegister ? 'Show the document' : 'Show in the trail'}</button>`;
    banners.appendChild(b);
    b.querySelector('#cShowEsc').addEventListener('click', () => {
      /* Searched on the register row's own address, not on whatever key
         audit_log happened to log — the two can be the email and the @lid handle
         for the same person, and searching the wrong one lands on an empty
         table under a banner that just said there was something to see. */
      if (inRegister) focusRegister({ q: String(inRegister.lead_email || inRegister.chat_id || '') });
      else focusTrail();
    });
  }

  /* ── Retention position, and — while there is one customer — the whole trail ──
     With a single submitter the register stops being a population and becomes a
     biography, so the card above it is written as one: who he is, what he sent,
     what came back and what survives in Storage, in the order he lived it. The
     numbers are the same numbers; what changes is that they are labelled as one
     person's history rather than left to read as the dealership's compliance
     record. The moment a second contact appears the card falls back to the plain
     retention breakdown, because then the proportions mean something again. */
  /* ── Case by case, in the two-axis vocabulary ────────────────────────────
     The reconciliation sentence says HOW MANY; this says WHICH, by the id an
     auditor can look the row up under. It is built for every run that got as
     far as a document, because those are the only runs for which the register
     was ever owed a row — a run that died at the auth gate is reported in the
     trail and is deliberately not accused of a missing row here.

     Nothing in this block infers a cause. Where the register holds no row the
     cell says unknown and quotes the reason it cannot say more, and the ids of
     both sides are printed so the finding can be carried off this screen. */
  const caseLedger = () => {
    if (auditErr) {
      return `<div class="cell-sub t-warm" style="white-space:normal;margin-top:12px">The audit log could not be read (${esc(auditErr)}), so no case can be listed here. That is not a claim that there are none.</div>`;
    }
    if (!reachedVerdict.length) return '';
    const rows = reachedVerdict.map(a => {
      const c = caseFor(a);
      const n = nameFor(a.lead_email || a.lead_name, a.lead_name);
      return `<div class="list-item" style="cursor:default;align-items:flex-start">
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span style="font-weight:500">${n.name ? esc(n.name) : `<span class="mono t-muted">${esc(n.note)}</span>`}</span>
            ${n.recorded && n.recorded !== n.name ? `<span class="t-warm">recorded on the case as ${esc(n.recorded)}</span>` : ''}
            <span class="t-muted">audited</span> ${casePill(c.audit)}
            <span class="t-muted">register</span> ${casePill(c.register)}
          </div>
          <div class="cell-sub" style="white-space:normal">${esc(dealerText(a.summary).slice(0, 240) || 'No summary on the run.')}</div>
          <div class="cell-sub" style="white-space:normal">${esc(c.note)}</div>
          <div class="cell-sub mono" style="word-break:break-all">The activity log ${esc(a.id ?? 'no id')}${
            c.rows.length ? ` · the ID documents ${c.rows.map(r => esc(String(r.id ?? ''))).join(', ')}` : ''}</div>
        </div>
        <div class="cell-sub">${esc(ago(a.logged_at))}</div>
      </div>`;
    }).join('');
    return `<div class="label-caps" style="margin-top:24px">Every case the auditor reached a document on</div>
      <div class="cell-sub" style="margin-top:6px;white-space:normal">One line per auditor run that got as far as reading a document, with what the auditor did and what the register holds of it. Those are two different questions and they are answered separately: a case can be <strong>${esc(CASE_STATE.escalated.label)}</strong> on the left and <strong>${esc(CASE_STATE.unknown.label)}</strong> on the right, and that combination is a finding rather than a contradiction. Runs that stopped before reading a document are not listed — nothing was due in the register for them — and they are in the activity trail at the foot of this screen.${auditCapNote}
        ${unrecorded.length
          ? ` <strong>${num(unrecorded.length)} of the ${num(reachedVerdict.length)} listed here ${plural(unrecorded.length, 'has', 'have')} a register position this page cannot establish.</strong> That is unknown, not absent, and the line for each says how far the evidence goes.`
          : ` Every case listed here has a register position this page could establish from a row it actually read.`}</div>
      <div style="margin-top:8px">${rows}</div>`;
  };

  const retCard = el('div', 'card'); body.appendChild(retCard);
  if (!docs) {
    retCard.innerHTML = stateError('the retention breakdown', docsErr);
  } else if (!live.length) {
    /* THE reconciliation, and the only full statement of it on this screen.
       The heading no longer says "nothing to retain yet" over an audit history
       that contains verdicts: what is empty is the register, and the sentence
       under it says what the audit log holds instead. The KPI strip and the
       register's own empty state point here rather than restating any of it. */
    retCard.innerHTML = `<div class="label-caps">Retention position</div>${stateEmpty(
      recon.reached ? 'Audited, and not in the register' : 'Nothing in the register to retain',
      voided.length
        ? `The rows on file were voided as non-submissions, so there is no compliance retention position to report. ${recon.text}`
        : recon.text,
      recon.reached ? 'gpp_maybe' : 'shield')}
      <div class="cell-sub" style="white-space:normal;margin-top:12px">
        The two workflows that fill and empty this register are reported here from their own record rather than inferred from the absence of rows.
        <div style="margin-top:6px">${wfLine(kycWf, 'the KYC auditor')}</div>
        <div style="margin-top:6px">${wfLine(purgeWf, 'NEXUS Retention Purge')}</div>
      </div>
      ${caseLedger()}`;
  } else {
    /* Ordered worst-last so the bar reads from provable to unprovable, and every
       key in RETENTION appears — a state with a colour but no place in this
       order would be counted and then not drawn. */
    const order = ['retained', 'purged', 'no_term', 'overdue', 'pre_archive', 'voided',
                   'undated', 'unfiled', 'gap_unknown', 'unknown', 'gap'];
    const colour = {
      retained: 'var(--ok)', purged: 'var(--cold)', no_term: 'var(--warm)',
      overdue: 'var(--warm)', pre_archive: 'var(--neutral)', voided: 'var(--neutral)',
      undated: 'var(--warm)', unfiled: 'var(--warm)', gap_unknown: 'var(--warm)',
      unknown: 'var(--unknown)', gap: 'var(--hot)',
    };
    const counts = retentionCounts;
    const present = order.filter(k => counts[k]);
    const total = live.length;
    const withRetain = live.filter(d => d.retain_until).length;
    /* The part of the archive gap this page can see. The headline number stays
       the view's whole-table count; this is only what the bar is drawn over. */
    const gaps = liveGaps.length;

    const bar = `<div class="stackbar">${present.map(k => `<i style="width:${(counts[k] / total * 100).toFixed(1)}%;background:${colour[k]}"></i>`).join('')}</div>
      <div style="display:flex;gap:20px;margin-top:12px;flex-wrap:wrap">
        ${present.map(k => `<div style="display:flex;align-items:center;gap:8px">
          <span style="width:8px;height:8px;border-radius:50%;background:${colour[k]}"></span>
          <span style="font-weight:500">${esc(RETENTION[k].label)}</span>
          <span class="t-muted num">${num(counts[k])}</span></div>`).join('')}
      </div>`;

    /* The caption carries the honesty, not the bar. A stacked bar is read as a
       distribution whatever is under it, so under one customer it is named for
       what it is before a reviewer can take a share off it. */
    const unprovable = (counts.gap || 0) + (counts.pre_archive || 0) + (counts.unfiled || 0)
      + (counts.gap_unknown || 0) + (counts.undated || 0);
    const barNote = `<div class="cell-sub" style="margin-top:12px;white-space:normal">
        ${unprovable
          ? `${num(total - unprovable)} of ${num(total)} ${plural(total, 'document', 'documents')} on this page ${plural(total - unprovable, 'has', 'have')} a file that can still be accounted for${
              counts.purged ? ` (${num(counts.purged)} of those by having been purged on schedule, which is the policy working)` : ''}; ${num(unprovable)} ${plural(unprovable, 'has', 'have')} no stored file at all.`
          : `Every one of the ${num(total)} ${plural(total, 'document', 'documents')} on this page is either archived or purged on schedule.`}
        ${gaps
          ? `${num(gaps)} of ${plural(unprovable, 'it', 'them')} ${plural(gaps, 'is the row', 'are the rows')} <span class="mono">The attention list</span> files as an archive gap.`
          : gapKnown
            ? 'The database files none of them as an archive gap.'
            : '<span class="t-warm">Which of them the database files as an archive gap could not be checked on this page.</span>'}
        ${num(withRetain)} of ${num(total)} ${plural(total, 'row', 'rows')} ${plural(withRetain, 'carries', 'carry')} a retain_until date${
          counts.no_term ? `, and the ${num(counts.no_term)} that ${plural(counts.no_term, 'does', 'do')} not can never be selected by the purge` : ''}.
        ${counts.pre_archive ? `Rows audited before ${esc(ARCHIVE_EPOCH_LABEL)} predate the archive step and are labelled Pre-archive; the view excludes them from the gap, and they are equally unprovable.` : ''}
        ${oneTrail ? `<span class="t-warm">This bar is ${num(total)} ${plural(total, 'row', 'rows')} from one customer. The proportions are shapes, not shares.</span>` : ''}
        ${voided.length ? `${num(voided.length)} voided ${plural(voided.length, 'row is', 'rows are')} not part of this breakdown; their files are accounted for in the voided section below.` : ''}
      </div>`;

    if (!oneTrail) {
      retCard.innerHTML = `<div class="label-caps" style="margin-bottom:12px">Retention position · ${num(total)} genuine ${plural(total, 'document', 'documents')}${
        liveContacts.size ? ` from ${num(liveContacts.size)} ${plural(liveContacts.size, 'contact', 'contacts')}` : ''}</div>
        ${bar}${barNote}
        ${caseLedger()}`;
    } else {
      const w0 = whoOf(live[0]);
      /* Read off the one tally, not counted again here. The three panels that
         print this split — the KPI strip, this card and the verdict tabs — were
         three separate passes over the same array, and three passes are three
         chances to disagree. */
      const vCounts = VERDICT_KEYS.map(v => [v, verdictCounts[v]]).filter(([, c]) => c);
      const types = [...new Set(live.map(d => String(d.document_type || '').trim()).filter(Boolean))];
      const untyped = live.filter(d => !String(d.document_type || '').trim()).length;
      const attemptNos = live.map(d => n0(d.attempt_number)).filter(v => v != null);
      const maxAttempt = attemptNos.length ? Math.max(...attemptNos) : null;
      /* Ordered the way he lived it: by the attempt counter, falling back to the
         audit timestamp where the counter is missing so an uncounted row still
         lands in the right place instead of at the front. */
      const trail = live.slice().sort((x, y) =>
        ((n0(x.attempt_number) || 0) - (n0(y.attempt_number) || 0)) ||
        (new Date(x.created_at) - new Date(y.created_at)));

      retCard.innerHTML = `
        <div class="label-caps">This register is one customer's document trail</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px">
          <span style="font-size:18px;font-weight:600">${w0.name ? esc(w0.name) : 'Unidentified contact'}</span>
          ${w0.phone
            ? `<span class="mono">${esc(w0.phone)}</span>`
            : '<span class="t-warm">No phone stored for this contact</span>'}
          ${w0.chip ? `<span class="chip">${esc(w0.chip)}</span>` : `<span class="chip">${esc(w0.label)}</span>`}
        </div>
        <div class="cell-sub" style="white-space:normal;margin-top:4px">${esc(w0.line)}</div>

        <div style="display:flex;gap:22px;flex-wrap:wrap;margin-top:18px;align-items:center">
          <div><span class="num" style="font-size:22px;font-weight:600">${num(total)}</span>
            <span class="t-muted"> ${esc(plural(total, 'document on file', 'documents on file'))}</span></div>
          ${vCounts.map(([v, c]) => `<div style="display:flex;gap:8px;align-items:center">
            ${pill(VERDICTS[v].label, VERDICTS[v].tone, { verbatim: false })}<span class="num" style="font-weight:600">${num(c)}</span></div>`).join('')}
          ${verdictOther ? `<div class="t-warm">${num(verdictOther)} ${plural(verdictOther, 'row carries', 'rows carry')} a verdict this screen has no wording for</div>` : ''}
        </div>
        <div class="cell-sub" style="white-space:normal;margin-top:10px">
          Those are counts of one person's attempts, and they are deliberately not divided by one another.
          ${num(total)} ${plural(total, 'upload', 'uploads')} by one customer cannot produce an approval rate,
          an average confidence or a trend: a percentage taken across them would read as a fact about this
          dealership's compliance, and there is nobody else in the register to compare him with.
          Every figure on this screen is a count for that reason.
        </div>
        <div class="cell-sub" style="white-space:normal;margin-top:6px">
          ${types.length
            ? `${num(types.length)} distinct document ${plural(types.length, 'type', 'types')} across ${num(total)} ${plural(total, 'attempt', 'attempts')}${
                untyped ? `, plus ${num(untyped)} ${plural(untyped, 'row that records', 'rows that record')} no type at all` : ''} — ${types.map(esc).join(', ')}.`
            : `No row records a document type.`}
          ${maxAttempt != null ? ` The attempt counter on these rows reaches ${num(maxAttempt)}.` : ''}
        </div>

        <div style="margin-top:20px">${bar}</div>
        ${barNote}

        <div class="label-caps" style="margin-top:24px">Every attempt, in order</div>
        <div class="cell-sub" style="margin-top:6px;white-space:normal">One line per row in the register, ordered by attempt number. Open any of them for the full record.</div>
        <div class="timeline" style="margin-top:12px">${trail.map((x, i) => {
          const xa = n0(x.attempt_number);
          const conf = n0(x.confidence_score);
          return `<div class="tl-item" role="button" tabindex="0" data-trail="${i}" style="cursor:pointer">
            <span class="tl-dot" style="background:var(--${verdictTone(x)})"></span>
            <div class="tl-body">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <span style="font-weight:500">Attempt ${xa == null ? '—' : num(xa)}</span>
                ${verdictPill(x)}
                ${retentionPill(retentionOf(x))}
              </div>
              <div class="tl-meta">${x.document_type ? esc(x.document_type) : 'No document type recorded'}
                · audited ${esc(ago(x.created_at))}${conf == null ? '' : ` · ${num(conf)}% confidence`}</div>
            </div></div>`;
        }).join('')}</div>
        ${caseLedger()}`;

      /* The rows are the same objects the table below opens, so the drawer that
         appears is byte-for-byte the same record either way. */
      retCard.querySelectorAll('[data-trail]').forEach(node => {
        const open = () => openDoc(trail[Number(node.dataset.trail)]);
        node.addEventListener('click', open);
        node.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });
      });
    }
  }

  /* ── The register ──────────────────────────────────────────────────────── */
  const queue = el('div', 'card flush'); queue.style.marginTop = '16px'; body.appendChild(queue);

  if (!docs) {
    queue.innerHTML = `<div class="card-head"><div><div class="card-title">KYC register</div></div></div>
      ${stateError('the KYC register', docsErr)}`;
  } else {
    const low = s => String(s || '').toLowerCase();
    const f = { verdict: 'ALL', retention: 'ALL', flag: 'ALL', q: '' };

    /* One tab per value the verdict CHECK constraint permits, always shown even
       at zero, plus a tail for anything outside it. Built this way so the tabs
       sum to All by construction: the old strip offered Approved, Rejected and
       Escalated only, and a PENDING row — the column's own default — was in the
       table and in no tab, which on a compliance register means an undecided
       document that no filter can find. */
    const segs = [['ALL', live.length], ...VERDICT_KEYS.map(v => [v, verdictCounts[v]])];
    if (verdictOther) segs.push(['OTHER', verdictOther]);
    const segLabel = k => k === 'ALL' ? 'All'
      : k === 'OTHER' ? 'Not recognised'
      : VERDICTS[k].label;
    const retCounts = retentionCounts;
    /* Only the retention states actually present, so the reviewer is never
       offered a filter that returns nothing. */
    const retKeys = Object.keys(RETENTION).filter(k => retCounts[k]);
    const flagCounts = {};
    FLAG_KEYS.forEach(k => { flagCounts[k] = live.filter(FLAGS[k].match).length; });
    /* Exactly full means the cap was hit, which is the only thing the browser can
       know without a count query. Saying "the newest 500" is honest; saying
       nothing would let a capped page read as the complete book. */
    const capped = docs.length >= ROW_LIMIT;

    queue.innerHTML = `<div class="card-head"><div>
        <div class="card-title">KYC register · genuine submissions</div>
        <div class="card-sub">Every audited document that is a real submission, with its extracted identity fields, attempt counter and retention state. Click a row for the full record.${
          oneTrail ? ' Every row in it belongs to the same customer, so the columns read as one person\u2019s attempts rather than as a comparison between people.' : ''}${
          voided.length ? ` <span class="t-warm">${num(voided.length)} voided row${voided.length === 1 ? ' is' : 's are'} excluded from this table and every count on it — they are listed separately below.</span>` : ''}${
          capped ? ` <span class="t-warm">The underlying read is capped at the ${num(ROW_LIMIT)} most recent rows, so older documents are not on this page.</span>` : ''}${
          gapKnown ? '' : ' <span class="t-warm">The attention list did not load, so the archive-gap finding is not offered as a filter here — an empty result from it would read as an all-clear.</span>'}</div>
      </div></div>
      <div class="toolbar">
        <div class="seg" id="cSegVerdict" role="group" aria-label="Filter by verdict">
          ${segs.map(([k, c], i) => `<button data-v="${esc(k)}" class="${i === 0 ? 'on' : ''}">${esc(segLabel(k))} · ${num(c)}</button>`).join('')}
        </div>
        <div class="grow"><input type="search" id="cq" aria-label="Search KYC documents"
          placeholder="Search name, email, phone, document type or chat id" /></div>
        <select id="cRet" aria-label="Filter by retention state" style="width:auto">
          <option value="ALL">All retention states</option>
          ${retKeys.map(k =>
            `<option value="${k}">${esc(RETENTION[k].label)} · ${num(retCounts[k])}</option>`).join('')}
        </select>
        <select id="cFlag" aria-label="Filter by finding" style="width:auto">
          <option value="ALL">All findings</option>
          ${FLAG_KEYS.map(k =>
            `<option value="${esc(k)}">${esc(FLAGS[k].label)} · ${num(flagCounts[k])}</option>`).join('')}
        </select>
        <div class="t-muted num" id="cCount"></div>
      </div>
      <div id="cTable"></div>`;

    const cols = [
      { label: 'Who', strong: true, render: d => whoCell(whoOf(d)) },
      { label: 'Document', render: d => `${d.document_type ? esc(d.document_type) : '<span class="t-muted">No document type recorded</span>'}
          ${d.chat_id ? `<div class="cell-sub mono">${esc(d.chat_id)}</div>` : ''}` },
      { label: 'Verdict', render: d => `${verdictPill(d)}
          ${d.reviewed_by ? `<div class="cell-sub">${reviewerCell(d)}${d.reviewed_at ? ' · ' + esc(ago(d.reviewed_at)) : ''}</div>` : ''}` },
      { label: 'Extracted identity', render: d => {
          if (!d.full_name && !d.date_of_birth && !d.expiry_date) return '<span class="t-muted">Nothing extracted</span>';
          /* Expired when audited is red; expired since is amber. Painting both
             the same colour makes a paperwork chore look like a control failure
             and buries the rows that are one. */
          const atAudit = expiredAtAudit(d);
          const lapsed = !atAudit && isPastDate(d.expiry_date);
          const unreadable = expiryUnreadable(d);
          const note = atAudit ? ' (expired when audited)'
            : lapsed ? ' (expired since)'
            : unreadable ? ' (not a date this screen can read, so whether it has expired is unknown)' : '';
          const cls = atAudit ? 't-hot' : lapsed || unreadable ? 't-warm' : '';
          return `<div>${esc(d.full_name || '—')}</div>
            <div class="cell-sub">DOB ${d.date_of_birth ? esc(d.date_of_birth) : '—'} · expires
              ${d.expiry_date ? `<span class="${cls}">${esc(d.expiry_date)}${note}</span>` : '—'}</div>`;
        } },
      { label: 'Checks', render: d => {
          const bits = [d.tampering ? pill('Tampering', 'hot', { verbatim: false }) : '<span class="t-muted">No tampering</span>'];
          if (d.is_valid === false) bits.push(pill('Not valid', 'hot', { verbatim: false }));
          else if (d.is_valid === true) bits.push(pill('Valid', 'ok', { verbatim: false }));
          if (expiredAtAudit(d)) bits.push(pill('Expired when audited', 'hot', { verbatim: false }));
          if (finalAttempt(d) && verdictKey(d) !== 'APPROVED') bits.push(pill('Retries exhausted', 'warm', { verbatim: false }));
          return `<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">${bits.join('')}</div>`;
        } },
      { label: 'Confidence', align: 'r', render: d => {
          const c = n0(d.confidence_score);
          if (c == null) return '<span class="t-muted">—</span>';
          const w = Math.max(0, Math.min(100, c));
          return `<div>${num(c)}%</div><div class="bar" style="width:56px;margin-left:auto"><i style="width:${w}%;background:var(--${c > 70 ? 'ok' : c > 40 ? 'warm' : 'hot'})"></i></div>`;
        } },
      { label: 'Attempt', align: 'r', render: d => {
          const a = n0(d.attempt_number), m = n0(d.max_attempts);
          if (a == null) return '<span class="t-muted">—</span>';
          const last = m != null && a >= m;
          return `<span class="${last ? 't-hot' : ''}">${num(a)}${m != null ? ` of ${num(m)}` : ''}</span>
            ${last ? '<div class="cell-sub t-hot">Final attempt</div>' : ''}`;
        } },
      /* The pill and the sub-line are one verdict, not two readings. They used
         to disagree by construction: a stored file whose retain_until had
         lapsed was pilled "Archived" in green and captioned "overdue" in the
         same cell, because the pill read one predicate and the caption another.
         The overdue case is now a retention state in its own right. */
      { label: 'Retention', render: d => {
          const r = retentionOf(d);
          const sub = d.purged_at
            ? `purged ${esc(ago(d.purged_at))}`
            : d.retain_until
              ? `retain until ${esc(d.retain_until)}`
              : 'no retain_until set';
          return `${retentionPill(r)}<div class="cell-sub ${RETENTION[r.key].tone === 'ok' || RETENTION[r.key].tone === 'cold' ? '' : 't-warm'}">${sub}</div>`;
        } },
      { label: 'Submitted', render: d => `<span class="t-muted">${esc(ago(d.created_at))}</span>` },
      { label: 'Decision', align: 'r', render: d => {
          const w = whoOf(d);
          const btn = (label, title) => `<button class="btn sm" disabled
            aria-label="${esc(label)} — ${esc(whoLabel(w))}" title="${esc(title)}">${esc(label)}</button>`;
          return `<div style="display:flex;gap:6px;justify-content:flex-end">
            ${btn('Approve', NO_DECISION_HOOK)}${btn('Reject', NO_DECISION_HOOK)}${btn('Re-ask', NO_REASK_HOOK)}</div>`;
        } },
    ];

    const th = queue.querySelector('#cTable');
    const countEl = queue.querySelector('#cCount');

    const visible = () => {
      const q = f.q.trim().toLowerCase();
      return live.filter(d => {
        /* OTHER is the tail the segment counts already carry: everything whose
           verdict the CHECK constraint does not permit, plus the (currently
           impossible, since the column is NOT NULL) missing one. Defined here
           the same way it is counted, so tab and table agree. */
        if (f.verdict === 'OTHER') { if (VERDICTS[verdictKey(d)]) return false; }
        else if (f.verdict !== 'ALL' && verdictKey(d) !== f.verdict) return false;
        if (f.retention !== 'ALL' && retentionOf(d).key !== f.retention) return false;
        if (f.flag !== 'ALL' && !FLAGS[f.flag].match(d)) return false;
        if (!q) return true;
        const w = whoOf(d);
        return [w.name, w.email, w.phone, d.lead_name, d.full_name, d.lead_email, d.document_type, d.chat_id]
          .some(v => low(v).includes(q));
      });
    };

    function draw() {
      if (!live.length) {
        countEl.textContent = '';
        /* The empty register is the sentence an auditor is most likely to be
           shown, and the one most easily wrong. "Nothing has reached it yet"
           reads as "no customer has submitted anything", which the register on
           its own cannot support: a document that was sent and whose audit run
           crashed leaves no row either. What the auditor workflow has actually
           been doing is a matter of record, so it is stated from the record. */
        th.innerHTML = stateEmpty(
          voided.length ? 'No genuine submission in the register' : 'No documents in the register',
          voided.length
            ? `Every one of the ${num(docs.length)} rows loaded here was voided as a non-submission. Nothing in this register is a compliance decision.`
            : `No row is on file. ${recon.short} What that means, and what is and is not known about it, is set out once in the retention panel above rather than repeated here. Every auditor run and every customer-facing KYC message is in the trail at the foot of this screen.`,
          'verified_user');
        return;
      }
      const rows = visible();
      countEl.textContent = `${rows.length} of ${live.length}`;
      th.innerHTML = table(cols, rows, {
        onRow: true,
        empty: stateEmpty('No document matches these filters',
          'Clear the search or pick another verdict, retention state or finding.', 'filter_alt_off'),
      });
      wireRows(th, rows, openDoc);
    }

    queue.querySelectorAll('#cSegVerdict button').forEach(b => b.addEventListener('click', () => {
      queue.querySelectorAll('#cSegVerdict button').forEach(x => x.classList.toggle('on', x === b));
      f.verdict = b.dataset.v; draw();
    }));
    queue.querySelector('#cq').addEventListener('input', e => { f.q = e.target.value; draw(); });
    queue.querySelector('#cRet').addEventListener('change', e => { f.retention = e.target.value; draw(); });
    queue.querySelector('#cFlag').addEventListener('change', e => { f.flag = e.target.value; draw(); });

    /* Every banner's "Show them" lands here: it sets the whole filter state at
       once, writes it back into the controls, and scrolls the register into
       view. Clearing the fields it was not asked for is deliberate — a leftover
       search box silently hiding half of the rows the banner just counted is
       the failure mode this exists to prevent. */
    focusRegister = ({ verdict = 'ALL', retention = 'ALL', flag = 'ALL', q = '' } = {}) => {
      f.verdict = verdict; f.retention = retention; f.flag = flag; f.q = q;
      queue.querySelector('#cRet').value = retention;
      queue.querySelector('#cFlag').value = flag;
      queue.querySelector('#cq').value = q;
      queue.querySelectorAll('#cSegVerdict button').forEach(x => x.classList.toggle('on', x.dataset.v === verdict));
      draw();
      queue.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    draw();
  }

  /* ── Voided rows — the incident, kept as evidence ──────────────────────────
     Deliberately a separate card below the register rather than a filter inside
     it: the point is that these are not the same kind of thing. There is no
     Approve, no Reject and no Re-ask here, and their absence is the design —
     there is no submission to decide on and nobody who is waiting for an answer.
     What a reviewer needs from this section is the opposite: who these people
     actually were, what the machine said about them, and what the dealership
     told them. */
  /* Built only when there is something in it. The void partition is empty as of
     the 24 Aug cleanup — the nine non-submissions were deleted and the gate that
     produced them is fixed — and a card headed "Voided — not KYC submissions"
     with an empty state under it would leave a standing accusation on the screen
     an auditor reads, about rows that no longer exist. Nothing to show means
     nothing on the page, not a heading with a shrug under it.

     A failed read is not reported here either. The register card above already
     says the whole table could not be read; repeating it under this heading
     would imply there are voided rows behind the error, which is the one thing
     the failure means we do not know. */
  if (docs && voided.length) {
    const voidCard = el('div', 'card flush'); voidCard.style.marginTop = '16px'; body.appendChild(voidCard);
    const voidHead = `<div class="card-head"><div>
        <div class="card-title">Voided — not KYC submissions</div>
        <div class="card-sub">Rows the backend marked with <span class="mono">void_reason</span>. They are evidence of a routing fault, not compliance decisions, and nothing above counts them.</div>
      </div></div>`;

    const reasons = [...new Set(voided.map(v => String(v.void_reason || '').trim()).filter(Boolean))];
    const stillStored = voided.filter(v => v.storage_path && !v.purged_at).length;
    const chats = voidedChats;
    const withLead = voided.filter(v => whoOf(v).kind === 'lead').length;

    const vcols = [
      { label: 'Who this actually was', strong: true, render: d => whoCell(whoOf(d)) },
      { label: 'What the image was', render: d => {
          const t = String(d.document_type || '').trim();
          return `${t ? esc(t) : '<span class="t-muted">The vision model returned no description</span>'}
            <div class="cell-sub" style="white-space:normal">Described by the vision model, not read off a document.</div>`;
        } },
      { label: 'Machine output', render: d => {
          const c = n0(d.confidence_score);
          /* A chip, never a verdict pill. An APPROVED pill here is exactly the
             thing that made a greeting card look like a cleared identity check. */
          return `<span class="chip">${d.verdict ? esc(String(d.verdict)) : 'no verdict'} · void</span>
            <div class="cell-sub" style="white-space:normal">Auto-generated on an image nobody requested${
              c == null ? '' : ` · confidence ${num(c)}%`}. Not a decision.</div>`;
        } },
      /* Counted per chat, never per row. communication_logs carries no document
         id, so pinning one message to one image would be a guess — and a guess
         that says "we told this person APPROVED" is exactly the kind of claim
         this screen exists to stop making. */
      { label: 'Sent to this chat', render: d => {
          const cs = commsFor(d);
          if (cs == null) return '<span class="t-muted">Message log could not be read</span>';
          if (!cs.length) return '<span class="t-muted">No KYC message to this chat in the log</span>';
          const ap = cs.filter(c => commKind(c.message) === 'APPROVED').length;
          const rj = cs.filter(c => commKind(c.message) === 'REJECTED').length;
          const other = cs.length - ap - rj;
          const bits = [];
          if (ap) bits.push(`<span class="t-hot">${num(ap)} × [KYC-APPROVED]</span>`);
          if (rj) bits.push(`<span class="t-warm">${num(rj)} × [KYC-REJECT]</span>`);
          if (other) bits.push(`<span class="t-muted">${num(other)} other KYC message${other === 1 ? '' : 's'}</span>`);
          return `<div style="display:flex;gap:8px;flex-wrap:wrap">${bits.join('')}</div>
            <div class="cell-sub" style="white-space:normal">Across the whole chat, not matched to this one image · newest ${esc(ago(cs[0].created_at))}</div>`;
        } },
      { label: 'Evidence', render: d => {
          const r = retentionOf(d);
          return `${retentionPill(r)}<div class="cell-sub">${d.purged_at
            ? `purged ${esc(ago(d.purged_at))}`
            : d.storage_path ? 'image still in the private bucket' : 'no file stored'}</div>`;
        } },
      { label: 'Voided', render: d => `<span class="t-muted">${esc(ago(d.voided_at))}</span>
          <div class="cell-sub">audited ${esc(ago(d.created_at))}</div>` },
    ];

    voidCard.innerHTML = `${voidHead}
      <div style="padding:14px 20px 0">
        <div class="banner hot">
          <span class="material-symbols-outlined" style="font-size:20px">policy</span>
          <div style="flex:1">
            <strong>${num(voided.length)} row${voided.length === 1 ? '' : 's'}${chats ? ` across ${num(chats)} WhatsApp chat${chats === 1 ? '' : 's'}` : ''}.</strong>
            No Approve, Reject or Re-ask control appears in this table on purpose: nothing was submitted, so there is no decision to record and nobody is waiting for one.
            ${withLead
              ? `<span class="t-warm">${num(withLead)} of them ${withLead === 1 ? 'does' : 'do'} resolve to a lead on file — read ${withLead === 1 ? 'that row' : 'those rows'} carefully before assuming the void was correct.</span>`
              : leadsErr
                ? '<span class="t-warm">Your leads could not be read, so whether any of these resolves to a lead on file is not known on this page — the absence of a match here is not evidence there is none.</span>'
                : 'None of them resolves to a lead on file.'}
          </div>
        </div>
        ${reasons.map(r => `<div class="quote" style="margin-top:12px">${esc(r)}</div>`).join('')}
        <div class="cell-sub" style="margin-top:12px;white-space:normal">
          ${comms
            ? (kycCommsVoid.length
                ? `${num(kycCommsVoid.length)} customer-facing KYC message${kycCommsVoid.length === 1 ? ' was' : 's were'} delivered to these chats and cannot be recalled.`
                : 'No customer-facing KYC message to these chats appears in the message log read here.')
            : `The message log could not be read (${esc(commsErr || 'unknown error')}), so what was sent to these chats is unknown on this page.`}
          ${stillStored
            ? ` ${num(stillStored)} of these images ${stillStored === 1 ? 'is' : 'are'} still held in NEXUS’s private document store. Deleting a stored file is NEXUS’s to do; nothing in this dashboard can.`
            : ' None of these images is still held in storage.'}
        </div>
      </div>
      <div id="cVoidTable"></div>`;

    const vth = voidCard.querySelector('#cVoidTable');
    /* No `empty` needed: this card only exists when `voided` has rows in it. */
    vth.innerHTML = table(vcols, voided, { onRow: true });
    wireRows(vth, voided, openDoc);

    focusVoided = () => voidCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── One document, in full ─────────────────────────────────────────────── */
  function openDoc(d) {
    const w = whoOf(d);
    const voidedRow = isVoid(d);
    const r = retentionOf(d);
    const m = RETENTION[r.key];
    const od = r.key === 'overdue';
    const conf = n0(d.confidence_score);
    const a = n0(d.attempt_number), mx = n0(d.max_attempts);
    const atAudit = expiredAtAudit(d);
    const lapsed = !atAudit && isPastDate(d.expiry_date);
    const unreadableExpiry = expiryUnreadable(d);
    /* Three distinct cases, and they must not be collapsed: the object is there
       and signable; it was purged on schedule (signing it would hand back a URL
       that 404s); or it was never archived at all. */
    const canOpen = !d.purged_at && !!d.storage_path;
    const fileTitle = canOpen ? CAN_OPEN_FILE : (d.purged_at ? PURGED_FILE : NO_FILE_LINK);

    const cs = commsFor(d);
    const commsHtml = cs == null
      ? `<div class="cell-sub" style="white-space:normal">The message log could not be read (${esc(commsErr || 'unknown error')}), so what this contact was told cannot be shown here.</div>`
      : !cs.length
        ? `<div class="cell-sub">No KYC message to this contact appears in the ${num(COMM_LIMIT)} most recent message-log rows.</div>`
        /* Every KYC message to this contact, not the ones belonging to this row:
           communication_logs has no document id to join on. Said plainly rather
           than implied by a suspiciously long list. */
        : `<div class="cell-sub" style="white-space:normal">Every KYC message logged to this contact. The message log carries no document id, so these are not matched to this individual upload.</div>
           <div class="thread" style="margin-top:8px">${cs.map(c =>
             `<div class="bubble out"><div>${esc(String(c.message || '').slice(0, 400))}</div><div class="bubble-meta">${esc(clock(c.created_at))} · ${esc(ago(c.created_at))}</div></div>`).join('')}</div>`;

    /* Who-section. It is the first thing in the drawer because every other fact
       below is only meaningful once you know whether there is a person with a
       file behind this row. */
    const whoHtml = `<div class="section">
        <div class="label-caps">Who this is</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
          ${w.name ? `<span style="font-weight:500">${esc(w.name)}</span>` : '<span class="t-muted">No name on record</span>'}
          <span class="chip">${esc(w.label)}</span>
        </div>
        <dl class="kv" style="margin-top:12px">
          <dt>Lead record</dt><dd>${w.kind === 'lead'
            /* A matched lead does not imply a usable address. Lead 34's `email`
               column holds `+971547484167@whatsapp.lead` and lead 35's holds the
               empty string; printing either as though it were an address is the
               same mistake as printing a chat id where a name goes. What was
               matched is stated, and what is in the column is named for what it
               is. */
            ? (w.leadAddress
                ? (w.leadAddressIsEmail
                    ? `${esc(w.leadAddress)} <span class="t-ok">· matched in leads</span>`
                    : `<span class="t-ok">Matched in leads.</span> <span class="t-warm">The lead row's address column holds <span class="mono">${esc(w.leadAddress)}</span>, a routing key rather than somewhere this customer can be written to.</span>`)
                : '<span class="t-ok">Matched in leads.</span> <span class="t-warm">That lead row carries no address at all, so there is nothing here to write to.</span>')
            : w.kind === 'email_only'
              ? `${esc(w.email)} <span class="t-warm">· ${leadsErr ? 'Your leads could not be read, so this is unconfirmed' : 'no matching row in leads'}</span>`
              : `<span class="t-warm">${leadsErr ? 'Your leads could not be read, so whether there is a lead behind this row is unknown here.' : 'No lead behind this row'}</span>`}</dd>
          <dt>WhatsApp profile name</dt><dd>${w.contact && w.contact.push_name
            ? `${esc(w.contact.push_name)} <span class="t-muted">· the name this person set on WhatsApp, not a customer record</span>`
            : (w.contactMissing
                ? '<span class="t-muted">No the saved contact details row for this chat id</span>'
                : '<span class="t-muted">Not captured</span>')}</dd>
          <dt>Phone</dt><dd>${w.phone
            ? `<span class="mono">${esc(w.phone)}</span> <span class="t-muted">· ${esc(w.phoneFrom)}</span>`
            : '<span class="t-muted">Not stored — historic contacts predate phone capture, and none is inferred from the chat id</span>'}</dd>
          <dt>Chat id</dt><dd class="mono" style="word-break:break-all">${w.chatId
            ? esc(w.chatId)
            : '<span class="t-muted">none</span>'}</dd>
          <dt>Name on the KYC row</dt><dd>${d.lead_name
            ? `${esc(d.lead_name)}${w.name && w.name !== String(d.lead_name).trim()
                ? ` <span class="t-warm">· the customer record for this person is filed as ${esc(w.name)}; both are kept because a KYC row is itself an identity record</span>`
                : ''}`
            : '<span class="t-muted">none</span>'}</dd>
        </dl>
      </div>`;

    if (voidedRow) {
      openDrawer(`
        <div class="drawer-head">
          <div style="flex:1">
            <h2 style="font-size:18px">${esc(whoLabel(w))}</h2>
            <div class="cell-sub"><span class="chip">Voided — not a KYC submission</span></div>
            <div class="cell-sub mono">${esc(d.id ?? '')}</div>
          </div>
          <button class="btn ghost sm" id="cClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div class="drawer-body">
          <div class="section">
            <div class="label-caps">Why this is not a decision</div>
            <div class="quote" style="margin-top:8px">${esc(d.void_reason || '')}</div>
            <dl class="kv" style="margin-top:12px">
              <dt>Voided</dt><dd>${d.voided_at ? esc(ago(d.voided_at)) : '<span class="t-muted">no voided_at timestamp</span>'}</dd>
              <dt>Auto-audited</dt><dd>${esc(ago(d.created_at))}</dd>
            </dl>
          </div>

          ${whoHtml}

          <div class="section">
            <div class="label-caps">What the machine produced</div>
            <div class="cell-sub" style="margin-top:8px;white-space:normal">Kept verbatim as evidence. None of it is a verdict on a person, and none of it is counted anywhere on this screen.</div>
            <dl class="kv" style="margin-top:12px">
              <dt>Described as</dt><dd>${d.document_type ? esc(d.document_type) : '<span class="t-muted">nothing recorded</span>'}</dd>
              <dt>Machine verdict</dt><dd><span class="chip">${d.verdict ? esc(String(d.verdict)) : 'none'} · void</span></dd>
              <dt>Confidence</dt><dd class="num">${conf == null ? '<span class="t-muted">Not scored</span>' : num(conf) + '%'}</dd>
              <dt>Extracted name</dt><dd>${d.full_name ? esc(d.full_name) : '<span class="t-muted">Nothing extracted</span>'}</dd>
            </dl>
            ${d.remarks ? `<div class="quote" style="margin-top:12px">${esc(d.remarks)}</div>` : ''}
          </div>

          <div class="section">
            <div class="label-caps">What this contact was told</div>
            ${commsHtml}
          </div>

          <div class="section">
            <div class="label-caps">Evidence held</div>
            <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
              <span class="material-symbols-outlined ${m.tone === 'ok' ? 't-ok' : m.tone === 'warm' ? 't-warm' : 't-muted'}">${esc(m.icon)}</span>
              ${retentionPill(r)}
            </div>
            <div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(r.detail)}
              This is a private photograph somebody sent to a business number, not an ID document. It is retained as evidence of the routing fault; deleting it is NEXUS’s to do.</div>
            <dl class="kv" style="margin-top:12px">
              <dt>storage_path</dt><dd class="mono" style="word-break:break-all">${d.storage_path ? esc(d.storage_path) : '<span class="t-muted">null</span>'}</dd>
              <dt>retain_until</dt><dd>${d.retain_until ? esc(d.retain_until) : '<span class="t-muted">null</span>'}</dd>
              <dt>purged_at</dt><dd>${d.purged_at ? esc(ago(d.purged_at)) : '<span class="t-muted">null</span>'}</dd>
            </dl>
          </div>
        </div>
        <div class="drawer-foot">
          <span class="cell-sub" style="flex:1;white-space:normal">No approve, reject or re-ask here — there was no submission and nobody is waiting on an answer.</span>
          <button class="btn ghost" id="cOpenFile" ${canOpen ? '' : 'disabled'} title="${esc(fileTitle)}">Open file</button>
        </div>`);
      $('cClose').addEventListener('click', closeDrawer);
      wireFileButton(d, canOpen);
      return;
    }

    /* Re-uploads from the same customer are separate rows that relate to each
       other only through attempt_number, so a reviewer reading one row cannot
       see that it is the fourth try. Three rejections then an approval is a
       different story from a single clean pass, and the story is the thing the
       lawyer asked for. Rows are matched on the exact lead_email or chat_id the
       workflow wrote — never on a name, which two customers can share — and
       voided rows are excluded, so a greeting card can never appear in a
       customer's attempt history. The match runs through the contact alias graph
       so a row filed under an email and a row filed under that same customer's
       @lid land in one chain instead of two — otherwise a re-upload looks like a
       first attempt purely because the workflow had a different key to hand. */
    const ks = canonOf(d);
    const chain = live.filter(x => [...canonOf(x)].some(k => ks.has(k)))
    .slice().sort((x, y) =>
      ((n0(x.attempt_number) || 0) - (n0(y.attempt_number) || 0)) ||
      (new Date(x.created_at) - new Date(y.created_at)));
    const chainHtml = chain.length > 1
      ? `<div class="timeline" style="margin-top:8px">${chain.map(x => {
          const xa = n0(x.attempt_number);
          const here = x === d;
          return `<div class="tl-item">
            <span class="tl-dot" style="background:var(--${here ? 'primary' : 'neutral'})"></span>
            <div class="tl-body">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <span style="font-weight:500">Attempt ${xa == null ? '—' : num(xa)}</span>
                ${verdictPill(x)}
                ${here ? '<span class="chip">Viewing</span>' : ''}
              </div>
              <div class="tl-meta">${esc(x.document_type || 'Unknown document')} · ${esc(ago(x.created_at))}
                ${n0(x.confidence_score) == null ? '' : ' · ' + num(x.confidence_score) + '% confidence'}
                · ${esc(RETENTION[retentionOf(x).key].label.toLowerCase())}</div>
            </div></div>`;
        }).join('')}</div>`
      : (n0(d.attempt_number) || 0) > 1
        ? `<div class="cell-sub" style="margin-top:8px;white-space:normal">This is attempt ${num(d.attempt_number)}, but no earlier genuine attempt for this customer is in the ${num(ROW_LIMIT)} rows loaded here. The earlier rows may simply be older than this page reaches.</div>`
        : '<div class="cell-sub" style="margin-top:8px">Only one genuine upload from this customer is on file.</div>';

    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1">
          <h2 style="font-size:18px">${esc(whoLabel(w))}</h2>
          <div class="cell-sub">${esc(d.document_type || 'Unknown document')} · submitted ${esc(ago(d.created_at))}</div>
          <div class="cell-sub mono">${esc(d.id ?? '')}</div>
        </div>
        <button class="btn ghost sm" id="cClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        <div class="section">
          <div class="label-caps">Verdict</div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
            ${verdictPill(d)}
            ${d.tampering ? pill('Tampering detected', 'hot', { verbatim: false }) : ''}
            ${d.is_valid === false ? pill('Not valid', 'hot', { verbatim: false }) : d.is_valid === true ? pill('Valid', 'ok', { verbatim: false }) : ''}
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
            <span class="t-muted">Register position</span>${casePill(rowCaseState(d))}
          </div>
          <div class="cell-sub" style="white-space:normal;margin-top:6px">${
            /* Said from THIS row and nothing else. The state is the six-word
               vocabulary at the top of this file; the sentence under it names
               the column the state was read off, so a reviewer can check it
               against the record rather than take the pill on trust. */
            d.purged_at
              ? 'purged_at is set on this row, so the file was deleted under the retention policy and the deletion is recorded. This is the only kind of deletion this system writes down.'
              : verdictKey(d) === 'ESCALATED'
                ? 'This row is in the register and carries an ESCALATED verdict: the case was handed to a person, and unlike an escalation that left no row behind, this one is on file.'
                : verdictKey(d) === 'PENDING'
                  ? 'This row is in the register with the column default still on it. No decision has been recorded against it — which is not the same as a decision to hold it.'
                  : VERDICTS[verdictKey(d)]
                    ? 'This row is in the register and carries a decided verdict, so what the auditor did with this document is on file.'
                    : `This row carries a verdict the CHECK constraint on the ID documents does not permit, so this screen has no wording for its position and claims none.`}</div>
          <dl class="kv" style="margin-top:12px">
            <dt>Confidence</dt><dd class="num">${conf == null ? '<span class="t-muted">Not scored</span>' : num(conf) + '%'}</dd>
            <dt>Attempt</dt><dd class="num">${a == null ? '<span class="t-muted">—</span>' : num(a) + (mx != null ? ` of ${num(mx)}` : '')}</dd>
            <dt>Reviewed by</dt><dd>${d.reviewed_by
              ? `${reviewerCell(d).replace(/^by /, '')}<div class="cell-sub" style="white-space:normal">reviewed_by is a uuid pointing at a row in users, resolved here rather than printed raw. Staff contact details are not recorded anywhere this dashboard reads — the users table holds no phone number — so this name cannot be turned into somebody to call.</div>`
              : '<span class="t-muted">Not reviewed by a human</span>'}</dd>
            <dt>Reviewed at</dt><dd>${d.reviewed_at ? esc(ago(d.reviewed_at)) : '<span class="t-muted">—</span>'}</dd>
          </dl>
          ${d.remarks ? `<div class="quote" style="margin-top:12px">${esc(d.remarks)}</div>` : ''}
        </div>

        ${whoHtml}

        <div class="section">
          <div class="label-caps">Extracted identity</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Full name</dt><dd>${d.full_name ? esc(d.full_name) : '<span class="t-muted">Not extracted</span>'}</dd>
            <dt>Date of birth</dt><dd>${d.date_of_birth ? esc(d.date_of_birth) : '<span class="t-muted">Not extracted</span>'}</dd>
            <dt>Expiry date</dt><dd>${d.expiry_date
              ? `<span class="${atAudit ? 't-hot' : lapsed || unreadableExpiry ? 't-warm' : ''}">${esc(d.expiry_date)}${
                  atAudit ? ' · already expired on the day it was audited'
                  : lapsed ? ' · expired since it was audited'
                  : unreadableExpiry ? ' · expiry_date is a text column and this value does not read as a date, so whether the document has expired is not known here' : ''}</span>`
              : '<span class="t-muted">Not extracted</span>'}</dd>
          </dl>
        </div>

        <div class="section">
          <div class="label-caps">Attempt history</div>
          ${chainHtml}
        </div>

        <div class="section">
          <div class="label-caps">Messages to this contact</div>
          ${commsHtml}
        </div>

        <div class="section">
          <div class="label-caps">Retention</div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
            <span class="material-symbols-outlined ${m.tone === 'hot' ? 't-hot' : m.tone === 'ok' ? 't-ok' : m.tone === 'warm' ? 't-warm' : 't-muted'}">${esc(m.icon)}</span>
            ${retentionPill(r)}
          </div>
          <div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(r.detail)}</div>
          ${od ? `<div class="banner warm" style="margin-top:12px"><span class="material-symbols-outlined">schedule</span>
            <div>retain_until has passed and the file is still in the bucket. ${wfLine(purgeWf, 'NEXUS Retention Purge')}</div></div>` : ''}
          <dl class="kv" style="margin-top:12px">
            <dt>storage_path</dt><dd class="mono" style="word-break:break-all">${d.storage_path ? esc(d.storage_path) : '<span class="t-muted">null</span>'}</dd>
            <dt>retain_until</dt><dd>${d.retain_until ? `<span class="${od ? 't-warm' : ''}">${esc(d.retain_until)}</span>` : '<span class="t-muted">null</span>'}</dd>
            <dt>purged_at</dt><dd>${d.purged_at ? esc(ago(d.purged_at)) : '<span class="t-muted">null</span>'}</dd>
            <dt>Audited</dt><dd>${esc(ago(d.created_at))}</dd>
          </dl>
        </div>
      </div>
      <div class="drawer-foot">
        <button class="btn primary" disabled title="${esc(NO_DECISION_HOOK)}">Approve</button>
        <button class="btn danger" disabled title="${esc(NO_DECISION_HOOK)}">Reject</button>
        <button class="btn" disabled title="${esc(NO_REASK_HOOK)}">Re-request upload</button>
        <button class="btn ghost" id="cOpenFile" ${canOpen ? '' : 'disabled'} title="${esc(fileTitle)}">Open file</button>
      </div>`);
    $('cClose').addEventListener('click', closeDrawer);
    wireFileButton(d, canOpen);
  }

  function wireFileButton(d, canOpen) {
    if (!canOpen) return;
    const btn = $('cOpenFile');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      /* The tab is opened BEFORE the await. A popup blocker only trusts a
         window.open that happens inside the click's own task; opening it after
         the signing round-trip gets it blocked, and the reviewer sees nothing
         happen at all. */
      const tab = window.open('', '_blank', 'noopener');
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Signing…';
      try {
        const url = await signedUrl(d.storage_path, SIGNED_URL_TTL);
        if (tab) tab.location = url; else window.location.assign(url);
      } catch (e) {
        if (tab) tab.close();
        btn.title = `Could not open the document: ${e.message}`;
        btn.textContent = 'Could not open';
        /* Leave the failure on the button rather than throwing it away: the
           reviewer needs to know the archive did not answer, and this drawer
           has no other place to say so. */
        return;
      } finally {
        if (btn.textContent === 'Signing…') { btn.textContent = label; btn.disabled = false; }
      }
    });
  }

  /* ── Activity trail ────────────────────────────────────────────────────── */
  /* Unlike everything above, this is a log of things that actually happened, so
     the messages sent to voided contacts belong here — they were sent. What must
     not happen is presenting them as decisions, or printing a chat id in the
     place a person's name goes. Both are handled per row.

     With the void partition empty the void-marking branch is currently inert and
     no row carries the chip. It is kept because the branch has to stay correct
     for the day a row is voided again, and the card's own subtitle no longer
     promises marking that nothing on the page shows. */
  const hist = el('div', 'card flush'); hist.style.marginTop = '16px'; body.appendChild(hist);
  const down = [auditErr ? 'the audit log' : '', commsErr ? 'the message log' : ''].filter(Boolean);

  /* Two different vocabularies land in this one list and they must not be
     rendered as though they were one.

     A message row's kind is a string this file computes from the `[KYC-…]`
     prefix, so this file also supplies its tone. An audit row's kind is
     `audit_log.status`, which this file is not permitted to interpret: the
     rebuilt v_workflow_health and public.nexus_outcome_class() are the record,
     and lib/health.js is the mirror of them. Both were previously handed to
     pill() with no tone, so PARTIAL, NOT_EXECUTED and the file's own
     'KYC MESSAGE' all came out grey under the hover text saying the dashboard
     has no wording for them. Every value either vocabulary can produce now has
     one. Note that outcomeOf() can also correct a writer: a row logged FAILED
     whose own summary says a step "did not land" is a PARTIAL, and this trail
     says so because the shared module does. */
  const events = [
    ...kycComms.map(c => {
      const k = commKind(c.message);
      /* A message carries no register position of its own: communication_logs
         holds no document id, so which row a `[KYC-…]` line belongs to is
         unknowable and no state is claimed for it. Null, not 'unknown' — the
         renderer prints nothing rather than a pill saying we looked. */
      return { at: c.created_at, who: c.lead_email, text: c.message,
        label: k, tone: COMM_KIND_TONE[k] || 'cold', blurb: '',
        register: null, registerNote: '',
        voided: owns(voidCanon, c.lead_email), source: 'message' };
    }),
    ...(audit || []).map(a => {
      const o = outcomeOf(a);
      const ow = outcomeWords(o);
      /* lib/health.js uses the 'unknown' tone for two different things: an
         outcome it deliberately declines to grade (ESCALATED, NO_RESULT,
         REJECTED_EXPECTED — real states it will call neither good nor bad) and
         a status it does not recognise at all. Only the second may carry
         pill()'s "This dashboard has no wording for that status": an escalation
         handed to a person on purpose is a defined outcome with a defined word
         for it, and calling it unrecognised on the compliance screen is the
         exact failure this vocabulary exists to prevent.

         lib/format.js gained its own guard for this on 1 Sep 2026 — it now
         suppresses that title when the LABEL resolves in its TONE table — and
         that covers 'Escalated' but not 'Refused', which is not a TONE key. So
         the decision is made here, where the outcome is known, rather than
         inferred there from a word. Graded-but-not-green is pinned to 'cold',
         format.js's own neutral and the "grey rather than red" middle
         lib/health.js asks for; only OUTCOME.UNKNOWN keeps the grey pill and
         its hover text. */
      /* The second axis, on the row where the run itself is. A trail entry that
         says only "Escalated" leaves the reader to assume the register caught
         it; one that says "Escalated · register Unknown · not recorded" is the
         whole of what is known, and the note underneath says why no more can
         be said. Computed by the same memoised `caseFor` the banner and the
         ledger read, so the three cannot disagree about one run. */
      const c = caseFor(a);
      return { at: a.logged_at, who: a.lead_email || a.lead_name, text: a.summary,
        label: ow.label, tone: o === OUTCOME.UNKNOWN ? 'unknown' : (ow.tone === 'unknown' ? 'cold' : ow.tone),
        blurb: ow.blurb,
        recorded: String(a.lead_name || '').trim(),
        register: c.register, registerNote: c.note,
        voided: owns(voidCanon, a.lead_email), source: 'audit' };
    }),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  const trailBody = (auditErr && commsErr)
    ? stateError('KYC activity', auditErr)
    : events.length
      ? events.map(e => {
          const n = nameFor(e.who, e.recorded);
          return `
        <div class="list-item" style="cursor:default">
          <span class="mono t-muted">${esc(clock(e.at))}</span>
          ${e.voided ? `<span class="chip">${esc(e.label)} · void</span>` : pill(e.label, e.tone, { verbatim: false })}
          ${e.register ? `<span class="t-muted" style="font-size:12px">register</span>${casePill(e.register)}` : ''}
          <div style="flex:1;min-width:0">
            <div style="font-weight:500">${n.name
              ? esc(n.name)
              : `<span class="mono t-muted">${esc(n.note)}</span>`}${
              n.phone && n.phone !== n.name ? ` <span class="mono t-muted" style="font-weight:400">${esc(n.phone)}</span>` : ''}${
              n.recorded && n.recorded !== n.name
                ? ` <span class="t-warm" style="font-weight:400">recorded as ${esc(n.recorded)}</span>`
                : ''}</div>
            <div class="cell-sub" style="white-space:normal">${n.name ? esc(n.note) + ' · ' : ''}${
              n.phone ? '' : 'no phone stored · '}${esc(dealerText(e.text).slice(0, 180))}</div>
            ${e.blurb ? `<div class="cell-sub t-muted">${esc(e.blurb)}</div>` : ''}
            ${e.registerNote ? `<div class="cell-sub ${e.register === 'unknown' ? 't-warm' : 't-muted'}" style="white-space:normal">${esc(e.registerNote)}</div>` : ''}
            ${e.voided ? '<div class="cell-sub t-hot">Sent about a voided row — this was not a compliance decision, and the recipient was never a customer.</div>' : ''}
          </div>
          <div class="cell-sub">${esc(ago(e.at))}</div>
        </div>`;
        }).join('')
      : stateEmpty('No KYC activity on this page',
          `No run by the KYC auditor appears in the ${num(AUDIT_LIMIT)} most recent the activity log rows read here, and no [KYC-…] line appears in the ${num(COMM_LIMIT)} most recent message-log rows. That is what these two reads found; it is not a statement that nothing has ever run, because anything older than those windows is not on this page. Both lists fill the moment a customer sends an identity document on WhatsApp and the audit-kyc workflow runs.`,
          'history');

  hist.innerHTML = `<div class="card-head"><div><div class="card-title">KYC activity</div>
      <div class="card-sub">Auditor runs from the activity log and customer-facing KYC messages from the message history.${
        voided.length ? ' Messages sent about voided rows are shown — they were really sent — but marked as void so they are never read as decisions.' : ''}${
        voidFilterKnown ? '' : ' <span class="t-warm">The register could not be read on this page load, so nothing here could be checked against void_reason and no row is marked.</span>'}</div></div></div>
    ${down.length && !(auditErr && commsErr) ? `<div style="padding:14px 20px 0"><div class="banner warm">
      <span class="material-symbols-outlined">warning</span>
      <div>Could not read ${esc(down.join(' or '))} (${esc(auditErr || commsErr)}), so this trail is incomplete.</div></div></div>` : ''}
    <div>${trailBody}</div>`;

  /* The escalation banner's fallback target. Assigned after the card exists;
     the banner's handler cannot run before this line. */
  focusTrail = () => hist.scrollIntoView({ behavior: 'smooth', block: 'start' });

  /* ── WhatsApp consent ─────────────────────────────────────────────────────
     Built 6 Sep 2026, and it is the answer to a question a UAE dealership WILL
     be asked: who agreed to be messaged, when, and on what.

     WHERE THIS COMES FROM AND WHY IT IS NOT A TABLE READ. `whatsapp_opt_in_event`
     answers a signed-in dealership user with SQLSTATE 42501 — no table grant,
     no column grant, and a RESTRICTIVE deny naming `authenticated` that was laid
     deliberately on 6 Sep 2026 so the closure would be a decision rather than an
     accident. That floor was NOT lifted to build this. Both reads go through
     SECURITY DEFINER accessors whose RESULT TYPE is the projection, scoped by
     `nexus_current_tenant_ids()` — the same key every tenant policy uses — so a
     column that is not shown here is absent by construction rather than by
     whichever grant nobody revoked.

     THE CURRENT STATE IS NOT DERIVED HERE AND MUST NOT BE. Working out whether
     a customer is opted in from a list of events means choosing an order, and
     choosing an order is where a replayed OPT_IN overturned a later OPT_OUT
     once already. `nexus_whatsapp_consent_current()` calls the database's own
     `whatsapp_opt_in_state()`, which carries the OPT_OUT-wins tie-break and the
     future-dated filter with it. This screen renders that answer; it does not
     compute one.

     AND EMPTY IS NOT AN ANSWER ABOUT ANYBODY. Production holds zero rows today.
     That means nothing has been recorded — not that nobody has opted out, and
     not that everybody has agreed. The empty state below says exactly that, and
     the counts are counts of RECORDS rather than of people or of permissions. */
  const consent = el('div', 'card flush'); consent.style.marginTop = '16px'; body.appendChild(consent);
  consent.innerHTML = `<div class="card-head"><div><div class="card-title">WhatsApp consent</div>
      <div class="card-sub">Reading what this dealership has recorded about who may be messaged.</div></div></div>${stateLoading(3)}`;

  const CONSENT_LIMIT = 200;
  const CONSENT_NOTHING =
    'Nothing has been recorded here yet. Read that as the absence of a record and nothing else: it is not a statement that nobody has opted out, and it is not a statement that anybody has agreed. NEXUS writes a row here when a customer opts in or out through a channel it is watching, and no such row exists for this dealership.';
  /* Said beneath the current-state list. The window rule is a separate control
     and this screen does not restate its verdict — but a reader looking at an
     empty consent register must not conclude that messaging is therefore
     unconstrained. */
  const CONSENT_SCOPE =
    'This register is the record of what a customer said. It is not the whole of whether a message may be sent — the platform’s own rules apply on top of it — and a customer who appears nowhere on this list has said neither yes nor no.';

  const [conEvR, conStR] = await Promise.allSettled([
    db(`rpc/nexus_whatsapp_consent_events?p_limit=${CONSENT_LIMIT}`),
    db('rpc/nexus_whatsapp_consent_current'),
  ]);
  const conEv = conEvR.status === 'fulfilled' ? conEvR.value : null;
  const conEvErr = conEvR.status === 'rejected' ? conEvR.reason : null;
  const conSt = conStR.status === 'fulfilled' ? conStR.value : null;
  const conStErr = conStR.status === 'rejected' ? conStR.reason : null;
  const conCapped = !!conEv && conEv.length >= CONSENT_LIMIT;

  /* OPT_OUT is not a failure and OPT_IN is not a success — a customer
     withdrawing consent is the system working. `dead` and `ok` are the two
     tones that read as "ended" and "in force" rather than as bad and good. */
  const consentChip = ev => pill(ev === 'OPT_OUT' ? 'Opted out' : 'Opted in', ev === 'OPT_OUT' ? 'dead' : 'ok');
  const stateChip = st => pill(st === 'OPTED_OUT' ? 'Opted out' : 'Opted in', st === 'OPTED_OUT' ? 'dead' : 'ok');

  const conCurrentBody = conStErr
    ? stateError('the current consent position', conStErr, null,
        'Nobody’s consent has changed — this is a read that failed. The history below is read separately and may still have loaded.')
    : (conSt && conSt.length)
      ? `<div>${conSt.map(c => `<div style="padding:12px 20px;border-top:1px solid var(--line);display:flex;gap:16px;flex-wrap:wrap;align-items:baseline">
          <div style="flex:1;min-width:180px"><span class="mono">${esc(c.customer_wa_id)}</span>
            ${c.channel_identifier ? `<div class="cell-sub">on ${esc(c.channel_identifier)}</div>` : ''}</div>
          <div style="flex:0 0 auto">${stateChip(c.state)}</div>
          <div style="flex:2;min-width:240px">
            <div class="cell-sub">${esc(ago(c.occurred_at))}${c.mechanism ? ` · ${esc(String(c.mechanism).toLowerCase().replace(/_/g, ' '))}` : ''}</div>
            <div class="cell-sub mono" style="white-space:normal">${esc(c.evidence_kind || 'no evidence kind recorded')}: ${esc(c.evidence_ref || 'no reference recorded')}</div>
          </div>
        </div>`).join('')}`
      : stateEmpty('No customer has a recorded position', CONSENT_NOTHING, 'contact_support');

  const conHistoryBody = conEvErr
    ? stateError('the consent history', conEvErr, null,
        'This is the history read only; the current position above is read separately.')
    : (conEv && conEv.length)
      ? `<div>${conEv.map(e => `<div style="padding:10px 20px;display:flex;gap:16px;flex-wrap:wrap;align-items:baseline">
          <div style="flex:0 0 auto">${consentChip(e.event)}</div>
          <div style="flex:1;min-width:170px"><span class="mono">${esc(e.customer_wa_id)}</span></div>
          <div style="flex:2;min-width:260px">
            <div class="cell-sub">${esc(clock(e.occurred_at))}${e.mechanism ? ` · ${esc(String(e.mechanism).toLowerCase().replace(/_/g, ' '))}` : ''}${
              e.channel_identifier ? ` · ${esc(e.channel_identifier)}` : ''}</div>
            <div class="cell-sub mono" style="white-space:normal">${esc(e.evidence_kind || 'no evidence kind recorded')}: ${esc(e.evidence_ref || 'no reference recorded')}</div>
            ${/* Two different instants, and a reviewer asks about both: when the
                  customer said it, and when this system wrote it down. */''}
            <div class="cell-sub">Recorded ${esc(ago(e.recorded_at))} by ${esc(e.recorded_by || 'an unnamed writer')}${
              e.notes ? ` — ${esc(e.notes)}` : ''}</div>
          </div>
        </div>`).join('')}`
      : stateEmpty('Nothing has been recorded', CONSENT_NOTHING, 'history');

  consent.innerHTML = `<div class="card-head"><div>
      <div class="card-title">WhatsApp consent</div>
      <div class="card-sub">Who has agreed to be messaged on WhatsApp, who has withdrawn, when, and on what evidence.
        Every line is a record this dealership holds; nothing on this card is inferred, and a customer who is absent has said neither yes nor no.</div>
    </div></div>
    <div style="padding:14px 20px 4px"><div class="label-caps">Where each customer stands now</div>
      <div class="cell-sub" style="white-space:normal">The database’s own answer, not one worked out here — the order that decides it lives in one place so a replayed message cannot overturn a withdrawal.</div></div>
    ${conCurrentBody}
    <div style="padding:14px 20px 4px;border-top:1px solid var(--line)"><div class="label-caps">Everything recorded${
      conEv && conEv.length ? ` · ${num(conEv.length)}` : ''}</div>
      <div class="cell-sub" style="white-space:normal">Newest first.${conCapped
        ? ` <span class="t-warm">This read stopped at ${num(CONSENT_LIMIT)} records, so there are older ones this page has not looked at.</span>`
        : ''}</div></div>
    ${conHistoryBody}
    <div style="padding:14px 20px"><div class="cell-sub" style="white-space:normal">${esc(CONSENT_SCOPE)}</div></div>`;

};

/* ==========================================================================
   S9 · Campaigns
   The 7-day warm drip and the 12-hour silence detector both ran entirely inside
   n8n with nothing in the product to show for them, and no way to start one.
   A campaign nobody can see or trigger is indistinguishable from a broken one —
   which is exactly how the drip sat failing on every run without being noticed.
   ========================================================================== */
