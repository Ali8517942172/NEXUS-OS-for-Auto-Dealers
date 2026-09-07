-- The other half of T12: a trigger can record THAT the owner changed, never WHY.
--
-- This is the RPC, and it is SECURITY INVOKER on purpose. That is the whole
-- trick: the UPDATE inside it runs as the caller, so policy leads_role_update
-- decides exactly as it does today -- owner, admin and manager may reassign
-- anything in their dealership, sales and member only a lead already theirs.
-- Nothing is re-implemented, nothing is bypassed, and granting EXECUTE to
-- `authenticated` hands out no privilege the caller did not already hold.
-- A SECURITY DEFINER version would have been a second copy of the rule and a
-- new write surface at once.
--
-- What it adds that a PATCH cannot: PostgREST will not set an arbitrary GUC for
-- a browser, so nexus.change_reason -- the seam the trigger already reads -- is
-- unreachable from the dashboard's direct PATCH. Inside a function it is one
-- set_config away. So the reason is recorded only when a caller goes through
-- here, and stays NULL when somebody PATCHes the table directly. That is the
-- honest state and it is visible in the data rather than assumed.
--
-- AND IT CLOSES A SMALL HOLE THE PATCH LEFT OPEN. leads_role_update's WITH
-- CHECK constrains leads.tenant_id and says nothing about assigned_to_id, so a
-- manager could set the owner to a staff id belonging to ANOTHER dealership --
-- measured, not supposed. The lead stays put and its owner becomes a stranger.
-- This function refuses that by name.

create or replace function public.nexus_lead_assign_owner(
  p_lead_id      integer,
  p_to_staff_id  uuid,
  p_reason       text default null)
returns table (lead_id integer, from_staff_id uuid, to_staff_id uuid, event text, reason text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid;
  v_from   uuid;
  v_n      integer;
begin
  -- Read the lead AS THE CALLER. If they cannot see it, they cannot reassign
  -- it, and the refusal is the same one they get for a lead that is not there:
  -- distinguishing the two tells an outsider which lead ids exist.
  select l.tenant_id, l.assigned_to_id into v_tenant, v_from
    from public.leads l where l.id = p_lead_id;
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
        hint    = 'The row policy on leads constrains the lead''s own tenant and says nothing about the owner, so a direct PATCH would have accepted this and filed the lead under a stranger.';
    end if;
  end if;

  -- The seam the trigger reads. transaction-local, so it cannot leak into the
  -- next statement on a pooled connection.
  perform set_config('nexus.change_reason',
                     coalesce(nullif(btrim(coalesce(p_reason, '')), ''), ''), true);

  update public.leads l
     set assigned_to_id = p_to_staff_id,
         assigned_to    = (select u.name from public.users u where u.id = p_to_staff_id)
   where l.id = p_lead_id;
  get diagnostics v_n = row_count;

  -- Zero rows means RLS refused it. That is the authorisation answer, produced
  -- by the policy rather than by a second copy of it here.
  if v_n = 0 then
    raise exception using errcode = 'NX001',
      message = 'Your account is not allowed to change the owner of this lead.',
      detail  = 'NOT_ALLOWED_TO_REASSIGN',
      hint    = 'Owners, admins and managers may reassign any lead in the dealership. Sales and member accounts may only reassign a lead already assigned to them.';
  end if;

  return query
    select e.lead_id, e.from_staff_id, e.to_staff_id, e.event, e.reason
      from public.lead_owner_events e
     where e.lead_id = p_lead_id
     order by e.at desc
     limit 1;
end $$;

comment on function public.nexus_lead_assign_owner(integer, uuid, text) is
  'Change a lead''s owner and say why. SECURITY INVOKER: the UPDATE runs as the '
  'caller so policy leads_role_update decides, and this function neither copies '
  'that rule nor bypasses it. It exists for the two things a direct PATCH '
  'cannot do -- set nexus.change_reason, which the audit trigger reads, and '
  'refuse an owner who is staff at a different dealership.';

revoke all on function public.nexus_lead_assign_owner(integer, uuid, text) from public, anon, authenticated;
grant execute on function public.nexus_lead_assign_owner(integer, uuid, text) to authenticated, service_role;

do $$
declare bad text[] := '{}';
begin
  if has_function_privilege('anon', 'public.nexus_lead_assign_owner(integer,uuid,text)', 'execute') then
    bad := array_append(bad, 'anon can execute the assignment rpc');
  end if;
  if not has_function_privilege('authenticated', 'public.nexus_lead_assign_owner(integer,uuid,text)', 'execute') then
    bad := array_append(bad, 'authenticated cannot execute the assignment rpc, so the screen cannot use it');
  end if;
  -- SECURITY INVOKER is the entire safety argument. If somebody later flips it
  -- to DEFINER, this function silently becomes an RLS bypass granted to every
  -- signed-in user.
  if (select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='nexus_lead_assign_owner') then
    bad := array_append(bad, 'nexus_lead_assign_owner is SECURITY DEFINER -- it must be INVOKER, or it is an RLS bypass granted to every signed-in user');
  end if;
  if cardinality(bad) > 0 then
    raise exception 'assignment rpc is wrong: %', array_to_string(bad, '; ');
  end if;
end $$;
