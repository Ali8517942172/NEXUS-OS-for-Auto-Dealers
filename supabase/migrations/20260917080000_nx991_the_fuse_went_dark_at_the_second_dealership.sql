-- NX991 — The fuse went dark at the second dealership.
--
-- public.nexus_scoped_tenant_id() was built as a fail-closed fuse for a world
-- with exactly one dealership. Its fallback arm carries this guard:
--
--     and (select count(*) from public.tenants
--           where status = 'active' and not is_quarantine) = 1
--
-- so the moment a second dealership exists it returns NULL for every caller
-- that has no signed-in identity — which is every backend caller: service_role,
-- the nightly batches, n8n. Returning NULL was the safe half of the decision.
-- What the callers then did with NULL is the defect: each one answered with an
-- EMPTY RESULT and no error.
--
-- An empty result is indistinguishable from "there is no data". That is how a
-- dealer gets told they have no leads when they have twenty. Measured on
-- staging with 2+ active tenants by a previous agent:
--
--     nexus_comm_keys_for_lead(email, phone)  ->  {}       (silently)
--     search_rag_documents(q, n)              ->  0 rows   (silently)
--     v_inventory_sales                       ->  12 -> 0 rows
--     v_customer_directory                    ->   2 -> 0 rows
--
-- Production looks healthy only because it has exactly one real dealership
-- (alba-cars) plus a quarantine tenant that does not count towards the guard.
-- The day dealership #2 is created, ALBA degrades in the same moment, quietly.
--
-- THE BLAST RADIUS, measured from production pg_proc/pg_views, not guessed.
-- Five objects genuinely CALL the fuse and go blind at two dealerships:
--
--     nexus_comm_keys_for_lead(text, text)     the 2-arg compatibility form
--     nexus_lead_for_comm_key(text)            the 1-arg compatibility form
--     search_rag_documents(text, integer)      the 2-arg compatibility form
--     v_customer_directory                     tenant_id = nexus_scoped_tenant_id()
--     v_inventory_sales                        tenant_id = nexus_scoped_tenant_id()
--
-- Two more call it and are DIAGNOSTICS whose whole job is to report what the
-- fuse currently answers — they stay pointed at it on purpose:
--
--     nexus_tenancy_readiness()
--     nexus_multi_tenant_blockers()
--
-- And three are FALSE ALARMS. They match a name-search of prosrc because a
-- prose comment mentions the fuse; strip the line comments and the call count
-- is zero. They are correct today and this migration does not touch them:
--
--     nexus_active_dealership_ids()    already the plural answer
--     nexus_workflow_catalogue()       uses current_setting('role'), not the fuse
--     nexus_resolve_channel_tenant()   resolves from channel_registry
--
-- WHAT THIS MIGRATION DOES NOT DO.
-- It does not change public.nexus_scoped_tenant_id(). That function was built
-- to fail closed and it still does. It is not replaced with something that
-- guesses a default dealership. What changes is that the five real callers stop
-- ASKING it a question it cannot answer, and stop translating "I cannot tell"
-- into "there is nothing".
--
-- THE NEW RULE, in one sentence: every arm either answers correctly, or raises.
--
-- public.nexus_caller_tenant_scope(purpose) is the one place that decides, and
-- it distinguishes two different kinds of empty:
--
--   * A signed-in person who belongs to no dealership gets '{}'. Their identity
--     is KNOWN and "you are a member of no dealership" is a complete, true
--     answer. No default is ever substituted.
--   * A backend caller has no identity at all. With exactly one active
--     dealership it gets that one — behaviour is bit-for-bit unchanged on
--     production today. With two or more it gets SQLSTATE NX991, loudly, with a
--     hint naming the tenant-taking form to call instead. It never gets '{}',
--     because '{}' is the lie this migration exists to remove.
--
-- A caller who IS a member gets every dealership they belong to and nothing
-- else, which is the same plural shape nexus_channel_status() already uses.
-- No arm below can return another dealership's rows: every read is either
-- delegated to the already-tenant-filtered 3-argument form, or predicated on
-- tenant_id = any(<the caller's own ids>).
--
-- KNOWN CONSEQUENCE, stated rather than hidden: at two dealerships, a backend
-- caller of the 2-arg/1-arg compatibility forms or of these two views will now
-- ERROR instead of returning nothing. n8n-workflows/ask_ai_rag_query_agent.json
-- still calls search_rag_documents(q, match_limit); it must be moved to the
-- 3-argument form, and any Customer-360 batch reading these views must iterate
-- public.nexus_active_dealership_ids(). A loud failure at onboarding time is the
-- point. Silence was the bug.

begin;

-- ───────────────────────────────────────────────────────────────────────────
-- The one place that decides which dealerships a caller may be answered for.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.nexus_caller_tenant_scope(p_purpose text default 'this query')
returns uuid[]
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog','pg_temp'
as $fn$
declare
  v_ids  uuid[];
  v_role text := coalesce(current_setting('role', true), '');
  v_n    integer;
begin
  select coalesce(array_agg(t order by t), '{}'::uuid[])
    into v_ids
    from public.nexus_current_tenant_ids() as t;

  -- Membership answers it, and stays correct at one dealership, at two, at
  -- fifty. This is the plural house pattern nexus_channel_status() uses.
  if cardinality(v_ids) > 0 then
    return v_ids;
  end if;

  -- A signed-in person with no membership. Their identity is known, so
  -- "nothing" is a complete answer rather than a shrug. Never a default.
  if v_role in ('authenticated', 'anon') or auth.uid() is not null then
    return '{}'::uuid[];
  end if;

  -- A backend caller: service_role, postgres, a nightly batch. It carries no
  -- identity, so only the shape of the tenants table can name a dealership.
  select count(*) into v_n
    from public.tenants
   where status = 'active' and not is_quarantine;

  if v_n = 0 then
    -- No dealerships exist. Nothing really is nothing.
    return '{}'::uuid[];
  end if;

  if v_n = 1 then
    return array(select t.id from public.tenants t
                  where t.status = 'active' and not t.is_quarantine);
  end if;

  raise exception using
    errcode = 'NX991',
    message = format(
      '%s cannot be answered: this caller names no dealership and %s are active.',
      coalesce(nullif(btrim(p_purpose), ''), 'this query'), v_n),
    hint = 'Pass the dealership explicitly to the tenant-taking form of this '
        || 'function, or iterate public.nexus_active_dealership_ids(). Returning '
        || 'an empty result here would be indistinguishable from "no data".';
end
$fn$;

comment on function public.nexus_caller_tenant_scope(text) is
  'The dealerships this caller may be answered for, as an array. A member gets '
  'every dealership they belong to and nothing else. A signed-in person with no '
  'membership gets an empty array — known identity, genuinely nothing, never a '
  'default. A backend caller with no identity gets the single active dealership '
  'when exactly one exists, and SQLSTATE NX991 when two or more do, because an '
  'empty result would be indistinguishable from "no data" and that is how a '
  'dealer is told they have no leads when they have twenty. Replaces '
  'nexus_scoped_tenant_id() for every caller that reads rows; the fuse itself is '
  'unchanged and still fails closed.';

revoke all on function public.nexus_caller_tenant_scope(text) from public, anon;
grant execute on function public.nexus_caller_tenant_scope(text) to authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Arm 1 — nexus_comm_keys_for_lead(email, phone)
-- Takes explicit identifiers, so it is plural-scoped. Every key is either a
-- pure string derivation of the caller's own input, or a chat_id read through
-- the 3-arg form under a single tenant_id. No other dealership's row can enter.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.nexus_comm_keys_for_lead(p_email text, p_phone text)
returns text[]
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $fn$
  select coalesce(array_agg(distinct k), '{}'::text[])
    from unnest(public.nexus_caller_tenant_scope('nexus_comm_keys_for_lead(email, phone)')) as t
    cross join lateral unnest(public.nexus_comm_keys_for_lead(p_email, p_phone, t)) as k
   where k is not null and btrim(k) <> '';
$fn$;

comment on function public.nexus_comm_keys_for_lead(text, text) is
  'Every communication key for this lead, across the caller''s own dealerships '
  'and no others. Delegates per dealership to nexus_comm_keys_for_lead(email, '
  'phone, tenant), so each chat_id is read under exactly one tenant_id. A '
  'backend caller at two or more dealerships now raises NX991 instead of '
  'returning {} — before NX991 it returned {} silently, which read as "this '
  'lead has no channels".';

revoke all on function public.nexus_comm_keys_for_lead(text, text) from public, anon;
grant execute on function public.nexus_comm_keys_for_lead(text, text) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Arm 2 — nexus_lead_for_comm_key(key)
-- Genuinely singular: it returns ONE lead id. It resolves inside each of the
-- caller's dealerships and returns an answer only when exactly one dealership
-- claims the key. Two claimants is the same ambiguity the tenant-scoped form
-- already answers with null, and null is this function's own word for "no
-- lead", not a row count that could be mistaken for data.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.nexus_lead_for_comm_key(p_key text)
returns integer
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $fn$
  select case when count(*) = 1 then min(r.hit) end
    from (
      select distinct public.nexus_lead_for_comm_key(p_key, t) as hit
        from unnest(public.nexus_caller_tenant_scope('nexus_lead_for_comm_key(key)')) as t
    ) r
   where r.hit is not null;
$fn$;

comment on function public.nexus_lead_for_comm_key(text) is
  'The lead this communication key belongs to, resolved inside the caller''s own '
  'dealerships. Returns a lead id only when exactly one of them claims the key; '
  'null when none does, and null when two do — the same refusal-to-guess the '
  'tenant-scoped form already applies within a dealership. A backend caller at '
  'two or more dealerships raises NX991 rather than answering null, because '
  'null there would mean "no such lead" when the truth is "I cannot tell which '
  'dealership you mean".';

revoke all on function public.nexus_lead_for_comm_key(text) from public, anon;
grant execute on function public.nexus_lead_for_comm_key(text) to service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Arm 3 — search_rag_documents(query, limit)
-- Deliberately stays SECURITY INVOKER, as the 3-arg form's own comment
-- requires: for an authenticated caller, rag_documents RLS is the boundary and
-- must keep applying. Results from several of the caller's own dealerships are
-- re-ranked together and cut to match_limit, so the 1-dealership result is
-- byte-identical to what this function returned before NX991.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.search_rag_documents(q text, match_limit integer default 6)
returns table (
  id          integer,
  doc_title   text,
  section     text,
  content     text,
  source_file text,
  page_number integer,
  rank        real,
  match_type  text
)
language sql
stable
set search_path to 'public','pg_catalog'
as $fn$
  select s.*
    from unnest(public.nexus_caller_tenant_scope('search_rag_documents(query, limit)')) as t
    cross join lateral public.search_rag_documents(q, match_limit, t) as s
   order by s.rank desc, s.id
   limit match_limit;
$fn$;

comment on function public.search_rag_documents(text, integer) is
  'Knowledge-base search across the caller''s own dealerships, re-ranked and cut '
  'to match_limit. SECURITY INVOKER on purpose: rag_documents RLS still applies '
  'to an authenticated caller, and for service_role the tenant array is the '
  'whole boundary. A backend caller at two or more dealerships raises NX991 '
  'instead of returning zero rows — zero rows read as "the company has no '
  'document about that", which is a wrong answer, not a missing one.';

revoke all on function public.search_rag_documents(text, integer) from public, anon;
grant execute on function public.search_rag_documents(text, integer) to authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Arm 4 — v_customer_directory
-- security_invoker stays true. The only change is = nexus_scoped_tenant_id()
-- becoming = any(nexus_caller_tenant_scope(...)). The GROUP BY already carries
-- tenant_id, so a member of two dealerships sees two separate customer rows for
-- the same email rather than one merged row that belongs to neither.
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.v_customer_directory
with (security_invoker = true) as
select id, name, email, phone, source_records, last_seen_at, tenant_id
  from (
    select lower(x.email) as id,
           (array_agg(x.name  order by x.at desc nulls last)
              filter (where x.name  is not null and x.name  <> ''))[1] as name,
           lower(x.email) as email,
           (array_agg(x.phone order by x.at desc nulls last)
              filter (where x.phone is not null and x.phone <> ''))[1] as phone,
           count(*) as source_records,
           max(x.at) as last_seen_at,
           x.tenant_id
      from (
        select l.email, l.name, l.phone, l.created_at as at, l.tenant_id
          from public.leads l
         where l.email is not null and l.email <> ''
           and l.tenant_id = any (public.nexus_caller_tenant_scope('v_customer_directory'))
        union all
        select p.email, p.customer_name, p.phone, p.created_at, p.tenant_id
          from public.purchase_history p
         where p.email is not null and p.email <> ''
           and p.tenant_id = any (public.nexus_caller_tenant_scope('v_customer_directory'))
      ) x
     group by x.tenant_id, lower(x.email)
  ) _v
 where not exists (
   select 1 from public.tenants _q where _q.is_quarantine and _q.id = _v.tenant_id
 );

comment on view public.v_customer_directory is
  'One customer per email PER DEALERSHIP, from leads union purchase_history, '
  'scoped to the caller''s own dealerships through nexus_caller_tenant_scope(). '
  'Quarantine traffic is excluded. Before NX991 this view read '
  'nexus_scoped_tenant_id() and went to zero rows the moment a second '
  'dealership existed; it now answers correctly for a member and raises NX991 '
  'for a backend caller that cannot say which dealership it means.';

revoke all on public.v_customer_directory from public, anon;
grant select on public.v_customer_directory to authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- Arm 5 — v_inventory_sales
-- ───────────────────────────────────────────────────────────────────────────
create or replace view public.v_inventory_sales
with (security_invoker = true) as
select id, model, status, price_aed, days_in_stock, tenant_id
  from (
    select i.id, i.model, i.status, i.price_aed, i.days_in_stock, i.tenant_id
      from public.inventory i
     where i.tenant_id = any (public.nexus_caller_tenant_scope('v_inventory_sales'))
  ) _v
 where not exists (
   select 1 from public.tenants _q where _q.is_quarantine and _q.id = _v.tenant_id
 );

comment on view public.v_inventory_sales is
  'Sellable inventory scoped to the caller''s own dealerships through '
  'nexus_caller_tenant_scope(), quarantine excluded. Before NX991 this view read '
  'nexus_scoped_tenant_id() and was measured going 12 rows -> 0 rows at two '
  'dealerships, with no error. It now answers correctly for a member and raises '
  'NX991 for a backend caller that cannot say which dealership it means.';

revoke all on public.v_inventory_sales from public, anon;
grant select on public.v_inventory_sales to authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- The blocker report was over-reporting, and under-reporting at the same time.
-- It counted every function whose prosrc merely CONTAINS the string
-- 'nexus_scoped_tenant_id', so three functions that only mention the fuse in a
-- prose comment were listed as callers; and it never looked at views, so the
-- two that really did read the fuse were never listed at all. Strip the line
-- comments, require a call, add pg_views, and exclude the two diagnostics whose
-- job is to report on the fuse.
-- ───────────────────────────────────────────────────────────────────────────
create or replace function public.nexus_fuse_dependent_objects()
returns table (object_kind text, object_name text)
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $fn$
  select 'function'::text, p.proname::text
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname not in ('nexus_scoped_tenant_id',
                           'nexus_tenancy_readiness',
                           'nexus_multi_tenant_blockers')
     and regexp_replace(p.prosrc, '--[^' || chr(10) || ']*', '', 'g')
         ~ 'nexus_scoped_tenant_id[[:space:]]*\('
  union all
  select 'view'::text, v.viewname::text
    from pg_views v
   where v.schemaname = 'public'
     and regexp_replace(v.definition, '--[^' || chr(10) || ']*', '', 'g')
         ~ 'nexus_scoped_tenant_id[[:space:]]*\('
   order by 1, 2;
$fn$;

comment on function public.nexus_fuse_dependent_objects() is
  'Every function and view that genuinely CALLS nexus_scoped_tenant_id(), with '
  'line comments stripped first so a function that merely names the fuse in '
  'prose is not counted, and with views included so the ones that really read '
  'it cannot hide. Excludes nexus_tenancy_readiness() and '
  'nexus_multi_tenant_blockers(), the two diagnostics whose job IS to report '
  'what the fuse currently answers. After NX991 this should return zero rows; '
  'anything it returns is a caller that will go silent at dealership #2.';

-- `authenticated` is listed explicitly: on this platform a default privilege
-- hands EXECUTE to authenticated the moment a NEW function is created, and
-- revoking only public and anon leaves that grant standing with no
-- grant-shaped diff to review. Measured on staging before this line was added.
revoke all on function public.nexus_fuse_dependent_objects() from public, anon, authenticated;
grant execute on function public.nexus_fuse_dependent_objects() to service_role;

commit;
