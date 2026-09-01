/* NEXUS OS — lib/comm-events.js
   The communication-event taxonomy, in one place.

   WHY THIS FILE EXISTS (1 Sep 2026)
   ---------------------------------
   `communication_logs` is an EVENT log, not a message log. Two incompatible
   kinds of row live in it and only one of them is a conversation:

     MESSAGE   something a customer said to us, or we said to a customer. On a
               customer-facing channel (whatsapp | email | sms), direction
               inbound or outbound, body not one of our own internal markers.

     INTERNAL  the dealership's own bookkeeping, written ABOUT a conversation
               rather than inside it. The 12-hour silence detector is the live
               example: it writes a row BECAUSE nobody replied. An internal row
               is not a message, not a reply, and must never date a customer's
               last contact — doing that prints the moment we recorded that
               nobody was in touch as the moment somebody was. It is exactly how
               Siva Thangavelu's last contact came to read 5 d ago (the marker,
               26 Aug 19:03) instead of 6 d ago (his last real message,
               26 Aug 06:12).

   Before this file, four consumers each carried a different half of the rule
   and none of them matched the database:

     screens/customers.js     message begins '[SILENCE-'            (text only)
     screens/conversations.js channel/direction OR '[SILENCE-ESCALATED]', trimmed
     screens/overview.js      channel in {system,internal} or direction internal
                              — text not tested at all
     screens/campaigns.js     message begins '[SILENCE-ESCALATED]'  (text only)
     SQL nexus_is_reply()     outbound + channel whitelist + not '[system]%'
                              + not '[SILENCE-%'   — the only one that knew
                                about '[system]'

   Each of those is enough for the two marker rows on file today, which carry
   every mark at once. None of them is enough for a row that carries only one,
   and a row that is internal by one mark and a message by another is drawn on
   this dashboard as something a customer said.

   THE CANONICAL DEFINITION IS THE DATABASE'S.
   `public.nexus_is_message(direction, channel, message)`, added by migration
   `comm_taxonomy_message_predicate`, is the rule. The predicates below are a
   line-for-line mirror of it so a row read straight out of communication_logs
   in the browser gets the same verdict the views give it. When the SQL changes,
   change this file in the same commit — nothing enforces the mirror at runtime.

   SQL, for comparison:

     lower(coalesce(direction,'')) in ('inbound','outbound')
     and lower(coalesce(channel,''))  in ('whatsapp','email','sms')
     and coalesce(message,'') not like '[system]%'
     and coalesce(message,'') not like '[SILENCE-%'

   Two deliberate details, both of which were wrong somewhere before:

   · The marker text is tested WITHOUT trimming, because SQL LIKE does not trim
     either. conversations.js used `trimStart()`, so a marker written with a
     leading space would have been internal in the browser and a message in the
     view, and every caption claiming the two sides select the same rows would
     have been false. Live 1 Sep 2026: 0 rows have leading whitespace, so the
     two spellings do select identically today — which is why this is a choice
     that can still be made rather than a change of behaviour.

   · '[SILENCE-' is the prefix, not '[SILENCE-ESCALATED]'. The detector's
     escalation is the only spelling on file, but the SQL has always matched the
     shorter prefix and a browser that matched the longer one would disagree
     with the database the first time a second marker kind is written. */

/* Customer-facing channels. A row on any other channel — `system` today — is
   the dealership talking to itself. */
export const MESSAGE_CHANNELS = new Set(['whatsapp', 'email', 'sms']);
/* Directions a message can carry. The silence detector's current build writes
   `internal`; the two rows written before that fix carry `outbound`, which is
   why the channel and the text are tested as well and not instead. */
export const MESSAGE_DIRECTIONS = new Set(['inbound', 'outbound']);
/* Body prefixes that mark a row as our own note. Matched untrimmed, as LIKE
   does. `[Customer sent a document image]` is NOT one of these and is a real
   inbound message — the placeholder the WhatsApp bridge writes for media. */
export const MARKER_PREFIXES = ['[system]', '[SILENCE-'];
/* The silence escalation specifically, for prose that names it. Not a test. */
export const SILENCE_MARKER = '[SILENCE-ESCALATED]';

const low = v => String(v == null ? '' : v).trim().toLowerCase();
const body = v => String(v == null ? '' : v);

/* Does this body carry one of our internal markers? Text only — a row can be
   internal by its channel or direction with an ordinary body, so this is never
   the whole test on a row. It is the whole test available on
   `v_conversations.last_message`, which is a string and not a row. */
export const isMarkerText = v => MARKER_PREFIXES.some(p => body(v).startsWith(p));

/* Is this whole row a message to or from a customer?
   The mirror of nexus_is_message(). Takes a communication_logs row. */
export const isMessageRow = r => !!r
  && MESSAGE_DIRECTIONS.has(low(r.direction))
  && MESSAGE_CHANNELS.has(low(r.channel))
  && !isMarkerText(r.message);

/* The complement, named for what it is rather than as a negation, because that
   is how the screens talk about it. */
export const isInternalRow = r => !isMessageRow(r);

/* From the customer. */
export const isInboundMessage = r => isMessageRow(r) && low(r.direction) === 'inbound';
/* From us. Identical to nexus_is_reply() by construction: that function is
   nexus_is_message() restricted to outbound, and this is the same restriction
   on the same predicate. A reply is an outbound message; there is no separate
   reply test and there must never be one. */
export const isOutboundMessage = r => isMessageRow(r) && low(r.direction) === 'outbound';
export const isReply = isOutboundMessage;

/* The last moment this person was actually in contact, either direction.
   `rows` is any array of communication_logs rows in any order; internal rows
   are excluded, and null is returned when nothing in the array is a message —
   which is a different answer from "no rows", and callers are expected to say
   so rather than printing a blank. */
export function lastContactAt(rows) {
  let best = null;
  (rows || []).forEach(r => {
    if (!isMessageRow(r)) return;
    const t = Date.parse(r && r.created_at);
    if (!Number.isFinite(t)) return;
    if (best == null || t > best.t) best = { t, at: r.created_at };
  });
  return best ? best.at : null;
}

/* Split an array of rows into the two kinds, plus the counts every screen was
   deriving separately. One pass, one vocabulary. */
export function splitEvents(rows) {
  const messages = [], internal = [];
  (rows || []).forEach(r => (isMessageRow(r) ? messages : internal).push(r));
  const inbound = messages.filter(m => low(m.direction) === 'inbound').length;
  return {
    messages,
    internal,
    count: messages.length,
    inbound,
    outbound: messages.length - inbound,
    internalCount: internal.length,
    lastContactAt: lastContactAt(messages),
  };
}

/* How many of the internal rows are silence escalations, for prose that wants
   to name the reason rather than say "internal" and leave the reader to guess.
   Returned as a count so a caller can distinguish "all of them are silence
   markers" from "some of them are something else this screen cannot name" —
   the second is a real possibility (channel='system' with an ordinary body) and
   a caption that asserts the first without checking would be wrong the day it
   happens. */
export const silenceCount = rows =>
  (rows || []).filter(r => body(r && r.message).startsWith('[SILENCE-')).length;
