-- D2. The Deal Rescue platform tables were storing ONE dealership's measured
-- counts as prose, in columns with no tenant_id.
--
-- What the table is, decided before any SQL was written. The nine
-- prerequisites are the PRODUCT'S, not a dealership's: a deal record, a stage
-- history, an appointments integration, a lender decision, a deal-to-unit
-- link, a running detector, an owner, an action lane, volume. Every dealership
-- needs all nine before Deal Rescue can rank anything, and none of them
-- belongs to a dealership. So the table is right to have no tenant_id, and
-- id / sort / requirement / kind / unlocks / unlocks_states / why_not_code are
-- platform vocabulary.
--
-- evidence_today was the odd one out, and it was doing two jobs at once. Some
-- of it is a platform fact ("No appointment table, no column, no event type").
-- The rest is ALBA CARS' measurement, frozen on 3 September:
--
--   "purchase_history holds 1 row"        "12 units"
--   "leads = 3 (2 of them quarantined wrong-number junk)"
--   "0 live rows (18 inserts, 15 deletes)"
--   "Last successful run 26 Aug 2026 19:03 UTC"
--
-- Onboard a second dealership and their Deal Rescue screen prints those as
-- theirs. No row leaks; a sentence does, which is why no tenancy sweep here
-- has ever seen it - every sweep looks for tenant_id and this table has none.
-- This is the policy_rule jurisdiction lesson one layer down: the rule is the
-- platform's, the measurement is the dealership's, and they may not share a
-- column.
--
-- IT IS WIDER THAN REPORTED. The same shape is in three more columns of two
-- more tables in the same family, all rendered to a dealership and all with no
-- tenant_id:
--
--   deal_rescue_prerequisites.unlocks    VOLUME - "3 leads and 1 sale"
--   deal_rescue_states.requires          FINANCE_BLOCKED - "holds 0 live rows"
--                                        CUSTOMER_GHOSTED - "last succeeded
--                                        26 Aug 2026 19:03 UTC"
--   deal_rescue_evidence_sources.verdict_basis
--                                        "0 live rows today (18 inserts, 15
--                                        deletes)", "All 3 rows on file
--                                        today", and the sharpest of the lot:
--                                        "1 such row exists today (NX-1010,
--                                        REPRICE, approved 02 Sep 2026, never
--                                        executed)" - one dealership's stock
--                                        number and the date somebody approved
--                                        an action on it.
--
-- The measurement already has a tenant-scoped home and always did.
-- v_deal_rescue_readiness computes met_now and measured_now on every read,
-- through the caller's own RLS - "visible to this caller". So the stored prose
-- was also a SECOND DERIVATION of a figure the view already derives live, and
-- a stale one. No new table is needed. The platform table stops carrying the
-- measurement; the live one carries it, per dealership, as it already did.
--
-- Every platform claim restated below was re-measured against the live
-- catalogue on 6 Sep 2026: no deals table, no appointments table, no
-- deal_rescue_actions table, 0 columns named "stage" in schema public,
-- finance_quotes 35 columns and 0 decision-shaped, purchase_history 0
-- unit-link columns, leads.assigned_to_id present.

alter table public.deal_rescue_prerequisites
  rename column evidence_today to platform_evidence;

comment on column public.deal_rescue_prerequisites.platform_evidence is
  'What is true of the NEXUS platform - schema, code, product decisions - for '
  'every dealership alike. A count of one dealership''s leads, units, sales or '
  'quotes may never be stored here: that is v_deal_rescue_readiness.measured_now, '
  'which measures it live through the caller''s own row-level security.';

update public.deal_rescue_prerequisites set platform_evidence =
  'No deals table exists in this schema, so there is nothing to rank. '
  'purchase_history is written at the moment of sale and its deal_id is '
  'synthesised then as ''auto:<email>|<date>''; deals_embeddings mirrors that '
  'row. So DEAL_CREATED and SALE_CONFIRMED are one event and DEAL_UPDATED is '
  'emitted by nothing. What any one dealership holds is measured live in this '
  'view rather than stored here.'
 where id = 'DEAL_RECORD';

update public.deal_rescue_prerequisites set platform_evidence =
  'No stage column and no history table anywhere in schema public. Nothing '
  'records that any deal ever occupied an earlier stage.'
 where id = 'DEAL_STAGE_HISTORY';

update public.deal_rescue_prerequisites set platform_evidence =
  'No appointment table, no column, no event type. PRODUCT.md records the same gap.'
 where id = 'APPOINTMENT';

update public.deal_rescue_prerequisites set platform_evidence =
  'finance_quotes has 35 columns and not one records a decision - no status, no '
  'approved/declined flag, no decided_at, no conditions, no lender. That '
  'blocker is identical for every dealership. Whether a given dealership has '
  'any finance quotes on file at all is a second, separate blocker, and it is '
  'measured live in this view rather than stored here.'
 where id = 'FINANCE_DECISION';

update public.deal_rescue_prerequisites set platform_evidence =
  'purchase_history carries no unit id, no VIN and no inventory reference - '
  'only a free-text vehicle field - so v_attribution_sale_chain grades the '
  'VEHICLE hop UNKNOWN_TEXT_ONLY and MARGIN NOT_COMPUTABLE. An acquisition cost '
  'on the unit does not help while nothing ties a sale to a unit.'
 where id = 'DEAL_TO_UNIT_LINK';

update public.deal_rescue_prerequisites set platform_evidence =
  'The 12-Hour Silence Detector is a workflow on the n8n box, not a table in '
  'this database, so nothing about its health can be read from the schema. When '
  'it last succeeded, and for whom, is measured live in this view. A detector '
  'that has never succeeded is not the same as one that is healthy.'
 where id = 'SILENCE_DETECTOR_RESUMED';

update public.deal_rescue_prerequisites set platform_evidence =
  'There is no deal record to hang an owner on at all. leads.assigned_to_id is '
  'the only ownership column in the schema; how much of it a dealership has '
  'filled in is measured live in this view rather than stored here.'
 where id = 'DEAL_OWNER';

update public.deal_rescue_prerequisites set platform_evidence =
  'DELIBERATELY NOT BUILT on 03 Sep 2026. The queue it would serve is '
  'structurally empty for every dealership, because DEAL_RECORD above does not '
  'exist. An approval desk with nothing to approve is a third authority '
  'surface, a third audit vocabulary and eight more SECURITY DEFINER functions '
  'to keep out of anon''s reach, in exchange for no decision anybody can take.'
 where id = 'ACTION_LANE';

update public.deal_rescue_prerequisites set platform_evidence =
  'Nothing here is a schema fact. Every threshold in this engine was chosen '
  'before any dealership was using it at volume, so all of them are guesses '
  'until one is. What a dealership actually holds is measured live in this view '
  'rather than stored here.'
 where id = 'VOLUME';

update public.deal_rescue_prerequisites set unlocks =
  'Everything. Every threshold in this engine rests on it, and none of them has '
  'been calibrated against a dealership using the system at volume.'
 where id = 'VOLUME';

update public.deal_rescue_states set requires =
  'Stalled, plus v_lead_recovery.silence_state = SILENT_PAST_STALE_THRESHOLD on '
  'the lead. Silence is READ from Lead Recovery, never re-derived here - one '
  'figure, one derivation. Read with care: where the 12-Hour Silence Detector is '
  'not running and succeeding for a dealership, the ABSENCE of a silence marker '
  'is not evidence that nobody went quiet. Whether it is running, and when it '
  'last succeeded, is measured live by v_lead_recovery.silence_detector_state - '
  'it is not a fact this platform table can hold.'
 where state = 'CUSTOMER_GHOSTED';

update public.deal_rescue_states set requires =
  'A lender decision on record. finance_quotes has 35 columns and not one '
  'records a decision - no status, no approved/declined flag, no decided_at, no '
  'conditions, no lender. Whether a dealership has any finance quotes at all is '
  'a separate question, measured live rather than stored here; either gap alone '
  'would be fatal. NO BRANCH of deal_rescue_state() returns this state and none '
  'has been written; the value exists here only so the vocabulary is complete '
  'and so the prerequisite that would unlock it is named. Adding a branch '
  'before the column exists would be fabrication.'
 where state = 'FINANCE_BLOCKED';

update public.deal_rescue_evidence_sources set verdict_basis =
  'A quote is a commitment step: somebody priced a specific car for a specific '
  'person and wrote it down. That is a transaction under way rather than an '
  'enquiry, and it is the only deal-grade artefact this schema has a table for. '
  'How many quotes a dealership actually holds is measured live rather than '
  'stored here - the source is real, and it may well be unpopulated.'
 where source = 'FINANCE_QUOTE';

update public.deal_rescue_evidence_sources set verdict_basis =
  'Identity papers are normally collected to paper a transaction. Admitted only '
  'WEAKLY, because in this system the KYC workflow audits ANY image sent over '
  'WhatsApp - the document proves an image arrived, not that a deal exists. A '
  'weak candidate can only reach NEEDS_MANAGER; it never produces a risk state '
  'on its own. What a dealership''s own KYC records hold, and whether any of '
  'them was ever verified, is measured live rather than stored here.'
 where source = 'KYC_DOCUMENT_VALID';

update public.deal_rescue_evidence_sources set verdict_basis =
  'A stalled action on a unit is not a stalled deal: there is no customer, no '
  'agreed price and no transaction - only a decision somebody has not carried '
  'out. The Inventory Action Center owns it and reports it. How many such rows '
  'a dealership has, and which units they sit on, is measured live rather than '
  'stored here - a stock number belongs to the dealership that owns it and '
  'never to a platform table.'
 where source = 'APPROVED_UNEXECUTED_INVENTORY_ACTION';

-- The guard. Not documentation - a constraint that refuses the shape, so the
-- next person to paste a measured sentence into platform vocabulary is stopped
-- by the database rather than by a code review that has already missed this
-- four times.
--
-- WHAT IT CANNOT CATCH, stated rather than left to be discovered: it matches a
-- number followed within two words by a dealership noun. It does NOT catch
-- "leads = 3" (noun before number), and it does NOT catch a bare date such as
-- "last succeeded 26 Aug 2026 19:03 UTC". Both of those were live here and both
-- had to be removed by hand above. This constraint is a floor, not a proof.

alter table public.deal_rescue_prerequisites
  add constraint deal_rescue_prerequisites_holds_no_dealership_measurement
  check (
        requirement       !~* '\m[0-9][0-9,]*( +[a-z()''./-]+){0,2} +(leads?|rows?|units?|sales?|deals?|customers?|messages?|quotes?|enquir(y|ies)|inserts?|deletes?|appointments?|conversations?|vehicles?|cars?)\M'
    and unlocks           !~* '\m[0-9][0-9,]*( +[a-z()''./-]+){0,2} +(leads?|rows?|units?|sales?|deals?|customers?|messages?|quotes?|enquir(y|ies)|inserts?|deletes?|appointments?|conversations?|vehicles?|cars?)\M'
    and why_not_code      !~* '\m[0-9][0-9,]*( +[a-z()''./-]+){0,2} +(leads?|rows?|units?|sales?|deals?|customers?|messages?|quotes?|enquir(y|ies)|inserts?|deletes?|appointments?|conversations?|vehicles?|cars?)\M'
    and platform_evidence !~* '\m[0-9][0-9,]*( +[a-z()''./-]+){0,2} +(leads?|rows?|units?|sales?|deals?|customers?|messages?|quotes?|enquir(y|ies)|inserts?|deletes?|appointments?|conversations?|vehicles?|cars?)\M'
  );

comment on constraint deal_rescue_prerequisites_holds_no_dealership_measurement on public.deal_rescue_prerequisites is
  'This table has no tenant_id and is rendered to every dealership, so a '
  'counted quantity of one dealership''s leads, rows, units, sales, deals, '
  'customers, messages or quotes stored in it is a cross-tenant disclosure '
  'through a text column. Refused. It cannot catch a count written noun-first '
  '("leads = 3") or a bare date, so it is a floor and not a proof.';

alter table public.deal_rescue_states
  add constraint deal_rescue_states_holds_no_dealership_measurement
  check (
        meaning    !~* '\m[0-9][0-9,]*( +[a-z()''./-]+){0,2} +(leads?|rows?|units?|sales?|deals?|customers?|messages?|quotes?|enquir(y|ies)|inserts?|deletes?|appointments?|conversations?|vehicles?|cars?)\M'
    and blocked_by !~* '\m[0-9][0-9,]*( +[a-z()''./-]+){0,2} +(leads?|rows?|units?|sales?|deals?|customers?|messages?|quotes?|enquir(y|ies)|inserts?|deletes?|appointments?|conversations?|vehicles?|cars?)\M'
    and requires   !~* '\m[0-9][0-9,]*( +[a-z()''./-]+){0,2} +(leads?|rows?|units?|sales?|deals?|customers?|messages?|quotes?|enquir(y|ies)|inserts?|deletes?|appointments?|conversations?|vehicles?|cars?)\M'
  );

alter table public.deal_rescue_evidence_sources
  add constraint deal_rescue_evidence_sources_holds_no_dealership_measurement
  check (
        claim         !~* '\m[0-9][0-9,]*( +[a-z()''./-]+){0,2} +(leads?|rows?|units?|sales?|deals?|customers?|messages?|quotes?|enquir(y|ies)|inserts?|deletes?|appointments?|conversations?|vehicles?|cars?)\M'
    and verdict_basis !~* '\m[0-9][0-9,]*( +[a-z()''./-]+){0,2} +(leads?|rows?|units?|sales?|deals?|customers?|messages?|quotes?|enquir(y|ies)|inserts?|deletes?|appointments?|conversations?|vehicles?|cars?)\M'
  );

-- lead_recovery_states is the same shape and carries no such sentence today.
-- The floor is laid there too, while nobody is standing on it.
alter table public.lead_recovery_states
  add constraint lead_recovery_states_holds_no_dealership_measurement
  check (
        meaning    !~* '\m[0-9][0-9,]*( +[a-z()''./-]+){0,2} +(leads?|rows?|units?|sales?|deals?|customers?|messages?|quotes?|enquir(y|ies)|inserts?|deletes?|appointments?|conversations?|vehicles?|cars?)\M'
    and blocked_by !~* '\m[0-9][0-9,]*( +[a-z()''./-]+){0,2} +(leads?|rows?|units?|sales?|deals?|customers?|messages?|quotes?|enquir(y|ies)|inserts?|deletes?|appointments?|conversations?|vehicles?|cars?)\M'
    and requires   !~* '\m[0-9][0-9,]*( +[a-z()''./-]+){0,2} +(leads?|rows?|units?|sales?|deals?|customers?|messages?|quotes?|enquir(y|ies)|inserts?|deletes?|appointments?|conversations?|vehicles?|cars?)\M'
  );

-- The view. CREATE OR REPLACE cannot rename an output column, so it is dropped
-- and rebuilt. Nothing in the database depends on it; two dashboard screens do,
-- and one of them is deployed against the old column name - see the alias.
drop view if exists public.v_deal_rescue_readiness;

create view public.v_deal_rescue_readiness
with (security_invoker = true) as
select id, sort, requirement, kind, unlocks, unlocks_states, platform_evidence, why_not_code,
       met_now,
       measured_now,
       -- DEPRECATED COMPATIBILITY ALIAS. The deployed dashboard bundle selects
       -- evidence_today, and a 400 on that column would break the Deal Rescue
       -- screen the moment this migration lands. It is the SAME expression as
       -- measured_now - one derivation, computed once in the subquery below and
       -- projected twice - so a screen that has not been rebuilt yet now shows
       -- THIS dealership's own live measurement where it used to show ALBA's
       -- frozen one. Drop it once apps/executive-dashboard is redeployed.
       measured_now as evidence_today,
       measured_at
  from (
SELECT p.id,
    p.sort,
    p.requirement,
    p.kind,
    p.unlocks,
    p.unlocks_states,
    p.platform_evidence,
    p.why_not_code,
        CASE p.id
            WHEN 'DEAL_RECORD'::text THEN to_regclass('public.deals'::text) IS NOT NULL
            WHEN 'APPOINTMENT'::text THEN to_regclass('public.appointments'::text) IS NOT NULL
            WHEN 'ACTION_LANE'::text THEN to_regclass('public.deal_rescue_actions'::text) IS NOT NULL
            WHEN 'DEAL_STAGE_HISTORY'::text THEN ( SELECT count(*) > 0
               FROM information_schema.columns c
              WHERE c.table_schema::name = 'public'::name AND c.column_name::name = 'stage'::name)
            WHEN 'FINANCE_DECISION'::text THEN ( SELECT count(*) > 0
               FROM information_schema.columns c
              WHERE c.table_schema::name = 'public'::name AND c.table_name::name = 'finance_quotes'::name AND (c.column_name::name = ANY (ARRAY['decision'::name, 'lender_decision'::name, 'status'::name, 'decided_at'::name, 'lender'::name])))
            WHEN 'DEAL_TO_UNIT_LINK'::text THEN ( SELECT count(*) > 0
               FROM information_schema.columns c
              WHERE c.table_schema::name = 'public'::name AND c.table_name::name = 'purchase_history'::name AND (c.column_name::name = ANY (ARRAY['unit_id'::name, 'vin'::name, 'inventory_id'::name])))
            WHEN 'SILENCE_DETECTOR_RESUMED'::text THEN
            CASE
                WHEN (( SELECT count(*) AS count
                   FROM v_lead_recovery)) = 0 THEN NULL::boolean
                ELSE ( SELECT count(*) = 0
                   FROM v_lead_recovery r
                  WHERE r.silence_detector_state IS DISTINCT FROM 'CURRENT'::text)
            END
            WHEN 'DEAL_OWNER'::text THEN
            CASE
                WHEN (( SELECT count(*) AS count
                   FROM leads)) = 0 THEN NULL::boolean
                ELSE ( SELECT count(*) = 0
                   FROM leads l
                  WHERE l.assigned_to_id IS NULL)
            END
            WHEN 'VOLUME'::text THEN false
            ELSE NULL::boolean
        END AS met_now,
        CASE p.id
            WHEN 'DEAL_RECORD'::text THEN 'public.deals: '::text || COALESCE(to_regclass('public.deals'::text)::text, 'does not exist'::text)
            WHEN 'APPOINTMENT'::text THEN 'public.appointments: '::text || COALESCE(to_regclass('public.appointments'::text)::text, 'does not exist'::text)
            WHEN 'ACTION_LANE'::text THEN 'public.deal_rescue_actions: '::text || COALESCE(to_regclass('public.deal_rescue_actions'::text)::text, 'does not exist'::text)
            WHEN 'DEAL_STAGE_HISTORY'::text THEN (( SELECT count(*)::text AS count
               FROM information_schema.columns c
              WHERE c.table_schema::name = 'public'::name AND c.column_name::name = 'stage'::name)) || ' column(s) named "stage" anywhere in schema public'::text
            WHEN 'FINANCE_DECISION'::text THEN (((( SELECT count(*)::text AS count
               FROM finance_quotes)) || ' live finance_quotes row(s) visible to this caller; '::text) || (( SELECT count(*)::text AS count
               FROM information_schema.columns c
              WHERE c.table_schema::name = 'public'::name AND c.table_name::name = 'finance_quotes'::name AND (c.column_name::name = ANY (ARRAY['decision'::name, 'lender_decision'::name, 'status'::name, 'decided_at'::name, 'lender'::name]))))) || ' decision-shaped column(s) on finance_quotes'::text
            WHEN 'DEAL_TO_UNIT_LINK'::text THEN (( SELECT count(*)::text AS count
               FROM information_schema.columns c
              WHERE c.table_schema::name = 'public'::name AND c.table_name::name = 'purchase_history'::name AND (c.column_name::name = ANY (ARRAY['unit_id'::name, 'vin'::name, 'inventory_id'::name])))) || ' unit-link column(s) on purchase_history'::text
            WHEN 'SILENCE_DETECTOR_RESUMED'::text THEN
            CASE
                WHEN (( SELECT count(*) AS count
                   FROM v_lead_recovery)) = 0 THEN 'UNKNOWN - no leads are visible to this caller, so the detector cannot be measured. Not the same as healthy.'::text
                ELSE ((( SELECT COALESCE(max(r.silence_detector_state), 'unknown'::text) AS "coalesce"
                   FROM v_lead_recovery r)) || ', last success '::text) || COALESCE(( SELECT max(r.silence_detector_last_success_at)::text AS max
                   FROM v_lead_recovery r), 'never'::text)
            END
            WHEN 'DEAL_OWNER'::text THEN
            CASE
                WHEN (( SELECT count(*) AS count
                   FROM leads)) = 0 THEN 'UNKNOWN - no leads are visible to this caller, so ownership cannot be measured. Not the same as fully owned.'::text
                ELSE (((( SELECT count(*)::text AS count
                   FROM leads l
                  WHERE l.assigned_to_id IS NULL)) || ' of '::text) || (( SELECT count(*)::text AS count
                   FROM leads))) || ' lead(s) unassigned'::text
            END
            WHEN 'VOLUME'::text THEN (((((( SELECT count(*)::text AS count
               FROM leads)) || ' lead(s), '::text) || (( SELECT count(*)::text AS count
               FROM purchase_history))) || ' sale(s), '::text) || (( SELECT count(*)::text AS count
               FROM finance_quotes))) || ' finance quote(s) visible to this caller'::text
            ELSE NULL::text
        END AS measured_now,
    now() AS measured_at
   FROM deal_rescue_prerequisites p
  ) v;

comment on view public.v_deal_rescue_readiness is
  'The nine prerequisites, which are the platform''s, beside what is true of '
  'THIS dealership, which is measured live through the caller''s own row-level '
  'security on every read. platform_evidence may not carry a dealership''s '
  'counts; measured_now is where a dealership''s figure comes from.';

revoke all on public.v_deal_rescue_readiness from anon, public;
grant select on public.v_deal_rescue_readiness to authenticated, service_role