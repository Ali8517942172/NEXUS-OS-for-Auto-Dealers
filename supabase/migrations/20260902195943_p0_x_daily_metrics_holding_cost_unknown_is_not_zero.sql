/* ═══════════════════════════════════════════════════════════════════════════
   Found while closing the P0 wave, previously unreported.

   BUSINESS RULE
   Holding cost is only computable where the dealership has stated what a day
   on its lot costs. Where no rate has been stated the answer is UNKNOWN, and
   UNKNOWN is never zero. This is the same rule the Profit Sentinel already
   enforces per unit (holding_cost_state = NOT_COMPUTABLE on all twelve ALBA
   units today) and the same rule capture_daily_metrics already applies to
   pipeline_aed, whose bare sum() is labelled 'open_leads_null_when_unknown'.

   WHAT WAS WRONG
   The holding-cost line read
       coalesce(sum(holding_cost_accrued), 0)
   over a dealership whose every unit has holding_cost_accrued NULL, because
   the AED 50/day placeholder nobody at ALBA CARS ever quoted was correctly
   removed on 2 Sep 2026. sum() over all-NULL is NULL; the coalesce turned that
   into a hard 0. daily_metrics for 2026-09-02 therefore carried
   holding_cost_aed = 0 for ALBA CARS — a monetary figure asserting the lot
   costs nothing to hold, standing exactly where "we have not been told the
   rate" is the true answer. Yesterday's 33,250 was real; today's 0 was not.
   Fabricating a zero is the failure mode this product exists to end, and it is
   the one an owner is least likely to question because a zero looks like data.

   THE FIX
   Drop the coalesce. NULL now means "this dealership has not stated a holding
   rate, so its holding cost is not computable" and a reader must say so rather
   than print a number. No column is added: the rule is written on the column
   itself so there is one place to read it.
   ═══════════════════════════════════════════════════════════════════════════ */

create or replace function public.capture_daily_metrics()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  insert into daily_metrics as d (tenant_id, snapshot_date, open_leads, open_leads_rule,
    hot_leads, warm_leads, cold_leads, avg_response_minutes, pipeline_aed,
    pipeline_aed_rule, units_at_risk, holding_cost_aed, workflow_runs,
    workflow_failures, workflow_failures_rule, workflow_failures_canonical)
  select tn.id, current_date,
    (select count(*) from leads where tenant_id = tn.id and nexus_lead_is_open(status)),
    'nexus_lead_is_open',
    (select count(*) from leads where tenant_id = tn.id and upper(status)='HOT'),
    (select count(*) from leads where tenant_id = tn.id and upper(status)='WARM'),
    (select count(*) from leads where tenant_id = tn.id and upper(status)='COLD'),
    (select round(avg(response_time_minutes)::numeric,2) from leads
      where tenant_id = tn.id and response_time_minutes is not null),
    (select sum(budget_aed) from leads where tenant_id = tn.id and nexus_lead_is_open(status)),
    'open_leads_null_when_unknown',
    (select count(*) from inventory where tenant_id = tn.id and aging_alert='CRITICAL'),
    -- No coalesce. A dealership that has stated no holding rate has a holding
    -- cost of UNKNOWN, not of zero. See the comment on this column.
    (select sum(holding_cost_accrued) from inventory where tenant_id = tn.id),
    (select count(*) from audit_log where tenant_id = tn.id),
    (select count(*) from audit_log where tenant_id = tn.id
       and nexus_outcome_class(workflow, status, summary) = 'FAILURE'),
    'nexus_outcome_class',
    (select count(*) from audit_log where tenant_id = tn.id
       and nexus_outcome_class(workflow, status, summary) = 'FAILURE')
  from tenants tn
  where tn.status = 'active'
  on conflict (tenant_id, snapshot_date) do update set
    open_leads=excluded.open_leads, open_leads_rule=excluded.open_leads_rule,
    hot_leads=excluded.hot_leads, warm_leads=excluded.warm_leads,
    cold_leads=excluded.cold_leads,
    avg_response_minutes=excluded.avg_response_minutes,
    pipeline_aed=excluded.pipeline_aed, pipeline_aed_rule=excluded.pipeline_aed_rule,
    units_at_risk=excluded.units_at_risk, holding_cost_aed=excluded.holding_cost_aed,
    workflow_runs=excluded.workflow_runs, workflow_failures=excluded.workflow_failures,
    workflow_failures_rule=excluded.workflow_failures_rule,
    workflow_failures_canonical=excluded.workflow_failures_canonical,
    captured_at=now();
$function$;

comment on column public.daily_metrics.holding_cost_aed is
  'Sum of inventory.holding_cost_accrued for this dealership on this date. NULL '
  'means NOT COMPUTABLE - the dealership has stated no holding rate, so no unit '
  'carries an accrued figure. It does NOT mean the lot is free to hold. Any '
  'surface reading this column must render NULL as "not computable" and never as '
  'AED 0. A zero here was written on 2026-09-02 by a coalesce(...,0) and removed '
  'the same day.';

revoke execute on function public.capture_daily_metrics() from public, anon, authenticated;
grant  execute on function public.capture_daily_metrics() to service_role;