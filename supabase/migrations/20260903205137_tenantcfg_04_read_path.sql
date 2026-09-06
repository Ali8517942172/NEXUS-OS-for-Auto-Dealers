-- tenantcfg_04_read_path
--
-- Functions, not views. A public view must carry security_invoker (an event
-- trigger enforces it), and a security_invoker view over
-- tenant_configuration_default would need an authenticated SELECT grant and a
-- PERMISSIVE USING(true) policy on that table - the exact shape QUALITY_GATE
-- check L2 fails on. Functions give the dashboard the same answer through a
-- narrower door.
--
-- SHAPE OF THE ANSWER, and the point of the whole migration: every setting is
-- returned as a VALUE PLUS A STATE. A value never travels without the state
-- that says where it came from. Four states, and nothing else:
--
--   CONFIGURED             this dealership stated it. It is theirs.
--   PRODUCT_DEFAULT        they have not stated it and NEXUS has an honest
--                          shipped answer. The value is real and usable and
--                          MUST be labelled as the product's, not theirs.
--   NOT_CONFIGURED         they have not stated it and there is no honest
--                          default. The value is NULL and the engine must
--                          refuse to assert. This is UNKNOWN, not zero.
--   INHERITED_FROM_TENANT  brand_name only: taken from tenants.name.
--
-- CONFIGURED with the value 5 and PRODUCT_DEFAULT with the value 5 are
-- different answers. That distinction is the requirement.

-- The return shapes are declared as TYPEs so the wrappers below share one
-- contract rather than three copies of a column list that would drift.
drop type if exists public.nexus_tenant_config_row cascade;
create type public.nexus_tenant_config_row as (
  tenant_id uuid, tenant_slug text, tenant_name text, tenant_status text,
  config_row_exists boolean,
  brand_name text, brand_name_state text,
  default_language text, default_language_state text,
  timezone text, timezone_state text,
  currency text, currency_state text,
  business_hours jsonb, business_hours_state text, business_hours_basis text,
  business_hours_set_by text, business_hours_source text, business_hours_verified_at timestamptz,
  ai_tone text, ai_tone_state text, ai_tone_basis text,
  ai_tone_set_by text, ai_tone_source text, ai_tone_verified_at timestamptz,
  followup_policy jsonb, followup_policy_state text, followup_policy_basis text,
  followup_policy_set_by text, followup_policy_source text, followup_policy_verified_at timestamptz,
  approval_rules jsonb, approval_rules_state text, approval_rules_basis text,
  approval_rules_set_by text, approval_rules_source text, approval_rules_verified_at timestamptz,
  first_response_sla_minutes int, first_response_sla_minutes_state text, first_response_sla_minutes_source text,
  capabilities_available int, capabilities_in_catalogue int,
  settings_not_stated text[],
  computed_at timestamptz
);

drop type if exists public.nexus_tenant_capability_row cascade;
create type public.nexus_tenant_capability_row as (
  tenant_id uuid, capability_key text, label text, state text,
  evidence text, source text, set_by text, verified_at timestamptz,
  what_it_unlocks text, requires text, absent_means text, sort int
);

-- ---------------------------------------------------------------------------
-- The core. SECURITY DEFINER and callable by NOBODY: every grant is revoked and
-- none is issued, so only the wrappers below (owned by postgres, running as
-- postgres) can reach it. One derivation, two doors.
-- ---------------------------------------------------------------------------
create or replace function public.nexus_tenant_config_core(p_tenant_id uuid)
returns setof public.nexus_tenant_config_row
language sql stable security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  with d as (
    select setting_key, default_value from public.tenant_configuration_default
  )
  select
    t.id, t.slug, t.name, t.status,
    (c.tenant_id is not null),

    coalesce(c.brand_name, t.name),
    case when c.brand_name is not null then 'CONFIGURED' else 'INHERITED_FROM_TENANT' end,

    c.default_language,
    case when c.default_language is not null then 'CONFIGURED' else 'NOT_CONFIGURED' end,

    coalesce(c.timezone, (select default_value #>> '{}' from d where setting_key = 'timezone')),
    case when c.timezone is not null then 'CONFIGURED' else 'PRODUCT_DEFAULT' end,

    coalesce(c.currency, (select default_value #>> '{}' from d where setting_key = 'currency')),
    case when c.currency is not null then 'CONFIGURED' else 'PRODUCT_DEFAULT' end,

    c.business_hours,
    case when c.business_hours is not null then 'CONFIGURED' else 'NOT_CONFIGURED' end,
    c.business_hours_basis, c.business_hours_set_by, c.business_hours_source, c.business_hours_verified_at,

    c.ai_tone,
    case when c.ai_tone is not null then 'CONFIGURED' else 'NOT_CONFIGURED' end,
    c.ai_tone_basis, c.ai_tone_set_by, c.ai_tone_source, c.ai_tone_verified_at,

    c.followup_policy,
    case when c.followup_policy is not null then 'CONFIGURED' else 'NOT_CONFIGURED' end,
    c.followup_policy_basis, c.followup_policy_set_by, c.followup_policy_source, c.followup_policy_verified_at,

    coalesce(c.approval_rules, (select default_value from d where setting_key = 'approval_rules')),
    case when c.approval_rules is not null then 'CONFIGURED' else 'PRODUCT_DEFAULT' end,
    c.approval_rules_basis, c.approval_rules_set_by, c.approval_rules_source, c.approval_rules_verified_at,

    -- The sharp case. The figure is NOT duplicated here: it is read from
    -- lead_recovery_settings, which is where it already lives and where
    -- v_lead_recovery reads it. What this adds is the STATE, so "has not
    -- decided" stops looking identical to "chose 5".
    coalesce(s.sla_first_response_minutes,
             (select (default_value #>> '{}')::int from d where setting_key = 'first_response_sla_minutes')),
    case when s.sla_first_response_minutes is not null then 'CONFIGURED' else 'PRODUCT_DEFAULT' end,
    case
      when s.sla_first_response_minutes is not null
        then 'lead_recovery_settings.sla_first_response_minutes, set_by '
             || coalesce(s.set_by, '(nobody named)') || ' at ' || s.set_at::text
      when s.tenant_id is null
        then 'NOT THIS DEALERSHIP POLICY. No lead_recovery_settings row exists for this tenant; the value is the product default from tenant_configuration_default.'
      else 'NOT THIS DEALERSHIP POLICY. A lead_recovery_settings row exists but sla_first_response_minutes is null - the dealership has explicitly not decided; the value is the product default from tenant_configuration_default.'
    end,

    (select count(*)::int from public.tenant_capability tc
      where tc.tenant_id = t.id and tc.state = 'AVAILABLE'),
    (select count(*)::int from public.tenant_capability_catalogue),

    array_remove(array[
      case when c.brand_name       is null then 'brand_name'       end,
      case when c.default_language is null then 'default_language' end,
      case when c.timezone         is null then 'timezone'         end,
      case when c.currency         is null then 'currency'         end,
      case when c.business_hours   is null then 'business_hours'   end,
      case when c.ai_tone          is null then 'ai_tone'          end,
      case when c.followup_policy  is null then 'followup_policy'  end,
      case when c.approval_rules   is null then 'approval_rules'   end,
      case when s.sla_first_response_minutes is null then 'first_response_sla_minutes' end
    ], null),

    now()
  from public.tenants t
  left join public.tenant_configuration   c on c.tenant_id = t.id
  left join public.lead_recovery_settings s on s.tenant_id = t.id
  where t.id = p_tenant_id;
$fn$;

comment on function public.nexus_tenant_config_core(uuid) is
  'The single derivation of a dealership effective configuration. Driven FROM public.tenants, so a tenant with no tenant_configuration row still returns exactly one fully-populated row with config_row_exists = false - the unconfigured state is defined, not a crash and not an empty result. Returns zero rows only for a tenant id that does not exist. Callable by nobody: every grant is revoked and none issued, so only the definer wrappers below reach it.';

-- ---------------------------------------------------------------------------
-- Door 1: n8n and any other service_role caller. Same contract as
-- nexus_resolve_channel_tenant - SET-returning, zero rows means unresolved, no
-- fallback clause, service_role only, plus the same belt-and-braces role guard
-- in case a later platform default-privilege re-opens the grant.
-- ---------------------------------------------------------------------------
create or replace function public.nexus_resolve_tenant_config(p_tenant_id uuid)
returns setof public.nexus_tenant_config_row
language sql stable security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select * from public.nexus_tenant_config_core(p_tenant_id)
   where coalesce(current_setting('role', true), '') not in ('authenticated', 'anon');
$fn$;

comment on function public.nexus_resolve_tenant_config(uuid) is
  'The read path for n8n. Zero rows means UNRESOLVED - an unknown tenant id - and a workflow that gets zero rows must stop, not guess. One row is always returned for a known tenant, whether or not it has been configured; read the *_state column beside every value before using it.';

-- ---------------------------------------------------------------------------
-- Door 2: the dashboard. No tenant argument on purpose - the caller cannot name
-- a dealership, they get theirs. (QUALITY_GATE L4 fails any SECURITY DEFINER
-- function executable by authenticated that takes a tenant as an argument;
-- this shape is why.)
-- ---------------------------------------------------------------------------
create or replace function public.nexus_my_tenant_config()
returns setof public.nexus_tenant_config_row
language sql stable security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select r.* from public.nexus_current_tenant_ids() tid
  cross join lateral public.nexus_tenant_config_core(tid) r;
$fn$;

comment on function public.nexus_my_tenant_config() is
  'The read path for the dashboard: GET /rest/v1/rpc/nexus_my_tenant_config. Returns one row per dealership the SIGNED-IN CALLER belongs to, resolved through nexus_current_tenant_ids() - there is no argument, so a caller cannot ask about a dealership that is not theirs. A service_role caller gets zero rows here because auth.uid() is null; that is correct, and n8n uses nexus_resolve_tenant_config instead.';

-- ---------------------------------------------------------------------------
-- Capabilities. Driven FROM the catalogue, so every known capability always
-- comes back with a state, and the state for a dealership with no row is
-- NOT_AVAILABLE. Absence is an answer here, never an empty result set.
-- ---------------------------------------------------------------------------
create or replace function public.nexus_tenant_capability_core(p_tenant_id uuid)
returns setof public.nexus_tenant_capability_row
language sql stable security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select t.id, k.capability_key, k.label,
         case when tc.state = 'AVAILABLE' then 'AVAILABLE' else 'NOT_AVAILABLE' end,
         tc.evidence, tc.source, tc.set_by, tc.verified_at,
         k.what_it_unlocks, k.requires, k.absent_means, k.sort
    from public.tenants t
    cross join public.tenant_capability_catalogue k
    left join public.tenant_capability tc
           on tc.tenant_id = t.id and tc.capability_key = k.capability_key
   where t.id = p_tenant_id;
$fn$;

comment on function public.nexus_tenant_capability_core(uuid) is
  'Every capability in the catalogue, with this dealership state for each. The CASE collapses "no row" and "a row saying NOT_AVAILABLE" to the same answer on purpose: forgetting to populate tenant_capability produces NOT_AVAILABLE, never a fabricated capability. Only an AVAILABLE row - which cannot exist without evidence, source, owner and date, all NOT NULL - turns a capability on.';

create or replace function public.nexus_resolve_tenant_capability(p_tenant_id uuid, p_capability_key text)
returns setof public.nexus_tenant_capability_row
language sql stable security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select * from public.nexus_tenant_capability_core(p_tenant_id)
   where capability_key = upper(btrim(coalesce(p_capability_key, '')))
     and coalesce(current_setting('role', true), '') not in ('authenticated', 'anon');
$fn$;

comment on function public.nexus_resolve_tenant_capability(uuid, text) is
  'The capability gate for n8n. ZERO ROWS MEANS THE QUESTION WAS NOT UNDERSTOOD - an unknown tenant or an unknown capability key - and a workflow must treat that exactly like NOT_AVAILABLE: stop. One row means the question was understood, and the state column is the answer. A workflow must never infer a capability from the presence of a table or a non-empty query result.';

create or replace function public.nexus_my_tenant_capabilities()
returns setof public.nexus_tenant_capability_row
language sql stable security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select r.* from public.nexus_current_tenant_ids() tid
  cross join lateral public.nexus_tenant_capability_core(tid) r
  order by 12, 2;
$fn$;

comment on function public.nexus_my_tenant_capabilities() is
  'The capability list for the dashboard: GET /rest/v1/rpc/nexus_my_tenant_capabilities. One row per capability per dealership the signed-in caller belongs to. Screens render absent_means verbatim for a NOT_AVAILABLE capability rather than drawing an empty chart.';

-- ---------------------------------------------------------------------------
-- ACLs. Supabase grants EXECUTE directly to anon and authenticated on every new
-- function; REVOKE ... FROM PUBLIC does not remove a direct grant, so all three
-- grantees are named on every revoke.
-- ---------------------------------------------------------------------------
revoke all on function public.nexus_tenant_config_core(uuid)              from anon, authenticated, public;
revoke all on function public.nexus_tenant_capability_core(uuid)          from anon, authenticated, public;
revoke all on function public.nexus_resolve_tenant_config(uuid)           from anon, authenticated, public;
revoke all on function public.nexus_resolve_tenant_capability(uuid, text) from anon, authenticated, public;
revoke all on function public.nexus_my_tenant_config()                    from anon, authenticated, public;
revoke all on function public.nexus_my_tenant_capabilities()              from anon, authenticated, public;

grant execute on function public.nexus_resolve_tenant_config(uuid)           to service_role;
grant execute on function public.nexus_resolve_tenant_capability(uuid, text) to service_role;
grant execute on function public.nexus_my_tenant_config()                    to authenticated, service_role;
grant execute on function public.nexus_my_tenant_capabilities()              to authenticated, service_role;