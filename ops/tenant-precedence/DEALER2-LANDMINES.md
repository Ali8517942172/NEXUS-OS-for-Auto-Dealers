# Dealer #2 landmines — what breaks for ALBA the moment a second `tenants` row goes active

Read-only census. Production Supabase `dsvuoovivysszdoiorch`, `git` HEAD of
`NEXUS-OS-for-Auto-Dealers` (origin `Ali8517942172/NEXUS-OS-for-Auto-Dealers`, branch `main`),
and the live n8n instance (`mcp__n8n__*`), all read via SELECT / GET only.
Nothing was written to n8n or Supabase. `ops/tenant-precedence/wf.py` does not
exist in this checkout; live workflow bodies were pulled with
`mcp__n8n__get_workflow_details` instead.

The trigger condition, precisely: every landmine below fires on
`select count(*) from tenants where status='active' and not is_quarantine`
crossing from 1 to 2 — i.e. the moment dealer B's row is INSERTed **and**
`status='active'`, not merely on insert with some other status.

## The mechanism (confirmed live)

`public.nexus_caller_tenant_scope(p_purpose text)` (SECURITY DEFINER, live
`pg_proc` def pulled via `execute_sql`):

- signed-in caller with a `tenant_members` row → returns their tenant id(s).
  Safe at any tenant count — this is how the dashboard survives dealer B.
- signed-in caller (`role in ('authenticated','anon')` or `auth.uid()` set)
  with **no** membership row → returns `{}` (empty), never guesses.
- backend caller (`service_role`, no `auth.uid()`) → counts active,
  non-quarantine tenants: 0 → `{}`, 1 → that tenant, **2+ → `RAISE EXCEPTION
  errcode='NX991'`**. This is a hard Postgres exception, not an empty result.

**CORRECTION (2026-09-20, `$HOME/nexus-work`, the clean clone — the previous
agent's checkout was `$HOME/mnt/MY RESUMES/nexus-os`, which this session was
told is stale).** The migration IS present here:
`supabase/migrations/20260917080000_nx991_the_fuse_went_dark_at_the_second_dealership.sql`,
122 lines, defining `nexus_caller_tenant_scope(text)` exactly as described
below plus the five NX991 arms. Whatever produced the "zero matches" / "does
not exist under `supabase/migrations/` in this checkout on any branch" claim
below was reading a checkout that did not have it — not a real repo/production
drift. The repo and production agree on this function; there is no
undocumented change to reason about. The rest of this section (the function's
live behaviour, confirmed via `pg_proc`) is accurate and is left as originally
written.

## Table

| Thing | Where | What happens at 2 tenants | Evidence | Minimal fix | BLOCKS_DEALER_B |
|---|---|---|---|---|---|
| `v_customer_directory` (view) read by **Customer 360 — Data Aggregation (Bitrix24)** | n8n workflow `AZkGM5M4c1uzSH7S`, **active**, schedule-triggered, node `Get Customer Directory` (`GET …/v_customer_directory`, `authentication: predefinedCredentialType` / cred `dv4OeARarErZLHCj` = the shared **service_role** Supabase credential used across every live workflow), no `tenant_id` filter, no `onError` override | The view's live definition filters on `tenant_id = ANY(nexus_caller_tenant_scope('v_customer_directory'))`. A service_role caller with no explicit tenant hits the backend branch → **raises NX991** the instant a 2nd active tenant exists. The HTTP node has no `continueRegularOutput`, so the node — and by default the whole scheduled run — errors out. ALBA's nightly Customer 360 sync stops entirely, silently (nothing pages anyone; `nexus_tenancy_readiness()` only reports the *old* silent-NULL symptom, not this new raise) | Live `pg_get_functiondef(v_customer_directory)` shows the `nexus_caller_tenant_scope` call (pulled via `execute_sql`); repo migration `20260902105652` shows this view used to read `nexus_scoped_tenant_id()` instead — production has drifted; live n8n node JSON confirms `GET /rest/v1/v_customer_directory` with the service_role credential and zero query filters | The view needs a tenant-taking overload (mirror what was done for `search_rag_documents(q, limit, p_tenant)` / `nexus_lead_for_comm_key(key, tenant)`), and the n8n node needs to call it once per `nexus_active_dealership_ids()` row rather than reading the bare view. A client-side `?tenant_id=eq.<uuid>` filter on the existing GET does **not** help — the exception fires inside the view's own `WHERE` before any client filter is applied | **YES** |
| `v_inventory_sales` (view) | Same `nexus_caller_tenant_scope('v_inventory_sales')` dependency (confirmed same way). No live n8n workflow reads it — only the executive-dashboard frontend, which queries it with the signed-in rep's own JWT via `lib/data.js` (`SUPABASE_ANON` + `supabase.auth.getSession()`), which resolves through the safe membership branch, not the backend-count branch | Not broken for ALBA **today** — no service_role consumer exists in the current n8n export. Latent: any future backend job (pricing sync, aging-stock digest, etc.) that reads this view directly inherits the identical raise | `pg_get_functiondef(v_inventory_sales)`; `grep -rl v_inventory_sales n8n-workflows/` returns nothing; `apps/executive-dashboard/lib/data.js` shows the anon-key + per-session-JWT pattern | Same fix as above, applied pre-emptively before any backend job is pointed at this view | **NO** (today) |
| `nexus_lead_for_comm_key(p_key text)` / `nexus_comm_keys_for_lead(p_email, p_phone)` — legacy 1-/2-arg overloads | Both call `nexus_caller_tenant_scope` internally (confirmed via `pg_get_functiondef` + a search over `pg_proc` bodies). Tenant-taking overloads (`…(key, p_tenant)`, `…(email, phone, p_tenant)`) already exist alongside them in production | Would raise NX991 for any service_role caller at 2 tenants — but **no live consumer calls either overload**: `grep -rl "rpc/nexus_lead_for_comm_key\|rpc/nexus_comm_keys_for_lead"` across the whole repo matches only docs/comments and the **inactive** draft `ops/tenant-scope-bdc/whatsapp_bdc_ai_agent.TENANT_SCOPED.json` (n8n id `LTBExI7QzFeANeFg`, `active:false`) | grep above; `mcp__n8n__search_workflows` confirms the only live BDC workflow is `BiyHk9ZXxJUVGbf6`, which does not use these RPCs at all (matches identity by hand-rolled last-9-digit logic instead) | Dormant — no action required to protect ALBA; if/when the TENANT_SCOPED draft is ever activated it already uses the safe tenant-taking overloads, so leave as-is | **NO** |
| `search_rag_documents(q, match_limit)` — legacy 2-arg overload | Calls `nexus_caller_tenant_scope` internally, confirmed. The task's brief assumed the **live** Ask-AI workflow (`qHAtd3RckAKRBUkE`) still calls this 2-arg form | **Refuted.** The live, active workflow (`updatedAt` 2026-09-02, matches `activeVersionId`) calls the **3-arg** form explicitly: `{q, match_limit:6, p_tenant: $json.tenant_id \|\| null}`, where `tenant_id` is resolved by node `Extract Question` from a JWT→`tenant_members` lookup (node `Tenant For JWT User`), falling back to a `sole_configured_tenant` **only** when `$env.NEXUS_TENANT_MAP` (or the hardcoded `{default: '<ALBA uuid>'}`) has exactly one key — an env var, not a DB row count, so adding dealer B's `tenants` row alone does not change this fallback | `mcp__n8n__get_workflow_details qHAtd3RckAKRBUkE`, node `Supabase Knowledge Search` body + node `Extract Question` full source (both pulled live); 3-arg `search_rag_documents` def confirms `if v_tenant is null and (count active tenants)>1 then return;` — fails closed (empty), does not raise | None needed for ALBA. Before onboarding dealer B for real, `NEXUS_TENANT_MAP` must gain dealer B's key so their JWT users resolve too — that's dealer-B enablement, not an ALBA regression | **NO** |
| "sole configured tenant" fallback that counts `tenants` DB rows (vs. `$env.NEXUS_TENANT_MAP`) | Checked every fallback branch in both live, active n8n workflows that resolve a tenant: Ask-AI's `Extract Question` and WhatsApp BDC's `Resolve Tenant` | **Refuted for both live workflows.** Neither queries `tenants` row-count. Both key off `$env.NEXUS_TENANT_MAP` (JSON map of session/JWT → tenant uuid) with a hardcoded `{default: 'fff6a2b5-...'}` = ALBA fallback, and both **fail closed / refuse** rather than guess when the map has 2+ entries and the caller's identity doesn't resolve. `nexus_caller_tenant_scope`'s own backend branch *does* count `tenants` rows, but that's the DB function (see row 1/2 above), not an n8n node | Full source of both nodes pulled via `get_workflow_details` and quoted above | N/A — pattern not found live as described | **NO** |
| `nexus_default_tenant_id()` / `is_unattributed_default` | DB function backing the `tenant_id` column DEFAULT on most tables | Not tenant-count-dependent: for a backend writer that omits `tenant_id`, it *always* resolves to the quarantine tenant (`is_unattributed_default AND is_quarantine`), at 1 tenant or at 50. Behaviour is identical before and after dealer B | `pg_get_functiondef(nexus_default_tenant_id)` (live) | None | **NO** |
| WhatsApp BDC AI Agent — full workflow | n8n `BiyHk9ZXxJUVGbf6`, **active**, updated 2026-09-07 | Already tenant-scoped end-to-end through explicit `tenant_id`, threaded from `Resolve Tenant` (WAHA-session → `$env.NEXUS_TENANT_MAP` allowlist, fail-closed on an unrecognised session) through `Fetch All Leads` (`tenant_id=eq.<t>`), `search_policy` (`tenant_id=eq.<t>` on `rag_documents`), `Claim Message Id` / `Log Incoming Message` (conditionally include `tenant_id`). Never calls `nexus_caller_tenant_scope`, `nexus_lead_for_comm_key`, or `nexus_comm_keys_for_lead` | Full node dump pulled via `get_workflow_details BiyHk9ZXxJUVGbf6`; 796 raw `tenant_id`/`p_tenant` string hits across the node set, none of them the dangerous RPCs | None | **NO** |
| ~~Missing migration `20260917080000_nx991_...`~~ — **REFUTED 2026-09-20** | `supabase/migrations/20260917080000_nx991_the_fuse_went_dark_at_the_second_dealership.sql` exists in `$HOME/nexus-work` (the clean clone), 122 lines, matches production's live `nexus_caller_tenant_scope` byte-for-byte in behaviour | N/A — this was a false alarm, not a break | `ls supabase/migrations/ \| grep nx991` finds it; `node ops/ci/function-grants.mjs` passes with it in place | None needed. The original claim was almost certainly read from a stale/incomplete checkout, not from `$HOME/nexus-work` | **NO** (false alarm) |

## BLOCKS_DEALER_B = yes, for the caller

- **`v_customer_directory` → Customer 360 — Data Aggregation (Bitrix24)** (n8n `AZkGM5M4c1uzSH7S`, active, scheduled, service_role, no tenant filter): raises `NX991` and the run fails the instant dealer B's `tenants` row goes `status='active'`. Fix: give the view a `(…, p_tenant)` overload and have the workflow call it once per `nexus_active_dealership_ids()` row instead of reading the bare view under service_role.

**STATUS (2026-09-20): FIXED.** `supabase/migrations/20260920100000_nx1000_customer_360_went_dark_at_the_second_dealership.sql`
adds `public.nexus_customer_360_directory_for_tenant(p_tenant uuid)` — SECURITY
DEFINER, service_role-only, one explicit dealership per call, same dedupe
shape as the view, does not touch `v_customer_directory` or dashboard
behaviour. `ops/tenant-precedence/patched2/AZkGM5M4c1uzSH7S.json` rewires the
workflow: `Schedule Trigger` → `Get Active Dealerships` (new, calls
`nexus_active_dealership_ids()`) → `Normalise Dealership List` (new) → `Get
Customer Directory` (changed, now the per-tenant RPC, runs once per
dealership) → `Normalise Customers` (changed, now passes `tenant_id` through)
→ unchanged from there. Tested on staging (`wwspuxrbiyagnrnzgate`, 3 active
non-quarantine tenants): bare `v_customer_directory` still raises NX991 under
this session's role exactly as before; the new function returns the correct,
tenant-isolated rows for each of the three tenants with no cross-tenant
leakage, and `has_function_privilege` confirms anon/authenticated cannot
execute it while service_role can. **Not applied to the live n8n workflow or
to production Supabase — both are read-only for this task.**
