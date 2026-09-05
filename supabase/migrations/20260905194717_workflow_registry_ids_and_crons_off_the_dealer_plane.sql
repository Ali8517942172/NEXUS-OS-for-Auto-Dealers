-- ===========================================================================
-- STAGE 1.6 - workflow_registry was on the wrong plane.
--
-- CONTROL-PLANE.md 5.2 names the finding and the destination:
--
--   workflow_registry_read | PERMISSIVE | {authenticated} | SELECT | qual: true
--
--   no tenant_id column, 18 rows, and "the real n8n workflow ids, the human
--   names, the trigger type and detail - INCLUDING CRON EXPRESSIONS AND WEBHOOK
--   PATHS - and the is_active flag. That is which automations the platform
--   runs, on what schedule, at what address, and which are switched off. It is
--   operational configuration, not shipped vocabulary." The document's verdict
--   is that the dealership gets "a view over it ... stripped of `id`,
--   `trigger_detail` and anything else in Part 4 - not the table."
--
-- WHAT WAS MEASURED, 5 Sep 2026, ON PRODUCTION (dsvuoovivysszdoiorch):
--
--   relacl                = postgres=arwdDxtm , service_role=arwdDxtm ,
--                           authenticated=r
--   column grants (attacl)= none on all ten columns - so unlike
--                           policy_platform_attestation this one IS visible to
--                           the ACL query CLAUDE.md prescribes
--   rowcount              = 18
--   columns               = id, name, audit_name, trigger_type, trigger_detail,
--                           category, is_active, description, writes_audit_log,
--                           audit_aliases   (no tenant_id)
--
-- WHO ACTUALLY READS IT, measured rather than assumed:
--
--   IN THE DATABASE - four views, ALL security_invoker = true, all
--   authenticated=r, so each one is checked against the CALLER's privileges:
--     v_workflow_health            reads r.id, r.name, r.category,
--                                  r.trigger_type, r.trigger_detail,
--                                  r.description, r.is_active,
--                                  r.writes_audit_log
--     v_lead_recovery              reads r.name, r.audit_name, r.audit_aliases
--                                  only (joins audit_log to find the silence
--                                  detector's runs)
--     v_needs_attention            reads r.name, r.audit_name, r.audit_aliases
--                                  only (resolves a display name for a failing
--                                  workflow)
--     v_audit_unregistered_writers reads r.name, r.audit_name, r.audit_aliases
--                                  only (NOT EXISTS set difference)
--   No FUNCTION in public references it: pg_proc.prosrc ilike '%workflow_
--   registry%' returns zero rows.
--
--   OUTSIDE THE DATABASE - grep of the repo:
--     n8n-workflows/**   ZERO references. n8n does not read this table at all,
--                        so nothing NEXUS executes depends on this grant.
--     SCHEMA_PROBE.mjs   reads name,trigger_type,trigger_detail,is_active with
--                        SUPABASE_SERVICE_ROLE_KEY - unaffected.
--     QUALITY_GATE.mjs   reads it in the service_role catalogue query - and
--                        declares all ten columns as the expected shape, which
--                        this migration does not change.
--     the dashboard      reads it as `authenticated` from five screens, and
--                        EVERY ONE of those call sites already carries a
--                        written fallback for a failed read (settings.js:1245,
--                        automation.js:1250, campaigns.js:609, customers.js:575
--                        "workflow_registry answered 403 ...", ask.js:1667).
--
-- MECHANISM - the same one as 20260904112412, at the granularity 5.2 asks for.
--
--   That migration's rule was: revoke `authenticated` from control-plane
--   material, and it justified a WHOLE-TABLE revoke on the ground that the
--   table had no authenticated reader ("if an object has no reader for a role,
--   revoking costs nothing"). Here the converse holds and it is decisive: three
--   views a dealership legitimately reads - Lead Recovery, Needs Attention and
--   the unregistered-writer census - join this table, and being security_invoker
--   they would go to 42501 with it. A whole-table revoke would take the
--   flagship engine down to close a leak in a chip.
--
--   So the same verb is applied per column. Column-level grants are already
--   this database's established pattern for exactly this shape: CLAUDE.md
--   records channel_registry carrying `authenticated=r` on seven of eight
--   columns with `credential_ref` deliberately withheld, and calls that design
--   right. This is that, applied to the registry.
--
--   Withheld from `authenticated`:
--     id             - the real n8n workflow id. automation.js:1664 renders it
--                      verbatim in a mono cell today.
--     trigger_type   - webhook / schedule / sub-workflow / manual / error
--     trigger_detail - the cron expressions and the webhook paths
--   Kept for `authenticated`:
--     name, audit_name, audit_aliases  - the three the surviving views join on
--     category, description, is_active, writes_audit_log
--   Part 4's clarification is the line being drawn: "A dealership is entitled
--   to know that their own automation is broken ... symptom and impact to the
--   dealership; mechanism and location to the vendor." A workflow's name and
--   whether it is switched off is symptom. Its id and its cron is location.
--
-- WHY THE RLS POLICY IS LEFT ALONE.
--
--   workflow_registry_read (PERMISSIVE, SELECT, {authenticated}, USING true)
--   stays. CLAUDE.md: "RLS is one lock, not two." The row lock is not the lock
--   that was wrong here - the table is a global catalogue with no tenant
--   dimension, and the three surviving views need its rows to resolve a name.
--   The GRANT is the lock that decides what a column discloses, and that is the
--   one this migration moves. Dropping the policy instead would return zero
--   rows to those three views and break them SILENTLY, which is worse than
--   breaking them loudly.
--
--   Consequence, stated rather than hidden: QUALITY_GATE check L2 reads
--   POLICIES, so it stays red on this row, and L2_NOT_EXEMPT_NOTES still
--   describes it accurately. That is correct and deliberate. Every signed-in
--   user can still read WHICH automations exist and which are off; only the ids
--   and the schedules are closed. Giving this table a tenant_id remains a
--   BLOCKER for a second dealership and this migration does not claim to close
--   it. Nothing is added to L2_EXEMPT_TABLES.
--
-- WHY v_workflow_health IS REBUILT AND NOT LEFT ALONE.
--
--   Measured on staging in a rolled-back transaction, with the column grants
--   below in place and `set local role authenticated`:
--
--     select count(name) from public.workflow_registry   -> EXECUTED
--     select count(id)   from public.workflow_registry   -> 42501
--     select count(trigger_detail) from ...              -> 42501
--     select count(name) from public.v_workflow_health   -> 42501
--     select count(*) from public.v_lead_recovery              -> EXECUTED
--     select count(*) from public.v_needs_attention            -> EXECUTED
--     select count(*) from public.v_audit_unregistered_writers -> EXECUTED
--
--   A security_invoker view is checked on every base column ITS BODY reads, not
--   on the columns the outer query asked for - so selecting `name` alone from
--   v_workflow_health is refused because the body also reads r.id. Left as it
--   was, the view would be entirely unreadable by a dealership login, which
--   removes the one thing Part 4 says a dealership IS entitled to: knowing its
--   own automation is broken. So the view is rebuilt without the three
--   control-plane columns. It cannot be done with `create or replace view`,
--   which may add trailing columns but may not drop any; nothing depends on the
--   view (pg_depend: zero dependent views, zero functions), so it is dropped
--   and recreated.
--
--   `with (security_invoker = true)` is spelled out inline and the SECURITY
--   comment is restored verbatim, per the standing warning in
--   20260902051823 - this option has now been lost three times to a bare
--   `create or replace view`. Not one line of the health arithmetic changes:
--   the FROM, the LATERAL, the counts, the rates and the CASE that produces
--   `health` are byte-identical to what was measured out of pg_get_viewdef.
--
-- WHAT THIS DOES NOT CHANGE. service_role keeps ALL on the table and on the
-- view, and every one of the ten columns. n8n writes and reads as service_role
-- and does not touch this table at all. anon held nothing before and holds
-- nothing after.
-- ===========================================================================

-- --- workflow_registry: the table-wide read becomes a seven-column read -----
revoke select on public.workflow_registry from authenticated;
revoke all on public.workflow_registry from anon, public;

grant select (
  name, audit_name, audit_aliases, category, description, is_active,
  writes_audit_log
) on public.workflow_registry to authenticated;

-- --- v_workflow_health: same surface, minus id / trigger_type / trigger_detail
drop view public.v_workflow_health;

create view public.v_workflow_health with (security_invoker = true) as
 SELECT r.name,
    r.category,
    r.description,
    r.is_active,
    r.writes_audit_log,
    COALESCE(a.runs, (0)::bigint) AS runs,
    COALESCE(a.failures, (0)::bigint) AS failures,
    COALESCE(a.escalations, (0)::bigint) AS escalations,
    COALESCE(a.runs_30d, (0)::bigint) AS runs_30d,
    COALESCE(a.failures_30d, (0)::bigint) AS failures_30d,
    COALESCE(a.partials_30d, (0)::bigint) AS partials_30d,
    COALESCE(a.no_result_30d, (0)::bigint) AS no_result_30d,
    COALESCE(a.rejected_30d, (0)::bigint) AS rejected_30d,
    COALESCE(a.escalated_30d, (0)::bigint) AS escalated_30d,
    COALESCE(a.successes_30d, (0)::bigint) AS successes_30d,
    COALESCE(a.unknown_30d, (0)::bigint) AS unknown_30d,
    COALESCE(a.effective_runs_30d, (0)::bigint) AS effective_runs_30d,
        CASE
            WHEN (COALESCE(a.effective_runs_30d, (0)::bigint) = 0) THEN NULL::numeric
            ELSE round(((100.0 * (a.successes_30d)::numeric) / (a.effective_runs_30d)::numeric), 1)
        END AS success_rate_30d,
        CASE
            WHEN (COALESCE(a.effective_runs, (0)::bigint) = 0) THEN NULL::numeric
            ELSE round(((100.0 * (a.successes)::numeric) / (a.effective_runs)::numeric), 1)
        END AS success_rate,
    a.last_run,
    a.last_success,
    a.last_failure,
    a.last_partial,
    a.last_incomplete,
        CASE
            WHEN (NOT r.writes_audit_log) THEN 'NOT_INSTRUMENTED'::text
            WHEN (COALESCE(a.runs, (0)::bigint) = 0) THEN 'NEVER_RAN'::text
            WHEN (COALESCE(a.failures_30d, (0)::bigint) > 0) THEN 'DEGRADED'::text
            WHEN (COALESCE(a.partials_30d, (0)::bigint) > 0) THEN 'DEGRADED'::text
            WHEN (COALESCE(a.unknown_30d, (0)::bigint) > 0) THEN 'UNKNOWN_OUTCOME'::text
            WHEN (COALESCE(a.escalated_30d, (0)::bigint) > 0) THEN 'DEGRADED'::text
            WHEN (COALESCE(a.effective_runs_30d, (0)::bigint) = 0) THEN 'NO_QUALIFYING_RUNS'::text
            WHEN ((COALESCE(a.no_result_30d, (0)::bigint) * 2) > COALESCE(a.effective_runs_30d, (0)::bigint)) THEN 'PRODUCING_NOTHING'::text
            WHEN (COALESCE(a.no_result_30d, (0)::bigint) > 0) THEN 'DEGRADED'::text
            ELSE 'HEALTHY'::text
        END AS health
   FROM (workflow_registry r
     LEFT JOIN LATERAL ( SELECT count(*) AS runs,
            count(*) FILTER (WHERE (x.c = 'FAILURE'::text)) AS failures,
            count(*) FILTER (WHERE (x.c = 'ESCALATED'::text)) AS escalations,
            count(*) FILTER (WHERE (x.c = 'SUCCESS'::text)) AS successes,
            count(*) FILTER (WHERE (x.c <> ALL (ARRAY['REJECTED_EXPECTED'::text, 'ESCALATED'::text]))) AS effective_runs,
            count(*) FILTER (WHERE x.recent) AS runs_30d,
            count(*) FILTER (WHERE (x.recent AND (x.c = 'FAILURE'::text))) AS failures_30d,
            count(*) FILTER (WHERE (x.recent AND (x.c = 'PARTIAL'::text))) AS partials_30d,
            count(*) FILTER (WHERE (x.recent AND (x.c = 'NO_RESULT'::text))) AS no_result_30d,
            count(*) FILTER (WHERE (x.recent AND (x.c = 'REJECTED_EXPECTED'::text))) AS rejected_30d,
            count(*) FILTER (WHERE (x.recent AND (x.c = 'ESCALATED'::text))) AS escalated_30d,
            count(*) FILTER (WHERE (x.recent AND (x.c = 'SUCCESS'::text))) AS successes_30d,
            count(*) FILTER (WHERE (x.recent AND (x.c = 'UNKNOWN'::text))) AS unknown_30d,
            count(*) FILTER (WHERE (x.recent AND (x.c <> ALL (ARRAY['REJECTED_EXPECTED'::text, 'ESCALATED'::text])))) AS effective_runs_30d,
            max(x.logged_at) AS last_run,
            max(x.logged_at) FILTER (WHERE (x.c = 'SUCCESS'::text)) AS last_success,
            max(x.logged_at) FILTER (WHERE (x.c = 'FAILURE'::text)) AS last_failure,
            max(x.logged_at) FILTER (WHERE (x.c = 'PARTIAL'::text)) AS last_partial,
            max(x.logged_at) FILTER (WHERE (x.c = ANY (ARRAY['FAILURE'::text, 'PARTIAL'::text]))) AS last_incomplete
           FROM ( SELECT l.logged_at,
                    (l.logged_at > (now() - '30 days'::interval)) AS recent,
                    nexus_outcome_class(l.workflow, l.status, l.summary) AS c
                   FROM audit_log l
                  WHERE ((l.workflow = r.name) OR (l.workflow = r.audit_name) OR (l.workflow = ANY (r.audit_aliases)))) x) a ON (true));

alter view public.v_workflow_health owner to postgres;

revoke all on public.v_workflow_health from anon, public;
grant all    on public.v_workflow_health to service_role;
grant select on public.v_workflow_health to authenticated;

comment on view public.v_workflow_health is
$c$Workflow health on canonical outcome semantics (see nexus_outcome_class). DEGRADED on failures OR partials. PRODUCING_NOTHING when over half of qualifying runs yielded no result - this is what an 87% scrape miss rate looks like when it is not hidden behind a rejection label.

SECURITY: this view MUST be security_invoker = true. It reads workflow_registry and audit_log, which rely on RLS to keep internal operational data away from the anon role. Recreating it with `create or replace view` silently drops that option, so any replacement MUST spell out `with (security_invoker = true)` inline.

CONTROL PLANE: this view deliberately does NOT project workflow_registry.id, .trigger_type or .trigger_detail. Those are the n8n workflow id, the trigger kind and the cron expressions and webhook paths - vendor operational configuration, withheld from `authenticated` by column grant on the base table (CONTROL-PLANE.md 5.2, Part 4). A dealership is entitled to know that its automation is broken; it is not entitled to the id and address of the job. Re-adding any of the three here re-opens that leak AND, because this view is security_invoker, makes the whole view 42501 for every dealership login.$c$;

comment on table public.workflow_registry is
$c$The platform's register of the automations NEXUS runs: n8n workflow id, name, the audit_log names it writes under, trigger type and detail, category, is_active.

CONTROL PLANE (CONTROL-PLANE.md 5.2): `id`, `trigger_type` and `trigger_detail` are vendor operational configuration - the real n8n workflow ids, the cron expressions and the webhook paths - and are withheld from `authenticated` by COLUMN GRANT, not by policy. `authenticated` holds SELECT on name, audit_name, audit_aliases, category, description, is_active and writes_audit_log only; service_role holds all ten. Restoring the table-wide grant re-opens the leak.

STILL OPEN, and not closed by that grant: this table has NO tenant_id, and workflow_registry_read is USING (true) for `authenticated`. It is a single global catalogue shared by every dealership, which is survivable only while there is one. Giving it a tenant_id and a scoped policy remains a BLOCKER for onboarding a second dealership, and QUALITY_GATE check L2 stays red on this row on purpose.$c$;