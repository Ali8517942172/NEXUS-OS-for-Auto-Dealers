# api-v1 — NEXUS public REST API

Tenant-scoped REST API for a dealership's own DMS / CRM / call system.
Contract: `openapi.yaml`. Database half: `supabase/migrations/20260921210000_nx1013_nexus_sits_on_top_public_api.sql`.

## Deploy

1. Apply migration NX1013.
2. `supabase functions deploy api-v1 --no-verify-jwt` — callers present a NEXUS API key, not a Supabase JWT.
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase; nothing is hand-set.
3. Smoke: create a key in Settings → API (or `select * from nexus_api_key_create('smoke')` as an owner),
   then `curl -H "Authorization: Bearer $KEY" https://<ref>.supabase.co/functions/v1/api-v1/v1/me`.

## Notes

- Tenant comes only from `nexus_api_authenticate()`; no request field can name one.
- Rate limit 120/min/key in Postgres (`api_rate_window`); limiter failure serves the request, auth failure never does.
- No CORS headers (server-to-server). Logs carry request id, route, status, ms, key id — no bodies or PII.
- Tests: `node --test supabase/functions/api-v1/validate.test.mjs`.
