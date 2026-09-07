-- The RLS-bypassing surface, audited statement by statement, as a standing check.
--
-- WHY A SECOND AUDIT AFTER 20260907150000
--
-- That migration asked "does this function derive the caller's identity at all?"
-- and found one that did not. This one asks the harder question: having derived
-- it, does the function actually USE it on every statement that touches
-- tenant-scoped data? A function can read auth.uid() in its first line and still
-- update another dealership's row in its last.
--
-- Run against production on 7 September 2026 over the 42 SECURITY DEFINER
-- functions `authenticated` can reach: 5 statements in 5 functions touch a
-- tenant-scoped table with no tenant predicate, and ZERO of them are writes.
-- All five were read and all five are correct. They are recorded here as
-- JUSTIFIED, with their reasons, rather than quietly filtered out.
--
--   action_decide, lead_recovery_decide -- `select u.name from public.users
--     where u.id = v_row.decided_by_staff_id`, to name whoever decided first.
--     v_row was already loaded with `and tenant_id = v_ctx.tenant_id`, so the id
--     is one this dealership already owns. If it somehow were not, the name
--     comes back NULL and the message degrades to "another account" -- it cannot
--     disclose a name across a boundary.
--
--   policy_verify_rule, policy_supersede_rule, policy_withdraw_rule --
--     `select * into r from public.policy_rule where id = p_rule_id`. This one
--     CANNOT carry a tenant predicate: you have to load the row before you can
--     tell whose it is, and the three functions then refuse by name --
--     GLOBAL_RULE_NOT_TENANT_VERIFIABLE when tenant_id is null, WRONG_TENANT
--     when it belongs to someone else, JURISDICTION_NOT_YOURS_TO_LEGISLATE when
--     the namespace is not the dealership's. Verified on production: every one
--     of those refusals goes through policy_refuse(), which RAISES rather than
--     returning a column nobody reads, and every UPDATE in the family carries
--     `and tenant_id = ctx.tenant_id` in the statement itself.
--
-- HOW THE EXEMPTIONS ARE PINNED, AND WHY NOT BY NAME
--
-- An allowlist keyed on a function name outlives the reasoning that earned it:
-- someone edits the body next year and the exemption silently covers the new
-- code. So each exemption is pinned to the md5 of the NORMALISED STATEMENT. If a
-- single character of that statement changes, the hash stops matching and the
-- row comes back as REVIEW. The exemption expires the moment the thing it was
-- granted for stops existing.
--
-- WHAT THIS CANNOT SEE, STATED SO NOBODY READS ZERO ROWS AS SAFETY
--
--  * It splits on `;`, so a tenant predicate could live in a different statement
--    from the one that needs it and this would not notice. That is exactly the
--    policy_rule shape above -- correct there, and it would look identical if it
--    were wrong.
--  * It matches the WORD tenant_id, not a correct comparison. `where tenant_id
--    = p_tenant_id` (caller-supplied) passes and is the original sin this whole
--    layer exists to remove.
--  * It says nothing about RLS on the tables themselves, or about SECURITY
--    INVOKER functions, which are governed by RLS anyway.
--
-- It is a tripwire on one specific class of mistake, not a proof of tenancy.

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
  -- The surface that matters: SECURITY DEFINER runs as the owner and bypasses
  -- RLS, and `authenticated` is a signed-in dealership user. Extension-owned
  -- functions are not ours to police.
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
  -- Each exemption is a statement hash, not a function name. Change the
  -- statement and the exemption lapses.
  justified(h, why) as (values
    ('dcc48647954dfa66711e7b0b184b5b83',
     'action_decide names whoever decided first. The staff id came out of a row already loaded with a tenant predicate, and an id from another dealership would yield NULL, not a name.'),
    ('179baae463412f1fbae8f81c6221691a',
     'lead_recovery_decide, same statement and same reason as action_decide.'),
    ('ca6906b3df91be8f514c1df039094b8d',
     'The policy family must load the rule before it can tell whose it is. It then refuses via policy_refuse(), which raises: null tenant is GLOBAL_RULE_NOT_TENANT_VERIFIABLE, another dealership is WRONG_TENANT, and every UPDATE in the family carries its own tenant predicate.')
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
         coalesce(j.why, 'Not yet reviewed. Read the statement: either add the tenant predicate, or add its hash here with the reason it does not need one.')
    from found f
    left join justified j on j.h = md5(f.stmt)
   order by 1, 4 desc, 2;
$function$;

comment on function public.nexus_definer_scoping_audit() is
  'Every statement inside a SECURITY DEFINER function reachable by authenticated '
  'that touches a tenant-scoped table without naming tenant_id. REVIEW rows are '
  'the finding; zero REVIEW rows is healthy. Exemptions are pinned to the md5 of '
  'the normalised statement, so editing an exempted statement revokes its own '
  'exemption. Reads zero-rows-means-safe at your peril: this splits on '';'', so a '
  'predicate in a neighbouring statement is invisible to it, and it matches the '
  'word tenant_id rather than a correct comparison -- `tenant_id = p_tenant_id` '
  'from a caller-supplied argument passes and is the original defect this layer '
  'was built to remove.';

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

  -- The audit must not be vacuous. If it stops finding the five statements it
  -- was written against, either the functions changed or the query broke, and
  -- both deserve a look before this migration claims anything.
  if n_just = 0 then
    raise exception 'the scoping audit found none of the 5 statements it was written against - it is matching nothing, not proving nothing is wrong';
  end if;
  if n_review > 0 then
    raise exception 'the scoping audit found % statement(s) needing review', n_review;
  end if;
  if n_writes > 0 then
    raise exception 'a WRITE to a tenant-scoped table carries no tenant predicate';
  end if;

  if has_function_privilege('authenticated', 'public.nexus_definer_scoping_audit()', 'execute')
     or has_function_privilege('anon', 'public.nexus_definer_scoping_audit()', 'execute') then
    raise exception 'the scoping audit is readable by a dealership user; it is a map of the vendor''s own trust boundary';
  end if;
end $$;
