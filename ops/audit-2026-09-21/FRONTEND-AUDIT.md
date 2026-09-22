# NEXUS OS — Frontend Audit (2026-09-21)

Scope: `apps/executive-dashboard` (only real frontend besides marketing-site; `apps/ai-crm/frontend` is empty, `apps/automation-engine` has no UI). Read against `origin/main@3b6b30d` (PR #37, checked out at `/tmp/nexus-main` via `git worktree`; the local `nexus-work` checkout on branch `feat/tenant-guard-and-channels` was one commit behind main at audit time). Backend existence checked against Supabase project `dsvuoovivysszdoiorch` (production, per project docs) via read-only `information_schema`/`pg_proc` queries. A second project `wwspuxrbiyagnrnzgate` ("nexus-staging-tenancy") exists and was not used.

## Production / deployment truth
- Vercel `nexus-os-dashboard` (dashboard) and `nexus-for-autodealers` (marketing) both have their latest **READY** production deployment built from commit `3b6b30d` — **PR #37, main@HEAD**. Production is current.
- Live URLs: `nexus-os-dashboard-six.vercel.app`, `nexus-for-autodealers.vercel.app`.

## Data-access architecture (applies to every screen)
All reads go through `lib/data.js#db(path)` → `GET {SUPABASE_URL}/rest/v1/{path}` with `Authorization: Bearer <the signed-in user's Supabase session token>` (refreshed per call via `supabase.auth.getSession()`), never a service-role key — confirmed no `SUPABASE_SERVICE_KEY`/service-role literal anywhere in `apps/executive-dashboard`. Tenant scoping is therefore enforced by Postgres RLS under the caller's own JWT, not by app-layer filtering. Writes go through the same path (`dbWrite`) or through n8n webhooks (`lib/data.js#n8n`, `HOOK` map), each of which re-verifies the same Supabase JWT server-side. Role-gated buttons (`canSetCost`, `canDeleteUnit`, `canReassignLead`, `canManageAccess`, `canGrantOwner`) read `tenant_members.role`, defaulting to "show the button" when authority is unknown, deferring the actual refusal to the database RLS/trigger — reasonable, not a leak, since the request still round-trips RLS.

## Screen-by-screen (26 screens, all 26 wired into both `lib/nav.js` NAV and `app.js` imports; the 5 "Revenue Recovery engine" modules are `import.meta.glob`'d, all 5 present on disk — none dropped from the build)

| Screen (file, ~lines) | Backend read/write | Exists in prod? | Verdict |
|---|---|---|---|
| Today's Money Leaks (`money-leaks.js`, 2015) | `leads`,`v_needs_attention`,`v_lead_recovery*`,`v_inventory_action_queue`,`v_deal_rescue_readiness`,`v_conversations`,`v_workflow_health`,`v_action_center_health`, `rpc/sentinel_inventory_actions` | yes, all | **LIVE-WITH-REAL-DATA** — some recommendation types render intentionally-disabled buttons labelled "— not wired yet" (`NOT_WIRED` constant) where the engine has no action UI yet |
| Overview (`overview.js`,3111) | `leads`,`daily_metrics`(35 rows),`v_*` health/recovery/dealrescue views,`competitors`,`kyc_documents`,`whatsapp_contacts`,`communication_logs` | yes | **LIVE-WITH-REAL-DATA** |
| Leads (`leads.js`,1351) | `leads`,`communication_logs`,`purchase_history`,`whatsapp_contacts`,`v_needs_attention`,`rpc/nexus_lead_attribution` | yes | **LIVE-WITH-REAL-DATA** (28 leads in prod) |
| Record a Lead (`record-lead.js`,538) | `lead_source_catalogue`(11 rows),`v_lead_origin`,`rpc/nexus_lead_source_readiness` | yes | **LIVE-WITH-REAL-DATA** — the only working manual-ingest path; `lead_event` has 1 row total in prod (see reverse-list) |
| Lead Sources (`lead-sources.js`,1016) | `v_lead_origin`,`rpc/nexus_lead_source_readiness` | yes | **LIVE-WITH-REAL-DATA** |
| Channels (`channels.js`,463) | `rpc/nexus_channel_status` | yes | **LIVE-WITH-REAL-DATA** (status only; no register/secret UI — see reverse list) |
| Conversations (`conversations.js`,3035) | `leads`,`v_conversations`,`v_needs_attention`,`v_workflow_health`; write via `HOOK.whatsappSend` | yes | **LIVE-WITH-REAL-DATA** (`conversation` table has 1 row, `communication_logs` 456) |
| Appointments (`appointments.js`,504) | **read-only** `rpc/nexus_appointment_status` | yes | **LIVE-BUT-EMPTY / PARTIAL** — `appointment` table has 0 rows in prod, and the screen has no write path at all: request/offer/confirm/attend/cancel are all `service_role`-only per the code's own comments (NX995), so no UI can ever create one |
| Compliance (`compliance.js`,2711) | `leads`,`kyc_documents`(19),`whatsapp_contacts`,`communication_logs`,`audit_log`,`users`,`rpc/nexus_whatsapp_consent_current`,`rpc/nexus_whatsapp_consent_events` | yes | **LIVE-WITH-REAL-DATA** |
| Revenue Recovery (`revenue.js`,994) | `v_deal_rescue*`,`v_lead_recovery*`,`v_inventory_action_queue`,`v_inventory_profit_sentinel`,`v_attribution_sale_chain`,`v_policy_*`,`v_action_center_health` | yes | **LIVE-WITH-REAL-DATA** |
| Lead Recovery (`lead-recovery.js`,734) | `v_lead_recovery*` | yes | **LIVE-WITH-REAL-DATA** (1 row in `lead_recovery_actions`) |
| Deal Rescue (`deal-rescue.js`,561) | `v_deal_rescue*` | yes | **LIVE-BUT-EMPTY** — `finance_quotes` (0 rows) and `deals_embeddings` (2 rows) mean the readiness/candidate views have almost nothing to surface yet |
| Attribution (`attribution.js`,896) | `attribution_link_basis`,`v_attribution_*`,`rpc/nexus_lead_attribution_summary` | yes | **LIVE-BUT-EMPTY** — thin (1 lead_event, 2 purchase_history rows) so chains are mostly empty |
| Policy (`policy.js`,720) | `v_policy_authoritative`,`v_policy_rule`,`v_policy_unmigrated_constant` | yes | **LIVE-WITH-REAL-DATA** (13 policy_rule rows) |
| Inventory (`inventory.js`,800) | `inventory` | yes | **LIVE-WITH-REAL-DATA** (12 units) |
| Competitors (`competitors.js`,2740) | `competitors`,`inventory`,`v_competitor_latest`,`v_needs_attention`,`v_workflow_health` | yes | **PARTIAL** — "Re-run scrape" is a real button that is permanently `disabled` (`NO_SCRAPE_HOOK`, comment: "that job has no manual start"); comparator table itself is real (22 rows) |
| Ask AI (`ask.js`,1772) | `leads`,`audit_log`,`rag_documents`(15),`v_needs_attention`,`v_workflow_health`,`rpc/nexus_workflow_catalogue`; write via `HOOK.askAi` | yes | **LIVE-WITH-REAL-DATA** |
| Finance Desk (`finance.js`,3220) | `finance_quotes`,`inventory`,`leads`,`audit_log`,`v_needs_attention`; write via `HOOK.finance` | yes | **LIVE-BUT-EMPTY** — `finance_quotes` is 0 rows in prod; the screen and webhook are wired, nobody has run a quote yet |
| Customer 360 (`customers.js`,1958) | `customer_360_profiles`,`v_customer_360`,`v_customer_directory`,`leads`,`purchase_history`,`whatsapp_contacts`,`audit_log` | yes | **LIVE-WITH-REAL-DATA** |
| Action Center (`actions.js`,821) | `inventory_action_reason_codes`,`v_inventory_action_queue`,`v_inventory_action_timeline`,`rpc/action_approver_context`,`rpc/sentinel_inventory_actions` | yes | **LIVE-WITH-REAL-DATA** (3 rows `inventory_actions`) |
| Campaigns (`campaigns.js`,2179) | `leads`,`communication_logs`,`audit_log`,`v_conversations`,`v_needs_attention`,`v_workflow_health`; write via `HOOK.warmDrip` | yes | **LIVE-WITH-REAL-DATA** |
| Deals (`deals.js`,1935) | `leads`,`inventory`,`purchase_history`,`finance_quotes`,`deals_embeddings`; write via `n8n('deals/closed-won')` | yes | **LIVE-BUT-EMPTY** — `purchase_history` only 2 rows, no closed deals recorded yet |
| Automation (`automation.js`,2308) | `leads`,`audit_log`,`v_workflow_health`,`rpc/nexus_workflow_catalogue` | yes | **LIVE-WITH-REAL-DATA** |
| Team (`team.js`,2131) | `leads`,`users`,`v_needs_attention`,`v_team_performance`,`rpc/nexus_team_pending`,`rpc/nexus_team_roster`; write via `rpc/nexus_team_invite` | yes | **LIVE-WITH-REAL-DATA** (4 tenant_members) |
| Setup (`setup.js`,307) | `rpc/nexus_meta_onboarding_status` | yes | **LIVE-WITH-REAL-DATA** — explicitly documents in comments that billing/subscription/trial tables don't exist at all |
| Settings (`settings.js`,1969) | `audit_log`,`rag_documents`,`v_needs_attention`,`v_workflow_health`,`rpc/nexus_workflow_catalogue` | yes | **LIVE-WITH-REAL-DATA** |

No screen renders mock/static/fabricated numbers — the codebase's own comments repeatedly call out and describe *removing* prior hardcoded values (e.g. inventory holding cost AED 50/day, "-18s vs last week" deltas); every "hardcod"/"placeholder" grep hit was either an HTML input placeholder or a comment about a past defect, not live mock data. Loading/error/empty states are present on every screen, mostly via the shared `panel({ load })` wrapper in `lib/ui.js` plus `lib/states.js` (`stateLoading/stateError/stateEmpty`) — a few screens (`money-leaks.js`, `attribution.js`, `setup.js`) route entirely through `panel()`'s own load/catch handling rather than importing the state helpers directly, which is the same mechanism, not a gap.

## Reverse list — backend capability, no screen
- **`nexus_notification_outbox`** + the whole `nexus_notification_*` RPC family (enqueue/claim/mark_sent/mark_failed/acknowledge) — 4 rows in prod, zero references anywhere in `screens/` or `lib/`.
- **Subscription/billing state** (`tenant_subscription`, `subscription_state`, `subscription_event`, `nexus_subscription_status/start_trial/convert_to_paid/cancel`) — `lib/setup.js` explicitly says in its own comments "no billing table, no subscription table and no trial table" is surfaced.
- **Scoring state / PENDING leads** (`nexus_pending_scoring_leads_for_tenant`, `nexus_scoring_health`) — not called from any screen.
- **Appointment booking actions** (`nexus_appointment_request/offer_slots/confirm/mark_attended/cancel`) — `appointments.js` only reads `nexus_appointment_status`; all write verbs are `service_role`-only by design, no UI can reach them.
- **Channel identity / secrets** (`nexus_channel_secret_put/reveal`, `nexus_register_channel`, `channel_registry` writes) — `channels.js` only reads status; registration/secret management has no screen.
- **Quarantine census** (`nexus_quarantine_census`, `nexus_quarantine_comm_log`) — no screen reference (one unrelated string match, "quarantined", in conversations.js copy text).
- **Multi-dealer admin/onboarding** (`nexus_onboard_dealership`) — not called anywhere; only WhatsApp-number onboarding status (`nexus_meta_onboarding_status`, a different function) is surfaced, in Setup.
- **Audit log** — NOT missing: read directly by `settings.js` (9 refs) and `compliance.js` (20 refs), just not a standalone "Audit Log" screen.

## Marketing site (`apps/marketing-site`)
- Form `#lead-form` posts to `/api/lead` (`api/lead.js`), which writes durably via `rpc/submit_sales_lead` in the `nexus_intake` schema (confirmed to exist in prod) — `nexus_sales_lead` has 4 rows in prod, so the pipeline demonstrably delivers. A secondary notify webhook and a simulated `nexus_record_lead_event` write are best-effort, non-blocking.
- Pricing text on the live site matches the required copy exactly: "AED 399 / month... The first month is free. No setup fee, no contract, cancel any time." verified both in source and on the rendered live page.
- Meta Pixel id `859032680532628` is present in a `<meta name="nexus:meta-pixel-id">` tag and wired into a guarded `fbq()` loader (only fires if the id matches `/^[0-9]{6,20}$/`). Live-page network check: `fbevents.js` returned HTTP 503 from Facebook's CDN in this browsing session — could not independently confirm the pixel actually fired; the code path and id are correct regardless.

## Counts
LIVE-WITH-REAL-DATA: 20 · LIVE-BUT-EMPTY: 4 (Deal Rescue, Attribution, Finance Desk, Deals) · PARTIAL: 2 (Appointments — read-only, no write path exists; Competitors — scrape button permanently disabled) · MOCK: 0 · BROKEN: 0 · NOT-IN-NAV: 0 (all 26 screen files are wired into nav+app.js).
