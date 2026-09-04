-- security_invoker = true so RLS still applies through the view. Without it a
-- view runs as its owner and quietly bypasses every policy underneath.

-- ── Workflow health: all 13, including the ones that have never run ──────────
CREATE OR REPLACE VIEW v_workflow_health WITH (security_invoker = true) AS
SELECT r.id, r.name, r.category, r.trigger_type, r.trigger_detail, r.description, r.is_active,
       coalesce(a.runs,0)            AS runs,
       coalesce(a.failures,0)        AS failures,
       coalesce(a.escalations,0)     AS escalations,
       CASE WHEN coalesce(a.runs,0)=0 THEN NULL
            ELSE round(100.0*(a.runs-a.failures)/a.runs,1) END AS success_rate,
       a.last_run
FROM workflow_registry r
LEFT JOIN (
  SELECT workflow,
         count(*)                                     AS runs,
         count(*) FILTER (WHERE status='FAILED')      AS failures,
         count(*) FILTER (WHERE status='ESCALATED')   AS escalations,
         max(logged_at)                               AS last_run
  FROM audit_log GROUP BY workflow
) a ON a.workflow = coalesce(r.audit_name, r.name);

-- ── Team performance: real join, now that assigned_to_id exists ──────────────
CREATE OR REPLACE VIEW v_team_performance WITH (security_invoker = true) AS
SELECT u.id, u.name, u.email, u.role, u.status,
       count(l.id)                                              AS leads_assigned,
       count(l.id) FILTER (WHERE upper(l.status)='HOT')          AS hot_leads,
       round(avg(l.response_time_minutes)::numeric,1)            AS avg_response_minutes,
       count(l.id) FILTER (WHERE l.response_time_minutes <= 5)   AS within_sla,
       count(l.id) FILTER (WHERE l.response_time_minutes > 5)    AS breached_sla,
       coalesce(sum(l.budget_aed),0)                             AS pipeline_aed
FROM users u
LEFT JOIN leads l ON l.assigned_to_id = u.id
GROUP BY u.id, u.name, u.email, u.role, u.status;

-- ── Customer 360: built from data that actually exists today ────────────────
-- customer_360_profiles is LEFT JOINed, not driven from — it has 0 rows because
-- its aggregation workflow is broken. The screen must work without it.
CREATE OR REPLACE VIEW v_customer_360 WITH (security_invoker = true) AS
WITH ids AS (
  SELECT lower(trim(email)) AS email FROM leads WHERE email IS NOT NULL AND email <> ''
  UNION
  SELECT lower(trim(email)) FROM purchase_history WHERE email IS NOT NULL AND email <> ''
)
SELECT i.email,
       coalesce(max(p.customer_name), max(l.name))            AS name,
       coalesce(max(p.phone), max(l.phone))                   AS phone,
       count(DISTINCT l.id)                                   AS lead_count,
       max(l.ai_score)                                        AS best_ai_score,
       max(upper(l.status))                                   AS latest_status,
       count(DISTINCT p.id)                                   AS purchase_count,
       coalesce(sum(DISTINCT p.amount_aed),0)                 AS lifetime_value_aed,
       max(p.purchase_date)                                   AS last_purchase_date,
       (count(DISTINCT p.id) > 0)                             AS is_vip,
       (SELECT count(*) FROM communication_logs c WHERE lower(c.lead_email)=i.email)     AS message_count,
       (SELECT max(c.created_at) FROM communication_logs c WHERE lower(c.lead_email)=i.email) AS last_contact_at,
       max(c3.total_emails)                                   AS total_emails,
       max(c3.total_slack_messages)                           AS total_slack_messages
FROM ids i
LEFT JOIN leads l             ON lower(trim(l.email)) = i.email
LEFT JOIN purchase_history p  ON lower(trim(p.email)) = i.email
LEFT JOIN customer_360_profiles c3 ON lower(trim(c3.email)) = i.email
GROUP BY i.email;

-- ── Needs Attention: the Overview panel that was hardcoded HTML ─────────────
CREATE OR REPLACE VIEW v_needs_attention WITH (security_invoker = true) AS
SELECT 'lead_unassigned' AS kind, 'HOT'  AS severity, l.id::text AS ref, l.name AS title,
       'HOT lead with no rep assigned' AS detail, l.created_at AS at, 'leads' AS screen
FROM leads l WHERE upper(l.status)='HOT' AND l.assigned_to_id IS NULL
UNION ALL
SELECT 'sla_breach', CASE WHEN l.response_time_minutes > 60 THEN 'HOT' ELSE 'WARM' END,
       l.id::text, l.name,
       'Responded in ' || l.response_time_minutes || ' min — breaches the 5-minute rule', l.created_at, 'leads'
FROM leads l WHERE l.response_time_minutes > 5
UNION ALL
SELECT 'inventory_aging', 'HOT', i.id, i.model,
       i.days_in_stock || ' days in stock · AED ' || to_char(i.holding_cost_accrued,'FM999,999') || ' holding cost',
       now(), 'inventory'
FROM inventory i WHERE i.aging_alert='CRITICAL'
UNION ALL
SELECT 'undercut', 'WARM', c.id::text, c.model,
       c.competitor || ' is AED ' || to_char(abs(c.price_diff_aed),'FM999,999') || ' cheaper', c.scraped_at, 'competitors'
FROM competitors c WHERE c.price_diff_aed < 0
UNION ALL
SELECT 'workflow_failure', 'HOT', a.id::text, a.workflow, a.summary, a.logged_at, 'automation'
FROM audit_log a WHERE a.status='FAILED';