-- ===========================================================================
-- action_05_execute_outcome_and_cancel
--
-- BUSINESS RULE (PRODUCT.md, "Rules that outrank features"):
--   "Never claim recovered revenue until a real business outcome occurs."
--   "Estimated, attributed and confirmed are three different words."
--
-- The three words, as this schema uses them:
--   ESTIMATED   inventory_actions.engine_impact_aed. Exposure: gross margin
--               sitting in a unit that has not sold. The engine's own
--               impact_basis says in as many words that it is not expected
--               loss, not attributed revenue and not recovered revenue.
--   ATTRIBUTED  inventory_actions.recovered_value_aed. Realised gross margin on
--               a sale a PERSON tied to this action. Real money from
--               purchase_history minus real cost from inventory. It is not a
--               causal claim: NEXUS does not know the action caused the sale
--               and no screen may say it did.
--   CONFIRMED   nothing in this schema is entitled to this word yet. It would
--               need the dealership's accounting system, which NEXUS does not
--               talk to.
--
-- WHY ATTRIBUTION NEEDS A HUMAN
--   Measured 2026-09-02: public.purchase_history has NO column that references
--   an inventory unit. Its columns are id, deal_id, customer_name, email,
--   phone, vehicle (free text typed into the deal form), amount_aed,
--   purchase_date, created_at, lead_id and tenant_id. lead_id points at the
--   PERSON; leads carries no vehicle reference either. So there is no path in
--   the data model from a recorded sale to the car that was sold. The one real
--   sale on this database is a case in point: vehicle = 'Lexus LX 600 2024' at
--   AED 585,000, which is character-for-character the model and exactly the
--   list price of unit NX-1011 - and NX-1011 is still marked Available. The
--   text matches perfectly and proves nothing.
--
--   action_outcome_candidates() below therefore OFFERS matches and labels every
--   one of them MODEL_TEXT_ONLY. A person confirms the link or nobody does.
--   The CHECK constraint inventory_actions_recovered_needs_real_sale is what
--   makes this a rule rather than a convention: recovered_value_aed cannot be
--   non-null without a purchase_history row id on the same row.
-- ===========================================================================

create or replace function public.action_mark_executed(
  p_action_id uuid,
  p_note      text default null,
  p_failed    boolean default false,
  p_failure   text default null
)
returns table (
  ok             boolean,
  idempotent     boolean,
  refusal_code   text,
  refusal_reason text,
  action         public.inventory_actions
)
language plpgsql security definer set search_path = public as $fn$
declare
  v_ctx   record;
  v_row   public.inventory_actions;
  v_want  text := case when p_failed then 'EXECUTION_FAILED' else 'EXECUTED' end;
  v_audit uuid;
  v_sent  text;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, null::public.inventory_actions;
    return;
  end if;
  -- Execution is a claim about the real world, so it has to be attached to a
  -- person. An account with no staff row cannot make it.
  if v_ctx.staff_id is null then
    return query select false, false, 'NO_STAFF_RECORD',
      'This account has no row in the staff directory, so there is no person to record as '
      || 'having carried this out. Recording it against nobody would be a claim with no author.',
      null::public.inventory_actions;
    return;
  end if;

  select * into v_row from public.inventory_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id for update;
  if not found then
    return query select false, false, 'NOT_FOUND', 'No such action on this dealership.', null::public.inventory_actions;
    return;
  end if;

  if v_row.status in ('EXECUTED', 'EXECUTION_FAILED') then
    if v_row.executed_by_staff_id = v_ctx.staff_id and v_row.status = v_want then
      return query select true, true, null::text,
        'Already recorded by you at '
        || to_char(v_row.executed_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI') || ' GST.', v_row;
      return;
    end if;
    return query select false, false, 'ALREADY_EXECUTED',
      'This action was already closed as ' || v_row.status || '.', v_row;
    return;
  end if;

  if v_row.status <> 'APPROVED' then
    return query select false, false, 'NOT_APPROVED',
      'Only an approved action can be executed. This one is ' || v_row.status
      || ', and executing an undecided recommendation is exactly what the approval step exists to stop.', v_row;
    return;
  end if;

  update public.inventory_actions a set
    status               = v_want,
    executed_at          = now(),
    executed_by_staff_id = v_ctx.staff_id,
    execution_note       = nullif(btrim(coalesce(p_note, '')), ''),
    execution_failure    = case when p_failed then nullif(btrim(coalesce(p_failure, '')), '') end,
    outcome_state        = case when p_failed then 'CLOSED_WITHOUT_ACTION' else 'AWAITING_OUTCOME' end
  where a.id = v_row.id
  returning * into v_row;

  if p_failed then
    v_sent := 'Execution attempted by ' || coalesce(v_ctx.staff_name, 'a staff member')
      || ' and it was not carried out: ' || coalesce(v_row.execution_failure, 'no reason recorded') || '.';
    v_audit := public.action_write_audit(v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'FAILED', v_sent);
    insert into public.inventory_action_events
      (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
    values (v_ctx.tenant_id, v_row.id, 'EXECUTION_FAILED', v_ctx.staff_id, v_ctx.auth_user_id, v_ctx.authority, v_sent, v_audit);
  else
    v_sent := 'Carried out by ' || coalesce(v_ctx.staff_name, 'a staff member')
      || coalesce('. ' || v_row.execution_note, '')
      || ' No money has been recovered by this: execution is an act, not an outcome. '
      || 'Nothing may be attributed to it until a real sale is recorded and a person ties the two together.';
    v_audit := public.action_write_audit(v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'SUCCESS', v_sent);
    insert into public.inventory_action_events
      (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
    values (v_ctx.tenant_id, v_row.id, 'EXECUTED', v_ctx.staff_id, v_ctx.auth_user_id, v_ctx.authority, v_sent, v_audit);
  end if;

  return query select true, false, null::text, null::text, v_row;
end;
$fn$;

comment on function public.action_mark_executed(uuid, text, boolean, text) is
  'Record that an approved action was carried out, or that it was attempted and did not '
  'happen. Writes no money figure of any kind: execution moves the action to '
  'AWAITING_OUTCOME, never to a recovered value. A failed execution writes an audit row '
  'with status FAILED, which nexus_outcome_class classifies FAILURE.';

revoke all on function public.action_mark_executed(uuid, text, boolean, text) from public;
grant execute on function public.action_mark_executed(uuid, text, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Candidate sales for an executed action. Offers; never links.
-- ---------------------------------------------------------------------------
create or replace function public.action_outcome_candidates(p_action_id uuid)
returns table (
  purchase_id    uuid,
  vehicle        text,
  customer_name  text,
  amount_aed     integer,
  purchase_date  date,
  link_evidence  text,
  shared_tokens  integer,
  evidence_note  text
)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_ctx  record;
  v_row  public.inventory_actions;
  v_unit public.inventory%rowtype;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then return; end if;

  select * into v_row from public.inventory_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id;
  if not found then return; end if;

  select i.* into v_unit from public.inventory i
   where i.tenant_id = v_ctx.tenant_id and i.id = v_row.unit_id;

  return query
  select ph.id, ph.vehicle, ph.customer_name, ph.amount_aed, ph.purchase_date,
         'MODEL_TEXT_ONLY'::text,
         cardinality(array(select unnest(public.nexus_model_tokens(v_unit.model))
                           intersect
                           select unnest(public.nexus_model_tokens(ph.vehicle))))::integer,
         'purchase_history has no column referencing an inventory unit, so this is a text '
         || 'comparison between the free-text vehicle description on the sale and the model '
         || 'name on the unit. It is a prompt for a person, not evidence. Confirming it '
         || 'records HUMAN_CONFIRMED_LINK against your name.'
    from public.purchase_history ph
   where ph.tenant_id = v_ctx.tenant_id
     and (v_row.executed_at is null or ph.purchase_date >= (v_row.executed_at at time zone 'Asia/Dubai')::date)
     and cardinality(array(select unnest(public.nexus_model_tokens(v_unit.model))
                           intersect
                           select unnest(public.nexus_model_tokens(ph.vehicle)))) >= 2
   order by ph.purchase_date desc;
end;
$fn$;

comment on function public.action_outcome_candidates(uuid) is
  'Sales a person might be looking at when attributing an outcome to this action. Every row '
  'comes back labelled MODEL_TEXT_ONLY because that is all the evidence that exists: '
  'purchase_history carries no reference to an inventory unit. Reuses the same '
  'nexus_model_tokens matcher the Inventory screen already uses, and the same two-shared-'
  'token floor. It never links anything.';

revoke all on function public.action_outcome_candidates(uuid) from public;
grant execute on function public.action_outcome_candidates(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Attribute an outcome. The only writer of recovered_value_aed.
-- ---------------------------------------------------------------------------
create or replace function public.action_record_outcome(
  p_action_id   uuid,
  p_purchase_id uuid,
  p_note        text
)
returns table (
  ok             boolean,
  idempotent     boolean,
  refusal_code   text,
  refusal_reason text,
  action         public.inventory_actions
)
language plpgsql security definer set search_path = public as $fn$
declare
  v_ctx   record;
  v_row   public.inventory_actions;
  v_ph    public.purchase_history%rowtype;
  v_unit  public.inventory%rowtype;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_rec   integer;
  v_basis text;
  v_audit uuid;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, null::public.inventory_actions;
    return;
  end if;
  -- Attributing money is a commercial statement, so it needs the same authority
  -- as approving the action in the first place.
  if not v_ctx.may_decide then
    return query select false, false, v_ctx.refusal_code,
      'Attributing money to an action is a commercial statement and needs approval authority. '
      || v_ctx.refusal_reason, null::public.inventory_actions;
    return;
  end if;
  if v_note is null or length(v_note) < 3 then
    return query select false, false, 'NOTE_REQUIRED',
      'Say how you know this sale belongs to this action. The database cannot know it, so '
      || 'your sentence is the whole of the evidence.', null::public.inventory_actions;
    return;
  end if;

  select * into v_row from public.inventory_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id for update;
  if not found then
    return query select false, false, 'NOT_FOUND', 'No such action on this dealership.', null::public.inventory_actions;
    return;
  end if;
  if v_row.outcome_state = 'ATTRIBUTED' then
    if v_row.outcome_purchase_id = p_purchase_id then
      return query select true, true, null::text, 'This sale is already attributed to this action.', v_row;
    else
      return query select false, false, 'ALREADY_ATTRIBUTED',
        'A different sale is already attributed to this action. One action, one outcome.', v_row;
    end if;
    return;
  end if;
  if v_row.status <> 'EXECUTED' then
    return query select false, false, 'NOT_EXECUTED',
      'An outcome can only follow an action that was actually carried out. This one is '
      || v_row.status || '.', v_row;
    return;
  end if;

  select * into v_ph from public.purchase_history ph
   where ph.id = p_purchase_id and ph.tenant_id = v_ctx.tenant_id;
  if not found then
    return query select false, false, 'SALE_NOT_FOUND',
      'No recorded sale with that id on this dealership.', v_row;
    return;
  end if;
  -- An outcome cannot precede the action that is claimed to have produced it.
  if v_ph.purchase_date is null
     or v_ph.purchase_date < (v_row.executed_at at time zone 'Asia/Dubai')::date then
    return query select false, false, 'SALE_PREDATES_ACTION',
      'That sale is dated ' || coalesce(v_ph.purchase_date::text, 'nowhere at all')
      || ' and the action was carried out on '
      || to_char(v_row.executed_at at time zone 'Asia/Dubai', 'YYYY-MM-DD')
      || '. A sale that happened first cannot be an outcome of it.', v_row;
    return;
  end if;

  select * into v_unit from public.inventory i
   where i.tenant_id = v_ctx.tenant_id and i.id = v_row.unit_id;

  if v_ph.amount_aed is null or v_unit.cost_aed is null then
    -- Attributed, but not quantifiable. The link is real; the arithmetic has a
    -- missing input, and a missing input is not a zero.
    v_rec   := null;
    v_basis := null;
  else
    v_rec := v_ph.amount_aed - v_unit.cost_aed;
    v_basis := 'Realised gross margin on the linked sale: purchase_history '
      || p_purchase_id::text || '.amount_aed (AED ' || to_char(v_ph.amount_aed, 'FM999,999,999')
      || ') minus inventory ' || v_row.unit_id || '.cost_aed (AED '
      || to_char(v_unit.cost_aed, 'FM999,999,999') || ') = AED ' || to_char(v_rec, 'FM999,999,999')
      || '. Both figures are recorded, neither is estimated. This is ATTRIBUTED, not a claim '
      || 'that the action caused the sale - NEXUS has no evidence of causation and does not assert any.';
  end if;

  update public.inventory_actions a set
    outcome_state       = 'ATTRIBUTED',
    outcome_purchase_id = p_purchase_id,
    outcome_recorded_at = now(),
    outcome_recorded_by_staff_id = v_ctx.staff_id,
    attribution_basis   = 'HUMAN_CONFIRMED_LINK',
    attribution_note    = v_note,
    recovered_value_aed = v_rec,
    recovered_value_basis = v_basis
  where a.id = v_row.id
  returning * into v_row;

  v_audit := public.action_write_audit(
    v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'SUCCESS',
    'Outcome attributed by ' || coalesce(v_ctx.staff_name, 'an approver') || ' to sale '
    || p_purchase_id::text || ' (' || coalesce(v_ph.vehicle, 'no vehicle text') || ', '
    || coalesce('AED ' || to_char(v_ph.amount_aed, 'FM999,999,999'), 'amount not recorded') || ', '
    || coalesce(v_ph.purchase_date::text, 'no date') || '). '
    || coalesce(v_basis, 'Realised margin is NOT COMPUTABLE: '
        || case when v_ph.amount_aed is null then 'the sale has no amount recorded. ' else '' end
        || case when v_unit.cost_aed is null then 'the unit has no acquisition cost recorded. ' else '' end
        || 'The link is recorded; the figure is not invented.')
    || ' Stated basis: ' || v_note);

  insert into public.inventory_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, 'OUTCOME_ATTRIBUTED', v_ctx.staff_id, v_ctx.auth_user_id,
          v_ctx.authority, v_note, v_audit);

  return query select true, false, null::text, null::text, v_row;
end;
$fn$;

comment on function public.action_record_outcome(uuid, uuid, text) is
  'THE ONLY WRITER of inventory_actions.recovered_value_aed. Requires an executed action, a '
  'real purchase_history row on the same dealership, a sale date on or after the execution, '
  'approval authority, and a sentence from the person saying how they know the two belong '
  'together. Where amount or cost is missing the link is still recorded and the figure stays '
  'null with the missing input named - a missing input is not a zero. It attributes; it does '
  'not claim the action caused the sale.';

revoke all on function public.action_record_outcome(uuid, uuid, text) from public;
grant execute on function public.action_record_outcome(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Close an executed action with no attributable outcome, honestly.
-- ---------------------------------------------------------------------------
create or replace function public.action_mark_not_attributable(p_action_id uuid, p_note text)
returns table (
  ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action public.inventory_actions
)
language plpgsql security definer set search_path = public as $fn$
declare
  v_ctx record; v_row public.inventory_actions; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_audit uuid;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, null::public.inventory_actions; return;
  end if;
  if not v_ctx.may_decide then
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, null::public.inventory_actions; return;
  end if;
  if v_note is null then
    return query select false, false, 'NOTE_REQUIRED',
      'Say what is missing. "No outcome" with no explanation is the sentence this product exists to stop.',
      null::public.inventory_actions; return;
  end if;
  select * into v_row from public.inventory_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id for update;
  if not found then
    return query select false, false, 'NOT_FOUND', 'No such action on this dealership.', null::public.inventory_actions; return;
  end if;
  if v_row.outcome_state = 'NOT_ATTRIBUTABLE' then
    return query select true, true, null::text, 'Already closed as not attributable.', v_row; return;
  end if;
  if v_row.status <> 'EXECUTED' or v_row.outcome_state = 'ATTRIBUTED' then
    return query select false, false, 'NOT_APPLICABLE',
      'This only applies to an executed action that has no outcome attributed to it.', v_row; return;
  end if;
  update public.inventory_actions a
     set outcome_state = 'NOT_ATTRIBUTABLE', outcome_recorded_at = now(),
         outcome_recorded_by_staff_id = v_ctx.staff_id, attribution_note = v_note
   where a.id = v_row.id returning * into v_row;
  v_audit := public.action_write_audit(v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'SUCCESS',
    'Closed with no attributable outcome by ' || coalesce(v_ctx.staff_name, 'an approver')
    || '. ' || v_note || ' No recovered value is recorded and none is implied.');
  insert into public.inventory_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, 'OUTCOME_NOT_ATTRIBUTABLE', v_ctx.staff_id, v_ctx.auth_user_id, v_ctx.authority, v_note, v_audit);
  return query select true, false, null::text, null::text, v_row;
end;
$fn$;

comment on function public.action_mark_not_attributable(uuid, text) is
  'Close an executed action by saying, on the record, that the evidence to attribute an '
  'outcome to it does not exist. Writes no money figure. This is the honest end state for '
  'most actions on this database today, because purchase_history cannot name a unit.';

revoke all on function public.action_mark_not_attributable(uuid, text) from public;
grant execute on function public.action_mark_not_attributable(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
create or replace function public.action_cancel(p_action_id uuid, p_note text)
returns table (
  ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action public.inventory_actions
)
language plpgsql security definer set search_path = public as $fn$
declare
  v_ctx record; v_row public.inventory_actions; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_audit uuid;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, null::public.inventory_actions; return;
  end if;
  if not v_ctx.may_decide then
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, null::public.inventory_actions; return;
  end if;
  if v_note is null then
    return query select false, false, 'NOTE_REQUIRED', 'Say why this action is being withdrawn.', null::public.inventory_actions; return;
  end if;
  select * into v_row from public.inventory_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id for update;
  if not found then
    return query select false, false, 'NOT_FOUND', 'No such action on this dealership.', null::public.inventory_actions; return;
  end if;
  if v_row.status = 'CANCELLED' then
    return query select true, true, null::text, 'Already cancelled.', v_row; return;
  end if;
  if v_row.status not in ('PROPOSED', 'APPROVED', 'DEFERRED') then
    return query select false, false, 'NOT_LIVE',
      'Only a live action can be withdrawn. This one is ' || v_row.status || '.', v_row; return;
  end if;
  update public.inventory_actions a
     set status = 'CANCELLED', decided_at = coalesce(a.decided_at, now()),
         decided_by_staff_id = coalesce(a.decided_by_staff_id, v_ctx.staff_id),
         decided_by_auth_id = coalesce(a.decided_by_auth_id, v_ctx.auth_user_id),
         decided_by_authority = coalesce(a.decided_by_authority, v_ctx.authority),
         decision_note = v_note, outcome_state = 'CLOSED_WITHOUT_ACTION'
   where a.id = v_row.id returning * into v_row;
  v_audit := public.action_write_audit(v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'SUCCESS',
    'Withdrawn by ' || coalesce(v_ctx.staff_name, 'an approver') || ' before execution. ' || v_note);
  insert into public.inventory_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, 'CANCELLED', v_ctx.staff_id, v_ctx.auth_user_id, v_ctx.authority, v_note, v_audit);
  return query select true, false, null::text, null::text, v_row;
end;
$fn$;

comment on function public.action_cancel(uuid, text) is
  'Withdraw a live action before execution, with a reason. Frees the unit for a fresh '
  'proposal once the cooldown passes.';

revoke all on function public.action_cancel(uuid, text) from public;
grant execute on function public.action_cancel(uuid, text) to authenticated, service_role;