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

## Not blockers (measured, previously suspected)

- Dashboard hardcoded figures — **FALSE ALARM** (FACT-060).
- Recipient allowlist — **REFUTED** (FACT-013).
- Cross-tenant leakage — none found (FACT-050..054).
- `nexus-os-dashboard.vercel.app` fake page — **not our project** (FACT-004).
- "Scorer never produces HOT" — **false** (FACT-091).

## Pilot

NOT READY. Gate order: data durability → one channel end-to-end → scoring provenance → second-tenant isolation → pilot.
