-- Lead ingestion, part 8: how a Meta delivery finds its dealership.
--
-- Meta's leadgen webhook does not carry a public key, and it cannot be made to.
-- The URL is registered once with Meta and is the same for everyone; the only
-- per-dealership fact in the delivery is `page_id`, inside the body that
-- `X-Hub-Signature-256` covers. So the tenant comes from a signed field of
-- Meta's own, resolved through a registered row -- the same shape as
-- `channel_registry` resolving a tenant from `metadata.phone_number_id`, and
-- for the same reason: `POST /webhook/whatsapp-inbound` takes its tenant from
-- `body.session`, which the caller supplies, and that is the defect this whole
-- layer exists to avoid.
--
-- The identity is pinned to the endpoint by composite foreign key, so a
-- Facebook Page id cannot be attached to a Google endpoint, and the endpoint
-- carries the tenant. Nothing here is a secret: a page id is public. It is an
-- identifier that has been *registered*, which is what makes it trustworthy,
-- and only after the signature has verified.

create table public.lead_ingest_provider_identity (
  identity_id     uuid primary key default gen_random_uuid(),
  endpoint_id     uuid not null,
  source_key      text not null,
  provider        text not null,
  identity_kind   text not null,
  identity_value  text not null,
  label           text not null,
  status          text not null default 'active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- One provider identity resolves to at most one endpoint. Two dealerships
  -- claiming the same Facebook Page is not a conflict to resolve at read time;
  -- it is a row that cannot exist.
  constraint lead_ingest_provider_identity_key
    unique (provider, identity_kind, identity_value),

  -- Pins the identity to the endpoint's source, so the kind of identity and the
  -- kind of source cannot disagree.
  constraint lead_ingest_provider_identity_endpoint_fk
    foreign key (endpoint_id, source_key)
    references public.lead_ingest_endpoint (endpoint_id, source_key) on delete cascade,

  constraint lead_ingest_provider_identity_provider
    check (provider in ('meta','google')),
  constraint lead_ingest_provider_identity_kind
    check (identity_kind in ('facebook_page_id','lead_form_id','google_webhook_id')),
  constraint lead_ingest_provider_identity_status
    check (status in ('active','disabled')),

  -- Meta ids are decimal strings. A value that is not one is a mis-registration
  -- -- most likely a page NAME pasted where an id belongs -- and it must fail
  -- at registration rather than resolve to nothing at three in the morning.
  constraint lead_ingest_provider_identity_value_shape
    check (identity_value ~ '^[0-9]{5,32}$'),

  -- A Meta identity belongs to a Meta source and nothing else. Written as a
  -- CHECK rather than left to convention, because "the adapter only ever calls
  -- it with the right pair" is a rule somebody has to remember.
  constraint lead_ingest_provider_identity_provider_matches_source
    check (
      (provider = 'meta'   and source_key in ('meta_lead_ads_facebook','meta_lead_ads_instagram'))
      or
      (provider = 'google' and source_key = 'google_ads_lead_form')
    )
);

comment on table public.lead_ingest_provider_identity is
  'Maps a provider-owned identifier that arrives inside a signed payload -- a '
  'Facebook Page id today -- to the endpoint, and therefore the dealership, that '
  'registered it. Resolve this ONLY after the signature has verified: before '
  'that, page_id is a string an attacker chose.';

comment on column public.lead_ingest_provider_identity.identity_value is
  'Public, not secret. A Facebook Page id is visible to anyone. What makes it '
  'safe to route on is that it was registered here AND that it arrived inside a '
  'body whose HMAC matched.';

-- Why there is no re-attribution function here, and why writing one would be a
-- bug. Meta delivers Instagram lead ads on the connected Facebook Page's
-- leadgen subscription; the webhook body has no platform field, so at
-- RECEIVED time nobody can know whether a lead came from Facebook or
-- Instagram. The obvious fix -- move the event to the Instagram endpoint once
-- the Graph hop reports the platform -- is exactly wrong, because
-- `lead_event_identity_key` is UNIQUE (tenant_id, source_key,
-- external_event_id). Change source_key and the SAME leadgen_id redelivered by
-- Meta no longer matches the stored row: it inserts again, promotes again, and
-- the dealership gets two leads for one customer. The identity key is the
-- deduplication, so attribution must never be carried in it. The finer
-- Facebook-vs-Instagram fact belongs in the hydrated payload as an additive
-- field, and `source_key` keeps meaning what is literally true: this arrived on
-- the Facebook Page's leadgen subscription.
comment on constraint lead_ingest_provider_identity_key on public.lead_ingest_provider_identity is
  'One provider identity, one endpoint. See the migration body for why an event '
  'must never be re-attributed by changing source_key.';

create index lead_ingest_provider_identity_endpoint_idx
  on public.lead_ingest_provider_identity (endpoint_id, status);

create or replace function public.lead_ingest_provider_identity_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger lead_ingest_provider_identity_touch_trg
  before update on public.lead_ingest_provider_identity
  for each row execute function public.lead_ingest_provider_identity_touch();

alter table public.lead_ingest_provider_identity enable row level security;

create policy lead_ingest_provider_identity_service on public.lead_ingest_provider_identity
  for all to service_role using (true) with check (true);

-- Explicit floor, named, covering both end-user roles. Seven sibling tables in
-- the messaging layer were closed only by the absence of a grant, which is an
-- incidental lock, and this project has written down what those are worth.
create policy lead_ingest_provider_identity_deny_end_users on public.lead_ingest_provider_identity
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on public.lead_ingest_provider_identity from anon, authenticated, public;
grant all  on public.lead_ingest_provider_identity to service_role;

-- The resolver. Returns a SET, so unresolved is zero rows and an n8n branch can
-- halt on it rather than falling through to a default. A disabled endpoint or a
-- disabled identity resolves to nothing: registered is not the same fact as
-- connected, and this is the layer where that distinction is enforced.
create or replace function public.nexus_lead_endpoint_for_provider_identity(
  p_provider      text,
  p_identity_kind text,
  p_identity_value text
)
returns table (
  endpoint_id         uuid,
  tenant_id           uuid,
  source_key          text,
  public_key          text,
  declared_provenance text,
  environment         text,
  secret_ref          text,
  rate_limit_per_minute integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select e.endpoint_id, e.tenant_id, e.source_key, e.public_key,
         e.declared_provenance, e.environment, e.secret_ref, e.rate_limit_per_minute
    from public.lead_ingest_provider_identity i
    join public.lead_ingest_endpoint e
      on e.endpoint_id = i.endpoint_id and e.source_key = i.source_key
    join public.tenants t on t.id = e.tenant_id and t.status = 'active'
   where i.provider       = lower(btrim(coalesce(p_provider, '')))
     and i.identity_kind  = lower(btrim(coalesce(p_identity_kind, '')))
     and i.identity_value = btrim(coalesce(p_identity_value, ''))
     and i.status = 'active'
     and e.status = 'active';
$$;

comment on function public.nexus_lead_endpoint_for_provider_identity(text, text, text) is
  'Resolve a signed provider identifier to the endpoint that registered it. '
  'Returns zero rows when nothing matches, when the endpoint is disabled, when '
  'the identity is disabled, or when the dealership is not active -- unresolved '
  'is never a default.';

revoke all on function public.nexus_lead_endpoint_for_provider_identity(text, text, text)
  from anon, authenticated, public;
grant execute on function public.nexus_lead_endpoint_for_provider_identity(text, text, text)
  to service_role;
