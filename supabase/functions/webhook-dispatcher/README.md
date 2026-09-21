# webhook-dispatcher

Delivers queued outbound webhooks (`nexus_webhook_claim_deliveries` →
signed POST → `nexus_webhook_mark_delivery`). Called every minute by pg_cron
via pg_net (migration `20260921211000_nx1014_webhook_dispatch_schedule.sql`).

- Deploy: `supabase functions deploy webhook-dispatcher --project-ref dsvuoovivysszdoiorch`
  (verify_jwt stays **on**; do not pass `--no-verify-jwt`). The function also
  rejects any bearer whose role is not `service_role`.
- Signature: `X-Nexus-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + rawBody)>`.
- Guards: https only, no URL credentials, localhost/`.local`/`.internal` and
  private/loopback/link-local/CGNAT/multicast IP literals refused, hostnames
  whose A/AAAA resolve to such addresses refused, redirects never followed,
  10 s timeout, 5 concurrent, 50 per run.
- Logs: counts and delivery ids only — never URL, secret, payload or response.
- Test: `node --test supabase/functions/webhook-dispatcher/lib.test.mjs`
