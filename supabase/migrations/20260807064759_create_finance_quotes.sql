-- finance_calc produced a regulated financial figure (equity, LTV, tier,
-- indicative APR) and wrote it NOWHERE. Every quote given to a customer
-- vanished the moment the HTTP response was sent: no record of who was quoted
-- what, or when. For a number that ships with a lender disclaimer attached,
-- that is a liability, not a gap.
CREATE TABLE IF NOT EXISTS finance_quotes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_email         text,
  lead_name          text,
  quoted_by          text,
  vehicle_value_aed  bigint  NOT NULL,
  loan_payoff_aed    bigint  NOT NULL,
  credit_score       integer NOT NULL CHECK (credit_score BETWEEN 300 AND 900),
  equity_aed         bigint  NOT NULL,
  equity_status      text    NOT NULL CHECK (equity_status IN ('Positive','Negative')),
  loan_to_value_pct  numeric(6,2),
  finance_tier       text    NOT NULL,
  indicative_apr_pct numeric(5,2) NOT NULL,
  disclaimer         text    NOT NULL,
  source             text    NOT NULL DEFAULT 'webhook',
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fq_created ON finance_quotes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fq_email   ON finance_quotes (lead_email);

ALTER TABLE finance_quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_quotes_authenticated ON finance_quotes;
CREATE POLICY finance_quotes_authenticated ON finance_quotes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- No anon policy: quotes carry customer email, credit score and vehicle value.