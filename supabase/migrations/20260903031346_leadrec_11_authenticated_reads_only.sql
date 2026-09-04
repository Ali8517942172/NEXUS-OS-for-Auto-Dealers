-- LEAD RECOVERY ENGINE — 11: close the grant Supabase wrote for us.
--
-- Measured immediately after migration 10: every lead_recovery_* table carried
-- authenticated=arwdDxtm - SELECT *and* INSERT/UPDATE/DELETE. Nobody wrote that
-- grant; Supabase's default privileges did, at CREATE TABLE time. `grant select`
-- in the creating migration ADDED to it instead of replacing it, and
-- `revoke all ... from anon, public` never touched it because a direct
-- authenticated= entry is a separate ACL row.
--
-- Nothing leaked: the only permissive policy for authenticated on these tables is
-- FOR SELECT, so an UPDATE would have found no policy and been refused. But that
-- is one lock, and CLAUDE.md is explicit that an incidental single lock does not
-- hold - a later "authenticated can update its own row" policy, added in good
-- faith, would have opened a live hole with no grant-shaped diff to review,
-- because the grant was already sitting there. An authenticated session that
-- could UPDATE lead_recovery_actions directly could stamp itself as the approver
-- of its own proposal and skip action_approver_context() entirely.
--
-- inventory_actions carries authenticated=r. Match it.

revoke all on public.lead_recovery_actions        from authenticated;
revoke all on public.lead_recovery_action_events  from authenticated;
revoke all on public.lead_recovery_reason_codes   from authenticated;
revoke all on public.lead_recovery_settings       from authenticated;
revoke all on public.lead_recovery_states         from authenticated;
revoke all on public.v_lead_recovery              from authenticated;
revoke all on public.v_lead_recovery_queue        from authenticated;
revoke all on public.v_lead_recovery_health       from authenticated;
revoke all on public.v_lead_recovery_coverage     from authenticated;
revoke all on public.v_lead_recovery_state_model  from authenticated;

grant select on public.lead_recovery_actions        to authenticated;
grant select on public.lead_recovery_action_events  to authenticated;
grant select on public.lead_recovery_reason_codes   to authenticated;
grant select on public.lead_recovery_settings       to authenticated;
grant select on public.lead_recovery_states         to authenticated;
grant select on public.v_lead_recovery              to authenticated;
grant select on public.v_lead_recovery_queue        to authenticated;
grant select on public.v_lead_recovery_health       to authenticated;
grant select on public.v_lead_recovery_coverage     to authenticated;
grant select on public.v_lead_recovery_state_model  to authenticated;

-- And re-assert the anon/PUBLIC revoke on everything in one place, so a future
-- reader can see the whole surface closed in a single statement block rather
-- than scattered across ten migrations.
revoke all on public.lead_recovery_actions, public.lead_recovery_action_events,
              public.lead_recovery_reason_codes, public.lead_recovery_settings,
              public.lead_recovery_states, public.v_lead_recovery,
              public.v_lead_recovery_queue, public.v_lead_recovery_health,
              public.v_lead_recovery_coverage, public.v_lead_recovery_state_model
  from anon, public;