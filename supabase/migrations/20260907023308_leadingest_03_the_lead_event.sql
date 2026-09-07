-- Lead ingestion, part 3 of 4: the normalised Lead Event.
--
-- Its shape is decided by a fact that only came out of reading the providers'
-- own contracts: **Meta's Lead Ads webhook carries no customer data at all.**
-- The body holds leadgen_id, page_id, form_id, ad_id, adgroup_id and
-- created_time, and the name, phone and answers must be fetched afterwards from
-- GET /v25.0/<leadgen_id>. Resend's inbound email webhook is the same shape --
-- metadata now, body on a second call. Google Ads is the odd one out and sends
-- everything in one hop.
--
-- A one-shot "here is a lead" row therefore does not fit two of the four real
-- sources, and a design that assumed it would have needed a second table
-- bolted on within a week. So this is an event with phases: what arrived, what
-- was fetched, and what was promoted -- with the dedup key known from the
-- first moment, which is the only moment at which a duplicate can be refused
-- cheaply.

create table public.lead_event (
  event_id                   uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null references public.tenants(id) on delete restrict,
  endpoint_id                uuid not null,
  source_key                 text not null,
  environment                text not null,
  origin_verified            text not null,
  provenance_counts_as_real  boolean not null,

  external_event_id          text not null,
  occurred_at                timestamptz,
  received_at                timestamptz not null default now(),

  phase                      text not null default 'RECEIVED',
  disposition_reason         text,

  payload_raw                jsonb not null,
  hydrated_payload           jsonb,
  hydrated_at                timestamptz,
  hydration_error            text,
  normalized                 jsonb,

  lead_id                    integer references public.leads(id) on delete set null,
  promoted_at                timestamptz,

  constraint lead_event_endpoint_tenant_fk foreign key (endpoint_id, tenant_id)
    references public.lead_ingest_endpoint (endpoint_id, tenant_id) on delete restrict,
  constraint lead_event_endpoint_env_fk foreign key (endpoint_id, environment)
    references public.lead_ingest_endpoint (endpoint_id, environment) on delete restrict,
  constraint lead_event_endpoint_source_fk foreign key (endpoint_id, source_key)
    references public.lead_ingest_endpoint (endpoint_id, source_key) on delete restrict,
  constraint lead_event_provenance_fk foreign key (origin_verified, provenance_counts_as_real)
    references public.lead_provenance_kind (kind, counts_as_real) on delete restrict,

  -- The dedup key. Scoped by dealership and by source, because provider ids are
  -- only unique within a provider and two dealerships can hold the same one.
  constraint lead_event_identity_key unique (tenant_id, source_key, external_event_id),

  constraint lead_event_environment check (environment in ('production','simulation')),
  constraint lead_event_phase check (phase in
    ('RECEIVED','HYDRATED','PROMOTED','DUPLICATE','REJECTED','QUARANTINED','EXPIRED')),

  -- Same floor as the endpoint: a production event cannot rest on a provenance
  -- that nothing external attests. The simulator cannot reach production
  -- numbers because the row it would need cannot be written.
  constraint lead_event_production_needs_real_provenance
    check (environment <> 'production' or provenance_counts_as_real),

  -- An event that went nowhere must say why, and one that succeeded must not
  -- carry a reason that contradicts it.
  constraint lead_event_terminal_needs_reason
    check (phase not in ('DUPLICATE','REJECTED','QUARANTINED','EXPIRED')
           or (disposition_reason is not null and btrim(disposition_reason) <> '')),

  -- A lead id and the PROMOTED phase imply each other in both directions, so
  -- neither "promoted with nothing to show for it" nor "a lead nobody recorded
  -- promoting" is representable.
  constraint lead_event_promotion_is_symmetric
    check ((phase = 'PROMOTED') = (lead_id is not null)),
  constraint lead_event_promoted_at_with_lead
    check ((lead_id is null) = (promoted_at is null)),

  -- Hydration is only meaningful for the sources that need it, and a hydrated
  -- payload without a time is an unknown rendered as a fact.
  constraint lead_event_hydration_timestamped
    check ((hydrated_payload is null) = (hydrated_at is null)),

  -- The identity must be the provider's, and must not be minted per attempt.
  -- `nokey:`, `exec-`, `run-`, `job-` and `outreach:` are the exact prefixes the
  -- WhatsApp path minted from the clock, which is how one message extended the
  -- customer service window twice.
  constraint lead_event_external_id_is_not_per_attempt
    check (
      btrim(external_event_id) <> ''
      and length(external_event_id) between 3 and 512
      and external_event_id !~ '^(nokey:|outreach:|exec-|run-|job-|attempt-|tmp-)'
      -- Exactly thirteen digits is a millisecond clock reading, not an
      -- identifier. No provider in lead_source_catalogue mints one: Meta's
      -- leadgen_id and Google's lead_id both run longer. If one ever does, this
      -- constraint is named and must be dropped on purpose rather than
      -- discovered by a silent duplicate.
      and external_event_id !~ '^[0-9]{13}$'
    )
);

comment on table public.lead_event is
  'Every lead that arrived, in the shape it arrived in, whatever became of it. '
  'Append-mostly: rows advance through phases and are never deleted, because a '
  'rejected or duplicate lead is the evidence that the endpoint is working. '
  'payload_raw is stored verbatim -- for Meta it is the six-field metadata '
  'envelope and nothing else, which is what Meta actually sends.';

comment on column public.lead_event.phase is
  'RECEIVED: accepted at the door, dedup key known, customer data not '
  'necessarily present. HYDRATED: the second fetch succeeded (Meta, inbound '
  'email). PROMOTED: a leads row exists. DUPLICATE / REJECTED / QUARANTINED / '
  'EXPIRED: terminal, each with a stated reason. EXPIRED is Meta''s retention '
  'window closing before we fetched -- the lead is real and unrecoverable, and '
  'that is a different fact from never having had one.';

comment on column public.lead_event.environment is
  'production or simulation. Pinned to the endpoint by composite foreign key, so '
  'an event cannot claim to be production traffic on a simulation endpoint. '
  'Every count a dealership is shown must filter on this.';

create index lead_event_tenant_received_idx on public.lead_event (tenant_id, received_at desc);
create index lead_event_phase_idx           on public.lead_event (tenant_id, phase, received_at desc);
create index lead_event_source_idx          on public.lead_event (tenant_id, source_key, received_at desc);
create index lead_event_lead_idx            on public.lead_event (lead_id) where lead_id is not null;
create index lead_event_awaiting_hydration_idx
  on public.lead_event (received_at) where phase = 'RECEIVED';

-- `leads` has no unique (id, tenant_id), so the composite foreign key that
-- would make a cross-tenant promotion unrepresentable cannot be written --
-- and adding that unique constraint means ALTER TABLE on `leads`, which fires
-- nexus_guard_born_open_grants() and strips the two live dashboard write paths
-- off it. That has already happened once this week. A trigger enforces the same
-- rule without touching the table: service_role bypasses RLS, it does not
-- bypass a trigger.
create or replace function public.lead_event_guard_lead_tenant() returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare v_lead_tenant uuid;
begin
  if new.lead_id is null then
    return new;
  end if;
  select l.tenant_id into v_lead_tenant from public.leads l where l.id = new.lead_id;
  if v_lead_tenant is null then
    raise exception using
      errcode = 'NX001',
      message = 'Lead event cites lead ' || new.lead_id || ', which does not exist.',
      detail  = 'LEAD_EVENT_PROMOTED_TO_MISSING_LEAD',
      hint    = 'Promote through nexus_promote_lead_event, which creates the lead and links it in one transaction.';
  end if;
  if v_lead_tenant <> new.tenant_id then
    raise exception using
      errcode = 'NX001',
      message = 'Lead event belongs to one dealership and cites a lead belonging to another.',
      detail  = 'LEAD_EVENT_CROSS_TENANT_PROMOTION',
      hint    = 'This is the shape that puts one dealership''s customer in another''s pipeline. The endpoint decides the tenant; nothing in the payload may.';
  end if;
  return new;
end $$;

create trigger lead_event_guard_lead_tenant_trg
  before insert or update of lead_id, tenant_id on public.lead_event
  for each row execute function public.lead_event_guard_lead_tenant();

alter table public.lead_event enable row level security;

create policy lead_event_service on public.lead_event
  for all to service_role using (true) with check (true);

create policy lead_event_deny_end_users on public.lead_event
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on public.lead_event from anon, authenticated, public;
grant all  on public.lead_event to service_role;
revoke all on function public.lead_event_guard_lead_tenant() from public, anon, authenticated;