-- Extend finance_quotes with EMI (monthly instalment) fields and calculation evidence.
-- Every finance number shown to a customer must be traceable back to a real calculator run.

ALTER TABLE public.finance_quotes
  -- EMI / quote inputs and outputs
  ADD COLUMN IF NOT EXISTS vehicle_price_aed              bigint,
  ADD COLUMN IF NOT EXISTS max_ltv_pct                    numeric,
  ADD COLUMN IF NOT EXISTS min_down_payment_aed           bigint,
  ADD COLUMN IF NOT EXISTS down_payment_aed               bigint,
  ADD COLUMN IF NOT EXISTS down_payment_pct               numeric,
  ADD COLUMN IF NOT EXISTS down_payment_assumed           boolean,
  ADD COLUMN IF NOT EXISTS trade_in_equity_applied_aed    bigint,
  ADD COLUMN IF NOT EXISTS financed_aed                   bigint,
  ADD COLUMN IF NOT EXISTS tenure_months                  integer,
  ADD COLUMN IF NOT EXISTS monthly_payment_low_aed        bigint,
  ADD COLUMN IF NOT EXISTS monthly_payment_high_aed       bigint,
  ADD COLUMN IF NOT EXISTS total_cost_of_credit_low_aed   bigint,
  ADD COLUMN IF NOT EXISTS total_cost_of_credit_high_aed  bigint,
  ADD COLUMN IF NOT EXISTS indicative_apr_high_pct        numeric,
  -- Evidence / provenance
  ADD COLUMN IF NOT EXISTS calculation_id                 uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS execution_id                   text,
  ADD COLUMN IF NOT EXISTS calculated_at                  timestamptz,
  ADD COLUMN IF NOT EXISTS apr_source                     text,
  ADD COLUMN IF NOT EXISTS ltv_policy_source              text;

COMMENT ON COLUMN public.finance_quotes.vehicle_price_aed IS
  'Sticker / agreed price of the vehicle being financed, in AED. Distinct from vehicle_value_aed, which is the value of the customer''s trade-in.';
COMMENT ON COLUMN public.finance_quotes.max_ltv_pct IS
  'Maximum loan-to-value percentage the lender policy allows for this customer/vehicle. Drives min_down_payment_aed.';
COMMENT ON COLUMN public.finance_quotes.min_down_payment_aed IS
  'Smallest down payment the policy permits, in AED: vehicle_price_aed * (1 - max_ltv_pct/100).';
COMMENT ON COLUMN public.finance_quotes.down_payment_aed IS
  'Down payment actually used in this quote, in AED.';
COMMENT ON COLUMN public.finance_quotes.down_payment_pct IS
  'down_payment_aed expressed as a percentage of vehicle_price_aed.';
COMMENT ON COLUMN public.finance_quotes.down_payment_assumed IS
  'TRUE when the customer did not state a down payment and the calculator assumed one (typically the regulatory minimum). Prevents an assumed figure being read later as a customer commitment.';
COMMENT ON COLUMN public.finance_quotes.trade_in_equity_applied_aed IS
  'Portion of trade-in equity applied against the purchase, in AED. May be less than equity_aed if the customer takes some as cash.';
COMMENT ON COLUMN public.finance_quotes.financed_aed IS
  'Principal actually financed, in AED: vehicle_price_aed - down_payment_aed - trade_in_equity_applied_aed.';
COMMENT ON COLUMN public.finance_quotes.tenure_months IS
  'Repayment term in months. CBUAE Regulation 29/2011 caps car-loan repayment at 60 months, enforced by finance_quotes_tenure_months_check.';
COMMENT ON COLUMN public.finance_quotes.monthly_payment_low_aed IS
  'Low end of the indicative monthly instalment range, in AED - corresponds to indicative_apr_pct (the low APR).';
COMMENT ON COLUMN public.finance_quotes.monthly_payment_high_aed IS
  'High end of the indicative monthly instalment range, in AED - corresponds to indicative_apr_high_pct.';
COMMENT ON COLUMN public.finance_quotes.total_cost_of_credit_low_aed IS
  'Total interest/profit paid over the full tenure at the low APR, in AED: (monthly_payment_low_aed * tenure_months) - financed_aed.';
COMMENT ON COLUMN public.finance_quotes.total_cost_of_credit_high_aed IS
  'Total interest/profit paid over the full tenure at the high APR, in AED.';
COMMENT ON COLUMN public.finance_quotes.indicative_apr_pct IS
  'LOW end of the indicative APR range (the most favourable rate). Its meaning is unchanged and must not be redefined - audits read this column. The upper bound lives in indicative_apr_high_pct.';
COMMENT ON COLUMN public.finance_quotes.indicative_apr_high_pct IS
  'HIGH end of the indicative APR range. Paired with indicative_apr_pct (the low end) so a quote is never read as a single optimistic rate.';
COMMENT ON COLUMN public.finance_quotes.calculation_id IS
  'Identifier of the individual calculator run that produced this quote. Defaulted so no row can exist without one; lets a quote shown to a customer be tied back to the exact computation.';
COMMENT ON COLUMN public.finance_quotes.execution_id IS
  'Workflow execution identifier (e.g. the n8n execution id) that performed the calculation, for end-to-end trace back to logs.';
COMMENT ON COLUMN public.finance_quotes.calculated_at IS
  'Wall-clock time the figures were computed, as reported by the calculator. Distinct from created_at, which is when the row reached this database.';
COMMENT ON COLUMN public.finance_quotes.apr_source IS
  'Provenance of the APR used, e.g. ''aecb_band_table_v2'' - which rate table/version supplied indicative_apr_pct and indicative_apr_high_pct.';
COMMENT ON COLUMN public.finance_quotes.ltv_policy_source IS
  'Provenance of the LTV rule applied, e.g. ''cbuae_reg_29_2011'' - which policy set max_ltv_pct and therefore min_down_payment_aed.';

-- CHECK constraints

ALTER TABLE public.finance_quotes
  ADD CONSTRAINT finance_quotes_tenure_months_check
  CHECK (tenure_months IS NULL OR (tenure_months >= 12 AND tenure_months <= 60));
COMMENT ON CONSTRAINT finance_quotes_tenure_months_check ON public.finance_quotes IS
  'CBUAE Regulation 29/2011 caps car-loan repayment at 60 months; 12 months is the shortest term the desk writes. NULL allowed for quotes that carry no instalment.';

ALTER TABLE public.finance_quotes
  ADD CONSTRAINT finance_quotes_down_payment_pct_check
  CHECK (down_payment_pct IS NULL OR (down_payment_pct >= 0 AND down_payment_pct <= 100));
COMMENT ON CONSTRAINT finance_quotes_down_payment_pct_check ON public.finance_quotes IS
  'A down payment percentage outside 0-100 is arithmetically impossible and would corrupt every derived figure.';

ALTER TABLE public.finance_quotes
  ADD CONSTRAINT finance_quotes_monthly_payment_range_check
  CHECK (monthly_payment_low_aed IS NULL OR monthly_payment_high_aed IS NULL
         OR monthly_payment_low_aed <= monthly_payment_high_aed);
COMMENT ON CONSTRAINT finance_quotes_monthly_payment_range_check ON public.finance_quotes IS
  'The instalment range must not be inverted; a low end above the high end would let the desk quote a floor that is really a ceiling.';

ALTER TABLE public.finance_quotes
  ADD CONSTRAINT finance_quotes_apr_range_check
  CHECK (indicative_apr_pct IS NULL OR indicative_apr_high_pct IS NULL
         OR indicative_apr_pct <= indicative_apr_high_pct);
COMMENT ON CONSTRAINT finance_quotes_apr_range_check ON public.finance_quotes IS
  'indicative_apr_pct is the LOW end of the APR range and must never exceed indicative_apr_high_pct.';

ALTER TABLE public.finance_quotes
  ADD CONSTRAINT finance_quotes_emi_complete
  CHECK (
    (monthly_payment_low_aed IS NULL AND monthly_payment_high_aed IS NULL)
    OR (financed_aed IS NOT NULL AND tenure_months IS NOT NULL AND down_payment_aed IS NOT NULL)
  );
COMMENT ON CONSTRAINT finance_quotes_emi_complete ON public.finance_quotes IS
  'A quote that carries a monthly instalment must also carry financed_aed, tenure_months and down_payment_aed. An instalment with no terms beside it is a misleading record: the customer cannot tell what principal, term or deposit produced it.';
