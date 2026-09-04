-- BASELINE VERSION: 20260904090150  (a_message_identity_includes_the_channel_it_arrived_on)
-- Taken 2026-09-04 from Supabase project dsvuoovivysszdoiorch.
-- Restore = this file, then 00000000000001_migration_history.sql, then every
-- file in supabase/migrations/ whose version is greater than 20260904090150.
-- NEXUS OS — baseline schema of Supabase project dsvuoovivysszdoiorch
--
-- WHAT THIS IS
--   A schema-only reconstruction of production as it stood at the migration
--   version named below. It is GENERATED from the live catalogue
--   (pg_get_functiondef / pg_get_viewdef / pg_get_constraintdef /
--   pg_get_indexdef / pg_get_triggerdef / pg_policy / pg_class.relacl /
--   pg_attribute.attacl / pg_default_acl). It is not hand-transcribed, and it
--   must never be hand-edited: regenerate it, or the folder is back where it
--   started. See supabase/README.md.
--
-- WHY IT EXISTS
--   The recorded migration chain cannot replay from an empty database. Its
--   first entry, 20260717130052, is
--     ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
--   so the tables predate the chain and nothing in the chain creates them.
--   Measured: replaying all 243 recorded migrations into an empty Postgres 16
--   applies 47 and fails 196. This file is the missing pre-history, brought
--   forward to today so that restore = this file, then every migration whose
--   version is GREATER than the version stamped below.
--
-- DATA
--   None. Schema only. No dealership rows, no tenants, no vocabulary seed.
--   A restored database is empty and needs its seed rows separately.
--
-- WHAT IT DELIBERATELY DOES NOT CONTAIN
--   The Supabase platform itself: the auth / storage / realtime / vault
--   schemas, the anon / authenticated / service_role / supabase_admin roles,
--   auth.uid() / auth.jwt(), pg_cron and supabase_vault. Restoring into a real
--   Supabase project gets those from the platform. Restoring into a bare
--   Postgres needs them stood up first — supabase/README.md carries the
--   harness that this baseline was verified against.



-- ========================================================================
-- 1. EXTENSIONS, TYPES, SEQUENCES, TABLES (no defaults)
-- Defaults are deferred to section 3: several call functions defined in section 2.
-- ========================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
CREATE TYPE public.nexus_send_directive_row AS (directive text, outcome text, reason_code text, reason text, what_would_change_it text, tenant_id uuid, tenant_slug text, customer_external_id text, intent text, requested_send_form text, integration_id uuid, provider text, channel_type text, external_identifier text, credential_ref text, carrier_rule text, candidates_considered jsonb, resolved_send_form text, message_body text, template_ref text, template_variables jsonb, template_category_required text, template_verification text, template_verification_detail text, media_ref text, media_mime text, policy_decision text, policy_reason_code text, policy_reason text, policy_what_would_change_it text, policy_applied_rule_id uuid, policy_rule_verification_status text, policy_window_state text, policy_window_expires_at timestamp with time zone, policy_evaluated_at timestamp with time zone, capability_state text, capability_basis text, capability_evidence text, whatsapp_capability_state text, whatsapp_capability_note text, requested_by text, routed_at timestamp with time zone, routed_by text);
CREATE TYPE public.nexus_tenant_capability_row AS (tenant_id uuid, capability_key text, label text, state text, evidence text, source text, set_by text, verified_at timestamp with time zone, what_it_unlocks text, requires text, absent_means text, sort integer);
CREATE TYPE public.nexus_tenant_config_row AS (tenant_id uuid, tenant_slug text, tenant_name text, tenant_status text, config_row_exists boolean, brand_name text, brand_name_state text, default_language text, default_language_state text, timezone text, timezone_state text, currency text, currency_state text, business_hours jsonb, business_hours_state text, business_hours_basis text, business_hours_set_by text, business_hours_source text, business_hours_verified_at timestamp with time zone, ai_tone text, ai_tone_state text, ai_tone_basis text, ai_tone_set_by text, ai_tone_source text, ai_tone_verified_at timestamp with time zone, followup_policy jsonb, followup_policy_state text, followup_policy_basis text, followup_policy_set_by text, followup_policy_source text, followup_policy_verified_at timestamp with time zone, approval_rules jsonb, approval_rules_state text, approval_rules_basis text, approval_rules_set_by text, approval_rules_source text, approval_rules_verified_at timestamp with time zone, first_response_sla_minutes integer, first_response_sla_minutes_state text, first_response_sla_minutes_source text, capabilities_available integer, capabilities_in_catalogue integer, settings_not_stated text[], computed_at timestamp with time zone);
CREATE TYPE public.whatsapp_policy_decision_row AS (decision text, reason_code text, reason text, what_would_change_it text, window_state text, window_expires_at timestamp with time zone, last_customer_message_at timestamp with time zone, window_evidence text, window_hours numeric, opt_in_state text, opt_in_evidence text, applied_rule_id uuid, applied_rule_name text, applied_rule_jurisdiction text, applied_rule_authority text, applied_rule_verification_status text, applied_rule_source text, rules_considered jsonb, intent_category text, is_business_initiated boolean, template_category_if_required text, tenant_id uuid, integration_id uuid, customer_wa_id text, evaluated_at timestamp with time zone, decided_by text);
CREATE TYPE public.whatsapp_template_sendability_row AS (sendable boolean, verdict text, reason_code text, reason text, what_would_change_it text, template_id uuid, tenant_id uuid, integration_id uuid, name text, language text, category text, nexus_state text, provider_status text, provider_status_raw text, provider_status_source text, provider_status_observed_at timestamp with time zone, status_age interval, max_status_age interval, is_stale boolean, previous_provider_status text, body_variable_count integer, variable_schema jsonb, evaluated_at timestamp with time zone, decided_by text);
CREATE SEQUENCE IF NOT EXISTS public.competitors_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.leads_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE SEQUENCE IF NOT EXISTS public.rag_documents_id_seq AS integer START WITH 1 INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 CACHE 1 NO CYCLE;
CREATE TABLE IF NOT EXISTS public.attribution_edge_type (
  edge text NOT NULL,
  seq integer NOT NULL,
  from_node text NOT NULL,
  to_node text NOT NULL,
  state text NOT NULL,
  basis text NOT NULL,
  source_ref text NOT NULL,
  finding text NOT NULL,
  unlocked_by text,
  unlock_rank integer
);
CREATE TABLE IF NOT EXISTS public.attribution_event_type (
  event text NOT NULL,
  seq integer NOT NULL,
  state text NOT NULL,
  source_ref text NOT NULL,
  finding text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.attribution_link_basis (
  basis text NOT NULL,
  rank integer NOT NULL,
  is_evidence boolean NOT NULL,
  default_confidence text NOT NULL,
  label text NOT NULL,
  description text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid NOT NULL,
  workflow text,
  status text,
  lead_name text,
  lead_email text,
  lead_score numeric,
  intent text,
  summary text,
  logged_at timestamp with time zone,
  tenant_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.channel_message_events (
  event_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  provider text NOT NULL,
  channel_type text NOT NULL,
  direction text NOT NULL,
  external_message_id text NOT NULL,
  customer_external_id text,
  customer_phone text,
  conversation_id text,
  message_kind text NOT NULL,
  media_ref text,
  media_mime text,
  media_sha256 text,
  provider_account_id text,
  provider_delivery_ref text,
  origin_verified text NOT NULL,
  received_at timestamp with time zone NOT NULL,
  recorded_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.channel_provider_capability (
  provider text NOT NULL,
  send_form text NOT NULL,
  support_state text NOT NULL,
  basis text NOT NULL,
  evidence text NOT NULL,
  verified_at timestamp with time zone,
  set_by text NOT NULL,
  created_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.channel_provider_rank (
  provider text NOT NULL,
  rank integer NOT NULL,
  is_official_platform boolean NOT NULL,
  rationale text NOT NULL,
  set_by text NOT NULL,
  created_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.channel_registry (
  integration_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  channel_type text NOT NULL,
  external_identifier text NOT NULL,
  credential_ref text,
  status text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.channel_send_directive (
  directive_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  requested_by text NOT NULL,
  request_ref text,
  customer_external_id text NOT NULL,
  intent text NOT NULL,
  requested_send_form text NOT NULL,
  directive text NOT NULL,
  outcome text NOT NULL,
  reason_code text NOT NULL,
  reason text NOT NULL,
  what_would_change_it text NOT NULL,
  integration_id uuid,
  provider text,
  channel_type text,
  external_identifier text,
  credential_ref text,
  carrier_rule text,
  candidates_considered jsonb NOT NULL,
  resolved_send_form text,
  message_body text,
  template_ref text,
  template_variables jsonb,
  template_category_required text,
  template_verification text,
  media_ref text,
  media_mime text,
  policy_decision text,
  policy_reason_code text,
  policy_applied_rule_id uuid,
  policy_rule_verification_status text,
  policy_window_state text,
  policy_evaluated_at timestamp with time zone,
  capability_state text,
  capability_basis text,
  whatsapp_capability_state text,
  routed_at timestamp with time zone NOT NULL,
  routed_by text NOT NULL,
  send_result text NOT NULL,
  provider_message_id text,
  provider_error_code text,
  provider_error_detail text,
  result_recorded_at timestamp with time zone,
  tenant_slug text,
  policy_reason text,
  policy_what_would_change_it text,
  policy_window_expires_at timestamp with time zone,
  capability_evidence text,
  whatsapp_capability_note text,
  template_verification_detail text
);
CREATE TABLE IF NOT EXISTS public.channel_send_form (
  code text NOT NULL,
  label text NOT NULL,
  description text NOT NULL,
  requires_template_ref boolean NOT NULL,
  is_media boolean NOT NULL,
  is_business_safe_outside_window boolean NOT NULL,
  sort integer NOT NULL,
  created_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.communication_logs (
  id uuid NOT NULL,
  lead_email text,
  channel text,
  direction text,
  message text,
  created_at timestamp with time zone,
  sent_by text,
  tenant_id uuid NOT NULL,
  external_message_id text
);
CREATE TABLE IF NOT EXISTS public.competitors (
  id integer NOT NULL,
  competitor text NOT NULL,
  model text,
  price_aed integer,
  our_price_aed integer,
  price_diff_aed integer,
  ai_recommendation text,
  scraped_at timestamp with time zone,
  listing_title text,
  source_host text,
  source_kind text,
  offer_name text,
  offer_condition text,
  match_quality text,
  match_note text,
  tenant_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.customer_360_profiles (
  id uuid NOT NULL,
  customer_id text,
  name text,
  email text,
  phone text,
  total_emails integer,
  total_slack_messages integer,
  last_synced_at timestamp with time zone,
  tenant_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.daily_metrics (
  snapshot_date date NOT NULL,
  open_leads integer,
  hot_leads integer,
  warm_leads integer,
  cold_leads integer,
  avg_response_minutes numeric(10,2),
  pipeline_aed bigint,
  units_at_risk integer,
  holding_cost_aed bigint,
  workflow_runs integer,
  workflow_failures integer,
  captured_at timestamp with time zone NOT NULL,
  workflow_failures_rule text,
  workflow_failures_canonical integer,
  pipeline_aed_rule text,
  open_leads_rule text,
  tenant_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.deal_rescue_evidence_sources (
  source text NOT NULL,
  sort integer NOT NULL,
  admitted boolean NOT NULL,
  evidence_tier text NOT NULL,
  claim text NOT NULL,
  verdict_basis text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.deal_rescue_prerequisites (
  id text NOT NULL,
  sort integer NOT NULL,
  requirement text NOT NULL,
  kind text NOT NULL,
  unlocks text NOT NULL,
  unlocks_states text[] NOT NULL,
  evidence_today text NOT NULL,
  why_not_code text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.deal_rescue_settings (
  tenant_id uuid NOT NULL,
  at_risk_days integer,
  stalled_days integer,
  set_by text,
  set_at timestamp with time zone NOT NULL,
  note text
);
CREATE TABLE IF NOT EXISTS public.deal_rescue_states (
  state text NOT NULL,
  sort integer NOT NULL,
  meaning text NOT NULL,
  engine_can_produce boolean NOT NULL,
  blocked_by text,
  requires text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.deals_embeddings (
  id uuid NOT NULL,
  deal_id text,
  content text,
  embedding vector(1536),
  created_at timestamp with time zone,
  tenant_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.finance_quotes (
  id uuid NOT NULL,
  lead_email text,
  lead_name text,
  quoted_by text,
  vehicle_value_aed bigint,
  loan_payoff_aed bigint,
  credit_score integer NOT NULL,
  equity_aed bigint,
  equity_status text,
  loan_to_value_pct numeric(6,2),
  finance_tier text NOT NULL,
  indicative_apr_pct numeric(5,2) NOT NULL,
  disclaimer text NOT NULL,
  source text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  vehicle_price_aed bigint,
  max_ltv_pct numeric,
  min_down_payment_aed bigint,
  down_payment_aed bigint,
  down_payment_pct numeric,
  down_payment_assumed boolean,
  trade_in_equity_applied_aed bigint,
  financed_aed bigint,
  tenure_months integer,
  monthly_payment_low_aed bigint,
  monthly_payment_high_aed bigint,
  total_cost_of_credit_low_aed bigint,
  total_cost_of_credit_high_aed bigint,
  indicative_apr_high_pct numeric,
  calculation_id uuid NOT NULL,
  execution_id text,
  calculated_at timestamp with time zone,
  apr_source text,
  ltv_policy_source text,
  tenant_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.inventory (
  id text NOT NULL,
  model text NOT NULL,
  vin text,
  status text,
  days_in_stock integer,
  price_aed integer,
  cost_aed integer,
  gross_margin integer,
  holding_cost_accrued integer,
  net_margin integer,
  recommended_commission integer,
  vat_amount integer,
  aging_alert text,
  ai_recommendation text,
  acquired_at date,
  tenant_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.inventory_action_events (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  action_id uuid NOT NULL,
  at timestamp with time zone NOT NULL,
  event text NOT NULL,
  actor_staff_id uuid,
  actor_auth_id uuid,
  actor_authority text,
  detail text,
  audit_log_id uuid
);
CREATE TABLE IF NOT EXISTS public.inventory_action_policy (
  tenant_id uuid NOT NULL,
  approver_tenant_roles text[] NOT NULL,
  approver_staff_roles text[] NOT NULL,
  reproposal_cooldown_days integer NOT NULL,
  set_by text,
  set_at timestamp with time zone NOT NULL,
  note text
);
CREATE TABLE IF NOT EXISTS public.inventory_action_reason_codes (
  code text NOT NULL,
  applies_to text[] NOT NULL,
  label text NOT NULL,
  meaning text NOT NULL,
  engine_was_wrong boolean NOT NULL,
  sort integer NOT NULL
);
CREATE TABLE IF NOT EXISTS public.inventory_actions (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  unit_id text NOT NULL,
  recommendation text NOT NULL,
  engine_reason text,
  engine_confidence text,
  engine_confidence_basis text,
  engine_impact_aed integer,
  engine_impact_kind text,
  engine_impact_basis text,
  engine_overall_risk text,
  engine_days_in_stock integer,
  engine_gross_margin_aed integer,
  engine_owner_role text,
  engine_evidence jsonb,
  engine_computed_at timestamp with time zone,
  status text NOT NULL,
  proposed_at timestamp with time zone NOT NULL,
  proposed_by_staff_id uuid,
  proposed_source text NOT NULL,
  decided_at timestamp with time zone,
  decided_by_staff_id uuid,
  decided_by_auth_id uuid,
  decided_by_authority text,
  decision_reason_code text,
  decision_note text,
  defer_until date,
  assigned_to_staff_id uuid,
  assigned_role text,
  assigned_at timestamp with time zone,
  executed_at timestamp with time zone,
  executed_by_staff_id uuid,
  execution_note text,
  execution_failure text,
  outcome_state text NOT NULL,
  outcome_purchase_id uuid,
  outcome_recorded_at timestamp with time zone,
  outcome_recorded_by_staff_id uuid,
  attribution_basis text,
  attribution_note text,
  recovered_value_aed integer,
  recovered_value_basis text,
  escalated_at timestamp with time zone,
  escalation_reason text,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.inventory_profit_settings (
  tenant_id uuid NOT NULL,
  holding_cost_per_day_aed numeric(12,2),
  holding_cost_source text,
  holding_cost_verified_at timestamp with time zone,
  aging_warn_days integer NOT NULL,
  aging_critical_days integer NOT NULL,
  promote_days integer NOT NULL,
  wholesale_days integer NOT NULL,
  min_reprice_margin_pct numeric(5,2) NOT NULL,
  market_tolerance_pct numeric(5,2) NOT NULL,
  enquiry_window_days integer NOT NULL,
  min_enquiry_sources integer NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  holding_cost_basis text,
  holding_cost_set_by text,
  min_model_token_overlap integer NOT NULL,
  accepted_market_match_quality text[] NOT NULL,
  market_max_age_days integer NOT NULL
);
CREATE TABLE IF NOT EXISTS public.kyc_documents (
  id uuid NOT NULL,
  lead_email text,
  lead_name text,
  chat_id text,
  document_type text,
  full_name text,
  date_of_birth text,
  expiry_date text,
  is_valid boolean,
  tampering boolean,
  confidence_score integer,
  remarks text,
  attempt_number integer NOT NULL,
  max_attempts integer NOT NULL,
  verdict text NOT NULL,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL,
  storage_path text,
  retain_until date,
  purged_at timestamp with time zone,
  void_reason text,
  voided_at timestamp with time zone,
  tenant_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.lead_recovery_action_events (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  action_id uuid NOT NULL,
  at timestamp with time zone NOT NULL,
  event text NOT NULL,
  actor_staff_id uuid,
  actor_auth_id uuid,
  actor_authority text,
  detail text,
  audit_log_id uuid
);
CREATE TABLE IF NOT EXISTS public.lead_recovery_actions (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  lead_id integer NOT NULL,
  recommendation text NOT NULL,
  engine_state text,
  engine_reason text,
  engine_confidence text,
  engine_confidence_basis text,
  engine_risk_level text,
  engine_risk_basis text,
  engine_evidence jsonb,
  engine_owner_role text,
  engine_computed_at timestamp with time zone,
  opportunity_value_state text NOT NULL,
  opportunity_value_basis text,
  status text NOT NULL,
  proposed_at timestamp with time zone NOT NULL,
  proposed_by_staff_id uuid,
  proposed_source text NOT NULL,
  decided_at timestamp with time zone,
  decided_by_staff_id uuid,
  decided_by_auth_id uuid,
  decided_by_authority text,
  decision_reason_code text,
  decision_note text,
  defer_until date,
  assigned_to_staff_id uuid,
  assigned_role text,
  assigned_at timestamp with time zone,
  executed_at timestamp with time zone,
  executed_by_staff_id uuid,
  execution_note text,
  execution_failure text,
  outcome_state text NOT NULL,
  outcome_purchase_id uuid,
  outcome_recorded_at timestamp with time zone,
  outcome_recorded_by_staff_id uuid,
  attribution_basis text,
  attribution_note text,
  recovered_value_aed integer,
  recovered_value_basis text,
  escalated_at timestamp with time zone,
  escalation_reason text,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.lead_recovery_reason_codes (
  code text NOT NULL,
  applies_to text[] NOT NULL,
  label text NOT NULL,
  meaning text NOT NULL,
  engine_was_wrong boolean NOT NULL,
  sort integer NOT NULL
);
CREATE TABLE IF NOT EXISTS public.lead_recovery_settings (
  tenant_id uuid NOT NULL,
  sla_first_response_minutes integer,
  silence_hours integer,
  stale_silence_hours integer,
  engagement_window_days integer,
  detector_max_age_hours integer,
  set_by text,
  set_at timestamp with time zone NOT NULL,
  note text,
  reproposal_cooldown_days integer
);
CREATE TABLE IF NOT EXISTS public.lead_recovery_states (
  state text NOT NULL,
  sort integer NOT NULL,
  meaning text NOT NULL,
  engine_can_produce boolean NOT NULL,
  blocked_by text,
  requires text NOT NULL
);
CREATE TABLE IF NOT EXISTS public.leads (
  id integer NOT NULL,
  name text NOT NULL,
  email text,
  phone text,
  source text,
  vehicle_interest text,
  budget_aed integer,
  status text,
  ai_score integer,
  assigned_to text,
  response_time_minutes integer,
  created_at timestamp with time zone,
  assigned_to_id uuid,
  escalated_at timestamp with time zone,
  bitrix_lead_id text,
  crm_synced_at timestamp with time zone,
  tenant_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.policy_jurisdiction (
  code text NOT NULL,
  owner_kind text NOT NULL,
  owner_name text NOT NULL,
  what_it_covers text NOT NULL,
  added_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.policy_platform_attestation (
  attestation_id uuid NOT NULL,
  rule_id uuid NOT NULL,
  attested_by text NOT NULL,
  attested_by_contact text NOT NULL,
  attested_at timestamp with time zone NOT NULL,
  source_kind text NOT NULL,
  source_name text NOT NULL,
  source_ref text NOT NULL,
  source_observed_on date NOT NULL,
  account_ref text,
  confidence text NOT NULL,
  notes text
);
CREATE TABLE IF NOT EXISTS public.policy_rule (
  id uuid NOT NULL,
  tenant_id uuid,
  jurisdiction text NOT NULL,
  rule_type text NOT NULL,
  rule_name text NOT NULL,
  value_numeric numeric,
  value_text text,
  unit text NOT NULL,
  value_kind text NOT NULL,
  source_url text,
  source_name text,
  source_document text,
  effective_from date,
  effective_to date,
  verification_date date,
  verified_by text,
  verified_by_auth_user_id uuid,
  confidence text NOT NULL,
  status text NOT NULL,
  verification_status text NOT NULL,
  notes text,
  version integer NOT NULL,
  supersedes_id uuid,
  added_by text NOT NULL,
  added_by_auth_user_id uuid,
  added_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  jurisdiction_owner_kind text NOT NULL,
  platform_attestation_id uuid
);
CREATE TABLE IF NOT EXISTS public.policy_rule_event (
  id uuid NOT NULL,
  rule_id uuid NOT NULL,
  tenant_id uuid,
  event text NOT NULL,
  actor text NOT NULL,
  actor_auth_user_id uuid,
  at timestamp with time zone NOT NULL,
  from_status text,
  to_status text,
  from_verification text,
  to_verification text,
  detail text
);
CREATE TABLE IF NOT EXISTS public.policy_rule_type (
  code text NOT NULL,
  label text NOT NULL,
  description text NOT NULL,
  created_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.policy_unit (
  code text NOT NULL,
  label text NOT NULL,
  value_kind text NOT NULL,
  description text NOT NULL,
  created_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.policy_unmigrated_constant (
  id uuid NOT NULL,
  layer text NOT NULL,
  location text NOT NULL,
  snippet text NOT NULL,
  current_value text NOT NULL,
  kind text NOT NULL,
  proposed_rule_type text,
  proposed_rule_name text,
  reaches_a_customer boolean NOT NULL,
  seeded_as_rule boolean NOT NULL,
  note text NOT NULL,
  surveyed_on date NOT NULL,
  created_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.processed_messages (
  message_id text NOT NULL,
  source text NOT NULL,
  chat_id text,
  processed_at timestamp with time zone NOT NULL,
  tenant_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.purchase_history (
  id uuid NOT NULL,
  customer_name text,
  email text,
  phone text,
  vehicle text,
  purchase_date date,
  amount_aed integer,
  created_at timestamp with time zone,
  deal_id text,
  lead_id integer,
  tenant_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.rag_documents (
  id integer NOT NULL,
  doc_title text NOT NULL,
  section text,
  content text NOT NULL,
  source_file text,
  page_number integer,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(content, ''::text))) STORED,
  tenant_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.tenant_capability (
  tenant_id uuid NOT NULL,
  capability_key text NOT NULL,
  state text NOT NULL,
  evidence text NOT NULL,
  source text NOT NULL,
  set_by text NOT NULL,
  verified_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.tenant_capability_catalogue (
  capability_key text NOT NULL,
  label text NOT NULL,
  what_it_unlocks text NOT NULL,
  requires text NOT NULL,
  absent_means text NOT NULL,
  sort integer NOT NULL,
  created_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.tenant_configuration (
  tenant_id uuid NOT NULL,
  brand_name text,
  default_language text,
  timezone text,
  currency text,
  business_hours jsonb,
  business_hours_source text,
  business_hours_set_by text,
  business_hours_verified_at timestamp with time zone,
  business_hours_basis text,
  ai_tone text,
  ai_tone_source text,
  ai_tone_set_by text,
  ai_tone_verified_at timestamp with time zone,
  ai_tone_basis text,
  followup_policy jsonb,
  followup_policy_source text,
  followup_policy_set_by text,
  followup_policy_verified_at timestamp with time zone,
  followup_policy_basis text,
  approval_rules jsonb,
  approval_rules_source text,
  approval_rules_set_by text,
  approval_rules_verified_at timestamp with time zone,
  approval_rules_basis text,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.tenant_configuration_default (
  setting_key text NOT NULL,
  applies_to text NOT NULL,
  value_kind text NOT NULL,
  default_state text NOT NULL,
  default_value jsonb,
  who_decides text NOT NULL,
  provenance_required boolean NOT NULL,
  rationale text NOT NULL,
  engine_rule_when_absent text NOT NULL,
  created_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.tenant_members (
  tenant_id uuid NOT NULL,
  auth_user_id uuid NOT NULL,
  role text NOT NULL,
  staff_user_id uuid,
  created_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  is_unattributed_default boolean NOT NULL,
  created_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.users (
  id uuid NOT NULL,
  name text,
  email text,
  role text,
  status text,
  slack_user_id text,
  created_at timestamp with time zone,
  tenant_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.whatsapp_contacts (
  chat_id text NOT NULL,
  phone text,
  push_name text,
  lead_email text,
  first_seen timestamp with time zone NOT NULL,
  last_seen timestamp with time zone NOT NULL,
  message_count integer NOT NULL,
  tenant_id uuid NOT NULL
);
CREATE TABLE IF NOT EXISTS public.whatsapp_conversation_state (
  tenant_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  customer_wa_id text NOT NULL,
  last_customer_message_at timestamp with time zone,
  last_customer_message_external_id text,
  last_customer_message_source text,
  first_seen_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.whatsapp_customer_message_seen (
  tenant_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  customer_wa_id text NOT NULL,
  external_message_id text NOT NULL,
  first_occurred_at timestamp with time zone NOT NULL,
  first_source text NOT NULL,
  first_recorded_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.whatsapp_delivery_events (
  delivery_event_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  provider text NOT NULL,
  provider_message_id text NOT NULL,
  event_id uuid,
  link_state text NOT NULL,
  linked_at timestamp with time zone,
  status text NOT NULL,
  status_raw text NOT NULL,
  status_at timestamp with time zone NOT NULL,
  recipient_wa_id text,
  conversation_id text,
  conversation_origin_type text,
  conversation_expiration_at timestamp with time zone,
  pricing_billable boolean,
  pricing_model text,
  pricing_category text,
  pricing_type text,
  pricing_reported boolean GENERATED ALWAYS AS (((pricing_billable IS NOT NULL) OR (NULLIF(btrim(COALESCE(pricing_model, ''::text)), ''::text) IS NOT NULL) OR (NULLIF(btrim(COALESCE(pricing_category, ''::text)), ''::text) IS NOT NULL))) STORED,
  errors jsonb,
  provider_payload jsonb NOT NULL,
  received_at timestamp with time zone NOT NULL,
  recorded_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.whatsapp_message_intent (
  code text NOT NULL,
  label text NOT NULL,
  description text NOT NULL,
  is_business_initiated boolean NOT NULL,
  template_category_if_required text,
  created_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.whatsapp_message_usage (
  usage_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  event_id uuid NOT NULL,
  message_category text NOT NULL,
  template_required boolean NOT NULL,
  template_id uuid,
  policy_decision text NOT NULL,
  policy_reason_code text NOT NULL,
  policy_rule_id uuid,
  policy_rule_name text,
  policy_rule_verification_status text NOT NULL,
  policy_decided_at timestamp with time zone NOT NULL,
  template_provider_status_at_send text,
  template_status_age_at_send interval,
  template_staleness_verdict_at_send text,
  sent_at timestamp with time zone NOT NULL,
  billing_fact_state text NOT NULL,
  provider_billable boolean,
  provider_pricing_model text,
  provider_pricing_category text,
  provider_pricing_type text,
  provider_conversation_id text,
  provider_conversation_origin_type text,
  provider_conversation_expiration_at timestamp with time zone,
  provider_pricing_observed_at timestamp with time zone,
  provider_pricing_delivery_event_id uuid,
  latest_status text,
  latest_status_at timestamp with time zone,
  latest_status_delivery_event_id uuid,
  cost_state text GENERATED ALWAYS AS (
CASE
    WHEN (billing_fact_state = 'AWAITING_PROVIDER_REPORT'::text) THEN 'UNKNOWN_AWAITING_PROVIDER_REPORT'::text
    WHEN (billing_fact_state = 'PROVIDER_REPORTED_NO_PRICING'::text) THEN 'UNKNOWN_PROVIDER_REPORTED_NO_PRICING'::text
    WHEN (provider_billable IS FALSE) THEN 'NOT_BILLABLE_PROVIDER_REPORTED'::text
    WHEN (provider_billable IS TRUE) THEN 'BILLABLE_AMOUNT_UNKNOWN_NO_RATE_CARD'::text
    ELSE 'UNKNOWN'::text
END) STORED,
  recorded_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.whatsapp_opt_in_event (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  customer_wa_id text NOT NULL,
  event text NOT NULL,
  occurred_at timestamp with time zone NOT NULL,
  mechanism text NOT NULL,
  evidence_kind text NOT NULL,
  evidence_ref text NOT NULL,
  recorded_by text NOT NULL,
  recorded_at timestamp with time zone NOT NULL,
  notes text
);
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  template_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  integration_id uuid,
  provider text NOT NULL,
  waba_ref text,
  name text NOT NULL,
  language text NOT NULL,
  category text NOT NULL,
  provider_template_id text,
  nexus_state text NOT NULL,
  nexus_state_at timestamp with time zone NOT NULL,
  nexus_state_by text,
  provider_status text NOT NULL,
  provider_status_raw text,
  provider_status_observed_at timestamp with time zone,
  provider_status_source text NOT NULL,
  provider_status_evidence_ref text,
  provider_rejected_reason text,
  previous_provider_status text,
  previous_status_observed_at timestamp with time zone,
  variable_schema jsonb NOT NULL,
  body_variable_count integer GENERATED ALWAYS AS (jsonb_array_length(variable_schema)) STORED,
  body_text text,
  body_text_source text,
  body_text_observed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL
);
CREATE TABLE IF NOT EXISTS public.workflow_registry (
  id text NOT NULL,
  name text NOT NULL,
  audit_name text,
  trigger_type text NOT NULL,
  trigger_detail text,
  category text,
  is_active boolean NOT NULL,
  description text,
  writes_audit_log boolean NOT NULL,
  audit_aliases text[] NOT NULL
);


-- ========================================================================
-- 2. FUNCTIONS
-- Emitted before defaults, views, constraints and policies, all of which call into them. 1 functions whose signature names a VIEW row type are deferred to section 9b.
-- ========================================================================
-- Functions are emitted in name order, and NEXUS functions call each other, so
-- some bodies forward-reference a function defined further down. pg_dump has the
-- same problem and solves it the same way. The bodies were valid in production
-- when this was generated; this switch defers the check, it does not excuse one.
SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.action_approver_context()
 RETURNS TABLE(auth_user_id uuid, tenant_id uuid, tenant_role text, staff_id uuid, staff_name text, staff_role text, may_decide boolean, authority text, refusal_code text, refusal_reason text, tenant_has_any_approver boolean, approver_tenant_roles text[], approver_staff_roles text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_auth      uuid := auth.uid();
  v_tenant    uuid;
  v_email     text;
  v_trole     text;
  v_staff     public.users%rowtype;
  v_pol       public.inventory_action_policy%rowtype;
  v_may       boolean := false;
  v_auth_word text;
  v_any       boolean := false;
begin
  if v_auth is null then
    return query select null::uuid, null::uuid, null::text, null::uuid, null::text, null::text,
                        false, null::text, 'NO_SESSION',
                        'There is no signed-in user on this request, so nothing can be decided.',
                        false, null::text[], null::text[];
    return;
  end if;

  v_tenant := public.nexus_current_tenant_id();
  if v_tenant is null then
    return query select v_auth, null::uuid, null::text, null::uuid, null::text, null::text,
                        false, null::text, 'NO_TENANT',
                        'This account is not a member of any dealership, so it can see no units and decide nothing.',
                        false, null::text[], null::text[];
    return;
  end if;

  select m.role into v_trole
    from public.tenant_members m
   where m.tenant_id = v_tenant and m.auth_user_id = v_auth;

  select p.* into v_pol from public.inventory_action_policy p where p.tenant_id = v_tenant;
  if not found then
    -- No policy row means no rule has been stated. Refuse rather than assume
    -- one: an unconfigured dealership is not an open one.
    return query select v_auth, v_tenant, v_trole, null::uuid, null::text, null::text,
                        false, null::text, 'NO_POLICY',
                        'This dealership has no inventory_action_policy row, so who may approve has never been stated. Nobody may approve until it is.',
                        false, null::text[], null::text[];
    return;
  end if;

  -- The staff row. tenant_members.staff_user_id is the explicit link and wins;
  -- email is the fallback because that is how the dashboard already resolves
  -- "me" (app.js reads users?email=eq.<session email>).
  v_email := nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), '');
  select u.* into v_staff
    from public.tenant_members m
    join public.users u on u.id = m.staff_user_id and u.tenant_id = v_tenant
   where m.tenant_id = v_tenant and m.auth_user_id = v_auth;
  if not found and v_email is not null then
    select u.* into v_staff
      from public.users u
     where u.tenant_id = v_tenant and lower(u.email) = lower(v_email)
     limit 1;
  end if;

  if v_trole is not null and v_trole = any (v_pol.approver_tenant_roles) then
    v_may := true;
    v_auth_word := 'TENANT_' || upper(v_trole);
  elsif v_staff.role is not null
        and array_length(v_pol.approver_staff_roles, 1) is not null
        and lower(v_staff.role) = any (select lower(x) from unnest(v_pol.approver_staff_roles) x) then
    v_may := true;
    v_auth_word := 'STAFF_ROLE_POLICY';
  end if;

  -- Does ANYBODY here hold an approving role? This is what separates "you may
  -- not approve, ask your manager" from "this dealership has no manager", and
  -- those two need different answers from the person reading the screen.
  select exists (
      select 1 from public.tenant_members m
       where m.tenant_id = v_tenant and m.role = any (v_pol.approver_tenant_roles))
      or exists (
      select 1 from public.users u
       where u.tenant_id = v_tenant
         and u.role is not null
         and array_length(v_pol.approver_staff_roles, 1) is not null
         and lower(u.role) = any (select lower(x) from unnest(v_pol.approver_staff_roles) x))
    into v_any;

  return query select
    v_auth, v_tenant, v_trole, v_staff.id, v_staff.name, v_staff.role,
    v_may, v_auth_word,
    case when v_may then null
         when not v_any then 'NO_APPROVER_AT_DEALERSHIP'
         else 'NOT_AN_APPROVER' end,
    case when v_may then null
         when not v_any then
           'Nobody at this dealership holds a role allowed to approve an inventory action. '
           || 'Account roles allowed: ' || coalesce(array_to_string(v_pol.approver_tenant_roles, ', '), 'none')
           || '. Job titles allowed: '
           || coalesce(nullif(array_to_string(v_pol.approver_staff_roles, ', '), ''), 'none - no job title has been granted approval here')
           || '. Until somebody holds one of those, this action can only be escalated.'
         else
           'This account may not approve inventory actions. Its account role is '
           || coalesce(v_trole, 'none') || ' and its job title is ' || coalesce(v_staff.role, 'none')
           || '; approval needs an account role in (' || array_to_string(v_pol.approver_tenant_roles, ', ')
           || ') or a job title in ('
           || coalesce(nullif(array_to_string(v_pol.approver_staff_roles, ', '), ''), 'none granted')
           || ').' end,
    v_any, v_pol.approver_tenant_roles, v_pol.approver_staff_roles;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.action_cancel(p_action_id uuid, p_note text)
 RETURNS TABLE(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action inventory_actions)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ctx record; v_row public.inventory_actions; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_audit uuid;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, null::public.inventory_actions; return;
  end if;
  if not v_ctx.may_decide then
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, null::public.inventory_actions; return;
  end if;
  if v_note is null then
    return query select false, false, 'NOTE_REQUIRED', 'Say why this action is being withdrawn.', null::public.inventory_actions; return;
  end if;
  select * into v_row from public.inventory_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id for update;
  if not found then
    return query select false, false, 'NOT_FOUND', 'No such action on this dealership.', null::public.inventory_actions; return;
  end if;
  if v_row.status = 'CANCELLED' then
    return query select true, true, null::text, 'Already cancelled.', v_row; return;
  end if;
  if v_row.status not in ('PROPOSED', 'APPROVED', 'DEFERRED') then
    return query select false, false, 'NOT_LIVE',
      'Only a live action can be withdrawn. This one is ' || v_row.status || '.', v_row; return;
  end if;
  update public.inventory_actions a
     set status = 'CANCELLED', decided_at = coalesce(a.decided_at, now()),
         decided_by_staff_id = coalesce(a.decided_by_staff_id, v_ctx.staff_id),
         decided_by_auth_id = coalesce(a.decided_by_auth_id, v_ctx.auth_user_id),
         decided_by_authority = coalesce(a.decided_by_authority, v_ctx.authority),
         decision_note = v_note, outcome_state = 'CLOSED_WITHOUT_ACTION'
   where a.id = v_row.id and a.tenant_id = v_ctx.tenant_id returning * into v_row;
  v_audit := public.action_write_audit(v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'SUCCESS',
    'Withdrawn by ' || coalesce(v_ctx.staff_name, 'an approver') || ' before execution. ' || v_note);
  insert into public.inventory_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, 'CANCELLED', v_ctx.staff_id, v_ctx.auth_user_id, v_ctx.authority, v_note, v_audit);
  return query select true, false, null::text, null::text, v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.action_decide(p_action_id uuid, p_decision text, p_reason_code text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_defer_until date DEFAULT NULL::date, p_assign_staff_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action inventory_actions)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ctx     record;
  v_row     public.inventory_actions;
  v_dec     text := upper(btrim(coalesce(p_decision, '')));
  v_target  text;
  v_code    text := nullif(btrim(coalesce(p_reason_code, '')), '');
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_rc      public.inventory_action_reason_codes%rowtype;
  v_assign  public.users%rowtype;
  v_who     text;
  v_audit   uuid;
  v_sent    text;
  v_new_assignee uuid;   -- hoisted out of the SET clause below
  v_new_role     text;   -- so the tenant predicate stays readable
begin
  v_target := case v_dec when 'APPROVE' then 'APPROVED'
                         when 'REJECT'  then 'REJECTED'
                         when 'DEFER'   then 'DEFERRED' end;
  if v_target is null then
    raise exception 'action_decide: p_decision must be APPROVE, REJECT or DEFER, not %', p_decision
      using errcode = '22023';
  end if;

  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, null::public.inventory_actions;
    return;
  end if;

  -- Lock first, read second. Everything below is decided against a row no
  -- other session can move underneath it.
  select * into v_row from public.inventory_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id
   for update;
  if not found then
    -- Same answer for "no such action" and "belongs to another dealership".
    -- Distinguishing them would confirm the existence of another dealership's row.
    return query select false, false, 'NOT_FOUND',
      'No such action on this dealership.', null::public.inventory_actions;
    return;
  end if;

  -- ── Authorisation, before anything is written ───────────────────────────
  if not v_ctx.may_decide then
    if v_ctx.refusal_code = 'NO_APPROVER_AT_DEALERSHIP' then
      if v_row.escalated_at is null then
        update public.inventory_actions
           set escalated_at = now(), escalation_reason = v_ctx.refusal_reason
         where id = v_row.id and tenant_id = v_ctx.tenant_id
        returning * into v_row;
      end if;
      v_audit := public.action_write_audit(
        v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'ESCALATED',
        'A decision (' || v_dec || ') was attempted by '
        || coalesce(v_ctx.staff_name, 'an account with no staff record')
        || ' and this dealership has nobody holding a role allowed to approve inventory '
        || 'actions, so the action was handed to a person instead of being decided. '
        || 'It remains PROPOSED.');
      insert into public.inventory_action_events
        (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
      values (v_ctx.tenant_id, v_row.id, 'ESCALATED', v_ctx.staff_id, v_ctx.auth_user_id,
              'NONE - refused; account role ' || coalesce(v_ctx.tenant_role, 'none'), v_ctx.refusal_reason, v_audit);
      return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, v_row;
      return;
    end if;

    -- "not permitted" is in this summary on purpose: it is one of the phrases
    -- nexus_outcome_class reads as refused-by-design, which classifies this row
    -- REJECTED_EXPECTED and keeps an authorisation refusal out of any failure
    -- rate. Do not reword it without reading that function.
    v_audit := public.action_write_audit(
      v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'REJECTED',
      'Decision (' || v_dec || ') not permitted for '
      || coalesce(v_ctx.staff_name, 'an account with no staff record')
      || ' — ' || v_ctx.refusal_reason);
    insert into public.inventory_action_events
      (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
    values (v_ctx.tenant_id, v_row.id, 'APPROVAL_REFUSED', v_ctx.staff_id, v_ctx.auth_user_id,
            'NONE - refused; account role ' || coalesce(v_ctx.tenant_role, 'none'), v_ctx.refusal_reason, v_audit);
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, v_row;
    return;
  end if;

  -- ── Already decided? ────────────────────────────────────────────────────
  if v_row.status not in ('PROPOSED', 'DEFERRED') or (v_row.status = 'DEFERRED' and v_target = 'DEFERRED') then
    if v_row.status = v_target
       and v_row.decided_by_auth_id is not distinct from v_ctx.auth_user_id
       and coalesce(v_row.decision_reason_code, '') = coalesce(v_code, '')
       and v_row.defer_until is not distinct from p_defer_until then
      -- The double-click. Nothing changed, so nothing is audited.
      return query select true, true, null::text,
        'This decision was already recorded by you at '
        || to_char(v_row.decided_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI')
        || ' GST. No second record was created.', v_row;
      return;
    end if;
    if v_row.status not in ('PROPOSED', 'DEFERRED') then
      select u.name into v_who from public.users u where u.id = v_row.decided_by_staff_id;
      v_sent := 'A ' || v_dec || ' arrived for an action already ' || lower(v_row.status)
        || ' by ' || coalesce(v_who, 'another account') || ' on '
        || to_char(v_row.decided_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI')
        || ' GST. It was not applied: the first decision stands. Attempted by '
        || coalesce(v_ctx.staff_name, 'an account with no staff record') || '.';
      v_audit := public.action_write_audit(
        v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'REJECTED', v_sent);
      insert into public.inventory_action_events
        (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
      values (v_ctx.tenant_id, v_row.id, 'DECISION_CONFLICT', v_ctx.staff_id, v_ctx.auth_user_id,
              v_ctx.authority, v_sent, v_audit);
      return query select false, false, 'ALREADY_DECIDED',
        'This action was already ' || lower(v_row.status) || ' by '
        || coalesce(v_who, 'another account') || ' on '
        || to_char(v_row.decided_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI')
        || ' GST. A second decision would overwrite theirs, so it was not applied.', v_row;
      return;
    end if;
  end if;

  -- ── Reason codes ────────────────────────────────────────────────────────
  if v_target in ('REJECTED', 'DEFERRED') then
    if v_code is null then
      return query select false, false, 'REASON_REQUIRED',
        'A ' || lower(v_target) || ' decision needs a reason code from the closed list. '
        || 'It is the only way this product ever learns which recommendations were wrong.', v_row;
      return;
    end if;
    select * into v_rc from public.inventory_action_reason_codes where code = v_code;
    if not found or not (v_dec = any (v_rc.applies_to)) then
      return query select false, false, 'REASON_NOT_VALID',
        'Reason code ' || v_code || ' is not one this system accepts for a ' || lower(v_target)
        || '. Read public.inventory_action_reason_codes for the list.', v_row;
      return;
    end if;
    if v_target = 'REJECTED' and (v_note is null or length(v_note) < 3) then
      return query select false, false, 'NOTE_REQUIRED',
        'A rejection needs a note as well as a code. The code makes it countable; the note '
        || 'is what makes it understandable to whoever reads it in three months.', v_row;
      return;
    end if;
  end if;
  if v_target = 'DEFERRED' and p_defer_until is not null and p_defer_until <= current_date then
    return query select false, false, 'DEFER_DATE_PAST',
      'A deferral has to point at a future date, otherwise it is due the moment it is made.', v_row;
    return;
  end if;

  -- ── Assignment ──────────────────────────────────────────────────────────
  if p_assign_staff_id is not null then
    select * into v_assign from public.users u
     where u.id = p_assign_staff_id and u.tenant_id = v_ctx.tenant_id;
    if not found then
      return query select false, false, 'ASSIGNEE_NOT_FOUND',
        'That person is not on this dealership''s staff list, so the action cannot be assigned to them.', v_row;
      return;
    end if;
  end if;

  -- v_row already holds this action, read under a row lock. Its columns are
  -- exactly what a.* referred to and nothing can have moved them since.
  v_new_assignee := case when v_target = 'APPROVED' then p_assign_staff_id
                         else v_row.assigned_to_staff_id end;
  v_new_role     := case when v_target <> 'APPROVED' then v_row.assigned_role
                         when p_assign_staff_id is null then v_row.engine_owner_role
                         else v_assign.role end;

  update public.inventory_actions a set
    status               = v_target,
    decided_at           = now(),
    decided_by_staff_id  = v_ctx.staff_id,
    decided_by_auth_id   = v_ctx.auth_user_id,
    decided_by_authority = v_ctx.authority,
    decision_reason_code = v_code,
    decision_note        = v_note,
    defer_until          = case when v_target = 'DEFERRED' then p_defer_until else null end,
    assigned_to_staff_id = v_new_assignee,
    assigned_role        = v_new_role,
    assigned_at          = case when v_target = 'APPROVED' then now() else a.assigned_at end,
    outcome_state        = case when v_target = 'REJECTED' then 'CLOSED_WITHOUT_ACTION' else a.outcome_state end
  where a.id = v_row.id and a.tenant_id = v_ctx.tenant_id
  returning * into v_row;

  v_sent := case v_target
    when 'APPROVED' then 'Approved by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
      || ' on authority ' || v_ctx.authority || '. Assigned to '
      || coalesce(v_assign.name, nullif(v_row.assigned_role, ''), 'nobody in particular')
      || '. Nothing has been executed yet and no money has been recovered — approval is a decision, not an outcome.'
    when 'REJECTED' then 'Rejected by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
      || ' on authority ' || v_ctx.authority || '. Reason ' || v_code || ': ' || v_note
      || '. Recorded as evidence about the recommendation, not as a fault.'
    else 'Deferred by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
      || ' on authority ' || v_ctx.authority || '. Reason ' || v_code
      || coalesce('. Due again ' || to_char(p_defer_until, 'DD Mon YYYY'), '. No date set')
      || '.' end;

  v_audit := public.action_write_audit(
    v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'SUCCESS', v_sent);

  insert into public.inventory_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, v_target, v_ctx.staff_id, v_ctx.auth_user_id,
          v_ctx.authority, v_sent, v_audit);

  if v_target = 'APPROVED' and (p_assign_staff_id is not null or v_row.assigned_role is not null) then
    insert into public.inventory_action_events
      (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
    values (v_ctx.tenant_id, v_row.id, 'ASSIGNED', v_ctx.staff_id, v_ctx.auth_user_id, v_ctx.authority,
            case when p_assign_staff_id is not null
                 then 'Assigned to ' || coalesce(v_assign.name, p_assign_staff_id::text)
                 else 'Assigned to the role ' || v_row.assigned_role
                      || ' — a role, not a person. NEXUS holds no verified role directory for this dealership.'
            end, v_audit);
  end if;

  return query select true, false, null::text, null::text, v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.action_mark_executed(p_action_id uuid, p_note text DEFAULT NULL::text, p_failed boolean DEFAULT false, p_failure text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action inventory_actions)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ctx   record;
  v_row   public.inventory_actions;
  v_want  text := case when p_failed then 'EXECUTION_FAILED' else 'EXECUTED' end;
  v_audit uuid;
  v_sent  text;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, null::public.inventory_actions;
    return;
  end if;
  -- Execution is a claim about the real world, so it has to be attached to a
  -- person. An account with no staff row cannot make it.
  if v_ctx.staff_id is null then
    return query select false, false, 'NO_STAFF_RECORD',
      'This account has no row in the staff directory, so there is no person to record as '
      || 'having carried this out. Recording it against nobody would be a claim with no author.',
      null::public.inventory_actions;
    return;
  end if;

  select * into v_row from public.inventory_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id for update;
  if not found then
    return query select false, false, 'NOT_FOUND', 'No such action on this dealership.', null::public.inventory_actions;
    return;
  end if;

  if v_row.status in ('EXECUTED', 'EXECUTION_FAILED') then
    if v_row.executed_by_staff_id = v_ctx.staff_id and v_row.status = v_want then
      return query select true, true, null::text,
        'Already recorded by you at '
        || to_char(v_row.executed_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI') || ' GST.', v_row;
      return;
    end if;
    return query select false, false, 'ALREADY_EXECUTED',
      'This action was already closed as ' || v_row.status || '.', v_row;
    return;
  end if;

  if v_row.status <> 'APPROVED' then
    return query select false, false, 'NOT_APPROVED',
      'Only an approved action can be executed. This one is ' || v_row.status
      || ', and executing an undecided recommendation is exactly what the approval step exists to stop.', v_row;
    return;
  end if;

  update public.inventory_actions a set
    status               = v_want,
    executed_at          = now(),
    executed_by_staff_id = v_ctx.staff_id,
    execution_note       = nullif(btrim(coalesce(p_note, '')), ''),
    execution_failure    = case when p_failed then nullif(btrim(coalesce(p_failure, '')), '') end,
    outcome_state        = case when p_failed then 'CLOSED_WITHOUT_ACTION' else 'AWAITING_OUTCOME' end
  where a.id = v_row.id and a.tenant_id = v_ctx.tenant_id
  returning * into v_row;

  if p_failed then
    v_sent := 'Execution attempted by ' || coalesce(v_ctx.staff_name, 'a staff member')
      || ' and it was not carried out: ' || coalesce(v_row.execution_failure, 'no reason recorded') || '.';
    v_audit := public.action_write_audit(v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'FAILED', v_sent);
    insert into public.inventory_action_events
      (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
    values (v_ctx.tenant_id, v_row.id, 'EXECUTION_FAILED', v_ctx.staff_id, v_ctx.auth_user_id, v_ctx.authority, v_sent, v_audit);
  else
    v_sent := 'Carried out by ' || coalesce(v_ctx.staff_name, 'a staff member')
      || coalesce('. ' || v_row.execution_note, '')
      || ' No money has been recovered by this: execution is an act, not an outcome. '
      || 'Nothing may be attributed to it until a real sale is recorded and a person ties the two together.';
    v_audit := public.action_write_audit(v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'SUCCESS', v_sent);
    insert into public.inventory_action_events
      (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
    values (v_ctx.tenant_id, v_row.id, 'EXECUTED', v_ctx.staff_id, v_ctx.auth_user_id, v_ctx.authority, v_sent, v_audit);
  end if;

  return query select true, false, null::text, null::text, v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.action_mark_not_attributable(p_action_id uuid, p_note text)
 RETURNS TABLE(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action inventory_actions)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ctx record; v_row public.inventory_actions; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_audit uuid;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, null::public.inventory_actions; return;
  end if;
  if not v_ctx.may_decide then
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, null::public.inventory_actions; return;
  end if;
  if v_note is null then
    return query select false, false, 'NOTE_REQUIRED',
      'Say what is missing. "No outcome" with no explanation is the sentence this product exists to stop.',
      null::public.inventory_actions; return;
  end if;
  select * into v_row from public.inventory_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id for update;
  if not found then
    return query select false, false, 'NOT_FOUND', 'No such action on this dealership.', null::public.inventory_actions; return;
  end if;
  if v_row.outcome_state = 'NOT_ATTRIBUTABLE' then
    return query select true, true, null::text, 'Already closed as not attributable.', v_row; return;
  end if;
  if v_row.status <> 'EXECUTED' or v_row.outcome_state = 'ATTRIBUTED' then
    return query select false, false, 'NOT_APPLICABLE',
      'This only applies to an executed action that has no outcome attributed to it.', v_row; return;
  end if;
  update public.inventory_actions a
     set outcome_state = 'NOT_ATTRIBUTABLE', outcome_recorded_at = now(),
         outcome_recorded_by_staff_id = v_ctx.staff_id, attribution_note = v_note
   where a.id = v_row.id and a.tenant_id = v_ctx.tenant_id returning * into v_row;
  v_audit := public.action_write_audit(v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'SUCCESS',
    'Closed with no attributable outcome by ' || coalesce(v_ctx.staff_name, 'an approver')
    || '. ' || v_note || ' No recovered value is recorded and none is implied.');
  insert into public.inventory_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, 'OUTCOME_NOT_ATTRIBUTABLE', v_ctx.staff_id, v_ctx.auth_user_id, v_ctx.authority, v_note, v_audit);
  return query select true, false, null::text, null::text, v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.action_outcome_candidates(p_action_id uuid)
 RETURNS TABLE(purchase_id uuid, vehicle text, customer_name text, amount_aed integer, purchase_date date, link_evidence text, shared_tokens integer, evidence_note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ctx  record;
  v_row  public.inventory_actions;
  v_unit public.inventory%rowtype;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then return; end if;

  select * into v_row from public.inventory_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id;
  if not found then return; end if;

  select i.* into v_unit from public.inventory i
   where i.tenant_id = v_ctx.tenant_id and i.id = v_row.unit_id;

  return query
  select ph.id, ph.vehicle, ph.customer_name, ph.amount_aed, ph.purchase_date,
         'MODEL_TEXT_ONLY'::text,
         cardinality(array(select unnest(public.nexus_model_tokens(v_unit.model))
                           intersect
                           select unnest(public.nexus_model_tokens(ph.vehicle))))::integer,
         'purchase_history has no column referencing an inventory unit, so this is a text '
         || 'comparison between the free-text vehicle description on the sale and the model '
         || 'name on the unit. It is a prompt for a person, not evidence. Confirming it '
         || 'records HUMAN_CONFIRMED_LINK against your name.'
    from public.purchase_history ph
   where ph.tenant_id = v_ctx.tenant_id
     and (v_row.executed_at is null or ph.purchase_date >= (v_row.executed_at at time zone 'Asia/Dubai')::date)
     and cardinality(array(select unnest(public.nexus_model_tokens(v_unit.model))
                           intersect
                           select unnest(public.nexus_model_tokens(ph.vehicle)))) >= 2
   order by ph.purchase_date desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.action_propose(p_unit_id text)
 RETURNS TABLE(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action inventory_actions)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.action_record_outcome(p_action_id uuid, p_purchase_id uuid, p_note text)
 RETURNS TABLE(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action inventory_actions)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ctx   record;
  v_row   public.inventory_actions;
  v_ph    public.purchase_history%rowtype;
  v_unit  public.inventory%rowtype;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_rec   integer;
  v_basis text;
  v_audit uuid;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code, v_ctx.refusal_reason, null::public.inventory_actions;
    return;
  end if;
  -- Attributing money is a commercial statement, so it needs the same authority
  -- as approving the action in the first place.
  if not v_ctx.may_decide then
    return query select false, false, v_ctx.refusal_code,
      'Attributing money to an action is a commercial statement and needs approval authority. '
      || v_ctx.refusal_reason, null::public.inventory_actions;
    return;
  end if;
  if v_note is null or length(v_note) < 3 then
    return query select false, false, 'NOTE_REQUIRED',
      'Say how you know this sale belongs to this action. The database cannot know it, so '
      || 'your sentence is the whole of the evidence.', null::public.inventory_actions;
    return;
  end if;

  select * into v_row from public.inventory_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id for update;
  if not found then
    return query select false, false, 'NOT_FOUND', 'No such action on this dealership.', null::public.inventory_actions;
    return;
  end if;
  if v_row.outcome_state = 'ATTRIBUTED' then
    if v_row.outcome_purchase_id = p_purchase_id then
      return query select true, true, null::text, 'This sale is already attributed to this action.', v_row;
    else
      return query select false, false, 'ALREADY_ATTRIBUTED',
        'A different sale is already attributed to this action. One action, one outcome.', v_row;
    end if;
    return;
  end if;
  if v_row.status <> 'EXECUTED' then
    return query select false, false, 'NOT_EXECUTED',
      'An outcome can only follow an action that was actually carried out. This one is '
      || v_row.status || '.', v_row;
    return;
  end if;

  select * into v_ph from public.purchase_history ph
   where ph.id = p_purchase_id and ph.tenant_id = v_ctx.tenant_id;
  if not found then
    return query select false, false, 'SALE_NOT_FOUND',
      'No recorded sale with that id on this dealership.', v_row;
    return;
  end if;
  -- An outcome cannot precede the action that is claimed to have produced it.
  if v_ph.purchase_date is null
     or v_ph.purchase_date < (v_row.executed_at at time zone 'Asia/Dubai')::date then
    return query select false, false, 'SALE_PREDATES_ACTION',
      'That sale is dated ' || coalesce(v_ph.purchase_date::text, 'nowhere at all')
      || ' and the action was carried out on '
      || to_char(v_row.executed_at at time zone 'Asia/Dubai', 'YYYY-MM-DD')
      || '. A sale that happened first cannot be an outcome of it.', v_row;
    return;
  end if;

  select * into v_unit from public.inventory i
   where i.tenant_id = v_ctx.tenant_id and i.id = v_row.unit_id;

  if v_ph.amount_aed is null or v_unit.cost_aed is null then
    -- Attributed, but not quantifiable. The link is real; the arithmetic has a
    -- missing input, and a missing input is not a zero.
    v_rec   := null;
    v_basis := null;
  else
    v_rec := v_ph.amount_aed - v_unit.cost_aed;
    v_basis := 'Realised gross margin on the linked sale: purchase_history '
      || p_purchase_id::text || '.amount_aed (AED ' || to_char(v_ph.amount_aed, 'FM999,999,999')
      || ') minus inventory ' || v_row.unit_id || '.cost_aed (AED '
      || to_char(v_unit.cost_aed, 'FM999,999,999') || ') = AED ' || to_char(v_rec, 'FM999,999,999')
      || '. Both figures are recorded, neither is estimated. This is ATTRIBUTED, not a claim '
      || 'that the action caused the sale - NEXUS has no evidence of causation and does not assert any.';
  end if;

  update public.inventory_actions a set
    outcome_state       = 'ATTRIBUTED',
    outcome_purchase_id = p_purchase_id,
    outcome_recorded_at = now(),
    outcome_recorded_by_staff_id = v_ctx.staff_id,
    attribution_basis   = 'HUMAN_CONFIRMED_LINK',
    attribution_note    = v_note,
    recovered_value_aed = v_rec,
    recovered_value_basis = v_basis
  where a.id = v_row.id and a.tenant_id = v_ctx.tenant_id
  returning * into v_row;

  v_audit := public.action_write_audit(
    v_ctx.tenant_id, v_row.id, v_row.unit_id, v_row.recommendation, 'SUCCESS',
    'Outcome attributed by ' || coalesce(v_ctx.staff_name, 'an approver') || ' to sale '
    || p_purchase_id::text || ' (' || coalesce(v_ph.vehicle, 'no vehicle text') || ', '
    || coalesce('AED ' || to_char(v_ph.amount_aed, 'FM999,999,999'), 'amount not recorded') || ', '
    || coalesce(v_ph.purchase_date::text, 'no date') || '). '
    || coalesce(v_basis, 'Realised margin is NOT COMPUTABLE: '
        || case when v_ph.amount_aed is null then 'the sale has no amount recorded. ' else '' end
        || case when v_unit.cost_aed is null then 'the unit has no acquisition cost recorded. ' else '' end
        || 'The link is recorded; the figure is not invented.')
    || ' Stated basis: ' || v_note);

  insert into public.inventory_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, 'OUTCOME_ATTRIBUTED', v_ctx.staff_id, v_ctx.auth_user_id,
          v_ctx.authority, v_note, v_audit);

  return query select true, false, null::text, null::text, v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.action_write_audit(p_tenant uuid, p_action_id uuid, p_unit_id text, p_rec text, p_status text, p_summary text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.assign_hot_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pick record;
begin
  if coalesce(new.status,'') <> 'HOT' or new.assigned_to_id is not null then
    return new;
  end if;

  select u.id, u.name into pick
  from public.users u
  left join public.leads l
    on l.assigned_to_id = u.id
   and l.status = 'HOT'
   and (new.id is null or l.id <> new.id)
   and l.tenant_id is not distinct from new.tenant_id
  -- The whole point of this line: a HOT lead is only ever handed to a rep of
  -- the same dealership. Without it, tenant B's lead lands on tenant A's desk
  -- and tenant A reads B's customer name in their own queue.
  where u.tenant_id is not distinct from new.tenant_id
    and coalesce(u.status,'') <> 'pending_invite'
    and coalesce(u.role,'') in ('senior_rep','sales_rep','manager')
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
$function$
;

CREATE OR REPLACE FUNCTION public.capture_daily_metrics()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into daily_metrics as d (tenant_id, snapshot_date, open_leads, open_leads_rule,
    hot_leads, warm_leads, cold_leads, avg_response_minutes, pipeline_aed,
    pipeline_aed_rule, units_at_risk, holding_cost_aed, workflow_runs,
    workflow_failures, workflow_failures_rule, workflow_failures_canonical)
  select tn.id, current_date,
    (select count(*) from leads where tenant_id = tn.id and nexus_lead_is_open(status)),
    'nexus_lead_is_open',
    (select count(*) from leads where tenant_id = tn.id and upper(status)='HOT'),
    (select count(*) from leads where tenant_id = tn.id and upper(status)='WARM'),
    (select count(*) from leads where tenant_id = tn.id and upper(status)='COLD'),
    (select round(avg(response_time_minutes)::numeric,2) from leads
      where tenant_id = tn.id and response_time_minutes is not null),
    (select sum(budget_aed) from leads where tenant_id = tn.id and nexus_lead_is_open(status)),
    'open_leads_null_when_unknown',
    (select count(*) from inventory where tenant_id = tn.id and aging_alert='CRITICAL'),
    -- No coalesce. A dealership that has stated no holding rate has a holding
    -- cost of UNKNOWN, not of zero. See the comment on this column.
    (select sum(holding_cost_accrued) from inventory where tenant_id = tn.id),
    (select count(*) from audit_log where tenant_id = tn.id),
    (select count(*) from audit_log where tenant_id = tn.id
       and nexus_outcome_class(workflow, status, summary) = 'FAILURE'),
    'nexus_outcome_class',
    (select count(*) from audit_log where tenant_id = tn.id
       and nexus_outcome_class(workflow, status, summary) = 'FAILURE')
  from tenants tn
  where tn.status = 'active'
  on conflict (tenant_id, snapshot_date) do update set
    open_leads=excluded.open_leads, open_leads_rule=excluded.open_leads_rule,
    hot_leads=excluded.hot_leads, warm_leads=excluded.warm_leads,
    cold_leads=excluded.cold_leads,
    avg_response_minutes=excluded.avg_response_minutes,
    pipeline_aed=excluded.pipeline_aed, pipeline_aed_rule=excluded.pipeline_aed_rule,
    units_at_risk=excluded.units_at_risk, holding_cost_aed=excluded.holding_cost_aed,
    workflow_runs=excluded.workflow_runs, workflow_failures=excluded.workflow_failures,
    workflow_failures_rule=excluded.workflow_failures_rule,
    workflow_failures_canonical=excluded.workflow_failures_canonical,
    captured_at=now();
$function$
;

CREATE OR REPLACE FUNCTION public.channel_registry_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.deal_rescue_recommended_action(p_state text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case p_state
    when 'ON_TRACK'         then 'NO_ACTION'
    when 'AT_RISK'          then 'FOLLOW_UP'
    when 'STALLED'          then 'MANAGER_REVIEW'
    when 'CUSTOMER_GHOSTED' then 'CUSTOMER_RECONTACT'
    when 'NEEDS_MANAGER'    then 'MANAGER_REVIEW'
    -- Unreachable today, and unreachable for the same single reason as the
    -- state that feeds it: no lender decision is recorded anywhere. Kept so
    -- that when FINANCE_DECISION lands, one change unlocks both.
    when 'FINANCE_BLOCKED'  then 'FINANCE_REVIEW'
    -- Unknown is not none. Somebody looks.
    when 'UNKNOWN'          then 'MANAGER_REVIEW'
    else                         'MANAGER_REVIEW'
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.deal_rescue_state(p_evidence_tier text, p_has_confirmed_sale boolean, p_lead_is_open boolean, p_silence_state text, p_days_since_movement numeric, p_at_risk_days integer, p_stalled_days integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    -- No admitted deal evidence at all. Unknown is not none.
    when p_evidence_tier is null or p_evidence_tier not in ('STRONG','WEAK')
                                                        then 'UNKNOWN'
    -- Defensive: a sold deal is not in flight and never reaches this engine.
    when p_has_confirmed_sale is true                   then 'UNKNOWN'
    -- Weak evidence can raise a person's attention and nothing more.
    when p_evidence_tier = 'WEAK'                       then 'NEEDS_MANAGER'
    -- Deal evidence live against a lead somebody closed. A contradiction a
    -- person has to resolve; the engine will not pick a side.
    when p_lead_is_open is false                        then 'NEEDS_MANAGER'
    -- Identity unresolved, or no movement timestamp: say so, do not grade.
    when p_lead_is_open is null                         then 'UNKNOWN'
    when p_days_since_movement is null                  then 'UNKNOWN'
    -- Stalled AND the customer specifically is silent. Ordered before STALLED
    -- because ghosting is stalling with a cause. Silence is read from
    -- v_lead_recovery, never re-derived.
    when p_days_since_movement >= p_stalled_days
     and p_silence_state = 'SILENT_PAST_STALE_THRESHOLD' then 'CUSTOMER_GHOSTED'
    when p_days_since_movement >= p_stalled_days        then 'STALLED'
    when p_days_since_movement >= p_at_risk_days        then 'AT_RISK'
    else                                                     'ON_TRACK'
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.inventory_actions_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin new.updated_at := now(); return new; end;
$function$
;

CREATE OR REPLACE FUNCTION public.lead_recovery_cancel(p_action_id uuid, p_note text)
 RETURNS TABLE(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action lead_recovery_actions)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ctx record; v_row public.lead_recovery_actions; v_audit uuid; v_sent text;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code,
      replace(coalesce(v_ctx.refusal_reason,''),'inventory action','action'), null::public.lead_recovery_actions;
    return;
  end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null then
    return query select false, false, 'NOTE_REQUIRED',
      'A cancellation needs a note saying why the action stopped being the right one.', null::public.lead_recovery_actions;
    return;
  end if;
  select * into v_row from public.lead_recovery_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id for update;
  if not found then
    return query select false, false, 'NOT_FOUND', 'No such action on this dealership.', null::public.lead_recovery_actions;
    return;
  end if;
  if v_row.status = 'CANCELLED' then
    return query select true, true, null::text, 'Already cancelled.', v_row;
    return;
  end if;
  if v_row.status in ('EXECUTED','EXECUTION_FAILED') then
    return query select false, false, 'ALREADY_EXECUTED',
      'This action was carried out. Cancelling it would delete the record that somebody did the work.', v_row;
    return;
  end if;
  update public.lead_recovery_actions a set
    status = 'CANCELLED', decided_at = coalesce(a.decided_at, now()),
    decided_by_staff_id = coalesce(a.decided_by_staff_id, v_ctx.staff_id),
    decided_by_auth_id = coalesce(a.decided_by_auth_id, v_ctx.auth_user_id),
    decided_by_authority = coalesce(a.decided_by_authority, coalesce(v_ctx.authority, 'CANCELLED_WITHOUT_APPROVAL_AUTHORITY')),
    decision_note = btrim(p_note),
    outcome_state = 'CLOSED_WITHOUT_ACTION', updated_at = now()
  where a.id = v_row.id and a.tenant_id = v_ctx.tenant_id returning * into v_row;
  v_sent := 'Cancelled by ' || coalesce(v_ctx.staff_name,'an account with no staff record') || ': ' || btrim(p_note);
  v_audit := public.lead_recovery_write_audit(
    v_ctx.tenant_id, v_row.id, v_row.lead_id, v_row.recommendation, 'SUCCESS', v_sent);
  insert into public.lead_recovery_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, 'CANCELLED', v_ctx.staff_id, v_ctx.auth_user_id,
          v_ctx.authority, v_sent, v_audit);
  return query select true, false, null::text, null::text, v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lead_recovery_decide(p_action_id uuid, p_decision text, p_reason_code text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_defer_until date DEFAULT NULL::date, p_assign_staff_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action lead_recovery_actions)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ctx    record;
  v_row    public.lead_recovery_actions;
  v_dec    text := upper(btrim(coalesce(p_decision, '')));
  v_target text;
  v_code   text := nullif(btrim(coalesce(p_reason_code, '')), '');
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_rc     public.lead_recovery_reason_codes%rowtype;
  v_assign public.users%rowtype;
  v_who    text;
  v_audit  uuid;
  v_sent   text;
  v_reason text;
  v_new_assignee uuid;
  v_new_role     text;
begin
  v_target := case v_dec when 'APPROVE' then 'APPROVED'
                         when 'REJECT'  then 'REJECTED'
                         when 'DEFER'   then 'DEFERRED' end;
  if v_target is null then
    raise exception 'lead_recovery_decide: p_decision must be APPROVE, REJECT or DEFER, not %', p_decision
      using errcode = '22023';
  end if;

  select * into v_ctx from public.action_approver_context();
  v_reason := replace(coalesce(v_ctx.refusal_reason, ''), 'inventory action', 'action');
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code, nullif(v_reason,''), null::public.lead_recovery_actions;
    return;
  end if;

  select * into v_row from public.lead_recovery_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id
   for update;
  if not found then
    -- Same answer for "no such action" and "belongs to another dealership".
    return query select false, false, 'NOT_FOUND',
      'No such action on this dealership.', null::public.lead_recovery_actions;
    return;
  end if;

  if not v_ctx.may_decide then
    if v_ctx.refusal_code = 'NO_APPROVER_AT_DEALERSHIP' then
      if v_row.escalated_at is null then
        update public.lead_recovery_actions
           set escalated_at = now(), escalation_reason = v_reason, updated_at = now()
         where id = v_row.id and tenant_id = v_ctx.tenant_id
        returning * into v_row;
      end if;
      v_audit := public.lead_recovery_write_audit(
        v_ctx.tenant_id, v_row.id, v_row.lead_id, v_row.recommendation, 'ESCALATED',
        'A decision (' || v_dec || ') was attempted by '
        || coalesce(v_ctx.staff_name, 'an account with no staff record')
        || ' and this dealership has nobody holding a role allowed to approve actions, so it was '
        || 'handed to a person instead of being decided. It remains PROPOSED.');
      insert into public.lead_recovery_action_events
        (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
      values (v_ctx.tenant_id, v_row.id, 'ESCALATED', v_ctx.staff_id, v_ctx.auth_user_id,
              'NONE - refused; account role ' || coalesce(v_ctx.tenant_role, 'none'), v_reason, v_audit);
      return query select false, false, v_ctx.refusal_code, v_reason, v_row;
      return;
    end if;

    -- "not permitted" is in this summary on purpose: nexus_outcome_class reads it
    -- as refused-by-design and classifies the row REJECTED_EXPECTED, keeping an
    -- authorisation refusal out of any failure rate. Do not reword it without
    -- reading that function.
    v_audit := public.lead_recovery_write_audit(
      v_ctx.tenant_id, v_row.id, v_row.lead_id, v_row.recommendation, 'REJECTED',
      'Decision (' || v_dec || ') not permitted for '
      || coalesce(v_ctx.staff_name, 'an account with no staff record') || ' — ' || v_reason);
    insert into public.lead_recovery_action_events
      (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
    values (v_ctx.tenant_id, v_row.id, 'APPROVAL_REFUSED', v_ctx.staff_id, v_ctx.auth_user_id,
            'NONE - refused; account role ' || coalesce(v_ctx.tenant_role, 'none'), v_reason, v_audit);
    return query select false, false, v_ctx.refusal_code, v_reason, v_row;
    return;
  end if;

  if v_row.status not in ('PROPOSED','DEFERRED') or (v_row.status = 'DEFERRED' and v_target = 'DEFERRED') then
    if v_row.status = v_target
       and v_row.decided_by_auth_id is not distinct from v_ctx.auth_user_id
       and coalesce(v_row.decision_reason_code, '') = coalesce(v_code, '')
       and v_row.defer_until is not distinct from p_defer_until then
      return query select true, true, null::text,
        'This decision was already recorded by you at '
        || to_char(v_row.decided_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI')
        || ' GST. No second record was created.', v_row;
      return;
    end if;
    if v_row.status not in ('PROPOSED','DEFERRED') then
      select u.name into v_who from public.users u where u.id = v_row.decided_by_staff_id;
      v_sent := 'A ' || v_dec || ' arrived for an action already ' || lower(v_row.status)
        || ' by ' || coalesce(v_who, 'another account') || ' on '
        || to_char(v_row.decided_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI')
        || ' GST. It was not applied: the first decision stands.';
      v_audit := public.lead_recovery_write_audit(
        v_ctx.tenant_id, v_row.id, v_row.lead_id, v_row.recommendation, 'REJECTED', v_sent);
      insert into public.lead_recovery_action_events
        (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
      values (v_ctx.tenant_id, v_row.id, 'DECISION_CONFLICT', v_ctx.staff_id, v_ctx.auth_user_id,
              v_ctx.authority, v_sent, v_audit);
      return query select false, false, 'ALREADY_DECIDED', v_sent, v_row;
      return;
    end if;
  end if;

  if v_target in ('REJECTED','DEFERRED') then
    if v_code is null then
      return query select false, false, 'REASON_REQUIRED',
        'A ' || lower(v_target) || ' decision needs a reason code from the closed list. It is the only '
        || 'way this product ever learns which recommendations were wrong.', v_row;
      return;
    end if;
    select * into v_rc from public.lead_recovery_reason_codes where code = v_code;
    if not found or not (v_dec = any (v_rc.applies_to)) then
      return query select false, false, 'REASON_NOT_VALID',
        'Reason code ' || v_code || ' is not one this system accepts for a ' || lower(v_target)
        || '. Read public.lead_recovery_reason_codes for the list.', v_row;
      return;
    end if;
    if v_target = 'REJECTED' and (v_note is null or length(v_note) < 3) then
      return query select false, false, 'NOTE_REQUIRED',
        'A rejection needs a note as well as a code. The code makes it countable; the note is what '
        || 'makes it understandable to whoever reads it in three months.', v_row;
      return;
    end if;
  end if;
  if v_target = 'DEFERRED' and p_defer_until is not null and p_defer_until <= current_date then
    return query select false, false, 'DEFER_DATE_PAST',
      'A deferral has to point at a future date, otherwise it is due the moment it is made.', v_row;
    return;
  end if;

  if p_assign_staff_id is not null then
    select * into v_assign from public.users u
     where u.id = p_assign_staff_id and u.tenant_id = v_ctx.tenant_id;
    if not found then
      return query select false, false, 'ASSIGNEE_NOT_FOUND',
        'That person is not on this dealership''s staff list, so the action cannot be assigned to them.', v_row;
      return;
    end if;
  end if;

  v_new_assignee := case when v_target = 'APPROVED' then p_assign_staff_id else v_row.assigned_to_staff_id end;
  v_new_role     := case when v_target <> 'APPROVED' then v_row.assigned_role
                         when p_assign_staff_id is null then v_row.engine_owner_role
                         else v_assign.role end;

  update public.lead_recovery_actions a set
    status               = v_target,
    decided_at           = now(),
    decided_by_staff_id  = v_ctx.staff_id,
    decided_by_auth_id   = v_ctx.auth_user_id,
    decided_by_authority = v_ctx.authority,
    decision_reason_code = v_code,
    decision_note        = v_note,
    defer_until          = case when v_target = 'DEFERRED' then p_defer_until else null end,
    assigned_to_staff_id = v_new_assignee,
    assigned_role        = v_new_role,
    assigned_at          = case when v_target = 'APPROVED' then now() else a.assigned_at end,
    outcome_state        = case when v_target = 'REJECTED' then 'CLOSED_WITHOUT_ACTION' else a.outcome_state end,
    updated_at           = now()
  where a.id = v_row.id and a.tenant_id = v_ctx.tenant_id
  returning * into v_row;

  v_sent := case v_target
    when 'APPROVED' then 'Approved by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
      || ' on authority ' || v_ctx.authority || '. Assigned to '
      || coalesce(v_assign.name, nullif(v_row.assigned_role, ''), 'nobody in particular')
      || '. Nothing has been executed yet and no money has been recovered - approval is a decision, not an outcome.'
    when 'REJECTED' then 'Rejected by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
      || ' on authority ' || v_ctx.authority || '. Reason ' || v_code || ': ' || v_note
      || '. Recorded as evidence about the recommendation, not as a fault.'
    else 'Deferred by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
      || ' on authority ' || v_ctx.authority || '. Reason ' || v_code
      || coalesce('. Due again ' || to_char(p_defer_until, 'DD Mon YYYY'), '. No date set') || '.' end;

  v_audit := public.lead_recovery_write_audit(
    v_ctx.tenant_id, v_row.id, v_row.lead_id, v_row.recommendation, 'SUCCESS', v_sent);

  insert into public.lead_recovery_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, v_target, v_ctx.staff_id, v_ctx.auth_user_id,
          v_ctx.authority, v_sent, v_audit);

  return query select true, false, null::text, null::text, v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lead_recovery_mark_executed(p_action_id uuid, p_note text DEFAULT NULL::text, p_failed boolean DEFAULT false, p_failure text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action lead_recovery_actions)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ctx record; v_row public.lead_recovery_actions; v_audit uuid; v_sent text;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code,
      replace(coalesce(v_ctx.refusal_reason,''),'inventory action','action'), null::public.lead_recovery_actions;
    return;
  end if;
  select * into v_row from public.lead_recovery_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id for update;
  if not found then
    return query select false, false, 'NOT_FOUND', 'No such action on this dealership.', null::public.lead_recovery_actions;
    return;
  end if;
  if v_row.status in ('EXECUTED','EXECUTION_FAILED') then
    return query select true, true, null::text,
      'Already recorded as ' || lower(v_row.status) || '. No second record was created.', v_row;
    return;
  end if;
  if v_row.status <> 'APPROVED' then
    return query select false, false, 'NOT_APPROVED',
      'Only an approved action can be executed. This one is ' || lower(v_row.status)
      || '. Recording execution against an undecided action would erase the decision step.', v_row;
    return;
  end if;
  if p_failed and nullif(btrim(coalesce(p_failure,'')),'') is null then
    return query select false, false, 'FAILURE_REQUIRED',
      'A failed execution needs to say what failed, otherwise the record teaches nobody anything.', v_row;
    return;
  end if;

  update public.lead_recovery_actions a set
    status = case when p_failed then 'EXECUTION_FAILED' else 'EXECUTED' end,
    executed_at = now(), executed_by_staff_id = v_ctx.staff_id,
    execution_note = nullif(btrim(coalesce(p_note,'')),''),
    execution_failure = case when p_failed then btrim(p_failure) end,
    outcome_state = case when p_failed then a.outcome_state else 'AWAITING_OUTCOME' end,
    updated_at = now()
  where a.id = v_row.id and a.tenant_id = v_ctx.tenant_id
  returning * into v_row;

  v_sent := case when p_failed
    then 'Execution failed: ' || v_row.execution_failure
    else 'A person carried this out: ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
         || '. Nothing has been recovered yet - the outcome is unknown until a sale is recorded and attributed.' end;
  v_audit := public.lead_recovery_write_audit(
    v_ctx.tenant_id, v_row.id, v_row.lead_id, v_row.recommendation,
    case when p_failed then 'FAILED' else 'SUCCESS' end, v_sent);
  insert into public.lead_recovery_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, case when p_failed then 'EXECUTION_FAILED' else 'EXECUTED' end,
          v_ctx.staff_id, v_ctx.auth_user_id, v_ctx.authority, v_sent, v_audit);
  return query select true, false, null::text, null::text, v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lead_recovery_mark_not_attributable(p_action_id uuid, p_note text)
 RETURNS TABLE(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action lead_recovery_actions)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ctx record; v_row public.lead_recovery_actions; v_audit uuid; v_sent text;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code,
      replace(coalesce(v_ctx.refusal_reason,''),'inventory action','action'), null::public.lead_recovery_actions;
    return;
  end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null then
    return query select false, false, 'NOTE_REQUIRED',
      'Closing an outcome as not attributable needs a note. "We do not know" is a finding and has to '
      || 'be written down as one.', null::public.lead_recovery_actions;
    return;
  end if;
  select * into v_row from public.lead_recovery_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id for update;
  if not found then
    return query select false, false, 'NOT_FOUND', 'No such action on this dealership.', null::public.lead_recovery_actions;
    return;
  end if;
  update public.lead_recovery_actions a set
    outcome_state = 'NOT_ATTRIBUTABLE', outcome_recorded_at = now(),
    outcome_recorded_by_staff_id = v_ctx.staff_id,
    attribution_basis = 'DECLARED_NOT_ATTRIBUTABLE_BY_A_PERSON',
    attribution_note = btrim(p_note), updated_at = now()
  where a.id = v_row.id and a.tenant_id = v_ctx.tenant_id returning * into v_row;
  v_sent := 'Outcome closed as NOT ATTRIBUTABLE by ' || coalesce(v_ctx.staff_name,'an account with no staff record')
            || ': ' || btrim(p_note) || ' No revenue is claimed.';
  v_audit := public.lead_recovery_write_audit(
    v_ctx.tenant_id, v_row.id, v_row.lead_id, v_row.recommendation, 'SUCCESS', v_sent);
  insert into public.lead_recovery_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, 'OUTCOME_NOT_ATTRIBUTABLE', v_ctx.staff_id, v_ctx.auth_user_id,
          v_ctx.authority, v_sent, v_audit);
  return query select true, false, null::text, null::text, v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lead_recovery_outcome_candidates(p_action_id uuid)
 RETURNS TABLE(purchase_id uuid, vehicle text, amount_aed integer, purchase_date date, recorded_at timestamp with time zone, recorded_after_execution boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid; v_row public.lead_recovery_actions;
begin
  v_tenant := public.nexus_current_tenant_id();
  if v_tenant is null then return; end if;
  select * into v_row from public.lead_recovery_actions a
   where a.id = p_action_id and a.tenant_id = v_tenant;
  if not found then return; end if;
  return query
    select p.id, p.vehicle, p.amount_aed, p.purchase_date, p.created_at,
           (v_row.executed_at is not null and p.created_at >= v_row.executed_at)
      from public.purchase_history p
     where p.tenant_id = v_tenant and p.lead_id = v_row.lead_id
     order by p.created_at desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lead_recovery_propose(p_lead_id integer)
 RETURNS TABLE(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action lead_recovery_actions)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ctx    record;
  v_eng    record;
  v_row    public.lead_recovery_actions;
  v_prior  public.lead_recovery_actions;
  v_cool   integer;
  v_audit  uuid;
  v_reason text;
begin
  select * into v_ctx from public.action_approver_context();
  v_reason := replace(coalesce(v_ctx.refusal_reason, ''), 'inventory action', 'action');
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code, nullif(v_reason, ''), null::public.lead_recovery_actions;
    return;
  end if;
  if p_lead_id is null then
    return query select false, false, 'NO_LEAD', 'No lead id was supplied.', null::public.lead_recovery_actions;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_ctx.tenant_id::text || '|lead|' || p_lead_id::text, 0));

  -- v_lead_recovery is security_invoker, so inside this SECURITY DEFINER function
  -- it evaluates RLS as the function owner and sees every dealership. The tenant
  -- predicate below is load-bearing security, not tidiness.
  select * into v_eng
    from public.v_lead_recovery v
   where v.tenant_id = v_ctx.tenant_id and v.lead_id = p_lead_id;
  if not found then
    return query select false, false, 'LEAD_NOT_FOUND',
      'No lead with that id at this dealership.', null::public.lead_recovery_actions;
    return;
  end if;
  if v_eng.recommended_action = 'NO_ACTION' then
    return query select false, false, 'NOTHING_RECOMMENDED',
      'The engine recommends no action on this lead: ' || coalesce(v_eng.action_reason, '')
      || ' An action is not raised against a recommendation the engine did not make.',
      null::public.lead_recovery_actions;
    return;
  end if;

  select * into v_row from public.lead_recovery_actions a
   where a.tenant_id = v_ctx.tenant_id and a.lead_id = p_lead_id
     and a.status in ('PROPOSED','APPROVED','DEFERRED')
   limit 1;
  if found then
    return query select true, true, null::text,
      'An action for this lead is already open, so this did not create a second one.', v_row;
    return;
  end if;

  select coalesce(s.reproposal_cooldown_days, 7) into v_cool
    from public.lead_recovery_settings s where s.tenant_id = v_ctx.tenant_id;
  v_cool := coalesce(v_cool, 7);
  if v_cool > 0 then
    select * into v_prior from public.lead_recovery_actions a
     where a.tenant_id = v_ctx.tenant_id and a.lead_id = p_lead_id
       and a.recommendation = v_eng.recommended_action
       and a.status in ('REJECTED','CANCELLED') and a.decided_at is not null
       and a.decided_at > now() - make_interval(days => v_cool)
     order by a.decided_at desc limit 1;
    if found then
      return query select false, false, 'SUPPRESSED_BY_RECENT_DECISION',
        'This recommendation was already decided on '
        || to_char(v_prior.decided_at at time zone 'Asia/Dubai', 'DD Mon YYYY')
        || ' (' || v_prior.status || ', ' || coalesce(v_prior.decision_reason_code, 'no code')
        || ') and the cooldown is ' || v_cool || ' days. Raising it again would ignore that answer.',
        v_prior;
      return;
    end if;
  end if;

  insert into public.lead_recovery_actions (
    tenant_id, lead_id, recommendation, engine_state, engine_reason,
    engine_confidence, engine_confidence_basis, engine_risk_level, engine_risk_basis,
    engine_evidence, engine_owner_role, engine_computed_at,
    opportunity_value_state, opportunity_value_basis,
    proposed_by_staff_id, outcome_state)
  values (
    v_ctx.tenant_id, p_lead_id, v_eng.recommended_action, v_eng.state, v_eng.action_reason,
    v_eng.confidence, v_eng.confidence_basis, v_eng.risk_level, v_eng.risk_basis,
    v_eng.evidence, v_eng.owner_job_title, v_eng.computed_at,
    v_eng.opportunity_value_state, v_eng.opportunity_value_basis,
    v_ctx.staff_id, 'NONE_YET')
  returning * into v_row;

  v_audit := public.lead_recovery_write_audit(
    v_ctx.tenant_id, v_row.id, p_lead_id, v_row.recommendation, 'SUCCESS',
    'Proposed from the engine by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
    || '. State ' || coalesce(v_eng.state, 'unknown') || ', risk ' || coalesce(v_eng.risk_level, 'unknown')
    || '. No monetary exposure is claimed: nothing in this schema measures what a lead is worth. '
    || 'Awaiting a decision.');

  insert into public.lead_recovery_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, 'PROPOSED', v_ctx.staff_id, v_ctx.auth_user_id,
          'Raised from the engine queue. ' || coalesce(v_eng.action_reason, ''), v_audit);

  return query select true, false, null::text, null::text, v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lead_recovery_recommended_action(p_state text, p_risk text, p_has_owner boolean)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_risk = 'NONE'                                        then 'NO_ACTION'
    when p_risk = 'UNKNOWN'                                     then 'MANAGER_REVIEW'
    when p_state = 'ESCALATED'                                  then 'MANAGER_REVIEW'
    when p_has_owner is not true and p_risk in ('HIGH','MEDIUM') then 'ASSIGN_OWNER'
    when p_risk = 'HIGH'                                        then 'ESCALATE'
    when p_state in ('WAITING_RESPONSE','SILENT')               then 'FOLLOW_UP'
    else 'NO_ACTION'
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.lead_recovery_record_outcome(p_action_id uuid, p_purchase_id uuid, p_note text DEFAULT NULL::text)
 RETURNS TABLE(ok boolean, idempotent boolean, refusal_code text, refusal_reason text, action lead_recovery_actions)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ctx record; v_row public.lead_recovery_actions; v_p public.purchase_history;
        v_audit uuid; v_sent text;
begin
  select * into v_ctx from public.action_approver_context();
  if v_ctx.tenant_id is null then
    return query select false, false, v_ctx.refusal_code,
      replace(coalesce(v_ctx.refusal_reason,''),'inventory action','action'), null::public.lead_recovery_actions;
    return;
  end if;
  if not v_ctx.may_decide then
    return query select false, false, coalesce(v_ctx.refusal_code,'NOT_AN_APPROVER'),
      'Attributing revenue to an action is an approver''s call. '
      || replace(coalesce(v_ctx.refusal_reason,''),'inventory action','action'), null::public.lead_recovery_actions;
    return;
  end if;
  select * into v_row from public.lead_recovery_actions a
   where a.id = p_action_id and a.tenant_id = v_ctx.tenant_id for update;
  if not found then
    return query select false, false, 'NOT_FOUND', 'No such action on this dealership.', null::public.lead_recovery_actions;
    return;
  end if;
  if v_row.outcome_state = 'ATTRIBUTED' and v_row.outcome_purchase_id = p_purchase_id then
    return query select true, true, null::text, 'This outcome was already recorded. No second record was created.', v_row;
    return;
  end if;
  if v_row.status <> 'EXECUTED' then
    return query select false, false, 'NOT_EXECUTED',
      'Revenue cannot be attributed to an action nobody carried out. This action is '
      || lower(v_row.status) || '. A recommendation is not a recovery.', v_row;
    return;
  end if;

  select * into v_p from public.purchase_history p
   where p.id = p_purchase_id and p.tenant_id = v_ctx.tenant_id;
  if not found then
    return query select false, false, 'SALE_NOT_FOUND',
      'No sale with that id at this dealership.', v_row;
    return;
  end if;
  if v_p.lead_id is distinct from v_row.lead_id then
    return query select false, false, 'SALE_IS_ANOTHER_LEADS',
      'That sale is not recorded against this lead, so attributing it here would invent a link '
      || 'between a recovery action and someone else''s purchase.', v_row;
    return;
  end if;
  if v_p.created_at < v_row.executed_at then
    return query select false, false, 'SALE_PREDATES_THE_ACTION',
      'That sale was recorded on '
      || to_char(v_p.created_at at time zone 'Asia/Dubai', 'DD Mon YYYY HH24:MI')
      || ' GST, before this action was carried out. An action cannot have recovered a sale that '
      || 'already existed.', v_row;
    return;
  end if;
  if v_p.amount_aed is null then
    return query select false, false, 'SALE_HAS_NO_AMOUNT',
      'That sale carries no amount, so there is no confirmed figure to attribute. '
      || 'Record the amount on the sale first; do not estimate it here.', v_row;
    return;
  end if;

  update public.lead_recovery_actions a set
    outcome_state = 'ATTRIBUTED',
    outcome_purchase_id = v_p.id,
    outcome_recorded_at = now(),
    outcome_recorded_by_staff_id = v_ctx.staff_id,
    attribution_basis = 'EXECUTED_ACTION_PRECEDED_A_RECORDED_SALE_ON_THE_SAME_LEAD',
    attribution_note = nullif(btrim(coalesce(p_note,'')),''),
    recovered_value_aed = v_p.amount_aed,
    recovered_value_basis = 'CONFIRMED_SALE_AMOUNT_FROM_PURCHASE_HISTORY',
    updated_at = now()
  where a.id = v_row.id and a.tenant_id = v_ctx.tenant_id
  returning * into v_row;

  v_sent := 'Outcome attributed by ' || coalesce(v_ctx.staff_name, 'an account with no staff record')
    || '. Sale ' || v_p.id || ' (' || coalesce(v_p.vehicle,'vehicle not named') || ', AED '
    || to_char(v_p.amount_aed, 'FM999,999,999') || ') was recorded after this action was carried out on '
    || 'the same lead. CONFIRMED revenue, attributed by a person - not an estimate and not proof of cause.';
  v_audit := public.lead_recovery_write_audit(
    v_ctx.tenant_id, v_row.id, v_row.lead_id, v_row.recommendation, 'SUCCESS', v_sent);
  insert into public.lead_recovery_action_events
    (tenant_id, action_id, event, actor_staff_id, actor_auth_id, actor_authority, detail, audit_log_id)
  values (v_ctx.tenant_id, v_row.id, 'OUTCOME_ATTRIBUTED', v_ctx.staff_id, v_ctx.auth_user_id,
          v_ctx.authority, v_sent, v_audit);
  return query select true, false, null::text, null::text, v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lead_recovery_risk(p_state text, p_minutes_since_inbound numeric, p_hours_since_outbound numeric, p_sla_minutes integer, p_stale_hours integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when p_state in ('RECOVERED','CLOSED_NO_OUTCOME') then 'NONE'
    when p_state = 'NEW_RISK'                         then 'UNKNOWN'
    when p_state = 'ESCALATED'                        then 'HIGH'
    when p_state = 'WAITING_RESPONSE'
      then case when p_minutes_since_inbound > p_sla_minutes then 'HIGH' else 'MEDIUM' end
    when p_state = 'SILENT'
      then case when p_hours_since_outbound >= p_stale_hours then 'HIGH' else 'MEDIUM' end
    when p_state = 'ENGAGED'                          then 'LOW'
    else 'UNKNOWN'
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.lead_recovery_state(p_sales_recorded bigint, p_lead_is_open boolean, p_messages bigint, p_escalated_at timestamp with time zone, p_last_message_at timestamp with time zone, p_last_inbound_at timestamp with time zone, p_last_outbound_at timestamp with time zone, p_hours_since_outbound numeric, p_silence_hours integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when coalesce(p_sales_recorded, 0) > 0                                     then 'RECOVERED'
    when p_lead_is_open is false                                               then 'CLOSED_NO_OUTCOME'
    when coalesce(p_messages, 0) = 0                                           then 'NEW_RISK'
    when p_escalated_at is not null
     and (p_last_message_at is null or p_escalated_at >= p_last_message_at)     then 'ESCALATED'
    when p_last_inbound_at is not null
     and (p_last_outbound_at is null or p_last_inbound_at > p_last_outbound_at) then 'WAITING_RESPONSE'
    when p_last_outbound_at is not null
     and p_hours_since_outbound >= p_silence_hours                             then 'SILENT'
    when p_last_message_at is not null                                         then 'ENGAGED'
    else 'NEW_RISK'
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.lead_recovery_write_audit(p_tenant uuid, p_action_id uuid, p_lead_id integer, p_rec text, p_status text, p_summary text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  insert into public.audit_log (workflow, status, summary, tenant_id)
  values ('Lead Recovery Action Center', p_status,
          'Lead recovery action ' || coalesce(p_action_id::text, '(none)')
          || ' · lead ' || coalesce(p_lead_id::text, '(none)')
          || ' · ' || coalesce(p_rec, '(none)')
          || ' · ' || coalesce(p_summary, ''),
          p_tenant)
  returning id into v_id;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_channel_capability_state(p_provider text, p_send_form text)
 RETURNS TABLE(provider text, send_form text, support_state text, basis text, evidence text, verified_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce(c.provider,  lower(btrim(coalesce(p_provider,'')))),
         coalesce(c.send_form, upper(btrim(coalesce(p_send_form,'')))),
         coalesce(c.support_state, 'NOT_SUPPORTED'),
         coalesce(c.basis, 'CAPABILITY_NOT_ON_FILE'),
         coalesce(c.evidence,
           'No row in channel_provider_capability states that this provider can carry this send form. Absence is read as cannot-carry. It is never read as "try it and see": an untested send against a live customer number is how a dealership finds out it cannot, and it finds out by being rate-limited or banned.'),
         c.verified_at
    from (select 1) s
    left join public.channel_provider_capability c
      on c.provider  = lower(btrim(coalesce(p_provider,'')))
     and c.send_form = upper(btrim(coalesce(p_send_form,'')));
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_channel_send_candidates(p_tenant_id uuid, p_send_form text, p_customer_external_id text)
 RETURNS TABLE(integration_id uuid, channel_type text, external_identifier text, credential_ref text, provider text, provider_rank integer, is_official_platform boolean, support_state text, capability_basis text, capability_evidence text, last_customer_message_at timestamp with time zone, registered_at timestamp with time zone, eligible boolean, selection_order bigint, excluded_because text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with cand as (
    select cr.integration_id,
           cr.channel_type,
           cr.external_identifier,
           cr.credential_ref,
           cr.created_at as registered_at,
           case cr.channel_type
             when 'whatsapp_waha_session'          then 'waha'
             when 'whatsapp_cloud_phone_number_id' then 'whatsapp_cloud'
           end as provider
      from public.channel_registry cr
      join public.tenants t on t.id = cr.tenant_id
     where cr.tenant_id = p_tenant_id
       and cr.status    = 'active'
       and t.status     = 'active'
  ),
  enriched as (
    select c.*,
           r.rank as provider_rank,
           coalesce(r.is_official_platform, false) as is_official_platform,
           k.support_state,
           k.basis    as capability_basis,
           k.evidence as capability_evidence,
           ws.last_customer_message_at
      from cand c
      left join public.channel_provider_rank r on r.provider = c.provider
      left join lateral public.nexus_channel_capability_state(c.provider, p_send_form) k on true
      left join public.whatsapp_conversation_state ws
             on ws.tenant_id      = p_tenant_id
            and ws.integration_id = c.integration_id
            and ws.customer_wa_id = lower(btrim(coalesce(p_customer_external_id,'')))
  ),
  ranked as (
    select e.*,
           (e.support_state = 'SUPPORTED' and e.provider is not null) as eligible,
           case when e.support_state = 'SUPPORTED' and e.provider is not null then
             row_number() over (
               -- PARTITION BY eligibility is load-bearing and must not be
               -- removed. Without it row_number() counts the integrations that
               -- CANNOT carry this send form, and one of them takes position 1
               -- whenever it sorts first on C1 - which is exactly the case a
               -- customer replying on the WAHA number creates for a template
               -- send. The CASE below blanks the value; it does not stop the
               -- counter.
               partition by (e.support_state = 'SUPPORTED' and e.provider is not null)
               -- C1 conversation continuity: a reply leaves from the number the
               --    customer actually wrote to. Outranks the provider preference.
               order by (e.last_customer_message_at is null),
                        e.last_customer_message_at desc nulls last,
               -- C2 official platform first. Lower rank wins. NOT cheaper first.
                        coalesce(e.provider_rank, 999),
               -- C3 deterministic tie-break. Never random, never least-loaded.
                        e.registered_at asc,
                        e.integration_id asc
             )
           end as selection_order
      from enriched e
  )
  select integration_id, channel_type, external_identifier, credential_ref, provider,
         provider_rank, is_official_platform, support_state, capability_basis,
         capability_evidence, last_customer_message_at, registered_at, eligible,
         selection_order,
         case
           when provider is null then
             'This channel_type has no provider mapping, so NEXUS does not know what would carry it.'
           when support_state <> 'SUPPORTED' then
             format('%s cannot carry a %s send. %s', provider, upper(btrim(coalesce(p_send_form,''))), capability_evidence)
           when selection_order > 1 then
             'Capable, but another active integration was selected ahead of it by the carrier rules.'
         end as excluded_because
    from ranked
   order by eligible desc, selection_order nulls last, registered_at, integration_id;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_comm_keys_for_lead(p_email text, p_phone text)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.nexus_comm_keys_for_lead(p_email, p_phone, public.nexus_scoped_tenant_id());
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_comm_keys_for_lead(p_email text, p_phone text, p_tenant uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_keys text[] := '{}'; v_chats text[] := '{}';
  v_digits text := regexp_replace(coalesce(p_phone,''), '[^0-9]','','g');
  v_lead text := nullif(btrim(coalesce(p_email,'')),''); v_edig text;
begin
  if p_tenant is null and (select count(*) from public.tenants where status='active') > 1 then
    return '{}'::text[];
  end if;
  if v_lead is not null then
    v_keys := v_keys || v_lead;
    v_edig := regexp_replace(v_lead, '[^0-9]','','g');
    if v_lead like '+%@whatsapp.lead' and v_edig <> '' then
      v_keys := v_keys || (v_edig || '@c.us');
      if v_digits = '' then v_digits := v_edig; end if;
    end if;
  end if;
  if v_digits <> '' then
    v_keys := v_keys || ('+' || v_digits || '@whatsapp.lead') || (v_digits || '@c.us');
  end if;
  select coalesce(array_agg(chat_id), '{}'::text[]) into v_chats
    from public.whatsapp_contacts
   where chat_id is not null
     and (p_tenant is null or tenant_id = p_tenant)
     and ((v_lead is not null and lead_email = v_lead)
       or (v_digits <> '' and regexp_replace(coalesce(phone,''), '[^0-9]','','g') = v_digits));
  v_keys := v_keys || coalesce(v_chats, '{}'::text[]);
  select coalesce(array_agg(distinct k), '{}'::text[]) into v_keys
    from unnest(v_keys) as k where k is not null and btrim(k) <> '';
  return v_keys;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_current_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce(
    (select c.tid
       from (select public.nexus_jwt_tenant_id() as tid) c
       join public.tenant_members m
         on m.tenant_id = c.tid and m.auth_user_id = auth.uid()
       join public.tenants t on t.id = c.tid and t.status = 'active'),
    (select m.tenant_id
       from public.tenant_members m
       join public.tenants t on t.id = m.tenant_id and t.status = 'active'
      where auth.uid() is not null and m.auth_user_id = auth.uid()
      order by m.created_at, m.tenant_id
      limit 1));
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_current_tenant_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select m.tenant_id
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
   where auth.uid() is not null and m.auth_user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_default_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce(
    public.nexus_current_tenant_id(),
    (select t.id from public.tenants t
      where t.is_unattributed_default
        and t.status = 'active'
        -- The unattributed-default fallback is for trusted backend writers.
        -- A signed-in end user gets their membership or nothing.
        and coalesce(current_setting('role', true), '') not in ('authenticated', 'anon')
      limit 1));
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_is_approval_rules(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and p ? 'default'
    and jsonb_typeof(p -> 'default') = 'object'
    and (p -> 'default' ->> 'requires_human') in ('true','false')
    and coalesce((
      select bool_and(
        jsonb_typeof(e.value) = 'object'
        and (e.value ->> 'requires_human') in ('true','false')
        and (not (e.value ? 'approver_roles')
             or jsonb_typeof(e.value -> 'approver_roles') = 'array'))
      from jsonb_each(p) e), true)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_is_business_hours(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and p ?& array['mon','tue','wed','thu','fri','sat','sun']
    and (select count(*) from jsonb_object_keys(p)) = 7
    and coalesce((
      select bool_and(
        jsonb_typeof(e.value) = 'array'
        and coalesce((
          select bool_and(
            jsonb_typeof(iv) = 'array'
            and jsonb_array_length(iv) = 2
            and (iv ->> 0) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            and (iv ->> 1) ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            and (iv ->> 1) > (iv ->> 0))
          from jsonb_array_elements(e.value) iv), true)
      )
      from jsonb_each(p) e), true)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_is_followup_policy(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select p is null or (
    jsonb_typeof(p) = 'object'
    and p ? 'steps'
    and jsonb_typeof(p -> 'steps') = 'array'
    and jsonb_array_length(p -> 'steps') between 1 and 12
    and coalesce((
      select bool_and(
        jsonb_typeof(s) = 'object'
        and s ? 'after_hours'
        and jsonb_typeof(s -> 'after_hours') = 'number'
        and (s -> 'after_hours') > '0'::jsonb
        and s ? 'channel'
        and (s ->> 'channel') in ('whatsapp','email','sms'))
      from jsonb_array_elements(p -> 'steps') s), false)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_is_message(p_direction text, p_channel text, p_message text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select btrim(lower(coalesce(p_direction, ''))) in ('inbound', 'outbound')
     and btrim(lower(coalesce(p_channel,   ''))) in ('whatsapp', 'email', 'sms')
     and coalesce(p_message, '') not like '[system]%'
     and coalesce(p_message, '') not like '[SILENCE-%';
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_is_reply(p_direction text, p_channel text, p_message text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select public.nexus_is_message(p_direction, p_channel, p_message)
     and btrim(lower(coalesce(p_direction, ''))) = 'outbound';
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_jwt_tenant_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare raw text; j jsonb; v text;
begin
  raw := current_setting('request.jwt.claims', true);
  if raw is null or btrim(raw) = '' then return null; end if;
  begin j := raw::jsonb; exception when others then return null; end;
  v := coalesce(j->'app_metadata'->>'tenant_id',
                j->'user_metadata'->>'tenant_id',
                j->>'tenant_id');
  if v is null or btrim(v) = '' then return null; end if;
  begin return v::uuid; exception when others then return null; end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_kyc_object_tenant(p_name text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  -- SECURITY DEFINER on purpose: the caller must not be able to see other
  -- tenants' kyc_documents rows, but the policy must still be able to tell
  -- "this object belongs to someone else" apart from "this object belongs to
  -- nobody". Returns NULL only when no dealership claims the object at all.
  select k.tenant_id
    from public.kyc_documents k
   where k.storage_path = p_name
   order by k.created_at
   limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_lead_for_comm_key(p_key text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.nexus_lead_for_comm_key(p_key, public.nexus_scoped_tenant_id());
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_lead_for_comm_key(p_key text, p_tenant uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_raw    text := nullif(btrim(p_key), '');
  v_digits text;  v_tail text;  v_id integer;
  v_email  text;  v_wcdig text; v_people integer;
begin
  if v_raw is null then return null; end if;
  -- Refuse to guess across dealerships. With one tenant this never fires.
  if p_tenant is null and (select count(*) from public.tenants where status='active') > 1 then
    return null;
  end if;

  select id into v_id from public.leads
   where email = v_raw and coalesce(email,'') <> ''
     and (p_tenant is null or tenant_id = p_tenant)
   order by created_at limit 1;
  if v_id is not null then return v_id; end if;

  if v_raw not like '%@lid' then
    v_digits := regexp_replace(split_part(v_raw,'@',1), '[^0-9]', '', 'g');
    v_tail   := case when length(v_digits) >= 9 then right(v_digits,9) end;
    if v_tail is not null then
      select count(distinct coalesce(nullif(lower(btrim(coalesce(l.email,''))),''),
                                     'lead:' || l.id::text))
        into v_people from public.leads l
       where (p_tenant is null or l.tenant_id = p_tenant)
         and (right(regexp_replace(coalesce(l.phone,''), '[^0-9]','','g'),9) = v_tail
           or right(regexp_replace(split_part(coalesce(l.email,''),'@',1), '[^0-9]','','g'),9) = v_tail);
      if coalesce(v_people,0) > 1 then return null; end if;   -- ambiguous: refuse
      if v_people = 1 then
        select id into v_id from public.leads
         where (p_tenant is null or tenant_id = p_tenant)
           and (right(regexp_replace(coalesce(phone,''), '[^0-9]','','g'),9) = v_tail
             or right(regexp_replace(split_part(coalesce(email,''),'@',1), '[^0-9]','','g'),9) = v_tail)
         order by created_at limit 1;
        if v_id is not null then return v_id; end if;
      end if;
    end if;
  end if;

  select lead_email into v_email from public.whatsapp_contacts
   where chat_id = v_raw and nullif(btrim(lead_email),'') is not null
     and (p_tenant is null or tenant_id = p_tenant) limit 1;
  if v_email is not null then
    select id into v_id from public.leads
     where email = v_email and (p_tenant is null or tenant_id = p_tenant)
     order by created_at limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  select regexp_replace(coalesce(phone,''), '[^0-9]','','g') into v_wcdig
    from public.whatsapp_contacts
   where chat_id = v_raw and (p_tenant is null or tenant_id = p_tenant) limit 1;
  if v_wcdig is not null and length(v_wcdig) >= 9 then
    v_tail := right(v_wcdig,9);
    select count(distinct coalesce(nullif(lower(btrim(coalesce(l.email,''))),''),
                                   'lead:' || l.id::text))
      into v_people from public.leads l
     where (p_tenant is null or l.tenant_id = p_tenant)
       and (right(regexp_replace(coalesce(l.phone,''), '[^0-9]','','g'),9) = v_tail
         or right(regexp_replace(split_part(coalesce(l.email,''),'@',1), '[^0-9]','','g'),9) = v_tail);
    if coalesce(v_people,0) > 1 then return null; end if;
    if v_people = 1 then
      select id into v_id from public.leads
       where (p_tenant is null or tenant_id = p_tenant)
         and (right(regexp_replace(coalesce(phone,''), '[^0-9]','','g'),9) = v_tail
           or right(regexp_replace(split_part(coalesce(email,''),'@',1), '[^0-9]','','g'),9) = v_tail)
       order by created_at limit 1;
      if v_id is not null then return v_id; end if;
    end if;
  end if;

  return null;
end;
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_mark_first_response()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lead integer; v_created timestamptz;
  v_at timestamptz := coalesce(new.created_at, now());
  v_secs numeric; v_prior boolean;
begin
  if not public.nexus_is_reply(new.direction, new.channel, new.message) then
    return new;
  end if;
  begin
    -- new.tenant_id, not a session default: the row itself says whose it is.
    v_lead := public.nexus_lead_for_comm_key(new.lead_email, new.tenant_id);
    if v_lead is null then return new; end if;

    select l.created_at into v_created from public.leads l
     where l.id = v_lead and l.response_time_minutes is null
       and l.tenant_id is not distinct from new.tenant_id;
    if v_created is null then return new; end if;

    v_secs := extract(epoch from (v_at - v_created));

    if v_secs < 0 then
      if v_secs < -90 then return new; end if;
      select exists (
        select 1 from public.communication_logs c
         where c.created_at < v_at
           and c.tenant_id is not distinct from new.tenant_id
           and lower(coalesce(c.direction,'')) = 'inbound'
           and public.nexus_lead_for_comm_key(c.lead_email, new.tenant_id) = v_lead
      ) into v_prior;
      if v_prior then return new; end if;
      v_secs := 0;
    end if;

    update public.leads l
       set response_time_minutes = round(v_secs / 60.0)::integer
     where l.id = v_lead
       and l.tenant_id is not distinct from new.tenant_id
       and l.response_time_minutes is null
       and l.created_at is not null;
  exception when others then
    raise warning 'nexus_mark_first_response skipped for %: % (%)',
      new.lead_email, sqlerrm, sqlstate;
  end;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_model_tokens(txt text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce(array(
    select w
      from unnest(string_to_array(regexp_replace(lower(coalesce(txt, '')), '[^a-z0-9]+', ' ', 'g'), ' ')) w
     where length(w) >= 2
       and w !~ '^(19|20)[0-9]{2}$'
       and w not in ('the','and','aed','edition','model','used','new','car','suv','for','sale','with','your','our','this','that','are','was','has','have','you','can','please','hello','thanks')
  ), '{}'::text[]);
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_my_tenant_capabilities()
 RETURNS SETOF nexus_tenant_capability_row
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select r.* from public.nexus_current_tenant_ids() tid
  cross join lateral public.nexus_tenant_capability_core(tid) r
  order by 12, 2;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_my_tenant_config()
 RETURNS SETOF nexus_tenant_config_row
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select r.* from public.nexus_current_tenant_ids() tid
  cross join lateral public.nexus_tenant_config_core(tid) r;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_onboard_dealership(p_slug text, p_name text, p_owner_email text, p_owner_role text DEFAULT 'owner'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid; v_auth uuid; v_staff uuid;
begin
  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'nexus_onboard_dealership: slug is required';
  end if;

  -- tenants.slug is unique GLOBALLY and correctly so: it is the tenant
  -- registry itself, not a tenant-scoped table.
  insert into public.tenants (slug, name, status, is_unattributed_default)
  values (lower(btrim(p_slug)), coalesce(nullif(btrim(p_name),''), p_slug), 'active', false)
  on conflict (slug) do update set name = excluded.name
  returning id into v_tenant;

  select id into v_auth from auth.users where lower(email) = lower(btrim(p_owner_email));
  if v_auth is null then
    raise exception
      'nexus_onboard_dealership: no auth.users row for %. Create the login in Supabase Auth first, then re-run.',
      p_owner_email;
  end if;

  -- Staff directory row, so the rep appears on the team screen and can be
  -- assigned leads. users.email is now unique PER DEALERSHIP
  -- (users_tenant_email_key), so one person can be staff at two dealerships and
  -- holds a separate row at each.
  insert into public.users (name, email, role, status, tenant_id)
  values (split_part(p_owner_email,'@',1), lower(btrim(p_owner_email)), 'manager', 'online', v_tenant)
  on conflict (tenant_id, email) do update set email = excluded.email
  returning id into v_staff;

  insert into public.tenant_members (tenant_id, auth_user_id, role, staff_user_id)
  values (v_tenant, v_auth, coalesce(p_owner_role,'owner'), v_staff)
  on conflict (tenant_id, auth_user_id) do update
    set role = excluded.role, staff_user_id = coalesce(public.tenant_members.staff_user_id, excluded.staff_user_id);

  return v_tenant;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_outcome_class(p_workflow text, p_status text, p_summary text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
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
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_provider_router_invariants()
 RETURNS TABLE(check_id text, state text, finding text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_n integer;
  v_t text;
begin
  ----------------------------------------------------------------------------
  -- R1. The rank table must not acquire an economic column. This is the
  --     mechanical half of the golden rule: a comment can be ignored, a failing
  --     check cannot be, and the shape of the defect (someone adds a cost
  --     column and ranks on it) has a column name.
  ----------------------------------------------------------------------------
  select string_agg(a.attname, ', ' order by a.attname) into v_t
    from pg_attribute a
   where a.attrelid = 'public.channel_provider_rank'::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attname ~* '(cost|price|rate|fee|tariff|charge|cheap|spend|budget)';
  if v_t is null then
    return query select 'R1_NO_COST_COLUMN_ON_RANK'::text, 'PASS'::text,
      'channel_provider_rank carries no economic column. Provider order is not, and must not become, a price order.'::text;
  else
    return query select 'R1_NO_COST_COLUMN_ON_RANK'::text, 'FAIL'::text,
      format('channel_provider_rank has acquired economic column(s): %s. The router selects on registration, policy and capability - never on cost. Using the unofficial transport to dodge the official platform charge is a policy bypass that risks the dealership own number. Remove the column or justify it in writing.', v_t)::text;
  end if;

  ----------------------------------------------------------------------------
  -- R2. The official platform must outrank the unofficial one.
  ----------------------------------------------------------------------------
  select count(*) into v_n
    from public.channel_provider_rank o
   where o.is_official_platform
     and exists (select 1 from public.channel_provider_rank u
                  where not u.is_official_platform and u.rank <= o.rank);
  if v_n = 0 then
    return query select 'R2_OFFICIAL_PLATFORM_FIRST'::text, 'PASS'::text,
      'Every official-platform provider ranks ahead of every unofficial one.'::text;
  else
    return query select 'R2_OFFICIAL_PLATFORM_FIRST'::text, 'FAIL'::text,
      'An unofficial transport now ranks at or ahead of an official platform. That inverts the multi-provider rule and routes business-initiated traffic onto a number the platform does not sanction for it.'::text;
  end if;

  ----------------------------------------------------------------------------
  -- R3. whatsapp_cloud must remain a capability superset of waha. If it stops
  --     being one, the capability filter gains the ability to move a send DOWN
  --     from the official platform to the unofficial one.
  ----------------------------------------------------------------------------
  select string_agg(w.send_form, ', ' order by w.send_form) into v_t
    from public.channel_provider_capability w
   where w.provider = 'waha' and w.support_state = 'SUPPORTED'
     and not exists (select 1 from public.channel_provider_capability c
                      where c.provider = 'whatsapp_cloud' and c.send_form = w.send_form
                        and c.support_state = 'SUPPORTED');
  if v_t is null then
    return query select 'R3_CLOUD_IS_A_SUPERSET_OF_WAHA'::text, 'PASS'::text,
      'Every send form waha can carry, whatsapp_cloud can carry. The capability filter can therefore never move a send from the official platform down to the unofficial one.'::text;
  else
    return query select 'R3_CLOUD_IS_A_SUPERSET_OF_WAHA'::text, 'FAIL'::text,
      format('waha now supports send form(s) whatsapp_cloud does not: %s. nexus_channel_send_candidates filters on capability BEFORE it ranks, so this creates a path where a message lands on the unofficial transport while an official integration sits registered and active. Re-read the comment on channel_provider_capability.', v_t)::text;
  end if;

  ----------------------------------------------------------------------------
  -- R4. Capability completeness. A missing pair fails closed at read time, but
  --     silently; say it out loud.
  ----------------------------------------------------------------------------
  select count(*) into v_n
    from (select p.provider, f.code from public.channel_provider_rank p cross join public.channel_send_form f) x
   where not exists (select 1 from public.channel_provider_capability c
                      where c.provider = x.provider and c.send_form = x.code);
  return query select 'R4_CAPABILITY_MATRIX_COMPLETE'::text,
                      case when v_n = 0 then 'PASS' else 'WARN' end::text,
                      case when v_n = 0
                        then 'Every (provider, send form) pair is stated.'
                        else format('%s (provider, send form) pair(s) are not on file. nexus_channel_capability_state resolves those to NOT_SUPPORTED, so nothing unsafe happens - but a capability that is refused because nobody stated it looks identical to one that is refused on purpose.', v_n)
                      end::text;

  ----------------------------------------------------------------------------
  -- R5. Belt for the ledger CHECK: no SEND ever recorded without a decision.
  ----------------------------------------------------------------------------
  select count(*) into v_n
    from public.channel_send_directive d
   where d.directive = 'SEND'
     and d.policy_decision is distinct from 'FREEFORM_ALLOWED'
     and d.policy_decision is distinct from 'TEMPLATE_REQUIRED';
  return query select 'R5_NO_SEND_WITHOUT_A_POLICY_DECISION'::text,
                      case when v_n = 0 then 'PASS' else 'FAIL' end::text,
                      case when v_n = 0
                        then 'No SEND directive exists without a policy decision behind it. The csd_send_requires_policy_decision constraint makes this structurally true, not merely observed.'
                        else format('%s SEND directive(s) carry no policy decision. This should be impossible - check whether csd_send_requires_policy_decision still exists.', v_n)
                      end::text;

  ----------------------------------------------------------------------------
  -- R6. The router must never have written a provider result onto a refusal.
  ----------------------------------------------------------------------------
  select count(*) into v_n
    from public.channel_send_directive d
   where d.directive = 'DO_NOT_SEND'
     and d.send_result not in ('PENDING','NOT_ATTEMPTED');
  return query select 'R6_A_REFUSAL_NEVER_ACQUIRES_A_RESULT'::text,
                      case when v_n = 0 then 'PASS' else 'FAIL' end::text,
                      case when v_n = 0
                        then 'No refused directive carries a provider result.'
                        else format('%s refused directive(s) carry a provider result, which means something sent a message NEXUS had declined.', v_n)
                      end::text;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_record_channel_event(p_integration_id uuid, p_direction text, p_external_message_id text, p_origin_verified text, p_received_at timestamp with time zone DEFAULT now(), p_customer_external_id text DEFAULT NULL::text, p_customer_phone text DEFAULT NULL::text, p_conversation_id text DEFAULT NULL::text, p_message_kind text DEFAULT 'text'::text, p_media_ref text DEFAULT NULL::text, p_media_mime text DEFAULT NULL::text, p_media_sha256 text DEFAULT NULL::text, p_provider_account_id text DEFAULT NULL::text, p_provider_delivery_ref text DEFAULT NULL::text)
 RETURNS TABLE(event_id uuid, tenant_id uuid, first_seen boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_tenant uuid; v_ctype text; v_cstatus text; v_tstatus text; v_provider text;
  v_dir text := lower(btrim(coalesce(p_direction, '')));
  v_ext text := btrim(coalesce(p_external_message_id, ''));
  v_event uuid; v_new boolean := false;
begin
  if coalesce(current_setting('role', true), '') in ('authenticated', 'anon') then
    raise exception
      'nexus_record_channel_event: refused for end-user role %. Channel events are written by the backend only.',
      current_setting('role', true) using errcode = '42501';
  end if;

  if v_ext = '' then
    raise exception
      'nexus_record_channel_event: external_message_id is required. Do not substitute a per-delivery id (WAHA x-webhook-request-id / body.id) or a generated one -- either makes the idempotency key change per delivery and defeats it.'
      using errcode = '22023';
  end if;

  select cr.tenant_id, cr.channel_type, cr.status, t.status
    into v_tenant, v_ctype, v_cstatus, v_tstatus
    from public.channel_registry cr
    join public.tenants t on t.id = cr.tenant_id
   where cr.integration_id = p_integration_id;

  if v_tenant is null then
    raise exception
      'nexus_record_channel_event: integration % is not in channel_registry. An unregistered channel writes nothing; register it with nexus_register_channel() first.',
      p_integration_id using errcode = '23503';
  end if;

  if v_cstatus <> 'active' or v_tstatus <> 'active' then
    raise exception
      'nexus_record_channel_event: channel status % / dealership status % -- a suspended channel records nothing.',
      v_cstatus, v_tstatus using errcode = '42501';
  end if;

  v_provider := case v_ctype
                  when 'whatsapp_waha_session'           then 'waha'
                  when 'whatsapp_cloud_phone_number_id'  then 'whatsapp_cloud'
                end;
  if v_provider is null then
    raise exception 'nexus_record_channel_event: no provider mapping for channel_type %.', v_ctype
      using errcode = '22023';
  end if;

  -- Cloud API's whole advantage is that Meta signs the raw bytes. Recording a
  -- Cloud event that was not verified would throw that away silently, so it is
  -- refused here as well as in the CHECK constraint.
  if v_provider = 'whatsapp_cloud'
     and coalesce(p_origin_verified, '') <> 'hmac_sha256_x_hub' then
    raise exception
      'nexus_record_channel_event: a whatsapp_cloud event may only be recorded when Meta''s X-Hub-Signature-256 was verified over the raw request bytes; got %.',
      coalesce(nullif(p_origin_verified, ''), '(null)') using errcode = '42501';
  end if;

  insert into public.channel_message_events (
    tenant_id, integration_id, provider, channel_type, direction,
    external_message_id, customer_external_id, customer_phone, conversation_id,
    message_kind, media_ref, media_mime, media_sha256,
    provider_account_id, provider_delivery_ref, origin_verified, received_at)
  values (
    v_tenant, p_integration_id, v_provider, v_ctype, v_dir,
    v_ext, p_customer_external_id, p_customer_phone, p_conversation_id,
    coalesce(nullif(btrim(coalesce(p_message_kind, '')), ''), 'unsupported'),
    p_media_ref, p_media_mime, p_media_sha256,
    p_provider_account_id, p_provider_delivery_ref,
    coalesce(nullif(btrim(coalesce(p_origin_verified, '')), ''), 'unverified'),
    coalesce(p_received_at, now()))
  on conflict on constraint channel_message_events_channel_direction_extmsg_key
  do nothing
  returning public.channel_message_events.event_id into v_event;

  if v_event is not null then
    v_new := true;
  else
    select e.event_id into v_event
      from public.channel_message_events e
     where e.tenant_id           = v_tenant
       and e.integration_id      = p_integration_id
       and e.direction           = v_dir
       and e.external_message_id = v_ext;
  end if;

  return query select v_event, v_tenant, v_new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_record_send_result(p_directive_id uuid, p_result text, p_provider_message_id text DEFAULT NULL::text, p_error_code text DEFAULT NULL::text, p_error_detail text DEFAULT NULL::text)
 RETURNS TABLE(directive_id uuid, send_result text, state text, note text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_row public.channel_send_directive%rowtype;
  v_res text := upper(btrim(coalesce(p_result,'')));
  v_mid text := nullif(btrim(coalesce(p_provider_message_id,'')),'');
begin
  if coalesce(current_setting('role', true), '') in ('authenticated','anon') then
    raise exception 'nexus_record_send_result: refused for end-user role %.',
      current_setting('role', true) using errcode = '42501';
  end if;

  select * into v_row from public.channel_send_directive d where d.directive_id = p_directive_id;
  if not found then
    raise exception 'nexus_record_send_result: directive % does not exist. A result is recorded against a directive this router issued, never against a free-floating id.',
      p_directive_id using errcode = '23503';
  end if;

  if v_res not in ('ACCEPTED_BY_PROVIDER','REJECTED_BY_PROVIDER','TRANSPORT_ERROR','NOT_ATTEMPTED') then
    raise exception 'nexus_record_send_result: % is not a result this ledger records.', coalesce(nullif(v_res,''),'(empty)')
      using errcode = '22023';
  end if;

  if v_row.directive <> 'SEND' and v_res <> 'NOT_ATTEMPTED' then
    raise exception 'nexus_record_send_result: directive % was DO_NOT_SEND (%). A refusal cannot acquire a provider result; if a message went out anyway, that is a workflow defect and must not be laundered through this ledger.',
      p_directive_id, v_row.outcome using errcode = '42501';
  end if;

  if v_row.send_result <> 'PENDING' then
    if v_row.send_result = v_res and coalesce(v_row.provider_message_id,'') = coalesce(v_mid,'') then
      return query select v_row.directive_id, v_row.send_result, 'ALREADY_RECORDED'::text,
        'The same result was already recorded against this directive. This is a retry, and it changed nothing.'::text;
      return;
    end if;
    raise exception 'nexus_record_send_result: directive % already carries result % and is being told %. A conflicting second result is not overwritten - it means two transports acted on one directive, which is exactly the doubled-sender shape already observed on this deployment.',
      p_directive_id, v_row.send_result, v_res using errcode = '55000';
  end if;

  if v_res = 'ACCEPTED_BY_PROVIDER' and v_mid is null then
    raise exception 'nexus_record_send_result: ACCEPTED_BY_PROVIDER requires the provider message id. Without it there is nothing to reconcile a delivery event against, and "accepted" becomes an unfalsifiable claim.'
      using errcode = '22023';
  end if;

  update public.channel_send_directive d
     set send_result           = v_res,
         provider_message_id   = v_mid,
         provider_error_code   = nullif(btrim(coalesce(p_error_code,'')),''),
         provider_error_detail = nullif(btrim(coalesce(p_error_detail,'')),''),
         result_recorded_at    = now()
   where d.directive_id = p_directive_id;

  return query select p_directive_id, v_res, 'RECORDED'::text,
    case v_res
      when 'ACCEPTED_BY_PROVIDER' then 'The provider accepted the message. Accepted is not delivered and is not read; no screen may say otherwise until a delivery feed exists.'
      when 'REJECTED_BY_PROVIDER' then 'The provider refused the message. The error is recorded verbatim; do not retry a policy rejection as if it were a transport failure.'
      when 'TRANSPORT_ERROR'      then 'The call did not complete. Whether the provider saw it is UNKNOWN - not "it was not sent". Re-send only under the same request_ref, so idempotency decides.'
      else 'Recorded as not attempted.'
    end::text;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_register_channel(p_tenant_slug text, p_channel_type text, p_external_identifier text, p_credential_ref text DEFAULT NULL::text, p_status text DEFAULT 'active'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_ident  text := lower(btrim(coalesce(p_external_identifier, '')));
  v_type   text := lower(btrim(coalesce(p_channel_type, '')));
  v_owner  uuid;
  v_id     uuid;
begin
  if v_ident = '' then
    raise exception 'nexus_register_channel: external_identifier is required and must be the '
                    'real session/number the channel receives on. Do not invent one.';
  end if;

  select id into v_tenant
    from public.tenants
   where slug = lower(btrim(coalesce(p_tenant_slug, '')));
  if v_tenant is null then
    raise exception 'nexus_register_channel: no tenant with slug %. Run nexus_onboard_dealership() first.',
                    p_tenant_slug;
  end if;

  select tenant_id into v_owner
    from public.channel_registry
   where channel_type = v_type and external_identifier = v_ident;

  if v_owner is not null and v_owner <> v_tenant then
    raise exception
      'nexus_register_channel: (%, %) is already bound to a different dealership. '
      'Re-pointing a live identifier is refused. Delete the existing row deliberately '
      'if that is really what is intended.', v_type, v_ident;
  end if;

  insert into public.channel_registry
    (tenant_id, channel_type, external_identifier, credential_ref, status)
  values
    (v_tenant, v_type, v_ident, nullif(btrim(coalesce(p_credential_ref,'')),''), coalesce(p_status,'active'))
  on conflict (channel_type, external_identifier) do update
     set credential_ref = excluded.credential_ref,
         status         = excluded.status
  returning integration_id into v_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_request_send(p_tenant_id uuid, p_customer_external_id text, p_intent text, p_send_form text, p_message_body text DEFAULT NULL::text, p_template_ref text DEFAULT NULL::text, p_template_variables jsonb DEFAULT NULL::jsonb, p_media_ref text DEFAULT NULL::text, p_media_mime text DEFAULT NULL::text, p_requested_by text DEFAULT NULL::text, p_request_ref text DEFAULT NULL::text, p_as_of timestamp with time zone DEFAULT now(), p_max_template_status_age interval DEFAULT NULL::interval)
 RETURNS TABLE(directive_id uuid, ledger_state text, result nexus_send_directive_row)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_ref  text := nullif(btrim(coalesce(p_request_ref,'')),'');
  v_by   text := coalesce(nullif(btrim(coalesce(p_requested_by,'')),''), '(unattributed caller)');
  v_prev public.channel_send_directive%rowtype;
  r      public.nexus_send_directive_row;
  v_id   uuid;
begin
  if coalesce(current_setting('role', true), '') in ('authenticated','anon') then
    raise exception
      'nexus_request_send: refused for end-user role %. Outbound sends are a backend path.',
      current_setting('role', true) using errcode = '42501';
  end if;

  -- A send with no request_ref is a send NEXUS cannot deduplicate. On a deployment
  -- already observed delivering the same inbound message twice, silently unkeyed is
  -- worse than a refusal: the caller learns nothing and the customer gets two
  -- messages. Refuse, and say what to pass.
  if v_ref is null then
    raise exception using errcode = '22023',
      message = 'A send request must carry a request_ref. Without one this router cannot tell a retry from a second message.',
      detail  = 'NEXUS_SEND_REQUEST_REF_REQUIRED',
      hint    = 'Pass a ref that is stable across retries of the same logical send and unique across different ones -- the inbound message id, the workflow execution id plus a step name, or a deal/action id. Do not pass a UUID generated at call time: that is a new ref on every retry and is the same as passing none.';
  end if;

  -- Idempotency. n8n retries; a retried send request must not become a second
  -- customer message, and must not re-route (the window may have moved under it).
  -- The key is the business event: (dealership, request_ref). Who asked is recorded
  -- on the row but is not part of its identity -- an actor never is.
  select * into v_prev
    from public.channel_send_directive d
   where d.tenant_id = p_tenant_id and d.request_ref = v_ref;

  if not found then
    select * into r
      from public.nexus_route_message(p_tenant_id, p_customer_external_id, p_intent, p_send_form,
                                      p_message_body, p_template_ref, p_template_variables,
                                      p_media_ref, p_media_mime, v_by, p_as_of,
                                      p_max_template_status_age);

    -- A dealership that does not resolve has no tenant_id to file a row under,
    -- and NEXUS does not file tenant-scoped rows under a guessed dealership.
    if r.tenant_id is null or r.tenant_slug is null then
      return query select null::uuid, 'NOT_RECORDED_TENANT_UNRESOLVED'::text, r;
      return;
    end if;

    begin
      insert into public.channel_send_directive (
        tenant_id, tenant_slug, requested_by, request_ref, customer_external_id, intent,
        requested_send_form, directive, outcome, reason_code, reason, what_would_change_it,
        integration_id, provider, channel_type, external_identifier, credential_ref,
        carrier_rule, candidates_considered, resolved_send_form, message_body,
        template_ref, template_variables, template_category_required,
        template_verification, template_verification_detail, media_ref, media_mime,
        policy_decision, policy_reason_code, policy_reason, policy_what_would_change_it,
        policy_applied_rule_id, policy_rule_verification_status, policy_window_state,
        policy_window_expires_at, policy_evaluated_at,
        capability_state, capability_basis, capability_evidence,
        whatsapp_capability_state, whatsapp_capability_note,
        routed_at, routed_by,
        send_result)
      values (
        r.tenant_id, r.tenant_slug, r.requested_by, v_ref, r.customer_external_id, r.intent,
        r.requested_send_form, r.directive, r.outcome, r.reason_code, r.reason, r.what_would_change_it,
        r.integration_id, r.provider, r.channel_type, r.external_identifier, r.credential_ref,
        r.carrier_rule, r.candidates_considered, r.resolved_send_form, r.message_body,
        r.template_ref, r.template_variables, r.template_category_required,
        r.template_verification, r.template_verification_detail, r.media_ref, r.media_mime,
        r.policy_decision, r.policy_reason_code, r.policy_reason, r.policy_what_would_change_it,
        r.policy_applied_rule_id, r.policy_rule_verification_status, r.policy_window_state,
        r.policy_window_expires_at, r.policy_evaluated_at,
        r.capability_state, r.capability_basis, r.capability_evidence,
        r.whatsapp_capability_state, r.whatsapp_capability_note,
        r.routed_at, r.routed_by,
        case when r.directive = 'SEND' then 'PENDING' else 'NOT_ATTEMPTED' end)
      returning public.channel_send_directive.directive_id into v_id;

      return query select v_id,
                          case when r.directive = 'SEND' then 'RECORDED_AWAITING_TRANSPORT'
                               else 'RECORDED_REFUSAL' end::text,
                          r;
      return;
    exception when unique_violation then
      -- A concurrent backend filed this same request_ref between our lookup and our
      -- insert. That is the race the key exists to lose safely: fall through and
      -- return their directive rather than raising at a caller who did nothing wrong.
      select * into v_prev
        from public.channel_send_directive d
       where d.tenant_id = p_tenant_id and d.request_ref = v_ref;
    end;
  end if;

  -- A ref already spent on a different customer is a caller defect, not a retry.
  -- Returning the first directive would answer a question nobody asked; sending
  -- would put one customer's message in front of another.
  if v_prev.customer_external_id is distinct from p_customer_external_id then
    raise exception using errcode = '55000',
      message = format('request_ref %L is already recorded against customer %L on this dealership and is now being offered for %L. A request_ref names one send; reusing it for another is not a retry.',
                       v_ref, v_prev.customer_external_id, p_customer_external_id),
      detail  = 'NEXUS_REQUEST_REF_REUSED_FOR_A_DIFFERENT_CUSTOMER',
      hint    = 'Use a ref derived from the thing being sent about -- the inbound message id, or the action id -- so that two different sends can never collide on it.';
  end if;

  r.directive := v_prev.directive;                     r.outcome := v_prev.outcome;
  r.reason_code := v_prev.reason_code;                 r.reason := v_prev.reason;
  r.what_would_change_it := v_prev.what_would_change_it;
  r.tenant_id := v_prev.tenant_id;                     r.tenant_slug := v_prev.tenant_slug;
  r.customer_external_id := v_prev.customer_external_id;
  r.intent := v_prev.intent;                           r.requested_send_form := v_prev.requested_send_form;
  r.integration_id := v_prev.integration_id;           r.provider := v_prev.provider;
  r.channel_type := v_prev.channel_type;               r.external_identifier := v_prev.external_identifier;
  r.credential_ref := v_prev.credential_ref;           r.carrier_rule := v_prev.carrier_rule;
  r.candidates_considered := v_prev.candidates_considered;
  r.resolved_send_form := v_prev.resolved_send_form;   r.message_body := v_prev.message_body;
  r.template_ref := v_prev.template_ref;               r.template_variables := v_prev.template_variables;
  r.template_category_required := v_prev.template_category_required;
  r.template_verification := v_prev.template_verification;
  r.template_verification_detail := v_prev.template_verification_detail;
  r.media_ref := v_prev.media_ref;                     r.media_mime := v_prev.media_mime;
  r.policy_decision := v_prev.policy_decision;         r.policy_reason_code := v_prev.policy_reason_code;
  r.policy_reason := v_prev.policy_reason;
  r.policy_what_would_change_it := v_prev.policy_what_would_change_it;
  r.policy_applied_rule_id := v_prev.policy_applied_rule_id;
  r.policy_rule_verification_status := v_prev.policy_rule_verification_status;
  r.policy_window_state := v_prev.policy_window_state;
  r.policy_window_expires_at := v_prev.policy_window_expires_at;
  r.policy_evaluated_at := v_prev.policy_evaluated_at;
  r.capability_state := v_prev.capability_state;       r.capability_basis := v_prev.capability_basis;
  r.capability_evidence := v_prev.capability_evidence;
  r.whatsapp_capability_state := v_prev.whatsapp_capability_state;
  r.whatsapp_capability_note := v_prev.whatsapp_capability_note;
  r.requested_by := v_prev.requested_by;               r.routed_at := v_prev.routed_at;
  r.routed_by := v_prev.routed_by;

  return query select v_prev.directive_id,
                      'ALREADY_ROUTED_UNDER_THIS_REQUEST_REF'::text,
                      r;
  return;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_require_security_invoker_views()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  r      record;
  v_opt  text;
  v_val  text;
  v_bad  text[] := '{}';
BEGIN
  IF lower(coalesce(current_setting('nexus.allow_insecure_view', true), 'off'))
     IN ('on','true','yes','1') THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT DISTINCT ddl.objid, ddl.object_identity
      FROM pg_catalog.pg_event_trigger_ddl_commands() ddl
     WHERE ddl.object_type = 'view'
       AND ddl.schema_name = 'public'
  LOOP
    SELECT o
      INTO v_opt
      FROM pg_catalog.unnest(
             coalesce((SELECT c.reloptions
                         FROM pg_catalog.pg_class c
                        WHERE c.oid = r.objid), '{}'::text[])
           ) AS o
     WHERE o LIKE 'security_invoker=%'
     LIMIT 1;

    -- Accept every truthy spelling Postgres accepts for a boolean reloption.
    -- Both `security_invoker=on` and `security_invoker=true` are in use here.
    v_val := lower(btrim(coalesce(split_part(v_opt, '=', 2), '')));

    IF v_val NOT IN ('on','true','yes','1')
       AND NOT (v_bad @> ARRAY[r.object_identity]) THEN
      v_bad := v_bad || r.object_identity;
    END IF;
  END LOOP;

  IF array_length(v_bad, 1) > 0 THEN
    RAISE EXCEPTION
      'NEXUS SECURITY GATE: view(s) % in schema public lack security_invoker',
      array_to_string(v_bad, ', ')
      USING ERRCODE = '42501',
            DETAIL  = 'Without security_invoker, RLS is evaluated as the view owner (postgres, BYPASSRLS), not the caller. Such a view exposes every underlying row to the public anon key.',
            HINT    = 'Recreate the view WITH (security_invoker = on). CREATE OR REPLACE VIEW resets reloptions to NULL, so the option must be restated on every replace.';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_resolve_channel_tenant(p_channel_type text, p_external_identifier text)
 RETURNS TABLE(tenant_id uuid, tenant_slug text, integration_id uuid, channel_type text, external_identifier text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select cr.tenant_id,
         t.slug,
         cr.integration_id,
         cr.channel_type,
         cr.external_identifier
    from public.channel_registry cr
    join public.tenants t on t.id = cr.tenant_id
   where cr.channel_type        = lower(btrim(coalesce(p_channel_type, '')))
     and cr.external_identifier = lower(btrim(coalesce(p_external_identifier, '')))
     -- REQUIREMENT 4: a suspended channel resolves to nothing.
     and cr.status = 'active'
     -- A suspended DEALERSHIP resolves to nothing either, so a single
     -- tenants.status change takes every one of its channels off the air.
     and t.status  = 'active'
     -- REQUIREMENT 2, second half. Same guard, same wording, as the fallback
     -- clause a sibling agent just added to nexus_default_tenant_id() and
     -- nexus_scoped_tenant_id() on 3 Sep: a signed-in end user is never handed
     -- a tenant by a backend resolver. Here it is defence in depth rather than
     -- the primary lock — EXECUTE is revoked from anon and authenticated in
     -- chanreg_03 — because CLAUDE.md's own history is that a later
     -- CREATE OR REPLACE or a platform default-privilege can re-open a grant
     -- with no grant-shaped diff to review. If that happens, this predicate
     -- still returns zero rows.
     and coalesce(current_setting('role', true), '') not in ('authenticated', 'anon')
   limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_resolve_tenant_capability(p_tenant_id uuid, p_capability_key text)
 RETURNS SETOF nexus_tenant_capability_row
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select * from public.nexus_tenant_capability_core(p_tenant_id)
   where capability_key = upper(btrim(coalesce(p_capability_key, '')))
     and coalesce(current_setting('role', true), '') not in ('authenticated', 'anon');
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_resolve_tenant_config(p_tenant_id uuid)
 RETURNS SETOF nexus_tenant_config_row
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select * from public.nexus_tenant_config_core(p_tenant_id)
   where coalesce(current_setting('role', true), '') not in ('authenticated', 'anon');
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_route_message(p_tenant_id uuid, p_customer_external_id text, p_intent text, p_send_form text, p_message_body text DEFAULT NULL::text, p_template_ref text DEFAULT NULL::text, p_template_variables jsonb DEFAULT NULL::jsonb, p_media_ref text DEFAULT NULL::text, p_media_mime text DEFAULT NULL::text, p_requested_by text DEFAULT NULL::text, p_as_of timestamp with time zone DEFAULT now(), p_max_template_status_age interval DEFAULT NULL::interval)
 RETURNS SETOF nexus_send_directive_row
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_now       timestamptz := coalesce(p_as_of, now());
  v_cust      text := lower(btrim(coalesce(p_customer_external_id,'')));
  v_form      text := upper(btrim(coalesce(p_send_form,'')));
  v_intent    text := upper(btrim(coalesce(p_intent,'')));
  v_by        text := coalesce(nullif(btrim(coalesce(p_requested_by,'')),''), '(unattributed caller)');
  v_slug      text;
  v_formrec   record;
  v_pick      record;
  v_pol       record;
  v_tv        record;
  v_cap       record;
  v_eligible  integer := 0;
  v_total     integer := 0;
  v_tmplcap   text;
  r           public.nexus_send_directive_row;
begin
  if coalesce(current_setting('role', true), '') in ('authenticated','anon') then
    raise exception
      'nexus_route_message: refused for end-user role %. Outbound routing is a backend path.',
      current_setting('role', true) using errcode = '42501';
  end if;

  r.directive             := 'DO_NOT_SEND';
  r.tenant_id             := p_tenant_id;
  r.customer_external_id  := v_cust;
  r.intent                := v_intent;
  r.requested_send_form   := v_form;
  r.message_body          := p_message_body;
  r.template_ref          := nullif(btrim(coalesce(p_template_ref,'')),'');
  r.template_variables    := p_template_variables;
  r.media_ref             := p_media_ref;
  r.media_mime            := p_media_mime;
  r.candidates_considered := '[]'::jsonb;
  r.requested_by          := v_by;
  r.routed_at             := v_now;
  r.routed_by             := 'nexus_route_message v3 - template staleness gate wired';

  select t.slug into v_slug
    from public.tenants t
   where t.id = p_tenant_id and t.status = 'active';

  if not found then
    r.outcome := 'TENANT_UNRESOLVED'; r.reason_code := 'TENANT_UNRESOLVED';
    r.reason  := 'No active dealership resolves from the tenant supplied, so there is nobody on whose behalf this message could be sent.';
    r.what_would_change_it := 'Pass the id of an active row in public.tenants. An unresolved tenant is refused, never defaulted - a caller that can pick the dealership can pick whose customers get messaged.';
    return next r; return;
  end if;
  r.tenant_slug := v_slug;

  if v_cust = '' then
    r.outcome := 'CUSTOMER_IDENTITY_MISSING'; r.reason_code := 'CUSTOMER_IDENTITY_MISSING';
    r.reason  := 'No customer identity was supplied, so there is no conversation to send into.';
    r.what_would_change_it := 'Supply the customer identity exactly as the platform reports it (the wa id / chat id), not a display name and not a local phone format.';
    return next r; return;
  end if;

  select * into v_formrec from public.channel_send_form f where f.code = v_form;
  if not found then
    r.outcome := 'SEND_FORM_UNKNOWN'; r.reason_code := 'SEND_FORM_UNKNOWN';
    r.reason  := format('%L is not a send form NEXUS recognises, so no provider capability can be established for it.',
                        coalesce(nullif(v_form,''),'(empty)'));
    r.what_would_change_it := 'Call again with one of the codes in public.channel_send_form. An unknown shape is refused rather than attempted, because "try it and see" against a live customer number is how an account gets rate-limited.';
    return next r; return;
  end if;
  r.template_category_required := null;

  select c.state, c.absent_means into v_cap
    from public.nexus_resolve_tenant_capability(p_tenant_id, 'WHATSAPP_OUTBOUND') c;
  r.whatsapp_capability_state := coalesce(v_cap.state, 'NOT_AVAILABLE');
  r.whatsapp_capability_note  := case
    when coalesce(v_cap.state,'NOT_AVAILABLE') = 'AVAILABLE' then null
    else 'REPORTED, NOT ENFORCED: tenant_capability says WHATSAPP_OUTBOUND is '
         || coalesce(v_cap.state,'NOT_AVAILABLE')
         || ' for this dealership, while channel_registry holds an active channel. The registry is an audited operational fact and governs routing; the capability row is a product-surface statement and is currently unpopulated for every capability on this deployment. Someone should state it. Until they do, an unpopulated table is "nobody has said", not "it is forbidden".'
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'integration_id',           c.integration_id,
           'provider',                 c.provider,
           'channel_type',             c.channel_type,
           'external_identifier',      c.external_identifier,
           'provider_rank',            c.provider_rank,
           'is_official_platform',     c.is_official_platform,
           'capability',               c.support_state,
           'capability_basis',         c.capability_basis,
           'last_customer_message_at', c.last_customer_message_at,
           'eligible',                 c.eligible,
           'selection_order',          c.selection_order,
           'chosen',                   coalesce(c.eligible and c.selection_order = 1, false),
           'excluded_because',         c.excluded_because)
         order by c.eligible desc, c.selection_order nulls last, c.registered_at), '[]'::jsonb),
         count(*)::int,
         count(*) filter (where c.eligible)::int
    into r.candidates_considered, v_total, v_eligible
    from public.nexus_channel_send_candidates(p_tenant_id, v_form, v_cust) c;

  if v_total = 0 then
    r.outcome := 'NO_ACTIVE_INTEGRATION'; r.reason_code := 'NO_ACTIVE_INTEGRATION';
    r.reason  := format('%s has no active messaging integration registered, so there is no number this message could leave from. This is a clear refusal, not a failure.', v_slug);
    r.what_would_change_it := 'Register the dealership WhatsApp identity with public.nexus_register_channel(tenant_slug, channel_type, external_identifier, credential_ref, active). Until then no WhatsApp action should be offered to this dealership at all - which is exactly what tenant_capability_catalogue says WHATSAPP_OUTBOUND absent means.';
    return next r; return;
  end if;

  if v_eligible = 0 then
    r.outcome := 'PROVIDER_CANNOT_CARRY'; r.reason_code := 'PROVIDER_CANNOT_CARRY';
    r.reason  := format('%s has %s active integration(s), and none of them can carry a %s send. candidates_considered names each one and why. Note in particular that a WhatsApp message template is a WABA object and does not exist behind an unofficial transport - so a template request on a WAHA-only dealership lands here by design.',
                        v_slug, v_total, v_form);
    r.what_would_change_it := 'Either send a shape the registered provider can carry, or register an integration that can. For templates that means the official WhatsApp Cloud API. Pasting the template text into a free-form message on the unofficial transport is not the workaround; it is the bypass, and it is what gets the dealership own number banned.';
    return next r; return;
  end if;

  select * into v_pick
    from public.nexus_channel_send_candidates(p_tenant_id, v_form, v_cust) c
   where c.eligible and c.selection_order = 1;

  -- chanroute_09. If eligibility said there was a carrier and selection did not
  -- produce one, that is an internal inconsistency, and it is refused here
  -- rather than passed to the policy engine as a NULL integration.
  if not found or v_pick.integration_id is null then
    r.outcome := 'CARRIER_SELECTION_FAILED'; r.reason_code := 'CARRIER_SELECTION_FAILED';
    r.reason  := format('%s of %s active integrations were capable of a %s send, but the carrier order produced none. This is a NEXUS defect, not a dealership configuration problem, and nothing is sent while it stands.',
                        v_eligible, v_total, v_form);
    r.what_would_change_it := 'Nothing the dealership can do. Read candidates_considered and nexus_channel_send_candidates; the selection_order window is the place to look.';
    return next r; return;
  end if;

  r.integration_id       := v_pick.integration_id;
  r.provider             := v_pick.provider;
  r.channel_type         := v_pick.channel_type;
  r.external_identifier  := v_pick.external_identifier;
  r.credential_ref       := v_pick.credential_ref;
  r.capability_state     := v_pick.support_state;
  r.capability_basis     := v_pick.capability_basis;
  r.capability_evidence  := v_pick.capability_evidence;

  r.carrier_rule := case
    when v_pick.last_customer_message_at is not null then
      format('C1 conversation continuity. The customer last messaged this dealership on this integration (%s / %s) at %s, so the message leaves from the number they wrote to. %s',
             v_pick.provider, v_pick.external_identifier,
             to_char(v_pick.last_customer_message_at at time zone 'Asia/Dubai','DD Mon YYYY HH24:MI') || ' Asia/Dubai',
             case when v_eligible > 1 then format('%s capable integrations were available.', v_eligible)
                  else 'It was also the only capable integration.' end)
    when v_eligible > 1 then
      format('C2 official platform first. %s capable integrations were available and %s (rank %s, official platform: %s) was selected. This ordering is not economic: the official platform is the one that charges, and it is still first.',
             v_eligible, v_pick.provider, coalesce(v_pick.provider_rank::text,'unranked'),
             case when v_pick.is_official_platform then 'yes' else 'no' end)
    else
      format('Only one active integration (%s / %s) can carry this send form, so there was nothing to choose between. %s',
             v_pick.provider, v_pick.external_identifier,
             case when v_total > v_eligible
                  then format('%s other active integration(s) could not carry it; candidates_considered says why.', v_total - v_eligible)
                  else '' end)
  end;

  select * into v_pol
    from public.whatsapp_policy_decision(p_tenant_id, v_pick.integration_id, v_cust, v_intent, v_now);

  r.policy_decision                 := v_pol.decision;
  r.policy_reason_code              := v_pol.reason_code;
  r.policy_reason                   := v_pol.reason;
  r.policy_what_would_change_it     := v_pol.what_would_change_it;
  r.policy_applied_rule_id          := v_pol.applied_rule_id;
  r.policy_rule_verification_status := v_pol.applied_rule_verification_status;
  r.policy_window_state             := v_pol.window_state;
  r.policy_window_expires_at        := v_pol.window_expires_at;
  r.policy_evaluated_at             := v_pol.evaluated_at;
  r.template_category_required      := v_pol.template_category_if_required;

  select k.support_state into v_tmplcap
    from public.nexus_channel_capability_state(v_pick.provider, 'TEMPLATE_TEXT') k;

  if v_pol.decision = 'BLOCKED' then
    r.outcome := 'BLOCKED'; r.reason_code := v_pol.reason_code;
    r.reason  := v_pol.reason;
    r.what_would_change_it := v_pol.what_would_change_it;
    return next r; return;

  elsif v_pol.decision not in ('FREEFORM_ALLOWED','TEMPLATE_REQUIRED') then
    r.outcome := 'POLICY_DECISION_UNRECOGNISED'; r.reason_code := 'POLICY_DECISION_UNRECOGNISED';
    r.reason  := format('The policy engine returned %L, which this router does not recognise. It refuses rather than guessing which side of the line an unknown verdict falls on.',
                        coalesce(v_pol.decision,'(null)'));
    r.what_would_change_it := 'Whoever added a decision value to whatsapp_policy_decision must also teach nexus_route_message what it means. Failing closed here is deliberate.';
    return next r; return;
  end if;

  if v_pol.decision = 'TEMPLATE_REQUIRED' and not v_formrec.requires_template_ref then
    r.outcome := 'TEMPLATE_REQUIRED'; r.reason_code := v_pol.reason_code;
    r.reason  := v_pol.reason;
    r.what_would_change_it := v_pol.what_would_change_it
      || case when v_tmplcap = 'SUPPORTED'
              then format(' To send now, come back with send_form TEMPLATE_TEXT (or TEMPLATE_MEDIA_HEADER), a staleness tolerance, and an approved template of category %s.',
                          coalesce(v_pol.template_category_if_required,'UTILITY'))
              else format(' Note that the selected carrier (%s) cannot send templates at all, so on this integration there is no template to come back with: either the customer messages again and reopens the window, or the dealership registers an official WhatsApp Cloud API integration. Pasting template text into a free-form message here is the bypass, not the answer.',
                          v_pick.provider)
         end;
    return next r; return;
  end if;

  if v_formrec.requires_template_ref and r.template_ref is null then
    r.outcome := 'TEMPLATE_REF_MISSING'; r.reason_code := 'TEMPLATE_REF_MISSING';
    r.reason  := format('Send form %s is a template send and no template reference was supplied. NEXUS will not compose a body and call it a template.', v_form);
    r.what_would_change_it := format('Supply the name of a template approved on this dealership account, of category %s.',
                                     coalesce(v_pol.template_category_if_required,'UTILITY'));
    return next r; return;
  end if;

  if v_formrec.is_media and coalesce(btrim(coalesce(p_media_ref,'')),'') = '' then
    r.outcome := 'MEDIA_REF_MISSING'; r.reason_code := 'MEDIA_REF_MISSING';
    r.reason  := format('Send form %s carries media and no media reference was supplied.', v_form);
    r.what_would_change_it := 'Supply media_ref as a reference the sending workflow can resolve - a provider media id or an https URL. A data: URI is refused elsewhere in this schema and should not be sent here either.';
    return next r; return;
  end if;

  if not v_formrec.requires_template_ref and coalesce(btrim(coalesce(p_message_body,'')),'') = ''
     and not v_formrec.is_media then
    r.outcome := 'MESSAGE_BODY_MISSING'; r.reason_code := 'MESSAGE_BODY_MISSING';
    r.reason  := format('Send form %s carries a composed body and none was supplied.', v_form);
    r.what_would_change_it := 'Supply message_body. An empty body is refused rather than sent as an empty message.';
    return next r; return;
  end if;

  r.resolved_send_form := v_form;

  ------------------------------------------------------------------
  -- The template gate. directive stays DO_NOT_SEND until it passes.
  ------------------------------------------------------------------
  if v_formrec.requires_template_ref then
    r.message_body := null;

    -- Refuse for want of a tolerance rather than choosing one. The number is a
    -- statement about how much risk of sending on a withdrawn approval the
    -- caller accepts, and NEXUS is not the party that carries that risk.
    if p_max_template_status_age is null then
      r.outcome := 'TEMPLATE_NOT_SENDABLE';
      r.reason_code := 'STALENESS_TOLERANCE_NOT_STATED';
      r.template_verification := 'REFUSED_NO_TOLERANCE_STATED';
      r.template_verification_detail :=
        'No p_max_template_status_age was passed, so NEXUS has no answer to "how recently must the provider have confirmed this template?".';
      r.reason := 'A template send was requested without saying how old a provider approval the caller will rely on. NEXUS refuses rather than picking that number: an approval it has not re-checked recently enough is exactly how a template that Meta has since rejected or paused gets sent anyway.';
      r.what_would_change_it := 'Call again with p_max_template_status_age, for example ''24 hours''::interval or ''7 days''::interval. The tolerance is recorded with the routing decision so a later reader can see what was relied on.';
      return next r; return;
    end if;

    select * into v_tv
      from public.nexus_verify_template_ref(p_tenant_id, v_pick.provider, r.template_ref,
                                            coalesce(v_pol.template_category_if_required,'UTILITY'),
                                            p_max_template_status_age) v;

    r.template_verification := v_tv.verification;
    r.template_verification_detail := format('%s Tolerance stated: %s. Provider status: %s, observed %s (%s old).',
        v_tv.detail, p_max_template_status_age::text,
        coalesce(v_tv.provider_status,'unknown'),
        coalesce(v_tv.provider_status_observed_at::text,'never'),
        coalesce(v_tv.status_age::text,'not applicable'));

    if not v_tv.sendable then
      r.outcome     := 'TEMPLATE_NOT_SENDABLE';
      r.reason_code := v_tv.verification;
      r.reason      := v_tv.detail;
      r.what_would_change_it := coalesce(v_tv.what_would_change_it,
        'Re-observe the template''s status with the provider, or send a template NEXUS can vouch for.');
      return next r; return;
    end if;

    r.directive   := 'SEND';
    r.outcome     := 'SENDABLE_TEMPLATE';
    r.reason_code := v_pol.reason_code;
    r.reason      := format('Template send permitted on %s / %s. %s The template was checked: %s',
                            v_pick.provider, v_pick.external_identifier, v_pol.reason, v_tv.detail);
    r.what_would_change_it := format('A recorded opt-out makes this BLOCKED immediately, and the template''s approval goes stale against the stated tolerance of %s.',
                                     p_max_template_status_age::text);
  else
    r.directive   := 'SEND';
    r.outcome     := 'SENDABLE_FREEFORM';
    r.reason_code := v_pol.reason_code;
    r.reason      := format('Free-form send permitted on %s / %s. %s',
                            v_pick.provider, v_pick.external_identifier, v_pol.reason);
    r.what_would_change_it := v_pol.what_would_change_it;
  end if;

  return next r;
  return;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_scoped_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select coalesce(
    public.nexus_current_tenant_id(),
    (select t.id from public.tenants t
      where t.is_unattributed_default
        and t.status = 'active'
        -- Same guard as nexus_default_tenant_id(); keep the two in step.
        and coalesce(current_setting('role', true), '') not in ('authenticated', 'anon')
        -- Pre-existing guard, unchanged: silent rather than wrong at 2 tenants.
        and (select count(*) from public.tenants w where w.status = 'active') = 1));
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_tenancy_readiness()
 RETURNS TABLE(severity text, item text, detail text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with nat(tbl, col, pinned_by) as (
    -- WHICH columns are natural business keys is a judgement, declared here and
    -- maintained by hand. WHETHER each is still globally unique is a fact, read
    -- from pg_index at call time, so this gate cannot go stale.
    -- `pinned_by` names the deployed workflow that hardcodes `?on_conflict=<col>`;
    -- Postgres cannot infer a UNIQUE(tenant_id, col) index from ON CONFLICT (col),
    -- so those keys cannot be swapped until the workflow changes.
    values
      ('leads','email',
       'Master Router -> "Persist Lead (deterministic)" posts ?on_conflict=email. '
       'Change it to ?on_conflict=tenant_id,email; the index it needs '
       '(leads_tenant_email_key) already exists.'),
      ('customer_360_profiles','customer_id',
       'Customer 360 -> "Supabase - Upsert Profile" posts ?on_conflict=customer_id. '
       'Change it to ?on_conflict=tenant_id,customer_id; '
       'customer_360_profiles_tenant_customer_id_key already exists.'),
      ('deals_embeddings','deal_id',
       'Closed-Won Sync -> "Supabase (Postgres) - Upsert Vector" posts '
       '?on_conflict=deal_id. Change it to ?on_conflict=tenant_id,deal_id; '
       'deals_embeddings_tenant_deal_id_key already exists.'),
      ('users','email', null),
      ('inventory','id', null),
      ('whatsapp_contacts','chat_id', null),
      ('processed_messages','message_id', null),
      ('purchase_history','deal_id', null)
  ),
  still_global as (
    select n.tbl, n.col, n.pinned_by, i.relname as idx
    from nat n
    join pg_class c  on c.relname = n.tbl and c.relnamespace = 'public'::regnamespace
    join pg_index ix on ix.indrelid = c.oid and ix.indisunique
    join pg_class i  on i.oid = ix.indexrelid
    where ix.indnkeyatts = 1
      and (select a.attname from pg_attribute a
            where a.attrelid = c.oid and a.attnum = ix.indkey[0]) = n.col
  ),
  scoped as (
    select n.tbl, n.col, i.relname as idx
    from nat n
    join pg_class c  on c.relname = n.tbl and c.relnamespace = 'public'::regnamespace
    join pg_index ix on ix.indrelid = c.oid and ix.indisunique
    join pg_class i  on i.oid = ix.indexrelid
    where ix.indnkeyatts = 2
      and (select a.attname from pg_attribute a
            where a.attrelid = c.oid and a.attnum = ix.indkey[0]) = 'tenant_id'
      and (select a.attname from pg_attribute a
            where a.attrelid = c.oid and a.attnum = ix.indkey[1]) = n.col
  ),
  -- Base tables only. relkind='r' excludes views, whose columns
  -- information_schema always reports as nullable.
  tcols as (
    select c.oid as reloid, c.relname as tbl, a.attnotnull,
           pg_get_expr(d.adbin, d.adrelid) as col_default
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
     where c.relnamespace = 'public'::regnamespace
       and c.relkind = 'r'
       and a.attname = 'tenant_id'
       and a.attnum > 0
       and not a.attisdropped
  ),
  -- Every claim below about a nullable tenant_id is read from the catalogue at
  -- call time, because the hand-written version of this text asserted the
  -- opposite of the catalogue on all three counts.
  nullable_facts as (
    select t.tbl,
           t.col_default,
           -- Does an RLS SELECT policy deliberately admit NULL for signed-in users?
           -- If it does, a NULL row means "platform-wide", not "orphaned".
           exists (
             select 1 from pg_policy p
              where p.polrelid = t.reloid
                and p.polpermissive
                and p.polcmd in ('r','*')
                and (p.polroles = '{0}'::oid[]
                     or 'authenticated'::regrole::oid = any(p.polroles))
                and pg_get_expr(p.polqual, p.polrelid) like '%tenant_id IS NULL%'
           ) as null_rows_visible,
           -- Uniqueness that actually covers the NULL-tenant rows, if any.
           (select string_agg(i.relname, ', ' order by i.relname)
              from pg_index ix
              join pg_class i on i.oid = ix.indexrelid
             where ix.indrelid = t.reloid
               and ix.indisunique
               and pg_get_expr(ix.indpred, ix.indrelid) = '(tenant_id IS NULL)'
           ) as null_uq
      from tcols t
     where not t.attnotnull
  )

  select 'BLOCKER', 'n8n writes are not tenant-aware',
         'Every n8n workflow writes as service_role, which has no auth.uid(). '
         'Those rows are attributed by the tenants.is_unattributed_default flag, '
         'currently held by: ' ||
         coalesce((select name from tenants where is_unattributed_default), '(nobody)') ||
         '. Until n8n sends tenant_id explicitly, a second dealership''s inbound '
         'traffic would be filed under that tenant. This is not fixable in the database.'
  where exists (select 1 from tenants where is_unattributed_default)

  union all
  select 'BLOCKER',
         sg.tbl || '.' || sg.col || ' is globally unique',
         'Index ' || sg.idx || ' is UNIQUE(' || sg.col || ') across all tenants, so two '
         'dealerships sharing this value collide — and where the write is an upsert, '
         'one dealership UPDATES the other''s row. ' || sg.pinned_by
    from still_global sg where sg.pinned_by is not null

  union all
  select 'WARN',
         sg.tbl || '.' || sg.col || ' is globally unique',
         'Index ' || sg.idx || ' is UNIQUE(' || sg.col || ') across all tenants. No '
         'deployed workflow pins it as an ON CONFLICT target, so it can be swapped '
         'for UNIQUE(tenant_id, ' || sg.col || ') without coordinating a workflow change.'
    from still_global sg where sg.pinned_by is null

  union all
  -- Scoped means scoped AND nothing global left standing on the same column.
  select 'INFO', 'natural keys correctly scoped per dealership',
         string_agg(s.tbl || '.' || s.col, ', ' order by s.tbl, s.col)
    from scoped s
   where not exists (select 1 from still_global g where g.tbl = s.tbl and g.col = s.col)
  having count(*) > 0

  union all
  -- Case 1: nullable AND defaulted. A write that omits tenant_id is silently
  -- filed under whoever holds is_unattributed_default. This is the failure the
  -- old WARN described; it just never actually applied to any table.
  select 'BLOCKER',
         'tenant_id is nullable AND defaulted on ' || nf.tbl,
         'public.' || nf.tbl || '.tenant_id is NULLABLE and carries the column default '
         || nf.col_default || '. A write that omits tenant_id is filed under whichever '
         'dealership holds tenants.is_unattributed_default, with no error raised and no '
         'grant-shaped or policy-shaped diff to review. Either make the column NOT NULL '
         'or drop the default and require the caller to be explicit.'
    from nullable_facts nf
   where nf.col_default is not null

  union all
  -- Case 2: nullable, NO default, and RLS deliberately admits NULL for signed-in
  -- users. NULL here means platform-wide, and such a row is READABLE BY EVERY
  -- dealership on purpose. Not a defect; still a thing to check before onboarding
  -- a second dealership, because nothing stops a tenant-specific row being written
  -- with a NULL and disclosed to all of them.
  select 'WARN',
         'tenant_id is nullable by design on ' || nf.tbl || ' — NULL means platform-wide',
         'public.' || nf.tbl || '.tenant_id is NULLABLE with NO column default. Its RLS '
         'SELECT policy matches (tenant_id IS NULL), so a NULL row is deliberately '
         'READABLE BY EVERY DEALERSHIP — it is platform scope, not an orphan, and it is '
         'not invisible. Uniqueness over the NULL-tenant rows is carried by: ' ||
         coalesce(nf.null_uq,
                  'NO partial unique index WHERE tenant_id IS NULL — duplicate '
                  'platform-wide rows are possible on this table') ||
         '. What to check before a second dealership: nothing in the database stops a row '
         'that belongs to ONE dealership being written with a NULL tenant_id, and such a '
         'row is disclosed to all of them. Do not "fix" this by making the column NOT NULL '
         'without first re-homing the existing NULL rows — that would delete platform scope.'
    from nullable_facts nf
   where nf.col_default is null and nf.null_rows_visible

  union all
  -- Case 3: nullable, no default, and no policy admits NULL. A row written with
  -- NULL belongs to no dealership and is readable by none.
  select 'BLOCKER',
         'tenant_id is nullable and orphaning on ' || nf.tbl,
         'public.' || nf.tbl || '.tenant_id is NULLABLE with no column default and no '
         'permissive RLS SELECT policy admitting NULL, so a row written with NULL belongs '
         'to no dealership and is readable by none. Make it NOT NULL, or declare what NULL '
         'means and admit it in the policy.'
    from nullable_facts nf
   where nf.col_default is null and not nf.null_rows_visible

  union all
  select 'INFO', 'rows with no tenant right now', x.tbl || ': ' || x.n::text
    from (
      select 'leads' tbl, count(*) n from leads where tenant_id is null
      union all select 'communication_logs', count(*) from communication_logs where tenant_id is null
      union all select 'audit_log', count(*) from audit_log where tenant_id is null
      union all select 'inventory', count(*) from inventory where tenant_id is null
      union all select 'whatsapp_contacts', count(*) from whatsapp_contacts where tenant_id is null
    ) x where x.n > 0;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_tenant_capability_core(p_tenant_id uuid)
 RETURNS SETOF nexus_tenant_capability_row
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select t.id, k.capability_key, k.label,
         case when tc.state = 'AVAILABLE' then 'AVAILABLE' else 'NOT_AVAILABLE' end,
         tc.evidence, tc.source, tc.set_by, tc.verified_at,
         k.what_it_unlocks, k.requires, k.absent_means, k.sort
    from public.tenants t
    cross join public.tenant_capability_catalogue k
    left join public.tenant_capability tc
           on tc.tenant_id = t.id and tc.capability_key = k.capability_key
   where t.id = p_tenant_id;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_tenant_config_core(p_tenant_id uuid)
 RETURNS SETOF nexus_tenant_config_row
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with d as (
    select setting_key, default_value from public.tenant_configuration_default
  )
  select
    t.id, t.slug, t.name, t.status,
    (c.tenant_id is not null),

    coalesce(c.brand_name, t.name),
    case when c.brand_name is not null then 'CONFIGURED' else 'INHERITED_FROM_TENANT' end,

    c.default_language,
    case when c.default_language is not null then 'CONFIGURED' else 'NOT_CONFIGURED' end,

    coalesce(c.timezone, (select default_value #>> '{}' from d where setting_key = 'timezone')),
    case when c.timezone is not null then 'CONFIGURED' else 'PRODUCT_DEFAULT' end,

    coalesce(c.currency, (select default_value #>> '{}' from d where setting_key = 'currency')),
    case when c.currency is not null then 'CONFIGURED' else 'PRODUCT_DEFAULT' end,

    c.business_hours,
    case when c.business_hours is not null then 'CONFIGURED' else 'NOT_CONFIGURED' end,
    c.business_hours_basis, c.business_hours_set_by, c.business_hours_source, c.business_hours_verified_at,

    c.ai_tone,
    case when c.ai_tone is not null then 'CONFIGURED' else 'NOT_CONFIGURED' end,
    c.ai_tone_basis, c.ai_tone_set_by, c.ai_tone_source, c.ai_tone_verified_at,

    c.followup_policy,
    case when c.followup_policy is not null then 'CONFIGURED' else 'NOT_CONFIGURED' end,
    c.followup_policy_basis, c.followup_policy_set_by, c.followup_policy_source, c.followup_policy_verified_at,

    coalesce(c.approval_rules, (select default_value from d where setting_key = 'approval_rules')),
    case when c.approval_rules is not null then 'CONFIGURED' else 'PRODUCT_DEFAULT' end,
    c.approval_rules_basis, c.approval_rules_set_by, c.approval_rules_source, c.approval_rules_verified_at,

    -- The sharp case. The figure is NOT duplicated here: it is read from
    -- lead_recovery_settings, which is where it already lives and where
    -- v_lead_recovery reads it. What this adds is the STATE, so "has not
    -- decided" stops looking identical to "chose 5".
    coalesce(s.sla_first_response_minutes,
             (select (default_value #>> '{}')::int from d where setting_key = 'first_response_sla_minutes')),
    case when s.sla_first_response_minutes is not null then 'CONFIGURED' else 'PRODUCT_DEFAULT' end,
    case
      when s.sla_first_response_minutes is not null
        then 'lead_recovery_settings.sla_first_response_minutes, set_by '
             || coalesce(s.set_by, '(nobody named)') || ' at ' || s.set_at::text
      when s.tenant_id is null
        then 'NOT THIS DEALERSHIP POLICY. No lead_recovery_settings row exists for this tenant; the value is the product default from tenant_configuration_default.'
      else 'NOT THIS DEALERSHIP POLICY. A lead_recovery_settings row exists but sla_first_response_minutes is null - the dealership has explicitly not decided; the value is the product default from tenant_configuration_default.'
    end,

    (select count(*)::int from public.tenant_capability tc
      where tc.tenant_id = t.id and tc.state = 'AVAILABLE'),
    (select count(*)::int from public.tenant_capability_catalogue),

    array_remove(array[
      case when c.brand_name       is null then 'brand_name'       end,
      case when c.default_language is null then 'default_language' end,
      case when c.timezone         is null then 'timezone'         end,
      case when c.currency         is null then 'currency'         end,
      case when c.business_hours   is null then 'business_hours'   end,
      case when c.ai_tone          is null then 'ai_tone'          end,
      case when c.followup_policy  is null then 'followup_policy'  end,
      case when c.approval_rules   is null then 'approval_rules'   end,
      case when s.sla_first_response_minutes is null then 'first_response_sla_minutes' end
    ], null),

    now()
  from public.tenants t
  left join public.tenant_configuration   c on c.tenant_id = t.id
  left join public.lead_recovery_settings s on s.tenant_id = t.id
  where t.id = p_tenant_id;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_verify_template_ref(p_tenant_id uuid, p_provider text, p_template_ref text, p_required_category text, p_max_status_age interval)
 RETURNS TABLE(sendable boolean, verification text, detail text, what_would_change_it text, template_id uuid, template_name text, template_language text, template_category text, provider_status text, provider_status_observed_at timestamp with time zone, status_age interval, max_status_age interval)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_ref  text := lower(btrim(coalesce(p_template_ref,'')));
  v_name text;
  v_lang text;
  v_cat  text := upper(nullif(btrim(coalesce(p_required_category,'')),''));
  v_n    int;
  v_langs text;
  t      public.whatsapp_templates%rowtype;
  s      record;
begin
  if v_ref = '' then
    return query select false, 'NO_TEMPLATE_REF'::text,
      'No template reference was supplied, so there is nothing to verify.'::text,
      'Supply the template name, or name:language when the dealership holds more than one language for it.'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::timestamptz,
      null::interval, p_max_status_age;
    return;
  end if;

  -- The tolerance has no default here for the same reason it has none on
  -- whatsapp_template_sendability: how old an approval a dealership is willing
  -- to send on is the dealership's risk, not a number NEXUS invents for it.
  if p_max_status_age is null then
    return query select false, 'REFUSED_NO_TOLERANCE_STATED'::text,
      'The caller did not say how old a provider status it is willing to send on.'::text,
      'Pass p_max_status_age. The value is recorded with the routing decision, so the tolerance a send was made under stays auditable.'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::timestamptz,
      null::interval, p_max_status_age;
    return;
  end if;

  if p_provider is distinct from 'whatsapp_cloud' then
    return query select false, 'REFUSED_PROVIDER_HAS_NO_TEMPLATES'::text,
      format('A WhatsApp message template is a WABA object and does not exist behind %s, so there is no approval for NEXUS to check.',
             coalesce(p_provider,'(no provider)'))::text,
      'Route the send through the official WhatsApp Cloud API integration. Pasting the template text into a free-form message on an unofficial transport is the bypass, not the workaround.'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::timestamptz,
      null::interval, p_max_status_age;
    return;
  end if;

  if position(':' in v_ref) > 0 then
    v_name := split_part(v_ref, ':', 1);
    v_lang := split_part(v_ref, ':', 2);
  else
    v_name := v_ref;
    v_lang := null;
  end if;

  select count(*)::int, string_agg(distinct w.language, ', ' order by w.language)
    into v_n, v_langs
    from public.whatsapp_templates w
   where w.tenant_id = p_tenant_id
     and w.provider  = p_provider
     and w.name      = v_name
     and (v_lang is null or w.language = v_lang);

  if v_n = 0 then
    return query select false, 'REFUSED_TEMPLATE_UNKNOWN'::text,
      format('This dealership holds no template called %L%s in NEXUS''s registry, so NEXUS can say nothing about whether the provider approved it. An unknown reference is not an approved one.',
             v_name, case when v_lang is null then '' else format(' in language %L', v_lang) end)::text,
      'Register the template and record the provider''s status for it with whatsapp_template_declare() and whatsapp_template_observe().'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::timestamptz,
      null::interval, p_max_status_age;
    return;
  end if;

  if v_n > 1 then
    return query select false, 'REFUSED_TEMPLATE_REF_AMBIGUOUS'::text,
      format('%s templates called %L exist for this dealership, in languages %s. NEXUS will not pick which language a customer receives.',
             v_n, v_name, v_langs)::text,
      format('Reference it as %s:<language>, for example %s:%s.', v_name, v_name, split_part(v_langs, ',', 1))::text,
      null::uuid, null::text, null::text, null::text, null::text, null::timestamptz,
      null::interval, p_max_status_age;
    return;
  end if;

  select w.* into t
    from public.whatsapp_templates w
   where w.tenant_id = p_tenant_id
     and w.provider  = p_provider
     and w.name      = v_name
     and (v_lang is null or w.language = v_lang);

  -- An approved template of the wrong category is still the wrong message. The
  -- policy engine said which category this send is allowed to be; a MARKETING
  -- template sent where UTILITY was required is a policy bypass carrying an
  -- approval that looks legitimate.
  if v_cat is not null and t.category <> v_cat then
    return query select false, 'REFUSED_TEMPLATE_CATEGORY_MISMATCH'::text,
      format('Template %s (%s) is a %s template, and the policy decision for this message requires a %s one.',
             t.name, t.language, t.category, v_cat)::text,
      format('Send a %s template, or change what is being sent. Recategorising the template with the provider is a decision about what this message really is, not a formality.', v_cat)::text,
      t.template_id, t.name, t.language, t.category, t.provider_status, t.provider_status_observed_at,
      (now() - t.provider_status_observed_at), p_max_status_age;
    return;
  end if;

  select * into s from public.whatsapp_template_sendability(t.template_id, p_max_status_age) v;

  return query select
    s.sendable,
    case when s.sendable then 'VERIFIED_APPROVED_AND_FRESH_ENOUGH' else s.verdict end::text,
    format('%s (%s / %s). %s', s.reason, s.reason_code, t.name || ':' || t.language, coalesce(s.what_would_change_it,''))::text,
    s.what_would_change_it,
    s.template_id, t.name, t.language, t.category,
    s.provider_status, s.provider_status_observed_at, s.status_age, s.max_status_age;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.nexus_whatsapp_cloud_canonical_events(p_payload jsonb)
 RETURNS TABLE(resolution text, provider text, channel_type text, phone_number_id text, business_display_phone text, provider_account_id text, tenant_id uuid, tenant_slug text, integration_id uuid, direction text, external_message_id text, customer_external_id text, customer_phone text, customer_display_name text, conversation_id text, message_kind text, text_body text, media jsonb, received_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
with guard as (
  -- Same guard, same wording, as nexus_resolve_channel_tenant: a signed-in end
  -- user is never handed a tenant by a backend resolver. EXECUTE is revoked
  -- from anon and authenticated in chanadapt_05; this is defence in depth.
  select coalesce(current_setting('role', true), '') not in ('authenticated', 'anon') as ok
),
ent as (
  select e.value->>'id' as waba_id, e.value as entry
    from jsonb_array_elements(
           case when jsonb_typeof(p_payload->'entry') = 'array'
                then p_payload->'entry' else '[]'::jsonb end) e(value)
),
chg as (
  select ent.waba_id, c.value->'value' as val
    from ent,
         jsonb_array_elements(
           case when jsonb_typeof(ent.entry->'changes') = 'array'
                then ent.entry->'changes' else '[]'::jsonb end) c(value)
   where c.value->>'field' = 'messages'
),
val as (
  select chg.waba_id,
         chg.val,
         lower(btrim(coalesce(chg.val->'metadata'->>'phone_number_id', ''))) as pnid,
         chg.val->'metadata'->>'display_phone_number' as disp
    from chg
),
msg as (
  select val.*, m.value as m
    from val,
         jsonb_array_elements(
           case when jsonb_typeof(val.val->'messages') = 'array'
                then val.val->'messages' else '[]'::jsonb end) m(value)
),
res as (
  select msg.*,
         r.tenant_id     as r_tenant_id,
         r.tenant_slug   as r_tenant_slug,
         r.integration_id as r_integration_id,
         -- the media sub-object, whichever kind it is
         (case msg.m->>'type'
            when 'image'    then msg.m->'image'
            when 'audio'    then msg.m->'audio'
            when 'video'    then msg.m->'video'
            when 'document' then msg.m->'document'
            when 'sticker'  then msg.m->'sticker'
            else null end) as mo
    from msg
    left join lateral public.nexus_resolve_channel_tenant(
                        'whatsapp_cloud_phone_number_id', msg.pnid) r on true
)
select
  case when res.pnid = ''            then 'unresolved_missing_phone_number_id'
       when res.r_tenant_id is null  then 'unresolved_phone_number_id'
       else 'resolved' end                                             as resolution,
  'whatsapp_cloud'::text                                               as provider,
  'whatsapp_cloud_phone_number_id'::text                               as channel_type,
  nullif(res.pnid, '')                                                 as phone_number_id,
  res.disp                                                             as business_display_phone,
  res.waba_id                                                          as provider_account_id,
  res.r_tenant_id                                                      as tenant_id,
  res.r_tenant_slug                                                    as tenant_slug,
  res.r_integration_id                                                 as integration_id,
  'inbound'::text                                                      as direction,
  res.m->>'id'                                                         as external_message_id,
  res.m->>'from'                                                       as customer_external_id,
  -- Only a real phone number lands in customer_phone. Meta can address a user
  -- by a business-scoped user id instead, and that is not a phone number.
  case when res.m->>'from' ~ '^[0-9]{6,20}$' then res.m->>'from' end   as customer_phone,
  (select c.value->'profile'->>'name'
     from jsonb_array_elements(
            case when jsonb_typeof(res.val->'contacts') = 'array'
                 then res.val->'contacts' else '[]'::jsonb end) c(value)
    where c.value->>'wa_id' = res.m->>'from'
    limit 1)                                                           as customer_display_name,
  null::text                                                           as conversation_id,
  case when coalesce(res.m->>'type','') = '' then 'unsupported'
       when res.m->>'type' = any (array['text','image','audio','video','document',
                                        'sticker','location','contacts','interactive',
                                        'button','order','reaction','system'])
            then res.m->>'type'
       else 'unsupported' end                                          as message_kind,
  case when res.m->>'type' = 'text'        then res.m->'text'->>'body'
       when res.mo is not null             then res.mo->>'caption'
       when res.m->>'type' = 'button'      then res.m->'button'->>'text'
       when res.m->>'type' = 'interactive' then coalesce(
              res.m->'interactive'->'button_reply'->>'title',
              res.m->'interactive'->'list_reply'->>'title')
       else null end                                                   as text_body,
  case when res.mo is null then null
       else jsonb_build_object(
              'kind',          'media_id',
              'ref',           res.mo->>'id',
              'mime_type',     res.mo->>'mime_type',
              'sha256',        res.mo->>'sha256',
              'caption',       res.mo->>'caption',
              'filename',      res.mo->>'filename',
              'requires_auth', true)
  end                                                                  as media,
  case when (res.m->>'timestamp') ~ '^[0-9]+$'
       then to_timestamp((res.m->>'timestamp')::numeric) end           as received_at
from res
where (select ok from guard);
$function$
;

CREATE OR REPLACE FUNCTION public.policy_authority(p_status text, p_verification_status text, p_effective_from date, p_effective_to date, p_as_of date)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select case
    -- No value is stated at all. Nothing downstream may proceed from this.
    when p_verification_status = 'UNKNOWN'          then 'UNKNOWN'
    -- A value exists but nobody has checked it. This is the reason that stops
    -- it reaching a customer, so it is the reason that gets reported.
    when p_verification_status = 'NOT_VERIFIED'     then 'NOT_VERIFIED'
    when p_verification_status = 'DISPUTED'         then 'DISPUTED'
    -- Verified, but not the version in force.
    when p_status in ('DRAFT','WITHDRAWN')          then 'NOT_IN_FORCE'
    -- In force from when? A rule with no start date cannot be pinned to the
    -- date a decision was taken, so it cannot support one.
    when p_effective_from is null                   then 'NO_EFFECTIVE_DATE'
    when p_as_of < p_effective_from                 then 'NOT_YET_EFFECTIVE'
    when p_effective_to is not null
         and p_as_of >= p_effective_to              then 'EXPIRED'
    else 'AUTHORITATIVE'
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.policy_citation(p_jurisdiction text, p_rule_type text, p_rule_name text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_cite text;
begin
  select a.citation into v_cite
    from public.v_policy_authoritative a
   where a.jurisdiction = upper(p_jurisdiction)
     and a.rule_type    = upper(p_rule_type)
     and a.rule_name    = upper(p_rule_name)
   order by (a.tenant_id is null), a.version desc
   limit 1;

  if v_cite is null then
    raise exception using
      errcode = 'P0002',
      message = format('There is no verified source for %s/%s/%s, so no regulatory claim may be made about it.',
                       upper(p_jurisdiction), upper(p_rule_type), upper(p_rule_name)),
      hint    = 'A customer-facing regulatory statement requires a VERIFIED policy rule with a named '
                'source, an instrument or URL, a verification date and a verifier. Get one, or say nothing.';
  end if;
  return v_cite;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.policy_numeric(p_jurisdiction text, p_rule_type text, p_rule_name text)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select public.policy_numeric_as_of(p_jurisdiction, p_rule_type, p_rule_name,
                                     (now() at time zone 'Asia/Dubai')::date);
$function$
;

CREATE OR REPLACE FUNCTION public.policy_numeric_as_of(p_jurisdiction text, p_rule_type text, p_rule_name text, p_as_of date)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  r     record;
  n_any integer;
begin
  select v.*
    into r
    from public.v_policy_rule v
   where v.jurisdiction = upper(p_jurisdiction)
     and v.rule_type    = upper(p_rule_type)
     and v.rule_name    = upper(p_rule_name)
     and public.policy_authority(v.status, v.verification_status,
                                 v.effective_from, v.effective_to, p_as_of) = 'AUTHORITATIVE'
     -- A dealership's own rule outranks the global one for the same name.
     order by (v.tenant_id is null), v.version desc
   limit 1;

  if found then
    if r.value_kind <> 'NUMERIC' then
      raise exception using
        errcode = '22023',
        message = format('Policy rule %s/%s/%s is not numeric — its unit is %s.',
                         upper(p_jurisdiction), upper(p_rule_type), upper(p_rule_name), r.unit),
        hint    = 'Read it from v_policy_authoritative as value_text.';
    end if;
    return r.value_numeric;
  end if;

  -- Nothing authoritative. Say exactly why, and never suggest a number.
  select count(*) into n_any
    from public.v_policy_rule v
   where v.jurisdiction = upper(p_jurisdiction)
     and v.rule_type    = upper(p_rule_type)
     and v.rule_name    = upper(p_rule_name);

  if n_any = 0 then
    raise exception using
      errcode = 'P0002',
      message = format('No policy rule %s/%s/%s exists as of %s.',
                       upper(p_jurisdiction), upper(p_rule_type), upper(p_rule_name), p_as_of),
      hint    = 'UNKNOWN is the answer. Do not infer, estimate or default a value. '
                'Record the rule in policy_rule with its source, get it verified, then ask again.';
  else
    raise exception using
      errcode = 'P0002',
      message = format('Policy rule %s/%s/%s exists but no version is authoritative as of %s.',
                       upper(p_jurisdiction), upper(p_rule_type), upper(p_rule_name), p_as_of),
      hint    = 'Read v_policy_rule for that rule: `authority_reason` says whether it is unverified, '
                'expired, not yet effective, disputed or never in force. Until it is verified and in '
                'date, the answer is UNKNOWN — not the value sitting in the row.';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.policy_platform_attestation_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  raise exception using
    errcode = '42501',
    message = 'policy_platform_attestation is append-only: an attestation records what somebody '
              'checked on a day, and that does not change afterwards.',
    hint    = 'If the check was wrong, supersede the rule and attest the new version.';
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.policy_platform_supersede_rule(p_rule_id uuid, p_effective_from date, p_source_name text, p_changed_by text, p_value_numeric numeric DEFAULT NULL::numeric, p_value_text text DEFAULT NULL::text, p_source_ref text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(rule_id uuid, version integer, outcome text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  r     public.policy_rule%rowtype;
  v_new uuid;
  v_role text := coalesce(current_setting('role', true), '');
begin
  if v_role in ('authenticated','anon') then
    perform public.policy_refuse('PLATFORM_PATH_NOT_FOR_END_USERS',
      format('policy_platform_supersede_rule is a platform operator path and refuses role %s.', v_role));
  end if;

  select * into r from public.policy_rule where id = p_rule_id;
  if not found then
    perform public.policy_refuse('NO_SUCH_RULE', 'No rule with that id exists.');
  end if;

  if r.tenant_id is not null then
    perform public.policy_refuse('NOT_A_GLOBAL_RULE',
      'That rule belongs to one dealership.',
      'The dealership replaces it with policy_supersede_rule().');
  end if;

  if r.status in ('SUPERSEDED','WITHDRAWN') then
    perform public.policy_refuse('RULE_IS_RETIRED',
      format('Version %s is already %s.', r.version, r.status),
      'Supersede the version that is current.');
  end if;

  if nullif(btrim(coalesce(p_changed_by,'')),'') is null then
    perform public.policy_refuse('NO_AUTHOR_NAMED',
      'Name the person recording this new version. service_role is not an author.');
  end if;

  if p_effective_from is null then
    perform public.policy_refuse('NO_EFFECTIVE_FROM',
      'The new version must say from when it applies.');
  end if;

  if r.effective_from is not null and p_effective_from <= r.effective_from then
    perform public.policy_refuse('EFFECTIVE_FROM_NOT_AFTER_PREVIOUS',
      format('The new version must start after the one it replaces (%s started %s).',
             r.version, r.effective_from));
  end if;

  update public.policy_rule
     set effective_to = p_effective_from,
         status       = 'SUPERSEDED'
   where id = p_rule_id and tenant_id is null;

  insert into public.policy_rule (
    tenant_id, jurisdiction, jurisdiction_owner_kind, rule_type, rule_name,
    value_numeric, value_text, unit, value_kind,
    source_name, source_url, source_document,
    effective_from, notes,
    status, verification_status, confidence,
    version, supersedes_id, added_by, added_by_auth_user_id
  ) values (
    null, r.jurisdiction, r.jurisdiction_owner_kind, r.rule_type, r.rule_name,
    p_value_numeric, p_value_text, r.unit, r.value_kind,
    p_source_name,
    case when p_source_ref ~* '^https?://' then btrim(p_source_ref) end,
    case when p_source_ref is not null and p_source_ref !~* '^https?://' then btrim(p_source_ref) end,
    p_effective_from, p_notes,
    'DRAFT', 'NOT_VERIFIED', 'UNKNOWN',
    r.version + 1, r.id, btrim(p_changed_by), null
  ) returning id into v_new;

  insert into public.policy_rule_event (rule_id, tenant_id, event, actor, actor_auth_user_id,
                                        from_status, to_status, detail)
  values (p_rule_id, null, 'SUPERSEDED', btrim(p_changed_by), null, r.status, 'SUPERSEDED',
          format('Replaced by version %s from %s by the platform. The old version stays readable: '
                 'decisions taken while it applied were correct under it.', r.version + 1, p_effective_from));

  insert into public.policy_rule_event (rule_id, tenant_id, event, actor, actor_auth_user_id,
                                        to_status, to_verification, detail)
  values (v_new, null, 'PROPOSED', btrim(p_changed_by), null, 'DRAFT', 'NOT_VERIFIED',
          format('Version %s, superseding %s. It is NOT authoritative until a named person attests it '
                 'with policy_platform_verify_rule(); until then every consumer keeps refusing.',
                 r.version + 1, p_rule_id));

  return query select v_new, r.version + 1, 'PLATFORM_SUPERSEDED'::text;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.policy_platform_verify_rule(p_rule_id uuid, p_attested_by text, p_attested_by_contact text, p_source_kind text, p_source_name text, p_source_ref text, p_source_observed_on date, p_effective_from date DEFAULT NULL::date, p_confidence text DEFAULT 'HIGH'::text, p_account_ref text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(rule_id uuid, version integer, attestation_id uuid, outcome text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  r      public.policy_rule%rowtype;
  jur    record;
  v_att  uuid;
  v_from date;
  v_role text := coalesce(current_setting('role', true), '');
begin
  if v_role in ('authenticated','anon') then
    perform public.policy_refuse('PLATFORM_PATH_NOT_FOR_END_USERS',
      format('policy_platform_verify_rule is a platform operator path and refuses role %s.', v_role),
      'A dealership verifies its own house rules with policy_verify_rule().');
  end if;

  select * into r from public.policy_rule where id = p_rule_id;
  if not found then
    perform public.policy_refuse('NO_SUCH_RULE', 'No rule with that id exists.');
  end if;

  if r.tenant_id is not null then
    perform public.policy_refuse('NOT_A_GLOBAL_RULE',
      'That rule belongs to one dealership, so the platform is not the party that vouches for it.',
      'A dealership approver verifies it with policy_verify_rule().');
  end if;

  select * into jur from public.policy_jurisdiction j where j.code = r.jurisdiction;

  if r.verification_status = 'UNKNOWN' then
    perform public.policy_refuse('NO_VALUE_TO_VERIFY',
      'This rule states no value - it is registered as a question. There is nothing to verify.',
      'Supersede it with a version that states the value the source gives, then attest that.');
  end if;

  if r.verification_status = 'VERIFIED' then
    perform public.policy_refuse('ALREADY_VERIFIED',
      format('Already verified by %s on %s.', r.verified_by, r.verification_date),
      'Re-sourcing a verified rule means superseding it, not overwriting what was checked.');
  end if;

  if r.status in ('SUPERSEDED','WITHDRAWN') then
    perform public.policy_refuse('RULE_IS_RETIRED',
      format('This version is %s and is closed to further change.', r.status));
  end if;

  if nullif(btrim(coalesce(p_attested_by,'')),'') is null then
    perform public.policy_refuse('NO_ATTESTOR_NAMED',
      'A platform verification is one person saying they checked this against the source. Name them.',
      'service_role is machinery, not a witness. Pass the name of the human who read the source.');
  end if;

  if nullif(btrim(coalesce(p_attested_by_contact,'')),'') is null then
    perform public.policy_refuse('NO_ATTESTOR_CONTACT',
      'Give a contact address for the person attesting, so a later reader can ask them what they saw.');
  end if;

  if nullif(btrim(coalesce(p_source_ref,'')),'') is null then
    perform public.policy_refuse('NO_SOURCE_REFERENCE',
      'A platform attestation must reference something another person could open and read for '
      'themselves - a documentation URL, a console screen, a contract clause.');
  end if;

  if p_source_observed_on is null then
    perform public.policy_refuse('NO_OBSERVATION_DATE',
      'Say which day the source was read. A rule verified against an undated look cannot be judged '
      'stale later.');
  end if;

  if p_source_observed_on > (now() at time zone 'Asia/Dubai')::date then
    perform public.policy_refuse('OBSERVATION_IN_THE_FUTURE',
      format('The source cannot have been read on %s; today is %s in Asia/Dubai.',
             p_source_observed_on, (now() at time zone 'Asia/Dubai')::date));
  end if;

  if coalesce(p_confidence,'UNKNOWN') = 'UNKNOWN' then
    perform public.policy_refuse('NO_CONFIDENCE',
      'State HIGH, MEDIUM or LOW confidence. UNKNOWN confidence and VERIFIED are contradictory.');
  end if;

  v_from := coalesce(p_effective_from, r.effective_from);
  if v_from is null then
    perform public.policy_refuse('NO_EFFECTIVE_FROM',
      'A verified rule must say from when it applies, or no decision can ever be tied to it.');
  end if;

  -- effective_from is frozen once a version leaves DRAFT (policy_rule_guard_
  -- immutability). Attesting does not get to move the date the rule started
  -- applying: decisions have already been taken under it.
  if r.status <> 'DRAFT' and v_from is distinct from r.effective_from then
    perform public.policy_refuse('EFFECTIVE_FROM_IS_FROZEN',
      format('This version has been in force since %s and that date cannot move; attesting it does not '
             'change when it started applying.', r.effective_from),
      format('Attest it as it stands (pass no p_effective_from, or %s), or - if the source says the rule '
             'changed on a later date - record that as a new version with '
             'policy_platform_supersede_rule() and attest the new one.', r.effective_from));
  end if;

  insert into public.policy_platform_attestation
    (rule_id, attested_by, attested_by_contact, source_kind, source_name, source_ref,
     source_observed_on, account_ref, confidence, notes)
  values
    (p_rule_id, btrim(p_attested_by), btrim(p_attested_by_contact), p_source_kind,
     p_source_name, btrim(p_source_ref), p_source_observed_on,
     nullif(btrim(coalesce(p_account_ref,'')),''), p_confidence, p_notes)
  returning public.policy_platform_attestation.attestation_id into v_att;

  update public.policy_rule
     set source_name             = coalesce(p_source_name, source_name),
         source_url              = case when p_source_ref ~* '^https?://' then btrim(p_source_ref)
                                        else source_url end,
         source_document         = case when p_source_ref ~* '^https?://' then source_document
                                        else btrim(p_source_ref) end,
         effective_from          = v_from,
         verification_status     = 'VERIFIED',
         status                  = 'ACTIVE',
         verification_date       = (now() at time zone 'Asia/Dubai')::date,
         verified_by             = btrim(p_attested_by),
         verified_by_auth_user_id = null,
         confidence              = p_confidence,
         platform_attestation_id = v_att,
         notes                   = coalesce(p_notes, notes)
   where id = p_rule_id
     and tenant_id is null;

  insert into public.policy_rule_event
    (rule_id, tenant_id, event, actor, actor_auth_user_id,
     from_status, to_status, from_verification, to_verification, detail)
  values
    (p_rule_id, null, 'VERIFIED', btrim(p_attested_by), null,
     r.status, 'ACTIVE', r.verification_status, 'VERIFIED',
     format('PLATFORM ATTESTATION %s. %s checked %s (%s) against %s, read on %s%s. This is the platform '
            'operator vouching for a rule that binds every dealership under jurisdiction %s (%s). It is '
            'not a dealership verifying its own house rule, and no dealership account could have done it.',
            v_att, btrim(p_attested_by), r.rule_name, r.jurisdiction, p_source_name, p_source_observed_on,
            case when nullif(btrim(coalesce(p_account_ref,'')),'') is not null
                 then format(' in account %s', btrim(p_account_ref)) else '' end,
            r.jurisdiction, coalesce(jur.owner_name,'owner not registered')));

  return query select p_rule_id, r.version, v_att, 'PLATFORM_VERIFIED'::text;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.policy_propose_rule(p_jurisdiction text, p_rule_type text, p_rule_name text, p_unit text, p_source_name text, p_value_numeric numeric DEFAULT NULL::numeric, p_value_text text DEFAULT NULL::text, p_source_url text DEFAULT NULL::text, p_source_document text DEFAULT NULL::text, p_effective_from date DEFAULT NULL::date, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(rule_id uuid, version integer, outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  ctx        record;
  jur        record;
  v_kind     text;
  v_actor    text;
  v_unknown  boolean;
  v_id       uuid;
  v_jur      text := upper(btrim(coalesce(p_jurisdiction,'')));
  v_type     text := upper(btrim(coalesce(p_rule_type,'')));
begin
  select * into ctx from public.action_approver_context();

  if ctx.tenant_id is null then
    perform public.policy_refuse(
      coalesce(ctx.refusal_code, 'NO_TENANT'),
      coalesce(ctx.refusal_reason,
        'This account belongs to no dealership, so it cannot record a rule for one.'),
      'Sign in as a member of a dealership.');
  end if;

  select * into jur from public.policy_jurisdiction j where j.code = v_jur;
  if not found then
    perform public.policy_refuse('UNKNOWN_JURISDICTION',
      format('%L is not a jurisdiction this engine knows, so there is nobody it could be a rule of.', v_jur),
      'Register it in public.policy_jurisdiction in a migration first, naming who owns the namespace. '
      'Naming a new legislator is a modelling decision, not a data entry.');
  end if;

  -- The P0. A jurisdiction that names a platform or a regulator is not a
  -- dealership's to legislate in, however honestly it fills the form in.
  if jur.owner_kind <> 'TENANT' then
    perform public.policy_refuse('JURISDICTION_NOT_YOURS_TO_LEGISLATE',
      format('%s is %s''s namespace (%s), not this dealership''s. A rule filed there is read by every '
             'consumer as %s''s own requirement, and the engine reports it back with that jurisdiction '
             'on the audit trail. One dealership''s staff cannot be the source of that.',
             v_jur, jur.owner_name, jur.owner_kind, jur.owner_name),
      'File the dealership''s own position under TENANT_HOUSE instead. A TENANT_HOUSE rule of the same '
      'name may tighten what the platform allows and can never loosen it. If you believe the platform '
      'rule itself is recorded wrongly, that is a platform correction, made by whoever holds the '
      'platform account: policy_platform_supersede_rule().');
  end if;

  if not exists (select 1 from public.policy_rule_type t where t.code = v_type) then
    perform public.policy_refuse('UNKNOWN_RULE_TYPE',
      format('%L is not a rule type this engine knows.', v_type),
      'Add it to policy_rule_type in a migration first. The set of things policy can govern is a '
      'modelling decision.');
  end if;

  select u.value_kind into v_kind from public.policy_unit u where u.code = upper(p_unit);
  if v_kind is null then
    perform public.policy_refuse('UNKNOWN_UNIT',
      format('%s is not a unit this engine knows.', p_unit),
      'Add it to policy_unit in a migration first - a new unit is a modelling decision.');
  end if;

  -- No value supplied means the rule is registered as a QUESTION. It is stored
  -- as UNKNOWN with no value, and can never be read as authoritative.
  v_unknown := (p_value_numeric is null and nullif(btrim(coalesce(p_value_text,'')),'') is null);

  if not v_unknown then
    if v_kind = 'NUMERIC' and p_value_numeric is null then
      perform public.policy_refuse('VALUE_UNIT_MISMATCH',
        format('Unit %s is numeric, so the value belongs in p_value_numeric.', upper(p_unit)));
    end if;
    if v_kind <> 'NUMERIC' and p_value_numeric is not null then
      perform public.policy_refuse('VALUE_UNIT_MISMATCH',
        format('Unit %s is not numeric, so the value belongs in p_value_text.', upper(p_unit)));
    end if;
  end if;

  if nullif(btrim(coalesce(p_source_name,'')),'') is null then
    perform public.policy_refuse('NO_SOURCE_NAME',
      'Every rule must name where it came from, even an unverified one.',
      'If the value was lifted out of this codebase, the honest source_name is the file and line it sat '
      'on - not the regulator that constant was guessing at.');
  end if;

  v_actor := coalesce(nullif(btrim(coalesce(ctx.staff_name,'')),''),
                      nullif(btrim(coalesce(auth.jwt() ->> 'email','')),''),
                      ctx.auth_user_id::text);

  insert into public.policy_rule (
    tenant_id, jurisdiction, jurisdiction_owner_kind, rule_type, rule_name,
    value_numeric, value_text, unit, value_kind,
    source_name, source_url, source_document,
    effective_from, notes,
    status, verification_status, confidence,
    version, added_by, added_by_auth_user_id
  ) values (
    ctx.tenant_id, v_jur, jur.owner_kind, v_type, upper(p_rule_name),
    case when v_unknown then null else p_value_numeric end,
    case when v_unknown then null else p_value_text end,
    upper(p_unit), v_kind,
    p_source_name, p_source_url, p_source_document,
    p_effective_from, p_notes,
    'DRAFT',
    case when v_unknown then 'UNKNOWN' else 'NOT_VERIFIED' end,
    'UNKNOWN',
    1, v_actor, ctx.auth_user_id
  ) returning id into v_id;

  insert into public.policy_rule_event (rule_id, tenant_id, event, actor, actor_auth_user_id,
                                        to_status, to_verification, detail)
  values (v_id, ctx.tenant_id, 'PROPOSED', v_actor, ctx.auth_user_id,
          'DRAFT', case when v_unknown then 'UNKNOWN' else 'NOT_VERIFIED' end,
          case when v_unknown
               then 'Registered as a question: no value stated.'
               else 'Value recorded but not checked against the source.' end);

  return query select v_id, 1, 'PROPOSED'::text;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.policy_read_unverified_rule(p_jurisdiction text, p_rule_type text, p_rule_name text)
 RETURNS TABLE(id uuid, tenant_id uuid, version integer, value_numeric numeric, value_text text, unit text, status text, verification_status text, authority text, authority_reason text, may_be_relied_on boolean, source_name text, source_document text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select v.id, v.tenant_id, v.version, v.value_numeric, v.value_text, v.unit,
         v.status, v.verification_status, v.authority, v.authority_reason,
         v.may_be_relied_on, v.source_name, v.source_document
    from public.v_policy_rule v
   where v.jurisdiction = upper(p_jurisdiction)
     and v.rule_type    = upper(p_rule_type)
     and v.rule_name    = upper(p_rule_name)
   order by (v.tenant_id is null), v.version desc;
$function$
;

CREATE OR REPLACE FUNCTION public.policy_refuse(p_code text, p_reason text, p_hint text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  raise exception using
    errcode = 'NX001',
    message = p_reason,
    detail  = p_code,
    hint    = coalesce(p_hint, 'Nothing was written.');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.policy_rule_derive_jurisdiction_owner()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_owner text;
begin
  select j.owner_kind into v_owner
    from public.policy_jurisdiction j where j.code = new.jurisdiction;

  if v_owner is null then
    raise exception using
      errcode = '23503',
      message = format('%L is not a jurisdiction this engine knows.', new.jurisdiction),
      hint    = 'Register it in public.policy_jurisdiction in a migration first, naming who owns the '
                'namespace. Naming a new legislator is a modelling decision, not a data entry.';
  end if;

  if new.jurisdiction_owner_kind is null then
    new.jurisdiction_owner_kind := v_owner;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.policy_rule_event_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  raise exception using
    errcode = '23514',
    message = 'policy_rule_event is append-only; a correction is a further event, not an edit.';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.policy_rule_guard_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  frozen text;
begin
  -- The rule itself never changes. A different value is a different version.
  if new.tenant_id     is distinct from old.tenant_id     then frozen := 'tenant_id';
  elsif new.jurisdiction  is distinct from old.jurisdiction  then frozen := 'jurisdiction';
  elsif new.jurisdiction_owner_kind is distinct from old.jurisdiction_owner_kind
                                                             then frozen := 'jurisdiction_owner_kind';
  elsif new.rule_type     is distinct from old.rule_type     then frozen := 'rule_type';
  elsif new.rule_name     is distinct from old.rule_name     then frozen := 'rule_name';
  elsif new.value_numeric is distinct from old.value_numeric then frozen := 'value_numeric';
  elsif new.value_text    is distinct from old.value_text    then frozen := 'value_text';
  elsif new.unit          is distinct from old.unit          then frozen := 'unit';
  elsif new.value_kind    is distinct from old.value_kind    then frozen := 'value_kind';
  elsif new.version       is distinct from old.version       then frozen := 'version';
  elsif new.supersedes_id is distinct from old.supersedes_id then frozen := 'supersedes_id';
  elsif new.added_by      is distinct from old.added_by      then frozen := 'added_by';
  elsif new.added_at      is distinct from old.added_at      then frozen := 'added_at';
  -- An attestation is attached once, by the act of verifying. Re-pointing it at
  -- a different attestation would move the evidence out from under a verified
  -- rule without changing anything a reader would notice.
  elsif old.platform_attestation_id is not null
        and new.platform_attestation_id is distinct from old.platform_attestation_id
                                                             then frozen := 'platform_attestation_id';
  end if;

  if frozen is not null then
    raise exception using
      errcode = '23514',
      message = format('policy_rule.%s cannot be changed on an existing rule version (rule %s, %s v%s).',
                       frozen, old.id, old.rule_name, old.version),
      hint    = 'Insert the next version with policy_supersede_rule() instead. '
                'Editing this row in place would rewrite the evidence behind every past decision that used it.';
  end if;

  -- effective_from is part of the rule once it is in force.
  if old.status <> 'DRAFT' and new.effective_from is distinct from old.effective_from then
    raise exception using
      errcode = '23514',
      message = format('policy_rule.effective_from cannot be changed once a version leaves DRAFT (rule %s, status %s).',
                       old.id, old.status),
      hint    = 'Supersede the version instead.';
  end if;

  -- Once a version is VERIFIED, its evidence is frozen. Re-sourcing it is a
  -- new version, not an edit to the old one.
  if old.verification_status = 'VERIFIED'
     and (new.source_url        is distinct from old.source_url
       or new.source_name       is distinct from old.source_name
       or new.source_document   is distinct from old.source_document
       or new.verification_date is distinct from old.verification_date
       or new.verified_by       is distinct from old.verified_by) then
    raise exception using
      errcode = '23514',
      message = format('The provenance of a VERIFIED rule version is frozen (rule %s).', old.id),
      hint    = 'If the source was wrong, supersede the version. Do not overwrite what was checked.';
  end if;

  -- A retired version is closed. Only notes may be appended to it, because a
  -- later reader may need to know why it was retired.
  if old.status in ('SUPERSEDED','WITHDRAWN')
     and (new.status              is distinct from old.status
       or new.verification_status is distinct from old.verification_status
       or new.effective_to        is distinct from old.effective_to
       or new.confidence          is distinct from old.confidence) then
    raise exception using
      errcode = '23514',
      message = format('Rule version %s is %s and is closed to further change.', old.id, old.status),
      hint    = 'Only notes may be added to a retired version.';
  end if;

  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.policy_rule_guard_one_active()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  clash public.policy_rule%rowtype;
begin
  if new.status <> 'ACTIVE' then
    return new;
  end if;

  select r.* into clash
    from public.policy_rule r
   where r.id <> new.id
     and r.status = 'ACTIVE'
     and r.jurisdiction = new.jurisdiction
     and r.rule_type    = new.rule_type
     and r.rule_name    = new.rule_name
     and r.tenant_id is not distinct from new.tenant_id
     -- daterange with an unbounded end where effective_to is null; an
     -- unbounded start where effective_from is null.
     and daterange(r.effective_from, r.effective_to, '[)')
         && daterange(new.effective_from, new.effective_to, '[)')
   limit 1;

  if found then
    raise exception using
      errcode = '23505',
      message = format('Rule %s/%s/%s already has an ACTIVE version (%s, v%s) covering these dates.',
                       new.jurisdiction, new.rule_type, new.rule_name, clash.id, clash.version),
      hint    = 'Close the existing version first — policy_supersede_rule() does both in one step. '
                'Two ACTIVE versions covering one date is a fork: a consumer asking what the rule is '
                'would get whichever row the planner returned first.';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.policy_supersede_rule(p_rule_id uuid, p_effective_from date, p_source_name text, p_value_numeric numeric DEFAULT NULL::numeric, p_value_text text DEFAULT NULL::text, p_source_url text DEFAULT NULL::text, p_source_document text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(rule_id uuid, version integer, outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  ctx     record;
  r       public.policy_rule%rowtype;
  v_actor text;
  v_new   uuid;
begin
  select * into ctx from public.action_approver_context();

  if not ctx.may_decide then
    perform public.policy_refuse(
      coalesce(ctx.refusal_code, 'NOT_AN_APPROVER'),
      coalesce(ctx.refusal_reason, 'This account may not change a policy rule.'));
  end if;

  select * into r from public.policy_rule where id = p_rule_id;
  if not found then
    perform public.policy_refuse('NO_SUCH_RULE', 'No rule with that id exists.');
  end if;

  if r.tenant_id is null then
    perform public.policy_refuse('GLOBAL_RULE_NOT_TENANT_VERIFIABLE',
      'A global rule binds every dealership, so a single dealership may not replace it.',
      'The platform supersedes a global rule with policy_platform_supersede_rule().');
  end if;

  if r.tenant_id <> ctx.tenant_id then
    perform public.policy_refuse('WRONG_TENANT', 'That rule belongs to another dealership.');
  end if;

  if r.jurisdiction_owner_kind <> 'TENANT' then
    perform public.policy_refuse('JURISDICTION_NOT_YOURS_TO_LEGISLATE',
      format('That rule is filed under %s, which is not this dealership''s namespace.', r.jurisdiction));
  end if;

  if r.status in ('SUPERSEDED','WITHDRAWN') then
    perform public.policy_refuse('RULE_IS_RETIRED',
      format('Version %s is already %s.', r.version, r.status),
      'Supersede the version that is current.');
  end if;

  if r.effective_from is not null and p_effective_from <= r.effective_from then
    perform public.policy_refuse('EFFECTIVE_FROM_NOT_AFTER_PREVIOUS',
      format('The new version must start after the one it replaces (%s started %s).',
             r.version, r.effective_from));
  end if;

  v_actor := coalesce(nullif(btrim(coalesce(ctx.staff_name,'')),''),
                      nullif(btrim(coalesce(auth.jwt() ->> 'email','')),''),
                      ctx.auth_user_id::text);

  -- Close the old version FIRST. Its evidence stays exactly as it was; only
  -- its end date and its lifecycle move, so a decision taken while it applied
  -- can still be re-derived from it.
  update public.policy_rule
     set effective_to = p_effective_from,
         status       = 'SUPERSEDED'
   where id = p_rule_id
     and tenant_id = ctx.tenant_id;

  insert into public.policy_rule (
    tenant_id, jurisdiction, jurisdiction_owner_kind, rule_type, rule_name,
    value_numeric, value_text, unit, value_kind,
    source_name, source_url, source_document,
    effective_from, notes,
    status, verification_status, confidence,
    version, supersedes_id, added_by, added_by_auth_user_id
  ) values (
    r.tenant_id, r.jurisdiction, r.jurisdiction_owner_kind, r.rule_type, r.rule_name,
    p_value_numeric, p_value_text, r.unit, r.value_kind,
    p_source_name, p_source_url, p_source_document,
    p_effective_from, p_notes,
    'DRAFT', 'NOT_VERIFIED', 'UNKNOWN',
    r.version + 1, r.id, v_actor, ctx.auth_user_id
  ) returning id into v_new;

  insert into public.policy_rule_event (rule_id, tenant_id, event, actor, actor_auth_user_id,
                                        from_status, to_status, detail)
  values (p_rule_id, ctx.tenant_id, 'SUPERSEDED', v_actor, ctx.auth_user_id,
          r.status, 'SUPERSEDED',
          format('Replaced by version %s from %s. This version stays readable: decisions taken while it '
                 'applied were correct under it.', r.version + 1, p_effective_from));

  insert into public.policy_rule_event (rule_id, tenant_id, event, actor, actor_auth_user_id,
                                        to_status, to_verification, detail)
  values (v_new, ctx.tenant_id, 'PROPOSED', v_actor, ctx.auth_user_id, 'DRAFT', 'NOT_VERIFIED',
          format('Version %s, superseding %s. Not authoritative until verified.', r.version + 1, p_rule_id));

  return query select v_new, r.version + 1, 'SUPERSEDED'::text;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.policy_verify_rule(p_rule_id uuid, p_source_name text DEFAULT NULL::text, p_source_url text DEFAULT NULL::text, p_source_document text DEFAULT NULL::text, p_effective_from date DEFAULT NULL::date, p_confidence text DEFAULT 'HIGH'::text, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(rule_id uuid, version integer, outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  ctx     record;
  r       public.policy_rule%rowtype;
  jur     record;
  v_actor text;
  v_from  date;
begin
  select * into ctx from public.action_approver_context();

  if not ctx.may_decide then
    perform public.policy_refuse(
      coalesce(ctx.refusal_code, 'NOT_AN_APPROVER'),
      coalesce(ctx.refusal_reason, 'This account may not verify a policy rule.'),
      'Verifying a rule is what allows its value to be quoted to a customer, so it is gated on the same '
      'approval authority as an inventory action (inventory_action_policy).');
  end if;

  select * into r from public.policy_rule where id = p_rule_id;
  if not found then
    perform public.policy_refuse('NO_SUCH_RULE', 'No rule with that id exists.');
  end if;

  -- A global rule binds every dealership. One dealership's manager cannot be
  -- the one who says it is true.
  if r.tenant_id is null then
    perform public.policy_refuse('GLOBAL_RULE_NOT_TENANT_VERIFIABLE',
      'This rule has no tenant, so it applies to every dealership on the platform. A single '
      'dealership''s approver may not verify it - that would let one customer''s staff change what '
      'every other customer''s system treats as law.',
      'Global rules are verified by the platform, with policy_platform_verify_rule(), by a named person '
      'holding the account the rule comes from. That path records who checked it, when, and against '
      'which source.');
  end if;

  if r.tenant_id <> ctx.tenant_id then
    perform public.policy_refuse('WRONG_TENANT', 'That rule belongs to another dealership.');
  end if;

  -- Belt and braces behind policy_rule_scope_follows_jurisdiction. While that
  -- CHECK stands this branch is unreachable, which is the point: if somebody
  -- drops the constraint, the jurisdiction guard does not disappear with it.
  select * into jur from public.policy_jurisdiction j where j.code = r.jurisdiction;
  if coalesce(r.jurisdiction_owner_kind, jur.owner_kind) <> 'TENANT' then
    perform public.policy_refuse('JURISDICTION_NOT_YOURS_TO_VERIFY',
      format('That rule is filed under %s, which is %s''s namespace. A dealership may verify its own '
             'house rules and nothing else.', r.jurisdiction, coalesce(jur.owner_name,'another party')),
      'Verify the dealership''s TENANT_HOUSE rule instead, or ask the platform operator to attest the '
      'platform rule with policy_platform_verify_rule().');
  end if;

  if r.verification_status = 'UNKNOWN' then
    perform public.policy_refuse('NO_VALUE_TO_VERIFY',
      'This rule states no value - it is registered as a question. There is nothing to verify.',
      'Supersede it with a version that states the value the source gives.');
  end if;

  if r.status in ('SUPERSEDED','WITHDRAWN') then
    perform public.policy_refuse('RULE_IS_RETIRED',
      format('This version is %s and is closed to further change.', r.status));
  end if;

  if r.verification_status = 'VERIFIED' then
    perform public.policy_refuse('ALREADY_VERIFIED',
      format('Already verified by %s on %s.', r.verified_by, r.verification_date),
      'Re-sourcing a verified rule means superseding it, not overwriting what was checked.');
  end if;

  v_from := coalesce(p_effective_from, r.effective_from);
  if v_from is null then
    perform public.policy_refuse('NO_EFFECTIVE_FROM',
      'A verified rule must say from when it applies, or no decision can ever be tied to it.');
  end if;

  -- effective_from is frozen once a version leaves DRAFT.
  if r.status <> 'DRAFT' and v_from is distinct from r.effective_from then
    perform public.policy_refuse('EFFECTIVE_FROM_IS_FROZEN',
      format('This version has been in force since %s and that date cannot move.', r.effective_from),
      format('Verify it as it stands (pass no p_effective_from, or %s), or supersede it with a version '
             'that starts on the new date.', r.effective_from));
  end if;

  if coalesce(p_confidence,'UNKNOWN') = 'UNKNOWN' then
    perform public.policy_refuse('NO_CONFIDENCE',
      'State HIGH, MEDIUM or LOW confidence. UNKNOWN confidence and VERIFIED are contradictory.');
  end if;

  v_actor := coalesce(nullif(btrim(coalesce(ctx.staff_name,'')),''),
                      nullif(btrim(coalesce(auth.jwt() ->> 'email','')),''),
                      ctx.auth_user_id::text);

  update public.policy_rule
     set source_name         = coalesce(p_source_name, source_name),
         source_url          = coalesce(p_source_url, source_url),
         source_document     = coalesce(p_source_document, source_document),
         effective_from      = v_from,
         verification_status = 'VERIFIED',
         status              = 'ACTIVE',
         verification_date   = (now() at time zone 'Asia/Dubai')::date,
         verified_by         = v_actor,
         verified_by_auth_user_id = ctx.auth_user_id,
         confidence          = p_confidence,
         notes               = coalesce(p_notes, notes)
   where id = p_rule_id
     and tenant_id = ctx.tenant_id;   -- tenant predicate readable at the statement

  insert into public.policy_rule_event (rule_id, tenant_id, event, actor, actor_auth_user_id,
                                        from_status, to_status, from_verification, to_verification, detail)
  values (p_rule_id, ctx.tenant_id, 'VERIFIED', v_actor, ctx.auth_user_id,
          r.status, 'ACTIVE', r.verification_status, 'VERIFIED',
          format('House rule checked against %s by a dealership approver. Authority: %s. This is the '
                 'dealership vouching for its own rule; it is not a platform attestation.',
                 coalesce(p_source_name, r.source_name, 'the recorded source'),
                 coalesce(ctx.authority, 'unstated')));

  return query select p_rule_id, r.version, 'VERIFIED'::text;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.policy_withdraw_rule(p_rule_id uuid, p_reason text)
 RETURNS TABLE(rule_id uuid, version integer, outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  ctx record; r public.policy_rule%rowtype; v_actor text;
begin
  select * into ctx from public.action_approver_context();

  if not ctx.may_decide then
    perform public.policy_refuse(
      coalesce(ctx.refusal_code,'NOT_AN_APPROVER'),
      coalesce(ctx.refusal_reason,'This account may not withdraw a policy rule.'));
  end if;

  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    perform public.policy_refuse('NO_REASON',
      'Withdrawing a rule removes it from every consumer. Say why, so the next reader knows.');
  end if;

  select * into r from public.policy_rule where id = p_rule_id;
  if not found then
    perform public.policy_refuse('NO_SUCH_RULE', 'No rule with that id exists.');
  end if;

  if r.tenant_id is distinct from ctx.tenant_id then
    perform public.policy_refuse(
      case when r.tenant_id is null then 'GLOBAL_RULE_NOT_TENANT_VERIFIABLE' else 'WRONG_TENANT' end,
      'This rule is not this dealership''s to withdraw.');
  end if;

  if r.status in ('SUPERSEDED','WITHDRAWN') then
    perform public.policy_refuse('RULE_IS_RETIRED',
      format('Version %s is already %s.', r.version, r.status));
  end if;

  v_actor := coalesce(nullif(btrim(coalesce(ctx.staff_name,'')),''),
                      nullif(btrim(coalesce(auth.jwt() ->> 'email','')),''),
                      ctx.auth_user_id::text);

  update public.policy_rule set status = 'WITHDRAWN'
   where id = p_rule_id and tenant_id = ctx.tenant_id;

  insert into public.policy_rule_event (rule_id, tenant_id, event, actor, actor_auth_user_id,
                                        from_status, to_status, detail)
  values (p_rule_id, ctx.tenant_id, 'WITHDRAWN', v_actor, ctx.auth_user_id, r.status, 'WITHDRAWN', p_reason);

  return query select p_rule_id, r.version, 'WITHDRAWN'::text;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.recompute_inventory_derived()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  touched      integer;
  today_dubai  date := (now() at time zone 'Asia/Dubai')::date;
  -- PostgREST issues SET LOCAL ROLE before the call, and that setting survives
  -- entry into a SECURITY DEFINER function even though current_user does not.
  v_caller     text := coalesce(nullif(current_setting('role', true), ''), current_user::text);
  -- null means "sweep every dealership"; non-null means "this one only".
  v_scope      uuid;
begin
  if v_caller in ('authenticated', 'anon') or auth.uid() is not null then
    v_scope := public.nexus_current_tenant_id();
    if v_scope is null then
      -- A signed-in account that belongs to no dealership. It owns no rows, so
      -- it recomputes none. Returning zero is the honest answer; raising would
      -- only teach the dashboard to swallow it.
      return 0;
    end if;
  end if;

  update public.inventory i
  set days_in_stock          = d.days_in_stock,
      gross_margin           = d.gross_margin,
      vat_amount             = d.vat_amount,
      holding_cost_accrued   = d.holding_cost_accrued,
      net_margin             = d.net_margin,
      recommended_commission = d.recommended_commission,
      aging_alert            = d.aging_alert
  from (
    select b.tenant_id,
           b.id,
           b.days_in_stock,
           b.gross_margin,
           round(b.price * 0.05) as vat_amount,

           -- Holding cost stops accruing once a unit is marked Sold: the figure
           -- frozen at that moment is the record of what it actually cost to
           -- keep. A dealership that has never stated a rate gets NULL, which
           -- means UNKNOWN and never zero.
           case when b.sold then b.frozen_holding
                when b.rate is null then null
                else round(b.days_in_stock * b.rate) end as holding_cost_accrued,

           case when b.sold then
                  case when b.frozen_holding is null then null
                       else b.gross_margin - b.frozen_holding end
                when b.rate is null then null      -- gross is known, net is not
                else b.gross_margin - round(b.days_in_stock * b.rate) end as net_margin,

           case when b.sold then
                  case when b.frozen_holding is null then null
                       else round((b.gross_margin - b.frozen_holding) * 0.05) end
                when b.rate is null then null
                else round((b.gross_margin - round(b.days_in_stock * b.rate)) * 0.05) end
             as recommended_commission,

           case when b.sold                        then 'HEALTHY'
                when b.days_in_stock >= b.crit_days then 'CRITICAL'
                when b.days_in_stock >= b.warn_days then 'WARNING'
                else 'HEALTHY' end as aging_alert
      from (
        select inv.tenant_id,
               inv.id,
               greatest(0, today_dubai - inv.acquired_at)             as days_in_stock,
               coalesce(inv.price_aed, 0)                             as price,
               coalesce(inv.price_aed, 0) - coalesce(inv.cost_aed, 0) as gross_margin,
               lower(coalesce(inv.status, '')) = 'sold'               as sold,
               inv.holding_cost_accrued                               as frozen_holding,
               s.holding_cost_per_day_aed                             as rate,
               coalesce(s.aging_warn_days, 90)                        as warn_days,
               coalesce(s.aging_critical_days, 120)                   as crit_days
          from public.inventory inv
          -- The settings row is joined on tenant_id, so a dealership can only
          -- ever be measured against its own holding rate and its own bands.
          left join public.inventory_profit_settings s on s.tenant_id = inv.tenant_id
         where inv.acquired_at is not null
           and (v_scope is null or inv.tenant_id = v_scope)
      ) b
  ) d
  where i.tenant_id = d.tenant_id
    and i.id        = d.id
    and (v_scope is null or i.tenant_id = v_scope);

  get diagnostics touched = row_count;
  return touched;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.search_rag_documents(q text, match_limit integer DEFAULT 6)
 RETURNS TABLE(id integer, doc_title text, section text, content text, source_file text, page_number integer, rank real, match_type text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select * from public.search_rag_documents(q, match_limit, public.nexus_scoped_tenant_id());
$function$
;

CREATE OR REPLACE FUNCTION public.search_rag_documents(q text, match_limit integer, p_tenant uuid)
 RETURNS TABLE(id integer, doc_title text, section text, content text, source_file text, page_number integer, rank real, match_type text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  cleaned text; terms text[]; tq tsquery; v_tenant uuid := p_tenant;
begin
  -- SECURITY INVOKER on purpose: an authenticated caller naming someone else's
  -- tenant still gets nothing, because rag_documents RLS applies to them.
  -- service_role is BYPASSRLS, so for n8n this argument IS the whole boundary.
  if v_tenant is null and (select count(*) from public.tenants where status='active') > 1 then
    return;   -- cannot tell whose knowledge base this is: answer nothing
  end if;

  cleaned := btrim(regexp_replace(lower(coalesce(q,'')), '[^a-z0-9\s]', ' ', 'g'));
  cleaned := btrim(regexp_replace(cleaned, '\s+', ' ', 'g'));
  if length(cleaned) < 3 then return; end if;

  tq := websearch_to_tsquery('english', cleaned);
  if tq is not null and numnode(tq) > 0 then
    return query
      select d.id, d.doc_title, d.section, d.content, d.source_file, d.page_number,
             ts_rank_cd(d.search_vector, tq)::real, 'fts_all'::text
        from public.rag_documents d
       where d.search_vector @@ tq
         and (v_tenant is null or d.tenant_id = v_tenant)
       order by ts_rank_cd(d.search_vector, tq) desc, d.id
       limit match_limit;
    if found then return; end if;
  end if;

  select array_agg(distinct t) into terms
    from unnest(string_to_array(cleaned,' ')) as t where length(t) > 2;

  if terms is not null and array_length(terms,1) > 0 then
    tq := to_tsquery('english', array_to_string(terms,' | '));
    if tq is not null and numnode(tq) > 0 then
      return query
        select d.id, d.doc_title, d.section, d.content, d.source_file, d.page_number,
               ts_rank_cd(d.search_vector, tq)::real, 'fts_any'::text
          from public.rag_documents d
         where d.search_vector @@ tq
           and (v_tenant is null or d.tenant_id = v_tenant)
         order by ts_rank_cd(d.search_vector, tq) desc, d.id
         limit match_limit;
      if found then return; end if;
    end if;
  end if;

  if terms is null or array_length(terms,1) is null then return; end if;

  return query
    with scored as (
      select d.id as did, sum(s.sim) as total, count(*) as matched_terms
        from public.rag_documents d
        cross join lateral (
          select word_similarity(t, coalesce(d.doc_title,'')||' '||coalesce(d.section,'')||' '||coalesce(d.content,'')) as sim
            from unnest(terms) as t where length(t) >= 4
        ) s
       where s.sim > 0.5
         and (v_tenant is null or d.tenant_id = v_tenant)
       group by d.id
    )
    select d.id, d.doc_title, d.section, d.content, d.source_file, d.page_number,
           (sc.total / greatest(array_length(terms,1),1))::real, 'trigram'::text
      from scored sc join public.rag_documents d on d.id = sc.did
     order by sc.matched_terms desc, sc.total desc, d.id
     limit match_limit;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tenant_capability_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin new.updated_at := now(); return new; end;
$function$
;

CREATE OR REPLACE FUNCTION public.tenant_configuration_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  if new.timezone is not null
     and not exists (select 1 from pg_timezone_names z where z.name = new.timezone) then
    raise exception 'tenant_configuration.timezone % is not an IANA zone this server knows', new.timezone
      using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_apply_delivery_to_usage(p_delivery_event_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare d public.whatsapp_delivery_events%rowtype; u public.whatsapp_message_usage%rowtype;
begin
  select * into d from public.whatsapp_delivery_events where delivery_event_id = p_delivery_event_id;
  if d.delivery_event_id is null or d.event_id is null then return false; end if;

  select * into u from public.whatsapp_message_usage
   where tenant_id = d.tenant_id and event_id = d.event_id;
  if u.usage_id is null then return false; end if;

  update public.whatsapp_message_usage m set
    latest_status = case when public.whatsapp_delivery_status_rank(d.status)
                            > public.whatsapp_delivery_status_rank(m.latest_status)
                         then d.status else m.latest_status end,
    latest_status_at = case when public.whatsapp_delivery_status_rank(d.status)
                               > public.whatsapp_delivery_status_rank(m.latest_status)
                            then d.status_at else m.latest_status_at end,
    latest_status_delivery_event_id = case when public.whatsapp_delivery_status_rank(d.status)
                                              > public.whatsapp_delivery_status_rank(m.latest_status)
                                           then d.delivery_event_id else m.latest_status_delivery_event_id end,

    -- Billing facts: the FIRST callback that carries a pricing object wins, and
    -- nothing overwrites it. AWAITING -> NO_PRICING -> REPORTED only ever moves
    -- forward, so a later callback without pricing cannot erase one with it.
    billing_fact_state = case
      when m.billing_fact_state = 'PROVIDER_REPORTED' then m.billing_fact_state
      when d.pricing_reported then 'PROVIDER_REPORTED'
      else 'PROVIDER_REPORTED_NO_PRICING' end,
    provider_billable = case when m.billing_fact_state <> 'PROVIDER_REPORTED' and d.pricing_reported
                             then d.pricing_billable else m.provider_billable end,
    provider_pricing_model = case when m.billing_fact_state <> 'PROVIDER_REPORTED' and d.pricing_reported
                                  then d.pricing_model else m.provider_pricing_model end,
    provider_pricing_category = case when m.billing_fact_state <> 'PROVIDER_REPORTED' and d.pricing_reported
                                     then d.pricing_category else m.provider_pricing_category end,
    provider_pricing_type = case when m.billing_fact_state <> 'PROVIDER_REPORTED' and d.pricing_reported
                                 then d.pricing_type else m.provider_pricing_type end,
    provider_conversation_id = case when m.billing_fact_state <> 'PROVIDER_REPORTED' and d.pricing_reported
                                    then d.conversation_id else m.provider_conversation_id end,
    provider_conversation_origin_type = case when m.billing_fact_state <> 'PROVIDER_REPORTED' and d.pricing_reported
                                             then d.conversation_origin_type else m.provider_conversation_origin_type end,
    provider_conversation_expiration_at = case when m.billing_fact_state <> 'PROVIDER_REPORTED' and d.pricing_reported
                                               then d.conversation_expiration_at else m.provider_conversation_expiration_at end,
    provider_pricing_observed_at = case when m.billing_fact_state = 'PROVIDER_REPORTED'
                                        then m.provider_pricing_observed_at else d.received_at end,
    provider_pricing_delivery_event_id = case when m.billing_fact_state = 'PROVIDER_REPORTED'
                                              then m.provider_pricing_delivery_event_id else d.delivery_event_id end
  where m.usage_id = u.usage_id;

  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_delivery_events_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception
      'whatsapp_delivery_events is append-only: a provider-reported delivery fact is never deleted. It is the evidence behind what messaging cost.'
      using errcode = '42501';
  end if;

  if old.event_id is not null then
    raise exception
      'whatsapp_delivery_events %: already linked to event %. Re-pointing a callback at a different message would move a billing fact between messages.',
      old.delivery_event_id, old.event_id using errcode = '42501';
  end if;

  if new.event_id is null then
    raise exception
      'whatsapp_delivery_events %: the only permitted update is linking an unlinked callback to its outbound event.',
      old.delivery_event_id using errcode = '42501';
  end if;

  if (new.tenant_id, new.integration_id, new.provider, new.provider_message_id,
      new.status, new.status_raw, new.status_at, new.recipient_wa_id,
      new.conversation_id, new.conversation_origin_type, new.conversation_expiration_at,
      new.pricing_billable, new.pricing_model, new.pricing_category, new.pricing_type,
      new.errors, new.provider_payload, new.received_at, new.recorded_at)
     is distinct from
     (old.tenant_id, old.integration_id, old.provider, old.provider_message_id,
      old.status, old.status_raw, old.status_at, old.recipient_wa_id,
      old.conversation_id, old.conversation_origin_type, old.conversation_expiration_at,
      old.pricing_billable, old.pricing_model, old.pricing_category, old.pricing_type,
      old.errors, old.provider_payload, old.received_at, old.recorded_at) then
    raise exception
      'whatsapp_delivery_events %: linking may set event_id, link_state and linked_at and nothing else. What the provider reported does not change because NEXUS later worked out which message it was about.',
      old.delivery_event_id using errcode = '42501';
  end if;

  new.linked_at := coalesce(new.linked_at, now());
  new.link_state := 'LINKED';
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_delivery_events_guard_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_tenant uuid; v_dir text; v_ext text; v_integration uuid;
begin
  if new.event_id is null then
    return new;
  end if;

  select e.tenant_id, e.direction, e.external_message_id, e.integration_id
    into v_tenant, v_dir, v_ext, v_integration
    from public.channel_message_events e
   where e.event_id = new.event_id;

  if v_tenant is distinct from new.tenant_id then
    raise exception
      'whatsapp_delivery_events: event % belongs to dealership %, not %. A status callback may only be linked to a message the same dealership sent.',
      new.event_id, v_tenant, new.tenant_id using errcode = '42501';
  end if;
  if v_dir <> 'outbound' then
    raise exception
      'whatsapp_delivery_events: event % is direction %, not outbound. Delivery statuses describe messages NEXUS sent.',
      new.event_id, v_dir using errcode = '22023';
  end if;
  if v_ext is distinct from new.provider_message_id then
    raise exception
      'whatsapp_delivery_events: event % carries external_message_id %, but this callback is about %. Linking them would attribute one message''s delivery and billing to another.',
      new.event_id, coalesce(v_ext,'(null)'), new.provider_message_id using errcode = '22023';
  end if;
  if v_integration is distinct from new.integration_id then
    raise exception
      'whatsapp_delivery_events: event % was sent through integration %, but this callback arrived on %.',
      new.event_id, v_integration, new.integration_id using errcode = '22023';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_delivery_status_rank(p_status text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select case lower(coalesce(p_status,''))
           when 'failed'    then 90   -- terminal; nothing supersedes it
           when 'read'      then 30
           when 'played'    then 30
           when 'delivered' then 20
           when 'sent'      then 10
           else 0                     -- unmapped / unknown never supersedes
         end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_link_delivery_events(p_integration_id uuid, p_limit integer DEFAULT 500)
 RETURNS TABLE(linked integer, applied integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare rec record; v_linked integer := 0; v_applied integer := 0;
begin
  perform public.whatsapp_refuse_end_user_role('whatsapp_link_delivery_events');

  for rec in
    select d.delivery_event_id, e.event_id
      from public.whatsapp_delivery_events d
      join public.channel_message_events e
        on e.tenant_id = d.tenant_id
       and e.direction = 'outbound'
       and e.external_message_id = d.provider_message_id
     where d.integration_id = p_integration_id
       and d.link_state = 'UNLINKED_NO_OUTBOUND_EVENT'
     order by d.recorded_at
     limit greatest(coalesce(p_limit,500), 1)
  loop
    update public.whatsapp_delivery_events
       set event_id = rec.event_id, link_state = 'LINKED', linked_at = now()
     where delivery_event_id = rec.delivery_event_id;
    v_linked := v_linked + 1;
    if public.whatsapp_apply_delivery_to_usage(rec.delivery_event_id) then
      v_applied := v_applied + 1;
    end if;
  end loop;

  return query select v_linked, v_applied;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_message_usage_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_opt_in_event_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  raise exception using
    errcode = '0A000',
    message = 'whatsapp_opt_in_event is append-only; consent history may not be rewritten.',
    hint    = 'To withdraw consent insert an OPT_OUT event. To correct a mistaken row insert a correcting event and explain it in notes. Deleting the evidence that a customer opted out is the failure this table exists to prevent.';
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_policy_decision(p_tenant_id uuid, p_integration_id uuid, p_customer_wa_id text, p_intent text, p_as_of timestamp with time zone DEFAULT now())
 RETURNS SETOF whatsapp_policy_decision_row
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_now       timestamptz := coalesce(p_as_of, now());
  v_cust      text := lower(btrim(coalesce(p_customer_wa_id,'')));
  v_intent    text := upper(btrim(coalesce(p_intent,'')));
  v_biz       boolean;
  v_tmplcat   text;

  v_win       record;   -- PLATFORM_WHATSAPP  WA_CUSTOMER_SERVICE_WINDOW_HOURS
  v_house_win record;   -- TENANT_HOUSE       WA_CUSTOMER_SERVICE_WINDOW_HOURS
  v_tmpl      record;   -- WA_BUSINESS_INITIATED_OUTSIDE_WINDOW_REQUIRES_TEMPLATE
  v_optin     record;   -- WA_MARKETING_TEMPLATE_REQUIRES_OPT_IN
  v_house     record;   -- NEXUS_HOUSE marketing-inside-window rule
  v_err       record;   -- WA_FREEFORM_OUTSIDE_WINDOW_ERROR_CODE
  v_conv      record;
  v_opt       record;

  v_hours     numeric;  -- the window duration actually applied
  v_hsrc      text := 'PLATFORM';
  v_hnote     text := '';

  v_wstate    text := 'UNKNOWN';
  v_expiry    timestamptz;
  v_lastmsg   timestamptz;
  v_wevid     text;
  v_optstate  text := 'OPT_IN_UNKNOWN';
  v_optevid   text := 'No opt-in and no opt-out has ever been recorded for this conversation.';

  v_dec       text;
  v_rcode     text;
  v_reason    text;
  v_change    text;
  v_rid       uuid;
  v_rname     text;
  v_rjur      text;
  v_rauth     text;
  v_rver      text;
  v_rsrc      text;
  v_rules     jsonb := '[]'::jsonb;
  v_by        text := 'whatsapp_policy_decision v2 - deterministic SQL, no language model in the path';

begin
  ------------------------------------------------------------------
  -- 0. Who is asking, and on whose channel.
  ------------------------------------------------------------------
  if p_tenant_id is null
     or not exists (select 1 from public.tenants t where t.id = p_tenant_id and t.status = 'active') then
    return query select
      'BLOCKED'::text, 'TENANT_UNRESOLVED'::text,
      'No active dealership resolves from the tenant supplied, so there is nobody on whose behalf this message could be sent.'::text,
      'Resolve the tenant from a trusted integration identity (nexus_resolve_channel_tenant on the channel the message arrived through) before asking for a decision. A caller-supplied tenant that matches no active row is refused, not defaulted.'::text,
      'UNKNOWN'::text, null::timestamptz, null::timestamptz, null::text, null::numeric,
      'OPT_IN_UNKNOWN'::text, 'Not evaluated - the tenant did not resolve.'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::text,
      '[]'::jsonb, v_intent, null::boolean, null::text,
      p_tenant_id, p_integration_id, v_cust, v_now, v_by;
    return;
  end if;

  if p_integration_id is null
     or not exists (select 1 from public.channel_registry cr
                     where cr.integration_id = p_integration_id
                       and cr.tenant_id = p_tenant_id
                       and cr.status = 'active') then
    return query select
      'BLOCKED'::text, 'CHANNEL_NOT_REGISTERED_TO_TENANT'::text,
      'The channel this message would leave through is not an active registered channel of that dealership. Sending would put one dealership''s message on another''s number, or on a number NEXUS does not control.'::text,
      'Register the channel in channel_registry against this tenant with status active, or send through a channel that already is.'::text,
      'UNKNOWN'::text, null::timestamptz, null::timestamptz, null::text, null::numeric,
      'OPT_IN_UNKNOWN'::text, 'Not evaluated - the channel did not resolve.'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::text,
      '[]'::jsonb, v_intent, null::boolean, null::text,
      p_tenant_id, p_integration_id, v_cust, v_now, v_by;
    return;
  end if;

  if v_cust = '' then
    return query select
      'BLOCKED'::text, 'CUSTOMER_IDENTITY_MISSING'::text,
      'No customer WhatsApp identity was supplied, so there is no conversation to decide about.'::text,
      'Supply the customer''s WhatsApp identity exactly as the platform reports it.'::text,
      'UNKNOWN'::text, null::timestamptz, null::timestamptz, null::text, null::numeric,
      'OPT_IN_UNKNOWN'::text, 'Not evaluated - no customer identity.'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::text,
      '[]'::jsonb, v_intent, null::boolean, null::text,
      p_tenant_id, p_integration_id, null::text, v_now, v_by;
    return;
  end if;

  ------------------------------------------------------------------
  -- 1. What is being sent.
  ------------------------------------------------------------------
  select m.is_business_initiated, m.template_category_if_required
    into v_biz, v_tmplcat
    from public.whatsapp_message_intent m
   where m.code = v_intent;

  if not found then
    return query select
      'BLOCKED'::text, 'INTENT_CATEGORY_UNKNOWN'::text,
      format('%L is not a message intent NEXUS recognises, so no rule can be applied to it.',
             coalesce(nullif(v_intent,''),'(empty)'))::text,
      'Call again with one of the codes in whatsapp_message_intent. An unrecognised intent is refused rather than guessed, because guessing it is how a marketing blast gets sent as a service reply.'::text,
      'UNKNOWN'::text, null::timestamptz, null::timestamptz, null::text, null::numeric,
      'OPT_IN_UNKNOWN'::text, 'Not evaluated - the intent was not recognised.'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::text,
      '[]'::jsonb, v_intent, null::boolean, null::text,
      p_tenant_id, p_integration_id, v_cust, v_now, v_by;
    return;
  end if;

  ------------------------------------------------------------------
  -- 2. The rules, as data.
  ------------------------------------------------------------------
  select l.* into v_win from (select 1) s
    left join lateral public.whatsapp_policy_rule_lookup(p_tenant_id,'PLATFORM_WHATSAPP','WA_CUSTOMER_SERVICE_WINDOW_HOURS') l on true;
  select l.* into v_house_win from (select 1) s
    left join lateral public.whatsapp_policy_rule_lookup(p_tenant_id,'TENANT_HOUSE','WA_CUSTOMER_SERVICE_WINDOW_HOURS') l on true;
  select l.* into v_tmpl from (select 1) s
    left join lateral public.whatsapp_policy_rule_lookup(p_tenant_id,'PLATFORM_WHATSAPP','WA_BUSINESS_INITIATED_OUTSIDE_WINDOW_REQUIRES_TEMPLATE') l on true;
  select l.* into v_optin from (select 1) s
    left join lateral public.whatsapp_policy_rule_lookup(p_tenant_id,'PLATFORM_WHATSAPP','WA_MARKETING_TEMPLATE_REQUIRES_OPT_IN') l on true;
  select l.* into v_house from (select 1) s
    left join lateral public.whatsapp_policy_rule_lookup(p_tenant_id,'NEXUS_HOUSE','WA_MARKETING_REQUIRES_OPT_IN_EVEN_INSIDE_WINDOW') l on true;
  select l.* into v_err from (select 1) s
    left join lateral public.whatsapp_policy_rule_lookup(p_tenant_id,'PLATFORM_WHATSAPP','WA_FREEFORM_OUTSIDE_WINDOW_ERROR_CODE') l on true;

  ------------------------------------------------------------------
  -- 2b. A dealership house rule may TIGHTEN the platform window and may not
  --     loosen it. This is the only direction in which a tenant rule is
  --     allowed to move a platform number, and it is applied here rather than
  --     in the lookup so that both rules stay visible in rules_considered.
  ------------------------------------------------------------------
  v_hours := v_win.value_numeric;

  if v_house_win.rule_id is not null and v_house_win.value_numeric is not null then
    if v_house_win.authority <> 'AUTHORITATIVE' then
      v_hnote := format(' This dealership holds a house window rule of %s hours, but it is %s, so it was '
                        'not applied: an unverified house rule does not shorten the window either.',
                        trim(to_char(v_house_win.value_numeric,'FM999990.99')), v_house_win.authority);
    elsif v_win.value_numeric is null then
      v_hnote := ' This dealership holds a house window rule, but the platform rule states no value to '
                 'tighten, so there is nothing to apply it to.';
    elsif v_house_win.value_numeric < v_win.value_numeric then
      v_hours := v_house_win.value_numeric;
      v_hsrc  := 'TENANT_HOUSE';
      v_hnote := format(' The dealership''s own house rule (%s, %s hours) is stricter than the platform''s '
                        '%s hours and governs the duration. A house rule may only shorten this window.',
                        v_house_win.rule_id, trim(to_char(v_house_win.value_numeric,'FM999990.99')),
                        trim(to_char(v_win.value_numeric,'FM999990.99')));
    else
      v_hnote := format(' The dealership holds a house window rule of %s hours, which is not shorter than '
                        'the platform''s %s, so it was ignored. A house rule may tighten a platform rule '
                        'and can never extend it.',
                        trim(to_char(v_house_win.value_numeric,'FM999990.99')),
                        trim(to_char(v_win.value_numeric,'FM999990.99')));
    end if;
  end if;

  v_rules := jsonb_build_array(
    jsonb_build_object('asked','WA_CUSTOMER_SERVICE_WINDOW_HOURS','rule_id',v_win.rule_id,'jurisdiction',v_win.jurisdiction,
                       'value',v_win.value_numeric,'unit',v_win.unit,'status',v_win.status,
                       'verification_status',v_win.verification_status,'authority',v_win.authority,'source',v_win.source_name),
    jsonb_build_object('asked','TENANT_HOUSE/WA_CUSTOMER_SERVICE_WINDOW_HOURS','rule_id',v_house_win.rule_id,'jurisdiction',v_house_win.jurisdiction,
                       'value',v_house_win.value_numeric,'unit',v_house_win.unit,'status',v_house_win.status,
                       'verification_status',v_house_win.verification_status,'authority',v_house_win.authority,'source',v_house_win.source_name,
                       'applied', (v_hsrc = 'TENANT_HOUSE'),
                       'note','A tenant house rule may only shorten the platform window, never extend it.'),
    jsonb_build_object('asked','WA_BUSINESS_INITIATED_OUTSIDE_WINDOW_REQUIRES_TEMPLATE','rule_id',v_tmpl.rule_id,'jurisdiction',v_tmpl.jurisdiction,
                       'value',v_tmpl.value_text,'unit',v_tmpl.unit,'status',v_tmpl.status,
                       'verification_status',v_tmpl.verification_status,'authority',v_tmpl.authority,'source',v_tmpl.source_name),
    jsonb_build_object('asked','WA_MARKETING_TEMPLATE_REQUIRES_OPT_IN','rule_id',v_optin.rule_id,'jurisdiction',v_optin.jurisdiction,
                       'value',v_optin.value_text,'unit',v_optin.unit,'status',v_optin.status,
                       'verification_status',v_optin.verification_status,'authority',v_optin.authority,'source',v_optin.source_name),
    jsonb_build_object('asked','WA_MARKETING_REQUIRES_OPT_IN_EVEN_INSIDE_WINDOW','rule_id',v_house.rule_id,'jurisdiction',v_house.jurisdiction,
                       'value',v_house.value_text,'unit',v_house.unit,'status',v_house.status,
                       'verification_status',v_house.verification_status,'authority',v_house.authority,'source',v_house.source_name),
    jsonb_build_object('asked','WA_FREEFORM_OUTSIDE_WINDOW_ERROR_CODE','rule_id',v_err.rule_id,'jurisdiction',v_err.jurisdiction,
                       'value',v_err.value_numeric,'unit',v_err.unit,'status',v_err.status,
                       'verification_status',v_err.verification_status,'authority',v_err.authority,'source',v_err.source_name)
  );

  ------------------------------------------------------------------
  -- 3. Measured conversation state. The window is DERIVED here and
  --    nowhere else, from the rule value - never from a literal.
  ------------------------------------------------------------------
  select c.last_customer_message_at, c.last_customer_message_external_id, c.last_customer_message_source
    into v_conv
    from public.whatsapp_conversation_state c
   where c.tenant_id = p_tenant_id
     and c.integration_id = p_integration_id
     and c.customer_wa_id = v_cust;

  if not found then
    v_wstate := 'UNKNOWN';
    v_wevid  := 'NEXUS has never observed this conversation. No row exists in whatsapp_conversation_state, which is unknown - not "the window is closed" and certainly not "the window is open".';
  elsif v_conv.last_customer_message_at is null then
    v_wstate := 'UNKNOWN';
    v_wevid  := 'The conversation is on record but no inbound customer message has ever been measured on it, so no window has ever been opened that NEXUS can see.';
  elsif v_win.rule_id is null or v_hours is null then
    v_wstate := 'UNKNOWN';
    v_lastmsg := v_conv.last_customer_message_at;
    v_wevid  := 'An inbound message is on record, but the window duration rule is missing or carries no value, so no expiry can be computed. The duration is not hard-coded anywhere in this engine.';
  else
    v_lastmsg := v_conv.last_customer_message_at;
    v_expiry  := v_conv.last_customer_message_at + (v_hours * interval '1 hour');
    v_wstate  := case when v_now < v_expiry then 'OPEN' else 'CLOSED' end;
    v_wevid   := format('Inbound message at %s (source: %s, id: %s) plus %s %s from rule %s (%s).%s',
                        to_char(v_conv.last_customer_message_at at time zone 'Asia/Dubai','DD Mon YYYY HH24:MI') || ' Asia/Dubai',
                        coalesce(v_conv.last_customer_message_source,'unrecorded'),
                        coalesce(v_conv.last_customer_message_external_id,'unrecorded'),
                        trim(to_char(v_hours,'FM999990.99')), lower(coalesce(v_win.unit,'hours')),
                        case when v_hsrc = 'TENANT_HOUSE' then v_house_win.rule_id else v_win.rule_id end,
                        v_hsrc, v_hnote);
  end if;

  ------------------------------------------------------------------
  -- 4. Opt-in, derived from the latest recorded fact.
  ------------------------------------------------------------------
  select e.event, e.occurred_at, e.mechanism, e.evidence_kind, e.evidence_ref, e.recorded_by
    into v_opt
    from public.whatsapp_opt_in_event e
   where e.tenant_id = p_tenant_id
     and e.integration_id = p_integration_id
     and e.customer_wa_id = v_cust
   order by e.occurred_at desc, e.recorded_at desc
   limit 1;

  if found then
    v_optstate := case when v_opt.event = 'OPT_IN' then 'OPTED_IN' else 'OPTED_OUT' end;
    v_optevid  := format('%s recorded %s via %s, evidenced by %s %s, entered by %s.',
                         v_opt.event,
                         to_char(v_opt.occurred_at at time zone 'Asia/Dubai','DD Mon YYYY HH24:MI') || ' Asia/Dubai',
                         v_opt.mechanism, v_opt.evidence_kind, v_opt.evidence_ref, v_opt.recorded_by);
  end if;

  ------------------------------------------------------------------
  -- 5. The ladder. Restrictions are applied whether or not their rule is
  --    verified; permissions are not. Dropping a restriction because
  --    nobody has verified it is the unsafe direction.
  ------------------------------------------------------------------

  -- 5a. A withdrawn consent stops every business-initiated message; it stops
  --     a "service reply" too when there is no open window to reply into (a
  --     reply to nothing is a business-initiated message), AND when the
  --     opt-out is the most recent thing the customer did. Measured 4 Sep in
  --     a rolled-back probe: without that last clause a customer whose latest
  --     message was STOP got a free-form reply, because the STOP itself had
  --     opened the window. The last word the customer said governs.
  if v_optstate = 'OPTED_OUT'
     and (v_biz
          or v_wstate <> 'OPEN'
          or v_lastmsg is null
          or v_opt.occurred_at >= v_lastmsg) then
    v_dec := 'BLOCKED'; v_rcode := 'CUSTOMER_OPTED_OUT';
    v_reason := 'This customer has withdrawn consent on this channel. ' || v_optevid;
    v_change := 'Only the customer can change this, by opting in again or by messaging the dealership after the opt-out. Record that as a new whatsapp_opt_in_event, or as a measured inbound message, with its evidence. Nothing inside NEXUS may clear an opt-out.';
    v_rid := coalesce(v_optin.rule_id, v_house.rule_id); v_rname := coalesce(v_optin.rule_name, v_house.rule_name);
    v_rjur := coalesce(v_optin.jurisdiction, v_house.jurisdiction); v_rauth := coalesce(v_optin.authority, v_house.authority);
    v_rver := coalesce(v_optin.verification_status, v_house.verification_status); v_rsrc := coalesce(v_optin.source_name, v_house.source_name);

  -- 5b. Marketing without evidenced opt-in. OPT_IN_UNKNOWN is not permission.
  elsif v_intent = 'MARKETING' and v_optstate <> 'OPTED_IN' then
    v_dec := 'BLOCKED'; v_rcode := 'OPT_IN_NOT_EVIDENCED';
    v_reason := 'Marketing requires an opt-in NEXUS can evidence, and there is none on file for this conversation. ' || v_optevid
             || case when v_wstate = 'OPEN'
                     then ' The service window is open, which would permit a free-form message of another kind, but not this one.'
                     else '' end;
    v_change := 'Record a whatsapp_opt_in_event of OPT_IN with its mechanism and an evidence reference - a form submission, a signed document, a source-system record, or the customer''s own message. Absence of evidence is treated as absence of consent and always will be.';
    if v_wstate = 'OPEN' and v_house.rule_id is not null then
      v_rid := v_house.rule_id; v_rname := v_house.rule_name; v_rjur := v_house.jurisdiction;
      v_rauth := v_house.authority; v_rver := v_house.verification_status; v_rsrc := v_house.source_name;
    else
      v_rid := v_optin.rule_id; v_rname := v_optin.rule_name; v_rjur := v_optin.jurisdiction;
      v_rauth := v_optin.authority; v_rver := v_optin.verification_status; v_rsrc := v_optin.source_name;
    end if;
    if v_rid is null then
      v_rcode := 'OPT_IN_NOT_EVIDENCED_AND_NO_RULE_ON_FILE';
      v_reason := v_reason || ' No opt-in rule row could be found either; the absence of a rule is not permission, so this is still refused.';
    end if;

  -- 5c. No window-duration rule, or a rule with no value. Nothing to
  --     compute a window from, so no free-form permission can exist.
  elsif v_win.rule_id is null then
    v_dec := 'TEMPLATE_REQUIRED'; v_rcode := 'POLICY_RULE_MISSING';
    v_reason := 'The rule that defines the customer service window (PLATFORM_WHATSAPP / MESSAGING / WA_CUSTOMER_SERVICE_WINDOW_HOURS) is not on file, so NEXUS cannot establish that any window is open. It will not assume one.'
             || case when v_house_win.rule_id is not null
                     then ' The dealership''s own house rule cannot stand in for it: a house rule shortens the platform''s window, it does not create one.'
                     else '' end;
    v_change := 'Add the rule to policy_rule with its source. There is deliberately no fallback constant in this engine to fall back to.';
    v_rid := null; v_rname := 'WA_CUSTOMER_SERVICE_WINDOW_HOURS'; v_rjur := 'PLATFORM_WHATSAPP';
    v_rauth := 'ABSENT'; v_rver := 'ABSENT'; v_rsrc := null;

  elsif v_win.value_numeric is null then
    v_dec := 'TEMPLATE_REQUIRED'; v_rcode := 'POLICY_RULE_HAS_NO_VALUE';
    v_reason := 'The customer service window rule exists but states no value - it is registered as a question, not an answer - so no window can be computed.';
    v_change := 'Give the rule a value and a source, then have the platform attest it with policy_platform_verify_rule(). Until then every message on this channel must be a pre-approved template.';
    v_rid := v_win.rule_id; v_rname := v_win.rule_name; v_rjur := v_win.jurisdiction;
    v_rauth := v_win.authority; v_rver := v_win.verification_status; v_rsrc := v_win.source_name;

  -- 5d. Window open, and the rule that says so may be relied on. Note the
  --     authority tested is the PLATFORM rule's: a tenant house rule can
  --     shorten the window but can never be the thing that grants free-form
  --     permission in the first place.
  elsif v_wstate = 'OPEN' and v_win.authority = 'AUTHORITATIVE' then
    v_dec := 'FREEFORM_ALLOWED'; v_rcode := 'WINDOW_OPEN';
    v_reason := format('The customer service window is open until %s. %s',
                       to_char(v_expiry at time zone 'Asia/Dubai','DD Mon YYYY HH24:MI') || ' Asia/Dubai', v_wevid);
    v_change := format('This becomes TEMPLATE_REQUIRED at %s unless the customer messages again - and only a customer message extends it, never anything NEXUS sends. A recorded opt-out would make it BLOCKED immediately.',
                       to_char(v_expiry at time zone 'Asia/Dubai','DD Mon YYYY HH24:MI') || ' Asia/Dubai');
    v_rid := v_win.rule_id; v_rname := v_win.rule_name; v_rjur := v_win.jurisdiction;
    v_rauth := v_win.authority; v_rver := v_win.verification_status; v_rsrc := v_win.source_name;

  -- 5e. Window open by arithmetic, but the arithmetic rests on a rule
  --     nobody has checked. A permission granted on an unverified rule is
  --     not a permission.
  elsif v_wstate = 'OPEN' then
    v_dec := 'TEMPLATE_REQUIRED'; v_rcode := 'WINDOW_RULE_' || v_win.authority;
    v_reason := format('By the recorded window duration the window would be open until %s, but the rule it rests on is %s. NEXUS will not grant a free-form permission on a rule nobody has verified, so the safe form of the message is required instead. %s',
                       to_char(v_expiry at time zone 'Asia/Dubai','DD Mon YYYY HH24:MI') || ' Asia/Dubai',
                       v_win.authority, v_wevid);
    v_change := format('The platform operator attests %s / MESSAGING / %s against the source that governs this account (policy_platform_verify_rule) and this same conversation returns FREEFORM_ALLOWED. Nothing about the customer has to change - only the evidence behind the rule. A dealership cannot do this for itself: that would be the dealership deciding what Meta permits.',
                       v_win.jurisdiction, v_win.rule_name);
    v_rid := v_win.rule_id; v_rname := v_win.rule_name; v_rjur := v_win.jurisdiction;
    v_rauth := v_win.authority; v_rver := v_win.verification_status; v_rsrc := v_win.source_name;

  -- 5f. Window closed, or never measured.
  else
    v_dec := 'TEMPLATE_REQUIRED';
    v_rcode := case when v_wstate = 'CLOSED' then 'WINDOW_CLOSED' else 'CONVERSATION_NOT_MEASURED' end;
    v_reason := case
      when v_wstate = 'CLOSED' then
        format('The customer service window closed at %s. Outside it a business-initiated message must use a template pre-approved by Meta; a free-form attempt is rejected by the API%s. %s',
               to_char(v_expiry at time zone 'Asia/Dubai','DD Mon YYYY HH24:MI') || ' Asia/Dubai',
               case when v_err.value_numeric is not null then ' with error ' || trim(to_char(v_err.value_numeric,'FM999999')) else '' end,
               v_wevid)
      else
        'NEXUS cannot establish that a window is open on this conversation, and unknown is not open. ' || v_wevid
      end;
    v_change := 'A new inbound message from the customer opens a fresh window and this becomes FREEFORM_ALLOWED once the platform has attested the window rule. Until then, send an approved template of category '
             || coalesce(v_tmplcat,'UTILITY') || '.';
    v_rid := coalesce(v_tmpl.rule_id, v_win.rule_id); v_rname := coalesce(v_tmpl.rule_name, v_win.rule_name);
    v_rjur := coalesce(v_tmpl.jurisdiction, v_win.jurisdiction); v_rauth := coalesce(v_tmpl.authority, v_win.authority);
    v_rver := coalesce(v_tmpl.verification_status, v_win.verification_status); v_rsrc := coalesce(v_tmpl.source_name, v_win.source_name);
  end if;

  return query select
    v_dec, v_rcode, v_reason, v_change,
    v_wstate, v_expiry, v_lastmsg, v_wevid, v_hours,
    v_optstate, v_optevid,
    v_rid, v_rname, v_rjur, v_rauth, v_rver, v_rsrc,
    v_rules, v_intent, v_biz, v_tmplcat,
    p_tenant_id, p_integration_id, v_cust, v_now, v_by;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_policy_decision_for_channel(p_channel_type text, p_external_identifier text, p_customer_wa_id text, p_intent text, p_as_of timestamp with time zone DEFAULT now())
 RETURNS SETOF whatsapp_policy_decision_row
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_t uuid;
  v_i uuid;
begin
  select r.tenant_id, r.integration_id
    into v_t, v_i
    from public.nexus_resolve_channel_tenant(p_channel_type, p_external_identifier) r;

  if not found then
    return query select
      'BLOCKED'::text, 'CHANNEL_UNRESOLVED'::text,
      format('No active dealership resolves from %s / %s, so NEXUS does not know whose customer this is or whose rules apply.',
             coalesce(nullif(btrim(coalesce(p_channel_type,'')),''),'(no channel type)'),
             coalesce(nullif(btrim(coalesce(p_external_identifier,'')),''),'(no identifier)'))::text,
      'Register this channel identity in channel_registry against the dealership that owns it, with status active. An unresolved channel is refused, never attributed to the default dealership - a caller that can pick the tenant can pick whose customers get messaged.'::text,
      'UNKNOWN'::text, null::timestamptz, null::timestamptz, null::text, null::numeric,
      'OPT_IN_UNKNOWN'::text, 'Not evaluated - the channel did not resolve.'::text,
      null::uuid, null::text, null::text, null::text, null::text, null::text,
      '[]'::jsonb, upper(btrim(coalesce(p_intent,'')))::text, null::boolean, null::text,
      null::uuid, null::uuid, lower(btrim(coalesce(p_customer_wa_id,'')))::text,
      coalesce(p_as_of, now()), 'whatsapp_policy_decision v1 - deterministic SQL, no language model in the path'::text;
    return;
  end if;

  return query select * from public.whatsapp_policy_decision(v_t, v_i, p_customer_wa_id, p_intent, p_as_of);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_policy_rule_lookup(p_tenant_id uuid, p_jurisdiction text, p_rule_name text, p_as_of date DEFAULT ((now() AT TIME ZONE 'Asia/Dubai'::text))::date)
 RETURNS TABLE(rule_id uuid, jurisdiction text, rule_name text, value_numeric numeric, value_text text, unit text, status text, verification_status text, authority text, source_name text, source_url text, effective_from date, notes text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select r.id, r.jurisdiction, r.rule_name,
         r.value_numeric, r.value_text, r.unit,
         r.status, r.verification_status,
         public.policy_authority(r.status, r.verification_status, r.effective_from, r.effective_to, p_as_of),
         r.source_name, r.source_url, r.effective_from, r.notes
    from public.policy_rule r
   where r.jurisdiction = upper(btrim(coalesce(p_jurisdiction,'')))
     and r.rule_type    = 'MESSAGING'
     and r.rule_name    = upper(btrim(coalesce(p_rule_name,'')))
     -- Scope follows ownership, and is not a preference order. A platform or
     -- regulator rule is global by construction (policy_rule_scope_follows_
     -- jurisdiction), so only global rows are looked at here; a tenant house
     -- rule is only ever this dealership's own.
     and case when r.jurisdiction_owner_kind = 'TENANT'
              then r.tenant_id = p_tenant_id
              else r.tenant_id is null
         end
     and r.status <> 'WITHDRAWN'
   order by (r.status = 'ACTIVE') desc, r.version desc
   limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_record_customer_message(p_tenant_id uuid, p_integration_id uuid, p_customer_wa_id text, p_occurred_at timestamp with time zone, p_external_message_id text, p_source text)
 RETURNS whatsapp_conversation_state
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_cust text := lower(btrim(coalesce(p_customer_wa_id,'')));
  v_ext  text := btrim(coalesce(p_external_message_id,''));
  v_row  public.whatsapp_conversation_state;
  v_new  integer := 0;
begin
  if not exists (select 1 from public.channel_registry cr
                  where cr.integration_id = p_integration_id
                    and cr.tenant_id = p_tenant_id
                    and cr.status = 'active') then
    raise exception using errcode = '42501',
      message = 'That channel is not an active registered channel of that dealership.',
      hint    = 'Resolve the tenant from the channel identity rather than passing both in independently.';
  end if;
  if v_cust = '' then
    raise exception using errcode = '22023', message = 'A customer WhatsApp identity is required.';
  end if;
  if p_occurred_at is null then
    raise exception using errcode = '22023',
      message = 'An inbound message with no timestamp cannot open a window.',
      hint    = 'Leave the conversation unmeasured rather than recording a window NEXUS cannot date.';
  end if;
  if nullif(btrim(coalesce(p_source,'')),'') is null then
    raise exception using errcode = '22023',
      message = 'Recording an inbound message requires naming where the timestamp came from.';
  end if;

  -- An id NEXUS cannot see is an id NEXUS cannot deduplicate, and this window is
  -- the fact that turns TEMPLATE_REQUIRED into FREEFORM_ALLOWED. Accepting an
  -- unidentified message would restore the replay hole through a different door:
  -- every redelivery would look new. The cost of refusing is a template instead of
  -- a free-form reply. The cost of accepting is sending outside Meta's window.
  if v_ext = '' then
    raise exception using errcode = '22023',
      message = 'An inbound message with no provider message id cannot open or extend a customer service window.',
      detail  = 'NEXUS_INBOUND_MESSAGE_ID_REQUIRED',
      hint    = 'Send the provider''s own message id (WAHA body.payload.id, Cloud API wamid). Do not substitute a per-delivery id (x-webhook-request-id, body.id) or a generated one: either makes the key change per delivery and defeats it. If the provider genuinely gave none, leave the conversation unmeasured and send a template.';
  end if;

  -- Have we counted this message before? One row per message, per conversation.
  -- ON CONFLICT DO NOTHING is the serialisation point: a concurrent second backend
  -- blocks here on the uncommitted key and then finds it committed, so exactly one
  -- caller sees ROW_COUNT 1 for a given message.
  insert into public.whatsapp_customer_message_seen
    (tenant_id, integration_id, customer_wa_id, external_message_id, first_occurred_at, first_source)
  values (p_tenant_id, p_integration_id, v_cust, v_ext, p_occurred_at, btrim(p_source))
  on conflict on constraint whatsapp_customer_message_seen_pkey do nothing;
  get diagnostics v_new = ROW_COUNT;

  if v_new = 0 then
    -- A redelivery of a message already counted. It changes nothing, and in
    -- particular it does not move the window.
    select * into v_row from public.whatsapp_conversation_state c2
     where c2.tenant_id = p_tenant_id and c2.integration_id = p_integration_id and c2.customer_wa_id = v_cust;
    return v_row;
  end if;

  -- A genuinely new customer message. Still monotonic: an out-of-order delivery of
  -- an older message must not drag the window backwards either.
  insert into public.whatsapp_conversation_state as c
    (tenant_id, integration_id, customer_wa_id,
     last_customer_message_at, last_customer_message_external_id, last_customer_message_source)
  values (p_tenant_id, p_integration_id, v_cust, p_occurred_at, v_ext, btrim(p_source))
  on conflict (tenant_id, integration_id, customer_wa_id) do update
     set last_customer_message_at          = excluded.last_customer_message_at,
         last_customer_message_external_id = excluded.last_customer_message_external_id,
         last_customer_message_source      = excluded.last_customer_message_source,
         updated_at                        = now()
   where c.last_customer_message_at is null
      or excluded.last_customer_message_at > c.last_customer_message_at
  returning * into v_row;

  if v_row is null then
    select * into v_row from public.whatsapp_conversation_state c2
     where c2.tenant_id = p_tenant_id and c2.integration_id = p_integration_id and c2.customer_wa_id = v_cust;
  end if;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_record_delivery_status(p_integration_id uuid, p_provider_message_id text, p_status_raw text, p_status_at timestamp with time zone, p_provider_payload jsonb, p_recipient_wa_id text DEFAULT NULL::text, p_conversation_id text DEFAULT NULL::text, p_conversation_origin_type text DEFAULT NULL::text, p_conversation_expiration_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_pricing_billable boolean DEFAULT NULL::boolean, p_pricing_model text DEFAULT NULL::text, p_pricing_category text DEFAULT NULL::text, p_pricing_type text DEFAULT NULL::text, p_errors jsonb DEFAULT NULL::jsonb, p_received_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(delivery_event_id uuid, tenant_id uuid, first_seen boolean, link_state text, usage_updated boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
#variable_conflict use_column
declare
  v_tenant uuid; v_ctype text; v_cstatus text; v_tstatus text; v_provider text;
  v_ext text := btrim(coalesce(p_provider_message_id,''));
  v_raw text := btrim(coalesce(p_status_raw,''));
  v_norm text; v_event uuid; v_id uuid; v_new boolean := false; v_applied boolean := false;
  v_link text;
  v_known text[] := array['sent','delivered','read','failed','played'];
begin
  perform public.whatsapp_refuse_end_user_role('whatsapp_record_delivery_status');

  if v_ext = '' then
    raise exception 'whatsapp_record_delivery_status: statuses[].id (the wamid of the message NEXUS sent) is required. Without it the callback cannot be deduplicated or attributed.' using errcode='22023';
  end if;
  if v_raw = '' then
    raise exception 'whatsapp_record_delivery_status: statuses[].status is required.' using errcode='22023';
  end if;
  if p_status_at is null then
    raise exception 'whatsapp_record_delivery_status: statuses[].timestamp is required.' using errcode='22023';
  end if;
  if p_provider_payload is null or jsonb_typeof(p_provider_payload) <> 'object' then
    raise exception 'whatsapp_record_delivery_status: the verbatim statuses[] element is required. A billing fact with no provider payload behind it is unauditable.' using errcode='22023';
  end if;

  select cr.tenant_id, cr.channel_type, cr.status, t.status
    into v_tenant, v_ctype, v_cstatus, v_tstatus
    from public.channel_registry cr join public.tenants t on t.id = cr.tenant_id
   where cr.integration_id = p_integration_id;
  if v_tenant is null then
    raise exception 'whatsapp_record_delivery_status: integration % is not in channel_registry. An unregistered channel writes nothing.', p_integration_id using errcode='23503';
  end if;
  if v_cstatus <> 'active' or v_tstatus <> 'active' then
    raise exception 'whatsapp_record_delivery_status: channel status % / dealership status %.', v_cstatus, v_tstatus using errcode='42501';
  end if;

  v_provider := case v_ctype
                  when 'whatsapp_waha_session'          then 'waha'
                  when 'whatsapp_cloud_phone_number_id' then 'whatsapp_cloud'
                end;
  if v_provider is null then
    raise exception 'whatsapp_record_delivery_status: no provider mapping for channel_type %.', v_ctype using errcode='22023';
  end if;

  v_norm := lower(v_raw);
  if not (v_norm = any (v_known)) then v_norm := 'unmapped'; end if;

  select e.event_id into v_event from public.channel_message_events e
   where e.tenant_id = v_tenant and e.direction = 'outbound' and e.external_message_id = v_ext;

  insert into public.whatsapp_delivery_events as w
    (tenant_id, integration_id, provider, provider_message_id, event_id, link_state, linked_at,
     status, status_raw, status_at, recipient_wa_id,
     conversation_id, conversation_origin_type, conversation_expiration_at,
     pricing_billable, pricing_model, pricing_category, pricing_type,
     errors, provider_payload, received_at)
  values
    (v_tenant, p_integration_id, v_provider, v_ext, v_event,
     case when v_event is null then 'UNLINKED_NO_OUTBOUND_EVENT' else 'LINKED' end,
     case when v_event is null then null else now() end,
     v_norm, v_raw, p_status_at, nullif(btrim(coalesce(p_recipient_wa_id,'')),''),
     p_conversation_id, p_conversation_origin_type, p_conversation_expiration_at,
     p_pricing_billable, p_pricing_model, p_pricing_category, p_pricing_type,
     p_errors, p_provider_payload, coalesce(p_received_at, now()))
  on conflict on constraint whatsapp_delivery_events_idempotency do nothing
  returning w.delivery_event_id into v_id;

  if v_id is not null then
    v_new := true;
  else
    select e.delivery_event_id into v_id from public.whatsapp_delivery_events e
     where e.tenant_id = v_tenant and e.provider_message_id = v_ext and e.status_raw = v_raw;
  end if;

  if v_new then
    v_applied := public.whatsapp_apply_delivery_to_usage(v_id);
  end if;

  select e.link_state into v_link from public.whatsapp_delivery_events e where e.delivery_event_id = v_id;
  return query select v_id, v_tenant, v_new, v_link, v_applied;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_record_message_usage(p_event_id uuid, p_message_category text, p_policy_decision text, p_policy_reason_code text, p_policy_rule_verification_status text, p_policy_decided_at timestamp with time zone, p_sent_at timestamp with time zone DEFAULT now(), p_policy_rule_id uuid DEFAULT NULL::uuid, p_policy_rule_name text DEFAULT NULL::text, p_template_id uuid DEFAULT NULL::uuid, p_template_provider_status_at_send text DEFAULT NULL::text, p_template_status_age_at_send interval DEFAULT NULL::interval, p_template_staleness_verdict_at_send text DEFAULT NULL::text)
 RETURNS TABLE(usage_id uuid, tenant_id uuid, first_seen boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_tenant uuid; v_integration uuid; v_dir text; v_id uuid; v_ttenant uuid;
begin
  perform public.whatsapp_refuse_end_user_role('whatsapp_record_message_usage');

  select e.tenant_id, e.integration_id, e.direction
    into v_tenant, v_integration, v_dir
    from public.channel_message_events e where e.event_id = p_event_id;

  if v_tenant is null then
    raise exception
      'whatsapp_record_message_usage: no channel_message_events row %. Record the outbound message event first -- the ledger describes messages that exist, it does not create them.',
      p_event_id using errcode='23503';
  end if;
  if v_dir <> 'outbound' then
    raise exception
      'whatsapp_record_message_usage: event % is direction %. Only outbound messages consume messaging.',
      p_event_id, v_dir using errcode='22023';
  end if;

  if upper(coalesce(p_policy_decision,'')) = 'BLOCKED' then
    raise exception
      'whatsapp_record_message_usage: the policy engine BLOCKED this message, so it was not sent and has no place in a ledger of what was sent. Record the refusal in the audit trail instead.'
      using errcode='22023';
  end if;

  if p_template_id is not null then
    select t.tenant_id into v_ttenant from public.whatsapp_templates t where t.template_id = p_template_id;
    if v_ttenant is distinct from v_tenant then
      raise exception
        'whatsapp_record_message_usage: template % belongs to dealership %, not %.',
        p_template_id, coalesce(v_ttenant::text,'(none)'), v_tenant using errcode='42501';
    end if;
  end if;

  select u.usage_id into v_id from public.whatsapp_message_usage u
   where u.tenant_id = v_tenant and u.event_id = p_event_id;
  if v_id is not null then
    -- Idempotent: a retried send path re-reaches this and must not double the
    -- ledger. The existing row wins; provider facts already written stay.
    return query select v_id, v_tenant, false;
    return;
  end if;

  insert into public.whatsapp_message_usage
    (tenant_id, integration_id, event_id, message_category, template_required, template_id,
     policy_decision, policy_reason_code, policy_rule_id, policy_rule_name,
     policy_rule_verification_status, policy_decided_at,
     template_provider_status_at_send, template_status_age_at_send,
     template_staleness_verdict_at_send, sent_at)
  values
    (v_tenant, v_integration, p_event_id,
     upper(btrim(coalesce(p_message_category,'UNKNOWN'))),
     (upper(btrim(coalesce(p_policy_decision,''))) = 'TEMPLATE_REQUIRED'),
     p_template_id,
     upper(btrim(coalesce(p_policy_decision,''))), btrim(coalesce(p_policy_reason_code,'')),
     p_policy_rule_id, p_policy_rule_name,
     upper(btrim(coalesce(p_policy_rule_verification_status,'NO_RULE_APPLIED'))),
     coalesce(p_policy_decided_at, now()),
     p_template_provider_status_at_send, p_template_status_age_at_send,
     p_template_staleness_verdict_at_send, coalesce(p_sent_at, now()))
  returning public.whatsapp_message_usage.usage_id into v_id;

  return query select v_id, v_tenant, true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_record_opt_in_event(p_tenant_id uuid, p_integration_id uuid, p_customer_wa_id text, p_event text, p_occurred_at timestamp with time zone, p_mechanism text, p_evidence_kind text, p_evidence_ref text, p_recorded_by text, p_notes text DEFAULT NULL::text)
 RETURNS whatsapp_opt_in_event
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_cust text := lower(btrim(coalesce(p_customer_wa_id,'')));
  v_evk  text := upper(btrim(coalesce(p_evidence_kind,'')));
  v_evr  text := btrim(coalesce(p_evidence_ref,''));
  v_ev   text := upper(btrim(coalesce(p_event,'')));
  v_row  public.whatsapp_opt_in_event;
begin
  if not exists (select 1 from public.channel_registry cr
                  where cr.integration_id = p_integration_id
                    and cr.tenant_id = p_tenant_id
                    and cr.status = 'active') then
    raise exception using errcode = '42501',
      message = 'That channel is not an active registered channel of that dealership.';
  end if;

  insert into public.whatsapp_opt_in_event
    (tenant_id, integration_id, customer_wa_id, event, occurred_at,
     mechanism, evidence_kind, evidence_ref, recorded_by, notes)
  values (p_tenant_id, p_integration_id, v_cust, v_ev, p_occurred_at,
          upper(btrim(coalesce(p_mechanism,''))), v_evk, v_evr,
          btrim(coalesce(p_recorded_by,'')), p_notes)
  on conflict on constraint whatsapp_opt_in_event_evidence_key do nothing
  returning * into v_row;

  if v_row is null then
    -- Already on file. Return the fact as first recorded; a redelivery does not
    -- restate it later than it happened.
    select * into v_row from public.whatsapp_opt_in_event e
     where e.tenant_id = p_tenant_id and e.integration_id = p_integration_id
       and e.customer_wa_id = v_cust and e.event = v_ev
       and e.evidence_kind = v_evk and e.evidence_ref = v_evr;
  end if;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_refuse_end_user_role(p_fn text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  if coalesce(current_setting('role', true), '') in ('authenticated','anon') then
    raise exception '%: refused for end-user role %. Messaging records are written by the backend only.',
      p_fn, current_setting('role', true) using errcode = '42501';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_template_declare(p_integration_id uuid, p_name text, p_language text, p_category text, p_body_text text DEFAULT NULL::text, p_variable_schema jsonb DEFAULT '[]'::jsonb, p_declared_by text DEFAULT NULL::text, p_waba_ref text DEFAULT NULL::text)
 RETURNS TABLE(template_id uuid, tenant_id uuid, created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_tenant uuid; v_cstatus text; v_tstatus text; v_id uuid;
  v_name text := lower(btrim(coalesce(p_name,'')));
  v_lang text := btrim(coalesce(p_language,''));
  v_body text := nullif(btrim(coalesce(p_body_text,'')),'');
begin
  perform public.whatsapp_refuse_end_user_role('whatsapp_template_declare');

  select cr.tenant_id, cr.status, t.status into v_tenant, v_cstatus, v_tstatus
    from public.channel_registry cr join public.tenants t on t.id = cr.tenant_id
   where cr.integration_id = p_integration_id;

  if v_tenant is null then
    raise exception 'whatsapp_template_declare: integration % is not in channel_registry. An unregistered channel owns no templates.', p_integration_id using errcode='23503';
  end if;
  if v_cstatus <> 'active' or v_tstatus <> 'active' then
    raise exception 'whatsapp_template_declare: channel status % / dealership status %.', v_cstatus, v_tstatus using errcode='42501';
  end if;

  select t.template_id into v_id from public.whatsapp_templates t
   where t.tenant_id = v_tenant and t.provider = 'whatsapp_cloud'
     and coalesce(t.waba_ref,'') = coalesce(p_waba_ref,'')
     and t.name = v_name and t.language = v_lang;

  if v_id is not null then
    return query select v_id, v_tenant, false;
    return;
  end if;

  insert into public.whatsapp_templates
    (tenant_id, integration_id, provider, waba_ref, name, language, category,
     nexus_state, nexus_state_at, nexus_state_by,
     variable_schema, body_text, body_text_source, body_text_observed_at)
  values
    (v_tenant, p_integration_id, 'whatsapp_cloud', p_waba_ref, v_name, v_lang,
     upper(btrim(coalesce(p_category,''))),
     'DRAFT', now(), nullif(btrim(coalesce(p_declared_by,'')),''),
     coalesce(p_variable_schema,'[]'::jsonb),
     v_body,
     case when v_body is null then null else 'NEXUS_DRAFT' end,
     case when v_body is null then null else now() end)
  returning public.whatsapp_templates.template_id into v_id;

  return query select v_id, v_tenant, true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_template_observe(p_integration_id uuid, p_name text, p_language text, p_provider_status_raw text, p_source text, p_observed_at timestamp with time zone DEFAULT now(), p_category text DEFAULT NULL::text, p_provider_template_id text DEFAULT NULL::text, p_waba_ref text DEFAULT NULL::text, p_evidence_ref text DEFAULT NULL::text, p_rejected_reason text DEFAULT NULL::text, p_body_text text DEFAULT NULL::text, p_variable_schema jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(template_id uuid, tenant_id uuid, provider_status text, replaced_status text, status_changed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_tenant uuid; v_cstatus text; v_tstatus text;
  v_norm text; v_raw text := btrim(coalesce(p_provider_status_raw,''));
  v_prev text; v_prev_at timestamptz; v_id uuid; v_changed boolean;
  v_name text := lower(btrim(coalesce(p_name,'')));
  v_lang text := btrim(coalesce(p_language,''));
  v_body text := nullif(btrim(coalesce(p_body_text,'')),'');
  v_known text[] := array['APPROVED','REJECTED','PENDING','PAUSED','DISABLED',
                          'PENDING_DELETION','IN_APPEAL','LIMIT_EXCEEDED'];
  v_refused text[] := array['REJECTED','PAUSED','DISABLED','IN_APPEAL','LIMIT_EXCEEDED'];
begin
  perform public.whatsapp_refuse_end_user_role('whatsapp_template_observe');

  if v_raw = '' then
    raise exception 'whatsapp_template_observe: the provider''s own status string is required. An observation with no reported value is not an observation.' using errcode='22023';
  end if;
  if coalesce(p_source,'') not in ('GRAPH_API_FETCH','WEBHOOK_TEMPLATE_STATUS_UPDATE','OPERATOR_ENTERED') then
    raise exception 'whatsapp_template_observe: p_source must say how NEXUS heard this (GRAPH_API_FETCH, WEBHOOK_TEMPLATE_STATUS_UPDATE or OPERATOR_ENTERED); got %.', coalesce(p_source,'(null)') using errcode='22023';
  end if;
  if p_observed_at is null then
    raise exception 'whatsapp_template_observe: p_observed_at is required. A cached status with no timestamp cannot be aged, and an unageable APPROVED is exactly the failure this registry is designed against.' using errcode='22023';
  end if;

  select cr.tenant_id, cr.status, t.status into v_tenant, v_cstatus, v_tstatus
    from public.channel_registry cr join public.tenants t on t.id = cr.tenant_id
   where cr.integration_id = p_integration_id;
  if v_tenant is null then
    raise exception 'whatsapp_template_observe: integration % is not in channel_registry.', p_integration_id using errcode='23503';
  end if;
  if v_cstatus <> 'active' or v_tstatus <> 'active' then
    raise exception 'whatsapp_template_observe: channel status % / dealership status %.', v_cstatus, v_tstatus using errcode='42501';
  end if;

  -- Normalise for querying, keep the provider's word verbatim either way. An
  -- unrecognised status becomes UNMAPPED rather than being guessed at.
  v_norm := upper(replace(btrim(v_raw), ' ', '_'));
  if not (v_norm = any (v_known)) then v_norm := 'UNMAPPED'; end if;

  select t.template_id, t.provider_status, t.provider_status_observed_at
    into v_id, v_prev, v_prev_at
    from public.whatsapp_templates t
   where t.tenant_id = v_tenant and t.provider = 'whatsapp_cloud'
     and coalesce(t.waba_ref,'') = coalesce(p_waba_ref,'')
     and t.name = v_name and t.language = v_lang;

  if v_id is null then
    insert into public.whatsapp_templates
      (tenant_id, integration_id, provider, waba_ref, name, language, category,
       provider_template_id, nexus_state, nexus_state_at,
       provider_status, provider_status_raw, provider_status_observed_at,
       provider_status_source, provider_status_evidence_ref, provider_rejected_reason,
       variable_schema, body_text, body_text_source, body_text_observed_at)
    values
      (v_tenant, p_integration_id, 'whatsapp_cloud', p_waba_ref, v_name, v_lang,
       upper(btrim(coalesce(p_category,'UTILITY'))),
       p_provider_template_id, 'ADOPTED', now(),
       v_norm, v_raw, p_observed_at, p_source, p_evidence_ref,
       case when v_norm = any (v_refused) then nullif(btrim(coalesce(p_rejected_reason,'')),'') end,
       coalesce(p_variable_schema,'[]'::jsonb),
       v_body,
       case when v_body is null then null else 'PROVIDER_FETCHED' end,
       case when v_body is null then null else p_observed_at end)
    returning public.whatsapp_templates.template_id into v_id;
    return query select v_id, v_tenant, v_norm, null::text, true;
    return;
  end if;

  v_changed := (v_prev is distinct from v_norm);

  update public.whatsapp_templates t set
    provider_status              = v_norm,
    provider_status_raw          = v_raw,
    provider_status_observed_at  = p_observed_at,
    provider_status_source       = p_source,
    provider_status_evidence_ref = coalesce(p_evidence_ref, t.provider_status_evidence_ref),
    provider_rejected_reason     = case when v_norm = any (v_refused)
                                        then coalesce(nullif(btrim(coalesce(p_rejected_reason,'')),''), t.provider_rejected_reason)
                                        else null end,
    previous_provider_status     = case when v_changed and v_prev <> 'UNKNOWN' then v_prev else t.previous_provider_status end,
    previous_status_observed_at  = case when v_changed and v_prev <> 'UNKNOWN' then v_prev_at else t.previous_status_observed_at end,
    provider_template_id         = coalesce(p_provider_template_id, t.provider_template_id),
    category                     = coalesce(upper(nullif(btrim(coalesce(p_category,'')),'')), t.category),
    nexus_state                  = case when t.nexus_state = 'DRAFT' then 'ADOPTED' else t.nexus_state end,
    variable_schema              = coalesce(p_variable_schema, t.variable_schema),
    body_text                    = coalesce(v_body, t.body_text),
    body_text_source             = case when v_body is not null then 'PROVIDER_FETCHED' else t.body_text_source end,
    body_text_observed_at        = case when v_body is not null then p_observed_at else t.body_text_observed_at end
  where t.template_id = v_id;

  return query select v_id, v_tenant, v_norm, case when v_changed then v_prev end, v_changed;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_template_retire(p_template_id uuid, p_by text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_n integer;
begin
  perform public.whatsapp_refuse_end_user_role('whatsapp_template_retire');
  update public.whatsapp_templates
     set nexus_state = 'RETIRED', nexus_state_at = now(),
         nexus_state_by = coalesce(nullif(btrim(coalesce(p_by,'')),''), nexus_state_by)
   where template_id = p_template_id and nexus_state <> 'RETIRED';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_template_sendability(p_template_id uuid, p_max_status_age interval)
 RETURNS SETOF whatsapp_template_sendability_row
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  r         public.whatsapp_templates%rowtype;
  v_tstatus text;
  v_age     interval;
  v_stale   boolean;
  v_now     timestamptz := now();
  v_by      text := 'whatsapp_template_sendability v1 - deterministic SQL, no language model in the path';
begin
  select t.* into r from public.whatsapp_templates t where t.template_id = p_template_id;

  -- Always exactly one row, never zero -- including for a template that does not
  -- exist. A zero-row answer is trivially misread as "nothing objected".
  if r.template_id is null then
    return query select
      false, 'REFUSED_TEMPLATE_UNKNOWN'::text, 'TEMPLATE_NOT_IN_REGISTRY'::text,
      format('No template %s exists in NEXUS''s registry, so NEXUS cannot say anything about whether the provider approved it.', coalesce(p_template_id::text,'(null)'))::text,
      'Register the template and record the provider''s status for it with whatsapp_template_observe().'::text,
      p_template_id, null::uuid, null::uuid, null::text, null::text, null::text, null::text,
      'UNKNOWN'::text, null::text, 'NEVER_OBSERVED'::text, null::timestamptz,
      null::interval, p_max_status_age, null::boolean, null::text, null::integer, null::jsonb,
      v_now, v_by;
    return;
  end if;

  select tn.status into v_tstatus from public.tenants tn where tn.id = r.tenant_id;

  if p_max_status_age is null then
    return query select
      false, 'REFUSED_NO_TOLERANCE_STATED'::text, 'STALENESS_TOLERANCE_NOT_STATED'::text,
      'The caller did not say how old a provider status it is willing to send on. NEXUS will not pick that number for it.'::text,
      'Pass p_max_status_age. The value is recorded on the usage row, so the tolerance a send was made under stays auditable.'::text,
      r.template_id, r.tenant_id, r.integration_id, r.name, r.language, r.category, r.nexus_state,
      r.provider_status, r.provider_status_raw, r.provider_status_source, r.provider_status_observed_at,
      (v_now - r.provider_status_observed_at), p_max_status_age, null::boolean,
      r.previous_provider_status, r.body_variable_count, r.variable_schema, v_now, v_by;
    return;
  end if;

  v_age   := v_now - r.provider_status_observed_at;
  v_stale := (r.provider_status_observed_at is null) or (v_age > p_max_status_age);

  if coalesce(v_tstatus,'') <> 'active' then
    return query select
      false, 'REFUSED_DEALERSHIP_INACTIVE'::text, 'TENANT_NOT_ACTIVE'::text,
      'The dealership that owns this template is not active.'::text,
      'Reactivate the dealership, or stop the send.'::text,
      r.template_id, r.tenant_id, r.integration_id, r.name, r.language, r.category, r.nexus_state,
      r.provider_status, r.provider_status_raw, r.provider_status_source, r.provider_status_observed_at,
      v_age, p_max_status_age, v_stale, r.previous_provider_status, r.body_variable_count,
      r.variable_schema, v_now, v_by;
    return;
  end if;

  if r.nexus_state = 'RETIRED' then
    return query select
      false, 'REFUSED_TEMPLATE_RETIRED'::text, 'NEXUS_RETIRED_THIS_TEMPLATE'::text,
      'NEXUS has retired this template. Whatever the provider still says about it, NEXUS will not send it.'::text,
      'Un-retire it deliberately if it should be in use again.'::text,
      r.template_id, r.tenant_id, r.integration_id, r.name, r.language, r.category, r.nexus_state,
      r.provider_status, r.provider_status_raw, r.provider_status_source, r.provider_status_observed_at,
      v_age, p_max_status_age, v_stale, r.previous_provider_status, r.body_variable_count,
      r.variable_schema, v_now, v_by;
    return;
  end if;

  if r.provider_status = 'UNKNOWN' then
    return query select
      false, 'REFUSED_NEVER_OBSERVED'::text, 'PROVIDER_STATUS_NEVER_OBSERVED'::text,
      'NEXUS has never heard a status for this template from the provider. It holds no opinion to be stale, and an unobserved template is not an approved one.'::text,
      'Fetch the template''s status from the provider and record it with whatsapp_template_observe(). Until then this template cannot be sent.'::text,
      r.template_id, r.tenant_id, r.integration_id, r.name, r.language, r.category, r.nexus_state,
      r.provider_status, r.provider_status_raw, r.provider_status_source, r.provider_status_observed_at,
      v_age, p_max_status_age, v_stale, r.previous_provider_status, r.body_variable_count,
      r.variable_schema, v_now, v_by;
    return;
  end if;

  if r.provider_status <> 'APPROVED' then
    return query select
      false, 'REFUSED_PROVIDER_STATUS'::text, 'PROVIDER_STATUS_NOT_APPROVED'::text,
      format('The provider last reported this template as %s (its own word: %s), observed %s.',
             r.provider_status, coalesce(r.provider_status_raw,'(none)'),
             to_char(r.provider_status_observed_at, 'YYYY-MM-DD HH24:MI'))::text,
      coalesce(nullif(r.provider_rejected_reason,''),
               'Resolve the template with the provider, then re-observe its status. NEXUS does not overrule the provider.')::text,
      r.template_id, r.tenant_id, r.integration_id, r.name, r.language, r.category, r.nexus_state,
      r.provider_status, r.provider_status_raw, r.provider_status_source, r.provider_status_observed_at,
      v_age, p_max_status_age, v_stale, r.previous_provider_status, r.body_variable_count,
      r.variable_schema, v_now, v_by;
    return;
  end if;

  -- The failure this whole design exists to prevent: an APPROVED that NEXUS has
  -- not re-checked recently enough, sending silently after the provider changed
  -- its mind. A stale APPROVED is a refusal, not a warning.
  if v_stale then
    return query select
      false, 'REFUSED_STALE_APPROVAL'::text, 'APPROVAL_TOO_OLD_TO_RELY_ON'::text,
      format('NEXUS believes this template is APPROVED, but that belief is %s old and the caller will only rely on an answer up to %s old. The provider may have rejected or paused it since.',
             coalesce(v_age::text,'(unknown age - never observed)'), p_max_status_age::text)::text,
      'Re-fetch the template''s status from the provider and record it with whatsapp_template_observe(), then ask again. Widening the tolerance instead is a decision somebody has to make on purpose.'::text,
      r.template_id, r.tenant_id, r.integration_id, r.name, r.language, r.category, r.nexus_state,
      r.provider_status, r.provider_status_raw, r.provider_status_source, r.provider_status_observed_at,
      v_age, p_max_status_age, v_stale, r.previous_provider_status, r.body_variable_count,
      r.variable_schema, v_now, v_by;
    return;
  end if;

  return query select
    true, 'SEND_ALLOWED'::text, 'APPROVED_AND_FRESH_ENOUGH'::text,
    format('The provider reported APPROVED %s ago, within the caller''s stated tolerance of %s.', v_age::text, p_max_status_age::text)::text,
    'Nothing. Record this verdict and the age on the usage row when the message is sent.'::text,
    r.template_id, r.tenant_id, r.integration_id, r.name, r.language, r.category, r.nexus_state,
    r.provider_status, r.provider_status_raw, r.provider_status_source, r.provider_status_observed_at,
    v_age, p_max_status_age, v_stale, r.previous_provider_status, r.body_variable_count,
    r.variable_schema, v_now, v_by;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_template_variable_schema_ok(p jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select
    p is not null
    and jsonb_typeof(p) = 'array'
    and jsonb_array_length(p) <= 32
    and not exists (
      select 1
        from jsonb_array_elements(p) with ordinality as e(v, ord)
       where jsonb_typeof(e.v) <> 'object'
          or (e.v ->> 'index') is null
          or (e.v ->> 'index') !~ '^[0-9]{1,2}$'
          or ((e.v ->> 'index')::int) <> e.ord::int
          or (e.v ->> 'name') is null
          or (e.v ->> 'name') !~ '^[a-z][a-z0-9_]{0,63}$'
          or jsonb_typeof(coalesce(e.v -> 'required', 'true'::jsonb)) <> 'boolean'
          or length(coalesce(e.v ->> 'example','')) > 200
    );
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_templates_guard_channel()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_ctype text; v_tenant uuid;
begin
  if new.integration_id is null then
    return new;
  end if;

  select cr.channel_type, cr.tenant_id into v_ctype, v_tenant
    from public.channel_registry cr where cr.integration_id = new.integration_id;

  if v_ctype is null then
    raise exception 'whatsapp_templates: integration % is not in channel_registry.', new.integration_id using errcode='23503';
  end if;
  if v_tenant is distinct from new.tenant_id then
    raise exception 'whatsapp_templates: integration % belongs to dealership %, not %.',
      new.integration_id, v_tenant, new.tenant_id using errcode='42501';
  end if;
  if v_ctype <> 'whatsapp_cloud_phone_number_id' then
    raise exception
      'whatsapp_templates: integration % is a % channel. Templates exist only on the WhatsApp Cloud API; a WAHA session has no template concept, so NEXUS will not hold a template against one.',
      new.integration_id, v_ctype using errcode='22023';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.whatsapp_templates_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  new.updated_at := now();
  return new;
end;
$function$
;



-- ========================================================================
-- 3. COLUMN DEFAULTS
-- ========================================================================
ALTER TABLE public.audit_log ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.audit_log ALTER COLUMN logged_at SET DEFAULT now();
ALTER TABLE public.audit_log ALTER COLUMN tenant_id SET DEFAULT nexus_default_tenant_id();
ALTER TABLE public.channel_message_events ALTER COLUMN event_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.channel_message_events ALTER COLUMN recorded_at SET DEFAULT now();
ALTER TABLE public.channel_provider_capability ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.channel_provider_rank ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.channel_registry ALTER COLUMN integration_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.channel_registry ALTER COLUMN status SET DEFAULT 'active'::text;
ALTER TABLE public.channel_registry ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.channel_registry ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.channel_send_directive ALTER COLUMN directive_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.channel_send_directive ALTER COLUMN candidates_considered SET DEFAULT '[]'::jsonb;
ALTER TABLE public.channel_send_directive ALTER COLUMN routed_at SET DEFAULT now();
ALTER TABLE public.channel_send_directive ALTER COLUMN send_result SET DEFAULT 'PENDING'::text;
ALTER TABLE public.channel_send_form ALTER COLUMN sort SET DEFAULT 100;
ALTER TABLE public.channel_send_form ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.communication_logs ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.communication_logs ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.communication_logs ALTER COLUMN tenant_id SET DEFAULT nexus_default_tenant_id();
ALTER TABLE public.competitors ALTER COLUMN id SET DEFAULT nextval('competitors_id_seq'::regclass);
ALTER TABLE public.competitors ALTER COLUMN scraped_at SET DEFAULT now();
ALTER TABLE public.competitors ALTER COLUMN tenant_id SET DEFAULT nexus_default_tenant_id();
ALTER TABLE public.customer_360_profiles ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.customer_360_profiles ALTER COLUMN last_synced_at SET DEFAULT now();
ALTER TABLE public.customer_360_profiles ALTER COLUMN tenant_id SET DEFAULT nexus_default_tenant_id();
ALTER TABLE public.daily_metrics ALTER COLUMN snapshot_date SET DEFAULT CURRENT_DATE;
ALTER TABLE public.daily_metrics ALTER COLUMN captured_at SET DEFAULT now();
ALTER TABLE public.daily_metrics ALTER COLUMN tenant_id SET DEFAULT nexus_default_tenant_id();
ALTER TABLE public.deal_rescue_prerequisites ALTER COLUMN unlocks_states SET DEFAULT '{}'::text[];
ALTER TABLE public.deal_rescue_settings ALTER COLUMN set_at SET DEFAULT now();
ALTER TABLE public.deals_embeddings ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.deals_embeddings ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.deals_embeddings ALTER COLUMN tenant_id SET DEFAULT nexus_default_tenant_id();
ALTER TABLE public.finance_quotes ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.finance_quotes ALTER COLUMN source SET DEFAULT 'webhook'::text;
ALTER TABLE public.finance_quotes ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.finance_quotes ALTER COLUMN calculation_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.finance_quotes ALTER COLUMN tenant_id SET DEFAULT nexus_default_tenant_id();
ALTER TABLE public.inventory ALTER COLUMN acquired_at SET DEFAULT CURRENT_DATE;
ALTER TABLE public.inventory ALTER COLUMN tenant_id SET DEFAULT nexus_default_tenant_id();
ALTER TABLE public.inventory_action_events ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.inventory_action_events ALTER COLUMN at SET DEFAULT clock_timestamp();
ALTER TABLE public.inventory_action_policy ALTER COLUMN approver_tenant_roles SET DEFAULT ARRAY['owner'::text, 'admin'::text, 'manager'::text];
ALTER TABLE public.inventory_action_policy ALTER COLUMN approver_staff_roles SET DEFAULT ARRAY[]::text[];
ALTER TABLE public.inventory_action_policy ALTER COLUMN reproposal_cooldown_days SET DEFAULT 14;
ALTER TABLE public.inventory_action_policy ALTER COLUMN set_at SET DEFAULT now();
ALTER TABLE public.inventory_action_reason_codes ALTER COLUMN sort SET DEFAULT 100;
ALTER TABLE public.inventory_actions ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.inventory_actions ALTER COLUMN status SET DEFAULT 'PROPOSED'::text;
ALTER TABLE public.inventory_actions ALTER COLUMN proposed_at SET DEFAULT now();
ALTER TABLE public.inventory_actions ALTER COLUMN proposed_source SET DEFAULT 'HUMAN_FROM_ENGINE_QUEUE'::text;
ALTER TABLE public.inventory_actions ALTER COLUMN outcome_state SET DEFAULT 'NONE_YET'::text;
ALTER TABLE public.inventory_actions ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.inventory_actions ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.inventory_profit_settings ALTER COLUMN tenant_id SET DEFAULT nexus_default_tenant_id();
ALTER TABLE public.inventory_profit_settings ALTER COLUMN aging_warn_days SET DEFAULT 90;
ALTER TABLE public.inventory_profit_settings ALTER COLUMN aging_critical_days SET DEFAULT 120;
ALTER TABLE public.inventory_profit_settings ALTER COLUMN promote_days SET DEFAULT 60;
ALTER TABLE public.inventory_profit_settings ALTER COLUMN wholesale_days SET DEFAULT 180;
ALTER TABLE public.inventory_profit_settings ALTER COLUMN min_reprice_margin_pct SET DEFAULT 8.00;
ALTER TABLE public.inventory_profit_settings ALTER COLUMN market_tolerance_pct SET DEFAULT 3.00;
ALTER TABLE public.inventory_profit_settings ALTER COLUMN enquiry_window_days SET DEFAULT 30;
ALTER TABLE public.inventory_profit_settings ALTER COLUMN min_enquiry_sources SET DEFAULT 50;
ALTER TABLE public.inventory_profit_settings ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.inventory_profit_settings ALTER COLUMN min_model_token_overlap SET DEFAULT 2;
ALTER TABLE public.inventory_profit_settings ALTER COLUMN accepted_market_match_quality SET DEFAULT ARRAY['exact'::text, 'strong'::text];
ALTER TABLE public.inventory_profit_settings ALTER COLUMN market_max_age_days SET DEFAULT 14;
ALTER TABLE public.kyc_documents ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.kyc_documents ALTER COLUMN attempt_number SET DEFAULT 1;
ALTER TABLE public.kyc_documents ALTER COLUMN max_attempts SET DEFAULT 3;
ALTER TABLE public.kyc_documents ALTER COLUMN verdict SET DEFAULT 'PENDING'::text;
ALTER TABLE public.kyc_documents ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.kyc_documents ALTER COLUMN tenant_id SET DEFAULT nexus_default_tenant_id();
ALTER TABLE public.lead_recovery_action_events ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.lead_recovery_action_events ALTER COLUMN at SET DEFAULT now();
ALTER TABLE public.lead_recovery_actions ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.lead_recovery_actions ALTER COLUMN opportunity_value_state SET DEFAULT 'UNKNOWN_NO_LINK'::text;
ALTER TABLE public.lead_recovery_actions ALTER COLUMN status SET DEFAULT 'PROPOSED'::text;
ALTER TABLE public.lead_recovery_actions ALTER COLUMN proposed_at SET DEFAULT now();
ALTER TABLE public.lead_recovery_actions ALTER COLUMN proposed_source SET DEFAULT 'ENGINE'::text;
ALTER TABLE public.lead_recovery_actions ALTER COLUMN outcome_state SET DEFAULT 'NONE_YET'::text;
ALTER TABLE public.lead_recovery_actions ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.lead_recovery_actions ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.lead_recovery_reason_codes ALTER COLUMN sort SET DEFAULT 100;
ALTER TABLE public.lead_recovery_settings ALTER COLUMN set_at SET DEFAULT now();
ALTER TABLE public.leads ALTER COLUMN id SET DEFAULT nextval('leads_id_seq'::regclass);
ALTER TABLE public.leads ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.leads ALTER COLUMN tenant_id SET DEFAULT nexus_default_tenant_id();
ALTER TABLE public.policy_jurisdiction ALTER COLUMN added_at SET DEFAULT now();
ALTER TABLE public.policy_platform_attestation ALTER COLUMN attestation_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.policy_platform_attestation ALTER COLUMN attested_at SET DEFAULT now();
ALTER TABLE public.policy_rule ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.policy_rule ALTER COLUMN confidence SET DEFAULT 'UNKNOWN'::text;
ALTER TABLE public.policy_rule ALTER COLUMN status SET DEFAULT 'DRAFT'::text;
ALTER TABLE public.policy_rule ALTER COLUMN verification_status SET DEFAULT 'NOT_VERIFIED'::text;
ALTER TABLE public.policy_rule ALTER COLUMN version SET DEFAULT 1;
ALTER TABLE public.policy_rule ALTER COLUMN added_at SET DEFAULT now();
ALTER TABLE public.policy_rule ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.policy_rule_event ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.policy_rule_event ALTER COLUMN at SET DEFAULT now();
ALTER TABLE public.policy_rule_type ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.policy_unit ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.policy_unmigrated_constant ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.policy_unmigrated_constant ALTER COLUMN seeded_as_rule SET DEFAULT false;
ALTER TABLE public.policy_unmigrated_constant ALTER COLUMN surveyed_on SET DEFAULT '2026-09-03'::date;
ALTER TABLE public.policy_unmigrated_constant ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.processed_messages ALTER COLUMN source SET DEFAULT 'waha'::text;
ALTER TABLE public.processed_messages ALTER COLUMN processed_at SET DEFAULT now();
ALTER TABLE public.processed_messages ALTER COLUMN tenant_id SET DEFAULT nexus_default_tenant_id();
ALTER TABLE public.purchase_history ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.purchase_history ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.purchase_history ALTER COLUMN tenant_id SET DEFAULT nexus_default_tenant_id();
ALTER TABLE public.rag_documents ALTER COLUMN id SET DEFAULT nextval('rag_documents_id_seq'::regclass);
ALTER TABLE public.rag_documents ALTER COLUMN tenant_id SET DEFAULT nexus_default_tenant_id();
ALTER TABLE public.tenant_capability ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.tenant_capability ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.tenant_capability_catalogue ALTER COLUMN sort SET DEFAULT 100;
ALTER TABLE public.tenant_capability_catalogue ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.tenant_configuration ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.tenant_configuration ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.tenant_configuration_default ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.tenant_members ALTER COLUMN role SET DEFAULT 'member'::text;
ALTER TABLE public.tenant_members ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.tenants ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.tenants ALTER COLUMN status SET DEFAULT 'active'::text;
ALTER TABLE public.tenants ALTER COLUMN is_unattributed_default SET DEFAULT false;
ALTER TABLE public.tenants ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.users ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.users ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.users ALTER COLUMN tenant_id SET DEFAULT nexus_default_tenant_id();
ALTER TABLE public.whatsapp_contacts ALTER COLUMN first_seen SET DEFAULT now();
ALTER TABLE public.whatsapp_contacts ALTER COLUMN last_seen SET DEFAULT now();
ALTER TABLE public.whatsapp_contacts ALTER COLUMN message_count SET DEFAULT 0;
ALTER TABLE public.whatsapp_contacts ALTER COLUMN tenant_id SET DEFAULT nexus_default_tenant_id();
ALTER TABLE public.whatsapp_conversation_state ALTER COLUMN first_seen_at SET DEFAULT now();
ALTER TABLE public.whatsapp_conversation_state ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.whatsapp_conversation_state ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.whatsapp_customer_message_seen ALTER COLUMN first_recorded_at SET DEFAULT now();
ALTER TABLE public.whatsapp_delivery_events ALTER COLUMN delivery_event_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.whatsapp_delivery_events ALTER COLUMN provider SET DEFAULT 'whatsapp_cloud'::text;
ALTER TABLE public.whatsapp_delivery_events ALTER COLUMN received_at SET DEFAULT now();
ALTER TABLE public.whatsapp_delivery_events ALTER COLUMN recorded_at SET DEFAULT now();
ALTER TABLE public.whatsapp_message_intent ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.whatsapp_message_usage ALTER COLUMN usage_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.whatsapp_message_usage ALTER COLUMN billing_fact_state SET DEFAULT 'AWAITING_PROVIDER_REPORT'::text;
ALTER TABLE public.whatsapp_message_usage ALTER COLUMN recorded_at SET DEFAULT now();
ALTER TABLE public.whatsapp_message_usage ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.whatsapp_opt_in_event ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.whatsapp_opt_in_event ALTER COLUMN recorded_at SET DEFAULT now();
ALTER TABLE public.whatsapp_templates ALTER COLUMN template_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.whatsapp_templates ALTER COLUMN provider SET DEFAULT 'whatsapp_cloud'::text;
ALTER TABLE public.whatsapp_templates ALTER COLUMN nexus_state SET DEFAULT 'DRAFT'::text;
ALTER TABLE public.whatsapp_templates ALTER COLUMN nexus_state_at SET DEFAULT now();
ALTER TABLE public.whatsapp_templates ALTER COLUMN provider_status SET DEFAULT 'UNKNOWN'::text;
ALTER TABLE public.whatsapp_templates ALTER COLUMN provider_status_source SET DEFAULT 'NEVER_OBSERVED'::text;
ALTER TABLE public.whatsapp_templates ALTER COLUMN variable_schema SET DEFAULT '[]'::jsonb;
ALTER TABLE public.whatsapp_templates ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.whatsapp_templates ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.workflow_registry ALTER COLUMN is_active SET DEFAULT true;
ALTER TABLE public.workflow_registry ALTER COLUMN writes_audit_log SET DEFAULT false;
ALTER TABLE public.workflow_registry ALTER COLUMN audit_aliases SET DEFAULT '{}'::text[];


-- ========================================================================
-- 4. SEQUENCE OWNERSHIP
-- ========================================================================
ALTER SEQUENCE public.competitors_id_seq OWNED BY public.competitors.id;
ALTER SEQUENCE public.leads_id_seq OWNED BY public.leads.id;
ALTER SEQUENCE public.rag_documents_id_seq OWNED BY public.rag_documents.id;


-- ========================================================================
-- 5. PRIMARY KEY / UNIQUE / EXCLUDE CONSTRAINTS
-- ========================================================================
ALTER TABLE public.channel_message_events ADD CONSTRAINT channel_message_events_channel_direction_extmsg_key UNIQUE (tenant_id, integration_id, direction, external_message_id);
ALTER TABLE public.channel_registry ADD CONSTRAINT channel_registry_integration_tenant_key UNIQUE (integration_id, tenant_id);
ALTER TABLE public.policy_jurisdiction ADD CONSTRAINT policy_jurisdiction_code_owner_uq UNIQUE (code, owner_kind);
ALTER TABLE public.policy_unit ADD CONSTRAINT policy_unit_code_kind_uq UNIQUE (code, value_kind);
ALTER TABLE public.policy_unmigrated_constant ADD CONSTRAINT policy_unmigrated_constant_uq UNIQUE (layer, location, snippet);
ALTER TABLE public.tenants ADD CONSTRAINT tenants_slug_key UNIQUE (slug);
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT whatsapp_delivery_events_idempotency UNIQUE (tenant_id, provider_message_id, status_raw);
ALTER TABLE public.whatsapp_opt_in_event ADD CONSTRAINT whatsapp_opt_in_event_evidence_key UNIQUE (tenant_id, integration_id, customer_wa_id, event, evidence_kind, evidence_ref);
ALTER TABLE public.attribution_edge_type ADD CONSTRAINT attribution_edge_type_pkey PRIMARY KEY (edge);
ALTER TABLE public.attribution_event_type ADD CONSTRAINT attribution_event_type_pkey PRIMARY KEY (event);
ALTER TABLE public.attribution_link_basis ADD CONSTRAINT attribution_link_basis_pkey PRIMARY KEY (basis);
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
ALTER TABLE public.channel_message_events ADD CONSTRAINT channel_message_events_pkey PRIMARY KEY (event_id);
ALTER TABLE public.channel_provider_capability ADD CONSTRAINT channel_provider_capability_pkey PRIMARY KEY (provider, send_form);
ALTER TABLE public.channel_provider_rank ADD CONSTRAINT channel_provider_rank_pkey PRIMARY KEY (provider);
ALTER TABLE public.channel_registry ADD CONSTRAINT channel_registry_pkey PRIMARY KEY (integration_id);
ALTER TABLE public.channel_send_directive ADD CONSTRAINT channel_send_directive_pkey PRIMARY KEY (directive_id);
ALTER TABLE public.channel_send_form ADD CONSTRAINT channel_send_form_pkey PRIMARY KEY (code);
ALTER TABLE public.communication_logs ADD CONSTRAINT communication_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.competitors ADD CONSTRAINT competitors_pkey PRIMARY KEY (id);
ALTER TABLE public.customer_360_profiles ADD CONSTRAINT customer_360_profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.deal_rescue_evidence_sources ADD CONSTRAINT deal_rescue_evidence_sources_pkey PRIMARY KEY (source);
ALTER TABLE public.deal_rescue_prerequisites ADD CONSTRAINT deal_rescue_prerequisites_pkey PRIMARY KEY (id);
ALTER TABLE public.deal_rescue_settings ADD CONSTRAINT deal_rescue_settings_pkey PRIMARY KEY (tenant_id);
ALTER TABLE public.deal_rescue_states ADD CONSTRAINT deal_rescue_states_pkey PRIMARY KEY (state);
ALTER TABLE public.deals_embeddings ADD CONSTRAINT deals_embeddings_pkey PRIMARY KEY (id);
ALTER TABLE public.finance_quotes ADD CONSTRAINT finance_quotes_pkey PRIMARY KEY (id);
ALTER TABLE public.inventory ADD CONSTRAINT inventory_pkey PRIMARY KEY (tenant_id, id);
ALTER TABLE public.inventory_action_events ADD CONSTRAINT inventory_action_events_pkey PRIMARY KEY (id);
ALTER TABLE public.inventory_action_policy ADD CONSTRAINT inventory_action_policy_pkey PRIMARY KEY (tenant_id);
ALTER TABLE public.inventory_action_reason_codes ADD CONSTRAINT inventory_action_reason_codes_pkey PRIMARY KEY (code);
ALTER TABLE public.inventory_actions ADD CONSTRAINT inventory_actions_pkey PRIMARY KEY (id);
ALTER TABLE public.inventory_profit_settings ADD CONSTRAINT inventory_profit_settings_pkey PRIMARY KEY (tenant_id);
ALTER TABLE public.kyc_documents ADD CONSTRAINT kyc_documents_pkey PRIMARY KEY (id);
ALTER TABLE public.lead_recovery_action_events ADD CONSTRAINT lead_recovery_action_events_pkey PRIMARY KEY (id);
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_pkey PRIMARY KEY (id);
ALTER TABLE public.lead_recovery_reason_codes ADD CONSTRAINT lead_recovery_reason_codes_pkey PRIMARY KEY (code);
ALTER TABLE public.lead_recovery_settings ADD CONSTRAINT lead_recovery_settings_pkey PRIMARY KEY (tenant_id);
ALTER TABLE public.lead_recovery_states ADD CONSTRAINT lead_recovery_states_pkey PRIMARY KEY (state);
ALTER TABLE public.leads ADD CONSTRAINT leads_pkey PRIMARY KEY (id);
ALTER TABLE public.policy_jurisdiction ADD CONSTRAINT policy_jurisdiction_pkey PRIMARY KEY (code);
ALTER TABLE public.policy_platform_attestation ADD CONSTRAINT policy_platform_attestation_pkey PRIMARY KEY (attestation_id);
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_pkey PRIMARY KEY (id);
ALTER TABLE public.policy_rule_event ADD CONSTRAINT policy_rule_event_pkey PRIMARY KEY (id);
ALTER TABLE public.policy_rule_type ADD CONSTRAINT policy_rule_type_pkey PRIMARY KEY (code);
ALTER TABLE public.policy_unit ADD CONSTRAINT policy_unit_pkey PRIMARY KEY (code);
ALTER TABLE public.policy_unmigrated_constant ADD CONSTRAINT policy_unmigrated_constant_pkey PRIMARY KEY (id);
ALTER TABLE public.processed_messages ADD CONSTRAINT processed_messages_pkey PRIMARY KEY (tenant_id, message_id);
ALTER TABLE public.purchase_history ADD CONSTRAINT purchase_history_pkey PRIMARY KEY (id);
ALTER TABLE public.rag_documents ADD CONSTRAINT rag_documents_pkey PRIMARY KEY (id);
ALTER TABLE public.tenant_capability ADD CONSTRAINT tenant_capability_pkey PRIMARY KEY (tenant_id, capability_key);
ALTER TABLE public.tenant_capability_catalogue ADD CONSTRAINT tenant_capability_catalogue_pkey PRIMARY KEY (capability_key);
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tenant_configuration_pkey PRIMARY KEY (tenant_id);
ALTER TABLE public.tenant_configuration_default ADD CONSTRAINT tenant_configuration_default_pkey PRIMARY KEY (setting_key);
ALTER TABLE public.tenant_members ADD CONSTRAINT tenant_members_pkey PRIMARY KEY (tenant_id, auth_user_id);
ALTER TABLE public.tenants ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);
ALTER TABLE public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE public.whatsapp_contacts ADD CONSTRAINT whatsapp_contacts_pkey PRIMARY KEY (tenant_id, chat_id);
ALTER TABLE public.whatsapp_conversation_state ADD CONSTRAINT whatsapp_conversation_state_pkey PRIMARY KEY (tenant_id, integration_id, customer_wa_id);
ALTER TABLE public.whatsapp_customer_message_seen ADD CONSTRAINT whatsapp_customer_message_seen_pkey PRIMARY KEY (tenant_id, integration_id, customer_wa_id, external_message_id);
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT whatsapp_delivery_events_pkey PRIMARY KEY (delivery_event_id);
ALTER TABLE public.whatsapp_message_intent ADD CONSTRAINT whatsapp_message_intent_pkey PRIMARY KEY (code);
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT whatsapp_message_usage_pkey PRIMARY KEY (usage_id);
ALTER TABLE public.whatsapp_opt_in_event ADD CONSTRAINT whatsapp_opt_in_event_pkey PRIMARY KEY (id);
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT whatsapp_templates_pkey PRIMARY KEY (template_id);
ALTER TABLE public.workflow_registry ADD CONSTRAINT workflow_registry_pkey PRIMARY KEY (id);


-- ========================================================================
-- 6. INDEXES (those not backing a constraint)
-- ========================================================================
CREATE INDEX audit_log_tenant_id_idx ON public.audit_log USING btree (tenant_id);
CREATE INDEX channel_message_events_customer_idx ON public.channel_message_events USING btree (tenant_id, customer_external_id);
CREATE INDEX channel_message_events_integration_idx ON public.channel_message_events USING btree (integration_id);
CREATE INDEX channel_message_events_tenant_received_idx ON public.channel_message_events USING btree (tenant_id, received_at DESC);
CREATE INDEX channel_registry_tenant_idx ON public.channel_registry USING btree (tenant_id);
CREATE UNIQUE INDEX channel_registry_type_identifier_key ON public.channel_registry USING btree (channel_type, external_identifier);
CREATE INDEX channel_send_directive_customer_idx ON public.channel_send_directive USING btree (tenant_id, customer_external_id, routed_at DESC);
CREATE INDEX channel_send_directive_pending_idx ON public.channel_send_directive USING btree (tenant_id, send_result) WHERE (send_result = 'PENDING'::text);
CREATE INDEX channel_send_directive_provider_msg_idx ON public.channel_send_directive USING btree (provider_message_id) WHERE (provider_message_id IS NOT NULL);
CREATE UNIQUE INDEX channel_send_directive_request_ref_key ON public.channel_send_directive USING btree (tenant_id, request_ref) WHERE (request_ref IS NOT NULL);
CREATE INDEX channel_send_directive_tenant_routed_idx ON public.channel_send_directive USING btree (tenant_id, routed_at DESC);
CREATE UNIQUE INDEX communication_logs_tenant_direction_extmsg_key ON public.communication_logs USING btree (tenant_id, direction, external_message_id);
CREATE INDEX communication_logs_tenant_id_idx ON public.communication_logs USING btree (tenant_id);
CREATE INDEX competitors_listing_recent_idx ON public.competitors USING btree (competitor, model, scraped_at DESC);
CREATE INDEX competitors_tenant_id_idx ON public.competitors USING btree (tenant_id);
CREATE UNIQUE INDEX customer_360_profiles_tenant_customer_id_key ON public.customer_360_profiles USING btree (tenant_id, customer_id);
CREATE INDEX customer_360_profiles_tenant_id_idx ON public.customer_360_profiles USING btree (tenant_id);
CREATE INDEX daily_metrics_tenant_id_idx ON public.daily_metrics USING btree (tenant_id);
CREATE UNIQUE INDEX daily_metrics_tenant_snapshot_key ON public.daily_metrics USING btree (tenant_id, snapshot_date);
CREATE UNIQUE INDEX deals_embeddings_tenant_deal_id_key ON public.deals_embeddings USING btree (tenant_id, deal_id);
CREATE INDEX deals_embeddings_tenant_id_idx ON public.deals_embeddings USING btree (tenant_id);
CREATE INDEX finance_quotes_tenant_id_idx ON public.finance_quotes USING btree (tenant_id);
CREATE INDEX idx_audit_log_lead_email ON public.audit_log USING btree (lead_email);
CREATE INDEX idx_audit_log_logged_at ON public.audit_log USING btree (logged_at DESC);
CREATE INDEX idx_audit_log_status ON public.audit_log USING btree (status);
CREATE INDEX idx_audit_log_workflow ON public.audit_log USING btree (workflow);
CREATE INDEX idx_c360_email ON public.customer_360_profiles USING btree (email);
CREATE INDEX idx_comm_logs_created_at ON public.communication_logs USING btree (created_at DESC);
CREATE INDEX idx_comm_logs_lead_email ON public.communication_logs USING btree (lead_email);
CREATE INDEX idx_fq_created ON public.finance_quotes USING btree (created_at DESC);
CREATE INDEX idx_fq_email ON public.finance_quotes USING btree (lead_email);
CREATE INDEX idx_inventory_aging ON public.inventory USING btree (aging_alert);
CREATE INDEX idx_kyc_created ON public.kyc_documents USING btree (created_at DESC);
CREATE INDEX idx_kyc_documents_reviewed_by ON public.kyc_documents USING btree (reviewed_by);
CREATE INDEX idx_kyc_documents_void ON public.kyc_documents USING btree (voided_at) WHERE (void_reason IS NOT NULL);
CREATE INDEX idx_kyc_email ON public.kyc_documents USING btree (lead_email);
CREATE INDEX idx_kyc_verdict ON public.kyc_documents USING btree (verdict);
CREATE INDEX idx_leads_assigned_to_id ON public.leads USING btree (assigned_to_id);
CREATE INDEX idx_leads_created_at ON public.leads USING btree (created_at DESC);
CREATE INDEX idx_leads_email ON public.leads USING btree (email);
CREATE INDEX idx_leads_escalated_at ON public.leads USING btree (escalated_at DESC NULLS LAST) WHERE (escalated_at IS NOT NULL);
CREATE INDEX idx_leads_phone_digits ON public.leads USING btree (regexp_replace(COALESCE(phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text));
CREATE INDEX idx_leads_status ON public.leads USING btree (status);
CREATE INDEX idx_leads_status_crm_synced ON public.leads USING btree (status, crm_synced_at, created_at DESC);
CREATE INDEX idx_leads_unmeasured_email ON public.leads USING btree (email) WHERE (response_time_minutes IS NULL);
CREATE INDEX idx_ph_email ON public.purchase_history USING btree (email);
CREATE INDEX idx_ph_phone ON public.purchase_history USING btree (phone);
CREATE INDEX idx_users_role_status ON public.users USING btree (role, status);
CREATE INDEX idx_whatsapp_contacts_lead ON public.whatsapp_contacts USING btree (lead_email);
CREATE INDEX idx_whatsapp_contacts_phone ON public.whatsapp_contacts USING btree (phone);
CREATE INDEX inventory_action_events_action_idx ON public.inventory_action_events USING btree (action_id, at);
CREATE UNIQUE INDEX inventory_actions_one_live_per_unit ON public.inventory_actions USING btree (tenant_id, unit_id) WHERE (status = ANY (ARRAY['PROPOSED'::text, 'APPROVED'::text, 'DEFERRED'::text]));
CREATE INDEX inventory_actions_tenant_status_idx ON public.inventory_actions USING btree (tenant_id, status, proposed_at DESC);
CREATE INDEX inventory_actions_tenant_unit_idx ON public.inventory_actions USING btree (tenant_id, unit_id, proposed_at DESC);
CREATE INDEX inventory_id_idx ON public.inventory USING btree (id);
CREATE INDEX inventory_tenant_id_idx ON public.inventory USING btree (tenant_id);
CREATE INDEX kyc_documents_retention_idx ON public.kyc_documents USING btree (retain_until) WHERE (purged_at IS NULL);
CREATE INDEX kyc_documents_tenant_id_idx ON public.kyc_documents USING btree (tenant_id);
CREATE INDEX lead_recovery_action_events_action_idx ON public.lead_recovery_action_events USING btree (action_id, at);
CREATE INDEX lead_recovery_actions_live_idx ON public.lead_recovery_actions USING btree (tenant_id, lead_id) WHERE (status = ANY (ARRAY['PROPOSED'::text, 'APPROVED'::text, 'DEFERRED'::text]));
CREATE INDEX lead_recovery_actions_tenant_status_idx ON public.lead_recovery_actions USING btree (tenant_id, status);
CREATE UNIQUE INDEX leads_tenant_email_key ON public.leads USING btree (tenant_id, email);
CREATE INDEX leads_tenant_id_idx ON public.leads USING btree (tenant_id);
CREATE INDEX policy_platform_attestation_rule_ix ON public.policy_platform_attestation USING btree (rule_id, attested_at DESC);
CREATE INDEX policy_rule_event_rule_ix ON public.policy_rule_event USING btree (rule_id, at);
CREATE UNIQUE INDEX policy_rule_global_version_uq ON public.policy_rule USING btree (jurisdiction, rule_type, rule_name, version) WHERE (tenant_id IS NULL);
CREATE INDEX policy_rule_lookup_ix ON public.policy_rule USING btree (jurisdiction, rule_type, rule_name, status);
CREATE UNIQUE INDEX policy_rule_supersedes_uq ON public.policy_rule USING btree (supersedes_id) WHERE (supersedes_id IS NOT NULL);
CREATE INDEX policy_rule_tenant_ix ON public.policy_rule USING btree (tenant_id) WHERE (tenant_id IS NOT NULL);
CREATE UNIQUE INDEX policy_rule_tenant_version_uq ON public.policy_rule USING btree (tenant_id, jurisdiction, rule_type, rule_name, version) WHERE (tenant_id IS NOT NULL);
CREATE INDEX processed_messages_message_id_idx ON public.processed_messages USING btree (message_id);
CREATE INDEX processed_messages_processed_at_idx ON public.processed_messages USING btree (processed_at);
CREATE INDEX processed_messages_tenant_id_idx ON public.processed_messages USING btree (tenant_id);
CREATE INDEX purchase_history_deal_id_idx ON public.purchase_history USING btree (deal_id);
CREATE INDEX purchase_history_lead_id_idx ON public.purchase_history USING btree (lead_id);
CREATE UNIQUE INDEX purchase_history_tenant_deal_id_key ON public.purchase_history USING btree (tenant_id, deal_id) WHERE (deal_id IS NOT NULL);
CREATE INDEX purchase_history_tenant_id_idx ON public.purchase_history USING btree (tenant_id);
CREATE INDEX rag_documents_search_vector_idx ON public.rag_documents USING gin (search_vector);
CREATE INDEX rag_documents_tenant_id_idx ON public.rag_documents USING btree (tenant_id);
CREATE INDEX rag_documents_trgm_idx ON public.rag_documents USING gin ((((((COALESCE(doc_title, ''::text) || ' '::text) || COALESCE(section, ''::text)) || ' '::text) || COALESCE(content, ''::text))) gin_trgm_ops);
CREATE INDEX tenant_members_auth_user_idx ON public.tenant_members USING btree (auth_user_id);
CREATE UNIQUE INDEX tenants_one_unattributed_default ON public.tenants USING btree ((true)) WHERE is_unattributed_default;
CREATE INDEX users_email_idx ON public.users USING btree (email);
CREATE UNIQUE INDEX users_tenant_email_key ON public.users USING btree (tenant_id, email);
CREATE INDEX users_tenant_id_idx ON public.users USING btree (tenant_id);
CREATE INDEX whatsapp_contacts_chat_id_idx ON public.whatsapp_contacts USING btree (chat_id);
CREATE INDEX whatsapp_contacts_tenant_id_idx ON public.whatsapp_contacts USING btree (tenant_id);
CREATE INDEX whatsapp_conversation_state_tenant_recent_idx ON public.whatsapp_conversation_state USING btree (tenant_id, last_customer_message_at DESC);
CREATE INDEX whatsapp_delivery_events_event_idx ON public.whatsapp_delivery_events USING btree (event_id) WHERE (event_id IS NOT NULL);
CREATE INDEX whatsapp_delivery_events_message_idx ON public.whatsapp_delivery_events USING btree (tenant_id, provider_message_id, status_at);
CREATE INDEX whatsapp_delivery_events_unlinked_idx ON public.whatsapp_delivery_events USING btree (tenant_id, integration_id, provider_message_id) WHERE (link_state = 'UNLINKED_NO_OUTBOUND_EVENT'::text);
CREATE INDEX whatsapp_message_usage_awaiting_idx ON public.whatsapp_message_usage USING btree (tenant_id, sent_at) WHERE (billing_fact_state = 'AWAITING_PROVIDER_REPORT'::text);
CREATE INDEX whatsapp_message_usage_cost_state_idx ON public.whatsapp_message_usage USING btree (tenant_id, cost_state, sent_at);
CREATE INDEX whatsapp_message_usage_month_idx ON public.whatsapp_message_usage USING btree (tenant_id, sent_at);
CREATE UNIQUE INDEX whatsapp_message_usage_one_per_message ON public.whatsapp_message_usage USING btree (tenant_id, event_id);
CREATE INDEX whatsapp_message_usage_template_idx ON public.whatsapp_message_usage USING btree (template_id) WHERE (template_id IS NOT NULL);
CREATE INDEX whatsapp_opt_in_event_latest_idx ON public.whatsapp_opt_in_event USING btree (tenant_id, integration_id, customer_wa_id, occurred_at DESC, recorded_at DESC);
CREATE UNIQUE INDEX whatsapp_templates_identity_key ON public.whatsapp_templates USING btree (tenant_id, provider, COALESCE(waba_ref, ''::text), name, language);
CREATE INDEX whatsapp_templates_integration_idx ON public.whatsapp_templates USING btree (integration_id) WHERE (integration_id IS NOT NULL);
CREATE UNIQUE INDEX whatsapp_templates_provider_id_key ON public.whatsapp_templates USING btree (tenant_id, provider, provider_template_id) WHERE (provider_template_id IS NOT NULL);
CREATE INDEX whatsapp_templates_staleness_idx ON public.whatsapp_templates USING btree (tenant_id, provider_status, provider_status_observed_at NULLS FIRST);


-- ========================================================================
-- 7. FOREIGN KEYS
-- ========================================================================
ALTER TABLE public.attribution_edge_type ADD CONSTRAINT attribution_edge_type_basis_fkey FOREIGN KEY (basis) REFERENCES attribution_link_basis(basis);
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.channel_message_events ADD CONSTRAINT channel_message_events_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES channel_registry(integration_id) ON DELETE RESTRICT;
ALTER TABLE public.channel_message_events ADD CONSTRAINT channel_message_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.channel_provider_capability ADD CONSTRAINT channel_provider_capability_send_form_fkey FOREIGN KEY (send_form) REFERENCES channel_send_form(code) ON DELETE RESTRICT;
ALTER TABLE public.channel_registry ADD CONSTRAINT channel_registry_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.channel_send_directive ADD CONSTRAINT channel_send_directive_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES channel_registry(integration_id) ON DELETE RESTRICT;
ALTER TABLE public.channel_send_directive ADD CONSTRAINT channel_send_directive_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.channel_send_directive ADD CONSTRAINT csd_carrier_belongs_to_the_tenant FOREIGN KEY (integration_id, tenant_id) REFERENCES channel_registry(integration_id, tenant_id) ON DELETE RESTRICT;
ALTER TABLE public.communication_logs ADD CONSTRAINT communication_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.competitors ADD CONSTRAINT competitors_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.customer_360_profiles ADD CONSTRAINT customer_360_profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.daily_metrics ADD CONSTRAINT daily_metrics_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.deal_rescue_settings ADD CONSTRAINT deal_rescue_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.deals_embeddings ADD CONSTRAINT deals_embeddings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.finance_quotes ADD CONSTRAINT finance_quotes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.inventory ADD CONSTRAINT inventory_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.inventory_action_events ADD CONSTRAINT inventory_action_events_action_id_fkey FOREIGN KEY (action_id) REFERENCES inventory_actions(id) ON DELETE CASCADE;
ALTER TABLE public.inventory_action_events ADD CONSTRAINT inventory_action_events_actor_staff_id_fkey FOREIGN KEY (actor_staff_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_action_events ADD CONSTRAINT inventory_action_events_audit_log_id_fkey FOREIGN KEY (audit_log_id) REFERENCES audit_log(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_action_events ADD CONSTRAINT inventory_action_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.inventory_action_policy ADD CONSTRAINT inventory_action_policy_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.inventory_actions ADD CONSTRAINT inventory_actions_assigned_to_staff_id_fkey FOREIGN KEY (assigned_to_staff_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_actions ADD CONSTRAINT inventory_actions_decided_by_staff_id_fkey FOREIGN KEY (decided_by_staff_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_actions ADD CONSTRAINT inventory_actions_executed_by_staff_id_fkey FOREIGN KEY (executed_by_staff_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_actions ADD CONSTRAINT inventory_actions_outcome_purchase_id_fkey FOREIGN KEY (outcome_purchase_id) REFERENCES purchase_history(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_actions ADD CONSTRAINT inventory_actions_outcome_recorded_by_staff_id_fkey FOREIGN KEY (outcome_recorded_by_staff_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_actions ADD CONSTRAINT inventory_actions_proposed_by_staff_id_fkey FOREIGN KEY (proposed_by_staff_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_actions ADD CONSTRAINT inventory_actions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.inventory_actions ADD CONSTRAINT inventory_actions_unit_fkey FOREIGN KEY (tenant_id, unit_id) REFERENCES inventory(tenant_id, id) ON DELETE RESTRICT;
ALTER TABLE public.inventory_profit_settings ADD CONSTRAINT inventory_profit_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.kyc_documents ADD CONSTRAINT kyc_documents_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.kyc_documents ADD CONSTRAINT kyc_documents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.lead_recovery_action_events ADD CONSTRAINT lead_recovery_action_events_action_id_fkey FOREIGN KEY (action_id) REFERENCES lead_recovery_actions(id) ON DELETE CASCADE;
ALTER TABLE public.lead_recovery_action_events ADD CONSTRAINT lead_recovery_action_events_actor_staff_id_fkey FOREIGN KEY (actor_staff_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.lead_recovery_action_events ADD CONSTRAINT lead_recovery_action_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_assigned_to_staff_id_fkey FOREIGN KEY (assigned_to_staff_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_decided_by_staff_id_fkey FOREIGN KEY (decided_by_staff_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_executed_by_staff_id_fkey FOREIGN KEY (executed_by_staff_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE RESTRICT;
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_outcome_purchase_id_fkey FOREIGN KEY (outcome_purchase_id) REFERENCES purchase_history(id) ON DELETE SET NULL;
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_outcome_recorded_by_staff_id_fkey FOREIGN KEY (outcome_recorded_by_staff_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_proposed_by_staff_id_fkey FOREIGN KEY (proposed_by_staff_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.lead_recovery_settings ADD CONSTRAINT lead_recovery_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.leads ADD CONSTRAINT leads_assigned_to_id_fkey FOREIGN KEY (assigned_to_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.leads ADD CONSTRAINT leads_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.policy_platform_attestation ADD CONSTRAINT policy_platform_attestation_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES policy_rule(id) ON DELETE RESTRICT;
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_jurisdiction_is_registered FOREIGN KEY (jurisdiction) REFERENCES policy_jurisdiction(code) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_jurisdiction_owner_agrees FOREIGN KEY (jurisdiction, jurisdiction_owner_kind) REFERENCES policy_jurisdiction(code, owner_kind) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_platform_attestation_id_fkey FOREIGN KEY (platform_attestation_id) REFERENCES policy_platform_attestation(attestation_id) ON DELETE RESTRICT;
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_rule_type_fkey FOREIGN KEY (rule_type) REFERENCES policy_rule_type(code);
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES policy_rule(id) ON DELETE RESTRICT;
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_unit_fkey FOREIGN KEY (unit) REFERENCES policy_unit(code);
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_unit_kind_fk FOREIGN KEY (unit, value_kind) REFERENCES policy_unit(code, value_kind);
ALTER TABLE public.policy_rule_event ADD CONSTRAINT policy_rule_event_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES policy_rule(id) ON DELETE RESTRICT;
ALTER TABLE public.policy_rule_event ADD CONSTRAINT policy_rule_event_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.policy_unmigrated_constant ADD CONSTRAINT policy_unmigrated_constant_proposed_rule_type_fkey FOREIGN KEY (proposed_rule_type) REFERENCES policy_rule_type(code);
ALTER TABLE public.processed_messages ADD CONSTRAINT processed_messages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.purchase_history ADD CONSTRAINT purchase_history_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_history ADD CONSTRAINT purchase_history_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.rag_documents ADD CONSTRAINT rag_documents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.tenant_capability ADD CONSTRAINT tenant_capability_capability_key_fkey FOREIGN KEY (capability_key) REFERENCES tenant_capability_catalogue(capability_key);
ALTER TABLE public.tenant_capability ADD CONSTRAINT tenant_capability_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tenant_configuration_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.tenant_members ADD CONSTRAINT tenant_members_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.tenant_members ADD CONSTRAINT tenant_members_staff_user_id_fkey FOREIGN KEY (staff_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE public.tenant_members ADD CONSTRAINT tenant_members_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE public.users ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_contacts ADD CONSTRAINT whatsapp_contacts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_conversation_state ADD CONSTRAINT whatsapp_conversation_state_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES channel_registry(integration_id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_conversation_state ADD CONSTRAINT whatsapp_conversation_state_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_customer_message_seen ADD CONSTRAINT whatsapp_customer_message_seen_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES channel_registry(integration_id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_customer_message_seen ADD CONSTRAINT whatsapp_customer_message_seen_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT whatsapp_delivery_events_event_id_fkey FOREIGN KEY (event_id) REFERENCES channel_message_events(event_id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT whatsapp_delivery_events_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES channel_registry(integration_id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT whatsapp_delivery_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT whatsapp_message_usage_event_id_fkey FOREIGN KEY (event_id) REFERENCES channel_message_events(event_id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT whatsapp_message_usage_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES channel_registry(integration_id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT whatsapp_message_usage_latest_status_delivery_event_id_fkey FOREIGN KEY (latest_status_delivery_event_id) REFERENCES whatsapp_delivery_events(delivery_event_id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT whatsapp_message_usage_policy_rule_id_fkey FOREIGN KEY (policy_rule_id) REFERENCES policy_rule(id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT whatsapp_message_usage_provider_pricing_delivery_event_id_fkey FOREIGN KEY (provider_pricing_delivery_event_id) REFERENCES whatsapp_delivery_events(delivery_event_id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT whatsapp_message_usage_template_id_fkey FOREIGN KEY (template_id) REFERENCES whatsapp_templates(template_id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT whatsapp_message_usage_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_opt_in_event ADD CONSTRAINT whatsapp_opt_in_event_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES channel_registry(integration_id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_opt_in_event ADD CONSTRAINT whatsapp_opt_in_event_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT whatsapp_templates_integration_id_fkey FOREIGN KEY (integration_id) REFERENCES channel_registry(integration_id) ON DELETE RESTRICT;
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT whatsapp_templates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;


-- ========================================================================
-- 8. CHECK CONSTRAINTS
-- ========================================================================
ALTER TABLE public.attribution_edge_type ADD CONSTRAINT attribution_edge_type_absent_has_unlock CHECK (((state = ANY (ARRAY['PRESENT_KEYED'::text, 'PRESENT_SAME_ROW'::text, 'PRESENT_RESOLVED'::text, 'PRESENT_HUMAN_ONLY'::text])) OR ((unlocked_by IS NOT NULL) AND (unlock_rank IS NOT NULL))));
ALTER TABLE public.attribution_edge_type ADD CONSTRAINT attribution_edge_type_state_check CHECK ((state = ANY (ARRAY['PRESENT_KEYED'::text, 'PRESENT_SAME_ROW'::text, 'PRESENT_RESOLVED'::text, 'PRESENT_HUMAN_ONLY'::text, 'TEXT_ONLY_REFUSED'::text, 'ABSENT_NO_FIELD'::text, 'ABSENT_NO_TABLE'::text, 'BLOCKED_BY_UPSTREAM'::text])));
ALTER TABLE public.attribution_event_type ADD CONSTRAINT attribution_event_type_state_check CHECK ((state = ANY (ARRAY['PRESENT'::text, 'PRESENT_UNRESOLVED'::text, 'PRESENT_CONFLATED'::text, 'PRESENT_NO_ROWS'::text, 'ABSENT_NO_SOURCE'::text])));
ALTER TABLE public.attribution_link_basis ADD CONSTRAINT attribution_link_basis_confidence_check CHECK ((default_confidence = ANY (ARRAY['HIGH'::text, 'MEDIUM'::text, 'LOW'::text, 'NONE'::text])));
ALTER TABLE public.attribution_link_basis ADD CONSTRAINT attribution_link_basis_refusal_has_no_confidence CHECK (((is_evidence AND (default_confidence <> 'NONE'::text)) OR ((NOT is_evidence) AND (default_confidence = 'NONE'::text))));
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_status_check CHECK ((status = upper(status)));
ALTER TABLE public.channel_message_events ADD CONSTRAINT channel_message_events_channel_type_check CHECK ((channel_type = ANY (ARRAY['whatsapp_waha_session'::text, 'whatsapp_cloud_phone_number_id'::text])));
ALTER TABLE public.channel_message_events ADD CONSTRAINT channel_message_events_cloud_requires_signature CHECK (((provider <> 'whatsapp_cloud'::text) OR (origin_verified = 'hmac_sha256_x_hub'::text)));
ALTER TABLE public.channel_message_events ADD CONSTRAINT channel_message_events_customer_phone_is_digits_or_null CHECK (((customer_phone IS NULL) OR (customer_phone ~ '^[0-9]{6,20}$'::text)));
ALTER TABLE public.channel_message_events ADD CONSTRAINT channel_message_events_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])));
ALTER TABLE public.channel_message_events ADD CONSTRAINT channel_message_events_extmsg_shape CHECK (((external_message_id = btrim(external_message_id)) AND ((length(external_message_id) >= 1) AND (length(external_message_id) <= 300))));
ALTER TABLE public.channel_message_events ADD CONSTRAINT channel_message_events_media_ref_is_a_reference CHECK (((media_ref IS NULL) OR ((length(media_ref) <= 500) AND (media_ref !~ '^data:'::text))));
ALTER TABLE public.channel_message_events ADD CONSTRAINT channel_message_events_message_kind_check CHECK ((message_kind = ANY (ARRAY['text'::text, 'image'::text, 'audio'::text, 'video'::text, 'document'::text, 'sticker'::text, 'location'::text, 'contacts'::text, 'interactive'::text, 'button'::text, 'order'::text, 'reaction'::text, 'system'::text, 'unsupported'::text])));
ALTER TABLE public.channel_message_events ADD CONSTRAINT channel_message_events_origin_verified_check CHECK ((origin_verified = ANY (ARRAY['hmac_sha256_x_hub'::text, 'shared_header'::text, 'unverified'::text])));
ALTER TABLE public.channel_message_events ADD CONSTRAINT channel_message_events_provider_check CHECK ((provider = ANY (ARRAY['waha'::text, 'whatsapp_cloud'::text])));
ALTER TABLE public.channel_message_events ADD CONSTRAINT channel_message_events_provider_matches_channel_type CHECK ((((provider = 'waha'::text) AND (channel_type = 'whatsapp_waha_session'::text)) OR ((provider = 'whatsapp_cloud'::text) AND (channel_type = 'whatsapp_cloud_phone_number_id'::text))));
ALTER TABLE public.channel_provider_capability ADD CONSTRAINT channel_provider_capability_basis_check CHECK ((basis = ANY (ARRAY['MEASURED_HERE'::text, 'VENDOR_DOCUMENTED'::text, 'STRUCTURAL'::text])));
ALTER TABLE public.channel_provider_capability ADD CONSTRAINT channel_provider_capability_measured_is_dated CHECK (((basis <> 'MEASURED_HERE'::text) OR (verified_at IS NOT NULL)));
ALTER TABLE public.channel_provider_capability ADD CONSTRAINT channel_provider_capability_provider_check CHECK ((provider = ANY (ARRAY['waha'::text, 'whatsapp_cloud'::text])));
ALTER TABLE public.channel_provider_capability ADD CONSTRAINT channel_provider_capability_support_state_check CHECK ((support_state = ANY (ARRAY['SUPPORTED'::text, 'NOT_SUPPORTED'::text])));
ALTER TABLE public.channel_provider_rank ADD CONSTRAINT channel_provider_rank_provider_check CHECK ((provider = ANY (ARRAY['waha'::text, 'whatsapp_cloud'::text])));
ALTER TABLE public.channel_provider_rank ADD CONSTRAINT channel_provider_rank_rank_range CHECK (((rank >= 1) AND (rank <= 999)));
ALTER TABLE public.channel_registry ADD CONSTRAINT channel_registry_channel_type_check CHECK ((channel_type = ANY (ARRAY['whatsapp_waha_session'::text, 'whatsapp_cloud_phone_number_id'::text])));
ALTER TABLE public.channel_registry ADD CONSTRAINT channel_registry_channel_type_normalised CHECK ((channel_type = lower(btrim(channel_type))));
ALTER TABLE public.channel_registry ADD CONSTRAINT channel_registry_credential_ref_is_not_a_secret CHECK (((credential_ref IS NULL) OR ((length(credential_ref) <= 200) AND (credential_ref !~ '[[:space:]]'::text) AND (credential_ref !~* '^(eyJ|sk-|sb_secret_|sbp_|service_role|bearer)'::text))));
ALTER TABLE public.channel_registry ADD CONSTRAINT channel_registry_identifier_normalised CHECK (((external_identifier = lower(btrim(external_identifier))) AND ((length(external_identifier) >= 1) AND (length(external_identifier) <= 200))));
ALTER TABLE public.channel_registry ADD CONSTRAINT channel_registry_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'pending'::text, 'revoked'::text])));
ALTER TABLE public.channel_send_directive ADD CONSTRAINT csd_blocked_never_sends CHECK (((policy_decision IS DISTINCT FROM 'BLOCKED'::text) OR (directive = 'DO_NOT_SEND'::text)));
ALTER TABLE public.channel_send_directive ADD CONSTRAINT csd_credential_ref_is_not_a_secret CHECK (((credential_ref IS NULL) OR ((length(credential_ref) <= 200) AND (credential_ref !~ '[[:space:]]'::text) AND (credential_ref !~* '^(eyJ|sk-|sb_secret_|sbp_|service_role|bearer)'::text))));
ALTER TABLE public.channel_send_directive ADD CONSTRAINT csd_directive_check CHECK ((directive = ANY (ARRAY['SEND'::text, 'DO_NOT_SEND'::text])));
ALTER TABLE public.channel_send_directive ADD CONSTRAINT csd_only_a_send_gets_a_result CHECK (((directive = 'SEND'::text) OR (send_result = ANY (ARRAY['PENDING'::text, 'NOT_ATTEMPTED'::text]))));
ALTER TABLE public.channel_send_directive ADD CONSTRAINT csd_open_window_had_not_expired CHECK (((directive <> 'SEND'::text) OR (policy_window_state IS DISTINCT FROM 'OPEN'::text) OR ((policy_window_expires_at IS NOT NULL) AND (policy_window_expires_at > routed_at))));
ALTER TABLE public.channel_send_directive ADD CONSTRAINT csd_send_decision_is_contemporaneous CHECK (((directive <> 'SEND'::text) OR ((policy_evaluated_at IS NOT NULL) AND (policy_evaluated_at <= (routed_at + '00:01:00'::interval)) AND (policy_evaluated_at >= (routed_at - '00:05:00'::interval)))));
ALTER TABLE public.channel_send_directive ADD CONSTRAINT csd_send_names_a_carrier CHECK (((directive <> 'SEND'::text) OR ((integration_id IS NOT NULL) AND (provider IS NOT NULL) AND (resolved_send_form IS NOT NULL))));
ALTER TABLE public.channel_send_directive ADD CONSTRAINT csd_send_requires_policy_decision CHECK (((directive <> 'SEND'::text) OR ((policy_decision IS NOT NULL) AND (policy_decision = ANY (ARRAY['FREEFORM_ALLOWED'::text, 'TEMPLATE_REQUIRED'::text])))));
ALTER TABLE public.channel_send_directive ADD CONSTRAINT csd_send_result_check CHECK ((send_result = ANY (ARRAY['PENDING'::text, 'ACCEPTED_BY_PROVIDER'::text, 'REJECTED_BY_PROVIDER'::text, 'NOT_ATTEMPTED'::text, 'TRANSPORT_ERROR'::text])));
ALTER TABLE public.channel_send_directive ADD CONSTRAINT csd_template_send_has_a_ref CHECK (((outcome <> 'SENDABLE_TEMPLATE'::text) OR (template_ref IS NOT NULL)));
ALTER TABLE public.channel_send_form ADD CONSTRAINT channel_send_form_code_shape CHECK (((code = upper(code)) AND (code ~ '^[A-Z][A-Z_]{2,39}$'::text)));
ALTER TABLE public.deal_rescue_evidence_sources ADD CONSTRAINT deal_rescue_evidence_sources_evidence_tier_check CHECK ((evidence_tier = ANY (ARRAY['STRONG'::text, 'WEAK'::text, 'REFUSED'::text])));
ALTER TABLE public.deal_rescue_prerequisites ADD CONSTRAINT deal_rescue_prerequisites_kind_check CHECK ((kind = ANY (ARRAY['SCHEMA'::text, 'INTEGRATION'::text, 'OPERATIONAL'::text, 'DATA'::text, 'PRODUCT'::text])));
ALTER TABLE public.finance_quotes ADD CONSTRAINT finance_quotes_apr_range_check CHECK (((indicative_apr_pct IS NULL) OR (indicative_apr_high_pct IS NULL) OR (indicative_apr_pct <= indicative_apr_high_pct)));
ALTER TABLE public.finance_quotes ADD CONSTRAINT finance_quotes_credit_score_check CHECK (((credit_score >= 300) AND (credit_score <= 900)));
ALTER TABLE public.finance_quotes ADD CONSTRAINT finance_quotes_down_payment_pct_check CHECK (((down_payment_pct IS NULL) OR ((down_payment_pct >= (0)::numeric) AND (down_payment_pct <= (100)::numeric))));
ALTER TABLE public.finance_quotes ADD CONSTRAINT finance_quotes_emi_complete CHECK ((((monthly_payment_low_aed IS NULL) AND (monthly_payment_high_aed IS NULL)) OR ((financed_aed IS NOT NULL) AND (tenure_months IS NOT NULL) AND (down_payment_aed IS NOT NULL))));
ALTER TABLE public.finance_quotes ADD CONSTRAINT finance_quotes_equity_status_check CHECK (((equity_status IS NULL) OR (equity_status = ANY (ARRAY['Positive'::text, 'Negative'::text, 'No trade-in'::text]))));
ALTER TABLE public.finance_quotes ADD CONSTRAINT finance_quotes_equity_status_matches_trade_in CHECK ((((vehicle_value_aed IS NULL) AND ((equity_status IS NULL) OR (equity_status = 'No trade-in'::text))) OR ((vehicle_value_aed IS NOT NULL) AND (equity_status = ANY (ARRAY['Positive'::text, 'Negative'::text])))));
ALTER TABLE public.finance_quotes ADD CONSTRAINT finance_quotes_monthly_payment_range_check CHECK (((monthly_payment_low_aed IS NULL) OR (monthly_payment_high_aed IS NULL) OR (monthly_payment_low_aed <= monthly_payment_high_aed)));
ALTER TABLE public.finance_quotes ADD CONSTRAINT finance_quotes_tenure_months_check CHECK (((tenure_months IS NULL) OR ((tenure_months >= 12) AND (tenure_months <= 60))));
ALTER TABLE public.finance_quotes ADD CONSTRAINT finance_quotes_trade_in_complete CHECK ((((vehicle_value_aed IS NULL) AND (loan_payoff_aed IS NULL) AND (equity_aed IS NULL)) OR ((vehicle_value_aed IS NOT NULL) AND (loan_payoff_aed IS NOT NULL) AND (equity_aed IS NOT NULL))));
ALTER TABLE public.inventory_action_events ADD CONSTRAINT inventory_action_events_event_check CHECK ((event = ANY (ARRAY['PROPOSED'::text, 'APPROVED'::text, 'REJECTED'::text, 'DEFERRED'::text, 'ASSIGNED'::text, 'EXECUTED'::text, 'EXECUTION_FAILED'::text, 'CANCELLED'::text, 'OUTCOME_ATTRIBUTED'::text, 'OUTCOME_NOT_ATTRIBUTABLE'::text, 'APPROVAL_REFUSED'::text, 'ESCALATED'::text, 'DECISION_CONFLICT'::text])));
ALTER TABLE public.inventory_action_policy ADD CONSTRAINT inventory_action_policy_cooldown_check CHECK (((reproposal_cooldown_days >= 0) AND (reproposal_cooldown_days <= 365)));
ALTER TABLE public.inventory_action_policy ADD CONSTRAINT inventory_action_policy_tenant_roles_check CHECK ((approver_tenant_roles <@ ARRAY['owner'::text, 'admin'::text, 'manager'::text, 'member'::text]));
ALTER TABLE public.inventory_actions ADD CONSTRAINT inventory_actions_decision_stamped CHECK (((status <> ALL (ARRAY['APPROVED'::text, 'REJECTED'::text, 'DEFERRED'::text])) OR ((decided_at IS NOT NULL) AND (decided_by_authority IS NOT NULL))));
ALTER TABLE public.inventory_actions ADD CONSTRAINT inventory_actions_deferral_needs_reason CHECK (((status <> 'DEFERRED'::text) OR (decision_reason_code IS NOT NULL)));
ALTER TABLE public.inventory_actions ADD CONSTRAINT inventory_actions_execution_stamped CHECK (((executed_at IS NULL) = (status <> ALL (ARRAY['EXECUTED'::text, 'EXECUTION_FAILED'::text]))));
ALTER TABLE public.inventory_actions ADD CONSTRAINT inventory_actions_outcome_state_check CHECK ((outcome_state = ANY (ARRAY['NONE_YET'::text, 'AWAITING_OUTCOME'::text, 'ATTRIBUTED'::text, 'NOT_ATTRIBUTABLE'::text, 'CLOSED_WITHOUT_ACTION'::text])));
ALTER TABLE public.inventory_actions ADD CONSTRAINT inventory_actions_recovered_needs_real_sale CHECK (((recovered_value_aed IS NULL) OR ((outcome_state = 'ATTRIBUTED'::text) AND (outcome_purchase_id IS NOT NULL) AND (attribution_basis IS NOT NULL) AND (recovered_value_basis IS NOT NULL))));
ALTER TABLE public.inventory_actions ADD CONSTRAINT inventory_actions_rejection_needs_reason CHECK (((status <> 'REJECTED'::text) OR ((decision_reason_code IS NOT NULL) AND (length(btrim(COALESCE(decision_note, ''::text))) >= 3))));
ALTER TABLE public.inventory_actions ADD CONSTRAINT inventory_actions_status_check CHECK ((status = ANY (ARRAY['PROPOSED'::text, 'APPROVED'::text, 'REJECTED'::text, 'DEFERRED'::text, 'EXECUTED'::text, 'EXECUTION_FAILED'::text, 'CANCELLED'::text])));
ALTER TABLE public.inventory_profit_settings ADD CONSTRAINT ipset_bands_ordered CHECK ((aging_warn_days < aging_critical_days));
ALTER TABLE public.inventory_profit_settings ADD CONSTRAINT ipset_holding_provenance_needs_rate CHECK (((holding_cost_per_day_aed IS NOT NULL) OR ((holding_cost_basis IS NULL) AND (holding_cost_set_by IS NULL) AND (holding_cost_source IS NULL) AND (holding_cost_verified_at IS NULL))));
ALTER TABLE public.inventory_profit_settings ADD CONSTRAINT ipset_holding_rate_full_provenance CHECK (((holding_cost_per_day_aed IS NULL) OR ((NULLIF(btrim(holding_cost_source), ''::text) IS NOT NULL) AND (NULLIF(btrim(holding_cost_set_by), ''::text) IS NOT NULL) AND (holding_cost_verified_at IS NOT NULL) AND (holding_cost_basis = ANY (ARRAY['DEALERSHIP_SUPPLIED'::text, 'PLACEHOLDER'::text])))));
ALTER TABLE public.inventory_profit_settings ADD CONSTRAINT ipset_holding_rate_nonneg CHECK (((holding_cost_per_day_aed IS NULL) OR (holding_cost_per_day_aed >= (0)::numeric)));
ALTER TABLE public.inventory_profit_settings ADD CONSTRAINT ipset_promote_before_warn CHECK ((promote_days < aging_warn_days));
ALTER TABLE public.inventory_profit_settings ADD CONSTRAINT ipset_wholesale_after_critical CHECK ((wholesale_days >= aging_critical_days));
ALTER TABLE public.kyc_documents ADD CONSTRAINT kyc_documents_confidence_score_check CHECK (((confidence_score >= 0) AND (confidence_score <= 100)));
ALTER TABLE public.kyc_documents ADD CONSTRAINT kyc_documents_verdict_check CHECK ((verdict = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'ESCALATED'::text])));
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_decision_stamped CHECK (((status <> ALL (ARRAY['APPROVED'::text, 'REJECTED'::text, 'DEFERRED'::text])) OR ((decided_at IS NOT NULL) AND (decided_by_authority IS NOT NULL))));
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_deferral_needs_reason CHECK (((status <> 'DEFERRED'::text) OR (decision_reason_code IS NOT NULL)));
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_execution_stamped CHECK (((executed_at IS NULL) = (status <> ALL (ARRAY['EXECUTED'::text, 'EXECUTION_FAILED'::text]))));
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_opportunity_state_check CHECK ((opportunity_value_state = ANY (ARRAY['UNKNOWN_NO_LINK'::text, 'UNKNOWN_NOT_RECORDED'::text])));
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_outcome_state_check CHECK ((outcome_state = ANY (ARRAY['NONE_YET'::text, 'AWAITING_OUTCOME'::text, 'ATTRIBUTED'::text, 'NOT_ATTRIBUTABLE'::text, 'CLOSED_WITHOUT_ACTION'::text])));
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_recommendation_check CHECK ((recommendation = ANY (ARRAY['FOLLOW_UP'::text, 'ESCALATE'::text, 'ASSIGN_OWNER'::text, 'MANAGER_REVIEW'::text])));
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_recovered_needs_real_sale CHECK (((recovered_value_aed IS NULL) OR ((outcome_state = 'ATTRIBUTED'::text) AND (outcome_purchase_id IS NOT NULL) AND (attribution_basis IS NOT NULL) AND (recovered_value_basis IS NOT NULL))));
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_rejection_needs_reason CHECK (((status <> 'REJECTED'::text) OR ((decision_reason_code IS NOT NULL) AND (length(btrim(COALESCE(decision_note, ''::text))) >= 3))));
ALTER TABLE public.lead_recovery_actions ADD CONSTRAINT lead_recovery_actions_status_check CHECK ((status = ANY (ARRAY['PROPOSED'::text, 'APPROVED'::text, 'REJECTED'::text, 'DEFERRED'::text, 'EXECUTED'::text, 'EXECUTION_FAILED'::text, 'CANCELLED'::text])));
ALTER TABLE public.lead_recovery_settings ADD CONSTRAINT lead_recovery_settings_detector_max_age_hours_check CHECK (((detector_max_age_hours IS NULL) OR (detector_max_age_hours > 0)));
ALTER TABLE public.lead_recovery_settings ADD CONSTRAINT lead_recovery_settings_engagement_window_days_check CHECK (((engagement_window_days IS NULL) OR (engagement_window_days > 0)));
ALTER TABLE public.lead_recovery_settings ADD CONSTRAINT lead_recovery_settings_reproposal_cooldown_days_check CHECK (((reproposal_cooldown_days IS NULL) OR (reproposal_cooldown_days >= 0)));
ALTER TABLE public.lead_recovery_settings ADD CONSTRAINT lead_recovery_settings_silence_hours_check CHECK (((silence_hours IS NULL) OR (silence_hours > 0)));
ALTER TABLE public.lead_recovery_settings ADD CONSTRAINT lead_recovery_settings_sla_first_response_minutes_check CHECK (((sla_first_response_minutes IS NULL) OR (sla_first_response_minutes > 0)));
ALTER TABLE public.lead_recovery_settings ADD CONSTRAINT lead_recovery_settings_stale_exceeds_silence CHECK (((stale_silence_hours IS NULL) OR (silence_hours IS NULL) OR (stale_silence_hours >= silence_hours)));
ALTER TABLE public.lead_recovery_settings ADD CONSTRAINT lead_recovery_settings_stale_silence_hours_check CHECK (((stale_silence_hours IS NULL) OR (stale_silence_hours > 0)));
ALTER TABLE public.leads ADD CONSTRAINT leads_response_time_nonneg CHECK (((response_time_minutes IS NULL) OR (response_time_minutes >= 0)));
ALTER TABLE public.policy_jurisdiction ADD CONSTRAINT policy_jurisdiction_code_shape CHECK (((code = upper(code)) AND (code ~ '^[A-Z][A-Z_]{1,31}$'::text)));
ALTER TABLE public.policy_jurisdiction ADD CONSTRAINT policy_jurisdiction_owner_is_named CHECK ((NULLIF(btrim(owner_name), ''::text) IS NOT NULL));
ALTER TABLE public.policy_jurisdiction ADD CONSTRAINT policy_jurisdiction_owner_kind_vocabulary CHECK ((owner_kind = ANY (ARRAY['PLATFORM'::text, 'REGULATOR'::text, 'NEXUS'::text, 'TENANT'::text])));
ALTER TABLE public.policy_platform_attestation ADD CONSTRAINT ppa_account_check_names_the_account CHECK (((source_kind <> 'PROVIDER_ACCOUNT_CONSOLE'::text) OR (NULLIF(btrim(COALESCE(account_ref, ''::text)), ''::text) IS NOT NULL)));
ALTER TABLE public.policy_platform_attestation ADD CONSTRAINT ppa_attested_by_is_a_person CHECK (((length(btrim(attested_by)) >= 3) AND (lower(btrim(attested_by)) <> ALL (ARRAY['postgres'::text, 'service_role'::text, 'anon'::text, 'authenticated'::text, 'n8n'::text, 'nexus'::text, 'nexus os'::text, 'system'::text, 'automation'::text, 'admin'::text, 'root'::text, 'api'::text, 'operator'::text, 'platform'::text]))));
ALTER TABLE public.policy_platform_attestation ADD CONSTRAINT ppa_confidence_vocabulary CHECK ((confidence = ANY (ARRAY['HIGH'::text, 'MEDIUM'::text, 'LOW'::text])));
ALTER TABLE public.policy_platform_attestation ADD CONSTRAINT ppa_contact_is_reachable CHECK ((attested_by_contact ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text));
ALTER TABLE public.policy_platform_attestation ADD CONSTRAINT ppa_source_is_named CHECK ((NULLIF(btrim(source_name), ''::text) IS NOT NULL));
ALTER TABLE public.policy_platform_attestation ADD CONSTRAINT ppa_source_kind_vocabulary CHECK ((source_kind = ANY (ARRAY['PROVIDER_ACCOUNT_CONSOLE'::text, 'PROVIDER_PUBLIC_DOCUMENTATION'::text, 'REGULATOR_PUBLICATION'::text, 'CONTRACT'::text, 'LEGAL_ADVICE'::text])));
ALTER TABLE public.policy_platform_attestation ADD CONSTRAINT ppa_source_ref_is_a_reference_not_a_secret CHECK (((length(btrim(source_ref)) >= 4) AND (source_ref !~* '^(eyJ|sk-|sb_secret_|sbp_|service_role|bearer)'::text)));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_added_by_is_named CHECK ((NULLIF(btrim(added_by), ''::text) IS NOT NULL));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_always_names_an_origin CHECK ((NULLIF(btrim(COALESCE(source_name, ''::text)), ''::text) IS NOT NULL));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_attestation_is_for_global_rules_only CHECK (((platform_attestation_id IS NULL) OR (tenant_id IS NULL)));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_confidence_check CHECK ((confidence = ANY (ARRAY['HIGH'::text, 'MEDIUM'::text, 'LOW'::text, 'UNKNOWN'::text])));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_effective_span_is_ordered CHECK (((effective_to IS NULL) OR (effective_from IS NULL) OR (effective_to > effective_from)));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_global_verified_needs_platform_attestation CHECK (((tenant_id IS NOT NULL) OR (verification_status <> 'VERIFIED'::text) OR (platform_attestation_id IS NOT NULL)));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_jurisdiction_check CHECK (((jurisdiction = upper(jurisdiction)) AND (jurisdiction ~ '^[A-Z][A-Z_]{1,31}$'::text)));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_rule_name_check CHECK (((rule_name = upper(rule_name)) AND (rule_name ~ '^[A-Z][A-Z0-9_]{2,79}$'::text)));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_scope_follows_jurisdiction CHECK (((jurisdiction_owner_kind = 'TENANT'::text) = (tenant_id IS NOT NULL)));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_states_one_value CHECK (((verification_status = 'UNKNOWN'::text) OR ((num_nonnulls(value_numeric, value_text) = 1) AND ((value_kind <> 'NUMERIC'::text) OR (value_numeric IS NOT NULL)) AND ((value_kind = 'NUMERIC'::text) OR (value_text IS NOT NULL)))));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text, 'SUPERSEDED'::text, 'WITHDRAWN'::text])));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_unknown_carries_no_value CHECK (((verification_status <> 'UNKNOWN'::text) OR ((value_numeric IS NULL) AND (value_text IS NULL))));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_unknown_is_never_active CHECK (((verification_status <> 'UNKNOWN'::text) OR (status = ANY (ARRAY['DRAFT'::text, 'WITHDRAWN'::text]))));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_verification_status_check CHECK ((verification_status = ANY (ARRAY['VERIFIED'::text, 'NOT_VERIFIED'::text, 'UNKNOWN'::text, 'DISPUTED'::text])));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_verified_needs_evidence CHECK (((verification_status <> 'VERIFIED'::text) OR ((NULLIF(btrim(COALESCE(source_name, ''::text)), ''::text) IS NOT NULL) AND (COALESCE(NULLIF(btrim(COALESCE(source_url, ''::text)), ''::text), NULLIF(btrim(COALESCE(source_document, ''::text)), ''::text)) IS NOT NULL) AND (verification_date IS NOT NULL) AND (NULLIF(btrim(COALESCE(verified_by, ''::text)), ''::text) IS NOT NULL) AND (effective_from IS NOT NULL) AND (confidence <> 'UNKNOWN'::text))));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_version_chain CHECK ((((version = 1) AND (supersedes_id IS NULL)) OR ((version > 1) AND (supersedes_id IS NOT NULL))));
ALTER TABLE public.policy_rule ADD CONSTRAINT policy_rule_version_check CHECK ((version >= 1));
ALTER TABLE public.policy_rule_event ADD CONSTRAINT policy_rule_event_event_check CHECK ((event = ANY (ARRAY['PROPOSED'::text, 'VERIFIED'::text, 'UNVERIFIED'::text, 'DISPUTED'::text, 'ACTIVATED'::text, 'SUPERSEDED'::text, 'WITHDRAWN'::text, 'CLOSED'::text, 'ANNOTATED'::text, 'CORRECTED'::text])));
ALTER TABLE public.policy_rule_type ADD CONSTRAINT policy_rule_type_code_check CHECK (((code = upper(code)) AND (code ~ '^[A-Z][A-Z_]{2,39}$'::text)));
ALTER TABLE public.policy_unit ADD CONSTRAINT policy_unit_code_check CHECK (((code = upper(code)) AND (code ~ '^[A-Z][A-Z0-9_]{0,39}$'::text)));
ALTER TABLE public.policy_unit ADD CONSTRAINT policy_unit_value_kind_check CHECK ((value_kind = ANY (ARRAY['NUMERIC'::text, 'TEXT'::text, 'BOOLEAN'::text])));
ALTER TABLE public.policy_unmigrated_constant ADD CONSTRAINT policy_unmigrated_constant_kind_check CHECK ((kind = ANY (ARRAY['JURISDICTION'::text, 'COMMERCIAL'::text, 'OPERATIONAL'::text])));
ALTER TABLE public.policy_unmigrated_constant ADD CONSTRAINT policy_unmigrated_constant_layer_check CHECK ((layer = ANY (ARRAY['DATABASE'::text, 'DASHBOARD'::text, 'N8N_WORKFLOW'::text])));
ALTER TABLE public.tenant_capability ADD CONSTRAINT tcap_evidence_not_blank CHECK (((btrim(evidence) <> ''::text) AND (btrim(source) <> ''::text) AND (btrim(set_by) <> ''::text)));
ALTER TABLE public.tenant_capability ADD CONSTRAINT tenant_capability_state_check CHECK ((state = ANY (ARRAY['AVAILABLE'::text, 'NOT_AVAILABLE'::text])));
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tcfg_ai_tone_full_provenance CHECK (((ai_tone IS NULL) OR ((NULLIF(btrim(ai_tone_source), ''::text) IS NOT NULL) AND (NULLIF(btrim(ai_tone_set_by), ''::text) IS NOT NULL) AND (ai_tone_verified_at IS NOT NULL) AND (ai_tone_basis = ANY (ARRAY['DEALERSHIP_SUPPLIED'::text, 'OPERATOR_SUPPLIED'::text, 'PLACEHOLDER'::text])))));
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tcfg_ai_tone_not_blank CHECK (((ai_tone IS NULL) OR (btrim(ai_tone) <> ''::text)));
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tcfg_ai_tone_provenance_needs_value CHECK (((ai_tone IS NOT NULL) OR ((ai_tone_source IS NULL) AND (ai_tone_set_by IS NULL) AND (ai_tone_verified_at IS NULL) AND (ai_tone_basis IS NULL))));
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tcfg_approval_rules_full_provenance CHECK (((approval_rules IS NULL) OR ((NULLIF(btrim(approval_rules_source), ''::text) IS NOT NULL) AND (NULLIF(btrim(approval_rules_set_by), ''::text) IS NOT NULL) AND (approval_rules_verified_at IS NOT NULL) AND (approval_rules_basis = ANY (ARRAY['DEALERSHIP_SUPPLIED'::text, 'OPERATOR_SUPPLIED'::text, 'PLACEHOLDER'::text])))));
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tcfg_approval_rules_provenance_needs_value CHECK (((approval_rules IS NOT NULL) OR ((approval_rules_source IS NULL) AND (approval_rules_set_by IS NULL) AND (approval_rules_verified_at IS NULL) AND (approval_rules_basis IS NULL))));
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tcfg_approval_rules_shape CHECK (nexus_is_approval_rules(approval_rules));
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tcfg_brand_name_not_blank CHECK (((brand_name IS NULL) OR (btrim(brand_name) <> ''::text)));
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tcfg_business_hours_full_provenance CHECK (((business_hours IS NULL) OR ((NULLIF(btrim(business_hours_source), ''::text) IS NOT NULL) AND (NULLIF(btrim(business_hours_set_by), ''::text) IS NOT NULL) AND (business_hours_verified_at IS NOT NULL) AND (business_hours_basis = ANY (ARRAY['DEALERSHIP_SUPPLIED'::text, 'OPERATOR_SUPPLIED'::text, 'PLACEHOLDER'::text])))));
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tcfg_business_hours_provenance_needs_value CHECK (((business_hours IS NOT NULL) OR ((business_hours_source IS NULL) AND (business_hours_set_by IS NULL) AND (business_hours_verified_at IS NULL) AND (business_hours_basis IS NULL))));
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tcfg_business_hours_shape CHECK (nexus_is_business_hours(business_hours));
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tcfg_currency_shape CHECK (((currency IS NULL) OR (currency ~ '^[A-Z]{3}$'::text)));
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tcfg_followup_policy_full_provenance CHECK (((followup_policy IS NULL) OR ((NULLIF(btrim(followup_policy_source), ''::text) IS NOT NULL) AND (NULLIF(btrim(followup_policy_set_by), ''::text) IS NOT NULL) AND (followup_policy_verified_at IS NOT NULL) AND (followup_policy_basis = ANY (ARRAY['DEALERSHIP_SUPPLIED'::text, 'OPERATOR_SUPPLIED'::text, 'PLACEHOLDER'::text])))));
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tcfg_followup_policy_provenance_needs_value CHECK (((followup_policy IS NOT NULL) OR ((followup_policy_source IS NULL) AND (followup_policy_set_by IS NULL) AND (followup_policy_verified_at IS NULL) AND (followup_policy_basis IS NULL))));
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tcfg_followup_policy_shape CHECK (nexus_is_followup_policy(followup_policy));
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tcfg_language_shape CHECK (((default_language IS NULL) OR (default_language ~ '^[a-z]{2}(-[A-Z]{2})?$'::text)));
ALTER TABLE public.tenant_configuration ADD CONSTRAINT tcfg_timezone_shape CHECK (((timezone IS NULL) OR (timezone ~ '^[A-Za-z][A-Za-z0-9+_-]*(/[A-Za-z0-9+_-]+){0,2}$'::text)));
ALTER TABLE public.tenant_configuration_default ADD CONSTRAINT tcd_value_matches_state CHECK ((((default_state = 'PRODUCT_DEFAULT'::text) AND (default_value IS NOT NULL)) OR ((default_state = 'NO_DEFAULT'::text) AND (default_value IS NULL))));
ALTER TABLE public.tenant_configuration_default ADD CONSTRAINT tenant_configuration_default_default_state_check CHECK ((default_state = ANY (ARRAY['PRODUCT_DEFAULT'::text, 'NO_DEFAULT'::text])));
ALTER TABLE public.tenant_configuration_default ADD CONSTRAINT tenant_configuration_default_value_kind_check CHECK ((value_kind = ANY (ARRAY['TEXT'::text, 'INTEGER'::text, 'JSON'::text])));
ALTER TABLE public.tenant_configuration_default ADD CONSTRAINT tenant_configuration_default_who_decides_check CHECK ((who_decides = ANY (ARRAY['DEALERSHIP'::text, 'OPERATOR'::text])));
ALTER TABLE public.tenant_members ADD CONSTRAINT tenant_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text, 'member'::text])));
ALTER TABLE public.tenants ADD CONSTRAINT tenants_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'archived'::text])));
ALTER TABLE public.whatsapp_conversation_state ADD CONSTRAINT wa_conv_customer_id_normalised CHECK (((customer_wa_id = lower(btrim(customer_wa_id))) AND ((length(customer_wa_id) >= 1) AND (length(customer_wa_id) <= 120))));
ALTER TABLE public.whatsapp_conversation_state ADD CONSTRAINT wa_conv_inbound_carries_provenance CHECK (((last_customer_message_at IS NULL) OR (NULLIF(btrim(COALESCE(last_customer_message_source, ''::text)), ''::text) IS NOT NULL)));
ALTER TABLE public.whatsapp_conversation_state ADD CONSTRAINT wa_conv_source_needs_a_time CHECK (((last_customer_message_source IS NULL) OR (last_customer_message_at IS NOT NULL)));
ALTER TABLE public.whatsapp_customer_message_seen ADD CONSTRAINT wacms_customer_normalised CHECK (((customer_wa_id = lower(btrim(customer_wa_id))) AND ((length(customer_wa_id) >= 1) AND (length(customer_wa_id) <= 120))));
ALTER TABLE public.whatsapp_customer_message_seen ADD CONSTRAINT wacms_extmsg_shape CHECK (((external_message_id = btrim(external_message_id)) AND ((length(external_message_id) >= 1) AND (length(external_message_id) <= 300))));
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT wde_errors_is_an_array CHECK (((errors IS NULL) OR (jsonb_typeof(errors) = 'array'::text)));
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT wde_link_state_matches_the_fk CHECK ((((event_id IS NOT NULL) AND (link_state = 'LINKED'::text) AND (linked_at IS NOT NULL)) OR ((event_id IS NULL) AND (link_state = 'UNLINKED_NO_OUTBOUND_EVENT'::text) AND (linked_at IS NULL))));
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT wde_link_state_vocabulary CHECK ((link_state = ANY (ARRAY['LINKED'::text, 'UNLINKED_NO_OUTBOUND_EVENT'::text])));
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT wde_message_id_shape CHECK (((provider_message_id = btrim(provider_message_id)) AND ((length(provider_message_id) >= 1) AND (length(provider_message_id) <= 300))));
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT wde_payload_is_an_object CHECK (((jsonb_typeof(provider_payload) = 'object'::text) AND (length((provider_payload)::text) <= 20000)));
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT wde_provider_vocabulary CHECK ((provider = ANY (ARRAY['whatsapp_cloud'::text, 'waha'::text])));
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT wde_recipient_is_digits_or_null CHECK (((recipient_wa_id IS NULL) OR (recipient_wa_id ~ '^[0-9]{6,20}$'::text)));
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT wde_refs_are_not_secrets CHECK ((((conversation_id IS NULL) OR ((length(conversation_id) <= 200) AND (conversation_id !~* '^(eyJ|sk-|sb_secret_|sbp_|service_role|bearer)'::text))) AND ((pricing_model IS NULL) OR (length(pricing_model) <= 100)) AND ((pricing_category IS NULL) OR (length(pricing_category) <= 100)) AND ((pricing_type IS NULL) OR (length(pricing_type) <= 100)) AND ((conversation_origin_type IS NULL) OR (length(conversation_origin_type) <= 100))));
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT wde_status_raw_present CHECK (((NULLIF(btrim(status_raw), ''::text) IS NOT NULL) AND (length(status_raw) <= 100)));
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT wde_status_vocabulary CHECK ((status = ANY (ARRAY['sent'::text, 'delivered'::text, 'read'::text, 'failed'::text, 'played'::text, 'unmapped'::text])));
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT wde_unmapped_iff_unknown_word CHECK (((status = 'unmapped'::text) = (lower(btrim(status_raw)) <> ALL (ARRAY['sent'::text, 'delivered'::text, 'read'::text, 'failed'::text, 'played'::text]))));
ALTER TABLE public.whatsapp_delivery_events ADD CONSTRAINT wde_waha_reports_no_billing CHECK (((provider <> 'waha'::text) OR ((pricing_billable IS NULL) AND (pricing_model IS NULL) AND (pricing_category IS NULL) AND (pricing_type IS NULL) AND (conversation_id IS NULL) AND (conversation_origin_type IS NULL) AND (conversation_expiration_at IS NULL))));
ALTER TABLE public.whatsapp_message_intent ADD CONSTRAINT wa_intent_code_shape CHECK (((code = upper(code)) AND (code ~ '^[A-Z][A-Z_]{2,39}$'::text)));
ALTER TABLE public.whatsapp_message_intent ADD CONSTRAINT wa_intent_template_category_check CHECK (((template_category_if_required IS NULL) OR (template_category_if_required = ANY (ARRAY['MARKETING'::text, 'UTILITY'::text, 'AUTHENTICATION'::text]))));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_awaiting_carries_nothing CHECK (((billing_fact_state <> 'AWAITING_PROVIDER_REPORT'::text) OR ((provider_billable IS NULL) AND (provider_pricing_model IS NULL) AND (provider_pricing_category IS NULL) AND (provider_pricing_type IS NULL) AND (provider_conversation_id IS NULL) AND (provider_conversation_origin_type IS NULL) AND (provider_conversation_expiration_at IS NULL) AND (provider_pricing_observed_at IS NULL) AND (provider_pricing_delivery_event_id IS NULL))));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_billing_fact_state_vocabulary CHECK ((billing_fact_state = ANY (ARRAY['AWAITING_PROVIDER_REPORT'::text, 'PROVIDER_REPORTED'::text, 'PROVIDER_REPORTED_NO_PRICING'::text])));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_latest_status_names_its_source CHECK ((((latest_status IS NULL) AND (latest_status_at IS NULL) AND (latest_status_delivery_event_id IS NULL)) OR ((latest_status IS NOT NULL) AND (latest_status_at IS NOT NULL) AND (latest_status_delivery_event_id IS NOT NULL))));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_latest_status_vocabulary CHECK (((latest_status IS NULL) OR (latest_status = ANY (ARRAY['sent'::text, 'delivered'::text, 'read'::text, 'failed'::text, 'played'::text, 'unmapped'::text]))));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_message_category_vocabulary CHECK ((message_category = ANY (ARRAY['SERVICE'::text, 'UTILITY'::text, 'MARKETING'::text, 'AUTHENTICATION'::text, 'UNKNOWN'::text])));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_no_pricing_means_no_pricing_values CHECK (((billing_fact_state <> 'PROVIDER_REPORTED_NO_PRICING'::text) OR ((provider_billable IS NULL) AND (provider_pricing_model IS NULL) AND (provider_pricing_category IS NULL) AND (provider_pricing_type IS NULL))));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_policy_decision_vocabulary CHECK ((policy_decision = ANY (ARRAY['FREEFORM_ALLOWED'::text, 'TEMPLATE_REQUIRED'::text])));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_policy_reason_code_present CHECK (((NULLIF(btrim(policy_reason_code), ''::text) IS NOT NULL) AND (length(policy_reason_code) <= 100)));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_policy_rule_verification_vocabulary CHECK ((policy_rule_verification_status = ANY (ARRAY['VERIFIED'::text, 'NOT_VERIFIED'::text, 'UNKNOWN'::text, 'DISPUTED'::text, 'NO_RULE_APPLIED'::text])));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_reported_means_a_pricing_object_arrived CHECK (((billing_fact_state <> 'PROVIDER_REPORTED'::text) OR (provider_billable IS NOT NULL)));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_reported_names_its_source CHECK (((billing_fact_state = 'AWAITING_PROVIDER_REPORT'::text) OR ((provider_pricing_observed_at IS NOT NULL) AND (provider_pricing_delivery_event_id IS NOT NULL))));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_rule_id_pairs_with_its_status CHECK (((policy_rule_id IS NULL) = (policy_rule_verification_status = 'NO_RULE_APPLIED'::text)));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_staleness_verdict_vocabulary CHECK (((template_staleness_verdict_at_send IS NULL) OR (template_staleness_verdict_at_send = ANY (ARRAY['SEND_ALLOWED'::text, 'SENT_ON_OPERATOR_OVERRIDE'::text]))));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_status_age_only_when_a_status_was_observed CHECK ((((template_provider_status_at_send = 'UNKNOWN'::text) = (template_status_age_at_send IS NULL)) OR (template_provider_status_at_send IS NULL)));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_template_required_is_the_decision CHECK ((template_required = (policy_decision = 'TEMPLATE_REQUIRED'::text)));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_template_required_names_a_template CHECK (((template_required = false) OR (template_id IS NOT NULL)));
ALTER TABLE public.whatsapp_message_usage ADD CONSTRAINT wmu_template_send_records_the_staleness_answer CHECK (((template_id IS NULL) OR ((template_provider_status_at_send IS NOT NULL) AND (template_staleness_verdict_at_send IS NOT NULL))));
ALTER TABLE public.whatsapp_opt_in_event ADD CONSTRAINT wa_optin_customer_id_normalised CHECK (((customer_wa_id = lower(btrim(customer_wa_id))) AND ((length(customer_wa_id) >= 1) AND (length(customer_wa_id) <= 120))));
ALTER TABLE public.whatsapp_opt_in_event ADD CONSTRAINT wa_optin_event_check CHECK ((event = ANY (ARRAY['OPT_IN'::text, 'OPT_OUT'::text])));
ALTER TABLE public.whatsapp_opt_in_event ADD CONSTRAINT wa_optin_evidence_kind_check CHECK ((evidence_kind = ANY (ARRAY['WHATSAPP_MESSAGE_ID'::text, 'COMMUNICATION_LOG_ID'::text, 'FORM_SUBMISSION_ID'::text, 'DOCUMENT_REF'::text, 'SOURCE_SYSTEM_RECORD_ID'::text, 'AUDIT_LOG_ID'::text])));
ALTER TABLE public.whatsapp_opt_in_event ADD CONSTRAINT wa_optin_evidence_not_blank CHECK (((btrim(evidence_ref) <> ''::text) AND (btrim(recorded_by) <> ''::text)));
ALTER TABLE public.whatsapp_opt_in_event ADD CONSTRAINT wa_optin_import_names_a_system CHECK (((mechanism <> 'IMPORTED_FROM_SOURCE_SYSTEM'::text) OR (evidence_kind = 'SOURCE_SYSTEM_RECORD_ID'::text)));
ALTER TABLE public.whatsapp_opt_in_event ADD CONSTRAINT wa_optin_mechanism_check CHECK ((mechanism = ANY (ARRAY['CUSTOMER_MESSAGE'::text, 'WEB_FORM'::text, 'IN_STORE_SIGNED'::text, 'PHONE_RECORDED'::text, 'IMPORTED_FROM_SOURCE_SYSTEM'::text, 'OPERATOR_RECORDED'::text])));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_approved_body_must_be_the_providers CHECK (((provider_status <> 'APPROVED'::text) OR (body_text IS NULL) OR (body_text_source = 'PROVIDER_FETCHED'::text)));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_body_text_is_text_not_a_blob CHECK (((body_text IS NULL) OR ((length(body_text) <= 4096) AND (body_text !~ '^data:'::text))));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_body_text_provenance CHECK ((((body_text IS NULL) AND (body_text_source IS NULL) AND (body_text_observed_at IS NULL)) OR ((body_text IS NOT NULL) AND (body_text_source IS NOT NULL) AND (body_text_observed_at IS NOT NULL))));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_body_text_source_vocabulary CHECK (((body_text_source IS NULL) OR (body_text_source = ANY (ARRAY['NEXUS_DRAFT'::text, 'PROVIDER_FETCHED'::text]))));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_category_vocabulary CHECK ((category = ANY (ARRAY['MARKETING'::text, 'UTILITY'::text, 'AUTHENTICATION'::text])));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_draft_has_no_provider_claim CHECK (((nexus_state <> 'DRAFT'::text) OR ((provider_status = 'UNKNOWN'::text) AND (provider_template_id IS NULL))));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_language_shape CHECK ((language ~ '^[a-z]{2,3}(_[A-Za-z]{2,4})?$'::text));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_name_shape CHECK (((name = lower(btrim(name))) AND ((length(name) >= 1) AND (length(name) <= 512)) AND (name ~ '^[a-z0-9_]+$'::text)));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_nexus_state_vocabulary CHECK ((nexus_state = ANY (ARRAY['DRAFT'::text, 'SUBMITTED'::text, 'ADOPTED'::text, 'RETIRED'::text])));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_previous_status_pairs CHECK (((previous_provider_status IS NULL) = (previous_status_observed_at IS NULL)));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_provider_has_templates CHECK ((provider = 'whatsapp_cloud'::text));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_provider_status_needs_provenance CHECK ((((provider_status = 'UNKNOWN'::text) AND (provider_status_source = 'NEVER_OBSERVED'::text) AND (provider_status_observed_at IS NULL) AND (provider_status_raw IS NULL)) OR ((provider_status <> 'UNKNOWN'::text) AND (provider_status_source <> 'NEVER_OBSERVED'::text) AND (provider_status_observed_at IS NOT NULL) AND (NULLIF(btrim(COALESCE(provider_status_raw, ''::text)), ''::text) IS NOT NULL))));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_provider_status_source_vocabulary CHECK ((provider_status_source = ANY (ARRAY['NEVER_OBSERVED'::text, 'GRAPH_API_FETCH'::text, 'WEBHOOK_TEMPLATE_STATUS_UPDATE'::text, 'OPERATOR_ENTERED'::text])));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_provider_status_vocabulary CHECK ((provider_status = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text, 'PENDING'::text, 'PAUSED'::text, 'DISABLED'::text, 'PENDING_DELETION'::text, 'IN_APPEAL'::text, 'LIMIT_EXCEEDED'::text, 'UNMAPPED'::text, 'UNKNOWN'::text])));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_refs_are_references_not_secrets CHECK ((((waba_ref IS NULL) OR ((length(waba_ref) <= 200) AND (waba_ref !~ '[[:space:]]'::text) AND (waba_ref !~* '^(eyJ|sk-|sb_secret_|sbp_|service_role|bearer)'::text))) AND ((provider_template_id IS NULL) OR ((length(provider_template_id) <= 200) AND (provider_template_id !~ '[[:space:]]'::text) AND (provider_template_id !~* '^(eyJ|sk-|sb_secret_|sbp_|service_role|bearer)'::text))) AND ((provider_status_evidence_ref IS NULL) OR ((length(provider_status_evidence_ref) <= 300) AND (provider_status_evidence_ref !~* '^(eyJ|sk-|sb_secret_|sbp_|service_role|bearer)'::text)))));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_rejected_reason_only_when_refused CHECK (((provider_rejected_reason IS NULL) OR (provider_status = ANY (ARRAY['REJECTED'::text, 'PAUSED'::text, 'DISABLED'::text, 'IN_APPEAL'::text, 'LIMIT_EXCEEDED'::text]))));
ALTER TABLE public.whatsapp_templates ADD CONSTRAINT wat_variable_schema_shape CHECK (whatsapp_template_variable_schema_ok(variable_schema));
ALTER TABLE public.workflow_registry ADD CONSTRAINT workflow_registry_trigger_type_check CHECK ((trigger_type = ANY (ARRAY['webhook'::text, 'schedule'::text, 'sub-workflow'::text, 'manual'::text, 'error'::text])));


-- ========================================================================
-- 9. VIEWS
-- Dependency-ordered. WITH (security_invoker=on) is reproduced verbatim: 0 of 39 views lack it.
-- ========================================================================
CREATE OR REPLACE VIEW public.v_action_center_health WITH (security_invoker=true) AS
 SELECT a.tenant_id,
    count(*) AS actions_total,
    count(*) FILTER (WHERE a.status = 'PROPOSED'::text) AS awaiting_decision,
    count(*) FILTER (WHERE a.status = 'PROPOSED'::text AND a.escalated_at IS NOT NULL) AS escalated_no_approver,
    count(*) FILTER (WHERE a.status = 'APPROVED'::text AND a.executed_at IS NULL) AS approved_not_executed,
    count(*) FILTER (WHERE a.status = 'EXECUTED'::text) AS executed,
    count(*) FILTER (WHERE a.status = 'EXECUTION_FAILED'::text) AS execution_failed,
    count(*) FILTER (WHERE a.status = 'REJECTED'::text) AS rejected,
    count(*) FILTER (WHERE a.status = 'DEFERRED'::text) AS deferred,
    count(*) FILTER (WHERE a.status = 'CANCELLED'::text) AS cancelled,
    count(*) FILTER (WHERE a.outcome_state = 'ATTRIBUTED'::text) AS outcomes_attributed,
    count(*) FILTER (WHERE a.outcome_state = 'NOT_ATTRIBUTABLE'::text) AS outcomes_not_attributable,
    count(*) FILTER (WHERE a.status = 'EXECUTED'::text AND a.outcome_state = 'AWAITING_OUTCOME'::text) AS executed_awaiting_outcome,
    sum(a.engine_impact_aed) FILTER (WHERE a.status = 'PROPOSED'::text) AS undecided_exposure_aed,
    count(*) FILTER (WHERE a.status = 'PROPOSED'::text AND a.engine_impact_aed IS NULL) AS undecided_with_no_figure,
    max(a.proposed_at) AS last_proposed_at,
    max(a.decided_at) AS last_decided_at,
    max(a.executed_at) AS last_executed_at,
    max(GREATEST(a.proposed_at, COALESCE(a.decided_at, a.proposed_at), COALESCE(a.executed_at, a.proposed_at))) AS last_activity_at,
    ( SELECT min(EXTRACT(day FROM now() - x.proposed_at))::integer AS min
           FROM inventory_actions x
          WHERE x.tenant_id = a.tenant_id AND x.status = 'PROPOSED'::text) AS newest_undecided_days,
    ( SELECT max(EXTRACT(day FROM now() - x.proposed_at))::integer AS max
           FROM inventory_actions x
          WHERE x.tenant_id = a.tenant_id AND x.status = 'PROPOSED'::text) AS oldest_undecided_days,
    ev.events_total,
    ev.events_without_audit,
    aud.audit_rows,
    aud.audit_rows_30d,
    aud.last_audit_at,
        CASE
            WHEN count(*) = 0 THEN 'NO_ACTIONS'::text
            WHEN COALESCE(ev.events_without_audit, 0::bigint) > 0 THEN 'AUDIT_TRAIL_BROKEN'::text
            WHEN COALESCE(aud.audit_rows, 0::bigint) = 0 THEN 'AUDIT_TRAIL_BROKEN'::text
            WHEN count(*) FILTER (WHERE a.status = 'EXECUTION_FAILED'::text) > 0 THEN 'EXECUTIONS_FAILING'::text
            WHEN count(*) FILTER (WHERE a.status = 'PROPOSED'::text AND a.escalated_at IS NOT NULL) > 0 THEN 'NOBODY_MAY_APPROVE'::text
            ELSE 'ACTIVE'::text
        END AS health
   FROM inventory_actions a
     LEFT JOIN LATERAL ( SELECT count(*) AS events_total,
            count(*) FILTER (WHERE e.audit_log_id IS NULL) AS events_without_audit
           FROM inventory_action_events e
          WHERE e.tenant_id = a.tenant_id) ev ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS audit_rows,
            count(*) FILTER (WHERE l.logged_at > (now() - '30 days'::interval)) AS audit_rows_30d,
            max(l.logged_at) AS last_audit_at
           FROM audit_log l
          WHERE l.tenant_id = a.tenant_id AND l.workflow = 'Inventory Action Center'::text) aud ON true
  GROUP BY a.tenant_id, ev.events_total, ev.events_without_audit, aud.audit_rows, aud.audit_rows_30d, aud.last_audit_at;

CREATE OR REPLACE VIEW public.v_audit_unregistered_writers WITH (security_invoker=true) AS
 SELECT tenant_id,
    workflow AS workflow_written_in_audit_log,
    count(*) AS audit_rows,
    count(*) FILTER (WHERE logged_at > (now() - '30 days'::interval)) AS audit_rows_30d,
    min(logged_at) AS first_written_at,
    max(logged_at) AS last_written_at,
    array_agg(DISTINCT status) AS statuses_seen,
        CASE
            WHEN workflow = 'Inventory Action Center'::text THEN 'Known and deliberate. Human decisions, not an n8n run - see v_action_center_health.'::text
            ELSE 'Unrecognised writer. Register it from the box with its real n8n id, or establish it is not a NEXUS workflow. Do not invent a registry row.'::text
        END AS disposition
   FROM audit_log l
  WHERE NOT (EXISTS ( SELECT 1
           FROM workflow_registry r
          WHERE l.workflow = r.name OR l.workflow = r.audit_name OR (l.workflow = ANY (r.audit_aliases))))
  GROUP BY tenant_id, workflow;

CREATE OR REPLACE VIEW public.v_channel_provider_capability WITH (security_invoker=true) AS
 SELECT c.provider,
    r.rank AS provider_rank,
    COALESCE(r.is_official_platform, false) AS is_official_platform,
    c.send_form,
    f.label AS send_form_label,
    f.requires_template_ref,
    f.is_media,
    c.support_state,
    c.basis,
    c.verified_at,
    c.support_state = 'SUPPORTED'::text AND c.basis <> 'MEASURED_HERE'::text AS supported_but_never_exercised_here,
    c.evidence,
    c.set_by
   FROM channel_provider_capability c
     JOIN channel_send_form f ON f.code = c.send_form
     LEFT JOIN channel_provider_rank r ON r.provider = c.provider;

CREATE OR REPLACE VIEW public.v_channel_send_health WITH (security_invoker=true) AS
 SELECT tenant_id,
    integration_id,
    provider,
    external_identifier,
    count(*) FILTER (WHERE routed_at > (now() - '7 days'::interval)) AS routed_7d,
    count(*) FILTER (WHERE routed_at > (now() - '7 days'::interval) AND directive = 'SEND'::text) AS sends_7d,
    count(*) FILTER (WHERE routed_at > (now() - '7 days'::interval) AND send_result = 'ACCEPTED_BY_PROVIDER'::text) AS accepted_7d,
    count(*) FILTER (WHERE routed_at > (now() - '7 days'::interval) AND send_result = 'REJECTED_BY_PROVIDER'::text) AS rejected_7d,
    count(*) FILTER (WHERE routed_at > (now() - '7 days'::interval) AND send_result = 'TRANSPORT_ERROR'::text) AS transport_errors_7d,
    count(*) FILTER (WHERE send_result = 'PENDING'::text) AS pending_now,
    max(result_recorded_at) FILTER (WHERE send_result = 'ACCEPTED_BY_PROVIDER'::text) AS last_accepted_at,
    max(result_recorded_at) FILTER (WHERE send_result = ANY (ARRAY['REJECTED_BY_PROVIDER'::text, 'TRANSPORT_ERROR'::text])) AS last_failed_at,
        CASE
            WHEN count(*) FILTER (WHERE routed_at > (now() - '7 days'::interval) AND directive = 'SEND'::text) = 0 THEN 'NO_SENDS_MEASURED'::text
            WHEN count(*) FILTER (WHERE routed_at > (now() - '7 days'::interval) AND send_result = 'ACCEPTED_BY_PROVIDER'::text) = 0 THEN 'PRODUCING_NOTHING'::text
            WHEN count(*) FILTER (WHERE routed_at > (now() - '7 days'::interval) AND (send_result = ANY (ARRAY['REJECTED_BY_PROVIDER'::text, 'TRANSPORT_ERROR'::text]))) > count(*) FILTER (WHERE routed_at > (now() - '7 days'::interval) AND send_result = 'ACCEPTED_BY_PROVIDER'::text) THEN 'DEGRADED'::text
            ELSE 'CARRYING'::text
        END AS observed_state
   FROM channel_send_directive d
  GROUP BY tenant_id, integration_id, provider, external_identifier;

CREATE OR REPLACE VIEW public.v_competitor_latest WITH (security_invoker=on) AS
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

CREATE OR REPLACE VIEW public.v_conversations WITH (security_invoker=true) AS
 WITH resolved AS (
         SELECT cl.id,
            cl.lead_email,
            cl.channel,
            cl.direction,
            cl.message,
            cl.created_at,
            cl.tenant_id,
            nexus_is_message(cl.direction, cl.channel, cl.message) AS is_msg,
            COALESCE(lower(l_direct.email), lower(wc_direct.lead_email), lower(cl.lead_email)) AS person_key,
                CASE
                    WHEN cl.lead_email ~~ '%@lid'::text OR cl.lead_email ~~ '%@c.us'::text THEN cl.lead_email
                    ELSE wc_by_lead.chat_id
                END AS reply_chat_id
           FROM communication_logs cl
             LEFT JOIN leads l_direct ON lower(l_direct.email) = lower(cl.lead_email) AND l_direct.tenant_id = cl.tenant_id
             LEFT JOIN whatsapp_contacts wc_direct ON wc_direct.chat_id = cl.lead_email AND wc_direct.tenant_id = cl.tenant_id
             LEFT JOIN whatsapp_contacts wc_by_lead ON lower(wc_by_lead.lead_email) = lower(cl.lead_email) AND wc_by_lead.tenant_id = cl.tenant_id
          WHERE cl.lead_email IS NOT NULL AND cl.lead_email <> ''::text
        ), threads AS (
         SELECT resolved.tenant_id,
            resolved.person_key,
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
          GROUP BY resolved.tenant_id, resolved.person_key
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
    t.last_msg_direction = 'inbound'::text AS awaiting_msg_reply,
    t.tenant_id
   FROM threads t
     LEFT JOIN leads l ON lower(l.email) = t.person_key AND l.tenant_id = t.tenant_id
     LEFT JOIN whatsapp_contacts wc ON wc.chat_id = t.chat_id AND wc.tenant_id = t.tenant_id
     LEFT JOIN whatsapp_contacts wc2 ON lower(wc2.lead_email) = t.person_key AND wc2.tenant_id = t.tenant_id;

CREATE OR REPLACE VIEW public.v_customer_360 WITH (security_invoker=true) AS
 WITH ids AS (
         SELECT lower(btrim(leads.email)) AS email,
            leads.tenant_id
           FROM leads
          WHERE leads.email IS NOT NULL AND leads.email <> ''::text
        UNION
         SELECT lower(btrim(purchase_history.email)) AS email,
            purchase_history.tenant_id
           FROM purchase_history
          WHERE purchase_history.email IS NOT NULL AND purchase_history.email <> ''::text
        ), ident AS (
         SELECT i_1.email,
            i_1.tenant_id,
            max(NULLIF(regexp_replace(COALESCE(l_1.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), ''::text)) AS digits
           FROM ids i_1
             LEFT JOIN leads l_1 ON lower(btrim(l_1.email)) = i_1.email AND l_1.tenant_id = i_1.tenant_id
          GROUP BY i_1.email, i_1.tenant_id
        ), keys AS (
         SELECT d.email,
            d.tenant_id,
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
                  WHERE wc.chat_id IS NOT NULL AND wc.tenant_id = d.tenant_id AND (lower(btrim(wc.lead_email)) = d.email OR d.digits IS NOT NULL AND regexp_replace(COALESCE(wc.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text) = d.digits)) k
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
          WHERE lower(btrim(p2.email)) = i.email AND p2.tenant_id = i.tenant_id) AS lifetime_value_aed,
    max(p.purchase_date) AS last_purchase_date,
    count(DISTINCT p.id) > 0 AS is_vip,
    ( SELECT count(*) AS count
           FROM communication_logs c
          WHERE c.tenant_id = i.tenant_id AND (c.lead_email IN ( SELECT k.key
                   FROM keys k
                  WHERE k.email = i.email AND k.tenant_id = i.tenant_id)) AND nexus_is_message(c.direction, c.channel, c.message)) AS message_count,
    ( SELECT max(c.created_at) AS max
           FROM communication_logs c
          WHERE c.tenant_id = i.tenant_id AND (c.lead_email IN ( SELECT k.key
                   FROM keys k
                  WHERE k.email = i.email AND k.tenant_id = i.tenant_id)) AND nexus_is_message(c.direction, c.channel, c.message)) AS last_contact_at,
    max(c3.total_emails) AS total_emails,
    max(c3.total_slack_messages) AS total_slack_messages,
    i.tenant_id
   FROM ids i
     LEFT JOIN leads l ON lower(btrim(l.email)) = i.email AND l.tenant_id = i.tenant_id
     LEFT JOIN purchase_history p ON lower(btrim(p.email)) = i.email AND p.tenant_id = i.tenant_id
     LEFT JOIN customer_360_profiles c3 ON lower(btrim(c3.email)) = i.email AND c3.tenant_id = i.tenant_id
  GROUP BY i.email, i.tenant_id;

CREATE OR REPLACE VIEW public.v_customer_directory WITH (security_invoker=on) AS
 SELECT lower(email) AS id,
    (array_agg(name ORDER BY at DESC NULLS LAST) FILTER (WHERE name IS NOT NULL AND name <> ''::text))[1] AS name,
    lower(email) AS email,
    (array_agg(phone ORDER BY at DESC NULLS LAST) FILTER (WHERE phone IS NOT NULL AND phone <> ''::text))[1] AS phone,
    count(*) AS source_records,
    max(at) AS last_seen_at,
    tenant_id
   FROM ( SELECT leads.email,
            leads.name,
            leads.phone,
            leads.created_at AS at,
            leads.tenant_id
           FROM leads
          WHERE leads.email IS NOT NULL AND leads.email <> ''::text AND leads.tenant_id = nexus_scoped_tenant_id()
        UNION ALL
         SELECT purchase_history.email,
            purchase_history.customer_name,
            purchase_history.phone,
            purchase_history.created_at,
            purchase_history.tenant_id
           FROM purchase_history
          WHERE purchase_history.email IS NOT NULL AND purchase_history.email <> ''::text AND purchase_history.tenant_id = nexus_scoped_tenant_id()) x
  GROUP BY tenant_id, (lower(email));

CREATE OR REPLACE VIEW public.v_deal_rescue_candidates WITH (security_invoker=true) AS
 WITH lead_key AS (
         SELECT l.tenant_id,
            lower(btrim(l.email)) AS k,
            min(l.id) AS lead_id,
            count(*) AS n
           FROM leads l
          WHERE NULLIF(btrim(COALESCE(l.email, ''::text)), ''::text) IS NOT NULL
          GROUP BY l.tenant_id, (lower(btrim(l.email)))
        ), sale_by_lead AS (
         SELECT p.tenant_id,
            p.lead_id,
            count(*) AS n
           FROM purchase_history p
          WHERE p.lead_id IS NOT NULL
          GROUP BY p.tenant_id, p.lead_id
        ), sale_by_email AS (
         SELECT p.tenant_id,
            lower(btrim(p.email)) AS k,
            count(*) AS n
           FROM purchase_history p
          WHERE NULLIF(btrim(COALESCE(p.email, ''::text)), ''::text) IS NOT NULL
          GROUP BY p.tenant_id, (lower(btrim(p.email)))
        )
 SELECT q.tenant_id,
    'FINANCE_QUOTE'::text AS candidate_kind,
    q.id::text AS candidate_ref,
    COALESCE(NULLIF(btrim(COALESCE(q.lead_name, ''::text)), ''::text), NULLIF(btrim(COALESCE(q.lead_email, ''::text)), ''::text), '(unnamed)'::text) AS customer_label,
    'finance_quotes'::text AS source_table,
    q.created_at AS observed_at,
        CASE
            WHEN lk.n = 1 THEN lk.lead_id
            ELSE NULL::integer
        END AS lead_id,
        CASE
            WHEN lk.n = 1 THEN 'RESOLVED_EXACT_EMAIL'::text
            WHEN lk.n > 1 THEN 'UNKNOWN_AMBIGUOUS_EMAIL'::text
            ELSE 'UNKNOWN_UNRESOLVED_IDENTITY'::text
        END AS identity_state,
        CASE
            WHEN lk.n = 1 THEN 'finance_quotes.lead_email matches exactly one leads.email in this dealership.'::text
            ELSE 'This quote names a person NEXUS cannot resolve to exactly one lead by the exact-email clause. It is reported, not attached to anybody.'::text
        END AS identity_basis,
        CASE
            WHEN COALESCE(se.n, 0::bigint) > 0 OR COALESCE(sl.n, 0::bigint) > 0 THEN 'REFUSED_ALREADY_SOLD'::text
            ELSE 'IN_FLIGHT_DEAL'::text
        END AS verdict,
        CASE
            WHEN COALESCE(se.n, 0::bigint) > 0 OR COALESCE(sl.n, 0::bigint) > 0 THEN NULL::text
            ELSE 'STRONG'::text
        END AS evidence_tier,
        CASE
            WHEN COALESCE(se.n, 0::bigint) > 0 OR COALESCE(sl.n, 0::bigint) > 0 THEN 'A sale is already recorded for this person. The deal is done; there is nothing to rescue.'::text
            ELSE 'A priced, dated finance offer with no sale on record. Somebody priced a specific car for a specific person - that is a transaction under way, not an enquiry.'::text
        END AS verdict_basis,
    COALESCE(q.vehicle_price_aed, q.vehicle_value_aed) AS deal_value_aed,
        CASE
            WHEN COALESCE(q.vehicle_price_aed, q.vehicle_value_aed) IS NULL THEN 'UNKNOWN_NOT_RECORDED'::text
            ELSE 'AT_STAKE_FROM_QUOTE'::text
        END AS deal_value_state,
    'EXPOSURE - the vehicle price recorded on the finance quote. This is what is AT STAKE. It is not estimated revenue, not attributed revenue and not confirmed revenue.'::text AS deal_value_basis
   FROM finance_quotes q
     LEFT JOIN lead_key lk ON lk.tenant_id = q.tenant_id AND lk.k = lower(btrim(COALESCE(q.lead_email, ''::text)))
     LEFT JOIN sale_by_email se ON se.tenant_id = q.tenant_id AND se.k = lower(btrim(COALESCE(q.lead_email, ''::text)))
     LEFT JOIN sale_by_lead sl ON sl.tenant_id = q.tenant_id AND sl.lead_id =
        CASE
            WHEN lk.n = 1 THEN lk.lead_id
            ELSE NULL::integer
        END
UNION ALL
 SELECT k.tenant_id,
    'KYC_DOCUMENT'::text AS candidate_kind,
    k.id::text AS candidate_ref,
    COALESCE(NULLIF(btrim(COALESCE(k.lead_name, ''::text)), ''::text), NULLIF(btrim(COALESCE(k.lead_email, ''::text)), ''::text), '(unnamed)'::text) AS customer_label,
    'kyc_documents'::text AS source_table,
    k.created_at AS observed_at,
        CASE
            WHEN lk.n = 1 THEN lk.lead_id
            ELSE NULL::integer
        END AS lead_id,
        CASE
            WHEN lk.n = 1 THEN 'RESOLVED_EXACT_EMAIL'::text
            WHEN lk.n > 1 THEN 'UNKNOWN_AMBIGUOUS_EMAIL'::text
            ELSE 'UNKNOWN_UNRESOLVED_IDENTITY'::text
        END AS identity_state,
        CASE
            WHEN lk.n = 1 THEN 'kyc_documents.lead_email matches exactly one leads.email in this dealership.'::text
            ELSE 'This document names a person NEXUS cannot resolve to exactly one lead by the exact-email clause.'::text
        END AS identity_basis,
        CASE
            WHEN k.voided_at IS NOT NULL OR upper(COALESCE(k.verdict, ''::text)) = 'REJECTED'::text OR COALESCE(k.is_valid, false) IS FALSE THEN 'REFUSED_VOIDED_OR_REJECTED'::text
            WHEN COALESCE(se.n, 0::bigint) > 0 OR COALESCE(sl.n, 0::bigint) > 0 THEN 'REFUSED_ALREADY_SOLD'::text
            ELSE 'IN_FLIGHT_DEAL'::text
        END AS verdict,
        CASE
            WHEN k.voided_at IS NOT NULL OR upper(COALESCE(k.verdict, ''::text)) = 'REJECTED'::text OR COALESCE(k.is_valid, false) IS FALSE THEN NULL::text
            WHEN COALESCE(se.n, 0::bigint) > 0 OR COALESCE(sl.n, 0::bigint) > 0 THEN NULL::text
            ELSE 'WEAK'::text
        END AS evidence_tier,
        CASE
            WHEN k.voided_at IS NOT NULL OR upper(COALESCE(k.verdict, ''::text)) = 'REJECTED'::text OR COALESCE(k.is_valid, false) IS FALSE THEN ((('Not an accepted identity document (verdict '::text || COALESCE(k.verdict, 'none'::text)) || ', document_type '::text) || COALESCE(k.document_type, 'none'::text)) || '). It evidences nothing about a deal.'::text
            WHEN COALESCE(se.n, 0::bigint) > 0 OR COALESCE(sl.n, 0::bigint) > 0 THEN 'A sale is already recorded for this person. The deal is done.'::text
            ELSE 'Identity papers accepted for a person with no sale on record. WEAK: the KYC workflow audits any image sent over WhatsApp, so this can raise NEEDS_MANAGER and nothing stronger.'::text
        END AS verdict_basis,
    NULL::bigint AS deal_value_aed,
    'UNKNOWN_NO_LINK'::text AS deal_value_state,
    'UNKNOWN. A KYC document carries no vehicle and no price, so nothing here says what is at stake.'::text AS deal_value_basis
   FROM kyc_documents k
     LEFT JOIN lead_key lk ON lk.tenant_id = k.tenant_id AND lk.k = lower(btrim(COALESCE(k.lead_email, ''::text)))
     LEFT JOIN sale_by_email se ON se.tenant_id = k.tenant_id AND se.k = lower(btrim(COALESCE(k.lead_email, ''::text)))
     LEFT JOIN sale_by_lead sl ON sl.tenant_id = k.tenant_id AND sl.lead_id =
        CASE
            WHEN lk.n = 1 THEN lk.lead_id
            ELSE NULL::integer
        END
UNION ALL
 SELECT l.tenant_id,
    'LEAD'::text AS candidate_kind,
    l.id::text AS candidate_ref,
    l.name AS customer_label,
    'leads'::text AS source_table,
    l.created_at AS observed_at,
    l.id AS lead_id,
    'RESOLVED_SELF'::text AS identity_state,
    'The candidate is the lead row itself.'::text AS identity_basis,
    'REFUSED_NOT_DEAL_EVIDENCE'::text AS verdict,
    NULL::text AS evidence_tier,
    ((((('leads.status = '::text || COALESCE(l.status, '(blank)'::text)) || ', open = '::text) || COALESCE(nexus_lead_is_open(l.status)::text, 'unknown'::text)) || '. An open lead is an enquiry: nothing here says a price was agreed, a vehicle was chosen or a transaction started. '::text) || 'Calling it an in-flight deal would manufacture a deal lifecycle this dealership does not have, and Lead Recovery (v_lead_recovery) already states this lead''s risk. '::text) || 'Age is not a reason either.'::text AS verdict_basis,
    NULL::bigint AS deal_value_aed,
    'UNKNOWN_NO_LINK'::text AS deal_value_state,
    'UNKNOWN. leads.budget_aed is null on every lead on file and nothing links a lead to a unit.'::text AS deal_value_basis
   FROM leads l
UNION ALL
 SELECT p.tenant_id,
    'CONFIRMED_SALE'::text AS candidate_kind,
    p.id::text AS candidate_ref,
    COALESCE(NULLIF(btrim(COALESCE(p.customer_name, ''::text)), ''::text), '(unnamed)'::text) AS customer_label,
    'purchase_history'::text AS source_table,
    p.created_at AS observed_at,
    p.lead_id,
        CASE
            WHEN p.lead_id IS NOT NULL THEN 'RESOLVED_FOREIGN_KEY'::text
            ELSE 'UNKNOWN_UNRESOLVED_IDENTITY'::text
        END AS identity_state,
        CASE
            WHEN p.lead_id IS NOT NULL THEN 'purchase_history.lead_id -> leads(id), a declared foreign key.'::text
            ELSE 'This sale names no lead. That is a recorded absence of provenance, not proof no lead existed.'::text
        END AS identity_basis,
    'COMPLETED_SALE_NOT_IN_FLIGHT'::text AS verdict,
    NULL::text AS evidence_tier,
    (('deal_id '::text || COALESCE(p.deal_id, '(none)'::text)) || ' was synthesised at the moment of sale, so this row is not the tail of a deal record - it is the whole of it. '::text) || 'DEAL_CREATED and SALE_CONFIRMED are one event here. What is known about this sale is answered by v_attribution_sale_chain.'::text AS verdict_basis,
    p.amount_aed::bigint AS deal_value_aed,
        CASE
            WHEN p.amount_aed IS NULL THEN 'UNKNOWN_NOT_RECORDED'::text
            ELSE 'CONFIRMED_REVENUE'::text
        END AS deal_value_state,
    'CONFIRMED revenue - a recorded business outcome. Not at stake, not estimated, not attributed.'::text AS deal_value_basis
   FROM purchase_history p
UNION ALL
 SELECT a.tenant_id,
    'APPROVED_UNEXECUTED_INVENTORY_ACTION'::text AS candidate_kind,
    a.id::text AS candidate_ref,
    'unit '::text || a.unit_id AS customer_label,
    'inventory_actions'::text AS source_table,
    a.decided_at AS observed_at,
    NULL::integer AS lead_id,
    'NOT_APPLICABLE_NO_CUSTOMER'::text AS identity_state,
    'An inventory action concerns a unit. There is no customer to resolve.'::text AS identity_basis,
    'REFUSED_NOT_DEAL_EVIDENCE'::text AS verdict,
    NULL::text AS evidence_tier,
    ((('An approved '::text || a.recommendation) || ' on '::text) || a.unit_id) || ' with no execution recorded. That is a stalled ACTION, not a stalled deal: no customer, no agreed price, no transaction. The Inventory Action Center owns it.'::text AS verdict_basis,
    NULL::bigint AS deal_value_aed,
    'NOT_APPLICABLE'::text AS deal_value_state,
    'A unit''s exposed margin is not a deal value and must not be read as one.'::text AS deal_value_basis
   FROM inventory_actions a
  WHERE a.status = 'APPROVED'::text AND a.executed_at IS NULL
UNION ALL
 SELECT r.tenant_id,
    'APPROVED_UNEXECUTED_LEAD_RECOVERY_ACTION'::text AS candidate_kind,
    r.id::text AS candidate_ref,
    'lead '::text || r.lead_id::text AS customer_label,
    'lead_recovery_actions'::text AS source_table,
    r.decided_at AS observed_at,
    r.lead_id,
    'RESOLVED_FOREIGN_KEY'::text AS identity_state,
    'lead_recovery_actions.lead_id -> leads(id).'::text AS identity_basis,
    'REFUSED_NOT_DEAL_EVIDENCE'::text AS verdict,
    NULL::text AS evidence_tier,
    ('An approved '::text || r.recommendation) || ' with no execution recorded. Lead Recovery already surfaces this as action_state on the lead; raising a deal from it would put one piece of work on two screens with two owners.'::text AS verdict_basis,
    NULL::bigint AS deal_value_aed,
    'NOT_APPLICABLE'::text AS deal_value_state,
    'A recovery action carries no deal value.'::text AS deal_value_basis
   FROM lead_recovery_actions r
  WHERE r.status = 'APPROVED'::text AND r.executed_at IS NULL;

CREATE OR REPLACE VIEW public.v_fin_gate_quote_evidence WITH (security_invoker=true) AS
 SELECT id,
    lead_email,
    lead_name,
    quoted_by,
    created_at,
    calculated_at,
    calculation_id,
    execution_id,
    indicative_apr_pct,
    indicative_apr_high_pct,
    monthly_payment_low_aed,
    monthly_payment_high_aed,
    calculation_id IS NOT NULL AND NULLIF(btrim(COALESCE(execution_id, ''::text)), ''::text) IS NOT NULL AS is_evidenced,
        CASE
            WHEN NULLIF(btrim(COALESCE(execution_id, ''::text)), ''::text) IS NULL THEN 'untraceable: no execution_id, so this figure cannot be tied to a Finance Calc run'::text
            WHEN calculation_id IS NULL THEN 'untraceable: no calculation_id'::text
            ELSE 'evidenced'::text
        END AS evidence_note,
    monthly_payment_low_aed IS NOT NULL AS has_instalment
   FROM finance_quotes q;

CREATE OR REPLACE VIEW public.v_inventory_action_timeline WITH (security_invoker=true) AS
 SELECT e.id,
    e.tenant_id,
    e.action_id,
    e.at,
    e.event,
    u.name AS actor_name,
    u.role AS actor_job_title,
    e.actor_authority,
    e.detail,
    e.audit_log_id,
    l.status AS audit_status,
    nexus_outcome_class(l.workflow, l.status, l.summary) AS audit_outcome_class,
    l.summary AS audit_summary
   FROM inventory_action_events e
     LEFT JOIN users u ON u.id = e.actor_staff_id
     LEFT JOIN audit_log l ON l.id = e.audit_log_id;

CREATE OR REPLACE VIEW public.v_inventory_profit_sentinel WITH (security_invoker=true) AS
 WITH cfg AS (
         SELECT i.tenant_id,
            s.holding_cost_per_day_aed AS holding_rate,
            s.holding_cost_source AS holding_source,
            s.holding_cost_basis AS holding_basis,
            s.holding_cost_set_by AS holding_set_by,
            s.holding_cost_verified_at AS holding_verified_at,
            COALESCE(s.aging_warn_days, 90) AS warn_days,
            COALESCE(s.aging_critical_days, 120) AS crit_days,
            COALESCE(s.promote_days, 60) AS promote_days,
            COALESCE(s.wholesale_days, 180) AS wholesale_days,
            COALESCE(s.min_reprice_margin_pct, 8.00) AS min_margin_pct,
            COALESCE(s.market_tolerance_pct, 3.00) AS tol_pct,
            COALESCE(s.enquiry_window_days, 30) AS enq_days,
            COALESCE(s.min_enquiry_sources, 50) AS min_enq_sources,
            COALESCE(s.min_model_token_overlap, 2) AS min_overlap,
            COALESCE(s.accepted_market_match_quality, ARRAY['exact'::text, 'strong'::text]) AS ok_quality,
            COALESCE(s.market_max_age_days, 14) AS mkt_max_age,
            s.tenant_id IS NULL AS on_defaults
           FROM ( SELECT DISTINCT inventory.tenant_id
                   FROM inventory) i
             LEFT JOIN inventory_profit_settings s ON s.tenant_id = i.tenant_id
        ), enq_src AS (
         SELECT l.tenant_id,
            'lead'::text AS kind,
            l.id::text AS ref,
            l.created_at,
            nexus_model_tokens(l.vehicle_interest) AS tk
           FROM leads l
             JOIN cfg c ON c.tenant_id = l.tenant_id
          WHERE COALESCE(l.vehicle_interest, ''::text) <> ''::text AND l.created_at >= (now() - make_interval(days => c.enq_days))
        UNION ALL
         SELECT m.tenant_id,
            'message'::text,
            m.id::text AS id,
            m.created_at,
            nexus_model_tokens(m.message) AS nexus_model_tokens
           FROM communication_logs m
             JOIN cfg c ON c.tenant_id = m.tenant_id
          WHERE lower(COALESCE(m.direction, ''::text)) = 'inbound'::text AND COALESCE(m.message, ''::text) <> ''::text AND m.created_at >= (now() - make_interval(days => c.enq_days))
        ), enq_cover AS (
         SELECT c.tenant_id,
            ( SELECT count(*) AS count
                   FROM enq_src e
                  WHERE e.tenant_id = c.tenant_id) AS src_rows,
            ( SELECT count(*) AS count
                   FROM enq_src e
                  WHERE e.tenant_id = c.tenant_id AND (EXISTS ( SELECT 1
                           FROM inventory i2
                          WHERE i2.tenant_id = c.tenant_id AND (( SELECT count(*) AS count
                                   FROM unnest(nexus_model_tokens(i2.model)) t(t)
                                  WHERE t.t = ANY (e.tk))) >= c.min_overlap))) AS resolved_rows
           FROM cfg c
        ), base AS (
         SELECT i.id,
            i.model,
            i.vin,
            i.status,
            i.acquired_at,
            i.cost_aed,
            i.price_aed,
            lower(COALESCE(i.status, ''::text)) = 'sold'::text AS is_sold,
                CASE
                    WHEN i.acquired_at IS NULL THEN NULL::integer
                    ELSE GREATEST(0, (now() AT TIME ZONE 'Asia/Dubai'::text)::date - i.acquired_at)
                END AS days,
                CASE
                    WHEN i.price_aed IS NULL OR i.cost_aed IS NULL THEN NULL::integer
                    ELSE i.price_aed - i.cost_aed
                END AS gross,
                CASE
                    WHEN i.price_aed IS NULL OR i.cost_aed IS NULL OR i.price_aed <= 0 THEN NULL::numeric
                    ELSE round((i.price_aed - i.cost_aed)::numeric / i.price_aed::numeric * 100::numeric, 2)
                END AS gross_pct,
            c.tenant_id,
            c.holding_rate,
            c.holding_source,
            c.holding_basis,
            c.holding_set_by,
            c.holding_verified_at,
            c.warn_days,
            c.crit_days,
            c.promote_days,
            c.wholesale_days,
            c.min_margin_pct,
            c.tol_pct,
            c.enq_days,
            c.min_enq_sources,
            c.min_overlap,
            c.ok_quality,
            c.mkt_max_age,
            c.on_defaults,
            ec.src_rows,
            ec.resolved_rows
           FROM inventory i
             JOIN cfg c ON c.tenant_id = i.tenant_id
             JOIN enq_cover ec ON ec.tenant_id = i.tenant_id
        ), mkt AS (
         SELECT b.tenant_id,
            b.id,
            k.competitor,
            k.price_aed AS comp_price,
            k.match_quality,
            k.scraped_at,
            k.match_note,
            k.source_host
           FROM base b
             LEFT JOIN LATERAL ( SELECT x.id,
                    x.competitor,
                    x.model,
                    x.price_aed,
                    x.our_price_aed,
                    x.price_diff_aed,
                    x.ai_recommendation,
                    x.scraped_at,
                    x.listing_title,
                    x.source_host,
                    x.source_kind,
                    x.offer_name,
                    x.offer_condition,
                    x.match_quality,
                    x.match_note,
                    x.tenant_id
                   FROM competitors x
                  WHERE x.tenant_id = b.tenant_id AND lower(btrim(x.model)) = lower(btrim(b.model))
                  ORDER BY x.scraped_at DESC NULLS LAST, x.id DESC
                 LIMIT 1) k ON true
        ), enq AS (
         SELECT b.tenant_id,
            b.id,
            count(e.ref) AS enq_n,
            count(*) FILTER (WHERE e.kind = 'lead'::text) AS enq_leads,
            count(*) FILTER (WHERE e.kind = 'message'::text) AS enq_msgs,
            max(e.created_at) AS enq_last
           FROM base b
             LEFT JOIN enq_src e ON e.tenant_id = b.tenant_id AND (( SELECT count(*) AS count
                   FROM unnest(nexus_model_tokens(b.model)) t(t)
                  WHERE t.t = ANY (e.tk))) >= b.min_overlap
          GROUP BY b.tenant_id, b.id
        ), j AS (
         SELECT b.id,
            b.model,
            b.vin,
            b.status,
            b.acquired_at,
            b.cost_aed,
            b.price_aed,
            b.is_sold,
            b.days,
            b.gross,
            b.gross_pct,
            b.tenant_id,
            b.holding_rate,
            b.holding_source,
            b.holding_basis,
            b.holding_set_by,
            b.holding_verified_at,
            b.warn_days,
            b.crit_days,
            b.promote_days,
            b.wholesale_days,
            b.min_margin_pct,
            b.tol_pct,
            b.enq_days,
            b.min_enq_sources,
            b.min_overlap,
            b.ok_quality,
            b.mkt_max_age,
            b.on_defaults,
            b.src_rows,
            b.resolved_rows,
            m.competitor,
            m.comp_price,
            m.match_quality,
            m.scraped_at AS comp_scraped_at,
            m.match_note,
            m.source_host,
            e.enq_n,
            e.enq_leads,
            e.enq_msgs,
            e.enq_last,
            b.resolved_rows >= b.min_enq_sources AS enq_ok,
                CASE
                    WHEN b.days IS NULL THEN 'UNKNOWN'::text
                    WHEN b.is_sold THEN 'HEALTHY'::text
                    WHEN b.days >= b.crit_days THEN 'CRITICAL'::text
                    WHEN b.days >= b.warn_days THEN 'WARNING'::text
                    ELSE 'HEALTHY'::text
                END AS band,
                CASE
                    WHEN b.holding_rate IS NULL OR b.days IS NULL THEN 'NOT_COMPUTABLE'::text
                    WHEN b.holding_basis = 'PLACEHOLDER'::text THEN 'PLACEHOLDER'::text
                    ELSE 'COMPUTED'::text
                END AS holding_state,
                CASE
                    WHEN b.holding_rate IS NULL OR b.days IS NULL THEN NULL::numeric
                    ELSE round(b.holding_rate * b.days::numeric)
                END AS holding_aed,
                CASE
                    WHEN m.competitor IS NULL THEN 'UNKNOWN_NO_COMPARABLE'::text
                    WHEN lower(COALESCE(m.match_quality, ''::text)) <> ALL (b.ok_quality) THEN 'UNKNOWN_UNVERIFIED_COMPARABLE'::text
                    WHEN m.scraped_at IS NULL OR m.scraped_at < (now() - make_interval(days => b.mkt_max_age)) THEN 'UNKNOWN_STALE_COMPARABLE'::text
                    WHEN m.comp_price IS NULL OR b.price_aed IS NULL THEN 'UNKNOWN_NO_PRICE'::text
                    WHEN (abs(b.price_aed - m.comp_price)::numeric / NULLIF(m.comp_price, 0)::numeric * 100::numeric) <= b.tol_pct THEN 'AT_MARKET'::text
                    WHEN b.price_aed > m.comp_price THEN 'ABOVE_MARKET'::text
                    ELSE 'BELOW_MARKET'::text
                END AS market_position
           FROM base b
             JOIN mkt m ON m.tenant_id = b.tenant_id AND m.id = b.id
             JOIN enq e ON e.tenant_id = b.tenant_id AND e.id = b.id
        ), risk AS (
         SELECT j.id,
            j.model,
            j.vin,
            j.status,
            j.acquired_at,
            j.cost_aed,
            j.price_aed,
            j.is_sold,
            j.days,
            j.gross,
            j.gross_pct,
            j.tenant_id,
            j.holding_rate,
            j.holding_source,
            j.holding_basis,
            j.holding_set_by,
            j.holding_verified_at,
            j.warn_days,
            j.crit_days,
            j.promote_days,
            j.wholesale_days,
            j.min_margin_pct,
            j.tol_pct,
            j.enq_days,
            j.min_enq_sources,
            j.min_overlap,
            j.ok_quality,
            j.mkt_max_age,
            j.on_defaults,
            j.src_rows,
            j.resolved_rows,
            j.competitor,
            j.comp_price,
            j.match_quality,
            j.comp_scraped_at,
            j.match_note,
            j.source_host,
            j.enq_n,
            j.enq_leads,
            j.enq_msgs,
            j.enq_last,
            j.enq_ok,
            j.band,
            j.holding_state,
            j.holding_aed,
            j.market_position,
                CASE
                    WHEN j.days IS NULL THEN NULL::integer
                    WHEN j.is_sold THEN 0
                    WHEN j.days >= j.crit_days THEN 3
                    WHEN j.days >= j.warn_days THEN 2
                    WHEN j.days >= j.promote_days THEN 1
                    ELSE 0
                END AS age_rank,
                CASE
                    WHEN j.gross IS NULL OR j.gross_pct IS NULL THEN NULL::integer
                    WHEN j.gross <= 0 THEN 3
                    WHEN j.gross_pct < j.min_margin_pct THEN 2
                    ELSE 0
                END AS margin_rank
           FROM j
        ), r AS (
         SELECT risk.id,
            risk.model,
            risk.vin,
            risk.status,
            risk.acquired_at,
            risk.cost_aed,
            risk.price_aed,
            risk.is_sold,
            risk.days,
            risk.gross,
            risk.gross_pct,
            risk.tenant_id,
            risk.holding_rate,
            risk.holding_source,
            risk.holding_basis,
            risk.holding_set_by,
            risk.holding_verified_at,
            risk.warn_days,
            risk.crit_days,
            risk.promote_days,
            risk.wholesale_days,
            risk.min_margin_pct,
            risk.tol_pct,
            risk.enq_days,
            risk.min_enq_sources,
            risk.min_overlap,
            risk.ok_quality,
            risk.mkt_max_age,
            risk.on_defaults,
            risk.src_rows,
            risk.resolved_rows,
            risk.competitor,
            risk.comp_price,
            risk.match_quality,
            risk.comp_scraped_at,
            risk.match_note,
            risk.source_host,
            risk.enq_n,
            risk.enq_leads,
            risk.enq_msgs,
            risk.enq_last,
            risk.enq_ok,
            risk.band,
            risk.holding_state,
            risk.holding_aed,
            risk.market_position,
            risk.age_rank,
            risk.margin_rank,
            GREATEST(COALESCE(risk.age_rank, '-1'::integer), COALESCE(risk.margin_rank, '-1'::integer)) AS overall_rank_raw,
                CASE
                    WHEN risk.is_sold THEN 'HOLD'::text
                    WHEN risk.days IS NULL OR risk.price_aed IS NULL OR risk.cost_aed IS NULL THEN 'MANAGER_REVIEW'::text
                    WHEN risk.gross <= 0 THEN 'MANAGER_REVIEW'::text
                    WHEN risk.days >= risk.wholesale_days AND risk.gross_pct < risk.min_margin_pct THEN 'WHOLESALE'::text
                    WHEN risk.days >= risk.wholesale_days THEN 'MANAGER_REVIEW'::text
                    WHEN risk.days >= risk.warn_days AND risk.market_position = 'BELOW_MARKET'::text THEN 'INSPECT'::text
                    WHEN risk.days >= risk.warn_days AND risk.gross_pct >= risk.min_margin_pct THEN 'REPRICE'::text
                    WHEN risk.days >= risk.warn_days THEN 'INSPECT'::text
                    WHEN risk.gross_pct < risk.min_margin_pct THEN 'MANAGER_REVIEW'::text
                    WHEN risk.days >= risk.promote_days THEN 'PROMOTE'::text
                    ELSE 'HOLD'::text
                END AS recommendation
           FROM risk
        )
 SELECT tenant_id,
    id,
    model,
    vin,
    status,
    acquired_at,
    days AS days_in_stock,
    band AS aging_band,
        CASE
            WHEN days IS NULL THEN NULL::integer
            ELSE GREATEST(0, warn_days - days)
        END AS days_to_warning,
        CASE
            WHEN days IS NULL THEN NULL::integer
            ELSE GREATEST(0, crit_days - days)
        END AS days_to_critical,
    cost_aed,
    price_aed,
    gross AS gross_margin_aed,
    gross_pct AS gross_margin_pct,
    cost_aed AS capital_tied_aed,
    holding_rate AS holding_cost_per_day_aed,
    holding_basis AS holding_cost_basis,
    holding_source AS holding_cost_source,
    holding_set_by AS holding_cost_set_by,
    holding_verified_at AS holding_cost_verified_at,
        CASE
            WHEN holding_state = 'NOT_COMPUTABLE'::text THEN NULL::numeric
            ELSE holding_aed
        END AS holding_cost_accrued_aed,
    holding_state AS holding_cost_state,
        CASE
            WHEN holding_rate IS NULL THEN ((((('Not computable. This dealership has not recorded what a day of floor costs, so no '::text || 'holding figure and no net margin are shown. The inputs are here instead: AED '::text) || to_char(COALESCE(cost_aed, 0), 'FM999,999,999'::text)) || ' of capital tied up for '::text) || COALESCE(days::text, 'an unknown number of'::text)) || ' days. '::text) || 'Enter a sourced rate in Settings and this becomes a number.'::text
            WHEN days IS NULL THEN 'Not computable: this unit has no acquisition date, so there are no days to charge a rate against.'::text
            WHEN holding_basis = 'PLACEHOLDER'::text THEN ((((((('ASSUMPTION, not this dealership''s money. AED '::text || to_char(holding_rate, 'FM999,999,990.00'::text)) || '/day x '::text) || days) || ' days, using a PLACEHOLDER rate recorded by '::text) || COALESCE(holding_set_by, 'someone unnamed'::text)) || ': '::text) || COALESCE(holding_source, 'no source given'::text)) || '. Replace it with the dealership''s floor-plan figure before anyone acts on this number.'::text
            ELSE ((((((((('AED '::text || to_char(holding_rate, 'FM999,999,990.00'::text)) || '/day x '::text) || days) || ' days. Rate supplied by '::text) || COALESCE(holding_set_by, 'unnamed'::text)) || ', source: '::text) || COALESCE(holding_source, 'source missing'::text)) || ', confirmed '::text) || COALESCE(to_char(holding_verified_at, 'DD Mon YYYY'::text), 'never'::text)) || '.'::text
        END AS holding_cost_note,
        CASE
            WHEN holding_state = 'NOT_COMPUTABLE'::text OR gross IS NULL THEN NULL::numeric
            ELSE gross::numeric - holding_aed
        END AS net_margin_aed,
        CASE
            WHEN gross IS NULL THEN 'NOT_COMPUTABLE'::text
            ELSE holding_state
        END AS net_margin_state,
        CASE
            WHEN gross IS NULL THEN 'Net margin not computable: list price or acquisition cost is missing.'::text
            WHEN holding_state = 'NOT_COMPUTABLE'::text THEN (('Net margin NOT COMPUTABLE - gross margin of AED '::text || to_char(gross, 'FM999,999,999'::text)) || ' is real, the holding cost that would be subtracted from it is not on record. '::text) || 'Gross is shown; net is withheld rather than guessed.'::text
            WHEN holding_state = 'PLACEHOLDER'::text THEN 'Net margin shown against a PLACEHOLDER holding rate. Treat as a model, not as money.'::text
            ELSE 'Gross margin minus holding cost at the rate this dealership supplied.'::text
        END AS net_margin_note,
    market_position,
    competitor AS market_competitor,
    comp_price AS market_price_aed,
    match_quality AS market_match_quality,
    comp_scraped_at AS market_scraped_at,
        CASE market_position
            WHEN 'UNKNOWN_NO_COMPARABLE'::text THEN 'No competitor row for this exact model, so this unit has NO market position. Unknown, not average.'::text
            WHEN 'UNKNOWN_UNVERIFIED_COMPARABLE'::text THEN ((((((('A competitor row exists ('::text || COALESCE(competitor, '?'::text)) || ' at AED '::text) || to_char(COALESCE(comp_price, 0), 'FM999,999,999'::text)) || ') but nothing ties that price to this car - '::text) || 'match quality '::text) || COALESCE(NULLIF(match_quality, ''::text), 'not recorded'::text)) || COALESCE(('. Their own note: "'::text || match_note) || '"'::text, ''::text)) || '. Shown as evidence only; no position is derived from it and no price move is recommended because of it.'::text
            WHEN 'UNKNOWN_STALE_COMPARABLE'::text THEN ((('The only comparable for this model was captured '::text || COALESCE(to_char(comp_scraped_at, 'DD Mon YYYY'::text), 'at an unrecorded time'::text)) || ', older than the '::text) || mkt_max_age) || '-day freshness window. Too old to price against.'::text
            WHEN 'UNKNOWN_NO_PRICE'::text THEN 'A comparable exists but one of the two prices is missing, so no position can be taken.'::text
            WHEN 'AT_MARKET'::text THEN ((('Within '::text || tol_pct) || '% of a verified comparable at '::text) || COALESCE(competitor, '?'::text)) || '.'::text
            WHEN 'ABOVE_MARKET'::text THEN ((('AED '::text || to_char(abs(COALESCE(price_aed, 0) - COALESCE(comp_price, 0)), 'FM999,999,999'::text)) || ' above a verified comparable at '::text) || COALESCE(competitor, '?'::text)) || '.'::text
            ELSE ((('AED '::text || to_char(abs(COALESCE(price_aed, 0) - COALESCE(comp_price, 0)), 'FM999,999,999'::text)) || ' below a verified comparable at '::text) || COALESCE(competitor, '?'::text)) || '.'::text
        END AS market_note,
        CASE
            WHEN NOT enq_ok THEN 'UNKNOWN_LOW_COVERAGE'::text
            WHEN enq_n > 0 THEN 'ENQUIRIES_PRESENT'::text
            ELSE 'NO_ENQUIRIES_IN_WINDOW'::text
        END AS demand_signal,
    enq_n AS enquiries_in_window,
    enq_leads AS enquiry_leads,
    enq_msgs AS enquiry_messages,
    enq_last AS enquiry_last_at,
    src_rows AS enquiry_source_rows,
    resolved_rows AS enquiry_resolved_rows,
    enq_days AS enquiry_window_days,
        CASE
            WHEN enq_ok THEN 'SUFFICIENT'::text
            ELSE 'INSUFFICIENT'::text
        END AS enquiry_coverage,
        CASE
            WHEN enq_ok THEN ((((((enq_n || ' enquiry '::text) ||
            CASE
                WHEN enq_n = 1 THEN 'record'::text
                ELSE 'records'::text
            END) || ' in '::text) || enq_days) || ' days, matched to this unit on '::text) || min_overlap) || ' or more shared model words.'::text
            ELSE ((((((((('Counted but NOT used to decide. Across the whole lot, '::text || src_rows) || ' enquiry rows in '::text) || enq_days) || ' days resolve to a vehicle only '::text) || resolved_rows) || ' times, under the floor of '::text) || min_enq_sources) || '. At that coverage a count of '::text) || enq_n) || ' says what our records hold, not what the market wants, so it cannot move a recommendation.'::text
        END AS enquiry_note,
        CASE age_rank
            WHEN 3 THEN 'SEVERE'::text
            WHEN 2 THEN 'HIGH'::text
            WHEN 1 THEN 'ELEVATED'::text
            WHEN 0 THEN 'LOW'::text
            ELSE 'UNKNOWN'::text
        END AS age_risk,
    age_rank AS age_risk_rank,
        CASE margin_rank
            WHEN 3 THEN 'SEVERE'::text
            WHEN 2 THEN 'HIGH'::text
            WHEN 0 THEN 'LOW'::text
            ELSE 'UNKNOWN'::text
        END AS margin_risk,
    margin_rank AS margin_risk_rank,
        CASE
            WHEN age_rank IS NULL AND margin_rank IS NULL THEN 'UNKNOWN'::text
            WHEN overall_rank_raw = 3 THEN 'SEVERE'::text
            WHEN overall_rank_raw = 2 THEN 'HIGH'::text
            WHEN overall_rank_raw = 1 THEN 'ELEVATED'::text
            ELSE 'LOW'::text
        END AS overall_risk,
        CASE
            WHEN age_rank IS NULL AND margin_rank IS NULL THEN NULL::integer
            ELSE overall_rank_raw
        END AS overall_risk_rank,
        CASE
            WHEN age_rank IS NULL AND margin_rank IS NULL THEN 'Neither age nor margin can be assessed: no acquisition date and no price/cost pair.'::text
            WHEN age_rank IS NULL THEN 'Margin risk only - this unit has no acquisition date, so it has no age and no ageing band.'::text
            WHEN margin_rank IS NULL THEN 'Age risk only - list price or acquisition cost is missing, so margin risk is unknown.'::text
            ELSE (((('Overall risk is the higher of age risk ('::text || age_rank) || ') and margin risk ('::text) || margin_rank) || '), not a weighted blend. Nothing here has been calibrated against real days-to-sell, '::text) || 'so a weighting would be an invention.'::text
        END AS risk_basis,
    recommendation,
        CASE recommendation
            WHEN 'HOLD'::text THEN
            CASE
                WHEN is_sold THEN 'Marked Sold. No lot action applies to a unit that is off the lot.'::text
                ELSE ((((('On the lot '::text || days) || ' days with '::text) || gross_pct) || '% gross margin intact - inside the healthy band and not yet at the '::text) || promote_days) || '-day promotion point. Nothing to do.'::text
            END
            WHEN 'PROMOTE'::text THEN ((((('At '::text || days) || ' days this unit is in the last third of the healthy band and enters WARNING in '::text) || GREATEST(0, warn_days - days)) || ' days. Marketing spend now still has the full AED '::text) || to_char(COALESCE(gross, 0), 'FM999,999,999'::text)) || ' of gross margin behind it; after the band it will not.'::text
            WHEN 'REPRICE'::text THEN ((((((('On the lot '::text || days) || ' days - past the '::text) || warn_days) || '-day ageing threshold this database already uses - and still carrying '::text) || gross_pct) || '% gross margin, which is room above the '::text) || min_margin_pct) || '% floor to move the price without going under cost.'::text
            WHEN 'INSPECT'::text THEN
            CASE
                WHEN market_position = 'BELOW_MARKET'::text THEN (('Aged at '::text || days) || ' days while already priced below a verified comparable. Price is not '::text) || 'what is stopping this one - inspect condition, photos and description before cutting further.'::text
                ELSE ((((('Aged at '::text || days) || ' days with only '::text) || gross_pct) || '% gross margin, under the '::text) || min_margin_pct) || '% floor. A price cut has no room to work here, so the question is the car, not the number.'::text
            END
            WHEN 'WHOLESALE'::text THEN ((((('On the lot '::text || days) || ' days - past the '::text) || wholesale_days) || '-day point - with only '::text) || gross_pct) || '% gross margin left. Retail has had six months and there is no room left to cut.'::text
            WHEN 'MANAGER_REVIEW'::text THEN
            CASE
                WHEN days IS NULL THEN 'No acquisition date on this unit, so it has no age and no ageing band. Nothing can be recommended until that is recorded.'::text
                WHEN price_aed IS NULL OR cost_aed IS NULL THEN ('Missing '::text ||
                CASE
                    WHEN price_aed IS NULL AND cost_aed IS NULL THEN 'both list price and cost'::text
                    WHEN price_aed IS NULL THEN 'a list price'::text
                    ELSE 'an acquisition cost'::text
                END) || ', so margin cannot be computed and no recommendation is safe.'::text
                WHEN gross <= 0 THEN ((('Listed at AED '::text || to_char(COALESCE(price_aed, 0), 'FM999,999,999'::text)) || ' against a cost of AED '::text) || to_char(COALESCE(cost_aed, 0), 'FM999,999,999'::text)) || ' - at or below cost before any discount. A person has to decide this one.'::text
                WHEN days >= wholesale_days THEN (((((('On the lot '::text || days) || ' days, past the '::text) || wholesale_days) || '-day point, yet still carrying '::text) || gross_pct) || '% margin. Six months of pricing has not moved it, so the choice between a deeper cut '::text) || 'and a wholesale is a person''s, not the engine''s.'::text
                ELSE ((('Gross margin is '::text || gross_pct) || '%, under the '::text) || min_margin_pct) || '% floor, on a unit that is not yet aged. Priced this close to cost it has no room to discount later.'::text
            END
            ELSE NULL::text
        END AS reason,
        CASE
            WHEN is_sold THEN 'HIGH'::text
            WHEN days IS NULL OR price_aed IS NULL OR cost_aed IS NULL THEN 'LOW'::text
            WHEN market_position ~~ 'UNKNOWN%'::text OR NOT enq_ok THEN 'MEDIUM'::text
            ELSE 'HIGH'::text
        END AS confidence,
        CASE
            WHEN is_sold THEN 'The unit''s own status field is the whole basis.'::text
            WHEN days IS NULL OR price_aed IS NULL OR cost_aed IS NULL THEN 'A required input is missing from the record, so this is a finding about the data rather than about the car.'::text
            WHEN market_position ~~ 'UNKNOWN%'::text AND NOT enq_ok THEN ('The trigger - days in stock against the band this database already uses, and margin from real cost '::text || 'and price - is solid. Capped at MEDIUM because neither of the two things that would confirm the '::text) || 'direction is available: no verified market comparable, and enquiry coverage below the floor.'::text
            WHEN market_position ~~ 'UNKNOWN%'::text THEN 'The trigger is solid. Capped at MEDIUM because there is no verified market comparable for this model.'::text
            WHEN NOT enq_ok THEN 'The trigger is solid. Capped at MEDIUM because enquiry coverage across the lot is below the floor.'::text
            ELSE 'Days, margin, a verified market comparable and adequate enquiry coverage all present.'::text
        END AS confidence_basis,
        CASE
            WHEN recommendation = 'HOLD'::text THEN NULL::integer
            WHEN gross IS NULL THEN NULL::integer
            ELSE gross
        END AS impact_aed,
        CASE
            WHEN recommendation = 'HOLD'::text THEN 'NONE'::text
            WHEN gross IS NULL THEN 'NOT_COMPUTABLE'::text
            ELSE 'MARGIN_EXPOSED'::text
        END AS impact_kind,
        CASE
            WHEN recommendation = 'HOLD'::text THEN
            CASE
                WHEN is_sold THEN 'No action recommended, so no impact is claimed.'::text
                ELSE ('No action recommended, so no impact is claimed. AED '::text || to_char(COALESCE(gross, 0), 'FM999,999,999'::text)) || ' of gross margin is intact and not at risk yet.'::text
            END
            WHEN gross IS NULL THEN 'Not computable: margin cannot be derived from this record.'::text
            ELSE ((((('EXPOSURE - AED '::text || to_char(gross, 'FM999,999,999'::text)) || ' of gross margin (list minus acquisition cost) sits in a unit that has not sold in '::text) || COALESCE(days::text, 'an unknown number of'::text)) || ' days. This is the amount AT RISK. It is not '::text) || 'expected loss, not attributed revenue and not recovered revenue. '::text) ||
            CASE
                WHEN holding_state = 'NOT_COMPUTABLE'::text THEN 'How fast it is being eaten is NOT COMPUTABLE - no holding rate on record.'::text
                WHEN holding_state = 'PLACEHOLDER'::text THEN ('On a PLACEHOLDER rate it would be reduced by AED '::text || to_char(holding_rate, 'FM999,999,990.00'::text)) || ' a day, which is an assumption, not this dealership''s cost.'::text
                ELSE ('It is being reduced by AED '::text || to_char(holding_rate, 'FM999,999,990.00'::text)) || ' of holding cost every further day, at the rate this dealership supplied.'::text
            END
        END AS impact_basis,
        CASE recommendation
            WHEN 'HOLD'::text THEN NULL::text
            WHEN 'PROMOTE'::text THEN 'Marketing'::text
            WHEN 'INSPECT'::text THEN 'Workshop / Recon'::text
            WHEN 'REPRICE'::text THEN 'Sales Manager'::text
            WHEN 'WHOLESALE'::text THEN 'Sales Manager'::text
            WHEN 'MANAGER_REVIEW'::text THEN 'Sales Manager'::text
            ELSE NULL::text
        END AS suggested_owner_role,
        CASE
            WHEN recommendation = 'HOLD'::text THEN 'NO_ACTION'::text
            ELSE 'ROLE_ONLY'::text
        END AS suggested_owner_state,
        CASE
            WHEN recommendation = 'HOLD'::text THEN 'No action, so no owner.'::text
            ELSE 'A role, not a person. NEXUS holds no role directory for this dealership, so it will not '::text || 'put a name against an action it cannot verify that person owns.'::text
        END AS suggested_owner_note,
    recommendation <> 'HOLD'::text AS human_approval_required,
        CASE recommendation
            WHEN 'HOLD'::text THEN 'NONE_NEEDED'::text
            WHEN 'PROMOTE'::text THEN 'AUTOMATABLE_AFTER_APPROVAL'::text
            ELSE 'MANUAL_ONLY'::text
        END AS automation_state,
    jsonb_build_array(jsonb_build_object('fact', (('On the lot '::text || COALESCE(days::text, 'an unknown number of'::text)) || ' days'::text) ||
        CASE
            WHEN acquired_at IS NULL THEN ''::text
            ELSE (' (acquired '::text || to_char(acquired_at::timestamp with time zone, 'DD Mon YYYY'::text)) || ')'::text
        END, 'source', 'inventory.acquired_at, counted on the Asia/Dubai calendar'), jsonb_build_object('fact',
        CASE
            WHEN gross IS NULL THEN 'Gross margin not computable'::text
            ELSE ((('Gross margin AED '::text || to_char(gross, 'FM999,999,999'::text)) || ' ('::text) || gross_pct) || '% of list)'::text
        END, 'source', 'inventory.price_aed minus inventory.cost_aed'), jsonb_build_object('fact',
        CASE
            WHEN holding_rate IS NULL THEN 'Holding cost: UNKNOWN - no rate on record for this dealership'::text
            WHEN holding_basis = 'PLACEHOLDER'::text THEN ('Holding cost AED '::text || to_char(COALESCE(holding_aed, 0::numeric), 'FM999,999,999'::text)) || ' on a PLACEHOLDER rate'::text
            ELSE 'Holding cost accrued AED '::text || to_char(COALESCE(holding_aed, 0::numeric), 'FM999,999,999'::text)
        END, 'source', 'inventory_profit_settings.holding_cost_per_day_aed'::text || COALESCE((((' ('::text || holding_source) || ', set by '::text) || holding_set_by) || ')'::text, ''::text)), jsonb_build_object('fact',
        CASE
            WHEN gross IS NULL OR holding_state = 'NOT_COMPUTABLE'::text THEN 'Net margin: NOT COMPUTABLE'::text
            ELSE 'Net margin AED '::text || to_char(gross::numeric - holding_aed, 'FM999,999,999'::text)
        END, 'source', 'gross margin minus holding cost'), jsonb_build_object('fact', 'Market position: '::text || market_position, 'source', 'competitors, newest row for this exact model'::text || COALESCE((((' ('::text || competitor) || ', match quality '::text) || COALESCE(NULLIF(match_quality, ''::text), 'not recorded'::text)) || ')'::text, ''::text)), jsonb_build_object('fact', ((((enq_n || ' resolvable enquiries in '::text) || enq_days) || ' days ('::text) ||
        CASE
            WHEN enq_ok THEN 'coverage sufficient'::text
            ELSE 'coverage below floor - evidence only'::text
        END) || ')'::text, 'source', ('leads.vehicle_interest and inbound communication_logs, matched on '::text || min_overlap) || '+ shared model words'::text), jsonb_build_object('fact', ((((('Band '::text || band) || ' at warn '::text) || warn_days) || ' / critical '::text) || crit_days) || ' days'::text, 'source', 'inventory_profit_settings, defaulted from recompute_inventory_derived()'), jsonb_build_object('fact', (('Risk: age '::text ||
        CASE age_rank
            WHEN 3 THEN 'SEVERE'::text
            WHEN 2 THEN 'HIGH'::text
            WHEN 1 THEN 'ELEVATED'::text
            WHEN 0 THEN 'LOW'::text
            ELSE 'UNKNOWN'::text
        END) || ', margin '::text) ||
        CASE margin_rank
            WHEN 3 THEN 'SEVERE'::text
            WHEN 2 THEN 'HIGH'::text
            WHEN 0 THEN 'LOW'::text
            ELSE 'UNKNOWN'::text
        END, 'source', 'days_in_stock against the configured bands; gross margin % against min_reprice_margin_pct')) AS evidence,
    warn_days,
    crit_days,
    promote_days,
    wholesale_days,
    min_margin_pct,
    tol_pct,
    min_enq_sources,
    min_overlap AS min_model_token_overlap,
    mkt_max_age AS market_max_age_days,
    on_defaults AS settings_are_defaults,
    now() AS computed_at
   FROM r;

CREATE OR REPLACE VIEW public.v_inventory_sales WITH (security_invoker=on) AS
 SELECT id,
    model,
    status,
    price_aed,
    days_in_stock,
    tenant_id
   FROM inventory i
  WHERE tenant_id = nexus_scoped_tenant_id();

CREATE OR REPLACE VIEW public.v_lead_messages WITH (security_invoker=true) AS
 WITH person AS (
         SELECT l_1.id,
            l_1.tenant_id,
            COALESCE(NULLIF(lower(btrim(COALESCE(l_1.email, ''::text))), ''::text), 'lead:'::text || l_1.id::text) AS person_key,
            NULLIF("right"(regexp_replace(COALESCE(l_1.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9), ''::text) AS tail9,
            length(regexp_replace(COALESCE(l_1.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text)) AS plen
           FROM leads l_1
        ), unique_tail AS (
         SELECT p.tenant_id,
            p.tail9
           FROM person p
          WHERE p.tail9 IS NOT NULL AND p.plen >= 9
          GROUP BY p.tenant_id, p.tail9
         HAVING count(DISTINCT p.person_key) = 1
        )
 SELECT l.id AS lead_id,
    c.id,
    c.created_at,
    c.channel,
    c.direction,
    c.message,
    c.lead_email,
    nexus_is_message(c.direction, c.channel, c.message) AS is_message,
    c.tenant_id
   FROM communication_logs c
     JOIN leads l ON l.tenant_id = c.tenant_id AND (COALESCE(btrim(l.email), ''::text) <> ''::text AND lower(btrim(c.lead_email)) = lower(btrim(l.email)) OR c.lead_email !~~ '%@lid'::text AND length(regexp_replace(split_part(c.lead_email, '@'::text, 1), '[^0-9]'::text, ''::text, 'g'::text)) >= 9 AND "right"(regexp_replace(split_part(c.lead_email, '@'::text, 1), '[^0-9]'::text, ''::text, 'g'::text), 9) = "right"(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9) AND length(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text)) >= 9 AND (EXISTS ( SELECT 1
           FROM unique_tail ut
          WHERE ut.tenant_id = l.tenant_id AND ut.tail9 = "right"(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9))) OR c.lead_email ~~ '%@lid'::text AND (EXISTS ( SELECT 1
           FROM whatsapp_contacts wc
          WHERE wc.chat_id = c.lead_email AND wc.tenant_id = c.tenant_id AND (COALESCE(btrim(l.email), ''::text) <> ''::text AND lower(btrim(wc.lead_email)) = lower(btrim(l.email)) OR length(regexp_replace(COALESCE(wc.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text)) >= 9 AND "right"(regexp_replace(COALESCE(wc.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9) = "right"(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9) AND length(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text)) >= 9 AND (EXISTS ( SELECT 1
                   FROM unique_tail ut2
                  WHERE ut2.tenant_id = l.tenant_id AND ut2.tail9 = "right"(regexp_replace(COALESCE(l.phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 9)))))));

CREATE OR REPLACE VIEW public.v_lead_recovery_health WITH (security_invoker=true) AS
 SELECT a.tenant_id,
    count(*) AS actions_total,
    count(*) FILTER (WHERE a.status = 'PROPOSED'::text) AS awaiting_decision,
    count(*) FILTER (WHERE a.status = 'PROPOSED'::text AND a.escalated_at IS NOT NULL) AS escalated_no_approver,
    count(*) FILTER (WHERE a.status = 'APPROVED'::text AND a.executed_at IS NULL) AS approved_not_executed,
    count(*) FILTER (WHERE a.status = 'EXECUTED'::text) AS executed,
    count(*) FILTER (WHERE a.status = 'EXECUTION_FAILED'::text) AS execution_failed,
    count(*) FILTER (WHERE a.status = 'REJECTED'::text) AS rejected,
    count(*) FILTER (WHERE a.status = 'DEFERRED'::text) AS deferred,
    count(*) FILTER (WHERE a.status = 'CANCELLED'::text) AS cancelled,
    count(*) FILTER (WHERE a.outcome_state = 'ATTRIBUTED'::text) AS outcomes_attributed,
    count(*) FILTER (WHERE a.outcome_state = 'NOT_ATTRIBUTABLE'::text) AS outcomes_not_attributable,
    count(*) FILTER (WHERE a.status = 'EXECUTED'::text AND a.outcome_state = 'AWAITING_OUTCOME'::text) AS executed_awaiting_outcome,
    sum(a.recovered_value_aed) FILTER (WHERE a.outcome_state = 'ATTRIBUTED'::text) AS attributed_revenue_aed,
    max(a.proposed_at) AS last_proposed_at,
    max(a.decided_at) AS last_decided_at,
    max(a.executed_at) AS last_executed_at,
    ev.events_total,
    ev.events_without_audit,
    aud.audit_rows,
    aud.audit_rows_30d,
    aud.last_audit_at,
        CASE
            WHEN count(*) = 0 THEN 'NO_ACTIONS'::text
            WHEN COALESCE(ev.events_without_audit, 0::bigint) > 0 THEN 'AUDIT_TRAIL_BROKEN'::text
            WHEN COALESCE(aud.audit_rows, 0::bigint) = 0 THEN 'AUDIT_TRAIL_BROKEN'::text
            WHEN count(*) FILTER (WHERE a.status = 'EXECUTION_FAILED'::text) > 0 THEN 'EXECUTIONS_FAILING'::text
            WHEN count(*) FILTER (WHERE a.status = 'PROPOSED'::text AND a.escalated_at IS NOT NULL) > 0 THEN 'NOBODY_MAY_APPROVE'::text
            ELSE 'ACTIVE'::text
        END AS health
   FROM lead_recovery_actions a
     LEFT JOIN LATERAL ( SELECT count(*) AS events_total,
            count(*) FILTER (WHERE e.audit_log_id IS NULL) AS events_without_audit
           FROM lead_recovery_action_events e
          WHERE e.tenant_id = a.tenant_id) ev ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS audit_rows,
            count(*) FILTER (WHERE l.logged_at > (now() - '30 days'::interval)) AS audit_rows_30d,
            max(l.logged_at) AS last_audit_at
           FROM audit_log l
          WHERE l.tenant_id = a.tenant_id AND l.workflow = 'Lead Recovery Action Center'::text) aud ON true
  GROUP BY a.tenant_id, ev.events_total, ev.events_without_audit, aud.audit_rows, aud.audit_rows_30d, aud.last_audit_at;

CREATE OR REPLACE VIEW public.v_policy_rule WITH (security_invoker=true) AS
 SELECT r.id,
    r.tenant_id,
    r.tenant_id IS NULL AS is_global_rule,
    r.jurisdiction,
    r.rule_type,
    r.rule_name,
    r.version,
    r.supersedes_id,
    r.value_numeric,
    r.value_text,
    r.unit,
    r.value_kind,
        CASE
            WHEN r.verification_status = 'UNKNOWN'::text THEN NULL::text
            WHEN r.value_kind = 'NUMERIC'::text THEN (TRIM(BOTH FROM to_char(r.value_numeric, 'FM999,999,999,990.999999'::text)) || ' '::text) || r.unit
            ELSE r.value_text
        END AS value_display,
    r.status,
    r.verification_status,
    r.confidence,
    r.effective_from,
    r.effective_to,
    r.source_name,
    r.source_url,
    r.source_document,
    r.verification_date,
    r.verified_by,
    r.added_by,
    r.added_at,
    r.updated_at,
    r.notes,
    a.authority,
        CASE a.authority
            WHEN 'AUTHORITATIVE'::text THEN ((('Verified against '::text || COALESCE(r.source_name, 'its source'::text)) || ' on '::text) || to_char(r.verification_date::timestamp with time zone, 'DD Mon YYYY'::text)) || ' and in force today. This rule may be relied on.'::text
            WHEN 'UNKNOWN'::text THEN 'No value has ever been stated for this rule. It is registered as a question, not as an answer. '::text || 'Nothing may be computed from it and no claim may be made on it.'::text
            WHEN 'NOT_VERIFIED'::text THEN (('A value is recorded but NOBODY HAS CHECKED IT against '::text || COALESCE(r.source_name, 'any source'::text)) || '. It describes what this system currently does, not what the law or the lender says. '::text) || 'It may not be quoted to a customer or used in a regulatory claim.'::text
            WHEN 'DISPUTED'::text THEN 'Sources disagree about this rule. Until that is resolved it may not be relied on.'::text
            WHEN 'NOT_IN_FORCE'::text THEN ('This version is '::text || lower(r.status)) || ' — it is not the rule in force.'::text
            WHEN 'NO_EFFECTIVE_DATE'::text THEN 'This version states no effective_from, so it cannot be tied to the date any decision was taken.'::text
            WHEN 'NOT_YET_EFFECTIVE'::text THEN ('This version does not take effect until '::text || to_char(r.effective_from::timestamp with time zone, 'DD Mon YYYY'::text)) || '.'::text
            WHEN 'EXPIRED'::text THEN ('This version stopped applying on '::text || to_char(r.effective_to::timestamp with time zone, 'DD Mon YYYY'::text)) || '. It remains readable because decisions taken while it applied were correct under it.'::text
            ELSE 'Unrecognised authority state.'::text
        END AS authority_reason,
    a.authority = 'AUTHORITATIVE'::text AS may_be_relied_on
   FROM policy_rule r
     CROSS JOIN LATERAL ( SELECT policy_authority(r.status, r.verification_status, r.effective_from, r.effective_to, (now() AT TIME ZONE 'Asia/Dubai'::text)::date) AS authority) a;

CREATE OR REPLACE VIEW public.v_policy_rule_history WITH (security_invoker=true) AS
 SELECT r.tenant_id,
    r.jurisdiction,
    r.rule_type,
    r.rule_name,
    r.version,
    r.id,
    r.supersedes_id,
    r.status,
    r.verification_status,
    r.value_numeric,
    r.value_text,
    r.unit,
    r.effective_from,
    r.effective_to,
    r.source_name,
    r.source_document,
    r.verification_date,
    r.verified_by,
    r.added_by,
    r.added_at,
    prev.value_numeric AS previous_value_numeric,
    prev.value_text AS previous_value_text,
    prev.effective_from AS previous_effective_from,
    prev.effective_to AS previous_effective_to,
    prev.source_name AS previous_source_name
   FROM policy_rule r
     LEFT JOIN policy_rule prev ON prev.id = r.supersedes_id;

CREATE OR REPLACE VIEW public.v_team_performance WITH (security_invoker=true) AS
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

CREATE OR REPLACE VIEW public.v_whatsapp_conversation_window WITH (security_invoker=true) AS
 SELECT c.tenant_id,
    c.integration_id,
    cr.channel_type,
    cr.external_identifier AS channel_identifier,
    c.customer_wa_id,
    c.last_customer_message_at,
    c.last_customer_message_external_id,
    c.last_customer_message_source,
    w.rule_id AS window_rule_id,
    w.value_numeric AS window_hours,
    w.verification_status AS window_rule_verification_status,
    w.authority AS window_rule_authority,
        CASE
            WHEN c.last_customer_message_at IS NULL OR w.value_numeric IS NULL THEN NULL::timestamp with time zone
            ELSE c.last_customer_message_at + w.value_numeric::double precision * '01:00:00'::interval
        END AS window_expires_at,
        CASE
            WHEN c.last_customer_message_at IS NULL OR w.value_numeric IS NULL THEN 'UNKNOWN'::text
            WHEN now() < (c.last_customer_message_at + w.value_numeric::double precision * '01:00:00'::interval) THEN 'OPEN'::text
            ELSE 'CLOSED'::text
        END AS window_state,
    COALESCE(o.state, 'OPT_IN_UNKNOWN'::text) AS opt_in_state,
    o.occurred_at AS opt_in_last_event_at,
    o.evidence_ref AS opt_in_evidence_ref
   FROM whatsapp_conversation_state c
     JOIN channel_registry cr ON cr.integration_id = c.integration_id
     LEFT JOIN LATERAL whatsapp_policy_rule_lookup(c.tenant_id, 'PLATFORM_WHATSAPP'::text, 'WA_CUSTOMER_SERVICE_WINDOW_HOURS'::text) w(rule_id, jurisdiction, rule_name, value_numeric, value_text, unit, status, verification_status, authority, source_name, source_url, effective_from, notes) ON true
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN e.event = 'OPT_IN'::text THEN 'OPTED_IN'::text
                    ELSE 'OPTED_OUT'::text
                END AS state,
            e.occurred_at,
            e.evidence_ref
           FROM whatsapp_opt_in_event e
          WHERE e.tenant_id = c.tenant_id AND e.integration_id = c.integration_id AND e.customer_wa_id = c.customer_wa_id
          ORDER BY e.occurred_at DESC, e.recorded_at DESC
         LIMIT 1) o ON true;

CREATE OR REPLACE VIEW public.v_whatsapp_message_usage WITH (security_invoker=true) AS
 SELECT u.usage_id,
    u.tenant_id,
    u.integration_id,
    u.event_id,
    u.sent_at,
    u.message_category,
    u.template_required,
    u.template_id,
    t.name AS template_name,
    t.language AS template_language,
    u.policy_decision,
    u.policy_reason_code,
    u.policy_rule_id,
    u.policy_rule_name,
    u.policy_rule_verification_status,
    u.policy_decided_at,
    u.template_provider_status_at_send,
    u.template_status_age_at_send,
    u.template_staleness_verdict_at_send,
    t.provider_status AS template_provider_status_now,
    u.template_id IS NOT NULL AND u.template_provider_status_at_send IS NOT NULL AND t.provider_status IS DISTINCT FROM u.template_provider_status_at_send AS template_status_changed_since_send,
    u.latest_status,
    u.latest_status_at,
    u.billing_fact_state,
    u.provider_billable,
    u.provider_pricing_model,
    u.provider_pricing_category,
    u.provider_pricing_type,
    u.provider_conversation_id,
    u.provider_conversation_origin_type,
    u.provider_conversation_expiration_at,
    u.provider_pricing_observed_at,
    u.cost_state,
        CASE u.cost_state
            WHEN 'UNKNOWN_AWAITING_PROVIDER_REPORT'::text THEN 'Unknown - no status callback has arrived for this message yet.'::text
            WHEN 'UNKNOWN_PROVIDER_REPORTED_NO_PRICING'::text THEN 'Unknown - the provider''s callback carried no pricing object.'::text
            WHEN 'NOT_BILLABLE_PROVIDER_REPORTED'::text THEN 'Not billable - the provider itself reported billable = false.'::text
            WHEN 'BILLABLE_AMOUNT_UNKNOWN_NO_RATE_CARD'::text THEN 'Billable, amount unknown - the provider charged for this and NEXUS holds no rate card for its country, category or date.'::text
            ELSE 'Unknown.'::text
        END AS cost_answer,
    u.recorded_at,
    u.updated_at
   FROM whatsapp_message_usage u
     LEFT JOIN whatsapp_templates t ON t.template_id = u.template_id;

CREATE OR REPLACE VIEW public.v_whatsapp_messaging_usage_monthly WITH (security_invoker=true) AS
 SELECT tenant_id,
    date_trunc('month'::text, sent_at) AS month,
    message_category,
    count(*) AS messages,
    count(*) FILTER (WHERE provider_billable IS TRUE) AS provider_billable_messages,
    count(*) FILTER (WHERE provider_billable IS FALSE) AS provider_not_billable_messages,
    count(*) FILTER (WHERE billing_fact_state = 'AWAITING_PROVIDER_REPORT'::text) AS awaiting_provider_report,
    count(*) FILTER (WHERE billing_fact_state = 'PROVIDER_REPORTED_NO_PRICING'::text) AS reported_without_pricing,
    count(DISTINCT provider_conversation_id) AS provider_conversations_reported,
    count(*) FILTER (WHERE template_required) AS template_messages,
    count(*) FILTER (WHERE policy_rule_verification_status = 'VERIFIED'::text) AS sent_under_a_verified_rule,
    count(*) FILTER (WHERE policy_rule_verification_status = ANY (ARRAY['NOT_VERIFIED'::text, 'UNKNOWN'::text, 'DISPUTED'::text])) AS sent_under_an_unverified_rule,
    count(*) FILTER (WHERE policy_rule_verification_status = 'NO_RULE_APPLIED'::text) AS sent_with_no_rule_applied,
    count(*) FILTER (WHERE latest_status = 'failed'::text) AS failed_messages,
    count(*) FILTER (WHERE latest_status IS NULL) AS no_status_reported,
    'UNKNOWN - NEXUS holds no WhatsApp rate card. Meta prices by country, category and date; these are counts of what was sent and what the provider said about it, not an amount.'::text AS cost_answer
   FROM whatsapp_message_usage u
  GROUP BY tenant_id, (date_trunc('month'::text, sent_at)), message_category;

CREATE OR REPLACE VIEW public.v_whatsapp_template_registry WITH (security_invoker=true) AS
 SELECT template_id,
    tenant_id,
    integration_id,
    name,
    language,
    category,
    nexus_state,
    provider_status,
    provider_status_raw,
    provider_status_source,
    provider_status_observed_at,
        CASE
            WHEN provider_status_observed_at IS NULL THEN NULL::interval
            ELSE now() - provider_status_observed_at
        END AS status_age,
        CASE
            WHEN provider_status_source = 'NEVER_OBSERVED'::text THEN 'NEVER_OBSERVED'::text
            ELSE 'OBSERVED'::text
        END AS status_confidence,
    previous_provider_status,
    previous_status_observed_at,
    provider_rejected_reason,
    body_variable_count,
    variable_schema,
    body_text,
    body_text_source,
        CASE
            WHEN provider_status = 'UNKNOWN'::text THEN 'NEXUS has never asked the provider about this template. It is not approved, and it is not rejected -- it is unknown.'::text
            WHEN previous_provider_status IS NOT NULL AND provider_status <> previous_provider_status THEN format('The provider changed this template from %s to %s. Anything NEXUS sent on the old status was sent on a belief that no longer holds.'::text, previous_provider_status, provider_status)
            WHEN provider_status = 'APPROVED'::text THEN format('The provider said APPROVED when NEXUS last asked, on %s. Whether that is still true depends on how long ago that was.'::text, to_char(provider_status_observed_at, 'YYYY-MM-DD HH24:MI'::text))
            ELSE format('The provider last reported %s, on %s.'::text, provider_status, to_char(provider_status_observed_at, 'YYYY-MM-DD HH24:MI'::text))
        END AS what_this_row_claims,
    created_at,
    updated_at
   FROM whatsapp_templates t;

CREATE OR REPLACE VIEW public.v_workflow_health WITH (security_invoker=true) AS
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

CREATE OR REPLACE VIEW public.v_attribution_edges WITH (security_invoker=on) AS
 WITH cfg AS (
         SELECT t.id AS tenant_id,
            COALESCE(s.min_model_token_overlap, 2) AS min_overlap
           FROM tenants t
             LEFT JOIN inventory_profit_settings s ON s.tenant_id = t.id
        ), msg_resolved AS (
         SELECT m.id AS comm_id,
            count(DISTINCT m.lead_id) AS n_leads,
            min(m.lead_id) AS lead_id
           FROM v_lead_messages m
          GROUP BY m.id
        ), key_lead AS (
         SELECT cl.tenant_id,
            lower(btrim(m.lead_email)) AS ckey,
            min(m.lead_id) AS lead_id
           FROM v_lead_messages m
             JOIN communication_logs cl ON cl.id = m.id
          GROUP BY cl.tenant_id, (lower(btrim(m.lead_email)))
         HAVING count(DISTINCT m.lead_id) = 1
        )
 SELECT l.tenant_id,
    'CAMPAIGN_TO_LEAD'::text AS edge,
    'campaign'::text AS from_kind,
    NULL::text AS from_ref,
    'lead'::text AS to_kind,
    l.id::text AS to_ref,
    'NO_SOURCE_TABLE'::text AS basis,
    'NONE'::text AS confidence,
    (('No campaigns table exists in this database. leads.source holds "'::text || COALESCE(NULLIF(btrim(l.source), ''::text), 'nothing'::text)) || '", which is the name of the internal workflow that created this row, not a '::text) || 'marketing channel. Which advertisement, listing or referral produced this lead is UNKNOWN.'::text AS note
   FROM leads l
UNION ALL
 SELECT cl.tenant_id,
    'LEAD_TO_CONVERSATION'::text AS edge,
    'lead'::text AS from_kind,
        CASE
            WHEN COALESCE(r.n_leads, 0::bigint) = 1 THEN r.lead_id::text
            ELSE NULL::text
        END AS from_ref,
    'message'::text AS to_kind,
    cl.id::text AS to_ref,
        CASE
            WHEN COALESCE(r.n_leads, 0::bigint) = 1 THEN 'RESOLVED_IDENTITY'::text
            ELSE 'UNRESOLVED_KEY'::text
        END AS basis,
        CASE
            WHEN COALESCE(r.n_leads, 0::bigint) = 1 THEN 'MEDIUM'::text
            ELSE 'NONE'::text
        END AS confidence,
        CASE
            WHEN COALESCE(r.n_leads, 0::bigint) = 1 THEN ('Identity rule (INV-002) on key '::text || COALESCE(cl.lead_email, 'null'::text)) || '.'::text
            WHEN COALESCE(r.n_leads, 0::bigint) > 1 THEN ('REFUSED: key '::text || COALESCE(cl.lead_email, 'null'::text)) || ' resolves to more than one person.'::text
            ELSE ('UNKNOWN: key '::text || COALESCE(cl.lead_email, 'null'::text)) || ' matches no lead in this dealership.'::text
        END AS note
   FROM communication_logs cl
     LEFT JOIN msg_resolved r ON r.comm_id = cl.id
  WHERE nexus_is_message(cl.direction, cl.channel, cl.message)
UNION ALL
 SELECT l.tenant_id,
    'LEAD_TO_VEHICLE'::text AS edge,
    'lead'::text AS from_kind,
    l.id::text AS from_ref,
    'inventory_unit'::text AS to_kind,
    i.id AS to_ref,
    'MODEL_TEXT_ONLY'::text AS basis,
    'NONE'::text AS confidence,
    (((((('REFUSED. This lead''s free-text interest shares '::text || (( SELECT count(*) AS count
           FROM unnest(nexus_model_tokens(i.model)) t(t)
          WHERE t.t = ANY (nexus_model_tokens(l.vehicle_interest))))) || ' model words with unit '::text) || i.id) || ' ('::text) || i.model) || '). leads has no column that could name a unit, so this is a coincidence of words. '::text) || 'Shown so a person can decide; never used as an edge.'::text AS note
   FROM leads l
     JOIN cfg c ON c.tenant_id = l.tenant_id
     JOIN inventory i ON i.tenant_id = l.tenant_id
  WHERE COALESCE(btrim(l.vehicle_interest), ''::text) <> ''::text AND (( SELECT count(*) AS count
           FROM unnest(nexus_model_tokens(i.model)) t(t)
          WHERE t.t = ANY (nexus_model_tokens(l.vehicle_interest)))) >= c.min_overlap
UNION ALL
 SELECT ph.tenant_id,
    'LEAD_TO_DEAL'::text AS edge,
    'lead'::text AS from_kind,
    ph.lead_id::text AS from_ref,
    'sale'::text AS to_kind,
    ph.id::text AS to_ref,
        CASE
            WHEN ph.lead_id IS NOT NULL THEN 'FOREIGN_KEY'::text
            ELSE 'LINK_FIELD_EMPTY'::text
        END AS basis,
        CASE
            WHEN ph.lead_id IS NOT NULL THEN 'HIGH'::text
            ELSE 'NONE'::text
        END AS confidence,
        CASE
            WHEN ph.lead_id IS NOT NULL THEN 'purchase_history.lead_id -> leads(id), enforced by the database.'::text
            ELSE 'UNKNOWN: lead_id is NULL on this sale. Nobody recorded which lead it came from. '::text || 'That is not the same as the sale having come from no lead.'::text
        END AS note
   FROM purchase_history ph
UNION ALL
 SELECT ph.tenant_id,
    'DEAL_TO_DEAL_RECORD'::text AS edge,
    'sale'::text AS from_kind,
    ph.id::text AS from_ref,
    'deal_embedding'::text AS to_kind,
    de.id::text AS to_ref,
    'NATURAL_KEY_MATCH'::text AS basis,
    'HIGH'::text AS confidence,
    ('Identical deal_id "'::text || ph.deal_id) || '", scoped to this dealership. Exact but unenforced: no foreign key stands behind it.'::text AS note
   FROM purchase_history ph
     JOIN deals_embeddings de ON de.tenant_id = ph.tenant_id AND de.deal_id = ph.deal_id
  WHERE COALESCE(btrim(ph.deal_id), ''::text) <> ''::text
UNION ALL
 SELECT ia.tenant_id,
    'DEAL_TO_VEHICLE'::text AS edge,
    'sale'::text AS from_kind,
    ia.outcome_purchase_id::text AS from_ref,
    'inventory_unit'::text AS to_kind,
    ia.unit_id AS to_ref,
    'HUMAN_CONFIRMED_LINK'::text AS basis,
    'HIGH'::text AS confidence,
    (((('Confirmed by a named person through action_record_outcome() on inventory action '::text || ia.id::text) || '. attribution_basis on that row reads '::text) || COALESCE(ia.attribution_basis, 'null'::text)) || '. This is a belief recorded by a person, not a fact about the schema, and NEXUS does '::text) || 'not claim the action caused the sale.'::text AS note
   FROM inventory_actions ia
  WHERE ia.outcome_purchase_id IS NOT NULL AND ia.outcome_state = 'ATTRIBUTED'::text
UNION ALL
 SELECT ph.tenant_id,
    'DEAL_TO_VEHICLE'::text AS edge,
    'sale'::text AS from_kind,
    ph.id::text AS from_ref,
    'inventory_unit'::text AS to_kind,
    i.id AS to_ref,
    'MODEL_TEXT_ONLY'::text AS basis,
    'NONE'::text AS confidence,
    ((((((((((((((('REFUSED. Sale vehicle text "'::text || COALESCE(ph.vehicle, ''::text)) || '" shares '::text) || (( SELECT count(*) AS count
           FROM unnest(nexus_model_tokens(i.model)) t(t)
          WHERE t.t = ANY (nexus_model_tokens(ph.vehicle))))) || ' model words with unit '::text) || i.id) || ' ('::text) || i.model) || ', listed AED '::text) || to_char(COALESCE(i.price_aed, 0), 'FM999,999,999'::text)) || ', status '::text) || COALESCE(i.status, 'unknown'::text)) || ') against a sale of AED '::text) || to_char(COALESCE(ph.amount_aed, 0), 'FM999,999,999'::text)) || '. purchase_history has no column that could name a unit, so nothing here is a link - '::text) || 'not even an exact model and an exact price. A manager can confirm it through the '::text) || 'Inventory Action Center, which records HUMAN_CONFIRMED_LINK against their name.'::text AS note
   FROM purchase_history ph
     JOIN cfg c ON c.tenant_id = ph.tenant_id
     JOIN inventory i ON i.tenant_id = ph.tenant_id
  WHERE COALESCE(btrim(ph.vehicle), ''::text) <> ''::text AND (( SELECT count(*) AS count
           FROM unnest(nexus_model_tokens(i.model)) t(t)
          WHERE t.t = ANY (nexus_model_tokens(ph.vehicle)))) >= c.min_overlap AND NOT (EXISTS ( SELECT 1
           FROM inventory_actions ia
          WHERE ia.tenant_id = ph.tenant_id AND ia.outcome_purchase_id = ph.id AND ia.outcome_state = 'ATTRIBUTED'::text))
UNION ALL
 SELECT fq.tenant_id,
    'LEAD_TO_FINANCE'::text AS edge,
    'lead'::text AS from_kind,
    kl.lead_id::text AS from_ref,
    'finance_quote'::text AS to_kind,
    fq.id::text AS to_ref,
        CASE
            WHEN kl.lead_id IS NOT NULL THEN 'RESOLVED_IDENTITY'::text
            ELSE 'UNRESOLVED_KEY'::text
        END AS basis,
        CASE
            WHEN kl.lead_id IS NOT NULL THEN 'MEDIUM'::text
            ELSE 'NONE'::text
        END AS confidence,
        CASE
            WHEN kl.lead_id IS NOT NULL THEN 'Identity rule, reusing the key -> lead map v_lead_messages produced.'::text
            ELSE 'UNKNOWN: this quote''s lead_email is a key the identity rule has never resolved in a '::text || 'conversation, and the rule''s direct entry point is service_role only. Missed, not guessed.'::text
        END AS note
   FROM finance_quotes fq
     LEFT JOIN key_lead kl ON kl.tenant_id = fq.tenant_id AND kl.ckey = lower(btrim(fq.lead_email))
UNION ALL
 SELECT ph.tenant_id,
    'DEAL_TO_FINANCE'::text AS edge,
    'sale'::text AS from_kind,
    ph.id::text AS from_ref,
    'finance_quote'::text AS to_kind,
    NULL::text AS to_ref,
    'NO_LINK_FIELD'::text AS basis,
    'NONE'::text AS confidence,
    'purchase_history carries no quote id and no calculation_id, and finance_quotes carries no '::text || 'sale id. Whether this sale was financed, and on what terms, is UNKNOWN.'::text AS note
   FROM purchase_history ph
UNION ALL
 SELECT ph.tenant_id,
    'DEAL_TO_REVENUE'::text AS edge,
    'sale'::text AS from_kind,
    ph.id::text AS from_ref,
    'revenue'::text AS to_kind,
    ph.amount_aed::text AS to_ref,
    'SAME_ROW'::text AS basis,
    'HIGH'::text AS confidence,
    ('AED '::text || to_char(COALESCE(ph.amount_aed, 0), 'FM999,999,999'::text)) || ' is a column of the sale record. CONFIRMED revenue - not estimated, not attributed.'::text AS note
   FROM purchase_history ph;

CREATE OR REPLACE VIEW public.v_attribution_events WITH (security_invoker=on) AS
 WITH cfg AS (
         SELECT t.id AS tenant_id,
            COALESCE(s.min_model_token_overlap, 2) AS min_overlap
           FROM tenants t
             LEFT JOIN inventory_profit_settings s ON s.tenant_id = t.id
        ), msg_resolved AS (
         SELECT m.id AS comm_id,
            count(DISTINCT m.lead_id) AS n_leads,
            min(m.lead_id) AS lead_id
           FROM v_lead_messages m
          GROUP BY m.id
        ), key_lead AS (
         SELECT cl.tenant_id,
            lower(btrim(m.lead_email)) AS ckey,
            min(m.lead_id) AS lead_id
           FROM v_lead_messages m
             JOIN communication_logs cl ON cl.id = m.id
          GROUP BY cl.tenant_id, (lower(btrim(m.lead_email)))
         HAVING count(DISTINCT m.lead_id) = 1
        )
 SELECT l.tenant_id,
    10 AS event_seq,
    'LEAD_CREATED'::text AS event_type,
    'lead:'::text || l.id::text AS event_id,
    l.created_at AS occurred_at,
    'CUSTOMER'::text AS actor,
    'lead'::text AS subject_kind,
    l.id::text AS subject_ref,
    l.id AS lead_id,
    'SAME_ROW'::text AS lead_basis,
    'HIGH'::text AS lead_confidence,
    'The lead row is the event.'::text AS lead_note,
    NULL::text AS unit_id,
    'NO_LINK_FIELD'::text AS unit_basis,
    'leads carries no vehicle reference of any kind.'::text AS unit_note,
    NULL::integer AS amount_aed,
    'NONE'::text AS amount_kind,
    (('source='::text || COALESCE(NULLIF(btrim(l.source), ''::text), 'not recorded'::text)) || '; status='::text) || COALESCE(l.status, 'not recorded'::text) AS detail
   FROM leads l
UNION ALL
 SELECT l.tenant_id,
    40 AS event_seq,
    'VEHICLE_INTEREST'::text AS event_type,
    'lead-interest:'::text || l.id::text AS event_id,
    l.created_at AS occurred_at,
    'CUSTOMER'::text AS actor,
    'lead'::text AS subject_kind,
    l.id::text AS subject_ref,
    l.id AS lead_id,
    'SAME_ROW'::text AS lead_basis,
    'HIGH'::text AS lead_confidence,
    'Interest belongs to the lead row it is written on.'::text AS lead_note,
    NULL::text AS unit_id,
        CASE
            WHEN cand.n > 0 THEN 'MODEL_TEXT_ONLY'::text
            ELSE 'NO_LINK_FIELD'::text
        END AS unit_basis,
        CASE
            WHEN cand.n > 0 THEN ((((cand.n || ' inventory unit(s) share '::text) || c.min_overlap) || '+ model words with this free text. NOT LINKED: there is no column on '::text) || 'leads that could name a unit, so this is a text coincidence and a prompt '::text) || 'for a person, not an edge.'::text
            ELSE ('No inventory unit shares '::text || c.min_overlap) || '+ model words with this text, and leads has no column that could name a unit anyway.'::text
        END AS unit_note,
    NULL::integer AS amount_aed,
    'NONE'::text AS amount_kind,
    "left"(l.vehicle_interest, 300) AS detail
   FROM leads l
     JOIN cfg c ON c.tenant_id = l.tenant_id
     CROSS JOIN LATERAL ( SELECT count(*)::integer AS n
           FROM inventory i
          WHERE i.tenant_id = l.tenant_id AND (( SELECT count(*) AS count
                   FROM unnest(nexus_model_tokens(i.model)) t(t)
                  WHERE t.t = ANY (nexus_model_tokens(l.vehicle_interest)))) >= c.min_overlap) cand
  WHERE COALESCE(btrim(l.vehicle_interest), ''::text) <> ''::text
UNION ALL
 SELECT cl.tenant_id,
        CASE
            WHEN lower(btrim(cl.direction)) = 'inbound'::text THEN 20
            ELSE 30
        END AS event_seq,
        CASE
            WHEN lower(btrim(cl.direction)) = 'inbound'::text THEN 'MESSAGE_RECEIVED'::text
            ELSE 'MESSAGE_SENT'::text
        END AS event_type,
    'msg:'::text || cl.id::text AS event_id,
    cl.created_at AS occurred_at,
        CASE
            WHEN lower(btrim(cl.direction)) = 'inbound'::text THEN 'CUSTOMER'::text
            ELSE 'DEALERSHIP'::text
        END AS actor,
    'message'::text AS subject_kind,
    cl.id::text AS subject_ref,
        CASE
            WHEN COALESCE(r.n_leads, 0::bigint) = 1 THEN r.lead_id
            ELSE NULL::integer
        END AS lead_id,
        CASE
            WHEN COALESCE(r.n_leads, 0::bigint) = 1 THEN 'RESOLVED_IDENTITY'::text
            ELSE 'UNRESOLVED_KEY'::text
        END AS lead_basis,
        CASE
            WHEN COALESCE(r.n_leads, 0::bigint) = 1 THEN 'MEDIUM'::text
            ELSE 'NONE'::text
        END AS lead_confidence,
        CASE
            WHEN COALESCE(r.n_leads, 0::bigint) = 1 THEN ('Resolved by the identity rule (v_lead_messages) from the key '::text || COALESCE(cl.lead_email, 'null'::text)) || '. MEDIUM, not HIGH: a rule over text, not a foreign key.'::text
            WHEN COALESCE(r.n_leads, 0::bigint) > 1 THEN ('REFUSED: the key '::text || COALESCE(cl.lead_email, 'null'::text)) || ' resolves to more than one person, so it is attached to neither (INV-002).'::text
            ELSE ('UNKNOWN: the key '::text || COALESCE(cl.lead_email, 'null'::text)) || ' matches no lead. This is a customer NEXUS has messages from and no lead row for - not an absence of conversation.'::text
        END AS lead_note,
    NULL::text AS unit_id,
    'NO_LINK_FIELD'::text AS unit_basis,
    'communication_logs carries no vehicle reference.'::text AS unit_note,
    NULL::integer AS amount_aed,
    'NONE'::text AS amount_kind,
    "left"(COALESCE(cl.message, ''::text), 300) AS detail
   FROM communication_logs cl
     LEFT JOIN msg_resolved r ON r.comm_id = cl.id
  WHERE nexus_is_message(cl.direction, cl.channel, cl.message)
UNION ALL
 SELECT fq.tenant_id,
    70 AS event_seq,
    'FINANCE_QUOTE'::text AS event_type,
    'quote:'::text || fq.id::text AS event_id,
    fq.created_at AS occurred_at,
    'DEALERSHIP'::text AS actor,
    'finance_quote'::text AS subject_kind,
    fq.id::text AS subject_ref,
    kl.lead_id,
        CASE
            WHEN kl.lead_id IS NOT NULL THEN 'RESOLVED_IDENTITY'::text
            ELSE 'UNRESOLVED_KEY'::text
        END AS lead_basis,
        CASE
            WHEN kl.lead_id IS NOT NULL THEN 'MEDIUM'::text
            ELSE 'NONE'::text
        END AS lead_confidence,
        CASE
            WHEN kl.lead_id IS NOT NULL THEN 'Resolved by the identity rule, reusing the key -> lead map v_lead_messages produced.'::text
            ELSE ('UNKNOWN: this quote''s lead_email is a key the identity rule has never resolved in a '::text || 'conversation, and the rule''s direct entry point is service_role only. Reported '::text) || 'unknown rather than guessed. This MISSES links; it never invents one.'::text
        END AS lead_note,
    NULL::text AS unit_id,
    'NO_LINK_FIELD'::text AS unit_basis,
    'finance_quotes carries no inventory reference; vehicle_value_aed is a number, not a unit.'::text AS unit_note,
    NULL::integer AS amount_aed,
    'NONE'::text AS amount_kind,
    (('tier='::text || COALESCE(fq.finance_tier, '?'::text)) || '; calculation_id='::text) || fq.calculation_id::text AS detail
   FROM finance_quotes fq
     LEFT JOIN key_lead kl ON kl.tenant_id = fq.tenant_id AND kl.ckey = lower(btrim(fq.lead_email))
UNION ALL
 SELECT ph.tenant_id,
    e.seq AS event_seq,
    e.event_type,
    e.prefix || ph.id::text AS event_id,
    e.occurred_at,
    'DEALERSHIP'::text AS actor,
    'sale'::text AS subject_kind,
    ph.id::text AS subject_ref,
    ph.lead_id,
        CASE
            WHEN ph.lead_id IS NOT NULL THEN 'FOREIGN_KEY'::text
            ELSE 'LINK_FIELD_EMPTY'::text
        END AS lead_basis,
        CASE
            WHEN ph.lead_id IS NOT NULL THEN 'HIGH'::text
            ELSE 'NONE'::text
        END AS lead_confidence,
        CASE
            WHEN ph.lead_id IS NOT NULL THEN 'purchase_history.lead_id, a declared foreign key to leads(id).'::text
            ELSE 'UNKNOWN: lead_id is NULL. The dashboard writes it only when the deal was picked '::text || 'from a lead, so this means nobody recorded the provenance - NOT that the sale came from no lead.'::text
        END AS lead_note,
    NULL::text AS unit_id,
    'NO_LINK_FIELD'::text AS unit_basis,
    'purchase_history holds no VIN, no stock number and no inventory id. The vehicle text on '::text || 'this sale may match a unit exactly and still prove nothing.'::text AS unit_note,
        CASE
            WHEN e.event_type = 'SALE_CONFIRMED'::text THEN ph.amount_aed
            ELSE NULL::integer
        END AS amount_aed,
        CASE
            WHEN e.event_type = 'SALE_CONFIRMED'::text THEN 'CONFIRMED_REVENUE'::text
            ELSE 'NONE'::text
        END AS amount_kind,
    "left"(COALESCE(ph.vehicle, ''::text), 300) AS detail
   FROM purchase_history ph
     CROSS JOIN LATERAL ( VALUES (50,'DEAL_CREATED'::text,'deal:'::text,ph.created_at), (80,'SALE_CONFIRMED'::text,'sale:'::text,(ph.purchase_date::timestamp without time zone AT TIME ZONE 'Asia/Dubai'::text))) e(seq, event_type, prefix, occurred_at);

CREATE OR REPLACE VIEW public.v_attribution_lead_chain WITH (security_invoker=on) AS
 WITH cfg AS (
         SELECT t.id AS tenant_id,
            COALESCE(s.min_model_token_overlap, 2) AS min_overlap
           FROM tenants t
             LEFT JOIN inventory_profit_settings s ON s.tenant_id = t.id
        ), msg AS (
         SELECT m.id AS comm_id,
            min(m.lead_id) AS lead_id
           FROM v_lead_messages m
          GROUP BY m.id
         HAVING count(DISTINCT m.lead_id) = 1
        ), key_lead AS (
         SELECT cl.tenant_id,
            lower(btrim(m.lead_email)) AS ckey,
            min(m.lead_id) AS lead_id
           FROM v_lead_messages m
             JOIN communication_logs cl ON cl.id = m.id
          GROUP BY cl.tenant_id, (lower(btrim(m.lead_email)))
         HAVING count(DISTINCT m.lead_id) = 1
        ), quotes_by_lead AS (
         SELECT fq.tenant_id,
            kl.lead_id,
            count(*)::integer AS n
           FROM finance_quotes fq
             JOIN key_lead kl ON kl.tenant_id = fq.tenant_id AND kl.ckey = lower(btrim(fq.lead_email))
          GROUP BY fq.tenant_id, kl.lead_id
        ), conv AS (
         SELECT cl.tenant_id,
            m.lead_id,
            count(*)::integer AS msgs,
            count(*) FILTER (WHERE lower(btrim(cl.direction)) = 'inbound'::text)::integer AS msgs_in,
            count(*) FILTER (WHERE lower(btrim(cl.direction)) = 'outbound'::text)::integer AS msgs_out,
            min(cl.created_at) AS first_at,
            max(cl.created_at) AS last_at
           FROM communication_logs cl
             JOIN msg m ON m.comm_id = cl.id
          WHERE nexus_is_message(cl.direction, cl.channel, cl.message)
          GROUP BY cl.tenant_id, m.lead_id
        ), sales AS (
         SELECT ph.tenant_id,
            ph.lead_id,
            count(*)::integer AS n_sales,
            sum(ph.amount_aed) AS revenue_aed,
            max(ph.purchase_date) AS last_sale_date
           FROM purchase_history ph
          WHERE ph.lead_id IS NOT NULL
          GROUP BY ph.tenant_id, ph.lead_id
        ), base AS (
         SELECT l.tenant_id,
            l.id AS lead_id,
            l.name AS lead_name,
            l.created_at,
            l.source,
            l.status,
            l.ai_score,
            l.vehicle_interest,
            c.min_overlap,
            cv.msgs,
            cv.msgs_in,
            cv.msgs_out,
            cv.first_at,
            cv.last_at,
            s.n_sales,
            s.revenue_aed,
            s.last_sale_date,
            COALESCE(q.n, 0) AS quotes,
            ( SELECT count(*)::integer AS count
                   FROM inventory i
                  WHERE i.tenant_id = l.tenant_id AND COALESCE(btrim(l.vehicle_interest), ''::text) <> ''::text AND (( SELECT count(*) AS count
                           FROM unnest(nexus_model_tokens(i.model)) t(t)
                          WHERE t.t = ANY (nexus_model_tokens(l.vehicle_interest)))) >= c.min_overlap) AS unit_candidates,
            ( SELECT string_agg(i.id, ', '::text ORDER BY i.id) AS string_agg
                   FROM inventory i
                  WHERE i.tenant_id = l.tenant_id AND COALESCE(btrim(l.vehicle_interest), ''::text) <> ''::text AND (( SELECT count(*) AS count
                           FROM unnest(nexus_model_tokens(i.model)) t(t)
                          WHERE t.t = ANY (nexus_model_tokens(l.vehicle_interest)))) >= c.min_overlap) AS unit_candidate_list
           FROM leads l
             JOIN cfg c ON c.tenant_id = l.tenant_id
             LEFT JOIN conv cv ON cv.tenant_id = l.tenant_id AND cv.lead_id = l.id
             LEFT JOIN sales s ON s.tenant_id = l.tenant_id AND s.lead_id = l.id
             LEFT JOIN quotes_by_lead q ON q.tenant_id = l.tenant_id AND q.lead_id = l.id
        )
 SELECT tenant_id,
    lead_id,
    lead_name,
    created_at,
    status,
    ai_score,
    source AS lead_source_field,
    'UNKNOWN_NO_SOURCE'::text AS campaign_state,
    'NO_SOURCE_TABLE'::text AS campaign_basis,
    (('UNKNOWN. No campaigns table exists. leads.source reads "'::text || COALESCE(NULLIF(btrim(source), ''::text), 'nothing'::text)) || '", the name of the internal workflow that created this row, not a marketing channel. '::text) || 'Nothing records which advertisement, listing or referral this person came from.'::text AS campaign_note,
    COALESCE(msgs, 0) AS conversation_messages,
    COALESCE(msgs_in, 0) AS messages_in,
    COALESCE(msgs_out, 0) AS messages_out,
    first_at AS first_message_at,
    last_at AS last_message_at,
        CASE
            WHEN COALESCE(msgs, 0) > 0 THEN 'RESOLVED'::text
            ELSE 'UNKNOWN_NO_RESOLVED_MESSAGES'::text
        END AS conversation_state,
        CASE
            WHEN COALESCE(msgs, 0) > 0 THEN 'RESOLVED_IDENTITY'::text
            ELSE 'UNRESOLVED_KEY'::text
        END AS conversation_basis,
        CASE
            WHEN COALESCE(msgs, 0) > 0 THEN 'MEDIUM'::text
            ELSE 'NONE'::text
        END AS conversation_confidence,
        CASE
            WHEN COALESCE(msgs, 0) > 0 THEN COALESCE(msgs, 0) || ' messages resolved to this lead by the identity rule (INV-002).'::text
            ELSE 'UNKNOWN: no message resolves to this lead. Messages may exist under a WhatsApp handle '::text || 'nobody has tied to this person - a missing row is not proof nothing was said.'::text
        END AS conversation_note,
    "left"(COALESCE(vehicle_interest, ''::text), 300) AS vehicle_interest_text,
    COALESCE(unit_candidates, 0) AS vehicle_text_candidates,
        CASE
            WHEN COALESCE(btrim(vehicle_interest), ''::text) = ''::text THEN 'UNKNOWN_NOT_RECORDED'::text
            WHEN COALESCE(unit_candidates, 0) > 0 THEN 'UNKNOWN_TEXT_ONLY'::text
            ELSE 'UNKNOWN_NO_FIELD'::text
        END AS vehicle_state,
        CASE
            WHEN COALESCE(unit_candidates, 0) > 0 THEN 'MODEL_TEXT_ONLY'::text
            ELSE 'NO_LINK_FIELD'::text
        END AS vehicle_basis,
        CASE
            WHEN COALESCE(btrim(vehicle_interest), ''::text) = ''::text THEN 'UNKNOWN: no vehicle interest recorded on this lead at all.'::text
            WHEN COALESCE(unit_candidates, 0) > 0 THEN ((((('UNKNOWN. leads has no column that could name a unit. '::text || unit_candidates) || ' unit(s) share '::text) || min_overlap) || '+ model words with the free text ('::text) || unit_candidate_list) || '), which is a prompt for a person and not a link.'::text
            ELSE ('UNKNOWN. leads has no column that could name a unit, and no unit shares '::text || min_overlap) || '+ model words with what this person wrote.'::text
        END AS vehicle_note,
    COALESCE(quotes, 0) AS finance_quotes,
        CASE
            WHEN COALESCE(quotes, 0) > 0 THEN 'RESOLVED'::text
            ELSE 'NO_QUOTE_RECORDED'::text
        END AS finance_state,
        CASE
            WHEN COALESCE(quotes, 0) > 0 THEN 'RESOLVED_IDENTITY'::text
            ELSE 'LINK_FIELD_EMPTY'::text
        END AS finance_basis,
        CASE
            WHEN COALESCE(quotes, 0) > 0 THEN (COALESCE(quotes, 0) || ' finance quote(s) resolve to this person. Note this says nothing '::text) || 'about whether any sale closed on one: no column ties a quote to a sale.'::text
            ELSE 'No finance quote resolves to this person. That is this database''s record, not proof '::text || 'they were never quoted.'::text
        END AS finance_note,
    COALESCE(n_sales, 0) AS sales_recorded,
    COALESCE(revenue_aed, 0::bigint) AS revenue_confirmed_aed,
    'CONFIRMED_REVENUE'::text AS revenue_kind,
    last_sale_date,
        CASE
            WHEN COALESCE(n_sales, 0) > 0 THEN 'RESOLVED'::text
            ELSE 'NO_SALE_RECORDED'::text
        END AS sale_state,
        CASE
            WHEN COALESCE(n_sales, 0) > 0 THEN 'FOREIGN_KEY'::text
            ELSE 'LINK_FIELD_EMPTY'::text
        END AS sale_basis,
        CASE
            WHEN COALESCE(n_sales, 0) > 0 THEN (COALESCE(n_sales, 0) || ' sale(s) carry this lead by the declared foreign key '::text) || 'purchase_history.lead_id. Revenue is CONFIRMED - a column of each sale.'::text
            ELSE 'No sale in this database names this lead. A sale recorded without a lead_id would be '::text || 'invisible here, so this is not proof this person did not buy.'::text
        END AS sale_note,
    NULL::bigint AS gross_margin_aed,
    'NOT_COMPUTABLE'::text AS margin_state,
    'NOT COMPUTABLE, not zero. Margin needs the acquisition cost of the unit sold, and no column '::text || 'ties any sale to an inventory unit.'::text AS margin_note,
    6 AS hops_total,
    0 +
        CASE
            WHEN COALESCE(msgs, 0) > 0 THEN 1
            ELSE 0
        END + 0 +
        CASE
            WHEN COALESCE(quotes, 0) > 0 THEN 1
            ELSE 0
        END +
        CASE
            WHEN COALESCE(n_sales, 0) > 0 THEN 1
            ELSE 0
        END +
        CASE
            WHEN COALESCE(n_sales, 0) > 0 THEN 1
            ELSE 0
        END AS hops_evidenced,
    'CAMPAIGN'::text AS first_break,
    jsonb_build_array(jsonb_build_object('hop', 'CAMPAIGN', 'state', 'UNKNOWN_NO_SOURCE', 'basis', 'NO_SOURCE_TABLE'), jsonb_build_object('hop', 'CONVERSATION', 'state',
        CASE
            WHEN COALESCE(msgs, 0) > 0 THEN 'RESOLVED'::text
            ELSE 'UNKNOWN_NO_RESOLVED_MESSAGES'::text
        END, 'messages', COALESCE(msgs, 0)), jsonb_build_object('hop', 'VEHICLE', 'state',
        CASE
            WHEN COALESCE(unit_candidates, 0) > 0 THEN 'UNKNOWN_TEXT_ONLY'::text
            ELSE 'UNKNOWN_NO_FIELD'::text
        END, 'refused_candidates', COALESCE(unit_candidates, 0)), jsonb_build_object('hop', 'FINANCE', 'state',
        CASE
            WHEN COALESCE(quotes, 0) > 0 THEN 'RESOLVED'::text
            ELSE 'NO_QUOTE_RECORDED'::text
        END, 'quotes', COALESCE(quotes, 0)), jsonb_build_object('hop', 'SALE', 'state',
        CASE
            WHEN COALESCE(n_sales, 0) > 0 THEN 'RESOLVED'::text
            ELSE 'NO_SALE_RECORDED'::text
        END, 'sales', COALESCE(n_sales, 0)), jsonb_build_object('hop', 'REVENUE', 'state',
        CASE
            WHEN COALESCE(n_sales, 0) > 0 THEN 'CONFIRMED'::text
            ELSE 'NONE_RECORDED'::text
        END, 'aed', COALESCE(revenue_aed, 0::bigint))) AS chain
   FROM base b;

CREATE OR REPLACE VIEW public.v_attribution_sale_chain WITH (security_invoker=on) AS
 WITH cfg AS (
         SELECT t.id AS tenant_id,
            COALESCE(s.min_model_token_overlap, 2) AS min_overlap
           FROM tenants t
             LEFT JOIN inventory_profit_settings s ON s.tenant_id = t.id
        ), msg AS (
         SELECT m.id AS comm_id,
            min(m.lead_id) AS lead_id
           FROM v_lead_messages m
          GROUP BY m.id
         HAVING count(DISTINCT m.lead_id) = 1
        ), key_lead AS (
         SELECT cl.tenant_id,
            lower(btrim(m.lead_email)) AS ckey,
            min(m.lead_id) AS lead_id
           FROM v_lead_messages m
             JOIN communication_logs cl ON cl.id = m.id
          GROUP BY cl.tenant_id, (lower(btrim(m.lead_email)))
         HAVING count(DISTINCT m.lead_id) = 1
        ), quotes_by_lead AS (
         SELECT fq.tenant_id,
            kl.lead_id,
            count(*)::integer AS n
           FROM finance_quotes fq
             JOIN key_lead kl ON kl.tenant_id = fq.tenant_id AND kl.ckey = lower(btrim(fq.lead_email))
          GROUP BY fq.tenant_id, kl.lead_id
        ), conv AS (
         SELECT cl.tenant_id,
            m.lead_id,
            count(*)::integer AS msgs,
            count(*) FILTER (WHERE lower(btrim(cl.direction)) = 'inbound'::text)::integer AS msgs_in,
            count(*) FILTER (WHERE lower(btrim(cl.direction)) = 'outbound'::text)::integer AS msgs_out,
            min(cl.created_at) AS first_at,
            max(cl.created_at) AS last_at
           FROM communication_logs cl
             JOIN msg m ON m.comm_id = cl.id
          WHERE nexus_is_message(cl.direction, cl.channel, cl.message)
          GROUP BY cl.tenant_id, m.lead_id
        ), hc AS (
         SELECT ia.tenant_id,
            ia.outcome_purchase_id AS sale_id,
            ia.unit_id,
            ia.id AS action_id
           FROM inventory_actions ia
          WHERE ia.outcome_purchase_id IS NOT NULL AND ia.outcome_state = 'ATTRIBUTED'::text
        ), base AS (
         SELECT ph.tenant_id,
            ph.id AS sale_id,
            ph.purchase_date,
            ph.created_at,
            ph.customer_name,
            ph.email,
            ph.phone,
            ph.vehicle,
            ph.amount_aed,
            ph.deal_id,
            ph.lead_id,
            l.name AS lead_name,
            l.source AS lead_source,
            l.created_at AS lead_created_at,
            c.min_overlap,
            hc.unit_id AS confirmed_unit_id,
            hc.action_id AS confirmed_by_action,
            ( SELECT count(*)::integer AS count
                   FROM inventory i
                  WHERE i.tenant_id = ph.tenant_id AND (( SELECT count(*) AS count
                           FROM unnest(nexus_model_tokens(i.model)) t(t)
                          WHERE t.t = ANY (nexus_model_tokens(ph.vehicle)))) >= c.min_overlap) AS text_candidates,
            ( SELECT string_agg(((((((i.id || ' ('::text) || i.model) || ', '::text) || COALESCE(i.status, '?'::text)) || ', listed AED '::text) || to_char(COALESCE(i.price_aed, 0), 'FM999,999,999'::text)) || ')'::text, '; '::text ORDER BY i.id) AS string_agg
                   FROM inventory i
                  WHERE i.tenant_id = ph.tenant_id AND (( SELECT count(*) AS count
                           FROM unnest(nexus_model_tokens(i.model)) t(t)
                          WHERE t.t = ANY (nexus_model_tokens(ph.vehicle)))) >= c.min_overlap) AS text_candidate_list,
            ( SELECT count(*)::integer AS count
                   FROM deals_embeddings de
                  WHERE de.tenant_id = ph.tenant_id AND de.deal_id = ph.deal_id) AS deal_records,
            COALESCE(q.n, 0) AS quotes_for_lead,
            cv.msgs,
            cv.msgs_in,
            cv.msgs_out,
            cv.first_at,
            cv.last_at
           FROM purchase_history ph
             JOIN cfg c ON c.tenant_id = ph.tenant_id
             LEFT JOIN leads l ON l.tenant_id = ph.tenant_id AND l.id = ph.lead_id
             LEFT JOIN hc ON hc.tenant_id = ph.tenant_id AND hc.sale_id = ph.id
             LEFT JOIN conv cv ON cv.tenant_id = ph.tenant_id AND cv.lead_id = ph.lead_id
             LEFT JOIN quotes_by_lead q ON q.tenant_id = ph.tenant_id AND q.lead_id = ph.lead_id
        ), walk AS (
         SELECT b.tenant_id,
            b.sale_id,
            b.purchase_date,
            b.created_at,
            b.customer_name,
            b.email,
            b.phone,
            b.vehicle,
            b.amount_aed,
            b.deal_id,
            b.lead_id,
            b.lead_name,
            b.lead_source,
            b.lead_created_at,
            b.min_overlap,
            b.confirmed_unit_id,
            b.confirmed_by_action,
            b.text_candidates,
            b.text_candidate_list,
            b.deal_records,
            b.quotes_for_lead,
            b.msgs,
            b.msgs_in,
            b.msgs_out,
            b.first_at,
            b.last_at,
            'UNKNOWN_NO_SOURCE'::text AS campaign_state,
            'NO_SOURCE_TABLE'::text AS campaign_basis,
            ((((('UNKNOWN. There is no campaigns table in this database. The lead this sale came from records '::text || 'source "'::text) || COALESCE(NULLIF(btrim(b.lead_source), ''::text), 'nothing'::text)) || '", which names the internal workflow that created the row, not a marketing channel. '::text) || 'Which channel produced this AED '::text) || to_char(COALESCE(b.amount_aed, 0), 'FM999,999,999'::text)) || ' cannot be answered at any confidence.'::text AS campaign_note,
                CASE
                    WHEN b.lead_id IS NOT NULL THEN 'RESOLVED'::text
                    ELSE 'UNKNOWN_LINK_EMPTY'::text
                END AS lead_state,
                CASE
                    WHEN b.lead_id IS NOT NULL THEN 'FOREIGN_KEY'::text
                    ELSE 'LINK_FIELD_EMPTY'::text
                END AS lead_basis,
                CASE
                    WHEN b.lead_id IS NOT NULL THEN 'HIGH'::text
                    ELSE 'NONE'::text
                END AS lead_confidence,
                CASE
                    WHEN b.lead_id IS NOT NULL THEN ((('Lead '::text || b.lead_id) || ' ('::text) || COALESCE(b.lead_name, 'unnamed'::text)) || '), by the declared foreign key purchase_history.lead_id -> leads(id).'::text
                    ELSE ('UNKNOWN. lead_id is NULL. The dashboard writes it only when the deal was picked from a '::text || 'lead, so this records that nobody captured the provenance - not that the sale came '::text) || 'from no lead. Every hop before this one is unreachable as a result.'::text
                END AS lead_note,
                CASE
                    WHEN b.lead_id IS NULL THEN 'UNKNOWN_UPSTREAM'::text
                    WHEN COALESCE(b.msgs, 0) > 0 THEN 'RESOLVED'::text
                    ELSE 'UNKNOWN_NO_RESOLVED_MESSAGES'::text
                END AS conversation_state,
                CASE
                    WHEN b.lead_id IS NULL THEN 'LINK_FIELD_EMPTY'::text
                    WHEN COALESCE(b.msgs, 0) > 0 THEN 'RESOLVED_IDENTITY'::text
                    ELSE 'UNRESOLVED_KEY'::text
                END AS conversation_basis,
                CASE
                    WHEN b.lead_id IS NOT NULL AND COALESCE(b.msgs, 0) > 0 THEN 'MEDIUM'::text
                    ELSE 'NONE'::text
                END AS conversation_confidence,
                CASE
                    WHEN b.lead_id IS NULL THEN 'UNKNOWN: no lead on the sale, so no conversation can be reached from it.'::text
                    WHEN COALESCE(b.msgs, 0) > 0 THEN (((((((((b.msgs || ' messages ('::text) || b.msgs_in) || ' in, '::text) || b.msgs_out) || ' out) between '::text) || to_char(b.first_at, 'DD Mon YYYY'::text)) || ' and '::text) || to_char(b.last_at, 'DD Mon YYYY'::text)) || ', resolved to this lead by the identity rule (INV-002). MEDIUM: a rule over four '::text) || 'incompatible key shapes, not a foreign key.'::text
                    ELSE 'UNKNOWN: no message resolves to this lead. Messages may exist under a WhatsApp handle '::text || 'this dealership has never tied to a person.'::text
                END AS conversation_note,
                CASE
                    WHEN b.confirmed_unit_id IS NOT NULL THEN 'RESOLVED'::text
                    WHEN COALESCE(b.text_candidates, 0) > 0 THEN 'UNKNOWN_TEXT_ONLY'::text
                    ELSE 'UNKNOWN_NO_FIELD'::text
                END AS vehicle_state,
                CASE
                    WHEN b.confirmed_unit_id IS NOT NULL THEN 'HUMAN_CONFIRMED_LINK'::text
                    WHEN COALESCE(b.text_candidates, 0) > 0 THEN 'MODEL_TEXT_ONLY'::text
                    ELSE 'NO_LINK_FIELD'::text
                END AS vehicle_basis,
                CASE
                    WHEN b.confirmed_unit_id IS NOT NULL THEN 'HIGH'::text
                    ELSE 'NONE'::text
                END AS vehicle_confidence,
                CASE
                    WHEN b.confirmed_unit_id IS NOT NULL THEN (((('Unit '::text || b.confirmed_unit_id) || ', confirmed by a named person through inventory action '::text) || b.confirmed_by_action::text) || '. A belief recorded by a person; NEXUS does not claim '::text) || 'that action caused the sale.'::text
                    WHEN COALESCE(b.text_candidates, 0) > 0 THEN (((((('UNKNOWN. purchase_history holds no VIN, no stock number and no inventory id. '::text || b.text_candidates) || ' unit(s) share model words with the sale text "'::text) || COALESCE(b.vehicle, ''::text)) || '": '::text) || b.text_candidate_list) || '. THE TEXT MATCHES AND PROVES NOTHING - note the unit''s status. A manager can '::text) || 'confirm the link in the Inventory Action Center; until one does, this stays UNKNOWN.'::text
                    ELSE 'UNKNOWN. purchase_history holds no reference to an inventory unit, and no unit even '::text || 'shares model words with the sale text.'::text
                END AS vehicle_note,
                CASE
                    WHEN COALESCE(b.deal_records, 0) > 0 THEN 'RESOLVED'::text
                    ELSE 'UNKNOWN_NO_MATCH'::text
                END AS deal_record_state,
                CASE
                    WHEN COALESCE(b.deal_records, 0) > 0 THEN 'NATURAL_KEY_MATCH'::text
                    ELSE 'UNRESOLVED_KEY'::text
                END AS deal_record_basis,
                CASE
                    WHEN COALESCE(b.deal_records, 0) > 0 THEN 'HIGH'::text
                    ELSE 'NONE'::text
                END AS deal_record_confidence,
                CASE
                    WHEN COALESCE(b.deal_records, 0) > 0 THEN ((b.deal_records || ' deals_embeddings row(s) on the identical deal_id "'::text) || b.deal_id) || '". Exact but unenforced - no foreign key stands behind it.'::text
                    ELSE ('UNKNOWN: no deals_embeddings row carries deal_id "'::text || COALESCE(b.deal_id, ''::text)) || '".'::text
                END AS deal_record_note,
            'UNKNOWN_NO_FIELD'::text AS finance_state,
            'NO_LINK_FIELD'::text AS finance_basis,
            ('UNKNOWN. purchase_history carries no quote id and no calculation_id; finance_quotes carries no '::text || 'sale id. '::text) ||
                CASE
                    WHEN b.lead_id IS NULL THEN 'No lead on the sale, so not even a same-person quote can be found.'::text
                    WHEN COALESCE(b.quotes_for_lead, 0) > 0 THEN (b.quotes_for_lead || ' finance quote(s) exist for the same person, which is NOT the '::text) || 'same as knowing this sale closed on one of them.'::text
                    ELSE 'No finance quote resolves to this person either, so nothing is known about how it was paid for.'::text
                END AS finance_note,
            'CONFIRMED'::text AS revenue_state,
            'SAME_ROW'::text AS revenue_basis,
            ('AED '::text || to_char(COALESCE(b.amount_aed, 0), 'FM999,999,999'::text)) || ', a column of the sale record. CONFIRMED revenue - not estimated, not attributed.'::text AS revenue_note,
            'NOT_COMPUTABLE'::text AS margin_state,
            (('NOT COMPUTABLE, which is not the same as zero. Gross profit is the sale amount minus the unit''s '::text || 'acquisition cost, and inventory.cost_aed is present on every unit - but nothing ties this sale '::text) || 'to a unit, so there is no cost to subtract. Fix the vehicle hop and this becomes a number '::text) || 'with no further work.'::text AS margin_note
           FROM base b
        )
 SELECT tenant_id,
    sale_id,
    purchase_date,
    created_at AS recorded_at,
    customer_name,
    vehicle AS vehicle_text,
    deal_id,
    amount_aed AS revenue_aed,
    'CONFIRMED_REVENUE'::text AS revenue_kind,
    NULL::integer AS gross_margin_aed,
    campaign_state,
    campaign_basis,
    campaign_note,
    lead_id,
    lead_name,
    lead_state,
    lead_basis,
    lead_confidence,
    lead_note,
    msgs AS conversation_messages,
    conversation_state,
    conversation_basis,
    conversation_confidence,
    conversation_note,
    confirmed_unit_id AS vehicle_unit_id,
    text_candidates AS vehicle_text_candidates,
    vehicle_state,
    vehicle_basis,
    vehicle_confidence,
    vehicle_note,
    deal_record_state,
    deal_record_basis,
    deal_record_confidence,
    deal_record_note,
    quotes_for_lead AS finance_quotes_for_lead,
    finance_state,
    finance_basis,
    finance_note,
    revenue_state,
    revenue_basis,
    revenue_note,
    margin_state,
    margin_note,
    8 AS hops_total,
        CASE
            WHEN campaign_state = 'UNKNOWN_NO_SOURCE'::text THEN 0
            ELSE 1
        END +
        CASE
            WHEN lead_state = 'RESOLVED'::text THEN 1
            ELSE 0
        END +
        CASE
            WHEN conversation_state = 'RESOLVED'::text THEN 1
            ELSE 0
        END +
        CASE
            WHEN vehicle_state = 'RESOLVED'::text THEN 1
            ELSE 0
        END +
        CASE
            WHEN deal_record_state = 'RESOLVED'::text THEN 1
            ELSE 0
        END +
        CASE
            WHEN finance_state = 'UNKNOWN_NO_FIELD'::text THEN 0
            ELSE 1
        END + 1 +
        CASE
            WHEN margin_state = 'NOT_COMPUTABLE'::text THEN 0
            ELSE 1
        END AS hops_evidenced,
        CASE
            WHEN campaign_state <> 'RESOLVED'::text THEN 'CAMPAIGN'::text
            WHEN lead_state <> 'RESOLVED'::text THEN 'LEAD'::text
            WHEN conversation_state <> 'RESOLVED'::text THEN 'CONVERSATION'::text
            WHEN vehicle_state <> 'RESOLVED'::text THEN 'VEHICLE'::text
            WHEN deal_record_state <> 'RESOLVED'::text THEN 'DEAL_RECORD'::text
            WHEN finance_state <> 'RESOLVED'::text THEN 'FINANCE'::text
            WHEN margin_state <> 'COMPUTED'::text THEN 'MARGIN'::text
            ELSE NULL::text
        END AS first_break,
    jsonb_build_array(jsonb_build_object('hop', 'CAMPAIGN', 'state', campaign_state, 'basis', campaign_basis, 'note', campaign_note), jsonb_build_object('hop', 'LEAD', 'state', lead_state, 'basis', lead_basis, 'note', lead_note), jsonb_build_object('hop', 'CONVERSATION', 'state', conversation_state, 'basis', conversation_basis, 'note', conversation_note), jsonb_build_object('hop', 'VEHICLE', 'state', vehicle_state, 'basis', vehicle_basis, 'note', vehicle_note), jsonb_build_object('hop', 'DEAL_RECORD', 'state', deal_record_state, 'basis', deal_record_basis, 'note', deal_record_note), jsonb_build_object('hop', 'FINANCE', 'state', finance_state, 'basis', finance_basis, 'note', finance_note), jsonb_build_object('hop', 'REVENUE', 'state', revenue_state, 'basis', revenue_basis, 'note', revenue_note), jsonb_build_object('hop', 'MARGIN', 'state', margin_state, 'basis', 'NO_LINK_FIELD', 'note', margin_note)) AS chain
   FROM walk w;

CREATE OR REPLACE VIEW public.v_inventory_action_queue WITH (security_invoker=true) AS
 SELECT a.id,
    a.tenant_id,
    a.unit_id,
    i.model AS unit_model,
    i.vin AS unit_vin,
    i.status AS unit_status,
    i.price_aed AS unit_price_aed,
    i.cost_aed AS unit_cost_aed,
    a.status,
    a.status = ANY (ARRAY['PROPOSED'::text, 'APPROVED'::text, 'DEFERRED'::text]) AS is_live,
    a.status = 'PROPOSED'::text AS awaiting_decision,
    a.status = 'DEFERRED'::text AND a.defer_until IS NOT NULL AND a.defer_until <= CURRENT_DATE AS deferral_now_due,
    a.recommendation,
    a.engine_reason,
    a.engine_confidence,
    a.engine_confidence_basis,
    a.engine_impact_aed,
    a.engine_impact_kind,
    a.engine_impact_basis,
    a.engine_overall_risk,
    a.engine_days_in_stock,
    a.engine_gross_margin_aed,
    a.engine_owner_role,
    a.engine_evidence,
    a.engine_computed_at,
    s.recommendation AS engine_now_recommendation,
    s.overall_risk AS engine_now_risk,
    s.days_in_stock AS engine_now_days_in_stock,
    s.impact_aed AS engine_now_impact_aed,
    s.reason AS engine_now_reason,
        CASE
            WHEN s.recommendation IS NULL THEN NULL::boolean
            ELSE s.recommendation = a.recommendation
        END AS engine_still_agrees,
    a.proposed_at,
    pu.name AS proposed_by_name,
    a.proposed_source,
    a.decided_at,
    du.name AS decided_by_name,
    du.role AS decided_by_job_title,
    a.decided_by_authority,
    a.decision_reason_code,
    rc.label AS decision_reason_label,
    rc.meaning AS decision_reason_meaning,
    rc.engine_was_wrong AS decision_says_engine_was_wrong,
    a.decision_note,
    a.defer_until,
    a.assigned_to_staff_id,
    au.name AS assigned_to_name,
    a.assigned_role,
    a.assigned_at,
    a.executed_at,
    eu.name AS executed_by_name,
    a.execution_note,
    a.execution_failure,
    a.escalated_at,
    a.escalation_reason,
    a.outcome_state,
    a.outcome_purchase_id,
    ph.vehicle AS outcome_sale_vehicle,
    ph.amount_aed AS outcome_sale_amount_aed,
    ph.purchase_date AS outcome_sale_date,
    a.outcome_recorded_at,
    ou.name AS outcome_recorded_by_name,
    a.attribution_basis,
    a.attribution_note,
    a.recovered_value_aed,
    a.recovered_value_basis,
        CASE a.outcome_state
            WHEN 'NONE_YET'::text THEN
            CASE
                WHEN a.status = 'PROPOSED'::text THEN 'No outcome, because nothing has been done yet. This is still waiting for a decision.'::text
                WHEN a.status = 'APPROVED'::text THEN 'No outcome yet. This has been approved but not carried out, and an approval is a decision, not money.'::text
                WHEN a.status = 'DEFERRED'::text THEN 'No outcome, because the decision was to wait.'::text
                ELSE 'No outcome recorded.'::text
            END
            WHEN 'AWAITING_OUTCOME'::text THEN ((('Carried out on '::text || to_char((a.executed_at AT TIME ZONE 'Asia/Dubai'::text), 'DD Mon YYYY'::text)) || '. Nothing has been attributed to it yet. NEXUS will not claim a recovery until a real '::text) || 'recorded sale is tied to this unit by a person, and today no column anywhere links a '::text) || 'sale to a unit - purchase_history stores the vehicle as free text.'::text
            WHEN 'ATTRIBUTED'::text THEN (('Attributed to a recorded sale by '::text || COALESCE(ou.name, 'an approver'::text)) || '. '::text) || COALESCE(a.recovered_value_basis, 'Realised margin is not computable: the sale amount or the unit cost is missing, '::text || 'so no figure is shown rather than a zero.'::text)
            WHEN 'NOT_ATTRIBUTABLE'::text THEN 'Closed with no attributable outcome. '::text || COALESCE(a.attribution_note, ''::text)
            WHEN 'CLOSED_WITHOUT_ACTION'::text THEN
            CASE
                WHEN a.status = 'REJECTED'::text THEN 'No outcome to measure: the recommendation was rejected, which is itself the useful result.'::text
                WHEN a.status = 'EXECUTION_FAILED'::text THEN 'No outcome: the action was attempted and not carried out.'::text
                ELSE 'No outcome to measure: the action was withdrawn before it was carried out.'::text
            END
            ELSE NULL::text
        END AS outcome_sentence,
        CASE
            WHEN a.status <> 'PROPOSED'::text THEN NULL::text
            WHEN a.engine_impact_aed IS NULL THEN 'The engine claims no monetary impact for this unit, so nothing is stated about the cost of waiting.'::text
            ELSE (((('AED '::text || to_char(a.engine_impact_aed, 'FM999,999,999'::text)) || ' of gross margin stays exposed in a unit that has been on the lot '::text) || COALESCE(a.engine_days_in_stock::text, 'an unknown number of'::text)) || ' days. That is the amount AT RISK, not an expected loss and not a recoverable sum. '::text) || 'How fast it is being eaten is NOT COMPUTABLE - this dealership has no holding rate on record.'::text
        END AS cost_of_doing_nothing,
    CURRENT_DATE - a.proposed_at::date AS days_open,
    a.created_at,
    a.updated_at
   FROM inventory_actions a
     LEFT JOIN inventory i ON i.tenant_id = a.tenant_id AND i.id = a.unit_id
     LEFT JOIN v_inventory_profit_sentinel s ON s.tenant_id = a.tenant_id AND s.id = a.unit_id
     LEFT JOIN users pu ON pu.id = a.proposed_by_staff_id
     LEFT JOIN users du ON du.id = a.decided_by_staff_id
     LEFT JOIN users au ON au.id = a.assigned_to_staff_id
     LEFT JOIN users eu ON eu.id = a.executed_by_staff_id
     LEFT JOIN users ou ON ou.id = a.outcome_recorded_by_staff_id
     LEFT JOIN purchase_history ph ON ph.id = a.outcome_purchase_id
     LEFT JOIN inventory_action_reason_codes rc ON rc.code = a.decision_reason_code;

CREATE OR REPLACE VIEW public.v_lead_recovery WITH (security_invoker=true) AS
 WITH cfg AS (
         SELECT t.id AS tenant_id,
            COALESCE(s_1.sla_first_response_minutes, 5) AS sla_minutes,
            COALESCE(s_1.silence_hours, 12) AS silence_hours,
            COALESCE(s_1.stale_silence_hours, 72) AS stale_hours,
            COALESCE(s_1.engagement_window_days, 14) AS engage_days,
            COALESCE(s_1.detector_max_age_hours, 26) AS detector_max_age_hours,
            s_1.tenant_id IS NULL AS settings_are_defaults
           FROM tenants t
             LEFT JOIN lead_recovery_settings s_1 ON s_1.tenant_id = t.id
        ), det AS (
         SELECT c.tenant_id,
            ( SELECT max(l.logged_at) AS max
                   FROM audit_log l
                     JOIN workflow_registry r ON l.workflow = r.name OR l.workflow = r.audit_name OR (l.workflow = ANY (r.audit_aliases))
                  WHERE l.tenant_id = c.tenant_id AND r.name ~~* '%silence detector%'::text) AS last_run_at,
            ( SELECT max(l.logged_at) AS max
                   FROM audit_log l
                     JOIN workflow_registry r ON l.workflow = r.name OR l.workflow = r.audit_name OR (l.workflow = ANY (r.audit_aliases))
                  WHERE l.tenant_id = c.tenant_id AND r.name ~~* '%silence detector%'::text AND nexus_outcome_class(l.workflow, l.status, l.summary) = 'SUCCESS'::text) AS last_success_at,
            ( SELECT nexus_outcome_class(l.workflow, l.status, l.summary) AS nexus_outcome_class
                   FROM audit_log l
                     JOIN workflow_registry r ON l.workflow = r.name OR l.workflow = r.audit_name OR (l.workflow = ANY (r.audit_aliases))
                  WHERE l.tenant_id = c.tenant_id AND r.name ~~* '%silence detector%'::text
                  ORDER BY l.logged_at DESC
                 LIMIT 1) AS last_run_class
           FROM cfg c
        ), msg AS (
         SELECT v.lead_id,
            count(*) FILTER (WHERE v.is_message) AS msgs,
            count(*) FILTER (WHERE v.is_message AND lower(btrim(v.direction)) = 'inbound'::text) AS msgs_in,
            count(*) FILTER (WHERE v.is_message AND lower(btrim(v.direction)) = 'outbound'::text) AS msgs_out,
            min(v.created_at) FILTER (WHERE v.is_message) AS first_msg_at,
            max(v.created_at) FILTER (WHERE v.is_message) AS last_msg_at,
            max(v.created_at) FILTER (WHERE v.is_message AND lower(btrim(v.direction)) = 'inbound'::text) AS last_in_at,
            max(v.created_at) FILTER (WHERE v.is_message AND lower(btrim(v.direction)) = 'outbound'::text) AS last_out_at,
            count(*) FILTER (WHERE NOT v.is_message AND v.message ~~ '[SILENCE-%'::text) AS silence_markers,
            max(v.created_at) FILTER (WHERE NOT v.is_message AND v.message ~~ '[SILENCE-%'::text) AS last_marker_at
           FROM v_lead_messages v
          GROUP BY v.lead_id
        ), sale AS (
         SELECT p.tenant_id,
            p.lead_id,
            count(*) AS sale_n,
            sum(p.amount_aed) AS sale_amt,
            count(*) FILTER (WHERE p.amount_aed IS NULL) AS sale_n_no_amount,
            max(p.purchase_date) AS last_sale_date,
            min(p.created_at) AS first_sale_recorded_at
           FROM purchase_history p
          WHERE p.lead_id IS NOT NULL
          GROUP BY p.tenant_id, p.lead_id
        ), act AS (
         SELECT DISTINCT ON (a.tenant_id, a.lead_id) a.tenant_id,
            a.lead_id,
            a.id AS action_id,
            a.status AS action_status,
            a.recommendation AS action_recommendation,
            a.outcome_state,
            a.recovered_value_aed,
            a.outcome_purchase_id,
            a.attribution_basis,
            a.executed_at,
            a.decided_at,
            a.proposed_at
           FROM lead_recovery_actions a
          ORDER BY a.tenant_id, a.lead_id, (a.status = ANY (ARRAY['PROPOSED'::text, 'APPROVED'::text, 'DEFERRED'::text])) DESC, a.proposed_at DESC
        ), base AS (
         SELECT l.tenant_id,
            l.id AS lead_id,
            l.name AS lead_name,
            l.status AS lead_status,
            l.created_at,
            l.escalated_at,
            l.assigned_to_id,
            l.response_time_minutes,
            nexus_lead_is_open(l.status) AS lead_is_open,
            NULLIF(btrim(COALESCE(l.vehicle_interest, ''::text)), ''::text) AS vehicle_text,
            u.name AS owner_name,
            u.role AS owner_job_title,
            c.sla_minutes,
            c.silence_hours,
            c.stale_hours,
            c.engage_days,
            c.detector_max_age_hours,
            c.settings_are_defaults,
            d.last_run_at AS detector_last_run_at,
            d.last_success_at AS detector_last_success_at,
            d.last_run_class AS detector_last_run_class,
                CASE
                    WHEN d.last_success_at IS NULL THEN 'NEVER_SUCCEEDED'::text
                    WHEN d.last_success_at < (now() - make_interval(hours => c.detector_max_age_hours)) THEN 'STALE'::text
                    ELSE 'CURRENT'::text
                END AS detector_state,
            COALESCE(m.msgs, 0::bigint) AS msgs,
            COALESCE(m.msgs_in, 0::bigint) AS msgs_in,
            COALESCE(m.msgs_out, 0::bigint) AS msgs_out,
            m.first_msg_at,
            m.last_msg_at,
            m.last_in_at,
            m.last_out_at,
            COALESCE(m.silence_markers, 0::bigint) AS silence_markers,
            m.last_marker_at,
            COALESCE(s_1.sale_n, 0::bigint) AS sale_n,
            s_1.sale_amt,
            COALESCE(s_1.sale_n_no_amount, 0::bigint) AS sale_n_no_amount,
            s_1.last_sale_date,
            s_1.first_sale_recorded_at,
            a.action_id,
            a.action_status,
            a.action_recommendation,
            a.outcome_state,
            a.recovered_value_aed,
            a.outcome_purchase_id,
            a.attribution_basis,
            a.executed_at,
                CASE
                    WHEN m.last_out_at IS NULL THEN NULL::numeric
                    ELSE round(EXTRACT(epoch FROM now() - m.last_out_at) / 3600.0, 2)
                END AS hours_since_our_last_message,
                CASE
                    WHEN m.last_in_at IS NULL THEN NULL::numeric
                    ELSE round(EXTRACT(epoch FROM now() - m.last_in_at) / 60.0, 1)
                END AS minutes_since_their_last_message
           FROM leads l
             JOIN cfg c ON c.tenant_id = l.tenant_id
             LEFT JOIN det d ON d.tenant_id = l.tenant_id
             LEFT JOIN msg m ON m.lead_id = l.id
             LEFT JOIN sale s_1 ON s_1.tenant_id = l.tenant_id AND s_1.lead_id = l.id
             LEFT JOIN act a ON a.tenant_id = l.tenant_id AND a.lead_id = l.id
             LEFT JOIN users u ON u.id = l.assigned_to_id AND u.tenant_id = l.tenant_id
        ), classified AS (
         SELECT b.tenant_id,
            b.lead_id,
            b.lead_name,
            b.lead_status,
            b.created_at,
            b.escalated_at,
            b.assigned_to_id,
            b.response_time_minutes,
            b.lead_is_open,
            b.vehicle_text,
            b.owner_name,
            b.owner_job_title,
            b.sla_minutes,
            b.silence_hours,
            b.stale_hours,
            b.engage_days,
            b.detector_max_age_hours,
            b.settings_are_defaults,
            b.detector_last_run_at,
            b.detector_last_success_at,
            b.detector_last_run_class,
            b.detector_state,
            b.msgs,
            b.msgs_in,
            b.msgs_out,
            b.first_msg_at,
            b.last_msg_at,
            b.last_in_at,
            b.last_out_at,
            b.silence_markers,
            b.last_marker_at,
            b.sale_n,
            b.sale_amt,
            b.sale_n_no_amount,
            b.last_sale_date,
            b.first_sale_recorded_at,
            b.action_id,
            b.action_status,
            b.action_recommendation,
            b.outcome_state,
            b.recovered_value_aed,
            b.outcome_purchase_id,
            b.attribution_basis,
            b.executed_at,
            b.hours_since_our_last_message,
            b.minutes_since_their_last_message,
            lead_recovery_state(b.sale_n, b.lead_is_open, b.msgs, b.escalated_at, b.last_msg_at, b.last_in_at, b.last_out_at, b.hours_since_our_last_message, b.silence_hours) AS state
           FROM base b
        ), scored AS (
         SELECT c.tenant_id,
            c.lead_id,
            c.lead_name,
            c.lead_status,
            c.created_at,
            c.escalated_at,
            c.assigned_to_id,
            c.response_time_minutes,
            c.lead_is_open,
            c.vehicle_text,
            c.owner_name,
            c.owner_job_title,
            c.sla_minutes,
            c.silence_hours,
            c.stale_hours,
            c.engage_days,
            c.detector_max_age_hours,
            c.settings_are_defaults,
            c.detector_last_run_at,
            c.detector_last_success_at,
            c.detector_last_run_class,
            c.detector_state,
            c.msgs,
            c.msgs_in,
            c.msgs_out,
            c.first_msg_at,
            c.last_msg_at,
            c.last_in_at,
            c.last_out_at,
            c.silence_markers,
            c.last_marker_at,
            c.sale_n,
            c.sale_amt,
            c.sale_n_no_amount,
            c.last_sale_date,
            c.first_sale_recorded_at,
            c.action_id,
            c.action_status,
            c.action_recommendation,
            c.outcome_state,
            c.recovered_value_aed,
            c.outcome_purchase_id,
            c.attribution_basis,
            c.executed_at,
            c.hours_since_our_last_message,
            c.minutes_since_their_last_message,
            c.state,
            lead_recovery_risk(c.state, c.minutes_since_their_last_message, c.hours_since_our_last_message, c.sla_minutes, c.stale_hours) AS risk_level
           FROM classified c
        )
 SELECT tenant_id,
    lead_id,
    lead_name,
    lead_status,
    lead_is_open,
    created_at AS lead_created_at,
    vehicle_text AS vehicle_interest_text,
        CASE
            WHEN vehicle_text IS NULL THEN 'UNKNOWN_NOT_RECORDED'::text
            ELSE 'UNKNOWN_TEXT_ONLY'::text
        END AS vehicle_state,
        CASE
            WHEN vehicle_text IS NULL THEN 'UNKNOWN. No vehicle interest is recorded on this lead.'::text
            ELSE 'UNKNOWN. leads.vehicle_interest is free text and no column links a lead to a unit, '::text || 'so NEXUS cannot say which car on the lot this is about. The text is shown as a prompt for a person.'::text
        END AS vehicle_note,
    state,
        CASE state
            WHEN 'RECOVERED'::text THEN 'A sale is recorded against this lead in purchase_history. That is a confirmed business outcome, not an estimate.'::text
            WHEN 'CLOSED_NO_OUTCOME'::text THEN ('leads.status is '::text || COALESCE(lead_status, '(blank)'::text)) || ', which nexus_lead_is_open treats as closed, and no sale is recorded. Nothing is leaking because nothing is open.'::text
            WHEN 'NEW_RISK'::text THEN 'No message resolves to this lead under the INV-002 identity rule. NEXUS knows a lead exists and nothing else about the conversation.'::text
            WHEN 'ESCALATED'::text THEN 'leads.escalated_at is set and nothing has been said since. The lead was handed to a person and the handover has not moved.'::text
            WHEN 'WAITING_RESPONSE'::text THEN 'The customer sent the last message. The dealership has not replied.'::text
            WHEN 'SILENT'::text THEN ('The dealership sent the last message and the customer has not answered for at least '::text || silence_hours) || ' hours.'::text
            WHEN 'ENGAGED'::text THEN ('Both sides have spoken and the dealership spoke last, within the '::text || silence_hours) || '-hour silence threshold.'::text
            ELSE 'No branch matched. This should be unreachable.'::text
        END AS state_basis,
    response_time_minutes,
        CASE
            WHEN response_time_minutes IS NULL THEN 'UNKNOWN_NOT_MEASURED'::text
            ELSE 'MEASURED'::text
        END AS response_time_state,
    sla_minutes AS sla_first_response_minutes,
        CASE
            WHEN response_time_minutes IS NULL THEN 'UNKNOWN'::text
            WHEN response_time_minutes <= sla_minutes THEN 'WITHIN_SLA'::text
            ELSE 'BREACHED_SLA'::text
        END AS sla_state,
        CASE
            WHEN response_time_minutes IS NULL THEN 'UNKNOWN: nobody measured a first response for this lead. INV-003 - a blank means unmeasured, not unanswered.'::text
            ELSE NULL::text
        END AS response_time_note,
    last_msg_at AS last_contact_at,
        CASE
            WHEN last_msg_at IS NULL THEN 'UNKNOWN_NO_RESOLVED_MESSAGE'::text
            ELSE 'FROM_RESOLVED_MESSAGE'::text
        END AS last_contact_state,
    last_in_at AS last_customer_message_at,
    last_out_at AS last_dealership_message_at,
    msgs AS messages_resolved,
    msgs_in AS messages_in,
    msgs_out AS messages_out,
    first_msg_at AS first_message_at,
    hours_since_our_last_message,
    minutes_since_their_last_message,
        CASE
            WHEN msgs = 0 THEN 'UNKNOWN_NO_MESSAGES'::text
            WHEN last_in_at IS NOT NULL AND (last_out_at IS NULL OR last_in_at > last_out_at) THEN 'CUSTOMER_SPOKE_LAST'::text
            WHEN hours_since_our_last_message >= stale_hours::numeric THEN 'SILENT_PAST_STALE_THRESHOLD'::text
            WHEN hours_since_our_last_message >= silence_hours::numeric THEN 'SILENT_PAST_THRESHOLD'::text
            ELSE 'IN_CONVERSATION'::text
        END AS silence_state,
    silence_hours AS silence_threshold_hours,
    stale_hours AS stale_silence_threshold_hours,
    silence_markers AS silence_markers_on_file,
    last_marker_at AS last_silence_marker_at,
    detector_state AS silence_detector_state,
    detector_last_run_at AS silence_detector_last_run_at,
    detector_last_success_at AS silence_detector_last_success_at,
    detector_last_run_class AS silence_detector_last_run_class,
        CASE detector_state
            WHEN 'CURRENT'::text THEN NULL::text
            WHEN 'STALE'::text THEN ((('The 12-Hour Silence Detector has not succeeded since '::text || to_char((detector_last_success_at AT TIME ZONE 'Asia/Dubai'::text), 'DD Mon YYYY HH24:MI'::text)) || ' GST, so the ABSENCE of a silence marker on this lead is not evidence that nobody went quiet. '::text) || 'The silence state above is computed from message timestamps, which is why it is still stated; '::text) || 'the marker count is not.'::text
            ELSE 'The 12-Hour Silence Detector has never recorded a successful run for this dealership. '::text || 'No marker count on any lead means anything.'::text
        END AS silence_detector_note,
    risk_level,
        CASE risk_level
            WHEN 'NONE'::text THEN 'Nothing is leaking: the lead is either closed or converted.'::text
            WHEN 'UNKNOWN'::text THEN 'Risk cannot be stated. No message resolves to this lead, so the conversation is invisible to NEXUS. INV-007 - a missing row is not proof nothing happened.'::text
            WHEN 'HIGH'::text THEN
            CASE state
                WHEN 'ESCALATED'::text THEN 'Escalated to a person and nothing has moved since.'::text
                WHEN 'WAITING_RESPONSE'::text THEN ((('The customer has been waiting '::text || minutes_since_their_last_message) || ' minutes against a '::text) || sla_minutes) || '-minute rule.'::text
                ELSE ((('Silent for '::text || hours_since_our_last_message) || ' hours, past the '::text) || stale_hours) || '-hour stale threshold.'::text
            END
            WHEN 'MEDIUM'::text THEN
            CASE state
                WHEN 'WAITING_RESPONSE'::text THEN ((('The customer spoke last, '::text || minutes_since_their_last_message) || ' minutes ago, still inside the '::text) || sla_minutes) || '-minute rule.'::text
                ELSE ((((('Silent for '::text || hours_since_our_last_message) || ' hours, past '::text) || silence_hours) || ' but not past '::text) || stale_hours) || '.'::text
            END
            ELSE 'Two-way conversation inside the silence threshold.'::text
        END AS risk_basis,
    lead_recovery_recommended_action(state, risk_level, assigned_to_id IS NOT NULL) AS recommended_action,
        CASE
            WHEN risk_level = 'NONE'::text THEN 'Nothing to do.'::text
            WHEN risk_level = 'UNKNOWN'::text THEN 'A person has to look, because NEXUS cannot see this conversation.'::text
            WHEN state = 'ESCALATED'::text THEN 'An escalation is already open on this lead. Raising a second action would compete with it.'::text
            WHEN assigned_to_id IS NULL AND (risk_level = ANY (ARRAY['HIGH'::text, 'MEDIUM'::text])) THEN 'Nobody owns this lead. Chasing it before it has an owner produces an action with no one to do it.'::text
            WHEN risk_level = 'HIGH'::text THEN 'Past the threshold this dealership is being held to. A reply from the assigned rep is no longer enough.'::text
            ELSE 'Inside the threshold. A follow-up from the owner is the proportionate action.'::text
        END AS action_reason,
    assigned_to_id AS owner_staff_id,
    owner_name,
    owner_job_title,
        CASE
            WHEN assigned_to_id IS NULL THEN 'UNASSIGNED'::text
            ELSE 'ASSIGNED'::text
        END AS owner_state,
        CASE
            WHEN assigned_to_id IS NULL THEN 'UNKNOWN. leads.assigned_to_id is null, so no person owns this lead. NEXUS holds no verified role directory for this dealership and will not guess one.'::text
            ELSE NULL::text
        END AS owner_note,
    action_id,
    action_status,
    action_recommendation,
        CASE
            WHEN action_id IS NULL THEN 'NONE_PROPOSED'::text
            ELSE action_status
        END AS action_state,
    NULL::integer AS opportunity_value_aed,
    'UNKNOWN_NO_LINK'::text AS opportunity_value_state,
    'UNKNOWN. leads.budget_aed is null on every lead on file and nothing links a lead to a unit, so this engine cannot size what is at stake. It reports risk, not value. A figure here would be invented.'::text AS opportunity_value_basis,
        CASE
            WHEN sale_n = 0 THEN 'NO_SALE_RECORDED'::text
            WHEN sale_n_no_amount > 0 THEN 'CONFIRMED_SALE_AMOUNT_INCOMPLETE'::text
            ELSE 'CONFIRMED_SALE'::text
        END AS confirmed_outcome_state,
        CASE
            WHEN sale_n > 0 THEN sale_amt
            ELSE NULL::bigint
        END AS confirmed_revenue_aed,
    last_sale_date AS confirmed_outcome_date,
        CASE
            WHEN sale_n > 0 THEN ((sale_n || ' sale row(s) in purchase_history carry lead_id = '::text) || lead_id) || '. CONFIRMED revenue - a recorded business outcome, not an estimate and not attribution.'::text
            ELSE 'No row in purchase_history names this lead. That is not proof no sale happened; it is proof none was recorded here.'::text
        END AS confirmed_outcome_basis,
        CASE
            WHEN action_id IS NULL AND sale_n > 0 THEN 'SALE_WITHOUT_RECOVERY_ACTION'::text
            WHEN action_id IS NULL THEN 'NO_RECOVERY_ACTION'::text
            WHEN outcome_state = 'ATTRIBUTED'::text THEN 'ATTRIBUTED'::text
            WHEN outcome_state = 'NOT_ATTRIBUTABLE'::text THEN 'NOT_ATTRIBUTABLE'::text
            WHEN sale_n > 0 AND executed_at IS NOT NULL THEN 'SALE_EXISTS_NOT_YET_ATTRIBUTED'::text
            ELSE 'NO_CONFIRMED_OUTCOME'::text
        END AS recovery_attribution_state,
    recovered_value_aed,
        CASE
            WHEN action_id IS NULL AND sale_n > 0 THEN 'This lead converted and NEXUS recovered nothing: no recovery action was ever raised against it. '::text || 'The sale is the dealership''s, not the product''s.'::text
            ELSE attribution_basis
        END AS recovery_attribution_basis,
        CASE
            WHEN state = ANY (ARRAY['RECOVERED'::text, 'CLOSED_NO_OUTCOME'::text]) THEN 'HIGH'::text
            WHEN msgs = 0 THEN 'LOW'::text
            WHEN detector_state = 'CURRENT'::text AND response_time_minutes IS NOT NULL THEN 'HIGH'::text
            ELSE 'MEDIUM'::text
        END AS confidence,
        CASE
            WHEN state = 'RECOVERED'::text THEN 'A purchase_history row is a fact somebody entered, not an inference.'::text
            WHEN state = 'CLOSED_NO_OUTCOME'::text THEN 'leads.status was set by a person and read through nexus_lead_is_open.'::text
            WHEN msgs = 0 THEN 'Derived from the lead row alone. No conversation resolves to this person.'::text
            WHEN detector_state <> 'CURRENT'::text AND response_time_minutes IS NULL THEN ('Message timestamps are solid; the silence detector is '::text || lower(detector_state)) || ' and no first response was ever measured.'::text
            WHEN detector_state <> 'CURRENT'::text THEN ('Message timestamps are solid; the silence detector is '::text || lower(detector_state)) || '.'::text
            WHEN response_time_minutes IS NULL THEN 'Message timestamps are solid; no first response was ever measured for this lead.'::text
            ELSE 'Message timestamps, a measured first response and a current silence detector all agree.'::text
        END AS confidence_basis,
    true AS human_approval_required,
    'NO_AUTOMATED_EXECUTOR'::text AS automation_state,
    'No NEXUS workflow executes a lead recovery action. FOLLOW_UP and ESCALATE mean a person acts - the dashboard''s WhatsApp Send is human-initiated. NEXUS records that they acted; it does not act.'::text AS automation_note,
    jsonb_build_object('lead_status', lead_status, 'lead_is_open', lead_is_open, 'messages_resolved', msgs, 'messages_in', msgs_in, 'messages_out', msgs_out, 'first_message_at', first_msg_at, 'last_message_at', last_msg_at, 'last_customer_message_at', last_in_at, 'last_dealership_message_at', last_out_at, 'silence_markers_on_file', silence_markers, 'last_silence_marker_at', last_marker_at, 'silence_markers_are_not_messages', 'INV-004: [SILENCE-ESCALATED] rows are excluded from every count and from last_contact_at', 'silence_detector_state', detector_state, 'silence_detector_last_success_at', detector_last_success_at, 'response_time_minutes', response_time_minutes, 'escalated_at', escalated_at, 'owner_staff_id', assigned_to_id, 'sales_recorded', sale_n, 'confirmed_revenue_aed',
        CASE
            WHEN sale_n > 0 THEN sale_amt
            ELSE NULL::bigint
        END, 'thresholds', jsonb_build_object('sla_first_response_minutes', sla_minutes, 'silence_hours', silence_hours, 'stale_silence_hours', stale_hours, 'detector_max_age_hours', detector_max_age_hours, 'are_defaults', settings_are_defaults)) AS evidence,
    settings_are_defaults,
    now() AS computed_at
   FROM scored s;

CREATE OR REPLACE VIEW public.v_needs_attention WITH (security_invoker=true) AS
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

CREATE OR REPLACE VIEW public.v_policy_authoritative WITH (security_invoker=true) AS
 SELECT id,
    tenant_id,
    is_global_rule,
    jurisdiction,
    rule_type,
    rule_name,
    version,
    value_numeric,
    value_text,
    unit,
    value_kind,
    value_display,
    effective_from,
    effective_to,
    source_name,
    source_url,
    source_document,
    verification_date,
    verified_by,
    confidence,
    (((((COALESCE(source_name, ''::text) ||
        CASE
            WHEN source_document IS NOT NULL THEN ', '::text || source_document
            ELSE ''::text
        END) ||
        CASE
            WHEN source_url IS NOT NULL THEN (' ('::text || source_url) || ')'::text
            ELSE ''::text
        END) || ', verified '::text) || to_char(verification_date::timestamp with time zone, 'DD Mon YYYY'::text)) || ' by '::text) || verified_by AS citation
   FROM v_policy_rule
  WHERE authority = 'AUTHORITATIVE'::text;

CREATE OR REPLACE VIEW public.v_attribution_link_map WITH (security_invoker=on) AS
 WITH vis AS (
         SELECT t.id AS tenant_id,
            t.name AS tenant_name
           FROM tenants t
        ), agg AS (
         SELECT e.tenant_id,
            e.edge,
            count(*)::integer AS instances_total,
            count(*) FILTER (WHERE b_1.is_evidence)::integer AS instances_evidenced,
            count(*) FILTER (WHERE NOT b_1.is_evidence)::integer AS instances_refused
           FROM v_attribution_edges e
             JOIN attribution_link_basis b_1 USING (basis)
          GROUP BY e.tenant_id, e.edge
        )
 SELECT v.tenant_id,
    v.tenant_name,
    et.seq,
    et.edge,
    et.from_node,
    et.to_node,
    et.state,
    et.basis,
    b.is_evidence AS basis_is_evidence,
    b.default_confidence AS basis_confidence,
    et.source_ref,
    et.finding,
    et.unlocked_by,
    et.unlock_rank,
    COALESCE(a.instances_total, 0) AS instances_total,
    COALESCE(a.instances_evidenced, 0) AS instances_evidenced,
    COALESCE(a.instances_refused, 0) AS instances_refused,
        CASE
            WHEN COALESCE(a.instances_total, 0) = 0 THEN NULL::numeric
            ELSE round(a.instances_evidenced::numeric * 100::numeric / a.instances_total::numeric, 1)
        END AS coverage_pct,
        CASE
            WHEN a.edge IS NULL AND (et.state = ANY (ARRAY['ABSENT_NO_TABLE'::text, 'ABSENT_NO_FIELD'::text, 'BLOCKED_BY_UPSTREAM'::text])) THEN ('No instances, and none can exist: '::text || lower(et.state)) || '. Coverage is UNKNOWN, not 0%.'::text
            WHEN a.edge IS NULL THEN ('This hop is not instantiated row-by-row by v_attribution_edges - either nothing has '::text || 'happened yet, or the candidate set would be every record against every unit and is '::text) || 'reported in aggregate instead. Coverage is UNKNOWN, not 0%.'::text
            WHEN a.instances_evidenced = 0 THEN a.instances_total || ' candidate(s) exist and NOT ONE is evidence. Everything on this hop is a refusal.'::text
            WHEN a.instances_refused = 0 THEN ('All '::text || a.instances_total) || ' instances are evidenced.'::text
            ELSE ((((a.instances_evidenced || ' of '::text) || a.instances_total) || ' instances are evidence; the other '::text) || a.instances_refused) || ' are refusals and must render as UNKNOWN.'::text
        END AS coverage_note
   FROM vis v
     CROSS JOIN attribution_edge_type et
     JOIN attribution_link_basis b ON b.basis = et.basis
     LEFT JOIN agg a ON a.tenant_id = v.tenant_id AND a.edge = et.edge;

CREATE OR REPLACE VIEW public.v_deal_rescue WITH (security_invoker=true) AS
 WITH cfg AS (
         SELECT t.id AS tenant_id,
            COALESCE(s.at_risk_days, 3) AS at_risk_days,
            COALESCE(s.stalled_days, 7) AS stalled_days,
            s.tenant_id IS NULL AS settings_are_defaults
           FROM tenants t
             LEFT JOIN deal_rescue_settings s ON s.tenant_id = t.id
        ), cand AS (
         SELECT v_deal_rescue_candidates.tenant_id,
            v_deal_rescue_candidates.candidate_kind,
            v_deal_rescue_candidates.candidate_ref,
            v_deal_rescue_candidates.customer_label,
            v_deal_rescue_candidates.source_table,
            v_deal_rescue_candidates.observed_at,
            v_deal_rescue_candidates.lead_id,
            v_deal_rescue_candidates.identity_state,
            v_deal_rescue_candidates.identity_basis,
            v_deal_rescue_candidates.verdict,
            v_deal_rescue_candidates.evidence_tier,
            v_deal_rescue_candidates.verdict_basis,
            v_deal_rescue_candidates.deal_value_aed,
            v_deal_rescue_candidates.deal_value_state,
            v_deal_rescue_candidates.deal_value_basis
           FROM v_deal_rescue_candidates
          WHERE v_deal_rescue_candidates.verdict = 'IN_FLIGHT_DEAL'::text
        ), joined AS (
         SELECT c.tenant_id,
            c.candidate_kind,
            c.candidate_ref,
            c.customer_label,
            c.source_table,
            c.observed_at,
            c.lead_id,
            c.identity_state,
            c.identity_basis,
            c.evidence_tier,
            c.verdict_basis,
            c.deal_value_aed,
            c.deal_value_state,
            c.deal_value_basis,
            g.at_risk_days,
            g.stalled_days,
            g.settings_are_defaults,
            lr.lead_status,
            lr.lead_is_open,
            lr.silence_state,
            lr.last_contact_at,
            lr.silence_detector_state,
            lr.silence_detector_last_success_at,
            lr.owner_staff_id,
            lr.owner_name,
            lr.owner_job_title,
            lr.messages_resolved,
            lr.state AS lead_recovery_state,
            GREATEST(c.observed_at, lr.last_contact_at) AS last_movement_at
           FROM cand c
             JOIN cfg g ON g.tenant_id = c.tenant_id
             LEFT JOIN v_lead_recovery lr ON lr.tenant_id = c.tenant_id AND lr.lead_id = c.lead_id
        ), timed AS (
         SELECT j.tenant_id,
            j.candidate_kind,
            j.candidate_ref,
            j.customer_label,
            j.source_table,
            j.observed_at,
            j.lead_id,
            j.identity_state,
            j.identity_basis,
            j.evidence_tier,
            j.verdict_basis,
            j.deal_value_aed,
            j.deal_value_state,
            j.deal_value_basis,
            j.at_risk_days,
            j.stalled_days,
            j.settings_are_defaults,
            j.lead_status,
            j.lead_is_open,
            j.silence_state,
            j.last_contact_at,
            j.silence_detector_state,
            j.silence_detector_last_success_at,
            j.owner_staff_id,
            j.owner_name,
            j.owner_job_title,
            j.messages_resolved,
            j.lead_recovery_state,
            j.last_movement_at,
            round(EXTRACT(epoch FROM now() - j.last_movement_at) / 86400.0, 2) AS days_since_movement
           FROM joined j
        ), classified AS (
         SELECT t.tenant_id,
            t.candidate_kind,
            t.candidate_ref,
            t.customer_label,
            t.source_table,
            t.observed_at,
            t.lead_id,
            t.identity_state,
            t.identity_basis,
            t.evidence_tier,
            t.verdict_basis,
            t.deal_value_aed,
            t.deal_value_state,
            t.deal_value_basis,
            t.at_risk_days,
            t.stalled_days,
            t.settings_are_defaults,
            t.lead_status,
            t.lead_is_open,
            t.silence_state,
            t.last_contact_at,
            t.silence_detector_state,
            t.silence_detector_last_success_at,
            t.owner_staff_id,
            t.owner_name,
            t.owner_job_title,
            t.messages_resolved,
            t.lead_recovery_state,
            t.last_movement_at,
            t.days_since_movement,
            deal_rescue_state(t.evidence_tier, false, t.lead_is_open, t.silence_state, t.days_since_movement, t.at_risk_days, t.stalled_days) AS state
           FROM timed t
        )
 SELECT tenant_id,
    candidate_kind AS deal_evidence,
    candidate_ref AS deal_evidence_ref,
    source_table AS deal_evidence_source,
    customer_label,
    lead_id,
    identity_state,
    identity_basis,
    evidence_tier,
    verdict_basis AS admission_basis,
    observed_at AS deal_evidence_at,
    last_contact_at AS last_message_at,
    last_movement_at,
    days_since_movement,
    at_risk_days,
    stalled_days,
    settings_are_defaults,
    state,
        CASE state
            WHEN 'ON_TRACK'::text THEN ((('The latest movement on this deal is '::text || days_since_movement) || ' days old, inside the '::text) || at_risk_days) || '-day window.'::text
            WHEN 'AT_RISK'::text THEN ((((('No movement for '::text || days_since_movement) || ' days, past '::text) || at_risk_days) || ' but not yet '::text) || stalled_days) || '. INACTIVITY, not a stage: nothing in this schema records what a deal is sitting on.'::text
            WHEN 'STALLED'::text THEN ((('No movement for '::text || days_since_movement) || ' days, past the '::text) || stalled_days) || '-day threshold. Why it stalled is UNKNOWN - there is no stage history to say.'::text
            WHEN 'CUSTOMER_GHOSTED'::text THEN ('No movement for '::text || days_since_movement) || ' days and Lead Recovery grades this customer SILENT_PAST_STALE_THRESHOLD. Silence is read from v_lead_recovery, not re-derived here.'::text
            WHEN 'NEEDS_MANAGER'::text THEN 'A person has to look. Either the evidence is weak, or something transactional is live against a lead somebody closed.'::text
            ELSE 'No state can be stated: the evidence resolves to nobody, or nothing dates its last movement. Unknown is not none.'::text
        END AS state_basis,
    deal_rescue_recommended_action(state) AS recommended_action,
        CASE state
            WHEN 'ON_TRACK'::text THEN 'Nothing to do. The deal is moving.'::text
            WHEN 'AT_RISK'::text THEN 'A follow-up from whoever owns this is the proportionate action while it is still only quiet.'::text
            WHEN 'STALLED'::text THEN 'Past the threshold and NEXUS cannot say why. A manager has to find the blocker, because the data that would name it does not exist.'::text
            WHEN 'CUSTOMER_GHOSTED'::text THEN 'The customer specifically has gone quiet. Re-contact on a different channel before treating it as lost.'::text
            WHEN 'NEEDS_MANAGER'::text THEN 'NEXUS will not grade this on the evidence it has. A person decides.'::text
            ELSE 'NEXUS cannot see this. A person looks.'::text
        END AS action_reason,
    owner_staff_id,
    owner_name,
    owner_job_title,
        CASE
            WHEN owner_staff_id IS NULL THEN 'UNASSIGNED'::text
            ELSE 'ASSIGNED'::text
        END AS owner_state,
        CASE
            WHEN owner_staff_id IS NULL THEN 'UNKNOWN. No deal record exists in this schema, so ownership is borrowed from leads.assigned_to_id, and that is null here. Nobody owns this.'::text
            ELSE NULL::text
        END AS owner_note,
    deal_value_aed,
    deal_value_state,
    deal_value_basis,
    'NOT_COMPUTABLE'::text AS margin_at_stake_state,
    'NOT COMPUTABLE, which is not zero. Gross margin needs the unit''s acquisition cost, and nothing links a deal to an inventory unit in this schema.'::text AS margin_at_stake_basis,
        CASE
            WHEN evidence_tier = 'WEAK'::text THEN 'LOW'::text
            ELSE 'MEDIUM'::text
        END AS confidence,
        CASE
            WHEN evidence_tier = 'WEAK'::text THEN 'LOW. Admitted on a KYC document, and the KYC workflow audits any image sent over WhatsApp - it does not evidence a transaction.'::text
            ELSE 'MEDIUM, and capped there. The trigger is solid (a priced, dated quote), but this schema has no deal record and no stage history, so the engine is inferring a transaction rather than reading one.'::text
        END AS confidence_basis,
    lead_recovery_state,
    silence_state,
    silence_detector_state,
    silence_detector_last_success_at,
        CASE
            WHEN silence_detector_state = 'CURRENT'::text THEN NULL::text
            ELSE ('The 12-Hour Silence Detector is '::text || lower(COALESCE(silence_detector_state, 'unknown'::text))) || ', so the ABSENCE of a silence marker on this person is not evidence that nobody went quiet. Silence here is computed from message timestamps by Lead Recovery; the markers are not usable.'::text
        END AS silence_detector_note,
    true AS human_approval_required,
    'NO_AUTOMATED_EXECUTOR'::text AS automation_state,
    'No NEXUS workflow executes a deal rescue action. Every recommendation here means a person acts.'::text AS automation_note,
    'NOT_BUILT'::text AS action_lane_state,
    'Deal Rescue has no propose/decide/execute lane. It was left unbuilt deliberately: the queue is structurally empty, and an approval desk with nothing to approve is a third authority surface for no decision anybody can take. See deal_rescue_prerequisites.ACTION_LANE.'::text AS action_lane_note,
    jsonb_build_object('deal_evidence', candidate_kind, 'deal_evidence_ref', candidate_ref, 'deal_evidence_source', source_table, 'deal_evidence_at', observed_at, 'lead_id', lead_id, 'identity_state', identity_state, 'lead_status', lead_status, 'lead_is_open', lead_is_open, 'messages_resolved', messages_resolved, 'last_message_at', last_contact_at, 'last_movement_at', last_movement_at, 'days_since_movement', days_since_movement, 'silence_state_read_from', 'v_lead_recovery.silence_state', 'silence_state', silence_state, 'silence_detector_state', silence_detector_state, 'deal_record_exists', false, 'deal_stage_history_exists', false, 'appointment_exists', false, 'thresholds', jsonb_build_object('at_risk_days', at_risk_days, 'stalled_days', stalled_days, 'are_defaults', settings_are_defaults)) AS evidence,
    now() AS computed_at
   FROM classified;

CREATE OR REPLACE VIEW public.v_deal_rescue_readiness WITH (security_invoker=true) AS
 SELECT id,
    sort,
    requirement,
    kind,
    unlocks,
    unlocks_states,
    evidence_today,
    why_not_code,
        CASE id
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
        CASE id
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
   FROM deal_rescue_prerequisites p;

CREATE OR REPLACE VIEW public.v_lead_recovery_coverage WITH (security_invoker=true) AS
 WITH r AS (
         SELECT v_lead_recovery.tenant_id,
            v_lead_recovery.lead_id,
            v_lead_recovery.lead_name,
            v_lead_recovery.lead_status,
            v_lead_recovery.lead_is_open,
            v_lead_recovery.lead_created_at,
            v_lead_recovery.vehicle_interest_text,
            v_lead_recovery.vehicle_state,
            v_lead_recovery.vehicle_note,
            v_lead_recovery.state,
            v_lead_recovery.state_basis,
            v_lead_recovery.response_time_minutes,
            v_lead_recovery.response_time_state,
            v_lead_recovery.sla_first_response_minutes,
            v_lead_recovery.sla_state,
            v_lead_recovery.response_time_note,
            v_lead_recovery.last_contact_at,
            v_lead_recovery.last_contact_state,
            v_lead_recovery.last_customer_message_at,
            v_lead_recovery.last_dealership_message_at,
            v_lead_recovery.messages_resolved,
            v_lead_recovery.messages_in,
            v_lead_recovery.messages_out,
            v_lead_recovery.first_message_at,
            v_lead_recovery.hours_since_our_last_message,
            v_lead_recovery.minutes_since_their_last_message,
            v_lead_recovery.silence_state,
            v_lead_recovery.silence_threshold_hours,
            v_lead_recovery.stale_silence_threshold_hours,
            v_lead_recovery.silence_markers_on_file,
            v_lead_recovery.last_silence_marker_at,
            v_lead_recovery.silence_detector_state,
            v_lead_recovery.silence_detector_last_run_at,
            v_lead_recovery.silence_detector_last_success_at,
            v_lead_recovery.silence_detector_last_run_class,
            v_lead_recovery.silence_detector_note,
            v_lead_recovery.risk_level,
            v_lead_recovery.risk_basis,
            v_lead_recovery.recommended_action,
            v_lead_recovery.action_reason,
            v_lead_recovery.owner_staff_id,
            v_lead_recovery.owner_name,
            v_lead_recovery.owner_job_title,
            v_lead_recovery.owner_state,
            v_lead_recovery.owner_note,
            v_lead_recovery.action_id,
            v_lead_recovery.action_status,
            v_lead_recovery.action_recommendation,
            v_lead_recovery.action_state,
            v_lead_recovery.opportunity_value_aed,
            v_lead_recovery.opportunity_value_state,
            v_lead_recovery.opportunity_value_basis,
            v_lead_recovery.confirmed_outcome_state,
            v_lead_recovery.confirmed_revenue_aed,
            v_lead_recovery.confirmed_outcome_date,
            v_lead_recovery.confirmed_outcome_basis,
            v_lead_recovery.recovery_attribution_state,
            v_lead_recovery.recovered_value_aed,
            v_lead_recovery.recovery_attribution_basis,
            v_lead_recovery.confidence,
            v_lead_recovery.confidence_basis,
            v_lead_recovery.human_approval_required,
            v_lead_recovery.automation_state,
            v_lead_recovery.automation_note,
            v_lead_recovery.evidence,
            v_lead_recovery.settings_are_defaults,
            v_lead_recovery.computed_at
           FROM v_lead_recovery
        ), comm AS (
         SELECT c.tenant_id,
            count(*) AS log_rows,
            count(*) FILTER (WHERE nexus_is_message(c.direction, c.channel, c.message)) AS message_events,
            count(*) FILTER (WHERE c.message ~~ '[SILENCE-%'::text) AS silence_markers,
            count(*) FILTER (WHERE nexus_is_message(c.direction, c.channel, c.message) AND (EXISTS ( SELECT 1
                   FROM v_lead_messages v
                  WHERE v.id = c.id))) AS resolved_to_a_lead,
            count(DISTINCT c.lead_email) FILTER (WHERE nexus_is_message(c.direction, c.channel, c.message) AND NOT (EXISTS ( SELECT 1
                   FROM v_lead_messages v
                  WHERE v.id = c.id))) AS unresolved_handles
           FROM communication_logs c
          GROUP BY c.tenant_id
        ), acts AS (
         SELECT a.tenant_id,
            count(*) AS actions_total,
            count(*) FILTER (WHERE a.status = 'PROPOSED'::text) AS awaiting_decision,
            count(*) FILTER (WHERE a.status = 'EXECUTED'::text) AS executed,
            count(*) FILTER (WHERE a.outcome_state = 'ATTRIBUTED'::text) AS outcomes_attributed,
            count(*) FILTER (WHERE NOT (EXISTS ( SELECT 1
                   FROM leads l
                  WHERE l.id = a.lead_id AND l.tenant_id = a.tenant_id))) AS actions_with_wrong_tenant
           FROM lead_recovery_actions a
          GROUP BY a.tenant_id
        )
 SELECT r.tenant_id,
    count(*) AS leads_total,
    count(*) FILTER (WHERE r.lead_is_open) AS leads_open,
    count(*) FILTER (WHERE NOT r.lead_is_open) AS leads_closed,
    count(*) FILTER (WHERE r.risk_level = ANY (ARRAY['HIGH'::text, 'MEDIUM'::text])) AS leads_at_risk,
    count(*) FILTER (WHERE r.risk_level = 'UNKNOWN'::text) AS leads_risk_unknown,
    count(*) FILTER (WHERE r.recommended_action <> 'NO_ACTION'::text) AS leads_with_a_recommended_action,
    count(*) FILTER (WHERE r.confirmed_outcome_state = 'CONFIRMED_SALE'::text) AS leads_with_a_confirmed_sale,
    sum(r.confirmed_revenue_aed) AS confirmed_revenue_aed,
    count(*) FILTER (WHERE r.recovery_attribution_state = 'ATTRIBUTED'::text) AS sales_attributed_to_a_recovery_action,
    count(*) FILTER (WHERE r.owner_state = 'UNASSIGNED'::text) AS leads_with_no_owner,
    count(*) FILTER (WHERE r.response_time_state = 'UNKNOWN_NOT_MEASURED'::text) AS leads_with_no_measured_response_time,
    count(*) FILTER (WHERE r.messages_resolved = 0) AS leads_with_no_resolved_conversation,
    max(cm.log_rows) AS communication_log_rows,
    max(cm.message_events) AS message_events,
    max(cm.silence_markers) AS silence_markers,
    max(cm.resolved_to_a_lead) AS message_events_resolved_to_a_lead,
        CASE
            WHEN max(cm.message_events) > 0 THEN round(100.0 * max(cm.resolved_to_a_lead)::numeric / max(cm.message_events)::numeric, 1)
            ELSE NULL::numeric
        END AS identity_resolution_pct,
    max(cm.unresolved_handles) AS unresolved_whatsapp_handles,
    max(r.silence_detector_state) AS silence_detector_state,
    max(r.silence_detector_last_run_at) AS silence_detector_last_run_at,
    max(r.silence_detector_last_success_at) AS silence_detector_last_success_at,
    max(r.silence_detector_last_run_class) AS silence_detector_last_run_class,
    COALESCE(max(ac.actions_total), 0::bigint) AS recovery_actions_total,
    COALESCE(max(ac.awaiting_decision), 0::bigint) AS recovery_actions_awaiting_decision,
    COALESCE(max(ac.executed), 0::bigint) AS recovery_actions_executed,
    COALESCE(max(ac.outcomes_attributed), 0::bigint) AS recovery_outcomes_attributed,
    COALESCE(max(ac.actions_with_wrong_tenant), 0::bigint) AS actions_whose_lead_is_another_tenants,
    bool_and(r.settings_are_defaults) AS settings_are_defaults,
    max(r.sla_first_response_minutes) AS sla_first_response_minutes,
    max(r.sla_first_response_minutes) = 5 AND pg_get_viewdef('v_needs_attention'::regclass::oid, true) ~~ '%response_time_minutes > 5%'::text AS sla_agrees_with_needs_attention,
    ((('CANNOT SIZE: no lead carries a budget and nothing links a lead to a unit, so no opportunity value is computable - only confirmed sales. CANNOT SEE: '::text || COALESCE((max(cm.message_events) - max(cm.resolved_to_a_lead))::text, '?'::text)) || ' message events belong to WhatsApp handles that match no lead. CANNOT CONFIRM SILENCE: the detector state is '::text) || max(r.silence_detector_state)) || '. CANNOT BOOK: there is no appointment table, so APPOINTMENT_PENDING is unreachable. CANNOT EXECUTE: no workflow performs a lead recovery action; a person does.'::text AS what_this_engine_cannot_tell_you,
    now() AS computed_at
   FROM r
     LEFT JOIN comm cm ON cm.tenant_id = r.tenant_id
     LEFT JOIN acts ac ON ac.tenant_id = r.tenant_id
  GROUP BY r.tenant_id;

CREATE OR REPLACE VIEW public.v_lead_recovery_queue WITH (security_invoker=true) AS
 SELECT a.id,
    a.tenant_id,
    a.lead_id,
    l.name AS lead_name,
    l.status AS lead_status,
    a.status,
    a.status = ANY (ARRAY['PROPOSED'::text, 'APPROVED'::text, 'DEFERRED'::text]) AS is_live,
    a.status = 'PROPOSED'::text AS awaiting_decision,
    a.status = 'DEFERRED'::text AND a.defer_until IS NOT NULL AND a.defer_until <= CURRENT_DATE AS deferral_now_due,
    a.recommendation,
    a.engine_state,
    a.engine_reason,
    a.engine_confidence,
    a.engine_confidence_basis,
    a.engine_risk_level,
    a.engine_risk_basis,
    a.engine_owner_role,
    a.engine_evidence,
    a.engine_computed_at,
    e.state AS engine_now_state,
    e.risk_level AS engine_now_risk_level,
    e.recommended_action AS engine_now_recommendation,
    e.action_reason AS engine_now_reason,
    e.recommended_action = a.recommendation AS engine_still_agrees,
    a.opportunity_value_state,
    a.opportunity_value_basis,
    a.proposed_at,
    pu.name AS proposed_by_name,
    a.proposed_source,
    a.decided_at,
    du.name AS decided_by_name,
    du.role AS decided_by_job_title,
    a.decided_by_authority,
    a.decision_reason_code,
    rc.label AS decision_reason_label,
    rc.meaning AS decision_reason_meaning,
    rc.engine_was_wrong AS decision_says_engine_was_wrong,
    a.decision_note,
    a.defer_until,
    a.assigned_to_staff_id,
    au.name AS assigned_to_name,
    a.assigned_role,
    a.assigned_at,
    a.executed_at,
    xu.name AS executed_by_name,
    a.execution_note,
    a.execution_failure,
    a.escalated_at,
    a.escalation_reason,
    a.outcome_state,
    a.outcome_purchase_id,
    ph.vehicle AS outcome_sale_vehicle,
    ph.amount_aed AS outcome_sale_amount_aed,
    ph.purchase_date AS outcome_sale_date,
    a.outcome_recorded_at,
    ou.name AS outcome_recorded_by_name,
    a.attribution_basis,
    a.attribution_note,
    a.recovered_value_aed,
    a.recovered_value_basis,
        CASE a.outcome_state
            WHEN 'NONE_YET'::text THEN 'Nothing has been done yet, so there is no outcome to report.'::text
            WHEN 'AWAITING_OUTCOME'::text THEN 'Somebody carried this out. Whether it recovered anything is not yet known - and unknown is not none.'::text
            WHEN 'ATTRIBUTED'::text THEN ('A person attributed a confirmed sale of AED '::text || to_char(COALESCE(a.recovered_value_aed, 0), 'FM999,999,999'::text)) || ' to this action. Attributed, not proven caused.'::text
            WHEN 'NOT_ATTRIBUTABLE'::text THEN 'A person looked and could not tie any sale to this action. No revenue is claimed.'::text
            WHEN 'CLOSED_WITHOUT_ACTION'::text THEN 'The action was rejected or cancelled, so nothing was done and nothing is claimed.'::text
            ELSE NULL::text
        END AS outcome_sentence,
    EXTRACT(day FROM now() - a.proposed_at)::integer AS days_open,
    a.created_at,
    a.updated_at
   FROM lead_recovery_actions a
     LEFT JOIN leads l ON l.id = a.lead_id AND l.tenant_id = a.tenant_id
     LEFT JOIN v_lead_recovery e ON e.tenant_id = a.tenant_id AND e.lead_id = a.lead_id
     LEFT JOIN users pu ON pu.id = a.proposed_by_staff_id
     LEFT JOIN users du ON du.id = a.decided_by_staff_id
     LEFT JOIN users au ON au.id = a.assigned_to_staff_id
     LEFT JOIN users xu ON xu.id = a.executed_by_staff_id
     LEFT JOIN users ou ON ou.id = a.outcome_recorded_by_staff_id
     LEFT JOIN lead_recovery_reason_codes rc ON rc.code = a.decision_reason_code
     LEFT JOIN purchase_history ph ON ph.id = a.outcome_purchase_id AND ph.tenant_id = a.tenant_id;

CREATE OR REPLACE VIEW public.v_lead_recovery_state_model WITH (security_invoker=true) AS
 SELECT m.state,
    m.sort,
    m.meaning,
    m.engine_can_produce,
    m.blocked_by,
    m.requires,
    COALESCE(c.leads_in_state, 0::bigint) AS leads_in_state_now,
        CASE
            WHEN NOT m.engine_can_produce THEN 'UNREACHABLE_BY_DESIGN'::text
            WHEN COALESCE(c.leads_in_state, 0::bigint) > 0 THEN 'OBSERVED'::text
            ELSE 'REACHABLE_NOT_OBSERVED'::text
        END AS observation
   FROM lead_recovery_states m
     LEFT JOIN ( SELECT v_lead_recovery.state,
            count(*) AS leads_in_state
           FROM v_lead_recovery
          GROUP BY v_lead_recovery.state) c ON c.state = m.state
  ORDER BY m.sort;

CREATE OR REPLACE VIEW public.v_policy_unmigrated_constant WITH (security_invoker=true) AS
 SELECT layer,
    kind,
    location,
    snippet,
    current_value,
    reaches_a_customer,
    proposed_rule_type,
    proposed_rule_name,
    seeded_as_rule,
    (EXISTS ( SELECT 1
           FROM policy_rule r
          WHERE r.rule_name = u.proposed_rule_name)) AS rule_row_exists,
    (EXISTS ( SELECT 1
           FROM v_policy_authoritative a
          WHERE a.rule_name = u.proposed_rule_name)) AS rule_is_authoritative,
        CASE
            WHEN proposed_rule_name IS NULL THEN 'NO_TARGET_RULE'::text
            WHEN (EXISTS ( SELECT 1
               FROM v_policy_authoritative a
              WHERE a.rule_name = u.proposed_rule_name)) THEN 'READY_TO_MIGRATE'::text
            WHEN (EXISTS ( SELECT 1
               FROM policy_rule r
              WHERE r.rule_name = u.proposed_rule_name)) THEN 'BLOCKED_ON_VERIFICATION'::text
            ELSE 'NOT_YET_RECORDED'::text
        END AS migration_state,
    note,
    surveyed_on
   FROM policy_unmigrated_constant u
  ORDER BY reaches_a_customer DESC, layer, location;

CREATE OR REPLACE VIEW public.v_deal_rescue_state_model WITH (security_invoker=true) AS
 SELECT s.state,
    s.sort,
    s.meaning,
    s.engine_can_produce,
    s.blocked_by,
    s.requires,
    COALESCE(n.n, 0::bigint) AS deals_in_state_now,
        CASE
            WHEN NOT s.engine_can_produce THEN 'UNREACHABLE_BY_DESIGN'::text
            WHEN COALESCE(n.n, 0::bigint) > 0 THEN 'OBSERVED'::text
            WHEN (( SELECT count(*) AS count
               FROM v_deal_rescue)) = 0 THEN 'UNREACHABLE_TODAY_NO_POPULATION'::text
            ELSE 'REACHABLE_NOT_OBSERVED'::text
        END AS observation
   FROM deal_rescue_states s
     LEFT JOIN ( SELECT d.state,
            count(*) AS n
           FROM v_deal_rescue d
          GROUP BY d.state) n ON n.state = s.state;


-- ========================================================================
-- 9b. FUNCTIONS THAT RETURN OR TAKE A VIEW ROW TYPE
-- These 1 cannot be created before their views exist: sentinel_inventory_actions
-- ========================================================================
CREATE OR REPLACE FUNCTION public.sentinel_inventory_actions(p_recommendation text DEFAULT NULL::text, p_min_risk_rank integer DEFAULT NULL::integer)
 RETURNS SETOF v_inventory_profit_sentinel
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  select *
    from public.v_inventory_profit_sentinel v
   where (p_recommendation is null or v.recommendation = upper(btrim(p_recommendation)))
     -- A unit whose risk is UNKNOWN is never filtered out by a minimum-risk
     -- floor: unknown is not low. It surfaces so a person can look at it.
     and (p_min_risk_rank is null
          or v.overall_risk_rank is null
          or v.overall_risk_rank >= p_min_risk_rank)
   order by coalesce(v.overall_risk_rank, 99) desc,
            v.days_in_stock desc nulls first,
            v.gross_margin_aed desc nulls last;
$function$
;



-- ========================================================================
-- 10. TRIGGERS
-- ========================================================================
CREATE TRIGGER channel_registry_touch BEFORE UPDATE ON public.channel_registry FOR EACH ROW EXECUTE FUNCTION channel_registry_touch();
CREATE TRIGGER trg_comm_logs_first_response AFTER INSERT ON public.communication_logs FOR EACH ROW EXECUTE FUNCTION nexus_mark_first_response();
CREATE TRIGGER inventory_actions_touch BEFORE UPDATE ON public.inventory_actions FOR EACH ROW EXECUTE FUNCTION inventory_actions_touch();
CREATE TRIGGER trg_assign_hot_lead BEFORE INSERT OR UPDATE OF status, assigned_to_id ON public.leads FOR EACH ROW EXECUTE FUNCTION assign_hot_lead();
CREATE TRIGGER policy_platform_attestation_no_rewrite BEFORE DELETE OR UPDATE ON public.policy_platform_attestation FOR EACH ROW EXECUTE FUNCTION policy_platform_attestation_append_only();
CREATE TRIGGER policy_rule_derive_jurisdiction_owner BEFORE INSERT ON public.policy_rule FOR EACH ROW EXECUTE FUNCTION policy_rule_derive_jurisdiction_owner();
CREATE TRIGGER policy_rule_immutability BEFORE UPDATE ON public.policy_rule FOR EACH ROW EXECUTE FUNCTION policy_rule_guard_immutability();
CREATE TRIGGER policy_rule_one_active BEFORE INSERT OR UPDATE ON public.policy_rule FOR EACH ROW EXECUTE FUNCTION policy_rule_guard_one_active();
CREATE TRIGGER policy_rule_event_no_rewrite BEFORE DELETE OR UPDATE ON public.policy_rule_event FOR EACH ROW EXECUTE FUNCTION policy_rule_event_append_only();
CREATE TRIGGER tenant_capability_touch_t BEFORE UPDATE ON public.tenant_capability FOR EACH ROW EXECUTE FUNCTION tenant_capability_touch();
CREATE TRIGGER tenant_configuration_validate_t BEFORE INSERT OR UPDATE ON public.tenant_configuration FOR EACH ROW EXECUTE FUNCTION tenant_configuration_validate();
CREATE TRIGGER whatsapp_delivery_events_append_only BEFORE DELETE OR UPDATE ON public.whatsapp_delivery_events FOR EACH ROW EXECUTE FUNCTION whatsapp_delivery_events_append_only();
CREATE TRIGGER whatsapp_delivery_events_guard_link BEFORE INSERT OR UPDATE ON public.whatsapp_delivery_events FOR EACH ROW EXECUTE FUNCTION whatsapp_delivery_events_guard_link();
CREATE TRIGGER whatsapp_message_usage_touch BEFORE UPDATE ON public.whatsapp_message_usage FOR EACH ROW EXECUTE FUNCTION whatsapp_message_usage_touch();
CREATE TRIGGER whatsapp_opt_in_event_no_rewrite BEFORE DELETE OR UPDATE ON public.whatsapp_opt_in_event FOR EACH ROW EXECUTE FUNCTION whatsapp_opt_in_event_append_only();
CREATE TRIGGER whatsapp_templates_guard_channel BEFORE INSERT OR UPDATE ON public.whatsapp_templates FOR EACH ROW EXECUTE FUNCTION whatsapp_templates_guard_channel();
CREATE TRIGGER whatsapp_templates_touch BEFORE UPDATE ON public.whatsapp_templates FOR EACH ROW EXECUTE FUNCTION whatsapp_templates_touch();


-- ========================================================================
-- 11. EVENT TRIGGERS
-- ========================================================================
CREATE EVENT TRIGGER nexus_guard_security_invoker_views ON ddl_command_end WHEN TAG IN ('CREATE VIEW', 'ALTER VIEW', 'ALTER TABLE') EXECUTE FUNCTION public.nexus_require_security_invoker_views();


-- ========================================================================
-- 12. ROW LEVEL SECURITY
-- RLS is NOT enabled on: (nothing)
-- ========================================================================
ALTER TABLE public.attribution_edge_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attribution_event_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attribution_link_basis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_message_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_message_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.channel_provider_capability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_provider_rank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_send_directive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.channel_send_form ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_360_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_rescue_evidence_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_rescue_prerequisites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_rescue_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_rescue_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_action_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_action_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_action_reason_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_profit_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_recovery_action_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_recovery_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_recovery_reason_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_recovery_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_recovery_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_jurisdiction ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_platform_attestation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_rule_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_rule_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_unmigrated_constant ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processed_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_capability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_capability_catalogue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_configuration_default ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversation_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_customer_message_seen ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_customer_message_seen FORCE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_delivery_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_message_intent ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_message_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_opt_in_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_registry ENABLE ROW LEVEL SECURITY;


-- ========================================================================
-- 13. POLICIES
-- ========================================================================
CREATE POLICY attribution_edge_type_deny_anon ON public.attribution_edge_type AS RESTRICTIVE FOR ALL TO anon USING (false);
CREATE POLICY attribution_edge_type_read ON public.attribution_edge_type AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY attribution_edge_type_service_role_all ON public.attribution_edge_type AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY attribution_event_type_deny_anon ON public.attribution_event_type AS RESTRICTIVE FOR ALL TO anon USING (false);
CREATE POLICY attribution_event_type_read ON public.attribution_event_type AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY attribution_event_type_service_role_all ON public.attribution_event_type AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY attribution_link_basis_deny_anon ON public.attribution_link_basis AS RESTRICTIVE FOR ALL TO anon USING (false);
CREATE POLICY attribution_link_basis_read ON public.attribution_link_basis AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY attribution_link_basis_service_role_all ON public.attribution_link_basis AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY audit_log_authenticated_read ON public.audit_log AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY audit_log_deny_anon ON public.audit_log AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY audit_log_service_role_all ON public.audit_log AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY channel_message_events_deny_end_users ON public.channel_message_events AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY channel_message_events_service_role_all ON public.channel_message_events AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY channel_provider_capability_service_role ON public.channel_provider_capability AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY channel_provider_rank_service_role ON public.channel_provider_rank AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY channel_registry_authenticated_read ON public.channel_registry AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY channel_registry_deny_anon ON public.channel_registry AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY channel_registry_service_role_all ON public.channel_registry AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY channel_send_directive_service_role ON public.channel_send_directive AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY channel_send_form_service_role ON public.channel_send_form AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY communication_logs_authenticated_read ON public.communication_logs AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY communication_logs_deny_anon ON public.communication_logs AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY communication_logs_service_role_all ON public.communication_logs AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY competitors_authenticated_all ON public.competitors AS PERMISSIVE FOR ALL TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids))) WITH CHECK ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY competitors_deny_anon ON public.competitors AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY competitors_service_role_all ON public.competitors AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY customer_360_authenticated_read ON public.customer_360_profiles AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY customer_360_profiles_deny_anon ON public.customer_360_profiles AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY customer_360_service_role_all ON public.customer_360_profiles AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY daily_metrics_authenticated_read ON public.daily_metrics AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY daily_metrics_deny_anon ON public.daily_metrics AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY daily_metrics_service_role_all ON public.daily_metrics AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY deal_rescue_evidence_sources_authenticated_read ON public.deal_rescue_evidence_sources AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY deal_rescue_evidence_sources_deny_anon ON public.deal_rescue_evidence_sources AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY deal_rescue_evidence_sources_service_role_all ON public.deal_rescue_evidence_sources AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY deal_rescue_prerequisites_authenticated_read ON public.deal_rescue_prerequisites AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY deal_rescue_prerequisites_deny_anon ON public.deal_rescue_prerequisites AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY deal_rescue_prerequisites_service_role_all ON public.deal_rescue_prerequisites AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY deal_rescue_settings_authenticated_read ON public.deal_rescue_settings AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY deal_rescue_settings_deny_anon ON public.deal_rescue_settings AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY deal_rescue_settings_service_role_all ON public.deal_rescue_settings AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY deal_rescue_states_authenticated_read ON public.deal_rescue_states AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY deal_rescue_states_deny_anon ON public.deal_rescue_states AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY deal_rescue_states_service_role_all ON public.deal_rescue_states AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY deals_embeddings_authenticated_read ON public.deals_embeddings AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY deals_embeddings_deny_anon ON public.deals_embeddings AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY deals_embeddings_service_role_all ON public.deals_embeddings AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY finance_quotes_authenticated_read ON public.finance_quotes AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY finance_quotes_deny_anon ON public.finance_quotes AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY finance_quotes_service_role_all ON public.finance_quotes AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY inventory_authenticated_all ON public.inventory AS PERMISSIVE FOR ALL TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids))) WITH CHECK ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY inventory_deny_anon ON public.inventory AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY inventory_service_role_all ON public.inventory AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY inventory_action_events_authenticated_read ON public.inventory_action_events AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY inventory_action_events_deny_anon ON public.inventory_action_events AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY inventory_action_events_service_role_all ON public.inventory_action_events AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY inventory_action_policy_deny_anon ON public.inventory_action_policy AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY inventory_action_policy_read ON public.inventory_action_policy AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY inventory_action_policy_service_role_all ON public.inventory_action_policy AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY inventory_action_reason_codes_deny_anon ON public.inventory_action_reason_codes AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY inventory_action_reason_codes_read ON public.inventory_action_reason_codes AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY inventory_action_reason_codes_service_role_all ON public.inventory_action_reason_codes AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY inventory_actions_authenticated_read ON public.inventory_actions AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY inventory_actions_deny_anon ON public.inventory_actions AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY inventory_actions_service_role_all ON public.inventory_actions AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY ipset_authenticated_all ON public.inventory_profit_settings AS PERMISSIVE FOR ALL TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids))) WITH CHECK ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY ipset_deny_anon ON public.inventory_profit_settings AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY ipset_service_role_all ON public.inventory_profit_settings AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY kyc_documents_deny_anon ON public.kyc_documents AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY kyc_documents_service_role_all ON public.kyc_documents AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY kyc_documents_staff_read ON public.kyc_documents AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY lead_recovery_action_events_authenticated_read ON public.lead_recovery_action_events AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY lead_recovery_action_events_deny_anon ON public.lead_recovery_action_events AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY lead_recovery_action_events_service_role_all ON public.lead_recovery_action_events AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY lead_recovery_actions_authenticated_read ON public.lead_recovery_actions AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY lead_recovery_actions_deny_anon ON public.lead_recovery_actions AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY lead_recovery_actions_service_role_all ON public.lead_recovery_actions AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY lead_recovery_reason_codes_authenticated_read ON public.lead_recovery_reason_codes AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY lead_recovery_reason_codes_deny_anon ON public.lead_recovery_reason_codes AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY lead_recovery_reason_codes_service_role_all ON public.lead_recovery_reason_codes AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY lead_recovery_settings_authenticated_read ON public.lead_recovery_settings AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY lead_recovery_settings_deny_anon ON public.lead_recovery_settings AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY lead_recovery_settings_service_role_all ON public.lead_recovery_settings AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY lead_recovery_states_authenticated_read ON public.lead_recovery_states AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY lead_recovery_states_deny_anon ON public.lead_recovery_states AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY lead_recovery_states_service_role_all ON public.lead_recovery_states AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY leads_authenticated_all ON public.leads AS PERMISSIVE FOR ALL TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids))) WITH CHECK ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY leads_deny_anon ON public.leads AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY leads_service_role_all ON public.leads AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY policy_jurisdiction_authenticated_read ON public.policy_jurisdiction AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_jurisdiction_deny_anon ON public.policy_jurisdiction AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY policy_jurisdiction_service_role_all ON public.policy_jurisdiction AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY policy_platform_attestation_authenticated_read ON public.policy_platform_attestation AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_platform_attestation_deny_anon ON public.policy_platform_attestation AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY policy_platform_attestation_service_role_all ON public.policy_platform_attestation AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY policy_rule_authenticated_read ON public.policy_rule AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id IS NULL) OR (tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids))));
CREATE POLICY policy_rule_deny_anon ON public.policy_rule AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY policy_rule_service_role_all ON public.policy_rule AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY policy_rule_event_authenticated_read ON public.policy_rule_event AS PERMISSIVE FOR SELECT TO authenticated USING (((tenant_id IS NULL) OR (tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids))));
CREATE POLICY policy_rule_event_deny_anon ON public.policy_rule_event AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY policy_rule_event_service_role_all ON public.policy_rule_event AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY policy_rule_type_authenticated_read ON public.policy_rule_type AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_rule_type_deny_anon ON public.policy_rule_type AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY policy_rule_type_service_role_all ON public.policy_rule_type AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY policy_unit_authenticated_read ON public.policy_unit AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_unit_deny_anon ON public.policy_unit AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY policy_unit_service_role_all ON public.policy_unit AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY policy_unmigrated_constant_authenticated_read ON public.policy_unmigrated_constant AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY policy_unmigrated_constant_deny_anon ON public.policy_unmigrated_constant AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY policy_unmigrated_constant_service_role_all ON public.policy_unmigrated_constant AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY processed_messages_deny_anon ON public.processed_messages AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY processed_messages_no_anon ON public.processed_messages AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY processed_messages_no_authenticated ON public.processed_messages AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY purchase_history_authenticated_read ON public.purchase_history AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY purchase_history_deny_anon ON public.purchase_history AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY purchase_history_service_role_all ON public.purchase_history AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY rag_docs_service_role_all ON public.rag_documents AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY rag_documents_authenticated_read ON public.rag_documents AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY rag_documents_deny_anon ON public.rag_documents AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY tenant_capability_authenticated_read ON public.tenant_capability AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY tenant_capability_deny_anon ON public.tenant_capability AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY tenant_capability_service_role_all ON public.tenant_capability AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY tenant_capability_catalogue_deny_anon ON public.tenant_capability_catalogue AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY tenant_capability_catalogue_service_role_all ON public.tenant_capability_catalogue AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY tenant_configuration_authenticated_read ON public.tenant_configuration AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY tenant_configuration_deny_anon ON public.tenant_configuration AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY tenant_configuration_service_role_all ON public.tenant_configuration AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY tenant_configuration_default_deny_anon ON public.tenant_configuration_default AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY tenant_configuration_default_service_role_all ON public.tenant_configuration_default AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY tenant_members_deny_anon ON public.tenant_members AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY tenant_members_self_read ON public.tenant_members AS PERMISSIVE FOR SELECT TO authenticated USING ((auth_user_id = auth.uid()));
CREATE POLICY tenant_members_service_role_all ON public.tenant_members AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY tenants_deny_anon ON public.tenants AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY tenants_member_read ON public.tenants AS PERMISSIVE FOR SELECT TO authenticated USING ((id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY tenants_service_role_all ON public.tenants AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY users_authenticated_read ON public.users AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY users_deny_anon ON public.users AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY users_service_role_all ON public.users AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY whatsapp_contacts_authenticated_read ON public.whatsapp_contacts AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY whatsapp_contacts_deny_anon ON public.whatsapp_contacts AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY whatsapp_contacts_service_role_all ON public.whatsapp_contacts AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY whatsapp_conversation_state_deny_anon ON public.whatsapp_conversation_state AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY whatsapp_conversation_state_service_role_all ON public.whatsapp_conversation_state AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY whatsapp_customer_message_seen_deny_end_users ON public.whatsapp_customer_message_seen AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY whatsapp_customer_message_seen_service_role_all ON public.whatsapp_customer_message_seen AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY whatsapp_delivery_events_deny_end_users ON public.whatsapp_delivery_events AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY whatsapp_delivery_events_service_role_all ON public.whatsapp_delivery_events AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY whatsapp_message_intent_deny_anon ON public.whatsapp_message_intent AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY whatsapp_message_intent_service_role_all ON public.whatsapp_message_intent AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY whatsapp_message_usage_authenticated_read ON public.whatsapp_message_usage AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY whatsapp_message_usage_deny_anon ON public.whatsapp_message_usage AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY whatsapp_message_usage_service_role_all ON public.whatsapp_message_usage AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY whatsapp_opt_in_event_deny_anon ON public.whatsapp_opt_in_event AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY whatsapp_opt_in_event_service_role_all ON public.whatsapp_opt_in_event AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY whatsapp_templates_authenticated_read ON public.whatsapp_templates AS PERMISSIVE FOR SELECT TO authenticated USING ((tenant_id IN ( SELECT nexus_current_tenant_ids() AS nexus_current_tenant_ids)));
CREATE POLICY whatsapp_templates_deny_anon ON public.whatsapp_templates AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY whatsapp_templates_service_role_all ON public.whatsapp_templates AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY workflow_registry_deny_anon ON public.workflow_registry AS RESTRICTIVE FOR ALL TO anon USING (false) WITH CHECK (false);
CREATE POLICY workflow_registry_read ON public.workflow_registry AS PERMISSIVE FOR SELECT TO authenticated USING (true);
CREATE POLICY workflow_registry_service_role_all ON public.workflow_registry AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ========================================================================
-- 14. GRANTS — revoke first
-- ========================================================================
-- Supabase ships ALTER DEFAULT PRIVILEGES granting ALL on new objects in
-- public to anon, authenticated and service_role. Dozens of NEXUS migrations
-- exist only to take that back. A baseline that merely GRANTed would therefore
-- reproduce the tables and leave the grants wide open, which is the one kind of
-- drift that puts one dealership's data in front of another. So: revoke
-- everything first, then grant back exactly what production holds.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated, service_role, PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, service_role, PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, service_role, PUBLIC;


-- ========================================================================
-- 15. GRANTS — schema
-- ========================================================================
GRANT USAGE ON SCHEMA public TO PUBLIC;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT CREATE ON SCHEMA public TO pg_database_owner;
GRANT USAGE ON SCHEMA public TO pg_database_owner;
GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO service_role;


-- ========================================================================
-- 16. GRANTS — tables, views and sequences
-- ========================================================================
GRANT SELECT ON TABLE public.attribution_edge_type TO authenticated;
GRANT DELETE ON TABLE public.attribution_edge_type TO service_role;
GRANT INSERT ON TABLE public.attribution_edge_type TO service_role;
GRANT MAINTAIN ON TABLE public.attribution_edge_type TO service_role;
GRANT REFERENCES ON TABLE public.attribution_edge_type TO service_role;
GRANT SELECT ON TABLE public.attribution_edge_type TO service_role;
GRANT TRIGGER ON TABLE public.attribution_edge_type TO service_role;
GRANT TRUNCATE ON TABLE public.attribution_edge_type TO service_role;
GRANT UPDATE ON TABLE public.attribution_edge_type TO service_role;
GRANT SELECT ON TABLE public.attribution_event_type TO authenticated;
GRANT DELETE ON TABLE public.attribution_event_type TO service_role;
GRANT INSERT ON TABLE public.attribution_event_type TO service_role;
GRANT MAINTAIN ON TABLE public.attribution_event_type TO service_role;
GRANT REFERENCES ON TABLE public.attribution_event_type TO service_role;
GRANT SELECT ON TABLE public.attribution_event_type TO service_role;
GRANT TRIGGER ON TABLE public.attribution_event_type TO service_role;
GRANT TRUNCATE ON TABLE public.attribution_event_type TO service_role;
GRANT UPDATE ON TABLE public.attribution_event_type TO service_role;
GRANT SELECT ON TABLE public.attribution_link_basis TO authenticated;
GRANT DELETE ON TABLE public.attribution_link_basis TO service_role;
GRANT INSERT ON TABLE public.attribution_link_basis TO service_role;
GRANT MAINTAIN ON TABLE public.attribution_link_basis TO service_role;
GRANT REFERENCES ON TABLE public.attribution_link_basis TO service_role;
GRANT SELECT ON TABLE public.attribution_link_basis TO service_role;
GRANT TRIGGER ON TABLE public.attribution_link_basis TO service_role;
GRANT TRUNCATE ON TABLE public.attribution_link_basis TO service_role;
GRANT UPDATE ON TABLE public.attribution_link_basis TO service_role;
GRANT SELECT ON TABLE public.audit_log TO authenticated;
GRANT DELETE ON TABLE public.audit_log TO service_role;
GRANT INSERT ON TABLE public.audit_log TO service_role;
GRANT MAINTAIN ON TABLE public.audit_log TO service_role;
GRANT REFERENCES ON TABLE public.audit_log TO service_role;
GRANT SELECT ON TABLE public.audit_log TO service_role;
GRANT TRIGGER ON TABLE public.audit_log TO service_role;
GRANT TRUNCATE ON TABLE public.audit_log TO service_role;
GRANT UPDATE ON TABLE public.audit_log TO service_role;
GRANT DELETE ON TABLE public.channel_message_events TO service_role;
GRANT INSERT ON TABLE public.channel_message_events TO service_role;
GRANT MAINTAIN ON TABLE public.channel_message_events TO service_role;
GRANT REFERENCES ON TABLE public.channel_message_events TO service_role;
GRANT SELECT ON TABLE public.channel_message_events TO service_role;
GRANT TRIGGER ON TABLE public.channel_message_events TO service_role;
GRANT TRUNCATE ON TABLE public.channel_message_events TO service_role;
GRANT UPDATE ON TABLE public.channel_message_events TO service_role;
GRANT DELETE ON TABLE public.channel_provider_capability TO service_role;
GRANT INSERT ON TABLE public.channel_provider_capability TO service_role;
GRANT MAINTAIN ON TABLE public.channel_provider_capability TO service_role;
GRANT REFERENCES ON TABLE public.channel_provider_capability TO service_role;
GRANT SELECT ON TABLE public.channel_provider_capability TO service_role;
GRANT TRIGGER ON TABLE public.channel_provider_capability TO service_role;
GRANT TRUNCATE ON TABLE public.channel_provider_capability TO service_role;
GRANT UPDATE ON TABLE public.channel_provider_capability TO service_role;
GRANT DELETE ON TABLE public.channel_provider_rank TO service_role;
GRANT INSERT ON TABLE public.channel_provider_rank TO service_role;
GRANT MAINTAIN ON TABLE public.channel_provider_rank TO service_role;
GRANT REFERENCES ON TABLE public.channel_provider_rank TO service_role;
GRANT SELECT ON TABLE public.channel_provider_rank TO service_role;
GRANT TRIGGER ON TABLE public.channel_provider_rank TO service_role;
GRANT TRUNCATE ON TABLE public.channel_provider_rank TO service_role;
GRANT UPDATE ON TABLE public.channel_provider_rank TO service_role;
GRANT DELETE ON TABLE public.channel_registry TO service_role;
GRANT INSERT ON TABLE public.channel_registry TO service_role;
GRANT MAINTAIN ON TABLE public.channel_registry TO service_role;
GRANT REFERENCES ON TABLE public.channel_registry TO service_role;
GRANT SELECT ON TABLE public.channel_registry TO service_role;
GRANT TRIGGER ON TABLE public.channel_registry TO service_role;
GRANT TRUNCATE ON TABLE public.channel_registry TO service_role;
GRANT UPDATE ON TABLE public.channel_registry TO service_role;
GRANT DELETE ON TABLE public.channel_send_directive TO service_role;
GRANT INSERT ON TABLE public.channel_send_directive TO service_role;
GRANT MAINTAIN ON TABLE public.channel_send_directive TO service_role;
GRANT REFERENCES ON TABLE public.channel_send_directive TO service_role;
GRANT SELECT ON TABLE public.channel_send_directive TO service_role;
GRANT TRIGGER ON TABLE public.channel_send_directive TO service_role;
GRANT TRUNCATE ON TABLE public.channel_send_directive TO service_role;
GRANT UPDATE ON TABLE public.channel_send_directive TO service_role;
GRANT DELETE ON TABLE public.channel_send_form TO service_role;
GRANT INSERT ON TABLE public.channel_send_form TO service_role;
GRANT MAINTAIN ON TABLE public.channel_send_form TO service_role;
GRANT REFERENCES ON TABLE public.channel_send_form TO service_role;
GRANT SELECT ON TABLE public.channel_send_form TO service_role;
GRANT TRIGGER ON TABLE public.channel_send_form TO service_role;
GRANT TRUNCATE ON TABLE public.channel_send_form TO service_role;
GRANT UPDATE ON TABLE public.channel_send_form TO service_role;
GRANT SELECT ON TABLE public.communication_logs TO authenticated;
GRANT DELETE ON TABLE public.communication_logs TO service_role;
GRANT INSERT ON TABLE public.communication_logs TO service_role;
GRANT MAINTAIN ON TABLE public.communication_logs TO service_role;
GRANT REFERENCES ON TABLE public.communication_logs TO service_role;
GRANT SELECT ON TABLE public.communication_logs TO service_role;
GRANT TRIGGER ON TABLE public.communication_logs TO service_role;
GRANT TRUNCATE ON TABLE public.communication_logs TO service_role;
GRANT UPDATE ON TABLE public.communication_logs TO service_role;
GRANT SELECT ON TABLE public.competitors TO authenticated;
GRANT DELETE ON TABLE public.competitors TO service_role;
GRANT INSERT ON TABLE public.competitors TO service_role;
GRANT MAINTAIN ON TABLE public.competitors TO service_role;
GRANT REFERENCES ON TABLE public.competitors TO service_role;
GRANT SELECT ON TABLE public.competitors TO service_role;
GRANT TRIGGER ON TABLE public.competitors TO service_role;
GRANT TRUNCATE ON TABLE public.competitors TO service_role;
GRANT UPDATE ON TABLE public.competitors TO service_role;
GRANT SELECT ON SEQUENCE public.competitors_id_seq TO service_role;
GRANT UPDATE ON SEQUENCE public.competitors_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.competitors_id_seq TO service_role;
GRANT SELECT ON TABLE public.customer_360_profiles TO authenticated;
GRANT DELETE ON TABLE public.customer_360_profiles TO service_role;
GRANT INSERT ON TABLE public.customer_360_profiles TO service_role;
GRANT MAINTAIN ON TABLE public.customer_360_profiles TO service_role;
GRANT REFERENCES ON TABLE public.customer_360_profiles TO service_role;
GRANT SELECT ON TABLE public.customer_360_profiles TO service_role;
GRANT TRIGGER ON TABLE public.customer_360_profiles TO service_role;
GRANT TRUNCATE ON TABLE public.customer_360_profiles TO service_role;
GRANT UPDATE ON TABLE public.customer_360_profiles TO service_role;
GRANT SELECT ON TABLE public.daily_metrics TO authenticated;
GRANT DELETE ON TABLE public.daily_metrics TO service_role;
GRANT INSERT ON TABLE public.daily_metrics TO service_role;
GRANT MAINTAIN ON TABLE public.daily_metrics TO service_role;
GRANT REFERENCES ON TABLE public.daily_metrics TO service_role;
GRANT SELECT ON TABLE public.daily_metrics TO service_role;
GRANT TRIGGER ON TABLE public.daily_metrics TO service_role;
GRANT TRUNCATE ON TABLE public.daily_metrics TO service_role;
GRANT UPDATE ON TABLE public.daily_metrics TO service_role;
GRANT SELECT ON TABLE public.deal_rescue_evidence_sources TO authenticated;
GRANT DELETE ON TABLE public.deal_rescue_evidence_sources TO service_role;
GRANT INSERT ON TABLE public.deal_rescue_evidence_sources TO service_role;
GRANT MAINTAIN ON TABLE public.deal_rescue_evidence_sources TO service_role;
GRANT REFERENCES ON TABLE public.deal_rescue_evidence_sources TO service_role;
GRANT SELECT ON TABLE public.deal_rescue_evidence_sources TO service_role;
GRANT TRIGGER ON TABLE public.deal_rescue_evidence_sources TO service_role;
GRANT TRUNCATE ON TABLE public.deal_rescue_evidence_sources TO service_role;
GRANT UPDATE ON TABLE public.deal_rescue_evidence_sources TO service_role;
GRANT SELECT ON TABLE public.deal_rescue_prerequisites TO authenticated;
GRANT DELETE ON TABLE public.deal_rescue_prerequisites TO service_role;
GRANT INSERT ON TABLE public.deal_rescue_prerequisites TO service_role;
GRANT MAINTAIN ON TABLE public.deal_rescue_prerequisites TO service_role;
GRANT REFERENCES ON TABLE public.deal_rescue_prerequisites TO service_role;
GRANT SELECT ON TABLE public.deal_rescue_prerequisites TO service_role;
GRANT TRIGGER ON TABLE public.deal_rescue_prerequisites TO service_role;
GRANT TRUNCATE ON TABLE public.deal_rescue_prerequisites TO service_role;
GRANT UPDATE ON TABLE public.deal_rescue_prerequisites TO service_role;
GRANT SELECT ON TABLE public.deal_rescue_settings TO authenticated;
GRANT DELETE ON TABLE public.deal_rescue_settings TO service_role;
GRANT INSERT ON TABLE public.deal_rescue_settings TO service_role;
GRANT MAINTAIN ON TABLE public.deal_rescue_settings TO service_role;
GRANT REFERENCES ON TABLE public.deal_rescue_settings TO service_role;
GRANT SELECT ON TABLE public.deal_rescue_settings TO service_role;
GRANT TRIGGER ON TABLE public.deal_rescue_settings TO service_role;
GRANT TRUNCATE ON TABLE public.deal_rescue_settings TO service_role;
GRANT UPDATE ON TABLE public.deal_rescue_settings TO service_role;
GRANT SELECT ON TABLE public.deal_rescue_states TO authenticated;
GRANT DELETE ON TABLE public.deal_rescue_states TO service_role;
GRANT INSERT ON TABLE public.deal_rescue_states TO service_role;
GRANT MAINTAIN ON TABLE public.deal_rescue_states TO service_role;
GRANT REFERENCES ON TABLE public.deal_rescue_states TO service_role;
GRANT SELECT ON TABLE public.deal_rescue_states TO service_role;
GRANT TRIGGER ON TABLE public.deal_rescue_states TO service_role;
GRANT TRUNCATE ON TABLE public.deal_rescue_states TO service_role;
GRANT UPDATE ON TABLE public.deal_rescue_states TO service_role;
GRANT SELECT ON TABLE public.deals_embeddings TO authenticated;
GRANT DELETE ON TABLE public.deals_embeddings TO service_role;
GRANT INSERT ON TABLE public.deals_embeddings TO service_role;
GRANT MAINTAIN ON TABLE public.deals_embeddings TO service_role;
GRANT REFERENCES ON TABLE public.deals_embeddings TO service_role;
GRANT SELECT ON TABLE public.deals_embeddings TO service_role;
GRANT TRIGGER ON TABLE public.deals_embeddings TO service_role;
GRANT TRUNCATE ON TABLE public.deals_embeddings TO service_role;
GRANT UPDATE ON TABLE public.deals_embeddings TO service_role;
GRANT SELECT ON TABLE public.finance_quotes TO authenticated;
GRANT DELETE ON TABLE public.finance_quotes TO service_role;
GRANT INSERT ON TABLE public.finance_quotes TO service_role;
GRANT MAINTAIN ON TABLE public.finance_quotes TO service_role;
GRANT REFERENCES ON TABLE public.finance_quotes TO service_role;
GRANT SELECT ON TABLE public.finance_quotes TO service_role;
GRANT TRIGGER ON TABLE public.finance_quotes TO service_role;
GRANT TRUNCATE ON TABLE public.finance_quotes TO service_role;
GRANT UPDATE ON TABLE public.finance_quotes TO service_role;
GRANT DELETE ON TABLE public.inventory TO authenticated;
GRANT INSERT ON TABLE public.inventory TO authenticated;
GRANT SELECT ON TABLE public.inventory TO authenticated;
GRANT UPDATE ON TABLE public.inventory TO authenticated;
GRANT DELETE ON TABLE public.inventory TO service_role;
GRANT INSERT ON TABLE public.inventory TO service_role;
GRANT MAINTAIN ON TABLE public.inventory TO service_role;
GRANT REFERENCES ON TABLE public.inventory TO service_role;
GRANT SELECT ON TABLE public.inventory TO service_role;
GRANT TRIGGER ON TABLE public.inventory TO service_role;
GRANT TRUNCATE ON TABLE public.inventory TO service_role;
GRANT UPDATE ON TABLE public.inventory TO service_role;
GRANT SELECT ON TABLE public.inventory_action_events TO authenticated;
GRANT DELETE ON TABLE public.inventory_action_events TO service_role;
GRANT INSERT ON TABLE public.inventory_action_events TO service_role;
GRANT MAINTAIN ON TABLE public.inventory_action_events TO service_role;
GRANT REFERENCES ON TABLE public.inventory_action_events TO service_role;
GRANT SELECT ON TABLE public.inventory_action_events TO service_role;
GRANT TRIGGER ON TABLE public.inventory_action_events TO service_role;
GRANT TRUNCATE ON TABLE public.inventory_action_events TO service_role;
GRANT UPDATE ON TABLE public.inventory_action_events TO service_role;
GRANT SELECT ON TABLE public.inventory_action_policy TO authenticated;
GRANT DELETE ON TABLE public.inventory_action_policy TO service_role;
GRANT INSERT ON TABLE public.inventory_action_policy TO service_role;
GRANT MAINTAIN ON TABLE public.inventory_action_policy TO service_role;
GRANT REFERENCES ON TABLE public.inventory_action_policy TO service_role;
GRANT SELECT ON TABLE public.inventory_action_policy TO service_role;
GRANT TRIGGER ON TABLE public.inventory_action_policy TO service_role;
GRANT TRUNCATE ON TABLE public.inventory_action_policy TO service_role;
GRANT UPDATE ON TABLE public.inventory_action_policy TO service_role;
GRANT SELECT ON TABLE public.inventory_action_reason_codes TO authenticated;
GRANT DELETE ON TABLE public.inventory_action_reason_codes TO service_role;
GRANT INSERT ON TABLE public.inventory_action_reason_codes TO service_role;
GRANT MAINTAIN ON TABLE public.inventory_action_reason_codes TO service_role;
GRANT REFERENCES ON TABLE public.inventory_action_reason_codes TO service_role;
GRANT SELECT ON TABLE public.inventory_action_reason_codes TO service_role;
GRANT TRIGGER ON TABLE public.inventory_action_reason_codes TO service_role;
GRANT TRUNCATE ON TABLE public.inventory_action_reason_codes TO service_role;
GRANT UPDATE ON TABLE public.inventory_action_reason_codes TO service_role;
GRANT SELECT ON TABLE public.inventory_actions TO authenticated;
GRANT DELETE ON TABLE public.inventory_actions TO service_role;
GRANT INSERT ON TABLE public.inventory_actions TO service_role;
GRANT MAINTAIN ON TABLE public.inventory_actions TO service_role;
GRANT REFERENCES ON TABLE public.inventory_actions TO service_role;
GRANT SELECT ON TABLE public.inventory_actions TO service_role;
GRANT TRIGGER ON TABLE public.inventory_actions TO service_role;
GRANT TRUNCATE ON TABLE public.inventory_actions TO service_role;
GRANT UPDATE ON TABLE public.inventory_actions TO service_role;
GRANT SELECT ON TABLE public.inventory_profit_settings TO authenticated;
GRANT DELETE ON TABLE public.inventory_profit_settings TO service_role;
GRANT INSERT ON TABLE public.inventory_profit_settings TO service_role;
GRANT MAINTAIN ON TABLE public.inventory_profit_settings TO service_role;
GRANT REFERENCES ON TABLE public.inventory_profit_settings TO service_role;
GRANT SELECT ON TABLE public.inventory_profit_settings TO service_role;
GRANT TRIGGER ON TABLE public.inventory_profit_settings TO service_role;
GRANT TRUNCATE ON TABLE public.inventory_profit_settings TO service_role;
GRANT UPDATE ON TABLE public.inventory_profit_settings TO service_role;
GRANT SELECT ON TABLE public.kyc_documents TO authenticated;
GRANT DELETE ON TABLE public.kyc_documents TO service_role;
GRANT INSERT ON TABLE public.kyc_documents TO service_role;
GRANT MAINTAIN ON TABLE public.kyc_documents TO service_role;
GRANT REFERENCES ON TABLE public.kyc_documents TO service_role;
GRANT SELECT ON TABLE public.kyc_documents TO service_role;
GRANT TRIGGER ON TABLE public.kyc_documents TO service_role;
GRANT TRUNCATE ON TABLE public.kyc_documents TO service_role;
GRANT UPDATE ON TABLE public.kyc_documents TO service_role;
GRANT SELECT ON TABLE public.lead_recovery_action_events TO authenticated;
GRANT DELETE ON TABLE public.lead_recovery_action_events TO service_role;
GRANT INSERT ON TABLE public.lead_recovery_action_events TO service_role;
GRANT MAINTAIN ON TABLE public.lead_recovery_action_events TO service_role;
GRANT REFERENCES ON TABLE public.lead_recovery_action_events TO service_role;
GRANT SELECT ON TABLE public.lead_recovery_action_events TO service_role;
GRANT TRIGGER ON TABLE public.lead_recovery_action_events TO service_role;
GRANT TRUNCATE ON TABLE public.lead_recovery_action_events TO service_role;
GRANT UPDATE ON TABLE public.lead_recovery_action_events TO service_role;
GRANT SELECT ON TABLE public.lead_recovery_actions TO authenticated;
GRANT DELETE ON TABLE public.lead_recovery_actions TO service_role;
GRANT INSERT ON TABLE public.lead_recovery_actions TO service_role;
GRANT MAINTAIN ON TABLE public.lead_recovery_actions TO service_role;
GRANT REFERENCES ON TABLE public.lead_recovery_actions TO service_role;
GRANT SELECT ON TABLE public.lead_recovery_actions TO service_role;
GRANT TRIGGER ON TABLE public.lead_recovery_actions TO service_role;
GRANT TRUNCATE ON TABLE public.lead_recovery_actions TO service_role;
GRANT UPDATE ON TABLE public.lead_recovery_actions TO service_role;
GRANT SELECT ON TABLE public.lead_recovery_reason_codes TO authenticated;
GRANT DELETE ON TABLE public.lead_recovery_reason_codes TO service_role;
GRANT INSERT ON TABLE public.lead_recovery_reason_codes TO service_role;
GRANT MAINTAIN ON TABLE public.lead_recovery_reason_codes TO service_role;
GRANT REFERENCES ON TABLE public.lead_recovery_reason_codes TO service_role;
GRANT SELECT ON TABLE public.lead_recovery_reason_codes TO service_role;
GRANT TRIGGER ON TABLE public.lead_recovery_reason_codes TO service_role;
GRANT TRUNCATE ON TABLE public.lead_recovery_reason_codes TO service_role;
GRANT UPDATE ON TABLE public.lead_recovery_reason_codes TO service_role;
GRANT SELECT ON TABLE public.lead_recovery_settings TO authenticated;
GRANT DELETE ON TABLE public.lead_recovery_settings TO service_role;
GRANT INSERT ON TABLE public.lead_recovery_settings TO service_role;
GRANT MAINTAIN ON TABLE public.lead_recovery_settings TO service_role;
GRANT REFERENCES ON TABLE public.lead_recovery_settings TO service_role;
GRANT SELECT ON TABLE public.lead_recovery_settings TO service_role;
GRANT TRIGGER ON TABLE public.lead_recovery_settings TO service_role;
GRANT TRUNCATE ON TABLE public.lead_recovery_settings TO service_role;
GRANT UPDATE ON TABLE public.lead_recovery_settings TO service_role;
GRANT SELECT ON TABLE public.lead_recovery_states TO authenticated;
GRANT DELETE ON TABLE public.lead_recovery_states TO service_role;
GRANT INSERT ON TABLE public.lead_recovery_states TO service_role;
GRANT MAINTAIN ON TABLE public.lead_recovery_states TO service_role;
GRANT REFERENCES ON TABLE public.lead_recovery_states TO service_role;
GRANT SELECT ON TABLE public.lead_recovery_states TO service_role;
GRANT TRIGGER ON TABLE public.lead_recovery_states TO service_role;
GRANT TRUNCATE ON TABLE public.lead_recovery_states TO service_role;
GRANT UPDATE ON TABLE public.lead_recovery_states TO service_role;
GRANT SELECT ON TABLE public.leads TO authenticated;
GRANT UPDATE ON TABLE public.leads TO authenticated;
GRANT DELETE ON TABLE public.leads TO service_role;
GRANT INSERT ON TABLE public.leads TO service_role;
GRANT MAINTAIN ON TABLE public.leads TO service_role;
GRANT REFERENCES ON TABLE public.leads TO service_role;
GRANT SELECT ON TABLE public.leads TO service_role;
GRANT TRIGGER ON TABLE public.leads TO service_role;
GRANT TRUNCATE ON TABLE public.leads TO service_role;
GRANT UPDATE ON TABLE public.leads TO service_role;
GRANT SELECT ON SEQUENCE public.leads_id_seq TO service_role;
GRANT UPDATE ON SEQUENCE public.leads_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.leads_id_seq TO service_role;
GRANT SELECT ON TABLE public.policy_jurisdiction TO authenticated;
GRANT DELETE ON TABLE public.policy_jurisdiction TO service_role;
GRANT INSERT ON TABLE public.policy_jurisdiction TO service_role;
GRANT MAINTAIN ON TABLE public.policy_jurisdiction TO service_role;
GRANT REFERENCES ON TABLE public.policy_jurisdiction TO service_role;
GRANT SELECT ON TABLE public.policy_jurisdiction TO service_role;
GRANT TRIGGER ON TABLE public.policy_jurisdiction TO service_role;
GRANT TRUNCATE ON TABLE public.policy_jurisdiction TO service_role;
GRANT UPDATE ON TABLE public.policy_jurisdiction TO service_role;
GRANT DELETE ON TABLE public.policy_platform_attestation TO service_role;
GRANT INSERT ON TABLE public.policy_platform_attestation TO service_role;
GRANT MAINTAIN ON TABLE public.policy_platform_attestation TO service_role;
GRANT REFERENCES ON TABLE public.policy_platform_attestation TO service_role;
GRANT SELECT ON TABLE public.policy_platform_attestation TO service_role;
GRANT TRIGGER ON TABLE public.policy_platform_attestation TO service_role;
GRANT TRUNCATE ON TABLE public.policy_platform_attestation TO service_role;
GRANT UPDATE ON TABLE public.policy_platform_attestation TO service_role;
GRANT SELECT ON TABLE public.policy_rule TO authenticated;
GRANT DELETE ON TABLE public.policy_rule TO service_role;
GRANT INSERT ON TABLE public.policy_rule TO service_role;
GRANT MAINTAIN ON TABLE public.policy_rule TO service_role;
GRANT REFERENCES ON TABLE public.policy_rule TO service_role;
GRANT SELECT ON TABLE public.policy_rule TO service_role;
GRANT TRIGGER ON TABLE public.policy_rule TO service_role;
GRANT TRUNCATE ON TABLE public.policy_rule TO service_role;
GRANT UPDATE ON TABLE public.policy_rule TO service_role;
GRANT SELECT ON TABLE public.policy_rule_event TO authenticated;
GRANT DELETE ON TABLE public.policy_rule_event TO service_role;
GRANT INSERT ON TABLE public.policy_rule_event TO service_role;
GRANT MAINTAIN ON TABLE public.policy_rule_event TO service_role;
GRANT REFERENCES ON TABLE public.policy_rule_event TO service_role;
GRANT SELECT ON TABLE public.policy_rule_event TO service_role;
GRANT TRIGGER ON TABLE public.policy_rule_event TO service_role;
GRANT TRUNCATE ON TABLE public.policy_rule_event TO service_role;
GRANT UPDATE ON TABLE public.policy_rule_event TO service_role;
GRANT SELECT ON TABLE public.policy_rule_type TO authenticated;
GRANT DELETE ON TABLE public.policy_rule_type TO service_role;
GRANT INSERT ON TABLE public.policy_rule_type TO service_role;
GRANT MAINTAIN ON TABLE public.policy_rule_type TO service_role;
GRANT REFERENCES ON TABLE public.policy_rule_type TO service_role;
GRANT SELECT ON TABLE public.policy_rule_type TO service_role;
GRANT TRIGGER ON TABLE public.policy_rule_type TO service_role;
GRANT TRUNCATE ON TABLE public.policy_rule_type TO service_role;
GRANT UPDATE ON TABLE public.policy_rule_type TO service_role;
GRANT SELECT ON TABLE public.policy_unit TO authenticated;
GRANT DELETE ON TABLE public.policy_unit TO service_role;
GRANT INSERT ON TABLE public.policy_unit TO service_role;
GRANT MAINTAIN ON TABLE public.policy_unit TO service_role;
GRANT REFERENCES ON TABLE public.policy_unit TO service_role;
GRANT SELECT ON TABLE public.policy_unit TO service_role;
GRANT TRIGGER ON TABLE public.policy_unit TO service_role;
GRANT TRUNCATE ON TABLE public.policy_unit TO service_role;
GRANT UPDATE ON TABLE public.policy_unit TO service_role;
GRANT SELECT ON TABLE public.policy_unmigrated_constant TO authenticated;
GRANT DELETE ON TABLE public.policy_unmigrated_constant TO service_role;
GRANT INSERT ON TABLE public.policy_unmigrated_constant TO service_role;
GRANT MAINTAIN ON TABLE public.policy_unmigrated_constant TO service_role;
GRANT REFERENCES ON TABLE public.policy_unmigrated_constant TO service_role;
GRANT SELECT ON TABLE public.policy_unmigrated_constant TO service_role;
GRANT TRIGGER ON TABLE public.policy_unmigrated_constant TO service_role;
GRANT TRUNCATE ON TABLE public.policy_unmigrated_constant TO service_role;
GRANT UPDATE ON TABLE public.policy_unmigrated_constant TO service_role;
GRANT DELETE ON TABLE public.processed_messages TO service_role;
GRANT INSERT ON TABLE public.processed_messages TO service_role;
GRANT MAINTAIN ON TABLE public.processed_messages TO service_role;
GRANT REFERENCES ON TABLE public.processed_messages TO service_role;
GRANT SELECT ON TABLE public.processed_messages TO service_role;
GRANT TRIGGER ON TABLE public.processed_messages TO service_role;
GRANT TRUNCATE ON TABLE public.processed_messages TO service_role;
GRANT UPDATE ON TABLE public.processed_messages TO service_role;
GRANT SELECT ON TABLE public.purchase_history TO authenticated;
GRANT DELETE ON TABLE public.purchase_history TO service_role;
GRANT INSERT ON TABLE public.purchase_history TO service_role;
GRANT MAINTAIN ON TABLE public.purchase_history TO service_role;
GRANT REFERENCES ON TABLE public.purchase_history TO service_role;
GRANT SELECT ON TABLE public.purchase_history TO service_role;
GRANT TRIGGER ON TABLE public.purchase_history TO service_role;
GRANT TRUNCATE ON TABLE public.purchase_history TO service_role;
GRANT UPDATE ON TABLE public.purchase_history TO service_role;
GRANT SELECT ON TABLE public.rag_documents TO authenticated;
GRANT DELETE ON TABLE public.rag_documents TO service_role;
GRANT INSERT ON TABLE public.rag_documents TO service_role;
GRANT MAINTAIN ON TABLE public.rag_documents TO service_role;
GRANT REFERENCES ON TABLE public.rag_documents TO service_role;
GRANT SELECT ON TABLE public.rag_documents TO service_role;
GRANT TRIGGER ON TABLE public.rag_documents TO service_role;
GRANT TRUNCATE ON TABLE public.rag_documents TO service_role;
GRANT UPDATE ON TABLE public.rag_documents TO service_role;
GRANT SELECT ON SEQUENCE public.rag_documents_id_seq TO service_role;
GRANT UPDATE ON SEQUENCE public.rag_documents_id_seq TO service_role;
GRANT USAGE ON SEQUENCE public.rag_documents_id_seq TO service_role;
GRANT SELECT ON TABLE public.tenant_capability TO authenticated;
GRANT DELETE ON TABLE public.tenant_capability TO service_role;
GRANT INSERT ON TABLE public.tenant_capability TO service_role;
GRANT MAINTAIN ON TABLE public.tenant_capability TO service_role;
GRANT REFERENCES ON TABLE public.tenant_capability TO service_role;
GRANT SELECT ON TABLE public.tenant_capability TO service_role;
GRANT TRIGGER ON TABLE public.tenant_capability TO service_role;
GRANT TRUNCATE ON TABLE public.tenant_capability TO service_role;
GRANT UPDATE ON TABLE public.tenant_capability TO service_role;
GRANT DELETE ON TABLE public.tenant_capability_catalogue TO service_role;
GRANT INSERT ON TABLE public.tenant_capability_catalogue TO service_role;
GRANT MAINTAIN ON TABLE public.tenant_capability_catalogue TO service_role;
GRANT REFERENCES ON TABLE public.tenant_capability_catalogue TO service_role;
GRANT SELECT ON TABLE public.tenant_capability_catalogue TO service_role;
GRANT TRIGGER ON TABLE public.tenant_capability_catalogue TO service_role;
GRANT TRUNCATE ON TABLE public.tenant_capability_catalogue TO service_role;
GRANT UPDATE ON TABLE public.tenant_capability_catalogue TO service_role;
GRANT SELECT ON TABLE public.tenant_configuration TO authenticated;
GRANT DELETE ON TABLE public.tenant_configuration TO service_role;
GRANT INSERT ON TABLE public.tenant_configuration TO service_role;
GRANT MAINTAIN ON TABLE public.tenant_configuration TO service_role;
GRANT REFERENCES ON TABLE public.tenant_configuration TO service_role;
GRANT SELECT ON TABLE public.tenant_configuration TO service_role;
GRANT TRIGGER ON TABLE public.tenant_configuration TO service_role;
GRANT TRUNCATE ON TABLE public.tenant_configuration TO service_role;
GRANT UPDATE ON TABLE public.tenant_configuration TO service_role;
GRANT DELETE ON TABLE public.tenant_configuration_default TO service_role;
GRANT INSERT ON TABLE public.tenant_configuration_default TO service_role;
GRANT MAINTAIN ON TABLE public.tenant_configuration_default TO service_role;
GRANT REFERENCES ON TABLE public.tenant_configuration_default TO service_role;
GRANT SELECT ON TABLE public.tenant_configuration_default TO service_role;
GRANT TRIGGER ON TABLE public.tenant_configuration_default TO service_role;
GRANT TRUNCATE ON TABLE public.tenant_configuration_default TO service_role;
GRANT UPDATE ON TABLE public.tenant_configuration_default TO service_role;
GRANT SELECT ON TABLE public.tenant_members TO authenticated;
GRANT DELETE ON TABLE public.tenant_members TO service_role;
GRANT INSERT ON TABLE public.tenant_members TO service_role;
GRANT MAINTAIN ON TABLE public.tenant_members TO service_role;
GRANT REFERENCES ON TABLE public.tenant_members TO service_role;
GRANT SELECT ON TABLE public.tenant_members TO service_role;
GRANT TRIGGER ON TABLE public.tenant_members TO service_role;
GRANT TRUNCATE ON TABLE public.tenant_members TO service_role;
GRANT UPDATE ON TABLE public.tenant_members TO service_role;
GRANT SELECT ON TABLE public.tenants TO authenticated;
GRANT DELETE ON TABLE public.tenants TO service_role;
GRANT INSERT ON TABLE public.tenants TO service_role;
GRANT MAINTAIN ON TABLE public.tenants TO service_role;
GRANT REFERENCES ON TABLE public.tenants TO service_role;
GRANT SELECT ON TABLE public.tenants TO service_role;
GRANT TRIGGER ON TABLE public.tenants TO service_role;
GRANT TRUNCATE ON TABLE public.tenants TO service_role;
GRANT UPDATE ON TABLE public.tenants TO service_role;
GRANT SELECT ON TABLE public.users TO authenticated;
GRANT DELETE ON TABLE public.users TO service_role;
GRANT INSERT ON TABLE public.users TO service_role;
GRANT MAINTAIN ON TABLE public.users TO service_role;
GRANT REFERENCES ON TABLE public.users TO service_role;
GRANT SELECT ON TABLE public.users TO service_role;
GRANT TRIGGER ON TABLE public.users TO service_role;
GRANT TRUNCATE ON TABLE public.users TO service_role;
GRANT UPDATE ON TABLE public.users TO service_role;
GRANT SELECT ON TABLE public.v_action_center_health TO authenticated;
GRANT DELETE ON TABLE public.v_action_center_health TO service_role;
GRANT INSERT ON TABLE public.v_action_center_health TO service_role;
GRANT MAINTAIN ON TABLE public.v_action_center_health TO service_role;
GRANT REFERENCES ON TABLE public.v_action_center_health TO service_role;
GRANT SELECT ON TABLE public.v_action_center_health TO service_role;
GRANT TRIGGER ON TABLE public.v_action_center_health TO service_role;
GRANT TRUNCATE ON TABLE public.v_action_center_health TO service_role;
GRANT UPDATE ON TABLE public.v_action_center_health TO service_role;
GRANT SELECT ON TABLE public.v_attribution_edges TO authenticated;
GRANT DELETE ON TABLE public.v_attribution_edges TO service_role;
GRANT INSERT ON TABLE public.v_attribution_edges TO service_role;
GRANT MAINTAIN ON TABLE public.v_attribution_edges TO service_role;
GRANT REFERENCES ON TABLE public.v_attribution_edges TO service_role;
GRANT SELECT ON TABLE public.v_attribution_edges TO service_role;
GRANT TRIGGER ON TABLE public.v_attribution_edges TO service_role;
GRANT TRUNCATE ON TABLE public.v_attribution_edges TO service_role;
GRANT UPDATE ON TABLE public.v_attribution_edges TO service_role;
GRANT SELECT ON TABLE public.v_attribution_events TO authenticated;
GRANT DELETE ON TABLE public.v_attribution_events TO service_role;
GRANT INSERT ON TABLE public.v_attribution_events TO service_role;
GRANT MAINTAIN ON TABLE public.v_attribution_events TO service_role;
GRANT REFERENCES ON TABLE public.v_attribution_events TO service_role;
GRANT SELECT ON TABLE public.v_attribution_events TO service_role;
GRANT TRIGGER ON TABLE public.v_attribution_events TO service_role;
GRANT TRUNCATE ON TABLE public.v_attribution_events TO service_role;
GRANT UPDATE ON TABLE public.v_attribution_events TO service_role;
GRANT SELECT ON TABLE public.v_attribution_lead_chain TO authenticated;
GRANT DELETE ON TABLE public.v_attribution_lead_chain TO service_role;
GRANT INSERT ON TABLE public.v_attribution_lead_chain TO service_role;
GRANT MAINTAIN ON TABLE public.v_attribution_lead_chain TO service_role;
GRANT REFERENCES ON TABLE public.v_attribution_lead_chain TO service_role;
GRANT SELECT ON TABLE public.v_attribution_lead_chain TO service_role;
GRANT TRIGGER ON TABLE public.v_attribution_lead_chain TO service_role;
GRANT TRUNCATE ON TABLE public.v_attribution_lead_chain TO service_role;
GRANT UPDATE ON TABLE public.v_attribution_lead_chain TO service_role;
GRANT SELECT ON TABLE public.v_attribution_link_map TO authenticated;
GRANT DELETE ON TABLE public.v_attribution_link_map TO service_role;
GRANT INSERT ON TABLE public.v_attribution_link_map TO service_role;
GRANT MAINTAIN ON TABLE public.v_attribution_link_map TO service_role;
GRANT REFERENCES ON TABLE public.v_attribution_link_map TO service_role;
GRANT SELECT ON TABLE public.v_attribution_link_map TO service_role;
GRANT TRIGGER ON TABLE public.v_attribution_link_map TO service_role;
GRANT TRUNCATE ON TABLE public.v_attribution_link_map TO service_role;
GRANT UPDATE ON TABLE public.v_attribution_link_map TO service_role;
GRANT SELECT ON TABLE public.v_attribution_sale_chain TO authenticated;
GRANT DELETE ON TABLE public.v_attribution_sale_chain TO service_role;
GRANT INSERT ON TABLE public.v_attribution_sale_chain TO service_role;
GRANT MAINTAIN ON TABLE public.v_attribution_sale_chain TO service_role;
GRANT REFERENCES ON TABLE public.v_attribution_sale_chain TO service_role;
GRANT SELECT ON TABLE public.v_attribution_sale_chain TO service_role;
GRANT TRIGGER ON TABLE public.v_attribution_sale_chain TO service_role;
GRANT TRUNCATE ON TABLE public.v_attribution_sale_chain TO service_role;
GRANT UPDATE ON TABLE public.v_attribution_sale_chain TO service_role;
GRANT SELECT ON TABLE public.v_audit_unregistered_writers TO authenticated;
GRANT DELETE ON TABLE public.v_audit_unregistered_writers TO service_role;
GRANT INSERT ON TABLE public.v_audit_unregistered_writers TO service_role;
GRANT MAINTAIN ON TABLE public.v_audit_unregistered_writers TO service_role;
GRANT REFERENCES ON TABLE public.v_audit_unregistered_writers TO service_role;
GRANT SELECT ON TABLE public.v_audit_unregistered_writers TO service_role;
GRANT TRIGGER ON TABLE public.v_audit_unregistered_writers TO service_role;
GRANT TRUNCATE ON TABLE public.v_audit_unregistered_writers TO service_role;
GRANT UPDATE ON TABLE public.v_audit_unregistered_writers TO service_role;
GRANT DELETE ON TABLE public.v_channel_provider_capability TO service_role;
GRANT INSERT ON TABLE public.v_channel_provider_capability TO service_role;
GRANT MAINTAIN ON TABLE public.v_channel_provider_capability TO service_role;
GRANT REFERENCES ON TABLE public.v_channel_provider_capability TO service_role;
GRANT SELECT ON TABLE public.v_channel_provider_capability TO service_role;
GRANT TRIGGER ON TABLE public.v_channel_provider_capability TO service_role;
GRANT TRUNCATE ON TABLE public.v_channel_provider_capability TO service_role;
GRANT UPDATE ON TABLE public.v_channel_provider_capability TO service_role;
GRANT DELETE ON TABLE public.v_channel_send_health TO service_role;
GRANT INSERT ON TABLE public.v_channel_send_health TO service_role;
GRANT MAINTAIN ON TABLE public.v_channel_send_health TO service_role;
GRANT REFERENCES ON TABLE public.v_channel_send_health TO service_role;
GRANT SELECT ON TABLE public.v_channel_send_health TO service_role;
GRANT TRIGGER ON TABLE public.v_channel_send_health TO service_role;
GRANT TRUNCATE ON TABLE public.v_channel_send_health TO service_role;
GRANT UPDATE ON TABLE public.v_channel_send_health TO service_role;
GRANT SELECT ON TABLE public.v_competitor_latest TO authenticated;
GRANT DELETE ON TABLE public.v_competitor_latest TO service_role;
GRANT INSERT ON TABLE public.v_competitor_latest TO service_role;
GRANT MAINTAIN ON TABLE public.v_competitor_latest TO service_role;
GRANT REFERENCES ON TABLE public.v_competitor_latest TO service_role;
GRANT SELECT ON TABLE public.v_competitor_latest TO service_role;
GRANT TRIGGER ON TABLE public.v_competitor_latest TO service_role;
GRANT TRUNCATE ON TABLE public.v_competitor_latest TO service_role;
GRANT UPDATE ON TABLE public.v_competitor_latest TO service_role;
GRANT SELECT ON TABLE public.v_conversations TO authenticated;
GRANT DELETE ON TABLE public.v_conversations TO service_role;
GRANT INSERT ON TABLE public.v_conversations TO service_role;
GRANT MAINTAIN ON TABLE public.v_conversations TO service_role;
GRANT REFERENCES ON TABLE public.v_conversations TO service_role;
GRANT SELECT ON TABLE public.v_conversations TO service_role;
GRANT TRIGGER ON TABLE public.v_conversations TO service_role;
GRANT TRUNCATE ON TABLE public.v_conversations TO service_role;
GRANT UPDATE ON TABLE public.v_conversations TO service_role;
GRANT SELECT ON TABLE public.v_customer_360 TO authenticated;
GRANT DELETE ON TABLE public.v_customer_360 TO service_role;
GRANT INSERT ON TABLE public.v_customer_360 TO service_role;
GRANT MAINTAIN ON TABLE public.v_customer_360 TO service_role;
GRANT REFERENCES ON TABLE public.v_customer_360 TO service_role;
GRANT SELECT ON TABLE public.v_customer_360 TO service_role;
GRANT TRIGGER ON TABLE public.v_customer_360 TO service_role;
GRANT TRUNCATE ON TABLE public.v_customer_360 TO service_role;
GRANT UPDATE ON TABLE public.v_customer_360 TO service_role;
GRANT SELECT ON TABLE public.v_customer_directory TO authenticated;
GRANT DELETE ON TABLE public.v_customer_directory TO service_role;
GRANT INSERT ON TABLE public.v_customer_directory TO service_role;
GRANT MAINTAIN ON TABLE public.v_customer_directory TO service_role;
GRANT REFERENCES ON TABLE public.v_customer_directory TO service_role;
GRANT SELECT ON TABLE public.v_customer_directory TO service_role;
GRANT TRIGGER ON TABLE public.v_customer_directory TO service_role;
GRANT TRUNCATE ON TABLE public.v_customer_directory TO service_role;
GRANT UPDATE ON TABLE public.v_customer_directory TO service_role;
GRANT SELECT ON TABLE public.v_deal_rescue TO authenticated;
GRANT DELETE ON TABLE public.v_deal_rescue TO service_role;
GRANT INSERT ON TABLE public.v_deal_rescue TO service_role;
GRANT MAINTAIN ON TABLE public.v_deal_rescue TO service_role;
GRANT REFERENCES ON TABLE public.v_deal_rescue TO service_role;
GRANT SELECT ON TABLE public.v_deal_rescue TO service_role;
GRANT TRIGGER ON TABLE public.v_deal_rescue TO service_role;
GRANT TRUNCATE ON TABLE public.v_deal_rescue TO service_role;
GRANT UPDATE ON TABLE public.v_deal_rescue TO service_role;
GRANT SELECT ON TABLE public.v_deal_rescue_candidates TO authenticated;
GRANT DELETE ON TABLE public.v_deal_rescue_candidates TO service_role;
GRANT INSERT ON TABLE public.v_deal_rescue_candidates TO service_role;
GRANT MAINTAIN ON TABLE public.v_deal_rescue_candidates TO service_role;
GRANT REFERENCES ON TABLE public.v_deal_rescue_candidates TO service_role;
GRANT SELECT ON TABLE public.v_deal_rescue_candidates TO service_role;
GRANT TRIGGER ON TABLE public.v_deal_rescue_candidates TO service_role;
GRANT TRUNCATE ON TABLE public.v_deal_rescue_candidates TO service_role;
GRANT UPDATE ON TABLE public.v_deal_rescue_candidates TO service_role;
GRANT SELECT ON TABLE public.v_deal_rescue_readiness TO authenticated;
GRANT DELETE ON TABLE public.v_deal_rescue_readiness TO service_role;
GRANT INSERT ON TABLE public.v_deal_rescue_readiness TO service_role;
GRANT MAINTAIN ON TABLE public.v_deal_rescue_readiness TO service_role;
GRANT REFERENCES ON TABLE public.v_deal_rescue_readiness TO service_role;
GRANT SELECT ON TABLE public.v_deal_rescue_readiness TO service_role;
GRANT TRIGGER ON TABLE public.v_deal_rescue_readiness TO service_role;
GRANT TRUNCATE ON TABLE public.v_deal_rescue_readiness TO service_role;
GRANT UPDATE ON TABLE public.v_deal_rescue_readiness TO service_role;
GRANT SELECT ON TABLE public.v_deal_rescue_state_model TO authenticated;
GRANT DELETE ON TABLE public.v_deal_rescue_state_model TO service_role;
GRANT INSERT ON TABLE public.v_deal_rescue_state_model TO service_role;
GRANT MAINTAIN ON TABLE public.v_deal_rescue_state_model TO service_role;
GRANT REFERENCES ON TABLE public.v_deal_rescue_state_model TO service_role;
GRANT SELECT ON TABLE public.v_deal_rescue_state_model TO service_role;
GRANT TRIGGER ON TABLE public.v_deal_rescue_state_model TO service_role;
GRANT TRUNCATE ON TABLE public.v_deal_rescue_state_model TO service_role;
GRANT UPDATE ON TABLE public.v_deal_rescue_state_model TO service_role;
GRANT SELECT ON TABLE public.v_fin_gate_quote_evidence TO authenticated;
GRANT DELETE ON TABLE public.v_fin_gate_quote_evidence TO service_role;
GRANT INSERT ON TABLE public.v_fin_gate_quote_evidence TO service_role;
GRANT MAINTAIN ON TABLE public.v_fin_gate_quote_evidence TO service_role;
GRANT REFERENCES ON TABLE public.v_fin_gate_quote_evidence TO service_role;
GRANT SELECT ON TABLE public.v_fin_gate_quote_evidence TO service_role;
GRANT TRIGGER ON TABLE public.v_fin_gate_quote_evidence TO service_role;
GRANT TRUNCATE ON TABLE public.v_fin_gate_quote_evidence TO service_role;
GRANT UPDATE ON TABLE public.v_fin_gate_quote_evidence TO service_role;
GRANT SELECT ON TABLE public.v_inventory_action_queue TO authenticated;
GRANT DELETE ON TABLE public.v_inventory_action_queue TO service_role;
GRANT INSERT ON TABLE public.v_inventory_action_queue TO service_role;
GRANT MAINTAIN ON TABLE public.v_inventory_action_queue TO service_role;
GRANT REFERENCES ON TABLE public.v_inventory_action_queue TO service_role;
GRANT SELECT ON TABLE public.v_inventory_action_queue TO service_role;
GRANT TRIGGER ON TABLE public.v_inventory_action_queue TO service_role;
GRANT TRUNCATE ON TABLE public.v_inventory_action_queue TO service_role;
GRANT UPDATE ON TABLE public.v_inventory_action_queue TO service_role;
GRANT SELECT ON TABLE public.v_inventory_action_timeline TO authenticated;
GRANT DELETE ON TABLE public.v_inventory_action_timeline TO service_role;
GRANT INSERT ON TABLE public.v_inventory_action_timeline TO service_role;
GRANT MAINTAIN ON TABLE public.v_inventory_action_timeline TO service_role;
GRANT REFERENCES ON TABLE public.v_inventory_action_timeline TO service_role;
GRANT SELECT ON TABLE public.v_inventory_action_timeline TO service_role;
GRANT TRIGGER ON TABLE public.v_inventory_action_timeline TO service_role;
GRANT TRUNCATE ON TABLE public.v_inventory_action_timeline TO service_role;
GRANT UPDATE ON TABLE public.v_inventory_action_timeline TO service_role;
GRANT SELECT ON TABLE public.v_inventory_profit_sentinel TO authenticated;
GRANT DELETE ON TABLE public.v_inventory_profit_sentinel TO service_role;
GRANT INSERT ON TABLE public.v_inventory_profit_sentinel TO service_role;
GRANT MAINTAIN ON TABLE public.v_inventory_profit_sentinel TO service_role;
GRANT REFERENCES ON TABLE public.v_inventory_profit_sentinel TO service_role;
GRANT SELECT ON TABLE public.v_inventory_profit_sentinel TO service_role;
GRANT TRIGGER ON TABLE public.v_inventory_profit_sentinel TO service_role;
GRANT TRUNCATE ON TABLE public.v_inventory_profit_sentinel TO service_role;
GRANT UPDATE ON TABLE public.v_inventory_profit_sentinel TO service_role;
GRANT SELECT ON TABLE public.v_inventory_sales TO authenticated;
GRANT DELETE ON TABLE public.v_inventory_sales TO service_role;
GRANT INSERT ON TABLE public.v_inventory_sales TO service_role;
GRANT MAINTAIN ON TABLE public.v_inventory_sales TO service_role;
GRANT REFERENCES ON TABLE public.v_inventory_sales TO service_role;
GRANT SELECT ON TABLE public.v_inventory_sales TO service_role;
GRANT TRIGGER ON TABLE public.v_inventory_sales TO service_role;
GRANT TRUNCATE ON TABLE public.v_inventory_sales TO service_role;
GRANT UPDATE ON TABLE public.v_inventory_sales TO service_role;
GRANT SELECT ON TABLE public.v_lead_messages TO authenticated;
GRANT DELETE ON TABLE public.v_lead_messages TO service_role;
GRANT INSERT ON TABLE public.v_lead_messages TO service_role;
GRANT MAINTAIN ON TABLE public.v_lead_messages TO service_role;
GRANT REFERENCES ON TABLE public.v_lead_messages TO service_role;
GRANT SELECT ON TABLE public.v_lead_messages TO service_role;
GRANT TRIGGER ON TABLE public.v_lead_messages TO service_role;
GRANT TRUNCATE ON TABLE public.v_lead_messages TO service_role;
GRANT UPDATE ON TABLE public.v_lead_messages TO service_role;
GRANT SELECT ON TABLE public.v_lead_recovery TO authenticated;
GRANT DELETE ON TABLE public.v_lead_recovery TO service_role;
GRANT INSERT ON TABLE public.v_lead_recovery TO service_role;
GRANT MAINTAIN ON TABLE public.v_lead_recovery TO service_role;
GRANT REFERENCES ON TABLE public.v_lead_recovery TO service_role;
GRANT SELECT ON TABLE public.v_lead_recovery TO service_role;
GRANT TRIGGER ON TABLE public.v_lead_recovery TO service_role;
GRANT TRUNCATE ON TABLE public.v_lead_recovery TO service_role;
GRANT UPDATE ON TABLE public.v_lead_recovery TO service_role;
GRANT SELECT ON TABLE public.v_lead_recovery_coverage TO authenticated;
GRANT DELETE ON TABLE public.v_lead_recovery_coverage TO service_role;
GRANT INSERT ON TABLE public.v_lead_recovery_coverage TO service_role;
GRANT MAINTAIN ON TABLE public.v_lead_recovery_coverage TO service_role;
GRANT REFERENCES ON TABLE public.v_lead_recovery_coverage TO service_role;
GRANT SELECT ON TABLE public.v_lead_recovery_coverage TO service_role;
GRANT TRIGGER ON TABLE public.v_lead_recovery_coverage TO service_role;
GRANT TRUNCATE ON TABLE public.v_lead_recovery_coverage TO service_role;
GRANT UPDATE ON TABLE public.v_lead_recovery_coverage TO service_role;
GRANT SELECT ON TABLE public.v_lead_recovery_health TO authenticated;
GRANT DELETE ON TABLE public.v_lead_recovery_health TO service_role;
GRANT INSERT ON TABLE public.v_lead_recovery_health TO service_role;
GRANT MAINTAIN ON TABLE public.v_lead_recovery_health TO service_role;
GRANT REFERENCES ON TABLE public.v_lead_recovery_health TO service_role;
GRANT SELECT ON TABLE public.v_lead_recovery_health TO service_role;
GRANT TRIGGER ON TABLE public.v_lead_recovery_health TO service_role;
GRANT TRUNCATE ON TABLE public.v_lead_recovery_health TO service_role;
GRANT UPDATE ON TABLE public.v_lead_recovery_health TO service_role;
GRANT SELECT ON TABLE public.v_lead_recovery_queue TO authenticated;
GRANT DELETE ON TABLE public.v_lead_recovery_queue TO service_role;
GRANT INSERT ON TABLE public.v_lead_recovery_queue TO service_role;
GRANT MAINTAIN ON TABLE public.v_lead_recovery_queue TO service_role;
GRANT REFERENCES ON TABLE public.v_lead_recovery_queue TO service_role;
GRANT SELECT ON TABLE public.v_lead_recovery_queue TO service_role;
GRANT TRIGGER ON TABLE public.v_lead_recovery_queue TO service_role;
GRANT TRUNCATE ON TABLE public.v_lead_recovery_queue TO service_role;
GRANT UPDATE ON TABLE public.v_lead_recovery_queue TO service_role;
GRANT SELECT ON TABLE public.v_lead_recovery_state_model TO authenticated;
GRANT DELETE ON TABLE public.v_lead_recovery_state_model TO service_role;
GRANT INSERT ON TABLE public.v_lead_recovery_state_model TO service_role;
GRANT MAINTAIN ON TABLE public.v_lead_recovery_state_model TO service_role;
GRANT REFERENCES ON TABLE public.v_lead_recovery_state_model TO service_role;
GRANT SELECT ON TABLE public.v_lead_recovery_state_model TO service_role;
GRANT TRIGGER ON TABLE public.v_lead_recovery_state_model TO service_role;
GRANT TRUNCATE ON TABLE public.v_lead_recovery_state_model TO service_role;
GRANT UPDATE ON TABLE public.v_lead_recovery_state_model TO service_role;
GRANT SELECT ON TABLE public.v_needs_attention TO authenticated;
GRANT DELETE ON TABLE public.v_needs_attention TO service_role;
GRANT INSERT ON TABLE public.v_needs_attention TO service_role;
GRANT MAINTAIN ON TABLE public.v_needs_attention TO service_role;
GRANT REFERENCES ON TABLE public.v_needs_attention TO service_role;
GRANT SELECT ON TABLE public.v_needs_attention TO service_role;
GRANT TRIGGER ON TABLE public.v_needs_attention TO service_role;
GRANT TRUNCATE ON TABLE public.v_needs_attention TO service_role;
GRANT UPDATE ON TABLE public.v_needs_attention TO service_role;
GRANT SELECT ON TABLE public.v_policy_authoritative TO authenticated;
GRANT DELETE ON TABLE public.v_policy_authoritative TO service_role;
GRANT INSERT ON TABLE public.v_policy_authoritative TO service_role;
GRANT MAINTAIN ON TABLE public.v_policy_authoritative TO service_role;
GRANT REFERENCES ON TABLE public.v_policy_authoritative TO service_role;
GRANT SELECT ON TABLE public.v_policy_authoritative TO service_role;
GRANT TRIGGER ON TABLE public.v_policy_authoritative TO service_role;
GRANT TRUNCATE ON TABLE public.v_policy_authoritative TO service_role;
GRANT UPDATE ON TABLE public.v_policy_authoritative TO service_role;
GRANT SELECT ON TABLE public.v_policy_rule TO authenticated;
GRANT DELETE ON TABLE public.v_policy_rule TO service_role;
GRANT INSERT ON TABLE public.v_policy_rule TO service_role;
GRANT MAINTAIN ON TABLE public.v_policy_rule TO service_role;
GRANT REFERENCES ON TABLE public.v_policy_rule TO service_role;
GRANT SELECT ON TABLE public.v_policy_rule TO service_role;
GRANT TRIGGER ON TABLE public.v_policy_rule TO service_role;
GRANT TRUNCATE ON TABLE public.v_policy_rule TO service_role;
GRANT UPDATE ON TABLE public.v_policy_rule TO service_role;
GRANT SELECT ON TABLE public.v_policy_rule_history TO authenticated;
GRANT DELETE ON TABLE public.v_policy_rule_history TO service_role;
GRANT INSERT ON TABLE public.v_policy_rule_history TO service_role;
GRANT MAINTAIN ON TABLE public.v_policy_rule_history TO service_role;
GRANT REFERENCES ON TABLE public.v_policy_rule_history TO service_role;
GRANT SELECT ON TABLE public.v_policy_rule_history TO service_role;
GRANT TRIGGER ON TABLE public.v_policy_rule_history TO service_role;
GRANT TRUNCATE ON TABLE public.v_policy_rule_history TO service_role;
GRANT UPDATE ON TABLE public.v_policy_rule_history TO service_role;
GRANT SELECT ON TABLE public.v_policy_unmigrated_constant TO authenticated;
GRANT DELETE ON TABLE public.v_policy_unmigrated_constant TO service_role;
GRANT INSERT ON TABLE public.v_policy_unmigrated_constant TO service_role;
GRANT MAINTAIN ON TABLE public.v_policy_unmigrated_constant TO service_role;
GRANT REFERENCES ON TABLE public.v_policy_unmigrated_constant TO service_role;
GRANT SELECT ON TABLE public.v_policy_unmigrated_constant TO service_role;
GRANT TRIGGER ON TABLE public.v_policy_unmigrated_constant TO service_role;
GRANT TRUNCATE ON TABLE public.v_policy_unmigrated_constant TO service_role;
GRANT UPDATE ON TABLE public.v_policy_unmigrated_constant TO service_role;
GRANT SELECT ON TABLE public.v_team_performance TO authenticated;
GRANT DELETE ON TABLE public.v_team_performance TO service_role;
GRANT INSERT ON TABLE public.v_team_performance TO service_role;
GRANT MAINTAIN ON TABLE public.v_team_performance TO service_role;
GRANT REFERENCES ON TABLE public.v_team_performance TO service_role;
GRANT SELECT ON TABLE public.v_team_performance TO service_role;
GRANT TRIGGER ON TABLE public.v_team_performance TO service_role;
GRANT TRUNCATE ON TABLE public.v_team_performance TO service_role;
GRANT UPDATE ON TABLE public.v_team_performance TO service_role;
GRANT DELETE ON TABLE public.v_whatsapp_conversation_window TO service_role;
GRANT INSERT ON TABLE public.v_whatsapp_conversation_window TO service_role;
GRANT MAINTAIN ON TABLE public.v_whatsapp_conversation_window TO service_role;
GRANT REFERENCES ON TABLE public.v_whatsapp_conversation_window TO service_role;
GRANT SELECT ON TABLE public.v_whatsapp_conversation_window TO service_role;
GRANT TRIGGER ON TABLE public.v_whatsapp_conversation_window TO service_role;
GRANT TRUNCATE ON TABLE public.v_whatsapp_conversation_window TO service_role;
GRANT UPDATE ON TABLE public.v_whatsapp_conversation_window TO service_role;
GRANT SELECT ON TABLE public.v_whatsapp_message_usage TO authenticated;
GRANT DELETE ON TABLE public.v_whatsapp_message_usage TO service_role;
GRANT INSERT ON TABLE public.v_whatsapp_message_usage TO service_role;
GRANT MAINTAIN ON TABLE public.v_whatsapp_message_usage TO service_role;
GRANT REFERENCES ON TABLE public.v_whatsapp_message_usage TO service_role;
GRANT SELECT ON TABLE public.v_whatsapp_message_usage TO service_role;
GRANT TRIGGER ON TABLE public.v_whatsapp_message_usage TO service_role;
GRANT TRUNCATE ON TABLE public.v_whatsapp_message_usage TO service_role;
GRANT UPDATE ON TABLE public.v_whatsapp_message_usage TO service_role;
GRANT SELECT ON TABLE public.v_whatsapp_messaging_usage_monthly TO authenticated;
GRANT DELETE ON TABLE public.v_whatsapp_messaging_usage_monthly TO service_role;
GRANT INSERT ON TABLE public.v_whatsapp_messaging_usage_monthly TO service_role;
GRANT MAINTAIN ON TABLE public.v_whatsapp_messaging_usage_monthly TO service_role;
GRANT REFERENCES ON TABLE public.v_whatsapp_messaging_usage_monthly TO service_role;
GRANT SELECT ON TABLE public.v_whatsapp_messaging_usage_monthly TO service_role;
GRANT TRIGGER ON TABLE public.v_whatsapp_messaging_usage_monthly TO service_role;
GRANT TRUNCATE ON TABLE public.v_whatsapp_messaging_usage_monthly TO service_role;
GRANT UPDATE ON TABLE public.v_whatsapp_messaging_usage_monthly TO service_role;
GRANT SELECT ON TABLE public.v_whatsapp_template_registry TO authenticated;
GRANT DELETE ON TABLE public.v_whatsapp_template_registry TO service_role;
GRANT INSERT ON TABLE public.v_whatsapp_template_registry TO service_role;
GRANT MAINTAIN ON TABLE public.v_whatsapp_template_registry TO service_role;
GRANT REFERENCES ON TABLE public.v_whatsapp_template_registry TO service_role;
GRANT SELECT ON TABLE public.v_whatsapp_template_registry TO service_role;
GRANT TRIGGER ON TABLE public.v_whatsapp_template_registry TO service_role;
GRANT TRUNCATE ON TABLE public.v_whatsapp_template_registry TO service_role;
GRANT UPDATE ON TABLE public.v_whatsapp_template_registry TO service_role;
GRANT SELECT ON TABLE public.v_workflow_health TO authenticated;
GRANT DELETE ON TABLE public.v_workflow_health TO service_role;
GRANT INSERT ON TABLE public.v_workflow_health TO service_role;
GRANT MAINTAIN ON TABLE public.v_workflow_health TO service_role;
GRANT REFERENCES ON TABLE public.v_workflow_health TO service_role;
GRANT SELECT ON TABLE public.v_workflow_health TO service_role;
GRANT TRIGGER ON TABLE public.v_workflow_health TO service_role;
GRANT TRUNCATE ON TABLE public.v_workflow_health TO service_role;
GRANT UPDATE ON TABLE public.v_workflow_health TO service_role;
GRANT SELECT ON TABLE public.whatsapp_contacts TO authenticated;
GRANT DELETE ON TABLE public.whatsapp_contacts TO service_role;
GRANT INSERT ON TABLE public.whatsapp_contacts TO service_role;
GRANT MAINTAIN ON TABLE public.whatsapp_contacts TO service_role;
GRANT REFERENCES ON TABLE public.whatsapp_contacts TO service_role;
GRANT SELECT ON TABLE public.whatsapp_contacts TO service_role;
GRANT TRIGGER ON TABLE public.whatsapp_contacts TO service_role;
GRANT TRUNCATE ON TABLE public.whatsapp_contacts TO service_role;
GRANT UPDATE ON TABLE public.whatsapp_contacts TO service_role;
GRANT DELETE ON TABLE public.whatsapp_conversation_state TO service_role;
GRANT INSERT ON TABLE public.whatsapp_conversation_state TO service_role;
GRANT MAINTAIN ON TABLE public.whatsapp_conversation_state TO service_role;
GRANT REFERENCES ON TABLE public.whatsapp_conversation_state TO service_role;
GRANT SELECT ON TABLE public.whatsapp_conversation_state TO service_role;
GRANT TRIGGER ON TABLE public.whatsapp_conversation_state TO service_role;
GRANT TRUNCATE ON TABLE public.whatsapp_conversation_state TO service_role;
GRANT UPDATE ON TABLE public.whatsapp_conversation_state TO service_role;
GRANT DELETE ON TABLE public.whatsapp_customer_message_seen TO service_role;
GRANT INSERT ON TABLE public.whatsapp_customer_message_seen TO service_role;
GRANT MAINTAIN ON TABLE public.whatsapp_customer_message_seen TO service_role;
GRANT REFERENCES ON TABLE public.whatsapp_customer_message_seen TO service_role;
GRANT SELECT ON TABLE public.whatsapp_customer_message_seen TO service_role;
GRANT TRIGGER ON TABLE public.whatsapp_customer_message_seen TO service_role;
GRANT TRUNCATE ON TABLE public.whatsapp_customer_message_seen TO service_role;
GRANT UPDATE ON TABLE public.whatsapp_customer_message_seen TO service_role;
GRANT DELETE ON TABLE public.whatsapp_delivery_events TO service_role;
GRANT INSERT ON TABLE public.whatsapp_delivery_events TO service_role;
GRANT MAINTAIN ON TABLE public.whatsapp_delivery_events TO service_role;
GRANT REFERENCES ON TABLE public.whatsapp_delivery_events TO service_role;
GRANT SELECT ON TABLE public.whatsapp_delivery_events TO service_role;
GRANT TRIGGER ON TABLE public.whatsapp_delivery_events TO service_role;
GRANT TRUNCATE ON TABLE public.whatsapp_delivery_events TO service_role;
GRANT UPDATE ON TABLE public.whatsapp_delivery_events TO service_role;
GRANT DELETE ON TABLE public.whatsapp_message_intent TO service_role;
GRANT INSERT ON TABLE public.whatsapp_message_intent TO service_role;
GRANT MAINTAIN ON TABLE public.whatsapp_message_intent TO service_role;
GRANT REFERENCES ON TABLE public.whatsapp_message_intent TO service_role;
GRANT SELECT ON TABLE public.whatsapp_message_intent TO service_role;
GRANT TRIGGER ON TABLE public.whatsapp_message_intent TO service_role;
GRANT TRUNCATE ON TABLE public.whatsapp_message_intent TO service_role;
GRANT UPDATE ON TABLE public.whatsapp_message_intent TO service_role;
GRANT SELECT ON TABLE public.whatsapp_message_usage TO authenticated;
GRANT DELETE ON TABLE public.whatsapp_message_usage TO service_role;
GRANT INSERT ON TABLE public.whatsapp_message_usage TO service_role;
GRANT MAINTAIN ON TABLE public.whatsapp_message_usage TO service_role;
GRANT REFERENCES ON TABLE public.whatsapp_message_usage TO service_role;
GRANT SELECT ON TABLE public.whatsapp_message_usage TO service_role;
GRANT TRIGGER ON TABLE public.whatsapp_message_usage TO service_role;
GRANT TRUNCATE ON TABLE public.whatsapp_message_usage TO service_role;
GRANT UPDATE ON TABLE public.whatsapp_message_usage TO service_role;
GRANT DELETE ON TABLE public.whatsapp_opt_in_event TO service_role;
GRANT INSERT ON TABLE public.whatsapp_opt_in_event TO service_role;
GRANT MAINTAIN ON TABLE public.whatsapp_opt_in_event TO service_role;
GRANT REFERENCES ON TABLE public.whatsapp_opt_in_event TO service_role;
GRANT SELECT ON TABLE public.whatsapp_opt_in_event TO service_role;
GRANT TRIGGER ON TABLE public.whatsapp_opt_in_event TO service_role;
GRANT TRUNCATE ON TABLE public.whatsapp_opt_in_event TO service_role;
GRANT UPDATE ON TABLE public.whatsapp_opt_in_event TO service_role;
GRANT SELECT ON TABLE public.whatsapp_templates TO authenticated;
GRANT DELETE ON TABLE public.whatsapp_templates TO service_role;
GRANT INSERT ON TABLE public.whatsapp_templates TO service_role;
GRANT MAINTAIN ON TABLE public.whatsapp_templates TO service_role;
GRANT REFERENCES ON TABLE public.whatsapp_templates TO service_role;
GRANT SELECT ON TABLE public.whatsapp_templates TO service_role;
GRANT TRIGGER ON TABLE public.whatsapp_templates TO service_role;
GRANT TRUNCATE ON TABLE public.whatsapp_templates TO service_role;
GRANT UPDATE ON TABLE public.whatsapp_templates TO service_role;
GRANT SELECT ON TABLE public.workflow_registry TO authenticated;
GRANT DELETE ON TABLE public.workflow_registry TO service_role;
GRANT INSERT ON TABLE public.workflow_registry TO service_role;
GRANT MAINTAIN ON TABLE public.workflow_registry TO service_role;
GRANT REFERENCES ON TABLE public.workflow_registry TO service_role;
GRANT SELECT ON TABLE public.workflow_registry TO service_role;
GRANT TRIGGER ON TABLE public.workflow_registry TO service_role;
GRANT TRUNCATE ON TABLE public.workflow_registry TO service_role;
GRANT UPDATE ON TABLE public.workflow_registry TO service_role;


-- ========================================================================
-- 17. GRANTS — COLUMN LEVEL
-- A relacl-only dump misses these entirely. Production genuinely uses them.
-- ========================================================================
GRANT SELECT(channel_type) ON TABLE public.channel_registry TO authenticated;
GRANT SELECT(created_at) ON TABLE public.channel_registry TO authenticated;
GRANT SELECT(external_identifier) ON TABLE public.channel_registry TO authenticated;
GRANT SELECT(integration_id) ON TABLE public.channel_registry TO authenticated;
GRANT SELECT(status) ON TABLE public.channel_registry TO authenticated;
GRANT SELECT(tenant_id) ON TABLE public.channel_registry TO authenticated;
GRANT SELECT(updated_at) ON TABLE public.channel_registry TO authenticated;
GRANT SELECT(attestation_id) ON TABLE public.policy_platform_attestation TO authenticated;
GRANT SELECT(attested_at) ON TABLE public.policy_platform_attestation TO authenticated;
GRANT SELECT(attested_by) ON TABLE public.policy_platform_attestation TO authenticated;
GRANT SELECT(confidence) ON TABLE public.policy_platform_attestation TO authenticated;
GRANT SELECT(notes) ON TABLE public.policy_platform_attestation TO authenticated;
GRANT SELECT(rule_id) ON TABLE public.policy_platform_attestation TO authenticated;
GRANT SELECT(source_kind) ON TABLE public.policy_platform_attestation TO authenticated;
GRANT SELECT(source_name) ON TABLE public.policy_platform_attestation TO authenticated;
GRANT SELECT(source_observed_on) ON TABLE public.policy_platform_attestation TO authenticated;
GRANT SELECT(source_ref) ON TABLE public.policy_platform_attestation TO authenticated;


-- ========================================================================
-- 18. GRANTS — functions
-- ========================================================================
GRANT EXECUTE ON FUNCTION public.action_approver_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.action_approver_context() TO service_role;
GRANT EXECUTE ON FUNCTION public.action_cancel(p_action_id uuid, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.action_cancel(p_action_id uuid, p_note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.action_decide(p_action_id uuid, p_decision text, p_reason_code text, p_note text, p_defer_until date, p_assign_staff_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.action_decide(p_action_id uuid, p_decision text, p_reason_code text, p_note text, p_defer_until date, p_assign_staff_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.action_mark_executed(p_action_id uuid, p_note text, p_failed boolean, p_failure text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.action_mark_executed(p_action_id uuid, p_note text, p_failed boolean, p_failure text) TO service_role;
GRANT EXECUTE ON FUNCTION public.action_mark_not_attributable(p_action_id uuid, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.action_mark_not_attributable(p_action_id uuid, p_note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.action_outcome_candidates(p_action_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.action_outcome_candidates(p_action_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.action_propose(p_unit_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.action_propose(p_unit_id text) TO service_role;
GRANT EXECUTE ON FUNCTION public.action_record_outcome(p_action_id uuid, p_purchase_id uuid, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.action_record_outcome(p_action_id uuid, p_purchase_id uuid, p_note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.action_write_audit(p_tenant uuid, p_action_id uuid, p_unit_id text, p_rec text, p_status text, p_summary text) TO service_role;
GRANT EXECUTE ON FUNCTION public.assign_hot_lead() TO service_role;
GRANT EXECUTE ON FUNCTION public.capture_daily_metrics() TO service_role;
GRANT EXECUTE ON FUNCTION public.channel_registry_touch() TO service_role;
GRANT EXECUTE ON FUNCTION public.deal_rescue_recommended_action(p_state text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deal_rescue_recommended_action(p_state text) TO service_role;
GRANT EXECUTE ON FUNCTION public.deal_rescue_state(p_evidence_tier text, p_has_confirmed_sale boolean, p_lead_is_open boolean, p_silence_state text, p_days_since_movement numeric, p_at_risk_days integer, p_stalled_days integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deal_rescue_state(p_evidence_tier text, p_has_confirmed_sale boolean, p_lead_is_open boolean, p_silence_state text, p_days_since_movement numeric, p_at_risk_days integer, p_stalled_days integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.inventory_actions_touch() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.inventory_actions_touch() TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_recovery_cancel(p_action_id uuid, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_recovery_cancel(p_action_id uuid, p_note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_recovery_decide(p_action_id uuid, p_decision text, p_reason_code text, p_note text, p_defer_until date, p_assign_staff_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_recovery_decide(p_action_id uuid, p_decision text, p_reason_code text, p_note text, p_defer_until date, p_assign_staff_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_recovery_mark_executed(p_action_id uuid, p_note text, p_failed boolean, p_failure text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_recovery_mark_executed(p_action_id uuid, p_note text, p_failed boolean, p_failure text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_recovery_mark_not_attributable(p_action_id uuid, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_recovery_mark_not_attributable(p_action_id uuid, p_note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_recovery_outcome_candidates(p_action_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_recovery_outcome_candidates(p_action_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_recovery_propose(p_lead_id integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_recovery_propose(p_lead_id integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_recovery_recommended_action(p_state text, p_risk text, p_has_owner boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_recovery_recommended_action(p_state text, p_risk text, p_has_owner boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_recovery_record_outcome(p_action_id uuid, p_purchase_id uuid, p_note text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_recovery_record_outcome(p_action_id uuid, p_purchase_id uuid, p_note text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_recovery_risk(p_state text, p_minutes_since_inbound numeric, p_hours_since_outbound numeric, p_sla_minutes integer, p_stale_hours integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_recovery_risk(p_state text, p_minutes_since_inbound numeric, p_hours_since_outbound numeric, p_sla_minutes integer, p_stale_hours integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_recovery_state(p_sales_recorded bigint, p_lead_is_open boolean, p_messages bigint, p_escalated_at timestamp with time zone, p_last_message_at timestamp with time zone, p_last_inbound_at timestamp with time zone, p_last_outbound_at timestamp with time zone, p_hours_since_outbound numeric, p_silence_hours integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_recovery_state(p_sales_recorded bigint, p_lead_is_open boolean, p_messages bigint, p_escalated_at timestamp with time zone, p_last_message_at timestamp with time zone, p_last_inbound_at timestamp with time zone, p_last_outbound_at timestamp with time zone, p_hours_since_outbound numeric, p_silence_hours integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.lead_recovery_write_audit(p_tenant uuid, p_action_id uuid, p_lead_id integer, p_rec text, p_status text, p_summary text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_channel_capability_state(p_provider text, p_send_form text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_channel_send_candidates(p_tenant_id uuid, p_send_form text, p_customer_external_id text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_comm_keys_for_lead(p_email text, p_phone text, p_tenant uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_comm_keys_for_lead(p_email text, p_phone text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_current_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexus_current_tenant_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_current_tenant_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexus_current_tenant_ids() TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_default_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexus_default_tenant_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_is_approval_rules(p jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_is_business_hours(p jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_is_followup_policy(p jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_is_message(p_direction text, p_channel text, p_message text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexus_is_message(p_direction text, p_channel text, p_message text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_is_reply(p_direction text, p_channel text, p_message text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexus_is_reply(p_direction text, p_channel text, p_message text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_jwt_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexus_jwt_tenant_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_kyc_object_tenant(p_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexus_kyc_object_tenant(p_name text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_lead_for_comm_key(p_key text, p_tenant uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_lead_for_comm_key(p_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_lead_is_open(p_status text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexus_lead_is_open(p_status text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_mark_first_response() TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_model_tokens(txt text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexus_model_tokens(txt text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_my_tenant_capabilities() TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexus_my_tenant_capabilities() TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_my_tenant_config() TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexus_my_tenant_config() TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_onboard_dealership(p_slug text, p_name text, p_owner_email text, p_owner_role text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_outcome_class(p_workflow text, p_status text, p_summary text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexus_outcome_class(p_workflow text, p_status text, p_summary text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_provider_router_invariants() TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_record_channel_event(p_integration_id uuid, p_direction text, p_external_message_id text, p_origin_verified text, p_received_at timestamp with time zone, p_customer_external_id text, p_customer_phone text, p_conversation_id text, p_message_kind text, p_media_ref text, p_media_mime text, p_media_sha256 text, p_provider_account_id text, p_provider_delivery_ref text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_record_send_result(p_directive_id uuid, p_result text, p_provider_message_id text, p_error_code text, p_error_detail text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_register_channel(p_tenant_slug text, p_channel_type text, p_external_identifier text, p_credential_ref text, p_status text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_request_send(p_tenant_id uuid, p_customer_external_id text, p_intent text, p_send_form text, p_message_body text, p_template_ref text, p_template_variables jsonb, p_media_ref text, p_media_mime text, p_requested_by text, p_request_ref text, p_as_of timestamp with time zone, p_max_template_status_age interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_require_security_invoker_views() TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexus_require_security_invoker_views() TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_resolve_channel_tenant(p_channel_type text, p_external_identifier text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_resolve_tenant_capability(p_tenant_id uuid, p_capability_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_resolve_tenant_config(p_tenant_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_route_message(p_tenant_id uuid, p_customer_external_id text, p_intent text, p_send_form text, p_message_body text, p_template_ref text, p_template_variables jsonb, p_media_ref text, p_media_mime text, p_requested_by text, p_as_of timestamp with time zone, p_max_template_status_age interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_scoped_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexus_scoped_tenant_id() TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_tenancy_readiness() TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_verify_template_ref(p_tenant_id uuid, p_provider text, p_template_ref text, p_required_category text, p_max_status_age interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.nexus_whatsapp_cloud_canonical_events(p_payload jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_authority(p_status text, p_verification_status text, p_effective_from date, p_effective_to date, p_as_of date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.policy_authority(p_status text, p_verification_status text, p_effective_from date, p_effective_to date, p_as_of date) TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_citation(p_jurisdiction text, p_rule_type text, p_rule_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.policy_citation(p_jurisdiction text, p_rule_type text, p_rule_name text) TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_numeric(p_jurisdiction text, p_rule_type text, p_rule_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.policy_numeric(p_jurisdiction text, p_rule_type text, p_rule_name text) TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_numeric_as_of(p_jurisdiction text, p_rule_type text, p_rule_name text, p_as_of date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.policy_numeric_as_of(p_jurisdiction text, p_rule_type text, p_rule_name text, p_as_of date) TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_platform_attestation_append_only() TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_platform_supersede_rule(p_rule_id uuid, p_effective_from date, p_source_name text, p_changed_by text, p_value_numeric numeric, p_value_text text, p_source_ref text, p_notes text) TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_platform_verify_rule(p_rule_id uuid, p_attested_by text, p_attested_by_contact text, p_source_kind text, p_source_name text, p_source_ref text, p_source_observed_on date, p_effective_from date, p_confidence text, p_account_ref text, p_notes text) TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_propose_rule(p_jurisdiction text, p_rule_type text, p_rule_name text, p_unit text, p_source_name text, p_value_numeric numeric, p_value_text text, p_source_url text, p_source_document text, p_effective_from date, p_notes text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.policy_propose_rule(p_jurisdiction text, p_rule_type text, p_rule_name text, p_unit text, p_source_name text, p_value_numeric numeric, p_value_text text, p_source_url text, p_source_document text, p_effective_from date, p_notes text) TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_read_unverified_rule(p_jurisdiction text, p_rule_type text, p_rule_name text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.policy_read_unverified_rule(p_jurisdiction text, p_rule_type text, p_rule_name text) TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_refuse(p_code text, p_reason text, p_hint text) TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_rule_derive_jurisdiction_owner() TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_rule_event_append_only() TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_rule_guard_immutability() TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_rule_guard_one_active() TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_supersede_rule(p_rule_id uuid, p_effective_from date, p_source_name text, p_value_numeric numeric, p_value_text text, p_source_url text, p_source_document text, p_notes text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.policy_supersede_rule(p_rule_id uuid, p_effective_from date, p_source_name text, p_value_numeric numeric, p_value_text text, p_source_url text, p_source_document text, p_notes text) TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_verify_rule(p_rule_id uuid, p_source_name text, p_source_url text, p_source_document text, p_effective_from date, p_confidence text, p_notes text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.policy_verify_rule(p_rule_id uuid, p_source_name text, p_source_url text, p_source_document text, p_effective_from date, p_confidence text, p_notes text) TO service_role;
GRANT EXECUTE ON FUNCTION public.policy_withdraw_rule(p_rule_id uuid, p_reason text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.policy_withdraw_rule(p_rule_id uuid, p_reason text) TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_inventory_derived() TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_inventory_derived() TO service_role;
GRANT EXECUTE ON FUNCTION public.search_rag_documents(q text, match_limit integer, p_tenant uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_rag_documents(q text, match_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_rag_documents(q text, match_limit integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.search_rag_documents(q text, match_limit integer, p_tenant uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sentinel_inventory_actions(p_recommendation text, p_min_risk_rank integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sentinel_inventory_actions(p_recommendation text, p_min_risk_rank integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.tenant_capability_touch() TO service_role;
GRANT EXECUTE ON FUNCTION public.tenant_configuration_validate() TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_apply_delivery_to_usage(p_delivery_event_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_delivery_events_append_only() TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_delivery_events_guard_link() TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_delivery_status_rank(p_status text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_link_delivery_events(p_integration_id uuid, p_limit integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_message_usage_touch() TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_opt_in_event_append_only() TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_policy_decision(p_tenant_id uuid, p_integration_id uuid, p_customer_wa_id text, p_intent text, p_as_of timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_policy_decision_for_channel(p_channel_type text, p_external_identifier text, p_customer_wa_id text, p_intent text, p_as_of timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_policy_rule_lookup(p_tenant_id uuid, p_jurisdiction text, p_rule_name text, p_as_of date) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_record_customer_message(p_tenant_id uuid, p_integration_id uuid, p_customer_wa_id text, p_occurred_at timestamp with time zone, p_external_message_id text, p_source text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_record_delivery_status(p_integration_id uuid, p_provider_message_id text, p_status_raw text, p_status_at timestamp with time zone, p_provider_payload jsonb, p_recipient_wa_id text, p_conversation_id text, p_conversation_origin_type text, p_conversation_expiration_at timestamp with time zone, p_pricing_billable boolean, p_pricing_model text, p_pricing_category text, p_pricing_type text, p_errors jsonb, p_received_at timestamp with time zone) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_record_message_usage(p_event_id uuid, p_message_category text, p_policy_decision text, p_policy_reason_code text, p_policy_rule_verification_status text, p_policy_decided_at timestamp with time zone, p_sent_at timestamp with time zone, p_policy_rule_id uuid, p_policy_rule_name text, p_template_id uuid, p_template_provider_status_at_send text, p_template_status_age_at_send interval, p_template_staleness_verdict_at_send text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_record_opt_in_event(p_tenant_id uuid, p_integration_id uuid, p_customer_wa_id text, p_event text, p_occurred_at timestamp with time zone, p_mechanism text, p_evidence_kind text, p_evidence_ref text, p_recorded_by text, p_notes text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_refuse_end_user_role(p_fn text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_template_declare(p_integration_id uuid, p_name text, p_language text, p_category text, p_body_text text, p_variable_schema jsonb, p_declared_by text, p_waba_ref text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_template_observe(p_integration_id uuid, p_name text, p_language text, p_provider_status_raw text, p_source text, p_observed_at timestamp with time zone, p_category text, p_provider_template_id text, p_waba_ref text, p_evidence_ref text, p_rejected_reason text, p_body_text text, p_variable_schema jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_template_retire(p_template_id uuid, p_by text) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_template_sendability(p_template_id uuid, p_max_status_age interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_template_variable_schema_ok(p jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_templates_guard_channel() TO service_role;
GRANT EXECUTE ON FUNCTION public.whatsapp_templates_touch() TO service_role;


-- ========================================================================
-- 19. GRANTS — types
-- ========================================================================
GRANT USAGE ON TYPE public.whatsapp_policy_decision_row TO postgres;
GRANT USAGE ON TYPE public.whatsapp_policy_decision_row TO service_role;
GRANT USAGE ON TYPE public.whatsapp_template_sendability_row TO postgres;
GRANT USAGE ON TYPE public.whatsapp_template_sendability_row TO service_role;


-- ========================================================================
-- 20. DEFAULT PRIVILEGES — the postgres line
-- anon is absent here on purpose: production removed it. The REVOKE above is what removes it on a stock project, and is the whole reason this section is not GRANT-only.
-- ========================================================================
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT INSERT ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT MAINTAIN ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRIGGER ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT INSERT ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT MAINTAIN ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRIGGER ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT INSERT ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT MAINTAIN ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRIGGER ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT UPDATE ON TABLES TO service_role;


-- ========================================================================
-- 21. DEFAULT PRIVILEGES — the supabase_admin line
-- MEASURED ON PRODUCTION 2026-09-04, and reproduced here because it is true, not because it is right: anon still holds ALL on new tables through this line. The 2 September anon closure closed the postgres line only. Any table created in public AS supabase_admin is readable by anon at birth. Guarded because a restore may not have rights on supabase_admin; it warns loudly rather than skipping silently.
-- ========================================================================
DO $baseline$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, service_role;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT SELECT ON SEQUENCES TO anon;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT UPDATE ON SEQUENCES TO anon;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT USAGE ON SEQUENCES TO anon;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT SELECT ON SEQUENCES TO authenticated;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT UPDATE ON SEQUENCES TO authenticated;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT USAGE ON SEQUENCES TO authenticated;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT SELECT ON SEQUENCES TO postgres;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT UPDATE ON SEQUENCES TO postgres;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT USAGE ON SEQUENCES TO postgres;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT SELECT ON SEQUENCES TO service_role;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT UPDATE ON SEQUENCES TO service_role;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT USAGE ON SEQUENCES TO service_role;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO postgres;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT DELETE ON TABLES TO anon;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT INSERT ON TABLES TO anon;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT MAINTAIN ON TABLES TO anon;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT REFERENCES ON TABLES TO anon;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT SELECT ON TABLES TO anon;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT TRIGGER ON TABLES TO anon;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT TRUNCATE ON TABLES TO anon;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT UPDATE ON TABLES TO anon;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT DELETE ON TABLES TO authenticated;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT INSERT ON TABLES TO authenticated;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT MAINTAIN ON TABLES TO authenticated;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT REFERENCES ON TABLES TO authenticated;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT SELECT ON TABLES TO authenticated;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT TRIGGER ON TABLES TO authenticated;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT TRUNCATE ON TABLES TO authenticated;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT UPDATE ON TABLES TO authenticated;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT DELETE ON TABLES TO postgres;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT INSERT ON TABLES TO postgres;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT MAINTAIN ON TABLES TO postgres;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT REFERENCES ON TABLES TO postgres;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT SELECT ON TABLES TO postgres;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT TRIGGER ON TABLES TO postgres;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT TRUNCATE ON TABLES TO postgres;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT UPDATE ON TABLES TO postgres;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT DELETE ON TABLES TO service_role;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT INSERT ON TABLES TO service_role;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT MAINTAIN ON TABLES TO service_role;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT REFERENCES ON TABLES TO service_role;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT SELECT ON TABLES TO service_role;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT TRIGGER ON TABLES TO service_role;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT TRUNCATE ON TABLES TO service_role;';
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT UPDATE ON TABLES TO service_role;';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'default privileges FOR ROLE supabase_admin were NOT set: %, this restore lacks rights on that role. Production grants anon ALL on new tables through that line; a project restored without it will differ. Set it as an owner or record the deviation.', SQLERRM;
END
$baseline$;


-- ========================================================================
-- 22. THE SUPABASE PLATFORM, AND THE ONE SCHEDULED JOB
-- Not run by this file. Nothing in sections 1-20 depends on any of it, which
-- was checked, not assumed: pg_depend records zero non-extension dependencies
-- on pg_cron, supabase_vault or pg_stat_statements.
-- ========================================================================
-- On a real Supabase project the platform installs these three:
--   CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
--   CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
--   CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;
--
-- The one piece of live state that is neither schema nor data: pg_cron job 1,
-- "nexus-daily-metrics", active, the only caller of capture_daily_metrics().
-- A restore that omits it produces a database that looks complete and silently
-- stops capturing daily metrics. Re-create it AFTER restoring, on a project
-- where pg_cron exists:
--
--   select cron.schedule('nexus-daily-metrics', '50 19 * * *',
--                        'select public.capture_daily_metrics();');
--
-- Verify:  select jobname, schedule, active from cron.job;
--   expected exactly one row -- nexus-daily-metrics | 50 19 * * * | t
