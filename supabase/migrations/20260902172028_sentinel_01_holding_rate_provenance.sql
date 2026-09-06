-- ===========================================================================
-- sentinel_01_holding_rate_provenance
--
-- BUSINESS RULE (PRODUCT.md, "Rules that outrank features"):
--   Never fabricate a monetary impact. If the dealership has not told us the
--   rate, the impact is NOT COMPUTABLE and we show the inputs instead.
--
-- WHY THIS MIGRATION EXISTS
--   public.recompute_inventory_derived() charged every unit `days_in_stock * 50`
--   AED and subtracted it from net_margin. On 2 Sep 2026 that produced exactly
--   days*50 on all 12 units (149 -> 7,450; 114 -> 5,700; 22 -> 1,100). No
--   dealership was ever asked what a day of floor costs. The constant also
--   lives in apps/executive-dashboard/lib/unit-form.js as INV.HOLDING_PER_DAY.
--   A rate is only evidence if it carries WHAT / WHENCE / WHO / WHEN, plus
--   WHETHER IT IS REAL (holding_cost_basis). PLACEHOLDER is allowed, but every
--   figure derived from it is marked PLACEHOLDER all the way to the screen.
-- ===========================================================================

alter table public.inventory_profit_settings
  add column if not exists holding_cost_basis  text,
  add column if not exists holding_cost_set_by text;

comment on column public.inventory_profit_settings.holding_cost_basis is
  'DEALERSHIP_SUPPLIED = this dealership stated the rate and stands behind it; '
  'PLACEHOLDER = a working assumption, not their money. NULL = no rate on record. '
  'Every figure derived from a PLACEHOLDER rate is emitted with state PLACEHOLDER '
  'and must be labelled as an assumption on screen, or not shown. '
  'Never fabricate a monetary impact (PRODUCT.md).';

comment on column public.inventory_profit_settings.holding_cost_set_by is
  'WHO put the rate on record - a name or role the dealership recognises. A rate '
  'nobody stands behind is not evidence, so this is required alongside a rate.';

comment on column public.inventory_profit_settings.holding_cost_verified_at is
  'WHEN the rate was last confirmed with the dealership. Required alongside a rate.';

-- A rate without full provenance cannot be saved at all. This is the constraint
-- that makes the AED 50 unrepeatable: a future migration cannot quietly seed a
-- number, because it would have to also name a source, a person and a date.
alter table public.inventory_profit_settings
  drop constraint if exists ipset_holding_rate_needs_source;

alter table public.inventory_profit_settings
  drop constraint if exists ipset_holding_rate_full_provenance;
alter table public.inventory_profit_settings
  add constraint ipset_holding_rate_full_provenance check (
    holding_cost_per_day_aed is null
    or (
      nullif(btrim(holding_cost_source), '') is not null
      and nullif(btrim(holding_cost_set_by), '') is not null
      and holding_cost_verified_at is not null
      and holding_cost_basis in ('DEALERSHIP_SUPPLIED','PLACEHOLDER')
    )
  );

-- and provenance without a rate is a half-filled form, not a rate.
alter table public.inventory_profit_settings
  drop constraint if exists ipset_holding_provenance_needs_rate;
alter table public.inventory_profit_settings
  add constraint ipset_holding_provenance_needs_rate check (
    holding_cost_per_day_aed is not null
    or (holding_cost_basis is null and holding_cost_set_by is null
        and holding_cost_source is null and holding_cost_verified_at is null)
  );

-- ---------------------------------------------------------------------------
-- Three thresholds were still literals inside the Sentinel view. That is the
-- same mistake as the AED 50 - a chosen number a dealer cannot see or change -
-- so they become data with a documented default.
-- ---------------------------------------------------------------------------
alter table public.inventory_profit_settings
  add column if not exists min_model_token_overlap int not null default 2,
  add column if not exists accepted_market_match_quality text[] not null
      default array['exact','strong']::text[],
  add column if not exists market_max_age_days int not null default 14;

comment on column public.inventory_profit_settings.min_model_token_overlap is
  'CHOSEN, not measured. Default 2. How many model words a lead or inbound '
  'message must share with a unit before that enquiry is treated as being about '
  'that unit. 1 is too loose here - "toyota" alone joins five unrelated units.';

comment on column public.inventory_profit_settings.accepted_market_match_quality is
  'Which competitors.match_quality values are good enough to take a market '
  'position from. Default {exact,strong}. On 2 Sep 2026 no competitor row on '
  'this tenant carries either: 9 rows have no match_quality recorded at all and '
  '2 are self-declared "weak" with notes saying nothing ties the price to our '
  'car. So every unit reports market_position UNKNOWN, and the rows are shown '
  'as evidence instead. UNKNOWN, never an average, never inferred.';

comment on column public.inventory_profit_settings.market_max_age_days is
  'CHOSEN, not measured. Default 14. A scrape older than this is stale and '
  'yields UNKNOWN_STALE_COMPARABLE rather than a position.';

comment on table public.inventory_profit_settings is
  'Per-dealership configuration for the Inventory Profit Sentinel. Every number '
  'the engine uses that was not measured from the dealership''s own data lives '
  'here, with a column comment saying whether it was COPIED from a rule this '
  'database already runs, or CHOSEN with a stated reason. Nothing in the engine '
  'may hard-code a threshold or a rate.';