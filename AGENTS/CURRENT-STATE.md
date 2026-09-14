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
- Vercel: both projects on `6b23ddd` (PR #22 merge), Production, Ready. Both sites render. Shipped bundle carries **zero JWTs** (FACT-181). **Open: four high-privilege Supabase values sit in the dashboard's build environment and the build needs none of them (FACT-182).**
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
- ~~**P0-04 Scoring provenance.**~~ **CLOSED 14 Sep** (ADR-003). Rules authoritative, model labelled; `score_source` + `ai_parse_failed` persisted; `{}` hole closed; 18 adversarial tests in CI. **Repo only — the box still runs the old node (FACT-147).**
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

## Onboarding a second dealership onto WhatsApp

Path chosen: **dealer brings their own Meta app** (ADR-004). Needs no NEXUS trade licence and no Meta verification of NEXUS — the dealer verifies their own business, which they can, having a licence.
- Per-dealer encrypted credentials: **BUILT** (NX930, Vault, round-trip proven).
- Receiver using them: **WRITTEN AND TESTED, NOT DEPLOYED** — 37 assertions pass including "B's delivery signed with A's secret is refused". **The box still runs the single-secret version (FACT-177), so the live limit is still one dealership.**
- Owner step to lift it: import workflow `J8MXprxVw1yhjBpp`, then set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on **both** `n8n` and `n8n-worker`. Flip `NEXUS_REQUIRE_PER_DEALER_SECRETS=true` once ALBA's credentials are in the vault.
- Unverified dealer ceiling is 250 unique customers / 24h. Not a pilot constraint.

## Scoring

Authority: **RULES**. The model runs, its answer is recorded in `ai_score_raw`, and it decides nothing.
Flip to AI at 2 paying dealers by changing one constant — but only after 200 dual-scored leads and `AI_SCORE_FALLBACK` under 1%. See `ops/ADR-003-who-decides-the-score.md`.
`nexus_scoring_health()` today: `AI_SCORE_UNKNOWN | 7 leads`. **Nothing in the database is yet labelled a real model verdict.**

## Scale and spend

Zero dealers onboarded. Free tier by choice. **Trigger: at 2 paying dealers → paid AI model + paid Supabase**, then upgrades follow growth.
Workflow count never grows with dealer count — one shared tenant-parameterised set; per-dealer copies forbidden.
Breaking order under load and the named upgrade for each: `ops/ADR-002-scaling-ladder-and-when-to-pay.md`.

## Pilot

NOT READY. Gate order: data durability → one channel end-to-end → scoring provenance → second-tenant isolation → pilot.
