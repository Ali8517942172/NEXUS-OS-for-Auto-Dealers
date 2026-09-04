-- The coverage floor was counting the wrong thing.
--
-- v1 measured "enquiry source rows in the window" and found 84 (83 inbound
-- messages + 1 lead with a vehicle_interest), cleared the floor of 50, and
-- declared enquiry coverage SUFFICIENT — which would have let a per-unit count
-- of zero move a recommendation. It must not. Of those 84 rows exactly 2
-- resolve to any unit on the lot at all. A matcher that ties 2% of enquiry
-- traffic to a vehicle cannot make "zero enquiries on this unit" mean anything
-- about the market; it means our records do not say. A missing input is not a
-- zero (PRODUCT.md), and the floor now measures RESOLVED rows so it says so.

comment on column public.inventory_profit_settings.min_enquiry_sources is
  'CHOSEN, not measured. Default 50. Below this many enquiry rows that RESOLVE to some unit on the lot in the window, a per-unit enquiry count of zero is a statement about our records, not about the market - so it is shown as evidence and is NOT allowed to move a recommendation. Measured on resolved rows, not raw rows: on 2 Sep 2026 the lot had 84 raw enquiry rows and 2 that resolved, and counting the raw figure would have cleared this floor while the matcher was reaching 2% of the traffic. A missing input is not a zero (PRODUCT.md).';

drop view if exists public.v_inventory_profit_sentinel;

create view public.v_inventory_profit_sentinel
with (security_invoker = true) as
with cfg as (
  select
    i.tenant_id,
    s.holding_cost_per_day_aed                     as holding_rate,
    s.holding_cost_source                          as holding_rate_source,
    coalesce(s.aging_warn_days,        90)         as warn_days,
    coalesce(s.aging_critical_days,   120)         as crit_days,
    coalesce(s.promote_days,           60)         as promote_days,
    coalesce(s.wholesale_days,        180)         as wholesale_days,
    coalesce(s.min_reprice_margin_pct, 8.00)       as min_margin_pct,
    coalesce(s.market_tolerance_pct,   3.00)       as tol_pct,
    coalesce(s.enquiry_window_days,    30)         as enq_days,
    coalesce(s.min_enquiry_sources,    50)         as min_enq_sources,
    (s.tenant_id is null)                          as on_defaults
  from (select distinct tenant_id from public.inventory) i
  left join public.inventory_profit_settings s on s.tenant_id = i.tenant_id
),
enq_src as (
  select l.tenant_id, 'lead'::text as kind, l.id::text as ref, l.created_at,
         public.nexus_model_tokens(l.vehicle_interest) as tk
    from public.leads l
    join cfg c on c.tenant_id = l.tenant_id
   where coalesce(l.vehicle_interest, '') <> ''
     and l.created_at >= now() - make_interval(days => c.enq_days)
  union all
  select m.tenant_id, 'message', m.id::text, m.created_at,
         public.nexus_model_tokens(m.message)
    from public.communication_logs m
    join cfg c on c.tenant_id = m.tenant_id
   where lower(coalesce(m.direction, '')) = 'inbound'
     and coalesce(m.message, '') <> ''
     and m.created_at >= now() - make_interval(days => c.enq_days)
),
enq_cover as (
  select c.tenant_id,
    (select count(*) from enq_src e where e.tenant_id = c.tenant_id) as src_rows,
    (select count(*) from enq_src e
      where e.tenant_id = c.tenant_id
        and exists (
          select 1 from public.inventory i2
           where i2.tenant_id = c.tenant_id
             and (select count(*) from unnest(public.nexus_model_tokens(i2.model)) t
                   where t = any(e.tk)) >= 2)) as resolved_rows
    from cfg c
),
base as (
  select
    i.tenant_id, i.id, i.model, i.vin, i.status, i.acquired_at,
    i.cost_aed, i.price_aed,
    lower(coalesce(i.status, '')) = 'sold'                                as is_sold,
    case when i.acquired_at is null then null
         else greatest(0, ((now() at time zone 'Asia/Dubai')::date - i.acquired_at)) end as days,
    case when i.price_aed is null or i.cost_aed is null then null
         else (i.price_aed - i.cost_aed) end                              as gross,
    case when i.price_aed is null or i.cost_aed is null or i.price_aed <= 0 then null
         else round(((i.price_aed - i.cost_aed)::numeric / i.price_aed) * 100, 2) end as gross_pct,
    c.holding_rate, c.holding_rate_source, c.warn_days, c.crit_days,
    c.promote_days, c.wholesale_days, c.min_margin_pct, c.tol_pct,
    c.enq_days, c.min_enq_sources, c.on_defaults,
    ec.src_rows, ec.resolved_rows
  from public.inventory i
  join cfg c        on c.tenant_id = i.tenant_id
  join enq_cover ec on ec.tenant_id = i.tenant_id
),
mkt as (
  select b.tenant_id, b.id,
         k.competitor, k.price_aed as comp_price, k.match_quality,
         k.scraped_at, k.match_note
    from base b
    left join lateral (
      select * from public.competitors x
       where x.tenant_id = b.tenant_id
         and lower(btrim(x.model)) = lower(btrim(b.model))
       order by x.scraped_at desc nulls last, x.id desc
       limit 1) k on true
),
enq as (
  select b.tenant_id, b.id,
         count(e.ref)                                                 as enq_n,
         count(*) filter (where e.kind = 'lead')                      as enq_leads,
         count(*) filter (where e.kind = 'message')                   as enq_msgs,
         max(e.created_at)                                            as enq_last
    from base b
    left join enq_src e
      on e.tenant_id = b.tenant_id
     and (select count(*) from unnest(public.nexus_model_tokens(b.model)) t where t = any(e.tk)) >= 2
   group by b.tenant_id, b.id
),
j as (
  select b.*,
    m.competitor, m.comp_price, m.match_quality, m.scraped_at as comp_scraped_at,
    m.match_note,
    e.enq_n, e.enq_leads, e.enq_msgs, e.enq_last,
    (b.resolved_rows >= b.min_enq_sources)                            as enq_ok,
    case when b.days is null then 'UNKNOWN'
         when b.is_sold      then 'HEALTHY'
         when b.days >= b.crit_days then 'CRITICAL'
         when b.days >= b.warn_days then 'WARNING'
         else 'HEALTHY' end                                           as band,
    case when b.holding_rate is null or b.days is null then null
         else round(b.holding_rate * b.days) end                      as holding_aed,
    case
      when m.competitor is null then 'UNKNOWN_NO_COMPARABLE'
      when lower(coalesce(m.match_quality, '')) not in ('strong', 'exact')
        then 'UNKNOWN_UNVERIFIED_COMPARABLE'
      when m.comp_price is null or b.price_aed is null then 'UNKNOWN_NO_PRICE'
      when abs(b.price_aed - m.comp_price)::numeric / nullif(m.comp_price, 0) * 100 <= b.tol_pct
        then 'AT_MARKET'
      when b.price_aed > m.comp_price then 'ABOVE_MARKET'
      else 'BELOW_MARKET' end                                         as market_position
  from base b
  join mkt m on m.tenant_id = b.tenant_id and m.id = b.id
  join enq e on e.tenant_id = b.tenant_id and e.id = b.id
),
r as (
  select j.*,
    case
      when j.is_sold                                              then 'HOLD'
      when j.days is null or j.price_aed is null or j.cost_aed is null then 'MANAGER_REVIEW'
      when j.gross <= 0                                           then 'MANAGER_REVIEW'
      when j.days >= j.wholesale_days and j.gross_pct <  j.min_margin_pct then 'WHOLESALE'
      when j.days >= j.wholesale_days                             then 'MANAGER_REVIEW'
      when j.days >= j.warn_days and j.market_position = 'BELOW_MARKET' then 'INSPECT'
      when j.days >= j.warn_days and j.gross_pct >= j.min_margin_pct    then 'REPRICE'
      when j.days >= j.warn_days                                  then 'INSPECT'
      when j.gross_pct < j.min_margin_pct                         then 'MANAGER_REVIEW'
      when j.days >= j.promote_days                               then 'PROMOTE'
      else 'HOLD' end                                             as recommendation
  from j
)
select
  r.tenant_id, r.id, r.model, r.vin, r.status, r.acquired_at,
  r.days                                                          as days_in_stock,
  r.band,
  case when r.days is null then null else greatest(0, r.warn_days - r.days) end as days_to_warning,
  case when r.days is null then null else greatest(0, r.crit_days - r.days) end as days_to_critical,
  r.cost_aed, r.price_aed,
  r.gross                                                         as gross_margin_aed,
  r.gross_pct                                                     as gross_margin_pct,
  r.cost_aed                                                      as capital_tied_aed,

  r.holding_rate                                                  as holding_cost_per_day_aed,
  r.holding_rate_source                                           as holding_cost_source,
  r.holding_aed                                                   as holding_cost_accrued_aed,
  case when r.holding_rate is null then 'NOT_COMPUTABLE'
       when r.days is null        then 'NOT_COMPUTABLE'
       else 'COMPUTED' end                                        as holding_cost_state,
  case
    when r.holding_rate is null then
      'Not computable. This dealership has not recorded what a day of floor costs, so no holding figure and no net margin are shown. The inputs are here instead: AED '
      || to_char(coalesce(r.cost_aed, 0), 'FM999,999,999') || ' of capital tied up for '
      || coalesce(r.days::text, 'an unknown number of') || ' days. Enter a sourced rate in Settings and this becomes a number.'
    when r.days is null then 'Not computable: this unit has no acquisition date, so there are no days to charge a rate against.'
    else 'AED ' || to_char(r.holding_rate, 'FM999,999,990.00') || '/day x ' || r.days
      || ' days, from the rate this dealership recorded: ' || coalesce(r.holding_rate_source, 'source missing')
  end                                                             as holding_cost_note,

  r.market_position,
  r.competitor                                                    as market_competitor,
  r.comp_price                                                    as market_price_aed,
  r.match_quality                                                 as market_match_quality,
  r.comp_scraped_at                                               as market_scraped_at,
  case r.market_position
    when 'UNKNOWN_NO_COMPARABLE' then
      'No competitor row for this model, so this unit has NO market position. That is unknown, not average.'
    when 'UNKNOWN_UNVERIFIED_COMPARABLE' then
      'A competitor row exists (' || coalesce(r.competitor, '?') || ' at AED '
      || to_char(coalesce(r.comp_price, 0), 'FM999,999,999') || ') but nothing tied that price to this car - match quality '
      || coalesce(nullif(r.match_quality, ''), 'unrated') || '. Shown as evidence; no position is derived from it and no price move is recommended because of it.'
    when 'UNKNOWN_NO_PRICE' then 'A comparable exists but one of the two prices is missing, so no position can be taken.'
    when 'AT_MARKET' then 'Within ' || r.tol_pct || '% of a verified comparable at ' || coalesce(r.competitor, '?') || '.'
    when 'ABOVE_MARKET' then 'AED ' || to_char(abs(coalesce(r.price_aed,0) - coalesce(r.comp_price,0)), 'FM999,999,999')
      || ' above a verified comparable at ' || coalesce(r.competitor, '?') || '.'
    else 'AED ' || to_char(abs(coalesce(r.price_aed,0) - coalesce(r.comp_price,0)), 'FM999,999,999')
      || ' below a verified comparable at ' || coalesce(r.competitor, '?') || '.'
  end                                                             as market_note,

  r.enq_n                                                         as enquiries_in_window,
  r.enq_leads                                                     as enquiry_leads,
  r.enq_msgs                                                      as enquiry_messages,
  r.enq_last                                                      as enquiry_last_at,
  r.src_rows                                                      as enquiry_source_rows,
  r.resolved_rows                                                 as enquiry_resolved_rows,
  r.enq_days                                                      as enquiry_window_days,
  case when r.enq_ok then 'SUFFICIENT' else 'INSUFFICIENT' end    as enquiry_coverage,
  case when r.enq_ok
    then r.enq_n || ' enquiry ' || case when r.enq_n = 1 then 'record' else 'records' end
      || ' in ' || r.enq_days || ' days, matched to this unit on two or more shared model words.'
    else 'Counted but NOT used to decide. Across the whole lot, ' || r.src_rows
      || ' enquiry rows in ' || r.enq_days || ' days resolve to a vehicle only ' || r.resolved_rows
      || ' times, under the floor of ' || r.min_enq_sources
      || '. At that coverage a count of ' || r.enq_n || ' says what our records hold, not what the market wants, so it cannot move a recommendation.'
  end                                                             as enquiry_note,

  r.recommendation,

  case r.recommendation
    when 'HOLD' then case when r.is_sold
      then 'Marked Sold. No lot action applies to a unit that is off the lot.'
      else 'On the lot ' || r.days || ' days with ' || r.gross_pct || '% gross margin intact - inside the healthy band and not yet at the ' || r.promote_days || '-day promotion point. Nothing to do.' end
    when 'PROMOTE' then 'At ' || r.days || ' days this unit is in the last third of the healthy band and enters WARNING in '
      || greatest(0, r.warn_days - r.days) || ' days. Marketing spend now still has the full AED '
      || to_char(coalesce(r.gross,0), 'FM999,999,999') || ' of gross margin behind it; after the band it will not.'
    when 'REPRICE' then 'On the lot ' || r.days || ' days - past the ' || r.warn_days
      || '-day ageing threshold this database already uses - and still carrying ' || r.gross_pct
      || '% gross margin, which is room above the ' || r.min_margin_pct || '% floor to move the price without going under cost.'
    when 'INSPECT' then case when r.market_position = 'BELOW_MARKET'
      then 'Aged at ' || r.days || ' days while already priced below a verified comparable. Price is not what is stopping this one - inspect condition, photos and description before cutting further.'
      else 'Aged at ' || r.days || ' days with only ' || r.gross_pct || '% gross margin, under the ' || r.min_margin_pct
        || '% floor. A price cut has no room to work here, so the question is the car, not the number.' end
    when 'WHOLESALE' then 'On the lot ' || r.days || ' days - past the ' || r.wholesale_days
      || '-day point - with only ' || r.gross_pct || '% gross margin left. Retail has had six months and there is no room left to cut.'
    when 'MANAGER_REVIEW' then case
      when r.days is null then 'No acquisition date on this unit, so it has no age and no ageing band. Nothing can be recommended until that is recorded.'
      when r.price_aed is null or r.cost_aed is null then 'Missing ' || case when r.price_aed is null and r.cost_aed is null then 'both list price and cost' when r.price_aed is null then 'a list price' else 'an acquisition cost' end
        || ', so margin cannot be computed and no recommendation is safe.'
      when r.gross <= 0 then 'Listed at AED ' || to_char(coalesce(r.price_aed,0), 'FM999,999,999') || ' against a cost of AED '
        || to_char(coalesce(r.cost_aed,0), 'FM999,999,999') || ' - at or below cost before any discount. A person has to decide this one.'
      when r.days >= r.wholesale_days then 'On the lot ' || r.days || ' days, past the ' || r.wholesale_days
        || '-day point, yet still carrying ' || r.gross_pct || '% margin. Six months of pricing has not moved it, so the choice between a deeper cut and a wholesale is a person''s, not the engine''s.'
      else 'Gross margin is ' || r.gross_pct || '%, under the ' || r.min_margin_pct
        || '% floor, on a unit that is not yet aged. Priced this close to cost it has no room to discount later.' end
  end                                                             as reason,

  case
    when r.is_sold then 'HIGH'
    when r.days is null or r.price_aed is null or r.cost_aed is null then 'LOW'
    when r.market_position like 'UNKNOWN%' or not r.enq_ok then 'MEDIUM'
    else 'HIGH' end                                               as confidence,
  case
    when r.is_sold then 'The unit''s own status field is the whole basis.'
    when r.days is null or r.price_aed is null or r.cost_aed is null
      then 'A required input is missing from the record, so this is a finding about the data rather than about the car.'
    when r.market_position like 'UNKNOWN%' and not r.enq_ok
      then 'The trigger - days in stock against the band this database already uses, and margin from real cost and price - is solid. Capped at MEDIUM because neither of the two things that would confirm the direction is available: no verified market comparable, and enquiry coverage below the floor.'
    when r.market_position like 'UNKNOWN%'
      then 'The trigger is solid. Capped at MEDIUM because there is no verified market comparable for this model.'
    when not r.enq_ok
      then 'The trigger is solid. Capped at MEDIUM because enquiry coverage across the lot is below the floor.'
    else 'Days, margin, a verified market comparable and adequate enquiry coverage all present.'
  end                                                             as confidence_basis,

  case when r.recommendation in ('REPRICE','INSPECT','WHOLESALE','PROMOTE')
         or (r.recommendation = 'MANAGER_REVIEW' and r.gross is not null)
       then r.gross else null end                                 as impact_aed,
  case
    when r.recommendation = 'HOLD' then 'NONE'
    when r.gross is null then 'NOT_COMPUTABLE'
    else 'MARGIN_EXPOSED' end                                     as impact_kind,
  case
    when r.recommendation = 'HOLD' then
      case when r.is_sold then 'No action recommended, so no impact is claimed.'
           else 'No action recommended, so no impact is claimed. AED ' || to_char(coalesce(r.gross,0), 'FM999,999,999') || ' of gross margin is intact and not at risk yet.' end
    when r.gross is null then 'Not computable: margin cannot be derived from this record.'
    when r.days is null then 'ESTIMATE - AED ' || to_char(r.gross, 'FM999,999,999')
      || ' of gross margin sits in this unit, but with no acquisition date there is no age to put it at risk against.'
    else 'ESTIMATE - AED ' || to_char(r.gross, 'FM999,999,999')
      || ' of gross margin (list minus acquisition cost) is exposed on a unit that has not sold in ' || r.days
      || ' days. This is EXPOSURE, not expected loss, not attributed revenue and not recovered revenue. '
      || case when r.holding_rate is null
              then 'The cost of continuing to hold it is not computable - no holding rate on record.'
              else 'It is being reduced by AED ' || to_char(r.holding_rate, 'FM999,999,990.00') || ' of holding cost every further day.' end
  end                                                             as impact_basis,

  jsonb_build_array(
    jsonb_build_object('fact', 'On the lot ' || coalesce(r.days::text, 'an unknown number of') || ' days'
                     || case when r.acquired_at is null then '' else ' (acquired ' || to_char(r.acquired_at, 'DD Mon YYYY') || ')' end,
                       'source', 'inventory.acquired_at, counted on the Asia/Dubai calendar'),
    jsonb_build_object('fact', case when r.gross is null then 'Gross margin not computable'
                                    else 'Gross margin AED ' || to_char(r.gross, 'FM999,999,999') || ' (' || r.gross_pct || '% of list)' end,
                       'source', 'inventory.price_aed minus inventory.cost_aed'),
    jsonb_build_object('fact', case when r.holding_rate is null then 'Holding cost: UNKNOWN - no rate on record'
                                    else 'Holding cost accrued AED ' || to_char(coalesce(r.holding_aed,0), 'FM999,999,999') end,
                       'source', 'inventory_profit_settings.holding_cost_per_day_aed'),
    jsonb_build_object('fact', 'Market position: ' || r.market_position,
                       'source', 'competitors, newest row for this exact model'),
    jsonb_build_object('fact', r.enq_n || ' resolvable enquiries in ' || r.enq_days || ' days ('
                     || case when r.enq_ok then 'coverage sufficient' else 'coverage below floor - evidence only' end || ')',
                       'source', 'leads.vehicle_interest and inbound communication_logs, matched on 2+ shared model words'),
    jsonb_build_object('fact', 'Band ' || r.band || ' at warn ' || r.warn_days || ' / critical ' || r.crit_days || ' days',
                       'source', 'inventory_profit_settings, defaulted from recompute_inventory_derived()')
  )                                                               as evidence,

  r.warn_days, r.crit_days, r.promote_days, r.wholesale_days,
  r.min_margin_pct, r.tol_pct, r.min_enq_sources,
  r.on_defaults                                                   as settings_are_defaults,
  now()                                                           as computed_at
from r;

comment on view public.v_inventory_profit_sentinel is
  'Inventory Profit Sentinel. One row per unit: age, margin, holding cost, market position, enquiry volume, and a recommendation from HOLD / REPRICE / PROMOTE / TRANSFER / WHOLESALE / INSPECT / MANAGER_REVIEW with its reason, evidence, confidence and estimated impact. security_invoker so RLS on inventory, competitors, leads and communication_logs is evaluated as the caller. Reads NONE of the stored derived columns (holding_cost_accrued, net_margin, recommended_commission) because all three are built on an unsourced AED 50/day inside recompute_inventory_derived(). TRANSFER is in the vocabulary but is never emitted: inventory carries no branch or location column, so there is nowhere to transfer to and the engine will not invent one.';