/* ═══════════════════════════════════════════════════════════════════════════
   P0-1 · recompute_inventory_derived() rewrote every dealership's stock.

   BUSINESS RULE
   The seven derived columns on a unit — days in stock, gross margin, VAT,
   holding cost accrued, net margin, recommended commission and ageing alert —
   belong to exactly one dealership: the one whose tenant_id is on the row.
   Each is derived from that dealership's own price, cost and acquisition date
   and from that dealership's own configured holding rate and ageing bands. No
   dealership's settings may reach another dealership's car, and no signed-in
   account may write a figure onto stock it cannot see.

   TWO CALLERS ARE LEGITIMATE, AND THEY ARE NOT THE SAME CALLER
     · The nightly sweep. n8n's "Inventory Ageing Recompute" posts to
       /rest/v1/rpc/recompute_inventory_derived with the service key. It is
       SUPPOSED to span every dealership. PostgREST puts such a request in the
       service_role and it carries no auth.uid().
     · A signed-in user. The dashboard exposes the same RPC to `authenticated`.
       That caller must only ever touch their own dealership's rows.

   WHAT WAS WRONG — two independent defects in one statement
     1. No tenant predicate, and EXECUTE granted to `authenticated`. Any
        signed-in account at any dealership rewrote all seven columns on every
        other dealership's stock. Measured on 2 Sep 2026 with two live tenants:
        an account that could SEE 2 units reported 14 rows rewritten.
     2. `where i.id = d.id` joined on a key that is not unique. inventory's
        primary key is (tenant_id, id) — stock numbers are scoped per
        dealership, so two dealerships may both hold "NX-1010". Values
        therefore crossed between dealerships even on the legitimate
        service_role sweep. Measured: ALBA CARS' NX-1010 took the other
        dealership's 7-day age and its AED 999/day PLACEHOLDER holding rate,
        moving from days_in_stock 149 / holding NULL / net margin NULL /
        CRITICAL to 7 / 6,993 / 36,007 / WARNING. That is a fabricated monetary
        figure standing where the honest answer was "not computable", and the
        most aged unit on the lot silently losing its CRITICAL flag. Defect 2
        is not a permission bug; revoking the grant would have left the nightly
        job quietly corrupting margin across dealerships.

   THE FIX
     · The caller decides the scope. Anything that looks like a browser session
       — the `authenticated` or `anon` role, or any request that carries an
       auth.uid() — is scoped to nexus_current_tenant_id(), and touches nothing
       at all when that is null. Fail closed: a session with no dealership
       rewrites no rows rather than all of them.
     · Only a caller with no signed-in user and a non-browser role (service_role
       from n8n, or postgres from pg_cron) sweeps every dealership. That keeps
       the nightly job working across tenants, which is what it is for.
     · The join now carries the whole primary key, (tenant_id, id), so a shared
       stock number can no longer make one dealership's figures land on
       another's car.
     · The arithmetic moved into the derived set, so the statement itself is a
       plain assignment and the tenant key sits beside the join rather than a
       screen away from it.

   The signature is unchanged and still takes no tenant argument, on purpose: a
   tenant a caller supplies is a tenant a caller can forge — see
   action_write_audit in CLAUDE.md.
   ═══════════════════════════════════════════════════════════════════════════ */

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
  -- null means "sweep every dealership"; non-null means "this one only".
  v_scope      uuid;
begin
  if v_caller in ('authenticated', 'anon') or auth.uid() is not null then
    v_scope := public.nexus_current_tenant_id();
    if v_scope is null then
      -- A signed-in account that belongs to no dealership. It owns no rows, so
      -- it recomputes none. Returning zero is the honest answer; raising would
      -- only teach the dashboard to swallow it.
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
           round(b.price * 0.05) as vat_amount,

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
               coalesce(inv.price_aed, 0)                             as price,
               coalesce(inv.price_aed, 0) - coalesce(inv.cost_aed, 0) as gross_margin,
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
           and (v_scope is null or inv.tenant_id = v_scope)
      ) b
  ) d
  where i.tenant_id = d.tenant_id
    and i.id        = d.id
    and (v_scope is null or i.tenant_id = v_scope);

  get diagnostics touched = row_count;
  return touched;
end;
$function$;

comment on function public.recompute_inventory_derived() is
  'Recomputes the seven derived columns on inventory. Scope is decided by the '
  'caller, never by an argument: a browser session (role authenticated/anon, or '
  'any request carrying an auth.uid()) is confined to nexus_current_tenant_id() '
  'and rewrites nothing when that is null; a service-key or pg_cron caller with '
  'no signed-in user sweeps every dealership, which is what the nightly n8n '
  '"Inventory Ageing Recompute" needs. The join carries the whole primary key '
  '(tenant_id, id) because stock numbers are scoped per dealership and two '
  'dealerships may hold the same one — joining on id alone let one dealership''s '
  'holding rate and days-in-stock land on another dealership''s car. A missing '
  'holding rate yields NULL, not zero: unknown is not none.';

revoke execute on function public.recompute_inventory_derived() from public, anon;
grant  execute on function public.recompute_inventory_derived() to authenticated, service_role;