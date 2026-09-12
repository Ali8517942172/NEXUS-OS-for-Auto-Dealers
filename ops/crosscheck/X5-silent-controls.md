# The silent-controls inventory, and why the thesis needs narrowing

**12 September 2026. Cross-check X5.** Production `dsvuoovivysszdoiorch`, read
only — every query below was run as a plain `SELECT` and nothing was written.
No n8n API call was made; every n8n statement is read from workflow JSON in this
repository and is marked as such. Repo state: branch
`wip/gate-L9-2026-09-03-continued`.

## The thesis I was given, and what I found instead

The orchestrator's thesis, after three findings in one week, was: *this system's
controls report nothing when they do nothing.* X1 found a DDL guard wrapping
every branch in `exception when others then null`; `ops/f2-tenant-rule/` found a
filter whose accepted set (`{exact,strong}`) cannot match any value the producer
writes (`exact_year | model_only | weak`); `ops/message-durability/GAP-MEASURED.md`
found five of six WhatsApp send sites recording "we said this" whether or not the
send succeeded.

I tested it across all four layers and it does not survive in that form. **The
deciding layer of this system is, with measured exceptions, fail-closed and
deliberately so. The recording layer is best-effort almost everywhere.** That is
a narrower thesis, it explains all three anchor findings better than the broad
one does, and it is the version that should go on the record.

The strongest evidence against the broad thesis is in the same pattern the thesis
condemns. Ten n8n nodes named `Verify JWT` carry `onError: continueRegularOutput`
— which reads, at a glance, exactly like auth failing open. It does not. All ten
route into a downstream `Auth Gate` / `Auth OK?` that requires a non-empty
`$json.id`, and seven of them carry a comment naming the `continueRegularOutput`
and explaining that a rejected token therefore *arrives as data* and must be
rejected here (`n8n-workflows/kyc_aml_document_auditor_re_upload_loop_phase_5.json`,
node `Auth Gate`; `..._master_lead_router...`, same node; `wf_108_erp_sync...`,
same). The three that route into a business Code node instead —
`7_day_warm_lead_drip_campaign.json` / `Normalize Lead Input`,
`finance_calc_auto_loan_equity_credit_score.json` / `Calculate Equity & Tier`,
`sync_closed_won_deals_to_supabase_pgvector.json` / `Format Deal Text` — each
throw or return `status:'error'` on `!auth.id` inside that node. Ten for ten,
fail-closed, with the reasoning written down.

The same holds where I most expected to find rot. `v_inventory_profit_sentinel`
does not coalesce a missing acquisition cost into a margin:
`supabase/sentinel/sentinel_03_engine_view.sql:103` is
`case when i.price_aed is null or i.cost_aed is null then null ... end as gross`,
and `:257` turns that null into `net_margin_state = 'NOT_COMPUTABLE'` with the
note *"Gross is shown; net is withheld rather than guessed."* The WhatsApp
human-handover check, which is the one control standing between an AI and a rep
mid-negotiation, states its fail direction in its own source
(`whatsapp_bdc_ai_agent.json`, node `Human Spoke Recently?`): *"If the lookup
could not be done ... we do NOT know whether a rep is mid-negotiation. That
degrades to 'supervised', not to 'normal'. Zero rows is a real answer, not an
error."* And the dashboard has already had this fight and won it:
`apps/executive-dashboard/lib/states.js` and `lib/errors.js` exist precisely to
keep a failed read from rendering as an empty one, and
`lib/lead-drawer.js:291` records the removal of `.catch(() => [])` because *"a
dead `purchase_history` fetch ... meant a repeat buyer silently became a
first-timer."*

So the class is real, but it is not "controls". It is **records**. Every
confirmed instance below is a place where the system *decided correctly and then
failed to write down that it had decided, or wrote down something it had not
verified, or deleted the writing on a timer.*

## Inventory

Ranked most severe first. "Blast radius" is what a dealership — ALBA today, a
tenant #2 tomorrow — would wrongly believe.

| # | Control | Location | What it silently allows | Blast radius | Severity |
|---|---|---|---|---|---|
| 1 | Nightly prune of the message-receipt table | `n8n-workflows/nexus_retention_purge.json`, node `Prune Dedupe Guard` — `onError: continueRegularOutput`, and it is **absent from the workflow's `connections` map**, i.e. it has no outgoing edge at all | Deletes `processed_messages` older than 7 days and emits nothing downstream on success *or* failure. The `Log Purge to Audit` node is on the parallel KYC branch and is never reached by this one | The only durable proof a WhatsApp message was *seen* has a 7-day TTL and no audit trail. Measured today: `processed_messages` = 86 rows, `min(processed_at) = 2026-09-05 10:25:39+00`, `max = 2026-09-12 16:08:42+00`; `audit_log` = 1018 rows across 25 distinct `workflow` values, **none** matching purge/retention. The P0 in `GAP-MEASURED.md` has already gone green by deletion — its last named affected claim (`184984711217354@lid`, `2026-09-04 06:21:37`) is below the current floor. A dealership reads "every inbound message accounted for" from evidence that expired | **CRITICAL** |
| 2 | `nexus_guard_born_open_grants()` — the born-open-grants DDL gate | `supabase/migrations/20260904112959_close_born_open_grants_default_acl_and_supabase_admin_guard.sql:171,187,192`; re-asserted at `20260904142709_...:52,69,73` | Each branch and the function itself end in `exception when others then null`. A `REVOKE` that fails leaves the grant in place and the migration reports success. Confirmed by census: of the 50 `public` functions whose source mentions `exception`, only **4** catch `when others`, and this is one of **2** that return without re-raising | Every table created after this guard is trusted to be closed to `anon` because the guard exists. If it ever fails, nothing anywhere says so — not the migration, not `audit_log`, not a table. This is X1, re-confirmed from the live catalog rather than from X1's text | **CRITICAL** |
| 3 | `nexus_mark_first_response()` — the single authoritative writer of lead response time | `supabase/migrations/20260901042506_response_time_single_authoritative_writer.sql:156` — `exception when others then raise warning ... ; return new;` | On any failure the `UPDATE` is abandoned, `leads.response_time_minutes` stays NULL, the trigger returns NEW so the insert succeeds, and the only trace is a Postgres `WARNING` that no screen, view or invariant reads | Production: `leads` = 6 rows, 4 with a response time, 2 NULL, `avg = 13.0` min. **A lead nobody has answered yet and a lead whose stamp was swallowed are the same NULL**, and the dealership's headline SLA is averaged over the rows where the writer worked. I cannot tell you which of the two those 2 NULLs are, and neither can the database — that indistinguishability *is* the defect, and it biases the number in the flattering direction | **HIGH** |
| 4 | 33 best-effort recording writes across 17 of 24 n8n workflows | Census of all 24 files: **98 nodes** carry `onError: continueRegularOutput` (96) or `continueOnFail` (2). By role: 33 are audit/log/record writes, 12 are customer- or staff-facing sends, 11 are state-changing writes, 10 are `Verify JWT` (fail-closed, see above), 32 are reads/AI/plumbing | The write that records what happened is itself the thing allowed to fail. Named examples: `Audit Log` in 14 workflows; `Log Conversation`, `Log Incoming Message`, `Log Outbound`; `Record KYC (Approved)`, `Record KYC (Rejected)`, `Record Non-Document`; `Log Quote`; `Log Competitor Intel` | This is the generalisation of `GAP-MEASURED.md`'s six send sites. A KYC decision can be taken and not recorded; a finance quote can be issued and not recorded; a conversation can happen with no row. Every downstream count — compliance coverage, quote volume, message durability — is a floor presented as a total | **HIGH** |
| 5 | `Claim Message Id` — the WhatsApp idempotency claim | `n8n-workflows/whatsapp_bdc_ai_agent.json`, node `Claim Message Id` (POST `processed_messages`, `onError: continueRegularOutput`, `alwaysOutputData: true`, **no retry**) feeding `Is New Message?`, whose OR-combinator matches `!!$json.message_id` **or** `!!$json.error` | A failed claim is explicitly treated as "new" and the bot replies. The fail-open direction is defensible — a duplicate reply beats silence — but nothing records that the claim failed, and no `processed_messages` row is written, so the resulting duplicate send is invisible to the durability invariant as well | A customer receives the same AI reply twice and the system's own record shows one inbound message handled once. The choice is sound; the silence about it is not | **MEDIUM-HIGH** |
| 6 | `Find Archive Gaps` → `Slack: Archive Gap Alert` — the detector for KYC files with no archive | `n8n-workflows/nexus_retention_purge.json`, both nodes `onError: continueRegularOutput`; the Slack node is terminal | If the gap query fails, `continueRegularOutput` hands an error item to the `Any Gaps?` Code node, which finds no gaps and raises no alert. If Slack fails, no alert and no row. Either way the nightly run reports success | The control that would catch a KYC document deleted from Storage without a database record is the control most likely to fail quietly, and it runs on the same schedule as the deletion it is meant to police | **MEDIUM** |
| 7 | `COALESCE(cost_aed, 0)` in the sentinel's capital-tied prose | `supabase/sentinel/sentinel_03_engine_view.sql:238` (and `:386`), surfacing through `v_inventory_profit_sentinel` | The *computation* correctly refuses (row 3 of the counter-examples above), but the sentence a manager reads renders a missing acquisition cost as `AED 0 of capital tied up for N days` | Latent on ALBA — all 12 inventory rows have `cost_aed` today (`count(*) = 12`, `count(cost_aed) = 12`). Live the day a tenant imports stock without cost: every such unit reads as free to hold, which is the exact opposite of the aging-cost argument the screen exists to make | **MEDIUM** |
| 8 | `daily_metrics` snapshot read on the overview strip | `apps/executive-dashboard/screens/overview.js:978` — `db('daily_metrics?...&limit=1').catch(() => [])` | A failed snapshot read and a snapshot holding a NULL figure both reach `delta()` as `undefined` and both render as "no comparison available" | Narrower than it looks — the consequence is a *missing* delta, not a wrong number, and this screen is otherwise the most careful in the app (`sentinelErr` two lines below exists solely to separate "the engine says nothing to do" from "the engine did not answer"). Still the one place on this screen where a dead query is indistinguishable from a quiet day | **LOW-MEDIUM** |
| 9 | `secret-scan.mjs` skips files it cannot read, uncounted | `ops/ci/secret-scan.mjs:104` (`statSync` → `continue`) and `:108` (`readFileSync` → `continue`) | Both drop the file from the scan *and* from the `scanned` counter, while `skippedBig` and `skippedBinary` are counted and printed. The gate then prints `RAN N tracked text file(s) scanned` as though N were the tree | The job's own header at `:29` states the opposite principle — *"Unreadable is a failure and not a pass on purpose: a token this job cannot classify is a token nobody has classified."* That rule is enforced for unreadable JWT payloads and abandoned for unreadable files. Low blast radius in practice (an unreadable tracked file is rare); listed because a gate that contradicts its own stated principle is the purest form of this class | **LOW** |
| 10 | `nexus_jwt_tenant_id()` — silent NULL on an unparseable JWT | `supabase/migrations/20260902084409_nexus_mt_01_tenant_core.sql:54,59` — `exception when others then return null` twice | A malformed claim set yields NULL rather than an error | **Checked and fail-closed.** RLS predicates comparing against NULL yield NULL, which denies. Confirmed no column anywhere takes it as a default: `information_schema.columns where column_default ilike '%nexus_jwt_tenant_id%'` returns **zero rows**, so no row can be born with a NULL tenant from this path. Listed to close the question, not as a finding | **NONE** |

Two further `when others` handlers exist on production and neither is a finding.
`nexus_claim_pending_membership` downgrades to `raise warning` on purpose and says
why — *"A failure here must never stop an account being created. The invitation
is left open and stays visible on the Team screen"* — which is the rule this
document is about to state, already applied: the failure leaves a *visible,
actionable artifact* in the product. That is the difference between it and row 3,
which leaves a NULL. The 18 `when others` hits in `supabase/migrations/**` include
superseded definitions; the live catalog census (4 functions, 2 silent) is the
authoritative count.

## Verdict on the thesis

**A real class, but the orchestrator's framing over-reaches, and it over-reaches
in a way that would send the next fix to the wrong layer.**

"This system's controls report nothing when they do nothing" predicts that the
auth gates, the pricing engine, the human-handover guard and the dashboard error
states would all be rotten. I checked all four and they are not. They are, in
several places, better than the rule I was asked to write — `sentinel_03`'s
`NOT_COMPUTABLE`, `lib/errors.js`'s four-way classification, and the handover
node's explicit FAIL DIRECTION comment are three independent implementations of
"operationalize uncertainty" that already exist in this repo.

What is true, and true nearly everywhere, is one layer down. **Every decision in
NEXUS is followed by a write that records it, and that write is almost always
best-effort.** 33 of 98 continue-on-error n8n nodes are logging writes; the two
silent Postgres handlers are both in guards whose *output* is a report; the
retention purge deletes the record layer on a schedule with no record of the
deletion. All three anchor findings are instances of this and not of the broader
claim: X1 is a guard whose report is swallowed, F2 is an emptiness with no label
distinguishing "no matches" from "no possible matches", GAP-MEASURED is a receipt
deleted on a timer. Three instances of *records*, presented as three instances of
*controls*.

The practical consequence of the correction: hardening the decision paths would
find almost nothing, because that work has largely been done. Hardening the
record paths is where the entire remaining exposure sits — and it is also where
the cheapest fixes are, because a record path failing does not need to fail the
transaction, it only needs to leave a row.

## The design rule

**Every control in NEXUS must emit a durable, queryable row on all three of its
outcomes — fired, refused, and *could not tell* — and no consumer may read the
absence of a row as any one of them.** Concretely, for the next migration: a
function that catches an exception may not `return null` and may not stop at
`raise warning`; it must write the SQLSTATE, the statement and the object into a
first-class failures table inside the same transaction it is protecting, and if
the protected thing has a state column, that column gets a third value —
`NOT_COMPUTED`, not `NULL`, never `0` — so that "we could not work it out" is a
value a query can find rather than a gap a query steps over. For the next n8n
node: `onError: continueRegularOutput` is permitted only when the next node
inspects `$json.error` explicitly and branches on it — which is exactly what the
ten `Verify JWT` chains already do and what `Prune Dedupe Guard`, with no next
node at all, cannot — and any node whose job is to *record* something must be
`stopWorkflow` or must have a paired failure-recording node downstream, because a
best-effort write of a fact is the same as not knowing the fact. And no retention
job may delete the evidence an invariant reads without writing, in the same run,
a durable summary of what it deleted: an invariant that goes green because its
counter-evidence expired is worse than one that stays red. This is the owner's
own principle applied without exception — **NEXUS should never hide uncertainty.
It should operationalize uncertainty** — and the test for any new control is a
single question: *if this fails at 3am, what row can I SELECT tomorrow morning
that tells me so?* If the answer is "none", the control is decoration.

## The cheapest three fixes

**1. Give `Prune Dedupe Guard` an outgoing edge and a stop-on-error.**
`n8n-workflows/nexus_retention_purge.json`. Set the node's `onError` to
`stopWorkflow`, add `Prefer: return=representation` to the DELETE so PostgREST
returns the deleted rows, and connect it to a small Code node that POSTs one
`audit_log` row (`workflow: 'Retention Purge'`, `status`, `summary: 'pruned N
processed_messages older than <cutoff>'`). Two nodes, one edge, no schema change.
*What it would have caught this week:* that 1018 audit rows across 25 workflow
names contain **zero** record of seven consecutive nights of deletion — which is
the reason `GAP-MEASURED.md`'s P0 is about to read PASS with nothing repaired,
and which took a `count(*)` against a `string_agg(distinct workflow)` to notice
at all.

**2. Make a swallowed response-time stamp a value, not a gap.**
`supabase/migrations/20260901042506_response_time_single_authoritative_writer.sql:156`.
Replace `raise warning` with an `insert into public.nexus_control_failures
(control, object_ref, sqlstate, detail)` — a four-column append-only table — and
add `leads.response_time_state text` set to `'NOT_COMPUTED'` in the same handler.
One small table, one column, one changed handler.
*What it would have caught this week:* whether ALBA's advertised
`avg(response_time_minutes) = 13.0` is an SLA or a survivorship artifact. Right
now that question cannot be answered from the database at all — 2 of 6 leads are
NULL and nothing on production distinguishes "not answered yet" from "the writer
threw".

**3. Make the born-open-grants guard leave a trace.**
`supabase/migrations/20260904112959_...:171,187,192`. In an event trigger the
handler cannot re-raise without aborting the migration, so it should not try:
replace each `exception when others then null` with an insert into the same
`nexus_control_failures` table recording the object, the attempted REVOKE and
SQLERRM, then continue. No behaviour change to any migration that succeeds.
*What it would have caught this week:* X1 itself. The finding required reading
`pg_get_functiondef` line by line and reasoning about what a failure *would* do;
with this change it would instead be a `SELECT * FROM nexus_control_failures`
returning either rows — in which case there are open grants on production right
now — or none, which is the first evidence anyone has that the guard has actually
been working rather than merely present.
