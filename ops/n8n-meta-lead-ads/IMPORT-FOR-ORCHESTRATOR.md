# Meta Lead Ads receiver — import / publish (orchestrator only)

Branch `feat/ls-receivers`. Nothing here has been imported; this file is the
exact procedure. The orchestrator is the only n8n writer.

## What changed

* Hop two (`Fetch Lead From Graph`) fetches `GET /v25.0/<leadgen_id>` with the
  **per-Page** token only:
  `nexus_lead_ingest_secret_reveal('meta','facebook_page_id',<page_id>,'meta_page_access_token','leadgen hydrate')`.
  `META_PAGE_ACCESS_TOKEN` and `NEXUS_REQUIRE_PER_DEALER_SECRETS` are no longer
  read. There is no global fallback.
* New refusal `PAGE_TOKEN_TENANT_MISMATCH`: the token's tenant (from the vault)
  must equal the tenant `Record Lead Event` wrote the row under, or nothing is
  fetched. A Page of tenant X only ever produces leads for X.
* Signature verification unchanged: `X-Hub-Signature-256` against the one
  app-level `META_APP_SECRET` (pure-JS HMAC; the Code sandbox has no crypto).
* Failure answers unchanged (FAILURE-MODES.md): unknown/disabled Page →
  `Respond Page Not Registered` 500 (Meta retries, nothing written); no token /
  vault unreachable / tenant mismatch → row stays `RECEIVED`, answer 500 so the
  lead is redelivered after the dealer (re)connects.

## Vault kind — must match the connect RPC

The only kind the DB accepts for Page tokens is **`meta_page_access_token`**
(`lead_ingest_secret.kind` is an FK to `lead_ingest_secret_kind`; measured in
production 21 Sep 2026: kinds = `meta_page_access_token`,
`google_ads_developer_token`). `nexus_lead_source_connect` must call
`nexus_lead_ingest_secret_put(<endpoint_id>, 'meta_page_access_token', <token>, ...)`
— NOT `'page_access_token'`, which the FK rejects — and register
`lead_ingest_provider_identity(provider 'meta', identity_kind 'facebook_page_id',
identity_value <page_id>, source_key 'meta_lead_ads_facebook', status 'active')`
on an `active` endpoint of an `active` tenant.

## Import and publish

1. n8n → Workflows → Import from File → `ops/n8n-meta-lead-ads/meta-lead-ads.workflow.json`.
   Workflow name: **`Meta Lead Ads - Inbound Receiver`**. Webhook path
   `meta-lead-ads` (GET verify + POST deliveries, raw body ON), i.e.
   `https://35.224.126.225.nip.io/webhook/meta-lead-ads`.
2. On the five HTTP Request nodes (Resolve Dealership From Page, Record Lead
   Event, Hydrate Lead Event, Promote Lead Event, Reject Lead Event) select the
   existing **Supabase** (`supabaseApi`, service role) credential.
3. Confirm the Code-node bodies equal the repo files (they are embedded
   byte-identical): `verify-and-extract.node.js`, `fetch-lead-from-graph.node.js`,
   `normalize-and-redact.node.js`.
4. Publish / activate.

## Env vars on the VM (n8n **and** n8n-worker containers)

| var | why |
|---|---|
| `META_APP_SECRET` | HMAC of every delivery (one NEXUS Meta app) |
| `META_WEBHOOK_VERIFY_TOKEN` | the GET `hub.challenge` handshake |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | the Fetch node's Code-level call to `nexus_lead_ingest_secret_reveal` (done in code, not an HTTP node, so the token never lands in execution data). Confirm present; do not print. |

`META_GRAPH_VERSION` optional (default `v25.0`). `N8N_BLOCK_ENV_ACCESS_IN_NODE`
must not be `true`. **Remove / do not set `META_PAGE_ACCESS_TOKEN`** — it is
unread now; leaving a dealer token in the box env is pointless exposure.

## Meta app one-time setup (NEXUS app, once)

1. App Dashboard → Webhooks → object **Page** → callback
   `https://35.224.126.225.nip.io/webhook/meta-lead-ads`, verify token =
   `META_WEBHOOK_VERIFY_TOKEN` → subscribe field **`leadgen`**.
2. App permissions (Advanced Access, App Review): `leads_retrieval`,
   `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`,
   `pages_manage_ads`. App in Live mode.

## Per dealer Page (every connect)

The app-level subscription alone delivers nothing: each Page must install the
app. With the dealer's Page access token (the one the connect flow stores):

```
POST https://graph.facebook.com/v25.0/<page_id>/subscribed_apps?subscribed_fields=leadgen
Authorization: Bearer <page access token>
→ {"success": true}
```

Not built as an n8n workflow here: it needs the token at connect time, which the
connect flow already holds, so the simplest correct place is the connect flow
itself (or run it once manually per Page via Graph API Explorer). Verify with
`GET /v25.0/<page_id>/subscribed_apps` (the NEXUS app listed with `leadgen`).
Also: the token's user/System User needs Lead Access on the Page
(Business Settings → Integrations → Lead Access Manager) or hop two ends
`GRAPH_LEAD_ACCESS_NOT_GRANTED` (code 200).

## Google receiver (same branch, `ops/n8n-google-lead-form/`)

`Verify And Redact` now reads the per-endpoint key from the vault first:
`nexus_lead_ingest_secret_reveal('google','google_webhook_id',<public_key from URL k>,'google_lead_form_key','google lead form verify')`,
and refuses `ENDPOINT_SECRET_TENANT_MISMATCH` unless the vault's endpoint/tenant
equal the endpoint the URL key resolved to. Legacy `$env[secret_ref]`
(`GOOGLE_LEAD_KEY_ALBA`, per endpoint, not global) is used only when the vault
has nothing. Before this works for self-connecting dealers:
1. Apply `ops/n8n-google-lead-form/held/20260921120000_google_lead_form_key_secret_kind.sql`
   (adds kind `google_lead_form_key`).
2. Connect RPC: `secret_put(<endpoint_id>,'google_lead_form_key',<generated>)`
   + identity row (`google`,`google_webhook_id`, `<public_key>`,
   `google_ads_lead_form`, `active`).
3. Update live workflow `EYva4c2bMV5MGq0o` node `Verify And Redact` with
   `verify-and-redact.node.js` (or re-import `google-ads-lead.workflow.json`);
   it needs `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` in env too.
