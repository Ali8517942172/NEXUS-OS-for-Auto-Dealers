<!-- BUSINESS CONTEXT — added 2026-09-02 -->
> **This is a commercial product, not a demo.** NEXUS is a **Revenue Recovery &
> Action OS for dealerships** — it sits above the dealership's existing DMS, CRM
> and inventory systems, finds revenue leaks, decides the next best action and
> executes it. It replaces none of them. See `PRODUCT.md` for the thesis and
> `CLAUDE.md` for how to work here. Ali owns NEXUS OS and is selling it
> to real dealerships on a subscription. Judge changes by whether they make it
> sellable and keep it sellable. The honest commercial position today is a
> **controlled dealership pilot** — not "enterprise-ready", not "compliant".
> Never state more than the evidence supports; "wired but never fired" is a real
> answer. The blocker before a second paying dealership is that the system is
> **single-tenant**: every RLS policy is `USING (true)`, so tenant two would read
> tenant one's customers. See `CLAUDE.md` for how to work here.

# NEXUS OS

**NEXUS OS** is a production AI operating system for automotive dealerships that unifies CRM, Marketing, Knowledge Management, Sales Intelligence, Inventory Lifecycle, and Business Automation into a single platform.

The platform is designed to increase dealership profitability, reduce operational overhead, improve lead conversion, and enable AI-assisted decision making across every department. This is a live, production system built for a real paying dealership client.

---

## Business Problems This Platform Solves

| Problem | Current Manual Process | AI-Powered Solution |
|---------|----------------------|---------------------|
| Leads go cold | Salesperson manually checks inbox every few hours | AI scores and routes leads in < 60 seconds |
| No pricing intelligence | Manager guesses competitor pricing | Daily automated competitor scraping with AI recommendations |
| Slow customer answers | Employee searches through PDF folders | RAG-powered Knowledge Assistant with source citations |
| Revenue leakage | Commission and margin calculated in Excel | Real-time financial intelligence with automated costing |
| Disconnected systems | Copy-paste between CRM, ERP, WhatsApp, Email | Event-driven automation connecting all platforms |
| Vehicle aging losses | Nobody tracks holding costs until it's too late | AI flags aging inventory and suggests price reductions |
| Slow onboarding | New hires take weeks to learn policies | Knowledge Agent answers any policy question instantly |

---

## Platform Modules

### 1. AI-Powered CRM
**Business Problem:** Leads from multiple channels (website, WhatsApp, walk-ins, referrals) are handled inconsistently. Response times vary from minutes to days. No standardized qualification process.

**Solution:** AI-first CRM that automatically scores every lead, assigns priority, routes to the right salesperson, and triggers multi-channel follow-up — all within 60 seconds of lead creation.

### 2. Marketing Intelligence OS
**Business Problem:** Marketing team has no visibility into competitor pricing. Campaigns are created based on intuition rather than data. No way to measure true ROI per channel.

**Solution:** Daily automated competitor scraping with AI-powered pricing recommendations. Campaign generator that creates multi-channel content (Google, Meta, WhatsApp) based on actual market gaps. Revenue attribution that connects marketing spend directly to closed deals.

### 3. Enterprise Knowledge Assistant
**Business Problem:** Company policies, vehicle manuals, warranty terms, and sales procedures are buried in PDF folders. Employees waste hours searching for answers. New hires take weeks to become productive.

**Solution:** Multi-agent RAG system where specialized AI agents (Compliance, Sales Support, Marketing) answer questions with exact source citations. Supports HR policies, finance procedures, warranty terms, sales SOPs, and vehicle documentation.

### 4. Vehicle Inventory Intelligence
**Business Problem:** Vehicles sit in stock for months without price reviews. Holding costs (AED 50/day) silently erode margins. No systematic way to track the full vehicle lifecycle from purchase to resale.

**Solution:** AI-powered inventory lifecycle management that tracks every vehicle from import through sale, calculates real-time holding costs, flags aging stock, predicts demand, and recommends optimal pricing.

### 5. Automation Engine (`apps/automation-engine/`)
**Business Problem:** Business processes require manual handoffs between CRM, ERP, WhatsApp, email, and spreadsheets. Data gets lost. Steps get skipped. No audit trail.


### 6. Executive Dashboard (`apps/executive-dashboard/`)
**Business Problem:** Management relies on end-of-month reports to make decisions. No real-time visibility into sales pipeline, inventory health, marketing ROI, or team performance.

**Solution:** Live dashboard pulling from all modules showing today's sales, lead conversion, revenue, profit, marketing ROI, inventory aging, and AI-generated forecasts.

---

## Measurable Business KPIs

| Capability | KPI |
|-----------|-----|
| AI Lead Scoring | Higher qualified lead conversion |
| AI Sales Copilot | Reduced quotation preparation time |
| Knowledge Assistant | Faster onboarding and information retrieval |
| Marketing Intelligence | Better campaign targeting and attribution |
| Inventory Intelligence | Reduced aging inventory and holding costs |
| Executive Dashboard | Faster management decision-making |

---

## Dealership Financial Intelligence

The platform doesn't just track cars — it tracks money.

| Metric | Description |
|--------|-------------|
| Gross Margin | Selling price minus total landed cost |
| Net Profit | Gross margin minus all commissions and VAT |
| Floor Plan Financing Cost | Daily interest cost of financing inventory |
| Vehicle Aging Analysis | Days in stock with holding cost accumulation |
| Holding Cost per Day | Storage, insurance, depreciation (AED 50/day default) |
| Break-even Price | Minimum selling price to avoid loss |
| Expected Margin | AI-predicted margin based on market conditions |
| Reconditioning Cost | Per-vehicle repair and preparation costs |
| Trade-in Profitability | Margin analysis on trade-in vehicles |
| Finance Partner Commission | Bank commission on approved loans |
| Accessory Attach Rate | Percentage of deals with accessory upsells |
| Warranty Margin | Revenue from extended warranty sales |
| Salesperson Incentive Forecast | Projected commissions based on pipeline |
| VAT Reporting | Input/Output VAT tracking per transaction |

---

## Multi-Agent Architecture

Each agent is specialized for a specific business domain:

| Agent | Role | Trigger |
|-------|------|---------|
| Lead Agent | Scores and qualifies incoming leads | New lead event |
| Sales Agent | Assists salesperson with quotes, follow-ups | Salesperson request |
| Finance Agent | Checks loan eligibility, calculates EMI | Finance application |
| Inventory Agent | Monitors stock aging, recommends pricing | Daily cron / manual |
| Marketing Agent | Generates campaigns, analyzes competitors | Campaign request / daily |
| Knowledge Agent | Answers policy/manual questions with citations | Employee query |
| Compliance Agent | Validates warranty claims, checks regulations | Claim submission |
| Manager Agent | Summarizes team performance, flags issues | Daily digest |

---

## Event-Driven Architecture

The platform runs on business events, not just API calls:

```
Lead Created → Event Bus → CRM + Marketing + Notification + Analytics
Deal Closed  → Event Bus → ERP + Commission + Inventory + Dashboard
Vehicle Aged → Event Bus → Price Review + Marketing + Manager Alert
Claim Filed  → Event Bus → RAG + Service + Compliance + Customer Update
```

---

## Production Engineering

| Category | Implementation |
|----------|---------------|
| Authentication | Supabase Auth with JWT |
| Authorization | Role-Based Access Control (RBAC) |
| Database | Supabase (Postgres + Auth + pgvector + Storage + Realtime) |
| API Documentation | OpenAPI / Swagger |
| Containerization | Docker + Docker Compose |
| CI/CD | GitHub Actions |
| Audit Trail | Every data mutation logged with user, timestamp, and diff |
| Health Checks | `/api/health` on every service |
| Rate Limiting | Per-user API rate limits |
| Secrets Management | Environment variables via `.env` (never committed) |
| Error Handling | Structured error responses with correlation IDs |
| Background Jobs | Cron-based scrapers, scheduled reports |
| API Versioning | `/api/v1/` prefix on all endpoints |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | ReactJS, Vite, Tailwind CSS |
| Backend | Node.js (Express) |
| Database | Supabase (Postgres + Auth + pgvector) — single source of truth |
| AI/LLM | OpenRouter, LangChain, LangGraph |
| Automation | n8n, WAHA (WhatsApp Agent) |
| CRM | Bitrix24 (free tier, inbound-webhook REST) |

---

## Deployment Phase (Current → Target)

| Phase | Where It Runs |
|-------|---------------|
| **Now (Build Phase)** | n8n and WAHA run locally via Docker Compose. Supabase (Postgres + Auth + pgvector) is already the live cloud database — it is never local. |
| **Target (Go-Live Phase)** | n8n and WAHA move to a **Google Cloud e2-micro VM** — `nexus-vm`, `us-central1-a`, `35.224.126.225`, Always Free tier, 30 GB disk + 3 GB swap, Caddy on 80/443 for HTTPS. The React frontend deploys to **Vercel**. **Supabase stays the single backend/database/auth layer throughout** — nothing changes there between phases. |


---

## Multi-Tenant Architecture

The platform is designed as a SaaS product adaptable to any dealership:

```
/customers
  ├── Nexus-cars/
  ├── toyota-dubai/
  ├── nissan-uae/
  └── bmw-abudhabi/
```

Each tenant gets isolated data, configurable workflows, and customizable branding.

---

## Repository Structure

```
nexus-os/
├── .github/workflows/        # CI/CD pipelines
├── architecture/              # System diagrams, DB schemas, API specs
├── deployment/                # Docker Compose, environment configs
├── docs/                      # Business flows, AI dev workflow, setup guides
├── apps/
│   ├── ai-crm/                # AI-First CRM (React + Node.js + Supabase)
│   ├── automation-engine/     # n8n Workflows & WAHA WhatsApp Agent
│   └── executive-dashboard/   # Real-time Analytics (React)
└── README.md
```

---

## Cost to Run (Current Build Phase)

| Component | Cost |
|-----------|------|
| React + Vite + Tailwind | Free |
| Node.js | Free |
| Supabase (Free Tier) | Free |
| n8n (Self-hosted) | Free |
| Bitrix24 Free Plan | Free |
| OpenRouter (Free Models) | Free |
| GitHub | Free |
| **Total** | **$0** |

---
_Contract Auditor (Phase 1) added — see `docs/contract-auditor-walkthrough.md` for demo script._
