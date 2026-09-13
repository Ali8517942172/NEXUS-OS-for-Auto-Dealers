-- 13 September 2026. Containment for the lead-deletion incident.
--
-- Measured: public.leads carries n_tup_ins = 123 against 7 live rows and a
-- sequence at 127. Roughly 116 rows were committed and then removed. The
-- channel was not the application -- `authenticated` holds no DELETE grant
-- (20260905201532_rbac_04_leads_writes_by_role.sql:62). It was hand-written
-- SQL over a privileged connection, one statement of which still carries the
-- comment "-- clean slate for a genuine end-to-end run" in pg_stat_statements.
-- A test-reset ritual, run against production.
--
-- What it cost: audit_log retains 26 orphan rows for a live Gmail address
-- scored HOT 88 and 92 by the Master Router, whose leads row is gone; and
-- communication_logs holds 23 conversation threads with no lead at all.
--
-- Why a trigger and not a GRANT revoke: the deletes ran as postgres and
-- service_role. Revoking from service_role would still leave the SQL editor
-- open. A BEFORE trigger is the only control that sits below every channel.
--
-- This is deliberately noisy rather than clever. A product sold on "we do not
-- lose enquiries" should refuse to lose them, and should say so out loud.

create or replace function public.nexus_refuse_destructive_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if coalesce(
       current_setting('nexus.destructive_write_is_deliberate', true),
       ''
     ) <> 'YES_I_HAVE_A_COPY_AND_I_MEAN_IT'
  then
    raise exception
      using
        errcode = 'P0001',
        message = format(
          'NX900 DESTRUCTIVE_WRITE_REFUSED: %I.%I is evidence, not scratch.',
          tg_table_schema, tg_table_name),
        detail  = 'On 2026-09-13 a hand-written test reset removed ~116 lead rows '
                  || 'from production, including two HOT-scored real customers. '
                  || 'These tables now refuse DELETE and TRUNCATE.',
        hint    = 'Run the reset against staging (wwspuxrbiyagnrnzgate). If this '
                  || 'deletion must happen here, set the GUC '
                  || 'nexus.destructive_write_is_deliberate for the transaction '
                  || 'and record the reason in ops/ first.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return null;
end;
$fn$;

comment on function public.nexus_refuse_destructive_write() is
  'NX900. Refuses DELETE/TRUNCATE on the tables that hold the evidence a lead '
  'ever existed, unless the session sets nexus.destructive_write_is_deliberate. '
  'Added after the 2026-09-13 production data loss.';

revoke all on function public.nexus_refuse_destructive_write() from public;

do $outer$
declare
  t text;
begin
  foreach t in array array['leads', 'audit_log', 'communication_logs', 'lead_event']
  loop
    execute format('drop trigger if exists nexus_%s_refuse_delete on public.%I', t, t);
    execute format(
      'create trigger nexus_%s_refuse_delete before delete on public.%I '
      'for each row execute function public.nexus_refuse_destructive_write()', t, t);

    execute format('drop trigger if exists nexus_%s_refuse_truncate on public.%I', t, t);
    execute format(
      'create trigger nexus_%s_refuse_truncate before truncate on public.%I '
      'for each statement execute function public.nexus_refuse_destructive_write()', t, t);
  end loop;
end
$outer$;
