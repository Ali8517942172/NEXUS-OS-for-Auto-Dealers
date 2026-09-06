-- ============================================================================
-- anon_tables_revoke_base_table_and_sequence_grants
--
-- BUSINESS RULE: A dealership's customer, lead, finance, KYC and audit records
-- must never be reachable by an unauthenticated caller. NEXUS is sold on the
-- promise that one dealership's data cannot be read or altered by anyone who
-- has not signed in; the anon publishable key ships in the dashboard's browser
-- bundle and is therefore public knowledge. Anonymous access to these tables is
-- not a feature of the product and has no reader.
--
-- WHY THIS MIGRATION EXISTS: Supabase default privileges granted `anon` the
-- FULL privilege set (arwdDxtm - SELECT *and* INSERT/UPDATE/DELETE) on all 16
-- tenant-owned base tables in `public`. Nobody wrote those grants; they arrived
-- with the default ACL, so no migration diff ever showed them. Measured
-- 2 Sep 2026 inside aborted transactions: as `anon`, SELECT returned rows=0,
-- and UPDATE and DELETE *parsed and executed* against every one of the 16
-- tables, affecting 0 rows only because the RESTRICTIVE `_deny_anon` policy
-- filtered every row. That is one lock (RLS), not two. INSERT was stopped only
-- incidentally, by a missing EXECUTE grant on the `nexus_default_tenant_id()`
-- column-default function; supplying `tenant_id` explicitly bypassed that lock
-- and reached RLS. None of those verbs was stopped by a privilege check.
--
-- WHAT THIS DOES: adds the second lock. Revokes every privilege from `anon`
-- AND from PUBLIC (a PUBLIC entry is a grant `anon` reaches through, and
-- revoking only one of the two is what left an object open on the previous
-- pass) on every table, view and sequence in `public`. The RESTRICTIVE
-- deny-anon policies are NOT touched - this is a second lock, not a
-- replacement for the first.
--
-- WHO READS THESE (evidence, edge logs, request role at
-- `request.sb.jwt.authorization.payload.role`): the dashboard reads as
-- `authenticated` (user agent Chrome/150); n8n reads and writes as
-- `service_role` (user agent `n8n`). EVERY request ever logged with role
-- `anon` carries user agent `curl/8.5.0` - they are a prior audit lane's own
-- probes, not application traffic. No table has an anonymous reader.
--
-- `authenticated` and `service_role` grants are deliberately left intact.
-- `authenticated` is not a member of `anon`, so this revoke cannot reach it.
-- ============================================================================

DO $$
DECLARE r record; n_rel int := 0; n_seq int := 0;
BEGIN
  -- Tables, partitioned tables, views, materialised views: both locks.
  FOR r IN
    SELECT c.relname, c.relkind
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, PUBLIC', r.relname);
    n_rel := n_rel + 1;
  END LOOP;

  -- Sequences were never covered by the earlier backstop. `anon` held rwU:
  -- USAGE/SELECT/UPDATE means nextval() and, worse, setval() - an anonymous
  -- caller could have burned or rewound the id counter behind `leads`,
  -- `competitors` and `rag_documents`, causing primary-key collisions on the
  -- dealership's next real insert. `anon` cannot insert, so it needs none of it.
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public' AND c.relkind = 'S'
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon, PUBLIC', r.relname);
    n_seq := n_seq + 1;
  END LOOP;

  RAISE NOTICE 'revoked anon+PUBLIC on % relations and % sequences', n_rel, n_seq;
END $$;

-- Close the birth defect for sequences created by `postgres` (the role
-- migrations run as). Tables and functions were already covered on the previous
-- pass; sequences were not, so a new sequence was still born with anon=rwU.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;

-- Re-assert the table and function backstops idempotently, and cover PUBLIC as
-- well as `anon` this time.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon;
