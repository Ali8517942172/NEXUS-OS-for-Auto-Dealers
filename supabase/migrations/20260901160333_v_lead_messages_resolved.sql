-- Every communication_logs row, resolved to the lead it belongs to.
--
-- WHY THIS EXISTS. communication_logs.lead_email holds four incompatible key
-- shapes for one person, and every consumer that wanted "this lead's messages"
-- rebuilt the resolution itself. A regression on 1 Sep 2026 found eight
-- different rules across eleven consumers, disagreeing about real customers.
--
-- The one that was actually reaching customers: the 7-day drip's reply gate
-- built its key list as [email, <digits>@c.us, +<digits>@whatsapp.lead] and had
-- no branch for a '<lid>@lid' handle - a WhatsApp id that carries no phone
-- digits and bridges only through whatsapp_contacts. Lead 34 has five inbound
-- replies; four of them are filed under a @lid key, so the gate saw one. A
-- customer who had answered kept receiving the day-3, day-5 and day-7 mail.
--
-- A view fixes this once for every reader: filter lead_id and the identity rule
-- is already applied. The rule is INLINED rather than calling
-- nexus_lead_for_comm_key(), which is SECURITY DEFINER and not executable by
-- `authenticated` - a view calling it would fail on every dashboard read.
--
-- Matching, in order, mirroring the n8n Resolve Lead Identity node:
--   1. exact email
--   2. last NINE digits of any key that carries phone digits (not @lid: a LID is
--      opaque and its digits would collide with a real number)
--   3. '<lid>@lid' through whatsapp_contacts, by lead_email or by phone

create or replace view public.v_lead_messages
with (security_invoker = on)
as
select l.id as lead_id,
       c.id, c.created_at, c.channel, c.direction, c.message, c.lead_email
  from public.communication_logs c
  join public.leads l
    on (
         -- 1. exact email, ignoring the empty string
         (coalesce(l.email,'') <> '' and c.lead_email = l.email)
      or
         -- 2. last nine digits, from the key's own digits
         (c.lead_email not like '%@lid'
          and length(regexp_replace(split_part(c.lead_email,'@',1),'[^0-9]','','g')) >= 9
          and right(regexp_replace(split_part(c.lead_email,'@',1),'[^0-9]','','g'), 9)
              = right(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'), 9)
          and length(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g')) >= 9)
      or
         -- 3. a @lid handle, bridged through whatsapp_contacts
         (c.lead_email like '%@lid' and exists (
            select 1 from public.whatsapp_contacts wc
             where wc.chat_id = c.lead_email
               and (
                    (coalesce(l.email,'') <> '' and lower(btrim(wc.lead_email)) = lower(btrim(l.email)))
                 or (length(regexp_replace(coalesce(wc.phone,''),'[^0-9]','','g')) >= 9
                     and right(regexp_replace(coalesce(wc.phone,''),'[^0-9]','','g'), 9)
                         = right(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'), 9)
                     and length(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g')) >= 9)
               )))
       );

comment on view public.v_lead_messages is
'communication_logs with the lead resolved. Filter on lead_id instead of guessing key shapes. Includes [SILENCE-*] markers - they are rows in the log, and a caller that wants only real messages must exclude them itself, because whether they count depends on the question being asked.';