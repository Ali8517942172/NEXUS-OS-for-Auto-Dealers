-- INV-004 · A silence marker is not a message, and it is not a customer waiting.
-- v_needs_attention.unanswered_chat keyed off v_conversations.awaiting_reply,
-- which is (last_direction = 'inbound') over EVERY row in the thread, markers
-- included. v_conversations now carries awaiting_msg_reply, last_msg_at and
-- last_msg, all built on public.nexus_is_message -- the single definition of
-- what counts as a message. This branch is repointed at those.
--
-- Business rule: a thread needs attention when the newest REAL MESSAGE in it
-- came from the customer and is less than seven days old. A [SILENCE-...] marker
-- the system filed about the thread is neither a message from the customer nor
-- the date on which the dealership last spoke to them, so it can neither raise
-- an alert nor keep one alive, and its text must never be shown as the thing the
-- customer said.
--
-- This is a correctness-by-construction change, not a bug fix: on today's data
-- the two columns agree (both marker-topped threads have an outbound last
-- message, so awaiting_reply = awaiting_msg_reply = false on both) and the alert
-- set is unchanged at 9 rows. It now agrees because it is the same rule, not
-- because the data happens to line up.
--
-- Only the final UNION ALL branch changes. Every other branch is reproduced
-- verbatim from the definition captured before this migration, and no object
-- depends on this view.

create or replace view public.v_needs_attention as
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
    ((i.days_in_stock || ' days in stock · AED '::text) || to_char(i.holding_cost_accrued, 'FM999,999'::text)) || ' holding cost'::text AS detail,
    now() AS at,
    'inventory'::text AS screen
   FROM inventory i
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
     LEFT JOIN workflow_registry r ON f.workflow = r.name OR f.workflow = r.audit_name OR (f.workflow = ANY (r.audit_aliases))
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