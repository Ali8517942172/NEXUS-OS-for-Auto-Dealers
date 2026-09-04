-- days_in_stock was a frozen integer with nothing to recompute it from, so the
-- aging feature (WARNING/CRITICAL, holding cost) could never move. Store the one
-- fact that does not go stale — the date the unit was acquired — and derive the rest.
alter table public.inventory add column if not exists acquired_at date;

update public.inventory
   set acquired_at = (current_date - coalesce(days_in_stock, 0))
 where acquired_at is null;

alter table public.inventory alter column acquired_at set default current_date;

comment on column public.inventory.acquired_at is
  'Date the unit entered stock. days_in_stock, holding_cost_accrued and aging_alert are derived from this; acquired_at is the source of truth.';