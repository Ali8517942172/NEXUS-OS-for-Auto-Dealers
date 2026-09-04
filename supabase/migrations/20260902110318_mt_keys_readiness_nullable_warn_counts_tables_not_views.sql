-- ─────────────────────────────────────────────────────────────────────────────
-- nexus_tenancy_readiness(): the nullable-tenant_id WARN counted VIEWS as tables.
--
-- THE DEFECT
--   The WARN read information_schema.columns filtered only on
--   table_schema='public' and column_name='tenant_id'. information_schema.columns
--   lists view columns as well as table columns, and a view column is ALWAYS
--   reported is_nullable='YES' — there is no NOT NULL on a view.
--
--   So the moment a view was given a tenant_id column, the gate counted it as a
--   tenant-scoped TABLE with a nullable tenant_id. Adding tenant_id to
--   v_inventory_sales and v_customer_directory earlier in this same pass moved
--   the reading from a true "1 of 16" to a false "3 of 18" — the number got
--   worse precisely because the leak got fixed.
--
--   This matters more than an off-by-two. CLAUDE.md instructs every future
--   reader to trust this function over the file, and the function had begun
--   reporting correctly-scoped views as unpinned tables. A gate that
--   miscounts in the direction of alarm still teaches people to discount it.
--
-- THE FIX
--   Count base tables only (pg_class.relkind = 'r'), read from pg_attribute
--   rather than information_schema so the NOT NULL is read as a fact rather
--   than through a view that flattens it, and NAME the offending tables in the
--   detail so the reading can be checked against the catalogue by hand.
--
-- Everything else in this function is reproduced verbatim from
-- pg_get_functiondef as captured immediately before this migration.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nexus_tenancy_readiness()
 RETURNS TABLE(severity text, item text, detail text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with nat(tbl, col, pinned_by) as (
    -- WHICH columns are natural business keys is a judgement, declared here and
    -- maintained by hand. WHETHER each is still globally unique is a fact, read
    -- from pg_index at call time, so this gate cannot go stale.
    -- `pinned_by` names the deployed workflow that hardcodes `?on_conflict=<col>`;
    -- Postgres cannot infer a UNIQUE(tenant_id, col) index from ON CONFLICT (col),
    -- so those keys cannot be swapped until the workflow changes.
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
  ),
  -- Base tables only. relkind='r' excludes views, whose columns
  -- information_schema always reports as nullable.
  tcols as (
    select c.relname as tbl, a.attnotnull
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
     where c.relnamespace = 'public'::regnamespace
       and c.relkind = 'r'
       and a.attname = 'tenant_id'
       and a.attnum > 0
       and not a.attisdropped
  )

  select 'BLOCKER', 'n8n writes are not tenant-aware',
         'Every n8n workflow writes as service_role, which has no auth.uid(). '
         'Those rows are attributed by the tenants.is_unattributed_default flag, '
         'currently held by: ' ||
         coalesce((select name from tenants where is_unattributed_default), '(nobody)') ||
         '. Until n8n sends tenant_id explicitly, a second dealership''s inbound '
         'traffic would be filed under that tenant. This is not fixable in the database.'
  where exists (select 1 from tenants where is_unattributed_default)

  union all
  select 'BLOCKER',
         sg.tbl || '.' || sg.col || ' is globally unique',
         'Index ' || sg.idx || ' is UNIQUE(' || sg.col || ') across all tenants, so two '
         'dealerships sharing this value collide — and where the write is an upsert, '
         'one dealership UPDATES the other''s row. ' || sg.pinned_by
    from still_global sg where sg.pinned_by is not null

  union all
  select 'WARN',
         sg.tbl || '.' || sg.col || ' is globally unique',
         'Index ' || sg.idx || ' is UNIQUE(' || sg.col || ') across all tenants. No '
         'deployed workflow pins it as an ON CONFLICT target, so it can be swapped '
         'for UNIQUE(tenant_id, ' || sg.col || ') without coordinating a workflow change.'
    from still_global sg where sg.pinned_by is null

  union all
  -- Scoped means scoped AND nothing global left standing on the same column.
  select 'INFO', 'natural keys correctly scoped per dealership',
         string_agg(s.tbl || '.' || s.col, ', ' order by s.tbl, s.col)
    from scoped s
   where not exists (select 1 from still_global g where g.tbl = s.tbl and g.col = s.col)
  having count(*) > 0

  union all
  select 'WARN', 'tenant_id is still nullable on some tenant-scoped tables',
         (select count(*)::text from tcols where not attnotnull) ||
         ' of ' ||
         (select count(*)::text from tcols) ||
         ' tenant-scoped tables carry a NULLABLE tenant_id defaulting to '
         'nexus_default_tenant_id(), namely: ' ||
         (select string_agg(tbl, ', ' order by tbl) from tcols where not attnotnull) ||
         '. A row that lands with NULL is invisible to every signed-in user, and on a '
         'table whose uniqueness is UNIQUE(tenant_id, key) a NULL also silently defeats '
         'that uniqueness, because NULLs do not collide. Counted over base tables only — '
         'a view''s columns are always reported nullable and are not evidence of anything.'
  where exists (select 1 from tcols where not attnotnull)

  union all
  select 'INFO', 'rows with no tenant right now', x.tbl || ': ' || x.n::text
    from (
      select 'leads' tbl, count(*) n from leads where tenant_id is null
      union all select 'communication_logs', count(*) from communication_logs where tenant_id is null
      union all select 'audit_log', count(*) from audit_log where tenant_id is null
      union all select 'inventory', count(*) from inventory where tenant_id is null
      union all select 'whatsapp_contacts', count(*) from whatsapp_contacts where tenant_id is null
    ) x where x.n > 0;
$function$;