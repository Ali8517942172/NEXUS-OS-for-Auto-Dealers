create type public.whatsapp_template_sendability_row as (
  sendable                     boolean,
  verdict                      text,
  reason_code                  text,
  reason                       text,
  what_would_change_it         text,
  template_id                  uuid,
  tenant_id                    uuid,
  integration_id               uuid,
  name                         text,
  language                     text,
  category                     text,
  nexus_state                  text,
  provider_status              text,
  provider_status_raw          text,
  provider_status_source       text,
  provider_status_observed_at  timestamptz,
  status_age                   interval,
  max_status_age               interval,
  is_stale                     boolean,
  previous_provider_status     text,
  body_variable_count          integer,
  variable_schema              jsonb,
  evaluated_at                 timestamptz,
  decided_by                   text
);

create or replace function public.whatsapp_refuse_end_user_role(p_fn text)
returns void language plpgsql immutable
set search_path to 'public','pg_catalog'
as $$
begin
  if coalesce(current_setting('role', true), '') in ('authenticated','anon') then
    raise exception '%: refused for end-user role %. Messaging records are written by the backend only.',
      p_fn, current_setting('role', true) using errcode = '42501';
  end if;
end;
$$;

-- p_max_status_age has NO default. "How old an answer am I willing to send on"
-- is a decision the caller must state, not a constant hidden in this function --
-- and it is recorded on the usage row, so the tolerance a send was made under
-- stays auditable.
create or replace function public.whatsapp_template_sendability(
  p_template_id    uuid,
  p_max_status_age interval)
returns setof public.whatsapp_template_sendability_row
language plpgsql
stable
set search_path to 'public','pg_catalog'
as $$
declare
  r         public.whatsapp_templates%rowtype;
  v_tstatus text;
  v_age     interval;
  v_stale   boolean;
  v_now     timestamptz := now();
  v_by      text := 'whatsapp_template_sendability v1 - deterministic SQL, no language model in the path';
begin
  select t.* into r from public.whatsapp_templates t where t.template_id = p_template_id;

  -- Always exactly one row, never zero -- including for a template that does not
  -- exist. A zero-row answer is trivially misread as "nothing objected".
  if r.template_id is null then
    return query select
      false, 'REFUSED_TEMPLATE_UNKNOWN'::text, 'TEMPLATE_NOT_IN_REGISTRY'::text,
      format('No template %s exists in NEXUS''s registry, so NEXUS cannot say anything about whether the provider approved it.', coalesce(p_template_id::text,'(null)'))::text,
      'Register the template and record the provider''s status for it with whatsapp_template_observe().'::text,
      p_template_id, null::uuid, null::uuid, null::text, null::text, null::text, null::text,
      'UNKNOWN'::text, null::text, 'NEVER_OBSERVED'::text, null::timestamptz,
      null::interval, p_max_status_age, null::boolean, null::text, null::integer, null::jsonb,
      v_now, v_by;
    return;
  end if;

  select tn.status into v_tstatus from public.tenants tn where tn.id = r.tenant_id;

  if p_max_status_age is null then
    return query select
      false, 'REFUSED_NO_TOLERANCE_STATED'::text, 'STALENESS_TOLERANCE_NOT_STATED'::text,
      'The caller did not say how old a provider status it is willing to send on. NEXUS will not pick that number for it.'::text,
      'Pass p_max_status_age. The value is recorded on the usage row, so the tolerance a send was made under stays auditable.'::text,
      r.template_id, r.tenant_id, r.integration_id, r.name, r.language, r.category, r.nexus_state,
      r.provider_status, r.provider_status_raw, r.provider_status_source, r.provider_status_observed_at,
      (v_now - r.provider_status_observed_at), p_max_status_age, null::boolean,
      r.previous_provider_status, r.body_variable_count, r.variable_schema, v_now, v_by;
    return;
  end if;

  v_age   := v_now - r.provider_status_observed_at;
  v_stale := (r.provider_status_observed_at is null) or (v_age > p_max_status_age);

  if coalesce(v_tstatus,'') <> 'active' then
    return query select
      false, 'REFUSED_DEALERSHIP_INACTIVE'::text, 'TENANT_NOT_ACTIVE'::text,
      'The dealership that owns this template is not active.'::text,
      'Reactivate the dealership, or stop the send.'::text,
      r.template_id, r.tenant_id, r.integration_id, r.name, r.language, r.category, r.nexus_state,
      r.provider_status, r.provider_status_raw, r.provider_status_source, r.provider_status_observed_at,
      v_age, p_max_status_age, v_stale, r.previous_provider_status, r.body_variable_count,
      r.variable_schema, v_now, v_by;
    return;
  end if;

  if r.nexus_state = 'RETIRED' then
    return query select
      false, 'REFUSED_TEMPLATE_RETIRED'::text, 'NEXUS_RETIRED_THIS_TEMPLATE'::text,
      'NEXUS has retired this template. Whatever the provider still says about it, NEXUS will not send it.'::text,
      'Un-retire it deliberately if it should be in use again.'::text,
      r.template_id, r.tenant_id, r.integration_id, r.name, r.language, r.category, r.nexus_state,
      r.provider_status, r.provider_status_raw, r.provider_status_source, r.provider_status_observed_at,
      v_age, p_max_status_age, v_stale, r.previous_provider_status, r.body_variable_count,
      r.variable_schema, v_now, v_by;
    return;
  end if;

  if r.provider_status = 'UNKNOWN' then
    return query select
      false, 'REFUSED_NEVER_OBSERVED'::text, 'PROVIDER_STATUS_NEVER_OBSERVED'::text,
      'NEXUS has never heard a status for this template from the provider. It holds no opinion to be stale, and an unobserved template is not an approved one.'::text,
      'Fetch the template''s status from the provider and record it with whatsapp_template_observe(). Until then this template cannot be sent.'::text,
      r.template_id, r.tenant_id, r.integration_id, r.name, r.language, r.category, r.nexus_state,
      r.provider_status, r.provider_status_raw, r.provider_status_source, r.provider_status_observed_at,
      v_age, p_max_status_age, v_stale, r.previous_provider_status, r.body_variable_count,
      r.variable_schema, v_now, v_by;
    return;
  end if;

  if r.provider_status <> 'APPROVED' then
    return query select
      false, 'REFUSED_PROVIDER_STATUS'::text, 'PROVIDER_STATUS_NOT_APPROVED'::text,
      format('The provider last reported this template as %s (its own word: %s), observed %s.',
             r.provider_status, coalesce(r.provider_status_raw,'(none)'),
             to_char(r.provider_status_observed_at, 'YYYY-MM-DD HH24:MI'))::text,
      coalesce(nullif(r.provider_rejected_reason,''),
               'Resolve the template with the provider, then re-observe its status. NEXUS does not overrule the provider.')::text,
      r.template_id, r.tenant_id, r.integration_id, r.name, r.language, r.category, r.nexus_state,
      r.provider_status, r.provider_status_raw, r.provider_status_source, r.provider_status_observed_at,
      v_age, p_max_status_age, v_stale, r.previous_provider_status, r.body_variable_count,
      r.variable_schema, v_now, v_by;
    return;
  end if;

  -- The failure this whole design exists to prevent: an APPROVED that NEXUS has
  -- not re-checked recently enough, sending silently after the provider changed
  -- its mind. A stale APPROVED is a refusal, not a warning.
  if v_stale then
    return query select
      false, 'REFUSED_STALE_APPROVAL'::text, 'APPROVAL_TOO_OLD_TO_RELY_ON'::text,
      format('NEXUS believes this template is APPROVED, but that belief is %s old and the caller will only rely on an answer up to %s old. The provider may have rejected or paused it since.',
             coalesce(v_age::text,'(unknown age - never observed)'), p_max_status_age::text)::text,
      'Re-fetch the template''s status from the provider and record it with whatsapp_template_observe(), then ask again. Widening the tolerance instead is a decision somebody has to make on purpose.'::text,
      r.template_id, r.tenant_id, r.integration_id, r.name, r.language, r.category, r.nexus_state,
      r.provider_status, r.provider_status_raw, r.provider_status_source, r.provider_status_observed_at,
      v_age, p_max_status_age, v_stale, r.previous_provider_status, r.body_variable_count,
      r.variable_schema, v_now, v_by;
    return;
  end if;

  return query select
    true, 'SEND_ALLOWED'::text, 'APPROVED_AND_FRESH_ENOUGH'::text,
    format('The provider reported APPROVED %s ago, within the caller''s stated tolerance of %s.', v_age::text, p_max_status_age::text)::text,
    'Nothing. Record this verdict and the age on the usage row when the message is sent.'::text,
    r.template_id, r.tenant_id, r.integration_id, r.name, r.language, r.category, r.nexus_state,
    r.provider_status, r.provider_status_raw, r.provider_status_source, r.provider_status_observed_at,
    v_age, p_max_status_age, v_stale, r.previous_provider_status, r.body_variable_count,
    r.variable_schema, v_now, v_by;
end;
$$;

comment on function public.whatsapp_template_sendability(uuid, interval) is
  'The send path''s template gate. Answers "is this still good, and how stale is that answer" and returns exactly one row for every input, including a template that does not exist. A stale APPROVED is REFUSED, not warned about. p_max_status_age has no default on purpose: the tolerance is the caller''s decision and is recorded on the usage row.';

revoke all on function public.whatsapp_template_sendability(uuid, interval) from anon, authenticated, public;
revoke all on function public.whatsapp_refuse_end_user_role(text) from anon, authenticated, public;
grant execute on function public.whatsapp_template_sendability(uuid, interval) to service_role;
grant execute on function public.whatsapp_refuse_end_user_role(text) to service_role;