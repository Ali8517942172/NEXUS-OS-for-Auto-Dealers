create or replace function public.whatsapp_template_variable_schema_ok(p jsonb)
returns boolean
language sql
immutable
set search_path to 'public','pg_catalog'
as $$
  select
    p is not null
    and jsonb_typeof(p) = 'array'
    and jsonb_array_length(p) <= 32
    and not exists (
      select 1
        from jsonb_array_elements(p) with ordinality as e(v, ord)
       where jsonb_typeof(e.v) <> 'object'
          or (e.v ->> 'index') is null
          or (e.v ->> 'index') !~ '^[0-9]{1,2}$'
          or ((e.v ->> 'index')::int) <> e.ord::int
          or (e.v ->> 'name') is null
          or (e.v ->> 'name') !~ '^[a-z][a-z0-9_]{0,63}$'
          or jsonb_typeof(coalesce(e.v -> 'required', 'true'::jsonb)) <> 'boolean'
          or length(coalesce(e.v ->> 'example','')) > 200
    );
$$;

comment on function public.whatsapp_template_variable_schema_ok(jsonb) is
  'Shape gate for whatsapp_templates.variable_schema: a JSON array of {index,name,required?,example?} whose index values are 1..n in order. Meta rejects a send whose parameter count does not match the approved body; the count is derived from this array, never typed in twice.';

create table public.whatsapp_templates (
  template_id                   uuid primary key default gen_random_uuid(),
  tenant_id                     uuid not null references public.tenants(id) on delete restrict,
  integration_id                uuid references public.channel_registry(integration_id) on delete restrict,

  provider                      text not null default 'whatsapp_cloud',
  waba_ref                      text,
  name                          text not null,
  language                      text not null,
  category                      text not null,
  provider_template_id          text,

  nexus_state                   text not null default 'DRAFT',
  nexus_state_at                timestamptz not null default now(),
  nexus_state_by                text,

  provider_status               text not null default 'UNKNOWN',
  provider_status_raw           text,
  provider_status_observed_at   timestamptz,
  provider_status_source        text not null default 'NEVER_OBSERVED',
  provider_status_evidence_ref  text,
  provider_rejected_reason      text,
  previous_provider_status      text,
  previous_status_observed_at   timestamptz,

  variable_schema               jsonb not null default '[]'::jsonb,
  body_variable_count           integer generated always as (jsonb_array_length(variable_schema)) stored,

  body_text                     text,
  body_text_source              text,
  body_text_observed_at         timestamptz,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  constraint wat_provider_has_templates
    check (provider = 'whatsapp_cloud'),

  constraint wat_name_shape
    check (name = lower(btrim(name)) and name ~ '^[a-z0-9_]{1,512}$'),
  constraint wat_language_shape
    check (language ~ '^[a-z]{2,3}(_[A-Za-z]{2,4})?$'),
  constraint wat_category_vocabulary
    check (category = any (array['MARKETING','UTILITY','AUTHENTICATION'])),

  constraint wat_nexus_state_vocabulary
    check (nexus_state = any (array['DRAFT','SUBMITTED','ADOPTED','RETIRED'])),
  constraint wat_provider_status_vocabulary
    check (provider_status = any (array[
      'APPROVED','REJECTED','PENDING','PAUSED','DISABLED',
      'PENDING_DELETION','IN_APPEAL','LIMIT_EXCEEDED','UNMAPPED','UNKNOWN'])),
  constraint wat_provider_status_source_vocabulary
    check (provider_status_source = any (array[
      'NEVER_OBSERVED','GRAPH_API_FETCH','WEBHOOK_TEMPLATE_STATUS_UPDATE','OPERATOR_ENTERED'])),

  constraint wat_provider_status_needs_provenance
    check (
      (provider_status = 'UNKNOWN'
        and provider_status_source = 'NEVER_OBSERVED'
        and provider_status_observed_at is null
        and provider_status_raw is null)
      or
      (provider_status <> 'UNKNOWN'
        and provider_status_source <> 'NEVER_OBSERVED'
        and provider_status_observed_at is not null
        and nullif(btrim(coalesce(provider_status_raw,'')),'') is not null)
    ),
  constraint wat_previous_status_pairs
    check ((previous_provider_status is null) = (previous_status_observed_at is null)),
  constraint wat_rejected_reason_only_when_refused
    check (provider_rejected_reason is null
           or provider_status = any (array['REJECTED','PAUSED','DISABLED','IN_APPEAL','LIMIT_EXCEEDED'])),

  constraint wat_draft_has_no_provider_claim
    check (nexus_state <> 'DRAFT'
           or (provider_status = 'UNKNOWN' and provider_template_id is null)),

  constraint wat_variable_schema_shape
    check (public.whatsapp_template_variable_schema_ok(variable_schema)),

  constraint wat_body_text_source_vocabulary
    check (body_text_source is null or body_text_source = any (array['NEXUS_DRAFT','PROVIDER_FETCHED'])),
  constraint wat_body_text_provenance
    check ((body_text is null and body_text_source is null and body_text_observed_at is null)
        or (body_text is not null and body_text_source is not null and body_text_observed_at is not null)),
  constraint wat_approved_body_must_be_the_providers
    check (provider_status <> 'APPROVED'
           or body_text is null
           or body_text_source = 'PROVIDER_FETCHED'),
  constraint wat_body_text_is_text_not_a_blob
    check (body_text is null or (length(body_text) <= 4096 and body_text !~ '^data:')),

  constraint wat_refs_are_references_not_secrets
    check (
      (waba_ref is null or (length(waba_ref) <= 200 and waba_ref !~ '[[:space:]]'
        and waba_ref !~* '^(eyJ|sk-|sb_secret_|sbp_|service_role|bearer)'))
      and (provider_template_id is null or (length(provider_template_id) <= 200 and provider_template_id !~ '[[:space:]]'
        and provider_template_id !~* '^(eyJ|sk-|sb_secret_|sbp_|service_role|bearer)'))
      and (provider_status_evidence_ref is null or (length(provider_status_evidence_ref) <= 300
        and provider_status_evidence_ref !~* '^(eyJ|sk-|sb_secret_|sbp_|service_role|bearer)'))
    )
);

create unique index whatsapp_templates_identity_key
  on public.whatsapp_templates (tenant_id, provider, coalesce(waba_ref,''), name, language);

create unique index whatsapp_templates_provider_id_key
  on public.whatsapp_templates (tenant_id, provider, provider_template_id)
  where provider_template_id is not null;

create index whatsapp_templates_staleness_idx
  on public.whatsapp_templates (tenant_id, provider_status, provider_status_observed_at nulls first);

create index whatsapp_templates_integration_idx
  on public.whatsapp_templates (integration_id) where integration_id is not null;

create or replace function public.whatsapp_templates_touch()
returns trigger language plpgsql
set search_path to 'public','pg_catalog'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger whatsapp_templates_touch
  before update on public.whatsapp_templates
  for each row execute function public.whatsapp_templates_touch();

comment on table public.whatsapp_templates is
  'NEXUS''s registry of WhatsApp message templates. The provider''s status is authoritative; every provider_* column here is a CACHE of what Meta last said, and cannot be written without provider_status_observed_at and provider_status_source. provider_status = UNKNOWN with source NEVER_OBSERVED is the honest default and is what a row looks like until NEXUS has actually asked. Nothing in this table is evidence that Meta approved anything.';
comment on column public.whatsapp_templates.nexus_state is
  'What NEXUS did, and the only lifecycle NEXUS owns: DRAFT (typed here, never submitted), SUBMITTED (sent to the provider for review), ADOPTED (found already existing at the provider), RETIRED (NEXUS will not send it again). It is deliberately NOT the approval state.';
comment on column public.whatsapp_templates.provider_status is
  'The provider''s last reported status, normalised. UNMAPPED means the provider returned a status string this vocabulary does not know -- the verbatim value is in provider_status_raw and nothing was guessed.';
comment on column public.whatsapp_templates.provider_status_observed_at is
  'When NEXUS last heard this status from the provider. The send path measures staleness against this, not against updated_at. A NULL here means NEXUS has never asked.';
comment on column public.whatsapp_templates.previous_provider_status is
  'The status this row held before the last observation changed it. This is how a template NEXUS believed was APPROVED and the provider has since REJECTED is discoverable on the row itself rather than only in a log.';
comment on column public.whatsapp_templates.body_text is
  'A convenience copy of the template body. body_text_source says whose words these are. When provider_status is APPROVED the body may only be the provider''s own fetched text -- a NEXUS-typed draft next to an APPROVED badge is text Meta never saw.';