-- ============================================================================
-- nexus_route_message_wires_template_staleness_gate
--
-- whatsapp_template_sendability() has behaved correctly since it was written:
-- a template NEXUS has never observed, one the provider rejected, one NEXUS
-- retired, and an APPROVED whose approval is older than the caller's stated
-- tolerance are all refusals, and a caller that states no tolerance is refused
-- for want of one. Nothing called it.
--
-- nexus_route_message called a stub instead - nexus_verify_template_ref(), which
-- returned UNVERIFIED_REGISTRY_PRESENT_NOT_WIRED unconditionally - set
-- directive := 'SEND' BEFORE calling it, and never branched on the answer.
-- Measured on production 4 Sep 2026 in a rolled-back transaction: an APPROVED
-- template 40 days stale, one REJECTED by the provider, one RETIRED by NEXUS,
-- and a reference that has never existed all returned SEND / SENDABLE_TEMPLATE.
--
-- Three changes:
--
--   * nexus_verify_template_ref resolves the reference against
--     whatsapp_templates and asks whatsapp_template_sendability for the verdict.
--     It also refuses a category mismatch: sending a MARKETING template where
--     the policy engine required UTILITY is a policy breach wearing an approved
--     template's clothes.
--   * nexus_route_message takes a staleness tolerance. There is no default,
--     matching whatsapp_template_sendability: a template send with no stated
--     tolerance is REFUSED rather than sent on a number NEXUS picked. Free-form
--     sends are unaffected, so nothing that works today stops working.
--   * directive is set to SEND only after the template gate passes.
--
-- nexus_request_send gains the same parameter and passes it through, so the
-- tolerance a send was routed under is recorded on channel_send_directive with
-- the rest of the decision.
-- ============================================================================

drop function if exists public.nexus_verify_template_ref(uuid,text,text,text);

create function public.nexus_verify_template_ref(
  p_tenant_id         uuid,
  p_provider          text,
  p_template_ref      text,
  p_required_category text,
  p_max_status_age    interval)
returns table(sendable boolean, verification text, detail text, what_would_change_it text,
              template_id uuid, template_name text, template_language text, template_category text,
              provider_status text, provider_status_observed_at timestamptz,
              status_age interval, max_status_age interval)
language plpgsql
stable
set search_path to 'public','pg_catalog'
as $function$
declare
  v_ref  text := lower(btrim(coalesce(p_template_ref,'')));
  v_name text;
  v_lang text;
  v_cat  text := upper(nullif(btrim(coalesce(p_required_category,'')),''));
  v_n    int;
  v_langs text;
  t      public.whatsapp_templates%rowtype;
  s      record;
begin
  if v_ref = '' then
    return query select false, 'NO_TEMPLATE_REF'::text,
      'No template reference was supplied, so there is nothing to verify.'::text,
      'Supply the template name, or name:language when the dealership holds more than one language for it.'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::timestamptz,
      null::interval, p_max_status_age;
    return;
  end if;

  -- The tolerance has no default here for the same reason it has none on
  -- whatsapp_template_sendability: how old an approval a dealership is willing
  -- to send on is the dealership's risk, not a number NEXUS invents for it.
  if p_max_status_age is null then
    return query select false, 'REFUSED_NO_TOLERANCE_STATED'::text,
      'The caller did not say how old a provider status it is willing to send on.'::text,
      'Pass p_max_status_age. The value is recorded with the routing decision, so the tolerance a send was made under stays auditable.'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::timestamptz,
      null::interval, p_max_status_age;
    return;
  end if;

  if p_provider is distinct from 'whatsapp_cloud' then
    return query select false, 'REFUSED_PROVIDER_HAS_NO_TEMPLATES'::text,
      format('A WhatsApp message template is a WABA object and does not exist behind %s, so there is no approval for NEXUS to check.',
             coalesce(p_provider,'(no provider)'))::text,
      'Route the send through the official WhatsApp Cloud API integration. Pasting the template text into a free-form message on an unofficial transport is the bypass, not the workaround.'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::timestamptz,
      null::interval, p_max_status_age;
    return;
  end if;

  if position(':' in v_ref) > 0 then
    v_name := split_part(v_ref, ':', 1);
    v_lang := split_part(v_ref, ':', 2);
  else
    v_name := v_ref;
    v_lang := null;
  end if;

  select count(*)::int, string_agg(distinct w.language, ', ' order by w.language)
    into v_n, v_langs
    from public.whatsapp_templates w
   where w.tenant_id = p_tenant_id
     and w.provider  = p_provider
     and w.name      = v_name
     and (v_lang is null or w.language = v_lang);

  if v_n = 0 then
    return query select false, 'REFUSED_TEMPLATE_UNKNOWN'::text,
      format('This dealership holds no template called %L%s in NEXUS''s registry, so NEXUS can say nothing about whether the provider approved it. An unknown reference is not an approved one.',
             v_name, case when v_lang is null then '' else format(' in language %L', v_lang) end)::text,
      'Register the template and record the provider''s status for it with whatsapp_template_declare() and whatsapp_template_observe().'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::timestamptz,
      null::interval, p_max_status_age;
    return;
  end if;

  if v_n > 1 then
    return query select false, 'REFUSED_TEMPLATE_REF_AMBIGUOUS'::text,
      format('%s templates called %L exist for this dealership, in languages %s. NEXUS will not pick which language a customer receives.',
             v_n, v_name, v_langs)::text,
      format('Reference it as %s:<language>, for example %s:%s.', v_name, v_name, split_part(v_langs, ',', 1))::text,
      null::uuid, null::text, null::text, null::text, null::text, null::timestamptz,
      null::interval, p_max_status_age;
    return;
  end if;

  select w.* into t
    from public.whatsapp_templates w
   where w.tenant_id = p_tenant_id
     and w.provider  = p_provider
     and w.name      = v_name
     and (v_lang is null or w.language = v_lang);

  -- An approved template of the wrong category is still the wrong message. The
  -- policy engine said which category this send is allowed to be; a MARKETING
  -- template sent where UTILITY was required is a policy bypass carrying an
  -- approval that looks legitimate.
  if v_cat is not null and t.category <> v_cat then
    return query select false, 'REFUSED_TEMPLATE_CATEGORY_MISMATCH'::text,
      format('Template %s (%s) is a %s template, and the policy decision for this message requires a %s one.',
             t.name, t.language, t.category, v_cat)::text,
      format('Send a %s template, or change what is being sent. Recategorising the template with the provider is a decision about what this message really is, not a formality.', v_cat)::text,
      t.template_id, t.name, t.language, t.category, t.provider_status, t.provider_status_observed_at,
      (now() - t.provider_status_observed_at), p_max_status_age;
    return;
  end if;

  select * into s from public.whatsapp_template_sendability(t.template_id, p_max_status_age) v;

  return query select
    s.sendable,
    case when s.sendable then 'VERIFIED_APPROVED_AND_FRESH_ENOUGH' else s.verdict end::text,
    format('%s (%s / %s). %s', s.reason, s.reason_code, t.name || ':' || t.language, coalesce(s.what_would_change_it,''))::text,
    s.what_would_change_it,
    s.template_id, t.name, t.language, t.category,
    s.provider_status, s.provider_status_observed_at, s.status_age, s.max_status_age;
end;
$function$;

comment on function public.nexus_verify_template_ref(uuid,text,text,text,interval) is
  'Resolves a template reference (name, or name:language) against whatsapp_templates for this '
  'dealership and returns whatsapp_template_sendability''s verdict, plus a category check. Never '
  'returns "unverified but proceed": every answer is sendable true or false.';

revoke all on function public.nexus_verify_template_ref(uuid,text,text,text,interval) from anon, authenticated, public;
grant execute on function public.nexus_verify_template_ref(uuid,text,text,text,interval) to service_role;

-- ---------------------------------------------------------------------------

drop function if exists public.nexus_route_message(uuid,text,text,text,text,text,jsonb,text,text,text,timestamptz);

create function public.nexus_route_message(
  p_tenant_id                uuid,
  p_customer_external_id     text,
  p_intent                   text,
  p_send_form                text,
  p_message_body             text default null,
  p_template_ref             text default null,
  p_template_variables       jsonb default null,
  p_media_ref                text default null,
  p_media_mime               text default null,
  p_requested_by             text default null,
  p_as_of                    timestamptz default now(),
  p_max_template_status_age  interval default null)
returns setof nexus_send_directive_row
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_now       timestamptz := coalesce(p_as_of, now());
  v_cust      text := lower(btrim(coalesce(p_customer_external_id,'')));
  v_form      text := upper(btrim(coalesce(p_send_form,'')));
  v_intent    text := upper(btrim(coalesce(p_intent,'')));
  v_by        text := coalesce(nullif(btrim(coalesce(p_requested_by,'')),''), '(unattributed caller)');
  v_slug      text;
  v_formrec   record;
  v_pick      record;
  v_pol       record;
  v_tv        record;
  v_cap       record;
  v_eligible  integer := 0;
  v_total     integer := 0;
  v_tmplcap   text;
  r           public.nexus_send_directive_row;
begin
  if coalesce(current_setting('role', true), '') in ('authenticated','anon') then
    raise exception
      'nexus_route_message: refused for end-user role %. Outbound routing is a backend path.',
      current_setting('role', true) using errcode = '42501';
  end if;

  r.directive             := 'DO_NOT_SEND';
  r.tenant_id             := p_tenant_id;
  r.customer_external_id  := v_cust;
  r.intent                := v_intent;
  r.requested_send_form   := v_form;
  r.message_body          := p_message_body;
  r.template_ref          := nullif(btrim(coalesce(p_template_ref,'')),'');
  r.template_variables    := p_template_variables;
  r.media_ref             := p_media_ref;
  r.media_mime            := p_media_mime;
  r.candidates_considered := '[]'::jsonb;
  r.requested_by          := v_by;
  r.routed_at             := v_now;
  r.routed_by             := 'nexus_route_message v3 - template staleness gate wired';

  select t.slug into v_slug
    from public.tenants t
   where t.id = p_tenant_id and t.status = 'active';

  if not found then
    r.outcome := 'TENANT_UNRESOLVED'; r.reason_code := 'TENANT_UNRESOLVED';
    r.reason  := 'No active dealership resolves from the tenant supplied, so there is nobody on whose behalf this message could be sent.';
    r.what_would_change_it := 'Pass the id of an active row in public.tenants. An unresolved tenant is refused, never defaulted - a caller that can pick the dealership can pick whose customers get messaged.';
    return next r; return;
  end if;
  r.tenant_slug := v_slug;

  if v_cust = '' then
    r.outcome := 'CUSTOMER_IDENTITY_MISSING'; r.reason_code := 'CUSTOMER_IDENTITY_MISSING';
    r.reason  := 'No customer identity was supplied, so there is no conversation to send into.';
    r.what_would_change_it := 'Supply the customer identity exactly as the platform reports it (the wa id / chat id), not a display name and not a local phone format.';
    return next r; return;
  end if;

  select * into v_formrec from public.channel_send_form f where f.code = v_form;
  if not found then
    r.outcome := 'SEND_FORM_UNKNOWN'; r.reason_code := 'SEND_FORM_UNKNOWN';
    r.reason  := format('%L is not a send form NEXUS recognises, so no provider capability can be established for it.',
                        coalesce(nullif(v_form,''),'(empty)'));
    r.what_would_change_it := 'Call again with one of the codes in public.channel_send_form. An unknown shape is refused rather than attempted, because "try it and see" against a live customer number is how an account gets rate-limited.';
    return next r; return;
  end if;
  r.template_category_required := null;

  select c.state, c.absent_means into v_cap
    from public.nexus_resolve_tenant_capability(p_tenant_id, 'WHATSAPP_OUTBOUND') c;
  r.whatsapp_capability_state := coalesce(v_cap.state, 'NOT_AVAILABLE');
  r.whatsapp_capability_note  := case
    when coalesce(v_cap.state,'NOT_AVAILABLE') = 'AVAILABLE' then null
    else 'REPORTED, NOT ENFORCED: tenant_capability says WHATSAPP_OUTBOUND is '
         || coalesce(v_cap.state,'NOT_AVAILABLE')
         || ' for this dealership, while channel_registry holds an active channel. The registry is an audited operational fact and governs routing; the capability row is a product-surface statement and is currently unpopulated for every capability on this deployment. Someone should state it. Until they do, an unpopulated table is "nobody has said", not "it is forbidden".'
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'integration_id',           c.integration_id,
           'provider',                 c.provider,
           'channel_type',             c.channel_type,
           'external_identifier',      c.external_identifier,
           'provider_rank',            c.provider_rank,
           'is_official_platform',     c.is_official_platform,
           'capability',               c.support_state,
           'capability_basis',         c.capability_basis,
           'last_customer_message_at', c.last_customer_message_at,
           'eligible',                 c.eligible,
           'selection_order',          c.selection_order,
           'chosen',                   coalesce(c.eligible and c.selection_order = 1, false),
           'excluded_because',         c.excluded_because)
         order by c.eligible desc, c.selection_order nulls last, c.registered_at), '[]'::jsonb),
         count(*)::int,
         count(*) filter (where c.eligible)::int
    into r.candidates_considered, v_total, v_eligible
    from public.nexus_channel_send_candidates(p_tenant_id, v_form, v_cust) c;

  if v_total = 0 then
    r.outcome := 'NO_ACTIVE_INTEGRATION'; r.reason_code := 'NO_ACTIVE_INTEGRATION';
    r.reason  := format('%s has no active messaging integration registered, so there is no number this message could leave from. This is a clear refusal, not a failure.', v_slug);
    r.what_would_change_it := 'Register the dealership WhatsApp identity with public.nexus_register_channel(tenant_slug, channel_type, external_identifier, credential_ref, active). Until then no WhatsApp action should be offered to this dealership at all - which is exactly what tenant_capability_catalogue says WHATSAPP_OUTBOUND absent means.';
    return next r; return;
  end if;

  if v_eligible = 0 then
    r.outcome := 'PROVIDER_CANNOT_CARRY'; r.reason_code := 'PROVIDER_CANNOT_CARRY';
    r.reason  := format('%s has %s active integration(s), and none of them can carry a %s send. candidates_considered names each one and why. Note in particular that a WhatsApp message template is a WABA object and does not exist behind an unofficial transport - so a template request on a WAHA-only dealership lands here by design.',
                        v_slug, v_total, v_form);
    r.what_would_change_it := 'Either send a shape the registered provider can carry, or register an integration that can. For templates that means the official WhatsApp Cloud API. Pasting the template text into a free-form message on the unofficial transport is not the workaround; it is the bypass, and it is what gets the dealership own number banned.';
    return next r; return;
  end if;

  select * into v_pick
    from public.nexus_channel_send_candidates(p_tenant_id, v_form, v_cust) c
   where c.eligible and c.selection_order = 1;

  -- chanroute_09. If eligibility said there was a carrier and selection did not
  -- produce one, that is an internal inconsistency, and it is refused here
  -- rather than passed to the policy engine as a NULL integration.
  if not found or v_pick.integration_id is null then
    r.outcome := 'CARRIER_SELECTION_FAILED'; r.reason_code := 'CARRIER_SELECTION_FAILED';
    r.reason  := format('%s of %s active integrations were capable of a %s send, but the carrier order produced none. This is a NEXUS defect, not a dealership configuration problem, and nothing is sent while it stands.',
                        v_eligible, v_total, v_form);
    r.what_would_change_it := 'Nothing the dealership can do. Read candidates_considered and nexus_channel_send_candidates; the selection_order window is the place to look.';
    return next r; return;
  end if;

  r.integration_id       := v_pick.integration_id;
  r.provider             := v_pick.provider;
  r.channel_type         := v_pick.channel_type;
  r.external_identifier  := v_pick.external_identifier;
  r.credential_ref       := v_pick.credential_ref;
  r.capability_state     := v_pick.support_state;
  r.capability_basis     := v_pick.capability_basis;
  r.capability_evidence  := v_pick.capability_evidence;

  r.carrier_rule := case
    when v_pick.last_customer_message_at is not null then
      format('C1 conversation continuity. The customer last messaged this dealership on this integration (%s / %s) at %s, so the message leaves from the number they wrote to. %s',
             v_pick.provider, v_pick.external_identifier,
             to_char(v_pick.last_customer_message_at at time zone 'Asia/Dubai','DD Mon YYYY HH24:MI') || ' Asia/Dubai',
             case when v_eligible > 1 then format('%s capable integrations were available.', v_eligible)
                  else 'It was also the only capable integration.' end)
    when v_eligible > 1 then
      format('C2 official platform first. %s capable integrations were available and %s (rank %s, official platform: %s) was selected. This ordering is not economic: the official platform is the one that charges, and it is still first.',
             v_eligible, v_pick.provider, coalesce(v_pick.provider_rank::text,'unranked'),
             case when v_pick.is_official_platform then 'yes' else 'no' end)
    else
      format('Only one active integration (%s / %s) can carry this send form, so there was nothing to choose between. %s',
             v_pick.provider, v_pick.external_identifier,
             case when v_total > v_eligible
                  then format('%s other active integration(s) could not carry it; candidates_considered says why.', v_total - v_eligible)
                  else '' end)
  end;

  select * into v_pol
    from public.whatsapp_policy_decision(p_tenant_id, v_pick.integration_id, v_cust, v_intent, v_now);

  r.policy_decision                 := v_pol.decision;
  r.policy_reason_code              := v_pol.reason_code;
  r.policy_reason                   := v_pol.reason;
  r.policy_what_would_change_it     := v_pol.what_would_change_it;
  r.policy_applied_rule_id          := v_pol.applied_rule_id;
  r.policy_rule_verification_status := v_pol.applied_rule_verification_status;
  r.policy_window_state             := v_pol.window_state;
  r.policy_window_expires_at        := v_pol.window_expires_at;
  r.policy_evaluated_at             := v_pol.evaluated_at;
  r.template_category_required      := v_pol.template_category_if_required;

  select k.support_state into v_tmplcap
    from public.nexus_channel_capability_state(v_pick.provider, 'TEMPLATE_TEXT') k;

  if v_pol.decision = 'BLOCKED' then
    r.outcome := 'BLOCKED'; r.reason_code := v_pol.reason_code;
    r.reason  := v_pol.reason;
    r.what_would_change_it := v_pol.what_would_change_it;
    return next r; return;

  elsif v_pol.decision not in ('FREEFORM_ALLOWED','TEMPLATE_REQUIRED') then
    r.outcome := 'POLICY_DECISION_UNRECOGNISED'; r.reason_code := 'POLICY_DECISION_UNRECOGNISED';
    r.reason  := format('The policy engine returned %L, which this router does not recognise. It refuses rather than guessing which side of the line an unknown verdict falls on.',
                        coalesce(v_pol.decision,'(null)'));
    r.what_would_change_it := 'Whoever added a decision value to whatsapp_policy_decision must also teach nexus_route_message what it means. Failing closed here is deliberate.';
    return next r; return;
  end if;

  if v_pol.decision = 'TEMPLATE_REQUIRED' and not v_formrec.requires_template_ref then
    r.outcome := 'TEMPLATE_REQUIRED'; r.reason_code := v_pol.reason_code;
    r.reason  := v_pol.reason;
    r.what_would_change_it := v_pol.what_would_change_it
      || case when v_tmplcap = 'SUPPORTED'
              then format(' To send now, come back with send_form TEMPLATE_TEXT (or TEMPLATE_MEDIA_HEADER), a staleness tolerance, and an approved template of category %s.',
                          coalesce(v_pol.template_category_if_required,'UTILITY'))
              else format(' Note that the selected carrier (%s) cannot send templates at all, so on this integration there is no template to come back with: either the customer messages again and reopens the window, or the dealership registers an official WhatsApp Cloud API integration. Pasting template text into a free-form message here is the bypass, not the answer.',
                          v_pick.provider)
         end;
    return next r; return;
  end if;

  if v_formrec.requires_template_ref and r.template_ref is null then
    r.outcome := 'TEMPLATE_REF_MISSING'; r.reason_code := 'TEMPLATE_REF_MISSING';
    r.reason  := format('Send form %s is a template send and no template reference was supplied. NEXUS will not compose a body and call it a template.', v_form);
    r.what_would_change_it := format('Supply the name of a template approved on this dealership account, of category %s.',
                                     coalesce(v_pol.template_category_if_required,'UTILITY'));
    return next r; return;
  end if;

  if v_formrec.is_media and coalesce(btrim(coalesce(p_media_ref,'')),'') = '' then
    r.outcome := 'MEDIA_REF_MISSING'; r.reason_code := 'MEDIA_REF_MISSING';
    r.reason  := format('Send form %s carries media and no media reference was supplied.', v_form);
    r.what_would_change_it := 'Supply media_ref as a reference the sending workflow can resolve - a provider media id or an https URL. A data: URI is refused elsewhere in this schema and should not be sent here either.';
    return next r; return;
  end if;

  if not v_formrec.requires_template_ref and coalesce(btrim(coalesce(p_message_body,'')),'') = ''
     and not v_formrec.is_media then
    r.outcome := 'MESSAGE_BODY_MISSING'; r.reason_code := 'MESSAGE_BODY_MISSING';
    r.reason  := format('Send form %s carries a composed body and none was supplied.', v_form);
    r.what_would_change_it := 'Supply message_body. An empty body is refused rather than sent as an empty message.';
    return next r; return;
  end if;

  r.resolved_send_form := v_form;

  ------------------------------------------------------------------
  -- The template gate. directive stays DO_NOT_SEND until it passes.
  ------------------------------------------------------------------
  if v_formrec.requires_template_ref then
    r.message_body := null;

    -- Refuse for want of a tolerance rather than choosing one. The number is a
    -- statement about how much risk of sending on a withdrawn approval the
    -- caller accepts, and NEXUS is not the party that carries that risk.
    if p_max_template_status_age is null then
      r.outcome := 'TEMPLATE_NOT_SENDABLE';
      r.reason_code := 'STALENESS_TOLERANCE_NOT_STATED';
      r.template_verification := 'REFUSED_NO_TOLERANCE_STATED';
      r.template_verification_detail :=
        'No p_max_template_status_age was passed, so NEXUS has no answer to "how recently must the provider have confirmed this template?".';
      r.reason := 'A template send was requested without saying how old a provider approval the caller will rely on. NEXUS refuses rather than picking that number: an approval it has not re-checked recently enough is exactly how a template that Meta has since rejected or paused gets sent anyway.';
      r.what_would_change_it := 'Call again with p_max_template_status_age, for example ''24 hours''::interval or ''7 days''::interval. The tolerance is recorded with the routing decision so a later reader can see what was relied on.';
      return next r; return;
    end if;

    select * into v_tv
      from public.nexus_verify_template_ref(p_tenant_id, v_pick.provider, r.template_ref,
                                            coalesce(v_pol.template_category_if_required,'UTILITY'),
                                            p_max_template_status_age) v;

    r.template_verification := v_tv.verification;
    r.template_verification_detail := format('%s Tolerance stated: %s. Provider status: %s, observed %s (%s old).',
        v_tv.detail, p_max_template_status_age::text,
        coalesce(v_tv.provider_status,'unknown'),
        coalesce(v_tv.provider_status_observed_at::text,'never'),
        coalesce(v_tv.status_age::text,'not applicable'));

    if not v_tv.sendable then
      r.outcome     := 'TEMPLATE_NOT_SENDABLE';
      r.reason_code := v_tv.verification;
      r.reason      := v_tv.detail;
      r.what_would_change_it := coalesce(v_tv.what_would_change_it,
        'Re-observe the template''s status with the provider, or send a template NEXUS can vouch for.');
      return next r; return;
    end if;

    r.directive   := 'SEND';
    r.outcome     := 'SENDABLE_TEMPLATE';
    r.reason_code := v_pol.reason_code;
    r.reason      := format('Template send permitted on %s / %s. %s The template was checked: %s',
                            v_pick.provider, v_pick.external_identifier, v_pol.reason, v_tv.detail);
    r.what_would_change_it := format('A recorded opt-out makes this BLOCKED immediately, and the template''s approval goes stale against the stated tolerance of %s.',
                                     p_max_template_status_age::text);
  else
    r.directive   := 'SEND';
    r.outcome     := 'SENDABLE_FREEFORM';
    r.reason_code := v_pol.reason_code;
    r.reason      := format('Free-form send permitted on %s / %s. %s',
                            v_pick.provider, v_pick.external_identifier, v_pol.reason);
    r.what_would_change_it := v_pol.what_would_change_it;
  end if;

  return next r;
  return;
end;
$function$;

comment on function public.nexus_route_message(uuid,text,text,text,text,text,jsonb,text,text,text,timestamptz,interval) is
  'Chooses the carrier, asks the policy engine, and - for a template send - asks whether the template is '
  'actually sendable. A template send with no stated staleness tolerance is refused for want of one.';

revoke all on function public.nexus_route_message(uuid,text,text,text,text,text,jsonb,text,text,text,timestamptz,interval) from anon, authenticated, public;
grant execute on function public.nexus_route_message(uuid,text,text,text,text,text,jsonb,text,text,text,timestamptz,interval) to service_role;

-- ---------------------------------------------------------------------------

drop function if exists public.nexus_request_send(uuid,text,text,text,text,text,jsonb,text,text,text,text,timestamptz);

create function public.nexus_request_send(
  p_tenant_id               uuid,
  p_customer_external_id    text,
  p_intent                  text,
  p_send_form               text,
  p_message_body            text default null,
  p_template_ref            text default null,
  p_template_variables      jsonb default null,
  p_media_ref               text default null,
  p_media_mime              text default null,
  p_requested_by            text default null,
  p_request_ref             text default null,
  p_as_of                   timestamptz default now(),
  p_max_template_status_age interval default null)
returns table(directive_id uuid, ledger_state text, result nexus_send_directive_row)
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_ref  text := nullif(btrim(coalesce(p_request_ref,'')),'');
  v_by   text := coalesce(nullif(btrim(coalesce(p_requested_by,'')),''), '(unattributed caller)');
  v_prev public.channel_send_directive%rowtype;
  r      public.nexus_send_directive_row;
  v_id   uuid;
begin
  if coalesce(current_setting('role', true), '') in ('authenticated','anon') then
    raise exception
      'nexus_request_send: refused for end-user role %. Outbound sends are a backend path.',
      current_setting('role', true) using errcode = '42501';
  end if;

  -- Idempotency. n8n retries; a retried send request must not become a second
  -- customer message, and must not re-route (the window may have moved under it).
  if v_ref is not null then
    select * into v_prev
      from public.channel_send_directive d
     where d.tenant_id = p_tenant_id and d.requested_by = v_by and d.request_ref = v_ref;
    if found then
      r.directive := v_prev.directive;                     r.outcome := v_prev.outcome;
      r.reason_code := v_prev.reason_code;                 r.reason := v_prev.reason;
      r.what_would_change_it := v_prev.what_would_change_it;
      r.tenant_id := v_prev.tenant_id;                     r.tenant_slug := v_prev.tenant_slug;
      r.customer_external_id := v_prev.customer_external_id;
      r.intent := v_prev.intent;                           r.requested_send_form := v_prev.requested_send_form;
      r.integration_id := v_prev.integration_id;           r.provider := v_prev.provider;
      r.channel_type := v_prev.channel_type;               r.external_identifier := v_prev.external_identifier;
      r.credential_ref := v_prev.credential_ref;           r.carrier_rule := v_prev.carrier_rule;
      r.candidates_considered := v_prev.candidates_considered;
      r.resolved_send_form := v_prev.resolved_send_form;   r.message_body := v_prev.message_body;
      r.template_ref := v_prev.template_ref;               r.template_variables := v_prev.template_variables;
      r.template_category_required := v_prev.template_category_required;
      r.template_verification := v_prev.template_verification;
      r.template_verification_detail := v_prev.template_verification_detail;
      r.media_ref := v_prev.media_ref;                     r.media_mime := v_prev.media_mime;
      r.policy_decision := v_prev.policy_decision;         r.policy_reason_code := v_prev.policy_reason_code;
      r.policy_reason := v_prev.policy_reason;
      r.policy_what_would_change_it := v_prev.policy_what_would_change_it;
      r.policy_applied_rule_id := v_prev.policy_applied_rule_id;
      r.policy_rule_verification_status := v_prev.policy_rule_verification_status;
      r.policy_window_state := v_prev.policy_window_state;
      r.policy_window_expires_at := v_prev.policy_window_expires_at;
      r.policy_evaluated_at := v_prev.policy_evaluated_at;
      r.capability_state := v_prev.capability_state;       r.capability_basis := v_prev.capability_basis;
      r.capability_evidence := v_prev.capability_evidence;
      r.whatsapp_capability_state := v_prev.whatsapp_capability_state;
      r.whatsapp_capability_note := v_prev.whatsapp_capability_note;
      r.requested_by := v_prev.requested_by;               r.routed_at := v_prev.routed_at;
      r.routed_by := v_prev.routed_by;
      return query select v_prev.directive_id,
                          'ALREADY_ROUTED_UNDER_THIS_REQUEST_REF'::text,
                          r;
      return;
    end if;
  end if;

  select * into r
    from public.nexus_route_message(p_tenant_id, p_customer_external_id, p_intent, p_send_form,
                                    p_message_body, p_template_ref, p_template_variables,
                                    p_media_ref, p_media_mime, v_by, p_as_of,
                                    p_max_template_status_age);

  -- A dealership that does not resolve has no tenant_id to file a row under,
  -- and NEXUS does not file tenant-scoped rows under a guessed dealership.
  if r.tenant_id is null or r.tenant_slug is null then
    return query select null::uuid, 'NOT_RECORDED_TENANT_UNRESOLVED'::text, r;
    return;
  end if;

  insert into public.channel_send_directive (
    tenant_id, tenant_slug, requested_by, request_ref, customer_external_id, intent,
    requested_send_form, directive, outcome, reason_code, reason, what_would_change_it,
    integration_id, provider, channel_type, external_identifier, credential_ref,
    carrier_rule, candidates_considered, resolved_send_form, message_body,
    template_ref, template_variables, template_category_required,
    template_verification, template_verification_detail, media_ref, media_mime,
    policy_decision, policy_reason_code, policy_reason, policy_what_would_change_it,
    policy_applied_rule_id, policy_rule_verification_status, policy_window_state,
    policy_window_expires_at, policy_evaluated_at,
    capability_state, capability_basis, capability_evidence,
    whatsapp_capability_state, whatsapp_capability_note,
    routed_at, routed_by,
    send_result)
  values (
    r.tenant_id, r.tenant_slug, r.requested_by, v_ref, r.customer_external_id, r.intent,
    r.requested_send_form, r.directive, r.outcome, r.reason_code, r.reason, r.what_would_change_it,
    r.integration_id, r.provider, r.channel_type, r.external_identifier, r.credential_ref,
    r.carrier_rule, r.candidates_considered, r.resolved_send_form, r.message_body,
    r.template_ref, r.template_variables, r.template_category_required,
    r.template_verification, r.template_verification_detail, r.media_ref, r.media_mime,
    r.policy_decision, r.policy_reason_code, r.policy_reason, r.policy_what_would_change_it,
    r.policy_applied_rule_id, r.policy_rule_verification_status, r.policy_window_state,
    r.policy_window_expires_at, r.policy_evaluated_at,
    r.capability_state, r.capability_basis, r.capability_evidence,
    r.whatsapp_capability_state, r.whatsapp_capability_note,
    r.routed_at, r.routed_by,
    case when r.directive = 'SEND' then 'PENDING' else 'NOT_ATTEMPTED' end)
  returning public.channel_send_directive.directive_id into v_id;

  return query select v_id,
                      case when r.directive = 'SEND' then 'RECORDED_AWAITING_TRANSPORT'
                           else 'RECORDED_REFUSAL' end::text,
                      r;
end;
$function$;

comment on function public.nexus_request_send(uuid,text,text,text,text,text,jsonb,text,text,text,text,timestamptz,interval) is
  'Routes a send and records the directive. p_max_template_status_age is passed through to the template '
  'staleness gate and is recorded in template_verification_detail on channel_send_directive.';

revoke all on function public.nexus_request_send(uuid,text,text,text,text,text,jsonb,text,text,text,text,timestamptz,interval) from anon, authenticated, public;
grant execute on function public.nexus_request_send(uuid,text,text,text,text,text,jsonb,text,text,text,text,timestamptz,interval) to service_role;