-- Applied to dsvuoovivysszdoiorch as migration sentinel_02_recompute_reads_configured_holding_rate.
-- ===========================================================================
-- BUSINESS RULE: a monetary figure is either derived from something the
-- dealership told us, or it is not shown. Unknown is not zero.
--
-- WHAT WAS WRONG: this function is where the AED 50/day holding rate lived.
-- Three expressions read `d.days * 50` (holding_cost_accrued, net_margin,
-- recommended_commission). It ran nightly at 00:15 Asia/Dubai (n8n "Inventory
-- Ageing Recompute", id ZUc42jcwwHoBeEr8) and stamped those numbers onto raw
-- inventory rows, which Finance Desk, Overview and n8n then read as fact.
-- The rate was never sourced from a dealership.
--
-- NOW: the rate comes from inventory_profit_settings for the row's own tenant.
-- No rate on record -> holding_cost_accrued, net_margin and
-- recommended_commission are written NULL (UNKNOWN), never 0.
-- gross_margin, days_in_stock, vat_amount and aging_alert are untouched.
--
-- STILL BURIED, RECORDED NOT FIXED: vat_amount 0.05 (a jurisdiction rule that
-- belongs in the Policy Engine) and recommended_commission 0.05 (a pay-plan
-- number with no more provenance than the AED 50 had).
-- ===========================================================================
create or replace function public.recompute_inventory_derived()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
  today_dubai date := (now() at time zone 'Asia/Dubai')::date;
begin
  update public.inventory i
  set
    days_in_stock = d.days,
    gross_margin  = coalesce(i.price_aed,0) - coalesce(i.cost_aed,0),
    vat_amount    = round(coalesce(i.price_aed,0) * 0.05),
    holding_cost_accrued = case
      when d.sold then i.holding_cost_accrued
      when d.rate is null then null          -- UNKNOWN, not zero
      else round(d.days * d.rate) end,
    net_margin = case
      when d.sold then
        case when i.holding_cost_accrued is null then null
             else (coalesce(i.price_aed,0) - coalesce(i.cost_aed,0)) - i.holding_cost_accrued end
      when d.rate is null then null          -- gross is known, net is not
      else (coalesce(i.price_aed,0) - coalesce(i.cost_aed,0)) - round(d.days * d.rate) end,
    recommended_commission = case
      when d.sold then
        case when i.holding_cost_accrued is null then null
             else round(((coalesce(i.price_aed,0) - coalesce(i.cost_aed,0)) - i.holding_cost_accrued) * 0.05) end
      when d.rate is null then null
      else round((((coalesce(i.price_aed,0) - coalesce(i.cost_aed,0)) - round(d.days * d.rate)) * 0.05)) end,
    aging_alert = case
      when d.sold then 'HEALTHY'
      when d.days >= d.crit_days then 'CRITICAL'
      when d.days >= d.warn_days then 'WARNING'
      else 'HEALTHY' end
  from (
    select inv.id,
           greatest(0, today_dubai - inv.acquired_at)  as days,
           lower(coalesce(inv.status,'')) = 'sold'     as sold,
           s.holding_cost_per_day_aed                  as rate,
           coalesce(s.aging_warn_days, 90)             as warn_days,
           coalesce(s.aging_critical_days, 120)        as crit_days
      from public.inventory inv
      left join public.inventory_profit_settings s on s.tenant_id = inv.tenant_id
     where inv.acquired_at is not null
  ) d
  where i.id = d.id;

  get diagnostics touched = row_count;
  return touched;
end;
$$;

revoke all on function public.recompute_inventory_derived() from public;
grant execute on function public.recompute_inventory_derived() to service_role;
grant execute on function public.recompute_inventory_derived() to authenticated;
