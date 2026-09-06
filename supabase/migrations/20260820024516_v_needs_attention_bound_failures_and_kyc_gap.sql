-- v_needs_attention feeds the "Needs attention" panel on the overview screen,
-- which reads it with limit=60.
--
-- Two problems with the previous definition:
--
--   1. The workflow_failure branch had NO time bound. Every FAILED audit row
--      ever written was "needs attention, severity HOT" -- 143 rows, 106 of them
--      the same WhatsApp BDC task-runner error repeated. The panel's 60-row
--      budget was spent entirely on days-old duplicates, burying the two items
--      an operator could actually act on today (an unowned HOT lead, a car past
--      its aging threshold).
--
--   2. A KYC document that never reached Storage -- an archive failure, and a
--      genuine compliance hole -- did not appear at all.
--
-- Now: failures are bounded to 24 hours and collapsed to ONE row per workflow
-- carrying the count and the most recent message, and archive gaps are surfaced.
-- The column contract (kind, severity, ref, title, detail, at, screen) is
-- unchanged; `ref` on a workflow_failure row is now the workflow name rather
-- than an audit-row uuid, which nothing consumes.
create or replace view public.v_needs_attention
with (security_invoker = on) as

select 'lead_unassigned'::text as kind,
       'HOT'::text as severity,
       l.id::text as ref,
       l.name as title,
       'HOT lead with no rep assigned'::text as detail,
       l.created_at as at,
       'leads'::text as screen
from leads l
where upper(l.status) = 'HOT' and l.assigned_to_id is null

union all

select 'sla_breach', 
       case when l.response_time_minutes > 60 then 'HOT' else 'WARM' end,
       l.id::text,
       l.name,
       'Responded in ' || l.response_time_minutes || ' min — breaches the 5-minute rule',
       l.created_at,
       'leads'
from leads l
where l.response_time_minutes > 5

union all

select 'inventory_aging',
       'HOT',
       i.id,
       i.model,
       (i.days_in_stock || ' days in stock · AED ') ||
         to_char(i.holding_cost_accrued, 'FM999,999') || ' holding cost',
       now(),
       'inventory'
from inventory i
where i.aging_alert = 'CRITICAL'

union all

select 'undercut',
       'WARM',
       c.id::text,
       c.model,
       (c.competitor || ' is AED ') ||
         to_char(abs(c.price_diff_aed), 'FM999,999') || ' cheaper',
       c.scraped_at,
       'competitors'
from competitors c
where c.price_diff_aed < 0

union all

-- One row per failing workflow in the last 24 h, not one per failed run.
select 'workflow_failure',
       'HOT',
       f.workflow,
       f.workflow,
       f.n || ' failed run' || case when f.n = 1 then '' else 's' end ||
         ' in the last 24 h · ' || left(coalesce(f.latest, 'no detail recorded'), 140),
       f.last_at,
       'automation'
from (
  select a.workflow,
         count(*)                                              as n,
         max(a.logged_at)                                      as last_at,
         (array_agg(a.summary order by a.logged_at desc))[1]   as latest
  from audit_log a
  where a.status = 'FAILED'
    and a.logged_at > now() - interval '24 hours'
  group by a.workflow
) f

union all

-- A KYC document with neither a storage path nor a purge timestamp never made
-- it into the archive. Rows created before the archive feature shipped
-- (2026-08-17 16:01:48Z) predate the capability and are not failures.
select 'kyc_archive_gap',
       'HOT',
       k.id::text,
       coalesce(k.lead_name, k.full_name, k.lead_email, 'KYC document'),
       'Document was never archived to Storage — retention cannot be proven',
       k.created_at,
       'compliance'
from kyc_documents k
where k.storage_path is null
  and k.purged_at is null
  and k.created_at > timestamptz '2026-08-17T16:01:48Z';