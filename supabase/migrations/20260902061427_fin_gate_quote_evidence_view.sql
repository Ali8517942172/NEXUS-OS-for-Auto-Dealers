-- fin_gate_: the finance evidence gate, expressed once in the database.
--
-- BUSINESS RULE: no authoritative finance figure (APR, instalment, financed
-- amount, tenure, LTV) may be given to a customer or shown on a screen unless a
-- finance_quotes row stands behind it that can be traced back to the workflow
-- run that computed it. Evidence is a row carrying BOTH calculation_id and
-- execution_id. calculation_id alone is NOT evidence: the column defaults to
-- gen_random_uuid(), so a row acquires one whether or not the Finance Calc
-- workflow supplied it. execution_id is the only column that ties a figure to a
-- run somebody can open, and it is what the dealership needs the day a customer
-- or a bank disputes what was said.
--
-- security_invoker = true: this view must not become a way around the RLS on
-- finance_quotes. It is readable exactly as far as the caller's own grants on
-- the underlying table reach, and no further.
create or replace view public.v_fin_gate_quote_evidence
with (security_invoker = true) as
select
  q.id,
  q.lead_email,
  q.lead_name,
  q.quoted_by,
  q.created_at,
  q.calculated_at,
  q.calculation_id,
  q.execution_id,
  q.indicative_apr_pct,
  q.indicative_apr_high_pct,
  q.monthly_payment_low_aed,
  q.monthly_payment_high_aed,
  (q.calculation_id is not null and nullif(btrim(coalesce(q.execution_id, '')), '') is not null)
    as is_evidenced,
  case
    when nullif(btrim(coalesce(q.execution_id, '')), '') is null
      then 'untraceable: no execution_id, so this figure cannot be tied to a Finance Calc run'
    when q.calculation_id is null
      then 'untraceable: no calculation_id'
    else 'evidenced'
  end as evidence_note,
  -- Quotable-figure presence, stated separately from traceability. A row can be
  -- traceable and still carry no instalment; that is not a fault, it is the
  -- calculator declining to compute one, and the two must not be conflated.
  (q.monthly_payment_low_aed is not null) as has_instalment
from public.finance_quotes q;

comment on view public.v_fin_gate_quote_evidence is
  'FINANCE EVIDENCE GATE. One row per finance_quotes row. is_evidenced is TRUE only when the row carries both calculation_id and a non-blank execution_id; that combination is the only thing this dealership accepts as proof behind an APR, instalment, tenure, financed amount or LTV given to a customer. calculation_id alone is not proof (it defaults to gen_random_uuid()). Figures on rows where is_evidenced is FALSE must be rendered as unavailable with the reason, never as a number, a range or a blank. Mirrored in apps/executive-dashboard/screens/finance.js (quoteEvidence).';

grant select on public.v_fin_gate_quote_evidence to authenticated, service_role;