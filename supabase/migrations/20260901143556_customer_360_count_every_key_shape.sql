-- v_customer_360 counted a customer's messages with
--   WHERE lower(c.lead_email) = i.email
-- but communication_logs.lead_email holds four incompatible key shapes for one
-- person: a real email, a <digits>@c.us chat id, a <lid>@lid handle and a
-- +<digits>@whatsapp.lead key. Counting only the email undercounts everyone who
-- ever spoke on WhatsApp. Live on 1 Sep 2026: Siva read 3 against 8 real (62%
-- understated), Ali 15 against 29 (48%).
--
-- last_contact_at was worse than understated, it was wrong: it returned the
-- [SILENCE-ESCALATED] marker, a row written BECAUSE nobody had been in touch.
-- Ali's read 31 Aug 17:00 when the last real message was 04:37. A screen that
-- tells a rep the customer was contacted at 17:00, using a row that exists to
-- say the opposite, is the exact class of defect this whole pass has removed.
--
-- The key expansion is INLINED rather than calling nexus_comm_keys_for_lead().
-- That function is SECURITY DEFINER and is not executable by `authenticated`,
-- so a view calling it would fail on every dashboard read.
--
-- Also fixes lifetime_value_aed, which was COALESCE(sum(DISTINCT amount_aed), 0)
-- - DISTINCT over the AMOUNT collapses two genuine purchases at the same price
-- into one, and the COALESCE reported "no purchases" as a confident AED 0.
-- It now sums distinct purchase ROWS and returns NULL when there are none, which
-- the frontend already renders as an em dash.

create or replace view public.v_customer_360
with (security_invoker = true) as
with ids as (
  select lower(btrim(email)) as email from leads
   where email is not null and email <> ''
  union
  select lower(btrim(email)) from purchase_history
   where email is not null and email <> ''
), ident as (
  select i.email,
         max(nullif(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'),'')) as digits
    from ids i left join leads l on lower(btrim(l.email)) = i.email
   group by i.email
), keys as (
  select d.email, k.key
    from ident d
    cross join lateral (
      select d.email as key
      union select regexp_replace(d.email,'[^0-9]','','g') || '@c.us'
             where d.email like '+%@whatsapp.lead'
               and regexp_replace(d.email,'[^0-9]','','g') <> ''
      union select '+' || d.digits || '@whatsapp.lead' where d.digits is not null
      union select d.digits || '@c.us'                 where d.digits is not null
      union select wc.chat_id from whatsapp_contacts wc
             where wc.chat_id is not null
               and (lower(btrim(wc.lead_email)) = d.email
                    or (d.digits is not null
                        and regexp_replace(coalesce(wc.phone,''),'[^0-9]','','g') = d.digits))
    ) k
   where k.key is not null and btrim(k.key) <> ''
)
select i.email,
  coalesce(max(p.customer_name), max(l.name)) as name,
  coalesce(max(p.phone), max(l.phone))        as phone,
  count(distinct l.id)                        as lead_count,
  max(l.ai_score)                             as best_ai_score,
  max(upper(l.status))                        as latest_status,
  count(distinct p.id)                        as purchase_count,
  (select sum(p2.amount_aed)
     from purchase_history p2
    where lower(btrim(p2.email)) = i.email)   as lifetime_value_aed,
  max(p.purchase_date)                        as last_purchase_date,
  count(distinct p.id) > 0                    as is_vip,
  (select count(*) from communication_logs c
    where c.lead_email in (select key from keys k where k.email = i.email)
      and c.message not like '[SILENCE-%')     as message_count,
  (select max(c.created_at) from communication_logs c
    where c.lead_email in (select key from keys k where k.email = i.email)
      and c.message not like '[SILENCE-%')     as last_contact_at,
  max(c3.total_emails)                        as total_emails,
  max(c3.total_slack_messages)                as total_slack_messages
from ids i
  left join leads l                  on lower(btrim(l.email))  = i.email
  left join purchase_history p       on lower(btrim(p.email))  = i.email
  left join customer_360_profiles c3 on lower(btrim(c3.email)) = i.email
group by i.email;

comment on view public.v_customer_360 is
'One row per customer email. message_count and last_contact_at expand the person into every communication_logs key shape they are filed under and exclude [SILENCE-*] markers, which are written because nobody was in touch. lifetime_value_aed is NULL, not 0, when there are no purchases. A lead whose email column is empty is still absent from this view - see the Customers screen, which shows such a person as an unlinked WhatsApp contact.';