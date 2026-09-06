-- One canonical status -> outcome mapping for the whole system.
-- Every dashboard must consume this; no screen may re-interpret audit_log.status.
--
-- Why this is not a pure function of status: the writers disagree with themselves.
-- Finance Calc writes FAILED on a row whose own summary reads
--   "Quote issued | 1 of 1 claimed steps did not land [finance_quotes row ...]"
-- and Master Router does the same. That is a partial delivery, not a failure --
-- the customer got the quote, the record did not land. So the structured phrase
-- the writers already emit ("N of M claimed steps did not land") outranks status.
-- This correction is deliberate and temporary: fix the writers, then delete rule 1.
--
-- Why REJECTED cannot be classified globally: it means two different things.
--   Ask-AI      REJECTED = "Unauthorized request rejected"          -> refused by design
--   Finance Calc REJECTED = "quote refused by validation"            -> refused by design
--   Competitor   REJECTED = "no usable intel ... no price extracted" -> ran, found nothing
-- 73 of Competitor Price Scraping's 84 runs are the third kind. Calling those
-- "expected rejections" would hide an 87% miss rate behind a green pill.

create or replace function public.nexus_outcome_class(
  p_workflow text, p_status text, p_summary text)
returns text
language sql
immutable
as $$
  select case
    -- 1. Writer correction: structured partial-delivery evidence outranks status.
    when coalesce(p_summary,'') ~* 'did not land'                         then 'PARTIAL'
    when upper(coalesce(p_status,'')) = 'ESCALATED'                       then 'ESCALATED'
    when upper(coalesce(p_status,'')) = 'PARTIAL'                         then 'PARTIAL'
    when upper(coalesce(p_status,'')) = 'NOT_EXECUTED'                    then 'NO_RESULT'
    when upper(coalesce(p_status,'')) = 'REJECTED' then
      case when coalesce(p_summary,'') ~* 'unauthor|forbidden|refused by validation|invalid token|not permitted'
           then 'REJECTED_EXPECTED'
           else 'NO_RESULT'   -- ran, produced nothing usable
      end
    when upper(coalesce(p_status,'')) = 'FAILED'                          then 'FAILURE'
    when upper(coalesce(p_status,'')) = 'SUCCESS'                         then 'SUCCESS'
    else 'UNKNOWN'
  end;
$$;

comment on function public.nexus_outcome_class(text,text,text) is
'Canonical audit_log outcome vocabulary: SUCCESS, PARTIAL, FAILURE, NO_RESULT, REJECTED_EXPECTED, ESCALATED, UNKNOWN. Sole authority - no screen may map status to health itself.';

drop view if exists public.v_workflow_health;

create view public.v_workflow_health
with (security_invoker = on)
as
select
  r.id, r.name, r.category, r.trigger_type, r.trigger_detail, r.description,
  r.is_active, r.writes_audit_log,

  coalesce(a.runs, 0)              as runs,
  coalesce(a.failures, 0)          as failures,
  coalesce(a.escalations, 0)       as escalations,

  coalesce(a.runs_30d, 0)          as runs_30d,
  coalesce(a.failures_30d, 0)      as failures_30d,
  coalesce(a.partials_30d, 0)      as partials_30d,
  coalesce(a.no_result_30d, 0)     as no_result_30d,
  coalesce(a.rejected_30d, 0)      as rejected_30d,
  coalesce(a.escalated_30d, 0)     as escalated_30d,
  coalesce(a.successes_30d, 0)     as successes_30d,
  coalesce(a.unknown_30d, 0)       as unknown_30d,

  -- Runs that were supposed to produce work. Refusals by design are excluded
  -- from the denominator so an auth rejection cannot dilute a real miss rate.
  coalesce(a.effective_runs_30d, 0) as effective_runs_30d,

  case when coalesce(a.effective_runs_30d,0) = 0 then null::numeric
       else round(100.0 * a.successes_30d::numeric / a.effective_runs_30d::numeric, 1)
  end as success_rate_30d,

  -- Kept for continuity with the old view; now computed on the same semantics.
  case when coalesce(a.effective_runs,0) = 0 then null::numeric
       else round(100.0 * a.successes::numeric / a.effective_runs::numeric, 1)
  end as success_rate,

  a.last_run, a.last_success, a.last_failure, a.last_partial, a.last_incomplete,

  case
    when not r.writes_audit_log                       then 'NOT_INSTRUMENTED'
    when coalesce(a.runs, 0) = 0                      then 'NEVER_RAN'
    when coalesce(a.failures_30d, 0) > 0              then 'DEGRADED'
    when coalesce(a.partials_30d, 0) > 0              then 'DEGRADED'
    when coalesce(a.unknown_30d, 0) > 0               then 'UNKNOWN_OUTCOME'
    when coalesce(a.effective_runs_30d, 0) = 0        then 'NO_QUALIFYING_RUNS'
    when coalesce(a.no_result_30d, 0) * 2 > coalesce(a.effective_runs_30d, 0)
                                                      then 'PRODUCING_NOTHING'
    else 'HEALTHY'
  end as health

from workflow_registry r
left join lateral (
  select
    count(*)                                                          as runs,
    count(*) filter (where c = 'FAILURE')                             as failures,
    count(*) filter (where c = 'ESCALATED')                           as escalations,
    count(*) filter (where c = 'SUCCESS')                             as successes,
    count(*) filter (where c not in ('REJECTED_EXPECTED','ESCALATED')) as effective_runs,

    count(*) filter (where recent)                                    as runs_30d,
    count(*) filter (where recent and c = 'FAILURE')                  as failures_30d,
    count(*) filter (where recent and c = 'PARTIAL')                  as partials_30d,
    count(*) filter (where recent and c = 'NO_RESULT')                as no_result_30d,
    count(*) filter (where recent and c = 'REJECTED_EXPECTED')        as rejected_30d,
    count(*) filter (where recent and c = 'ESCALATED')                as escalated_30d,
    count(*) filter (where recent and c = 'SUCCESS')                  as successes_30d,
    count(*) filter (where recent and c = 'UNKNOWN')                  as unknown_30d,
    count(*) filter (where recent and c not in ('REJECTED_EXPECTED','ESCALATED'))
                                                                      as effective_runs_30d,

    max(logged_at)                                                    as last_run,
    max(logged_at) filter (where c = 'SUCCESS')                       as last_success,
    max(logged_at) filter (where c = 'FAILURE')                       as last_failure,
    max(logged_at) filter (where c = 'PARTIAL')                       as last_partial,
    max(logged_at) filter (where c in ('FAILURE','PARTIAL'))           as last_incomplete
  from (
    select l.logged_at,
           l.logged_at > now() - interval '30 days' as recent,
           public.nexus_outcome_class(l.workflow, l.status, l.summary) as c
    from audit_log l
    where l.workflow = r.name
       or l.workflow = r.audit_name
       or l.workflow = any(r.audit_aliases)
  ) x
) a on true;

comment on view public.v_workflow_health is
'Workflow health on canonical outcome semantics (see nexus_outcome_class). DEGRADED on failures OR partials. PRODUCING_NOTHING when over half of qualifying runs yielded no result - this is what an 87% scrape miss rate looks like when it is not hidden behind a rejection label.';