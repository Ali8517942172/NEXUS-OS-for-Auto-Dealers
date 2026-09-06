-- ---------------------------------------------------------------------
-- Rule lookup. One place that decides WHICH policy_rule row answers a
-- question, so the decision function cannot pick a different one by
-- accident. Tenant-specific rule wins over the global rule; ACTIVE wins
-- over DRAFT; highest version wins. Authority is computed by the existing
-- policy_authority(), not re-implemented here.
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_policy_rule_lookup(
  p_tenant_id   uuid,
  p_jurisdiction text,
  p_rule_name   text,
  p_as_of       date default (now() at time zone 'Asia/Dubai')::date
)
returns table (
  rule_id uuid, jurisdiction text, rule_name text,
  value_numeric numeric, value_text text, unit text,
  status text, verification_status text, authority text,
  source_name text, source_url text, effective_from date, notes text
)
language sql
stable
set search_path to 'public','pg_catalog'
as $fn$
  select r.id, r.jurisdiction, r.rule_name,
         r.value_numeric, r.value_text, r.unit,
         r.status, r.verification_status,
         public.policy_authority(r.status, r.verification_status, r.effective_from, r.effective_to, p_as_of),
         r.source_name, r.source_url, r.effective_from, r.notes
    from public.policy_rule r
   where r.jurisdiction = upper(btrim(coalesce(p_jurisdiction,'')))
     and r.rule_type    = 'MESSAGING'
     and r.rule_name    = upper(btrim(coalesce(p_rule_name,'')))
     and (r.tenant_id is null or r.tenant_id = p_tenant_id)
     and r.status <> 'WITHDRAWN'
   order by (r.tenant_id is null), (r.status = 'ACTIVE') desc, r.version desc
   limit 1;
$fn$;

comment on function public.whatsapp_policy_rule_lookup(uuid,text,text,date) is
$c$Single resolution path from (tenant, jurisdiction, rule name) to the one
policy_rule row that answers it, with its authority. Returns zero rows when no
such rule exists - which the decision function treats as a reason to refuse,
never as a reason to proceed.$c$;

do $do$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'whatsapp_policy_decision_row') then
    create type public.whatsapp_policy_decision_row as (
      decision                         text,
      reason_code                      text,
      reason                           text,
      what_would_change_it             text,
      window_state                     text,
      window_expires_at                timestamptz,
      last_customer_message_at         timestamptz,
      window_evidence                  text,
      window_hours                     numeric,
      opt_in_state                     text,
      opt_in_evidence                  text,
      applied_rule_id                  uuid,
      applied_rule_name                text,
      applied_rule_jurisdiction        text,
      applied_rule_authority           text,
      applied_rule_verification_status text,
      applied_rule_source              text,
      rules_considered                 jsonb,
      intent_category                  text,
      is_business_initiated            boolean,
      template_category_if_required    text,
      tenant_id                        uuid,
      integration_id                   uuid,
      customer_wa_id                   text,
      evaluated_at                     timestamptz,
      decided_by                       text
    );
  end if;
end
$do$;

-- =====================================================================
-- THE DECISION FUNCTION
--
-- NO LANGUAGE MODEL IS IN THIS PATH, AND NONE MAY BE ADDED.
--
-- Every input is an identifier or a timestamp. Every output is derived by
-- SQL from rows in policy_rule, whatsapp_conversation_state,
-- whatsapp_opt_in_event, whatsapp_message_intent, channel_registry and
-- tenants. Nothing here reads, classifies, or is influenced by generated
-- text; the message body is not an argument and cannot be one. The
-- function is deterministic for a fixed database state and a fixed p_as_of,
-- and is callable and answerable with every model in the product switched
-- off. An LLM may CHOOSE what to say; it has no authority over whether
-- NEXUS is permitted to say it, and a model output must never be used to
-- override, re-classify or retry this answer.
--
-- It fails closed. FREEFORM_ALLOWED is returned on exactly one path: a
-- measured inbound message inside a window computed from a rule that is
-- AUTHORITATIVE, for a resolved tenant and registered channel, with no
-- opt-out on record. Unknown tenant, unregistered channel, unknown intent,
-- missing rule, unverified rule, unknown conversation, unmeasured inbound
-- and unknown opt-in each cost the caller its free-form permission.
-- =====================================================================
create or replace function public.whatsapp_policy_decision(
  p_tenant_id      uuid,
  p_integration_id uuid,
  p_customer_wa_id text,
  p_intent         text,
  p_as_of          timestamptz default now()
)
returns setof public.whatsapp_policy_decision_row
language plpgsql
stable
security invoker
set search_path to 'public','pg_catalog'
as $fn$
declare
  v_now       timestamptz := coalesce(p_as_of, now());
  v_cust      text := lower(btrim(coalesce(p_customer_wa_id,'')));
  v_intent    text := upper(btrim(coalesce(p_intent,'')));
  v_biz       boolean;
  v_tmplcat   text;

  v_win       record;   -- WA_CUSTOMER_SERVICE_WINDOW_HOURS
  v_tmpl      record;   -- WA_BUSINESS_INITIATED_OUTSIDE_WINDOW_REQUIRES_TEMPLATE
  v_optin     record;   -- WA_MARKETING_TEMPLATE_REQUIRES_OPT_IN
  v_house     record;   -- NEXUS_HOUSE marketing-inside-window rule
  v_err       record;   -- WA_FREEFORM_OUTSIDE_WINDOW_ERROR_CODE
  v_conv      record;
  v_opt       record;

  v_wstate    text := 'UNKNOWN';
  v_expiry    timestamptz;
  v_lastmsg   timestamptz;
  v_wevid     text;
  v_optstate  text := 'OPT_IN_UNKNOWN';
  v_optevid   text := 'No opt-in and no opt-out has ever been recorded for this conversation.';

  v_dec       text;
  v_rcode     text;
  v_reason    text;
  v_change    text;
  v_rid       uuid;
  v_rname     text;
  v_rjur      text;
  v_rauth     text;
  v_rver      text;
  v_rsrc      text;
  v_rules     jsonb := '[]'::jsonb;
  v_by        text := 'whatsapp_policy_decision v1 - deterministic SQL, no language model in the path';

begin
  ------------------------------------------------------------------
  -- 0. Who is asking, and on whose channel.
  ------------------------------------------------------------------
  if p_tenant_id is null
     or not exists (select 1 from public.tenants t where t.id = p_tenant_id and t.status = 'active') then
    return query select
      'BLOCKED'::text, 'TENANT_UNRESOLVED'::text,
      'No active dealership resolves from the tenant supplied, so there is nobody on whose behalf this message could be sent.'::text,
      'Resolve the tenant from a trusted integration identity (nexus_resolve_channel_tenant on the channel the message arrived through) before asking for a decision. A caller-supplied tenant that matches no active row is refused, not defaulted.'::text,
      'UNKNOWN'::text, null::timestamptz, null::timestamptz, null::text, null::numeric,
      'OPT_IN_UNKNOWN'::text, 'Not evaluated - the tenant did not resolve.'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::text,
      '[]'::jsonb, v_intent, null::boolean, null::text,
      p_tenant_id, p_integration_id, v_cust, v_now, v_by;
    return;
  end if;

  if p_integration_id is null
     or not exists (select 1 from public.channel_registry cr
                     where cr.integration_id = p_integration_id
                       and cr.tenant_id = p_tenant_id
                       and cr.status = 'active') then
    return query select
      'BLOCKED'::text, 'CHANNEL_NOT_REGISTERED_TO_TENANT'::text,
      'The channel this message would leave through is not an active registered channel of that dealership. Sending would put one dealership''s message on another''s number, or on a number NEXUS does not control.'::text,
      'Register the channel in channel_registry against this tenant with status active, or send through a channel that already is.'::text,
      'UNKNOWN'::text, null::timestamptz, null::timestamptz, null::text, null::numeric,
      'OPT_IN_UNKNOWN'::text, 'Not evaluated - the channel did not resolve.'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::text,
      '[]'::jsonb, v_intent, null::boolean, null::text,
      p_tenant_id, p_integration_id, v_cust, v_now, v_by;
    return;
  end if;

  if v_cust = '' then
    return query select
      'BLOCKED'::text, 'CUSTOMER_IDENTITY_MISSING'::text,
      'No customer WhatsApp identity was supplied, so there is no conversation to decide about.'::text,
      'Supply the customer''s WhatsApp identity exactly as the platform reports it.'::text,
      'UNKNOWN'::text, null::timestamptz, null::timestamptz, null::text, null::numeric,
      'OPT_IN_UNKNOWN'::text, 'Not evaluated - no customer identity.'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::text,
      '[]'::jsonb, v_intent, null::boolean, null::text,
      p_tenant_id, p_integration_id, null::text, v_now, v_by;
    return;
  end if;

  ------------------------------------------------------------------
  -- 1. What is being sent.
  ------------------------------------------------------------------
  select m.is_business_initiated, m.template_category_if_required
    into v_biz, v_tmplcat
    from public.whatsapp_message_intent m
   where m.code = v_intent;

  if not found then
    return query select
      'BLOCKED'::text, 'INTENT_CATEGORY_UNKNOWN'::text,
      format('%L is not a message intent NEXUS recognises, so no rule can be applied to it.',
             coalesce(nullif(v_intent,''),'(empty)'))::text,
      'Call again with one of the codes in whatsapp_message_intent. An unrecognised intent is refused rather than guessed, because guessing it is how a marketing blast gets sent as a service reply.'::text,
      'UNKNOWN'::text, null::timestamptz, null::timestamptz, null::text, null::numeric,
      'OPT_IN_UNKNOWN'::text, 'Not evaluated - the intent was not recognised.'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::text,
      '[]'::jsonb, v_intent, null::boolean, null::text,
      p_tenant_id, p_integration_id, v_cust, v_now, v_by;
    return;
  end if;

  ------------------------------------------------------------------
  -- 2. The rules, as data.
  ------------------------------------------------------------------
  select l.* into v_win from (select 1) s
    left join lateral public.whatsapp_policy_rule_lookup(p_tenant_id,'PLATFORM_WHATSAPP','WA_CUSTOMER_SERVICE_WINDOW_HOURS') l on true;
  select l.* into v_tmpl from (select 1) s
    left join lateral public.whatsapp_policy_rule_lookup(p_tenant_id,'PLATFORM_WHATSAPP','WA_BUSINESS_INITIATED_OUTSIDE_WINDOW_REQUIRES_TEMPLATE') l on true;
  select l.* into v_optin from (select 1) s
    left join lateral public.whatsapp_policy_rule_lookup(p_tenant_id,'PLATFORM_WHATSAPP','WA_MARKETING_TEMPLATE_REQUIRES_OPT_IN') l on true;
  select l.* into v_house from (select 1) s
    left join lateral public.whatsapp_policy_rule_lookup(p_tenant_id,'NEXUS_HOUSE','WA_MARKETING_REQUIRES_OPT_IN_EVEN_INSIDE_WINDOW') l on true;
  select l.* into v_err from (select 1) s
    left join lateral public.whatsapp_policy_rule_lookup(p_tenant_id,'PLATFORM_WHATSAPP','WA_FREEFORM_OUTSIDE_WINDOW_ERROR_CODE') l on true;

  v_rules := jsonb_build_array(
    jsonb_build_object('asked','WA_CUSTOMER_SERVICE_WINDOW_HOURS','rule_id',v_win.rule_id,'jurisdiction',v_win.jurisdiction,
                       'value',v_win.value_numeric,'unit',v_win.unit,'status',v_win.status,
                       'verification_status',v_win.verification_status,'authority',v_win.authority,'source',v_win.source_name),
    jsonb_build_object('asked','WA_BUSINESS_INITIATED_OUTSIDE_WINDOW_REQUIRES_TEMPLATE','rule_id',v_tmpl.rule_id,'jurisdiction',v_tmpl.jurisdiction,
                       'value',v_tmpl.value_text,'unit',v_tmpl.unit,'status',v_tmpl.status,
                       'verification_status',v_tmpl.verification_status,'authority',v_tmpl.authority,'source',v_tmpl.source_name),
    jsonb_build_object('asked','WA_MARKETING_TEMPLATE_REQUIRES_OPT_IN','rule_id',v_optin.rule_id,'jurisdiction',v_optin.jurisdiction,
                       'value',v_optin.value_text,'unit',v_optin.unit,'status',v_optin.status,
                       'verification_status',v_optin.verification_status,'authority',v_optin.authority,'source',v_optin.source_name),
    jsonb_build_object('asked','WA_MARKETING_REQUIRES_OPT_IN_EVEN_INSIDE_WINDOW','rule_id',v_house.rule_id,'jurisdiction',v_house.jurisdiction,
                       'value',v_house.value_text,'unit',v_house.unit,'status',v_house.status,
                       'verification_status',v_house.verification_status,'authority',v_house.authority,'source',v_house.source_name),
    jsonb_build_object('asked','WA_FREEFORM_OUTSIDE_WINDOW_ERROR_CODE','rule_id',v_err.rule_id,'jurisdiction',v_err.jurisdiction,
                       'value',v_err.value_numeric,'unit',v_err.unit,'status',v_err.status,
                       'verification_status',v_err.verification_status,'authority',v_err.authority,'source',v_err.source_name)
  );

  ------------------------------------------------------------------
  -- 3. Measured conversation state. The window is DERIVED here and
  --    nowhere else, from the rule value - never from a literal.
  ------------------------------------------------------------------
  select c.last_customer_message_at, c.last_customer_message_external_id, c.last_customer_message_source
    into v_conv
    from public.whatsapp_conversation_state c
   where c.tenant_id = p_tenant_id
     and c.integration_id = p_integration_id
     and c.customer_wa_id = v_cust;

  if not found then
    v_wstate := 'UNKNOWN';
    v_wevid  := 'NEXUS has never observed this conversation. No row exists in whatsapp_conversation_state, which is unknown - not "the window is closed" and certainly not "the window is open".';
  elsif v_conv.last_customer_message_at is null then
    v_wstate := 'UNKNOWN';
    v_wevid  := 'The conversation is on record but no inbound customer message has ever been measured on it, so no window has ever been opened that NEXUS can see.';
  elsif v_win.rule_id is null or v_win.value_numeric is null then
    v_wstate := 'UNKNOWN';
    v_lastmsg := v_conv.last_customer_message_at;
    v_wevid  := 'An inbound message is on record, but the window duration rule is missing or carries no value, so no expiry can be computed. The duration is not hard-coded anywhere in this engine.';
  else
    v_lastmsg := v_conv.last_customer_message_at;
    v_expiry  := v_conv.last_customer_message_at + (v_win.value_numeric * interval '1 hour');
    v_wstate  := case when v_now < v_expiry then 'OPEN' else 'CLOSED' end;
    v_wevid   := format('Inbound message at %s (source: %s, id: %s) plus %s %s from rule %s.',
                        to_char(v_conv.last_customer_message_at at time zone 'Asia/Dubai','DD Mon YYYY HH24:MI') || ' Asia/Dubai',
                        coalesce(v_conv.last_customer_message_source,'unrecorded'),
                        coalesce(v_conv.last_customer_message_external_id,'unrecorded'),
                        trim(to_char(v_win.value_numeric,'FM999990.99')), lower(v_win.unit), v_win.rule_id);
  end if;

  ------------------------------------------------------------------
  -- 4. Opt-in, derived from the latest recorded fact.
  ------------------------------------------------------------------
  select e.event, e.occurred_at, e.mechanism, e.evidence_kind, e.evidence_ref, e.recorded_by
    into v_opt
    from public.whatsapp_opt_in_event e
   where e.tenant_id = p_tenant_id
     and e.integration_id = p_integration_id
     and e.customer_wa_id = v_cust
   order by e.occurred_at desc, e.recorded_at desc
   limit 1;

  if found then
    v_optstate := case when v_opt.event = 'OPT_IN' then 'OPTED_IN' else 'OPTED_OUT' end;
    v_optevid  := format('%s recorded %s via %s, evidenced by %s %s, entered by %s.',
                         v_opt.event,
                         to_char(v_opt.occurred_at at time zone 'Asia/Dubai','DD Mon YYYY HH24:MI') || ' Asia/Dubai',
                         v_opt.mechanism, v_opt.evidence_kind, v_opt.evidence_ref, v_opt.recorded_by);
  end if;

  ------------------------------------------------------------------
  -- 5. The ladder. Restrictions are applied whether or not their rule is
  --    verified; permissions are not. Dropping a restriction because
  --    nobody has verified it is the unsafe direction.
  ------------------------------------------------------------------

  -- 5a. A withdrawn consent stops every business-initiated message, and
  --     stops a "service reply" too when there is no open window to reply
  --     into - a reply to nothing is a business-initiated message.
  if v_optstate = 'OPTED_OUT' and (v_biz or v_wstate <> 'OPEN') then
    v_dec := 'BLOCKED'; v_rcode := 'CUSTOMER_OPTED_OUT';
    v_reason := 'This customer has withdrawn consent on this channel. ' || v_optevid;
    v_change := 'Only the customer can change this, by opting in again or by messaging the dealership. Record that as a new whatsapp_opt_in_event with its evidence. Nothing inside NEXUS may clear an opt-out.';
    v_rid := coalesce(v_optin.rule_id, v_house.rule_id); v_rname := coalesce(v_optin.rule_name, v_house.rule_name);
    v_rjur := coalesce(v_optin.jurisdiction, v_house.jurisdiction); v_rauth := coalesce(v_optin.authority, v_house.authority);
    v_rver := coalesce(v_optin.verification_status, v_house.verification_status); v_rsrc := coalesce(v_optin.source_name, v_house.source_name);

  -- 5b. Marketing without evidenced opt-in. OPT_IN_UNKNOWN is not permission.
  elsif v_intent = 'MARKETING' and v_optstate <> 'OPTED_IN' then
    v_dec := 'BLOCKED'; v_rcode := 'OPT_IN_NOT_EVIDENCED';
    v_reason := 'Marketing requires an opt-in NEXUS can evidence, and there is none on file for this conversation. ' || v_optevid
             || case when v_wstate = 'OPEN'
                     then ' The service window is open, which would permit a free-form message of another kind, but not this one.'
                     else '' end;
    v_change := 'Record a whatsapp_opt_in_event of OPT_IN with its mechanism and an evidence reference - a form submission, a signed document, a source-system record, or the customer''s own message. Absence of evidence is treated as absence of consent and always will be.';
    if v_wstate = 'OPEN' and v_house.rule_id is not null then
      v_rid := v_house.rule_id; v_rname := v_house.rule_name; v_rjur := v_house.jurisdiction;
      v_rauth := v_house.authority; v_rver := v_house.verification_status; v_rsrc := v_house.source_name;
    else
      v_rid := v_optin.rule_id; v_rname := v_optin.rule_name; v_rjur := v_optin.jurisdiction;
      v_rauth := v_optin.authority; v_rver := v_optin.verification_status; v_rsrc := v_optin.source_name;
    end if;
    if v_rid is null then
      v_rcode := 'OPT_IN_NOT_EVIDENCED_AND_NO_RULE_ON_FILE';
      v_reason := v_reason || ' No opt-in rule row could be found either; the absence of a rule is not permission, so this is still refused.';
    end if;

  -- 5c. No window-duration rule, or a rule with no value. Nothing to
  --     compute a window from, so no free-form permission can exist.
  elsif v_win.rule_id is null then
    v_dec := 'TEMPLATE_REQUIRED'; v_rcode := 'POLICY_RULE_MISSING';
    v_reason := 'The rule that defines the customer service window (PLATFORM_WHATSAPP / MESSAGING / WA_CUSTOMER_SERVICE_WINDOW_HOURS) is not on file, so NEXUS cannot establish that any window is open. It will not assume one.';
    v_change := 'Add the rule to policy_rule with its source. There is deliberately no fallback constant in this engine to fall back to.';
    v_rid := null; v_rname := 'WA_CUSTOMER_SERVICE_WINDOW_HOURS'; v_rjur := 'PLATFORM_WHATSAPP';
    v_rauth := 'ABSENT'; v_rver := 'ABSENT'; v_rsrc := null;

  elsif v_win.value_numeric is null then
    v_dec := 'TEMPLATE_REQUIRED'; v_rcode := 'POLICY_RULE_HAS_NO_VALUE';
    v_reason := 'The customer service window rule exists but states no value - it is registered as a question, not an answer - so no window can be computed.';
    v_change := 'Give the rule a value and a source, then verify it. Until then every message on this channel must be a pre-approved template.';
    v_rid := v_win.rule_id; v_rname := v_win.rule_name; v_rjur := v_win.jurisdiction;
    v_rauth := v_win.authority; v_rver := v_win.verification_status; v_rsrc := v_win.source_name;

  -- 5d. Window open, and the rule that says so may be relied on.
  elsif v_wstate = 'OPEN' and v_win.authority = 'AUTHORITATIVE' then
    v_dec := 'FREEFORM_ALLOWED'; v_rcode := 'WINDOW_OPEN';
    v_reason := format('The customer service window is open until %s. %s',
                       to_char(v_expiry at time zone 'Asia/Dubai','DD Mon YYYY HH24:MI') || ' Asia/Dubai', v_wevid);
    v_change := format('This becomes TEMPLATE_REQUIRED at %s unless the customer messages again - and only a customer message extends it, never anything NEXUS sends. A recorded opt-out would make it BLOCKED immediately.',
                       to_char(v_expiry at time zone 'Asia/Dubai','DD Mon YYYY HH24:MI') || ' Asia/Dubai');
    v_rid := v_win.rule_id; v_rname := v_win.rule_name; v_rjur := v_win.jurisdiction;
    v_rauth := v_win.authority; v_rver := v_win.verification_status; v_rsrc := v_win.source_name;

  -- 5e. Window open by arithmetic, but the arithmetic rests on a rule
  --     nobody has checked. A permission granted on an unverified rule is
  --     not a permission.
  elsif v_wstate = 'OPEN' then
    v_dec := 'TEMPLATE_REQUIRED'; v_rcode := 'WINDOW_RULE_' || v_win.authority;
    v_reason := format('By the recorded window duration the window would be open until %s, but the rule it rests on is %s. NEXUS will not grant a free-form permission on a rule nobody has verified, so the safe form of the message is required instead. %s',
                       to_char(v_expiry at time zone 'Asia/Dubai','DD Mon YYYY HH24:MI') || ' Asia/Dubai',
                       v_win.authority, v_wevid);
    v_change := format('Verify %s / MESSAGING / %s against the source that governs this account (policy_verify_rule) and this same conversation returns FREEFORM_ALLOWED. Nothing about the customer has to change - only the evidence behind the rule.',
                       v_win.jurisdiction, v_win.rule_name);
    v_rid := v_win.rule_id; v_rname := v_win.rule_name; v_rjur := v_win.jurisdiction;
    v_rauth := v_win.authority; v_rver := v_win.verification_status; v_rsrc := v_win.source_name;

  -- 5f. Window closed, or never measured.
  else
    v_dec := 'TEMPLATE_REQUIRED';
    v_rcode := case when v_wstate = 'CLOSED' then 'WINDOW_CLOSED' else 'CONVERSATION_NOT_MEASURED' end;
    v_reason := case
      when v_wstate = 'CLOSED' then
        format('The customer service window closed at %s. Outside it a business-initiated message must use a template pre-approved by Meta; a free-form attempt is rejected by the API%s. %s',
               to_char(v_expiry at time zone 'Asia/Dubai','DD Mon YYYY HH24:MI') || ' Asia/Dubai',
               case when v_err.value_numeric is not null then ' with error ' || trim(to_char(v_err.value_numeric,'FM999999')) else '' end,
               v_wevid)
      else
        'NEXUS cannot establish that a window is open on this conversation, and unknown is not open. ' || v_wevid
      end;
    v_change := 'A new inbound message from the customer opens a fresh window and this becomes FREEFORM_ALLOWED once the window rule is verified. Until then, send an approved template of category '
             || coalesce(v_tmplcat,'UTILITY') || '.';
    v_rid := coalesce(v_tmpl.rule_id, v_win.rule_id); v_rname := coalesce(v_tmpl.rule_name, v_win.rule_name);
    v_rjur := coalesce(v_tmpl.jurisdiction, v_win.jurisdiction); v_rauth := coalesce(v_tmpl.authority, v_win.authority);
    v_rver := coalesce(v_tmpl.verification_status, v_win.verification_status); v_rsrc := coalesce(v_tmpl.source_name, v_win.source_name);
  end if;

  return query select
    v_dec, v_rcode, v_reason, v_change,
    v_wstate, v_expiry, v_lastmsg, v_wevid, v_win.value_numeric,
    v_optstate, v_optevid,
    v_rid, v_rname, v_rjur, v_rauth, v_rver, v_rsrc,
    v_rules, v_intent, v_biz, v_tmplcat,
    p_tenant_id, p_integration_id, v_cust, v_now, v_by;
end;
$fn$;

comment on function public.whatsapp_policy_decision(uuid,uuid,text,text,timestamptz) is
$c$Decides whether one outbound WhatsApp message may be FREEFORM_ALLOWED, must
be TEMPLATE_REQUIRED, or is BLOCKED - and returns the reason, the policy_rule
row it applied, and what would change the answer.

NO LANGUAGE MODEL IS IN THIS PATH, AND NONE MAY BE ADDED. The arguments are
identifiers and a timestamp; the message body is not one and must not become
one. Every output is derived by SQL from policy_rule, whatsapp_conversation_state,
whatsapp_opt_in_event, whatsapp_message_intent, channel_registry and tenants.
The function is deterministic for a fixed database state and p_as_of, and
answers with every model in the product switched off. A model may choose what
to say; it has no authority over whether NEXUS may say it, and no model output
may override, re-classify or retry this answer.

It fails closed. FREEFORM_ALLOWED is returned on exactly one path: a measured
inbound customer message inside a window computed from an AUTHORITATIVE rule,
for an active tenant and a channel registered to it, with no opt-out on record.
Unknown tenant, unregistered channel, unknown intent, missing rule, valueless
rule, unverified rule, unobserved conversation, unmeasured inbound message and
OPT_IN_UNKNOWN each cost the caller its free-form permission. The window
duration is read from policy_rule; it is not a constant anywhere in this engine.

BLOCKED and TEMPLATE_REQUIRED are answers, not failures. A caller that retries
them is retrying a correct decision.$c$;

-- ---------------------------------------------------------------------
-- What a workflow actually holds is a phone number id or a WAHA session,
-- not a tenant uuid. This is the entry point for that caller: it resolves
-- the tenant from the trusted integration identity and refuses when the
-- resolver returns nothing - zero rows, no fallback clause, same as
-- nexus_resolve_channel_tenant itself.
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_policy_decision_for_channel(
  p_channel_type        text,
  p_external_identifier text,
  p_customer_wa_id      text,
  p_intent              text,
  p_as_of               timestamptz default now()
)
returns setof public.whatsapp_policy_decision_row
language plpgsql
stable
security invoker
set search_path to 'public','pg_catalog'
as $fn$
declare
  v_t uuid;
  v_i uuid;
begin
  select r.tenant_id, r.integration_id
    into v_t, v_i
    from public.nexus_resolve_channel_tenant(p_channel_type, p_external_identifier) r;

  if not found then
    return query select
      'BLOCKED'::text, 'CHANNEL_UNRESOLVED'::text,
      format('No active dealership resolves from %s / %s, so NEXUS does not know whose customer this is or whose rules apply.',
             coalesce(nullif(btrim(coalesce(p_channel_type,'')),''),'(no channel type)'),
             coalesce(nullif(btrim(coalesce(p_external_identifier,'')),''),'(no identifier)'))::text,
      'Register this channel identity in channel_registry against the dealership that owns it, with status active. An unresolved channel is refused, never attributed to the default dealership - a caller that can pick the tenant can pick whose customers get messaged.'::text,
      'UNKNOWN'::text, null::timestamptz, null::timestamptz, null::text, null::numeric,
      'OPT_IN_UNKNOWN'::text, 'Not evaluated - the channel did not resolve.'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::text,
      '[]'::jsonb, upper(btrim(coalesce(p_intent,'')))::text, null::boolean, null::text,
      null::uuid, null::uuid, lower(btrim(coalesce(p_customer_wa_id,'')))::text,
      coalesce(p_as_of, now()), 'whatsapp_policy_decision v1 - deterministic SQL, no language model in the path'::text;
    return;
  end if;

  return query select * from public.whatsapp_policy_decision(v_t, v_i, p_customer_wa_id, p_intent, p_as_of);
end;
$fn$;

comment on function public.whatsapp_policy_decision_for_channel(text,text,text,text,timestamptz) is
$c$The entry point a workflow calls. Resolves the dealership from a trusted
integration identity (channel_registry via nexus_resolve_channel_tenant), then
hands off to whatsapp_policy_decision. An identity that resolves to nothing
returns BLOCKED / CHANNEL_UNRESOLVED; it is never attributed to whichever
dealership holds tenants.is_unattributed_default. No language model is in this
path either.$c$;

-- ---------------------------------------------------------------------
-- Writers. The inbound adapter calls the first one; it is the ONLY way
-- last_customer_message_at moves, and it only ever moves forward. There
-- is deliberately no writer that opens a window from an outbound message,
-- because the platform rule says a business message never extends it.
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_record_customer_message(
  p_tenant_id          uuid,
  p_integration_id     uuid,
  p_customer_wa_id     text,
  p_occurred_at        timestamptz,
  p_external_message_id text,
  p_source             text
)
returns public.whatsapp_conversation_state
language plpgsql
volatile
security invoker
set search_path to 'public','pg_catalog'
as $fn$
declare
  v_cust text := lower(btrim(coalesce(p_customer_wa_id,'')));
  v_row  public.whatsapp_conversation_state;
begin
  if not exists (select 1 from public.channel_registry cr
                  where cr.integration_id = p_integration_id
                    and cr.tenant_id = p_tenant_id
                    and cr.status = 'active') then
    raise exception using errcode = '42501',
      message = 'That channel is not an active registered channel of that dealership.',
      hint    = 'Resolve the tenant from the channel identity rather than passing both in independently.';
  end if;
  if v_cust = '' then
    raise exception using errcode = '22023', message = 'A customer WhatsApp identity is required.';
  end if;
  if p_occurred_at is null then
    raise exception using errcode = '22023',
      message = 'An inbound message with no timestamp cannot open a window.',
      hint    = 'Leave the conversation unmeasured rather than recording a window NEXUS cannot date.';
  end if;
  if nullif(btrim(coalesce(p_source,'')),'') is null then
    raise exception using errcode = '22023',
      message = 'Recording an inbound message requires naming where the timestamp came from.';
  end if;

  insert into public.whatsapp_conversation_state as c
    (tenant_id, integration_id, customer_wa_id,
     last_customer_message_at, last_customer_message_external_id, last_customer_message_source)
  values (p_tenant_id, p_integration_id, v_cust, p_occurred_at, p_external_message_id, btrim(p_source))
  on conflict (tenant_id, integration_id, customer_wa_id) do update
     set last_customer_message_at          = excluded.last_customer_message_at,
         last_customer_message_external_id = excluded.last_customer_message_external_id,
         last_customer_message_source      = excluded.last_customer_message_source,
         updated_at                        = now()
   where c.last_customer_message_at is null
      or excluded.last_customer_message_at > c.last_customer_message_at
  returning * into v_row;

  if v_row is null then
    select * into v_row from public.whatsapp_conversation_state c2
     where c2.tenant_id = p_tenant_id and c2.integration_id = p_integration_id and c2.customer_wa_id = v_cust;
  end if;
  return v_row;
end;
$fn$;

comment on function public.whatsapp_record_customer_message(uuid,uuid,text,timestamptz,text,text) is
$c$Records that the customer messaged us. The only writer of
last_customer_message_at, and it moves the timestamp forward only - an
out-of-order or replayed delivery cannot extend a window backwards or reopen a
closed one. There is no counterpart for outbound messages by design.$c$;

create or replace function public.whatsapp_record_opt_in_event(
  p_tenant_id      uuid,
  p_integration_id uuid,
  p_customer_wa_id text,
  p_event          text,
  p_occurred_at    timestamptz,
  p_mechanism      text,
  p_evidence_kind  text,
  p_evidence_ref   text,
  p_recorded_by    text,
  p_notes          text default null
)
returns public.whatsapp_opt_in_event
language plpgsql
volatile
security invoker
set search_path to 'public','pg_catalog'
as $fn$
declare
  v_cust text := lower(btrim(coalesce(p_customer_wa_id,'')));
  v_row  public.whatsapp_opt_in_event;
begin
  if not exists (select 1 from public.channel_registry cr
                  where cr.integration_id = p_integration_id
                    and cr.tenant_id = p_tenant_id
                    and cr.status = 'active') then
    raise exception using errcode = '42501',
      message = 'That channel is not an active registered channel of that dealership.';
  end if;

  insert into public.whatsapp_opt_in_event
    (tenant_id, integration_id, customer_wa_id, event, occurred_at,
     mechanism, evidence_kind, evidence_ref, recorded_by, notes)
  values (p_tenant_id, p_integration_id, v_cust, upper(btrim(coalesce(p_event,''))), p_occurred_at,
          upper(btrim(coalesce(p_mechanism,''))), upper(btrim(coalesce(p_evidence_kind,''))),
          btrim(coalesce(p_evidence_ref,'')), btrim(coalesce(p_recorded_by,'')), p_notes)
  returning * into v_row;
  return v_row;
end;
$fn$;

comment on function public.whatsapp_record_opt_in_event(uuid,uuid,text,text,timestamptz,text,text,text,text,text) is
$c$Records consent given or withdrawn, with how it was obtained and what proves
it. Both are mandatory: an opt-in NEXUS cannot evidence is not an opt-in, and
the decision function will not act on one.$c$;

-- ---------------------------------------------------------------------
-- Readable state, for an operator or a screen. security_invoker so the
-- caller's own privileges and RLS apply - the view grants nothing.
-- ---------------------------------------------------------------------
create or replace view public.v_whatsapp_conversation_window
with (security_invoker = true) as
select c.tenant_id,
       c.integration_id,
       cr.channel_type,
       cr.external_identifier as channel_identifier,
       c.customer_wa_id,
       c.last_customer_message_at,
       c.last_customer_message_external_id,
       c.last_customer_message_source,
       w.rule_id                       as window_rule_id,
       w.value_numeric                 as window_hours,
       w.verification_status           as window_rule_verification_status,
       w.authority                     as window_rule_authority,
       case
         when c.last_customer_message_at is null or w.value_numeric is null then null::timestamptz
         else c.last_customer_message_at + (w.value_numeric * interval '1 hour')
       end                             as window_expires_at,
       case
         when c.last_customer_message_at is null or w.value_numeric is null then 'UNKNOWN'
         when now() < c.last_customer_message_at + (w.value_numeric * interval '1 hour') then 'OPEN'
         else 'CLOSED'
       end                             as window_state,
       coalesce(o.state, 'OPT_IN_UNKNOWN') as opt_in_state,
       o.occurred_at                   as opt_in_last_event_at,
       o.evidence_ref                  as opt_in_evidence_ref
  from public.whatsapp_conversation_state c
  join public.channel_registry cr on cr.integration_id = c.integration_id
  left join lateral public.whatsapp_policy_rule_lookup(c.tenant_id,'PLATFORM_WHATSAPP','WA_CUSTOMER_SERVICE_WINDOW_HOURS') w on true
  left join lateral (
        select case when e.event = 'OPT_IN' then 'OPTED_IN' else 'OPTED_OUT' end as state,
               e.occurred_at, e.evidence_ref
          from public.whatsapp_opt_in_event e
         where e.tenant_id = c.tenant_id
           and e.integration_id = c.integration_id
           and e.customer_wa_id = c.customer_wa_id
         order by e.occurred_at desc, e.recorded_at desc
         limit 1) o on true;

comment on view public.v_whatsapp_conversation_window is
$c$Measured conversation state with the window derived at read time from the
policy_rule value, never from a stored expiry and never from a literal. This
view REPORTS; it does not decide. The decision is whatsapp_policy_decision().$c$;