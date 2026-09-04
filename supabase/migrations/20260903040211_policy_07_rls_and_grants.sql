-- ===========================================================================
-- POLICY ENGINE — 07 · row-level security and the grants underneath it
--
-- BUSINESS RULE
-- A dealership sees the rules that apply to it: the global ones (which carry no
-- tenant data, so nothing leaks) and its own. It never sees another
-- dealership's commercial rules. And it never WRITES the table directly: the
-- only way in is through the policy_* functions, which check authority first.
--
-- WHY THE REVOKES ARE SPELLED OUT TWICE
-- Supabase's default privileges grant DIRECTLY to anon and authenticated on
-- every new object in public — all privileges (arwdDxtm) on tables, EXECUTE on
-- functions — and a direct ACL entry is a SEPARATE ROW from the PUBLIC one, so
-- `revoke ... from public` alone does not remove it. That shape has opened five
-- holes in this project. `inventory_profit_settings` still carries
-- `authenticated=arwdDxtm` today for exactly this reason. So: revoke from anon
-- AND authenticated AND public first, then grant back only what a real reader
-- needs, then READ THE ACL BACK — a grant statement is not evidence.
--
-- THE READERS, established before revoking rather than guessed at:
--   authenticated — the dashboard. It must SELECT the views and EXECUTE the
--                   readers and the propose/verify RPCs. It gets no direct
--                   table write.
--   service_role  — n8n. Full access; it is the platform.
--   anon          — has no reason to read a policy rule. Nothing anonymous in
--                   this product needs to know a dealership's LTV cap. Revoked.
-- ===========================================================================

alter table public.policy_rule       enable row level security;
alter table public.policy_rule_event enable row level security;

-- ── policy_rule ───────────────────────────────────────────────────────────
drop policy if exists policy_rule_authenticated_read on public.policy_rule;
create policy policy_rule_authenticated_read on public.policy_rule
  for select to authenticated
  using (
    tenant_id is null                                    -- global rule: applies to everyone
    or tenant_id in (select public.nexus_current_tenant_ids())
  );

drop policy if exists policy_rule_service_role_all on public.policy_rule;
create policy policy_rule_service_role_all on public.policy_rule
  for all to service_role using (true) with check (true);

-- RESTRICTIVE, so it cannot be widened by adding another permissive policy.
drop policy if exists policy_rule_deny_anon on public.policy_rule;
create policy policy_rule_deny_anon on public.policy_rule
  as restrictive for all to anon using (false) with check (false);

-- ── policy_rule_event ─────────────────────────────────────────────────────
drop policy if exists policy_rule_event_authenticated_read on public.policy_rule_event;
create policy policy_rule_event_authenticated_read on public.policy_rule_event
  for select to authenticated
  using (
    tenant_id is null
    or tenant_id in (select public.nexus_current_tenant_ids())
  );

drop policy if exists policy_rule_event_service_role_all on public.policy_rule_event;
create policy policy_rule_event_service_role_all on public.policy_rule_event
  for all to service_role using (true) with check (true);

drop policy if exists policy_rule_event_deny_anon on public.policy_rule_event;
create policy policy_rule_event_deny_anon on public.policy_rule_event
  as restrictive for all to anon using (false) with check (false);

-- ── tables: revoke both the direct grants and the PUBLIC one ──────────────
revoke all on public.policy_rule       from anon, authenticated, public;
revoke all on public.policy_rule_event from anon, authenticated, public;
grant select on public.policy_rule       to authenticated;
grant select on public.policy_rule_event to authenticated;
grant select, insert, update, delete on public.policy_rule       to service_role;
grant select, insert, update, delete on public.policy_rule_event to service_role;

-- ── views ─────────────────────────────────────────────────────────────────
revoke all on public.v_policy_rule          from anon, public;
revoke all on public.v_policy_authoritative from anon, public;
revoke all on public.v_policy_rule_history  from anon, public;
grant select on public.v_policy_rule          to authenticated, service_role;
grant select on public.v_policy_authoritative to authenticated, service_role;
grant select on public.v_policy_rule_history  to authenticated, service_role;

-- ── functions: EXECUTE is granted to anon by default, on every one ────────
revoke execute on function public.policy_authority(text,text,date,date,date)                    from anon, public;
revoke execute on function public.policy_numeric(text,text,text)                                from anon, public;
revoke execute on function public.policy_numeric_as_of(text,text,text,date)                     from anon, public;
revoke execute on function public.policy_citation(text,text,text)                               from anon, public;
revoke execute on function public.policy_read_unverified_rule(text,text,text)                   from anon, public;
revoke execute on function public.policy_propose_rule(text,text,text,text,text,numeric,text,text,text,date,text) from anon, public;
revoke execute on function public.policy_verify_rule(uuid,text,text,text,date,text,text)        from anon, public;
revoke execute on function public.policy_supersede_rule(uuid,date,text,numeric,text,text,text,text) from anon, public;
revoke execute on function public.policy_withdraw_rule(uuid,text)                               from anon, public;

-- The three guard triggers run as their owner; nothing outside the table needs
-- to call them, and a direct anon EXECUTE on a SECURITY DEFINER trigger
-- function is exactly the shape that has opened holes here before.
revoke execute on function public.policy_rule_guard_immutability()  from anon, authenticated, public;
revoke execute on function public.policy_rule_guard_one_active()    from anon, authenticated, public;
revoke execute on function public.policy_rule_event_append_only()   from anon, authenticated, public;

grant execute on function public.policy_authority(text,text,date,date,date)                    to authenticated, service_role;
grant execute on function public.policy_numeric(text,text,text)                                to authenticated, service_role;
grant execute on function public.policy_numeric_as_of(text,text,text,date)                     to authenticated, service_role;
grant execute on function public.policy_citation(text,text,text)                               to authenticated, service_role;
grant execute on function public.policy_read_unverified_rule(text,text,text)                   to authenticated, service_role;
grant execute on function public.policy_propose_rule(text,text,text,text,text,numeric,text,text,text,date,text) to authenticated, service_role;
grant execute on function public.policy_verify_rule(uuid,text,text,text,date,text,text)        to authenticated, service_role;
grant execute on function public.policy_supersede_rule(uuid,date,text,numeric,text,text,text,text) to authenticated, service_role;
grant execute on function public.policy_withdraw_rule(uuid,text)                               to authenticated, service_role;
