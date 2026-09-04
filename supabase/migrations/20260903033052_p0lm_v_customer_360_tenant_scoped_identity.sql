-- P0 sibling · v_customer_360 carried the same defect shape as v_lead_messages,
-- and it is the widest of the three: it is the whole customer record.
--
-- BUSINESS RULE
--   A customer 360 row is one person AT ONE DEALERSHIP. Leads, sales, WhatsApp
--   identities, message counts and lifetime value are gathered only from the
--   dealership that owns the row. The same email address at two dealerships is
--   two customers with two separate histories.
--
-- WHAT BREAKS WITHOUT THE TENANT PREDICATE
--   Every join and every correlated subquery matched on lowercased email alone:
--   the ids UNION across leads and purchase_history, the phone-digits ident CTE,
--   the whatsapp_contacts key expansion, and the lifetime_value_aed,
--   message_count and last_contact_at subqueries. Under RLS the dashboard was
--   incidentally safe; n8n reads as service_role, which bypasses RLS.
--   Demonstrated live in a rolled-back transaction: one row fused tenant C's
--   lead (ai_score 99) and tenant C's AED 999,999 sale with tenant A's two
--   messages, reporting lead_count 1, purchase_count 1, lifetime_value_aed
--   999999 and message_count 2 -- a single customer record assembled from two
--   dealerships' books, feeding VIP status and lifetime value.
--
-- tenant_id is exposed (appended last, so existing column positions are
-- unchanged) so a service_role caller can assert the tenant it asked for.
-- security_invoker restated: CREATE OR REPLACE VIEW silently drops it.

create or replace view public.v_customer_360
with (security_invoker = true) as
with ids as (
  select lower(btrim(leads.email)) as email, leads.tenant_id
  from public.leads
  where leads.email is not null and leads.email <> ''
  union
  select lower(btrim(purchase_history.email)) as email, purchase_history.tenant_id
  from public.purchase_history
  where purchase_history.email is not null and purchase_history.email <> ''
),
ident as (
  select
    i_1.email,
    i_1.tenant_id,
    max(nullif(regexp_replace(coalesce(l_1.phone, ''), '[^0-9]', '', 'g'), '')) as digits
  from ids i_1
    left join public.leads l_1
      on lower(btrim(l_1.email)) = i_1.email
     and l_1.tenant_id = i_1.tenant_id
  group by i_1.email, i_1.tenant_id
),
keys as (
  select d.email, d.tenant_id, k.key
  from ident d
    cross join lateral (
      select d.email as key
      union
      select regexp_replace(d.email, '[^0-9]', '', 'g') || '@c.us'
       where d.email like '+%@whatsapp.lead'
         and regexp_replace(d.email, '[^0-9]', '', 'g') <> ''
      union
      select ('+' || d.digits) || '@whatsapp.lead' where d.digits is not null
      union
      select d.digits || '@c.us'                   where d.digits is not null
      union
      select wc.chat_id
      from public.whatsapp_contacts wc
      where wc.chat_id is not null
        and wc.tenant_id = d.tenant_id
        and ( lower(btrim(wc.lead_email)) = d.email
              or (d.digits is not null
                  and regexp_replace(coalesce(wc.phone, ''), '[^0-9]', '', 'g') = d.digits) )
    ) k
  where k.key is not null and btrim(k.key) <> ''
)
select
  i.email,
  coalesce(max(p.customer_name), max(l.name)) as name,
  coalesce(max(p.phone), max(l.phone))        as phone,
  count(distinct l.id)   as lead_count,
  max(l.ai_score)        as best_ai_score,
  max(upper(l.status))   as latest_status,
  count(distinct p.id)   as purchase_count,
  ( select sum(p2.amount_aed)
      from public.purchase_history p2
     where lower(btrim(p2.email)) = i.email
       and p2.tenant_id = i.tenant_id ) as lifetime_value_aed,
  max(p.purchase_date)   as last_purchase_date,
  count(distinct p.id) > 0 as is_vip,
  ( select count(*)
      from public.communication_logs c
     where c.tenant_id = i.tenant_id
       and c.lead_email in (select k.key from keys k
                             where k.email = i.email and k.tenant_id = i.tenant_id)
       and public.nexus_is_message(c.direction, c.channel, c.message) ) as message_count,
  ( select max(c.created_at)
      from public.communication_logs c
     where c.tenant_id = i.tenant_id
       and c.lead_email in (select k.key from keys k
                             where k.email = i.email and k.tenant_id = i.tenant_id)
       and public.nexus_is_message(c.direction, c.channel, c.message) ) as last_contact_at,
  max(c3.total_emails)         as total_emails,
  max(c3.total_slack_messages) as total_slack_messages,
  i.tenant_id
from ids i
  left join public.leads l
    on lower(btrim(l.email)) = i.email and l.tenant_id = i.tenant_id
  left join public.purchase_history p
    on lower(btrim(p.email)) = i.email and p.tenant_id = i.tenant_id
  left join public.customer_360_profiles c3
    on lower(btrim(c3.email)) = i.email and c3.tenant_id = i.tenant_id
group by i.email, i.tenant_id;

comment on view public.v_customer_360 is
  'One customer record per (dealership, email). Every identity join and every '
  'correlated subquery is tenant-scoped: leads, purchase_history, '
  'customer_360_profiles, the whatsapp_contacts key expansion, and the '
  'lifetime_value_aed / message_count / last_contact_at subqueries. Without '
  'those predicates one row fuses two dealershipsّ leads, sales, messages and '
  'lifetime value whenever RLS is not filtering, which is how n8n reads it, as '
  'service_role.';

revoke all on public.v_customer_360 from anon;
revoke all on public.v_customer_360 from public;
grant select on public.v_customer_360 to authenticated;
grant select on public.v_customer_360 to service_role;