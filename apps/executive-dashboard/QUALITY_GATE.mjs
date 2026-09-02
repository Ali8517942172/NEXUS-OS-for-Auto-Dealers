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
  takenAt: '2026-09-02T18:30:00Z',
  source: 'live catalogue, information_schema.columns + pg_class + pg_proc + pg_policies (project dsvuoovivysszdoiorch)',
  relations: {
    audit_log: 'id,workflow,status,lead_name,lead_email,lead_score,intent,summary,logged_at,tenant_id',
    communication_logs: 'id,lead_email,channel,direction,message,created_at,sent_by,tenant_id',
    competitors: 'id,competitor,model,price_aed,our_price_aed,price_diff_aed,ai_recommendation,scraped_at,listing_title,source_host,source_kind,offer_name,offer_condition,match_quality,match_note,tenant_id',
    customer_360_profiles: 'id,customer_id,name,email,phone,total_emails,total_slack_messages,last_synced_at,tenant_id',
    daily_metrics: 'snapshot_date,open_leads,hot_leads,warm_leads,cold_leads,avg_response_minutes,pipeline_aed,units_at_risk,holding_cost_aed,workflow_runs,workflow_failures,captured_at,workflow_failures_rule,workflow_failures_canonical,pipeline_aed_rule,open_leads_rule,tenant_id',
    deals_embeddings: 'id,deal_id,content,embedding,created_at,tenant_id',
    finance_quotes: 'id,lead_email,lead_name,quoted_by,vehicle_value_aed,loan_payoff_aed,credit_score,equity_aed,equity_status,loan_to_value_pct,finance_tier,indicative_apr_pct,disclaimer,source,created_at,vehicle_price_aed,max_ltv_pct,min_down_payment_aed,down_payment_aed,down_payment_pct,down_payment_assumed,trade_in_equity_applied_aed,financed_aed,tenure_months,monthly_payment_low_aed,monthly_payment_high_aed,total_cost_of_credit_low_aed,total_cost_of_credit_high_aed,indicative_apr_high_pct,calculation_id,execution_id,calculated_at,apr_source,ltv_policy_source,tenant_id',
    inventory: 'id,model,vin,status,days_in_stock,price_aed,cost_aed,gross_margin,holding_cost_accrued,net_margin,recommended_commission,vat_amount,aging_alert,ai_recommendation,acquired_at,tenant_id',
    inventory_action_events: 'id,tenant_id,action_id,at,event,actor_staff_id,actor_auth_id,actor_authority,detail,audit_log_id',
    inventory_action_policy: 'tenant_id,approver_tenant_roles,approver_staff_roles,reproposal_cooldown_days,set_by,set_at,note',
    inventory_action_reason_codes: 'code,applies_to,label,meaning,engine_was_wrong,sort',
    inventory_actions: 'id,tenant_id,unit_id,recommendation,engine_reason,engine_confidence,engine_confidence_basis,engine_impact_aed,engine_impact_kind,engine_impact_basis,engine_overall_risk,engine_days_in_stock,engine_gross_margin_aed,engine_owner_role,engine_evidence,engine_computed_at,status,proposed_at,proposed_by_staff_id,proposed_source,decided_at,decided_by_staff_id,decided_by_auth_id,decided_by_authority,decision_reason_code,decision_note,defer_until,assigned_to_staff_id,assigned_role,assigned_at,executed_at,executed_by_staff_id,execution_note,execution_failure,outcome_state,outcome_purchase_id,outcome_recorded_at,outcome_recorded_by_staff_id,attribution_basis,attribution_note,recovered_value_aed,recovered_value_basis,escalated_at,escalation_reason,created_at,updated_at',
    inventory_profit_settings: 'tenant_id,holding_cost_per_day_aed,holding_cost_source,holding_cost_verified_at,aging_warn_days,aging_critical_days,promote_days,wholesale_days,min_reprice_margin_pct,market_tolerance_pct,enquiry_window_days,min_enquiry_sources,updated_at,holding_cost_basis,holding_cost_set_by,min_model_token_overlap,accepted_market_match_quality,market_max_age_days',
    kyc_documents: 'id,lead_email,lead_name,chat_id,document_type,full_name,date_of_birth,expiry_date,is_valid,tampering,confidence_score,remarks,attempt_number,max_attempts,verdict,reviewed_by,reviewed_at,created_at,storage_path,retain_until,purged_at,void_reason,voided_at,tenant_id',
    leads: 'id,name,email,phone,source,vehicle_interest,budget_aed,status,ai_score,assigned_to,response_time_minutes,created_at,assigned_to_id,escalated_at,bitrix_lead_id,crm_synced_at,tenant_id',
    processed_messages: 'message_id,source,chat_id,processed_at,tenant_id',
    purchase_history: 'id,customer_name,email,phone,vehicle,purchase_date,amount_aed,created_at,deal_id,lead_id,tenant_id',
    rag_documents: 'id,doc_title,section,content,source_file,page_number,search_vector,tenant_id',
    tenant_members: 'tenant_id,auth_user_id,role,staff_user_id,created_at',
    tenants: 'id,slug,name,status,is_unattributed_default,created_at',
    users: 'id,name,email,role,status,slack_user_id,created_at,tenant_id',
    v_competitor_latest: 'id,competitor,model,price_aed,our_price_aed,price_diff_aed,ai_recommendation,scraped_at,listing_title,source_host,source_kind,offer_name,offer_condition,match_quality,match_note',
    v_conversations: 'thread_key,chat_id,phone,push_name,lead_email,lead_name,lead_status,display_name,identified,message_count,inbound_count,outbound_count,last_message_at,last_message,last_direction,awaiting_reply,msg_count,internal_count,msg_inbound_count,msg_outbound_count,last_msg_at,last_msg,last_msg_direction,awaiting_msg_reply',
    v_customer_360: 'email,name,phone,lead_count,best_ai_score,latest_status,purchase_count,lifetime_value_aed,last_purchase_date,is_vip,message_count,last_contact_at,total_emails,total_slack_messages',
    v_customer_directory: 'id,name,email,phone,source_records,last_seen_at,tenant_id',
    v_fin_gate_quote_evidence: 'id,lead_email,lead_name,quoted_by,created_at,calculated_at,calculation_id,execution_id,indicative_apr_pct,indicative_apr_high_pct,monthly_payment_low_aed,monthly_payment_high_aed,is_evidenced,evidence_note,has_instalment',
    v_inventory_action_queue: 'id,tenant_id,unit_id,unit_model,unit_vin,unit_status,unit_price_aed,unit_cost_aed,status,is_live,awaiting_decision,deferral_now_due,recommendation,engine_reason,engine_confidence,engine_confidence_basis,engine_impact_aed,engine_impact_kind,engine_impact_basis,engine_overall_risk,engine_days_in_stock,engine_gross_margin_aed,engine_owner_role,engine_evidence,engine_computed_at,engine_now_recommendation,engine_now_risk,engine_now_days_in_stock,engine_now_impact_aed,engine_now_reason,engine_still_agrees,proposed_at,proposed_by_name,proposed_source,decided_at,decided_by_name,decided_by_job_title,decided_by_authority,decision_reason_code,decision_reason_label,decision_reason_meaning,decision_says_engine_was_wrong,decision_note,defer_until,assigned_to_staff_id,assigned_to_name,assigned_role,assigned_at,executed_at,executed_by_name,execution_note,execution_failure,escalated_at,escalation_reason,outcome_state,outcome_purchase_id,outcome_sale_vehicle,outcome_sale_amount_aed,outcome_sale_date,outcome_recorded_at,outcome_recorded_by_name,attribution_basis,attribution_note,recovered_value_aed,recovered_value_basis,outcome_sentence,cost_of_doing_nothing,days_open,created_at,updated_at',
    v_inventory_action_timeline: 'id,tenant_id,action_id,at,event,actor_name,actor_job_title,actor_authority,detail,audit_log_id,audit_status,audit_outcome_class,audit_summary',
    v_inventory_profit_sentinel: 'tenant_id,id,model,vin,status,acquired_at,days_in_stock,aging_band,days_to_warning,days_to_critical,cost_aed,price_aed,gross_margin_aed,gross_margin_pct,capital_tied_aed,holding_cost_per_day_aed,holding_cost_basis,holding_cost_source,holding_cost_set_by,holding_cost_verified_at,holding_cost_accrued_aed,holding_cost_state,holding_cost_note,net_margin_aed,net_margin_state,net_margin_note,market_position,market_competitor,market_price_aed,market_match_quality,market_scraped_at,market_note,demand_signal,enquiries_in_window,enquiry_leads,enquiry_messages,enquiry_last_at,enquiry_source_rows,enquiry_resolved_rows,enquiry_window_days,enquiry_coverage,enquiry_note,age_risk,age_risk_rank,margin_risk,margin_risk_rank,overall_risk,overall_risk_rank,risk_basis,recommendation,reason,confidence,confidence_basis,impact_aed,impact_kind,impact_basis,suggested_owner_role,suggested_owner_state,suggested_owner_note,human_approval_required,automation_state,evidence,warn_days,crit_days,promote_days,wholesale_days,min_margin_pct,tol_pct,min_enq_sources,min_model_token_overlap,market_max_age_days,settings_are_defaults,computed_at',
    v_inventory_sales: 'id,model,status,price_aed,days_in_stock,tenant_id',
    v_lead_messages: 'lead_id,id,created_at,channel,direction,message,lead_email,is_message',
    v_needs_attention: 'kind,severity,ref,title,detail,at,screen',
    v_team_performance: 'id,name,email,role,status,leads_assigned,hot_leads,avg_response_minutes,within_sla,breached_sla,pipeline_aed',
    v_workflow_health: 'id,name,category,trigger_type,trigger_detail,description,is_active,writes_audit_log,runs,failures,escalations,runs_30d,failures_30d,partials_30d,no_result_30d,rejected_30d,escalated_30d,successes_30d,unknown_30d,effective_runs_30d,success_rate_30d,success_rate,last_run,last_success,last_failure,last_partial,last_incomplete,health',
    whatsapp_contacts: 'chat_id,phone,push_name,lead_email,first_seen,last_seen,message_count,tenant_id',
    workflow_registry: 'id,name,audit_name,trigger_type,trigger_detail,category,is_active,description,writes_audit_log,audit_aliases',
  },
  /* Every function PostgREST will expose at /rest/v1/rpc/<name>, with the two
     properties the tenancy checks turn on: does it run as its definer, and does
     it take a tenant as an ARGUMENT (a tenant a caller supplies is a tenant a
     caller can forge — see action_write_audit in CLAUDE.md). */
  rpcs: {
    action_approver_context:      { secdef: true,  tenantArg: false, grants: ['authenticated', 'service_role'] },
    action_cancel:                { secdef: true,  tenantArg: false, grants: ['authenticated', 'service_role'] },
    action_decide:                { secdef: true,  tenantArg: false, grants: ['authenticated', 'service_role'] },
    action_mark_executed:         { secdef: true,  tenantArg: false, grants: ['authenticated', 'service_role'] },
    action_mark_not_attributable: { secdef: true,  tenantArg: false, grants: ['authenticated', 'service_role'] },
    action_outcome_candidates:    { secdef: true,  tenantArg: false, grants: ['authenticated', 'service_role'] },
    action_propose:               { secdef: true,  tenantArg: false, grants: ['authenticated', 'service_role'] },
    action_record_outcome:        { secdef: true,  tenantArg: false, grants: ['authenticated', 'service_role'] },
    action_write_audit:           { secdef: true,  tenantArg: true,  grants: ['service_role'] },
    assign_hot_lead:              { secdef: true,  tenantArg: false, grants: ['service_role'] },
    capture_daily_metrics:        { secdef: true,  tenantArg: false, grants: ['service_role'] },
    nexus_current_tenant_id:      { secdef: true,  tenantArg: false, grants: ['authenticated', 'service_role'] },
    nexus_current_tenant_ids:     { secdef: true,  tenantArg: false, grants: ['authenticated', 'service_role'] },
    nexus_default_tenant_id:      { secdef: true,  tenantArg: false, grants: ['authenticated', 'service_role'] },
    nexus_onboard_dealership:     { secdef: true,  tenantArg: false, grants: ['service_role'] },
    nexus_scoped_tenant_id:       { secdef: true,  tenantArg: false, grants: ['authenticated', 'service_role'] },
    nexus_tenancy_readiness:      { secdef: true,  tenantArg: false, grants: ['service_role'] },
    recompute_inventory_derived:  { secdef: true,  tenantArg: false, grants: ['authenticated', 'service_role'] },
    search_rag_documents:         { secdef: false, tenantArg: true,  grants: ['anon', 'authenticated', 'service_role'] },
    sentinel_inventory_actions:   { secdef: false, tenantArg: false, grants: ['authenticated', 'service_role'] },
  },
  /* The observed shape of the Profit Sentinel, so a silent change from UNKNOWN
     to a number is detectable. Twelve units, and not one computable economic
     figure — that is the honest state of the product on this date. */
  sentinel: {
    units: 12,
    holding_cost_state: { NOT_COMPUTABLE: 12 },
    net_margin_state:   { NOT_COMPUTABLE: 12 },
    market_position:    { UNKNOWN_NO_COMPARABLE: 7, UNKNOWN_UNVERIFIED_COMPARABLE: 5 },
    demand_signal:      { UNKNOWN_LOW_COVERAGE: 12 },
    enquiry_coverage:   { INSUFFICIENT: 12 },
    holding_cost_accrued_aed_not_null: 0,
    net_margin_aed_not_null: 0,
    holding_rate_set: false,
  },
  ledger: { actions: 3, events: 7, events_with_audit: 7, audit_rows_referenced: 6, orphan: 0, dangling: 0, tenant_mismatch: 0 },
  tenancy: { tenants: 1, tables_with_rls: 23, tables_without_rls: 0, views_without_security_invoker: 0, policies: 69 },
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
  'open_policies', (select coalesce(json_agg(json_build_object(
       'table', tablename, 'policy', policyname, 'roles', roles, 'cmd', cmd)),'[]'::json)
     from pg_policies where schemaname='public'
       and (coalesce(qual,'')='true' or coalesce(with_check,'')='true')
       and array_to_string(roles,',') <> 'service_role'),
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
                       where lower(al) = lower(a.workflow))))
)::text;`.replace(/\n\s*'sentinel', \(select json_build_object\([\s\S]*?\) z\),/, '');

async function loadCatalogue() {
  const file = opt('--catalogue');
  if (file) {
    try { return { how: `--catalogue ${file}`, cat: JSON.parse(await readFile(file, 'utf8')) }; }
    catch (e) { return { how: null, why: `--catalogue ${file} could not be read: ${e.message}` }; }
  }
  const url = process.env.NEXUS_DB_URL;
  if (!url) return { how: null, why: 'no NEXUS_DB_URL and no --catalogue file; the live lane needs a SQL connection because RLS, EXECUTE grants, security_invoker and function bodies are catalogue facts PostgREST does not expose' };
  try { execSync('command -v psql', { stdio: 'ignore' }); }
  catch { return { how: null, why: 'NEXUS_DB_URL is set but psql is not on PATH' }; }
  try {
    const out = execFileSync('psql', [url, '-Atqc', CATALOGUE_SQL], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { how: 'psql via NEXUS_DB_URL', cat: JSON.parse(out.trim()) };
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
  const next = { ...SNAPSHOT, takenAt: new Date().toISOString().replace(/\.\d+/, ''),
    source: live.how || 'PostgREST OpenAPI root',
    relations: Object.fromEntries(Object.entries(RELATIONS).map(([k, v]) => [k, v.join(',')])) };
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

/* ── S9 · exposure is not recovery, and recovery needs the sale on the row ──
   PRODUCT.md: estimated, attributed and confirmed are three different words and
   must never be interchanged on a screen. inventory_actions carries the CHECK
   inventory_actions_recovered_needs_real_sale, so a recovered value cannot be
   STORED without an ATTRIBUTED outcome, a purchase_history row, an attribution
   basis and a value basis.

   A stored constraint is not a rendering rule, and this check is deliberately
   about the rendering. `recovered_value_aed != null` is a test of one column;
   the sentence beside it ("a recorded sale tied to it by a person", "attributed")
   is a claim about four. A screen that makes the four-column claim on the
   one-column test has no way to notice when they disagree, and the figure it
   prints is money. So the guard has to name the evidence: outcome_purchase_id,
   or outcome_state = 'ATTRIBUTED'. */
{
  const bad = [];
  const EVIDENCE = /outcome_purchase_id|ATTRIBUTED|outcome_state/;
  for (const [path, { code }] of SRC) {
    const lines = code.split('\n');
    lines.forEach((line, i) => {
      const renders = /recovered_value_aed/.test(line) && /aed\(|expose\(|filter\(|reduce\(/.test(line);
      if (!renders) return;
      const near = lines.slice(Math.max(0, i - 8), i + 9).join('\n');
      if (!EVIDENCE.test(near))
        bad.push(`${path}:${i + 1}: a recovered value is rendered on a null-check of one column while the words beside it claim an attributed sale — ${line.trim().slice(0, 110)}`);
    });
    code.split('\n').forEach((line, i) => {
      if (/(engine_)?impact_aed/.test(line) && /\b(recovered|saved|expected revenue)\b/i.test(line))
        bad.push(`${path}:${i + 1}: exposure described as recovered/saved/expected — ${line.trim().slice(0, 110)}`);
    });
    if (/impact_aed/.test(code) && !/at risk/i.test(SRC.get(path).raw))
      bad.push(`${path}: shows engine impact with no "at risk" framing anywhere in the file`);
  }
  verdict('S9', LANE.SOURCE, 'P0', 'Exposure is never called recovery, and recovery names its sale', [...new Set(bad)],
    ['every render of recovered_value_aed is guarded by the outcome evidence, not by a null check',
     'live: recovered_value_aed is null on all 3 inventory_actions rows, so this is latent, not visible today']);
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
      /* THE FABRICATED RECOVERY. Nothing behind it. Must not render as money. */
      at('a-forged',   { status: 'EXECUTED', is_live: false, awaiting_decision: false,
        outcome_state: 'NONE_YET', outcome_purchase_id: null, attribution_basis: null,
        recovered_value_basis: null, recovered_value_aed: 250000 }),
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
    for (const id of ['inventory', 'actions', 'overview']) {
      const t = r.screens[id]?.text || '';
      if (/AED\s*0(?![\d.,])/.test(t)) bad.push(`${id}: renders "AED 0" while every economic figure served was null`);
      if (/\b0\.0\s*%/.test(t)) bad.push(`${id}: renders "0.0%" while every economic figure served was null`);
    }
    const inv = r.screens.inventory?.text || '';
    const saysUnknown = /not computable|no holding rate|unknown|cannot|not enough|insufficient/i.test(inv);
    if (!saysUnknown) bad.push('inventory: renders no words for the UNKNOWN states it was served');
    verdict('R4', LANE.RENDER, 'P0', 'An uncomputable figure renders as words, never as zero', bad,
      ['served: holding_cost_accrued_aed null / NOT_COMPUTABLE, net_margin_aed null / NOT_COMPUTABLE, market UNKNOWN_NO_COMPARABLE, demand UNKNOWN_LOW_COVERAGE — the live shape on 12 of 12 units',
       'no "AED 0" and no "0.0%" reached inventory, actions or overview']);
  }

  /* R5 · the forged recovery. One queue row carries recovered_value_aed 250000
     with no purchase, no attribution basis and outcome_state NONE_YET. The
     database CHECK makes that row unstorable; this proves the SCREEN refuses it
     too, which is a different guarantee and the one a customer sees. */
  {
    const bad = [];
    for (const id of ['actions', 'overview']) {
      const t = r.screens[id]?.text || '';
      /* Unambiguous on purpose: 250,000 appears nowhere else in the stub, so a
         match is the forged figure and nothing else. A fuzzy test on the word
         "recovered" was tried and discarded — every honest sentence about
         recovery contains it too, so it could only ever cry wolf. */
      if (/250,?000/.test(t)) bad.push(`${id}: rendered the forged recovered value of 250,000, which carries outcome_state NONE_YET, no outcome_purchase_id and no attribution_basis`);
    }
    verdict('R5', LANE.RENDER, 'P0', 'A fabricated recovered value is refused by the screen', bad,
      ['served a row with recovered_value_aed 250000, outcome_purchase_id null, attribution_basis null; it did not reach the page as money']);
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
  /* L2 */ verdict('L2', LANE.LIVE, 'P0', LIVE_CHECKS[1][1],
    (c.tables_no_rls || []).map(t => `${t}: RLS is off`).concat(
      (c.open_policies || []).filter(p => !/reason_codes|workflow_registry/.test(p.table))
        .map(p => `${p.table}/${p.policy}: USING(true) for ${p.roles}`)),
    [`${(c.tables_no_rls || []).length} tables without RLS`,
     'the two remaining USING(true) SELECT policies are on inventory_action_reason_codes and workflow_registry — reference tables that carry no tenant column and no customer data']);
  /* L3 */ verdict('L3', LANE.LIVE, 'P0', LIVE_CHECKS[2][1],
    (c.views_no_invoker || []).map(v => `${v}: no security_invoker — RLS on its base tables is evaluated as the view owner`),
    ['every view in public carries security_invoker']);
  /* L4 · the shape CLAUDE.md says has opened a hole three times, plus the
     stronger form: a definer function granted to authenticated whose body
     writes without a tenant predicate is a cross-tenant write. */
  {
    const bad = [];
    for (const f of c.functions || []) {
      const acl = f.acl || '';
      const toAuth = /(^|[|\s])authenticated=X/.test(acl) || /(^|[|\s])=X/.test(acl);
      if (!f.secdef || !toAuth) continue;
      if (/\bp_tenant\b/.test(f.args || ''))
        bad.push(`${f.name}(${f.args}): SECURITY DEFINER, EXECUTE to authenticated, and takes a tenant as an argument — a caller can name a tenant that is not theirs`);
      const writes = /\b(update|delete\s+from|insert\s+into)\s+(public\.)?\w+/gi;
      for (const m of String(f.body || '').matchAll(writes)) {
        const after = String(f.body).slice(m.index, m.index + 900);
        if (!/tenant_id/i.test(after))
          bad.push(`${f.name}: SECURITY DEFINER, EXECUTE to authenticated, and its "${m[0].trim()}" carries no tenant predicate — it rewrites every dealership's rows`);
      }
    }
    verdict('L4', LANE.LIVE, 'P0', LIVE_CHECKS[3][1], [...new Set(bad)],
      ['every definer function reachable by authenticated resolves its tenant from the caller and scopes its writes']);
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
    const anonFns = (c.functions || []).filter(f => /(^|[|\s])anon=X/.test(f.acl || '') && READS.test(String(f.body || '')));
    const holes = anonFns.filter(f => f.secdef).map(f => `${f.name}: SECURITY DEFINER, anon holds EXECUTE, and the body reads a tenant-owned table with RLS bypassed`);
    verdict('L5', LANE.LIVE, 'P0', LIVE_CHECKS[4][1], holes,
      ['no SECURITY DEFINER function granted to anon reads tenant-owned data',
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
  /* L9 */ verdict('L9', LANE.LIVE, 'P0', LIVE_CHECKS[8][1],
    (c.unregistered_writers || []).map(w => `"${w}" writes audit_log rows and has no workflow_registry entry — v_workflow_health cannot see it, so its runs are invisible to every health surface in the product`),
    ['every distinct audit_log.workflow resolves to a registered workflow']);
  /* L10 */ verdict('L10', LANE.LIVE, 'P0', LIVE_CHECKS[9][1],
    c.bad_recovered ? [`${c.bad_recovered} inventory_actions rows claim a recovered value with no attributed sale behind them`] : [],
    ['0 rows; the CHECK inventory_actions_recovered_needs_real_sale holds']);
}

/* Checks that need a signed-in browser against a real database, and that no
   amount of stubbing can stand in for. Stated rather than silently absent. */
for (const [id, t, why] of [
  ['B1', 'A decide() call by a non-approver is refused by Postgres, not just greyed out in the UI',
   'needs a real signed-in session: the refusal is enforced in a SECURITY DEFINER function, and a stubbed RPC proves only what the UI does with the answer'],
  ['B2', 'Submitting the same decision twice produces one state change (idempotent=true on the second)',
   'needs a real session and a writable action; the gate is read-only against production and will not create one'],
  ['B3', 'A member of dealership A cannot see or act on dealership B\'s actions',
   'needs two signed-in sessions in two tenants; proven adversarially on 2026-09-02 per CLAUDE.md, not re-proven by this gate'],
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
  await writeFile(md, `# NEXUS OS — quality gate\n\nRun ${new Date().toISOString()}\n\n`
    + `Schema source: ${SCHEMA_IS_LIVE ? 'LIVE' : 'SNAPSHOT'} (${SCHEMA_TAKEN})\n\n${body}\n`);
  console.log(`\nreport written to ${md}`);
}

const code = blocking.length ? 1 : (unrun.length ? 2 : 0);
console.log(`\nexit ${code}  —  ${code === 0 ? 'every launch-critical check ran and passed'
  : code === 1 ? `${blocking.length} launch-critical check(s) FAILED`
  : `nothing failed, but ${unrun.length} launch-critical check(s) could not run; a check that could not run is not a check that passed`}`);
process.exit(code);
