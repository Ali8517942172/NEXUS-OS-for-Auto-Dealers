# NEXUS OS — resume state, paused 2026-09-01 02:05 UTC

Ten agents were cut off mid-edit by a session rate limit (resets 2026-09-01 20:10 UTC).
Work is committed to local branch `wip/platform-truth-2026-09-01` off `main` (`c1ead61`)
and captured as `0002-WIP-...patch`. **Every file parses. Nothing is verified. Do not merge.**

## DONE and trustworthy

**Postgres — migration `canonical_workflow_outcome_semantics` is APPLIED and live.**
- `public.nexus_outcome_class(workflow, status, summary)` → `SUCCESS | PARTIAL | FAILURE | NO_RESULT | REJECTED_EXPECTED | ESCALATED | UNKNOWN`. Sole authority.
- `v_workflow_health` rebuilt on it. New columns: `successes_30d, failures_30d, partials_30d, no_result_30d, rejected_30d, escalated_30d, unknown_30d, effective_runs_30d, success_rate_30d, last_success, last_partial, last_incomplete`. New `health` values `PRODUCING_NOTHING`, `UNKNOWN_OUTCOME`, `NO_QUALIFYING_RUNS`.
- Nothing else in the database depends on this view — verified via `pg_depend` before replacing it.

Two design decisions encoded deliberately, do not re-litigate:
- **A refusal by design is not a fault.** `REJECTED_EXPECTED` is out of the success denominator, so an auth rejection cannot dilute a real miss rate.
- **A partial is not a success.** `PARTIAL` ⇒ DEGRADED. Work left the system half-done.
- **Rule 1 is a writer correction, and temporary.** Finance Calc and Master Router both write `FAILED` on rows whose own summary says *"N of M claimed steps did not land"*. The class function corrects that from the structured phrase. When the writers are fixed, delete rule 1 from the SQL and `lib/health.js` together.

What the truth looked like before and after:

| | before | after |
|---|---|---|
| workflows DEGRADED | 2 | **11 + 1 PRODUCING_NOTHING** |
| Finance Calc | 91.7% | **11.1%** (3 successes in 27 qualifying runs) |
| Competitor Scraping | green "Clean, 30 d · 100.0%" | **PRODUCING_NOTHING · 13.1%** (73 of 84 runs produced no price) |
| Customer 360 | 90.5% | **42.9%** |
| WhatsApp BDC | not surfaced | **41.6%**, 166 failures, all `Model Ladder` |

**`lib/health.js` is complete and tested** — 9 classification cases pass and its rate matches the SQL to the decimal. It is the frontend mirror of the function above and the only module permitted to interpret `audit_log.status`.

## NOT done — the ten agents

All eleven files parse; none of the agents finished, self-reviewed, or reported. Treat every diff as a first draft by someone who was interrupted mid-sentence.

| file | lines changed | brief |
|---|---|---|
| `screens/finance.js` | 624 | remove ALL frontend finance math; wire the real `finance_quotes` columns |
| `screens/overview.js` | 483 | KPI strip, `answered` set, open-leads filter, pipeline null, daily_metrics off-by-one |
| `screens/competitors.js` | 418 | snapshot→listing reduction, tautological match, schedule constants, sign inversion |
| `screens/team.js` | 319 | pipeline status filter, SLA honesty, dead `ON DELETE SET NULL` claim |
| `screens/automation.js` | 205 | consume canonical health; no local status literals |
| `screens/campaigns.js` | 168 | three false assertions, WhatsApp legs, multi-shape keys |
| `screens/settings.js` | 125 | delete `CRED_VERIFIED`, stop the side-effecting probe, real rates |
| `screens/compliance.js` | 102 | one canonical archive-gap source, full retention vocabulary |
| `lib/ui.js` | 90 | retry path orphans every caller's event handlers |
| `lib/integrations.js` | 56 | 502 paints green; finance-calc probe creates real executions |
| `screens/ask.js` | 30 | barely started — grounding metadata still unwired |

## On resume, in this order

1. **Verify before extending.** For each file: read the diff, confirm it does what the brief says, finish what is missing. `screens/ask.js` is essentially untouched. Do not assume an agent's partial edit is correct because it parses.
2. Re-run the identity test: `node apps/executive-dashboard/lib/identity.test.mjs` on the identity branch — expect 247 passed.
3. **`response_time_minutes` DB fix — not started.** Root cause is settled and written up in `/home/claude/audit/response-time-root-cause.md`. Summary: the column is `0` on all three leads, not NULL. A `BEFORE INSERT` trigger on `leads` measures a reply that arrived *before* the lead row existed, gets a negative interval, and `greatest(0, …)` renders that as "answered in 0 minutes". A correct `AFTER INSERT` writer on `communication_logs` already exists but is permanently locked out because its guard is `is null` and `0 is null` is false. A fourth defect: `nexus_lead_for_comm_key` cannot resolve the `+digits@whatsapp.lead` shape that `nexus_comm_keys_for_lead` generates, so fixing only the first three leaves lead 38 at 82 minutes instead of 4. All four must be fixed together, plus a reviewed DML migration to reset the three poisoned rows to NULL — the guard only writes over NULL, so they will not self-correct.
4. Cross-module regression: Lead → Conversation → Customer 360 → Compliance → Deal. A screen rendering is not a PASS.
5. **J1 stays on hold** until the above passes, per the owner's instruction.

## Blocked on Ali, not on this session
- Push `frontend/identity-resolver` (rebased patch `0001-identity-resolver-REBASED.patch`, 247 assertions pass). The session's git proxy refuses this repo. **Delete the older `0001-identity-resolver.patch` — it predates the Overview fix and would revert it.**
- Two workflows still paused from the J1 run: `B3TcpfzOMWj8oWgF` (Silence Detector), `57QpbNQGwlFKb0q3` (Infra Probe).
- Set a GCP budget alert before the $30 credit runs out on the e2-small.

## Standing constraints
- Agents must never touch the production n8n box in parallel — that has taken it down twice. Subagents get SELECT-only Supabase and no n8n MCP at all.
- Database migrations are applied by the main session only, never by parallel agents.
- Never publish a claim of paying customers until it is true.
