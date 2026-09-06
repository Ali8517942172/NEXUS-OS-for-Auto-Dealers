-- Same contract as before (kind, severity, ref, title, detail, at, screen); the
-- column aliases have to be spelled out because CREATE OR REPLACE VIEW cannot
-- rename columns.
--
-- Two changes:
--   * the KYC archive-gap branch now ignores voided rows. A greeting image that
--     was auto-routed to the auditor is not a compliance hole, and alarming on it
--     after voiding it would just replace one false signal with another.
--   * a new `unanswered_chat` branch. This is the item an operator can act on
--     immediately, and it is what the nav badge should be counting.
drop view if exists public.v_needs_attention;

create view public.v_needs_attention
with (security_invoker = on) as

select 'lead_unassigned'::text as kind, 'HOT'::text as severity, l.id::text as ref,
       l.name as title, 'HOT lead with no rep assigned'::text as detail,
       l.created_at as at, 'leads'::text as screen
from leads l where upper(l.status) = 'HOT' and l.assigned_to_id is null

union all
select 'sla_breach', case when l.response_time_minutes > 60 then 'HOT' else 'WARM' end,
       l.id::text, l.name,
       'Responded in ' || l.response_time_minutes || ' min — breaches the 5-minute rule',
       l.created_at, 'leads'
from leads l where l.response_time_minutes > 5

union all
select 'inventory_aging', 'HOT', i.id, i.model,
       (i.days_in_stock || ' days in stock · AED ') ||
         to_char(i.holding_cost_accrued, 'FM999,999') || ' holding cost',
       now(), 'inventory'
from inventory i where i.aging_alert = 'CRITICAL'

union all
select 'undercut', 'WARM', c.id::text, c.model,
       (c.competitor || ' is AED ') || to_char(abs(c.price_diff_aed), 'FM999,999') || ' cheaper',
       c.scraped_at, 'competitors'
from competitors c where c.price_diff_aed < 0

union all
select 'workflow_failure', 'HOT', f.workflow, f.workflow,
       f.n || ' failed run' || case when f.n = 1 then '' else 's' end ||
         ' in the last 24 h · ' || left(coalesce(f.latest, 'no detail recorded'), 140),
       f.last_at, 'automation'
from (
  select a.workflow, count(*) n, max(a.logged_at) last_at,
         (array_agg(a.summary order by a.logged_at desc))[1] latest
  from audit_log a
  where a.status = 'FAILED' and a.logged_at > now() - interval '24 hours'
  group by a.workflow
) f

union all
select 'kyc_archive_gap', 'HOT', k.id::text,
       coalesce(k.lead_name, k.full_name, k.lead_email, 'KYC document'),
       'Document was never archived to Storage — retention cannot be proven',
       k.created_at, 'compliance'
from kyc_documents k
where k.storage_path is null and k.purged_at is null
  and k.void_reason is null
  and k.created_at > timestamptz '2026-08-17T16:01:48Z'

union all
select 'unanswered_chat', 'HOT', v.chat_id, v.display_name,
       'Waiting since ' || to_char(v.last_message_at, 'DD Mon HH24:MI') ||
         ' · ' || left(coalesce(v.last_message, ''), 90),
       v.last_message_at, 'conversations'
from v_conversations v
where v.awaiting_reply and v.last_message_at > now() - interval '7 days';