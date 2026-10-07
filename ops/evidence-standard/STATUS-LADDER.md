# The status ladder — every capability in NEXUS, 8 September 2026

**Column 5 is empty. No dealership has ever paid for NEXUS, so not one
capability in this product has been commercially validated, and every cell in
level 5 below says NOT RUN for that single reason.**

Column 4 has **one** entry: a real customer's WhatsApp message became lead 122 on
7 September 2026. Everything else in this product has been proven against
fixtures, staging, our own probes, a provider's test button, or the owner's own
hands.

This file applies the five-level ladder honestly to every capability, as of
today. It is written to be the single answer to *"what actually works"*, and it
is meant to be uncomfortable. The rules it is written under are in
`STANDARD.md`; the two that decide most cells are **NOT RUN ≠ PASS** and
**UNKNOWN ≠ ZERO**.

---

## The five levels

| # | Level | What it takes | What it explicitly is not |
|---|---|---|---|
| 1 | **IMPLEMENTED** | The code, schema or workflow exists in a tracked place and can be read | Not evidence that it runs |
| 2 | **PROVEN** | Executed with assertions read — unit fixtures, or staging with real Postgres, real RLS and real constraints in the way | Not evidence about production. Staging and production have diverged before |
| 3 | **PRODUCTION-DEPLOYED** | The artefact is live on production and reachable by the path a real user or provider would take | Not evidence that anything has come through it. An endpoint row is not the fact that a delivery can arrive |
| 4 | **REAL TRAFFIC PROVEN** | A real customer drove it and the outcome was read | **Not** a preflight. **Not** a provider's test button. **Not** the owner's own message, form fill, or dashboard click. Production has exactly one login and it belongs to the owner, so nothing done through it is level 4 |
| 5 | **COMMERCIAL VALIDATED** | A dealership paid, used it, and the outcome was measured | Nothing in this repository is at this level |

### Verdicts

`PASS` · `FAIL` · `BLOCKED` · `DEGRADED` · `NOT RUN` · `NOT RUNNABLE` ·
`SUPERSEDED`, each with the test given in `STANDARD.md` §6. **A cell that cannot
be evidenced is NOT RUN.** It is never a PASS.

### How the counts came out

42 capabilities. A level is counted as reached only on a clean `PASS`;
`DEGRADED`, `SUPERSEDED`, `FAIL`, `BLOCKED`, `NOT RUN` and `NOT RUNNABLE` do not
count.

| Level | Reached | Of 42 |
|---|---|---|
| 1 · IMPLEMENTED | **40** | two capabilities do not exist at all: inbound email ingest, and WhatsApp as an attributed lead source |
| 2 · PROVEN | **29** | |
| 3 · PRODUCTION-DEPLOYED | **26** | eight more are deployed and `DEGRADED` — live and unable to do the thing they are for |
| 4 · REAL TRAFFIC PROVEN | **1** | WhatsApp inbound via WAHA. Four more are `DEGRADED` or `SUPERSEDED` at this level (B3, B4, C1, D9) and three are outright `FAIL` (C5, D10, D12); the rest have never met a customer |
| 5 · COMMERCIAL VALIDATED | **0** | |

**Measurements taken 8 September 2026** against production
`dsvuoovivysszdoiorch` through the read-only SQL channel, which connects as a
privileged role and not as a signed-in dealership session. Production holds
**one active dealership** (Tenant A, tenant #1, the pilot) plus a quarantine
tenant, so every production figure here is a one-tenant figure and says nothing
about what a second dealership would see.

---

## A · Lead ingestion, by source

Nine sources exist in `lead_source_catalogue`. Production carries five
`lead_ingest_endpoint` rows: `walk_in` active, `phone_call` active,
`meta_lead_ads_facebook` disabled, `meta_lead_ads_instagram` disabled,
`google_ads_lead_form` disabled (measured 8 Sep). Production holds **1**
`lead_event` row and **5** `leads` rows.

| id | capability | 1 IMPLEMENTED | 2 PROVEN | 3 PRODUCTION-DEPLOYED | 4 REAL TRAFFIC | 5 COMMERCIAL |
|---|---|---|---|---|---|---|
| A1 | `website_form` ingestion | PASS — `apps/marketing-site/api/lead.js`; `leadingest_01`…`_10` on production | PASS — `JL/T01`, staging 7 Sep: `HYDRATED` in one hop, promoted, `leads.source = website_form` | **NOT RUN** — no `website_form` endpoint exists on production (5 endpoints, measured 8 Sep); the live form answers **503** with `NEXUS_NOTIFY_WEBHOOK_SECRET` unset on Vercel; the site's Vercel project is not connected to git, so both 7 Sep fixes are on `main` and may be live nowhere | NOT RUN — no arrival | NOT RUN — see the header |
| A2 | `walk_in` ingestion | PASS — `nexus_lead_record_manual`, `lib/manual-lead-form.js` | PASS — `JL/T10`, staging: two events, two sources, two leads, real origins | PASS — endpoint `alba-prod-walkin-showroom-floor` active; RPC proved on production 7 Sep as a real Tenant A member in a rolled-back transaction (lead 125, `was_duplicate` false then true, one `lead_event`, no orphan); `manual_entry_surface` set (measured 8 Sep) | **NOT RUN** — the only production row is lead **121**, `walkin-preflight-2026-09-07-01`, email under `@nexus-preflight.invalid`. `CLAUDE.md` calls it *"a preflight, not a customer"* and says do not quote it as traffic | NOT RUN — see the header |
| A3 | `phone_call` ingestion | PASS — same path | PASS — `JL/T10` | PASS — endpoint `alba-prod-phonecall-front-desk` active | **NOT RUN** — zero events, zero leads from this source | NOT RUN — see the header |
| A4 | Meta Lead Ads (Facebook, Instagram) | PASS — receiver `JDqy54w2HUH7pHgW`, `ops/n8n-meta-lead-ads/` | PASS — `receiver.test.js`; `JL/T03` staging (metadata-only arrival, promotion refused `LEAD_EVENT_NOT_HYDRATED`, then `EXPIRED` retained with its reason). `JL/T02` is **BLOCKED**: L3 needs Meta to fire our endpoint | **DEGRADED** — published and refusing every request: `500 APP_SECRET_NOT_CONFIGURED`, `META_APP_SECRET` unset, both endpoints disabled, 0 rows in `lead_ingest_provider_identity`, 5 handshake-only executions (`ops/n8n-meta-lead-ads/GO-LIVE.md`) | NOT RUN — no lead has ever arrived here | NOT RUN — see the header |
| A5 | Google Ads lead form | PASS — receiver `EYva4c2bMV5MGq0o`, `ops/n8n-google-lead-form/` | PASS — `receiver.test.js`; `JL/T05` staging: the second delivery returned `was_duplicate=true` with the same `event_id` and did not raise. `JL/T04` **BLOCKED** | **DEGRADED** — published; seven refusal codes measured on the live box 7 Sep, including `500 ENDPOINT_SECRET_NOT_CONFIGURED` for a registered key; endpoint disabled, per-endpoint secret unset | NOT RUN — no Google Ads account is connected | NOT RUN — see the header |
| A6 | WhatsApp enquiry as an **attributed** lead | **NOT RUN** — a specification only (`ops/whatsapp-lead-capture/SPEC.md`, 8 Sep, nothing applied). No `lead_ingest_endpoint` row for `whatsapp_inbound` exists. `Persist Lead (deterministic)` on the Master Router hardcodes `source: 'nexus-master-router'`, discarding the correct `source: 'whatsapp'` computed two nodes upstream | NOT RUN — `JL/T07` **BLOCKED** on a WAHA session and the open-door remediation | NOT RUN | NOT RUN | NOT RUN — see the header |
| A7 | Marketplace notification email | **NOT RUN** — there is no inbound email ingest at all. `JL/T09` records this as an unbuilt capability, not a configuration gap | NOT RUN | NOT RUN | NOT RUN | NOT RUN — see the header |
| A8 | Dubizzle / marketplace | PASS — catalogue row + `ops/lead-simulator/` | PASS, simulated only — `JL/T08` is BLOCKED on the WhatsApp path; the marketplace half is permanently simulated | **NOT RUNNABLE** — Dubizzle Motors publishes no leads-out API, and CHECK `lead_ingest_endpoint_production_needs_real_provenance` means a **production Dubizzle endpoint cannot exist as a row** | NOT RUNNABLE | NOT RUN — see the header |

**Two things this group must not be read as saying.** WhatsApp enquiries *do*
become `leads` rows — four of them have — but they carry the writer's name, not
an origin, and produce no `lead_event` at all. And `nexus_lead_source_readiness()`
read as `service_role` returns `NOT_CONNECTED` for all nine sources; that is a
reading of nobody's dealership, because the function is tenant-scoped and
`nexus_current_tenant_ids()` is empty for `service_role`.

---

## B · Messaging

| id | capability | 1 IMPLEMENTED | 2 PROVEN | 3 PRODUCTION-DEPLOYED | 4 REAL TRAFFIC | 5 COMMERCIAL |
|---|---|---|---|---|---|---|
| B1 | WhatsApp inbound (WAHA) | PASS — `whatsapp_bdc_ai_agent`, `POST /webhook/whatsapp-inbound` | PASS — `ops/n8n-waha-gate/gate.test.js`; the gate's dormant branch proved live 3 Sep | **DEGRADED** — live and **unauthenticated**: `WAHA_WEBHOOK_SECRET` unset, the `WAHA Auth Gate` measured DORMANT, n8n writes as `service_role` (`BYPASSRLS`), and the caller picks the dealership through `body.session` | **PASS** — lead **122**, `Hussain`, `+971556382721`, created 2026-09-07 14:05 UTC through this door. `WhatsApp BDC Agent`: **128 SUCCESS** audit rows, most recent **2026-09-08 17:25:56 UTC** (measured today). This is the only level-4 PASS in the product, and on this surface nothing distinguishes a customer from anyone who knows the URL | NOT RUN — see the header |
| B2 | WhatsApp inbound (Cloud API) | PASS — receiver `J8MXprxVw1yhjBpp`, `ops/n8n-whatsapp-cloud/` | PASS — 47 tests including `hmac-pure.test.js`; signature over raw bytes | **DEGRADED** — published and refusing every request by design (`500 APP_SECRET_NOT_CONFIGURED`, `500 VERIFY_TOKEN_NOT_CONFIGURED`); `META_APP_SECRET` and `META_WEBHOOK_VERIFY_TOKEN` unset on the VM | NOT RUN — **0** rows in `channel_message_events` (measured 8 Sep). A defect sits one node past the handshake: `Record Channel Event` sends `'+' \|\| customer_wa_id` into a column checked against `^[0-9]{6,20}$`, so the **first real Cloud message raises `23514`** and Meta retries into the same failure | NOT RUN — see the header |
| B3 | WhatsApp outbound (send) | PASS — six send call sites across four workflows (`ops/whatsapp-cloud/WAHA-EXIT-PLAN.md`) | **NOT RUN** — no send harness exists; the Journey Lab runs no send legs at all, deliberately, because `Guard Reply` filters message content and never the recipient | PASS — WAHA is the live outbound path | **DEGRADED** — messages have reached real handsets, and two of them were wrong: on 31 Aug the agent invented an EMI of AED 11,200 against a true figure nearer 7,800 and sent it to a real person, and a separate reply leaked the dealership's internal vehicle cost. Both are now gated. What is **not** established is that any recipient was a dealership customer rather than one of the owner's own contacts | NOT RUN — see the header |
| B4 | The AI reply (inventory-grounded BDC) | PASS — `whatsapp_bdc_ai_agent` | NOT RUN — no offline harness for the model path | PASS — live | **DEGRADED** — proven live 2 Sep on a real inbound message: identity resolved to an existing lead with no duplicate, an inventory-grounded reply quoting a real price with the vehicle cost withheld, a SUCCESS audit row. Against that: 128 SUCCESS to 166 FAILED lifetime, and `v_workflow_health` rated the workflow 42.4% over 290 runs. The "17.8 seconds" figure was **withdrawn from every sales document** and must not be re-quoted | NOT RUN — see the header |
| B5 | Provider-agnostic messaging layer | PASS — `channel_registry`, `nexus_route_message`, `nexus_request_send`, seven tables | PASS — `nexus_provider_router_invariants()`; all five attacks on `nexus_request_send` held, including a two-backend race | **DEGRADED** — applied to production at byte parity and **unwired**: no workflow references `nexus_resolve_channel_tenant`, `nexus_record_channel_event`, `whatsapp_policy_decision_for_channel`, `nexus_route_message` or `nexus_request_send`, and seven of its tables hold **0 rows** (measured 8 Sep). WAHA sends today without ever asking it | NOT RUN — has never carried a message | NOT RUN — see the header |
| B6 | Message policy engine | PASS — `policy_rule`, `policy_jurisdiction`, `whatsapp_policy_decision_for_channel` | PASS — adversarial pass 4 Sep: a dealership could legislate as Meta; made unrepresentable by a jurisdiction namespace, a composite FK and a CHECK. Re-proved | **DEGRADED** — live with **13 rules, 0 `VERIFIED`, 0 platform attestations** (measured 8 Sep), and no caller. The engine's own rule — a customer-facing regulatory claim requires a verified policy row — therefore forbids every regulatory claim | NOT RUN | NOT RUN — see the header |
| B7 | WhatsApp templates | PASS — `whatsapp_template`, `whatsapp_template_sendability()` | PASS — identity normalised over language and `waba_ref`; a 40-day-old APPROVED refuses; staleness tolerance has no default | PASS — deployed both projects | NOT RUN — **0** rows in `whatsapp_message_usage`; no template has been sent | NOT RUN — see the header |
| B8 | Consent (opt-in / opt-out) | PASS — `whatsapp_opt_in_event`, two constraints, generated `consent_rank` | PASS — all three forgery routes, the identical-timestamp tie and a five-backend race now return `BLOCKED / CUSTOMER_OPTED_OUT` | PASS — five migrations, both projects, fingerprint identical across 279 objects | NOT RUN — **0** consent rows on production before and after (re-measured 8 Sep), and **no caller exists yet**. `service_role` writing the table directly still bypasses the writer's checks, and n8n holds that key | NOT RUN — see the header |

---

## C · Outbound integrations

| id | capability | 1 IMPLEMENTED | 2 PROVEN | 3 PRODUCTION-DEPLOYED | 4 REAL TRAFFIC | 5 COMMERCIAL |
|---|---|---|---|---|---|---|
| C1 | Bitrix24 CRM sync | PASS — `wf_108 ERP Sync - Bitrix24`, `httpRequest` to `$env.BITRIX24_WEBHOOK_URL` | NOT RUN — no harness; there is no Bitrix credential in n8n to inspect, by design | PASS — published | **SUPERSEDED** — it really worked: **7 SUCCESS** audit rows naming returned CRM ids (*"Bitrix24 lead created (ID 25)"*, *"(ID 27)"*), 16–19 August, last at **2026-08-19 11:04 UTC**. **Nothing has succeeded since.** The current workflow name shows **10 FAILED**, last 6 Sep. And the link-back PATCHes `leads?email=eq.…`, so for a phone-only lead — the walk-in, the phone call, the WhatsApp enquiry — the Bitrix id is never written back, silently | NOT RUN — see the header |
| C2 | Slack alerts | PASS — `Slack Command Center`, credential exists | NOT RUN | PASS — published; `slack-command` is closed by design (execution 9325: `Tenant For JWT User` emits one empty item, `Auth Gate` throws, status `error`) | **NOT RUN** — 5 SUCCESS rows, **all with summary `"Completed"`**, last **2026-08-19 11:21 UTC**. That is the workflow finishing, not a message arriving in a channel; the Bitrix rows name a returned id and these name nothing. 7 FAILED since, last 6 Sep. Do not quote the five as proof of delivery | NOT RUN — see the header |
| C3 | Gmail — lead escalation | PASS — `Email: Escalation Alert (Gmail)`, `gmailOAuth2` | NOT RUN | PASS — published | **NOT RUN** — `Lead Escalation` shows 10 SUCCESS, last **2026-09-08 03:04 UTC**, but an audit SUCCESS is a workflow finishing, not a delivery receipt (see C2), and the recipient is `aliasgher892@gmail.com` — the owner's own inbox, not a customer's | NOT RUN — see the header |
| C4 | Gmail — site enquiry notification | PASS — `Oz2W6EWG6n6XW0HQ`, `POST /webhook/site-enquiry`, `authentication: headerAuth` | NOT RUN — the no-header 403 check has not been run | **NOT RUN** — deliberately left **unpublished**: n8n auto-bound the only existing Header Auth credential, `Resend API (Header)`, so publishing would arm the door with the key the change exists to throw away | NOT RUN | NOT RUN — see the header |
| C5 | 7-day warm lead drip | PASS — three Gmail nodes | NOT RUN | PASS — published | **FAIL** — 13 FAILED, **0 SUCCESS**, most recent failure 2026-09-07 14:05 UTC | NOT RUN — see the header |

---

## D · Dashboard and engines

Production has **one** `auth.users` row and **one** `tenant_members` row, and
both are the owner's. There is no second login. **No cell in this group can
reach level 4 today**, and the reason is the same for all of them: nobody but the
owner has ever used this dashboard.

| id | capability | 1 IMPLEMENTED | 2 PROVEN | 3 PRODUCTION-DEPLOYED | 4 REAL TRAFFIC | 5 COMMERCIAL |
|---|---|---|---|---|---|---|
| D1 | Dashboard shell and screens | PASS — 22 nav entries in the working tree | PASS — gate render lane R0–R7: 21 screens render, 0 page errors, 130 PostgREST calls, 0 rejected — **against a stubbed PostgREST**, so it proves what the UI does with a given row and nothing about what Postgres does with a given caller | PASS — deployed bundle measured 7 Sep: `nexus-os-dashboard-six.vercel.app`, `/assets/main-BFmkO_-a.js`, 1,499,871 bytes | **NOT RUN** — one login, the owner's | NOT RUN — see the header |
| D2 | Manual lead entry (walk-in / phone) | PASS — `lib/manual-lead-form.js` | PASS — see A2 | PASS — `rpc/nexus_lead_record_manual` occurs twice in the deployed bundle; `Add a lead` twice | NOT RUN — see A2 | NOT RUN — see the header |
| D3 | Lead owner assignment + audit | PASS — `nexus_lead_assign_owner` (SECURITY **INVOKER**) plus trigger | **FAIL then PASS** — `JL/T12`: the dashboard's own `UPDATE` on `leads` changed the owner and wrote **0 audit rows**. Fixed by a trigger that catches every writer and fails closed; five controls including a service_role write and an audit table made to refuse (`23514`, owner unchanged). The FAIL is kept because it is the evidence the trigger is load-bearing | PASS — `nexus_leads_owner_change_audit_trg` present on `public.leads` on production (measured 8 Sep); `rpc/nexus_lead_assign_owner` in the deployed bundle | NOT RUN — no reassignment by a second person has occurred, because there is no second person | NOT RUN — see the header |
| D4 | Ask AI / RAG | PASS — `search_rag_documents`, `screens/ask.js` | NOT RUN — no assertion-bearing run recorded | PASS — 15 `rag_documents` rows live | **NOT RUN** — `Ask-AI RAG Query`: 11 SUCCESS, last **2026-08-24 17:59 UTC**; 9 REJECTED since, last 6 Sep. The only asker is the owner. The 2-argument form returns **0 rows** the moment a second dealership is active | NOT RUN — see the header |
| D5 | Inventory Profit Sentinel | PASS — `v_inventory_profit_sentinel`, `sentinel_inventory_actions`, propose/decide/execute | PASS — gate `L6`, `R4`, `S5`; `L10` (no `recovered_value_aed` without an attributed sale, 0 rows) | PASS — **12 of 12** units with `cost_aed` and `days_in_stock`; 3 `inventory_actions`; `Inventory Ageing Recompute` 25 SUCCESS, last 2026-09-07 20:15 UTC | **NOT RUN** — the three actions were proposed and decided by the sole login, the owner's. `holding_cost_per_day_aed` is NULL, so the economics render `NOT_COMPUTABLE` — correctly, and it means no figure here has been validated by use | NOT RUN — see the header |
| D6 | Deals / closed-won | PASS — `purchase_history`, `deals_embeddings` | PASS — recorded through the live UI 2 Sep, submitted four times, **one row**: idempotency proven, not assumed | PASS — live | **NOT RUN** — `purchase_history` holds **1** row and it is the owner's own test lead, not a customer sale (measured 8 Sep, unchanged since 2 Sep). `Sync Closed-Won to pgvector`: 4 SUCCESS last 2 Sep, then 17 FAILED, last 6 Sep | NOT RUN — see the header |
| D7 | Deal Rescue | PASS — `screens/deal-rescue.js`, `v_deal_rescue_readiness` with nine named prerequisites | PASS — the refusal is the feature: the screen states what is missing rather than inventing a pipeline | PASS — deployed | **NOT RUNNABLE** — `v_deal_rescue` returns 0 rows and will until a deal record exists at first commitment. Six prerequisites are schema or integration gaps. Do not demo this as a working engine | NOT RUN — see the header |
| D8 | Revenue attribution graph | PASS — `v_attribution_edges`, `nexus_lead_attribution` | PASS — the chain grades its own hops: the VEHICLE hop reads `UNKNOWN_TEXT_ONLY` and its margin `NOT_COMPUTABLE` because nothing links `purchase_history` to a unit | PASS — 115 edges, 114 events live | **NOT RUN** — the entire graph descends from one sale, and that sale is the owner's test lead | NOT RUN — see the header |
| D9 | Customer 360 | PASS — `customer_360_profiles`, nightly batch | PASS — the two-dealership silence measured on staging and re-proved on production in an aborted transaction | PASS — 4 profiles live | **DEGRADED** — `Customer 360 Aggregation`: **28 PARTIAL**, most recent 2026-09-07 22:00 UTC; last SUCCESS **2026-08-26**. It is a once-daily batch, not live, and it goes **silent** — writing nobody and auditing nothing — the moment a second dealership is active | NOT RUN — see the header |
| D10 | Competitors / market intelligence | PASS — `competitors`, `v_competitor_latest`, scraper workflow | NOT RUN | PASS — 22 rows live | **FAIL** — `Competitor Price Scraping`: **263 REJECTED** against 25 SUCCESS; most recent rejection 2026-09-08 13:00 UTC, most recent success 2026-09-07 01:00 UTC. Rated `PRODUCING_NOTHING` at a 10.1% success rate on 3 Sep. Market Intelligence is a screen, not a capability, until this returns prices | NOT RUN — see the header |
| D11 | Lead Recovery / silence detector | PASS — `v_lead_recovery`, `Phase 6 Silence Detector` | PASS — mechanics render | PASS — detector 4 SUCCESS, last **2026-09-08 03:04 UTC** | **NOT RUN** — the recovery queue is 0 against 5 leads. The mechanism runs; there is nothing to recover, so nothing about it has been exercised by volume | NOT RUN — see the header |
| D12 | KYC / AML document audit | PASS — `kyc_documents`, `nexus_kyc_object_readable()`, Phase 5 workflow | NOT RUN | PASS — deployed | **FAIL** — **3** documents, **0** verified, all three verdict `REJECTED`. The workflow shows **14 FAILED**, last 2026-09-06, and 2 ESCALATED, last 17 Aug. A row appearing is not the capability working | NOT RUN — see the header |
| D13 | Finance quoting | PASS — `finance_quotes`, the calculator with `calculation_id` and `execution_id` | PASS, and **expired** — `pg_stat_all_tables` shows 25 inserts and 15 deletes, so the insert path has worked repeatedly and a teardown clears the rows. That counter carries no date; the last SUCCESS audit row is **2026-08-24 18:01 UTC**, with **53 REJECTED** since, last 6 Sep | PASS — deployed; **0** live rows (measured 8 Sep) | **NOT RUN** — the fix to the constraint that broke it is nine minutes younger than the last failure and has not been exercised since. The WhatsApp finance path is gated off after the invented-EMI incident and must not go live | NOT RUN — see the header |

---

## E · Platform machinery

Levels 4 and 5 do not exist for a gate, a CI job or a parity check: no customer
traffic passes through one, and no dealership buys one. Those cells read
`NOT RUNNABLE`, and the capabilities each piece of machinery guards carry the
level-4 answer instead.

| id | capability | 1 IMPLEMENTED | 2 PROVEN | 3 PRODUCTION-DEPLOYED | 4 REAL TRAFFIC | 5 COMMERCIAL |
|---|---|---|---|---|---|---|
| E1 | Multi-tenancy (database layer) | PASS — `tenant_id` NOT NULL on every scoped table, every natural key scoped, tenant-scoped RLS | PASS — proven adversarially on **staging** with two synthetic tenants as real roles with JWT claims: reads, writes, tenant-hopping, a forged claim, membership self-grant, all ten views, phone-tail collision, the whole `anon` surface | **NOT RUN for the multi-tenant case** — production holds one active dealership. `NEXUS_TENANT_MAP` is unset on the box; `POST /webhook/whatsapp-inbound` still lets the caller choose the dealership through `body.session`; activating a second tenant silences five consumers of `nexus_scoped_tenant_id()` | NOT RUN | NOT RUN — see the header |
| E2 | Cross-tenant refusal **on production** | PASS — the same mechanisms | PASS on staging (a Bravo event citing Alpha's endpoint: `23503`) | **NOT RUNNABLE** — proving it needs a second **active** tenant, and activating one silences Customer 360, `v_customer_directory`, `v_inventory_sales`, `search_rag_documents` and the two identity helpers. Do not re-run this on production to feel thorough | NOT RUNNABLE | NOT RUN — see the header |
| E3 | `nexus_lead_ingest_invariants()` | PASS — 10 branches | PASS — **every branch made to go red**: two sabotages on production 7 Sep, both rolled back (dropping two CHECKs then registering the row they refuse → 1 FAIL; a `service_role` downgrade of `origin_verified` → refused `23503`, gate correctly stayed 0 FAIL because the state is unreachable). The eighth branch went red on **real damage**: `2 orphan lead(s): 41, 43` | PASS — **8 PASS / 2 INFO / 0 FAIL** on production, measured 8 Sep | NOT RUNNABLE — production has one arrival, so no production traffic has ever exercised it | NOT RUN — see the header |
| E4 | `nexus_tenancy_readiness()` | PASS | PASS — **nine branches fired deliberately** on staging 6 Sep, each in its own rolled-back transaction. The tenth could never fire (it counted NULLs in five `NOT NULL` columns) and was replaced | PASS — **0 BLOCKER**, 3 WARN on production, measured 8 Sep. One WARN is live and matters: a write path is still omitting `tenant_id` — `audit_log` 20 rows and `communication_logs` 1 row sitting in quarantine | NOT RUNNABLE | NOT RUN — see the header |
| E5 | `QUALITY_GATE.mjs` — live lane | PASS — 36 checks | PASS — checks demonstrated able to go red; `L3` and `L2` were both found checking for a mechanism's *presence* rather than its *effect* and rewritten | **DEGRADED** — the last recorded full run is **2026-09-03T11:45:26Z: PASS 26 · FAIL 2 · WARN 2 · NOT RUN 4 · exit 1**, and the schema has moved a long way since (310 migrations on production, max `20260907154626`, measured 8 Sep). Under `STANDARD.md` §6 that PASS set has expired and the gate needs a credentialled re-run before any of it is quoted | NOT RUNNABLE | NOT RUN — see the header |
| E6 | Continuous integration | PASS — `.github/workflows/ci.yml`, four jobs | PASS — **all four verified able to go red**; runs #1–#4 were red on real defects | PASS — CI #6 on `main`: Success, 8 Sep — the first green run in this repository's history. **17 launch-critical checks (`L1`–`L13`, `B1`–`B4`) are SKIPPED by name** because CI holds no database credential and must not. A green CI run says nothing whatsoever about tenant isolation | NOT RUNNABLE | NOT RUN — see the header |
| E7 | Repo ↔ production migration parity | PASS — `supabase/tools/extract-migrations.mjs --check`, gate `L11`/`L12` | PASS — byte-exact over the 288 shared migrations as of 6 Sep (`ops/PARITY-2026-09-06.md`), with its own caveat that a version-keyed rollup cannot answer a content question once versions diverge | **DEGRADED** — production now holds **310** migration rows, max `20260907154626` (measured 8 Sep); twelve migrations are recorded as applied through `execute_sql` rather than stamped, and `leadingest_10` carries a different version key in the repo than on production | NOT RUNNABLE | NOT RUN — see the header |
| E8 | Journey Lab suite (23 journeys) | PASS — `ops/journey-lab/` | PASS — **15 PASS · 0 FAIL · 7 BLOCKED · 1 NOT RUN**, staging 7 Sep, teardown asserted (`0 journey-lab leads remain`). Two FAILs are kept as FAILs beside their fixes | **NOT RUN** — no journey has ever been run against production, and none of the 23 is L4. `TEST-MATRIX.md` says it in its own words: *"Nothing here is L4, because no dealership is on a live NEXUS ingestion endpoint"* | NOT RUNNABLE | NOT RUN — see the header |

---

## What is currently described as proven and is not

Each of these reads, somewhere in this repository or in a sentence someone could
say out loud, as a working capability. None of them survives §3 of
`STANDARD.md`.

1. **"The lead-ingest layer is on staging only."** `LEAD-INGESTION.md` still
   opens with it. All ten `leadingest_*` migrations are on **production** and the
   objects are live. The claim expired and the file has not been corrected.
   *(Flagged in `ops/whatsapp-lead-capture/SPEC.md` §0; still uncorrected today.)*
2. **"Bitrix24 CRM sync works."** True in August, false since 19 August. A PASS
   with no expiry date attached to it. It is `SUPERSEDED`, not `PASS`.
3. **"Slack alerts are delivered."** Five SUCCESS rows whose summary is
   `"Completed"`. That is a workflow reaching its last node. Nothing in this
   system has observed a Slack message arriving in a channel.
4. **"The finance quote path works — 25 inserts prove it."** The
   `pg_stat_all_tables` counter has no date on it. The last SUCCESS audit row is
   24 August and there have been 53 REJECTED since, most recently 6 September. A
   counter that only goes up is not a statement about today.
5. **"The messaging layer, the policy engine, the templates and consent are
   complete."** All four are applied to production at byte parity and **not one
   of them is in any execution path**: no workflow references any of their five
   entry functions, and seven of their tables hold zero rows. Deployed is not
   wired.
6. **"The WhatsApp Cloud receiver is live."** It is published, and it refuses
   every request. One node past the handshake it would raise `23514` on the
   first real message it ever received, and Meta would retry into the same
   failure.
7. **"49 tests pass" / "15 Journey Lab journeys PASS."** All 23 journeys ran on
   staging against a fictional dealership, at n=1, with no send legs and no
   provider in the loop. Seven are BLOCKED and one is NOT RUN. A green column
   here is not a working product, and the file says so itself.
8. **"The invariants hold, so ingestion is safe."** The invariants hold over
   **one** production arrival, and that arrival is a preflight. `1 of 1
   production arrival(s) rest on a person's word, not a signature` is the gate's
   own INFO line, measured today.
9. **"The gate is green."** The last full credentialled run was 3 September and
   ended `FAIL 2 · NOT RUN 4 · exit 1`. The green run people have seen since is
   CI, which invokes the gate with `--no-db` and skips seventeen launch-critical
   checks by name.
10. **"Tenant isolation is proven."** It is proven on staging, against two
    synthetic tenants. Production has one active dealership and a check that
    could only run at one tenant is NOT RUN for the multi-tenant case.
11. **Screen counts taken from `origin/main` in a working clone.** The `main` ref
    in this clone is dated 2026-08-31 and carries 14 nav entries while the tree
    carries 22 and is 126 commits ahead; merges since then are not fetched here.
    The deployed-bundle probe of 7 September is the witness for what production
    serves, not a branch name.

## What would move the most cells

Not a plan — an observation about where the ladder is thinnest.

- **Level 4 is empty because nobody outside this project has used NEXUS.** One
  dealership staff member, with their own login, filling in one walk-in through
  the manual entry form would move D2, D3 and A2 in a single afternoon, and needs
  no Meta secret, no Google asset and no VM change.
- **Eight capabilities sit at DEGRADED on level 3** — live, and unable to do the
  thing they are for. Four of the eight (A4, A5, B1, B2) are waiting on one
  environment variable each — `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, the
  Google per-endpoint secret, `WAHA_WEBHOOK_SECRET`. Two (B5, B6) are waiting on a
  wiring decision nobody has made. Two (E5, E7) are waiting on a credentialled
  gate run and a migration-stamping pass. A ninth, A1, is not DEGRADED but NOT
  RUN, and it is one more variable: `NEXUS_NOTIFY_WEBHOOK_SECRET`.
- **Column 5 does not move by engineering.**
