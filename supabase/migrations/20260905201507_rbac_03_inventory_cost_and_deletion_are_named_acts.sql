-- ===========================================================================
-- rbac_03_inventory_cost_and_deletion_are_named_acts
--
-- rbac_02 took cost_aed UPDATE and DELETE off the table-write path for every
-- signed-in user, by GRANT. These two functions are the way back in for the
-- people who are supposed to have them, and they are deliberately not a
-- restoration of the old privilege:
--
--   * authority is checked against tenant_members.role, in the database, on
--     every call -- not read from anything the caller sends;
--   * the act is named ("set the cost of this unit to this figure"), so it
--     cannot arrive as a field riding along in a form PATCH that was really
--     about the colour of the paint;
--   * every accepted call writes an audit_log row naming the old figure, the
--     new figure and the auth user, so a cost change is answerable afterwards.
--     The old direct UPDATE left no trace at all.
--
-- REFUSALS RAISE. They do not come back as a boolean in a column. This file
-- already carries the scar: a PERFORM or an ignored column reads as success,
-- and a QA agent filed a false finding from exactly that. SQLSTATE NX001 with
-- the machine code in DETAIL and the next step in HINT, which is the shape the
-- four policy write functions use and which PostgREST hands to the dashboard
-- intact.
--
-- SECURITY DEFINER, owned by postgres, so the function reaches the table as
-- postgres and the caller's (now absent) column privilege is irrelevant. That
-- is the same mechanism every rpc/* the dashboard calls already relies on. It
-- is also why the authority check inside is load-bearing rather than
-- decorative: without it this function would be a hole, not a control.
-- ===========================================================================

create or replace function public.inventory_set_cost(
  p_unit_id   text,
  p_cost_aed  integer,
  p_note      text default null
)
returns table (unit_id text, tenant_id uuid, cost_aed integer, previous_cost_aed integer)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_tenant uuid;
  v_prev   integer;
begin
  if p_unit_id is null or btrim(p_unit_id) = '' then
    raise exception using errcode = 'NX001',
      message = 'No vehicle was named, so no cost price was changed.',
      detail  = 'NX_RBAC_COST_NO_UNIT',
      hint    = 'Send the stock number of the vehicle as p_unit_id.';
  end if;

  if p_cost_aed is null then
    raise exception using errcode = 'NX001',
      message = 'A cost price was not supplied, and an unknown cost must not be written as a number.',
      detail  = 'NX_RBAC_COST_NULL',
      hint    = 'Leave the cost unchanged rather than sending null. Every margin on the Profit Sentinel is derived from this figure.';
  end if;

  if p_cost_aed < 0 then
    raise exception using errcode = 'NX001',
      message = 'A cost price cannot be negative.',
      detail  = 'NX_RBAC_COST_NEGATIVE',
      hint    = 'Send the amount the dealership paid, in whole AED.';
  end if;

  -- Authority and existence in one lookup. A unit in another dealership, and a
  -- unit in this dealership when the caller is not owner or admin, are the
  -- same "not found" here on purpose: refusing differently would tell a rep
  -- whether a stock number exists at a dealership they cannot see.
  select i.tenant_id, i.cost_aed
    into v_tenant, v_prev
    from public.inventory i
   where i.id = p_unit_id
     and i.tenant_id in (select public.nexus_tenant_ids_for_roles(array['owner','admin']::text[]))
   for update;

  if not found then
    raise exception using errcode = 'NX001',
      message = 'You may not change the cost price of this vehicle.',
      detail  = 'NX_RBAC_COST_PRICE_REFUSED',
      hint    = 'Cost price is an owner or admin decision at this dealership. Ask the account owner, or have your role in tenant_members changed. If you ARE the owner, check the stock number.';
  end if;

  update public.inventory i
     set cost_aed = p_cost_aed
   where i.id = p_unit_id
     and i.tenant_id = v_tenant;

  -- Margin, holding cost and the aging band are all derived from cost. Leaving
  -- them stale would put a wrong number on the Profit Sentinel, which is worse
  -- than refusing the change.
  perform public.recompute_inventory_derived();

  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('Inventory Cost Price Change', 'SUCCESS',
          format('cost_aed on %s changed from %s to %s by auth user %s%s',
                 p_unit_id,
                 coalesce(v_prev::text, '(not previously set)'),
                 p_cost_aed,
                 coalesce(auth.uid()::text, '(no auth session)'),
                 case when p_note is null or btrim(p_note) = '' then '' else ' -- ' || btrim(p_note) end),
          v_tenant);

  return query select p_unit_id, v_tenant, p_cost_aed, v_prev;
end;
$fn$;

comment on function public.inventory_set_cost(text, integer, text) is
  'The only path by which a signed-in dashboard user changes inventory.cost_aed; '
  'authenticated holds no UPDATE privilege on that column. owner/admin only, checked '
  'against tenant_members.role. Raises NX001 on refusal with the machine code in DETAIL. '
  'Writes an audit_log row naming the old and new figures, which the direct UPDATE it '
  'replaces never did.';

create or replace function public.inventory_delete_unit(p_unit_id text)
returns table (unit_id text, tenant_id uuid, deleted boolean)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_tenant  uuid;
  v_model   text;
  v_actions integer;
begin
  if p_unit_id is null or btrim(p_unit_id) = '' then
    raise exception using errcode = 'NX001',
      message = 'No vehicle was named, so nothing was deleted.',
      detail  = 'NX_RBAC_DELETE_NO_UNIT',
      hint    = 'Send the stock number of the vehicle as p_unit_id.';
  end if;

  select i.tenant_id, i.model
    into v_tenant, v_model
    from public.inventory i
   where i.id = p_unit_id
     and i.tenant_id in (select public.nexus_tenant_ids_for_roles(array['owner','admin']::text[]))
   for update;

  if not found then
    raise exception using errcode = 'NX001',
      message = 'You may not delete this vehicle.',
      detail  = 'NX_RBAC_DELETE_REFUSED',
      hint    = 'Deleting a vehicle is an owner or admin decision at this dealership, and it cannot be undone. A vehicle that has left the lot is normally marked Sold rather than deleted, which keeps its margin in the record.';
  end if;

  select count(*) into v_actions
    from public.inventory_actions a
   where a.tenant_id = v_tenant and a.unit_id = p_unit_id;

  if v_actions > 0 then
    raise exception using errcode = 'NX001',
      message = format('%s has %s recommendation(s) on file and cannot be deleted.', p_unit_id, v_actions),
      detail  = 'NX_RBAC_DELETE_HAS_ACTION_HISTORY',
      hint    = 'Deleting it would erase the decisions that were taken about it. Mark the vehicle Sold instead, or ask for the action history to be cancelled first.';
  end if;

  delete from public.inventory i
   where i.id = p_unit_id
     and i.tenant_id = v_tenant;

  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('Inventory Unit Deleted', 'SUCCESS',
          format('unit %s (%s) deleted by auth user %s',
                 p_unit_id, coalesce(v_model, '(no model)'),
                 coalesce(auth.uid()::text, '(no auth session)')),
          v_tenant);

  return query select p_unit_id, v_tenant, true;
end;
$fn$;

comment on function public.inventory_delete_unit(text) is
  'The only path by which a signed-in dashboard user deletes a vehicle; authenticated '
  'holds no DELETE privilege on inventory. owner/admin only, checked against '
  'tenant_members.role, and refused outright for a unit that carries recommendation '
  'history rather than letting a foreign key decide. Raises NX001 on refusal and writes '
  'an audit_log row on success.';

revoke all on function public.inventory_set_cost(text, integer, text) from public, anon;
revoke all on function public.inventory_delete_unit(text) from public, anon;
grant execute on function public.inventory_set_cost(text, integer, text) to authenticated, service_role;
grant execute on function public.inventory_delete_unit(text) to authenticated, service_role;