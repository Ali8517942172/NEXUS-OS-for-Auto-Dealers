-- Two defects in v_needs_attention, both of which reached the user as a number.
--
-- 1. The workflow_failure branch filtered `status = 'FAILED'` and nothing else,
--    so a run that went out half-done never raised an alert. This is the same
--    defect the canonical layer was built to remove, still live in the view
--    that feeds the nav badges and every screen's alert strip. It now classes
--    through nexus_outcome_class and counts FAILURE and PARTIAL as "did not
--    deliver" -- the customer-visible distinction is whether the work landed,
--    not which word the workflow wrote on the row.
--
-- 2. The undercut branch emitted one row per stored competitor snapshot. The
--    scraper appends rather than upserts, so one car undercut at one price by
--    one source arrived four times and the badge read 17 where the panel listed
--    13. The frontend now collapses these, but the source should not be
--    manufacturing them: only the newest snapshot per (competitor, model) is a
--    live fact. The rest are history and history is not an alert.
--
-- Deliberately unchanged: inventory_aging still sets `at = now()`. It is not an
-- event time and the frontend now says so explicitly; changing it here would
-- make that correct explanation wrong. The honest fix is a real acquisition
-- timestamp, which is a separate change to the branch and its consumers.

create or replace view public.v_needs_attention
with (security_invoker = on)
as
 select 'lead_unassigned'::text as kind, 'HOT'::text as severity,
        l.id::text as ref, l.name as title,
        'HOT lead with no rep assigned'::text as detail,
        l.created_at as at, 'leads'::text as screen
   from leads l
  where upper(l.status) = 'HOT' and l.assigned_to_id is null
union all
 select 'sla_breach'::text,
        case when l.response_time_minutes > 60 then 'HOT'::text else 'WARM'::text end,
        l.id::text, l.name,
        ('Responded in ' || l.response_time_minutes) || ' min — breaches the 5-minute rule',
        l.created_at, 'leads'::text
   from leads l
  where l.response_time_minutes > 5 and l.created_at > (now() - interval '30 days')
union all
 select 'inventory_aging'::text, 'HOT'::text,
        i.id, i.model,
        ((i.days_in_stock || ' days in stock · AED ') || to_char(i.holding_cost_accrued, 'FM999,999')) || ' holding cost',
        now(), 'inventory'::text
   from inventory i
  where i.aging_alert = 'CRITICAL'
union all
 -- Newest snapshot per listing only. See note 2 above.
 select 'undercut'::text, 'WARM'::text,
        c.id::text, c.model,
        ((c.competitor || ' is AED ') || to_char(abs(c.price_diff_aed), 'FM999,999')) || ' cheaper',
        c.scraped_at, 'competitors'::text
   from (
     select distinct on (c2.competitor, c2.model) c2.*
       from competitors c2
      order by c2.competitor, c2.model, c2.scraped_at desc
   ) c
  where c.price_diff_aed < 0
union all
 select 'workflow_failure'::text, 'HOT'::text,
        f.workflow, f.workflow,
        (((f.n || ' run') || case when f.n = 1 then '' else 's' end)
          || ' that did not deliver in the last 24 h · ')
          || left(coalesce(f.latest, 'no detail recorded'), 140),
        f.last_at, 'automation'::text
   from ( select a.workflow,
                 count(*) as n,
                 max(a.logged_at) as last_at,
                 (array_agg(a.summary order by a.logged_at desc))[1] as latest
            from audit_log a
           where public.nexus_outcome_class(a.workflow, a.status, a.summary)
                 in ('FAILURE', 'PARTIAL')
             and a.logged_at > (now() - interval '24 hours')
           group by a.workflow ) f
union all
 select 'kyc_archive_gap'::text, 'HOT'::text,
        k.id::text,
        coalesce(k.lead_name, k.full_name, k.lead_email, 'KYC document'),
        'Document was never archived to Storage — retention cannot be proven'::text,
        k.created_at, 'compliance'::text
   from kyc_documents k
  where k.storage_path is null and k.purged_at is null and k.void_reason is null
    and k.created_at > '2026-08-17 16:01:48+00'::timestamptz
union all
 select 'unanswered_chat'::text, 'HOT'::text,
        v.chat_id, v.display_name,
        (('Waiting since ' || to_char(v.last_message_at, 'DD Mon HH24:MI')) || ' · ')
          || left(coalesce(v.last_message, ''), 90),
        v.last_message_at, 'conversations'::text
   from v_conversations v
  where v.awaiting_reply and v.last_message_at > (now() - interval '7 days');