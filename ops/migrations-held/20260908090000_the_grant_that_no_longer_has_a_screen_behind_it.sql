-- ═══════════════════════════════════════════════════════════════════════════
-- NOT APPLIED. This file is written and deliberately left unrun.
-- ═══════════════════════════════════════════════════════════════════════════
-- Run it as its own controlled patch AFTER the dashboard carrying the
-- owner-assignment RPC is deployed to Vercel and confirmed working -- never
-- mixed into a live messaging rollout, where a broken screen and a broken
-- channel would be indistinguishable for the first hour.
--
-- WHY IT CAN BE RUN AT ALL NOW
-- ----------------------------
-- public.leads carries eight COLUMN-level UPDATE grants to `authenticated`:
--   name, email, phone, vehicle_interest, budget_aed, status,
--   assigned_to, assigned_to_id
-- They exist for one caller: lib/lead-drawer.js's owner-assignment PATCH. This
-- file has said for days that revoking them "breaks the screen", and that was
-- true until 7 September 2026.
--
-- It is not true any more. The screen now calls nexus_lead_assign_owner, which
-- is SECURITY INVOKER -- so the UPDATE inside it still runs as the caller and
-- still needs... nothing extra, because a function's owner is irrelevant to an
-- INVOKER function: it needs the CALLER to hold the privilege.
--
-- ══ READ THAT AGAIN, BECAUSE IT IS THE TRAP IN THIS MIGRATION ══
-- nexus_lead_assign_owner is SECURITY INVOKER. Revoking the column grants
-- BREAKS IT, exactly as it would break a direct PATCH. The two are the same
-- privilege question. Anyone reading "the bundle no longer PATCHes leads, so
-- the grant is unused" and running this without thinking will take the
-- owner-assignment screen down through the RPC instead of through the PATCH.
--
-- So this migration has a prerequisite that is NOT a deploy: the assignment
-- function must first become SECURITY DEFINER *and* carry its own copy of the
-- leads_role_update authorisation -- which is the second copy of a rule this
-- project deliberately refused to create on 7 September, for good reasons that
-- have not changed.
--
-- THE HONEST POSITION, THEREFORE
-- ------------------------------
-- This is a security improvement with a real cost, not a free win. The choice
-- is between:
--
--   (a) leave the grants. A signed-in user can PATCH leads directly, and
--       leads_role_update still decides WHICH leads -- so the exposure is not
--       "anyone can edit anything", it is "a member can edit their own
--       dealership's leads without the audit reason and without the
--       cross-dealership owner check". Measured, both true today.
--
--   (b) revoke them, and move the authorisation rule into a definer function.
--       Closes (a) completely, and creates the second copy of the rule.
--
-- (b) is probably right eventually, and it is a DESIGN decision that deserves
-- its own pass with someone watching -- not a REVOKE bolted onto a deploy.
--
-- What follows is (b)'s revoke half only, so that when the decision is taken
-- the mechanics are already written and already carry their own assertions.
-- It will fail its own preflight until the function is converted.

do $$
declare n int;
begin
  -- PREFLIGHT 1: the assignment function must not be INVOKER any more, or this
  -- revoke takes the screen down.
  if not (select p.prosecdef from pg_proc p join pg_namespace nsp on nsp.oid=p.pronamespace
           where nsp.nspname='public' and p.proname='nexus_lead_assign_owner') then
    raise exception
      'REFUSING: nexus_lead_assign_owner is still SECURITY INVOKER, so it needs the caller to hold UPDATE on public.leads. Revoking these grants would break the owner-assignment screen through the RPC instead of through the PATCH. Convert the function first, with its own copy of the leads_role_update predicate, and re-read the note at the top of this file before doing so.';
  end if;

  -- PREFLIGHT 2: nothing else may have started using the grant since.
  -- This cannot be checked from SQL -- it is a fact about the shipped bundle --
  -- so it is stated as a manual gate rather than pretended to be automatic:
  --   grep -c 'leads?id=eq' apps/executive-dashboard/dist/assets/main-*.js   -> 0
  --   grep -rn 'dbWrite(.*leads' apps/executive-dashboard/lib screens        -> nothing
  -- Both measured 7 September 2026. Re-measure against the DEPLOYED bundle.
  null;
end $$;

revoke update (name, email, phone, vehicle_interest, budget_aed, status,
               assigned_to, assigned_to_id)
  on public.leads from authenticated;

do $$
declare bad text[] := '{}';
begin
  if has_any_column_privilege('authenticated', 'public.leads', 'UPDATE') then
    bad := array_append(bad, 'authenticated still holds a column-level UPDATE on leads');
  end if;
  -- The read path must survive. This is the whole reason the revoke names
  -- columns and the verb rather than saying `revoke all`.
  if not has_table_privilege('authenticated', 'public.leads', 'SELECT') then
    bad := array_append(bad, 'authenticated lost SELECT on leads -- every screen that lists leads is broken');
  end if;
  if not has_table_privilege('service_role', 'public.leads', 'UPDATE') then
    bad := array_append(bad, 'service_role lost UPDATE on leads -- n8n cannot write');
  end if;
  -- And the unit form must be untouched: this migration is about leads only.
  if not has_any_column_privilege('authenticated', 'public.inventory', 'INSERT') then
    bad := array_append(bad, 'authenticated lost INSERT on inventory -- the unit form is broken, and this migration should not have touched it');
  end if;
  if cardinality(bad) > 0 then
    raise exception 'leads grant revoke is wrong: %', array_to_string(bad, '; ');
  end if;
end $$;
