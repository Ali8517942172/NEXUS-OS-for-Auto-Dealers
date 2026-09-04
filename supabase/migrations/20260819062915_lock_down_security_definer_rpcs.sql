-- Supabase's own linter flagged these: both are SECURITY DEFINER and both were
-- callable via /rest/v1/rpc/… by the `anon` role — i.e. by anyone holding the
-- publishable key that ships inside the frontend bundle.
--
-- recompute_inventory_derived() rewrites days_in_stock, holding cost, net
-- margin and the ageing alert on EVERY inventory row. capture_daily_metrics()
-- writes a metrics row. Neither is something a browser should be able to fire,
-- and neither is called from the frontend — both are driven by n8n, which
-- authenticates as the service role and bypasses these grants entirely.
revoke execute on function public.recompute_inventory_derived() from anon, authenticated, public;
revoke execute on function public.capture_daily_metrics()        from anon, authenticated, public;

grant execute on function public.recompute_inventory_derived() to service_role;
grant execute on function public.capture_daily_metrics()        to service_role;

comment on function public.recompute_inventory_derived() is
  'Nightly recompute of the stored inventory ageing columns. service_role only — revoked from anon/authenticated on 19 Aug 2026 because the publishable key ships in the browser bundle.';
comment on function public.capture_daily_metrics() is
  'Snapshots daily_metrics. service_role only — revoked from anon/authenticated on 19 Aug 2026.';