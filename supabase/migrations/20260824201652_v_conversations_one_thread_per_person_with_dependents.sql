-- One customer was showing as two conversations: 46 messages filed under
-- shabbir53ujjainwala@gmail.com and 20 under 158510264357112@lid — the same
-- person, the same phone, split because `communication_logs.lead_email` holds
-- an email when a lead is known and a WhatsApp handle when it is not, and the
-- view grouped on that raw value. It was invisible while thirteen other handles
-- were in the table; with one real customer it is the first thing an operator
-- sees, and it is the kind of split that makes someone answer a message twice.
--
-- v_needs_attention reads v_conversations, so both are rebuilt here. Both are
-- created security_invoker: a SECURITY DEFINER view runs with its creator's RLS
-- and is a hole straight through row-level security the moment tenancy exists.

drop view if exists public.v_needs_attention;
drop view if exists public.v_conversations;

create view public.v_conversations
with (security_invoker = on) as
with resolved as (
  select
    cl.*,
    coalesce(lower(l_direct.email), lower(wc_direct.lead_email), lower(cl.lead_email))
      as person_key,
    case when cl.lead_email like '%@lid' or cl.lead_email like '%@c.us'
         then cl.lead_email else wc_by_lead.chat_id end as reply_chat_id
  from communication_logs cl
  left join leads l_direct              on lower(l_direct.email)      = lower(cl.lead_email)
  left join whatsapp_contacts wc_direct on wc_direct.chat_id          = cl.lead_email
  left join whatsapp_contacts wc_by_lead on lower(wc_by_lead.lead_email) = lower(cl.lead_email)
  where cl.lead_email is not null and cl.lead_email <> ''
),
threads as (
  select
    person_key,
    -- A person may have written from more than one handle. Prefer the one the
    -- newest message came through, so a reply goes where they last spoke.
    (array_agg(reply_chat_id order by (reply_chat_id is null), created_at desc))[1] as chat_id,
    count(*)                                       as message_count,
    count(*) filter (where direction = 'inbound')  as inbound_count,
    count(*) filter (where direction = 'outbound') as outbound_count,
    max(created_at)                                as last_message_at,
    (array_agg(message   order by created_at desc))[1] as last_message,
    (array_agg(direction order by created_at desc))[1] as last_direction
  from resolved group by person_key
)
select
  t.person_key as thread_key, t.chat_id,
  coalesce(wc.phone, wc2.phone)                    as phone,
  coalesce(wc.push_name, wc2.push_name)            as push_name,
  coalesce(l.email, wc.lead_email, wc2.lead_email) as lead_email,
  l.name as lead_name, l.status as lead_status,
  coalesce(l.name, nullif(wc.push_name,''), nullif(wc2.push_name,''),
           nullif(wc.phone,''), nullif(wc2.phone,''), t.person_key) as display_name,
  case when l.name is not null                                then 'lead'
       when coalesce(wc.push_name, wc2.push_name) is not null  then 'whatsapp_profile'
       when coalesce(wc.phone, wc2.phone)         is not null  then 'phone_only'
       else 'unidentified' end                     as identified,
  t.message_count, t.inbound_count, t.outbound_count,
  t.last_message_at, t.last_message, t.last_direction,
  t.last_direction = 'inbound'                     as awaiting_reply
from threads t
left join leads l               on lower(l.email)         = t.person_key
left join whatsapp_contacts wc  on wc.chat_id             = t.chat_id
left join whatsapp_contacts wc2 on lower(wc2.lead_email)  = t.person_key;

create view public.v_needs_attention
with (security_invoker = on) as
 select 'lead_unassigned'::text as kind, 'HOT'::text as severity,
        l.id::text as ref, l.name as title,
        'HOT lead with no rep assigned'::text as detail,
        l.created_at as at, 'leads'::text as screen
   from leads l where upper(l.status) = 'HOT' and l.assigned_to_id is null
union all
 select 'sla_breach'::text,
        case when l.response_time_minutes > 60 then 'HOT' else 'WARM' end,
        l.id::text, l.name,
        'Responded in ' || l.response_time_minutes || ' min — breaches the 5-minute rule',
        l.created_at, 'leads'::text
   from leads l
  where l.response_time_minutes > 5 and l.created_at > now() - interval '30 days'
union all
 select 'inventory_aging'::text, 'HOT'::text, i.id, i.model,
        (i.days_in_stock || ' days in stock · AED ' ||
         to_char(i.holding_cost_accrued, 'FM999,999')) || ' holding cost',
        now(), 'inventory'::text
   from inventory i where i.aging_alert = 'CRITICAL'
union all
 select 'undercut'::text, 'WARM'::text, c.id::text, c.model,
        (c.competitor || ' is AED ' ||
         to_char(abs(c.price_diff_aed), 'FM999,999')) || ' cheaper',
        c.scraped_at, 'competitors'::text
   from competitors c where c.price_diff_aed < 0
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