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
 *   node QUALITY_GATE.mjs --no-db               the CI lane. See below.
 *
 * THE --no-db LANE (added 7 Sep 2026, for GitHub Actions)
 *   Continuous integration has no NEXUS_DB_URL, no service-role key and no
 *   n8n API key, and it never should have one: a pull request from a fork
 *   would then run arbitrary code holding this dealership's database.
 *   So CI can only ever run the OFFLINE lanes, and the question is how a run
 *   that ran half of this file is allowed to report itself.
 *
 *   Without a flag it exits 2 — nothing failed, seventeen launch-critical
 *   checks could not run — and a job that is red on every commit is a job
 *   people turn off. The wrong fix is a CI wrapper that maps 2 to 0, because
 *   then the seventeen vanish and the run reads as a full green. That is the
 *   exact failure this file's header spends a page arguing against.
 *
 *   --no-db is the honest version of that mapping, and it buys the amnesty by
 *   paying for it out loud:
 *
 *     · it REFUSES to run if any database input is present (NEXUS_DB_URL,
 *       NEXUS_STAGING_DB_URL, NEXUS_BASELINE_REPLAY_URL, NEXUS_LIVE_URL,
 *       NEXUS_STAGING_REST_URL, SUPABASE_SERVICE_ROLE_KEY, NEXUS_ENV or
 *       --catalogue). The flag is an ASSERTION about the environment, not a
 *       request to ignore one, so it cannot be used to mute a live lane that
 *       could have run and might have gone red.
 *     · it PRINTS every skipped check by id, severity, lane, title and
 *       reason, under a heading that says they are not passes. The list is
 *       derived from the results themselves, so a check added to the live
 *       lane tomorrow appears in it without anyone editing a list.
 *     · it forgives ONLY the LIVE lane. A NOT RUN in an OFFLINE lane still
 *       exits 2 — that is what happens when the headless browser is missing
 *       in CI, and a run with no browser has silently retired R1..R7. A gate
 *       that appears green because half of it did not execute is worse than
 *       no gate.
 *     · its exit-0 sentence never says 'every launch-critical check ran and
 *       passed'. It says how many did not run.
 *
 * THE B LANE — what needs more than a catalogue
 *   B1 and B2 have to CALL action_decide(), and two of its arms write an audit
 *   row and an event row before they return. They therefore run only against a
 *   database named by NEXUS_STAGING_DB_URL, and report NOT RUN — with what they
 *   measured — against production. B3 needs a second dealership to exist. B4
 *   needs a real signed-in session.
 *
 *   THE SIGNED-IN CALLER (added 6 Sep 2026). B1..B3 have a second transport,
 *   and for B3 it is the only one that can produce a PASS: the gate signs in
 *   through GoTrue's password grant and calls PostgREST with `apikey` and
 *   `Authorization: Bearer`, exactly as the dashboard does. The psql arms above
 *   reach Postgres with set_config('request.jwt.claims'), which is how
 *   PostgREST PRESENTS a JWT and is not a signed JWT that travelled through it
 *   — the gap two-tenant-proof-2026-09-06.md §8.4 records. B1 and B2 write, and
 *   over HTTP there is no ROLLBACK, so the write arms refuse to run unless the
 *   target is a different Supabase project from NEXUS_DB_URL and NEXUS_LIVE_URL
 *   AND the configured accounts MEASURE two distinct dealerships. Production is
 *   a single-dealership project with one user, who is an approver, so it cannot
 *   satisfy either condition.
 *
 *   NEXUS_STAGING_REST_URL              https://<ref>.supabase.co of a STAGING
 *   NEXUS_STAGING_ANON_KEY              project carrying this schema.
 *   NEXUS_STAGING_APPROVER_EMAIL / _PASSWORD      an approver at dealership A
 *   NEXUS_STAGING_APPROVER2_EMAIL / _PASSWORD     a second approver at A
 *   NEXUS_STAGING_NONAPPROVER_EMAIL / _PASSWORD   a member of A who may not
 *                                       approve — B1 has nobody to refuse
 *                                       without one
 *   NEXUS_STAGING_OTHER_EMAIL / _PASSWORD         a member of dealership B
 *
 *   What the write arms leave behind on staging is stated in their own evidence
 *   lines, with the DELETE statements that remove it. They re-use a PROPOSED
 *   GATE-PROBE-% action if one is there, so an interrupted run does not add a
 *   second fixture.
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
 *
 * THE ANCHOR — WHY THE SNAPSHOT CARRIES A MIGRATION VERSION
 *   `takenAt` says when the snapshot was read. It does not say what the database
 *   had applied when it was read, and only the second fact is checkable. A
 *   catalogue taken eighteen minutes before a migration is not stale by any
 *   clock and is still wrong about the schema; one 23.92 hours old passed the
 *   24-hour tolerance and described a database with half the functions it had.
 *   So the catalogue records the head of supabase_migrations.schema_migrations,
 *   --refresh-schema copies it into the snapshot, L1 reports NOT RUN rather than
 *   PASS when the two anchors disagree, and L13 reports NOT RUN when this
 *   repository holds a migration the catalogue's database had not applied.
 *   Freshness in versions, not in hours. The hour tolerance stays as a fuse.
 *
 * THE BASELINE LANE — L12
 *   L12 compares supabase/baseline/ with the database rather than checking that
 *   a file is present. Its offline arm always runs; its seed and schema arms
 *   need NEXUS_DB_URL. Its strongest arm needs somewhere to replay INTO:
 *
 *   NEXUS_BASELINE_REPLAY_URL=postgres://…  an EMPTY PostgreSQL 17. The harness,
 *                                       the baseline, the history stamp and the
 *                                       seed are replayed into it and the
 *                                       generator is run against the result.
 *                                       It CREATES objects, so it refuses to
 *                                       run against NEXUS_DB_URL — by string
 *                                       and by database fingerprint — and
 *                                       refuses a target that is not empty.
 *
 *   NEXUS_SNAPSHOT_SOURCE_NOTE          a sentence recorded verbatim in the
 *                                       snapshot's "source" field by
 *                                       --refresh-schema. Say which project was
 *                                       read and through what.
 */

import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ARGV = process.argv.slice(2);
const flag = n => ARGV.includes(n);
const opt  = n => { const i = ARGV.indexOf(n); return i >= 0 ? ARGV[i + 1] : null; };

/* --no-db is an ASSERTION about the environment, checked here rather than at the
   end so a contradicted run costs a second instead of three minutes. See the
   header. The flag must never become a way to mute a live lane that could have
   run and might have gone red, so a database input present alongside it is a
   refusal, not a preference this file resolves on the caller's behalf. */
if (ARGV.includes('--no-db')) {
  const given = ['NEXUS_DB_URL', 'NEXUS_STAGING_DB_URL', 'NEXUS_BASELINE_REPLAY_URL', 'NEXUS_LIVE_URL',
                 'NEXUS_STAGING_REST_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL', 'NEXUS_ENV']
    .filter(k => String(process.env[k] || '').trim());
  if (opt('--catalogue')) given.push('--catalogue');
  if (given.length) {
    console.error(`--no-db asserts that this run has no database and no credential, and ${given.join(', ')} ${given.length === 1 ? 'is' : 'are'} present.`);
    console.error('One of the two is wrong. --no-db is an assertion about the environment, not a request to ignore one:');
    console.error('it will not be used to mute a live lane that could have run and might have gone red. Drop the flag or drop the input.');
    process.exit(3);
  }
}

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
  "takenAt": "2026-09-21T05:55:35Z",
  "source": "catalogue read 21 Sep 2026 after nx1009, dsvuoovivysszdoiorch (information_schema + pg_proc, public + nexus_intake) -- MANUALLY EDITED to match supabase/migrations/20260921180000_nx1010_the_dealer_sees_a_button_not_a_bank_account.sql ahead of that migration being applied; rpcs MANUALLY EDITED 21 Sep 2026 to add the twelve lead-source / API-key / webhook functions of feat/connect-everything (nexus_lead_source_connections, _connect, _rotate_secret, _disconnect, nexus_api_keys_list, nexus_api_key_create, _revoke, nexus_webhooks_list, nexus_webhook_create, _delete, _send_test, nexus_webhook_deliveries), each read from pg_proc on dsvuoovivysszdoiorch by SELECT (prosecdef true, no tenant argument, EXECUTE held by authenticated and service_role only, anon none; the three list functions and nexus_webhook_deliveries STABLE, the rest VOLATILE); re-run --refresh-schema so this snapshot is catalogue-derived again, not hand-typed.",
  "relations": {
    "appointment": "appointment_id,tenant_id,customer_id,lead_id,inventory_id,assigned_to_id,state,channel,starts_at,duration_minutes,ends_at,location,resource,offered_slots,confirmed_slot_was_offered,requested_at,offered_at,confirmed_at,closed_at,outcome_reason,booked_by,notes,created_at,updated_at",
    "appointment_event": "event_id,appointment_id,tenant_id,event_type,from_state,to_state,occurred_at,actor,slots,starts_at,reason",
    "appointment_state": "state,meaning,counts_as_booked,counts_as_attended,is_terminal,sort_order",
    "appointment_transition": "from_state,to_state,verb",
    "attribution_edge_type": "edge,seq,from_node,to_node,state,basis,source_ref,finding,unlocked_by,unlock_rank",
    "attribution_event_type": "event,seq,state,source_ref,finding",
    "attribution_link_basis": "basis,rank,is_evidence,default_confidence,label,description",
    "audit_log": "id,workflow,status,lead_name,lead_email,lead_score,intent,summary,logged_at,tenant_id",
    "channel_message_events": "event_id,tenant_id,integration_id,provider,channel_type,direction,external_message_id,customer_external_id,customer_phone,conversation_id,message_kind,media_ref,media_mime,media_sha256,provider_account_id,provider_delivery_ref,origin_verified,received_at,recorded_at,message_text,customer_display_name",
    "channel_provider_capability": "provider,send_form,support_state,basis,evidence,verified_at,set_by,created_at",
    "channel_provider_rank": "provider,rank,is_official_platform,rationale,set_by,created_at",
    "channel_registry": "integration_id,tenant_id,channel_type,external_identifier,credential_ref,status,created_at,updated_at,display_number,waba_id",
    "channel_secret": "integration_id,kind,vault_secret_id,fingerprint,installed_at,rotated_at,installed_by",
    "channel_secret_kind": "kind,description",
    "channel_send_directive": "directive_id,tenant_id,requested_by,request_ref,customer_external_id,intent,requested_send_form,directive,outcome,reason_code,reason,what_would_change_it,integration_id,provider,channel_type,external_identifier,credential_ref,carrier_rule,candidates_considered,resolved_send_form,message_body,template_ref,template_variables,template_category_required,template_verification,media_ref,media_mime,policy_decision,policy_reason_code,policy_applied_rule_id,policy_rule_verification_status,policy_window_state,policy_evaluated_at,capability_state,capability_basis,whatsapp_capability_state,routed_at,routed_by,send_result,provider_message_id,provider_error_code,provider_error_detail,result_recorded_at,tenant_slug,policy_reason,policy_what_would_change_it,policy_window_expires_at,capability_evidence,whatsapp_capability_note,template_verification_detail",
    "channel_send_form": "code,label,description,requires_template_ref,is_media,is_business_safe_outside_window,sort,created_at",
    "communication_log_evidence_event": "id,comm_log_id,tenant_id,event,to_state,reason_code,reason,actor,actor_auth_user_id,at,incident_ref,evidence_ref,evidence_rank",
    "communication_logs": "id,lead_email,channel,direction,message,created_at,sent_by,tenant_id,external_message_id,channel_key,direction_key,evidence_state",
    "competitors": "id,competitor,model,price_aed,our_price_aed,price_diff_aed,ai_recommendation,scraped_at,listing_title,source_host,source_kind,offer_name,offer_condition,match_quality,match_note,tenant_id",
    "conversation": "id,tenant_id,customer_id,integration_id,channel,state,opened_at,last_message_at,message_count",
    "customer": "id,tenant_id,display_name,phone_digits,email,first_seen_at,last_seen_at",
    "customer_360_profiles": "id,customer_id,name,email,phone,total_emails,total_slack_messages,last_synced_at,tenant_id",
    "daily_metrics": "snapshot_date,open_leads,hot_leads,warm_leads,cold_leads,avg_response_minutes,pipeline_aed,units_at_risk,holding_cost_aed,workflow_runs,workflow_failures,captured_at,workflow_failures_rule,workflow_failures_canonical,pipeline_aed_rule,open_leads_rule,tenant_id",
    "deal_rescue_evidence_sources": "source,sort,admitted,evidence_tier,claim,verdict_basis",
    "deal_rescue_prerequisites": "id,sort,requirement,kind,unlocks,unlocks_states,platform_evidence,why_not_code",
    "deal_rescue_settings": "tenant_id,at_risk_days,stalled_days,set_by,set_at,note",
    "deal_rescue_states": "state,sort,meaning,engine_can_produce,blocked_by,requires",
    "deals_embeddings": "id,deal_id,content,embedding,created_at,tenant_id",
    "finance_quotes": "id,lead_email,lead_name,quoted_by,vehicle_value_aed,loan_payoff_aed,credit_score,equity_aed,equity_status,loan_to_value_pct,finance_tier,indicative_apr_pct,disclaimer,source,created_at,vehicle_price_aed,max_ltv_pct,min_down_payment_aed,down_payment_aed,down_payment_pct,down_payment_assumed,trade_in_equity_applied_aed,financed_aed,tenure_months,monthly_payment_low_aed,monthly_payment_high_aed,total_cost_of_credit_low_aed,total_cost_of_credit_high_aed,indicative_apr_high_pct,calculation_id,execution_id,calculated_at,apr_source,ltv_policy_source,tenant_id",
    "inventory": "id,model,vin,status,days_in_stock,price_aed,cost_aed,gross_margin,holding_cost_accrued,net_margin,recommended_commission,vat_amount,aging_alert,ai_recommendation,acquired_at,tenant_id,gross_margin_state",
    "inventory_action_events": "id,tenant_id,action_id,at,event,actor_staff_id,actor_auth_id,actor_authority,detail,audit_log_id",
    "inventory_action_policy": "tenant_id,approver_tenant_roles,approver_staff_roles,reproposal_cooldown_days,set_by,set_at,note",
    "inventory_action_reason_codes": "code,applies_to,label,meaning,engine_was_wrong,sort",
    "inventory_actions": "id,tenant_id,unit_id,recommendation,engine_reason,engine_confidence,engine_confidence_basis,engine_impact_aed,engine_impact_kind,engine_impact_basis,engine_overall_risk,engine_days_in_stock,engine_gross_margin_aed,engine_owner_role,engine_evidence,engine_computed_at,status,proposed_at,proposed_by_staff_id,proposed_source,decided_at,decided_by_staff_id,decided_by_auth_id,decided_by_authority,decision_reason_code,decision_note,defer_until,assigned_to_staff_id,assigned_role,assigned_at,executed_at,executed_by_staff_id,execution_note,execution_failure,outcome_state,outcome_purchase_id,outcome_recorded_at,outcome_recorded_by_staff_id,attribution_basis,attribution_note,recovered_value_aed,recovered_value_basis,escalated_at,escalation_reason,created_at,updated_at",
    "inventory_profit_settings": "tenant_id,holding_cost_per_day_aed,holding_cost_source,holding_cost_verified_at,aging_warn_days,aging_critical_days,promote_days,wholesale_days,min_reprice_margin_pct,market_tolerance_pct,enquiry_window_days,min_enquiry_sources,updated_at,holding_cost_basis,holding_cost_set_by,min_model_token_overlap,accepted_market_match_quality,market_max_age_days",
    "journey_step": "id,correlation_id,tenant_id,step,status,ref_table,ref_id,detail,at",
    "kyc_documents": "id,lead_email,lead_name,chat_id,document_type,full_name,date_of_birth,expiry_date,is_valid,tampering,confidence_score,remarks,attempt_number,max_attempts,verdict,reviewed_by,reviewed_at,created_at,storage_path,retain_until,purged_at,void_reason,voided_at,tenant_id",
    "lead_event": "event_id,tenant_id,endpoint_id,source_key,environment,origin_verified,provenance_counts_as_real,external_event_id,occurred_at,received_at,phase,disposition_reason,payload_raw,hydrated_payload,hydrated_at,hydration_error,normalized,lead_id,promoted_at",
    "lead_ingest_endpoint": "endpoint_id,tenant_id,source_key,required_provenance_for_source,declared_provenance,provenance_counts_as_real,environment,public_key,secret_ref,origin_allowlist,ingest_address,status,rate_limit_per_minute,label,created_at,updated_at",
    "lead_ingest_provider_identity": "identity_id,endpoint_id,source_key,provider,identity_kind,identity_value,label,status,created_at,updated_at,tenant_id",
    "lead_ingest_secret": "endpoint_id,kind,vault_secret_id,fingerprint,installed_at,rotated_at,installed_by",
    "lead_ingest_secret_kind": "kind,description",
    "lead_owner_events": "id,tenant_id,lead_id,at,event,actor_auth_id,actor_staff_id,actor_authority,from_staff_id,to_staff_id,from_name,to_name,reason,audit_log_id",
    "lead_provenance_kind": "kind,is_cryptographic,strength_rank,counts_as_real,description,is_externally_attested",
    "lead_recovery_action_events": "id,tenant_id,action_id,at,event,actor_staff_id,actor_auth_id,actor_authority,detail,audit_log_id",
    "lead_recovery_actions": "id,tenant_id,lead_id,recommendation,engine_state,engine_reason,engine_confidence,engine_confidence_basis,engine_risk_level,engine_risk_basis,engine_evidence,engine_owner_role,engine_computed_at,opportunity_value_state,opportunity_value_basis,status,proposed_at,proposed_by_staff_id,proposed_source,decided_at,decided_by_staff_id,decided_by_auth_id,decided_by_authority,decision_reason_code,decision_note,defer_until,assigned_to_staff_id,assigned_role,assigned_at,executed_at,executed_by_staff_id,execution_note,execution_failure,outcome_state,outcome_purchase_id,outcome_recorded_at,outcome_recorded_by_staff_id,attribution_basis,attribution_note,recovered_value_aed,recovered_value_basis,escalated_at,escalation_reason,created_at,updated_at",
    "lead_recovery_reason_codes": "code,applies_to,label,meaning,engine_was_wrong,sort",
    "lead_recovery_settings": "tenant_id,sla_first_response_minutes,silence_hours,stale_silence_hours,engagement_window_days,detector_max_age_hours,set_by,set_at,note,reproposal_cooldown_days",
    "lead_recovery_states": "state,sort,meaning,engine_can_produce,blocked_by,requires",
    "lead_source_catalogue": "source_key,display_name,channel_family,integration_status,delivery_shape,required_provenance,dedup_field,evidence_note,manual_entry_surface",
    "leads": "id,name,email,phone,source,vehicle_interest,budget_aed,status,ai_score,assigned_to,response_time_minutes,created_at,assigned_to_id,escalated_at,bitrix_lead_id,crm_synced_at,tenant_id,score_source,rules_score,ai_score_raw,ai_intent_raw,ai_parse_failed,scoring_state,scoring_attempts,scoring_last_error,scored_at",
    "message_intent": "intent,promote_eligible,meaning",
    "nexus_notification_outbox": "notification_id,sales_lead_id,channel,state,reason,attempt_count,max_attempts,next_attempt_at,claimed_at,claimed_by,last_error_code,last_error_detail,sent_at,acknowledged_at,acknowledged_by,created_at,updated_at",
    "nexus_sales_lead": "id,submission_id,full_name,phone_e164,email,dealership,stock_size,message,attribution,ip_country,received_at,status,contacted_at,notes",
    "notification_attempt": "attempt_id,notification_id,attempt_no,event,from_state,to_state,worker,error_code,error_detail,occurred_at",
    "notification_state": "state,meaning,is_live,is_terminal,needs_attention,sort_order",
    "notification_transition": "from_state,to_state,verb",
    "platform_admin": "auth_user_id,granted_at,note",
    "platform_payment_details": "id,account_holder,bank_name,iban,swift_bic,currency,reference_format,notes,updated_at,updated_by,payment_link_url,display_name",
    "policy_jurisdiction": "code,owner_kind,owner_name,what_it_covers,added_at",
    "policy_platform_attestation": "attestation_id,rule_id,attested_by,attested_by_contact,attested_at,source_kind,source_name,source_ref,source_observed_on,account_ref,confidence,notes",
    "policy_rule": "id,tenant_id,jurisdiction,rule_type,rule_name,value_numeric,value_text,unit,value_kind,source_url,source_name,source_document,effective_from,effective_to,verification_date,verified_by,verified_by_auth_user_id,confidence,status,verification_status,notes,version,supersedes_id,added_by,added_by_auth_user_id,added_at,updated_at,jurisdiction_owner_kind,platform_attestation_id",
    "policy_rule_event": "id,rule_id,tenant_id,event,actor,actor_auth_user_id,at,from_status,to_status,from_verification,to_verification,detail",
    "policy_rule_type": "code,label,description,created_at",
    "policy_unit": "code,label,value_kind,description,created_at",
    "policy_unmigrated_constant": "id,layer,location,snippet,current_value,kind,proposed_rule_type,proposed_rule_name,reaches_a_customer,seeded_as_rule,note,surveyed_on,created_at",
    "processed_messages": "message_id,source,chat_id,processed_at,tenant_id",
    "purchase_history": "id,customer_name,email,phone,vehicle,purchase_date,amount_aed,created_at,deal_id,lead_id,tenant_id",
    "rag_documents": "id,doc_title,section,content,source_file,page_number,search_vector,tenant_id",
    "subscription_event": "event_id,tenant_id,event_type,from_state,to_state,price_aed,occurred_at,actor,reason",
    "subscription_state": "state,meaning,entitled,sort_order",
    "tenant_capability": "tenant_id,capability_key,state,evidence,source,set_by,verified_at,created_at,updated_at",
    "tenant_capability_catalogue": "capability_key,label,what_it_unlocks,requires,absent_means,sort,created_at",
    "tenant_configuration": "tenant_id,brand_name,default_language,timezone,currency,business_hours,business_hours_source,business_hours_set_by,business_hours_verified_at,business_hours_basis,ai_tone,ai_tone_source,ai_tone_set_by,ai_tone_verified_at,ai_tone_basis,followup_policy,followup_policy_source,followup_policy_set_by,followup_policy_verified_at,followup_policy_basis,approval_rules,approval_rules_source,approval_rules_set_by,approval_rules_verified_at,approval_rules_basis,created_at,updated_at",
    "tenant_configuration_default": "setting_key,applies_to,value_kind,default_state,default_value,who_decides,provenance_required,rationale,engine_rule_when_absent,created_at",
    "tenant_member_invite": "id,tenant_id,email,role,staff_user_id,created_by,created_at,revoked_at,revoked_by,claimed_at,claimed_auth_user_id",
    "tenant_members": "tenant_id,auth_user_id,role,staff_user_id,created_at",
    "tenant_subscription": "tenant_id,state,price_aed,currency,trial_started_at,trial_ends_at,started_at,cancelled_at,cancel_reason,notes,created_at,updated_at,current_period_end,last_payment_reference",
    "tenants": "id,slug,name,status,is_unattributed_default,created_at,is_quarantine,owner_phone",
    "users": "id,name,email,role,status,slack_user_id,created_at,tenant_id",
    "v_action_center_health": "tenant_id,actions_total,awaiting_decision,escalated_no_approver,approved_not_executed,executed,execution_failed,rejected,deferred,cancelled,outcomes_attributed,outcomes_not_attributable,executed_awaiting_outcome,undecided_exposure_aed,undecided_with_no_figure,last_proposed_at,last_decided_at,last_executed_at,last_activity_at,newest_undecided_days,oldest_undecided_days,events_total,events_without_audit,audit_rows,audit_rows_30d,last_audit_at,health",
    "v_attribution_edges": "tenant_id,edge,from_kind,from_ref,to_kind,to_ref,basis,confidence,note",
    "v_attribution_events": "tenant_id,event_seq,event_type,event_id,occurred_at,actor,subject_kind,subject_ref,lead_id,lead_basis,lead_confidence,lead_note,unit_id,unit_basis,unit_note,amount_aed,amount_kind,detail",
    "v_attribution_lead_chain": "tenant_id,lead_id,lead_name,created_at,status,ai_score,lead_source_field,campaign_state,campaign_basis,campaign_note,conversation_messages,messages_in,messages_out,first_message_at,last_message_at,conversation_state,conversation_basis,conversation_confidence,conversation_note,vehicle_interest_text,vehicle_text_candidates,vehicle_state,vehicle_basis,vehicle_note,finance_quotes,finance_state,finance_basis,finance_note,sales_recorded,revenue_confirmed_aed,revenue_kind,last_sale_date,sale_state,sale_basis,sale_note,gross_margin_aed,margin_state,margin_note,hops_total,hops_evidenced,first_break,chain",
    "v_attribution_link_map": "tenant_id,tenant_name,seq,edge,from_node,to_node,state,basis,basis_is_evidence,basis_confidence,source_ref,finding,unlocked_by,unlock_rank,instances_total,instances_evidenced,instances_refused,coverage_pct,coverage_note",
    "v_attribution_sale_chain": "tenant_id,sale_id,purchase_date,recorded_at,customer_name,vehicle_text,deal_id,revenue_aed,revenue_kind,gross_margin_aed,campaign_state,campaign_basis,campaign_note,lead_id,lead_name,lead_state,lead_basis,lead_confidence,lead_note,conversation_messages,conversation_state,conversation_basis,conversation_confidence,conversation_note,vehicle_unit_id,vehicle_text_candidates,vehicle_state,vehicle_basis,vehicle_confidence,vehicle_note,deal_record_state,deal_record_basis,deal_record_confidence,deal_record_note,finance_quotes_for_lead,finance_state,finance_basis,finance_note,revenue_state,revenue_basis,revenue_note,margin_state,margin_note,hops_total,hops_evidenced,first_break,chain",
    "v_audit_unregistered_writers": "tenant_id,workflow_written_in_audit_log,audit_rows,audit_rows_30d,first_written_at,last_written_at,statuses_seen,disposition",
    "v_channel_provider_capability": "provider,provider_rank,is_official_platform,send_form,send_form_label,requires_template_ref,is_media,support_state,basis,verified_at,supported_but_never_exercised_here,evidence,set_by",
    "v_channel_send_health": "tenant_id,integration_id,provider,external_identifier,routed_7d,sends_7d,accepted_7d,rejected_7d,transport_errors_7d,pending_now,last_accepted_at,last_failed_at,observed_state",
    "v_communication_log_evidence": "id,lead_email,channel,direction,message,created_at,sent_by,tenant_id,evidence_state,evidence_flagged,evidence_reason_code,evidence_reason,evidence_actor,evidence_at,evidence_incident_ref,evidence_ref",
    "v_competitor_latest": "id,competitor,model,price_aed,our_price_aed,price_diff_aed,ai_recommendation,scraped_at,listing_title,source_host,source_kind,offer_name,offer_condition,match_quality,match_note",
    "v_conversations": "thread_key,chat_id,phone,push_name,lead_email,lead_name,lead_status,display_name,identified,message_count,inbound_count,outbound_count,last_message_at,last_message,last_direction,awaiting_reply,msg_count,internal_count,msg_inbound_count,msg_outbound_count,last_msg_at,last_msg,last_msg_direction,awaiting_msg_reply,tenant_id",
    "v_customer_360": "email,name,phone,lead_count,best_ai_score,latest_status,purchase_count,lifetime_value_aed,last_purchase_date,is_vip,message_count,last_contact_at,total_emails,total_slack_messages,tenant_id",
    "v_customer_directory": "id,name,email,phone,source_records,last_seen_at,tenant_id",
    "v_deal_rescue": "tenant_id,deal_evidence,deal_evidence_ref,deal_evidence_source,customer_label,lead_id,identity_state,identity_basis,evidence_tier,admission_basis,deal_evidence_at,last_message_at,last_movement_at,days_since_movement,at_risk_days,stalled_days,settings_are_defaults,state,state_basis,recommended_action,action_reason,owner_staff_id,owner_name,owner_job_title,owner_state,owner_note,deal_value_aed,deal_value_state,deal_value_basis,margin_at_stake_state,margin_at_stake_basis,confidence,confidence_basis,lead_recovery_state,silence_state,silence_detector_state,silence_detector_last_success_at,silence_detector_note,human_approval_required,automation_state,automation_note,action_lane_state,action_lane_note,evidence,computed_at",
    "v_deal_rescue_candidates": "tenant_id,candidate_kind,candidate_ref,customer_label,source_table,observed_at,lead_id,identity_state,identity_basis,verdict,evidence_tier,verdict_basis,deal_value_aed,deal_value_state,deal_value_basis",
    "v_deal_rescue_readiness": "id,sort,requirement,kind,unlocks,unlocks_states,platform_evidence,why_not_code,met_now,measured_now,evidence_today,measured_at",
    "v_deal_rescue_state_model": "state,sort,meaning,engine_can_produce,blocked_by,requires,deals_in_state_now,observation",
    "v_fin_gate_quote_evidence": "id,lead_email,lead_name,quoted_by,created_at,calculated_at,calculation_id,execution_id,indicative_apr_pct,indicative_apr_high_pct,monthly_payment_low_aed,monthly_payment_high_aed,is_evidenced,evidence_note,has_instalment",
    "v_inventory_action_queue": "id,tenant_id,unit_id,unit_model,unit_vin,unit_status,unit_price_aed,unit_cost_aed,status,is_live,awaiting_decision,deferral_now_due,recommendation,engine_reason,engine_confidence,engine_confidence_basis,engine_impact_aed,engine_impact_kind,engine_impact_basis,engine_overall_risk,engine_days_in_stock,engine_gross_margin_aed,engine_owner_role,engine_evidence,engine_computed_at,engine_now_recommendation,engine_now_risk,engine_now_days_in_stock,engine_now_impact_aed,engine_now_reason,engine_still_agrees,proposed_at,proposed_by_name,proposed_source,decided_at,decided_by_name,decided_by_job_title,decided_by_authority,decision_reason_code,decision_reason_label,decision_reason_meaning,decision_says_engine_was_wrong,decision_note,defer_until,assigned_to_staff_id,assigned_to_name,assigned_role,assigned_at,executed_at,executed_by_name,execution_note,execution_failure,escalated_at,escalation_reason,outcome_state,outcome_purchase_id,outcome_sale_vehicle,outcome_sale_amount_aed,outcome_sale_date,outcome_recorded_at,outcome_recorded_by_name,attribution_basis,attribution_note,recovered_value_aed,recovered_value_basis,outcome_sentence,cost_of_doing_nothing,days_open,created_at,updated_at",
    "v_inventory_action_timeline": "id,tenant_id,action_id,at,event,actor_name,actor_job_title,actor_authority,detail,audit_log_id,audit_status,audit_outcome_class,audit_summary",
    "v_inventory_profit_sentinel": "tenant_id,id,model,vin,status,acquired_at,days_in_stock,aging_band,days_to_warning,days_to_critical,cost_aed,price_aed,gross_margin_aed,gross_margin_pct,capital_tied_aed,holding_cost_per_day_aed,holding_cost_basis,holding_cost_source,holding_cost_set_by,holding_cost_verified_at,holding_cost_accrued_aed,holding_cost_state,holding_cost_note,net_margin_aed,net_margin_state,net_margin_note,market_position,market_competitor,market_price_aed,market_match_quality,market_scraped_at,market_note,demand_signal,enquiries_in_window,enquiry_leads,enquiry_messages,enquiry_last_at,enquiry_source_rows,enquiry_resolved_rows,enquiry_window_days,enquiry_coverage,enquiry_note,age_risk,age_risk_rank,margin_risk,margin_risk_rank,overall_risk,overall_risk_rank,risk_basis,recommendation,reason,confidence,confidence_basis,impact_aed,impact_kind,impact_basis,suggested_owner_role,suggested_owner_state,suggested_owner_note,human_approval_required,automation_state,evidence,warn_days,crit_days,promote_days,wholesale_days,min_margin_pct,tol_pct,min_enq_sources,min_model_token_overlap,market_max_age_days,settings_are_defaults,computed_at",
    "v_inventory_sales": "id,model,status,price_aed,days_in_stock,tenant_id",
    "v_lead_messages": "lead_id,id,created_at,channel,direction,message,lead_email,is_message,tenant_id",
    "v_lead_origin": "event_id,tenant_id,source_key,source,channel_family,integration_status,phase,disposition_reason,received_at,occurred_at,lead_id,origin_cryptographically_verified,origin_externally_attested,origin_strength,origin_explanation,is_test_traffic",
    "v_lead_recovery": "tenant_id,lead_id,lead_name,lead_status,lead_is_open,lead_created_at,vehicle_interest_text,vehicle_state,vehicle_note,state,state_basis,response_time_minutes,response_time_state,sla_first_response_minutes,sla_state,response_time_note,last_contact_at,last_contact_state,last_customer_message_at,last_dealership_message_at,messages_resolved,messages_in,messages_out,first_message_at,hours_since_our_last_message,minutes_since_their_last_message,silence_state,silence_threshold_hours,stale_silence_threshold_hours,silence_markers_on_file,last_silence_marker_at,silence_detector_state,silence_detector_last_run_at,silence_detector_last_success_at,silence_detector_last_run_class,silence_detector_note,risk_level,risk_basis,recommended_action,action_reason,owner_staff_id,owner_name,owner_job_title,owner_state,owner_note,action_id,action_status,action_recommendation,action_state,opportunity_value_aed,opportunity_value_state,opportunity_value_basis,confirmed_outcome_state,confirmed_revenue_aed,confirmed_outcome_date,confirmed_outcome_basis,recovery_attribution_state,recovered_value_aed,recovery_attribution_basis,confidence,confidence_basis,human_approval_required,automation_state,automation_note,evidence,settings_are_defaults,computed_at",
    "v_lead_recovery_coverage": "tenant_id,leads_total,leads_open,leads_closed,leads_at_risk,leads_risk_unknown,leads_with_a_recommended_action,leads_with_a_confirmed_sale,confirmed_revenue_aed,sales_attributed_to_a_recovery_action,leads_with_no_owner,leads_with_no_measured_response_time,leads_with_no_resolved_conversation,communication_log_rows,message_events,silence_markers,message_events_resolved_to_a_lead,identity_resolution_pct,unresolved_whatsapp_handles,silence_detector_state,silence_detector_last_run_at,silence_detector_last_success_at,silence_detector_last_run_class,recovery_actions_total,recovery_actions_awaiting_decision,recovery_actions_executed,recovery_outcomes_attributed,actions_whose_lead_is_another_tenants,settings_are_defaults,sla_first_response_minutes,sla_agrees_with_needs_attention,what_this_engine_cannot_tell_you,computed_at",
    "v_lead_recovery_health": "tenant_id,actions_total,awaiting_decision,escalated_no_approver,approved_not_executed,executed,execution_failed,rejected,deferred,cancelled,outcomes_attributed,outcomes_not_attributable,executed_awaiting_outcome,attributed_revenue_aed,last_proposed_at,last_decided_at,last_executed_at,events_total,events_without_audit,audit_rows,audit_rows_30d,last_audit_at,health",
    "v_lead_recovery_queue": "id,tenant_id,lead_id,lead_name,lead_status,status,is_live,awaiting_decision,deferral_now_due,recommendation,engine_state,engine_reason,engine_confidence,engine_confidence_basis,engine_risk_level,engine_risk_basis,engine_owner_role,engine_evidence,engine_computed_at,engine_now_state,engine_now_risk_level,engine_now_recommendation,engine_now_reason,engine_still_agrees,opportunity_value_state,opportunity_value_basis,proposed_at,proposed_by_name,proposed_source,decided_at,decided_by_name,decided_by_job_title,decided_by_authority,decision_reason_code,decision_reason_label,decision_reason_meaning,decision_says_engine_was_wrong,decision_note,defer_until,assigned_to_staff_id,assigned_to_name,assigned_role,assigned_at,executed_at,executed_by_name,execution_note,execution_failure,escalated_at,escalation_reason,outcome_state,outcome_purchase_id,outcome_sale_vehicle,outcome_sale_amount_aed,outcome_sale_date,outcome_recorded_at,outcome_recorded_by_name,attribution_basis,attribution_note,recovered_value_aed,recovered_value_basis,outcome_sentence,days_open,created_at,updated_at",
    "v_lead_recovery_state_model": "state,sort,meaning,engine_can_produce,blocked_by,requires,leads_in_state_now,observation",
    "v_lead_timeline_admissible": "id,lead_email,channel,direction,message,created_at,sent_by,tenant_id,external_message_id,channel_key,direction_key,evidence_state,content_withheld",
    "v_needs_attention": "kind,severity,ref,title,detail,at,screen",
    "v_policy_authoritative": "id,tenant_id,is_global_rule,jurisdiction,rule_type,rule_name,version,value_numeric,value_text,unit,value_kind,value_display,effective_from,effective_to,source_name,source_url,source_document,verification_date,verified_by,confidence,citation",
    "v_policy_rule": "id,tenant_id,is_global_rule,jurisdiction,rule_type,rule_name,version,supersedes_id,value_numeric,value_text,unit,value_kind,value_display,status,verification_status,confidence,effective_from,effective_to,source_name,source_url,source_document,verification_date,verified_by,added_by,added_at,updated_at,notes,authority,authority_reason,may_be_relied_on",
    "v_policy_rule_history": "tenant_id,jurisdiction,rule_type,rule_name,version,id,supersedes_id,status,verification_status,value_numeric,value_text,unit,effective_from,effective_to,source_name,source_document,verification_date,verified_by,added_by,added_at,previous_value_numeric,previous_value_text,previous_effective_from,previous_effective_to,previous_source_name",
    "v_policy_unmigrated_constant": "layer,kind,location,snippet,current_value,reaches_a_customer,proposed_rule_type,proposed_rule_name,seeded_as_rule,rule_row_exists,rule_is_authoritative,migration_state,note,surveyed_on",
    "v_team_performance": "id,name,email,role,status,leads_assigned,hot_leads,avg_response_minutes,within_sla,breached_sla,pipeline_aed",
    "v_whatsapp_conversation_window": "tenant_id,integration_id,channel_type,channel_identifier,customer_wa_id,last_customer_message_at,last_customer_message_external_id,last_customer_message_source,window_rule_id,window_hours,window_rule_verification_status,window_rule_authority,window_expires_at,window_state,opt_in_state,opt_in_last_event_at,opt_in_evidence_ref",
    "v_whatsapp_message_usage": "usage_id,tenant_id,integration_id,event_id,sent_at,message_category,template_required,template_id,template_name,template_language,policy_decision,policy_reason_code,policy_rule_id,policy_rule_name,policy_rule_verification_status,policy_decided_at,template_provider_status_at_send,template_status_age_at_send,template_staleness_verdict_at_send,template_provider_status_now,template_status_changed_since_send,latest_status,latest_status_at,billing_fact_state,provider_billable,provider_pricing_model,provider_pricing_category,provider_pricing_type,provider_conversation_id,provider_conversation_origin_type,provider_conversation_expiration_at,provider_pricing_observed_at,cost_state,cost_answer,recorded_at,updated_at",
    "v_whatsapp_messaging_usage_monthly": "tenant_id,month,message_category,messages,provider_billable_messages,provider_not_billable_messages,awaiting_provider_report,reported_without_pricing,provider_conversations_reported,template_messages,sent_under_a_verified_rule,sent_under_an_unverified_rule,sent_with_no_rule_applied,failed_messages,no_status_reported,cost_answer",
    "v_whatsapp_template_registry": "template_id,tenant_id,integration_id,name,language,category,nexus_state,provider_status,provider_status_raw,provider_status_source,provider_status_observed_at,status_age,status_confidence,previous_provider_status,previous_status_observed_at,provider_rejected_reason,body_variable_count,variable_schema,body_text,body_text_source,what_this_row_claims,created_at,updated_at",
    "v_workflow_health": "name,category,description,is_active,writes_audit_log,runs,failures,escalations,runs_30d,failures_30d,partials_30d,no_result_30d,rejected_30d,escalated_30d,successes_30d,unknown_30d,effective_runs_30d,success_rate_30d,success_rate,last_run,last_success,last_failure,last_partial,last_incomplete,health",
    "whatsapp_contacts": "chat_id,phone,push_name,lead_email,first_seen,last_seen,message_count,tenant_id",
    "whatsapp_conversation_state": "tenant_id,integration_id,customer_wa_id,last_customer_message_at,last_customer_message_external_id,last_customer_message_source,first_seen_at,created_at,updated_at",
    "whatsapp_customer_message_seen": "tenant_id,integration_id,customer_wa_id,external_message_id,first_occurred_at,first_source,first_recorded_at",
    "whatsapp_delivery_events": "delivery_event_id,tenant_id,integration_id,provider,provider_message_id,event_id,link_state,linked_at,status,status_raw,status_at,recipient_wa_id,conversation_id,conversation_origin_type,conversation_expiration_at,pricing_billable,pricing_model,pricing_category,pricing_type,pricing_reported,errors,provider_payload,received_at,recorded_at,status_key",
    "whatsapp_message_intent": "code,label,description,is_business_initiated,template_category_if_required,created_at",
    "whatsapp_message_usage": "usage_id,tenant_id,integration_id,event_id,message_category,template_required,template_id,policy_decision,policy_reason_code,policy_rule_id,policy_rule_name,policy_rule_verification_status,policy_decided_at,template_provider_status_at_send,template_status_age_at_send,template_staleness_verdict_at_send,sent_at,billing_fact_state,provider_billable,provider_pricing_model,provider_pricing_category,provider_pricing_type,provider_conversation_id,provider_conversation_origin_type,provider_conversation_expiration_at,provider_pricing_observed_at,provider_pricing_delivery_event_id,latest_status,latest_status_at,latest_status_delivery_event_id,cost_state,recorded_at,updated_at",
    "whatsapp_opt_in_event": "id,tenant_id,integration_id,customer_wa_id,event,occurred_at,mechanism,evidence_kind,evidence_ref,recorded_by,recorded_at,notes,consent_rank",
    "whatsapp_templates": "template_id,tenant_id,integration_id,provider,waba_ref,name,language,category,provider_template_id,nexus_state,nexus_state_at,nexus_state_by,provider_status,provider_status_raw,provider_status_observed_at,provider_status_source,provider_status_evidence_ref,provider_rejected_reason,previous_provider_status,previous_status_observed_at,variable_schema,body_variable_count,body_text,body_text_source,body_text_observed_at,created_at,updated_at,language_key,waba_key",
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
    "channel_registry_touch": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "channel_send_directive_guard_policy_citation": {
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
    "inventory_delete_unit": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "inventory_guard_cost_change": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "inventory_set_cost": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "lead_event_guard_lead_tenant": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "lead_ingest_endpoint_touch": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "lead_ingest_provider_identity_touch": {
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
    "nexus_active_dealership_ids": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_api_key_create": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_api_key_revoke": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_api_keys_list": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_appointment_cancel": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_appointment_confirm": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_appointment_event_is_append_only": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_appointment_mark_attended": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_appointment_offer_slots": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_appointment_request": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_appointment_stamp_ends_at": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_appointment_status": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_caller_tenant_scope": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_channel_capability_state": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_channel_mark_active": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_channel_register_cloud_number": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_channel_registry_for_owner": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_channel_secret_put": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_channel_secret_reveal": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_channel_send_candidates": {
      "secdef": false,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_channel_status": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_channel_verify_token_matches": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_claim_pending_membership": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_classify_message_intent": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
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
    "nexus_comm_log_evidence_state": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
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
    "nexus_customer_360_directory_for_tenant": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
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
    "nexus_definer_scoping_audit": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_destructive_guard_coverage": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_erp_bitrix24_hot_leads_backlog": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_founder_list_tenants": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_founder_mark_paid": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_founder_onboard_dealer": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_founder_quarantine_census": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_founder_set_payment_link": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_founder_set_tenant_status": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_fuse_dependent_objects": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_guard_born_open_grants": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_guard_same_tenant_ref": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_hydrate_lead_event": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_is_approval_rules": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_is_business_hours": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_is_followup_policy": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
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
    "nexus_is_platform_admin": {
      "secdef": true,
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
    "nexus_journey_from_channel_message": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_journey_on_lead_event_promoted": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_journey_on_message_recorded": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_journey_step_guard_ref_tenant": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_journey_trace": {
      "secdef": true,
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
    "nexus_kyc_documents_due": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_kyc_mark_purged": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_kyc_object_readable": {
      "secdef": true,
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
        "service_role"
      ]
    },
    "nexus_lead_assign_owner": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_lead_attribution": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_lead_attribution_summary": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_lead_endpoint_for_provider_identity": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_lead_endpoint_for_public_key": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
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
    "nexus_lead_ingest_invariants": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_lead_ingest_secret_put": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_lead_ingest_secret_reveal": {
      "secdef": true,
      "tenantArg": false,
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
    "nexus_lead_normalized_defect": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_lead_record_manual": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_lead_source_connect": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_lead_source_connections": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_lead_source_disconnect": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_lead_source_readiness": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_lead_source_rotate_secret": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_lead_trace": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_leads_owner_change_audit": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
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
    "nexus_meta_onboarding_status": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
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
    "nexus_multi_tenant_blockers": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_my_actor": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_my_appointment_attend": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_my_appointment_cancel": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_my_appointment_confirm": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_my_appointment_no_show": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_my_appointment_offer_slots": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_my_appointment_request": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_my_customer_for_lead": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_my_lead_retry_scoring": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_my_solo_tenant": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_my_staff_user_ids": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_my_subscription": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_my_tenant_capabilities": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_my_tenant_config": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_notification_acknowledge": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_notification_attempt_is_append_only": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_notification_claim": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_notification_enqueue": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_notification_mark_failed": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_notification_mark_sent": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_notification_refuse_transition": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_notification_status": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
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
    "nexus_payment_instructions": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_pending_scoring_leads_for_tenant": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_promote_lead_event": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_provider_router_invariants": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_prune_processed_messages": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_public_exposure_report": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_quarantine_census": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_quarantine_comm_log": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_record_channel_event": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_record_channel_event_text": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_record_lead_event": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_record_lead_scoring_result": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_record_send_result": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_refuse_destructive_write": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_register_channel": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_reject_lead_event": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_request_send": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
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
    "nexus_resolve_channel_tenant": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_resolve_tenant_capability": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_resolve_tenant_config": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_retention_preview": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_route_message": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_sales_lead_enqueue_notification": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_sales_lead_submit": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
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
    "nexus_scoring_health": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_subscription_cancel": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_subscription_convert_to_paid": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_subscription_event_is_append_only": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_subscription_start_trial": {
      "secdef": true,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_subscription_status": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_sync_comm_log_evidence_state": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_team_cancel_invite": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_team_invite": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_team_link_staff": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_team_pending": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_team_revoke_access": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_team_roster": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_team_set_role": {
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
    "nexus_tenant_capability_core": {
      "secdef": true,
      "tenantArg": true,
      "grants": []
    },
    "nexus_tenant_config_core": {
      "secdef": true,
      "tenantArg": true,
      "grants": []
    },
    "nexus_tenant_ids_for_roles": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_trace_linkability_report": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_validate_iban": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_verify_template_ref": {
      "secdef": false,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "nexus_webhook_create": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_webhook_delete": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_webhook_deliveries": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_webhook_send_test": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_webhooks_list": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_whatsapp_cloud_canonical_events": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "nexus_whatsapp_consent_current": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_whatsapp_consent_events": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
        "service_role"
      ]
    },
    "nexus_workflow_catalogue": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "authenticated",
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
    "policy_platform_attestation_append_only": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "policy_platform_supersede_rule": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "policy_platform_verify_rule": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
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
    "policy_refuse": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "policy_rule_derive_jurisdiction_owner": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
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
    },
    "tenant_capability_touch": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "tenant_configuration_validate": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_apply_delivery_to_usage": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_delivery_events_append_only": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_delivery_events_guard_link": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_delivery_status_rank": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_link_delivery_events": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_message_usage_touch": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_opt_in_event_append_only": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_opt_in_state": {
      "secdef": false,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_policy_decision": {
      "secdef": false,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_policy_decision_for_channel": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_policy_rule_lookup": {
      "secdef": false,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_record_customer_message": {
      "secdef": false,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_record_delivery_status": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_record_message_usage": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_record_opt_in_event": {
      "secdef": false,
      "tenantArg": true,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_refuse_end_user_role": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_template_declare": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_template_observe": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_template_retire": {
      "secdef": true,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_template_sendability": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_template_variable_schema_ok": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_templates_guard_channel": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
        "service_role"
      ]
    },
    "whatsapp_templates_touch": {
      "secdef": false,
      "tenantArg": false,
      "grants": [
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
  },
  "migration": {
    "head": "20260921054925",
    "count": 352,
    "newest": "20260921054925,20260921054858,20260921040841,20260921040803,20260921040723"
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

/* THE FOUNDER CONSOLE IS NOT PART OF THE DEALER APP (22 Sep 2026).
   NX1004 put it in lib/nav.js as a founderOnly item, hidden from everyone but
   the platform admin. That still put founder UI in front of anyone watching a
   screen recording of the dealer app made while the founder was signed in, so
   it moved to its own page (founder/index.html, served at /founder), which
   renders screens/founder.js directly. These modules are the founder page's
   own: they live in screens/ so every source check below still reads them,
   but they must NOT register into the dealer app's SCREENS registry -- S1
   exempts them from "registers a screen" and S11 asserts they do not. */
const FOUNDER_PAGE_MODULES = new Set(['screens/founder.js']);
/* Any founderOnly flag surviving in NAV is itself a defect (S11). */
const NAV_FOUNDER_ONLY_IDS = new Set(
  [...navBlock.matchAll(/\{\s*id\s*:\s*'([a-z0-9_]+)'[^}]*founderOnly\s*:\s*true/g)].map(m => m[1]));

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
  /* THE VERSION ANCHOR — the fact that makes this catalogue's currency
     checkable, and the one this file went two days without.

     takenAt is a CLOCK, and a clock is the wrong witness. The catalogue read on
     5 Sep 2026 at 20:56:16Z was minutes old when the gate consumed it and it was
     already wrong: migration 20260905211435 added two columns to
     whatsapp_templates at 21:14, eighteen minutes later. Nothing about eighteen
     minutes is stale, and L1 reported PASS on a snapshot that no longer
     described the database. CLAUDE.md records the same failure from the other
     end — a catalogue 23.92 hours old was inside the tolerance and produced a
     full live verdict for a database with 60 functions where live had 110.
     Both readings were fresh by the clock and wrong about the schema.

     What decides whether a reading is current is not how long ago it was taken.
     It is whether the migration history has moved since. So the head of
     supabase_migrations.schema_migrations is selected HERE, in the same
     statement that builds everything else, and it travels with the catalogue.
     --refresh-schema copies it into the snapshot, L1 refuses to report PASS when
     the two anchors differ, and L13 refuses to call the catalogue current when
     this repository holds a migration the catalogue's database had not applied.

     to_regclass returns NULL rather than raising for a relation that is not
     there, and CASE evaluates its branches lazily, so a connection that cannot
     see the migrations schema yields readable:false and a NOT RUN rather than a
     catalogue that fails to build. query_to_xml runs the read dynamically, which
     is what keeps the missing-relation case out of the parse. */
  'migration_history', (select case
     when to_regclass('supabase_migrations.schema_migrations') is null
       then json_build_object('readable', false,
              'why', 'supabase_migrations.schema_migrations is not visible to this connection, so this catalogue carries no version anchor and nothing can establish that it describes the database as it stands now')
     else (select json_build_object('readable', true,
             'head',   (xpath('/row/h/text()', x))[1]::text,
             'count',  (xpath('/row/n/text()', x))[1]::text::bigint,
             'newest', (xpath('/row/l/text()', x))[1]::text)
             from query_to_xml('select max(version) h, count(*) n, (select string_agg(v.version, '','') from (select version from supabase_migrations.schema_migrations order by version desc limit 5) v) l from supabase_migrations.schema_migrations', false, true, '') x)
     end),
  'relations', (select json_object_agg(t.table_name, t.cols) from (
     select c.table_name, string_agg(c.column_name, ',' order by c.ordinal_position) cols
       from information_schema.columns c
       join pg_class pc on pc.relname = c.table_name
       join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
      where c.table_schema = 'public' and pc.relkind in ('r','v','m','p')
      group by 1) t),
  /* exec_anon / exec_auth are the EFFECT; acl is the mechanism. L4 and L5 used
     to grep the ACL text for "anon=X" and "authenticated=X", which asks whether
     a grant of that shape was WRITTEN — not whether the role can execute the
     function. A PUBLIC grant (grantee "", rendered "=X/postgres") is inherited
     by anon and authenticated and matches neither pattern, and so does a grant
     held through role membership. CLAUDE.md records this as a known blindness
     in L5; measured on production 5 Sep 2026 it is real and not hypothetical:
     the "anon=X" pattern found 0 functions, has_function_privilege('anon', …)
     found 1 — public.nexus_public_exposure_report, granted "=X/postgres".
     has_function_privilege answers the question the check is actually asking. */
  'functions', (select json_agg(json_build_object(
       'name', p.proname,
       'args', pg_get_function_identity_arguments(p.oid),
       'secdef', p.prosecdef,
       'acl', coalesce(array_to_string(p.proacl::text[],' | '),'DEFAULT-NULL-ACL'),
       'exec_anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
       'exec_auth', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
       'body', p.prosrc))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  /* relkind 'p' as well as 'r': a PARTITIONED table is a table a dealership's
     rows can sit in, and RLS on it is declared on the parent. Reading only 'r'
     would have called a partitioned parent with RLS off invisible rather than
     failing it. There are none in public on either project today (measured
     5 Sep 2026) — which is the reason to fix it now, while it costs nothing. */
  'tables_no_rls', (select coalesce(json_agg(c.relname order by c.relname),'[]'::json)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity),
  /* THE OPTION'S VALUE, NOT THE OPTION'S PRESENCE.
     Until 5 Sep 2026 this line read

         coalesce(array_to_string(c.reloptions,','),'') not ilike '%security_invoker%'

     which asks whether the OPTION IS MENTIONED, not whether it is TRUE. A view
     created "with (security_invoker = false)" contains that substring, so it was
     excluded from this list and L3 passed it — while behaving in exactly the way
     L3 exists to forbid: RLS on its base tables evaluated as the view's owner
     rather than as the caller. Measured on production the same day,
     "select 'security_invoker=false' ilike '%security_invoker%'" is true. The
     check tested that somebody had typed the word.

     And "= 'true'" would be the same defect facing the other way. Postgres
     stores the boolean as it was written and does not normalise it: production
     holds security_invoker=true on 38 views and security_invoker=on on
     v_competitor_latest, and both ARE true. A test for the literal 'true' would
     fail that view and cry wolf, which is how a gate stops being read. So the
     value is parsed out and compared against the spellings Postgres accepts.
     Verified 5 Sep 2026: 39 of 39 views pass on production (dsvuoovivysszdoiorch)
     and 39 of 39 on staging (wwspuxrbiyagnrnzgate).

     views_invoker_test is a marker, not decoration: a catalogue dumped before
     this fix carries a list produced by the substring test and is
     indistinguishable from one produced by this test. L3 refuses to report PASS
     on a list whose meaning it cannot establish. */
  'views_invoker_test', 'boolean-value',
  'views_no_invoker', (select coalesce(json_agg(c.relname order by c.relname),'[]'::json)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relkind='v'
       and not exists (select 1 from unnest(coalesce(c.reloptions,'{}'::text[])) o
                        where lower(split_part(o,'=',1)) = 'security_invoker'
                          and lower(btrim(split_part(o,'=',2))) in ('true','on','1','yes'))),
  /* The same guarantee in the shape L3 structurally cannot see. A MATERIALIZED
     view reads its base tables as its owner and NO policy applies to it — there
     is no security_invoker option to carry, and it is not relkind 'v', so it can
     never appear in the list above. That is the L3 exposure with the mechanism
     removed rather than mis-set. None exist in public on either project
     (measured 5 Sep 2026); reported as a WARN when one does, because a
     materialized view of tenant-owned data is a decision somebody should have
     to defend, not a silent omission. */
  'rls_incapable_relations', (select coalesce(json_agg(c.relname order by c.relname),'[]'::json)
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname='public' and c.relkind='m'),
  /* Every fact L2's exemption conjunction reads is selected HERE, in the same
     statement, from the catalogue. The exemption is a decision (a name in a map
     in this file); the property that decision is conditional on is a
     measurement, and a measurement must come from the database or it is a
     belief. Drop one of these keys and L2 fails the named table rather than
     passing it — an exemption that cannot be re-checked is not an exemption. */
  /* A MARKER, NOT DECORATION — the same device as views_invoker_test above.
     A catalogue dumped before the change below carries an open_policies list
     built by the literal-string test, and it is indistinguishable from one built
     by evaluating the predicate. L2 will not report PASS on a list whose meaning
     it cannot establish. */
  'policy_openness_test', 'unconditional-evaluated',
  /* WHAT "OPEN" MEANS, AND WHY IT USED TO BE A TOKEN.
     Until 6 Sep 2026 this WHERE clause read

         (coalesce(p.qual,'')='true' or coalesce(p.with_check,'')='true')

     which asks whether somebody TYPED the word true. CLAUDE.md lists that as one
     of three P0s resting on a token, and it is not hypothetical: measured on
     staging 6 Sep 2026 inside a DO block that ended in RAISE EXCEPTION, so
     nothing persisted —

         using (true)         -> pg_policies.qual = 'true'          caught
         using ('t'::boolean) -> pg_policies.qual = 'true'          caught (folded)
         using (1=1)          -> pg_policies.qual = '(1 = 1)'       INVISIBLE
         using (not false)    -> pg_policies.qual = '(NOT false)'   INVISIBLE

     Postgres does NOT constant-fold a policy expression into 'true', so a policy
     that admits every row of a tenant-owned table could sit here unseen. The
     test now asks the question the check is actually about — does this predicate
     filter anything — in two steps, and Postgres answers both:

       1. Does the expression reference a column of the row? The parse tree says
          so directly: pg_policy.polqual::text contains a {VAR node for every
          column reference. '(tenant_id IS NOT NULL)' has one; '(1 = 1)' does
          not. A predicate that reads no column of the row cannot filter rows by
          their content.
       2. If it references no column, EVALUATE it. query_to_xml runs
          'select (<the expression>)::bool' and the answer is Postgres's own, not
          a pattern match.

     Step 2 is fenced. It runs only when the tree contains no {VAR — so the
     expression cannot reference the table — and no {FUNCEXPR, {SUBLINK,
     {SUBPLAN, {AGGREF or {WINDOWFUNC, so no function of ours is called and no
     subquery is run to satisfy a check. A predicate excluded by that fence is
     NOT quietly treated as closed: it is reported separately in
     policy_undecidable below, because "this gate declined to decide" and "this
     policy is safe" are different sentences and only one of them is true.

     The literal test is kept and OR-ed rather than replaced, so this change can
     only ever add a policy to the list. Measured on production the same day:
     12 open before, 12 open after, 0 gained, 0 lost, 0 undecidable — the check
     is now real and today it changes nothing, which is the outcome to want. */
  'policy_undecidable', (select coalesce(json_agg(json_build_object(
       'table', p.tablename, 'policy', p.policyname, 'cmd', p.cmd, 'roles', p.roles,
       'expr', coalesce(p.qual, p.with_check))), '[]'::json)
     from pg_policies p
     join pg_class c on c.relname = p.tablename
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = p.schemaname
     join pg_policy pol on pol.polrelid = c.oid and pol.polname = p.policyname
    where p.schemaname='public'
      and array_to_string(p.roles,',') <> 'service_role'
      and coalesce(p.qual,'') <> 'true' and coalesce(p.with_check,'') <> 'true'
      and ((p.qual is not null
            and coalesce(pol.polqual::text,'') not like '%{VAR %'
            and (coalesce(pol.polqual::text,'') like '%{FUNCEXPR%'
              or coalesce(pol.polqual::text,'') like '%{SUBLINK%'
              or coalesce(pol.polqual::text,'') like '%{SUBPLAN%'
              or coalesce(pol.polqual::text,'') like '%{AGGREF%'
              or coalesce(pol.polqual::text,'') like '%{WINDOWFUNC%'))
        or (p.with_check is not null
            and coalesce(pol.polwithcheck::text,'') not like '%{VAR %'
            and (coalesce(pol.polwithcheck::text,'') like '%{FUNCEXPR%'
              or coalesce(pol.polwithcheck::text,'') like '%{SUBLINK%'
              or coalesce(pol.polwithcheck::text,'') like '%{SUBPLAN%'
              or coalesce(pol.polwithcheck::text,'') like '%{AGGREF%'
              or coalesce(pol.polwithcheck::text,'') like '%{WINDOWFUNC%')))),
  'open_policies', (select coalesce(json_agg(json_build_object(
       'table', p.tablename, 'policy', p.policyname, 'roles', p.roles, 'cmd', p.cmd,
       'qual', p.qual, 'with_check', p.with_check,
       'open_witness', (case
            when coalesce(p.qual,'')='true' or coalesce(p.with_check,'')='true'
              then 'the policy expression is the literal true'
            when u.q then 'the USING expression references no column of the table and Postgres evaluates it to TRUE: ' || p.qual
            when u.w then 'the WITH CHECK expression references no column of the table and Postgres evaluates it to TRUE: ' || p.with_check
            else 'open by a witness this catalogue did not record' end),
       'table_acl', coalesce(array_to_string(c.relacl, E'\\n'), '(owner-only)'),
       /* relacl is the mechanism; these two are the effect, and they are not the
          same fact. A table can grant a role nothing in relacl and still hand it
          columns: pg_attribute.attacl carries COLUMN-level grants, and relacl
          cannot see them. That is not a hypothetical — measured on production
          5 Sep 2026, public.workflow_registry's relacl names only postgres and
          service_role, while seven of its columns carry authenticated=r. Read
          through relacl alone the table looks service_role-only; every signed-in
          user of every dealership can read it. CLAUDE.md records the same shape
          on policy_platform_attestation and says in terms that the ACL query it
          prescribes, and this gate's own l2AuthenticatedAclLetters, are blind to
          it. has_table_privilege / has_any_column_privilege answer the question
          the exemption conjunction is actually asking — may this role write to
          this table — and they also see a grant held through PUBLIC or through
          role membership, which no string match on relacl can.
          DELETE and TRUNCATE have no column-level form, so they are asked of the
          table only. */
       'auth_privs', (select coalesce(array_agg(v order by v), '{}'::text[])
            from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) v
           where has_table_privilege('authenticated', c.oid, v)
              or (v in ('SELECT','INSERT','UPDATE') and has_any_column_privilege('authenticated', c.oid, v))),
       'anon_privs', (select coalesce(array_agg(v order by v), '{}'::text[])
            from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) v
           where has_table_privilege('anon', c.oid, v)
              or (v in ('SELECT','INSERT','UPDATE') and has_any_column_privilege('anon', c.oid, v))),
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
     join pg_policy pol on pol.polrelid = c.oid and pol.polname = p.policyname
     cross join lateral (select
        (case when p.qual is null then false
              when coalesce(pol.polqual::text,'') like '%{VAR %'       then false
              when coalesce(pol.polqual::text,'') like '%{FUNCEXPR%'   then false
              when coalesce(pol.polqual::text,'') like '%{SUBLINK%'    then false
              when coalesce(pol.polqual::text,'') like '%{SUBPLAN%'    then false
              when coalesce(pol.polqual::text,'') like '%{AGGREF%'     then false
              when coalesce(pol.polqual::text,'') like '%{WINDOWFUNC%' then false
              else coalesce((select (xpath('/row/v/text()', x))[1]::text
                               from query_to_xml('select ('||p.qual||')::bool as v', false, true, '') x) = 'true', false)
         end) as q,
        (case when p.with_check is null then false
              when coalesce(pol.polwithcheck::text,'') like '%{VAR %'       then false
              when coalesce(pol.polwithcheck::text,'') like '%{FUNCEXPR%'   then false
              when coalesce(pol.polwithcheck::text,'') like '%{SUBLINK%'    then false
              when coalesce(pol.polwithcheck::text,'') like '%{SUBPLAN%'    then false
              when coalesce(pol.polwithcheck::text,'') like '%{AGGREF%'     then false
              when coalesce(pol.polwithcheck::text,'') like '%{WINDOWFUNC%' then false
              else coalesce((select (xpath('/row/v/text()', x))[1]::text
                               from query_to_xml('select ('||p.with_check||')::bool as v', false, true, '') x) = 'true', false)
         end) as w) u
     where p.schemaname='public'
       and (coalesce(p.qual,'')='true' or coalesce(p.with_check,'')='true' or u.q or u.w)
       and array_to_string(p.roles,',') <> 'service_role'),
  /* DEAD ON PURPOSE, AND DO NOT READ IT AS A DEFECT. The line below calls an
     aggregate that exists in no Postgres and never did. It is never executed:
     the .replace() at the end of this template strips the whole 'sentinel' key
     before the SQL leaves this file, and the count it was reaching for is
     selected as meta.sentinel_units instead. The per-unit rows the gate
     actually reads are sentinel_states, immediately below.

     It is left here rather than deleted because deleting it would turn the
     .replace() from a fact into a superstition, and because on 7 Sep 2026 it
     cost a session: this text was read, the call was correctly identified as
     impossible, and the conclusion drawn was that --refresh-schema could not
     work as shipped. It works. THE TEMPLATE LITERAL IS NOT THE SQL. Run
     node QUALITY_GATE.mjs --print-sql and read THAT — measured the same day,
     the emitted SQL runs clean on production and returns 482,833 characters.
     Deliberately not naming the aggregate here: a name written into a comment
     is carried into the emitted SQL and would make a grep of --print-sql find
     it, which is the check this note exists to send the next reader to. */
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
  /* L10 counts rows and its evidence line then asserted "the CHECK
     inventory_actions_recovered_needs_real_sale holds" — a claim about a
     constraint it never read. Zero bad rows today is compatible with the
     constraint having been dropped this morning; the count is the symptom, the
     constraint is the guarantee, and only one of them was being measured. So
     the constraint is selected here and L10 says which of the two it saw. */
  'recovered_value_guard', (select coalesce(json_agg(json_build_object(
       'name', con.conname, 'def', pg_get_constraintdef(con.oid))), '[]'::json)
     from pg_constraint con
     join pg_class c on c.oid = con.conrelid
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.relname = 'inventory_actions' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%recovered_value_aed%'),
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
  /* CODE POINTS, NOT UTF-16 CODE UNITS, AND THE DIFFERENCE IS NOT ACADEMIC.
     CATALOGUE_SQL selects sum(length(prosrc)), and Postgres length() counts
     CODE POINTS. This line used to count String.length, which is UTF-16 code
     units. The two agreed for as long as every function body was BMP-only,
     and on 16 Sep 2026 they stopped: nexus_classify_message_intent carries
     three astral characters (U+1F44D, U+1F64F, U+1F44C), each one code point
     and two code units, so Postgres said 427,171 and JavaScript said 427,174
     and the seal refused a catalogue that had arrived complete and
     md5-identical. A seal that rejects intact evidence teaches its operator
     to bypass it, which is the only way this check can actually fail.
     [...str] iterates by code point, so both sides now count the same thing
     and a truncated transfer is still caught exactly as before. */
  const bodyChars = cat.functions.reduce((a, f) => a + [...String(f.body || '')].length, 0);
  if (Number(m.body_chars_expected) !== bodyChars) bad.push(`${m.body_chars_expected} characters of function source were selected and ${bodyChars} arrived (counted in code points, the unit Postgres length() uses) — L4 and L5 read those bodies, and against a truncated body they find nothing and pass`);
  const rels = Object.keys(cat.relations).length;
  if (Number(m.relations_expected) !== rels) bad.push(`${m.relations_expected} relations were selected and ${rels} arrived`);
  if (Number.isFinite(Number(m.sentinel_units)) && Number(m.sentinel_units) !== cat.sentinel_states.length)
    bad.push(`${m.sentinel_units} sentinel units were selected and ${cat.sentinel_states.length} arrived`);
  if (bad.length) return `incomplete: ${bad.join('; ')}`;

  const t = Date.parse(cat.takenAt || '');
  if (!Number.isFinite(t)) return 'it carries no readable takenAt, so nothing says how old the reading is';
  const ageH = (Date.now() - t) / 3.6e6;
  /* A FUSE, NOT THE LOCK. CLAUDE.md's words, and they are right: a catalogue
     23.92 hours old passed this and produced a full live verdict for a database
     whose function count had nearly doubled, and a catalogue eighteen minutes
     old was already behind a migration. This bound catches the grossly old file
     and nothing finer. The lock is the migration anchor — L1 and L13. */
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

/* ── AN UNKNOWN RPC HAS TWO EXPLANATIONS, AND THE GATE MUST NAME BOTH ─────
   RPC_NAMES is the offline render stub's allow-list AND S3's function map, and
   it is ALREADY DERIVED — from live.cat.functions when a catalogue is supplied,
   from SNAPSHOT.rpcs otherwise, and SNAPSHOT.rpcs is itself written by
   --refresh-schema out of the catalogue (see rpcsFromCatalogue below). Nobody
   hand-types a function name into this file and nobody has since 3 Sep 2026.

   That removed the hand-maintenance and left the currency. The list inherits the
   catalogue's anchor exactly, so it goes stale at the same instant the schema
   does — and the symptom is the worst-shaped one this gate can produce. On
   6 Sep 2026 five team_0* migrations created new RPCs after the morning's
   catalogue was taken; the stub answered every screen that called one with
   404 PGRST202; R2 and R3 went red as P0 failures reading exactly like broken
   screens, and an hour went into the screens before anybody read the anchor.

   So for a name the catalogue does not know, ask the one question that separates
   the two explanations, and derive the answer from the two things this gate
   already holds: the catalogue's own migration anchor, and supabase/migrations/.
   If a migration file NEWER than the anchor creates a function of that name, the
   catalogue predating it is a complete explanation and the reader is handed the
   file name. If no such file exists, the name is unaccounted for and that is a
   real finding about the source.

   THIS CHANGES NO VERDICT, ON PURPOSE. A screen calling a function that does not
   exist and a screen calling one the catalogue predates produce an identical
   symptom, and letting the render lane decide between them and clear its own red
   would be a second exemption list — quieter than the first and derived from the
   artefact under audit. The lever that detects the staleness is L13; the lever
   that clears it is re-taking the catalogue. What this adds is the sentence that
   points at the lever instead of at the screens. */
const MIGDIR_RPC = join(HERE, '..', '..', 'supabase', 'migrations');
const CATALOGUE_ANCHOR = (() => {
  const mh = live.cat && live.cat.migration_history;
  if (mh && mh.readable && mh.head != null) return String(mh.head);
  /* OFFLINE THE SNAPSHOT IS THE CATALOGUE, AND IT CARRIES ITS OWN ANCHOR.
     This used to return null whenever live.cat was absent, which is every run
     without a database — including every run in CI. The consequence was the
     one shape this whole block exists to prevent: with no anchor the map below
     is empty, so rpcMissingWhy() took its ELSE branch and printed "no migration
     in supabase/migrations/ newer than that anchor creates a function of that
     name, so snapshot staleness does not explain it" about a name a migration
     in this very repository does create. On 7 Sep 2026 that sentence was
     printed about nexus_lead_source_readiness while
     supabase/migrations/20260907024207_leadingest_07_available_does_not_mean_connected.sql
     sat two directories away creating it. The gate was not wrong about the
     verdict — R2 and R3 are red either way, deliberately — it was wrong about
     the reason, and it pointed the reader at the screens instead of at the
     stale snapshot. SNAPSHOT.migration.head is written by --refresh-schema out
     of the same catalogue, so this is the same fact from the same source. */
  const sm = SNAPSHOT.migration;
  return sm && sm.head != null ? String(sm.head) : null;
})();
const RPC_CREATED_AFTER_ANCHOR = await (async () => {
  const out = new Map();
  if (!CATALOGUE_ANCHOR) return out;
  let files = [];
  try {
    files = (await readdir(MIGDIR_RPC))
      .filter(f => /^\d{14}_.*\.sql$/.test(f) && f.slice(0, 14) > CATALOGUE_ANCHOR).sort();
  } catch { return out; }
  for (const f of files) {
    let sql = '';
    try { sql = await readFile(join(MIGDIR_RPC, f), 'utf8'); } catch { continue; }
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\s*\.\s*)?"?([a-z0-9_]+)"?\s*\(/gi))
      if (!out.has(m[1].toLowerCase())) out.set(m[1].toLowerCase(), f);
  }
  return out;
})();
const rpcMissingWhy = fn => {
  const src = live.cat
    ? `the catalogue this run was given (taken ${SCHEMA_TAKEN}${CATALOGUE_ANCHOR ? `, anchored to migration ${CATALOGUE_ANCHOR}` : ', carrying NO migration anchor'})`
    : `the schema snapshot embedded in this file (taken ${SCHEMA_TAKEN})`;
  const mig = RPC_CREATED_AFTER_ANCHOR.get(String(fn).toLowerCase());
  return mig
    ? `this RPC is not in ${src}, and supabase/migrations/${mig} — NEWER than that anchor — creates a function of that name. On this evidence the snapshot is behind the database, not the screen ahead of it: re-take the catalogue and re-run. This sentence explains a red; it does not clear one.`
    : `this RPC is not in ${src}, and no migration in supabase/migrations/ newer than that anchor creates a function of that name, so snapshot staleness does not explain it.`;
};
/* Every name the stub had to refuse, so R2 and R3 can carry the explanation
   into their own failure lines instead of leaving it in a 404 body. */
const STUB_UNKNOWN_RPCS = new Map();
const stubUnknownRpcNote = () => {
  if (!STUB_UNKNOWN_RPCS.size) return [];
  const ex = [...STUB_UNKNOWN_RPCS.entries()];
  const staleCount = ex.filter(([, m]) => m).length;
  return ['NOTE, and it does not clear this failure — the OFFLINE STUB refused '
    + `${ex.length} RPC name(s) with 404 PGRST202 because ${live.cat ? 'the catalogue this run was given' : 'this file\'s embedded snapshot'} does not contain them: `
    + ex.map(([fn, mig]) => mig
        ? `${fn} (created by supabase/migrations/${mig}, NEWER than the catalogue anchor ${CATALOGUE_ANCHOR})`
        : `${fn} (NO repository migration newer than the anchor creates it)`).join('; ')
    + `. ${staleCount} of ${ex.length} are explained by the snapshot being behind the database — for those the red belongs to this gate's currency, not to the screen, and re-taking the catalogue is what clears it. `
    + 'Any name not so marked is unaccounted for and is a real finding about the source.'];
};

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
    /* PROVENANCE, NOT A FILENAME. "--catalogue /tmp/x.json" says nothing about
       WHICH database was read or how the file got there, and the next reader of
       this snapshot has only this line to go on. NEXUS_SNAPSHOT_SOURCE_NOTE is
       appended verbatim so the run can say it — the project ref, the channel,
       and anything about the transfer that a later reader would need in order
       to distrust it correctly. */
    source: [live.how || 'PostgREST OpenAPI root', process.env.NEXUS_SNAPSHOT_SOURCE_NOTE]
      .filter(Boolean).join(' — '),
    /* THE ANCHOR. takenAt says WHEN this was read; `migration` says WHAT the
       database had applied when it was read, and only the second is checkable.
       A snapshot with no anchor is not refused — it is recorded as null, and L1
       then reports NOT RUN rather than PASS, because a column map that happens
       to match is not evidence that the two sides describe the same database.
       Refreshing from a source that cannot read supabase_migrations (PostgREST's
       OpenAPI root, for one) therefore costs L1 its PASS, deliberately. */
    migration: (live.cat && live.cat.migration_history && live.cat.migration_history.readable
                && live.cat.migration_history.head != null)
      ? { head: String(live.cat.migration_history.head),
          count: Number(live.cat.migration_history.count),
          newest: live.cat.migration_history.newest || null }
      : null,
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
    if (FOUNDER_PAGE_MODULES.has(path)) continue;   // the founder page's, see S11
    if (!ids.length) bad.push(`${path}: registers no SCREENS.<id>`);
    ids.forEach(id => registered.set(id, path));
  }
  for (const id of NAV_IDS) if (!registered.has(id)) bad.push(`lib/nav.js offers "${id}" and no screen module registers it`);
  for (const [id, path] of registered) if (!NAV_IDS.includes(id)) bad.push(`${path} registers "${id}" which the navigation never offers`);
  verdict('S1', LANE.SOURCE, 'P0', 'Navigation and screen registry agree', bad,
    [`${NAV_IDS.length} nav entries, ${registered.size} registered screens, parsed from lib/nav.js: ${NAV_IDS.join(', ')}`]);
}

/* ── S11 · the founder console is a separate page, not part of the dealer app ─
   The owner's rule (22 Sep 2026): a dealer, and a screen recording of the
   dealer app made while the founder is signed in, must show zero founder UI.
   So: no founder item in the dealer nav, no founder module or platform-admin
   check anywhere in the dealer app's own code, and a founder page that
   exists, is built as its own Vite entry, is routed at /founder, and gates
   its console on nexus_is_platform_admin(). R1 checks the rendered half. */
{
  const bad = [];
  if (NAV_FOUNDER_ONLY_IDS.size) bad.push(`lib/nav.js still declares founderOnly item(s): ${[...NAV_FOUNDER_ONLY_IDS].join(', ')}`);
  if (NAV_IDS.includes('founder')) bad.push('lib/nav.js still offers a "founder" screen to the dealer app');
  if (/founder/i.test(navBlock.replace(/\/\*[\s\S]*?\*\//g, ''))) bad.push('lib/nav.js NAV names a founder group or item');
  for (const [path, { code }] of SRC) {
    if (FOUNDER_PAGE_MODULES.has(path) || path === 'lib/platform.js') continue;
    if (/screens\/founder\.js/.test(code)) bad.push(`${path} imports screens/founder.js -- the dealer app must not`);
    if (/lib\/platform\.js|\.\/platform\.js|isPlatformAdmin|loadPlatformAdmin/.test(code)) bad.push(`${path} reads the platform-admin check -- nothing in the dealer app is founder-gated any more`);
    if (/nexus_founder_(?!invite)/.test(code)) bad.push(`${path} calls a nexus_founder_* RPC -- those belong to the founder page`);
  }
  for (const path of FOUNDER_PAGE_MODULES) {
    const f = SRC.get(path);
    if (!f) { bad.push(`${path} is missing`); continue; }
    if (/SCREENS\.[a-z0-9_]+\s*=/.test(f.code)) bad.push(`${path} registers into the dealer app's SCREENS registry`);
    if (/from\s+'\.\.\/lib\/nav\.js'/.test(f.code)) bad.push(`${path} imports lib/nav.js`);
  }
  const fp = join(HERE, 'founder', 'index.html'), fa = join(HERE, 'founder', 'app.js');
  const fhtml = existsSync(fp) ? await readFile(fp, 'utf8') : null;
  const fapp = existsSync(fa) ? stripComments(await readFile(fa, 'utf8')) : null;
  if (!fhtml) bad.push('founder/index.html does not exist');
  else if (!/src="\/founder\/app\.js"/.test(fhtml)) bad.push('founder/index.html does not load /founder/app.js');
  if (!fapp) bad.push('founder/app.js does not exist');
  else {
    if (!/from '\.\.\/screens\/founder\.js'/.test(fapp)) bad.push('founder/app.js does not render screens/founder.js');
    if (!/loadPlatformAdmin\(\)/.test(fapp) || !/isPlatformAdmin\(\)/.test(fapp)) bad.push('founder/app.js does not gate on the platform-admin check');
    if (!/Not authorised/.test(fapp)) bad.push('founder/app.js has no "Not authorised" state for a non-founder');
    if (/lib\/nav\.js/.test(fapp)) bad.push('founder/app.js imports the dealer nav');
  }
  const vite = await readFile(join(HERE, 'vite.config.js'), 'utf8');
  if (!/founder\/index\.html/.test(vite)) bad.push('vite.config.js does not build founder/index.html as its own entry');
  const vpath = join(HERE, '..', '..', 'vercel.json');
  if (existsSync(vpath)) {
    const rw = (JSON.parse(await readFile(vpath, 'utf8')).rewrites || []);
    const iF = rw.findIndex(x => x.source === '/founder' && x.destination === '/founder/index.html');
    const iAll = rw.findIndex(x => x.source === '/(.*)');
    if (iF < 0) bad.push('vercel.json does not route /founder to /founder/index.html');
    else if (iAll >= 0 && iAll < iF) bad.push('vercel.json\'s catch-all rewrite shadows /founder');
  }
  verdict('S11', LANE.SOURCE, 'P0', 'The founder console is a separate page, absent from the dealer app', bad,
    [`dealer nav: ${NAV_IDS.length} items, 0 founder; founder page: founder/index.html + founder/app.js, gated on nexus_is_platform_admin()`]);
}

/* ── S12 · a shared screen shows no customer and no test fixture ─────────────
   Added 22 Sep 2026. Privacy mode masks customer names, phones and emails
   through ONE module (lib/privacy.js): screens call displayName()/maskPhone()/
   maskEmail(), every db() read registers what to mask via scrubRows(), and a
   guard installed by app.js masks whatever is painted. The same scrubRows()
   drops internal test records from every read by default. Both switches
   default OFF/hidden. And no screen may ship a button that says it is not
   wired: the Money Leaks next step was one, and now records and opens. */
{
  const bad = [];
  const P = SRC.get('lib/privacy.js');
  if (!P) bad.push('lib/privacy.js is missing');
  else {
    for (const fn of ['displayName', 'maskPhone', 'maskEmail', 'maskText', 'scrubRows', 'installPrivacyGuard', 'isHiddenLead'])
      if (!new RegExp(`export\\s*\\{[^}]*\\b${fn}\\b`).test(P.code)) bad.push(`lib/privacy.js does not export ${fn}()`);
    if (!/readFlag\(PRIVACY_KEY,\s*false\)/.test(P.code)) bad.push('Privacy mode does not default to OFF');
    if (!/readFlag\(TESTS_KEY,\s*false\)/.test(P.code)) bad.push('internal test records are not hidden by default');
    const re = (P.code.match(/TEST_RECORD_RE\s*=\s*(\/.*\/[a-z]*);/) || [])[1];
    if (!re) bad.push('lib/privacy.js has no TEST_RECORD_RE');
    else {
      const lit = re.match(/^\/(.*)\/([a-z]*)$/);
      const R = new RegExp(lit[1], lit[2]);
      for (const n of ['NEXUS TEST Ahmed [NXTEST-496e60820198]', 'NEXUS TEST Dealer A Customer 1 [4fa7d95b-a-c1]', 'X [step4-abc]', 'Preflight Walk-In'])
        if (!R.test(n)) bad.push(`TEST_RECORD_RE does not match the test fixture "${n}"`);
      for (const n of ['Ahmed Khan', 'Preflighted Motors']) if (R.test(n)) bad.push(`TEST_RECORD_RE hides a real name "${n}"`);
    }
    if (!/if\s*\(!showTests\)\s*continue/.test(P.code)) bad.push('scrubRows() does not drop test rows while they are hidden');
  }
  const D = SRC.get('lib/data.js');
  if (!D || !/return scrubRows\(path, await res\.json\(\)\)/.test(D.code)) bad.push('lib/data.js db() does not pass every read through scrubRows()');
  const A = SRC.get('app.js');
  if (!A || !/installPrivacyGuard\(/.test(A.code)) bad.push('app.js does not install the privacy guard');
  for (const f of ['screens/money-leaks.js', 'screens/leads.js', 'lib/lead-drawer.js', 'screens/conversations.js', 'screens/customers.js', 'screens/overview.js'])
    if (!/from '\.\.?\/(lib\/)?privacy\.js'/.test(SRC.get(f)?.code || '') || !/displayName\(/.test(SRC.get(f)?.code || ''))
      bad.push(`${f} prints a customer name without routing it through displayName()`);
  const idx = await readFile(join(HERE, 'index.html'), 'utf8');
  if (!/id="privacyBtn"[\s\S]{0,200}title="Masks customer names, phones and emails, for screen sharing"/.test(idx)) bad.push('index.html has no Privacy mode toggle with its tooltip');
  if (/demo/i.test((idx.match(/<button[^>]*id="privacyBtn"[\s\S]*?<\/button>/) || [''])[0])) bad.push('the Privacy mode toggle mentions "demo"');
  for (const [path, { raw }] of SRC)
    for (const phrase of ['not wired yet', 'cannot be pressed'])
      if (raw.toLowerCase().includes(phrase)) bad.push(`${path} contains "${phrase}"`);
  const ML = SRC.get('screens/money-leaks.js')?.code || '';
  if (!/data-contact=/.test(ML) || !/rpc\/lead_recovery_decide/.test(ML) || !/leadDrawer\(/.test(ML)) bad.push('Money Leaks\' next-step button does not record the decision and open the lead');
  verdict('S12', LANE.SOURCE, 'P0', 'Privacy mode masks through one helper, test records are hidden, no button says it is unwired', bad,
    ['lib/privacy.js owns masking and test-record filtering; db() routes every read through scrubRows(); Money Leaks\' next step calls lead_recovery_decide and opens the lead']);
}

/* ── S13 · no screen prints a customer's name, phone or email past the helper ─
   Added 22 Sep 2026, after Finance Desk's lead picker printed "name — phone —
   message" in full with Privacy mode on. Every esc(...) in screens/ and lib/
   whose argument reads name / full_name / phone / email / contact_name /
   customer_name (and the lead_/push_/display_ variants) must pass it through
   displayName / maskPhone / maskEmail / maskText. The allowlist below is the
   exception list, per file, and it is only staff, users, workflows, sources,
   competitors and API keys: a `receiver.field` in it is not a customer. */
{
const PII_FIELDS = 'name|full_name|phone|phone_e164|email|contact_name|customer_name|lead_name|display_name|push_name|lead_email|customer_phone|customer_display_name';
const PII_HELPER = /\b(displayName|maskPhone|maskEmail|maskText|maskPII)\(/;
function piiCodeOnly(s) {
  let out = '', i = 0;
  const tmpl = () => { i++; while (i < s.length && s[i] !== '`') { if (s[i] === '\\') { i += 2; continue; } if (s[i] === '$' && s[i + 1] === '{') { i += 2; let d = 1, st = i; while (i < s.length && d) { if (s[i] === '{') d++; else if (s[i] === '}') d--; else if (s[i] === '`') { out += ' '; } i++; } out += ' ' + piiCodeOnly(s.slice(st, i - 1)) + ' '; continue; } i++; } i++; };
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"') { i++; while (i < s.length && s[i] !== c) { if (s[i] === '\\') i++; i++; } i++; out += ' "" '; continue; }
    if (c === '`') { tmpl(); out += ' '; continue; }
    out += c; i++;
  }
  return out;
}
function piiScan(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`\\])(\/\/.*)$/gm, (m, p, c) => p + c.replace(/./g, ' '));
  const hits = []; const re = /\besc\(/g; let m;
  while ((m = re.exec(code))) {
    let i = m.index + 4, d = 1;
    while (i < code.length && d) { const ch = code[i]; if (ch === "'" || ch === '"' || ch === '`') { const q = ch; i++; while (i < code.length && code[i] !== q) { if (code[i] === '\\') i++; i++; } } else if (ch === '(') d++; else if (ch === ')') d--; i++; }
    const arg = code.slice(m.index + 4, i - 1);
    if (PII_HELPER.test(arg)) continue;
    const c = piiCodeOnly(arg);
    const keys = [...c.matchAll(new RegExp(`(?:([A-Za-z_$][\\w$]*|\\)|\\])\\s*\\??\\.\\s*(${PII_FIELDS})|(?<![\\w$.])(${PII_FIELDS}))\\b`, 'g'))]
      .map(k => (k[1] ? `${k[1]}.${k[2]}` : k[3]));
    if (keys.length) hits.push({ start: m.index + 4, end: i - 1, line: code.slice(0, m.index).split('\n').length, keys, arg });
  }
  return hits;
}

  const PII_ALLOW = {
    "*": [
      "ME.name",
      "user.email",
      "u.name",
      "u.email",
      "rep.name"
    ],
    "screens/automation.js": [
      "worst.name",
      "w.name"
    ],
    "screens/ask.js": [
      "w.name"
    ],
    "screens/campaigns.js": [
      "w.name"
    ],
    "screens/competitors.js": [
      "c.name",
      "].name",
      "oldestTrail.name",
      "one.name",
      "g.name",
      "a.name",
      "b.name"
    ],
    "screens/founder.js": [
      "r.name"
    ],
    "screens/integrations.js": [
      "name",
      "r.name"
    ],
    "lib/integrations.js": [
      "c.name",
      "m.name",
      "name"
    ],
    "screens/lead-sources.js": [
      "rd.name",
      "s.name"
    ],
    "screens/record-lead.js": [
      "m.name"
    ],
    "screens/channels.js": [
      "r.display_name"
    ],
    "lib/manual-lead-form.js": [
      "r.display_name"
    ],
    "screens/settings.js": [
      "email",
      "w.name"
    ],
    "screens/team.js": [
      "r.name",
      "r.email",
      "only.name",
      "p.email"
    ],
    "screens/overview.js": [
      "w.name"
    ],
    "screens/leads.js": [
      "name"
    ],
    "lib/lead-drawer.js": [
      "name"
    ]
  };
  const allowed = (path, k) => PII_ALLOW['*'].includes(k) || (PII_ALLOW[path] || []).includes(k);
  const bad = [];
  let scanned = 0;
  for (const [path, { raw }] of SRC) {
    if (!/^(screens|lib)\//.test(path) || path === 'lib/privacy.js') continue;
    scanned++;
    for (const h of piiScan(raw)) {
      const miss = h.keys.filter(k => !allowed(path, k));
      if (miss.length) bad.push(`${path}:${h.line} prints ${miss.join(', ')} without displayName/maskPhone/maskEmail/maskText`);
    }
  }
  verdict('S13', LANE.SOURCE, 'P0', 'No screen prints a customer name, phone or email without the privacy helper', bad,
    [`${scanned} files scanned; every esc() of a PII-shaped field is masked or on the staff/non-customer allowlist`]);
}

/* ── S14 · the privacy helpers, run rather than read ────────────────────────
   Added 22 Sep 2026, after a live scan found test fixtures on Overview, Leads
   and Revenue Recovery (a title or customer_label a view composed around the
   fixture's name) and part of a customer's name on Attribution ("Mustafa Fefco
   …" masked as "Customer X Fefco"). lib/privacy.js is imported here with a
   stub storage and body, fed rows shaped like those views, and asked what it
   would paint. */
{
  const bad = [];
  const saved = { localStorage: globalThis.localStorage, document: globalThis.document };
  try {
    globalThis.localStorage = { getItem: () => null, setItem() {} };
    globalThis.document = { body: { classList: { toggle() {} } } };
    const P = await import(pathToFileURL(join(HERE, 'lib', 'privacy.js')).href + '?gate=' + Date.now());
    P.scrubRows('leads?select=id,name', [{ id: 1, name: 'Mustafa Fefco Trading' }, { id: 2, name: 'KAWKAB AL NUJOOM COSMETIC' }, { id: 3, name: 'Syed' }]);
    P.scrubRows('v_attribution_lead_chain', [{ lead_id: 4, lead_name: 'Real Person', chain: [{ customer_name: 'Hussain Baravdawala' }] }]);
    const kept = (rel, rows) => P.scrubRows(rel, rows).length;
    if (kept('v_needs_attention', [{ title: 'NEXUS TEST Ahmed [NXTEST-496e60820198] has had no reply' }]) !== 0) bad.push('a v_needs_attention row titled after a test fixture is not dropped');
    if (kept('v_deal_rescue', [{ lead_id: 9, customer_label: 'Preflight Walk-In' }]) !== 0) bad.push('a v_deal_rescue row whose customer_label is a test fixture is not dropped');
    if (kept('v_attribution_sale_chain', [{ sale_id: 1, lead_name: 'x', lead_note: 'matched to NEXUS TEST Dealer A Customer 1 [4fa7d95b-a-c1]' }]) !== 0) bad.push('a row whose note names a test fixture is not dropped');
    if (kept('v_needs_attention', [{ title: 'A real lead is waiting' }]) !== 1) bad.push('a real v_needs_attention row was dropped');
    const t = P.scrubText('NEXUS TEST Dealer A Customer 1 [4fa7d95b-a-c1] waiting, and Preflight Walk-In');
    if (/NEXUS TEST|NXTEST|Preflight/i.test(t)) bad.push(`test markers survive in rendered text while hidden: "${t}"`);
    P.setPrivacy(true);
    const REAL = /Mustafa|Fefco|KAWKAB|NUJOOM|Syed|Hussain|Baravdawala|\+?971\s?5\d|05\d{8}/i;
    for (const line of ['Mustafa Fefco …', 'Fefco replied', 'KAWKAB AL NUJOOM', 'Syed', 'Hussain Baravdawala bought',
                        'call +971 56 721 5948', 'call 0567215948'])
      if (REAL.test(P.scrubText(line))) bad.push(`with Privacy mode on, "${line}" renders as "${P.scrubText(line)}"`);
    if (P.scrubText('Customer service is here') !== 'Customer service is here') bad.push('ordinary copy was altered by the name mask');
    P.setPrivacy(false);
  } catch (e) {
    bad.push(`lib/privacy.js could not be exercised: ${e.message}`);
  } finally {
    if (saved.localStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = saved.localStorage;
    if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
  }
  const A = SRC.get('app.js')?.code || '';
  for (const rel of ['leads?', 'v_conversations?', 'whatsapp_contacts?', 'customer?'])
    if (!A.includes(`'${rel}select=`)) bad.push(`app.js does not read ${rel.slice(0, -1)} before the first screen, so its names are unknown to the mask`);
  verdict('S14', LANE.SOURCE, 'P0', 'Test fixtures and partial customer names never reach the screen', bad,
    ['composed titles, labels and notes that name a fixture are dropped; a partial or multi-word customer name masks to one pseudonym; phones in any UAE form are masked']);
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
      if (!RPC_NAMES.has(fn)) bad.push(`${path}: rpc/${fn} — ${rpcMissingWhy(fn)}`);
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
/* The exact refusal sentence the stub serves for action_approver_context, named
   here because R7 asserts this string reaches the screen rather than asserting
   that some approver-ish word does. */
const STUB_REFUSAL_REASON = 'This account is neither an account owner nor a manager, so it may not decide inventory actions.';

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
    /* Declared once, served by the stub and looked for by R7, so the two cannot
       drift apart: R7's job is to prove the DATABASE'S OWN sentence reached the
       reader, and a check that greps for a paraphrase proves something weaker. */
    /* The 404 the stub serves for a name it does not hold used to read exactly
       like PostgREST refusing a call the database would refuse. It is not that:
       it is THIS GATE'S schema map declining a name, and the two are read very
       differently by somebody deciding whether a screen is broken. The hint says
       which, and says it from the anchor and the repository rather than from a
       judgement. */
    if (!RPC_NAMES.has(fn)) {
      STUB_UNKNOWN_RPCS.set(fn, RPC_CREATED_AFTER_ANCHOR.get(fn.toLowerCase()) || null);
      return { status: 404, body: { code: 'PGRST202',
        message: `the gate's offline stub has no function public.${fn}`,
        hint: rpcMissingWhy(fn) } };
    }
    if (fn === 'sentinel_inventory_actions')
      return { status: 200, body: [{ ...fabricate('v_inventory_profit_sentinel'), ...SENTINEL_UNKNOWN, id: 'NX-1011', vin: 'JTMHV05J104123999' }] };
    if (fn === 'action_approver_context')
      /* may_decide FALSE on purpose. R7 requires the screen to render the
         controls disabled with the database's refusal on them, not hide them. */
      return { status: 200, body: [{ auth_user_id: 'u1', tenant_id: 't1', tenant_role: 'member',
        staff_id: 's1', staff_name: 'Ali Asgher', staff_role: 'senior_rep', may_decide: false,
        authority: null, refusal_code: 'NOT_AN_APPROVER',
        refusal_reason: STUB_REFUSAL_REASON,
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
    if (out.status !== 200) rejections.push(`${out.status} ${out.body.code || ''} ${out.body.message}${out.body.hint ? ` — ${out.body.hint}` : ''}`);
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
        /* R7 asks whether the DECISION controls were rendered and refused. Any
           disabled button on the page satisfies "a disabled control exists" —
           including one a click handler disabled while it was saving — so the
           count above is the presence of a mechanism, not the effect R7 claims.
           screens/actions.js marks the three decision buttons with data-decide;
           these two count those and only those. */
        decideButtons: host.querySelectorAll('button[data-decide]').length,
        decideDisabled: host.querySelectorAll('button[data-decide][disabled]').length,
        stuckLoading: host.querySelectorAll('.skeleton').length > 0,
        errored: /Couldn.t load/.test(h) };
    });
    screens[id].newErrors = errs.length - before;
  }
  /* A stale #founder hash (a bookmark from when the console lived in this app)
     must land on the default screen, and no nav item may name the founder. */
  await page.evaluate(() => { location.hash = 'founder'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
  await page.waitForTimeout(900);
  const staleFounder = await page.evaluate(() => ({ hash: location.hash,
    navFounder: [...document.querySelectorAll('.nav-item')].some(b => /founder/i.test(b.innerText || '')) }));
  /* The founder page, opened by this same NON-founder stub account (never
     seeded into platform_admin): it must say "Not authorised" and draw no
     console. */
  await page.goto('http://127.0.0.1:8071/founder/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const founderPage = await page.evaluate(() => ({
    appShown: !document.getElementById('app').classList.contains('hide'),
    boot: (document.getElementById('boot').innerText || '').slice(0, 200),
    consoleChars: document.getElementById('screen').innerHTML.length }));
  await browser.close();
  srv.close();
  render = { loggedIn, nav, bootText, screens, errs, rejections, restCalls, staleFounder, founderPage };
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
     r.nav !== NAV_IDS.length && `navigation rendered ${r.nav} items; lib/nav.js declares ${NAV_IDS.length}`,
     r.staleFounder.hash !== '#moneyleaks' && `a stale #founder hash landed on ${r.staleFounder.hash}, not the default screen`,
     r.staleFounder.navFounder && 'a dealer nav item names the founder',
     ...NAV_IDS.filter(id => /founder/i.test(r.screens[id].text || '')).map(id => `the ${id} screen shows the word "founder" to a dealer`),
     (r.founderPage.appShown || r.founderPage.consoleChars > 0) && 'the founder page drew its console for a non-founder account',
     !/Not authorised/.test(r.founderPage.boot) && `the founder page did not say "Not authorised" to a non-founder (it said: ${r.founderPage.boot || 'nothing'})`].filter(Boolean),
    [`loggedIn=true, navItems=${r.nav} matching the ${NAV_IDS.length} lib/nav.js declares`, `${r.errs.length} page errors across the whole run`,
     `#founder -> ${r.staleFounder.hash}; founder page as a non-founder: "Not authorised"`]);

  const broken = NAV_IDS.filter(id => { const s = r.screens[id]; return s.len < 200 || s.errored || s.newErrors > 0 || s.stuckLoading; });
  verdict('R2', LANE.RENDER, 'P0', 'Every screen renders real content with no page errors',
    broken.length
      ? broken.map(id => { const s = r.screens[id]; return `${id}: chars=${s.len} errState=${s.errored} stuck=${s.stuckLoading} newErrors=${s.newErrors}`; })
          .concat(stubUnknownRpcNote())
      : [],
    [`${NAV_IDS.length}/${NAV_IDS.length} screens rendered`,
     NAV_IDS.map(id => `${id}:${r.screens[id].len}c/${r.screens[id].cards}cards`).join('  ')]);

  /* Non-vacuous by construction. The previous gate printed "none — every select
     names columns that exist" on a run in which no screen ever executed a
     single query, because the app had never booted. A clean result is only
     meaningful beside the number of queries that produced it. */
  const uniq = [...new Set(r.rejections)];
  const MIN_CALLS = 30;
  verdict('R3', LANE.RENDER, 'P0', 'No query the database would reject — and the check is not vacuous',
    uniq.concat(r.restCalls < MIN_CALLS ? [`only ${r.restCalls} PostgREST calls were observed (expected at least ${MIN_CALLS}); a clean result here would mean nothing was checked`] : [])
        .concat(uniq.length || r.restCalls < MIN_CALLS ? stubUnknownRpcNote() : []),
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
    /* THE SERVED SENTENCE, NOT A FAMILY OF APPROVER-ISH WORDS. The old test was
       /not an approver|may not decide|account owner|manager/i, and "manager"
       appears in any list of staff roles — so a screen that never rendered the
       refusal at all could satisfy it by naming a job title somewhere else. The
       stub serves one exact sentence and that is the string this looks for. */
    if (!(s.text || '').includes(STUB_REFUSAL_REASON))
      bad.push(`actions: the database's own refusal sentence ("${STUB_REFUSAL_REASON}") does not appear on the screen — the operator is not being told why the control is refused`);
    /* THE DECISION CONTROLS, NOT ANY DISABLED BUTTON. s.disabledButtons counts
       every button[disabled] on the screen, so a button some other handler had
       disabled would have satisfied this check while the Approve / Reject /
       Defer controls were hidden — which is the exact failure R7 exists to
       forbid. */
    if (!s.decideButtons)
      bad.push('actions: no decision control was rendered at all (no button[data-decide]) — with may_decide=false the controls were hidden rather than refused, which teaches the operator the feature does not exist');
    else if (s.decideDisabled !== s.decideButtons)
      bad.push(`actions: ${s.decideButtons} decision control(s) rendered and only ${s.decideDisabled} of them are disabled, on a session the database says may not decide — an enabled control here invites a call the database will refuse`);
    verdict('R7', LANE.RENDER, 'P0', 'Authorisation is shown and disabled, not hidden', bad,
      [`served may_decide=false / NOT_AN_APPROVER; the screen rendered ${s.decideButtons} decision control(s) (button[data-decide]) and all ${s.decideDisabled} of them are disabled`,
       'the refusal sentence checked is the exact string the stub served, not a family of approver-ish words',
       `${s.disabledButtons} disabled buttons on the screen in total — reported for context and deliberately NOT the test`]);
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
              ∧  authenticated cannot INSERT, UPDATE, DELETE or TRUNCATE it
              ∧  anon cannot either

   That last pair is a MEASUREMENT of what the roles may do — has_table_privilege
   and has_any_column_privilege, taken in the same statement — not a reading of
   the ACL text. Until 5 Sep 2026 it was the ACL text, which cannot see a
   column-level grant: production's workflow_registry names nobody but postgres
   and service_role in relacl and hands authenticated seven of its columns.

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
   not the policy, decides whether a USING(true) read policy is survivable.
   This alphabet belongs to the relacl FALLBACK path only; the primary witness is
   the privilege the catalogue measured. See l2WritePrivileges below. */
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

/* WHAT A ROLE MAY ACTUALLY DO TO THE TABLE, in privilege words rather than ACL
   letters. Prefers the measurement the catalogue took with has_table_privilege
   and has_any_column_privilege; falls back to parsing relacl when the catalogue
   predates it, and UNIONS the two when both are present so the fallback can only
   ever add a privilege, never remove one.

   The two are different facts, and the difference has already been paid for
   twice. relacl cannot see a COLUMN-level grant: production's workflow_registry
   names only postgres and service_role in relacl while seven of its columns
   carry authenticated=r, and CLAUDE.md records the same shape on
   policy_platform_attestation with the note that this gate's own
   l2AuthenticatedAclLetters reports it as service_role-only. It also cannot see
   a privilege held through role membership. An exemption that rests on "the
   grant is not written here" rests on the mechanism; what it claims is about the
   effect.

   Returns { verbs, witness, unknown }. unknown is TRUE when neither source
   carries evidence, which is not the same as "no privileges" and must never be
   read as one. */
const L2_WRITE_VERBS = {
  INSERT: 'INSERT', UPDATE: 'UPDATE', DELETE: 'DELETE',
  TRUNCATE: 'TRUNCATE (which no policy filters)',
};
function l2WritePrivileges(p, role) {
  const measured = p && p[role === 'anon' ? 'anon_privs' : 'auth_privs'];
  const fromMeasured = Array.isArray(measured)
    ? measured.map(v => String(v).toUpperCase()).filter(v => L2_WRITE_VERBS[v])
    : null;
  const letters = role === 'anon' ? null : l2AuthenticatedAclLetters(p && p.table_acl);
  const fromAcl = letters === null ? null
    : [...letters].map(ch => ({ a: 'INSERT', w: 'UPDATE', d: 'DELETE', D: 'TRUNCATE' })[ch]).filter(Boolean);
  if (fromMeasured === null && fromAcl === null) return { verbs: [], witness: null, unknown: true };
  const verbs = [...new Set([...(fromMeasured || []), ...(fromAcl || [])])].sort();
  const witness = fromMeasured && fromAcl
    ? 'has_table_privilege / has_any_column_privilege, cross-checked against relacl'
    : fromMeasured ? 'has_table_privilege / has_any_column_privilege'
    : 'relacl text only — this catalogue predates the measured privilege, so a column-level grant or one held through role membership is not visible to this run';
  return { verbs, witness, unknown: false };
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
  const authW = l2WritePrivileges(p, 'authenticated');
  const anonW = l2WritePrivileges(p, 'anon');
  const anonReads = Array.isArray(p && p.anon_privs) && p.anon_privs.map(String).includes('SELECT');
  const wideRoles = roles ? roles.filter(r => r === 'anon' || r.toLowerCase() === 'public') : [];
  const writes = authW.verbs.map(v => L2_WRITE_VERBS[v]);
  const anonWrites = anonW.verbs.map(v => L2_WRITE_VERBS[v]);

  if (!named) {
    /* The ordinary failure: an open policy nobody has accepted. Say what is
       true about the table so the reader can judge the severity, and say
       plainly that having the right shape is not an exemption. */
    /* SAY WHICH WITNESS FIRED. The line used to read "USING(true)" whatever the
       expression actually was, which stopped being true the moment the catalogue
       started catching a predicate that admits every row without saying `true`. */
    const witness = p && p.open_witness ? String(p.open_witness) : 'the policy expression is the literal true';
    let line = `${table}/${policy}: ${cmd || '(cmd unknown)'} for ${roles ? roles.join(',') : '(roles unknown)'}, admitting every row — ${witness}`;
    line += hasTenantId === true
      ? ' — and this table HAS a tenant_id column, so a USING(true) policy on it crosses dealerships'
      : hasTenantId === false ? ' — the table carries no tenant_id column' : ' — whether it has a tenant_id column is not in this catalogue';
    if (fkReferent === true) line += ' — AND a tenant_id foreign key points at it, so it is the tenant dimension itself';
    if (wideRoles.length) line += ` — AND ${wideRoles.join(' and ')} is in its roles`;
    if (writes.length) line += ` — AND authenticated holds ${writes.join(', ')} on the table`;
    /* When relacl and the measured privilege disagree, print BOTH. The gap is
       the finding: workflow_registry names nobody but postgres and service_role
       in relacl and grants authenticated seven of its columns, and every
       relacl-only sweep this project has run — including this file's own, until
       5 Sep 2026 — called that table service_role-only. */
    if (Array.isArray(p && p.auth_privs)) {
      const aclSaid = l2AuthenticatedAclLetters(p && p.table_acl);
      if (p.auth_privs.length && (aclSaid === null || aclSaid === ''))
        line += ` — NOTE: relacl names no privilege for authenticated ("${String(p.table_acl).replace(/\n/g, ' | ')}") and authenticated nevertheless holds ${p.auth_privs.join(', ')}, measured with has_table_privilege / has_any_column_privilege. A column-level grant is invisible to relacl; read the ACL alone and this table looks service_role-only`;
    }
    if (anonWrites.length) line += ` — AND anon holds ${anonWrites.join(', ')} on it`;
    else if (anonReads) line += ' — AND anon holds SELECT on it (a privilege, not necessarily reachability: anon holds no USAGE on schema public today, and that door — not this ACL — is what contains it)';
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
  if (authW.unknown) unknown.push('this catalogue carries neither a measured privilege nor an ACL for the table, so what authenticated may write to it is unknown');
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
    `exempt by name, but authenticated now holds ${writes.join(', ')} on the table — witness: ${authW.witness}; relacl reads "${String(p.table_acl).replace(/\n/g, ' | ')}" — the exemption was granted to a read-only grant`);
  if (anonWrites.length) broke.push(
    `exempt by name, but anon now holds ${anonWrites.join(', ')} on the table — the exemption was granted to a policy only signed-in staff could use, and a write privilege for the unauthenticated role is not a deviation anyone accepted here`);

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

  /* L1 · FRESHNESS IN VERSIONS, NOT IN HOURS.
     ─────────────────────────────────────────
     This check used to have exactly two outcomes: the column maps differ (FAIL)
     or they do not (PASS). The second is where it went wrong, twice in two days,
     and both times the clock said everything was fine.

       · 5 Sep 2026, 20:56:16Z — a catalogue was read from production and the
         snapshot was refreshed from it. Minutes old, and L1 was green. At
         21:14, EIGHTEEN MINUTES LATER, migration 20260905211435 added
         `language_key` and `waba_key` to whatsapp_templates. The snapshot was
         then wrong, and by every clock in this file it was fresh.
       · CLAUDE.md records the same failure from the other end: a catalogue
         23.92 hours old passed the 24-hour tolerance and produced a full live
         verdict for a database with 60 functions where live had 110. It calls
         that tolerance "a fuse, not a lock", and it is right.

     Age is a proxy, and it is a bad one in both directions — eighteen minutes
     was too long and 23.92 hours was accepted. The fact that actually decides
     whether a reading still describes the database is whether the MIGRATION
     HISTORY has moved since it was taken. That is discrete, it is recorded by
     Supabase itself, and it cannot drift silently the way a clock can.

     So the catalogue now carries the head of supabase_migrations.schema_migrations
     (see migration_history in CATALOGUE_SQL), --refresh-schema copies it into
     the snapshot, and this check has THREE outcomes rather than two:

         a column map differs                      -> FAIL   (as before)
         no difference, and the two anchors agree  -> PASS
         no difference, and they do not, or either
           side carries no anchor at all           -> NOT RUN

     The third case is the repair. A matching column map across two different
     migration heads proves only that the migrations in between did not happen
     to touch a column list — they may have changed a policy, a grant, a
     function body or a constraint, all of which the offline lanes read out of
     this same snapshot. "I cannot establish that this is current" is the true
     answer there, and NOT RUN is the word this file uses for it.

     It can only ever move a PASS to NOT RUN. A demonstrated difference is still
     a FAIL, which is the stricter verdict and stays first. */
  {
    const bad = [];
    for (const [rel, cols] of Object.entries(c.relations)) {
      const snap = SNAPSHOT.relations[rel];
      if (!snap) bad.push(`live has "${rel}" and the snapshot does not`);
      else if (snap !== cols) {
        const a = new Set(String(snap).split(',')), b = new Set(String(cols).split(','));
        const added = [...b].filter(x => !a.has(x)), gone = [...a].filter(x => !b.has(x));
        bad.push(`"${rel}" columns differ between live and the snapshot`
          + (added.length ? ` — live has ${added.join(', ')} and the snapshot does not` : '')
          + (gone.length ? ` — the snapshot has ${gone.join(', ')} and live does not` : '')
          + (added.length || gone.length ? '' : ' — the same column names in a different order'));
      }
    }
    for (const rel of Object.keys(SNAPSHOT.relations)) if (!c.relations[rel]) bad.push(`the snapshot has "${rel}" and live does not`);

    const mh = c.migration_history;
    const catHead  = mh && mh.readable && mh.head != null ? String(mh.head) : null;
    const snapHead = SNAPSHOT.migration && SNAPSHOT.migration.head != null ? String(SNAPSHOT.migration.head) : null;
    const relN = Object.keys(c.relations).length;
    const anchorLines = [
      catHead ? `the catalogue was read at migration ${catHead}, with ${mh.count} recorded` : 'the catalogue carries no migration anchor',
      snapHead ? `the snapshot is anchored to migration ${snapHead}${SNAPSHOT.migration.count ? `, with ${SNAPSHOT.migration.count} recorded` : ''}` : 'the snapshot carries no migration anchor',
    ];
    const WHY_ANCHOR = 'A matching column map is not evidence of currency. The snapshot taken 2026-09-05T20:56:16Z matched its own catalogue exactly and was already eighteen minutes short of migration 20260905211435, which added two columns to whatsapp_templates; the run before that accepted a catalogue 23.92 hours old for a database whose function count had nearly doubled. Time is the wrong witness — the migration head is the right one.';

    if (bad.length) {
      FAIL('L1', LANE.LIVE, 'P0', LIVE_CHECKS[0][1], bad.concat(anchorLines).concat([
        'run --refresh-schema; a snapshot that drifts is how this gate started producing false failures']));
    } else if (!catHead) {
      NOTRUN('L1', LANE.LIVE, 'P0', LIVE_CHECKS[0][1],
        `${relN} relations were compared column by column and every one matches, but ${mh ? `this catalogue could not read supabase_migrations.schema_migrations (${mh.why || 'no reason recorded'})` : 'this catalogue carries no migration_history key at all, so it predates the version anchor'}. ${WHY_ANCHOR} Re-dump the catalogue with the SQL --print-sql emits.`);
    } else if (!snapHead) {
      NOTRUN('L1', LANE.LIVE, 'P0', LIVE_CHECKS[0][1],
        `${relN} relations were compared column by column and every one matches, and the catalogue was read at migration ${catHead} — but the embedded snapshot carries no migration anchor, so nothing says which migration history IT describes. ${WHY_ANCHOR} Run --refresh-schema against a source that can read supabase_migrations.schema_migrations.`);
    } else if (snapHead !== catHead) {
      const behind = snapHead < catHead;
      NOTRUN('L1', LANE.LIVE, 'P0', LIVE_CHECKS[0][1],
        `${relN} relations were compared column by column and every one matches, but the two readings are anchored to different migration heads: the snapshot to ${snapHead} and the catalogue to ${catHead}. `
        + (behind
            ? `The database moved on after the snapshot was taken, and the migrations in between did not happen to change a column list this check compares — they may still have changed a policy, a grant, a function body or a constraint, all of which the offline lanes read out of this same snapshot. `
            : `The snapshot is anchored AHEAD of the catalogue, so the catalogue is the older reading and is not a live witness for anything. `)
        + `${WHY_ANCHOR} Run --refresh-schema against a catalogue read at ${catHead} or later.`);
    } else {
      PASS('L1', LANE.LIVE, 'P0', LIVE_CHECKS[0][1], [
        `${relN} relations, identical to the snapshot column for column`,
        `both readings are anchored to the same migration head, ${catHead} — the snapshot describes the migration history the catalogue was taken from, which is the fact a clock cannot establish`,
        `snapshot taken ${SNAPSHOT.takenAt}; catalogue taken ${c.takenAt}`,
        mh.newest ? `the five newest migrations at that head: ${mh.newest}` : 'the catalogue records no migration list',
        'This PASS says the snapshot matches THIS catalogue. Whether the catalogue itself is still current is L13.',
      ]);
    }
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
    /* HOW THIS CATALOGUE DECIDED A POLICY WAS OPEN.
       Until 6 Sep 2026 arm 2 read a list built by asking whether the policy
       expression was the literal string `true`. CLAUDE.md names that as one of
       three P0s resting on a token, and it is measured rather than feared:
       `USING (1=1)` is stored as `(1 = 1)` and `USING (NOT false)` as
       `(NOT false)` — Postgres does not fold either into `true` — so a policy
       admitting every row of a tenant-owned table was invisible to this check.
       The catalogue now decides openness by asking Postgres: does the parse tree
       reference a column of the row, and if it does not, what does the
       expression evaluate to. `policy_openness_test` marks a catalogue built
       that way.

       A catalogue built the old way is not distinguishable from a new one by its
       contents, so this check will not report PASS on it. It can still FAIL on
       it — the old list is a subset of the new one, so anything it names is
       genuinely open — but "no open policy" from a detector that cannot see
       `1=1` is exactly the false green this file exists to refuse. */
    const opennessReal = c.policy_openness_test === 'unconditional-evaluated';
    const l2bad = (c.tables_no_rls || []).map(t => `${t}: RLS is off`).concat(failures);
    const l2ev = [`${(c.tables_no_rls || []).length} tables without RLS`,
       `${pols.length} policies in public admit every row for a role other than service_role; ${exempted.length} are exempt and ${failures.length} are not`,
       opennessReal
         ? 'openness was decided by Postgres, not by a string match: a policy counts as open when its expression is the literal true, OR when its parse tree references no column of the table (no {VAR node) and Postgres evaluates the expression to TRUE. Measured on staging inside a DO block that ended in RAISE EXCEPTION, so nothing persisted: USING (true) and USING (\'t\'::boolean) both store as `true` and were already caught; USING (1=1) stores as `(1 = 1)` and USING (NOT false) as `(NOT false)`, and both were invisible to the old test and are caught by this one. On production the two tests return the same 12 policies — 0 gained, 0 lost — so this changes nothing on today\'s board and closes the hole for tomorrow\'s.'
         : 'WARNING: this catalogue does not state how its open-policy list was built, so it was built by the literal-string test, which cannot see USING (1=1) or USING (NOT false).',
       exempted.length
         ? `exempt, each by NAME and each re-measured against this catalogue as SELECT-only, no anon or PUBLIC in its roles, no tenant_id column, not the referent of any tenant_id foreign key, and neither authenticated nor anon able to INSERT, UPDATE, DELETE or TRUNCATE it — that last pair measured with has_table_privilege and has_any_column_privilege rather than read out of relacl, which cannot see a column-level grant: ${exempted.sort().join(', ')}`
         : 'no policy was exempted',
       'The exemption list is hand-written in this file ON PURPOSE, and it is the one list here that should be. Every other list in this gate describes what the database CONTAINS, which goes stale and must be derived. This one records which deliberate deviations the owner accepts — a decision, not a description — and a decision must not be derived from the database, because the database is the thing under audit. Derive it and the check cannot fail: anyone with DDL writes USING(true) on a new table and it exempts itself, with no diff that mentions a grant or a policy. So the name is written down, matched exactly rather than by substring, and it only counts while the five properties above still measure true; when one stops, the table fails with a sentence naming what changed.'];
    if (l2bad.length) FAIL('L2', LANE.LIVE, 'P0', LIVE_CHECKS[1][1], l2bad.concat(l2ev));
    else if (!opennessReal) NOTRUN('L2', LANE.LIVE, 'P0', LIVE_CHECKS[1][1],
      `${(c.tables_no_rls || []).length} tables have RLS off and ${failures.length} open policies are unaccounted for — nothing failed. But this catalogue carries no policy_openness_test marker, so its open-policy list was built by asking whether the expression is the literal string "true", and a list built that way cannot contain USING (1=1) or USING (NOT false): measured on staging 6 Sep 2026, Postgres stores those as "(1 = 1)" and "(NOT false)" and does not fold either. "No open policy" from a detector blind to the shape it is looking for is not a pass. Re-dump the catalogue with the SQL --print-sql emits.`);
    else PASS('L2', LANE.LIVE, 'P0', LIVE_CHECKS[1][1], l2ev);
    /* A policy that reads no column of the row but that this gate declined to
       evaluate. It is not open — nothing here says it is — and it is not clean
       either: it filters nothing by the row's content, and whatever it does
       filter by, this run did not establish. The fence is deliberate (no
       function of ours is called and no subquery is run to satisfy a check), so
       the honest place for these is a named WARN rather than either verdict.
       Production and staging both hold zero of them today. */
    const undec = c.policy_undecidable;
    if (Array.isArray(undec) && undec.length)
      WARN('L2c', LANE.LIVE, 'P1', 'A policy filters nothing by the row, and the gate declined to evaluate what it does filter by',
        undec.map(u => `${u.table}/${u.policy}: ${String(u.cmd || '(cmd unknown)')} for ${Array.isArray(u.roles) ? u.roles.join(',') : String(u.roles)} — the expression references no column of the table, so it admits or refuses every row alike, and it calls a function or runs a subquery, so this check would not evaluate it: ${u.expr}`)
        .concat(['Decide it by hand. A predicate with no column reference has exactly two outcomes for the whole table, and which one it takes may depend on the session rather than the row — that is a per-caller switch, not a tenant filter.']));
    if (stale.length) WARN('L2b', LANE.LIVE, 'P1', 'A name in the L2 exemption map no longer matches any open policy',
      stale.map(n => `${n}: named as an accepted deviation, but no USING(true) policy on it exists in this catalogue — either its policy was scoped (good: delete the name) or the table is gone`).concat([
        'Not exposure — an exemption that exempts nothing cannot open anything. It is rot, and rot in this map is how the old regex came to exempt three tables nobody had thought about since the engines shipped.']));
  }
  /* L3 · THE VALUE OF THE OPTION, NOT ITS PRESENCE. The list this reads is now
     built by testing what security_invoker is SET TO; see the long note beside
     views_no_invoker in CATALOGUE_SQL for what it used to test and why a view
     created "with (security_invoker = false)" passed.

     A catalogue dumped before that fix carries a list produced by the substring
     test, and nothing in the file distinguishes the two. Reporting PASS on it
     would be reporting a result whose meaning is unknown, so this check reports
     NOT RUN instead — the same rule the rest of this file is held to. */
  {
    const test = c.views_invoker_test;
    if (test !== 'boolean-value') {
      NOTRUN('L3', LANE.LIVE, 'P0', LIVE_CHECKS[2][1],
        `this catalogue does not state how views_no_invoker was computed (views_invoker_test is ${JSON.stringify(test === undefined ? null : test)}). Until 5 Sep 2026 the gate asked whether the reloptions string CONTAINED "security_invoker", which a view created "with (security_invoker = false)" does — so a list built that way excludes exactly the views this check exists to catch, and cannot be told apart from a list built by reading the value. Re-dump the catalogue with the SQL --print-sql emits.`);
    } else {
      verdict('L3', LANE.LIVE, 'P0', LIVE_CHECKS[2][1],
        (c.views_no_invoker || []).map(v => `${v}: security_invoker is absent or not true — RLS on its base tables is evaluated as the view owner, not as the caller`),
        [`every view in public carries security_invoker with a TRUE value; the test parses the option out of reloptions and accepts true/on/1/yes, because Postgres stores what was written and production holds both "true" (38 views) and "on" (v_competitor_latest)`,
         'this asserts the option is SET, not that it is merely mentioned — the previous substring test passed a view created with (security_invoker = false)']);
    }
    const mv = c.rls_incapable_relations;
    if (Array.isArray(mv) && mv.length)
      WARN('L3b', LANE.LIVE, 'P1', 'A relation exists in public that RLS cannot protect at all',
        mv.map(v => `${v}: a materialized view — it reads its base tables as its owner, no policy applies to it, and it carries no security_invoker option for L3 to inspect`).concat([
          'This is the exposure L3 forbids, in the one shape L3 structurally cannot see. Establish what it selects from before treating it as reportable data.']));
  }
  /* L4 · the shape CLAUDE.md says has opened a hole three times, plus the
     stronger form: a definer function granted to authenticated whose body
     writes without a tenant predicate is a cross-tenant write. */
  {
    const bad = [];
    let l4cand = 0, l4stmts = 0, l4chars = 0;
    for (const f of c.functions || []) {
      const acl = f.acl || '';
      /* MEASURED reachability first. The regexes are the fallback for a
         catalogue dumped before exec_auth existed, and they are kept because a
         missing input must degrade to the stricter reading, not to silence:
         they already matched the PUBLIC entry ("=X"), which L5's did not. */
      const toAuth = typeof f.exec_auth === 'boolean'
        ? f.exec_auth
        : (/(^|[|\s])authenticated=X/.test(acl) || /(^|[|\s])=X/.test(acl));
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
    /* WHY THIS IS NOT A REGEX ANY MORE. The filter was /anon=X/ — the presence
       of a grant written to anon by name. anon also inherits every PUBLIC grant,
       whose ACL entry has an empty grantee and reads "=X/postgres", and it can
       hold EXECUTE through role membership; neither matches. CLAUDE.md records
       this as a known blindness in L5 ("a future CREATE OR REPLACE adding
       SECURITY DEFINER to it would be invisible"), and on production 5 Sep 2026
       it is measured, not predicted: /anon=X/ matched 0 functions and
       has_function_privilege('anon', …, 'EXECUTE') matched 1 —
       nexus_public_exposure_report, held through "=X/postgres". So the check now
       asks whether anon CAN execute the function. The regex survives only as the
       fallback for an older catalogue, widened to include the PUBLIC entry so
       that the fallback is the stricter reading rather than the blinder one. */
    const anonExec = f => typeof f.exec_anon === 'boolean'
      ? f.exec_anon
      : (/(^|[|\s])anon=X/.test(f.acl || '') || /(^|[|\s])=X/.test(f.acl || ''));
    const anonWitness = (c.functions || []).some(f => typeof f.exec_anon === 'boolean')
      ? 'has_function_privilege(anon, …, EXECUTE), which sees a direct grant, a PUBLIC grant and one held through role membership'
      : 'the ACL text of each function — this catalogue predates the measured grant, so a grant reachable only through role membership is not visible to this run';
    const anonAll = (c.functions || []).filter(anonExec);
    const anonFns = anonAll.filter(f => READS.test(String(f.body || '')));
    const holes = anonFns.filter(f => f.secdef).map(f => `${f.name}: SECURITY DEFINER, anon holds EXECUTE, and the body reads a tenant-owned table with RLS bypassed`);
    verdict('L5', LANE.LIVE, 'P0', LIVE_CHECKS[4][1], holes,
      [`${anonAll.length} of ${(c.functions || []).length} functions in public are EXECUTABLE by anon; ${anonFns.length} of those have a body that reads a tenant-owned table`,
       `witness: ${anonWitness}`,
       anonAll.length === 0
         ? 'This passes because anon can execute nothing here, not because a grant was inspected and found harmless — which is the strongest form this result takes, and the one the 2 Sep revocation was aiming at.'
         : `no SECURITY DEFINER function anon can execute reads tenant-owned data; the ${anonAll.length} anon can execute are: ${anonAll.map(f => f.name).sort().join(', ')}`,
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
  /* L10 · this counts ROWS. Its evidence line used to end "the CHECK
     inventory_actions_recovered_needs_real_sale holds", which is a claim about
     the CONSTRAINT — a different fact, and one it had not read. Zero bad rows is
     exactly what a table with the constraint dropped this morning looks like.
     The constraint is now selected in the same catalogue and reported for what
     it is: the row count is the symptom, the constraint is the guarantee. */
  {
    const guard = c.recovered_value_guard;
    const guarded = Array.isArray(guard) && guard.length > 0;
    verdict('L10', LANE.LIVE, 'P0', LIVE_CHECKS[9][1],
      c.bad_recovered ? [`${c.bad_recovered} inventory_actions rows claim a recovered value with no attributed sale behind them`] : [],
      [`${c.bad_recovered} rows carry a recovered_value_aed without the four columns an attributed sale requires`,
       Array.isArray(guard)
         ? (guarded
             ? `the CHECK constraint behind it is present and reads: ${guard.map(g => `${g.name} ${g.def}`).join(' ; ')}`
             : 'AND NO CHECK constraint on inventory_actions mentions recovered_value_aed — see L10b')
         : 'this catalogue does not carry the constraint, so this run measured the rows only and says nothing about whether the guarantee is still structural']);
    if (Array.isArray(guard) && !guarded)
      WARN('L10b', LANE.LIVE, 'P1', 'The row count is clean and the constraint that keeps it clean is gone',
        ['no CHECK constraint on public.inventory_actions mentions recovered_value_aed',
         `${c.bad_recovered} rows violate the rule today, so nothing is wrong on the screen yet — but the next write is unpoliced, and L10 counts rows, which is the symptom rather than the guarantee`,
         'CLAUDE.md names this constraint (inventory_actions_recovered_needs_real_sale) as the reason a fabricated recovered value is unstorable. Restore it before the next release.']);
  }
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

/* ══════════════════════════════════════════════════════════════════════════
   THE SIGNED-IN CALLER — why this exists and what it is allowed to touch
   ──────────────────────────────────────────────────────────────────────────
   B1..B3 are assertions about what Postgres does WITH A CALLER, and until
   6 September 2026 this gate had no way to be one. The psql probes above set
   `request.jwt.claims` and `role` with set_config(). That is how PostgREST
   PRESENTS a JWT to Postgres, and it is not a signed JWT that travelled
   through PostgREST: it skips GoTrue, the anon key, the API gateway, PostgREST's
   own role switch and its own query construction. The two-tenant proof
   (two-tenant-proof-2026-09-06.md §8.4) stops at exactly that line and records
   B3 as NOT RUN for exactly that reason. So does VERSIONS.md.

   This lane closes it by signing in. It calls GoTrue's password grant, holds
   the real access token, and makes every subsequent call as an ordinary REST
   client with `apikey` and `Authorization: Bearer` — the same two headers the
   dashboard sends. Nothing here sets a GUC and nothing here holds a Postgres
   role.

   WHAT IT MAY WRITE, AND WHERE. B1 and B2 are state changes by definition, and
   over HTTP there is no transaction to roll back — so this lane writes, and
   what it writes persists. That is only acceptable on a fixture database, and
   four things have to be true at once before a single write is attempted:

     1. NEXUS_STAGING_REST_URL is set by name. The variable that may point at
        production is NEXUS_LIVE_URL, and this lane never reads it for a write.
     2. That URL's Supabase project ref differs from NEXUS_DB_URL's and from
        NEXUS_LIVE_URL's. Two spellings of one project are refused.
     3. Every identity signs in. Production carries one user, who is an
        approver; it has no non-approver and no member of a second dealership,
        so the credentials themselves cannot exist there.
     4. MEASURED, not configured: the "other dealership" identity must resolve
        — through action_approver_context(), as itself — to a DIFFERENT
        dealership from the approver. A single-dealership database cannot
        satisfy this, and production is a single-dealership database. This is
        the guard that does not depend on somebody naming a variable correctly.

   If any of those is not true the lane writes nothing and says which one.

   WHAT IT LEAVES BEHIND. It creates one inventory unit (`GATE-PROBE-<ms>`) on
   the approver's dealership and proposes one action against it, then decides
   that action. The rows persist: the unit, the action, and the audit and event
   rows the decision path writes. Every gate run re-uses a `GATE-PROBE-%` action
   that is still PROPOSED and only creates a new one when there is none, so the
   residue does not grow once per run unless a run is interrupted. The exact
   ids are printed in the evidence, and the removal statement is printed with
   them, because a fixture nobody can find is litter.
   ══════════════════════════════════════════════════════════════════════════ */

const SIGNED_IDENTITIES = [
  ['approver',    'NEXUS_STAGING_APPROVER_EMAIL',    'NEXUS_STAGING_APPROVER_PASSWORD',    'an account this dealership\'s own policy admits as an approver'],
  ['approver2',   'NEXUS_STAGING_APPROVER2_EMAIL',   'NEXUS_STAGING_APPROVER2_PASSWORD',   'a SECOND approving account, so B2 can tell a double-click from another person overturning a decision'],
  ['nonapprover', 'NEXUS_STAGING_NONAPPROVER_EMAIL', 'NEXUS_STAGING_NONAPPROVER_PASSWORD', 'an account at the SAME dealership whose role the policy does not admit'],
  ['other',       'NEXUS_STAGING_OTHER_EMAIL',       'NEXUS_STAGING_OTHER_PASSWORD',       'an account at a DIFFERENT dealership'],
];

/* A Supabase project ref, from either spelling of its hostname. Two URLs can
   name one project three ways; the ref is the part that cannot be spelled
   differently. */
const projectRef = u => {
  try {
    const h = new URL(String(u).replace(/^postgres(ql)?:/, 'http:')).hostname.toLowerCase();
    const p = h.split('.');
    if (p.length < 3) return '';
    return (p[0] === 'db' || p[0].startsWith('aws-')) ? p[1] : p[0];
  } catch { return ''; }
};

async function resolveSignedCaller() {
  const url  = (process.env.NEXUS_STAGING_REST_URL || '').replace(/\/+$/, '');
  const anon = process.env.NEXUS_STAGING_ANON_KEY || '';
  const missing = [];
  if (!url)  missing.push('NEXUS_STAGING_REST_URL');
  if (!anon) missing.push('NEXUS_STAGING_ANON_KEY');
  for (const [name, e, p, what] of SIGNED_IDENTITIES)
    if (!process.env[e] || !process.env[p]) missing.push(`${e} + ${p} (${what})`);
  if (missing.length)
    return { why: `no signed-in caller is configured. Missing: ${missing.join('; ')}. Set them to a STAGING Supabase project carrying this schema and two dealerships, and these checks sign in through GoTrue and call PostgREST as those accounts` };

  const ref = projectRef(url);
  for (const [varName, other] of [['NEXUS_DB_URL', process.env.NEXUS_DB_URL], ['NEXUS_LIVE_URL', process.env.NEXUS_LIVE_URL]]) {
    if (!other) continue;
    if (projectRef(other) && projectRef(other) === ref)
      return { why: `NEXUS_STAGING_REST_URL and ${varName} name the same Supabase project (${ref}) — refusing to sign in and write against the database this gate is told is production` };
  }

  const who = {};
  for (const [name, e, p] of SIGNED_IDENTITIES) {
    const email = process.env[e], password = process.env[p];
    let token;
    try {
      const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await r.text();
      if (!r.ok) return { why: `signing in as ${email} (${e}) was refused with HTTP ${r.status}: ${body.slice(0, 200)}` };
      token = JSON.parse(body).access_token;
    } catch (err) { return { why: `signing in as ${email} (${e}) could not reach ${url}: ${String(err.message || err)}` }; }
    if (!token) return { why: `signing in as ${email} (${e}) succeeded and returned no access_token` };
    /* The claim this lane cares about, read from the token itself rather than
       taken on trust: a token whose role is not `authenticated` would exercise
       something other than a dealership session. */
    let claims = {};
    try { claims = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')); } catch {}
    if (claims.role !== 'authenticated')
      return { why: `the token GoTrue issued for ${email} carries role "${claims.role}" rather than "authenticated" — this lane exercises a dealership session and nothing else` };
    who[name] = { name, email, token, sub: claims.sub || null };
  }

  const S = {
    url, anon, ref, who,
    rest: async (id, path, opts = {}) => {
      const r = await fetch(`${url}/rest/v1/${path}`, {
        ...opts,
        headers: { apikey: anon, Authorization: `Bearer ${who[id].token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
      });
      const t = await r.text();
      let body; try { body = JSON.parse(t); } catch { body = t; }
      return { status: r.status, body, text: t };
    },
  };
  S.rpc   = (id, fn, args = {}) => S.rest(id, `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  S.count = async (id, path) => {
    const r = await S.rest(id, path.includes('select=') ? path : `${path}${path.includes('?') ? '&' : '?'}select=id`);
    return Array.isArray(r.body) ? r.body.length : null;
  };

  /* Each identity says who it is, through the same function the Action Center
     asks. Nothing below is taken from the variable names. */
  for (const name of Object.keys(who)) {
    const c = await S.rpc(name, 'action_approver_context');
    if (c.status !== 200 || !Array.isArray(c.body) || !c.body.length)
      return { why: `action_approver_context() answered HTTP ${c.status} for ${who[name].email}: ${String(c.text).slice(0, 200)}` };
    Object.assign(who[name], c.body[0]);
  }

  const ap = who.approver, na = who.nonapprover, ot = who.other;
  S.notes = [];
  if (ap.may_decide !== true)
    S.notWritable = `the account named by NEXUS_STAGING_APPROVER_EMAIL (${ap.email}) is not an approver — action_approver_context() answered may_decide=${ap.may_decide}, refusal_code=${ap.refusal_code}. B1 and B2 need one decision that is allowed to succeed`;
  else if (who.approver2.may_decide !== true)
    S.notWritable = `the account named by NEXUS_STAGING_APPROVER2_EMAIL (${who.approver2.email}) answered may_decide=${who.approver2.may_decide} — B2's last arm needs a SECOND account that may approve`;
  else if (who.approver2.tenant_id !== ap.tenant_id)
    S.notWritable = `the two approver accounts are at different dealerships (${short(ap.tenant_id)} and ${short(who.approver2.tenant_id)}) — B2's arms have to arrive at one action`;
  else if (na.tenant_id !== ap.tenant_id)
    S.notWritable = `the non-approver (${na.email}) is at dealership ${short(na.tenant_id)} and the approver at ${short(ap.tenant_id)} — B1 refuses somebody who is a member of the SAME dealership and merely lacks the role; a stranger is a different check`;
  else if (na.may_decide !== false)
    S.notWritable = `the account named by NEXUS_STAGING_NONAPPROVER_EMAIL (${na.email}) MAY decide — action_approver_context() answered may_decide=true, so there is no non-approver here for Postgres to refuse`;
  else if (!ot.tenant_id || ot.tenant_id === ap.tenant_id)
    S.notWritable = `the account named by NEXUS_STAGING_OTHER_EMAIL (${ot.email}) resolves to dealership ${short(ot.tenant_id)}, the same one as the approver — this database has one dealership as far as these credentials can see, which is what production looks like, so this lane will not write to it`;
  S.writable = !S.notWritable;
  S.ok = true;
  return S;
}
const SIGNED = await resolveSignedCaller();

/* The census this lane reports is measured through the callers themselves, on
   the database it is actually probing — never carried over from the production
   catalogue the L lane reads. */
const signedCensus = () => !SIGNED.ok ? [] : [
  `signed in through ${SIGNED.url}/auth/v1 (Supabase project ${SIGNED.ref}) as ${Object.keys(SIGNED.who).length} real accounts, each holding a JWT GoTrue issued: `
    + Object.values(SIGNED.who).map(w => `${w.email} → dealership ${short(w.tenant_id)}, account role ${w.tenant_role}${w.staff_role ? ` (job title ${w.staff_role})` : ' (no staff row)'}, may_decide=${w.may_decide}${w.refusal_code ? ` (${w.refusal_code})` : ''}`).join('; '),
  `every call below carries apikey + Authorization: Bearer and travels through PostgREST — no set_config('request.jwt.claims'), no set_config('role'), no Postgres role held by this gate`,
];

/* The fixture. Created once per gate run, shared by B1 and B2, and reported. */
let SIGNED_FIXTURE = null;
async function signedFixture() {
  if (SIGNED_FIXTURE) return SIGNED_FIXTURE;
  if (!SIGNED.ok || !SIGNED.writable) return (SIGNED_FIXTURE = { ok: false, why: SIGNED.notWritable || SIGNED.why });
  const t = SIGNED.who.approver.tenant_id;
  /* Re-use before creating: an interrupted run leaves a PROPOSED probe action,
     and proposing a second one would grow the fixture once per failure. */
  const open = await SIGNED.rest('approver', 'inventory_actions?select=id,unit_id,status&status=eq.PROPOSED&unit_id=like.GATE-PROBE-*&order=created_at');
  if (open.status === 200 && Array.isArray(open.body) && open.body.length)
    return (SIGNED_FIXTURE = { ok: true, unit: open.body[0].unit_id, action: open.body[0].id, created: false,
      note: `re-used the PROPOSED probe action ${open.body[0].id} on unit ${open.body[0].unit_id}, left by an earlier run` });

  const unit = `GATE-PROBE-${Date.now()}`;
  const acquired = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const ins = await SIGNED.rest('approver', 'inventory', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      id: unit, model: 'Quality gate probe unit', vin: `GATEPROBE${Date.now()}`,
      status: 'Available', price_aed: 100000, cost_aed: 95000, acquired_at: acquired, tenant_id: t,
    }),
  });
  if (ins.status !== 201)
    return (SIGNED_FIXTURE = { ok: false, why: `the signed-in approver could not create a probe unit on its own dealership: HTTP ${ins.status} ${String(ins.text).slice(0, 200)}` });

  const prop = await SIGNED.rpc('approver', 'action_propose', { p_unit_id: unit });
  const pr = Array.isArray(prop.body) ? prop.body[0] : null;
  if (prop.status !== 200 || !pr || pr.ok !== true || !pr.action)
    return (SIGNED_FIXTURE = { ok: false, why: `action_propose() did not raise an action for probe unit ${unit}: HTTP ${prop.status} ${String(prop.text).slice(0, 300)}` });
  if (pr.action.status !== 'PROPOSED')
    return (SIGNED_FIXTURE = { ok: false, why: `action_propose() returned an action already in ${pr.action.status}, so there is no undecided action for B1 and B2 to act on` });
  return (SIGNED_FIXTURE = { ok: true, unit, action: pr.action.id, created: true,
    note: `created probe unit ${unit} (400 days in stock, AED 100,000 list against AED 95,000 cost, so the engine recommends ${pr.action.recommendation}) and proposed action ${pr.action.id}` });
}
/* One fixture unit and one action are left per COMPLETED run, and that is a
   consequence of the product's own rule rather than of this lane being untidy:
   action_propose() treats an APPROVED action as still open, so the same unit
   cannot be re-proposed, and cancelling it instead puts the unit under
   inventory_action_policy.reproposal_cooldown_days. So the honest answer is to
   name the residue and hand over the statement that sweeps ALL of it. */
const fixtureResidue = F => `THIS ARM WROTE TO ${SIGNED.url} AND THE ROWS PERSIST — there is no transaction to roll back over HTTP. Left behind by this run: unit ${F.unit}, action ${F.action}, and the audit and event rows the decision path wrote; a completed run leaves one of each, because an APPROVED action blocks re-proposal of its unit and a CANCELLED one starts a re-proposal cooldown. Remove every gate fixture with: delete from public.inventory_action_events where action_id in (select id from public.inventory_actions where unit_id like 'GATE-PROBE-%'); delete from public.audit_log where summary like '%unit GATE-PROBE-%'; delete from public.inventory_actions where unit_id like 'GATE-PROBE-%'; delete from public.inventory where id like 'GATE-PROBE-%'; -- audit_log carries no action_id column; action_write_audit() puts the unit id in the summary, and that is the only handle on those rows.`;

/* ── B1, through the signed-in caller ───────────────────────────────────── */
async function b1Signed() {
  if (!SIGNED.ok) return { notrun: SIGNED.why };
  if (!SIGNED.writable) return { notrun: SIGNED.notWritable };
  const F = await signedFixture();
  if (!F.ok) return { notrun: F.why };

  const ap = SIGNED.who.approver, na = SIGNED.who.nonapprover, t = ap.tenant_id;
  const a0 = await SIGNED.count('approver', `audit_log?tenant_id=eq.${t}`);
  const e0 = await SIGNED.count('approver', `inventory_action_events?tenant_id=eq.${t}`);
  const before = (await SIGNED.rest('approver', `inventory_actions?select=id,status,decided_at&id=eq.${F.action}`)).body[0] || {};

  const ctx = (await SIGNED.rpc('nonapprover', 'action_approver_context')).body[0] || {};
  const dec = await SIGNED.rpc('nonapprover', 'action_decide', { p_action_id: F.action, p_decision: 'APPROVE' });
  const d = Array.isArray(dec.body) ? (dec.body[0] || {}) : {};
  const afterFn = (await SIGNED.rest('approver', `inventory_actions?select=id,status,decided_at&id=eq.${F.action}`)).body[0] || {};

  /* The second door. rpc/action_decide is not the only way to move this row and
     a caller who ignores the UI will not politely use the front one. A COMPLETE
     decision tuple is written on purpose: a status-only PATCH is refused by the
     CHECK inventory_actions_decision_stamped before any privilege is consulted,
     which reads as "refused" and is nothing of the kind. */
  const patch = await SIGNED.rest('nonapprover', `inventory_actions?id=eq.${F.action}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'APPROVED', decided_at: new Date().toISOString(), decided_by_authority: 'GATE_PROBE_FORGED' }),
  });
  const patchedRows = Array.isArray(patch.body) ? patch.body.length : 0;
  const patchCode = (patch.body && patch.body.code) || '';

  const after = (await SIGNED.rest('approver', `inventory_actions?select=id,status,decided_at&id=eq.${F.action}`)).body[0] || {};
  const a1 = await SIGNED.count('approver', `audit_log?tenant_id=eq.${t}`);
  const e1 = await SIGNED.count('approver', `inventory_action_events?tenant_id=eq.${t}`);
  const evs = (await SIGNED.rest('approver', `inventory_action_events?select=event&action_id=eq.${F.action}`)).body || [];
  const refusals = evs.filter(x => x.event === 'APPROVAL_REFUSED' || x.event === 'ESCALATED').length;

  const bad = [];
  if (ctx.may_decide === true)
    bad.push(`action_approver_context() told ${na.email}, whose account role is "${na.tenant_role}", that it MAY decide — this dealership's policy admits only {${(ap.approver_tenant_roles || []).join(', ')}}`);
  if (d.ok === true)
    bad.push(`rpc/action_decide ACCEPTED an APPROVE posted over HTTPS by a signed-in non-approver (${na.email}, role "${na.tenant_role}") — the refusal exists only in the UI`);
  if (d.ok !== true && !['NOT_AN_APPROVER', 'NO_APPROVER_AT_DEALERSHIP'].includes(String(d.refusal_code)))
    bad.push(`rpc/action_decide refused the non-approver with "${d.refusal_code}" — expected NOT_AN_APPROVER (or NO_APPROVER_AT_DEALERSHIP), and a different code means the refusal came from somewhere other than the authorisation arm`);
  if (afterFn.status !== before.status)
    bad.push(`the action moved from ${before.status} to ${afterFn.status} across the action_decide() call — the function's refusal did not hold`);
  if (String(afterFn.decided_at || '') !== String(before.decided_at || ''))
    bad.push(`decided_at changed (${before.decided_at} → ${afterFn.decided_at}) across a call that reported a refusal`);
  if (patch.status >= 200 && patch.status < 300 && patchedRows > 0)
    bad.push(`the same non-approver then bypassed the function entirely: PATCH /rest/v1/inventory_actions, forging a complete decision tuple, was ACCEPTED and rewrote ${patchedRows} row(s). rpc/action_decide is not the only door, and the table has to refuse too`);
  if (after.status !== before.status)
    bad.push(`by the end of this arm the action had moved from ${before.status} to ${after.status}`);
  if (Number(a1 - a0) < 1 || refusals < 1)
    bad.push(`the refusal was not recorded: ${a1 - a0} audit row(s) and ${refusals} APPROVAL_REFUSED/ESCALATED event(s) were written. A refusal nobody can read afterwards is not evidence of anything`);

  const doorLine = (patch.status >= 200 && patch.status < 300 && patchedRows > 0) ? null
    : String(patchCode) === '42501'
      ? `the same caller's direct PATCH on /rest/v1/inventory_actions was refused by the GRANT: HTTP ${patch.status}, PostgREST code 42501 — "${String(patch.body && patch.body.message || '').slice(0, 80)}"`
      : (patch.status >= 200 && patch.status < 300)
        ? `the same caller's direct PATCH on /rest/v1/inventory_actions returned HTTP ${patch.status} and rewrote 0 rows — stopped by RLS, which is a row filter and not a privilege. CLAUDE.md: "0 rows" is evidence about RLS and never evidence that the privilege is absent`
        : `INCONCLUSIVE on the second door: the PATCH came back HTTP ${patch.status} with code ${patchCode || '(none)'} — neither a privilege refusal nor a row filter, so this run says NOTHING about whether authenticated may write public.inventory_actions directly. The function arm above is what this result rests on`;

  return {
    bad,
    ok: [
      `RAN through the real signed-in path: GoTrue password grant at ${SIGNED.url}/auth/v1, then PostgREST with apikey + Authorization: Bearer. No set_config('role'), no set_config('request.jwt.claims') — the gap two-tenant-proof-2026-09-06.md §8.4 records`,
      F.note,
      `the caller is ${na.email}, a member of dealership ${short(t)} holding account role "${na.tenant_role}"${na.staff_role ? ` and job title "${na.staff_role}"` : ''}; the dealership's own inventory_action_policy admits only account roles {${(ap.approver_tenant_roles || []).join(', ')}} and job titles {${(ap.approver_staff_roles || []).join(', ') || 'none'}}`,
      `action_approver_context() answered may_decide=${ctx.may_decide}, refusal_code=${ctx.refusal_code}, tenant_has_any_approver=${ctx.tenant_has_any_approver}`,
      `POST /rest/v1/rpc/action_decide {APPROVE} answered HTTP ${dec.status}, ok=${d.ok}, refusal_code=${d.refusal_code}; the action stayed ${afterFn.status} and decided_at did not move`,
      doorLine,
      `the refusal was recorded: +${a1 - a0} audit row(s) and ${refusals} APPROVAL_REFUSED/ESCALATED event(s) on action ${F.action}`,
      fixtureResidue(F),
    ].filter(Boolean).concat(signedCensus()),
  };
}

/* ── B2, through the signed-in caller ───────────────────────────────────── */
async function b2Signed() {
  if (!SIGNED.ok) return { notrun: SIGNED.why };
  if (!SIGNED.writable) return { notrun: SIGNED.notWritable };
  const F = await signedFixture();
  if (!F.ok) return { notrun: F.why };

  const ap = SIGNED.who.approver, ap2 = SIGNED.who.approver2, t = ap.tenant_id;
  const state = (await SIGNED.rest('approver', `inventory_actions?select=id,status&id=eq.${F.action}`)).body[0] || {};
  if (state.status !== 'PROPOSED')
    return { notrun: `the probe action ${F.action} is already ${state.status}, so there is no first decision left to make and nothing for a second one to be idempotent against` };

  const rc = (await SIGNED.rest('approver', 'inventory_action_reason_codes?select=code,applies_to,sort&order=sort.asc,code.asc')).body || [];
  const rejectCode = (rc.find(r => Array.isArray(r.applies_to) && r.applies_to.includes('REJECT')) || {}).code || null;

  const audit = () => SIGNED.count('approver', `audit_log?tenant_id=eq.${t}`);
  const events = () => SIGNED.count('approver', `inventory_action_events?tenant_id=eq.${t}`);
  const a0 = await audit(), e0 = await events();

  const q1 = await SIGNED.rpc('approver', 'action_decide', { p_action_id: F.action, p_decision: 'APPROVE' });
  const r1 = (Array.isArray(q1.body) ? q1.body[0] : null) || {};
  const a1 = await audit(), e1 = await events();

  const q2 = await SIGNED.rpc('approver', 'action_decide', { p_action_id: F.action, p_decision: 'APPROVE' });
  const r2 = (Array.isArray(q2.body) ? q2.body[0] : null) || {};
  const a2 = await audit(), e2 = await events();

  let q3 = null, r3 = null, a3 = a2, e3 = e2;
  if (rejectCode) {
    q3 = await SIGNED.rpc('approver', 'action_decide', {
      p_action_id: F.action, p_decision: 'REJECT', p_reason_code: rejectCode,
      p_note: 'Quality gate probe: a conflicting second decision.',
    });
    r3 = (Array.isArray(q3.body) ? q3.body[0] : null) || {};
    a3 = await audit(); e3 = await events();
  }

  const q4 = await SIGNED.rpc('approver2', 'action_decide', { p_action_id: F.action, p_decision: 'APPROVE' });
  const r4 = (Array.isArray(q4.body) ? q4.body[0] : null) || {};
  const a4 = await audit(), e4 = await events();
  const evs = (await SIGNED.rest('approver', `inventory_action_events?select=event&action_id=eq.${F.action}`)).body || [];
  const conflicts = evs.filter(x => x.event === 'DECISION_CONFLICT').length;

  const s1 = (r1.action || {}).status, s2 = (r2.action || {}).status;
  const d1 = (r1.action || {}).decided_at, d2 = (r2.action || {}).decided_at;
  const bad = [];
  if (r1.ok !== true)
    bad.push(`the first decision was refused: ok=${r1.ok}, refusal_code=${r1.refusal_code}. ${ap.email} holds "${ap.tenant_role}", which this dealership's own policy admits, so a refusal here is a defect and not a precondition`);
  if (r1.ok === true && s1 !== 'APPROVED') bad.push(`the first APPROVE reported ok=true and left the action in ${s1}`);
  if (r1.ok === true && r1.idempotent === true) bad.push('the FIRST decision reported idempotent=true — it changed the state, so it was not a repeat of anything');
  if (r2.ok !== true || r2.idempotent !== true)
    bad.push(`the identical decision, repeated by the same account over a second HTTPS request, answered ok=${r2.ok} idempotent=${r2.idempotent} refusal=${r2.refusal_code} — the double-click is supposed to be recognised and answered ok=true, idempotent=true`);
  if (Number(a2 - a1) !== 0 || Number(e2 - e1) !== 0)
    bad.push(`the repeated decision wrote ${a2 - a1} audit row(s) and ${e2 - e1} event(s) — an idempotent repeat writes nothing, and anything counting audit rows to count decisions will now double-count this one`);
  if (s2 !== s1 || String(d2 || '') !== String(d1 || ''))
    bad.push(`the repeated decision moved the row: status ${s1} → ${s2}${String(d2 || '') !== String(d1 || '') ? ', and decided_at was rewritten' : ''} — that is a second state change, which is exactly what "one state change" forbids`);
  if (r3) {
    if (r3.ok !== false || r3.refusal_code !== 'ALREADY_DECIDED')
      bad.push(`a REJECT arriving for an already-APPROVED action answered ok=${r3.ok}, refusal_code=${r3.refusal_code} — expected ok=false, ALREADY_DECIDED, because the first decision stands`);
    if ((r3.action || {}).status !== s1) bad.push(`the conflicting REJECT moved the action from ${s1} to ${(r3.action || {}).status} — the first decision did not stand`);
    if (Number(a3 - a2) < 1 || Number(e3 - e2) < 1)
      bad.push(`the conflicting decision wrote ${a3 - a2} audit row(s) and ${e3 - e2} event(s) — a second person trying to overturn a decision has to be readable afterwards, and this one left no trace`);
  }
  if (r4.ok !== false || r4.refusal_code !== 'ALREADY_DECIDED')
    bad.push(`the same APPROVE from a DIFFERENT approver (${ap2.email}) answered ok=${r4.ok}, refusal_code=${r4.refusal_code} — the idempotent arm is keyed on decided_by_auth_id, so another account repeating the decision must take the ALREADY_DECIDED branch and not be silently absorbed as a double-click`);
  if (conflicts < 1) bad.push('not one DECISION_CONFLICT event was written across the conflicting attempts');

  return {
    bad,
    ok: [
      `RAN through the real signed-in path: five separate HTTPS requests to /rest/v1/rpc/action_decide, each carrying a JWT GoTrue issued to a real account`,
      F.note,
      `on dealership ${short(t)}, action ${F.action}, decided by two accounts that both hold an approving role: ${ap.email} ("${ap.tenant_role}") and ${ap2.email} ("${ap2.tenant_role}")`,
      `first APPROVE: ok=${r1.ok}, idempotent=${r1.idempotent}, status ${s1}, +${a1 - a0} audit row(s), +${e1 - e0} event(s)`,
      `the same APPROVE again from the same account: ok=${r2.ok}, idempotent=${r2.idempotent}, status ${s2}, +${a2 - a1} audit row(s), +${e2 - e1} event(s), decided_at unchanged — one state change`,
      r3 ? `a conflicting REJECT (reason ${rejectCode}) from the same account: ok=${r3.ok}, refusal_code=${r3.refusal_code}, action still ${(r3.action || {}).status}, +${a3 - a2} audit row(s), +${e3 - e2} event(s) — refused AND recorded`
         : 'the conflicting-REJECT arm did not run: this database carries no inventory_action_reason_codes row that applies to REJECT, and a rejection without a code is refused earlier for a different reason',
      `the same APPROVE from a second approver: ok=${r4.ok}, refusal_code=${r4.refusal_code}, action still ${(r4.action || {}).status}, +${a4 - a3} audit row(s), +${e4 - e3} event(s)`,
      `${conflicts} DECISION_CONFLICT event(s) recorded on this action`,
      fixtureResidue(F),
    ].concat(signedCensus()),
  };
}

/* ── B3, through the signed-in caller, in both directions ───────────────── */
async function b3Signed() {
  if (!SIGNED.ok) return { notrun: SIGNED.why };
  const ap = SIGNED.who.approver, ot = SIGNED.who.other;
  if (!ot.tenant_id || ot.tenant_id === ap.tenant_id)
    return { notrun: `both configured accounts resolve to dealership ${short(ap.tenant_id)}, so there is no dealership B whose rows could be withheld from a member of dealership A. This check needs two, and it will not report a clean isolation result against one` };

  const bad = [], ok = [];
  /* Neither direction writes and neither takes a row lock, so both run
     wherever this lane is configured. */
  for (const [meName, themName] of [['approver', 'other'], ['other', 'approver']]) {
    const me = SIGNED.who[meName], them = SIGNED.who[themName];
    const mine = me.tenant_id, theirs = them.tenant_id;

    /* Non-vacuity first, and in the only way that is honest: THEIR rows are
       read by THEM, so a zero below is a withheld row and not an empty table. */
    const theirRows = (await SIGNED.rest(themName, `inventory_actions?select=id,status&tenant_id=eq.${theirs}&order=created_at`)).body;
    const myRows    = (await SIGNED.rest(meName,   `inventory_actions?select=id&tenant_id=eq.${mine}`)).body;
    if (!Array.isArray(theirRows) || !theirRows.length) {
      bad.push(`dealership ${short(theirs)} holds no inventory_actions rows that its own signed-in member can read, so "0 visible to the other dealership" would say nothing — this check refuses to report a clean isolation result on an empty set`);
      continue;
    }
    const target = theirRows[0];

    const all      = (await SIGNED.rest(meName, 'inventory_actions?select=id,tenant_id')).body || [];
    const crossed  = all.filter(r => r.tenant_id === theirs).length;
    const filtered = (await SIGNED.rest(meName, `inventory_actions?select=id&tenant_id=eq.${theirs}`)).body || [];
    const byId     = (await SIGNED.rest(meName, `inventory_actions?select=id&id=eq.${target.id}`)).body || [];
    const queue    = await SIGNED.rest(meName, `v_inventory_action_queue?select=id&tenant_id=eq.${theirs}`);

    const theirAudit0 = await SIGNED.count(themName, `audit_log?tenant_id=eq.${theirs}`);
    const dq = await SIGNED.rpc(meName, 'action_decide', { p_action_id: target.id, p_decision: 'APPROVE' });
    const dv = (Array.isArray(dq.body) ? dq.body[0] : null) || {};
    const theirAudit1 = await SIGNED.count(themName, `audit_log?tenant_id=eq.${theirs}`);
    const targetAfter = ((await SIGNED.rest(themName, `inventory_actions?select=id,status&id=eq.${target.id}`)).body || [])[0] || {};

    const tag = `${me.email} (dealership ${short(mine)}) → dealership ${short(theirs)}`;
    if (!Array.isArray(myRows) || !myRows.length)
      bad.push(`${tag}: the caller could not read any of its OWN dealership's inventory_actions rows either, so every zero below is RLS denying everything rather than isolation working — the result is vacuous, not clean`);
    if (crossed > 0) bad.push(`${tag}: an unqualified SELECT returned ${crossed} of the other dealership's ${theirRows.length} inventory_actions rows`);
    if (filtered.length > 0) bad.push(`${tag}: a SELECT filtered to the other dealership's tenant_id returned ${filtered.length} row(s)`);
    if (byId.length > 0) bad.push(`${tag}: the other dealership's action ${short(target.id)}, asked for by primary key, was returned`);
    if (queue.status === 200 && Array.isArray(queue.body) && queue.body.length > 0)
      bad.push(`${tag}: v_inventory_action_queue handed over ${queue.body.length} of the other dealership's rows — the view is a second door onto the same rows and it has to be locked too`);
    if (dv.ok === true)
      bad.push(`${tag}: rpc/action_decide ACCEPTED a decision on the other dealership's action ${short(target.id)}`);
    else if (dv.refusal_code !== 'NOT_FOUND')
      bad.push(`${tag}: rpc/action_decide refused the cross-dealership decision with "${dv.refusal_code}" rather than NOT_FOUND — a distinct code confirms the row exists, which is precisely what "the same answer for no such action and belongs to another dealership" was written to avoid`);
    if (targetAfter.status !== target.status)
      bad.push(`${tag}: the other dealership's action moved from ${target.status} to ${targetAfter.status}`);
    if (Number(theirAudit1) !== Number(theirAudit0))
      bad.push(`${tag}: the other dealership's audit_log went from ${theirAudit0} to ${theirAudit1} rows across the attempt — the NOT_FOUND arm returns before any write, so anything written there is a row about another dealership's action`);

    ok.push(`${tag}: unqualified SELECT returned ${all.length} row(s), ${all.length - crossed} of its own and ${crossed} of theirs; filtered-by-tenant ${filtered.length}; by primary key ${byId.length}; v_inventory_action_queue ${queue.status === 200 ? (queue.body || []).length : `refused HTTP ${queue.status}`}`);
    ok.push(`${tag}: non-vacuous — the other dealership's own signed-in member reads ${theirRows.length} row(s) there, and this caller reads ${(myRows || []).length} of its own, so the zeros are a withheld row and not an empty table`);
    ok.push(`${tag}: rpc/action_decide(APPROVE) on ${short(target.id)} answered HTTP ${dq.status}, ok=${dv.ok}, refusal_code=${dv.refusal_code}; the action stayed ${targetAfter.status} and the other dealership's audit_log stayed at ${theirAudit1} rows — the refusal does not confirm the row exists`);
  }

  ok.push('this is the arm the two-tenant proof could not run: every request above carried a JWT that GoTrue signed and PostgREST verified. It does NOT extend to service_role, which is BYPASSRLS — n8n writes as service_role and nothing measured here filters it');
  return { bad, ok: ok.concat(signedCensus()) };
}

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
    /* The second transport. psql is not the only way to be a caller, and on a
       machine that cannot open a Postgres socket it is not a way at all. */
    const sig = await b1Signed();
    if (sig && sig.bad) bad.push(...sig.bad);
    if (bad.length) {
      B_VERDICT('B1', bad, (sig && sig.ok) || []);
    } else if (sig && sig.ok) {
      B_VERDICT('B1', [], sig.ok.concat(measured));
    } else {
      const nonApprovers = CENSUS.b ? CENSUS.b.members.filter(m => !m.role_admits && !m.title_admits).length : null;
      B_NOTRUN('B1', measured, dot(PROBE.why || PROBE.how)
        + ' B1 needs to make a NON-APPROVER call action_decide(), and that call takes the NOT_AN_APPROVER arm, which writes an audit row and an APPROVAL_REFUSED event BEFORE it returns — so it cannot be exercised through a read-only channel, and this gate will not open a write probe on production. '
        + (CENSUS.b
          ? `Measured on this database: ${CENSUS.b.members.length} membership(s), of which ${nonApprovers} may not approve.`
          : dot(`The precondition could not even be measured: ${CENSUS.why}`))
        + ' Set NEXUS_STAGING_DB_URL to a staging Postgres carrying this schema and B1 runs there in full, inside a transaction that ends in ROLLBACK.'
        + ` The signed-in caller could not run either: ${dot(sig ? sig.notrun : 'it was not attempted')}`);
    }
  } else {
    const p = runProbe(PROBE.url, body);
    const sig = await b1Signed();
    const sigBad = (sig && sig.bad) || [], sigOk = (sig && sig.ok) || [];
    if (!p.ok || !p.v || p.v.runnable !== true) {
      /* The psql arm did not run. That is not a reason to ignore an arm that
         did — a defect found by half a check is still a defect. */
      const psqlWhy = !p.ok
        ? `the write probe could not run on ${PROBE.how}: ${p.why}`
        : dot(`the probe target is ${PROBE.how}`) + ` It measured: ${(p.v && p.v.why) || 'the probe returned nothing'}`;
      if (sigBad.length) B_VERDICT('B1', sigBad, sigOk);
      else if (sigOk.length) B_VERDICT('B1', [], sigOk.concat(measured, [`the psql arm did not run: ${psqlWhy}`]));
      else B_NOTRUN('B1', measured, `${psqlWhy} The signed-in caller could not run either: ${dot(sig ? sig.notrun : 'it was not attempted')}`);
    } else {
      const v = p.v, bad = [...sigBad];
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
      ].filter(Boolean).concat(sigOk, measured));
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

  const sig = await b2Signed();
  const sigBad = (sig && sig.bad) || [], sigOk = (sig && sig.ok) || [];

  if (!PROBE.url || !PROBE.writable) {
    if (sigBad.length) B_VERDICT('B2', sigBad, sigOk);
    else if (sigOk.length) B_VERDICT('B2', [], sigOk.concat(measured));
    else B_NOTRUN('B2', measured, dot(PROBE.why || PROBE.how)
      + ' B2 has to make a decision and then repeat it, so both of its arms are state changes by definition and neither has a read-only form; this gate will not open a write probe on production. '
      + (CENSUS.b
        ? `Measured on this database: ${CENSUS.b.actions_by_tenant.reduce((n, a) => n + Number(a.decidable || 0), 0)} action(s) are in a state a decision could still move, and ${CENSUS.b.members.filter(m => m.role_admits || m.title_admits).length} membership(s) may approve.`
        : dot(`The precondition could not even be measured: ${CENSUS.why}`))
      + ' Set NEXUS_STAGING_DB_URL to a staging Postgres carrying this schema and B2 runs there in full, inside a transaction that ends in ROLLBACK.'
      + ` The signed-in caller could not run either: ${dot(sig ? sig.notrun : 'it was not attempted')}`);
  } else {
    const p = runProbe(PROBE.url, body);
    if (!p.ok || !p.v || p.v.runnable !== true) {
      const psqlWhy = !p.ok
        ? `the write probe could not run on ${PROBE.how}: ${p.why}`
        : dot(`the probe target is ${PROBE.how}`) + ` It measured: ${(p.v && p.v.why) || 'the probe returned nothing'}`;
      if (sigBad.length) B_VERDICT('B2', sigBad, sigOk);
      else if (sigOk.length) B_VERDICT('B2', [], sigOk.concat(measured, [`the psql arm did not run: ${psqlWhy}`]));
      else B_NOTRUN('B2', measured, `${psqlWhy} The signed-in caller could not run either: ${dot(sig ? sig.notrun : 'it was not attempted')}`);
    } else {
      const v = p.v, bad = [...sigBad], r1 = v.r1, r2 = v.r2, r3 = v.r3, r4 = v.r4;
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
      ].concat(sigOk, measured));
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

  /* THE VERDICT IS THE SIGNED-IN ARM'S. The psql arm below reaches Postgres by
     setting `request.jwt.claims` and `role` with set_config() — which is how
     PostgREST PRESENTS a JWT and is not a signed JWT that travelled through it.
     That distinction is the whole subject of B3 and the reason
     two-tenant-proof-2026-09-06.md §8.4 records it as NOT RUN. So the GUC arm
     may still FAIL this check — a hole it finds is a real hole — but it may not
     PASS it on its own, and a clean GUC arm with no signed-in arm is NOT RUN. */
  const sig = await b3Signed();
  const sigBad = (sig && sig.bad) || [], sigOk = (sig && sig.ok) || [];
  const sigRan = !!(sig && sig.bad);
  const gucNotRun = why => {
    if (sigBad.length) B_VERDICT('B3', sigBad, sigOk);
    else if (sigRan) B_VERDICT('B3', [], sigOk.concat(measured, [`the psql arm did not run: ${why}`]));
    else B_NOTRUN('B3', measured, `${dot(why)} The signed-in caller could not run either: ${dot(sig ? sig.notrun : 'it was not attempted')}`);
  };

  if (!PROBE.url) {
    gucNotRun(dot(PROBE.why) + ' '
      + (CENSUS.b
        ? `The catalogue says this database holds ${CENSUS.b.tenants} dealership(s)${Number(CENSUS.b.tenants) < 2 ? ', so there is no dealership B whose rows could be withheld' : ', which is enough to attempt it'}, but a catalogue has no caller and this check is about what Postgres does with one.`
        : dot(`The precondition could not even be measured: ${CENSUS.why}`))
      + ' Point NEXUS_DB_URL or NEXUS_STAGING_DB_URL at a database with two dealerships and both arms run: neither writes and neither takes a row lock.');
  } else {
    const p = runProbe(PROBE.url, body);
    if (!p.ok) gucNotRun(`the probe could not run on ${PROBE.how}: ${p.why}`);
    else if (!p.v || p.v.runnable !== true) gucNotRun(dot(`the probe target is ${PROBE.how}`) + ` It measured: ${(p.v && p.v.why) || 'the probe returned nothing'}`);
    else {
      const v = p.v, bad = [...sigBad];
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
      const gucOk = [
        `the psql arm ALSO ran against ${PROBE.how}, presenting a JWT through set_config() rather than signing in — recorded as a second, weaker measurement`,
        `dealership A = ${short(v.tenant_a)} (${v.a_rows} action rows), dealership B = ${short(v.tenant_b)} (${v.b_rows} action rows); the caller is an account that is a member of A and of nothing else`,
        `read arm: as that member, SELECT on public.inventory_actions returned ${v.visible_total} row(s) — ${v.visible_a} of A's and ${v.visible_b} of B's; ${v.queue_state === 'read' ? `v_inventory_action_queue returned ${v.queue_b} of B's rows` : v.queue_state}`,
        `non-vacuous: B's ${v.b_rows} rows are readable to the owner of this session and A's own ${v.visible_a} were visible to the member, so the zero is isolation and not an empty table`,
        `write arm: action_decide(APPROVE) on B's action ${short(v.action_b)} answered ok=${v.decide_ok}, refusal_code=${v.decide_code}; B's action stayed ${v.status_after} and 0 audit rows and 0 events were written — the refusal does not confirm the row exists`,
        'this does NOT rest on the 2 Sep 2026 two-tenant proof: that pass ran 08:44–08:54 UTC and every Action Center object it would have needed was created at 18:12 that day or later, so it could not have covered any of this',
        `nothing persisted: the whole probe ran in a transaction that ended in ROLLBACK and the row counts were identical before and after (${Object.entries(p.counts).map(([k, n]) => `${k}=${n}`).join(', ')})`,
      ];
      /* A clean GUC arm is not a pass on its own — it did not sign in. */
      if (bad.length) B_VERDICT('B3', bad, sigOk.concat(gucOk, measured));
      else if (sigRan) B_VERDICT('B3', [], sigOk.concat(gucOk, measured));
      else B_NOTRUN('B3', measured.concat(gucOk),
        'the only arm that ran reached Postgres through set_config(\'request.jwt.claims\') and set_config(\'role\'), which is how PostgREST presents a JWT and is not a signed JWT travelling through PostgREST. It found nothing wrong — that is recorded above as measured evidence, not as a pass — and B3 exists to assert the signed-in path specifically. '
        + `The signed-in caller could not run: ${dot(sig ? sig.notrun : 'it was not attempted')}`);
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
  /* B4 reads and renders; it never writes. So when no live credential is
     configured but a signed-in STAGING caller is, it runs there rather than
     reporting NOT RUN — a rendered-versus-live comparison against a fixture
     dealership is a smaller claim than against production, and the evidence
     below says which project it ran against. It does NOT silently borrow the
     staging project when NEXUS_LIVE_URL names a different one: a half-live,
     half-staging comparison would be a figure with two derivations. */
  if (!L.url && !L.anon && !L.token && SIGNED.ok) {
    L.url = SIGNED.url; L.anon = SIGNED.anon;
    L.email = SIGNED.who.approver.email; L.password = process.env.NEXUS_STAGING_APPROVER_PASSWORD || '';
    measured.push(`no NEXUS_LIVE_* credential is set, so this ran against the signed-in staging caller instead: ${SIGNED.url} (Supabase project ${SIGNED.ref}) as ${L.email}, a real member of dealership ${short(SIGNED.who.approver.tenant_id)}. That is a fixture dealership, not a paying one`);
  }
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
        /* WHETHER THE BROWSER COULD REACH THE PROJECT AT ALL, counted from the
           browser's own network events rather than inferred from a blank
           screen. Without this the two answers "the app is broken" and "this
           machine's egress will not carry a browser to Supabase" arrive as the
           same red line — and one of them is a defect in the product while the
           other is a defect in where the gate happens to be running. On
           6 Sep 2026 it was the second: curl reached the project fine and
           chromium's TLS handshake was cut by the session's egress proxy every
           time, so B4 reported a FAIL that said four units were missing from a
           screen that had never rendered. */
        const net = { ok: 0, failed: [], origin: new URL(L.url).origin };
        page.on('response', r => { if (r.url().startsWith(net.origin)) net.ok++; });
        page.on('requestfailed', r => { if (r.url().startsWith(net.origin)) net.failed.push(`${r.method()} ${r.url().slice(net.origin.length).split('?')[0]} — ${(r.failure() || {}).errorText || 'no reason given'}`); });
        /* HOW THIS SESSION IS OBTAINED, and why it changed on 6 Sep 2026.
           This used to hand-build a session object into localStorage under
           supabase-js's storage key. Two things were wrong with it. supabase-js
           2.110 did not accept the hand-built value at all — measured: zero
           network requests to the project, boot() fell straight through to the
           login card, and B4 reported "5 of 5 units do not appear" about a
           screen that had never rendered. And the fabricated user object
           carried no `email`, while app.js boot() reads SESSION.user.email to
           find the staff row — so even a session it HAD accepted would have
           been a session no real sign-in produces.

           When a password is available the gate now signs in through the app's
           own login form, which is the path a dealership uses. The injection
           survives only for NEXUS_LIVE_ACCESS_TOKEN, where there is no password
           to type, and it is reported as the weaker route. */
        const ref = new URL(L.url).hostname.split('.')[0];
        const viaForm = !!(L.email && L.password);
        if (!viaForm) {
          const exp = Math.floor(Date.now() / 1000) + 3600;
          await page.addInitScript(([k, t, e]) => {
            localStorage.setItem(k, JSON.stringify({ access_token: t, token_type: 'bearer', expires_in: 3600, expires_at: e, refresh_token: 'gate-no-refresh',
              user: { id: 'live', aud: 'authenticated', role: 'authenticated' } }));
          }, [`sb-${ref}-auth-token`, token, exp]);
        }
        await page.goto('http://127.0.0.1:8072/', { waitUntil: 'load' });
        await page.waitForTimeout(1500);
        if (viaForm) {
          try {
            await page.waitForSelector('#li', { timeout: 8000 });
            await page.fill('#li', L.email);
            await page.fill('#lp', L.password);
            await page.click('#lgo');
          } catch { /* no login card: the app may already consider itself signed in */ }
          /* Wait on an OUTCOME, not on a stopwatch. A sign-in that this
             machine's egress is going to reset takes longer to fail than it
             takes to succeed — measured at over six seconds — and a fixed
             timeout short enough to keep the gate quick was reading "Signing
             in…" as "did not sign in", with no network event recorded either
             way. That is how a check that could not run reports a failure. */
          for (let i = 0; i < 60; i++) {
            await page.waitForTimeout(500);
            const inApp = await page.evaluate(() => !document.getElementById('app').classList.contains('hide'));
            if (inApp || net.failed.length) break;
          }
        } else {
          await page.waitForTimeout(1000);
        }
        const loggedIn = await page.evaluate(() => !document.getElementById('app').classList.contains('hide'));
        await page.evaluate(() => { location.hash = 'inventory'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
        await page.waitForTimeout(2500);
        const screen = await page.evaluate(() => {
          const host = document.getElementById('screen');
          return { text: host.innerText || '', len: host.innerHTML.length, errored: /Couldn.t load/.test(host.innerHTML) };
        });
        await browser.close(); srv.close();
        live4 = { loggedIn, screen, net, viaForm };
      } catch (e) { live4 = { failed: String(e.message || e) }; }

      if (live4.failed) {
        B_NOTRUN('B4', measured.concat([`read ${expected.length} unit(s) from ${source}`]),
          `the live render could not be produced: ${live4.failed}`);
      } else if (!live4.loggedIn && live4.net && live4.net.ok === 0 && live4.net.failed.length) {
        /* The browser never got a single response out of the project. There is
           nothing to compare and nothing has been shown about the app: a FAIL
           here would be this gate crying wolf about its own network. */
        B_NOTRUN('B4', measured.concat([
          `read ${expected.length} unit(s) from ${source} — the gate's OWN process reached ${L.url} without trouble, so the project is up and the credentials work`,
          `the headless browser made ${live4.net.failed.length} request(s) to ${live4.net.origin} and ${live4.net.ok} of them returned anything at all. First failures: ${live4.net.failed.slice(0, 3).join(' · ')}`,
        ]), `the browser this gate drives could not reach ${live4.net.origin}, so the app never signed in and no screen was rendered to compare. This says nothing about the dashboard: the gate process itself read the units from the same project seconds earlier over the same TLS. It is the browser's egress that failed, and a rendered-versus-live comparison cannot be made without one. Run this gate somewhere the headless browser can reach ${live4.net.origin} directly.`);
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
          `RAN against ${L.url}, signed in ${live4.viaForm ? `through the app's own login form as ${L.email} — the same path a dealership uses` : 'by placing NEXUS_LIVE_ACCESS_TOKEN in the storage key supabase-js reads, which is weaker than typing a password into the form'}`,
          `the gate read ${expected.length} unit(s) itself from ${source} — a second, independent read, so a fetch bug in lib/data.js cannot cancel out against it`,
          `every one of those ${expected.length} unit ids appears on the Inventory screen, and every non-null price_aed appears in the exact string lib/format.js would produce for it`,
          `${live4.screen.len} characters rendered; the comparison is completeness and figure fidelity, and it does not claim the screen shows no OTHER unit`,
          'read-only: this check signs in, reads and renders; it writes nothing',
        ].concat(measured));
      }
    }
  }
}

/* ══ L11 ═══════════════════════════════════════════════════════════════════
   CAN THIS REPOSITORY STILL REBUILD THIS DATABASE?

   Every other check in this file asks whether the software is safe to sell.
   This one asks whether the company still owns its schema. On 3 September the
   honest answer was no: architecture/README.md said "there is no schema file
   you can run, the database is the record", and the only schema file in the
   repository carried its own warning not to run it. 243 migrations existed in
   exactly one place — Supabase project dsvuoovivysszdoiorch — and if that
   project were lost the schema could not be reconstructed from git.

   supabase/migrations/ now holds one file per recorded migration and
   supabase/baseline/ holds a catalogue-derived starting point. That is a
   snapshot, and snapshots rot. THE ROT IS THE DEFECT, NOT THE MISSING FILES —
   the same sentence L1 is built around. A migration applied through the
   Supabase MCP tool writes a row to supabase_migrations.schema_migrations and
   writes nothing to this repository, so the drift is silent, unbounded and
   invisible until someone needs a restore. A scheduled re-extraction does not
   fix that: it produces a fresher file nobody read, which is precisely how
   architecture/schema.sql came to say "THIS FILE IS AUTHORITATIVE" while
   sitting one hundred migrations behind. So the drift is measured here, where
   it has to be answered before a release.

   SEVERITY IS P1 ON PURPOSE, AND THE CHOICE IS ARGUABLE.
   This file's P0 bar is "would put a wrong number, or another dealership's
   data, in front of a paying customer". A repository that has fallen behind
   the database does neither; it is a business-continuity risk, not a customer-
   facing one, and quietly widening P0 to cover it would make P0 mean less for
   every other check. So it FAILS — visibly, in the tally and at the top of the
   report — without blocking the exit code. If the owner decides that losing
   the ability to rebuild the database should stop a release, change the
   severity below from 'P1' to 'P0'; nothing else needs to change.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const L11_TITLE = 'The repository still holds every migration the database has applied';
  const L11_SEV   = 'P1';
  const MIGDIR    = join(HERE, '..', '..', 'supabase', 'migrations');
  const BASEDIR   = join(HERE, '..', '..', 'supabase', 'baseline');

  let repo = null, repoWhy = null;
  try {
    const names = (await readdir(MIGDIR)).filter(f => f.endsWith('.sql'));
    repo = new Map();
    for (const f of names) {
      const m = /^(\d{14})_(.+)\.sql$/.exec(f);
      if (!m) { repoWhy = `${f} is not named <14-digit version>_<name>.sql, so the Supabase CLI will not order it`; break; }
      const body = await readFile(join(MIGDIR, f), 'utf8');
      repo.set(m[1], { name: m[2], file: f, md5: createHash('md5').update(body, 'utf8').digest('hex') });
    }
  } catch (e) { repoWhy = `supabase/migrations/ could not be read: ${e.message}`; }

  const baselineFiles = await readdir(BASEDIR).catch(() => []);
  const hasBaseline = baselineFiles.some(f => /baseline\.sql$/.test(f));

  const url = process.env.NEXUS_DB_URL;
  if (repoWhy) {
    FAIL('L11', LANE.LIVE, L11_SEV, L11_TITLE, [repoWhy,
      'until this is readable the repository cannot be compared with the database and no restore path can be claimed']);
  } else if (!url) {
    NOTRUN('L11', LANE.LIVE, L11_SEV, L11_TITLE,
      `no NEXUS_DB_URL, so supabase_migrations.schema_migrations could not be read. The repository holds ${repo.size} migration file(s)`
      + `${hasBaseline ? ' and a baseline' : ' and NO baseline'}, but whether the database has moved past them is exactly the question this check exists to answer, and it cannot be answered offline`);
  } else {
    const q = `select coalesce(json_agg(json_build_object('v', version, 'n', name, 'h', md5(statements[1])) order by version), '[]'::json)::text
               from supabase_migrations.schema_migrations;`;
    const r = psqlJson(url, q);
    if (!r.ok) {
      NOTRUN('L11', LANE.LIVE, L11_SEV, L11_TITLE, `supabase_migrations.schema_migrations could not be read: ${r.why}`);
    } else {
      const db = new Map(r.value.map(x => [x.v, { name: x.n, md5: x.h }]));
      const missing = [...db.keys()].filter(v => !repo.has(v)).sort();
      const extra   = [...repo.keys()].filter(v => !db.has(v)).sort();
      /* A database RESTORED from supabase/baseline/ has its history stamped by
         version and name only — the bodies live in supabase/migrations/ and are
         deliberately not duplicated into the table. Such a row is not a body
         that disagrees with the repository; it is a body the database never
         recorded, and calling it a mismatch would send the reader hunting for a
         tampered file that does not exist. */
      const bodiless = [...db.keys()].filter(v => repo.has(v) && !db.get(v).md5).sort();
      const changed = [...db.keys()].filter(v => repo.has(v) && db.get(v).md5 && repo.get(v).md5 !== db.get(v).md5).sort();
      const renamed = [...db.keys()].filter(v => repo.has(v) && repo.get(v).name !== db.get(v).name).sort();

      const bad = [];
      for (const v of missing) bad.push(`${v}_${db.get(v).name} is applied to the database and has no file in supabase/migrations/ — re-run the extraction`);
      for (const v of changed) bad.push(`${v}: the file in supabase/migrations/ is not byte-identical to the statements the database recorded — the repository is asserting a migration that was never applied in that form`);
      for (const v of renamed) bad.push(`${v}: recorded as "${db.get(v).name}" and filed as "${repo.get(v).name}"`);
      if (!hasBaseline) bad.push('supabase/baseline/ holds no baseline file, and the recorded chain does not replay from empty (its first entry ALTERs a table it never creates), so there is no restore path in this repository at all');

      if (bodiless.length) WARN('L11c', LANE.LIVE, 'P1', 'The database records migrations it holds no statements for',
        [`${bodiless.length} of ${db.size} rows in supabase_migrations.schema_migrations have a null or empty statements array`,
         'This is the expected shape of a database restored from supabase/baseline/: the history was stamped by version and name, and the bodies were left in supabase/migrations/ rather than duplicated into the table.',
         'It matters for one reason: supabase/migrations/ is now the ONLY copy of those bodies, so re-running the extractor against THIS database would produce empty files. The extractor refuses to do that; do not defeat the refusal.']);
      const ev = [
        `${db.size} migration(s) recorded in the database, ${repo.size} file(s) in supabase/migrations/, ${missing.length} missing, ${changed.length} differing in body, ${renamed.length} differing in name, ${bodiless.length} with no recorded body`,
        hasBaseline ? 'a baseline is present in supabase/baseline/' : 'NO baseline is present',
        'the fix when this fails is mechanical and is written down in supabase/README.md: re-extract, commit, done',
      ];
      if (extra.length) WARN('L11b', LANE.LIVE, 'P1', 'supabase/migrations/ holds a migration the database has never applied',
        extra.slice(0, 10).map(v => `${v}_${repo.get(v).name}.sql has no row in supabase_migrations.schema_migrations`).concat([
          'Not drift in the dangerous direction — a file the database has not seen cannot make a restore incomplete. It is either a migration written by hand and not yet applied, or a file extracted from a DIFFERENT database than the one NEXUS_DB_URL names. The second is worth knowing about before a restore.']));
      verdict('L11', LANE.LIVE, L11_SEV, L11_TITLE, bad, ev);
    }
  }
}


/* ══ L13 ═══════════════════════════════════════════════════════════════════
   IS THE CATALOGUE STILL CURRENT? — FRESHNESS IN VERSIONS, NOT IN HOURS

   L1 asks whether the embedded snapshot matches the catalogue. This asks the
   question underneath it, and every other live verdict in this file rests on
   the answer: does the catalogue describe the database AS IT STANDS, or as it
   stood before something landed?

   The gate had one answer to that and it was a clock — NEXUS_CATALOGUE_MAX_AGE_H,
   24 hours by default, applied in catalogueIntegrity(). CLAUDE.md calls it "a
   fuse, not a lock" and gives the case: a catalogue 23.92 hours old passed it
   and produced a full live verdict for a database with 60 functions where live
   had 110. The failure on 5 September 2026 was the same defect facing the other
   way — a catalogue eighteen minutes ahead of migration 20260905211435, fresh by
   any clock, describing a whatsapp_templates that had since gained two columns.
   Neither reading was old. Both were wrong, and the clock could not say so.

   The witness that can is the migration history. The catalogue records the head
   of supabase_migrations.schema_migrations it was read at; this check compares
   that head with the versions this repository holds in supabase/migrations/, and
   reports NOT RUN when the repository knows of a migration the catalogue's
   database had not applied.

   WHY NOT RUN AND NOT FAIL. A repository migration newer than the catalogue's
   head has two possible explanations and this check cannot tell them apart: it
   was applied after the catalogue was read (the catalogue is stale), or it has
   not been applied at all (the catalogue is fine and the repository is ahead).
   Both mean the same thing for every verdict that rests on the catalogue —
   currency is not established — and neither is a demonstrated defect. NOT RUN
   is the word this file uses for that, and it carries the versions by name so
   the reader can settle it in one look.

   WHAT THIS CHECK CANNOT SEE, STATED PLAINLY. A migration applied to the
   database that has no file in this repository is invisible here — the
   comparison is against the repository, and a version that exists in neither
   place cannot be missed by it. That is L11's question, it needs
   NEXUS_DB_URL, and this check does not stand in for it. What this one catches
   is the case that actually happened twice: the migration exists in the
   repository, the catalogue was taken before it, and nothing in the gate
   noticed.

   P0, and the choice is arguable in the other direction from L11's. L11 is P1
   because a repository that has fallen behind the database is a continuity risk
   rather than a customer-facing one. This is P0 because it does not describe a
   risk of its own: it says whether the ten P0 verdicts above it mean anything.
   A false green on tenant isolation is the harm P0 names, and that is precisely
   what a stale catalogue produces.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const L13_TITLE = 'The live catalogue is anchored to the migration history, and none has landed past it';
  const MIGDIR13  = join(HERE, '..', '..', 'supabase', 'migrations');

  let repoVersions = null, repoWhy = null;
  try {
    repoVersions = (await readdir(MIGDIR13))
      .filter(f => f.endsWith('.sql'))
      .map(f => (/^(\d{14})_/.exec(f) || [])[1])
      .filter(Boolean)
      .sort();
    if (!repoVersions.length) { repoVersions = null; repoWhy = 'supabase/migrations/ holds no file named <14-digit version>_<name>.sql'; }
  } catch (e) { repoWhy = `supabase/migrations/ could not be read: ${e.message}`; }

  const mh13 = live.cat && live.cat.migration_history;
  const head13 = mh13 && mh13.readable && mh13.head != null ? String(mh13.head) : null;

  if (!live.cat) {
    NOTRUN('L13', LANE.LIVE, 'P0', L13_TITLE,
      `${live.why || 'no live database connection'} — with no catalogue there is nothing whose currency could be established`);
  } else if (!head13) {
    NOTRUN('L13', LANE.LIVE, 'P0', L13_TITLE,
      mh13 ? `this catalogue could not read supabase_migrations.schema_migrations (${mh13.why || 'no reason recorded'}), so it carries no version anchor and nothing establishes that it describes the database as it stands`
           : 'this catalogue carries no migration_history key at all, so it predates the version anchor. Re-dump it with the SQL --print-sql emits; until then the ten live checks above rest on a reading whose currency is unknown, which is the shape that produced a green L1 for a schema that had already changed');
  } else if (repoWhy) {
    NOTRUN('L13', LANE.LIVE, 'P0', L13_TITLE,
      `the catalogue is anchored to migration ${head13}, and ${repoWhy} — so there is nothing to compare it with. This check exists because a catalogue that is fresh by the clock can still be behind the schema.`);
  } else {
    const ahead = repoVersions.filter(v => v > head13);
    const evidence = [
      `the catalogue was read at migration ${head13}, with ${mh13.count} recorded in supabase_migrations.schema_migrations`,
      `supabase/migrations/ holds ${repoVersions.length} migration file(s), the newest ${repoVersions[repoVersions.length - 1]}`,
      mh13.newest ? `the five newest the database had applied when it was read: ${mh13.newest}` : 'the catalogue records no migration list',
      'This compares the catalogue with THIS REPOSITORY. A migration applied to the database and never filed here is invisible to it — that is L11, and it needs NEXUS_DB_URL.',
    ];
    if (ahead.length) {
      NOTRUN('L13', LANE.LIVE, 'P0', L13_TITLE,
        `the catalogue was read at migration ${head13}, and this repository holds ${ahead.length} migration(s) newer than that: ${ahead.join(', ')}. `
        + 'Either they were applied after this catalogue was taken — in which case it describes a database that no longer exists and every live verdict resting on it is a statement about the past — or they have not been applied at all, in which case the catalogue is current and the repository is ahead. This check cannot tell those apart, so it reports neither a pass nor a failure. '
        + 'Settle it by re-taking the catalogue after reading max(version) from supabase_migrations.schema_migrations, and record the version the reading corresponds to.');
    } else {
      const behind = repoVersions.length && head13 > repoVersions[repoVersions.length - 1];
      PASS('L13', LANE.LIVE, 'P0', L13_TITLE, evidence.concat([
        behind
          ? `the database is anchored AHEAD of this repository — ${head13} against ${repoVersions[repoVersions.length - 1]} — so the catalogue is current and it is the repository that has fallen behind. That is not this check's failure to report; it is L11's, and L11 needs NEXUS_DB_URL.`
          : `no migration in this repository is newer than ${head13}, so nothing here shows the history moved past this reading`,
        'Freshness is measured in versions, not in hours. The 24-hour tolerance in catalogueIntegrity() is still there and still a fuse; this is the lock.',
      ]));
    }
  }
}


/* ══ L12 ═══════════════════════════════════════════════════════════════════
   DOES supabase/baseline/ STILL REPRODUCE THE DATABASE?

   L11 watches supabase/migrations/ against the history the database recorded,
   and it works. NOTHING WATCHED supabase/baseline/, and that gap has already
   cost something once. On 4 September the baseline went a day stale on the one
   afternoon it mattered: it predated the twelve security migrations, so
   restoring from it would have rebuilt the database with the born-open grants
   and the open schema door. And the vocabulary seed beside it was silently
   HTML-escaped — twenty characters stored as entities rather than as
   themselves, so a restore seeded "purchase_history.lead_id -&gt; leads(id)"
   where production holds "->".

   THE SECOND ONE IS THE ONE TO DESIGN AGAINST. It survived a whole verification
   pass because THE ROW COUNTS MATCHED, and counting rows is not reading them. A
   check that lists the files, or counts the rows, or asserts that a baseline
   "is present" — which is all L11 does, with its hasBaseline flag — cannot see
   it. The baseline's claim is not "I exist". It is "replaying me reproduces the
   database", and the honest witness for that claim is a FINGERPRINT COMPARISON:
   derive the same fact from the file and from the database, and see whether the
   two agree.

   So this check compares content, in three places, and each is a different half
   of the restore path:

     A · THE FOLDER AGAINST ITSELF (runs with no database at all).
         Restore = the baseline, then the history stamp, then every migration
         file whose version is GREATER than the baseline's. That sentence is
         falsifiable without a connection: every stamped version must have a
         file, every file at or below the baseline version must be stamped, and
         no stamped version may be above it. It also sweeps the seed's DATA for
         HTML entities — the exact corruption of 4 September — ignoring the
         comment header, which describes that corruption in entities and would
         otherwise report the repair note as the defect.

     B · THE SEED AGAINST THE DATABASE, BY VALUE.
         Per table, a digest over the seed's own row values, compared with the
         same digest computed by Postgres over the live rows. Column order comes
         from the file's own INSERT, NULL is a sentinel rather than an absence,
         and rows are sorted by digest so neither side depends on insertion
         order or on collation. Row counts are reported and are NOT the test:
         they matched all the way through the defect this arm exists to catch.
         Validated against production 5 Sep 2026 — all 19 tables, 190 rows,
         every digest equal — and against a deliberately re-escaped copy of the
         file, where the counts still match and the digests do not.

     C · THE SCHEMA AGAINST THE DATABASE, BY REGENERATION.
         supabase/tools/generate-baseline.mjs derives the whole file from the
         catalogue and is deterministic, so running it against the database and
         comparing bytes answers "does this file still describe this database".
         Version, name and date are taken from the committed file's own header
         so that only real drift can move the bytes.

         Given an EMPTY PostgreSQL 17 in NEXUS_BASELINE_REPLAY_URL this arm
         becomes the real thing rather than a proxy: supabase/tools/
         verification-harness.sql, then the baseline, the history stamp and the
         seed are replayed into it, and the generator is run against the
         REPLICA. If replaying the file reproduces the database, then the file
         regenerated from the replica is the file. That is the folder's own
         claim, executed.

   SEVERITY IS P1, for the reason L11 is and with the same caveat: losing the
   ability to rebuild is a business-continuity risk, not a wrong number in front
   of a customer, and widening P0 to cover it would make P0 mean less everywhere
   else. It fails visibly without blocking the exit code. If the owner decides
   otherwise, change L12_SEV.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const L12_TITLE = 'The baseline still reproduces the database it claims to reproduce';
  const L12_SEV   = 'P1';
  const SUPA      = join(HERE, '..', '..', 'supabase');
  const md5of     = s => createHash('md5').update(s, 'utf8').digest('hex');
  const NULLTOK   = '<<NULL>>';                 // the SQL below writes the same
  const UNIT      = String.fromCharCode(31);    // sentinel, and chr(31) between fields

  /* ── the seed, read as VALUES rather than as text ────────────────────────
     A quoted literal is unquoted ('' becomes '), a trailing ::type cast is
     dropped because it is type information rather than value, and NULL becomes
     a sentinel so a null and the string "NULL" cannot hash alike. Anything else
     — a number, true/false, an array literal — is kept verbatim, which is what
     col::text returns for it on the other side. */
  const seedValue = tok => {
    const t = String(tok).trim();
    if (t.startsWith("'")) {
      let out = '';
      for (let i = 1; i < t.length; i++) {
        if (t[i] === "'") { if (t[i + 1] === "'") { out += "'"; i++; } else break; }
        else out += t[i];
      }
      return out;
    }
    const bare = t.replace(/::\s*[A-Za-z_][A-Za-z0-9_ ]*(\(\s*\d+(\s*,\s*\d+)?\s*\))?(\[\])?\s*$/, '').trim();
    return /^null$/i.test(bare) ? NULLTOK : bare;
  };
  const seedTuple = s => {
    const out = []; let buf = '', depth = 0, q = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) { if (ch === "'") { if (s[i + 1] === "'") { buf += "''"; i++; } else { q = false; buf += ch; } } else buf += ch; continue; }
      if (ch === "'") { q = true; buf += ch; continue; }
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
      buf += ch;
    }
    out.push(buf);
    return out.map(seedValue);
  };
  const parseSeed = sql => {
    const tables = [];
    const re = /INSERT\s+INTO\s+public\.([a-z0-9_]+)\s*\(([^)]*)\)\s*VALUES\s*/gi;
    let m;
    while ((m = re.exec(sql))) {
      const cols = m[2].split(',').map(x => x.trim()).filter(Boolean);
      const rows = []; let depth = 0, q = false, cur = null, i = re.lastIndex;
      for (; i < sql.length; i++) {
        const ch = sql[i];
        if (q) { if (ch === "'") { if (sql[i + 1] === "'") { cur.buf += "''"; i++; } else { q = false; cur.buf += ch; } } else cur.buf += ch; continue; }
        if (ch === "'") { q = true; cur.buf += ch; continue; }
        if (ch === '(') { depth++; if (depth === 1) { cur = { buf: '' }; continue; } }
        if (ch === ')') { depth--; if (depth === 0) { rows.push(cur.buf); cur = null; continue; } }
        if (depth === 0) { if (ch === ';' || /[A-Za-z]/.test(ch)) break; continue; }
        cur.buf += ch;
      }
      tables.push({ table: m[1], cols, rows: rows.map(seedTuple) });
    }
    return tables;
  };
  const tableDigest = rows => md5of(rows.map(r => md5of(r.join(UNIT))).sort().join('\n'));

  const bad = [], ev = [], ran = [], unrun = [];
  let why = null, fBase = null, fHist = null, fSeed = null;
  let baseText = '', baseVersion = null, baseName = null, baseTaken = null;
  let stamp = [], stampDigest = null, seedTables = [];
  const migs = new Map();

  try {
    const names = (await readdir(join(SUPA, 'baseline'))).sort();
    const pick = re => names.find(f => re.test(f)) || null;
    fBase = pick(/baseline\.sql$/); fHist = pick(/migration_history\.sql$/); fSeed = pick(/vocabulary_seed\.sql$/);

    if (!fBase) bad.push('supabase/baseline/ holds no *_baseline.sql — there is no schema to restore from, and every other claim in this folder is about a file that does not exist');
    if (!fHist) bad.push('supabase/baseline/ holds no *_migration_history.sql — a database restored from the baseline would carry no record of the migrations already inside it, and the next `supabase db push` would replay all of them against a schema that already has their effects');
    if (!fSeed) bad.push('supabase/baseline/ holds no *_vocabulary_seed.sql — measured 4 Sep 2026, a schema-only restore fails on the first forward migration that INSERTs against a vocabulary table (policy_rule_rule_type_fkey), so the restore path stops there');

    if (fBase) {
      baseText = await readFile(join(SUPA, 'baseline', fBase), 'utf8');
      const h = /--\s*BASELINE VERSION:\s*(\d{14})\s*\(([^)]*)\)/.exec(baseText.slice(0, 4000));
      const d = /--\s*Taken\s+(\d{4}-\d{2}-\d{2})\b/.exec(baseText.slice(0, 4000));
      if (!h) bad.push(`${fBase} carries no "-- BASELINE VERSION: <version> (<name>)" header, so nothing says which point in the migration history it is a snapshot OF — and without that, "every migration greater than the baseline" names no set`);
      else { baseVersion = h[1]; baseName = h[2].trim(); }
      baseTaken = d ? d[1] : null;
    }

    if (fHist) {
      const t = await readFile(join(SUPA, 'baseline', fHist), 'utf8');
      stamp = [...t.matchAll(/^\s*\('(\d{14})',\s*'((?:[^']|'')*)'\)/gm)].map(m => [m[1], m[2].replace(/''/g, "'")]);
      if (!stamp.length) bad.push(`${fHist} contains no (version, name) pairs this gate can read — either it is empty or its shape changed, and either way a restore would stamp no history`);
      stampDigest = md5of(stamp.slice().sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(p => p[0] + '|' + p[1]).join('\n'));
    }

    for (const f of (await readdir(join(SUPA, 'migrations'))).filter(x => x.endsWith('.sql'))) {
      const m = /^(\d{14})_(.+)\.sql$/.exec(f);
      if (m) migs.set(m[1], m[2]);
    }

    if (fSeed) {
      const raw = await readFile(join(SUPA, 'baseline', fSeed), 'utf8');
      /* Comment lines are stripped before the sweep. The header of that file
         DESCRIBES the entity corruption, in entities; a sweep that read it would
         report the repair note as the defect. */
      const data = raw.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
      const ents = ['&gt;', '&lt;', '&amp;', '&quot;', '&#39;']
        .map(e => [e, data.split(e).length - 1]).filter(x => x[1] > 0);
      if (ents.length) bad.push(`${fSeed}: ${ents.map(x => `${x[1]} x ${x[0]}`).join(', ')} in its DATA (comment lines excluded) — this is the 4 Sep corruption exactly: free text passed through an HTML-escaping step, row counts unchanged, and a restore then seeds "-&gt;" where production holds "->". Regenerate the file; do not hand-edit the entities out and leave the generator producing them.`);
      seedTables = parseSeed(raw);
      if (!seedTables.length) bad.push(`${fSeed}: no INSERT INTO public.<table> (...) VALUES statement could be parsed, so this gate cannot read what the seed claims and must not report that it agrees with anything`);
      for (const t of seedTables) {
        const wrong = t.rows.filter(r => r.length !== t.cols.length).length;
        if (wrong) bad.push(`${fSeed}: ${wrong} row(s) of public.${t.table} carry a different number of values than the ${t.cols.length} columns its INSERT names — the file cannot be parsed with confidence, and no digest taken from it would mean anything`);
      }
    }

    /* ── ARM A · the restore path, as falsifiable sentences ──────────────── */
    if (baseVersion && stamp.length) {
      const stamped = new Map(stamp);
      for (const pair of stamp) {
        const v = pair[0], n = pair[1];
        if (!migs.has(v)) bad.push(`the history stamp records ${v}_${n} and supabase/migrations/ holds no file for it — a restore would tell the database that migration is already applied while the repository cannot show what it did`);
        else if (migs.get(v) !== n) bad.push(`${v}: the history stamp calls it "${n}" and the file is named "${migs.get(v)}" — the two halves of the restore path disagree about the same migration`);
        if (v > baseVersion) bad.push(`the history stamp records ${v}, NEWER than the baseline version ${baseVersion} — it tells a restored database that a migration the baseline does not carry is already applied, so the forward replay skips it`);
      }
      for (const v of [...migs.keys()].filter(x => x <= baseVersion && !stamped.has(x)).sort())
        bad.push(`${v}_${migs.get(v)}.sql is at or below the baseline version ${baseVersion} and the history stamp does not record it — after a restore it would be replayed against a schema that already contains its effects`);
      const forward = [...migs.keys()].filter(x => x > baseVersion).sort();
      ev.push(`restore path: ${fBase} at version ${baseVersion} (${baseName})${baseTaken ? `, taken ${baseTaken}` : ''}, then ${stamp.length} stamped (version, name) pair(s), then ${forward.length} forward migration file(s)${forward.length ? ` from ${forward[0]} to ${forward[forward.length - 1]}` : ''}`);
      ev.push(`history stamp fingerprint, md5 over "version|name" in version order = ${stampDigest}`);
    }
    if (seedTables.length) {
      ev.push(`vocabulary seed: ${seedTables.length} table(s), ${seedTables.reduce((a, t) => a + t.rows.length, 0)} row(s), read as values and not as text`);
      ev.push('seed fingerprints (md5 over the sorted per-row digests, columns in the file\'s own order): '
        + seedTables.map(t => `${t.table}=${tableDigest(t.rows).slice(0, 8)}`).join(' '));
    }
  } catch (e) { why = `supabase/baseline/ could not be read: ${e.message}`; }

  /* ── ARMS B and C · the halves that need the database ────────────────────── */
  const url = process.env.NEXUS_DB_URL;
  const replayUrl = process.env.NEXUS_BASELINE_REPLAY_URL;

  /* Run the repository's own generator against a connection and hand back the
     bytes. The header fields come from the committed file so that a matching
     database produces a matching file and only real drift can move them. */
  const regenerate = conn => {
    try {
      return { ok: true, out: execFileSync('node', [join(SUPA, 'tools', 'generate-baseline.mjs')], {
        encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 600 * 1000,
        env: { ...process.env, GEN_CONN: '', GEN_DB: conn,
               GEN_VERSION: baseVersion || '', GEN_VERSION_NAME: baseName || '', GEN_DATE: baseTaken || '' } }) };
    } catch (e) {
      const raw = (e.stderr ? String(e.stderr) : '') || String(e.message || e);
      return { ok: false, why: raw.trim().replace(/\s+/g, ' ').slice(0, 300) };
    }
  };
  const firstDifference = (a, b) => {
    const x = a.split('\n'), y = b.split('\n');
    for (let i = 0; i < Math.max(x.length, y.length); i++)
      if (x[i] !== y[i]) return `first difference at line ${i + 1}: committed "${String(x[i]).slice(0, 80)}" / regenerated "${String(y[i]).slice(0, 80)}"`;
    return 'they differ in trailing bytes only';
  };

  if (!why && !url) {
    unrun.push('B (the seed compared with the live rows) and C (the schema compared by regeneration) both need a SQL connection: no NEXUS_DB_URL');
  } else if (!why && url) {
    /* ARM B · the seed, by value. */
    const safe = s => /^[a-z_][a-z0-9_]*$/.test(String(s));
    const usable = seedTables.filter(t => safe(t.table) && t.cols.length && t.rows.length && t.cols.every(safe));
    const skipped = seedTables.filter(t => !usable.includes(t));
    if (!usable.length) unrun.push('B (the seed compared with the live rows): no table in the seed could be turned into a query this gate is willing to run');
    else {
      const q = "set time zone 'UTC';\nselect coalesce(json_agg(json_build_object('t',t,'n',n,'d',d)),'[]'::json)::text from (\n"
        + usable.map(t => `select '${t.table}' t, count(*) n, md5(string_agg(rd, chr(10) order by rd)) d from (select md5(concat_ws(chr(31), `
            + t.cols.map(c => `coalesce(${c}::text, '${NULLTOK}')`).join(', ') + `)) rd from public.${t.table}) z`).join('\nunion all\n')
        + '\n) q;';
      const r = psqlJson(url, q);
      if (!r.ok) unrun.push(`B (the seed compared with the live rows): ${r.why}`);
      else {
        const liveRows = new Map(r.value.map(x => [x.t, x]));
        for (const t of usable) {
          const l = liveRows.get(t.table);
          const fileD = tableDigest(t.rows);
          if (!l) { bad.push(`public.${t.table} is seeded by supabase/baseline/ and this database could not report it — the seed writes a table the database does not have`); continue; }
          if (l.d !== fileD) bad.push(`public.${t.table}: the seed's rows do not hash to the database's — file ${fileD}, database ${l.d}. `
            + (Number(l.n) === t.rows.length
                ? `THE ROW COUNTS MATCH (${l.n} both sides) AND THE CONTENT DOES NOT, which is the shape of the 4 Sep escaping defect: a restore would seed different text under the same keys.`
                : `The counts differ too: ${t.rows.length} in the file, ${l.n} in the database.`)
            + ' Regenerate the seed from this database; do not edit the file until it matches.');
          else if (Number(l.n) !== t.rows.length) bad.push(`public.${t.table}: ${t.rows.length} row(s) in the file and ${l.n} in the database, and yet the digests agree — read that as a defect in this check before believing it`);
        }
        ran.push(`B: ${usable.length} seeded table(s), ${usable.reduce((a, t) => a + t.rows.length, 0)} row(s), compared with the live rows value by value rather than counted`);
        if (skipped.length) ev.push(`B did not compare ${skipped.map(t => t.table).join(', ')} — a name in them is not a plain identifier and this gate will not build SQL out of one`);
      }
    }

    /* ARM C · the schema, by regeneration. */
    if (!baseVersion) unrun.push('C (the schema compared by regeneration): the committed baseline carries no version header, so a regeneration could not be made comparable to it');
    else {
      const g = regenerate(url);
      if (!g.ok) unrun.push(`C (the schema compared by regeneration): supabase/tools/generate-baseline.mjs could not run — ${g.why}`);
      else if (md5of(g.out) !== md5of(baseText)) {
        bad.push('the committed baseline is NOT what this database generates today. supabase/tools/generate-baseline.mjs, re-run against NEXUS_DB_URL with the version, name and date taken from the committed file so that only real drift can move the bytes, produced a different file. '
          + `${firstDifference(baseText, g.out)}. The file no longer describes the database, so a restore from it rebuilds something else — which is exactly what a baseline one afternoon stale did on 4 September.`);
        ran.push(`C: regenerated ${g.out.length} bytes against NEXUS_DB_URL and compared with the ${baseText.length} committed — they differ`);
      } else ran.push(`C: supabase/tools/generate-baseline.mjs re-run against NEXUS_DB_URL reproduces the committed file byte for byte (md5 ${md5of(baseText)}, ${baseText.length} bytes)`);
    }

    /* ARM C′ · the same comparison from a REPLAY, which is the claim itself. */
    if (!replayUrl) unrun.push("C' (replay into an empty PostgreSQL 17 and regenerate from the replica — the folder's own claim, executed): no NEXUS_BASELINE_REPLAY_URL");
    else if (replayUrl === url) bad.push('NEXUS_BASELINE_REPLAY_URL and NEXUS_DB_URL are the same connection string. The replay arm CREATES objects; it refuses to run against the database it is auditing.');
    else {
      const idA = psqlJson(url, IDENT_SQL), idB = psqlJson(replayUrl, IDENT_SQL);
      const empty = psqlJson(replayUrl, "select json_build_object('rels',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m')))::text;");
      if (!idB.ok) unrun.push(`C': the replay target could not be read: ${idB.why}`);
      else if (idA.ok && idA.value.fingerprint === idB.value.fingerprint)
        bad.push("C': NEXUS_BASELINE_REPLAY_URL spells the same database as NEXUS_DB_URL by another name — two connection strings, one database fingerprint. Refusing to replay a baseline into the database it was taken from.");
      else if (!empty.ok || Number(empty.value.rels) !== 0)
        unrun.push(`C': the replay target is not empty (${empty.ok ? `${empty.value.rels} relation(s) in public` : 'it could not be read'}). A replay must start from nothing or it proves nothing about what the baseline creates.`);
      else {
        const load = [['tools/verification-harness.sql', 'the harness'], [`baseline/${fBase}`, 'the baseline'],
                      [`baseline/${fHist}`, 'the history stamp'], [`baseline/${fSeed}`, 'the vocabulary seed']];
        let failed = null;
        for (const pair of load) {
          if (failed) break;
          try {
            execFileSync('psql', [replayUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', join(SUPA, pair[0])],
              { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 900 * 1000 });
          } catch (e) { failed = `${pair[1]} (${pair[0]}) did not replay: ${((e.stderr && String(e.stderr)) || String(e.message)).trim().replace(/\s+/g, ' ').slice(0, 300)}`; }
        }
        if (failed) {
          bad.push(`the restore path does not replay into an empty PostgreSQL 17: ${failed}. A baseline that cannot be replayed is a file, not a restore.`);
          ran.push("C': attempted the replay into NEXUS_BASELINE_REPLAY_URL and it did not complete");
        } else {
          const g2 = regenerate(replayUrl);
          if (!g2.ok) unrun.push(`C': the replay loaded and the generator could not read it back — ${g2.why}`);
          else if (md5of(g2.out) !== md5of(baseText)) {
            bad.push(`replaying supabase/baseline/ into an empty database does not reproduce the committed baseline: regenerating from the replica gives a different file. ${firstDifference(baseText, g2.out)}.`);
            ran.push("C': replayed and regenerated from the replica — it differs from the committed file");
          } else ran.push("C': replayed the harness, the baseline, the history stamp and the seed into an empty database and regenerated from the replica — byte-identical to the committed file, which is the folder's own claim, executed");
        }
      }
    }
  }

  const evidence = ev.concat(ran.map(x => `RAN — ${x}`), unrun.map(x => `NOT RUN — ${x}`));
  if (why) {
    FAIL('L12', LANE.LIVE, L12_SEV, L12_TITLE, [why,
      'until this folder is readable there is no restore path to check, and none should be claimed']);
  } else if (bad.length) {
    FAIL('L12', LANE.LIVE, L12_SEV, L12_TITLE, bad.concat(evidence));
  } else if (!ran.length) {
    NOTRUN('L12', LANE.LIVE, L12_SEV, L12_TITLE,
      `the folder is internally consistent and NOTHING in it was compared with a database. ${ev.join(' · ')}. ${unrun.join(' ; ')}. `
      + 'A baseline nobody diffed against the database is a claim, not a check — so this is NOT RUN and not PASS: the 4 September baseline would have satisfied every offline test here on the afternoon it would have restored the schema door open.');
  } else {
    PASS('L12', LANE.LIVE, L12_SEV, L12_TITLE, evidence);
    if (unrun.length) WARN('L12b', LANE.LIVE, 'P1', 'The baseline was checked, but not by every witness it has',
      unrun.concat(['Each line above is an arm of L12 that did not run. L12 passed on the arms that did, and this exists so the ones that did not are visible in the tally rather than buried in an evidence list.']));
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

/* ═══════════════════════════════════════════════════════════════════════════
   --no-db — see the header. The amnesty is bought by printing what it covers.
   ══════════════════════════════════════════════════════════════════════════ */
const NO_DB = flag('--no-db');
const OFFLINE_LANES = new Set([LANE.SOURCE, LANE.RENDER]);
const skippedLive   = results.filter(r => r.state === 'NOT RUN' && !OFFLINE_LANES.has(r.lane));
const unrunOffline  = results.filter(r => r.state === 'NOT RUN' &&  OFFLINE_LANES.has(r.lane) && r.severity === 'P0');

if (NO_DB) {
  console.log('\n════ --no-db · WHAT THIS RUN DID NOT CHECK ════');
  console.log(`${skippedLive.length} check(s) were SKIPPED. Every one of them needs a SQL connection, a service-role key or a`);
  console.log('signed-in account, and this run was told it has none. THEY ARE NOT PASSES. Nothing in them was');
  console.log('measured, no verdict above rests on them, and a release is not covered by this run until a human');
  console.log('has run the gate with NEXUS_DB_URL set. Each line says what would have been checked, and why it was not.\n');
  for (const r of skippedLive) {
    console.log(`SKIPPED  ${r.severity}  ${r.id.padEnd(5)} ${r.lane.padEnd(18)} ${r.title}`);
    console.log(`                     why: ${r.reason || 'no reason was recorded, which is itself a defect in this gate'}`);
  }
  if (!skippedLive.length) console.log('  (none — which would be a surprise with no database, and is worth reading as a defect in this gate)');
  if (unrunOffline.length) {
    console.log('\nAND THESE ARE NOT COVERED BY --no-db. They need no database, and they still did not run:');
    for (const r of unrunOffline) console.log(`  ${r.id} ${r.title} — ${r.reason}`);
    console.log('--no-db forgives the LIVE lane only. An offline check that could not run is a hole in this run, not a skip.');
  }
}

const code = NO_DB
  ? (blocking.length ? 1 : (unrunOffline.length ? 2 : 0))
  : (blocking.length ? 1 : (unrun.length ? 2 : 0));

const md = opt('--report');
if (md) {
  const esc = s => String(s).replace(/\|/g, '\\|');
  const body = rows.map(r =>
    `### ${r.id} · ${r.title}\n\n**${r.state}** · ${r.severity} · ${r.lane}\n\n`
    + (r.reason ? `_Could not run: ${r.reason}_\n\n` : '')
    + (r.evidence.length ? r.evidence.map(e => `- ${esc(e)}`).join('\n') + '\n' : '')).join('\n');
  const tally = st => results.filter(r => r.state === st).length;
  const codeNow = code;
  await writeFile(md, `# NEXUS OS — quality gate\n\nRun ${new Date().toISOString()}\n\n`
    + `**PASS ${tally('PASS')} · FAIL ${tally('FAIL')} · WARN ${tally('WARN')} · NOT RUN ${tally('NOT RUN')} · exit ${codeNow}**\n\n`
    + `Schema source: ${SCHEMA_IS_LIVE ? 'LIVE' : 'SNAPSHOT'} (${SCHEMA_TAKEN})\n\n`
    + `Live lane: ${live.cat ? `RAN — catalogue from ${live.how}` : `NOT RUN — ${live.why || 'no live database connection'}`}\n\n`
    + `A NOT RUN is not a PASS. Exit 2 means nothing failed and something launch-critical could not be checked.\n\n${body}\n`);
  console.log(`\nreport written to ${md}`);
}

console.log(`\nexit ${code}  —  ${
  code === 1 ? `${blocking.length} launch-critical check(s) FAILED`
  : code === 2 ? (NO_DB
      ? `${unrunOffline.length} check(s) that need no database still could not run; --no-db does not cover those`
      : `nothing failed, but ${unrun.length} launch-critical check(s) could not run; a check that could not run is not a check that passed`)
  : NO_DB
      ? `every check that needs no database ran and passed, and ${skippedLive.length} that need one were SKIPPED and are listed above — this run is not a full gate`
      : 'every launch-critical check ran and passed'}`);
process.exit(code);
