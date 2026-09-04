/* NEXUS OS — QUALITY_GATE.mjs
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * One command that answers: "is there anything in this dashboard that would put
 * a wrong number, or another dealership's data, in front of a paying customer?"
 *
 * WHY IT WAS REBUILT ON 2 SEPTEMBER 2026
 * --------------------------------------
 * The previous version had stopped being able to answer that, in three separate
 * ways, and every one of them made it *lie in the safe direction and the unsafe
 * direction at once*:
 *
 *   1. It hard-coded a `SCHEMA` stub — a hand-typed list of every table and
 *      column. That list was last touched before the Profit Sentinel, the
 *      Action Center and multi-tenancy existed, so it did not know
 *      v_inventory_profit_sentinel, v_inventory_action_queue, inventory_actions,
 *      inventory_profit_settings, tenants, tenant_members or v_competitor_latest.
 *      It reported `v_conversations.msg_count`, `competitors.match_quality` and
 *      `v_competitor_latest` as non-existent. All three exist live; checked
 *      against information_schema on 2026-09-02. A checker that flags correct
 *      code is exactly as useless as one that passes broken code, because both
 *      teach the reader to stop reading it.
 *
 *      THE RECURRENCE IS THE DEFECT, NOT THE MISSING ROWS. Adding the seven
 *      missing relations by hand would have bought about a fortnight. So the
 *      column map is now DERIVED, never typed: from the live catalogue when a
 *      connection exists, otherwise from a snapshot block below that this file
 *      rewrites *in place* under `--refresh-schema`. Nothing in this file is a
 *      hand-maintained list of what the database contains.
 *
 *      There is exactly one hand-written list left, `L2_EXEMPT_TABLES`, and it
 *      is not a counter-example: it does not describe what the database
 *      contains, it records which deliberate deviations the owner has accepted.
 *      That is a decision, and a decision must not be derived from the database
 *      because the database is the thing under audit — derive it and anyone
 *      with DDL can make a new open policy exempt itself. Read the note above
 *      that map before touching it; each name is conjoined with a property
 *      re-measured from the live catalogue on every run.
 *
 *   2. It asserted `r.nav === 14`. lib/nav.js has fifteen entries since the
 *      Action Center landed. The screen list was a second hand-typed constant
 *      with the same problem and it was missing `actions`. Both are now parsed
 *      out of lib/nav.js, so the gate cannot disagree with the navigation about
 *      how many screens there are.
 *
 *   3. It reported `loggedIn=false navItems=0` and fourteen failing screens, and
 *      a prior agent recorded that as "the browser half needs credentials this
 *      environment does not have". THAT DIAGNOSIS WAS WRONG, and it mattered,
 *      because it retired the only half of the gate that renders anything.
 *      The cause was in this file: it ran `vite build` WITHOUT setting
 *      VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, so lib/env.js reported a
 *      configuration problem, app.js painted "Configuration problem" and
 *      returned before boot, and every screen was empty for a reason that had
 *      nothing to do with the screens. It also parked a session token of the
 *      literal string `stub.jwt.token`, which is not a JWT.
 *      Both are fixed. The render lane runs fully headless and offline, signed
 *      in, against a stubbed PostgREST. Verified: loggedIn=true, navItems=15.
 *
 *      The honest residue is smaller than "the browser half cannot run", and it
 *      is stated as its own lane below: a stubbed browser proves what the UI
 *      does with a given row. It cannot prove what Postgres does with a given
 *      caller. Authorisation, idempotency and tenant isolation live in
 *      SECURITY DEFINER functions and RLS, so they are checked in the LIVE lane
 *      and reported NOT RUN — never PASS — when there is no database.
 *
 * THE RULE THIS FILE IS HELD TO
 * -----------------------------
 * Do not weaken a check to make the gate pass. A launch-critical check that
 * genuinely fails must exit non-zero; that is the gate working. A check that
 * could not run is NOT a check that passed and is NOT a check that failed, and
 * it gets its own word — NOT RUN — its own exit code, and a reason.
 *
 * EXIT CODES
 *   0  every launch-critical check ran and passed
 *   1  at least one launch-critical check FAILED
 *   2  nothing failed, but at least one launch-critical check could not run
 *   3  the gate itself could not run (build failed, browser missing)
 *
 * USAGE
 *   node QUALITY_GATE.mjs                       offline lanes only
 *   NEXUS_DB_URL=postgres://…  node QUALITY_GATE.mjs      + the live lane
 *   node QUALITY_GATE.mjs --catalogue cat.json  + the live lane, from a
 *                                               catalogue dumped by the SQL
 *                                               this file prints (--print-sql)
 *   NEXUS_ENV=/path/.env node QUALITY_GATE.mjs  refresh the column map from
 *                                               PostgREST's own OpenAPI root
 *   node QUALITY_GATE.mjs --refresh-schema      rewrite the snapshot below
 *   node QUALITY_GATE.mjs --report FILE         also write the markdown report
 *
 * THE B LANE — what needs more than a catalogue
 *   B1 and B2 have to CALL action_decide(), and two of its arms write an audit
 *   row and an event row before they return. They therefore run only against a
 *   database named by NEXUS_STAGING_DB_URL, and report NOT RUN — with what they
 *   measured — against production. B3 needs a second dealership to exist. B4
 *   needs a real signed-in session.
 *
 *   NEXUS_STAGING_DB_URL=postgres://…   a staging Postgres carrying this schema.
 *                                       Every probe statement runs inside a
 *                                       transaction that ends in ROLLBACK, and
 *                                       the gate re-reads the audit and event
 *                                       counts afterwards and refuses to report
 *                                       a result if they moved.
 *   NEXUS_LIVE_URL / NEXUS_LIVE_ANON_KEY / NEXUS_LIVE_EMAIL / NEXUS_LIVE_PASSWORD
 *                                       (or NEXUS_LIVE_ACCESS_TOKEN) — B4 signs
 *                                       in, reads the rows itself, renders the
 *                                       app against the same project, and
 *                                       compares. Read-only.
 *   NEXUS_LIVE_INSECURE_TLS=1           accept a self-signed certificate on
 *                                       NEXUS_LIVE_URL. For a private staging
 *                                       endpoint only; never for production.
 */

import { execFileSync, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
const ARGV = process.argv.slice(2);
const flag = n => ARGV.includes(n);
const opt  = n => { const i = ARGV.indexOf(n); return i >= 0 ? ARGV[i + 1] : null; };

/* ══════════════════════════════════════════════════════════════════════════
   THE SNAPSHOT
   ───────────
   Derived from the live catalogue of Supabase project dsvuoovivysszdoiorch.
   NOT hand-typed and NOT to be hand-edited: run `--refresh-schema` with a
   connection, and this block is rewritten between its two markers.

   `takenAt` is load-bearing. Offline, a column this map does not know is
   ambiguous — a real defect, or a snapshot that has fallen behind — and the
   gate says so and declines to fail on it rather than crying wolf, which is
   precisely the failure being repaired here. With a live connection the same
   finding is unambiguous and is a hard failure.
   ══════════════════════════════════════════════════════════════════════════ */
/* ==NEXUS-SCHEMA-SNAPSHOT-BEGIN== */
const SNAPSHOT = {
  "takenAt": "2026-09-03T00:00:00Z",
  "source": "live catalogue of Supabase project dsvuoovivysszdoiorch, read 3 Sep 2026 through mcp__Supabase__execute_sql (the SQL --print-sql emits, relations + functions) and fed back in via --catalogue; no NEXUS_DB_URL and no psql exist in that environment",
  "relations": {
    "attribution_edge_type": "edge,seq,from_node,to_node,state,basis,source_ref,finding,unlocked_by,unlock_rank",
    "attribution_event_type": "event,seq,state,source_ref,finding",
    "attribution_link_basis": "basis,rank,is_evidence,default_confidence,label,description",
    "audit_log": "id,workflow,status,lead_name,lead_email,lead_score,intent,summary,logged_at,tenant_id",
    "communication_logs": "id,lead_email,channel,direction,message,created_at,sent_by,tenant_id",
    "competitors": "id,competitor,model,price_aed,our_price_aed,price_diff_aed,ai_recommendation,scraped_at,listing_title,source_host,source_kind,offer_name,offer_condition,match_quality,match_note,tenant_id",
    "customer_360_profiles": "id,customer_id,name,email,phone,total_emails,total_slack_messages,last_synced_at,tenant_id",
    "daily_metrics": "snapshot_date,open_leads,hot_leads,warm_leads,cold_leads,avg_response_minutes,pipeline_aed,units_at_risk,holding_cost_aed,workflow_runs,workflow_failures,captured_at,workflow_failures_rule,workflow_failures_canonical,pipeline_aed_rule,open_leads_rule,tenant_id",
    "deal_rescue_evidence_sources": "source,sort,admitted,evidence_tier,claim,verdict_basis",
    "deal_rescue_prerequisites": "id,sort,requirement,kind,unlocks,unlocks_states,evidence_today,why_not_code",
    "deal_rescue_settings": "tenant_id,at_risk_days,stalled_days,set_by,set_at,note",
    "deal_rescue_states": "state,sort,meaning,engine_can_produce,blocked_by,requires",
    "deals_embeddings": "id,deal_id,content,embedding,created_at,tenant_id",
    "finance_quotes": "id,lead_email,lead_name,quoted_by,vehicle_value_aed,loan_payoff_aed,credit_score,equity_aed,equity_status,loan_to_value_pct,finance_tier,indicative_apr_pct,disclaimer,source,created_at,vehicle_price_aed,max_ltv_pct,min_down_payment_aed,down_payment_aed,down_payment_pct,down_payment_assumed,trade_in_equity_applied_aed,financed_aed,tenure_months,monthly_payment_low_aed,monthly_payment_high_aed,total_cost_of_credit_low_aed,total_cost_of_credit_high_aed,indicative_apr_high_pct,calculation_id,execution_id,calculated_at,apr_source,ltv_policy_source,tenant_id",
    "inventory": "id,model,vin,status,days_in_stock,price_aed,cost_aed,gross_margin,holding_cost_accrued,net_margin,recommended_commission,vat_amount,aging_alert,ai_recommendation,acquired_at,tenant_id",
    "inventory_action_events": "id,tenant_id,action_id,at,event,actor_staff_id,actor_auth_id,actor_authority,detail,audit_log_id",
    "inventory_action_policy": "tenant_id,approver_tenant_roles,approver_staff_roles,reproposal_cooldown_days,set_by,set_at,note",
    "inventory_action_reason_codes": "code,applies_to,label,meaning,engine_was_wrong,sort",
    "inventory_actions": "id,tenant_id,unit_id,recommendation,engine_reason,engine_confidence,engine_confidence_basis,engine_impact_aed,engine_impact_kind,engine_impact_basis,engine_overall_risk,engine_days_in_stock,engine_gross_margin_aed,engine_owner_role,engine_evidence,engine_computed_at,status,proposed_at,proposed_by_staff_id,proposed_source,decided_at,decided_by_staff_id,decided_by_auth_id,decided_by_authority,decision_reason_code,decision_note,defer_until,assigned_to_staff_id,assigned_role,assigned_at,executed_at,executed_by_staff_id,execution_note,execution_failure,outcome_state,outcome_purchase_id,outcome_recorded_at,outcome_recorded_by_staff_id,attribution_basis,attribution_note,recovered_value_aed,recovered_value_basis,escalated_at,escalation_reason,created_at,updated_at",
    "inventory_profit_settings": "tenant_id,holding_cost_per_day_aed,holding_cost_source,holding_cost_verified_at,aging_warn_days,aging_critical_days,promote_days,wholesale_days,min_reprice_margin_pct,market_tolerance_pct,enquiry_window_days,min_enquiry_sources,updated_at,holding_cost_basis,holding_cost_set_by,min_model_token_overlap,accepted_market_match_quality,market_max_age_days",
    "kyc_documents": "id,lead_email,lead_name,chat_id,document_type,full_name,date_of_birth,expiry_date,is_valid,tampering,confidence_score,remarks,attempt_number,max_attempts,verdict,reviewed_by,reviewed_at,created_at,storage_path,retain_until,purged_at,void_reason,voided_at,tenant_id",
    "lead_recovery_action_events": "id,tenant_id,action_id,at,event,actor_staff_id,actor_auth_id,actor_authority,detail,audit_log_id",
    "lead_recovery_actions": "id,tenant_id,lead_id,recommendation,engine_state,engine_reason,engine_confidence,engine_confidence_basis,engine_risk_level,engine_risk_basis,engine_evidence,engine_owner_role,engine_computed_at,opportunity_value_state,opportunity_value_basis,status,proposed_at,proposed_by_staff_id,proposed_source,decided_at,decided_by_staff_id,decided_by_auth_id,decided_by_authority,decision_reason_code,decision_note,defer_until,assigned_to_staff_id,assigned_role,assigned_at,executed_at,executed_by_staff_id,execution_note,execution_failure,outcome_state,outcome_purchase_id,outcome_recorded_at,outcome_recorded_by_staff_id,attribution_basis,attribution_note,recovered_value_aed,recovered_value_basis,escalated_at,escalation_reason,created_at,updated_at",
    "lead_recovery_reason_codes": "code,applies_to,label,meaning,engine_was_wrong,sort",
    "lead_recovery_settings": "tenant_id,sla_first_response_minutes,silence_hours,stale_silence_hours,engagement_window_days,detector_max_age_hours,set_by,set_at,note,reproposal_cooldown_days",
    "lead_recovery_states": "state,sort,meaning,engine_can_produce,blocked_by,requires",
    "leads": "id,name,email,phone,source,vehicle_interest,budget_aed,status,ai_score,assigned_to,response_time_minutes,created_at,assigned_to_id,escalated_at,bitrix_lead_id,crm_synced_at,tenant_id",
    "policy_rule": "id,tenant_id,jurisdiction,rule_type,rule_name,value_numeric,value_text,unit,value_kind,source_url,source_name,source_document,effective_from,effective_to,verification_date,verified_by,verified_by_auth_user_id,confidence,status,verification_status,notes,version,supersedes_id,added_by,added_by_auth_user_id,added_at,updated_at",
    "policy_rule_event": "id,rule_id,tenant_id,event,actor,actor_auth_user_id,at,from_status,to_status,from_verification,to_verification,detail",
    "policy_rule_type": "code,label,description,created_at",
    "policy_unit": "code,label,value_kind,description,created_at",
    "policy_unmigrated_constant": "id,layer,location,snippet,current_value,kind,proposed_rule_type,proposed_rule_name,reaches_a_customer,seeded_as_rule,note,surveyed_on,created_at",
    "processed_messages": "message_id,source,chat_id,processed_at,tenant_id",
    "purchase_history": "id,customer_name,email,phone,vehicle,purchase_date,amount_aed,created_at,deal_id,lead_id,tenant_id",
    "rag_documents": "id,doc_title,section,content,source_file,page_number,search_vector,tenant_id",
    "tenant_members": "tenant_id,auth_user_id,role,staff_user_id,created_at",
    "tenants": "id,slug,name,status,is_unattributed_default,created_at",
    "users": "id,name,email,role,status,slack_user_id,created_at,tenant_id",
    "v_action_center_health": "tenant_id,actions_total,awaiting_decision,escalated_no_approver,approved_not_executed,executed,execution_failed,rejected,deferred,cancelled,outcomes_attributed,outcomes_not_attributable,executed_awaiting_outcome,undecided_exposure_aed,undecided_with_no_figure,last_proposed_at,last_decided_at,last_executed_at,last_activity_at,newest_undecided_days,oldest_undecided_days,events_total,events_without_audit,audit_rows,audit_rows_30d,last_audit_at,health",
    "v_attribution_edges": "tenant_id,edge,from_kind,from_ref,to_kind,to_ref,basis,confidence,note",
    "v_attribution_events": "tenant_id,event_seq,event_type,event_id,occurred_at,actor,subject_kind,subject_ref,lead_id,lead_basis,lead_confidence,lead_note,unit_id,unit_basis,unit_note,amount_aed,amount_kind,detail",
    "v_attribution_lead_chain": "tenant_id,lead_id,lead_name,created_at,status,ai_score,lead_source_field,campaign_state,campaign_basis,campaign_note,conversation_messages,messages_in,messages_out,first_message_at,last_message_at,conversation_state,conversation_basis,conversation_confidence,conversation_note,vehicle_interest_text,vehicle_text_candidates,vehicle_state,vehicle_basis,vehicle_note,finance_quotes,finance_state,finance_basis,finance_note,sales_recorded,revenue_confirmed_aed,revenue_kind,last_sale_date,sale_state,sale_basis,sale_note,gross_margin_aed,margin_state,margin_note,hops_total,hops_evidenced,first_break,chain",
    "v_attribution_link_map": "tenant_id,tenant_name,seq,edge,from_node,to_node,state,basis,basis_is_evidence,basis_confidence,source_ref,finding,unlocked_by,unlock_rank,instances_total,instances_evidenced,instances_refused,coverage_pct,coverage_note",
    "v_attribution_sale_chain": "tenant_id,sale_id,purchase_date,recorded_at,customer_name,vehicle_text,deal_id,revenue_aed,revenue_kind,gross_margin_aed,campaign_state,campaign_basis,campaign_note,lead_id,lead_name,lead_state,lead_basis,lead_confidence,lead_note,conversation_messages,conversation_state,conversation_basis,conversation_confidence,conversation_note,vehicle_unit_id,vehicle_text_candidates,vehicle_state,vehicle_basis,vehicle_confidence,vehicle_note,deal_record_state,deal_record_basis,deal_record_confidence,deal_record_note,finance_quotes_for_lead,finance_state,finance_basis,finance_note,revenue_state,revenue_basis,revenue_note,margin_state,margin_note,hops_total,hops_evidenced,first_break,chain",
    "v_audit_unregistered_writers": "tenant_id,workflow_written_in_audit_log,audit_rows,audit_rows_30d,first_written_at,last_written_at,statuses_seen,disposition",
    "v_competitor_latest": "id,competitor,model,price_aed,our_price_aed,price_diff_aed,ai_recommendation,scraped_at,listing_title,source_host,source_kind,offer_name,offer_condition,match_quality,match_note",
    "v_conversations": "thread_key,chat_id,phone,push_name,lead_email,lead_name,lead_status,display_name,identified,message_count,inbound_count,outbound_count,last_message_at,last_message,last_direction,awaiting_reply,msg_count,internal_count,msg_inbound_count,msg_outbound_count,last_msg_at,last_msg,last_msg_direction,awaiting_msg_reply,tenant_id",
    "v_customer_360": "email,name,phone,lead_count,best_ai_score,latest_status,purchase_count,lifetime_value_aed,last_purchase_date,is_vip,message_count,last_contact_at,total_emails,total_slack_messages,tenant_id",
    "v_customer_directory": "id,name,email,phone,source_records,last_seen_at,tenant_id",
    "v_deal_rescue": "tenant_id,deal_evidence,deal_evidence_ref,deal_evidence_source,customer_label,lead_id,identity_state,identity_basis,evidence_tier,admission_basis,deal_evidence_at,last_message_at,last_movement_at,days_since_movement,at_risk_days,stalled_days,settings_are_defaults,state,state_basis,recommended_action,action_reason,owner_staff_id,owner_name,owner_job_title,owner_state,owner_note,deal_value_aed,deal_value_state,deal_value_basis,margin_at_stake_state,margin_at_stake_basis,confidence,confidence_basis,lead_recovery_state,silence_state,silence_detector_state,silence_detector_last_success_at,silence_detector_note,human_approval_required,automation_state,automation_note,action_lane_state,action_lane_note,evidence,computed_at",
    "v_deal_rescue_candidates": "tenant_id,candidate_kind,candidate_ref,customer_label,source_table,observed_at,lead_id,identity_state,identity_basis,verdict,evidence_tier,verdict_basis,deal_value_aed,deal_value_state,deal_value_basis",
    "v_deal_rescue_readiness": "id,sort,requirement,kind,unlocks,unlocks_states,evidence_today,why_not_code,met_now,measured_now,measured_at",
    "v_deal_rescue_state_model": "state,sort,meaning,engine_can_produce,blocked_by,requires,deals_in_state_now,observation",
    "v_fin_gate_quote_evidence": "id,lead_email,lead_name,quoted_by,created_at,calculated_at,calculation_id,execution_id,indicative_apr_pct,indicative_apr_high_pct,monthly_payment_low_aed,monthly_payment_high_aed,is_evidenced,evidence_note,has_instalment",
    "v_inventory_action_queue": "id,tenant_id,unit_id,unit_model,unit_vin,unit_status,unit_price_aed,unit_cost_aed,status,is_live,awaiting_decision,deferral_now_due,recommendation,engine_reason,engine_confidence,engine_confidence_basis,engine_impact_aed,engine_impact_kind,engine_impact_basis,engine_overall_risk,engine_days_in_stock,engine_gross_margin_aed,engine_owner_role,engine_evidence,engine_computed_at,engine_now_recommendation,engine_now_risk,engine_now_days_in_stock,engine_now_impact_aed,engine_now_reason,engine_still_agrees,proposed_at,proposed_by_name,proposed_source,decided_at,decided_by_name,decided_by_job_title,decided_by_authority,decision_reason_code,decision_reason_label,decision_reason_meaning,decision_says_engine_was_wrong,decision_note,defer_until,assigned_to_staff_id,assigned_to_name,assigned_role,assigned_at,executed_at,executed_by_name,execution_note,execution_failure,escalated_at,escalation_reason,outcome_state,outcome_purchase_id,outcome_sale_vehicle,outcome_sale_amount_aed,outcome_sale_date,outcome_recorded_at,outcome_recorded_by_name,attribution_basis,attribution_note,recovered_value_aed,recovered_value_basis,outcome_sentence,cost_of_doing_nothing,days_open,created_at,updated_at",
    "v_inventory_action_timeline": "id,tenant_id,action_id,at,event,actor_name,actor_job_title,actor_authority,detail,audit_log_id,audit_status,audit_outcome_class,audit_summary",
    "v_inventory_profit_sentinel": "tenant_id,id,model,vin,status,acquired_at,days_in_stock,aging_band,days_to_warning,days_to_critical,cost_aed,price_aed,gross_margin_aed,gross_margin_pct,capital_tied_aed,holding_cost_per_day_aed,holding_cost_basis,holding_cost_source,holding_cost_set_by,holding_cost_verified_at,holding_cost_accrued_aed,holding_cost_state,holding_cost_note,net_margin_aed,net_margin_state,net_margin_note,market_position,market_competitor,market_price_aed,market_match_quality,market_scraped_at,market_note,demand_signal,enquiries_in_window,enquiry_leads,enquiry_messages,enquiry_last_at,enquiry_source_rows,enquiry_resolved_rows,enquiry_window_days,enquiry_coverage,enquiry_note,age_risk,age_risk_rank,margin_risk,margin_risk_rank,overall_risk,overall_risk_rank,risk_basis,recommendation,reason,confidence,confidence_basis,impact_aed,impact_kind,impact_basis,suggested_owner_role,suggested_owner_state,suggested_owner_note,human_approval_required,automation_state,evidence,warn_days,crit_days,promote_days,wholesale_days,min_margin_pct,tol_pct,min_enq_sources,min_model_token_overlap,market_max_age_days,settings_are_defaults,computed_at",
    "v_inventory_sales": "id,model,status,price_aed,days_in_stock,tenant_id",
    "v_lead_messages": "lead_id,id,created_at,channel,direction,message,lead_email,is_message,tenant_id",
    "v_lead_recovery": "tenant_id,lead_id,lead_name,lead_status,lead_is_open,lead_created_at,vehicle_interest_text,vehicle_state,vehicle_note,state,state_basis,response_time_minutes,response_time_state,sla_first_response_minutes,sla_state,response_time_note,last_contact_at,last_contact_state,last_customer_message_at,last_dealership_message_at,messages_resolved,messages_in,messages_out,first_message_at,hours_since_our_last_message,minutes_since_their_last_message,silence_state,silence_threshold_hours,stale_silence_threshold_hours,silence_markers_on_file,last_silence_marker_at,silence_detector_state,silence_detector_last_run_at,silence_detector_last_success_at,silence_detector_last_run_class,silence_detector_note,risk_level,risk_basis,recommended_action,action_reason,owner_staff_id,owner_name,owner_job_title,owner_state,owner_note,action_id,action_status,action_recommendation,action_state,opportunity_value_aed,opportunity_value_state,opportunity_value_basis,confirmed_outcome_state,confirmed_revenue_aed,confirmed_outcome_date,confirmed_outcome_basis,recovery_attribution_state,recovered_value_aed,recovery_attribution_basis,confidence,confidence_basis,human_approval_required,automation_state,automation_note,evidence,settings_are_defaults,computed_at",
    "v_lead_recovery_coverage": "tenant_id,leads_total,leads_open,leads_closed,leads_at_risk,leads_risk_unknown,leads_with_a_recommended_action,leads_with_a_confirmed_sale,confirmed_revenue_aed,sales_attributed_to_a_recovery_action,leads_with_no_owner,leads_with_no_measured_response_time,leads_with_no_resolved_conversation,communication_log_rows,message_events,silence_markers,message_events_resolved_to_a_lead,identity_resolution_pct,unresolved_whatsapp_handles,silence_detector_state,silence_detector_last_run_at,silence_detector_last_success_at,silence_detector_last_run_class,recovery_actions_total,recovery_actions_awaiting_decision,recovery_actions_executed,recovery_outcomes_attributed,actions_whose_lead_is_another_tenants,settings_are_defaults,sla_first_response_minutes,sla_agrees_with_needs_attention,what_this_engine_cannot_tell_you,computed_at",
    "v_lead_recovery_health": "tenant_id,actions_total,awaiting_decision,escalated_no_approver,approved_not_executed,executed,execution_failed,rejected,deferred,cancelled,outcomes_attributed,outcomes_not_attributable,executed_awaiting_outcome,attributed_revenue_aed,last_proposed_at,last_decided_at,last_executed_at,events_total,events_without_audit,audit_rows,audit_rows_30d,last_audit_at,health",
    "v_lead_recovery_queue": "id,tenant_id,lead_id,lead_name,lead_status,status,is_live,awaiting_decision,deferral_now_due,recommendation,engine_state,engine_reason,engine_confidence,engine_confidence_basis,engine_risk_level,engine_risk_basis,engine_owner_role,engine_evidence,engine_computed_at,engine_now_state,engine_now_risk_level,engine_now_recommendation,engine_now_reason,engine_still_agrees,opportunity_value_state,opportunity_value_basis,proposed_at,proposed_by_name,proposed_source,decided_at,decided_by_name,decided_by_job_title,decided_by_authority,decision_reason_code,decision_reason_label,decision_reason_meaning,decision_says_engine_was_wrong,decision_note,defer_until,assigned_to_staff_id,assigned_to_name,assigned_role,assigned_at,executed_at,executed_by_name,execution_note,execution_failure,escalated_at,escalation_reason,outcome_state,outcome_purchase_id,outcome_sale_vehicle,outcome_sale_amount_aed,outcome_sale_date,outcome_recorded_at,outcome_recorded_by_name,attribution_basis,attribution_note,recovered_value_aed,recovered_value_basis,outcome_sentence,days_open,created_at,updated_at",
    "v_lead_recovery_state_model": "state,sort,meaning,engine_can_produce,blocked_by,requires,leads_in_state_now,observation",
    "v_needs_attention": "kind,severity,ref,title,detail,at,screen",
    "v_policy_authoritative": "id,tenant_id,is_global_rule,jurisdiction,rule_type,rule_name,version,value_numeric,value_text,unit,value_kind,value_display,effective_from,effective_to,source_name,source_url,source_document,verification_date,verified_by,confidence,citation",
    "v_policy_rule": "id,tenant_id,is_global_rule,jurisdiction,rule_type,rule_name,version,supersedes_id,value_numeric,value_text,unit,value_kind,value_display,status,verification_status,confidence,effective_from,effective_to,source_name,source_url,source_document,verification_date,verified_by,added_by,added_at,updated_at,notes,authority,authority_reason,may_be_relied_on",
    "v_policy_rule_history": "tenant_id,jurisdiction,rule_type,rule_name,version,id,supersedes_id,status,verification_status,value_numeric,value_text,unit,effective_from,effective_to,source_name,source_document,verification_date,verified_by,added_by,added_at,previous_value_numeric,previous_value_text,previous_effective_from,previous_effective_to,previous_source_name",
    "v_policy_unmigrated_constant": "layer,kind,location,snippet,current_value,reaches_a_customer,proposed_rule_type,proposed_rule_name,seeded_as_rule,rule_row_exists,rule_is_authoritative,migration_state,note,surveyed_on",
    "v_team_performance": "id,name,email,role,status,leads_assigned,hot_leads,avg_response_minutes,within_sla,breached_sla,pipeline_aed",
    "v_workflow_health": "id,name,category,trigger_type,trigger_detail,description,is_active,writes_audit_log,runs,failures,escalations,runs_30d,failures_30d,partials_30d,no_result_30d,rejected_30d,escalated_30d,successes_30d,unknown_30d,effective_runs_30d,success_rate_30d,success_rate,last_run,last_success,last_failure,last_partial,last_incomplete,health",
    "whatsapp_contacts": "chat_id,phone,push_name,lead_email,first_seen,last_seen,message_count,tenant_id",
    "workflow_registry": "id,name,audit_name,trigger_type,trigger_detail,category,is_active,description,writes_audit_log,audit_aliases"
  },
  "rpcs": {
    "action_approver_context": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "action_cancel": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "action_decide": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "action_mark_executed": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "action_mark_not_attributable": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "action_outcome_candidates": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "action_propose": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "action_record_outcome": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "action_write_audit": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "assign_hot_lead": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "capture_daily_metrics": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "deal_rescue_recommended_action": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "deal_rescue_state": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "inventory_actions_touch": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "lead_recovery_cancel": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "lead_recovery_decide": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "lead_recovery_mark_executed": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "lead_recovery_mark_not_attributable": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "lead_recovery_outcome_candidates": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "lead_recovery_propose": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "lead_recovery_recommended_action": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "lead_recovery_record_outcome": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "lead_recovery_risk": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "lead_recovery_state": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "lead_recovery_write_audit": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_comm_keys_for_lead": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_current_tenant_id": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_current_tenant_ids": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_default_tenant_id": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_is_message": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_is_reply": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_jwt_tenant_id": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_kyc_object_tenant": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_lead_for_comm_key": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_lead_is_open": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_mark_first_response": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_model_tokens": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_onboard_dealership": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_outcome_class": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_require_security_invoker_views": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_scoped_tenant_id": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_tenancy_readiness": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "policy_authority": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "policy_citation": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "policy_numeric": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "policy_numeric_as_of": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "policy_propose_rule": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "policy_read_unverified_rule": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "policy_rule_event_append_only": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "policy_rule_guard_immutability": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "policy_rule_guard_one_active": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "policy_supersede_rule": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "policy_verify_rule": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "policy_withdraw_rule": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "recompute_inventory_derived": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "search_rag_documents": {
      "secdef": false,
      "tenantArg": true,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "sentinel_inventory_actions": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    }
  },
  "sentinel": {
    "units": 12,
    "holding_cost_state": {
      "NOT_COMPUTABLE": 12
    },
    "net_margin_state": {
      "NOT_COMPUTABLE": 12
    },
    "market_position": {
      "UNKNOWN_NO_COMPARABLE": 7,
      "UNKNOWN_UNVERIFIED_COMPARABLE": 5
    },
    "demand_signal": {
      "UNKNOWN_LOW_COVERAGE": 12
    },
    "enquiry_coverage": {
      "INSUFFICIENT": 12
    },
    "holding_cost_accrued_aed_not_null": 0,
    "net_margin_aed_not_null": 0,
    "holding_rate_set": false
  },
  "ledger": {
    "actions": 3,
    "events": 7,
    "events_with_audit": 7,
    "audit_rows_referenced": 6,
    "orphan": 0,
    "dangling": 0,
    "tenant_mismatch": 0
  },
  "tenancy": {
    "tenants": 1,
    "tables_with_rls": 23,
    "tables_without_rls": 0,
    "views_without_security_invoker": 0,
    "policies": 69
  }
};
/* ==NEXUS-SCHEMA-SNAPSHOT-END== */

/* ══════════════════════════════════════════════════════════════════════════
   RESULT MODEL
   ══════════════════════════════════════════════════════════════════════════ */
const LANE = {
  SOURCE: 'OFFLINE · source',      // no network, no credentials, no browser
  RENDER: 'OFFLINE · rendered',    // headless browser, stubbed PostgREST
  LIVE:   'LIVE · database',       // needs a real connection; never faked
};
const results = [];
/* severity P0 blocks exit 0. There is no mechanism in this file for downgrading
   a P0 to a warning; adding one would be the defect this rewrite exists to end. */
function record(id, lane, severity, title, state, evidence, reason) {
  results.push({ id, lane, severity, title, state, evidence: [].concat(evidence || []), reason: reason || '' });
}
const PASS = (id, l, s, t, e)       => record(id, l, s, t, 'PASS', e);
const FAIL = (id, l, s, t, e)       => record(id, l, s, t, 'FAIL', e);
const WARN = (id, l, s, t, e)       => record(id, l, s, t, 'WARN', e);
const NOTRUN = (id, l, s, t, why)   => record(id, l, s, t, 'NOT RUN', [], why);
const verdict = (id, l, s, t, bad, okEvidence) =>
  bad.length ? FAIL(id, l, s, t, bad) : PASS(id, l, s, t, okEvidence);

/* ══════════════════════════════════════════════════════════════════════════
   SOURCES
   ══════════════════════════════════════════════════════════════════════════ */
/* Comments are removed so a rule NAMED in a comment is not reported as a
   violation of itself — this codebase explains its own invariants at length and
   the old gate matched those explanations. Newlines are preserved, so every
   line number this gate prints is the line number in the file the reader opens.
   Reporting a defect at the wrong line is a smaller cry-wolf than inventing one,
   but it is the same kind. */
const stripComments = src =>
  src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
     .replace(/^([^\n]*?)\/\/[^\n]*$/gm, '$1');

const screenDir = join(HERE, 'screens');
const libDir    = join(HERE, 'lib');
const screenFiles = (await readdir(screenDir)).filter(f => f.endsWith('.js')).sort();
const libFiles    = (await readdir(libDir)).filter(f => f.endsWith('.js') && !f.endsWith('.test.mjs')).sort();

const SRC = new Map();               // path label -> { raw, code }
for (const f of screenFiles) {
  const raw = await readFile(join(screenDir, f), 'utf8');
  SRC.set('screens/' + f, { raw, code: stripComments(raw) });
}
for (const f of libFiles) {
  const raw = await readFile(join(libDir, f), 'utf8');
  SRC.set('lib/' + f, { raw, code: stripComments(raw) });
}
{
  const raw = await readFile(join(HERE, 'app.js'), 'utf8');
  SRC.set('app.js', { raw, code: stripComments(raw) });
}
const screenSrc = [...SRC].filter(([p]) => p.startsWith('screens/'));

/* ── The navigation is the only place that says how many screens exist ────── */
const navRaw = await readFile(join(libDir, 'nav.js'), 'utf8');
const navBlock = navRaw.slice(navRaw.indexOf('const NAV = ['), navRaw.indexOf('const SCREENS'));
const NAV_IDS = [...navBlock.matchAll(/\bid\s*:\s*'([a-z0-9_]+)'/g)].map(m => m[1]);

/* THE SCREENS THAT PUT MONEY OR A RATE IN FRONT OF A READER, and therefore the
   ones R4 and R5 sweep. Not a copy of NAV_IDS: Settings and Team have no
   economic claim to fabricate, and sweeping them would only add noise. It was
   ['inventory','actions','overview'] and ['actions','overview'] respectively,
   written when those were the only engines that existed. Five screens have
   landed since — revenue, leadrecovery, dealrescue, attribution and policy —
   and every one of them renders currency: v_lead_recovery carries its own
   `recovered_value_aed`, v_lead_recovery_queue and v_deal_rescue carry
   opportunity and deal values, and the attribution chain views carry
   `revenue_confirmed_aed` and `gross_margin_aed`. A fabricated figure on any of
   them reaches a dealership exactly as fast as one on Overview.

   Intersected with NAV_IDS so that a screen renamed or retired in lib/nav.js
   drops out of this sweep instead of being silently looked up as undefined and
   passing on an empty string — which is how a per-screen list stops checking
   without ever failing. If a name here is not in the navigation the gate says
   so rather than quietly skipping it. */
const ECONOMIC_SCREEN_NAMES = ['overview', 'inventory', 'actions', 'revenue',
  'leadrecovery', 'dealrescue', 'attribution', 'policy'];
const ECONOMIC_SCREENS = ECONOMIC_SCREEN_NAMES.filter(id => NAV_IDS.includes(id));
const ECONOMIC_SCREENS_UNKNOWN = ECONOMIC_SCREEN_NAMES.filter(id => !NAV_IDS.includes(id));

/* ══════════════════════════════════════════════════════════════════════════
   THE CATALOGUE — live first, snapshot second, never hand-typed
   ══════════════════════════════════════════════════════════════════════════ */
const CATALOGUE_SQL = `
select json_build_object(
  'takenAt', to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'relations', (select json_object_agg(t.table_name, t.cols) from (
     select c.table_name, string_agg(c.column_name, ',' order by c.ordinal_position) cols
       from information_schema.columns c
       join pg_class pc on pc.relname = c.table_name
       join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
      where c.table_schema = 'public' and pc.relkind in ('r','v','m','p')
      group by 1) t),
  'functions', (select json_agg(json_build_object(
       'name', p.proname,
       'args', pg_get_function_identity_arguments(p.oid),
       'secdef', p.prosecdef,
       'acl', coalesce(array_to_string(p.proacl::text[],' | '),'DEFAULT-NULL-ACL'),
       'body', p.prosrc))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  'tables_no_rls', (select coalesce(json_agg(c.relname),'[]'::json)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relkind='r' and not c.relrowsecurity),
  'views_no_invoker', (select coalesce(json_agg(c.relname),'[]'::json)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relkind='v'
       and coalesce(array_to_string(c.reloptions,','),'') not ilike '%security_invoker%'),
  /* Every fact L2's exemption conjunction reads is selected HERE, in the same
     statement, from the catalogue. The exemption is a decision (a name in a map
     in this file); the property that decision is conditional on is a
     measurement, and a measurement must come from the database or it is a
     belief. Drop one of these keys and L2 fails the named table rather than
     passing it — an exemption that cannot be re-checked is not an exemption. */
  'open_policies', (select coalesce(json_agg(json_build_object(
       'table', p.tablename, 'policy', p.policyname, 'roles', p.roles, 'cmd', p.cmd,
       'qual', p.qual, 'with_check', p.with_check,
       'table_acl', coalesce(array_to_string(c.relacl, E'\\n'), '(owner-only)'),
       'has_tenant_id', exists (select 1 from pg_attribute a
            where a.attrelid = c.oid and a.attname = 'tenant_id'
              and a.attnum > 0 and not a.attisdropped),
       /* Is this table the tenant dimension itself? public.tenants has no
          tenant_id column of its own, so "no tenant_id column" does NOT make a
          table tenant-neutral. Measured 3 Sep 2026: 26 tenant_id foreign keys
          point at public.tenants. Without this clause the shape test would call
          the dealership register tenant-neutral. */
       'tenant_fk_referent', exists (
            select 1 from pg_constraint con
              join pg_class lc on lc.oid = con.conrelid
              join pg_namespace ln on ln.oid = lc.relnamespace and ln.nspname = 'public'
             where con.contype = 'f' and con.confrelid = c.oid
               and exists (select 1 from pg_attribute a2
                            where a2.attrelid = con.conrelid
                              and a2.attnum = any(con.conkey)
                              and a2.attname = 'tenant_id'))
     )),'[]'::json)
     from pg_policies p
     join pg_class c on c.relname = p.tablename
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = p.schemaname
     where p.schemaname='public'
       and (coalesce(p.qual,'')='true' or coalesce(p.with_check,'')='true')
       and array_to_string(p.roles,',') <> 'service_role'),
  'sentinel', (select json_build_object(
       'units', count(*),
       'holding_cost_state', json_object_agg_unique_state(null)) from (select 1) z),
  'sentinel_states', (select coalesce(json_agg(json_build_object(
       'hc', holding_cost_state, 'nm', net_margin_state, 'mkt', market_position,
       'dem', demand_signal, 'cov', enquiry_coverage,
       'hc_num', (holding_cost_accrued_aed is not null),
       'nm_num', (net_margin_aed is not null),
       'conf', confidence, 'conf_basis', nullif(btrim(coalesce(confidence_basis,'')),''),
       'impact_kind', impact_kind, 'impact', impact_aed,
       'rate', holding_cost_per_day_aed, 'basis', holding_cost_basis,
       'verified', holding_cost_verified_at)),'[]'::json)
     from public.v_inventory_profit_sentinel),
  'ledger', (select json_build_object(
       'events', count(*),
       'orphan', count(*) filter (where e.audit_log_id is null),
       'audit_rows', count(distinct e.audit_log_id),
       'dangling', (select count(*) from public.inventory_action_events x
                      left join public.audit_log a on a.id = x.audit_log_id where a.id is null),
       'tenant_mismatch', (select count(*) from public.inventory_action_events x
                      join public.audit_log a on a.id = x.audit_log_id
                     where a.tenant_id is distinct from x.tenant_id))
     from public.inventory_action_events e),
  'bad_recovered', (select count(*) from public.inventory_actions
     where recovered_value_aed is not null
       and (outcome_state <> 'ATTRIBUTED' or outcome_purchase_id is null
            or attribution_basis is null or recovered_value_basis is null)),
  'unregistered_writers', (select coalesce(json_agg(distinct a.workflow),'[]'::json)
     from public.audit_log a
     where not exists (select 1 from public.workflow_registry w
        where lower(coalesce(w.audit_name, w.name)) = lower(a.workflow)
           or lower(w.name) = lower(a.workflow)
           or exists (select 1 from unnest(coalesce(w.audit_aliases,'{}'::text[])) al
                       where lower(al) = lower(a.workflow)))),
  'unregistered_writer_dispositions', (select coalesce(json_agg(json_build_object(
       'workflow', v.workflow_written_in_audit_log,
       'audit_rows', v.audit_rows,
       'statuses', v.statuses_seen,
       'disposition', v.disposition)),'[]'::json)
     from public.v_audit_unregistered_writers v),
  /* ── The B lane's census ──────────────────────────────────────────────
     The four B checks below measure their own preconditions before they will
     claim anything, and this is what they measure them FROM: how many
     dealerships exist, who is a member of each, which account roles and job
     titles that dealership's policy admits as approvers, and how many actions
     are in a state a decision could still move. Nothing here is an assertion —
     B1 re-reads action_approver_context()'s own answer before it concludes
     anything about who may decide, so a wrong census makes a check refuse to
     run, never makes it pass.

     tenants and members_expected are counted in the same statement that
     builds the lists beside them, and the B lane compares the two. A truncated
     transfer that dropped half the members would otherwise let B1 report the
     measured sentence "this database has no non-approving member" — which is
     the same untruth as a PASS on absent evidence, wearing a NOT RUN's
     clothes. */
  'b_lane', json_build_object(
     'tenants', (select count(*) from public.tenants),
     'tenants_active', (select count(*) from public.tenants where status = 'active'),
     'tenant_ids', (select coalesce(json_agg(t.id order by t.created_at, t.id), '[]'::json) from public.tenants t),
     'members_expected', (select count(*) from public.tenant_members),
     'members', (select coalesce(json_agg(json_build_object(
          'tenant_id', m.tenant_id, 'auth_user_id', m.auth_user_id, 'role', m.role,
          'staff_role', u.role,
          'has_policy', (p.tenant_id is not null),
          'role_admits', (p.tenant_id is not null and m.role = any (p.approver_tenant_roles)),
          'title_admits', (p.tenant_id is not null and u.role is not null
               and array_length(p.approver_staff_roles, 1) is not null
               and lower(u.role) = any (select lower(x) from unnest(p.approver_staff_roles) x)))), '[]'::json)
        from public.tenant_members m
        left join public.inventory_action_policy p on p.tenant_id = m.tenant_id
        left join public.users u on u.id = m.staff_user_id and u.tenant_id = m.tenant_id),
     'policies', (select coalesce(json_agg(json_build_object(
          'tenant_id', p.tenant_id,
          'approver_tenant_roles', p.approver_tenant_roles,
          'approver_staff_roles', p.approver_staff_roles)), '[]'::json)
        from public.inventory_action_policy p),
     'actions_by_tenant', (select coalesce(json_agg(json_build_object(
          'tenant_id', z.tenant_id, 'actions', z.n, 'decidable', z.d)), '[]'::json)
        from (select tenant_id, count(*) n,
                     count(*) filter (where status in ('PROPOSED','DEFERRED')) d
                from public.inventory_actions group by 1) z),
     'member_role_constraint', (select pg_get_constraintdef(c.oid) from pg_constraint c
        where c.conrelid = to_regclass('public.tenant_members') and c.contype = 'c'
          and pg_get_constraintdef(c.oid) ilike '%role%' limit 1)),
  'meta', json_build_object(
     'functions_expected', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')),
     'body_chars_expected', (select sum(length(p.prosrc)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')),
     'relations_expected', (select count(distinct c.table_name) from information_schema.columns c
        join pg_class pc on pc.relname=c.table_name join pg_namespace pn on pn.oid=pc.relnamespace and pn.nspname='public'
       where c.table_schema='public' and pc.relkind in ('r','v','m','p')),
     'tables_total', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),
     'views_total', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v'),
     'policies_total', (select count(*) from pg_policies where schemaname='public'),
     'sentinel_units', (select count(*) from public.v_inventory_profit_sentinel))
)::text;`.replace(/\n\s*'sentinel', \(select json_build_object\([\s\S]*?\) z\),/, '');

/* ── Is this catalogue actually a catalogue? ───────────────────────────────
   The live lane reads nine keys off this object. Supply four of them and every
   check that reads a missing key sees `undefined`, iterates nothing, finds
   nothing wrong, and reports PASS — a P0 going green *because its evidence was
   absent*. That is not hypothetical. On 3 Sep 2026 a catalogue was produced
   through a channel that truncates large values; it carried all 60 functions
   and every one of them had `body: ""`. L4 scans those bodies for writes with
   no tenant predicate and L5 scans them for reads of tenant-owned tables.
   Against empty bodies both find nothing, and the report would have said the
   two grant checks CLAUDE.md calls "the shape that has opened a hole three
   times" had PASSED, on no evidence at all.

   So a catalogue must carry every key the live lane reads, and must agree with
   the counts Postgres computed for itself *in the same statement that built
   it*. Those counts are not a signature and nothing here defends against a
   deliberately forged file; they defend against the two failures that actually
   happen — a partial source, and a truncated transfer. A catalogue that fails
   them is not a weaker live source. It is not a live source at all, and the
   live lane stays NOT RUN, which is the honest answer.

   WHY `b_lane` IS NOT IN THIS SHAPE, AND WHY THAT IS NOT A HOLE IN THE SEAL.
   The census the B checks read (added below `open_policies`) is deliberately
   NOT required here. The seal exists to stop a check reporting PASS on absent
   evidence; a B check cannot do that, because the only two things it can say
   without a probe are NOT RUN and FAIL. Requiring the key here would instead
   take L1–L10 — ten checks whose own evidence is present and intact — off a
   catalogue dumped before this key existed, buying nothing.

   What the seal WOULD have caught is the other failure, and it is caught in
   `bCensus()` instead: a b_lane that arrived truncated. `undefined >= 2` is
   false, so a missing census would have let B3 print the measured-sounding
   sentence "this database holds one dealership" having measured nothing. That
   is the seal's own defect in a NOT RUN's clothing. So every B check
   distinguishes "the catalogue does not carry a census" from "the census says
   one", by name, and refuses to describe a database it has not read. */
const CATALOGUE_MAX_AGE_H = Number(process.env.NEXUS_CATALOGUE_MAX_AGE_H || 24);
function catalogueIntegrity(cat) {
  if (!cat || typeof cat !== 'object' || Array.isArray(cat)) return 'it is not a JSON object';
  const isObj = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const shape = {
    relations: isObj,            functions: Array.isArray,
    tables_no_rls: Array.isArray, views_no_invoker: Array.isArray,
    open_policies: Array.isArray, sentinel_states: Array.isArray,
    unregistered_writers: Array.isArray, ledger: isObj,
    bad_recovered: v => typeof v === 'number' && Number.isFinite(v),
  };
  const missing = Object.entries(shape).filter(([k, ok]) => !ok(cat[k])).map(([k]) => k);
  if (missing.length) return `missing or malformed on ${missing.join(', ')} — every live check reads one of these, and a check whose evidence is absent must not report PASS`;

  const m = cat.meta;
  if (!isObj(m)) return 'it carries no meta block, so nothing states how much data the database selected and a truncated transfer is indistinguishable from a complete one';
  const bad = [];
  const fns = cat.functions.length;
  if (Number(m.functions_expected) !== fns) bad.push(`${m.functions_expected} functions were selected and ${fns} arrived`);
  const bodyChars = cat.functions.reduce((a, f) => a + String(f.body || '').length, 0);
  if (Number(m.body_chars_expected) !== bodyChars) bad.push(`${m.body_chars_expected} characters of function source were selected and ${bodyChars} arrived — L4 and L5 read those bodies, and against a truncated body they find nothing and pass`);
  const rels = Object.keys(cat.relations).length;
  if (Number(m.relations_expected) !== rels) bad.push(`${m.relations_expected} relations were selected and ${rels} arrived`);
  if (Number.isFinite(Number(m.sentinel_units)) && Number(m.sentinel_units) !== cat.sentinel_states.length)
    bad.push(`${m.sentinel_units} sentinel units were selected and ${cat.sentinel_states.length} arrived`);
  if (bad.length) return `incomplete: ${bad.join('; ')}`;

  const t = Date.parse(cat.takenAt || '');
  if (!Number.isFinite(t)) return 'it carries no readable takenAt, so nothing says how old the reading is';
  const ageH = (Date.now() - t) / 3.6e6;
  if (ageH > CATALOGUE_MAX_AGE_H) return `taken ${ageH.toFixed(1)}h ago and the limit is ${CATALOGUE_MAX_AGE_H}h — the live lane asserts what the database is NOW, and a stale reading reported as a live PASS is the same untruth as a NOT RUN reported as a PASS`;
  if (ageH < -1) return `takenAt is ${(-ageH).toFixed(1)}h in the future — the clock on one side of this reading is wrong and its freshness cannot be established`;
  return null;
}

/* Neither live path is trusted until the catalogue it produced passes the
   integrity gate. Failing it is reported as "could not run", not as a pass. */
const sealed = (how, cat) => {
  const why = catalogueIntegrity(cat);
  return why ? { how: null, why: `the catalogue from ${how} is not usable as a live source: ${why}` } : { how, cat };
};

async function loadCatalogue() {
  const file = opt('--catalogue');
  if (file) {
    try { return sealed(`--catalogue ${file}`, JSON.parse(await readFile(file, 'utf8'))); }
    catch (e) { return { how: null, why: `--catalogue ${file} could not be read: ${e.message}` }; }
  }
  const url = process.env.NEXUS_DB_URL;
  if (!url) return { how: null, why: 'no NEXUS_DB_URL and no --catalogue file; the live lane needs a SQL connection because RLS, EXECUTE grants, security_invoker and function bodies are catalogue facts PostgREST does not expose' };
  try { execSync('command -v psql', { stdio: 'ignore' }); }
  catch { return { how: null, why: 'NEXUS_DB_URL is set but psql is not on PATH' }; }
  try {
    const out = execFileSync('psql', [url, '-Atqc', CATALOGUE_SQL], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return sealed('psql via NEXUS_DB_URL', JSON.parse(out.trim()));
  } catch (e) {
    return { how: null, why: `psql failed: ${String(e.message).slice(0, 200)}` };
  }
}

/* A weaker, credential-only refresh: PostgREST publishes its own OpenAPI at the
   REST root, which carries every exposed relation and column. It cannot see
   grants or RLS, so it refreshes the column map only — which is the half that
   was going stale and producing the false failures. */
async function relationsFromPostgrest() {
  const envPath = process.env.NEXUS_ENV;
  let url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (envPath && existsSync(envPath)) {
    const kv = Object.fromEntries((await readFile(envPath, 'utf8')).split('\n')
      .map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('='))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
    url = url || kv.SUPABASE_URL; key = key || kv.SUPABASE_SERVICE_ROLE_KEY;
  }
  if (!url || !key) return null;
  const r = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' } });
  if (!r.ok) return null;
  const spec = await r.json();
  const rel = {};
  for (const [name, def] of Object.entries(spec.definitions || {})) {
    if (def && def.properties) rel[name] = Object.keys(def.properties).join(',');
  }
  return Object.keys(rel).length ? rel : null;
}

const live = await loadCatalogue();
const pgrstRelations = live.cat ? null : await relationsFromPostgrest().catch(() => null);

const RELATIONS = Object.fromEntries(Object.entries(
  (live.cat && live.cat.relations) || pgrstRelations || SNAPSHOT.relations
).map(([k, v]) => [k, String(v).split(',')]));
const SCHEMA_IS_LIVE = Boolean(live.cat || pgrstRelations);
const SCHEMA_TAKEN   = live.cat ? live.cat.takenAt : (pgrstRelations ? 'this run, via PostgREST OpenAPI' : SNAPSHOT.takenAt);
const RPC_NAMES = new Set(
  live.cat ? live.cat.functions.map(f => f.name) : Object.keys(SNAPSHOT.rpcs));

/* --refresh-schema: rewrite the snapshot block in this very file. The whole
   point is that nobody ever hand-types a column list into this gate again. */
if (flag('--refresh-schema')) {
  if (!SCHEMA_IS_LIVE) { console.error('--refresh-schema needs a live source (NEXUS_DB_URL, --catalogue, or NEXUS_ENV with a service-role key).'); process.exit(3); }
  const self = await readFile(new URL(import.meta.url), 'utf8');
  const A = self.indexOf('/* ==NEXUS-SCHEMA-SNAPSHOT-BEGIN== */');
  const B = self.indexOf('/* ==NEXUS-SCHEMA-SNAPSHOT-END== */');
  /* The rpc map is derived here too, from 3 Sep 2026. It was the last
     hand-maintained list of what the database contains left in this file, and
     it had gone stale in both directions at once: it did not know the twenty
     lead_recovery_*, deal_rescue_* and policy_* functions the four new engines
     call — so the offline stub 404'd every one of them and R3 failed on
     screens that were correct — and it still recorded `anon` as holding EXECUTE
     on search_rag_documents, which was revoked. A stale map that under-reports
     a grant is worse than no map: it is a security claim nobody measured.

     Overloads collapse onto one name, as PostgREST addresses them, and they
     collapse CONSERVATIVELY — secdef and tenantArg are OR-ed and grants are
     unioned — so a name is never recorded as safer than its most privileged
     signature. `search_rag_documents` and `nexus_comm_keys_for_lead` each have
     two, and one of each takes a tenant as an argument. */
  const rpcsFromCatalogue = fns => {
    const out = {};
    for (const f of fns) {
      const grants = String(f.acl || '').split('|')
        .map(e => e.trim().split('=')[0].trim())
        .filter(r => r && r !== 'postgres');
      const prev = out[f.name];
      out[f.name] = {
        secdef:    Boolean(f.secdef) || Boolean(prev && prev.secdef),
        tenantArg: /tenant/i.test(String(f.args || '')) || Boolean(prev && prev.tenantArg),
        grants:    [...new Set([...(prev ? prev.grants : []), ...grants])].sort(),
      };
    }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
  };
  const next = { ...SNAPSHOT,
    takenAt: (live.cat && live.cat.takenAt) || new Date().toISOString().replace(/\.\d+/, ''),
    source: live.how || 'PostgREST OpenAPI root',
    relations: Object.fromEntries(Object.entries(RELATIONS).map(([k, v]) => [k, v.join(',')])),
    rpcs: (live.cat && Array.isArray(live.cat.functions))
      ? rpcsFromCatalogue(live.cat.functions)
      : SNAPSHOT.rpcs };
  const block = '/* ==NEXUS-SCHEMA-SNAPSHOT-BEGIN== */\nconst SNAPSHOT = '
    + JSON.stringify(next, null, 2) + ';\n';
  await writeFile(new URL(import.meta.url), self.slice(0, A) + block + self.slice(B));
  console.log(`snapshot refreshed from ${live.how || 'PostgREST'} — ${Object.keys(RELATIONS).length} relations`);
  process.exit(0);
}
if (flag('--print-sql')) { console.log(CATALOGUE_SQL); process.exit(0); }

/* ══════════════════════════════════════════════════════════════════════════
   LANE 1 — OFFLINE, SOURCE
   ══════════════════════════════════════════════════════════════════════════ */

/* ── S1 · nav ↔ screen registry parity ─────────────────────────────────────
   The old gate carried its own list of fourteen screen ids and its own literal
   `nav === 14`. Both drifted the day the Action Center landed. Neither exists
   any more: the navigation is the source and the gate agrees with it by
   construction. */
{
  const bad = [];
  const registered = new Map();
  for (const [path, { code }] of screenSrc) {
    const ids = [...code.matchAll(/SCREENS\.([a-z0-9_]+)\s*=/g)].map(m => m[1]);
    if (!ids.length) bad.push(`${path}: registers no SCREENS.<id>`);
    ids.forEach(id => registered.set(id, path));
  }
  for (const id of NAV_IDS) if (!registered.has(id)) bad.push(`lib/nav.js offers "${id}" and no screen module registers it`);
  for (const [id, path] of registered) if (!NAV_IDS.includes(id)) bad.push(`${path} registers "${id}" which the navigation never offers`);
  verdict('S1', LANE.SOURCE, 'P0', 'Navigation and screen registry agree', bad,
    [`${NAV_IDS.length} nav entries, ${registered.size} registered screens, parsed from lib/nav.js: ${NAV_IDS.join(', ')}`]);
}

/* ── S2 · helper-contract lint ─────────────────────────────────────────────
   Extended from screens/ to lib/ and app.js. Each banned construct has exactly
   one owner in this codebase, named here so an exception is a decision rather
   than an oversight. */
const OWNER = {
  fetch:        new Set(['lib/data.js', 'lib/integrations.js']),
  localStorage: new Set(['lib/prefs.js']),
  classify:     new Set(['lib/health.js']),
};
{
  const BANNED = [
    [/Math\.random\s*\(/,      'Math.random() — invented data', () => true],
    [/\bfetch\s*\(/,           'raw fetch() — db/dbWrite/n8n own the network', p => !OWNER.fetch.has(p)],
    [/<style[\s>]/i,           'inline <style> — styles.css owns styling', () => true],
    [/localStorage\./,         'direct localStorage — lib/prefs.js owns that', p => !OWNER.localStorage.has(p)],
    [/from\s+['"]https?:/,     'remote import', () => true],
    [/\beval\s*\(|new\s+Function\s*\(/, 'eval / new Function', () => true],
  ];
  const bad = [];
  for (const [path, { code }] of SRC)
    for (const [re, why, applies] of BANNED)
      if (applies(path) && re.test(code)) bad.push(`${path}: ${why}`);
  verdict('S2', LANE.SOURCE, 'P0', 'Nobody reached outside the helper contract', bad,
    [`${SRC.size} source files linted (screens, lib and app.js)`]);
}

/* ── S3 · every query names columns the database has ───────────────────────
   The relation and column map comes from RELATIONS above, which is live when a
   connection exists and the snapshot otherwise. OFFLINE, an unknown column is
   deliberately NOT a failure: it is indistinguishable from a snapshot that has
   fallen behind, and treating it as a failure is precisely how this gate came
   to report three columns that exist as missing. It is reported, loudly, as
   unverified — and the same finding is a hard failure the moment the catalogue
   is live. */
const REST_PATHS = [];
{
  const joinConcat = (code, from) => {
    let i = from, out = '';
    const re = /^\s*\+\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/;
    for (;;) { const m = re.exec(code.slice(i)); if (!m || m[2].includes('${')) break; out += m[2]; i += m[0].length; }
    return out;
  };
  for (const [path, { code }] of SRC) {
    /* dbWrite takes the HTTP verb first — dbWrite('POST', `rpc/${fn}`, body). The
       optional verb group backtracks and captures 'POST' as the path whenever the
       real path is a template the first pattern cannot hold, so a verb is never a
       relation. Four such phantoms were being reported before this line existed;
       a checker that invents four missing tables is not read on the day it finds
       a real one. */
    const isVerb = q => /^(GET|POST|PATCH|PUT|DELETE)$/.test(q);
    for (const m of code.matchAll(/\bdb(?:Write)?\(\s*(?:'[A-Z]+'\s*,\s*)?[`'"]([^`'"$]+)[`'"]/g)) {
      const q = m[1] + joinConcat(code, m.index + m[0].length);
      if (!isVerb(q)) REST_PATHS.push({ path, q });
    }
    for (const m of code.matchAll(/\bdb(?:Write)?\(\s*(?:'[A-Z]+'\s*,\s*)?`([^`]*?)\$\{/g))
      if (m[1].includes('?') || m[1].startsWith('rpc/')) REST_PATHS.push({ path, q: m[1] });
  }
  const bad = [], seen = new Set();
  for (const { path, q } of REST_PATHS) {
    const clean = q.replace(/[&?][a-z_0-9.]+=(eq|gte|lte|gt|lt|ilike|like|in|is|neq|not)?\.?$/i, '')
                   .replace(/[&?]limit=$/, '').replace(/,+(?=&|$)/, '').replace(/[&?]$/, '');
    const rel = clean.split('?')[0].replace(/\/$/, '');
    const key = path + '|' + clean;
    if (seen.has(key)) continue; seen.add(key);
    if (rel === 'rpc' || rel === 'rpc/') continue;   // dbWrite('POST', `rpc/${fn}`) — the name is a variable
    if (rel.startsWith('rpc/')) {
      const fn = rel.slice(4);
      if (!RPC_NAMES.has(fn)) bad.push(`${path}: rpc/${fn} is not a function in this database`);
      continue;
    }
    if (!RELATIONS[rel]) { bad.push(`${path}: relation "${rel}" does not exist`); continue; }
    const sel = new URLSearchParams(clean.split('?')[1] || '').get('select');
    if (!sel) continue;
    for (const raw of sel.replace(/\w+\s*\([^()]*\)/g, '').split(',')) {
      const c = raw.trim().split(':').pop().split('::')[0].trim();
      if (!c || c === '*') continue;
      if (!RELATIONS[rel].includes(c)) bad.push(`${path}: ${rel}.${c} does not exist`);
    }
  }
  const ev = [`${seen.size} distinct PostgREST paths extracted from ${SRC.size} files`,
              `column map: ${SCHEMA_IS_LIVE ? 'LIVE' : 'SNAPSHOT'} (${SCHEMA_TAKEN}), ${Object.keys(RELATIONS).length} relations`];
  if (!bad.length) PASS('S3', LANE.SOURCE, 'P0', 'Every query names a relation and columns that exist', ev);
  else if (SCHEMA_IS_LIVE) FAIL('S3', LANE.SOURCE, 'P0', 'Every query names a relation and columns that exist', bad.concat(ev));
  else record('S3', LANE.SOURCE, 'P0', 'Every query names a relation and columns that exist', 'WARN',
    bad.concat(ev), 'checked against the embedded snapshot, not the live catalogue: a name this map does not know may be a real defect OR a stale snapshot, and offline the two are indistinguishable. Re-run with NEXUS_DB_URL to make this authoritative.');
}

/* ── S4 · the browser never says which dealership it is ────────────────────
   Tenancy is enforced by RLS. A query that carries its own tenant_id filter, or
   a write that posts one, would mean the browser is doing the scoping — and a
   filter the browser applies is a filter an operator can remove in devtools.
   CLAUDE.md states the rule in the sentence the tenant pill shows the user:
   "Rows belonging to any other dealership are refused by the database, not
   filtered here." This check is that sentence, made falsifiable. */
{
  const bad = [];
  for (const { path, q } of REST_PATHS)
    if (/[?&]tenant_id=/.test(q)) bad.push(`${path}: query scopes itself by tenant_id — "${q.slice(0, 90)}"`);
  for (const [path, { code }] of SRC) {
    if (path === 'lib/tenant.js') continue;   // reads tenant_members to LABEL the session; scopes nothing
    for (const m of code.matchAll(/dbWrite\([\s\S]{0,400}?tenant_id\s*:/g))
      bad.push(`${path}: a write composes its own tenant_id — the database must stamp it`);
  }
  verdict('S4', LANE.SOURCE, 'P0', 'No browser-side tenant scoping', bad,
    ['no db() path filters on tenant_id; no dbWrite() body composes one; lib/tenant.js reads membership to label the session only']);
}

/* ── S5 · a missing economic input never becomes a zero ────────────────────
   The four figures below each have a `_state` companion in the sentinel view
   precisely because NULL means "nobody could compute this", not "this is zero".
   Live today all four are NULL on all twelve units. `|| 0`, `?? 0` or
   `Number(x) || 0` on any of them converts "unknown" into a number a dealership
   would act on. */
const ECON_UNKNOWNABLE = ['holding_cost_accrued_aed', 'net_margin_aed', 'market_price_aed',
                          'recovered_value_aed', 'holding_cost_per_day_aed', 'outcome_sale_amount_aed'];
{
  const bad = [], soft = [];
  const zero = /(\|\||\?\?)\s*0\b/;
  for (const [path, { code }] of SRC) {
    code.split('\n').forEach((line, i) => {
      for (const f of ECON_UNKNOWNABLE)
        if (line.includes(f) && zero.test(line))
          bad.push(`${path}:${i + 1}: "${f}" with a zero fallback — ${line.trim().slice(0, 110)}`);
      /* engine_impact_aed is graded separately and on purpose: impact_kind NONE
         carries a null impact that genuinely means no exposure, so a zero there
         is arithmetic rather than a fabrication. It is still surfaced, because a
         headline that sums exposure across a mixed set cannot tell "no exposure"
         from "not computed" either. */
      if (/engine_impact_aed|(?<![a-z_])impact_aed/.test(line) && zero.test(line))
        soft.push(`${path}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  verdict('S5', LANE.SOURCE, 'P0', 'No zero substituted for an uncomputable economic figure', bad,
    [`${ECON_UNKNOWNABLE.length} unknownable figures checked across ${SRC.size} files`,
     'live evidence: holding_cost_accrued_aed and net_margin_aed are NULL on 12 of 12 units']);
  if (soft.length) WARN('S5b', LANE.SOURCE, 'P1', 'Exposure totals coalesce a null impact to zero', soft.concat([
    'Defensible — impact_kind NONE means no exposure — but a total built this way cannot distinguish "no exposure" from "not computed". Partition by impact_kind before summing if that distinction ever has to hold.']));
}

/* ── S6 · every state the engine can emit is handled, one way or another ──
   The sentinel answers in closed vocabularies. A state a screen neither names,
   nor covers with an UNKNOWN-family guard, nor prints verbatim, renders as a
   blank — or falls through to a numeric branch, which is worse.

   The first version of this check demanded the literal string for every value,
   and failed the build over `INSUFFICIENT` because screens/inventory.js prints
   `enquiry_coverage` verbatim rather than branching on it. Printing the
   database's own word IS handling it, and often the honest way to handle it.
   Demanding a literal that correct code has no reason to contain is the same
   cry-wolf failure this whole rewrite exists to end, so the check now asks
   whether the state can reach the reader, not whether a constant is present. */
{
  const VOCAB = {
    holding_cost_state: ['NOT_COMPUTABLE'],
    net_margin_state:   ['NOT_COMPUTABLE'],
    market_position:    ['UNKNOWN_NO_COMPARABLE', 'UNKNOWN_UNVERIFIED_COMPARABLE', 'UNKNOWN_STALE_COMPARABLE', 'UNKNOWN_NO_PRICE'],
    demand_signal:      ['UNKNOWN_LOW_COVERAGE'],
    enquiry_coverage:   ['INSUFFICIENT'],
  };
  /* Partitioning on the ONE value that means "this was computed" handles every
     other value by complement, and is stronger than naming them: it stays
     correct when the engine gains a state nobody here has heard of.
     screens/overview.js does exactly this — stateCount(sentinel,
     'holding_cost_state', 'COMPUTED') — and the first version of this check
     failed it for not containing a literal it has no need of. */
  const POSITIVE = { holding_cost_state: ['COMPUTED'], net_margin_state: ['COMPUTED'],
                     enquiry_coverage: ['SUFFICIENT'], demand_signal: ['ENQUIRIES'] };
  const bad = [], how = [];
  for (const [col, values] of Object.entries(VOCAB)) {
    const readers = [...SRC].filter(([, v]) => v.code.includes(col));
    if (!readers.length) continue;               // not surfaced anywhere; nothing to handle
    for (const [path, { code }] of readers) {
      const named    = values.filter(v => code.includes(v));
      const unknownGuard = new RegExp(`${col}[\\s\\S]{0,160}?(startsWith\\(\\s*['"]UNKNOWN|\\/\\^UNKNOWN)`).test(code)
                        || new RegExp(`(startsWith\\(\\s*['"]UNKNOWN|\\/\\^UNKNOWN)[\\s\\S]{0,160}?${col}`).test(code);
      const verbatim = new RegExp(`(esc\\(|str\\(|up\\(|pill\\()[^\\n]*\\.${col}\\b`).test(code)
                    || new RegExp(`\\.${col}\\b[^\\n]*verbatim`).test(code);
      const complement = (POSITIVE[col] || []).some(v =>
        new RegExp(`['"]${v}['"]`).test(code) && code.includes(col));
      const missing  = values.filter(v => !named.includes(v));
      if (!missing.length)      { how.push(`${path}: ${col} — every value named`); continue; }
      if (complement)           { how.push(`${path}: ${col} — partitioned on the computed value, so every other state is handled by complement`); continue; }
      if (unknownGuard && missing.every(v => v.startsWith('UNKNOWN')))
                                { how.push(`${path}: ${col} — UNKNOWN family covered by a prefix guard`); continue; }
      if (verbatim)             { how.push(`${path}: ${col} — printed verbatim, so any value reaches the reader`); continue; }
      bad.push(`${path}: reads ${col} but ${missing.join(', ')} would render as nothing — no literal, no UNKNOWN guard, no verbatim print`);
    }
  }
  verdict('S6', LANE.SOURCE, 'P0', 'Every state the engine emits reaches the reader', bad, how.length ? how : ['no screen reads a state column']);
}

/* ── S7 · no invented market data ──────────────────────────────────────────
   The engine holds no verified comparable for any unit on this lot. A screen
   that proposes a price, or hard-codes one, is inventing market data. */
{
  const bad = [];
  for (const [path, { code }] of SRC) {
    code.split('\n').forEach((line, i) => {
      if (/(market_price_aed|suggested_price|target_price|new_price|recommended_price)\s*[:=]\s*[0-9]/.test(line))
        bad.push(`${path}:${i + 1}: a market or suggested price assigned from a literal — ${line.trim().slice(0, 110)}`);
      if (/(suggested|proposed|recommended)_(price|reprice)_aed/.test(line))
        bad.push(`${path}:${i + 1}: a suggested price figure — the engine has no verified comparable and must not name one`);
    });
  }
  verdict('S7', LANE.SOURCE, 'P0', 'No invented or hard-coded market price', bad,
    ['REPRICE asks for a human price review; no screen names a figure']);
}

/* ── S8 · no authoritative finance figure is worked out in the browser ─────
   CLAUDE.md: APR, EMI, monthly payment and loan-to-value come from the
   calculator with a calculation_id and an execution_id behind them, or they do
   not appear — not even as "indicative".

   Two corrections to the first version of this check, both of which had it
   failing correct code. `ltv` matched `ltvSub`, a caption variable in
   screens/customers.js holding LIFETIME value, a completely different quantity
   that the browser is entitled to sum; the pattern now names loan-to-value
   explicitly. And the arithmetic test matched the `/` in a closing HTML tag, so
   any assignment of markup looked like a division; string and template contents
   are stripped before the line is tested for arithmetic. */
{
  const bad = [];
  const stripStrings = l => l.replace(/`(?:\\.|[^`\\])*`/g, '``')
                             .replace(/'(?:\\.|[^'\\])*'/g, "''")
                             .replace(/"(?:\\.|[^"\\])*"/g, '""');
  const target = /\b(apr|emi|monthly_?payment|instalment|installment|loan_to_value|loanToValue)\w*\s*=[^=]/i;
  const arith  = /[*/]|Math\.pow|\*\*/;
  for (const [path, { code }] of SRC) {
    code.split('\n').forEach((line, i) => {
      if (!target.test(line)) return;
      const bare = stripStrings(line);
      if (!target.test(bare) || !arith.test(bare)) return;
      bad.push(`${path}:${i + 1}: a finance figure derived in the browser — ${bare.trim().slice(0, 120)}`);
    });
    if (/monthly_payment_low_aed/.test(code) && !/calculation_id|execution_id|is_evidenced/.test(code))
      bad.push(`${path}: reads an instalment without reading the evidence columns that make it quotable`);
  }
  verdict('S8', LANE.SOURCE, 'P0', 'No finance figure is computed by the browser or by a model', bad,
    ['APR / EMI / monthly / LTV are read from finance_quotes with calculation_id and execution_id, never derived',
     'lifetime value in screens/customers.js is summed from purchase_history and is not a finance figure — excluded on purpose, by name']);
}

/* ── S9 · exposure is not recovery, and recovery names its sale ────────────
   PRODUCT.md: estimated, attributed and confirmed are three different words and
   must never be interchanged on a screen. inventory_actions carries the CHECK
   inventory_actions_recovered_needs_real_sale, read live from pg_constraint on
   3 Sep 2026:

     recovered_value_aed IS NULL
     OR (outcome_state = 'ATTRIBUTED' AND outcome_purchase_id IS NOT NULL
         AND attribution_basis IS NOT NULL AND recovered_value_basis IS NOT NULL)

   FOUR columns, not three. `recovered_value_basis` is in the constraint and was
   missing from the first reading of this rule; it is the column that says how
   the figure was arrived at, which is the difference between an attributed
   number and a typed one.

   A stored constraint is not a rendering rule, and this check is deliberately
   about the rendering. `recovered_value_aed != null` is a test of ONE column;
   the sentence beside it ("a recorded sale tied to it by a person",
   "attributed") is a claim about FOUR. A screen making the four-column claim on
   the one-column test has no way to notice when they disagree, and the figure
   it prints is money.

   THE FIRST VERSION OF THIS CHECK WAS TOO WEAK TO SURVIVE ITS OWN FIX. It
   looked for the strings `outcome_purchase_id`, `ATTRIBUTED` or `outcome_state`
   within eight lines of the render — so a file could satisfy it by MENTIONING
   one of the three anywhere nearby, including in a comment explaining why it
   did not need them. It is now structural and tests three things:

     A. the shared derivation exists and names all four columns in its own body;
     B. every file that renders recovered_value_aed as money routes through that
        derivation rather than composing its own;
     C. nowhere outside that derivation is recovered_value_aed used as a bare
        null test — which is the exact defect, written out.

   Rule C is the one that would have caught this on the day it was introduced. */
{
  const bad = [];
  const FOUR = ['outcome_state', 'outcome_purchase_id', 'attribution_basis', 'recovered_value_basis'];
  const HELPER = 'recoveryEvidence';

  /* The helper's own body, located by brace-matching from its declaration, so
     rule C can exempt it — it is the one place a null test on the amount is not
     only allowed but required, because it is what decides that there is no
     figure at all. Everywhere else the same line is the defect. */
  const helperRanges = new Map();          // path -> [start, end] line numbers, 0-based
  let helperDefined = false;
  for (const [path, { code }] of SRC) {
    const m = /(?:export\s+)?function\s+recoveryEvidence\s*\(/.exec(code);
    if (!m) continue;
    helperDefined = true;
    let i = code.indexOf('{', m.index), depth = 0, end = i;
    for (; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') { depth--; if (!depth) { end = i; break; } }
    }
    const body = code.slice(m.index, end + 1);
    const startLine = code.slice(0, m.index).split('\n').length - 1;
    const endLine   = code.slice(0, end).split('\n').length - 1;
    helperRanges.set(path, [startLine, endLine]);
    /* A. The derivation must name every column the caption claims. If it drifts
       back to three, everything downstream of it is wrong and silent. */
    const absent = FOUR.filter(c => !body.includes(c));
    if (absent.length)
      bad.push(`${path}: ${HELPER}() decides whether a recovered figure may be shown but never reads ${absent.join(', ')} — the database CHECK requires all four`);
    if (!/ATTRIBUTED/.test(body))
      bad.push(`${path}: ${HELPER}() never compares outcome_state to 'ATTRIBUTED'`);
  }

  for (const [path, { code }] of SRC) {
    const lines = code.split('\n');
    const inHelper = i => {
      const r = helperRanges.get(path);
      return Boolean(r) && i >= r[0] && i <= r[1];
    };
    const usesHelper = code.includes(HELPER);

    lines.forEach((line, i) => {
      if (!/recovered_value_aed/.test(line) || inHelper(i)) return;

      /* B. Rendered as money, totalled, filtered or reduced. */
      if (/aed\(|expose\(|filter\(|reduce\(/.test(line) && !usesHelper)
        bad.push(`${path}:${i + 1}: a recovered value is rendered or totalled in a file that never calls ${HELPER}(), so nothing tests the four columns its caption claims — ${line.trim().slice(0, 110)}`);

      /* C. The one-column test, named exactly. Any comparison of the amount to
         null, or a truthiness test on it, standing in for the evidence. */
      if (/recovered_value_aed\s*(?:!==?|===?)\s*null|null\s*(?:!==?|===?)\s*[\w.]*recovered_value_aed|n0\([^)]*recovered_value_aed[^)]*\)\s*(?:!==?|===?)\s*null|\?\s*[^:]*recovered_value_aed/.test(line))
        bad.push(`${path}:${i + 1}: recovered_value_aed is tested for null on its own — that is a claim about one column under a sentence that claims four; route it through ${HELPER}() — ${line.trim().slice(0, 110)}`);
    });

    /* Exposure must never be renamed into recovery, and must always carry the
       words that say what it is. Unchanged: both have held since they landed. */
    lines.forEach((line, i) => {
      if (/(engine_)?impact_aed/.test(line) && /\b(recovered|saved|expected revenue)\b/i.test(line))
        bad.push(`${path}:${i + 1}: exposure described as recovered/saved/expected — ${line.trim().slice(0, 110)}`);
    });
    if (/impact_aed/.test(code) && !/at risk/i.test(SRC.get(path).raw))
      bad.push(`${path}: shows engine impact with no "at risk" framing anywhere in the file`);
  }

  if (!helperDefined && [...SRC].some(([, { code }]) => /recovered_value_aed/.test(code)))
    bad.push(`no file defines ${HELPER}(), yet recovered_value_aed is read — the four-column test has no owner and cannot be checked`);

  verdict('S9', LANE.SOURCE, 'P0', 'Exposure is never called recovery, and recovery names its sale', [...new Set(bad)],
    [`${HELPER}() is the single derivation and reads all four columns the CHECK names: ${FOUR.join(', ')}`,
     `defined in ${[...helperRanges.keys()].join(', ') || 'nowhere'}; every render of recovered_value_aed routes through it`,
     'no bare null test on recovered_value_aed survives outside that function',
     'live: recovered_value_aed is null on all 3 inventory_actions rows, so a fabricated figure is latent, not visible today']);
}

/* ── S10 · one vocabulary for what a RUN did ───────────────────────────────
   INV-001. lib/health.js is the sole frontend mirror of nexus_outcome_class,
   and a screen comparing `status` itself is how Competitor Price Scraping
   showed a green "Clean, 30 d — 100.0%" pill through a month of finding nothing.

   Scoped, on the second pass, to files that actually READ an audit source. The
   first version matched any `status === 'REJECTED'` and so failed two files
   that are not doing this at all:
     · screens/actions.js compares inventory_actions.status — the ACTION
       LIFECYCLE, a different axis that the file's own header is at pains to
       keep separate. A rejected decision is a successfully recorded decision.
     · lib/deal-form.js compares delivery.status off the closed-won webhook's
       synchronous response — a delivery receipt to the operator who just
       pressed the button, not a stored audit row being classified.
   Neither is INV-001's failure mode, and failing them taught the reader to
   skim this section, which is where a real one would then have been missed. */
{
  const bad = [];
  const selfClassify = /(?:^|[^\w.])(?:status|st|audit_status)\s*===?\s*['"](FAILED|SUCCESS|PARTIAL|NOT_EXECUTED|REJECTED|ESCALATED)['"]/m;
  for (const [path, { code }] of SRC) {
    if (OWNER.classify.has(path)) continue;
    /* Detected from the QUERIES this file issues, not from the characters
       "audit_log" appearing anywhere in it. The first version searched the
       source text and so flagged screens/actions.js and lib/integrations.js,
       both of which merely mention audit_log in a sentence shown to the user
       inside a template literal. Prose is not a read. */
    const readsAudit = REST_PATHS.some(x => x.path === path &&
      /^(audit_log|v_workflow_health)(\?|$)/.test(x.q));
    if (!readsAudit) continue;
    if (selfClassify.test(code)) bad.push(`${path}: reads an audit source and classifies its status itself instead of through lib/health.js`);
    if (!/from\s+['"][^'"]*health\.js/.test(code)) bad.push(`${path}: reads an audit source without importing lib/health.js`);
  }
  /* The two axes must not be merged in the other direction either. */
  for (const [path, { code }] of SRC)
    if (/outcomeOf\s*\(\s*\{?\s*status\s*:\s*\w*(action|life)/i.test(code))
      bad.push(`${path}: an action lifecycle status is being classified as a run outcome`);
  const t = SRC.get('screens/actions.js');
  if (t && !/audit_outcome_class/.test(t.code))
    bad.push('screens/actions.js: the timeline does not read audit_outcome_class — it would have to re-derive the class the view already computes');
  verdict('S10', LANE.SOURCE, 'P0', 'One outcome vocabulary, and it is not the action lifecycle', [...new Set(bad)],
    ['every file that reads audit_log or v_workflow_health imports lib/health.js and classifies through it',
     'screens/actions.js reads audit_outcome_class from v_inventory_action_timeline rather than re-deriving it',
     'the action lifecycle and the run outcome are never passed through each other']);
}

/* ══════════════════════════════════════════════════════════════════════════
   LANE 2 — OFFLINE, RENDERED
   Headless Chromium against a stubbed PostgREST. No credentials, no network.
   ══════════════════════════════════════════════════════════════════════════ */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const STUB_URL = 'https://example.supabase.co';
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');

/* Row fabrication is driven by RELATIONS, so a new column appears in the stub
   the moment it appears in the database. Only the truth-critical shapes below
   are stated by hand, and each is stated because a screen must be caught
   getting it wrong. */
const VALUE = {
  id: 'NX-1004', unit_id: 'NX-1004', action_id: '00000000-0000-4000-8000-000000000010',
  customer_id: '25', name: 'Test Row', lead_name: 'Test Row', full_name: 'Test Row',
  customer_name: 'Test Row', unit_model: 'Land Cruiser', model: 'Land Cruiser',
  competitor: 'Al Futtaim Toyota', doc_title: 'Refund policy',
  email: 'ali@example.com', lead_email: 'ali@example.com', phone: '+971500000000',
  push_name: 'Ali', display_name: 'Test Row', identified: 'lead',
  chat_id: '971500000000@c.us', thread_key: '971500000000@c.us', message_id: 'ABC123',
  role: 'senior_rep', tenant_role: 'owner', staff_role: 'senior_rep',
  status: 'HOT', lead_status: 'HOT', latest_status: 'HOT', unit_status: 'Available',
  verdict: 'APPROVED', severity: 'HOT', kind: 'unanswered_chat', slug: 'alba-cars',
  runs_30d: 96, failures_30d: 0, partials_30d: 0, no_result_30d: 84, rejected_30d: 0,
  escalated_30d: 0, successes_30d: 12, unknown_30d: 0, effective_runs_30d: 96,
  success_rate_30d: 12.5, success_rate: 12.5, runs: 96, failures: 0, escalations: 0,
  health: 'PRODUCING_NOTHING', screen: 'conversations', ref: 'NX-1010',
  detail: 'Waiting since 19 Aug', direction: 'inbound', last_direction: 'inbound',
  message: 'hello there', last_message: 'hello there', channel: 'whatsapp', source: 'whatsapp',
  vin: 'JTMHV05J104123456', vehicle: '2024 Toyota Land Cruiser',
  vehicle_interest: '2024 Toyota Land Cruiser', aging_alert: 'CRITICAL', aging_band: 'CRITICAL',
  category: 'Lead', trigger_type: 'webhook', trigger_detail: 'whatsapp-inbound',
  workflow: 'WhatsApp BDC Agent', audit_name: 'WhatsApp BDC Agent', audit_aliases: [],
  summary: 'Completed', intent: 'Buying', description: 'Handles inbound WhatsApp',
  content: 'Refunds are processed within 14 days.', section: 'Policy',
  source_file: 'policy.pdf', remarks: 'Looks clean', document_type: 'Passport',
  equity_status: 'POSITIVE', finance_tier: 'A', disclaimer: 'Indicative only',
  quoted_by: 'ali@example.com', ai_recommendation: 'Hold', assigned_to: 'Test Rep',
  slack_user_id: 'U123', void_reason: null, voided_at: null, purged_at: null,
  storage_path: 'kyc/x/2026/08/a.jpg', search_vector: null, embedding: null,
  is_valid: true, tampering: false, is_active: true, is_vip: true,
  writes_audit_log: true, awaiting_reply: true, awaiting_msg_reply: true,
  match_quality: 'MODEL_TOKEN', source_kind: 'listing', source_host: 'dubizzle.com',
  event: 'PROPOSED', audit_status: 'SUCCESS', audit_outcome_class: 'SUCCESS',
  audit_summary: 'Inventory action · unit NX-1004 · REPRICE · Proposed',
  actor_authority: 'ACCOUNT_OWNER', decided_by_authority: 'ACCOUNT_OWNER',
  applies_to: 'REJECT', label: 'The engine was wrong', code: 'ENGINE_WRONG',
  meaning: 'The recommendation did not fit this unit.', engine_was_wrong: true, sort: 1,
};
function fabricate(rel) {
  const row = {};
  for (const c of (RELATIONS[rel] || [])) {
    if (c in VALUE) { row[c] = VALUE[c]; continue; }
    if (/(_at|_date|^at$)$/.test(c) || /^(last|first)_/.test(c)) row[c] = '2026-08-01T00:00:00Z';
    else if (/^(is_|has_|awaiting_|may_|settings_are_)/.test(c)) row[c] = true;
    else if (/(_aed|_pct|_score|_count|_minutes|_number|count|runs|failures|escalations|_margin|_rank|_days|days_in_stock|holding_cost_accrued|success_rate|page_number|credit_score)/.test(c)) row[c] = 120000;
    else row[c] = 'Test Row';
  }
  return row;
}

/* THE SENTINEL ROW THE GATE INSISTS ON.
   This is the live shape on 2 September 2026: twelve units, and not one
   computable economic figure. Every field a screen might be tempted to render
   as zero is null here, and its state column says why. If a screen turns any of
   these into "AED 0" or "0.0%", R4 catches it. */
const SENTINEL_UNKNOWN = {
  holding_cost_accrued_aed: null, holding_cost_state: 'NOT_COMPUTABLE',
  holding_cost_note: 'No holding rate is on record for this dealership.',
  holding_cost_per_day_aed: null, holding_cost_basis: null, holding_cost_source: null,
  holding_cost_set_by: null, holding_cost_verified_at: null,
  net_margin_aed: null, net_margin_state: 'NOT_COMPUTABLE',
  net_margin_note: 'Gross margin is known; net is not, because holding cost is not.',
  market_position: 'UNKNOWN_NO_COMPARABLE', market_price_aed: null, market_competitor: null,
  market_match_quality: null, market_scraped_at: null,
  market_note: 'No comparable listing this engine is willing to stand behind.',
  demand_signal: 'UNKNOWN_LOW_COVERAGE', enquiry_coverage: 'INSUFFICIENT',
  enquiries_in_window: 0, enquiry_leads: 0, enquiry_messages: 0, enquiry_last_at: null,
  enquiry_note: 'Too few resolved enquiry rows to say anything about demand.',
  confidence: 'MEDIUM', confidence_basis: 'Age and gross margin are real; market and demand are unknown.',
  impact_kind: 'MARGIN_EXPOSED', impact_aed: 48000,
  impact_basis: 'Gross margin sitting in a unit that has not sold.',
  recommendation: 'REPRICE', reason: 'Ageing past the warning threshold.',
  gross_margin_aed: 48000, gross_margin_pct: 12.5, cost_aed: 340000, price_aed: 388000,
  automation_state: 'MANUAL_ONLY', human_approval_required: true, settings_are_defaults: true,
};

function stubRest(url, method, body) {
  const u = new URL(url);
  const seg = u.pathname.split('/rest/v1/')[1] || '';
  const name = seg.split('?')[0].replace(/\/$/, '');

  if (name.startsWith('rpc/')) {
    const fn = name.slice(4);
    if (!RPC_NAMES.has(fn)) return { status: 404, body: { code: 'PGRST202', message: `Could not find the function public.${fn}` } };
    if (fn === 'sentinel_inventory_actions')
      return { status: 200, body: [{ ...fabricate('v_inventory_profit_sentinel'), ...SENTINEL_UNKNOWN, id: 'NX-1011', vin: 'JTMHV05J104123999' }] };
    if (fn === 'action_approver_context')
      /* may_decide FALSE on purpose. R7 requires the screen to render the
         controls disabled with the database's refusal on them, not hide them. */
      return { status: 200, body: [{ auth_user_id: 'u1', tenant_id: 't1', tenant_role: 'member',
        staff_id: 's1', staff_name: 'Ali Asgher', staff_role: 'senior_rep', may_decide: false,
        authority: null, refusal_code: 'NOT_AN_APPROVER',
        refusal_reason: 'This account is neither an account owner nor a manager, so it may not decide inventory actions.',
        tenant_has_any_approver: true, approver_tenant_roles: ['owner'], approver_staff_roles: ['manager'] }] };
    if (fn.startsWith('action_'))
      return { status: 200, body: [{ ok: false, idempotent: false, refusal_code: 'NOT_AUTHORISED',
        refusal_reason: 'Refused by the database.', action: null }] };
    return { status: 200, body: [] };
  }

  if (!RELATIONS[name])
    return { status: 404, body: { code: '42P01', message: `relation "public.${name}" does not exist`,
      hint: 'The schema map is derived from the database — if this relation is real, refresh with --refresh-schema.' } };

  const sel = u.searchParams.get('select');
  if (sel != null) {
    if (/,\s*$/.test(sel) || sel.trim() === '')
      return { status: 400, body: { code: 'PGRST100', message: `"failed to parse select parameter (${sel})"` } };
    for (const raw of sel.replace(/\w+\s*\([^()]*\)/g, '').split(',')) {
      const c = raw.trim().split(':').pop().split('::')[0].trim();
      if (!c || c === '*') continue;
      if (!RELATIONS[name].includes(c))
        return { status: 400, body: { code: '42703', message: `column ${name}.${c} does not exist` } };
    }
  }

  const row = fabricate(name);
  if (name === 'tenants') return { status: 200, body: [{ ...row, id: 't1', name: 'ALBA CARS', slug: 'alba-cars', status: 'active', is_unattributed_default: true }] };
  if (name === 'tenant_members') return { status: 200, body: [{ tenant_id: 't1', auth_user_id: 'u1', role: 'member', staff_user_id: 's1', created_at: '2026-09-01T00:00:00Z' }] };

  if (name === 'v_inventory_profit_sentinel')
    return { status: 200, body: [{ ...row, ...SENTINEL_UNKNOWN },
      { ...row, ...SENTINEL_UNKNOWN, id: 'NX-1005', market_position: 'UNKNOWN_UNVERIFIED_COMPARABLE',
        market_price_aed: 372000, market_competitor: 'Pardon Our Interruption', market_match_quality: 'WEAK',
        market_note: 'A listing exists but this engine will not stand behind the match.' },
      { ...row, ...SENTINEL_UNKNOWN, id: 'NX-1006', recommendation: 'HOLD', impact_kind: 'NONE', impact_aed: null }] };

  if (name === 'v_inventory_action_queue') {
    /* One row per lifecycle state, so R6 can see that each has its own words,
       plus the hostile row: a recovered value with nothing behind it. The
       database CHECK inventory_actions_recovered_needs_real_sale makes that row
       impossible to store — which is exactly why the screen must be tested
       against it, because a CHECK is not a rendering rule. */
    const base = { ...row, ...SENTINEL_UNKNOWN, recovered_value_aed: null, recovered_value_basis: null,
      outcome_state: 'NONE_YET', outcome_purchase_id: null, attribution_basis: null, attribution_note: null,
      outcome_sale_amount_aed: null, outcome_sale_vehicle: null, outcome_sale_date: null,
      outcome_sentence: 'No sale has been tied to this action.', cost_of_doing_nothing: null,
      engine_impact_aed: 48000, engine_impact_kind: 'MARGIN_EXPOSED', engine_still_agrees: true,
      execution_failure: null, escalated_at: null, escalation_reason: null, defer_until: null };
    const at = (id, o) => ({ ...base, id, ...o });
    return { status: 200, body: [
      at('a-proposed', { status: 'PROPOSED', is_live: true, awaiting_decision: true, decided_at: null, executed_at: null }),
      at('a-approved', { status: 'APPROVED', is_live: true, awaiting_decision: false, executed_at: null }),
      at('a-rejected', { status: 'REJECTED', is_live: false, awaiting_decision: false, executed_at: null,
        decision_reason_code: 'ENGINE_WRONG', decision_reason_label: 'The engine was wrong', decision_says_engine_was_wrong: true }),
      at('a-deferred', { status: 'DEFERRED', is_live: true, awaiting_decision: false, executed_at: null, deferral_now_due: true, defer_until: '2026-09-10' }),
      at('a-executed', { status: 'EXECUTED', is_live: false, awaiting_decision: false, outcome_state: 'AWAITING_OUTCOME' }),
      at('a-failed',   { status: 'EXECUTION_FAILED', is_live: false, awaiting_decision: false, execution_failure: 'The listing could not be updated.' }),
      at('a-cancelled',{ status: 'CANCELLED', is_live: false, awaiting_decision: false, executed_at: null }),
      /* THE FABRICATED RECOVERY. Nothing behind it. Must not render as money.

         TWO of them, and the second is not padding. The Action Center renders a
         closed action as a TABLE ROW and a live one as a CARD, and those are two
         different code paths reading the same column. Serving only the closed
         one meant R5 proved the table cell and never touched the card footer —
         the site that carries the full sentence — so half the fix was untested
         by the check that exists to test it. The open one is PROPOSED, which is
         a state no real row could combine with a recovered value; that is the
         point, because a CHECK the screen cannot see is not a rendering rule. */
      at('a-forged',   { status: 'EXECUTED', is_live: false, awaiting_decision: false,
        outcome_state: 'NONE_YET', outcome_purchase_id: null, attribution_basis: null,
        recovered_value_basis: null, recovered_value_aed: 250000 }),
      at('a-forged-open', { status: 'PROPOSED', is_live: true, awaiting_decision: true,
        decided_at: null, executed_at: null,
        outcome_state: 'NONE_YET', outcome_purchase_id: null, attribution_basis: null,
        recovered_value_basis: null, recovered_value_aed: 250000 }),
      /* And the honest counterpart: a row that carries all four columns. It must
         still render as money — a guard that refuses everything is not a guard,
         it is a screen that has stopped reporting, and it would pass R5 while
         hiding a real recovered figure from the dealership that earned it. */
      at('a-attributed', { status: 'EXECUTED', is_live: false, awaiting_decision: false,
        outcome_state: 'ATTRIBUTED', outcome_purchase_id: 'ph-1',
        attribution_basis: 'STAFF_LINKED_SALE', recovered_value_basis: 'GROSS_MARGIN_ON_LINKED_SALE',
        recovered_value_aed: 137500, outcome_sale_vehicle: 'Land Cruiser', outcome_sale_amount_aed: 585000,
        outcome_sale_date: '2026-08-14', outcome_sentence: 'A recorded sale was tied to this action by a person.' }),
    ] };
  }

  if (name === 'inventory')
    return { status: 200, body: [
      { ...row, holding_cost_accrued: null, net_margin: null, recommended_commission: null },
      { ...row, id: 'NX-1005', holding_cost_accrued: null, net_margin: null, recommended_commission: null }] };

  if (name === 'inventory_profit_settings')
    return { status: 200, body: [{ ...row, tenant_id: 't1', holding_cost_per_day_aed: null,
      holding_cost_basis: null, holding_cost_source: null, holding_cost_set_by: null, holding_cost_verified_at: null }] };

  if (name === 'kyc_documents') return { status: 200, body: [
    row,
    { ...row, id: 'k2', void_reason: 'not a document — greeting image auto-routed to the auditor',
      voided_at: '2026-08-24T00:00:00Z', document_type: 'Religious Banner', verdict: 'APPROVED', confidence_score: 100 },
    { ...row, id: 'k3', purged_at: '2026-08-20T00:00:00Z' },
    { ...row, id: 'k4', storage_path: null }] };

  if (name === 'v_workflow_health') {
    const wf = (id, nm, o) => ({ ...row, id, name: nm, ...o });
    return { status: 200, body: [row,
      wf('wf-degraded', 'Customer 360 - Data Aggregation', { health: 'DEGRADED', runs_30d: 23, failures_30d: 2, partials_30d: 12, no_result_30d: 0, successes_30d: 9, effective_runs_30d: 23, success_rate_30d: 39.1, runs: 23, failures: 2, success_rate: 39.1 }),
      wf('wf-healthy', 'Inventory Ageing Recompute', { health: 'HEALTHY', runs_30d: 17, failures_30d: 0, partials_30d: 0, no_result_30d: 0, successes_30d: 17, effective_runs_30d: 17, success_rate_30d: 100, runs: 17, failures: 0, success_rate: 100 }),
      wf('wf-norate', 'Ask-AI - RAG Query Agent', { health: 'NO_QUALIFYING_RUNS', runs_30d: 3, failures_30d: 0, partials_30d: 0, no_result_30d: 0, rejected_30d: 3, successes_30d: 0, effective_runs_30d: 0, success_rate_30d: null, runs: 3, failures: 0, success_rate: null }),
      wf('wf-uninstrumented', 'NEXUS Error Handler', { health: 'NOT_INSTRUMENTED', writes_audit_log: false, runs_30d: 0, failures_30d: 0, partials_30d: 0, no_result_30d: 0, rejected_30d: 0, escalated_30d: 0, successes_30d: 0, unknown_30d: 0, effective_runs_30d: 0, success_rate_30d: null, runs: 0, failures: 0, success_rate: null, last_run: null, last_success: null, last_failure: null, last_partial: null, last_incomplete: null }),
      wf('wf-neverran', 'NEXUS Retention Purge', { health: 'NEVER_RAN', runs_30d: 0, failures_30d: 0, partials_30d: 0, no_result_30d: 0, rejected_30d: 0, escalated_30d: 0, successes_30d: 0, unknown_30d: 0, effective_runs_30d: 0, success_rate_30d: null, runs: 0, failures: 0, success_rate: null, last_run: null, last_success: null, last_failure: null, last_partial: null, last_incomplete: null })] };
  }

  if (name === 'competitors' || name === 'v_competitor_latest') return { status: 200, body: [
    row,
    { ...row, id: 98, competitor: 'null', price_aed: null, price_diff_aed: null, match_quality: 'NONE' },
    { ...row, id: 99, competitor: 'Pardon Our Interruption', price_aed: null, price_diff_aed: null, match_quality: 'NONE' }] };

  if (name === 'v_inventory_action_timeline') return { status: 200, body: [
    { ...row, event: 'PROPOSED', audit_status: 'SUCCESS', audit_outcome_class: 'SUCCESS' },
    { ...row, id: 'ev2', event: 'DECISION_CONFLICT', audit_status: 'REJECTED', audit_outcome_class: 'REJECTED_EXPECTED' }] };

  return { status: 200, body: [row, row] };
}

async function serve(root, port) {
  return new Promise(res => {
    const s = createServer(async (req, rq) => {
      const p = join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
      try {
        const b = await readFile(p);
        rq.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
        rq.end(b);
      } catch { rq.writeHead(404); rq.end('nope'); }
    });
    s.listen(port, () => res(s));
  });
}

/* ── build ────────────────────────────────────────────────────────────────
   With the app's own environment contract satisfied. Building without it is
   what made every previous run report fourteen failing screens: lib/env.js
   raises a configuration error, app.js paints it and returns before boot, and
   the gate graded an empty page as fourteen broken ones. */
const BUILD_ENV = {
  ...process.env,
  VITE_SUPABASE_URL: STUB_URL,
  VITE_SUPABASE_ANON_KEY: 'gate-stub-anon-key-' + 'x'.repeat(48),
  VITE_N8N_BASE_URL: 'https://example.invalid',
};
console.log('=== build ===');
try {
  execFileSync('node_modules/.bin/vite', ['build', '--outDir', 'dist', '--logLevel', 'error'],
    { cwd: HERE, stdio: 'inherit', env: BUILD_ENV });
  console.log('  built with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_N8N_BASE_URL set');
} catch {
  FAIL('R0', LANE.RENDER, 'P0', 'The bundle builds', ['vite build failed — refusing to grade a stale bundle']);
  report(); process.exit(3);
}
PASS('R0', LANE.RENDER, 'P0', 'The bundle builds, and the gate builds it', ['vite build, fresh, with the app environment contract satisfied']);

let render = null;
try {
  const { chromium } = await import('playwright');
  const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH
    || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
  const srv = await serve(join(HERE, 'dist'), 8071);
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage();
  const errs = [];
  const rejections = [];
  let restCalls = 0;
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, body: '', contentType: 'text/css' }));
  await page.route(`${STUB_URL}/auth/v1/**`, r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ id: 'u1', email: 'ali@example.com', role: 'authenticated' }) }));
  await page.route(`${STUB_URL}/rest/v1/**`, r => {
    restCalls++;
    const out = stubRest(r.request().url(), r.request().method(), r.request().postData());
    if (out.status !== 200) rejections.push(`${out.status} ${out.body.code || ''} ${out.body.message}`);
    r.fulfill({ status: out.status, contentType: 'application/json', body: JSON.stringify(out.body) });
  });
  await page.route('https://example.invalid/**', r => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ output: 'stubbed answer', sources: [] }) }));

  /* A real, well-formed JWT. supabase-js decodes the payload; the previous
     `stub.jwt.token` is not base64url JSON, so getSession() produced nothing and
     the app fell through to the login screen. */
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = [b64u({ alg: 'HS256', typ: 'JWT' }),
               b64u({ sub: 'u1', email: 'ali@example.com', role: 'authenticated', aud: 'authenticated', exp, iat: exp - 3600, app_metadata: {}, user_metadata: {} }),
               'gate-stub-signature'].join('.');
  await page.addInitScript(([t, e]) => {
    localStorage.setItem('sb-example-auth-token', JSON.stringify({
      access_token: t, token_type: 'bearer', expires_in: 3600, expires_at: e, refresh_token: 'r',
      user: { id: 'u1', email: 'ali@example.com', aud: 'authenticated', role: 'authenticated',
              app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }));
  }, [jwt, exp]);

  await page.goto('http://127.0.0.1:8071/', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const loggedIn = await page.evaluate(() => !document.getElementById('app').classList.contains('hide'));
  const nav = await page.evaluate(() => document.querySelectorAll('.nav-item').length);
  const bootText = await page.evaluate(() => (document.getElementById('boot').innerText || '').slice(0, 200));

  const screens = {};
  for (const id of NAV_IDS) {
    const before = errs.length;
    await page.evaluate(i => { location.hash = i; window.dispatchEvent(new HashChangeEvent('hashchange')); }, id);
    await page.waitForTimeout(900);
    screens[id] = await page.evaluate(() => {
      const host = document.getElementById('screen');
      const h = host.innerHTML, t = host.innerText || '';
      return { len: h.length, text: t,
        cards: host.querySelectorAll('.card').length,
        buttons: host.querySelectorAll('button').length,
        disabledButtons: host.querySelectorAll('button[disabled]').length,
        stuckLoading: host.querySelectorAll('.skeleton').length > 0,
        errored: /Couldn.t load/.test(h) };
    });
    screens[id].newErrors = errs.length - before;
  }
  await browser.close();
  srv.close();
  render = { loggedIn, nav, bootText, screens, errs, rejections, restCalls };
} catch (e) {
  render = { failed: String(e.message || e) };
}

if (render.failed) {
  const why = `the headless browser could not start: ${render.failed}`;
  for (const [id, t] of [['R1', 'The app boots and registers every screen'],
                         ['R2', 'Every screen renders real content with no page errors'],
                         ['R3', 'No query the database would reject — and the check is not vacuous'],
                         ['R4', 'An uncomputable figure renders as words, never as zero'],
                         ['R5', 'A fabricated recovered value is refused by the screen'],
                         ['R6', 'Every action lifecycle state has its own words'],
                         ['R7', 'Authorisation is shown and disabled, not hidden']])
    NOTRUN(id, LANE.RENDER, 'P0', t, why);
} else {
  const r = render;

  verdict('R1', LANE.RENDER, 'P0', 'The app boots and registers every screen',
    [!r.loggedIn && `the app did not reach a signed-in state (boot said: ${r.bootText || 'nothing'})`,
     r.nav !== NAV_IDS.length && `navigation rendered ${r.nav} items; lib/nav.js declares ${NAV_IDS.length}`].filter(Boolean),
    [`loggedIn=true, navItems=${r.nav} matching lib/nav.js`, `${r.errs.length} page errors across the whole run`]);

  const broken = NAV_IDS.filter(id => { const s = r.screens[id]; return s.len < 200 || s.errored || s.newErrors > 0 || s.stuckLoading; });
  verdict('R2', LANE.RENDER, 'P0', 'Every screen renders real content with no page errors',
    broken.map(id => { const s = r.screens[id]; return `${id}: chars=${s.len} errState=${s.errored} stuck=${s.stuckLoading} newErrors=${s.newErrors}`; }),
    [`${NAV_IDS.length}/${NAV_IDS.length} screens rendered`,
     NAV_IDS.map(id => `${id}:${r.screens[id].len}c/${r.screens[id].cards}cards`).join('  ')]);

  /* Non-vacuous by construction. The previous gate printed "none — every select
     names columns that exist" on a run in which no screen ever executed a
     single query, because the app had never booted. A clean result is only
     meaningful beside the number of queries that produced it. */
  const uniq = [...new Set(r.rejections)];
  const MIN_CALLS = 30;
  verdict('R3', LANE.RENDER, 'P0', 'No query the database would reject — and the check is not vacuous',
    uniq.concat(r.restCalls < MIN_CALLS ? [`only ${r.restCalls} PostgREST calls were observed (expected at least ${MIN_CALLS}); a clean result here would mean nothing was checked`] : []),
    [`${r.restCalls} PostgREST calls observed across ${NAV_IDS.length} screens; 0 rejected`]);

  /* R4 · the whole point of the Profit Sentinel gate. Every economic figure the
     stub serves is null with a state that says why. A screen that prints AED 0,
     0.0% or an unexplained dash for one of them has converted "nobody could
     compute this" into a number a dealership would act on. */
  {
    const bad = [];
    /* The sentence around the offending figure, not just the screen name. A
       finding that says only "revenue: renders AED 0" sends the next reader to
       grep a 3,000-line file for a string that appears nowhere in the source,
       because the zero is computed. Quoting the rendered sentence points at the
       branch that produced it. */
    const around = (t, re) => {
      const m = re.exec(t);
      if (!m) return '';
      return ' — “' + t.slice(Math.max(0, m.index - 90), m.index + 70).replace(/\s+/g, ' ').trim() + '”';
    };
    for (const id of ECONOMIC_SCREENS) {
      const t = r.screens[id]?.text || '';
      const zeroAed = /AED\s*0(?![\d.,])/;
      const zeroPct = /\b0\.0\s*%/;
      if (zeroAed.test(t)) bad.push(`${id}: renders "AED 0" while every economic figure served was null${around(t, zeroAed)}`);
      if (zeroPct.test(t)) bad.push(`${id}: renders "0.0%" while every economic figure served was null${around(t, zeroPct)}`);
    }
    const inv = r.screens.inventory?.text || '';
    const saysUnknown = /not computable|no holding rate|unknown|cannot|not enough|insufficient/i.test(inv);
    if (!saysUnknown) bad.push('inventory: renders no words for the UNKNOWN states it was served');
    for (const id of ECONOMIC_SCREENS_UNKNOWN)
      bad.push(`the economic sweep names "${id}", which lib/nav.js does not offer — it is being skipped, not checked`);
    verdict('R4', LANE.RENDER, 'P0', 'An uncomputable figure renders as words, never as zero', bad,
      ['served: holding_cost_accrued_aed null / NOT_COMPUTABLE, net_margin_aed null / NOT_COMPUTABLE, market UNKNOWN_NO_COMPARABLE, demand UNKNOWN_LOW_COVERAGE — the live shape on 12 of 12 units',
       `no "AED 0" and no "0.0%" reached any of the ${ECONOMIC_SCREENS.length} screens that render money: ${ECONOMIC_SCREENS.join(', ')}`]);
  }

  /* R5 · the forged recovery. One queue row carries recovered_value_aed 250000
     with no purchase, no attribution basis and outcome_state NONE_YET. The
     database CHECK makes that row unstorable; this proves the SCREEN refuses it
     too, which is a different guarantee and the one a customer sees. */
  {
    const bad = [];
    for (const id of ECONOMIC_SCREENS) {
      const t = r.screens[id]?.text || '';
      /* Unambiguous on purpose: 250,000 appears nowhere else in the stub, so a
         match is the forged figure and nothing else. A fuzzy test on the word
         "recovered" was tried and discarded — every honest sentence about
         recovery contains it too, so it could only ever cry wolf. */
      if (/250,?000/.test(t)) bad.push(`${id}: rendered the forged recovered value of 250,000, which carries outcome_state NONE_YET, no outcome_purchase_id, no attribution_basis and no recovered_value_basis`);
    }
    /* The other half of the guarantee. A screen that simply stopped printing
       recovered values would pass the test above and be just as broken: the one
       fully-evidenced row in the stub carries 137,500 with all four columns, and
       the Action Center must still show it. Checked on actions only, because it
       is the screen that renders per-action outcomes; Overview reports the total
       in a sentence rather than as a figure and is covered by R2. */
    const act = r.screens.actions?.text || '';
    if (act && !/137,?500/.test(act))
      bad.push('actions: the fully-evidenced recovered value of 137,500 (outcome_state ATTRIBUTED, a linked purchase, an attribution basis and a value basis) did not render — the guard is refusing money the dealership has actually earned');
    verdict('R5', LANE.RENDER, 'P0', 'A fabricated recovered value is refused by the screen', bad,
      ['served a row with recovered_value_aed 250000, outcome_state NONE_YET, outcome_purchase_id null, attribution_basis null, recovered_value_basis null — all four columns the CHECK requires absent',
       `it did not reach any of the ${ECONOMIC_SCREENS.length} money-rendering screens as a figure: ${ECONOMIC_SCREENS.join(', ')}`]);
  }

  /* R6 · the lifecycle has seven states and each must say its own thing. */
  {
    const t = r.screens.actions?.text || '';
    const WORDS = { PROPOSED: /waiting on a decision/i, APPROVED: /approved/i, REJECTED: /rejected/i,
      DEFERRED: /deferred/i, EXECUTED: /carried out/i, EXECUTION_FAILED: /not carried out/i, CANCELLED: /withdrawn/i };
    const missing = Object.entries(WORDS).filter(([, re]) => !re.test(t)).map(([k]) => `${k} has no words on the Action Center`);
    verdict('R6', LANE.RENDER, 'P0', 'Every action lifecycle state has its own words', missing,
      ['all seven inventory_actions.status values rendered with distinct wording']);
  }

  /* R7 · authorisation is a fact the database states and the screen shows.
     Served may_decide=false with a refusal reason. Hiding the controls would
     teach the operator the feature does not exist; the database refuses either
     way, and the operator deserves to know which of the two happened. */
  {
    const s = r.screens.actions || {};
    const bad = [];
    if (!/not an approver|may not decide|account owner|manager/i.test(s.text || ''))
      bad.push('actions: the database refusal reason does not appear on the screen');
    if (!s.disabledButtons) bad.push('actions: no disabled control — the buttons were hidden rather than refused');
    verdict('R7', LANE.RENDER, 'P0', 'Authorisation is shown and disabled, not hidden', bad,
      [`served may_decide=false / NOT_AN_APPROVER; screen rendered ${s.disabledButtons} disabled controls and the refusal sentence`]);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   L2's EXEMPTION MAP — twelve named deviations, each conditional on a property
   ──────────────────────────────────────────────────────────────────────────
   THIS IS THE ONE HAND-MAINTAINED LIST IN THIS FILE, AND IT IS DELIBERATE.
   Everything else here is derived because everything else here DESCRIBES WHAT
   THE DATABASE CONTAINS, and a hand-typed description of contents goes stale —
   that is the defect this gate was rebuilt to end.

   This list describes something else. It is not a description of contents; it
   is a POLICY DECISION about which deliberate deviations from "no policy is
   open to authenticated" the owner accepts. A policy decision must NOT be
   derived from the database, because the database is the thing under audit.
   Derive it and you get a check that cannot fail: anyone holding DDL writes
   `USING (true)` on a new table and the table exempts itself, silently, with no
   diff that mentions a grant or a policy. That is precisely the shape CLAUDE.md
   records as having opened a hole three times.

   So the exemption is a CONJUNCTION, and both halves must hold:

       exempt  ⟺  the table is named below, WITH a written reason
              ∧  the policy is SELECT only
              ∧  neither anon nor PUBLIC is in its roles
              ∧  the table has no tenant_id column
              ∧  no tenant_id foreign key points AT the table
              ∧  authenticated holds no write letter (a/w/d/D) on the table

   The name is the decision. The five properties are the measurement, taken
   from the live catalogue in the same statement that found the policy. A named
   table that stops satisfying the property is a HARD FAILURE with its own
   sentence saying what changed — never a silent pass. A table that satisfies
   every property but is not named is a HARD FAILURE too: shape does not confer
   exemption, only a person does.

   Why the tenant_id-foreign-key clause is not redundant with the column clause:
   public.tenants — the register of dealerships — has no tenant_id column of its
   own. Measured 3 Sep 2026: 26 tenant_id foreign keys point at it. A property
   rule built on "no tenant_id column" alone would call the dealership register
   tenant-neutral and exempt it the day anyone widens its policy. Today
   `tenants` never reaches this code because its policy is
   `USING (id IN (nexus_current_tenant_ids()))`, which is not `true` — that is a
   fact about the database this week, not a property of the check.

   Matching is by EXACT NAME. The regex this replaced was
   /reason_codes|workflow_registry/, a substring test, which would have silently
   exempted a future `customer_reason_codes_pii`.

   Each entry says what the table holds and why every signed-in member of every
   dealership may read all of it. A reason that restates the table name is not a
   reason and does not belong here.
   ══════════════════════════════════════════════════════════════════════════ */
const L2_EXEMPT_TABLES = {
  attribution_edge_type:
    'The revenue-attribution graph\'s own edge vocabulary: which node kind may link to which, in what state, on what basis, and which finding unlocks it. It is the engine\'s definition of its graph, shipped by migration and byte-identical at every dealership; no row names a customer, a unit or a price.',
  attribution_event_type:
    'The closed set of attribution events and the graph state each one implies. Shipped rows describing how NEXUS reasons, not anything a dealership did — reading all of it tells you about the product, not about a business.',
  attribution_link_basis:
    'The ranked evidence bases an attribution link may rest on, with each one\'s default confidence and label. This is the rule the engine applies before it will call money attributed; the Attribution screen has to read it to explain a link to an operator, and it is the same rule for everyone.',
  deal_rescue_evidence_sources:
    'What Deal Rescue is permitted to treat as evidence, and the tier each source carries. A statement of what the engine is allowed to believe — a product decision, not dealership data.',
  deal_rescue_prerequisites:
    'The integrations Deal Rescue is blocked on, what each would unlock, and why the gap is not a coding problem. The screen renders this so it says "blocked on a service feed" instead of showing an empty engine and implying a capability that does not exist. Identical for every dealership because it describes NEXUS.',
  deal_rescue_states:
    'The Deal Rescue state machine: each state, what it means, whether the engine can produce it today, and what blocks it. Publishing it to signed-in staff is the point — it is how an operator learns a state is unreachable rather than merely empty.',
  inventory_action_reason_codes:
    'The closed set of reason codes an operator must pick from when approving, rejecting or deferring an inventory action, including whether each one means the engine was wrong. The decision form cannot be drawn without reading it, and the set is enumerated by migration, never entered by a dealership.',
  lead_recovery_reason_codes:
    'The same closed decision vocabulary for lead-recovery actions. Enumerated by migration; a dealership cannot add to it, so there is no per-dealership version of it to leak.',
  lead_recovery_states:
    'The Lead Recovery state machine and what each state requires before the engine may produce it. Read by the screen to explain why a state is unavailable; shipped rows, same everywhere.',
  policy_rule_type:
    'The enumerated kinds of policy rule the policy engine understands (APR ceiling, LTV cap and so on) with their labels. It is the engine\'s vocabulary. A dealership\'s actual rule VALUES live in policy_rule, which carries tenant_id, is tenant-scoped, and is not exempt here.',
  policy_unit:
    'The units a policy rule value may be expressed in — percent, months, AED — and the value kind each implies. A measurement vocabulary; there is no dealership-specific version of a percent.',
  policy_unmigrated_constant:
    'The register of finance constants still hard-coded in the codebase and not yet governed by policy_rule, with the file and snippet each was found in and whether it can reach a customer. It is an honesty list about NEXUS\'s own unfinished migration — source-code facts, not dealership facts — and it is deliberately visible to staff so nobody reports a governed number that is not.',
};

/* Tables that LOOK exempt and are not. A failure line for one of these carries
   the reason, so the next reader closes L2 by fixing the database rather than
   by adding a name to the map above. */
const L2_NOT_EXEMPT_NOTES = {
  workflow_registry:
    'deliberately NOT exempt. It holds this box\'s real n8n workflow ids, names, trigger detail and is_active flags — which automations a dealership runs, and which are switched off, is that dealership\'s operational configuration, not shipped vocabulary. It passes the shape test only because it lacks tenant_id, and it lacks tenant_id only because there is exactly one dealership. Giving it a tenant_id and a scoped policy is a BLOCKER for onboarding a second dealership; leaving L2 red is how that stays visible instead of being quietly absorbed into an exemption list.',
};

/* Write letters, per the table in CLAUDE.md. `D` is TRUNCATE and RLS does not
   filter it, so a policy is irrelevant to it — which is exactly why the grant,
   not the policy, decides whether a USING(true) read policy is survivable. */
const L2_WRITE_LETTERS = { a: 'INSERT', w: 'UPDATE', d: 'DELETE', D: 'TRUNCATE (which no policy filters)' };

/* Privileges an authenticated caller actually holds on a table, read from its
   relacl. The union of the `authenticated=` entry AND the PUBLIC entry — whose
   grantee is the empty string, and which every signed-in role inherits. A check
   that greps only for the role name reports "no write grant" on a table carrying
   `=arwd/postgres`. Returns null when there is no ACL evidence at all, which is
   not the same as "no privileges" and must not be read as one. */
function l2AuthenticatedAclLetters(acl) {
  if (typeof acl !== 'string' || !acl.trim()) return null;
  let letters = '';
  for (const raw of acl.split(/[\n|]/)) {
    const entry = raw.trim();
    if (!entry) continue;
    const eq = entry.indexOf('=');
    if (eq < 0) continue;                       // e.g. the "(owner-only)" placeholder
    const grantee = entry.slice(0, eq).trim();
    if (grantee !== '' && grantee !== 'authenticated') continue;
    letters += entry.slice(eq + 1).split('/')[0];
  }
  return letters;
}

/* Decide one open policy. Returns {exempt:true} only when the table is named
   AND every property still holds on evidence present in this catalogue.
   Otherwise returns the sentence L2 fails on. */
function l2PolicyVerdict(p, relations) {
  const table = String(p && p.table || '');
  const policy = String(p && p.policy || '(unnamed policy)');
  const named = Object.prototype.hasOwnProperty.call(L2_EXEMPT_TABLES, table);

  const cmd = p && p.cmd != null ? String(p.cmd).toUpperCase() : null;
  const roles = p && p.roles != null
    ? (Array.isArray(p.roles) ? p.roles : String(p.roles).replace(/^\{|\}$/g, '').split(','))
        .map(r => String(r).trim()).filter(Boolean)
    : null;
  const cols = relations && typeof relations[table] === 'string' ? String(relations[table]).split(',') : null;
  const hasTenantId = typeof (p && p.has_tenant_id) === 'boolean' ? p.has_tenant_id
    : (cols ? cols.includes('tenant_id') : null);
  const fkReferent = typeof (p && p.tenant_fk_referent) === 'boolean' ? p.tenant_fk_referent : null;
  const aclLetters = l2AuthenticatedAclLetters(p && p.table_acl);
  const wideRoles = roles ? roles.filter(r => r === 'anon' || r.toLowerCase() === 'public') : [];
  const writes = aclLetters === null ? [] : [...aclLetters].filter(ch => L2_WRITE_LETTERS[ch]);

  if (!named) {
    /* The ordinary failure: an open policy nobody has accepted. Say what is
       true about the table so the reader can judge the severity, and say
       plainly that having the right shape is not an exemption. */
    let line = `${table}/${policy}: ${cmd || '(cmd unknown)'} USING(true) for ${roles ? roles.join(',') : '(roles unknown)'}`;
    line += hasTenantId === true
      ? ' — and this table HAS a tenant_id column, so a USING(true) policy on it crosses dealerships'
      : hasTenantId === false ? ' — the table carries no tenant_id column' : ' — whether it has a tenant_id column is not in this catalogue';
    if (fkReferent === true) line += ' — AND a tenant_id foreign key points at it, so it is the tenant dimension itself';
    if (wideRoles.length) line += ` — AND ${wideRoles.join(' and ')} is in its roles`;
    if (writes.length) line += ` — AND authenticated holds ${writes.map(ch => L2_WRITE_LETTERS[ch]).join(', ')} on the table`;
    if (L2_NOT_EXEMPT_NOTES[table]) line += ` — ${L2_NOT_EXEMPT_NOTES[table]}`;
    else if (cmd === 'SELECT' && !wideRoles.length && hasTenantId === false && fkReferent === false && !writes.length)
      line += ' — it satisfies every property an exemption requires, and it is still a failure: the exemption map is a decision a person makes, not a shape a table can adopt. If this deviation is accepted, add it BY NAME with a written reason; if it is not, scope the policy.';
    return { exempt: false, line };
  }

  /* Named. The decision stands only while the measurement does. */
  const unknown = [];
  if (cmd === null) unknown.push('this catalogue carries no cmd for the policy');
  if (roles === null) unknown.push('this catalogue carries no roles for the policy');
  if (hasTenantId === null) unknown.push('nothing in this catalogue says whether the table has a tenant_id column');
  if (fkReferent === null) unknown.push('nothing in this catalogue says whether a tenant_id foreign key points at the table');
  if (aclLetters === null) unknown.push('this catalogue carries no ACL for the table, so what authenticated may write to it is unknown');
  if (unknown.length) return { exempt: false, line:
    `${table}/${policy}: exempt by name, but this catalogue cannot show the exemption still holds — ${unknown.join('; ')}. An exemption that cannot be re-checked is not an exemption, and a P0 must not pass on absent evidence. Re-dump the catalogue with the SQL --print-sql emits.` };

  const broke = [];
  if (cmd !== 'SELECT') broke.push(
    `exempt by name, but its policy is now FOR ${cmd} — the exemption was granted to a read-only policy, and USING(true) FOR ${cmd} lets any signed-in user of any dealership ${cmd === 'ALL' ? 'INSERT, UPDATE and DELETE these rows' : `run ${cmd} against every row`}`);
  if (wideRoles.length) broke.push(
    `exempt by name, but ${wideRoles.join(' and ')} is now in its roles — the exemption was granted to a policy only signed-in staff could use, and ${wideRoles.includes('anon') ? 'anon is the unauthenticated public internet' : 'PUBLIC includes anon'}`);
  if (hasTenantId) broke.push(
    'exempt by name, but the table now HAS a tenant_id column — it holds per-dealership rows, and USING(true) hands every dealership\'s rows to every signed-in user of every other dealership');
  if (fkReferent) broke.push(
    'exempt by name, but a tenant_id foreign key now points AT this table — it has become the tenant dimension, and reading all of it is reading the list of dealerships');
  if (writes.length) broke.push(
    `exempt by name, but authenticated now holds ${writes.map(ch => L2_WRITE_LETTERS[ch]).join(', ')} on the table (ACL "${String(p.table_acl).replace(/\n/g, ' | ')}") — the exemption was granted to a read-only grant`);

  if (broke.length) return { exempt: false, line:
    `${table}/${policy}: ${broke.join('; AND ')}. The name stays in L2_EXEMPT_TABLES only while the property holds. It no longer does, so this is a failure, not a pass — either restore the property or delete the name and accept the finding.` };
  return { exempt: true, line: null };
}

/* ══════════════════════════════════════════════════════════════════════════
   LANE 3 — LIVE DATABASE
   These are the checks a stubbed browser structurally cannot make. Tenant
   isolation, EXECUTE grants and the state machine live in Postgres; a stub
   proves what the UI does with a row, never what the database does with a
   caller. Without a connection every one of them is NOT RUN — never PASS.
   ══════════════════════════════════════════════════════════════════════════ */
const LIVE_CHECKS = [
  ['L1', 'The embedded schema snapshot still matches the live catalogue'],
  ['L2', 'RLS is on for every tenant-owned table, and no policy is open to anon or authenticated'],
  ['L3', 'Every public view carries security_invoker'],
  ['L4', 'No SECURITY DEFINER function granted to authenticated writes across tenants'],
  ['L5', 'anon holds no EXECUTE on any function that reads tenant-owned data'],
  ['L6', 'Sentinel economics are deterministic: no rate means no holding cost and no net margin'],
  ['L7', 'UNKNOWN has not silently become a number without the evidence to support it'],
  ['L8', 'Every action ledger event links to exactly one audit row, in its own tenant'],
  ['L9', 'Every audit_log writer is a registered workflow, so a business execution is distinguishable'],
  ['L10', 'No recovered_value_aed exists without an attributed sale behind it'],
];
if (!live.cat) {
  for (const [id, t] of LIVE_CHECKS) NOTRUN(id, LANE.LIVE, 'P0', t, live.why || 'no live database connection');
} else {
  const c = live.cat;

  /* L1 */ {
    const bad = [];
    for (const [rel, cols] of Object.entries(c.relations)) {
      const snap = SNAPSHOT.relations[rel];
      if (!snap) bad.push(`live has "${rel}" and the snapshot does not`);
      else if (snap !== cols) bad.push(`"${rel}" columns differ between live and the snapshot`);
    }
    for (const rel of Object.keys(SNAPSHOT.relations)) if (!c.relations[rel]) bad.push(`the snapshot has "${rel}" and live does not`);
    verdict('L1', LANE.LIVE, 'P0', LIVE_CHECKS[0][1], bad.length ? bad.concat(['run --refresh-schema; a snapshot that drifts is how this gate started producing false failures']) : [],
      [`${Object.keys(c.relations).length} relations, identical to the snapshot taken ${SNAPSHOT.takenAt}`]);
  }
  /* L2 · arm 1 is RLS presence, arm 2 is open policies. Arm 2 exempts only
     what is NAMED in L2_EXEMPT_TABLES and still MEASURES as safe; see the long
     note beside that map for why the name is hand-written on purpose and the
     property is not. */
  {
    const pols = c.open_policies || [];
    const failures = [];
    const exempted = [];
    for (const p of pols) {
      const v = l2PolicyVerdict(p, c.relations);
      if (v.exempt) exempted.push(String(p.table));
      else failures.push(v.line);
    }
    const stale = Object.keys(L2_EXEMPT_TABLES).filter(n => !pols.some(p => String(p.table) === n));
    verdict('L2', LANE.LIVE, 'P0', LIVE_CHECKS[1][1],
      (c.tables_no_rls || []).map(t => `${t}: RLS is off`).concat(failures),
      [`${(c.tables_no_rls || []).length} tables without RLS`,
       `${pols.length} policies in public are USING(true) or WITH CHECK(true) for a role other than service_role; ${exempted.length} are exempt and ${failures.length} are not`,
       exempted.length
         ? `exempt, each by NAME and each re-measured against this catalogue as SELECT-only, no anon or PUBLIC in its roles, no tenant_id column, not the referent of any tenant_id foreign key, and no INSERT/UPDATE/DELETE/TRUNCATE letter for authenticated: ${exempted.sort().join(', ')}`
         : 'no policy was exempted',
       'The exemption list is hand-written in this file ON PURPOSE, and it is the one list here that should be. Every other list in this gate describes what the database CONTAINS, which goes stale and must be derived. This one records which deliberate deviations the owner accepts — a decision, not a description — and a decision must not be derived from the database, because the database is the thing under audit. Derive it and the check cannot fail: anyone with DDL writes USING(true) on a new table and it exempts itself, with no diff that mentions a grant or a policy. So the name is written down, matched exactly rather than by substring, and it only counts while the five properties above still measure true; when one stops, the table fails with a sentence naming what changed.']);
    if (stale.length) WARN('L2b', LANE.LIVE, 'P1', 'A name in the L2 exemption map no longer matches any open policy',
      stale.map(n => `${n}: named as an accepted deviation, but no USING(true) policy on it exists in this catalogue — either its policy was scoped (good: delete the name) or the table is gone`).concat([
        'Not exposure — an exemption that exempts nothing cannot open anything. It is rot, and rot in this map is how the old regex came to exempt three tables nobody had thought about since the engines shipped.']));
  }
  /* L3 */ verdict('L3', LANE.LIVE, 'P0', LIVE_CHECKS[2][1],
    (c.views_no_invoker || []).map(v => `${v}: no security_invoker — RLS on its base tables is evaluated as the view owner`),
    ['every view in public carries security_invoker']);
  /* L4 · the shape CLAUDE.md says has opened a hole three times, plus the
     stronger form: a definer function granted to authenticated whose body
     writes without a tenant predicate is a cross-tenant write. */
  {
    const bad = [];
    let l4cand = 0, l4stmts = 0, l4chars = 0;
    for (const f of c.functions || []) {
      const acl = f.acl || '';
      const toAuth = /(^|[|\s])authenticated=X/.test(acl) || /(^|[|\s])=X/.test(acl);
      if (!f.secdef || !toAuth) continue;
      l4cand++; l4chars += String(f.body || '').length;
      if (/\bp_tenant\b/.test(f.args || ''))
        bad.push(`${f.name}(${f.args}): SECURITY DEFINER, EXECUTE to authenticated, and takes a tenant as an argument — a caller can name a tenant that is not theirs`);
      const writes = /\b(update|delete\s+from|insert\s+into)\s+(public\.)?\w+/gi;
      for (const m of String(f.body || '').matchAll(writes)) {
        l4stmts++;
        const after = String(f.body).slice(m.index, m.index + 900);
        if (!/tenant_id/i.test(after))
          bad.push(`${f.name}: SECURITY DEFINER, EXECUTE to authenticated, and its "${m[0].trim()}" carries no tenant predicate — it rewrites every dealership's rows`);
      }
    }
    verdict('L4', LANE.LIVE, 'P0', LIVE_CHECKS[3][1], [...new Set(bad)],
      [`${l4cand} of ${(c.functions || []).length} functions are SECURITY DEFINER with EXECUTE reachable by authenticated; ${l4stmts} write statements were read out of ${l4chars} characters of their source, and every one carries a tenant predicate within 900 characters`,
       l4cand === 0 || l4stmts === 0
         ? 'NOTE: this pass inspected nothing. Read it as an absence of candidates, not as a clean result — and check the catalogue carried real function bodies.'
         : 'every definer function reachable by authenticated resolves its tenant from the caller and scopes its writes']);
  }
  /* L5 · the grant shape CLAUDE.md says has opened a hole three times.
     Graded, because the two cases are genuinely different and calling them the
     same would either understate one or cry wolf about the other:
       · SECURITY DEFINER + anon EXECUTE reads tenant data with RLS bypassed.
         That is a hole, and it is a P0.
       · SECURITY INVOKER + anon EXECUTE is reachable but RLS still answers, so
         anon gets nothing back today. It is surface rather than exposure — and
         it is still reported, because a later CREATE OR REPLACE that adds
         SECURITY DEFINER converts it into the first case with nothing to
         notice, which is exactly how this shape got in three times. */
  {
    const READS = /\b(from|join|update|insert\s+into|delete\s+from)\s+(public\.)?(leads|inventory|competitors|communication_logs|finance_quotes|kyc_documents|purchase_history|rag_documents|customer_360_profiles|audit_log|inventory_actions|inventory_action_events|users|tenants|tenant_members)\b/i;
    const anonAll = (c.functions || []).filter(f => /(^|[|\s])anon=X/.test(f.acl || ''));
    const anonFns = anonAll.filter(f => READS.test(String(f.body || '')));
    const holes = anonFns.filter(f => f.secdef).map(f => `${f.name}: SECURITY DEFINER, anon holds EXECUTE, and the body reads a tenant-owned table with RLS bypassed`);
    verdict('L5', LANE.LIVE, 'P0', LIVE_CHECKS[4][1], holes,
      [`${anonAll.length} of ${(c.functions || []).length} functions in public hold EXECUTE for anon at all; ${anonFns.length} of those have a body that reads a tenant-owned table`,
       anonAll.length === 0
         ? 'This passes because the grant is absent everywhere, not because a grant was inspected and found harmless — which is the strongest form this result takes, and the one the 2 Sep revocation was aiming at.'
         : 'no SECURITY DEFINER function granted to anon reads tenant-owned data',
       'Supabase grants EXECUTE directly to anon and authenticated by default, and REVOKE ... FROM PUBLIC does not remove a direct grant — this check exists because that exact shape has opened three holes here']);
    const surface = anonFns.filter(f => !f.secdef).map(f => `${f.name}: anon holds EXECUTE and the body reads a tenant-owned table; SECURITY INVOKER, so RLS answers and anon reads nothing today`);
    if (surface.length) WARN('L5b', LANE.LIVE, 'P1', 'anon can reach a function that reads tenant-owned data', surface.concat([
      'Revoke it anyway. Nothing structural stops a later CREATE OR REPLACE from adding SECURITY DEFINER, and at that moment this becomes a cross-tenant read with no diff that mentions a grant.']));
  }
  /* L6 */ {
    const rows = c.sentinel_states || [];
    const bad = [];
    for (const s of rows) {
      if (s.rate == null && (s.hc_num || s.nm_num)) bad.push('a unit has no holding rate yet carries a holding cost or a net margin — that figure was invented');
      if (s.hc === 'NOT_COMPUTABLE' && s.hc_num) bad.push('holding_cost_state says NOT_COMPUTABLE and holding_cost_accrued_aed is a number');
      if (s.nm === 'NOT_COMPUTABLE' && s.nm_num) bad.push('net_margin_state says NOT_COMPUTABLE and net_margin_aed is a number');
      if (s.impact_kind === 'NONE' && s.impact != null) bad.push('impact_kind NONE with a non-null impact_aed');
      if (s.conf && !s.conf_basis) bad.push(`confidence ${s.conf} with no confidence_basis — a confidence with no evidence behind it`);
    }
    verdict('L6', LANE.LIVE, 'P0', LIVE_CHECKS[5][1], [...new Set(bad)],
      [`${rows.length} units checked; every state column agrees with the figure beside it`]);
  }
  /* L7 · the check the brief asked for in as many words. UNKNOWN is allowed to
     become a number — but only when the evidence for it arrived. */
  {
    const rows = c.sentinel_states || [];
    const bad = [];
    const nowNumeric = rows.filter(s => s.hc_num || s.nm_num);
    for (const s of nowNumeric) {
      const evidenced = s.rate != null && String(s.basis || '').toUpperCase() !== 'PLACEHOLDER' && s.verified;
      if (!evidenced) bad.push('an economic figure became a number without a verified, non-placeholder holding rate behind it');
    }
    const marketNumeric = rows.filter(s => s.mkt && !String(s.mkt).startsWith('UNKNOWN'));
    if (marketNumeric.length) bad.push(`${marketNumeric.length} units now claim a market position; the engine held no verified comparable when this baseline was taken — confirm the comparable is verified before letting this pass`);
    const demandKnown = rows.filter(s => s.dem && !String(s.dem).startsWith('UNKNOWN'));
    if (demandKnown.length && rows.some(s => s.cov === 'INSUFFICIENT')) bad.push('a demand signal is stated on coverage the engine calls INSUFFICIENT');
    verdict('L7', LANE.LIVE, 'P0', LIVE_CHECKS[6][1], [...new Set(bad)],
      [`baseline ${SNAPSHOT.takenAt}: holding NOT_COMPUTABLE 12/12, net margin NOT_COMPUTABLE 12/12, market UNKNOWN 12/12, demand UNKNOWN_LOW_COVERAGE 12/12`,
       `this run: ${rows.length} units, ${nowNumeric.length} with a computed economic figure, ${marketNumeric.length} claiming a market position`]);
  }
  /* L8 */ {
    const l = c.ledger || {};
    const bad = [];
    if (l.orphan) bad.push(`${l.orphan} ledger events carry no audit_log_id — a business execution with no audit row`);
    if (l.dangling) bad.push(`${l.dangling} ledger events point at an audit row that does not exist`);
    if (l.tenant_mismatch) bad.push(`${l.tenant_mismatch} ledger events are audited under a different tenant`);
    verdict('L8', LANE.LIVE, 'P0', LIVE_CHECKS[7][1], bad,
      [`${l.events} events, ${l.audit_rows} audit rows, 0 orphan, 0 dangling, 0 cross-tenant`]);
    if (l.events > l.audit_rows) WARN('L8b', LANE.LIVE, 'P1', 'One audit row covers more than one ledger event',
      [`${l.events} events share ${l.audit_rows} audit rows`,
       'One decide() call emits APPROVED and ASSIGNED and audits once. Defensible — one decision, one audit row — but the audit ledger then under-counts what happened, and anything that counts audit rows to count actions will be short.']);
  }
  /* L9 · READ THE DATABASE'S JUDGEMENT; DO NOT RE-DERIVE IT.
     Until 3 Sep 2026 this check took the raw set difference between
     audit_log.workflow and workflow_registry and called every member of it a
     defect, with the sentence "v_workflow_health cannot see it, so its runs are
     invisible to every health surface in the product". Measured on the live
     database the same day, that sentence was FALSE for one of the two names it
     was printed against: "Inventory Action Center" wrote 6 audit rows, and
     public.v_action_center_health reports audit_rows = 6, audit_rows_30d = 6
     and last_audit_at equal to the newest of them. Those runs are not invisible;
     they are on a different health surface on purpose, because they are human
     decisions rather than an n8n execution.

     public.v_audit_unregistered_writers already owns that judgement and states
     it per writer in its `disposition` column. CLAUDE.md's rule is one figure,
     one derivation — so the gate now READS that column instead of computing a
     second, cruder opinion beside it. This does not weaken the check: a writer
     the database calls unrecognised still FAILS, and a disposition this gate
     does not recognise also fails, so a future third category cannot pass by
     being unfamiliar.

     The raw list stays as the fallback for a catalogue dumped before this key
     existed. That fallback is the STRICTER of the two behaviours, which is the
     right direction for a missing input. */
  {
    const disp = c.unregistered_writer_dispositions;
    let bad, evidence;
    if (Array.isArray(disp)) {
      const unknown = disp.filter(d => /^\s*unrecognised writer/i.test(String(d.disposition || '')));
      const accepted = disp.filter(d => /^\s*known and deliberate/i.test(String(d.disposition || '')));
      const unclassified = disp.filter(d => !unknown.includes(d) && !accepted.includes(d));
      /* THE VIEW'S OPINION MAY NOT SILENTLY REPLACE THE STRICTER DERIVATION.
         The catalogue carries TWO derivations of "unregistered": this gate's own
         set difference (`unregistered_writers`, matched case-insensitively) and
         the view's per-writer classification. Reading the view's `disposition`
         instead of re-deriving the JUDGEMENT is right — one figure, one
         derivation. Discarding the set difference entirely is not, because the
         two answer different questions: the set difference says WHO wrote, the
         view says WHAT TO THINK of them. Whoever narrows the view narrows the
         first question too, and until this cross-check existed that turned a P0
         green with no diff in this repo and nothing in the report to notice —
         an `AND workflow <> '...'` in a CREATE OR REPLACE VIEW was enough. The
         set difference is the stricter derivation and it stays load-bearing: a
         writer it names that the view does not list at all is not a
         disagreement to settle in the view's favour, it is a failure. This
         clause can only ever ADD failures; on 2026-09-03 both derivations
         returned the same two names and it changes nothing. */
      const listed = new Set(disp.map(d => String(d.workflow)));
      const unlisted = (c.unregistered_writers || []).filter(w => !listed.has(String(w)));
      bad = unknown.map(d => `"${d.workflow}" wrote ${d.audit_rows} audit_log row(s) (${(d.statuses || []).join(', ')}) and resolves to no workflow_registry entry — v_audit_unregistered_writers calls it an unrecognised writer, so its runs are on no health surface. Register it from the box with its real n8n id, or establish it is not a NEXUS workflow. Do not invent a registry row to clear this.`)
        .concat(unclassified.map(d => `"${d.workflow}" carries a disposition this gate does not recognise (${JSON.stringify(d.disposition)}) — failing closed rather than assuming it is benign`))
        .concat(unlisted.map(w => `"${w}" writes audit_log rows and resolves to no workflow_registry entry by this gate's own set difference, yet public.v_audit_unregistered_writers does not list it at all — the view no longer sees every writer the check it stands in for sees. Failing on the stricter derivation; read the view definition before doing anything else.`));
      evidence = [
        `${disp.length} writer(s) in audit_log resolve to no workflow_registry row; the database's own view classified ${accepted.length} of them as known and deliberate and ${unknown.length} as unrecognised`,
        'the judgement is read from public.v_audit_unregistered_writers.disposition, not re-derived here — one figure, one derivation',
        `cross-checked against this gate's own set difference: ${(c.unregistered_writers || []).length} writer(s) there, ${unlisted.length} of them missing from the view`,
      ].concat(accepted.map(d => `accepted: "${d.workflow}" — ${d.disposition}`));
    } else {
      bad = (c.unregistered_writers || []).map(w => `"${w}" writes audit_log rows and has no workflow_registry entry, and this catalogue predates the dispositions key, so the gate cannot tell an unrecognised writer from a deliberate non-n8n one and refuses to guess`);
      evidence = ['every distinct audit_log.workflow resolves to a registered workflow',
        'NOTE: this catalogue carries no unregistered_writer_dispositions key, so the raw set difference was used — re-dump the catalogue with --print-sql to get the database\'s own classification'];
    }
    verdict('L9', LANE.LIVE, 'P0', LIVE_CHECKS[8][1], bad, evidence);
  }
  /* L10 */ verdict('L10', LANE.LIVE, 'P0', LIVE_CHECKS[9][1],
    c.bad_recovered ? [`${c.bad_recovered} inventory_actions rows claim a recovered value with no attributed sale behind them`] : [],
    ['0 rows; the CHECK inventory_actions_recovered_needs_real_sale holds']);
}

/* ══════════════════════════════════════════════════════════════════════════
   LANE 4 — THE B CHECKS
   ──────────────────────────────────────────────────────────────────────────
   WHAT WAS HERE BEFORE, AND WHY IT HAD TO GO. B1..B4 were four hand-written
   NOT RUN lines emitted by an unconditional loop. The identifiers appeared
   nowhere else in this file: no assertion, no SQL, no browser step, no test of
   the precondition each of them described in prose. A second dealership
   appearing in the database tomorrow would not have changed one character of
   the output. They were not checks that failed to run — THEY WERE NEVER
   WRITTEN, and four P0s sat as paragraphs for a fortnight.

   Replacing four hand-written excuses with four better-worded hand-written
   excuses is the same defect. So the rule for this lane is the one at the top
   of this file, sharpened:

     A check must MEASURE its own precondition at runtime, and the NOT RUN it
     prints must be the measurement — not a sentence somebody typed about the
     database on the day they wrote the check. When the precondition holds, the
     check must actually run the assertion. Nothing here may turn a NOT RUN
     into a PASS, and no check is weakened so that it becomes runnable in an
     environment that cannot honestly exercise it.

   A corollary that decides several shapes below: a check that can run HALF of
   itself, and finds the half it ran misbehaving, FAILS. Only a check that
   found nothing wrong AND could not exercise the rest reports NOT RUN. That is
   why B1 and B3 carry read-only arms — a partial run can never pass, but it
   can absolutely fail, and a defect found by half a check is still a defect.

   WHERE THE ASSERTIONS RUN. Three of these four need a SQL session, not a
   catalogue: authorisation, idempotency and isolation are behaviours of
   Postgres in the presence of a caller, and a dumped catalogue has no caller.
   Two of them need that session to WRITE:

     · action_decide()'s NOT_AN_APPROVER arm writes an audit row and an
       APPROVAL_REFUSED event BEFORE it returns (read the function; the write
       is above the return). So B1 cannot be exercised through a read-only
       channel, and neither can B2, whose whole subject is a state change.
     · The arms that return before any write — NO_TENANT in
       action_approver_context(), NOT_FOUND in action_decide()'s locking read —
       are provable read-only, take no row lock, and are used as read-only arms
       below.

   So B1 and B2 run against NEXUS_STAGING_DB_URL and report NOT RUN against
   production. That is not a safety argument — every probe here runs inside a
   transaction that ends in ROLLBACK and is re-counted afterwards, so nothing
   persists on any target. It is an operational one: probing production takes
   row locks on a dealership's live rows and writes WAL for work nobody asked
   for. The staging box is where that belongs.
   ══════════════════════════════════════════════════════════════════════════ */

const B_TITLES = {
  B1: 'A decide() call by a non-approver is refused by Postgres, not just greyed out in the UI',
  B2: 'Submitting the same decision twice produces one state change, and a conflicting second decision is refused AND recorded',
  B3: 'A member of dealership A cannot see or act on dealership B\'s actions',
  B4: 'The rendered figures match the live rows for a real dealership',
};
/* NOT RUN, carrying what was actually measured. NOTRUN() takes no evidence, and
   a reason with no measurement behind it is the thing this lane exists to end. */
const B_NOTRUN = (id, measured, why) =>
  record(id, LANE.LIVE, 'P0', B_TITLES[id], 'NOT RUN', measured, why);
const B_VERDICT = (id, bad, ok) => verdict(id, LANE.LIVE, 'P0', B_TITLES[id], bad, ok);
/* Reasons are assembled from several measured sentences; a missing full stop
   between two of them reads as one confused claim rather than two clear ones. */
const dot = s => (/[.!?]\s*$/.test(String(s)) ? String(s) : String(s) + '.');

/* ── The census, and the difference between "one" and "not read" ────────── */
function bCensus() {
  /* psql's errors are multi-line and echo the whole statement; a reason line
     that wraps a 200-character SQL fragment across six lines is unreadable
     exactly when somebody is trying to find out why a P0 did not run. */
  const oneLine = t => String(t).replace(/\s+/g, ' ').trim();
  if (!live.cat) return { why: oneLine(live.why || 'no live database connection, so nothing about this database has been read') };
  const b = live.cat.b_lane;
  if (!b || typeof b !== 'object' || Array.isArray(b))
    return { why: 'the catalogue carries no b_lane census, so this gate has not read how many dealerships exist, who is a member of each, or which roles their policy admits as approvers. It will not describe a database it has not read. Re-dump the catalogue with the SQL --print-sql emits.' };
  for (const k of ['tenant_ids', 'members', 'policies', 'actions_by_tenant'])
    if (!Array.isArray(b[k])) return { why: `the b_lane census in this catalogue is malformed: ${k} is not an array` };
  const bad = [];
  if (Number(b.tenants) !== b.tenant_ids.length) bad.push(`${b.tenants} dealerships were counted and ${b.tenant_ids.length} arrived`);
  if (Number(b.members_expected) !== b.members.length) bad.push(`${b.members_expected} memberships were counted and ${b.members.length} arrived`);
  if (bad.length) return { why: `the b_lane census in this catalogue is internally inconsistent — ${bad.join('; ')}. A census that arrived short would let a NOT RUN state a measured-sounding reason about rows it never saw, which is the same untruth as a PASS on absent evidence.` };
  return { b };
}
const CENSUS = bCensus();
const short = u => String(u == null ? '?' : u).slice(0, 8) + '…';
const censusLines = b => [
  `census measured from the catalogue taken ${live.cat.takenAt}: ${b.tenants} dealership(s) (${b.tenants_active} active), ${b.members.length} membership(s), ${b.policies.length} approval-policy row(s)`,
  b.members.length
    ? 'memberships: ' + b.members.map(m => `${short(m.tenant_id)}/${m.role}${m.staff_role ? ` (job title ${m.staff_role})` : ' (no staff row)'} — ${m.role_admits || m.title_admits ? 'MAY approve' : 'may NOT approve'}`).join('; ')
    : 'no tenant_members rows at all, so there is nobody to sign in as',
  b.policies.length
    ? 'policies: ' + b.policies.map(p => `${short(p.tenant_id)} admits account roles {${(p.approver_tenant_roles || []).join(',') || 'none'}} and job titles {${(p.approver_staff_roles || []).join(',') || 'none'}}`).join('; ')
    : 'no inventory_action_policy rows, so no dealership has stated who may approve',
  b.actions_by_tenant.length
    ? 'actions: ' + b.actions_by_tenant.map(a => `${short(a.tenant_id)} has ${a.actions} row(s), ${a.decidable} still decidable`).join('; ')
    : 'no inventory_actions rows anywhere, so there is nothing to decide',
  b.member_role_constraint ? `tenant_members role constraint: ${b.member_role_constraint}` : 'no role constraint found on tenant_members',
];

/* ── The SQL session ─────────────────────────────────────────────────────── */
function psqlText(url, sql, seconds = 120) {
  try {
    const out = execFileSync('psql', [url, '-Atq', '-v', 'ON_ERROR_STOP=1', '-f', '-'], {
      input: sql, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: seconds * 1000,
      env: { ...process.env, PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT || '10' },
    });
    return { ok: true, lines: out.split('\n').map(s => s.trim()).filter(Boolean) };
  } catch (e) {
    const raw = (e.stderr ? String(e.stderr) : '') || String(e.message || e);
    return { ok: false, why: raw.trim().replace(/\s+/g, ' ').slice(0, 400) };
  }
}
function psqlJson(url, sql) {
  const r = psqlText(url, sql);
  if (!r.ok) return r;
  try { return { ok: true, value: JSON.parse(r.lines[r.lines.length - 1]) }; }
  catch { return { ok: false, why: `the session answered with something that is not JSON: ${(r.lines.join(' ') || '(nothing)').slice(0, 200)}` }; }
}

/* A fingerprint of the DATABASE, not of the connection string. Two URLs can
   spell the same database three ways; only the database can say which one it
   is. Nothing here defends against a forged answer — it defends against the
   accident that actually happens, which is NEXUS_STAGING_DB_URL still pointing
   at production because somebody copied the wrong line. */
const IDENT_SQL = `select json_build_object(
  'db', current_database(), 'user', current_user,
  'fingerprint', md5(current_database() || '|'
     || (select oid::text from pg_database where datname = current_database()) || '|'
     || pg_postmaster_start_time()::text))::text;`;

const urlTarget = u => {
  try { const x = new URL(String(u).replace(/^postgres(ql)?:/, 'http:')); return `${x.hostname}:${x.port || '5432'}${x.pathname}`; }
  catch { return String(u); }
};

function resolveProbe() {
  try { execSync('command -v psql', { stdio: 'ignore' }); }
  catch { return { why: 'psql is not on PATH, so this gate cannot open a session against any database. B1..B3 assert what Postgres does with a caller, and a caller needs a session.' }; }
  const prod = process.env.NEXUS_DB_URL || null;
  const stg  = process.env.NEXUS_STAGING_DB_URL || null;
  if (stg) {
    if (prod && urlTarget(prod) === urlTarget(stg))
      return { why: `NEXUS_STAGING_DB_URL and NEXUS_DB_URL name the same host and database (${urlTarget(stg)}) — refusing to run a write probe against production` };
    const id = psqlJson(stg, IDENT_SQL);
    if (!id.ok) return { why: `NEXUS_STAGING_DB_URL is set and the gate could not open a session on it: ${id.why}` };
    if (prod) {
      const pid = psqlJson(prod, IDENT_SQL);
      if (pid.ok && pid.value.fingerprint === id.value.fingerprint)
        return { why: `NEXUS_STAGING_DB_URL and NEXUS_DB_URL are two spellings of ONE database (both answer with fingerprint ${id.value.fingerprint}) — refusing to run a write probe against production` };
      return { url: stg, writable: true, how: `NEXUS_STAGING_DB_URL (${urlTarget(stg)}, database "${id.value.db}", as ${id.value.user}), proven a different database from NEXUS_DB_URL by fingerprint` };
    }
    return { url: stg, writable: true, how: `NEXUS_STAGING_DB_URL (${urlTarget(stg)}, database "${id.value.db}", as ${id.value.user}). NEXUS_DB_URL is not set, so the gate could not prove this is not production; it is running on the operator's naming of the variable. Every probe statement is still inside a transaction that ends in ROLLBACK and the row counts are re-read afterwards.` };
  }
  if (prod) {
    const id = psqlJson(prod, IDENT_SQL);
    if (!id.ok) return { why: `NEXUS_DB_URL is set and the gate could not open a session on it: ${id.why}` };
    return { url: prod, writable: false, how: `NEXUS_DB_URL (${urlTarget(prod)}, database "${id.value.db}", as ${id.value.user}) — treated as production, so only arms that provably cannot write are run against it` };
  }
  return { why: 'neither NEXUS_STAGING_DB_URL nor NEXUS_DB_URL is set, so there is no session in which a caller could be refused' };
}
const PROBE = resolveProbe();

/* Every probe runs inside this frame. Row counts are read BEFORE the
   transaction opens and AFTER it is rolled back, from outside it, so the
   comparison is not being made by the transaction that would have to lie. If
   they moved, the probe wrote, and a result from a probe that wrote is not
   reported — it is a failure with its own sentence. */
const PROBE_COUNTS = `json_build_object(
    'audit', (select count(*) from public.audit_log),
    'events', (select count(*) from public.inventory_action_events),
    'actions', (select count(*) from public.inventory_actions),
    'members', (select count(*) from public.tenant_members))`;

function runProbe(url, body) {
  const r = psqlText(url, `
select json_build_object('phase','pre','counts', ${PROBE_COUNTS})::text;
begin;
create temporary table gate_out (v jsonb) on commit drop;
${body}
select json_build_object('phase','probe','v', coalesce((select v from gate_out), 'null'::jsonb))::text;
rollback;
select json_build_object('phase','post','counts', ${PROBE_COUNTS})::text;
`);
  if (!r.ok) return { ok: false, why: r.why };
  let pre = null, post = null, v;
  for (const line of r.lines) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o && o.phase === 'pre') pre = o.counts;
    else if (o && o.phase === 'probe') v = o.v;
    else if (o && o.phase === 'post') post = o.counts;
  }
  if (!pre || !post || v === undefined)
    return { ok: false, why: `the probe did not answer in the three phases this gate reads (${r.lines.length} line(s) came back)` };
  const moved = Object.keys(pre).filter(k => Number(pre[k]) !== Number(post[k]))
    .map(k => `${k} went from ${pre[k]} to ${post[k]}`);
  return { ok: true, v, moved, counts: pre };
}

/* Shared preamble for the two probes that need a decidable action: pick the
   dealership by what it HAS (a stated approval policy), never by position. */
const PROBE_GUARD = `
  if to_regprocedure('public.action_decide(uuid,text,text,text,date,uuid)') is null
     or to_regprocedure('public.action_approver_context()') is null then
    insert into gate_out(v) values (jsonb_build_object('runnable', false, 'why',
      'this database does not carry public.action_decide() and public.action_approver_context(), so there is no decision path here to refuse or to repeat'));
    return;
  end if;
  select p.tenant_id into v_tenant from public.inventory_action_policy p
   where exists (select 1 from public.inventory_actions a
                  where a.tenant_id = p.tenant_id and a.status in ('PROPOSED','DEFERRED'))
   order by p.tenant_id limit 1;
  if v_tenant is null then
    select p.tenant_id into v_tenant from public.inventory_action_policy p order by p.tenant_id limit 1;
  end if;
  if v_tenant is null then
    insert into gate_out(v) values (jsonb_build_object('runnable', false, 'why',
      'no dealership on this database has an inventory_action_policy row, so action_approver_context() answers NO_POLICY for everybody and there is no approval rule for anyone to be measured against'));
    return;
  end if;
  select approver_tenant_roles into v_approvers from public.inventory_action_policy where tenant_id = v_tenant;`;

/* ══ B1 ═══════════════════════════════════════════════════════════════════
   R7 proves the UI obeys a may_decide:false flag served from a stub. Nothing
   proves Postgres would refuse a caller who ignored the UI and posted to
   rpc/action_decide directly — and a caller who ignores the UI is the only
   caller this check is about. Two arms, because "refused" has two meanings
   worth separating: the function refuses, AND the table refuses. */
{
  const measured = CENSUS.b ? censusLines(CENSUS.b) : [];
  const body = `
do $$
declare
  v_tenant uuid; v_action uuid; v_uid uuid := gen_random_uuid();
  v_approvers text[]; v_legal text[]; v_role text; v_try text;
  v_may boolean; v_ctx_code text; v_any boolean;
  v_ok boolean; v_code text;
  a0 bigint; e0 bigint; a1 bigint; e1 bigint; v_refused bigint;
  s0 text; s_fn text; s1 text; d0 timestamptz; d_fn timestamptz; d1 timestamptz;
  v_direct text; v_rows bigint := 0; v_state text := '00000';
begin
${PROBE_GUARD}
  select coalesce(array_agg(distinct m[1]), '{}') into v_legal
    from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
   where c.conrelid = to_regclass('public.tenant_members') and c.contype = 'c'
     and pg_get_constraintdef(c.oid) ilike '%role%';
  foreach v_try in array coalesce(v_legal, '{}') loop
    if not (v_try = any (coalesce(v_approvers, '{}'))) then v_role := v_try; exit; end if;
  end loop;
  if v_role is null then
    insert into gate_out(v) values (jsonb_build_object('runnable', false, 'why',
      'every account role tenant_members_role_check admits (' || array_to_string(coalesce(v_legal,'{}'), ', ')
      || ') is also in this dealership''s approver_tenant_roles (' || array_to_string(coalesce(v_approvers,'{}'), ', ')
      || '), so a non-approving member cannot legally exist here and there is nobody for Postgres to refuse'));
    return;
  end if;

  insert into public.tenant_members (tenant_id, auth_user_id, role, staff_user_id)
  values (v_tenant, v_uid, v_role, null);

  select a.id, a.status, a.decided_at into v_action, s0, d0 from public.inventory_actions a
   where a.tenant_id = v_tenant and a.status in ('PROPOSED','DEFERRED') order by a.created_at limit 1;
  if v_action is null then
    insert into public.inventory_actions (tenant_id, unit_id, recommendation, engine_owner_role)
    values (v_tenant, 'GATE-PROBE-UNIT', 'REPRICE', 'Sales Manager') returning id, status, decided_at into v_action, s0, d0;
  end if;

  select count(*) into a0 from public.audit_log where tenant_id = v_tenant;
  select count(*) into e0 from public.inventory_action_events where tenant_id = v_tenant;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select may_decide, refusal_code, tenant_has_any_approver into v_may, v_ctx_code, v_any
    from public.action_approver_context();
  select ok, refusal_code into v_ok, v_code from public.action_decide(v_action, 'APPROVE');
  /* Read the row BETWEEN the two arms. Without this, a row moved by the direct
     UPDATE below is reported under the sentence "action_decide() refused it and
     the row moved anyway", which is a caption sitting on the wrong branch — the
     failure this repo has found seven times. Each arm is now measured against
     the state it inherited. */
  select status, decided_at into s_fn, d_fn from public.inventory_actions where id = v_action;
  /* The second door. rpc/action_decide is not the only way to move this row,
     and a caller who ignored the UI will not politely use the front one.
     The statement writes a COMPLETE, VALID decision tuple on purpose: an
     UPDATE that sets status alone is refused by the CHECK
     inventory_actions_decision_stamped before any privilege or policy is
     consulted, which reads as "refused" and is nothing of the kind. Measured
     3 Sep 2026 while writing this check, on a local replica of this schema in
     which authenticated genuinely held UPDATE and a USING(true) policy: the
     status-only form still came back "refused", i.e. this arm reported an open
     door as shut. That is a false negative on a P0, and it survived a first
     pass of this file. The SQLSTATE is carried out with
     the answer so that a refusal by the wrong mechanism can never be counted
     as a refusal by the right one. */
  begin
    execute 'update public.inventory_actions set status = ''APPROVED'', decided_at = now(), '
         || 'decided_by_authority = ''GATE_PROBE_FORGED'' where id = $1' using v_action;
    get diagnostics v_rows = row_count;
    v_state := '00000';
    v_direct := case when v_rows > 0
      then 'the UPDATE was ACCEPTED and rewrote ' || v_rows || ' row(s)'
      else 'reached the table and was filtered to 0 rows — stopped by RLS, which is a row filter and not a privilege' end;
  exception when others then
    v_rows := 0; v_state := sqlstate;
    v_direct := 'refused with SQLSTATE ' || sqlstate || ' — ' || replace(sqlerrm, '''', '');
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  select status, decided_at into s1, d1 from public.inventory_actions where id = v_action;
  select count(*) into a1 from public.audit_log where tenant_id = v_tenant;
  select count(*) into e1 from public.inventory_action_events where tenant_id = v_tenant;
  select count(*) into v_refused from public.inventory_action_events
   where action_id = v_action and event in ('APPROVAL_REFUSED','ESCALATED');

  insert into gate_out(v) values (jsonb_build_object(
    'runnable', true, 'tenant', v_tenant, 'action', v_action, 'role_used', v_role,
    'legal_roles', to_jsonb(coalesce(v_legal,'{}')), 'approver_roles', to_jsonb(coalesce(v_approvers,'{}')),
    'may_decide', v_may, 'ctx_refusal', v_ctx_code, 'tenant_has_any_approver', v_any,
    'dec_ok', v_ok, 'dec_refusal', v_code,
    'status_before', s0, 'status_after_function', s_fn, 'status_after', s1,
    'decided_before', d0, 'decided_after_function', d_fn, 'decided_after', d1,
    'direct_update', v_direct, 'direct_rows', v_rows, 'direct_sqlstate', v_state,
    'audit_delta', a1 - a0, 'event_delta', e1 - e0, 'refusal_events', v_refused));
exception when others then
  perform set_config('role', 'none', true);
  insert into gate_out(v) values (jsonb_build_object('runnable', false, 'why',
    'the probe could not complete on this database: SQLSTATE ' || sqlstate || ' — ' || replace(sqlerrm, '''', '')));
end $$;`;

  if (!PROBE.url || !PROBE.writable) {
    /* The read-only arm. It cannot establish the subject of this check, but it
       CAN find it broken: an identity with no membership at all must be refused
       before action_decide() reaches a row, and that arm writes nothing. If it
       is not refused, this check fails on a production database rather than
       waiting for a staging box that may never arrive. */
    let ro = null;
    if (PROBE.url) {
      ro = runProbe(PROBE.url, `
do $$
declare v_action uuid; v_ok boolean; v_code text; v_uid uuid := gen_random_uuid();
begin
  if to_regprocedure('public.action_decide(uuid,text,text,text,date,uuid)') is null then
    insert into gate_out(v) values (jsonb_build_object('arm','none','why','action_decide() does not exist here')); return;
  end if;
  select a.id into v_action from public.inventory_actions a order by a.created_at limit 1;
  if v_action is null then
    insert into gate_out(v) values (jsonb_build_object('arm','none','why','there is no inventory_actions row to aim a refusal at')); return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select ok, refusal_code into v_ok, v_code from public.action_decide(v_action, 'APPROVE');
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  insert into gate_out(v) values (jsonb_build_object('arm','NO_TENANT','ok', v_ok, 'refusal', v_code, 'action', v_action));
exception when others then
  perform set_config('role', 'none', true);
  insert into gate_out(v) values (jsonb_build_object('arm','error','why', sqlstate || ' — ' || replace(sqlerrm, '''', '')));
end $$;`);
    }
    const bad = [];
    if (ro && ro.ok && ro.v && ro.v.arm === 'NO_TENANT') {
      if (ro.moved.length) bad.push(`the read-only arm was supposed to write nothing and the row counts moved (${ro.moved.join(', ')}) — refusing to report anything from a probe that mutated the database`);
      if (ro.v.ok === true) bad.push('a signed-in identity that is a member of NO dealership was ACCEPTED by action_decide() — this arm writes nothing and returns before the row is even located, so there is no reading of this that is not a live authorisation hole');
      else if (ro.v.refusal !== 'NO_TENANT') bad.push(`a signed-in identity with no membership was refused with "${ro.v.refusal}" rather than NO_TENANT — the refusal order in action_approver_context() has changed and the rest of this check reasons about that order`);
      measured.push(`read-only arm RAN against ${PROBE.how}: an identity with no tenant_members row called action_decide() on a real action and got ok=${ro.v.ok}, refusal_code=${ro.v.refusal}; row counts before and after the rolled-back transaction were identical (${Object.entries(ro.counts).map(([k, n]) => `${k}=${n}`).join(', ')})`);
    } else if (ro && ro.ok && ro.v) {
      measured.push(`read-only arm did not run: ${ro.v.why || 'no answer'}`);
    } else if (ro) {
      measured.push(`read-only arm did not run: ${ro.why}`);
    }
    if (bad.length) {
      B_VERDICT('B1', bad, []);
    } else {
      const nonApprovers = CENSUS.b ? CENSUS.b.members.filter(m => !m.role_admits && !m.title_admits).length : null;
      B_NOTRUN('B1', measured, dot(PROBE.why || PROBE.how)
        + ' B1 needs to make a NON-APPROVER call action_decide(), and that call takes the NOT_AN_APPROVER arm, which writes an audit row and an APPROVAL_REFUSED event BEFORE it returns — so it cannot be exercised through a read-only channel, and this gate will not open a write probe on production. '
        + (CENSUS.b
          ? `Measured on this database: ${CENSUS.b.members.length} membership(s), of which ${nonApprovers} may not approve.`
          : dot(`The precondition could not even be measured: ${CENSUS.why}`))
        + ' Set NEXUS_STAGING_DB_URL to a staging Postgres carrying this schema and B1 runs there in full, inside a transaction that ends in ROLLBACK.');
    }
  } else {
    const p = runProbe(PROBE.url, body);
    if (!p.ok) {
      B_NOTRUN('B1', measured, `the write probe could not run on ${PROBE.how}: ${p.why}`);
    } else if (!p.v || p.v.runnable !== true) {
      B_NOTRUN('B1', measured, dot(`the probe target is ${PROBE.how}`) + ` It measured: ${(p.v && p.v.why) || 'the probe returned nothing'}`);
    } else {
      const v = p.v, bad = [];
      if (p.moved.length) bad.push(`the probe was supposed to leave nothing behind and the row counts moved (${p.moved.join(', ')}) — refusing to report a result from a probe that mutated the database`);
      if (v.may_decide === true) bad.push(`action_approver_context() told an account holding the role "${v.role_used}" that it MAY decide, and this dealership's policy admits only {${(v.approver_roles || []).join(', ')}}`);
      if (v.dec_ok === true) bad.push(`action_decide() ACCEPTED an APPROVE from a non-approver (role "${v.role_used}") — the refusal exists only in the UI`);
      if (v.dec_ok !== true && !['NOT_AN_APPROVER', 'NO_APPROVER_AT_DEALERSHIP'].includes(String(v.dec_refusal)))
        bad.push(`action_decide() refused a non-approver with "${v.dec_refusal}" — expected NOT_AN_APPROVER (or NO_APPROVER_AT_DEALERSHIP where nobody at all may approve), and a different code means the refusal came from somewhere other than the authorisation arm`);
      if (v.status_after_function !== v.status_before)
        bad.push(`the action moved from ${v.status_before} to ${v.status_after_function} across the action_decide() call — the function's refusal did not hold`);
      if (String(v.decided_after_function || '') !== String(v.decided_before || ''))
        bad.push(`decided_at changed (${v.decided_before} → ${v.decided_after_function}) across the action_decide() call, which reported a refusal`);
      const ds = String(v.direct_sqlstate || '');
      if (Number(v.direct_rows) > 0)
        bad.push(`the same non-approver then bypassed the function entirely: a direct UPDATE on public.inventory_actions, forging a complete decision tuple, was ACCEPTED and rewrote ${v.direct_rows} row(s). rpc/action_decide is not the only door, and the table has to refuse too`);
      const directLine = Number(v.direct_rows) > 0 ? null
        : ds === '42501' ? `the same caller's direct UPDATE on public.inventory_actions was refused by the GRANT: ${v.direct_update}`
        : ds === '00000' ? `the same caller's direct UPDATE on public.inventory_actions ${v.direct_update} — CLAUDE.md: a row filter is one lock, not two, and "0 rows" is evidence about RLS and never evidence that the privilege is absent`
        : `INCONCLUSIVE on the second door: the UPDATE this gate issued came back with SQLSTATE ${ds} (${v.direct_update}), which is neither a privilege refusal nor a row filter — it never reached the question, so this run says NOTHING about whether authenticated may write public.inventory_actions directly. The function arm above is what this result rests on`;
      if (Number(v.refusal_events) === 0 || Number(v.audit_delta) === 0)
        bad.push(`the refusal was not recorded: ${v.audit_delta} audit row(s) and ${v.refusal_events} APPROVAL_REFUSED/ESCALATED event(s) were written. A refusal nobody can read afterwards is not evidence of anything`);
      B_VERDICT('B1', bad, [
        `RAN against ${PROBE.how}`,
        `the probe created a member of dealership ${short(v.tenant)} holding the role "${v.role_used}" — chosen because tenant_members_role_check admits {${(v.legal_roles || []).join(', ')}} and the dealership's policy admits only {${(v.approver_roles || []).join(', ')}} — with no staff row, so no job title could admit it either`,
        `action_approver_context() answered may_decide=${v.may_decide}, refusal_code=${v.ctx_refusal}, tenant_has_any_approver=${v.tenant_has_any_approver}`,
        `action_decide(APPROVE) on action ${short(v.action)} answered ok=${v.dec_ok}, refusal_code=${v.dec_refusal}; the action stayed ${v.status_after_function} and decided_at did not move`,
        directLine,
        `the refusal was recorded: ${v.audit_delta} audit row(s) and ${v.refusal_events} APPROVAL_REFUSED/ESCALATED event(s)`,
        `nothing persisted: the whole probe ran in a transaction that ended in ROLLBACK and the audit, event, action and membership counts were identical before and after (${Object.entries(p.counts).map(([k, n]) => `${k}=${n}`).join(', ')})`,
      ].filter(Boolean).concat(measured));
    }
  }
}

/* ══ B2 ═══════════════════════════════════════════════════════════════════
   Two arms, and the second is the one the old title left out. action_decide()
   returns ok=true, idempotent=true and writes NOTHING only when the status
   already equals the target AND the same account decided it AND the reason
   code matches AND defer_until is not distinct. Every other repeat takes the
   ALREADY_DECIDED branch, which DOES write — an audit row and a
   DECISION_CONFLICT event — and that write is a feature: a second person
   trying to overturn a decision is exactly the thing a dealership needs to be
   able to read back. So this check asserts silence on one arm and a record on
   the other, and a system that got them the wrong way round fails here. */
{
  const measured = CENSUS.b ? censusLines(CENSUS.b) : [];
  const body = `
do $$
declare
  v_tenant uuid; v_action uuid; v_approvers text[]; v_role text;
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid();
  r1_ok boolean; r1_idem boolean; r1_code text;
  r2_ok boolean; r2_idem boolean; r2_code text;
  r3_ok boolean; r3_code text; r3_ran boolean := false;
  r4_ok boolean; r4_code text;
  a0 bigint; e0 bigint; a1 bigint; e1 bigint; a2 bigint; e2 bigint; a3 bigint; e3 bigint; a4 bigint; e4 bigint;
  s1 text; d1 timestamptz; s2 text; d2 timestamptz; s3 text; s4 text;
  v_code text; v_conflicts bigint;
begin
${PROBE_GUARD}
  if coalesce(array_length(v_approvers, 1), 0) = 0 then
    insert into gate_out(v) values (jsonb_build_object('runnable', false, 'why',
      'this dealership''s inventory_action_policy admits no account role at all as an approver, so no identity can make the first decision that a second one would have to be idempotent against'));
    return;
  end if;
  v_role := v_approvers[1];
  insert into public.tenant_members (tenant_id, auth_user_id, role, staff_user_id)
  values (v_tenant, u1, v_role, null), (v_tenant, u2, v_role, null);

  insert into public.inventory_actions (tenant_id, unit_id, recommendation, engine_owner_role)
  values (v_tenant, 'GATE-PROBE-UNIT', 'REPRICE', 'Sales Manager') returning id into v_action;

  select count(*) into a0 from public.audit_log where tenant_id = v_tenant;
  select count(*) into e0 from public.inventory_action_events where tenant_id = v_tenant;

  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select ok, idempotent, refusal_code into r1_ok, r1_idem, r1_code from public.action_decide(v_action, 'APPROVE');
  perform set_config('role', 'none', true);
  select status, decided_at into s1, d1 from public.inventory_actions where id = v_action;
  select count(*) into a1 from public.audit_log where tenant_id = v_tenant;
  select count(*) into e1 from public.inventory_action_events where tenant_id = v_tenant;

  perform set_config('role', 'authenticated', true);
  select ok, idempotent, refusal_code into r2_ok, r2_idem, r2_code from public.action_decide(v_action, 'APPROVE');
  perform set_config('role', 'none', true);
  select status, decided_at into s2, d2 from public.inventory_actions where id = v_action;
  select count(*) into a2 from public.audit_log where tenant_id = v_tenant;
  select count(*) into e2 from public.inventory_action_events where tenant_id = v_tenant;

  select code into v_code from public.inventory_action_reason_codes
   where 'REJECT' = any (applies_to) order by sort nulls last, code limit 1;
  if v_code is not null then
    r3_ran := true;
    perform set_config('role', 'authenticated', true);
    select ok, refusal_code into r3_ok, r3_code
      from public.action_decide(v_action, 'REJECT', v_code, 'Quality gate probe: a conflicting second decision.');
    perform set_config('role', 'none', true);
  end if;
  select status into s3 from public.inventory_actions where id = v_action;
  select count(*) into a3 from public.audit_log where tenant_id = v_tenant;
  select count(*) into e3 from public.inventory_action_events where tenant_id = v_tenant;

  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select ok, refusal_code into r4_ok, r4_code from public.action_decide(v_action, 'APPROVE');
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  select status into s4 from public.inventory_actions where id = v_action;
  select count(*) into a4 from public.audit_log where tenant_id = v_tenant;
  select count(*) into e4 from public.inventory_action_events where tenant_id = v_tenant;
  select count(*) into v_conflicts from public.inventory_action_events
   where action_id = v_action and event = 'DECISION_CONFLICT';

  insert into gate_out(v) values (jsonb_build_object(
    'runnable', true, 'tenant', v_tenant, 'action', v_action, 'approver_role', v_role,
    'r1', jsonb_build_object('ok', r1_ok, 'idem', r1_idem, 'code', r1_code, 'status', s1, 'audit', a1 - a0, 'events', e1 - e0),
    'r2', jsonb_build_object('ok', r2_ok, 'idem', r2_idem, 'code', r2_code, 'status', s2, 'audit', a2 - a1, 'events', e2 - e1,
                             'decided_moved', (d2 is distinct from d1)),
    'r3', jsonb_build_object('ran', r3_ran, 'reason_code', v_code, 'ok', r3_ok, 'code', r3_code, 'status', s3, 'audit', a3 - a2, 'events', e3 - e2),
    'r4', jsonb_build_object('ok', r4_ok, 'code', r4_code, 'status', s4, 'audit', a4 - a3, 'events', e4 - e3),
    'conflict_events', v_conflicts));
exception when others then
  perform set_config('role', 'none', true);
  insert into gate_out(v) values (jsonb_build_object('runnable', false, 'why',
    'the probe could not complete on this database: SQLSTATE ' || sqlstate || ' — ' || replace(sqlerrm, '''', '')));
end $$;`;

  if (!PROBE.url || !PROBE.writable) {
    B_NOTRUN('B2', measured, dot(PROBE.why || PROBE.how)
      + ' B2 has to make a decision and then repeat it, so both of its arms are state changes by definition and neither has a read-only form; this gate will not open a write probe on production. '
      + (CENSUS.b
        ? `Measured on this database: ${CENSUS.b.actions_by_tenant.reduce((n, a) => n + Number(a.decidable || 0), 0)} action(s) are in a state a decision could still move, and ${CENSUS.b.members.filter(m => m.role_admits || m.title_admits).length} membership(s) may approve.`
        : dot(`The precondition could not even be measured: ${CENSUS.why}`))
      + ' Set NEXUS_STAGING_DB_URL to a staging Postgres carrying this schema and B2 runs there in full, inside a transaction that ends in ROLLBACK.');
  } else {
    const p = runProbe(PROBE.url, body);
    if (!p.ok) B_NOTRUN('B2', measured, `the write probe could not run on ${PROBE.how}: ${p.why}`);
    else if (!p.v || p.v.runnable !== true) B_NOTRUN('B2', measured, dot(`the probe target is ${PROBE.how}`) + ` It measured: ${(p.v && p.v.why) || 'the probe returned nothing'}`);
    else {
      const v = p.v, bad = [], r1 = v.r1, r2 = v.r2, r3 = v.r3, r4 = v.r4;
      if (p.moved.length) bad.push(`the probe was supposed to leave nothing behind and the row counts moved (${p.moved.join(', ')}) — refusing to report a result from a probe that mutated the database`);
      if (r1.ok !== true) bad.push(`the first decision was refused: ok=${r1.ok}, refusal_code=${r1.code}. The identity holds "${v.approver_role}", which this dealership's own policy admits as an approver, so a refusal here is a defect and not a precondition`);
      if (r1.ok === true && r1.status !== 'APPROVED') bad.push(`the first APPROVE reported ok=true and left the action in ${r1.status}`);
      if (r1.ok === true && r1.idem === true) bad.push('the FIRST decision reported idempotent=true — it changed the state, so it was not a repeat of anything');
      /* Arm 1: the double-click. Silent by contract. */
      if (r2.ok !== true || r2.idem !== true)
        bad.push(`the identical decision, repeated by the same account, answered ok=${r2.ok} idempotent=${r2.idem} refusal=${r2.code} — the double-click is supposed to be recognised and answered ok=true, idempotent=true`);
      if (Number(r2.audit) !== 0 || Number(r2.events) !== 0)
        bad.push(`the repeated decision wrote ${r2.audit} audit row(s) and ${r2.events} event(s) — an idempotent repeat writes nothing, and anything counting audit rows to count decisions will now double-count this one`);
      if (r2.status !== r1.status || r2.decided_moved === true)
        bad.push(`the repeated decision moved the row: status ${r1.status} → ${r2.status}${r2.decided_moved ? ', and decided_at was rewritten' : ''} — that is a second state change, which is exactly what "one state change" forbids`);
      /* Arm 2: the conflicting second decision. Recorded by contract. */
      if (r3.ran) {
        if (r3.ok !== false || r3.code !== 'ALREADY_DECIDED')
          bad.push(`a REJECT arriving for an already-APPROVED action answered ok=${r3.ok}, refusal_code=${r3.code} — expected ok=false, ALREADY_DECIDED, because the first decision stands`);
        if (r3.status !== r1.status) bad.push(`the conflicting REJECT moved the action from ${r1.status} to ${r3.status} — the first decision did not stand`);
        if (Number(r3.audit) < 1 || Number(r3.events) < 1)
          bad.push(`the conflicting decision wrote ${r3.audit} audit row(s) and ${r3.events} event(s) — a second person trying to overturn a decision has to be readable afterwards, and this one left no trace`);
      }
      if (r4.ok !== false || r4.code !== 'ALREADY_DECIDED')
        bad.push(`the same APPROVE from a DIFFERENT approver answered ok=${r4.ok}, refusal_code=${r4.code} — the idempotent arm is keyed on decided_by_auth_id, so another account repeating the decision must take the ALREADY_DECIDED branch and not be silently absorbed as a double-click`);
      if (Number(v.conflict_events) < 1)
        bad.push('not one DECISION_CONFLICT event was written across the conflicting attempts');
      B_VERDICT('B2', bad, [
        `RAN against ${PROBE.how}`,
        `on dealership ${short(v.tenant)}, action ${short(v.action)}, decided by two accounts both holding the approving role "${v.approver_role}"`,
        `first APPROVE: ok=${r1.ok}, idempotent=${r1.idem}, status ${r1.status}, +${r1.audit} audit row(s), +${r1.events} event(s)`,
        `the same APPROVE again from the same account: ok=${r2.ok}, idempotent=${r2.idem}, status ${r2.status}, +${r2.audit} audit row(s), +${r2.events} event(s), decided_at unchanged — one state change`,
        r3.ran
          ? `a conflicting REJECT (reason ${r3.reason_code}) from the same account: ok=${r3.ok}, refusal_code=${r3.code}, action still ${r3.status}, +${r3.audit} audit row(s), +${r3.events} event(s) — refused AND recorded`
          : 'the conflicting-REJECT arm did not run: this database carries no inventory_action_reason_codes row that applies to REJECT, and a rejection without a code is refused earlier for a different reason',
        `the same APPROVE from a second approver: ok=${r4.ok}, refusal_code=${r4.code}, action still ${r4.status}, +${r4.audit} audit row(s), +${r4.events} event(s)`,
        `${v.conflict_events} DECISION_CONFLICT event(s) recorded`,
        `nothing persisted: the whole probe ran in a transaction that ended in ROLLBACK and the audit, event, action and membership counts were identical before and after (${Object.entries(p.counts).map(([k, n]) => `${k}=${n}`).join(', ')})`,
      ].concat(measured));
    }
  }
}

/* ══ B3 ═══════════════════════════════════════════════════════════════════
   THE 2 SEPTEMBER TWO-TENANT PROOF DOES NOT COVER THIS, and the gate must not
   let it look as though it does. That pass ran 08:44–08:54 UTC over 25 objects.
   The Action Center tables were created at 18:12 the SAME DAY, and
   attribution_*, leadrec_*, deal_rescue_* and policy_* on 3 September. Not one
   of the objects this check is about existed while that evidence was being
   gathered. It is good evidence about what it covered and it is not evidence
   about this.

   Two arms, because "cannot see" and "cannot act on" are enforced by different
   machinery: the read arm is RLS (USING tenant_id IN nexus_current_tenant_ids())
   and the write arm is action_decide()'s locking read, whose miss returns
   NOT_FOUND and writes nothing — deliberately giving the same answer for "no
   such action" and "belongs to another dealership", so that a refusal cannot
   be used to confirm another dealership's row exists. Both arms are no-write
   and take no row lock, so B3 runs on whichever session is configured. */
{
  const measured = CENSUS.b ? censusLines(CENSUS.b) : [];
  const body = `
do $$
declare
  v_a uuid; v_b uuid; v_uid uuid; v_action_b uuid;
  n_b bigint; own_b bigint; vis_total bigint; vis_b bigint; vis_a bigint; mine bigint;
  q_b bigint; q_state text := 'the queue view does not exist on this database';
  d_ok boolean; d_code text;
  s_before text; s_after text; a0 bigint; e0 bigint; a1 bigint; e1 bigint;
begin
  if (select count(*) from public.tenants) < 2 then
    insert into gate_out(v) values (jsonb_build_object('runnable', false, 'why',
      'public.tenants holds ' || (select count(*) from public.tenants)
      || ' row(s). There is no dealership B whose rows could be withheld from a member of dealership A, so there is nothing here to withhold and nothing to prove'));
    return;
  end if;
  select m.tenant_id, m.auth_user_id into v_a, v_uid
    from public.tenant_members m
    join public.tenants t on t.id = m.tenant_id and t.status = 'active'
   where exists (select 1 from public.inventory_actions x where x.tenant_id <> m.tenant_id)
     and not exists (select 1 from public.tenant_members m2
                      where m2.auth_user_id = m.auth_user_id and m2.tenant_id <> m.tenant_id)
   order by m.created_at, m.tenant_id limit 1;
  if v_a is null then
    insert into gate_out(v) values (jsonb_build_object('runnable', false, 'why',
      'no account is a member of exactly one active dealership while another dealership holds inventory_actions rows — either nobody is single-tenant, or only one dealership has any actions, so a cross-dealership read cannot be attempted'));
    return;
  end if;
  select a.tenant_id into v_b from public.inventory_actions a
   where a.tenant_id <> v_a order by a.tenant_id limit 1;
  select count(*) into n_b from public.inventory_actions where tenant_id = v_b;
  select count(*) into own_b from public.inventory_actions where tenant_id = v_a;
  select a.id, a.status into v_action_b, s_before from public.inventory_actions a
   where a.tenant_id = v_b order by a.created_at limit 1;
  select count(*) into a0 from public.audit_log;
  select count(*) into e0 from public.inventory_action_events;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into vis_total from public.inventory_actions;
  select count(*) into vis_b from public.inventory_actions where tenant_id = v_b;
  select count(*) into vis_a from public.inventory_actions where tenant_id = v_a;
  if to_regclass('public.v_inventory_action_queue') is not null then
    execute 'select count(*) from public.v_inventory_action_queue where tenant_id = $1' into q_b using v_b;
    q_state := 'read';
  end if;
  if to_regprocedure('public.action_decide(uuid,text,text,text,date,uuid)') is not null then
    select ok, refusal_code into d_ok, d_code from public.action_decide(v_action_b, 'APPROVE');
  end if;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  select status into s_after from public.inventory_actions where id = v_action_b;
  select count(*) into a1 from public.audit_log;
  select count(*) into e1 from public.inventory_action_events;

  insert into gate_out(v) values (jsonb_build_object(
    'runnable', true, 'tenant_a', v_a, 'tenant_b', v_b, 'member', v_uid,
    'b_rows', n_b, 'a_rows', own_b, 'action_b', v_action_b,
    'visible_total', vis_total, 'visible_b', vis_b, 'visible_a', vis_a,
    'queue_b', q_b, 'queue_state', q_state,
    'decide_ok', d_ok, 'decide_code', d_code,
    'status_before', s_before, 'status_after', s_after,
    'audit_delta', a1 - a0, 'event_delta', e1 - e0));
exception when others then
  perform set_config('role', 'none', true);
  insert into gate_out(v) values (jsonb_build_object('runnable', false, 'why',
    'the probe could not complete on this database: SQLSTATE ' || sqlstate || ' — ' || replace(sqlerrm, '''', '')));
end $$;`;

  if (!PROBE.url) {
    B_NOTRUN('B3', measured, dot(PROBE.why) + ' '
      + (CENSUS.b
        ? `The catalogue says this database holds ${CENSUS.b.tenants} dealership(s)${Number(CENSUS.b.tenants) < 2 ? ', so there is no dealership B whose rows could be withheld' : ', which is enough to attempt it'}, but a catalogue has no caller and this check is about what Postgres does with one.`
        : dot(`The precondition could not even be measured: ${CENSUS.why}`))
      + ' Point NEXUS_DB_URL or NEXUS_STAGING_DB_URL at a database with two dealerships and both arms run: neither writes and neither takes a row lock.');
  } else {
    const p = runProbe(PROBE.url, body);
    if (!p.ok) B_NOTRUN('B3', measured, `the probe could not run on ${PROBE.how}: ${p.why}`);
    else if (!p.v || p.v.runnable !== true) B_NOTRUN('B3', measured, dot(`the probe target is ${PROBE.how}`) + ` It measured: ${(p.v && p.v.why) || 'the probe returned nothing'}`);
    else {
      const v = p.v, bad = [];
      if (p.moved.length) bad.push(`both arms of this check are supposed to write nothing and the row counts moved (${p.moved.join(', ')}) — refusing to report a result from a probe that mutated the database`);
      /* Non-vacuity first, in both directions. A zero is only evidence when a
         non-zero was possible, and when the same reader can see its own rows. */
      if (Number(v.b_rows) === 0) bad.push('dealership B holds no inventory_actions rows at all, so "0 visible" says nothing — this check would have reported a clean isolation result on an empty set');
      if (Number(v.a_rows) > 0 && Number(v.visible_a) === 0)
        bad.push(`the member of dealership A could not read any of their OWN ${v.a_rows} action row(s) either, so the zero below is RLS denying everything rather than isolation working — the result is vacuous, not clean`);
      if (Number(v.visible_b) > 0) bad.push(`a member of dealership ${short(v.tenant_a)} read ${v.visible_b} of dealership ${short(v.tenant_b)}'s ${v.b_rows} inventory_actions rows`);
      if (Number(v.visible_total) !== Number(v.visible_a))
        bad.push(`an unqualified SELECT returned ${v.visible_total} rows and the member's own dealership holds ${v.visible_a} visible — the difference is another dealership's rows`);
      if (v.queue_state === 'read' && Number(v.queue_b) > 0)
        bad.push(`v_inventory_action_queue handed ${v.queue_b} of dealership ${short(v.tenant_b)}'s rows to a member of ${short(v.tenant_a)} — the view is a second door onto the same rows and it has to be locked too`);
      if (v.decide_ok === true)
        bad.push(`action_decide() ACCEPTED a decision from a member of dealership ${short(v.tenant_a)} on dealership ${short(v.tenant_b)}'s action ${short(v.action_b)}`);
      else if (v.decide_code !== 'NOT_FOUND')
        bad.push(`action_decide() refused the cross-dealership decision with "${v.decide_code}" rather than NOT_FOUND — a distinct code confirms the row exists, which is precisely what "the same answer for no such action and belongs to another dealership" was written to avoid`);
      if (v.status_after !== v.status_before)
        bad.push(`dealership B's action moved from ${v.status_before} to ${v.status_after}`);
      if (Number(v.audit_delta) !== 0 || Number(v.event_delta) !== 0)
        bad.push(`the cross-dealership decision wrote ${v.audit_delta} audit row(s) and ${v.event_delta} event(s) — the NOT_FOUND arm returns before any write, so anything written here is a row about another dealership's action`);
      B_VERDICT('B3', bad, [
        `RAN against ${PROBE.how}`,
        `dealership A = ${short(v.tenant_a)} (${v.a_rows} action rows), dealership B = ${short(v.tenant_b)} (${v.b_rows} action rows); the caller is an account that is a member of A and of nothing else`,
        `read arm: as that member, SELECT on public.inventory_actions returned ${v.visible_total} row(s) — ${v.visible_a} of A's and ${v.visible_b} of B's; ${v.queue_state === 'read' ? `v_inventory_action_queue returned ${v.queue_b} of B's rows` : v.queue_state}`,
        `non-vacuous: B's ${v.b_rows} rows are readable to the owner of this session and A's own ${v.visible_a} were visible to the member, so the zero is isolation and not an empty table`,
        `write arm: action_decide(APPROVE) on B's action ${short(v.action_b)} answered ok=${v.decide_ok}, refusal_code=${v.decide_code}; B's action stayed ${v.status_after} and 0 audit rows and 0 events were written — the refusal does not confirm the row exists`,
        'this does NOT rest on the 2 Sep 2026 two-tenant proof: that pass ran 08:44–08:54 UTC and every Action Center object it would have needed was created at 18:12 that day or later, so it could not have covered any of this',
        `nothing persisted: the whole probe ran in a transaction that ended in ROLLBACK and the row counts were identical before and after (${Object.entries(p.counts).map(([k, n]) => `${k}=${n}`).join(', ')})`,
      ].concat(measured));
    }
  }
}

/* ══ B4 ═══════════════════════════════════════════════════════════════════
   R2, R4 and R5 prove the screens render A row correctly. Nothing in the
   offline lanes proves the app fetches the RIGHT row and displays it
   unmangled, because the row it is graded against is one this file invented.
   B4 needs no second dealership and writes nothing — the render lane's own
   PostgREST traffic is 129 reads — it needs credentials and one live render.

   The comparison is deliberately made against a SECOND, independent read: the
   gate signs in, calls the same endpoint the Inventory screen calls, and holds
   the answer itself. A bug in lib/data.js cannot cancel out, because the gate
   does not use lib/data.js.

   WHAT IT DOES NOT ASSERT, stated so nobody reads more into a PASS than is
   there: it proves every unit the database returns is on the screen with the
   figure the database holds. It does not prove the screen shows NO OTHER unit;
   telling an invented row from a VIN, a reference or a search hint in rendered
   text needs a per-screen rule, and a rule that guesses is the cry-wolf failure
   this gate was rebuilt to end. */
{
  const L = {
    url: (process.env.NEXUS_LIVE_URL || '').replace(/\/+$/, ''),
    anon: process.env.NEXUS_LIVE_ANON_KEY || '',
    email: process.env.NEXUS_LIVE_EMAIL || '',
    password: process.env.NEXUS_LIVE_PASSWORD || '',
    token: process.env.NEXUS_LIVE_ACCESS_TOKEN || '',
  };
  const present = k => (L[k] ? 'set' : 'NOT set');
  const measured = [
    `NEXUS_LIVE_URL ${present('url')}${L.url ? ` (${L.url})` : ''}, NEXUS_LIVE_ANON_KEY ${present('anon')}, NEXUS_LIVE_ACCESS_TOKEN ${present('token')}, NEXUS_LIVE_EMAIL ${present('email')}, NEXUS_LIVE_PASSWORD ${present('password')}`,
  ];
  const missing = [];
  if (!L.url) missing.push('NEXUS_LIVE_URL');
  if (!L.anon) missing.push('NEXUS_LIVE_ANON_KEY');
  if (!L.token && !(L.email && L.password)) missing.push('NEXUS_LIVE_ACCESS_TOKEN (or NEXUS_LIVE_EMAIL and NEXUS_LIVE_PASSWORD)');

  if (missing.length) {
    B_NOTRUN('B4', measured, `no live render credential is configured — ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing. The render lane above signs into a STUB on purpose, so its result is deterministic and says nothing about live data. Set those variables to a Supabase project and a dealership account and B4 signs in, reads the units itself, renders the app against the same project and compares; it only ever reads.`);
  } else {
    let fail = null, expected = null, source = null, token = L.token;
    const H = extra => ({ apikey: L.anon, ...extra });
    try {
      if (!token) {
        const r = await fetch(`${L.url}/auth/v1/token?grant_type=password`, {
          method: 'POST', headers: H({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ email: L.email, password: L.password }),
        });
        const body = await r.text();
        if (!r.ok) fail = `signing in as ${L.email} was refused with HTTP ${r.status}: ${body.slice(0, 200)}`;
        else token = JSON.parse(body).access_token;
        if (!fail && !token) fail = 'the sign-in succeeded and returned no access_token';
      }
      if (!fail) {
        const auth = H({ Authorization: `Bearer ${token}` });
        let r = await fetch(`${L.url}/rest/v1/rpc/sentinel_inventory_actions`, { headers: auth });
        source = 'rpc/sentinel_inventory_actions, the endpoint the Inventory screen itself calls';
        if (!r.ok) {
          r = await fetch(`${L.url}/rest/v1/v_inventory_profit_sentinel?select=id,vin,price_aed,cost_aed`, { headers: auth });
          source = 'v_inventory_profit_sentinel (rpc/sentinel_inventory_actions was not available)';
        }
        if (!r.ok) fail = `the signed-in account could not read the units: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`;
        else expected = await r.json();
      }
    } catch (e) { fail = `the live endpoint could not be reached: ${String(e.message || e)}`; }

    if (fail) B_NOTRUN('B4', measured, `the credentials are configured and the gate could not get a comparable reading out of ${L.url}: ${fail}`);
    else if (!Array.isArray(expected) || !expected.length)
      B_NOTRUN('B4', measured.concat([`read ${source}`]), `the signed-in account sees 0 units at this dealership, so there is no figure to compare a render against. A pass here would mean nothing was checked.`);
    else if (!NAV_IDS.includes('inventory'))
      B_NOTRUN('B4', measured, 'lib/nav.js no longer offers an "inventory" screen, and this check compares the Inventory screen against the units the database returns');
    else {
      let live4 = null;
      const OUT = join(tmpdir(), `nexus-gate-live-${process.pid}`);
      try {
        execFileSync('node_modules/.bin/vite', ['build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'error'],
          { cwd: HERE, stdio: 'pipe', env: { ...process.env, VITE_SUPABASE_URL: L.url, VITE_SUPABASE_ANON_KEY: L.anon, VITE_N8N_BASE_URL: process.env.VITE_N8N_BASE_URL || 'https://example.invalid' } });
        const { chromium } = await import('playwright');
        const exe = process.env.PLAYWRIGHT_CHROMIUM_PATH
          || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
        const insecure = process.env.NEXUS_LIVE_INSECURE_TLS === '1';
        const srv = await serve(OUT, 8072);
        const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), ...(insecure ? { args: ['--ignore-certificate-errors'] } : {}) });
        const ctx = await browser.newContext(insecure ? { ignoreHTTPSErrors: true } : {});
        const page = await ctx.newPage();
        /* The webfont is stubbed here for the same reason the render lane stubs
           it: a check about a dealership's figures must not depend on a font CDN
           being reachable from wherever this gate happens to be running. */
        await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, body: '', contentType: 'text/css' }));
        const ref = new URL(L.url).hostname.split('.')[0];
        const exp = Math.floor(Date.now() / 1000) + 3600;
        await page.addInitScript(([k, t, e]) => {
          localStorage.setItem(k, JSON.stringify({ access_token: t, token_type: 'bearer', expires_in: 3600, expires_at: e, refresh_token: 'gate-no-refresh',
            user: { id: 'live', aud: 'authenticated', role: 'authenticated' } }));
        }, [`sb-${ref}-auth-token`, token, exp]);
        await page.goto('http://127.0.0.1:8072/', { waitUntil: 'load' });
        await page.waitForTimeout(2500);
        const loggedIn = await page.evaluate(() => !document.getElementById('app').classList.contains('hide'));
        await page.evaluate(() => { location.hash = 'inventory'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
        await page.waitForTimeout(2500);
        const screen = await page.evaluate(() => {
          const host = document.getElementById('screen');
          return { text: host.innerText || '', len: host.innerHTML.length, errored: /Couldn.t load/.test(host.innerHTML) };
        });
        await browser.close(); srv.close();
        live4 = { loggedIn, screen };
      } catch (e) { live4 = { failed: String(e.message || e) }; }

      if (live4.failed) {
        B_NOTRUN('B4', measured.concat([`read ${expected.length} unit(s) from ${source}`]),
          `the live render could not be produced: ${live4.failed}`);
      } else {
        const bad = [];
        const money = v => {
          const x = Number(v);
          if (v == null || v === '' || !Number.isFinite(x)) return null;
          /* Both spellings, because the browser has full ICU and node may not,
             and a check that fails on the gate's own locale data is noise. */
          return [...new Set(['en-AE', 'en-US'].map(l => 'AED ' + new Intl.NumberFormat(l).format(Math.round(x))))];
        };
        const t = live4.screen.text;
        if (!live4.loggedIn) bad.push('the app did not reach a signed-in state with a real access token, so nothing was rendered to compare');
        if (live4.screen.errored) bad.push('the Inventory screen rendered its "couldn\'t load" state against the live project');
        const missingRows = [], wrongFigures = [];
        for (const row of expected) {
          const id = String(row.id == null ? '' : row.id);
          if (!id) continue;
          if (!t.includes(id)) { missingRows.push(id); continue; }
          const want = money(row.price_aed);
          if (want && !want.some(s => t.includes(s)))
            wrongFigures.push(`${id}: the database holds price_aed=${row.price_aed}, which renders as "${want[0]}", and that string is nowhere on the screen`);
        }
        if (missingRows.length) bad.push(`${missingRows.length} of ${expected.length} unit(s) this dealership's database returns do not appear on the Inventory screen at all: ${missingRows.slice(0, 8).join(', ')}${missingRows.length > 8 ? ' …' : ''}`);
        if (wrongFigures.length) bad.push(...wrongFigures.slice(0, 8));
        B_VERDICT('B4', bad, [
          `RAN against ${L.url}, signed in ${L.token ? 'with NEXUS_LIVE_ACCESS_TOKEN' : `as ${L.email}`}`,
          `the gate read ${expected.length} unit(s) itself from ${source} — a second, independent read, so a fetch bug in lib/data.js cannot cancel out against it`,
          `every one of those ${expected.length} unit ids appears on the Inventory screen, and every non-null price_aed appears in the exact string lib/format.js would produce for it`,
          `${live4.screen.len} characters rendered; the comparison is completeness and figure fidelity, and it does not claim the screen shows no OTHER unit`,
          'read-only: this check signs in, reads and renders; it writes nothing',
        ].concat(measured));
      }
    }
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   REPORT
   ══════════════════════════════════════════════════════════════════════════ */
function report() {
  const order = { FAIL: 0, 'NOT RUN': 1, WARN: 2, PASS: 3 };
  const rows = [...results].sort((a, b) => order[a.state] - order[b.state] || a.id.localeCompare(b.id));
  const n = s => results.filter(r => r.state === s).length;
  const blocking = results.filter(r => r.state === 'FAIL' && r.severity === 'P0');
  const unrun    = results.filter(r => r.state === 'NOT RUN' && r.severity === 'P0');

  console.log('\n════ NEXUS QUALITY GATE ════');
  for (const r of rows) {
    console.log(`${r.state.padEnd(8)} ${r.severity}  ${r.id.padEnd(5)} ${r.lane.padEnd(18)} ${r.title}`);
    if (r.reason) console.log(`                     reason: ${r.reason}`);
    for (const e of r.evidence.slice(0, 8)) console.log(`                     · ${e}`);
  }
  console.log(`\nPASS ${n('PASS')}   FAIL ${n('FAIL')}   WARN ${n('WARN')}   NOT RUN ${n('NOT RUN')}`);
  if (blocking.length) {
    console.log('\nBLOCKING FAILURES');
    for (const r of blocking) { console.log(`  ${r.id} ${r.title}`); r.evidence.forEach(e => console.log(`     ${e}`)); }
  }
  if (unrun.length) console.log(`\nLAUNCH-CRITICAL CHECKS THAT COULD NOT RUN: ${unrun.map(r => r.id).join(', ')}`);
  return { blocking, unrun, rows };
}
const { blocking, unrun, rows } = report();

const md = opt('--report');
if (md) {
  const esc = s => String(s).replace(/\|/g, '\\|');
  const body = rows.map(r =>
    `### ${r.id} · ${r.title}\n\n**${r.state}** · ${r.severity} · ${r.lane}\n\n`
    + (r.reason ? `_Could not run: ${r.reason}_\n\n` : '')
    + (r.evidence.length ? r.evidence.map(e => `- ${esc(e)}`).join('\n') + '\n' : '')).join('\n');
  const tally = st => results.filter(r => r.state === st).length;
  const codeNow = blocking.length ? 1 : (unrun.length ? 2 : 0);
  await writeFile(md, `# NEXUS OS — quality gate\n\nRun ${new Date().toISOString()}\n\n`
    + `**PASS ${tally('PASS')} · FAIL ${tally('FAIL')} · WARN ${tally('WARN')} · NOT RUN ${tally('NOT RUN')} · exit ${codeNow}**\n\n`
    + `Schema source: ${SCHEMA_IS_LIVE ? 'LIVE' : 'SNAPSHOT'} (${SCHEMA_TAKEN})\n\n`
    + `Live lane: ${live.cat ? `RAN — catalogue from ${live.how}` : `NOT RUN — ${live.why || 'no live database connection'}`}\n\n`
    + `A NOT RUN is not a PASS. Exit 2 means nothing failed and something launch-critical could not be checked.\n\n${body}\n`);
  console.log(`\nreport written to ${md}`);
}

const code = blocking.length ? 1 : (unrun.length ? 2 : 0);
console.log(`\nexit ${code}  —  ${code === 0 ? 'every launch-critical check ran and passed'
  : code === 1 ? `${blocking.length} launch-critical check(s) FAILED`
  : `nothing failed, but ${unrun.length} launch-critical check(s) could not run; a check that could not run is not a check that passed`}`);
process.exit(code);
