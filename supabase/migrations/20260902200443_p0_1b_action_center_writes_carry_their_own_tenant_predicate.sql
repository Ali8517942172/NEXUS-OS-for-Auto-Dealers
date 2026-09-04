/* ═══════════════════════════════════════════════════════════════════════════
   P0-1, second half. The claim "only one definer write lacks a tenant
   predicate" was checked rather than trusted, and it is right about behaviour
   and wrong about the statements.

   BUSINESS RULE
   A write inside a SECURITY DEFINER function runs with RLS bypassed. It must
   therefore name the dealership it is writing to in its own WHERE clause, not
   inherit it from a SELECT several hundred lines earlier. Scope that is only
   transitive is scope that a later refactor can drop without touching a line
   that mentions a tenant.

   WHAT WAS FOUND
   Nineteen write statements across the fourteen definer functions reachable by
   `authenticated`. Eighteen are correctly scoped and one — recompute_inventory
   _derived — was not; that is fixed in p0_1_recompute_inventory_derived_scopes
   _to_its_caller. Behaviourally the eighteen are sound, and it was proven
   adversarially on 2026-09-02 with a second live tenant: action_decide,
   action_cancel, action_mark_executed, action_mark_not_attributable and
   action_record_outcome all answered "No such action on this dealership." to a
   member of another dealership and wrote nothing.

   But six of those eighteen carry their tenant only TRANSITIVELY. They lock the
   row with
       select ... where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id
   and then write with
       where a.id = v_row.id
   which is safe today only because inventory_actions.id is a globally unique
   primary key. That is a real dependency on a fact nowhere near the statement —
   and inventory has just shown what happens when a key that looks unique is not:
   its primary key is (tenant_id, id) and a write that joined on id alone crossed
   dealerships.

   It also means the release gate's own L4 check reports
   `action_decide: ... "update public.inventory_actions" carries no tenant
   predicate` as a P0. That is a false positive on behaviour and a true positive
   on structure: the next `tenant_id` after that statement is 1,997 characters
   away, past the 900-character window L4 reads. The honest close is to make the
   predicate real rather than to argue with the detector.

   THE FIX
   Every one of those writes now names its tenant. The predicate is redundant
   today — v_row was selected under it — so behaviour is unchanged by
   construction, and each function is rewritten from its own live definition with
   a single textual substitution so no other line can drift. What changes is that
   the scope is now visible at the statement, survives a refactor of the SELECT
   above it, and is a second lock rather than a comment about the first.
   ═══════════════════════════════════════════════════════════════════════════ */

do $$
declare
  fn   regprocedure;
  def  text;
  next text;
  n    integer := 0;
begin
  foreach fn in array array[
      'public.action_cancel(uuid,text)'::regprocedure,
      'public.action_decide(uuid,text,text,text,date,uuid)'::regprocedure,
      'public.action_mark_executed(uuid,text,boolean,text)'::regprocedure,
      'public.action_mark_not_attributable(uuid,text)'::regprocedure,
      'public.action_record_outcome(uuid,uuid,text)'::regprocedure ]
  loop
    def  := pg_get_functiondef(fn);
    next := replace(def,
              'where a.id = v_row.id',
              'where a.id = v_row.id and a.tenant_id = v_ctx.tenant_id');
    next := replace(next,
              'where id = v_row.id',
              'where id = v_row.id and tenant_id = v_ctx.tenant_id');
    if next = def then
      raise exception 'p0_1b: % was not rewritten - its write no longer matches the '
                      'expected shape, so this migration would silently do nothing', fn;
    end if;
    execute next;
    n := n + 1;
  end loop;
  raise notice 'p0_1b: % Action Center functions rewritten', n;
end $$;