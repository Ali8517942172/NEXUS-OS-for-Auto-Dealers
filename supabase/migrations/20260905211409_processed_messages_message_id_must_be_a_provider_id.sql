-- processed_messages is the AI agent's "have I already answered this message?"
-- claim. Its live writer mints 'nokey:' || $now.toMillis() when the provider
-- gave no id, so every retry of one message claims a FRESH identity and the
-- agent answers the customer again. An id minted per attempt is the opposite of
-- an identity. Refuse it in the key's own table, so that no writer can restore
-- the defect by choosing a different prefix, and so that the refusal survives
-- a workflow re-import.
--
-- A bare integer is refused outright: an n8n $execution.id, a $now.toMillis()
-- and a unix epoch are all bare integers, and no WhatsApp provider message id
-- ever is. Measured against all 73 live rows before applying: shortest 44
-- characters, none with whitespace, none minted, none numeric.
alter table public.processed_messages
  add constraint processed_messages_message_id_is_a_provider_id
  check (
        message_id !~ '[[:space:]]'
    and length(message_id) >= 8
    and message_id !~* '^(nokey:|outreach:|exec-|run-|job-)'
    and message_id !~ '^[0-9]+$'
  );

comment on constraint processed_messages_message_id_is_a_provider_id on public.processed_messages is
  'The identity is the message, not the attempt. Send the provider''s own id (WAHA payload.id, Cloud API wamid). If the provider gave none, do not claim one: a minted id makes every retry look new and the agent answers twice.';