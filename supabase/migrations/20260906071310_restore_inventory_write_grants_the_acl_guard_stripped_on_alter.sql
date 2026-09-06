-- REPAIR of a regression this pass caused, disclosed rather than quietly fixed.
--
-- Migration 20260906065739 ran two ALTER TABLE statements against
-- public.inventory. The event trigger nexus_guard_born_open_grants() fires on
-- ddl_command_end for ANY table DDL - not only CREATE - and unconditionally
-- runs
--
--   revoke insert, update, delete, truncate on <table> from authenticated
--
-- so it stripped the two deliberate dashboard write paths on both projects:
-- the table-level DELETE and the nine INSERT / eight UPDATE column grants that
-- lib/unit-form.js needs to add, edit and delete a vehicle. Measured after the
-- fact: inventory went from authenticated=rd with nine column ACLs to
-- authenticated=r with none, identically on staging and production. The unit
-- form would have returned 42501 on save.
--
-- This restores exactly what was there before - no more, and nothing for anon.
-- The values are taken from the pre-change measurement recorded in CLAUDE.md
-- and re-read from the live catalogue on 6 Sep 2026 before the ALTERs ran:
--
--   table  : authenticated=rd
--   columns: id, model, vin, status, price_aed, cost_aed, ai_recommendation,
--            acquired_at  -> aw   (INSERT + UPDATE)
--            tenant_id                              -> a    (INSERT only)
--
-- THE GUARD IS NOT CHANGED HERE, deliberately. Narrowing it to CREATE would
-- weaken a control that exists because objects in this schema are born open,
-- and that is not a trade to make in passing. But the interaction is a live
-- hazard and belongs in the record: since the guard was installed on 4 Sep
-- 2026, EVERY future ALTER TABLE against public.inventory or public.leads
-- silently deletes the dashboard's write grants, with no grant-shaped diff to
-- review. Anyone altering either table must re-read the ACL afterwards and
-- re-apply this file's grants.

grant delete on public.inventory to authenticated;

grant insert (id, model, vin, status, price_aed, cost_aed, ai_recommendation, acquired_at, tenant_id)
   on public.inventory to authenticated;

grant update (id, model, vin, status, price_aed, cost_aed, ai_recommendation, acquired_at)
   on public.inventory to authenticated;

-- Self-checking: if the guard ate these too, this migration fails loudly rather
-- than reporting success over a broken screen. It also asserts that nothing was
-- opened to anon in the process.
do $$
declare
  t_delete   boolean := has_table_privilege('authenticated','public.inventory','DELETE');
  c_insert   boolean := has_any_column_privilege('authenticated','public.inventory','INSERT');
  c_update   boolean := has_any_column_privilege('authenticated','public.inventory','UPDATE');
  n_cols     integer := (select count(*) from pg_attribute a
                          where a.attrelid = 'public.inventory'::regclass
                            and a.attnum > 0 and not a.attisdropped and a.attacl is not null);
  anon_any   boolean := has_table_privilege('anon','public.inventory','SELECT')
                     or has_table_privilege('anon','public.inventory','INSERT')
                     or has_table_privilege('anon','public.inventory','UPDATE')
                     or has_table_privilege('anon','public.inventory','DELETE')
                     or has_any_column_privilege('anon','public.inventory','INSERT')
                     or has_any_column_privilege('anon','public.inventory','UPDATE');
begin
  if not (t_delete and c_insert and c_update and n_cols = 9) then
    raise exception 'inventory write grants were not restored: delete=% insert=% update=% column_acls=%',
      t_delete, c_insert, c_update, n_cols;
  end if;
  if anon_any then
    raise exception 'inventory is reachable by anon after this migration, which it was not before';
  end if;
end $$