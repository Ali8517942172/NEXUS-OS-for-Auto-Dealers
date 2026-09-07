-- Lead ingestion, part 1 of 4: the vocabulary.
--
-- Two lookup tables, both platform-owned and neither tenant-scoped. They exist
-- so that provenance and source are values with meaning attached, rather than
-- free text a caller invents -- the same reason `channel_registry` exists for
-- the messaging side.
--
-- Today `leads.source` holds one value on all three production rows:
-- 'nexus-master-router', which is the name of the workflow that wrote the row.
-- The column records the writer, not the origin, so no question about where a
-- customer came from can be answered from this database at all. That is what
-- this part fixes.

create table public.lead_provenance_kind (
  kind                text primary key,
  is_cryptographic    boolean not null,
  strength_rank       smallint not null,
  counts_as_real      boolean not null,
  description         text not null,
  constraint lead_provenance_kind_rank_range check (strength_rank between 0 and 100)
);

comment on table public.lead_provenance_kind is
  'How the origin of a lead event was established. strength_rank orders these so '
  'no screen and no query can present a shared secret carried in a request body '
  'as equal to an HMAC over raw bytes. counts_as_real is false for anything a '
  'simulator or an operator can mint, and the lead_event CHECKs use it.';

insert into public.lead_provenance_kind (kind, is_cryptographic, strength_rank, counts_as_real, description) values
  ('hmac_sha256_x_hub',      true,  90, true,
   'HMAC-SHA256 over the raw request bytes, verified against X-Hub-Signature-256. Meta signs Lead Ads webhooks this way. Hashing a re-serialised JSON object never matches, so a verifier that parses first is not this kind.'),
  ('hmac_sha256_svix',       true,  85, true,
   'Svix-style signed webhook, verified over raw bytes. Resend inbound email uses this.'),
  ('shared_secret_header',   false, 50, true,
   'A secret carried in a request header and compared in constant time. Stronger than a body secret only because it is not part of the payload a parser may log.'),
  ('shared_secret_in_body',  false, 30, true,
   'A secret carried as a field inside the JSON body. This is what Google Ads lead forms send as google_key. It is not a signature: it does not attest the payload, and anyone who learns the key can forge a lead. Recorded as its own kind so it is never mistaken for one.'),
  ('origin_and_form_key',    false, 20, true,
   'A website form identified by an unguessable per-tenant key, with an Origin the endpoint expects. No secret and no signature. The weakest thing we accept from the public internet.'),
  ('operator_recorded',      false, 10, false,
   'A human at the dealership typed this in. Real in the sense that a person vouches for it, but it attests nothing about an external system, so it is not counted as an externally-originated lead.'),
  ('simulated',              false,  0, false,
   'Produced by the NEXUS marketplace simulator or a test harness. Can never be attached to a production endpoint -- lead_ingest_endpoint and lead_event both refuse that pairing structurally.'),
  ('unverified',             false,  0, false,
   'Origin was not established. Retained for inspection, never promoted to a lead.');

create table public.lead_source_catalogue (
  source_key            text primary key,
  display_name          text not null,
  channel_family        text not null,
  integration_status    text not null,
  delivery_shape        text not null,
  required_provenance   text not null references public.lead_provenance_kind(kind) on delete restrict,
  dedup_field           text not null,
  evidence_note         text not null,
  constraint lead_source_channel_family check (channel_family in
    ('social_lead_ad','search_lead_form','website','marketplace','messaging','offline')),
  constraint lead_source_integration_status check (integration_status in
    ('AVAILABLE','SIMULATED_ONLY','COMMERCIAL_CONVERSATION_REQUIRED','NOT_ESTABLISHED')),
  constraint lead_source_delivery_shape check (delivery_shape in
    ('WEBHOOK_FULL_PAYLOAD','WEBHOOK_METADATA_THEN_FETCH','INBOUND_EMAIL_METADATA_THEN_FETCH','INBOUND_MESSAGE','MANUAL_ENTRY'))
);

comment on table public.lead_source_catalogue is
  'Where a lead can come from, and what is true about each route as of 6 September 2026. '
  'integration_status is a commercial fact, not a build status: AVAILABLE means the '
  'provider publishes a contract we can implement today; COMMERCIAL_CONVERSATION_REQUIRED '
  'means no public route exists and engineering time spent on it is wasted until somebody '
  'signs something. delivery_shape is load-bearing -- WEBHOOK_METADATA_THEN_FETCH sources '
  'deliver no customer data in the webhook at all, so a one-shot ingestion design does not '
  'fit them.';

insert into public.lead_source_catalogue
  (source_key, display_name, channel_family, integration_status, delivery_shape, required_provenance, dedup_field, evidence_note) values
  ('meta_lead_ads_facebook', 'Facebook Lead Ads', 'social_lead_ad', 'AVAILABLE',
   'WEBHOOK_METADATA_THEN_FETCH', 'hmac_sha256_x_hub', 'leadgen_id',
   'The webhook body carries leadgen_id, page_id, form_id, ad_id, adgroup_id and created_time and NO customer fields. Field data comes from GET /v25.0/<leadgen_id> on a second hop, needs leads_retrieval plus Lead Access Manager access, and expires -- Meta documents a hard expiry and secondary sources put it at 90 days; that number is not verified against Meta''s own page and must not be treated as measured.'),
  ('meta_lead_ads_instagram', 'Instagram Lead Ads', 'social_lead_ad', 'AVAILABLE',
   'WEBHOOK_METADATA_THEN_FETCH', 'hmac_sha256_x_hub', 'leadgen_id',
   'Arrives on the connected Facebook Page''s leadgen subscription. There is no separate Instagram webhook to wire; the distinction is recorded here for attribution only.'),
  ('google_ads_lead_form', 'Google Ads Lead Form', 'search_lead_form', 'AVAILABLE',
   'WEBHOOK_FULL_PAYLOAD', 'shared_secret_in_body', 'lead_id',
   'Full lead data arrives in one hop. Authentication is google_key, a plaintext shared secret inside the body -- not a signature. Delivery is explicitly at-least-once. Google retries a 5XX and permanently discards the lead on a 4XX, so a processing failure must never answer 4XX. gcl_id is persisted because offline conversion upload needs it later.'),
  ('website_form', 'Dealership website form', 'website', 'AVAILABLE',
   'WEBHOOK_FULL_PAYLOAD', 'origin_and_form_key', 'submission_id',
   'Our own endpoint, so we set the contract: an unguessable per-tenant form key, an Origin check, a honeypot field, a rate limit and a client-minted submission id for idempotency. Never a raw public n8n webhook.'),
  ('marketplace_dubizzle', 'Dubizzle Motors', 'marketplace', 'COMMERCIAL_CONVERSATION_REQUIRED',
   'INBOUND_MESSAGE', 'simulated', 'simulator_scenario_id',
   'Searched 6 Sep 2026: no developer portal, no public leads-out API or webhook, no Zapier integration, and the only public API surface is third-party scrapers, which breach their terms. What a UAE dealer actually receives is a WhatsApp message from the listing, a phone call, a seller-dashboard entry or a notification email. So the real capture path is the WhatsApp channel NEXUS already runs, with an email parser as fallback; this row exists to be simulated and to be attributed, not to be integrated.'),
  ('marketplace_email_notification', 'Marketplace notification email', 'marketplace', 'AVAILABLE',
   'INBOUND_EMAIL_METADATA_THEN_FETCH', 'hmac_sha256_svix', 'rfc_message_id',
   'The universal fallback for any marketplace with no API. A dedicated subdomain with a distinct local-part per dealership -- not plus-addressing, which forwarders mangle. Route on the envelope recipient, never on the To: header, because a dealer forwarding from their own inbox leaves To: pointing at themselves. SPF fails across a forward by design, so DMARC cannot be the authenticity gate; the secret ingest address is.'),
  ('whatsapp_inbound', 'WhatsApp enquiry', 'messaging', 'AVAILABLE',
   'INBOUND_MESSAGE', 'shared_secret_header', 'wa_message_id',
   'Already live. Listed here so that a lead which began as a marketplace WhatsApp enquiry can be attributed to the marketplace rather than to the transport that carried it.'),
  ('walk_in', 'Walk-in / showroom', 'offline', 'AVAILABLE', 'MANUAL_ENTRY', 'operator_recorded', 'operator_reference',
   'Typed by a person. Present so the funnel is not silently missing the largest source in a UAE showroom.'),
  ('phone_call', 'Inbound phone call', 'offline', 'AVAILABLE', 'MANUAL_ENTRY', 'operator_recorded', 'operator_reference',
   'Typed by a person today. Call-tracking integration is roadmap, not capability.');

alter table public.lead_provenance_kind  enable row level security;
alter table public.lead_source_catalogue enable row level security;

-- These two are reference data a dealership legitimately reads: the Attribution
-- screen has to render a source's display name, and a lead's provenance has to
-- be explainable to the person looking at it. So SELECT is granted, and the
-- floor below is an explicit deny on writes rather than the absence of a grant.
-- An incidental lock is not a designed lock; this file has paid for that twice.
create policy lead_provenance_kind_read on public.lead_provenance_kind
  for select to authenticated using (true);
create policy lead_source_catalogue_read on public.lead_source_catalogue
  for select to authenticated using (true);
create policy lead_provenance_kind_service on public.lead_provenance_kind
  for all to service_role using (true) with check (true);
create policy lead_source_catalogue_service on public.lead_source_catalogue
  for all to service_role using (true) with check (true);
create policy lead_provenance_kind_deny_anon on public.lead_provenance_kind
  as restrictive for all to anon using (false) with check (false);
create policy lead_source_catalogue_deny_anon on public.lead_source_catalogue
  as restrictive for all to anon using (false) with check (false);

revoke all on public.lead_provenance_kind  from anon, authenticated, public;
revoke all on public.lead_source_catalogue from anon, authenticated, public;
grant select on public.lead_provenance_kind  to authenticated;
grant select on public.lead_source_catalogue to authenticated;
grant all    on public.lead_provenance_kind  to service_role;
grant all    on public.lead_source_catalogue to service_role;