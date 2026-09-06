-- LEAD RECOVERY ENGINE — 04: the state model as three IMMUTABLE functions.
--
-- The classification lived inline in v_lead_recovery. It is lifted out here for
-- one reason: a branch that can only be exercised by inserting a lead is a branch
-- nobody will ever test on a dealership with three leads. As functions, every
-- branch can be called with synthetic arguments and NOTHING is written to any
-- table - which is how v_lead_recovery_state_model proves reachability instead of
-- asserting it.
--
-- IMMUTABLE and pure: they take measurements, they do not take a lead id and go
-- looking. The view remains the only thing that decides what a measurement is.

create function public.lead_recovery_state(
  p_sales_recorded  integer,
  p_lead_is_open    boolean,
  p_messages        integer,
  p_escalated_at    timestamptz,
  p_last_message_at timestamptz,
  p_last_inbound_at timestamptz,
  p_last_outbound_at timestamptz,
  p_hours_since_outbound numeric,
  p_silence_hours   integer
) returns text
language sql immutable
set search_path to ''
as $$
  select case
    when coalesce(p_sales_recorded, 0) > 0                                     then 'RECOVERED'
    when p_lead_is_open is false                                               then 'CLOSED_NO_OUTCOME'
    when coalesce(p_messages, 0) = 0                                           then 'NEW_RISK'
    when p_escalated_at is not null
     and (p_last_message_at is null or p_escalated_at >= p_last_message_at)     then 'ESCALATED'
    when p_last_inbound_at is not null
     and (p_last_outbound_at is null or p_last_inbound_at > p_last_outbound_at) then 'WAITING_RESPONSE'
    when p_last_outbound_at is not null
     and p_hours_since_outbound >= p_silence_hours                             then 'SILENT'
    when p_last_message_at is not null                                         then 'ENGAGED'
    else 'NEW_RISK'
  end;
$$;

comment on function public.lead_recovery_state(integer,boolean,integer,timestamptz,timestamptz,timestamptz,timestamptz,numeric,integer) is
  'The only definition of a lead recovery state. Branch order is the model: a confirmed sale '
  'outranks everything, a closed lead is not leaking, an invisible conversation is NEW_RISK not '
  'ENGAGED, an unmoved escalation outranks the message pattern. APPOINTMENT_PENDING is absent on '
  'purpose - there is no appointment table in this schema and a branch that can never fire is worse '
  'than an honest gap.';

create function public.lead_recovery_risk(
  p_state text,
  p_minutes_since_inbound numeric,
  p_hours_since_outbound  numeric,
  p_sla_minutes integer,
  p_stale_hours integer
) returns text
language sql immutable
set search_path to ''
as $$
  select case
    when p_state in ('RECOVERED','CLOSED_NO_OUTCOME') then 'NONE'
    when p_state = 'NEW_RISK'                         then 'UNKNOWN'
    when p_state = 'ESCALATED'                        then 'HIGH'
    when p_state = 'WAITING_RESPONSE'
      then case when p_minutes_since_inbound > p_sla_minutes then 'HIGH' else 'MEDIUM' end
    when p_state = 'SILENT'
      then case when p_hours_since_outbound >= p_stale_hours then 'HIGH' else 'MEDIUM' end
    when p_state = 'ENGAGED'                          then 'LOW'
    else 'UNKNOWN'
  end;
$$;

create function public.lead_recovery_recommended_action(
  p_state text,
  p_risk  text,
  p_has_owner boolean
) returns text
language sql immutable
set search_path to ''
as $$
  select case
    when p_risk = 'NONE'                                        then 'NO_ACTION'
    when p_risk = 'UNKNOWN'                                     then 'MANAGER_REVIEW'
    when p_state = 'ESCALATED'                                  then 'MANAGER_REVIEW'
    when p_has_owner is not true and p_risk in ('HIGH','MEDIUM') then 'ASSIGN_OWNER'
    when p_risk = 'HIGH'                                        then 'ESCALATE'
    when p_state in ('WAITING_RESPONSE','SILENT')               then 'FOLLOW_UP'
    else 'NO_ACTION'
  end;
$$;

comment on function public.lead_recovery_recommended_action(text,text,boolean) is
  'The closed action vocabulary: FOLLOW_UP, ESCALATE, ASSIGN_OWNER, MANAGER_REVIEW, NO_ACTION. '
  'Nothing external - no "send WhatsApp", no "book appointment" - because NEXUS has no executor '
  'for a lead action and would be promising something it cannot do. ASSIGN_OWNER outranks chasing '
  'on purpose: an unowned action is an action nobody does.';

-- Supabase default privileges grant EXECUTE directly to anon and authenticated on
-- every new function in public. REVOKE FROM PUBLIC does not touch a direct grant.
revoke all on function public.lead_recovery_state(integer,boolean,integer,timestamptz,timestamptz,timestamptz,timestamptz,numeric,integer) from anon, public;
revoke all on function public.lead_recovery_risk(text,numeric,numeric,integer,integer) from anon, public;
revoke all on function public.lead_recovery_recommended_action(text,text,boolean) from anon, public;
grant execute on function public.lead_recovery_state(integer,boolean,integer,timestamptz,timestamptz,timestamptz,timestamptz,numeric,integer) to authenticated, service_role;
grant execute on function public.lead_recovery_risk(text,numeric,numeric,integer,integer) to authenticated, service_role;
grant execute on function public.lead_recovery_recommended_action(text,text,boolean) to authenticated, service_role;