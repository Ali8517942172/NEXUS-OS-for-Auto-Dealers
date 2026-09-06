-- F2 / F4 -- the onboarding gate was green over the exact failure it exists to catch.
--
-- Measured 6 Sep 2026 on staging, two active dealerships, in one transaction:
--   nexus_scoped_tenant_id() as service_role = NULL
--   nexus_tenancy_readiness()                = 0 BLOCKERs
-- That NULL is deliberate ("silent rather than wrong at 2 tenants") and it is
-- exactly the Customer 360 silence CLAUDE.md predicted. Nothing reported it,
-- because silence has no error and no diff. It does now.
--
-- Two changes, and one thing deliberately NOT changed:
--   1. A new BLOCKER that fires when more than one dealership is active AND the
--      single-dealership scope resolver returns NULL. It names every consumer
--      that goes quiet, and it says what would clear it -- and what would only
--      look like clearing it.
--   2. The last INFO branch could never fire: it counted tenant_id IS NULL on
--      five tables whose tenant_id is NOT NULL on both projects. Replaced with a
--      count over the two tables that can actually hold NULL, correctly labelled
--      as platform scope rather than as orphans.
--   nexus_scoped_tenant_id() itself is NOT widened. Returning some dealership
--   when the caller named none is how one dealership's batch writes another's
--   data. The silence is correct; being silent about the silence was not.

create or replace function public.nexus_active_dealership_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  -- The dealerships a backend batch must iterate. This is the plural answer to
  -- the question nexus_scoped_tenant_id() can only answer in the singular, and
  -- it stays correct at one dealership, at two, and at fifty. The quarantine
  -- tenant is excluded: it holds unattributable traffic, not a customer.
  select t.id
    from public.tenants t
   where t.status = 'active'
     and not t.is_quarantine
   order by t.id;
$fn$;

revoke all on function public.nexus_active_dealership_ids() from public, anon, authenticated;
grant execute on function public.nexus_active_dealership_ids() to service_role;

comment on function public.nexus_active_dealership_ids() is
  'The active dealerships a backend batch must run once per. Use this instead of nexus_scoped_tenant_id() in any nightly or bulk job: the singular resolver returns NULL once more than one dealership is active, and a job built on it stops doing anything without erroring. service_role only.';

create or replace function public.nexus_tenancy_readiness()
returns table(severity text, item text, detail text)
language sql
stable
security definer
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
  census as (select * from public.nexus_quarantine_census()),
  -- The number of dealerships this database is actually serving, and what the
  -- single-dealership scope resolver answers right now. Both read live.
  dealerships as (
    select (select count(*) from public.tenants
             where status = 'active' and not is_quarantine) as n,
           public.nexus_scoped_tenant_id()                  as scoped
  )

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
  -- F2, 6 Sep 2026. The failure this gate exists to catch, and the one it could
  -- not see: nexus_scoped_tenant_id() answers only while exactly one dealership
  -- is active. At two it returns NULL, deliberately -- silent rather than wrong.
  -- Nothing errors. Every consumer that takes its scope from it simply reads
  -- nothing, which on a screen is indistinguishable from a dealership having no
  -- customers. The condition is MEASURED here, not assumed: the branch calls the
  -- resolver, so it clears the moment the resolver can answer and stays red while
  -- it cannot.
  select 'BLOCKER',
         'backend scope resolves to no dealership',
         d.n::text || ' dealerships are active and public.nexus_scoped_tenant_id() returns NULL '
         'for a backend caller -- it answers only while exactly one is active. Nothing raises. '
         'Everything that takes its scope from it goes QUIET, and quiet reads as "this '
         'dealership has no data": the Customer 360 nightly batch (syncs nobody, writes no audit '
         'row, so the first symptom is a dealership asking why its customer list emptied), '
         'v_customer_directory and v_inventory_sales (0 rows to service_role -- measured, with '
         'both dealerships'' own sessions still returning their rows), search_rag_documents(q, '
         'limit) (the 2-argument form -- Ask AI answers "no company documents" while the '
         '3-argument form returns them), nexus_comm_keys_for_lead(email, phone) and '
         'nexus_lead_for_comm_key(key) (identity resolution stops matching, so inbound messages '
         'create duplicate people). WHAT CLEARS THIS: give every one of those consumers an '
         'explicit tenant and drive it once per dealership over '
         'public.nexus_active_dealership_ids() -- the 3-argument search_rag_documents and the '
         '3-argument identity helpers already take one. WHAT ONLY LOOKS LIKE CLEARING IT: '
         'widening nexus_scoped_tenant_id() to return some dealership when the caller named '
         'none. That converts silence into one dealership''s batch reading and writing another '
         'dealership''s data, which is the failure this gate exists to prevent, not a fix for it.'
    from dealerships d
   where d.n > 1 and d.scoped is null

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
  -- This line used to count tenant_id IS NULL on leads, communication_logs,
  -- audit_log, inventory and whatsapp_contacts. All five are NOT NULL on both
  -- projects, so it could never return a row: it was decoration that read like
  -- coverage. It now counts the tables that CAN hold a NULL, and calls those rows
  -- what they are -- platform scope, not orphans. Detecting a NEWLY nullable
  -- table is the job of the three catalogue-driven branches above, which read
  -- pg_attribute rather than a list maintained by hand.
  select 'INFO', 'platform-scope rows (tenant_id IS NULL)', x.tbl || ': ' || x.n::text
    from (
      select 'policy_rule' tbl, count(*) n from policy_rule where tenant_id is null
      union all select 'policy_rule_event', count(*) from policy_rule_event where tenant_id is null
    ) x where x.n > 0;
$function$;

comment on function public.nexus_tenancy_readiness() is
  'The live onboarding gate. Every branch reads the catalogue or the data at call time; each one was fired deliberately on staging on 6 Sep 2026 to prove it can go red. Includes the BLOCKER for nexus_scoped_tenant_id() returning NULL at more than one active dealership -- the silent Customer 360 failure. It still cannot see n8n, so it will never report a workflow that omits tenant_id directly; nexus_quarantine_census(), which it surfaces as a WARN, measures that from the rows those workflows write.';