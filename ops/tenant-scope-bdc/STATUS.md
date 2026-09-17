# STATUS — WhatsApp BDC AI Agent tenant scoping

Agent **BDC-FIX** · 2026-09-17

## What this is, and what it is not

- `whatsapp_bdc_ai_agent.TENANT_SCOPED.json` is an **AUTHORED FILE**. It has been written to disk
  and nothing else.
- It has **NOT been imported into n8n**. It has **NEVER EXECUTED**. Not one node in it has run,
  not once, against anything.
- The n8n box `https://35.224.126.225.nip.io` was **not touched**. No git command was run.
- `n8n-workflows/whatsapp_bdc_ai_agent.json` was **not modified**. This is a separate copy.
- Production Supabase `dsvuoovivysszdoiorch` was read **SELECT-only** — `information_schema`,
  `pg_proc`, `pg_constraint`, `pg_indexes`, and four small content reads (`channel_registry`,
  `tenants`, `tenant_configuration`, `tenant_capability`). No `apply_migration`, no write, no DDL.
- `"active": false` is set in the file.

## Provenance of what I read

The file I audited is the repo export, whose `_exported_from.updatedAt` is **2026-08-30T17:59:08Z**
— 18 days before today — and whose `_exported_from.active` is `true`. **The workflow running on the
box may differ from what I read.** Every "Real?" verdict below is a verdict about the bytes in that
file, verified line by line, cross-checked against the live production schema. It is not a verdict
about the live n8n workflow, which I did not open.

Node count: 43 in the source, **54** in the rewrite (one node removed, twelve added).

---

## Per finding

| # | Finding (as measured by the orchestrator) | Real? | Fixed in this copy? | Still NOT RUN / not closed |
|---|---|---|---|---|
| 1 | **`Fetch All Leads`** — `{"operation":"getAll","tableId":"leads","returnAll":true}`, every lead of every dealership pulled in to resolve one phone number | **YES** — verified verbatim in the source node | **YES** — node deleted. Replaced by `Resolve Lead Id (Tenant Scoped)` → `rpc/nexus_lead_for_comm_key(p_key, p_tenant)` (confirmed STABLE + SECURITY DEFINER on production; refuses to guess when `p_tenant` is null and >1 tenant is active), then `Fetch Matched Lead` → `leads?tenant_id=eq.<t>&id=eq.<id>` with an explicit column list. `leads_tenant_id_idx` exists | The RPC returns a bare scalar; how n8n wraps a scalar JSON body (`{data:…}` vs bare) is **unverified at runtime** — `Fetch Matched Lead` reads it defensively and falls back to `id=eq.-1`. Not executed |
| 2 | **`Resolve Lead Identity`** — last-9-digit match across the whole cross-tenant set, no tenant compare | **YES** — `$input.all()` was `Fetch All Leads`' output | **YES** — the candidate set is now at most one row, filtered to the tenant twice (inside the RPC and again on the row fetch), with a third `tenant_id === tenantId` compare in the code node. `DISQUALIFIED` semantics preserved unchanged; `tenant_id` added to its output | Not executed. Match behaviour for `@lid` chat ids (no phone digits) now depends entirely on the RPC's normalisation, which I read but did not run |
| 3 | **`search_inventory`** — `inventory` searched by model only; could quote another dealer's stock **and `cost_aed`** | **YES** — `supabaseTool`, single `model ilike` filter, no column restriction | **YES, both halves.** Rewritten as a tenant-filtered `httpRequestTool`: `tenant_id=eq.<t>` **and** an explicit `select=id,model,vin,status,days_in_stock,price_aed,aging_alert`. `cost_aed`, `gross_margin`, `net_margin`, `holding_cost_accrued`, `recommended_commission`, `vat_amount` are **not reachable by the agent at all** | Not executed. No hard price floor now exists in the agent's world — see SCHEMA_GAPS **G5**. The ceiling is a percentage only |
| 4 | **`search_policy`** — `rag_documents` searched by content only | **YES** — `supabaseTool`, single `content ilike` filter | **YES** — rewritten to `rpc/search_rag_documents(q, match_limit, p_tenant)` (confirmed on production: filters `d.tenant_id = p_tenant`, returns nothing when `p_tenant` is null and >1 tenant is active) | Not executed. The RPC is SECURITY **INVOKER** and the node holds a service_role (BYPASSRLS) credential, so `p_tenant` is the entire boundary — stated in the node's own `notes` |
| 5 | Eight `communication_logs` / `whatsapp_contacts` / `processed_messages` / `audit_log` calls keyed only on `lead_email` / `chat_id` | **YES** — 3 reads + 5 writes confirmed; every `tenant_id` column defaults to `nexus_default_tenant_id()` (→ `__unattributed__`), so the writes really did fall to the default tenant | **YES** — all three reads gained `tenant_id=eq.<t>`; all five writes now name `tenant_id`. Nothing relies on the default | Not executed. The *identity* half is still free-text `lead_email` — SCHEMA_GAPS **G6**. `nexus_comm_keys_for_lead` exists and was deliberately **not** adopted |
| 6 | **`Claim Message Id`** — idempotency on a bare `message_id`; a cross-dealer collision silently drops a real message | **YES** — body was `{message_id, source, chat_id}`. **The PK is already `(tenant_id, message_id)`** on production, so the defect was entirely the missing field routing every dealer into one tenant | **YES** — body now names `tenant_id`, plus explicit `on_conflict=tenant_id,message_id`. **No migration needed for this one** | Not executed |
| 7 | **`Send Reply via WAHA`** — `http://waha:3000`, `session: 'default'`, one global key: every dealer's reply leaves the same number | **YES** — verified verbatim | **PARTLY, and the rest is a named refusal.** Session now comes from `channel_registry.external_identifier` scoped to the tenant (`Fetch WAHA Channel`), which works on **both** entry paths. Host and API key have **no schema home** (SCHEMA_GAPS **G1**, **G2**) — they are read from `$env['WAHA_BASE_URL__<SLUG>']` and the env var named by `credential_ref`, with **no unkeyed fallback**; absent ⇒ `BDC_WAHA_SEND_CHANNEL_UNRESOLVED` / `BDC_WAHA_HOST_NOT_TENANT_SCOPED` / `BDC_WAHA_CREDENTIAL_UNRESOLVED`. The two media downloads and the media-URL rewrite in `Extract Message & Sender` were **also** on the shared host and key and got the same treatment | Not executed. Until G2 lands, one container behind one key can still serve every session — the separation would be WAHA's, not NEXUS's |
| 8 | Agent prompt hard-codes one dealership's identity, its 8% ceiling, its 3–5% opening band and a make allowlist | **YES** — plus a second dealership-specific leak the brief did not name: two incident anecdotes quoting a real closed price (`AED 538,200`) | **YES** — the system message is now an expression rendering `{{DEALERSHIP}}`, `{{MAX_DISCOUNT}}`, `{{OPENING_BAND}}`, `{{MAKE_ALLOWLIST}}` from `Tenant Policy`. No `8%`, no `3-5%`, no `cost_aed`, no `AED 538,200` remain anywhere in the prompt (verified by string search). An absent value renders as an explicit **NOT STATED with no discount authority**, never a borrowed number | Not executed. `tenant_configuration` has nowhere to *put* a ceiling (SCHEMA_GAPS **G3**), so today every tenant renders NO_AUTHORITY — the agent would quote list price and defer. That is the intended safe failure, but it **is** a behaviour change |
| 9 | All Supabase nodes carry `supabaseApi id dv4OeARarErZLHCj` (service_role) — RLS constrains none of it | **YES** | **NO — unchanged, deliberately.** The credential is untouched. Every boundary in this file is an explicit predicate, not a database policy | Moving to a request-scoped key is separate work. Not started, not in scope here |

---

## Added, beyond the listed findings

| Node | Why |
|---|---|
| `Resolve Tenant From WAHA Session` → `WAHA Session Registered?` → `Refuse Unregistered WAHA Session` | Copies `ops/n8n-whatsapp-cloud/receiver.sdk.js` exactly: `rpc/nexus_resolve_channel_tenant('whatsapp_waha_session', <session>)`, an IF on `tenant_id` notEmpty, and a throwing refusal on the false branch. The dealership comes from a **registered channel identity**, never from a body field |
| `Verify WAHA Origin Or Refuse` | The webhook has `authentication` absent. Requires a per-tenant secret header; refuses when unconfigured. See the residual risk below |
| `Require Tenant From Caller` | Outreach entry. Refuses unless the Master Router passed a UUID `tenant_id` |
| `Tenant Context` | The single junction both entry paths pass through. **One node to audit.** Throws `BDC_TENANT_UNRESOLVED` rather than defaulting |
| `Fetch Tenant Config` → `Fetch WAHA Channel` → `Tenant Policy` | Per-tenant brand, tone, currency, negotiation authority and send channel; emits a `not_stated` list and named `refusals` instead of defaults |
| `Resolve WAHA Send Channel` | Between `Guard Reply` and the send node. Refuses by name rather than sending from a shared number |

`Shape Lead For Router`, `Send to KYC Auditor` and `finance_calculator` now carry `tenant_id` into
their sub-workflows, so the tenant is not re-derived downstream from a phone number.

## Verification actually performed

- The JSON parses (`json.loads` on the serialised output).
- All 54 node names are unique.
- Every connection source and every connection target resolves to a real node — **zero dangling**.
- Graph reachability from both entry points (`WAHA Webhook (POST)`, `Called by Master Router`)
  reaches every node except the four AI attachments, which connect by `ai_languageModel` / `ai_tool`.
- Every one of the 15 Supabase calls was enumerated and checked for a `tenant_id` / `p_tenant`
  argument. All 15 carry one except `Resolve Tenant From WAHA Session`, which is the resolver itself.
- Every RPC signature used (`nexus_resolve_channel_tenant`, `nexus_lead_for_comm_key`,
  `nexus_resolve_tenant_config`, `search_rag_documents`) was read from `pg_proc` on production and
  confirmed `STABLE` — read-only — before being written against.
- **No runtime verification of any kind.** Not imported, not executed, not tested.
