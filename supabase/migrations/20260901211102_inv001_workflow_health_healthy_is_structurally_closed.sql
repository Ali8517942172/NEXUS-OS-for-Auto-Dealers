-- INV-001 · HEALTHY must mean what lib/health.js says it means: "Every qualifying
-- run in the window succeeded outright." The health CASE did not enforce that.
-- PARTIAL and FAILURE had their own DEGRADED branches, so they were forbidden --
-- but NO_RESULT only forced PRODUCING_NOTHING once it passed half of
-- effective_runs_30d, and ESCALATED was excluded from the denominator entirely
-- and had no branch at all. Replaying the CASE over synthetic counters returned
-- HEALTHY for 1 NOT_EXECUTED + 10 SUCCESS (10 of 11 succeeded, not every one)
-- and for 2 ESCALATED + 10 SUCCESS. Both were green by luck of the data, not by
-- construction.
--
-- Business rule: a green pill is only allowed when nothing in the 30-day window
-- did anything other than succeed. One run that produced nothing, or one case
-- handed to a person, is enough to take the green away.
--
-- Two branches are added. Both emit DEGRADED, which is a deliberate constraint,
-- not a preference: lib/health.js's HEALTH_WORDS is a closed set of seven values
-- and an eighth would silently render as "Unrecognised". DEGRADED is the only
-- existing non-green word that means "something in this window did not deliver".
--
--   * escalated_30d > 0 -> DEGRADED, placed above NO_QUALIFYING_RUNS so a
--     workflow whose whole window was escalations is not described as "refused
--     by design", which is what NO_QUALIFYING_RUNS asserts and would be false.
--
--   * no_result_30d > 0 -> DEGRADED, placed BELOW the PRODUCING_NOTHING branch,
--     deliberately against the order suggested in NEXUS_INVARIANTS.md. Above it,
--     a workflow producing nothing on most of its runs would be relabelled from
--     PRODUCING_NOTHING to DEGRADED -- that would move Competitor Price Scraping
--     (94 no-results of 108) off the precise word onto a vaguer one and change a
--     live label for the worse. Below it, the majority case keeps
--     PRODUCING_NOTHING and only the minority case -- previously green -- moves.
--
-- The denominator is NOT changed. Including escalations in effective_runs_30d
-- would move published success rates (KYC/AML 0.0% over 7 would become 0.0% over
-- 9) without making HEALTHY any closer, since the ELSE branch would still be
-- reachable. The branch does the closing; the rate keeps its meaning.
--
-- After this, HEALTHY is reachable only when failures, partials, unknowns,
-- escalations and no-results are all zero and effective_runs_30d > 0 -- which
-- forces effective_runs_30d = successes_30d and success_rate_30d = 100.0.
-- No workflow's current label changes: the only two HEALTHY workflows (Ask-AI,
-- Inventory Ageing Recompute) carry zero no-results and zero escalations, and
-- the only workflow with escalations (KYC/AML, 2) is already DEGRADED on its
-- 7 failures. Nothing depends on this view.

create or replace view public.v_workflow_health as
 SELECT r.id,
    r.name,
    r.category,
    r.trigger_type,
    r.trigger_detail,
    r.description,
    r.is_active,
    r.writes_audit_log,
    COALESCE(a.runs, 0::bigint) AS runs,
    COALESCE(a.failures, 0::bigint) AS failures,
    COALESCE(a.escalations, 0::bigint) AS escalations,
    COALESCE(a.runs_30d, 0::bigint) AS runs_30d,
    COALESCE(a.failures_30d, 0::bigint) AS failures_30d,
    COALESCE(a.partials_30d, 0::bigint) AS partials_30d,
    COALESCE(a.no_result_30d, 0::bigint) AS no_result_30d,
    COALESCE(a.rejected_30d, 0::bigint) AS rejected_30d,
    COALESCE(a.escalated_30d, 0::bigint) AS escalated_30d,
    COALESCE(a.successes_30d, 0::bigint) AS successes_30d,
    COALESCE(a.unknown_30d, 0::bigint) AS unknown_30d,
    COALESCE(a.effective_runs_30d, 0::bigint) AS effective_runs_30d,
        CASE
            WHEN COALESCE(a.effective_runs_30d, 0::bigint) = 0 THEN NULL::numeric
            ELSE round(100.0 * a.successes_30d::numeric / a.effective_runs_30d::numeric, 1)
        END AS success_rate_30d,
        CASE
            WHEN COALESCE(a.effective_runs, 0::bigint) = 0 THEN NULL::numeric
            ELSE round(100.0 * a.successes::numeric / a.effective_runs::numeric, 1)
        END AS success_rate,
    a.last_run,
    a.last_success,
    a.last_failure,
    a.last_partial,
    a.last_incomplete,
        CASE
            WHEN NOT r.writes_audit_log THEN 'NOT_INSTRUMENTED'::text
            WHEN COALESCE(a.runs, 0::bigint) = 0 THEN 'NEVER_RAN'::text
            WHEN COALESCE(a.failures_30d, 0::bigint) > 0 THEN 'DEGRADED'::text
            WHEN COALESCE(a.partials_30d, 0::bigint) > 0 THEN 'DEGRADED'::text
            WHEN COALESCE(a.unknown_30d, 0::bigint) > 0 THEN 'UNKNOWN_OUTCOME'::text
            -- INV-001: a case handed to a person is not an outright success.
            WHEN COALESCE(a.escalated_30d, 0::bigint) > 0 THEN 'DEGRADED'::text
            WHEN COALESCE(a.effective_runs_30d, 0::bigint) = 0 THEN 'NO_QUALIFYING_RUNS'::text
            WHEN (COALESCE(a.no_result_30d, 0::bigint) * 2) > COALESCE(a.effective_runs_30d, 0::bigint) THEN 'PRODUCING_NOTHING'::text
            -- INV-001: a minority of runs that produced nothing is still not green.
            WHEN COALESCE(a.no_result_30d, 0::bigint) > 0 THEN 'DEGRADED'::text
            ELSE 'HEALTHY'::text
        END AS health
   FROM workflow_registry r
     LEFT JOIN LATERAL ( SELECT count(*) AS runs,
            count(*) FILTER (WHERE x.c = 'FAILURE'::text) AS failures,
            count(*) FILTER (WHERE x.c = 'ESCALATED'::text) AS escalations,
            count(*) FILTER (WHERE x.c = 'SUCCESS'::text) AS successes,
            count(*) FILTER (WHERE x.c <> ALL (ARRAY['REJECTED_EXPECTED'::text, 'ESCALATED'::text])) AS effective_runs,
            count(*) FILTER (WHERE x.recent) AS runs_30d,
            count(*) FILTER (WHERE x.recent AND x.c = 'FAILURE'::text) AS failures_30d,
            count(*) FILTER (WHERE x.recent AND x.c = 'PARTIAL'::text) AS partials_30d,
            count(*) FILTER (WHERE x.recent AND x.c = 'NO_RESULT'::text) AS no_result_30d,
            count(*) FILTER (WHERE x.recent AND x.c = 'REJECTED_EXPECTED'::text) AS rejected_30d,
            count(*) FILTER (WHERE x.recent AND x.c = 'ESCALATED'::text) AS escalated_30d,
            count(*) FILTER (WHERE x.recent AND x.c = 'SUCCESS'::text) AS successes_30d,
            count(*) FILTER (WHERE x.recent AND x.c = 'UNKNOWN'::text) AS unknown_30d,
            count(*) FILTER (WHERE x.recent AND (x.c <> ALL (ARRAY['REJECTED_EXPECTED'::text, 'ESCALATED'::text]))) AS effective_runs_30d,
            max(x.logged_at) AS last_run,
            max(x.logged_at) FILTER (WHERE x.c = 'SUCCESS'::text) AS last_success,
            max(x.logged_at) FILTER (WHERE x.c = 'FAILURE'::text) AS last_failure,
            max(x.logged_at) FILTER (WHERE x.c = 'PARTIAL'::text) AS last_partial,
            max(x.logged_at) FILTER (WHERE x.c = ANY (ARRAY['FAILURE'::text, 'PARTIAL'::text])) AS last_incomplete
           FROM ( SELECT l.logged_at,
                    l.logged_at > (now() - '30 days'::interval) AS recent,
                    nexus_outcome_class(l.workflow, l.status, l.summary) AS c
                   FROM audit_log l
                  WHERE l.workflow = r.name OR l.workflow = r.audit_name OR (l.workflow = ANY (r.audit_aliases))) x) a ON true;