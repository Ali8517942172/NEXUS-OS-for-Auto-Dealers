-- ===========================================================================
-- rbac_05_the_cost_lock_that_does_not_take_the_form_away
--
-- rbac_02 withheld UPDATE(cost_aed) and DELETE from `authenticated` outright.
-- That is the stronger lock and it proved out on staging: 42501, refused by
-- privilege, before RLS is consulted. It is also, measured against the live
-- product, wrong to ship on its own.
--
-- WHY. lib/unit-form.js builds one object and PATCHes the whole of it. Its
-- unitRow() always includes cost_aed -- confirmed in the DEPLOYED bundle
-- (dist/assets/main-DSw77Uwd.js), not just in source -- so PostgREST names
-- that column on every save, whether the figure changed or not. With no
-- UPDATE privilege on it, every "Save changes" on the vehicle form returns
-- 42501. And ALBA CARS has exactly one login. It belongs to the owner, who is
-- the person the control is not aimed at.
--
-- So the column grant would have closed a hole nobody can currently reach --
-- there is no second login -- at the price of a screen the one real user uses
-- today, and it could not be paid back from here: the fixed bundle reaches
-- production by a deploy this session cannot perform.
--
-- WHAT THIS MIGRATION DOES INSTEAD. It restores the two grants and moves the
-- same rule to a trigger, which sees OLD and NEW and can therefore ask the
-- question the grant could not: not "may you name this column" but "are you
-- changing this figure". A save that carries an unchanged cost is not a cost
-- change and passes. A save that moves it is refused unless the caller is
-- owner or admin.
--
-- Be clear about what was traded, because the trade is real:
--
--   LOST   A privilege check is absolute and runs before any policy. A trigger
--          is code, and code can be dropped, replaced, or have its own bug.
--          `authenticated` now again holds UPDATE on cost_aed in relacl terms.
--   KEPT   The rule is still enforced in the database, on every path, for
--          every client. PostgREST with a raw JWT hits the same trigger the
--          dashboard does. Hiding a button is still not the control.
--   GAINED An audit row on every cost change by a person, naming the old
--          figure, the new figure and the auth user. The column grant bought
--          no such thing, and the direct UPDATE it replaced left no trace at
--          all. Until today, nothing in this database recorded that a cost
--          price had ever moved.
--
-- The machine-owned columns keep their privilege lock and are NOT restored:
-- gross_margin, net_margin, vat_amount, holding_cost_accrued,
-- recommended_commission, days_in_stock, aging_alert and tenant_id remain
-- refused by GRANT with 42501. Those are computed, and no dashboard user of
-- any role should be able to type one in.
--
-- DELETE is restored as a grant and left to the RESTRICTIVE policy from
-- rbac_02, so the owner's existing delete button keeps working unchanged. A
-- rep's DELETE is filtered by that policy and returns 0 rows rather than an
-- error -- state that as RLS, never as "no privilege". The dashboard's delete
-- path should move to inventory_delete_unit(), which refuses with NX001, says
-- why, and will not silently erase a unit's recommendation history.
--
-- WHEN THE STRONGER LOCK CAN COME BACK: once a dashboard build that omits
-- cost_aed from the PATCH body is actually deployed, re-run rbac_02's two
-- narrowing statements. Nothing here has to be undone first.
-- ===========================================================================

grant update (cost_aed) on public.inventory to authenticated;
grant delete on public.inventory to authenticated;

create or replace function public.inventory_guard_cost_change()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  -- PostgREST issues SET LOCAL ROLE before the call and that setting survives
  -- entry into a SECURITY DEFINER function even though current_user does not,
  -- which is why this reads `role` rather than current_user. Same idiom as
  -- recompute_inventory_derived().
  v_caller text := coalesce(nullif(current_setting('role', true), ''), current_user::text);
  v_person boolean;
begin
  if new.cost_aed is not distinct from old.cost_aed then
    return new;
  end if;

  v_person := (v_caller in ('authenticated', 'anon') or auth.uid() is not null);

  -- n8n and the nightly jobs hold service_role and are not gated here. That is
  -- not an oversight: service_role is BYPASSRLS and already writes these tables
  -- directly, so a check here would be theatre. The disciplined door is the one
  -- a person comes through.
  if not v_person then
    return new;
  end if;

  if new.tenant_id not in (select public.nexus_tenant_ids_for_roles(array['owner','admin']::text[])) then
    raise exception using errcode = 'NX001',
      message = 'You may not change the cost price of a vehicle.',
      detail  = 'NX_RBAC_COST_PRICE_REFUSED',
      hint    = 'Cost price is an owner or admin decision at this dealership. Everything else on this vehicle can still be saved -- clear the cost field back to what it was and save again, or ask the account owner to change it.';
  end if;

  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('Inventory Cost Price Change', 'SUCCESS',
          format('cost_aed on %s changed from %s to %s by auth user %s',
                 new.id,
                 coalesce(old.cost_aed::text, '(not previously set)'),
                 coalesce(new.cost_aed::text, '(cleared)'),
                 coalesce(auth.uid()::text, '(no auth session)')),
          new.tenant_id);

  return new;
end;
$fn$;

comment on function public.inventory_guard_cost_change() is
  'Refuses a change to inventory.cost_aed from a signed-in dashboard user who is not '
  'owner or admin at that dealership, and writes an audit_log row for every cost change '
  'that IS allowed. Asks whether the figure moved, which a column GRANT cannot: the live '
  'vehicle form PATCHes cost_aed on every save, so withholding the privilege outright '
  'would refuse saves that change nothing. service_role is deliberately not gated.';

drop trigger if exists inventory_guard_cost_change on public.inventory;
create trigger inventory_guard_cost_change
  before update of cost_aed on public.inventory
  for each row
  execute function public.inventory_guard_cost_change();

revoke all on function public.inventory_guard_cost_change() from public, anon, authenticated;

comment on column public.inventory.cost_aed is
  'What the dealership paid. A signed-in user who is not owner or admin at this '
  'dealership cannot change it: the inventory_guard_cost_change trigger raises NX001 '
  'when the figure moves, and every allowed change writes an audit_log row naming the '
  'old and new value. authenticated does hold the UPDATE privilege on this column, '
  'deliberately -- the shipped vehicle form sends it on every save -- so relacl and '
  'attacl are NOT the witness here; the trigger is. public.inventory_set_cost() is the '
  'named path and is preferred, but a direct owner PATCH is audited just the same.';