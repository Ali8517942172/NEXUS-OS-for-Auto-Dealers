-- COMMUNICATION EVENT TAXONOMY (1 Sep 2026)
-- =========================================================================
-- BUSINESS RULE
--
-- communication_logs is an EVENT log, not a message log. Two different kinds
-- of row live in it and only one of them is a conversation:
--
--   MESSAGE   something a customer said to us, or we said to a customer.
--             It is on a customer-facing channel (whatsapp | email | sms),
--             its direction is inbound or outbound, and its body is not one
--             of the dealership's own internal markers.
--
--   INTERNAL  the dealership's own bookkeeping, written ABOUT a conversation
--             rather than inside it. The 12-hour silence detector is the live
--             example: it writes a row BECAUSE nobody replied. Recognisable by
--             any one of three marks, because the detector has been deployed
--             two different ways and rows of both vintages are on file:
--               channel  = 'system'
--               direction= 'internal'
--               message   begins '[SILENCE-' or '[system]'
--             An internal row is NOT a message, NOT a reply, and must NEVER
--             date a customer's last contact. Dating a contact from a silence
--             marker prints the moment we recorded that nobody was in touch as
--             the moment somebody was.
--
-- DERIVED KINDS
--   inbound message  = message AND direction 'inbound'   (from the customer)
--   outbound message = message AND direction 'outbound'  (from us)
--   reply            = outbound message                  ( = nexus_is_reply)
--   last_contact_at  = max(created_at) over MESSAGES, either direction
--
-- nexus_is_reply() already encoded half of this and was the only place in the
-- system that knew about '[system]%'. nexus_is_message() is the whole of it,
-- and by construction
--     nexus_is_reply(d,c,m)  ===  nexus_is_message(d,c,m) AND lower(d)='outbound'
-- so the two can never drift apart again.
--
-- The three consumers that each carried their own half-rule in JavaScript --
-- screens/customers.js ('[SILENCE-' prefix only), screens/conversations.js
-- (channel/direction/'[SILENCE-ESCALATED]') and screens/overview.js
-- (channel/direction only) -- now read this predicate's answer through the
-- views below instead of guessing at it separately.
-- =========================================================================

create or replace function public.nexus_is_message(
  p_direction text, p_channel text, p_message text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_direction, '')) in ('inbound', 'outbound')
     and lower(coalesce(p_channel, ''))   in ('whatsapp', 'email', 'sms')
     and coalesce(p_message, '') not like '[system]%'
     and coalesce(p_message, '') not like '[SILENCE-%';
$$;

comment on function public.nexus_is_message(text, text, text) is
  'TRUE when a communication_logs row is a message to or from a customer. FALSE '
  'for the dealership''s own internal markers (silence escalations, [system] '
  'notes, channel=system, direction=internal). The single definition of "a '
  'message"; last_contact_at, message counts and reply counts are all computed '
  'over the rows this returns TRUE for. nexus_is_reply() is this predicate '
  'restricted to direction=outbound.';
