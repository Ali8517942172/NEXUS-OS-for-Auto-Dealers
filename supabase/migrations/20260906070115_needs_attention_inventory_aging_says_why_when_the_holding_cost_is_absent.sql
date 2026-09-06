-- D3. v_needs_attention.inventory_aging rendered detail = NULL.
--
-- ((i.days_in_stock || ' days in stock - AED ' ||
--   to_char(i.holding_cost_accrued, 'FM999,999')) || ' holding cost')
--
-- holding_cost_accrued is NULL for any dealership that has not recorded a
-- daily floor-plan rate, and in SQL anything concatenated with NULL is NULL,
-- so the whole sentence vanished. Not "no detail" - a sentence that silently
-- disappeared, leaving a bare car name on the alert feed.
--
-- This is not a demo-only defect. Measured on production 6 Sep 2026:
-- 1 of 1 inventory_aging alerts has detail = NULL, and it is the only NULL
-- detail in the whole view. ALBA has no holding rate on record either, so the
-- dealership this product is piloting with sees it today, on Overview and in
-- money-leaks register 4. Every dealership sees it on day one.
--
-- The alert now says which of the two halves is missing and why, by reading
-- the same fact v_inventory_profit_sentinel reads - the dealership's own
-- inventory_profit_settings row, joined on tenant_id, so a dealership is only
-- ever measured against its own rate. Nothing else in the view changes.

create or replace view public.v_needs_attention
with (security_invoker = true) as
 SELECT 'lead_unassigned'::text AS kind,
    'HOT'::text AS severity,
    l.id::text AS ref,
    l.name AS title,
    'HOT lead with no rep assigned'::text AS detail,
    l.created_at AS at,
    'leads'::text AS screen
   FROM leads l
  WHERE upper(l.status) = 'HOT'::text AND l.assigned_to_id IS NULL
UNION ALL
 SELECT 'sla_breach'::text AS kind,
        CASE
            WHEN l.response_time_minutes > 60 THEN 'HOT'::text
            ELSE 'WARM'::text
        END AS severity,
    l.id::text AS ref,
    l.name AS title,
    ('Responded in '::text || l.response_time_minutes) || ' min — breaches the 5-minute rule'::text AS detail,
    l.created_at AS at,
    'leads'::text AS screen
   FROM leads l
  WHERE l.response_time_minutes > 5 AND l.created_at > (now() - '30 days'::interval)
UNION ALL
 SELECT 'inventory_aging'::text AS kind,
    'HOT'::text AS severity,
    i.id AS ref,
    i.model AS title,
        CASE
            WHEN i.days_in_stock IS NULL THEN 'Days in stock not on record'::text
            ELSE i.days_in_stock || ' days in stock'::text
        END || ' · '::text ||
        CASE
            WHEN i.holding_cost_accrued IS NOT NULL
              THEN ('AED '::text || to_char(i.holding_cost_accrued, 'FM999,999'::text)) || ' holding cost'::text
            WHEN s.holding_cost_per_day_aed IS NULL
              THEN 'holding cost NOT COMPUTABLE — this dealership has not recorded what a day of floor costs'::text
            ELSE 'holding cost NOT COMPUTABLE — a daily rate is on record but no accrued figure has been computed for this unit'::text
        END AS detail,
    now() AS at,
    'inventory'::text AS screen
   FROM inventory i
     LEFT JOIN inventory_profit_settings s ON s.tenant_id = i.tenant_id
  WHERE i.aging_alert = 'CRITICAL'::text
UNION ALL
 SELECT 'undercut'::text AS kind,
    'WARM'::text AS severity,
    c.id::text AS ref,
    c.model AS title,
    ((c.competitor || ' is AED '::text) || to_char(abs(c.price_diff_aed), 'FM999,999'::text)) || ' cheaper'::text AS detail,
    c.scraped_at AS at,
    'competitors'::text AS screen
   FROM ( SELECT DISTINCT ON (c2.competitor, c2.model) c2.id,
            c2.competitor,
            c2.model,
            c2.price_aed,
            c2.our_price_aed,
            c2.price_diff_aed,
            c2.ai_recommendation,
            c2.scraped_at,
            c2.listing_title,
            c2.source_host,
            c2.source_kind,
            c2.offer_name,
            c2.offer_condition,
            c2.match_quality,
            c2.match_note
           FROM competitors c2
          ORDER BY c2.competitor, c2.model, c2.scraped_at DESC) c
  WHERE c.price_diff_aed < 0
UNION ALL
 SELECT 'workflow_failure'::text AS kind,
    'HOT'::text AS severity,
    COALESCE(r.name, f.workflow) AS ref,
    COALESCE(r.name, f.workflow) AS title,
    (((f.n || ' run'::text) ||
        CASE
            WHEN f.n = 1 THEN ''::text
            ELSE 's'::text
        END) || ' that did not deliver in the last 24 h · '::text) || "left"(COALESCE(f.latest, 'no detail recorded'::text), 140) AS detail,
    f.last_at AS at,
    'automation'::text AS screen
   FROM ( SELECT a.workflow,
            count(*) AS n,
            max(a.logged_at) AS last_at,
            (array_agg(a.summary ORDER BY a.logged_at DESC))[1] AS latest
           FROM audit_log a
          WHERE (nexus_outcome_class(a.workflow, a.status, a.summary) = ANY (ARRAY['FAILURE'::text, 'PARTIAL'::text])) AND a.logged_at > (now() - '24:00:00'::interval)
          GROUP BY a.workflow) f
     LEFT JOIN nexus_workflow_catalogue() r(name, audit_name, audit_aliases, category, description, is_active, writes_audit_log) ON f.workflow = r.name OR f.workflow = r.audit_name OR (f.workflow = ANY (r.audit_aliases))
UNION ALL
 SELECT 'kyc_archive_gap'::text AS kind,
    'HOT'::text AS severity,
    k.id::text AS ref,
    COALESCE(k.lead_name, k.full_name, k.lead_email, 'KYC document'::text) AS title,
    'Document was never archived to Storage — retention cannot be proven'::text AS detail,
    k.created_at AS at,
    'compliance'::text AS screen
   FROM kyc_documents k
  WHERE k.storage_path IS NULL AND k.purged_at IS NULL AND k.void_reason IS NULL AND k.created_at > '2026-08-17 16:01:48+00'::timestamp with time zone
UNION ALL
 SELECT 'unanswered_chat'::text AS kind,
    'HOT'::text AS severity,
    v.chat_id AS ref,
    v.display_name AS title,
    (('Waiting since '::text || to_char(v.last_msg_at, 'DD Mon HH24:MI'::text)) || ' · '::text) || "left"(COALESCE(v.last_msg, ''::text), 90) AS detail,
    v.last_msg_at AS at,
    'conversations'::text AS screen
   FROM v_conversations v
  WHERE v.awaiting_msg_reply AND v.last_msg_at > (now() - '7 days'::interval);

comment on view public.v_needs_attention is
  'The alert feed. Every branch must produce a sentence: a NULL detail is not '
  '"no detail", it is a sentence that silently vanished, and inventory_aging '
  'produced one for every dealership with no floor-plan rate on record.'