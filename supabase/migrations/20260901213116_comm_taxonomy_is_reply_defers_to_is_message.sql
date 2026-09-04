-- Business rule: a reply is a message that we sent. It is not a second,
-- separately-worded rule that happens to agree with the first one.
--
-- comm_taxonomy_predicate_trims_direction_and_channel trimmed direction and
-- channel in nexus_is_message and left nexus_is_reply on the untrimmed spelling.
-- That opened a gap I created: a row written as ' outbound' counted as a message
-- everywhere and as a non-reply here, and nexus_is_reply is the gate on
-- nexus_mark_first_response — so that customer's reply would never have started
-- the response clock, and response_time_minutes would have stayed NULL with
-- nothing on any screen able to say why.
--
-- Rewritten to DELEGATE rather than restate. There is now one message rule in
-- this database, and a reply is that rule plus a direction test. The two cannot
-- drift again, because there is no longer a second copy to forget.
--
-- Live 2026-09-01: 0 of 99 rows carry padded direction or channel, so no reply
-- classification changes and no response time moves. Structural, not a repair.
create or replace function public.nexus_is_reply(
  p_direction text, p_channel text, p_message text
) returns boolean
language sql immutable as $$
  select public.nexus_is_message(p_direction, p_channel, p_message)
     and btrim(lower(coalesce(p_direction, ''))) = 'outbound';
$$;

comment on function public.nexus_is_reply(text, text, text) is
'A reply is a message (public.nexus_is_message) that we sent. Defined by
delegation, never by restating the message rule, so the two cannot drift.
Gates public.nexus_mark_first_response, which owns response_time_minutes.
Mirrored in the browser by isReply/isOutboundMessage in
apps/executive-dashboard/lib/comm-events.js, which is built the same way.';