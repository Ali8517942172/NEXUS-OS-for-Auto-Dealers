-- ===========================================================================
-- sentinel_04_actions_function  ·  public.sentinel_inventory_actions()
--
-- BUSINESS RULE: one figure, one derivation (NEXUS_INVARIANTS.md). This is the
-- single read path for the Profit Sentinel. Screens, n8n and Ask AI call this
-- function; nothing recomputes margin, ageing or risk of its own.
--
-- SECURITY INVOKER on purpose (the default, stated here because it is
-- load-bearing): the function reads v_inventory_profit_sentinel, which is
-- security_invoker, so RLS runs as the caller and a dealership can only ever
-- pull its own lot. There is no SECURITY DEFINER here to bypass.
--
-- ORDERING is worst-first: overall risk rank descending, then days in stock,
-- then the money exposed. That is a ranking, not a claim - the numbers behind
-- it are in the row.
-- ===========================================================================
create or replace function public.sentinel_inventory_actions(
  p_recommendation text default null,   -- filter to one action, or NULL for all
  p_min_risk_rank  int  default null    -- 0..3, or NULL for all
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

comment on function public.sentinel_inventory_actions(text, int) is
  'Inventory Profit Sentinel: the single read path for per-unit recommendations. '
  'Deterministic - SQL computes and classifies. An LLM may explain or prioritise '
  'these rows for a human but must never calculate one of these figures and must '
  'never fill in a value the engine returned as UNKNOWN or NOT_COMPUTABLE. '
  'Tenant-scoped through the view''s security_invoker RLS. A unit with UNKNOWN '
  'risk is never hidden by p_min_risk_rank, because unknown is not low.';

revoke all on function public.sentinel_inventory_actions(text, int) from public;
grant execute on function public.sentinel_inventory_actions(text, int) to authenticated, service_role;