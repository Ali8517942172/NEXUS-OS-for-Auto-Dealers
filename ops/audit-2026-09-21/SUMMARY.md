# NEXUS OS — full audit, 21 Sep 2026 (orchestrator summary)

Detail: `N8N-AUDIT.md` + `n8n-audit.json`, `SUPABASE-AUDIT.md`, `FRONTEND-AUDIT.md`, `PROMISES-LEDGER.md`.

## Corrections the orchestrator made to the agents' reports (verified against live)
- Lead Escalation "87% error" is a 7-day figure that is mostly **before** the 20 Sep fix. Since 20 Sep 10:00 UTC: 11 success / 3 error.
- Master Router since 20 Sep 10:00: 18 success / 9 error / 1 canceled — most errors are the OpenRouter-quota window during testing, before persist-first landed. Re-measure over a clean week.
- Error Handler and Infra Health Probe "0 executions ever" is **UNKNOWN, not ZERO**: both have `saveDataSuccessExecution=none`, so successful runs are never recorded. Whether they fire is not proven either way.
- PROMISES-LEDGER read the stale mounted checkout (`MY RESUMES/nexus-os`), not current main. Its "zero billing tables" and "nx991 undocumented / dealer #2 blocked" rows are out of date: `tenant_subscription`/`subscription_state` exist with **0 rows**; nx991 is in the repo; 3 tenants run today.

## Frontend — what is built
26/26 dashboard screens wired, all reading real Supabase objects under the user's JWT (RLS-scoped). 0 mock, 0 broken. Production serves main@`3b6b30d`.
20 live with real data · 4 live but empty (Deal Rescue, Attribution, Finance Desk, Deals) · 2 partial (Appointments read-only; Competitors "re-run" disabled).
Marketing site: form → `nexus_intake.submit_sales_lead` delivers (4 real rows). Pricing copy correct. Pixel embedded.

## Frontend — pending, ranked by "can a dealer subscribe and pay"
| # | build | why it blocks selling | backend ready? |
|---|---|---|---|
| 1 | Subscription & trial screen + trial banner (AED 399, first month free, days left, status) | a price is published, no dealer has a subscription row, nothing shows or enforces it | tables yes (NX990), 0 rows; no payment rail chosen |
| 2 | Dealer onboarding / founder admin console (create dealer, invite users, list tenants, quarantine census, teardown test fixtures) | dealer #2 cannot be added without SQL | `nexus_onboard_dealership` exists, no UI |
| 3 | WhatsApp connect per dealer (Cloud API number, status, test send) | every dealer must reply from its own number; today only Meta's test number | channel_registry + identity schema yes; send path hardcodes WAHA `session:'default'` |
| 4 | Lead scoring state on Leads (PENDING / SCORED / FAILED, RULES vs AI badge, retry) | persist-first is live but invisible; a PENDING lead looks unscored | yes (NX1002, rescore `dCRmzWHCz7bniIBr`) |
| 5 | Notifications screen ("who was told about this lead") | 4 outbox rows stuck PENDING forever, nobody sees it | yes (NX996), no sender |
| 6 | Appointment actions (request / offer / confirm / cancel) | "booked showroom visits" is a claimed outcome; UI can only read, 0 rows | write RPCs are service_role-only; needs an authenticated path |
| 7 | Competitors: enable manual re-run | button permanently disabled | scrape job has no manual trigger |
| 8 | Fill the 4 empty screens (finance quotes, deals, attribution, deal rescue) | empty dashboards in a demo read as "not working" | objects exist; data sources not feeding |

## Must fix before running ads (not UI work, but public)
- `/privacy` and `/terms` still say single-dealership, "not offered for public sign-up".
- `commercial/PILOT-OFFER.md` quotes AED 5,000 + 2,500–3,500/mo against the public AED 399.
- The claude.ai Project instructions still describe the retired Zapier/Make/Odoo/MongoDB stack and claim "100% complete". Replacement text: `claude/nexus-BLUEPRINT-REPLACEMENT-paste-into-project-instructions.md` — only the owner can paste it.

## Backend items that the frontend depends on
- Meta Lead Ads and Google Ads receivers: 0 executions ever — no real ad lead has ever arrived.
- Replies go out on WAHA `session:'default'` in BDC, Drip and KYC — wrong dealership's number at dealer #2. The tenant-scoped BDC candidate exists but is unpublished.
- Bitrix24 is one shared webhook (Tenant A's) — only Tenant A may sync (enforced by NX1001).
- Error Handler / Health Probe: save errors only → alerting is unproven. Make them record successes.
- Master Router LLM/HTTP nodes have no per-node timeout (execution 16068 hung 10 min).
- Test dealers B/C and their NEXUS TEST rows are still in production.
- 2 repo migrations never applied: `20260907230000_the_entry_path_exists_so_connected_is_true_again`, `20260914073000_nx932_the_kind_lookup_was_born_open_without_rls` — review before applying.
