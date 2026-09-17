-- =====================================================================
-- PROPOSAL ONLY — NOT APPLIED. DO NOT RUN WITHOUT ALI'S EXPLICIT YES.
--
-- PARTS OF THIS CHANGE WHAT RUNS NIGHTLY. Section C in particular will REFUSE
-- the nightly Inventory Ageing Recompute unless nx984 is applied first. The
-- required order is stated in section 0 and repeated at the top of section C.
--
-- Intended filename when approved (nx983 is the latest number in
-- supabase/migrations/; nx984 is reserved by the recompute proposal):
--   supabase/migrations/20260918091500_nx985_the_guard_never_looked_at_an_update.sql
--
-- Author: agent PURGE-FIX, 17 September 2026.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. WHAT IS MEASURED, AND WHAT MUST HAPPEN IN WHICH ORDER
-- ---------------------------------------------------------------------
-- Verified on dsvuoovivysszdoiorch 2026-09-17 by decoding pg_trigger.tgtype for
-- every trigger whose tgfoid is public.nexus_refuse_destructive_write:
--
--   11 tables, 22 triggers. Every one is either
--     BEFORE DELETE   FOR EACH ROW,   or
--     BEFORE TRUNCATE FOR EACH STATEMENT.
--   ZERO of them fire on UPDATE.
--
--   Guarded: audit_log, channel_message_events, channel_registry,
--            communication_logs, inventory, inventory_actions, lead_event,
--            lead_recovery_actions, leads, tenants, whatsapp_conversation_state.
--   NOT guarded: kyc_documents, processed_messages.
--
-- THE ORDER. Three sections, and they are not interchangeable:
--
--   A. kyc_documents + processed_messages DELETE/TRUNCATE guards, and an RPC so
--      the nightly prune can still do its job.        <- safe to apply alone
--   B. BEFORE UPDATE guards on the append-only evidence tables.
--                                                      <- safe to apply alone
--   C. A cross-tenant UPDATE detector on inventory.
--                                                      <- REQUIRES nx984 FIRST,
--                                                         AND an amendment to it
--
-- IF THE ORDER IS REVERSED — if section C goes on before nx984 is amended to
-- loop per dealership — then on the first night after a second dealership
-- exists, the 00:15 Inventory Ageing Recompute issues one UPDATE spanning two
-- tenant_ids, section C refuses it, the RPC raises, the n8n node retries three
-- times and fails, and the workflow's error workflow fires. No inventory figure
-- is recomputed that night for ANY dealership: days_in_stock goes stale, the
-- ageing alerts stop advancing, and the WhatsApp sales agent keeps discounting
-- off yesterday's numbers. Nothing is corrupted and nothing is lost — it is an
-- outage of a nightly job, not a data loss — but it is a silent-until-morning
-- outage, and it is entirely avoidable by applying nx984 first.
--
-- Section C is written as a separate, commented-out block for exactly that
-- reason. It does not execute as this file stands.


-- =====================================================================
-- SECTION A — the two missing tables
-- =====================================================================

-- A1. kyc_documents. SAFE TO APPLY ALONE.
--
-- Nothing in the nightly deletes from this table. The retention purge deletes
-- the storage OBJECT and then PATCHes the row's purged_at; it never issues a
-- DELETE against kyc_documents. So a DELETE guard here breaks nothing today and
-- closes the path by which a hand-written "clean slate" statement — the exact
-- ritual that cost ~116 lead rows on 13 September — could remove the only
-- record that a customer's identity document ever existed or was destroyed.

do $a1$
begin
  if to_regclass('public.kyc_documents') is null then
    raise notice 'NX985 skipped kyc_documents: table does not exist';
  else
    drop trigger if exists nexus_kyc_documents_refuse_delete on public.kyc_documents;
    create trigger nexus_kyc_documents_refuse_delete
      before delete on public.kyc_documents
      for each row execute function public.nexus_refuse_destructive_write();

    drop trigger if exists nexus_kyc_documents_refuse_truncate on public.kyc_documents;
    create trigger nexus_kyc_documents_refuse_truncate
      before truncate on public.kyc_documents
      for each statement execute function public.nexus_refuse_destructive_write();

    raise notice 'NX985 guarded kyc_documents (DELETE, TRUNCATE)';
  end if;
end
$a1$;


-- A2. processed_messages. NOT SAFE ALONE — read this before applying.
--
-- The nightly retention purge node `Prune Dedupe Guard` issues, over PostgREST
-- with the service_role credential:
--     DELETE /rest/v1/processed_messages?processed_at=lt.<now-7d>
--
-- A BEFORE DELETE guard on this table REFUSES that statement, and PostgREST has
-- no way to set nexus.destructive_write_is_deliberate for a plain DELETE
-- request. Applying A2's trigger without A3's RPC breaks the nightly prune the
-- very first night: the dedupe ledger stops being trimmed and grows without
-- bound. That is slow harm rather than fast harm, but it is harm, and it would
-- show up as a red execution every night at 03:00.
--
-- A3 therefore ships the replacement first, in the same migration: a
-- SECURITY DEFINER RPC that sets the GUC for its own transaction, deletes
-- ONE dealership's expired rows, and supports a dry run. The workflow then
-- calls that instead of the raw DELETE. Both halves go together or neither
-- goes at all.

-- A3. The replacement prune. Tenant-scoped, dry-runnable, and the only
--     sanctioned way to delete from processed_messages.
create or replace function public.nexus_prune_processed_messages(
  p_tenant_id  uuid,
  p_older_than interval default interval '7 days',
  p_dry_run    boolean  default true          -- SAFE BY DEFAULT, on purpose
)
returns table (tenant_id uuid, would_delete bigint, deleted bigint, cutoff timestamptz)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
declare
  v_cutoff  timestamptz := now() - p_older_than;
  v_count   bigint;
  v_deleted bigint := 0;
begin
  if p_tenant_id is null then
    raise exception
      using errcode = 'P0001',
            message = 'NX985 TENANT_REQUIRED: nexus_prune_processed_messages will not run '
                      || 'without a dealership. There is no "prune everybody" call.';
  end if;

  select count(*) into v_count
    from public.processed_messages
   where tenant_id = p_tenant_id
     and processed_at < v_cutoff;

  if p_dry_run then
    return query select p_tenant_id, v_count, 0::bigint, v_cutoff;
    return;
  end if;

  -- The guard is satisfied for THIS transaction only, by the one function that
  -- is allowed to do it, having already proved the delete is tenant-scoped and
  -- time-bounded. set local, never set: it dies with the transaction.
  set local nexus.destructive_write_is_deliberate = 'YES_I_HAVE_A_COPY_AND_I_MEAN_IT';

  delete from public.processed_messages
   where tenant_id = p_tenant_id
     and processed_at < v_cutoff;
  get diagnostics v_deleted = row_count;

  return query select p_tenant_id, v_count, v_deleted, v_cutoff;
end;
$fn$;

comment on function public.nexus_prune_processed_messages(uuid, interval, boolean) is
  'NX985. The ONLY sanctioned delete path for public.processed_messages. Always scoped to one '
  'dealership, always time-bounded, dry-run by default. Sets nexus.destructive_write_is_deliberate '
  'for its own transaction after proving the delete is scoped - which is why the blanket trigger '
  'below can refuse everything else.';

revoke all on function public.nexus_prune_processed_messages(uuid, interval, boolean) from public, anon;
grant execute on function public.nexus_prune_processed_messages(uuid, interval, boolean) to service_role;

-- Now, and only now, the trigger.
do $a2$
begin
  if to_regclass('public.processed_messages') is null then
    raise notice 'NX985 skipped processed_messages: table does not exist';
  else
    drop trigger if exists nexus_processed_messages_refuse_delete on public.processed_messages;
    create trigger nexus_processed_messages_refuse_delete
      before delete on public.processed_messages
      for each row execute function public.nexus_refuse_destructive_write();

    drop trigger if exists nexus_processed_messages_refuse_truncate on public.processed_messages;
    create trigger nexus_processed_messages_refuse_truncate
      before truncate on public.processed_messages
      for each statement execute function public.nexus_refuse_destructive_write();

    raise notice 'NX985 guarded processed_messages (DELETE, TRUNCATE) - prune now goes through '
                 'nexus_prune_processed_messages()';
  end if;
end
$a2$;

-- DEPLOYMENT COUPLING, stated once and plainly:
-- the n8n workflow must be switched to the RPC in the SAME change window.
-- nexus_retention_purge.TENANT_SCOPED.json in this folder already calls it.
-- Applying A2 while the box still runs the raw DELETE = a red execution every
-- night at 03:00 until the workflow is swapped.


-- =====================================================================
-- SECTION B — a BEFORE UPDATE arm, where it is safe
-- =====================================================================

-- B0. A TRAP THAT MUST NOT BE WALKED INTO.
--
-- public.nexus_refuse_destructive_write() ends with:
--     if tg_op = 'DELETE' then return old; end if;
--     return null;
-- For BEFORE TRUNCATE (statement-level) the return value is ignored, so null is
-- harmless. For a BEFORE UPDATE FOR EACH ROW trigger, returning NULL tells
-- Postgres to SILENTLY SKIP THE ROW. Attaching the existing function to UPDATE
-- would not refuse updates - it would make every update appear to succeed and
-- change nothing, with no error anywhere. That is strictly worse than the hole.
--
-- So UPDATE gets its own function, which returns NEW.

create or replace function public.nexus_refuse_destructive_update()
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
          'NX985 DESTRUCTIVE_UPDATE_REFUSED: %I.%I is append-only evidence. '
          || 'Rows here are written once and never rewritten.',
          tg_table_schema, tg_table_name),
        detail  = 'NX900 and NX950 guarded DELETE and TRUNCATE on eleven tables and never '
                  || 'looked at UPDATE. An UPDATE that rewrites an audit row, a lead event or '
                  || 'a customer message destroys the same evidence a DELETE would, and left '
                  || 'no trace at all.',
        hint    = 'If a correction genuinely must be made here, set the GUC '
                  || 'nexus.destructive_write_is_deliberate for the transaction and record the '
                  || 'reason in ops/ first - the same escape hatch NX900 uses.';
  end if;
  -- NEW, never NULL. See B0.
  return new;
end;
$fn$;

comment on function public.nexus_refuse_destructive_update() is
  'NX985. Refuses UPDATE on append-only evidence tables. Deliberately a SEPARATE function from '
  'nexus_refuse_destructive_write(), which returns NULL for non-DELETE ops - attached to BEFORE '
  'UPDATE that would silently skip every row instead of refusing it.';

revoke all on function public.nexus_refuse_destructive_update() from public;

-- B1. WHERE IT IS SAFE, and where it is emphatically not.
--
-- SAFE — append-only by design. An UPDATE here is never legitimate business:
--   audit_log                 a compliance record; rewriting one is the attack
--   lead_event                the event stream; events do not change
--   channel_message_events    the proof a customer wrote to us
--   communication_logs        what was actually said, and when
--
-- NOT SAFE — an UPDATE here is ordinary business, every hour of every day:
--   leads                      status, owner, score all change constantly
--   inventory                  price, status, and the nightly recompute
--   tenants / channel_registry configuration changes
--   whatsapp_conversation_state  the 24h window is literally a mutable clock
--   lead_recovery_actions / inventory_actions  action queues are worked
-- Putting a blanket UPDATE refusal on any of those stops the product working.
-- Section C is the shape of control that fits those tables instead.

do $b1$
declare
  t text;
  append_only text[] := array[
    'audit_log', 'lead_event', 'channel_message_events', 'communication_logs'
  ];
begin
  foreach t in array append_only loop
    if to_regclass('public.' || quote_ident(t)) is null then
      raise notice 'NX985 skipped %: table does not exist', t;
      continue;
    end if;

    execute format('drop trigger if exists %I on public.%I',
                   'nexus_' || t || '_refuse_update', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.nexus_refuse_destructive_update()',
      'nexus_' || t || '_refuse_update', t);

    raise notice 'NX985 guarded % (UPDATE)', t;
  end loop;
end
$b1$;

-- B2. BEFORE APPLYING B1, RUN THIS AND READ THE ANSWER.
--
-- If anything in the product currently UPDATEs one of those four tables, B1
-- breaks it. I could not prove a negative from the repo alone, so this is a
-- check for Ali to run, not a claim I am making:
--
--   select relname, n_tup_upd
--     from pg_stat_user_tables
--    where schemaname = 'public'
--      and relname in ('audit_log','lead_event','channel_message_events','communication_logs');
--
-- n_tup_upd greater than zero on any of them means something updates it today.
-- Find that writer before applying B1, or B1 will break it silently at 03:00.


-- =====================================================================
-- SECTION C — cross-tenant UPDATE detector. COMMENTED OUT ON PURPOSE.
-- =====================================================================
--
-- DO NOT UNCOMMENT UNTIL BOTH OF THESE ARE TRUE:
--   (i)  nx984 (PROPOSED_recompute_inventory_derived.sql) is applied, AND
--   (ii) nx984 has been amended to issue ONE UPDATE PER DEALERSHIP rather than
--        one UPDATE spanning array v_tenants.
--
-- Why (ii) is needed. nx984 as drafted still runs, for a service_role batch,
-- a single statement ending `and i.tenant_id = any(v_tenants)`. That is
-- correctly scoped - it writes only active dealerships - but it is still ONE
-- statement touching MORE THAN ONE tenant_id, which is precisely what the
-- detector below refuses. With one dealership live nothing changes. The night
-- dealership two exists, the detector fires and the nightly recompute fails.
--
-- The amendment is small: wrap the UPDATE in
--     foreach v_one in array v_tenants loop ... end loop;
-- accumulating `touched`, so each statement carries exactly one tenant_id.
-- That is a behaviour-neutral change to nx984 and should be made THERE, not
-- worked around here by widening the detector.
--
-- WHAT BREAKS IF THE ORDER IS REVERSED: see section 0. Short version - the
-- 00:15 job fails every night, silently until someone reads the error workflow,
-- and inventory ageing stops advancing for every dealership.
--
-- WHY A STATEMENT TRIGGER AND NOT A ROW TRIGGER: the thing worth refusing is
-- not "an update happened" - updates are the product - it is "one statement
-- rewrote rows belonging to more than one dealership". Only a statement-level
-- trigger with a transition table can see that. A row trigger sees one row and
-- cannot tell a normal edit from row 4,000 of a mass sweep.

/*
create or replace function public.nexus_refuse_cross_tenant_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  n_tenants integer;
  n_rows    bigint;
begin
  select count(distinct tenant_id), count(*)
    into n_tenants, n_rows
    from new_rows;

  if n_tenants > 1
     and coalesce(current_setting('nexus.destructive_write_is_deliberate', true), '')
         <> 'YES_I_HAVE_A_COPY_AND_I_MEAN_IT'
  then
    raise exception
      using errcode = 'P0001',
            message = format(
              'NX985 CROSS_TENANT_UPDATE_REFUSED: one UPDATE on %I.%I rewrote %s row(s) '
              || 'across %s dealerships.', tg_table_schema, tg_table_name, n_rows, n_tenants),
            detail  = 'A single statement is not allowed to rewrite more than one dealership''s '
                      || 'rows. Loop per dealership instead.',
            hint    = 'If a genuine cross-dealership migration is being run by hand, set '
                      || 'nexus.destructive_write_is_deliberate for the transaction and record '
                      || 'the reason in ops/ first.';
  end if;
  return null;   -- statement-level AFTER trigger: return value is ignored
end;
$fn$;

revoke all on function public.nexus_refuse_cross_tenant_update() from public;

drop trigger if exists nexus_inventory_refuse_cross_tenant_update on public.inventory;
create trigger nexus_inventory_refuse_cross_tenant_update
  after update on public.inventory
  referencing new table as new_rows
  for each statement execute function public.nexus_refuse_cross_tenant_update();

-- Same shape fits leads, which is the table the 13 September incident actually
-- hit, once its writers are known to be single-tenant per statement:
-- drop trigger if exists nexus_leads_refuse_cross_tenant_update on public.leads;
-- create trigger nexus_leads_refuse_cross_tenant_update
--   after update on public.leads
--   referencing new table as new_rows
--   for each statement execute function public.nexus_refuse_cross_tenant_update();
*/


-- =====================================================================
-- SECTION D — make the coverage report stop overstating itself
-- =====================================================================
-- public.nexus_destructive_guard_coverage() reports "GUARDED" based only on
-- triggers named %refuse_delete and %refuse_truncate. After this migration it
-- would still say GUARDED for a table with no UPDATE arm, and would not mention
-- kyc_documents or processed_messages at all. A report that is silent about
-- what it does not measure gets read as broader than it is.

-- The return signature gains a column, and Postgres will not let CREATE OR
-- REPLACE change a function's return type. It must be dropped first. Nothing
-- depends on it in SQL - it is a report a human calls.
drop function if exists public.nexus_destructive_guard_coverage();

create function public.nexus_destructive_guard_coverage()
returns table (table_name text, delete_guarded boolean, truncate_guarded boolean,
               update_guarded boolean, verdict text)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  with business as (
    select unnest(array[
      'leads','audit_log','communication_logs','lead_event',
      'inventory','channel_message_events','whatsapp_conversation_state',
      'channel_registry','tenants','lead_recovery_actions','inventory_actions',
      -- added by NX985
      'kyc_documents','processed_messages'
    ]) as t
  ),
  -- Tables where a blanket UPDATE refusal would stop the product working. Named
  -- here so the verdict can say "not applicable" instead of "OPEN", which would
  -- be alarming and wrong.
  mutable as (
    select unnest(array[
      'leads','inventory','tenants','channel_registry',
      'whatsapp_conversation_state','lead_recovery_actions','inventory_actions',
      'kyc_documents','processed_messages'
    ]) as t
  ),
  g as (
    select b.t,
           to_regclass('public.' || quote_ident(b.t)) as oid,
           exists (select 1 from pg_trigger x where x.tgrelid = to_regclass('public.' || quote_ident(b.t))
                     and not x.tgisinternal and x.tgname like '%refuse_delete')   as del,
           exists (select 1 from pg_trigger x where x.tgrelid = to_regclass('public.' || quote_ident(b.t))
                     and not x.tgisinternal and x.tgname like '%refuse_truncate') as trunc,
           exists (select 1 from pg_trigger x where x.tgrelid = to_regclass('public.' || quote_ident(b.t))
                     and not x.tgisinternal and x.tgname like '%refuse_update')   as upd,
           (b.t in (select t from mutable))                                       as is_mutable
      from business b
  )
  select g.t, g.del, g.trunc, g.upd,
         case
           when g.oid is null                      then 'TABLE ABSENT'
           when not (g.del and g.trunc)            then 'OPEN - a delete here would succeed'
           when g.is_mutable and not g.upd
             then 'DELETE/TRUNCATE guarded; UPDATE deliberately NOT guarded (rows here change as '
                  || 'ordinary business). Cross-tenant mass-update control is NX985 section C.'
           when g.upd                              then 'GUARDED including UPDATE'
           else 'DELETE/TRUNCATE guarded; UPDATE NOT guarded and this table is append-only - '
                || 'that is a gap, not a design choice'
         end
    from g
   order by 5 desc, 1;
$fn$;

revoke all on function public.nexus_destructive_guard_coverage() from public, anon;
grant execute on function public.nexus_destructive_guard_coverage() to authenticated, service_role;


-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Section A:  drop trigger nexus_kyc_documents_refuse_delete on public.kyc_documents;
--             drop trigger nexus_kyc_documents_refuse_truncate on public.kyc_documents;
--             drop trigger nexus_processed_messages_refuse_delete on public.processed_messages;
--             drop trigger nexus_processed_messages_refuse_truncate on public.processed_messages;
--             (leave nexus_prune_processed_messages in place - it is additive and the
--              workflow may already be pointed at it.)
-- Section B:  drop trigger nexus_<t>_refuse_update on public.<t>;  for the four tables.
-- Section D:  re-apply the definition from
--             20260914193452_nx950_the_delete_guard_covered_four_tables_and_the_gate_deletes_from_a_fifth.sql
--             NOTE: the return signature changes in D, so a plain CREATE OR REPLACE
--             back will fail - drop the function first.
