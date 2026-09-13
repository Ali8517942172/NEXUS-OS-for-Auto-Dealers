-- ═══════════════════════════════════════════════════════════════════════════
-- HELD. NOT APPLIED. Do not run this from a migration sweep.
-- ═══════════════════════════════════════════════════════════════════════════
-- Facebook ONLY. Instagram waits until Facebook is proven -- the owner was
-- explicit, and trap 7 in ops/n8n-meta-lead-ads/GO-LIVE.md:687-698 says why:
-- Instagram lead ads arrive on the connected Facebook Page's own `leadgen`
-- subscription. There is no second webhook to wire. Enabling the Instagram
-- endpoint today buys nothing and risks somebody later "moving" an event's
-- source_key once ad_platform is known -- which, because
-- lead_event_identity_key is UNIQUE (tenant_id, source_key, external_event_id),
-- makes Meta's redelivery of the same leadgen_id look new and hands the
-- dealership two customers for one person.
--
-- ── THE PREREQUISITE THAT IS NOT IN THIS FILE ──────────────────────────────
-- Do NOT run section 2 (the endpoint enable) until META_PAGE_ACCESS_TOKEN is
-- set AND has been shown to work, because nexus_lead_source_readiness()
-- reports CONNECTED on the mere existence of an active production endpoint
-- (GO-LIVE.md:329-333). It does not know whether the token exists. These two
-- rows were created active on 7 September, ALBA saw a green CONNECTED pill
-- over a dead source, and they were disabled again the same day
-- (GO-LIVE.md:334-341). Section 1 is safe to run today. Section 2 is not.
--
-- ── WHY THERE IS NO DDL HERE ───────────────────────────────────────────────
-- This file is INSERT + UPDATE only. It creates no view, so the
-- `security_invoker = on` rule (inline in CREATE VIEW; a following ALTER VIEW
-- returns 42501) has nothing to apply to. It runs no ALTER TABLE, so the
-- grants on public.lead_ingest_provider_identity
-- (supabase/migrations/20260907095640_leadingest_08_the_page_decides_the_dealership.sql:121-122
--  -- revoked from anon/authenticated/public, granted to service_role)
-- are untouched and need no re-assertion. Section 3 verifies them anyway,
-- because "untouched" is a claim and the verification costs one query.
--
-- Run as service_role.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- 0 · THE ONE VALUE THE OWNER MUST SUBSTITUTE
-- ───────────────────────────────────────────────────────────────────────────
-- Replace REPLACE_ME_FACEBOOK_PAGE_ID below with ALBA CARS' Facebook Page id:
-- DIGITS ONLY, 5 to 32 of them. No `fb_` prefix, no spaces, not the Page NAME.
-- It is on the Page's About tab and in Business Suite. It is PUBLIC -- it is
-- not a credential, it does not belong in .env, and pasting it into a ticket
-- is fine (GO-LIVE.md:121-127). What makes routing on it safe is that the body
-- carrying it had a verified HMAC *and* that it is registered here. Both, in
-- that order, or neither.
--
-- The guard below refuses the whole transaction if the placeholder survives,
-- so this file cannot be run half-substituted.

do $$
begin
  if 'REPLACE_ME_FACEBOOK_PAGE_ID' !~ '^[0-9]{5,32}$' then
    raise exception
      'HELD MIGRATION NOT SUBSTITUTED: replace REPLACE_ME_FACEBOOK_PAGE_ID '
      'with the Facebook Page id (digits only, 5-32). Nothing was changed.';
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 1 · REGISTER THE PAGE AGAINST THE DEALERSHIP
-- ───────────────────────────────────────────────────────────────────────────
-- Resolved by tenant slug and source_key rather than by a pasted endpoint uuid,
-- so this same statement is correct for dealership number two. The select
-- returning zero rows inserts nothing and the count check below catches it.
--
-- Every column and the constraint that refuses a wrong value:
--   endpoint_id + source_key  composite FK to lead_ingest_endpoint      23503
--   provider = 'meta'         lead_ingest_provider_identity_provider    23514
--   identity_kind             ..._kind  ('facebook_page_id')            23514
--   identity_value            ..._value_shape  '^[0-9]{5,32}$'          23514
--   provider vs source_key    ..._provider_matches_source               23514
--   (provider,kind,value)     ..._key UNIQUE -- two dealerships cannot
--                             register the same Page. If this fires, one of
--                             the two registrations is wrong and a person
--                             must say which. Do not ON CONFLICT it away.
--   status                    omitted -- defaults to 'active'
-- Definitions: 20260907095640_leadingest_08_the_page_decides_the_dealership.sql:19-64

insert into public.lead_ingest_provider_identity
  (endpoint_id, source_key, provider, identity_kind, identity_value, label)
select e.endpoint_id,
       e.source_key,
       'meta',
       'facebook_page_id',
       'REPLACE_ME_FACEBOOK_PAGE_ID',
       'ALBA CARS Facebook Page'
  from public.lead_ingest_endpoint e
  join public.tenants t on t.id = e.tenant_id
 where t.slug       = 'alba-cars'
   and e.source_key = 'meta_lead_ads_facebook'
   and e.environment = 'production';

do $$
declare n int;
begin
  select count(*) into n
    from public.lead_ingest_provider_identity
   where provider = 'meta'
     and identity_kind = 'facebook_page_id'
     and identity_value = 'REPLACE_ME_FACEBOOK_PAGE_ID';
  if n <> 1 then
    raise exception
      'Expected exactly 1 provider identity row, found %. Either the '
      'alba-cars production meta_lead_ads_facebook endpoint was not found '
      '(check tenants.slug and lead_ingest_endpoint.environment), or the '
      'Page is registered twice. Rolling back.', n;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2 · ENABLE THE FACEBOOK ENDPOINT -- TOKEN FIRST, THEN THIS
-- ───────────────────────────────────────────────────────────────────────────
-- Leave this block commented out until META_PAGE_ACCESS_TOKEN (or whatever the
-- Graph node actually reads -- GO-LIVE.md Unknown 1, :779-783) is set on the VM
-- and has been shown to fetch a leadgen node. Uncommenting it early is the
-- documented failure that looks like success.
--
-- UPDATE, not ALTER. The row exists; only status changes.
-- Instagram (ccb32d53-d07b-4e9b-9950-a6c2122ef279 /
-- alba-prod-meta-leadads-instagram) is deliberately absent from this file.

-- update public.lead_ingest_endpoint e
--    set status = 'active'
--   from public.tenants t
--  where t.id = e.tenant_id
--    and t.slug = 'alba-cars'
--    and e.source_key = 'meta_lead_ads_facebook'
--    and e.environment = 'production'
--    and e.status = 'disabled';
--
-- do $$
-- declare n int;
-- begin
--   select count(*) into n
--     from public.lead_ingest_endpoint
--    where public_key = 'alba-prod-meta-leadads-facebook'
--      and status = 'active'
--      and declared_provenance = 'hmac_sha256_x_hub';
--   if n <> 1 then
--     raise exception 'Facebook endpoint not active with hmac_sha256_x_hub '
--                     '(found %). Provenance must stay hmac_sha256_x_hub, '
--                     'rank 90. Rolling back.', n;
--   end if;
-- end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 3 · VERIFY THE GRANTS THIS FILE DID NOT CHANGE
-- ───────────────────────────────────────────────────────────────────────────
-- No ALTER TABLE ran above, so nothing should have moved. Assert it rather
-- than assume it: an unexpected grant to anon or authenticated here would mean
-- a dealership session can read every tenant's Page registration.

do $$
declare leaked text;
begin
  select string_agg(grantee || ':' || privilege_type, ', ')
    into leaked
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name   = 'lead_ingest_provider_identity'
     and grantee in ('anon', 'authenticated', 'PUBLIC');
  if leaked is not null then
    raise exception
      'lead_ingest_provider_identity carries grants it must not have: %. '
      'Expected: service_role only '
      '(20260907095640_leadingest_08...:121-122). Rolling back.', leaked;
  end if;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- AFTER RUNNING SECTION 1 ONLY, this must return ZERO ROWS:
--
--   select * from public.nexus_lead_endpoint_for_provider_identity(
--     'meta', 'facebook_page_id', 'REPLACE_ME_FACEBOOK_PAGE_ID');
--
-- Zero is the lock working: the resolver needs an active identity, an ACTIVE
-- ENDPOINT and an active dealership, and the endpoint is still disabled
-- (GO-LIVE.md:128-136). After section 2 is uncommented and run it must return
-- exactly ONE row, carrying source_key = meta_lead_ads_facebook,
-- public_key = alba-prod-meta-leadads-facebook,
-- declared_provenance = hmac_sha256_x_hub, environment = production.
--
-- Confirm the row itself landed:
--   select i.identity_value, i.identity_kind, i.provider, i.status,
--          e.public_key, e.status as endpoint_status, t.slug
--     from public.lead_ingest_provider_identity i
--     join public.lead_ingest_endpoint e on e.endpoint_id = i.endpoint_id
--     join public.tenants t on t.id = e.tenant_id;
-- ═══════════════════════════════════════════════════════════════════════════
