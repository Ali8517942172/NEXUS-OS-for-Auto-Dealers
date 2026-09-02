-- =============================================================================
-- NEXUS / ALBA CARS — SCHEMA OF RECORD
-- Supabase project: dsvuoovivysszdoiorch  ·  schema: public
--
-- Generated 2026-09-02 05:01 UTC by direct introspection of the live catalogue
-- (pg_class, pg_attribute, pg_constraint, pg_description, pg_indexes,
--  pg_policies, pg_get_viewdef, pg_get_functiondef, pg_get_triggerdef,
--  pg_extension, relacl/proacl, cron.job, storage.buckets).
--
-- Latest migration seen at generation time:
--   20260902050255_inv008_pipeline_open_rule_pin_search_path
-- The previous edition of this file was generated 2026-08-30; 38 migrations
-- landed between the two. FOUR of those landed WHILE this pass was running and
-- were picked up on deliberate re-checks:
--   20260902045735 inv002_purchase_history_lead_id
--   20260902050016 inv008_pipeline_open_leads_one_rule        (nexus_lead_is_open, v_team_performance)
--   20260902050104 inv008_pipeline_daily_metrics_open_leads   (capture_daily_metrics, daily_metrics.pipeline_aed_rule)
--   20260902050255 inv008_pipeline_open_rule_pin_search_path  (nexus_lead_is_open SET search_path TO '')
-- Migrations are still being applied to this project as of the generation
-- timestamp. Re-run the currency check below before relying on this file.
--
-- HOW TO TELL WHETHER THIS FILE IS STILL CURRENT
--   select max(version) from supabase_migrations.schema_migrations;
-- If that is greater than 20260902050255, migrations have landed since and
-- this file is behind by exactly that much. It does not self-update.
--
-- THIS FILE IS AUTHORITATIVE. It describes what is actually in the database.
--   architecture/supabase_schema.HISTORICAL.sql  and
--   architecture/database_schema.HISTORICAL.sql
--   describe a database that has never existed. Do not run either. See DRIFT.md.
--
-- Properties of this file:
--   * Idempotent at object granularity — CREATE ... IF NOT EXISTS,
--     CREATE OR REPLACE, DROP POLICY IF EXISTS before CREATE POLICY.
--   * Dependency-ordered — extensions, sequences, tables, indexes, functions,
--     triggers, views, RLS, policies, grants. Running it against an EMPTY
--     Postgres 15+ database with the Supabase roles present reproduces the
--     live structure.
--   * Caveat: because tables are created with IF NOT EXISTS and their
--     constraints are declared inline, this file will NOT repair a table that
--     already exists in a partially-correct shape. It creates or it skips.
--
-- WHAT THIS EDITION IS AND IS NOT
-- It is a transcription of the live catalogue, object by object, on the date
-- above. Unlike the 2026-08-30 edition it has NOT been replayed against an
-- empty cluster and diffed; do not read the absence of that claim as a defect,
-- but do not repeat the older edition's "VERIFIED by replay" wording either.
-- Counts compared this pass, all read from the live catalogue at the timestamp
-- above: 16 tables / 192 table columns, 36 constraints, 56 indexes (PK- and
-- UNIQUE-backed included), 11 functions, 2 triggers, 9 views, 30 RLS policies,
-- 1 cron job, 1 storage bucket, 52 comments.
--
-- Business context: NEXUS is the lead-to-close automation for a Dubai used-car
-- dealership. n8n workflows write; the executive dashboard (apps/executive-
-- dashboard) reads, almost always through the v_* views.
--
-- SECTION 11 AT THE END lists every object the previous edition documented that
-- no longer exists live. Read it before trusting an old copy of this file.
-- =============================================================================


-- =============================================================================
-- 1. EXTENSIONS
-- =============================================================================
-- pgcrypto (gen_random_uuid) and uuid-ossp live in the `extensions` schema on
-- Supabase and are pre-installed; listed here for completeness.
CREATE EXTENSION IF NOT EXISTS pgcrypto  WITH SCHEMA extensions;   -- 1.3, gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions; -- 1.1

-- vector 0.8.2 — pgvector, installed in `public`. Used only by deals_embeddings.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- pg_trgm 1.6 — installed in `public`. Used by search_rag_documents() tier 3
-- (word_similarity) and by rag_documents_trgm_idx.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- pg_cron 1.6.4 — enabled from the Supabase dashboard, lands in pg_catalog.
-- It runs exactly one job; see section 9.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Also present, platform-managed, not created by this project:
--   plpgsql 1.0 (pg_catalog), pg_stat_statements 1.11 (extensions),
--   supabase_vault 0.3.1 (vault).


-- =============================================================================
-- 2. SEQUENCES
-- Three tables use integer surrogate keys rather than uuid.
-- =============================================================================
CREATE SEQUENCE IF NOT EXISTS public.leads_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.competitors_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.rag_documents_id_seq;


-- =============================================================================
-- 3. TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- users — the dealership's own staff, not customers.
-- Referenced by leads.assigned_to_id and kyc_documents.reviewed_by. `role` is
-- read by assign_hot_lead(), which only ever picks from
-- ('senior_rep','sales_rep','manager') and skips status = 'pending_invite'.
-- Written by the dashboard Settings screen; read by v_team_performance.
-- NOTE: this is public.users, a plain application table. It is NOT auth.users
-- and there is no foreign key between the two.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text,
    email        text UNIQUE,
    role         text,
    status       text,
    slack_user_id text,
    created_at   timestamptz DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- leads — the pipeline. One row per person who has enquired, from any channel.
-- Created by nexus_master_lead_router_ai_agent (webhook, and the WhatsApp BDC
-- path); updated by lead_escalation_ai_agent, phase_6_12_hour_silence_detector,
-- slack_command_center_ai_agent and wf_108_erp_sync_bitrix24_crm.
--
-- status is FREE TEXT and is written in UPPER CASE: HOT / WARM / COLD /
-- DISQUALIFIED and others. There is deliberately NO CHECK constraint on it —
-- see DRIFT.md, item 2. What counts as an OPEN lead is decided by
-- public.nexus_lead_is_open(status), not by a column.
--
-- email doubles as the correlation key for the whole system: when a lead
-- arrives over WhatsApp with no address, the router mints the synthetic
-- '+<digits>@whatsapp.lead'. communication_logs.lead_email, kyc_documents,
-- finance_quotes and whatsapp_contacts all join back on this value.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leads (
    id                    integer NOT NULL DEFAULT nextval('public.leads_id_seq') PRIMARY KEY,
    name                  text NOT NULL,
    email                 text,
    phone                 text,
    source                text,
    vehicle_interest      text,
    budget_aed            integer,
    status                text,
    ai_score              integer,
    assigned_to           text,   -- display name, denormalised from users.name
    response_time_minutes integer,
    created_at            timestamptz DEFAULT now(),
    assigned_to_id        uuid REFERENCES public.users(id) ON DELETE SET NULL,
    escalated_at          timestamptz,
    bitrix_lead_id        text,
    crm_synced_at         timestamptz,
    CONSTRAINT leads_response_time_nonneg
      CHECK (response_time_minutes IS NULL OR response_time_minutes >= 0)
);
ALTER SEQUENCE public.leads_id_seq OWNED BY public.leads.id;

COMMENT ON COLUMN public.leads.response_time_minutes IS
  'Minutes from lead creation to the first genuine reply. NULL means NOT MEASURED - it does not mean unanswered. A reply logged before the lead row (the normal ordering when the bot answers and the router mints the lead afterwards) leaves NULL unless it is clock skew with no prior inbound, in which case it is 0. Written only by nexus_mark_first_response on communication_logs AFTER INSERT, first write wins.';
COMMENT ON COLUMN public.leads.escalated_at IS
  'Set by the Lead Escalation workflow when a lead is escalated to a manager. Null means never escalated. Does not change status.';
COMMENT ON COLUMN public.leads.bitrix_lead_id IS
  'Bitrix24 CRM lead ID, written by wf_108 after a confirmed create/update. Primary identity key on the next sync - checked before any duplicate probe.';
COMMENT ON COLUMN public.leads.crm_synced_at IS
  'Last CONFIRMED push to Bitrix24. Null or stale = eligible for the next ERP sync run. Also the "our data is this old" side of the Bitrix DATE_MODIFY comparison in Build Update Payload.';

-- -----------------------------------------------------------------------------
-- communication_logs — every message in or out, on any channel. The transcript.
-- Written by whatsapp_bdc_ai_agent, whatsapp_send_dashboard_reply,
-- 7_day_warm_lead_drip_campaign, lead_escalation_ai_agent,
-- kyc_aml_document_auditor and phase_6_12_hour_silence_detector.
-- Read through v_conversations and v_lead_messages by the dashboard.
--
-- lead_email is NOT always an email. It is whatever addresses the counterparty:
-- a real address, a synthetic '+<digits>@whatsapp.lead', or a raw WhatsApp chat
-- id ('<digits>@lid' / '<digits>@c.us'). v_conversations, v_lead_messages and
-- nexus_lead_for_comm_key exist to collapse those spellings onto one person.
--
-- Not every row is a message to a customer. public.nexus_is_message() is the
-- single predicate that separates real traffic from internal markers; anything
-- counting conversation volume must go through it.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.communication_logs (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_email text,
    channel    text,          -- 'whatsapp' | 'email' | 'sms' | 'system'
    direction  text,          -- 'inbound' | 'outbound'
    message    text,
    created_at timestamptz DEFAULT now(),
    sent_by    text
);

COMMENT ON COLUMN public.communication_logs.sent_by IS
  'Who produced an OUTBOUND message. Reserved automation tokens: bot (whatsapp_bdc_ai_agent), drip, kyc, system, router, outreach, silence. Anything else is a person — in practice the lowercased email of the Supabase user whose JWT authorised the dashboard send, or the literal "dashboard" when that user has no email. NULL = unrecorded: either an INBOUND row (the customer sent it; `direction` already says so) or any row written before 30 Aug 2026. Readers must treat NULL as "not a human", never as "human". Any NEW automated writer MUST add itself to the reserved list here AND to the not.in.(...) filter in whatsapp_bdc_ai_agent -> Human Reply Check, or its messages will be mistaken for a sales rep and will silence the bot for 30 minutes each time.';

-- -----------------------------------------------------------------------------
-- inventory — the cars on the lot. One row per unit; id is the dealer stock
-- number (text), not a uuid. Populated and priced by hand / by the dashboard
-- Inventory screen; the money columns (days_in_stock, holding_cost_accrued,
-- gross_margin, net_margin, vat_amount, recommended_commission, aging_alert)
-- are DERIVED and are recomputed wholesale by recompute_inventory_derived(),
-- which inventory_ageing_recompute calls on a schedule. Do not hand-edit them.
--
-- cost_aed is what the dealership PAID. It must never be readable by anon and
-- must never reach a customer-facing agent — that is what v_inventory_sales is
-- for. Point every customer-facing tool at the view, never at this table.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory (
    id                     text PRIMARY KEY,
    model                  text NOT NULL,
    vin                    text,
    status                 text,        -- lower('sold') is the only value the recompute reads
    days_in_stock          integer,
    price_aed              integer,
    cost_aed               integer,
    gross_margin           integer,
    holding_cost_accrued   integer,
    net_margin             integer,
    recommended_commission integer,
    vat_amount             integer,
    aging_alert            text,        -- 'HEALTHY' | 'WARNING' | 'CRITICAL'
    ai_recommendation      text,
    acquired_at            date DEFAULT CURRENT_DATE
);

COMMENT ON COLUMN public.inventory.acquired_at IS
  'Date the unit entered stock. days_in_stock, holding_cost_accrued and aging_alert are derived from this; acquired_at is the source of truth.';

-- -----------------------------------------------------------------------------
-- competitors — scraped competitor listings for models we also hold.
-- Written only by competitor_price_scraping_supabase_update. price_diff_aed is
-- our_price_aed - price_aed; negative means a rival is cheaper, which is what
-- v_needs_attention surfaces as an 'undercut'.
--
-- EVERY SCRAPE APPENDS A ROW. This table is price history, not a list of cars.
-- Counting it counts scrapes. Read v_competitor_latest for anything else.
-- The seven provenance columns (added 2026-09-01) exist because the earlier
-- shape could not say whether a compared price was even the same vehicle.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competitors (
    id                integer NOT NULL DEFAULT nextval('public.competitors_id_seq') PRIMARY KEY,
    competitor        text NOT NULL,
    model             text,
    price_aed         integer,
    our_price_aed     integer,
    price_diff_aed    integer,
    ai_recommendation text,
    scraped_at        timestamptz DEFAULT now(),
    listing_title     text,
    source_host       text,
    source_kind       text,
    offer_name        text,
    offer_condition   text,
    match_quality     text,   -- 'exact_year' | 'model_only' | 'weak'
    match_note        text
);
ALTER SEQUENCE public.competitors_id_seq OWNED BY public.competitors.id;

COMMENT ON COLUMN public.competitors.competitor IS
  'Display name for the source. Historically the page hostname, which is why an OEM site could read as a rival dealership. source_host and source_kind are the reliable fields.';
COMMENT ON COLUMN public.competitors.model IS
  'OUR inventory model string, and the join key. It is NOT the competitor listing''s own text - that is listing_title. Anything comparing model to model is comparing our string to itself.';
COMMENT ON COLUMN public.competitors.match_quality IS
  'How much the compared price can be trusted to be the same car. exact_year = the chosen offer named our model year; model_only = model name matched but no year confirmation; weak = the price is the lowest on the page with nothing tying it to our unit.';

-- -----------------------------------------------------------------------------
-- purchase_history — closed-won deals. This is what makes someone a customer
-- rather than a lead, and what v_customer_360 turns into lifetime value / VIP.
-- Written by sync_closed_won_deals_to_supabase_pgvector; read by
-- nexus_master_lead_router_ai_agent so a returning buyer is recognised.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_history (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_name text,
    email         text,
    phone         text,
    vehicle       text,
    purchase_date date,
    amount_aed    integer,
    created_at    timestamptz DEFAULT now(),
    deal_id       text,
    lead_id       integer REFERENCES public.leads(id) ON DELETE SET NULL
);

COMMENT ON COLUMN public.purchase_history.deal_id IS
  'Deterministic id minted by the closed-won workflow; matches deals_embeddings.deal_id. Unique, so a retried webhook cannot duplicate a purchase.';
COMMENT ON COLUMN public.purchase_history.lead_id IS
  'Originating leads.id for this sale (INV-002). NULL = provenance not recorded (walk-in or hand-typed deal), never "no lead exists". ON DELETE SET NULL so removing a lead never removes the sale.';

-- -----------------------------------------------------------------------------
-- deals_embeddings — one 1536-dim OpenAI embedding per closed deal, written by
-- sync_closed_won_deals_to_supabase_pgvector alongside the purchase_history row.
-- The intended use is similarity search over past deals.
-- HONEST NOTE: the table is EMPTY on the live project (0 rows) and no workflow
-- or dashboard screen currently READS it. It is written but never queried. This
-- is the one pgvector object in the system; the "Ask AI" RAG path does not use
-- vectors at all (see rag_documents).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deals_embeddings (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id    text UNIQUE,
    content    text,
    embedding  vector(1536),
    created_at timestamptz DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- customer_360_profiles — per-customer activity counters aggregated from
-- outside systems by customer_360_data_aggregation_bitrix24. It is a cache,
-- keyed on customer_id, and only two columns are ever populated: total_emails
-- and total_slack_messages. v_customer_360 left-joins it on email for those two
-- numbers and nothing else.
--
-- Those two counters DELIBERATELY have no DEFAULT 0 any more (migration
-- 20260830173831 customer360_no_fabricated_zero). NULL means not measured. A
-- default of zero was manufacturing a fact the aggregation had not established.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_360_profiles (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id          text UNIQUE,
    name                 text,
    email                text,
    phone                text,
    total_emails         integer,
    total_slack_messages integer,
    last_synced_at       timestamptz DEFAULT now()
);

COMMENT ON COLUMN public.customer_360_profiles.total_emails IS
  'Emails seen for this customer at the last successful Gmail read, capped at 20 by the source node. NULL = not measured (read failed, or the customer has no real email address). NULL is NOT zero.';
COMMENT ON COLUMN public.customer_360_profiles.total_slack_messages IS
  'Slack mentions at the last successful search, capped at 20 by the source node. NULL = not measured. NULL is NOT zero.';

-- -----------------------------------------------------------------------------
-- finance_quotes — every indicative auto-loan quote the system has produced.
-- Written only by finance_calc_auto_loan_equity_credit_score; read by the
-- dashboard Finance screen. disclaimer is NOT NULL on purpose — a quote may
-- never be stored without the text that says it is indicative.
--
-- THE TABLE CHANGED SHAPE ON 31 AUG 2026. Two things happened:
--   1. Trade-in became OPTIONAL. vehicle_value_aed, loan_payoff_aed, equity_aed
--      and equity_status are now NULLABLE, because a cash or straight-finance
--      purchase has no trade-in and the old NOT NULLs were forcing the
--      calculator to invent one. The trade-in trio is now all-or-nothing
--      (finance_quotes_trade_in_complete) and equity_status must agree with
--      whether a trade-in is present (finance_quotes_equity_status_matches_trade_in).
--      'No trade-in' is a legal equity_status; fabricating 'Positive' to satisfy
--      a constraint is the bug those two checks exist to prevent.
--   2. The EMI half of the quote arrived: down payment, principal, tenure and a
--      monthly-instalment RANGE, plus the provenance of the rate and LTV policy
--      used. indicative_apr_pct keeps its old meaning (the LOW end) because
--      audits read that column; the upper bound is indicative_apr_high_pct.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_quotes (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_email         text,
    lead_name          text,
    quoted_by          text,
    -- trade-in (optional, all-or-nothing)
    vehicle_value_aed  bigint,
    loan_payoff_aed    bigint,
    equity_aed         bigint,
    equity_status      text,
    -- customer / policy
    credit_score       integer NOT NULL,
    loan_to_value_pct  numeric(6,2),
    finance_tier       text NOT NULL,
    indicative_apr_pct numeric(5,2) NOT NULL,
    disclaimer         text NOT NULL,
    source             text NOT NULL DEFAULT 'webhook',
    created_at         timestamptz NOT NULL DEFAULT now(),
    -- EMI / affordability (added 2026-08-31)
    vehicle_price_aed             bigint,
    max_ltv_pct                   numeric,
    min_down_payment_aed          bigint,
    down_payment_aed              bigint,
    down_payment_pct              numeric,
    down_payment_assumed          boolean,
    trade_in_equity_applied_aed   bigint,
    financed_aed                  bigint,
    tenure_months                 integer,
    monthly_payment_low_aed       bigint,
    monthly_payment_high_aed      bigint,
    total_cost_of_credit_low_aed  bigint,
    total_cost_of_credit_high_aed bigint,
    indicative_apr_high_pct       numeric,
    -- evidence / traceability
    calculation_id     uuid NOT NULL DEFAULT gen_random_uuid(),
    execution_id       text,
    calculated_at      timestamptz,
    apr_source         text,
    ltv_policy_source  text,

    CONSTRAINT finance_quotes_credit_score_check
      CHECK (credit_score >= 300 AND credit_score <= 900),
    CONSTRAINT finance_quotes_equity_status_check
      CHECK (equity_status IS NULL
             OR equity_status = ANY (ARRAY['Positive'::text,'Negative'::text,'No trade-in'::text])),
    CONSTRAINT finance_quotes_trade_in_complete
      CHECK ((vehicle_value_aed IS NULL AND loan_payoff_aed IS NULL AND equity_aed IS NULL)
             OR (vehicle_value_aed IS NOT NULL AND loan_payoff_aed IS NOT NULL AND equity_aed IS NOT NULL)),
    CONSTRAINT finance_quotes_equity_status_matches_trade_in
      CHECK ((vehicle_value_aed IS NULL AND (equity_status IS NULL OR equity_status = 'No trade-in'::text))
             OR (vehicle_value_aed IS NOT NULL
                 AND equity_status = ANY (ARRAY['Positive'::text,'Negative'::text]))),
    CONSTRAINT finance_quotes_tenure_months_check
      CHECK (tenure_months IS NULL OR (tenure_months >= 12 AND tenure_months <= 60)),
    CONSTRAINT finance_quotes_down_payment_pct_check
      CHECK (down_payment_pct IS NULL
             OR (down_payment_pct >= 0::numeric AND down_payment_pct <= 100::numeric)),
    CONSTRAINT finance_quotes_monthly_payment_range_check
      CHECK (monthly_payment_low_aed IS NULL OR monthly_payment_high_aed IS NULL
             OR monthly_payment_low_aed <= monthly_payment_high_aed),
    CONSTRAINT finance_quotes_apr_range_check
      CHECK (indicative_apr_pct IS NULL OR indicative_apr_high_pct IS NULL
             OR indicative_apr_pct <= indicative_apr_high_pct),
    CONSTRAINT finance_quotes_emi_complete
      CHECK ((monthly_payment_low_aed IS NULL AND monthly_payment_high_aed IS NULL)
             OR (financed_aed IS NOT NULL AND tenure_months IS NOT NULL
                 AND down_payment_aed IS NOT NULL))
);

COMMENT ON COLUMN public.finance_quotes.equity_status IS
  'Positive/Negative when a trade-in is present; ''No trade-in'' for a cash or straight-finance purchase. Never fabricate Positive to satisfy a constraint.';
COMMENT ON COLUMN public.finance_quotes.indicative_apr_pct IS
  'LOW end of the indicative APR range (the most favourable rate). Its meaning is unchanged and must not be redefined - audits read this column. The upper bound lives in indicative_apr_high_pct.';
COMMENT ON COLUMN public.finance_quotes.vehicle_price_aed IS
  'Sticker / agreed price of the vehicle being financed, in AED. Distinct from vehicle_value_aed, which is the value of the customer''s trade-in.';
COMMENT ON COLUMN public.finance_quotes.max_ltv_pct IS
  'Maximum loan-to-value percentage the lender policy allows for this customer/vehicle. Drives min_down_payment_aed.';
COMMENT ON COLUMN public.finance_quotes.min_down_payment_aed IS
  'Smallest down payment the policy permits, in AED: vehicle_price_aed * (1 - max_ltv_pct/100).';
COMMENT ON COLUMN public.finance_quotes.down_payment_aed IS
  'Down payment actually used in this quote, in AED.';
COMMENT ON COLUMN public.finance_quotes.down_payment_pct IS
  'down_payment_aed expressed as a percentage of vehicle_price_aed.';
COMMENT ON COLUMN public.finance_quotes.down_payment_assumed IS
  'TRUE when the customer did not state a down payment and the calculator assumed one (typically the regulatory minimum). Prevents an assumed figure being read later as a customer commitment.';
COMMENT ON COLUMN public.finance_quotes.trade_in_equity_applied_aed IS
  'Portion of trade-in equity applied against the purchase, in AED. May be less than equity_aed if the customer takes some as cash.';
COMMENT ON COLUMN public.finance_quotes.financed_aed IS
  'Principal actually financed, in AED: vehicle_price_aed - down_payment_aed - trade_in_equity_applied_aed.';
COMMENT ON COLUMN public.finance_quotes.tenure_months IS
  'Repayment term in months. CBUAE Regulation 29/2011 caps car-loan repayment at 60 months, enforced by finance_quotes_tenure_months_check.';
COMMENT ON COLUMN public.finance_quotes.monthly_payment_low_aed IS
  'Low end of the indicative monthly instalment range, in AED - corresponds to indicative_apr_pct (the low APR).';
COMMENT ON COLUMN public.finance_quotes.monthly_payment_high_aed IS
  'High end of the indicative monthly instalment range, in AED - corresponds to indicative_apr_high_pct.';
COMMENT ON COLUMN public.finance_quotes.total_cost_of_credit_low_aed IS
  'Total interest/profit paid over the full tenure at the low APR, in AED: (monthly_payment_low_aed * tenure_months) - financed_aed.';
COMMENT ON COLUMN public.finance_quotes.total_cost_of_credit_high_aed IS
  'Total interest/profit paid over the full tenure at the high APR, in AED.';
COMMENT ON COLUMN public.finance_quotes.indicative_apr_high_pct IS
  'HIGH end of the indicative APR range. Paired with indicative_apr_pct (the low end) so a quote is never read as a single optimistic rate.';
COMMENT ON COLUMN public.finance_quotes.calculation_id IS
  'Identifier of the individual calculator run that produced this quote. Defaulted so no row can exist without one; lets a quote shown to a customer be tied back to the exact computation.';
COMMENT ON COLUMN public.finance_quotes.execution_id IS
  'Workflow execution identifier (e.g. the n8n execution id) that performed the calculation, for end-to-end trace back to logs.';
COMMENT ON COLUMN public.finance_quotes.calculated_at IS
  'Wall-clock time the figures were computed, as reported by the calculator. Distinct from created_at, which is when the row reached this database.';
COMMENT ON COLUMN public.finance_quotes.apr_source IS
  'Provenance of the APR used, e.g. ''aecb_band_table_v2'' - which rate table/version supplied indicative_apr_pct and indicative_apr_high_pct.';
COMMENT ON COLUMN public.finance_quotes.ltv_policy_source IS
  'Provenance of the LTV rule applied, e.g. ''cbuae_reg_29_2011'' - which policy set max_ltv_pct and therefore min_down_payment_aed.';

-- -----------------------------------------------------------------------------
-- kyc_documents — UAE AML identity checks. One row per document SUBMISSION
-- (not per customer): attempt_number / max_attempts drive the re-upload loop in
-- kyc_aml_document_auditor_re_upload_loop_phase_5. The extracted fields
-- (full_name, date_of_birth, expiry_date, is_valid, tampering, confidence_score)
-- come from an AI vision pass over the uploaded image.
-- nexus_retention_purge deletes the Storage object once retain_until has passed
-- and stamps purged_at. The image itself lives in the PRIVATE Supabase Storage
-- bucket `kyc-documents`, reachable only through short-lived signed URLs — this
-- table holds only the object key.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kyc_documents (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_email       text,
    lead_name        text,
    chat_id          text,
    document_type    text,
    full_name        text,
    date_of_birth    text,
    expiry_date      text,
    is_valid         boolean,
    tampering        boolean,
    confidence_score integer CHECK (confidence_score >= 0 AND confidence_score <= 100),
    remarks          text,
    attempt_number   integer NOT NULL DEFAULT 1,
    max_attempts     integer NOT NULL DEFAULT 3,
    verdict          text NOT NULL DEFAULT 'PENDING'
                     CHECK (verdict = ANY (ARRAY['PENDING'::text,'APPROVED'::text,'REJECTED'::text,'ESCALATED'::text])),
    reviewed_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_at      timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    storage_path     text,
    retain_until     date,
    purged_at        timestamptz,
    void_reason      text,
    voided_at        timestamptz
);

COMMENT ON COLUMN public.kyc_documents.storage_path IS
  'Object key inside the private kyc-documents bucket. Read only via a short-lived signed URL, never a public URL. NULL with purged_at also NULL means the archive step failed for this document — a compliance gap worth alerting on.';
COMMENT ON COLUMN public.kyc_documents.retain_until IS
  'Deletion due date. Retention agreed at 7 years (UAE AML record-keeping, conservative end).';
COMMENT ON COLUMN public.kyc_documents.purged_at IS
  'Set by the NEXUS Retention Purge workflow when the Storage object was deleted after retain_until passed. NULL means the document is still archived.';
COMMENT ON COLUMN public.kyc_documents.void_reason IS
  'Set when a row is not a genuine KYC submission. Non-null means: exclude from every compliance count, verdict list and retention claim. The row is kept as evidence, never as a decision.';

-- -----------------------------------------------------------------------------
-- rag_documents — the company knowledge base behind "Ask AI". One row per
-- passage of a policy / pricing / warranty document. Queried by
-- ask_ai_rag_query_agent through search_rag_documents(), and by
-- whatsapp_bdc_ai_agent so the WhatsApp bot answers from company policy.
--
-- IMPORTANT: this is FULL-TEXT + TRIGRAM search, not vector search. search_vector
-- is a stored tsvector; there is no embedding column and no OpenAI embedding
-- call on this path. The repo files' `document_embeddings` table is not this.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rag_documents (
    id            integer NOT NULL DEFAULT nextval('public.rag_documents_id_seq') PRIMARY KEY,
    doc_title     text NOT NULL,
    section       text,
    content       text NOT NULL,
    source_file   text,
    page_number   integer,
    -- STORED GENERATED: maintained by Postgres, never written by a workflow.
    search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(content, ''::text))) STORED
);
ALTER SEQUENCE public.rag_documents_id_seq OWNED BY public.rag_documents.id;

-- -----------------------------------------------------------------------------
-- processed_messages — WhatsApp de-duplication ledger. Nothing reads it for
-- display; it exists so a redelivered webhook cannot make the bot answer twice.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.processed_messages (
    message_id   text PRIMARY KEY,
    source       text NOT NULL DEFAULT 'waha',
    chat_id      text,
    processed_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.processed_messages IS
  'One row per inbound message id already handled. Claimed atomically by the WhatsApp BDC workflow via INSERT ... on_conflict=do_nothing. Rows older than 7 days are pruned by the retention purge workflow.';

-- -----------------------------------------------------------------------------
-- whatsapp_contacts — the identity bridge for WhatsApp.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_contacts (
    chat_id       text PRIMARY KEY,
    phone         text,
    push_name     text,
    lead_email    text,
    first_seen    timestamptz NOT NULL DEFAULT now(),
    last_seen     timestamptz NOT NULL DEFAULT now(),
    message_count integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.whatsapp_contacts IS
  'One row per WhatsApp chat. chat_id is the address to reply to (often a @lid handle with no digits in it); phone is the real number from Info.SenderAlt and push_name is the contact''s own WhatsApp profile name from Info.PushName. The conversations screen shows phone and push_name, never the raw chat id.';

-- -----------------------------------------------------------------------------
-- workflow_registry — the catalogue of n8n workflows that are SUPPOSED to exist.
-- Hand-maintained; no workflow writes it. It is the left side of
-- v_workflow_health: a workflow listed here but never seen in audit_log shows as
-- NEVER_RAN, which is how the dashboard Automation screen distinguishes "broken"
-- from "not instrumented" (writes_audit_log = false).
-- audit_aliases exists because the error handler logs a workflow under its real
-- n8n name while the workflow itself logs successes under a shorter label.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workflow_registry (
    id               text PRIMARY KEY,
    name             text NOT NULL,
    audit_name       text,
    trigger_type     text NOT NULL
                     CHECK (trigger_type = ANY (ARRAY['webhook'::text,'schedule'::text,'sub-workflow'::text,'manual'::text,'error'::text])),
    trigger_detail   text,
    category         text,
    is_active        boolean NOT NULL DEFAULT true,
    description      text,
    writes_audit_log boolean NOT NULL DEFAULT false,
    audit_aliases    text[] NOT NULL DEFAULT '{}'::text[]
);

COMMENT ON COLUMN public.workflow_registry.audit_aliases IS
  'Every other string that can appear in audit_log.workflow for this workflow — in practice the real n8n workflow name, which NEXUS Error Handler writes. v_workflow_health matches on name, audit_name or any alias.';

-- -----------------------------------------------------------------------------
-- daily_metrics — one snapshot row per day, written by capture_daily_metrics()
-- on a pg_cron schedule (section 9). It is the ONLY history in the system: every
-- other table holds current state, so without this the dashboard Overview screen
-- could not draw a trend. No n8n workflow touches it.
--
-- Two counting rules changed under this table in Sept 2026, and both changes are
-- recorded IN the rows rather than by silently restating history:
--   * workflow_failures_rule / workflow_failures_canonical — a failure used to
--     be status='FAILED'; from 2026-09-02 it is
--     nexus_outcome_class(...)='FAILURE'. Old rows keep the number that was
--     published on the day; the _canonical column carries the replayed figure.
--     Any series that must be comparable across the change reads _canonical.
--   * pipeline_aed_rule — pipeline_aed used to be a COALESCE(...,0) over every
--     lead ever created. From 2026-09-02 it sums budget_aed over OPEN leads only
--     (public.nexus_lead_is_open) and is NULL, not 0, when nothing is known.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_metrics (
    snapshot_date               date PRIMARY KEY DEFAULT CURRENT_DATE,
    open_leads                  integer,
    hot_leads                   integer,
    warm_leads                  integer,
    cold_leads                  integer,
    avg_response_minutes        numeric(10,2),
    pipeline_aed                bigint,
    units_at_risk               integer,
    holding_cost_aed            bigint,
    workflow_runs               integer,
    workflow_failures           integer,
    captured_at                 timestamptz NOT NULL DEFAULT now(),
    workflow_failures_rule      text,
    workflow_failures_canonical integer,
    pipeline_aed_rule           text
);

COMMENT ON COLUMN public.daily_metrics.workflow_failures IS
  'Failure count as recorded on the day, under the rule named in workflow_failures_rule. Never restated.';
COMMENT ON COLUMN public.daily_metrics.workflow_failures_rule IS
  'Which rule produced workflow_failures: ''raw_status'' = count(status=''FAILED'') (in force to 2026-09-01); ''nexus_outcome_class'' = count(nexus_outcome_class(...)=''FAILURE'') (in force from 2026-09-02).';
COMMENT ON COLUMN public.daily_metrics.workflow_failures_canonical IS
  'The same day counted by public.nexus_outcome_class. For rows written before 2026-09-02 this is a validated replay over audit_log, not the figure that was published that day. Use this column, not workflow_failures, for any series that must be comparable across the rule change.';
COMMENT ON COLUMN public.daily_metrics.pipeline_aed_rule IS
  'INV-008. Which open-pipeline rule produced this row''s pipeline_aed. ''all_leads_coalesce_0'' = every lead in the table, no status filter, coalesced to 0 (the rule up to 2026-09-02). ''open_leads_null_when_unknown'' = open leads only, NULL when none carries a budget (the rule from 2026-09-02, matching apps/executive-dashboard/lib/pipeline.js). No pipeline_aed_canonical column exists because `leads` keeps no history and the old rows cannot be recomputed and checked, only guessed.';

-- -----------------------------------------------------------------------------
-- audit_log — the run journal for every workflow. This is the shape the whole
-- system actually posts: {workflow, status, summary} plus optional lead context.
-- Sixteen of the workflow JSONs write here, and nexus_error_handler writes the
-- FAILED rows. v_workflow_health and v_needs_attention read it.
--
-- status is upper case by constraint: SUCCESS / FAILED / ESCALATED / REJECTED /
-- PARTIAL / NOT_EXECUTED and others — the constraint enforces the CASING, not a
-- fixed vocabulary, deliberately, so a new workflow can introduce a new outcome
-- without a migration.
--
-- DO NOT READ `status` DIRECTLY to decide whether a run succeeded. The raw
-- status is the writer's word for what happened, not the system's judgement of
-- it: a REJECTED can be a healthy refusal or a silent no-op, and a SUCCESS whose
-- summary says the write "did not land" is a partial. public.nexus_outcome_class
-- (workflow, status, summary) is the single canonical mapping and every reader
-- in this file goes through it.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow   text,
    status     text CHECK (status = upper(status)),
    lead_name  text,
    lead_email text,
    lead_score numeric,
    intent     text,
    summary    text,
    logged_at  timestamptz DEFAULT now()
);


-- =============================================================================
-- 4. INDEXES
-- (Indexes backing PRIMARY KEY / UNIQUE constraints are created by section 3
--  and are not repeated here.)
-- =============================================================================

-- leads. leads_email_key is a STANDALONE unique index, not a table constraint —
-- it is what makes the router's `on_conflict=email` upsert work.
CREATE UNIQUE INDEX IF NOT EXISTS leads_email_key         ON public.leads USING btree (email);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to_id       ON public.leads USING btree (assigned_to_id);
CREATE INDEX IF NOT EXISTS idx_leads_created_at           ON public.leads USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_email                ON public.leads USING btree (email);
CREATE INDEX IF NOT EXISTS idx_leads_status               ON public.leads USING btree (status);
CREATE INDEX IF NOT EXISTS idx_leads_escalated_at         ON public.leads USING btree (escalated_at DESC NULLS LAST) WHERE (escalated_at IS NOT NULL);
-- matches the digits-only phone comparison used by nexus_lead_for_comm_key
CREATE INDEX IF NOT EXISTS idx_leads_phone_digits         ON public.leads USING btree (regexp_replace(COALESCE(phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text));
-- supports the SLA meter's "never answered" scan
CREATE INDEX IF NOT EXISTS idx_leads_unmeasured_email     ON public.leads USING btree (email) WHERE (response_time_minutes IS NULL);
-- drives wf_108's "which leads still need pushing to Bitrix24" scan
CREATE INDEX IF NOT EXISTS idx_leads_status_crm_synced    ON public.leads USING btree (status, crm_synced_at, created_at DESC);

-- communication_logs
CREATE INDEX IF NOT EXISTS idx_comm_logs_created_at       ON public.communication_logs USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_logs_lead_email       ON public.communication_logs USING btree (lead_email);

-- audit_log
CREATE INDEX IF NOT EXISTS idx_audit_log_lead_email       ON public.audit_log USING btree (lead_email);
CREATE INDEX IF NOT EXISTS idx_audit_log_logged_at        ON public.audit_log USING btree (logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_status           ON public.audit_log USING btree (status);
CREATE INDEX IF NOT EXISTS idx_audit_log_workflow         ON public.audit_log USING btree (workflow);

-- inventory
CREATE INDEX IF NOT EXISTS idx_inventory_aging            ON public.inventory USING btree (aging_alert);

-- competitors. Supports the DISTINCT ON (competitor, model) ... ORDER BY
-- scraped_at DESC that v_competitor_latest and v_needs_attention both do.
CREATE INDEX IF NOT EXISTS competitors_listing_recent_idx ON public.competitors USING btree (competitor, model, scraped_at DESC);

-- customer_360_profiles. NOTE: customer_id carries TWO unique indexes live —
-- the constraint-backed one and a standalone duplicate. Recorded as observed;
-- the duplicate is redundant, not load-bearing.
CREATE INDEX IF NOT EXISTS idx_c360_email                 ON public.customer_360_profiles USING btree (email);
CREATE UNIQUE INDEX IF NOT EXISTS customer_360_profiles_customer_id_uidx ON public.customer_360_profiles USING btree (customer_id);

-- finance_quotes
CREATE INDEX IF NOT EXISTS idx_fq_created                 ON public.finance_quotes USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fq_email                   ON public.finance_quotes USING btree (lead_email);

-- kyc_documents
CREATE INDEX IF NOT EXISTS idx_kyc_created                ON public.kyc_documents USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kyc_email                  ON public.kyc_documents USING btree (lead_email);
CREATE INDEX IF NOT EXISTS idx_kyc_verdict                ON public.kyc_documents USING btree (verdict);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_reviewed_by  ON public.kyc_documents USING btree (reviewed_by);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_void         ON public.kyc_documents USING btree (voided_at) WHERE (void_reason IS NOT NULL);
-- drives the retention purge sweep
CREATE INDEX IF NOT EXISTS kyc_documents_retention_idx    ON public.kyc_documents USING btree (retain_until) WHERE (purged_at IS NULL);

-- purchase_history. deal_id uniqueness is a PARTIAL unique index, not a
-- constraint: many rows may have no deal_id, but a deal_id may appear once.
CREATE UNIQUE INDEX IF NOT EXISTS purchase_history_deal_id_key ON public.purchase_history USING btree (deal_id) WHERE (deal_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_ph_email                   ON public.purchase_history USING btree (email);
CREATE INDEX IF NOT EXISTS idx_ph_phone                   ON public.purchase_history USING btree (phone);
CREATE INDEX IF NOT EXISTS purchase_history_lead_id_idx   ON public.purchase_history USING btree (lead_id);

-- rag_documents — the two search paths of search_rag_documents()
CREATE INDEX IF NOT EXISTS rag_documents_search_vector_idx ON public.rag_documents USING gin (search_vector);
CREATE INDEX IF NOT EXISTS rag_documents_trgm_idx          ON public.rag_documents USING gin ((COALESCE(doc_title, ''::text) || ' '::text || COALESCE(section, ''::text) || ' '::text || COALESCE(content, ''::text)) public.gin_trgm_ops);

-- users / whatsapp_contacts / processed_messages
CREATE INDEX IF NOT EXISTS idx_users_role_status           ON public.users USING btree (role, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_lead      ON public.whatsapp_contacts USING btree (lead_email);
CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_phone     ON public.whatsapp_contacts USING btree (phone);
CREATE INDEX IF NOT EXISTS processed_messages_processed_at_idx ON public.processed_messages USING btree (processed_at);

-- NOTE: deals_embeddings.embedding has NO vector index (no ivfflat, no hnsw)
-- on the live database. With 0 rows that costs nothing; if the table is ever
-- populated and queried, an index becomes necessary. Stated as observed, not
-- as a recommendation acted upon.


-- =============================================================================
-- 5. FUNCTIONS
-- Reproduced verbatim from pg_get_functiondef() on the live database.
--
-- Two families live here. The nexus_* PREDICATES (is_message, is_reply,
-- outcome_class, lead_is_open) each define ONE word the whole system argues
-- about — "message", "reply", "failure", "open" — in exactly one place, so a
-- view, a dashboard and a workflow cannot quietly disagree about it. The rest
-- are triggers and RPCs.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- nexus_is_message — the single definition of "a real message between us and a
-- customer". Either direction, on a real customer channel, excluding the
-- internal markers the silence detector writes. Direction and channel are
-- trimmed before comparison because writers have shipped ' outbound '.
-- Everything that counts conversation volume goes through this.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nexus_is_message(p_direction text, p_channel text, p_message text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select btrim(lower(coalesce(p_direction, ''))) in ('inbound', 'outbound')
     and btrim(lower(coalesce(p_channel,   ''))) in ('whatsapp', 'email', 'sms')
     and coalesce(p_message, '') not like '[system]%'
     and coalesce(p_message, '') not like '[SILENCE-%';
$function$;

-- -----------------------------------------------------------------------------
-- nexus_is_reply — a reply is a message that happens to be outbound. It DEFERS
-- to nexus_is_message rather than restating the rule, so the two can never
-- drift apart. Used by the response-time path.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nexus_is_reply(p_direction text, p_channel text, p_message text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select public.nexus_is_message(p_direction, p_channel, p_message)
     and btrim(lower(coalesce(p_direction, ''))) = 'outbound';
$function$;

-- -----------------------------------------------------------------------------
-- nexus_outcome_class — the canonical reading of an audit_log row. Maps
-- (workflow, status, summary) onto one of:
--   SUCCESS · FAILURE · PARTIAL · ESCALATED · NO_RESULT · REJECTED_EXPECTED ·
--   UNKNOWN
-- The point is that the raw status lies in two directions: a SUCCESS whose
-- summary admits the write "did not land" is a PARTIAL, and a REJECTED is only
-- healthy when it reads like an authorisation refusal — otherwise it is a run
-- that produced nothing. v_workflow_health, v_needs_attention and
-- capture_daily_metrics all read THIS, never status.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nexus_outcome_class(p_workflow text, p_status text, p_summary text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    -- 1. Bounded writer correction. See the note above; do not widen the window.
    when coalesce(p_summary,'') ~* 'did not land'
     and upper(coalesce(p_status,'')) in ('FAILED','SUCCESS')             then 'PARTIAL'
    when upper(coalesce(p_status,'')) = 'ESCALATED'                       then 'ESCALATED'
    when upper(coalesce(p_status,'')) = 'PARTIAL'                         then 'PARTIAL'
    when upper(coalesce(p_status,'')) = 'NOT_EXECUTED'                    then 'NO_RESULT'
    when upper(coalesce(p_status,'')) = 'REJECTED' then
      case when coalesce(p_summary,'') ~* 'unauthor|forbidden|refused by validation|invalid token|not permitted'
           then 'REJECTED_EXPECTED'
           else 'NO_RESULT'
      end
    when upper(coalesce(p_status,'')) = 'FAILED'                          then 'FAILURE'
    when upper(coalesce(p_status,'')) = 'SUCCESS'                         then 'SUCCESS'
    else 'UNKNOWN'
  end;
$function$;

-- -----------------------------------------------------------------------------
-- nexus_lead_is_open — the single definition of an OPEN lead, i.e. one whose
-- budget still belongs in a pipeline number. Normalisation mirrors the
-- dashboard's lib/format.js toneKey(), so 'Closed Won', 'closed-won' and
-- 'CLOSED_WON' are one word. NULL and '' are OPEN — an unset status is not
-- evidence the lead is dead. Read by v_team_performance and
-- capture_daily_metrics; keep it in step with lib/pipeline.js.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nexus_lead_is_open(p_status text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select upper(regexp_replace(coalesce(p_status, ''), '[[:space:]-]+', '_', 'g')) not in (
    -- tone 'won'
    'WON', 'CLOSED_WON', 'CONVERTED', 'DELIVERED', 'SOLD',
    -- tone 'dead'
    'LOST', 'CLOSED_LOST', 'DISQUALIFIED', 'UNQUALIFIED', 'CLOSED', 'DEAD',
    'JUNK', 'SPAM', 'ARCHIVED'
  );
$function$;

-- -----------------------------------------------------------------------------
-- nexus_comm_keys_for_lead — every spelling of a lead's address that could
-- appear in communication_logs.lead_email: the real address, the synthetic
-- '+<digits>@whatsapp.lead', the '<digits>@c.us' form, and any chat_id in
-- whatsapp_contacts tied to that lead or phone.
-- Still live and still granted to service_role, but note that its former only
-- caller (nexus_backfill_response_time) was removed on 2026-09-01 — see
-- section 11. Nothing in this file calls it now.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nexus_comm_keys_for_lead(p_email text, p_phone text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_keys   text[] := '{}';
  v_chats  text[] := '{}';
  v_digits text   := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_lead   text   := nullif(btrim(coalesce(p_email, '')), '');
  v_edig   text;
begin
  if v_lead is not null then
    v_keys := v_keys || v_lead;
    v_edig := regexp_replace(v_lead, '[^0-9]', '', 'g');
    if v_lead like '+%@whatsapp.lead' and v_edig <> '' then
      v_keys := v_keys || (v_edig || '@c.us');
      if v_digits = '' then v_digits := v_edig; end if;
    end if;
  end if;

  if v_digits <> '' then
    v_keys := v_keys || ('+' || v_digits || '@whatsapp.lead');
    v_keys := v_keys || (v_digits || '@c.us');
  end if;

  if to_regclass('public.whatsapp_contacts') is not null then
    execute 'select coalesce(array_agg(chat_id), ''{}''::text[]) from public.whatsapp_contacts '
            'where chat_id is not null and ('
            '  ($1 is not null and lead_email = $1) '
            '  or ($2 <> '''' and regexp_replace(coalesce(phone, ''''), ''[^0-9]'', '''', ''g'') = $2))'
       into v_chats using v_lead, v_digits;
    v_keys := v_keys || coalesce(v_chats, '{}'::text[]);
  end if;

  -- de-duplicate
  select coalesce(array_agg(distinct k), '{}'::text[]) into v_keys
    from unnest(v_keys) as k
   where k is not null and btrim(k) <> '';

  return v_keys;
end;
$function$;

-- -----------------------------------------------------------------------------
-- nexus_lead_for_comm_key — given whatever string is in
-- communication_logs.lead_email, find the lead it belongs to.
--
-- RETURNS INTEGER. The previous edition of this file recorded a live defect
-- here: the function was declared RETURNS uuid while leads.id is integer, so
-- any successful match raised 22P02 and blocked the message INSERT. That was
-- fixed in the database on 2026-08-30
-- (migration fix_nexus_lead_id_type_uuid_to_integer). The defect is gone; this
-- note stays so a reader holding the old file knows why it said otherwise.
--
-- Matching is in three arms:
--   (a) exact match on leads.email;
--   (b) any key CARRYING a phone number, by its last 9 digits, against both the
--       phone column and digits embedded in the email. '<lid>@lid' is excluded
--       here because a LID is an opaque WhatsApp id whose digits would collide
--       with a real number;
--   (c) '<lid>@lid' bridged through whatsapp_contacts.
-- Arms (b) and (c) both carry the INV-002 AMBIGUITY GUARD: if a nine-digit tail
-- reaches more than one distinct PERSON the function returns NULL rather than
-- the oldest match. Refusing to guess is the point — a wrong lead here would
-- attribute one customer's messages to another.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nexus_lead_for_comm_key(p_key text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_raw    text := nullif(btrim(p_key), '');
  v_digits text;
  v_tail   text;
  v_id     integer;
  v_email  text;
  v_wcdig  text;
  v_people integer;
begin
  if v_raw is null then return null; end if;

  -- (a) Exact match on the email column. Covers a real address and the
  --     synthetic whatsapp.lead one when the router stored it AS the email.
  select id into v_id from public.leads
   where email = v_raw and coalesce(email, '') <> ''
   order by created_at limit 1;
  if v_id is not null then return v_id; end if;

  -- (b) Any key CARRYING a phone number resolves by its last 9 digits, against
  --     both the phone column and digits embedded in the email. '<digits>@c.us'
  --     and '+<digits>@whatsapp.lead' both qualify. '<lid>@lid' does NOT -- a
  --     LID is an opaque WhatsApp id whose digits would collide with a real
  --     number -- so it is excluded here and bridged in (c).
  --     AMBIGUITY GUARD (INV-002): if the tail reaches more than one person the
  --     key identifies nobody, and this returns NULL rather than the oldest.
  if v_raw not like '%@lid' then
    v_digits := regexp_replace(split_part(v_raw, '@', 1), '[^0-9]', '', 'g');
    v_tail   := case when length(v_digits) >= 9 then right(v_digits, 9) end;
    if v_tail is not null then
      select count(distinct coalesce(nullif(lower(btrim(coalesce(l.email, ''))), ''),
                                     'lead:' || l.id::text))
        into v_people
        from public.leads l
       where right(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g'), 9) = v_tail
          or right(regexp_replace(split_part(coalesce(l.email, ''), '@', 1), '[^0-9]', '', 'g'), 9) = v_tail;

      if coalesce(v_people, 0) > 1 then
        return null;   -- ambiguous tail: refuse, do not guess
      end if;

      if v_people = 1 then
        select id into v_id from public.leads
         where right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9) = v_tail
            or right(regexp_replace(split_part(coalesce(email, ''), '@', 1), '[^0-9]', '', 'g'), 9) = v_tail
         order by created_at limit 1;
        if v_id is not null then return v_id; end if;
      end if;
    end if;
  end if;

  -- (c) '<lid>@lid' resolves only through whatsapp_contacts.
  if to_regclass('public.whatsapp_contacts') is not null then
    select lead_email into v_email from public.whatsapp_contacts
     where chat_id = v_raw and nullif(btrim(lead_email), '') is not null limit 1;
    if v_email is not null then
      select id into v_id from public.leads where email = v_email order by created_at limit 1;
      if v_id is not null then return v_id; end if;
    end if;

    select regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
      into v_wcdig from public.whatsapp_contacts where chat_id = v_raw limit 1;
    if v_wcdig is not null and length(v_wcdig) >= 9 then
      v_tail := right(v_wcdig, 9);

      -- Same guard on the bridged tail.
      select count(distinct coalesce(nullif(lower(btrim(coalesce(l.email, ''))), ''),
                                     'lead:' || l.id::text))
        into v_people
        from public.leads l
       where right(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g'), 9) = v_tail
          or right(regexp_replace(split_part(coalesce(l.email, ''), '@', 1), '[^0-9]', '', 'g'), 9) = v_tail;

      if coalesce(v_people, 0) > 1 then
        return null;   -- ambiguous tail: refuse, do not guess
      end if;

      if v_people = 1 then
        select id into v_id from public.leads
         where right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 9) = v_tail
            or right(regexp_replace(split_part(coalesce(email, ''), '@', 1), '[^0-9]', '', 'g'), 9) = v_tail
         order by created_at limit 1;
        if v_id is not null then return v_id; end if;
      end if;
    end if;
  end if;

  return null;
end;
$function$;

-- -----------------------------------------------------------------------------
-- nexus_mark_first_response — the SLA meter. Since 2026-09-01 this is the
-- SINGLE AUTHORITATIVE WRITER of leads.response_time_minutes; the reverse
-- backfill path was removed (section 11). Fires when a reply is logged and
-- stamps the lead if the value is still NULL. First-write-wins and idempotent.
--
-- The negative-elapsed branch is the interesting part. A reply logged BEFORE
-- the lead row is either clock skew (n8n runs Asia/Dubai) or a conversation
-- that predates this lead. An inbound message already on file distinguishes
-- them: skew with no prior inbound is a genuine 0, everything else stays NULL.
-- NULL is the honest encoding of "wrong event"; 0 is reserved for a real
-- sub-30-second reply. Beyond 90 seconds early it never guesses.
--
-- The whole body is wrapped in an exception block on purpose: the meter must
-- never break message logging. A failure here warns and lets the INSERT stand.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nexus_mark_first_response()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lead    integer;
  v_created timestamptz;
  v_at      timestamptz := coalesce(new.created_at, now());
  v_secs    numeric;
  v_prior   boolean;
begin
  if not public.nexus_is_reply(new.direction, new.channel, new.message) then
    return new;
  end if;

  -- The meter must never break message logging.
  begin
    v_lead := public.nexus_lead_for_comm_key(new.lead_email);
    if v_lead is null then return new; end if;

    select l.created_at into v_created from public.leads l
     where l.id = v_lead and l.response_time_minutes is null;
    if v_created is null then return new; end if;   -- absent, or already measured

    v_secs := extract(epoch from (v_at - v_created));

    -- A reply BEFORE the lead row is one of two things: clock skew between n8n
    -- (Asia/Dubai) and Postgres, or a conversation that predates the lead. An
    -- inbound message already on file before this reply distinguishes them.
    -- Only the first is a genuine zero; the second is not this lead's clock and
    -- must stay unmeasured. NULL is the honest encoding of "wrong event" --
    -- the dashboard already renders it as not measured. Zero is reserved for a
    -- real sub-30-second reply.
    if v_secs < 0 then
      if v_secs < -90 then return new; end if;
      select exists (
        select 1 from public.communication_logs c
         where c.created_at < v_at
           and lower(coalesce(c.direction, '')) = 'inbound'
           and public.nexus_lead_for_comm_key(c.lead_email) = v_lead
      ) into v_prior;
      if v_prior then return new; end if;
      v_secs := 0;
    end if;

    update public.leads l
       set response_time_minutes = round(v_secs / 60.0)::integer
     where l.id = v_lead
       and l.response_time_minutes is null
       and l.created_at is not null;
  exception when others then
    raise warning 'nexus_mark_first_response skipped for %: % (%)',
      new.lead_email, sqlerrm, sqlstate;
  end;

  return new;
end;
$function$;

-- -----------------------------------------------------------------------------
-- assign_hot_lead — round-robin ownership. When a lead becomes HOT and has no
-- owner, give it to the eligible rep with the fewest open HOT leads, breaking
-- ties toward senior_rep, then manager, then name. Staff on 'pending_invite'
-- are skipped. This is why the 5-minute rule has somebody to breach it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_hot_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  pick record;
begin
  if coalesce(new.status, '') <> 'HOT' or new.assigned_to_id is not null then
    return new;
  end if;

  select u.id, u.name into pick
  from public.users u
  left join public.leads l
    on l.assigned_to_id = u.id
   and l.status = 'HOT'
   and (new.id is null or l.id <> new.id)
  where coalesce(u.status, '') <> 'pending_invite'
    and coalesce(u.role, '') in ('senior_rep', 'sales_rep', 'manager')
  group by u.id, u.name, u.role
  order by count(l.id) asc,
           case u.role when 'senior_rep' then 0 when 'manager' then 1 else 2 end,
           u.name
  limit 1;

  if found then
    new.assigned_to_id := pick.id;
    if new.assigned_to is null or new.assigned_to = '' then
      new.assigned_to := pick.name;
    end if;
  end if;

  return new;
end;
$function$;

-- -----------------------------------------------------------------------------
-- recompute_inventory_derived — recomputes every derived money column on
-- inventory from acquired_at and the Dubai calendar date. Holding cost is a
-- flat AED 50/day and stops accruing once a unit is sold; aging_alert trips to
-- WARNING at 90 days and CRITICAL at 120. Called by inventory_ageing_recompute.
-- Returns the number of rows touched.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_inventory_derived()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  touched integer;
  today_dubai date := (now() at time zone 'Asia/Dubai')::date;
begin
  update public.inventory i
  set
    days_in_stock = d.days,
    holding_cost_accrued = case when d.sold then i.holding_cost_accrued else d.days * 50 end,
    gross_margin = coalesce(i.price_aed,0) - coalesce(i.cost_aed,0),
    net_margin = (coalesce(i.price_aed,0) - coalesce(i.cost_aed,0))
                 - case when d.sold then i.holding_cost_accrued else d.days * 50 end,
    vat_amount = round(coalesce(i.price_aed,0) * 0.05),
    recommended_commission = round(
      ((coalesce(i.price_aed,0) - coalesce(i.cost_aed,0))
        - case when d.sold then i.holding_cost_accrued else d.days * 50 end) * 0.05),
    aging_alert = case
      when d.sold then 'HEALTHY'
      when d.days >= 120 then 'CRITICAL'
      when d.days >= 90  then 'WARNING'
      else 'HEALTHY' end
  from (
    select id,
           greatest(0, today_dubai - acquired_at) as days,
           lower(coalesce(status,'')) = 'sold' as sold
    from public.inventory
    where acquired_at is not null
  ) d
  where i.id = d.id;

  get diagnostics touched = row_count;
  return touched;
end;
$function$;

-- -----------------------------------------------------------------------------
-- capture_daily_metrics — writes today's daily_metrics snapshot, upserting on
-- snapshot_date so re-running it the same day refreshes rather than duplicates.
-- Scheduled by pg_cron; see section 9.
--
-- TWO RULES CHANGED IN THIS BODY AND BOTH ARE NAMED IN THE ROW IT WRITES:
--   * workflow_failures is counted by nexus_outcome_class(...) = 'FAILURE',
--     NOT by status = 'FAILED'. The rule name is stamped into
--     workflow_failures_rule so a reader of an old row can tell which count
--     they are looking at.
--   * pipeline_aed sums budget_aed over OPEN leads only (nexus_lead_is_open)
--     and is left NULL when nothing is known, rather than coalesced to 0.
--     A pipeline of "unknown" is not a pipeline of zero.
-- open_leads still uses the older status <> 'CLOSED' test, not
-- nexus_lead_is_open; that is a real inconsistency, recorded as observed.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.capture_daily_metrics()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO daily_metrics AS d (snapshot_date, open_leads, hot_leads, warm_leads,
    cold_leads, avg_response_minutes, pipeline_aed, pipeline_aed_rule, units_at_risk,
    holding_cost_aed, workflow_runs, workflow_failures,
    workflow_failures_rule, workflow_failures_canonical)
  SELECT current_date,
    (SELECT count(*) FROM leads WHERE status <> 'CLOSED' OR status IS NULL),
    (SELECT count(*) FROM leads WHERE upper(status)='HOT'),
    (SELECT count(*) FROM leads WHERE upper(status)='WARM'),
    (SELECT count(*) FROM leads WHERE upper(status)='COLD'),
    (SELECT round(avg(response_time_minutes)::numeric,2) FROM leads WHERE response_time_minutes IS NOT NULL),
    -- INV-008: open leads only, and an absent budget stays unknown.
    (SELECT sum(budget_aed) FROM leads WHERE nexus_lead_is_open(status)),
    'open_leads_null_when_unknown',
    (SELECT count(*) FROM inventory WHERE aging_alert='CRITICAL'),
    (SELECT coalesce(sum(holding_cost_accrued),0) FROM inventory),
    (SELECT count(*) FROM audit_log),
    -- INV-001: the class is the authority, not the raw status.
    (SELECT count(*) FROM audit_log
      WHERE nexus_outcome_class(workflow, status, summary) = 'FAILURE'),
    'nexus_outcome_class',
    (SELECT count(*) FROM audit_log
      WHERE nexus_outcome_class(workflow, status, summary) = 'FAILURE')
  ON CONFLICT (snapshot_date) DO UPDATE SET
    open_leads=excluded.open_leads, hot_leads=excluded.hot_leads,
    warm_leads=excluded.warm_leads, cold_leads=excluded.cold_leads,
    avg_response_minutes=excluded.avg_response_minutes,
    pipeline_aed=excluded.pipeline_aed,
    pipeline_aed_rule=excluded.pipeline_aed_rule,
    units_at_risk=excluded.units_at_risk,
    holding_cost_aed=excluded.holding_cost_aed,
    workflow_runs=excluded.workflow_runs, workflow_failures=excluded.workflow_failures,
    workflow_failures_rule=excluded.workflow_failures_rule,
    workflow_failures_canonical=excluded.workflow_failures_canonical,
    captured_at=now();
$function$;

-- -----------------------------------------------------------------------------
-- search_rag_documents — the whole of "Ask AI" retrieval, in three tiers:
--   1. websearch_to_tsquery, every term must match (highest precision)
--   2. same terms OR-ed, ranked by ts_rank_cd
--   3. trigram word_similarity per term, summed, gibberish dropped below 0.5
-- The first tier that returns anything wins. match_type tells the caller which
-- tier answered. Called by ask_ai_rag_query_agent as a Supabase RPC.
-- There is no embedding and no vector search on this path.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_rag_documents(q text, match_limit integer DEFAULT 6)
 RETURNS TABLE(id integer, doc_title text, section text, content text, source_file text, page_number integer, rank real, match_type text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  cleaned text;
  terms   text[];
  tq      tsquery;
BEGIN
  cleaned := btrim(regexp_replace(lower(coalesce(q, '')), '[^a-z0-9\s]', ' ', 'g'));
  cleaned := btrim(regexp_replace(cleaned, '\s+', ' ', 'g'));

  IF length(cleaned) < 3 THEN
    RETURN;
  END IF;

  -- Tier 1 — every term must match. Highest precision.
  tq := websearch_to_tsquery('english', cleaned);
  IF tq IS NOT NULL AND numnode(tq) > 0 THEN
    RETURN QUERY
      SELECT d.id, d.doc_title, d.section, d.content, d.source_file, d.page_number,
             ts_rank_cd(d.search_vector, tq)::real, 'fts_all'::text
        FROM public.rag_documents d
       WHERE d.search_vector @@ tq
       ORDER BY ts_rank_cd(d.search_vector, tq) DESC, d.id
       LIMIT match_limit;
    IF FOUND THEN RETURN; END IF;
  END IF;

  -- Tier 2 — any term may match; ts_rank_cd decides the order.
  SELECT array_agg(DISTINCT t)
    INTO terms
    FROM unnest(string_to_array(cleaned, ' ')) AS t
   WHERE length(t) > 2;

  IF terms IS NOT NULL AND array_length(terms, 1) > 0 THEN
    tq := to_tsquery('english', array_to_string(terms, ' | '));
    IF tq IS NOT NULL AND numnode(tq) > 0 THEN
      RETURN QUERY
        SELECT d.id, d.doc_title, d.section, d.content, d.source_file, d.page_number,
               ts_rank_cd(d.search_vector, tq)::real, 'fts_any'::text
          FROM public.rag_documents d
         WHERE d.search_vector @@ tq
         ORDER BY ts_rank_cd(d.search_vector, tq) DESC, d.id
         LIMIT match_limit;
      IF FOUND THEN RETURN; END IF;
    END IF;
  END IF;

  -- Tier 3 — fuzzy, per term. A term scoring above 0.5 against the best
  -- matching span counts as a hit; scores are summed so a two-word typo
  -- outranks a one-word coincidence. Gibberish peaks near 0.18 and is dropped.
  IF terms IS NULL OR array_length(terms, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    WITH scored AS (
      SELECT d.id AS did,
             sum(s.sim) AS total,
             count(*)   AS matched_terms
        FROM public.rag_documents d
        CROSS JOIN LATERAL (
          SELECT word_similarity(t, coalesce(d.doc_title,'')||' '||coalesce(d.section,'')||' '||coalesce(d.content,'')) AS sim
            FROM unnest(terms) AS t
           WHERE length(t) >= 4
        ) s
       WHERE s.sim > 0.5
       GROUP BY d.id
    )
    SELECT d.id, d.doc_title, d.section, d.content, d.source_file, d.page_number,
           (sc.total / greatest(array_length(terms,1),1))::real, 'trigram'::text
      FROM scored sc
      JOIN public.rag_documents d ON d.id = sc.did
     ORDER BY sc.matched_terms DESC, sc.total DESC, d.id
     LIMIT match_limit;
END;
$function$;


-- =============================================================================
-- 6. TRIGGERS
-- TWO triggers live, not three. trg_leads_backfill_response was dropped on
-- 2026-09-01 — see section 11.
-- =============================================================================
DROP TRIGGER IF EXISTS trg_assign_hot_lead ON public.leads;
CREATE TRIGGER trg_assign_hot_lead
  BEFORE INSERT OR UPDATE OF status, assigned_to_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.assign_hot_lead();

-- Note: no WHEN clause. It used to fire only on lower(direction)='outbound';
-- that filter now lives inside nexus_is_reply(), which also trims the value, so
-- a writer shipping ' Outbound ' is no longer silently skipped by the trigger.
DROP TRIGGER IF EXISTS trg_comm_logs_first_response ON public.communication_logs;
CREATE TRIGGER trg_comm_logs_first_response
  AFTER INSERT ON public.communication_logs
  FOR EACH ROW EXECUTE FUNCTION public.nexus_mark_first_response();


-- =============================================================================
-- 7. VIEWS
--
-- !! READ THIS BEFORE ASSUMING RLS PROTECTS A VIEW !!
-- The previous edition of this file stated that EVERY view is security_invoker.
-- That is NOT true of the live database. Only four carry the option:
--     v_competitor_latest, v_customer_directory, v_inventory_sales   (= on)
--     v_team_performance                                             (= true)
-- Five do NOT, and therefore run with the VIEW OWNER's privileges, bypassing
-- RLS on their base tables:
--     v_conversations, v_customer_360, v_lead_messages,
--     v_needs_attention, v_workflow_health
-- Supabase's own database linter reports all five as security_definer_view at
-- ERROR level. Each is marked below. Whether that is intended is a decision for
-- whoever owns those migrations; this file's job is to say what is there.
-- (`= on` and `= true` are the same setting, spelled two ways by two
-- migrations. Reproduced as live spells them.)
--
-- Reproduced from pg_get_viewdef() on the live database.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_conversations — one row per PERSON, not per chat id. It collapses the three
-- spellings of the same counterparty (real email, +digits@whatsapp.lead, raw
-- @lid/@c.us chat id) onto one thread_key, picks the chat_id that can actually
-- be replied to, and resolves a human-readable display_name in order of
-- preference: lead name, WhatsApp push name, phone, then the raw key.
--
-- IT NOW CARRIES TWO PARALLEL SETS OF COUNTERS, and the difference matters:
--   message_count / last_message_at / last_direction / awaiting_reply
--     — EVERY row, internal [system] and [SILENCE-*] markers included.
--   msg_count / last_msg_at / last_msg_direction / awaiting_msg_reply
--     — only rows passing nexus_is_message(), i.e. real customer traffic;
--       internal_count is the remainder.
-- v_needs_attention reads the msg_* set, because a silence marker we wrote to
-- ourselves is not a customer waiting for an answer.
--
-- SECURITY: NOT security_invoker on live. Runs as the view owner.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_conversations AS
 WITH resolved AS (
         SELECT cl.id,
            cl.lead_email,
            cl.channel,
            cl.direction,
            cl.message,
            cl.created_at,
            nexus_is_message(cl.direction, cl.channel, cl.message) AS is_msg,
            COALESCE(lower(l_direct.email), lower(wc_direct.lead_email), lower(cl.lead_email)) AS person_key,
                CASE
                    WHEN cl.lead_email ~~ '%@lid'::text OR cl.lead_email ~~ '%@c.us'::text THEN cl.lead_email
                    ELSE wc_by_lead.chat_id
                END AS reply_chat_id
           FROM communication_logs cl
             LEFT JOIN leads l_direct ON lower(l_direct.email) = lower(cl.lead_email)
             LEFT JOIN whatsapp_contacts wc_direct ON wc_direct.chat_id = cl.lead_email
             LEFT JOIN whatsapp_contacts wc_by_lead ON lower(wc_by_lead.lead_email) = lower(cl.lead_email)
          WHERE cl.lead_email IS NOT NULL AND cl.lead_email <> ''::text
        ), threads AS (
         SELECT resolved.person_key,
            (array_agg(resolved.reply_chat_id ORDER BY (resolved.reply_chat_id IS NULL), resolved.created_at DESC))[1] AS chat_id,
            count(*) AS message_count,
            count(*) FILTER (WHERE resolved.direction = 'inbound'::text) AS inbound_count,
            count(*) FILTER (WHERE resolved.direction = 'outbound'::text) AS outbound_count,
            max(resolved.created_at) AS last_message_at,
            (array_agg(resolved.message ORDER BY resolved.created_at DESC))[1] AS last_message,
            (array_agg(resolved.direction ORDER BY resolved.created_at DESC))[1] AS last_direction,
            count(*) FILTER (WHERE resolved.is_msg) AS msg_count,
            count(*) FILTER (WHERE NOT resolved.is_msg) AS internal_count,
            count(*) FILTER (WHERE resolved.is_msg AND resolved.direction = 'inbound'::text) AS msg_inbound_count,
            count(*) FILTER (WHERE resolved.is_msg AND resolved.direction = 'outbound'::text) AS msg_outbound_count,
            max(resolved.created_at) FILTER (WHERE resolved.is_msg) AS last_msg_at,
            (array_agg(resolved.message ORDER BY resolved.created_at DESC) FILTER (WHERE resolved.is_msg))[1] AS last_msg,
            (array_agg(resolved.direction ORDER BY resolved.created_at DESC) FILTER (WHERE resolved.is_msg))[1] AS last_msg_direction
           FROM resolved
          GROUP BY resolved.person_key
        )
 SELECT t.person_key AS thread_key,
    t.chat_id,
    COALESCE(wc.phone, wc2.phone) AS phone,
    COALESCE(wc.push_name, wc2.push_name) AS push_name,
    COALESCE(l.email, wc.lead_email, wc2.lead_email) AS lead_email,
    l.name AS lead_name,
    l.status AS lead_status,
    COALESCE(l.name, NULLIF(wc.push_name, ''::text), NULLIF(wc2.push_name, ''::text), NULLIF(wc.phone, ''::text), NULLIF(wc2.phone, ''::text), t.person_key) AS display_name,
        CASE
            WHEN l.name IS NOT NULL THEN 'lead'::text
            WHEN COALESCE(wc.push_name, wc2.push_name) IS NOT NULL THEN 'whatsapp_profile'::text
            WHEN COALESCE(wc.phone, wc2.phone) IS NOT NULL THEN 'phone_only'::text
            ELSE 'unidentified'::text
        END AS identified,
    t.message_count,
    t.inbound_count,
    t.outbound_count,
    t.last_message_at,
    t.last_message,
    t.last_direction,
    t.last_direction = 'inbound'::text AS awaiting_reply,
    t.msg_count,
    t.internal_count,
    t.msg_inbound_count,
    t.msg_outbound_count,
    t.last_msg_at,
    t.last_msg,
    t.last_msg_direction,
    t.last_msg_direction = 'inbound'::text AS awaiting_msg_reply
   FROM threads t
     LEFT JOIN leads l ON lower(l.email) = t.person_key
     LEFT JOIN whatsapp_contacts wc ON wc.chat_id = t.chat_id
     LEFT JOIN whatsapp_contacts wc2 ON lower(wc2.lead_email) = t.person_key;

-- -----------------------------------------------------------------------------
-- v_lead_messages — communication_logs with the lead already resolved, so a
-- caller filters on lead_id instead of guessing key shapes. Three match arms,
-- mirroring nexus_lead_for_comm_key: trimmed case-insensitive email; a
-- nine-digit phone tail (non-@lid keys only) that is claimed by exactly ONE
-- distinct person; and @lid bridged through whatsapp_contacts.
-- The uniqueness test counts PEOPLE, not rows — two lead rows sharing one email
-- address are one person and are not refused.
-- Mirrors apps/executive-dashboard/lib/identity.js; a divergence between the
-- two is a defect in one of them.
--
-- SECURITY: NOT security_invoker on live. Runs as the view owner.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lead_messages AS
 WITH person AS (
         SELECT leads.id,
            COALESCE(NULLIF(lower(btrim(COALESCE(leads.email, ''::text))), ''::text), 'lead:'::text || leads.id::text) AS person_key,
            NULLIF("right"(regexp_replace(COALESCE(leads.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9), ''::text) AS tail9,
            length(regexp_replace(COALESCE(leads.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text)) AS plen
           FROM leads
        ), unique_tail AS (
         SELECT person.tail9
           FROM person
          WHERE person.tail9 IS NOT NULL AND person.plen >= 9
          GROUP BY person.tail9
         HAVING count(DISTINCT person.person_key) = 1
        )
 SELECT l.id AS lead_id,
    c.id,
    c.created_at,
    c.channel,
    c.direction,
    c.message,
    c.lead_email,
    nexus_is_message(c.direction, c.channel, c.message) AS is_message
   FROM communication_logs c
     JOIN leads l ON COALESCE(btrim(l.email), ''::text) <> ''::text AND lower(btrim(c.lead_email)) = lower(btrim(l.email)) OR c.lead_email !~~ '%@lid'::text AND length(regexp_replace(split_part(c.lead_email, '@'::text, 1), '[^0-9]'::text, ''::text, 'g'::text)) >= 9 AND "right"(regexp_replace(split_part(c.lead_email, '@'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), 9) = "right"(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9) AND length(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text)) >= 9 AND ("right"(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9) IN ( SELECT unique_tail.tail9
           FROM unique_tail)) OR c.lead_email ~~ '%@lid'::text AND (EXISTS ( SELECT 1
           FROM whatsapp_contacts wc
          WHERE wc.chat_id = c.lead_email AND (COALESCE(btrim(l.email), ''::text) <> ''::text AND lower(btrim(wc.lead_email)) = lower(btrim(l.email)) OR length(regexp_replace(COALESCE(wc.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text)) >= 9 AND "right"(regexp_replace(COALESCE(wc.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9) = "right"(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9) AND length(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text)) >= 9 AND ("right"(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9) IN ( SELECT unique_tail.tail9
                   FROM unique_tail)))));

COMMENT ON VIEW public.v_lead_messages IS
  'communication_logs with the lead resolved. Filter on lead_id instead of guessing key shapes. The phone rule refuses a nine-digit suffix claimed by more than one distinct PERSON - two lead rows under one email address are one person and are not refused. Email matching is case-insensitive and trimmed on every arm. Includes [SILENCE-*] markers; a caller wanting only real messages excludes them itself. A row resolving to no lead is absent, so this view cannot measure how many rows failed to resolve. Mirrors lib/identity.js; a divergence between them is a defect in one of the two.';

-- -----------------------------------------------------------------------------
-- v_customer_directory — every person the business knows, keyed on lower(email),
-- unioned from leads and purchase_history, taking the most recent non-empty name
-- and phone from either side. Feeds the Customers screen and the Customer 360
-- aggregation workflow.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_customer_directory WITH (security_invoker = on) AS
 SELECT lower(email) AS id,
    (array_agg(name ORDER BY at DESC NULLS LAST) FILTER (WHERE name IS NOT NULL AND name <> ''::text))[1] AS name,
    lower(email) AS email,
    (array_agg(phone ORDER BY at DESC NULLS LAST) FILTER (WHERE phone IS NOT NULL AND phone <> ''::text))[1] AS phone,
    count(*) AS source_records,
    max(at) AS last_seen_at
   FROM ( SELECT leads.email,
            leads.name,
            leads.phone,
            leads.created_at AS at
           FROM leads
          WHERE leads.email IS NOT NULL AND leads.email <> ''::text
        UNION ALL
         SELECT purchase_history.email,
            purchase_history.customer_name,
            purchase_history.phone,
            purchase_history.created_at
           FROM purchase_history
          WHERE purchase_history.email IS NOT NULL AND purchase_history.email <> ''::text) x
  GROUP BY (lower(email));

COMMENT ON VIEW public.v_customer_directory IS
  'Every customer known to the system, keyed on lower(email), unioned from leads and purchase_history. Feeds the Customer 360 aggregation, which previously depended on Bitrix24 crm.lead.list — a method the free plan no longer exposes.';

-- -----------------------------------------------------------------------------
-- v_customer_360 — the single-customer rollup behind the Customers screen.
-- Rewritten twice since the last edition of this file:
--   * message_count / last_contact_at no longer join on lower(lead_email) alone.
--     They expand each person into EVERY key shape their messages could be filed
--     under (the `keys` CTE: the address itself, the synthetic
--     '+digits@whatsapp.lead', '<digits>@c.us', and any whatsapp_contacts
--     chat_id tied to them), then count only rows passing nexus_is_message().
--     The old version undercounted every WhatsApp-first customer and counted
--     [SILENCE-*] markers — messages written precisely because nobody was in
--     touch — as contact.
--   * lifetime_value_aed is a correlated SUM over purchase_history and is NULL,
--     not 0, when there are no purchases. The old COALESCE(sum(DISTINCT ...), 0)
--     also silently dropped two purchases of an identical amount.
--
-- SECURITY: NOT security_invoker on live. Runs as the view owner.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_customer_360 AS
 WITH ids AS (
         SELECT lower(btrim(leads.email)) AS email
           FROM leads
          WHERE leads.email IS NOT NULL AND leads.email <> ''::text
        UNION
         SELECT lower(btrim(purchase_history.email)) AS lower
           FROM purchase_history
          WHERE purchase_history.email IS NOT NULL AND purchase_history.email <> ''::text
        ), ident AS (
         SELECT i_1.email,
            max(NULLIF(regexp_replace(COALESCE(l_1.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), ''::text)) AS digits
           FROM ids i_1
             LEFT JOIN leads l_1 ON lower(btrim(l_1.email)) = i_1.email
          GROUP BY i_1.email
        ), keys AS (
         SELECT d.email,
            k.key
           FROM ident d
             CROSS JOIN LATERAL ( SELECT d.email AS key
                UNION
                 SELECT regexp_replace(d.email, '[^0-9]'::text, ''::text, 'g'::text) || '@c.us'::text
                  WHERE d.email ~~ '+%@whatsapp.lead'::text AND regexp_replace(d.email, '[^0-9]'::text, ''::text, 'g'::text) <> ''::text
                UNION
                 SELECT ('+'::text || d.digits) || '@whatsapp.lead'::text
                  WHERE d.digits IS NOT NULL
                UNION
                 SELECT d.digits || '@c.us'::text
                  WHERE d.digits IS NOT NULL
                UNION
                 SELECT wc.chat_id
                   FROM whatsapp_contacts wc
                  WHERE wc.chat_id IS NOT NULL AND (lower(btrim(wc.lead_email)) = d.email OR d.digits IS NOT NULL AND regexp_replace(COALESCE(wc.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text) = d.digits)) k
          WHERE k.key IS NOT NULL AND btrim(k.key) <> ''::text
        )
 SELECT i.email,
    COALESCE(max(p.customer_name), max(l.name)) AS name,
    COALESCE(max(p.phone), max(l.phone)) AS phone,
    count(DISTINCT l.id) AS lead_count,
    max(l.ai_score) AS best_ai_score,
    max(upper(l.status)) AS latest_status,
    count(DISTINCT p.id) AS purchase_count,
    ( SELECT sum(p2.amount_aed) AS sum
           FROM purchase_history p2
          WHERE lower(btrim(p2.email)) = i.email) AS lifetime_value_aed,
    max(p.purchase_date) AS last_purchase_date,
    count(DISTINCT p.id) > 0 AS is_vip,
    ( SELECT count(*) AS count
           FROM communication_logs c
          WHERE (c.lead_email IN ( SELECT k.key
                   FROM keys k
                  WHERE k.email = i.email)) AND nexus_is_message(c.direction, c.channel, c.message)) AS message_count,
    ( SELECT max(c.created_at) AS max
           FROM communication_logs c
          WHERE (c.lead_email IN ( SELECT k.key
                   FROM keys k
                  WHERE k.email = i.email)) AND nexus_is_message(c.direction, c.channel, c.message)) AS last_contact_at,
    max(c3.total_emails) AS total_emails,
    max(c3.total_slack_messages) AS total_slack_messages
   FROM ids i
     LEFT JOIN leads l ON lower(btrim(l.email)) = i.email
     LEFT JOIN purchase_history p ON lower(btrim(p.email)) = i.email
     LEFT JOIN customer_360_profiles c3 ON lower(btrim(c3.email)) = i.email
  GROUP BY i.email;

COMMENT ON VIEW public.v_customer_360 IS
  'One row per customer email. message_count and last_contact_at expand the person into every communication_logs key shape they are filed under and exclude [SILENCE-*] markers, which are written because nobody was in touch. lifetime_value_aed is NULL, not 0, when there are no purchases. A lead whose email column is empty is still absent from this view - see the Customers screen, which shows such a person as an unlinked WhatsApp contact.';

-- -----------------------------------------------------------------------------
-- v_inventory_sales — the customer-facing projection of inventory. Five columns
-- only: id, model, status, price_aed, days_in_stock. No cost, no margin, no
-- holding cost, no commission, no ai_recommendation free text.
-- Every customer-facing AI tool points HERE, never at inventory.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_inventory_sales WITH (security_invoker = on) AS
 SELECT id,
    model,
    status,
    price_aed,
    days_in_stock
   FROM inventory i;

COMMENT ON VIEW public.v_inventory_sales IS
  'Customer-facing projection of inventory for the WhatsApp sales agent. Excludes cost_aed, all margin and commission columns, holding cost, and the ai_recommendation free-text field. Point every customer-facing AI tool at this view, never at inventory directly.';

-- -----------------------------------------------------------------------------
-- v_competitor_latest — one row per (competitor, model): the newest scrape.
-- competitors is an append-only price history, so anything that counts it
-- counts scrapes rather than cars. This view is the correct read for every
-- count, comparison and alert; read the base table only for price over time.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_competitor_latest WITH (security_invoker = on) AS
 SELECT DISTINCT ON (competitor, model) id,
    competitor,
    model,
    price_aed,
    our_price_aed,
    price_diff_aed,
    ai_recommendation,
    scraped_at,
    listing_title,
    source_host,
    source_kind,
    offer_name,
    offer_condition,
    match_quality,
    match_note
   FROM competitors c
  ORDER BY competitor, model, scraped_at DESC;

COMMENT ON VIEW public.v_competitor_latest IS
  'One row per (competitor, model): the newest snapshot. Read this for any count, comparison or alert. Read the competitors table itself only for price history over time - it holds every scrape, and counting it counts scrapes, not cars.';

-- -----------------------------------------------------------------------------
-- v_team_performance — per-rep scoreboard for the Team screen: leads assigned,
-- how many are HOT, average first-response minutes, SLA kept vs breached at the
-- 5-minute line, and the AED pipeline they are sitting on. Leads with a NULL
-- response time count in neither within_sla nor breached_sla — unmeasured is
-- not the same as fast.
--
-- pipeline_aed CHANGED ON 2026-09-02 (INV-008). It now sums budget_aed over
-- that rep's OPEN leads only, via nexus_lead_is_open(l.status), and is NULL —
-- not 0 — when none of them has a recorded budget. Before that it was
-- COALESCE(sum(budget_aed), 0) over every lead ever assigned to them, won and
-- dead included, which credited reps with revenue that had already closed or
-- died. Same rule as apps/executive-dashboard/lib/pipeline.js.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_team_performance WITH (security_invoker = true) AS
 SELECT u.id,
    u.name,
    u.email,
    u.role,
    u.status,
    count(l.id) AS leads_assigned,
    count(l.id) FILTER (WHERE upper(l.status) = 'HOT'::text) AS hot_leads,
    round(avg(l.response_time_minutes), 1) AS avg_response_minutes,
    count(l.id) FILTER (WHERE l.response_time_minutes <= 5) AS within_sla,
    count(l.id) FILTER (WHERE l.response_time_minutes > 5) AS breached_sla,
    sum(l.budget_aed) FILTER (WHERE nexus_lead_is_open(l.status)) AS pipeline_aed
   FROM users u
     LEFT JOIN leads l ON l.assigned_to_id = u.id
  GROUP BY u.id, u.name, u.email, u.role, u.status;

COMMENT ON VIEW public.v_team_performance IS
  'INV-008. pipeline_aed sums budget_aed over that rep''s OPEN leads only (public.nexus_lead_is_open) and is NULL — not 0 — when none of them has a recorded budget. Same rule as apps/executive-dashboard/lib/pipeline.js. Before 2026-09-02 it was COALESCE(sum(budget_aed), 0) over every lead ever assigned, won and dead included.';

-- -----------------------------------------------------------------------------
-- v_workflow_health — the Automation screen. Rebuilt on 2026-09-01 around
-- nexus_outcome_class: it no longer counts status = 'FAILED', it classifies
-- every audit_log row and counts the classes. The consequences are visible in
-- the shape:
--   * effective_runs excludes REJECTED_EXPECTED and ESCALATED — a healthy
--     refusal is not a run that failed, and it is not a run that succeeded
--     either, so it is out of the denominator entirely.
--   * success_rate is successes / effective_runs, not (runs - failures) / runs.
--   * health gained three states beyond HEALTHY/DEGRADED/NEVER_RAN/
--     NOT_INSTRUMENTED: UNKNOWN_OUTCOME (a class nobody has taught it),
--     NO_QUALIFYING_RUNS (nothing counted at all), and PRODUCING_NOTHING (over
--     half of qualifying runs yielded no result — an 87% scrape miss rate looks
--     like this once it is no longer hidden behind a rejection label).
--   * HEALTHY is now structurally CLOSED: it is the final ELSE, reachable only
--     after every other class has been excluded. A new outcome class cannot
--     land in it by default.
--
-- SECURITY: NOT security_invoker on live. Runs as the view owner.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_workflow_health AS
 SELECT r.id,
    r.name,
    r.category,
    r.trigger_type,
    r.trigger_detail,
    r.description,
    r.is_active,
    r.writes_audit_log,
    COALESCE(a.runs, 0::bigint) AS runs,
    COALESCE(a.failures, 0::bigint) AS failures,
    COALESCE(a.escalations, 0::bigint) AS escalations,
    COALESCE(a.runs_30d, 0::bigint) AS runs_30d,
    COALESCE(a.failures_30d, 0::bigint) AS failures_30d,
    COALESCE(a.partials_30d, 0::bigint) AS partials_30d,
    COALESCE(a.no_result_30d, 0::bigint) AS no_result_30d,
    COALESCE(a.rejected_30d, 0::bigint) AS rejected_30d,
    COALESCE(a.escalated_30d, 0::bigint) AS escalated_30d,
    COALESCE(a.successes_30d, 0::bigint) AS successes_30d,
    COALESCE(a.unknown_30d, 0::bigint) AS unknown_30d,
    COALESCE(a.effective_runs_30d, 0::bigint) AS effective_runs_30d,
        CASE
            WHEN COALESCE(a.effective_runs_30d, 0::bigint) = 0 THEN NULL::numeric
            ELSE round(100.0 * a.successes_30d::numeric / a.effective_runs_30d::numeric, 1)
        END AS success_rate_30d,
        CASE
            WHEN COALESCE(a.effective_runs, 0::bigint) = 0 THEN NULL::numeric
            ELSE round(100.0 * a.successes::numeric / a.effective_runs::numeric, 1)
        END AS success_rate,
    a.last_run,
    a.last_success,
    a.last_failure,
    a.last_partial,
    a.last_incomplete,
        CASE
            WHEN NOT r.writes_audit_log THEN 'NOT_INSTRUMENTED'::text
            WHEN COALESCE(a.runs, 0::bigint) = 0 THEN 'NEVER_RAN'::text
            WHEN COALESCE(a.failures_30d, 0::bigint) > 0 THEN 'DEGRADED'::text
            WHEN COALESCE(a.partials_30d, 0::bigint) > 0 THEN 'DEGRADED'::text
            WHEN COALESCE(a.unknown_30d, 0::bigint) > 0 THEN 'UNKNOWN_OUTCOME'::text
            WHEN COALESCE(a.escalated_30d, 0::bigint) > 0 THEN 'DEGRADED'::text
            WHEN COALESCE(a.effective_runs_30d, 0::bigint) = 0 THEN 'NO_QUALIFYING_RUNS'::text
            WHEN (COALESCE(a.no_result_30d, 0::bigint) * 2) > COALESCE(a.effective_runs_30d, 0::bigint) THEN 'PRODUCING_NOTHING'::text
            WHEN COALESCE(a.no_result_30d, 0::bigint) > 0 THEN 'DEGRADED'::text
            ELSE 'HEALTHY'::text
        END AS health
   FROM workflow_registry r
     LEFT JOIN LATERAL ( SELECT count(*) AS runs,
            count(*) FILTER (WHERE x.c = 'FAILURE'::text) AS failures,
            count(*) FILTER (WHERE x.c = 'ESCALATED'::text) AS escalations,
            count(*) FILTER (WHERE x.c = 'SUCCESS'::text) AS successes,
            count(*) FILTER (WHERE x.c <> ALL (ARRAY['REJECTED_EXPECTED'::text, 'ESCALATED'::text])) AS effective_runs,
            count(*) FILTER (WHERE x.recent) AS runs_30d,
            count(*) FILTER (WHERE x.recent AND x.c = 'FAILURE'::text) AS failures_30d,
            count(*) FILTER (WHERE x.recent AND x.c = 'PARTIAL'::text) AS partials_30d,
            count(*) FILTER (WHERE x.recent AND x.c = 'NO_RESULT'::text) AS no_result_30d,
            count(*) FILTER (WHERE x.recent AND x.c = 'REJECTED_EXPECTED'::text) AS rejected_30d,
            count(*) FILTER (WHERE x.recent AND x.c = 'ESCALATED'::text) AS escalated_30d,
            count(*) FILTER (WHERE x.recent AND x.c = 'SUCCESS'::text) AS successes_30d,
            count(*) FILTER (WHERE x.recent AND x.c = 'UNKNOWN'::text) AS unknown_30d,
            count(*) FILTER (WHERE x.recent AND (x.c <> ALL (ARRAY['REJECTED_EXPECTED'::text, 'ESCALATED'::text]))) AS effective_runs_30d,
            max(x.logged_at) AS last_run,
            max(x.logged_at) FILTER (WHERE x.c = 'SUCCESS'::text) AS last_success,
            max(x.logged_at) FILTER (WHERE x.c = 'FAILURE'::text) AS last_failure,
            max(x.logged_at) FILTER (WHERE x.c = 'PARTIAL'::text) AS last_partial,
            max(x.logged_at) FILTER (WHERE x.c = ANY (ARRAY['FAILURE'::text, 'PARTIAL'::text])) AS last_incomplete
           FROM ( SELECT l.logged_at,
                    l.logged_at > (now() - '30 days'::interval) AS recent,
                    nexus_outcome_class(l.workflow, l.status, l.summary) AS c
                   FROM audit_log l
                  WHERE l.workflow = r.name OR l.workflow = r.audit_name OR (l.workflow = ANY (r.audit_aliases))) x) a ON true;

COMMENT ON VIEW public.v_workflow_health IS
  'Workflow health on canonical outcome semantics (see nexus_outcome_class). DEGRADED on failures OR partials. PRODUCING_NOTHING when over half of qualifying runs yielded no result - this is what an 87% scrape miss rate looks like when it is not hidden behind a rejection label.';

-- -----------------------------------------------------------------------------
-- v_needs_attention — the one query the whole dashboard is built around: every
-- thing a manager should act on today, from seven unrelated sources, in one
-- shape (kind, severity, ref, title, detail, at, screen). `screen` tells the UI
-- where to send the click. The seven sources are:
--   lead_unassigned  — a HOT lead with no owner
--   sla_breach       — first reply took over 5 minutes (last 30 days)
--   inventory_aging  — a unit at aging_alert = CRITICAL
--   undercut         — a competitor is cheaper than us on the same model
--   workflow_failure — runs that did not deliver in the last 24 h, grouped
--   kyc_archive_gap  — a KYC row whose image never reached Storage
--   unanswered_chat  — the customer spoke last, within the last 7 days
--
-- THREE OF THE SEVEN CHANGED ON 2026-09-01:
--   undercut         — reads DISTINCT ON (competitor, model) newest-first, i.e.
--                      v_competitor_latest's rule inlined, so one persistently
--                      cheaper rival raises one alert and not one per scrape.
--   workflow_failure — no longer status = 'FAILED'. It is
--                      nexus_outcome_class(...) IN ('FAILURE','PARTIAL'), and
--                      the wording changed with it: "N runs that did not
--                      deliver", because a partial did run and did produce
--                      something. `ref` now prefers the workflow_registry name
--                      so the click lands on a row the Automation screen has.
--   unanswered_chat  — reads v_conversations' msg_* counters (awaiting_msg_reply
--                      / last_msg_at), not the raw ones. A [SILENCE-*] marker we
--                      wrote to ourselves is not a customer waiting.
--
-- The kyc_archive_gap cut-off timestamp is the moment KYC archiving went live;
-- rows older than that predate the feature and are not compliance gaps.
-- DEPENDS ON v_conversations — create that first.
--
-- SECURITY: NOT security_invoker on live. Runs as the view owner.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_needs_attention AS
 SELECT 'lead_unassigned'::text AS kind,
    'HOT'::text AS severity,
    l.id::text AS ref,
    l.name AS title,
    'HOT lead with no rep assigned'::text AS detail,
    l.created_at AS at,
    'leads'::text AS screen
   FROM leads l
  WHERE upper(l.status) = 'HOT'::text AND l.assigned_to_id IS NULL
UNION ALL
 SELECT 'sla_breach'::text AS kind,
        CASE
            WHEN l.response_time_minutes > 60 THEN 'HOT'::text
            ELSE 'WARM'::text
        END AS severity,
    l.id::text AS ref,
    l.name AS title,
    ('Responded in '::text || l.response_time_minutes) || ' min — breaches the 5-minute rule'::text AS detail,
    l.created_at AS at,
    'leads'::text AS screen
   FROM leads l
  WHERE l.response_time_minutes > 5 AND l.created_at > (now() - '30 days'::interval)
UNION ALL
 SELECT 'inventory_aging'::text AS kind,
    'HOT'::text AS severity,
    i.id AS ref,
    i.model AS title,
    ((i.days_in_stock || ' days in stock · AED '::text) || to_char(i.holding_cost_accrued, 'FM999,999'::text)) || ' holding cost'::text AS detail,
    now() AS at,
    'inventory'::text AS screen
   FROM inventory i
  WHERE i.aging_alert = 'CRITICAL'::text
UNION ALL
 SELECT 'undercut'::text AS kind,
    'WARM'::text AS severity,
    c.id::text AS ref,
    c.model AS title,
    ((c.competitor || ' is AED '::text) || to_char(abs(c.price_diff_aed), 'FM999,999'::text)) || ' cheaper'::text AS detail,
    c.scraped_at AS at,
    'competitors'::text AS screen
   FROM ( SELECT DISTINCT ON (c2.competitor, c2.model) c2.id,
            c2.competitor,
            c2.model,
            c2.price_aed,
            c2.our_price_aed,
            c2.price_diff_aed,
            c2.ai_recommendation,
            c2.scraped_at,
            c2.listing_title,
            c2.source_host,
            c2.source_kind,
            c2.offer_name,
            c2.offer_condition,
            c2.match_quality,
            c2.match_note
           FROM competitors c2
          ORDER BY c2.competitor, c2.model, c2.scraped_at DESC) c
  WHERE c.price_diff_aed < 0
UNION ALL
 SELECT 'workflow_failure'::text AS kind,
    'HOT'::text AS severity,
    COALESCE(r.name, f.workflow) AS ref,
    COALESCE(r.name, f.workflow) AS title,
    (((f.n || ' run'::text) ||
        CASE
            WHEN f.n = 1 THEN ''::text
            ELSE 's'::text
        END) || ' that did not deliver in the last 24 h · '::text) || "left"(COALESCE(f.latest, 'no detail recorded'::text), 140) AS detail,
    f.last_at AS at,
    'automation'::text AS screen
   FROM ( SELECT a.workflow,
            count(*) AS n,
            max(a.logged_at) AS last_at,
            (array_agg(a.summary ORDER BY a.logged_at DESC))[1] AS latest
           FROM audit_log a
          WHERE (nexus_outcome_class(a.workflow, a.status, a.summary) = ANY (ARRAY['FAILURE'::text, 'PARTIAL'::text])) AND a.logged_at > (now() - '24:00:00'::interval)
          GROUP BY a.workflow) f
     LEFT JOIN workflow_registry r ON f.workflow = r.name OR f.workflow = r.audit_name OR (f.workflow = ANY (r.audit_aliases))
UNION ALL
 SELECT 'kyc_archive_gap'::text AS kind,
    'HOT'::text AS severity,
    k.id::text AS ref,
    COALESCE(k.lead_name, k.full_name, k.lead_email, 'KYC document'::text) AS title,
    'Document was never archived to Storage — retention cannot be proven'::text AS detail,
    k.created_at AS at,
    'compliance'::text AS screen
   FROM kyc_documents k
  WHERE k.storage_path IS NULL AND k.purged_at IS NULL AND k.void_reason IS NULL AND k.created_at > '2026-08-17 16:01:48+00'::timestamp with time zone
UNION ALL
 SELECT 'unanswered_chat'::text AS kind,
    'HOT'::text AS severity,
    v.chat_id AS ref,
    v.display_name AS title,
    (('Waiting since '::text || to_char(v.last_msg_at, 'DD Mon HH24:MI'::text)) || ' · '::text) || "left"(COALESCE(v.last_msg, ''::text), 90) AS detail,
    v.last_msg_at AS at,
    'conversations'::text AS screen
   FROM v_conversations v
  WHERE v.awaiting_msg_reply AND v.last_msg_at > (now() - '7 days'::interval);


-- =============================================================================
-- 8. ROW LEVEL SECURITY
--
-- READ THIS BEFORE CHANGING ANYTHING IN THIS SECTION.
-- On Supabase the roles `anon` and `authenticated` hold blanket table
-- privileges (see section 8c) — they are granted by the platform, not by this
-- schema. RLS is therefore the ONLY thing standing between a publishable anon
-- key and every row in this database. A table with RLS enabled and no policy
-- for a role denies that role by default; that default deny is load-bearing.
-- There is deliberately NO policy anywhere that names the role `public` or
-- `anon` with USING (true).
--
-- CAVEAT, and it is a real one: five views bypass this entirely because they
-- are not security_invoker (section 7). RLS on a base table does not constrain
-- a query that reaches it through one of those five.
-- =============================================================================

-- 8a. Enable RLS on every table. (ALTER ... ENABLE is idempotent.)
-- Verified live: relrowsecurity = true on all 16, relforcerowsecurity = false.
ALTER TABLE public.audit_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitors           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_360_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_metrics         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals_embeddings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_quotes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_history      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_contacts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_registry     ENABLE ROW LEVEL SECURITY;

-- 8b. Policies, exactly as they are live. 30 of them, unchanged since the
-- 2026-08-30 edition.
--
-- The pattern is: service_role (used by n8n, which holds the service key) gets
-- ALL; `authenticated` (a signed-in dashboard user) gets SELECT on most tables
-- and full write only on the three the dashboard actually edits — leads,
-- inventory and competitors. `anon` is named in exactly one place, to deny it.

-- leads: the dashboard creates, edits, assigns and disqualifies leads.
DROP POLICY IF EXISTS leads_authenticated_all ON public.leads;
CREATE POLICY leads_authenticated_all ON public.leads AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS leads_service_role_all ON public.leads;
CREATE POLICY leads_service_role_all ON public.leads AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- inventory: the dashboard adds and edits units. cost_aed is visible to signed-in
-- staff and to nobody else.
DROP POLICY IF EXISTS inventory_authenticated_all ON public.inventory;
CREATE POLICY inventory_authenticated_all ON public.inventory AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS inventory_service_role_all ON public.inventory;
CREATE POLICY inventory_service_role_all ON public.inventory AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- competitors
DROP POLICY IF EXISTS competitors_authenticated_all ON public.competitors;
CREATE POLICY competitors_authenticated_all ON public.competitors AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS competitors_service_role_all ON public.competitors;
CREATE POLICY competitors_service_role_all ON public.competitors AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- read-only for signed-in staff, full access for the automation service key
DROP POLICY IF EXISTS audit_log_authenticated_read ON public.audit_log;
CREATE POLICY audit_log_authenticated_read ON public.audit_log AS PERMISSIVE FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS audit_log_service_role_all ON public.audit_log;
CREATE POLICY audit_log_service_role_all ON public.audit_log AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS communication_logs_authenticated_read ON public.communication_logs;
CREATE POLICY communication_logs_authenticated_read ON public.communication_logs AS PERMISSIVE FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS communication_logs_service_role_all ON public.communication_logs;
CREATE POLICY communication_logs_service_role_all ON public.communication_logs AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS customer_360_authenticated_read ON public.customer_360_profiles;
CREATE POLICY customer_360_authenticated_read ON public.customer_360_profiles AS PERMISSIVE FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS customer_360_service_role_all ON public.customer_360_profiles;
CREATE POLICY customer_360_service_role_all ON public.customer_360_profiles AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS deals_embeddings_authenticated_read ON public.deals_embeddings;
CREATE POLICY deals_embeddings_authenticated_read ON public.deals_embeddings AS PERMISSIVE FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS deals_embeddings_service_role_all ON public.deals_embeddings;
CREATE POLICY deals_embeddings_service_role_all ON public.deals_embeddings AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS finance_quotes_authenticated_read ON public.finance_quotes;
CREATE POLICY finance_quotes_authenticated_read ON public.finance_quotes AS PERMISSIVE FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS finance_quotes_service_role_all ON public.finance_quotes;
CREATE POLICY finance_quotes_service_role_all ON public.finance_quotes AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS purchase_history_authenticated_read ON public.purchase_history;
CREATE POLICY purchase_history_authenticated_read ON public.purchase_history AS PERMISSIVE FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS purchase_history_service_role_all ON public.purchase_history;
CREATE POLICY purchase_history_service_role_all ON public.purchase_history AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS rag_documents_authenticated_read ON public.rag_documents;
CREATE POLICY rag_documents_authenticated_read ON public.rag_documents AS PERMISSIVE FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rag_docs_service_role_all ON public.rag_documents;
CREATE POLICY rag_docs_service_role_all ON public.rag_documents AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS users_authenticated_read ON public.users;
CREATE POLICY users_authenticated_read ON public.users AS PERMISSIVE FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS users_service_role_all ON public.users;
CREATE POLICY users_service_role_all ON public.users AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS whatsapp_contacts_authenticated_read ON public.whatsapp_contacts;
CREATE POLICY whatsapp_contacts_authenticated_read ON public.whatsapp_contacts AS PERMISSIVE FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS whatsapp_contacts_service_role_all ON public.whatsapp_contacts;
CREATE POLICY whatsapp_contacts_service_role_all ON public.whatsapp_contacts AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- kyc_documents: signed-in staff may READ identity documents metadata; only the
-- service key may write or delete. The images themselves are in private Storage.
DROP POLICY IF EXISTS kyc_documents_staff_read ON public.kyc_documents;
CREATE POLICY kyc_documents_staff_read ON public.kyc_documents AS PERMISSIVE FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS kyc_documents_service_role_all ON public.kyc_documents;
CREATE POLICY kyc_documents_service_role_all ON public.kyc_documents AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

-- daily_metrics: read-only to staff. It has NO service_role policy live —
-- service_role bypasses RLS entirely, and capture_daily_metrics() is
-- SECURITY DEFINER, so neither needs one. Recorded as observed.
DROP POLICY IF EXISTS daily_metrics_authenticated_read ON public.daily_metrics;
CREATE POLICY daily_metrics_authenticated_read ON public.daily_metrics AS PERMISSIVE FOR SELECT TO authenticated USING (true);

-- workflow_registry: read-only to staff, maintained by hand with the service key.
DROP POLICY IF EXISTS workflow_registry_read ON public.workflow_registry;
CREATE POLICY workflow_registry_read ON public.workflow_registry AS PERMISSIVE FOR SELECT TO authenticated USING (true);

-- processed_messages: the de-dup ledger. Explicit USING (false) for both
-- browser-facing roles — belt and braces on top of the default deny, because a
-- reader who could see or forge this table could make the bot answer twice or
-- go silent. Only the service key (which bypasses RLS) touches it.
DROP POLICY IF EXISTS processed_messages_no_anon ON public.processed_messages;
CREATE POLICY processed_messages_no_anon ON public.processed_messages AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS processed_messages_no_authenticated ON public.processed_messages;
CREATE POLICY processed_messages_no_authenticated ON public.processed_messages AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);


-- 8c. TABLE privileges, as they are live.
--
-- These are Supabase's platform defaults, not a deliberate design choice by this
-- project: every table AND every view in `public` carries ALL privileges
-- (arwdDxtm) for anon, authenticated and service_role. Listed here so the file
-- reproduces live state honestly, and so nobody reads section 8b and concludes
-- anon is fenced out at the GRANT level. It is not. It is fenced out by RLS and
-- by RLS alone — and, for the five non-invoker views, not even by that.
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- 8d. FUNCTION privileges. THIS IS NOT "GRANT ALL ON ALL FUNCTIONS".
-- The previous edition said it was. It is not, and the difference is the point:
-- the SECURITY DEFINER helpers were deliberately locked down on 2026-08-19 and
-- 2026-08-31 so that a browser holding an anon or user JWT cannot invoke a
-- function that runs as the owner and reads past RLS.
--
-- Executable by anon + authenticated + service_role (and PUBLIC):
--   nexus_is_message, nexus_is_reply, nexus_outcome_class, nexus_lead_is_open,
--   search_rag_documents
--     — four pure IMMUTABLE predicates plus one read-only RPC. None of the five
--       is SECURITY DEFINER, so calling them buys no privilege.
-- Executable by postgres + service_role ONLY (EXECUTE revoked from PUBLIC):
--   assign_hot_lead, capture_daily_metrics, nexus_comm_keys_for_lead,
--   nexus_lead_for_comm_key, nexus_mark_first_response,
--   recompute_inventory_derived
--     — every one of these is SECURITY DEFINER.
REVOKE ALL ON FUNCTION public.assign_hot_lead()              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.capture_daily_metrics()        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nexus_comm_keys_for_lead(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nexus_lead_for_comm_key(text)  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nexus_mark_first_response()    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_inventory_derived()  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_hot_lead()              TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_daily_metrics()        TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_comm_keys_for_lead(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_lead_for_comm_key(text)  TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_mark_first_response()    TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_inventory_derived()  TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_is_message(text, text, text)   TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nexus_is_reply(text, text, text)     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nexus_outcome_class(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nexus_lead_is_open(text)             TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_rag_documents(text, integer)  TO anon, authenticated, service_role;


-- =============================================================================
-- 9. SCHEDULED JOBS (pg_cron)
-- =============================================================================
-- One job is live, and it is the same one as at the last edition:
--   jobid 1 | nexus-daily-metrics | 50 19 * * * (UTC) | active
--           | select public.capture_daily_metrics();
-- 19:50 UTC is 23:50 Asia/Dubai — the last snapshot of the Dubai day.
--
-- cron.schedule() is a function call, not DDL, so it is deliberately NOT
-- executed by this file. On a NEW database, run this once, by hand:
--
--   select cron.schedule('nexus-daily-metrics', '50 19 * * *',
--                        $$select public.capture_daily_metrics();$$);
--
-- Inventory ageing is NOT on pg_cron — inventory_ageing_recompute (n8n) calls
-- recompute_inventory_derived() on the n8n schedule.


-- =============================================================================
-- 10. STORAGE (not created by this file)
-- =============================================================================
-- One bucket exists: `kyc-documents`, PRIVATE (public = false), created
-- 2026-08-17 11:14 UTC. It holds the identity documents whose keys are in
-- kyc_documents.storage_path, and is read only through short-lived signed URLs.
-- Create it from the Supabase dashboard (Storage -> New bucket, public OFF).
-- It must never be made public.


-- =============================================================================
-- 11. WHAT THE PREVIOUS EDITION DOCUMENTED THAT NO LONGER EXISTS
--
-- The 2026-08-30 edition of this file described these objects. They are GONE
-- from the live database. If you are holding an older copy of schema.sql, these
-- are the places it is confidently wrong.
-- =============================================================================
--
-- DROPPED FUNCTION — public.nexus_backfill_response_time()
--   A BEFORE INSERT trigger function on leads that looked BACKWARDS for an
--   already-logged reply (WhatsApp-first contact) and stamped
--   response_time_minutes from it, using a five-minute grace window.
--   Removed 2026-09-01 (response_time_single_authoritative_writer). Two writers
--   for one column is two answers for one question; nexus_mark_first_response
--   is now the only writer, and it handles the reply-before-lead case itself.
--   Its helper nexus_comm_keys_for_lead() survives but now has no caller.
--
-- DROPPED TRIGGER — trg_leads_backfill_response ON public.leads
--   The BEFORE INSERT trigger that called the function above. Gone with it.
--
-- CHANGED TRIGGER — trg_comm_logs_first_response
--   Still exists, but its WHEN (lower(coalesce(new.direction,'')) = 'outbound')
--   clause was removed. Do not reproduce that clause.
--
-- CHANGED FUNCTION SIGNATURE — nexus_lead_for_comm_key(text)
--   Was RETURNS uuid, which the previous edition documented (correctly, at the
--   time) as a live defect that raised 22P02 and blocked message INSERTs.
--   It is RETURNS integer now and the defect is fixed. Anything still quoting
--   that defect as current is out of date.
--
-- DROPPED COLUMN DEFAULTS — customer_360_profiles.total_emails and
--   .total_slack_messages no longer DEFAULT 0. NULL means not measured.
--
-- RELAXED NOT NULLs — finance_quotes.vehicle_value_aed, .loan_payoff_aed,
--   .equity_aed and .equity_status are all nullable now; the old
--   equity_status CHECK admitting only ('Positive','Negative') is replaced by
--   a pair of checks that also allow 'No trade-in'.
--
-- WITHDRAWN CLAIM — "Every view is security_invoker."
--   Never re-state this. Five of the nine are not. See section 7.
--
-- WITHDRAWN CLAIM — "GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon,
--   authenticated, service_role." Six functions have EXECUTE revoked from
--   PUBLIC and granted only to service_role. See section 8d.
--
-- WITHDRAWN CLAIM — the header's "VERIFIED by replay against an empty
--   PostgreSQL 16 cluster, md5 49a7b6d3…, 159 columns / 27 constraints /
--   52 indexes / 30 policies / 9 functions / 3 triggers / 6 views."
--   Those counts described 2026-08-30 and are all superseded; this edition was
--   transcribed from the catalogue and not replayed. Do not carry the old
--   numbers forward.
--
-- NOTE ON status = 'FAILED'
--   The previous edition printed status='FAILED' as the failure test in three
--   places — inside capture_daily_metrics, inside the v_workflow_health
--   lateral, and inside the v_needs_attention workflow_failure arm. All three
--   now go through public.nexus_outcome_class(workflow, status, summary), and
--   none of the three tests the raw status any more.
--   The literal 'FAILED' does still appear live, in exactly one place: inside
--   nexus_outcome_class itself, which is the function whose job is to know what
--   the writers' raw statuses mean. That is the ONLY correct place for it. Any
--   OTHER reader comparing status to 'FAILED' is reproducing the bug INV-001
--   was raised about.
--
-- =============================================================================
-- End of schema of record.
-- =============================================================================
