-- Applied to dsvuoovivysszdoiorch as migration sentinel_04_actions_function.
-- ===========================================================================
-- BUSINESS RULE: one figure, one derivation. This is the single read path for
-- the Profit Sentinel. Screens, n8n and Ask AI call this; nothing recomputes
-- margin, ageing or risk of its own.
-- SECURITY INVOKER on purpose: reads a security_invoker view, so RLS runs as
-- the caller and a dealership can only ever pull its own lot.
-- ===========================================================================
create or replace function public.sentinel_inventory_actions(
  p_recommendation text default null,
  p_min_risk_rank  int  default null
)
returns setof public.v_inventory_profit_sentinel
language sql
stable
set search_path = public, pg_catalog
as $$
  select *
    from public.v_inventory_profit_sentinel v
   where (p_recommendation is null or v.recommendation = upper(btrim(p_recommendation)))
     -- A unit whose risk is UNKNOWN is never filtered out by a minimum-risk
     -- floor: unknown is not low. It surfaces so a person can look at it.
     and (p_min_risk_rank is null
          or v.overall_risk_rank is null
          or v.overall_risk_rank >= p_min_risk_rank)
   order by coalesce(v.overall_risk_rank, 99) desc,
            v.days_in_stock desc nulls first,
            v.gross_margin_aed desc nulls last;
$$;

revoke all on function public.sentinel_inventory_actions(text, int) from public;
grant execute on function public.sentinel_inventory_actions(text, int) to authenticated, service_role;
