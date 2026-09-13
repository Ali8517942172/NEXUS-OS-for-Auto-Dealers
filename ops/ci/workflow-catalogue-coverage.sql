-- CI GATE: every workflow that writes to audit_log must resolve to a
-- workflow_registry row. Expect ZERO rows.
--
-- Why this matters more than a red build:
-- v_workflow_health joins audit_log to nexus_workflow_catalogue() by string
-- equality on name / audit_name / audit_aliases. A workflow whose audit string
-- drifts from its catalogue entry does not appear as FAILING -- it disappears
-- from the view entirely. There is no row to be red. That is strictly worse
-- than an outage you can see.
--
-- It has already happened twice. On 2026-09-13 this returned three rows, one of
-- which was `WhatsApp Cloud - Inbound Receiver (Meta)` -- a production failure
-- six hours old that appeared on no dashboard.
--
-- The predicate below deliberately duplicates the one inside v_workflow_health.
-- It must fail when THAT join fails, not when some tidier join would.

select  l.workflow        as orphan_audit_workflow,
        count(*)          as rows_30d,
        max(l.logged_at)  as last_seen
  from  public.audit_log l
 where  l.logged_at > now() - interval '30 days'
   and  not exists (
          select 1
            from public.workflow_registry w
           where w.name       = l.workflow
              or w.audit_name = l.workflow
              or l.workflow   = any (coalesce(w.audit_aliases, '{}'::text[]))
        )
 group by l.workflow
 order by rows_30d desc;
