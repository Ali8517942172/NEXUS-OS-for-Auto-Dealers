<!-- BUSINESS CONTEXT — added 2026-09-02, corrected 2026-09-03 -->
> **This is a commercial product, not a demo.** NEXUS is a **Revenue Recovery &
> Action OS for dealerships** — it sits above the dealership's existing DMS, CRM
> and inventory systems, finds revenue leaks, decides the next best action and
> executes it. It replaces none of them. See `PRODUCT.md` for the thesis and
> `CLAUDE.md` for how to work here. Ali owns NEXUS OS and is selling it
> to real dealerships on a subscription. Judge changes by whether they make it
> sellable and keep it sellable. The honest commercial position today is a
> **controlled dealership pilot** — not "enterprise-ready", not "compliant".
> Never state more than the evidence supports; "wired but never fired" is a real
> answer.
>
> **Correction, 2026-09-03.** This block used to end: *"The blocker before a
> second paying dealership is that the system is single-tenant: every RLS policy
> is `USING (true)`, so tenant two would read tenant one's customers."* That was
> true when written and is **no longer true**. Measured today: `public` holds
> **120 policies, 25 of them tenant-scoped**, and `CLAUDE.md` records the
> tenancy build as complete at the database layer and proven adversarially
> against two synthetic tenants. The blocker before a second dealership is now
> **operational, not structural**: `NEXUS_TENANT_MAP` is unset on the box, and
> `POST /webhook/whatsapp-inbound` lets the caller choose the dealership. Read
> `CLAUDE.md` for the current position; do not carry the old claim forward.

# NEXUS OS — Invariants

Eight rules the system is not allowed to break. The body of this file was
measured against the live Supabase project `dsvuoovivysszdoiorch` on
**2026-09-02**, as role `postgres` with `rolbypassrls = true` — so no count below
is a row-level-security artefact.

> **Re-checked 2026-09-03 18:3x–18:5x UTC. All eight rules still hold. Several
> figures have moved and three claims had gone stale; the section immediately
> below records what changed and every stale claim is corrected in place.**
> Where an invariant is now held up by a *mechanism* rather than by vigilance,
> that mechanism is named — the mechanisms are new since 2 September and are the
> most important change in this revision.

Every "verified" line names the query or script that produced it. Where the data
contradicts the rule, the contradiction is recorded as an **OPEN VIOLATION**
rather than smoothed over.

**Every figure in the 2026-09-02 body of this file was re-measured between 05:15
and 05:25 UTC on that day. None was carried forward from the revision before it,
and several had moved.** That revision was written at 21:2x on 2026-09-01 and is
stale wherever it disagrees. Figures added on 2026-09-03 are dated inline as
such; where a 2 September figure and a 3 September figure sit side by side, both
are kept and the newer one is marked, so the movement is auditable.

## Re-check 2026-09-03 — what moved, and what is now held up by a mechanism

Measured 18:3x–18:5x UTC on 2026-09-03 against the same project, through the
read-only SQL channel. **All eight invariants still hold.** Nothing below is a
new violation. Three claims in this file had gone stale and are corrected in
place under their own invariants; they are listed here so the correction is
findable.

### Figures that moved

| figure | 2026-09-02 | 2026-09-03 |
|---|---|---|
| `audit_log` rows / distinct `(status, summary)` pairs | 634 / 311 | **687 / 340** |
| SUCCESS / FAILURE / NO_RESULT / REJECTED_EXPECTED / PARTIAL / ESCALATED | 212 / 211 / 152 / 36 / 21 / 2 | **216 / 231 / 173 / 42 / 23 / 2** |
| `communication_logs` rows / messages / internal / replies | 99 / 97 / 2 / 19 | **108 / 106 / 2 / 23** |
| `v_lead_messages` resolution rows | 47 | **53** |
| `v_needs_attention` rows | 13 | **14** |
| `purchase_history` | **0 rows** | **1 row — the path has fired** |
| `kyc_documents` | **0 rows** | **3 rows, 0 verified** |
| `finance_quotes` live rows / inserts / deletes | 0 / — / — | 0 / **25** / **15** |
| `competitors` | 11 | **14** |
| tables / views in `public` | — | **40 / 33** |
| applied migrations | 81 | **181**, max `20260903180749` |
| screens | 14 | **20** on this branch, **14** on `origin/main` |

### Three stale claims, corrected in place

1. **INV-002 said `purchase_history` holds 0 rows and "no sale has ever been
   written through this path".** It now holds **one real closed-won deal**,
   recorded 2026-09-02 through the dashboard, and it carries `lead_id = 38`.
   The invariant moved from *wired, not fired* to **fired and proven**. See
   INV-002.
2. **INV-007 said `kyc_documents` holds 0 rows.** It holds **3**, and
   `pg_class.reltuples` now agrees at 3. **The invariant's finding is unchanged
   and arguably sharper**: 3 rows, **0 verified**, against a `DEGRADED` auditor
   at 0.0% success over 10 effective runs. A row appearing is not the capability
   working. See INV-007.
3. **The `security_invoker` section said "Nothing structural stops the fourth
   regression."** Something does now. See that section.

### The mechanisms — new since 2 September

This file used to record rules that held because somebody kept checking. Several
are now enforced by something that fails on its own. Naming them matters,
because an invariant backed by a mechanism and an invariant backed by vigilance
are different products.

| what is enforced | mechanism | kind |
|---|---|---|
| Every view in `public` carries `security_invoker` | **event trigger `nexus_guard_security_invoker_views`** on `ddl_command_end`, running `nexus_require_security_invoker_views()` — a `CREATE OR REPLACE VIEW` that drops the option now fails the statement | database, blocking |
| the same, at release | gate check **`L3`** — verified 2026-09-03: **0 of 33 views** lack the option | gate |
| No recovered revenue without a real sale behind it | CHECK **`inventory_actions_recovered_needs_real_sale`** and **`lead_recovery_actions_recovered_needs_real_sale`**: `recovered_value_aed IS NULL OR (outcome_state = 'ATTRIBUTED' AND outcome_purchase_id IS NOT NULL AND attribution_basis IS NOT NULL AND recovered_value_basis IS NOT NULL)`. Postgres refuses the row. | database, blocking |
| the same, at the screen | gate checks **`R5`**, **`S9`**, **`L10`** — `R5` serves a fabricated `recovered_value_aed` of 250 000 with all four evidence columns absent and fails if it renders as a figure | gate |
| An action decision is stamped, reasoned and its execution timestamped | CHECKs `*_decision_stamped`, `*_rejection_needs_reason`, `*_deferral_needs_reason`, `*_execution_stamped` on both action tables | database, blocking |
| One outcome vocabulary, never mixed with the action lifecycle | gate check **`S10`** | gate |
| An uncomputable figure never becomes a zero | gate checks **`R4`**, **`S5`**, **`L6`**, **`L7`** | gate |
| No finance figure computed by the browser or by a model | gate check **`S8`** | gate |
| Every `audit_log` writer is a registered workflow | view **`v_audit_unregistered_writers`** + gate check **`L9`** — **currently FAILING**, see below | database view + gate |
| `audit_log.status` is upper case | CHECK `audit_log_status_check` | database, blocking |
| Deal Rescue says *why* it is empty rather than showing a blank table | view **`v_deal_rescue_readiness`** — nine named prerequisites, each with `met_now`, `measured_now` and `measured_at`, recomputed on read | database view |

### Still aspirational — held by nothing but review

Say these are conventions, not controls, whenever they are quoted:

- **INV-001's read path.** "A screen reading raw `audit_log` rows must classify
  them through `lib/health.js`" is enforced by gate check `S10` in CI and by
  nothing at runtime. A screen that classified `status` itself would render
  wrongly and only the gate would object.
- **INV-003's single writer.** One trigger writes `response_time_minutes` today.
  Nothing prevents a second being added; the invariant is checked by a query,
  not held by a constraint. This is exactly how it broke on 31 August.
- **INV-004's marker rule.** `nexus_is_message` is the definition, but nothing
  stops a consumer counting rows without it. `v_lead_messages.is_message` and
  `v_conversations.msg_count` make the right thing easy; they do not make the
  wrong thing impossible.
- **INV-005.** `finance_quotes` still holds **0 live rows**, so this remains a
  source-level guarantee. It is no longer accurate to call the write path
  unexercised: `pg_stat_all_tables` shows **25 inserts and 15 deletes**, so the
  insert path has worked repeatedly and a teardown script clears the rows after
  each test. What is genuinely unproven is whether it works *today*.
- **INV-008's `pill()` provenance.** Still narrowed, not closed. No mechanism.

### Two gate checks are FAILING, and neither is fixed by this file

Latest gate run 2026-09-03T11:45Z: **PASS 26 · FAIL 2 · WARN 2 · NOT RUN 4,
exit 1.** J1's verdict is **NOT_READY**. The two failures are open findings, not
paperwork:

- **`L2`** — ten policies are `SELECT USING(true)` for `authenticated` on tables
  carrying no `tenant_id` column, all of them reference or lookup tables added
  with the engines (`deal_rescue_states`, `attribution_edge_type`,
  `policy_rule_type`, and seven more). Whether a shared vocabulary table should
  be tenant-scoped is a real decision and it has not been made.
- **`L9`** — a writer calling itself `"Example Workflow"` put one `FAILED` row
  into `audit_log` and resolves to no `workflow_registry` entry, so its runs sit
  on no health surface. **Do not invent a registry row to clear this.**

Four checks report **NOT RUN** (`B1`–`B4`) because they need a second dealership
or a writable session against production. **A NOT RUN is not a PASS**, and the
2 September adversarial two-tenant evidence in `CLAUDE.md` is not carried forward
as one.

---

## What changed since the previous revision (in the 2026-09-02 pass)

The previous revision recorded **two open violations under INV-002 and INV-008,
plus three sub-violations under INV-008**. Measured 2026-09-02:

- **Closed** — `purchase_history` now carries `lead_id`, with the frontend and
  the two n8n nodes to match. Closed at the schema and code layer and **not
  proven at runtime**; see INV-002, which says so at length rather than letting
  the word "closed" imply more than was tested. *(Superseded 2026-09-03: it is
  now proven at runtime — one real sale, `lead_id = 38`. See the correction
  under INV-002.)*
- **Closed** — the third and fourth definitions of "open pipeline" in the
  database. `v_team_performance.pipeline_aed` and `capture_daily_metrics()`
  both now sum over `public.nexus_lead_is_open(status)` and neither coalesces an
  unknown budget to zero.
- **Closed** — `capture_daily_metrics().open_leads`, which as recently as
  **05:15:49 today** still counted `status <> 'CLOSED' OR status IS NULL` in the
  same INSERT whose `pipeline_aed` used the shared rule. It was repointed by
  another agent at 05:16 while this pass was running. Both states are recorded
  under INV-008, because a register that only shows the end state cannot be
  audited.
- **Closed** — `screens/customers.js` no longer prints two message totals.
- **Narrowed, not closed** — the `pill()` provenance defect. The markup has one
  owner again, but 19 of 106 call sites still leave the decision to the
  helper's fallback, and one of them is the exact shape that was lying. INV-008
  carries the detail, **and a correction of a wrong claim this register made
  about it on 2026-09-01.**
- **Raised and closed inside this pass** — five views were not
  `security_invoker`. See the section below.

Two things got worse or stayed bad and are recorded as such: `audit_log` grew by
14 rows and every one of them was a Competitor scrape that found nothing
(NO_RESULT 115 → 127, of which Competitor Price Scraping 94 → 106), and
`architecture/schema.sql` has already fallen behind the live catalogue again.

## The five views: not `security_invoker`, then fixed under this pass

At **05:17:07 UTC** Supabase's linter (`get_advisors`, type `security`) reported
**five ERROR-level `security_definer_view` findings** — `v_conversations`,
`v_customer_360`, `v_lead_messages`, `v_needs_attention` and `v_workflow_health`
each had `reloptions = NULL`, so RLS on their base tables was evaluated as the
view owner rather than the caller. Two migrations already existed that had set
the option on two of them — `20260820022441 v_workflow_health_security_invoker`
and `20260824195539 restore_security_invoker_on_v_needs_attention` — and the
option was absent anyway, because a later `CREATE OR REPLACE VIEW` drops
`reloptions` silently and nothing was watching.

Migration `20260902051823 sec_views_restore_security_invoker_on_five_views`
landed at 05:18:23. Re-checked at **05:24:34**: all nine views in `public` carry
`security_invoker` (five as `=true`, the four older ones as `=on`). Re-run of
`get_advisors` at **05:24:42** returns **zero ERROR-level lints**. The remaining
findings are all WARN: mutable `search_path` on `nexus_is_message`,
`nexus_is_reply` and `nexus_outcome_class`; `vector` and `pg_trgm` installed in
`public`; leaked-password protection disabled.

**This had been fixed three times, and this section used to end "Nothing
structural stops the fourth regression."** That is no longer true, and it is the
most useful change since.

**Enforced 2026-09-03 by two mechanisms, both verified live:**

- **Event trigger `nexus_guard_security_invoker_views`**, on `ddl_command_end`,
  running `nexus_require_security_invoker_views()`. Confirmed present and
  enabled in `pg_event_trigger` (`evtenabled = 'O'`). A `CREATE OR REPLACE VIEW`
  that silently drops `reloptions` now **fails the statement** rather than
  succeeding quietly.
- **Gate check `L3`**, "Every public view carries `security_invoker`", in the
  live lane of `QUALITY_GATE.mjs`.

Re-measured 2026-09-03: **0 of the 33 views in `public`** lack the option. The
count is 33 now, not nine — twenty-four views arrived with the engine work since
this section was written, and every one of them carries it.

## Currency of the generated schema

`architecture/schema.sql` was regenerated at **05:01 UTC on 2026-09-02** against
migration `20260902050255`. Its own currency check —
`select max(version) from supabase_migrations.schema_migrations` — returns
**`20260902051823`** as of 05:24:57, over **81 applied migrations**. The file is
therefore **two migrations behind again**, and both of them matter: they are the
`open_leads` repoint (`20260902051636 inv008_open_leads_one_rule_per_row`, which
adds a `daily_metrics.open_leads_rule` column) and the `security_invoker`
restore. The previous revision's claim that the stale-schema violation is closed
was true when written and is not true now.

**Re-measured 2026-09-03, and it is far worse than "two behind".**
`select max(version), count(*) from supabase_migrations.schema_migrations`
returns **`20260903180749`, 181 applied**. `architecture/schema.sql` is
**one hundred migrations behind** and predates the entire tenancy build and
every engine. Grepped 2026-09-03, it contains **zero** occurrences of `tenants`,
`tenant_members`, `policy_rule`, `inventory_actions`, `lead_recovery_actions`,
`deal_rescue_states`, `v_attribution_edges` or
`nexus_require_security_invoker_views`, and it describes **16 tables and 9
views** against **40 and 33** live.

Its own header still reads "THIS FILE IS AUTHORITATIVE". **It is not, and
running it against production would replay a much older database over a much
newer one.** `architecture/README.md` was corrected on 2026-09-03 to say so, and
to say that the authoritative schema is the live catalogue and nothing in this
repository. Do not regenerate-and-trust either: regenerate only if you need a
snapshot, and date it.

## Runnable evidence

- `/home/claude/verify/invariants.sql` — the SQL probes. **The queries run; the
  result comments beside them were taken at 20:54 on 2026-09-01 and are now
  stale in most places**, because `audit_log` has grown by 14 rows and four
  database objects have been redefined since. The values in this file are the
  current ones.
- `/home/claude/verify/health_parity.mjs` — imports the real
  `apps/executive-dashboard/lib/health.js` and runs it over live `audit_log`
  data. **Its data file `/home/claude/verify/audit_pairs.json` was refreshed
  from the live catalogue on 2026-09-02** and now holds all 311 pairs / 634
  rows; the copy it replaced was stale (288 pairs / 570 rows, taken 20:47 on
  2026-09-01). Re-run against the refreshed file for this revision: **exit 0**.
  The copy it replaced is kept beside it at
  `/home/claude/verify/audit_pairs.2026-09-01.json` (288 pairs / 570 rows).
- `/home/claude/verify/extract_audit.mjs` — builds that data file.

---

## INV-001 · One vocabulary for what a workflow run did

**Business rule.** A run either did the job, did part of it, broke, produced
nothing, was refused on purpose, or was handed to a person — and the dealership
uses those same six words everywhere, plus "unrecognised" for anything else.

**Source of truth.** `public.nexus_outcome_class(workflow, status, summary)`, an
IMMUTABLE SQL function. `v_workflow_health` is the only aggregate over it.

**Owner.** Postgres. The function is the definition; nothing else may redefine it.

**Write path.** n8n workflows write a raw `audit_log` row (`workflow`, `status`,
`summary`). They do not write a class. The class is computed on read by
`nexus_outcome_class`, so a mislabelled writer cannot poison the vocabulary —
it can only be corrected by the function.

**Read path.** Screens read the pre-computed columns on `v_workflow_health`
(`failures_30d`, `partials_30d`, `no_result_30d`, `successes_30d`,
`effective_runs_30d`, `success_rate_30d`, `health`). A screen reading raw
`audit_log` rows must classify them through `lib/health.js` — the sole frontend
mirror — and never by comparing `status` itself.

**Frontend consumers.** Re-grepped 2026-09-02 05:2x. `lib/health.js` (the
mirror), imported by `screens/ask.js`, `screens/automation.js`,
`screens/campaigns.js`, `screens/competitors.js`, `screens/compliance.js`,
`screens/conversations.js`, `screens/customers.js`, `screens/finance.js`,
`screens/inventory.js`, `screens/leads.js`, `screens/overview.js`,
`screens/settings.js` and `lib/lead-drawer.js` — **thirteen files, unchanged
from the previous revision**. `lib/format.js` still does not import it; it names
it in comments explaining which of its tones health.js owns.

**Failure mode.** Competitor Price Scraping showed a green "Clean, 30 d — 100.0%"
pill while producing no price on most of its runs, because four screens each
tested `status === 'FAILED'` and counted everything else as success. A manager
reading that tile had no way to know the scraper had found nothing all month.

**Regression test.**

1. `node health_parity.mjs` — runs the real `lib/health.js` over every distinct
   `(status, summary)` pair in `audit_log`, weighted by row count, and compares
   against `nexus_outcome_class`.
   **Result 2026-09-02, re-run live: 634 rows compared, 634 in agreement,
   0 disagreements** (311 distinct pairs). No class outside the declared
   vocabulary. Exit 0. Distribution, identical on both sides:

   | class | n | change since the previous revision |
   |---|---|---|
   | SUCCESS | **212** | *(was 199)* |
   | FAILURE | **211** | *(was 199)* |
   | NO_RESULT | **152** | *(was 127)* |
   | REJECTED_EXPECTED | 36 | unchanged |
   | PARTIAL | 21 | unchanged |
   | ESCALATED | 2 | unchanged |

   **Re-measured 2026-09-03: `audit_log` holds 687 rows across 340 distinct
   pairs, and the class distribution is SUCCESS 216 · FAILURE 231 · NO_RESULT
   173 · REJECTED_EXPECTED 42 · PARTIAL 23 · ESCALATED 2. Nothing entered a
   class outside the declared vocabulary; FAILURE has overtaken SUCCESS.** The
   parity harness was not re-run on 2026-09-03 — the classification was
   re-measured in the database only — so treat the 634/634 agreement below as a
   2026-09-02 result and re-run `health_parity.mjs` before quoting parity.

   `audit_log` holds **634 rows**, up from 584 at the previous revision, across
   **311** distinct pairs, up from 289. The growth is **+13 SUCCESS, +12 FAILURE
   and +25 NO_RESULT**; nothing entered a class that did not already exist, and
   the parity harness was genuinely re-run against a pair file refreshed from
   the live catalogue rather than the figures being transcribed.

   Six of the new rows are the **Inventory Action Center**, which is the first
   writer to `audit_log` that is not an n8n workflow — they are decisions people
   took in the dashboard. Five class SUCCESS and one classes **NO_RESULT**: the
   row recording that a second decision arrived for an action already approved
   and was refused so the first decision stood. That is a control working, and
   an automation vocabulary has no word for it. It is why the Action Center is
   deliberately not in `workflow_registry` and reports through
   `v_action_center_health` instead — registering it would have published
   `DEGRADED, 83.3%` for a desk that is working correctly (measured 2026-09-02
   by inserting the registry row inside a transaction and rolling it back).
2. Grep for screens classifying status themselves — comments stripped,
   pattern `(status|st)\s*===?\s*['"](FAILED|SUCCESS|PARTIAL|NOT_EXECUTED|REJECTED|ESCALATED)['"]`.
   **Result 2026-09-02: 8 matches on 7 lines, all in `lib/health.js`. Zero in
   any screen.** Unchanged.
3. No workflow reported HEALTHY carries a failure, partial, no-result,
   escalation or unknown in its window.
   **Result 2026-09-02: all five counts zero, over 2 HEALTHY workflows**
   (Ask-AI - RAG Query Agent, Inventory Ageing Recompute). Unchanged.

**`HEALTHY` is structurally closed against NO_RESULT and ESCALATED.** Re-read
off `pg_get_viewdef('public.v_workflow_health')` at 05:23 on 2026-09-02, the
health `CASE` in the live view is, in order: `NOT_INSTRUMENTED` when the
registry says the workflow writes no audit row; `NEVER_RAN` at zero runs;
`DEGRADED` on `failures_30d > 0`; `DEGRADED` on `partials_30d > 0`;
`UNKNOWN_OUTCOME` on `unknown_30d > 0`; **`DEGRADED` on `escalated_30d > 0`**;
`NO_QUALIFYING_RUNS` on `effective_runs_30d = 0`; `PRODUCING_NOTHING` when
`no_result_30d * 2 > effective_runs_30d`; **`DEGRADED` on `no_result_30d > 0`**;
else `HEALTHY`. Both branches added by
`inv001_workflow_health_healthy_is_structurally_closed` are present in the live
definition. HEALTHY requires every qualifying run to have succeeded outright,
which is what `HEALTH_WORDS.HEALTHY` already told the reader it meant.

---

## INV-002 · A customer is one person, and an uncertain match is refused

**Business rule.** Messages belong to the customer who sent them, and when the
dealership cannot tell two customers apart by phone number it attaches the
message to neither rather than guessing.

**Source of truth.** `v_lead_messages` for message-to-lead resolution;
`lib/identity.js` for the same rule in the frontend.

**Owner.** Postgres owns resolution. `lib/identity.js` is the only frontend
module permitted to decide whether two keys are the same person.

**Write path.** Nothing writes a resolution. `communication_logs.lead_email`
holds whatever key the channel supplied — a real address, `<digits>@c.us`,
`+<digits>@whatsapp.lead`, or an opaque `<lid>@lid`. Resolution happens on read.

**Read path.** `v_lead_messages` joins on, in order: exact lowercased email;
last-9-digits of a phone-bearing key, **but only when that 9-digit tail belongs
to exactly one person** (the `unique_tail` CTE); and for `@lid` keys, a bridge
through `whatsapp_contacts`. A tail shared by two people matches nothing.
Screens call `expandIdentity` / `sameIdentity` / `personQuery` from
`lib/identity.js` rather than slicing phone strings themselves.

**Frontend consumers.** Re-grepped 2026-09-02 05:2x, unchanged at nine files:
`screens/campaigns.js`, `screens/compliance.js`, `screens/conversations.js`,
`screens/customers.js`, `screens/deals.js`, `screens/leads.js`,
`screens/overview.js`, `lib/deal-form.js`, `lib/lead-drawer.js`.

**Failure mode.** Before the guard, a message from one customer was attributed to
another whose number ended in the same nine digits, and two screens showed
different message counts for the same person — each confident, neither right.

**Regression test.**
**Result 2026-09-02, unchanged from the previous revision: lead 34 → 8 rows,
lead 35 → 10, lead 38 → 29** — the canonical *resolution* figures. These count
rows resolved to a lead, not messages: filtered by the `is_message` column
(INV-004) the same three leads hold **7 / 10 / 28** messages, the difference
being one silence marker each for leads 34 and 38. Quote whichever figure the
question asks for, and never the resolution count under the word "messages".
Collision probe returns **0 rows**: `leads` holds **3 distinct 9-digit phone
tails** and the maximum number of distinct people on any one of them is **1**.
Resolution coverage: **99 rows in `communication_logs`, 47 resolved by
`v_lead_messages`, 52 unresolved.**

**The two identity paths in Postgres implement the same rule.** Re-verified
2026-09-02 by comparing `nexus_lead_for_comm_key(text)` against `v_lead_messages`
over **all 14 distinct `communication_logs.lead_email` keys**: **14 agree, 0
disagree** — 6 keys resolve to the same lead on both paths, 8 resolve to NULL on
both.

**Re-verified 2026-09-03 over all 15 distinct keys: 15 agree, 0 disagree** — **6
resolve identically and 9 resolve to NULL on both paths.** The six:
`+918517942172@whatsapp.lead`, `shabbir53ujjainwala@gmail.com` and
`158510264357112@lid` → lead 38; `+971547484167@whatsapp.lead` and
`155315328786434@lid` → lead 34; `111948809162873@lid` → lead 35, reached through
the `whatsapp_contacts` bridge. Collision probe re-run: **3 distinct 9-digit tails
across 3 leads, maximum 1 person per tail.** The ambiguity guard is still untested by live data, because no collision
exists to trigger it; what is guaranteed is that when one appears, both paths
refuse it.

One asymmetry survives and is deliberate: the function counts people matching
the tail against `leads.phone` **or** digits embedded in `leads.email`, while
the view's `unique_tail` CTE counts only against `leads.phone`. The function's
guard is therefore strictly the wider of the two and can refuse where the view
resolves. Unobservable today — all three leads have distinct tails — but it is
one rule spelled with two extents.

### CLOSED at the schema and code layer 2026-09-02 — a sale can now name the lead it came from. **Not proven at runtime.**

The previous revision recorded that `purchase_history` had no `lead_id` and no
`customer_id`, so a sale could only be joined back to a person by re-running the
identity inference this invariant exists to make refusable. Four things had to
change together. All four have:

1. **The column.** Migration `20260902045735 inv002_purchase_history_lead_id`.
   Confirmed live 2026-09-02: `purchase_history.lead_id`, `integer`, nullable,
   no default; constraint `purchase_history_lead_id_fkey`
   `FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL`; index
   `purchase_history_lead_id_idx` on `btree (lead_id)`. All three read out of
   `information_schema.columns`, `pg_constraint` and `pg_indexes` respectively.
2. **The dashboard.** `lib/deal-form.js:167` adds `lead_id` to the posted body —
   **conditionally**, `...(picked && picked.anchor === $('dEmail').value.trim() ? { lead_id: picked.id } : {})`.
   A deal typed by hand rather than picked from a lead posts no `lead_id` at
   all, and the file's own comment at lines 121–149 says so. That is the right
   behaviour for this invariant — an unrecorded provenance is better than a
   guessed one — but it means `lead_id IS NULL` will be a normal state, not an
   error state, and nothing downstream may read a NULL there as "no lead exists".
3. **`Format Deal Text`.** The node now reads `d.lead_id` / `d.leadId`, coerces
   to a positive integer, and returns `lead_id` in its object. Anything absent,
   empty or non-integral becomes `null` rather than raising — deliberately, so a
   bad id cannot cost the sale itself.
4. **`Record Purchase`** (node `263e6e0c-0bf5-424e-9ad4-ba60fcdaaeb8`) names
   `lead_id: $json.lead_id` in the JSON body it POSTs to
   `/rest/v1/purchase_history`.

Read live from n8n 2026-09-02: workflow `dhy2DDjWUqwuzHLW`, "Sync Closed-Won
Deals to Supabase pgvector", `versionId` = `activeVersionId` =
**`563d0df3-368c-4543-9b85-ab5e907cb976`**, updated `2026-09-02T05:00:48Z`. Both
nodes carry `lead_id` in the published version.

**WIRED, NOT FIRED — as measured on 2026-09-02. Superseded 2026-09-03: it has
now fired.** The paragraphs immediately below are kept as they were written,
because a register that quietly rewrites its own past cannot be audited. Read
the correction that follows them.

- `purchase_history` holds **0 rows**. It held 0 before this migration and holds
  0 now. **No sale has ever been written through this path**, with or without a
  lead id.
- n8n retains **zero executions** for `dhy2DDjWUqwuzHLW` (`search_executions`,
  workflow-filtered, returns `count: 0`). The webhook was not fired to test this
  change, and there is no retained run to inspect.
- The previous claim that it has "zero executions in its entire history" is
  **narrower than the evidence supports, and this register should say so.**
  `audit_log` holds **2 rows attributable to this workflow**: a `FAILED` row on
  **2026-08-17 18:05:53Z** whose summary names `Execution 2018` and reports the
  run aborting at the `Format Deal Text` node — *"unauthorized. A valid Supabase
  session token is required in the Authorization header"* — and a `SUCCESS` row
  on **2026-08-23 06:26:58Z** with the summary `Completed`, a summary shape the
  current `Delivery Report` node no longer produces, so it came from an older
  build. The workflow has run before; n8n has simply not retained those
  executions. What is true is the thing that matters: **no run has ever written
  a `purchase_history` row**, so the `Record Purchase` node, the FK, and the
  whole `lead_id` chain are unexercised.

So: closed in the schema, closed in the dashboard, closed in the published
workflow, and **untested end to end**. The first real closed-won deal is the
test. Until one lands, this invariant holds by construction only.

#### CORRECTION 2026-09-03 — the deal landed. FIRED and PROVEN.

The test above happened. Measured 2026-09-03 through the read-only SQL channel,
`purchase_history` holds **one row**:

| column | value |
|---|---|
| `id` | `2f04d2c4-4cd2-424c-aa34-6cc2a0c20b86` |
| `lead_id` | **`38`** — populated, not null |
| `deal_id` | `auto:shabbir53ujjainwala@gmail.com|2026-09-02` |
| `amount_aed` | `585000` |
| `purchase_date` | `2026-09-02` |
| `tenant_id` | `fff6a2b5-cfd5-4460-8383-875bc5826de0` |

`lead_id = 38` is the lead the sale came from, and lead 38 is the same person the
identity rule resolves those 28 messages to. **A sale can now name the lead it
came from, and one does.** `pg_stat_all_tables` shows 35 inserts and 13 deletes
against the table, so the path has been exercised repeatedly and a teardown
script clears the test rows; the one surviving row is the real deal. `CLAUDE.md`
records it as submitted four times through the live dashboard producing one row,
so idempotency is proven rather than assumed.

Two things this does **not** prove, and neither should be claimed:

- The `deal_id` is **synthesised at the moment of sale** as
  `auto:<email>|<date>`. There is no deal record created at first commitment,
  which is why `v_deal_rescue` is structurally empty — see
  `v_deal_rescue_readiness`, prerequisite `DEAL_RECORD`.
- **Nothing links the sale to a unit.** `v_attribution_sale_chain` grades the
  VEHICLE hop `UNKNOWN_TEXT_ONLY` and its margin `NOT_COMPUTABLE` on this exact
  row. The chain refuses to invent the link rather than guessing it, which is
  this invariant working; it is not the same as the link existing.

**Note, not a violation.** `screens/finance.js` does not import `lib/identity.js`
and joins on the raw `lead_email` string — **30 code references, comments
stripped, unchanged from the previous revision**. That is narrower than the
identity rule, not in conflict with it: it will miss a customer whose quote
carries a different key shape rather than misattribute one. Unobservable now —
`finance_quotes` holds **0 live rows** (re-checked 2026-09-03; 25 inserts and 15
deletes on the table, so rows have existed and were cleared by a teardown, and
the shape is still untested against live data).

---

## INV-003 · One clock decides how fast a lead was answered

**Business rule.** How long a customer waited for a first reply is measured once,
by the system, at the moment the reply is logged — and a blank means nobody
measured it, not that nobody replied.

**Source of truth.** `leads.response_time_minutes`.

**Owner.** The trigger `trg_comm_logs_first_response` on `communication_logs`,
running `nexus_mark_first_response()`. Exactly one writer.

**Write path.** AFTER INSERT on `communication_logs`. The function returns early
unless `nexus_is_reply(direction, channel, message)` — so `[system]` and
`[SILENCE-` rows never start the clock (see INV-004). It resolves the lead via
`nexus_lead_for_comm_key`, stamps only where `response_time_minutes IS NULL`, and
declines to measure a reply that predates the lead row by more than 90 seconds,
leaving NULL rather than clamping to zero. Its whole body is wrapped so a
measurement failure can never block message logging.

**Read path.** Screens read the column. They never subtract two timestamps to
produce it. SLA counts come from `v_team_performance.within_sla` /
`breached_sla`, which are `count(*) FILTER` on the same column at `<= 5` and
`> 5`; a NULL lead counts in neither.

**Frontend consumers.** Comment-stripped reference counts, re-taken 2026-09-02:
`screens/team.js` (10), `screens/leads.js` (6), `screens/overview.js` (3),
`screens/customers.js` (3), `lib/lead-drawer.js` (3). Unchanged.

**Failure mode.** Until 31 Aug 2026 a second BEFORE INSERT trigger on `leads`
clamped a negative interval to 0 and locked the real writer out, so leads that
had never been answered displayed as answered instantly.

**Regression test.**
**Result 2026-09-02:** `leads` carries exactly **one** non-internal trigger,
`trg_assign_hot_lead`, which does not touch the column. Of the two functions
whose source mentions `response_time_minutes`, only `nexus_mark_first_response`
matches `set\s+response_time_minutes` (`writes_it = true`);
`capture_daily_metrics` reads it and does not write it. Column state:
**2 leads populated (1 and 4 minutes), 1 NULL, 3 leads total** — the NULL is
lead 35, Effco Contracting llc. Frontend derivation check — grep for
`response_time_minutes\s*=` across `screens/*.js` and `lib/*.js` with comments
stripped: **zero assignments.** All unchanged.

`nexus_is_reply` is still defined by delegating to `nexus_is_message` rather than
restating it, so the two cannot drift apart and strand an answered lead with a
NULL response time. Re-verified under INV-004.

---

## INV-004 · A silence marker is not a message

**Business rule.** When twelve hours pass with no reply, the system files a note
saying so. That note is a record of nobody being in touch — it is never counted
as a message, never as a reply, and never as the date the dealership last spoke
to the customer.

**Source of truth.** `public.nexus_is_message(direction, channel, message)`, an
IMMUTABLE SQL function. It is the single definition of what counts as a message;
`lib/comm-events.js` mirrors it in the browser.

**Owner.** The n8n workflow "Phase 6 — 12-Hour Silence Detector" writes the
markers. Nothing else may.

**Write path.** The detector fires once for a lead that received an outbound
message and did not answer within twelve hours, inserting a `channel='system'`
row prefixed `[SILENCE-ESCALATED]`. Both rows on file carry
`direction='outbound'`; the detector's current build writes `internal`, which is
why the channel and the body are tested as well and not instead.

**Read path.** Every consumer must exclude them before counting messages, before
counting replies, and before dating last contact. The rule is
`nexus_is_message`: direction in (inbound, outbound), channel in (whatsapp,
email, sms), body matching neither `[system]%` nor `[SILENCE-%`.
`v_lead_messages` carries it as an `is_message` column; `v_conversations` carries
`msg_count`, `internal_count`, `msg_inbound_count`, `msg_outbound_count`,
`last_msg_at`, `last_msg`, `last_msg_direction` and `awaiting_msg_reply` beside
its original all-rows columns, which were left in place because other consumers
sort on them.

**Frontend consumers.** Re-grepped 2026-09-02, unchanged: `lib/comm-events.js` —
`MARKER_PREFIXES`, `SILENCE_MARKER`, `isMarkerText`, `isMessageRow`,
`isInternalRow`, `isInboundMessage`, `isOutboundMessage`/`isReply`,
`lastContactAt`, `splitEvents`, `silenceCount` — imported by
`screens/campaigns.js` (line 158), `screens/conversations.js`,
`screens/customers.js`, `screens/overview.js` (line 154) and
`lib/lead-drawer.js` — **five files**. `screens/leads.js` defers to the DB rule.

**Failure mode.** A thread preview rendered "[SILENCE-ESCALATED] Silent for 12h
since …" as though the dealership had sent the customer that text, and the
thread's last-contact date was taken from the marker — so a customer nobody had
spoken to in days looked freshly contacted.

**Regression test.**
**Re-measured 2026-09-03: `communication_logs` holds 108 rows — 106 messages,
2 internal, 23 replies by `nexus_is_reply`. Both system rows are still the only
silence markers and no marker exists on any other channel. The delegation
identity `nexus_is_reply = nexus_is_message AND direction = 'outbound'` still
returns `true` over all 108 rows, and 0 rows carry a padded direction or
channel.** `v_lead_messages` now resolves **53** rows, up from 47. The
2026-09-02 figures follow, unchanged as written.

**Result 2026-09-02, every figure unchanged from the previous revision:**
`communication_logs` holds **99 rows** — whatsapp/inbound **78**,
whatsapp/outbound **19**, **system/outbound 2, and both system rows are silence
markers**; no marker exists on any other channel. By `nexus_is_message`:
**97 messages, 2 internal**. By `nexus_is_reply`: **19**.

Over all 99 live rows, `bool_and(nexus_is_reply(d,c,m) = (nexus_is_message(d,c,m)
AND btrim(lower(d)) = 'outbound'))` returns **true** — the delegation holds on
every stored row. **0 rows carry a padded direction or channel**, so the
`btrim` fix remains structural rather than a repair of anything on disk.

`v_needs_attention.unanswered_chat` keys off the message predicate
(`awaiting_msg_reply`, `last_msg_at`, `last_msg`), not the all-rows columns.
Over the **12 threads** in `v_conversations`, `awaiting_msg_reply` selects
**9** and the old `last_direction = 'inbound'` predicate also selects **9** —
they still differ on 0 threads. Current `v_needs_attention` totals, **13 rows**:

| kind | n |
|---|---|
| unanswered_chat | 9 |
| undercut | 2 |
| inventory_aging | 1 |
| workflow_failure | 1 |
| lead_unassigned | 0 |
| sla_breach | 0 |
| kyc_archive_gap | 0 |

All 13 rows carry a non-blank `severity`; **0 are blank**. That matters to the
`pill()` discussion under INV-008 and is measured here because this is where the
view is measured.

**Re-measured 2026-09-03 — the mix has moved sharply and the total has not.**
`v_needs_attention` holds **14 rows**, and **all 14 still carry a non-blank
severity (0 blank)**, so the `pill()` fallback under INV-008 remains latent
rather than live:

| kind | 2026-09-02 | 2026-09-03 |
|---|---|---|
| unanswered_chat | 9 | **3** |
| workflow_failure | 1 | **8** |
| undercut | 2 | 2 |
| inventory_aging | 1 | 1 |
| lead_unassigned | 0 | 0 |
| sla_breach | 0 | 0 |

`v_conversations` now holds **13 threads**, of which `awaiting_msg_reply`
selects **9**. The attention list has gone from mostly "a customer is waiting"
to mostly "a workflow is broken", which is a real change in what the dealership
would be shown and is recorded here rather than smoothed over.

---

## INV-005 · The dashboard shows finance figures, it does not work them out

**Business rule.** Monthly instalments and interest rates are quoted by the
finance system. The dashboard repeats what was quoted; it never calculates a
payment of its own.

**Source of truth.** `finance_quotes` — `monthly_payment_low_aed`,
`monthly_payment_high_aed`, `indicative_apr_low_pct`, `indicative_apr_high_pct`,
`apr_source`, `emi_unavailable_reason`.

**Owner.** The n8n workflow "Finance Calc: Auto Loan Equity & Credit Score".

**Write path.** The workflow computes the amortisation and writes the resulting
figures onto a `finance_quotes` row. Where it cannot price a quote it writes
`emi_unavailable_reason` and leaves `monthly_payment_low_aed` NULL — an explicit
"no instalment", not a zero.

**Read path.** `screens/finance.js` reads the stored columns and formats them.
`aprOf(q)` parses a rate already on the row; it does not derive one. Where
`monthly_payment_low_aed` is NULL the screen renders the reason rather than a
computed substitute.

**Frontend consumers.** `screens/finance.js` (the only screen touching quote
columns). `lib/deal-form.js` and `screens/deals.js` pass `budget_aed` through as
an attribute and compute nothing.

**Failure mode.** No observed failure — this invariant has held. The risk it
guards against is the dashboard and the finance workflow quoting a customer two
different monthly payments for the same car.

**Regression test.** Grep for amortisation arithmetic across `screens/*.js` and
`lib/*.js` with comments stripped.
**Result 2026-09-02: zero occurrences of `Math.pow` or `**` in frontend code.**
`Math.pow` matches twice on a raw grep, at `screens/finance.js:470–471`, and
**both hits are inside a comment recording that the old amortisation was
removed** — they disappear when comments are stripped. That distinction is
written down here because the raw grep now returns a non-zero count and a future
reader would otherwise read it as a regression. No rate-over-12 term, no
principal loop. `finance_quotes` holds **0 rows**, so this is a source-level
guarantee, not one exercised by live data.

---

## INV-006 · "Rejected" means two different things and must stay split

**Business rule.** A request the system refused on purpose is fine. A scraper
that ran, was told no, and came back with no price is not fine — it is a job
producing nothing, and it must not be filed under the same word as a deliberate
refusal.

**Source of truth.** `nexus_outcome_class`, which splits `status='REJECTED'` on
the summary text: matching `unauthor|forbidden|refused by validation|invalid
token|not permitted` → `REJECTED_EXPECTED`; everything else → `NO_RESULT`.

**Owner.** Postgres, via the same function as INV-001.

**Write path.** n8n writes `status='REJECTED'` for both cases — the writers do
not distinguish. The split is made on read, from the summary the writer emits.

**Read path.** `REJECTED_EXPECTED` is excluded from `effective_runs_30d`, so a
genuine refusal cannot dilute a success rate. `NO_RESULT` stays in the
denominator, drives `PRODUCING_NOTHING` once `no_result_30d * 2` exceeds
`effective_runs_30d`, and forces DEGRADED at any count above zero. Neither is
green in `lib/health.js`.

**Frontend consumers.** `screens/competitors.js`, `screens/ask.js`,
`screens/finance.js`, `screens/automation.js`, `screens/settings.js` — all via
`lib/health.js` and the `v_workflow_health` columns.

**Failure mode.** Collapsing the two showed Competitor Price Scraping at a clean
100%, because its "no price found" runs were read as deliberate refusals and
dropped from the denominator. The dealership believed it had current competitor
pricing; it had none.

**Regression test.**
**Result 2026-09-02:**

| workflow | class | n | previous |
|---|---|---|---|
| Competitor Price Scraping | NO_RESULT | **106** | 94 |
| Finance Calc | REJECTED_EXPECTED | 33 | 33 |
| Finance Calc | NO_RESULT | 21 | 21 |
| Ask-AI RAG Query | REJECTED_EXPECTED | 3 | 3 |

**This is the figure that got worse, and on 2026-09-03 it got worse again:
Competitor Price Scraping's no-price count reads 151, and the workflow's live
health is `PRODUCING_NOTHING` at 17 successes over 168 effective runs —
10.1%.** Finance Calc's `REJECTED_EXPECTED` is 36 and its `NO_RESULT` 21;
Ask-AI's `REJECTED_EXPECTED` is 6. One new `NO_RESULT` belongs to the Inventory
Action Center, which is the refusal-of-a-second-decision row described under
INV-001 and is a control working, not a fault. The split still holds: every one
of these is classified from the summary on read, and no writer distinguishes
them.

The 2026-09-02 reading follows as written. Competitor Price Scraping's no-price
count had gone **84 → 94 → 106** across three measurements. All twelve new
`audit_log` rows carry one of four complaints: no price could be extracted from
the page; the source was the placeholder `"null"`; `"google.com"` is a search or
social site, not a seller; the page carried no identifiable source.

**All twelve were logged in a single burst at 2026-09-02 01:00:25 UTC** —
`min(logged_at)` and `max(logged_at)` are 70 milliseconds apart — so this is one
scheduled sweep writing one row per vehicle, not twelve separate runs. **The
whole of last night's sweep returned no usable price for any vehicle.**

Current health rows, read from `v_workflow_health` 2026-09-02:

| workflow | health | successes_30d | effective_runs_30d | success_rate_30d |
|---|---|---|---|---|
| Competitor Price Scraping | PRODUCING_NOTHING | 14 | 120 | **11.7%** *(was 13.0%)* |
| Finance Calc | DEGRADED | 3 (+5 partials) | 29 | 10.3% |
| Ask-AI - RAG Query Agent | HEALTHY | 11 | 11 | 100.0% |
| KYC/AML Document Auditor | DEGRADED | 0 | 7 | 0.0% |

Competitor's 106 no-results against 120 effective runs satisfy the
`no_result_30d * 2 > effective_runs_30d` test twice over. Finance Calc's 33
genuine refusals are correctly excluded from its denominator, and Ask-AI's 3 are
also excluded — which is why 11 of its 14 runs are the ones being rated.

---

## INV-007 · No record is not proof that nothing happened

**Business rule.** An empty KYC register means the dealership does not know
whether a document was checked. It does not mean no document exists, and it must
never be shown as a clean compliance result.

**Source of truth.** `kyc_documents`. The honest answer to "is this customer
verified?" is one of three values — verified, failed, **unknown** — and unknown
is a real answer, not a blank to be styled as a pass.

**Owner.** The n8n workflow "KYC/AML Document Auditor (Phase 5)".

**Write path.** The auditor inserts a row per document examined, carrying
`verdict`, `is_valid`, `confidence_score`, `attempt_number`. A run that fails
before it reaches the insert leaves no row at all — which is exactly the case
this invariant covers.

**Read path.** `screens/compliance.js` must render the absence as "unknown" and
say what it does not know. A customer with no `kyc_documents` row is not
compliant and is not non-compliant; they are unaudited.

**Frontend consumers.** `screens/compliance.js`, `screens/customers.js`.

**Failure mode.** The observed case is live right now, and 2026-09-03 sharpened
it rather than closing it. **On 2026-09-02: `kyc_documents` held 0 rows while the
auditor had 9 logged runs** — 7 failures and 2 escalations in 30 days, 0
successes. Nine documents entered the process and the register recorded nothing
about any of them.

**Re-measured 2026-09-03: `kyc_documents` holds 3 rows, and 0 of them are
verified.** The auditor now shows **12 runs in 30 days, 10 failures, 2
escalations, 0 successes, `effective_runs_30d = 10`, `success_rate_30d = 0.0`,
`health = DEGRADED`**. So the register has gone from empty to *populated and
still uninformative*, which is the more dangerous shape: a screen counting rows
would now find three and could be read as three checks having happened.
**A row appearing is not the capability working — check the outcome, not the
count.** Three documents were examined, none was verified, and the auditor has
not succeeded once. A compliance view reporting "no problems found" here would
still be reporting the auditor's own failure as a clean result.

**Regression test.**
**Result 2026-09-02: `kyc_documents` = 0 rows; auditor runs_30d = 9;
failures_30d = 7; escalated_30d = 2; successes_30d = 0; effective_runs_30d = 7;
success_rate_30d = 0.0; health = DEGRADED.** The planner's stale estimate for
the table (`pg_class.reltuples`) was **9**, which is the fingerprint of rows
that once existed and are gone.

**Result 2026-09-03: `kyc_documents` = 3 rows, 0 verified; runs_30d = 12;
failures_30d = 10; escalated_30d = 2; successes_30d = 0; effective_runs_30d = 10;
success_rate_30d = 0.0; health = DEGRADED.** `pg_class.reltuples` now reads 3 and
agrees with the count. Lifetime table activity is 36 inserts and 37 deletes, so
the churn behind that "9" is confirmed rather than inferred. Measured as `postgres` with `rolbypassrls = true`, so the
zero is real and not RLS hiding rows from this connection — and it stays real
now that the five views carry `security_invoker`, because this count is taken
against the table, not through a view.

---

## INV-008 · One number, one derivation

**Business rule.** A figure the dealership acts on — pipeline value, failure
count, message count — is worked out in exactly one place. Two places means two
answers, and nobody can tell which one is the business.

**Source of truth.** Whichever single view or function owns the figure. This
invariant is about there being only one.

**Owner.** Per figure; the point is that ownership is unique.

**Write path / Read path.** A figure computed in the database is read, not
recomputed, by the frontend. A figure computed in the frontend has no database
twin.

**Frontend consumers.** All twenty screens on this branch (fourteen on
`origin/main`, which is what production builds — see
`apps/executive-dashboard/README.md`).

**Regression test.** SQL probes plus greps for the same business number computed
twice. **Three of the previous revision's four violations are now closed. One is
narrowed but not closed, and it comes with a correction of a claim this register
made and got wrong.**

### CLOSED 2026-09-02 — open pipeline has one rule in three places

`public.nexus_lead_is_open(text)` exists, `IMMUTABLE`, `SET search_path TO ''`
(pinned by `20260902050255`). Its terminal list is exactly the union of
`lib/pipeline.js`'s `TERMINAL_TONES` — `won`: WON, CLOSED_WON, CONVERTED,
DELIVERED, SOLD; `dead`: LOST, CLOSED_LOST, DISQUALIFIED, UNQUALIFIED, CLOSED,
DEAD, JUNK, SPAM, ARCHIVED — and it normalises the same way the browser does
(`upper`, whitespace and hyphens collapsed to `_`, against JS `toUpperCase()`
and `replace(/[\s-]+/g, '_')`).

**Parity measured, not assumed.** Both implementations were run over the same 25
status values — every won word, every dead word, the open lifecycle words, the
empty string, NULL, a padded `'  won  '` and an invented `'Some New Word'`.
**25 of 25 agree**, including the two cases that matter most: an unrecognised
status is **open** on both sides, and a padded `'  won  '` is **open** on both
sides (neither normaliser trims, so both file it as a word they do not know).

Read live 2026-09-02 05:24:
- `v_team_performance.pipeline_aed` is
  `sum(l.budget_aed) FILTER (WHERE nexus_lead_is_open(l.status))` — **no
  `COALESCE`**. It returns **NULL** for the one row the view has (Ali Asgher,
  1 lead assigned), where the previous revision measured **0**.
- `capture_daily_metrics().pipeline_aed` is
  `(SELECT sum(budget_aed) FROM leads WHERE nexus_lead_is_open(status))` — also
  **no `COALESCE`** — stamped into `daily_metrics.pipeline_aed_rule` as
  `'open_leads_null_when_unknown'`. Today's row records **`pipeline_aed = NULL`**
  where 2026-09-01's records **0** under `'all_leads_coalesce_0'`.

"No budget is recorded" is no longer stored or served as "AED 0". All 3 leads
still carry `budget_aed = NULL`, so no displayed figure moved — the screens
already rendered "—" through `sumBudget`, which returns null rather than 0.

`lib/pipeline.js` owns the frontend rule: grep confirms `TERMINAL_TONES` and
`isOpenLead` are declared in **exactly one file**, and `screens/overview.js:178`
and `screens/team.js:175` are its only importers. `LEAD_LIMIT` is 2000 in the one
place it now lives.

**The snapshot history is mixed-rule, and that is the residue.** Every
`daily_metrics` row before 2026-09-02 was written under the old definitions and
still says so in `pipeline_aed_rule` (`'all_leads_coalesce_0'`) and
`open_leads_rule` (`'status_not_closed'`). Subtracting across that boundary
subtracts two definitions. `screens/overview.js` refuses to draw a
period-over-period delta on the pipeline tile and its comment now gives the
mixed history as the reason rather than the defect that has been fixed. That
refusal is not gated on `pipeline_aed_rule` — the screen reads the newest row
and does not look at the column — so the refusal is correct today for a reason
the code cannot check. Gating it on the rule column would be a behaviour change
and has not been made.

### CLOSED 2026-09-02, DURING THIS PASS — `capture_daily_metrics` held two definitions of "open" in one INSERT

This was going to be recorded here as a new open violation, and for the first
nine minutes of this pass it was one. Both states are recorded, because a
register that shows only the end state cannot be audited.

**At 05:15:49 UTC**, `pg_get_functiondef(capture_daily_metrics)` read:

```
(SELECT count(*) FROM leads WHERE status <> 'CLOSED' OR status IS NULL),   -- open_leads
...
(SELECT sum(budget_aed) FROM leads WHERE nexus_lead_is_open(status)),      -- pipeline_aed
```

Two rules for "open" in one statement, writing two columns of one row. Live at
that moment, the 2026-09-02 snapshot (captured 05:01:12) recorded
**`open_leads = 3`** while only **1** lead is open under the shared rule: leads
34 and 35 are both `DISQUALIFIED`, which `nexus_lead_is_open` calls closed and
`status <> 'CLOSED'` calls open. One row of one table asserting both 3 and 1
about the same three leads.

**At 05:16:36 UTC** migration `20260902051636 inv008_open_leads_one_rule_per_row`
landed. Re-read at **05:24:06**, `open_leads` is
`(SELECT count(*) FROM leads WHERE nexus_lead_is_open(status))`, stamped into a
new `daily_metrics.open_leads_rule` column, and the 2026-09-02 row was
re-captured at **05:17:00** reading **`open_leads = 1`, `open_leads_rule =
'nexus_lead_is_open'`**. The 2026-09-01 and earlier rows read
**`open_leads = 3`, `open_leads_rule = 'status_not_closed'`** — backfilled, not
rewritten, which is the same choice made for `workflow_failures_rule` and the
right one.

So a snapshot row is internally consistent from 2026-09-02 onward. **The mixed
history is the whole of the remaining problem**, and it is the same residue the
pipeline closure leaves.

### CLOSED 2026-09-02 — the stored workflow failure count uses the class

`capture_daily_metrics()` counts
`WHERE nexus_outcome_class(workflow, status, summary) = 'FAILURE'` and stamps
`workflow_failures_rule`. Today's row, captured 05:17:00, is the **first
snapshot written under the new rule**. Recaptured at 19:59 the same day it
reads `workflow_runs = 634`, `workflow_failures = 211`,
`rule = 'nexus_outcome_class'`, `workflow_failures_canonical = 211` — the two
agree because they are the same query. The 2026-09-01 row still reads
`205 / 'raw_status' / 199`, and the 14 historical rows still carry their
original values, which is the point of keeping the rule column. The current gap
between the rules is still **6 rows** (217 raw `FAILED` against 211 canonical
FAILURE over 634 `audit_log` rows) — the same six rows that spell `FAILED` but
mean PARTIAL.

No screen renders any of this: `workflow_failures` has **zero references**
across `screens/*.js` and `lib/*.js`, re-grepped 2026-09-02.

### CLOSED 2026-09-02 — customer message count has one derivation

The previous revision recorded `screens/customers.js` printing its own count of
`communication_logs` rows alongside `v_customer_360.message_count` and
explaining the difference in prose. That is gone. Read at
`screens/customers.js:1431–1432`, the rule is now one line:

```
const msgSource = viewMsgs != null ? 'view' : readMsgs != null ? 'read' : null;
const msgCount  = msgSource === 'view' ? viewMsgs : msgSource === 'read' ? readMsgs : null;
```

**`v_customer_360.message_count` owns the figure wherever the view has the
customer.** The local count is the fallback, used only where the view has no row
— and the sub-line names which of the two answered, every time. The last-contact
timestamp travels with the count from the same source, so a total and a
timestamp can never again come from two populations. The derivation that did not
answer becomes a **check**: where both exist and agree, the screen says so;
where they disagree it reports the disagreement as a fault rather than
explaining it away.

**The live figures, measured 2026-09-02:**

| lead | person | `v_customer_360.message_count` | `v_lead_messages` resolution rows | of which messages |
|---|---|---|---|---|
| 38 | Ali · `shabbir53ujjainwala@gmail.com` | **28** | 29 | **28** |
| 34 | Siva Thangavelu · `+971547484167@whatsapp.lead` | **7** | 8 | **7** |
| 35 | Effco Contracting llc · `email = ''` | **no row** | 10 | **10** |

The view and the screen's own count now agree on both customers the view holds
— 28 and 7 — so the check passes and the gap the previous revision recorded (29
vs 28, 8 vs 7) is gone, because the screen was counting *events* and is now
counting *messages*. The two silence markers are the difference between the
29/8 resolution figures and the 28/7 message figures, exactly as INV-004 says.

**Lead 35 is why the fallback cannot be dropped.** `v_customer_360` returns
**2 rows**, not 3: its spine is `leads UNION purchase_history WHERE email <> ''`,
and Effco Contracting llc's `email` column holds the empty string. He is absent
from the view and his 10 messages are counted locally. That is a real hole in
the view's spine, disclosed rather than papered over, and it is the reason this
was closed in the screen and not in the database.

### NARROWED, NOT CLOSED — `pill()` provenance. And a correction of this register's own claim.

**First, the correction.** The previous revision listed eight call sites under
the heading *"Needs `{ verbatim: false }` — the label is the caller's own word,
no tone is passed, so the default wrongly claims the database holds it."* That
list was wrong about which calls were actually lying to a reader, and a register
that quietly drops its own wrong claim is not a register.

The helper's fallback is `verbatim = stated ? !!opts.verbatim : !t`, and the
note is attached only when `k === 'unknown' && !named && verbatim`. Two
consequences the previous revision did not follow through:

1. **Any call passing a truthy tone already suppressed the note**, because `!t`
   is false. `pill(statusLabel(r), hasAccount(r) ? 'ok' : undefined)` on
   `screens/team.js` could not attach a false note on the branch where an
   account exists. Verified by running the real `lib/format.js`:
   `pill('Active','ok')` and `pill('HIGH','hot')` both emit **no** `title`.
2. **A label the TONE table knows never carries the note**, whatever the
   fallback decides. `NEW` is a TONE key (`'open'`), so every
   `pill(status || 'NEW')` — the three sites on `campaigns.js`, `customers.js`
   and `leads.js` the previous revision flagged — was safe on both branches.
   Verified: `pill('NEW')` emits no `title`.

**Three code shapes actually attached the note to a caller's own word on every
render, all of them reached through a falsy tone**, and these are the ones that
were lying on screen:

- `screens/ask.js` — `pill('UNREPORTED', tone(''))`. `tone('')` returns `''`, so
  the explicit-tone path is not taken and the fallback claims the database holds
  the word "UNREPORTED".
- `screens/automation.js` — `SCHED.CLOCK_RESET`, label `'Clock restarted'`, and
  `SCHED.UNCHECKABLE`, label `'Cannot be checked'`, both declared with
  `tone: ''` at `automation.js:734` and `:736`. Same falsy-tone path, same false
  claim, on two phrases no row anywhere contains.

Verified by running the real helper: `pill('UNREPORTED', tone(''))`,
`pill('Clock restarted','')` and `pill('Cannot be checked','')` each emit the
`title`; `pill('Active','ok')`, `pill('HIGH','hot')` and `pill('NEW')` do not.

**Three further shapes lied in code but could not fire on live data**, which is
a different and lesser thing, and the previous revision conflated the two.
`screens/overview.js` had `pill(l.status || 'Unscored')` at two sites and
`pill(str(it.severity) || 'Unrated')` at one. `pill('Unscored')` and
`pill('Unrated')` do both attach the note — verified — but the fallback only
renders when the column is absent, and it is not: **all 3 leads carry a status**,
and **all 13 `v_needs_attention` rows carry a non-blank severity**. Latent, not
live.

**What actually changed today.** `pill()`'s markup has one owner again.
`screens/automation.js`'s `wordPill`, `screens/finance.js`'s `wordPill` and
`screens/compliance.js`'s `casePill` no longer re-emit the helper's span by
hand: all three now call `pill(label, tone, { verbatim: false })` and keep only
the thing `pill()` cannot do, which is give each word its own explanatory
`title`. The three named helpers still exist as wrappers — they were not deleted
— but they are no longer **re-implementations**, and that was the defect.

**Why this is not closed.** Of **106 `pill(` call sites** across `screens/*.js`
and `lib/*.js` (comments stripped, `lib/format.js` itself excluded), **87 pass an
explicit `verbatim` flag and 19 do not**:

| file | unflagged sites |
|---|---|
| `screens/conversations.js` | 1013, 1445, 2219, 2430, 2853 |
| `screens/customers.js` | 1324, 1655, 1741, 1812 |
| `screens/deals.js` | 1479, 1654, 1836, 1895 |
| `screens/leads.js` | 746, 765, 1042, 1146 |
| `lib/lead-drawer.js` | 125 |
| `lib/unit-form.js` | 331 |

Checked one by one, **none of the 19 attaches a wrong note under today's data** —
they either pass a truthy tone (`conversations.js`'s `IDENT` tones are all
`'ok'`/`'cold'`/`'warm'`; `customers.js:1655`; `deals.js:1479`, `1836`, `1895`),
or pass a label the TONE table knows (`leads.js:746` and `:765` pass `'HOT'` or
`'WARM'`; the four `status || 'NEW'` sites), or pass a genuine raw column value
where the fallback's claim is true (`customers.js:1324`, `leads.js:1042`,
`unit-form.js:331`).

**One of the 19 is the lying shape itself.** `screens/deals.js:1654` is
`pill(str(a.severity) || 'ALERT', t)` where `t = tone(a.severity)` at line 1643.
When an alert carries no severity, `tone('')` is `''`, the fallback applies, and
the authored word **`ALERT`** — not a TONE key — is rendered with "shown exactly
as the database holds it". That is `ask.js`'s `pill('UNREPORTED', tone(''))`
verbatim, in a file the previous revision never listed. Whether it fires depends
on whether a deals-screen alert is ever built without a severity, which is a
frontend-derived value this register cannot measure from the database.

*To close:* pass the flag at the 19 remaining sites, `deals.js:1654` first.

**Also still outside the helper, and not previously recorded:** six `class="pill"`
spans are written by hand rather than through `pill()` — `screens/customers.js`
:1167 and :1654 (the `vip` tone, which the TONE table does not carry),
`screens/deals.js:1215`, and `screens/leads.js` :1050, :1094 and :1096. These
are not the three the previous revision named and they were not part of that
violation; they are recorded now because the claim "the markup has one owner"
would otherwise be broader than the measurement supports.

### Also checked, not a violation

Average first-response time is computed in `screens/overview.js` (mean of
`response_time_minutes` over leads read) and in `capture_daily_metrics`
(`avg(response_time_minutes)` over all non-null leads). Same definition,
different read scope; `overview.js` compares the two as a period-over-period
delta, which is the intended use, and the population really is the same. Worth
watching if `LEAD_LIMIT` (2000) is ever exceeded, since the frontend mean would
then be over a sample and the stored one over the population. Today's stored
value is **2.50 minutes** over the 2 measured leads (1 and 4).

---

## Last check

Every object another agent was changing during this pass was re-read at the end
rather than assumed, and then re-read once more after this file was written.
**Final state confirmed at 2026-09-02 05:29:30 UTC**, unchanged from the
05:24:57 reading:

| object | state at last check |
|---|---|
| `capture_daily_metrics()` | `open_leads` and `pipeline_aed` both on `nexus_lead_is_open`; rules stamped |
| `daily_metrics` 2026-09-02 row | `open_leads = 1`, `pipeline_aed = NULL`, captured 05:17:00 |
| `v_team_performance.pipeline_aed` | `NULL` on its single row |
| `v_conversations` | `security_invoker=true` |
| `v_customer_360` | `security_invoker=true` |
| `v_lead_messages` | `security_invoker=true` |
| `v_needs_attention` | `security_invoker=true` |
| `v_workflow_health` | `security_invoker=true` |
| `get_advisors` (security) | zero ERROR lints, observed 05:24:42 |
| `max(schema_migrations.version)` | `20260902051823`, 81 applied |
| `architecture/schema.sql` | generated 05:01 against `20260902050255` — **two migrations behind** |

Two migrations landed while this pass was running (`20260902051636` at 05:16 and
`20260902051823` at 05:18) and both closed things this file was about to record
as open. Four `screens/*.js` and `lib/*.js` files were also written mid-pass —
`screens/deals.js` at 05:17:48, `lib/pipeline.js` at 05:19:08,
`screens/team.js` at 05:20:06, `screens/overview.js` at 05:22:07 — so every
frontend grep quoted above was re-taken at 05:29 against the current files. The
`pill()` counts (106 / 87 / 19) and the `deals.js:1654` finding are from that
re-take.

Re-run the currency check before trusting any figure above.

---

## Last check — 2026-09-03

Re-read through the read-only SQL channel between **18:35 and 18:55 UTC on
2026-09-03**. No writes were made; no migration was applied.

| object | state at last check |
|---|---|
| all 33 views in `public` | `security_invoker` present on every one — 0 exceptions |
| `nexus_guard_security_invoker_views` | present in `pg_event_trigger`, `ddl_command_end`, enabled |
| `purchase_history` | **1 row**, `lead_id = 38`, `tenant_id` set — INV-002 has fired |
| `kyc_documents` | **3 rows, 0 verified**; auditor `DEGRADED` at 0.0% |
| `finance_quotes` | 0 live rows; 25 inserts / 15 deletes lifetime |
| `communication_logs` | 108 rows; delegation identity holds on all 108; 0 padded |
| `audit_log` | 687 rows / 340 pairs; no class outside the vocabulary |
| `v_needs_attention` | 14 rows, 0 with a blank severity |
| `nexus_lead_for_comm_key` / `v_lead_messages` | **15 of 15** distinct `communication_logs.lead_email` keys agree (6 resolve, 9 NULL on both paths). 3 leads, 3 distinct 9-digit tails, **max 1 person per tail** — no collision exists to trigger the ambiguity guard |
| RLS policies in `public` | 120 total, **25 tenant-scoped** — the "every policy is `USING (true)`" claim in this file's own header was false and is corrected |
| `max(schema_migrations.version)` | `20260903180749`, **181 applied** |
| `architecture/schema.sql` | generated 05:01 on 2026-09-02 — **100 migrations behind. Do not run it.** |
| quality gate | PASS 26 · FAIL 2 (`L2`, `L9`) · WARN 2 · NOT RUN 4, exit 1 |

**What was NOT re-run on 2026-09-03, and must not be quoted as if it were:**
`health_parity.mjs` (the 634/634 agreement is a 2 September result), every
frontend grep and every `pill()` call-site count under INV-008, and the
`nexus_lead_is_open` 25-value parity comparison. Those are source-level
measurements over files this pass did not re-read. The database figures above
are current; the frontend figures are 2 September.
