-- NX950 — mirrored from production.
--
-- Applied to dsvuoovivysszdoiorch on 2026-09-14. This file is the repo's copy
-- of what production already runs; it is not a new change.

-- NX950 — The delete guard covered four tables, and the quality gate deletes
-- from a fifth.
--
-- NX900 (13 Sep) put BEFORE DELETE / BEFORE TRUNCATE guards on exactly four
-- tables: leads, audit_log, communication_logs, lead_event. Today's audit of
-- every destructive path in the repository found what that leaves open:
--
--   apps/executive-dashboard/QUALITY_GATE.mjs runs against PRODUCTION
--   (dsvuoovivysszdoiorch) with SUPABASE_SERVICE_ROLE_KEY and emits
--     delete from public.audit_log  where summary like '%unit GATE-PROBE-%';
--     delete from public.inventory  where id like 'GATE-PROBE-%';
--   The audit_log half is already refused by NX900. The inventory half is not,
--   because inventory was never in the list.
--
--   ops/setup_real_data.sql carries `drop table if exists leads cascade` and
--   the same for inventory, with no project guard and no tenant predicate. DDL
--   is not stoppable by a row trigger -- that one stays an operator discipline
--   problem -- but every DELETE and TRUNCATE path below is now closed.
--
-- So: the same guard, over the rest of the tables a dealership's business
-- actually lives in. Nothing is deleted here. Nothing is modified. This only
-- adds refusals.
--
-- The escape hatch is unchanged and deliberate:
--   set local nexus.destructive_write_is_deliberate = 'YES_I_HAVE_A_COPY_AND_I_MEAN_IT';
-- Staging teardown scripts (ops/demo/teardown_demo_tenant.sql) run against the
-- staging project and are unaffected by this migration.

do $outer$
declare
  t text;
  -- Already guarded by NX900: leads, audit_log, communication_logs, lead_event.
  -- Added here: everything else a dealership would lose and could not rebuild.
  newly text[] := array[
    'inventory',                    -- the gate deletes from this today
    'channel_message_events',       -- the proof a customer ever wrote to us
    'whatsapp_conversation_state',  -- the open 24h service window
    'channel_registry',             -- which number belongs to which dealership
    'tenants',                      -- the dealership itself
    'lead_recovery_actions',        -- the action queue V1 is about to fill
    'inventory_actions'
  ];
begin
  foreach t in array newly loop
    if to_regclass('public.' || quote_ident(t)) is null then
      raise notice 'NX950 skipped %: table does not exist', t;
      continue;
    end if;

    execute format(
      'drop trigger if exists %I on public.%I',
      'nexus_' || t || '_refuse_delete', t);
    execute format(
      'create trigger %I before delete on public.%I
         for each row execute function public.nexus_refuse_destructive_write()',
      'nexus_' || t || '_refuse_delete', t);

    execute format(
      'drop trigger if exists %I on public.%I',
      'nexus_' || t || '_refuse_truncate', t);
    execute format(
      'create trigger %I before truncate on public.%I
         for each statement execute function public.nexus_refuse_destructive_write()',
      'nexus_' || t || '_refuse_truncate', t);

    raise notice 'NX950 guarded %', t;
  end loop;
end
$outer$;

-- A report, so "which tables are guarded" is answerable rather than remembered.
create or replace function public.nexus_destructive_guard_coverage()
returns table (table_name text, delete_guarded boolean, truncate_guarded boolean, verdict text)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  with business as (
    select unnest(array[
      'leads','audit_log','communication_logs','lead_event',
      'inventory','channel_message_events','whatsapp_conversation_state',
      'channel_registry','tenants','lead_recovery_actions','inventory_actions'
    ]) as t
  )
  select b.t,
         exists (select 1 from pg_trigger g
                  where g.tgrelid = to_regclass('public.' || quote_ident(b.t))
                    and not g.tgisinternal and g.tgname like '%refuse_delete'),
         exists (select 1 from pg_trigger g
                  where g.tgrelid = to_regclass('public.' || quote_ident(b.t))
                    and not g.tgisinternal and g.tgname like '%refuse_truncate'),
         case
           when to_regclass('public.' || quote_ident(b.t)) is null then 'TABLE ABSENT'
           when exists (select 1 from pg_trigger g
                         where g.tgrelid = to_regclass('public.' || quote_ident(b.t))
                           and not g.tgisinternal and g.tgname like '%refuse_delete')
            and exists (select 1 from pg_trigger g
                         where g.tgrelid = to_regclass('public.' || quote_ident(b.t))
                           and not g.tgisinternal and g.tgname like '%refuse_truncate')
           then 'GUARDED'
           else 'OPEN — a delete here would succeed'
         end
    from business b
   order by 4 desc, 1;
$fn$;

revoke all on function public.nexus_destructive_guard_coverage() from public, anon;
grant execute on function public.nexus_destructive_guard_coverage() to authenticated, service_role;
