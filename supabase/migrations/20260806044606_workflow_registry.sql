-- audit_log only records workflows that have actually run, so the Automation
-- screen could only ever show 4 of 13. A workflow that has NEVER run is the most
-- important thing an ops screen can tell you. This registry is the full list.
CREATE TABLE IF NOT EXISTS workflow_registry (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  audit_name    text,
  trigger_type  text NOT NULL CHECK (trigger_type IN ('webhook','schedule','sub-workflow','manual')),
  trigger_detail text,
  category      text,
  is_active     boolean NOT NULL DEFAULT true,
  description   text
);

INSERT INTO workflow_registry (id,name,audit_name,trigger_type,trigger_detail,category,description) VALUES
 ('JnlZFAVmFAuNXVya','NEXUS Master Lead Router','Master Router','webhook','nexus-inbound-lead','Lead','AI-scores every inbound lead, applies the VIP override for returning customers and routes HOT/WARM/COLD.'),
 ('bxNBzBrcOtcFpMPn','wf_108 ERP Sync - Bitrix24','wf_108 ERP Sync - Bitrix24','webhook','erp-sync','CRM','Pushes HOT leads into Bitrix24. Idempotent: looks each lead up by email and updates rather than duplicating.'),
 ('KI6P1Qcf3MIZakNa','Lead Escalation - AI Agent','Lead Escalation','webhook','lead-escalation','Lead','Sends the escalation email via Resend and alerts #sales-hot-leads on Slack.'),
 ('BiyHk9ZXxJUVGbf6','WhatsApp BDC AI Agent',NULL,'webhook','whatsapp-inbound','Comms','Two-way WhatsApp agent over WAHA with RAG, finance and pricing tools.'),
 ('VmnIXo7tM30zqawp','Slack Command Center - AI Agent',NULL,'webhook','slack-command','Comms','Slack slash-command entry point into the AI agent.'),
 ('G7FhvMY2ucW5Fg7X','7-Day Warm Lead Drip Campaign',NULL,'webhook','lead-trigger','Marketing','Timed email sequence for WARM and COLD leads: day 1, day 3, day 7.'),
 ('qHAtd3RckAKRBUkE','Ask-AI - RAG Query Agent',NULL,'webhook','ask-ai','AI','Full-text search over rag_documents, then a grounded, cited answer.'),
 ('unMMpeL9uuPO79pp','Finance Calc: Auto Loan Equity & Credit Score',NULL,'webhook','finance-calc','Finance','Computes equity, loan-to-value, finance tier and indicative APR.'),
 ('qTnh3nwWheFJbFkU','KYC/AML Document Auditor (Phase 5)','KYC Auditor - Phase 5','webhook','audit-kyc','Compliance','Vision audit of KYC documents with a 3-attempt re-upload loop, then Slack escalation.'),
 ('LphiGg4iqF1bn6El','Competitor Price Scraping',NULL,'schedule','every 24 h','Pricing','Refreshes the competitors table and regenerates AI pricing recommendations.'),
 ('AZkGM5M4c1uzSH7S','Customer 360 - Data Aggregation',NULL,'schedule','cron 0 2 * * *','CRM','Aggregates Gmail and Slack activity per customer into customer_360_profiles.'),
 ('dhy2DDjWUqwuzHLW','Sync Closed-Won Deals to pgvector',NULL,'webhook','deals/closed-won','AI','Embeds closed-won deals into deals_embeddings for similarity search.'),
 ('B3TcpfzOMWj8oWgF','Phase 6 - 12-Hour Silence Detector',NULL,'schedule','hourly','Lead','Finds leads with no reply 12 h after our last outbound message and escalates.')
ON CONFLICT (id) DO UPDATE SET
  name=excluded.name, audit_name=excluded.audit_name, trigger_type=excluded.trigger_type,
  trigger_detail=excluded.trigger_detail, category=excluded.category, description=excluded.description;

ALTER TABLE workflow_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_registry_read ON workflow_registry;
CREATE POLICY workflow_registry_read ON workflow_registry FOR SELECT TO authenticated USING (true);