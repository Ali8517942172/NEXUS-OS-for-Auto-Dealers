-- ===========================================================================
-- team_01_a_dealership_can_see_who_has_access
--
-- WHY. rbac_01..rbac_05 (5 Sep 2026) built a real role model on
-- public.tenant_members.role and proved it adversarially. Its own closing note
-- is the defect this migration starts on: there is no product surface for it.
-- A dealership cannot see who has access, cannot change a role and cannot take
-- access away when a rep leaves.
--
-- AND IT CANNOT EVEN LOOK. Measured before anything was changed, on staging
-- and on production:
--
--   tenant_members  relacl  authenticated=r  (no column ACL)
--   policy tenant_members_self_read  SELECT  authenticated  USING
--           (auth_user_id = auth.uid())
--
-- So a signed-in owner reads exactly one row -- their own. The roster of
-- colleagues is not filtered down to something small; it is structurally
-- unreadable. auth.users, which holds the address a colleague signs in with,
-- is not readable by `authenticated` at all.
--
-- WHAT THIS DOES NOT DO, deliberately. It does not widen
-- tenant_members_self_read to the dealership, and it does not grant a column on
-- auth.users. The precedent is nexus_workflow_catalogue() from this morning:
-- when the thing a dealership is entitled to is a PROJECTION of a table rather
-- than the table, the projection is the grant. A SECURITY DEFINER accessor can
-- also join auth.users -- which no widening of a public policy could reach --
-- and it makes adding a column to the roster the deliberate act it should be
-- rather than whatever nobody revoked.
--
-- WHO GETS ROWS. Only through public.nexus_current_tenant_ids(), which is the
-- same key every tenant-scoped policy in this database already uses: a member
-- of an ACTIVE dealership sees that dealership's members and nobody else's. A
-- caller with no membership row gets zero rows, and so does service_role --
-- there is no auth.uid() on an n8n request, so nexus_current_tenant_ids()
-- returns the empty set. That is fail-closed and it is the right direction for
-- a dealership screen: this accessor is not a platform census.
--
-- is_approver IS NULLABLE ON PURPOSE. It is computed from this dealership's
-- inventory_action_policy row with the same two predicates
-- action_approver_context() applies -- account role in approver_tenant_roles,
-- or job title in approver_staff_roles. Where no policy row exists nobody has
-- STATED who may approve, and that is not the same as nobody being an
-- approver. It returns NULL with approver_basis = 'NO_POLICY' rather than
-- false, because "unknown rendered as a fact" is a mistake this codebase has
-- already paid for six times.
--
-- action_approver_context() remains the authority on the CALLER's own answer
-- and is unchanged; this is the same rule read across other people, which that
-- function cannot answer because it only ever speaks about auth.uid().
-- ===========================================================================

create or replace function public.nexus_team_roster()
returns table (
  tenant_id       uuid,
  tenant_slug     text,
  tenant_name     text,
  auth_user_id    uuid,
  email           text,
  account_role    text,
  staff_user_id   uuid,
  staff_name      text,
  staff_job_title text,
  staff_status    text,
  member_since    timestamptz,
  last_sign_in_at timestamptz,
  is_self         boolean,
  is_approver     boolean,
  approver_basis  text
)
language sql
security definer
stable
set search_path = public
as $fn$
  select
    t.id,
    t.slug,
    t.name,
    m.auth_user_id,
    au.email::text,
    m.role,
    m.staff_user_id,
    u.name,
    u.role,
    u.status,
    m.created_at,
    au.last_sign_in_at,
    (m.auth_user_id = auth.uid()),
    case
      when p.tenant_id is null then null
      when m.role = any (p.approver_tenant_roles) then true
      when u.role is not null
           and array_length(p.approver_staff_roles, 1) is not null
           and lower(u.role) = any (select lower(x) from unnest(p.approver_staff_roles) x)
        then true
      else false
    end,
    case
      when p.tenant_id is null then 'NO_POLICY'
      when m.role = any (p.approver_tenant_roles) then 'TENANT_ROLE'
      when u.role is not null
           and array_length(p.approver_staff_roles, 1) is not null
           and lower(u.role) = any (select lower(x) from unnest(p.approver_staff_roles) x)
        then 'STAFF_ROLE_POLICY'
      else null
    end
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  -- INNER join: a membership row whose auth account has been deleted is not a
  -- person with access, and rendering one would tell a dealership somebody can
  -- sign in who cannot. The FK is ON DELETE CASCADE, so this cannot arise
  -- today; the join is written this way so it still cannot if that changes.
  join auth.users au on au.id = m.auth_user_id
  -- LEFT join: staff_user_id is nullable, and a member who is not linked to a
  -- public.users row is exactly the condition rbac's open item 4 describes --
  -- they can edit no leads at all. It must be visible, not dropped.
  left join public.users u
    on u.id = m.staff_user_id and u.tenant_id = m.tenant_id
  left join public.inventory_action_policy p on p.tenant_id = m.tenant_id
  where m.tenant_id in (select public.nexus_current_tenant_ids())
  order by
    case m.role
      when 'owner' then 0 when 'admin' then 1 when 'manager' then 2
      when 'sales' then 3 when 'technician' then 4 else 5 end,
    coalesce(u.name, au.email::text);
$fn$;

comment on function public.nexus_team_roster() is
  'The members of the caller''s own active dealership: who, what account role, when they were added, whether they are linked to a staff record and whether they may approve an inventory action. Scoped by nexus_current_tenant_ids(), the same key the RLS policies use. is_approver is NULL where the dealership has stated no approval policy -- unknown, not no.';

-- Supabase's default privileges grant EXECUTE directly to anon and
-- authenticated on every new function, and REVOKE ... FROM PUBLIC does not
-- touch a direct grant. Revoke from both, by name, then grant deliberately.
revoke all on function public.nexus_team_roster() from public, anon;
grant execute on function public.nexus_team_roster() to authenticated, service_role;