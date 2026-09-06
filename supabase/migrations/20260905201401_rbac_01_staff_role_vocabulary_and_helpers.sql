-- ===========================================================================
-- rbac_01_staff_role_vocabulary_and_helpers
--
-- WHY. inventory and leads grant ALL to every tenant_member. polcmd = '*' on
-- both, and the only qualifier is the dealership. So a junior sales rep with a
-- dashboard login can rewrite cost price, delete a vehicle, and reassign
-- another rep's lead -- and can do it straight against PostgREST with the same
-- JWT, which is why hiding a button is not a control here.
--
-- WHAT THIS MIGRATION DOES. Nothing on its own. It only widens the account
-- authority vocabulary and adds the two helpers the policies in
-- rbac_02 and rbac_04 read. Applying this alone changes no privilege.
--
-- WHERE AUTHORITY COMES FROM, and it is not a new idea here.
-- action_02_approval_authority already settled it for the Action Center:
--
--   ACCOUNT AUTHORITY  public.tenant_members.role -- "who runs the NEXUS
--                      account for this dealership". Constrained, small,
--                      and set by a person.
--   JOB TITLE          public.users.role -- the staff directory, free text
--                      ('senior_rep' today), and deliberately NOT authority.
--
-- This lane extends the same column rather than inventing a second one, so a
-- dealership has exactly one place to answer "what may this person do".
--
-- THE VOCABULARY. owner / admin / manager already existed. sales and
-- technician are added because the product needs to distinguish "a rep who
-- works their own leads" from "a workshop user who touches no commercial
-- field". member is kept -- it is the column DEFAULT and the two staging
-- fixtures hold it -- and is now the LEAST privileged label rather than the
-- most: it is read-only on inventory and, on leads, equal to sales.
--
-- The direction of that change matters. Today `member` means "everything".
-- After rbac_02 and rbac_04 it means "your own leads". Nobody in production
-- holds it (measured 2026-09-05: ALBA CARS has exactly ONE tenant_members row
-- and it is role = 'owner'), so this takes nothing away from a live user --
-- but it does mean a member added LATER without an explicit role lands on the
-- floor and not the ceiling, which is the direction a default should fail in.
--
-- inventory_action_policy's own CHECK is widened to the same vocabulary so the
-- two do not diverge. That grants nobody anything: approver_tenant_roles is
-- data, its seeded value is unchanged, and only a dealership may widen it.
-- ===========================================================================

alter table public.tenant_members drop constraint if exists tenant_members_role_check;
alter table public.tenant_members add constraint tenant_members_role_check
  check (role = any (array['owner','admin','manager','sales','technician','member']::text[]));

comment on column public.tenant_members.role is
  'Account authority for this dealership, and the ONLY thing the inventory and leads '
  'write policies read. owner/admin: everything, including cost price and deleting a '
  'vehicle. manager: operational management -- may add nothing, may change asking price '
  'and any other non-cost field, may reassign any lead. sales: may update the leads '
  'assigned to them and nothing else. technician: read-only on both tables -- '
  'operational modules only, no commercial field. member: the column default and the '
  'least privileged label; equal to sales on leads, read-only on inventory. '
  'public.users.role is a JOB TITLE and confers no authority.';

alter table public.inventory_action_policy drop constraint if exists inventory_action_policy_tenant_roles_check;
alter table public.inventory_action_policy add constraint inventory_action_policy_tenant_roles_check
  check (approver_tenant_roles <@ array['owner','admin','manager','sales','technician','member']::text[]);

-- ---------------------------------------------------------------------------
-- The two helpers. Both are the same shape as nexus_current_tenant_ids():
-- SECURITY DEFINER because an ordinary caller may read only their own
-- tenant_members row (tenant_members_self_read), and a policy that had to read
-- every row would need a wider grant than the policy is worth. Both return a
-- SET, so "no authority" is zero rows and an `in (select ...)` is false rather
-- than null.
-- ---------------------------------------------------------------------------

create or replace function public.nexus_tenant_ids_for_roles(p_roles text[])
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select m.tenant_id
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
   where auth.uid() is not null
     and m.auth_user_id = auth.uid()
     and m.role = any (p_roles);
$fn$;

comment on function public.nexus_tenant_ids_for_roles(text[]) is
  'The dealerships where the signed-in user holds one of the named account roles. '
  'nexus_current_tenant_ids() answers "which dealership is this person in"; this answers '
  '"and with what authority". Returns zero rows for a signed-out caller, for a suspended '
  'dealership, and for a member whose role is not in the list.';

create or replace function public.nexus_my_staff_user_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select m.staff_user_id
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
   where auth.uid() is not null
     and m.auth_user_id = auth.uid()
     and m.staff_user_id is not null;
$fn$;

comment on function public.nexus_my_staff_user_ids() is
  'The public.users rows this login is linked to, which is how leads.assigned_to_id -- a '
  'staff id, not an auth id -- is matched to the person reading it. staff_user_id is '
  'NULLABLE, so a login that was never linked to a staff row returns zero rows and owns '
  'no leads. That is deliberate: an unlinked sales login can edit nothing, which is the '
  'safe direction for a link somebody forgot to make.';

revoke all on function public.nexus_tenant_ids_for_roles(text[]) from public, anon;
revoke all on function public.nexus_my_staff_user_ids() from public, anon;
grant execute on function public.nexus_tenant_ids_for_roles(text[]) to authenticated, service_role;
grant execute on function public.nexus_my_staff_user_ids() to authenticated, service_role;