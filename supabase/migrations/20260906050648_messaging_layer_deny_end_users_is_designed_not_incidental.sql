-- F3 -- a dealership cannot read its own consent, message or delivery rows.
--
-- MEASURED CONCLUSION: the refusal is CORRECT and NO GRANT IS OPENED HERE.
--
-- What the proof reported as a defect is a screen that does not exist reading a
-- table that holds no rows. Measured 6 Sep 2026:
--
--   * The Conversations screen reads `v_conversations` and nothing else.
--     `grep -rn` across apps/executive-dashboard/screens and lib finds zero
--     query against whatsapp_opt_in_event, channel_message_events or
--     whatsapp_delivery_events; the single mention of channel_message_events is
--     a glossary entry in lib/vocabulary.js.
--   * A dealership DOES see its own WhatsApp history, and does so today:
--     production v_conversations = 13 rows, communication_logs = 114, both
--     `authenticated=r` with a tenant_id-scoped RLS SELECT policy.
--   * The three refused tables hold ZERO rows on production and on staging.
--
-- So opening a grant would be designing a projection against no rows, for no
-- caller, to fix no symptom. The precedent that would apply when a caller exists
-- is channel_registry -- a COLUMN-level grant withholding credential_ref -- and
-- it should be applied then, to the columns a dealership legitimately needs,
-- not now to whole tables.
--
-- WHAT THIS MIGRATION DOES INSTEAD, and it is a tightening, never a widening.
--
-- The sweep that established the above found an asymmetry worth closing.
-- channel_message_events, whatsapp_delivery_events and whatsapp_customer_message_seen
-- each carry a RESTRICTIVE `_deny_end_users` policy naming anon AND authenticated
-- -- a designed floor that holds even if somebody later adds a grant or a
-- permissive policy by accident. Seven sibling tables in the same never-fired
-- messaging layer carry no such floor. They are closed today only because no
-- grant exists and no permissive policy names authenticated: RLS default-deny.
-- That is an incidental lock, and CLAUDE.md already records what incidental
-- locks are worth -- anon INSERT on all 16 tables was once "refused" by a column
-- default rather than by any privilege, and would have opened with no
-- grant-shaped and no policy-shaped diff to review.
--
-- whatsapp_opt_in_event is the one that matters most. It is the consent record.
-- A single accidental `grant select` plus one permissive policy is the distance
-- between today and a dealership reading, or a future permissive policy
-- exposing, who said STOP -- and this layer's whole safety argument rests on
-- that table. It gets the same designed floor its three closest siblings have.
--
-- Nothing here changes what any role can currently do: all seven tables already
-- return 42501 to anon and to authenticated by grant, service_role is not named
-- in any of these policies and is unaffected, and no permissive policy is added,
-- removed or altered. Both facts are proved by probe either side of this change.

do $$
declare t text;
begin
  foreach t in array array[
      'whatsapp_opt_in_event',
      'whatsapp_conversation_state',
      'whatsapp_message_intent',
      'channel_provider_capability',
      'channel_provider_rank',
      'channel_send_directive',
      'channel_send_form'
  ] loop
    -- Refuse to run if the table has grown an end-user reader since this was
    -- written. A floor is only safe to lay where nobody is standing.
    if has_table_privilege('authenticated', format('public.%I', t)::regclass, 'SELECT')
       or has_any_column_privilege('authenticated', format('public.%I', t)::regclass, 'SELECT')
       or has_table_privilege('anon', format('public.%I', t)::regclass, 'SELECT')
       or has_any_column_privilege('anon', format('public.%I', t)::regclass, 'SELECT') then
      raise exception
        'public.% now grants SELECT to an end-user role; a RESTRICTIVE deny would break that reader. Establish who reads it before laying this floor.', t
        using errcode = '42501';
    end if;

    execute format(
      'create policy %I on public.%I as restrictive for all to anon, authenticated using (false) with check (false)',
      t || '_deny_end_users', t);
  end loop;
end $$;

comment on policy whatsapp_opt_in_event_deny_end_users on public.whatsapp_opt_in_event is
  'The designed floor under the consent record. whatsapp_opt_in_event was previously closed to signed-in users only by the ABSENCE of a grant and the absence of a permissive policy -- an incidental lock, where channel_message_events, whatsapp_delivery_events and whatsapp_customer_message_seen each already carried this explicit RESTRICTIVE deny. Consent is the fact that turns BLOCKED / CUSTOMER_OPTED_OUT into FREEFORM_ALLOWED, so accidental exposure of this table is the difference between honouring a STOP and messaging someone who sent one. When a dealership legitimately needs to see its own consent state, add a column-level projection on the channel_registry pattern -- withholding what is mechanism rather than symptom -- do not drop this policy.';