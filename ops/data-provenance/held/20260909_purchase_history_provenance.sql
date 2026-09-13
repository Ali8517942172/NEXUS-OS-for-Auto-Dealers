-- ============================================================================
-- HELD. NOT QUEUED FOR APPLY. NOT IN supabase/migrations/.
--
-- One worked example of the shape in ops/data-provenance/MIGRATION-PATTERN.md,
-- for ONE table: public.purchase_history.
--
-- WHY THIS TABLE. It is the one the owner hesitated over, and it holds the
-- single row behind every "confirmed revenue AED 585,000" tile in the product.
-- Counted from pg_depend on 9 Sep 2026, it is reached by ELEVEN of the 39
-- dashboard views: v_attribution_edges, v_attribution_events,
-- v_attribution_lead_chain, v_attribution_sale_chain, v_customer_360,
-- v_customer_directory, v_deal_rescue_candidates, v_deal_rescue_readiness,
-- v_inventory_action_queue, v_lead_recovery, v_lead_recovery_queue.
-- Only `leads` (16) reaches more. See ops/data-provenance/MEASUREMENTS.md #4.
--
-- WHAT MEASUREMENT CHANGED. The refusal to "blindly add an is_test column"
-- rested on nexus_guard_born_open_grants() stripping live dashboard write
-- grants on ALTER TABLE. Measured on production dsvuoovivysszdoiorch, 9 Sep
-- 2026, purchase_history has NOTHING for authenticated to lose:
--
--   select table_name, grantee, string_agg(privilege_type,',' order by privilege_type)
--   from information_schema.role_table_grants
--   where table_schema='public' and table_name='purchase_history' group by 1,2;
--   -- purchase_history | authenticated | SELECT
--   -- purchase_history | postgres      | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
--   -- purchase_history | service_role  | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
--
--   select count(*) from information_schema.role_table_grants
--   where table_schema='public' and grantee='anon';   -- 0
--
-- The guard revokes ALL from anon (nothing there) and INSERT/UPDATE/DELETE/
-- TRUNCATE from authenticated (nothing there). It does NOT revoke SELECT, and
-- it does not touch service_role. So on THIS table the guard is a no-op.
--
-- The fear is correct, and measured, for two other tables:
--   inventory : table DELETE + INSERT on 9 columns + UPDATE on 8 columns
--   leads     : UPDATE on 8 columns
-- Precedent: supabase/migrations/20260906071310_restore_inventory_write_grants_
-- the_acl_guard_stripped_on_alter.sql, which repaired exactly that after
-- 20260906065739 ran two ALTER TABLEs on inventory.
--
-- Step 5 below re-asserts anyway. Today it is a no-op; the day somebody grants
-- the dashboard a write path into purchase_history, it stops being one, and a
-- re-assertion block that only appears when it is needed never appears.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   * It writes no REAL_ATTESTED. No migration ever does. Naming a row as the
--     dealership's own business is a claim only the dealership can make.
--   * It changes no view and no number. Consumers move in a separate, later
--     migration, preceded by the census at the foot of this file.
--   * It does not grant authenticated any write on the new columns.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STAGE 1  The vocabulary, defined ONCE, as rows.
--
-- This is the whole answer to ops/f2-tenant-rule/RECONCILIATION.md. There,
-- a producer's vocabulary lived in a `--` comment and a consumer's in a column
-- default; the sets did not intersect and the filter was structurally empty for
-- a week. Here the values are a primary key and every provenance column is a
-- foreign key to it, so a writer emitting a value no consumer accepts fails
-- with SQLSTATE 23503 at the moment of the write, naming the constraint --
-- rather than silently producing nothing.
-- ---------------------------------------------------------------------------

create table if not exists public.data_origin_kind (
  origin               text primary key,
  counts_as_real       boolean  not null,
  is_test              boolean  not null,
  requires_test_run    boolean  not null,
  requires_attestation boolean  not null,
  sort                 smallint not null,
  description          text     not null,

  -- Real and test are not opposites. UNKNOWN is neither, and must stay
  -- representable, because on the day this ships UNKNOWN is every row.
  constraint data_origin_kind_not_both check (not (counts_as_real and is_test)),

  -- Anything a harness can mint must be bindable to a run, or teardown is a
  -- grep. Anything that counts must be attested, or "default REAL" comes back
  -- through the side door.
  constraint data_origin_kind_test_needs_run check (is_test = requires_test_run),
  constraint data_origin_kind_real_needs_attestation
    check (counts_as_real = requires_attestation)
);

comment on table public.data_origin_kind is
  'The only definition of what data_origin may say. Every provenance column '
  'references it, so an unknown spelling fails at write time with 23503 rather '
  'than filtering to nothing downstream. Consumers select rows of this table by '
  'counts_as_real / is_test; no view, setting or screen names an origin literal.';

insert into public.data_origin_kind
  (origin, counts_as_real, is_test, requires_test_run, requires_attestation, sort, description)
values
  ('UNKNOWN', false, false, false, false, 0,
   'Nobody has said. The default, and the honest state of every row written before this contract existed. Neither real nor test: it must be reported as its own quantity, never folded into either. Folding it into real is what puts a preflight in the team-performance table; folding it into test would delete the dealership''s history from every screen on the day this ships.'),

  ('VENDOR_IMPORT_UNVERIFIED', false, false, false, false, 10,
   'Bulk-loaded from a dealer system, DMS export or CSV. Real in intent; nobody has attested it row by row. Distinct from UNKNOWN because the route is known. Does NOT count toward any figure shown to a dealer.'),

  ('SIMULATED', false, true, true, false, 20,
   'Produced by the NEXUS marketplace or lead simulator. Aligns with lead_provenance_kind.simulated, which carries counts_as_real = false.'),

  ('DEMO_SEED', false, true, true, false, 30,
   'Written by a demo or sales fixture, e.g. ops/demo/seed_demo_tenant.sql. That file refuses to run against production; this value exists so that a future one which does not refuse is still visible.'),

  ('TEST_FIXTURE', false, true, true, false, 40,
   'Written by a NEXUS test, preflight or QA run. Lead 121 on production -- Preflight Walk-In, walkin-preflight-2026-09-07-01 -- is this, and today nothing but an RFC 2606 .invalid email domain says so.'),

  ('REAL_ATTESTED', true, false, false, true, 50,
   'A named person holding owner or admin on this tenant has attested that this row records the dealership''s own business, and an append-only row in data_provenance_attestation says who, when, and on what evidence. The ONLY value that makes a row count. Unreachable except through nexus_attest_data_origin().')
on conflict (origin) do nothing;


create table if not exists public.data_origin_source (
  source_kind text primary key,
  sort        smallint not null,
  description text     not null
);

comment on table public.data_origin_source is
  'How a row physically arrived. Orthogonal to data_origin: REAL_ATTESTED + '
  'SQL_CONSOLE is a true and useful pair (someone typed a real sale in by hand) '
  'and collapsing the two into one enum would lose it. Named origin_source_kind '
  'on the tables, NOT source_kind: that name is already taken twice in this '
  'schema with two vocabularies that do not intersect -- competitors.source_kind '
  '(oem|marketplace|dealer|unknown) and policy_platform_attestation.source_kind '
  '(PROVIDER_ACCOUNT_CONSOLE|...). A third meaning under one name is how '
  'match_quality happened.';

insert into public.data_origin_source (source_kind, sort, description) values
  ('WEBHOOK',       10, 'Arrived at a lead_ingest_endpoint or channel webhook.'),
  ('OPERATOR_FORM', 20, 'A person at the dealership typed it into a NEXUS screen.'),
  ('BULK_IMPORT',   30, 'CSV, DMS export or one-off loader.'),
  ('SCRAPER',       40, 'A market or competitor scrape.'),
  ('NEXUS_DERIVED', 50, 'Computed by NEXUS from other rows. Its provenance is the weakest of its inputs; see ops/data-provenance/RISKS.md section 4.'),
  ('SQL_CONSOLE',   60, 'Written directly against the database by a human.'),
  ('TEST_HARNESS',  70, 'Written by an automated test or preflight.')
on conflict (source_kind) do nothing;


-- A test run is the thing a test_run_id binds together: every row that one
-- execution of one harness wrote, in every table. It makes teardown provable
-- (delete where test_run_id = $1, then census to zero) instead of a grep for
-- .invalid domains and NX- prefixes.
create table if not exists public.data_test_run (
  test_run_id  uuid primary key default gen_random_uuid(),
  label        text not null,
  harness      text not null,
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  torn_down_at timestamptz,
  note         text,
  constraint data_test_run_label_not_blank check (btrim(label)   <> ''),
  constraint data_test_run_harness_not_blank check (btrim(harness) <> ''),
  constraint data_test_run_ended_after_start check (ended_at is null or ended_at >= started_at)
);


-- Append-only. The evidence that an attestation happened, separate from the
-- column it set -- same separation policy_platform_attestation already makes
-- for policy rules.
create table if not exists public.data_provenance_attestation (
  attestation_id           uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete restrict,
  table_name               text not null,
  row_key                  text not null,
  origin                   text not null references public.data_origin_kind(origin) on delete restrict,
  attested_by              text not null,
  attested_by_auth_user_id uuid,
  attested_at              timestamptz not null default now(),
  evidence                 text not null,
  observed_on              date,
  constraint dpa_evidence_not_blank check (btrim(evidence) <> ''),
  constraint dpa_attested_by_not_blank check (btrim(attested_by) <> ''),
  constraint dpa_observed_not_future check (observed_on is null or observed_on <= current_date)
);

create index if not exists dpa_row_idx
  on public.data_provenance_attestation (tenant_id, table_name, row_key, attested_at desc);


-- ---------------------------------------------------------------------------
-- STAGE 2  The columns.
--
-- ONE ALTER TABLE. Fires nexus_guard_born_open_grants (object_type 'table').
-- On this table that is a measured no-op; stage 5 re-asserts regardless.
--
-- `not null default 'UNKNOWN'` backfills every existing row with no UPDATE and
-- no table rewrite. On production that is one row -- the AED 585,000 sale --
-- and UNKNOWN is the true answer for it. See RISKS/MEASUREMENTS section 5.4.
-- ---------------------------------------------------------------------------

alter table public.purchase_history
  add column if not exists data_origin        text not null default 'UNKNOWN'
    references public.data_origin_kind(origin)        on delete restrict,
  add column if not exists test_run_id        uuid
    references public.data_test_run(test_run_id)      on delete restrict,
  add column if not exists origin_source_kind text
    references public.data_origin_source(source_kind) on delete restrict,
  add column if not exists origin_recorded_by text;

comment on column public.purchase_history.data_origin is
  'Whether this sale is the dealership''s own business. Default UNKNOWN. '
  'REAL_ATTESTED requires an explicit attestation event -- never the absence of '
  'a test marker. Values are defined once, in data_origin_kind, and enforced by '
  'foreign key: a writer emitting an undefined spelling fails with 23503 rather '
  'than being silently filtered out downstream.';

comment on column public.purchase_history.test_run_id is
  'The one execution of one harness that wrote this row. NOT NULL exactly when '
  'data_origin_kind.requires_test_run, enforced symmetrically by the trigger '
  'below, so neither "a fixture nobody can tear down" nor "a real row filed '
  'under a test run" is representable.';


-- ---------------------------------------------------------------------------
-- STAGE 3  Index. CREATE INDEX fires the guard and matches none of its object
-- types, so it costs no grants.
-- ---------------------------------------------------------------------------

create index if not exists purchase_history_data_origin_idx
  on public.purchase_history (tenant_id, data_origin);


-- ---------------------------------------------------------------------------
-- STAGE 4  Invariants as TRIGGERS, not as ALTER TABLE ... ADD CONSTRAINT.
--
-- Two reasons, both load-bearing:
--   1. CREATE TRIGGER reports object_type 'trigger', which is not in
--      nexus_guard_born_open_grants()'s list, so it strips nothing.
--   2. The symmetry rule needs a subquery against data_origin_kind, and a
--      CHECK constraint cannot contain one.
--
-- CREATE FUNCTION does fire the guard (object_type 'function') and runs
-- `revoke all on function ... from anon`. That is a no-op and not a grant this
-- contract wants.
-- ---------------------------------------------------------------------------

create or replace function public.nexus_guard_data_origin()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
declare
  k public.data_origin_kind%rowtype;
begin
  select * into k from public.data_origin_kind where origin = new.data_origin;
  if not found then
    -- The foreign key should make this unreachable. If it is reached, the
    -- vocabulary and the data have diverged, and that is a failure, not a
    -- filter. Never assume a default here.
    raise exception 'data_origin % is not defined in data_origin_kind', new.data_origin
      using errcode = '23503';
  end if;

  if k.requires_test_run and new.test_run_id is null then
    raise exception 'data_origin % requires a registered test_run_id', new.data_origin
      using errcode = '23514',
            detail  = 'Fixture rows must be bindable to the run that wrote them.',
            hint    = 'insert into public.data_test_run (label, harness) ... first.';
  end if;

  if not k.requires_test_run and new.test_run_id is not null then
    raise exception 'data_origin % must not carry a test_run_id', new.data_origin
      using errcode = '23514',
            detail  = 'A row filed under a test run while claiming not to be test data is the ambiguity this column exists to remove.';
  end if;

  if k.requires_attestation
     and coalesce(current_setting('nexus.attesting', true), 'off') <> 'on' then
    raise exception 'data_origin % may only be set by nexus_attest_data_origin()', new.data_origin
      using errcode = '42501',
            detail  = 'Default is UNKNOWN. REAL requires an explicit attestation event by a named owner or admin, not the absence of a test marker.',
            hint    = 'select public.nexus_attest_data_origin(''public.purchase_history'', <row_key>, ''REAL_ATTESTED'', <evidence>, <observed_on>);';
  end if;

  return new;
end
$$;

comment on function public.nexus_guard_data_origin() is
  'Grants do not restrain service_role, and every n8n workflow and backend '
  'writer is service_role. This trigger is what actually makes REAL_ATTESTED '
  'unreachable to an ordinary writer. It is bypassable by anyone who can ALTER '
  'TABLE ... DISABLE TRIGGER -- see ops/data-provenance/RISKS.md section 1.';

drop trigger if exists purchase_history_data_origin_guard on public.purchase_history;
create trigger purchase_history_data_origin_guard
  before insert or update of data_origin, test_run_id
  on public.purchase_history
  for each row execute function public.nexus_guard_data_origin();


-- ---------------------------------------------------------------------------
-- STAGE 5  Re-assert every grant measured before stage 2.
--
-- Measured on production 9 Sep 2026 (query in the header): purchase_history
-- grants authenticated SELECT only, and the guard does not revoke SELECT, so
-- there is nothing to restore and these statements are a no-op TODAY.
--
-- They are here because the day somebody grants the dashboard a write path into
-- this table is the day the omission becomes a silent 42501 on save, and a
-- re-assertion block that only appears when it is needed never appears.
--
-- The four new columns are deliberately absent: authenticated may READ
-- provenance (table-level SELECT covers columns added later) and may never
-- WRITE it. Adding data_origin to an UPDATE grant would hand the dashboard the
-- ability to mark its own data real.
-- ---------------------------------------------------------------------------

grant select on public.purchase_history to authenticated;

grant select on public.data_origin_kind             to authenticated;
grant select on public.data_origin_source           to authenticated;
grant select on public.data_test_run                to authenticated;
grant select on public.data_provenance_attestation  to authenticated;
-- Deliberately no INSERT/UPDATE/DELETE to authenticated on any of the above.
-- data_origin_kind is granted SELECT because screens read the vocabulary from
-- it rather than hardcoding literals (CONTRACT.md section 5.4) -- the same way
-- lead_provenance_kind is already granted SELECT to authenticated today.


-- ---------------------------------------------------------------------------
-- STAGE 6  Named downward attestation.
--
-- NOTHING TO DO ON THIS TABLE. purchase_history holds one row and its status is
-- genuinely unresolved:
--
--   id 2f04d2c4-4cd2-424c-aa34-6cc2a0c20b86 | customer_name 'Ali'
--   | vehicle 'Lexus LX 600 2024' | amount_aed 585000 | purchase_date 2026-09-02
--   | deal_id 'auto:shabbir53ujjainwala@gmail.com|2026-09-02' | lead_id 38
--   | created_at 2026-09-02 09:59:53+00
--
-- The deal_id names an email that is neither the row's own customer_name nor
-- the address on leads.id = 38. The vehicle text matches unit NX-1011 at exactly
-- its list price and NX-1011 is still Available -- ops/truth-dashboard/SPEC.md:141
-- already says "the text matches perfectly and proves nothing". The row was
-- created 74 minutes after the ALBA tenant row itself.
--
-- None of that settles it. So it stays UNKNOWN, which is true, and the question
-- goes to the owner. A migration that guessed REAL here would be the exact
-- failure this contract exists to prevent.
--
-- For contrast, the shape a downward attestation DOES take -- on public.leads,
-- in that table's own migration, not here:
--
--   update public.leads set data_origin = 'TEST_FIXTURE',
--          test_run_id = <the registered walkin-preflight run>,
--          origin_source_kind = 'TEST_HARNESS',
--          origin_recorded_by = 'harness:walkin-preflight-2026-09-07-01'
--    where id = 121;
--   -- evidence: ops/pilot-readiness/BLOCKERS.md:123-125 "It is Ali's own
--   -- preflight test, and it is on file as production traffic";
--   -- CLAUDE.md:512 "a preflight, not a customer".
--
-- Naming a row as OURS is a claim we can support from our own records.
-- Naming a row as the DEALERSHIP'S is a claim only the dealership can make.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- STAGE 7  Fail loudly if any of the above did not land.
-- A migration that reports success over a broken screen is worse than one that
-- fails. This does not rely on any theory about how the ACL guard treats GRANT;
-- it verifies the outcome.
-- ---------------------------------------------------------------------------

do $$
declare
  n_kinds     integer := (select count(*) from public.data_origin_kind);
  n_real      integer := (select count(*) from public.data_origin_kind where counts_as_real);
  col_default text    := (select column_default from information_schema.columns
                           where table_schema='public' and table_name='purchase_history'
                             and column_name='data_origin');
  n_unknown   integer := (select count(*) from public.purchase_history where data_origin = 'UNKNOWN');
  n_rows      integer := (select count(*) from public.purchase_history);
  n_bad       integer := (select count(*) from public.purchase_history p
                           where not exists (select 1 from public.data_origin_kind k
                                              where k.origin = p.data_origin));
  has_trigger boolean := exists (select 1 from pg_trigger
                                  where tgrelid = 'public.purchase_history'::regclass
                                    and tgname  = 'purchase_history_data_origin_guard'
                                    and not tgisinternal);
  auth_select boolean := has_table_privilege('authenticated','public.purchase_history','SELECT');
  auth_write  boolean := has_table_privilege('authenticated','public.purchase_history','INSERT')
                      or has_table_privilege('authenticated','public.purchase_history','UPDATE')
                      or has_table_privilege('authenticated','public.purchase_history','DELETE')
                      or has_any_column_privilege('authenticated','public.purchase_history','INSERT')
                      or has_any_column_privilege('authenticated','public.purchase_history','UPDATE');
  anon_any    boolean := exists (select 1 from information_schema.role_table_grants
                                  where table_schema='public' and grantee='anon');
begin
  if n_kinds <> 6 then
    raise exception 'data_origin_kind holds % rows, expected 6', n_kinds;
  end if;

  -- Invariant I3: at least one origin can ever count. A vocabulary in which
  -- nothing is real is the match_quality failure wearing this contract's name.
  if n_real < 1 then
    raise exception 'no data_origin_kind row has counts_as_real = true; every consumer would be structurally empty';
  end if;

  if col_default is null or col_default not like '%UNKNOWN%' then
    raise exception 'purchase_history.data_origin default is %, expected UNKNOWN', coalesce(col_default,'(null)');
  end if;

  -- Backfill is UNKNOWN for every pre-existing row, by default, with no UPDATE.
  if n_unknown <> n_rows then
    raise exception 'backfill wrote something other than UNKNOWN: % of % rows are UNKNOWN', n_unknown, n_rows;
  end if;

  -- Invariant I4.
  if n_bad > 0 then
    raise exception '% purchase_history rows carry a data_origin absent from data_origin_kind', n_bad;
  end if;

  if not has_trigger then
    raise exception 'the data_origin guard trigger is not installed; REAL_ATTESTED would be writable by service_role';
  end if;

  -- Invariant I5: the ACL is what it was.
  if not auth_select then
    raise exception 'authenticated lost SELECT on purchase_history; the dashboard would 42501 on read';
  end if;
  if auth_write then
    raise exception 'authenticated gained a write path into purchase_history, which it did not have before';
  end if;
  if anon_any then
    raise exception 'anon holds a table grant in public after this migration; it held none before';
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- STAGE 8  No views. Nothing this file does changes a number.
--
-- Adding the column and switching the consumers in one migration would take
-- "confirmed revenue" from AED 585,000 to AED 0 on the day it landed, and read
-- on screen as a statement about the dealership. That is the match_quality
-- failure with the roles reversed.
--
-- The census that must run, and be read, BEFORE any consumer filters on this
-- column -- so the loss is a decision rather than a discovery:
--
--   select data_origin, count(*) rows, sum(amount_aed) aed
--   from public.purchase_history group by 1 order by 1;
--   -- today, predicted: UNKNOWN | 1 | 585000
--
-- And when a view is eventually written, the option is INLINED. A following
-- ALTER VIEW ... SET (security_invoker = on) is too late:
-- nexus_require_security_invoker_views() fires at ddl_command_end of the CREATE
-- and rejects it with 42501 before the next statement runs. Its own HINT:
-- "CREATE OR REPLACE VIEW resets reloptions to NULL, so the option must be
-- restated on every replace."
--
--   create or replace view public.v_purchase_provenance
--     with (security_invoker = on) as
--   select p.tenant_id, p.id, p.amount_aed, p.purchase_date,
--          p.data_origin, k.counts_as_real, k.is_test,
--          k.description as origin_meaning,
--          p.test_run_id, r.label as test_run_label
--   from public.purchase_history p
--   join public.data_origin_kind k on k.origin = p.data_origin
--   left join public.data_test_run r on r.test_run_id = p.test_run_id;
--
-- `join`, not `left join`, on the vocabulary: a row whose origin is not in the
-- registry should vanish from a provenance view loudly rather than render with
-- a blank grade. And the view exposes counts_as_real / is_test so that no
-- screen ever has to name an origin literal -- the one hole a foreign key
-- cannot close, because it does not reach JavaScript.
-- ============================================================================
