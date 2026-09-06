-- P0 sibling · v_conversations carried the same defect shape as v_lead_messages.
--
-- BUSINESS RULE
--   A conversation thread belongs to one dealership. The identity of the person
--   on the other end -- their lead record, their WhatsApp profile -- is resolved
--   only among that dealership's own records, and two dealerships' messages
--   never merge into one thread.
--
-- WHAT BREAKS WITHOUT THE TENANT PREDICATE
--   All three identity joins matched on identity alone: leads by lowercased
--   email, whatsapp_contacts by chat_id, whatsapp_contacts by lead_email. The
--   thread grain (GROUP BY person_key) was tenant-blind too, so two dealerships'
--   messages to the same address collapsed into a single row with a single
--   message_count. Under RLS the dashboard was incidentally safe; n8n reads as
--   service_role, which bypasses RLS. Demonstrated live in a rolled-back
--   transaction: two messages stored under tenant A were rendered with tenant
--   C's lead_name "Sibling C Customer", lead_status HOT and WhatsApp push_name,
--   and reported identified='lead' -- one dealership's customer named as
--   another dealership's lead, on the screen the sales team replies from.
--
-- tenant_id is exposed (appended last, so existing column positions are
-- unchanged) so a service_role caller can assert the tenant it asked for.
-- security_invoker restated: CREATE OR REPLACE VIEW silently drops it.

create or replace view public.v_conversations
with (security_invoker = true) as
with resolved as (
  select
    cl.id,
    cl.lead_email,
    cl.channel,
    cl.direction,
    cl.message,
    cl.created_at,
    cl.tenant_id,
    public.nexus_is_message(cl.direction, cl.channel, cl.message) as is_msg,
    coalesce(lower(l_direct.email), lower(wc_direct.lead_email), lower(cl.lead_email)) as person_key,
    case
      when cl.lead_email like '%@lid' or cl.lead_email like '%@c.us' then cl.lead_email
      else wc_by_lead.chat_id
    end as reply_chat_id
  from public.communication_logs cl
    left join public.leads l_direct
      on lower(l_direct.email) = lower(cl.lead_email)
     and l_direct.tenant_id = cl.tenant_id
    left join public.whatsapp_contacts wc_direct
      on wc_direct.chat_id = cl.lead_email
     and wc_direct.tenant_id = cl.tenant_id
    left join public.whatsapp_contacts wc_by_lead
      on lower(wc_by_lead.lead_email) = lower(cl.lead_email)
     and wc_by_lead.tenant_id = cl.tenant_id
  where cl.lead_email is not null and cl.lead_email <> ''
),
threads as (
  select
    resolved.tenant_id,
    resolved.person_key,
    (array_agg(resolved.reply_chat_id order by (resolved.reply_chat_id is null), resolved.created_at desc))[1] as chat_id,
    count(*) as message_count,
    count(*) filter (where resolved.direction = 'inbound')  as inbound_count,
    count(*) filter (where resolved.direction = 'outbound') as outbound_count,
    max(resolved.created_at) as last_message_at,
    (array_agg(resolved.message   order by resolved.created_at desc))[1] as last_message,
    (array_agg(resolved.direction order by resolved.created_at desc))[1] as last_direction,
    count(*) filter (where resolved.is_msg)     as msg_count,
    count(*) filter (where not resolved.is_msg) as internal_count,
    count(*) filter (where resolved.is_msg and resolved.direction = 'inbound')  as msg_inbound_count,
    count(*) filter (where resolved.is_msg and resolved.direction = 'outbound') as msg_outbound_count,
    max(resolved.created_at) filter (where resolved.is_msg) as last_msg_at,
    (array_agg(resolved.message   order by resolved.created_at desc) filter (where resolved.is_msg))[1] as last_msg,
    (array_agg(resolved.direction order by resolved.created_at desc) filter (where resolved.is_msg))[1] as last_msg_direction
  from resolved
  -- thread grain is (dealership, person), never person alone
  group by resolved.tenant_id, resolved.person_key
)
select
  t.person_key as thread_key,
  t.chat_id,
  coalesce(wc.phone, wc2.phone) as phone,
  coalesce(wc.push_name, wc2.push_name) as push_name,
  coalesce(l.email, wc.lead_email, wc2.lead_email) as lead_email,
  l.name as lead_name,
  l.status as lead_status,
  coalesce(l.name, nullif(wc.push_name, ''), nullif(wc2.push_name, ''),
           nullif(wc.phone, ''), nullif(wc2.phone, ''), t.person_key) as display_name,
  case
    when l.name is not null then 'lead'
    when coalesce(wc.push_name, wc2.push_name) is not null then 'whatsapp_profile'
    when coalesce(wc.phone, wc2.phone) is not null then 'phone_only'
    else 'unidentified'
  end as identified,
  t.message_count,
  t.inbound_count,
  t.outbound_count,
  t.last_message_at,
  t.last_message,
  t.last_direction,
  t.last_direction = 'inbound' as awaiting_reply,
  t.msg_count,
  t.internal_count,
  t.msg_inbound_count,
  t.msg_outbound_count,
  t.last_msg_at,
  t.last_msg,
  t.last_msg_direction,
  t.last_msg_direction = 'inbound' as awaiting_msg_reply,
  t.tenant_id
from threads t
  left join public.leads l
    on lower(l.email) = t.person_key
   and l.tenant_id = t.tenant_id
  left join public.whatsapp_contacts wc
    on wc.chat_id = t.chat_id
   and wc.tenant_id = t.tenant_id
  left join public.whatsapp_contacts wc2
    on lower(wc2.lead_email) = t.person_key
   and wc2.tenant_id = t.tenant_id;

comment on view public.v_conversations is
  'One conversation thread per (dealership, person). Every identity join is '
  'tenant-scoped -- leads by email, whatsapp_contacts by chat_id and by '
  'lead_email -- and the thread grain is GROUP BY (tenant_id, person_key). '
  'Without those predicates a message received by one dealership is labelled '
  'with another dealership''s lead name and status whenever RLS is not '
  'filtering, which is how n8n reads it, as service_role.';

revoke all on public.v_conversations from anon;
revoke all on public.v_conversations from public;
grant select on public.v_conversations to authenticated;
grant select on public.v_conversations to service_role;