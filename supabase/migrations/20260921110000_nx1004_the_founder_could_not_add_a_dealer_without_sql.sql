-- NX1004 — The founder could not add a dealer without SQL.
--
-- ORIGINAL DEFECT. The founder console has no console. Every dealership in
-- this database exists because somebody with a SQL editor ran
-- nexus_onboard_dealership() by hand; every suspension, every archive, every
-- look at the quarantine tenant is the same story. Growing this business past
-- the founder's own laptop means growing it past the founder's own SQL editor,
-- and today there is nothing between "type SQL into Supabase" and "nothing
-- happens".
--
-- This migration is the database half of a founder console: four
-- SECURITY DEFINER functions, every one of them gated on
-- public.nexus_is_platform_admin() -- built in nx1003, on branch
-- feat/subscription, and NOT reimplemented here. If that function is not yet
-- live when this migration runs, every function below fails closed: an
-- undefined function is a hard error, not a bypass.
--
-- WHAT IS NOT REIMPLEMENTED, ON PURPOSE.
--   * public.platform_admin / public.nexus_is_platform_admin()  -- nx1003.
--   * public.nexus_onboard_dealership()                          -- nexus_mt_06,
--     last redefined in tenancy_quarantine_replaces_dealership_default. It
--     already does the hard part: create-or-find the tenant row, require a
--     real auth.users login for the owner email, write the staff directory
--     row, write the tenant_members row. nexus_founder_onboard_dealer() below
--     is a thin gate in front of it plus one field it has no place for
--     (a phone number), not a second copy of its logic.
--   * public.nexus_quarantine_census()  -- tenancy_quarantine_replaces_
--     dealership_default. SECURITY INVOKER, revoked from anon/authenticated,
--     so today only service_role can read it. nexus_founder_quarantine_census()
--     below is a SECURITY DEFINER shim that lets the platform admin's own
--     browser session read the same figures without a service-role key ever
--     touching the browser.
--
-- WHY EVERY FUNCTION HERE RAISES RATHER THAN RETURNING EMPTY. A dealer-facing
-- screen that finds no rows is describing the dealer's business ("no leads
-- today"). A founder-only function called by somebody who is not the founder
-- is not describing the platform's business -- it is describing an
-- authorisation failure, and PATTERN.md's own rule (a missing row is not
-- proof an event did not happen) argues for the loud failure here even more
-- than it does on the dealer side: an empty tenant list next to a plain
-- console UI reads as "no dealers exist", which is a catastrophic thing for a
-- non-founder screen to imply by accident.
-- ===========================================================================

-- ── nexus_founder_onboard_dealer() needs somewhere to put a phone number ────
-- nexus_onboard_dealership() has no phone field and is not being changed to
-- grow one just for this: it is called from three other places
-- (nexus_mt_06, mt_keys, chanreg_04's comment references it) and none of
-- them carry a phone number today. `owner_phone` lives on `tenants` because
-- the founder console captures it about the DEALERSHIP's primary contact at
-- onboarding time, not about any one staff record, and it is optional: a
-- dealer onboarded from the SQL editor before this migration simply has it
-- null, which is a true "not recorded" rather than a guess.
alter table public.tenants add column if not exists owner_phone text;

comment on column public.tenants.owner_phone is
  'The owner''s contact number, captured by the founder console at onboarding (nexus_founder_onboard_dealer). Optional and never a second identity for the tenant -- nothing keys off it.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. nexus_founder_list_tenants() -- the roster the founder actually needs
-- ═══════════════════════════════════════════════════════════════════════════
-- One row per dealership (the quarantine tenant is never a dealership and is
-- excluded, the same way nexus_onboard_dealership() itself refuses to touch
-- it). Every count is a LEFT JOIN aggregate rather than a correlated
-- subquery per row, so a founder with a hundred dealerships gets one scan of
-- each table, not a hundred.
--
-- `is_test` is a naming convention, not a stored flag: any dealership whose
-- slug starts `test-` is treated as a test tenant, matching the convention
-- this codebase already uses for the quarantine/default tenant family. It is
-- computed here, every read, so renaming a slug away from `test-` clears the
-- flag with no migration and no forgotten row.
create or replace function public.nexus_founder_list_tenants()
returns table (
  tenant_id           uuid,
  name                text,
  slug                text,
  status              text,
  created_at          timestamptz,
  member_count        bigint,
  leads_count         bigint,
  subscription_status text,
  last_activity_at    timestamptz,
  is_test             boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
begin
  if not public.nexus_is_platform_admin() then
    raise exception using errcode = 'NX001',
      message = 'Only the NEXUS founder console may list every dealership.',
      detail  = 'NX_FOUNDER_ONLY',
      hint    = 'Sign in as the platform admin account, or ask them to run this for you.';
  end if;

  return query
  select
    t.id,
    t.name,
    t.slug,
    t.status,
    t.created_at,
    coalesce(mc.cnt, 0)::bigint  as member_count,
    coalesce(lc.cnt, 0)::bigint  as leads_count,
    ts.state                     as subscription_status,
    greatest(t.created_at, coalesce(lc.newest, t.created_at), coalesce(al.newest, t.created_at))
                                  as last_activity_at,
    (t.slug like 'test-%')       as is_test
  from public.tenants t
  left join (select tenant_id, count(*) cnt from public.tenant_members group by tenant_id) mc
    on mc.tenant_id = t.id
  left join (select tenant_id, count(*) cnt, max(created_at) newest from public.leads group by tenant_id) lc
    on lc.tenant_id = t.id
  left join (select tenant_id, max(logged_at) newest from public.audit_log group by tenant_id) al
    on al.tenant_id = t.id
  left join public.tenant_subscription ts
    on ts.tenant_id = t.id
  where not t.is_quarantine
  order by t.created_at desc;
end;
$fn$;

comment on function public.nexus_founder_list_tenants() is
  'Founder-only roster of every dealership: member and lead counts, subscription state, last activity and a test-tenant flag. Gated on nexus_is_platform_admin(); raises rather than returning empty for anyone else.';

revoke all on function public.nexus_founder_list_tenants() from public, anon, authenticated;
grant execute on function public.nexus_founder_list_tenants() to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. nexus_founder_onboard_dealer() -- a thin gate in front of the real thing
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.nexus_founder_onboard_dealer(
  p_name        text,
  p_slug        text,
  p_owner_email text,
  p_phone       text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_tenant uuid;
begin
  if not public.nexus_is_platform_admin() then
    raise exception using errcode = 'NX001',
      message = 'Only the NEXUS founder console may onboard a dealership.',
      detail  = 'NX_FOUNDER_ONLY',
      hint    = 'Sign in as the platform admin account, or ask them to run this for you.';
  end if;

  -- Everything that makes a dealership real -- the tenant row, the owner's
  -- auth.users lookup, the staff directory row, the tenant_members row --
  -- happens inside nexus_onboard_dealership(). It already raises its own
  -- clear exceptions (missing slug, quarantine slug collision, no login for
  -- the owner email) and those propagate through this wrapper unchanged:
  -- duplicating its validation here is exactly the kind of second copy that
  -- drifts from the first.
  v_tenant := public.nexus_onboard_dealership(p_slug, p_name, p_owner_email, 'owner');

  if p_phone is not null and btrim(p_phone) <> '' then
    update public.tenants set owner_phone = btrim(p_phone) where id = v_tenant;
  end if;

  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('Founder Console', 'SUCCESS',
          format('Founder onboarded dealership "%s" (%s) with owner %s', p_name, p_slug, p_owner_email),
          v_tenant);

  return v_tenant;
end;
$fn$;

comment on function public.nexus_founder_onboard_dealer(text, text, text, text) is
  'Founder-only onboarding: gates nexus_onboard_dealership() on nexus_is_platform_admin() and records an optional owner phone number the underlying function has no field for.';

revoke all on function public.nexus_founder_onboard_dealer(text, text, text, text) from public, anon, authenticated;
grant execute on function public.nexus_founder_onboard_dealer(text, text, text, text) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. nexus_founder_set_tenant_status() -- active / suspended / archived
-- ═══════════════════════════════════════════════════════════════════════════
-- Quarantine is deliberately NOT in the vocabulary this function accepts.
-- tenants_quarantine_is_never_active (CHECK (is_quarantine = (status =
-- 'quarantine'))) ties quarantine status to the one tenant that is_quarantine,
-- and a founder console that could set an ordinary dealership's status to
-- 'quarantine' would either violate that constraint or, worse, would not --
-- because nothing here flips is_quarantine, so the row would be rejected by
-- the constraint and the founder would see a raw Postgres error instead of
-- this function's own clear one. Refusing the value before the database gets
-- a chance to is the same trade this codebase makes everywhere else: a named
-- exception here, not a constraint violation there.
create or replace function public.nexus_founder_set_tenant_status(
  p_tenant uuid,
  p_status text
)
returns public.tenants
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_row public.tenants;
begin
  if not public.nexus_is_platform_admin() then
    raise exception using errcode = 'NX001',
      message = 'Only the NEXUS founder console may change a dealership''s status.',
      detail  = 'NX_FOUNDER_ONLY',
      hint    = 'Sign in as the platform admin account, or ask them to run this for you.';
  end if;

  if p_status is null or p_status not in ('active', 'suspended', 'archived') then
    raise exception using errcode = 'NX001',
      message = 'That is not a status the founder console may set.',
      detail  = 'NX_FOUNDER_STATUS_NOT_IN_VOCABULARY',
      hint    = 'The founder console may set active, suspended or archived. Quarantine is a system state carried by exactly one tenant and is never set here.';
  end if;

  select * into v_row from public.tenants t where t.id = p_tenant;
  if not found then
    raise exception using errcode = 'NX001',
      message = 'No dealership matches that id, so nothing was changed.',
      detail  = 'NX_FOUNDER_TENANT_NOT_FOUND';
  end if;

  if v_row.is_quarantine then
    raise exception using errcode = 'NX001',
      message = 'The quarantine tenant is not a dealership and its status may not be changed here.',
      detail  = 'NX_FOUNDER_QUARANTINE_PROTECTED';
  end if;

  update public.tenants set status = p_status where id = p_tenant returning * into v_row;

  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('Founder Console', 'SUCCESS',
          format('Founder set dealership "%s" (%s) to status %s', v_row.name, v_row.slug, p_status),
          p_tenant);

  return v_row;
end;
$fn$;

comment on function public.nexus_founder_set_tenant_status(uuid, text) is
  'Founder-only status change for one dealership: active, suspended or archived. Refuses the quarantine tenant and any status outside that vocabulary. Gated on nexus_is_platform_admin().';

revoke all on function public.nexus_founder_set_tenant_status(uuid, text) from public, anon, authenticated;
grant execute on function public.nexus_founder_set_tenant_status(uuid, text) to authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. nexus_founder_quarantine_census() -- the vendor's own read of the landfill
-- ═══════════════════════════════════════════════════════════════════════════
-- nexus_quarantine_census() is SECURITY INVOKER by design (see its own
-- comment: "read as service_role it counts everything, read as a dealership
-- session RLS filters every branch to zero"), and its EXECUTE grant was
-- revoked from anon and authenticated so a dealership session cannot even
-- attempt the zeroed-out read. This wrapper is SECURITY DEFINER, so once the
-- platform-admin gate passes, the nested call to nexus_quarantine_census()
-- runs as this function's definer -- the same elevated context service_role
-- reads it in today -- and returns the real counts, without a service-role
-- key ever reaching the browser.
create or replace function public.nexus_founder_quarantine_census()
returns table (tbl text, rows bigint, newest timestamptz)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
begin
  if not public.nexus_is_platform_admin() then
    raise exception using errcode = 'NX001',
      message = 'Only the NEXUS founder console may read the quarantine census.',
      detail  = 'NX_FOUNDER_ONLY',
      hint    = 'Sign in as the platform admin account, or ask them to run this for you.';
  end if;

  return query select * from public.nexus_quarantine_census();
end;
$fn$;

comment on function public.nexus_founder_quarantine_census() is
  'Founder-only read of nexus_quarantine_census(): rows sitting in the UNATTRIBUTED quarantine tenant, per table, without a service-role key in the browser. Gated on nexus_is_platform_admin().';

revoke all on function public.nexus_founder_quarantine_census() from public, anon, authenticated;
grant execute on function public.nexus_founder_quarantine_census() to authenticated, service_role;
