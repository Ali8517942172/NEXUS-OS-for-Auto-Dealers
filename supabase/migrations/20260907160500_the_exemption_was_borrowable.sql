-- The audit written twenty minutes ago had a borrowable exemption.
--
-- 20260907160000 keys each exemption on the md5 of the normalised statement, so
-- that editing an exempted statement revokes its own exemption. That property is
-- real and it is kept. What it does NOT do is tie the exemption to the function
-- that earned it: the key is the hash alone, so ANY SECURITY DEFINER function
-- containing a byte-identical statement inherits an exemption it was never
-- reviewed for.
--
-- Tested on staging by planting a second function holding the same
-- `select * into r from public.policy_rule where id = p_rule_id`. It came back
-- REVIEW -- but only because the `;`-split chunk picked up a leading `begin`
-- from its surroundings and the hash therefore differed. It was refused by
-- accident, not by design, and an accident is not a control.
--
-- The key becomes (function_name, statement_md5). Both halves have to match, so:
--   * editing the statement lapses the exemption, as before;
--   * a different function holding the same statement does not inherit it;
--   * renaming the function lapses it too, which is correct -- a rename is a
--     good moment to re-read what the thing does.
--
-- Nothing else changes, and the same assertions run: the audit must still find
-- the five statements it was written against (or it is matching nothing), must
-- report zero REVIEW rows, must report zero unscoped writes, and must not be
-- readable by a dealership user.

create or replace function public.nexus_definer_scoping_audit()
returns table (
  verdict       text,
  function_name text,
  table_touched text,
  is_write      boolean,
  statement_md5 text,
  statement     text,
  justification text
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  with tenant_tables as (
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id'
                         and a.attnum > 0 and not a.attisdropped
     where n.nspname = 'public' and c.relkind in ('r','p')
  ),
  fns as (
    select p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and has_function_privilege('authenticated', p.oid, 'execute')
  ),
  stmts as (
    select f.proname, lower(regexp_replace(trim(s), '\s+', ' ', 'g')) as stmt
      from fns f, regexp_split_to_table(f.def, ';') s
     where trim(s) <> ''
  ),
  -- (function, statement hash). Both halves, so an exemption can be neither
  -- edited into something else nor borrowed by a function that never earned it.
  justified(fn, h, why) as (values
    ('action_decide', 'dcc48647954dfa66711e7b0b184b5b83',
     'Names whoever decided first. The staff id came out of a row already loaded with a tenant predicate, and an id from another dealership would yield NULL, not a name.'),
    ('lead_recovery_decide', '179baae463412f1fbae8f81c6221691a',
     'Same statement and same reason as action_decide.'),
    ('policy_verify_rule', 'ca6906b3df91be8f514c1df039094b8d',
     'Must load the rule before it can tell whose it is, then refuses via policy_refuse(), which raises: null tenant is GLOBAL_RULE_NOT_TENANT_VERIFIABLE, another dealership is WRONG_TENANT. Its UPDATE carries its own tenant predicate.'),
    ('policy_supersede_rule', 'ca6906b3df91be8f514c1df039094b8d',
     'Same load-then-refuse shape as policy_verify_rule, plus JURISDICTION_NOT_YOURS_TO_LEGISLATE. Its UPDATE carries its own tenant predicate.'),
    ('policy_withdraw_rule', 'ca6906b3df91be8f514c1df039094b8d',
     'Same load-then-refuse shape, using IS DISTINCT FROM so a null tenant is caught as well. Its UPDATE carries its own tenant predicate.')
  ),
  found as (
    select st.proname, tt.relname, st.stmt,
           st.stmt ~ ('\m(insert into|update|delete from)\s+(public\.)?' || tt.relname || '\M') as is_write
      from stmts st
      join tenant_tables tt
        on st.stmt ~ ('\m(from|join|into|update|delete from)\s+(public\.)?' || tt.relname || '\M')
     where st.stmt !~ '\mtenant_id\M'
  )
  select distinct
         case when j.h is null then 'REVIEW' else 'JUSTIFIED' end,
         f.proname, f.relname, f.is_write, md5(f.stmt),
         left(f.stmt, 240),
         coalesce(j.why, 'Not yet reviewed. Read the statement: either add the tenant predicate, or add (function, hash) here with the reason it does not need one.')
    from found f
    left join justified j on j.h = md5(f.stmt) and j.fn = f.proname
   order by 1, 4 desc, 2;
$function$;

comment on function public.nexus_definer_scoping_audit() is
  'Every statement inside a SECURITY DEFINER function reachable by authenticated '
  'that touches a tenant-scoped table without naming tenant_id. REVIEW rows are '
  'the finding; zero REVIEW rows is healthy. Exemptions are keyed on (function '
  'name, md5 of the normalised statement): editing the statement lapses the '
  'exemption, and another function holding the same statement cannot inherit it. '
  'Reads zero-rows-means-safe at your peril: this splits on '';'', so a predicate '
  'in a neighbouring statement is invisible to it, and it matches the word '
  'tenant_id rather than a correct comparison -- `tenant_id = p_tenant_id` from a '
  'caller-supplied argument passes and is the original defect this layer was '
  'built to remove.';

revoke all on function public.nexus_definer_scoping_audit() from public, anon, authenticated;
grant execute on function public.nexus_definer_scoping_audit() to service_role;

do $$
declare n_review int; n_just int; n_writes int;
begin
  select count(*) filter (where verdict = 'REVIEW'),
         count(*) filter (where verdict = 'JUSTIFIED'),
         count(*) filter (where is_write)
    into n_review, n_just, n_writes
    from public.nexus_definer_scoping_audit();
  if n_just <> 5 then
    raise exception 'expected exactly 5 justified statements, found % - the bodies changed or the query broke', n_just;
  end if;
  if n_review > 0 then
    raise exception 'the scoping audit found % statement(s) needing review', n_review;
  end if;
  if n_writes > 0 then
    raise exception 'a WRITE to a tenant-scoped table carries no tenant predicate';
  end if;
  if has_function_privilege('authenticated', 'public.nexus_definer_scoping_audit()', 'execute')
     or has_function_privilege('anon', 'public.nexus_definer_scoping_audit()', 'execute') then
    raise exception 'the scoping audit is readable by a dealership user';
  end if;
end $$;
