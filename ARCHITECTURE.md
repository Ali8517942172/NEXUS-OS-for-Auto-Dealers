# NEXUS OS — what this is, and what actually runs

> **Product vision**
> NEXUS sits above a dealership's existing systems, finds where revenue is
> leaking, decides the next best action, and executes it — with the team in
> control. It replaces nothing. It reads from the systems the dealership
> already trusts, reasons across them, and acts.
>
> **It is a multi-tenant product by design, sold to auto dealerships on a
> subscription — the UAE market first, then worldwide.** Tenant A is tenant #1
> and the pilot, not the dealership NEXUS was built for. By design is not yet in
> operation: read every measured figure below as a **one-tenant** figure, because
> production runs one active dealership plus a quarantine tenant and
> two-dealership behaviour is exercised on staging only.

This document describes the system **as it runs on 5 September 2026**. An
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
Postgres 17. Measured 5 September 2026: **59 tables, 39 views, 269 functions in
`public`, 374 constraints, 169 indexes, 163 policies, RLS on 59 of 59 tables.**
Business data, the tenancy layer (`tenants`, `tenant_members`), the policy
engine, the messaging layer, and the engine tables and views. Row-Level Security
is tenant-scoped; every public view carries `security_invoker` — **39 of 39**,
enforced by an event trigger that fails the deploy without it, and by gate check
`L3`, which since 5 September parses the option's *value* rather than testing for
the string (a view created `(security_invoker = false)` used to pass the check
that exists to forbid it).

The repository can now rebuild this database. `supabase/` holds all **288**
applied migrations (count and head re-measured 6 September 2026 against
production; the byte-exact rollup was last verified at 273/273 on 5 September), a generated baseline and a vocabulary seed;
`supabase/README.md` carries the restore path and the verification. That
replaces the older claim, repeated below in §6, that there is no schema file you
can run.

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
- **Gmail** (every email NEXUS sends — the drip, the escalation alert and the
  marketing-site enquiry notification all use one `gmailOAuth2` credential),
  **Apify** (competitor scraping), **Slack**, **Bitrix24** (the live CRM sync —
  not Odoo). **Resend is not used.** It was listed here until 8 Sep 2026 on the
  strength of one call in the marketing site and an unused credential in n8n;
  measured, zero workflows ever called it.

### How Ask AI actually works
Browser → `POST /webhook/ask-ai` with the Supabase JWT → n8n RAG workflow →
`rpc/search_rag_documents`. Retrieval is **`tsvector` full-text plus trigram**.
**No embeddings are computed at any point**; `document_embeddings` does not
exist. pgvector is installed, but it serves the closed-won deal memory, not
Ask AI.

### How a lead gets in — built on staging 6 September, not yet on production
The path is one line and every hop in it is deliberate:

    provider  ->  registered lead_ingest_endpoint  ->  nexus_record_lead_event
              ->  RECEIVED / HYDRATED / PROMOTED   ->  leads

**A source never posts to a raw public n8n webhook.** It posts to a registered
endpoint row, and that row — resolved by `public_key` — is what decides which
dealership the lead belongs to. Nothing in the payload chooses a tenant. That is
the opposite of `POST /webhook/whatsapp-inbound`, which keys off caller-supplied
`body.session` while n8n writes as `service_role`. `public_key` **identifies and
does not authenticate**; the secret that authenticates is named by `secret_ref`
and held outside the table.

Every arrival is written verbatim as a `lead_event` and walks
**RECEIVED → HYDRATED → PROMOTED**, or stops at a terminal phase —
`DUPLICATE / REJECTED / QUARANTINED / EXPIRED` — each of which must state its
reason. Only promotion writes a `leads` row, and it writes the real origin into
`leads.source` (`meta_lead_ads_facebook`, `google_ads_lead_form`, `walk_in`, …)
rather than the name of the writing workflow.

**Two phases are a requirement, not tidiness**, because two sources cannot
deliver a lead in one hop:

| source | one hop or two | why |
|---|---|---|
| **Meta Lead Ads** (Facebook, Instagram) | **two** | the webhook carries six ids and no customer data; the fields come from `GET /v25.0/<leadgen_id>` and expire |
| **Inbound email** (incl. marketplace notifications) | **two** | metadata arrives on the webhook, the body on a second call |
| Google Ads lead forms | one | the whole lead is in the POST body — including `google_key`, a plaintext secret that must be redacted before `payload_raw` is written |
| Website form, walk-in, phone call | one | — |
| Dubizzle Motors | **none** | no leads-out API exists; simulated, intercepted or negotiated only |

The dealership reads this through `v_lead_origin` — `security_invoker`,
tenant-scoped, with raw payloads, endpoint ids and endpoint keys absent from the
grant rather than merely unselected.

**Status: six migrations on staging only, no HTTP receiver, no signature
verifier, and nothing has carried a real lead.** See `LEAD-INGESTION.md` and
`ops/PARITY-2026-09-06.md`.

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

Since 5 September, a backend write that omits `tenant_id` no longer files under
the real dealership. `tenants.is_unattributed_default` is held by a quarantine
tenant (`__unattributed__`, `status='quarantine'`), pinned there by a CHECK
constraint, and all 29 tenant-carrying views exclude quarantined rows **in their
own definitions** rather than relying on RLS. `nexus_tenancy_readiness()`
returns **zero BLOCKERs** as of 5 September; `nexus_quarantine_census()` returns
**zero rows** so far, and it is the only measurement of which n8n writers are
broken. Which workflows those are is still **UNKNOWN**.

---

## 4. What is not done

The project's own instruments say so, and they are the authority — not this
document.

- **The quality gate** (`npm run gate`), definitive run 2026-09-06T06:51Z
  against a production catalogue anchored to migration `20260906062139`, reads
  `PASS 31 · FAIL 1 · WARN 2 · NOT RUN 3`, exit 1. The one failure is `L9` (one
  unregistered `audit_log` writer, deliberately left red — it clears with a
  disposition, never with an invented registry row). `L2` now **passes**:
  `workflow_registry` left the dealer data plane entirely on 6 September. The
  three NOT RUN are `B4`, which needs a browser with direct egress to the
  Supabase host, and `L11`/`L12`, which need a database connection.
  **A NOT RUN is not a PASS.** **Four migrations landed after that catalogue was
  taken**, and against the stale snapshot the render lane reports red on
  `v_deal_rescue_readiness.platform_evidence` — measured both ways, it is the
  snapshot's age and not the product. See `STATUS-2026-09-06.md` §5.
- **The production readiness verdict is NOT_READY.**
- **`POST /webhook/whatsapp-inbound` accepts unauthenticated requests.**
  `WAHA_WEBHOOK_SECRET` is unset on the VM, so the secret gate reports
  `DORMANT`. The session allowlist is live and fails closed, and it is the only
  lock on that door today.
- All 11 webhooks carry `authentication: ABSENT`. For the eight dashboard
  endpoints a shared-secret header would be worthless — the caller is a public
  JavaScript bundle — so the JWT is the correct control and edge-level JWT
  validation is the honest upgrade.
- ~~**A dashboard login is not read-only.**~~ **Closed 5 September 2026** by a
  staff role model on `tenant_members.role`
  (`owner | admin | manager | sales | technician | member`) and its dashboard
  half. Three mechanisms: column GRANTs for machine-owned columns (`42501`,
  before RLS), RESTRICTIVE RLS reading the role (0 rows), and a BEFORE UPDATE
  trigger for the one question neither can ask — *did this figure move* (`NX001`).
  Two things must be said with it. **`rbac_02`, which withheld
  `UPDATE(cost_aed)` outright and is the stronger lock, is not what shipped** —
  the deployed bundle sends `cost_aed` on every save, so it would 42501 every
  "Save changes"; re-apply it in the same release as the rebuilt dashboard. And
  **the model is inert today**: production has one login, already `owner`, and
  no UI exists to add a colleague. The next login inherits `member`, which now
  means own-leads-only.
- Defects that fire on the day a second dealership is added:
  `leads.assigned_to_id` has a global foreign key, and two reports go silent at
  two tenants. **Unclaimed KYC files no longer fall to the default dealership** —
  they fall to quarantine, which is visible and recoverable rather than silent.
- **`workflow_registry` has no `tenant_id`** and its policy is still
  `USING (true)`. Its `id`, `trigger_type` and `trigger_detail` columns were
  taken off the dealer plane on 5 September and now return `42501`, but
  `count(*)` reads no column: a dealership can still learn which automations
  exist and which are switched off. Gate `L2` is red on exactly this.

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
- A regulatory or finance claim requires a verified policy row. Measured
  5 September: **0 of 13** policy rules are verified against a source and there
  are **zero** platform attestations, and the Policy screen says so. That rule
  therefore currently forbids every regulatory claim, which is the engine being
  honest rather than a defect.
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
| `supabase/README.md` | The migrations, the baseline, the restore path, and what was verified against production |
| `architecture/README.md` | Historical. Its headline — *"there is no schema file you can run"* — was true until 4 September and is now superseded by `supabase/` |
| `STATUS-2026-09-06.md` | **Current.** What moved on the night of 5–6 September, item by item, with five corrections to earlier claims |
| `STATUS-2026-09-05.md` | Dated record. What moved since `AUDIT-2026-09-04.md`, item by item |
| `OWNER-ACTIONS.md` | **What only Ali can do, in the order to do it** — what each unblocks, what "done" looks like, and what breaks if it is done out of order |
| `VERSIONS.md` | V1–V4, and implemented / tested / production-proven / commercially validated per capability |
| `apps/executive-dashboard/QUALITY_GATE.mjs` | The gate. Run it before believing anything above |
