-- The conversations screen shows "163188003877036@lid" as the person's name.
-- That is a LID handle: an opaque WhatsApp address with no phone digits in it.
-- The real number and the contact's own profile name are now captured in
-- whatsapp_contacts, so give the screen one view that hands it an identity it can
-- actually display.
--
-- display_name resolution order, most trustworthy first:
--   1. the matched lead's name  — we know who this is
--   2. the WhatsApp profile name (PushName) — what they call themselves
--   3. the phone number         — at least it is a real identifier
--   4. the chat id              — last resort, and the UI should mark it as such
--
-- `identified` says which of those we landed on, so the screen can be honest
-- rather than presenting a raw handle as if it were a name.
create or replace view public.v_conversations
with (security_invoker = on) as
with threads as (
  select
    cl.lead_email                                   as thread_key,
    count(*)                                        as message_count,
    count(*) filter (where cl.direction = 'inbound')  as inbound_count,
    count(*) filter (where cl.direction = 'outbound') as outbound_count,
    max(cl.created_at)                              as last_message_at,
    (array_agg(cl.message   order by cl.created_at desc))[1] as last_message,
    (array_agg(cl.direction order by cl.created_at desc))[1] as last_direction
  from public.communication_logs cl
  where cl.lead_email is not null and cl.lead_email <> ''
  group by cl.lead_email
)
select
  t.thread_key,
  -- the address a reply must be sent to; null when the thread is keyed on an email
  case when t.thread_key like '%@%.%' and t.thread_key not like '%@c.us'
            and t.thread_key not like '%@lid'
       then wc_by_lead.chat_id
       else t.thread_key end                        as chat_id,
  coalesce(wc.phone, wc_by_lead.phone)              as phone,
  coalesce(wc.push_name, wc_by_lead.push_name)      as push_name,
  coalesce(l.email, wc.lead_email, wc_by_lead.lead_email) as lead_email,
  l.name                                            as lead_name,
  l.status                                          as lead_status,
  coalesce(
    l.name,
    nullif(wc.push_name, ''), nullif(wc_by_lead.push_name, ''),
    nullif(wc.phone, ''),     nullif(wc_by_lead.phone, ''),
    t.thread_key
  )                                                 as display_name,
  case
    when l.name is not null                                          then 'lead'
    when coalesce(wc.push_name, wc_by_lead.push_name) is not null    then 'whatsapp_profile'
    when coalesce(wc.phone, wc_by_lead.phone) is not null            then 'phone_only'
    else 'unidentified'
  end                                               as identified,
  t.message_count, t.inbound_count, t.outbound_count,
  t.last_message_at, t.last_message, t.last_direction,
  -- communication_logs has no read state, so "awaiting reply" is derived from
  -- direction alone: the newest message is theirs and nothing has gone back.
  (t.last_direction = 'inbound')                    as awaiting_reply
from threads t
left join public.whatsapp_contacts wc          on wc.chat_id    = t.thread_key
left join public.leads             l           on lower(l.email) = lower(t.thread_key)
left join public.whatsapp_contacts wc_by_lead  on lower(wc_by_lead.lead_email) = lower(t.thread_key);

comment on view public.v_conversations is
  'One row per conversation thread with a displayable identity. Never show thread_key or chat_id to a user as a name — use display_name and read `identified` to know how much to trust it.';