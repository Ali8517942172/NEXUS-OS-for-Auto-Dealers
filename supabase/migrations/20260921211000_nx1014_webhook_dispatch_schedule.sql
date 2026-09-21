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
-- AUTH: A DISPATCH TOKEN THE MIGRATION MINTS ITSELF (no human handles a key)
--   This migration creates, only if absent, vault secret
--   'nexus_webhook_dispatch_token' = 32 random bytes as hex. The tick sends it
--   as header X-Nexus-Dispatch-Token. The Edge Function is deployed with
--   verify_jwt = false and validates the header by calling
--   public.nexus_webhook_dispatch_token_ok(p_token) with its auto-injected
--   SUPABASE_SERVICE_ROLE_KEY; that RPC is service_role-only and compares
--   sha256 digests, so the token never leaves the database except in the
--   tick's own request. No 'nexus_service_role_key' secret is needed.
--   Rotate: update vault.secrets (vault.update_secret) -- the next tick and
--   the next check both read the new value.
--
-- WHO MAY CALL THE TICK
--   It reads a Vault secret, so it is security definer and nobody but
--   service_role (and postgres, which owns it and runs pg_cron) may execute it.
--   Revoke names public AND the roles in one statement (see nx1010 /
--   ops/ci/function-grants.mjs), then asserted with has_function_privilege().

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

do $mint$
begin
  if not exists (select 1 from vault.secrets where name = 'nexus_webhook_dispatch_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'nexus_webhook_dispatch_token',
      'NX1014: X-Nexus-Dispatch-Token sent by pg_cron to the webhook-dispatcher Edge Function. Minted by the migration; no human holds it.');
  end if;
end
$mint$;

create or replace function public.nexus_webhook_dispatch_token_ok(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tok text;
begin
  select decrypted_secret into v_tok
    from vault.decrypted_secrets
   where name = 'nexus_webhook_dispatch_token'
   limit 1;
  if v_tok is null or v_tok = '' or p_token is null or length(p_token) <> length(v_tok) then
    return false;
  end if;
  -- Compare fixed-length digests rather than the raw strings.
  return extensions.digest(p_token, 'sha256') = extensions.digest(v_tok, 'sha256');
end;
$$;

comment on function public.nexus_webhook_dispatch_token_ok(text) is
  'NX1014: service_role only. True when p_token equals vault secret nexus_webhook_dispatch_token. Called by the webhook-dispatcher Edge Function.';

revoke all on function public.nexus_webhook_dispatch_token_ok(text) from public, anon, authenticated;
grant execute on function public.nexus_webhook_dispatch_token_ok(text) to service_role;

create or replace function public.nexus_webhook_dispatch_tick()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tok text;
  v_request_id bigint;
begin
  if not exists (select 1 from public.outbound_webhook_delivery d
                  where d.status in ('pending','failed') and d.next_attempt_at <= now()) then
    return null;
  end if;
  select decrypted_secret into v_tok
    from vault.decrypted_secrets
   where name = 'nexus_webhook_dispatch_token'
   limit 1;

  if v_tok is null or v_tok = '' then
    raise warning 'nexus_webhook_dispatch_tick: vault secret nexus_webhook_dispatch_token missing; skipped';
    return null;
  end if;

  select net.http_post(
    url := 'https://dsvuoovivysszdoiorch.supabase.co/functions/v1/webhook-dispatcher',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Nexus-Dispatch-Token', v_tok
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) into v_request_id;

  return v_request_id;
end;
$$;

comment on function public.nexus_webhook_dispatch_tick() is
  'NX1014: pg_cron clock for the outbound webhook dispatcher. Sends vault secret nexus_webhook_dispatch_token as X-Nexus-Dispatch-Token.';

revoke all on function public.nexus_webhook_dispatch_tick() from public, anon, authenticated;
grant execute on function public.nexus_webhook_dispatch_tick() to service_role;

do $verify$
begin
  if has_function_privilege('anon', 'public.nexus_webhook_dispatch_tick()', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_webhook_dispatch_tick()', 'execute')
     or has_function_privilege('anon', 'public.nexus_webhook_dispatch_token_ok(text)', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_webhook_dispatch_token_ok(text)', 'execute') then
    raise exception 'NX1014: dispatch tick/token fn is executable by anon/authenticated';
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