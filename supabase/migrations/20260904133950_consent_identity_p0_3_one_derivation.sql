------------------------------------------------------------------
-- 8. Both consumers of the state now call the one derivation.
--
-- The policy engine's own copy of the ORDER BY is replaced in place --
-- surgically, so that nothing else in a 250-line function is disturbed
-- and the edit fails loudly if the block it expects is not there.
------------------------------------------------------------------
do $migrate$
declare
  v_src  text;
  v_old  text :=
'  select e.event, e.occurred_at, e.mechanism, e.evidence_kind, e.evidence_ref, e.recorded_by
    into v_opt
    from public.whatsapp_opt_in_event e
   where e.tenant_id = p_tenant_id
     and e.integration_id = p_integration_id
     and e.customer_wa_id = v_cust
   order by e.occurred_at desc, e.recorded_at desc
   limit 1;';
  v_new  text :=
'  select s.event, s.occurred_at, s.mechanism, s.evidence_kind, s.evidence_ref, s.recorded_by
    into v_opt
    from public.whatsapp_opt_in_state(p_tenant_id, p_integration_id, v_cust) s;';
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'whatsapp_policy_decision';

  if position(v_old in v_src) = 0 then
    raise exception 'whatsapp_policy_decision does not contain the opt-in derivation block this migration expects; refusing to guess.';
  end if;

  execute format(
    'create or replace function public.whatsapp_policy_decision(p_tenant_id uuid, p_integration_id uuid, p_customer_wa_id text, p_intent text, p_as_of timestamptz default now()) '
    'returns setof public.whatsapp_policy_decision_row language plpgsql stable set search_path to ''public'', ''pg_catalog'' as %L',
    replace(v_src, v_old, v_new));
end
$migrate$;

revoke all on function public.whatsapp_policy_decision(uuid,uuid,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.whatsapp_policy_decision(uuid,uuid,text,text,timestamptz) to service_role;

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
        w.rule_id as window_rule_id,
        w.value_numeric as window_hours,
        w.verification_status as window_rule_verification_status,
        w.authority as window_rule_authority,
        case when c.last_customer_message_at is null or w.value_numeric is null then null::timestamptz
             else c.last_customer_message_at + w.value_numeric::double precision * '01:00:00'::interval
        end as window_expires_at,
        case when c.last_customer_message_at is null or w.value_numeric is null then 'UNKNOWN'::text
             when now() < (c.last_customer_message_at + w.value_numeric::double precision * '01:00:00'::interval) then 'OPEN'::text
             else 'CLOSED'::text
        end as window_state,
        coalesce(o.state, 'OPT_IN_UNKNOWN'::text) as opt_in_state,
        o.occurred_at as opt_in_last_event_at,
        o.evidence_ref as opt_in_evidence_ref
   from whatsapp_conversation_state c
   join channel_registry cr on cr.integration_id = c.integration_id
   left join lateral whatsapp_policy_rule_lookup(c.tenant_id, 'PLATFORM_WHATSAPP'::text, 'WA_CUSTOMER_SERVICE_WINDOW_HOURS'::text)
        w(rule_id, jurisdiction, rule_name, value_numeric, value_text, unit, status, verification_status, authority, source_name, source_url, effective_from, notes) on true
   left join lateral public.whatsapp_opt_in_state(c.tenant_id, c.integration_id, c.customer_wa_id) o on true;

revoke all on public.v_whatsapp_conversation_window from public, anon, authenticated;