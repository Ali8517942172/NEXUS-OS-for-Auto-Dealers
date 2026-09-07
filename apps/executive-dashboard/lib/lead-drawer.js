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
import { SILENCE_MARKER, isInternalRow, isMessageRow } from './comm-events.js';
import { canReassignLead, db, dbWrite } from './data.js';
import { $, el } from './dom.js';
import { aed, ago, esc, initials, mins, n0, pill, tone } from './format.js';
/* audit_log.status is not ours to read literally: lib/health.js mirrors
   public.nexus_outcome_class() and is the only place allowed to say what one
   means. The timeline used to colour its dot straight from `tone(a.status)`,
   which paints a row that went out half-done the same green as one that
   delivered, because the writer labelled it SUCCESS or FAILED and neither word
   is the outcome. format.js says so itself, above its TONE table: a screen
   reading workflow outcomes must take its tone from OUTCOME_WORDS. */
import { outcomeOf, outcomeWords } from './health.js';
import { describeKey, expandIdentity, KEY_SHAPE, keyShape, personQuery } from './identity.js';
import { go } from './nav.js';
import { stateEmpty, stateLoading } from './states.js';
import { closeDrawer, openDrawer } from './ui.js';

/* The dealership's 5-minute promise, and the extra condition the database puts
   on it. `v_needs_attention`'s sla_breach arm is
   `response_time_minutes > 5 AND created_at > now() - 30 days` (read from the
   live view definition on 1 Sep 2026), so a breach on an older lead is real and
   the view will never raise it. This drawer says which of the two it is. */
const SLA_MINUTES = 5;
const SLA_VIEW_WINDOW_DAYS = 30;

/* Rows read per source. Each is disclosed on screen when it is hit, because a
   timeline cut off at its ceiling is a shorter history, not a wrong-looking one. */
const EVENT_LIMIT = 30;
/* Contact rows read to bridge this person's `@lid` handles. A LID carries no
   phone digits, so it can never be derived from a number — only looked up in
   whatsapp_contacts. Bounded because this runs on every drawer open. */
const LINK_LIMIT = 50;
/* Candidate leads read to answer the one question this drawer cannot answer from
   the row it was handed: does anybody ELSE end in the same nine digits?
   screens/leads.js has the whole table in memory and so reports that collision;
   a drawer opened from that very row had no pool, could not detect it, and would
   have gone on to match on the last-nine-digit rule anyway — merging two
   customers' messages under one name while the screen behind it said it had
   refused to. That is the same two-files-disagree fault this pass exists to end,
   in its worst form. Keyed on the suffix, so it reads only rows that could
   collide, and never on a lead with no phone number, where the rule is not in
   play at all. */
const POOL_LIMIT = 50;

async function leadDrawer(lead) {
  openDrawer(`
    <div class="drawer-head">
      <div class="avatar">${esc(initials(lead.name))}</div>
      <div style="flex:1;min-width:0">
        <h2 style="font-size:18px">${esc(lead.name)}</h2>
        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">${pill(lead.status || 'NEW', undefined, { verbatim: !!lead.status })}
          ${n0(lead.ai_score) != null ? `<span class="chip">AI score ${lead.ai_score}</span>` : ''}</div>
      </div>
      <button class="btn ghost sm" id="dClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
    </div>
    <div class="drawer-body">
      <div class="section">
        <div class="label-caps">Contact</div>
        <dl class="kv">
          <dt>Email</dt><dd>${(() => {
            /* `leads.email` is not always an email — see note 1 in the header.
               Rendering `+971547484167@whatsapp.lead` plainly under "Email" sends
               a rep to write to an address the router invented, and it is why
               the purchase-history read below refuses to use it. */
            const shape = keyShape(lead.email);
            if (shape === KEY_SHAPE.NONE) return '<span class="cell-sub">No email address is recorded on this lead.</span>';
            if (shape === KEY_SHAPE.EMAIL) return esc(lead.email);
            return `<span class="mono t-warm">${esc(String(lead.email))}</span>`
              + `<span class="cell-sub"> · not an email address — ${esc(describeKey(lead.email))}. It is the key this lead's messages are filed under, not somewhere a person can be written to.</span>`;
          })()}</dd>
          <dt>Phone</dt><dd>${lead.phone
            ? esc(lead.phone)
            : '<span class="cell-sub">No phone number is recorded on this lead.</span>'}</dd>
          <dt>Source</dt><dd>${esc(lead.source || '—')}</dd>
          <dt>Vehicle</dt><dd>${esc(lead.vehicle_interest || '—')}</dd>
          <dt>Budget</dt><dd>${n0(lead.budget_aed) == null ? '<span class="t-muted">Not captured by the router</span>' : aed(lead.budget_aed)}</dd>
          <dt>Assigned to</dt><dd>${(() => {
            /* `users?.name` only resolves when the caller selected the
               `users(id,name)` embed. Overview and Conversations do not, so a
               perfectly well-owned lead read "Unassigned" — the plain
               `assigned_to` column is what every caller gets.

               Three states, not two, and the same three screens/leads.js now
               paints in its Assigned column: the two files disagreed about who
               owned a lead until 1 Sep, and the row you clicked to open this
               drawer was the one that disagreed. "No owner" and "an owner this
               read could not resolve" lead somewhere different, so they are not
               spelled the same. `· no rep id on the row` used to be appended to
               "Unassigned" as well, where it explained nothing. */
            const name = String(lead.users?.name || lead.assigned_to || '').trim();
            if (name) {
              return esc(name) + (lead.users?.name || lead.assigned_to_id
                ? ''
                : '<span class="cell-sub"> · named on the lead\'s assigned_to column; there is no rep id on the row</span>');
            }
            return lead.assigned_to_id
              ? `<span class="t-unknown">Owner not resolved</span><span class="cell-sub"> · assigned_to_id ${esc(String(lead.assigned_to_id))} is set, but no users row came back for it and assigned_to is empty</span>`
              : 'Unassigned';
          })()}</dd>
          <dt>Response time</dt><dd>${n0(lead.response_time_minutes) == null
            /* Not a blank, and no longer "Not measured" either. A dash reads as
               instant; "not measured" blamed the instrument. But it is not the
               customer's fact either — see note 3 in the header. The trigger
               declines to stamp a reply that predates the lead row, so "no reply
               logged" would be a false claim about lead 35, who was in fact
               answered 74 seconds before his lead row existed. What this cell can
               say is that nothing was timed. */
            ? '<span class="t-warm">No first reply timed</span><span class="cell-sub"> · the trigger on the message history stamps this column for the first reply it can attribute to the lead, and it has not stamped this one. Usually that means nothing has gone back since the lead row was created; it can also mean the conversation started before the lead existed, which the trigger will not measure. Either way there is no measured wait here — it is not a fast reply — and the attention list cannot raise an SLA breach for it</span>'
            : `${mins(lead.response_time_minutes)} ${Number(lead.response_time_minutes) > SLA_MINUTES
                ? `<span class="t-hot">· breaches the ${SLA_MINUTES}-minute rule</span>`
                  + (Date.now() - new Date(lead.created_at).getTime() > SLA_VIEW_WINDOW_DAYS * 86400000
                    ? `<span class="cell-sub"> · the attention list will not raise it: its sla_breach arm only covers leads created in the last ${SLA_VIEW_WINDOW_DAYS} days</span>`
                    : '')
                : `<span class="t-ok">· within the ${SLA_MINUTES}-minute rule</span>`}`}</dd>
          <dt>Created</dt><dd>${ago(lead.created_at)}</dd>
        </dl>
      </div>
      <div class="section" id="dVip"></div>
      <div class="section">
        <div class="label-caps">Activity</div>
        <div id="dTimeline">${stateLoading(3)}</div>
      </div>
    </div>
    <div class="drawer-foot">
      <button class="btn" id="dWhats"><span class="material-symbols-outlined">chat</span>Open conversation</button>
      <button class="btn" id="dAssign"${canReassignLead(lead.tenant_id) ? '' : ' disabled title="Moving a lead to a different owner is an owner, admin or manager decision at this dealership. It moves commission and it moves who is answerable for the 5-minute rule."'}>Assign to…</button>
    </div>`);

  $('dClose').addEventListener('click', closeDrawer);
  $('dWhats').addEventListener('click', () => { closeDrawer(); go('conversations'); });
  /* rbac_04's leads_role_update policy carries assigned_to_id in BOTH its USING
     and its WITH CHECK for a sales login, so a rep cannot move a lead to
     anyone — not even one already theirs. The database refuses regardless of
     this line; the point of the line is that the dialog is not offered and
     then defeated. */
  if (canReassignLead(lead.tenant_id)) $('dAssign').addEventListener('click', () => assignDialog(lead));

  /* Captured NOW, before any await. See note 2 in the file header: these used to
     be looked up by global id after the reads returned, so a second click within
     one round-trip painted this lead's history into the next lead's drawer. A
     captured node that has since been replaced is detached, and writing to it is
     invisible — which is the correct outcome for a superseded load. */
  const vipBox = $('dVip');
  const timelineBox = $('dTimeline');

  /* A real email address, as opposed to whatever `leads.email` happens to hold.
     Live on 1 Sep 2026 lead 34's email column contains
     `+971547484167@whatsapp.lead` and lead 35's contains an empty string;
     neither is an address `purchase_history.email` could ever match, and issuing
     the query anyway returned zero rows that the code below then read as proof
     of a first-time buyer. */
  const realEmail = keyShape(lead.email) === KEY_SHAPE.EMAIL ? String(lead.email).toLowerCase() : '';

  const settle = r => r.status === 'fulfilled'
    ? { ok: true,  rows: r.value || [], err: null }
    : { ok: false, rows: [], err: String(r.reason?.message || r.reason).slice(0, 140) };
  const skipped = why => ({ ok: false, rows: [], err: null, skipped: why });

  /* Stage one: the `@lid` bridge, the one read that genuinely keys on an email,
     and the collision pool. This costs a round trip before the history reads, and
     it buys the only thing that can attach a LID to a person — the LID's own
     digits are a machine id and cannot be derived from a phone number — plus the
     only thing that can rule out attaching the wrong one. */
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
    /* The collision pool. See POOL_LIMIT above. */
    firstPass.suffix
      ? Promise.allSettled([db('leads?select=id,name,email,phone'
          + `&phone=like.*${encodeURIComponent(firstPass.suffix)}&limit=${POOL_LIMIT}`)])
          .then(([r]) => r)
      : Promise.resolve(null),
  ]);
  const linkErr = linkSettled.find(r => r.status === 'rejected');
  const links = linkSettled.flatMap(r => (r.status === 'fulfilled' ? (r.value || []) : []));
  const pool = poolR && poolR.status === 'fulfilled' ? (poolR.value || []) : [];
  /* A failed pool read is not "no collision". expandIdentity would then see an
     empty pool, report nothing ambiguous, and personQuery would go on to use the
     last-nine-digit patterns — the merge this read exists to prevent, arrived at
     by silence. It is disclosed in the gaps below rather than assumed away. */
  const poolErr = poolR && poolR.status === 'rejected'
    ? String(poolR.reason?.message || poolR.reason).slice(0, 140)
    : null;

  /* Stage two: the full key set, and the two reads that must use it. `personQuery`
     builds the same or=() over every key plus the last-nine-digit patterns that
     the backend matched on when it wrote them — unless the pool says two leads
     share those nine digits, in which case it drops the patterns and matches on
     exact keys only. An empty path means nothing identifies this person at all,
     which is said rather than queried around. */
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

  /* These used to be `.catch(() => [])`, and that turned every failed read into a
     confident false statement. A dead `communication_logs` fetch rendered
     "Nothing has been logged against this email address yet" — indistinguishable
     from a 500, an RLS change, or a token edge. A dead `purchase_history` fetch
     was worse: the returning-customer box collapsed to an empty string, so a
     repeat buyer silently became a first-timer with no dash and no error to
     notice. allSettled keeps the drawer opening when one read dies, and `ok`
     carries whether we actually know. `skipped` carries the third case this file
     did not have a word for until today: the read was never issued, because
     there was no usable key to issue it on. Nothing below may assert an absence
     unless its read succeeded. */
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
      ? `<div class="label-caps">Purchase history · returning customer</div>
         ${purch.map(p => `<div class="quote" style="margin-top:8px">
            <strong>${esc(p.vehicle)}</strong> · ${aed(p.amount_aed)}
            <div class="cell-sub">${esc(p.purchase_date || '')}</div></div>`).join('')}`
      : purchase.ok
        ? ''                       /* read succeeded and there are none — silence is honest */
        : purchase.skipped
          /* The read was never issued. Silence here would be the same false
             all-clear as a failed read, and for a worse reason: nobody even
             asked. */
          ? `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">warning</span>
             <div>Purchase history was not looked up for this lead. ${esc(purchase.skipped)}
             This customer is <strong>not</strong> being shown as a first-time buyer — nothing here knows either way.</div></div>`
          : `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">error</span>
             <div>Purchase history could not be read (${esc(purchase.err)}), so this customer is
             <strong>not</strong> being shown as a first-time buyer — we do not know either way.</div></div>`;
  }

  /* A message's `direction` and a workflow run's outcome are two different
     vocabularies and only one of them is tone()'s business. `tone(a.status)`
     painted a FAILED run red and a SUCCESS run green, which sounds right and is
     not: a row whose summary says a step "did not land" carries the status
     FAILED or SUCCESS according to which writer produced it, and in both cases
     the work went out half-done. lib/health.js decides that, and its wording
     goes on the row so a rep can see which. */
  /* A communication_logs row is a message to or from this customer, or it is one
     of the dealership's own internal notes written ABOUT them — see §4 above and
     lib/comm-events.js. Only the first kind may be coloured by its direction or
     called a message; the second is labelled as what it is and left neutral, so
     an escalation the dealership wrote to itself never reads as something the
     dealership said to the customer. */
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
    timelineBox.innerHTML = events.length ? `<div class="timeline">${events.map(e => `
    <div class="tl-item">
      <span class="tl-dot" style="background:var(--${esc(e.tone)})"></span>
      <div class="tl-body">
        <div class="tl-meta"><span class="chip">${esc(e.kind)}</span>${e.note
          ? ` <span class="t-${esc(e.tone)}" title="${esc(e.title)}">${esc(e.note)}</span>`
          : ''} ${ago(e.at)}</div>
        <div style="margin-top:4px;white-space:pre-wrap">${esc(String(e.text || '').slice(0, 400))}</div>
      </div>
    </div>`).join('')}</div>`
      : (comm.ok && aud.ok)
        /* The honest empty case, and it now names what was actually read.
           "Nothing has been logged against this email address" was false twice
           over for a WhatsApp-first lead: the read was not against an email
           address, and it was not against all of them. */
        ? stateEmpty('No activity recorded',
            `Nothing is logged under any of the ${ident.keys.length} ${ident.keys.length === 1 ? 'key' : 'keys'} this lead is filed under — ${ident.keys.join(', ')} — nor under the last-nine-digit rule the workflows match on.`,
            'history')
        : `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">error</span>
         <div><strong>This timeline is incomplete — it is not empty.</strong>
         ${!comm.ok ? `Messages ${comm.skipped ? 'were not read' : `could not be read (${esc(comm.err)})`}. ${comm.skipped ? esc(comm.skipped) + ' ' : ''}` : ''}
         ${!aud.ok ? `Workflow activity ${aud.skipped ? 'was not read' : `could not be read (${esc(aud.err)})`}. ` : ''}
         Do not treat this as "we have never contacted them".</div></div>`;

    /* Even a populated timeline is a lie by omission if one of its two halves
       failed, or was cut off at its ceiling, or was read on fewer keys than this
       person is filed under — the rep sees messages and concludes that is
       everything. Each of those is a different sentence because each leads
       somewhere different. */
    /* Counted once, used twice below. A history made entirely of internal notes
       is not an empty history and it is not a conversation either, and the
       timeline alone cannot say which — every row in it is labelled, but a rep
       scanning a populated-looking pane reads "we have been in touch". */
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
      timelineBox.insertAdjacentHTML('afterbegin',
        `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">warning</span>
       <div>Showing only part of the history — ${esc(gaps.join('; '))}.</div></div>`);
    }
    /* Ambiguity is not a gap; it is a decision the resolver made and refused to
       hide. Two people whose numbers end in the same nine digits, or one WhatsApp
       account carrying two email addresses, are both real here, and both are
       reasons a timeline may be shorter than the operator expects. */
    if (ident.ambiguous) {
      timelineBox.insertAdjacentHTML('afterbegin',
        `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">warning</span>
       <div>${esc(ident.ambiguity.map(a => a.message).join(' '))}</div></div>`);
    }
  }
}

async function assignDialog(lead) {
  /* Second lock on the same rule. The button above is disabled for a rep, and a
     disabled attribute is one DOM edit away from gone. */
  if (!canReassignLead(lead.tenant_id)) return;
  /* An empty roster with a live Save button was a trap: `#assignSel.value` is ''
     and Save issued PATCH {assigned_to_id: '', assigned_to: null}, silently
     UNASSIGNING the lead the operator was trying to assign. */
  let users = [], rosterErr = null;
  try { users = await db('users?select=id,name,status&order=name') || []; }
  catch (e) { rosterErr = String(e.message || e).slice(0, 140); }
  const body = $('drawer').querySelector('.drawer-body');
  if (!body) return;
  body.scrollTop = 0;
  const box = el('div', 'card');
  box.style.marginBottom = '16px';
  const canAssign = users.length > 0;
  box.innerHTML = `<div class="label-caps" style="margin-bottom:10px">Assign this lead</div>
    ${rosterErr
      ? `<div class="banner hot"><span class="material-symbols-outlined" style="font-size:20px">error</span>
         <div>The staff list could not be read (${esc(rosterErr)}), so there is nobody to pick.
         This is not an empty team — reload and try again.</div></div>`
      : !canAssign
        ? `<div class="banner warm"><span class="material-symbols-outlined" style="font-size:20px">warning</span>
           <div>There are no staff accounts to assign to.</div></div>`
        : ''}
    <select id="assignSel" ${canAssign ? '' : 'disabled'}>${users.map(u => `<option value="${esc(u.id)}" ${u.id === lead.assigned_to_id ? 'selected' : ''}>${esc(u.name)}${u.status === 'pending_invite' ? ' (pending invite)' : ''}</option>`).join('')}</select>
    <label class="cell-sub" for="assignWhy" style="display:block;margin-top:12px">Why (optional — recorded with the change)</label>
    <input id="assignWhy" type="text" maxlength="200" placeholder="e.g. customer asked for someone else" style="width:100%">
    <div style="display:flex;gap:8px;margin-top:12px">
    <button class="btn primary" id="assignGo" ${canAssign ? '' : 'disabled title="No staff list was loaded, so saving could only clear the current owner."'}>Save</button>
    <button class="btn" id="assignCancel">Cancel</button></div>
    <div class="cell-sub" id="assignMsg" style="margin-top:8px"></div>`;
  body.prepend(box);
  box.querySelector('#assignCancel').addEventListener('click', () => box.remove());
  box.querySelector('#assignGo').addEventListener('click', async () => {
    const id = box.querySelector('#assignSel').value;
    if (!id) {                          /* belt and braces: never PATCH a blank owner */
      box.querySelector('#assignMsg').innerHTML =
        '<span class="t-hot">No rep selected — refusing to save, because that would clear the current owner.</span>';
      return;
    }
    const why = (box.querySelector('#assignWhy')?.value || '').trim();
    try {
      /* rpc/nexus_lead_assign_owner, NOT a PATCH on `leads` — and the reasons
         are specific rather than stylistic. Both were measured on 7 Sep 2026.

         1. THE CHANGE IS NOW RECORDED. A direct PATCH wrote ZERO audit rows, so
            "who reassigned this lead, and when" had no answer at all (Journey
            Lab T12). A trigger on `leads` now writes lead_owner_events for every
            writer — but a trigger can only see THAT the owner changed. The
            reason travels in a transaction-local setting that PostgREST will not
            set for a browser, so it is reachable only from inside a function.
            Through this call the reason is recorded; through a PATCH it is NULL,
            and NULL honestly means nobody said.

         2. A PATCH ACCEPTS AN OWNER FROM ANOTHER DEALERSHIP. Policy
            leads_role_update constrains the lead's tenant and says nothing about
            assigned_to_id. Proved as a real signed-in manager: the PATCH filed
            one dealership's lead under another dealership's staff member. It is
            not an access leak — the lead stays put and the stranger still cannot
            read it — but the screen then names a rep nobody is accountable to.
            This function refuses it by name.

         The function is SECURITY INVOKER, so the UPDATE still runs as this user
         and the same row policy still decides who may reassign what. It is not a
         way around that rule; it is the same rule with the recording attached.

         Refusals arrive as NX001 with a sentence written for a salesperson, so
         they are shown as-is rather than being re-worded here. */
      await dbWrite('POST', 'rpc/nexus_lead_assign_owner', {
        p_lead_id: lead.id, p_to_staff_id: id, p_reason: why || null,
      });
      box.querySelector('#assignMsg').innerHTML = '<span class="t-ok">Saved. Reopen the screen to see it in the table.</span>';
    } catch (e) {
      box.querySelector('#assignMsg').innerHTML = `<span class="t-hot">${esc(e.message)}</span>`;
    }
  });
}

/* ==========================================================================
   S3 · Conversations
   ========================================================================== */

export { leadDrawer, assignDialog };
