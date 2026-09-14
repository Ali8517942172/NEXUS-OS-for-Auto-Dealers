# CURRENT STATE — 14 September 2026

Single source of truth for status. Only the orchestrator updates this.
Read `FACTS.md` for the evidence behind every line.

## Vocabulary — enforced

`UNKNOWN` != `ZERO`. `NOT RUN` != `PASS`.
`ESTIMATED` != `ATTRIBUTED` != `CONFIRMED` != `RECOVERED`.
`registered` != `connected` != `received` != `attributed` != `recovered`.
`implemented` != `tested` != `production-proven` != `commercially validated`.

## Production

- GitHub: PR #20 merged. `main` carries everything through `dd611af`.
- Vercel: both projects deployed from the PR #20 merge. `/privacy` and `/terms` live, HTTP 200.
- Supabase `dsvuoovivysszdoiorch`: live, RLS sound, **actively losing lead rows** (see P0-01).
- n8n box: live. Repo export is 14 days stale and has **diverged from the box** (FACT-030/031).

## WhatsApp

| leg | state |
|---|---|
| Meta app published | DONE |
| Callback URL + `messages` field | DONE |
| Real message reaches Meta | PROVEN |
| Meta delivers to our endpoint | **PROVEN** 14 Sep — WABA subscription was the blocker |
| `channel_message_events` | **1 row**, HMAC-verified, digits-only phone |
| Customer / lead / classification / reply | **NOT BUILT** — receiver ends at respond; 200 and silence |
| Cloud outbound reply | NOT BUILT (workflow exists, not imported; token, templates, policy all missing) |
| WAHA inbound + AI reply | WORKING — the only proven transport |

## Open P0s

- **P0-01 Lead deletion.** Mechanism found: manual test-reset SQL against production. **Contained 13 Sep** by the NX900 delete guard (verified). Still open: the ~116 lost rows are unrecovered, and PITR availability on the free tier was never confirmed.
- ~~**P0-02 Cloud inbound delivery.**~~ **CLOSED 14 Sep.** WABA was subscribed only to Meta's own 1P test app.
- ~~**P0-03 Repo/box drift on the `'+'` fix.**~~ **CLOSED 14 Sep.** Repo patched and the fix proven by real traffic.
- **P0-04 Scoring provenance.** `parse_failed` never persisted; `{}` silently becomes WARM/50; parse failure recorded as SUCCESS.
- **P0-05 `lead_event` certifies a fixture as real production data.**
- **P0-06 Nothing happens after a Cloud message lands.** Receiver ends at respond: no customer, no classification, no lead, no reply, no audit row (FACT-112).
- **P0-07 `nexus_scoped_tenant_id()` goes silent at dealership #2.** 8 callers return quietly instead of raising. Deferred, but now *reported* by `nexus_multi_tenant_blockers()` rather than remembered (FACT-123/125).
- **P0-08 Quarantine-tenant WARN.** A live write path still omits `tenant_id`: `audit_log` 20 rows, `communication_logs` 2 rows sitting in the quarantine tenant (FACT-126).

## Not blockers (measured, previously suspected)

- Dashboard hardcoded figures — **FALSE ALARM** (FACT-060).
- Recipient allowlist — **REFUTED** (FACT-013).
- Cross-tenant leakage — none found (FACT-050..054).
- `leads_authenticated_all` cross-dealership write — **inert**, no write grant behind it (FACT-120).
- WhatsApp hot path going silent at dealership #2 — **REFUTED**, `nexus_resolve_channel_tenant` never calls the scoped function (FACT-122).
- `nexus-os-dashboard.vercel.app` fake page — **not our project** (FACT-004).
- "Scorer never produces HOT" — **false** (FACT-091).

## Multi-tenancy

- `inventory` writes scoped to the selected dealership — **CLOSED 14 Sep** by NX910, applied to production and mirrored to `supabase/migrations/`.
- `nexus_multi_tenant_blockers()` on production reports: 1 BLOCKER (P0-07) + `INFO | no cross-dealership write path found`.
- Run it before onboarding dealer #2. It is self-maintaining — a future migration that re-adds a write grant behind an all-memberships policy makes it fire again.

## Scale and spend

Zero dealers onboarded. Free tier by choice. **Trigger: at 2 paying dealers → paid AI model + paid Supabase**, then upgrades follow growth.
Workflow count never grows with dealer count — one shared tenant-parameterised set; per-dealer copies forbidden.
Breaking order under load and the named upgrade for each: `ops/ADR-002-scaling-ladder-and-when-to-pay.md`.

## Pilot

NOT READY. Gate order: data durability → one channel end-to-end → scoring provenance → second-tenant isolation → pilot.
