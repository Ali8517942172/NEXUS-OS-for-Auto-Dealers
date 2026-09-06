-- The KYC workflow (Phase 5) runs a 3-attempt re-upload loop and escalates to
-- Slack, but had nowhere to store a reviewable record. Everything lived in
-- audit_log summaries and [KYC-*] strings inside communication_logs.
CREATE TABLE IF NOT EXISTS kyc_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_email       text,
  lead_name        text,
  chat_id          text,
  document_type    text,
  full_name        text,
  date_of_birth    text,
  expiry_date      text,
  is_valid         boolean,
  tampering        boolean,
  confidence_score integer CHECK (confidence_score BETWEEN 0 AND 100),
  remarks          text,
  attempt_number   integer NOT NULL DEFAULT 1,
  max_attempts     integer NOT NULL DEFAULT 3,
  verdict          text NOT NULL DEFAULT 'PENDING'
                   CHECK (verdict IN ('PENDING','APPROVED','REJECTED','ESCALATED')),
  reviewed_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kyc_verdict ON kyc_documents (verdict);
CREATE INDEX IF NOT EXISTS idx_kyc_created ON kyc_documents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kyc_email   ON kyc_documents (lead_email);

-- The Overview KPI cards showed hardcoded deltas ("-18s vs last week",
-- "+AED 505K"). There was no historical snapshot to compute a delta from, so
-- those strings were fiction. This table makes them real from the first snapshot
-- onward; until two rows exist the UI must render no delta at all.
CREATE TABLE IF NOT EXISTS daily_metrics (
  snapshot_date        date PRIMARY KEY DEFAULT current_date,
  open_leads           integer,
  hot_leads            integer,
  warm_leads           integer,
  cold_leads           integer,
  avg_response_minutes numeric(10,2),
  pipeline_aed         bigint,
  units_at_risk        integer,
  holding_cost_aed     bigint,
  workflow_runs        integer,
  workflow_failures    integer,
  captured_at          timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION capture_daily_metrics() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO daily_metrics AS d (snapshot_date, open_leads, hot_leads, warm_leads,
    cold_leads, avg_response_minutes, pipeline_aed, units_at_risk,
    holding_cost_aed, workflow_runs, workflow_failures)
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
    (SELECT count(*) FROM audit_log WHERE status='FAILED')
  ON CONFLICT (snapshot_date) DO UPDATE SET
    open_leads=excluded.open_leads, hot_leads=excluded.hot_leads,
    warm_leads=excluded.warm_leads, cold_leads=excluded.cold_leads,
    avg_response_minutes=excluded.avg_response_minutes,
    pipeline_aed=excluded.pipeline_aed, units_at_risk=excluded.units_at_risk,
    holding_cost_aed=excluded.holding_cost_aed,
    workflow_runs=excluded.workflow_runs, workflow_failures=excluded.workflow_failures,
    captured_at=now();
$$;

SELECT capture_daily_metrics();

CREATE INDEX IF NOT EXISTS idx_comm_lead_email ON communication_logs (lead_email);
CREATE INDEX IF NOT EXISTS idx_comm_created    ON communication_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_aging ON inventory (aging_alert);