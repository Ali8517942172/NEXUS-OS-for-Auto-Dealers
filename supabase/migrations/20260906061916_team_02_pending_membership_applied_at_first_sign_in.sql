-- ===========================================================================
-- team_02_pending_membership_applied_at_first_sign_in
--
-- THE HONEST ACCOUNT OF WHAT AN "INVITE" CAN BE HERE, because a screen that
-- appears to send an invitation and does not is worse than one that says what
-- it cannot do.
--
-- Adding a colleague is two separate acts, and only one of them belongs to
-- NEXUS:
--
--   AUTHENTICATION -- creating a login and giving that person a way to prove
--   they own it. That is Supabase Auth's, and it necessarily involves a
--   credential: a password, a magic link, an invite token. NEXUS DOES NOT
--   HANDLE ANY OF THOSE AND MUST NOT. The dashboard is a static bundle holding
--   the anon key; Supabase's own invite call (auth.admin.inviteUserByEmail)
--   requires the service_role key, and a service_role key in a browser bundle
--   is the whole database handed to anyone who opens devtools. Measured
--   6 Sep 2026: this project has ZERO Edge Functions deployed, so there is no
--   server-side place that key could live either. That is the missing piece,
--   it is named in the evidence, and nothing here pretends to cover it.
--
--   AUTHORISATION -- deciding that whoever proves they own that address is a
--   manager at THIS dealership. That is entirely NEXUS's, it needs no
--   credential, and it is what this migration builds.
--
-- So: an owner or admin records a PENDING MEMBERSHIP against an email address
-- and a role. When a login for that address first appears in auth.users -- by
-- whatever route Supabase Auth is configured for, which is the operator's
-- choice and not this dashboard's -- an AFTER INSERT trigger converts the
-- pending row into a real tenant_members row with the role that was chosen
-- before they ever signed in. No token, no password and no invitation email
-- passes through NEXUS at any point.
--
-- IF THE ADDRESS ALREADY HAS A LOGIN, no INSERT on auth.users will ever fire,
-- so nexus_team_invite() completes the membership immediately and says so in
-- its `outcome` column. The screen must render those two outcomes differently:
-- one person can sign in now, the other still needs a way in.
--
-- THE TRIGGER MUST NEVER BLOCK A SIGN-UP. It runs inside Supabase Auth's own
-- transaction, so an exception here is an account that cannot be created and a
-- product that looks broken at the worst possible moment. The body is wrapped
-- in an exception handler that returns NEW on any failure: the account is
-- created, the pending row stays open and visible on the Team screen, and the
-- postgres log carries a warning. Failing to grant access is recoverable in one
-- click; failing to create an account is not recoverable at all.
--
-- THE TABLE IS OFF THE DEALER DATA PLANE, like workflow_registry. No grant to
-- anon or authenticated, and a RESTRICTIVE deny naming both, so the floor is
-- designed rather than incidental -- the distinction
-- 20260906050648 was written to make. Every dealership-facing read and write
-- goes through the four SECURITY DEFINER functions below, which is where the
-- owner/admin check lives.
-- ===========================================================================

create table if not exists public.tenant_member_invite (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  email                text not null,
  role                 text not null default 'member',
  staff_user_id        uuid references public.users(id) on delete set null,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  revoked_at           timestamptz,
  revoked_by           uuid,
  claimed_at           timestamptz,
  claimed_auth_user_id uuid,
  constraint tenant_member_invite_role_check
    check (role = any (array['owner','admin','manager','sales','technician','member'])),
  constraint tenant_member_invite_email_shape
    check (btrim(email) <> '' and position('@' in email) > 1)
);

comment on table public.tenant_member_invite is
  'A membership decided before the person has a login. NEXUS never holds a credential: this row records only which dealership and which role, and the trigger on auth.users applies it when a login for that address first exists. Off the dealer data plane -- reachable only through nexus_team_invite / nexus_team_cancel_invite / nexus_team_pending.';

alter table public.tenant_member_invite enable row level security;

drop policy if exists tenant_member_invite_deny_end_users on public.tenant_member_invite;
create policy tenant_member_invite_deny_end_users
  on public.tenant_member_invite
  as restrictive
  for all
  to authenticated, anon
  using (false)
  with check (false);

drop policy if exists tenant_member_invite_service_role_all on public.tenant_member_invite;
create policy tenant_member_invite_service_role_all
  on public.tenant_member_invite
  as permissive
  for all
  to service_role
  using (true)
  with check (true);

-- A new table in `public` is born carrying whatever the default ACL grants.
-- Revoke from both roles by name -- a PUBLIC revoke does not remove a direct
-- grant, and this file's own check is the one that has to catch it.
revoke all on table public.tenant_member_invite from public, anon, authenticated;
grant select, insert, update, delete on table public.tenant_member_invite to service_role;

-- One open invitation per address per dealership. Partial, so a cancelled or
-- claimed invitation does not block re-inviting the same person later.
create unique index if not exists tenant_member_invite_open_uq
  on public.tenant_member_invite (tenant_id, lower(btrim(email)))
  where revoked_at is null and claimed_at is null;

-- The trigger looks an address up across every dealership, so it needs an index
-- whose leading column is the address rather than the tenant.
create index if not exists tenant_member_invite_open_email_idx
  on public.tenant_member_invite (lower(btrim(email)))
  where revoked_at is null and claimed_at is null;

create or replace function public.nexus_claim_pending_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_email text;
  v_inv   record;
begin
  v_email := lower(btrim(coalesce(new.email, '')));
  if v_email = '' then
    return new;
  end if;

  for v_inv in
    select i.id, i.tenant_id, i.role, i.staff_user_id
      from public.tenant_member_invite i
      join public.tenants t on t.id = i.tenant_id and t.status = 'active'
     where lower(btrim(i.email)) = v_email
       and i.revoked_at is null
       and i.claimed_at is null
     order by i.created_at
  loop
    -- do nothing on conflict: an existing membership row is the dealership's
    -- current answer about this person and a pending row must not overwrite it.
    -- The invitation is still marked claimed, because it has been answered.
    insert into public.tenant_members (tenant_id, auth_user_id, role, staff_user_id)
    values (v_inv.tenant_id, new.id, v_inv.role, v_inv.staff_user_id)
    on conflict (tenant_id, auth_user_id) do nothing;

    update public.tenant_member_invite i
       set claimed_at = now(), claimed_auth_user_id = new.id
     where i.id = v_inv.id;

    insert into public.audit_log (workflow, status, summary, tenant_id)
    values ('Team Access', 'SUCCESS',
            format('%s signed in for the first time and took up the %s role recorded for them',
                   v_email, v_inv.role),
            v_inv.tenant_id);
  end loop;

  return new;
exception when others then
  -- A failure here must never stop an account being created. The invitation is
  -- left open and stays visible on the Team screen, which is a condition an
  -- owner can fix in one click; an account that cannot be created is not.
  raise warning 'nexus_claim_pending_membership failed for % : % %',
    v_email, sqlstate, sqlerrm;
  return new;
end;
$fn$;

comment on function public.nexus_claim_pending_membership() is
  'AFTER INSERT on auth.users. Turns any open tenant_member_invite for the new account''s address into a real tenant_members row. Swallows every error on purpose: the account must be created even when the grant cannot be.';

drop trigger if exists trg_nexus_claim_pending_membership on auth.users;
create trigger trg_nexus_claim_pending_membership
  after insert on auth.users
  for each row execute function public.nexus_claim_pending_membership();

create or replace function public.nexus_team_invite(
  p_email         text,
  p_role          text default 'member',
  p_staff_user_id uuid default null
)
returns table (
  tenant_id uuid,
  email     text,
  role      text,
  outcome   text,
  detail    text
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor      uuid := auth.uid();
  v_actor_role text;
  v_tenant     uuid;
  v_email      text;
  v_existing   uuid;
  v_ids        uuid[];
  v_n          integer;
begin
  if v_actor is null then
    raise exception using errcode = 'NX001',
      message = 'There is no signed-in user on this request, so nobody was added.',
      detail  = 'NX_TEAM_NO_SESSION',
      hint    = 'Sign in again and retry.';
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception using errcode = 'NX001',
      message = 'That is not an email address, so nobody was added.',
      detail  = 'NX_TEAM_INVITE_BAD_EMAIL',
      hint    = 'Use the address this person will sign in with. It is the only thing that links the access you are granting to the login they will eventually have.';
  end if;

  if p_role is null or p_role not in ('owner','admin','manager','sales','technician','member') then
    raise exception using errcode = 'NX001',
      message = 'That is not a role this system recognises, so nobody was added.',
      detail  = 'NX_TEAM_ROLE_NOT_IN_VOCABULARY',
      hint    = 'The roles are owner, admin, manager, sales, technician and member.';
  end if;

  -- The dealership is derived, never supplied. A caller who is owner or admin
  -- at exactly one dealership gets that one; anything else refuses rather than
  -- guessing, because guessing is how one dealership's colleague is granted
  -- access to another's data.
  select array_agg(x) into v_ids
    from public.nexus_tenant_ids_for_roles(array['owner','admin']::text[]) x;
  v_n      := coalesce(array_length(v_ids, 1), 0);
  v_tenant := v_ids[1];

  if v_n = 0 then
    raise exception using errcode = 'NX001',
      message = 'You may not add somebody to this dealership.',
      detail  = 'NX_TEAM_INVITE_REFUSED',
      hint    = 'Adding a colleague is an owner or admin decision. Ask the account owner.';
  end if;

  if v_n > 1 then
    raise exception using errcode = 'NX001',
      message = 'Your account manages more than one dealership, so it is not clear which one this person should join.',
      detail  = 'NX_TEAM_INVITE_AMBIGUOUS_TENANT',
      hint    = 'This function deliberately takes no dealership argument -- a caller that names its own scope is a caller that can name somebody else''s. Adding across dealerships needs a screen that asks first.';
  end if;

  select m.role into v_actor_role
    from public.tenant_members m
   where m.tenant_id = v_tenant and m.auth_user_id = v_actor;

  if p_role = 'owner' and coalesce(v_actor_role, '') <> 'owner' then
    raise exception using errcode = 'NX001',
      message = 'Only an account owner may add another owner.',
      detail  = 'NX_TEAM_OWNER_ROLE_IS_OWNER_ONLY',
      hint    = 'An admin may add anybody below owner.';
  end if;

  if p_staff_user_id is not null then
    perform 1 from public.users u
      where u.id = p_staff_user_id and u.tenant_id = v_tenant;
    if not found then
      raise exception using errcode = 'NX001',
        message = 'That staff record is not one of this dealership''s, so nobody was added.',
        detail  = 'NX_TEAM_STAFF_NOT_HERE',
        hint    = 'Pick a name from this dealership''s own roster, or leave it blank and link them once they are in.';
    end if;
  end if;

  -- Already a member here?
  select m.auth_user_id into v_existing
    from public.tenant_members m
    join auth.users au on au.id = m.auth_user_id
   where m.tenant_id = v_tenant and lower(btrim(au.email)) = v_email;
  if found then
    raise exception using errcode = 'NX001',
      message = 'That person already has access to this dealership, so nothing was changed.',
      detail  = 'NX_TEAM_ALREADY_A_MEMBER',
      hint    = 'Change their role on the team screen instead of adding them again.';
  end if;

  -- Does a login for this address already exist? If so there will never be an
  -- INSERT on auth.users to trigger the claim, so the membership is completed
  -- here and now.
  select au.id into v_existing from auth.users au
   where lower(btrim(au.email)) = v_email
   order by au.created_at
   limit 1;

  if found then
    insert into public.tenant_members (tenant_id, auth_user_id, role, staff_user_id)
    values (v_tenant, v_existing, p_role, p_staff_user_id);

    insert into public.tenant_member_invite
      (tenant_id, email, role, staff_user_id, created_by, claimed_at, claimed_auth_user_id)
    values (v_tenant, v_email, p_role, p_staff_user_id, v_actor, now(), v_existing);

    insert into public.audit_log (workflow, status, summary, tenant_id)
    values ('Team Access', 'SUCCESS',
            format('%s given the %s role by auth user %s; a login for that address already existed, so access is live now',
                   v_email, p_role, v_actor::text),
            v_tenant);

    return query select v_tenant, v_email, p_role, 'MEMBER_ADDED'::text,
      'A NEXUS login already exists for that address, so access is live now. Nothing was emailed: this system does not send sign-in links and holds no credential.'::text;
    return;
  end if;

  insert into public.tenant_member_invite
    (tenant_id, email, role, staff_user_id, created_by)
  values (v_tenant, v_email, p_role, p_staff_user_id, v_actor);

  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('Team Access', 'SUCCESS',
          format('%s recorded as %s by auth user %s; it takes effect the first time a login for that address signs in',
                 v_email, p_role, v_actor::text),
          v_tenant);

  return query select v_tenant, v_email, p_role, 'PENDING_FIRST_SIGN_IN'::text,
    'The role is recorded and will be applied the first time somebody signs in with that address. NEXUS cannot send them a sign-in link -- that needs the Supabase Auth invite, which requires a key this dashboard deliberately does not hold. Somebody with the Supabase project has to invite the address, or the person has to be given a sign-in route another way.'::text;
end;
$fn$;

comment on function public.nexus_team_invite(text, text, uuid) is
  'Record that whoever proves they own this email address is a member of the caller''s dealership at this role. Owner or admin only. NEVER sends anything and never handles a credential: it either completes the membership (a login already exists) or leaves it pending until one does.';

create or replace function public.nexus_team_cancel_invite(
  p_email text
)
returns table (
  tenant_id uuid,
  email     text,
  cancelled integer
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor  uuid := auth.uid();
  v_email  text;
  v_tenant uuid;
  v_ids    uuid[];
  v_n      integer;
  v_cnt    integer;
begin
  if v_actor is null then
    raise exception using errcode = 'NX001',
      message = 'There is no signed-in user on this request, so nothing was cancelled.',
      detail  = 'NX_TEAM_NO_SESSION',
      hint    = 'Sign in again and retry.';
  end if;

  v_email := lower(btrim(coalesce(p_email, '')));

  select array_agg(x) into v_ids
    from public.nexus_tenant_ids_for_roles(array['owner','admin']::text[]) x;
  v_n      := coalesce(array_length(v_ids, 1), 0);
  v_tenant := v_ids[1];

  if v_n = 0 then
    raise exception using errcode = 'NX001',
      message = 'You may not change who is waiting to join this dealership.',
      detail  = 'NX_TEAM_INVITE_REFUSED',
      hint    = 'Cancelling a pending role is an owner or admin decision.';
  end if;

  if v_n > 1 then
    raise exception using errcode = 'NX001',
      message = 'Your account manages more than one dealership, so it is not clear which pending role to cancel.',
      detail  = 'NX_TEAM_INVITE_AMBIGUOUS_TENANT',
      hint    = 'Cancelling across dealerships needs a screen that asks first.';
  end if;

  update public.tenant_member_invite i
     set revoked_at = now(), revoked_by = v_actor
   where i.tenant_id = v_tenant
     and lower(btrim(i.email)) = v_email
     and i.revoked_at is null
     and i.claimed_at is null;
  get diagnostics v_cnt = row_count;

  if v_cnt = 0 then
    raise exception using errcode = 'NX001',
      message = 'There is no pending role for that address at this dealership, so nothing was cancelled.',
      detail  = 'NX_TEAM_NO_OPEN_INVITE',
      hint    = 'It may already have been taken up, in which case remove their access instead, or already cancelled.';
  end if;

  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('Team Access', 'SUCCESS',
          format('pending role for %s cancelled by auth user %s', v_email, v_actor::text),
          v_tenant);

  return query select v_tenant, v_email, v_cnt;
end;
$fn$;

comment on function public.nexus_team_cancel_invite(text) is
  'Withdraw a pending membership before anybody has signed in against it. Owner or admin only.';

create or replace function public.nexus_team_pending()
returns table (
  tenant_id       uuid,
  email           text,
  account_role    text,
  staff_user_id   uuid,
  staff_name      text,
  recorded_at     timestamptz,
  recorded_by     uuid,
  has_login       boolean
)
language sql
security definer
stable
set search_path = public
as $fn$
  select
    i.tenant_id,
    i.email,
    i.role,
    i.staff_user_id,
    u.name,
    i.created_at,
    i.created_by,
    -- Whether a login already exists for the address. It should not, because
    -- nexus_team_invite() completes the membership immediately when one does --
    -- so a true here means the account was created some other way and the
    -- trigger has not run for it, which is a condition worth seeing rather than
    -- hiding.
    exists (select 1 from auth.users au where lower(btrim(au.email)) = lower(btrim(i.email)))
  from public.tenant_member_invite i
  left join public.users u on u.id = i.staff_user_id and u.tenant_id = i.tenant_id
  where i.revoked_at is null
    and i.claimed_at is null
    and i.tenant_id in (select public.nexus_current_tenant_ids())
  order by i.created_at;
$fn$;

comment on function public.nexus_team_pending() is
  'People whose role at the caller''s dealership has been decided but who have not signed in yet. Scoped by nexus_current_tenant_ids().';

revoke all on function public.nexus_claim_pending_membership()             from public, anon, authenticated;
revoke all on function public.nexus_team_invite(text, text, uuid)          from public, anon;
revoke all on function public.nexus_team_cancel_invite(text)               from public, anon;
revoke all on function public.nexus_team_pending()                         from public, anon;
grant execute on function public.nexus_team_invite(text, text, uuid)       to authenticated, service_role;
grant execute on function public.nexus_team_cancel_invite(text)            to authenticated, service_role;
grant execute on function public.nexus_team_pending()                      to authenticated, service_role;