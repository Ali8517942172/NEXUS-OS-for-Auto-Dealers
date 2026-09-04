-- ===========================================================================
-- action_01_inventory_action_record
--
-- BUSINESS RULE (PRODUCT.md): the product claim is detect -> decide -> act ->
-- measure. Lane A built DETECT (public.v_inventory_profit_sentinel). Nothing
-- recorded what a human DECIDED about a recommendation, whether it was carried
-- out, or what happened afterwards. Without that record the Profit Sentinel is
-- analytics, not an Action Center.
--
-- WHAT THIS TABLE IS
--   One row per proposed action on one inventory unit. It is a DECISION
--   RECORD, not a copy of the engine. The engine is recomputed on every read
--   and owns what is true NOW; this row owns what a named person decided THEN,
--   and freezes the engine's own words at the moment of proposal so the
--   decision can be judged on what the decider actually saw.
--
-- WHAT IT IS NOT
--   It is not a second outcome vocabulary. `status` here is the ACTION's
--   lifecycle (has a human decided? was it carried out?). Whether the recording
--   of that decision succeeded, was refused or was escalated is a different
--   axis and is written to public.audit_log, classified by
--   public.nexus_outcome_class - the one vocabulary this system has. See
--   action_03 for the mapping, which reuses that vocabulary and does not
--   extend it.
--
-- REJECTION IS NOT FAILURE
--   A rejected recommendation is the most valuable row this table will ever
--   hold: it is the only record of the engine being wrong, and it is the only
--   input a future calibration pass will have. That is why decision_reason_code
--   is a closed list and decision_note is mandatory on a rejection - free text
--   alone cannot be counted, and a code alone cannot be understood.
-- ===========================================================================

create table if not exists public.inventory_actions (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete restrict,
  unit_id                 text not null,

  -- The engine's words, frozen at proposal. Copied, not referenced: the view
  -- recomputes off live inventory, so by the time anyone reads this row the
  -- engine may say something different. Judging a decision against a
  -- recommendation the decider never saw is not an audit.
  recommendation          text        not null,
  engine_reason           text,
  engine_confidence       text,
  engine_confidence_basis text,
  engine_impact_aed       integer,
  engine_impact_kind      text,
  engine_impact_basis     text,
  engine_overall_risk     text,
  engine_days_in_stock    integer,
  engine_gross_margin_aed integer,
  engine_owner_role       text,
  engine_evidence         jsonb,
  engine_computed_at      timestamptz,

  status                  text        not null default 'PROPOSED',
  proposed_at             timestamptz not null default now(),
  proposed_by_staff_id    uuid references public.users(id) on delete set null,
  proposed_source         text        not null default 'HUMAN_FROM_ENGINE_QUEUE',

  decided_at              timestamptz,
  decided_by_staff_id     uuid references public.users(id) on delete set null,
  decided_by_auth_id      uuid,
  decided_by_authority    text,
  decision_reason_code    text,
  decision_note           text,
  defer_until             date,

  assigned_to_staff_id    uuid references public.users(id) on delete set null,
  assigned_role           text,
  assigned_at             timestamptz,

  executed_at             timestamptz,
  executed_by_staff_id    uuid references public.users(id) on delete set null,
  execution_note          text,
  execution_failure       text,

  outcome_state           text        not null default 'NONE_YET',
  outcome_purchase_id     uuid references public.purchase_history(id) on delete set null,
  outcome_recorded_at     timestamptz,
  outcome_recorded_by_staff_id uuid references public.users(id) on delete set null,
  attribution_basis       text,
  attribution_note        text,
  recovered_value_aed     integer,
  recovered_value_basis   text,

  escalated_at            timestamptz,
  escalation_reason       text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- A unit is identified by (tenant, id) because inventory's primary key is
  -- (tenant_id, id). This composite FK is also what makes it impossible to
  -- raise an action against another dealership's car.
  constraint inventory_actions_unit_fkey
    foreign key (tenant_id, unit_id) references public.inventory(tenant_id, id) on delete restrict,

  constraint inventory_actions_status_check check (status in (
    'PROPOSED',          -- the engine recommended it; no human has decided
    'APPROVED',          -- an authorised person said do it
    'REJECTED',          -- an authorised person said no, with a reason. Terminal.
    'DEFERRED',          -- not now. Still live; becomes due again on defer_until
    'EXECUTED',          -- somebody recorded that they carried it out
    'EXECUTION_FAILED',  -- they tried and it did not happen
    'CANCELLED'          -- withdrawn before execution. Terminal.
  )),

  constraint inventory_actions_outcome_state_check check (outcome_state in (
    'NONE_YET',
    'AWAITING_OUTCOME',
    'ATTRIBUTED',
    'NOT_ATTRIBUTABLE',
    'CLOSED_WITHOUT_ACTION'
  )),

  -- THE RULE THAT GOVERNS recovered_value_aed.
  -- It may only be non-null when a specific row of public.purchase_history -
  -- an actual recorded sale, this system's only record of money that changed
  -- hands - is linked to this action, and a person has said how the link was
  -- made. No estimate, no approval-time figure, no execution-time figure, and
  -- no engine number may ever land here. engine_impact_aed is EXPOSURE and
  -- lives in its own column precisely so the two can never be confused.
  constraint inventory_actions_recovered_needs_real_sale check (
    recovered_value_aed is null
    or (outcome_state = 'ATTRIBUTED'
        and outcome_purchase_id is not null
        and attribution_basis is not null
        and recovered_value_basis is not null)
  ),

  -- A rejection with no reason teaches nothing, so it is not allowed to exist.
  constraint inventory_actions_rejection_needs_reason check (
    status <> 'REJECTED'
    or (decision_reason_code is not null and length(btrim(coalesce(decision_note, ''))) >= 3)
  ),
  constraint inventory_actions_deferral_needs_reason check (
    status <> 'DEFERRED' or decision_reason_code is not null
  ),
  constraint inventory_actions_decision_stamped check (
    status not in ('APPROVED', 'REJECTED', 'DEFERRED')
    or (decided_at is not null and decided_by_authority is not null)
  ),
  constraint inventory_actions_execution_stamped check (
    (executed_at is null) = (status not in ('EXECUTED', 'EXECUTION_FAILED'))
  )
);

comment on table public.inventory_actions is
  'Inventory Profit Sentinel action record: one row per proposed action on one unit. '
  'Records what the engine recommended, what a named person decided and why, who was to '
  'carry it out, whether it was carried out, and - only ever from a real recorded sale - '
  'what came of it. status is the ACTION lifecycle and is NOT an outcome vocabulary; '
  'public.nexus_outcome_class in audit_log owns that. Tenant-scoped; all writes go through '
  'the action_* functions, which is where authorisation is enforced.';

comment on column public.inventory_actions.recommendation is
  'The engine word frozen at proposal (REPRICE, PROMOTE, WHOLESALE, ...). HOLD is never '
  'proposed - it is the engine saying there is nothing to do.';
comment on column public.inventory_actions.engine_impact_aed is
  'EXPOSURE at proposal time, in the engine''s own sense: gross margin sitting in a unit '
  'that has not sold. Not expected loss, not attributed revenue, not recovered revenue. '
  'Never copied into recovered_value_aed.';
comment on column public.inventory_actions.decision_reason_code is
  'Closed list (see inventory_action_reason_codes). The single most valuable column here: '
  'it is how a future calibration pass learns which recommendations were wrong.';
comment on column public.inventory_actions.decided_by_authority is
  'On what basis this person was allowed to decide - TENANT_OWNER / TENANT_ADMIN / '
  'TENANT_MANAGER (account authority, from tenant_members.role) or STAFF_ROLE_POLICY '
  '(job title, from users.role against the dealership''s configured approver roles). '
  'Recorded because "who approved this" is not answerable without "and on what authority".';
comment on column public.inventory_actions.recovered_value_aed is
  'Realised gross margin on the LINKED SALE: purchase_history.amount_aed minus '
  'inventory.cost_aed, both real recorded figures. Populated only by '
  'public.action_record_outcome() and only with a purchase_history row id attached. '
  'It is ATTRIBUTED, not CONFIRMED CAUSATION: NEXUS does not claim the action caused the '
  'sale, and no screen may say it did. Can be negative if the unit sold below cost.';
comment on column public.inventory_actions.attribution_basis is
  'How the sale was tied to this action. Today the only value a human can produce is '
  'HUMAN_CONFIRMED_LINK, because purchase_history carries no inventory reference at all - '
  'there is no column, anywhere, that ties a recorded sale to a unit.';
comment on column public.inventory_actions.outcome_state is
  'NONE_YET / AWAITING_OUTCOME / ATTRIBUTED / NOT_ATTRIBUTABLE / CLOSED_WITHOUT_ACTION. '
  'A missing outcome is NOT_ATTRIBUTABLE or AWAITING_OUTCOME with a reason, never a zero.';
comment on column public.inventory_actions.escalated_at is
  'Set when a decision was attempted and no one at this dealership holds an approving role. '
  'The action stays PROPOSED - an escalation is a request for a person, not a decision.';

-- One live action per unit. The engine returns exactly one recommendation per
-- unit, so two live actions on one car is always a duplicate, never two
-- different jobs. This index is the HARD guarantee: it holds against the
-- functions, against service_role, against n8n and against a psql session. The
-- functions are only the polite half. DEFERRED counts as live: "not now" is
-- still an open item on a manager's desk.
create unique index if not exists inventory_actions_one_live_per_unit
  on public.inventory_actions (tenant_id, unit_id)
  where status in ('PROPOSED', 'APPROVED', 'DEFERRED');

comment on index public.inventory_actions_one_live_per_unit is
  'Concurrency rule: at most one live action per unit per dealership. Two managers '
  'approving the same car at the same moment produce one record, not two. Enforced by the '
  'index rather than by application code, because this codebase has already shipped a '
  '"Prefer: ignore-duplicates" header on a plain insert that did nothing at all.';

create index if not exists inventory_actions_tenant_status_idx
  on public.inventory_actions (tenant_id, status, proposed_at desc);
create index if not exists inventory_actions_tenant_unit_idx
  on public.inventory_actions (tenant_id, unit_id, proposed_at desc);

create or replace function public.inventory_actions_touch()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists inventory_actions_touch on public.inventory_actions;
create trigger inventory_actions_touch before update on public.inventory_actions
  for each row execute function public.inventory_actions_touch();

-- The per-action timeline. audit_log stays the canonical record of what a run
-- DID, in the one vocabulary this system has. It has no column to hang an
-- action id on, and adding one to a table five workflows write would be a
-- change with no owner. So the timeline lives here and carries audit_log_id,
-- which means every line a person reads in the UI can be followed to the audit
-- row that classifies it.
create table if not exists public.inventory_action_events (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete restrict,
  action_id     uuid not null references public.inventory_actions(id) on delete cascade,
  at            timestamptz not null default now(),
  event         text not null,
  actor_staff_id uuid references public.users(id) on delete set null,
  actor_auth_id uuid,
  actor_authority text,
  detail        text,
  audit_log_id  uuid references public.audit_log(id) on delete set null,
  constraint inventory_action_events_event_check check (event in (
    'PROPOSED', 'APPROVED', 'REJECTED', 'DEFERRED', 'ASSIGNED',
    'EXECUTED', 'EXECUTION_FAILED', 'CANCELLED',
    'OUTCOME_ATTRIBUTED', 'OUTCOME_NOT_ATTRIBUTABLE',
    'APPROVAL_REFUSED', 'ESCALATED'
  ))
);

comment on table public.inventory_action_events is
  'Append-only timeline for one inventory action. `event` is the lifecycle transition, not '
  'an outcome class: audit_log_id points at the audit row whose status '
  'public.nexus_outcome_class classifies. Two refusal events exist on purpose - '
  'APPROVAL_REFUSED (this person may not approve) and ESCALATED (nobody here may approve) - '
  'because they need different answers from a human.';

create index if not exists inventory_action_events_action_idx
  on public.inventory_action_events (action_id, at);

create table if not exists public.inventory_action_reason_codes (
  code        text primary key,
  applies_to  text[] not null,
  label       text not null,
  meaning     text not null,
  engine_was_wrong boolean not null,
  sort        integer not null default 100
);

comment on table public.inventory_action_reason_codes is
  'Closed list of why a human rejected or deferred a recommendation. Global, not '
  'tenant-scoped: it is product vocabulary, the same at every dealership, and it is what '
  'makes rejections countable. engine_was_wrong separates "the engine read the business '
  'wrong" from "the engine was right and we chose otherwise" - only the first is a defect.';

insert into public.inventory_action_reason_codes (code, applies_to, label, meaning, engine_was_wrong, sort) values
  ('PRICE_IS_CORRECT',    array['REJECT'],           'The price is right',            'The unit is priced correctly for this market and this car. The ageing is real; the conclusion is not.', true,  10),
  ('COST_BASIS_WRONG',    array['REJECT'],           'Acquisition cost is wrong',     'The cost_aed NEXUS holds for this unit is not what the dealership paid, so the margin it reasoned from is wrong.', true,  20),
  ('DAYS_IN_STOCK_WRONG', array['REJECT'],           'Days in stock is wrong',        'The unit has not been on the lot as long as NEXUS thinks - wrong acquisition date, or it came back from somewhere.', true,  30),
  ('ALREADY_ACTIONED',    array['REJECT'],           'Already done outside NEXUS',    'The price was already moved, or the unit was already promoted, and NEXUS did not see it.', true,  40),
  ('UNIT_NOT_AVAILABLE',  array['REJECT'],           'Unit is not actually available','Sold, reserved, in workshop or otherwise not on the lot. NEXUS thinks it is available.', true,  50),
  ('STRATEGIC_HOLD',      array['REJECT','DEFER'],   'Deliberate hold',               'The dealership is holding this unit on purpose. The engine read the numbers correctly and the answer is still no.', false, 60),
  ('DEAL_IN_PROGRESS',    array['REJECT','DEFER'],   'A deal is in progress',         'Somebody is negotiating on this car right now. Moving the price mid-deal is not on.', false, 70),
  ('WAITING_ON_APPROVAL', array['DEFER'],            'Waiting on someone else',       'The decision needs a person who has not been asked yet.', false, 80),
  ('WAITING_ON_MARKET',   array['DEFER'],            'Waiting for market evidence',   'Not enough is known about what this car is worth to move on it yet.', false, 90),
  ('OTHER',               array['REJECT','DEFER'],   'Something else',                'None of the above. The note is the whole record, so it has to say enough to be counted later.', false, 999)
on conflict (code) do nothing;

-- Read is tenant-scoped like every other table here. WRITE IS NOT GRANTED AT
-- ALL: there is no INSERT/UPDATE/DELETE policy for `authenticated`, and the
-- table privileges below revoke those verbs outright. Every write goes through
-- the action_* functions, which is the only place authorisation can be checked.
-- An approve button that is merely hidden in the browser is not an
-- authorisation rule; this is.
alter table public.inventory_actions        enable row level security;
alter table public.inventory_action_events  enable row level security;
alter table public.inventory_action_reason_codes enable row level security;

drop policy if exists inventory_actions_authenticated_read on public.inventory_actions;
create policy inventory_actions_authenticated_read on public.inventory_actions
  for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists inventory_actions_deny_anon on public.inventory_actions;
create policy inventory_actions_deny_anon on public.inventory_actions
  as restrictive for all to anon using (false) with check (false);

drop policy if exists inventory_actions_service_role_all on public.inventory_actions;
create policy inventory_actions_service_role_all on public.inventory_actions
  for all to service_role using (true) with check (true);

drop policy if exists inventory_action_events_authenticated_read on public.inventory_action_events;
create policy inventory_action_events_authenticated_read on public.inventory_action_events
  for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));

drop policy if exists inventory_action_events_deny_anon on public.inventory_action_events;
create policy inventory_action_events_deny_anon on public.inventory_action_events
  as restrictive for all to anon using (false) with check (false);

drop policy if exists inventory_action_events_service_role_all on public.inventory_action_events;
create policy inventory_action_events_service_role_all on public.inventory_action_events
  for all to service_role using (true) with check (true);

drop policy if exists inventory_action_reason_codes_read on public.inventory_action_reason_codes;
create policy inventory_action_reason_codes_read on public.inventory_action_reason_codes
  for select to authenticated using (true);

drop policy if exists inventory_action_reason_codes_deny_anon on public.inventory_action_reason_codes;
create policy inventory_action_reason_codes_deny_anon on public.inventory_action_reason_codes
  as restrictive for all to anon using (false) with check (false);

drop policy if exists inventory_action_reason_codes_service_role_all on public.inventory_action_reason_codes;
create policy inventory_action_reason_codes_service_role_all on public.inventory_action_reason_codes
  for all to service_role using (true) with check (true);

revoke all on public.inventory_actions              from anon, authenticated;
revoke all on public.inventory_action_events        from anon, authenticated;
revoke all on public.inventory_action_reason_codes  from anon, authenticated;
grant select on public.inventory_actions             to authenticated;
grant select on public.inventory_action_events       to authenticated;
grant select on public.inventory_action_reason_codes to authenticated;
grant all    on public.inventory_actions             to service_role;
grant all    on public.inventory_action_events       to service_role;
grant all    on public.inventory_action_reason_codes to service_role;