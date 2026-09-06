-- Seen on the live dashboard: a workflow_failure item rendered
--   "Customer 360 Aggregation ... no row in v_workflow_health matched this
--    item, so whether it has run since cannot be told from here"
--
-- The branch emitted the raw audit_log.workflow value as both ref and title.
-- audit_log is written with whatever name each workflow calls itself -- there
-- are three spellings for Customer 360 alone -- while v_workflow_health is keyed
-- on workflow_registry.name. So the screen could not join its own alert to the
-- health row that explains it, and said so honestly rather than guessing. The
-- honest message was right; the join it was apologising for is what to fix.
--
-- Resolve through the registry, exactly as v_workflow_health does, and fall back
-- to the raw name when no registry row matches -- an unregistered workflow
-- failing is still worth an alert, and the screen's "no match" wording remains
-- correct for that genuinely unmatched case.

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
        coalesce(r.name, f.workflow), coalesce(r.name, f.workflow),
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
   left join workflow_registry r
     on f.workflow = r.name or f.workflow = r.audit_name or f.workflow = any(r.audit_aliases)
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