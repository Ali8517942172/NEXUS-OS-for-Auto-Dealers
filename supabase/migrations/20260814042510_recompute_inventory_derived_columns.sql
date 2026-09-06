-- inventory stores days_in_stock, holding_cost_accrued, net_margin and aging_alert
-- as ordinary columns, frozen at whatever the value was when the row was last
-- saved. The dashboard hides this because deriveUnit() recomputes them from
-- acquired_at on every render — but n8n workflows and the Finance Desk read the
-- stored copy, so from the day after a unit is added those consumers are wrong,
-- holding cost under-reports, and units never cross the WARNING/CRITICAL
-- thresholds the aging automations depend on.
--
-- Same constants as the frontend: AED 50/day, VAT 5%, commission 5% of net,
-- WARNING at 90 days, CRITICAL at 120, and holding cost stops accruing on Sold.

create or replace function public.recompute_inventory_derived()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  update public.inventory i
  set
    days_in_stock = d.days,
    holding_cost_accrued = case when d.sold then i.holding_cost_accrued else d.days * 50 end,
    gross_margin = coalesce(i.price_aed,0) - coalesce(i.cost_aed,0),
    net_margin = (coalesce(i.price_aed,0) - coalesce(i.cost_aed,0))
                 - case when d.sold then i.holding_cost_accrued else d.days * 50 end,
    vat_amount = round(coalesce(i.price_aed,0) * 0.05),
    recommended_commission = round(
      ((coalesce(i.price_aed,0) - coalesce(i.cost_aed,0))
        - case when d.sold then i.holding_cost_accrued else d.days * 50 end) * 0.05),
    aging_alert = case
      when d.sold then 'HEALTHY'
      when d.days >= 120 then 'CRITICAL'
      when d.days >= 90  then 'WARNING'
      else 'HEALTHY' end
  from (
    select id,
           greatest(0, current_date - acquired_at) as days,
           lower(coalesce(status,'')) = 'sold' as sold
    from public.inventory
    where acquired_at is not null
  ) d
  where i.id = d.id;

  get diagnostics touched = row_count;
  return touched;
end;
$$;

revoke all on function public.recompute_inventory_derived() from public;
grant execute on function public.recompute_inventory_derived() to service_role;
grant execute on function public.recompute_inventory_derived() to authenticated;