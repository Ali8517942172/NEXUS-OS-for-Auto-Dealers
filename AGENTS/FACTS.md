# FACTS — proven, do not re-derive

Every line here was measured. An agent that spends tool calls rediscovering
one of these has wasted them. Cite the FACT id instead.

Format: `FACT-nnn` | claim | how it was proven | date.

## Identity and addresses

- **FACT-001** Production Supabase project `dsvuoovivysszdoiorch`. Staging `wwspuxrbiyagnrnzgate`. — 2026-09-13
- **FACT-002** ALBA tenant `fff6a2b5-cfd5-4460-8383-875bc5826de0`. Quarantine tenant `02c86264-6653-4522-b055-1c3f359a82fe`. Demo tenant `dddddddd-dddd-4ddd-8ddd-dddddddddddd` exists on staging, NOT on production. — 2026-09-13
- **FACT-003** Meta app `1406045581736122`, WABA `1098665496068509` (owner `bharmalmarketing`), test number `+1 (555) 672-4466`, `phone_number_id 1306545252542419`. — 2026-09-13
- **FACT-004** Vercel account holds exactly two projects. Dashboard production domain is `nexus-os-dashboard-six.vercel.app`; `nexus-os-dashboard.vercel.app` is **not in this account** and serves a stranger's app. Marketing site is `nexus-for-autodealers.vercel.app`. — 2026-09-13
- **FACT-005** n8n box `https://35.224.126.225.nip.io`, queue mode. The **worker** reads `$env`, so both `n8n` and `n8n-worker` must be recreated for any env change. Compose at `/opt/nexus/docker-compose.yml`. — earlier
- **FACT-006** Repo on Ali's machine: `$HOME/mnt/MY RESUMES/nexus-os`. `git fetch` fails there (no credentials in the sandboxed shell) — local `main` reads stale. Not repo drift. Use `timeout 60 git grep`; a bare recursive `grep -rn` times out. — 2026-09-13

## Meta / WhatsApp Cloud

- **FACT-010** App is **Published** (App Review). Privacy policy, Terms and data-deletion URLs set to the real pages; this was the sole publish blocker. — 2026-09-13
- **FACT-011** Webhook callback URL at Meta = `https://35.224.126.225.nip.io/webhook/whatsapp-cloud-inbound`, read out of the input field. Correct. — 2026-09-13
- **FACT-012** Webhook field `messages` is **Subscribed** at v26.0 — the only subscribed field of 33. — 2026-09-13
- **FACT-013** A **real inbound message** reached Meta 13 Sep 17:21:54 (UTC+4): `from 918517942172`, `profile.name "Ali"`, `country_code IN`, correct `phone_number_id`. **Recipient eligibility is PROVEN; the allowlist is NOT the blocker.** — 2026-09-13
- **FACT-014** *(superseded by FACT-021)* On 13 Sep n8n produced zero executions for that event. Cause: the WABA was not subscribed to this app.
- **FACT-015** Receiver refuses correctly on the wire: GET with wrong verify token → `403 HUB_VERIFY_TOKEN_MISMATCH`; POST without signature → `401 SIGNATURE_HEADER_MISSING`. Neither wrote any row. — 2026-09-13
- **FACT-016** Both `META_WEBHOOK_VERIFY_TOKEN` and `META_APP_SECRET` ARE set and DO reach the worker — the probes returned branches *past* the not-configured guards (`receiver.sdk.js:62-66`, `:81-87`). Closes the open question in `ops/v1-certification/META-CLOUD-COMPLETION.md §3`. — 2026-09-13
- **FACT-017** Execution 12968 was Meta's own **Test button**, carrying the dummy `phone_number_id 123456123`. It passed HMAC verification and tenant resolution, then correctly failed closed at `Raise Unregistered Channel`. So the deployed app secret is the right one. — 2026-09-13
- **FACT-018** `channel_registry` holds an **active** row for `whatsapp_cloud_phone_number_id` = `1306545252542419`, tenant ALBA. Also an active `whatsapp_waha_session` row. — 2026-09-13
- **FACT-019** "Number claimed but not `/register`-ed" is **REFUTED** as the cause: an unregistered number never produces a `messages` object with resolved `metadata`, `profile.name` and `country_code`. All five were present. — 2026-09-13
- **FACT-020** Business Verification on the WABA is **Unverified**. It gates messaging tier and volume, **not** webhook delivery on a test number. — 2026-09-13
- **FACT-021** **The blocker was the WABA-level app subscription, and it is fixed.** `GET /1098665496068509/subscribed_apps` returned only `WA DevX Webhook Events 1P App` (2202427980234937) — Meta's own first-party test-webhook app. Our app was absent, which is exactly why the message appeared in Meta's "Check test webhooks" panel and never reached our endpoint. `POST` returned `{"success": true}`; the re-read now lists `NEXUS for AutoDealers` (1406045581736122). App-level field subscription and WABA-level app subscription are separate mechanisms. — 2026-09-14
- **FACT-022** The app is in **live mode** (Alert Inbox: "NEXUS for AutoDealers was switched to live mode on 13 Sep, 2026"). App Review "Published" and the Development/Live state are distinct; both are now correct.

## The `'+'` defect — repo and box DISAGREE

- **FACT-030** The live n8n box was patched on 13 Sep: node `Record Channel Event` in `J8MXprxVw1yhjBpp` now sends `(String(...||'').replace(/[^0-9]/g,'') || null)`. Published as version "customer_phone is digits, not +digits". **PROVEN against real traffic on 14 Sep — see FACT-110.**
- **FACT-031** *(closed 14 Sep)* The repo carried the defect at `ops/n8n-whatsapp-cloud/receiver.sdk.js:265` while the box was patched. Repo and box now agree.
- **FACT-032** `ops/whatsapp-cloud-send/SEND-DESIGN.md §6` instructs applying `ops/whatsapp-cloud-send/phase-plus-defect.patch`. **That file does not exist.** The repo documents a remediation it cannot perform.
- **FACT-033** DB constraint `channel_message_events_customer_phone_is_digits_or_null` = `customer_phone IS NULL OR customer_phone ~ '^[0-9]{6,20}$'`. `'+9185...'` raises 23514.

## Data loss — the P0

- **FACT-040** `leads`: `n_tup_ins = 123`, `leads_id_seq.last_value = 127`, 7 rows live. **~116 rows were committed and then removed.** Sequence burn accounts for at most ~4. — 2026-09-13
- **FACT-041** The application cannot delete leads: `authenticated` holds no DELETE/TRUNCATE grant (`supabase/migrations/20260905201532_rbac_04_leads_writes_by_role.sql:62`). Only `service_role` and `postgres` hold it.
- **FACT-042** `pg_stat_statements` holds hand-written deletes not wrapped by any PostgREST CTE, one carrying the literal comment `-- clean slate for a genuine end-to-end run`. **The mechanism is an operator/agent test-reset ritual run against PRODUCTION**, via SQL editor or service_role.
- **FACT-043** **Real customer data was destroyed.** `audit_log` retains 26 orphan rows for `shabbir53ujjainwala@gmail.com` (a live Gmail address) scored **HOT 88 and 92** by the Master Router, 16–29 Aug. Its `leads` row is gone.
- **FACT-044** `communication_logs` holds **23 orphan conversation threads** with no lead row — real WhatsApp LIDs and one real phone `+918517942172`, spanning 25 Aug → 13 Sep.
- **FACT-045** The schema is **anti-forensic**: `lead_owner_events` is `ON DELETE CASCADE` and `lead_event.lead_id` is `ON DELETE SET NULL`, so deleting a lead destroys the two records that would prove it existed. No `*_history`, `*_archive`, `*_deleted` or tombstone table exists anywhere in `public`.
- **FACT-046** `audit_log` has itself been purged by hand: `n_tup_del = 1443` against 1052 live rows.
- **FACT-047** Positively EXCLUDED as causes: RLS DELETE policy; triggers on `leads` (only two, both non-deleting); cascade from a parent; SECURITY DEFINER functions; `pg_cron` (one job, `nexus-daily-metrics`); Supabase edge functions (zero exist); `ops/demo/teardown_demo_tenant.sql` (NX999-guarded, cannot have run).
- **FACT-048** **Supabase PITR / WAL retention was NOT checked.** It is the only path to real row recovery and the window is closing. NOT RUN ≠ unavailable.

## Security — measured clean

- **FACT-050** 67/67 tables in `public` have `relrowsecurity = true`, each with ≥2 policies. Zero tables with RLS off. Zero silent-deny tables.
- **FACT-051** 42/42 views carry `security_invoker`. **Zero definer views.**
- **FACT-052** `anon` has **no schema USAGE on `public`** and zero table grants. The Sept 2 "anon key was reading every customer" hole is closed redundantly.
- **FACT-053** 87 SECURITY DEFINER functions, none with PUBLIC EXECUTE. **No definer function that takes a `tenant_id` argument is reachable by `authenticated`.** No escalation path found.
- **FACT-054** Provenance-rank forgery is structurally refused: `nexus_record_lead_event` raises `PROVENANCE_WEAKER_THAN_DECLARED` on `<>` (not `<`) against the endpoint's registration.
- **FACT-055** 11 Supabase **anon** JWTs are committed in `n8n-workflows/*.json` and `ops/DEMO.md`. **Zero `service_role` keys, zero cloud-provider keys, zero DB passwords.** CI (`ops/ci/secret-scan.mjs`) decodes the role claim and fails on `service_role`. Acceptable, LOW.
- **FACT-056** `nexus_current_tenant_ids()` returns **every** active membership, and `leads_authenticated_all` is `cmd=ALL` over it. Harmless today (1 member, 0 multi-tenant users); becomes a cross-dealership read+write path the moment one human belongs to two tenants.
- **FACT-057** `nexus_scoped_tenant_id()` returns NULL the instant a second active non-quarantine tenant exists — deliberate fail-silent. Every batch caller will quietly stop working at tenant #2.

## Dashboard truth — the scare was false

- **FACT-060** All 179 metric tiles across 22 screens are **BACKED** by a view or RPC read. **Zero hardcoded figures in tracked source.** The `87 leads / AED 237.5K / AED 20.5K / Events Today 47` literals exist only in the untracked local `dist/`, which is `.gitignore`d and which Vercel rebuilds from source on every deploy. They cannot reach a dealership.
- **FACT-061** All 33 referenced `v_*` views and 24 `nexus_*` functions exist on production. **Zero BROKEN reads.**
- **FACT-062** The only provenance mechanism in the database (`lead_event.provenance_counts_as_real`) is **set wrong**: the sole row is the preflight fixture (lead 121) filed as `environment='production'`, `provenance_counts_as_real=TRUE`, `phase='PROMOTED'`. It certifies a fixture as real.
- **FACT-063** Lead 121 (`Preflight Walk-In`) reaches five production views as a **count** — `v_lead_recovery`, `v_deal_rescue_candidates`, `v_customer_360`, `v_customer_directory`, `v_attribution_lead_chain`. It reaches **no money figure**: every monetary column is NULL with an explicit refusal state.
- **FACT-064** The AED 585,000 confirmed-revenue figure (`v_attribution_sale_chain`) is **uncontaminated**. The recovered-revenue headline honestly reads AED 0.
- **FACT-065** `apps/executive-dashboard/lib/unit-form.js:407,410` writes `0` into `inventory.price_aed` / `cost_aed` when unknown. **The one code path that manufactures data rather than merely displaying it badly.**
- **FACT-066** Leads 34 and 35 are **real humans**, not fixtures — misrouted by a `"document"` keyword trip. Correctly DISQUALIFIED.

## Workflow health / observability

- **FACT-070** `v_workflow_health` has **no staleness dimension** — no branch compares `last_success` to `now()`. "Ran fine, then stopped" is unrepresentable.
- **FACT-071** `nexus_error_handler.json:30` hardcodes `status: "FAILED"` as a string literal — no branch, no inspection. Every deliberate fail-closed rejection is recorded as a production failure. That is why every workflow reads DEGRADED and the badge means nothing. `Ask-AI — RAG Query Agent` is the one workflow that gets it right (it uses `Respond 401` + its own audit row instead of throwing).
- **FACT-072** The same Error Handler emits the **n8n workflow name**, not `workflow_registry.audit_name` — which is why `audit_aliases` exists as a hand-maintained patch, and why any rename silently deletes a workflow from monitoring.
- **FACT-073** The CI gate `select ... audit_log rows not resolving to a catalogue row` returns **3 today**: `Inventory Action Center` (8), `WhatsApp Cloud - Inbound Receiver (Meta)` (1, FAILED 13 Sep 07:36), `Example Workflow` (1). A production failure today that appears on no dashboard.
- **FACT-074** `scripts/export_workflows.py:58` computes `published := versionId == activeVersionId`. When both are absent/None this is **True**. The one check meant to catch never-published workflows reports them as published. `_index.json` says `"published": true` for `57QpbNQGwlFKb0q3`, which has `activeVersionId: null`.
- **FACT-075** `NEXUS Retention Purge` (`aIYwwoYStDAi9kHy`) is registered `is_active = true` on a nightly 03:00 cron and has **never written an audit row in all of recorded history**. A compliance purge that may never have run.
- **FACT-076** Three workflows (`NEXUS Public — Home / Privacy / Terms`) exist in the export and on the box but have **no `workflow_registry` row**, so they have no health row and can never be red.
- **FACT-077** No table anywhere carries an n8n **execution id**. It exists only as free text inside `audit_log.summary`, written by the Error Handler — i.e. **only for failed executions**. `audit_log` has no `lead_id`; it joins to a customer by `lead_email` string only.

## Outbound send — why it would refuse today

- **FACT-080** `public.channel_send_endpoint` **does not exist** (`to_regclass` = null) — the held migration is unapplied.
- **FACT-081** `public.whatsapp_templates` = **0 rows**. `whatsapp_conversation_state` = **0 rows**.
- **FACT-082** `policy_rule` holds `WA_CUSTOMER_SERVICE_WINDOW_HOURS = 24` with status **NOT_VERIFIED** (13 rules, 0 VERIFIED). The policy engine is **FAIL_CLOSED** by explicit design — with no verified rule, every conversation answers `TEMPLATE_REQUIRED`, and with 0 templates that becomes `DO_NOT_SEND`. Only a named human calling `policy_platform_verify_rule()` clears it.
- **FACT-083** `channel_registry.credential_ref` for the Cloud row reads `env:META_APP_SECRET+META_WA_TOKEN` — wrong for sending. `META_APP_SECRET` is the receiver's HMAC secret; `META_WA_TOKEN` names no env var this repo sets. The sender workflow reads `META_WA_SYSTEM_USER_TOKEN`, which does not exist as a Meta object yet.
- **FACT-084** `META_PAGE_ACCESS_TOKEN` (Lead Ads, scope `leads_retrieval`) must never be used for Cloud messaging — it returns 190/200. The repo keeps the names distinct deliberately.

## AI scoring

- **FACT-090** The 13 Sep `ai_score = 0` was **not a model verdict**. The model collapsed into repetition; the fallback regex `\b(\d{1,3})\b` matched `000` inside the babble and `parseInt("000") = 0`. No intent word was present, so it defaulted WARM.
- **FACT-091** The router **has** produced HOT verdicts — 88, 92, 95 — on four historical runs. "The scorer never produces HOT" is **false**. Those leads are missing because their rows were deleted (FACT-043).
- **FACT-092** Fallback fired on 2 of 13 Master Router runs (15%), first on 16 Aug, again 13 Sep.
- **FACT-093** `parse_failed` is computed but **never persisted** — `Persist Lead (deterministic)` does not send it. A fallback score and a real score are indistinguishable in the database.
- **FACT-094** A parse failure does **not** degrade the run's recorded status: `delivery.status` overrides it, so the 13 Sep run is filed `SUCCESS`.
- **FACT-095** `{}` parses successfully → `intent` defaults WARM, `score` defaults 50, `parse_failed: false`. **An empty model response is indistinguishable from a genuine WARM/50 verdict.** A separate and more dangerous path than the prose failure.
- **FACT-096** Model ladder is entirely free-tier: `nvidia/nemotron-3.5-lightning:free`, `nvidia/nemotron-3-super-120b-a12b:free`, `minimax/minimax-m2.7:free`, with `openai/gpt-oss-120b` on Groq. The agent node has **no structured-output / response-format / output-parser configured** — JSON is requested in prose only.
- **FACT-097** A second, independent score writer exists: `apps/ai-crm/backend/server.js:129` hardcodes `status:'HOT', ai_score:90`. Whether it still writes to production is UNKNOWN.
- **FACT-098** Zero test coverage of the scoring parser. The repo's 7 test files touch none of it.

## The first real Cloud message — 14 September 2026

- **FACT-110** **Cloud inbound is PROVEN end to end.** `channel_message_events` 0 → 1, `whatsapp_conversation_state` 0 → 1. The row, in full: `provider whatsapp_cloud`, `direction inbound`, `external_message_id wamid.HBgMOTE4NTE3OTQyMTcy…`, `customer_external_id 918517942172`, **`customer_phone 918517942172` — digits, no `+`**, `message_kind text`, `provider_account_id 1098665496068509`, **`origin_verified hmac_sha256_x_hub`** (rank 90), `tenant_id` ALBA. `received_at 05:26:06` → `recorded_at 05:26:12` — six seconds.
- **FACT-111** `whatsapp_conversation_state` carries `last_customer_message_source = whatsapp_cloud_webhook_hmac_verified`. The 24-hour customer-service window is open for `918517942172`.
- **FACT-112** **The chain stops there, by construction.** Measured immediately after: `leads` still 7, no new `audit_log` row, `channel_send_directive` 0, no new `communication_logs` row. The receiver's three terminal nodes only respond. A customer who messages the Cloud number gets a 200 and silence. This is the next thing to build, not a regression.
- **FACT-113** Outbound is still blocked on three owner-side facts, unchanged: `META_WA_SYSTEM_USER_TOKEN` does not exist as a Meta object; `whatsapp_templates` = 0 rows; `WA_CUSTOMER_SERVICE_WINDOW_HOURS` is `NOT_VERIFIED`, so the policy engine refuses every send fail-closed.

## Stale-evidence warning

- **FACT-100** `n8n-workflows/` is an export stamped `2026-08-30T17:56Z` in `_exported_from.updatedAt`. It is **not evidence about the live box**. Anything depending on the live published definition is UNKNOWN until the single writer reads the box.

## Multi-tenancy — what was measured on 14 September, and what was wrong about it

- **FACT-120** The named suspect `leads_authenticated_all` was **inert**. Four tables carried a PERMISSIVE `cmd=ALL` policy over `nexus_current_tenant_ids()` (every active membership), but `information_schema.role_table_grants` shows the `authenticated` role holds a write grant on **only one** of them: `inventory` (`DELETE`). On `leads` and the other two the role has `SELECT` only, so `cmd=ALL` grants nothing extra. A policy is not an exposure until a grant stands behind it.
- **FACT-121** `inventory` already carried **RESTRICTIVE** owner/admin role policies narrowing it further. The exposure was the permissive layer alone, and NX910 replaced only that layer. The restrictive policies are untouched.
- **FACT-122** The second named suspect was wrong in its scariest part: `nexus_resolve_channel_tenant()` does **not** call `nexus_scoped_tenant_id()`. Reading the full function body shows the string match was inside a comment. **The WhatsApp inbound hot path does not go silent at dealership #2.**
- **FACT-123** `nexus_scoped_tenant_id()` genuinely does return NULL once a second active non-quarantine tenant exists, and **8 functions read it**. Each returns quietly rather than raising. This is real, it is deferred, and it is now *reported* rather than remembered.
- **FACT-124** Migration `nx910_an_action_happens_in_the_dealership_you_selected` applied to production 14 Sep and mirrored to `supabase/migrations/20260914065151_*.sql`. `inventory` now reads `ALL_MEMBERSHIPS` for SELECT and `SELECTED_TENANT` for INSERT/UPDATE/DELETE. Verified after apply.
- **FACT-125** `public.nexus_multi_tenant_blockers()` exists on production, EXECUTE granted to `service_role` only. Its clause 2 is self-maintaining: it fires again if any future migration re-adds a write grant to a table whose permissive policy still spans every membership. Current output: one `BLOCKER` row (FACT-123) and `INFO | no cross-dealership write path found`.
- **FACT-126** `nexus_tenancy_readiness()` still reports a live WARN: rows sitting in the quarantine tenant (`audit_log` 20, `communication_logs` 2) from a write path that still omits `tenant_id`. Not closed.

## Scale and spend — the owner's rule, recorded

- **FACT-130** Zero auto dealers are onboarded as of 14 Sep 2026. Everything runs on free tiers by deliberate choice.
- **FACT-131** The owner's spending trigger is explicit: **when 2 paying auto dealers are onboarded**, buy the paid AI model and paid Supabase. Upgrades follow dealer growth from there. Architecture must be scalable from today regardless.
- **FACT-132** Workflow count must **never** grow with dealer count. One shared set of ~20-25 tenant-parameterised n8n workflows serves every dealer; per-dealer workflow copies are forbidden. See `ops/ADR-002-scaling-ladder-and-when-to-pay.md`.
- **FACT-133** The breaking order under load, recorded in ADR-002, is: Supabase free-tier limits first, then the free AI model's rate limit, then n8n execution storage, then the single n8n box's worker concurrency. Each has a named upgrade and a named trigger.

## Scoring provenance — closed 14 September (ADR-003)

- **FACT-140** `leads` had **no provenance columns at all** before today: only `status` and `ai_score`. Migration `nx920_a_score_now_says_who_decided_it` added `score_source`, `rules_score`, `ai_score_raw`, `ai_intent_raw`, `ai_parse_failed`, with CHECK `leads_score_source_is_a_known_label` over exactly four values.
- **FACT-141** All **7 existing rows** were labelled `AI_SCORE_UNKNOWN`. That is the honest value — provenance was never recorded for them. `nexus_scoring_health()` verified after apply: `AI_SCORE_UNKNOWN | 7 | avg 25.8 | "Provenance never recorded. UNKNOWN is not ZERO."` **Nothing in the database is yet labelled as a real model verdict.**
- **FACT-142** Authority decision: **RULES decide today.** One constant `AUTHORITY` in the `Parse AI Decision` node flips it to `'AI'` when the paid structured model arrives at 2 paying dealers. No schema change needed.
- **FACT-143** The `{}` hole is closed by requiring **both** a valid intent *and* a finite score before an answer counts as structured. `{}`, `{"intent":"HOT"}`, `{"score":90}`, `{"intent":"BOILING","score":90}` and `{"intent":"HOT","score":"very high"}` are all now `parse_failed: true` — proven by test, not asserted.
- **FACT-144** `parse_failed` is now **persisted** as `leads.ai_parse_failed`, and `score_source` travels with every row. The audit row carries `[RULES]` / `[AI_SCORE_CONFIRMED]` / `[AI_SCORE_FALLBACK]` as a prefix.
- **FACT-145** `ops/scoring/parse-ai-decision.test.js` runs the **exact jsCode body lifted out of the workflow JSON** — not a copy that can drift — against 18 adversarial assertions including the real 13 Sep decoder-babble string. **18 passed, 0 failed.** Wired into CI as the `Scoring provenance` job. Scoring test coverage went 0 → 18.
- **FACT-146** The rules scorer is deterministic and explainable: base 20, `+25` reachable by phone, `+10` email, `+20` named an enquiry (`-10` greeting only, `-15` no text), `+25` buying-intent phrase, `+15` urgency phrase, `+15` budget ≥ AED 100k (`+10` any budget), `+10` already in a live WhatsApp thread; clamp 0–100; HOT ≥ 70, WARM ≥ 40, else COLD. A lead with **no enquiry text and no budget returns `UNKNOWN`** and goes to the Slack human-review branch rather than being given an invented temperature.
- **FACT-147** **The workflow change is in the repo only. It is NOT on the box.** `n8n-workflows/nexus_master_lead_router_ai_agent.json` is patched; the live Master Router still runs the old node until it is imported. Repo ≠ box (FACT-100).

## CI caught two things the same day

- **FACT-150** `ops/ci/function-grants.mjs --census` **blocked the NX910 mirror** for splitting the revoke into three statements instead of `revoke ... from public, anon, authenticated;`. Not cosmetic — see the next fact.
- **FACT-151** Measured on production: `nexus_multi_tenant_blockers()` carried `authenticated=X/postgres` in `proacl` — **any signed-in dealer user could execute the blockers report.** The as-applied migration granted to `service_role` but never revoked the born-open default. Revoked and re-verified: ACL is now `postgres=X | service_role=X`. The repo mirror is the stricter, correct version. *The CI rule that looked pedantic found a live exposure.*

## Onboarding dealers without a trade licence — 14 September (ADR-004)

- **FACT-160** Meta's Tech Provider path is **closed to NEXUS today**. Meta's own guide: *"Your business must be verified before you can start the app review process."* Embedded Signup additionally needs App Review for Advanced access on `whatsapp_business_messaging` + `whatsapp_business_management`, with video evidence. All of that requires a verified business, which requires the trade licence NEXUS does not have.
- **FACT-161** The **BYO path needs no NEXUS verification at all**: the dealership owns the Meta app, the business portfolio, the WABA and the number, so Standard access suffices and no App Review is involved. The verification burden lands on the dealer — who, being a UAE used-car dealership, already holds a trade licence, an address and a website.
- **FACT-162** An **unverified** business can message **up to 250 unique customers per rolling 24 hours** with full API functionality (templates, automation, campaigns). Verification raises the ceiling 1K → 10K → 100K → unlimited. A pilot dealer can therefore start the same day and verify in parallel. 250/24h is not a constraint at pilot scale.
- **FACT-163** **THE REAL BLOCKER WAS NOT THE LICENCE.** The Cloud receiver verifies the X-Hub signature against a single `$env.META_APP_SECRET` (`verify-or-refuse.node.js:90`) and `channel_registry` can only point at it (`credential_ref = 'env:META_APP_SECRET+META_WA_TOKEN'`). **As built, NEXUS could serve exactly one dealership on WhatsApp Cloud.** Dealer #2 with their own Meta app signs with a different secret and is refused — correctly and fatally.
- **FACT-164** `supabase_vault` **0.3.1 was already installed** on the free tier. Encrypted-at-rest per-dealer credentials cost nothing extra.
- **FACT-165** Migration `nx930_every_dealer_brings_their_own_meta_app` applied: `channel_secret_kind` (3 kinds), `channel_secret` (pointer + sha256 fingerprint, never a value, RLS on, zero grants to anon/authenticated/public), and three service_role-only functions — `nexus_channel_secret_put()`, `nexus_channel_secret_reveal()` (audits **every** call), `nexus_meta_onboarding_status()`. ACLs verified: all three `postgres=X | service_role=X`.
- **FACT-166** Round-trip **PROVEN** on production with a throwaway value generated in-database and deleted immediately after: install → reveal → byte-match, rotation path returns `ROTATED`, an unknown `phone_number_id` **fails closed with a named reason**, and a value under 8 characters is refused. The live ALBA channel holds no test credential — `nexus_meta_onboarding_status()` reads `MISSING` for all three kinds, which is the truth.
- **FACT-167** NX931: `pgcrypto` lives in schema `extensions`, so `digest()` was unresolvable under the pinned search_path and the first install failed. Qualified the call rather than widening the search_path of a function that can reach a vault.
- **FACT-168** NX932: `channel_secret_kind` was born with a `SELECT` grant to `authenticated` and no RLS — **the same born-open shape as FACT-151, found by looking this time instead of being told.** RLS enabled with an explicit read policy. `channel_secret` itself was verified clean.
- **FACT-169** **The receiver still reads `$env.META_APP_SECRET`.** NX930 is the storage layer only. Until `verify-or-refuse.node.js` calls `nexus_channel_secret_reveal()`, multi-dealer Cloud inbound is **BUILT, NOT WIRED**. One dealership is still the live limit.

