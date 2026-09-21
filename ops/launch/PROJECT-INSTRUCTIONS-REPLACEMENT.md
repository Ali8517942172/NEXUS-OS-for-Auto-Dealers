# NEXUS OS — Project Instructions (replacement draft, 21 Sep 2026)

> **Purpose.** The claude.ai Project instructions currently pasted into this project describe
> a different, fictional system (Zapier + Make.com + Odoo ERP + MongoDB + a Node.js/Socket.io
> dashboard, "15-Agent QA Swarm", "100% complete"). None of that is what was built. This
> document is an accurate replacement, written from the repo and the newest session logs as of
> 21 September 2026. Paste this over the existing instructions when ready — it is not applied
> automatically.

---

## What NEXUS OS is

NEXUS OS is a multi-dealership SaaS product for car dealerships in the UAE, built and operated
by **Ali Asgher, trading as NEXUS** (agency: **Adqonic**). It reads enquiries arriving on a
dealership's own WhatsApp Business number and email, answers or routes them, tracks inventory
and leads, flags ageing stock, and gives the dealership a dashboard. It is not a CRM/DMS
replacement and does not claim to be one.

**Price:** AED 399 per month per dealership, flat, with the first month free. No setup fee, no
minimum term, no lifetime price lock, no cap on how many dealerships can subscribe. Payment is
arranged manually and confirmed by the founder — **there is no automated billing, subscription
or trial-expiry system in the database.** Cancel any time, effective at the end of the paid
month.

**Tenancy today:** one real dealership is live on the system. Onboarding a second dealership is
explicitly blocked (see "Biggest open risk" below) until the workflow layer is tenant-scoped.

---

## The real technology stack

- **Database:** Supabase (PostgreSQL), hosted cloud database — check `supabase/config.toml` or
  the Supabase dashboard for the exact project/region if it matters for a specific task; do not
  assume a region. `pgvector` is used for the RAG embeddings. Row-Level Security (RLS) is
  applied to tenant-owned tables.
- **Automation / workflow engine:** **n8n**, self-hosted on a **Google Cloud** VM (GCP e2-micro
  today, CPU-starved, moves to a paid instance for paying customers), reachable at a public
  `nip.io` address (not a custom domain). This is where webhooks are received and messages are
  sent — there is no Make.com and no Zapier in the live system.
- **Messaging channels:**
  - **WhatsApp** — the official **Meta WhatsApp Business Cloud API** is the target and is
    receiving real, signature-verified inbound messages on one phone number. An unofficial
    WhatsApp client (WAHA) was used earlier and is being migrated off; treat any WAHA-path
    behaviour as legacy, not the intended production path.
  - **Email (Gmail)** — send-only, via a dealership's own connected Google account (OAuth), to
    reply to customers and alert staff. Mailbox contents are never read.
  - **Facebook/Instagram Lead Ads, Google Ads lead form** — receivers exist in code but are
    registered **disabled**; no real lead has ever arrived through them.
- **AI:** OpenRouter and Groq free-tier models, with a rule-based fallback ladder for when a
  model is rate-limited or unavailable. No paid model capacity is provisioned yet.
- **RAG ("Ask AI"):** Supabase pgvector + an n8n-hosted retrieval agent. Correct in that it
  fails closed (returns nothing rather than leaking) when no tenant is specified — but it is
  **not yet tenant-scoped by argument**, so it will go silent, not leak, the moment a second
  dealership is active until that is fixed.
- **Marketing site:** static site on Vercel (`apps/marketing-site`), with a narrow-privilege
  lead-intake endpoint (`nexus_intake` schema, publishable key only, no access to dealership
  data) for NEXUS's own "buy NEXUS" enquiries — separate from any dealership's `leads` table.
- **Dashboard:** a web app (`apps/executive-dashboard`) reading Supabase directly under RLS, not
  Node/Socket.io. No live WebSocket ticker exists.

There is **no Odoo, no MongoDB, no Make.com, no Zapier, no Slack-based "master brain"** in the
live system. Earlier design documents described those; they were not what got built.

---

## Multi-tenancy: what's actually proven

- Production has `tenant_id` on 45+ tables, `NOT NULL DEFAULT`, with RLS policies mirroring the
  `leads` pattern (permissive to `authenticated` scoped by tenant membership, restrictive deny
  to `anon`, permissive to `service_role`).
- A two-tenant adversarial SQL suite (181 tests) passed against a staging clone with production's
  own RLS policies copied verbatim: no cross-tenant read/write/delete leak for a **signed-in
  user**, `anon` blocked before RLS is even reached, destructive-delete guards cover the tables
  that had an incident.
- **`service_role` bypasses RLS entirely** (`rolbypassrls = true`), and **every n8n workflow
  runs as `service_role` on one shared credential.** That means the database-level isolation
  proven above does not constrain automation at all — it only protects the dashboard's
  signed-in-user path.

### Biggest open risk (do not onboard dealership #2 until this is closed)

A full node-by-node audit of the authored n8n workflows found that **none of the messaging or
CRM workflows filter by tenant.** Concretely: WhatsApp replies can quote another dealership's
stock and cost price; the lead router can silently overwrite one dealership's customer record
with another's; a nightly retention purge and an inventory-ageing recompute run with no tenant
predicate at all, across every dealership at once. The one exception — the newer WhatsApp Cloud
and Google Ads lead receivers — resolves the dealership from a registered identity (phone
number ID / Page ID) before touching any data, and is the pattern every other workflow needs to
be rewritten to. Until that rewrite lands, **the product can be sold to one dealership at a
time, and a second signature should not be booked.**

---

## What is live vs. not (as of 21 Sep 2026)

**Live / working, with evidence:**
- WhatsApp Business Cloud webhook — receiving real, signature-verified customer messages.
- Marketing site lead capture (fixed 16 Sep; the Vercel deployment previously had no environment
  variables configured and silently dropped every enquiry).
- Dashboard channel-status screen — distinguishes "registered", "connected" and "actually
  receiving" per channel rather than showing one green tick for all three.
- RLS-based tenant isolation for the signed-in-user path (see above).
- Public privacy/terms pages, now describing the actual multi-dealer SaaS business (this
  document's sibling task corrected pages that still said "single-dealership, not offered for
  public sign-up").

**Registered but not proven / explicitly not sold:**
- Finance/EMI quoting — disabled after producing a materially wrong monthly-payment figure once;
  zero successful quotes recorded.
- KYC / ID document verification — zero documents ever successfully verified.
- Closed-deal / sold reporting — no real customer sale has ever been recorded; the database
  refuses to accept a "recovered revenue" figure unless attributed to an actual sale.
- Competitor price tracking — usable results on a small minority of runs; not shown to
  dealerships.
- Facebook/Instagram Lead Ads, Google Ads lead form, Gmail-inbound receiver — code exists,
  endpoints are registered disabled, no real lead has ever arrived through any of them.
- A second dealership on the platform — blocked, see above.
- Any uptime SLA, support ticketing, or automated billing/subscription system — none exist.

---

## Rules for anyone (or any AI session) working on this project

1. **Never claim a certification, uptime SLA, integration, or measured outcome that isn't
   built and evidenced.** The commercial docs (`commercial/WHAT-WE-CLAIM.md`,
   `commercial/DEMO-SCRIPT.md`) enumerate claims that must never be made (e.g. "SOC 2",
   "99.9% uptime", "recovered AED X") — read them before writing anything customer-facing.
2. **The price is AED 399/month per dealership, first month free, no lifetime lock, everywhere**
   — website, terms, commercial documents, this instructions file. Do not reintroduce a setup
   fee, a founding-rate cap, or a banded price without an explicit, dated decision from Ali.
3. **Data isolation is per dealership.** The dealership is the data controller for its own
   customers under UAE PDPL (Federal Decree-Law No. 45 of 2021); NEXUS is the processor. Never
   describe NEXUS as owning or being able to freely use dealership customer data.
4. **Treat "authored" ≠ "imported" ≠ "running".** A workflow file in the repo is not proof it is
   active on the n8n box; a migration in the repo is not proof it is applied to production.
   State which one you actually checked.
5. **Before claiming a second dealership can go live, re-verify the tenancy state above** — it
   may have changed since this document was written; check the newest `ops/` and session notes
   rather than trusting this summary blindly.

---

*Compiled from the repository (`commercial/`, `ops/`, recent PRs) and the newest project session
logs (16–17 September 2026: the two-tenant adversarial suite, the workflow tenancy audit, the
channel-status screen, and the AED 399 pricing decision). No `ops/audit-2026-09-21/SUMMARY.md`
existed in the repository at the time this was written; if one lands later, reconcile against it.*
