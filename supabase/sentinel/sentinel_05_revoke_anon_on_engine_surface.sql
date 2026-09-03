-- Applied to dsvuoovivysszdoiorch as migration sentinel_05_revoke_anon_on_engine_surface.
-- One dealership's cost, margin and stock position must never be reachable by
-- the public anon key. RLS already returns zero rows to anon (proved: 0), but
-- the blanket schema grants left anon holding SELECT on the view and EXECUTE on
-- the engine function. Two locks, not one.
revoke all on public.v_inventory_profit_sentinel from anon;
revoke all on public.inventory_profit_settings   from anon;
revoke all on function public.sentinel_inventory_actions(text, int) from anon;
