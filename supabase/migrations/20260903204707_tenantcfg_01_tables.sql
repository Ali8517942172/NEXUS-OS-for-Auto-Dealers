-- tenantcfg_01_tables
-- Per-dealership configuration for one shared workflow set. See
-- supabase/tenant-config/tenantcfg_01_tables.sql for the full rationale.

create or replace function public.nexus_is_business_hours(p jsonb)
returns boolean language sql immutable as $fn$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and p ?& array['mon','tue','wed','thu','fri','sat','sun']
    and (select count(*) from jsonb_object_keys(p)) = 7
    and coalesce((
      select bool_and(
        jsonb_typeof(e.value) = 'array'
        and coalesce((
          select bool_and(
            jsonb_typeof(iv) = 'array'
            and jsonb_array_length(iv) = 2
            and (iv ->> 0) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            and (iv ->> 1) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            and (iv ->> 1) > (iv ->> 0))
          from jsonb_array_elements(e.value) iv), true)
      )
      from jsonb_each(p) e), true)
  );
$fn$;

comment on function public.nexus_is_business_hours(jsonb) is
  'Shape rule for tenant_configuration.business_hours: an object with exactly the seven keys mon..sun, each an array of [open,close] HH:MM pairs in 24h form with close later than open. An empty array is a closed day, which is a STATED closure - different from the whole column being NULL, which is "this dealership has not told us when it is open". LIMITATION: PostgreSQL does not re-validate stored rows when this function is replaced.';

create or replace function public.nexus_is_followup_policy(p jsonb)
returns boolean language sql immutable as $fn$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and p ? 'steps'
    and jsonb_typeof(p -> 'steps') = 'array'
    and jsonb_array_length(p -> 'steps') between 1 and 12
    and coalesce((
      select bool_and(
        jsonb_typeof(s) = 'object'
        and s ? 'after_hours'
        and jsonb_typeof(s -> 'after_hours') = 'number'
        and (s -> 'after_hours') > '0'::jsonb
        and s ? 'channel'
        and (s ->> 'channel') in ('whatsapp','email','sms'))
      from jsonb_array_elements(p -> 'steps') s), false)
  );
$fn$;

comment on function public.nexus_is_followup_policy(jsonb) is
  'Shape rule for tenant_configuration.followup_policy: {"steps":[{"after_hours":N,"channel":"whatsapp|email|sms"}, ...]} with 1..12 steps and a positive delay on each. A policy with zero steps is not expressible on purpose - "send nothing" is the state of having NO policy at all, which is what an unconfigured dealership already gets.';

create or replace function public.nexus_is_approval_rules(p jsonb)
returns boolean language sql immutable as $fn$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and p ? 'default'
    and jsonb_typeof(p -> 'default') = 'object'
    and (p -> 'default' ->> 'requires_human') in ('true','false')
    and coalesce((
      select bool_and(
        jsonb_typeof(e.value) = 'object'
        and (e.value ->> 'requires_human') in ('true','false')
        and (not (e.value ? 'approver_roles')
             or jsonb_typeof(e.value -> 'approver_roles') = 'array'))
      from jsonb_each(p) e), true)
  );
$fn$;

comment on function public.nexus_is_approval_rules(jsonb) is
  'Shape rule for tenant_configuration.approval_rules. A "default" key is MANDATORY: every action kind not named explicitly falls through to it, so an action kind nobody thought about can never be silently unattended. Absence of a rule must never read as permission.';

create table if not exists public.tenant_configuration_default (
  setting_key             text primary key,
  applies_to              text not null,
  value_kind              text not null check (value_kind in ('TEXT','INTEGER','JSON')),
  default_state           text not null check (default_state in ('PRODUCT_DEFAULT','NO_DEFAULT')),
  default_value           jsonb,
  who_decides             text not null check (who_decides in ('DEALERSHIP','OPERATOR')),
  provenance_required     boolean not null,
  rationale               text not null,
  engine_rule_when_absent text not null,
  created_at              timestamptz not null default now(),
  constraint tcd_value_matches_state check (
    (default_state = 'PRODUCT_DEFAULT' and default_value is not null)
    or (default_state = 'NO_DEFAULT'    and default_value is null)
  )
);

comment on table public.tenant_configuration_default is
  'The ONE copy of every product default, and of the engine instruction for what to do when a dealership has not decided. Two default_states, and the difference is the whole point: PRODUCT_DEFAULT means NEXUS has an honest shipped answer that MUST be labelled as the product''s, not the dealership''s, wherever it is shown; NO_DEFAULT means there is no honest answer and the engine must refuse to assert one. Shipped vocabulary - byte-identical at every dealership, no row names a business.';
comment on column public.tenant_configuration_default.applies_to is
  'The table the setting actually lives in. Not every governed setting lives in tenant_configuration: first_response_sla_minutes lives in lead_recovery_settings and is resolved from there, so this table adds a default and a state without adding a second copy of the figure.';
comment on column public.tenant_configuration_default.engine_rule_when_absent is
  'What a workflow or a screen MUST do when the dealership has not set this. It is the contract, and it is prose because the consumers are n8n Function nodes and JS screens, not SQL.';
comment on column public.tenant_configuration_default.who_decides is
  'DEALERSHIP = theirs to choose (tone, hours, language). OPERATOR = a commercial or safety term the dealership must not self-serve (approval rules, capabilities). This column is the argument behind the write policy in tenantcfg_03, kept next to the setting rather than in a commit message.';

create table if not exists public.tenant_capability_catalogue (
  capability_key  text primary key,
  label           text not null,
  what_it_unlocks text not null,
  requires        text not null,
  absent_means    text not null,
  sort            int  not null default 100,
  created_at      timestamptz not null default now()
);

comment on table public.tenant_capability_catalogue is
  'Every capability a dealership may or may not have, what each unlocks, what it requires, and - the load-bearing column - what the product must say when it is absent. Shipped vocabulary, tenant-neutral: no row here says anything about a business. Whether a given dealership HAS one is public.tenant_capability, and the absence of a row there is the answer NOT_AVAILABLE.';
comment on column public.tenant_capability_catalogue.absent_means is
  'The exact posture when this capability is not available: what the screen shows and what the workflow must not do. Never "show zero" - a missing row is not proof the event did not happen.';

create table if not exists public.tenant_configuration (
  tenant_id        uuid primary key references public.tenants(id) on delete cascade,

  brand_name       text,
  default_language text,
  timezone         text,
  currency         text,

  business_hours              jsonb,
  business_hours_source       text,
  business_hours_set_by       text,
  business_hours_verified_at  timestamptz,
  business_hours_basis        text,

  ai_tone                     text,
  ai_tone_source              text,
  ai_tone_set_by              text,
  ai_tone_verified_at         timestamptz,
  ai_tone_basis               text,

  followup_policy             jsonb,
  followup_policy_source      text,
  followup_policy_set_by      text,
  followup_policy_verified_at timestamptz,
  followup_policy_basis       text,

  approval_rules              jsonb,
  approval_rules_source       text,
  approval_rules_set_by       text,
  approval_rules_verified_at  timestamptz,
  approval_rules_basis        text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tcfg_brand_name_not_blank check (brand_name is null or btrim(brand_name) <> ''),
  constraint tcfg_language_shape       check (default_language is null or default_language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  constraint tcfg_timezone_shape       check (timezone is null or timezone ~ '^[A-Za-z][A-Za-z0-9+_-]*(/[A-Za-z0-9+_-]+){0,2}$'),
  constraint tcfg_currency_shape       check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint tcfg_ai_tone_not_blank    check (ai_tone is null or btrim(ai_tone) <> ''),

  constraint tcfg_business_hours_shape   check (public.nexus_is_business_hours(business_hours)),
  constraint tcfg_followup_policy_shape  check (public.nexus_is_followup_policy(followup_policy)),
  constraint tcfg_approval_rules_shape   check (public.nexus_is_approval_rules(approval_rules)),

  constraint tcfg_business_hours_full_provenance check (
    business_hours is null or (
      nullif(btrim(business_hours_source), '') is not null
      and nullif(btrim(business_hours_set_by), '') is not null
      and business_hours_verified_at is not null
      and business_hours_basis in ('DEALERSHIP_SUPPLIED','OPERATOR_SUPPLIED','PLACEHOLDER'))),
  constraint tcfg_business_hours_provenance_needs_value check (
    business_hours is not null or (business_hours_source is null and business_hours_set_by is null
      and business_hours_verified_at is null and business_hours_basis is null)),

  constraint tcfg_ai_tone_full_provenance check (
    ai_tone is null or (
      nullif(btrim(ai_tone_source), '') is not null
      and nullif(btrim(ai_tone_set_by), '') is not null
      and ai_tone_verified_at is not null
      and ai_tone_basis in ('DEALERSHIP_SUPPLIED','OPERATOR_SUPPLIED','PLACEHOLDER'))),
  constraint tcfg_ai_tone_provenance_needs_value check (
    ai_tone is not null or (ai_tone_source is null and ai_tone_set_by is null
      and ai_tone_verified_at is null and ai_tone_basis is null)),

  constraint tcfg_followup_policy_full_provenance check (
    followup_policy is null or (
      nullif(btrim(followup_policy_source), '') is not null
      and nullif(btrim(followup_policy_set_by), '') is not null
      and followup_policy_verified_at is not null
      and followup_policy_basis in ('DEALERSHIP_SUPPLIED','OPERATOR_SUPPLIED','PLACEHOLDER'))),
  constraint tcfg_followup_policy_provenance_needs_value check (
    followup_policy is not null or (followup_policy_source is null and followup_policy_set_by is null
      and followup_policy_verified_at is null and followup_policy_basis is null)),

  constraint tcfg_approval_rules_full_provenance check (
    approval_rules is null or (
      nullif(btrim(approval_rules_source), '') is not null
      and nullif(btrim(approval_rules_set_by), '') is not null
      and approval_rules_verified_at is not null
      and approval_rules_basis in ('DEALERSHIP_SUPPLIED','OPERATOR_SUPPLIED','PLACEHOLDER'))),
  constraint tcfg_approval_rules_provenance_needs_value check (
    approval_rules is not null or (approval_rules_source is null and approval_rules_set_by is null
      and approval_rules_verified_at is null and approval_rules_basis is null))
);

comment on table public.tenant_configuration is
  'Per-dealership configuration for the SHARED workflows and the SHARED dashboard. One row per tenant, PRIMARY KEY (tenant_id). Every setting column is nullable and none carries a DEFAULT: NULL means "this dealership has not decided", never "zero" and never a value invented on their behalf. What the engine must then do is in tenant_configuration_default, one row per setting. NO ROW AT ALL is a defined state, not a crash - the resolver in tenantcfg_04 is driven from public.tenants, so an unconfigured dealership gets a full answer of PRODUCT_DEFAULT and NOT_CONFIGURED states with config_row_exists = false. first_response_sla_minutes is deliberately NOT a column here: it already exists on lead_recovery_settings and a second copy would violate one figure / one derivation in the very table built to end that problem.';

comment on column public.tenant_configuration.brand_name is
  'The trading name used in outbound messages. NULL is not a gap: the resolver falls back to tenants.name and reports state INHERITED_FROM_TENANT, because the dealership registered name is a knowable, honest default. Nothing may invent a trading name.';
comment on column public.tenant_configuration.default_language is
  'BCP-47, e.g. en, ar, en-AE. NO PRODUCT DEFAULT. NULL means the engine must reply in the language of the inbound message and must not translate or assume English. Guessing a customer language is a customer-facing error nobody would ever see in a log.';
comment on column public.tenant_configuration.timezone is
  'IANA zone. The shipped default is Asia/Dubai and it is a PRODUCT_DEFAULT, not a dealership statement: every n8n workflow carries timezone Asia/Dubai and apps/executive-dashboard/lib/format.js pins TZ to it. Validated against pg_timezone_names by trigger, because a CHECK cannot hold a subquery.';
comment on column public.tenant_configuration.currency is
  'ISO 4217. The shipped default AED is a PRODUCT_DEFAULT and also close to a hard limit: every monetary column in this schema is named *_aed (amount_aed, price_aed, holding_cost_per_day_aed ...), so a dealership on another currency is a blocked integration, not a configuration change. Setting this to anything but AED today changes a LABEL, not a number.';
comment on column public.tenant_configuration.business_hours is
  'When the showroom is open. Provenanced because it decides whether the first-response clock was running: the same 40-minute wait is a breach at 11:00 and is not one at 03:00, and the difference is money and a manager judgement of a rep. NULL means the engine reports elapsed wall-clock minutes and must NOT claim the showroom was open or closed.';
comment on column public.tenant_configuration.ai_tone is
  'How the assistant is allowed to sound, in the dealership own words. Provenanced because it reaches a customer verbatim and somebody has to have signed it off. NULL means the shipped neutral prompt: no persona, no nickname, no exclamation style nobody chose.';
comment on column public.tenant_configuration.followup_policy is
  'The automated follow-up cadence. Provenanced because every step is an unsolicited message sent in this dealership name. NULL means SEND NOTHING - absence is the safe state.';
comment on column public.tenant_configuration.approval_rules is
  'Which action kinds a machine may execute without a named human. Provenanced because this is the setting that decides whether software acts alone in a business name. NULL means the product default: EVERYTHING requires a human. The shape CHECK forces a "default" key so an action kind nobody anticipated cannot fall through into silence.';
comment on column public.tenant_configuration.business_hours_basis is
  'DEALERSHIP_SUPPLIED = they stated it and stand behind it. OPERATOR_SUPPLIED = NEXUS staff entered it during onboarding; still sourced and signed, but it is our word for their business. PLACEHOLDER = a working assumption, never to be presented as their policy. Same vocabulary on all four governed settings.';

create table if not exists public.tenant_capability (
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  capability_key text not null references public.tenant_capability_catalogue(capability_key),
  state          text not null check (state in ('AVAILABLE','NOT_AVAILABLE')),
  evidence       text not null,
  source         text not null,
  set_by         text not null,
  verified_at    timestamptz not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (tenant_id, capability_key),
  constraint tcap_evidence_not_blank check (btrim(evidence) <> '' and btrim(source) <> '' and btrim(set_by) <> '')
);

comment on table public.tenant_capability is
  'What a given dealership actually has. THERE IS NO "NOT_ASSESSED" STATE AND NO ROW IS REQUIRED: absence resolves to NOT_AVAILABLE, so the failure mode of this table - forgetting to populate it - produces "not available", never fabricated data. A row is only needed to make a positive claim, and a positive claim costs evidence, source, owner and date, all NOT NULL. Cheap to not have a capability; expensive to claim one.';
comment on column public.tenant_capability.state is
  'AVAILABLE or NOT_AVAILABLE. An explicit NOT_AVAILABLE row is worth writing only when somebody CHECKED and wants the negative on record with its evidence; it resolves identically to having no row.';

create or replace function public.tenant_configuration_validate()
returns trigger language plpgsql as $fn$
begin
  if new.timezone is not null
     and not exists (select 1 from pg_timezone_names z where z.name = new.timezone) then
    raise exception 'tenant_configuration.timezone % is not an IANA zone this server knows', new.timezone
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists tenant_configuration_validate_t on public.tenant_configuration;
create trigger tenant_configuration_validate_t
  before insert or update on public.tenant_configuration
  for each row execute function public.tenant_configuration_validate();

create or replace function public.tenant_capability_touch()
returns trigger language plpgsql as $fn$
begin new.updated_at := now(); return new; end;
$fn$;

drop trigger if exists tenant_capability_touch_t on public.tenant_capability;
create trigger tenant_capability_touch_t
  before update on public.tenant_capability
  for each row execute function public.tenant_capability_touch();