#!/usr/bin/env python3
import json, os

REPO = os.path.expanduser("~/nexus-work")
AUDIT = os.path.join(REPO, "ops", "audit-2026-09-21", "n8n-audit.json")
rows = json.load(open(AUDIT))

VERDICTS = {
    "7-Day Warm Lead Drip Campaign": ("NEEDS_FIX", "4/6 errors this week are real (leads with no email abort the drip, not adversarial tests); reply hardcodes WAHA session 'default'."),
    "Ask-AI — RAG Query Agent": ("NOT_TESTED", "0 executions ever; never exercised end to end."),
    "Competitor Price Scraping & Supabase Update": ("READY", "14/14 success in 7d, no errors, no missing timeout/onError."),
    "Customer 360 - Data Aggregation (Bitrix24)": ("NEEDS_FIX", "8/8 success but 2 external calls (dealership list, customer directory) have no onError -- a silent skip would go unnoticed."),
    "Finance Calc: Auto Loan Equity & Credit Score": ("READY", "1 success, 2 errors -- both are correct fail-closed tenant-mismatch rejections, not bugs."),
    "Google Ads Lead Form - Inbound Receiver": ("NOT_TESTED", "0 executions ever (confirmed); no errorWorkflow, no save settings configured either -- Google Ads leads are not flowing in at all."),
    "Inventory Ageing Recompute": ("READY", "7/7 success; minor: 2 nodes missing onError, 1 missing timeout, low business risk."),
    "KYC/AML Document Auditor + Re-upload Loop (Phase 5)": ("NOT_TESTED", "0 executions ever; hardcodes WAHA session 'default' for outbound KYC messages -- unverified in production."),
    "Lead Escalation - AI Agent": ("NEEDS_FIX", "137/158 (87%) executions this week are real errors: 'lead lookup returned no row' -- escalation email is silently not sent for most hot leads. Confirmed via 25/25 sampled error executions across the full 7d set."),
    "Meta Lead Ads - Inbound Receiver": ("NOT_TESTED", "0 executions ever (confirmed); Zapier/Make wiring for Meta Lead Ads is not live."),
    "NEW: Rescore Pending Leads (Hourly)": ("READY", "6/6 success in 7d; 1 external call (Get Active Dealerships) missing onError, low volume risk."),
    "NEXUS Appointment Booking — CANDIDATE (do not activate)": ("BLOCKED", "Inactive, unpublished, marked do-not-activate in its own name; never ran."),
    "NEXUS Error Handler": ("NEEDS_FIX", "0 executions EVER despite 150+ upstream failures this week citing errorWorkflow=this workflow -- the central alert path is dead; failures are producing no owner notification."),
    "NEXUS Infra Health Probe": ("NEEDS_FIX", "Active with a 15-minute schedule trigger but 0 executions ever -- health monitoring is not actually running."),
    "NEXUS Master Lead Router - AI Agent": ("NEEDS_FIX", "22 success / 10 error (31%) in 7d; 8 of 10 sampled errors are LLM node failures (free-tier OpenRouter models), not adversarial tests -- real leads are failing to score/route at the single entry point for all inbound leads."),
    "NEXUS Public — Home": ("NOT_TESTED", "0 executions in 7d; static page, no external traffic recorded."),
    "NEXUS Public — Privacy": ("NOT_TESTED", "0 executions in 7d; static page, no external traffic recorded."),
    "NEXUS Public — Terms": ("NOT_TESTED", "0 executions in 7d; static page, no external traffic recorded."),
    "NEXUS Retention Purge": ("READY", "7/7 success, no errors."),
    "NEXUS Site Enquiry to Gmail Notification": ("BLOCKED", "Inactive, unpublished (replaced by Resend per project history); hardcoded Gmail recipient if ever reactivated."),
    "Phase 6 - 12-Hour Silence Detector": ("READY", "166/168 success, 2 canceled (consistent with adversarial run), healthy hourly cadence."),
    "Slack Command Center - AI Agent": ("NOT_TESTED", "0 executions ever; 'Tenant For JWT User' node has no onError, unverified."),
    "Sync Closed-Won Deals to Supabase pgvector": ("READY", "1 success, 2 errors -- correct fail-closed tenant-mismatch rejections; note missing timeout/onError on the embedding+upsert pair for when volume increases."),
    "WhatsApp BDC AI Agent": ("NEEDS_FIX", "1642/1644 success (very healthy today) but the reply node hardcodes session:'default' regardless of which tenant the inbound resolved to -- correct only because a single dealership is live; the moment a second WAHA session/dealership goes live, replies will be sent from the wrong dealership's WhatsApp number."),
    "WhatsApp BDC — TENANT SCOPED CANDIDATE (do not activate)": ("BLOCKED", "Inactive, unpublished, do-not-activate candidate -- appears to be the fix for the session-hardcode bug above, not yet rolled out."),
    "WhatsApp Cloud - Inbound Receiver (Meta)": ("READY", "2/2 success, low volume; 2 external nodes missing onError, low risk at current volume."),
    "WhatsApp Send (Dashboard Reply)": ("NOT_TESTED", "0 executions in 7d; also hardcodes WAHA session 'default' -- same latent multi-tenant risk as the BDC agent, unverified since unused."),
    "wf_108 ERP Sync - Bitrix24 CRM": ("NEEDS_FIX", "17/17 success, no errors, but BITRIX24_WEBHOOK_URL is a single shared env var -- every tenant's ERP sync writes into the same Bitrix24 account (single-tenant sink)."),
}

for r in rows:
    v = VERDICTS.get(r["name"])
    if v:
        r["verdict"], r["verdict_reason"] = v
    else:
        r["verdict"], r["verdict_reason"] = ("NOT_TESTED", "Not classified -- review manually.")

json.dump(rows, open(AUDIT, "w"), indent=2)
print("patched", len(rows), "rows with verdicts")

from collections import Counter
c = Counter(r["verdict"] for r in rows)
print(c)
