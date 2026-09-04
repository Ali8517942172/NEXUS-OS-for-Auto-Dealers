-- The state rule and the action rule for Deal Rescue. Both IMMUTABLE, both with
-- an empty search_path, both pure: they take facts and return a word. The view
-- gathers the facts; these two decide. One rule, one place.
--
-- FINANCE_BLOCKED has NO BRANCH here and that is deliberate. finance_quotes
-- records no lender decision of any kind, so there is no fact that could feed
-- one. See deal_rescue_states.blocked_by = 'NO_FINANCE_DECISION_FIELD'.

create or replace function public.deal_rescue_state(
  p_evidence_tier            text,
  p_has_confirmed_sale       boolean,
  p_lead_is_open             boolean,
  p_silence_state            text,
  p_days_since_movement      numeric,
  p_at_risk_days             integer,
  p_stalled_days             integer
) returns text
language sql
immutable
set search_path to ''
as $$
  select case
    -- No admitted deal evidence at all. Unknown is not none.
    when p_evidence_tier is null or p_evidence_tier not in ('STRONG','WEAK')
                                                        then 'UNKNOWN'
    -- Defensive: a sold deal is not in flight and never reaches this engine.
    when p_has_confirmed_sale is true                   then 'UNKNOWN'
    -- Weak evidence can raise a person's attention and nothing more.
    when p_evidence_tier = 'WEAK'                       then 'NEEDS_MANAGER'
    -- Deal evidence live against a lead somebody closed. A contradiction a
    -- person has to resolve; the engine will not pick a side.
    when p_lead_is_open is false                        then 'NEEDS_MANAGER'
    -- Identity unresolved, or no movement timestamp: say so, do not grade.
    when p_lead_is_open is null                         then 'UNKNOWN'
    when p_days_since_movement is null                  then 'UNKNOWN'
    -- Stalled AND the customer specifically is silent. Ordered before STALLED
    -- because ghosting is stalling with a cause. Silence is read from
    -- v_lead_recovery, never re-derived.
    when p_days_since_movement >= p_stalled_days
     and p_silence_state = 'SILENT_PAST_STALE_THRESHOLD' then 'CUSTOMER_GHOSTED'
    when p_days_since_movement >= p_stalled_days        then 'STALLED'
    when p_days_since_movement >= p_at_risk_days        then 'AT_RISK'
    else                                                     'ON_TRACK'
  end;
$$;

comment on function public.deal_rescue_state(text, boolean, boolean, text, numeric, integer, integer) is
  'The Deal Rescue state rule. Returns one of the words in deal_rescue_states. FINANCE_BLOCKED is structurally unreachable: no branch returns it, because finance_quotes records no lender decision.';

create or replace function public.deal_rescue_recommended_action(p_state text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case p_state
    when 'ON_TRACK'         then 'NO_ACTION'
    when 'AT_RISK'          then 'FOLLOW_UP'
    when 'STALLED'          then 'MANAGER_REVIEW'
    when 'CUSTOMER_GHOSTED' then 'CUSTOMER_RECONTACT'
    when 'NEEDS_MANAGER'    then 'MANAGER_REVIEW'
    -- Unreachable today, and unreachable for the same single reason as the
    -- state that feeds it: no lender decision is recorded anywhere. Kept so
    -- that when FINANCE_DECISION lands, one change unlocks both.
    when 'FINANCE_BLOCKED'  then 'FINANCE_REVIEW'
    -- Unknown is not none. Somebody looks.
    when 'UNKNOWN'          then 'MANAGER_REVIEW'
    else                         'MANAGER_REVIEW'
  end;
$$;

comment on function public.deal_rescue_recommended_action(text) is
  'The only actions Deal Rescue may recommend: FOLLOW_UP, MANAGER_REVIEW, FINANCE_REVIEW, CUSTOMER_RECONTACT, NO_ACTION. FINANCE_REVIEW is unreachable today because FINANCE_BLOCKED is.';

revoke all on function public.deal_rescue_state(text, boolean, boolean, text, numeric, integer, integer) from anon, public;
revoke all on function public.deal_rescue_recommended_action(text) from anon, public;

grant execute on function public.deal_rescue_state(text, boolean, boolean, text, numeric, integer, integer) to authenticated, service_role;
grant execute on function public.deal_rescue_recommended_action(text) to authenticated, service_role;