# CURRENT STATE — 13 September 2026

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
| Meta delivers to our endpoint | **NOT PROVEN — blocker** |
| `channel_message_events` | 0 rows |
| Cloud outbound reply | NOT BUILT (workflow exists, not imported; token, templates, policy all missing) |
| WAHA inbound + AI reply | WORKING — the only proven transport |

## Open P0s

- **P0-01 Lead deletion.** Mechanism found: manual test-reset SQL against production. Real customer data destroyed, including two HOT-scored leads. Not contained. PITR never checked.
- **P0-02 Cloud inbound delivery.** Three live hypotheses; the cheapest check (App Mode Live vs Development) costs one glance.
- **P0-03 Repo/box drift on the `'+'` fix.** The box is patched, the repo is not. A re-import would reintroduce the defect.
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
