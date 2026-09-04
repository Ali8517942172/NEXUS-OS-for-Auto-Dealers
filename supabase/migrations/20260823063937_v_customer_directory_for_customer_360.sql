-- Customer 360 sourced its customer list from Bitrix24 `crm.lead.list`. That call
-- now returns:
--
--   403 {"error":"FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN"}
--
-- The URL and token are fine — the free Bitrix plan simply does not expose that
-- REST method any more. So the nightly aggregation cannot start at all, and
-- customer_360_profiles has been stuck at one row.
--
-- Bitrix is a CRM mirror, not the source of truth: every customer this system
-- knows about is already in Supabase, in `leads` and `purchase_history`. Reading
-- the directory from here removes a paid-feature dependency, honours the
-- project's free-tier rule, and is strictly more complete — a customer who
-- bought without ever being a lead was invisible to the Bitrix path.
--
-- Keyed on lower(email): the aggregation matches Gmail and Slack activity by
-- email address, so an address that differs only in case must not become two
-- profiles. Name and phone are taken from the most recent record that has them.
create or replace view public.v_customer_directory
with (security_invoker = on) as
select
  lower(x.email)                                              as id,
  (array_agg(x.name  order by x.at desc nulls last)
     filter (where x.name  is not null and x.name  <> ''))[1] as name,
  lower(x.email)                                              as email,
  (array_agg(x.phone order by x.at desc nulls last)
     filter (where x.phone is not null and x.phone <> ''))[1] as phone,
  count(*)                                                    as source_records,
  max(x.at)                                                   as last_seen_at
from (
  select email, name,          phone, created_at as at
    from public.leads
   where email is not null and email <> ''
  union all
  select email, customer_name, phone, created_at
    from public.purchase_history
   where email is not null and email <> ''
) x
group by lower(x.email);

comment on view public.v_customer_directory is
  'Every customer known to the system, keyed on lower(email), unioned from leads and purchase_history. Feeds the Customer 360 aggregation, which previously depended on Bitrix24 crm.lead.list — a method the free plan no longer exposes.';