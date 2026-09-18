# N8N TENANT AUDIT — every workflow, where its tenant comes from

Agent **N8NAUDIT** · 2026-09-18 · read-only against `https://35.224.126.225.nip.io` (live export via the
public API, `GET /workflows`, 26 workflows, 427 nodes). Nothing existing was modified, activated,
archived or deleted. One NEW workflow was created, INACTIVE (§4).

**The premise.** `service_role` carries `rolbypassrls`, so RLS is not a boundary for any of these
workflows. Tenant correctness is each workflow's own job, and the only question worth asking of each
one is: *what does it believe, and who controls it?*

Three answers are safe — a signature the caller cannot forge (Meta HMAC), a URL key plus a
per-dealership secret, or a Supabase JWT the caller cannot mint, resolved through `tenant_members`.
One answer is not: a `tenant_id` (or a WAHA session name) the caller simply asserts in the body.

## 1. The table

| id | name | active | nodes | where the tenant comes from | verdict |
|---|---|---|---|---|---|
| `BiyHk9ZXxJUVGbf6` | WhatsApp BDC AI Agent | **ACTIVE** | 45 | **none that the caller does not control** — `body.session` → `$env.NEXUS_TENANT_MAP`; `WAHA Auth Gate` runs DORMANT/MONITOR unless `WAHA_WEBHOOK_SECRET` is set | **P0** |
| `JnlZFAVmFAuNXVya` | NEXUS Master Lead Router - AI Agent | ACTIVE | 26 | caller-asserted `body.tenant_id` **first**, JWT `tenant_members` only as fallback | NEEDS_FIX |
| `G7FhvMY2ucW5Fg7X` | 7-Day Warm Lead Drip Campaign | ACTIVE | 41 | caller-asserted only (`lead.tenant_id` / `body.tenant_id`); the verified JWT is never mapped to a tenant | NEEDS_FIX |
| `unMMpeL9uuPO79pp` | Finance Calc: Auto Loan Equity & Credit Score | ACTIVE | 11 | JWT `tenant_members` first, then caller-asserted `body.tenant_id` | NEEDS_FIX |
| `qTnh3nwWheFJbFkU` | KYC/AML Document Auditor + Re-upload Loop (Phase 5) | ACTIVE | 32 | caller-asserted `body.tenant_id` first, JWT second; sends on WAHA `session:'default'`; Slack `C0BKTLL1X54` | NEEDS_FIX |
| `dhy2DDjWUqwuzHLW` | Sync Closed-Won Deals to Supabase pgvector | ACTIVE | 17 | caller-asserted `deal.tenant_id` first, JWT second | NEEDS_FIX |
| `bxNBzBrcOtcFpMPn` | wf_108 ERP Sync - Bitrix24 CRM | ACTIVE | 21 | caller-asserted `lead.tenant_id` only, then sole-configured-tenant | NEEDS_FIX |
| `KI6P1Qcf3MIZakNa` | Lead Escalation - AI Agent | ACTIVE | 26 | caller-asserted `lead/body.tenant_id`, then sole-configured-tenant; alert hardcoded to one Gmail recipient | NEEDS_FIX |
| `yx6m55p1Kj8V7koR` | WhatsApp Send (Dashboard Reply) | ACTIVE | 13 | JWT → `tenant_members` (correct) **but** every reply leaves WAHA `session:'default'` | NEEDS_FIX |
| `AZkGM5M4c1uzSH7S` | Customer 360 - Data Aggregation (Bitrix24) | ACTIVE | 11 | per-row `customer.tenant_id` (correct) **but** enrichment reads one shared Gmail + Slack for every tenant | NEEDS_FIX |
| `aIYwwoYStDAi9kHy` | NEXUS Retention Purge | ACTIVE | 16 | per-row `kyc_documents.tenant_id`, deletes by explicit id (correct); gap alert hardcoded to Slack `C0BKTLL1X54` | NEEDS_FIX |
| `J8MXprxVw1yhjBpp` | WhatsApp Cloud - Inbound Receiver (Meta) | ACTIVE | 11 | signed input — HMAC over raw bytes, then `metadata.phone_number_id` → `channel_registry` | SAFE |
| `JDqy54w2HUH7pHgW` | Meta Lead Ads - Inbound Receiver | ACTIVE | 19 | signed input — HMAC over raw bytes, then the signed `page_id` | SAFE |
| `EYva4c2bMV5MGq0o` | Google Ads Lead Form - Inbound Receiver | ACTIVE | 18 | URL endpoint key + per-dealership `google_key`; fails closed (403) | SAFE |
| `qHAtd3RckAKRBUkE` | Ask-AI — RAG Query Agent | ACTIVE | 17 | JWT → `tenant_members` only; no caller-asserted path | SAFE |
| `VmnIXo7tM30zqawp` | Slack Command Center - AI Agent | ACTIVE | 16 | JWT → `tenant_members` only; `Auth Gate` throws on a bad token | SAFE |
| `iYJkh1kztWxZXDbT` | NEXUS Error Handler | ACTIVE | 3 | none by design — names the sole configured tenant, sends `tenant_id: null` explicitly otherwise | SAFE |
| `57QpbNQGwlFKb0q3` | NEXUS Infra Health Probe | ACTIVE | 12 | none needed — `NEXUS_PROBE_KEY` gated, writes no tenant data | SAFE |
| `ZUc42jcwwHoBeEr8` | Inventory Ageing Recompute | ACTIVE | 5 | per-row `inventory.tenant_id`; audit grouped per tenant | SAFE |
| `LphiGg4iqF1bn6El` | Competitor Price Scraping & Supabase Update | ACTIVE | 10 | per-row `inventory.tenant_id` carried onto every write | SAFE |
| `B3TcpfzOMWj8oWgF` | Phase 6 - 12-Hour Silence Detector | ACTIVE | 12 | per-row `leads.tenant_id`, carried into the escalation call | SAFE |
| `Oz2W6EWG6n6XW0HQ` | NEXUS Site Enquiry to Gmail Notification | inactive | 5 | none — `headerAuth` webhook, Gmail only, writes no tenant data | SAFE |
| `IsdF6LbuBnq0z3K7` | NEXUS Appointment Booking — CANDIDATE | inactive | 34 | signed input — HMAC, then `phone_number_id` → `channel_registry` | SAFE |
| `bhzCbnro0MlSCwwo` | NEXUS Public — Home | ACTIVE | 2 | n/a — static HTML | SAFE |
| `vKTmNepP4fGaTAe8` | NEXUS Public — Privacy | ACTIVE | 2 | n/a — static HTML | SAFE |
| `Z0zFB6IKvARAzjpQ` | NEXUS Public — Terms | ACTIVE | 2 | n/a — static HTML | SAFE |

**Totals: 26 workflows · 427 nodes · 15 SAFE · 10 NEEDS_FIX · 1 P0.**

## 2. The smallest change that fixes each one

| workflow | the node to add or change |
|---|---|
| WhatsApp BDC AI Agent (**P0**) | Set `WAHA_WEBHOOK_SECRET` **and** `WAHA_WEBHOOK_ENFORCE=true` on the n8n box so the existing `WAHA Auth Gate` node leaves MONITOR for ENFORCE — that is one env change, no edit to a live workflow. Then replace `Resolve Tenant` with the candidate's `Fetch WAHA Channel` → `Refuse Unregistered WAHA Session` pair, so the dealership comes from `channel_registry`, not from `$env.NEXUS_TENANT_MAP` keyed on a caller-supplied string. |
| NEXUS Master Lead Router | In `Validate & Enrich Input`, move the `Tenant For JWT User` lookup **above** the `src.tenant_id` read, and accept a caller-asserted `tenant_id` only when it equals the JWT row's. |
| 7-Day Warm Lead Drip Campaign | Add a `Tenant For JWT User` HTTP node (`tenant_members?auth_user_id=eq.<Verify JWT .id>`) between `Verify JWT` and `Normalize Lead Input`, and read it first in `Resolve Tenant`. |
| Finance Calc | In `Resolve Tenant`, drop the `webhook_body` branch when `authenticated` is true — the JWT row already answered. |
| KYC/AML Document Auditor | In `Prepare Document`, initialise `tenant` from the `Tenant For JWT User` row and treat `body.tenant_id` as a claim to verify, not a source. Also parameterise WAHA `session` and the Slack `channelId` from `channel_registry` / `tenant_configuration`. |
| Sync Closed-Won Deals | In `Format Deal Text`, same inversion — JWT row first, `deal.tenant_id` only as a cross-check. |
| wf_108 ERP Sync | In `Resolve Tenant`, read `Tenant For JWT User` (the node exists upstream of `Auth Gate`) before the caller's `lead.tenant_id`. |
| Lead Escalation | Same inversion in `Fetch Escalated Lead`'s `tenant_id` expression; and make `Email: Escalation Alert (Gmail)` address a per-tenant recipient rather than one fixed mailbox. |
| WhatsApp Send (Dashboard Reply) | In `Send via WAHA`, replace the literal `session: 'default'` with `channel_registry.external_identifier` for the resolved tenant (a `Fetch WAHA Channel` HTTP node before it). |
| Customer 360 | Give `Gmail - Get Emails` / `Slack - Search Mentions` per-tenant credentials, or skip enrichment for any tenant with no mailbox of its own, so one dealership's mail never lands on another's profile. |
| NEXUS Retention Purge | Resolve `Slack: Archive Gap Alert`'s channel from the tenant on the alerting row instead of the literal `C0BKTLL1X54`. |

**The pattern behind nine of the ten.** Every one of those workflows authenticates correctly and then
lets the authenticated caller *name* the dealership. With one dealership live that is invisible; the
day the second tenant exists, a user of A can post `tenant_id: <B>` and the write lands in B. The
sole-configured-tenant fallback these workflows share is fine — it names one dealership only while
exactly one is configured, and returns null (column omitted) once there are two.

## 3. Hardcoded single-tenant sinks

`session:'default'` on every outbound WAHA send (BDC, Drip, KYC, Dashboard Send), Slack channel
`C0BKTLL1X54` (Master Router, KYC, Retention Purge), one Gmail recipient (Lead Escalation, Site
Enquiry). These are correct today and wrong the moment a second dealership exists.

## 4. The tenant-scoped BDC candidate

`ops/tenant-scope-bdc/whatsapp_bdc_ai_agent.TENANT_SCOPED.json` was imported as a NEW workflow:

- **id `LTBExI7QzFeANeFg`** — *WhatsApp BDC — TENANT SCOPED CANDIDATE (do not activate)* — **INACTIVE**, 54 nodes.
- `BiyHk9ZXxJUVGbf6` was not touched (`updatedAt` still `2026-09-07T15:35:18.000Z`, 45 nodes, still active).
- Validation: no duplicate node names, no dangling connections, no unconnected nodes, 12 node types,
  credentials resolve to existing entries (Supabase / Groq / OpenRouter). `channel_registry` appears
  16 times, `NEXUS_TENANT_MAP` zero, `tenant_id=eq.` on six queries. It fails closed via
  `Refuse Unregistered WAHA Session`.
- **Finding, before anyone activates it:** the candidate closes *attribution* but not *authentication*.
  Its entry is still `POST /webhook/whatsapp-inbound` with no auth, and the `WAHA Auth Gate` node is
  absent — a caller who knows a registered session name can still speak as that dealership. Add the
  shared-secret gate (or Meta-Cloud-style HMAC) before it is ever turned on. Being inactive, it
  registers no production webhook and cannot collide with the live workflow.
