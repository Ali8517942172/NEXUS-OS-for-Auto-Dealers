-- Two defects in v_lead_messages, both found by adversarially testing the
-- JavaScript resolver against it. The module is right and the view was wrong.
--
-- D1. `unique_tail` refused a phone suffix claimed by more than one lead ROW.
-- But one customer can legitimately hold two lead rows - the same person
-- enquiring twice - and that is a duplicate record, not two people. The view
-- treated it as ambiguous and dropped every phone-keyed message for that
-- customer, silently, while its own email arm was busy asserting the same rows
-- were one person. Partial data with nothing saying so.
-- The suffix is now refused only when it is claimed by more than one distinct
-- PERSON: identity keyed on the email where there is one, and on the lead id
-- where there is not. Two rows under one address stay one person; two rows with
-- no address at all are still two people.
--
-- This is live and it matters beyond the dashboard: the 7-day drip's four reply
-- gates read this view. A duplicated customer would have had their replies
-- invisible to the gate, and the sequence would have kept mailing someone who
-- had already answered - the exact failure the gate was rewritten to stop.
--
-- D2. The email arm compared `c.lead_email = l.email` exactly, while the LID arm
-- used lower(btrim(...)). One address differing only in case or trailing space
-- resolved on one path and not the other. Both arms now normalise.

create or replace view public.v_lead_messages
with (security_invoker = on)
as
with person as (
  -- What identifies a lead as a PERSON: its address if it has one, otherwise
  -- itself. Two rows sharing an address are one person for this purpose.
  select id,
         coalesce(nullif(lower(btrim(coalesce(email,''))), ''), 'lead:' || id::text) as person_key,
         nullif(right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'), 9), '')    as tail9,
         length(regexp_replace(coalesce(phone,''),'[^0-9]','','g'))                  as plen
    from public.leads
),
unique_tail as (
  select tail9 from person
   where tail9 is not null and plen >= 9
   group by tail9 having count(distinct person_key) = 1
)
select l.id as lead_id,
       c.id, c.created_at, c.channel, c.direction, c.message, c.lead_email
  from public.communication_logs c
  join public.leads l
    on (
         (coalesce(btrim(l.email),'') <> ''
          and lower(btrim(c.lead_email)) = lower(btrim(l.email)))
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
                    (coalesce(btrim(l.email),'') <> ''
                     and lower(btrim(wc.lead_email)) = lower(btrim(l.email)))
                 or (length(regexp_replace(coalesce(wc.phone,''),'[^0-9]','','g')) >= 9
                     and right(regexp_replace(coalesce(wc.phone,''),'[^0-9]','','g'), 9)
                         = right(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'), 9)
                     and length(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g')) >= 9
                     and right(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'), 9)
                         in (select tail9 from unique_tail))
               )))
       );

comment on view public.v_lead_messages is
'communication_logs with the lead resolved. Filter on lead_id instead of guessing key shapes. The phone rule refuses a nine-digit suffix claimed by more than one distinct PERSON - two lead rows under one email address are one person and are not refused. Email matching is case-insensitive and trimmed on every arm. Includes [SILENCE-*] markers; a caller wanting only real messages excludes them itself. A row resolving to no lead is absent, so this view cannot measure how many rows failed to resolve. Mirrors lib/identity.js; a divergence between them is a defect in one of the two.';