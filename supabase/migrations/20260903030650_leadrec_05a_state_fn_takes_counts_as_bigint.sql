-- count(*) is bigint in Postgres. Taking integer forced a cast at every call site,
-- which is the kind of friction that eventually gets "fixed" by inlining the CASE
-- again. Take the type the measurement actually has.
drop function public.lead_recovery_state(integer,boolean,integer,timestamptz,timestamptz,timestamptz,timestamptz,numeric,integer);

create function public.lead_recovery_state(
  p_sales_recorded  bigint,
  p_lead_is_open    boolean,
  p_messages        bigint,
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

comment on function public.lead_recovery_state(bigint,boolean,bigint,timestamptz,timestamptz,timestamptz,timestamptz,numeric,integer) is
  'The only definition of a lead recovery state. Branch order is the model: a confirmed sale '
  'outranks everything, a closed lead is not leaking, an invisible conversation is NEW_RISK not '
  'ENGAGED, an unmoved escalation outranks the message pattern. APPOINTMENT_PENDING is absent on '
  'purpose - there is no appointment table in this schema and a branch that can never fire is worse '
  'than an honest gap.';

revoke all on function public.lead_recovery_state(bigint,boolean,bigint,timestamptz,timestamptz,timestamptz,timestamptz,numeric,integer) from anon, public;
grant execute on function public.lead_recovery_state(bigint,boolean,bigint,timestamptz,timestamptz,timestamptz,timestamptz,numeric,integer) to authenticated, service_role;