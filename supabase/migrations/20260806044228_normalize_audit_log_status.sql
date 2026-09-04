-- audit_log.status held both 'SUCCESS' (25) and 'Success' (10). Any GROUP BY in
-- the UI would render these as two separate categories. Normalise, then add a
-- constraint so it cannot drift again.
UPDATE audit_log SET status = upper(trim(status)) WHERE status IS DISTINCT FROM upper(trim(status));

ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_status_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_status_check
  CHECK (status = upper(status));

CREATE INDEX IF NOT EXISTS idx_audit_log_logged_at ON audit_log (logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_workflow  ON audit_log (workflow);
CREATE INDEX IF NOT EXISTS idx_audit_log_status    ON audit_log (status);