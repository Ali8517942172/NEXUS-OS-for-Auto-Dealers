# CONTROL-PLANE.md Part 7 — the frontend half

Written 5 September 2026, against `apps/executive-dashboard` on branch
`wip/platform-truth-2026-09-01`. Repo-only: no git command was run, the
production n8n box was not touched, and the database was not touched.

---

## 0. What was verified, and what could not be

**Verified by execution:**

| What | Command | Result |
|---|---|---|
| The bundle builds | `npm run build` (in `apps/executive-dashboard`) | **exit 0**, `✓ built in 2.18s`, `dist/assets/main-fidxVxpS.js 1,365.16 kB`. The two warnings printed (`lib/data.js is dynamically imported…` and the 500 kB chunk-size note) are pre-existing and appear on an unmodified tree. |
| Every touched file parses | `node --check <file>` on all 10 | 10/10 OK — `screens/automation.js`, `settings.js`, `campaigns.js`, `team.js`, `ask.js`, `compliance.js`, `finance.js`, `conversations.js`, `leads.js`, `lib/integrations.js` |
| The gate | `node QUALITY_GATE.mjs` (read, never edited) | **PASS 18, FAIL 0, WARN 1, NOT RUN 16.** R0–R7 (the headless-render lane) all PASS: 20/20 screens render, 0 page errors, 130 PostgREST calls, 0 rejected. The one WARN is `S5b` on `screens/actions.js:637`, which this pass did not touch and which was warning before it. The 16 NOT RUN are the LIVE lane (`L1`–`L12`, `B1`–`B4`), which needs `NEXUS_DB_URL`; the brief forbids touching the database, so they stay unrun. |
| The three changed screens, rendered | a throwaway Playwright harness (`/tmp/…/scratchpad/probe.mjs`, run from the app dir and **deleted from the repo afterwards**) serving `dist/` against a stub PostgREST | 0 page errors; text captured and quoted in §3 below |

**The stub is a stub.** The render evidence was taken against a hand-written
PostgREST stub serving a `v_workflow_health` shaped exactly as migration
`20260905194717` left it — 25 columns, **no `id`, no `trigger_type`, no
`trigger_detail`** — plus one deliberately vendor-leaking `audit_log.summary`
(`… · Failed at node: Model Ladder · Execution 3213 ·
https://35.224.126.225.nip.io/workflow/BiyHk9ZXxJUVGbf6/executions/3213`).
That proves which branch the code takes and what it prints. It does **not**
prove anything about live data.

**What I could not verify, stated plainly:**

- **No browser against the live site.** Nothing here is evidence about what a
  real signed-in Tenant A session renders today. Two things in particular are
  unverified against production: that `authenticated` really does now get a
  `v_workflow_health` without the three columns (I read the migration; I did not
  read the live catalogue), and that no *other* row of live data carries vendor
  strings my redactors do not match.
- **The redactors are pattern matches, not a guarantee.** `dealerSummary` /
  `dealerText` strip URLs, `Execution <n>`, `Failed at node: <x>`, `node: <x>`
  and dotted-quad hosts. A workflow that writes a vendor detail in some other
  shape will still print it. This is a containment measure at the render site,
  not a fix at the writer.
- **Visual layout.** The Environment card became a three-row Connection card and
  the endpoint chip list became one sentence. Nothing checked how those look.
- **The live n8n box, the workflow definitions on it, and the database** were
  not consulted at all.

---

## 1. The false absence (task item 1)

`workflow_registry.id`, `.trigger_type` and `.trigger_detail` were withheld from
`authenticated` by column grant tonight, and `v_workflow_health` was rebuilt
without them. Six code paths in `screens/automation.js` read
`w.trigger_detail`; every one now finds nothing. What the screen said about that
was false in four separate places.

| file:line (new) | was | is |
|---|---|---|
| `screens/automation.js:1352-1358` (branch) | `No schedule this screen can read` / *"None of the N registered workflows records a cadence in trigger_type or trigger_detail that can be parsed … **Recording the real cron expression in workflow_registry.trigger_detail is what turns this panel on.**"* | new `!triggerVisible` branch: `Schedules are operated by NEXUS` / *"NEXUS operates the trigger and the schedule for every workflow here, and this dashboard is not permitted to read either. That is a boundary, not a gap: the cadence is on file, it is simply on the vendor's side of it. Nothing on this screen is waiting for you to enter one."* The old "no cadence I can parse" branch is **kept** below it, for the case where the columns are readable and genuinely empty. |
| `screens/automation.js:1491` (old) | `<span class="chip">${w.trigger_type \|\| 'trigger not recorded'}${w.trigger_detail ? ' · ' + w.trigger_detail : ''}</span>` — on every workflow row | chip removed. The sentence is said once, on the Scheduled jobs card, not eighteen times. |
| `screens/automation.js:1668` (old) | drawer subtitle `${w.category} · ${w.trigger_type \|\| 'trigger not recorded'}${w.trigger_detail ? …}` | `${w.category \|\| 'Uncategorised'}` |
| `screens/automation.js:529` | `'Its trigger is not recorded in workflow_registry'` in every disabled **Run now** tooltip | *"Which endpoint starts it is configuration NEXUS operates and this dashboard cannot read, so there is no address here to call… NEXUS support can start it by hand if you need it run."* The genuine "the register recorded nothing" wording is retained behind `triggerReadable(w) && !w.trigger_type`. |

**The mechanism, at `screens/automation.js:181`:**

```js
const triggerReadable = w => w != null && ('trigger_type' in w || 'trigger_detail' in w);
```

It tests key **presence**, not truthiness, and `triggerVisible` (line ~966) is
`rows.length > 0 && rows.some(triggerReadable)`. Three consequences, all
deliberate: a row carrying `trigger_type: null` is still "the register recorded
nothing", which is a different finding; an empty result set is "the view
returned nothing", which is a third; and if a tenant-scoped view ever restores
the columns, the cadence panel lights up again by itself instead of going on
saying "not available".

**Vocabulary.** No new vocabulary was invented. The screen prints the em dash +
words that `screens/compliance.js` already uses for an unreadable figure, and
the sentence follows the existing family — `lib/health.js`'s *"This workflow
does not write to the audit log, so its health is unknown — not good"* and
`lib/errors.js`'s rule that an absence never renders through the error path.
`NOT_AVAILABLE` as a **token** belongs to `tenant_capability` in the database
and reaches no screen in this bundle (`grep` across `screens/` and `lib/`:
zero hits), so importing the literal here would have been a new vocabulary, not
the existing one. The state is named `TRIGGER_NOT_AVAILABLE`
(`screens/automation.js:183`) for the reader of the code.

---

## 2. The vendor-boundary sweep (task item 2)

### 2a. Everything CONTROL-PLANE.md Part 5 named

| CONTROL-PLANE.md | file:line then → now | was | is |
|---|---|---|---|
| **5.1** | `settings.js:1402` → `:1432` | *"the register is the platform's: **one n8n instance serves every dealership** … The n8n instance also carries the three published workflows that serve NEXUS's public home, privacy and terms pages — Google requires all three before an OAuth consent screen can go to production, and it rejects vercel.app as a public suffix — so a count taken in n8n is larger than the count here."* | *"This list is the register of the automations NEXUS runs for you. Every count beside them is this dealership's alone… A few entries are pages NEXUS publishes rather than automations."* |
| **5.2** | `automation.js`, `settings.js`, `ask.js` registry consumers | — | already narrowed to `select=name,audit_name,audit_aliases` by an earlier agent; verified, left alone. The **rendering** of `id`/`trigger_*` is what §1 removed. |
| **5.3** | `settings.js:596-601` → `:617-642` | `Supabase project` / `Supabase URL` / `n8n base` / `Build mode` / `Served from`, plus three build-time variable names each with a set/missing line | a three-row **Connection** card: `NEXUS data`, `Automation`, `Credentials`, each `configured` or a red not-configured line. The *consequence* of a missing value (`ENV_VARS[].dead`) survives in a red banner; the variable name and the value do not. |
| **5.3** | `settings.js:644-646` → `:672-681` | `${N8N_BASE}/webhook/${p}` as a mono chip, once per endpoint | *"8 of them: asking a question of your documents, calculating finance, enrolling a customer…"* plus *"Their addresses are not shown: where an automation lives is NEXUS's operational configuration."* |
| **5.3** | `settings.js:649` | *"`ask-ai` spends **OpenRouter** tokens, and `finance-calc` writes a row to `audit_log` … which is how the tiles above came to manufacture most of that workflow's logged runs before that probe was removed on 31 Aug"* | *"calling one to see whether it answers does real work, and a check that enrols a real customer or bills a real run is not a check."* |
| **5.4** | `automation.js:139-151`, `:2124`, `:2268` | `EXEC_URL_RE` parsed the n8n execution URL out of the summary and rendered a working **deep link** into the vendor's n8n on every failed run | the same regex now **removes** that text (`dealerSummary`, `automation.js:200`). The link is gone; a disabled **Inspect this run** control (`:2295`) replaces it, saying to quote the workflow and time to NEXUS. |
| **5.4** | `automation.js:1485` | trigger chips (cron / webhook path) | removed — §1 |
| **5.4** | `automation.js:281-305`, `:1218` | the nip.io / Google-OAuth / `vercel.app` explanation, twice | *"pages NEXUS publishes… A page view is not a workflow run"*. The `PUBLIC_PAGE_HOOK_RE` arm of `isPublicPage` (`automation.js:350`, `settings.js:167`) was deleted too — it tested `trigger_detail` and would have silently matched nothing. |
| **5.4** | `automation.js:424` | *"every call **spends OpenRouter tokens**"* | *"a question to answer."* |
| **5.4** | `automation.js:441-442` | *"**VITE_N8N_BASE_URL** is not set in this deployment"* | *"Manual runs are not available in this deployment… That is a NEXUS-side setting."* (`:509`) |
| **5.4** | `automation.js:2145` | run drawer printed raw `audit_log.summary` verbatim | `dealerSummary(a.summary)`; the activity-log Summary cell and its search box go through the same function |
| **5.5** | `lib/integrations.js:134` → `:147` | `['Finance Calc', 'WhatsApp (WAHA)', 'Bitrix24', 'Slack', 'Gmail', 'OpenRouter']` | `['Finance calculations', 'WhatsApp messaging', 'CRM sync', 'Team notifications', 'Email delivery', 'AI answers']` |
| **5.5** | `lib/integrations.js:150` | *"Runs a real query — **spends tokens** and logs a run"* | *"Runs a real query and records it, like any other"* |
| **5.6** | `ask.js:750` | *"The reply names {model} … whether the primary tier answered or the workflow had already dropped to its **backup ladder**"* | *"The reply carries no marker saying how it was produced, so this screen cannot confirm the answer came from the intended path. Judge it on the grounding above, which is checked rather than claimed."* |
| **5.6** | `ask.js` meta line | `model ${model}` | dropped from the meta line (`const model` is left assigned, with the reason in a comment, so a reviewer sees the deletion) |
| **5.6** | `ask.js:1113` | *"no **model tier** having answered at all"* | *"nothing having answered at all"*; `'Both model tiers failed'` → `'No answer was produced'` |
| **5.7** | `campaigns.js:1094` → `:1149` | ``detailHtml: `A workflow recorded this: <span class="mono">${top.detail}</span>` `` — the verbatim n8n error, which names the credential | *"The connection this campaign sends email through is not working, and NEXUS is the only one who can restore it. What broke it, and where it is fixed, is on NEXUS's side."* The **title** above it already carried the dealership's whole half (*"Email delivery is broken right now — every 'Enrolled' row on this screen means queued, not delivered"*) and is untouched. |
| **5.8** | `settings.js:112-113` → `:115` | *"Reconnecting a credential is done in the **n8n UI under Credentials** — n8n exposes no browser-reachable endpoint for it, there is no webhook in HOOK for it, and its API key must not ship inside this bundle"* | *"Reconnecting this is NEXUS's to do — there is no way to do it from this dashboard, by design."* |
| **5.8** | `team.js:195-198` → `:202` | `NO_INVITE` listed **every deployed webhook path** — `(ask-ai, finance-calc, lead-trigger, deals/closed-won, audit-kyc, erp-sync, lead-escalation)` — plus the table and its RLS posture | *"Inviting somebody is not built yet. Ask NEXUS to add the account and it will appear here."* `NO_ROLE_WRITE` and `NO_DELETE` given the same treatment. The controls stay **rendered and disabled**, per Part 4's own clarification and gate check R7. |
| **5.8** | `automation.js:2145` | (see 5.4) | done |
| **5.8** | `lib/tenant.js:49` | — | left exactly as it is. CONTROL-PLANE.md records it as *currently safe* and the safety is the policy's; nothing in the UI changes that either way. |

### 2b. Named by CONTROL-PLANE.md and already gone before this pass

- **5.2's consumer list.** `screens/ask.js:1444`/`:1611`, `screens/settings.js:756`
  and `screens/automation.js:797` already read
  `workflow_registry?select=name,audit_name,audit_aliases`. An earlier agent had
  narrowed them and written the reasoning into `automation.js` (*"Keyed on
  `name`, not on the n8n workflow id"*). Nothing to do.
- **5.9's four negatives still hold** as far as this pass can see: no other
  dealership is named, no secret is rendered, no NEXUS revenue figure appears,
  no cross-dealer benchmark exists.

### 2c. Leaks CONTROL-PLANE.md missed — found by rendering, not by reading

1. **`screens/compliance.js` prints raw `audit_log.summary` verbatim, in two
   places** (`:1640` retention ledger, `:2523` KYC activity trail). The document
   audits nine files and compliance is not one of them. Proved by rendering: a
   failed KYC run rendered
   `… Scrape failed · Failed at node: Model Ladder · Execution 3213 ·
   https://35.224.126.225.nip.io/workflow/BiyHk9ZXxJUVGbf6/executions/3213`
   on the Compliance screen — a node name, an execution id, a workflow id, a
   host **and the VM's bare public IP**, five Part 4 items on a screen the audit
   called clean. Fixed with the same `dealerText` redactor (`compliance.js:352`);
   now renders *"Scrape failed · failed inside the automation"*.
2. **`screens/campaigns.js:2074`** rendered raw summaries the same way. Same fix
   (`campaigns.js:449`).
3. **5.1's sentence exists on a second screen.** `automation.js:1520` carried
   *"the register is the platform's and is the same catalogue for every
   dealership on it, because **one n8n instance serves them all**"* — the
   identical disclosure the document pins only to `settings.js:1402`. Rewritten.
4. **`compliance.js:251` `NO_DECISION_HOOK`** — the same class as team.js's
   `NO_INVITE`, and not listed: *"kyc_documents is service-role only, and the
   audit-kyc webhook audits a document"*, on a disabled button's tooltip.
5. **The probed integration tiles were named after the suppliers.** 5.5 catches
   the `unprobed` chips but not `checks`, which rendered tiles literally
   captioned **Supabase** and **n8n** on both Settings and Automation. Renamed to
   `NEXUS data` and `Automation`; `settings.js`'s `AUTO_PROBE` allow-list
   (`:449`) and its two `probeFor` regexes were updated in the same pass, and
   `lib/integrations.js` now carries a comment saying the three must agree.
6. **`VITE_N8N_BASE_URL` is named to the dealership on five more screens** —
   `finance.js:391`, `conversations.js:577`, `campaigns.js:1736`,
   `leads.js:1011`, `ask.js:838` — none of them in the document's table. All
   rewritten to *"This deployment is not configured to reach …; only NEXUS can
   change that."*
7. **`ask.js` diagnoses failures in the vendor's terms** (`:511-527`): *"n8n has
   no webhook registered at this path"*, *"The execution log there will name the
   node that threw"*, *"a CORS allow-list that is missing Authorization"*.
   Rewritten to symptom + who owns the fix.
8. **`settings.js` named the identity provider** — *"Identity as **Supabase
   Auth** and the `users` table each see it"*. Rewritten.

### 2d. Found, NOT fixed, and why — the honest remainder

- **Internal table and view names are rendered on almost every screen.**
  Rendered text still contains `audit_log`, `v_needs_attention`,
  `v_workflow_health`, `v_conversations`, `workflow_registry`,
  `communication_logs`, `purchase_history`, `finance_quotes`, `kyc_documents`.
  `lib/errors.js` states the rule these violate — *"a rep reading 'permission
  denied for table leads' learns nothing they can act on while learning the
  shape of the database"* — but Part 4's table does not name schema identifiers,
  and this is hundreds of occurrences across all 20 screens, woven into prose
  whose whole style is naming its own source. Fixing it is a deliberate
  vocabulary decision plus a full-file rewrite of ~20 screens that other agents
  are editing concurrently. **It should be its own pass, with a decision
  recorded first.** I removed the ones that fell inside sentences I was already
  rewriting and left the rest.
- **`WAHA` and `Bitrix24` are still named to the dealership** in
  `screens/conversations.js` (6 occurrences) and `screens/finance.js` /
  `screens/customers.js` (Bitrix). CONTROL-PLANE.md 5.5 flags exactly this harm
  — *"can discover from one search that their WhatsApp is running through an
  unofficial client"* — but only for the chip list I fixed. In
  `conversations.js` the names are load-bearing inside long identity-resolution
  explanations, and rewriting them safely means understanding that screen's
  identity model. Not attempted. **This is the largest remaining leak of the
  ones I can see.**
- **`app.js` boot card** renders *"Fix these environment variables in Vercel,
  then redeploy"* with the variable names, on a configuration failure. It names
  the hosting provider. Arguably it is addressed to whoever deploys — but it is
  rendered to whoever opens the page. Left; flagged.
- **`screens/settings.js:1091` / `:1400`** — `audit_log` read failures and the
  "which workflows are not instrumented" backlog. CONTROL-PLANE.md 5.8 calls
  these Ali's backlog. I disagree enough not to act unilaterally: a dealership
  reading *"this figure could not be read, so its absence means nothing"* is
  being protected from a false zero, which is this project's first rule. The
  vendor-ish half (*"Adding one inside n8n is the only thing that closes this
  gap"*) I did rewrite; the finding itself I left.
- **`lib/states.js` / `lib/errors.js`** — AUDIT-2026-09-04 calls the raw-error
  render *"the widest one the document missed"*. It was fixed on 5 Sep before
  this pass and is now correct; I read it and changed nothing. Another agent
  owns those files.

---

## 3. STAGE 1.9 — the Compliance UNKNOWN bug (task item 3)

**Where the zeros came from.** `screens/compliance.js:1168-1176` builds
`verdictCounts` by counting `kyc_documents` rows per verdict, and
`:1328/:1332/:1339` rendered `num(verdictCounts.APPROVED)` etc. straight into a
KPI tile. Both caption branches (`legacyApproved` and `oneTrail`) can be false,
and then the tile is a bare `0` with nothing under it.

**Whether the capability exists.** `screens/compliance.js` contains **no
`dbWrite`, no `n8n()` call and no `HOOK` reference** — grep returns zero for all
three. The Approve / Reject / Re-ask controls at `:1958-1961` and `:2412-2414`
are rendered `disabled`, and the constant behind them says why: *"No KYC
decision endpoint exists yet."* So a verdict can only ever arrive from the
document auditor. Correction to the audit's wording, because it matters: the
auditor workflow **does** have `Record KYC (Approved)` / `Record KYC (Rejected)`
/ `Record Non-Document` nodes (`n8n-workflows/kyc_aml_document_auditor_re_upload_loop_phase_5.json:448,493,711`),
so a decision endpoint is not absent from the *system* — it is absent from the
*dashboard*. The tile's wording says the second, which is the part I can prove.

| file:line | was | is |
|---|---|---|
| `compliance.js:1328,1332,1339` | `kpi('Approved', num(verdictCounts.APPROVED), …)` — renders `0` | `verdictTile('Approved', 'APPROVED', caption, evidence)` (`:1366`) |
| `compliance.js:1362` (new) | — | `NO_DECISION_CAPABILITY = 'Not zero — nothing to count. No decision of any kind is on file, and nothing here can record one; the document auditor is the only writer.'` |
| `compliance.js:261` | `NO_DECISION_HOOK` naming `kyc_documents`, its role posture and the `audit-kyc` webhook | *"Recording a decision here is not built yet. The document auditor is the only thing that can write a verdict…"* |

**The gate condition is `decidedOnFile`, not "this verdict is zero"** —
`APPROVED + REJECTED + ESCALATED`. If any decision at all is on file the
register is demonstrably being written, and a zero on one of the three is then a
real measurement, so it prints as a number and this branch stops firing by
itself. And the caption written for a number (*"not 0 rejected customers"*) is
suppressed under the dash; only the off-register evidence — the
`[KYC-APPROVED]` / `[KYC-REJECT]` messages that were sent with no register row —
survives, because that is what makes the dash mean something.

**Rendered, captured 5 Sep against the stub (one PENDING row, no decisions):**

```
GENUINE SUBMISSIONS 1 … 1 of them is still Pending
APPROVED — Not zero — nothing to count. No decision of any kind is on file,
           and nothing here can record one; the document auditor is the only writer.
REJECTED — Not zero — nothing to count. …
ESCALATED TO A HUMAN — Not zero — nothing to count. …
NO ARCHIVED FILE 0 The database files no document as an archive gap
```

The em dash + words is the pattern the tile three along
(`No archived file`, `gapKnown ? num(gapTotal) : '—'`) already used; this is
that, applied to the three tiles that were missing it.

---

## 4. Gate prose assertions affected

**None that I can find, and the gate agrees.** I read `QUALITY_GATE.mjs` before
editing and did not modify it.

- The gate's source lane matches **structure**, not screen prose: `S2` bans
  constructs, `S3` parses PostgREST paths, `S5` looks for `|| 0` next to six
  named columns, `S6` looks for engine-state literals. The only literal screen
  strings it holds are `STUB_REFUSAL_REASON` (R7, `screens/actions.js` — not
  touched), `/Couldn.t load/` (R2, produced by `lib/states.js` — not touched),
  and R4's `AED 0` / `0.0%` (arithmetic, not wording).
- **Two things I checked specifically because they *could* have broken a
  check.** `RELATIONS['v_workflow_health']` in the gate's embedded snapshot
  (`QUALITY_GATE.mjs:252`) is already the new 25-column shape, so the gate's own
  stub serves rows without the trigger columns and `triggerVisible` is correctly
  false in the render lane. And `RELATIONS['workflow_registry']`
  (`:261`) still declares all ten columns — correct, since `service_role` still
  holds them and the gate reads as `service_role`.
- Renaming the integration tiles (`Supabase` → `NEXUS data`, `n8n` →
  `Automation`) touches three coupled places, all outside the gate:
  `lib/integrations.js` `checks[].name`, `settings.js` `AUTO_PROBE`, and
  `settings.js`'s two `probeFor` regexes. All three were changed together and
  the comment at `lib/integrations.js:47` says so.
- Result after the change: **PASS 18, FAIL 0, WARN 1 (pre-existing, in a file I
  did not touch), NOT RUN 16 (LIVE lane, no DB by instruction).**

---

## 5. Files changed

`screens/automation.js`, `screens/settings.js`, `screens/compliance.js`,
`screens/campaigns.js`, `screens/ask.js`, `screens/team.js`,
`screens/finance.js`, `screens/conversations.js`, `screens/leads.js`,
`lib/integrations.js`.

Not touched: `QUALITY_GATE.mjs`, `lib/data.js`, `lib/states.js`,
`lib/errors.js`, `lib/health.js`, `lib/tenant.js`, and every screen not listed
above. No git command was run; everything is left in the working tree.
