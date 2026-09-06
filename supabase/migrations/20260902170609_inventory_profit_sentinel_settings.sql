create table if not exists public.inventory_profit_settings (
  tenant_id                  uuid primary key not null default public.nexus_default_tenant_id()
                               references public.tenants(id) on delete cascade,
  holding_cost_per_day_aed   numeric(12,2),
  holding_cost_source        text,
  holding_cost_verified_at   timestamptz,
  aging_warn_days            integer not null default 90,
  aging_critical_days        integer not null default 120,
  promote_days               integer not null default 60,
  wholesale_days             integer not null default 180,
  min_reprice_margin_pct     numeric(5,2) not null default 8.00,
  market_tolerance_pct       numeric(5,2) not null default 3.00,
  enquiry_window_days        integer not null default 30,
  min_enquiry_sources        integer not null default 50,
  updated_at                 timestamptz not null default now(),
  constraint ipset_bands_ordered check (aging_warn_days < aging_critical_days),
  constraint ipset_promote_before_warn check (promote_days < aging_warn_days),
  constraint ipset_wholesale_after_critical check (wholesale_days >= aging_critical_days),
  constraint ipset_holding_rate_nonneg check (holding_cost_per_day_aed is null or holding_cost_per_day_aed >= 0),
  constraint ipset_holding_rate_needs_source
    check (holding_cost_per_day_aed is null or nullif(btrim(holding_cost_source), '') is not null)
);

comment on table public.inventory_profit_settings is
  'Inventory Profit Sentinel thresholds, one row per dealership. Every number the Sentinel decides on is here rather than in a query. A tenant with no row is evaluated on the column defaults, which is why every default is safe. Owner: the dealership. Read by public.v_inventory_profit_sentinel and by nothing else.';

comment on column public.inventory_profit_settings.holding_cost_per_day_aed is
  'DEFAULT NULL = UNKNOWN, deliberately. What one day of holding this dealership''s stock actually costs (floorplan interest + lot + insurance). Until a real figure is entered with a source, the Sentinel declares holding cost and net margin NOT COMPUTABLE and shows the inputs instead. NOT seeded to the AED 50/day asserted by recompute_inventory_derived() and lib/unit-form.js INV.HOLDING_PER_DAY: neither cites a source, so neither is evidence. Never fabricate a monetary impact (PRODUCT.md).';
comment on column public.inventory_profit_settings.holding_cost_source is
  'Where the rate came from, in the dealership''s own words. A rate cannot be saved without one (constraint ipset_holding_rate_needs_source).';
comment on column public.inventory_profit_settings.aging_warn_days is
  'SOURCE: public.recompute_inventory_derived(), which raises WARNING at 90 days. Not chosen here - copied from the rule the database already runs nightly so the Sentinel, inventory.aging_alert and Overview agree. Known third definition: lib/unit-form.js INV.WARN_DAYS = 75. The Sentinel follows Postgres, not the browser constant.';
comment on column public.inventory_profit_settings.aging_critical_days is
  'SOURCE: public.recompute_inventory_derived(), CRITICAL at 120 days. All three existing definitions in this product agree on 120.';
comment on column public.inventory_profit_settings.promote_days is
  'CHOSEN, not measured. Default 60 = two-thirds of aging_warn_days: the last third of the healthy band, where marketing spend still has full margin behind it.';
comment on column public.inventory_profit_settings.wholesale_days is
  'CHOSEN, not measured. Default 180 = 1.5x aging_critical_days. Recommending a wholesale is recommending a certain loss, so the engine is deliberately slow to say it.';
comment on column public.inventory_profit_settings.min_reprice_margin_pct is
  'CHOSEN, not measured. Default 8%. Gross margin as a percentage of list below which a price cut has no room to work - an aged unit under this floor is an INSPECT or MANAGER_REVIEW, not a REPRICE.';
comment on column public.inventory_profit_settings.market_tolerance_pct is
  'CHOSEN, not measured. Default 3%. How far list can sit from a VERIFIED comparable before the position is called above or below market. Never applied to an unverified comparable.';
comment on column public.inventory_profit_settings.enquiry_window_days is
  'CHOSEN, not measured. Default 30. How far back enquiry volume is counted.';
comment on column public.inventory_profit_settings.min_enquiry_sources is
  'CHOSEN, not measured. Default 50. Below this many resolvable enquiry source rows in the window across the whole lot, a per-unit enquiry count of zero is a statement about our records, not about the market - shown as evidence and NOT allowed to move a recommendation. A missing input is not a zero (PRODUCT.md).';

alter table public.inventory_profit_settings enable row level security;

drop policy if exists ipset_authenticated_all on public.inventory_profit_settings;
create policy ipset_authenticated_all on public.inventory_profit_settings
  for all to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()))
  with check (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists ipset_deny_anon on public.inventory_profit_settings;
create policy ipset_deny_anon on public.inventory_profit_settings
  for all to anon using (false) with check (false);

drop policy if exists ipset_service_role_all on public.inventory_profit_settings;
create policy ipset_service_role_all on public.inventory_profit_settings
  for all to service_role using (true) with check (true);

insert into public.inventory_profit_settings (tenant_id)
select distinct i.tenant_id from public.inventory i
on conflict (tenant_id) do nothing;