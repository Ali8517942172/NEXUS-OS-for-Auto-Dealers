-- BUSINESS RULE
-- ---------------------------------------------------------------------------
-- "Which channel made me money" is the owner's favourite question. Before NEXUS
-- may answer it, it has to be able to say which hops of the revenue chain this
-- database can actually evidence and which it cannot. This migration writes
-- that map down AS DATA rather than as a paragraph in a report, so it can be
-- read on a screen, counted, and re-checked against the catalogue when the
-- schema changes.
--
-- Every hop is listed - including the ones that do not exist. An absent hop is
-- the most commercially useful row in this table: it is the integration the
-- dealership has not bought yet, and it is ordered by how much attribution
-- buying it would unlock.
--
-- Measured against the live catalogue of dsvuoovivysszdoiorch on 3 Sep 2026.
-- Global vocabulary, not tenant-scoped: it describes the SCHEMA, which is the
-- same for every dealership on this deployment. It holds no dealership data.

insert into public.attribution_link_basis
  (basis, rank, is_evidence, default_confidence, label, description) values
 ('SAME_ROW', 0, true, 'HIGH', 'Both facts are columns of one row',
  'No edge has to be established because there is nothing to join: the two facts sit on the same record. Example: a sale and its amount_aed. The strongest possible basis, and the only one that cannot break.')
on conflict (basis) do nothing;

create table if not exists public.attribution_edge_type (
  edge          text primary key,
  seq           integer not null,
  from_node     text    not null,
  to_node       text    not null,
  state         text    not null,
  basis         text    not null references public.attribution_link_basis(basis),
  source_ref    text    not null,
  finding       text    not null,
  unlocked_by   text,
  unlock_rank   integer,
  constraint attribution_edge_type_state_check check (state in (
    'PRESENT_KEYED',        -- a declared key carries it
    'PRESENT_SAME_ROW',     -- nothing to join
    'PRESENT_RESOLVED',     -- the identity rule carries it, ambiguity refused
    'PRESENT_HUMAN_ONLY',   -- only a named person can create it
    'TEXT_ONLY_REFUSED',    -- text overlaps; NEXUS refuses to call it a link
    'ABSENT_NO_FIELD',      -- no column on either side could hold it
    'ABSENT_NO_TABLE',      -- one or both ends is not data here at all
    'BLOCKED_BY_UPSTREAM')),-- computable only once an earlier hop exists
  -- A hop NEXUS cannot evidence must name the integration that would fix it.
  -- Anything less turns a sales conversation into a shrug.
  constraint attribution_edge_type_absent_has_unlock
    check (state in ('PRESENT_KEYED','PRESENT_SAME_ROW','PRESENT_RESOLVED','PRESENT_HUMAN_ONLY')
           or (unlocked_by is not null and unlock_rank is not null))
);

comment on table public.attribution_edge_type is
  'The revenue attribution chain, hop by hop, with what this schema can and cannot evidence for each. Written 3 Sep 2026 against the live catalogue. A row whose state starts ABSENT_ or TEXT_ONLY_ is a hop where NEXUS must render UNKNOWN and say why; unlocked_by names the integration that would change that and unlock_rank orders those by how much attribution each would buy.';
comment on column public.attribution_edge_type.finding is
  'What was actually measured on 3 Sep 2026, in plain commercial language. This is the audit, not a description of intent.';
comment on column public.attribution_edge_type.unlock_rank is
  'Priority order for the integrations that would close the broken hops. 1 buys the most attribution.';

insert into public.attribution_edge_type
 (edge, seq, from_node, to_node, state, basis, source_ref, finding, unlocked_by, unlock_rank) values

('CAMPAIGN_TO_LEAD', 10, 'campaign', 'lead', 'ABSENT_NO_TABLE', 'NO_SOURCE_TABLE',
 'no campaigns table in any schema; leads.source',
 'THE WEAKEST LINK, AND THE ONE THE OWNER CARES MOST ABOUT. There is no campaigns table anywhere in this database - not in public, not in any other schema. leads.source exists but holds the name of the internal workflow that created the row: "nexus-master-router" on 3 of 3 leads, one distinct value. It is a pipeline label, not a marketing channel. There is no utm field, no ad id, no click id, no referrer and no landing-page record. "Which channel made me money" CANNOT BE ANSWERED TODAY, at any confidence, and no view in this migration set will pretend otherwise.',
 'A lead-capture path that writes the channel, campaign and click id onto the lead at creation (Meta/Google lead ads, the website form, Dubizzle/YallaMotor feeds), plus a campaigns table to name them.', 1),

('CAMPAIGN_ENROLMENT', 11, 'campaign', 'lead', 'ABSENT_NO_TABLE', 'NO_SOURCE_TABLE',
 'n8n 7-Day Warm Lead Drip Campaign; audit_log',
 'Enrolment into the 7-day drip is queued inside n8n and lands in no table here. audit_log holds 5 rows for "7-Day Warm Lead Drip Campaign" and 0 of them carry a lead_email, so not one of them can be attached to a person. A lead can be enrolled while this database has no record that it happened.',
 'An enrolment table written by the drip workflow at enrol time, carrying tenant, lead and campaign.', 4),

('CAMPAIGN_SEND_TO_ENGAGEMENT', 12, 'send', 'open/click/reply', 'ABSENT_NO_TABLE', 'NO_SOURCE_TABLE',
 'nothing',
 'No table records a delivery, an open, a click or an unsubscribe. A Gmail send leaves no event behind here. This is not a figure that is missing - it is a figure that has never existed in this database.',
 'A sending provider that posts delivery and engagement webhooks into a table this database can read.', 7),

('LEAD_TO_CONVERSATION', 20, 'lead', 'message', 'PRESENT_RESOLVED', 'RESOLVED_IDENTITY',
 'v_lead_messages; nexus_lead_for_comm_key(text,uuid); lib/identity.js',
 'REAL, but by rule rather than by key. communication_logs.lead_email is one text column holding four incompatible key shapes for the same person. The identity rule resolves 53 of 108 rows across 15 distinct keys; the rest belong to WhatsApp handles that match no lead. Unresolved is UNKNOWN, not "no conversation".',
 null, null),

('LEAD_TO_VEHICLE', 30, 'lead', 'inventory unit', 'TEXT_ONLY_REFUSED', 'MODEL_TEXT_ONLY',
 'leads.vehicle_interest vs inventory.model, via nexus_model_tokens()',
 'leads carries NO vehicle reference - no VIN, no stock number, no inventory id. vehicle_interest is free text a customer typed. Lead 38 reads "Hi, I saw the lexus LX 600 2024 on your website. Is it still available?" which shares model words with NX-1011, and that is a prompt for a person, not a link. Two of the three leads have vehicle_interest holding an operator note about a wrong number, not a vehicle at all.',
 'A vehicle picker on the lead form, or a website enquiry that posts the stock number the customer was looking at.', 3),

('CONVERSATION_TO_VEHICLE', 40, 'message', 'inventory unit', 'TEXT_ONLY_REFUSED', 'MODEL_TEXT_ONLY',
 'communication_logs.message vs inventory.model, via nexus_model_tokens()',
 'Same refusal as LEAD_TO_VEHICLE. The Profit Sentinel already counts these token overlaps as an enquiry signal and already caps its own confidence because of them - its enquiry_coverage reads INSUFFICIENT today. Attribution holds the harder line: a token overlap is not an edge.',
 'The BDC agent recording the unit it quoted, at the moment it quotes it.', 5),

('LEAD_TO_DEAL', 50, 'lead', 'sale record', 'PRESENT_KEYED', 'FOREIGN_KEY',
 'purchase_history.lead_id -> leads(id)',
 'THE ONE STRONG LINK IN THE CHAIN. Added 2 Sep 2026 and populated on the one real sale (lead 38). It is written only when the deal was picked from a lead in the dashboard; a hand-typed deal posts no lead_id at all, so NULL here is a normal state meaning "nobody recorded it", never "no lead exists".',
 null, null),

('DEAL_TO_DEAL_RECORD', 55, 'sale record', 'deal embedding', 'PRESENT_KEYED', 'NATURAL_KEY_MATCH',
 'purchase_history.deal_id = deals_embeddings.deal_id',
 'Both rows carry the identical synthetic key "auto:<email>|<date>". Scoped per dealership since 2 Sep. Exact, but unenforced - there is no FOREIGN KEY behind it, so a writer could break it without the database objecting.',
 null, null),

('DEAL_TO_VEHICLE', 60, 'sale record', 'inventory unit', 'ABSENT_NO_FIELD', 'NO_LINK_FIELD',
 'purchase_history has no vin, no stock number, no inventory id; inventory_actions.outcome_purchase_id is the only route',
 'THE BREAK THAT COSTS THE MOST MONEY. purchase_history holds no reference to an inventory unit of any kind. The one real sale reads "Lexus LX 600 2024" at AED 585,000 - character-for-character the model of unit NX-1011 and exactly its list price - and NX-1011 is STILL MARKED AVAILABLE. The text matches perfectly and proves nothing. The only route that exists today is a person confirming it through action_record_outcome(), which stores HUMAN_CONFIRMED_LINK; 0 of the 3 inventory actions have done so.',
 'A stock number or VIN column on the sale, written by whatever records the sale. The dashboard deal form is the cheapest place to add it.', 2),

('DEAL_TO_MARGIN', 65, 'sale record', 'gross profit', 'BLOCKED_BY_UPSTREAM', 'NO_LINK_FIELD',
 'inventory.cost_aed, reachable only through DEAL_TO_VEHICLE',
 'Revenue on a sale is CONFIRMED - it is a column of the sale. Gross profit on a sale is NOT COMPUTABLE, because the cost sits on the inventory unit and nothing ties the sale to a unit. So NEXUS can tell this dealership what it sold for and cannot tell it what it made. Unknown, not zero.',
 'Whatever unlocks DEAL_TO_VEHICLE. Nothing else is needed - cost_aed is already present on all 12 units.', 2),

('UNIT_ACTION_TO_DEAL', 66, 'inventory action', 'sale record', 'PRESENT_HUMAN_ONLY', 'HUMAN_CONFIRMED_LINK',
 'inventory_actions.outcome_purchase_id -> purchase_history(id)',
 'A real foreign key, but one only a named person can populate, via action_record_outcome(). It exists precisely because DEAL_TO_VEHICLE does not. 3 actions exist, 0 are ATTRIBUTED, so this key has never been exercised on live data. It works; it does not scale past a few sales a month.',
 null, null),

('LEAD_TO_FINANCE', 70, 'lead', 'finance quote', 'PRESENT_RESOLVED', 'RESOLVED_IDENTITY',
 'finance_quotes.lead_email',
 'Resolvable by the same identity rule, but finance_quotes holds 0 rows today, so this hop has never carried a real edge. Note that screens/finance.js joins the raw lead_email string rather than importing lib/identity.js - narrower than the rule, so it will MISS a customer rather than misattribute one.',
 null, null),

('DEAL_TO_FINANCE', 75, 'sale record', 'finance quote', 'ABSENT_NO_FIELD', 'NO_LINK_FIELD',
 'neither table references the other',
 'purchase_history carries no quote id and no calculation_id; finance_quotes carries no sale id. NEXUS cannot say whether a sale was financed, at what rate, or by whom - only that a quote and a sale exist for the same person. Two quotes for one person and one sale would be unattributable.',
 'A calculation_id column on the sale, populated from the quote the deal actually closed on.', 8),

('DEAL_TO_REVENUE', 80, 'sale record', 'revenue', 'PRESENT_SAME_ROW', 'SAME_ROW',
 'purchase_history.amount_aed',
 'CONFIRMED revenue - not attributed, not estimated. AED 585,000 on the one sale. It is a column of the sale record, so there is no edge to break.',
 null, null),

('DEAL_TO_SERVICE', 90, 'sale record', 'service visit', 'ABSENT_NO_TABLE', 'NO_SOURCE_TABLE',
 'nothing',
 'No service table, no appointment table, no recon-cost column. Ownership-lifecycle attribution after the sale cannot start. Roadmap, never capability.',
 'A DMS or service-system connection.', 9),

('DEAL_TO_REPEAT_PURCHASE', 95, 'sale record', 'later sale', 'PRESENT_KEYED', 'FOREIGN_KEY',
 'purchase_history.lead_id, two sales sharing one lead',
 'Structurally sound the moment a second sale exists: two purchase_history rows carrying the same lead_id are the same customer by key, not by guess. Unexercised - there is one sale in the whole database.',
 null, null)
on conflict (edge) do nothing;

create table if not exists public.attribution_event_type (
  event      text primary key,
  seq        integer not null,
  state      text    not null,
  source_ref text    not null,
  finding    text    not null,
  constraint attribution_event_type_state_check
    check (state in ('PRESENT','PRESENT_UNRESOLVED','PRESENT_CONFLATED','PRESENT_NO_ROWS','ABSENT_NO_SOURCE'))
);

comment on table public.attribution_event_type is
  'The eight events the attribution graph models, and whether this database can actually produce each. An event with state ABSENT_NO_SOURCE is emitted by nothing and must never be inferred from the absence of a row - a missing row is not proof the event did not happen (INV-007).';

insert into public.attribution_event_type (event, seq, state, source_ref, finding) values
 ('LEAD_CREATED',     10, 'PRESENT',            'leads.created_at',
  'Real. 3 rows, all created by the WhatsApp -> Router wiring; 2 of the 3 were auto-created in error and are quarantined as DISQUALIFIED.'),
 ('MESSAGE_RECEIVED', 20, 'PRESENT',            'communication_logs, direction=inbound, filtered by nexus_is_message()',
  'Real. Filtered by the message predicate so a silence marker is not counted as a message (INV-004).'),
 ('MESSAGE_SENT',     30, 'PRESENT',            'communication_logs, direction=outbound, filtered by nexus_is_message()',
  'Real. Same predicate. Outbound rows on channel "system" are the dealership writing ABOUT a conversation rather than inside it, and are excluded.'),
 ('VEHICLE_INTEREST', 40, 'PRESENT_UNRESOLVED', 'leads.vehicle_interest; inbound communication_logs.message',
  'The event exists; the vehicle it points at does not resolve to a unit. Emitted with the unit UNKNOWN and the reason attached, never with a guessed unit.'),
 ('DEAL_CREATED',     50, 'PRESENT_CONFLATED',  'purchase_history.created_at',
  'purchase_history only ever records a CLOSED-WON deal. There is no open-deal record, so DEAL_CREATED and SALE_CONFIRMED are the same row and cannot be separated in time. The gap between them - the part of the funnel where deals are lost - is invisible.'),
 ('DEAL_UPDATED',     60, 'ABSENT_NO_SOURCE',   'nothing',
  'No deal-stage table, no status column on the sale, no history table. Nothing in this database records a deal changing. Deal Rescue is blocked on this, not on code.'),
 ('FINANCE_QUOTE',    70, 'PRESENT_NO_ROWS',    'finance_quotes.created_at',
  'The table and the write path exist and have worked before; the table holds 0 rows today because a journey teardown clears them. Empty means cleared, not never.'),
 ('SALE_CONFIRMED',   80, 'PRESENT',            'purchase_history.purchase_date',
  'Real. One row. AED 585,000 on 2 Sep 2026, carrying lead_id 38.')
on conflict (event) do nothing;

alter table public.attribution_edge_type  enable row level security;
alter table public.attribution_event_type enable row level security;

drop policy if exists attribution_edge_type_read on public.attribution_edge_type;
create policy attribution_edge_type_read on public.attribution_edge_type
  for select to authenticated using (true);
drop policy if exists attribution_edge_type_deny_anon on public.attribution_edge_type;
create policy attribution_edge_type_deny_anon on public.attribution_edge_type
  as restrictive for all to anon using (false);
drop policy if exists attribution_edge_type_service_role_all on public.attribution_edge_type;
create policy attribution_edge_type_service_role_all on public.attribution_edge_type
  for all to service_role using (true) with check (true);

drop policy if exists attribution_event_type_read on public.attribution_event_type;
create policy attribution_event_type_read on public.attribution_event_type
  for select to authenticated using (true);
drop policy if exists attribution_event_type_deny_anon on public.attribution_event_type;
create policy attribution_event_type_deny_anon on public.attribution_event_type
  as restrictive for all to anon using (false);
drop policy if exists attribution_event_type_service_role_all on public.attribution_event_type;
create policy attribution_event_type_service_role_all on public.attribution_event_type
  for all to service_role using (true) with check (true);

revoke all on public.attribution_edge_type  from anon, public;
revoke all on public.attribution_event_type from anon, public;
revoke all on public.attribution_edge_type  from authenticated;
revoke all on public.attribution_event_type from authenticated;
grant select on public.attribution_edge_type  to authenticated, service_role;
grant select on public.attribution_event_type to authenticated, service_role;
