# NEXUS OS — what this is, and what actually runs

> **Product vision**
> NEXUS sits above a dealership's existing systems, finds where revenue is
> leaking, decides the next best action, and executes it — with the team in
> control. It replaces nothing. It reads from the systems the dealership
> already trusts, reasons across them, and acts.

This document describes the system **as it runs on 3 September 2026**. An
earlier version of it described an architecture that was planned in July and
never built — Make.com as a master router, Zapier catchers, MongoDB, Odoo,
a Python FastAPI RAG service, a Node.js/Socket.io dashboard. None of those are
in the live path. That document is superseded by this one.

---

## 1. The problems this product is for

1. **Lead decay.** A lead that waits does not convert. NEXUS scores every lead
   on file, states a risk with a reason for each, and names who should act.
2. **Undifferentiated follow-up.** A AED 20,000 enquiry and a AED 500,000 one
   get the same treatment. NEXUS ranks by exposure, not by arrival order.
3. **Ageing stock and unknown margin.** Every day a unit sits costs money. The
   Profit Sentinel reports margin at risk per VIN — and refuses to report a
   holding cost the dealership never quoted.
4. **No single view.** Leads, conversations, inventory and deals live apart.
   NEXUS assembles one record per customer and one queue per decision.
5. **Knowledge bottlenecks.** Ask AI answers from the dealership's own
   documents, citing the source.

**Not built, and sold as roadmap only:** service retention and reminders,
no-show recovery, trade-in valuation, deal-stage rescue, multi-bank finance,
dealer benchmarking. There is no service table, no appointments table, no
`recon_cost` column and no DMS connection. Saying otherwise would be a lie a
dealership discovers in week one.

---

## 2. The stack, as measured

Four moving parts. There is no application server, no event bus, and no second
data store.

### Supabase — the only data store
Postgres 17. 40 tables, 33 views. Business data, the tenancy layer
(`tenants`, `tenant_members`), the policy engine, and the engine tables and
views. Row-Level Security is tenant-scoped; every public view carries
`security_invoker`, enforced by an event trigger that fails the deploy without
it.

### n8n on a GCP VM — the execution layer
`35.224.126.225`, reachable at `https://35.224.126.225.nip.io`. Docker, with a
worker, Redis and its own Postgres. **21 workflows**, 18 active. It writes to
Supabase as `service_role`, which is `BYPASSRLS` — so no database policy
filters what n8n does. That is why tenancy in the workflow layer is a separate,
unfinished problem from tenancy in the database.

### WAHA — the WhatsApp transport
A self-hosted WhatsApp HTTP API container. Inbound: WAHA →
`POST /webhook/whatsapp-inbound`. Outbound: n8n → `http://waha:3000/api/sendText`.
**Not** the WhatsApp Cloud API. This is the one path proven end to end.

### A static dashboard on Vercel — the whole front end
Vanilla ES modules built with Vite. No React, no framework, no Tailwind (it was
removed), no WebSocket. It signs the user into Supabase Auth, reads PostgREST
directly as `authenticated`, and posts to eight n8n webhooks carrying that same
JWT. Two screens write tables directly; everything else goes through
`SECURITY DEFINER` RPCs.

### Models and integrations
- **OpenRouter free-tier models** with a hand-rolled fallback ladder, and
  **Groq** for Whisper voice transcription. **There is no OpenAI credential on
  the box.**
- **Resend** (email), **Apify** (competitor scraping), **Slack**, **Gmail**,
  **Bitrix24** (the live CRM sync — not Odoo).

### How Ask AI actually works
Browser → `POST /webhook/ask-ai` with the Supabase JWT → n8n RAG workflow →
`rpc/search_rag_documents`. Retrieval is **`tsvector` full-text plus trigram**.
**No embeddings are computed at any point**; `document_embeddings` does not
exist. pgvector is installed, but it serves the closed-won deal memory, not
Ask AI.

### Not in the stack
Make.com holds two scenarios, both inactive, zero executions, last touched
17 July — the "Master Router" it was meant to be has never run. No Zapier Zap
is in any live path. No MongoDB. No Odoo. No FastAPI. No React. No Socket.io.

---

## 3. What is built

**Live in production, on one dealership (Tenant A):** twenty screens, of which
the five revenue engines — Revenue Recovery, Lead Recovery, Deal Rescue,
Attribution, Policy — shipped on 3 September. The AI BDC (WhatsApp) is proven
end to end. The Action Center records a proposal, a named approver, and a
rejection reason code.

**Shipped as a screen is not the same as proven.** Deal Rescue renders
structurally empty by design, because this database records a sale at the
moment it closes and nothing before it — `v_deal_rescue_readiness` names all
nine prerequisites and which are met. That view is the honest demo.

**The database side of multi-tenancy is finished** and was proven adversarially
against synthetic tenants. The workflow side is not: `NEXUS_TENANT_MAP` is
unset, so resolvers fall through to a single-tenant default.

---

## 4. What is not done

The project's own instruments say so, and they are the authority — not this
document.

- **The quality gate** (`npm run gate`) reads `PASS 26 · FAIL 2 · WARN 2 ·
  NOT RUN 4`, exit 1. The four NOT RUN checks have **never been written**, not
  merely never run.
- **The production readiness verdict is NOT_READY.**
- **`POST /webhook/whatsapp-inbound` accepts unauthenticated requests.**
  `WAHA_WEBHOOK_SECRET` is unset on the VM, so the secret gate reports
  `DORMANT`. The session allowlist is live and fails closed, and it is the only
  lock on that door today.
- All 11 webhooks carry `authentication: ABSENT`. For the eight dashboard
  endpoints a shared-secret header would be worthless — the caller is a public
  JavaScript bundle — so the JWT is the correct control and edge-level JWT
  validation is the honest upgrade.
- **A dashboard login is not read-only.** Any signed-in user can change asking
  and cost price, delete a vehicle, and reassign any lead. There is no role
  check in the database or the UI.
- Three defects must be closed before a second dealership: unclaimed KYC files
  fall to the default dealership, `leads.assigned_to_id` has a global foreign
  key, and two reports go silent at two tenants.

---

## 5. Rules that outrank features

- **Never fabricate a monetary impact.** Estimated, attributed and confirmed
  are three different words and must never be interchanged on a screen.
- **Never claim recovered revenue until a real business outcome occurs.** A
  check constraint enforces this: Postgres refuses a recovered value without a
  linked sale.
- AI may summarise, classify, recommend, draft and trigger approved actions. It
  may not invent prices, finance numbers, availability, regulatory
  requirements, customer identity, discounts, margin or attribution.
- A regulatory or finance claim requires a verified policy row. Today **0 of 7**
  policy rules are verified against a source, and the Policy screen says so.
- Do not say enterprise-ready, globally compliant, zero-risk, or any guaranteed
  revenue increase. The honest commercial position is a **controlled dealership
  pilot**.

## 6. Where the real documents are

This is a summary. These are maintained and measured, and they win where they
disagree with it:

| File | What it carries |
|---|---|
| `CLAUDE.md` | House rules, and why each one exists |
| `PRODUCT.md` | The thesis, the engines, and the data-led sequencing rule |
| `NEXUS_INVARIANTS.md` | The invariants, and which mechanism enforces each |
| `commercial/WHAT-WE-CLAIM.md` | The claims register — what may be said to a buyer |
| `architecture/README.md` | **There is no schema file you can run.** The database is the record |
| `apps/executive-dashboard/QUALITY_GATE.mjs` | The gate. Run it before believing anything above |
