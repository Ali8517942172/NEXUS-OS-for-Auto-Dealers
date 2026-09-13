/* NEXUS OS — screens/held-enquiries.js
   HELD ENQUIRIES. Every WhatsApp conversation NEXUS recorded, decided was not a
   vehicle enquiry, and did NOT hand to the floor — with what it read, why it
   declined, and the three things a person can do about it.

   New on 8 September 2026. It is the screen ops/enquiry-classification/DESIGN.md
   §4.7 specifies, built to this app's existing conventions and to nothing else.

   ═══════════════════════════════════════════════════════════════════════════
   REGISTRATION — the exact lines, in the exact files. This module registers
   itself into SCREENS; it does not and must not edit the two files below.
   ═══════════════════════════════════════════════════════════════════════════
   1 · apps/executive-dashboard/app.js
       Insert ONE line into the static import block, between
         import './screens/finance.js';
       and
         import './screens/inventory.js';
       so the list stays alphabetical by filename:

         import './screens/held-enquiries.js';

       A PLAIN STATIC IMPORT, not the import.meta.glob block below it. That
       block exists for the five Revenue Recovery engine modules that may not
       have landed; this file is on disk, and app.js's own comment says the
       static list is meant to be the readable inventory of what the app
       contains.

   2 · apps/executive-dashboard/lib/nav.js
       Insert ONE line into the `Work` group, between

         { id:'leadsources',   title:'Lead Sources',    icon:'alt_route' },
       and
         { id:'conversations', title:'Conversations',   icon:'forum' },

       reading exactly:

         { id:'heldenquiries', title:'Held Enquiries',  icon:'pending_actions' },

       That position is the argument, not a preference. Lead Sources answers
       WHICH DOOR THEY CAME THROUGH; this answers WHO KNOCKED AND WAS NOT LET
       IN. Conversations is the inbox — every thread — and is a different
       question; this is only the threads with a decision pending.

   ═══════════════════════════════════════════════════════════════════════════
   WHAT MUST EXIST IN THE DATABASE BEFORE THIS SCREEN CAN WORK
   ═══════════════════════════════════════════════════════════════════════════
   NONE OF IT EXISTS ON PRODUCTION `dsvuoovivysszdoiorch`. Measured 8 Sep 2026
   against information_schema.tables and pg_proc: no relation whose name
   contains "enquiry" or "classification" exists in `public`, and no function
   whose name contains "enquiry" exists. This screen therefore renders a STATED
   UNKNOWN today — it says, in the dealership's own words, that this part of
   NEXUS is not switched on here and that nothing is being ruled out, and it
   logs the exact object name to the console for whoever can install it. It will
   keep doing that until the migration lands, and it never renders an empty
   list, a bare zero, or a calm panel.

   Required, in this order:

   A · TABLES — ops/enquiry-classification/DESIGN.md §6.3
       public.enquiry_classification   (append-only ledger, one row per attempt)
       public.enquiry_hold_action      (event_id, action PROMOTE|DISMISS|
                                        REQUEST_CONTEXT, actor, acted_at,
                                        reason, note)  ← this is FN-1
       RLS on both: service_role all; authenticated SELECT scoped by tenant;
       anon denied restrictively.

   B · VIEWS — §4.2, plus four columns this screen needs that §4.2's sketch does
       not list. The four are named here so the migration can include them; they
       are an addition to the design, flagged as one, not a silent assumption.

       public.v_enquiry_held      — the queue. phase = 'RECEIVED' and
                                    decision = 'HOLD'. Columns this screen
                                    selects, all of them by name:
         event_id, source_key, first_received_at, last_classified_at,
         hold_reason, verdict, confidence, unclear_because, machine_reason,
         evidence, evidence_verified, language, messages_read, model,
         ladder_tier, prompt_version, last_inbound_at, inbound_count,
         last_inbound_excerpt, display_name, phone_e164

       public.v_enquiry_held_all  — the same shape WITHOUT the phase filter,
                                    plus these four (the addition):
         phase, disposition_reason, acted_at, acted_action

       public.v_enquiry_classification_health — one row for the caller's
         dealership over a stated window. Columns this screen selects by name:
         window_days, conversations_recorded, promoted_automatically,
         promoted_marked_not_a_customer, held_total, held_reviewed,
         coverage_pct, promoted_from_held, found_by_another_route_while_held,
         quarantined_never_reviewed, fn_rate_pct_of_reviewed,
         fn_rate_is_quotable, quarantine_after_days_silent, caveat, computed_at

         `caveat` is the plain-English paragraph of §4.7 — what this queue
         cannot tell the dealership. It is PRINTED VERBATIM here and is
         deliberately not paraphrased in this file, so there is one derivation
         of it and it cannot drift.

         `fn_rate_is_quotable` is the view's own answer to the §3.4 rule that
         below roughly 60% coverage the false-negative figure is not reported as
         a rate at all. This screen renders the view's answer and computes no
         rate of its own.

       All three views: `alter view … set (security_invoker = on);` so RLS
       decides as the signed-in dealership, exactly as v_lead_origin does.

   C · FUNCTIONS — §4.4. SECURITY DEFINER, three of them, and this screen writes
       through these and nothing else:
         public.nexus_enquiry_promote_held(p_event_id uuid, p_note text)
         public.nexus_enquiry_dismiss_held(p_event_id uuid, p_reason text)
         public.nexus_enquiry_request_context(p_event_id uuid, p_template_key text)

   D · GRANTS — the shape the layer already uses (measured on production 8 Sep
       2026: v_lead_origin grants SELECT to `authenticated` only;
       nexus_lead_source_readiness and nexus_lead_record_manual carry
       EXECUTE for `authenticated` and `service_role` and nothing wider):

         grant select on public.v_enquiry_held                   to authenticated;
         grant select on public.v_enquiry_held_all               to authenticated;
         grant select on public.v_enquiry_classification_health  to authenticated;

         revoke all on function public.nexus_enquiry_promote_held(uuid, text)    from public, anon;
         revoke all on function public.nexus_enquiry_dismiss_held(uuid, text)    from public, anon;
         revoke all on function public.nexus_enquiry_request_context(uuid, text) from public, anon;
         grant execute on function public.nexus_enquiry_promote_held(uuid, text)    to authenticated, service_role;
         grant execute on function public.nexus_enquiry_dismiss_held(uuid, text)    to authenticated, service_role;
         grant execute on function public.nexus_enquiry_request_context(uuid, text) to authenticated, service_role;

         notify pgrst, 'reload schema';

       No grant on public.lead_event, public.enquiry_classification or
       public.enquiry_hold_action to `authenticated` for anything but SELECT.
       This screen never writes a table. §4.2's note applies: whatever strips
       grants born open is intended behaviour here and not an obstacle.

   E · TWO THINGS THIS SCREEN OFFERS THAT DESIGN.md DOES NOT PIN DOWN, both
       flagged rather than assumed. The function is the authority in each case,
       and a refusal from it is rendered as it arrives:

       · THE DISMISS VOCABULARY. §4.4 says `disposition_reason` comes "from a
         closed vocabulary" and does not list it. The five keys offered below
         are taken from the shape §3.4 uses for the promotion-feedback closed
         set. If `nexus_enquiry_dismiss_held` refuses one, the refusal is shown
         and nothing is retried; reconcile the list, do not widen the function.

       · THE CONTEXT TEMPLATE KEY. §4.4 requires a fixed, human-authored
         template from a closed set and forbids a model writing any of it. It
         names no key. This screen sends exactly one — see CONTEXT_TEMPLATE —
         and shows the salesperson no message text at all, because it cannot
         read the template register and MUST NOT invent a preview of what a
         customer will receive.

   F · THE QUALITY GATE WILL FAIL ON THIS FILE UNTIL A–D LAND, AND THAT IS THE
       GATE WORKING. QUALITY_GATE.mjs check S3 extracts every PostgREST path
       from source and asserts the relation and every named column exists in the
       live catalogue. Three views and three functions here do not, so S3
       reports them by name. Do not silence it by selecting `*` or by building
       paths from variables — both would hide a real defect on the day one
       appears. The failure is the correct report of an unapplied migration.

   ═══════════════════════════════════════════════════════════════════════════
   WHY THIS SCREEN IS THE INSTRUMENT AND NOT A LIST
   ═══════════════════════════════════════════════════════════════════════════
   The accepted model is "Capture everything. Promote intelligently. Lose
   nothing." The first two are machinery. THE THIRD IS THIS SCREEN. A held
   conversation that nobody can see was not held; it was dropped, with a nicer
   word on it.

   And the click that promotes a row from here is the measurement:
   DESIGN.md §3.4 FN-1 makes the promote-from-held rate the measured
   false-negative rate of the classifier. Every promote writes an
   enquiry_hold_action row with the actor and the moment. So an unusable screen
   does not merely annoy a salesperson — it makes the classifier's error rate
   unmeasurable, and nobody ever learns how many customers the AI declined.
   That is why the three controls are full-size buttons on the row rather than
   an overflow menu, why the reason a row is here is prose and not a code, and
   why the evidence is shown as the customer's own words.

   ═══════════════════════════════════════════════════════════════════════════
   THE RULES THIS SCREEN IS BUILT AROUND
   ═══════════════════════════════════════════════════════════════════════════
   · A MISSING VIEW IS NOT AN EMPTY QUEUE. This repo has recorded eight
     instances of an unknown rendered as a fact. The queue read has three
     outcomes, not two: rows, no rows, and "the thing that would have answered
     is not there". The third names what is missing and never renders as calm.

   · ZERO IS NOT REASSURANCE. "No conversation is currently held for review" is
     printed with the number of conversations recorded and classified in the
     window beside it. A bare 0 reads as a performance figure and is not one.
     Where the denominator cannot be read, the zero is not printed as a finding
     at all.

   · THE MACHINE'S WORDS ARE ATTRIBUTED, EVERY TIME. `machine_reason` is one
     sentence a model wrote about a conversation NEXUS then declined to act on.
     It is rendered as the classifier's claim, beside the VERIFIED quote it
     rests on, never as a fact about the customer. `vehicle_mentioned` is
     deliberately not selected and not shown: a vehicle name on this screen
     would be a machine's reading of a message presented as a customer's stated
     interest, and §1.6 exists because a model that cannot quote the line it
     relies on is a model whose confidence is not about this conversation.

   · NO MONEY, ANYWHERE. Nothing in this database records what an enquiry was
     worth, and nothing here estimates what a held one would have been. The
     product has already put an AI-invented AED 11,200 EMI in front of a real
     customer; a fabricated figure on a screen whose whole subject is what the
     AI got wrong would be the same defect wearing a warning label.

   · NEVER THE RAW HANDLE WHERE A NAME GOES. Every chat id measured on
     production is an `@lid`, and a LID identifies nobody. screens/conversations.js
     carries this rule and the screen that broke it. An unresolved row says
     "Not identified" and shows the handle as an address, in mono.

   ═══════════════════════════════════════════════════════════════════════════
   WHERE EVERYTHING COMES FROM — nothing on this screen is computed here
   ═══════════════════════════════════════════════════════════════════════════
     v_enquiry_held                      the queue rows
     v_enquiry_held_all                  the archive tab (QUARANTINED, still
                                         promotable — a dismissal is a person
                                         saying "not now", and people are wrong)
     v_enquiry_classification_health     every figure in the counters panel, its
                                         window, its caveat and its age

   The three counts on the filter chips are counts of the rows this screen
   actually loaded, and the caption says so. They are the one thing here derived
   in the browser, and they are derived from what is on the screen rather than
   from anything the database was not asked. */

import { db, dbWrite, onIdentityChange } from '../lib/data.js';
import { logError } from '../lib/errors.js';
import { ago, dubaiStamp, esc, n0, num, pill } from '../lib/format.js';
import { openModal } from '../lib/modal.js';
import { SCREENS, currentGeneration, go, staleRender } from '../lib/nav.js';
import { stateEmpty } from '../lib/states.js';
import { kpi, panel } from '../lib/ui.js';

/* ── Small local vocabulary, in the shape screens/lead-sources.js uses ────── */
const str = v => String(v == null ? '' : v).trim();
const up = v => str(v).toUpperCase();
const plural = (c, one, many) => (Number(c) === 1 ? one : many);
const muted = h => `<div class="cell-sub">${h}</div>`;
const hot = h => `<div class="cell-sub t-hot">${h}</div>`;
const warm = h => `<div class="cell-sub t-warm">${h}</div>`;
const bold = h => `<div style="font-weight:600">${h}</div>`;

const linkBtn = (id, label) => (SCREENS[id]
  ? `<button class="btn sm" data-go="${esc(id)}">${esc(label)}</button>`
  : `<button class="btn sm ghost" disabled>${esc(label)} — not in this build</button>`);
/* Marks what it has wired. The queue panel redraws its own body without
   rebuilding its head, so this runs more than once against the same buttons,
   and a link that navigates twice per click is a link that fires two renders. */
const wireGo = card => {
  card.querySelectorAll('[data-go]').forEach(b => {
    if (b.disabled || b.dataset.wired === '1') return;
    b.dataset.wired = '1';
    b.addEventListener('click', () => go(b.dataset.go));
  });
};

/* ══════════════════════════════════════════════════════════════════════════
   The vocabulary this screen renders
   ══════════════════════════════════════════════════════════════════════════
   Kept in this file rather than added to lib/vocabulary.js only because this
   file owns the whole of it today and three other agents are editing that
   module in the same hour. When the classifier ships, these three tables move
   there whole — they are already in that file's shape (label / tone / blurb),
   and every one of them answers a value the DATABASE owns, so a value outside
   the set renders as itself, marked, and is never folded into a neighbour.

   The five hold reasons are the owner's own words, from DESIGN.md §1.5. The
   sixth is ours and reads like it: CLASSIFIER_UNAVAILABLE is a statement about
   NEXUS, not about the customer, and folding it into "Unclear" would be
   rendering our outage as their ambiguity. */
const HOLD_REASON = Object.freeze({
  POTENTIAL_ENQUIRY: { label: 'Potential enquiry', tone: 'warm',
    blurb: 'This reads like somebody asking about a vehicle, and the evidence for that was thin enough that NEXUS '
         + 'would not put it on the floor by itself. Of everything on this screen, this is the one most likely to be '
         + 'a customer.' },
  NEEDS_MORE_CONTEXT: { label: 'Needs more context', tone: 'cold',
    blurb: 'Too short to tell either way — the "Hi" case. Nothing is wrong with the message; there is simply not '
         + 'enough of it yet. If they write again, NEXUS reads the whole thread afresh and this row can leave the '
         + 'queue on its own.' },
  NOT_VEHICLE_ENQUIRY: { label: 'Not a vehicle enquiry', tone: 'unknown',
    blurb: 'NEXUS read this as confidently about something else. It is still a real person who messaged this '
         + 'dealership, which is why it is here and not discarded.' },
  UNCLEAR: { label: 'Unclear', tone: 'unknown',
    blurb: 'NEXUS could not decide, and recorded why. An undecided message is not a rejected one.' },
  HUMAN_REVIEW: { label: 'Human review', tone: 'warm',
    blurb: 'A check inside NEXUS fired — most often that it could not confirm, word for word, the line it was '
         + 'relying on. It is here for a person to read rather than for the machine to try again.' },
  CLASSIFIER_UNAVAILABLE: { label: 'NEXUS could not read this yet', tone: 'hot',
    blurb: 'No model answered, so nothing was decided about this conversation at all. This is our fault and not a '
         + 'statement about the customer. It is retried, it is never swept away on a timer, and it stays here, '
         + 'visibly, until NEXUS manages to read it or a person acts.' },
});
const holdReason = v => HOLD_REASON[up(v)] || null;

/* Why the model said it could not decide. A closed set, so it can be counted;
   the free-prose reason beside it cannot. */
const UNCLEAR_BECAUSE = Object.freeze({
  TOO_SHORT: 'The message was too short to carry a subject.',
  NO_SUBJECT: 'The message never says what it is about.',
  LANGUAGE_NOT_UNDERSTOOD: 'The language was not one NEXUS could read.',
  AMBIGUOUS_SUBJECT: 'The subject could have been more than one thing.',
  MIXED_TOPICS: 'The message covered several topics at once.',
});

/* Three bands, not a number, and the caption says why. DESIGN.md §1.4: four
   different models answer this prompt and nothing calibrates them, so 0.7 from
   one and 0.7 from another are not the same claim. A percentage here would be a
   number no model produced. */
const CONFIDENCE = Object.freeze({
  HIGH: { label: 'High confidence', tone: 'ok' },
  MEDIUM: { label: 'Medium confidence', tone: 'cold' },
  LOW: { label: 'Low confidence', tone: 'warm' },
});
const CONFIDENCE_IS_A_BAND =
  'High, medium and low are the three bands the classifier is allowed to answer in. They are not percentages and '
  + 'not probabilities: several different models answer this question and nothing puts them on one scale, so a '
  + 'number here would be invented rather than measured.';

const VERDICT = Object.freeze({
  VEHICLE_ENQUIRY: 'NEXUS read this as somebody asking about a vehicle.',
  NOT_VEHICLE_ENQUIRY: 'NEXUS read this as being about something else.',
  UNCLEAR: 'NEXUS could not read this either way.',
});

/* The dismiss vocabulary. See E in the header: DESIGN.md does not fix this list
   and the function is the authority. A refusal is rendered as it arrives. */
const DISMISS_REASONS = Object.freeze([
  ['NOT_A_VEHICLE_ENQUIRY', 'Not about a vehicle'],
  ['WRONG_NUMBER', 'Wrong number'],
  ['ANOTHER_BUSINESS', 'Another business, not a customer'],
  ['SPAM', 'Spam'],
  ['DUPLICATE_OF_EXISTING', 'We already have this customer'],
]);

/* One key, sent as-is. No model writes any part of the message, no field of the
   classifier's output is interpolated into it, and this screen deliberately
   renders NO preview of the text: it cannot read the template register, and a
   guessed preview of what a real customer is about to receive would be worse
   than no preview. */
const CONTEXT_TEMPLATE = 'ENQUIRY_ASK_WHAT_THEY_ARE_LOOKING_FOR';

/* A WhatsApp handle in any shape WAHA emits. Kept local for the same reason
   screens/conversations.js keeps its copy local: this is a rendering question
   ("may this string sit where a name goes?"), not a matching one. A LID carries
   no phone digits, so it names nobody. */
const HANDLE = /@(lid|c\.us|s\.whatsapp\.net|g\.us|whatsapp\.lead)$/i;
const isHandle = v => HANDLE.test(str(v));

/* ══════════════════════════════════════════════════════════════════════════
   Telling a missing thing from a refused thing from a broken thing
   ══════════════════════════════════════════════════════════════════════════
   lib/errors.js classifies a failure into the four cases this app can honestly
   tell apart, and 404 lands in `generic` — correctly, because in general the
   app cannot know what a 404 means. Here it can, and the difference decides
   whether a salesperson is looking at a feature that has not been installed or
   at one they are not allowed to use. Those are opposite instructions.

   The errors lib/data.js throws carry the SQLSTATE (or PostgREST's own code) on
   `.code` and the HTTP status on `.status`; nothing here reads `.technical`,
   which is console-only by design.

     PGRST205 / 42P01   the relation is not in the database
     PGRST202 / 42883   the function is not in the database
     42703              the relation exists and does not have a column this
                        screen names — a contract drift, not an absence
     42501 / 403        it exists and this signed-in user was refused */
const CODE = e => str(e && e.code).toUpperCase();
const isMissingRelation = e => e && (['PGRST205', '42P01'].includes(CODE(e))
  || (Number(e.status) === 404 && !CODE(e)));
const isMissingFunction = e => e && (['PGRST202', '42883'].includes(CODE(e))
  || (Number(e.status) === 404 && !CODE(e)));
const isColumnDrift = e => e && CODE(e) === '42703';
const isRefused = e => e && (CODE(e) === '42501' || Number(e.status) === 403);

/* One sentence per case, written for a salesperson.

   THE RELATION NAME DOES NOT REACH THE SCREEN, and that is deliberate rather
   than vague. CONTROL-PLANE.md's rule is symptom and impact to the dealership,
   mechanism and location to the vendor — a view name is location, it is not
   something a salesperson can act on, and lib/vocabulary.js exists so that
   schema identifiers stay off these pages. So the exact name goes to the
   console under the app's own `[NEXUS error]` prefix, where the person who can
   fix it is looking, and the header block at the top of this file names all six
   objects precisely for whoever applies the migration.

   `what` is prose this file wrote about its own subject. The only wire-derived
   string that can reach the DOM here is `.message`, which lib/errors.js
   guarantees is one of four user-safe clauses. */
function whyUnavailable(e, what, name) {
  logError(`held-enquiries: ${name} could not be read`, e);
  if (isMissingRelation(e) || isMissingFunction(e)) {
    return `${what} is not switched on for this dealership yet, so there is nothing to read. This is not an empty `
      + 'queue and it is not a quiet week — it is a part of NEXUS that has not been installed here, and nobody can '
      + 'act on a held conversation until it is.';
  }
  if (isColumnDrift(e)) {
    return `${what} exists but does not hold everything this screen asks it for, so it was not read at all rather `
      + 'than read in part. A half-read queue would look like a short one, and a short queue is the one thing this '
      + 'screen must never show by accident.';
  }
  if (isRefused(e)) {
    return `${what} exists and this sign-in was refused access to it, so nothing is being shown and nothing is being `
      + 'ruled out. Ask whoever administers NEXUS for this dealership.';
  }
  return `${what} could not be read (${esc(str(e && e.message) || 'no reason given')}), so nothing is claimed here `
    + 'and nothing is ruled out. An unread queue is not an empty one.';
}

/* ══════════════════════════════════════════════════════════════════════════
   Reads
   ══════════════════════════════════════════════════════════════════════════
   The memo is per RENDER, not per page load, and the reasoning is
   screens/lead-sources.js's verbatim: module state survives the re-auth path,
   which does not reload the page, so a memo that is never cleared would show a
   second dealership's user the first one's held conversations. resetReads()
   runs at the top of the mount function and again on any change of signed-in
   identity. Only one of those two events is under this file's control, which is
   why both are wired. */
const MEMOS = new Set();
const shared = make => {
  let p = null;
  const f = () => {
    if (!p) { p = make(); p.catch(() => { p = null; }); }
    return p;
  };
  MEMOS.add(() => { p = null; });
  return f;
};
const settle = pr => pr.then(v => ({ v, err: null }), e => ({ v: null, err: e }));

/* The cap is a fact about every count on this screen, not an implementation
   detail, and the panel that lists what is not known says so with the number in
   it when it is reached. Ordered by the queue's own clock — the LAST inbound
   message, ascending — because DESIGN.md §4.5 resets that clock every time the
   customer writes again, so the longest-silent conversation is the one closest
   to being lost. Nulls first: a row whose clock cannot be read is the least
   certain of all and does not belong at the bottom of a list nobody scrolls. */
const HELD_LIMIT = 500;

/* Every read carries the moment it landed. "How old is this?" is a question a
   salesperson deciding whether to phone somebody is entitled to ask, and a
   screen that cannot answer it is asking to be trusted on nothing. */
const stamped = rows => ({ rows: Array.isArray(rows) ? rows : [], readAt: new Date().toISOString() });

/* THE COLUMN LISTS ARE HAND-TYPED AND DELIBERATELY NOT SHARED THROUGH A
   CONSTANT, and that is the same decision screens/lead-sources.js records for
   the same reason. These views are published contracts, and QUALITY_GATE.mjs
   check S3 extracts the relation and every named column from the source and
   asserts them against the live catalogue — it can only do that when the
   select list is a plain string literal at the call site. Interpolating a
   shared constant into the path hides the columns from the one check that
   would catch a rename, so the duplication buys a real guarantee and is worth
   the twenty-one repeated names.

   Ordered by the queue's own clock — the LAST inbound message, ascending —
   because DESIGN.md §4.5 resets that clock every time the customer writes
   again, so the longest-silent conversation is the one closest to being lost.
   Nulls first: a row whose clock cannot be read is the least certain of all and
   does not belong at the bottom of a list nobody scrolls.

   The cap is a fact about every count on this screen rather than an
   implementation detail, and the panel that lists what is not known says so
   with the number in it when it is reached. */
const readHeld = shared(() => db('v_enquiry_held?select=event_id,source_key,first_received_at,'
  + 'last_classified_at,hold_reason,verdict,confidence,unclear_because,machine_reason,evidence,'
  + 'evidence_verified,language,messages_read,model,ladder_tier,prompt_version,last_inbound_at,'
  + 'inbound_count,last_inbound_excerpt,display_name,phone_e164'
  + `&order=last_inbound_at.asc.nullsfirst&limit=${HELD_LIMIT}`).then(stamped));

/* The archive. QUARANTINED rows stay promotable — DESIGN.md §4.6: quarantine is
   "held for inspection", not deletion and not a closed door, and that is the
   whole reason the timer can afford to be thirty days rather than seven.
   `phase`, `disposition_reason`, `acted_at` and `acted_action` are the four
   columns §4.2's sketch does not list and this tab needs; the header block
   names them as an addition to the design rather than assuming them quietly. */
const readArchive = shared(() => db('v_enquiry_held_all?select=event_id,source_key,first_received_at,'
  + 'last_classified_at,hold_reason,verdict,confidence,unclear_because,machine_reason,evidence,'
  + 'evidence_verified,language,messages_read,model,ladder_tier,prompt_version,last_inbound_at,'
  + 'inbound_count,last_inbound_excerpt,display_name,phone_e164,phase,disposition_reason,acted_at,'
  + 'acted_action&phase=eq.QUARANTINED'
  + `&order=last_inbound_at.asc.nullsfirst&limit=${HELD_LIMIT}`).then(stamped));

/* One row, over a window the view states rather than one this file assumes. */
const readHealth = shared(() => db('v_enquiry_classification_health?select=window_days,'
  + 'conversations_recorded,promoted_automatically,promoted_marked_not_a_customer,held_total,'
  + 'held_reviewed,coverage_pct,promoted_from_held,found_by_another_route_while_held,'
  + 'quarantined_never_reviewed,fn_rate_pct_of_reviewed,fn_rate_is_quotable,'
  + 'quarantine_after_days_silent,caveat,computed_at&limit=1').then(stamped));

const resetReads = () => { MEMOS.forEach(reset => reset()); };

/* ══════════════════════════════════════════════════════════════════════════
   The three acts, and what happens when somebody clicks twice
   ══════════════════════════════════════════════════════════════════════════
   Every act goes through a SECURITY DEFINER function. This screen does not
   write a table, and it is not going to become the third one in this app that
   does.

   DOUBLE-CLICK SAFETY IS THREE THINGS, and all three are needed:

     1. IN FLIGHT. A second click while the first request is open is refused in
        the browser and says so. Nothing is sent twice.
     2. SETTLED. Once an act on a conversation has SUCCEEDED, every control on
        that row is disabled for the life of the render and replaced with what
        happened. Promote and dismiss are decisions about the same row and the
        second one would be answering a question that is no longer open.
     3. THE OUTCOME WE DO NOT KNOW. A rejected fetch means the request produced
        no response — it may have landed and it may not. That is not a failure
        and must not be offered as a retry: clicking again could send a second
        message to a real person. The row locks, and the sentence says exactly
        why and what to do (reload, then look at the row).

        A REFUSAL is different and is retryable: a 403, or a function that is
        not installed, is a request that provably did not happen. Those
        re-enable the buttons.

   The functions are keyed on the event, so a promote that somehow arrives twice
   is the database's problem to be idempotent about and this file does not
   pretend otherwise — it removes the ways a browser can cause it. */
const INFLIGHT = new Set();
const SETTLED = new Map();       // event_id -> { action, at, detail }
MEMOS.add(() => { INFLIGHT.clear(); SETTLED.clear(); });
onIdentityChange(resetReads);

/* Each act names its function as a STRING LITERAL at the call site rather than
   through `rpc/${act.fn}`. QUALITY_GATE.mjs check S3 skips a path built from a
   variable — it says so in its own comment — so a table-driven dispatch would
   have hidden all three names from the check that reports a function the
   database does not have. These three do not exist yet; the gate naming them is
   the point, not an inconvenience. */
const ACTS = Object.freeze({
  PROMOTE: {
    label: 'Promote to a lead',
    done: 'Promoted to a lead',
    call: (id, arg) => dbWrite('POST', 'rpc/nexus_enquiry_promote_held',
      { p_event_id: id, p_note: arg || null }),
  },
  DISMISS: {
    label: 'Dismiss',
    done: 'Dismissed',
    call: (id, arg) => dbWrite('POST', 'rpc/nexus_enquiry_dismiss_held',
      { p_event_id: id, p_reason: arg }),
  },
  REQUEST_CONTEXT: {
    label: 'Ask what they are looking for',
    done: 'Asked what they are looking for',
    call: (id) => dbWrite('POST', 'rpc/nexus_enquiry_request_context',
      { p_event_id: id, p_template_key: CONTEXT_TEMPLATE }),
  },
});

/* Returns { ok, retryable, message }. It never throws and it never renders. */
async function runAct(kind, eventId, arg) {
  const act = ACTS[kind];
  const key = `${kind}:${eventId}`;
  if (SETTLED.has(eventId)) {
    const s = SETTLED.get(eventId);
    return { ok: false, retryable: false,
      message: s.unknown
        ? 'This row is locked because NEXUS could not confirm whether the last action was carried out. Reload the '
          + 'screen and read the row before doing anything else.'
        : `Already ${ACTS[s.action].done.toLowerCase()} in this session. Nothing was sent again.` };
  }
  if (INFLIGHT.has(key)) {
    return { ok: false, retryable: false, message: 'That is already being sent. Nothing was sent twice.' };
  }
  INFLIGHT.add(key);
  try {
    const rows = await act.call(eventId, arg);
    const r = Array.isArray(rows) ? rows[0] : rows;
    SETTLED.set(eventId, { action: kind, at: new Date().toISOString(), detail: r || null });
    /* Reported rather than hidden, in the shape lib/manual-lead-form.js uses: a
       person who clicked twice should see that the second click did nothing,
       not a second confirmation. */
    const already = r && (r.was_duplicate === true || r.already_acted === true);
    return { ok: true, retryable: false,
      message: already
        ? `Already done — this conversation was ${act.done.toLowerCase()} before, and this click added nothing.`
        : `${act.done}.` };
  } catch (e) {
    if (isMissingFunction(e)) {
      return { ok: false, retryable: true,
        message: 'This action is not installed on this dealership\'s database yet, so nothing happened and nothing '
          + 'was sent. Nothing on this row has changed.' };
    }
    if (isRefused(e)) {
      return { ok: false, retryable: true,
        message: 'This sign-in was refused this action, so nothing happened and nothing was sent. Ask whoever '
          + 'administers NEXUS for this dealership.' };
    }
    if (!e || str(e.nexusErrorCase) === 'offline' || e.status == null) {
      /* No response was produced. We cannot say whether it landed, and guessing
         in either direction is worse than saying so: guessing "failed" invites
         a second message to a real customer. */
      SETTLED.set(eventId, { action: kind, at: new Date().toISOString(), detail: null, unknown: true });
      return { ok: false, retryable: false,
        message: 'The request never came back, so NEXUS cannot tell whether it was carried out. This row is locked '
          + 'until you reload the screen — clicking again could do it twice, and one of these actions sends a '
          + 'message to a real person.' };
    }
    /* Refusals from these functions are written for a salesperson and carry the
       next step in their own text, so they are shown as they arrive rather than
       re-worded here. */
    return { ok: false, retryable: true, message: str(e && e.message) || 'The request failed.' };
  } finally {
    INFLIGHT.delete(key);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Rendering one held conversation
   ══════════════════════════════════════════════════════════════════════════ */

/* Who, as far as identity is known. Never the raw handle in the name position:
   every chat id measured on production is an `@lid`, and its digits are a
   machine id. "Not identified" is the honest answer and it is a common one. */
function whoLine(r) {
  const name = str(r.display_name);
  const phone = str(r.phone_e164);
  if (name && !isHandle(name)) {
    return bold(esc(name)) + (phone ? muted(`<span class="mono">${esc(phone)}</span>`) : '');
  }
  if (phone) return bold(`<span class="mono">${esc(phone)}</span>`) + muted('No name on file for this number.');
  return bold('<span class="t-warm">Not identified</span>')
    + muted('This conversation carries no name and no number NEXUS can read — only a machine handle, which names '
      + 'nobody. Open Conversations to see the thread itself.');
}

/* The evidence, shown as quotes, because the salesperson's whole job on this
   screen is to read what the customer actually wrote. A summary would be a
   second AI decision about a conversation we already declined to act on. */
function evidenceBlock(r) {
  let ev = r.evidence;
  if (typeof ev === 'string') { try { ev = JSON.parse(ev); } catch { ev = null; } }
  const quotes = Array.isArray(ev) ? ev.slice(0, 3) : [];

  if (r.evidence_verified === false) {
    return warm('NEXUS could not confirm, word for word, what it was reading. That on its own is why this '
      + 'conversation is here rather than on the floor, and it means nothing below should be treated as a quote.')
      + (quotes.length
          ? `<div style="margin-top:6px">${quotes.map(q =>
              `<div class="cell-sub" style="border-left:2px solid var(--border);padding-left:10px;margin:4px 0;white-space:normal">
                 ${esc(str(q && q.quote))}</div>`).join('')}
             <div class="cell-sub t-warm">Shown because it is what the machine claimed to be reading, not because it
               was found in the messages.</div></div>`
          : '');
  }
  if (!quotes.length) {
    return muted('NEXUS recorded no quote from this conversation.');
  }
  return `<div>${quotes.map(q =>
    `<blockquote style="margin:4px 0;border-left:2px solid var(--border);padding-left:10px;white-space:normal">
       ${esc(str(q && q.quote))}</blockquote>`).join('')}</div>`
    + muted(`${plural(quotes.length, 'This is the line', 'These are the lines')} NEXUS relied on, checked word for `
      + `word against the ${plural(quotes.length, 'message', 'messages')} it came from.`);
}

/* Model, tier and prompt version, on every row rather than behind an expander.
   A dealership asking "why did you not tell me about this customer" is answered
   from here, and the person asking it is looking at this screen when they ask.
   It is small, muted and last — a salesperson does not need it to decide — but
   it is text on the page, not a tooltip: a tooltip is invisible to browser
   find, unreachable on a touch screen and gone from a screenshot. */
function provenanceLine(r) {
  const bits = [];
  bits.push(str(r.model)
    ? `Read by <span class="mono">${esc(str(r.model))}</span>`
    : 'No model answered, so nothing read this conversation');
  if (n0(r.ladder_tier) != null) bits.push(`fallback tier ${esc(String(n0(r.ladder_tier)))}`);
  bits.push(str(r.prompt_version)
    ? `instructions <span class="mono">${esc(str(r.prompt_version))}</span>`
    : 'no instruction version recorded');
  if (r.last_classified_at) bits.push(`decided ${esc(dubaiStamp(r.last_classified_at))}`);
  if (n0(r.messages_read) != null) {
    bits.push(`${esc(String(n0(r.messages_read)))} ${plural(n0(r.messages_read), 'message', 'messages')} read`);
  }
  return muted(bits.join(' &middot; '));
}

function reasonCell(r) {
  const hr = holdReason(r.hold_reason);
  const raw = up(r.hold_reason);
  const head = hr
    ? pill(hr.label, hr.tone, { verbatim: false })
    : pill(raw || 'NO REASON RECORDED', 'unknown', { verbatim: true });
  const why = hr
    ? muted(esc(hr.blurb))
    : hot('This dashboard has no wording for that hold reason, so it is shown exactly as the database holds it and '
        + 'is not folded into one this screen does know. Nothing is being claimed about why this conversation is '
        + 'here.');

  const unclear = UNCLEAR_BECAUSE[up(r.unclear_because)];
  const unclearLine = str(r.unclear_because)
    ? muted(unclear
        ? esc(unclear)
        : `NEXUS recorded "${esc(str(r.unclear_because))}" as what it could not make out, and this dashboard has no `
          + 'wording for that.')
    : '';

  const verdict = VERDICT[up(r.verdict)];
  const conf = CONFIDENCE[up(r.confidence)];
  const machine = str(r.machine_reason);

  return head + why + unclearLine
    + `<div style="margin-top:8px">${conf
        ? pill(conf.label, conf.tone, { verbatim: false })
        : pill(up(r.confidence) || 'NO CONFIDENCE RECORDED', 'unknown', { verbatim: true })}</div>`
    + (verdict ? muted(esc(verdict)) : (str(r.verdict)
        ? muted(`NEXUS answered "${esc(str(r.verdict))}", which this dashboard has no wording for.`)
        : muted('NEXUS recorded no verdict for this conversation.')))
    + (machine
        ? `<div class="cell-sub" style="margin-top:8px;white-space:normal"><span class="t-2">In NEXUS's own words:</span>
             &ldquo;${esc(machine)}&rdquo;</div>`
          + muted('That sentence is the machine explaining itself to staff. It is not a fact about this customer and '
            + 'it never reaches them.')
        : muted('NEXUS recorded no explanation for this decision.'));
}

function timingCell(r, quarantineDays) {
  const clock = r.last_inbound_at || r.first_received_at;
  const lines = [];
  lines.push(bold(clock ? `Last heard from ${esc(ago(clock))}` : 'When they last wrote is not recorded'));
  if (r.last_inbound_at) lines.push(muted(esc(dubaiStamp(r.last_inbound_at))));
  lines.push(muted(r.first_received_at
    ? `First arrived ${esc(ago(r.first_received_at))}, ${esc(dubaiStamp(r.first_received_at))}.`
    : 'When this conversation first arrived is not recorded.'));
  if (n0(r.inbound_count) != null) {
    lines.push(muted(`${num(r.inbound_count)} ${plural(n0(r.inbound_count), 'message', 'messages')} from them so far.`));
  }
  if (str(r.language)) {
    lines.push(muted(`Written in <span class="chip">${esc(str(r.language))}</span> as NEXUS read it. This decides `
      + 'nothing; it is here because it is how a manager finds out the line needs somebody who speaks it.'));
  }

  /* The countdown is rendered ONLY when the database states the window. The
     thirty-day sweep of DESIGN.md §4.6 is a recommendation and no sweep is
     running; printing "18 days left" against a timer nobody has started would
     be this screen inventing a deadline. When the window is stated, it is
     stated as silence — a conversation somebody is having is never swept. */
  if (n0(quarantineDays) != null && clock) {
    const silentDays = Math.floor((Date.now() - new Date(clock).getTime()) / 86400000);
    const left = n0(quarantineDays) - silentDays;
    lines.push(left > 0
      ? warm(`${num(left)} more ${plural(left, 'day', 'days')} of silence before this moves to the archive. It is not `
          + 'deleted there and it can still be promoted.')
      : warm('This has been silent longer than the window, so it is due to move to the archive. It is not deleted '
          + 'there and it can still be promoted.'));
  }
  return lines.join('');
}

function excerptBlock(r) {
  const t = str(r.last_inbound_excerpt);
  if (!t) {
    return muted('The last thing this customer wrote was not recorded here. Open Conversations to read the thread.');
  }
  return `<div style="white-space:normal;font-size:14px;line-height:20px">&ldquo;${esc(t)}&rdquo;</div>`
    + muted('The last message from them, as they wrote it. Not a summary.');
}

/* ══════════════════════════════════════════════════════════════════════════
   One row
   ══════════════════════════════════════════════════════════════════════════
   A grid rather than a table, and the reason is the sales floor. This screen is
   read on a phone in a showroom: a nine-column table at 360px is a horizontal
   scroll with the decision buttons off the right-hand edge. `auto-fit` with a
   minimum column width collapses to a single column on a narrow screen without
   any media query, which matters because this module may not add CSS.

   The three controls are full-size buttons (36px, the app's default) rather
   than `.btn.sm`, they are real <button> elements so they are tab-reachable and
   fire on Enter and Space, and every one of them carries its own accessible
   name including who it is about — "Promote" repeated eleven times down a
   screen reader is not a list of choices. */
function rowHtml(r, opts) {
  const id = str(r.event_id);
  const settled = SETTLED.get(id);
  const archived = !!opts.archived;

  const actions = archived
    ? [ACTS.PROMOTE]
    : [ACTS.PROMOTE, ACTS.REQUEST_CONTEXT, ACTS.DISMISS];

  const who = str(r.display_name) && !isHandle(str(r.display_name))
    ? str(r.display_name)
    : (str(r.phone_e164) || 'an unidentified conversation');

  const buttons = actions.map(a => {
    const kind = Object.keys(ACTS).find(k => ACTS[k] === a);
    const cls = kind === 'PROMOTE' ? 'btn primary' : 'btn';
    return `<button class="${cls}" data-act="${esc(kind)}" data-id="${esc(id)}"
      aria-label="${esc(`${a.label} — ${who}`)}"${settled ? ' disabled' : ''}>${esc(a.label)}</button>`;
  }).join('');

  const settledLine = settled
    ? (settled.unknown
        ? hot('This row is locked because NEXUS could not confirm whether the last action was carried out. Reload the '
            + 'screen and read the row before doing anything else.')
        : `<div class="cell-sub t-ok">${esc(ACTS[settled.action].done)} ${esc(ago(settled.at))} &middot; this session. `
          + 'Reload the screen to see where it went.</div>')
    : '';

  return `<article style="border:1px solid var(--border);border-radius:var(--radius-card);padding:14px 16px;margin-bottom:12px"
      data-row="${esc(id)}">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">
      <div>${whoLine(r)}
        <div style="margin-top:10px">${excerptBlock(r)}</div>
      </div>
      <div>${reasonCell(r)}</div>
      <div>${timingCell(r, opts.quarantineDays)}
        <div style="margin-top:10px">${evidenceBlock(r)}</div>
      </div>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">${buttons}</div>
    <div data-msg="${esc(id)}" role="status" aria-live="polite" style="margin-top:8px">${settledLine}</div>
    <div style="margin-top:10px;border-top:1px solid var(--border-subtle);padding-top:8px">${provenanceLine(r)}</div>
    ${archived ? muted(`In the archive${str(r.disposition_reason)
        ? `, recorded as ${esc(str(r.disposition_reason))}` : ''}. Nothing here has been deleted, and promoting from `
        + 'the archive works exactly as it does from the queue — a dismissal is a person saying "not now", and '
        + 'people are wrong too.') : ''}
  </article>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   The dialogs
   ══════════════════════════════════════════════════════════════════════════ */
function dismissDialog(r, onDone) {
  const who = str(r.display_name) && !isHandle(str(r.display_name)) ? str(r.display_name) : str(r.phone_e164);
  const m = openModal('Dismiss this conversation', `
    <p class="cell-sub" style="white-space:normal">Dismissing moves this to the archive. Nothing is deleted: the
      messages, the arrival and every decision NEXUS made about it stay exactly where they are, and it can still be
      promoted from the archive later.</p>
    ${who ? `<p class="cell-sub">This conversation: <strong>${esc(who)}</strong></p>` : ''}
    <label class="cell-sub" for="deReason" style="display:block;margin-top:12px">Why are you dismissing it</label>
    <select id="deReason">${DISMISS_REASONS.map(([k, label]) =>
      `<option value="${esc(k)}">${esc(label)}</option>`).join('')}</select>
    <p class="cell-sub" style="margin-top:10px;white-space:normal">This reason is counted. It is how the dealership
      finds out whether NEXUS is holding the right conversations.</p>`,
    `<button class="btn primary" id="deGo">Dismiss</button>
     <button class="btn" id="deCancel">Cancel</button>`);
  m.wrap.querySelector('#deCancel').addEventListener('click', m.close);
  m.wrap.querySelector('#deGo').addEventListener('click', async () => {
    const go2 = m.wrap.querySelector('#deGo');
    go2.disabled = true;
    m.msg('Dismissing…');
    const res = await runAct('DISMISS', str(r.event_id), m.wrap.querySelector('#deReason').value);
    m.msg(`<span class="${res.ok ? 't-ok' : 't-hot'}">${esc(res.message)}</span>`);
    if (res.ok) { setTimeout(() => { m.close(); onDone(res); }, 700); return; }
    if (res.retryable) go2.disabled = false; else onDone(res);
  });
}

function contextDialog(r, onDone) {
  const who = str(r.display_name) && !isHandle(str(r.display_name)) ? str(r.display_name) : str(r.phone_e164);
  const m = openModal('Ask what they are looking for', `
    <p style="white-space:normal">This sends a real message to a real person. Read this before you send it.</p>
    <ul class="cell-sub" style="white-space:normal;padding-left:18px;line-height:20px">
      <li>The message is a short, fixed one written by a person, not by the AI. Nothing the classifier said about
        this conversation goes into it.</li>
      <li>It goes out through the same rules as every other message this dealership sends, so the opt-out and
        template rules apply to it unchanged.</li>
      <li>It can be sent <strong>once</strong> for a conversation. NEXUS will not chase.</li>
      <li>This screen cannot show you the exact wording, because it does not hold the message register. It will not
        guess at it either — a preview of what a customer is about to receive has to be the real text or nothing.</li>
    </ul>
    ${who ? `<p class="cell-sub" style="margin-top:10px">Sending to: <strong>${esc(who)}</strong></p>` : ''}`,
    `<button class="btn primary" id="ctxGo">Send it</button>
     <button class="btn" id="ctxCancel">Cancel</button>`);
  m.wrap.querySelector('#ctxCancel').addEventListener('click', m.close);
  m.wrap.querySelector('#ctxGo').addEventListener('click', async () => {
    const go2 = m.wrap.querySelector('#ctxGo');
    go2.disabled = true;
    m.msg('Sending…');
    const res = await runAct('REQUEST_CONTEXT', str(r.event_id), null);
    m.msg(`<span class="${res.ok ? 't-ok' : 't-hot'}">${esc(res.message)}</span>`);
    if (res.ok) { setTimeout(() => { m.close(); onDone(res); }, 900); return; }
    if (res.retryable) go2.disabled = false; else onDone(res);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   The queue panel — tabs, filters, rows
   ══════════════════════════════════════════════════════════════════════════ */
const F = { tab: 'QUEUE', reason: 'ALL', sort: 'SILENT_FIRST' };
MEMOS.add(() => { F.tab = 'QUEUE'; F.reason = 'ALL'; F.sort = 'SILENT_FIRST'; });

const clockOf = r => Date.parse(r.last_inbound_at || r.first_received_at || '') || 0;

/* The body is built by a function of its own, and the wiring by another, so a
   click on a tab, a filter chip or the sort control REDRAWS THE PANEL FROM THE
   ROWS ALREADY IN HAND rather than re-issuing the reads. That is not a
   performance nicety: re-reading on every filter click means two clicks two
   seconds apart can show two different queues, and a salesperson filtering to
   "Potential enquiry" would have no way to tell a row that was filtered out
   from one that somebody else promoted in between. The reads happen once per
   visit; only an ACT reloads the screen, and then it reloads all of it.

   lib/ui.js panel() replays the handlers registered on its returned thenable
   after a retry, so wireQueue runs again on the rebuilt card exactly as it ran
   the first time. */
function queueBody(data, card) {
  const { q, a, h } = data;
  const H = h.err ? null : ((h.v.rows || [])[0] || null);
  const quarantineDays = H ? n0(H.quarantine_after_days_silent) : null;

  const src = F.tab === 'ARCHIVE' ? a : q;
  const label = F.tab === 'ARCHIVE' ? 'The archive' : 'The held queue';
  const name = F.tab === 'ARCHIVE' ? 'v_enquiry_held_all' : 'v_enquiry_held';

  /* min-height on the tab and filter buttons because .seg button is 26px tall
     and this screen is read one-handed on a phone in a showroom. Nothing here
     may add CSS, so the target size is set where the button is written. */
  const segBtn = 'style="min-height:36px"';
  const tabs = `<div class="seg" role="group" aria-label="Which conversations to show">
    <button data-tab="QUEUE" ${segBtn} class="${F.tab === 'QUEUE' ? 'on' : ''}" aria-pressed="${F.tab === 'QUEUE'}"
      >Waiting for a decision</button>
    <button data-tab="ARCHIVE" ${segBtn} class="${F.tab === 'ARCHIVE' ? 'on' : ''}" aria-pressed="${F.tab === 'ARCHIVE'}"
      >Archive</button></div>`;

  if (src.err) {
    card.__shown = [];
    return `<div class="toolbar">${tabs}</div>
      <div class="state err"><span class="material-symbols-outlined">error</span>
        <h3>Couldn&#39;t load ${esc(F.tab === 'ARCHIVE' ? 'the archive' : 'the held queue')}</h3>
        <p>${whyUnavailable(src.err, label, name)}</p>
        <p>Nothing here is a zero. No conversation is being shown as handled, and none is being shown as absent.</p>
      </div>`;
  }

  const rows = src.v.rows;
  const readAt = src.v.readAt;

  /* Counts of what is ON THIS SCREEN, and the caption below says so. They are
     the one thing on this screen derived in the browser, and they are derived
     from the rows in front of the reader rather than from anything the database
     was not asked. */
  const counts = new Map();
  rows.forEach(r => {
    const k = up(r.hold_reason) || 'NO_REASON_RECORDED';
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  const known = Object.keys(HOLD_REASON).filter(k => counts.has(k));
  const novel = [...counts.keys()].filter(k => !HOLD_REASON[k]).sort();
  const chips = [['ALL', rows.length], ...[...known, ...novel].map(k => [k, counts.get(k)])];
  const chipLabel = k => (k === 'ALL' ? 'All' : (HOLD_REASON[k] ? HOLD_REASON[k].label : k));

  const filters = `<div class="seg" id="heSeg" role="group" aria-label="Filter by why it is held">
    ${chips.map(([k, c]) => `<button data-reason="${esc(k)}" ${segBtn} class="${F.reason === k ? 'on' : ''}"
      aria-pressed="${F.reason === k}">${esc(chipLabel(k))} &middot; ${num(c)}</button>`).join('')}</div>`;

  const sorter = `<label class="cell-sub" for="heSort" style="display:flex;align-items:center;gap:8px">Order
    <select id="heSort" style="width:auto;min-width:190px">
      <option value="SILENT_FIRST"${F.sort === 'SILENT_FIRST' ? ' selected' : ''}>Longest silent first</option>
      <option value="RECENT_FIRST"${F.sort === 'RECENT_FIRST' ? ' selected' : ''}>Most recent first</option>
    </select></label>`;

  const toolbar = `<div class="toolbar">${tabs}<div style="flex:1"></div>${sorter}</div>
    <div class="toolbar">${filters}</div>`;

  const shown = (F.reason === 'ALL'
    ? rows.slice()
    : rows.filter(r => (up(r.hold_reason) || 'NO_REASON_RECORDED') === F.reason))
    .sort((x, y) => (F.sort === 'RECENT_FIRST' ? clockOf(y) - clockOf(x) : clockOf(x) - clockOf(y)));

  /* Held on the card so the action handlers can find the row they are about
     without re-deriving it from the DOM. */
  card.__shown = shown;

  /* Three outcomes, not two. An empty queue is a real and good finding and it
     is printed with its denominator beside it — never as a bare zero, which
     reads as a performance figure and is not one. Where the denominator could
     not be read, the zero is not offered as a finding at all. */
  let body;
  if (!rows.length) {
    /* The denominator, or an honest statement that there is not one. A count of
       zero with nothing beside it reads as a performance figure; the same zero
       beside "NEXUS recorded 46 conversations in the last 30 days" is a
       finding, and the two must not look alike. */
    const recorded = n0(H && H.conversations_recorded);
    const win = n0(H && H.window_days);
    const denom = recorded == null || win == null
      ? 'How many conversations NEXUS recorded and classified in this window could not be read, so this is not '
        + 'evidence that everything arrived and was handled. It means nothing is waiting here, and nothing more '
        + 'than that.'
      : `Over the last ${win} ${plural(win, 'day', 'days')} NEXUS recorded ${recorded} `
        + `${plural(recorded, 'conversation', 'conversations')} and held ${num(H.held_total)} of them for review.`;
    body = stateEmpty(
      F.tab === 'ARCHIVE' ? 'Nothing has been archived' : 'No conversation is currently held for review',
      F.tab === 'ARCHIVE'
        ? 'No held conversation has been dismissed or has run out of time. Nothing has been lost here, and nothing '
          + 'is hidden from the queue on the other tab. ' + denom
        : denom);
  } else if (!shown.length) {
    body = stateEmpty('Nothing under that reason',
      `${rows.length} ${plural(rows.length, 'conversation is', 'conversations are')} here under other reasons. `
      + 'This filter is hiding them; nothing has gone away.', 'filter_alt');
  } else {
    body = `<div style="padding:16px 20px">${shown.map(r =>
      rowHtml(r, { archived: F.tab === 'ARCHIVE', quarantineDays })).join('')}</div>`;
  }

  const notes = [];
  notes.push(`Read ${esc(dubaiStamp(readAt))}. This screen does not refresh on its own — a conversation that arrived `
    + 'since then is not on it.');
  notes.push('The counts on the buttons above are of the conversations loaded here, not of everything this '
    + 'dealership has ever held.');
  if (rows.length >= HELD_LIMIT) {
    notes.push(`<span class="t-warm">The ${num(HELD_LIMIT)} longest-silent conversations were read and the cap was `
      + 'reached, so every count above is a floor rather than a total, and "most recent first" reorders that same '
      + 'set rather than widening it.</span>');
  }
  if (novel.length) {
    notes.push(`<span class="t-hot">${num(novel.length)} of the reasons above (${esc(novel.join(', '))}) `
      + `${plural(novel.length, 'is one', 'are ones')} this dashboard has no wording for. `
      + `${plural(novel.length, 'It is', 'They are')} shown exactly as the database holds `
      + `${plural(novel.length, 'it', 'them')} rather than folded into a reason this screen does know.</span>`);
  }
  notes.push(esc(CONFIDENCE_IS_A_BAND));
  if (F.tab === 'ARCHIVE') {
    notes.push('Archived conversations can still be promoted. Nothing on this tab has been deleted.');
  }

  return toolbar + body
    + `<div class="section" style="padding:0 20px 16px">${notes.map(t => muted(t)).join('')}</div>`;
}

function wireQueue(card, host, gen) {
  wireGo(card);

  const pbody = card.querySelector('.pbody');
  const draw = () => {
    if (!pbody || !card.__data) return;
    pbody.innerHTML = queueBody(card.__data, card);
    wireQueue(card, host, gen);
  };
  /* A full re-mount, and only after an act. The row a salesperson needs to see
     next is the one the DATABASE made — with its lead id and its new phase —
     not a client-side guess at what it probably looks like now. Same reasoning
     and same shape as screens/leads.js after a manual lead is saved.

     GUARDED BY THE RENDER GENERATION, because it runs on a timer. `#screen` is
     one element that lib/nav.js empties and refills for every screen, so a
     re-mount that fires after the reader has navigated elsewhere would wipe the
     screen they are actually looking at and replace it with this one. That is
     the defect lib/nav.js's own staleRender() exists to prevent, and a delayed
     callback is exactly the case it was written for. */
  const remount = () => {
    if (staleRender(gen)) return;
    host.innerHTML = '';
    SCREENS.heldenquiries(host);
  };

  card.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    F.tab = b.dataset.tab; F.reason = 'ALL'; draw();
  }));
  card.querySelectorAll('#heSeg button').forEach(b => b.addEventListener('click', () => {
    F.reason = b.dataset.reason; draw();
  }));
  card.querySelector('#heSort')?.addEventListener('change', e => { F.sort = e.target.value; draw(); });

  card.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', async () => {
    const id = str(b.dataset.id);
    const kind = b.dataset.act;
    /* Found by walking up from the button that was clicked rather than by
       building a selector out of a value that came from the database. */
    const row = b.closest('[data-row]');
    const msg = row ? row.querySelector('[data-msg]') : null;
    const rec = (card.__shown || []).find(r => str(r.event_id) === id) || { event_id: id };
    const setBusy = on => row?.querySelectorAll('button[data-act]').forEach(x => { x.disabled = on; });
    const report = res => {
      if (msg) msg.innerHTML = `<span class="${res.ok ? 't-ok' : 't-hot'}">${esc(res.message)}</span>`;
      /* Only a REFUSAL re-opens the buttons. A success closes the question, and
         an unknown outcome must not be clickable again — one of these actions
         sends a message to a real person. */
      setBusy(res.ok || !res.retryable);
      if (res.ok) {
        /* Long enough to read the confirmation, then the screen is rebuilt from
           the database rather than from this session's guess. */
        setTimeout(remount, 1600);
      }
    };

    if (kind === 'DISMISS') { dismissDialog(rec, report); return; }
    if (kind === 'REQUEST_CONTEXT') { contextDialog(rec, report); return; }

    setBusy(true);
    if (msg) msg.innerHTML = '<span class="cell-sub">Promoting&hellip;</span>';
    report(await runAct('PROMOTE', id, null));
  }));
}

function queuePanel(host, gen) {
  panel(host, {
    title: 'Conversations waiting for a decision',
    sub: 'Every conversation NEXUS recorded and did not turn into a lead. Longest silent first, because that is the '
       + 'one closest to being lost',
    actions: linkBtn('conversations', 'Open Conversations') + ' ' + linkBtn('leads', 'Open Leads'),
    load: async () => {
      const [q, a, h] = await Promise.all([settle(readHeld()), settle(readArchive()), settle(readHealth())]);
      /* Deliberately does NOT throw when a read fails. The failure IS the
         finding here, and it is rendered by this panel in its own words —
         handing it to the standard "couldn't load, try again" card would tell a
         salesperson to retry against a view that is not installed. */
      return { q, a, h };
    },
    render: (data, card) => {
      card.__data = data;
      return queueBody(data, card);
    },
  }).then(card => wireQueue(card, host, gen));
}

/* ══════════════════════════════════════════════════════════════════════════
   The screen
   ══════════════════════════════════════════════════════════════════════════ */
SCREENS.heldenquiries = async host => {
  /* Every visit re-reads. A stale held queue is worse than a slow one: it is a
     screen showing a conversation as waiting that somebody else already
     promoted, or hiding one that arrived this morning. */
  resetReads();

  /* The render this mount belongs to. The queue panel re-mounts itself on a
     timer after an act, and `#screen` is shared by every screen in the app, so
     that timer must know whether it is still the render on screen. */
  const gen = currentGeneration();

  /* ────────────────────────────────────────────────────────────────────────
     P1 · What the classifier has done, and how much of that anyone has checked
     ──────────────────────────────────────────────────────────────────────── */
  panel(host, {
    title: 'What NEXUS did with the conversations that arrived',
    sub: 'Every figure here is over one stated window and carries its own denominator. None of them is money, and '
       + 'nothing on this screen estimates what a held conversation was worth',
    load: async () => {
      const [h, q] = await Promise.all([settle(readHealth()), settle(readHeld())]);
      return { h, q };
    },
    render: ({ h, q }) => {
      if (h.err) {
        return `<div class="state err"><span class="material-symbols-outlined">error</span>
          <h3>Couldn't load the classifier's own figures</h3>
          <p>${whyUnavailable(h.err, 'The classifier health summary', 'v_enquiry_classification_health')}</p>
          <p>So there is no false-negative rate on this screen, no coverage figure, and no count of conversations
             recorded. The queue below may still load; it is the list, not the measurement.</p></div>`;
      }
      const H = (h.v.rows || [])[0] || null;
      if (!H) {
        return `<div class="state"><span class="material-symbols-outlined">query_stats</span>
          <h3>Not yet measurable</h3>
          <p>The classifier health summary exists and returned no row for this dealership. That is an absent
             measurement, not a set of zeroes: nothing has been classified here yet, or nothing has been summarised
             yet, and this screen cannot tell those two apart. No rate is being reported and none is being implied.</p>
          </div>`;
      }

      const win = n0(H.window_days);
      const winWords = win == null ? 'the window this summary covers' : `the last ${num(win)} days`;

      const recorded = kpi('Conversations recorded', num(H.conversations_recorded),
        muted(`Every genuine arrival over ${esc(winWords)}, whether or not NEXUS made a lead out of it. `
          + 'This is the denominator for everything else on this row.'));

      const promoted = kpi('Turned into leads automatically', num(H.promoted_automatically),
        muted(n0(H.promoted_marked_not_a_customer) == null
          ? 'How many of these a person later marked as not a customer is not recorded, so the accuracy of this '
            + 'figure is unknown rather than good.'
          : `${num(H.promoted_marked_not_a_customer)} of them ${plural(n0(H.promoted_marked_not_a_customer), 'was', 'were')} `
            + 'later marked by a person as not a customer. A promoted lead nobody marked either way is counted as '
            + 'neither right nor wrong.'));

      /* The held tile never renders as an all-clear. A held conversation is a
         customer nobody at this dealership has seen. */
      const heldTotal = n0(H.held_total);
      const held = kpi('Held for review', num(H.held_total),
        muted(n0(H.held_reviewed) == null
          ? 'How many of these a person has actually opened is not recorded, so no share of them can be called '
            + 'reviewed.'
          : `${num(H.held_reviewed)} of them ${plural(n0(H.held_reviewed), 'has', 'have')} been looked at by a `
            + `person${n0(H.coverage_pct) == null ? '' : ` (${esc(String(n0(H.coverage_pct)))}% coverage)`}. `
            + 'A held conversation nobody opened is an unknown, not a correct rejection.'),
        heldTotal ? 't-warm' : '');

      /* THE NUMBER THAT MATTERS, in DESIGN.md's own words: everything else is
         recoverable. It is rendered hot whenever it is anything but zero, and a
         zero here is only printed as a finding because it has a denominator
         beside it. */
      const lost = n0(H.quarantined_never_reviewed);
      const lostTile = kpi('Archived without anybody looking', num(H.quarantined_never_reviewed),
        muted(lost
          ? 'These are conversations NEXUS declined and no person at this dealership ever opened. Everything else on '
            + 'this screen is recoverable; this is the count that is not.'
          : lost === 0
            ? `No conversation went to the archive unread over ${esc(winWords)}. That is a real finding and it is `
              + 'the only zero on this screen worth reading as good news.'
            : 'Not recorded, so it cannot be said that none were.'),
        lost ? 't-hot' : (lost === 0 ? 't-ok' : ''));

      /* The false-negative rate, reported ONLY if the view says it is quotable.
         §3.4: below roughly 60% coverage it is not reported as a rate at all —
         it is reported as "N promoted, of M reviewed, of H held", and the rest
         is said to be unknown. This screen renders the view's answer and
         computes no rate of its own. */
      const quotable = H.fn_rate_is_quotable === true && n0(H.fn_rate_pct_of_reviewed) != null;
      const fn = quotable
        ? `<div class="banner warm" style="margin-top:16px">
             <span class="material-symbols-outlined" style="font-size:20px">rule</span>
             <div>${bold(`${esc(String(n0(H.fn_rate_pct_of_reviewed)))}% of the held conversations a person reviewed `
               + 'were promoted after all.')}
               ${muted('That percentage is how often NEXUS declined a real customer, measured on the ones somebody '
                 + 'actually opened. It is the only measurement of that this product has, and every promote from the '
                 + 'queue below moves it.')}</div></div>`
        : `<div class="banner warm" style="margin-top:16px">
             <span class="material-symbols-outlined" style="font-size:20px">rule</span>
             <div>${bold('How often NEXUS declined a real customer is not yet quotable as a rate.')}
               ${muted(`${num(H.promoted_from_held)} held ${plural(n0(H.promoted_from_held), 'conversation was', 'conversations were')} `
                 + `promoted by a person, out of ${num(H.held_reviewed)} reviewed, out of ${num(H.held_total)} held. `
                 + 'Too few of the held ones have been opened for that to be turned into a percentage, and a '
                 + 'percentage of a set nobody looked at would score the classifier for being ignored.')}</div></div>`;

      const found = n0(H.found_by_another_route_while_held);
      const foundLine = found == null
        ? muted('Whether any of these customers reached this dealership another way while NEXUS was holding them is '
            + 'not recorded.')
        : found
          ? hot(`${num(found)} ${plural(found, 'customer', 'customers')} reached this dealership another way — a `
              + 'walk-in, a call, another channel — while NEXUS was holding their message. Each one is a customer '
              + 'this product declined and the dealership got in spite of it.')
          : muted(`No customer reached this dealership another way while NEXUS was holding their message, over `
              + `${esc(winWords)}.`);

      const age = H.computed_at
        ? `These figures were worked out ${esc(ago(H.computed_at))}, ${esc(dubaiStamp(H.computed_at))}.`
        : 'When these figures were worked out is not recorded, so how old they are cannot be said.';

      /* Printed verbatim from the view. §4.7: one derivation, not a paraphrase
         in this file that drifts the first time the view is edited. */
      const caveat = str(H.caveat)
        ? `<div class="banner info" style="margin-top:12px">
             <span class="material-symbols-outlined" style="font-size:20px">info</span>
             <div>${bold('What these figures cannot tell you.')}
               <div class="cell-sub" style="white-space:normal">${esc(str(H.caveat))}</div></div></div>`
        : `<div class="banner hot" style="margin-top:12px">
             <span class="material-symbols-outlined" style="font-size:20px">warning</span>
             <div>${bold('The limits of these figures are not stated.')}
               ${muted('This summary is supposed to carry its own account of what it cannot tell this dealership, '
                 + 'and it came back without one. Read every figure above as narrower than it looks.')}</div></div>`;

      const queueNote = q.err
        ? hot('The queue itself could not be read, so the figures above describe a list this screen is not showing.')
        : muted(`${num(q.v.rows.length)} ${plural(q.v.rows.length, 'conversation is', 'conversations are')} loaded `
            + `into the queue below, read ${esc(dubaiStamp(q.v.readAt))}.`);

      return `<div class="grid g4">${recorded}${promoted}${held}${lostTile}</div>`
        + fn + caveat
        + `<div class="section" style="margin-top:16px">${foundLine}${muted(age)}${queueNote}
             ${muted('No figure on this screen is money. Nothing in this database records what an enquiry was worth, '
               + 'so there is no honest way to price a conversation NEXUS held, and a number here would be invented '
               + 'rather than measured.')}</div>`;
    },
  }).then(wireGo);

  /* ────────────────────────────────────────────────────────────────────────
     P2 · The queue itself
     ──────────────────────────────────────────────────────────────────────── */
  queuePanel(host, gen);

  /* ────────────────────────────────────────────────────────────────────────
     P3 · What this screen cannot tell you
     ────────────────────────────────────────────────────────────────────────
     Rendered on every visit whatever the data says, in the shape
     screens/lead-sources.js uses. The permanent rows are the largest things a
     reader would assume a screen like this covers; an absent line would read as
     a capability. */
  panel(host, {
    title: 'What this screen cannot tell you',
    sub: 'Everything above rests on these, and none of them is visible in the figures themselves',
    load: async () => {
      const [q, a, h] = await Promise.all([settle(readHeld()), settle(readArchive()), settle(readHealth())]);
      return { q, a, h };
    },
    render: ({ q, a, h }) => {
      const rows = [];

      if (q.err) {
        rows.push({ what: 'Anything at all about which conversations are waiting',
          detail: whyUnavailable(q.err, 'The held queue', 'v_enquiry_held'),
          why: 'The list is the whole screen. Nothing above is a zero; it is an unknown, and no conversation is '
             + 'being reported as handled.',
          kind: isMissingRelation(q.err) ? 'NOT INSTALLED' : 'UNREAD' });
      } else if (q.v.rows.length >= HELD_LIMIT) {
        rows.push({ what: 'How many conversations are held in total',
          detail: `The ${num(HELD_LIMIT)} longest-silent were read and the cap was reached`,
          why: 'Every count on the queue panel is over that window. They are floors, not totals.',
          kind: 'WINDOW' });
      }

      if (a.err) {
        rows.push({ what: 'What has already been archived, and whether any of it should come back',
          detail: whyUnavailable(a.err, 'The archive', 'v_enquiry_held_all'),
          why: 'A dismissal is a person saying "not now". Without the archive there is no way to change that answer, '
             + 'and a conversation somebody dismissed by mistake stays dismissed.',
          kind: isMissingRelation(a.err) ? 'NOT INSTALLED' : 'UNREAD' });
      }

      if (h.err || !((h.v && h.v.rows) || [])[0]) {
        rows.push({ what: 'How often NEXUS declines a real customer, and how much of that anybody has checked',
          detail: h.err
            ? whyUnavailable(h.err, 'The classifier health summary', 'v_enquiry_classification_health')
            : 'The summary returned no row for this dealership',
          why: 'The promote button on the queue above is the measurement of that rate. Without the summary those '
             + 'clicks are still recorded and nothing is reporting them back, so the classifier can be wrong at any '
             + 'rate at all and this screen would look identical.',
          kind: h.err && isMissingRelation(h.err) ? 'NOT INSTALLED' : 'UNREAD' });
      } else {
        const H = h.v.rows[0];
        if (n0(H.quarantine_after_days_silent) == null) {
          rows.push({ what: 'How long a held conversation has before it moves to the archive',
            detail: 'No window is stated by the database',
            why: 'So no countdown is shown on any row. A deadline printed against a timer nobody has started would '
               + 'be this screen inventing one, and a salesperson would work the queue in the wrong order because '
               + 'of it.',
            kind: 'DATA' });
        }
        if (H.fn_rate_is_quotable !== true) {
          rows.push({ what: 'The false-negative rate as a percentage',
            detail: 'Too few held conversations have been opened by a person for a rate to mean anything',
            why: 'A percentage over a set nobody reviewed scores the classifier for being ignored. The counts are '
               + 'printed instead, with all three denominators.',
            kind: 'DATA' });
        }
      }

      /* Permanent. All three are true on every render and on every day, and an
         absent line would read as a capability. */
      rows.push({ what: 'Whether every message a customer sent actually reached NEXUS',
        detail: 'Not knowable from this screen, on any day',
        why: 'This queue can only hold conversations that were recorded. A message that never reached NEXUS is not '
           + 'held, not archived and not counted here — it is absent, and absence looks exactly like a quiet week '
           + 'from inside this screen.',
        kind: 'ROADMAP' });

      rows.push({ what: 'What any of these conversations was worth',
        detail: 'Never measured, on any day',
        why: 'No enquiry in this database carries a value and nothing links one to a vehicle at a price. A figure '
           + 'here would be invented, and the fact that it would be a sad one does not make it measured.',
        kind: 'ROADMAP' });

      rows.push({ what: 'Whether the machine read the conversation the way a person would',
        detail: 'Only the quotes it could verify are shown',
        why: 'What NEXUS wrote about a conversation is a claim, shown beside the line it rests on so a person can '
           + 'check it. It is never a fact about the customer, and no vehicle or price on this screen comes from '
           + 'anything the machine concluded.',
        kind: 'ROADMAP' });

      return `<div style="padding:16px 20px">${rows.map(r => `
        <div style="border-top:1px solid var(--border-subtle);padding:12px 0">
          <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
            ${pill(r.kind, r.kind === 'NOT INSTALLED' || r.kind === 'UNREAD' ? 'hot' : 'unknown', { verbatim: true })}
            <div style="font-weight:600;white-space:normal">${esc(r.what)}</div></div>
          <div class="cell-sub" style="white-space:normal;margin-top:4px">${r.detail}</div>
          <div class="cell-sub" style="white-space:normal;margin-top:4px">${esc(r.why)}</div>
        </div>`).join('')}</div>`;
    },
  }).then(wireGo);
};
