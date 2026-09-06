-- D1. recompute_inventory_derived() would have written a margin for a car
-- whose acquisition cost nobody entered.
--
-- Measured on staging on 6 Sep 2026 inside a transaction that ended in an
-- unconditional RAISE, so nothing persisted. One call as postgres:
--
--   rows touched by ONE unscoped call         = 33   (all three dealerships)
--   DEMO-2130 (price 235,000, cost NULL) gross_margin  null -> 235000
--
-- The whole asking price of a car, stored in a column named margin, on the
-- single figure this product is sold on. The engine one view over -
-- v_inventory_profit_sentinel - has always returned NULL for that unit and
-- said why. Two derivations of one figure, disagreeing, and the wrong one is
-- the one the unit drawer renders.
--
-- Nothing of the kind has been written to production. All 12 units carry both
-- a price and a cost, and every stored gross_margin equals price - cost
-- exactly; the nightly job has recomputed those same 12 rows 23 times since
-- 14 Aug. What cannot be established either way is the 52 inventory rows that
-- have been inserted and deleted over that period: this schema keeps no
-- history of cost_aed, so whether one of them ever held a NULL cost across a
-- nightly run is NOT_COMPUTABLE, not "no".
--
-- Three changes. The constraint is the important one, because it binds every
-- writer rather than this one function - and service_role does not bypass a
-- CHECK, so it binds n8n too.

alter table public.inventory
  add constraint inventory_derived_figures_require_their_inputs
  check (
        (gross_margin           is null or (price_aed is not null and cost_aed is not null))
    and (net_margin             is null or (price_aed is not null and cost_aed is not null))
    and (recommended_commission is null or (price_aed is not null and cost_aed is not null))
    and (vat_amount             is null or  price_aed is not null)
  );

comment on constraint inventory_derived_figures_require_their_inputs on public.inventory is
  'A derived money figure may not exist on a row that is missing the inputs it '
  'is derived from. coalesce(cost_aed, 0) turns "nobody recorded this" into '
  '"this car cost nothing", and the margin that comes out is the list price. '
  'Refused here rather than in one writer, because the writers are '
  'recompute_inventory_derived(), the dashboard unit form and n8n as '
  'service_role, and only a CHECK holds against all three.';

-- The reason, on the row, in the vocabulary v_inventory_profit_sentinel
-- already uses. GENERATED ALWAYS ... STORED is deliberate: no caller can write
-- it, so it cannot drift from the two columns it describes, and there is no
-- second derivation to keep in step. NULL is the value; this says why.
alter table public.inventory
  add column gross_margin_state text
  generated always as (
    case
      when price_aed is null and cost_aed is null then 'NOT_COMPUTABLE_NO_PRICE_NO_COST'
      when price_aed is null                      then 'NOT_COMPUTABLE_NO_PRICE'
      when cost_aed  is null                      then 'NOT_COMPUTABLE_NO_COST'
      else 'COMPUTED'
    end
  ) stored;

comment on column public.inventory.gross_margin_state is
  'Why gross_margin is NULL, when it is. COMPUTED, or one of three '
  'NOT_COMPUTABLE_* reasons naming the missing input. Generated and '
  'unwritable, so it is always true of the row it sits on.';

create or replace function public.recompute_inventory_derived()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  touched      integer;
  today_dubai  date := (now() at time zone 'Asia/Dubai')::date;
  -- PostgREST issues SET LOCAL ROLE before the call, and that setting survives
  -- entry into a SECURITY DEFINER function even though current_user does not.
  v_caller     text := coalesce(nullif(current_setting('role', true), ''), current_user::text);
  -- The dealerships this call will write, named explicitly. There is no
  -- "null means everyone" any more: the sweep used to be an unscoped UPDATE,
  -- which on 6 Sep touched 33 rows across three dealerships for a caller that
  -- had named none of them, and would have touched the quarantine tenant's
  -- rows too - rows every one of the 29 tenant-carrying views excludes by
  -- definition.
  v_tenants    uuid[];
begin
  if v_caller in ('authenticated', 'anon') or auth.uid() is not null then
    -- A signed-in dealership user recomputes their own dealership and no
    -- other. An account that belongs to none owns no rows, so it recomputes
    -- none. Returning zero is the honest answer; raising would only teach the
    -- dashboard to swallow it.
    if public.nexus_current_tenant_id() is null then
      return 0;
    end if;
    v_tenants := array[public.nexus_current_tenant_id()];
  else
    -- A backend batch (n8n holds service_role; the nightly Inventory Ageing
    -- Recompute is the only caller on the box). It legitimately sweeps every
    -- dealership - but it enumerates them, from the one function that answers
    -- that question in the plural, rather than writing whatever rows exist.
    select coalesce(array_agg(t), '{}'::uuid[])
      into v_tenants
      from public.nexus_active_dealership_ids() t;
    if cardinality(v_tenants) = 0 then
      return 0;
    end if;
  end if;

  update public.inventory i
  set days_in_stock          = d.days_in_stock,
      gross_margin           = d.gross_margin,
      vat_amount             = d.vat_amount,
      holding_cost_accrued   = d.holding_cost_accrued,
      net_margin             = d.net_margin,
      recommended_commission = d.recommended_commission,
      aging_alert            = d.aging_alert
  from (
    select b.tenant_id,
           b.id,
           b.days_in_stock,
           b.gross_margin,

           -- VAT is five per cent of a price. With no price on record there is
           -- no VAT figure, and zero is not one: coalesce(price, 0) * 0.05
           -- rendered AED 0 of VAT on a car nobody had priced.
           case when b.price is null then null else round(b.price * 0.05) end as vat_amount,

           -- Holding cost stops accruing once a unit is marked Sold: the figure
           -- frozen at that moment is the record of what it actually cost to
           -- keep. A dealership that has never stated a rate gets NULL, which
           -- means UNKNOWN and never zero.
           case when b.sold then b.frozen_holding
                when b.rate is null then null
                else round(b.days_in_stock * b.rate) end as holding_cost_accrued,

           case when b.sold then
                  case when b.frozen_holding is null then null
                       else b.gross_margin - b.frozen_holding end
                when b.rate is null then null      -- gross is known, net is not
                else b.gross_margin - round(b.days_in_stock * b.rate) end as net_margin,

           case when b.sold then
                  case when b.frozen_holding is null then null
                       else round((b.gross_margin - b.frozen_holding) * 0.05) end
                when b.rate is null then null
                else round((b.gross_margin - round(b.days_in_stock * b.rate)) * 0.05) end
             as recommended_commission,

           case when b.sold                        then 'HEALTHY'
                when b.days_in_stock >= b.crit_days then 'CRITICAL'
                when b.days_in_stock >= b.warn_days then 'WARNING'
                else 'HEALTHY' end as aging_alert
      from (
        select inv.tenant_id,
               inv.id,
               greatest(0, today_dubai - inv.acquired_at)             as days_in_stock,
               inv.price_aed                                          as price,

               -- THE FIX. This read
               --   coalesce(inv.price_aed, 0) - coalesce(inv.cost_aed, 0)
               -- so a unit with a real price and no cost got a margin equal to
               -- its whole asking price. Both inputs are required and neither
               -- is guessable; missing either is NULL, and
               -- inventory.gross_margin_state says which one is missing. This
               -- is character for character the expression
               -- v_inventory_profit_sentinel uses, so the stored column and
               -- the engine can no longer disagree about the same car.
               case when inv.price_aed is null or inv.cost_aed is null then null
                    else inv.price_aed - inv.cost_aed end             as gross_margin,

               lower(coalesce(inv.status, '')) = 'sold'               as sold,
               inv.holding_cost_accrued                               as frozen_holding,
               s.holding_cost_per_day_aed                             as rate,
               coalesce(s.aging_warn_days, 90)                        as warn_days,
               coalesce(s.aging_critical_days, 120)                   as crit_days
          from public.inventory inv
          -- The settings row is joined on tenant_id, so a dealership can only
          -- ever be measured against its own holding rate and its own bands.
          left join public.inventory_profit_settings s on s.tenant_id = inv.tenant_id
         where inv.acquired_at is not null
           and inv.tenant_id = any(v_tenants)
      ) b
  ) d
  where i.tenant_id = d.tenant_id
    and i.id        = d.id
    and i.tenant_id = any(v_tenants);

  get diagnostics touched = row_count;
  return touched;
end;
$function$;

comment on function public.recompute_inventory_derived() is
  'Recomputes the stored derived columns on inventory for the dealerships the '
  'caller is entitled to: the signed-in user''s own, or - for a backend batch - '
  'every active dealership, enumerated through nexus_active_dealership_ids() '
  'rather than swept. A missing price or cost produces NULL and '
  'gross_margin_state says which input is absent; it never produces a figure.'