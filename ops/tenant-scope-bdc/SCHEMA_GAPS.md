# SCHEMA_GAPS — WhatsApp BDC AI Agent, tenant scoping

Agent: **BDC-FIX** · authored 2026-09-17 · production Supabase `dsvuoovivysszdoiorch` read **SELECT-only**.

Every place the rewritten workflow needed a per-dealership value and the schema has nowhere to
hold it. This is the list the orchestrator turns into a migration. **No migration was applied and
no DDL was written by me.**

Each gap states: the table/column that would be needed, and what
`whatsapp_bdc_ai_agent.TENANT_SCOPED.json` does in the meantime.

---

## G1 — No reachable secret home for WAHA credentials

**Verified read-only.** `channel_secret(integration_id, kind, vault_secret_id, fingerprint,
installed_at, rotated_at, installed_by)` exists and is keyed on `integration_id`, so it is already
channel-agnostic and *could* hold WAHA secrets. The reader is not:

```
nexus_channel_secret_reveal(p_phone_number_id text, p_kind text, p_reason text)
  ... where cr.channel_type = 'whatsapp_cloud_phone_number_id'
```

It is hard-coded to the Meta Cloud channel type and cannot return a secret for a
`whatsapp_waha_session` row. The one live WAHA row in `channel_registry` carries
`credential_ref = 'env:WAHA_API_KEY'` — a text pointer to a **single global environment variable**,
i.e. every dealership would present the same key.

**Needed**
- `nexus_channel_secret_reveal` gains `p_channel_type text` (or a sibling RPC keyed on
  `(channel_type, external_identifier)`).
- Rows in `channel_secret_kind` for `waha_api_key` and `waha_webhook_secret`.

**Meanwhile in the workflow**
- `Tenant Policy` resolves the API key by following `channel_registry.credential_ref` when it is
  of the form `env:<NAME>`, and leaves it null otherwise.
- `Resolve WAHA Send Channel` and `Download KYC Image` / `Download Voice Note` refuse by name
  (`BDC_WAHA_CREDENTIAL_UNRESOLVED`) rather than falling back to a shared key.
- The inbound origin secret is read from `$env['WAHA_WEBHOOK_SECRET__<SLUG>']` and
  `Verify WAHA Origin Or Refuse` throws `BDC_WAHA_ORIGIN_SECRET_NOT_CONFIGURED` when it is unset.

---

## G2 — `channel_registry` has no endpoint/host column

**Verified read-only.** Columns are `integration_id, tenant_id, channel_type, external_identifier,
credential_ref, status, created_at, updated_at`. There is nowhere to record *which WAHA container*
a dealership's WhatsApp lives in. The pre-fix workflow hard-coded `http://waha:3000`.

This is the gap that **blocks a complete fix**. The session name is per-tenant-capable
(`external_identifier`), but if every session lives in one container behind one API key, the
separation is enforced by WAHA, not by NEXUS.

**Needed**
- `channel_registry.endpoint_url text` (and a `NOT NULL`-style check for provider types that need
  a host), surfaced by `nexus_resolve_channel_tenant` and `nexus_channel_send_candidates`.

**Meanwhile in the workflow**
- `$env['WAHA_BASE_URL__<SLUG>']`, keyed by tenant slug, **with no unkeyed fallback**.
  Absent ⇒ `BDC_WAHA_HOST_NOT_TENANT_SCOPED` (send) or `BDC_WAHA_MEDIA_HOST_UNRESOLVED` (media).

---

## G3 — `tenant_configuration` has no negotiation authority

**Verified read-only.** No column for a discount ceiling, an opening band, or a make allowlist.
The prompt hard-coded one dealership's 8% ceiling and 3–5% opening band.
`approval_rules jsonb` exists but is **unvalidated**: `tenant_configuration_validate()` only checks
that `timezone` is an IANA zone.

**Needed**
- `tenant_configuration.bdc_max_discount_pct numeric`
- `tenant_configuration.bdc_opening_band_pct_min numeric`, `..._max numeric`
- `tenant_configuration.bdc_make_allowlist text[]`
- …or a validated `approval_rules->'bdc_negotiation'` shape enforced by the existing trigger,
  plus `*_source` / `*_state` columns matching the house pattern so "not stated" is a stated fact.

**Meanwhile in the workflow**
- `Tenant Policy` reads `approval_rules->'bdc_negotiation'` (`max_discount_pct`,
  `opening_band_pct_min/max`, `make_allowlist`).
- When the key is absent the agent is given **no discount authority at all**: the prompt renders
  `NOT STATED - you have NO authority to offer any discount`, quotes list price, and offers to have
  a colleague confirm. It never borrows another dealership's 8%.

---

## G4 — `brand_name` is null for the only live tenant

`tenant_configuration.brand_name`, `ai_tone`, `followup_policy`, `approval_rules` are **all NULL**
for the single configured tenant (`alba-cars`). The agent's own name is therefore unstated.

**Needed** — nothing structural; the row needs filling. `nexus_resolve_tenant_config` already
returns `brand_name_state`.

**Meanwhile** — `brand_name` → `tenant_name` → `'this dealership'`, and the outreach template says
`'the dealership'` rather than naming anyone.

---

## G5 — No margin-safe price floor

`inventory.cost_aed` is now unreachable to the agent (the tool's `select` omits `cost_aed`,
`gross_margin`, `net_margin`, `holding_cost_accrued`, `recommended_commission`, `vat_amount`).
But there is no column the agent *could* safely read as a hard floor.

**Needed** — `inventory.floor_price_aed integer` (a derived, non-margin-revealing minimum),
maintained beside the existing derived columns by `recompute_inventory_derived()`.

**Meanwhile** — the percentage ceiling from G3 is the only floor, and the prompt says so
explicitly: *"There is no cost floor available to you… do not construct one."*

---

## G6 — `communication_logs` has no tenant-scoped identity key

Rows are joined on `lead_email`, which in practice carries chat ids, raw digits and synthetic
`+<digits>@whatsapp.lead` addresses. `communication_logs` has `tenant_id` and
`communication_logs_tenant_id_idx`, so the *tenant* filter is now correct — but the identity half
is still a free-text string, and `(tenant_id, lead_email)` is not unique.

**Needed** — `communication_logs.lead_id integer references leads(id)` (tenant-consistent), or
adoption of `nexus_comm_keys_for_lead(p_email, p_phone, p_tenant)` as the only key builder.

**Meanwhile** — the three read nodes keep their existing client-side key construction and add
`tenant_id=eq.<t>`. `nexus_comm_keys_for_lead` was **not** adopted; that is a deliberate scope
limit, not an oversight.

---

## G7 — `tenant_id` defaults to `nexus_default_tenant_id()` on seven tables

**Verified read-only.** `leads`, `inventory`, `rag_documents`, `communication_logs`, `audit_log`,
`processed_messages`, `whatsapp_contacts` all default `tenant_id` to `nexus_default_tenant_id()`
(→ `__unattributed__`, `02c86264-…`). A writer that forgets `tenant_id` therefore **succeeds
quietly** and mis-files the row instead of erroring.

**Needed** — drop the default (or replace it with a function that raises) once every writer names
the tenant. This is what turns "we fixed the workflow" into "the schema cannot be mis-used".

**Meanwhile** — every insert/patch in this copy names `tenant_id` explicitly. Nothing relies on
the default. Nothing stops the *next* workflow from relying on it.

---

## G8 — Outreach tenancy is an input contract, not a registry lookup

The `Called by Master Router` path has no channel identity to resolve, so `tenant_id` arrives as a
sub-workflow input. `settings.callerPolicy` is `workflowsFromSameOwner`, which is what keeps a
third party from invoking it at all.

**Needed** — nothing in the schema. The Master Router export must be confirmed to pass `tenant_id`.
**I did not verify that**; the Master Router workflow was out of scope for this agent.

**Meanwhile** — `Require Tenant From Caller` refuses with `BDC_OUTREACH_TENANT_NOT_SUPPLIED`
unless a UUID arrives.

---

## G9 — One webhook path for every dealership, unauthenticated

`WAHA Webhook (POST)` is `path: whatsapp-inbound`, `authentication` absent. Anyone who can reach
the n8n box can POST a body naming any registered session. Resolving the tenant from the session
name is only as good as the claim that the delivery is genuine. The Meta Cloud receiver closes the
equivalent hole with an HMAC over the raw body
(`ops/n8n-whatsapp-cloud/verify-or-refuse.node.js`); WAHA has no equivalent in this repo.

**Needed** — G1's secret kind, plus a per-tenant webhook path or an HMAC the receiver can verify
*before* it trusts the session name.

**Meanwhile** — `Verify WAHA Origin Or Refuse` runs immediately after tenant resolution and
requires a per-tenant shared secret header. It refuses when unconfigured. **This is the residual
risk most likely to still leak.**

---

## Not a schema gap, but it removes RLS from the picture

Every Supabase node in this workflow — including the two rewritten agent tools — carries
`supabaseApi id dv4OeARarErZLHCj`, which is **service_role** (`BYPASSRLS`). Every boundary in this
file is therefore an explicit predicate in a URL or an RPC argument, not a policy the database
enforces. `search_rag_documents` says so in its own source: *"service_role is BYPASSRLS, so for n8n
this argument IS the whole boundary."* Moving these nodes to a request-scoped key is a separate
piece of work and is **not** done here.
