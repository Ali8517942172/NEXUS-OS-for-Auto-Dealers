/* NEXUS OS — lib/lead-drawer.js
   Split out of the original monolithic app.js on 17 Aug 2026. The body was the
   original code, moved not rewritten, until 1 Sep 2026, when three things in it
   stopped being true.

   1. IDENTITY. All three reads keyed on `lead_email=eq.<the lead's email>`.
      `communication_logs.lead_email` is not one key space: it holds a real email,
      a `@c.us` chat id, a `@lid` handle and a synthetic `+digits@whatsapp.lead`
      key, and one person is filed under several at once. Live on 1 Sep 2026 lead
      38's 29 message rows are split 15 / 12 / 2 across three of those shapes, and
      lead 35's email column holds an EMPTY STRING while all ten of his messages
      are under `111948809162873@lid`. So for lead 35 this drawer issued
      `lead_email=eq.` (empty), got a successful read of zero rows, and printed
      "Nothing has been logged against this email address yet" — on the screen a
      rep reads immediately before phoning the customer. The `allSettled` work
      below made a FAILED read honest; a successful read against the wrong key
      produced the same false sentence and had no banner at all.

      Matching now goes through `lib/identity.js`, which applies the same
      last-nine-digit rule the n8n `Resolve Lead Identity` node used when it wrote
      those keys. screens/leads.js expands the same way against rows it has
      already read. One rule, two access modes; neither file matches by hand.

   2. THE SUPERSEDED DRAWER. `openDrawer` replaces `#drawer`'s whole innerHTML,
      and this function looked `#dVip` and `#dTimeline` up by global id AFTER its
      awaits. Two clicks inside one round-trip therefore left A's reads painting
      into B's drawer: B's name, phone, status and score above A's purchase
      history and A's entire timeline, with nothing on screen saying so. The
      nodes are captured before the first await now, so a superseded load writes
      into a detached element and is simply invisible — the shape
      screens/conversations.js:1214 already uses for the same reason.

   3. RESPONSE TIME. The copy below said a null meant nobody measured. Until
      31 Aug it never rendered at all: a BEFORE INSERT trigger on `leads`
      measured a reply that predated the lead row and `greatest(0, …)` wrote 0,
      so every lead read "0 min · within SLA". That trigger is deleted. The sole
      writer is now `trg_comm_logs_first_response`, AFTER INSERT on
      `communication_logs`.

      Read out of `nexus_mark_first_response` on 1 Sep 2026, because "no clamp"
      is near enough to be misleading. It stamps `round(seconds / 60)` for the
      first OUTBOUND whatsapp / email / sms message it can resolve to the lead
      (`nexus_is_reply` excludes `[system]` and `[SILENCE-` rows); it writes once
      and only while the column is still null; and a reply older than the lead row
      is admitted as 0 only when it is less than 90 seconds older AND no inbound
      message was already on file. That is a clock-skew allowance between n8n
      (Asia/Dubai) and Postgres, not a floor placed under a real wait.

      So a null is NOT the sentence "nobody has answered this customer" — an
      earlier draft of this file said exactly that and the live data contradicts
      it. Lead 35 is the counter-example: its one outbound message was logged at
      06:40:38 on 26 Aug and its lead row was minted 74 seconds later at 06:41:52
      with eight inbound messages already on file, so the trigger correctly
      declined to call that a response time. What a null rules out is a MEASURED
      wait. It never means fast.

   4. THE TIMELINE DREW INTERNAL ROWS AS MESSAGES (added 1 Sep 2026). Every row
      the message read returned went into the timeline as an event coloured by
      `tone(c.direction)` and chipped with `c.channel`. A silence marker carries
      direction 'outbound', so the newest thing a rep saw before phoning a
      customer was a green outbound event reading "[SILENCE-ESCALATED] Silent for
      12h since …" — the dealership's own note that nobody was in touch, drawn in
      the same shape and colour as the messages we actually sent. It is the same
      defect screens/customers.js had in its last-contact figure and
      screens/conversations.js had in its chat bubbles, arriving in the third
      place none of the three shared a definition.

      They share one now: `lib/comm-events.js`, which mirrors
      `public.nexus_is_message()` — the database function `nexus_is_reply` is a
      restriction of, so the row this drawer refuses to call a message is exactly
      the row the response-time trigger above refuses to call a reply. Internal
      rows are still SHOWN, because they are part of what happened to this lead
      and hiding them would be a different lie; they are labelled and they are
      not coloured by direction. */

/* STITCH, 7 Oct 2026. The drawer is the inspector of
   design/stitch/leads-saved-views-board-inspector-drawer--088011.html (stage
   progression, tabs, "Why this score") with the Timeline / Owner history /
   Assign owner tabs of leads-pipeline-audit-drawer--0e162f and the
   reassignment desk of leads-pipeline-inspector--930cc7. It is opened through
   lib/stitch-ui.js openStitchDrawer(), which goes through lib/ui.js
   openDrawer(), so the scrim, Escape and the identity-change wipe are the same
   ones every drawer has. Nothing the drawer reads or writes moved. */
import { SILENCE_MARKER, isInternalRow, isMessageRow } from './comm-events.js';
import { canReassignLead, db, dbWrite } from './data.js';
import { loadSubscription, isReadOnly } from './subscription.js';
import { dealForm } from './deal-form.js';
import { $ } from './dom.js';
import { aed, ago, dubaiStamp, esc, initials, mins, n0, pill, tone } from './format.js';
import { displayName, maskEmail, maskPhone, maskText } from './privacy.js';
/* audit_log.status is not ours to read literally: lib/health.js mirrors
   public.nexus_outcome_class() and is the only place allowed to say what one
   means. A screen reading workflow outcomes takes its tone from OUTCOME_WORDS. */
import { outcomeOf, outcomeWords } from './health.js';
import { describeKey, expandIdentity, KEY_SHAPE, keyShape, personQuery } from './identity.js';
import { go } from './nav.js';
import { BTN, comingSoonPanel, errorState, openStitchDrawer, openStitchModal, tempChip } from './stitch-ui.js';
import { closeDrawer } from './ui.js';

/* The dealership's 5-minute promise, and the extra condition the database puts
   on it. `v_needs_attention`'s sla_breach arm is
   `response_time_minutes > 5 AND created_at > now() - 30 days`, so a breach on
   an older lead is real and the view will never raise it. */
const SLA_MINUTES = 5;
const SLA_VIEW_WINDOW_DAYS = 30;

/* Rows read per source, each disclosed on screen when it is hit. */
const EVENT_LIMIT = 30;
/* Contact rows read to bridge this person's `@lid` handles. A LID carries no
   phone digits, so it can only be looked up in whatsapp_contacts. */
const LINK_LIMIT = 50;
/* Candidate leads read to answer whether anybody ELSE ends in the same nine
   digits — without that pool the drawer would match on the last-nine-digit
   rule and could merge two customers' messages under one name. */
const POOL_LIMIT = 50;

/* ── Stitch vocabulary (complete, literal class strings) ─────────────────── */
const NOTE = {
  info: 'flex items-start gap-2.5 p-3 rounded-lg border border-blue-200 bg-blue-50/60 text-blue-950 font-body-sm text-body-sm',
  warm: 'flex items-start gap-2.5 p-3 rounded-lg border border-amber-200 bg-amber-50/60 text-amber-950 font-body-sm text-body-sm',
  hot:  'flex items-start gap-2.5 p-3 rounded-lg border border-red-200 bg-red-50/60 text-red-950 font-body-sm text-body-sm',
};
const note = (t, icon, html) =>
  `<div class="${NOTE[t] || NOTE.info}"><span class="material-symbols-outlined text-[18px] shrink-0">${esc(icon)}</span><div class="min-w-0 flex-1">${html}</div></div>`;
const DOT = {
  ok: 'bg-emerald-600', won: 'bg-emerald-600', hot: 'bg-red-600', warm: 'bg-amber-500', cold: 'bg-sky-600',
  open: 'bg-violet-600', dead: 'bg-zinc-400', unknown: 'bg-zinc-400', neutral: 'bg-outline',
};
const TAB = {
  on:  'px-3 py-2.5 font-body-md text-body-sm font-semibold text-primary border-b-2 border-primary whitespace-nowrap',
  off: 'px-3 py-2.5 font-body-md text-body-sm font-medium text-on-surface-variant border-b-2 border-transparent hover:text-on-surface whitespace-nowrap',
};
const STEP = {
  done: 'w-6 h-6 rounded-full bg-primary text-on-primary flex items-center justify-center',
  todo: 'w-6 h-6 rounded-full border-2 border-outline-variant text-outline flex items-center justify-center',
};
const FIELD = 'w-full h-9 px-3 rounded-lg bg-surface-container-low border border-outline-variant/50 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary';
const LABEL = 'block font-table-header text-table-header uppercase tracking-wider text-outline mb-1';
const SECTION = 'font-table-header text-table-header uppercase tracking-wider text-outline font-semibold';
const CARD = 'bg-surface-container-lowest rounded-lg border border-outline-variant/40 p-space-md';
const FOOT_BTN = 'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant hover:bg-surface-container text-on-surface font-body-sm text-body-sm font-semibold transition-colors disabled:text-outline disabled:cursor-not-allowed';
const TEMP_WORDS = new Set(['HOT', 'WARM', 'COLD', 'WON', 'LOST', 'OPEN']);
const statusTag = (label, verbatim = true) => (TEMP_WORDS.has(String(label || '').toUpperCase())
  ? tempChip(label)
  : pill(label, undefined, { verbatim }));
const quiet = (icon, title, body) => `<div class="flex items-start gap-3 p-space-md rounded-lg bg-surface-container-lowest border border-outline-variant/30">
    <span class="material-symbols-outlined text-[20px] text-outline">${esc(icon)}</span>
    <div><div class="font-body-md text-body-sm font-semibold text-on-surface">${esc(title)}</div>
    <p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5">${esc(body)}</p></div></div>`;
const loadingLine = () => '<div class="h-3 w-3/4 rounded bg-surface-container-high animate-pulse" data-skeleton aria-busy="true"></div>';

/* A timeline row: dot, meta line, text. `t` picks the dot from DOT. */
const tlItem = (t, metaHtml, textHtml, subHtml = '') => `<div class="flex gap-3">
    <div class="flex flex-col items-center pt-1.5"><span class="w-2.5 h-2.5 rounded-full shrink-0 ${DOT[t] || DOT.neutral}"></span><span class="flex-1 w-px bg-outline-variant/50 mt-1"></span></div>
    <div class="pb-3 min-w-0 flex-1">
      <div class="flex items-center gap-2 flex-wrap font-label-numeric-sm text-label-numeric-sm text-outline">${metaHtml}</div>
      <div class="font-body-sm text-body-sm text-on-surface mt-0.5" style="white-space:pre-wrap;word-break:break-word">${textHtml}</div>
      ${subHtml}
    </div></div>`;

/* `opts.recommended` (added 22 Sep 2026) is how Money Leaks' "Contact now"
   arrives here: the recommendation the owner acted on, pinned at the top of the
   drawer with the decision it recorded. { label, reason, decision: { ok, text } }. */
function recommendedBanner(rec) {
  if (!rec || !rec.label) return '';
  const d = rec.decision;
  return note(d && d.ok === false ? 'warm' : 'info', 'campaign',
    `<strong>Recommended: ${esc(rec.label)}</strong>
      ${rec.reason ? `<div class="ds-cell-sub" style="white-space:normal">${esc(rec.reason)}</div>` : ''}
      ${d && d.text ? `<div class="ds-cell-sub" style="white-space:normal">${esc(d.text)}</div>` : ''}`);
}

/* ── Stage progression ───────────────────────────────────────────────────
   Five facts, each read off the row — never a guess at a funnel stage. The
   lead exists; the scoring pipeline finished; an owner is named; a first reply
   was timed; the status is a finished one. A step not reached is drawn open,
   with the sentence on hover. */
const FINISHED = new Set(['WON', 'CLOSED_WON', 'CONVERTED', 'DELIVERED', 'SOLD', 'LOST', 'CLOSED_LOST', 'DISQUALIFIED', 'UNQUALIFIED', 'CLOSED', 'DEAD', 'JUNK', 'SPAM', 'ARCHIVED']);
function stages(lead) {
  const owner = String(lead.users?.name || lead.assigned_to || '').trim() || lead.assigned_to_id;
  const st = String(lead.status || '').toUpperCase();
  return [
    { label: 'Received', done: true, why: `Created ${dubaiStamp(lead.created_at, 'at an unrecorded time')}.` },
    { label: 'Scored', done: String(lead.scoring_state || '').toUpperCase() === 'SCORED', why: `scoring_state is ${String(lead.scoring_state || 'PENDING')}.` },
    { label: 'Assigned', done: !!owner, why: owner ? 'An owner is named on the lead.' : 'No owner is named on the lead.' },
    { label: 'First reply', done: n0(lead.response_time_minutes) != null, why: n0(lead.response_time_minutes) != null ? `Timed at ${mins(lead.response_time_minutes)}.` : 'No first reply has been timed for this lead.' },
    { label: 'Outcome', done: FINISHED.has(st), why: FINISHED.has(st) ? `Status ${st}.` : 'The lead is still open.' },
  ];
}
const stageHtml = lead => `<div class="flex items-start justify-between gap-1">${stages(lead).map((s, i, arr) => `
    <div class="flex flex-col items-center gap-1 flex-1 min-w-0" title="${esc(s.why)}">
      <div class="flex items-center w-full">
        <span class="flex-1 h-px ${i ? 'bg-outline-variant' : 'bg-transparent'}"></span>
        <span class="${s.done ? STEP.done : STEP.todo}"><span class="material-symbols-outlined text-[14px]">${s.done ? 'check' : 'radio_button_unchecked'}</span></span>
        <span class="flex-1 h-px ${i < arr.length - 1 ? 'bg-outline-variant' : 'bg-transparent'}"></span>
      </div>
      <span class="font-label-numeric-sm text-[11px] ${s.done ? 'text-on-surface font-semibold' : 'text-outline'} text-center">${esc(s.label)}</span>
    </div>`).join('')}</div>`;

/* ── Why this score ──────────────────────────────────────────────────────
   Read off the row only: `score_reasons` is the list of reasons the scorer
   recorded ("+15 urgency: today"), `rules_signals` the flags its rules saw.
   Nothing is re-scored or re-weighted in the browser; a lead with no recorded
   reasons says so rather than having some inferred for it. The reasons can
   quote a customer's own words, so they go through maskText(). */
function scoreHtml(lead) {
  const s = n0(lead.ai_score);
  const reasons = Array.isArray(lead.score_reasons) ? lead.score_reasons : [];
  const sig = lead.rules_signals && typeof lead.rules_signals === 'object' && !Array.isArray(lead.rules_signals) ? lead.rules_signals : null;
  const flags = sig ? Object.entries(sig).filter(([, v]) => typeof v === 'boolean') : [];
  const on = flags.filter(([, v]) => v).map(([k]) => k);
  const off = flags.filter(([, v]) => !v).map(([k]) => k);
  const state = String(lead.scoring_state || 'PENDING').toUpperCase();
  const head = `<div class="flex items-center gap-4 p-space-md rounded-lg ${s == null ? 'bg-surface-container-low' : 'bg-error-container/40'}">
      <div class="min-w-14 h-14 px-2 rounded-lg bg-surface-container-lowest flex items-center justify-center font-label-numeric-lg text-[1.6rem] font-bold text-on-surface">${s == null ? '—' : esc(String(s))}</div>
      <div class="min-w-0">
        <div class="font-headline-md text-headline-md text-on-surface">${s == null ? 'Not scored' : `Score ${esc(String(s))} of 100`}</div>
        <div class="font-label-numeric-sm text-label-numeric-sm text-outline">${esc(state)}${lead.score_source ? ` · scored by ${esc(String(lead.score_source))}` : ''}${lead.scored_at ? ` · ${esc(dubaiStamp(lead.scored_at))}` : ''}</div>
      </div></div>`;
  const parts = [head];
  if (n0(lead.rules_score) != null || n0(lead.ai_score_raw) != null) {
    parts.push(`<div class="grid grid-cols-2 gap-2">
      <div class="${CARD}"><div class="${SECTION}">Rules score</div><div class="font-label-numeric-lg text-[1.25rem] font-bold">${n0(lead.rules_score) == null ? '—' : esc(String(lead.rules_score))}</div></div>
      <div class="${CARD}"><div class="${SECTION}">AI score (raw)</div><div class="font-label-numeric-lg text-[1.25rem] font-bold">${n0(lead.ai_score_raw) == null ? '—' : esc(String(lead.ai_score_raw))}</div></div>
    </div>`);
  }
  if (lead.ai_disagrees === true) parts.push(note('warm', 'compare_arrows', 'The AI scorer disagreed with the rules on this lead. Both figures are shown above; neither is averaged into the other here.'));
  if (lead.ai_parse_failed === true) parts.push(note('warm', 'error', 'The AI scorer’s answer could not be read for this lead, so the score above did not come from it.'));
  parts.push(`<div class="${SECTION}">Evidence the scorer recorded</div>`);
  parts.push(reasons.length
    ? `<div class="flex flex-col gap-2">${reasons.map(r => {
        const text = String(r == null ? '' : r);
        const m = text.match(/^([+-]\d+)\s+(.*)$/);
        const pts = m ? m[1] : '';
        const what = m ? m[2] : text;
        return `<div class="${CARD} flex items-start gap-3">
          <span class="font-label-numeric-sm text-label-numeric-sm font-bold min-w-[38px] ${pts.startsWith('-') ? 'text-red-700' : 'text-primary'}">${esc(pts || '·')}</span>
          <span class="font-body-sm text-body-sm text-on-surface">${esc(maskText(what))}</span></div>`;
      }).join('')}</div>`
    : quiet('psychology_alt', 'No reasons recorded on this lead',
        'The scorer writes its reasons into score_reasons when it scores a lead. This row carries none, so nothing here can say why it scored what it did — and nothing is inferred in their place.'));
  if (flags.length) {
    parts.push(`<div class="${SECTION}">Signals the rules saw</div>
      <div class="flex flex-wrap gap-1.5">${on.map(k => `<span class="chip">${esc(k.replace(/_/g, ' '))}</span>`).join('')}
        ${off.length ? `<span class="ds-cell-sub" style="white-space:normal">Not seen: ${esc(off.map(k => k.replace(/_/g, ' ')).join(', '))}</span>` : ''}</div>
      ${sig.core_version ? `<div class="ds-cell-sub">Rules version ${esc(String(sig.core_version))}</div>` : ''}`);
  }
  return parts.join('');
}

async function leadDrawer(lead, opts = {}) {
  const canAssign = canReassignLead(lead.tenant_id);
  const failed = String(lead.scoring_state || '').toUpperCase() === 'FAILED';
  const tabs = [
    ['details', 'Details'], ['score', 'Why this score'], ['trace', 'Timeline'],
    ['owners', 'Owner history'], ['assign', 'Assign owner'], ['activity', 'Activity'],
  ];
  const ownerName = String(lead.users?.name || lead.assigned_to || '').trim();

  const body = `
    ${recommendedBanner(opts && opts.recommended)}
    <div class="${CARD} flex flex-col gap-3">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-primary-container text-on-primary font-bold flex items-center justify-center shrink-0">${esc(maskText(initials(lead.name)))}</div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">${statusTag(lead.status || 'NEW', !!lead.status)}
            ${n0(lead.ai_score) != null ? `<span class="chip">AI score ${esc(String(lead.ai_score))}</span>` : ''}</div>
          <div class="font-label-numeric-sm text-label-numeric-sm text-outline mt-1">${lead.phone ? esc(maskPhone(lead.phone)) : 'No phone number recorded'}</div>
        </div>
      </div>
      <div class="${SECTION}">Stage progression</div>
      ${stageHtml(lead)}
    </div>
    <div class="flex items-center gap-1 overflow-x-auto border-b border-outline-variant/40 -mx-1 px-1" role="tablist">
      ${tabs.map(([k, label], i) => `<button type="button" role="tab" data-tab="${k}" class="${i ? TAB.off : TAB.on}">${esc(label)}</button>`).join('')}
    </div>
    <div data-panel="details" class="flex flex-col gap-3">
      <dl class="${CARD} grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2 font-body-sm text-body-sm">
        <dt class="text-outline">Email</dt><dd>${(() => {
          /* `leads.email` is not always an email — see note 1 in the header. */
          const shape = keyShape(lead.email);
          if (shape === KEY_SHAPE.NONE) return '<span class="ds-cell-sub">No email address is recorded on this lead.</span>';
          if (shape === KEY_SHAPE.EMAIL) return esc(maskEmail(lead.email));
          return `<span class="mono t-warm">${esc(maskText(String(lead.email)))}</span>`
            + `<div class="ds-cell-sub" style="white-space:normal">Not an email address — ${esc(maskText(describeKey(lead.email)))}. It is the key this lead's messages are filed under, not somewhere a person can be written to.</div>`;
        })()}</dd>
        <dt class="text-outline">Phone</dt><dd>${lead.phone
          ? esc(maskPhone(lead.phone))
          : '<span class="ds-cell-sub">No phone number is recorded on this lead.</span>'}</dd>
        <dt class="text-outline">Written by</dt><dd>${esc(lead.source || '—')}</dd>
        <dt class="text-outline">Vehicle</dt><dd>${esc(lead.vehicle_interest || '—')}</dd>
        <dt class="text-outline">Budget</dt><dd>${n0(lead.budget_aed) == null ? '<span class="t-muted">Not captured</span>' : aed(lead.budget_aed)}</dd>
        <dt class="text-outline">Scoring</dt><dd id="dScoringInfo">${(() => {
          /* NX1005. PENDING / SCORED / FAILED, NOT NULL, defaulted PENDING. A
             FAILED row's attempts and last error are shown so "why is this
             stuck" does not require reading a table. */
          const state = String(lead.scoring_state || 'PENDING').toUpperCase();
          const err = String(lead.scoring_last_error || '').trim();
          const attempts = n0(lead.scoring_attempts);
          return `${pill(state, state === 'SCORED' ? 'ok' : undefined, { verbatim: true })}`
            + (lead.score_source ? ` <span class="chip mono">${esc(lead.score_source)}</span>` : '')
            + (n0(lead.rules_score) != null ? `<span class="ds-cell-sub"> rules_score ${esc(String(n0(lead.rules_score)))}</span>` : '')
            + (state === 'FAILED'
                ? `<div class="ds-cell-sub t-hot">${esc(String(attempts ?? 0))} attempt${attempts === 1 ? '' : 's'}`
                  + (err ? ` -- ${esc(err)}` : ' -- no error text recorded') + '</div>'
                : '');
        })()}</dd>
        <dt class="text-outline">Assigned to</dt><dd>${(() => {
          /* Three states, the same three screens/leads.js paints: an owner, an
             owner this read could not resolve, and nobody. */
          if (ownerName) {
            return esc(ownerName) + (lead.users?.name || lead.assigned_to_id
              ? ''
              : '<span class="ds-cell-sub"> · named on the lead\'s assigned_to column; there is no rep id on the row</span>');
          }
          return lead.assigned_to_id
            ? `<span class="t-unknown">Owner not resolved</span><span class="ds-cell-sub"> · assigned_to_id ${esc(String(lead.assigned_to_id))} is set, but no users row came back for it and assigned_to is empty</span>`
            : 'Unassigned';
        })()}</dd>
        <dt class="text-outline">Response time</dt><dd>${n0(lead.response_time_minutes) == null
          /* Not a blank: a dash reads as instant. The trigger declines to stamp
             a reply that predates the lead row, so what this cell can say is
             that nothing was timed — see note 3 in the header. */
          ? '<span class="t-warm">No first reply timed</span><div class="ds-cell-sub" style="white-space:normal">The trigger on the message history stamps this column for the first reply it can attribute to the lead, and it has not stamped this one. Usually that means nothing has gone back since the lead row was created; it can also mean the conversation started before the lead existed, which the trigger will not measure. Either way there is no measured wait here — it is not a fast reply — and the attention list cannot raise an SLA breach for it.</div>'
          : `${mins(lead.response_time_minutes)} ${Number(lead.response_time_minutes) > SLA_MINUTES
              ? `<span class="t-hot">· breaches the ${SLA_MINUTES}-minute rule</span>`
                + (Date.now() - new Date(lead.created_at).getTime() > SLA_VIEW_WINDOW_DAYS * 86400000
                  ? `<span class="ds-cell-sub"> · the attention list will not raise it: its sla_breach arm only covers leads created in the last ${SLA_VIEW_WINDOW_DAYS} days</span>`
                  : '')
              : `<span class="t-ok">· within the ${SLA_MINUTES}-minute rule</span>`}`}</dd>
        <dt class="text-outline">Created</dt><dd>${ago(lead.created_at)}</dd>
      </dl>
      <div id="dVip"></div>
      ${comingSoonPanel({ icon: 'bolt', title: 'Next best action',
        body: 'A recommended next step for this lead, with the reason behind it.',
        prerequisite: 'The action engine writing per-lead recommendations; today they appear only on Money Leaks and the Action Center.' })}
      ${comingSoonPanel({ icon: 'payments', title: 'Deal & finance context',
        body: 'The deal, quote and finance status attached to this lead.',
        prerequisite: 'A link from deals and finance quotes to the lead record; neither carries a lead id this drawer can follow yet.' })}
      ${comingSoonPanel({ icon: 'directions_car', title: 'Matching stock',
        body: 'Units in stock that match what this customer asked for.',
        prerequisite: 'A matcher between vehicle_interest (free text) and inventory; none exists yet.' })}
    </div>
    <div data-panel="score" class="hidden flex flex-col gap-3">${scoreHtml(lead)}</div>
    <div data-panel="trace" class="hidden flex flex-col gap-3"><div id="dTrace">${loadingLine()}</div></div>
    <div data-panel="owners" class="hidden flex flex-col gap-3"><div id="dOwners">${loadingLine()}</div></div>
    <div data-panel="assign" class="hidden flex flex-col gap-3"><div id="dAssignBox">${canAssign
      ? loadingLine()
      : quiet('lock', 'Reassigning is a manager decision',
          'Moving a lead to a different owner is an owner, admin or manager decision at this dealership. It moves commission and it moves who is answerable for the 5-minute rule.')}</div></div>
    <div data-panel="activity" class="hidden flex flex-col gap-3"><div id="dTimeline">${loadingLine()}</div></div>`;

  const foot = `<div class="flex items-center gap-2 flex-wrap">
      <button type="button" class="${FOOT_BTN}" id="dWhats"><span class="material-symbols-outlined text-[18px]">chat</span>Open conversation</button>
      <!-- NX1005: books directly from the lead through nexus_my_appointment_request
           then nexus_my_appointment_confirm, chained in bookVisitDialog(). -->
      <button type="button" class="${FOOT_BTN}" id="dBookVisit"><span class="material-symbols-outlined text-[18px]">event</span>Book visit</button>
      <!-- NX1005: only meaningful on a FAILED lead -- shown and disabled
           otherwise, so a rep can see the action exists and why it is off. -->
      <button type="button" class="${FOOT_BTN}" id="dRetryScore"${failed ? '' : ' disabled title="Only a FAILED lead can be retried. Resets scoring_state to PENDING so the hourly rescore workflow picks it up."'}>Retry scoring</button>
      <button type="button" class="${BTN.primary}" id="dWon"><span class="material-symbols-outlined text-[18px]">handshake</span>Mark deal won</button>
    </div>
    <div class="ds-cell-sub" id="dFootMsg" aria-live="polite"></div>`;

  const drawer = openStitchDrawer({
    icon: 'person',
    title: displayName(lead.name, lead.id),
    sub: `Lead #${lead.id}${ownerName ? ` · ${ownerName}` : ''}`,
    bodyHtml: body,
    footHtml: foot,
  });

  const showTab = k => {
    drawer.querySelectorAll('[data-tab]').forEach(b => { b.className = b.dataset.tab === k ? TAB.on : TAB.off; b.setAttribute('aria-selected', String(b.dataset.tab === k)); });
    drawer.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== k));
  };
  drawer.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  drawer.__showTab = showTab;

  const footMsg = html => { const n = $('dFootMsg'); if (n) n.innerHTML = html; };
  $('dWhats').addEventListener('click', () => { closeDrawer(); go('conversations'); });
  /* NX1006 (21 Sep 2026). The only path that writes a sale — lib/deal-form.js
     posting to n8n('deals/closed-won') — reachable from the lead itself. */
  $('dWon').addEventListener('click', () => dealForm([lead], () => { closeDrawer(); go('deals'); }));

  /* NX1005: a direct database write via rpc/nexus_my_lead_retry_scoring — the
     same tenant-scoped, FAILED-only refusal the SQL function enforces. */
  $('dRetryScore').addEventListener('click', async () => {
    const btn = $('dRetryScore');
    btn.disabled = true;
    footMsg('<span class="t-muted">Retrying…</span>');
    try {
      const res = await dbWrite('POST', 'rpc/nexus_my_lead_retry_scoring', { p_lead_id: lead.id });
      const row = Array.isArray(res) ? res[0] : res;
      if (row) {
        lead.scoring_state = row.scoring_state;
        lead.scoring_attempts = row.scoring_attempts;
        lead.scoring_last_error = row.scoring_last_error;
      }
      const info = $('dScoringInfo');
      if (info) info.innerHTML = `${pill(String(lead.scoring_state || 'PENDING').toUpperCase(), undefined, { verbatim: true })}`;
      footMsg('<span class="t-ok">Queued for rescoring — the next hourly run will pick it up.</span>');
      btn.title = 'This lead is no longer FAILED, so there is nothing left to retry.';
    } catch (e) {
      footMsg(`<span class="t-hot">${esc(e.message || String(e))}</span>`);
      btn.disabled = false;
    }
  });

  /* NX1005: the read-only check is async (loadSubscription() may be a network
     call), so it runs on click. It never throws; an unread subscription is
     never read-only, so this never blocks on a question it could not answer. */
  $('dBookVisit').addEventListener('click', async () => {
    footMsg('<span class="t-muted">Checking…</span>');
    await loadSubscription();
    if (isReadOnly()) {
      footMsg('<span class="t-hot">This dealership’s subscription is in a read-only state, so a visit cannot be booked until it is resolved.</span>');
      return;
    }
    footMsg('');
    bookVisitDialog(lead);
  });

  /* Captured NOW, before any await (note 2 in the header): a second click within
     one round-trip must not paint this lead's history into the next drawer. A
     captured node that has since been replaced is detached, and writing to it
     is invisible — the correct outcome for a superseded load. */
  const vipBox = $('dVip');
  const timelineBox = $('dTimeline');
  traceSection($('dTrace'), lead);
  ownerSection($('dOwners'), lead);
  if (canAssign) assignSection($('dAssignBox'), lead);
  if (opts && opts.tab) showTab(opts.tab);

  /* A real email address, as opposed to whatever `leads.email` happens to hold.
     Neither a `+digits@whatsapp.lead` key nor an empty string is an address
     `purchase_history.email` could ever match. */
  const realEmail = keyShape(lead.email) === KEY_SHAPE.EMAIL ? String(lead.email).toLowerCase() : '';

  const settle = r => r.status === 'fulfilled'
    ? { ok: true,  rows: r.value || [], err: null }
    : { ok: false, rows: [], err: String(r.reason?.message || r.reason).slice(0, 140) };
  const skipped = why => ({ ok: false, rows: [], err: null, skipped: why });

  /* Stage one: the `@lid` bridge, the one read that genuinely keys on an email,
     and the collision pool. */
  const firstPass = expandIdentity({ leadId: lead.id, email: lead.email, phone: lead.phone, name: lead.name });
  const linkReads = [];
  if (firstPass.suffix) {
    linkReads.push(db('whatsapp_contacts?select=chat_id,phone,push_name,lead_email'
      + `&phone=like.*${encodeURIComponent(firstPass.suffix)}&limit=${LINK_LIMIT}`));
  }
  if (realEmail) {
    linkReads.push(db('whatsapp_contacts?select=chat_id,phone,push_name,lead_email'
      + `&lead_email=eq.${encodeURIComponent(realEmail)}&limit=${LINK_LIMIT}`));
  }
  const [linkSettled, purchR, poolR] = await Promise.all([
    Promise.allSettled(linkReads),
    realEmail
      ? Promise.allSettled([db(`purchase_history?select=*&email=eq.${encodeURIComponent(realEmail)}`)])
          .then(([r]) => r)
      : Promise.resolve(null),
    firstPass.suffix
      ? Promise.allSettled([db('leads?select=id,name,email,phone'
          + `&phone=like.*${encodeURIComponent(firstPass.suffix)}&limit=${POOL_LIMIT}`)])
          .then(([r]) => r)
      : Promise.resolve(null),
  ]);
  const linkErr = linkSettled.find(r => r.status === 'rejected');
  const links = linkSettled.flatMap(r => (r.status === 'fulfilled' ? (r.value || []) : []));
  const pool = poolR && poolR.status === 'fulfilled' ? (poolR.value || []) : [];
  /* A failed pool read is not "no collision" — it is disclosed below. */
  const poolErr = poolR && poolR.status === 'rejected'
    ? String(poolR.reason?.message || poolR.reason).slice(0, 140)
    : null;

  /* Stage two: the full key set, and the two reads that must use it. */
  const ident = expandIdentity(
    { leadId: lead.id, email: lead.email, phone: lead.phone, name: lead.name },
    { links, leads: pool });
  const commPath = personQuery('communication_logs', ident,
    { select: '*', order: 'created_at.desc', limit: EVENT_LIMIT });
  const auditPath = personQuery('audit_log', ident,
    { select: '*', order: 'logged_at.desc', limit: EVENT_LIMIT });

  const [commsR, auditR] = await Promise.all([
    commPath ? Promise.allSettled([db(commPath)]).then(([r]) => r) : Promise.resolve(null),
    auditPath ? Promise.allSettled([db(auditPath)]).then(([r]) => r) : Promise.resolve(null),
  ]);

  /* allSettled keeps the drawer opening when one read dies, `ok` carries
     whether we actually know, and `skipped` is the third case: the read was
     never issued, because there was no usable key. Nothing below may assert an
     absence unless its read succeeded. */
  const purchase = purchR
    ? settle(purchR)
    : skipped(lead.email
        ? `The recorded sales is keyed on a real email address, and this lead's email column holds ${String(lead.email)}, which is not one.`
        : 'The recorded sales is keyed on email and this lead has none.');
  const comm = commsR ? settle(commsR) : skipped('Nothing identifies this lead — no email, no phone number, no WhatsApp address — so there is no key to read messages under.');
  const aud  = auditR ? settle(auditR)  : skipped('Nothing identifies this lead, so there is no key to read workflow activity under.');
  const purch = purchase.rows, comms = comm.rows, audit = aud.rows;

  const commCapped = comm.ok && comms.length >= EVENT_LIMIT;
  const auditCapped = aud.ok && audit.length >= EVENT_LIMIT;

  if (vipBox) {
    vipBox.innerHTML = purch.length
      ? `<div class="${CARD} flex flex-col gap-2"><div class="${SECTION}">Purchase history · returning customer</div>
         ${purch.map(p => `<div class="font-body-sm text-body-sm"><strong>${esc(p.vehicle)}</strong> · ${aed(p.amount_aed)}
            <div class="ds-cell-sub">${esc(p.purchase_date || '')}</div></div>`).join('')}</div>`
      : purchase.ok
        ? ''                       /* read succeeded and there are none — silence is honest */
        : purchase.skipped
          ? note('warm', 'warning', `Purchase history was not looked up for this lead. ${esc(purchase.skipped)}
             This customer is <strong>not</strong> being shown as a first-time buyer — nothing here knows either way.`)
          : note('warm', 'error', `Purchase history could not be read (${esc(purchase.err)}), so this customer is
             <strong>not</strong> being shown as a first-time buyer — we do not know either way.`);
  }

  /* A communication_logs row is a message to or from this customer, or one of
     the dealership's own internal notes written ABOUT them (lib/comm-events.js,
     mirroring public.nexus_is_message()). Only the first kind is coloured by
     direction; the second is labelled and left neutral. */
  const events = [
    ...comms.map(c => (isMessageRow(c) ? {
      at: c.created_at, kind: c.channel || 'message',
      tone: tone(c.direction) || 'neutral',
      note: '', title: `This message is recorded as ${String(c.direction === 'inbound' ? 'from the customer' : (c.direction === 'outbound' ? 'sent by us' : 'having no direction'))}.`,
      text: c.message,
    } : {
      at: c.created_at, kind: String(c.channel || 'internal'),
      tone: 'neutral',
      note: 'Internal note',
      title: 'Not a message to or from this customer. NEXUS’s own test for what counts as a message rejects this row — it is on '
        + `channel ${String(c.channel || '(empty)')} with direction ${String(c.direction || '(empty)')}`
        + `${String(c.message || '').startsWith(SILENCE_MARKER) ? `, and its body is the 12-hour silence detector's ${SILENCE_MARKER} marker, written because nobody was in touch` : ''}`
        + '. The same predicate is why nexus_is_reply() does not count it as a reply, so it never set this '
        + 'lead\'s response time either. It is shown because it is part of what happened to this lead, not '
        + 'because anybody said it.',
      text: c.message,
    })),
    ...audit.map(a => {
      const w = outcomeWords(outcomeOf(a));
      return {
        at: a.logged_at, kind: a.workflow || 'workflow',
        tone: w.tone || 'neutral',
        note: w.label,
        title: `${w.blurb} That run was recorded as ${String(a.status || '(no status)')}.`,
        text: a.summary,
      };
    }),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  if (timelineBox) {
    timelineBox.innerHTML = events.length ? `<div class="flex flex-col">${events.map(e => tlItem(e.tone,
      `<span class="chip">${esc(e.kind)}</span>${e.note
          ? ` <span class="t-${esc(e.tone)}" title="${esc(e.title)}">${esc(e.note)}</span>`
          : ''} ${ago(e.at)}`,
      esc(String(e.text || '').slice(0, 400)))).join('')}</div>`
      : (comm.ok && aud.ok)
        ? quiet('history', 'No activity recorded',
            `Nothing is logged under any of the ${ident.keys.length} ${ident.keys.length === 1 ? 'key' : 'keys'} this lead is filed under — ${ident.keys.join(', ')} — nor under the last-nine-digit rule the workflows match on.`)
        : note('hot', 'error', `<strong>This activity history is incomplete — it is not empty.</strong>
         ${!comm.ok ? `Messages ${comm.skipped ? 'were not read' : `could not be read (${esc(comm.err)})`}. ${comm.skipped ? esc(comm.skipped) + ' ' : ''}` : ''}
         ${!aud.ok ? `Workflow activity ${aud.skipped ? 'was not read' : `could not be read (${esc(aud.err)})`}. ` : ''}
         Do not treat this as "we have never contacted them".`);

    /* Even a populated history is a lie by omission if one half failed, was cut
       off at its ceiling, or was read on fewer keys than this person is filed
       under. Each is a different sentence because each leads somewhere else. */
    const commInternal = comms.filter(isInternalRow).length;
    const gaps = [
      !comm.ok ? `messages ${comm.skipped ? 'were not read at all' : `could not be read (${comm.err})`}` : '',
      (comm.ok && comms.length && commInternal === comms.length)
        ? `nothing logged under this lead is a message — all ${comms.length} ${comms.length === 1 ? 'row is one of' : 'rows are'} the dealership's own internal ${comms.length === 1 ? 'note' : 'notes'}, written about this customer rather than to or from them`
        : (commInternal
            ? `${commInternal} of the ${comms.length} logged ${comms.length === 1 ? 'row' : 'rows'} ${commInternal === 1 ? 'is an internal note' : 'are internal notes'} rather than a message, and ${commInternal === 1 ? 'is' : 'are'} labelled as such below`
            : ''),
      !aud.ok ? `workflow activity ${aud.skipped ? 'was not read at all' : `could not be read (${aud.err})`}` : '',
      commCapped ? `the message read stopped at its ${EVENT_LIMIT}-row ceiling, so older messages are missing` : '',
      auditCapped ? `the workflow-activity read stopped at its ${EVENT_LIMIT}-row ceiling` : '',
      linkErr ? 'The saved contact details could not be read, so any @lid handle belonging to this person could not be bridged to them and messages filed under one are missing' : '',
      poolErr ? `Your leads could not be read (${poolErr}), so whether another lead ends in the same nine digits was never checked — this history was matched on that rule anyway, and if two customers share those digits their messages are mixed together here` : '',
    ].filter(Boolean);
    if (events.length && gaps.length) {
      timelineBox.insertAdjacentHTML('afterbegin', note('warm', 'warning', `Showing only part of the history — ${esc(gaps.join('; '))}.`));
    }
    /* Ambiguity is a decision the resolver made and refused to hide. */
    if (ident.ambiguous) {
      timelineBox.insertAdjacentHTML('afterbegin', note('warm', 'warning', esc(ident.ambiguity.map(a => a.message).join(' '))));
    }
  }
}

/* ── Timeline: rpc/nexus_lead_trace ──────────────────────────────────────────
   Added 7 Oct 2026. The database's own hop-by-hop account of one lead. Activity
   matches on every key this lead is filed under (lib/identity.js); the trace
   matches ONLY the way the schema can link — the lead row by primary key, its
   arrival by foreign key, and messages and the audit trail by an EMAIL STRING.
   Both are true. `link_confidence` is printed on every row because it is the
   point: NOT_LINKABLE is the honest answer for a phone-only lead and is
   rendered as "cannot be attached", never as "nothing happened". */
const LINK_TONE = {
  PRIMARY_KEY: 'ok', FOREIGN_KEY: 'ok', EMAIL_STRING_MATCH: 'warm', NOT_LINKABLE: 'hot', NO_ROWS: 'unknown',
};
const LINK_WORDS = {
  PRIMARY_KEY: 'linked by the lead id',
  FOREIGN_KEY: 'linked by a key',
  EMAIL_STRING_MATCH: 'matched on an email string only',
  NOT_LINKABLE: 'cannot be attached to this lead',
  NO_ROWS: 'nothing linked',
};
const TRACE_SHOWN = 40;

async function traceSection(box, lead) {
  if (!box) return;
  let rows;
  try {
    rows = await db(`rpc/nexus_lead_trace?p_lead_id=${encodeURIComponent(lead.id)}`) || [];
  } catch (e) {
    box.innerHTML = errorState({ what: 'this lead’s timeline', err: e });
    return;
  }
  if (!rows.length) {
    box.innerHTML = quiet('timeline', 'No timeline came back for this lead',
      'The trace returns nothing for a lead outside your dealership, or one that no longer exists. It is not evidence that nothing happened to this customer.');
    return;
  }
  const notLinkable = rows.filter(r => String(r.link_confidence || '').toUpperCase() === 'NOT_LINKABLE');
  const shown = rows.slice(0, TRACE_SHOWN);
  box.innerHTML = `<div class="flex items-center justify-between"><span class="${SECTION}">Audit trace</span>
      <span class="font-label-numeric-sm text-label-numeric-sm text-primary">${rows.length} ${rows.length === 1 ? 'step' : 'steps'}</span></div>`
    + (notLinkable.length
      ? note('warm', 'link_off', `${notLinkable.length} ${notLinkable.length === 1 ? 'part' : 'parts'} of this lead’s history cannot be attached to it,
       because the only link those records carry is an email address and this lead has none. That is a limit of how
       the records are stored, not a sign that nothing was sent or done.`)
      : '')
    + `<div class="flex flex-col mt-2">${shown.map(r => {
      const conf = String(r.link_confidence || '').toUpperCase();
      const t = LINK_TONE[conf] || 'unknown';
      return tlItem(t,
        `<span class="chip">${esc(String(r.hop || 'step'))}</span>
          <span class="t-${esc(t)}" title="${esc(String(r.linked_by || ''))}">${esc(LINK_WORDS[conf] || conf || 'link not stated')}</span>
          ${r.occurred_at ? esc(dubaiStamp(r.occurred_at)) : '<span class="t-muted">no time recorded</span>'}`,
        esc(maskText(String(r.summary || ''))),
        r.caveat ? `<div class="ds-cell-sub" style="white-space:normal">${esc(maskText(String(r.caveat)))}</div>` : '');
    }).join('')}</div>`
    + (rows.length > shown.length
      ? `<div class="ds-cell-sub">Showing the first ${shown.length} of ${rows.length} steps.</div>`
      : '');
}

/* ── Owner history: lead_owner_events ────────────────────────────────────────
   Written by a trigger on public.leads for every writer, from 7 Sep 2026 only:
   earlier changes were never recorded, so an empty list says exactly that. */
async function ownerSection(box, lead) {
  if (!box) return;
  let rows;
  try {
    rows = await db('lead_owner_events?select=at,event,actor_authority,from_name,to_name,reason'
      + `&lead_id=eq.${encodeURIComponent(lead.id)}&order=at.desc&limit=50`) || [];
  } catch (e) {
    box.innerHTML = errorState({ what: 'this lead’s owner history', err: e });
    return;
  }
  if (!rows.length) {
    box.innerHTML = quiet('manage_accounts', 'No ownership change is recorded',
      'Owner changes are recorded from 7 September 2026 onwards. A lead reassigned before then, or never reassigned, shows nothing here — the two cannot be told apart.');
    return;
  }
  box.innerHTML = `<div class="flex flex-col">${rows.map(r => tlItem('neutral',
    `<span class="chip">${esc(String(r.event || 'change'))}</span>
      ${esc(dubaiStamp(r.at))}${r.actor_authority ? ` · ${esc(String(r.actor_authority))}` : ''}`,
    `${esc(String(r.from_name || 'Nobody'))} → ${esc(String(r.to_name || 'Nobody'))}`,
    `<div class="ds-cell-sub" style="white-space:normal">${r.reason
      ? esc(String(r.reason))
      : 'No reason was given with this change.'}</div>`)).join('')}</div>`;
}

/* NX1005 -- "Book visit" from the lead drawer ──────────────────────────────
   Two calls, chained: nexus_my_appointment_request() creates the visit
   REQUESTED against this lead, then nexus_my_appointment_confirm() gives it the
   time, duration and salesperson entered here. Both are tenant-scoped wrappers
   over NX995's own verbs, so this dialog can do nothing a signed-in user could
   not already do — including the EXCLUDE USING gist double-booking refusal,
   which arrives as NX995's own sentence and is shown as-is.

   THE TIME IS ENTERED IN THE BROWSER'S OWN CLOCK. `datetime-local` carries no
   timezone; a browser set outside Asia/Dubai books the wrong wall-clock hour
   with no warning from this dialog — a real gap, named here.

   If the request succeeds and the confirm fails, the visit is NOT lost: it
   exists REQUESTED under the id handed back, and the message names it so a rep
   does not book the same customer twice. */
function bookVisitDialog(lead) {
  const m = openStitchModal({
    title: `Book a visit — ${displayName(lead.name, lead.id)}`,
    bodyHtml: `<div class="flex flex-col gap-3">
      <p class="font-body-sm text-body-sm text-on-surface-variant">
        Requests a visit for this lead and confirms it for the time below in one step. The appointment belongs to this
        lead's own dealership, never any other one, and is recorded under your own account as the actor.</p>
      <div><label class="${LABEL}" for="bvWhen">When (this device's own clock)</label>
        <input id="bvWhen" type="datetime-local" class="${FIELD}"></div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="${LABEL}" for="bvDuration">Duration (minutes)</label>
          <input id="bvDuration" type="number" min="5" step="5" value="45" class="${FIELD}"></div>
        <div><label class="${LABEL}" for="bvSalesWrap">Salesperson (optional)</label>
          <div id="bvSalesWrap" class="ds-cell-sub">Loading staff…</div></div>
      </div>
      <div><label class="${LABEL}" for="bvNotes">Notes (optional)</label>
        <input id="bvNotes" type="text" maxlength="400" class="${FIELD}" placeholder="What the customer wants to see or do"></div>
    </div>`,
    footHtml: `<button type="button" class="${BTN.secondary}" id="bvCancel">Cancel</button>
      <button type="button" class="${BTN.primary}" id="bvGo">Book it</button>`,
  });

  const $$ = id => m.wrap.querySelector(id);
  $$('#bvCancel').addEventListener('click', () => m.close());

  db('users?select=id,name,status&order=name').then(users => {
    const list = users || [];
    $$('#bvSalesWrap').innerHTML = list.length
      ? `<select id="bvSales" class="${FIELD}"><option value="">Unassigned</option>${list.map(u =>
          `<option value="${esc(u.id)}"${u.id === lead.assigned_to_id ? ' selected' : ''}>${esc(u.name)}${u.status === 'pending_invite' ? ' (pending invite)' : ''}</option>`).join('')}</select>`
      : '<span class="t-muted">No staff accounts to offer -- the visit can still be booked with no salesperson attached.</span>';
  }).catch(e => {
    $$('#bvSalesWrap').innerHTML =
      `<span class="t-hot">The staff list could not be read (${esc(e.message || String(e))}). The visit can still be booked with no salesperson attached.</span>`;
  });

  $$('#bvGo').addEventListener('click', async () => {
    const goBtn = $$('#bvGo');
    const whenVal = ($$('#bvWhen').value || '').trim();
    if (!whenVal) {
      m.msg('<span class="t-hot">A date and time are required -- a visit with no time is a REQUEST, not a booking. Use the Appointments screen for a request with no time yet.</span>');
      return;
    }
    const dt = new Date(whenVal);
    if (Number.isNaN(dt.getTime())) {
      m.msg('<span class="t-hot">That is not a time this dialog can read. Please re-enter it.</span>');
      return;
    }
    const duration = Number(($$('#bvDuration').value || '45').trim()) || 45;
    const salesSel = m.wrap.querySelector('#bvSales');
    const salesId = salesSel ? (salesSel.value || null) : null;
    const notes = ($$('#bvNotes').value || '').trim() || null;

    goBtn.disabled = true;
    m.msg('Requesting…');
    let appt;
    try {
      const rows = await dbWrite('POST', 'rpc/nexus_my_appointment_request', {
        p_lead_id: lead.id, p_channel: 'PHONE', p_notes: notes,
      });
      appt = Array.isArray(rows) ? rows[0] : rows;
    } catch (e) {
      m.msg(`<span class="t-hot">${esc(e.message || String(e))}</span>`);
      goBtn.disabled = false;
      return;
    }

    m.msg(`Requested as appointment ${esc(String(appt && appt.appointment_id))}. Confirming the time…`);
    try {
      const rows2 = await dbWrite('POST', 'rpc/nexus_my_appointment_confirm', {
        p_appointment_id: appt.appointment_id,
        p_starts_at: dt.toISOString(),
        p_duration_minutes: duration,
        p_assigned_to_id: salesId,
        p_location: null,
        p_resource: null,
      });
      const conf = Array.isArray(rows2) ? rows2[0] : rows2;
      m.msg(`<span class="t-ok">Booked. Appointment ${esc(String(conf && conf.appointment_id))} is CONFIRMED for `
        + `${esc(conf && conf.starts_at ? dubaiStamp(conf.starts_at) : whenVal)}. `
        + `Open the Appointments screen to see it in the diary.</span>`);
    } catch (e) {
      m.msg(`<span class="t-hot">The visit was requested (appointment ${esc(String(appt && appt.appointment_id))}) but could not be `
        + `confirmed for that time: ${esc(e.message || String(e))} It still exists as REQUESTED -- open the `
        + `Appointments screen to confirm it for a different time rather than booking this lead again.</span>`);
      goBtn.disabled = false;
    }
  });

  return m;
}

/* ── Assign owner (the reassignment desk) ───────────────────────────────────
   rpc/nexus_lead_assign_owner, NOT a PATCH on `leads`, for two measured
   reasons (7 Sep 2026): through the function the reason is recorded in
   lead_owner_events (a PATCH writes it NULL), and the function refuses an
   owner from another dealership, which the row policy does not.

   KNOWN STATE, 7 Oct 2026: on production this call is refused with 42501.
   `authenticated` no longer holds UPDATE on `leads` and the function is still
   SECURITY INVOKER, so its UPDATE fails on the grant before any policy runs.
   The owner is fixing that grant/definer question separately. This form keeps
   calling the function and shows the refusal as it arrives; it does not route
   around it with a direct write, which would bring back both defects above. */
async function assignSection(box, lead) {
  if (!box || !canReassignLead(lead.tenant_id)) return;
  let users = [], rosterErr = null;
  try { users = await db('users?select=id,name,status&order=name') || []; }
  catch (e) { rosterErr = String(e.message || e).slice(0, 140); }
  /* An empty roster with a live Save button was a trap: it would have saved a
     blank owner and silently UNASSIGNED the lead. */
  const canAssign = users.length > 0;
  const current = String(lead.users?.name || lead.assigned_to || '').trim();
  box.innerHTML = `<div class="flex flex-col gap-3">
    <div class="flex items-center justify-between"><span class="${SECTION}">Owner reassignment desk</span>
      <span class="font-label-numeric-sm text-label-numeric-sm text-outline">Recorded with the change</span></div>
    <div class="${CARD} flex items-center gap-3">
      <div class="w-9 h-9 rounded-full bg-primary text-on-primary font-bold text-[12px] flex items-center justify-center">${esc(initials(current || '?'))}</div>
      <div><div class="${SECTION}">Current owner</div><div class="font-body-md text-body-sm font-semibold text-on-surface">${esc(current || 'Unassigned')}</div></div>
    </div>
    ${rosterErr
      ? note('hot', 'error', `The staff list could not be read (${esc(rosterErr)}), so there is nobody to pick. This is not an empty team — reload and try again.`)
      : !canAssign ? note('warm', 'warning', 'There are no staff accounts to assign to.') : ''}
    <div><label class="${LABEL}" for="assignSel">Reassign to</label>
      <select id="assignSel" class="${FIELD}" ${canAssign ? '' : 'disabled'}>${users.map(u => `<option value="${esc(u.id)}" ${u.id === lead.assigned_to_id ? 'selected' : ''}>${esc(u.name)}${u.status === 'pending_invite' ? ' (pending invite)' : ''}</option>`).join('')}</select></div>
    <div><label class="${LABEL}" for="assignWhy">Why (optional — recorded with the change)</label>
      <textarea id="assignWhy" maxlength="200" rows="2" class="w-full px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/50 font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary" placeholder="e.g. customer asked for someone else"></textarea></div>
    <button type="button" class="${BTN.primary}" id="assignGo" ${canAssign ? '' : 'disabled title="No staff list was loaded, so saving could only clear the current owner."'}>
      <span class="material-symbols-outlined text-[18px]">assignment_ind</span>Confirm reassignment</button>
    <div class="ds-cell-sub" id="assignMsg" aria-live="polite" style="white-space:normal"></div>
  </div>`;
  box.querySelector('#assignGo').addEventListener('click', async () => {
    const id = box.querySelector('#assignSel').value;
    if (!id) {                          /* belt and braces: never save a blank owner */
      box.querySelector('#assignMsg').innerHTML =
        '<span class="t-hot">No rep selected — refusing to save, because that would clear the current owner.</span>';
      return;
    }
    const why = (box.querySelector('#assignWhy')?.value || '').trim();
    const btn = box.querySelector('#assignGo');
    btn.disabled = true;
    box.querySelector('#assignMsg').innerHTML = '<span class="t-muted">Saving…</span>';
    try {
      /* Refusals arrive with a sentence written for a salesperson and are shown
         as-is. A 42501 here is the grant state described above — the change was
         NOT made, and the message says so in the database's own words. */
      await dbWrite('POST', 'rpc/nexus_lead_assign_owner', {
        p_lead_id: lead.id, p_to_staff_id: id, p_reason: why || null,
      });
      box.querySelector('#assignMsg').innerHTML = '<span class="t-ok">Saved. Reopen the screen to see it in the table; the change and its reason are in Owner history.</span>';
      ownerSection($('dOwners'), lead);
    } catch (e) {
      const refused = /42501|permission denied/i.test(String(e && (e.code || e.message)));
      box.querySelector('#assignMsg').innerHTML = `<span class="t-hot">The owner was not changed — ${esc(e.message || String(e))}</span>`
        + (refused ? '<div class="ds-cell-sub" style="white-space:normal">The database refused the reassignment on a permission check before any rule about this lead was applied. This is a known server-side grant issue being fixed separately; nothing about this lead changed.</div>' : '');
      btn.disabled = false;
    }
  });
}

/* Kept as an export for callers that want the assign desk directly: it opens
   (or switches the open drawer to) the Assign owner tab. */
async function assignDialog(lead) {
  if (!canReassignLead(lead.tenant_id)) return;
  const d = $('drawer');
  if (d && d.classList.contains('open') && typeof d.__showTab === 'function' && d.querySelector('#dAssignBox')) {
    d.__showTab('assign');
    return;
  }
  await leadDrawer(lead, { tab: 'assign' });
}

export { leadDrawer, assignDialog, bookVisitDialog };
