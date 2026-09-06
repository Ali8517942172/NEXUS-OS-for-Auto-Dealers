-- ===========================================================================
-- action_04c_refusal_event_authority_wording
--
-- BUSINESS RULE: a column called actor_authority must hold the authority the
-- actor acted on, or say plainly that they had none. On the two refusal paths
-- action_decide wrote the caller's ACCOUNT ROLE into it, so a refused approval
-- by the account owner recorded actor_authority = 'owner' - a row that reads as
-- "approved on owner authority" next to an event that means the opposite. This
-- is the caption-contradicts-its-own-branch defect this repo has found seven
-- times; caught here in review before any screen read the column.
-- ===========================================================================
do $do$
declare
  v_def text;
  v_old text := 'coalesce(v_ctx.tenant_role, ''no account role'')';
  v_new text := '''NONE - refused; account role '' || coalesce(v_ctx.tenant_role, ''none'')';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'action_decide';
  if v_def is null then raise exception 'public.action_decide does not exist'; end if;
  if position(v_new in v_def) > 0 then return; end if;
  if position(v_old in v_def) = 0 then
    raise exception 'action_decide is neither the old nor the new shape; do not guess';
  end if;
  execute replace(v_def, v_old, v_new);
end
$do$;