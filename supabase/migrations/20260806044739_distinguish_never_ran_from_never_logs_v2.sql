ALTER TABLE workflow_registry ADD COLUMN IF NOT EXISTS writes_audit_log boolean NOT NULL DEFAULT false;
UPDATE workflow_registry SET writes_audit_log = true WHERE audit_name IS NOT NULL;

DROP VIEW IF EXISTS v_workflow_health;
CREATE VIEW v_workflow_health WITH (security_invoker = true) AS
SELECT r.id, r.name, r.category, r.trigger_type, r.trigger_detail, r.description,
       r.is_active, r.writes_audit_log,
       coalesce(a.runs,0) AS runs, coalesce(a.failures,0) AS failures,
       coalesce(a.escalations,0) AS escalations,
       CASE WHEN coalesce(a.runs,0)=0 THEN NULL
            ELSE round(100.0*(a.runs-a.failures)/a.runs,1) END AS success_rate,
       a.last_run,
       -- "0 runs" is ambiguous: never fired, or fires but has no Audit Log node.
       -- Only 4 of 13 workflows write to audit_log. Conflating the two would make
       -- a perfectly healthy workflow look dead.
       CASE WHEN NOT r.writes_audit_log      THEN 'NOT_INSTRUMENTED'
            WHEN coalesce(a.runs,0)=0        THEN 'NEVER_RAN'
            WHEN coalesce(a.failures,0)>0    THEN 'DEGRADED'
            ELSE 'HEALTHY' END AS health
FROM workflow_registry r
LEFT JOIN (
  SELECT workflow, count(*) AS runs,
         count(*) FILTER (WHERE status='FAILED') AS failures,
         count(*) FILTER (WHERE status='ESCALATED') AS escalations,
         max(logged_at) AS last_run
  FROM audit_log GROUP BY workflow
) a ON a.workflow = coalesce(r.audit_name, r.name);