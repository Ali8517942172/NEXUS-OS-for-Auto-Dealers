create or replace function public.nexus_route_message(
  p_tenant_id            uuid,
  p_customer_external_id text,
  p_intent               text,
  p_send_form            text,
  p_message_body         text        default null,
  p_template_ref         text        default null,
  p_template_variables   jsonb       default null,
  p_media_ref            text        default null,
  p_media_mime           text        default null,
  p_requested_by         text        default null,
  p_as_of                timestamptz default now()
) returns setof public.nexus_send_directive_row
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $fn$
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
  ---------------------------------------------------------------------------
  -- Who may ask. A signed-in end user never routes a customer message; the
  -- backend does. This mirrors nexus_record_channel_event and is defence in
  -- depth behind the EXECUTE revoke in chanroute_07 - CLAUDE.md history is
  -- that a later CREATE OR REPLACE or a platform default privilege re-opens a
  -- grant with no grant-shaped diff to review.
  ---------------------------------------------------------------------------
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
  r.routed_by             := 'nexus_route_message v1';

  ---------------------------------------------------------------------------
  -- 1. Whose dealership.
  ---------------------------------------------------------------------------
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

  ---------------------------------------------------------------------------
  -- 2. What shape of message. An unrecognised shape is refused, not guessed.
  ---------------------------------------------------------------------------
  select * into v_formrec from public.channel_send_form f where f.code = v_form;
  if not found then
    r.outcome := 'SEND_FORM_UNKNOWN'; r.reason_code := 'SEND_FORM_UNKNOWN';
    r.reason  := format('%L is not a send form NEXUS recognises, so no provider capability can be established for it.',
                        coalesce(nullif(v_form,''),'(empty)'));
    r.what_would_change_it := 'Call again with one of the codes in public.channel_send_form. An unknown shape is refused rather than attempted, because "try it and see" against a live customer number is how an account gets rate-limited.';
    return next r; return;
  end if;
  r.template_category_required := null;

  -- Reported, deliberately NOT a gate. See the note at the foot of this function.
  select c.state, c.absent_means into v_cap
    from public.nexus_resolve_tenant_capability(p_tenant_id, 'WHATSAPP_OUTBOUND') c;
  r.whatsapp_capability_state := coalesce(v_cap.state, 'NOT_AVAILABLE');
  r.whatsapp_capability_note  := case
    when coalesce(v_cap.state,'NOT_AVAILABLE') = 'AVAILABLE' then null
    else 'REPORTED, NOT ENFORCED: tenant_capability says WHATSAPP_OUTBOUND is '
         || coalesce(v_cap.state,'NOT_AVAILABLE')
         || ' for this dealership, while channel_registry holds an active channel. The registry is an audited operational fact and governs routing; the capability row is a product-surface statement and is currently unpopulated for every capability on this deployment. Someone should state it. Until they do, an unpopulated table is "nobody has said", not "it is forbidden".'
  end;

  ---------------------------------------------------------------------------
  -- 3. Which integrations the dealership actually has, and which of them can
  --    carry this shape. Selection happens on registration and capability -
  --    never on price, and never on which one the policy engine would be
  --    kinder about.
  ---------------------------------------------------------------------------
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
           'chosen',                   coalesce(c.selection_order = 1, false),
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
   where c.selection_order = 1;

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
      format('Only one active integration (%s / %s) can carry this send form, so there was nothing to choose between.',
             v_pick.provider, v_pick.external_identifier)
  end;

  ---------------------------------------------------------------------------
  -- 4. THE POLICY DECISION. The router derives it here, from the policy
  --    engine, for the integration it has just selected. There is no argument
  --    by which a caller can hand in a decision, so there is nothing for a
  --    caller to lie about - which is a stronger guarantee than validating a
  --    supplied one would have been.
  ---------------------------------------------------------------------------
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

  ---------------------------------------------------------------------------
  -- 5. Map the decision onto a directive. BLOCKED and TEMPLATE_REQUIRED are
  --    OUTCOMES. Nothing here raises, and nothing here retries: an engine that
  --    asks to message an opted-out customer has not malfunctioned, and a
  --    retry loop wrapped around a compliance refusal would turn one refusal
  --    into many.
  ---------------------------------------------------------------------------
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

  ---------------------------------------------------------------------------
  -- 6. The caller asked for a free-form shape but the window is shut.
  ---------------------------------------------------------------------------
  if v_pol.decision = 'TEMPLATE_REQUIRED' and not v_formrec.requires_template_ref then
    r.outcome := 'TEMPLATE_REQUIRED'; r.reason_code := v_pol.reason_code;
    r.reason  := v_pol.reason;
    r.what_would_change_it := v_pol.what_would_change_it
      || case when v_tmplcap = 'SUPPORTED'
              then format(' To send now, come back with send_form TEMPLATE_TEXT (or TEMPLATE_MEDIA_HEADER) and an approved template of category %s.',
                          coalesce(v_pol.template_category_if_required,'UTILITY'))
              else format(' Note that the selected carrier (%s) cannot send templates at all, so on this integration there is no template to come back with: either the customer messages again and reopens the window, or the dealership registers an official WhatsApp Cloud API integration. Pasting template text into a free-form message here is the bypass, not the answer.',
                          v_pick.provider)
         end;
    return next r; return;
  end if;

  ---------------------------------------------------------------------------
  -- 7. A template send needs a template reference.
  ---------------------------------------------------------------------------
  if v_formrec.requires_template_ref and r.template_ref is null then
    r.outcome := 'TEMPLATE_REF_MISSING'; r.reason_code := 'TEMPLATE_REF_MISSING';
    r.reason  := format('Send form %s is a template send and no template reference was supplied. NEXUS will not compose a body and call it a template.', v_form);
    r.what_would_change_it := format('Supply the name of a template approved on this dealership account, of category %s.',
                                     coalesce(v_pol.template_category_if_required,'UTILITY'));
    return next r; return;
  end if;

  ---------------------------------------------------------------------------
  -- 8. Content has to exist.
  ---------------------------------------------------------------------------
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

  ---------------------------------------------------------------------------
  -- 9. Sendable. Note what is true at this point and cannot be otherwise:
  --    a policy decision exists, it was derived here rather than supplied,
  --    and it was derived for THIS integration.
  ---------------------------------------------------------------------------
  r.resolved_send_form := v_form;
  r.directive          := 'SEND';

  if v_formrec.requires_template_ref then
    select v.verification, v.detail into v_tv
      from public.nexus_verify_template_ref(p_tenant_id, v_pick.provider, r.template_ref,
                                            coalesce(v_pol.template_category_if_required,'UTILITY')) v;
    r.template_verification        := v_tv.verification;
    r.template_verification_detail := v_tv.detail;
    r.message_body                 := null;   -- a template body comes from the approved template, never from the caller
    r.outcome     := 'SENDABLE_TEMPLATE';
    r.reason_code := v_pol.reason_code;
    r.reason      := format('Template send permitted on %s / %s. %s',
                            v_pick.provider, v_pick.external_identifier, v_pol.reason);
    r.what_would_change_it := format('A recorded opt-out makes this BLOCKED immediately. %s', coalesce(v_tv.detail,''));
  else
    r.outcome     := 'SENDABLE_FREEFORM';
    r.reason_code := v_pol.reason_code;
    r.reason      := format('Free-form send permitted on %s / %s. %s',
                            v_pick.provider, v_pick.external_identifier, v_pol.reason);
    r.what_would_change_it := v_pol.what_would_change_it;
  end if;

  return next r;
  return;
end;
$fn$;

comment on function public.nexus_route_message(uuid,text,text,text,text,text,jsonb,text,text,text,timestamptz) is
$c$THE ONE SEND INTERFACE. Every NEXUS engine that wants to message a customer
calls this and nothing else. No engine knows, or is allowed to know, which
WhatsApp provider carries its message.

THE GOLDEN RULE.
  The router never selects a provider on cost. It selects on three things and
  only these three:
    (1) which integrations the dealership has registered and left active,
    (2) what the policy decision permits on the integration it selected,
    (3) which provider is actually able to carry that shape of message.
  Using an unofficial transport to avoid an official platform charges or
  controls is a policy bypass, not an optimisation. The number it puts at risk
  is the DEALERSHIP OWN business number - the line the sales floor answers -
  not a number NEXUS owns. If you are here to add a branch that picks the
  cheaper provider, or a fallback that retries on the cheaper provider when the
  official one refuses or costs, you are adding the defect this component
  exists to prevent. Do not. channel_provider_rank has no cost column for the
  same reason, and it must never acquire one.

WHY THERE IS NO decision ARGUMENT.
  The brief allowed two designs: take the caller policy decision and re-derive
  it to check the caller is not lying, or ignore the caller and derive it here.
  This is the second, for three reasons.
    - Re-deriving to check costs exactly what deriving costs, because it is the
      same STABLE call. The "faster" option is only faster if it TRUSTS the
      supplied decision, and that is a third design nobody asked for and nobody
      should ship: the decision is a function of measured state (the service
      window, the opt-in ledger) that can change between the caller call and
      this one, and a passed decision carries no timestamp anyone checks and no
      signature anyone verifies.
    - A decision is meaningless until the carrier is known. The service window
      is per (tenant, integration, customer). A decision the caller derived for
      a different integration is not stale, it is about a different
      conversation. The router cannot even know which integration to check the
      caller decision against until step 3 has run.
    - Not offering the argument is a stronger guarantee than validating it.
      There is no parameter to lie in, so no validation to get wrong later.
  The cost is one extra STABLE call per send. That is the right trade.

WHY THERE IS NO RE-SELECTION.
  Carrier selection (step 3) happens before the policy decision (step 4) and is
  never revisited. If the selected carrier decision is TEMPLATE_REQUIRED or
  BLOCKED, the router returns that. It does NOT loop back and look for an
  integration on which the policy engine would have been kinder. Shopping for a
  permissive verdict is the same bypass as shopping for a cheap one, and it is
  prevented structurally: there is no loop in this function.

BLOCKED AND TEMPLATE_REQUIRED ARE OUTCOMES, NOT ERRORS.
  Nothing in step 5 onward raises, and nothing retries. They are returned as
  directive = DO_NOT_SEND with an outcome, a reason, and what would change it,
  and nexus_request_send records them. An engine asking to message an opted-out
  customer has not malfunctioned; wrapping a retry around a compliance refusal
  would turn one refusal into several.

IT DOES NOT SEND.
  It returns what to send, through which integration, and with which credential
  REFERENCE. The HTTP call belongs in n8n, where the credentials live. Nothing
  in this function or in channel_send_directive ever holds a secret; the
  csd_credential_ref_is_not_a_secret constraint enforces that on the ledger.

WHAT IS REPORTED BUT NOT ENFORCED.
  tenant_capability WHATSAPP_OUTBOUND is returned on every row and is NOT a
  gate. tenant_capability holds zero rows on this deployment - for every
  capability, not just this one - so gating on it would take the one proven
  live customer path off the air on the strength of a table nobody has filled
  in. That is the incidental-lock anti-pattern CLAUDE.md names. channel_registry
  is the audited operational fact and governs routing; the divergence is
  surfaced in whatsapp_capability_note so it cannot be quietly ignored.

STABLE, AND WRITES NOTHING.
  Call it for a preview or a dry run as often as you like. nexus_request_send
  is the volatile wrapper that records the answer.$c$;

revoke all on function public.nexus_route_message(uuid,text,text,text,text,text,jsonb,text,text,text,timestamptz) from anon, authenticated, public;
grant execute on function public.nexus_route_message(uuid,text,text,text,text,text,jsonb,text,text,text,timestamptz) to service_role;