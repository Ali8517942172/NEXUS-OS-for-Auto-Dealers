-- ===========================================================================
-- action_09_revoke_anon_on_action_surface
--
-- BUSINESS RULE: nothing in the Action Center is reachable without a session.
-- The tables and views were already refused to anon, but the functions were
-- not: Supabase's default privileges grant EXECUTE on new functions directly to
-- the anon role, and `revoke all ... from public` does not touch a direct grant.
-- Probed on 2026-09-02 as role anon: selects on inventory_actions,
-- v_inventory_action_queue and inventory_action_policy were all refused, and
-- action_propose('NX-1005') EXECUTED and returned a row. It returned a refusal
-- (auth.uid() is null, so the function answers NO_SESSION and writes nothing),
-- so nothing leaked - but an unauthenticated caller reaching a SECURITY DEFINER
-- function at all is a surface, and the anon key ships inside a public JS
-- bundle. Closed here.
-- ===========================================================================
revoke execute on function public.action_approver_context()                       from anon;
revoke execute on function public.action_propose(text)                            from anon;
revoke execute on function public.action_decide(uuid, text, text, text, date, uuid) from anon;
revoke execute on function public.action_mark_executed(uuid, text, boolean, text)   from anon;
revoke execute on function public.action_outcome_candidates(uuid)                  from anon;
revoke execute on function public.action_record_outcome(uuid, uuid, text)          from anon;
revoke execute on function public.action_mark_not_attributable(uuid, text)         from anon;
revoke execute on function public.action_cancel(uuid, text)                        from anon;
revoke execute on function public.action_write_audit(uuid, uuid, text, text, text, text) from anon;
revoke execute on function public.inventory_actions_touch()                        from anon;