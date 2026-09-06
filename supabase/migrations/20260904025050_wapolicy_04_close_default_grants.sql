-- Supabase's default privileges grant anon AND authenticated directly on
-- everything created in public: EXECUTE on every function, and arwdDxtm on
-- every table and view - which includes TRUNCATE, and RLS does not apply to
-- TRUNCATE. Nothing in the migrations above wrote those grants; they arrive
-- on their own. REVOKE ... FROM PUBLIC does not remove a direct grant, so
-- each role is named explicitly alongside public.
--
-- Reader and writer established before revoking: there is NO authenticated
-- consumer of this engine. It is not referenced by apps/executive-dashboard
-- (no screen, no rpc/* call, no dist bundle reference - the engine was
-- created today). The only intended caller is n8n / the Cloud API adapter,
-- which connects as service_role. So revoking authenticated costs nothing
-- that exists. Adding a dashboard reader later is a deliberate GRANT plus an
-- RLS policy, not a default.

revoke all on public.whatsapp_conversation_state    from anon, authenticated, public;
revoke all on public.whatsapp_opt_in_event          from anon, authenticated, public;
revoke all on public.whatsapp_message_intent        from anon, authenticated, public;
revoke all on public.v_whatsapp_conversation_window from anon, authenticated, public;

grant select, insert, update, delete on public.whatsapp_conversation_state to service_role;
grant select, insert                 on public.whatsapp_opt_in_event       to service_role;
grant select                         on public.whatsapp_message_intent     to service_role;
grant select                         on public.v_whatsapp_conversation_window to service_role;

revoke all on function public.whatsapp_policy_rule_lookup(uuid,text,text,date)                     from anon, authenticated, public;
revoke all on function public.whatsapp_policy_decision(uuid,uuid,text,text,timestamptz)            from anon, authenticated, public;
revoke all on function public.whatsapp_policy_decision_for_channel(text,text,text,text,timestamptz) from anon, authenticated, public;
revoke all on function public.whatsapp_record_customer_message(uuid,uuid,text,timestamptz,text,text) from anon, authenticated, public;
revoke all on function public.whatsapp_record_opt_in_event(uuid,uuid,text,text,timestamptz,text,text,text,text,text) from anon, authenticated, public;
revoke all on function public.whatsapp_opt_in_event_append_only()                                  from anon, authenticated, public;

grant execute on function public.whatsapp_policy_rule_lookup(uuid,text,text,date)                     to service_role;
grant execute on function public.whatsapp_policy_decision(uuid,uuid,text,text,timestamptz)            to service_role;
grant execute on function public.whatsapp_policy_decision_for_channel(text,text,text,text,timestamptz) to service_role;
grant execute on function public.whatsapp_record_customer_message(uuid,uuid,text,timestamptz,text,text) to service_role;
grant execute on function public.whatsapp_record_opt_in_event(uuid,uuid,text,text,timestamptz,text,text,text,text,text) to service_role;

-- The composite return type: PUBLIC gets USAGE on a new type by default.
revoke usage on type public.whatsapp_policy_decision_row from anon, authenticated, public;
grant  usage on type public.whatsapp_policy_decision_row to service_role;