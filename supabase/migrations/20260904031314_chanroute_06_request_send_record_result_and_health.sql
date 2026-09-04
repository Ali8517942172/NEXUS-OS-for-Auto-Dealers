-- chanroute_06_request_send_record_result_and_health

alter table public.channel_send_directive
  add column if not exists tenant_slug                  text,
  add column if not exists policy_reason                text,
  add column if not exists policy_what_would_change_it  text,
  add column if not exists policy_window_expires_at     timestamptz,
  add column if not exists capability_evidence          text,
  add column if not exists whatsapp_capability_note     text,
  add column if not exists template_verification_detail text;

create index if not exists channel_send_directive_provider_msg_idx
  on public.channel_send_directive (provider_message_id) where provider_message_id is not null;

comment on column public.channel_send_directive.provider_message_id is
  'The id the provider returned for an accepted send. This is the join key a delivery-event feed would use. NOTE: outbound sends are NOT written to public.channel_message_events. That table carries channel_message_events_cloud_requires_signature, which demands origin_verified = hmac_sha256_x_hub for every whatsapp_cloud row - correct for an inbound webhook, impossible for an outbound call we made ourselves. Recording waha outbound there while whatsapp_cloud outbound is structurally refused would produce a lopsided record that reads as "we never sent on Cloud". So this ledger is the outbound record until that constraint is amended by whoever owns it.';


-- ---------------------------------------------------------------------------
-- The volatile wrapper. This is what n8n calls. It routes, records, and hands
-- back a directive id to write the result against.
-- ---------------------------------------------------------------------------
create or replace function public.nexus_request_send(
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
  p_request_ref          text        default null,
  p_as_of                timestamptz default now()
) returns table (
  directive_id uuid,
  ledger_state text,
  result       public.nexus_send_directive_row
)
language plpgsql
volatile
security definer
set search_path to 'public','pg_catalog'
as $fn$
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
                                    p_media_ref, p_media_mime, v_by, p_as_of);

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
$fn$;

comment on function public.nexus_request_send(uuid,text,text,text,text,text,jsonb,text,text,text,text,timestamptz) is
$c$The volatile face of the provider router: routes, records, and returns the
directive id. This is what n8n calls.

It never performs the HTTP call. It hands back what to send, through which
integration, and with which credential REFERENCE; the credential itself is
resolved in n8n, where credentials live.

A refusal (BLOCKED, TEMPLATE_REQUIRED, NO_ACTIVE_INTEGRATION, ...) is recorded
with send_result = NOT_ATTEMPTED and returned as ledger_state RECORDED_REFUSAL.
It is not an exception and n8n must not retry it.

Pass p_request_ref. It is the idempotency handle: a repeated request under the
same (tenant, requested_by, request_ref) returns the ORIGINAL directive rather
than routing again. Re-routing on a retry would be wrong twice over - it could
send the customer a second message, and it would re-evaluate the service window
against a clock that has moved, so a retry of a permitted send could silently
become a refusal, or the reverse.$c$;


-- ---------------------------------------------------------------------------
-- Write-back from n8n.
-- ---------------------------------------------------------------------------
create or replace function public.nexus_record_send_result(
  p_directive_id        uuid,
  p_result              text,
  p_provider_message_id text default null,
  p_error_code          text default null,
  p_error_detail        text default null
) returns table (
  directive_id uuid,
  send_result  text,
  state        text,
  note         text
)
language plpgsql
volatile
security definer
set search_path to 'public','pg_catalog'
as $fn$
declare
  v_row public.channel_send_directive%rowtype;
  v_res text := upper(btrim(coalesce(p_result,'')));
  v_mid text := nullif(btrim(coalesce(p_provider_message_id,'')),'');
begin
  if coalesce(current_setting('role', true), '') in ('authenticated','anon') then
    raise exception 'nexus_record_send_result: refused for end-user role %.',
      current_setting('role', true) using errcode = '42501';
  end if;

  select * into v_row from public.channel_send_directive d where d.directive_id = p_directive_id;
  if not found then
    raise exception 'nexus_record_send_result: directive % does not exist. A result is recorded against a directive this router issued, never against a free-floating id.',
      p_directive_id using errcode = '23503';
  end if;

  if v_res not in ('ACCEPTED_BY_PROVIDER','REJECTED_BY_PROVIDER','TRANSPORT_ERROR','NOT_ATTEMPTED') then
    raise exception 'nexus_record_send_result: % is not a result this ledger records.', coalesce(nullif(v_res,''),'(empty)')
      using errcode = '22023';
  end if;

  if v_row.directive <> 'SEND' and v_res <> 'NOT_ATTEMPTED' then
    raise exception 'nexus_record_send_result: directive % was DO_NOT_SEND (%). A refusal cannot acquire a provider result; if a message went out anyway, that is a workflow defect and must not be laundered through this ledger.',
      p_directive_id, v_row.outcome using errcode = '42501';
  end if;

  if v_row.send_result <> 'PENDING' then
    if v_row.send_result = v_res and coalesce(v_row.provider_message_id,'') = coalesce(v_mid,'') then
      return query select v_row.directive_id, v_row.send_result, 'ALREADY_RECORDED'::text,
        'The same result was already recorded against this directive. This is a retry, and it changed nothing.'::text;
      return;
    end if;
    raise exception 'nexus_record_send_result: directive % already carries result % and is being told %. A conflicting second result is not overwritten - it means two transports acted on one directive, which is exactly the doubled-sender shape already observed on this deployment.',
      p_directive_id, v_row.send_result, v_res using errcode = '55000';
  end if;

  if v_res = 'ACCEPTED_BY_PROVIDER' and v_mid is null then
    raise exception 'nexus_record_send_result: ACCEPTED_BY_PROVIDER requires the provider message id. Without it there is nothing to reconcile a delivery event against, and "accepted" becomes an unfalsifiable claim.'
      using errcode = '22023';
  end if;

  update public.channel_send_directive d
     set send_result           = v_res,
         provider_message_id   = v_mid,
         provider_error_code   = nullif(btrim(coalesce(p_error_code,'')),''),
         provider_error_detail = nullif(btrim(coalesce(p_error_detail,'')),''),
         result_recorded_at    = now()
   where d.directive_id = p_directive_id;

  return query select p_directive_id, v_res, 'RECORDED'::text,
    case v_res
      when 'ACCEPTED_BY_PROVIDER' then 'The provider accepted the message. Accepted is not delivered and is not read; no screen may say otherwise until a delivery feed exists.'
      when 'REJECTED_BY_PROVIDER' then 'The provider refused the message. The error is recorded verbatim; do not retry a policy rejection as if it were a transport failure.'
      when 'TRANSPORT_ERROR'      then 'The call did not complete. Whether the provider saw it is UNKNOWN - not "it was not sent". Re-send only under the same request_ref, so idempotency decides.'
      else 'Recorded as not attempted.'
    end::text;
end;
$fn$;

comment on function public.nexus_record_send_result(uuid,text,text,text,text) is
  'What n8n writes back after the provider call. It refuses to attach a provider result to a DO_NOT_SEND directive, refuses a second conflicting result on one directive, and requires a provider message id before it will record ACCEPTED_BY_PROVIDER.';


-- ---------------------------------------------------------------------------
-- Health, as a REPORT ONLY. Read the comment: this view is not an input to
-- routing, and building a health model is deliberately deferred.
-- ---------------------------------------------------------------------------
create or replace view public.v_channel_send_health
with (security_invoker = true) as
select d.tenant_id,
       d.integration_id,
       d.provider,
       d.external_identifier,
       count(*) filter (where d.routed_at > now() - interval '7 days')                                     as routed_7d,
       count(*) filter (where d.routed_at > now() - interval '7 days' and d.directive = 'SEND')            as sends_7d,
       count(*) filter (where d.routed_at > now() - interval '7 days' and d.send_result = 'ACCEPTED_BY_PROVIDER') as accepted_7d,
       count(*) filter (where d.routed_at > now() - interval '7 days' and d.send_result = 'REJECTED_BY_PROVIDER') as rejected_7d,
       count(*) filter (where d.routed_at > now() - interval '7 days' and d.send_result = 'TRANSPORT_ERROR')      as transport_errors_7d,
       count(*) filter (where d.send_result = 'PENDING')                                                   as pending_now,
       max(d.result_recorded_at) filter (where d.send_result = 'ACCEPTED_BY_PROVIDER')                     as last_accepted_at,
       max(d.result_recorded_at) filter (where d.send_result in ('REJECTED_BY_PROVIDER','TRANSPORT_ERROR')) as last_failed_at,
       case
         when count(*) filter (where d.routed_at > now() - interval '7 days' and d.directive = 'SEND') = 0
           then 'NO_SENDS_MEASURED'
         when count(*) filter (where d.routed_at > now() - interval '7 days' and d.send_result = 'ACCEPTED_BY_PROVIDER') = 0
           then 'PRODUCING_NOTHING'
         when count(*) filter (where d.routed_at > now() - interval '7 days' and d.send_result in ('REJECTED_BY_PROVIDER','TRANSPORT_ERROR'))
              > count(*) filter (where d.routed_at > now() - interval '7 days' and d.send_result = 'ACCEPTED_BY_PROVIDER')
           then 'DEGRADED'
         else 'CARRYING'
       end as observed_state
  from public.channel_send_directive d
 group by d.tenant_id, d.integration_id, d.provider, d.external_identifier;

comment on view public.v_channel_send_health is
$c$DESCRIPTIVE ONLY. nexus_route_message does not read this view, and no
provider health signal is an input to carrier selection. That is a decision,
not an omission.

Why no health model yet:
  1. There is one active integration on this deployment. With one carrier,
     "the provider is down" and "the send failed" are the same event, and the
     failure is already recorded on the directive.
  2. A health model is really a staleness model, and a stale UP is worse than
     no health at all - it routes onto a dead carrier with false confidence.
     This codebase has the receipts: silence_detector_state reads STALE for
     every lead because its feeder stopped, and v_competitor_latest resolves 6
     of 14 rows. Unknown is not none, and it is not up either.
  3. Most important: the only thing a health signal could change is a FAILOVER,
     and failover ACROSS providers is precisely what the golden rule forbids.
     If the Cloud API is down, the correct behaviour is to queue and retry on
     the Cloud API - not to drop the traffic onto the unofficial transport,
     which is the bypass wearing a reliability costume. Within one provider
     (do not hammer an endpoint returning 500) the right home for that logic is
     the n8n retry policy, not the routing decision.

The trigger for building one, stated so the next person does not have to guess:
  (a) a dealership holds two active integrations of the SAME provider - two
      Cloud phone numbers on one WABA, say. Failover between those is
      within-provider and is not a bypass, and only then does a health signal
      have a legitimate choice to make; or
  (b) observed_state reads DEGRADED or PRODUCING_NOTHING on an integration that
      is not the dealership only one, for long enough that a human would have
      switched it off by hand.
Both are answerable from this view with no new table, which is the second
reason not to build one yet.$c$;

revoke all on function public.nexus_request_send(uuid,text,text,text,text,text,jsonb,text,text,text,text,timestamptz) from anon, authenticated, public;
revoke all on function public.nexus_record_send_result(uuid,text,text,text,text) from anon, authenticated, public;
revoke all on public.v_channel_send_health from anon, authenticated, public;
grant execute on function public.nexus_request_send(uuid,text,text,text,text,text,jsonb,text,text,text,text,timestamptz) to service_role;
grant execute on function public.nexus_record_send_result(uuid,text,text,text,text) to service_role;
grant select on public.v_channel_send_health to service_role;