-- Correction found by a rolled-back probe on 4 Sep 2026, before this engine
-- had any caller. Old rule 5a blocked an opted-out customer only when the
-- intent was business-initiated or the window was shut. So a customer whose
-- most recent message was STOP still got FREEFORM_ALLOWED for a SERVICE_REPLY
-- - because the STOP itself had opened the window. The last word the customer
-- said now governs: an opt-out at or after the last inbound message blocks a
-- service reply too.
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

  -- 5a. A withdrawn consent stops every business-initiated message; it stops
  --     a "service reply" too when there is no open window to reply into (a
  --     reply to nothing is a business-initiated message), AND when the
  --     opt-out is the most recent thing the customer did. Measured 4 Sep in
  --     a rolled-back probe: without that last clause a customer whose latest
  --     message was STOP got a free-form reply, because the STOP itself had
  --     opened the window. The last word the customer said governs.
  if v_optstate = 'OPTED_OUT'
     and (v_biz
          or v_wstate <> 'OPEN'
          or v_lastmsg is null
          or v_opt.occurred_at >= v_lastmsg) then
    v_dec := 'BLOCKED'; v_rcode := 'CUSTOMER_OPTED_OUT';
    v_reason := 'This customer has withdrawn consent on this channel. ' || v_optevid;
    v_change := 'Only the customer can change this, by opting in again or by messaging the dealership after the opt-out. Record that as a new whatsapp_opt_in_event, or as a measured inbound message, with its evidence. Nothing inside NEXUS may clear an opt-out.';
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
    v_change := format('Verify %s / MESSAGING / %s against the source that governs this account and this same conversation returns FREEFORM_ALLOWED. Nothing about the customer has to change - only the evidence behind the rule.',
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

revoke all on function public.whatsapp_policy_decision(uuid,uuid,text,text,timestamptz) from anon, authenticated, public;
grant execute on function public.whatsapp_policy_decision(uuid,uuid,text,text,timestamptz) to service_role;