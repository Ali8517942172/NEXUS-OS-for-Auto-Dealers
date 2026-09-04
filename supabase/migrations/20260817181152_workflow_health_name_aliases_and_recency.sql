-- The Automation screen was reporting failures as successes.
--
-- audit_log.workflow carries TWO vocabularies: the success logger inside each
-- workflow writes the registry's short name, while NEXUS Error Handler writes
-- the workflow's real n8n name. v_workflow_health joined on the short name
-- only, so every failure the error handler caught joined to nothing and
-- vanished from the screen — the exact outcome the error handler exists to
-- prevent. WhatsApp BDC read "HEALTHY · 0 failures" with 24 orphaned FAILED
-- rows; Warm Drip and Customer 360 read "NEVER_RAN" while holding failures.

alter table public.workflow_registry
  add column if not exists audit_aliases text[] not null default '{}';

comment on column public.workflow_registry.audit_aliases is
  'Every other string that can appear in audit_log.workflow for this workflow — in practice the real n8n workflow name, which NEXUS Error Handler writes. v_workflow_health matches on name, audit_name or any alias.';

-- An Error Trigger is a real trigger type; the constraint just did not know it.
alter table public.workflow_registry drop constraint if exists workflow_registry_trigger_type_check;
alter table public.workflow_registry add constraint workflow_registry_trigger_type_check
  check (trigger_type = any (array['webhook','schedule','sub-workflow','manual','error']));

update public.workflow_registry set audit_aliases = array['WhatsApp BDC AI Agent']            where id = 'BiyHk9ZXxJUVGbf6';
update public.workflow_registry set audit_aliases = array['KYC/AML Document Auditor + Re-upload Loop (Phase 5)'] where id = 'qTnh3nwWheFJbFkU';
update public.workflow_registry set audit_aliases = array['7-Day Warm Lead Drip Campaign']    where id = 'G7FhvMY2ucW5Fg7X';
update public.workflow_registry set audit_aliases = array['Customer 360 - Data Aggregation (Bitrix24)'] where id = 'AZkGM5M4c1uzSH7S';
update public.workflow_registry set audit_aliases = array['Competitor Price Scraping & Supabase Update']  where id = 'LphiGg4iqF1bn6El';
update public.workflow_registry set audit_aliases = array['Ask-AI — RAG Query Agent']         where id = 'qHAtd3RckAKRBUkE';
update public.workflow_registry set audit_aliases = array['NEXUS Master Lead Router - AI Agent'] where id = 'JnlZFAVmFAuNXVya';
update public.workflow_registry set audit_aliases = array['Sync Closed-Won Deals to Supabase pgvector'] where id = 'dhy2DDjWUqwuzHLW';
update public.workflow_registry set audit_aliases = array['wf_108 ERP Sync - Bitrix24 CRM']   where id = 'bxNBzBrcOtcFpMPn';
update public.workflow_registry set audit_aliases = array['Lead Escalation - AI Agent']       where id = 'KI6P1Qcf3MIZakNa';
update public.workflow_registry set audit_aliases = array['Finance Calc: Auto Loan Equity & Credit Score'] where id = 'unMMpeL9uuPO79pp';
update public.workflow_registry set audit_aliases = array['Phase 6 - 12-Hour Silence Detector'] where id = 'B3TcpfzOMWj8oWgF';
update public.workflow_registry set audit_aliases = array['Slack Command Center - AI Agent']  where id = 'VmnIXo7tM30zqawp';

-- id is the real n8n workflow id. Four live workflows were missing entirely,
-- so they could not appear on the Automation screen at all.
insert into public.workflow_registry
  (id, name, audit_name, audit_aliases, category, trigger_type, trigger_detail, description, is_active, writes_audit_log)
values
  ('ZUc42jcwwHoBeEr8', 'Inventory Ageing Recompute', 'Inventory Ageing Recompute', '{}',
   'Assets', 'schedule', 'Nightly 00:15 Asia/Dubai',
   'Refreshes days_in_stock, holding cost, net margin and aging alert on every inventory row so workflows are not a day behind the dashboard.', true, true),
  ('aIYwwoYStDAi9kHy', 'NEXUS Retention Purge', 'NEXUS Retention Purge', '{}',
   'Compliance', 'schedule', 'Nightly 03:00 Asia/Dubai',
   'Deletes KYC documents past retain_until, prunes the WAHA dedupe guard, and alerts if a document was never archived.', true, true),
  ('iYJkh1kztWxZXDbT', 'NEXUS Error Handler', 'NEXUS Error Handler', '{}',
   'Ops', 'error', 'Error Trigger on every workflow',
   'Catches failures from every other workflow and writes them to audit_log as FAILED.', true, false),
  ('57QpbNQGwlFKb0q3', 'NEXUS Infra Health Probe', 'NEXUS Infra Health Probe', '{}',
   'Ops', 'webhook', 'GET /webhook/infra-probe',
   'Read-only probe reporting WAHA session status, the connected number and its configured webhooks.', true, false)
on conflict (id) do nothing;

-- column list changes, so replace is not enough
drop view if exists public.v_workflow_health;

create view public.v_workflow_health as
select
  r.id,
  r.name,
  r.category,
  r.trigger_type,
  r.trigger_detail,
  r.description,
  r.is_active,
  r.writes_audit_log,
  coalesce(a.runs, 0)        as runs,
  coalesce(a.failures, 0)    as failures,
  coalesce(a.escalations, 0) as escalations,
  case when coalesce(a.runs, 0) = 0 then null
       else round(100.0 * (a.runs - a.failures)::numeric / a.runs::numeric, 1)
  end as success_rate,
  a.last_run,
  coalesce(a.runs_30d, 0)     as runs_30d,
  coalesce(a.failures_30d, 0) as failures_30d,
  a.last_failure,
  case
    when not r.writes_audit_log          then 'NOT_INSTRUMENTED'
    when coalesce(a.runs, 0) = 0         then 'NEVER_RAN'
    when coalesce(a.failures_30d, 0) > 0 then 'DEGRADED'
    else 'HEALTHY'
  end as health
from public.workflow_registry r
left join lateral (
  select
    count(*)                                       as runs,
    count(*) filter (where l.status = 'FAILED')    as failures,
    count(*) filter (where l.status = 'ESCALATED') as escalations,
    count(*) filter (where l.logged_at > now() - interval '30 days') as runs_30d,
    count(*) filter (where l.status = 'FAILED'
                       and l.logged_at > now() - interval '30 days') as failures_30d,
    max(l.logged_at)                                    as last_run,
    max(l.logged_at) filter (where l.status = 'FAILED') as last_failure
  from public.audit_log l
  where l.workflow = r.name
     or l.workflow = r.audit_name
     or l.workflow = any (r.audit_aliases)
) a on true;

comment on view public.v_workflow_health is
  'Per-workflow health for the Automation screen. Matches audit_log on name, audit_name OR audit_aliases, because the error handler and the in-workflow success loggers use different names for the same workflow. `health` uses a 30-day window so an old failure stops painting a workflow red forever; `runs` and `failures` stay all-time.';

grant select on public.v_workflow_health to anon, authenticated, service_role;