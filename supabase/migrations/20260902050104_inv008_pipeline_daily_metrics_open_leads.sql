-- INV-008 · One number, one derivation — open pipeline, part 2 of 2.
--
-- BUSINESS RULE (identical to part 1, and to lib/pipeline.js). "Open pipeline"
-- is the sum of budget_aed over the leads still being worked — every lead not
-- in a won or dead state, with an unrecognised or absent status counted as
-- open. When no open lead carries a recorded budget the answer is NULL,
-- unknown, not 0.
--
-- capture_daily_metrics().pipeline_aed was
--   (SELECT coalesce(sum(budget_aed),0) FROM leads WHERE budget_aed IS NOT NULL)
-- — every lead in the table, won and dead included, floored at 0. It now reads
--   (SELECT sum(budget_aed) FROM leads WHERE public.nexus_lead_is_open(status))
-- The `budget_aed IS NOT NULL` guard is dropped because sum() already ignores
-- NULLs; it only ever existed to make the coalesce look deliberate.
--
-- HISTORY IS NOT REWRITTEN, following the precedent set on 2026-09-01 by
-- inv008_daily_metrics_failures_use_outcome_class: the published column keeps
-- the number it was captured with, and a new column dates the rule so the
-- change is visible instead of inferred. Two reasons here, one of them
-- stronger than in the precedent:
--   1. Same as the precedent — a snapshot is a record of what was reported on
--      a date. Silently restating it destroys the only evidence that the
--      figure ever moved.
--   2. Unlike audit_log, which retains every row with logged_at and so allowed
--      workflow_failures_canonical to be recomputed and then CHECKED against
--      the stored value on all 14 rows, `leads` keeps no history at all: no
--      status-change log, no updated_at, no soft delete. The 10 snapshots
--      reading 280000 were computed from leads that are no longer in the
--      table (3 rows remain, max id 38). The open/closed status and budget of
--      those leads on those dates is unrecoverable, so a pipeline_aed_canonical
--      column could not be backfilled with anything checkable — only guessed.
--      A guessed column in the column that exists to make a rule checkable is
--      worse than no column, so only the rule label is added.
alter table public.daily_metrics
  add column if not exists pipeline_aed_rule text;

comment on column public.daily_metrics.pipeline_aed_rule is
  'INV-008. Which open-pipeline rule produced this row''s pipeline_aed. '
  '''all_leads_coalesce_0'' = every lead in the table, no status filter, '
  'coalesced to 0 (the rule up to 2026-09-02). ''open_leads_null_when_unknown'' '
  '= open leads only, NULL when none carries a budget (the rule from '
  '2026-09-02, matching apps/executive-dashboard/lib/pipeline.js). No '
  'pipeline_aed_canonical column exists because `leads` keeps no history and '
  'the old rows cannot be recomputed and checked, only guessed.';

-- Label the existing snapshots with the rule that actually produced them.
-- Their pipeline_aed values are left exactly as captured.
update public.daily_metrics
   set pipeline_aed_rule = 'all_leads_coalesce_0'
 where pipeline_aed_rule is null;

-- Function body reproduced from pg_get_functiondef as captured immediately
-- before this migration; the only changes are the pipeline_aed subquery and
-- the pipeline_aed_rule column.
CREATE OR REPLACE FUNCTION public.capture_daily_metrics()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO daily_metrics AS d (snapshot_date, open_leads, hot_leads, warm_leads,
    cold_leads, avg_response_minutes, pipeline_aed, pipeline_aed_rule, units_at_risk,
    holding_cost_aed, workflow_runs, workflow_failures,
    workflow_failures_rule, workflow_failures_canonical)
  SELECT current_date,
    (SELECT count(*) FROM leads WHERE status <> 'CLOSED' OR status IS NULL),
    (SELECT count(*) FROM leads WHERE upper(status)='HOT'),
    (SELECT count(*) FROM leads WHERE upper(status)='WARM'),
    (SELECT count(*) FROM leads WHERE upper(status)='COLD'),
    (SELECT round(avg(response_time_minutes)::numeric,2) FROM leads WHERE response_time_minutes IS NOT NULL),
    -- INV-008: open leads only, and an absent budget stays unknown.
    (SELECT sum(budget_aed) FROM leads WHERE nexus_lead_is_open(status)),
    'open_leads_null_when_unknown',
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
    pipeline_aed=excluded.pipeline_aed,
    pipeline_aed_rule=excluded.pipeline_aed_rule,
    units_at_risk=excluded.units_at_risk,
    holding_cost_aed=excluded.holding_cost_aed,
    workflow_runs=excluded.workflow_runs, workflow_failures=excluded.workflow_failures,
    workflow_failures_rule=excluded.workflow_failures_rule,
    workflow_failures_canonical=excluded.workflow_failures_canonical,
    captured_at=now();
$function$;