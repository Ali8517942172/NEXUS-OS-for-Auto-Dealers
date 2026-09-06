-- nexus_tenancy_readiness() emitted one unconditional BLOCKER whenever ANY tenant
-- held tenants.is_unattributed_default, and named that tenant. With the flag now
-- held by a quarantine tenant on purpose, that line would report the designed
-- behaviour as a defect -- and CLAUDE.md records that this gate's BLOCKER "fires
-- whenever any tenant holds the default flag", i.e. it could never clear. A gate
-- that cannot clear is a gate nobody reads.
--
-- Replaced with four branches that measure what is actually true:
--   BLOCKER  the flag is held by something that is not a quarantine tenant
--   BLOCKER  nothing holds the flag at all -- fail-closed, but 23502 destroys
--            the inbound payload rather than retaining it
--   INFO     the flag is held by the quarantine tenant, with the two independent
--            locks that make it unreachable stated and CHECKED, not asserted
--   WARN     rows are actually sitting in quarantine, per table, with counts
--
-- Nothing else in the function changes.

create or replace function public.nexus_tenancy_readiness()
 returns TABLE(severity text, item text, detail text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
    select c.oid as reloid, c.relname as tbl, a.attnotnull,
           pg_get_expr(d.adbin, d.adrelid) as col_default
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
     where c.relnamespace = 'public'::regnamespace
       and c.relkind = 'r'
       and a.attname = 'tenant_id'
       and a.attnum > 0
       and not a.attisdropped
  ),
  -- Every claim below about a nullable tenant_id is read from the catalogue at
  -- call time, because the hand-written version of this text asserted the
  -- opposite of the catalogue on all three counts.
  nullable_facts as (
    select t.tbl,
           t.col_default,
           -- Does an RLS SELECT policy deliberately admit NULL for signed-in users?
           -- If it does, a NULL row means "platform-wide", not "orphaned".
           exists (
             select 1 from pg_policy p
              where p.polrelid = t.reloid
                and p.polpermissive
                and p.polcmd in ('r','*')
                and (p.polroles = '{0}'::oid[]
                     or 'authenticated'::regrole::oid = any(p.polroles))
                and pg_get_expr(p.polqual, p.polrelid) like '%tenant_id IS NULL%'
           ) as null_rows_visible,
           -- Uniqueness that actually covers the NULL-tenant rows, if any.
           (select string_agg(i.relname, ', ' order by i.relname)
              from pg_index ix
              join pg_class i on i.oid = ix.indexrelid
             where ix.indrelid = t.reloid
               and ix.indisunique
               and pg_get_expr(ix.indpred, ix.indrelid) = '(tenant_id IS NULL)'
           ) as null_uq
      from tcols t
     where not t.attnotnull
  ),
  census as (select * from public.nexus_quarantine_census())

  -- The flag is held by something that is not a quarantine tenant. A CHECK
  -- constraint should make this impossible; if it fires, the constraint is gone.
  select 'BLOCKER', 'the unattributed default points at a real dealership',
         'public.tenants.is_unattributed_default is held by ' || t.name || ' (slug ' ||
         t.slug || ', status ' || t.status || '), which is not a quarantine tenant. '
         'Every backend write that omits tenant_id is filed there, so a second '
         'dealership''s unresolvable traffic silently becomes that dealership''s data, '
         'conversations and attributed revenue. The constraint '
         'tenants_unattributed_default_must_be_quarantine is supposed to make this '
         'state unreachable -- check whether it still exists.'
    from tenants t where t.is_unattributed_default and not t.is_quarantine

  union all
  -- Nothing holds the flag. Fail-closed, and that is not automatically the safe
  -- side: it destroys the payload instead of retaining it.
  select 'BLOCKER', 'no tenant holds the unattributed default',
         'Nothing carries tenants.is_unattributed_default, so nexus_default_tenant_id() '
         'returns NULL and every backend write that omits tenant_id fails 23502 against '
         'a NOT NULL column. That is fail-closed, but it DESTROYS the payload: a real '
         'inbound customer message is refused and gone, with only an error to show for '
         'it. Restore the quarantine tenant (status=''quarantine'', is_quarantine=true, '
         'is_unattributed_default=true).'
   where not exists (select 1 from tenants where is_unattributed_default)

  union all
  -- The designed state. The two locks are CHECKED here, not asserted.
  select 'INFO', 'unresolvable traffic is quarantined, never filed under a dealership',
         'tenants.is_unattributed_default is held by ' || t.name || ' (slug ' || t.slug ||
         ', status ' || t.status || '). Two independent locks keep it unreadable by any '
         'dealership session, and both are measured right now: (1) membership rows on '
         'the quarantine tenant = ' ||
         (select count(*)::text from tenant_members m where m.tenant_id = t.id) ||
         ' (must be 0); (2) nexus_current_tenant_ids() requires tenants.status = '
         '''active'' and this tenant''s status is ' || t.status ||
         '. Every public view carrying tenant_id also excludes it in its own definition, '
         'so the exclusion does not depend on RLS. Read what is held with '
         'select * from public.nexus_quarantine_census() as service_role.'
    from tenants t where t.is_unattributed_default and t.is_quarantine

  union all
  -- Quarantine is retention, not a bin. A non-empty census names a live writer
  -- that is still omitting tenant_id.
  select 'WARN', 'rows are sitting in the quarantine tenant',
         'A live write path is still omitting tenant_id. These rows are retained and '
         'findable, and no dealership can read them, but they are nobody''s data until '
         'somebody re-attributes them: ' ||
         (select string_agg(c.tbl || ' ' || c.rows::text, ', ' order by c.rows desc, c.tbl)
            from census c) ||
         '. Find the writer, fix it, then UPDATE these rows to the dealership they '
         'belong to. Do not delete them without reading them.'
   where exists (select 1 from census)

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
  -- Case 1: nullable AND defaulted. A write that omits tenant_id is filed under
  -- whoever holds is_unattributed_default -- the quarantine tenant now, so the
  -- row is retained but belongs to nobody and appears in no dealership's numbers.
  select 'BLOCKER',
         'tenant_id is nullable AND defaulted on ' || nf.tbl,
         'public.' || nf.tbl || '.tenant_id is NULLABLE and carries the column default '
         || nf.col_default || '. A write that omits tenant_id is filed under whichever '
         'tenant holds tenants.is_unattributed_default -- the quarantine tenant -- with '
         'no error raised and no grant-shaped or policy-shaped diff to review. The row '
         'is retained and no dealership can read it, but it is nobody''s data. Either '
         'make the column NOT NULL or drop the default and require the caller to be '
         'explicit.'
    from nullable_facts nf
   where nf.col_default is not null

  union all
  -- Case 2: nullable, NO default, and RLS deliberately admits NULL for signed-in
  -- users. NULL here means platform-wide, and such a row is READABLE BY EVERY
  -- dealership on purpose. Not a defect; still a thing to check before onboarding
  -- a second dealership, because nothing stops a tenant-specific row being written
  -- with a NULL and disclosed to all of them.
  select 'WARN',
         'tenant_id is nullable by design on ' || nf.tbl || ' — NULL means platform-wide',
         'public.' || nf.tbl || '.tenant_id is NULLABLE with NO column default. Its RLS '
         'SELECT policy matches (tenant_id IS NULL), so a NULL row is deliberately '
         'READABLE BY EVERY DEALERSHIP — it is platform scope, not an orphan, and it is '
         'not invisible. Uniqueness over the NULL-tenant rows is carried by: ' ||
         coalesce(nf.null_uq,
                  'NO partial unique index WHERE tenant_id IS NULL — duplicate '
                  'platform-wide rows are possible on this table') ||
         '. What to check before a second dealership: nothing in the database stops a row '
         'that belongs to ONE dealership being written with a NULL tenant_id, and such a '
         'row is disclosed to all of them. Do not "fix" this by making the column NOT NULL '
         'without first re-homing the existing NULL rows — that would delete platform scope.'
    from nullable_facts nf
   where nf.col_default is null and nf.null_rows_visible

  union all
  -- Case 3: nullable, no default, and no policy admits NULL. A row written with
  -- NULL belongs to no dealership and is readable by none.
  select 'BLOCKER',
         'tenant_id is nullable and orphaning on ' || nf.tbl,
         'public.' || nf.tbl || '.tenant_id is NULLABLE with no column default and no '
         'permissive RLS SELECT policy admitting NULL, so a row written with NULL belongs '
         'to no dealership and is readable by none. Make it NOT NULL, or declare what NULL '
         'means and admit it in the policy.'
    from nullable_facts nf
   where nf.col_default is null and not nf.null_rows_visible

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