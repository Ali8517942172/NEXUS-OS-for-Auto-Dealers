-- ============================================================================
-- NX1015 — two test dealerships were activated on production, and the backend
--          scope resolver went out with them
--
--   WHAT WAS FOUND (measured on production dsvuoovivysszdoiorch, 27 Sep 2026)
--
--     active dealerships        3   (alba-cars, test-dealer-b, test-dealer-c)
--     nexus_scoped_tenant_id()  NULL
--     nexus_tenancy_readiness() 1 BLOCKER — "backend scope resolves to no dealership"
--
--   `test-dealer-b` and `test-dealer-c` were created status='active' on
--   PRODUCTION on 20 September 2026, two minutes apart (11:13:09 and 11:13:13
--   UTC). CLAUDE.md is explicit that activating a second dealership must be
--   rehearsed on a staging box first. Staging was paused, so it was not.
--
--   Eight consumers take their scope from nexus_scoped_tenant_id(), which
--   answers only while exactly one dealership is active. With three active they
--   raise NX991 rather than going silent — which is the honest failure and is
--   still a failure. Measured refusing, as service_role, before this migration:
--   v_customer_directory, v_inventory_sales, search_rag_documents(q, limit),
--   nexus_comm_keys_for_lead(email, phone), nexus_lead_for_comm_key(key), and
--   with them the Customer 360 nightly batch, the Ask AI RAG path and inbound
--   WhatsApp identity resolution.
--
--   THE TWO TENANTS ARE SYNTHETIC. Established four ways, not assumed:
--     · they are the B and C legs of the three-dealer fixture in
--       ops/tenant-precedence/dealer-b/ (fixtures.json names them
--       test-dealer-b / test-dealer-c; setup.py's own docstring explains it
--       chose status='active' because tenants.status has no 'test' value and
--       nexus_current_tenant_ids() joins on status='active');
--     · every lead, profile, comm log and audit row in them is named
--       "NEXUS TEST ..." — 7 leads, 20 communication_logs, 37 audit_log,
--       8 customer_360_profiles, 6 kyc_documents, 1 purchase_history, 4
--       whatsapp_contacts, 2 tenant_members, and NOT ONE row fails that test;
--     · every email is a plus-addressed alias of the owner's own mailbox
--       (aliasgher892+b-c1@…, +dealerb@…, …) and every phone is one of the
--       owner's own two handsets or the literal string 'retired-demo-fixture'.
--       No third party's identifier appears anywhere in either tenant;
--     · neither tenant has a lead_ingest_endpoint and both hold zero
--       lead_event rows, so nothing in them arrived from a real source. The
--       six kyc_documents rows carry NULL full_name, NULL date_of_birth and
--       NULL storage_path — no document was ever stored. The one
--       purchase_history row is AED 1 with a NULL purchase_date.
--
--   WHY SUSPENSION AND NOT DELETION
--
--   This repository has already lost roughly 116 production `leads` rows to a
--   hand-written "clean slate" DELETE, and nobody has ever established whether
--   PITR could have recovered them. Suspension produces the identical resolver
--   outcome — nexus_current_tenant_ids() and nexus_active_dealership_ids() both
--   require status='active' — while destroying nothing. Every row these two
--   tenants hold stays on disk, stays counted by nexus_quarantine_census() and
--   the readiness gate, and stays available if the fixture is ever wanted
--   again. A status change is a decision that can be unmade; a DELETE is not.
--
--   There is NO DELETE, NO DROP and NO TRUNCATE in this file, deliberately.
--   ops/demo/teardown_demo_tenant.sql is the destructive path and it is NOT
--   the path taken here — nor could it be: its own guard refuses to run
--   against any database containing the ALBA tenant.
--
--   WHAT THIS DOES NOT DO
--
--   It does not widen nexus_scoped_tenant_id(). Handing a backend batch some
--   dealership when the caller named none is how one dealership's job writes
--   another's data, and the readiness gate says so in its own HINT. The plural
--   answer is public.nexus_active_dealership_ids(); driving the eight consumers
--   over it is the real fix and it is a separate, larger job. Until that is
--   done, production can hold exactly one active dealership, and this migration
--   restores that condition rather than removing the constraint.
--
--   HOW TO REVERSE IT — one statement:
--
--     update public.tenants set status = 'active'
--      where slug in ('test-dealer-b', 'test-dealer-c');
--
--   Do not run that reversal against production until the eight consumers take
--   an explicit tenant. It was rehearsed on staging (below) and it puts the
--   BLOCKER straight back, which is the point of recording it: the door swings
--   both ways and the far side is still broken.
--
--   EVIDENCE
--     · Rehearsed on staging wwspuxrbiyagnrnzgate, which was restored from
--       paused for this and happened to carry the SAME shape — three active
--       synthetic tenants. In one rolled-back transaction: suspend two →
--       resolver answers, 0 BLOCKERs, all five consumers answer (4 rows, 3
--       rows, 1 doc, 4 comm keys, lead 11); reverse → NULL and NX991 return on
--       all five; suspended tenants' rows unchanged throughout.
--     · Rehearsed again on PRODUCTION in a rolled-back transaction before
--       being applied for real. Level 2 (PROVEN) on both boxes; level 3
--       (PRODUCTION-DEPLOYED) once this migration is applied. No dealership has
--       driven a real enquiry through the restored consumers, so nothing here
--       is level 4.
--
--   Written 27 September 2026.
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 0 · GUARD. Refuse unless the two tenants are the fixture this file describes.
--     A slug is not enough: assert every row they hold is NEXUS TEST material
--     before changing anything, so a later database where those slugs mean
--     something else is refused rather than quietly suspended.
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
declare
  v_ids   uuid[];
  v_bad   bigint;
begin
  select array_agg(id) into v_ids
    from public.tenants where slug in ('test-dealer-b','test-dealer-c');

  if v_ids is null then
    raise notice 'NX1015: neither test-dealer-b nor test-dealer-c exists here. Nothing to do.';
    return;
  end if;

  -- Not one lead in these tenants may be anything but fixture material.
  select count(*) into v_bad
    from public.leads
   where tenant_id = any(v_ids)
     and (name not like 'NEXUS TEST%'
          or coalesce(email,'') not like 'aliasgher892+%@gmail.com');
  if v_bad > 0 then
    raise exception using
      errcode = 'NX999',
      message = format('REFUSED: %s lead(s) in test-dealer-b/c are not fixture rows.', v_bad),
      detail  = 'This migration suspends two tenants on the measured basis that every row they hold is '
             || 'synthetic NEXUS TEST material owned by the operator. A lead that is not named NEXUS TEST, '
             || 'or whose email is not a plus-alias of the operator''s own mailbox, may be a real person, '
             || 'and a real person''s dealership is not suspended by a migration.',
      hint    = 'Read those rows before doing anything else. Nothing has been changed.';
  end if;

  -- Nothing may have arrived through the ingestion layer.
  select count(*) into v_bad from public.lead_event where tenant_id = any(v_ids);
  if v_bad > 0 then
    raise exception using
      errcode = 'NX999',
      message = format('REFUSED: %s lead_event row(s) exist in test-dealer-b/c.', v_bad),
      detail  = 'A lead_event means an enquiry arrived through a registered ingest endpoint, which is what '
             || 'a real source looks like. These tenants held zero when this was measured on 27 Sep 2026.',
      hint    = 'Establish where those events came from before suspending the tenant that received them.';
  end if;

  -- ALBA must be here and active, or suspending the others fixes nothing.
  if not exists (select 1 from public.tenants
                  where slug = 'alba-cars' and status = 'active') then
    raise exception using
      errcode = 'NX999',
      message = 'REFUSED: alba-cars is not present and active.',
      detail  = 'This migration exists to return the backend scope resolver to the one real dealership. '
             || 'Suspending the test tenants without ALBA active would leave zero active dealerships, '
             || 'which is a different broken state, not a fix.',
      hint    = 'Check public.tenants before re-running.';
  end if;
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1 · BEFORE — every table these two tenants touch. Nothing may move.
-- ────────────────────────────────────────────────────────────────────────────
create temporary table _nx1015_before on commit drop as
with t as (select id from public.tenants where slug in ('test-dealer-b','test-dealer-c'))
select 'BC.leads' k, count(*) n from public.leads where tenant_id in (select id from t)
union all select 'BC.audit_log',             count(*) from public.audit_log             where tenant_id in (select id from t)
union all select 'BC.communication_logs',    count(*) from public.communication_logs    where tenant_id in (select id from t)
union all select 'BC.customer_360_profiles', count(*) from public.customer_360_profiles where tenant_id in (select id from t)
union all select 'BC.kyc_documents',         count(*) from public.kyc_documents         where tenant_id in (select id from t)
union all select 'BC.purchase_history',      count(*) from public.purchase_history      where tenant_id in (select id from t)
union all select 'BC.whatsapp_contacts',     count(*) from public.whatsapp_contacts     where tenant_id in (select id from t)
union all select 'BC.deals_embeddings',      count(*) from public.deals_embeddings      where tenant_id in (select id from t)
union all select 'BC.tenant_members',        count(*) from public.tenant_members        where tenant_id in (select id from t)
union all select 'ALBA.leads',              count(*) from public.leads              where tenant_id = (select id from public.tenants where slug='alba-cars')
union all select 'ALBA.inventory',          count(*) from public.inventory          where tenant_id = (select id from public.tenants where slug='alba-cars')
union all select 'ALBA.audit_log',          count(*) from public.audit_log          where tenant_id = (select id from public.tenants where slug='alba-cars')
union all select 'ALBA.communication_logs', count(*) from public.communication_logs where tenant_id = (select id from public.tenants where slug='alba-cars')
union all select 'tenants.total',           count(*) from public.tenants;

-- ────────────────────────────────────────────────────────────────────────────
-- 2 · THE CHANGE. One UPDATE of one column. That is the whole migration.
--
--     'suspended' is the legal value that means suspended —
--     tenants.status is CHECK (status in ('active','suspended','archived')),
--     per 20260902084409_nexus_mt_01_tenant_core.sql. 'archived' would read as
--     a decision that the fixture is finished with, which is not what is being
--     asserted here; 'suspended' says paused, reversibly.
-- ────────────────────────────────────────────────────────────────────────────
update public.tenants
   set status = 'suspended'
 where slug in ('test-dealer-b','test-dealer-c')
   and status = 'active';

-- ────────────────────────────────────────────────────────────────────────────
-- 3 · POST-CONDITIONS. Each one raises rather than reports, so a migration
--     that did not achieve what its header claims cannot commit.
-- ────────────────────────────────────────────────────────────────────────────
do $assert$
declare
  v_active   bigint;
  v_scoped   uuid;
  v_blockers bigint;
  v_moved    text;
begin
  -- (a) exactly one active dealership
  select count(*) into v_active
    from public.tenants where status = 'active' and coalesce(is_quarantine,false) = false;
  if v_active <> 1 then
    raise exception 'NX1015 FAILED: % active non-quarantine dealerships after the update, expected 1.', v_active;
  end if;

  -- (b) the resolver answers, and answers ALBA
  select public.nexus_scoped_tenant_id() into v_scoped;
  if v_scoped is distinct from (select id from public.tenants where slug = 'alba-cars') then
    raise exception 'NX1015 FAILED: nexus_scoped_tenant_id() returned %, expected the alba-cars id.',
      coalesce(v_scoped::text,'NULL');
  end if;

  -- (c) the gate that caught this is quiet
  select count(*) into v_blockers
    from public.nexus_tenancy_readiness() where severity = 'BLOCKER';
  if v_blockers <> 0 then
    raise exception 'NX1015 FAILED: nexus_tenancy_readiness() still returns % BLOCKER(s).', v_blockers;
  end if;

  -- (d) NOTHING MOVED. Not one row, in either dealership's data.
  select string_agg(format('%s %s->%s', b.k, b.n, a.n), ', ')
    into v_moved
    from _nx1015_before b
    join (
      with t as (select id from public.tenants where slug in ('test-dealer-b','test-dealer-c'))
      select 'BC.leads' k, count(*) n from public.leads where tenant_id in (select id from t)
      union all select 'BC.audit_log',             count(*) from public.audit_log             where tenant_id in (select id from t)
      union all select 'BC.communication_logs',    count(*) from public.communication_logs    where tenant_id in (select id from t)
      union all select 'BC.customer_360_profiles', count(*) from public.customer_360_profiles where tenant_id in (select id from t)
      union all select 'BC.kyc_documents',         count(*) from public.kyc_documents         where tenant_id in (select id from t)
      union all select 'BC.purchase_history',      count(*) from public.purchase_history      where tenant_id in (select id from t)
      union all select 'BC.whatsapp_contacts',     count(*) from public.whatsapp_contacts     where tenant_id in (select id from t)
      union all select 'BC.deals_embeddings',      count(*) from public.deals_embeddings      where tenant_id in (select id from t)
      union all select 'BC.tenant_members',        count(*) from public.tenant_members        where tenant_id in (select id from t)
      union all select 'ALBA.leads',              count(*) from public.leads              where tenant_id = (select id from public.tenants where slug='alba-cars')
      union all select 'ALBA.inventory',          count(*) from public.inventory          where tenant_id = (select id from public.tenants where slug='alba-cars')
      union all select 'ALBA.audit_log',          count(*) from public.audit_log          where tenant_id = (select id from public.tenants where slug='alba-cars')
      union all select 'ALBA.communication_logs', count(*) from public.communication_logs where tenant_id = (select id from public.tenants where slug='alba-cars')
      union all select 'tenants.total',           count(*) from public.tenants
    ) a on a.k = b.k
   where a.n <> b.n;
  if v_moved is not null then
    raise exception using
      errcode = 'NX999',
      message = 'NX1015 FAILED: row counts changed. This migration must move no data at all.',
      detail  = v_moved,
      hint    = 'Nothing in this file deletes or writes a data row. If a count moved, something else did.';
  end if;

  raise notice 'NX1015 OK: 1 active dealership, nexus_scoped_tenant_id() = %, 0 BLOCKERs, 0 rows moved.',
    v_scoped;
end
$assert$;

commit;
