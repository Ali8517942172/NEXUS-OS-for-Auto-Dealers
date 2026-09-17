-- NX984 — The journey could be deleted across every dealership at once.
--
-- Measured 17 Sep 2026 by the two-tenant adversarial suite, on a staging
-- harness built from this database's own DDL and policies:
--
--   as service_role, with nothing in the session naming either dealership:
--     delete from public.journey_step;   ->  ROWS = 4   (both tenants, all rows)
--
-- No trigger fired. `customer` survived the same attempt only because an
-- incidental foreign key got in the way -- an accident, not a control.
--
-- These three tables were created by NX960 on 14 Sep and never added to the
-- destructive guard. NX982 gave them row security this morning, which stops a
-- signed-in salesperson at dealership B. It does nothing here: n8n runs as
-- service_role, and service_role carries rolbypassrls, so RLS is never
-- consulted for it. The suite measured that too -- as service_role, one query
-- returned both dealerships' inventory cost prices, and an UPDATE aimed at
-- tenant B changed 2 rows with nothing in the session naming B.
--
-- So the guard is the only thing standing between a service-role mistake and
-- every dealership's evidence trail. `journey_step` IS that evidence trail:
-- delete it and the answer to "what happened to this enquiry, and when" is
-- gone for every customer of every dealer, with nothing left to say it ever
-- existed.
--
-- kyc_documents is added for the same reason and one more: it holds identity
-- documents, and the nightly retention purge already reaches for it. The purge
-- UPDATEs there rather than deleting, so this changes nothing tonight.
--
-- DELIBERATELY NOT GUARDED HERE: processed_messages. The retention purge
-- deletes from it nightly (`processed_at < now() - 7 days`, unpredicated), so
-- a guard on it would refuse a live scheduled job the first night it ran.
-- That table gets its guard in the same change that gives the purge a
-- tenant-scoped RPC to call instead -- see ops/destructive-scope/. Guarding it
-- first would look like hardening and would read as an outage.
--
-- The escape hatch is unchanged: a deliberate delete sets
--   set local nexus.destructive_write_is_deliberate = 'YES_I_HAVE_A_COPY_AND_I_MEAN_IT';
-- which is the point -- the guard stops the accident, not the operator.

begin;

create trigger nexus_customer_refuse_delete
  before delete on public.customer
  for each row execute function public.nexus_refuse_destructive_write();
create trigger nexus_customer_refuse_truncate
  before truncate on public.customer
  for each statement execute function public.nexus_refuse_destructive_write();

create trigger nexus_conversation_refuse_delete
  before delete on public.conversation
  for each row execute function public.nexus_refuse_destructive_write();
create trigger nexus_conversation_refuse_truncate
  before truncate on public.conversation
  for each statement execute function public.nexus_refuse_destructive_write();

create trigger nexus_journey_step_refuse_delete
  before delete on public.journey_step
  for each row execute function public.nexus_refuse_destructive_write();
create trigger nexus_journey_step_refuse_truncate
  before truncate on public.journey_step
  for each statement execute function public.nexus_refuse_destructive_write();

create trigger nexus_kyc_documents_refuse_delete
  before delete on public.kyc_documents
  for each row execute function public.nexus_refuse_destructive_write();
create trigger nexus_kyc_documents_refuse_truncate
  before truncate on public.kyc_documents
  for each statement execute function public.nexus_refuse_destructive_write();

do $verify$
declare n int;
begin
  select count(*) into n
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
   where ns.nspname = 'public'
     and p.proname = 'nexus_refuse_destructive_write'
     and not t.tgisinternal
     and c.relname in ('customer','conversation','journey_step','kyc_documents');
  if n <> 8 then
    raise exception 'NX984: expected 8 new guard triggers, found %. Rolling back.', n;
  end if;

  select count(distinct c.relname) into n
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
   where p.proname = 'nexus_refuse_destructive_write' and not t.tgisinternal;
  raise notice 'NX984: % tables now refuse an undeliberate delete or truncate, up from 11. journey_step is covered: the evidence trail can no longer be removed by a service-role mistake. processed_messages is still open, on purpose, until the retention purge has a scoped RPC to call.', n;
end
$verify$;

commit;