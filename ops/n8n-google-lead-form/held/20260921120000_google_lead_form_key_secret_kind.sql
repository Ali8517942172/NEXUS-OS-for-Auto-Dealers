-- SUPERSEDED by supabase/migrations/20260921200000_nx1011 (same kind, on conflict do nothing). Do not apply.
-- HELD. Not in supabase/migrations on purpose (CI pushes that folder to
-- production). Apply once, by the orchestrator or folded into the migration
-- that adds nexus_lead_source_connect.
--
-- The Google lead-form receiver (verify-and-redact.node.js) now reads each
-- endpoint's shared key from the vault:
--   nexus_lead_ingest_secret_reveal('google','google_webhook_id', <public_key>,
--                                   'google_lead_form_key', 'google lead form verify')
-- lead_ingest_secret.kind is an FK to this table, so the kind must exist before
-- nexus_lead_ingest_secret_put(<endpoint_id>, 'google_lead_form_key', ...) works.
-- The connect RPC must ALSO register the identity row
--   (provider 'google', identity_kind 'google_webhook_id',
--    identity_value = lead_ingest_endpoint.public_key, source_key
--    'google_ads_lead_form', status 'active') for the endpoint.
insert into public.lead_ingest_secret_kind (kind, description) values
  ('google_lead_form_key',
   'The per-endpoint shared key a dealership pastes into Google Ads as the lead form webhook "key". The Google lead-form receiver compares the google_key in each delivery body against it, resolved via provider identity google/google_webhook_id/<public_key>.')
on conflict (kind) do nothing;
