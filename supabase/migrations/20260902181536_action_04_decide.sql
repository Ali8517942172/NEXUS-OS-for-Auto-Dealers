-- ===========================================================================
-- action_04_decide
--
-- BUSINESS RULE: a recommendation becomes a decision only when a person who is
-- allowed to decide says so, on the record, with a reason when the answer is
-- no. Three things this function refuses to do:
--
--   1. It will not let an unauthorised account approve. The check is
--      public.action_approver_context() and it runs in the database on every
--      call, so it is enforced whether the call comes from the dashboard, from
--      curl against PostgREST, or from n8n.
--   2. It will not silently approve when this dealership has nobody who may
--      approve. It escalates: the action stays PROPOSED, escalated_at is
--      stamped, and an ESCALATED audit row is written - the class
--      nexus_outcome_class already defines as "handed to a person on purpose".
--   3. It will not record a rejection without a reason code from the closed
--      list AND a note. A rejection is the only evidence this product will ever
--      have that a recommendation was wrong; an unexplained one is a lost
--      lesson, and the CHECK constraint on the table refuses it too.
--
-- CONCURRENCY. The row is taken FOR UPDATE before anything is read from it, so
-- two managers hitting approve in the same second serialise. The second one
-- then finds the row already decided and is answered with WHO decided it and
-- WHEN, rather than silently overwriting the first decision. A repeat of the
-- SAME decision by the SAME person - the double-click - is idempotent: it
-- returns the existing row, changes nothing, and writes no second audit row,
-- because an audit records changes and nothing changed.
-- ===========================================================================

create or replace function public.action_decide(
  p_action_id       uuid,
  p_decision        text,
  p_reason_code     text default null,
  p_note            text default null,
  p_defer_until     date default null,
  p_assign_staff_id uuid default null
)
returns table (
  ok             boolean,
  idempotent     boolean,
  refusal_code   text,
  refusal_reason text,
  action         public.inventory_actions
)
language plpgsql security definer set search_path = public as $$
declare
  v_ctx     record;
  v_row     public.inventory_actions;
  v_dec     text := upper(btrim(coalesce(p_decision, '')));
  v_target  text;
  v_code    text := nullif(btrim(coalesce(p_reason_code, '')), '');
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_rc      public.inventory_action_reason_codes%rowtype;
  v_assign  public.users%rowtype;
  v_who     text;
  v_audit   uuid;
  v_sent    text;
begin
  v_target := case v_dec when 'APPROVE' then 'APPROVED'
                         when 'REJECT'  then 'REJECTED'
                         when 'DEFER'   then 'DEFERRED' end;
  if v_target is null then
    raise exception 'action_decide: p_decision must be APPROVE, REJECT or DEFER, not %', p_decision
      using errcode = '22023';
  end if;

  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, null::public.inventory_actions;
    return;
  end if;

  -- Lock first, read second. Everything below is decided against a row no
  -- other session can move underneath it.
  select * into v_row from public.inventory_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id
   for update;
  if not found then
    -- Same answer for "no such action" and "belongs to another dealership".
    -- Distinguishing them would confirm the existence of another dealership's row.
    return query select false, false, 'NOT_FOUND',
      'No such action on this dealership.', null::public.inventory_actions;
    return;
  end if;

  -- ── Authorisation, before anything is written ───────────────────────────
  if not v_ctx.may_decide then
    if v_ctx.refusal_code = 'NO_APPROVER_AT_DEALERSHIP' then
      if v_row.escalated_at is null then
        update public.inventory_actions
           set escalated_at = now(), escalation_reason = v_ctx.refusal_reason
         where id = v_row.id
        returning * into v_row;
      end if;
      v_audit := public.action_write_audit(
        v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'ESCALATED',
        'A decision (' || v_dec || ') was attempted by '
        || coalesce(v_ctx.staff_name, 'an account with no staff record')
        || ' and this dealership has nobody holding a role allowed to approve inventory '
        || 'actions, so the action was handed to a person instead of being decided. '
        || 'It remains PROPOSED.');
      insert into public.inventory_action_events
        (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
      values (v_ctx.tenant_id, v_row.id, 'ESCALATED', v_ctx.staff_id, v_ctx.auth_user_id,
              coalesce(v_ctx.tenant_role, 'no account role'), v_ctx.refusal_reason, v_audit);
      return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, v_row;
      return;
    end if;

    -- "not permitted" is in this summary on purpose: it is one of the phrases
    -- nexus_outcome_class reads as refused-by-design, which classifies this row
    -- REJECTED_EXPECTED and keeps an authorisation refusal out of any failure
    -- rate. Do not reword it without reading that function.
    v_audit := public.action_write_audit(
      v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'REJECTED',
      'Decision (' || v_dec || ') not permitted for '
      || coalesce(v_ctx.staff_name, 'an account with no staff record')
      || ' — ' || v_ctx.refusal_reason);
    insert into public.inventory_action_events
      (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
    values (v_ctx.tenant_id, v_row.id, 'APPROVAL_REFUSED', v_ctx.staff_id, v_ctx.auth_user_id,
            coalesce(v_ctx.tenant_role, 'no account role'), v_ctx.refusal_reason, v_audit);
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, v_row;
    return;
  end if;

  -- ── Already decided? ────────────────────────────────────────────────────
  if v_row.status not in ('PROPOSED', 'DEFERRED') or (v_row.status = 'DEFERRED' and v_target = 'DEFERRED') then
    if v_row.status = v_target
       and v_row.decided_by_auth_id is not distinct from v_ctx.auth_user_id
       and coalesce(v_row.decision_reason_code, '') = coalesce(v_code, '')
       and v_row.defer_until is not distinct from p_defer_until then
      -- The double-click. Nothing changed, so nothing is audited.
      return query select true, true, null::text,
        'This decision was already recorded by you at '
        || to_char(v_row.decided_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI')
        || ' GST. No second record was created.', v_row;
      return;
    end if;
    if v_row.status not in ('PROPOSED', 'DEFERRED') then
      select u.name into v_who from public.users u where u.id = v_row.decided_by_staff_id;
      return query select false, false, 'ALREADY_DECIDED',
        'This action was already ' || lower(v_row.status) || ' by '
        || coalesce(v_who, 'another account') || ' on '
        || to_char(v_row.decided_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI')
        || ' GST. A second decision would overwrite theirs, so it was not applied.', v_row;
      return;
    end if;
  end if;

  -- ── Reason codes ────────────────────────────────────────────────────────
  if v_target in ('REJECTED', 'DEFERRED') then
    if v_code is null then
      return query select false, false, 'REASON_REQUIRED',
        'A ' || lower(v_target) || ' decision needs a reason code from the closed list. '
        || 'It is the only way this product ever learns which recommendations were wrong.', v_row;
      return;
    end if;
    select * into v_rc from public.inventory_action_reason_codes where code = v_code;
    if not found or not (v_dec = any (v_rc.applies_to)) then
      return query select false, false, 'REASON_NOT_VALID',
        'Reason code ' || v_code || ' is not one this system accepts for a ' || lower(v_target)
        || '. Read public.inventory_action_reason_codes for the list.', v_row;
      return;
    end if;
    if v_target = 'REJECTED' and (v_note is null or length(v_note) < 3) then
      return query select false, false, 'NOTE_REQUIRED',
        'A rejection needs a note as well as a code. The code makes it countable; the note '
        || 'is what makes it understandable to whoever reads it in three months.', v_row;
      return;
    end if;
  end if;
  if v_target = 'DEFERRED' and p_defer_until is not null and p_defer_until <= current_date then
    return query select false, false, 'DEFER_DATE_PAST',
      'A deferral has to point at a future date, otherwise it is due the moment it is made.', v_row;
    return;
  end if;

  -- ── Assignment ──────────────────────────────────────────────────────────
  if p_assign_staff_id is not null then
    select * into v_assign from public.users u
     where u.id = p_assign_staff_id and u.tenant_id = v_ctx.tenant_id;
    if not found then
      return query select false, false, 'ASSIGNEE_NOT_FOUND',
        'That person is not on this dealership''s staff list, so the action cannot be assigned to them.', v_row;
      return;
    end if;
  end if;

  update public.inventory_actions a set
    status               = v_target,
    decided_at           = now(),
    decided_by_staff_id  = v_ctx.staff_id,
    decided_by_auth_id   = v_ctx.auth_user_id,
    decided_by_authority = v_ctx.authority,
    decision_reason_code = v_code,
    decision_note        = v_note,
    defer_until          = case when v_target = 'DEFERRED' then p_defer_until else null end,
    assigned_to_staff_id = case when v_target = 'APPROVED' then p_assign_staff_id else a.assigned_to_staff_id end,
    assigned_role        = case when v_target = 'APPROVED' and p_assign_staff_id is null
                                then a.engine_owner_role else v_assign.role end,
    assigned_at          = case when v_target = 'APPROVED' then now() else a.assigned_at end,
    outcome_state        = case when v_target = 'REJECTED' then 'CLOSED_WITHOUT_ACTION' else a.outcome_state end
  where a.id = v_row.id
  returning * into v_row;

  v_sent := case v_target
    when 'APPROVED' then 'Approved by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
      || ' on authority ' || v_ctx.authority || '. Assigned to '
      || coalesce(v_assign.name, nullif(v_row.assigned_role, ''), 'nobody in particular')
      || '. Nothing has been executed yet and no money has been recovered — approval is a decision, not an outcome.'
    when 'REJECTED' then 'Rejected by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
      || ' on authority ' || v_ctx.authority || '. Reason ' || v_code || ': ' || v_note
      || '. Recorded as evidence about the recommendation, not as a fault.'
    else 'Deferred by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
      || ' on authority ' || v_ctx.authority || '. Reason ' || v_code
      || coalesce('. Due again ' || to_char(p_defer_until, 'DD Mon YYYY'), '. No date set')
      || '.' end;

  v_audit := public.action_write_audit(
    v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'SUCCESS', v_sent);

  insert into public.inventory_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, v_target, v_ctx.staff_id, v_ctx.auth_user_id,
          v_ctx.authority, v_sent, v_audit);

  if v_target = 'APPROVED' and (p_assign_staff_id is not null or v_row.assigned_role is not null) then
    insert into public.inventory_action_events
      (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
    values (v_ctx.tenant_id, v_row.id, 'ASSIGNED', v_ctx.staff_id, v_ctx.auth_user_id, v_ctx.authority,
            case when p_assign_staff_id is not null
                 then 'Assigned to ' || coalesce(v_assign.name, p_assign_staff_id::text)
                 else 'Assigned to the role ' || v_row.assigned_role
                      || ' — a role, not a person. NEXUS holds no verified role directory for this dealership.'
            end, v_audit);
  end if;

  return query select true, false, null::text, null::text, v_row;
end;
$$;

comment on function public.action_decide(uuid, text, text, text, date, uuid) is
  'Approve, reject or defer one proposed inventory action. Authorisation is checked here, '
  'in the database, through action_approver_context() - not in the browser. Rejections '
  'require a code from the closed list and a note. Repeating the same decision as the same '
  'person is idempotent and writes no second audit row; a different decision on an already '
  'decided action is refused and names who decided it. Where nobody at the dealership may '
  'approve, the action is escalated and left PROPOSED rather than approved by whoever asked.';

revoke all on function public.action_decide(uuid, text, text, text, date, uuid) from public;
grant execute on function public.action_decide(uuid, text, text, text, date, uuid) to authenticated, service_role;