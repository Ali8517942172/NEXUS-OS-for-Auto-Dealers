# NEXUS OS — platform truth pass, complete
**2026-09-01** · branch `wip/platform-truth-2026-09-01` off `main` (`c1ead61`) · **23 files, +11,708 / −2,316**

All 14 screens, every shared library, seven database migrations and one production workflow. Every claim below was verified against the live database; where a figure is quoted it was taken from it, not from a document.

**Verification of the tree as a whole:** 30 modules — all parse, every `import { … }` resolves to a real named export, and scope analysis reports no unresolved identifier. `identity.js` 247/247.

---

## 1. The database now has one authority on what a run outcome means

`nexus_outcome_class(workflow, status, summary)` → `SUCCESS | PARTIAL | FAILURE | NO_RESULT | REJECTED_EXPECTED | ESCALATED | UNKNOWN`, with `v_workflow_health` rebuilt on it and `lib/health.js` mirroring it one-for-one on the frontend. No screen may interpret `audit_log.status` itself.

Three decisions are deliberate:
- **A refusal by design is not a fault.** `REJECTED_EXPECTED` is out of the success denominator, so an auth rejection cannot dilute a real miss rate.
- **A partial is not a success.** `PARTIAL` ⇒ DEGRADED.
- **The writers mislabel their own rows, and the layer corrects them.** Finance Calc and Master Router write `FAILED` on rows whose own summary reads *"N of M claimed steps did not land"*. Rule 1 corrects that from the structured phrase, and is marked temporary — fix the writers, then delete it from the SQL and `lib/health.js` together.

`REJECTED` could not be classified globally. Ask-AI's is *"Unauthorized request rejected"* — genuinely expected. Competitor Price Scraping's is *"no usable intel — no price could be extracted"*, 84 times. A blanket rule would have hidden an 87% miss rate behind a green pill, so a distinct state exists: **`PRODUCING_NOTHING`** — runs without failing, achieves nothing.

| workflow | dashboard showed | truth |
|---|---|---|
| Competitor Price Scraping | green **Clean, 30 d · 100.0%** | **PRODUCING_NOTHING**, ~12.5% |
| Finance Calc | **91.7%** | **DEGRADED ~11%** — and 5 rows are *"Quote issued \| finance_quotes row did not land"* |
| Customer 360 | 91.3% | **DEGRADED 39.1%** — 12 of 23 runs did not complete |
| WhatsApp BDC | not surfaced | **41.6%**, 166 failures (139 timeouts, 15 Model Ladder) |
| KYC/AML Auditor | — | **DEGRADED, 0 successes** |
| Retention Purge | — | **NEVER_RAN** |

Workflows reading DEGRADED went from **2 to 11**, plus one `PRODUCING_NOTHING`.

---

## 2. `response_time_minutes` — four defects that only failed together

The column read `0` on every lead, so `within_sla` counted everyone, `breached_sla` was always 0, and the five-minute rule the product is built around was structurally unenforceable.

1. A `BEFORE INSERT` trigger measured the first response **at the moment the lead row was created** — before any reply to that lead can exist. In production the bot answers first and the router mints the lead afterwards, so it reliably found a reply from the pre-lead conversation.
2. `greatest(0, …)` turned the resulting negative interval into *"answered in 0 minutes"* — a lie in the reassuring direction, which is why nobody saw it.
3. The correct `AFTER INSERT` writer already existed but was permanently locked out: its guard is `is null`, and 0 is not null.
4. `nexus_comm_keys_for_lead` **generates** the `+digits@whatsapp.lead` shape, but `nexus_lead_for_comm_key` could not match it — so a lead with a real email whose reply was filed under that shape resolved to nothing.

All four fixed together, the three poisoned rows repaired, and **nine regression assertions pass** — including the one the old code got backwards: never answered → NULL, not 0. Live: 34 → 1, 35 → NULL, 38 → 4.

**A correction I owe you.** I wrote in the repair migration that lead 35 reads NULL because *"nobody has ever replied to this lead"*. That is false, and an agent caught it by reading `pg_proc` instead of trusting my brief. Lead 35 **has** a reply — one outbound message **74 seconds before its own lead row existed**, preceded by nine inbound. The whole conversation happened before the router minted the lead. NULL means **not measured**, never *unanswered*; the column comment and ten render sites now say so. A dashboard telling a rep a customer was never contacted, when he was answered inside two minutes, is a worse lie than the 0 it replaced.

The audit was also wrong about lead 38: its first reply was **4.2 minutes**, not 81. The 04:02 row is the first under his real email; the genuine reply sits under `+918517942172@whatsapp.lead` and was invisible until the resolver was made symmetric.

---

## 3. The scraper was not comparing cars

Published to the production box and **verified byte-identical** against the local reference (sha256 `2bcfeac5…`), every regex escape intact.

- `competitors.model` was **our own** inventory string written back out, so the screen's "match" compared our string to itself and could never fail.
- The price was `Math.min` of every AED figure over 20,000 anywhere in the page's JSON-LD — no year, trim, mileage or condition. Our used 2.7 VXR at 152,000 was compared against toyota.ae's cheapest **new base** Fortuner at 128,900, and the screen printed **"+AED 23,100 · 17.9% above theirs"** in red.

Offers now carry their own name and condition and are ranked against our unit. On that same page the new logic picks the actual 2.7 VXR 2024 at 164,900 — **we are 12,900 below, not 23,100 above.** The sign of the business conclusion inverts. New columns record `listing_title`, `source_host`, `source_kind` (`oem`/`marketplace`/`dealer`), `offer_name`, `offer_condition`, `match_quality` and `match_note`; a `weak` match draws no conclusion at all.

`v_competitor_latest` gives one row per listing. **I did not take the audit's advice to upsert** — that would destroy the price history, which is the one thing this table is uniquely placed to hold. The defect was readers treating snapshots as listings, so the fix is at the read.

---

## 4. What each screen stopped asserting

**finance.js** — every derivation gone; `Math.pow` and every `(1+r)` term absent. Real `finance_quotes` column names wired (the old probe list contained **not one real name**, which is why the screen concluded the data was absent and modelled it itself). It also surfaces a state the audit had no slot for: a quote issued whose record was lost.

**overview.js** — *"Open leads"* was the unfiltered row count. *"Pipeline value"* rendered unknown as a large **AED 0**. The `answered` set counted `[SILENCE-ESCALATED]` markers — rows written *because* nobody replied — as proof somebody had. An aging unit read **"waiting just now"** beside its own *"148 days in stock"*.

**settings.js** — `CRED_VERIFIED` deleted: Gmail showed green on a **date hard-coded in the source**, and stayed green because the panel read only `FAILED` and so could not see eight `PARTIAL` rows saying *"Gmail read failed"*. There is no green credential state left.

**lib/integrations.js** — a **502 painted green** because the probe returned instead of throwing. The Finance Calc probe is removed: it fired a real business execution on every Settings mount. (Its true share was **16 of 60 runs, not 52** — the audit's number was wrong and is not repeated in the code.)

**campaigns.js** — it told an operator in red that the drip *"has no reply-detection step"*; the workflow has **four** gates that stop it. It printed *"No drip run has ever been logged"* beside its own list of five. It said *"no mail-credential failure is recorded"* while holding nine.

**compliance.js** — the previous pass had left this auditor-facing screen **asserting a fix it had not made**, which is worse than the original defect. One canonical source per fact now, eleven retention states, and a vocabulary defect the audit missed: `verdict` is `NOT NULL DEFAULT 'PENDING'`, so `!d.verdict` was permanently false and PENDING rows sat under no tab.

**team.js** — *"Pipeline in rep hands"* summed every lead ever assigned, dead ones included. The SLA panel no longer asserts a result the column cannot support.

**leads.js / lib/lead-drawer.js** — one shared identity rule. The drawer passed no candidate pool, so it could never detect a last-nine-digit collision and would merge two customers' messages in the drawer opened from the row where leads.js had just refused to. A live *Start drip* button would have posted `+971547484167@whatsapp.lead` at a Gmail node.

**conversations.js** — a send repainted the strip while a red collision chip still described the previous read. The row displayed a borrowed name and a key-derived number but was searchable by neither: typing "Ali" made the row you were looking at vanish.

**customers.js** — the pane captioned *"Run that wrote it"* under the **wrong run**: one profile's figures were stamped 31 Aug while the newest run naming that customer was 28 Aug, so a *"Gmail read failed"* note sat under numbers written three nights later.

**inventory.js** — the drift alert diagnosed *"the nightly recompute has not run"* regardless of what actually differed; raising one list price produced that sentence six hours after a clean run. Band and margin were compared on undated units the recompute never touches, raising a CRITICAL beside four cells reading "—".

**deals.js** — the header asserted a live figure that was false (`purchase_history` holds 0 rows, not 1). Two PostgREST caps were presented as totals.

**automation.js** — consumes the canonical layer; no status literal survives in logic.

**ask.js** — grounding metadata is finally read. A fabricated citation used to arrive pre-validated: a model shown S1–S13 that wrote `[S14]` got a real document title rendered under it. Four SEVERE triggers now, and `DECLINED` is its own state rather than an amber warning over a correct refusal.

**lib/format.js** — `TONE` was missing seven values and contradicting three; `PARTIAL`, `FAILURE` and `PRODUCING_NOTHING` — three faults — painted neutral grey.

**lib/badges.js** — the badge read **17** where the panel listed **13**, counting one car four times. Both read 13.

---

## 5. The failure mode this pass kept hitting

Five interrupted agents left a **deleted identifier with live call sites** — `MAILBOX_RE`, `NO_CANCEL_HOOK`, `missed`, `pipelineOf`, `renderIntegrations`, `rateOf`. Every one sat inside a function body, so **every file parsed** and each screen threw only at runtime, in exactly the state it existed to handle. Every agent in the later waves was told parsing is not evidence, and each one found its predecessor's.

The same shape appeared in prose: a screen explaining a defect that had since been fixed, or asserting a fix that had not been made. Both are now checked as part of the work rather than assumed.

---

## 6. Still open

**Yours**
- Push the branch. The session's git proxy refuses this repo; adding it to the session's sources ends the patch-passing for good.
- Two workflows still paused from the J1 run: `B3TcpfzOMWj8oWgF` (Silence Detector), `57QpbNQGwlFKb0q3` (Infra Probe).
- A GCP budget alert before the $30 credit runs out.

**Next**
- **Fix the writers.** Finance Calc and Master Router labelling partials as `FAILED` is what forces rule 1 to exist. When they are correct, delete it from both sides.
- **`lib/unit-form.js`** — `deriveUnit()` cannot express "unknown" and returns a plausible zero; it writes 75-day banding back on every save; and it counts days in the browser's timezone while Postgres uses `Asia/Dubai`.
- **`lib/identity.js`** — `quoteValue` escapes `"` and `\` but not `%` and `_`, so a wildcard can still leak into a PostgREST filter. Defended at one call site; it belongs in the module.
- **Three view-level defects** flagged by the customers agent need DDL.
- **Cross-module regression**: Lead → Conversation → Customer 360 → Compliance → Deal. A screen rendering is not a pass.
- **J1 stays on hold** until that regression passes.
