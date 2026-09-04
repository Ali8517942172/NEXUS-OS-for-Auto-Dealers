-- INV-001 / INV-008 · A workflow failure is whatever nexus_outcome_class calls a
-- FAILURE, and nothing else. capture_daily_metrics() counted raw status='FAILED',
-- which also swept in the six "did not land" rows that are PARTIAL deliveries --
-- a quote that reached the customer while its record did not. Those are half-done
-- work, not failures, and the dealership must not be told 205 things broke when
-- 199 did.
--
-- Business rule: workflow_failures = count of audit_log rows whose canonical
-- outcome class is 'FAILURE'. The function is the single authority; the snapshot
-- reads it rather than re-deciding.
--
-- HISTORY IS NOT REWRITTEN. The 14 snapshots already stored were computed under
-- the old rule. Their workflow_failures values stay exactly as recorded -- they
-- are the true record of what the system believed and published on the day.
-- Two additive columns make the change of rule visible instead of silent:
--   workflow_failures_rule      -- which rule produced workflow_failures
--   workflow_failures_canonical -- the same day counted by today's authority
-- The canonical backfill is a replay of nexus_outcome_class over audit_log rows
-- with logged_at <= captured_at. That replay was validated first by reproducing
-- BOTH stored columns (workflow_runs and workflow_failures) exactly on all 14
-- rows under the old rule, which establishes that audit_log is append-only over
-- this window and the replay is sound. Only 4 of the 14 rows differ numerically
-- (2026-08-29 192/191, 08-30 196/192, 08-31 205/199, 09-01 205/199); the first
-- ten are identical under both rules.

alter table public.daily_metrics
  add column if not exists workflow_failures_rule text,
  add column if not exists workflow_failures_canonical integer;

comment on column public.daily_metrics.workflow_failures is
  'Failure count as recorded on the day, under the rule named in workflow_failures_rule. Never restated.';
comment on column public.daily_metrics.workflow_failures_rule is
  'Which rule produced workflow_failures: ''raw_status'' = count(status=''FAILED'') (in force to 2026-09-01); ''nexus_outcome_class'' = count(nexus_outcome_class(...)=''FAILURE'') (in force from 2026-09-02).';
comment on column public.daily_metrics.workflow_failures_canonical is
  'The same day counted by public.nexus_outcome_class. For rows written before 2026-09-02 this is a validated replay over audit_log, not the figure that was published that day. Use this column, not workflow_failures, for any series that must be comparable across the rule change.';

-- Backfill: label the existing rows with the rule that actually produced them,
-- and record the canonical figure beside the published one.
update public.daily_metrics d
   set workflow_failures_rule = coalesce(d.workflow_failures_rule, 'raw_status'),
       workflow_failures_canonical = coalesce(
         d.workflow_failures_canonical,
         (select count(*) from public.audit_log a
           where a.logged_at <= d.captured_at
             and public.nexus_outcome_class(a.workflow, a.status, a.summary) = 'FAILURE')::integer)
 where d.workflow_failures_rule is null
    or d.workflow_failures_canonical is null;

create or replace function public.capture_daily_metrics()
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  INSERT INTO daily_metrics AS d (snapshot_date, open_leads, hot_leads, warm_leads,
    cold_leads, avg_response_minutes, pipeline_aed, units_at_risk,
    holding_cost_aed, workflow_runs, workflow_failures,
    workflow_failures_rule, workflow_failures_canonical)
  SELECT current_date,
    (SELECT count(*) FROM leads WHERE status <> 'CLOSED' OR status IS NULL),
    (SELECT count(*) FROM leads WHERE upper(status)='HOT'),
    (SELECT count(*) FROM leads WHERE upper(status)='WARM'),
    (SELECT count(*) FROM leads WHERE upper(status)='COLD'),
    (SELECT round(avg(response_time_minutes)::numeric,2) FROM leads WHERE response_time_minutes IS NOT NULL),
    (SELECT coalesce(sum(budget_aed),0) FROM leads WHERE budget_aed IS NOT NULL),
    (SELECT count(*) FROM inventory WHERE aging_alert='CRITICAL'),
    (SELECT coalesce(sum(holding_cost_accrued),0) FROM inventory),
    (SELECT count(*) FROM audit_log),
    -- INV-001: the class is the authority, not the raw status.
    (SELECT count(*) FROM audit_log
      WHERE nexus_outcome_class(workflow, status, summary) = 'FAILURE'),
    'nexus_outcome_class',
    (SELECT count(*) FROM audit_log
      WHERE nexus_outcome_class(workflow, status, summary) = 'FAILURE')
  ON CONFLICT (snapshot_date) DO UPDATE SET
    open_leads=excluded.open_leads, hot_leads=excluded.hot_leads,
    warm_leads=excluded.warm_leads, cold_leads=excluded.cold_leads,
    avg_response_minutes=excluded.avg_response_minutes,
    pipeline_aed=excluded.pipeline_aed, units_at_risk=excluded.units_at_risk,
    holding_cost_aed=excluded.holding_cost_aed,
    workflow_runs=excluded.workflow_runs, workflow_failures=excluded.workflow_failures,
    workflow_failures_rule=excluded.workflow_failures_rule,
    workflow_failures_canonical=excluded.workflow_failures_canonical,
    captured_at=now();
$function$;