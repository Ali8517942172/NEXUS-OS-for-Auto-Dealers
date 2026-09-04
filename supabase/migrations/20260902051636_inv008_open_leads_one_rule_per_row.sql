-- INV-008 / open_leads. Business rule: a lead is OPEN unless its status is a
-- terminal one (won or dead). That rule lives in exactly one place —
-- public.nexus_lead_is_open(status) — which mirrors TERMINAL_TONES/isOpenLead in
-- apps/executive-dashboard/lib/pipeline.js. A status nobody has taught the tone
-- table about is OPEN: a lead is not finished because a word was not recognised.
--
-- What was wrong: capture_daily_metrics() wrote ONE row carrying TWO definitions
-- of "open". pipeline_aed had already been repointed at nexus_lead_is_open
-- (migration inv008_pipeline_daily_metrics_open_leads, 2026-09-02 05:01), but
-- open_leads two lines above it still used `status <> 'CLOSED' OR status IS NULL`
-- — a test that misses DISQUALIFIED, LOST, WON, JUNK and every other terminal
-- word. Live proof on 2026-09-02: open_leads = 3 while only 1 of the 3 leads is
-- open under the shared rule (34 and 35 are DISQUALIFIED). The snapshot told the
-- dealership it had three open leads while the dashboard's own rule said one.
--
-- hot_leads / warm_leads / cold_leads are NOT repointed. They ask a different
-- question — which router bucket a lead sits in — and every one of HOT, WARM and
-- COLD is already open under nexus_lead_is_open, so they cannot disagree with it.
-- avg_response_minutes is NOT repointed either: it measures how fast the BDC
-- answered, over every lead that has a response time, and a disqualified lead was
-- still answered. Filtering it here would silently change a published metric
-- (2.50 -> 4.00 today) rather than fix an inconsistency.

ALTER TABLE public.daily_metrics
  ADD COLUMN IF NOT EXISTS open_leads_rule text;

COMMENT ON COLUMN public.daily_metrics.open_leads IS
  'Open-lead count as recorded on the day, under the rule named in open_leads_rule. Never restated.';

COMMENT ON COLUMN public.daily_metrics.open_leads_rule IS
  'INV-008. Which open-lead rule produced this row''s open_leads. ''status_not_closed'' = count(status <> ''CLOSED'' OR status IS NULL), which counts DISQUALIFIED, LOST and WON leads as open (the rule up to 2026-09-02). ''nexus_lead_is_open'' = count(public.nexus_lead_is_open(status)) (the rule from 2026-09-02, matching apps/executive-dashboard/lib/pipeline.js). No open_leads_canonical column exists because `leads` keeps no history — no history table, no updated_at, no soft delete — so a past status is not recoverable; worse, snapshots from 2026-08-19 to 2026-08-25 counted leads that have since been deleted outright. The old rows can only be guessed at, and a guess in the column that exists to make a rule checkable is worse than no column.';

-- Old rows keep the number that was published on the day; only the label is
-- added, so the change is dated and visible instead of history being rewritten.
-- Today's row is left alone here — the re-run of capture_daily_metrics() below
-- restamps it, because that row is genuinely recomputed from live data.
UPDATE public.daily_metrics
   SET open_leads_rule = 'status_not_closed'
 WHERE open_leads_rule IS NULL;

-- capture_daily_metrics — writes today's daily_metrics snapshot, upserting on
-- snapshot_date so re-running it the same day refreshes rather than duplicates.
-- Scheduled by pg_cron; see section 9.
--
-- THREE RULES CHANGED IN THIS BODY AND ALL THREE ARE NAMED IN THE ROW IT WRITES:
--   * workflow_failures is counted by nexus_outcome_class(...) = 'FAILURE',
--     NOT by status = 'FAILED'. The rule name is stamped into
--     workflow_failures_rule so a reader of an old row can tell which count
--     they are looking at.
--   * pipeline_aed sums budget_aed over OPEN leads only (nexus_lead_is_open)
--     and is left NULL when nothing is known, rather than coalesced to 0.
--     A pipeline of "unknown" is not a pipeline of zero.
--   * open_leads counts the same nexus_lead_is_open(status) that pipeline_aed
--     sums over. One row, one definition of "open"; the rule name is stamped
--     into open_leads_rule.
CREATE OR REPLACE FUNCTION public.capture_daily_metrics()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO daily_metrics AS d (snapshot_date, open_leads, open_leads_rule,
    hot_leads, warm_leads,
    cold_leads, avg_response_minutes, pipeline_aed, pipeline_aed_rule, units_at_risk,
    holding_cost_aed, workflow_runs, workflow_failures,
    workflow_failures_rule, workflow_failures_canonical)
  SELECT current_date,
    -- INV-008: the one shared open-lead rule, the same one pipeline_aed sums over.
    (SELECT count(*) FROM leads WHERE nexus_lead_is_open(status)),
    'nexus_lead_is_open',
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
    open_leads=excluded.open_leads, open_leads_rule=excluded.open_leads_rule,
    hot_leads=excluded.hot_leads,
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