-- LEAD RECOVERY ENGINE — 02: where a recovery action lives.
--
-- WHY A SEPARATE TABLE AND NOT inventory_actions.
-- inventory_actions.unit_id is NOT NULL and carries
--   FOREIGN KEY (tenant_id, unit_id) REFERENCES inventory(tenant_id, id)
-- so it cannot hold a row whose subject is a lead without dropping that NOT NULL
-- and that foreign key - i.e. without weakening the guarantee that every
-- inventory action points at a real unit on a real lot. That is a strictly worse
-- table for the Action Center's own job, and it is an alteration of an existing
-- table this workstream is not permitted to make. So: BESIDE, not inside.
--
-- Everything else is copied on purpose: the status vocabulary, the
-- decision-stamped / rejection-needs-reason / recovered-needs-real-sale checks,
-- the outcome_state ladder, and the events table. Two desks with one shape read
-- as one product; two desks with two shapes read as two products bolted together.
-- If a subject-polymorphic action table is ever wanted, it is a migration that
-- merges these two - not a third invention.
--
-- NOTE ON THE FOREIGN KEY. leads has no UNIQUE (tenant_id, id) - only the
-- primary key on id - so this table cannot carry a composite FK the way
-- inventory_actions does. Adding that unique constraint would alter leads.
-- Tenant agreement between the action and its lead is therefore enforced in
-- lead_recovery_propose() and re-asserted in every write path, and is checked
-- by v_lead_recovery_coverage.actions_with_wrong_tenant, which must stay 0.

create table public.lead_recovery_actions (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  lead_id               integer not null references public.leads(id) on delete restrict,

  -- what the engine said, frozen at proposal time
  recommendation           text not null,
  engine_state             text,
  engine_reason            text,
  engine_confidence        text,
  engine_confidence_basis  text,
  engine_risk_level        text,
  engine_risk_basis        text,
  engine_evidence          jsonb,
  engine_owner_role        text,
  engine_computed_at       timestamptz,

  -- NO engine_impact_aed. Unlike a unit, a lead carries no number this schema
  -- can measure: budget_aed is null on every lead on file, and nothing links a
  -- lead to a unit. A column here would be filled with a guess within a month.
  opportunity_value_state  text not null default 'UNKNOWN_NO_LINK',
  opportunity_value_basis  text,

  status                text not null default 'PROPOSED',
  proposed_at           timestamptz not null default now(),
  proposed_by_staff_id  uuid references public.users(id) on delete set null,
  proposed_source       text not null default 'ENGINE',

  decided_at            timestamptz,
  decided_by_staff_id   uuid references public.users(id) on delete set null,
  decided_by_auth_id    uuid,
  decided_by_authority  text,
  decision_reason_code  text,
  decision_note         text,
  defer_until           date,

  assigned_to_staff_id  uuid references public.users(id) on delete set null,
  assigned_role         text,
  assigned_at           timestamptz,

  executed_at           timestamptz,
  executed_by_staff_id  uuid references public.users(id) on delete set null,
  execution_note        text,
  execution_failure     text,

  outcome_state           text not null default 'NONE_YET',
  outcome_purchase_id     uuid references public.purchase_history(id) on delete set null,
  outcome_recorded_at     timestamptz,
  outcome_recorded_by_staff_id uuid references public.users(id) on delete set null,
  attribution_basis       text,
  attribution_note        text,
  recovered_value_aed     integer,
  recovered_value_basis   text,

  escalated_at          timestamptz,
  escalation_reason     text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint lead_recovery_actions_recommendation_check
    check (recommendation in ('FOLLOW_UP','ESCALATE','ASSIGN_OWNER','MANAGER_REVIEW')),
  constraint lead_recovery_actions_status_check
    check (status in ('PROPOSED','APPROVED','REJECTED','DEFERRED','EXECUTED','EXECUTION_FAILED','CANCELLED')),
  constraint lead_recovery_actions_outcome_state_check
    check (outcome_state in ('NONE_YET','AWAITING_OUTCOME','ATTRIBUTED','NOT_ATTRIBUTABLE','CLOSED_WITHOUT_ACTION')),
  constraint lead_recovery_actions_opportunity_state_check
    check (opportunity_value_state in ('UNKNOWN_NO_LINK','UNKNOWN_NOT_RECORDED')),
  constraint lead_recovery_actions_decision_stamped
    check (status not in ('APPROVED','REJECTED','DEFERRED')
           or (decided_at is not null and decided_by_authority is not null)),
  constraint lead_recovery_actions_rejection_needs_reason
    check (status <> 'REJECTED'
           or (decision_reason_code is not null and length(btrim(coalesce(decision_note,''))) >= 3)),
  constraint lead_recovery_actions_deferral_needs_reason
    check (status <> 'DEFERRED' or decision_reason_code is not null),
  constraint lead_recovery_actions_execution_stamped
    check ((executed_at is null) = (status not in ('EXECUTED','EXECUTION_FAILED'))),
  -- The rule the whole product turns on. "Recovered" needs a real sale row, a
  -- stated basis, and an ATTRIBUTED outcome. A recommendation is not a recovery
  -- and an approval is not a recovery.
  constraint lead_recovery_actions_recovered_needs_real_sale
    check (recovered_value_aed is null
           or (outcome_state = 'ATTRIBUTED' and outcome_purchase_id is not null
               and attribution_basis is not null and recovered_value_basis is not null))
);

comment on table public.lead_recovery_actions is
  'Proposed / decided / executed actions on a LEAD, beside inventory_actions rather '
  'than inside it because inventory_actions.unit_id is NOT NULL with a composite FK '
  'to inventory. Same lifecycle, same constraints, same audit discipline. Carries no '
  'monetary impact column on purpose: nothing in this schema measures what a lead is worth.';

create index lead_recovery_actions_live_idx
  on public.lead_recovery_actions (tenant_id, lead_id)
  where status in ('PROPOSED','APPROVED','DEFERRED');
create index lead_recovery_actions_tenant_status_idx
  on public.lead_recovery_actions (tenant_id, status);

create table public.lead_recovery_action_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete restrict,
  action_id        uuid not null references public.lead_recovery_actions(id) on delete cascade,
  at               timestamptz not null default now(),
  event            text not null,
  actor_staff_id   uuid references public.users(id) on delete set null,
  actor_auth_id    uuid,
  actor_authority  text,
  detail           text,
  audit_log_id     uuid
);
create index lead_recovery_action_events_action_idx
  on public.lead_recovery_action_events (action_id, at);

comment on table public.lead_recovery_action_events is
  'Append-only timeline for lead_recovery_actions, mirroring inventory_action_events. '
  'audit_log_id links each event to the audit_log row it produced; an event with a null '
  'audit_log_id means the trail is broken and v_lead_recovery_health reports it.';

-- Reason codes. inventory_action_reason_codes is not reused because its ten codes
-- are all about a unit (PRICE_IS_CORRECT, DAYS_IN_STOCK_WRONG, UNIT_NOT_AVAILABLE);
-- forcing a lead rejection through them would produce meaningless statistics about
-- which recommendations were wrong, which is the only thing the codes are for.
create table public.lead_recovery_reason_codes (
  code             text primary key,
  applies_to       text[] not null,
  label            text not null,
  meaning          text not null,
  engine_was_wrong boolean not null,
  sort             integer not null default 100
);

insert into public.lead_recovery_reason_codes (code, applies_to, label, meaning, engine_was_wrong, sort) values
 ('NOT_A_REAL_ENQUIRY', array['REJECT'], 'Not a real car enquiry',
  'This lead is not a customer looking for a vehicle - a wrong number, a supplier, a bot, '
  'or a row the intake wiring created from something that was never an enquiry. The engine '
  'read the conversation correctly and the lead itself should never have existed.', true, 10),
 ('ALREADY_CONTACTED', array['REJECT'], 'Already contacted outside NEXUS',
  'Somebody called, messaged or met this person through a channel NEXUS cannot see, so the '
  'silence NEXUS measured is not real silence. NEXUS was wrong because it was blind, not '
  'because the rule is wrong.', true, 20),
 ('CUSTOMER_ASKED_FOR_SPACE', array['REJECT','DEFER'], 'Customer asked not to be chased',
  'The customer said they would come back to us. Chasing them is the wrong action even '
  'though the silence is real.', false, 30),
 ('WRONG_OWNER', array['REJECT','DEFER'], 'Wrong person is being asked to act',
  'The recommendation is right but it has been put in front of the wrong desk.', false, 40),
 ('LEAD_IS_DEAD', array['REJECT'], 'Lead is genuinely dead',
  'The person has bought elsewhere or is no longer in the market. The lead should be closed, '
  'not recovered.', false, 50),
 ('NO_CAPACITY_NOW', array['DEFER'], 'No capacity to act now',
  'The action is right and nobody is free to take it yet. Deferring records that as a capacity '
  'problem rather than losing it as a rejection.', false, 60),
 ('WAITING_ON_STOCK', array['DEFER'], 'Waiting on a vehicle',
  'There is nothing worth saying to this customer until a suitable unit is on the lot.', false, 70),
 ('EVIDENCE_INSUFFICIENT', array['REJECT','DEFER'], 'Not enough evidence to act',
  'The engine reached this state on partial data - an unresolved WhatsApp handle, a stale '
  'silence detector, an unmeasured response time - and the reader will not act on it.', true, 80),
 ('OTHER', array['REJECT','DEFER'], 'Something else',
  'None of the above. The note is the whole record, so it has to say enough to be counted later.', false, 999);

alter table public.lead_recovery_actions        enable row level security;
alter table public.lead_recovery_action_events  enable row level security;
alter table public.lead_recovery_reason_codes   enable row level security;

create policy lead_recovery_actions_authenticated_read
  on public.lead_recovery_actions for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));
create policy lead_recovery_actions_deny_anon
  on public.lead_recovery_actions as restrictive for all to anon using (false) with check (false);
create policy lead_recovery_actions_service_role_all
  on public.lead_recovery_actions for all to service_role using (true) with check (true);

create policy lead_recovery_action_events_authenticated_read
  on public.lead_recovery_action_events for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));
create policy lead_recovery_action_events_deny_anon
  on public.lead_recovery_action_events as restrictive for all to anon using (false) with check (false);
create policy lead_recovery_action_events_service_role_all
  on public.lead_recovery_action_events for all to service_role using (true) with check (true);

create policy lead_recovery_reason_codes_authenticated_read
  on public.lead_recovery_reason_codes for select to authenticated using (true);
create policy lead_recovery_reason_codes_deny_anon
  on public.lead_recovery_reason_codes as restrictive for all to anon using (false) with check (false);
create policy lead_recovery_reason_codes_service_role_all
  on public.lead_recovery_reason_codes for all to service_role using (true) with check (true);

-- The browser reads; only the SECURITY DEFINER functions write. An authenticated
-- session that could UPDATE lead_recovery_actions directly could stamp itself as
-- the approver of its own proposal.
revoke all on public.lead_recovery_actions       from anon, public;
revoke all on public.lead_recovery_action_events from anon, public;
revoke all on public.lead_recovery_reason_codes  from anon, public;
grant select on public.lead_recovery_actions       to authenticated;
grant select on public.lead_recovery_action_events to authenticated;
grant select on public.lead_recovery_reason_codes  to authenticated;
grant all    on public.lead_recovery_actions       to service_role;
grant all    on public.lead_recovery_action_events to service_role;
grant all    on public.lead_recovery_reason_codes  to service_role;