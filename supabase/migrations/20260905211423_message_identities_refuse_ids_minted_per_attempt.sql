-- The same shape, on the three v2 message identities. Each already required a
-- trimmed, non-empty id; none of them required the id to be the PROVIDER'S.
-- whatsapp_record_customer_message warns against a per-delivery id in a hint,
-- and a hint is advice, not a guard: service_role writes these tables directly.
--
-- whatsapp_customer_message_seen is the sharpest of the three. It is the key
-- that stops a replayed message from moving last_customer_message_at forward,
-- and last_customer_message_at is the single fact that turns TEMPLATE_REQUIRED
-- into FREEFORM_ALLOWED. An id that changes per attempt defeats it completely:
-- two deliveries of one message look like two messages and the window moves to
-- now. That is NEXUS granting itself permission to send outside Meta's window.
--
-- A bare integer is refused: an n8n $execution.id, a $now.toMillis() and a unix
-- epoch are all bare integers and no WhatsApp provider id is. A uuid is NOT
-- refused here, deliberately -- unlike consent evidence, a message id is not
-- required to resolve to a row NEXUS already holds, and some providers do issue
-- uuid-shaped ids.
--
-- All three tables held zero rows when this was applied, on both projects.
alter table public.whatsapp_customer_message_seen
  add constraint wacms_extmsg_is_a_provider_id
  check (
        external_message_id !~ '[[:space:]]'
    and length(external_message_id) >= 8
    and external_message_id !~* '^(nokey:|outreach:|exec-|run-|job-)'
    and external_message_id !~ '^[0-9]+$'
  );

alter table public.channel_message_events
  add constraint cme_extmsg_is_a_provider_id
  check (
        external_message_id !~ '[[:space:]]'
    and length(external_message_id) >= 8
    and external_message_id !~* '^(nokey:|outreach:|exec-|run-|job-)'
    and external_message_id !~ '^[0-9]+$'
  );

alter table public.whatsapp_delivery_events
  add constraint wde_message_id_is_a_provider_id
  check (
        provider_message_id !~ '[[:space:]]'
    and length(provider_message_id) >= 8
    and provider_message_id !~* '^(nokey:|outreach:|exec-|run-|job-)'
    and provider_message_id !~ '^[0-9]+$'
  );

comment on constraint wacms_extmsg_is_a_provider_id on public.whatsapp_customer_message_seen is
  'The window belongs to the message, not to the delivery attempt. A minted id makes every redelivery look like a new customer message and moves the service window forward.';