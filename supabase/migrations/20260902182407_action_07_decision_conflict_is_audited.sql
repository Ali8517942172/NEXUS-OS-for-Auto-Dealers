-- ===========================================================================
-- action_07_decision_conflict_is_audited
--
-- BUSINESS RULE: two managers deciding the same unit is a real event at a
-- dealership and it must leave a trace. As shipped in action_04, the second
-- decision was refused correctly - the first decision stood, and the caller was
-- told who made it and when - but nothing was written down. A collision that
-- leaves no record cannot be counted, and "how often do our managers disagree
-- about the same car" is a question this product should be able to answer.
--
-- The audit row is written with status REJECTED and a summary that deliberately
-- does NOT contain any of the refused-by-design phrases nexus_outcome_class
-- looks for ('unauthor', 'forbidden', 'refused by validation', 'invalid token',
-- 'not permitted'), so it classifies as NO_RESULT - "it ran and produced
-- nothing usable. Not a crash, and not a success either", which is exactly what
-- a rejected second decision is. It is NOT REJECTED_EXPECTED: nothing was
-- unauthorised here, the person was entitled to decide and simply arrived
-- second.
-- ===========================================================================

alter table public.inventory_action_events
  drop constraint if exists inventory_action_events_event_check;
alter table public.inventory_action_events
  add constraint inventory_action_events_event_check check (event in (
    'PROPOSED', 'APPROVED', 'REJECTED', 'DEFERRED', 'ASSIGNED',
    'EXECUTED', 'EXECUTION_FAILED', 'CANCELLED',
    'OUTCOME_ATTRIBUTED', 'OUTCOME_NOT_ATTRIBUTABLE',
    'APPROVAL_REFUSED', 'ESCALATED', 'DECISION_CONFLICT'
  ));

do $do$
declare
  v_def text;
  v_old text :=
'      select u.name into v_who from public.users u where u.id = v_row.decided_by_staff_id;
      return query select false, false, ''ALREADY_DECIDED'',';
  v_new text :=
'      select u.name into v_who from public.users u where u.id = v_row.decided_by_staff_id;
      v_sent := ''A '' || v_dec || '' arrived for an action already '' || lower(v_row.status)
        || '' by '' || coalesce(v_who, ''another account'') || '' on ''
        || to_char(v_row.decided_at at time zone ''Asia/Dubai'', ''DD Mon YYYY HH24:MI'')
        || '' GST. It was not applied: the first decision stands. Attempted by ''
        || coalesce(v_ctx.staff_name, ''an account with no staff record'') || ''.'';
      v_audit := public.action_write_audit(
        v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, ''REJECTED'', v_sent);
      insert into public.inventory_action_events
        (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
      values (v_ctx.tenant_id, v_row.id, ''DECISION_CONFLICT'', v_ctx.staff_id, v_ctx.auth_user_id,
              v_ctx.authority, v_sent, v_audit);
      return query select false, false, ''ALREADY_DECIDED'',';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'action_decide';
  if v_def is null then raise exception 'public.action_decide does not exist'; end if;
  if position('DECISION_CONFLICT' in v_def) > 0 then return; end if;
  if position(v_old in v_def) = 0 then
    raise exception 'action_decide ALREADY_DECIDED branch is not the shape this migration expects';
  end if;
  execute replace(v_def, v_old, v_new);
end
$do$;