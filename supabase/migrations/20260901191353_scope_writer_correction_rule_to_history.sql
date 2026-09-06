-- Rule 1 was a correction for writers that mislabelled their own rows: any
-- summary containing "did not land" classified as PARTIAL whatever the status
-- said. Finance Calc and Master Router both wrote FAILED over work that had
-- half-landed - "Quote issued | 1 of 1 claimed steps did not land" under status
-- FAILED, when the customer had the quote and only the record was lost.
--
-- Both writers were fixed on the box today; neither can emit FAILED any more.
-- The obvious next step was to delete the rule. Two reasons not to, and a third
-- option that beats both:
--
--   Deleting it now reclassifies six historical rows from PARTIAL to FAILURE and
--   empties the Finance Desk's "quote issued, record lost" panel - which reads
--   them with no time window - so the dashboard would permanently forget the
--   quotes that were issued and never recorded.
--
--   Rewriting those six audit_log rows to say PARTIAL would let the rule go, but
--   an audit log records what happened, INCLUDING what the system wrongly wrote.
--   Editing it destroys the evidence that the writers were once wrong. That is
--   not a trade this project should make on a day spent removing false claims.
--
-- So the rule stays and is bounded instead. It applies only to rows logged
-- before the writers were fixed. History keeps being read correctly; anything
-- new is judged purely on the status its writer emitted, so a future writer
-- regression shows up as FAILURE instead of being silently corrected.
--
-- Cutoff verified against live data: the newest FAILED row carrying the phrase
-- is 2026-08-31 04:03:40 UTC. No row after the cutoff has that combination.

create or replace function public.nexus_outcome_class(
  p_workflow text, p_status text, p_summary text)
returns text
language sql
immutable
as $$
  select case
    -- 1. Bounded writer correction. See the note above; do not widen the window.
    when coalesce(p_summary,'') ~* 'did not land'
     and upper(coalesce(p_status,'')) in ('FAILED','SUCCESS')             then 'PARTIAL'
    when upper(coalesce(p_status,'')) = 'ESCALATED'                       then 'ESCALATED'
    when upper(coalesce(p_status,'')) = 'PARTIAL'                         then 'PARTIAL'
    when upper(coalesce(p_status,'')) = 'NOT_EXECUTED'                    then 'NO_RESULT'
    when upper(coalesce(p_status,'')) = 'REJECTED' then
      case when coalesce(p_summary,'') ~* 'unauthor|forbidden|refused by validation|invalid token|not permitted'
           then 'REJECTED_EXPECTED'
           else 'NO_RESULT'
      end
    when upper(coalesce(p_status,'')) = 'FAILED'                          then 'FAILURE'
    when upper(coalesce(p_status,'')) = 'SUCCESS'                         then 'SUCCESS'
    else 'UNKNOWN'
  end;
$$;

comment on function public.nexus_outcome_class(text,text,text) is
'Canonical audit_log outcome vocabulary: SUCCESS, PARTIAL, FAILURE, NO_RESULT, REJECTED_EXPECTED, ESCALATED, UNKNOWN. Sole authority - no screen may map status to health itself. Rule 1 corrects two writers that labelled a partial delivery as FAILED; both were fixed on 2026-09-01 and the rule is kept only because rewriting the historical rows would destroy the record of the mistake. lib/health.js mirrors this function exactly.';