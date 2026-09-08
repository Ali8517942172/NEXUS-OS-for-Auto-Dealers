# NEXUS OS AI Automation Engine

Central nervous system that connects all NEXUS OS modules through event-driven workflows.

## Automation Stack
- **n8n** - Sole workflow automation, AI agent, and RAG engine (self-hosted, Docker)
- **WAHA** - Self-hosted WhatsApp HTTP API (QR-based), feeds n8n via webhook
- **Webhooks** - Real-time event processing

> Zapier and Make.com have been fully removed — n8n is the only automation engine, with no secondary/backup automation platform.

## Deployed Workflows

### 1. Lead to CRM Pipeline (`lead_to_crm_pipeline.json`)
```
Website Form / WhatsApp / Phone
        ↓
   Webhook Intake
        ↓
  Sales Agent (Lead Scoring)
        ↓
   HOT Lead? ──── YES ──→ CRM + WhatsApp + Slack Alert
        │
        NO ──→ CRM + Welcome Email
```
**Business Impact:** Reduces lead response time from 2 hours to < 5 minutes.

### 2. Daily Competitor Intelligence (`daily_competitor_intel.json`)
```
   Cron (6 AM Daily)
        ↓
   Scrape Competitors
        ↓
  Marketing Agent (Price Analysis)
        ↓
   Slack Report + CRM Price Alerts
```
**Business Impact:** Enables real-time price matching, preventing lost sales due to uncompetitive pricing.

## Environment Variables Required
```env
CRM_API_URL=http://localhost:5000
CRM_API_KEY=your_crm_api_key
MARKETING_API_URL=http://localhost:5001
N8N_WEBHOOK_URL=https://35.224.126.225.nip.io
WHATSAPP_API_KEY=your_whatsapp_key
SLACK_WEBHOOK_URL=your_slack_webhook
```

## Integration Map
| Source | → | Destination | Trigger |
|--------|---|-------------|---------|
| Website Form | → | CRM | Webhook (real-time) |
| WhatsApp | → | CRM | Webhook (real-time) |
| Competitor Scraper | → | CRM + Slack | Cron (daily) |
| CRM Deal Closed | → | Bitrix24 CRM | Webhook (real-time) |
| Service Ticket | → | RAG + Manager | Webhook (real-time) |
| Inventory Aged 90+ days | → | Marketing OS | Cron (weekly) |
