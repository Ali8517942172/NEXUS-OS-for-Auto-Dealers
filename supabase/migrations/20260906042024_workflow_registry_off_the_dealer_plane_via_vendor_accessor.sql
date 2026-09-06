-- workflow_registry leaves the dealer data plane.
--
-- WHAT THIS CHANGES, AND WHY IT IS NOT A tenant_id.
-- These 18 rows are the VENDOR's register of the automations NEXUS runs. They
-- have no tenant dimension and no measurement anywhere in this database maps an
-- automation to a dealership. Bolting a tenant_id on would mean inventing that
-- mapping - 18 rows of it today, 18xN later - and three of the registered
-- workflows are NEXUS's own public pages, which serve no dealership at all. A
-- nullable-meaning-platform tenant_id is the same fabrication with a NULL in it:
-- every row would be NULL forever, so `tenant_id is null or tenant_id in (...)`
-- would filter nothing while reading like a scope. Splitting the table into a
-- vendor half and a dealer-safe half only relocates the problem, because the
-- dealer-safe half still needs a USING (true) policy for `authenticated`.
--
-- So the table goes off the dealer plane entirely - no table grant, no column
-- grant, no `authenticated` policy - and the one thing CONTROL-PLANE.md Part 4
-- says a dealership IS entitled to (whether its automations are running) is
-- served through a vendor-owned accessor that names exactly what leaves.
--
-- Before: `authenticated` held SELECT on seven of ten columns by column grant,
-- and workflow_registry_read was `SELECT USING (true)`, so `select count(*)`
-- read no column, executed, and returned the size of the register (18 on
-- production; staging's copy of this table is empty and the grant verdicts are
-- the witness there).
-- After: every read of this table by `authenticated` is 42501, and the accessor
-- is the only door. It returns nothing at all to a signed-in caller who is a
-- member of no dealership - which is what the bare `set local role
-- authenticated` probe in the 5 Sep evidence was, and it read all 18 rows.
--
-- What this does NOT close, stated so nobody discovers it and calls it a
-- regression: a dealership session that IS a member still sees 18 rows through
-- v_workflow_health, and can count them. That is deliberate - the view is the
-- sanctioned projection - and the accessor is now the single place a
-- per-dealership filter goes if a fact ever exists to filter on.

create or replace function public.nexus_workflow_catalogue()
returns table (
  name             text,
  audit_name       text,
  audit_aliases    text[],
  category         text,
  description      text,
  is_active        boolean,
  writes_audit_log boolean
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $fn$
  -- The dealer-safe projection of the vendor's register, as an explicit
  -- allow-list. `id`, `trigger_type` and `trigger_detail` are absent by
  -- construction rather than by whichever column grant nobody revoked: the n8n
  -- workflow id, the cron expressions and the webhook paths are location and
  -- mechanism, and CONTROL-PLANE.md Part 4 keeps those on the vendor's side.
  -- Adding a column here is the deliberate act it should be.
  --
  -- A caller acting as `authenticated` or `anon` gets rows only as a member of
  -- an ACTIVE dealership; every other caller (service_role, postgres, the
  -- nightly batches) gets the register. current_setting('role') is the same
  -- idiom nexus_scoped_tenant_id() already uses, and it fails OPEN for the
  -- platform and CLOSED for a dealership session, which is the direction that
  -- matters. A PostgREST caller cannot change that GUC.
  select r.name, r.audit_name, r.audit_aliases, r.category, r.description,
         r.is_active, r.writes_audit_log
    from public.workflow_registry r
   where coalesce(pg_catalog.current_setting('role', true), 'none')
           not in ('authenticated', 'anon')
      or exists (select 1 from public.nexus_current_tenant_ids());
$fn$;

comment on function public.nexus_workflow_catalogue() is
'The dealer-safe projection of public.workflow_registry, and the only path to it that is not service_role. The register itself is control plane (CONTROL-PLANE.md 2.1, 5.2): `authenticated` holds no privilege on the table at all, so v_workflow_health, v_lead_recovery, v_needs_attention and v_audit_unregistered_writers - all security_invoker, all therefore checked against the CALLER - read this function instead. It returns name, audit_name, audit_aliases, category, description, is_active and writes_audit_log, and never id, trigger_type or trigger_detail. A signed-in caller who is a member of no active dealership gets zero rows. EXECUTE is granted to authenticated and service_role and revoked from anon and PUBLIC; REVOKE ... FROM PUBLIC does not remove a direct grant, so both are named.';

revoke all on function public.nexus_workflow_catalogue() from public;
revoke all on function public.nexus_workflow_catalogue() from anon;
grant execute on function public.nexus_workflow_catalogue() to authenticated;
grant execute on function public.nexus_workflow_catalogue() to service_role;

-- The four views, rewritten by SUBSTITUTION rather than by retyping. Retyping
-- 28KB of v_lead_recovery to change one FROM clause is how arithmetic gets
-- edited by accident; this way the only difference is the source relation, and
-- the assertions below refuse to run if that is not true. `with (security_invoker
-- = true)` is spelled inline because `create or replace view` has silently
-- dropped it three times in this codebase.
do $mig$
declare
  v text;
  d text;
  n int;
begin
  foreach v in array array['v_workflow_health', 'v_lead_recovery',
                           'v_needs_attention', 'v_audit_unregistered_writers']
  loop
    d := pg_get_viewdef(('public.' || v)::regclass, true);
    n := (length(d) - length(replace(d, 'workflow_registry r', ''))) / 19;
    if n = 0 then
      raise exception 'public.% does not read workflow_registry under alias r; refusing to rewrite it blind', v;
    end if;
    d := replace(d, 'workflow_registry r', 'public.nexus_workflow_catalogue() r');
    if position('workflow_registry' in d) > 0 then
      raise exception 'public.% still names workflow_registry after substitution', v;
    end if;
    execute format('create or replace view public.%I with (security_invoker = true) as %s', v, d);
    if not exists (select 1
                     from pg_class c
                     join pg_namespace ns on ns.oid = c.relnamespace
                    where ns.nspname = 'public' and c.relname = v
                      and c.reloptions @> array['security_invoker=true']) then
      raise exception 'public.% lost security_invoker on replace', v;
    end if;
  end loop;
end
$mig$;

-- The revoke. Column privileges are NOT removed by revoking the table
-- privilege, so the seven columns are named; and CLAUDE.md's rule is that a
-- direct grant and a PUBLIC grant are separate ACL rows, so both are named.
revoke select (name, audit_name, audit_aliases, category, description,
               is_active, writes_audit_log)
  on public.workflow_registry from authenticated;
revoke all on public.workflow_registry from authenticated;
revoke all on public.workflow_registry from anon;
revoke all on public.workflow_registry from public;

-- The policy goes with the grant. It is dropped rather than narrowed: a
-- narrowed policy on a table `authenticated` holds no privilege on would be
-- decoration, and a policy that reads like a tenant scope while scoping nothing
-- is exactly the shape this migration exists to refuse. workflow_registry_deny_anon
-- (RESTRICTIVE, anon, USING false) and workflow_registry_service_role_all are
-- untouched.
drop policy if exists workflow_registry_read on public.workflow_registry;

comment on table public.workflow_registry is
'The platform''s register of the automations NEXUS runs: n8n workflow id, name, the audit_log names it writes under, trigger type and detail, category, is_active.

CONTROL PLANE (CONTROL-PLANE.md 2.1, 5.2): this is a VENDOR table and it is off the dealer data plane. `authenticated` holds no table privilege and no column privilege on it, and there is no policy for `authenticated`; service_role holds all ten columns. A dealership reaches the dealer-safe projection - name, audit_name, audit_aliases, category, description, is_active, writes_audit_log - only through public.nexus_workflow_catalogue(), and only as a member of an active dealership.

It has NO tenant_id on purpose. The rows are the vendor''s, not a dealership''s, and no measurement in this database maps an automation to a dealership; three of the registered workflows are NEXUS''s own public pages and serve none. Adding a tenant_id would mean inventing that mapping, and a nullable-meaning-platform one would be a predicate that filters nothing. When a fact exists that says which automations serve which dealership, it belongs in nexus_workflow_catalogue(), which is the one place every reader now goes through.

Restoring a table-wide or column grant for `authenticated`, or re-creating a USING (true) policy, re-opens the leak and puts the id, the cron expressions and the webhook paths back on a dealership screen.';

comment on view public.v_workflow_health is
'Workflow health on canonical outcome semantics (see nexus_outcome_class). DEGRADED on failures OR partials. PRODUCING_NOTHING when over half of qualifying runs yielded no result - this is what an 87% scrape miss rate looks like when it is not hidden behind a rejection label.

SECURITY: this view MUST be security_invoker = true. It reads public.nexus_workflow_catalogue() and audit_log, and the health arithmetic is computed from the CALLER''s audit_log rows, which is what makes the answer this dealership''s own. Recreating it with `create or replace view` silently drops that option, so any replacement MUST spell out `with (security_invoker = true)` inline.

CONTROL PLANE: it reads the register through nexus_workflow_catalogue() and not through workflow_registry, because `authenticated` holds no privilege on that table and a security_invoker view is checked on every base column its BODY reads - reading the table here would make this view 42501 for every dealership login. The accessor cannot return id, trigger_type or trigger_detail, so the leak this view used to carry is now structurally absent rather than merely unprojected. A dealership is entitled to know that its automation is broken; it is not entitled to the id and address of the job.';