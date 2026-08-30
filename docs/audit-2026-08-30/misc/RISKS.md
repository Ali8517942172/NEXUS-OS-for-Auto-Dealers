# RISKS, UNVERIFIED ITEMS, PRE- AND POST-APPLY CHECKS

Companion to `DESIGN.md`. Nothing here was applied to a live system; no n8n,
Supabase or device tool was called. The only source of truth was the export under
`/home/claude/audit/` (`n8n-workflows/_index.json` exported
**2026-08-30T04:12:20Z**).

**The one thing that is applied:** `screens/automation.js` was edited in place
(defect 4). Everything else is a file waiting for a human.

---

## 0. Applies to every n8n change in this set

| # | check | why |
|---|---|---|
| **G1** | Re-export or `get_workflow_details` and compare against the 04:12:20Z export **before** applying either OPERATIONS file. | Both files contain whole-`jsCode` / whole-parameter replacements. If anyone has edited `Decide: Re-ask or Escalate`, `Build Apify Query`, `Log Competitor Intel`, `Slack: KYC Escalation` or `Log KYC Escalation` since the export, applying silently reverts their change. This is the single most dangerous property of both files. |
| **G2** | Substitute `<<SUPABASE_CRED_ID>>`. | `OPERATIONS_kyc.json` adds a node carrying the literal placeholder. Applied as-is, the node 401s on every rejection — which, because the fix fails closed, means **every** KYC rejection escalates to Slack instead of asking the customer again. Loud, not silent, but wrong. |
| **G3** | Both workflows are `active: true` and `published: true`. Decide whether to apply during showroom hours. | A KYC upload or the 05:00 scrape can land mid-apply. `update_workflow` is atomic, but an execution already in flight runs the old graph. |
| **G4** | `update_workflow` operation-type names (`removeNode`, `setNodeSettings`, `setNodeParameter`, `setWorkflowSettings`, `addConnection`/`removeConnection`) were taken from the tool schema, not from a successful call. | A rejected array applies nothing, so the failure mode is safe — but budget for one round of correction. |

---

## 1. SLA meter — `sla_migration.sql`

### Could not be verified from the repo

| # | unknown | consequence |
|---|---|---|
| **S1** | **`v_needs_attention` is not defined anywhere in this repository** (`security/fix_rls.sql` §5 states this). Its `sla_breach` predicate is a guess. | If it is `response_time_minutes > 5` this works the moment values appear. If it compares something else, or is `>= 5`, or filters on `status`, the breach count will not match `screens/leads.js`. **Read the view before running this.** |
| **S2** | Whether `leads.response_time_minutes` exists live, and its type. | `add column if not exists … integer` is a no-op if it exists. If it exists as `numeric`, the `::integer` cast still assigns cleanly. If it exists as `text`, the update fails — check first. |
| **S3** | Whether `public.whatsapp_contacts` exists, and whether it reliably carries `lead_email`/`phone`. | Guarded with `to_regclass`, so the file installs either way. But if it is empty or sparse, **`…@lid` customers cannot be resolved at all** and their leads stay `NULL`. This is the largest coverage hole in the design and it is not closable from here. |
| **S4** | Whether RLS or a Supabase-managed trigger already exists on `leads` / `communication_logs` with a conflicting name. | Trigger names are `trg_comm_logs_first_response` and `trg_leads_backfill_response`, both `drop … if exists` first. |
| **S5** | How much of `communication_logs` `nexus_retention_purge` has already deleted. | Determines how much §6 can back-fill. Nothing else. |

### What could break

* **R1-1 — the back-fill writes a number somebody disagrees with.** §6 is
  optional and clearly marked. It only touches `NULL` rows. If the result looks
  wrong, `update public.leads set response_time_minutes = null where …` undoes
  it; the triggers will re-measure future traffic regardless.
* **R1-2 — a wrong identity match attributes a reply to the wrong lead.** The
  resolver's riskiest branch is *phone digits*: two leads sharing a number, or a
  number stored with and without a country code, resolve to `order by created_at
  limit 1` — the oldest. Consequence is a plausible-looking wrong number on one
  lead, and it is not self-correcting. **Run the resolver as a SELECT over
  existing data before installing the triggers** (see post-apply below).
* **R1-3 — insert latency on `communication_logs`.** Every outbound insert now
  runs a `plpgsql` resolver. `leads` is small (dozens of rows) and the partial
  index `idx_leads_unmeasured_email` shrinks toward nothing as leads get
  measured, so this should be sub-millisecond — but it is on the write path of
  the BDC agent's reply, which is inside the customer-visible latency budget.
  Measure it if reply latency is already tight.
* **R1-4 — `SECURITY DEFINER`.** Four functions run as their owner. They are
  `revoke`d from `public` and only the two read-only helpers are granted to
  `service_role`. Trigger functions do not require `EXECUTE` to fire. Confirm the
  owner is not a superuser role you would rather not lend out.
* **R1-5 — the "never answered" case is still invisible**, by design. A lead with
  `response_time_minutes IS NULL` and no reply raises nothing. §7 of the SQL
  names the branch that would close it; it needs the live view.
* **R1-6 — the drip counts as a reply.** A COLD lead's Day-1 drip email stops the
  clock. That is deliberate (it genuinely is the first response) but it means the
  average-response KPI will mix a 3-second bot reply with a drip send that may be
  minutes or hours later. If the dealership means "human or bot *conversational*
  reply" only, exclude `message like 'Drip Day%'` in `nexus_is_reply` — one line,
  and the reasoning is already written where it belongs.

### After applying — check these

1. **Dry-run the resolver before the triggers.**
   `select c.lead_email, public.nexus_lead_for_comm_key(c.lead_email) from public.communication_logs c group by 1;`
   Every distinct key should resolve to a lead or to `NULL`. A key resolving to a
   lead whose email is obviously a different person is R1-2 and must be fixed
   before the triggers go on.
2. Send one real WhatsApp message to a *new* number, let the BDC agent reply, and
   confirm the new lead lands with a small non-null `response_time_minutes` —
   this exercises **trigger B**, the ordering race, which is the half most likely
   to be wrong.
3. Send a second message on the same thread and confirm the value **does not
   move**.
4. Let the silence detector fire once (or insert its row by hand) and confirm it
   does **not** set the column on an unanswered lead. This is the S-tier
   regression: getting it wrong stamps ≈720 minutes on the worst leads.
5. Overview's average-response KPI and `leads.js`'s breach banner should both
   stop saying "null on every lead". If `sla_breach` still never fires while
   values above 5 exist, that is S1.

---

## 2. KYC retry cap — `OPERATIONS_kyc.json`

### Could not be verified from the repo

| # | unknown | consequence |
|---|---|---|
| **K1** | **`kyc_documents` has no `CREATE TABLE` anywhere in this repo.** Its columns are inferred from what `Record KYC (Approved/Rejected)` writes and what `screens/compliance.js` (`select=*`, `order=created_at.desc`) and `screens/overview.js` (`select=…,verdict,created_at,…,attempt_number,max_attempts`) read. | If `created_at`, `verdict`, `attempt_number` or `chat_id` is absent or named differently, PostgREST returns **400** and — because the fix fails closed — **every rejection escalates to Slack**. Confirm all four column names before applying. This is the highest-probability failure in this file. |
| **K2** | Whether n8n's expression engine accepts the multi-line IIFE with block comments in the `or` query parameter. | `Fetch Thread History` in the BDC agent proves the single-line form works. The multi-line form with `/* */` is valid JS but was not executed. If it fails, collapse it to one line. |
| **K3** | Whether `retryOnFail: true, maxTries: 3` on an HTTP node whose failures are mostly 400s is wasteful. | A 400 will 400 again. Costs ~3 s per rejection. Kept for parity with the node it replaces. |
| **K4** | Whether the 90-day `created_at` window matches how the dealership actually onboards. | Too short → a slow customer gets a fresh three attempts mid-onboarding. Too long → a returning customer starts exhausted. 90 days is a judgement, and it is the one number here most likely to be wrong for this business. |

### What could break

* **R2-1 — it now fails CLOSED, and closed means Slack.** Any Supabase outage,
  any 400 from K1, any bad credential from G2 sends every rejection straight to
  `Slack: KYC Escalation`. That is the intended trade — the alternative is the
  infinite loop — but it converts a silent data bug into visible Slack noise.
  Watch `#`-the-KYC-channel for the first 48 hours.
* **R2-2 — the escalation branch sends the customer NOTHING.** `Within Retry
  Limit?` false routes only to Slack. A customer whose count could not be read
  gets silence, and nothing tells them a human is coming. **This is pre-existing
  behaviour, not introduced here**, but this change makes it reachable in a new
  way. It is worth fixing separately: a one-line WhatsApp "a colleague will
  contact you shortly" on that branch.
* **R2-3 — the count is one lower than reality if `Record KYC (Rejected)`
  swallowed.** That node is `onError: continueRegularOutput`, so a Supabase blip
  loses one row and the customer gets one extra attempt. Bounded, and vastly
  better than resetting to zero. Not fixed here.
* **R2-4 — identity keys containing `,` `(` `)` `"` or whitespace are dropped**
  by the expression rather than sent, because they would break out of the
  `or=(…)` list. No real chat id or address contains one. If a lead_email ever
  does, that person's attempts read as 0 — silently. Consider a Postgres-side
  RPC instead of `or=(…)` if that ever happens.
* **R2-5 — a stale label.** `Delivery Report (KYC Escalation)` and
  `Delivery Report (KYC Rejected)` still describe the claim as *"previous-attempt
  count read from communication_logs"*. Deliberately **not** patched: fixing one
  string means replacing two long `jsCode` blocks, and G1 says that is the
  riskiest kind of edit in this set. Cosmetic only; fix it next time either file
  is being touched for a real reason.

### After applying — check these

1. **The WhatsApp-only customer, which is the whole point.** Reject the same
   document three times from a chat id with no email on file. Expect
   "Attempt 1 of 3", "2 of 3", "3 of 3", then escalation — not "Attempt 1 of 3"
   four times.
2. Confirm `kyc_documents` gained one row per rejection with `attempt_number`
   1, 2, 3 and `verdict` `REJECTED, REJECTED, ESCALATED`.
3. **Force the failure.** Point the new node's URL at a bad table for one run.
   Expect: escalation to Slack, Slack text saying the count could not be read
   (not "0 of 3"), and an `audit_log` row with status `ESCALATED_PARTIAL` whose
   summary names `kyc_documents.attempt_number` as the source.
4. Open the dashboard's Automation screen and confirm that `ESCALATED_PARTIAL`
   row is now **amber with a "Never reached the customer" chip**, not green. That
   single check closes defects 2 and 4 against each other.
5. Confirm a customer with a real email still counts correctly — the `or=(…)`
   set must not have broken the case that already worked.

---

## 3. Competitor scrape — `OPERATIONS_competitor.json`

### Could not be verified from the repo

| # | unknown | consequence |
|---|---|---|
| **C1** | **The real fleet size.** The brief says 16 units; `Build Apify Query`'s own comment says twelve. `BATCH_SIZE = 8` × 2 runs/day covers 16 exactly. | If the fleet is materially larger than 16, coverage silently stretches — 24 units take 36 hours per cycle. Re-do the arithmetic in the node's comment; do not just raise the ceiling. |
| **C2** | Whether n8n's `httpQueryAuth` merges cleanly with `sendQuery` parameters on the Apify node. | The Apify credential appends `?token=…`. Adding `timeout=40` via `sendQuery` (rather than editing the URL string) is the safer of the two, but it was not executed. If Apify 401s after applying, drop the `queryParameters` op — it is a cost optimisation, not part of the throughput fix. |
| **C3** | Whether Apify's `run-sync-get-dataset-items` honours `timeout=40`, and what it returns on timeout. | Worst case it returns a partial dataset, which `Parse AI Price` already handles as "no price". |
| **C4** | Whether **45 s is enough** for `apify~rag-web-browser` with `maxResults: 3`. | If most scrapes legitimately need 60–90 s, this trades "2 of 16 units" for "8 units that all time out" — a *different* silent failure with the same shape. **Measure one real scrape's duration before committing to 45 s.** This is the assumption most likely to be wrong. |
| **C5** | Whether the `competitors` table's `scraped_at` has a `DEFAULT now()`. | No repo SQL defines the table; `screens/competitors.js` records the column as existing (live read, 24 Aug 2026). Writing it explicitly is correct either way. |
| **C6** | Whether `inventory.status` uses the literal `'sold'` (case-insensitive) that the skip test matches. | `recompute_inventory_derived()` in `supabase/2026-08-14_…sql` uses `lower(coalesce(status,'')) = 'sold'`, so the same test is used here. If some other word means sold, those units keep consuming scrape slots — wasteful, not wrong. |
| **C7** | The instance's server-side maximum for `executionTimeout`. | 1200 s is rejected if `EXECUTIONS_TIMEOUT_MAX` is lower. The op fails loudly; nothing is applied. |

### What could break

* **R3-1 — the three numbers are a system and must move together.**
  `BATCH_SIZE (8) × per-unit worst case (~95 s) ≈ 760 s < ceiling (1200 s)`.
  Change the batch, either request timeout, the retry counts, or the schedule
  interval, and the run can start being truncated again — which looks like
  success, because that is exactly how this defect hid.
* **R3-2 — `SLOT_HOURS = 12` must match the cron.** The rotation offset advances
  every 12 hours and the schedule is `0 5,17 * * *`. If someone changes the cron
  to hourly and not `SLOT_HOURS`, the same 8 units are scraped every hour and the
  other 8 are never scraped at all — silently.
* **R3-3 — rotation drifts when the fleet changes size.** The offset is
  `(slot × 8) mod fleetSize`. Adding or selling a unit shifts the ring for one
  cycle, so a unit can be skipped or repeated once. Acceptable; a unit is missed
  for at most one extra half-day. The alternative — ordering by a real
  `scraped_at` staleness read — needs a second Supabase read and only becomes
  possible now that `scraped_at` is actually written. Worth revisiting in a month.
* **R3-4 — Apify cost.** Two runs a day × 8 units = 16 scrapes/day, the same as
  the once-nightly design *intended*. But it is roughly **8× what is actually
  being spent today**, because today's run dies after ~2 units. Expect the Apify
  bill to rise to what the design always implied. Say so before applying.
* **R3-5 — an errored Apify item is still sent to the AI.** With Apify on
  `continueRegularOutput`, a failed scrape flows into `Extract Price with AI`,
  which builds a prompt out of an error object and spends a token call to learn
  nothing. Not fixed here (it would need another IF node); it costs money, not
  correctness, and `Parse AI Price` already discards the result.
* **R3-6 — `retryOnFail: false` on Apify.** A genuinely transient network blip
  now loses that unit for half a day instead of retrying. Deliberate: the retry
  cost 120 s of a 300 s budget and mostly re-fetched pages that were blocked, not
  flaky.

### The dead branch — `OPERATIONS_competitor_dead_branch.json`

* **R3-7 — this file is the only destructive change in the set.** It removes
  three nodes. They have never executed, so nothing regresses, and the full
  definitions remain in
  `/home/claude/audit/n8n-workflows/competitor_price_scraping_supabase_update.json`.
  Do not apply it in the same call as the throughput fix — apply, verify the
  scrape, then decide.
* **R3-8 — do NOT wire it up instead.** `Build Update Payload` sets
  `price = Math.max(0, competitorPrice − 1)`: no floor at `cost_aed`, no holding
  cost, no VAT, no commission, no cap on the size of a single move — and the
  input is a scraped price from a source that has previously been `google.com`
  and a bot-detection interstitial. See `DESIGN.md` §3.3.

### After applying — check these

1. Run it manually **once** and record the wall-clock duration. It must be
   comfortably under 1200 s. If it is near it, C4 was wrong.
2. `select count(*), min(scraped_at), max(scraped_at) from competitors where scraped_at > now() - interval '1 day';`
   — expect 8 rows or fewer per run (some units legitimately fail the
   `Is This Real Intel?` gate) and a **non-null** `scraped_at` on every one.
3. Confirm the Competitors screen's freshness display stops reading "—".
4. Over 24 hours, confirm every non-sold unit appears at least once. If some
   never do, that is R3-2 or R3-3.
5. Check `audit_log` for this workflow: `PARTIAL` rows are expected and normal
   (a page that failed the guard). They should now be visible on the Automation
   screen rather than green.

---

## 4. `PARTIAL` renders green — `screens/automation.js` (APPLIED)

### What was verified

`node --check` passes. Nine edit sites, all asserted unique before replacement
(the script aborts rather than half-applying). `lib/format.js`, `lib/badges.js`
and every other dashboard file are untouched, per the coordination constraint.

### Could not be verified

| # | unknown | consequence |
|---|---|---|
| **A1** | It was not rendered in a browser. No screenshot, no live `audit_log`. | A template-literal nesting error would have failed `node --check`; a CSS class that does not exist would not. `banner warm`, `t-warm`, `--cold` and `tl-dot` were each confirmed present in `styles.css`. |
| **A2** | The exhaustive list of statuses `audit_log` actually holds. | `STATUSES` now covers `SUCCESS, PARTIAL, FAILED, REJECTED, ESCALATED, ESCALATED_PARTIAL, ESCALATED_FAILED`. Anything else still lands in "Other" — but its dot is now `cold`, not green, so a new unknown word can no longer masquerade as a pass. |
| **A3** | Whether any other screen paints `PARTIAL` green. | `grep` found `PARTIAL` in no other dashboard file, and `TONE` has no entry for it — so elsewhere it renders as the grey `unknown` pill, which is honest. Not re-checked against the other agent's in-flight edits. |

### What could break

* **R4-1 — the "Other" chip's count changes.** Three statuses moved out of it. If
  a saved filter or a screenshot in a runbook refers to an "Other · N" figure, N
  is now different. This is the change working.
* **R4-2 — the failure banner is unchanged and a second banner appears beside
  it.** `failedCount` still counts only literal `FAILED`, deliberately: a run
  that broke and a run that completed without reaching a customer are different
  findings with different owners, and this screen's stated discipline is that two
  findings never share a colour. If somebody expected one combined number, they
  will need telling.
* **R4-3 — merge conflict.** Another agent is editing dashboard files. If they
  touch `automation.js` after all, this is a nine-site edit spread across
  ~250 lines and will need re-application by hand.

### After applying — check these

1. Load the Automation screen against real `audit_log` data. Confirm a `PARTIAL`
   row's timeline dot is **amber**, its Status cell carries *"The run finished;
   the customer-facing step did not land"*, and the amber banner appears with a
   working "Show them" button.
2. Click the **"Never reached the customer"** chip and confirm it selects
   `PARTIAL`, `ESCALATED_PARTIAL` and `ESCALATED_FAILED` and nothing else.
3. Confirm `ESCALATED_FAILED` shows a **red** dot (its delivery half is FAILED)
   while `ESCALATED_PARTIAL` shows amber.
4. Confirm an ordinary `SUCCESS` run is still green and that the "Hit the
   ceiling" filter still works — the timeout reading sits above the new one in
   the same ternary chain.
5. Confirm no row anywhere on the screen renders green that is not `SUCCESS`.
