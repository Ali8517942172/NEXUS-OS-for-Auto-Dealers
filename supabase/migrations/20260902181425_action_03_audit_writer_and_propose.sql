-- ===========================================================================
-- action_03_audit_writer_and_propose
--
-- BUSINESS RULE (INV-001): this system has ONE vocabulary for what a run did,
-- and it is public.nexus_outcome_class(workflow, status, summary), mirrored in
-- the browser by apps/executive-dashboard/lib/health.js. The Action Center
-- reuses it and does not extend it. The mapping, and the reasoning behind it:
--
--   A DECISION IS CONTENT, NOT AN OUTCOME.
--   "The manager rejected this recommendation" is what was decided. Whether
--   the system managed to RECORD that decision is a different question, and it
--   is the only question audit_log has ever answered. So a recorded rejection
--   writes status SUCCESS - the recording worked - and the rejection itself,
--   with its reason code, lives in inventory_actions where it can be counted.
--   Mapping "manager said no" onto REJECTED_EXPECTED would have made the
--   outcome vocabulary do double duty as a business-decision language, which
--   is the exact mistake this codebase has made repeatedly.
--
--   The classes that DO fit, and fit exactly:
--     SUCCESS            a state change was recorded (propose, approve,
--                        reject, defer, execute, cancel, attribute an outcome)
--     REJECTED_EXPECTED  somebody who may not approve tried to. The summary
--                        carries the words "not permitted", which is what
--                        nexus_outcome_class already reads as refused-by-design.
--                        health.js: "Refused by design. Not counted against the
--                        workflow." That is precisely right for an authorisation
--                        refusal and precisely wrong for a manager's no.
--     ESCALATED          nobody at this dealership holds an approving role, so
--                        the action was handed to a person on purpose.
--                        health.js: "Handed to a person on purpose."
--     FAILURE            an approved action was attempted in the real world and
--                        did not happen.
--
--   Nothing here writes PARTIAL or NO_RESULT, and no summary written by these
--   functions contains the phrase "did not land" - that phrase is rule 1 of
--   nexus_outcome_class and reclassifies a row to PARTIAL.
--
--   The workflow name 'Inventory Action Center' is deliberately NOT registered
--   in public.workflow_registry: these are not n8n runs, and v_workflow_health
--   only aggregates registered workflows, so the Automation screen's health
--   figures are untouched by anything below.
-- ===========================================================================

create or replace function public.action_write_audit(
  p_tenant    uuid,
  p_action_id uuid,
  p_unit_id   text,
  p_rec       text,
  p_status    text,
  p_summary   text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('Inventory Action Center', p_status,
          'Inventory action ' || coalesce(p_action_id::text, '(none)')
          || ' · unit ' || coalesce(p_unit_id, '(none)')
          || ' · ' || coalesce(p_rec, '(none)')
          || ' · ' || coalesce(p_summary, ''),
          p_tenant)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.action_write_audit(uuid, uuid, text, text, text, text) is
  'The only writer of Action Center audit rows. Status must be one of the words '
  'nexus_outcome_class already understands - see the header of migration '
  'action_03_audit_writer_and_propose for the mapping and why a manager''s rejection is a '
  'SUCCESS row. Not callable by authenticated: audit rows are written as a side effect of '
  'the action_* functions, never on request.';

revoke all on function public.action_write_audit(uuid, uuid, text, text, text, text) from public;
grant execute on function public.action_write_audit(uuid, uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- action_propose(unit)
--
-- IDEMPOTENCY AND CONCURRENCY. Two things guard this, on purpose:
--
--   1. inventory_actions_one_live_per_unit, a partial unique index. It is the
--      hard guarantee and it holds against every writer, including service_role
--      and a psql session. This codebase has already shipped a
--      "Prefer: ignore-duplicates" header on a plain insert, which does nothing
--      whatsoever without a unique constraint to conflict with; the constraint
--      is the part that was missing then and is present now.
--
--   2. pg_advisory_xact_lock on (tenant, unit) at the top of this function, so
--      that two concurrent proposals SERIALISE rather than one of them raising
--      a unique-violation error at the user. The second one waits, sees the row
--      the first one made, and returns it with idempotent = true. Same record,
--      no error, no duplicate.
--
-- It returns ok = false rather than raising for every business refusal, because
-- a raised exception rolls back the transaction and takes the audit row with
-- it. A refusal that leaves no trace is not an audit.
-- ---------------------------------------------------------------------------
create or replace function public.action_propose(p_unit_id text)
returns table (
  ok             boolean,
  idempotent     boolean,
  refusal_code   text,
  refusal_reason text,
  action         public.inventory_actions
)
language plpgsql security definer set search_path = public as $$
declare
  v_ctx    record;
  v_unit   text := btrim(coalesce(p_unit_id, ''));
  v_eng    record;
  v_row    public.inventory_actions;
  v_prior  public.inventory_actions;
  v_pol    public.inventory_action_policy%rowtype;
  v_audit  uuid;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, null::public.inventory_actions;
    return;
  end if;
  if v_unit = '' then
    return query select false, false, 'NO_UNIT', 'No unit id was supplied.', null::public.inventory_actions;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_ctx.tenant_id::text || '|' || v_unit, 0));

  -- The engine, read for THIS tenant only.
  -- v_inventory_profit_sentinel is security_invoker, which means it evaluates
  -- RLS as the calling role - and inside this SECURITY DEFINER function the
  -- calling role is the function owner, which bypasses RLS. The explicit
  -- tenant_id predicate below is therefore load-bearing security, not a
  -- tidy-up: without it this function would happily read another dealership's
  -- lot. This is the exact shape of the five SECURITY DEFINER cross-tenant
  -- bypasses that were scoped on 2 Sep 2026.
  select * into v_eng
    from public.v_inventory_profit_sentinel v
   where v.tenant_id = v_ctx.tenant_id and v.id = v_unit;
  if not found then
    return query select false, false, 'UNIT_NOT_FOUND',
      'No unit with that id on this dealership''s lot.', null::public.inventory_actions;
    return;
  end if;
  if upper(coalesce(v_eng.recommendation, '')) in ('', 'HOLD') then
    return query select false, false, 'NOTHING_RECOMMENDED',
      'The engine recommends HOLD for this unit, which is it saying there is nothing to do. '
      || 'An action is not raised against a recommendation the engine did not make.',
      null::public.inventory_actions;
    return;
  end if;

  -- Already live? Return it. This is the double-click answer.
  select * into v_row from public.inventory_actions a
   where a.tenant_id = v_ctx.tenant_id and a.unit_id = v_unit
     and a.status in ('PROPOSED', 'APPROVED', 'DEFERRED')
   limit 1;
  if found then
    return query select true, true, null::text,
      'An action for this unit is already open, so this did not create a second one.', v_row;
    return;
  end if;

  -- Recently decided? Do not push a rejected recommendation back at the same
  -- person the next morning. Return the decision they already made.
  select * into v_pol from public.inventory_action_policy where tenant_id = v_ctx.tenant_id;
  if found and v_pol.reproposal_cooldown_days > 0 then
    select * into v_prior from public.inventory_actions a
     where a.tenant_id = v_ctx.tenant_id and a.unit_id = v_unit
       and a.recommendation = upper(v_eng.recommendation)
       and a.status in ('REJECTED', 'CANCELLED')
       and a.decided_at is not null
       and a.decided_at > now() - make_interval(days => v_pol.reproposal_cooldown_days)
     order by a.decided_at desc limit 1;
    if found then
      return query select false, false, 'SUPPRESSED_BY_RECENT_DECISION',
        'This recommendation was already decided on '
        || to_char(v_prior.decided_at at time zone 'Asia/Dubai', 'DD Mon YYYY')
        || ' (' || v_prior.status || ', ' || coalesce(v_prior.decision_reason_code, 'no code')
        || ') and this dealership''s cooldown is ' || v_pol.reproposal_cooldown_days
        || ' days. Raising it again would ignore that answer.', v_prior;
      return;
    end if;
  end if;

  insert into public.inventory_actions (
    tenant_id, unit_id, recommendation,
    engine_reason, engine_confidence, engine_confidence_basis,
    engine_impact_aed, engine_impact_kind, engine_impact_basis,
    engine_overall_risk, engine_days_in_stock, engine_gross_margin_aed,
    engine_owner_role, engine_evidence, engine_computed_at,
    proposed_by_staff_id, outcome_state)
  values (
    v_ctx.tenant_id, v_unit, upper(v_eng.recommendation),
    v_eng.reason, v_eng.confidence, v_eng.confidence_basis,
    v_eng.impact_aed, v_eng.impact_kind, v_eng.impact_basis,
    v_eng.overall_risk, v_eng.days_in_stock, v_eng.gross_margin_aed,
    v_eng.suggested_owner_role, v_eng.evidence, v_eng.computed_at,
    v_ctx.staff_id, 'NONE_YET')
  returning * into v_row;

  v_audit := public.action_write_audit(
    v_ctx.tenant_id, v_row.id, v_unit, v_row.recommendation, 'SUCCESS',
    'Proposed from the engine by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
    || '. Exposure at proposal: '
    || case when v_row.engine_impact_aed is null then 'none claimed'
            else 'AED ' || to_char(v_row.engine_impact_aed, 'FM999,999,999') end
    || ' (' || coalesce(v_row.engine_impact_kind, 'not stated') || '). Awaiting a decision.');

  insert into public.inventory_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, 'PROPOSED', v_ctx.staff_id, v_ctx.auth_user_id,
          'Raised from the engine queue. ' || coalesce(v_row.engine_reason, ''), v_audit);

  return query select true, false, null::text, null::text, v_row;
end;
$$;

comment on function public.action_propose(text) is
  'Turn a live engine recommendation into a proposed action for one unit. Idempotent: an '
  'advisory lock serialises concurrent callers and the partial unique index '
  'inventory_actions_one_live_per_unit is the hard guarantee behind it, so a double-click '
  'produces one record and no error. Refuses HOLD (the engine saying there is nothing to '
  'do) and refuses to re-raise a recommendation the dealership rejected inside its own '
  'cooldown. Business refusals return ok = false rather than raising, so the audit row '
  'survives.';

revoke all on function public.action_propose(text) from public;
grant execute on function public.action_propose(text) to authenticated, service_role;