-- ===========================================================================
-- action_04b_decide_keeps_prior_assignment
--
-- DEFECT, found in review of action_04 before anything used it: the assignment
-- branch of the UPDATE read
--     assigned_role = case when v_target = 'APPROVED' and p_assign_staff_id is null
--                          then a.engine_owner_role else v_assign.role end
-- so any decision that was NOT an approval wrote v_assign.role, which is NULL
-- on a reject or defer because v_assign is never populated on those paths. It
-- would have wiped an existing assignment on the DEFERRED -> REJECTED
-- transition. Unreachable today only because assigned_role is set on approval
-- and an approved action cannot be re-decided - which is luck, not a rule.
--
-- Applied to the live database as a text patch of the function definition on
-- 2026-09-02 before this migration was recorded; this migration is the ledger
-- entry for it and is written to be safe whether or not the patch is already
-- in place.
-- ===========================================================================
do $do$
declare
  v_def text;
  v_old text := 'assigned_role        = case when v_target = ''APPROVED'' and p_assign_staff_id is null
                                then a.engine_owner_role else v_assign.role end,';
  v_new text := 'assigned_role        = case when v_target <> ''APPROVED'' then a.assigned_role
                                when p_assign_staff_id is null then a.engine_owner_role
                                else v_assign.role end,';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'action_decide';
  if v_def is null then
    raise exception 'public.action_decide does not exist';
  end if;
  if position(v_new in v_def) > 0 then
    return;                      -- already correct
  end if;
  if position(v_old in v_def) = 0 then
    raise exception 'public.action_decide is neither the defective nor the fixed shape; do not guess';
  end if;
  execute replace(v_def, v_old, v_new);
end
$do$;