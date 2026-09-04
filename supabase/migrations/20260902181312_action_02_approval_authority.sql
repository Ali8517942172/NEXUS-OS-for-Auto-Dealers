-- ===========================================================================
-- action_02_approval_authority
--
-- BUSINESS RULE: approving a recommendation that moves the price of a car is a
-- commercial decision with money attached. Who may make it is a rule of the
-- dealership, so it is enforced in the database and configured as data. A
-- disabled button in a browser is not an authorisation rule - anyone with the
-- anon key and a session can call PostgREST directly.
--
-- TWO INDEPENDENT PATHS TO AUTHORITY, and they are different things:
--
--   ACCOUNT AUTHORITY  public.tenant_members.role, which already exists and is
--                      already constrained to owner / admin / manager / member.
--                      This is "who runs the NEXUS account for this
--                      dealership". The owner of a dealership may approve a
--                      reprice on their own lot; that needs no new vocabulary
--                      and no invention.
--
--   JOB TITLE          public.users.role - the staff directory. Empty by
--                      default here on purpose. A dealership must say which job
--                      titles may approve before a job title grants anything.
--
-- WHY approver_staff_roles STARTS EMPTY
--   The engine's suggested_owner_role for every actionable unit today is
--   'Sales Manager', and it says in its own note that this is a role and not a
--   person because NEXUS holds no role directory it can verify. Seeding a
--   default that happened to match the one staff member's title
--   ('senior_rep') would have handed approval rights to the only person in the
--   building while looking like a default. That is exactly the silent grant
--   this lane was told not to make. So: empty, and the dealership fills it in.
--
-- WHAT HAPPENS WHEN NO APPROVER EXISTS
--   Measured on 2026-09-02: ALBA CARS has one staff row (Ali Asgher,
--   users.role = 'senior_rep') and no manager. It also has exactly one
--   tenant_members row, and that row is role = 'owner'. So approval is
--   possible today by ACCOUNT AUTHORITY and impossible by JOB TITLE, and the
--   record says which of the two was used every single time.
--   Where neither exists, action_decide() does NOT approve. It records an
--   ESCALATED audit row, stamps escalated_at on the action, leaves the action
--   PROPOSED, and returns a refusal naming what is missing. An escalation is a
--   request for a person, not a decision.
-- ===========================================================================

create table if not exists public.inventory_action_policy (
  tenant_id                uuid primary key references public.tenants(id) on delete cascade,
  approver_tenant_roles    text[] not null default array['owner', 'admin', 'manager']::text[],
  approver_staff_roles     text[] not null default array[]::text[],
  reproposal_cooldown_days integer not null default 14,
  set_by                   text,
  set_at                   timestamptz not null default now(),
  note                     text,
  constraint inventory_action_policy_cooldown_check check (reproposal_cooldown_days between 0 and 365),
  constraint inventory_action_policy_tenant_roles_check check (
    approver_tenant_roles <@ array['owner', 'admin', 'manager', 'member']::text[]
  )
);

comment on table public.inventory_action_policy is
  'Who may approve an inventory action at this dealership, as data rather than as code. '
  'approver_tenant_roles reuses the existing tenant_members.role vocabulary (account '
  'authority). approver_staff_roles is checked against users.role (job title) and is EMPTY '
  'by default so that no job title grants approval until the dealership says it does. '
  'reproposal_cooldown_days stops a rejected recommendation being pushed back at the same '
  'manager the next morning; a rejection that is ignored is not a rejection.';
comment on column public.inventory_action_policy.approver_staff_roles is
  'Deliberately empty on seed. Defaulting this to anything would grant approval to whoever '
  'happened to hold that job title, which is a silent authorisation grant dressed as a '
  'default. Only a dealership may widen it.';
comment on column public.inventory_action_policy.reproposal_cooldown_days is
  'Days after a REJECTED or CANCELLED decision during which action_propose() will not raise '
  'the same recommendation for the same unit again. It returns the previous decision '
  'instead, so the person can see they already answered this.';

insert into public.inventory_action_policy (tenant_id, set_by, note)
select t.id, 'migration action_02_approval_authority',
       'Seeded default: account authority (owner/admin/manager) may approve; no job title may. '
       'Widen approver_staff_roles only by an explicit decision of the dealership.'
  from public.tenants t
 where t.status = 'active'
on conflict (tenant_id) do nothing;

alter table public.inventory_action_policy enable row level security;

drop policy if exists inventory_action_policy_read on public.inventory_action_policy;
create policy inventory_action_policy_read on public.inventory_action_policy
  for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists inventory_action_policy_deny_anon on public.inventory_action_policy;
create policy inventory_action_policy_deny_anon on public.inventory_action_policy
  as restrictive for all to anon using (false) with check (false);

drop policy if exists inventory_action_policy_service_role_all on public.inventory_action_policy;
create policy inventory_action_policy_service_role_all on public.inventory_action_policy
  for all to service_role using (true) with check (true);

revoke all on public.inventory_action_policy from anon, authenticated;
grant select on public.inventory_action_policy to authenticated;
grant all    on public.inventory_action_policy to service_role;

-- ---------------------------------------------------------------------------
-- Who is calling, and may they decide?
--
-- SECURITY DEFINER because it must read tenant_members and users beyond the
-- caller's own row to answer "does anyone here hold an approving role" - the
-- question the escalation path depends on. Every read below is bounded to the
-- tenant the CALLER already resolves to through nexus_current_tenant_id(),
-- which is itself membership-derived. It returns no row for another dealership
-- and it cannot be asked about one: there is no tenant argument.
-- ---------------------------------------------------------------------------
create or replace function public.action_approver_context()
returns table (
  auth_user_id            uuid,
  tenant_id               uuid,
  tenant_role             text,
  staff_id                uuid,
  staff_name              text,
  staff_role              text,
  may_decide              boolean,
  authority               text,
  refusal_code            text,
  refusal_reason          text,
  tenant_has_any_approver boolean,
  approver_tenant_roles   text[],
  approver_staff_roles    text[]
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_auth      uuid := auth.uid();
  v_tenant    uuid;
  v_email     text;
  v_trole     text;
  v_staff     public.users%rowtype;
  v_pol       public.inventory_action_policy%rowtype;
  v_may       boolean := false;
  v_auth_word text;
  v_any       boolean := false;
begin
  if v_auth is null then
    return query select null::uuid, null::uuid, null::text, null::uuid, null::text, null::text,
                        false, null::text, 'NO_SESSION',
                        'There is no signed-in user on this request, so nothing can be decided.',
                        false, null::text[], null::text[];
    return;
  end if;

  v_tenant := public.nexus_current_tenant_id();
  if v_tenant is null then
    return query select v_auth, null::uuid, null::text, null::uuid, null::text, null::text,
                        false, null::text, 'NO_TENANT',
                        'This account is not a member of any dealership, so it can see no units and decide nothing.',
                        false, null::text[], null::text[];
    return;
  end if;

  select m.role into v_trole
    from public.tenant_members m
   where m.tenant_id = v_tenant and m.auth_user_id = v_auth;

  select p.* into v_pol from public.inventory_action_policy p where p.tenant_id = v_tenant;
  if not found then
    -- No policy row means no rule has been stated. Refuse rather than assume
    -- one: an unconfigured dealership is not an open one.
    return query select v_auth, v_tenant, v_trole, null::uuid, null::text, null::text,
                        false, null::text, 'NO_POLICY',
                        'This dealership has no inventory_action_policy row, so who may approve has never been stated. Nobody may approve until it is.',
                        false, null::text[], null::text[];
    return;
  end if;

  -- The staff row. tenant_members.staff_user_id is the explicit link and wins;
  -- email is the fallback because that is how the dashboard already resolves
  -- "me" (app.js reads users?email=eq.<session email>).
  v_email := nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), '');
  select u.* into v_staff
    from public.tenant_members m
    join public.users u on u.id = m.staff_user_id and u.tenant_id = v_tenant
   where m.tenant_id = v_tenant and m.auth_user_id = v_auth;
  if not found and v_email is not null then
    select u.* into v_staff
      from public.users u
     where u.tenant_id = v_tenant and lower(u.email) = lower(v_email)
     limit 1;
  end if;

  if v_trole is not null and v_trole = any (v_pol.approver_tenant_roles) then
    v_may := true;
    v_auth_word := 'TENANT_' || upper(v_trole);
  elsif v_staff.role is not null
        and array_length(v_pol.approver_staff_roles, 1) is not null
        and lower(v_staff.role) = any (select lower(x) from unnest(v_pol.approver_staff_roles) x) then
    v_may := true;
    v_auth_word := 'STAFF_ROLE_POLICY';
  end if;

  -- Does ANYBODY here hold an approving role? This is what separates "you may
  -- not approve, ask your manager" from "this dealership has no manager", and
  -- those two need different answers from the person reading the screen.
  select exists (
      select 1 from public.tenant_members m
       where m.tenant_id = v_tenant and m.role = any (v_pol.approver_tenant_roles))
      or exists (
      select 1 from public.users u
       where u.tenant_id = v_tenant
         and u.role is not null
         and array_length(v_pol.approver_staff_roles, 1) is not null
         and lower(u.role) = any (select lower(x) from unnest(v_pol.approver_staff_roles) x))
    into v_any;

  return query select
    v_auth, v_tenant, v_trole, v_staff.id, v_staff.name, v_staff.role,
    v_may, v_auth_word,
    case when v_may then null
         when not v_any then 'NO_APPROVER_AT_DEALERSHIP'
         else 'NOT_AN_APPROVER' end,
    case when v_may then null
         when not v_any then
           'Nobody at this dealership holds a role allowed to approve an inventory action. '
           || 'Account roles allowed: ' || coalesce(array_to_string(v_pol.approver_tenant_roles, ', '), 'none')
           || '. Job titles allowed: '
           || coalesce(nullif(array_to_string(v_pol.approver_staff_roles, ', '), ''), 'none - no job title has been granted approval here')
           || '. Until somebody holds one of those, this action can only be escalated.'
         else
           'This account may not approve inventory actions. Its account role is '
           || coalesce(v_trole, 'none') || ' and its job title is ' || coalesce(v_staff.role, 'none')
           || '; approval needs an account role in (' || array_to_string(v_pol.approver_tenant_roles, ', ')
           || ') or a job title in ('
           || coalesce(nullif(array_to_string(v_pol.approver_staff_roles, ', '), ''), 'none granted')
           || ').' end,
    v_any, v_pol.approver_tenant_roles, v_pol.approver_staff_roles;
end;
$$;

comment on function public.action_approver_context() is
  'Who is calling, which dealership they resolve to, and whether they may decide an '
  'inventory action - with the reason spelled out when they may not. The single authority '
  'check; action_decide(), action_cancel() and action_record_outcome() all call it and no '
  'screen may re-implement it. Answers only about the caller''s own resolved tenant; it '
  'takes no tenant argument and cannot be pointed at another dealership.';

revoke all on function public.action_approver_context() from public;
grant execute on function public.action_approver_context() to authenticated, service_role;