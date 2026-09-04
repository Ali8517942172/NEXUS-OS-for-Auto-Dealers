-- The sla_breach branch had no time window, so a lead that answered slowly in
-- July stayed on the attention list forever. That was survivable while the view
-- was only read by one panel; it is not now that lib/badges.js paints a count
-- over the Leads nav item. A badge that can go up but never down stops being
-- read, and once it is unread it cannot warn anyone about the item that arrives
-- tomorrow. 30 days is the window in which the number is still actionable.
create or replace view public.v_needs_attention as
 select 'lead_unassigned'::text as kind, 'HOT'::text as severity,
        l.id::text as ref, l.name as title,
        'HOT lead with no rep assigned'::text as detail,
        l.created_at as at, 'leads'::text as screen
   from leads l
  where upper(l.status) = 'HOT' and l.assigned_to_id is null
union all
 select 'sla_breach'::text,
        case when l.response_time_minutes > 60 then 'HOT' else 'WARM' end,
        l.id::text, l.name,
        'Responded in ' || l.response_time_minutes || ' min — breaches the 5-minute rule',
        l.created_at, 'leads'::text
   from leads l
  where l.response_time_minutes > 5
    and l.created_at > now() - interval '30 days'
union all
 select 'inventory_aging'::text, 'HOT'::text, i.id, i.model,
        (i.days_in_stock || ' days in stock · AED ' ||
         to_char(i.holding_cost_accrued, 'FM999,999')) || ' holding cost',
        now(), 'inventory'::text
   from inventory i
  where i.aging_alert = 'CRITICAL'
union all
 select 'undercut'::text, 'WARM'::text, c.id::text, c.model,
        (c.competitor || ' is AED ' ||
         to_char(abs(c.price_diff_aed), 'FM999,999')) || ' cheaper',
        c.scraped_at, 'competitors'::text
   from competitors c
  where c.price_diff_aed < 0
union all
 select 'workflow_failure'::text, 'HOT'::text, f.workflow, f.workflow,
        (f.n || ' failed run' || case when f.n = 1 then '' else 's' end ||
         ' in the last 24 h · ') || left(coalesce(f.latest, 'no detail recorded'), 140),
        f.last_at, 'automation'::text
   from ( select a.workflow, count(*) as n, max(a.logged_at) as last_at,
                 (array_agg(a.summary order by a.logged_at desc))[1] as latest
            from audit_log a
           where a.status = 'FAILED' and a.logged_at > now() - interval '24 hours'
           group by a.workflow) f
union all
 select 'kyc_archive_gap'::text, 'HOT'::text, k.id::text,
        coalesce(k.lead_name, k.full_name, k.lead_email, 'KYC document'),
        'Document was never archived to Storage — retention cannot be proven',
        k.created_at, 'compliance'::text
   from kyc_documents k
  where k.storage_path is null and k.purged_at is null and k.void_reason is null
    and k.created_at > '2026-08-17 16:01:48+00'::timestamptz
union all
 select 'unanswered_chat'::text, 'HOT'::text, v.chat_id, v.display_name,
        ('Waiting since ' || to_char(v.last_message_at, 'DD Mon HH24:MI') || ' · ')
          || left(coalesce(v.last_message, ''), 90),
        v.last_message_at, 'conversations'::text
   from v_conversations v
  where v.awaiting_reply and v.last_message_at > now() - interval '7 days';