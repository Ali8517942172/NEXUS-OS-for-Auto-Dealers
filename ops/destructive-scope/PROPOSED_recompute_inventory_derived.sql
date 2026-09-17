-- =====================================================================
-- PROPOSAL ONLY — NOT APPLIED. DO NOT RUN WITHOUT ALI'S EXPLICIT YES.
--
-- APPLYING THIS CHANGES WHAT RUNS NIGHTLY.
--
-- public.recompute_inventory_derived() is called at 00:15 Asia/Dubai every
-- night by the n8n workflow "Inventory Ageing Recompute" (n8n id
-- ZUc42jcwwHoBeEr8, active) as POST /rest/v1/rpc/recompute_inventory_derived
-- with body {}. It is also callable by signed-in dashboard users. Replacing it
-- changes the figures shown to the dealership the next morning — days in stock,
-- VAT, net margin, recommended commission and the aging alert. That is exactly
-- the class of change Ali has said does not happen without his yes.
--
-- Intended filename when he approves (repo convention, nx983 is the latest
-- number in supabase/migrations/):
--   supabase/migrations/20260918090000_nx984_the_tax_rate_and_the_working_day_belong_to_the_dealership.sql
--
-- Author: agent PURGE-FIX, 17 September 2026. Written against the LIVE
-- definition read out of pg_proc on dsvuoovivysszdoiorch, not against the
-- superseded copy in 20260830051654_fix_days_in_stock_dubai_date.sql.
-- =====================================================================


-- ---------------------------------------------------------------------
-- WHAT IS ALREADY DONE, SO THIS MIGRATION DOES NOT CLAIM IT
-- ---------------------------------------------------------------------
-- The brief for this work said the function has "no tenant predicate and no
-- tenant parameter — a mass UPDATE of every dealership's inventory from one
-- empty call". That describes 20260830051654, which is SUPERSEDED. The live
-- function, established by 20260902195239 and 20260906065739, ALREADY:
--
--   * enumerates dealerships into v_tenants uuid[] rather than writing whatever
--     rows exist;
--   * scopes the UPDATE with `and i.tenant_id = any(v_tenants)`;
--   * returns 0 for a signed-in account that belongs to no dealership;
--   * excludes the quarantine tenant, via nexus_active_dealership_ids();
--   * reads holding_cost_per_day_aed, aging_warn_days and aging_critical_days
--     per tenant from public.inventory_profit_settings.
--
-- So THREE of the five economics named in the brief — holding cost and the two
-- ageing thresholds — are already per-tenant, and the cross-dealership UPDATE
-- is already closed. This migration must not re-announce them as fixes.
--
-- WHAT THIS MIGRATION ACTUALLY CHANGES — four things, no more:
--
--   1. VAT 5% stops being a literal. It comes from the dealership's settings
--      row. VAT is a jurisdiction rate; 0.05 is the UAE standard rate and is
--      simply wrong for a dealership anywhere else, silently.
--   2. Commission 5% stops being a literal. It is a commercial policy each
--      dealership sets, not a product constant.
--   3. 'Asia/Dubai' stops being a literal. The working day that decides
--      days_in_stock comes from public.tenant_configuration.timezone, which
--      already exists as a column.
--   4. The function gains `p_tenant_id uuid default null`, so one dealership
--      can be recomputed on its own and the blast radius of a single call can
--      be capped. Passing null keeps today's behaviour exactly.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- STEP 1 — the two rates get a home in the table that already owns this
-- ---------------------------------------------------------------------
-- public.inventory_profit_settings already exists (20260902170609), is one row
-- per dealership, is RLS'd, and its own comment says "every number the Sentinel
-- decides on is here rather than in a query". The rates belong there. No new
-- table is invented.
--
-- Nullable on purpose, and consistent with how holding_cost_per_day_aed is
-- already treated in this schema: NULL means UNKNOWN, never zero. A dealership
-- that has not stated a VAT rate gets vat_amount = NULL, which the existing
-- function and the Sentinel view already render as not-computable — the same
-- discipline that stops an unknown holding rate becoming AED 0.
--
-- Each rate requires a source, mirroring ipset_holding_rate_needs_source. A
-- tax rate with no provenance is an assertion, and this product does not make
-- assertions about money.

alter table public.inventory_profit_settings
  add column if not exists vat_rate_pct           numeric(5,2),
  add column if not exists vat_rate_source        text,
  add column if not exists commission_rate_pct    numeric(5,2),
  add column if not exists commission_rate_source text;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'ipset_vat_rate_range') then
    alter table public.inventory_profit_settings
      add constraint ipset_vat_rate_range
        check (vat_rate_pct is null or (vat_rate_pct >= 0 and vat_rate_pct <= 100));
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'ipset_vat_rate_needs_source') then
    alter table public.inventory_profit_settings
      add constraint ipset_vat_rate_needs_source
        check (vat_rate_pct is null or nullif(btrim(vat_rate_source), '') is not null);
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'ipset_commission_rate_range') then
    alter table public.inventory_profit_settings
      add constraint ipset_commission_rate_range
        check (commission_rate_pct is null or (commission_rate_pct >= 0 and commission_rate_pct <= 100));
  end if;

  if not exists (select 1 from pg_constraint
                  where conname = 'ipset_commission_rate_needs_source') then
    alter table public.inventory_profit_settings
      add constraint ipset_commission_rate_needs_source
        check (commission_rate_pct is null or nullif(btrim(commission_rate_source), '') is not null);
  end if;
end
$$;

comment on column public.inventory_profit_settings.vat_rate_pct is
  'DEFAULT NULL = UNKNOWN. The VAT rate this dealership charges, as a percentage. '
  'Until it is stated with a source, vat_amount is NULL rather than a number, because '
  'a tax figure computed at somebody else''s rate is worse than no figure. Existing '
  'rows are backfilled to 5.00 to preserve the behaviour that ran before this migration.';
comment on column public.inventory_profit_settings.commission_rate_pct is
  'DEFAULT NULL = UNKNOWN. The percentage of net margin this dealership pays as sales '
  'commission. CHOSEN by the dealership, not measured by us. Was hard-coded 5%.';

-- BACKFILL, so tonight's numbers do not move for a dealership that already has
-- them. Every existing settings row inherits exactly the literal that was in
-- the function, and the source names where it came from rather than pretending
-- it was verified.
update public.inventory_profit_settings
   set vat_rate_pct    = 5.00,
       vat_rate_source = 'INHERITED 2026-09-17: the literal 0.05 that public.recompute_inventory_derived() '
                         || 'applied before nx984. UAE standard rate. NOT verified against this dealership''s '
                         || 'own VAT filings — replace this source line when it is.'
 where vat_rate_pct is null;

update public.inventory_profit_settings
   set commission_rate_pct    = 5.00,
       commission_rate_source = 'INHERITED 2026-09-17: the literal 0.05 that public.recompute_inventory_derived() '
                                || 'applied before nx984. NOT a stated policy of this dealership — replace when '
                                || 'the dealership states its own commission rate.'
 where commission_rate_pct is null;

-- NOTE FOR ALI, deliberately not hidden in a comment further down:
-- the backfill above means ALBA CARS sees IDENTICAL numbers after this
-- migration. A NEW dealership onboarded after it gets NULL rates and therefore
-- NULL vat_amount and NULL recommended_commission until somebody states their
-- rates. That is the intended behaviour — an empty field a human must fill,
-- rather than a UAE tax rate quietly applied to a dealership in another country.
-- If you would rather new dealerships also default to 5%, say so and the two
-- columns get `default 5.00`; but then the wrong-jurisdiction failure is silent
-- again, which is the thing this migration exists to stop.


-- ---------------------------------------------------------------------
-- STEP 2 — drop the zero-argument function BEFORE creating the new one
-- ---------------------------------------------------------------------
-- THIS STEP IS LOAD-BEARING AND IS THE MOST LIKELY WAY TO BREAK THE NIGHTLY.
--
-- Postgres overloads on signature. `create or replace function
-- recompute_inventory_derived(p_tenant_id uuid default null)` does NOT replace
-- the existing `recompute_inventory_derived()`; it creates a SECOND function.
-- A call with no arguments — which is exactly what the n8n node sends, POST
-- .../rpc/recompute_inventory_derived with body {} — then matches BOTH and
-- Postgres raises 42725 "function is not unique". The nightly would start
-- failing the night this is applied, and the dashboard's own recompute button
-- with it.
--
-- So the old signature is dropped first, in the same transaction, and every
-- grant it held is restored explicitly below. Measured grants on the existing
-- function, from pg_proc.proacl on production 2026-09-17:
--     postgres=X/postgres | service_role=X/postgres | authenticated=X/postgres
-- Those three are re-granted at the end and nothing else is.

drop function if exists public.recompute_inventory_derived();


-- ---------------------------------------------------------------------
-- STEP 3 — the function
-- ---------------------------------------------------------------------
create or replace function public.recompute_inventory_derived(
  p_tenant_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  touched   integer;
  -- PostgREST issues SET LOCAL ROLE before the call, and that setting survives
  -- entry into a SECURITY DEFINER function even though current_user does not.
  v_caller  text := coalesce(nullif(current_setting('role', true), ''), current_user::text);
  -- The dealerships this call will write, named explicitly. There is no
  -- "null means everyone" here: the sweep used to be an unscoped UPDATE, which
  -- on 6 Sep touched 33 rows across three dealerships for a caller that had
  -- named none of them. That is fixed and stays fixed.
  v_tenants uuid[];
begin
  if v_caller in ('authenticated', 'anon') or auth.uid() is not null then
    -- A signed-in dealership user recomputes their own dealership and no other.
    -- An account that belongs to none owns no rows, so it recomputes none.
    if public.nexus_current_tenant_id() is null then
      return 0;
    end if;
    v_tenants := array[public.nexus_current_tenant_id()];

    -- NEW: an explicit p_tenant_id from a signed-in caller is checked against
    -- what that caller actually holds. It can NARROW the sweep and can never
    -- widen it. Naming a dealership you do not belong to is refused loudly
    -- rather than silently returning 0, because a silent 0 is indistinguishable
    -- from "nothing to do" and would hide an attempted cross-tenant write.
    if p_tenant_id is not null then
      if p_tenant_id <> all (
           select t from unnest(v_tenants) t
         ) then
        raise exception
          using errcode = 'P0001',
                message = 'NX984 TENANT_NOT_YOURS: recompute_inventory_derived was asked to '
                          || 'recompute a dealership this account does not belong to.',
                hint    = 'Call it with no argument to recompute your own dealership.';
      end if;
      v_tenants := array[p_tenant_id];
    end if;

  else
    -- A backend batch (n8n holds service_role; the nightly Inventory Ageing
    -- Recompute is the only caller on the box). It legitimately sweeps every
    -- dealership - but it enumerates them, from the one function that answers
    -- that question in the plural, rather than writing whatever rows exist.
    if p_tenant_id is not null then
      -- NEW: a backend caller may cap the blast radius to one dealership. It
      -- still has to be a real ACTIVE dealership - the quarantine tenant cannot
      -- be recomputed by naming it directly, which is the whole point of
      -- nexus_active_dealership_ids() being the only source of truth here.
      select coalesce(array_agg(t), '{}'::uuid[])
        into v_tenants
        from public.nexus_active_dealership_ids() t
       where t = p_tenant_id;
      if cardinality(v_tenants) = 0 then
        raise exception
          using errcode = 'P0001',
                message = 'NX984 NOT_AN_ACTIVE_DEALERSHIP: recompute_inventory_derived was asked to '
                          || 'recompute a tenant that is not an active dealership.',
                detail  = 'The quarantine tenant is excluded by definition, as it is in every '
                          || 'tenant-carrying view.';
      end if;
    else
      select coalesce(array_agg(t), '{}'::uuid[])
        into v_tenants
        from public.nexus_active_dealership_ids() t;
      if cardinality(v_tenants) = 0 then
        return 0;
      end if;
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

           -- VAT is a percentage of a price. With no price on record there is
           -- no VAT figure, and zero is not one.
           -- CHANGED BY NX984: the rate is b.vat_rate, read from this
           -- dealership's own settings row, not the literal 0.05. A dealership
           -- that has not stated a rate gets NULL - unknown, never zero, never
           -- somebody else's tax law.
           case when b.price is null      then null
                when b.vat_rate is null   then null
                else round(b.price * b.vat_rate / 100.0) end as vat_amount,

           -- Holding cost stops accruing once a unit is marked Sold: the figure
           -- frozen at that moment is the record of what it actually cost to
           -- keep. A dealership that has never stated a rate gets NULL, which
           -- means UNKNOWN and never zero. (Unchanged by nx984.)
           case when b.sold          then b.frozen_holding
                when b.rate is null  then null
                else round(b.days_in_stock * b.rate) end as holding_cost_accrued,

           case when b.sold then
                  case when b.frozen_holding is null then null
                       else b.gross_margin - b.frozen_holding end
                when b.rate is null then null      -- gross is known, net is not
                else b.gross_margin - round(b.days_in_stock * b.rate) end as net_margin,

           -- CHANGED BY NX984: b.comm_rate rather than the literal 0.05.
           case when b.comm_rate is null then null
                when b.sold then
                  case when b.frozen_holding is null then null
                       else round((b.gross_margin - b.frozen_holding) * b.comm_rate / 100.0) end
                when b.rate is null then null
                else round((b.gross_margin - round(b.days_in_stock * b.rate)) * b.comm_rate / 100.0) end
             as recommended_commission,

           case when b.sold                        then 'HEALTHY'
                when b.days_in_stock >= b.crit_days then 'CRITICAL'
                when b.days_in_stock >= b.warn_days then 'WARNING'
                else 'HEALTHY' end as aging_alert
      from (
        select inv.tenant_id,
               inv.id,

               -- CHANGED BY NX984. This was
               --   today_dubai date := (now() at time zone 'Asia/Dubai')::date
               -- computed ONCE for the whole call, in one hard-coded zone. The
               -- workflow fires at 00:15 Dubai, which is 20:15 UTC the previous
               -- day, so the zone is not cosmetic: it decides which calendar day
               -- a car has been in stock for, which decides the WARNING/CRITICAL
               -- band, which the WhatsApp sales agent reads to decide how hard it
               -- may discount. Getting it from the wrong zone is a pricing error.
               --
               -- It is now per dealership, from public.tenant_configuration.
               --
               -- MEASURED 2026-09-17: tenant_configuration.timezone is NULL for
               -- ALBA CARS. So the coalesce below is what will actually run
               -- tonight, and this migration on its own changes NOTHING about
               -- the working day until somebody fills that field in. Said plainly
               -- rather than left to be discovered: the fallback is the old
               -- literal, and the fix is only real once the column is populated.
               greatest(0, (now() at time zone coalesce(nullif(btrim(tc.timezone), ''), 'Asia/Dubai'))::date
                           - inv.acquired_at)                 as days_in_stock,

               inv.price_aed                                  as price,

               -- Both inputs are required and neither is guessable; missing
               -- either is NULL, and inventory.gross_margin_state says which one
               -- is missing. Character for character the expression
               -- v_inventory_profit_sentinel uses. (Unchanged by nx984.)
               case when inv.price_aed is null or inv.cost_aed is null then null
                    else inv.price_aed - inv.cost_aed end     as gross_margin,

               lower(coalesce(inv.status, '')) = 'sold'       as sold,
               inv.holding_cost_accrued                       as frozen_holding,
               s.holding_cost_per_day_aed                     as rate,
               coalesce(s.aging_warn_days, 90)                as warn_days,
               coalesce(s.aging_critical_days, 120)           as crit_days,
               s.vat_rate_pct                                 as vat_rate,
               s.commission_rate_pct                          as comm_rate
          from public.inventory inv
          -- Both joins are on tenant_id, so a dealership can only ever be
          -- measured against its own rates, its own bands and its own clock.
          left join public.inventory_profit_settings s  on s.tenant_id  = inv.tenant_id
          left join public.tenant_configuration      tc on tc.tenant_id = inv.tenant_id
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

comment on function public.recompute_inventory_derived(uuid) is
  'NX984. Nightly inventory derived-figure sweep, scoped to the caller''s own dealerships '
  '(or, for a service_role batch, to the active dealerships it enumerates). p_tenant_id is '
  'optional and can only NARROW that set, never widen it. VAT rate, commission rate, holding '
  'rate and the two ageing bands all come from public.inventory_profit_settings per tenant; '
  'the working-day timezone comes from public.tenant_configuration. No commercial or tax '
  'constant is a literal in this function any more, except the documented fallbacks.';

-- Restore exactly the grants the dropped zero-arg function held, and nothing
-- more. Measured on production 2026-09-17 from pg_proc.proacl.
revoke all on function public.recompute_inventory_derived(uuid) from public, anon;
grant execute on function public.recompute_inventory_derived(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- STEP 4 — assertions. If any of these fail, the migration has not done
-- what it claims and the transaction should not commit.
-- ---------------------------------------------------------------------
do $verify$
declare
  n_sig  integer;
  n_lit  integer;
  def    text;
begin
  -- Exactly one signature must exist, or the nightly's no-argument call is
  -- ambiguous and fails.
  select count(*) into n_sig
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'recompute_inventory_derived';
  if n_sig <> 1 then
    raise exception 'NX984 ASSERT FAILED: % signatures of recompute_inventory_derived exist; '
                    'a no-argument call would be ambiguous and the nightly would break.', n_sig;
  end if;

  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'recompute_inventory_derived';

  if def like '%* 0.05%' then
    raise exception 'NX984 ASSERT FAILED: a 0.05 literal survives in the function body.';
  end if;
  if position('''Asia/Dubai''' in def) = 0 then
    raise notice 'NX984: no Asia/Dubai fallback found - check this is intended.';
  end if;
  if def not like '%any(v_tenants)%' then
    raise exception 'NX984 ASSERT FAILED: the tenant predicate on the UPDATE is missing.';
  end if;

  -- Every existing dealership must carry both rates, or this migration has
  -- silently turned somebody's VAT figure into NULL.
  select count(*) into n_lit
    from public.inventory_profit_settings
   where vat_rate_pct is null or commission_rate_pct is null;
  if n_lit > 0 then
    raise exception 'NX984 ASSERT FAILED: % settings row(s) have no rate after backfill; '
                    'their vat_amount and recommended_commission would become NULL.', n_lit;
  end if;

  raise notice 'NX984 OK: one signature, no rate literals, tenant predicate intact, % settings row(s) backfilled.',
    (select count(*) from public.inventory_profit_settings);
end
$verify$;


-- ---------------------------------------------------------------------
-- ROLLBACK, if the next morning's numbers look wrong
-- ---------------------------------------------------------------------
-- Re-apply 20260906065739_inventory_derived_figures_refuse_to_invent_a_missing_input.sql
-- verbatim, then drop this signature:
--     drop function if exists public.recompute_inventory_derived(uuid);
-- The four added columns are additive and harmless to leave in place; nothing
-- outside this function reads them yet. The stored inventory figures are
-- recomputed from source every night, so one bad night self-corrects on the
-- next run once the function is back.
