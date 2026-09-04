-- DEAL RESCUE ENGINE - catalogues.
-- Audited 2026-09-03 against the live schema. There is no deals table, no deal
-- stage history and no appointment table. purchase_history holds 1 row and its
-- deal_id is synthesised at the moment of sale ('auto:<email>|<date>'), so
-- DEAL_CREATED and SALE_CONFIRMED are the same row and DEAL_UPDATED is emitted
-- by nothing. finance_quotes holds 0 live rows.

create table if not exists public.deal_rescue_states (
  state               text primary key,
  sort                integer not null,
  meaning             text not null,
  engine_can_produce  boolean not null,
  blocked_by          text,
  requires            text not null
);

comment on table public.deal_rescue_states is
  'The only states deal_rescue_state() may return, and for each one whether a branch exists at all. engine_can_produce = false means NO branch is written and none may be added until blocked_by is cleared.';

insert into public.deal_rescue_states (state, sort, meaning, engine_can_produce, blocked_by, requires) values
('ON_TRACK', 10,
 'An admitted in-flight deal that has moved inside the at-risk window.',
 true, null,
 'An admitted deal-evidence row whose latest movement (the evidence row itself, or the last resolved message on the lead) is newer than at_risk_days.'),
('AT_RISK', 20,
 'An admitted in-flight deal that has not moved for longer than the dealership''s at-risk window, but not yet long enough to call stalled.',
 true, null,
 'Latest movement older than at_risk_days and newer than stalled_days. Note this is inactivity, not a stage: nothing in this schema records that a deal is sitting in a stage.'),
('STALLED', 30,
 'An admitted in-flight deal that has not moved for longer than the stalled window, with no silence cause established.',
 true, null,
 'Latest movement older than stalled_days. Inactivity only - the reason is UNKNOWN, because no stage history exists to say what it is stuck on.'),
('CUSTOMER_GHOSTED', 40,
 'An admitted in-flight deal that is stalled AND the customer specifically has gone quiet.',
 true, null,
 'Stalled, plus v_lead_recovery.silence_state = SILENT_PAST_STALE_THRESHOLD on the lead. Silence is READ from Lead Recovery, never re-derived here - one figure, one derivation. Read with care: the 12-Hour Silence Detector last succeeded 26 Aug 2026 19:03 UTC and is stale, so the ABSENCE of a silence marker is not evidence that nobody went quiet.'),
('NEEDS_MANAGER', 50,
 'Something transactional is on file and NEXUS cannot responsibly grade it. A person must look.',
 true, null,
 'Admitted on WEAK evidence only, or the deal evidence is live while the lead it resolves to is closed. Never produced from age alone.'),
('FINANCE_BLOCKED', 60,
 'A finance application carries a recorded adverse decision that is holding the deal up.',
 false, 'NO_FINANCE_DECISION_FIELD',
 'A lender decision on record. finance_quotes has 35 columns and not one records a decision - no status, no approved/declined flag, no decided_at, no conditions, no lender - and the table holds 0 live rows. Either of those alone would be fatal. NO BRANCH of deal_rescue_state() returns this state and none has been written; the value exists here only so the vocabulary is complete and so the prerequisite that would unlock it is named. Adding a branch before the column exists would be fabrication.'),
('UNKNOWN', 70,
 'No admitted deal evidence, or the identity behind the evidence could not be resolved to one person.',
 true, null,
 'The default. Unknown is not none and it is not zero: it means NEXUS cannot see, not that nothing is happening.');

create table if not exists public.deal_rescue_evidence_sources (
  source         text primary key,
  sort           integer not null,
  admitted       boolean not null,
  evidence_tier  text not null check (evidence_tier in ('STRONG','WEAK','REFUSED')),
  claim          text not null,
  verdict_basis  text not null
);

comment on table public.deal_rescue_evidence_sources is
  'Every source considered as evidence that a deal is in flight, and the verdict. The refused rows are the load-bearing ones: they are where "an old lead is not a stalled deal" is written down as data rather than left to a comment.';

insert into public.deal_rescue_evidence_sources (source, sort, admitted, evidence_tier, claim, verdict_basis) values
('FINANCE_QUOTE', 10, true, 'STRONG',
 'A priced, dated finance offer against a specific vehicle value for a named person, with no sale on record.',
 'A quote is a commitment step: somebody priced a specific car for a specific person and wrote it down. That is a transaction under way rather than an enquiry, and it is the only deal-grade artefact this schema has a table for. It holds 0 live rows today (18 inserts, 15 deletes - journey teardowns), so this source is real but unpopulated.'),
('KYC_DOCUMENT_VALID', 20, true, 'WEAK',
 'A government identity document accepted (is_valid, not voided, not rejected) for a named person with no sale on record.',
 'Identity papers are normally collected to paper a transaction. Admitted only WEAKLY, because in this system the KYC workflow audits ANY image sent over WhatsApp - the document proves an image arrived, not that a deal exists. A weak candidate can only reach NEEDS_MANAGER; it never produces a risk state on its own. All 3 rows on file today are NOT_A_DOCUMENT, REJECTED and voided.'),
('OPEN_LEAD', 30, false, 'REFUSED',
 'A leads row whose status nexus_lead_is_open() treats as open.',
 'An open lead is an enquiry. Nothing about it says a price was agreed, a vehicle was chosen or a transaction started. Treating it as an in-flight deal would manufacture a deal lifecycle this dealership does not have. Lead Recovery (v_lead_recovery) already owns open leads and states their risk; a second engine over the same rows would put two states on one fact.'),
('LEAD_AGE', 40, false, 'REFUSED',
 'A leads row that is simply old.',
 'Old is not stalled. Age on its own is never a reason in this engine, for any state.'),
('CONVERSATION_TRAFFIC', 50, false, 'REFUSED',
 'Recent inbound or outbound messages resolving to a lead under INV-002.',
 'Traffic evidences a conversation, which Lead Recovery already grades from these exact timestamps. It does not evidence a deal. This engine READS v_lead_recovery.silence_state rather than re-deriving silence, so that one fact keeps one derivation.'),
('CONFIRMED_SALE', 60, false, 'REFUSED',
 'A purchase_history row.',
 'The deal is done - there is nothing to rescue. purchase_history is written AT the sale and its deal_id is synthesised in the same instant, so a sale row is not the tail of a deal record, it is the whole of it. What is known about a completed sale is answered by v_attribution_sale_chain.'),
('DEAL_EMBEDDING', 70, false, 'REFUSED',
 'A deals_embeddings row.',
 'Written in the same second as the sale from the same payload and keyed on the identical synthesised deal_id. It is a RAG mirror of purchase_history, not an independent deal record.'),
('APPROVED_UNEXECUTED_INVENTORY_ACTION', 80, false, 'REFUSED',
 'An inventory_actions row with status APPROVED and executed_at null.',
 'A stalled action on a unit is not a stalled deal: there is no customer, no agreed price and no transaction - only a decision somebody has not carried out. The Inventory Action Center owns it and reports it. 1 such row exists today (NX-1010, REPRICE, approved 02 Sep 2026, never executed).'),
('APPROVED_UNEXECUTED_LEAD_RECOVERY_ACTION', 90, false, 'REFUSED',
 'A lead_recovery_actions row with status APPROVED and executed_at null.',
 'Same shape, and worse: Lead Recovery already surfaces it as action_state on the lead. Raising a deal from it would double-count one piece of work and put it on two screens with two owners.');

create table if not exists public.deal_rescue_prerequisites (
  id               text primary key,
  sort             integer not null,
  requirement      text not null,
  kind             text not null check (kind in ('SCHEMA','INTEGRATION','OPERATIONAL','DATA','PRODUCT')),
  unlocks          text not null,
  unlocks_states   text[] not null default '{}',
  evidence_today   text not null,
  why_not_code     text not null
);

comment on table public.deal_rescue_prerequisites is
  'What must exist before Deal Rescue is a product, ordered by what each unlocks. This is a purchase order, not a wish list: every row names the live evidence that it is missing. v_deal_rescue_readiness re-measures the measurable ones on every read so this cannot silently go stale.';

insert into public.deal_rescue_prerequisites (id, sort, requirement, kind, unlocks, unlocks_states, evidence_today, why_not_code) values
('DEAL_RECORD', 10,
 'A deal record created at first commitment rather than at sale: a row that exists while the deal is still in flight, carrying customer, vehicle, agreed value and an owner.',
 'SCHEMA',
 'The population itself. Without it Deal Rescue has nothing to rank, and every state below is unreachable for want of rows rather than for want of logic.',
 '{ON_TRACK,AT_RISK,STALLED,CUSTOMER_GHOSTED,NEEDS_MANAGER}',
 'No deals table exists. purchase_history holds 1 row, written at the moment of sale; its deal_id is synthesised then as ''auto:<email>|<date>''. deals_embeddings mirrors that row. So DEAL_CREATED and SALE_CONFIRMED are one event and DEAL_UPDATED is emitted by nothing.',
 'The table is cheap; deciding WHO writes it and WHEN is the work. It has to be written by whatever the sales floor actually uses - the CRM or the DMS - or it will be an empty table with a form nobody fills in.'),
('DEAL_STAGE_HISTORY', 20,
 'Stage and stage_changed_at on the deal record, appended rather than overwritten.',
 'SCHEMA',
 'A stalled deal that can say WHAT it is stuck on. Today the engine can only say a deal has not moved; it cannot say it has sat in Negotiation for nine days, which is the sentence a sales manager acts on.',
 '{STALLED,AT_RISK}',
 'No stage column and no history table anywhere in the schema. Nothing records that any deal ever occupied an earlier stage.',
 'An append-only stage log is code, but it is worthless until something upstream emits stage changes - which is the same integration as DEAL_RECORD.'),
('APPOINTMENT', 30,
 'An appointments table with a lead or deal reference, a scheduled time and an outcome (kept / no-show / cancelled).',
 'INTEGRATION',
 'The strongest in-flight signal a dealership has, plus no-show recovery. One integration, two engines: it also unlocks Lead Recovery''s APPOINTMENT_PENDING, which is recorded there as UNREACHABLE_BY_DESIGN for exactly this reason.',
 '{AT_RISK,STALLED}',
 'No appointment table, no column, no event type. PRODUCT.md records the same gap.',
 'Appointments live in the dealership''s calendar or CRM. Creating a table NEXUS alone writes to would produce a diary nobody keeps.'),
('FINANCE_DECISION', 40,
 'A lender decision on finance_quotes: lender, decision, decided_at, conditions - plus quotes actually being written and kept.',
 'SCHEMA',
 'FINANCE_BLOCKED and the FINANCE_REVIEW action, which are unreachable together today and would become reachable together.',
 '{FINANCE_BLOCKED}',
 'finance_quotes has 35 columns and not one records a decision. It also holds 0 live rows (18 inserts, 15 deletes). Two independent blockers.',
 'The column is trivial. The decision comes from a bank, so the value in it is an integration.'),
('DEAL_TO_UNIT_LINK', 50,
 'A hard link from the deal (and from purchase_history) to inventory: unit id or VIN, not free text.',
 'SCHEMA',
 'Value at stake on an in-flight deal, and gross margin on a completed one. Turns "a deal is at risk" into "AED N of gross margin is at risk", which is the difference between a warning and a decision.',
 '{}',
 'v_attribution_sale_chain grades the VEHICLE hop UNKNOWN_TEXT_ONLY and MARGIN NOT_COMPUTABLE on the single sale on file: inventory.cost_aed is present on all 12 units, but nothing ties the sale to one.',
 'The column is code. Populating it means the person recording a sale has to pick the unit, which is a workflow change on the dashboard and in n8n.'),
('SILENCE_DETECTOR_RESUMED', 60,
 'The 12-Hour Silence Detector running and succeeding again.',
 'OPERATIONAL',
 'A CUSTOMER_GHOSTED that can be trusted. Today the state can be computed from message timestamps, but the corroborating marker is worthless.',
 '{CUSTOMER_GHOSTED}',
 'Last successful run 26 Aug 2026 19:03 UTC - 7 days stale as of 03 Sep 2026. v_lead_recovery.silence_detector_state = STALE for every lead.',
 'This one is not code and not an integration. It is a paused workflow on the n8n box.'),
('DEAL_OWNER', 70,
 'An owner on the deal record - the person who acts when it stalls.',
 'DATA',
 'MANAGER_REVIEW and FOLLOW_UP that name somebody. An action with no owner is an action nobody does.',
 '{}',
 'leads.assigned_to_id is null on 2 of 3 leads. There is no deal record to hang an owner on at all.',
 'The column exists on leads and is simply unpopulated; on a deal record it does not exist yet.'),
('ACTION_LANE', 80,
 'deal_rescue_actions + deal_rescue_action_events, copied from lead_recovery_actions and reusing action_approver_context() for authority - propose, decide, execute, outcome.',
 'PRODUCT',
 'The ability to act on a rescue and be held to it, and to attribute a recovered deal to the action that saved it.',
 '{}',
 'DELIBERATELY NOT BUILT on 03 Sep 2026. The queue it would serve is structurally empty: 0 in-flight deals. An approval desk with nothing to approve is a third authority surface, a third audit vocabulary and eight more SECURITY DEFINER functions to keep out of anon''s reach, in exchange for no decision anybody can take.',
 'It is pure code and it is a near-copy of a lane that already works. Build it the day DEAL_RECORD lands, not before.'),
('VOLUME', 90,
 'One real dealership using the system.',
 'DATA',
 'Everything. Thresholds picked against 3 leads and 1 sale are guesses.',
 '{}',
 'leads = 3 (2 of them quarantined wrong-number junk), purchase_history = 1, finance_quotes = 0.',
 'Not code at any price.');

create table if not exists public.deal_rescue_settings (
  tenant_id      uuid primary key references public.tenants(id) on delete cascade,
  at_risk_days   integer,
  stalled_days   integer,
  set_by         text,
  set_at         timestamptz not null default now(),
  note           text
);

comment on table public.deal_rescue_settings is
  'Per-dealership thresholds. Deliberately empty: no row means v_deal_rescue falls back to documented defaults and reports settings_are_defaults = true, rather than pretending a dealership chose a number it never chose.';

alter table public.deal_rescue_states           enable row level security;
alter table public.deal_rescue_evidence_sources enable row level security;
alter table public.deal_rescue_prerequisites    enable row level security;
alter table public.deal_rescue_settings         enable row level security;

create policy deal_rescue_states_authenticated_read on public.deal_rescue_states
  for select to authenticated using (true);
create policy deal_rescue_states_service_role_all on public.deal_rescue_states
  for all to service_role using (true) with check (true);
create policy deal_rescue_states_deny_anon on public.deal_rescue_states
  as restrictive for all to anon using (false) with check (false);

create policy deal_rescue_evidence_sources_authenticated_read on public.deal_rescue_evidence_sources
  for select to authenticated using (true);
create policy deal_rescue_evidence_sources_service_role_all on public.deal_rescue_evidence_sources
  for all to service_role using (true) with check (true);
create policy deal_rescue_evidence_sources_deny_anon on public.deal_rescue_evidence_sources
  as restrictive for all to anon using (false) with check (false);

create policy deal_rescue_prerequisites_authenticated_read on public.deal_rescue_prerequisites
  for select to authenticated using (true);
create policy deal_rescue_prerequisites_service_role_all on public.deal_rescue_prerequisites
  for all to service_role using (true) with check (true);
create policy deal_rescue_prerequisites_deny_anon on public.deal_rescue_prerequisites
  as restrictive for all to anon using (false) with check (false);

create policy deal_rescue_settings_authenticated_read on public.deal_rescue_settings
  for select to authenticated using (tenant_id in (select public.nexus_current_tenant_ids()));
create policy deal_rescue_settings_service_role_all on public.deal_rescue_settings
  for all to service_role using (true) with check (true);
create policy deal_rescue_settings_deny_anon on public.deal_rescue_settings
  as restrictive for all to anon using (false) with check (false);

revoke all on public.deal_rescue_states           from anon, authenticated, public;
revoke all on public.deal_rescue_evidence_sources from anon, authenticated, public;
revoke all on public.deal_rescue_prerequisites    from anon, authenticated, public;
revoke all on public.deal_rescue_settings         from anon, authenticated, public;

grant select on public.deal_rescue_states           to authenticated;
grant select on public.deal_rescue_evidence_sources to authenticated;
grant select on public.deal_rescue_prerequisites    to authenticated;
grant select on public.deal_rescue_settings         to authenticated;

grant all on public.deal_rescue_states           to service_role;
grant all on public.deal_rescue_evidence_sources to service_role;
grant all on public.deal_rescue_prerequisites    to service_role;
grant all on public.deal_rescue_settings         to service_role;