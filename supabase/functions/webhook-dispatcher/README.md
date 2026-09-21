# webhook-dispatcher

Delivers queued outbound webhooks (`nexus_webhook_claim_deliveries` →
signed POST → `nexus_webhook_mark_delivery`). Called every minute by pg_cron
via pg_net (migration `20260921211000_nx1014_webhook_dispatch_schedule.sql`).

- Deploy: `supabase functions deploy webhook-dispatcher --no-verify-jwt --project-ref dsvuoovivysszdoiorch`
  (verify_jwt = **false**). Auth is header `X-Nexus-Dispatch-Token`: NX1014
  mints a random 32-byte hex token into Vault secret
  `nexus_webhook_dispatch_token` (only if absent), the cron tick sends it, and
  the function checks it via service-role-only RPC
  `nexus_webhook_dispatch_token_ok(p_token)` using its auto-injected
  `SUPABASE_SERVICE_ROLE_KEY`. Anything else gets 403. No human creates or
  copies any key; there is no `nexus_service_role_key` Vault secret.
- Signature: `X-Nexus-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + rawBody)>`.
- Guards: https only, no URL credentials, localhost/`.local`/`.internal` and
  private/loopback/link-local/CGNAT/multicast IP literals refused, hostnames
  whose A/AAAA resolve to such addresses refused, redirects never followed,
  10 s timeout, 5 concurrent, 50 per run.
- Logs: counts and delivery ids only — never URL, secret, payload or response.
- Test: `node --test supabase/functions/webhook-dispatcher/lib.test.mjs`
