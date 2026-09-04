-- Register a template NEXUS has typed but never submitted. It cannot carry a
-- provider identity or a provider status; wat_draft_has_no_provider_claim
-- enforces that independently of this function.
create or replace function public.whatsapp_template_declare(
  p_integration_id  uuid,
  p_name            text,
  p_language        text,
  p_category        text,
  p_body_text       text default null,
  p_variable_schema jsonb default '[]'::jsonb,
  p_declared_by     text default null,
  p_waba_ref        text default null)
returns table(template_id uuid, tenant_id uuid, created boolean)
language plpgsql security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_tenant uuid; v_cstatus text; v_tstatus text; v_id uuid;
  v_name text := lower(btrim(coalesce(p_name,'')));
  v_lang text := btrim(coalesce(p_language,''));
  v_body text := nullif(btrim(coalesce(p_body_text,'')),'');
begin
  perform public.whatsapp_refuse_end_user_role('whatsapp_template_declare');

  select cr.tenant_id, cr.status, t.status into v_tenant, v_cstatus, v_tstatus
    from public.channel_registry cr join public.tenants t on t.id = cr.tenant_id
   where cr.integration_id = p_integration_id;

  if v_tenant is null then
    raise exception 'whatsapp_template_declare: integration % is not in channel_registry. An unregistered channel owns no templates.', p_integration_id using errcode='23503';
  end if;
  if v_cstatus <> 'active' or v_tstatus <> 'active' then
    raise exception 'whatsapp_template_declare: channel status % / dealership status %.', v_cstatus, v_tstatus using errcode='42501';
  end if;

  select t.template_id into v_id from public.whatsapp_templates t
   where t.tenant_id = v_tenant and t.provider = 'whatsapp_cloud'
     and coalesce(t.waba_ref,'') = coalesce(p_waba_ref,'')
     and t.name = v_name and t.language = v_lang;

  if v_id is not null then
    return query select v_id, v_tenant, false;
    return;
  end if;

  insert into public.whatsapp_templates
    (tenant_id, integration_id, provider, waba_ref, name, language, category,
     nexus_state, nexus_state_at, nexus_state_by,
     variable_schema, body_text, body_text_source, body_text_observed_at)
  values
    (v_tenant, p_integration_id, 'whatsapp_cloud', p_waba_ref, v_name, v_lang,
     upper(btrim(coalesce(p_category,''))),
     'DRAFT', now(), nullif(btrim(coalesce(p_declared_by,'')),''),
     coalesce(p_variable_schema,'[]'::jsonb),
     v_body,
     case when v_body is null then null else 'NEXUS_DRAFT' end,
     case when v_body is null then null else now() end)
  returning public.whatsapp_templates.template_id into v_id;

  return query select v_id, v_tenant, true;
end;
$$;


-- The ONLY path by which a provider status reaches the registry. It stamps when
-- NEXUS heard it and how, keeps the provider's own word verbatim, and preserves
-- the status it replaced.
create or replace function public.whatsapp_template_observe(
  p_integration_id       uuid,
  p_name                 text,
  p_language             text,
  p_provider_status_raw  text,
  p_source               text,
  p_observed_at          timestamptz default now(),
  p_category             text default null,
  p_provider_template_id text default null,
  p_waba_ref             text default null,
  p_evidence_ref         text default null,
  p_rejected_reason      text default null,
  p_body_text            text default null,
  p_variable_schema      jsonb default null)
returns table(template_id uuid, tenant_id uuid, provider_status text,
              replaced_status text, status_changed boolean)
language plpgsql security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_tenant uuid; v_cstatus text; v_tstatus text;
  v_norm text; v_raw text := btrim(coalesce(p_provider_status_raw,''));
  v_prev text; v_prev_at timestamptz; v_id uuid; v_changed boolean;
  v_name text := lower(btrim(coalesce(p_name,'')));
  v_lang text := btrim(coalesce(p_language,''));
  v_body text := nullif(btrim(coalesce(p_body_text,'')),'');
  v_known text[] := array['APPROVED','REJECTED','PENDING','PAUSED','DISABLED',
                          'PENDING_DELETION','IN_APPEAL','LIMIT_EXCEEDED'];
  v_refused text[] := array['REJECTED','PAUSED','DISABLED','IN_APPEAL','LIMIT_EXCEEDED'];
begin
  perform public.whatsapp_refuse_end_user_role('whatsapp_template_observe');

  if v_raw = '' then
    raise exception 'whatsapp_template_observe: the provider''s own status string is required. An observation with no reported value is not an observation.' using errcode='22023';
  end if;
  if coalesce(p_source,'') not in ('GRAPH_API_FETCH','WEBHOOK_TEMPLATE_STATUS_UPDATE','OPERATOR_ENTERED') then
    raise exception 'whatsapp_template_observe: p_source must say how NEXUS heard this (GRAPH_API_FETCH, WEBHOOK_TEMPLATE_STATUS_UPDATE or OPERATOR_ENTERED); got %.', coalesce(p_source,'(null)') using errcode='22023';
  end if;
  if p_observed_at is null then
    raise exception 'whatsapp_template_observe: p_observed_at is required. A cached status with no timestamp cannot be aged, and an unageable APPROVED is exactly the failure this registry is designed against.' using errcode='22023';
  end if;

  select cr.tenant_id, cr.status, t.status into v_tenant, v_cstatus, v_tstatus
    from public.channel_registry cr join public.tenants t on t.id = cr.tenant_id
   where cr.integration_id = p_integration_id;
  if v_tenant is null then
    raise exception 'whatsapp_template_observe: integration % is not in channel_registry.', p_integration_id using errcode='23503';
  end if;
  if v_cstatus <> 'active' or v_tstatus <> 'active' then
    raise exception 'whatsapp_template_observe: channel status % / dealership status %.', v_cstatus, v_tstatus using errcode='42501';
  end if;

  -- Normalise for querying, keep the provider's word verbatim either way. An
  -- unrecognised status becomes UNMAPPED rather than being guessed at.
  v_norm := upper(replace(btrim(v_raw), ' ', '_'));
  if not (v_norm = any (v_known)) then v_norm := 'UNMAPPED'; end if;

  select t.template_id, t.provider_status, t.provider_status_observed_at
    into v_id, v_prev, v_prev_at
    from public.whatsapp_templates t
   where t.tenant_id = v_tenant and t.provider = 'whatsapp_cloud'
     and coalesce(t.waba_ref,'') = coalesce(p_waba_ref,'')
     and t.name = v_name and t.language = v_lang;

  if v_id is null then
    insert into public.whatsapp_templates
      (tenant_id, integration_id, provider, waba_ref, name, language, category,
       provider_template_id, nexus_state, nexus_state_at,
       provider_status, provider_status_raw, provider_status_observed_at,
       provider_status_source, provider_status_evidence_ref, provider_rejected_reason,
       variable_schema, body_text, body_text_source, body_text_observed_at)
    values
      (v_tenant, p_integration_id, 'whatsapp_cloud', p_waba_ref, v_name, v_lang,
       upper(btrim(coalesce(p_category,'UTILITY'))),
       p_provider_template_id, 'ADOPTED', now(),
       v_norm, v_raw, p_observed_at, p_source, p_evidence_ref,
       case when v_norm = any (v_refused) then nullif(btrim(coalesce(p_rejected_reason,'')),'') end,
       coalesce(p_variable_schema,'[]'::jsonb),
       v_body,
       case when v_body is null then null else 'PROVIDER_FETCHED' end,
       case when v_body is null then null else p_observed_at end)
    returning public.whatsapp_templates.template_id into v_id;
    return query select v_id, v_tenant, v_norm, null::text, true;
    return;
  end if;

  v_changed := (v_prev is distinct from v_norm);

  update public.whatsapp_templates t set
    provider_status              = v_norm,
    provider_status_raw          = v_raw,
    provider_status_observed_at  = p_observed_at,
    provider_status_source       = p_source,
    provider_status_evidence_ref = coalesce(p_evidence_ref, t.provider_status_evidence_ref),
    provider_rejected_reason     = case when v_norm = any (v_refused)
                                        then coalesce(nullif(btrim(coalesce(p_rejected_reason,'')),''), t.provider_rejected_reason)
                                        else null end,
    previous_provider_status     = case when v_changed and v_prev <> 'UNKNOWN' then v_prev else t.previous_provider_status end,
    previous_status_observed_at  = case when v_changed and v_prev <> 'UNKNOWN' then v_prev_at else t.previous_status_observed_at end,
    provider_template_id         = coalesce(p_provider_template_id, t.provider_template_id),
    category                     = coalesce(upper(nullif(btrim(coalesce(p_category,'')),'')), t.category),
    nexus_state                  = case when t.nexus_state = 'DRAFT' then 'ADOPTED' else t.nexus_state end,
    variable_schema              = coalesce(p_variable_schema, t.variable_schema),
    body_text                    = coalesce(v_body, t.body_text),
    body_text_source             = case when v_body is not null then 'PROVIDER_FETCHED' else t.body_text_source end,
    body_text_observed_at        = case when v_body is not null then p_observed_at else t.body_text_observed_at end
  where t.template_id = v_id;

  return query select v_id, v_tenant, v_norm, case when v_changed then v_prev end, v_changed;
end;
$$;


create or replace function public.whatsapp_template_retire(p_template_id uuid, p_by text default null)
returns boolean language plpgsql security definer
set search_path to 'public','pg_catalog'
as $$
declare v_n integer;
begin
  perform public.whatsapp_refuse_end_user_role('whatsapp_template_retire');
  update public.whatsapp_templates
     set nexus_state = 'RETIRED', nexus_state_at = now(),
         nexus_state_by = coalesce(nullif(btrim(coalesce(p_by,'')),''), nexus_state_by)
   where template_id = p_template_id and nexus_state <> 'RETIRED';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

comment on function public.whatsapp_template_observe(uuid,text,text,text,text,timestamptz,text,text,text,text,text,text,jsonb) is
  'The only path by which a provider status reaches whatsapp_templates. Refuses an observation with no reported value, no source, or no timestamp. When the status changes it keeps the one it replaced and when that was observed, so a template NEXUS believed APPROVED and the provider has since REJECTED is discoverable on the row itself.';
comment on function public.whatsapp_template_declare(uuid,text,text,text,text,jsonb,text,text) is
  'Registers a NEXUS-authored DRAFT template. A draft carries no provider identity and no provider status, so it can never be mistaken for something Meta has seen.';

revoke all on function public.whatsapp_template_declare(uuid,text,text,text,text,jsonb,text,text) from anon, authenticated, public;
revoke all on function public.whatsapp_template_observe(uuid,text,text,text,text,timestamptz,text,text,text,text,text,text,jsonb) from anon, authenticated, public;
revoke all on function public.whatsapp_template_retire(uuid,text) from anon, authenticated, public;
grant execute on function public.whatsapp_template_declare(uuid,text,text,text,text,jsonb,text,text) to service_role;
grant execute on function public.whatsapp_template_observe(uuid,text,text,text,text,timestamptz,text,text,text,text,text,text,jsonb) to service_role;
grant execute on function public.whatsapp_template_retire(uuid,text) to service_role;