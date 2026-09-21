-- NX1014 — the outbound webhook queue is drained once a minute.
--
-- WHAT RUNS
--   pg_cron job 'nexus-webhook-dispatch' ('* * * * *') calls
--   public.nexus_webhook_dispatch_tick(), which fires ONE async pg_net POST at
--   the Edge Function /functions/v1/webhook-dispatcher. The function claims up
--   to 50 deliveries (nexus_webhook_claim_deliveries), signs and POSTs them,
--   and reports each back through nexus_webhook_mark_delivery. Nothing about a
--   delivery is decided here; this migration is only the clock.
--
-- EXTENSIONS (measured on production 21 Sep 2026 via pg_extension)
--   pg_cron         present (pg_catalog) — job 'nexus-daily-metrics' exists.
--   supabase_vault  present (vault).
--   pg_net          ABSENT — created below. It installs its own `net` schema.
--
-- THE KEY IS NOT IN THIS FILE
--   The Edge Function is deployed with verify_jwt = true and additionally
--   refuses any bearer whose role is not service_role, so the tick must send
--   the service-role key. It is read at call time from
--   vault.decrypted_secrets where name = 'nexus_service_role_key'. The
--   orchestrator creates that secret ONCE, out of band, never in a migration:
--       select vault.create_secret('<service role key>', 'nexus_service_role_key',
--                                  'NX1014 webhook-dispatcher bearer');
--   Until it exists the tick raises a WARNING and does nothing, so applying
--   this migration first is safe.
--
-- WHO MAY CALL THE TICK
--   It reads a Vault secret, so it is security definer and nobody but
--   service_role (and postgres, which owns it and runs pg_cron) may execute it.
--   Revoke names public AND the roles in one statement (see nx1010 /
--   ops/ci/function-grants.mjs), then asserted with has_function_privilege().

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

create or replace function public.nexus_webhook_dispatch_tick()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_key text;
  v_request_id bigint;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'nexus_service_role_key'
   limit 1;

  if v_key is null or v_key = '' then
    raise warning 'nexus_webhook_dispatch_tick: vault secret nexus_service_role_key missing; skipped';
    return null;
  end if;

  select net.http_post(
    url := 'https://dsvuoovivysszdoiorch.supabase.co/functions/v1/webhook-dispatcher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.nexus_webhook_dispatch_tick() is
  'NX1014: pg_cron clock for the outbound webhook dispatcher. Reads the bearer from vault secret nexus_service_role_key; never stores it.';

revoke all on function public.nexus_webhook_dispatch_tick() from public, anon, authenticated;
grant execute on function public.nexus_webhook_dispatch_tick() to service_role;

do $verify$
begin
  if has_function_privilege('anon', 'public.nexus_webhook_dispatch_tick()', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_webhook_dispatch_tick()', 'execute') then
    raise exception 'NX1014: nexus_webhook_dispatch_tick is executable by anon/authenticated';
  end if;
end
$verify$;

select cron.unschedule('nexus-webhook-dispatch')
where exists (select 1 from cron.job where jobname = 'nexus-webhook-dispatch');

select cron.schedule(
  'nexus-webhook-dispatch',
  '* * * * *',
  $$select public.nexus_webhook_dispatch_tick();$$
);