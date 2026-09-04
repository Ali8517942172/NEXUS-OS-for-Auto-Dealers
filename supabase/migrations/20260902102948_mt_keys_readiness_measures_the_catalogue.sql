-- ─────────────────────────────────────────────────────────────────────────────
-- nexus_tenancy_readiness() stops asserting a hardcoded list of broken keys.
--
-- BUSINESS RULE
--   This function is the live gate that decides whether a second dealership may
--   be onboarded. CLAUDE.md instructs the reader to trust it over the file. A
--   gate that recites a fixed list of findings is a gate that lies the moment
--   the findings are fixed — and it lied within minutes of the previous wave,
--   because it named users.email, inventory.id, whatsapp_contacts.chat_id and
--   processed_messages.message_id as globally unique after they had ceased to
--   be.
--
--   The split this version enforces: WHICH columns are natural business keys is
--   a judgement, so it is declared explicitly below and must be maintained by
--   hand. WHETHER each one is still globally unique is a fact, so it is read
--   from pg_index at call time and can never go stale.
--
--   A key is reported as still-global when a UNIQUE index exists whose entire
--   key is that one column. The severity is BLOCKER when a deployed workflow
--   pins that column as its ON CONFLICT target — because that pin is what
--   prevents the index from simply being swapped — and WARN otherwise.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.nexus_tenancy_readiness()
returns table(severity text, item text, detail text)
language sql stable security definer set search_path to 'public' as $fn$
  with nat(tbl, col, pinned_by) as (
    -- The natural business keys. A key here identifies something in the world
    -- outside one dealership, so it must be unique per tenant, never globally.
    -- `pinned_by` names the deployed workflow that hardcodes
    -- `?on_conflict=<col>`; Postgres cannot infer a UNIQUE(tenant_id, col)
    -- index from `ON CONFLICT (col)`, so those cannot be swapped until the
    -- workflow changes. NULL means nothing pins it.
    values
      ('leads','email',
       'Master Router -> "Persist Lead (deterministic)" posts ?on_conflict=email. '
       'Change it to ?on_conflict=tenant_id,email; the index it needs '
       '(leads_tenant_email_key) already exists.'),
      ('customer_360_profiles','customer_id',
       'Customer 360 -> "Supabase - Upsert Profile" posts ?on_conflict=customer_id. '
       'Change it to ?on_conflict=tenant_id,customer_id; '
       'customer_360_profiles_tenant_customer_id_key already exists.'),
      ('deals_embeddings','deal_id',
       'Closed-Won Sync -> "Supabase (Postgres) - Upsert Vector" posts '
       '?on_conflict=deal_id. Change it to ?on_conflict=tenant_id,deal_id; '
       'deals_embeddings_tenant_deal_id_key already exists.'),
      ('users','email', null),
      ('inventory','id', null),
      ('whatsapp_contacts','chat_id', null),
      ('processed_messages','message_id', null),
      ('purchase_history','deal_id', null)
  ),
  -- A single-column UNIQUE index on a natural key = still globally unique.
  still_global as (
    select n.tbl, n.col, n.pinned_by, i.relname as idx
    from nat n
    join pg_class c  on c.relname = n.tbl and c.relnamespace = 'public'::regnamespace
    join pg_index ix on ix.indrelid = c.oid and ix.indisunique
    join pg_class i  on i.oid = ix.indexrelid
    where ix.indnkeyatts = 1
      and (select a.attname from pg_attribute a
            where a.attrelid = c.oid and a.attnum = ix.indkey[0]) = n.col
  ),
  -- A UNIQUE index led by tenant_id = correctly scoped.
  scoped as (
    select n.tbl, n.col, i.relname as idx
    from nat n
    join pg_class c  on c.relname = n.tbl and c.relnamespace = 'public'::regnamespace
    join pg_index ix on ix.indrelid = c.oid and ix.indisunique
    join pg_class i  on i.oid = ix.indexrelid
    where ix.indnkeyatts = 2
      and (select a.attname from pg_attribute a
            where a.attrelid = c.oid and a.attnum = ix.indkey[0]) = 'tenant_id'
      and (select a.attname from pg_attribute a
            where a.attrelid = c.oid and a.attnum = ix.indkey[1]) = n.col
  )

  select 'BLOCKER', 'n8n writes are not tenant-aware',
         'Every n8n workflow writes as service_role, which has no auth.uid(). '
         'Those rows are attributed by the tenants.is_unattributed_default flag, '
         'currently held by: ' ||
         coalesce((select name from tenants where is_unattributed_default), '(nobody)') ||
         '. Until n8n sends tenant_id explicitly, a second dealership''s inbound '
         'traffic would be filed under that tenant. This is the remaining '
         'onboarding blocker and it is not fixable in the database.'
  where exists (select 1 from tenants where is_unattributed_default)

  union all
  -- Still globally unique AND pinned by a workflow: cannot be fixed here alone.
  select 'BLOCKER',
         sg.tbl || '.' || sg.col || ' is globally unique',
         'Index ' || sg.idx || ' is UNIQUE(' || sg.col || ') across all tenants, so two '
         'dealerships sharing this value collide — and where the write is an upsert, '
         'one dealership UPDATES the other''s row. ' || sg.pinned_by
    from still_global sg where sg.pinned_by is not null

  union all
  -- Still globally unique, nothing pinning it: a plain database fix.
  select 'WARN',
         sg.tbl || '.' || sg.col || ' is globally unique',
         'Index ' || sg.idx || ' is UNIQUE(' || sg.col || ') across all tenants. No '
         'deployed workflow pins it as an ON CONFLICT target, so it can be swapped '
         'for UNIQUE(tenant_id, ' || sg.col || ') without coordinating a workflow change.'
    from still_global sg where sg.pinned_by is null

  union all
  select 'INFO', 'natural keys correctly scoped per dealership',
         string_agg(s.tbl || '.' || s.col, ', ' order by s.tbl, s.col)
    from scoped s having count(*) > 0

  union all
  select 'WARN', 'tenant_id is still nullable on some tenant-scoped tables',
         (select count(*)::text from information_schema.columns
           where table_schema='public' and column_name='tenant_id' and is_nullable='YES') ||
         ' of ' ||
         (select count(*)::text from information_schema.columns
           where table_schema='public' and column_name='tenant_id') ||
         ' tenant-scoped tables carry a NULLABLE tenant_id defaulting to '
         'nexus_default_tenant_id(). A row that lands with NULL is invisible to every '
         'signed-in user, and on a table whose uniqueness is UNIQUE(tenant_id, key) a '
         'NULL also silently defeats that uniqueness, because NULLs do not collide.'
  where exists (select 1 from information_schema.columns
                 where table_schema='public' and column_name='tenant_id' and is_nullable='YES')

  union all
  select 'INFO', 'rows with no tenant right now', x.tbl || ': ' || x.n::text
    from (
      select 'leads' tbl, count(*) n from leads where tenant_id is null
      union all select 'communication_logs', count(*) from communication_logs where tenant_id is null
      union all select 'audit_log', count(*) from audit_log where tenant_id is null
      union all select 'inventory', count(*) from inventory where tenant_id is null
      union all select 'whatsapp_contacts', count(*) from whatsapp_contacts where tenant_id is null
    ) x where x.n > 0;
$fn$;
