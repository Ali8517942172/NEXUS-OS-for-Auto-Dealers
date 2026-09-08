# NEXUS OS — platform truth pass, complete
**2026-09-01** · branch `wip/platform-truth-2026-09-01` off `main` (`c1ead61`) · 15 files, +6106 / −1630

Ten agents, two waves, every one verified against the live database. Below is what changed and what is still open.

---

## 1. The database now has one authority on what a run outcome means

Migration `canonical_workflow_outcome_semantics` is **applied and live**.

`public.nexus_outcome_class(workflow, status, summary)` → `SUCCESS | PARTIAL | FAILURE | NO_RESULT | REJECTED_EXPECTED | ESCALATED | UNKNOWN`, and `v_workflow_health` is rebuilt on it. Nothing else in the database depended on that view — checked with `pg_depend` before replacing it.

Three decisions are encoded deliberately:

- **A refusal by design is not a fault.** `REJECTED_EXPECTED` is excluded from the success denominator, so an auth rejection cannot dilute a real miss rate.
- **A partial is not a success.** `PARTIAL` ⇒ DEGRADED. Work that left the system half-done is the dealership's problem.
- **The writers mislabel their own rows, and the layer corrects them.** Finance Calc and Master Router both write `FAILED` on rows whose own summary reads *"N of M claimed steps did not land"*. That is a partial delivery. The correction is rule 1 in both the SQL and `lib/health.js`, marked temporary — when the writers are fixed, delete it from both together.

**`REJECTED` could not be classified globally**, which is why a blanket rule would have failed. Ask-AI's `REJECTED` is *"Unauthorized request rejected"* — genuinely expected. Competitor Price Scraping's is *"no usable intel — no price could be extracted"*, 84 times. Treating both as expected rejections would have hidden an 87% miss rate behind a green pill. Hence a distinct state, `PRODUCING_NOTHING`: runs without failing, achieves nothing.

What the dashboard was claiming, and what is true:

| workflow | showed | actual |
|---|---|---|
| Competitor Price Scraping | green **Clean, 30 d · 100.0%** | **PRODUCING_NOTHING · 12.5%** — 84 of 96 runs produced no price |
| Finance Calc | **91.7%** | **DEGRADED** — 3 clean successes, and **5 quotes issued whose record never landed** |
| Customer 360 | **DEGRADED 91.3%** | 39.1% — 10 further runs `PARTIAL` |
| WhatsApp BDC | not surfaced | **41.6%**, 166 failures, all `Model Ladder` |
| KYC/AML Auditor | — | **DEGRADED, 9 runs, 0 successes** |
| Retention Purge | — | **NEVER_RAN** |

Workflows reading DEGRADED went from **2 to 11**, plus one `PRODUCING_NOTHING`.

---

## 2. What each screen was asserting, and no longer does

**finance.js** — the invented-EMI class of bug is gone. `instalment()` and every call site removed; `Math.pow` and every `(1+r)` term absent from the file. The real `finance_quotes` column names are wired (14 verified against `information_schema`; the screen's old probe list contained **not one real name**, which is why it concluded the data was absent and modelled the figures itself). Wrong nouns fixed — trade-in equity was printed under *"Down payment"*, the payoff under *"Amount financed"*. The legal floor and the market assumption are now separate constants and neither reaches customer-facing arithmetic.

The agent also found a state the audit had no slot for: **a quote issued whose record was lost** — the desk's actual condition. Finance Calc ran 60 times in 30 days and `finance_quotes` has zero rows. The history panel could previously read *"No quotes recorded yet"* over five lost quotes; it now names the customer.

**overview.js** — *"Open leads"* was the unfiltered row count (3 shown, 1 real). *"Pipeline value"* rendered unknown as a large **AED 0** above a caption saying no figure existed. The `answered` set counted `[SILENCE-ESCALATED]` system markers — rows written *because* nobody replied — as proof somebody had, and never compared the message time to the lead's creation, silently exempting repeat customers from the 5-minute rule. The delta read the second-newest `daily_metrics` snapshot and never the newest. An aging unit showed `at = now()`, so a car 148 days on the lot read **"waiting just now"** beside its own *"148 days in stock"*.

**settings.js** — `CRED_VERIFIED` deleted outright: Gmail showed a green *"Verified working"* pill on the strength of a **date hard-coded in the source file**, and stayed green because the panel only read `status=eq.FAILED` and so could not see the eight `PARTIAL` rows reading *"Gmail read failed"*. There is no green credential state left. The failure read is widened; credential grouping no longer merges seven failing escalation emails with two failing Bitrix writes into one row blaming the ERP.

**lib/integrations.js** — the n8n tile returned a string instead of throwing on a non-`ok` response, so a **502 painted green** captioned "HTTP 502", and Settings, which reads that tile by its colour, then printed *"Supabase and n8n both answered"*. The Finance Calc probe is removed: it fired a real business execution on every Settings mount. **Correction to the audit** — it claimed 52 of 60 runs were manufactured; the true figure is **16 of 60 (27%)**, verified row by row. Still the page poisoning its own metric, but the audit's number was wrong and is not repeated in the code.

**lib/ui.js** — the retry path built a new card no caller ever saw, so after a *successful* retry every row and button in the panel was dead. Fixed without changing `panel()`'s signature.

**campaigns.js** — three false assertions removed. It told an operator in red that the drip *"has no reply-detection step, so nothing stops them — reply to these people by hand"*; the workflow has **four** reply gates that stop the sequence themselves. It printed *"No drip run has ever been logged"* beside its own list of five. It said *"no mail-credential failure is recorded"* while holding nine of them.

**competitors.js** — the match was a tautology: the scraper writes **our own** model string back out, so both sides agreed by construction and the reassuring branch was the only reachable one. The table is append-only, so *"We ask more · 4"* and *"We undercut · 4"* sat beside a subtitle correctly saying **3 vehicles**. The schedule constants were wrong in hour and cadence. `toyota.ae` — the manufacturer's new-car site — was called a rival dealership.

**compliance.js** — the auditor-facing screen. One canonical source per fact now; `neverArchived` and `overdueRetention` deleted rather than reconciled. The previous pass had left the file **asserting a fix it had not made**, which on this screen is worse than the original defect. Eleven retention states defined from the schema and the writers. A vocabulary defect the audit missed: `verdict` is `NOT NULL DEFAULT 'PENDING'`, so `!d.verdict` was permanently false — three dead paths, and PENDING rows sat under no tab.

**team.js** — *"Pipeline in rep hands"* summed every lead ever assigned, dead ones included; it is now open pipeline and labelled as such. The 5-minute panel no longer asserts an SLA result the column cannot support.

**automation.js** — consumes the canonical layer; no status literal survives in logic. **Correction to the audit**: Customer 360 was never showing HEALTHY/100% — it read DEGRADED 91.3%. The workflow that actually sat at green 100% producing nothing was Competitor Price Scraping.

**lib/format.js** — `TONE` was missing seven health/outcome values and contradicting three. `PARTIAL`, `FAILURE` and `PRODUCING_NOTHING` — three faults — were painting neutral grey.

**lib/badges.js** — the nav badge read **17** where the panel listed **13**, counting one car undercut at one price four times. Both now read 13, using Overview's rule transplanted rather than reinvented.

**QUALITY_GATE.mjs** — was rejecting correct code on a stale `v_workflow_health` whitelist, failing five screens. A stale gate that flags correct work teaches people to ignore it.

---

## 3. The recurring failure mode, and how it is now closed

Three separate interrupted agents left a **deleted identifier with live call sites** — `MAILBOX_RE` and `NO_CANCEL_HOOK` in campaigns, `missed` in competitors, `pipelineOf` in team, `renderIntegrations` in settings, `rateOf` in automation. Every one sat inside a function body, so **every file parsed** and each screen threw only at runtime, in exactly the state it exists to handle.

Scope analysis now runs across all 14 screens and every lib module: **no unresolved identifier anywhere**. Every `import { … }` resolves to a real named export. Several agents additionally executed their screens under jsdom/linkedom/Playwright against live rows — which is how one of them found three defects in its own work that reading would not have shown.

---

## 4. Corrections to the audit itself

Worth recording, because the audit is now a reference document:

- Lead 38's first reply was **4.2 minutes** after creation, not 81. The 04:02 row is the first under his *real email*; the genuine reply is under `+918517942172@whatsapp.lead`, which `nexus_lead_for_comm_key` cannot resolve. So there is no hidden breach — the damning row is **lead 35, whom nobody ever replied to and the column reports as answered instantly**.
- The Settings probe manufactured 16 of 60 runs, not 52.
- Customer 360 never rendered HEALTHY/100%.
- Several live figures in the audit were a stale snapshot (84/11/73 vs 96/12/84).

---

## 5. Still open

**Blocked on you**
- Push `frontend/identity-resolver` — rebased patch, 247 assertions pass. The session's git proxy refuses this repo; adding it to the session's sources ends the patch-passing for good. **Delete the old `0001-identity-resolver.patch`; it predates the Overview fix and would revert it.**
- Two workflows still paused from the J1 run: `B3TcpfzOMWj8oWgF` (Silence Detector), `57QpbNQGwlFKb0q3` (Infra Probe).
- A GCP budget alert before the $30 credit runs out.

**Next session's work**
- **`response_time_minutes`** — root cause settled, fix not yet applied. Four defects that must be fixed together: the `BEFORE INSERT` trigger measuring a reply that predates the lead; `greatest(0, …)` turning that into "answered in 0 minutes"; the correct `AFTER INSERT` writer locked out because its guard is `is null` and `0 is null` is false; and `nexus_lead_for_comm_key` being unable to resolve the `+digits@whatsapp.lead` shape its own sibling function generates. Plus a reviewed DML migration for the three poisoned rows — the guard only writes over NULL, so they will not self-correct.
- **The scraper workflow** — seven precise fixes scoped in `fix-competitors.md`: the `model` fieldValue writing our own string, `collectPrices()`'s unconstrained `Math.min`, the missing `operation: upsert`, `competitorSource` being a hostname, the `priceDiff` sign, stale `workflow_registry.trigger_detail`, and `v_needs_attention` firing per snapshot.
- **`v_needs_attention`** needs `DISTINCT ON` — the frontend collapses duplicates now, but at the source it still emits one row per scrape.
- **The writers** — once Finance Calc and Master Router label their own rows correctly, delete rule 1 from the SQL and `lib/health.js`.
- Cross-module regression: Lead → Conversation → Customer 360 → Compliance → Deal. A screen rendering is not a pass.
- **J1 stays on hold** until the above passes.
