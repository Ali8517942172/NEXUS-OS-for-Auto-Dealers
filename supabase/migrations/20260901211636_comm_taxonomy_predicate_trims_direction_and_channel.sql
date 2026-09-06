-- Business rule: whitespace around a channel or direction name must never
-- decide whether a customer's message counts as a message.
--
-- lib/comm-events.js normalises direction and channel with .trim().toLowerCase();
-- this function used lower() alone. A row written as ' outbound' or 'whatsapp '
-- was therefore a message in the browser and an internal note in the view — the
-- exact disagreement the shared predicate exists to prevent, and one no caption
-- could disclose because neither side knew the other differed.
--
-- The body test stays UNTRIMMED on both sides: LIKE does not trim, and a marker
-- written with a leading space must be an internal note in both places. Only the
-- two enum-like columns are trimmed.
--
-- Live 2026-09-01: 0 of 99 rows carry padded direction or channel, so this widens
-- the recognised set by zero rows today. It is a structural correction, not a
-- repair — no figure on any screen moves.
create or replace function public.nexus_is_message(
  p_direction text, p_channel text, p_message text
) returns boolean
language sql immutable as $$
  select btrim(lower(coalesce(p_direction, ''))) in ('inbound', 'outbound')
     and btrim(lower(coalesce(p_channel,   ''))) in ('whatsapp', 'email', 'sms')
     and coalesce(p_message, '') not like '[system]%'
     and coalesce(p_message, '') not like '[SILENCE-%';
$$;

comment on function public.nexus_is_message(text, text, text) is
'The single definition of "is this row a message to or from a customer".
Mirrored line for line by apps/executive-dashboard/lib/comm-events.js.
Direction and channel are trimmed and lowercased; the message body is tested
untrimmed, because SQL LIKE does not trim and the browser mirror must not either.
A [system] or [SILENCE- row is the dealership talking to itself: never a message,
never a reply, never a last contact.';