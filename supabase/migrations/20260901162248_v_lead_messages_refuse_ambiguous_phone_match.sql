-- Correcting a defect in the view I created earlier today.
--
-- v_lead_messages resolved a row to a lead by the last NINE digits of the phone,
-- and attached the row to EVERY lead that matched. lib/identity.js refuses in
-- exactly this case, deliberately: nine digits is a heuristic, and two different
-- customers can share a suffix. Demonstrated read-only with a two-lead fixture
-- sharing 517942172 - the view attributed 12 of one customer's messages to both.
--
-- Attaching one person's conversation to another person's record is worse than
-- attaching it to nobody, so the phone rule now refuses when it is ambiguous.
-- The email and @lid paths are exact and are not affected: an email is unique
-- per lead and a chat_id resolves through whatsapp_contacts, so both stay.
--
-- This matters beyond the dashboard: the 7-day drip's reply gates read this view
-- as of today. Over-matching there would stop a sequence on somebody else's
-- reply - the safe direction, but still the wrong customer.

create or replace view public.v_lead_messages
with (security_invoker = on)
as
with digits as (
  select id,
         nullif(right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'), 9), '') as tail9,
         length(regexp_replace(coalesce(phone,''),'[^0-9]','','g')) as plen
    from public.leads
),
-- A suffix claimed by more than one lead identifies nobody.
unique_tail as (
  select tail9 from digits
   where tail9 is not null and plen >= 9
   group by tail9 having count(*) = 1
)
select l.id as lead_id,
       c.id, c.created_at, c.channel, c.direction, c.message, c.lead_email
  from public.communication_logs c
  join public.leads l
    on (
         (coalesce(l.email,'') <> '' and c.lead_email = l.email)
      or
         (c.lead_email not like '%@lid'
          and length(regexp_replace(split_part(c.lead_email,'@',1),'[^0-9]','','g')) >= 9
          and right(regexp_replace(split_part(c.lead_email,'@',1),'[^0-9]','','g'), 9)
              = right(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'), 9)
          and length(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g')) >= 9
          and right(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'), 9)
              in (select tail9 from unique_tail))
      or
         (c.lead_email like '%@lid' and exists (
            select 1 from public.whatsapp_contacts wc
             where wc.chat_id = c.lead_email
               and (
                    (coalesce(l.email,'') <> '' and lower(btrim(wc.lead_email)) = lower(btrim(l.email)))
                 or (length(regexp_replace(coalesce(wc.phone,''),'[^0-9]','','g')) >= 9
                     and right(regexp_replace(coalesce(wc.phone,''),'[^0-9]','','g'), 9)
                         = right(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'), 9)
                     and length(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g')) >= 9
                     and right(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'), 9)
                         in (select tail9 from unique_tail))
               )))
       );

comment on view public.v_lead_messages is
'communication_logs with the lead resolved. Filter on lead_id instead of guessing key shapes. The phone rule matches on the last nine digits and REFUSES when two leads share that suffix - attaching one customer''s conversation to another is worse than attaching it to nobody, and lib/identity.js refuses the same case. Includes [SILENCE-*] markers; a caller wanting only real messages excludes them itself. A row that resolves to no lead is absent, so this view cannot be used to measure how many rows failed to resolve.';