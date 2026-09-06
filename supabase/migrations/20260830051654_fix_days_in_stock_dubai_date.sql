-- days_in_stock was one day short, every day, permanently.
--
-- The Inventory Ageing Recompute workflow fires at 00:15 Asia/Dubai, which is
-- 20:15 UTC the PREVIOUS day. This function used bare `current_date`, evaluated
-- in the database session's timezone (UTC), so at that moment `current_date`
-- was still yesterday in Dubai terms. Every car's days_in_stock was therefore
-- understated by exactly one day, and holding_cost_accrued by AED 50.
--
-- That is not cosmetic. The WhatsApp sales agent's system prompt reads
-- days_in_stock to decide how hard it may discount ("if a vehicle has high
-- demand or low days_in_stock, lean toward a smaller discount"), so the agent
-- has been systematically under-discounting aging stock. The WARNING (90) and
-- CRITICAL (120) thresholds also fired a day late.
--
-- Fix: anchor the date to the dealership's own clock rather than the server's.
-- Everything else in the function is unchanged.
create or replace function public.recompute_inventory_derived()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  touched integer;
  today_dubai date := (now() at time zone 'Asia/Dubai')::date;
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
           greatest(0, today_dubai - acquired_at) as days,
           lower(coalesce(status,'')) = 'sold' as sold
    from public.inventory
    where acquired_at is not null
  ) d
  where i.id = d.id;

  get diagnostics touched = row_count;
  return touched;
end;
$function$;