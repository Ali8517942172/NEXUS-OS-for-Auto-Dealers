-- An actor is not part of a business event's identity. Two n8n nodes retrying the
-- same logical send under different names are one send, not two.
drop index if exists public.channel_send_directive_request_ref_key;
create unique index channel_send_directive_request_ref_key
  on public.channel_send_directive (tenant_id, request_ref)
  where request_ref is not null;

create or replace function public.nexus_request_send(
  p_tenant_id uuid, p_customer_external_id text, p_intent text, p_send_form text,
  p_message_body text default null, p_template_ref text default null,
  p_template_variables jsonb default null, p_media_ref text default null,
  p_media_mime text default null, p_requested_by text default null,
  p_request_ref text default null, p_as_of timestamptz default now(),
  p_max_template_status_age interval default null)
returns table(directive_id uuid, ledger_state text, result nexus_send_directive_row)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
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

  -- A send with no request_ref is a send NEXUS cannot deduplicate. On a deployment
  -- already observed delivering the same inbound message twice, silently unkeyed is
  -- worse than a refusal: the caller learns nothing and the customer gets two
  -- messages. Refuse, and say what to pass.
  if v_ref is null then
    raise exception using errcode = '22023',
      message = 'A send request must carry a request_ref. Without one this router cannot tell a retry from a second message.',
      detail  = 'NEXUS_SEND_REQUEST_REF_REQUIRED',
      hint    = 'Pass a ref that is stable across retries of the same logical send and unique across different ones -- the inbound message id, the workflow execution id plus a step name, or a deal/action id. Do not pass a UUID generated at call time: that is a new ref on every retry and is the same as passing none.';
  end if;

  -- Idempotency. n8n retries; a retried send request must not become a second
  -- customer message, and must not re-route (the window may have moved under it).
  -- The key is the business event: (dealership, request_ref). Who asked is recorded
  -- on the row but is not part of its identity -- an actor never is.
  select * into v_prev
    from public.channel_send_directive d
   where d.tenant_id = p_tenant_id and d.request_ref = v_ref;

  if not found then
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

    begin
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
      return;
    exception when unique_violation then
      -- A concurrent backend filed this same request_ref between our lookup and our
      -- insert. That is the race the key exists to lose safely: fall through and
      -- return their directive rather than raising at a caller who did nothing wrong.
      select * into v_prev
        from public.channel_send_directive d
       where d.tenant_id = p_tenant_id and d.request_ref = v_ref;
    end;
  end if;

  -- A ref already spent on a different customer is a caller defect, not a retry.
  -- Returning the first directive would answer a question nobody asked; sending
  -- would put one customer's message in front of another.
  if v_prev.customer_external_id is distinct from p_customer_external_id then
    raise exception using errcode = '55000',
      message = format('request_ref %L is already recorded against customer %L on this dealership and is now being offered for %L. A request_ref names one send; reusing it for another is not a retry.',
                       v_ref, v_prev.customer_external_id, p_customer_external_id),
      detail  = 'NEXUS_REQUEST_REF_REUSED_FOR_A_DIFFERENT_CUSTOMER',
      hint    = 'Use a ref derived from the thing being sent about -- the inbound message id, or the action id -- so that two different sends can never collide on it.';
  end if;

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
end;
$function$;