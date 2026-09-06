-- ===========================================================================
-- team_05_the_last_owner_guard_had_to_be_made_reachable
--
-- team_03 shipped four guards and one of them could never fire. Found by
-- probing it rather than by reading it, on staging, 6 Sep 2026:
--
--   as the sole owner of staging-alpha, set my own role to 'admin'
--     -> NX001 NX_TEAM_NO_SELF_ROLE_CHANGE   (line 32)
--
-- The last-owner guard sits at line 60 and is never reached. Nor can any other
-- path reach it: it fires only when the TARGET is the only owner, and only an
-- owner may change or remove an owner, and the actor may not be the target --
-- so an owner actor implies a second owner exists and the count is never 1.
-- The same argument holds in nexus_team_revoke_access. CLAUDE.md is explicit
-- that "a gate that cannot go red is decoration", and this file has now found
-- three of them.
--
-- IT IS THE SELF-CHANGE REFUSAL THAT GOES, not the last-owner guard, and the
-- product is better for it:
--
--   * An owner stepping down after appointing a successor is a normal thing a
--     dealership does. Refusing it outright made NEXUS unable to model a
--     handover at all.
--   * The self-refusal was also answering the WRONG QUESTION for the case that
--     matters most. A `sales` login promoting itself was refused as "you cannot
--     change your own role" -- true, but it implied the act would be fine if
--     performed on somebody else, which it is not. With the self-check gone the
--     authority lookup answers first: NX_TEAM_ROLE_CHANGE_REFUSED, which is the
--     real reason. Proven both ways below in the evidence file.
--   * Nothing is lost on the escalation side. An admin CANNOT promote itself to
--     owner, because the owner-only guard tests p_role and v_prev without
--     caring who the target is; and a manager, sales, technician or member
--     login never gets past the authority lookup at all.
--
-- SO THE PROTECTION AGAINST A DEALERSHIP LOSING ITS OWNER IS NOW THE GUARD
-- THAT WAS WRITTEN FOR IT, and it is reachable in four ways, all of which are
-- exercised: the sole owner demoting themselves, the sole owner removing their
-- own access, and either of those attempted by a second owner after the first
-- has already stepped down.
--
-- Nothing else in team_03 changes. The authority lookup, the owner-only rule,
-- the no-op rule, the audit row, the leads count and the "the Supabase Auth
-- login is NOT deleted" return value are all as they were.
-- ===========================================================================

create or replace function public.nexus_team_set_role(
  p_auth_user_id uuid,
  p_role         text
)
returns table (
  tenant_id     uuid,
  auth_user_id  uuid,
  email         text,
  previous_role text,
  new_role      text,
  changed       boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor      uuid := auth.uid();
  v_actor_role text;
  v_tenant     uuid;
  v_prev       text;
  v_email      text;
  v_owners     integer;
begin
  if v_actor is null then
    raise exception using errcode = 'NX001',
      message = 'There is no signed-in user on this request, so no role was changed.',
      detail  = 'NX_TEAM_NO_SESSION',
      hint    = 'Sign in again and retry.';
  end if;

  if p_auth_user_id is null then
    raise exception using errcode = 'NX001',
      message = 'No person was named, so no role was changed.',
      detail  = 'NX_TEAM_NO_TARGET',
      hint    = 'Send the account id of the person whose role should change.';
  end if;

  if p_role is null or p_role not in ('owner','admin','manager','sales','technician','member') then
    raise exception using errcode = 'NX001',
      message = 'That is not a role this system recognises, so nothing was changed.',
      detail  = 'NX_TEAM_ROLE_NOT_IN_VOCABULARY',
      hint    = 'The roles are owner, admin, manager, sales, technician and member. Anything else is refused rather than stored, because a role nothing enforces would read on screen as permission somebody does not have.';
  end if;

  -- Authority and existence in one lookup. This is also what refuses a rep who
  -- names THEMSELVES: a sales login holds no owner/admin tenant, so the
  -- intersection is empty and the refusal is about authority rather than about
  -- who was named. That is the honest answer to a self-promotion attempt.
  select m.tenant_id, m.role
    into v_tenant, v_prev
    from public.tenant_members m
   where m.auth_user_id = p_auth_user_id
     and m.tenant_id in (select public.nexus_tenant_ids_for_roles(array['owner','admin']::text[]))
   for update;

  if not found then
    raise exception using errcode = 'NX001',
      message = 'You may not change this person''s role.',
      detail  = 'NX_TEAM_ROLE_CHANGE_REFUSED',
      hint    = 'Changing who may do what is an owner or admin decision at this dealership. If you ARE the owner or an admin, check that this person is still a member here -- a person who is not a member of your dealership and a person you may not manage are refused the same way on purpose.';
  end if;

  select m.role into v_actor_role
    from public.tenant_members m
   where m.tenant_id = v_tenant and m.auth_user_id = v_actor;

  -- Tests the ROLES, not the people, which is what makes it cover an admin
  -- naming itself as well as an admin naming a colleague.
  if (p_role = 'owner' or v_prev = 'owner') and coalesce(v_actor_role, '') <> 'owner' then
    raise exception using errcode = 'NX001',
      message = 'Only an account owner may grant or remove the owner role.',
      detail  = 'NX_TEAM_OWNER_ROLE_IS_OWNER_ONLY',
      hint    = 'An admin may set any role below owner, including their own. Granting owner is kept to owners so that an admin cannot promote itself, and so that two admins cannot promote each other.';
  end if;

  if v_prev = 'owner' and p_role <> 'owner' then
    select count(*) into v_owners
      from public.tenant_members m
     where m.tenant_id = v_tenant and m.role = 'owner';
    if v_owners <= 1 then
      raise exception using errcode = 'NX001',
        message = 'This is the only owner of this dealership, so their role cannot be changed.',
        detail  = 'NX_TEAM_LAST_OWNER',
        hint    = 'Make somebody else an owner first, then change this one. A dealership with no owner has nobody left who can appoint one, and there is no route back that does not need the vendor.';
    end if;
  end if;

  select au.email::text into v_email from auth.users au where au.id = p_auth_user_id;

  if v_prev = p_role then
    return query select v_tenant, p_auth_user_id, v_email, v_prev, p_role, false;
    return;
  end if;

  update public.tenant_members m
     set role = p_role
   where m.tenant_id = v_tenant and m.auth_user_id = p_auth_user_id;

  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('Team Access', 'SUCCESS',
          format('account role for %s changed from %s to %s by auth user %s%s',
                 coalesce(v_email, p_auth_user_id::text), v_prev, p_role, v_actor::text,
                 case when p_auth_user_id = v_actor then ' (their own account)' else '' end),
          v_tenant);

  return query select v_tenant, p_auth_user_id, v_email, v_prev, p_role, true;
end;
$fn$;

comment on function public.nexus_team_set_role(uuid, text) is
  'Change one member''s account role at the caller''s own dealership, their own included. Owner or admin only; only an owner may grant or remove owner, which is also what stops an admin promoting itself; the last owner cannot be demoted by anybody, themselves included. Raises NX001 with the machine code in DETAIL.';

create or replace function public.nexus_team_revoke_access(
  p_auth_user_id uuid
)
returns table (
  tenant_id            uuid,
  auth_user_id         uuid,
  email                text,
  removed_role         text,
  leads_still_assigned integer,
  auth_account_deleted boolean
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor      uuid := auth.uid();
  v_actor_role text;
  v_tenant     uuid;
  v_prev       text;
  v_staff      uuid;
  v_email      text;
  v_owners     integer;
  v_leads      integer := 0;
begin
  if v_actor is null then
    raise exception using errcode = 'NX001',
      message = 'There is no signed-in user on this request, so no access was removed.',
      detail  = 'NX_TEAM_NO_SESSION',
      hint    = 'Sign in again and retry.';
  end if;

  if p_auth_user_id is null then
    raise exception using errcode = 'NX001',
      message = 'No person was named, so no access was removed.',
      detail  = 'NX_TEAM_NO_TARGET',
      hint    = 'Send the account id of the person whose access should be removed.';
  end if;

  select m.tenant_id, m.role, m.staff_user_id
    into v_tenant, v_prev, v_staff
    from public.tenant_members m
   where m.auth_user_id = p_auth_user_id
     and m.tenant_id in (select public.nexus_tenant_ids_for_roles(array['owner','admin']::text[]))
   for update;

  if not found then
    raise exception using errcode = 'NX001',
      message = 'You may not remove this person''s access.',
      detail  = 'NX_TEAM_REVOKE_REFUSED',
      hint    = 'Removing access is an owner or admin decision at this dealership. If you ARE the owner or an admin, check that this person is still a member here.';
  end if;

  select m.role into v_actor_role
    from public.tenant_members m
   where m.tenant_id = v_tenant and m.auth_user_id = v_actor;

  if v_prev = 'owner' and coalesce(v_actor_role, '') <> 'owner' then
    raise exception using errcode = 'NX001',
      message = 'Only an account owner may remove another owner''s access.',
      detail  = 'NX_TEAM_OWNER_REVOKE_IS_OWNER_ONLY',
      hint    = 'An admin may remove any member below owner.';
  end if;

  if v_prev = 'owner' then
    select count(*) into v_owners
      from public.tenant_members m
     where m.tenant_id = v_tenant and m.role = 'owner';
    if v_owners <= 1 then
      raise exception using errcode = 'NX001',
        message = 'This is the only owner of this dealership, so their access cannot be removed.',
        detail  = 'NX_TEAM_LAST_OWNER',
        hint    = 'Make somebody else an owner first. A dealership with no owner has nobody left who can appoint one, and that is true whether the last owner is removed by a colleague or removes themselves.';
    end if;
  end if;

  if v_staff is not null then
    select count(*) into v_leads
      from public.leads l
     where l.tenant_id = v_tenant and l.assigned_to_id = v_staff;
  end if;

  select au.email::text into v_email from auth.users au where au.id = p_auth_user_id;

  delete from public.tenant_members m
   where m.tenant_id = v_tenant and m.auth_user_id = p_auth_user_id;

  -- Any invitation still open for this address at this dealership goes with the
  -- access. Leaving one behind would re-admit the person the moment they signed
  -- in again, which is the opposite of what was just asked for.
  update public.tenant_member_invite i
     set revoked_at = now(), revoked_by = v_actor
   where i.tenant_id = v_tenant
     and v_email is not null
     and lower(btrim(i.email)) = lower(btrim(v_email))
     and i.revoked_at is null
     and i.claimed_at is null;

  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('Team Access', 'SUCCESS',
          format('access for %s (role %s) removed by auth user %s%s; %s lead(s) remain assigned to their staff record; the Supabase Auth login itself was NOT deleted',
                 coalesce(v_email, p_auth_user_id::text), v_prev, v_actor::text,
                 case when p_auth_user_id = v_actor then ' (their own account)' else '' end,
                 v_leads),
          v_tenant);

  return query select v_tenant, p_auth_user_id, v_email, v_prev, v_leads, false;
end;
$fn$;

comment on function public.nexus_team_revoke_access(uuid) is
  'Remove one person''s access to the caller''s dealership by deleting their tenant_members row, their own included. Owner or admin only; only an owner may remove an owner; the last owner cannot be removed by anybody. Returns auth_account_deleted = false always: this deletes the membership, not the Supabase Auth login, which NEXUS does not handle.';

revoke all on function public.nexus_team_set_role(uuid, text)  from public, anon;
revoke all on function public.nexus_team_revoke_access(uuid)   from public, anon;
grant execute on function public.nexus_team_set_role(uuid, text) to authenticated, service_role;
grant execute on function public.nexus_team_revoke_access(uuid)  to authenticated, service_role;