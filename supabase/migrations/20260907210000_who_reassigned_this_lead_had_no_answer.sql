-- Journey Lab T12, closed. "Who reassigned this lead, and when?" had no answer.
--
-- WHAT WAS MEASURED
-- -----------------
-- A direct UPDATE on public.leads -- the dashboard's own owner-assignment path,
-- apps/executive-dashboard/lib/lead-drawer.js:490 -- changed the owner and wrote
-- ZERO audit rows. Every other dashboard write goes through a SECURITY DEFINER
-- function that audits; this one is a direct table write, kept deliberately
-- because revoking the grant breaks the screen, and that consequence was priced
-- while this one was not.
--
-- WHY A TRIGGER AND NOT THE RPC THAT WAS ASKED FOR
-- -----------------------------------------------
-- The obvious fix is UI -> SECURITY DEFINER RPC -> update + audit. It is worse
-- here, for three reasons that are specific rather than stylistic:
--
--   1. A definer RPC BYPASSES RLS, so it would have to re-implement the
--      authorisation that policy leads_role_update already expresses -- owner,
--      admin and manager may reassign anything in their dealership; sales and
--      member only a lead already assigned to them. Two copies of one rule, and
--      the copy that drifts is the one that silently grants too much.
--   2. It audits ONE WRITER. n8n writes leads as service_role, which BYPASSRLS
--      and would bypass the RPC too. A trigger catches every owner change from
--      every path, including the ones nobody has written yet.
--   3. It is a NEW write surface on the dealer plane. The browser today holds
--      one narrow column-level UPDATE grant; a new definer RPC granted to
--      `authenticated` is strictly more surface, not less.
--
-- So the UPDATE stays where it is, RLS keeps deciding who may do it, and the
-- recording moves to where it cannot be skipped.
--
-- CREATE TRIGGER ON public.leads IS SAFE, AND THAT WAS MEASURED, NOT ASSUMED.
-- nexus_guard_born_open_grants() fires on EVERY ddl_command_end (evttags is
-- null), and it is the thing that has twice taken the dashboard's write grants
-- away. It acts on pg_event_trigger_ddl_commands() rows whose object_type is
-- 'table' / 'view' / 'sequence' / 'function'. CREATE TRIGGER reports
-- object_type = 'trigger', which matches no branch. Proved on staging in a
-- rolled-back transaction: 8 column grants before, 8 after; relacl byte
-- identical; has_any_column_privilege('authenticated','public.leads','UPDATE')
-- still true. That widens what can be fixed without firing the guard, and it is
-- worth knowing: the blast radius is ALTER TABLE, not "any DDL near leads".
--
-- WHAT THIS DELIBERATELY CANNOT DO
-- --------------------------------
-- A trigger sees that the owner changed, never WHY. The RPC's remaining value
-- is exactly that -- a stated reason -- so the seam is left open here:
-- current_setting('nexus.change_reason', true) is read and recorded when a
-- caller sets it in the same transaction, and is NULL otherwise. NULL means
-- nobody said, and it is stored as NULL rather than as 'unknown', because a
-- placeholder reads as an answer.
--
-- AND IT FAILS CLOSED, ON PURPOSE.
-- If the audit insert raises, the owner change is rolled back with it. An owner
-- change that cannot be recorded must not happen -- that is the entire content
-- of T12. The alternative, swallowing the error so the save always "works", is
-- the defect this migration exists to remove, one layer down.

create table if not exists public.lead_owner_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id),
  lead_id          integer not null references public.leads(id) on delete cascade,
  at               timestamptz not null default now(),
  event            text not null,
  actor_auth_id    uuid,
  actor_staff_id   uuid,
  actor_authority  text not null,
  from_staff_id    uuid,
  to_staff_id      uuid,
  from_name        text,
  to_name          text,
  reason           text,
  audit_log_id     uuid,
  constraint lead_owner_events_event_vocabulary
    check (event in ('ASSIGNED','REASSIGNED','UNASSIGNED')),
  -- An authority is either a named person or a named machine. It is never blank
  -- and never invented: a service_role write says service_role.
  constraint lead_owner_events_authority_vocabulary
    check (actor_authority in ('tenant_member','service_role','database_owner','unknown_session')),
  -- The event name must agree with what actually changed, so a row cannot say
  -- REASSIGNED about a first assignment.
  constraint lead_owner_events_event_matches_the_change
    check ((event = 'ASSIGNED'    and from_staff_id is null and to_staff_id is not null)
        or (event = 'REASSIGNED'  and from_staff_id is not null and to_staff_id is not null)
        or (event = 'UNASSIGNED'  and from_staff_id is not null and to_staff_id is null))
);

comment on table public.lead_owner_events is
  'Every change of ownership of a lead, written by a trigger on public.leads so '
  'that it cannot be skipped by any writer -- the dashboard''s direct PATCH, '
  'n8n as service_role, or a hand-run UPDATE. Answers "who reassigned this lead '
  'and when", which had no answer at all before 7 September 2026 (Journey Lab '
  'T12). reason is NULL unless a caller set nexus.change_reason in the same '
  'transaction; NULL means nobody said, and is stored as NULL rather than as a '
  'placeholder that would read as an answer.';

create index if not exists lead_owner_events_lead_idx on public.lead_owner_events (lead_id, at desc);
create index if not exists lead_owner_events_tenant_idx on public.lead_owner_events (tenant_id, at desc);

alter table public.lead_owner_events enable row level security;

-- The same three-policy shape as inventory_action_events and
-- lead_recovery_action_events: the dealership reads its own, anon is refused by
-- an explicit restrictive floor rather than by the incidental absence of a
-- grant, and nobody but the trigger writes.
drop policy if exists lead_owner_events_read on public.lead_owner_events;
create policy lead_owner_events_read on public.lead_owner_events
  for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists lead_owner_events_deny_anon on public.lead_owner_events;
create policy lead_owner_events_deny_anon on public.lead_owner_events
  as restrictive for all to anon using (false) with check (false);

drop policy if exists lead_owner_events_no_end_user_writes on public.lead_owner_events;
create policy lead_owner_events_no_end_user_writes on public.lead_owner_events
  as restrictive for all to authenticated using (true) with check (false);

drop policy if exists lead_owner_events_service_role on public.lead_owner_events;
create policy lead_owner_events_service_role on public.lead_owner_events
  for all to service_role using (true) with check (true);

grant select on public.lead_owner_events to authenticated;
grant all on public.lead_owner_events to service_role;

create or replace function public.nexus_leads_owner_change_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth       uuid := auth.uid();
  v_staff      uuid;
  v_authority  text;
  v_event      text;
  v_reason     text;
  v_audit      uuid;
  v_from_name  text;
  v_to_name    text;
  v_role       text;
begin
  -- Only an ownership change. An edit to any other column is not this event.
  if new.assigned_to_id is not distinct from old.assigned_to_id then
    return new;
  end if;

  if v_auth is not null then
    -- A person. Their staff identity is whatever tenant_members says it is for
    -- THIS lead's dealership -- not for any dealership they happen to belong to.
    select tm.staff_user_id into v_staff
      from public.tenant_members tm
     where tm.auth_user_id = v_auth and tm.tenant_id = new.tenant_id;
    v_authority := case when v_staff is not null then 'tenant_member' else 'unknown_session' end;
  else
    -- NOT current_user. This function is SECURITY DEFINER, so inside it
    -- current_user is always the OWNER (postgres) and the caller's role is
    -- invisible there. The first version tested current_user = 'service_role'
    -- and could therefore never be true: an n8n write came out labelled
    -- database_owner, which is a machine blaming a different machine. Found by
    -- running the control rather than by reading the code.
    --
    -- current_setting('role') carries the SET ROLE that PostgREST performs per
    -- request, which is the caller's effective role and survives the definer
    -- switch. It reads 'none' when no SET ROLE is active, i.e. a direct session.
    v_role := nullif(current_setting('role', true), 'none');
    if v_role = 'service_role' then
      v_authority := 'service_role';
    elsif coalesce(v_role, session_user) in ('postgres','supabase_admin') then
      v_authority := 'database_owner';
    else
      v_authority := 'unknown_session';
    end if;
  end if;

  v_event := case
               when old.assigned_to_id is null then 'ASSIGNED'
               when new.assigned_to_id is null then 'UNASSIGNED'
               else 'REASSIGNED'
             end;

  -- The seam a future RPC fills. Absent means nobody said, and stays NULL.
  v_reason := nullif(btrim(coalesce(current_setting('nexus.change_reason', true), '')), '');

  select u.name into v_from_name from public.users u where u.id = old.assigned_to_id;
  select u.name into v_to_name   from public.users u where u.id = new.assigned_to_id;

  -- An audit_log row too, because that is where every existing "what happened
  -- to this lead" reader looks. It is linked rather than duplicated: the
  -- structured answer lives in lead_owner_events and audit_log carries the
  -- sentence, which is the same split inventory_action_events already uses.
  insert into public.audit_log (workflow, status, lead_name, lead_email, summary, tenant_id)
  values ('dashboard:lead-owner-assignment', 'SUCCESS', new.name, new.email,
          v_event || ': lead ' || new.id::text || ' owner '
            || coalesce(v_from_name, '(nobody)') || ' -> ' || coalesce(v_to_name, '(nobody)')
            || ' by ' || v_authority
            || coalesce(' — ' || v_reason, ''),
          new.tenant_id)
  returning public.audit_log.id into v_audit;

  insert into public.lead_owner_events
    (tenant_id, lead_id, event, actor_auth_id, actor_staff_id, actor_authority,
     from_staff_id, to_staff_id, from_name, to_name, reason, audit_log_id)
  values
    (new.tenant_id, new.id, v_event, v_auth, v_staff, v_authority,
     old.assigned_to_id, new.assigned_to_id, v_from_name, v_to_name, v_reason, v_audit);

  return new;
end $$;

comment on function public.nexus_leads_owner_change_audit() is
  'AFTER UPDATE on public.leads. Records every ownership change and the audit_log '
  'sentence that goes with it. SECURITY DEFINER because it writes tables no '
  'end-user role may write; it takes no arguments and reads only OLD and NEW, so '
  'there is nothing for a caller to forge. Raises rather than swallowing: an '
  'owner change that cannot be recorded is rolled back with it.';

drop trigger if exists nexus_leads_owner_change_audit_trg on public.leads;
create trigger nexus_leads_owner_change_audit_trg
  after update of assigned_to_id on public.leads
  for each row execute function public.nexus_leads_owner_change_audit();

-- A trigger function is never called directly, but it is still a function and
-- Postgres still grants EXECUTE to PUBLIC when it is born. Calling it outside a
-- trigger fails on OLD/NEW, so this is hygiene rather than a live hole -- and
-- lead_ingest_provider_identity_touch was reachable exactly this way once.
revoke all on function public.nexus_leads_owner_change_audit() from public, anon, authenticated;

do $$
declare bad text[] := '{}';
begin
  if has_function_privilege('anon', 'public.nexus_leads_owner_change_audit()', 'execute') then
    bad := array_append(bad, 'anon can execute the audit trigger function');
  end if;
  if has_function_privilege('authenticated', 'public.nexus_leads_owner_change_audit()', 'execute') then
    bad := array_append(bad, 'authenticated can execute the audit trigger function');
  end if;
  -- The whole reason this was avoidable for so long: the dashboard's write path
  -- must survive. Measured here rather than trusted.
  if not has_any_column_privilege('authenticated', 'public.leads', 'UPDATE') then
    bad := array_append(bad, 'authenticated lost UPDATE on public.leads -- the owner-assignment screen is broken');
  end if;
  if not has_any_column_privilege('authenticated', 'public.inventory', 'INSERT') then
    bad := array_append(bad, 'authenticated lost INSERT on public.inventory -- the unit form is broken');
  end if;
  if has_table_privilege('anon', 'public.lead_owner_events', 'SELECT') then
    bad := array_append(bad, 'anon can read lead_owner_events');
  end if;
  if not has_table_privilege('authenticated', 'public.lead_owner_events', 'SELECT') then
    bad := array_append(bad, 'authenticated cannot read lead_owner_events, so the screen has nothing to show');
  end if;
  if cardinality(bad) > 0 then
    raise exception 'owner-audit migration is wrong: %', array_to_string(bad, '; ');
  end if;
end $$;
