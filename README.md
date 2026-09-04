<!-- BUSINESS CONTEXT — rewritten 2026-09-03 against the live system -->
> **NEXUS is a Revenue Recovery & Action OS for dealerships.** It sits above the
> dealership's existing DMS, CRM and inventory systems, looks for where revenue is
> leaking, decides the next best action, and executes it with the team in control.
> It replaces none of those systems. See `PRODUCT.md` for the thesis and
> `CLAUDE.md` for how to work in this repository.
>
> **The honest commercial position today is a controlled, single-dealership
> pilot.** Not "enterprise-ready", not "compliant", not multi-tenant in
> production. There is no paying dealership on it yet. Never state more than the
> evidence supports; "wired but never fired" is a real answer.
>
> **If you are preparing to say something to a customer, do not read this file.**
> Read `commercial/WHAT-WE-CLAIM.md`. It is the claims register, it carries the
> query and the date behind every claim, and it outranks this page.

# NEXUS OS

A dealership operating system built on Supabase, n8n and a single-page dashboard.
One dealership is live on it. One conversation path is proven end to end. Most of
what follows is honest about which is which.

---

## Status, measured 3 September 2026

| | |
|---|---|
| Dealerships on the system | 1 |
| Dashboard logins | 1 |
| Customer sales recorded through the system | **0** |
| Finance quotes produced | **0** |
| ID documents successfully verified | **0** |
| Vehicles in stock | 12 |
| Messages on record | 108 (83 inbound WhatsApp, 18 automated replies) |
| Run records in `audit_log` | 687, first row 14 August 2026 |
| Registered workflows | 18 — 2 healthy, 11 degraded, 1 producing nothing, 1 never run, 3 not instrumented |
| Quality gate | 26 pass, **2 P0 fail, 2 warn, 4 P0 not run** — exits non-zero |

Re-run these before quoting them; they move. Scope every count to the real
dealership (`tenants.slug = 'alba-cars'`) — a raw `count(*)` has included another
workstream's test rows before now.

---

## What is proven

Each of these has run on real data and left a record.

- **Inbound WhatsApp → grounded reply.** A real customer message on 2 September
  resolved to an existing customer record without creating a duplicate, and was
  answered with the asking price read from the `inventory` row for that VIN. The
  vehicle's cost price was not disclosed. The run wrote a `SUCCESS` audit row with
  all three of its claimed steps independently verified. This is the one path that
  is demoable.
- **Duplicate suppression.** The message id is claimed atomically before a reply
  is generated, so a repeated delivery does not produce a second reply.
- **Identity resolution refuses to guess.** Resolution requires a unique phone
  tail; a tail shared by two people matches nobody and the message is left
  unassigned rather than filed against the wrong customer.
- **Nightly inventory ageing.** 20 runs, 20 successes, graded healthy. It is the
  most reliable job in the system.
- **A closed-won deal recorded through the dashboard, idempotently.** Submitted
  four times on 2 September, one row written. This is a mechanism test on the
  owner's own lead — **it is not a customer sale**.
- **Tenant isolation at the database layer.** Every table holding customer data
  carries a dealership id and every access rule checks it. Tested 2 September with
  two synthetic dealerships and re-tested 3 September across all tables and all 33
  views, as real Postgres roles with real JWT claims, including as the system
  account that bypasses row-level security, and including a deliberate
  same-email/same-phone collision. Zero cross-tenant rows in either direction.
  Evidence: `apps/executive-dashboard/SECURITY_REGRESSION_REPORT.md`.

---

## What is built but not proven

Present in the codebase, wired, and either never successful or not successful
recently. **None of this may be sold as a capability.**

| Area | State |
|---|---|
| Finance quoting (APR, EMI, monthly payment) | 65 runs, 3 successes, **0 quote rows ever written**, last success 24 August. On 31 August an earlier build sent a real person a monthly payment of AED 11,200 when the true figure was nearer AED 7,800. The path is gated off and must stay off. |
| KYC / ID verification | 12 runs, 0 successes ever. Three documents submitted, all three correctly rejected as not identity documents. |
| Competitor price tracking | 168 runs, 17 usable prices. The system's own health rule grades it `PRODUCING_NOTHING`. |
| Marketing drip campaign | 8 runs, 8 failures, never succeeded. |
| Customer 360 | A once-daily batch, not a live view. 27 runs at 33% success, 2 profiles on file. |
| Ask AI / RAG | 11 successes in 17 runs, but **no answer produced since 24 August**, and the 15 documents loaded are samples rather than a customer's. |
| Retention / purge | Registered, marked active, **has never run**. Nothing enforces a retention window. |
| Infrastructure health probe | Registered, **has never run**. There is no uptime measurement and no SLA. |
| Lead channels other than WhatsApp | Facebook, Instagram, website forms and TikTok webhooks exist. **Not one lead has ever arrived through any of them.** |

---

## What is not built

Roadmap. No code, no data, no schema. Listed here so nobody mistakes an intention
for a feature.

- **Service retention and service revenue recovery.** There is no service table,
  no appointments table and no DMS connection. This is the largest opportunity in
  the strategy and the furthest away.
- **No-show recovery, and most of Deal Rescue.** Both need appointment and
  deal-stage data that does not exist.
- **True margin.** There is no `recon_cost` column, so net margin is not
  computable and the system reports it as such rather than guessing.
- **Trade-in mining and trade-in valuation.**
- **Multi-bank finance comparison.**
- **Dealer benchmarking.** It needs several dealerships. There is one.
- **Per-role permissions.** See the limits below.
- **Automatic inventory feed.** Stock is loaded and refreshed by hand.

---

## Known limits, in production, today

These are disclosed to buyers in `commercial/PILOT-OFFER.md`. They are listed
here so an engineer does not accidentally close one and assume it was never open.

1. **The inbound WhatsApp webhook is not authenticated.**
   `POST /webhook/whatsapp-inbound` accepts unauthenticated requests: the secret
   check is written into the workflow but dormant, because `WAHA_WEBHOOK_SECRET`
   is unset on the VM. What holds the door today is a downstream allowlist on the
   WhatsApp session name, which refuses an unknown session and writes nothing.
   Closing it is a configuration change on the box, in this order: set the secret,
   make WAHA send the header, confirm in MONITOR mode, then enforce. Setting the
   secret first would silently drop every real customer message.
2. **A dashboard login is not read-only and carries no role.** Any signed-in user
   can change a vehicle's asking and cost price, delete a vehicle record, and
   reassign any lead. Neither the database nor the interface gates it.
3. **One dealership per system.** The database layer separates dealerships and is
   tested; the automation layer does not — every n8n workflow writes as a system
   account with no dealership attached. Three further defects fire on the day a
   second dealership is added. `select * from public.nexus_tenancy_readiness();`
   reports the database half; the security regression report covers the rest.
4. **Four launch-critical checks have never been run.** Non-approver refusal,
   decision idempotency, cross-dealership denial through the real signed-in path,
   and rendered-vs-live parity all need a second dealership and a non-approving
   user. Production has one dealership and one user, and that user is an approver.
   A NOT RUN is not a pass.
5. **WhatsApp runs through an unofficial client on a personal number.** It is
   against WhatsApp's terms of service and the number can be banned without
   warning. Migration to the official Cloud API is step one of any onboarding.
6. **Everything is on free tiers.** The VM is a CPU-starved e2-micro that has
   fallen over twice; Supabase's free tier pauses after inactivity and takes no
   daily backups; the AI models are rate-limited free capacity.

---

## Architecture

```
WhatsApp (WAHA, unofficial client)
        │
        ▼
n8n on a Google Cloud e2-micro VM  ── 18 registered workflows
        │  writes as service_role
        ▼
Supabase (Postgres + Auth + pgvector)  ── single source of truth
        ▲
        │  reads as authenticated, row-level security per dealership
        │
Executive dashboard (static SPA on Vercel)
```

There is no second data store and no event bus. Every figure a screen shows comes
from one Supabase project.

### Tech stack, as actually deployed

| Layer | Technology |
|---|---|
| Dashboard | Vanilla JS modules, Vite, Tailwind CSS, `@supabase/supabase-js`. **No React.** |
| Database, auth, vectors | Supabase (Postgres, Auth, pgvector) — the single source of truth |
| Automation | n8n (self-hosted, Docker) using its LangChain-based AI agent nodes |
| WhatsApp | WAHA, an unofficial client — to be replaced by the WhatsApp Cloud API |
| Models | OpenRouter and Groq free tiers, behind a fallback model ladder |
| CRM sync | Bitrix24 (free tier, inbound-webhook REST) |
| Hosting | Vercel (dashboard), Google Cloud e2-micro `nexus-vm` (n8n + WAHA) |

`apps/ai-crm/backend/server.js` is a small unused Express service that exposes
`/api/health` and `/api/v1/*`. It is not deployed and nothing depends on it.

There is no CI pipeline in this repository, no OpenAPI document, no rate limiting
and no role-based access control. Do not describe any of them as present.

---

## Repository structure

```
nexus-os/
├── CLAUDE.md                    # house rules — read first
├── PRODUCT.md                   # the product thesis and the roadmap
├── NEXUS_INVARIANTS.md          # INV-001..INV-008, and which are open
├── DESIGN.md
├── commercial/                  # the customer-facing pack
│   ├── WHAT-WE-CLAIM.md         # the claims register — outranks every other doc
│   ├── PILOT-OFFER.md
│   ├── PILOT-ONBOARDING.md
│   └── DEMO-SCRIPT.md
├── architecture/                # schema.sql, transcribed from the live catalogue
├── supabase/                    # some SQL; migrations are applied to the live project, not kept here in full
├── n8n-workflows/               # exported workflow definitions (an export, not the source of truth)
├── docs/
└── apps/
    ├── executive-dashboard/     # the deployed dashboard, its quality gate and its reports
    ├── automation-engine/       # workflow drafts and webhook simulation scripts
    └── ai-crm/                  # an unused Express service
```

The live n8n instance, not `n8n-workflows/`, is the source of truth for workflow
behaviour. That directory is an export and it goes stale.

---

## Where the record lives

- `commercial/WHAT-WE-CLAIM.md` — what may and may not be said to a buyer, with
  the evidence and the date beside each claim.
- `NEXUS_INVARIANTS.md` — the business rules, who owns each, and the query that
  proves it. Open violations are recorded as open.
- `apps/executive-dashboard/QUALITY_GATE_REPORT.md` — the generated gate result.
  Read it rather than any narrative summary of it.
- `apps/executive-dashboard/SECURITY_REGRESSION_REPORT.md` — the 3 September
  security sweep and its open findings.
- `apps/executive-dashboard/J1_PRODUCTION_READINESS_REPORT.md` — release
  readiness. It contains at least one arithmetic error about the gate's own
  counts, so cross-check it against the generated report.
- `architecture/schema.sql` — a transcription of the live catalogue; it goes stale
  within days.
