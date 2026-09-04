-- The Lead Escalation workflow emailed the manager, pinged Slack and wrote an
-- audit row, but left no mark on the lead itself, so nothing in the dashboard
-- could tell an escalated lead from an ordinary one.
--
-- Deliberately NOT overloading `status` for this. status carries the router's
-- HOT/WARM/COLD classification; overwriting it with 'ESCALATED' would break the
-- router's own filters, the HOT auto-assignment trigger and the pipeline counts.
-- Escalation is an event on a lead, not a replacement for its temperature.
alter table public.leads
  add column if not exists escalated_at timestamptz;

comment on column public.leads.escalated_at is
  'Set by the Lead Escalation workflow when a lead is escalated to a manager. Null means never escalated. Does not change status.';

create index if not exists idx_leads_escalated_at
  on public.leads (escalated_at desc nulls last)
  where escalated_at is not null;