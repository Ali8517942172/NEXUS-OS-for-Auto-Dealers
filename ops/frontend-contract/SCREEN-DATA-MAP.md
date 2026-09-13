# The frontend data contract — what every screen reads and writes

**Measured 8 September 2026.** Production Supabase `dsvuoovivysszdoiorch`, read-only.
Deployed bundle `https://nexus-os-dashboard-six.vercel.app/assets/main-BFmkO_-a.js`,
1,499,871 bytes, sha256 `9c24e71ea338209fb7a4ef72808ea16156db6be72b7f002511e5b34d1ca280cd`.
No git write, no database write, no n8n call.

---

## Why this file exists

For n8n the rule is settled: **live box = operational truth, git export =
reproducibility.** The same gap exists on the frontend and has already cost this
project three separate mistakes, all of the same shape — a decision taken about
the deployed product from something other than the deployed product.

- `CLAUDE.md` records the readiness flip being held back on 7 September on the
  belief that the dashboard carrying `rpc/nexus_lead_record_manual` had not
  shipped. It had. The argument was only settled by probing the served bundle.
- The working assumption that *every* dashboard write goes through a
  `SECURITY DEFINER` function was **false**. `grep -rn "dbWrite"` found direct
  table writes, and finding them is the only reason a grant-narrowing pass did
  not take two live screens down.
- A `grep` of `origin/main` was used to count screens. That ref in this clone is
  126 commits stale, and the live product has never been merged to `main`.

Nothing until now recorded, in one place, **what each screen actually reads and
writes**. That map is the input to every future grant change, every schema change
and every deprecation, and its absence is why grant work here has been dangerous.

This file is the map. `verify-bundle.mjs` beside it is the part of the map a
machine can re-check.

---

## How this was measured

Four instruments, kept apart on purpose. Where a claim below is *asserted* rather
than measured it says so.

1. **The source tree.** Every `db()` and `dbWrite()` call site in
   `apps/executive-dashboard/`, extracted by brace-matching from the call opener
   to its closing parenthesis, so multi-line concatenated paths are captured
   whole rather than truncated at the first line. **179 matches; 175 real call
   sites** — the other four are the two function definitions in `lib/data.js`
   and two prose mentions of `db(...)` inside comments (`lib/data.js:287`,
   `lib/ui.js:141`). Of the 175: **168 reads, 7 writes.**
   These are the only network calls to the database in the product: `lib/data.js`
   is the single fetch surface, and its header says so.

2. **The deployed bundle.** Downloaded from Vercel and searched as text. The
   filename is content-hashed, so it was read out of the served `index.html`
   rather than assumed. Counting substrings in a minified bundle is sound for
   PostgREST paths because they are string literals and the minifier does not
   rewrite string contents. It is *not* sound for paths assembled at runtime;
   those are called out individually below.

3. **The live catalogue.** `pg_class`, `pg_proc`, `pg_policy`,
   `information_schema.columns`, `information_schema.column_privileges`,
   `has_table_privilege`, `has_column_privilege`, `has_function_privilege`,
   `has_schema_privilege`, and view dependencies via `pg_rewrite`/`pg_depend`.

4. **A throwaway PostgreSQL 17.11 cluster**, used once, to settle the one
   question that could not be asked of production without writing to it. See
   *The guard's blast radius* below. Production is PostgreSQL 17.6
   (`server_version_num` 170006), so the major version matches.

### One thing measurement 1 and 2 disagree about, and it matters

The repository's `apps/executive-dashboard/dist/assets/main-CgKC2kaX.js` is
**1,499,768 bytes** — 103 bytes different from what Vercel serves. It is a local
build that was never deployed. Every claim in this file about "the bundle" means
the one fetched from Vercel. The checked-in `dist/` is not evidence about the
product, and reading it as if it were is the same class of error this file exists
to stop.

---

## The role, once

**Every database call the dashboard makes runs as `authenticated`.**

`app.js` `boot()` returns at the login card before any screen fetches, so no
screen read is ever issued as `anon`. `lib/data.js` `authToken()` asks
`supabase.auth.getSession()` per request and sends that JWT; only when there is
no session at all does it fall back to the anon key, and in that state the app is
showing the login card. Measured on the live catalogue:

| role | `USAGE` on `public` | `USAGE` on `storage` |
|---|---|---|
| `authenticated` | true | true |
| `anon` | **false** | true |
| `service_role` | true | true |

`anon` cannot reach the `public` schema at all, and every table below carries an
explicit `*_deny_anon` policy on top of that. RLS is the security boundary and it
is enforced per request; nothing in the browser is a second lock, and
`lib/data.js` and `lib/tenant.js` both say so in their own headers.

**Consequence for this map:** the interesting variable per call is not the role.
It is *which grant or policy that call depends on*, and that is the column
carried in every table below.

### Three privilege shapes, and why the distinction is the whole document

| shape | who the database checks | what a revoke breaks |
|---|---|---|
| **direct table read/write** | the caller's grant on that table, table-level or column-level | the call, immediately, with `42501` |
| **`SECURITY DEFINER` function owned by `postgres`** | nothing but `EXECUTE` on the function | only a revoke of `EXECUTE` |
| **`SECURITY INVOKER` function or view** | the caller's grant on every base object the body touches | the call, at one remove — and this is the shape that surprises people |

**Every single view this dashboard reads is `security_invoker=true`.** Measured:
`public` holds 42 views, all of them named `v_*`, and **all 42 carry the option**
(`pg_class.reloptions`). An event trigger
(`nexus_guard_security_invoker_views`) keeps it that way. So a view read is not
insulation. `screens/revenue.js` reading `v_lead_recovery` is, as far as
privileges are concerned, reading `leads`, `purchase_history`, `users`,
`audit_log`, `lead_recovery_actions`, `lead_recovery_settings`, `tenants` and
`v_lead_messages` as the signed-in user.

Three of the functions the dashboard calls are also `SECURITY INVOKER`, and they
are the ones to watch:

- `sentinel_inventory_actions(p_recommendation, p_min_risk_rank)` — reads
  `v_inventory_profit_sentinel` as the caller.
- `nexus_lead_attribution_summary(p_since)` — but its body calls
  `nexus_lead_attribution()`, which *is* `SECURITY DEFINER`, so its base-table
  reach is the definer's. It needs only `EXECUTE` on both.
- `nexus_lead_assign_owner(p_lead_id, p_to_staff_id, p_reason)` — **performs its
  `UPDATE` on `public.leads` as the caller.** It is the single most important row
  in this document; see the column-grant index.

---

# Part 1 — per screen and per module

`lib/nav.js` registers **22 screens**, and all 22 are mapped below. Two further
files — `screens/held-enquiries.js` and `screens/system-truth.js` — appeared in
`screens/` while this pass was running, are untracked, are in no nav group and
are in no deployed bundle. They are being written by other agents in parallel and
are **deliberately not mapped here** — see *Unknowns*.

Notation: `→` read, `⇒` write. "bundle" is the occurrence count of that object's
literal in the deployed bundle, measured, not inferred from source.

---

## `app.js` — boot

| | call | depends on | bundle | breaks if revoked / dropped |
|---|---|---|---|---|
| → | `users?select=*&email=eq.<signed-in email>` | `SELECT` on `users`, policy `users_authenticated_read` | 4× `users?select=` | No staff record resolves. `lib/data.js` distinguishes "read failed" from "found nothing" via `ME_READ_FAILED`, so the app says so rather than claiming you have no staff record |
| → | `tenant_members?select=tenant_id,role,staff_user_id` | `SELECT` on `tenant_members`, policy `tenant_members_self_read` | 3× | Account authority becomes unknown. `membershipKnown()` goes false and every `canX()` predicate answers **true** — the UI offers the action and lets the database refuse, deliberately |
| → | `leads?select=id&limit=1` (connectivity probe) | `SELECT` on `leads` | — | The connection pill cannot say the database is reachable |

## `lib/tenant.js` — whose data is on screen

| | call | depends on | breaks if revoked |
|---|---|---|---|
| → | `tenant_members?select=tenant_id,role,created_at&order=created_at.asc,tenant_id.asc` | `SELECT` on `tenant_members` | The shell cannot name the dealership. **Fails open by design**: only a read that *succeeds* and returns no membership blocks a screen |
| → | `tenants?select=id,name,slug,status` | `SELECT` on `tenants`, policy `tenants_member_read` | Same; the active tenant falls back to showing an id rather than a name |

The `order by` is copied from `public.nexus_current_tenant_id()`. If that
function's tiebreak changes, this read changes with it or the shell labels the
wrong dealership.

## `lib/badges.js` — the sidebar counts (polls)

| | call | depends on | breaks if revoked |
|---|---|---|---|
| → | `v_needs_attention?select=kind,severity,ref,title,detail,at,screen&limit=500` | `SELECT` on `v_needs_attention` **and**, because it is `security_invoker`, on `audit_log`, `competitors`, `inventory`, `inventory_profit_settings`, `kyc_documents`, `leads`, `v_conversations` | Every sidebar badge is wiped rather than left stale, and the poller is stopped with the session |

## `lib/identity.js` — `resolveIdentity()`, used by 7 screens

Reads are planned per seed and issued with `Promise.allSettled`; a failed source
is recorded as `err` and consumers may not read an absence from it.

| | call | depends on |
|---|---|---|
| → | `v_conversations?select=<CONV_COLS>&chat_id=eq.…` / `&lead_email=eq.…` | `SELECT` on `v_conversations` → `communication_logs`, `leads`, `tenants`, `whatsapp_contacts` |
| → | `leads?select=*,users(id,name)&id=eq.…` | `SELECT` on `leads` and on `users`, plus FK `leads_assigned_to_id_fkey` for the embed |
| → | `leads?select=id,name,email,phone,status&email=eq.…` | `SELECT` on `leads` |
| → | `v_customer_directory?select=*&email=eq.…` | `SELECT` on `v_customer_directory` → `leads`, `purchase_history`, `tenants` |
| → | `whatsapp_contacts?select=<CONTACT_COLS>&phone=eq.…` | `SELECT` on `whatsapp_contacts` |

`personQuery(table, identity, opts)` builds `<table>?select=…&or=(…)&order=…&limit=…`
at runtime. The table name survives minification; the `?select=` does not sit
beside it. That is why the bundle shows `v_communication_log_evidence` once as a
bare word and never as `v_communication_log_evidence?select=`.

## Overview — `screens/overview.js`

| | call | depends on | bundle |
|---|---|---|---|
| → | `v_needs_attention?select=kind,severity,ref,title,detail,at,screen&limit=…` | view + its 7 base objects | 17× |
| → | `v_conversations?select=chat_id,display_name,identified,phone,last_message_at&awaiting_reply=is.true` | view + `communication_logs`, `leads`, `tenants`, `whatsapp_contacts` | 5× |
| → | `kyc_documents?select=id,lead_name,full_name,lead_email,document_type,verdict,created_at,retain_until,void_reason,attempt_number,max_attempts&storage_path=is.null&purged_at=is.null` | `SELECT` on `kyc_documents`, policy `kyc_documents_staff_read` | 3× |
| → | `v_workflow_health?select=…&health=in.(DEGRADED,PRODUCING_NOTHING,UNKNOWN_OUTCOME)` | view → `audit_log` (+ `nexus_workflow_catalogue()` inside the body) | 12× |
| → | `competitors?select=id&limit=1` | `SELECT` on `competitors` | 25× (the word, mostly prose) |
| → | `v_inventory_action_queue?select=<29 named cols>&order=proposed_at.desc` | view → `inventory`, `inventory_action_reason_codes`, `inventory_actions`, `purchase_history`, `tenants`, `users`, `v_inventory_profit_sentinel` | 16× |
| → | `leads?select=id,name,email,phone,status,ai_score,vehicle_interest,source,budget_aed,response_time_minutes,created_at,assigned_to,assigned_to_id` | `SELECT` on `leads` | 18× `leads?select=` |
| → | `rpc/sentinel_inventory_actions` (no args, no `select`) | `EXECUTE`, **and** `SELECT` on the sentinel view's base tables — `SECURITY INVOKER` | 6× |
| → | `daily_metrics?select=*&order=snapshot_date.desc&limit=1` | `SELECT` on `daily_metrics` | 1× |
| → | `communication_logs?select=lead_email,created_at,channel,direction,message&direction=eq.outbound&created_at=gte.…` | `SELECT` on `communication_logs` | 7× |
| → | `whatsapp_contacts?select=chat_id,phone,push_name,lead_email` | `SELECT` on `whatsapp_contacts` | 9× |
| → | `leads?select=*,users(id,name)&id=eq.…` (drawer) | `leads` + `users` + FK | — |
| → | `v_lead_recovery_coverage?select=*` | view → `communication_logs`, `lead_recovery_actions`, `leads`, `tenants`, `v_lead_messages`, `v_lead_recovery`, `v_needs_attention` | 14× (`v_lead_recovery`) |
| → | `v_deal_rescue?select=lead_id&limit=200` | view → `deal_rescue_settings`, `tenants`, `v_deal_rescue_candidates`, `v_lead_recovery` | 9× |

No writes. Writes reachable from this screen go through `lib/lead-drawer.js`.

## Leads — `screens/leads.js`

| | call | depends on |
|---|---|---|
| → | `v_needs_attention?…&screen=eq.leads` | view + bases |
| → | `communication_logs?select=lead_email,direction,created_at&created_at=gte.…` | `SELECT` on `communication_logs` |
| → | `whatsapp_contacts?select=chat_id,phone,push_name,lead_email` | `SELECT` on `whatsapp_contacts` |
| → | `rpc/nexus_lead_attribution` (no args; `p_since` defaults NULL) | `EXECUTE` only — `SECURITY DEFINER`, owner `postgres` |
| → | `leads?select=*,users(id,name)&order=created_at.desc` | `leads` + `users` + FK |
| → | `purchase_history?select=email` | `SELECT` on `purchase_history` |
| → | `audit_log?select=workflow,status,summary,lead_email,logged_at` | `SELECT` on `audit_log` |
| ⇒ | n8n `POST /webhook/lead-escalation` and `/webhook/lead-trigger` | the workflow's own Supabase-JWT check; **no database grant** |

Also mounts `lib/lead-drawer.js` and `lib/manual-lead-form.js` — see those.

## Lead Sources — `screens/lead-sources.js`

| | call | depends on |
|---|---|---|
| → | `v_lead_origin?select=event_id,source_key,source,channel_family,phase,disposition_reason,received_at,occurred_at,lead_id,origin_cryptographically_verified,origin_strength,origin_explanation,is_test_traffic&order=received_at.desc` | `SELECT` on the view **and column-level `SELECT` on `lead_event`** — see below |
| → | `rpc/nexus_lead_source_readiness` | `EXECUTE` only — `SECURITY DEFINER` |

**This is the most delicately grantable read in the product.** `v_lead_origin` is
`security_invoker` over `lead_event`, and `authenticated` holds **no table-level
`SELECT` on `lead_event`** — `has_table_privilege('authenticated','lead_event','SELECT')`
is **false**. What it holds is column-level `SELECT` on exactly 15 of the 19
columns. Measured per column:

| readable by `authenticated` | withheld |
|---|---|
| `event_id`, `tenant_id`, `source_key`, `environment`, `origin_verified`, `provenance_counts_as_real`, `external_event_id`, `occurred_at`, `received_at`, `phase`, `disposition_reason`, `hydrated_at`, `hydration_error`, `lead_id`, `promoted_at` | `endpoint_id`, `payload_raw`, `hydrated_payload`, `normalized` |

The view body references only granted columns, so the read succeeds. That is a
deliberate shape, not an accident: `payload_raw` is kept verbatim and a Google
lead form puts `google_key` inside the body. **Any `ALTER TABLE public.lead_event`
fires the born-open guard and strips these column grants, and this screen dies.**

## Conversations — `screens/conversations.js`

| | call | depends on |
|---|---|---|
| → | `leads?select=id,name,email,phone,status&order=created_at.desc` | `SELECT` on `leads` |
| → | `v_conversations?select=<24 named cols>&order=last_message_at.desc` | view + `communication_logs`, `leads`, `tenants`, `whatsapp_contacts` |
| → | `v_workflow_health?select=<HEALTH_COLS>&name=in.(…)` | view → `audit_log` |
| → | `v_needs_attention?…&screen=eq.conversations` | view + bases |
| → | `leads?select=*,users(id,name)&id=eq.…` | `leads` + `users` + FK |
| → | `v_communication_log_evidence?select=id,direction,message,channel,created_at,evidence_state,evidence_flagged,evidence_reason_code,evidence_reason,evidence_actor,evidence_at&…` (built by `personQuery`) | view → `communication_log_evidence_event`, `communication_logs`, `tenants` |
| ⇒ | n8n `POST /webhook/whatsapp-send` | workflow JWT check; no grant. **Goes out on the dealership's real number** |

## Compliance — `screens/compliance.js`

| | call | depends on |
|---|---|---|
| → | `kyc_documents?select=*&order=created_at.desc` | `SELECT` on `kyc_documents` |
| → | `whatsapp_contacts?select=chat_id,phone,push_name,lead_email&limit=2000` | `SELECT` on `whatsapp_contacts` |
| → | `leads?select=id,name,email,phone&limit=2000` | `SELECT` on `leads` |
| → | `audit_log?select=*&workflow=ilike.*KYC*` | `SELECT` on `audit_log` |
| → | `communication_logs?select=lead_email,message,created_at` | `SELECT` on `communication_logs` |
| → | `v_needs_attention?…&kind=eq.kyc_archive_gap` | view + bases |
| → | `v_workflow_health?select=…&limit=200` | view → `audit_log` |
| → | `users?select=id,name&limit=2000` | `SELECT` on `users` |
| → | `rpc/nexus_whatsapp_consent_events?p_limit=…` | `EXECUTE` only — `SECURITY DEFINER` |
| → | `rpc/nexus_whatsapp_consent_current` | `EXECUTE` only — `SECURITY DEFINER` |
| → | **Storage**: `supabase.storage.from('kyc-documents').createSignedUrl(path, 60)` | `USAGE` on schema `storage`, plus `storage.objects` policy `kyc_objects_staff_read` — `bucket_id = 'kyc-documents' AND nexus_kyc_object_readable(name)`. `kyc_objects_no_anon` denies `anon` outright. Bucket is private (`storage.buckets.public = false`) |

A row whose `purged_at` is set has had its object deleted by retention; signing
that path yields a URL that 404s, so callers must skip it.

## Money Leaks — `screens/money-leaks.js`

Reads only: `rpc/sentinel_inventory_actions`, `v_inventory_action_queue`,
`v_action_center_health`, `v_lead_recovery`, `v_lead_recovery_coverage`,
`v_deal_rescue_readiness`, `v_needs_attention`, `v_workflow_health`.
All `SELECT` on `security_invoker` views plus one `SECURITY INVOKER` function; the
transitive base set is `audit_log`, `communication_logs`, `competitors`,
`inventory`, `inventory_action_events`, `inventory_action_reason_codes`,
`inventory_actions`, `inventory_profit_settings`, `kyc_documents`,
`lead_recovery_actions`, `lead_recovery_settings`, `leads`, `purchase_history`,
`tenants`, `users`, `deal_rescue_prerequisites`, `finance_quotes`.

## Revenue Recovery — `screens/revenue.js`

Reads only: `v_inventory_profit_sentinel`, `v_action_center_health`,
`v_inventory_action_queue`, `v_lead_recovery`, `v_lead_recovery_coverage`,
`v_deal_rescue`, `v_deal_rescue_candidates`, `v_deal_rescue_readiness`,
`v_policy_rule`, `v_policy_unmigrated_constant`, `v_attribution_sale_chain`.

## Lead Recovery — `screens/lead-recovery.js`

Reads only: `v_lead_recovery` (52 named columns), `v_lead_recovery_coverage`,
`v_lead_recovery_state_model`, `v_lead_recovery_queue`, `v_lead_recovery_health`.

## Deal Rescue — `screens/deal-rescue.js`

Reads only: `v_deal_rescue`, `v_deal_rescue_candidates`, `v_deal_rescue_readiness`,
`v_deal_rescue_state_model`.

## Attribution — `screens/attribution.js`

| | call | depends on |
|---|---|---|
| → | `v_attribution_link_map?select=<17 cols>` | view → `attribution_edge_type`, `attribution_link_basis`, `tenants`, `v_attribution_edges` |
| → | `attribution_link_basis?select=basis,rank,is_evidence,default_confidence,label,description` | `SELECT` on the table, policy `attribution_link_basis_read` |
| → | `v_attribution_sale_chain?select=<36 cols>` | view → `communication_logs`, `deals_embeddings`, `finance_quotes`, `inventory`, `inventory_actions`, `inventory_profit_settings`, `leads`, `purchase_history`, `tenants`, `v_lead_messages` |
| → | `v_attribution_lead_chain?select=<31 cols>` | same base set minus `deals_embeddings`, `inventory_actions` |
| → | `rpc/nexus_lead_attribution_summary` | `EXECUTE` on it **and** on `nexus_lead_attribution` — it is `SECURITY INVOKER` calling a `SECURITY DEFINER` |
| → | `v_attribution_edges?select=edge,from_kind,from_ref,to_kind,to_ref,basis,confidence,note` | view + bases |
| → | `v_attribution_events?select=<17 cols>` | view + bases |

## Policy — `screens/policy.js`

Reads only: `v_policy_rule` (→ `policy_rule`, `tenants`), `v_policy_authoritative`
(→ `tenants`, `v_policy_rule`), `v_policy_unmigrated_constant` (→ `policy_rule`,
`policy_unmigrated_constant`, `v_policy_authoritative`).

## Inventory — `screens/inventory.js`

| | call | depends on |
|---|---|---|
| → | `rpc/sentinel_inventory_actions` and `rpc/sentinel_inventory_actions?p_recommendation=…&p_min_risk_rank=…` | `EXECUTE` **and** `SELECT` on the sentinel view's bases — `SECURITY INVOKER` |
| → | `inventory?select=id,ai_recommendation&limit=1000` | `SELECT` on `inventory` |
| ⇒ | via `lib/unit-form.js` — see the direct-write index |

The one base-table column read here, `inventory.ai_recommendation`, is fetched
separately *because the Edit form writes it back* and would blank it otherwise.
That is a write dependency dressed as a read.

## Competitors — `screens/competitors.js`

Reads: `competitors?select=id,competitor,model,price_aed,scraped_at,match_quality`,
`inventory?select=*&limit=1000` (twice), `v_needs_attention?…&screen=eq.competitors`,
`v_workflow_health?select=…&name=eq.<scrape workflow>`, `v_competitor_latest?select=*`
(→ `competitors`). Mounts `lib/unit-form.js`.

## Ask AI — `screens/ask.js`

| | call | depends on |
|---|---|---|
| → | `v_needs_attention?…&screen=eq.ask` | view + bases |
| → | `v_workflow_health?select=<25 cols>&limit=200` | view → `audit_log` |
| → | `audit_log?select=workflow,status,lead_name,lead_email,intent,summary,logged_at` (×2) | `SELECT` on `audit_log` |
| → | `rpc/nexus_workflow_catalogue?select=name,audit_name,audit_aliases` (×2) | `EXECUTE` only — `SECURITY DEFINER` |
| → | `rag_documents?select=id,doc_title,source_file,section,page_number` | `SELECT` on `rag_documents` |
| → | `leads?select=name,email,phone&email=eq.…` | `SELECT` on `leads` |
| ⇒ | n8n `POST /webhook/ask-ai` | workflow JWT check. **The retrieval itself happens in n8n**, not in the browser: nothing in the bundle calls `search_rag_documents` |

## Finance Desk — `screens/finance.js`

Reads: `finance_quotes?select=*`, `leads?select=…`, `audit_log?…&or=(workflow.ilike.*financ*,…)`,
`v_needs_attention?…&screen=eq.finance`, `finance_quotes?select=<EV_COLS>&…` (two
evidence look-ups, one exact on `calculated_at` and one windowed on `created_at`),
`inventory?select=*&order=model`.
Write: n8n `POST /webhook/finance-calc`. Mounts `lib/unit-form.js`.

## Customer 360 — `screens/customers.js`

Reads: `v_customer_directory?select=*`, `v_customer_360?select=*`,
`customer_360_profiles?select=<7 cols>`, `whatsapp_contacts?select=<7 cols>`,
`leads?select=id,name,email,phone,created_at`, `purchase_history?select=*`,
`rpc/nexus_workflow_catalogue?select=…&name=ilike.…`, `v_workflow_health?select=…&name=ilike.…`,
`audit_log?select=…&workflow=ilike.…`; then per customer
`leads?select=*,users(id,name)&email=ilike.…`, `purchase_history?select=*&email=ilike.…`,
and `communication_logs?…` built by `personQuery`.

## Action Center — `screens/actions.js`

| | call | depends on | bundle |
|---|---|---|---|
| → | `v_inventory_action_queue?select=*&order=proposed_at.desc&limit=500` | view + 7 bases | 16× |
| → | `rpc/action_approver_context` | `EXECUTE` only — `SECURITY DEFINER`, `STABLE` | 1× |
| → | `inventory_action_reason_codes?select=*&order=sort.asc` | `SELECT` on the table | 1× |
| → | `rpc/sentinel_inventory_actions` | `EXECUTE` + base reads (`SECURITY INVOKER`) | 6× |
| → | `v_inventory_action_timeline?select=*&action_id=eq.…` | view → `audit_log`, `inventory_action_events`, `tenants`, `users` | 1× |
| ⇒ | `POST rpc/action_decide`, `rpc/action_mark_executed`, `rpc/action_propose`, `rpc/action_cancel` | `EXECUTE` only — all four `SECURITY DEFINER`, owner `postgres`, `VOLATILE` | bare names only |

Built as `` `rpc/${fn}` ``, so the deployed bundle carries `action_decide`,
`action_mark_executed`, `action_propose`, `action_cancel` as bare strings and
**never** the literal `rpc/action_decide`. `verify-bundle.mjs` pins the bare names
for exactly this reason. A refusal comes back as `ok = false` with HTTP 200 —
deliberately, in the database, so the audit row survives — and every caller checks
`ok`.

## Campaigns — `screens/campaigns.js`

Reads: `v_needs_attention`, `v_workflow_health?select=<12 cols>`,
`v_conversations?select=<18 cols>`, `leads?select=*,users(id,name)&limit=1000`,
`communication_logs?select=id,lead_email,direction,message,channel,created_at`,
`audit_log?select=…`, `rpc/nexus_workflow_catalogue?select=name,audit_name,audit_aliases,category,is_active,writes_audit_log`.
Write: n8n `POST /webhook/lead-trigger`.

## Deals — `screens/deals.js`

Reads: `purchase_history?select=*&order=purchase_date.desc` with a fallback to
`purchase_history?select=*` if the ordered form fails, `deals_embeddings?select=id,deal_id,content,created_at`
(deliberately **not** `embedding`), `leads?select=id,name,email,phone,vehicle_interest,budget_aed,status`,
`v_needs_attention?…&screen=eq.deals`, `inventory?select=id,model,vin,status,acquired_at,days_in_stock`,
`finance_quotes?select=id,lead_email,lead_name,created_at,calculated_at,source,quoted_by`
(deliberately no money columns).
Write: n8n `POST /webhook/deals/closed-won` via `lib/deal-form.js`.

## Automation — `screens/automation.js`

Reads: `v_workflow_health?select=*`, `audit_log?select=…`,
`rpc/nexus_workflow_catalogue?select=name,audit_name,audit_aliases`,
`leads?select=name,email,phone`.
Write: `n8n(t.hook, {})` — a test-fire against whichever webhook the row names.
Seven hook names are known to the screen: `ask-ai`, `finance-calc`, `lead-trigger`,
`deals/closed-won`, `audit-kyc`, `erp-sync`, `lead-escalation`, `whatsapp-send`.

## Team — `screens/team.js`

| | call | depends on |
|---|---|---|
| → | `users?select=id,name,email,role,status,slack_user_id,created_at&order=name.asc` | `SELECT` on `users` |
| → | `v_team_performance?select=*` | view → `leads`, `users` |
| → | `leads?select=<12 cols>&order=created_at.desc` | `SELECT` on `leads` |
| → | `v_needs_attention?…&screen=eq.team` | view + bases |
| → | `rpc/nexus_team_roster`, `rpc/nexus_team_pending` | `EXECUTE` only — `SECURITY DEFINER`, `STABLE` |
| ⇒ | `POST rpc/nexus_team_invite`, `rpc/nexus_team_set_role`, `rpc/nexus_team_link_staff`, `rpc/nexus_team_revoke_access`, `rpc/nexus_team_cancel_invite` | `EXECUTE` only — all five `SECURITY DEFINER`, owner `postgres` |

Every one of these five returns a row; the screen refuses to claim anything
happened when an empty array comes back.

## Settings — `screens/settings.js`

Reads: `v_needs_attention?select=…&order=at.desc`, `v_workflow_health?select=<27 cols>`,
`audit_log?select=workflow,status,summary,logged_at&status=in.(FAILED,PARTIAL)`,
`rpc/nexus_workflow_catalogue?select=name,audit_name,audit_aliases`,
`rag_documents?select=*&limit=1` (a probe), then
`rag_documents?select=<columns discovered from the probe row>`.

**The second `rag_documents` read is the only call in the product whose column
list is derived at runtime from the row the database just returned.** It cannot
raise `42703`, by construction. Every other named read can.

## `lib/unit-form.js` — the vehicle form

| | call | depends on |
|---|---|---|
| → | `inventory_profit_settings?select=holding_cost_per_day_aed,holding_cost_basis,holding_cost_source,holding_cost_set_by,holding_cost_verified_at,aging_warn_days,aging_critical_days&limit=2` | `SELECT` on `inventory_profit_settings` |
| ⇒ | **`POST inventory`** — direct table INSERT | column-level `INSERT` on `inventory` |
| ⇒ | **`PATCH inventory?id=eq.<id>`** — direct table UPDATE | column-level `UPDATE` on `inventory` |
| ⇒ | `POST rpc/inventory_delete_unit` | `EXECUTE` only — `SECURITY DEFINER` |

Delete goes through the function rather than `DELETE` on the table specifically so
a refusal raises `NX001` instead of returning 200 with `[]`, which is
indistinguishable from "already gone".

## `lib/lead-drawer.js` — the lead drawer

| | call | depends on |
|---|---|---|
| → | `whatsapp_contacts?select=…&phone=like.*<last 9 digits>` | `SELECT` on `whatsapp_contacts` |
| → | `whatsapp_contacts?select=…&lead_email=eq.…` | same |
| → | `purchase_history?select=*&email=eq.…` | `SELECT` on `purchase_history` |
| → | `leads?select=id,name,email,phone&phone=like.*<suffix>` (collision pool) | `SELECT` on `leads` |
| → | `communication_logs?select=*&…` and `audit_log?select=*&…` (both via `personQuery`) | `SELECT` on both |
| → | `users?select=id,name,status&order=name` | `SELECT` on `users` |
| ⇒ | `POST rpc/nexus_lead_assign_owner` | `EXECUTE` **and column-level `UPDATE` on `leads`** — the function is `SECURITY INVOKER` |

## `lib/manual-lead-form.js` — Add a lead

| | call | depends on |
|---|---|---|
| → | `lead_source_catalogue?select=source_key,display_name,delivery_shape&delivery_shape=eq.MANUAL_ENTRY&order=display_name.asc` | `SELECT` on `lead_source_catalogue` |
| ⇒ | `POST rpc/nexus_lead_record_manual` (9 named args, incl. `p_client_request_id`) | `EXECUTE` only — `SECURITY DEFINER` |

## `lib/integrations.js` and `lib/deal-form.js`

`integrations.js` → `leads?select=id&limit=1` (reachability) and n8n `ask-ai`
(a probe question that spends OpenRouter tokens). `deal-form.js` ⇒ n8n
`deals/closed-won`.

---

# Part 2 — object → screens

**The "what breaks if I change this" lookup.** Counts include `lib/` modules that
issue the call; the screens that mount those modules are named beneath.

## Tables and views

| object | kind | depended on by |
|---|---|---|
| **`leads`** | table | `app.js`, `lib/integrations.js`, `lib/lead-drawer.js`, `lib/identity.js`, `screens/ask.js`, `automation.js`, `campaigns.js`, `compliance.js`, `conversations.js`, `customers.js`, `deals.js`, `finance.js`, `leads.js`, `overview.js`, `team.js` — **15 modules**, plus every `security_invoker` view listed below that joins it |
| **`v_needs_attention`** | view | `lib/badges.js` (polls it for every sidebar badge), `screens/ask.js`, `campaigns.js`, `competitors.js`, `compliance.js`, `conversations.js`, `deals.js`, `finance.js`, `leads.js`, `money-leaks.js`, `overview.js`, `settings.js`, `team.js` — **13** |
| **`v_workflow_health`** | view | `screens/ask.js`, `automation.js`, `campaigns.js`, `competitors.js`, `compliance.js`, `conversations.js`, `customers.js`, `money-leaks.js`, `overview.js`, `settings.js` — **10** |
| **`audit_log`** | table | `lib/lead-drawer.js`, `screens/ask.js`, `automation.js`, `campaigns.js`, `compliance.js`, `customers.js`, `finance.js`, `leads.js`, `settings.js` — **9**; also the sole base of `v_workflow_health` and a base of `v_needs_attention`, `v_action_center_health`, `v_inventory_action_timeline`, `v_lead_recovery`, `v_lead_recovery_health` |
| **`communication_logs`** | table | `lib/lead-drawer.js`, `screens/campaigns.js`, `compliance.js`, `customers.js`, `leads.js`, `overview.js` — **6**; base of `v_conversations`, `v_customer_360`, `v_communication_log_evidence`, `v_lead_recovery_coverage`, `v_inventory_profit_sentinel`, all four attribution chains |
| **`whatsapp_contacts`** | table | `lib/identity.js`, `lib/lead-drawer.js`, `screens/compliance.js`, `customers.js`, `leads.js`, `overview.js` — **6**; base of `v_conversations`, `v_customer_360` |
| `inventory` | table | `lib/unit-form.js` (**writes**), `screens/competitors.js`, `deals.js`, `finance.js`, `inventory.js` — 5; base of `v_needs_attention`, `v_inventory_action_queue`, `v_inventory_profit_sentinel`, three attribution chains |
| `users` | table | `app.js`, `lib/lead-drawer.js`, `screens/compliance.js`, `team.js` — 4; base of `v_team_performance`, `v_inventory_action_queue`, `v_inventory_action_timeline`, `v_lead_recovery`, `v_lead_recovery_queue`; target of the `leads → users` embed |
| `purchase_history` | table | `lib/lead-drawer.js`, `screens/customers.js`, `deals.js`, `leads.js` — 4; base of 9 views |
| `v_inventory_action_queue` | view | `screens/actions.js`, `money-leaks.js`, `overview.js`, `revenue.js` — 4 |
| `v_lead_recovery_coverage` | view | `screens/lead-recovery.js`, `money-leaks.js`, `overview.js`, `revenue.js` — 4 |
| `v_conversations` | view | `lib/identity.js`, `screens/campaigns.js`, `conversations.js`, `overview.js` — 4; base of `v_needs_attention` |
| `v_lead_recovery` | view | `screens/lead-recovery.js`, `money-leaks.js`, `revenue.js` — 3; base of `v_deal_rescue`, `v_deal_rescue_readiness`, `v_lead_recovery_coverage`, `v_lead_recovery_queue`, `v_lead_recovery_state_model` |
| `v_deal_rescue` | view | `screens/deal-rescue.js`, `overview.js`, `revenue.js` — 3 |
| `v_deal_rescue_readiness` | view | `screens/deal-rescue.js`, `money-leaks.js`, `revenue.js` — 3 |
| `competitors` | table | `screens/competitors.js`, `overview.js` — 2; base of `v_competitor_latest`, `v_needs_attention`, `v_inventory_profit_sentinel` |
| `finance_quotes` | table | `screens/deals.js`, `finance.js` — 2; base of 6 views |
| `kyc_documents` | table | `screens/compliance.js`, `overview.js` — 2; base of `v_needs_attention`, `v_deal_rescue_candidates` |
| `rag_documents` | table | `screens/ask.js`, `settings.js` — 2 |
| `v_action_center_health` | view | `screens/money-leaks.js`, `revenue.js` — 2 |
| `v_attribution_sale_chain` | view | `screens/attribution.js`, `revenue.js` — 2 |
| `v_deal_rescue_candidates` | view | `screens/deal-rescue.js`, `revenue.js` — 2 |
| `v_policy_rule` | view | `screens/policy.js`, `revenue.js` — 2; base of `v_policy_authoritative`, `v_policy_unmigrated_constant` |
| `v_policy_unmigrated_constant` | view | `screens/policy.js`, `revenue.js` — 2 |
| `tenant_members` | table | `app.js`, `lib/tenant.js` — 2 |
| `tenants` | table | `lib/tenant.js` — 1 directly, **but a base of 20 of the views above**; revoking it dark-empties most of the product |
| `attribution_link_basis` | table | `screens/attribution.js` |
| `customer_360_profiles` | table | `screens/customers.js`; base of `v_customer_360` |
| `daily_metrics` | table | `screens/overview.js` |
| `deals_embeddings` | table | `screens/deals.js`; base of `v_attribution_edges`, `v_attribution_sale_chain` |
| `inventory_action_reason_codes` | table | `screens/actions.js`; base of `v_inventory_action_queue` |
| `inventory_profit_settings` | table | `lib/unit-form.js`; base of `v_needs_attention`, `v_inventory_profit_sentinel`, three attribution chains |
| `lead_source_catalogue` | table | `lib/manual-lead-form.js`; base of `v_lead_origin` |
| **`lead_event`** | table | no screen reads it directly — **but `v_lead_origin` is `security_invoker` over it**, so `screens/lead-sources.js` depends on its column grants |
| `v_attribution_edges` / `_events` / `_lead_chain` / `_link_map` | views | `screens/attribution.js` |
| `v_communication_log_evidence` | view | `screens/conversations.js` |
| `v_competitor_latest` | view | `screens/competitors.js` |
| `v_customer_360` / `v_customer_directory` | views | `screens/customers.js`; `v_customer_directory` also `lib/identity.js` |
| `v_deal_rescue_state_model` | view | `screens/deal-rescue.js` |
| `v_inventory_action_timeline` | view | `screens/actions.js` |
| `v_inventory_profit_sentinel` | view | `screens/revenue.js` directly; **and every caller of `sentinel_inventory_actions()`**, which returns `SETOF` it — `screens/inventory.js`, `actions.js`, `money-leaks.js`, `overview.js` |
| `v_lead_origin` | view | `screens/lead-sources.js` |
| `v_lead_recovery_health` / `_queue` / `_state_model` | views | `screens/lead-recovery.js` |
| `v_lead_messages` | view | no screen reads it; base of 6 views the screens do read |
| `v_policy_authoritative` | view | `screens/policy.js`; base of `v_policy_unmigrated_constant` |
| `v_team_performance` | view | `screens/team.js` |
| **storage `kyc-documents` bucket** | bucket | `screens/compliance.js` only |

## Functions

| function | security | who calls it |
|---|---|---|
| `nexus_workflow_catalogue()` | DEFINER | `screens/ask.js`, `automation.js`, `campaigns.js`, `customers.js`, `settings.js` — 5 |
| `sentinel_inventory_actions(text, int)` | **INVOKER** | `screens/actions.js`, `inventory.js`, `money-leaks.js`, `overview.js` — 4 |
| `action_approver_context()` | DEFINER | `screens/actions.js` |
| `action_decide` / `action_mark_executed` / `action_propose` / `action_cancel` | DEFINER | `screens/actions.js` (writes) |
| `nexus_team_roster()` / `nexus_team_pending()` | DEFINER | `screens/team.js` |
| `nexus_team_invite` / `_set_role` / `_link_staff` / `_revoke_access` / `_cancel_invite` | DEFINER | `screens/team.js` (writes) |
| `nexus_lead_record_manual(9 args)` | DEFINER | `lib/manual-lead-form.js` (write) |
| **`nexus_lead_assign_owner(int, uuid, text)`** | **INVOKER** | `lib/lead-drawer.js` (write) |
| `inventory_delete_unit(text)` | DEFINER | `lib/unit-form.js` (write) |
| `nexus_lead_attribution(timestamptz)` | DEFINER | `screens/leads.js`; also called inside `nexus_lead_attribution_summary` |
| `nexus_lead_attribution_summary(timestamptz)` | INVOKER (over a DEFINER) | `screens/attribution.js` |
| `nexus_lead_source_readiness()` | DEFINER | `screens/lead-sources.js` |
| `nexus_whatsapp_consent_events(int)` / `_current()` | DEFINER | `screens/compliance.js` |

Every one of the above is owned by `postgres`, holds
`authenticated=X/postgres`, and **does not** hold a grant to `anon` —
`has_function_privilege('anon', …, 'EXECUTE')` is false for all of them.
`search_rag_documents` exists in two overloads and is executable by
`authenticated`, but **the dashboard never calls it** — retrieval happens inside
the n8n `ask-ai` workflow. It appears in no screen and zero times in the bundle.

## n8n webhooks (no database grant involved)

| hook | caller |
|---|---|
| `ask-ai` | `screens/ask.js`, `lib/integrations.js` |
| `finance-calc` | `screens/finance.js` |
| `lead-trigger` | `screens/campaigns.js`, `screens/leads.js` |
| `deals/closed-won` | `lib/deal-form.js` (Deals) |
| `lead-escalation` | `screens/leads.js` |
| `whatsapp-send` | `screens/conversations.js` |
| `audit-kyc`, `erp-sync` | named by `screens/automation.js` for test-fires only |

Base URL in the deployed bundle: `https://35.224.126.225.nip.io`. Each workflow
verifies the caller's Supabase JWT itself; `lib/data.js` `n8n()` attaches the
session token and nothing else. A shared secret compiled into a public bundle
would prove nothing.

---

# Part 3 — direct table writes → column grants

**This is the complete list. There are two, and they are both `inventory`.**

Established by `grep -rn "dbWrite" apps/executive-dashboard/lib apps/executive-dashboard/screens`
(7 write call sites), then confirmed in the deployed bundle
(`inventory?id=eq.` → 1 occurrence; `leads?id=eq` → **0**).

| # | write | site | grant it needs |
|---|---|---|---|
| 1 | `POST /rest/v1/inventory` | `lib/unit-form.js:662` | column-level **`INSERT`** on `inventory` |
| 2 | `PATCH /rest/v1/inventory?id=eq.<id>` | `lib/unit-form.js:663` | column-level **`UPDATE`** on `inventory` |

Everything else routes through `rpc/*`. Five of those functions write, and all
five are `SECURITY DEFINER` owned by `postgres`, so they touch their tables as
`postgres` and are unaffected by the caller's table grants:
`action_decide`, `action_mark_executed`, `action_propose`, `action_cancel`,
`nexus_team_*` (five), `nexus_lead_record_manual`, `inventory_delete_unit`.

**And one that is not.** `nexus_lead_assign_owner` is `SECURITY INVOKER`
(`prosecdef = false`, measured), so its `UPDATE` on `public.leads` runs as the
caller and needs the caller's grant. It is a write that *looks* like an RPC and
*behaves*, for grant purposes, like a direct table write. It belongs in this
section and is listed separately only because nobody grepping for `dbWrite` on a
table name would find it.

## The exact column grants these depend on, live today

`inventory` — table-level `authenticated=rd/postgres` (SELECT, DELETE only). The
write privileges are **column-level**:

| privilege | columns granted to `authenticated` |
|---|---|
| `INSERT` | `id`, `model`, `vin`, `status`, `price_aed`, `cost_aed`, `ai_recommendation`, `acquired_at`, `tenant_id` — 9 |
| `UPDATE` | `id`, `model`, `vin`, `status`, `price_aed`, `cost_aed`, `ai_recommendation`, `acquired_at` — 8 (**no `tenant_id`**) |
| `SELECT` | the same 9 as INSERT, redundant with the table-level grant |

`unitRow()` emits exactly `id, model, vin, status, acquired_at, price_aed,
ai_recommendation` and, when the caller may set cost, `cost_aed`. **Every column
it writes is granted, and no granted column is unused except `tenant_id` on
INSERT** — which the form does not send, so a default or trigger supplies it.
The fit is exact, which means any narrowing has no slack in it.

`leads` — table-level `authenticated=r/postgres` (SELECT only). Column-level:

| privilege | columns granted to `authenticated` |
|---|---|
| `UPDATE` | `name`, `email`, `phone`, `vehicle_interest`, `budget_aed`, `status`, `assigned_to`, `assigned_to_id` — **8** |
| `SELECT` | the same 8, redundant with the table-level grant |

Those eight UPDATE grants existed for `lib/lead-drawer.js`'s direct PATCH. **That
PATCH is gone from the deployed bundle** — `leads?id=eq` occurs 0 times. They are
still load-bearing, because `nexus_lead_assign_owner` is `SECURITY INVOKER` and
needs `UPDATE (assigned_to, assigned_to_id)` to do its work.
`ops/migrations-held/20260908090000_the_grant_that_no_longer_has_a_screen_behind_it.sql`
is written, unapplied, and refuses its own preflight for precisely this reason.

## A third column-grant dependency that is a read, not a write

`lead_event` — no table-level SELECT for `authenticated`; column-level `SELECT` on
15 of 19 columns, withholding `endpoint_id`, `payload_raw`, `hydrated_payload`,
`normalized`. `v_lead_origin` is `security_invoker` over it and reads only granted
columns. **Screens/lead-sources.js depends on a column grant it never names.**
It belongs in this index because the guard below strips read grants the same way
it strips write grants.

## The guard's blast radius

`nexus_guard_born_open_grants()` runs on `ddl_command_end` with `evttags = null`,
so it fires on every DDL statement, and acts on rows whose `object_type` is
`table`, `view`, `materialized view`, `foreign table`, `sequence`, `function`,
`procedure` or `aggregate`. For a table in `public` it executes, verbatim:

```
revoke all on <obj> from anon;
revoke insert, update, delete, truncate on <obj> from authenticated;
```

**A table-level `REVOKE` also removes the column-level grants.** That is the
documented PostgreSQL behaviour and it was not taken on trust: reproduced on a
throwaway PostgreSQL 17.11 cluster (production is 17.6) with the guard's exact
statement —

| phase | column INSERT+UPDATE grants for `authenticated` | `has_column_privilege(… ,'cost_aed','UPDATE')` |
|---|---|---|
| after `grant insert (id, model, cost_aed), update (id, model, cost_aed)` | **6** | true |
| after `revoke insert, update, delete, truncate on … from authenticated` | **0** | **false** |

So:

| DDL | what it takes down |
|---|---|
| any `ALTER TABLE public.inventory` | the Add-vehicle and Save-changes paths of `lib/unit-form.js` — Inventory, Competitors, Finance Desk and Team all mount that form. `rpc/inventory_delete_unit` survives (DEFINER) |
| any `ALTER TABLE public.leads` | `nexus_lead_assign_owner`, and with it owner assignment everywhere `lib/lead-drawer.js` is mounted — Overview, Conversations, Campaigns, Leads, Team, Customer 360 |
| any `ALTER TABLE public.lead_event` | `v_lead_origin`, and with it the whole Lead Sources arrivals table |

`CREATE TRIGGER` on those tables does **not** fire it — `pg_event_trigger_ddl_commands()`
reports `object_type = 'trigger'`, which the guard ignores. That was measured on
staging in a rolled-back transaction and is recorded in `CLAUDE.md`: 8 column
grants before and after, `relacl` byte-identical. It is why several owed fixes in
this repository were built as triggers rather than as the tidier constraint.

---

# Part 4 — verification against the live catalogue

Every object named by every call above was checked for existence and for the
privilege the call actually needs.

| check | result |
|---|---|
| tables and views called by a screen | **50 named, 50 exist.** None missing, none renamed |
| `SELECT` for `authenticated` on each | held on all 50, table-level, except `lead_event` (column-level, deliberate) and `v_lead_origin` which depends on it |
| explicit `SELECT` policy for `authenticated` on every base table read | present on all 20 base tables checked; every one also carries an explicit `*_deny_anon` policy |
| functions called by a screen | **22 named, 22 exist**, all owned by `postgres`, all with `authenticated=X` and no `anon` grant |
| RPCs called over `GET` are `STABLE` or `IMMUTABLE` | true for all 10 read RPCs — PostgREST refuses a `VOLATILE` function over GET. The other 12 are writes and are correctly `POST`ed |
| RPC arguments and defaults | every no-argument call lands on a function that takes none or defaults them (`nexus_lead_attribution(p_since default null)`, `sentinel_inventory_actions(null, null)`, `nexus_whatsapp_consent_events(p_limit default 200)`) |
| **every named `select=` column exists** | 594 (object, column) pairs extracted from source and checked against `information_schema.columns`. **One did not resolve: `leads.users`** — which is the PostgREST *embed* `users(id,name)`, not a column. `leads_assigned_to_id_fkey` exists, so the embed resolves. **Zero real misses** |
| deployed bundle carries every object the source calls | 72 objects, **72 found**. Five are present as bare names because they are built at runtime (`action_decide`, `action_mark_executed`, `action_propose`, `action_cancel`, `v_communication_log_evidence`) |

## Calls that would fail today

**None.** Every read and every write in the product resolves to an object that
exists, on which `authenticated` holds the privilege the call needs.

That is not the answer this pass expected, and the gap is worth recording. The
brief anticipated finding screens still reading objects revoked on 6 September —
`workflow_registry` named specifically. Measured:

- `workflow_registry` exists, `relacl` is `{postgres=arwdDxtm/postgres,
  service_role=arwdDxtm/postgres}`. **`authenticated` holds nothing on it**, and
  a browser read of it would fail `42501`.
- **No screen reads it.** Zero `db()` call sites name it. In the deployed bundle
  the string occurs twice, both times as UI prose: once in the plain-English
  vocabulary map (`workflow_registry: "the automation register"`) and once inside
  a sentence that names it as the source of a claim when `v_workflow_health`
  returned nothing.
- The replacement is `rpc/nexus_workflow_catalogue()`, `SECURITY DEFINER` owned by
  `postgres`, called from five screens, 6 occurrences in the bundle.
- `v_workflow_health` no longer depends on the table either: its only relation
  dependency is `audit_log`, and it obtains the register through the definer
  function, which a `pg_depend` walk cannot see.

So the migration off the dealer plane was completed on both sides. `verify-bundle.mjs`
pins `workflow_registry?` — with the `?` that makes it a PostgREST path rather
than the bare word — as a MUST-NOT, so a regression is caught rather than
re-argued.

## The near-misses worth naming

These are not failures. They are the four places where one more grant change
would produce one.

1. **`nexus_lead_assign_owner` is `SECURITY INVOKER`.** Revoking the `leads`
   column grants breaks the RPC exactly as it would have broken the PATCH. The
   held migration's own header calls this "the trap in this migration".
2. **`sentinel_inventory_actions` is `SECURITY INVOKER`.** It reaches
   `communication_logs`, `competitors`, `inventory`, `inventory_profit_settings`,
   `leads` and `tenants` as the caller, on four screens.
3. **`lead_event`'s column grants are the whole of Lead Sources.**
4. **`tenants` is a base of 20 views.** It is read directly by one module and is
   in the critical path of most of the product.

---

# Unknowns

- **`screens/held-enquiries.js` and `screens/system-truth.js` are not mapped, and
  they moved while this pass ran.** At the start of it `screens/` held 22 files;
  `held-enquiries.js` appeared during it and `system-truth.js` appeared before it
  ended — 1,362 and 1,998 lines, five `db()` call sites between them, both
  untracked. They are being written by other agents in parallel, so anything
  measured about them would be stale before it was written down, and this pass
  deliberately did not read them. Neither appears in `lib/nav.js`, and neither is
  in the deployed bundle — probed for `held-enquiries`, `held_enquiries`,
  `heldenquiries`, `system-truth` and `systemtruth`, **0 occurrences each**.
  **When they settle, their five reads and any writes must be added here, their
  objects checked against the live catalogue, and any direct table write added to
  Part 3.** Until then, Part 2's counts are counts over 22 screens, not 24.
- **`main` is not the product.** Every source claim here is against the working
  tree at `/home/claude/repo`. The deployed bundle is built from a wip branch;
  `main` is a strictly older codebase. Where source and bundle disagree, the
  bundle is the operational answer and the source is the reproducible one — but
  this file does not establish *which commit* built `main-BFmkO_-a.js`.
- **RLS row visibility is not measured.** Every claim here is about privileges —
  whether a call is refused. Whether a call returns rows is a policy question
  answered per signed-in user per tenant, and it was not exercised, because doing
  so needs a real session rather than a catalogue read.
- **No call was issued as `authenticated` against production.** The privilege
  claims come from `has_table_privilege`, `has_column_privilege`,
  `has_function_privilege` and the ACLs, not from a live 200. Those functions
  answer the same question the executor asks, but a PostgREST-level failure with
  a different cause — a stale schema cache, an exposed-schema setting, a
  malformed `or=()` filter — would not appear in any of them.
- **`select=*` reads are not column-checked.** **27 static call sites use `*`**,
  across 17 distinct objects — `inventory` (3), `purchase_history` (4),
  `v_lead_recovery_coverage` (3), `v_inventory_action_queue` (2),
  `users`, `audit_log`, `kyc_documents`, `finance_quotes`, `daily_metrics`,
  `rag_documents`, `inventory_action_reason_codes`, `v_customer_360`,
  `v_customer_directory`, `v_competitor_latest`, `v_workflow_health`,
  `v_action_center_health`, `v_team_performance`, `v_inventory_action_timeline` —
  plus the two `personQuery` reads in `lib/lead-drawer.js`, which pass
  `select: '*'` to `communication_logs` and `audit_log`. A `*` cannot raise
  `42703`, but it also means a dropped column shows up as `undefined` in the UI
  rather than as an error at the gate. That is a real fragility this map cannot
  quantify.
- **Two column-list constants were resolved by hand**, not by evaluating the
  module: `screens/overview.js:310` `QUEUE_COLS` (an array joined at use) and
  `screens/finance.js:2700` `EV_COLS`. Both were read from source and checked
  column-by-column, but a future edit to either will not be caught by re-running
  the extractor unless the hand-resolved copy in the tooling is updated too.
- **`verify-bundle.mjs` cannot see privileges**, by design, and this file cannot
  see the future contents of the bundle. They are two instruments, and neither
  substitutes for the other. The map is a measurement of 8 September 2026; the
  script is the part of it that stays true on its own.
