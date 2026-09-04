-- LEAD RECOVERY ENGINE — 08: deciding an action.
-- Same shape as action_decide: lock first, authorise before writing anything,
-- audit the refusal as well as the approval, treat a repeat of the same decision
-- by the same person as a double-click and a different one as a conflict that
-- does not overwrite the first.
create function public.lead_recovery_decide(
  p_action_id uuid,
  p_decision  text,
  p_reason_code text default null,
  p_note      text default null,
  p_defer_until date default null,
  p_assign_staff_id uuid default null)
returns table(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action public.lead_recovery_actions)
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_ctx    record;
  v_row    public.lead_recovery_actions;
  v_dec    text := upper(btrim(coalesce(p_decision, '')));
  v_target text;
  v_code   text := nullif(btrim(coalesce(p_reason_code, '')), '');
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_rc     public.lead_recovery_reason_codes%rowtype;
  v_assign public.users%rowtype;
  v_who    text;
  v_audit  uuid;
  v_sent   text;
  v_reason text;
  v_new_assignee uuid;
  v_new_role     text;
begin
  v_target := case v_dec when 'APPROVE' then 'APPROVED'
                         when 'REJECT'  then 'REJECTED'
                         when 'DEFER'   then 'DEFERRED' end;
  if v_target is null then
    raise exception 'lead_recovery_decide: p_decision must be APPROVE, REJECT or DEFER, not %', p_decision
      using errcode = '22023';
  end if;

  select * into v_ctx from public.action_approver_context();
  v_reason := replace(coalesce(v_ctx.refusal_reason, ''), 'inventory action', 'action');
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code, nullif(v_reason,''), null::public.lead_recovery_actions;
    return;
  end if;

  select * into v_row from public.lead_recovery_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id
   for update;
  if not found then
    -- Same answer for "no such action" and "belongs to another dealership".
    return query select false, false, 'NOT_FOUND',
      'No such action on this dealership.', null::public.lead_recovery_actions;
    return;
  end if;

  if not v_ctx.may_decide then
    if v_ctx.refusal_code = 'NO_APPROVER_AT_DEALERSHIP' then
      if v_row.escalated_at is null then
        update public.lead_recovery_actions
           set escalated_at = now(), escalation_reason = v_reason, updated_at = now()
         where id = v_row.id and tenant_id = v_ctx.tenant_id
        returning * into v_row;
      end if;
      v_audit := public.lead_recovery_write_audit(
        v_ctx.tenant_id, v_row.id, v_row.lead_id, v_row.recommendation, 'ESCALATED',
        'A decision (' || v_dec || ') was attempted by '
        || coalesce(v_ctx.staff_name, 'an account with no staff record')
        || ' and this dealership has nobody holding a role allowed to approve actions, so it was '
        || 'handed to a person instead of being decided. It remains PROPOSED.');
      insert into public.lead_recovery_action_events
        (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
      values (v_ctx.tenant_id, v_row.id, 'ESCALATED', v_ctx.staff_id, v_ctx.auth_user_id,
              'NONE - refused; account role ' || coalesce(v_ctx.tenant_role, 'none'), v_reason, v_audit);
      return query select false, false, v_ctx.refusal_code, v_reason, v_row;
      return;
    end if;

    -- "not permitted" is in this summary on purpose: nexus_outcome_class reads it
    -- as refused-by-design and classifies the row REJECTED_EXPECTED, keeping an
    -- authorisation refusal out of any failure rate. Do not reword it without
    -- reading that function.
    v_audit := public.lead_recovery_write_audit(
      v_ctx.tenant_id, v_row.id, v_row.lead_id, v_row.recommendation, 'REJECTED',
      'Decision (' || v_dec || ') not permitted for '
      || coalesce(v_ctx.staff_name, 'an account with no staff record') || ' — ' || v_reason);
    insert into public.lead_recovery_action_events
      (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
    values (v_ctx.tenant_id, v_row.id, 'APPROVAL_REFUSED', v_ctx.staff_id, v_ctx.auth_user_id,
            'NONE - refused; account role ' || coalesce(v_ctx.tenant_role, 'none'), v_reason, v_audit);
    return query select false, false, v_ctx.refusal_code, v_reason, v_row;
    return;
  end if;

  if v_row.status not in ('PROPOSED','DEFERRED') or (v_row.status = 'DEFERRED' and v_target = 'DEFERRED') then
    if v_row.status = v_target
       and v_row.decided_by_auth_id is not distinct from v_ctx.auth_user_id
       and coalesce(v_row.decision_reason_code, '') = coalesce(v_code, '')
       and v_row.defer_until is not distinct from p_defer_until then
      return query select true, true, null::text,
        'This decision was already recorded by you at '
        || to_char(v_row.decided_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI')
        || ' GST. No second record was created.', v_row;
      return;
    end if;
    if v_row.status not in ('PROPOSED','DEFERRED') then
      select u.name into v_who from public.users u where u.id = v_row.decided_by_staff_id;
      v_sent := 'A ' || v_dec || ' arrived for an action already ' || lower(v_row.status)
        || ' by ' || coalesce(v_who, 'another account') || ' on '
        || to_char(v_row.decided_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI')
        || ' GST. It was not applied: the first decision stands.';
      v_audit := public.lead_recovery_write_audit(
        v_ctx.tenant_id, v_row.id, v_row.lead_id, v_row.recommendation, 'REJECTED', v_sent);
      insert into public.lead_recovery_action_events
        (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
      values (v_ctx.tenant_id, v_row.id, 'DECISION_CONFLICT', v_ctx.staff_id, v_ctx.auth_user_id,
              v_ctx.authority, v_sent, v_audit);
      return query select false, false, 'ALREADY_DECIDED', v_sent, v_row;
      return;
    end if;
  end if;

  if v_target in ('REJECTED','DEFERRED') then
    if v_code is null then
      return query select false, false, 'REASON_REQUIRED',
        'A ' || lower(v_target) || ' decision needs a reason code from the closed list. It is the only '
        || 'way this product ever learns which recommendations were wrong.', v_row;
      return;
    end if;
    select * into v_rc from public.lead_recovery_reason_codes where code = v_code;
    if not found or not (v_dec = any (v_rc.applies_to)) then
      return query select false, false, 'REASON_NOT_VALID',
        'Reason code ' || v_code || ' is not one this system accepts for a ' || lower(v_target)
        || '. Read public.lead_recovery_reason_codes for the list.', v_row;
      return;
    end if;
    if v_target = 'REJECTED' and (v_note is null or length(v_note) < 3) then
      return query select false, false, 'NOTE_REQUIRED',
        'A rejection needs a note as well as a code. The code makes it countable; the note is what '
        || 'makes it understandable to whoever reads it in three months.', v_row;
      return;
    end if;
  end if;
  if v_target = 'DEFERRED' and p_defer_until is not null and p_defer_until <= current_date then
    return query select false, false, 'DEFER_DATE_PAST',
      'A deferral has to point at a future date, otherwise it is due the moment it is made.', v_row;
    return;
  end if;

  if p_assign_staff_id is not null then
    select * into v_assign from public.users u
     where u.id = p_assign_staff_id and u.tenant_id = v_ctx.tenant_id;
    if not found then
      return query select false, false, 'ASSIGNEE_NOT_FOUND',
        'That person is not on this dealership''s staff list, so the action cannot be assigned to them.', v_row;
      return;
    end if;
  end if;

  v_new_assignee := case when v_target = 'APPROVED' then p_assign_staff_id else v_row.assigned_to_staff_id end;
  v_new_role     := case when v_target <> 'APPROVED' then v_row.assigned_role
                         when p_assign_staff_id is null then v_row.engine_owner_role
                         else v_assign.role end;

  update public.lead_recovery_actions a set
    status               = v_target,
    decided_at           = now(),
    decided_by_staff_id  = v_ctx.staff_id,
    decided_by_auth_id   = v_ctx.auth_user_id,
    decided_by_authority = v_ctx.authority,
    decision_reason_code = v_code,
    decision_note        = v_note,
    defer_until          = case when v_target = 'DEFERRED' then p_defer_until else null end,
    assigned_to_staff_id = v_new_assignee,
    assigned_role        = v_new_role,
    assigned_at          = case when v_target = 'APPROVED' then now() else a.assigned_at end,
    outcome_state        = case when v_target = 'REJECTED' then 'CLOSED_WITHOUT_ACTION' else a.outcome_state end,
    updated_at           = now()
  where a.id = v_row.id and a.tenant_id = v_ctx.tenant_id
  returning * into v_row;

  v_sent := case v_target
    when 'APPROVED' then 'Approved by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
      || ' on authority ' || v_ctx.authority || '. Assigned to '
      || coalesce(v_assign.name, nullif(v_row.assigned_role, ''), 'nobody in particular')
      || '. Nothing has been executed yet and no money has been recovered - approval is a decision, not an outcome.'
    when 'REJECTED' then 'Rejected by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
      || ' on authority ' || v_ctx.authority || '. Reason ' || v_code || ': ' || v_note
      || '. Recorded as evidence about the recommendation, not as a fault.'
    else 'Deferred by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
      || ' on authority ' || v_ctx.authority || '. Reason ' || v_code
      || coalesce('. Due again ' || to_char(p_defer_until, 'DD Mon YYYY'), '. No date set') || '.' end;

  v_audit := public.lead_recovery_write_audit(
    v_ctx.tenant_id, v_row.id, v_row.lead_id, v_row.recommendation, 'SUCCESS', v_sent);

  insert into public.lead_recovery_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, v_target, v_ctx.staff_id, v_ctx.auth_user_id,
          v_ctx.authority, v_sent, v_audit);

  return query select true, false, null::text, null::text, v_row;
end;
$$;

revoke all on function public.lead_recovery_decide(uuid,text,text,text,date,uuid) from anon, public;
grant execute on function public.lead_recovery_decide(uuid,text,text,text,date,uuid) to authenticated, service_role;