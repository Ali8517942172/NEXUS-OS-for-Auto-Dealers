-- HELD. DO NOT APPLY.
--
-- This file is not in supabase/migrations/ and must not be moved there until
-- the owner has read it and decided. It is written against production
-- dsvuoovivysszdoiorch as measured on 13 Sep 2026, and it has been read-only
-- verified, never executed.
--
-- WHAT IT IS FOR
-- apps/marketing-site/api/lead.js has an OPTIONAL second write: when
-- SUPABASE_URL, SUPABASE_SERVICE_KEY and NEXUS_LEAD_ENDPOINT_KEY are all set it
-- calls nexus_record_lead_event() so the website exercises the real ingestion
-- contract with real traffic. That path has nowhere legal to land today.
--
-- MEASURED, 13 Sep 2026, production:
--   select id, name, slug, status from public.tenants;
--     fff6a2b5-cfd5-4460-8383-875bc5826de0  Tenant A                                  alba-cars        active
--     02c86264-6653-4522-b055-1c3f359a82fe  UNATTRIBUTED - QUARANTINE (not a dealership) __unattributed__ quarantine
--   lead_ingest_endpoint: 5 rows, every one environment='production'.
--   There is no simulation endpoint and no website endpoint of any kind.
--
-- So there is NO suitable tenant and this file has to create one. The two that
-- exist are both wrong, for different reasons:
--   - Tenant A is a real dealership. Filing NEXUS's own sales prospects into it
--     would put the vendor's pipeline inside a customer's data, which is the
--     exact boundary this product exists to hold.
--   - The quarantine tenant is status='quarantine', and
--     nexus_lead_endpoint_for_public_key() requires t.status='active'
--     (20260907023225_leadingest_02_tenant_bound_endpoints.sql), so an endpoint
--     under it resolves to zero rows and every call fails. It is also the
--     unattributed default, which is a destination for leads whose owner is
--     unknown -- not a test harness.
--
-- WHAT THE SIMULATION TENANT MUST NOT BE ABLE TO REACH
--   - No dealership's data, and no dealership's data may reach it. It owns
--     nothing but its own lead_event rows.
--   - No entry in channel_registry and no messaging credential: it must not be
--     able to send a WhatsApp message, an SMS or an email to anyone.
--   - No human membership or user grant. Nobody logs in as this tenant.
--   - is_unattributed_default stays false: unresolved real leads must keep going
--     to the quarantine tenant, never here.
--   - Its lead_event rows must never be promoted into `leads`. That is already
--     structural rather than a convention -- see
--     20260907124500_leadingest_10_the_promoter_never_looked_at_environment.sql
--     and the counts_as_real=false on the 'simulated' provenance kind -- and
--     nothing in this file weakens it.
--
-- CONSTRAINT NOTES (why each value is what it is, from migration 02):
--   environment='simulation'      -- the production CHECKs are all guarded by
--                                    environment <> 'production', so a
--                                    simulation row is exempt from them and is
--                                    the only place 'simulated' can live.
--   declared_provenance='simulated' + provenance_counts_as_real=false
--                                 -- composite FK into
--                                    lead_provenance_kind(kind, counts_as_real);
--                                    'simulated' is counts_as_real=false, and
--                                    the pair must match or the insert fails.
--   source_key='website_form' + required_provenance_for_source='origin_and_form_key'
--                                 -- composite FK into
--                                    lead_source_catalogue(source_key, required_provenance).
--                                    The catalogue row says website_form
--                                    requires origin_and_form_key; that is a
--                                    fact about the source, not about this
--                                    endpoint, so it is carried verbatim.
--   secret_ref=null               -- the secret_ref CHECK lists four provenance
--                                    kinds that must name a secret store.
--                                    'simulated' is not one of them.
--   origin_allowlist              -- not required here (the website CHECK fires
--                                    only for origin_and_form_key), but filled
--                                    in anyway so the row documents which sites
--                                    are expected to call it.
--   status='active'               -- inactive resolves to zero rows.
--
-- public_key is minted here rather than written down. It is an identifier, not
-- an authenticator (migration 02 says so in as many words), but a value
-- committed to git is a value everyone with repo access can guess, and the
-- column CHECK exists precisely to stop that. After applying, the owner reads
-- it back with the SELECT at the foot of this file and pastes it into Vercel as
-- NEXUS_LEAD_ENDPOINT_KEY. Nobody had to hand a value around.
--
-- CREATE TABLE / INSERT only. No ALTER TABLE (it strips dashboard write grants)
-- and no CREATE VIEW (security_invoker = on would have to be inlined).

begin;

-- The simulation tenant. Fixed id so this file is re-runnable and so the
-- endpoint below can reference it without a lookup.
insert into public.tenants (id, slug, name, status, is_unattributed_default, is_quarantine)
values (
  '00000000-51b0-4000-a000-000000000001',
  '__simulation__',
  'NEXUS SIMULATION - test harness (not a dealership)',
  'active',
  false,
  false
)
on conflict (id) do nothing;

comment on table public.tenants is
  'One dealership, plus two rows that are not dealerships and say so in their '
  'names: the unattributed quarantine tenant, and the simulation tenant that '
  'owns test traffic from the NEXUS marketing site. Neither has customers.';

-- The endpoint.
insert into public.lead_ingest_endpoint (
  tenant_id,
  source_key,
  required_provenance_for_source,
  declared_provenance,
  provenance_counts_as_real,
  environment,
  public_key,
  secret_ref,
  origin_allowlist,
  ingest_address,
  status,
  rate_limit_per_minute,
  label
)
select
  '00000000-51b0-4000-a000-000000000001',
  'website_form',
  'origin_and_form_key',
  'simulated',
  false,
  'simulation',
  -- 64 chars of [A-Za-z0-9]; satisfies ^[A-Za-z0-9_-]{24,128}$.
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  null,
  array['https://nexusforautodealers.com', 'https://www.nexusforautodealers.com']::text[],
  null,
  'active',
  60,
  'NEXUS marketing site enquiry form (SIMULATION - vendor prospects, not dealership leads)'
where not exists (
  select 1 from public.lead_ingest_endpoint
   where tenant_id = '00000000-51b0-4000-a000-000000000001'
     and source_key = 'website_form'
);

commit;

-- Read the key back and paste it into Vercel as NEXUS_LEAD_ENDPOINT_KEY.
-- Run this as a separate statement, after the transaction above has committed:
--
--   select public_key, environment, declared_provenance, status
--     from public.lead_ingest_endpoint
--    where tenant_id = '00000000-51b0-4000-a000-000000000001';
--
-- Expected: exactly one row, environment='simulation',
-- declared_provenance='simulated', status='active'.
