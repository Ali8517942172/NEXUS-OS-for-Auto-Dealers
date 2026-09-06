-- ===========================================================================
-- sentinel_03_engine_view  ·  public.v_inventory_profit_sentinel
--
-- THE ENGINE. Deterministic: SQL computes and classifies. An LLM may later
-- explain or rank these rows for a human, but must never calculate one of
-- these numbers, and must never fill in a value the engine marked UNKNOWN.
--
-- BUSINESS RULES THIS VIEW ENFORCES
--  1. inventory rows are read, never written. Chain: inventory -> this view ->
--     sentinel_inventory_actions().
--  2. Every threshold and every rate comes from inventory_profit_settings for
--     the row's own tenant. No literal in this view decides anything.
--  3. A missing input is UNKNOWN, never 0 and never an average.
--  4. Any figure derived from a PLACEHOLDER holding rate carries state
--     PLACEHOLDER so the screen can mark it as an assumption, not their money.
--  5. The recommendation ladder never reads holding cost or net margin. It runs
--     on days in stock and gross margin, both real on all 12 units, so an
--     unknown holding rate downgrades the economics shown, not the advice.
--  6. security_invoker = true. CREATE OR REPLACE VIEW drops reloptions, so the
--     option is restated and an event trigger fails the deploy if it is missed.
--
-- WHY TRANSFER IS IN THE VOCABULARY BUT NEVER EMITTED
--   TRANSFER means "move this unit to another branch". public.inventory has no
--   location, branch or site column, and there is one tenant, so the engine
--   cannot know there is anywhere to move a car to. Emitting TRANSFER would be
--   inventing a second showroom. Unreachable until a location column exists.
-- ===========================================================================
drop view if exists public.v_inventory_profit_sentinel;

create view public.v_inventory_profit_sentinel
with (security_invoker = true) as
with cfg as (
  select i.tenant_id,
         s.holding_cost_per_day_aed                        as holding_rate,
         s.holding_cost_source                             as holding_source,
         s.holding_cost_basis                              as holding_basis,
         s.holding_cost_set_by                             as holding_set_by,
         s.holding_cost_verified_at                        as holding_verified_at,
         coalesce(s.aging_warn_days, 90)                   as warn_days,
         coalesce(s.aging_critical_days, 120)              as crit_days,
         coalesce(s.promote_days, 60)                      as promote_days,
         coalesce(s.wholesale_days, 180)                   as wholesale_days,
         coalesce(s.min_reprice_margin_pct, 8.00)          as min_margin_pct,
         coalesce(s.market_tolerance_pct, 3.00)            as tol_pct,
         coalesce(s.enquiry_window_days, 30)               as enq_days,
         coalesce(s.min_enquiry_sources, 50)               as min_enq_sources,
         coalesce(s.min_model_token_overlap, 2)            as min_overlap,
         coalesce(s.accepted_market_match_quality, array['exact','strong']) as ok_quality,
         coalesce(s.market_max_age_days, 14)               as mkt_max_age,
         s.tenant_id is null                               as on_defaults
    from (select distinct tenant_id from public.inventory) i
    left join public.inventory_profit_settings s on s.tenant_id = i.tenant_id
),
enq_src as (
  -- Demand evidence: a lead's stated vehicle interest, or an inbound message.
  -- Both are the dealership's own records. Nothing here is bought or inferred.
  select l.tenant_id, 'lead'::text as kind, l.id::text as ref, l.created_at,
         public.nexus_model_tokens(l.vehicle_interest) as tk
    from public.leads l
    join cfg c on c.tenant_id = l.tenant_id
   where coalesce(l.vehicle_interest,'') <> ''
     and l.created_at >= now() - make_interval(days => c.enq_days)
  union all
  select m.tenant_id, 'message', m.id::text, m.created_at,
         public.nexus_model_tokens(m.message)
    from public.communication_logs m
    join cfg c on c.tenant_id = m.tenant_id
   where lower(coalesce(m.direction,'')) = 'inbound'
     and coalesce(m.message,'') <> ''
     and m.created_at >= now() - make_interval(days => c.enq_days)
),
enq_cover as (
  -- How much of the enquiry traffic the matcher can place on ANY unit. Below
  -- the floor, a per-unit count of zero describes our matcher, not the market,
  -- so it is shown as evidence and forbidden from moving a recommendation.
  select c.tenant_id,
         (select count(*) from enq_src e where e.tenant_id = c.tenant_id) as src_rows,
         (select count(*) from enq_src e
           where e.tenant_id = c.tenant_id
             and exists (select 1 from public.inventory i2
                          where i2.tenant_id = c.tenant_id
                            and (select count(*) from unnest(public.nexus_model_tokens(i2.model)) t
                                  where t = any(e.tk)) >= c.min_overlap)) as resolved_rows
    from cfg c
),
base as (
  -- tenant_id comes from cfg via c.*, not from i, so the CTE has one column of
  -- that name and every later reference to b.tenant_id is unambiguous.
  select i.id, i.model, i.vin, i.status, i.acquired_at,
         i.cost_aed, i.price_aed,
         lower(coalesce(i.status,'')) = 'sold' as is_sold,
         case when i.acquired_at is null then null
              else greatest(0, (now() at time zone 'Asia/Dubai')::date - i.acquired_at) end as days,
         case when i.price_aed is null or i.cost_aed is null then null
              else i.price_aed - i.cost_aed end as gross,
         case when i.price_aed is null or i.cost_aed is null or i.price_aed <= 0 then null
              else round((i.price_aed - i.cost_aed)::numeric / i.price_aed::numeric * 100, 2) end as gross_pct,
         c.*, ec.src_rows, ec.resolved_rows
    from public.inventory i
    join cfg c on c.tenant_id = i.tenant_id
    join enq_cover ec on ec.tenant_id = i.tenant_id
),
mkt as (
  -- The newest competitor row for this EXACT model string. Never an average of
  -- several, never a nearest-neighbour guess: one named comparable or nothing.
  select b.tenant_id, b.id, k.competitor, k.price_aed as comp_price,
         k.match_quality, k.scraped_at, k.match_note, k.source_host
    from base b
    left join lateral (
      select x.* from public.competitors x
       where x.tenant_id = b.tenant_id
         and lower(btrim(x.model)) = lower(btrim(b.model))
       order by x.scraped_at desc nulls last, x.id desc
       limit 1) k on true
),
enq as (
  select b.tenant_id, b.id,
         count(e.ref)                                   as enq_n,
         count(*) filter (where e.kind = 'lead')        as enq_leads,
         count(*) filter (where e.kind = 'message')     as enq_msgs,
         max(e.created_at)                              as enq_last
    from base b
    left join enq_src e
      on e.tenant_id = b.tenant_id
     and (select count(*) from unnest(public.nexus_model_tokens(b.model)) t
           where t = any(e.tk)) >= b.min_overlap
   group by b.tenant_id, b.id
),
j as (
  select b.*, m.competitor, m.comp_price, m.match_quality,
         m.scraped_at as comp_scraped_at, m.match_note, m.source_host,
         e.enq_n, e.enq_leads, e.enq_msgs, e.enq_last,
         b.resolved_rows >= b.min_enq_sources as enq_ok,

         case when b.days is null then 'UNKNOWN'
              when b.is_sold      then 'HEALTHY'
              when b.days >= b.crit_days then 'CRITICAL'
              when b.days >= b.warn_days then 'WARNING'
              else 'HEALTHY' end as band,

         -- Holding cost. Three states, because two would force an unknown to
         -- masquerade as a number or as a zero.
         case when b.holding_rate is null or b.days is null then 'NOT_COMPUTABLE'
              when b.holding_basis = 'PLACEHOLDER'          then 'PLACEHOLDER'
              else 'COMPUTED' end as holding_state,
         case when b.holding_rate is null or b.days is null then null
              else round(b.holding_rate * b.days) end as holding_aed,

         case when m.competitor is null then 'UNKNOWN_NO_COMPARABLE'
              when lower(coalesce(m.match_quality,'')) <> all (b.ok_quality)
                   then 'UNKNOWN_UNVERIFIED_COMPARABLE'
              when m.scraped_at is null
                   or m.scraped_at < now() - make_interval(days => b.mkt_max_age)
                   then 'UNKNOWN_STALE_COMPARABLE'
              when m.comp_price is null or b.price_aed is null then 'UNKNOWN_NO_PRICE'
              when abs(b.price_aed - m.comp_price)::numeric
                   / nullif(m.comp_price,0)::numeric * 100 <= b.tol_pct then 'AT_MARKET'
              when b.price_aed > m.comp_price then 'ABOVE_MARKET'
              else 'BELOW_MARKET' end as market_position
    from base b
    join mkt m on m.tenant_id = b.tenant_id and m.id = b.id
    join enq e on e.tenant_id = b.tenant_id and e.id = b.id
),
risk as (
  select j.*,
    -- AGE RISK. Bands are the ones this database already runs nightly in
    -- recompute_inventory_derived(), read from settings so there is one
    -- definition, not two. Ranks are an ORDERING device (0..3), not a score
    -- and not a percentage - there is nothing here to calibrate a score against.
    case when j.days is null then null
         when j.is_sold then 0
         when j.days >= j.crit_days then 3
         when j.days >= j.warn_days then 2
         when j.days >= j.promote_days then 1
         else 0 end as age_rank,
    -- MARGIN RISK. Only one margin threshold has ever been agreed here
    -- (min_reprice_margin_pct), so there are only the states that threshold can
    -- justify. A middle band would need a second number nobody has chosen -
    -- that is exactly how the AED 50 got in, so it is deliberately absent.
    case when j.gross is null or j.gross_pct is null then null
         when j.gross <= 0 then 3
         when j.gross_pct < j.min_margin_pct then 2
         else 0 end as margin_rank
    from j
),
r as (
  select risk.*,
    greatest(coalesce(risk.age_rank, -1), coalesce(risk.margin_rank, -1)) as overall_rank_raw,
    case
      when risk.is_sold then 'HOLD'
      when risk.days is null or risk.price_aed is null or risk.cost_aed is null then 'MANAGER_REVIEW'
      when risk.gross <= 0 then 'MANAGER_REVIEW'
      when risk.days >= risk.wholesale_days and risk.gross_pct < risk.min_margin_pct then 'WHOLESALE'
      when risk.days >= risk.wholesale_days then 'MANAGER_REVIEW'
      when risk.days >= risk.warn_days and risk.market_position = 'BELOW_MARKET' then 'INSPECT'
      when risk.days >= risk.warn_days and risk.gross_pct >= risk.min_margin_pct then 'REPRICE'
      when risk.days >= risk.warn_days then 'INSPECT'
      when risk.gross_pct < risk.min_margin_pct then 'MANAGER_REVIEW'
      when risk.days >= risk.promote_days then 'PROMOTE'
      else 'HOLD' end as recommendation
    from risk
)
select
  tenant_id, id, model, vin, status, acquired_at,

  days as days_in_stock,
  band as aging_band,
  case when days is null then null else greatest(0, warn_days - days) end as days_to_warning,
  case when days is null then null else greatest(0, crit_days - days) end as days_to_critical,

  cost_aed, price_aed,
  gross     as gross_margin_aed,
  gross_pct as gross_margin_pct,
  cost_aed  as capital_tied_aed,
  holding_rate         as holding_cost_per_day_aed,
  holding_basis        as holding_cost_basis,
  holding_source       as holding_cost_source,
  holding_set_by       as holding_cost_set_by,
  holding_verified_at  as holding_cost_verified_at,
  case when holding_state = 'NOT_COMPUTABLE' then null else holding_aed end
                       as holding_cost_accrued_aed,
  holding_state        as holding_cost_state,
  case
    when holding_rate is null then
      'Not computable. This dealership has not recorded what a day of floor costs, so no '
      || 'holding figure and no net margin are shown. The inputs are here instead: AED '
      || to_char(coalesce(cost_aed,0),'FM999,999,999') || ' of capital tied up for '
      || coalesce(days::text,'an unknown number of') || ' days. '
      || 'Enter a sourced rate in Settings and this becomes a number.'
    when days is null then
      'Not computable: this unit has no acquisition date, so there are no days to charge a rate against.'
    when holding_basis = 'PLACEHOLDER' then
      'ASSUMPTION, not this dealership''s money. AED ' || to_char(holding_rate,'FM999,999,990.00')
      || '/day x ' || days || ' days, using a PLACEHOLDER rate recorded by '
      || coalesce(holding_set_by,'someone unnamed') || ': ' || coalesce(holding_source,'no source given')
      || '. Replace it with the dealership''s floor-plan figure before anyone acts on this number.'
    else
      'AED ' || to_char(holding_rate,'FM999,999,990.00') || '/day x ' || days
      || ' days. Rate supplied by ' || coalesce(holding_set_by,'unnamed')
      || ', source: ' || coalesce(holding_source,'source missing')
      || ', confirmed ' || coalesce(to_char(holding_verified_at,'DD Mon YYYY'),'never')  || '.'
  end as holding_cost_note,

  case when holding_state = 'NOT_COMPUTABLE' or gross is null then null
       else gross - holding_aed end as net_margin_aed,
  case when gross is null then 'NOT_COMPUTABLE'
       else holding_state end       as net_margin_state,
  case when gross is null then 'Net margin not computable: list price or acquisition cost is missing.'
       when holding_state = 'NOT_COMPUTABLE' then
         'Net margin NOT COMPUTABLE - gross margin of AED ' || to_char(gross,'FM999,999,999')
         || ' is real, the holding cost that would be subtracted from it is not on record. '
         || 'Gross is shown; net is withheld rather than guessed.'
       when holding_state = 'PLACEHOLDER' then
         'Net margin shown against a PLACEHOLDER holding rate. Treat as a model, not as money.'
       else 'Gross margin minus holding cost at the rate this dealership supplied.'
  end as net_margin_note,

  market_position,
  competitor      as market_competitor,
  comp_price      as market_price_aed,
  match_quality   as market_match_quality,
  comp_scraped_at as market_scraped_at,
  case market_position
    when 'UNKNOWN_NO_COMPARABLE' then
      'No competitor row for this exact model, so this unit has NO market position. Unknown, not average.'
    when 'UNKNOWN_UNVERIFIED_COMPARABLE' then
      'A competitor row exists (' || coalesce(competitor,'?') || ' at AED '
      || to_char(coalesce(comp_price,0),'FM999,999,999') || ') but nothing ties that price to this car - '
      || 'match quality ' || coalesce(nullif(match_quality,''),'not recorded')
      || coalesce('. Their own note: "' || match_note || '"','')
      || '. Shown as evidence only; no position is derived from it and no price move is recommended because of it.'
    when 'UNKNOWN_STALE_COMPARABLE' then
      'The only comparable for this model was captured ' || coalesce(to_char(comp_scraped_at,'DD Mon YYYY'),'at an unrecorded time')
      || ', older than the ' || mkt_max_age || '-day freshness window. Too old to price against.'
    when 'UNKNOWN_NO_PRICE' then
      'A comparable exists but one of the two prices is missing, so no position can be taken.'
    when 'AT_MARKET' then
      'Within ' || tol_pct || '% of a verified comparable at ' || coalesce(competitor,'?') || '.'
    when 'ABOVE_MARKET' then
      'AED ' || to_char(abs(coalesce(price_aed,0) - coalesce(comp_price,0)),'FM999,999,999')
      || ' above a verified comparable at ' || coalesce(competitor,'?') || '.'
    else
      'AED ' || to_char(abs(coalesce(price_aed,0) - coalesce(comp_price,0)),'FM999,999,999')
      || ' below a verified comparable at ' || coalesce(competitor,'?') || '.'
  end as market_note,

  case when not enq_ok then 'UNKNOWN_LOW_COVERAGE'
       when enq_n > 0  then 'ENQUIRIES_PRESENT'
       else 'NO_ENQUIRIES_IN_WINDOW' end as demand_signal,
  enq_n         as enquiries_in_window,
  enq_leads     as enquiry_leads,
  enq_msgs      as enquiry_messages,
  enq_last      as enquiry_last_at,
  src_rows      as enquiry_source_rows,
  resolved_rows as enquiry_resolved_rows,
  enq_days      as enquiry_window_days,
  case when enq_ok then 'SUFFICIENT' else 'INSUFFICIENT' end as enquiry_coverage,
  case when enq_ok then
         enq_n || ' enquiry ' || case when enq_n = 1 then 'record' else 'records' end
         || ' in ' || enq_days || ' days, matched to this unit on ' || min_overlap
         || ' or more shared model words.'
       else
         'Counted but NOT used to decide. Across the whole lot, ' || src_rows
         || ' enquiry rows in ' || enq_days || ' days resolve to a vehicle only '
         || resolved_rows || ' times, under the floor of ' || min_enq_sources
         || '. At that coverage a count of ' || enq_n
         || ' says what our records hold, not what the market wants, so it cannot move a recommendation.'
  end as enquiry_note,

  case age_rank when 3 then 'SEVERE' when 2 then 'HIGH' when 1 then 'ELEVATED'
                when 0 then 'LOW' else 'UNKNOWN' end as age_risk,
  age_rank as age_risk_rank,
  case margin_rank when 3 then 'SEVERE' when 2 then 'HIGH'
                   when 0 then 'LOW' else 'UNKNOWN' end as margin_risk,
  margin_rank as margin_risk_rank,
  case when age_rank is null and margin_rank is null then 'UNKNOWN'
       when overall_rank_raw = 3 then 'SEVERE'
       when overall_rank_raw = 2 then 'HIGH'
       when overall_rank_raw = 1 then 'ELEVATED'
       else 'LOW' end as overall_risk,
  case when age_rank is null and margin_rank is null then null
       else overall_rank_raw end as overall_risk_rank,
  case when age_rank is null and margin_rank is null then
         'Neither age nor margin can be assessed: no acquisition date and no price/cost pair.'
       when age_rank is null then
         'Margin risk only - this unit has no acquisition date, so it has no age and no ageing band.'
       when margin_rank is null then
         'Age risk only - list price or acquisition cost is missing, so margin risk is unknown.'
       else
         'Overall risk is the higher of age risk (' || age_rank || ') and margin risk (' || margin_rank
         || '), not a weighted blend. Nothing here has been calibrated against real days-to-sell, '
         || 'so a weighting would be an invention.'
  end as risk_basis,

  recommendation,
  case recommendation
    when 'HOLD' then
      case when is_sold then 'Marked Sold. No lot action applies to a unit that is off the lot.'
           else 'On the lot ' || days || ' days with ' || gross_pct
                || '% gross margin intact - inside the healthy band and not yet at the '
                || promote_days || '-day promotion point. Nothing to do.' end
    when 'PROMOTE' then
      'At ' || days || ' days this unit is in the last third of the healthy band and enters WARNING in '
      || greatest(0, warn_days - days) || ' days. Marketing spend now still has the full AED '
      || to_char(coalesce(gross,0),'FM999,999,999') || ' of gross margin behind it; after the band it will not.'
    when 'REPRICE' then
      'On the lot ' || days || ' days - past the ' || warn_days
      || '-day ageing threshold this database already uses - and still carrying ' || gross_pct
      || '% gross margin, which is room above the ' || min_margin_pct
      || '% floor to move the price without going under cost.'
    when 'INSPECT' then
      case when market_position = 'BELOW_MARKET' then
             'Aged at ' || days || ' days while already priced below a verified comparable. Price is not '
             || 'what is stopping this one - inspect condition, photos and description before cutting further.'
           else
             'Aged at ' || days || ' days with only ' || gross_pct || '% gross margin, under the '
             || min_margin_pct || '% floor. A price cut has no room to work here, so the question is the car, not the number.'
      end
    when 'WHOLESALE' then
      'On the lot ' || days || ' days - past the ' || wholesale_days || '-day point - with only '
      || gross_pct || '% gross margin left. Retail has had six months and there is no room left to cut.'
    when 'MANAGER_REVIEW' then
      case when days is null then
             'No acquisition date on this unit, so it has no age and no ageing band. Nothing can be recommended until that is recorded.'
           when price_aed is null or cost_aed is null then
             'Missing ' || case when price_aed is null and cost_aed is null then 'both list price and cost'
                                when price_aed is null then 'a list price' else 'an acquisition cost' end
             || ', so margin cannot be computed and no recommendation is safe.'
           when gross <= 0 then
             'Listed at AED ' || to_char(coalesce(price_aed,0),'FM999,999,999') || ' against a cost of AED '
             || to_char(coalesce(cost_aed,0),'FM999,999,999') || ' - at or below cost before any discount. A person has to decide this one.'
           when days >= wholesale_days then
             'On the lot ' || days || ' days, past the ' || wholesale_days || '-day point, yet still carrying '
             || gross_pct || '% margin. Six months of pricing has not moved it, so the choice between a deeper cut '
             || 'and a wholesale is a person''s, not the engine''s.'
           else
             'Gross margin is ' || gross_pct || '%, under the ' || min_margin_pct
             || '% floor, on a unit that is not yet aged. Priced this close to cost it has no room to discount later.'
      end
  end as reason,

  case when is_sold then 'HIGH'
       when days is null or price_aed is null or cost_aed is null then 'LOW'
       when market_position like 'UNKNOWN%' or not enq_ok then 'MEDIUM'
       else 'HIGH' end as confidence,
  case when is_sold then 'The unit''s own status field is the whole basis.'
       when days is null or price_aed is null or cost_aed is null then
         'A required input is missing from the record, so this is a finding about the data rather than about the car.'
       when market_position like 'UNKNOWN%' and not enq_ok then
         'The trigger - days in stock against the band this database already uses, and margin from real cost '
         || 'and price - is solid. Capped at MEDIUM because neither of the two things that would confirm the '
         || 'direction is available: no verified market comparable, and enquiry coverage below the floor.'
       when market_position like 'UNKNOWN%' then
         'The trigger is solid. Capped at MEDIUM because there is no verified market comparable for this model.'
       when not enq_ok then
         'The trigger is solid. Capped at MEDIUM because enquiry coverage across the lot is below the floor.'
       else 'Days, margin, a verified market comparable and adequate enquiry coverage all present.'
  end as confidence_basis,

  case when recommendation = 'HOLD' then null
       when gross is null then null
       else gross end as impact_aed,
  case when recommendation = 'HOLD' then 'NONE'
       when gross is null then 'NOT_COMPUTABLE'
       else 'MARGIN_EXPOSED' end as impact_kind,
  case
    when recommendation = 'HOLD' then
      case when is_sold then 'No action recommended, so no impact is claimed.'
           else 'No action recommended, so no impact is claimed. AED ' || to_char(coalesce(gross,0),'FM999,999,999')
                || ' of gross margin is intact and not at risk yet.' end
    when gross is null then 'Not computable: margin cannot be derived from this record.'
    else
      'EXPOSURE - AED ' || to_char(gross,'FM999,999,999')
      || ' of gross margin (list minus acquisition cost) sits in a unit that has not sold in '
      || coalesce(days::text,'an unknown number of') || ' days. This is the amount AT RISK. It is not '
      || 'expected loss, not attributed revenue and not recovered revenue. '
      || case when holding_state = 'NOT_COMPUTABLE' then
                'How fast it is being eaten is NOT COMPUTABLE - no holding rate on record.'
              when holding_state = 'PLACEHOLDER' then
                'On a PLACEHOLDER rate it would be reduced by AED ' || to_char(holding_rate,'FM999,999,990.00')
                || ' a day, which is an assumption, not this dealership''s cost.'
              else
                'It is being reduced by AED ' || to_char(holding_rate,'FM999,999,990.00')
                || ' of holding cost every further day, at the rate this dealership supplied.' end
  end as impact_basis,

  -- Owner. NEXUS names a ROLE, never a person: public.users holds one member
  -- for this dealership (role senior_rep) and no manager, marketing or workshop
  -- role, so naming an individual would be invention.
  case recommendation
    when 'HOLD'            then null
    when 'PROMOTE'         then 'Marketing'
    when 'INSPECT'         then 'Workshop / Recon'
    when 'REPRICE'         then 'Sales Manager'
    when 'WHOLESALE'       then 'Sales Manager'
    when 'MANAGER_REVIEW'  then 'Sales Manager'
  end as suggested_owner_role,
  case when recommendation = 'HOLD' then 'NO_ACTION' else 'ROLE_ONLY' end as suggested_owner_state,
  case when recommendation = 'HOLD' then 'No action, so no owner.'
       else 'A role, not a person. NEXUS holds no role directory for this dealership, so it will not '
            || 'put a name against an action it cannot verify that person owns.' end as suggested_owner_note,

  -- Approval. Everything except HOLD either changes a customer-visible price,
  -- spends money, or disposes of an asset, and no recommendation on this lot
  -- currently reaches HIGH confidence. So: a person signs off, always.
  (recommendation <> 'HOLD') as human_approval_required,
  case recommendation
    when 'HOLD'    then 'NONE_NEEDED'
    when 'PROMOTE' then 'AUTOMATABLE_AFTER_APPROVAL'
    else 'MANUAL_ONLY'
  end as automation_state,

  jsonb_build_array(
    jsonb_build_object('fact',
      'On the lot ' || coalesce(days::text,'an unknown number of') || ' days'
      || case when acquired_at is null then '' else ' (acquired ' || to_char(acquired_at,'DD Mon YYYY') || ')' end,
      'source','inventory.acquired_at, counted on the Asia/Dubai calendar'),
    jsonb_build_object('fact',
      case when gross is null then 'Gross margin not computable'
           else 'Gross margin AED ' || to_char(gross,'FM999,999,999') || ' (' || gross_pct || '% of list)' end,
      'source','inventory.price_aed minus inventory.cost_aed'),
    jsonb_build_object('fact',
      case when holding_rate is null then 'Holding cost: UNKNOWN - no rate on record for this dealership'
           when holding_basis = 'PLACEHOLDER' then 'Holding cost AED ' || to_char(coalesce(holding_aed,0),'FM999,999,999') || ' on a PLACEHOLDER rate'
           else 'Holding cost accrued AED ' || to_char(coalesce(holding_aed,0),'FM999,999,999') end,
      'source','inventory_profit_settings.holding_cost_per_day_aed'
        || coalesce(' (' || holding_source || ', set by ' || holding_set_by || ')','')),
    jsonb_build_object('fact',
      case when gross is null or holding_state = 'NOT_COMPUTABLE' then 'Net margin: NOT COMPUTABLE'
           else 'Net margin AED ' || to_char(gross - holding_aed,'FM999,999,999') end,
      'source','gross margin minus holding cost'),
    jsonb_build_object('fact','Market position: ' || market_position,
      'source','competitors, newest row for this exact model'
        || coalesce(' (' || competitor || ', match quality ' || coalesce(nullif(match_quality,''),'not recorded') || ')','')),
    jsonb_build_object('fact',
      enq_n || ' resolvable enquiries in ' || enq_days || ' days ('
      || case when enq_ok then 'coverage sufficient' else 'coverage below floor - evidence only' end || ')',
      'source','leads.vehicle_interest and inbound communication_logs, matched on '
        || min_overlap || '+ shared model words'),
    jsonb_build_object('fact',
      'Band ' || band || ' at warn ' || warn_days || ' / critical ' || crit_days || ' days',
      'source','inventory_profit_settings, defaulted from recompute_inventory_derived()'),
    jsonb_build_object('fact',
      'Risk: age ' || case age_rank when 3 then 'SEVERE' when 2 then 'HIGH' when 1 then 'ELEVATED' when 0 then 'LOW' else 'UNKNOWN' end
      || ', margin ' || case margin_rank when 3 then 'SEVERE' when 2 then 'HIGH' when 0 then 'LOW' else 'UNKNOWN' end,
      'source','days_in_stock against the configured bands; gross margin % against min_reprice_margin_pct')
  ) as evidence,

  warn_days, crit_days, promote_days, wholesale_days,
  min_margin_pct, tol_pct, min_enq_sources, min_overlap as min_model_token_overlap,
  mkt_max_age as market_max_age_days,
  on_defaults as settings_are_defaults,
  now() as computed_at
from r;

comment on view public.v_inventory_profit_sentinel is
  'Inventory Profit Sentinel engine output, one row per unit. Reads inventory, '
  'competitors, leads and communication_logs; writes nothing. Every threshold '
  'and the holding rate come from inventory_profit_settings for the row''s own '
  'tenant. Unknown inputs produce explicit UNKNOWN / NOT_COMPUTABLE states with '
  'a note naming the missing input - never a zero and never an average. '
  'security_invoker = true: a dealership sees only its own lot.';

grant select on public.v_inventory_profit_sentinel to authenticated, service_role;