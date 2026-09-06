-- chanroute_09_rank_only_capable_candidates_and_refuse_a_null_carrier
--
-- Found by a rolled-back probe on staging, 4 Sep 2026. Two defects, one cause.
--
-- WHAT WAS WRONG. In chanroute_04, selection_order was
--     case when <eligible> then row_number() over (order by ...) end
-- The CASE blanks the VALUE for an ineligible row, but row_number() still
-- COUNTS that row. So with a dealership holding an active WAHA session the
-- customer had written to, and an active Cloud integration:
--
--   TEMPLATE_TEXT send  ->  waha is NOT capable, but it sorts first on C1
--                           (it has the conversation), so it consumed
--                           row_number 1;
--                           whatsapp_cloud - the only capable carrier -
--                           received selection_order 2.
--
-- nexus_route_message then found no row at selection_order = 1, v_pick came
-- back all-NULL, and it called whatsapp_policy_decision with a NULL
-- integration. That returned BLOCKED / CHANNEL_NOT_REGISTERED_TO_TENANT.
--
-- The consequences, in order of seriousness:
--   1. A legitimate template send on the official platform was impossible for
--      any customer whose conversation happened to be on the WAHA number -
--      which is every customer today. The dealership would have been told the
--      channel was not registered, and the message would have been the
--      unofficial transport's problem or nobody's.
--   2. The refusal named the wrong reason. "The channel is not registered to
--      that dealership" is a tenancy alarm; the truth was an internal ranking
--      bug. A wrong reason on a refusal is worse than a vague one, because
--      somebody would have gone looking at channel_registry.
--   3. It failed CLOSED, which is the one thing that went right. Nothing was
--      sent, and no SEND directive could have been recorded, because
--      csd_send_names_a_carrier and csd_send_requires_policy_decision both
--      would have refused the row. That is the value of having the constraints
--      as well as the function.
--
-- FIX 1: partition the window by eligibility, so capable integrations are
--        numbered among themselves and an incapable one can never occupy
--        position 1.
-- FIX 2: the router refuses outright if it ends up with no carrier after
--        counting one as eligible, instead of calling the policy engine with a
--        NULL integration. An internal inconsistency must not be laundered
--        into a policy verdict.

create or replace function public.nexus_channel_send_candidates(
  p_tenant_id            uuid,
  p_send_form            text,
  p_customer_external_id text
) returns table (
  integration_id            uuid,
  channel_type              text,
  external_identifier       text,
  credential_ref            text,
  provider                  text,
  provider_rank             integer,
  is_official_platform      boolean,
  support_state             text,
  capability_basis          text,
  capability_evidence       text,
  last_customer_message_at  timestamptz,
  registered_at             timestamptz,
  eligible                  boolean,
  selection_order           bigint,
  excluded_because          text
)
language sql
stable
set search_path to 'public','pg_catalog'
as $fn$
  with cand as (
    select cr.integration_id,
           cr.channel_type,
           cr.external_identifier,
           cr.credential_ref,
           cr.created_at as registered_at,
           case cr.channel_type
             when 'whatsapp_waha_session'          then 'waha'
             when 'whatsapp_cloud_phone_number_id' then 'whatsapp_cloud'
           end as provider
      from public.channel_registry cr
      join public.tenants t on t.id = cr.tenant_id
     where cr.tenant_id = p_tenant_id
       and cr.status    = 'active'
       and t.status     = 'active'
  ),
  enriched as (
    select c.*,
           r.rank as provider_rank,
           coalesce(r.is_official_platform, false) as is_official_platform,
           k.support_state,
           k.basis    as capability_basis,
           k.evidence as capability_evidence,
           ws.last_customer_message_at
      from cand c
      left join public.channel_provider_rank r on r.provider = c.provider
      left join lateral public.nexus_channel_capability_state(c.provider, p_send_form) k on true
      left join public.whatsapp_conversation_state ws
             on ws.tenant_id      = p_tenant_id
            and ws.integration_id = c.integration_id
            and ws.customer_wa_id = lower(btrim(coalesce(p_customer_external_id,'')))
  ),
  ranked as (
    select e.*,
           (e.support_state = 'SUPPORTED' and e.provider is not null) as eligible,
           case when e.support_state = 'SUPPORTED' and e.provider is not null then
             row_number() over (
               -- PARTITION BY eligibility is load-bearing and must not be
               -- removed. Without it row_number() counts the integrations that
               -- CANNOT carry this send form, and one of them takes position 1
               -- whenever it sorts first on C1 - which is exactly the case a
               -- customer replying on the WAHA number creates for a template
               -- send. The CASE below blanks the value; it does not stop the
               -- counter.
               partition by (e.support_state = 'SUPPORTED' and e.provider is not null)
               -- C1 conversation continuity: a reply leaves from the number the
               --    customer actually wrote to. Outranks the provider preference.
               order by (e.last_customer_message_at is null),
                        e.last_customer_message_at desc nulls last,
               -- C2 official platform first. Lower rank wins. NOT cheaper first.
                        coalesce(e.provider_rank, 999),
               -- C3 deterministic tie-break. Never random, never least-loaded.
                        e.registered_at asc,
                        e.integration_id asc
             )
           end as selection_order
      from enriched e
  )
  select integration_id, channel_type, external_identifier, credential_ref, provider,
         provider_rank, is_official_platform, support_state, capability_basis,
         capability_evidence, last_customer_message_at, registered_at, eligible,
         selection_order,
         case
           when provider is null then
             'This channel_type has no provider mapping, so NEXUS does not know what would carry it.'
           when support_state <> 'SUPPORTED' then
             format('%s cannot carry a %s send. %s', provider, upper(btrim(coalesce(p_send_form,''))), capability_evidence)
           when selection_order > 1 then
             'Capable, but another active integration was selected ahead of it by the carrier rules.'
         end as excluded_because
    from ranked
   order by eligible desc, selection_order nulls last, registered_at, integration_id;
$fn$;

comment on function public.nexus_channel_send_candidates(uuid,text,text) is
$c$Every active integration a dealership holds, with whether it can carry this
send form and where it sits in the carrier order. It returns ineligible
integrations too, so the router can record WHY a channel was not used.

The carrier order is, in strict priority, AMONG CAPABLE INTEGRATIONS ONLY:
  C1  Conversation continuity. If the customer has a measured inbound message on
      one of the capable integrations, the message leaves from that one. A reply
      must come from the number the customer wrote to; splitting one customer
      thread across two dealership numbers is worse than any provider preference.
  C2  Official platform first: channel_provider_rank ascending, which is
      whatsapp_cloud before waha. Read that table comment - the ordering is
      explicitly not economic, and reversing it to save the Cloud API charge is
      the bypass the router forbids.
  C3  Earliest registered, then lowest integration_id. Deterministic, and
      deliberately not "least loaded" or "most recently used".

"AMONG CAPABLE INTEGRATIONS ONLY" is enforced by the PARTITION BY on the window,
not by the CASE around it. chanroute_09 exists because the first version had
only the CASE, and an incapable integration silently held position 1.

Note what makes C1 safe. C1 can pick WAHA over a registered Cloud integration,
and someone will eventually ask whether that is a way to dodge the Cloud
template requirement. It is not, and the thing that stops it is not this
ordering: it is that C1 only ever ranks integrations that ALREADY PASSED the
capability filter, and waha has no template capability at all. A message that
policy says needs a template can therefore never come to rest on waha - it goes
to the Cloud integration if one is registered, and to nothing if none is, in
which case the router refuses. The capability data is load-bearing here, which
is why channel_provider_capability's comment forbids adding a waha-only send
form.$c$;


-- FIX 2, in the router: never hand the policy engine a null integration.
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
  r.routed_by             := 'nexus_route_message v2';

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
  -- rather than passed to the policy engine as a NULL integration. Doing the
  -- latter is what produced a misleading BLOCKED / CHANNEL_NOT_REGISTERED_TO_TENANT
  -- - a tenancy alarm raised by a ranking bug.
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
              then format(' To send now, come back with send_form TEMPLATE_TEXT (or TEMPLATE_MEDIA_HEADER) and an approved template of category %s.',
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
  r.directive          := 'SEND';

  if v_formrec.requires_template_ref then
    select v.verification, v.detail into v_tv
      from public.nexus_verify_template_ref(p_tenant_id, v_pick.provider, r.template_ref,
                                            coalesce(v_pol.template_category_if_required,'UTILITY')) v;
    r.template_verification        := v_tv.verification;
    r.template_verification_detail := v_tv.detail;
    r.message_body                 := null;
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
  same reason, and it must never acquire one. nexus_provider_router_invariants()
  check R1 fails if one appears.

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
      caller decision against until candidate selection has run.
    - Not offering the argument is a stronger guarantee than validating it.
      There is no parameter to lie in, so no validation to get wrong later.
  The cost is one extra STABLE call per send. That is the right trade.

WHY THERE IS NO RE-SELECTION.
  Carrier selection happens before the policy decision and is never revisited.
  If the selected carrier decision is TEMPLATE_REQUIRED or BLOCKED, the router
  returns that. It does NOT loop back and look for an integration on which the
  policy engine would have been kinder. Shopping for a permissive verdict is
  the same bypass as shopping for a cheap one, and it is prevented
  structurally: there is no loop in this function.

BLOCKED AND TEMPLATE_REQUIRED ARE OUTCOMES, NOT ERRORS.
  Nothing after the policy call raises, and nothing retries. They are returned
  as directive = DO_NOT_SEND with an outcome, a reason, and what would change
  it, and nexus_request_send records them. An engine asking to message an
  opted-out customer has not malfunctioned; wrapping a retry around a
  compliance refusal would turn one refusal into several.

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
  is the volatile wrapper that records the answer.

v2 (chanroute_09): candidate ranking is partitioned by capability, and a
carrier that fails to resolve is refused as CARRIER_SELECTION_FAILED instead of
being passed to the policy engine as a NULL integration.$c$;

revoke all on function public.nexus_channel_send_candidates(uuid,text,text) from anon, authenticated, public;
revoke all on function public.nexus_route_message(uuid,text,text,text,text,text,jsonb,text,text,text,timestamptz) from anon, authenticated, public;
grant execute on function public.nexus_channel_send_candidates(uuid,text,text) to service_role;
grant execute on function public.nexus_route_message(uuid,text,text,text,text,text,jsonb,text,text,text,timestamptz) to service_role;