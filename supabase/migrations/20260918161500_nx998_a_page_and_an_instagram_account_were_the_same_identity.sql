-- NX998 — A Page and an Instagram account were the same identity.
--
-- ops/channel-truth/FIVE-CHANNEL-BLOCKERS.md (17 Sep 2026) lists five schema
-- blockers. Three lead sources are stopped by them, and no token, no Meta
-- approval and no action by Ali can move any of the three, because the
-- database refuses the row before anybody gets that far:
--
--   * Instagram DMs      -- channel_registry.channel_type, channel_message_events
--                           .provider and lead_source_catalogue all refuse them.
--                           An Instagram DM has no legal home anywhere.
--   * tracked phone      -- lead_ingest_provider_identity.provider allows only
--                           'meta' and 'google', identity_kind allows only three
--                           Meta/Google values. A tracking number cannot be
--                           mapped to a dealership at all.
--   * Instagram Lead Ads -- legal, but it cannot coexist with Facebook Lead Ads,
--                           because both arrive on the SAME Page subscription and
--                           UNIQUE (provider, identity_kind, identity_value) lets
--                           one page_id resolve to exactly one endpoint, and
--                           therefore to exactly one source_key.
--
-- This migration removes the schema half of those three. It removes nothing
-- else, and it is important to say what is left standing.
--
-- WHAT THIS DELIBERATELY IS NOT:
--
--   * It does NOT enable anything. Not one row of lead_ingest_endpoint or
--     channel_registry is inserted, updated or deleted. The two Meta Lead Ads
--     endpoints stay status='disabled' and the verify block at the bottom
--     refuses to commit if their status fingerprint has moved. Turning a
--     channel on stays a separate, deliberate UPDATE by a person who has the
--     credential in hand -- it is not a side effect of widening a CHECK.
--   * It does NOT make Instagram work. There is still no Instagram code in
--     this repository, `instagram_manage_messages` still needs Meta Business
--     Verification and App Review, and the catalogue row this migration adds
--     says integration_status='NOT_ESTABLISHED' precisely so that nothing can
--     read it as a claim.
--   * It does NOT buy a phone number. phone_call_tracked is written as
--     COMMERCIAL_CONVERSATION_REQUIRED because a UAE tracking number needs a
--     TDRA-compliant carrier, a trade licence and a recurring bill. Manual
--     phone entry (source_key='phone_call') is untouched and still works.
--   * It does NOT give telephony a seat in channel_registry or
--     channel_message_events. A call is not a message. channel_message_events
--     is welded to message semantics -- message_kind, external_message_id,
--     a signature CHECK -- and pushing calls through it would make "messages
--     received" silently count ringing telephones. A tracked number gets
--     exactly one legal home: lead_ingest_provider_identity, which is a
--     ROUTING table, plus its own catalogue row.
--   * It adds NOTHING to channel_provider_capability or channel_provider_rank.
--     Those tables describe what NEXUS can SEND. Nothing here can send an
--     Instagram DM, so nothing here appears as a send option.
--
-- THE KEY DECISION, AND WHY.
--
-- The old key was UNIQUE (provider, identity_kind, identity_value). It reads
-- as "one Page belongs to one dealership", which is a property worth keeping.
-- But it also says "one Page is one lead source", and that is simply false
-- about Meta. A page_id is the identity of a WEBHOOK SUBSCRIPTION, not of a
-- lead source. Facebook Lead Ads and Instagram Lead Ads both ride that one
-- subscription; the leadgen webhook carries page_id and form_id and no
-- platform discriminator at all. The surface is only knowable at hop 2, when
-- the Graph fetch of the lead returns `platform` ('fb' or 'ig').
--
-- So the new key is:
--
--     UNIQUE (provider, identity_kind, identity_value, source_key)
--
-- The identity of a capture surface is what the provider signed it as, TIMES
-- which surface is claiming it. source_key is already a column here, already
-- welded to the endpoint by foreign key, and already welded to the provider by
-- CHECK, so it is not new information -- it was simply missing from the key.
-- One Page may now register twice: once for meta_lead_ads_facebook and once
-- for meta_lead_ads_instagram, pointing at two endpoints. Hop 1 resolves the
-- dealership from page_id (both rows are that dealership's); hop 2 resolves
-- the SOURCE by calling the new four-argument accessor with the source_key it
-- derived from Graph's `platform` field.
--
-- Relaxing a UNIQUE cannot destroy a row -- every set of rows legal under the
-- three-column key is legal under the four-column key, because the four-column
-- key is strictly weaker. But the old key protected something real BY
-- ACCIDENT: it made it impossible for two dealerships to claim the same Page.
-- That protection is restored ON PURPOSE, as a constraint rather than as a
-- side effect:
--
--     EXCLUDE (provider WITH =, identity_kind WITH =, identity_value WITH =,
--              tenant_id WITH <>)
--
-- which requires tenant_id on the row, which arrives with a tenant-carrying
-- foreign key to (endpoint_id, tenant_id) so that an identity can never be
-- attached to one dealership's endpoint while claiming another dealership's
-- tenant. That is NX995's four-tenant-carrying-FK pattern, applied here.
-- It is a constraint and not a trigger and not caller discipline because n8n
-- and every receiver run as service_role, which carries rolbypassrls, and a
-- constraint is the only layer they cannot skip.
--
-- AND a Page is still not an Instagram account. identity_kind gains
-- 'instagram_account_id', so an Instagram Professional account -- the numeric
-- id that arrives as entry.id on an Instagram messaging webhook, what Meta
-- calls the Instagram-scoped id of the business side of the conversation --
-- is its own identity with its own value, not a second claim on a Page. A
-- further CHECK says a facebook_page_id may claim either lead-ads surface and
-- never an Instagram DM, and an instagram_account_id may claim an Instagram
-- DM or Instagram Lead Ads and never Facebook Lead Ads. The customer's own
-- IGSID is deliberately NOT given a home here: this table maps an identity to
-- a DEALERSHIP, and the customer is not the dealership.
--
-- ADDITIVE ONLY, AND PROVED. Every widened CHECK is a superset of the CHECK it
-- replaces, so no row that was legal becomes illegal. Nothing is dropped
-- except the three-column UNIQUE, whose replacement is weaker. The verify
-- block at the bottom compares a pre-flight census taken in this same
-- transaction -- row counts and content fingerprints for identities,
-- endpoints, endpoint statuses, the catalogue, channels and message events --
-- against the state at commit time, and rolls the whole thing back if any
-- pre-existing row moved.

begin;

-- ══════════════════════════════════════════════════════════════════════════
-- 0. Pre-flight census. Taken inside the transaction so that the proof at the
--    bottom is a proof about THIS migration and not about the clock.
-- ══════════════════════════════════════════════════════════════════════════

create temporary table nx998_preflight on commit drop as
select
  (select count(*) from public.lead_ingest_provider_identity)                as identities_before,
  (select count(*) from public.lead_ingest_endpoint)                         as endpoints_before,
  (select count(*) from public.lead_ingest_endpoint where status = 'active') as active_endpoints_before,
  (select count(*) from public.lead_source_catalogue)                        as catalogue_before,
  (select count(*) from public.channel_registry)                             as channels_before,
  (select count(*) from public.channel_message_events)                       as message_events_before,
  (select coalesce(md5(string_agg(identity_id::text, ',' order by identity_id)), 'empty')
     from public.lead_ingest_provider_identity)                              as identity_fingerprint_before,
  (select coalesce(md5(string_agg(endpoint_id::text || '=' || status, ',' order by endpoint_id)), 'empty')
     from public.lead_ingest_endpoint)                                       as endpoint_status_fingerprint_before,
  (select coalesce(md5(string_agg(integration_id::text || '=' || status, ',' order by integration_id)), 'empty')
     from public.channel_registry)                                           as channel_status_fingerprint_before,
  (select coalesce(md5(string_agg(source_key, ',' order by source_key)), 'empty')
     from public.lead_source_catalogue)                                      as catalogue_fingerprint_before;

do $preflight$
declare
  n int;
begin
  -- btree_gist gives gist the = and <> operators for text and uuid, which the
  -- exclusion constraint below needs. NX995 installed it into `extensions`
  -- (never public, NX931) and the opclasses are qualified explicitly so that
  -- nothing depends on search_path at DDL time.
  select count(*) into n
    from pg_extension e join pg_namespace s on s.oid = e.extnamespace
   where e.extname = 'btree_gist' and s.nspname = 'extensions';
  if n <> 1 then
    raise exception 'NX998: btree_gist is not installed in schema extensions. NX995 installs it; apply that first. Rolling back.';
  end if;

  -- An identity row whose endpoint has vanished cannot be given a tenant, and
  -- would fail the NOT NULL below with an unreadable error. Say so plainly.
  select count(*) into n
    from public.lead_ingest_provider_identity i
    left join public.lead_ingest_endpoint e
      on e.endpoint_id = i.endpoint_id and e.source_key = i.source_key
   where e.endpoint_id is null;
  if n > 0 then
    raise exception 'NX998: % provider-identity row(s) point at no endpoint, so no dealership can be derived for them. Fix the orphans first. Rolling back.', n;
  end if;
end
$preflight$;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. The catalogue learns two source keys it did not have.
--
--    lead_event.source_key is foreign-keyed to this table, so without a row
--    here an Instagram DM and a tracked call have no name to be attributed
--    to, whatever else is legal. These rows create NO capture path: no
--    endpoint exists for either, and integration_status says what is true.
-- ══════════════════════════════════════════════════════════════════════════

insert into public.lead_source_catalogue
  (source_key, display_name, channel_family, integration_status, delivery_shape,
   required_provenance, dedup_field, evidence_note, manual_entry_surface)
values
  ('instagram_dm', 'Instagram Direct Message', 'messaging', 'NOT_ESTABLISHED',
   'INBOUND_MESSAGE', 'hmac_sha256_x_hub', 'mid',
   'Arrives on the Meta messaging webhook for an Instagram Professional account linked to a Page, signed with X-Hub-Signature-256 by the same app secret that already proves WhatsApp Cloud. NOT_ESTABLISHED because no Instagram code exists in this repository and instagram_manage_messages requires Meta Business Verification plus App Review, neither of which is done. This row makes the source NAMEABLE; it does not make it connected.',
   null),
  ('phone_call_tracked', 'Phone call (tracked number)', 'offline', 'COMMERCIAL_CONVERSATION_REQUIRED',
   'WEBHOOK_FULL_PAYLOAD', 'shared_secret_header', 'call_sid',
   'A call-tracking carrier posts a completed-call webhook and the dealership is resolved from the DIALLED number via lead_ingest_provider_identity (provider=telephony, identity_kind=tracking_number). COMMERCIAL_CONVERSATION_REQUIRED because a UAE tracking number requires a TDRA-compliant provider, a trade licence and a recurring per-number and per-minute bill. Distinct from source_key=phone_call, which is a person typing into the lead drawer and stays free.',
   null)
on conflict (source_key) do nothing;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. lead_ingest_provider_identity learns which dealership it belongs to.
--
--    The table already carried endpoint_id, and the endpoint carries the
--    tenant -- but a constraint cannot follow a join. tenant_id is
--    denormalised here so the exclusion constraint in section 4 can exist,
--    and a composite foreign key makes the denormalisation unlieable.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.lead_ingest_provider_identity
  add column if not exists tenant_id uuid;

update public.lead_ingest_provider_identity i
   set tenant_id = e.tenant_id
  from public.lead_ingest_endpoint e
 where e.endpoint_id = i.endpoint_id
   and e.source_key  = i.source_key
   and i.tenant_id is distinct from e.tenant_id;

alter table public.lead_ingest_provider_identity
  alter column tenant_id set not null;

do $fks$
begin
  -- Production already carries the endpoint foreign key; staging does not.
  -- Add it where it is missing rather than assuming either state.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.lead_ingest_provider_identity'::regclass
       and conname  = 'lead_ingest_provider_identity_endpoint_fk')
  then
    alter table public.lead_ingest_provider_identity
      add constraint lead_ingest_provider_identity_endpoint_fk
      foreign key (endpoint_id, source_key)
      references public.lead_ingest_endpoint (endpoint_id, source_key)
      on delete cascade;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.lead_ingest_provider_identity'::regclass
       and conname  = 'lead_ingest_provider_identity_tenant_fk')
  then
    alter table public.lead_ingest_provider_identity
      add constraint lead_ingest_provider_identity_tenant_fk
      foreign key (endpoint_id, tenant_id)
      references public.lead_ingest_endpoint (endpoint_id, tenant_id)
      on delete cascade;
  end if;
end
$fks$;

comment on column public.lead_ingest_provider_identity.tenant_id is
  'The dealership this identity resolves to. Denormalised from the endpoint and held there by lead_ingest_provider_identity_tenant_fk, which references the endpoint''s own (endpoint_id, tenant_id) unique key -- so this column cannot name a dealership the endpoint does not belong to. It exists so that lead_ingest_provider_identity_one_dealership_per_identity can be a constraint instead of a hope.';

-- ══════════════════════════════════════════════════════════════════════════
-- 3. The legal vocabulary widens. Every CHECK below is a strict superset of
--    the one it replaces, so nothing that was legal becomes illegal.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.lead_ingest_provider_identity
  drop constraint if exists lead_ingest_provider_identity_provider;
alter table public.lead_ingest_provider_identity
  add constraint lead_ingest_provider_identity_provider
  check (provider in ('meta', 'google', 'telephony'));

alter table public.lead_ingest_provider_identity
  drop constraint if exists lead_ingest_provider_identity_kind;
alter table public.lead_ingest_provider_identity
  add constraint lead_ingest_provider_identity_kind
  check (identity_kind in ('facebook_page_id', 'lead_form_id', 'google_webhook_id',
                           'instagram_account_id', 'tracking_number'));

alter table public.lead_ingest_provider_identity
  drop constraint if exists lead_ingest_provider_identity_provider_matches_source;
alter table public.lead_ingest_provider_identity
  add constraint lead_ingest_provider_identity_provider_matches_source
  check (
       (provider = 'meta'      and source_key in ('meta_lead_ads_facebook',
                                                  'meta_lead_ads_instagram',
                                                  'instagram_dm'))
    or (provider = 'google'    and source_key = 'google_ads_lead_form')
    or (provider = 'telephony' and source_key = 'phone_call_tracked')
  );

-- A kind belongs to exactly one provider. Without this, provider='telephony'
-- with identity_kind='facebook_page_id' would pass every other CHECK.
alter table public.lead_ingest_provider_identity
  add constraint lead_ingest_provider_identity_kind_matches_provider
  check (
       (provider = 'meta'      and identity_kind in ('facebook_page_id', 'lead_form_id',
                                                     'instagram_account_id'))
    or (provider = 'google'    and identity_kind = 'google_webhook_id')
    or (provider = 'telephony' and identity_kind = 'tracking_number')
  );

-- THE SENTENCE THIS MIGRATION EXISTS FOR, written as a constraint. A Page may
-- claim either lead-ads surface -- that is the collision being fixed, and it
-- is correct, because both arrive on the Page's one leadgen subscription. A
-- Page may NEVER claim an Instagram DM: a DM arrives at an Instagram
-- Professional account, which is a different identity with a different value.
alter table public.lead_ingest_provider_identity
  add constraint lead_ingest_provider_identity_kind_matches_source
  check (
        (identity_kind <> 'facebook_page_id'
           or source_key in ('meta_lead_ads_facebook', 'meta_lead_ads_instagram'))
    and (identity_kind <> 'instagram_account_id'
           or source_key in ('meta_lead_ads_instagram', 'instagram_dm'))
    and (identity_kind <> 'tracking_number'
           or source_key = 'phone_call_tracked')
    and (identity_kind <> 'google_webhook_id'
           or source_key = 'google_ads_lead_form')
  );

-- identity_value stays digits-only under the existing
-- lead_ingest_provider_identity_value_shape CHECK, and both new kinds fit it
-- without being widened: an Instagram Professional account id is a 17-digit
-- number, and a phone number is stored as E.164 DIGITS with no leading '+',
-- which is the same shape channel_message_events already requires of
-- customer_phone. This only adds the extra thing true of a dialable number:
-- no leading zero, and long enough to carry a country code.
alter table public.lead_ingest_provider_identity
  add constraint lead_ingest_provider_identity_tracking_number_shape
  check (identity_kind <> 'tracking_number' or identity_value ~ '^[1-9][0-9]{7,19}$');

-- ══════════════════════════════════════════════════════════════════════════
-- 4. The key itself: surface-aware, and still one dealership per identity.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.lead_ingest_provider_identity
  drop constraint if exists lead_ingest_provider_identity_key;

alter table public.lead_ingest_provider_identity
  add constraint lead_ingest_provider_identity_surface_key
  unique (provider, identity_kind, identity_value, source_key);

alter table public.lead_ingest_provider_identity
  add constraint lead_ingest_provider_identity_one_dealership_per_identity
  exclude using gist (
    provider       extensions.gist_text_ops with =,
    identity_kind  extensions.gist_text_ops with =,
    identity_value extensions.gist_text_ops with =,
    tenant_id      extensions.gist_uuid_ops with <>
  );

comment on constraint lead_ingest_provider_identity_surface_key
  on public.lead_ingest_provider_identity is
  'Replaces UNIQUE (provider, identity_kind, identity_value). A page_id identifies a Meta webhook SUBSCRIPTION, not a lead source: Facebook Lead Ads and Instagram Lead Ads both arrive on the same Page leadgen subscription, and the leadgen webhook carries no platform discriminator -- the surface is only knowable at hop 2, from the Graph lead object''s `platform` field. So the surface is part of the key. Strictly weaker than what it replaces, therefore no previously legal row can be rejected by it.';

comment on constraint lead_ingest_provider_identity_one_dealership_per_identity
  on public.lead_ingest_provider_identity is
  'The three-column UNIQUE used to make it impossible for two dealerships to claim the same Page, by accident. This does it on purpose: the same (provider, identity_kind, identity_value) may appear as many times as there are surfaces, but never with two different tenant_ids. Two dealerships pointing one Page at themselves is the cross-tenant failure this table exists to prevent, and service_role bypasses RLS, so it has to be a constraint.';

-- ══════════════════════════════════════════════════════════════════════════
-- 5. Instagram DMs get a home in the messaging tables.
--
--    A DM is a message, so unlike telephony it belongs here. The signature
--    requirement mirrors channel_message_events_cloud_requires_signature: the
--    Instagram messaging webhook is signed with X-Hub-Signature-256 by the
--    same app secret, so an unsigned "Instagram DM" is not one.
-- ══════════════════════════════════════════════════════════════════════════

alter table public.channel_registry
  drop constraint if exists channel_registry_channel_type_check;
alter table public.channel_registry
  add constraint channel_registry_channel_type_check
  check (channel_type in ('whatsapp_waha_session',
                          'whatsapp_cloud_phone_number_id',
                          'instagram_account_id'));

alter table public.channel_message_events
  drop constraint if exists channel_message_events_channel_type_check;
alter table public.channel_message_events
  add constraint channel_message_events_channel_type_check
  check (channel_type in ('whatsapp_waha_session',
                          'whatsapp_cloud_phone_number_id',
                          'instagram_account_id'));

alter table public.channel_message_events
  drop constraint if exists channel_message_events_provider_check;
alter table public.channel_message_events
  add constraint channel_message_events_provider_check
  check (provider in ('waha', 'whatsapp_cloud', 'instagram_dm'));

alter table public.channel_message_events
  drop constraint if exists channel_message_events_provider_matches_channel_type;
alter table public.channel_message_events
  add constraint channel_message_events_provider_matches_channel_type
  check (
       (provider = 'waha'           and channel_type = 'whatsapp_waha_session')
    or (provider = 'whatsapp_cloud' and channel_type = 'whatsapp_cloud_phone_number_id')
    or (provider = 'instagram_dm'   and channel_type = 'instagram_account_id')
  );

alter table public.channel_message_events
  add constraint channel_message_events_instagram_requires_signature
  check (provider <> 'instagram_dm' or origin_verified = 'hmac_sha256_x_hub');

comment on constraint channel_message_events_instagram_requires_signature
  on public.channel_message_events is
  'The Instagram messaging webhook is signed with X-Hub-Signature-256 by the same Meta app secret that already proves the WhatsApp Cloud rows. An Instagram DM recorded without that signature is an assertion, not evidence, so it cannot be recorded. Same discipline as channel_message_events_cloud_requires_signature.';

-- ══════════════════════════════════════════════════════════════════════════
-- 6. A second accessor, for the caller that knows which surface it is on.
--
--    The existing three-argument accessor is NOT changed -- not its body, not
--    its grants. It answers "which dealership owns this identity", and for a
--    dual-registered Page it now answers with one row per surface, which is
--    the truth. Hop 2, which has Graph's `platform` field, asks the narrower
--    question here and gets exactly one row.
-- ══════════════════════════════════════════════════════════════════════════

create or replace function public.nexus_lead_endpoint_for_provider_identity(
  p_provider text,
  p_identity_kind text,
  p_identity_value text,
  p_source_key text
)
returns table (
  endpoint_id uuid,
  tenant_id uuid,
  source_key text,
  public_key text,
  declared_provenance text,
  environment text,
  secret_ref text,
  rate_limit_per_minute integer
)
language sql
stable
set search_path to 'public'
as $fn$
  select e.endpoint_id, e.tenant_id, e.source_key, e.public_key,
         e.declared_provenance, e.environment, e.secret_ref, e.rate_limit_per_minute
    from public.lead_ingest_provider_identity i
    join public.lead_ingest_endpoint e
      on e.endpoint_id = i.endpoint_id and e.source_key = i.source_key
    join public.tenants t on t.id = e.tenant_id and t.status = 'active'
   where i.provider       = lower(btrim(coalesce(p_provider, '')))
     and i.identity_kind  = lower(btrim(coalesce(p_identity_kind, '')))
     and i.identity_value = btrim(coalesce(p_identity_value, ''))
     and i.source_key     = lower(btrim(coalesce(p_source_key, '')))
     and i.status = 'active'
     and e.status = 'active';
$fn$;

revoke all on function public.nexus_lead_endpoint_for_provider_identity(text, text, text, text) from public;
revoke all on function public.nexus_lead_endpoint_for_provider_identity(text, text, text, text) from anon;
revoke all on function public.nexus_lead_endpoint_for_provider_identity(text, text, text, text) from authenticated;
grant execute on function public.nexus_lead_endpoint_for_provider_identity(text, text, text, text) to service_role;

comment on function public.nexus_lead_endpoint_for_provider_identity(text, text, text, text) is
  'Surface-aware sibling of the three-argument accessor. Both still return NOTHING when the endpoint is status=''disabled'', when the identity is status=''disabled'', when the tenant is not active, and when the identity was never registered -- a refusal is an empty result set, and this migration does not soften it.';

-- ══════════════════════════════════════════════════════════════════════════
-- 7. Proof, against the census taken at the top of this same transaction.
-- ══════════════════════════════════════════════════════════════════════════

do $verify$
declare
  p  nx998_preflight%rowtype;
  n  int;
  s  text;
begin
  select * into p from nx998_preflight;

  -- ---- additive only: nothing pre-existing moved -------------------------
  select count(*) into n from public.lead_ingest_provider_identity;
  if n <> p.identities_before then
    raise exception 'NX998: provider identities went from % to %. This migration registers nothing. Rolling back.', p.identities_before, n;
  end if;

  select coalesce(md5(string_agg(identity_id::text, ',' order by identity_id)), 'empty')
    into s from public.lead_ingest_provider_identity;
  if s <> p.identity_fingerprint_before then
    raise exception 'NX998: the set of provider-identity rows changed. Rolling back.';
  end if;

  select count(*) into n from public.lead_ingest_endpoint;
  if n <> p.endpoints_before then
    raise exception 'NX998: endpoints went from % to %. This migration creates no endpoint. Rolling back.', p.endpoints_before, n;
  end if;

  select count(*) into n from public.channel_registry;
  if n <> p.channels_before then
    raise exception 'NX998: channel_registry went from % to % rows. This migration registers no channel. Rolling back.', p.channels_before, n;
  end if;

  select count(*) into n from public.channel_message_events;
  if n <> p.message_events_before then
    raise exception 'NX998: channel_message_events went from % to % rows. This migration records no message. Rolling back.', p.message_events_before, n;
  end if;

  -- ---- NOTHING WAS ENABLED ----------------------------------------------
  -- Endpoint and channel status are compared as a per-row fingerprint, not a
  -- count, so flipping one endpoint from 'disabled' to 'active' while
  -- flipping another the other way would still be caught.
  select coalesce(md5(string_agg(endpoint_id::text || '=' || status, ',' order by endpoint_id)), 'empty')
    into s from public.lead_ingest_endpoint;
  if s <> p.endpoint_status_fingerprint_before then
    raise exception 'NX998: an endpoint status changed. Enabling a channel is a deliberate act by a person with the credential, never a side effect of a migration. Rolling back.';
  end if;

  select count(*) into n from public.lead_ingest_endpoint where status = 'active';
  if n <> p.active_endpoints_before then
    raise exception 'NX998: active endpoints went from % to %. Rolling back.', p.active_endpoints_before, n;
  end if;

  select coalesce(md5(string_agg(integration_id::text || '=' || status, ',' order by integration_id)), 'empty')
    into s from public.channel_registry;
  if s <> p.channel_status_fingerprint_before then
    raise exception 'NX998: a channel_registry status changed. Rolling back.';
  end if;

  -- ---- the catalogue grew by exactly two, and lost nothing ---------------
  select count(*) into n from public.lead_source_catalogue;
  if n <> p.catalogue_before + 2 then
    raise exception 'NX998: catalogue went from % to % rows; expected exactly two new source keys. Rolling back.', p.catalogue_before, n;
  end if;

  select count(*) into n
    from public.lead_source_catalogue
   where source_key in ('instagram_dm', 'phone_call_tracked');
  if n <> 2 then
    raise exception 'NX998: instagram_dm and phone_call_tracked are not both in the catalogue. Rolling back.';
  end if;

  -- Neither new source may claim to be connected, and neither may have
  -- acquired an endpoint on the way in.
  select integration_status into s from public.lead_source_catalogue where source_key = 'instagram_dm';
  if s <> 'NOT_ESTABLISHED' then
    raise exception 'NX998: instagram_dm claims integration_status=%. There is no Instagram code and no App Review. Rolling back.', s;
  end if;
  select integration_status into s from public.lead_source_catalogue where source_key = 'phone_call_tracked';
  if s <> 'COMMERCIAL_CONVERSATION_REQUIRED' then
    raise exception 'NX998: phone_call_tracked claims integration_status=%. There is no telephony contract. Rolling back.', s;
  end if;

  select count(*) into n from public.lead_ingest_endpoint
   where source_key in ('instagram_dm', 'phone_call_tracked');
  if n <> 0 then
    raise exception 'NX998: % endpoint(s) exist for the two new sources. Naming a source is not opening a door. Rolling back.', n;
  end if;

  -- ---- the new vocabulary is actually legal ------------------------------
  select count(*) into n
    from pg_constraint
   where conrelid = 'public.lead_ingest_provider_identity'::regclass
     and conname in ('lead_ingest_provider_identity_surface_key',
                     'lead_ingest_provider_identity_one_dealership_per_identity',
                     'lead_ingest_provider_identity_tenant_fk',
                     'lead_ingest_provider_identity_endpoint_fk',
                     'lead_ingest_provider_identity_kind_matches_provider',
                     'lead_ingest_provider_identity_kind_matches_source',
                     'lead_ingest_provider_identity_tracking_number_shape');
  if n <> 7 then
    raise exception 'NX998: expected 7 new/repaired constraints on lead_ingest_provider_identity, found %. Rolling back.', n;
  end if;

  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.lead_ingest_provider_identity'::regclass
       and conname = 'lead_ingest_provider_identity_key')
  then
    raise exception 'NX998: the three-column UNIQUE is still present, so Facebook and Instagram Lead Ads still collide. Rolling back.';
  end if;

  select pg_get_constraintdef(oid) into s
    from pg_constraint
   where conrelid = 'public.lead_ingest_provider_identity'::regclass
     and conname = 'lead_ingest_provider_identity_kind';
  if s not like '%instagram_account_id%' or s not like '%tracking_number%' then
    raise exception 'NX998: identity_kind does not admit instagram_account_id and tracking_number. Rolling back.';
  end if;

  select pg_get_constraintdef(oid) into s
    from pg_constraint
   where conrelid = 'public.lead_ingest_provider_identity'::regclass
     and conname = 'lead_ingest_provider_identity_provider';
  if s not like '%telephony%' then
    raise exception 'NX998: provider does not admit telephony. Rolling back.';
  end if;

  select pg_get_constraintdef(oid) into s
    from pg_constraint
   where conrelid = 'public.channel_registry'::regclass
     and conname = 'channel_registry_channel_type_check';
  if s not like '%instagram_account_id%' then
    raise exception 'NX998: channel_registry still refuses an Instagram account. Rolling back.';
  end if;

  -- ---- the refusal path is unchanged -------------------------------------
  -- The three-argument accessor is the one every receiver calls today. Its
  -- body must still filter on both statuses, or "disabled" would stop meaning
  -- refused.
  -- Alias `pr`, not `p`: `p` is the preflight rowtype variable above, and a
  -- plpgsql variable shadows a table alias of the same name.
  select pr.prosrc into s from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
   where ns.nspname = 'public' and pr.proname = 'nexus_lead_endpoint_for_provider_identity'
     and pg_get_function_identity_arguments(pr.oid) = 'p_provider text, p_identity_kind text, p_identity_value text';
  if s is null or s not like '%e.status = ''active''%' or s not like '%i.status = ''active''%' then
    raise exception 'NX998: the three-argument accessor no longer refuses disabled endpoints or disabled identities. Rolling back.';
  end if;

  if has_function_privilege('anon', 'public.nexus_lead_endpoint_for_provider_identity(text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_lead_endpoint_for_provider_identity(text,text,text,text)', 'execute')
  then
    raise exception 'NX998: a browser role can resolve a dealership from a provider identity. Rolling back.';
  end if;

  raise notice 'NX998: Instagram DMs and tracked phone numbers are legal values; a Page may register for both Meta lead-ads surfaces and for neither Instagram DM; one identity still resolves to one dealership. % identities, % endpoints (% active), % channels and % message events are exactly as they were. Nothing was enabled -- see ops/channel-truth/SCHEMA-FIXED.md for what is still blocked by Meta and by telephony.',
    p.identities_before, p.endpoints_before, p.active_endpoints_before, p.channels_before, p.message_events_before;
end
$verify$;

commit;
