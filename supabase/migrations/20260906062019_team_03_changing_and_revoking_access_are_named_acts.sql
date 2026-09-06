-- ===========================================================================
-- team_03_changing_and_revoking_access_are_named_acts
--
-- WHY. tenant_members carries authenticated=r and nothing else -- no INSERT,
-- no UPDATE, no DELETE, at table level or column level. That is correct and is
-- NOT widened here: a table grant is per database role, so it cannot tell an
-- owner from a rep, and a policy that let `authenticated` UPDATE
-- tenant_members would be a policy that lets the row decide its own authority.
-- So the three acts a dealership needs -- change somebody's role, link them to
-- their staff record, take their access away -- are named functions instead,
-- each of which refuses by name.
--
-- NONE OF THEM TAKES A TENANT ARGUMENT. The dealership is derived from the
-- intersection of the target's own membership row and the tenants where the
-- CALLER holds owner or admin, via nexus_tenant_ids_for_roles() -- the same
-- helper rbac_02 and rbac_04's policies read. A function that took a tenant
-- and ran as definer would be the action_write_audit shape CLAUDE.md records
-- as a hole, and it is what QUALITY_GATE's L4 fails a function for.
--
-- AUTHORITY AND EXISTENCE ARE ONE LOOKUP, following inventory_set_cost(). A
-- person at another dealership and a person at this one when the caller is not
-- owner or admin are the same refusal on purpose: answering differently would
-- tell a rep whether a given login exists at a dealership they cannot see.
--
-- FOUR GUARDS THAT ARE NOT ABOUT THE CALLER'S ROLE, and each exists because
-- role checks alone leave a door:
--
--   1. Nobody changes or revokes their OWN access. A sales login cannot reach
--      these functions at all (guard 0 refuses it), so this is not what stops
--      self-promotion -- it stops an owner locking themselves out of their own
--      dealership with one click, which is the likelier accident by far.
--   2. Only an OWNER may grant or remove the owner role. Without this, two
--      admins are one round trip from owner: A promotes B, B promotes A. An
--      admin manages the floor; it does not mint its own superiors.
--   3. The LAST OWNER cannot be demoted or removed. A dealership with no owner
--      has nobody who can ever appoint one again, and no route back exists in
--      this database that does not need the vendor's service key.
--   4. A no-op is not a change. Setting a role to the one already held writes
--      no audit row, because an audit trail that records acts that did not
--      happen is worth less than one that records none.
--
-- WHAT REVOCATION ACTUALLY DOES, stated plainly because the screen has to say
-- it. Deleting the tenant_members row removes every route this person has to
-- this dealership's data: nexus_current_tenant_ids() returns nothing for them,
-- so every tenant-scoped policy in the database filters them to zero rows. It
-- does NOT delete their Supabase Auth account -- that lives in auth.users,
-- this project does not handle credentials, and removing a login is Supabase
-- Auth's own act. They can still sign in; they will see nothing. It also does
-- not touch their public.users staff row or reassign their leads, and the
-- function returns the count of leads still pointing at them so the screen can
-- say so rather than implying a clean hand-over that did not occur.
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

  if p_auth_user_id = v_actor then
    raise exception using errcode = 'NX001',
      message = 'You cannot change your own account role.',
      detail  = 'NX_TEAM_NO_SELF_ROLE_CHANGE',
      hint    = 'Ask another owner at this dealership to change it. This refusal exists so that the last owner cannot remove their own authority and leave the dealership with nobody who can restore it.';
  end if;

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

  if (p_role = 'owner' or v_prev = 'owner') and coalesce(v_actor_role, '') <> 'owner' then
    raise exception using errcode = 'NX001',
      message = 'Only an account owner may grant or remove the owner role.',
      detail  = 'NX_TEAM_OWNER_ROLE_IS_OWNER_ONLY',
      hint    = 'An admin may set any role below owner. Granting owner is kept to owners so that two admins cannot promote each other into it.';
  end if;

  if v_prev = 'owner' and p_role <> 'owner' then
    select count(*) into v_owners
      from public.tenant_members m
     where m.tenant_id = v_tenant and m.role = 'owner';
    if v_owners <= 1 then
      raise exception using errcode = 'NX001',
        message = 'This is the only owner of this dealership, so their role cannot be changed.',
        detail  = 'NX_TEAM_LAST_OWNER',
        hint    = 'Make somebody else an owner first, then change this one. A dealership with no owner has nobody left who can appoint one.';
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
          format('account role for %s changed from %s to %s by auth user %s',
                 coalesce(v_email, p_auth_user_id::text), v_prev, p_role, v_actor::text),
          v_tenant);

  return query select v_tenant, p_auth_user_id, v_email, v_prev, p_role, true;
end;
$fn$;

comment on function public.nexus_team_set_role(uuid, text) is
  'Change one member''s account role at the caller''s own dealership. Owner or admin only; only an owner may grant or remove owner; nobody may change their own role; the last owner cannot be demoted. Raises NX001 with the machine code in DETAIL.';

create or replace function public.nexus_team_link_staff(
  p_auth_user_id  uuid,
  p_staff_user_id uuid
)
returns table (
  tenant_id     uuid,
  auth_user_id  uuid,
  email         text,
  staff_user_id uuid,
  staff_name    text
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor  uuid := auth.uid();
  v_tenant uuid;
  v_email  text;
  v_name   text;
  v_taken  uuid;
begin
  if v_actor is null then
    raise exception using errcode = 'NX001',
      message = 'There is no signed-in user on this request, so nothing was linked.',
      detail  = 'NX_TEAM_NO_SESSION',
      hint    = 'Sign in again and retry.';
  end if;

  select m.tenant_id into v_tenant
    from public.tenant_members m
   where m.auth_user_id = p_auth_user_id
     and m.tenant_id in (select public.nexus_tenant_ids_for_roles(array['owner','admin']::text[]))
   for update;

  if not found then
    raise exception using errcode = 'NX001',
      message = 'You may not change this person''s staff record.',
      detail  = 'NX_TEAM_LINK_REFUSED',
      hint    = 'Linking a login to a staff record is an owner or admin decision at this dealership.';
  end if;

  if p_staff_user_id is not null then
    select u.name into v_name
      from public.users u
     where u.id = p_staff_user_id and u.tenant_id = v_tenant;
    if not found then
      raise exception using errcode = 'NX001',
        message = 'That staff record is not one of this dealership''s, so nothing was linked.',
        detail  = 'NX_TEAM_STAFF_NOT_HERE',
        hint    = 'Pick a name from this dealership''s own roster.';
    end if;

    select m.auth_user_id into v_taken
      from public.tenant_members m
     where m.tenant_id = v_tenant
       and m.staff_user_id = p_staff_user_id
       and m.auth_user_id <> p_auth_user_id;
    if found then
      raise exception using errcode = 'NX001',
        message = 'That staff record is already linked to another login, so nothing was linked.',
        detail  = 'NX_TEAM_STAFF_ALREADY_LINKED',
        hint    = 'One staff record belongs to one login. leads.assigned_to_id points at the staff record, so two logins sharing one would make "my leads" mean two different people.';
    end if;
  end if;

  update public.tenant_members m
     set staff_user_id = p_staff_user_id
   where m.tenant_id = v_tenant and m.auth_user_id = p_auth_user_id;

  select au.email::text into v_email from auth.users au where au.id = p_auth_user_id;

  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('Team Access', 'SUCCESS',
          format('staff record for %s set to %s by auth user %s',
                 coalesce(v_email, p_auth_user_id::text),
                 coalesce(v_name, '(unlinked)'), v_actor::text),
          v_tenant);

  return query select v_tenant, p_auth_user_id, v_email, p_staff_user_id, v_name;
end;
$fn$;

comment on function public.nexus_team_link_staff(uuid, uuid) is
  'Link a login to the public.users staff record it works as, or pass null to unlink. Owner or admin only. A member with no staff link can edit no leads at all -- rbac open item 4 -- so this is the repair for that, not a cosmetic field.';

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

  if p_auth_user_id = v_actor then
    raise exception using errcode = 'NX001',
      message = 'You cannot remove your own access.',
      detail  = 'NX_TEAM_NO_SELF_REVOKE',
      hint    = 'Ask another owner at this dealership to do it. A person who removes their own access cannot restore it.';
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
        hint    = 'Make somebody else an owner first. A dealership with no owner has nobody left who can appoint one.';
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
          format('access for %s (role %s) removed by auth user %s; %s lead(s) remain assigned to their staff record; the Supabase Auth login itself was NOT deleted',
                 coalesce(v_email, p_auth_user_id::text), v_prev, v_actor::text, v_leads),
          v_tenant);

  return query select v_tenant, p_auth_user_id, v_email, v_prev, v_leads, false;
end;
$fn$;

comment on function public.nexus_team_revoke_access(uuid) is
  'Remove one person''s access to the caller''s dealership by deleting their tenant_members row. Owner or admin only; only an owner may remove an owner; nobody may remove themselves; the last owner cannot be removed. Returns auth_account_deleted = false always: this deletes the membership, not the Supabase Auth login, which NEXUS does not handle.';

revoke all on function public.nexus_team_set_role(uuid, text)     from public, anon;
revoke all on function public.nexus_team_link_staff(uuid, uuid)   from public, anon;
revoke all on function public.nexus_team_revoke_access(uuid)      from public, anon;
grant execute on function public.nexus_team_set_role(uuid, text)   to authenticated, service_role;
grant execute on function public.nexus_team_link_staff(uuid, uuid) to authenticated, service_role;
grant execute on function public.nexus_team_revoke_access(uuid)    to authenticated, service_role;