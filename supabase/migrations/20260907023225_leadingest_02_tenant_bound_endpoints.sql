-- Lead ingestion, part 2 of 4: the endpoint, which is where the dealership is
-- decided.
--
-- This is the whole point of the table. `POST /webhook/whatsapp-inbound` keys
-- its tenant off `body.session`, which the caller supplies, and n8n writes as
-- `service_role`, which is BYPASSRLS -- so one JSON field chooses whose data is
-- written and nothing in the database filters it. Every tenant control proven
-- this month sits behind that.
--
-- A lead endpoint therefore takes its tenant from a registered identity and
-- never from the payload. `public_key` appears in the URL or the form and is
-- unguessable but is NOT a secret: it identifies, it does not authenticate.
-- The secret, where a source has one, is named by `secret_ref` and lives
-- somewhere else -- the same discipline as `channel_registry.credential_ref`.

-- Two unique constraints that exist only so other tables can carry composite
-- foreign keys into them, and therefore cannot misdescribe what they point at.
alter table public.lead_provenance_kind
  add constraint lead_provenance_kind_kind_counts_as_real_key unique (kind, counts_as_real);
alter table public.lead_source_catalogue
  add constraint lead_source_catalogue_key_required_provenance_key unique (source_key, required_provenance);

create table public.lead_ingest_endpoint (
  endpoint_id                 uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete restrict,
  source_key                  text not null,
  required_provenance_for_source text not null,
  declared_provenance         text not null,
  provenance_counts_as_real   boolean not null,
  environment                 text not null,
  public_key                  text not null,
  secret_ref                  text,
  origin_allowlist            text[] not null default '{}',
  ingest_address              text,
  status                      text not null default 'active',
  rate_limit_per_minute       integer not null default 60,
  label                       text not null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  constraint lead_ingest_endpoint_public_key_key unique (public_key),
  constraint lead_ingest_endpoint_id_tenant_key  unique (endpoint_id, tenant_id),
  constraint lead_ingest_endpoint_id_env_key     unique (endpoint_id, environment),
  constraint lead_ingest_endpoint_id_source_key  unique (endpoint_id, source_key),

  constraint lead_ingest_endpoint_source_fk foreign key (source_key, required_provenance_for_source)
    references public.lead_source_catalogue (source_key, required_provenance) on delete restrict,
  constraint lead_ingest_endpoint_provenance_fk foreign key (declared_provenance, provenance_counts_as_real)
    references public.lead_provenance_kind (kind, counts_as_real) on delete restrict,

  constraint lead_ingest_endpoint_environment check (environment in ('production','simulation')),
  constraint lead_ingest_endpoint_status      check (status in ('active','disabled')),
  constraint lead_ingest_endpoint_rate_limit  check (rate_limit_per_minute between 1 and 10000),

  -- A public key is an identifier that must not be guessable, and a secret that
  -- has leaked into it is worse than no secret at all, so it is length-floored
  -- and shape-constrained rather than left as free text.
  constraint lead_ingest_endpoint_public_key_shape
    check (public_key ~ '^[A-Za-z0-9_-]{24,128}$'),

  -- A production endpoint cannot accept a provenance that nothing external
  -- attests. This is what stops the simulator writing into real numbers: not a
  -- convention, not a flag a job checks, but a row that cannot exist.
  constraint lead_ingest_endpoint_production_needs_real_provenance
    check (environment <> 'production' or provenance_counts_as_real),

  -- And a production endpoint must accept exactly the provenance its source is
  -- capable of proving. A Meta endpoint cannot quietly downgrade itself to a
  -- shared header; a Google endpoint cannot claim an HMAC it never receives.
  constraint lead_ingest_endpoint_production_matches_source
    check (environment <> 'production' or declared_provenance = required_provenance_for_source),

  -- Nothing that carries a secret may be registered without saying where that
  -- secret lives. The reference is checked, the secret is never stored here.
  constraint lead_ingest_endpoint_secret_ref_required
    check (declared_provenance not in ('hmac_sha256_x_hub','hmac_sha256_svix','shared_secret_header','shared_secret_in_body')
           or (secret_ref is not null and btrim(secret_ref) <> '')),

  -- A browser-submitted form is identified by an unguessable key and nothing
  -- else, so the Origin allowlist is the only other thing standing in front of
  -- it and may not be empty.
  constraint lead_ingest_endpoint_website_needs_origin
    check (declared_provenance <> 'origin_and_form_key' or cardinality(origin_allowlist) > 0)
);

comment on table public.lead_ingest_endpoint is
  'One registered way for leads to arrive at one dealership. The tenant comes '
  'from this row, resolved by public_key, and never from anything in the request '
  'body -- which is the defect that makes the WhatsApp webhook dangerous today. '
  'secret_ref names where a secret lives; the secret itself is never stored in '
  'this database.';

comment on column public.lead_ingest_endpoint.public_key is
  'Appears in the ingest URL or the form markup. Unguessable, but an identifier '
  'and not an authenticator -- treat every request bearing one as unauthenticated '
  'until its declared_provenance has actually been verified.';

comment on column public.lead_ingest_endpoint.ingest_address is
  'For email sources: the distinct per-dealership local-part on the ingest '
  'subdomain. Route on the envelope recipient this matches, never on the To: '
  'header -- a dealer forwarding from their own inbox leaves To: pointing at '
  'themselves, and routing on it files their leads under nobody.';

create index lead_ingest_endpoint_tenant_idx on public.lead_ingest_endpoint (tenant_id, status);
create index lead_ingest_endpoint_source_idx on public.lead_ingest_endpoint (source_key, environment);

create or replace function public.lead_ingest_endpoint_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger lead_ingest_endpoint_touch_trg before update on public.lead_ingest_endpoint
  for each row execute function public.lead_ingest_endpoint_touch();

alter table public.lead_ingest_endpoint enable row level security;

create policy lead_ingest_endpoint_service on public.lead_ingest_endpoint
  for all to service_role using (true) with check (true);

-- Explicit floor, named, covering both end-user roles. Seven sibling tables in
-- the messaging layer were closed only by the absence of a grant, which is an
-- incidental lock, and this project has written down what those are worth.
create policy lead_ingest_endpoint_deny_end_users on public.lead_ingest_endpoint
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on public.lead_ingest_endpoint from anon, authenticated, public;
grant all  on public.lead_ingest_endpoint to service_role;

-- The resolver. Returns a SET, so "unresolved" is zero rows and a caller cannot
-- mistake it for a default -- the same shape as the channel resolver, and for
-- the same reason: an n8n branch has to be able to halt on it.
create or replace function public.nexus_lead_endpoint_for_public_key(p_public_key text)
returns table (
  endpoint_id           uuid,
  tenant_id             uuid,
  source_key            text,
  declared_provenance   text,
  environment           text,
  secret_ref            text,
  origin_allowlist      text[],
  rate_limit_per_minute integer,
  delivery_shape        text,
  dedup_field           text
)
language sql
stable
security invoker
set search_path = public
as $$
  select e.endpoint_id, e.tenant_id, e.source_key, e.declared_provenance,
         e.environment, e.secret_ref, e.origin_allowlist, e.rate_limit_per_minute,
         c.delivery_shape, c.dedup_field
    from public.lead_ingest_endpoint e
    join public.lead_source_catalogue c on c.source_key = e.source_key
    join public.tenants t on t.id = e.tenant_id
   where e.public_key = p_public_key
     and e.status = 'active'
     and t.status = 'active';
$$;

comment on function public.nexus_lead_endpoint_for_public_key(text) is
  'Resolve which dealership a lead belongs to from the endpoint key in the URL. '
  'Zero rows means unresolved: no endpoint, disabled endpoint, or suspended '
  'dealership. There is deliberately no fallback -- a resolver that guesses a '
  'tenant is how one dealership''s traffic writes another''s data.';

revoke all on function public.nexus_lead_endpoint_for_public_key(text) from public, anon, authenticated;
grant execute on function public.nexus_lead_endpoint_for_public_key(text) to service_role;
revoke all on function public.lead_ingest_endpoint_touch() from public, anon, authenticated;