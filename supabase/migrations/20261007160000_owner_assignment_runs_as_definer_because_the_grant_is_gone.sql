-- Owner assignment was broken by privilege. 7 October 2026.
--
-- Measured on production before this migration:
--   has_table_privilege('authenticated','leads','UPDATE')      false
--   has_any_column_privilege('authenticated','leads','UPDATE') false
--   nexus_lead_assign_owner.prosecdef                          false
-- The column-level UPDATE grant on leads was revoked (by hand, outside the held
-- migration 20260908090000) while this function was still SECURITY INVOKER, so
-- its UPDATE ran as the caller and failed 42501 before any policy was read.
-- Every reassignment from the dashboard failed.
--
-- Of the two options CLAUDE.md names, this takes option 1: SECURITY DEFINER.
-- Option 2 (put the grant back) re-opens the measured cross-dealership defect:
-- leads_role_update's WITH CHECK says nothing about assigned_to_id, so a direct
-- PATCH can file one dealership's lead under another dealership's staff.
--
-- The cost of option 1, stated rather than hidden: a definer function bypasses
-- RLS, so this function now carries its own copy of leads_role_update. The copy
-- is built from the SAME three helpers the policy calls
-- (nexus_current_tenant_ids, nexus_tenant_ids_for_roles, nexus_my_staff_user_ids)
-- and applies the policy's predicate twice, exactly as Postgres does: once to the
-- row as it stands (USING) and once to the row as it will be (WITH CHECK). If
-- leads_role_update changes, this function must change with it.
--
-- service_role keeps the behaviour it had under INVOKER: it bypassed RLS then
-- and it is not asked for a person's role now. The same-dealership owner check
-- still applies to it.
--
-- Nothing else moves: same signature, same return shape, same NX001 refusals and
-- the same audit trigger (nexus_leads_owner_change_audit_trg), which derives the
-- actor from current_setting('role') and so still sees 'authenticated' here.

create or replace function public.nexus_lead_assign_owner(
  p_lead_id integer, p_to_staff_id uuid, p_reason text default null)
returns table(lead_id integer, from_staff_id uuid, to_staff_id uuid, event text, reason text)
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  v_tenant  uuid;
  v_from    uuid;
  v_n       integer;
  v_service boolean := coalesce(current_setting('role', true), '') = 'service_role';
  v_manager boolean;
  v_rep     boolean;
begin
  if not v_service and auth.uid() is null then
    raise exception using errcode = 'NX001',
      message = 'Sign in to change the owner of a lead.',
      detail  = 'NO_SESSION',
      hint    = 'This action is taken by a signed-in member of the dealership.';
  end if;

  -- Visibility. A definer reads past RLS, so the tenant predicate is written into
  -- the statement. Not-found and another dealership's lead give the same answer:
  -- distinguishing the two tells an outsider which lead ids are real.
  select l.tenant_id, l.assigned_to_id into v_tenant, v_from
    from public.leads l
   where l.id = p_lead_id
     and (v_service or l.tenant_id in (select public.nexus_current_tenant_ids()));
  if not found then
    raise exception using errcode = 'NX001',
      message = 'That lead is not available to your account.',
      detail  = 'LEAD_NOT_VISIBLE',
      hint    = 'Either it does not exist or it belongs to another dealership. This answer is deliberately the same for both.';
  end if;

  if p_to_staff_id is not null then
    perform 1 from public.users u where u.id = p_to_staff_id and u.tenant_id = v_tenant;
    if not found then
      raise exception using errcode = 'NX001',
        message = 'That person is not staff at this dealership.',
        detail  = 'OWNER_NOT_IN_THIS_DEALERSHIP',
        hint    = 'A lead can only be owned by staff of the dealership it belongs to.';
    end if;
  end if;

  if not v_service then
    -- leads_role_update, USING half: may this caller touch the row as it stands?
    v_manager := v_tenant in (select public.nexus_tenant_ids_for_roles(array['owner','admin','manager']));
    v_rep     := v_tenant in (select public.nexus_tenant_ids_for_roles(array['sales','member']));
    if not (v_manager
            or (v_rep and v_from is not null
                and v_from in (select public.nexus_my_staff_user_ids()))) then
      raise exception using errcode = 'NX001',
        message = 'Your account is not allowed to change the owner of this lead.',
        detail  = 'NOT_ALLOWED_TO_REASSIGN',
        hint    = 'Owners, admins and managers may reassign any lead in the dealership. Sales and member accounts may only reassign a lead already assigned to them.';
    end if;
    -- leads_role_update, WITH CHECK half: may the row as it will be exist?
    -- For a rep that means the new owner is themselves.
    if not (v_manager
            or (v_rep and p_to_staff_id is not null
                and p_to_staff_id in (select public.nexus_my_staff_user_ids()))) then
      raise exception using errcode = 'NX001',
        message = 'Your account is not allowed to give this lead to someone else.',
        detail  = 'NOT_ALLOWED_TO_REASSIGN',
        hint    = 'Sales and member accounts may keep a lead assigned to themselves. Ask an owner, admin or manager to hand it to another person.';
    end if;
  end if;

  -- The seam the audit trigger reads. Transaction-local.
  perform set_config('nexus.change_reason',
                     coalesce(nullif(btrim(coalesce(p_reason, '')), ''), ''), true);

  update public.leads l
     set assigned_to_id = p_to_staff_id,
         assigned_to    = (select u.name from public.users u where u.id = p_to_staff_id)
   where l.id = p_lead_id
     and l.tenant_id = v_tenant;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception using errcode = 'NX001',
      message = 'The owner of this lead could not be changed.',
      detail  = 'REASSIGN_WROTE_NOTHING',
      hint    = 'The lead changed while this request was running. Reload and try again.';
  end if;

  return query
    select e.lead_id, e.from_staff_id, e.to_staff_id, e.event, e.reason
      from public.lead_owner_events e
     where e.lead_id = p_lead_id
     -- Prefer the event THIS call wrote: two changes in one transaction share
     -- `at` (now()), and the old order returned either of them.
     order by (e.from_staff_id is not distinct from v_from
               and e.to_staff_id is not distinct from p_to_staff_id) desc,
              e.at desc
     limit 1;
end
$function$;

alter function public.nexus_lead_assign_owner(integer, uuid, text) owner to postgres;
revoke all on function public.nexus_lead_assign_owner(integer, uuid, text) from public, anon, authenticated;
grant execute on function public.nexus_lead_assign_owner(integer, uuid, text) to authenticated, service_role;

do $assert$
begin
  if not (select prosecdef from pg_proc where oid = 'public.nexus_lead_assign_owner(integer,uuid,text)'::regprocedure) then
    raise exception 'nexus_lead_assign_owner is not SECURITY DEFINER';
  end if;
  if (select proisstrict from pg_proc where oid = 'public.nexus_lead_assign_owner(integer,uuid,text)'::regprocedure) then
    raise exception 'nexus_lead_assign_owner must not be STRICT: p_reason and p_to_staff_id are nullable';
  end if;
  if has_function_privilege('anon', 'public.nexus_lead_assign_owner(integer,uuid,text)', 'EXECUTE') then
    raise exception 'anon can execute nexus_lead_assign_owner';
  end if;
  if not has_function_privilege('authenticated', 'public.nexus_lead_assign_owner(integer,uuid,text)', 'EXECUTE') then
    raise exception 'authenticated lost EXECUTE on nexus_lead_assign_owner';
  end if;
end
$assert$;
