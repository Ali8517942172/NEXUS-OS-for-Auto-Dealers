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
 */

import { execFileSync, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
   live lane stays NOT RUN, which is the honest answer. */
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

/* Checks that need a signed-in browser against a real database, and that no
   amount of stubbing can stand in for. Stated rather than silently absent. */
for (const [id, t, why] of [
  ['B1', 'A decide() call by a non-approver is refused by Postgres, not just greyed out in the UI',
   'needs a signed-in NON-APPROVER, and this database has none to sign in as: tenant_members holds exactly one row and its role is "owner", which inventory_action_policy.approver_tenant_roles admits. Creating a non-approving member is a write to production. Measured 2026-09-03 through the read-only SQL channel: action_decide() invoked against a real inventory_actions row as a signed-in identity with no membership returned ok=false, refusal_code=NO_TENANT, and wrote 0 audit_log and 0 inventory_action_events rows — so the refusal is demonstrably Postgres-side on that arm. The arm this check names, NOT_AN_APPROVER, writes an audit row and an event row before it returns and therefore cannot be exercised read-only either.'],
  ['B2', 'Submitting the same decision twice produces one state change (idempotent=true on the second)',
   'needs a real session and a writable action; the gate is read-only against production and will not create one'],
  ['B3', 'A member of dealership A cannot see or act on dealership B\'s actions',
   'needs two dealerships and this database has one: public.tenants holds a single row, so there is no dealership B whose rows could be withheld. Standing one up is a write to production. Proven adversarially against two synthetic tenants on 2026-09-02 per CLAUDE.md; that evidence is not re-derived here and is not carried forward as a pass.'],
  ['B4', 'The rendered figures match the live rows for a real dealership',
   'the render lane serves a stub on purpose, so the result is deterministic; matching live data is a separate, credentialed run'],
]) NOTRUN(id, LANE.LIVE, 'P0', t, why);

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
