-- ---------------------------------------------------------------------------
-- v_deal_rescue_candidates - the audit, made queryable.
-- One row per thing a careless Deal Rescue would have called a deal, with the
-- verdict and the reason. The refusals are the point: they are what stops this
-- engine inventing a deal lifecycle the dealership does not have.
-- ---------------------------------------------------------------------------
create or replace view public.v_deal_rescue_candidates
with (security_invoker = true) as
with lead_key as (
  -- The exact-email clause of the INV-002 identity rule, and only where it
  -- names exactly one person. Deliberately NARROWER than
  -- nexus_lead_for_comm_key(): that function is SECURITY DEFINER and takes the
  -- tenant as an argument, so granting it to a signed-in user would let one
  -- dealership resolve another's leads. Narrower is safe - it refuses more and
  -- never resolves differently. What it cannot resolve is reported
  -- UNKNOWN_UNRESOLVED_IDENTITY, never guessed.
  select l.tenant_id, lower(btrim(l.email)) as k, min(l.id) as lead_id, count(*) as n
    from public.leads l
   where nullif(btrim(coalesce(l.email, '')), '') is not null
   group by l.tenant_id, lower(btrim(l.email))
),
sale_by_lead as (
  select p.tenant_id, p.lead_id, count(*) as n
    from public.purchase_history p where p.lead_id is not null
   group by p.tenant_id, p.lead_id
),
sale_by_email as (
  select p.tenant_id, lower(btrim(p.email)) as k, count(*) as n
    from public.purchase_history p
   where nullif(btrim(coalesce(p.email, '')), '') is not null
   group by p.tenant_id, lower(btrim(p.email))
)
-- 1. Finance quotes. The only STRONG deal evidence this schema has a table for.
select
  q.tenant_id,
  'FINANCE_QUOTE'::text as candidate_kind,
  q.id::text            as candidate_ref,
  coalesce(nullif(btrim(coalesce(q.lead_name, '')), ''), nullif(btrim(coalesce(q.lead_email, '')), ''), '(unnamed)')::text as customer_label,
  'finance_quotes'::text as source_table,
  q.created_at           as observed_at,
  (case when lk.n = 1 then lk.lead_id end)::integer as lead_id,
  (case when lk.n = 1 then 'RESOLVED_EXACT_EMAIL'
        when lk.n > 1 then 'UNKNOWN_AMBIGUOUS_EMAIL'
        else 'UNKNOWN_UNRESOLVED_IDENTITY' end)::text as identity_state,
  (case when lk.n = 1 then 'finance_quotes.lead_email matches exactly one leads.email in this dealership.'
        else 'This quote names a person NEXUS cannot resolve to exactly one lead by the exact-email clause. It is reported, not attached to anybody.' end)::text as identity_basis,
  (case when coalesce(se.n, 0) > 0 or coalesce(sl.n, 0) > 0 then 'REFUSED_ALREADY_SOLD'
        else 'IN_FLIGHT_DEAL' end)::text as verdict,
  (case when coalesce(se.n, 0) > 0 or coalesce(sl.n, 0) > 0 then null else 'STRONG' end)::text as evidence_tier,
  (case when coalesce(se.n, 0) > 0 or coalesce(sl.n, 0) > 0
        then 'A sale is already recorded for this person. The deal is done; there is nothing to rescue.'
        else 'A priced, dated finance offer with no sale on record. Somebody priced a specific car for a specific person - that is a transaction under way, not an enquiry.' end)::text as verdict_basis,
  coalesce(q.vehicle_price_aed, q.vehicle_value_aed)::bigint as deal_value_aed,
  (case when coalesce(q.vehicle_price_aed, q.vehicle_value_aed) is null then 'UNKNOWN_NOT_RECORDED'
        else 'AT_STAKE_FROM_QUOTE' end)::text as deal_value_state,
  'EXPOSURE - the vehicle price recorded on the finance quote. This is what is AT STAKE. It is not estimated revenue, not attributed revenue and not confirmed revenue.'::text as deal_value_basis
from public.finance_quotes q
left join lead_key     lk on lk.tenant_id = q.tenant_id and lk.k = lower(btrim(coalesce(q.lead_email, '')))
left join sale_by_email se on se.tenant_id = q.tenant_id and se.k = lower(btrim(coalesce(q.lead_email, '')))
left join sale_by_lead  sl on sl.tenant_id = q.tenant_id and sl.lead_id = (case when lk.n = 1 then lk.lead_id end)

union all

-- 2. KYC documents. WEAK at best: this workflow audits ANY image sent over
--    WhatsApp, so a document proves an image arrived, not that a deal exists.
select
  k.tenant_id,
  'KYC_DOCUMENT'::text,
  k.id::text,
  coalesce(nullif(btrim(coalesce(k.lead_name, '')), ''), nullif(btrim(coalesce(k.lead_email, '')), ''), '(unnamed)')::text,
  'kyc_documents'::text,
  k.created_at,
  (case when lk.n = 1 then lk.lead_id end)::integer,
  (case when lk.n = 1 then 'RESOLVED_EXACT_EMAIL'
        when lk.n > 1 then 'UNKNOWN_AMBIGUOUS_EMAIL'
        else 'UNKNOWN_UNRESOLVED_IDENTITY' end)::text,
  (case when lk.n = 1 then 'kyc_documents.lead_email matches exactly one leads.email in this dealership.'
        else 'This document names a person NEXUS cannot resolve to exactly one lead by the exact-email clause.' end)::text,
  (case when k.voided_at is not null or upper(coalesce(k.verdict, '')) = 'REJECTED' or coalesce(k.is_valid, false) is false
             then 'REFUSED_VOIDED_OR_REJECTED'
        when coalesce(se.n, 0) > 0 or coalesce(sl.n, 0) > 0 then 'REFUSED_ALREADY_SOLD'
        else 'IN_FLIGHT_DEAL' end)::text,
  (case when k.voided_at is not null or upper(coalesce(k.verdict, '')) = 'REJECTED' or coalesce(k.is_valid, false) is false then null
        when coalesce(se.n, 0) > 0 or coalesce(sl.n, 0) > 0 then null
        else 'WEAK' end)::text,
  (case when k.voided_at is not null or upper(coalesce(k.verdict, '')) = 'REJECTED' or coalesce(k.is_valid, false) is false
             then 'Not an accepted identity document (verdict ' || coalesce(k.verdict, 'none') || ', document_type ' || coalesce(k.document_type, 'none') || '). It evidences nothing about a deal.'
        when coalesce(se.n, 0) > 0 or coalesce(sl.n, 0) > 0
             then 'A sale is already recorded for this person. The deal is done.'
        else 'Identity papers accepted for a person with no sale on record. WEAK: the KYC workflow audits any image sent over WhatsApp, so this can raise NEEDS_MANAGER and nothing stronger.' end)::text,
  null::bigint,
  'UNKNOWN_NO_LINK'::text,
  'UNKNOWN. A KYC document carries no vehicle and no price, so nothing here says what is at stake.'::text
from public.kyc_documents k
left join lead_key     lk on lk.tenant_id = k.tenant_id and lk.k = lower(btrim(coalesce(k.lead_email, '')))
left join sale_by_email se on se.tenant_id = k.tenant_id and se.k = lower(btrim(coalesce(k.lead_email, '')))
left join sale_by_lead  sl on sl.tenant_id = k.tenant_id and sl.lead_id = (case when lk.n = 1 then lk.lead_id end)

union all

-- 3. Leads. REFUSED. An open lead is an enquiry, and Lead Recovery owns it.
select
  l.tenant_id,
  'LEAD'::text,
  l.id::text,
  l.name::text,
  'leads'::text,
  l.created_at,
  l.id,
  'RESOLVED_SELF'::text,
  'The candidate is the lead row itself.'::text,
  'REFUSED_NOT_DEAL_EVIDENCE'::text,
  null::text,
  ('leads.status = ' || coalesce(l.status, '(blank)') || ', open = ' || coalesce(public.nexus_lead_is_open(l.status)::text, 'unknown')
   || '. An open lead is an enquiry: nothing here says a price was agreed, a vehicle was chosen or a transaction started. '
   || 'Calling it an in-flight deal would manufacture a deal lifecycle this dealership does not have, and Lead Recovery (v_lead_recovery) already states this lead''s risk. '
   || 'Age is not a reason either.')::text,
  null::bigint,
  'UNKNOWN_NO_LINK'::text,
  'UNKNOWN. leads.budget_aed is null on every lead on file and nothing links a lead to a unit.'::text
from public.leads l

union all

-- 4. Completed sales. The deal is done - nothing to rescue.
select
  p.tenant_id,
  'CONFIRMED_SALE'::text,
  p.id::text,
  coalesce(nullif(btrim(coalesce(p.customer_name, '')), ''), '(unnamed)')::text,
  'purchase_history'::text,
  p.created_at,
  p.lead_id,
  (case when p.lead_id is not null then 'RESOLVED_FOREIGN_KEY' else 'UNKNOWN_UNRESOLVED_IDENTITY' end)::text,
  (case when p.lead_id is not null then 'purchase_history.lead_id -> leads(id), a declared foreign key.'
        else 'This sale names no lead. That is a recorded absence of provenance, not proof no lead existed.' end)::text,
  'COMPLETED_SALE_NOT_IN_FLIGHT'::text,
  null::text,
  ('deal_id ' || coalesce(p.deal_id, '(none)') || ' was synthesised at the moment of sale, so this row is not the tail of a deal record - it is the whole of it. '
   || 'DEAL_CREATED and SALE_CONFIRMED are one event here. What is known about this sale is answered by v_attribution_sale_chain.')::text,
  p.amount_aed::bigint,
  (case when p.amount_aed is null then 'UNKNOWN_NOT_RECORDED' else 'CONFIRMED_REVENUE' end)::text,
  'CONFIRMED revenue - a recorded business outcome. Not at stake, not estimated, not attributed.'::text
from public.purchase_history p

union all

-- 5. Approved-but-unexecuted inventory actions. A stalled action, not a deal.
select
  a.tenant_id,
  'APPROVED_UNEXECUTED_INVENTORY_ACTION'::text,
  a.id::text,
  ('unit ' || a.unit_id)::text,
  'inventory_actions'::text,
  a.decided_at,
  null::integer,
  'NOT_APPLICABLE_NO_CUSTOMER'::text,
  'An inventory action concerns a unit. There is no customer to resolve.'::text,
  'REFUSED_NOT_DEAL_EVIDENCE'::text,
  null::text,
  ('An approved ' || a.recommendation || ' on ' || a.unit_id || ' with no execution recorded. That is a stalled ACTION, not a stalled deal: no customer, no agreed price, no transaction. The Inventory Action Center owns it.')::text,
  null::bigint,
  'NOT_APPLICABLE'::text,
  'A unit''s exposed margin is not a deal value and must not be read as one.'::text
from public.inventory_actions a
where a.status = 'APPROVED' and a.executed_at is null

union all

-- 6. Approved-but-unexecuted lead recovery actions. Same shape, and already
--    reported by Lead Recovery - raising a deal here would double-count it.
select
  r.tenant_id,
  'APPROVED_UNEXECUTED_LEAD_RECOVERY_ACTION'::text,
  r.id::text,
  ('lead ' || r.lead_id::text)::text,
  'lead_recovery_actions'::text,
  r.decided_at,
  r.lead_id,
  'RESOLVED_FOREIGN_KEY'::text,
  'lead_recovery_actions.lead_id -> leads(id).'::text,
  'REFUSED_NOT_DEAL_EVIDENCE'::text,
  null::text,
  ('An approved ' || r.recommendation || ' with no execution recorded. Lead Recovery already surfaces this as action_state on the lead; raising a deal from it would put one piece of work on two screens with two owners.')::text,
  null::bigint,
  'NOT_APPLICABLE'::text,
  'A recovery action carries no deal value.'::text
from public.lead_recovery_actions r
where r.status = 'APPROVED' and r.executed_at is null;

comment on view public.v_deal_rescue_candidates is
  'Every source considered as evidence of an in-flight deal, with the verdict and the reason. Only verdict = IN_FLIGHT_DEAL reaches v_deal_rescue. Read the refusals: they are where this engine declines to invent a deal lifecycle.';

-- ---------------------------------------------------------------------------
-- v_deal_rescue - the engine. Admitted in-flight deals only.
-- ---------------------------------------------------------------------------
create or replace view public.v_deal_rescue
with (security_invoker = true) as
with cfg as (
  select t.id as tenant_id,
         coalesce(s.at_risk_days, 3) as at_risk_days,
         coalesce(s.stalled_days, 7) as stalled_days,
         s.tenant_id is null         as settings_are_defaults
    from public.tenants t
    left join public.deal_rescue_settings s on s.tenant_id = t.id
),
cand as (
  select * from public.v_deal_rescue_candidates where verdict = 'IN_FLIGHT_DEAL'
),
joined as (
  select c.tenant_id, c.candidate_kind, c.candidate_ref, c.customer_label, c.source_table,
         c.observed_at, c.lead_id, c.identity_state, c.identity_basis,
         c.evidence_tier, c.verdict_basis, c.deal_value_aed, c.deal_value_state, c.deal_value_basis,
         g.at_risk_days, g.stalled_days, g.settings_are_defaults,
         lr.lead_status, lr.lead_is_open, lr.silence_state, lr.last_contact_at,
         lr.silence_detector_state, lr.silence_detector_last_success_at,
         lr.owner_staff_id, lr.owner_name, lr.owner_job_title, lr.messages_resolved,
         lr.state as lead_recovery_state,
         greatest(c.observed_at, lr.last_contact_at) as last_movement_at
    from cand c
    join cfg g on g.tenant_id = c.tenant_id
    left join public.v_lead_recovery lr on lr.tenant_id = c.tenant_id and lr.lead_id = c.lead_id
),
timed as (
  select j.*,
         round((extract(epoch from (now() - j.last_movement_at)) / 86400.0)::numeric, 2) as days_since_movement
    from joined j
),
classified as (
  select t.*,
         public.deal_rescue_state(t.evidence_tier, false, t.lead_is_open, t.silence_state,
                                  t.days_since_movement, t.at_risk_days, t.stalled_days) as state
    from timed t
)
select
  tenant_id,
  candidate_kind        as deal_evidence,
  candidate_ref         as deal_evidence_ref,
  source_table          as deal_evidence_source,
  customer_label,
  lead_id,
  identity_state,
  identity_basis,
  evidence_tier,
  verdict_basis         as admission_basis,
  observed_at           as deal_evidence_at,
  last_contact_at       as last_message_at,
  last_movement_at,
  days_since_movement,
  at_risk_days,
  stalled_days,
  settings_are_defaults,
  state,
  case state
    when 'ON_TRACK'         then 'The latest movement on this deal is ' || days_since_movement || ' days old, inside the ' || at_risk_days || '-day window.'
    when 'AT_RISK'          then 'No movement for ' || days_since_movement || ' days, past ' || at_risk_days || ' but not yet ' || stalled_days || '. INACTIVITY, not a stage: nothing in this schema records what a deal is sitting on.'
    when 'STALLED'          then 'No movement for ' || days_since_movement || ' days, past the ' || stalled_days || '-day threshold. Why it stalled is UNKNOWN - there is no stage history to say.'
    when 'CUSTOMER_GHOSTED' then 'No movement for ' || days_since_movement || ' days and Lead Recovery grades this customer SILENT_PAST_STALE_THRESHOLD. Silence is read from v_lead_recovery, not re-derived here.'
    when 'NEEDS_MANAGER'    then 'A person has to look. Either the evidence is weak, or something transactional is live against a lead somebody closed.'
    else                         'No state can be stated: the evidence resolves to nobody, or nothing dates its last movement. Unknown is not none.'
  end as state_basis,
  public.deal_rescue_recommended_action(state) as recommended_action,
  case state
    when 'ON_TRACK'         then 'Nothing to do. The deal is moving.'
    when 'AT_RISK'          then 'A follow-up from whoever owns this is the proportionate action while it is still only quiet.'
    when 'STALLED'          then 'Past the threshold and NEXUS cannot say why. A manager has to find the blocker, because the data that would name it does not exist.'
    when 'CUSTOMER_GHOSTED' then 'The customer specifically has gone quiet. Re-contact on a different channel before treating it as lost.'
    when 'NEEDS_MANAGER'    then 'NEXUS will not grade this on the evidence it has. A person decides.'
    else                         'NEXUS cannot see this. A person looks.'
  end as action_reason,
  owner_staff_id, owner_name, owner_job_title,
  case when owner_staff_id is null then 'UNASSIGNED' else 'ASSIGNED' end as owner_state,
  case when owner_staff_id is null
       then 'UNKNOWN. No deal record exists in this schema, so ownership is borrowed from leads.assigned_to_id, and that is null here. Nobody owns this.'
       else null end as owner_note,
  deal_value_aed,
  deal_value_state,
  deal_value_basis,
  'NOT_COMPUTABLE'::text as margin_at_stake_state,
  'NOT COMPUTABLE, which is not zero. Gross margin needs the unit''s acquisition cost, and nothing links a deal to an inventory unit in this schema.'::text as margin_at_stake_basis,
  case when evidence_tier = 'WEAK' then 'LOW' else 'MEDIUM' end as confidence,
  case when evidence_tier = 'WEAK'
       then 'LOW. Admitted on a KYC document, and the KYC workflow audits any image sent over WhatsApp - it does not evidence a transaction.'
       else 'MEDIUM, and capped there. The trigger is solid (a priced, dated quote), but this schema has no deal record and no stage history, so the engine is inferring a transaction rather than reading one.'
  end as confidence_basis,
  lead_recovery_state,
  silence_state,
  silence_detector_state,
  silence_detector_last_success_at,
  case when silence_detector_state = 'CURRENT' then null
       else 'The 12-Hour Silence Detector is ' || lower(coalesce(silence_detector_state, 'unknown'))
            || ', so the ABSENCE of a silence marker on this person is not evidence that nobody went quiet. Silence here is computed from message timestamps by Lead Recovery; the markers are not usable.'
  end as silence_detector_note,
  true as human_approval_required,
  'NO_AUTOMATED_EXECUTOR'::text as automation_state,
  'No NEXUS workflow executes a deal rescue action. Every recommendation here means a person acts.'::text as automation_note,
  'NOT_BUILT'::text as action_lane_state,
  'Deal Rescue has no propose/decide/execute lane. It was left unbuilt deliberately: the queue is structurally empty, and an approval desk with nothing to approve is a third authority surface for no decision anybody can take. See deal_rescue_prerequisites.ACTION_LANE.'::text as action_lane_note,
  jsonb_build_object(
    'deal_evidence', candidate_kind,
    'deal_evidence_ref', candidate_ref,
    'deal_evidence_source', source_table,
    'deal_evidence_at', observed_at,
    'lead_id', lead_id,
    'identity_state', identity_state,
    'lead_status', lead_status,
    'lead_is_open', lead_is_open,
    'messages_resolved', messages_resolved,
    'last_message_at', last_contact_at,
    'last_movement_at', last_movement_at,
    'days_since_movement', days_since_movement,
    'silence_state_read_from', 'v_lead_recovery.silence_state',
    'silence_state', silence_state,
    'silence_detector_state', silence_detector_state,
    'deal_record_exists', false,
    'deal_stage_history_exists', false,
    'appointment_exists', false,
    'thresholds', jsonb_build_object('at_risk_days', at_risk_days, 'stalled_days', stalled_days, 'are_defaults', settings_are_defaults)
  ) as evidence,
  now() as computed_at
from classified;

comment on view public.v_deal_rescue is
  'The Deal Rescue engine. One row per admitted in-flight deal. Empty today and structurally so: the only STRONG evidence source is finance_quotes, which holds 0 rows, and every other candidate is refused with a reason in v_deal_rescue_candidates.';

-- ---------------------------------------------------------------------------
-- v_deal_rescue_state_model - which states are reachable, and why not.
-- ---------------------------------------------------------------------------
create or replace view public.v_deal_rescue_state_model
with (security_invoker = true) as
select s.state, s.sort, s.meaning, s.engine_can_produce, s.blocked_by, s.requires,
       coalesce(n.n, 0) as deals_in_state_now,
       case
         when not s.engine_can_produce then 'UNREACHABLE_BY_DESIGN'
         when coalesce(n.n, 0) > 0     then 'OBSERVED'
         when (select count(*) from public.v_deal_rescue) = 0 then 'UNREACHABLE_TODAY_NO_POPULATION'
         else 'REACHABLE_NOT_OBSERVED'
       end as observation
  from public.deal_rescue_states s
  left join (select d.state, count(*) as n from public.v_deal_rescue d group by d.state) n
         on n.state = s.state;

comment on view public.v_deal_rescue_state_model is
  'Every Deal Rescue state with whether a branch exists at all, and whether anything is in it today. UNREACHABLE_BY_DESIGN means no code path can produce it; UNREACHABLE_TODAY_NO_POPULATION means the code path exists and the engine has no rows to run it over.';

-- ---------------------------------------------------------------------------
-- v_deal_rescue_readiness - the purchase order, re-measured on every read.
-- ---------------------------------------------------------------------------
create or replace view public.v_deal_rescue_readiness
with (security_invoker = true) as
select
  p.id, p.sort, p.requirement, p.kind, p.unlocks, p.unlocks_states, p.evidence_today, p.why_not_code,
  case p.id
    when 'DEAL_RECORD'              then (to_regclass('public.deals') is not null)
    when 'APPOINTMENT'              then (to_regclass('public.appointments') is not null)
    when 'ACTION_LANE'              then (to_regclass('public.deal_rescue_actions') is not null)
    when 'DEAL_STAGE_HISTORY'       then (select count(*) > 0 from information_schema.columns c
                                           where c.table_schema = 'public' and c.column_name = 'stage')
    when 'FINANCE_DECISION'         then (select count(*) > 0 from information_schema.columns c
                                           where c.table_schema = 'public' and c.table_name = 'finance_quotes'
                                             and c.column_name in ('decision','lender_decision','status','decided_at','lender'))
    when 'DEAL_TO_UNIT_LINK'        then (select count(*) > 0 from information_schema.columns c
                                           where c.table_schema = 'public' and c.table_name = 'purchase_history'
                                             and c.column_name in ('unit_id','vin','inventory_id'))
    when 'SILENCE_DETECTOR_RESUMED' then (select count(*) = 0 from public.v_lead_recovery r
                                           where r.silence_detector_state <> 'CURRENT')
    when 'DEAL_OWNER'               then (select count(*) = 0 from public.leads l where l.assigned_to_id is null)
    when 'VOLUME'                   then false
  end as met_now,
  case p.id
    when 'DEAL_RECORD'              then 'public.deals: ' || coalesce(to_regclass('public.deals')::text, 'does not exist')
    when 'APPOINTMENT'              then 'public.appointments: ' || coalesce(to_regclass('public.appointments')::text, 'does not exist')
    when 'ACTION_LANE'              then 'public.deal_rescue_actions: ' || coalesce(to_regclass('public.deal_rescue_actions')::text, 'does not exist')
    when 'DEAL_STAGE_HISTORY'       then (select count(*)::text from information_schema.columns c
                                           where c.table_schema = 'public' and c.column_name = 'stage') || ' column(s) named "stage" anywhere in schema public'
    when 'FINANCE_DECISION'         then (select count(*)::text from public.finance_quotes) || ' live finance_quotes row(s); '
                                         || (select count(*)::text from information_schema.columns c
                                              where c.table_schema = 'public' and c.table_name = 'finance_quotes'
                                                and c.column_name in ('decision','lender_decision','status','decided_at','lender'))
                                         || ' decision-shaped column(s) on finance_quotes'
    when 'DEAL_TO_UNIT_LINK'        then (select count(*)::text from information_schema.columns c
                                           where c.table_schema = 'public' and c.table_name = 'purchase_history'
                                             and c.column_name in ('unit_id','vin','inventory_id')) || ' unit-link column(s) on purchase_history'
    when 'SILENCE_DETECTOR_RESUMED' then (select coalesce(max(r.silence_detector_state), 'no leads to measure') from public.v_lead_recovery r)
                                         || ', last success ' || coalesce((select max(r.silence_detector_last_success_at)::text from public.v_lead_recovery r), 'never')
    when 'DEAL_OWNER'               then (select count(*)::text from public.leads l where l.assigned_to_id is null) || ' of '
                                         || (select count(*)::text from public.leads) || ' lead(s) unassigned'
    when 'VOLUME'                   then (select count(*)::text from public.leads) || ' lead(s), '
                                         || (select count(*)::text from public.purchase_history) || ' sale(s), '
                                         || (select count(*)::text from public.finance_quotes) || ' finance quote(s)'
  end as measured_now,
  now() as measured_at
from public.deal_rescue_prerequisites p;

comment on view public.v_deal_rescue_readiness is
  'The Deal Rescue purchase order with every measurable prerequisite re-measured on read, so it cannot silently go stale the way a written list does. met_now is null where the requirement is a judgement rather than a measurement.';

-- Grants. Supabase default privileges arrive on their own and grant directly to
-- anon and authenticated; REVOKE FROM PUBLIC does not touch a direct grant.
revoke all on public.v_deal_rescue_candidates  from anon, authenticated, public;
revoke all on public.v_deal_rescue             from anon, authenticated, public;
revoke all on public.v_deal_rescue_state_model from anon, authenticated, public;
revoke all on public.v_deal_rescue_readiness   from anon, authenticated, public;

grant select on public.v_deal_rescue_candidates  to authenticated, service_role;
grant select on public.v_deal_rescue             to authenticated, service_role;
grant select on public.v_deal_rescue_state_model to authenticated, service_role;
grant select on public.v_deal_rescue_readiness   to authenticated, service_role;