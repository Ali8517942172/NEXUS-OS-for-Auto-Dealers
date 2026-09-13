# NEXUS OS — Journeys

Twenty end-to-end journeys through NEXUS, and the node coverage matrix that says
which of the real n8n nodes each one exercises.

**Measured 4 September 2026** against the live n8n box (21 workflows, read
through the published definitions) and against Supabase projects
`dsvuoovivysszdoiorch` (production, ALBA CARS) and `wwspuxrbiyagnrnzgate`
(synthetic two-tenant staging). Every count in this file came from one of those
two places. Where a figure could not be measured from here, it says so.

**Status of every journey in this file: NOT RUN.** None of the twenty has been
executed. This is a plan, not a result.

---

## Two house rules this document is written under

**A NOT RUN is never converted into a PASS.** Not by inference, not by "the
workflow is green so the journey must pass", not by a previous run of a similar
journey. The status column has four values — `NOT RUN`, `PASS`, `FAIL`,
`BLOCKED` — and only a recorded execution with its assertions checked moves a
row off `NOT RUN`. A journey whose harness ran but whose assertions were not
read is `NOT RUN`, not `PASS`.

**A journey blocked by a missing capability is marked BLOCKED BY MISSING
CAPABILITY, and the missing thing is named.** It is not written as a passing
test of a smaller thing, and it is not quietly dropped from the list. The test
for such a journey is inverted: the assertion is that **NEXUS says UNKNOWN or
NOT AVAILABLE rather than inventing data**. That is a real test with a real
failure mode — a screen that renders `0` where it means "no table" fails it.

Both rules exist because this codebase has rendered the second lie in six
separate places, and because a green matrix that includes unrun rows is worse
than no matrix.

---

# Part 1 — The coverage argument, stated honestly first

## Twenty journeys do not prove the node count

The brief for this document estimated 250–300 n8n nodes. The measured figure is
higher.

| measured 2026-09-04, from the published workflow definitions | count |
|---|---:|
| Workflows on the box | **21** |
| Nodes across all 21 | **334** |
| Workflows carrying a published (active) version | 19 |
| Nodes inside those 19 | **310** |
| Workflows with **no published version** (`active:false`, `activeVersionId:null`) | 2 |
| Nodes inside those 2 (Silence Detector 12, Infra Health Probe 12) | **24** |

Twenty journeys cannot prove 334 nodes, and no honest arrangement of twenty
journeys ever will. A journey is a behaviour: it walks one path through a
workflow and leaves every other branch of every `if`, `switch` and error output
untouched. The WhatsApp BDC workflow alone has 45 nodes and at least nine
decision points; one message down one path touches perhaps eighteen of them.

The failure this document is designed to prevent is the one where twenty green
journeys are read as "the system works". They are not that. They are twenty
sentences a dealership would recognise, each proven end to end.

## So the structure is two documents in one

**The journeys give behaviour coverage.** They answer: does the thing a
dealership pays for actually happen, from the customer's first message to the
row on the screen? That question cannot be answered by node counting, because
the interesting failures are between the nodes — an idempotency key that holds,
a tenant that resolves, a refusal that is recorded as a refusal instead of a
failure.

**The node matrix gives mechanical coverage.** It answers a narrower and more
checkable question: for each of the 334 nodes, is there a journey that makes it
run? That question is a lookup, not a judgement.

**The gap between them is the deliverable.** Part 6 ends with the list of nodes
that no journey touches. That list — not the twenty ticks — is what a release
gate should read, because it is the only part of this document that gets
*worse* when someone adds a workflow and forgets to test it.

Measured today, that gap is:

| | nodes |
|---|---:|
| Assigned to a journey and runnable once the Part 7 blockers clear | **299** |
| Assigned to a journey but **not runnable** — the workflow has no published version | **12** |
| **NOT COVERED** | **23** |
| Total | **334** |

The 23 uncovered are 11 nodes behind the Bitrix24 paid-plan wall in `wf_108` and
all 12 nodes of the Infra Health Probe, which has no published version and no
journey that could drive it. Both lists are itemised in Part 6.

## What the twenty journeys do not prove, said out loud

1. **Branch coverage inside a covered node.** "`Intent Switch` ran" is not
   "every output of `Intent Switch` ran". The matrix records which branch each
   journey takes; it does not claim the others.
2. **Timing.** Journeys that touch the drip and the silence detector run with
   shortened clocks. The logic is tested; the production durations are not.
3. **Concurrency.** Twenty sequential journeys never put five executions in
   flight. The deadlock that froze this box twice will not reproduce here, and
   must not be assumed fixed because these passed.
4. **Volume.** Production holds 3 leads, 1 sale and 12 units. Thresholds tuned
   against those numbers are guesses, and a journey that passes at n=1 says
   nothing about n=500.
5. **Deliverability.** A `Delivery Report` that says a Gmail send landed means
   the API accepted it. It does not mean a human received it.
6. **The transports we do not own.** Bitrix24, Apify, the Meta Cloud API and the
   Slack signing path are outside what any journey here can force.

---

# Part 2 — Journey identity, test data, and cleanup

## Identifiers

Journeys are `J-CUST-01` … `J-CUST-10` (the dealership's own customer) and
`J-DEALER-01` … `J-DEALER-10` (the dealership operator, i.e. the tenant).

A **run** is one execution of one journey and carries a `test_run_id`: a ULID
generated by the harness, e.g. `01K4E7Q9…`. The pair
`(journey_id, test_run_id)` names every row a run creates.

## The marker problem, measured

Every tenant-scoped table was checked for a column that could carry a run
marker. **There is none.** No `journey_id`, no `test_run_id`, no `is_test`, no
`created_by_test` column exists on any of the 58 base tables in `public`.
Adding one is a migration, and this plan does not authorise a migration.

That matters more here than it would elsewhere, because this database has a
house rule against inventing rows, and **a test row that cannot be told from a
real one is worse than no test**. A synthetic lead sitting in a dealership's
book is not a harmless leftover: it inflates their pipeline, it can be chased by
the silence detector, it can be emailed, and it will be counted in whatever
number they quote to themselves at the end of the month.

So the marker is built from three things that already exist, in descending order
of strength.

### Layer 1 — the tenant. Structural, and cannot be forgotten.

`tenant_id` is **NOT NULL on every tenant-scoped table**. Every row any journey
writes is therefore already stamped with an owner, whether or not the harness
remembers to stamp anything else.

Journeys run against a **journey tenant** that is not a real dealership. On the
staging project `wwspuxrbiyagnrnzgate` two synthetic tenants already exist and
neither holds the unattributed-default flag:

| tenant_id | slug | name | `is_unattributed_default` |
|---|---|---|---|
| `11111111-1111-4111-8111-111111111111` | `staging-alpha` | Alpha Motors (staging) | false |
| `22222222-2222-4222-8222-222222222222` | `staging-bravo` | Bravo Autos (staging) | false |

This is the load-bearing marker. `tenant_id = '1111…'` is a complete and
machine-checkable answer to "is this row test data", it needs no new column, and
RLS already enforces it. Everything below is corroboration.

### Layer 2 — an unroutable identity namespace.

The journeys drive workflows that send real email and real WhatsApp. The
identity a journey uses must therefore be one that **cannot reach a human even
if a guard fails**.

| field | journey value | why |
|---|---|---|
| `leads.email` | `j-cust-01.<test_run_id>@journeys.invalid` | `.invalid` is reserved by RFC 2606 and can never resolve. A Gmail leg fails at DNS rather than reaching somebody. |
| `leads.name` | `[JOURNEY J-CUST-01] <persona>` | Visible in any screen, drawer or Slack alert that renders a name. |
| `leads.source` | `journey:J-CUST-01:<test_run_id>` | Free text, always written by the harness, and the only place the run id survives inside `leads`. |
| `leads.phone` / WhatsApp chat id | a number on the **test WAHA session only** | See the caveat below. |
| `inventory.id` | `JT-<journey>-<nn>` | Production ids are `NX-10xx`; the namespaces cannot collide. |
| `kyc_documents.remarks` | prefixed `[JOURNEY J-CUST-04:<run>]` | Free text the workflow already writes into. |
| `purchase_history.deal_id` | `journey:J-CUST-01:<test_run_id>` | Free text and the natural key the pgvector sync dedupes on. |
| Storage objects | `kyc-documents/journeys/<test_run_id>/…` | One prefix to delete, one prefix to audit. |

**The caveat, stated rather than papered over: a phone number is not safely
fakeable.** WhatsApp sends go to whatever number the harness supplies, and
`Guard Reply` filters message *content*, never the *recipient*. So either the
journeys run against a WAHA session bound to a device the team controls, or the
WhatsApp send legs do not run at all and every assertion that depends on them is
`BLOCKED`. There is no third option, and inventing a plausible-looking UAE
number is the shape of mistake that puts a dealership's price list on a
stranger's phone.

### Layer 3 — the manifest, because the first two are not enough.

`audit_log.summary` is built by the workflows themselves, so the harness cannot
force a marker into it, and most tables have no free-text field at all. The run
marker therefore lives **outside** the rows:

```
journeys/<journey_id>/<test_run_id>/
  00_manifest.json      journey, run id, tenant, t0, t1, n8n execution watermark
  01_keys_before.json   every (table, primary key) for the journey tenant, before
  02_keys_after_run.json  … after the journey, before teardown
  03_keys_after_teardown.json  … after teardown
  04_created.json       02 minus 01  — what the run created
  05_residue.json       03 minus 01  — what teardown failed to remove (must be audit_log only)
  06_collateral.json    01 minus 03  — what teardown destroyed that it did not create (must be empty)
  10_executions.json    n8n executions above the watermark, with per-node run data
  99_RESULT.md          per-path status, per-assertion evidence, screenshots
```

## Cleanup, and how it proves it removed exactly what it created

Teardown is not "delete rows that look like tests". It is a **set difference on
primary keys**, taken three times.

1. **Before.** For the journey tenant only, snapshot `(table, primary key)` for
   all 58 base tables. This is `01_keys_before.json`.
2. **After the journey, before teardown.** Same snapshot →
   `02_keys_after_run.json`. `CREATED = 02 − 01` is the manifest of what the run
   actually caused, derived from the database rather than from what the harness
   believes it did.
3. **After teardown.** Same snapshot → `03_keys_after_teardown.json`.

Teardown passes only when **all four** hold:

| check | expression | must be |
|---|---|---|
| Nothing left behind | `RESIDUE = 03 − 01` | empty except `audit_log` (see below) |
| Nothing destroyed that was not created | `COLLATERAL = 01 − 03` | **empty** |
| Teardown removed exactly the manifest | `CREATED − audit_log ⊆ (02 − 03)` | true |
| No other tenant moved | row counts per table for the *other* staging tenant, and for production `dsvuoovivysszdoiorch` | identical before and after |

`COLLATERAL` is the check that matters most and the one a naive teardown fails.
A `delete from leads where email like '%journeys.invalid'` that accidentally
matches nothing is harmless; a teardown ordered wrongly that orphans a
`whatsapp_contacts` row, or a `delete` on a shared fixture, shows up here and
nowhere else. **A non-empty `COLLATERAL` fails the journey even if every
assertion passed** — a test that damages the database is a failed test.

**`audit_log` is deliberately retained**, and that is the single documented
exception to `RESIDUE = ∅`. It is the run history; deleting it destroys the
evidence the journey exists to produce, and it is already both timestamped and
tenant-stamped. The manifest records the audit row ids so a later reader can
find them; the teardown asserts they are **still there**, which is the opposite
of the usual direction and is the point.

**FK order for teardown** (leads last, because the WhatsApp and KYC rows are
keyed on its email; deleting the lead first orphans them and the next run's
`Resolve Lead Identity` silently matches nothing):

```
kyc_documents → finance_quotes → communication_logs → processed_messages
→ whatsapp_contacts → deals_embeddings → purchase_history
→ customer_360_profiles → inventory_action_events → inventory_actions
→ lead_recovery_action_events → lead_recovery_actions → inventory → leads
```

Storage objects under `kyc-documents/journeys/<test_run_id>/` are deleted
**before** the `kyc_documents` rows, for the same reason the Retention Purge
does it in that order: a row marked purged whose object still exists is an
irreversible false compliance record.

**The n8n side.** Record `max(id)` from `execution_entity` before and after.
Executions are evidence, not rows to clean: they are left in place and the
watermark is what makes "which executions belong to this run" answerable.

## Where a run marker would be better, and what it would cost

The honest position: layers 1–3 are a workaround. A `journey_id uuid null`
column on the eight tables a journey writes to would make the manifest
unnecessary and make residue detection trivial. It is one migration and a
handful of nullable columns. It is not in this plan because this plan creates no
database objects — but if these journeys are going to be run more than once,
that migration is the first thing to do, and it should land on staging only.

---

# Part 3 — The six paths every journey needs

One journey is not one test. Each of the twenty is run six ways, and a journey
is only `PASS` when all six are.

| path | what it means | the assertion that makes it worth running |
|---|---|---|
| **Happy** | The intended outcome, with every claimed row present and every claimed value right. | Not "the workflow went green" — the `Delivery Report` node names what it verified, and that list must contain everything the audit row claims. |
| **Negative** | The business branch that fires *instead*: a refusal, a rejection, a lost deal, an escalation. | The refusal is recorded as a refusal (`REJECTED_EXPECTED`, `ESCALATED`) and **not** as `FAILED`, and the rows the happy path would have written are absent. |
| **Retry** | The same logical event delivered twice by the transport, or a node's own `retryOnFail` firing after a lost response. | The second delivery changes **no row count**. This is where the two WAHA hosts and `Log Incoming Message`'s missing `external_message_id` will show up. |
| **Duplicate** | The same *business* action submitted twice by a human — the deal closed twice, the document uploaded twice, the send clicked twice. | The idempotency key holds. Distinct from Retry: retry is the transport's fault, duplicate is a person's. |
| **Unauthorised** | The same call with no JWT, an expired JWT, another tenant's JWT, or a missing shared secret. | Refused **and no row written**. A refusal that still wrote a `processed_messages` row is a failure of this path even though the caller got a 401. |
| **Missing-data** | A required field absent, or a capability that does not exist behind the field. | NEXUS renders **UNKNOWN / NOT AVAILABLE / NOT_COMPUTABLE**, never `0`, never an estimate, never a plausible-looking number. |

The Unauthorised path has a specific shape on this system and it is worth
stating once rather than twenty times: **not one of the 11 POST business
webhooks uses n8n's own `authentication` parameter** — measured across the
published definitions, every one is `auth=NONE` at the trigger and every guard
is downstream application logic. So every Unauthorised path asserts two things,
not one: the caller is refused, *and* the execution that started anyway wrote
nothing.


---

# Part 4 — The twenty journeys

## The ten customer journeys at a glance

| id | one line | headline modules | status |
|---|---|---|---|
| J-CUST-01 | The clean win — enquiry to closed-won, document accepted | Conversations, Leads, Compliance, Deals, Inventory, Ask AI | NOT RUN |
| J-CUST-02 | Finance that computes — positive equity, a quote that lands | Finance Desk, Conversations | NOT RUN — lender half **BLOCKED** |
| J-CUST-03 | Finance refused — negative equity and an invalid valuation | Finance Desk | NOT RUN — lender half **BLOCKED** |
| J-CUST-04 | Document rejected, then resubmitted and accepted | Compliance, Conversations | NOT RUN |
| J-CUST-05 | Document rejected to exhaustion, then retention purge | Compliance, Settings, Automation | NOT RUN |
| J-CUST-06 | Goes quiet, is chased, comes back | Campaigns, Leads, Lead Recovery | NOT RUN — **BLOCKED** on an unpublished workflow |
| J-CUST-07 | Lost to a cheaper rival | Deals, Competitors, Leads | NOT RUN |
| J-CUST-08 | The returning customer | Customer 360, Leads, Deals | NOT RUN — C360 half **BLOCKED** at two tenants |
| J-CUST-09 | Noise, a stranger, a voice note, and a question we cannot answer | Conversations, Compliance, Ask AI | NOT RUN |
| J-CUST-10 | Asks for stock we do not have, then for things NEXUS cannot know | Inventory, Conversations | NOT RUN — **BLOCKED BY MISSING CAPABILITY** by design |

## The ten dealer journeys at a glance

| id | one line | headline modules | status |
|---|---|---|---|
| J-DEALER-01 | Onboarding a second dealership | Settings, Control Plane, every resolver | NOT RUN |
| J-DEALER-02 | Inventory profit actions — propose, decide, execute | Inventory, Action Center, Revenue | NOT RUN |
| J-DEALER-03 | Lead recovery from the desk | Lead Recovery, Leads, Team | NOT RUN |
| J-DEALER-04 | Deal Rescue, the refusal branch | Deals, Deal Rescue | NOT RUN |
| J-DEALER-05 | Deal Rescue, the working branch | Deal Rescue | **BLOCKED BY MISSING CAPABILITY** |
| J-DEALER-06 | A campaign, enrolled and stopped | Campaigns | NOT RUN |
| J-DEALER-07 | Team performance, assignment and the Slack desk | Team, Overview | NOT RUN |
| J-DEALER-08 | Market intelligence against a scraper producing nothing | Competitors | NOT RUN |
| J-DEALER-09 | An operator replies, and the policy engine refuses | Conversations, Policy | NOT RUN |
| J-DEALER-10 | The owner incident — a workflow fails and is retried | Automation, Overview | NOT RUN |

---

## J-CUST-01 — The clean win

**Actor** A cash buyer, inbound on WhatsApp.
**Tenant** `staging-alpha` (`1111…`).
**Trigger** `POST /webhook/whatsapp-inbound` from the test WAHA session, four
messages ≥ 20 s apart, the fourth carrying a valid identity document image.

**Modules touched** Conversations (AI BDC), Leads (Lead Recovery), Compliance
(Risk Control), Deals (Deal Rescue surface), Inventory (Profit Sentinel), Ask AI
(Executive Copilot), Overview, Team.

**Workflows and named nodes**

| workflow | nodes on this path |
|---|---|
| WhatsApp BDC AI Agent | `WAHA Webhook (POST)` → `WAHA Auth Gate` → `Prefilter` → `Resolve Tenant` → `Is Real Inbound?` → `Claim Message Id` → `Is New Message?` → `Extract Message & Sender` → `Is Voice Note?`(F) → `Is Document?`(both) → `Download KYC Image` → `Image To Base64` → `Send to KYC Auditor` → `Fetch All Leads` → `Resolve Lead Identity` → `Upsert WhatsApp Contact` → `Log Incoming Message` → `New Lead Worth Scoring?` → `Shape Lead For Router` → `Score New Lead (Master Router)` → `Reply Eligibility` → `Should The Bot Reply?` → `Fetch Thread History` → `AI BDC Sales Agent` (+ `OpenRouter Chat Model`, `Model Ladder`, `search_inventory`, `search_policy`) → `Guard Reply` → `Send Reply via WAHA HTTP API` → `Log Conversation` → `Delivery Report` → `Audit Log` |
| NEXUS Master Lead Router | `Called Internally` → `Validate & Enrich Input` → `AI Lead Scoring Agent` (+ `OpenRouter Chat Model`, `Simple Memory`, `Supabase Lead Lookup`) → `Parse AI Decision` → `Persist Lead (deterministic)` → `Intent Switch`(HOT) → `HOT: Already In A Live Chat?`(T) → `ERP Sync (HOT)`, `Slack Router (HOT)` → `Delivery Report` → `Audit Log` |
| KYC/AML Document Auditor | `Called by Another Workflow` → `Prepare Document` → `OpenRouter Vision (KYC Analysis)` → `Parse JSON Output` → `Is An Identity Document?`(T) → `Validation Check`(T) → `Approved` → `WhatsApp: KYC Approved` → `Log KYC Approved` → `Prepare Archive` → `Archive to Storage` → `Merge Archive Result` → `Record KYC (Approved)` → `Delivery Report (KYC Approved)` |
| Lead Escalation | `Called by Master Router` → `Fetch Escalated Lead` → `Found The Lead?`(T) → `AI Escalation Analyst` (+ `OpenRouter Chat Model`, `Model Ladder`, `Simple Memory`) → `Email: Escalation Alert (Gmail)` → `Mark Lead Escalated` → `Delivery Report` → `Audit Log` |
| Sync Closed-Won Deals to pgvector | `Webhook - New Deal` → `Verify JWT` → `Tenant For JWT User` → `Format Deal Text` → `OpenRouter - Generate Embedding` → `Parse Embedding Response` → `Supabase (Postgres) - Upsert Vector`; and `Lookup Lead By Email` → `Attach Lead Id` → `Record Purchase` → `Confirm Purchase Row` → `Delivery Report` → `Audit Log` → `Respond to Webhook` |
| Ask-AI RAG | `Webhook - Ask AI` → `Verify JWT` → `Auth OK?`(T) → `Tenant For JWT User` → `Extract Question` → `Supabase Knowledge Search` → `Docs Found?`(T) → `Build RAG Context` → `AI Agent - Generate Answer` → `Format Response` → `Audit Log` → `Respond to Webhook` |
| wf_108 ERP Sync | `Called by Master Router` → `Map Lead to Bitrix24 Lead` → `Build Audit Row` → `Delivery Report` → `Log to Supabase audit_log`. Everything from `Find Existing Lead` onward is **BLOCKED** at the Bitrix plan wall. |

**Database mutations expected**

`processed_messages` +4 (one per inbound message id) · `whatsapp_contacts` +1 or
touched · `communication_logs` +4 inbound, +N outbound · `leads` +1 with
`status` HOT, `ai_score` set, `source = journey:J-CUST-01:<run>` ·
`kyc_documents` +1 with `verdict='APPROVED'`, `attempt_number=1`,
`storage_path` non-null · one Storage object under
`kyc-documents/journeys/<run>/` · `purchase_history` +1 with the right
`amount_aed`, `purchase_date`, `lead_id`, `tenant_id` · `deals_embeddings` +1 ·
`inventory` the claimed unit moves to `Sold` · `audit_log` +≥6.

**Assertions**

1. The reply quotes a **real price from `inventory`** and the unit's `cost_aed`
   appears nowhere in the message body. (This is the 31 Aug leak; `Guard Reply`
   is the control.)
2. No EMI, APR or monthly payment appears in the WhatsApp reply at all — the
   WhatsApp finance path is not live and must not become live in a journey.
3. `kyc_documents.verdict = 'APPROVED'` **and** the Storage object exists. A row
   without an object is the archive gap J-CUST-05 hunts for.
4. `purchase_history.lead_id` resolves to the journey lead, not null.
5. `deals_embeddings.deal_id = 'journey:J-CUST-01:<run>'` — exactly one row.
6. Ask AI's answer carries a citation to a real `rag_documents` chunk, and no
   sentence that is not supported by it.
7. `v_attribution_sale_chain` grades the VEHICLE hop `UNKNOWN_TEXT_ONLY` and its
   margin `NOT_COMPUTABLE`. **This is a pass, not a failure** — there is no
   unit link on `purchase_history` and inventing one would be the defect.

**Audit rows expected** `WhatsApp BDC AI Agent` SUCCESS · `NEXUS Master Lead
Router` SUCCESS or PARTIAL · `Lead Escalation` SUCCESS · `Sync Closed-Won Deals`
SUCCESS · `Ask-AI RAG` SUCCESS · `wf_108 ERP Sync` **FAILED, expected** — the
Bitrix write is the only entry in its `dropped[]`. Read the list, not the status.

**Failure / negative branch** `Guard Reply` suppresses a reply that contains a
cost or a finance figure; the run then records a `communication_logs` inbound row
and **no** outbound row, and the audit summary names the suppression.

**Cleanup** Standard teardown in FK order, plus the Storage prefix, plus
`update inventory set status='Available'` on the claimed unit. `audit_log`
retained.

**Six paths**

| path | for this journey |
|---|---|
| Happy | As above. |
| Negative | `Guard Reply` suppresses a cost-leaking reply; nothing outbound is logged. |
| Retry | Post the same `body.payload.id` twice, 1 ms apart, from two sources — the live two-WAHA shape. `Claim Message Id` must hold: `processed_messages` +1, not +2. `communication_logs` inbound must also be +1, which is the check `Log Incoming Message` is expected to **fail** today (no `external_message_id`). |
| Duplicate | Submit closed-won four times from the dashboard. `purchase_history` +1, `deals_embeddings` +1. |
| Unauthorised | `POST /webhook/deals/closed-won` with no `Authorization`; and `POST /webhook/ask-ai` with another tenant's JWT. Refused, and no row in `purchase_history`, `deals_embeddings` or `rag` audit. |
| Missing-data | Inbound message with no `body.session`; `Resolve Tenant` must halt rather than pick a dealership. Lead with no email; `purchase_history` write must refuse rather than synthesise one. |

---

## J-CUST-02 — Finance that computes

**Actor** A first-time buyer with a trade-in and an outstanding loan.
**Tenant** `staging-alpha`. **Trigger** WhatsApp WARM enquiry, then a finance
request submitted from the Finance Desk with `Authorization: Bearer <JWT>`.

**Modules** Finance Desk (Deal Finance), Conversations, Leads.

**Workflows and named nodes**
Finance Calc: `Webhook Trigger` → `Verify JWT` → `Tenant For JWT User` →
`Resolve Tenant` → `Calculate Equity & Tier` → `Quote Valid?`(T) → `Log Quote` →
`Return Quote` → `Delivery Report` → `Audit Log`. The sub-workflow entry
`Called as Tool` is exercised **on staging only**, through the BDC's
`finance_calculator` tool.
Master Router: `Intent Switch`(WARM) → `WARM: Already In A Live Chat?` →
`WhatsApp BDC (WARM)`.

**Database mutations** `finance_quotes` +1 carrying `calculation_id` and
`execution_id`; `audit_log` +1 SUCCESS.

**Assertions**
1. Positive equity is computed and stored; LTV and finance tier are present.
2. Every figure the Finance Desk renders carries a `calculation_id` and an
   `execution_id`. **No frontend-computed number appears anywhere** — without
   that evidence there is no number, not even "indicative".
3. The `finance_quotes` row survives the assertion window. The insert path has
   worked repeatedly (25 inserts / 15 deletes recorded in `pg_stat_all_tables`
   on 3 Sep) but the constraint fix that unbroke it is younger than the last
   failure and has not been exercised since — so **the first thing this journey
   establishes is whether the insert works today**.
4. `Delivery Report` distinguishes a lost row from a refused quote. `Log Quote`
   swallows its own failure, so a dropped insert must not report SUCCESS.

> **BLOCKED BY MISSING CAPABILITY — the lender decision.**
> "Loan approved" cannot be tested. `finance_quotes` has 35 columns and **not
> one of them records a lender, a decision, a decided-at or conditions**
> (`v_deal_rescue_readiness.FINANCE_DECISION`, measured 2026-09-04 07:56 UTC).
> There is no bank integration. What this journey proves is that NEXUS
> **computes an indicative quote**, which is a different and smaller claim.
> The test of the missing half is that the Finance Desk and Deal Rescue say
> `FINANCE_BLOCKED` is unreachable and render no decision — not that they show
> a blank or a zero.

**Failure branch** covered by J-CUST-03.

**Six paths**

| path | for this journey |
|---|---|
| Happy | Positive equity, valid quote, row lands, `calculation_id` present. |
| Negative | See J-CUST-03. |
| Retry | Re-POST the identical body; assert `finance_quotes` +1 total, not +2. |
| Duplicate | Operator submits the same quote twice from the Finance Desk. |
| Unauthorised | No JWT, and a JWT belonging to `staging-bravo`. Refused; `finance_quotes` unchanged for both tenants. |
| Missing-data | Omit `creditScore`. The tier must render `NOT_COMPUTABLE`, never a default. |

---

## J-CUST-03 — Finance refused

**Actor** A buyer heavily upside-down on an existing loan.
**Tenant** `staging-alpha`. **Trigger** Finance Desk submission.

**Modules** Finance Desk.

**Nodes** Finance Calc `Calculate Equity & Tier` → `Quote Valid?`(**F**) →
`Delivery Report` → `Audit Log`.

**Database mutations** In the validation-refusal case: **no `finance_quotes`
row**, one `audit_log` row with status `REJECTED_EXPECTED`.

**Assertions**
1. Negative equity is computed and reported as negative — never floored at zero.
2. A vehicle valuation below the floor is refused with the calculator's own
   message, and the audit row says `REJECTED_EXPECTED`, **not `FAILED`**. This
   is the single most important assertion in the journey: a correct refusal
   recorded as a failure poisons the workflow-health numbers and trains the team
   to ignore red.
3. The worst finance tier and highest indicative APR are shown **with the
   disclaimer**, and both carry a `calculation_id`.

**Audit rows** `Finance Calc` `REJECTED_EXPECTED`. Note the live health figures
for context: 65 runs, 36 `REJECTED_EXPECTED`, 21 `NO_RESULT`, 3 SUCCESS —
`success_rate_30d` 10.3 %, health `DEGRADED`. Most of those refusals are
correct; the metric is not.

**Six paths**

| path | for this journey |
|---|---|
| Happy | (This journey's happy path *is* the refusal.) Refusal returned, reason readable, no row written. |
| Negative | The inverse: a valid quote must not be refused. Run one borderline-valid case and assert it is accepted. |
| Retry | Refusal replayed; still no row, still one audit row per call. |
| Duplicate | Two identical refused submissions; `finance_quotes` still 0. |
| Unauthorised | Refused before `Calculate Equity & Tier` runs; assert no audit row claiming a calculation. |
| Missing-data | Omit `vehicleValue` entirely. Must refuse for want of the field, and say which field. |

---

## J-CUST-04 — Document rejected, then resubmitted and accepted

**Actor** A buyer whose first identity document is unreadable.
**Tenant** `staging-alpha`. **Trigger** WhatsApp image, then a second image
after the bot asks again; the resubmission is also driven once through
`POST /webhook/audit-kyc` so the webhook entry is exercised.

**Modules** Compliance (Risk Control), Conversations.

**Nodes** KYC/AML: `ReceiveDocument` → `Verify JWT` → `Tenant For JWT User` →
`Auth Gate` → `Prepare Document` → `OpenRouter Vision (KYC Analysis)` →
`Parse JSON Output` → `Is An Identity Document?`(T) → `Validation Check`(**F**)
→ `Rejected` → `Count Previous KYC Rejections` → `Decide: Re-ask or Escalate` →
`Within Retry Limit?`(**T**) → `WhatsApp: Request Re-upload` → `Log KYC Re-ask`
→ `Delivery Report (KYC Re-ask)`; and on the second document
`Record KYC (Rejected)` → `Delivery Report (KYC Rejected)` for attempt 1, then
the `Approved` path for attempt 2.

**Database mutations** `kyc_documents` +2: attempt 1 `verdict='REJECTED'` with a
readable `remarks`, attempt 2 `verdict='APPROVED'` with `attempt_number=2` and a
`storage_path`. `communication_logs` +2 outbound.

**Assertions**
1. `attempt_number` increments to exactly 2 — the counter is per identity, not
   per message.
2. The rejection reason is readable by a human and names *why* (clarity,
   expiry), not a code.
3. The re-upload prompt actually reaches the customer channel and is logged.
4. The approved row has a `storage_path` and the object exists.

**Audit rows** The KYC auditor writes **no `audit_log` rows** — its verdict
lives in `kyc_documents.remarks`. Do not score it on an audit row that was never
designed to exist. Its live health reads 12 runs, 0 successes, 2 escalations,
`DEGRADED`; that figure is derived from the escalation path only.

**Six paths**

| path | for this journey |
|---|---|
| Happy | Reject → re-ask → approve on attempt 2. |
| Negative | Attempt 2 also fails; the loop must re-ask again rather than approve to make progress. |
| Retry | The same image delivered twice by WAHA; `kyc_documents` +1 for that attempt, not +2, and `attempt_number` does not double-increment. |
| Duplicate | The customer sends the same good document twice after approval. No second APPROVED row, no second Storage object. |
| Unauthorised | `POST /webhook/audit-kyc` with no JWT. `Auth Gate` refuses **and** no `kyc_documents` row and no Storage object are created by the execution that started anyway. |
| Missing-data | An image with no readable expiry date. Verdict must be REJECTED with the field named — never APPROVED with a guessed date. |

---

## J-CUST-05 — Document rejected to exhaustion, then retention purge

**Actor** A buyer whose documents never pass.
**Tenant** `staging-alpha`. **Trigger** One non-document image (a utility bill),
then four rejectable identity documents.

> The counts matter and have been wrong before. `Record Non-Document` consumes
> **no** attempt, and `withinLimit` is `nextAttempt <= MAX_ATTEMPTS` with
> `MAX_ATTEMPTS = 3` — so rejections 1–3 all re-ask and only the **fourth**
> escalates. Four rejectable documents, plus the non-document.

**Modules** Compliance, Settings (retention), Automation, Overview.

**Nodes** KYC/AML `Is An Identity Document?`(F) → `Record Non-Document` →
`Delivery Report (Non-Document)`; then the reject loop to
`Within Retry Limit?`(**F**) → `Slack: KYC Escalation` → `Log KYC Escalation` →
`Delivery Report (KYC Escalation)`.
Then **NEXUS Retention Purge**, all 16 nodes: `Every Night 03:00` →
`Find Expired Documents` → `Collect Expired Paths` → `Delete Storage Objects` →
`Reconcile Storage Deletions` → `Anything Confirmed Deleted?` →
`Mark Rows Purged` → `Purge Verdict Clean?` → `Summarise Purge` →
`Prune Dedupe Guard` → `Find Archive Gaps` → `Any Gaps?` →
`Slack: Archive Gap Alert` → `Delivery Report` → `Log Purge to Audit`, and the
negative branch `Purge Failed — Rows NOT Marked`.

**Database mutations** `kyc_documents` +5 (one `REJECTED` non-document, three
`REJECTED`, one `ESCALATED` with `attempt_number=3`); after the purge,
`purged_at` set on the back-dated row and the Storage object gone.

**Assertions**
1. **The loop terminates.** This is where it previously ran forever.
2. `Record Non-Document` writes `verdict='REJECTED'` with the classification in
   `document_type` — not `NOT_A_DOCUMENT`, which violates the check constraint
   and produced an archive gap manufactured by the auditor itself.
3. Retention: the Storage object is deleted **first**, and only then is the row
   marked. Force the reverse — make the Storage delete fail — and assert the run
   lands on `Purge Failed — Rows NOT Marked` with the row left **unmarked**. A
   row marked purged whose object survives is an irreversible false compliance
   record.
4. Force one archive gap by hand (delete an object, leave the row) and assert
   `Slack: Archive Gap Alert` fires.

**Audit rows** `NEXUS Retention Purge` — note its live health is `NEVER_RAN`
(0 runs recorded). This journey would be its first.

**Six paths**

| path | for this journey |
|---|---|
| Happy | Four rejections then ESCALATED; later a clean purge. |
| Negative | Storage delete fails → rows NOT marked, and the audit says so. |
| Retry | The purge re-runs the next night over the same rows; no double-delete error, no second audit claim of the same deletion. |
| Duplicate | Two escalations for the same identity in one window; assert one Slack alert, not two. |
| Unauthorised | Purge is schedule-only; assert it cannot be driven by an unauthenticated call and that `Find Expired Documents` is scoped to one tenant. |
| Missing-data | A `kyc_documents` row with a null `storage_path`. It is an archive gap, not a purge candidate, and must be reported as a gap rather than silently skipped. |

---

## J-CUST-06 — Goes quiet, is chased, comes back

**Actor** A casual browser who stops replying.
**Tenant** `staging-alpha`. **Trigger** One low-intent WhatsApp message, then
silence.

**Modules** Campaigns (Revenue Activation), Leads, Lead Recovery, Automation.

**Nodes**
Master Router `Intent Switch`(COLD) → `Marketing Drip (COLD)` (fire-and-forget,
`waitForSubWorkflow:false`).
7-Day Warm Lead Drip, the full sequence: `Called by Master Router` →
`Resolve Tenant` → `Normalize Lead Input` → `Audit: Enrolled` → `Wait Day 1` →
`Comm Keys (Day 1)` → `Lead State (Day 1)` → `Replies Since Enrol (Day 1)` →
`Still Enrolled? (Day 1)`(T) → `Email: Welcome (Gmail)` → `Log Welcome Email` →
`Has WhatsApp? (Day 1)` → `WhatsApp: Welcome` → `Log WhatsApp Welcome` → the
Day 3, Day 5 and Day 7 blocks in the same shape → `Delivery Report` →
`Audit Log`.
Phase 6 Silence Detector, all 12 nodes.
Lead Escalation `Return Result` — the detector reads `escalated` from the
sub-workflow's payload, not from an exception.

**Clock changes, and putting them back.** The drip has **four** Wait nodes and
the production values are `Wait Day 1` = 1 day, `Wait Day 3` = 2 days,
`Wait Day 5` = 2 days, `Wait Day 7` = 2 days. `SILENCE_HOURS` in
`Find Silent Leads` is 12. Record the real values before shortening and restore
them after — a test config left in production is how a 7-day drip becomes a
2-minute spam cannon.

**Database mutations** `leads` +1 COLD · `communication_logs` +3 email legs,
+2 WhatsApp legs, +1 `internal` row prefixed `[SILENCE-ESCALATED]` ·
`audit_log` +2.

**Assertions**
1. The drip stops when the customer replies — `Still Enrolled?` false at the
   next gate, and `Stopped Report` fires. Covered in detail by J-DEALER-06.
2. The silence marker is written **once** and does not retire the lead from the
   safety net for a later episode: a marker only suppresses when it was written
   at or after the last real outbound.
3. The marker row is excluded from the outbound set, or `hours_silent` resets to
   zero and the lead is chased forever.
4. Identity: a WhatsApp-only lead with a LID chat id is matched through
   `whatsapp_contacts`. Assert the lead is found — the old code dropped every
   WhatsApp-only lead silently and the hourly job ran green with zero output.
5. Tenancy: seed the **same customer phone number** under both staging tenants
   and assert `staging-alpha`'s silent lead is still surfaced and that no part of
   `staging-bravo`'s message text reaches the escalation payload or the audit
   summary.

> **BLOCKED — the Silence Detector has no published version.**
> Measured 2026-09-04: workflow `B3TcpfzOMWj8oWgF` is `active:false` with
> `activeVersionId: null`. Its last successful run was **26 Aug 2026 19:03 UTC**,
> and `v_lead_recovery.silence_detector_state` reads `STALE` for every lead.
> `v_deal_rescue_readiness` records the same thing as
> `SILENCE_DETECTOR_RESUMED`, kind `OPERATIONAL` — "not code and not an
> integration; a paused workflow on the n8n box".
> **Note the contradiction worth fixing:** `workflow_registry` claims
> `is_active = true` for this workflow. The registry and the box disagree, and
> the dashboard reads the registry.
> Until it is published, the drip half of this journey runs and the recovery
> half is `BLOCKED`. Do not mark the journey PASS on the drip alone.

**Six paths**

| path | for this journey |
|---|---|
| Happy | COLD → drip runs all four legs → silence detected once → escalated once. |
| Negative | The customer replies on day 2; the drip must stop and no further leg fires. |
| Retry | The hourly detector runs twice over the same silent lead; exactly one `[SILENCE-ESCALATED]` row. |
| Duplicate | Two enrolments of the same lead; assert one drip in flight, not two. |
| Unauthorised | `POST /webhook/lead-trigger` with no JWT — refused, and no `Audit: Enrolled` row. |
| Missing-data | A phone-only COLD lead with no email. `Normalize Lead Input` requires one; the failure must be **loud and named**, not a silent drop. This is an open gap: a COLD WhatsApp lead currently gets nothing. |

---

## J-CUST-07 — Lost to a cheaper rival

**Actor** A price shopper who buys elsewhere.
**Tenant** `staging-alpha`. **Trigger** Three WhatsApp messages ending in a
refusal; then the operator marks the deal closed-lost from the Deals screen.

**Modules** Deals, Competitors (Market Intelligence), Leads, Overview.

**Nodes** WhatsApp BDC happy path; Master Router `Intent Switch`;
**no** Sync Closed-Won nodes at all.

**Database mutations** `leads.status` → `LOST`. Nothing else.

**Assertions — this journey is mostly negative, and that is the point**
1. **No `deals_embeddings` row.** The pgvector sync is closed-won only.
2. **No `purchase_history` row.**
3. The Silence Detector must **skip** a LOST lead: `Fetch Open Leads` filters
   `status != LOST` and `!= DISQUALIFIED` and `!= WON`.
4. The competitor price gap is visible on the Competitors screen **with its
   provenance** — see J-DEALER-08 for why that provenance is thin.
5. Nothing anywhere calls the loss "revenue". Estimated, attributed and confirmed
   are three different words.

**Audit rows** WhatsApp BDC SUCCESS. No deal-sync audit row — asserting its
absence is the test.

**Six paths**

| path | for this journey |
|---|---|
| Happy | Lead reaches LOST with a reason recorded. |
| Negative | Attempt the closed-won webhook against a LOST lead; assert it is refused or, if accepted, that the discrepancy is visible rather than silent. |
| Retry | Mark closed-lost twice; one status, one audit trail. |
| Duplicate | Two loss reasons submitted; last-write-wins is acceptable only if the history is legible. |
| Unauthorised | Another tenant's JWT marking this lead lost — refused, status unchanged. |
| Missing-data | Closed-lost with no reason. The screen must show "reason not recorded", not an invented one. |

---

## J-CUST-08 — The returning customer

**Actor** A customer with a prior purchase on file.
**Tenant** `staging-alpha`. **Trigger** A lead entering through the Master
Router's `Webhook Catch-All` with a Supabase session token.

> **Entry route matters.** `check_purchase_history` filters on email and a
> WhatsApp lead has none; pre-seeding a lead to supply one flips `matched_lead`
> to true, which switches the Router off entirely — `New Lead Worth Scoring?`
> requires `matched_lead === false`. So this journey enters through the Router
> webhook, not through WhatsApp.

**Modules** Customer 360 (Ownership Intelligence), Leads, Deals, Ask AI.

**Nodes** Master Router `Webhook Catch-All` → `Verify JWT` →
`Tenant For JWT User` → `Auth Gate` → `Validate & Enrich Input` →
`AI Lead Scoring Agent` → `Supabase Lead Lookup`, `check_purchase_history` →
`Parse AI Decision` → `Persist Lead (deterministic)` → `Intent Switch`(HOT).
WhatsApp BDC `Resolve Lead Identity`, `Fetch Thread History`.
Lead Escalation `get_lead_timeline`.
Customer 360, all 11 nodes: `Schedule Trigger` → `Get Customer Directory` →
`Normalise Customers` → `Split In Batches` → `Gmail - Get Emails`,
`Slack - Search Mentions` → `Merge Customer Data` → `Transform & Unify` →
`Supabase - Upsert Profile` → `Delivery Report` → `Audit Log`.

**Database mutations** `purchase_history` +1 seeded prior purchase (part of the
journey, wiped with it) · `leads` +1 HOT · `customer_360_profiles` +1.

**Assertions**
1. The scoring agent calls `check_purchase_history`, finds the prior purchase,
   and routes **HOT regardless of stated budget**.
2. `customer_360_profiles.customer_id` is the directory UUID and nothing else —
   never an email, never the empty string. Two key spaces in one unique column
   produced two profiles for one human that never converged.
3. **A failed Gmail or Slack read reports UNKNOWN, not 0.** Break the Gmail
   credential deliberately and assert `total_emails` keeps its previous value and
   the audit summary says `email count UNKNOWN`. A fabricated zero written
   nightly as if it were a measurement is the defect this asserts against.
4. `deals_embeddings` similarity surfaces the earlier deal.

> **BLOCKED at two tenants — Customer 360 goes silent, not wrong.**
> `nexus_scoped_tenant_id()` returns null for a `service_role` caller once more
> than one tenant is active, so on the two-tenant staging project the nightly
> batch syncs nobody and writes no audit row. Separately,
> `v_customer_directory` **does not expose `tenant_id`** at all, which is why
> the workflow's own comment says the batch must not be run with two
> dealerships. So on staging this half is `BLOCKED BY MISSING CAPABILITY`
> (missing: `tenant_id` on `v_customer_directory`), and the assertion is that it
> writes **nothing** and says so — not that it writes rows under a guessed
> owner. Live health for context: 29 runs, 18 PARTIAL, 9 SUCCESS, `DEGRADED`,
> last success 26 Aug.

**Six paths**

| path | for this journey |
|---|---|
| Happy | Prior purchase found; HOT override applied; profile aggregates. |
| Negative | No prior purchase — the override must **not** fire, and the lead scores on its merits. |
| Retry | The nightly batch runs twice; `customer_360_profiles` +1, not +2 (`on_conflict=tenant_id,customer_id`). |
| Duplicate | The same human reachable by both email and phone; one profile row, not two. |
| Unauthorised | Router webhook with `staging-bravo`'s JWT against an alpha lead — refused, no lead written. |
| Missing-data | A directory row with no id. It must **not** be synced at all; a profile keyed by something that is not an identity is worse than no profile. |

---

## J-CUST-09 — Noise, a stranger, a voice note, and a question we cannot answer

**Actor** Wrong-number and off-topic traffic, then a genuine enquiry.
**Tenant** `staging-alpha`. **Trigger** Six inbound events in sequence.

| # | what is sent | expected behaviour |
|---|---|---|
| 1 | An uncaptioned photo of a landscape | **Silence.** The placeholder text contains the word "document"; it must not pass the keyword allowlist. |
| 2 | `hi` | **Silence** — no keyword, not a lead. |
| 3 | A voice note asking about a car in stock | Transcribed, then answered. |
| 4 | A message naming a **brand** in the allowlist | Answered. Model names are *not* in the allowlist — check any new wording against it or the test fails for the wrong reason. |
| 5 | A photo of a credit card | Recorded as a non-document; **must not** be archived as KYC. |
| 6 | A message that no policy or brand keyword matches | `Parse AI Decision` cannot classify → `Slack: Unclassified Lead`. |

**Modules** Conversations, Compliance, Ask AI, Automation, Settings.

**Nodes** WhatsApp BDC: `WAHA Auth Gate`, `Prefilter`, `Is Real Inbound?`,
`Reply Eligibility`, `Should The Bot Reply?`, and the whole voice chain —
`Is Voice Note?` → `Download Voice Note` → `Prepare Voice Upload` →
`Voice Is Usable?`(both branches) → `Transcribe Voice (Groq)` →
`Merge Voice Transcript`.
KYC/AML `Is An Identity Document?`(F) → `Record Non-Document` →
`Delivery Report (Non-Document)`.
Master Router `Parse AI Decision` → `Slack: Unclassified Lead`.
Ask-AI `Docs Found?`(**F**) → `Delivery Report`; and `Verify JWT` →
`Auth OK?`(F) → `Respond 401`.

**Assertions**
1. Steps 1 and 2 produce **no outbound row and no lead**. Two wrong numbers were
   quarantined as `DISQUALIFIED` on 28 Aug for exactly this reason.
2. The credit-card photo produces a `kyc_documents` row with
   `verdict='REJECTED'` and the classification in `document_type`, and **no
   Storage object**.
3. **The anti-hallucination test.** Ask AI a question the corpus cannot answer.
   The answer must be "I don't know / not in company documents", with **no
   citation and no invention**. A confident answer with a fabricated page number
   fails the journey outright.
4. An unauthenticated `POST /webhook/ask-ai` returns 401 from `Respond 401` and
   writes no audit row claiming an answer.

> Staging note: `rag_documents` on `wwspuxrbiyagnrnzgate` holds **0 rows**
> (production holds 15). Every Ask AI assertion is `BLOCKED` on staging until
> the corpus is seeded there, and seeding it is part of the journey fixture, not
> a side effect.

**Six paths**

| path | for this journey |
|---|---|
| Happy | The genuine enquiry is answered from real stock; the voice note is transcribed. |
| Negative | Every silence case stays silent. |
| Retry | An unusable voice note; `Voice Is Usable?` false must not retry forever. |
| Duplicate | The same landscape photo twice; still silence, and `processed_messages` +1. |
| Unauthorised | `POST /webhook/whatsapp-inbound` with no shared secret. **This is the path that currently cannot fail** — see Part 7. |
| Missing-data | A message with no body at all. `Prefilter` must drop it without an execution that writes rows. |

---

## J-CUST-10 — Asks for stock we do not have, then for things NEXUS cannot know

**Actor** A buyer who wants a model not in stock, then asks four questions the
system has no data for.
**Tenant** `staging-alpha`. **Trigger** WhatsApp.

**Modules** Inventory, Conversations, Customer 360, Deals.

**Nodes** WhatsApp BDC `search_inventory` returning **no match**, then
`AI BDC Sales Agent` → `Guard Reply` → `Send Reply via WAHA HTTP API`.

**Assertions — part one, the hallucination test**
1. `search_inventory` returns nothing and the agent **says so** rather than
   inventing a vehicle. This is the empty-result handling test.
2. The alternatives it offers are real rows from `inventory`, checkable by id.

**Assertions — part two: BLOCKED BY MISSING CAPABILITY, by design**

This is the journey where the customer asks for the things NEXUS does not have,
and the whole test is that NEXUS refuses cleanly. Verified against the live
schema on 2026-09-04, not taken on trust:

| the customer asks | missing capability, measured | required answer |
|---|---|---|
| "Can I book a test drive on Saturday?" | **No `appointments` table.** `v_deal_rescue_readiness.APPOINTMENT` — kind `INTEGRATION`, `measured_now: "public.appointments: does not exist"`. Zero columns matching `appoint` anywhere in `public`. | `NOT AVAILABLE` — appointments are not connected. Never a confirmed slot, never a fabricated calendar entry. |
| "When is my car due for a service?" | **No service table.** Zero tables and zero columns matching `service` in `public`. | `NOT AVAILABLE`. |
| "What is my old car worth as a trade-in?" | **No trade-in valuation.** The only trade-related column in the whole schema is `finance_quotes.trade_in_equity_applied_aed` — an input to a calculation, not a valuation. | `UNKNOWN` — NEXUS may compute equity **from a value the customer supplies**, and may not produce a market value of its own. |
| "What did you pay for it — what's your real margin?" | **No `recon_cost` column.** Zero columns matching `recon` in `public`; true margin is not computable. | Refuse. `cost_aed` is internal and `Guard Reply` exists because it leaked once already. |

**The test is the refusal.** A pass requires the words `NOT AVAILABLE`,
`UNKNOWN` or an equivalent explicit refusal. A `0`, a blank, a "no upcoming
appointments" or a plausible trade-in figure is a **FAIL**, because each of
those asserts something the database cannot support. Unknown is not none.

**Six paths**

| path | for this journey |
|---|---|
| Happy | (Here the happy path is the honest refusal.) No stock match, real alternatives offered, four capabilities refused by name. |
| Negative | Ask for a model that **is** in stock; assert it is found, so the refusal above is not simply the agent failing at everything. |
| Retry | Same question twice; the same refusal, not a different one. An answer that varies between runs is an invented answer. |
| Duplicate | The same enquiry from two channels; one lead, not two. |
| Unauthorised | Covered by J-CUST-09. |
| Missing-data | Ask about a unit id that does not exist. Must say the unit is unknown, not return the nearest match as if it were the one asked for. |

---

## J-DEALER-01 — Onboarding a second dealership

**Actor** The platform operator adding Bravo Autos alongside Alpha Motors.
**Tenant** Both — this journey is *about* the boundary.
**Trigger** Manual: create the tenant, the member and the capability rows, then
set `NEXUS_TENANT_MAP` to hold **two** keys and restart n8n.

**Modules** Settings (Control Plane), and every tenant resolver in the system.

**Nodes** Every `Resolve Tenant` and `Tenant For JWT User` node on the box:
Finance Calc `Resolve Tenant` + `Tenant For JWT User`; 7-Day Drip
`Resolve Tenant`; wf_108 `Resolve Tenant`; WhatsApp BDC `Resolve Tenant`;
Master Router `Tenant For JWT User`; KYC/AML `Tenant For JWT User`; Ask-AI
`Tenant For JWT User`; Slack Command Center `Tenant For JWT User`; Sync
Closed-Won `Tenant For JWT User`; WhatsApp Send `Tenant For JWT User`;
Inventory Ageing `Units Per Tenant` + `Group By Tenant`.
Plus NEXUS Public — Home / Privacy / Terms (`In` → `Out` on each), because a
dealership going live needs its privacy and terms pages reachable.

**Assertions — this is the rehearsal, and it must happen on staging**
1. **The moment `NEXUS_TENANT_MAP` holds two keys, roughly fifteen code paths
   switch from "the only dealership" to "unresolved" at once.** Enumerate which
   ones, by running each workflow once and reading its `tenant_source`.
2. `Inventory Ageing Recompute` emits **one audit row per tenant**, each quoting
   only its own unit count. One row spanning both is a fail — Alpha must never
   see a number that includes Bravo's cars.
3. `tenants.is_unattributed_default`: with two dealerships an omitted
   `tenant_id` lands in whichever holds the flag. Assert either a quarantine
   tenant holds it or every omission has been converted to an explicit null.
   Measured on production today: **1 tenant, and it holds the flag.** On staging,
   neither of the two does.
4. **`workflow_registry` is readable by every signed-in user and has no
   `tenant_id` column.** Its policy is `SELECT USING (true)` for
   `authenticated`, and it holds the real n8n workflow ids, names, trigger detail
   and `is_active` flags. Sign in as Bravo and read it; today Bravo sees Alpha's
   automation configuration. `QUALITY_GATE.mjs` check **L2** is deliberately red
   on this row. Assert the finding is still visible and has not been absorbed
   into an exemption list.
5. `select * from public.nexus_tenancy_readiness();` — read it knowing its
   remaining BLOCKER fires whenever any tenant holds the default flag and that
   it cannot see n8n at all, so it will not clear from workflow work.
6. Cross-tenant probe: as Bravo, attempt read, insert, update and delete against
   each of Alpha's rows. Record **which lock refused each verb** — `42501` is a
   grant, "0 rows" is only RLS. An incidental lock is not a designed lock.

**Six paths**

| path | for this journey |
|---|---|
| Happy | Two tenants active; every workflow resolves the right one; no audit row spans both. |
| Negative | A workflow that cannot resolve a tenant **halts** rather than defaulting. `channel_registry` returns a set, so unresolved is zero rows and the branch stops. |
| Retry | Restart n8n twice; resolvers are stateless and give the same answer. |
| Duplicate | Add the same tenant slug twice; refused by the unique key. |
| Unauthorised | Bravo's JWT against Alpha's data across all ten JWT-guarded webhooks. Every one refuses, and none writes. |
| Missing-data | `NEXUS_TENANT_MAP` set but malformed. Every resolver must fall to `unresolved` and say so — not silently to the built-in single-tenant map. |

---

## J-DEALER-02 — Inventory profit actions: propose, decide, execute

**Actor** A sales manager working the Profit Sentinel queue.
**Tenant** `staging-alpha`. **Trigger** Nightly recompute, then dashboard
actions.

**Modules** Inventory (Profit Sentinel), Action Center, Revenue.

**Nodes** Inventory Ageing Recompute, all 5: `Every night at 00:15` →
`Recompute Inventory Ageing` → `Units Per Tenant` → `Group By Tenant` →
`Audit Log`.

**Database mutations** `inventory` derived columns refreshed ·
`inventory_actions` +1 per proposal, moving through decide and execute ·
`inventory_action_events` +1 per transition · `audit_log` +1 per tenant.

**Assertions**
1. **Every one of the tenant's units gets a recommendation**, not the first one.
   The scrape-shaped bug — a Code node in all-items mode reading `$json`, which
   is only the FIRST item — has bitten twice in this codebase.
2. The propose → decide → execute lane runs behind `SECURITY DEFINER`
   functions, and `action_approver_context()` refuses an approver who is not
   entitled.
3. **Economics are gated.** With no configured holding rate the screen renders
   `NOT_COMPUTABLE`, never zero. Clear `inventory_profit_settings` and assert the
   refusal (gate checks `L6`, `R4`, `S5`).
4. Nothing here writes `inventory.price_aed`. The competitor scraper's
   `Should Update Price?` branch was **severed on 26 Aug** because it was
   rewriting our own list prices to `competitorPrice − 1` every night, reading
   its own previous write as input — a monotonic downward ratchet that recorded a
   385,000 Land Cruiser at 290,000. It has no inbound edge and is not in the
   published node list. **If anyone reconnects it, stop them.**

Reference figures, production, 2026-09-04: `v_inventory_profit_sentinel` = 12
units, `v_inventory_action_queue` = 3, `inventory_actions` = 3, and the ageing
workflow reads `HEALTHY` at 100 % over 21 runs — the strongest thing in the
product.

**Six paths**

| path | for this journey |
|---|---|
| Happy | 12 units recomputed, a proposal decided and executed, events recorded. |
| Negative | Execute an action the approver may not approve; refused, and the refusal recorded as a refusal. |
| Retry | The nightly recompute runs twice; derived columns converge, audit rows +1 per tenant per run. |
| Duplicate | The same action proposed twice on one unit; one open action. |
| Unauthorised | `authenticated` calling the action functions directly. Note `inventory` deliberately keeps `arwd` for the unit form, so this path must prove the *function* refuses, not the table. |
| Missing-data | A unit with no `cost_aed`. Margin renders `NOT_COMPUTABLE`; the unit is not silently dropped from the queue. |

---

## J-DEALER-03 — Lead recovery from the desk

**Actor** A BDC manager working the recovery queue.
**Tenant** `staging-alpha`. **Trigger** A web-form HOT lead posted to
`POST /webhook/nexus-inbound-lead` with a Supabase JWT — a lead that is **not**
already in a live chat, which is the branch J-CUST-01 does not take.

**Modules** Lead Recovery, Leads, Team, Conversations.

**Nodes** Master Router `Webhook Catch-All` → `Verify JWT` →
`Tenant For JWT User` → `Auth Gate` → … → `Intent Switch`(HOT) →
`HOT: Already In A Live Chat?`(**F**) → `WhatsApp Outreach (HOT)`,
`ERP Sync (HOT)`, `Slack Router (HOT)`.
WhatsApp BDC `Called by Master Router` → `Extract Message & Sender` →
`Recent Outreach Check` → `Skip Duplicate Outreach`.
Lead Escalation `EscalationWebhook` → `Verify JWT` → `Auth Gate` →
`Fetch Escalated Lead` → … → `find_available_rep` → `Fetch Rep Slack Id` →
`Send a message`.
wf_108 `ErpSyncWebhook` → `Verify JWT` → `Auth Gate` → `Resolve Tenant` →
`Fetch HOT Leads from Supabase`.

**Database mutations** `leads` +1 HOT assigned · `lead_recovery_actions` +1
through its lane · `lead_recovery_action_events` +1 per transition ·
`communication_logs` +1 outbound outreach.

**Assertions**
1. The outbound outreach fires exactly once. `Skip Duplicate Outreach` is the
   control; assert zero `'[system] Initial outreach…'` duplicates.
2. The re-entry loop is bounded at one pass: the internal branch rewrites the
   item to `direction:'outbound'` and `New Lead Worth Scoring?` requires
   `inbound`.
3. The escalation names a **real rep with a real `slack_user_id`**. An alert that
   tags nobody is a failed escalation, not a passed one.
4. `v_lead_recovery` shows the lead with a reason and an owner. Production today:
   3 leads, queue **0** — the mechanics render, there is nothing to recover, and
   volume arrives with the first dealership.

**Six paths**

| path | for this journey |
|---|---|
| Happy | HOT web lead → outreach + Slack + assignment, one of each. |
| Negative | A lead already in a live chat takes the `HOT: Already In A Live Chat?` true branch and gets **no** duplicate outreach. |
| Retry | Post the same lead payload twice; `leads` +1, one outreach. |
| Duplicate | Two reps claim the lead; one assignment wins and the loser sees why. |
| Unauthorised | `POST /webhook/lead-escalation` and `/webhook/erp-sync` with no JWT. Both refuse. Assert no `leads` row and no `audit_log` row claiming an escalation. |
| Missing-data | A lead with no phone and no email. The router must refuse to persist an identity-less lead rather than synthesising one. |

---

## J-DEALER-04 — Deal Rescue, the refusal branch

**Actor** The owner opening Deal Rescue expecting a pipeline.
**Tenant** `staging-alpha`. **Trigger** Opening `screens/deal-rescue.js`.

**Modules** Deals, Deal Rescue.

**Nodes** None. This journey exercises no n8n node, and saying so is part of the
point: it is a database-and-screen journey.

**Assertions**
1. `v_deal_rescue` returns **0 rows**, and the screen says why rather than
   rendering an empty table that reads as "no deals at risk".
2. `v_deal_rescue_readiness` renders **nine named prerequisites**, each with what
   it unlocks, why it is not merely code, and what was measured. Verified live
   2026-09-04 07:56 UTC — all nine `met_now = false`:

| id | kind | measured_now |
|---|---|---|
| `DEAL_RECORD` | SCHEMA | `public.deals: does not exist` |
| `DEAL_STAGE_HISTORY` | SCHEMA | `0 column(s) named "stage" anywhere in schema public` |
| `APPOINTMENT` | INTEGRATION | `public.appointments: does not exist` |
| `FINANCE_DECISION` | SCHEMA | `0 live finance_quotes row(s); 0 decision-shaped column(s)` |
| `DEAL_TO_UNIT_LINK` | SCHEMA | `0 unit-link column(s) on purchase_history` |
| `SILENCE_DETECTOR_RESUMED` | OPERATIONAL | `STALE, last success 2026-08-26 19:03:30+00` |
| `DEAL_OWNER` | DATA | `2 of 3 lead(s) unassigned` |
| `ACTION_LANE` | PRODUCT | `public.deal_rescue_actions: does not exist` |
| `VOLUME` | DATA | `3 lead(s), 1 sale(s), 0 finance quote(s)` |

3. `v_deal_rescue_candidates` returns **8** rows while `v_deal_rescue` returns
   **0**. Assert the screen does not present candidates as deals. A candidate is
   a lead that would become a deal if a deal record existed; presenting eight of
   them as a rescue pipeline is exactly the fabrication this journey tests
   against.
4. Nothing on the screen quotes a monetary figure for a deal at risk.

**This is the demoable version of Deal Rescue.** Demo it as the product refusing
to invent a pipeline, which is a different and more sellable thing than a
working engine.

**Six paths**

| path | for this journey |
|---|---|
| Happy | Zero rows, nine prerequisites, an explicit refusal. |
| Negative | Seed a `deal_rescue_states` row by hand and assert the view still returns 0 — state definitions are not deals. |
| Retry | Reload; identical output, and `measured_at` advances (the readiness view measures live, it does not cache a claim). |
| Duplicate | Two operators open it at once; same answer. |
| Unauthorised | Bravo opens Deal Rescue; sees Bravo's zero, not Alpha's. |
| Missing-data | This journey **is** the missing-data path. Every prerequisite must name its missing thing; a prerequisite that says only "not met" fails the assertion. |

---

## J-DEALER-05 — Deal Rescue, the working branch

> ### BLOCKED BY MISSING CAPABILITY

**What is missing** `public.deals` — a deal record created at first commitment
rather than at sale, carrying customer, vehicle, agreed value and an owner. It
does not exist. `purchase_history` holds one row written at the moment of sale,
with `deal_id` synthesised then as `auto:<email>|<date>`, so `DEAL_CREATED` and
`SALE_CONFIRMED` are one event and `DEAL_UPDATED` is emitted by nothing.

**Also missing, and each independently blocking**: `DEAL_STAGE_HISTORY`,
`APPOINTMENT`, `FINANCE_DECISION`, `DEAL_TO_UNIT_LINK`, `ACTION_LANE`
(`deal_rescue_actions` deliberately not built on 3 Sep), and the operational
`SILENCE_DETECTOR_RESUMED`.

**Why this is written as a journey at all.** Because the states it would
exercise — `ON_TRACK`, `AT_RISK`, `STALLED`, `CUSTOMER_GHOSTED`,
`FINANCE_BLOCKED`, `NEEDS_MANAGER` — are the ones a buyer asks about, and the
list of what each one needs is the sales answer. It stays in the plan as
`BLOCKED`, with its prerequisites named, rather than being quietly dropped so
the matrix looks complete.

**The test that can run today** is J-DEALER-04's: NEXUS says the engine is not
available and names the nine reasons, rather than inventing a pipeline.

**What would unblock it, in order** `DEAL_RECORD` (one integration with whatever
the sales floor actually uses — the table is cheap, deciding who writes it and
when is the work), then `DEAL_TO_UNIT_LINK`, then `APPOINTMENT`, then
`FINANCE_DECISION`. `ACTION_LANE` is a near-copy of the lead-recovery lane and
should be built the day `DEAL_RECORD` lands, not before.

**Status** BLOCKED. It does not become `NOT RUN`, and it never becomes `PASS`,
until a `deals` table exists and carries a row.

---

## J-DEALER-06 — A campaign, enrolled and stopped

**Actor** A marketing manager enrolling a warm lead, and the customer who
replies mid-campaign.
**Tenant** `staging-alpha`. **Trigger** `POST /webhook/lead-trigger` with a
Supabase JWT.

**Modules** Campaigns (Revenue Activation), Leads, Conversations.

**Nodes** 7-Day Warm Lead Drip: `DripWebhook` → `Verify JWT` →
`Resolve Tenant` → `Normalize Lead Input` → `Audit: Enrolled` → `Wait Day 1` →
`Comm Keys (Day 1)` → `Lead State (Day 1)` → `Replies Since Enrol (Day 1)` →
`Still Enrolled? (Day 1)`(**F**) → `Stopped Report` → `Delivery Report` →
`Audit Log`. Repeat the stop at the Day 3, Day 5 and Day 7 gates so all four
`Still Enrolled?` nodes take their false branch across the journey's four runs.

**Assertions**
1. A reply between two legs **stops the campaign at the next gate**. The
   customer must not receive a day-5 nudge after replying on day 4.
2. `Replies Since Enrol` counts replies **since enrolment**, not all history.
3. `Stopped Report` produces an audit row that says the campaign stopped and
   why — a stopped campaign is a success, not a failure.
4. A lead moving to `WON`, `LOST` or `DISQUALIFIED` also stops it.

**Live health for context** 8 runs, 8 failures, `success_rate_30d` **0.0 %**,
last success **null** — this workflow has never succeeded. That is the state
this journey starts from, and the first run should expect to fail and diagnose,
not to pass.

**Six paths**

| path | for this journey |
|---|---|
| Happy | Enrol, then reply; the campaign stops at the next gate with a `Stopped Report`. |
| Negative | Enrol a lead with no email; `Normalize Lead Input` refuses **loudly**, naming the missing field. |
| Retry | The webhook is called twice for one lead; one enrolment audit row, one campaign in flight. |
| Duplicate | Two managers enrol the same lead; the second must not start a parallel sequence. |
| Unauthorised | `POST /webhook/lead-trigger` with no JWT; refused, no `Audit: Enrolled` row. |
| Missing-data | A lead whose only address is the synthetic `+<digits>@whatsapp.lead`. The email legs would bounce against it; assert the run reports that rather than claiming a send landed. |

---

## J-DEALER-07 — Team performance, assignment and the Slack desk

**Actor** A sales manager assigning work and asking the Slack desk a question.
**Tenant** `staging-alpha`. **Trigger** Owner assignment from the lead drawer,
then `POST /webhook/slack-command` with a Supabase JWT.

**Modules** Team (Performance & Capacity), Overview, Leads.

**Nodes** Slack Command Center, all 16: `SlackWebhook` → `Verify JWT` →
`Tenant For JWT User` → `Auth Gate` → `Extract Command` → `Model Ladder` →
`AI CRM Agent` (+ `OpenRouter Chat Model`, `Groq Fallback`, `Simple Memory`,
`Search Leads`, `Update Lead Status`) → `Format Slack Response` →
`Post Answer to Slack` → `Delivery Report` → `Audit Log`.
Lead Escalation `find_available_rep` → `Fetch Rep Slack Id` → `Send a message`.

**Database mutations** `leads.assigned_to_id` set (a direct table write from
`lib/lead-drawer.js`, which is why `leads` keeps `rw` for `authenticated`) ·
`leads.status` updated by the agent tool · `audit_log` +1.

**Assertions**
1. `v_team_performance` computes from real rows and **refuses to present n=1 as a
   statistic**. Production has 1 user and 1 member; a "conversion rate" over one
   lead is not a rate.
2. `users.slack_user_id` is populated, so the escalation tags a person. It was
   empty until 28 Aug and every HOT escalation tagged nobody.
3. `Model Ladder` counts retries with `$runIndex`, not off the item. n8n's error
   output emits a fresh `{error:…}` item and carries no input json forward, so
   the old counter recomputed `attempt = 0` and looped a full agent invocation
   until the 300 s timeout — the exact load shape that has toppled this box
   twice. Assert the ladder terminates.

> **A lock on a door nobody has walked through.** This workflow's configuration
> is unambiguously Slack-called (`response_url`, Block Kit, slash-command
> fields), and it is gated by a **Supabase JWT** — which makes it uncallable
> *by Slack*. The real guard would be Slack request signing (HMAC of
> `v0:{timestamp}:{body}` against `X-Slack-Signature`). This journey drives it
> with a synthetic POST and a valid JWT, which exercises all 16 nodes and
> proves nothing about the Slack integration. **The Slack signing path is
> covered by no journey in this document**, and that is recorded rather than
> hidden.

**Six paths**

| path | for this journey |
|---|---|
| Happy | Assignment lands; the Slack desk answers from real leads and updates one. |
| Negative | Ask the desk about a lead in the other tenant; it must find nothing. |
| Retry | Force the primary model to fail; `Model Ladder` falls to `Groq Fallback` and terminates. |
| Duplicate | Two assignments of one lead; one owner, and the change is legible. |
| Unauthorised | `POST /webhook/slack-command` with no JWT. Note this endpoint is closed **by accident** — `Tenant For JWT User` lacks `alwaysOutputData:true`, so the chain halts before `Auth Gate` runs and unauthenticated probing records SUCCESS with no audit row. Assert both the refusal **and** that the recorded status is not a bare SUCCESS. |
| Missing-data | A rep with no `slack_user_id`. The escalation must say it could not tag anyone, not silently post an untagged message. |

---

## J-DEALER-08 — Market intelligence against a scraper producing nothing

**Actor** A used-car manager checking market position.
**Tenant** `staging-alpha`. **Trigger** The 05:00 / 17:00 Asia/Dubai schedule,
run manually.

**Modules** Competitors (Market Intelligence), Inventory.

**Nodes** Competitor Price Scraping, all 10: `Schedule Trigger` →
`Fetch Local Inventory` → `Build Apify Query` →
`Apify - Search Competitor Price` → `Extract Price with AI` → `Parse AI Price` →
`Is This Real Intel?`(both branches) → `Log Competitor Intel` →
`Delivery Report` → `Audit Log`.

**Assertions**
1. `Build Apify Query` scans **every** unit and `Parse AI Price` parses **every**
   page. Both were Code nodes in all-items mode reading `$json` — the FIRST item
   only — so one unit of twelve was priced and one page of sixteen parsed, and
   both went green because one in and one out looks like success.
2. Prices are taken from **schema.org JSON-LD** (`@graph.itemListElement[].item.offers.price`)
   where the page publishes it, and the source from `metadata.url` — not read
   back by an LLM from the first 6000 characters of markdown.
3. `Is This Real Intel?` **rejects** a bot-detection interstitial, a page with no
   price, a page with no identifiable seller, and a search or social host. The
   first real run after the fix filed `google.com` as a rival dealership quoting
   AED 105,200 for a Fortuner. Each rejection must carry a stated reason.
4. `"the source was the placeholder null"` is the guard **working**, not a bug.
   Do not treat it as a defect and do not weaken it.

**The honest commercial line.** `v_workflow_health` reads this workflow
`PRODUCING_NOTHING`: **161 no-result runs out of 180 in 30 days, 10.6 % success
rate**, last run 2026-09-04 01:00, zero failures. Production holds **16
competitor rows** and `v_competitor_latest` resolves **7** of them. Market
Intelligence is a screen, not a capability, until the scraper returns prices.
The journey asserts the screen says that.

**Six paths**

| path | for this journey |
|---|---|
| Happy | Twelve units queried, every scraped page parsed, usable rows written with a named seller and a source URL. |
| Negative | A bot-detection page is refused with its reason, and no row is written. |
| Retry | Two runs in one day; `competitors` does not accumulate duplicates for the same seller/unit/day. |
| Duplicate | The same listing found under two URLs; one intel row, or two that are visibly the same listing. |
| Unauthorised | Schedule-only; assert no webhook route reaches it. |
| Missing-data | A unit with no model text. It must be skipped with a reason, not queried as an empty string — an empty query returns the whole internet. |

---

## J-DEALER-09 — An operator replies, and the policy engine refuses

**Actor** A rep replying from the Conversations screen.
**Tenant** `staging-alpha`. **Trigger** `POST /webhook/whatsapp-send` with the
signed-in user's Supabase JWT.

**Modules** Conversations (AI BDC), Policy (Policy Engine), Settings.

**Nodes** WhatsApp Send, all 13: `Dashboard Send Webhook` → `Verify JWT` →
`Auth OK?` → `Tenant For JWT User` → `Prepare Send` →
`Has chat_id and text?` → `Send via WAHA` → `Log Outbound` →
`Delivery Report` → `Respond Sent`; plus `Respond Unauthorized`,
`Respond Bad Request`, `Respond Send Failed`.
WhatsApp BDC `Human Reply Check` → `Human Spoke Recently?` — after the operator
replies, the customer messages again and the bot must **stay quiet**.

**Database mutations** `communication_logs` +1 outbound with
`sent_by = <operator email>` · no `audit_log` row (this workflow writes none by
design; do not score it on one).

**Assertions**
1. The bot does not answer over a human. `Human Spoke Recently?` is the control.
2. `Respond Sent` distinguishes `sent` from `sent_but_not_logged`. A message that
   left but was not logged must not report plain success — the thread would
   silently lose it.
3. `Respond Send Failed` says **nothing was sent and nothing was logged — the
   message is still unsent.** Assert that wording reaches the operator, because
   a rep who thinks a message went will not resend it.

**The policy half.** Ask
`whatsapp_policy_decision_for_channel(...)` for this conversation and assert what
it returns. Measured on production 2026-09-04: `policy_rule` holds **13 rows,
0 `VERIFIED`**; `policy_platform_attestation` holds **0 rows**; and
`v_policy_authoritative` returns **0**. So **every conversation returns
`TEMPLATE_REQUIRED / WINDOW_RULE_NOT_VERIFIED` today.**

That is the engine being honest, and it is the single thing standing between
this layer and being usable. The assertions are:

4. The refusal names the rule it applied and that rule's verification status.
5. Withdrawing the 24-hour window rule produces
   `TEMPLATE_REQUIRED / POLICY_RULE_MISSING`, **not** a fallback to a hard-coded
   24. The number `24` appears in no function body; it lives in `policy_rule`
   under jurisdiction `PLATFORM_WHATSAPP`.
6. **A dealership cannot legislate as Meta.** As `authenticated`, attempt to
   propose and self-verify a `PLATFORM_WHATSAPP` rule with a 99999-hour window.
   It must be **unrepresentable**, not merely refused: a dealership row under
   `PLATFORM_WHATSAPP` cannot exist. A guard on scope is not a guard on
   authority.
7. A `TENANT_HOUSE` rule is applied only when **strictly stricter** than the
   platform's; a longer window is recorded as considered-and-ignored.
8. `whatsapp_message_usage` has **zero numeric columns** and the monthly rollup
   has no total. Assert no screen renders a messaging cost as `0` — `cost_state`
   distinguishes "awaiting a provider report", "provider reported no pricing",
   "provider said not billable" and "billable, amount unknown", and none of those
   is zero.
9. `whatsapp_template_sendability()` takes a staleness tolerance with **no
   default**. Assert the router refuses for want of one, and that a 40-day-old
   APPROVED template refuses. Production holds **0 `whatsapp_templates`** and
   `v_whatsapp_template_registry` returns 0, so this is tested against seeded
   staging rows.

**Six paths**

| path | for this journey |
|---|---|
| Happy | Operator reply leaves, is logged, and the bot stays quiet afterwards. |
| Negative | WAHA refuses the send; `Respond Send Failed` fires and **no** `communication_logs` row is written. |
| Retry | `Send via WAHA` has `retryOnFail` with 3 tries. Force a lost response and assert the customer does not receive the message twice. |
| Duplicate | The operator clicks send twice. Note the idempotency key includes `requested_by`, which is caller-declared and defaults to a placeholder — two nodes retrying under different names produce two sends, and a null `request_ref` disables idempotency entirely. Assert both cracks. |
| Unauthorised | No JWT → `Respond Unauthorized`; Bravo's JWT against Alpha's chat → refused before `Send via WAHA`. |
| Missing-data | Empty `text`, or a `chat_id` with no `channel_registry` entry. `Has chat_id and text?` refuses; the channel resolver returns zero rows and the branch halts rather than guessing a tenant. |

---

## J-DEALER-10 — The owner incident: a workflow fails and is retried

**Actor** The owner watching the Automation screen when something breaks.
**Tenant** `staging-alpha`. **Trigger** Deliberately point one HTTP node at an
unreachable host, run the workflow, then restore and re-run.

**Modules** Automation (Action Engine), Overview.

**Nodes** NEXUS Error Handler, all 3: `Any Workflow Failed` →
`Build Failure Row` → `Log Failure to audit_log`.
Plus the manual re-run entries that exist for exactly this: Lead Escalation
`Run Manually` → `Test Lead`; Ask-AI `Run Manually` → `Test Question`.

**Database mutations** `audit_log` +1 with `status='FAILED'`, the failing node
named, the execution id and url in the summary.

**Assertions**
1. The failure reaches `audit_log` and the Automation screen shows it. A failure
   only visible in n8n's execution list is invisible to the owner.
2. `tenant_id` is sent **explicitly, including as null**. An error trigger
   reports which workflow failed, not whose customer it was — so with two
   tenants configured the row must carry a null tenant and the summary must say
   `TENANT UNRESOLVED`, rather than being stamped with the unattributed default
   and putting one dealership's failures on another's screen.
3. Restore the host, re-run, and assert the retry writes a SUCCESS row **without
   removing the FAILED one**. The incident history is the product.
4. `v_workflow_health` moves for that workflow and the movement is legible.
5. Read the `Delivery Report` node's output, not the exit code. Since 26 Aug
   every workflow ends in one that names what it actually verified.

**A caution about the health numbers.** The Error Handler and the Infra Health
Probe both read `NOT_INSTRUMENTED` (0 runs) and WhatsApp Send reads
`NOT_INSTRUMENTED` because it writes no audit rows by design. Do not read
`NOT_INSTRUMENTED` as `broken` or as `fine`; it means the view has nothing to
judge.

**Six paths**

| path | for this journey |
|---|---|
| Happy | Failure caught, audited, visible, retried, resolved. |
| Negative | A workflow that fails **before** its error workflow is configured writes nothing; assert which workflows have `errorWorkflow` set and name the ones that do not. |
| Retry | The same failure recurs three times; three audit rows, and the screen groups rather than hides them. |
| Duplicate | Two workflows fail on the same upstream outage; two rows, each naming its own workflow. |
| Unauthorised | The error trigger has no webhook; assert no route reaches `Log Failure to audit_log` from outside. |
| Missing-data | A failure with no error message. The row must say `Execution failed with no error message`, not omit the failure. |

---

# Part 5 — The six paths, per journey

Defined generically in Part 3; the per-journey specifics are the six-row table
at the foot of each journey in Part 4. A journey is `PASS` only when all six
rows are `PASS`. Five of six is `FAIL`, not "mostly passing".

---

# Part 6 — The node coverage matrix

Every node below was read from the **published** definition on the live box on
2026-09-04, not from the repo copies in `n8n-workflows/` (which were exported
31 Aug and predate the 2–3 September tenancy wave).

Legend: **J-…** the journey that makes the node run · **NOT COVERED** no journey
reaches it, with the reason · **(blocked)** a journey is assigned but cannot run
today · branch markers `(T)` / `(F)` name which output the journey takes.

## 1. WhatsApp BDC AI Agent — `BiyHk9ZXxJUVGbf6` — active — 45 nodes

| # | node | journey | path |
|---:|---|---|---|
| 1 | WAHA Webhook (POST) | J-CUST-01 | happy |
| 2 | WAHA Auth Gate | J-CUST-09 | unauthorised — **gate is DORMANT**, see Part 7 |
| 3 | Prefilter | J-CUST-09 | missing-data |
| 4 | Resolve Tenant | J-DEALER-01 | happy |
| 5 | Is Real Inbound? | J-CUST-09 | negative |
| 6 | Claim Message Id | J-CUST-01 | retry / duplicate |
| 7 | Is New Message? | J-CUST-01 | retry |
| 8 | Called by Master Router | J-DEALER-03 | happy |
| 9 | Extract Message & Sender | J-CUST-01 | happy |
| 10 | Is Voice Note? | J-CUST-09 | happy (T) / J-CUST-01 (F) |
| 11 | Download Voice Note | J-CUST-09 | happy |
| 12 | Prepare Voice Upload | J-CUST-09 | happy |
| 13 | Voice Is Usable? | J-CUST-09 | happy (T) / retry (F) |
| 14 | Transcribe Voice (Groq) | J-CUST-09 | happy |
| 15 | Merge Voice Transcript | J-CUST-09 | happy |
| 16 | Is Document? | J-CUST-01 | happy (T) / J-CUST-09 (F) |
| 17 | Download KYC Image | J-CUST-01 | happy |
| 18 | Image To Base64 | J-CUST-01 | happy |
| 19 | Send to KYC Auditor | J-CUST-01 | happy |
| 20 | Fetch All Leads | J-CUST-01 | happy |
| 21 | Resolve Lead Identity | J-CUST-08 | duplicate |
| 22 | Upsert WhatsApp Contact | J-CUST-01 | happy |
| 23 | Log Incoming Message | J-CUST-01 | retry — expected to fail (no `external_message_id`) |
| 24 | New Lead Worth Scoring? | J-CUST-01 | happy |
| 25 | Shape Lead For Router | J-CUST-01 | happy |
| 26 | Score New Lead (Master Router) | J-CUST-01 | happy |
| 27 | Reply Eligibility | J-CUST-09 | negative |
| 28 | Recent Outreach Check | J-DEALER-03 | duplicate |
| 29 | Skip Duplicate Outreach | J-DEALER-03 | duplicate |
| 30 | Human Reply Check | J-DEALER-09 | happy |
| 31 | Human Spoke Recently? | J-DEALER-09 | happy |
| 32 | Should The Bot Reply? | J-CUST-09 | negative |
| 33 | Fetch Thread History | J-CUST-08 | happy |
| 34 | AI BDC Sales Agent | J-CUST-01 | happy |
| 35 | OpenRouter Chat Model | J-CUST-01 | happy |
| 36 | Groq Chat Model | J-CUST-01 | retry |
| 37 | Model Ladder | J-CUST-01 | retry |
| 38 | search_inventory | J-CUST-10 | missing-data (no match) |
| 39 | search_policy | J-CUST-01 | happy |
| 40 | finance_calculator | J-CUST-02 | happy — **staging only**, the WhatsApp finance path must not go live |
| 41 | Guard Reply | J-CUST-01 | negative (cost / EMI suppression) |
| 42 | Send Reply via WAHA HTTP API | J-CUST-01 | happy |
| 43 | Log Conversation | J-CUST-01 | happy |
| 44 | Delivery Report | J-CUST-01 | happy |
| 45 | Audit Log | J-CUST-01 | happy |

**45 covered, 0 uncovered.**

## 2. NEXUS Master Lead Router — `JnlZFAVmFAuNXVya` — active — 26 nodes

| # | node | journey | path |
|---:|---|---|---|
| 1 | Webhook Catch-All | J-DEALER-03 | happy |
| 2 | Verify JWT | J-DEALER-03 | unauthorised |
| 3 | Tenant For JWT User | J-DEALER-01 | happy |
| 4 | Auth Gate | J-DEALER-03 | unauthorised |
| 5 | Called Internally | J-CUST-01 | happy — the side door that bypasses `Auth Gate` |
| 6 | Validate & Enrich Input | J-CUST-01 | missing-data |
| 7 | AI Lead Scoring Agent | J-CUST-01 | happy |
| 8 | OpenRouter Chat Model | J-CUST-01 | happy |
| 9 | Groq Fallback | J-CUST-01 | retry |
| 10 | Model Ladder | J-CUST-01 | retry |
| 11 | Simple Memory | J-CUST-01 | happy |
| 12 | Supabase Lead Lookup | J-CUST-08 | happy |
| 13 | check_purchase_history | J-CUST-08 | happy |
| 14 | Parse AI Decision | J-CUST-09 | negative (unclassifiable) |
| 15 | Persist Lead (deterministic) | J-CUST-01 | happy |
| 16 | Intent Switch | J-CUST-01 (HOT) / J-CUST-02 (WARM) / J-CUST-06 (COLD) | happy |
| 17 | HOT: Already In A Live Chat? | J-CUST-01 (T) / J-DEALER-03 (F) | happy |
| 18 | WARM: Already In A Live Chat? | J-CUST-02 | happy |
| 19 | ERP Sync (HOT) | J-CUST-01 | happy — sub-workflow reports FAILED, expected |
| 20 | Slack Router (HOT) | J-CUST-01 | happy |
| 21 | WhatsApp Outreach (HOT) | J-DEALER-03 | happy |
| 22 | WhatsApp BDC (WARM) | J-CUST-02 | happy |
| 23 | Marketing Drip (COLD) | J-CUST-06 | happy |
| 24 | Slack: Unclassified Lead | J-CUST-09 | negative |
| 25 | Delivery Report | J-CUST-01 | happy |
| 26 | Audit Log | J-CUST-01 | happy |

**26 covered, 0 uncovered.**

## 3. KYC/AML Document Auditor + Re-upload Loop (Phase 5) — `qTnh3nwWheFJbFkU` — active — 32 nodes

| # | node | journey | path |
|---:|---|---|---|
| 1 | Called by Another Workflow | J-CUST-01 | happy |
| 2 | ReceiveDocument | J-CUST-04 | happy |
| 3 | Verify JWT | J-CUST-04 | unauthorised |
| 4 | Tenant For JWT User | J-DEALER-01 | happy |
| 5 | Auth Gate | J-CUST-04 | unauthorised |
| 6 | Prepare Document | J-CUST-01 | happy |
| 7 | OpenRouter Vision (KYC Analysis) | J-CUST-01 | happy |
| 8 | Parse JSON Output | J-CUST-01 | happy |
| 9 | Is An Identity Document? | J-CUST-01 (T) / J-CUST-09 (F) | happy / negative |
| 10 | Record Non-Document | J-CUST-09 | negative |
| 11 | Delivery Report (Non-Document) | J-CUST-09 | negative |
| 12 | Validation Check | J-CUST-01 (T) / J-CUST-04 (F) | happy / negative |
| 13 | Approved | J-CUST-01 | happy |
| 14 | Rejected | J-CUST-04 | negative |
| 15 | Count Previous KYC Rejections | J-CUST-05 | happy |
| 16 | Decide: Re-ask or Escalate | J-CUST-05 | happy |
| 17 | Within Retry Limit? | J-CUST-04 (T) / J-CUST-05 (F) | happy / negative |
| 18 | WhatsApp: Request Re-upload | J-CUST-04 | negative |
| 19 | Log KYC Re-ask | J-CUST-04 | negative |
| 20 | Delivery Report (KYC Re-ask) | J-CUST-04 | negative |
| 21 | Slack: KYC Escalation | J-CUST-05 | negative |
| 22 | Log KYC Escalation | J-CUST-05 | negative |
| 23 | Delivery Report (KYC Escalation) | J-CUST-05 | negative |
| 24 | WhatsApp: KYC Approved | J-CUST-01 | happy |
| 25 | Log KYC Approved | J-CUST-01 | happy |
| 26 | Prepare Archive | J-CUST-01 | happy |
| 27 | Archive to Storage | J-CUST-01 | happy |
| 28 | Merge Archive Result | J-CUST-01 | happy |
| 29 | Record KYC (Approved) | J-CUST-01 | happy |
| 30 | Delivery Report (KYC Approved) | J-CUST-01 | happy |
| 31 | Record KYC (Rejected) | J-CUST-04 | negative |
| 32 | Delivery Report (KYC Rejected) | J-CUST-04 | negative |

**32 covered, 0 uncovered.**

## 4. 7-Day Warm Lead Drip Campaign — `G7FhvMY2ucW5Fg7X` — active — 41 nodes

| # | node | journey | path |
|---:|---|---|---|
| 1 | DripWebhook | J-DEALER-06 | happy |
| 2 | Verify JWT | J-DEALER-06 | unauthorised |
| 3 | Called by Master Router | J-CUST-06 | happy |
| 4 | Resolve Tenant | J-DEALER-01 | happy |
| 5 | Normalize Lead Input | J-CUST-06 | missing-data (phone-only lead refused) |
| 6 | Audit: Enrolled | J-CUST-06 | happy |
| 7 | Wait Day 1 | J-CUST-06 | happy (clock shortened) |
| 8 | Comm Keys (Day 1) | J-CUST-06 | happy |
| 9 | Lead State (Day 1) | J-CUST-06 | happy |
| 10 | Replies Since Enrol (Day 1) | J-DEALER-06 | negative |
| 11 | Still Enrolled? (Day 1) | J-CUST-06 (T) / J-DEALER-06 (F) | happy / negative |
| 12 | Email: Welcome (Gmail) | J-CUST-06 | happy |
| 13 | Log Welcome Email | J-CUST-06 | happy |
| 14 | Has WhatsApp? (Day 1) | J-CUST-06 | happy |
| 15 | WhatsApp: Welcome | J-CUST-06 | happy |
| 16 | Log WhatsApp Welcome | J-CUST-06 | happy |
| 17 | Wait Day 3 | J-CUST-06 | happy |
| 18 | Comm Keys (Day 3) | J-CUST-06 | happy |
| 19 | Lead State (Day 3) | J-CUST-06 | happy |
| 20 | Replies Since Enrol (Day 3) | J-DEALER-06 | negative |
| 21 | Still Enrolled? (Day 3) | J-CUST-06 (T) / J-DEALER-06 (F) | happy / negative |
| 22 | Email: Follow Up (Gmail) | J-CUST-06 | happy |
| 23 | Log Follow Up Email | J-CUST-06 | happy |
| 24 | Wait Day 5 | J-CUST-06 | happy |
| 25 | Comm Keys (Day 5) | J-CUST-06 | happy |
| 26 | Lead State (Day 5) | J-CUST-06 | happy |
| 27 | Replies Since Enrol (Day 5) | J-DEALER-06 | negative |
| 28 | Still Enrolled? (Day 5) | J-CUST-06 (T) / J-DEALER-06 (F) | happy / negative |
| 29 | Has WhatsApp? (Day 5) | J-CUST-06 | happy |
| 30 | WhatsApp: Check-in | J-CUST-06 | happy |
| 31 | Log WhatsApp Check-in | J-CUST-06 | happy |
| 32 | Wait Day 7 | J-CUST-06 | happy |
| 33 | Comm Keys (Day 7) | J-CUST-06 | happy |
| 34 | Lead State (Day 7) | J-CUST-06 | happy |
| 35 | Replies Since Enrol (Day 7) | J-DEALER-06 | negative |
| 36 | Still Enrolled? (Day 7) | J-CUST-06 (T) / J-DEALER-06 (F) | happy / negative |
| 37 | Email: Final Offer (Gmail) | J-CUST-06 | happy |
| 38 | Log Final Offer Email | J-CUST-06 | happy |
| 39 | Stopped Report | J-DEALER-06 | negative |
| 40 | Delivery Report | J-CUST-06 | happy |
| 41 | Audit Log | J-CUST-06 | happy |

**41 covered, 0 uncovered.**

## 5. Lead Escalation - AI Agent — `KI6P1Qcf3MIZakNa` — active — 23 nodes

| # | node | journey | path |
|---:|---|---|---|
| 1 | EscalationWebhook | J-DEALER-03 | happy |
| 2 | Verify JWT | J-DEALER-03 | unauthorised |
| 3 | Auth Gate | J-DEALER-03 | unauthorised |
| 4 | Called by Master Router | J-CUST-01 | happy |
| 5 | Run Manually | J-DEALER-10 | retry |
| 6 | Test Lead | J-DEALER-10 | retry |
| 7 | Fetch Escalated Lead | J-CUST-01 | happy |
| 8 | Found The Lead? | J-CUST-01 (T) / missing-data (F) | happy / missing-data |
| 9 | No Lead To Escalate | J-CUST-01 | missing-data |
| 10 | AI Escalation Analyst | J-CUST-01 | happy |
| 11 | OpenRouter Chat Model | J-CUST-01 | happy |
| 12 | Groq Chat Model | J-CUST-01 | retry |
| 13 | Model Ladder | J-CUST-01 | retry |
| 14 | Simple Memory | J-CUST-01 | happy |
| 15 | get_lead_timeline | J-CUST-08 | happy |
| 16 | find_available_rep | J-DEALER-07 | happy |
| 17 | Fetch Rep Slack Id | J-DEALER-07 | missing-data (rep with no slack id) |
| 18 | Send a message | J-DEALER-07 | happy |
| 19 | Email: Escalation Alert (Gmail) | J-CUST-01 | happy |
| 20 | Mark Lead Escalated | J-CUST-01 | happy |
| 21 | Delivery Report | J-CUST-01 | happy |
| 22 | Audit Log | J-CUST-01 | happy |
| 23 | Return Result | J-CUST-06 | happy — the detector reads `escalated` from here |

**23 covered, 0 uncovered.**

## 6. Finance Calc: Auto Loan Equity & Credit Score — `unMMpeL9uuPO79pp` — active — 11 nodes

| # | node | journey | path |
|---:|---|---|---|
| 1 | Webhook Trigger | J-CUST-02 | happy |
| 2 | Called as Tool | J-CUST-02 | happy — staging only |
| 3 | Verify JWT | J-CUST-02 | unauthorised |
| 4 | Tenant For JWT User | J-DEALER-01 | happy |
| 5 | Resolve Tenant | J-DEALER-01 | happy |
| 6 | Calculate Equity & Tier | J-CUST-02 / J-CUST-03 | happy / negative |
| 7 | Quote Valid? | J-CUST-02 (T) / J-CUST-03 (F) | happy / negative |
| 8 | Log Quote | J-CUST-02 | happy |
| 9 | Return Quote | J-CUST-02 | happy |
| 10 | Delivery Report | J-CUST-03 | negative — REJECTED vs FAILED |
| 11 | Audit Log | J-CUST-02 | happy |

**11 covered, 0 uncovered.**

## 7. Ask-AI — RAG Query Agent — `qHAtd3RckAKRBUkE` — active — 17 nodes

| # | node | journey | path |
|---:|---|---|---|
| 1 | Webhook - Ask AI | J-CUST-01 | happy |
| 2 | Verify JWT | J-CUST-09 | unauthorised |
| 3 | Auth OK? | J-CUST-01 (T) / J-CUST-09 (F) | happy / unauthorised |
| 4 | Respond 401 | J-CUST-09 | unauthorised |
| 5 | Tenant For JWT User | J-DEALER-01 | happy |
| 6 | Run Manually | J-DEALER-10 | retry |
| 7 | Test Question | J-DEALER-10 | retry |
| 8 | Extract Question | J-CUST-01 | happy |
| 9 | Supabase Knowledge Search | J-CUST-01 | happy |
| 10 | Docs Found? | J-CUST-01 (T) / J-CUST-09 (F) | happy / missing-data |
| 11 | Build RAG Context | J-CUST-01 | happy |
| 12 | AI Agent - Generate Answer | J-CUST-01 | happy |
| 13 | AI Answer - Backup Models | J-CUST-01 | retry |
| 14 | Format Response | J-CUST-01 | happy |
| 15 | Delivery Report | J-CUST-09 | missing-data |
| 16 | Audit Log | J-CUST-01 | happy |
| 17 | Respond to Webhook | J-CUST-01 | happy |

**17 covered, 0 uncovered** — but every assertion is blocked on staging until
`rag_documents` is seeded there (staging holds 0 rows; production holds 15).

## 8. Sync Closed-Won Deals to Supabase pgvector — `dhy2DDjWUqwuzHLW` — active — 14 nodes

| # | node | journey | path |
|---:|---|---|---|
| 1 | Webhook - New Deal | J-CUST-01 | happy |
| 2 | Verify JWT | J-CUST-01 | unauthorised |
| 3 | Tenant For JWT User | J-DEALER-01 | happy |
| 4 | Format Deal Text | J-CUST-01 | happy |
| 5 | OpenRouter - Generate Embedding | J-CUST-01 | happy |
| 6 | Parse Embedding Response | J-CUST-01 | happy |
| 7 | Supabase (Postgres) - Upsert Vector | J-CUST-01 | duplicate |
| 8 | Lookup Lead By Email | J-CUST-01 | happy |
| 9 | Attach Lead Id | J-CUST-01 | happy |
| 10 | Record Purchase | J-CUST-01 | happy |
| 11 | Confirm Purchase Row | J-CUST-01 | happy |
| 12 | Delivery Report | J-CUST-01 | happy |
| 13 | Audit Log | J-CUST-01 | happy |
| 14 | Respond to Webhook | J-CUST-01 | happy |

**14 covered, 0 uncovered.** J-CUST-07 asserts the negative: none of these runs
on a closed-lost deal.

## 9. wf_108 ERP Sync - Bitrix24 CRM — `bxNBzBrcOtcFpMPn` — active — 21 nodes

| # | node | journey | path |
|---:|---|---|---|
| 1 | Called by Master Router | J-CUST-01 | happy |
| 2 | ErpSyncWebhook | J-DEALER-03 | happy |
| 3 | Verify JWT | J-DEALER-03 | unauthorised |
| 4 | Auth Gate | J-DEALER-03 | unauthorised |
| 5 | Resolve Tenant | J-DEALER-01 | happy |
| 6 | Fetch HOT Leads from Supabase | J-DEALER-03 | happy |
| 7 | Map Lead to Bitrix24 Lead | J-CUST-01 | happy |
| 8 | Find Existing Lead | **NOT COVERED** | Bitrix24 paid-plan wall |
| 9 | Find Lead by Email | **NOT COVERED** | Bitrix24 paid-plan wall |
| 10 | Decide Update or Create | **NOT COVERED** | unreachable behind the wall |
| 11 | Already in Bitrix24? | **NOT COVERED** | unreachable behind the wall |
| 12 | Safe to Create? | **NOT COVERED** | unreachable behind the wall |
| 13 | Create Bitrix24 Lead | **NOT COVERED** | Bitrix24 paid-plan wall |
| 14 | Fetch Existing Bitrix Lead | **NOT COVERED** | Bitrix24 paid-plan wall |
| 15 | Build Update Payload | **NOT COVERED** | unreachable behind the wall |
| 16 | Update Has Payload? | **NOT COVERED** | unreachable behind the wall |
| 17 | Update Bitrix24 Lead | **NOT COVERED** | Bitrix24 paid-plan wall |
| 18 | Link Back to Supabase | **NOT COVERED** | unreachable behind the wall |
| 19 | Build Audit Row | J-CUST-01 | happy |
| 20 | Delivery Report | J-CUST-01 | happy |
| 21 | Log to Supabase audit_log | J-CUST-01 | happy |

**10 covered, 11 NOT COVERED.** The wall was recorded on 28 Aug as
`403 FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN` — a plan tier, not a defect. **It
was not re-verified in this pass**; the live health view shows 12 runs, 5
failures, last success 19 Aug, `DEGRADED`. Re-check before treating these 11 as
permanently uncoverable.

## 10. Slack Command Center - AI Agent — `VmnIXo7tM30zqawp` — active — 16 nodes

| # | node | journey | path |
|---:|---|---|---|
| 1 | SlackWebhook | J-DEALER-07 | happy (synthetic POST, not Slack) |
| 2 | Verify JWT | J-DEALER-07 | unauthorised |
| 3 | Tenant For JWT User | J-DEALER-01 | happy — lacks `alwaysOutputData:true`, see below |
| 4 | Auth Gate | J-DEALER-07 | unauthorised |
| 5 | Extract Command | J-DEALER-07 | happy |
| 6 | Model Ladder | J-DEALER-07 | retry |
| 7 | AI CRM Agent | J-DEALER-07 | happy |
| 8 | OpenRouter Chat Model | J-DEALER-07 | happy |
| 9 | Groq Fallback | J-DEALER-07 | retry |
| 10 | Simple Memory | J-DEALER-07 | happy |
| 11 | Search Leads | J-DEALER-07 | happy |
| 12 | Update Lead Status | J-DEALER-07 | happy |
| 13 | Format Slack Response | J-DEALER-07 | happy |
| 14 | Post Answer to Slack | J-DEALER-07 | happy |
| 15 | Delivery Report | J-DEALER-07 | happy |
| 16 | Audit Log | J-DEALER-07 | happy |

**16 covered, 0 uncovered — with a caveat that matters more than the count.**
`Tenant For JWT User` lacks `alwaysOutputData:true`, so on an unauthenticated
call the chain halts **before** `Auth Gate` runs and the probe records SUCCESS
with no audit row. The endpoint is closed by accident, not by design. And the
Slack request-signing path — the guard this workflow should have — is covered by
**no journey in this document**.

## 11. NEXUS Retention Purge — `aIYwwoYStDAi9kHy` — active — 16 nodes

| # | node | journey | path |
|---:|---|---|---|
| 1 | Every Night 03:00 | J-CUST-05 | happy |
| 2 | Find Expired Documents | J-CUST-05 | happy |
| 3 | Collect Expired Paths | J-CUST-05 | happy |
| 4 | Delete Storage Objects | J-CUST-05 | happy |
| 5 | Reconcile Storage Deletions | J-CUST-05 | happy |
| 6 | Anything Confirmed Deleted? | J-CUST-05 | happy (T) / negative (F) |
| 7 | Mark Rows Purged | J-CUST-05 | happy |
| 8 | Purge Verdict Clean? | J-CUST-05 | happy (T) / negative (F) |
| 9 | Purge Failed — Rows NOT Marked | J-CUST-05 | negative |
| 10 | Summarise Purge | J-CUST-05 | happy |
| 11 | Prune Dedupe Guard | J-CUST-05 | happy |
| 12 | Find Archive Gaps | J-CUST-05 | missing-data |
| 13 | Any Gaps? | J-CUST-05 | missing-data |
| 14 | Slack: Archive Gap Alert | J-CUST-05 | missing-data |
| 15 | Delivery Report | J-CUST-05 | happy |
| 16 | Log Purge to Audit | J-CUST-05 | happy |

**16 covered, 0 uncovered.** Health reads `NEVER_RAN` (0 runs); J-CUST-05 would
be its first execution.

## 12. Customer 360 - Data Aggregation (Bitrix24) — `AZkGM5M4c1uzSH7S` — active — 11 nodes

| # | node | journey | path |
|---:|---|---|---|
| 1 | Schedule Trigger | J-CUST-08 | happy |
| 2 | Get Customer Directory | J-CUST-08 | happy |
| 3 | Normalise Customers | J-CUST-08 | missing-data (row with no id is not synced) |
| 4 | Split In Batches | J-CUST-08 | happy |
| 5 | Gmail - Get Emails | J-CUST-08 | happy / negative (broken credential → UNKNOWN) |
| 6 | Slack - Search Mentions | J-CUST-08 | happy / negative |
| 7 | Merge Customer Data | J-CUST-08 | happy |
| 8 | Transform & Unify | J-CUST-08 | missing-data |
| 9 | Supabase - Upsert Profile | J-CUST-08 | duplicate |
| 10 | Delivery Report | J-CUST-08 | happy |
| 11 | Audit Log | J-CUST-08 | happy |

**11 covered, 0 uncovered — but blocked at two tenants** (see J-CUST-08).

## 13. Competitor Price Scraping & Supabase Update — `LphiGg4iqF1bn6El` — active — 10 nodes

| # | node | journey | path |
|---:|---|---|---|
| 1 | Schedule Trigger | J-DEALER-08 | happy |
| 2 | Fetch Local Inventory | J-DEALER-08 | happy |
| 3 | Build Apify Query | J-DEALER-08 | happy — assert all units, not the first |
| 4 | Apify - Search Competitor Price | J-DEALER-08 | happy |
| 5 | Extract Price with AI | J-DEALER-08 | happy |
| 6 | Parse AI Price | J-DEALER-08 | happy — assert all pages, not the first |
| 7 | Is This Real Intel? | J-DEALER-08 | happy (T) / negative (F) |
| 8 | Log Competitor Intel | J-DEALER-08 | happy |
| 9 | Delivery Report | J-DEALER-08 | happy |
| 10 | Audit Log | J-DEALER-08 | happy |

**10 covered, 0 uncovered.** `Should Update Price?` was severed on 26 Aug and is
**not in the published node list**, so it is not counted. Do not reconnect it.

## 14. Inventory Ageing Recompute — `ZUc42jcwwHoBeEr8` — active — 5 nodes

| # | node | journey | path |
|---:|---|---|---|
| 1 | Every night at 00:15 | J-DEALER-02 | happy |
| 2 | Recompute Inventory Ageing | J-DEALER-02 | happy |
| 3 | Units Per Tenant | J-DEALER-01 | happy |
| 4 | Group By Tenant | J-DEALER-01 | happy / missing-data (read-back fails → one TENANT UNRESOLVED row) |
| 5 | Audit Log | J-DEALER-02 | happy |

**5 covered, 0 uncovered.**

## 15. WhatsApp Send (Dashboard Reply) — `yx6m55p1Kj8V7koR` — active — 13 nodes

| # | node | journey | path |
|---:|---|---|---|
| 1 | Dashboard Send Webhook | J-DEALER-09 | happy |
| 2 | Verify JWT | J-DEALER-09 | unauthorised |
| 3 | Auth OK? | J-DEALER-09 | happy (T) / unauthorised (F) |
| 4 | Tenant For JWT User | J-DEALER-01 | happy |
| 5 | Prepare Send | J-DEALER-09 | happy |
| 6 | Has chat_id and text? | J-DEALER-09 | happy (T) / missing-data (F) |
| 7 | Send via WAHA | J-DEALER-09 | happy / retry |
| 8 | Log Outbound | J-DEALER-09 | happy |
| 9 | Delivery Report | J-DEALER-09 | happy |
| 10 | Respond Sent | J-DEALER-09 | happy |
| 11 | Respond Bad Request | J-DEALER-09 | missing-data |
| 12 | Respond Unauthorized | J-DEALER-09 | unauthorised |
| 13 | Respond Send Failed | J-DEALER-09 | negative |

**13 covered, 0 uncovered.**

## 16. NEXUS Error Handler — `iYJkh1kztWxZXDbT` — active — 3 nodes

| # | node | journey | path |
|---:|---|---|---|
| 1 | Any Workflow Failed | J-DEALER-10 | happy |
| 2 | Build Failure Row | J-DEALER-10 | happy / missing-data (no error message) |
| 3 | Log Failure to audit_log | J-DEALER-10 | happy — assert explicit null `tenant_id` at two tenants |

**3 covered, 0 uncovered.**

## 17. NEXUS Public — Home / Privacy / Terms — `bhzCbnro0MlSCwwo` / `vKTmNepP4fGaTAe8` / `Z0zFB6IKvARAzjpQ` — active — 2 nodes each, 6 total

| workflow | node | journey | path |
|---|---|---|---|
| Home | In (webhook) | J-DEALER-01 | happy |
| Home | Out (respondToWebhook) | J-DEALER-01 | happy |
| Privacy | In | J-DEALER-01 | happy |
| Privacy | Out | J-DEALER-01 | happy |
| Terms | In | J-DEALER-01 | happy |
| Terms | Out | J-DEALER-01 | happy |

**6 covered, 0 uncovered.** These three are `availableInMCP:false`, so their
nodes were read from the repo export — which is current for them: they were last
updated 26 Aug 2026 and the export is 31 Aug. They are also **not registered in
`workflow_registry`**, which holds 18 rows for 21 workflows.

## 18. Phase 6 - 12-Hour Silence Detector — `B3TcpfzOMWj8oWgF` — **NO PUBLISHED VERSION** — 12 nodes

`active:false`, `activeVersionId:null`. Assigned to J-CUST-06 and **not runnable**.

| # | node | journey | status |
|---:|---|---|---|
| 1 | Every Hour | J-CUST-06 | (blocked — unpublished) |
| 2 | Run Manually | J-CUST-06 | (blocked) |
| 3 | Fetch Open Leads | J-CUST-06 | (blocked) |
| 4 | Fetch Recent Comms | J-CUST-06 | (blocked) |
| 5 | Fetch WhatsApp Contacts | J-CUST-06 | (blocked) |
| 6 | Find Silent Leads | J-CUST-06 | (blocked) |
| 7 | Loop Over Silent Leads | J-CUST-06 | (blocked) |
| 8 | Trigger Lead Escalation | J-CUST-06 | (blocked) |
| 9 | Escalation Landed? | J-CUST-06 | (blocked) |
| 10 | Mark as Escalated | J-CUST-06 | (blocked) |
| 11 | Delivery Report | J-CUST-06 | (blocked) |
| 12 | Audit Log | J-CUST-06 | (blocked) |

**0 runnable, 12 assigned-but-blocked.**

## 19. NEXUS Infra Health Probe — `57QpbNQGwlFKb0q3` — **NO PUBLISHED VERSION** — 12 nodes

`active:false`, `activeVersionId:null`, and no journey drives it.

| # | node | status |
|---:|---|---|
| 1 | Probe Webhook | **NOT COVERED** — workflow has no published version |
| 2 | Probe Auth Gate | **NOT COVERED** |
| 3 | Probe Authorized? | **NOT COVERED** |
| 4 | Respond Unauthorized | **NOT COVERED** |
| 5 | Every 15 Minutes | **NOT COVERED** |
| 6 | Run Manually | **NOT COVERED** |
| 7 | WAHA Sessions | **NOT COVERED** |
| 8 | Format Probe | **NOT COVERED** |
| 9 | Probe Passed? | **NOT COVERED** |
| 10 | Respond | **NOT COVERED** |
| 11 | Respond Degraded | **NOT COVERED** |
| 12 | Probe Alarm | **NOT COVERED** |

**0 covered, 12 NOT COVERED.** This is the workflow that would tell the owner
WhatsApp is down. It has a schedule trigger, an alarm that throws into the error
workflow, and no published version — so nothing is watching the channel the
product runs on. `workflow_registry` nonetheless reads `is_active = true` for it.

## Totals

| workflow | id | nodes | covered | blocked | not covered |
|---|---|---:|---:|---:|---:|
| WhatsApp BDC AI Agent | `BiyHk9ZXxJUVGbf6` | 45 | 45 | 0 | 0 |
| 7-Day Warm Lead Drip Campaign | `G7FhvMY2ucW5Fg7X` | 41 | 41 | 0 | 0 |
| KYC/AML Document Auditor (Phase 5) | `qTnh3nwWheFJbFkU` | 32 | 32 | 0 | 0 |
| NEXUS Master Lead Router | `JnlZFAVmFAuNXVya` | 26 | 26 | 0 | 0 |
| Lead Escalation - AI Agent | `KI6P1Qcf3MIZakNa` | 23 | 23 | 0 | 0 |
| wf_108 ERP Sync - Bitrix24 CRM | `bxNBzBrcOtcFpMPn` | 21 | 10 | 0 | **11** |
| Ask-AI — RAG Query Agent | `qHAtd3RckAKRBUkE` | 17 | 17 | 0 | 0 |
| Slack Command Center - AI Agent | `VmnIXo7tM30zqawp` | 16 | 16 | 0 | 0 |
| NEXUS Retention Purge | `aIYwwoYStDAi9kHy` | 16 | 16 | 0 | 0 |
| Sync Closed-Won Deals to pgvector | `dhy2DDjWUqwuzHLW` | 14 | 14 | 0 | 0 |
| WhatsApp Send (Dashboard Reply) | `yx6m55p1Kj8V7koR` | 13 | 13 | 0 | 0 |
| Phase 6 - 12-Hour Silence Detector | `B3TcpfzOMWj8oWgF` | 12 | 0 | **12** | 0 |
| NEXUS Infra Health Probe | `57QpbNQGwlFKb0q3` | 12 | 0 | 0 | **12** |
| Customer 360 - Data Aggregation | `AZkGM5M4c1uzSH7S` | 11 | 11 | 0 | 0 |
| Finance Calc: Auto Loan Equity | `unMMpeL9uuPO79pp` | 11 | 11 | 0 | 0 |
| Competitor Price Scraping | `LphiGg4iqF1bn6El` | 10 | 10 | 0 | 0 |
| NEXUS Public — Home | `bhzCbnro0MlSCwwo` | 2 | 2 | 0 | 0 |
| NEXUS Public — Privacy | `vKTmNepP4fGaTAe8` | 2 | 2 | 0 | 0 |
| NEXUS Public — Terms | `Z0zFB6IKvARAzjpQ` | 2 | 2 | 0 | 0 |
| Inventory Ageing Recompute | `ZUc42jcwwHoBeEr8` | 5 | 5 | 0 | 0 |
| NEXUS Error Handler | `iYJkh1kztWxZXDbT` | 3 | 3 | 0 | 0 |
| **Total** | **21 workflows** | **334** | **299** | **12** | **23** |

## The uncovered list — this is what a release gate reads

**23 nodes that no journey in this document exercises.**

### Behind the Bitrix24 paid-plan wall — `wf_108 ERP Sync` (11)

`Find Existing Lead` · `Find Lead by Email` · `Decide Update or Create` ·
`Already in Bitrix24?` · `Safe to Create?` · `Create Bitrix24 Lead` ·
`Fetch Existing Bitrix Lead` · `Build Update Payload` · `Update Has Payload?` ·
`Update Bitrix24 Lead` · `Link Back to Supabase`

Uncoverable while the CRM returns `403 FEATURE_NOT_AVAILABLE_ON_CURRENT_PLAN`.
Recorded 28 Aug, **not re-verified in this pass**. Either buy the plan, point
the sync at whatever CRM the pilot dealership actually uses, or accept that the
CRM write is untested and say so on the go-live list.

### No published version — `NEXUS Infra Health Probe` (12)

`Probe Webhook` · `Probe Auth Gate` · `Probe Authorized?` ·
`Respond Unauthorized` · `Every 15 Minutes` · `Run Manually` · `WAHA Sessions` ·
`Format Probe` · `Probe Passed?` · `Respond` · `Respond Degraded` ·
`Probe Alarm`

Coverable the moment someone publishes the workflow. Until then nothing watches
the WhatsApp channel, and `workflow_registry` says otherwise.

### Assigned but blocked — `Phase 6 - 12-Hour Silence Detector` (12)

All twelve. Same fix: publish the workflow. J-CUST-06 is written against them
and turns from `BLOCKED` to `NOT RUN` the day it is published.

### Not a node, but uncovered and worth the same attention

- **Slack request signing.** The Slack Command Center is guarded by a Supabase
  JWT, which no Slack request carries. No journey exercises the HMAC path
  because it does not exist.
- **The WhatsApp Cloud API adapter.** `channel_registry` supports
  `whatsapp_cloud_phone_number_id` and that namespace is **empty**;
  `channel_message_events` holds **0 rows** and `whatsapp_templates` holds **0**.
  Nothing in this document exercises the official transport, because nothing on
  the box does.
- **The `Should Update Price?` branch**, severed on purpose. Not counted, not
  covered, and must stay that way.

---

# Part 7 — The blockers between here and running any of this

Nothing in Part 4 can be run today. These are the reasons, each with what has to
be true first.

## B1 — The WhatsApp perimeter is open and the auth gate is DORMANT

`POST /webhook/whatsapp-inbound` **accepts unauthenticated calls**. Its
`WAHA Auth Gate` is env-driven and dormant on the box — `WAHA_WEBHOOK_SECRET` is
unset, so the gate's early `return items;` passes everything through. Proven
live on 3 Sep by running the published workflow with a payload that dies before
any write: the gate emitted the item with no `_gate` key, which only the dormant
branch does.

What an unauthenticated caller gets: keyword-matched AI replies **sent to a
number they choose** (`Guard Reply` filters content, never the recipient), rows
in `processed_messages`, `whatsapp_contacts`, `communication_logs`, `audit_log`,
and — via `Score New Lead`, which enters the Master Router through
`Called Internally` and bypasses that router's own `Auth Gate` — rows in `leads`.
A guarded front door with an unguarded side door behind it.

**And the caller picks the dealership.** `Resolve Tenant` keys off
`body.session`, which is caller-supplied. With one tenant a bogus session
resolves to it; the moment `NEXUS_TENANT_MAP` holds two, one JSON field chooses
whose data is written — and n8n writes as `service_role`, which is `BYPASSRLS`,
so nothing in the database filters it.

**Why this blocks the journeys specifically.** J-CUST-09's Unauthorised path
cannot fail, so it cannot pass either — an unauthorised test against a dormant
gate proves nothing. And J-DEALER-01 puts a second tenant on the map, which is
exactly the configuration that turns a caller-chosen session into a
caller-chosen dealership.

**What must be true first:** set `WAHA_WEBHOOK_SECRET` on the VM, make WAHA send
`x-nexus-webhook-secret`, confirm in MONITOR mode, then set
`WAHA_WEBHOOK_ENFORCE=true`. Hardcoding a secret in n8n first would silently drop
every real customer message. The fix is on the VM, not in n8n.

**Where this stands, 8 September 2026.** The secret is set and WAHA *is* sending
the header — measured on executions 11098/11099/11100. The gate still reads
`mode MONITOR, header_present true, ok false`, so the confirm step has not been
met and enforcing would drop every real customer message. The box runs in queue
mode, so the Code node reading `$env.WAHA_WEBHOOK_SECRET` executes in
`n8n-worker`; `docker compose up -d n8n` recreates the container whose `printenv`
gets checked and leaves the one doing the comparison stale. Verify where the
value is consumed:
`docker compose exec -T n8n-worker sh -c 'printf %s "$WAHA_WEBHOOK_SECRET" | sha256sum'`.

## B2 — Two WAHA hosts are posting the same messages

Read from saved executions on 3 Sep: executions 9427 and 9428 carry the **same
`body.payload.id`** and differ in everything else — different
`x-webhook-request-id`, `WAHA/2026.7.2` versus `WAHA/2026.7.1`,
`35.224.126.225` (the box) versus `2.50.10.149` (external, UAE), and different
device indexes on the same WhatsApp account. A second pair started **1 ms
apart** — far too close for a retry. This is two senders, and one of them is a
host nobody has accounted for.

**Accounted for on 8 September 2026.** `2.50.10.149` is Ali's own Windows desktop
**`desktop-l3an0ma`**, running WAHA in Docker Desktop — the same PC that used to
host n8n behind a Tailscale funnel at
`https://desktop-l3an0ma.tail2141f7.ts.net`, from before the move to GCP.

**And it had not stopped, which this document previously implied it had.**
Execution **11103** on production at **06:07:40 UTC on 8 September** carries
`x-forwarded-for 2.50.10.149`, `WAHA/2026.7.1`, `me.jid …:8`,
`body.event session.status`, no `x-nexus-webhook-secret`. Its `nexus-os` compose
project — `n8n`, `n8n-db`, `waha`, all three running — was **stopped by hand
through Docker Desktop at 06:08:24 UTC**. Status: **identified, and stopped by
hand on 8 Sep 2026 — not yet permanently removed (`restart: always` still
declared, device 8 still linked)**.

**Consequences for these journeys.** Any count of "messages" from the execution
list before 6 September is roughly double the truth. The only thing absorbing the
doubling is `Claim Message Id`.

**And the ordering consequence has changed.** B2 used to precede B1 because
arming the gate would cut off whichever sender lacked the secret. That is no
longer the reason. `.149`'s WhatsApp session is not authenticated, so it delivers
`session.status` and no messages; enforcement would drop those posts harmlessly.
B1 is blocked by something else entirely — the gate reads
`header_present: true, ok: false` on the **box's own** traffic, because the box
runs in queue mode and the Code node comparing `$env.WAHA_WEBHOOK_SECRET`
executes in `n8n-worker` rather than in `n8n`.

**What must be true first for B2:** the two steps that make the 8 September stop
permanent — `docker update --restart=no n8n n8n-db waha` on that PC, and
unlinking WhatsApp device 8 — neither of which has been done. A stopped
`restart: always` container comes back when the Docker daemon next starts.
**And the check must not be a duplicate-pair check:** the 6 and 7 September
samples grouped by `payload.id` and could never have seen a `session.status`-only
sender. Absence of duplicates is not absence of the sender.

## B3 — Writing to the production n8n box has not been authorised

Several journeys require changes on the box: publishing the Silence Detector,
publishing the Infra Health Probe, shortening the drip clocks for J-CUST-06 and
restoring them afterwards, and deliberately breaking a node for J-DEALER-10.
**None of that has been authorised, and this document does not assume it.**

The house rule stands: **one agent on the n8n box at a time** — parallel writes
have taken the production VM down twice — and **n8n edits stay in draft until
published**, verified by fetching the *published* version back, not the draft.

The box is also small. Pace matters: on 28 Aug four zombie executions held four
of the five concurrency slots and froze the instance for 23 hours. Any journey
run needs a zombie check before and after, and never two journeys in flight.

## B4 — There is one dealership in production, and it is a real one

Production `dsvuoovivysszdoiorch` holds **1 tenant, 1 tenant member, 1 user,
3 leads, 12 units, 1 sale**. That tenant is ALBA CARS — an actual dealership
whose book these numbers are, and **tenant #1 of a product built for dealerships
generally**, not the dealership NEXUS was built for.

The count is one **by design**, not by neglect. Activating a second dealership
on production silences five consumers of `nexus_scoped_tenant_id()` (see
`CLAUDE.md`), which is why the two-dealership work belongs on staging — B5 —
and why no journey result taken here is evidence about cross-tenant behaviour.

**Running customer journeys against production would put test rows in a real
dealership's book.** Not merely untidy: a synthetic HOT lead is chaseable,
emailable, countable, and indistinguishable from a real one to anybody reading
the Leads screen next week. With `tenant_id` as the only structural marker
available (Part 2), a journey run in production has **no marker at all** — every
row it writes carries the real dealership's id, because that is the only id
there is.

## B5 — Staging exists, is close to parity, and is not yet a full fixture

`wwspuxrbiyagnrnzgate` is the synthetic two-tenant project. Measured 2026-09-04:

| | production | staging |
|---|---:|---:|
| base tables in `public` | 58 | **58** |
| views in `public` | 39 | **39** |
| functions in `public` | 259 | **259** |
| tenants | 1 (holds the default flag) | **2** (neither holds it) |
| leads / inventory | 3 / 12 | 2 / 2 |
| communication_logs | 108 | **0** |
| rag_documents | 15 | **0** |
| users / tenant_members | 1 / 1 | 4 / 4 |

Structurally it is the right box. Note the honest qualifier already recorded
elsewhere: parity is **semantic, not byte-level** — `md5(prosrc)` differs on 34
of 105 messaging-layer functions because staging's copies were applied with
comments stripped; comment-and-whitespace-stripped they match.

**What must be true first:** seed the fixtures the journeys need — a RAG corpus
(0 rows today, so every Ask AI assertion is blocked), inventory units in the
`JT-…` namespace, and the `channel_registry` and `whatsapp_templates` rows
J-DEALER-09 asserts against.

## B6 — Two workflows have no published version

`Phase 6 - 12-Hour Silence Detector` and `NEXUS Infra Health Probe` are both
`active:false` with `activeVersionId: null`. That accounts for 24 of the 334
nodes and for J-CUST-06's `BLOCKED` status.

**And `workflow_registry` disagrees with the box**, reporting `is_active = true`
for both. The dashboard reads the registry. Fix the disagreement in whichever
direction is true — but do not leave a screen telling a dealership that the
thing watching their WhatsApp channel is running when it is not.

## B7 — The policy engine forbids every regulatory claim, correctly

`policy_rule` holds 13 rows and **0 `VERIFIED`**; `policy_platform_attestation`
holds **0 rows**; `v_policy_authoritative` returns **0**; 21 constants remain
unmigrated. So every conversation returns
`TEMPLATE_REQUIRED / WINDOW_RULE_NOT_VERIFIED`.

This is the engine being honest and it is also a blocker: J-DEALER-09's happy
path cannot produce a `FREEFORM_ALLOWED` decision until somebody with the Meta
Business account checks the rules and records an attestation through
`policy_platform_verify_rule()`. **The road is built; nobody has driven it.**

## Where these journeys should run, and in what order

**All twenty run on `wwspuxrbiyagnrnzgate`, against `staging-alpha` and
`staging-bravo`. None runs against production.** That is not a preference; with
no run-marker column, production has no way to distinguish a test row from a
real one (B4).

The n8n side is the harder half, because there is one box. The honest options,
in order of preference:

1. **A second n8n instance pointed at staging.** The clean answer. Journeys get
   their own execution history, the drip clocks can be shortened without
   touching production, and B3 stops being a blocker for eighteen of the twenty.
2. **The production box with staging credentials swapped in**, one journey at a
   time, with an explicit written authorisation per session and the credential
   swap logged. Workable, and it puts the production VM's stability in the path
   of every test run.
3. **Do not run them.** Which is where this stands today, and why every status
   in Part 4 reads `NOT RUN`.

Sequence, once a box exists:

| order | journeys | why first |
|---:|---|---|
| 1 | J-DEALER-04 | Runs entirely in the database. No box, no blockers. Proves the refusal branch today. |
| 2 | J-DEALER-02, J-DEALER-08 | Schedule-driven, no customer identity, no sends. Profit Sentinel is the strongest thing in the product. |
| 3 | J-CUST-02, J-CUST-03, J-DEALER-06 | Webhook-driven with a JWT. Settles whether the finance insert works today. |
| 4 | J-CUST-01, J-CUST-04, J-CUST-05, J-CUST-07, J-CUST-08, J-CUST-09, J-CUST-10 | Need a WAHA session on a controlled device (Part 2, Layer 2). |
| 5 | J-DEALER-03, J-DEALER-07, J-DEALER-09, J-DEALER-10 | Need Slack, the policy attestations (B7) and permission to break something (B3). |
| 6 | J-CUST-06 | Needs the Silence Detector published (B6). |
| 7 | J-DEALER-01 | Last, because it flips `NEXUS_TENANT_MAP` and roughly fifteen code paths change behaviour at once. Rehearse it on staging; never discover it in production. |
| — | J-DEALER-05 | Does not run. `BLOCKED BY MISSING CAPABILITY` until `public.deals` exists. |

---

# Appendix — the figures this document rests on

All measured 2026-09-04 unless stated. Anything not listed here was not measured
and is not asserted anywhere above.

**n8n box** (read from published workflow definitions): 21 workflows · 334 nodes
· 19 workflows with a published version (310 nodes) · 2 without (24 nodes) ·
11 POST business webhooks, **none** using n8n's `authentication` parameter.

**Production `dsvuoovivysszdoiorch`**: 58 base tables · 39 views · 259 functions
· tenants 1 (holds `is_unattributed_default`) · tenant_members 1 · users 1 ·
leads 3 · inventory 12 · communication_logs 108 · processed_messages 67 ·
whatsapp_contacts 12 · purchase_history 1 · deals_embeddings 1 ·
finance_quotes 0 · kyc_documents 3 (0 `APPROVED`) · competitors 16 ·
customer_360_profiles 2 · inventory_actions 3 · lead_recovery_actions 0 ·
rag_documents 15 · policy_rule 13 (0 `VERIFIED`) ·
policy_platform_attestation 0 · channel_registry 1 · channel_message_events 0 ·
whatsapp_templates 0 · workflow_registry 18 · audit_log 702.

**Views**: `v_deal_rescue` 0 · `v_deal_rescue_candidates` 8 ·
`v_lead_recovery` 3 · `v_lead_recovery_queue` 0 ·
`v_inventory_profit_sentinel` 12 · `v_inventory_action_queue` 3 ·
`v_attribution_edges` 115 · `v_attribution_events` 114 ·
`v_competitor_latest` 7 · `v_conversations` 13 · `v_customer_360` 2 ·
`v_team_performance` 1 · `v_needs_attention` 15 · `v_policy_authoritative` 0 ·
`v_policy_unmigrated_constant` 21 · `v_whatsapp_template_registry` 0 ·
`v_channel_send_health` 0.

**Schema absences, re-checked rather than taken on trust**: no `deals` table ·
no `appointments` table · no service table · no `deal_rescue_actions` table ·
zero columns named `stage` in `public` · zero columns matching `recon` ·
zero unit-link columns on `purchase_history` · zero decision-shaped columns on
`finance_quotes` · **zero columns named `journey_id`, `test_run_id` or `is_test`
on any of the 58 tables**.

**`v_workflow_health`, 30-day**: Inventory Ageing `HEALTHY` 100 % (21 runs) ·
Ask-AI `HEALTHY` 100 % (11 effective runs) · Slack Command Center `DEGRADED`
62.5 % · wf_108 `DEGRADED` 58.3 % · Master Router `DEGRADED` 50.0 % · Silence
Detector `DEGRADED` 50.0 % · WhatsApp BDC `DEGRADED` 42.4 % (290 runs) ·
Customer 360 `DEGRADED` 31.0 % · Sync Closed-Won `DEGRADED` 21.1 % · Lead
Escalation `DEGRADED` 14.3 % · Finance Calc `DEGRADED` 10.3 % · Competitor
Scraping `PRODUCING_NOTHING` 10.6 % (161 no-result of 180) · 7-Day Drip
`DEGRADED` **0.0 %, never succeeded** · KYC Auditor `DEGRADED` 0.0 % ·
Retention Purge `NEVER_RAN` · Error Handler, Infra Probe, WhatsApp Send
`NOT_INSTRUMENTED`.

**Staging `wwspuxrbiyagnrnzgate`**: 58 tables · 39 views · 259 functions ·
2 tenants (`staging-alpha` `1111…`, `staging-bravo` `2222…`, neither holding the
default flag) · leads 2 · inventory 2 · communication_logs 0 · audit_log 4 ·
rag_documents 0 · users 4 · tenant_members 4.

**Not measured in this pass, and therefore not asserted**: the Bitrix24 plan
status (last recorded 28 Aug); `WAHA_WEBHOOK_SECRET` and `NEXUS_TENANT_MAP` on
the VM (environment, not readable from here); the identity of `2.50.10.149`;
whether the `finance_quotes` insert works today.

On the third of those: the identity was **stated by Ali on 8 September 2026** —
his Windows desktop `desktop-l3an0ma`, WAHA in Docker Desktop, the old n8n host
behind `https://desktop-l3an0ma.tail2141f7.ts.net`. The host's *activity* was
then measured: execution 11103 at 06:07:40 UTC that day, posting `session.status`
from `2.50.10.149` with no secret header. Its containers were stopped by hand at
06:08:24 UTC. The identity of the machine remains an owner statement rather than
something read off it from here, and the removal is not permanent
(`restart: always` still declared, device 8 still linked), so it stays out of the
asserted column.
