-- channel_registry: the trusted binding from an integration identity to a dealership.
--
-- WHY THIS EXISTS
-- Tenant resolution for inbound WhatsApp is currently done in an n8n Code node
-- against NEXUS_TENANT_MAP, a JSON environment variable on the VM. Onboarding a
-- second dealership therefore means editing an env var and restarting n8n: a
-- production restart per customer, and a mapping nothing in the database can see,
-- audit or scope. This table moves that mapping into the database.
--
-- WHAT IT IS NOT
-- It is not a credential store. See the comment on credential_ref.

create table if not exists public.channel_registry (
  integration_id       uuid        primary key default gen_random_uuid(),

  -- No column default, deliberately. Every other tenant-scoped table defaults
  -- tenant_id to nexus_default_tenant_id(); on THIS table that would mean an
  -- operator who forgot the tenant silently binds an inbound channel to
  -- whichever dealership holds tenants.is_unattributed_default. The whole point
  -- of the table is that the binding is explicit, so the caller must say it.
  tenant_id            uuid        not null
                                   references public.tenants(id) on delete restrict,

  channel_type         text        not null,
  external_identifier  text        not null,
  credential_ref       text,
  status               text        not null default 'active',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Vocabulary. Adding a channel type is a migration, on purpose: a typo'd
  -- channel_type would land in a namespace nothing resolves against and the
  -- channel would go dark, which is safe but silent.
  constraint channel_registry_channel_type_check
    check (channel_type in ('whatsapp_waha_session',
                            'whatsapp_cloud_phone_number_id')),

  -- 'suspended' is the whole reason status exists: a dealership can be taken
  -- off the air without deleting the row, which would free the identifier for
  -- rebinding. Only 'active' resolves; see nexus_resolve_channel_tenant().
  constraint channel_registry_status_check
    check (status in ('active', 'suspended', 'pending', 'revoked')),

  -- Stored normalised so that 'Default', ' default' and 'default' cannot be
  -- three rows pointing at three dealerships. The unique index below is only
  -- as strong as this constraint.
  constraint channel_registry_identifier_normalised
    check (external_identifier = lower(btrim(external_identifier))
           and length(external_identifier) between 1 and 200),
  constraint channel_registry_channel_type_normalised
    check (channel_type = lower(btrim(channel_type))),

  -- A tripwire, not a proof. It cannot recognise every secret, but it refuses
  -- the four shapes that would actually turn up here by accident: a Supabase
  -- service key, a Supabase publishable/secret key, an OpenAI-style key, a raw
  -- JWT, and anything with whitespace in it (i.e. a header value, not a name).
  constraint channel_registry_credential_ref_is_not_a_secret
    check (credential_ref is null
           or (length(credential_ref) <= 200
               and credential_ref !~ '[[:space:]]'
               and credential_ref !~* '^(eyJ|sk-|sb_secret_|sbp_|service_role|bearer)'))
);

-- REQUIREMENT 1: one identifier cannot resolve to two dealerships.
--
-- Scoped per channel_type, NOT global. An identifier only means anything inside
-- its namespace: 'default' is a WAHA session label, a WhatsApp Cloud
-- phone_number_id is a numeric string, and a future SMS channel would key on
-- E.164. A global unique constraint would manufacture collisions between
-- namespaces that can never be confused at lookup time — the resolver always
-- supplies BOTH the type and the identifier, so the pair is the only key any
-- caller can present. Constraining the pair makes ambiguity unrepresentable;
-- constraining the bare identifier would additionally forbid legitimate rows
-- while preventing nothing.
--
-- Note the constraint covers suspended and revoked rows too. That is
-- deliberate: a suspended channel keeps its claim on the identifier, so
-- suspending dealership A cannot be followed by binding A's number to B.
create unique index if not exists channel_registry_type_identifier_key
  on public.channel_registry (channel_type, external_identifier);

create index if not exists channel_registry_tenant_idx
  on public.channel_registry (tenant_id);

comment on table public.channel_registry is
  'Trusted binding from an integration identity (WhatsApp business number / WAHA '
  'session) to a dealership. Replaces the caller-supplied body.session lookup and '
  'the NEXUS_TENANT_MAP environment variable. Read by n8n as service_role through '
  'nexus_resolve_channel_tenant(); never written by the dashboard.';

comment on column public.channel_registry.integration_id is
  'Surrogate key. Safe to quote in logs and audit rows; carries no secret.';

comment on column public.channel_registry.tenant_id is
  'The dealership this channel belongs to. NOT NULL and with NO column default, '
  'so an omitted tenant is an error rather than a silent fallback to '
  'tenants.is_unattributed_default.';

comment on column public.channel_registry.channel_type is
  'Namespace of external_identifier. Part of the uniqueness key, because an '
  'identifier is only meaningful inside its namespace.';

comment on column public.channel_registry.external_identifier is
  'THE TRUSTED FACT. The WAHA session name or WhatsApp business number the '
  'inbound message actually arrived on. Stored lower/trimmed. UNIQUE per '
  'channel_type, so it can never resolve to two dealerships.';

comment on column public.channel_registry.credential_ref is
  'A REFERENCE, NOT A CREDENTIAL. No secret value goes in this column, ever. '
  'Store a pointer that is useless on its own: an environment variable NAME '
  '(env:WAHA_API_KEY), an n8n credential id, or a secret-manager path. Anyone '
  'who can read this column must still not be able to authenticate as the '
  'channel. A CHECK constraint refuses the common secret shapes, but it is a '
  'tripwire and not a guarantee — the rule is enforced by whoever writes here.';

comment on column public.channel_registry.status is
  'Only ''active'' resolves. ''suspended'' takes a dealership off the air '
  'without deleting the row (deleting it would release the identifier for '
  'rebinding). ''pending'' is registered-but-not-yet-cut-over; ''revoked'' is '
  'permanently retired and still holds its claim on the identifier.';

-- updated_at maintenance, same shape as inventory_actions_touch().
create or replace function public.channel_registry_touch()
returns trigger
language plpgsql
set search_path to 'public'
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists channel_registry_touch on public.channel_registry;
create trigger channel_registry_touch
  before update on public.channel_registry
  for each row execute function public.channel_registry_touch();
