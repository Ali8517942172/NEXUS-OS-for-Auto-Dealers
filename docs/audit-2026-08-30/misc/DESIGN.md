# Four unrelated defects — DESIGN

**Status:** OFFLINE DESIGN. No live n8n, Supabase or device tool was called.
**Sources of truth:** the exports under `/home/claude/audit/` only —
`n8n-workflows/*.json` (`_index.json` exported 2026-08-30T04:12:20Z),
`apps/executive-dashboard/**`, `architecture/*.sql`, `supabase/*.sql`,
`security/fix_rls.sql`.

**One change is applied, not just designed:** defect 4 is edited in place in
`/home/claude/audit/apps/executive-dashboard/screens/automation.js`
(`node --check` passes). Everything else is a file to review and apply.

| # | Defect | Deliverable | Applied? |
|---|--------|-------------|----------|
| 1 | `leads.response_time_minutes` is written by nobody | `sla_migration.sql` | no — review and run |
| 2 | KYC retry cap fails open three ways | `OPERATIONS_kyc.json` | no |
| 3 | Scrape killed by its own ceiling; dead price branch | `OPERATIONS_competitor.json`, `OPERATIONS_competitor_dead_branch.json` | no |
| 4 | `PARTIAL` renders green | `screens/automation.js` | **yes, in place** |

---

## 1. The five-minute rule has no meter

### 1.1 What is actually true

`leads.response_time_minutes` is read in five places and written in none:

| reader | what it does with it |
|---|---|
| `screens/leads.js` | `SLA_MINUTES = 5`; the breach alert, the per-lead "Not measured" cell |
| `screens/overview.js` | the average-response KPI (`withResp` / `avgResp`) |
| `screens/team.js` | `untouchedOf` — a rep's leads with no recorded first reply |
| `lib/lead-drawer.js` | "within SLA" / "breaches the 5-minute rule" |
| `public.v_needs_attention` | `kind = 'sla_breach'` |

No workflow writes it. `Persist Lead (deterministic)` and `upsert_lead` in the
Master Router both POST to `/rest/v1/leads?on_conflict=email` and neither payload
contains the column. No SQL in the repo gives it a default. The dashboard is
already honest about this — `leads.js` prints *"response_time_minutes is null on
every lead on file"* — so the defect is not a wrong number on screen. It is that
the dealership's headline promise is unmeasured, and `sla_breach` has never fired
once.

### 1.2 Decision — a database trigger on `communication_logs`

**Chosen:** an `AFTER INSERT` trigger on `public.communication_logs` that stops
the clock the first time a genuine outbound message is filed against a lead, plus
a `BEFORE INSERT` trigger on `public.leads` that closes the ordering race.
Delivered as `sla_migration.sql`.

The whole argument is one sentence: **the clock has to stop at the first outbound
message, whichever workflow happens to send it, and there are six of those
today.** `communication_logs` is written by

* `whatsapp_bdc_ai_agent` — `Log Conversation` (the reply) and `Log Incoming Message`
* `kyc_aml_...phase_5` — `Log KYC Re-ask`, `Log KYC Escalation`
* `7_day_warm_lead_drip_campaign`
* `whatsapp_send_dashboard_reply` — a human rep replying from the dashboard
* `lead_escalation_ai_agent`, `phase_6_12_hour_silence_detector`

A rule placed in a workflow is a rule placed in *one* of those, and the seventh
writer added next month gets it wrong silently. A rule placed on the table is
stated once and cannot be forgotten — including by the dashboard's own reply
endpoint, which is the path a *human* answering inside five minutes takes, and
which no workflow-side design would ever have covered.

### 1.3 The alternatives, and why not

**(a) The Master Router, when it persists the lead.** Rejected on the facts, not
on taste: at `Persist Lead (deterministic)` **nothing has been sent yet**. The
outreach branches (`WhatsApp Outreach (HOT)`, `WhatsApp BDC (WARM)`,
`Marketing Drip (COLD)`) run after it, and for a lead that arrives *because* the
customer messaged WhatsApp, the reply was already sent by the BDC agent before
the router was ever called. Writing the column here means writing either `0` or a
guess. A fabricated `0` is worse than `NULL`: `NULL` makes the dashboard say
"Not measured", `0` makes it say "within SLA" about a customer nobody answered.
The router is also only one of several arrival paths — the BDC's
`Score New Lead (Master Router)` path, the drip, and any lead created by hand in
the Slack Command Center never pass through it at all.

**(b) The BDC agent, when it logs the first outbound.** Rejected for coverage and
for cost. Coverage: it measures WhatsApp only. A web-form lead answered by email,
a `Marketing Drip` Day-1 send, a rep replying from the dashboard — none of them
touch this workflow, and all of them are first replies. Cost and fragility: the
node would have to *know* it is the first outbound, which means an extra Supabase
read on every message in every thread, and then the same block copied into the
drip, the KYC auditor, the escalation agent and the dashboard reply workflow —
five copies of one rule, drifting apart from the day they are written. It also
inherits the identity problem in full: `Log Conversation` files rows under
`lead_email || sender`, so the WhatsApp path alone writes three different key
shapes.

**(c) Fill it from a nightly recompute job.** Considered and rejected: it makes a
five-minute measurement up to 24 hours stale, and `v_needs_attention` is polled
by `lib/badges.js` every 60 seconds specifically so a breach surfaces while
somebody can still act on it.

### 1.4 How the trigger works

* **Start of clock:** `leads.created_at`. Note that both lead writers use
  `Prefer: resolution=merge-duplicates` on `on_conflict=email` and neither sends
  `created_at`, so a returning customer's clock is *not* reset by a second
  enquiry — and because the value is written once and never overwritten, it stays
  the first-ever response time. That is the number the dashboard's wording claims.
* **Stop of clock:** the first `communication_logs` row a *customer could have
  received* — `direction = 'outbound'`, `channel` in `whatsapp | email | sms`,
  and no internal bracket marker. Three kinds of row look outbound and are not:

  * `Log Incoming Message` (BDC) writes `'[system] Initial outreach requested by
    the Master Router'` at the moment the router *asks* for outreach, before
    anything is sent.
  * **`Mark as Escalated` (Phase 6 · 12-Hour Silence Detector)** writes
    `channel: 'system'`, `direction: 'outbound'`,
    `message: '[SILENCE-ESCALATED] …'`. This is the most dangerous row in the
    table for this feature: it is written *because* nobody answered, at roughly
    the 12-hour mark. Counting it would stamp ≈720 minutes onto exactly the leads
    that were never answered — turning "unmeasured" into a confident wrong
    number, on the worst cases only.
  * anything on `channel: 'slack'` — internal, not a customer message.

  `[KYC-REJECT] …` rows are **not** excluded: they carry the exact text that went
  to the customer's phone. The 7-day drip's Day-1 email/WhatsApp *is* counted —
  for a COLD lead it genuinely is the first reply.
* **Identity.** `communication_logs.lead_email` is a real address, or a chat id
  (`…@c.us` / `…@lid`), or `+<digits>@whatsapp.lead`; `leads.email` is a real
  address or that same synthetic one. `public.nexus_lead_for_comm_key()` walks
  exact match → `@c.us` digits → `leads.phone` digits → `whatsapp_contacts` as
  the bridge. `…@lid` contains no phone digits at all, so `whatsapp_contacts` is
  the *only* route for it; the lookup is guarded with `to_regclass` so the file
  still installs where that table is absent.
* **First write wins.** `where response_time_minutes is null` makes the update
  idempotent and makes the hundredth message to a lead free.
* **The ordering race is real and is handled.** The BDC agent answers an unknown
  number, logs the outbound reply, and only *then* reaches
  `New Lead Worth Scoring? → Score New Lead (Master Router)`, which creates the
  lead. Trigger A would have run with no lead to update — so the leads answered
  *fastest* would be the ones left unmeasured. `trg_leads_backfill_response`
  (BEFORE INSERT on `leads`) looks back for an outbound row already on file,
  within a five-minute grace window before `created_at`.

### 1.5 Back-filling is partly possible, and the file does it

The brief assumed history was unrecoverable. Half of it is: `nexus_retention_purge`
has already deleted some of `communication_logs`, and leads predating that table
have nothing to join to. But every surviving outbound row *is* an unmeasured
first reply, and the identity map above can now attach it. Section 6 of the
migration is a one-time `UPDATE` guarded three ways (only `NULL` rows, only
replies, only at/after the lead arrived). It is marked optional — comment it out
if you would rather the meter describe only traffic that arrived after install.

### 1.6 What is deliberately left open

`v_needs_attention` is not defined anywhere in this repository
(`security/fix_rls.sql` §5 says so explicitly), so this file does not touch it.
That leaves the *worse* half of the SLA question open: a lead answered late will
now raise `sla_breach`, but **a lead never answered at all stays `NULL` and
raises nothing.** Section 7 of the SQL names the branch that would close it. It
must be written against the live view definition, not a guess at it.

---

## 2. The KYC retry cap does not hold

### 2.1 The three failure paths, all producing the same wrong answer

`Count Previous KYC Rejections` is a `n8n-nodes-base.supabase` `getAll` on
`communication_logs` with one filter — `lead_email eq {{ $json.lead_email }}` —
and no `limit`, no `returnAll`, no `orderBy`. `Decide: Re-ask or Escalate` then
counts items whose `message` starts `[KYC-REJECT]`.

* **(a) identity.** `Prepare Document` sets `lead_email: body.lead_email ||
  body.email || null`. A WhatsApp-only customer has `null`, the filter matches
  nothing, `attempts = 0` — "Attempt 1 of 3" for ever.
* **(b) window.** 50 unordered rows out of a table carrying every BDC reply and
  every drip message. Past 50 messages the markers are outside the window.
* **(c) fail-open.** `onError: continueRegularOutput` + `alwaysOutputData` means
  a Supabase blip arrives as `{ error: … }`, is dropped by the
  `typeof r.message === 'string'` guard, and gives `attempts = 0` again.

All three converge on `0`, and `0` is precisely the value that loops.

### 2.2 Decision — count `kyc_documents`, not `communication_logs`

`kyc_documents` already stores the number. `Record KYC (Rejected)` writes
`attempt_number: nextAttempt`, `verdict: withinLimit ? 'REJECTED' : 'ESCALATED'`,
`lead_email`, `chat_id` and `created_at` on **every** rejection — it hangs off
`Delivery Report (KYC Rejected)`, which is fed straight from `Decide`, in
parallel with `Within Retry Limit?`. The `[KYC-REJECT]` marker in
`communication_logs`, by contrast, is written by `Log KYC Re-ask`, which only
runs on the within-limit branch *after* `WhatsApp: Request Re-upload`. So
`kyc_documents` is not merely a better source — it is a **strictly more
complete** one: it records rejections whose WhatsApp send failed, and the marker
does not.

It is also a table of KYC submissions rather than of all conversation traffic, so
failure path (b) stops being a shape the problem can even take.

The read is written as an **HTTP Request node**, not a Supabase node, keeping the
name `Count Previous KYC Rejections` and the position `[1600, 176]`. The reason
is mechanical: the Supabase node's `filters.conditions` are ANDed
`keyName/condition/keyValue` triples and **cannot express `or=(…)`** — the exact
pattern this fix needs. Every other Supabase call in this workflow is already a
PostgREST HTTP node, so this is the house style, not a new one.

Query shape:

```
GET /rest/v1/kyc_documents
  select     = attempt_number,verdict,created_at,lead_email,chat_id
  or         = (lead_email.eq.X,chat_id.eq.X,lead_email.eq.Y,chat_id.eq.Y,…)
  verdict    = in.(REJECTED,ESCALATED)
  created_at = gte.<now − 90 days>
  order      = attempt_number.desc.nullslast
  limit      = 1
```

`order` + `limit=1` turns a *count* into a **maximum**, which is what actually
matters: it cannot be truncated by a row cap, and a duplicated insert cannot
inflate it. The `or=(…)` set is built exactly the way `Fetch Thread History` in
`whatsapp_bdc_ai_agent.json` builds its own — email, chat id, and
`+<digits>@whatsapp.lead` derived from a `@c.us` id. `@lid` is deliberately *not*
converted: a LID id has no phone digits in it, and minting a `+<lid>@whatsapp.lead`
key would just be noise. Each key is matched against **both** `lead_email` and
`chat_id`, because `Record KYC (Rejected)` writes both.

The 90-day window is a judgement call and is worth stating: without it, a
customer approved last year and re-submitting a different document type today
starts already exhausted. With it, a genuinely stuck case still cannot loop
inside one onboarding, and a returning customer gets a fresh three.

### 2.3 It now fails CLOSED

`Decide: Re-ask or Escalate` is rewritten to separate two things the old code
collapsed:

* an **empty result** — a real answer, `attempts = 0`, ask again;
* an **error item** — no answer at all, `countOk = false`, `withinLimit = false`,
  escalate to a human.

This is a deliberate trade, and it has a cost: `Within Retry Limit?` false routes
to `Slack: KYC Escalation` only, so **the customer receives nothing** on that
branch. That silence is pre-existing behaviour, not something introduced here,
but the fix makes it reachable in a new way and it is named in `RISKS.md` (R2-3).
The alternative is the unbounded loop this patch exists to stop.

Two dependent nodes are patched so they stop asserting a number they no longer
have: `Slack: KYC Escalation` said *"Failed attempts: 0 of 3"* and
`Log KYC Escalation` said *"loop exhausted after 0 attempts"* whenever the count
failed. Both now read `escalationReason`, which says either how many attempts
were used or that the count could not be read.

There is a pleasing interaction with defect 4: when the count read fails,
`Delivery Report (KYC Escalation)` already marks it a dropped non-critical claim,
so the run audits as `ESCALATED_PARTIAL` — a status the dashboard did not
recognise until this same change set.

### 2.4 Alternatives rejected

* **Patch the existing Supabase node** (add `returnAll`, add an order). It cannot
  express `or=(…)`, so path (a) — the WhatsApp-only customer, the *common* case —
  survives untouched. `returnAll` on `communication_logs` also means paging the
  whole conversation history on every rejection.
* **Keep counting `communication_logs`, but with the `or=()` set.** Fixes (a) and
  (b), leaves the source strictly less complete than `kyc_documents` (§2.2) and
  keeps a retry cap keyed on a table whose contents are unrelated chat traffic.
* **A `kyc_attempts` counter column on `leads`.** A fourth place for the same
  fact, needing its own reset policy, and unwritable for a customer who has no
  lead row yet.

---

## 3. The competitor scrape

### 3.1 Primary cause: the run is killed by its own ceiling

`settings.executionTimeout = 300`. Per unit, worst case:

| node | timeout | tries | worst case |
|---|---|---|---|
| `Apify - Search Competitor Price` | 120 000 ms | `retryOnFail`, `maxTries: 2` | 240 s |
| `Extract Price with AI` | 60 000 ms | `retryOnFail`, `maxTries: 3` | 180 s |
| | | | **420 s for ONE unit** |

An HTTP Request node processes its items sequentially, so 16 units cannot fit in
300 s under any arrangement — the run is cut off after roughly two. The
`Is This Real Intel?` filter is downstream of all of this and is not the cause.

### 3.2 The throughput fix — three changes that only work together

1. **Cut the per-request budget.** Apify → 45 s and `retryOnFail: false`; AI →
   25 s, `maxTries: 2`. ≈ 95 s per unit. Dropping the Apify retry is deliberate:
   a blocked page stays blocked on the second try, so the retry mostly doubles
   the cost of the failures. A `timeout=40` query parameter is added to the
   Apify `run-sync-get-dataset-items` call so Apify aborts the actor run too,
   rather than the dealership paying for a run n8n has already abandoned.
2. **Bound the batch.** `Build Apify Query` emits at most `BATCH_SIZE = 8` units,
   taken off an id-sorted ring at an offset that advances every 12 hours, and
   skips units whose `status` is `sold` (a sold unit cannot be repriced and
   cannot be undercut; scraping one spends a slot a live unit needed). Worst case
   per run ≈ 760 s.
3. **Make the ceiling honest.** `executionTimeout: 300 → 1200`, and the schedule
   moves from `0 5 * * *` to `0 5,17 * * *`.

Coverage is preserved *by rotation, not by scanning everything*: two runs a day ×
8 units covers a 16-unit fleet every 24 hours — **the same daily Apify spend the
once-nightly design intended**, spread across two executions instead of dying
inside one. If the fleet grows, either `BATCH_SIZE` or the number of daily runs
has to grow with it; the arithmetic is written into the node's own comment so the
next person changing one of the three numbers has to re-do it.

*Why not simply raise the ceiling to 3600 and scan all 16?* Because a single
execution would then hold an n8n worker slot for up to 48 minutes every night on
a VM this project has already documented as CPU-starved, and because it makes the
failure mode worse, not better: a run that overruns is still truncated silently.
A bounded batch is a run whose duration somebody can check against the ceiling
before it happens.

One more real throughput defect, fixed here: `Extract Price with AI` has **no
`onError`**, so a single OpenRouter 429 or 502 throws and ends the batch,
discarding every unit after it. It now continues, and `Parse AI Price` already
degrades correctly on an error item (`response.choices?.[0]…` falls through to
`{ price: null }` and the JSON-LD path may still yield a price).

### 3.3 The dead price-update branch — DELETE it

Nothing connects into `Should Update Price?`. `Build Update Payload` and
`Update Prices in Supabase` are unreachable; the workflow has never updated a
price despite its name. `Delivery Report` already documents this in a comment.

**Recommendation: delete the three nodes.** Not "fix the floor first".

* The payload is `price = Math.max(0, Math.round(competitorPrice - 1))`. There is
  no floor at `cost_aed`, so it will sell cars below what the dealership paid.
  `Math.max(0, …)` floors at *zero dirhams*, which is not a business rule.
* Even a `cost_aed` floor would be wrong. `supabase/2026-08-14_…sql` establishes
  what a price has to clear: `cost_aed`, AED 50/day `holding_cost_accrued`, 5%
  VAT, 5% commission. A correct floor is a pricing policy, and nobody has written
  one down.
* The input is not trustworthy enough to act on automatically. `Parse AI Price`'s
  own comments record that the first real run filed **`google.com`** as a rival
  dealership quoting 105,200 for a Fortuner, and that *"Pardon Our Interruption"*
  once entered `competitors` as a competitor. The guards added on 24 Aug are good
  — and they are exactly why the intel is safe to *show a human* and not safe to
  *write back into `inventory.price_aed` unattended*.
* Leaving it disconnected is the worst of the three options. It looks finished,
  it carries the workflow's own name as a promise, and it is one dragged
  connector away from repricing the lot. Deleting is reversible: the full node
  definitions are in `competitor_price_scraping_supabase_update.json` in this
  repo, and automated repricing, if it is ever wanted, belongs in a separate
  workflow with a floor, a cap on the size of a single move, and an approval
  step — not in a resurrected orphan.

Delivered **separately**, as `OPERATIONS_competitor_dead_branch.json`, so the
throughput fix can be applied without also making this decision.

### 3.4 `scraped_at` is never written

`Log Competitor Intel` writes `competitor`, `model`, `price_aed`,
`our_price_aed`, `price_diff_aed`, `ai_recommendation` — and no `scraped_at`.
`screens/competitors.js` reads `cAt = pick(r, ['scraped_at','checked_at','created_at'])`
and its column list, *read off the live database on 24 Aug 2026*, shows the
`competitors` table as `id, competitor, model, our_price_aed, price_aed,
price_diff_aed, scraped_at, ai_recommendation` — so the column exists and is
simply left null unless it happens to carry a `default now()`. No SQL in this
repo defines the table, so that default cannot be confirmed from here.

The fix writes it explicitly — `scraped_at = {{ $now.toISO() }}` — which is
correct whether or not a default exists, and needs no migration. There is nothing
to back-fill: a row with no scrape time cannot be given one honestly. Confirming
whether the column has a default (and adding one if not) is listed in `RISKS.md`
as a post-apply check, since a second writer may appear later.

---

## 4. `PARTIAL` renders green — **APPLIED**

Edited in place: `/home/claude/audit/apps/executive-dashboard/screens/automation.js`.
`node --check` passes. No other dashboard file is touched — in particular
`lib/format.js` is **not** modified, which is both a constraint (another agent is
editing dashboard files) and the right call on the merits, see §4.3.

### 4.1 What was wrong

`STATUSES = ['SUCCESS','FAILED','REJECTED','ESCALATED']`. Every `Delivery Report`
node in the system writes `SUCCESS | PARTIAL | FAILED`, and `PARTIAL` means one
thing throughout: *the run finished, but a step it was about to claim did not
land* — in these workflows, almost always the message to the customer. Fifteen of
the twenty-two workflows write it.

Consequences, all three confirmed in the file:

* `other` — `PARTIAL` fell into the "Other" chip and was counted nowhere.
* `failedCount` and `isBad` — both keyed on `['FAILED','REJECTED']`, so a
  `PARTIAL` run got no banner, no "Needs investigation", and no red summary.
* the timeline dot at line 1343 ended in a bare `: 'ok'`, so **`PARTIAL` was
  painted `var(--ok)` green** — identical to a clean run.

`ESCALATED_PARTIAL` and `ESCALATED_FAILED` are also written and were also
unhandled: `Log KYC Escalation` builds its status as
`$json.delivery.status === 'SUCCESS' ? 'ESCALATED' : 'ESCALATED_' + $json.delivery.status`.

### 4.2 What was changed

A new block after `looksTimedOut`, following the file's existing pattern of a
named predicate plus a documented note:

* `deliveryHalf(s)` — `'ESCALATED_PARTIAL' → 'PARTIAL'`. The half after the
  underscore is the delivery verdict; the half before it is the branch that ran.
* `looksUndelivered(a)` — the run completed but the customer-facing step did not
  land. A plain `FAILED` is deliberately excluded: that is the whole run
  breaking, already counted and coloured as its own finding.
* `PARTIAL_NOTE` — the hover text, in the file's voice, saying what `PARTIAL`
  means and that `audit_log` records *which* step only in the summary.
* `runDot(a)` — replaces the inline ternary. `ESCALATED_FAILED` → hot,
  `PARTIAL` / `ESCALATED_PARTIAL` / `ESCALATED` → warm, `SUCCESS` → ok, and
  **anything unrecognised → `cold`, never green.** That last branch is the actual
  root cause: the old expression ended in `: 'ok'`, so *any* word the screen did
  not know rendered as a pass. `cold` matches `TONE`'s `UNKNOWN`.

Then, threaded through the activity log:

* `STATUSES` gains `PARTIAL`, `ESCALATED_PARTIAL`, `ESCALATED_FAILED` — which
  also repairs the "Other" chip and the `OTHER` filter for free.
* a new `undelivered` set and an `UNDELIVERED` segment chip labelled
  *"Never reached the customer"*, following the same synthetic-filter pattern the
  file already uses for `TIMEOUT`.
* `isBad` includes `looksUndelivered`.
* the Status cell shows *"The run finished; the customer-facing step did not
  land"* in amber, ordered after the ceiling and scrape-guard readings.
* the Summary cell is amber for undelivered, red for genuinely bad.
* a second banner, **warm not hot**, beside the failure banner, with a button
  that filters to `UNDELIVERED`.
* the run drawer gains a matching warm banner.

Amber rather than red is not cosmetic. This screen's stated discipline is that
two different findings never share a colour: a run that broke and a run that
completed but never reached a customer are different problems with different
owners. The bug was that they shared a colour with *success*.

### 4.3 Why not add `PARTIAL` to `TONE` in `lib/format.js`

Beyond the coordination constraint: `tone()` is shared by every screen, and
`PARTIAL` means "the customer was not messaged" only in `audit_log`. A `PARTIAL`
appearing in some other vocabulary later would inherit a meaning nobody gave it —
the same class of mistake `format.js` already documents about `DEGRADED`. Reading
it locally, where the vocabulary is known, is the smaller and more correct claim.
The `pill()` for `PARTIAL` therefore still renders as `unknown` grey with its
"this dashboard has no wording for that status" hover, which is honest; the
finding is now carried by the dot, the chip, the sub-line, the count and the
banner.
