/* ═══════════════════════════════════════════════════════════════════════════
   P0-3 · The Action Center writes audit rows that no health surface reads.

   THE DECISION, AND WHY IT IS NOT "INSERT A REGISTRY ROW"

   `audit_log` holds rows under the workflow name `Inventory Action Center`.
   `workflow_registry` has no row for it and `v_workflow_health` is
   registry-driven, so an Action Center that stopped working would report
   nothing anywhere. The gap is real. Registering it is still the wrong fix,
   for three reasons that survive re-reading:

     1. `workflow_registry.id` IS the n8n workflow id — every one of its rows is
        keyed by a real id on the box (G7FhvMY2ucW5Fg7X, JnlZFAVmFAuNXVya …).
        The Action Center has no n8n workflow and never will: it is a set of
        SECURITY DEFINER functions a person calls from a dashboard. Inventing an
        id to make a check pass would put the first fabricated row into a table
        whose entire worth is that it mirrors what is actually deployed.

     2. `v_workflow_health` would then be actively wrong rather than merely
        silent. Its vocabulary — runs, failure rate, NEVER_RAN,
        PRODUCING_NOTHING, last_run — presumes a machine that fires on its own
        schedule. The Action Center produces a row only when a human chooses to
        act. Worse, its FAILED rows mean the opposite of an automation failure:
        `action_mark_executed(p_failed => true)` writes FAILED when a person
        tried to reprice a car and could not. Folding that into automation
        health would mark NEXUS DEGRADED and tell an owner the software is
        broken at the exact moment the software worked and the world said no.
        The audit row already on this database — "A REJECT arrived for an action
        already approved … the first decision stands" — is a correct refusal by
        a correct control, and it would land in a failure rate.

     3. Running the two through one number makes both mean less. Automation
        health answers "is the box still running?". The Action Center answers
        "are the people deciding, and is what they decide actually happening?".
        An owner needs both answers and needs to be able to tell them apart.

   So: `workflow_registry` is left alone, and the Action Center gets its own
   surface, in its own vocabulary, below. `Example Workflow` is left unregistered
   too, and for a stronger reason — it is not a NEXUS workflow at all. Its single
   audit row is n8n's own demo error payload ("Example Error Message · Failed at
   node: Node With Error · Execution 231 · …/workflow/1/231") caught by the NEXUS
   Error Handler. Registering it would assert a workflow exists that does not.

   The gap that DOES need closing generally is that an audit writer nobody
   registered is invisible. That is closed by naming the unmatched writers
   instead of by inventing rows for them — see v_audit_unregistered_writers.
   ═══════════════════════════════════════════════════════════════════════════ */

create or replace view public.v_action_center_health
with (security_invoker = true) as
select
  a.tenant_id,

  count(*)                                                          as actions_total,
  count(*) filter (where a.status = 'PROPOSED')                     as awaiting_decision,
  count(*) filter (where a.status = 'PROPOSED' and a.escalated_at is not null)
                                                                    as escalated_no_approver,
  count(*) filter (where a.status = 'APPROVED' and a.executed_at is null)
                                                                    as approved_not_executed,
  count(*) filter (where a.status = 'EXECUTED')                     as executed,
  count(*) filter (where a.status = 'EXECUTION_FAILED')             as execution_failed,
  count(*) filter (where a.status = 'REJECTED')                     as rejected,
  count(*) filter (where a.status = 'DEFERRED')                     as deferred,
  count(*) filter (where a.status = 'CANCELLED')                    as cancelled,
  count(*) filter (where a.outcome_state = 'ATTRIBUTED')            as outcomes_attributed,
  count(*) filter (where a.outcome_state = 'NOT_ATTRIBUTABLE')      as outcomes_not_attributable,
  count(*) filter (where a.status = 'EXECUTED' and a.outcome_state = 'AWAITING_OUTCOME')
                                                                    as executed_awaiting_outcome,

  /* Exposure the engine claimed on everything still undecided. Frozen at
     proposal time, never recomputed here, and it is AT RISK — not revenue, not
     recovered. Null where the engine claimed nothing, because a claim nobody
     made is not a zero. */
  sum(a.engine_impact_aed) filter (where a.status = 'PROPOSED')     as undecided_exposure_aed,
  count(*) filter (where a.status = 'PROPOSED' and a.engine_impact_aed is null)
                                                                    as undecided_with_no_figure,

  max(a.proposed_at)                                                as last_proposed_at,
  max(a.decided_at)                                                 as last_decided_at,
  max(a.executed_at)                                                as last_executed_at,
  max(greatest(a.proposed_at, coalesce(a.decided_at, a.proposed_at),
               coalesce(a.executed_at, a.proposed_at)))             as last_activity_at,
  (select min(extract(day from now() - x.proposed_at))::integer
     from public.inventory_actions x
    where x.tenant_id = a.tenant_id and x.status = 'PROPOSED')      as newest_undecided_days,
  (select max(extract(day from now() - x.proposed_at))::integer
     from public.inventory_actions x
    where x.tenant_id = a.tenant_id and x.status = 'PROPOSED')      as oldest_undecided_days,

  /* The evidence trail. Every state change writes an inventory_action_events
     row AND an audit_log row, and the event carries the audit row's id. An
     event with no audit_log_id means action_write_audit stopped working, and
     that is the failure this surface exists to make visible. */
  ev.events_total,
  ev.events_without_audit,
  aud.audit_rows,
  aud.audit_rows_30d,
  aud.last_audit_at,

  case
    when count(*) = 0                                    then 'NO_ACTIONS'
    when coalesce(ev.events_without_audit, 0) > 0        then 'AUDIT_TRAIL_BROKEN'
    when coalesce(aud.audit_rows, 0) = 0                 then 'AUDIT_TRAIL_BROKEN'
    when count(*) filter (where a.status = 'EXECUTION_FAILED') > 0 then 'EXECUTIONS_FAILING'
    when count(*) filter (where a.status = 'PROPOSED' and a.escalated_at is not null) > 0
                                                         then 'NOBODY_MAY_APPROVE'
    else 'ACTIVE'
  end                                                               as health

from public.inventory_actions a
left join lateral (
  select count(*)                                        as events_total,
         count(*) filter (where e.audit_log_id is null)  as events_without_audit
    from public.inventory_action_events e
   where e.tenant_id = a.tenant_id) ev on true
left join lateral (
  select count(*)                                                        as audit_rows,
         count(*) filter (where l.logged_at > now() - interval '30 days') as audit_rows_30d,
         max(l.logged_at)                                                as last_audit_at
    from public.audit_log l
   where l.tenant_id = a.tenant_id
     and l.workflow = 'Inventory Action Center') aud on true
group by a.tenant_id, ev.events_total, ev.events_without_audit,
         aud.audit_rows, aud.audit_rows_30d, aud.last_audit_at;

comment on view public.v_action_center_health is
  'Health of the Inventory Action Center, deliberately kept OUT of '
  'v_workflow_health. That view measures n8n automations — is the box running, '
  'is it failing — and is keyed on real n8n workflow ids. The Action Center is '
  'not an automation: it is decisions people take in a dashboard, and its FAILED '
  'rows mean a person could not carry an action out, which is a fact about the '
  'world and not a fault in the software. Running both through one number would '
  'make an owner read "NEXUS is broken" when NEXUS worked and a manager said no. '
  'AUDIT_TRAIL_BROKEN is the state that closes the reported gap: it fires when a '
  'state change was recorded with no audit row behind it, which is the only way '
  'this desk can fail silently.';

comment on column public.v_action_center_health.undecided_exposure_aed is
  'Gross margin the engine said was AT RISK on units nobody has decided yet, '
  'frozen at proposal time. Not revenue, not attributed, not recovered. NULL '
  'when the engine claimed no figure — a claim nobody made is not a zero, and '
  'undecided_with_no_figure counts those rows so the null is readable.';

comment on column public.v_action_center_health.events_without_audit is
  'State changes recorded with no audit_log row behind them. Must be zero. Any '
  'other value means action_write_audit stopped writing and the decision ledger '
  'is no longer evidence.';

/* ── The general gap: an audit writer nobody registered ────────────────────
   Named rather than fabricated. A workflow name that appears in audit_log and
   matches no registry row is either (a) a real workflow somebody deployed and
   forgot to register — which must be fixed on the registry, from the box, with
   its real id — or (b) not a NEXUS workflow at all, like n8n's `Example
   Workflow` demo payload. This view refuses to guess which; it reports the name,
   the volume and the last time it wrote, and a person decides. Inserting a row
   to silence it would be the defect, not the fix. */
create or replace view public.v_audit_unregistered_writers
with (security_invoker = true) as
select l.tenant_id,
       l.workflow                                                     as workflow_written_in_audit_log,
       count(*)                                                       as audit_rows,
       count(*) filter (where l.logged_at > now() - interval '30 days') as audit_rows_30d,
       min(l.logged_at)                                               as first_written_at,
       max(l.logged_at)                                               as last_written_at,
       array_agg(distinct l.status)                                   as statuses_seen,
       case when l.workflow = 'Inventory Action Center'
              then 'Known and deliberate. Human decisions, not an n8n run - see v_action_center_health.'
            else 'Unrecognised writer. Register it from the box with its real n8n id, or establish it is not a NEXUS workflow. Do not invent a registry row.'
       end                                                            as disposition
  from public.audit_log l
 where not exists (
         select 1 from public.workflow_registry r
          where l.workflow = r.name
             or l.workflow = r.audit_name
             or l.workflow = any (r.audit_aliases))
 group by l.tenant_id, l.workflow;

comment on view public.v_audit_unregistered_writers is
  'Workflow names writing to audit_log that workflow_registry does not know. '
  'v_workflow_health is registry-driven, so anything listed here is invisible to '
  'it. The view names the writer instead of registering it: a registry row must '
  'carry a real n8n workflow id, and inventing one to make a check pass would put '
  'the first fabricated row into the table whose only value is that it mirrors '
  'what is actually deployed.';

revoke all on public.v_action_center_health from anon;
revoke all on public.v_audit_unregistered_writers from anon;
grant select on public.v_action_center_health to authenticated, service_role;
grant select on public.v_audit_unregistered_writers to authenticated, service_role;