-- Found by an adversarial read on 2026-09-03: a caller who can see no leads got
-- met_now = true for SILENCE_DETECTOR_RESUMED ("0 of 0 leads have a stale
-- detector") and for DEAL_OWNER ("0 of 0 leads unassigned"). Both are true by
-- vacuity and both are lies on the screen. A requirement with nothing to
-- measure is UNKNOWN, not met. This is the same rule as INV-007: a missing row
-- is not proof the event did not happen, and a missing input is not a zero.

create or replace view public.v_deal_rescue_readiness
with (security_invoker = true) as
select
  p.id, p.sort, p.requirement, p.kind, p.unlocks, p.unlocks_states, p.evidence_today, p.why_not_code,
  case p.id
    when 'DEAL_RECORD'              then (to_regclass('public.deals') is not null)
    when 'APPOINTMENT'              then (to_regclass('public.appointments') is not null)
    when 'ACTION_LANE'              then (to_regclass('public.deal_rescue_actions') is not null)
    when 'DEAL_STAGE_HISTORY'       then (select count(*) > 0 from information_schema.columns c
                                           where c.table_schema = 'public' and c.column_name = 'stage')
    when 'FINANCE_DECISION'         then (select count(*) > 0 from information_schema.columns c
                                           where c.table_schema = 'public' and c.table_name = 'finance_quotes'
                                             and c.column_name in ('decision','lender_decision','status','decided_at','lender'))
    when 'DEAL_TO_UNIT_LINK'        then (select count(*) > 0 from information_schema.columns c
                                           where c.table_schema = 'public' and c.table_name = 'purchase_history'
                                             and c.column_name in ('unit_id','vin','inventory_id'))
    -- Nothing to measure means UNKNOWN, never met.
    when 'SILENCE_DETECTOR_RESUMED' then (case when (select count(*) from public.v_lead_recovery) = 0 then null
                                               else (select count(*) = 0 from public.v_lead_recovery r
                                                      where r.silence_detector_state is distinct from 'CURRENT') end)
    when 'DEAL_OWNER'               then (case when (select count(*) from public.leads) = 0 then null
                                               else (select count(*) = 0 from public.leads l where l.assigned_to_id is null) end)
    when 'VOLUME'                   then false
  end as met_now,
  case p.id
    when 'DEAL_RECORD'              then 'public.deals: ' || coalesce(to_regclass('public.deals')::text, 'does not exist')
    when 'APPOINTMENT'              then 'public.appointments: ' || coalesce(to_regclass('public.appointments')::text, 'does not exist')
    when 'ACTION_LANE'              then 'public.deal_rescue_actions: ' || coalesce(to_regclass('public.deal_rescue_actions')::text, 'does not exist')
    when 'DEAL_STAGE_HISTORY'       then (select count(*)::text from information_schema.columns c
                                           where c.table_schema = 'public' and c.column_name = 'stage') || ' column(s) named "stage" anywhere in schema public'
    when 'FINANCE_DECISION'         then (select count(*)::text from public.finance_quotes) || ' live finance_quotes row(s) visible to this caller; '
                                         || (select count(*)::text from information_schema.columns c
                                              where c.table_schema = 'public' and c.table_name = 'finance_quotes'
                                                and c.column_name in ('decision','lender_decision','status','decided_at','lender'))
                                         || ' decision-shaped column(s) on finance_quotes'
    when 'DEAL_TO_UNIT_LINK'        then (select count(*)::text from information_schema.columns c
                                           where c.table_schema = 'public' and c.table_name = 'purchase_history'
                                             and c.column_name in ('unit_id','vin','inventory_id')) || ' unit-link column(s) on purchase_history'
    when 'SILENCE_DETECTOR_RESUMED' then (case when (select count(*) from public.v_lead_recovery) = 0
                                               then 'UNKNOWN - no leads are visible to this caller, so the detector cannot be measured. Not the same as healthy.'
                                               else (select coalesce(max(r.silence_detector_state), 'unknown') from public.v_lead_recovery r)
                                                    || ', last success ' || coalesce((select max(r.silence_detector_last_success_at)::text from public.v_lead_recovery r), 'never') end)
    when 'DEAL_OWNER'               then (case when (select count(*) from public.leads) = 0
                                               then 'UNKNOWN - no leads are visible to this caller, so ownership cannot be measured. Not the same as fully owned.'
                                               else (select count(*)::text from public.leads l where l.assigned_to_id is null) || ' of '
                                                    || (select count(*)::text from public.leads) || ' lead(s) unassigned' end)
    when 'VOLUME'                   then (select count(*)::text from public.leads) || ' lead(s), '
                                         || (select count(*)::text from public.purchase_history) || ' sale(s), '
                                         || (select count(*)::text from public.finance_quotes) || ' finance quote(s) visible to this caller'
  end as measured_now,
  now() as measured_at
from public.deal_rescue_prerequisites p;

comment on view public.v_deal_rescue_readiness is
  'The Deal Rescue purchase order with every measurable prerequisite re-measured on read, so it cannot silently go stale the way a written list does. met_now is NULL where there is nothing to measure - unknown is not met, and a caller who can see no rows must not be told a requirement is satisfied.';

revoke all on public.v_deal_rescue_readiness from anon, authenticated, public;
grant select on public.v_deal_rescue_readiness to authenticated, service_role;