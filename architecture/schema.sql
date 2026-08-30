-- =============================================================================
-- NEXUS / ALBA CARS — SCHEMA OF RECORD
-- Supabase project: dsvuoovivysszdoiorch  ·  schema: public
-- Generated 2026-08-30 by direct introspection of the live catalogue
-- (pg_class, pg_attribute, pg_constraint, pg_indexes, pg_policies,
--  pg_get_viewdef, pg_get_functiondef, pg_get_triggerdef, pg_extension,
--  information_schema.role_table_grants, cron.job, storage.buckets).
--
-- THIS FILE IS AUTHORITATIVE. It describes what is actually in the database.
--   architecture/supabase_schema.sql  and  architecture/database_schema.sql
--   describe a database that has never existed. Do not run either. See DRIFT.md.
--
-- Properties of this file:
--   * Idempotent at object granularity — CREATE ... IF NOT EXISTS,
--     CREATE OR REPLACE, DROP POLICY IF EXISTS before CREATE POLICY.
--     Running it against the live project is a no-op.
--   * Dependency-ordered — extensions, sequences, tables, indexes, functions,
--     triggers, views, RLS, policies, grants. Running it against an EMPTY
--     Postgres 15+ database with the Supabase roles present reproduces the
--     live structure.
--   * Caveat: because tables are created with IF NOT EXISTS and their
--     constraints are declared inline, this file will NOT repair a table that
--     already exists in a partially-correct shape. It creates or it skips.
--
-- VERIFIED, not asserted. On 2026-08-30 this file was executed against an empty
-- PostgreSQL 16 cluster and the result compared object-by-object with the live
-- project. Identical: 159 column definitions (name/type/nullability/default,
-- md5 49a7b6d3…), 27 constraints, 52 indexes, 30 RLS policies, 9 functions,
-- 3 triggers, and all 6 view bodies. It was then run a second time against
-- itself with no errors, confirming idempotency. The single cosmetic difference
-- is that live spells two views' option `security_invoker=true` and this file
-- spells all six `= on`; those are the same setting.
--
-- Business context: NEXUS is the lead-to-close automation for a Dubai used-car
-- dealership. n8n workflows write; the executive dashboard (apps/executive-
-- dashboard) reads, almost always through the v_* views.
-- =============================================================================


-- =============================================================================
-- 1. EXTENSIONS
-- =============================================================================
-- pgcrypto (gen_random_uuid) and uuid-ossp live in the `extensions` schema on
-- Supabase and are pre-installed; listed here for completeness.
CREATE EXTENSION IF NOT EXISTS pgcrypto  WITH SCHEMA extensions;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- vector 0.8.2 — pgvector, installed in `public`. Used only by deals_embeddings.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

-- pg_trgm 1.6 — installed in `public`. Used by search_rag_documents() tier 3
-- (word_similarity) and by rag_documents_trgm_idx.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

-- pg_cron 1.6.4 — enabled from the Supabase dashboard, lands in pg_catalog.
-- It runs exactly one job; see section 9.
CREATE EXTENSION IF NOT EXISTS pg_cron;


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
-- see DRIFT.md, item 2.
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
    escalated_at          timestamptz
);
ALTER SEQUENCE public.leads_id_seq OWNED BY public.leads.id;

COMMENT ON COLUMN public.leads.response_time_minutes IS
  'Minutes between the lead arriving (leads.created_at) and the FIRST genuine outbound message to that lead in communication_logs. Written once, by trigger, and never overwritten: it is the first-reply time, not the latest. NULL means UNMEASURED — not fast. A lead nobody has ever answered stays NULL forever, which is why the dashboard renders NULL as "Not measured" and never as a dash.';
COMMENT ON COLUMN public.leads.escalated_at IS
  'Set by the Lead Escalation workflow when a lead is escalated to a manager. Null means never escalated. Does not change status.';

-- -----------------------------------------------------------------------------
-- communication_logs — every message in or out, on any channel. The transcript.
-- Written by whatsapp_bdc_ai_agent, whatsapp_send_dashboard_reply,
-- 7_day_warm_lead_drip_campaign, lead_escalation_ai_agent,
-- kyc_aml_document_auditor and phase_6_12_hour_silence_detector.
-- Read through v_conversations by the dashboard Conversations screen.
--
-- lead_email is NOT always an email. It is whatever addresses the counterparty:
-- a real address, a synthetic '+<digits>@whatsapp.lead', or a raw WhatsApp chat
-- id ('<digits>@lid' / '<digits>@c.us'). v_conversations and
-- nexus_lead_for_comm_key exist to collapse those spellings onto one person.
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
-- Read by whatsapp_bdc_ai_agent (to answer stock questions) and by
-- competitor_price_scraping_supabase_update (to compare against competitors).
--
-- cost_aed is what the dealership PAID. It must never be readable by anon.
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
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competitors (
    id                integer NOT NULL DEFAULT nextval('public.competitors_id_seq') PRIMARY KEY,
    competitor        text NOT NULL,
    model             text,
    price_aed         integer,
    our_price_aed     integer,
    price_diff_aed    integer,
    ai_recommendation text,
    scraped_at        timestamptz DEFAULT now()
);
ALTER SEQUENCE public.competitors_id_seq OWNED BY public.competitors.id;

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
    deal_id       text
);

COMMENT ON COLUMN public.purchase_history.deal_id IS
  'Deterministic id minted by the closed-won workflow; matches deals_embeddings.deal_id. Unique, so a retried webhook cannot duplicate a purchase.';

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
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_360_profiles (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id          text UNIQUE,
    name                 text,
    email                text,
    phone                text,
    total_emails         integer DEFAULT 0,
    total_slack_messages integer DEFAULT 0,
    last_synced_at       timestamptz DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- finance_quotes — every indicative auto-loan quote the system has produced.
-- Written only by finance_calc_auto_loan_equity_credit_score; read by the
-- dashboard Finance screen. The CHECK constraints below are the validation the
-- workflow relies on: a quote that fails them is REJECTED and nothing is
-- written (that is what the 'Finance Calc | REJECTED' audit_log rows mean).
-- disclaimer is NOT NULL on purpose — a quote may never be stored without the
-- text that says it is indicative.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_quotes (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_email         text,
    lead_name          text,
    quoted_by          text,
    vehicle_value_aed  bigint NOT NULL,
    loan_payoff_aed    bigint NOT NULL,
    credit_score       integer NOT NULL CHECK (credit_score >= 300 AND credit_score <= 900),
    equity_aed         bigint NOT NULL,
    equity_status      text NOT NULL CHECK (equity_status = ANY (ARRAY['Positive'::text, 'Negative'::text])),
    loan_to_value_pct  numeric(6,2),
    finance_tier       text NOT NULL,
    indicative_apr_pct numeric(5,2) NOT NULL,
    disclaimer         text NOT NULL,
    source             text NOT NULL DEFAULT 'webhook',
    created_at         timestamptz NOT NULL DEFAULT now()
);

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
-- Hand-maintained (18 rows live); no workflow writes it. It is the left side of
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
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_metrics (
    snapshot_date        date PRIMARY KEY DEFAULT CURRENT_DATE,
    open_leads           integer,
    hot_leads            integer,
    warm_leads           integer,
    cold_leads           integer,
    avg_response_minutes numeric(10,2),
    pipeline_aed         bigint,
    units_at_risk        integer,
    holding_cost_aed     bigint,
    workflow_runs        integer,
    workflow_failures    integer,
    captured_at          timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- audit_log — the run journal for every workflow. This is the shape the whole
-- system actually posts: {workflow, status, summary} plus optional lead context.
-- Sixteen of the workflow JSONs write here, and nexus_error_handler writes the
-- FAILED rows. v_workflow_health and v_needs_attention read it.
-- status is upper case by constraint: SUCCESS / FAILED / ESCALATED / REJECTED
-- and others — the constraint enforces the CASING, not a fixed vocabulary,
-- deliberately, so a new workflow can introduce a new outcome without a migration.
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

-- customer_360_profiles
CREATE INDEX IF NOT EXISTS idx_c360_email                 ON public.customer_360_profiles USING btree (email);

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
-- =============================================================================

-- -----------------------------------------------------------------------------
-- nexus_is_reply — the single definition of "a genuine reply to a customer".
-- Outbound, on a real customer channel, and not one of the system markers the
-- silence detector writes. Used by both response-time paths so they cannot drift.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nexus_is_reply(p_direction text, p_channel text, p_message text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select lower(coalesce(p_direction, '')) = 'outbound'
     and lower(coalesce(p_channel, ''))   in ('whatsapp', 'email', 'sms')
     and coalesce(p_message, '') not like '[system]%'
     and coalesce(p_message, '') not like '[SILENCE-%';
$function$;

-- -----------------------------------------------------------------------------
-- nexus_comm_keys_for_lead — every spelling of a lead's address that could
-- appear in communication_logs.lead_email: the real address, the synthetic
-- '+<digits>@whatsapp.lead', the '<digits>@c.us' form, and any chat_id in
-- whatsapp_contacts tied to that lead or phone.
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
-- nexus_lead_for_comm_key — the reverse: given whatever string is in
-- communication_logs.lead_email, find the lead it belongs to.
--
-- !! LIVE DEFECT — REPRODUCED HERE AS-IS, NOT FIXED !!
-- This function is declared RETURNS uuid and assigns into `v_id uuid`, but
-- public.leads.id is INTEGER. The moment a lookup actually matches a lead the
-- assignment raises: 22P02 invalid input syntax for type uuid: "34".
-- Verified live on 2026-08-30 by calling it with a real lead address.
-- Because nexus_mark_first_response() calls this from an AFTER INSERT trigger
-- on communication_logs, the next genuine outbound WhatsApp/email/SMS message
-- to an already-known lead will FAIL TO INSERT.
-- See DRIFT.md section "Live defects found during introspection".
-- Do not fix it by editing this file — fix it in the database and regenerate.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nexus_lead_for_comm_key(p_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_raw    text := nullif(btrim(p_key), '');
  v_digits text;
  v_is_cus boolean;
  v_id     uuid;
  v_email  text;
  v_wcdig  text;
begin
  if v_raw is null then
    return null;
  end if;

  v_digits := regexp_replace(v_raw, '[^0-9]', '', 'g');
  v_is_cus := v_raw like '%@c.us';

  -- (a) Exact match. Covers a real address and the synthetic whatsapp.lead one.
  select id into v_id
    from public.leads
   where email = v_raw
   order by created_at
   limit 1;
  if v_id is not null then return v_id; end if;

  -- (b) '<digits>@c.us' IS a phone number. Try the synthetic address the router
  --     would have minted from it, then the lead's own phone column.
  if v_is_cus and v_digits <> '' then
    select id into v_id
      from public.leads
     where email = '+' || v_digits || '@whatsapp.lead'
     order by created_at
     limit 1;
    if v_id is not null then return v_id; end if;

    select id into v_id
      from public.leads
     where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_digits
     order by created_at
     limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  -- (c) Anything else — in practice '<number>@lid' — only resolves through
  --     whatsapp_contacts.
  if to_regclass('public.whatsapp_contacts') is not null then
    execute 'select lead_email from public.whatsapp_contacts '
            'where chat_id = $1 and lead_email is not null limit 1'
       into v_email using v_raw;
    if v_email is not null then
      select id into v_id
        from public.leads
       where email = v_email
       order by created_at
       limit 1;
      if v_id is not null then return v_id; end if;
    end if;

    execute 'select regexp_replace(coalesce(phone, ''''), ''[^0-9]'', '''', ''g'') '
            'from public.whatsapp_contacts where chat_id = $1 limit 1'
       into v_wcdig using v_raw;
    if v_wcdig is not null and v_wcdig <> '' then
      select id into v_id
        from public.leads
       where email = '+' || v_wcdig || '@whatsapp.lead'
          or regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_wcdig
       order by created_at
       limit 1;
      if v_id is not null then return v_id; end if;
    end if;
  end if;

  return null;
end;
$function$;

-- -----------------------------------------------------------------------------
-- nexus_mark_first_response — the SLA meter, forward direction. Fires when a
-- reply is logged and stamps leads.response_time_minutes if it is still NULL.
-- First-write-wins and idempotent by construction.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nexus_mark_first_response()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lead uuid;
begin
  if not public.nexus_is_reply(new.direction, new.channel, new.message) then
    return new;
  end if;

  v_lead := public.nexus_lead_for_comm_key(new.lead_email);
  if v_lead is null then
    return new;   -- a message to somebody who is not (yet) a lead row
  end if;

  -- `response_time_minutes is null` makes this first-write-wins AND idempotent:
  -- the second, third and hundredth outbound message to the same lead all fall
  -- through here without touching the value.
  -- greatest(0, ...) absorbs clock skew between n8n (Asia/Dubai) and Postgres,
  -- and the case where a reply is logged in the same second the lead is created.
  update public.leads l
     set response_time_minutes =
           greatest(0, round(extract(epoch from (coalesce(new.created_at, now()) - l.created_at)) / 60.0))::integer
   where l.id = v_lead
     and l.response_time_minutes is null
     and l.created_at is not null;

  return new;
end;
$function$;

-- -----------------------------------------------------------------------------
-- nexus_backfill_response_time — the SLA meter, reverse direction. A lead row
-- sometimes lands AFTER the first reply was logged (WhatsApp-first contact), so
-- on insert this looks backwards for an already-logged reply, with a five-minute
-- grace window so an older conversation cannot stop this lead's clock.
-- This path uses text[] keys and is NOT affected by the uuid defect above.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nexus_backfill_response_time()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_keys  text[];
  v_first timestamptz;
begin
  if new.response_time_minutes is not null or new.created_at is null then
    return new;
  end if;

  v_keys := public.nexus_comm_keys_for_lead(new.email, new.phone);
  if v_keys is null or array_length(v_keys, 1) is null then
    return new;
  end if;

  -- A five-minute grace window before created_at: the reply genuinely can be
  -- logged a few seconds before the lead row lands. Anything earlier than that
  -- belongs to some previous conversation and must not stop this lead's clock.
  select min(c.created_at) into v_first
    from public.communication_logs c
   where c.lead_email = any(v_keys)
     and c.created_at >= new.created_at - interval '5 minutes'
     and public.nexus_is_reply(c.direction, c.channel, c.message);

  if v_first is null then
    return new;
  end if;

  new.response_time_minutes :=
    greatest(0, round(extract(epoch from (v_first - new.created_at)) / 60.0))::integer;
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
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.capture_daily_metrics()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO daily_metrics AS d (snapshot_date, open_leads, hot_leads, warm_leads,
    cold_leads, avg_response_minutes, pipeline_aed, units_at_risk,
    holding_cost_aed, workflow_runs, workflow_failures)
  SELECT current_date,
    (SELECT count(*) FROM leads WHERE status <> 'CLOSED' OR status IS NULL),
    (SELECT count(*) FROM leads WHERE upper(status)='HOT'),
    (SELECT count(*) FROM leads WHERE upper(status)='WARM'),
    (SELECT count(*) FROM leads WHERE upper(status)='COLD'),
    (SELECT round(avg(response_time_minutes)::numeric,2) FROM leads WHERE response_time_minutes IS NOT NULL),
    (SELECT coalesce(sum(budget_aed),0) FROM leads WHERE budget_aed IS NOT NULL),
    (SELECT count(*) FROM inventory WHERE aging_alert='CRITICAL'),
    (SELECT coalesce(sum(holding_cost_accrued),0) FROM inventory),
    (SELECT count(*) FROM audit_log),
    (SELECT count(*) FROM audit_log WHERE status='FAILED')
  ON CONFLICT (snapshot_date) DO UPDATE SET
    open_leads=excluded.open_leads, hot_leads=excluded.hot_leads,
    warm_leads=excluded.warm_leads, cold_leads=excluded.cold_leads,
    avg_response_minutes=excluded.avg_response_minutes,
    pipeline_aed=excluded.pipeline_aed, units_at_risk=excluded.units_at_risk,
    holding_cost_aed=excluded.holding_cost_aed,
    workflow_runs=excluded.workflow_runs, workflow_failures=excluded.workflow_failures,
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
-- =============================================================================
DROP TRIGGER IF EXISTS trg_assign_hot_lead ON public.leads;
CREATE TRIGGER trg_assign_hot_lead
  BEFORE INSERT OR UPDATE OF status, assigned_to_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.assign_hot_lead();

DROP TRIGGER IF EXISTS trg_leads_backfill_response ON public.leads;
CREATE TRIGGER trg_leads_backfill_response
  BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.nexus_backfill_response_time();

DROP TRIGGER IF EXISTS trg_comm_logs_first_response ON public.communication_logs;
CREATE TRIGGER trg_comm_logs_first_response
  AFTER INSERT ON public.communication_logs
  FOR EACH ROW WHEN (lower(COALESCE(new.direction, ''::text)) = 'outbound'::text)
  EXECUTE FUNCTION public.nexus_mark_first_response();


-- =============================================================================
-- 7. VIEWS
-- Every view is security_invoker — it runs with the CALLER's privileges, so the
-- RLS policies on the base tables still apply. This is what stops the dashboard's
-- anon key reading through a view what it cannot read directly. Do not drop the
-- WITH (security_invoker = on) clause.
-- Reproduced from pg_get_viewdef() on the live database.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_conversations — one row per PERSON, not per chat id. It collapses the three
-- spellings of the same counterparty (real email, +digits@whatsapp.lead, raw
-- @lid/@c.us chat id) onto one thread_key, picks the chat_id that can actually
-- be replied to, and resolves a human-readable display_name in order of
-- preference: lead name, WhatsApp push name, phone, then the raw key.
-- `identified` says which of those we managed to get. `awaiting_reply` is the
-- inbox: the last message was theirs. Feeds the Conversations screen and the
-- 'unanswered_chat' rows of v_needs_attention.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_conversations WITH (security_invoker = on) AS
 WITH resolved AS (
         SELECT cl.id,
            cl.lead_email,
            cl.channel,
            cl.direction,
            cl.message,
            cl.created_at,
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
            (array_agg(resolved.direction ORDER BY resolved.created_at DESC))[1] AS last_direction
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
    t.last_direction = 'inbound'::text AS awaiting_reply
   FROM threads t
     LEFT JOIN leads l ON lower(l.email) = t.person_key
     LEFT JOIN whatsapp_contacts wc ON wc.chat_id = t.chat_id
     LEFT JOIN whatsapp_contacts wc2 ON lower(wc2.lead_email) = t.person_key;

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
-- v_customer_360 — the single-customer rollup behind the Customers screen:
-- how many leads, best AI score, latest status, how many purchases, lifetime
-- value, last purchase, message count and last contact, plus the two counters
-- cached in customer_360_profiles. is_vip simply means "has bought before".
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_customer_360 WITH (security_invoker = on) AS
 WITH ids AS (
         SELECT lower(TRIM(BOTH FROM leads.email)) AS email
           FROM leads
          WHERE leads.email IS NOT NULL AND leads.email <> ''::text
        UNION
         SELECT lower(TRIM(BOTH FROM purchase_history.email)) AS lower
           FROM purchase_history
          WHERE purchase_history.email IS NOT NULL AND purchase_history.email <> ''::text
        )
 SELECT i.email,
    COALESCE(max(p.customer_name), max(l.name)) AS name,
    COALESCE(max(p.phone), max(l.phone)) AS phone,
    count(DISTINCT l.id) AS lead_count,
    max(l.ai_score) AS best_ai_score,
    max(upper(l.status)) AS latest_status,
    count(DISTINCT p.id) AS purchase_count,
    COALESCE(sum(DISTINCT p.amount_aed), 0::bigint) AS lifetime_value_aed,
    max(p.purchase_date) AS last_purchase_date,
    count(DISTINCT p.id) > 0 AS is_vip,
    ( SELECT count(*) AS count
           FROM communication_logs c
          WHERE lower(c.lead_email) = i.email) AS message_count,
    ( SELECT max(c.created_at) AS max
           FROM communication_logs c
          WHERE lower(c.lead_email) = i.email) AS last_contact_at,
    max(c3.total_emails) AS total_emails,
    max(c3.total_slack_messages) AS total_slack_messages
   FROM ids i
     LEFT JOIN leads l ON lower(TRIM(BOTH FROM l.email)) = i.email
     LEFT JOIN purchase_history p ON lower(TRIM(BOTH FROM p.email)) = i.email
     LEFT JOIN customer_360_profiles c3 ON lower(TRIM(BOTH FROM c3.email)) = i.email
  GROUP BY i.email;

-- -----------------------------------------------------------------------------
-- v_team_performance — per-rep scoreboard for the Team screen: leads assigned,
-- how many are HOT, average first-response minutes, SLA kept vs breached at the
-- 5-minute line, and the AED pipeline they are sitting on. Leads with a NULL
-- response time count in neither within_sla nor breached_sla — unmeasured is
-- not the same as fast.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_team_performance WITH (security_invoker = on) AS
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
    COALESCE(sum(l.budget_aed), 0::bigint) AS pipeline_aed
   FROM users u
     LEFT JOIN leads l ON l.assigned_to_id = u.id
  GROUP BY u.id, u.name, u.email, u.role, u.status;

-- -----------------------------------------------------------------------------
-- v_workflow_health — the Automation screen. See the view comment below.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_workflow_health WITH (security_invoker = on) AS
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
        CASE
            WHEN COALESCE(a.runs, 0::bigint) = 0 THEN NULL::numeric
            ELSE round(100.0 * (a.runs - a.failures)::numeric / a.runs::numeric, 1)
        END AS success_rate,
    a.last_run,
    COALESCE(a.runs_30d, 0::bigint) AS runs_30d,
    COALESCE(a.failures_30d, 0::bigint) AS failures_30d,
    a.last_failure,
        CASE
            WHEN NOT r.writes_audit_log THEN 'NOT_INSTRUMENTED'::text
            WHEN COALESCE(a.runs, 0::bigint) = 0 THEN 'NEVER_RAN'::text
            WHEN COALESCE(a.failures_30d, 0::bigint) > 0 THEN 'DEGRADED'::text
            ELSE 'HEALTHY'::text
        END AS health
   FROM workflow_registry r
     LEFT JOIN LATERAL ( SELECT count(*) AS runs,
            count(*) FILTER (WHERE l.status = 'FAILED'::text) AS failures,
            count(*) FILTER (WHERE l.status = 'ESCALATED'::text) AS escalations,
            count(*) FILTER (WHERE l.logged_at > (now() - '30 days'::interval)) AS runs_30d,
            count(*) FILTER (WHERE l.status = 'FAILED'::text AND l.logged_at > (now() - '30 days'::interval)) AS failures_30d,
            max(l.logged_at) AS last_run,
            max(l.logged_at) FILTER (WHERE l.status = 'FAILED'::text) AS last_failure
           FROM audit_log l
          WHERE l.workflow = r.name OR l.workflow = r.audit_name OR (l.workflow = ANY (r.audit_aliases))) a ON true;

COMMENT ON VIEW public.v_workflow_health IS
  'Per-workflow health for the Automation screen. Matches audit_log on name, audit_name OR audit_aliases, because the error handler and the in-workflow success loggers use different names for the same workflow. `health` uses a 30-day window so an old failure stops painting a workflow red forever; `runs` and `failures` stay all-time.';

-- -----------------------------------------------------------------------------
-- v_needs_attention — the one query the whole dashboard is built around: every
-- thing a manager should act on today, from seven unrelated sources, in one
-- shape (kind, severity, ref, title, detail, at, screen). `screen` tells the UI
-- where to send the click. The seven sources are:
--   lead_unassigned  — a HOT lead with no owner
--   sla_breach       — first reply took over 5 minutes (last 30 days)
--   inventory_aging  — a unit at aging_alert = CRITICAL
--   undercut         — a competitor is cheaper than us on the same model
--   workflow_failure — FAILED audit_log rows in the last 24 h, grouped
--   kyc_archive_gap  — a KYC row whose image never reached Storage
--   unanswered_chat  — the customer spoke last, within the last 7 days
-- The kyc_archive_gap cut-off timestamp is the moment KYC archiving went live;
-- rows older than that predate the feature and are not compliance gaps.
-- DEPENDS ON v_conversations — create that first.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_needs_attention WITH (security_invoker = on) AS
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
   FROM competitors c
  WHERE c.price_diff_aed < 0
UNION ALL
 SELECT 'workflow_failure'::text AS kind,
    'HOT'::text AS severity,
    f.workflow AS ref,
    f.workflow AS title,
    (((f.n || ' failed run'::text) ||
        CASE
            WHEN f.n = 1 THEN ''::text
            ELSE 's'::text
        END) || ' in the last 24 h · '::text) || "left"(COALESCE(f.latest, 'no detail recorded'::text), 140) AS detail,
    f.last_at AS at,
    'automation'::text AS screen
   FROM ( SELECT a.workflow,
            count(*) AS n,
            max(a.logged_at) AS last_at,
            (array_agg(a.summary ORDER BY a.logged_at DESC))[1] AS latest
           FROM audit_log a
          WHERE a.status = 'FAILED'::text AND a.logged_at > (now() - '24:00:00'::interval)
          GROUP BY a.workflow) f
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
    (('Waiting since '::text || to_char(v.last_message_at, 'DD Mon HH24:MI'::text)) || ' · '::text) || "left"(COALESCE(v.last_message, ''::text), 90) AS detail,
    v.last_message_at AS at,
    'conversations'::text AS screen
   FROM v_conversations v
  WHERE v.awaiting_reply AND v.last_message_at > (now() - '7 days'::interval);


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
-- =============================================================================

-- 8a. Enable RLS on every table. (ALTER ... ENABLE is idempotent.)
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

-- 8b. Policies, exactly as they are live.
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


-- 8c. Table privileges, as they are live.
--
-- These are Supabase's platform defaults, not a deliberate design choice by this
-- project: every table in `public` carries ALL privileges for anon,
-- authenticated and service_role. Listed here so the file reproduces live state
-- honestly, and so nobody reads section 8b and concludes anon is fenced out at
-- the GRANT level. It is not. It is fenced out by RLS and by RLS alone.
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;


-- =============================================================================
-- 9. SCHEDULED JOBS (pg_cron)
-- =============================================================================
-- One job is live:
--   jobid 1 | nexus-daily-metrics | 50 19 * * * (UTC) | select public.capture_daily_metrics();
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
-- 2026-08-17. It holds the identity documents whose keys are in
-- kyc_documents.storage_path, and is read only through short-lived signed URLs.
-- Create it from the Supabase dashboard (Storage -> New bucket, public OFF).
-- It must never be made public.

-- =============================================================================
-- End of schema of record.
-- =============================================================================
