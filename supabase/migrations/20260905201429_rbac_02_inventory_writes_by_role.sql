-- ===========================================================================
-- rbac_02_inventory_writes_by_role
--
-- Measured on staging BEFORE this migration, as role authenticated with a real
-- JWT sub, in a transaction that was rolled back:
--
--   sales      UPDATE inventory.cost_aed          -> NO ERROR, 1 row
--   sales      UPDATE inventory.price_aed         -> NO ERROR, 1 row
--   sales      DELETE inventory (no dependents)   -> NO ERROR, 1 row
--   technician UPDATE inventory cost AND price    -> NO ERROR, 1 row
--
-- A DELETE of a unit that DID have an inventory_actions row failed 23503 on
-- inventory_actions_unit_fkey. That is an incidental lock, not a control: it
-- protects the twelve units somebody has proposed an action against and
-- nothing else. The unit with no action history deleted cleanly.
--
-- TWO DIFFERENT LOCKS, because they answer two different questions.
--
-- 1. COLUMN GRANT decides WHICH COLUMNS any dashboard user may write at all.
--    A GRANT is per database ROLE, and every signed-in user is the same
--    database role (`authenticated`), so a column grant cannot tell an owner
--    from a rep. What it CAN do is set a ceiling nobody clears, and it fails
--    with 42501 -- refused by privilege, before RLS is consulted. cost_aed is
--    taken off the table-write path entirely for that reason: it is the one
--    number on this table whose disclosure and whose alteration are both
--    commercially serious, and a lock that cannot be reasoned around is worth
--    more than one that can. This is the pattern channel_registry already
--    uses to withhold credential_ref.
--
--    Note the consequence, and it is deliberate: read
--    pg_attribute.attacl as well as pg_class.relacl after this. The usual
--    "one query" in CLAUDE.md reads relacl only and will now report inventory
--    as authenticated=r -- read-only -- which is not the whole truth.
--
--    The derived columns (days_in_stock, gross_margin, vat_amount,
--    holding_cost_accrued, net_margin, recommended_commission, aging_alert)
--    are also withheld. They are computed by recompute_inventory_derived(),
--    which is SECURITY DEFINER owned by postgres and so is unaffected by any
--    of this. Nobody should be able to type a margin in by hand.
--
-- 2. RLS decides WHO may write a row at all, and it reads
--    tenant_members.role. RESTRICTIVE, so it intersects with the existing
--    tenant scoping rather than replacing it -- the dealership boundary proven
--    on 2 September is untouched and still has to pass.
--
-- WHY INSERT IS owner/admin AND NOT manager. Adding a vehicle necessarily
-- states what it cost. If a manager could INSERT, "a manager may not set cost
-- price" would be true of UPDATE and false of the far easier path. So cost_aed
-- keeps its INSERT grant (a unit arriving with a known cost is the normal
-- case, and it is how the live unit form already works) and the INSERT policy
-- is narrowed to owner/admin instead. A manager who needs a vehicle added asks
-- for one; a manager can still reprice everything on the lot.
--
-- WHY DELETE LOSES ITS GRANT ENTIRELY rather than getting a policy alone. An
-- RLS-refused DELETE returns "0 rows affected" and no error, which is
-- indistinguishable from "that vehicle was already gone" -- and this codebase
-- has a written rule that 0 rows proves RLS filtered something and never
-- proves a privilege is absent. Revoking the grant makes the refusal 42501,
-- visible and unambiguous. owner/admin delete through
-- inventory_delete_unit() in rbac_03. The restrictive DELETE policy is added
-- anyway so that the control survives someone restoring the grant.
--
-- WHAT THIS COSTS THE ONE LIVE USER: nothing. ALBA CARS has one
-- tenant_members row and it is role = 'owner'.
-- ===========================================================================

revoke insert, update, delete, truncate on public.inventory from authenticated;

grant select on public.inventory to authenticated;

grant insert (id, model, vin, status, acquired_at, price_aed, cost_aed, ai_recommendation, tenant_id)
  on public.inventory to authenticated;

grant update (id, model, vin, status, acquired_at, price_aed, ai_recommendation)
  on public.inventory to authenticated;

drop policy if exists inventory_role_insert on public.inventory;
create policy inventory_role_insert on public.inventory
  as restrictive for insert to authenticated
  with check (tenant_id in (select public.nexus_tenant_ids_for_roles(array['owner','admin']::text[])));

drop policy if exists inventory_role_update on public.inventory;
create policy inventory_role_update on public.inventory
  as restrictive for update to authenticated
  using      (tenant_id in (select public.nexus_tenant_ids_for_roles(array['owner','admin','manager']::text[])))
  with check (tenant_id in (select public.nexus_tenant_ids_for_roles(array['owner','admin','manager']::text[])));

drop policy if exists inventory_role_delete on public.inventory;
create policy inventory_role_delete on public.inventory
  as restrictive for delete to authenticated
  using (tenant_id in (select public.nexus_tenant_ids_for_roles(array['owner','admin']::text[])));

comment on column public.inventory.cost_aed is
  'What the dealership paid. authenticated holds NO update privilege on this column -- a '
  'PATCH naming it is refused 42501 by GRANT, before RLS is reached, whoever sends it. '
  'owner/admin change it through public.inventory_set_cost(), which checks account '
  'authority and writes an audit_log row. It keeps its INSERT grant because a vehicle '
  'arrives with a known cost, and the INSERT policy is owner/admin only for that reason.';