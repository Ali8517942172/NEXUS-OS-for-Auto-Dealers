# The evidence standard

**Written 8 September 2026.** This file defines what a test result has to look
like before this repository is allowed to call it a PASS, and what a gate has to
have survived before anyone is allowed to trust it going green.

It invents nothing. Every rule below is already being followed somewhere in
`ops/evidence/`, `ops/journey-lab/`, `apps/executive-dashboard/QUALITY_GATE.mjs`
or `NEXUS_INVARIANTS.md`. What did not exist until now is one place that says
which of those practices are the standard and which were one author's habit, so
that a reader can tell a measurement from a recollection without reading
thirty-three documents first.

Two rules are held absolutely and everything else in this file is machinery for
holding them:

```
NOT RUN  ≠  PASS
UNKNOWN  ≠  ZERO
```

The first says that a check nobody executed is not evidence, no matter how
obviously it would have passed. The second says that a figure nobody could
compute is not the number nought — this codebase has rendered that particular
lie in at least six separate places, and each one read as a fact to whoever saw
it.

---

## 1. What this repository already does well

These are extracted from existing documents. Each row names a place it is
already being done properly, so the practice can be read rather than described.

| Practice | Already done in | Why it is the standard |
|---|---|---|
| Name the project ref and the date before the first result | `ops/evidence/idempotency-family-evidence.md`, `ops/evidence/engine-defects-2026-09-06.md` | A figure with no project and no date is not re-checkable, and this repository runs against two databases that are not identical |
| State the method before the result | `ops/evidence/engine-defects-2026-09-06.md` §head | The reader can judge the result only if they know what was and was not in the way |
| Probe inside a transaction ending in an unconditional `RAISE EXCEPTION`, and confirm the rollback by re-reading | `ops/evidence/two-tenant-defects-closed-2026-09-06.md`, `ops/journey-lab/RUNBOOK.md` | An adversarial probe on a live database that forgets to roll back is a defect the probe caused |
| Run a positive control beside every negative one | `CLAUDE.md` §"Proved on production, 7 September 2026" — six ingestion attacks refused, then the same body redacted still inserting | A refusal proves nothing until you have shown the guard is not simply refusing everything |
| Record refusals as assertions, with the SQLSTATE | `42501`, `23505`, `23514`, `23503`, `NX001` throughout `ops/evidence/` | "It was refused" is a sentence; `42501` is a fact about grants |
| Keep `0 rows` and `42501` apart | `ops/journey-lab/TEST-MATRIX.md` house rule 4 | Zero rows is evidence about RLS. `42501` is evidence about the grant. Conflating them has hidden two real leaks here |
| Pin a migration by version, name, and `md5(statements[1])` compared byte-for-byte with the repo file | `ops/evidence/workflow-registry-evidence.md`, `ops/evidence/idempotency-family-evidence.md` | The strongest evidence id in this project. It answers "is the thing I am reading the thing that ran" |
| Say what was **not** touched | "no `git` command was run", "the n8n box was not contacted", "`QUALITY_GATE.mjs` was read, never edited" | Scope is part of the result. Without it, an unrelated later breakage gets attributed to this pass |
| Record which role read the number | `ops/evidence/money-leaks-evidence.md` §reading caveat | A count taken through the privileged SQL channel is not what a signed-in dealership sees, and at two dealerships the two diverge |
| Keep the FAIL after the fix | T12 and T22 in `ops/journey-lab/TEST-MATRIX.md` | The FAIL is the evidence that the fix is load-bearing. Rewriting it as a clean PASS deletes the only proof the lock or the trigger is doing anything |
| Correct in place, dated, with the superseded sentence struck through rather than deleted | `CLAUDE.md` §"Corrections to what this file used to say" | The next reader needs to know the old claim existed, because it is quoted elsewhere |
| Print every NOT RUN by name, with its severity and its reason | `apps/executive-dashboard/QUALITY_GATE_REPORT.md`; `ops/evidence/B1-B4-evidence-2026-09-06.md` | *"A NOT RUN is not a PASS"* is already the gate's own first line. It is the sentence this whole standard is built around |

## 2. Where the same repository is inconsistent

Stated as plainly as the section above, because these are the gaps this standard
exists to close.

**Test IDs do not form one namespace.** `T01`–`T23` are Journey Lab journeys.
`L1`–`L13`, `B1`–`B4`, `S1`–`S10`, `R0`–`R7` are quality-gate checks. `F1`–`F5`
are two-tenant defects. `N10` is a node change in
`ops/whatsapp-lead-capture/SPEC.md`. "STAGE 1.6" and "STAGE 1.7" head two
evidence files. Nothing tells a reader where a given id is defined, and `B` means
two different things depending on which document you opened.

**Timestamp granularity varies from a bare month to the second.** "In August",
"5 September 2026", "2026-09-03T11:45:26.060Z" and "06:07:40 UTC" all appear as
the time of a measurement. Only the last two can be lined up against a log.

**Environment is prose, not a field.** Most documents name the project ref.
Fewer name the role. Several say "staging, then production" without saying which
of the two produced which number — and those two databases have diverged before.

**Verdict vocabulary is enforced only inside the Journey Lab and the gate.**
Everywhere else a pass is announced in prose: "closed", "held", "proved",
"verified", "measured". None of those can be counted, and three of them are used
for things that were reasoned rather than run.

**Evidence ids are rigorous for migrations and thin for everything else.**
Migration md5s are exemplary. n8n execution ids appear in four files.
`audit_log.id` appears in almost none, despite `audit_log` being the witness the
gate's `L9` is built on. Commit SHAs appear in transfer documents and essentially
never in a measurement.

**Almost nothing states when it expires**, and this repository has been bitten by
that four times: `LEAD-INGESTION.md` still opens by saying the lead-ingest layer
is on staging only, when all ten `leadingest_*` migrations are on production;
`CLAUDE.md` carried "nothing has carried a real lead" and "no HTTP endpoint
exists yet" past the day both became false; and the gate's embedded schema
snapshot went stale against its own migrations and turned two screens red for a
reason that was not the screens' fault.

**Line-number citations into prose files rot.** While this file was being
written, `CLAUDE.md` moved the heading *"What is actually proven"* from line 1143
to line 1236 because another session was editing it. A line number into a file
under active edit is not a citation.

---

## 3. The evidence record

Every important test produces one record with these eight fields. A record
missing any field is not evidence; it is a recollection.

```
Test ID · Input · Expected · Observed · Environment · Timestamp · Evidence IDs · PASS/FAIL
```

| Field | What makes it valid | What makes it invalid |
|---|---|---|
| **Test ID** | Namespace-qualified and defined in exactly one file — `JL/T12`, `GATE/L9`, `INV/lead-ingest/orphan`, `ES/A2`. The namespace prefix names the register that defines it | A bare letter-and-number that exists in two registers. An id minted in the result and defined nowhere |
| **Input** | The exact thing that was sent: the statement, the HTTP body and headers, the click path, the fixture file. Reproducible without asking the author what they meant | A description of a class of inputs ("a malformed key"). Prose where bytes decide the outcome — an HMAC over raw bytes is a different test from an HMAC over re-serialised JSON |
| **Expected** | Written **before** the run, and specific enough to be wrong: a row count, a phase, a SQLSTATE, a named refusal reason | Written after the observation, in terms the observation happens to satisfy. "Behaves correctly" |
| **Observed** | What actually came back, quoted, including the parts that were surprising. A count, a code, an error string, the returned id | A summary that has already interpreted the result. Anything the author did not personally see come back |
| **Environment** | Supabase project ref (`dsvuoovivysszdoiorch` production, `wwspuxrbiyagnrnzgate` staging), **the role the statement ran as**, and where the artefact came from — n8n workflow id and whether it was the published or the draft version, deployed bundle asset name and byte length, migration version | "Production" with no role. "The box". A workflow read from `n8n-workflows/*.json` in the repo, which is a 30 August export and is not what is running |
| **Timestamp** | ISO 8601 UTC to the second, of the run — not of the write-up | A date with no time where a log has to be lined up against it. The date the document was edited |
| **Evidence IDs** | See §4. At least one id that can be opened by a person who was not there | A sentence in place of an id. An id that resolves to nothing |
| **Verdict** | One word from §6 | Prose. Two words. A word from §6 used outside its test |

### What makes a record inadmissible

A record is inadmissible — it may not be counted, quoted or rolled up — if any
of these is true:

1. **It has no reproducible input.** Nobody can run it again.
2. **Its expectation was written after its observation.**
3. **It cites no evidence id, or an id that does not resolve.** Including any
   path under `/home/claude`, `/tmp`, or another session-local directory (§5).
4. **It was measured on one environment and stated about another.** A staging
   pass is not a production pass. A one-tenant measurement is not a multi-tenant
   result — `CLAUDE.md` §"Every production measurement in this repo is a
   measurement of one tenant" governs this, and a check that could only run at
   one tenant is NOT RUN for the multi-tenant case.
5. **It was read through a role the user does not have.** A count taken as
   `service_role` or through the privileged SQL channel is not a statement about
   what a dealership sees. Where that is the only reading available, the record
   says so in the Environment field and the verdict is NOT RUN for the user-facing
   claim.
6. **It infers a step it did not observe.** "It must have passed through
   HYDRATED" is unobservable unless a phase history exists, and unobservable is
   recorded as unobservable.
7. **Its subject has changed since it was measured** (§6, expiry).

---

## 4. Evidence IDs

An Evidence ID is an identifier that a person who was not present can open later
and see the same thing. That is the whole test. In this system they are:

| Class | Shape | How it is opened later | Invalid when |
|---|---|---|---|
| n8n execution id | integer, e.g. `11103` | n8n API / UI on `35.224.126.225`, execution detail with node run data | The workflow has `saveDataSuccessExecution: "none"` — then the execution was never retained and the id is a promise, not a record. Check before citing |
| n8n workflow id + version | `J8MXprxVw1yhjBpp`, `EYva4c2bMV5MGq0o`, `JDqy54w2HUH7pHgW` | Fetch the **published** definition back from the box | Cited from `n8n-workflows/*.json` in the repo, which is a 30 August export. The box is the witness |
| `lead_event.event_id` | uuid | `select * from public.lead_event where event_id = …` | The row was written in a transaction that rolled back. Say so; a rolled-back id is evidence of the run, not of a row |
| `leads.id` | integer, e.g. `121`, `122` | `select * from public.leads where id = …` | Cited without saying whether the row is a customer, a preflight or a fixture |
| `audit_log.id` | integer | `select * from public.audit_log where id = …` | Cited as proof of an external effect. An audit row proves the workflow reached that node, never that a message arrived (see Slack, §6 expiry) |
| Migration | `version` + `name` + `md5(statements[1])` from `supabase_migrations.schema_migrations`, compared byte-for-byte with `supabase/migrations/<version>_<name>.sql` | The query above, on the project named | Only the file is cited. A file in the repo is not proof the database ran it — twelve migrations on production were applied through `execute_sql` and are not stamped |
| Commit SHA | 40 hex, or an unambiguous 7+ prefix | `git show <sha>` | The commit exists only in a container or an unpushed clone. Say which remote holds it |
| Deployed artefact | Vercel project + asset path + byte length, e.g. `nexus-os-dashboard-six.vercel.app`, `/assets/main-BFmkO_-a.js`, 1,499,871 bytes | Fetch the asset and re-measure | A branch name in place of a build. `origin/main` in a stale clone is not what production serves |
| SQLSTATE / refusal code | `42501`, `23505`, `23514`, `23503`, `NX001`, or a named reason like `PROVENANCE_WEAKER_THAN_ENDPOINT_DECLARES` | Re-run the statement | Replaced by the word "refused" |
| Source location | `path:line` for code, e.g. `apps/executive-dashboard/screens/actions.js:637` | Open the file at that commit | A line number into a prose file under active edit. Cite the heading and a quoted phrase instead |
| Prose location | `FILE.md` §"exact heading" | Search for the heading | A line number. `CLAUDE.md` moved a heading 93 lines during the writing of this file |

**Every record carries at least one id from a class that survives the session
that produced it.** A screenshot is not one. A quoted number is not one. If the
only thing a run produced was a number in a terminal, the record says that, and
the verdict is what it is rather than what the number suggested.

---

## 5. Where evidence lives

**Evidence for a claim in a tracked file must itself be tracked.**

This rule was bought rather than reasoned. On 8 September 2026 eight tracked
documents — `CLAUDE.md`, `CONTROL-PLANE.md`, `README.md`, `OWNER-ACTIONS.md`,
`V1-RELEASE-CLOSURE.md`, `ops/DEMO.md` and both `STATUS-*.md` — cited **ten**
evidence files by absolute path under `/home/claude/out/`, an ephemeral container
reclaimed after a period of inactivity. **None of the ten was tracked.** The
repository would have gone on asserting *"proved adversarially, evidence in
`/home/claude/out/unattributed-default-evidence.md`"* while the named file
existed nowhere on Earth. Nothing had been lost yet; 33 documents, 676 KB, were
moved into `ops/evidence/` and every citation rewritten.

What follows from it:

1. **A path under `/home/claude`, `/tmp`, `/mnt`, a scratchpad, or any other
   session-local directory is not a citation.** It is a promise that expires when
   the container does. A record citing one is inadmissible (§3.3).
2. **If a measurement is worth citing, it is worth committing.** The cost of
   committing a 20 KB markdown file is nothing against the cost of a claim whose
   proof evaporated.
3. **Evidence goes in `ops/evidence/`** and is named for what it measured and the
   day it was measured. A change that was written and deliberately not applied is
   named `*-NOT-DEPLOYED.md` and states its preconditions.
4. **Three things are deliberately not committed**, and the reason is not
   convenience: catalogue dumps (regenerable in one statement, and a stale
   committed catalogue is worse than none, because the gate's entire staleness
   discipline exists to stop exactly that being trusted); gate reports (the output
   of a run — CI uploads its own); and transfer patches. `ops/evidence/README.md`
   holds the full reasoning.
5. **A historical statement about a path that existed at a moment is not a
   citation and must not be rewritten into one.** Two sentences in the repository
   still name `/home/claude/out/nexus-M0-M1-2026-09-06.patch`. That is a
   measurement of a moment, correctly left alone; inventing a repository path it
   never had would have been the fabrication rather than the fix.

---

## 6. Vocabulary, with a test for each

Seven words. Each has one meaning and one test. A verdict that does not pass its
own test is the wrong verdict, not a close-enough one.

### PASS
The check ran to completion in the stated environment and every assertion was
read and held.

*Test:* can you name the input, the expectation written beforehand, the observed
value, and an evidence id that resolves? If any of the four is missing, it is not
a PASS.

*May not be used for:* a check that was skipped because it obviously would have
passed; a check that passed somewhere else; a check whose assertions ran but were
not read.

### FAIL
The check ran and an assertion did not hold.

*Test:* the observed value is recorded and it differs from the expected value.

*A FAIL that has since been fixed stays a FAIL in its own record*, with the fix
recorded beside it. T12 and T22 are kept as FAILs for exactly this reason: the
failure is the evidence that the trigger and the lock are load-bearing rather
than decorative. Rewriting them as clean passes would delete the only proof the
fixes do anything.

*A refusal is not a FAIL.* An expected refusal, recorded with its named reason
and with the rows the happy path would have written shown absent, is a PASS.

### BLOCKED
The check could not run because a **named** capability, credential or artefact
does not exist.

*Test:* can you name the missing thing in one line, and say what would unblock
it? "Needs `META_APP_SECRET` on the VM, a Facebook Page and a lead form" is
BLOCKED. "Didn't get to it" is NOT RUN.

*May not be used for:* a check that could have run and was not prioritised.

### DEGRADED
The capability runs, in the stated environment, and does not meet the standard it
claims — measurably.

*Test:* you can state both halves as numbers. "The AI reply path works and
`v_workflow_health` rates it 42.4% over 290 runs" is DEGRADED. "It's a bit
flaky" is not a verdict.

*May not be used to soften a FAIL.* If an assertion did not hold, it is a FAIL.
DEGRADED is for a capability that meets its contract sometimes and the rate is
measured.

### NOT RUN
The check did not execute, or executed without its assertions being read.

*Test:* there is no observed value. That is the whole test.

**This is the default.** A cell with no evidence is NOT RUN, always, and it is
never upgraded by inference, by the obviousness of the code, by a previous run of
a similar check, or by a green run of the suite it sits in. `QUALITY_GATE.mjs`
prints its NOT RUN checks by name with severity, lane and reason, and exits 2
rather than 0 when a launch-critical one could not run; that behaviour is the
standard, not a courtesy.

### NOT RUNNABLE
The check cannot be run at all in this system as it stands, and no credential or
scheduling would change that.

*Test:* can you state the structural reason, and is it a property of the world
rather than of our backlog? `marketplace_dubizzle` is NOT RUNNABLE above L2:
Dubizzle Motors publishes no leads-out API, and a production Dubizzle endpoint
cannot exist as a row because a CHECK refuses it. Cross-tenant refusal on
production is NOT RUNNABLE: production holds one active dealership and activating
a second silences five backend consumers.

*May not be used for:* something that needs a secret, an account or an afternoon.
That is BLOCKED.

### SUPERSEDED
The record was valid when it was taken and its subject has since changed.

*Test:* can you name what changed, and when? Bitrix24 is the worked example — it
really did work, writing SUCCESS rows naming real returned CRM ids on 16, 17 and
19 August 2026, and **nothing has succeeded since 19 August**. The August record
is not false. It is superseded, and quoting it today as "the CRM leg works" is
the error.

*A SUPERSEDED record is not deleted.* It is marked, dated, and the thing that
superseded it is named beside it.

### When a PASS expires

A measurement is evidence about the system that was measured. It stops being
evidence about the system today the moment that system changes underneath it. A
PASS expires when any of these happens, and expiry is automatic — nobody has to
notice:

| Trigger | Why |
|---|---|
| A migration lands that touches an object the check reads or writes | The gate's own embedded snapshot went stale exactly this way and turned R2/R3 red for a reason that was not the screens' fault |
| The workflow is republished, or its credential changes | The published definition is the witness; a draft is not |
| The deployed bundle hash changes | A render-lane pass is about a build |
| The number of active dealerships changes | Five backend consumers of `nexus_scoped_tenant_id()` go from answering to returning zero rows at two dealerships. Every one-tenant PASS is silent about that |
| An environment variable the path reads is set or unset | `WAHA_WEBHOOK_SECRET` unset makes the auth gate pass everything through; `META_APP_SECRET` unset makes two receivers refuse everything |
| 30 days pass with no re-measurement, for anything asserted about an external system | Meta, Google, Bitrix and Dubizzle change without telling us |

**Any figure older than its expiry is quoted with its date attached or not
quoted.** Where two figures for the same thing exist, both are kept and the newer
one is marked, so the movement is auditable rather than overwritten —
`NEXUS_INVARIANTS.md` already does this and it is right.

---

## 7. A gate is trustworthy only if it has been made to go red on purpose

**A gate that cannot fail is decoration.** This project has found two of them,
and neither was found by reading the code.

**Case 1 — the filter that exempted the thing it claimed to test.** For a day
this repository stated that `workflow_registry` was *"deliberately NOT exempt"*
from quality-gate check `L2` and *"left failing on purpose"*. Measured against
the gate itself, its exemption filter was the substring regex
`/reason_codes|workflow_registry/` — so `workflow_registry` **was being silently
exempted and was not among the failures at all**. The claim was true of the
intent and false of the artefact. Recorded in `CLAUDE.md` §"The gate had been
exempting workflow_registry all along".

**Case 2 — the branch that counted NULLs in NOT NULL columns.** The tenth branch
of `nexus_tenancy_readiness()` was an INFO counting `tenant_id IS NULL` on
`leads`, `communication_logs`, `audit_log`, `inventory` and `whatsapp_contacts`.
All five are `NOT NULL` on both projects. The branch could never report anything,
and it read like coverage. It has been replaced with one that counts the two
tables which genuinely can hold a NULL and calls those rows what they are:
platform scope, not orphans. Recorded in `CLAUDE.md` §"The tenth could never fire
and has been replaced".

Two related shapes are worth naming because they are the same mistake one step
along: `L3` asked whether `reloptions` *contained the string* `security_invoker`,
so a view created `(security_invoker = false)` passed the check that exists to
forbid it; and `L2` read `relacl`, which cannot see column-level grants, so a
table with seven `authenticated=r` columns read as `service_role`-only. A check
that confirms a mechanism is **present** is not a check that it **works**.

### The procedure

Before a gate, invariant function, CI job or check may be cited as evidence:

1. **Enumerate every branch it can report** — from its source, not from its
   output on today's data. A branch that has never fired on live data is exactly
   the one at risk.
2. **For each branch, write the counterfactual that should make it fire.**
3. **Fire each one deliberately, each in its own transaction, each rolled back**
   — a `DO $$ … $$` block ending in an unconditional `RAISE EXCEPTION`, so
   nothing persists even if the probe misbehaves. Where the branch is guarded by
   a constraint, drop the constraint **by name** inside that transaction, fire the
   branch, and confirm the constraint is back afterwards.
4. **Record which branches fired and which could not be made to.** A branch that
   cannot be made to fire is the finding. It is deleted or rewritten; it is not
   left in for the look of it.
5. **Re-read the state afterwards** to confirm nothing persisted. A probe leaving
   a planted violation behind poisons every later run.
6. **Record the whole thing as an evidence record per §3**, with the branch list
   as the Test IDs.

### What the record must say

For each branch: what fired it, whether it fired, and whether the state it tests
for is reachable at all. Those are three different results. Two sabotages on
production on 7 September 2026 illustrate the difference: dropping
`lead_ingest_endpoint_production_needs_real_provenance` and
`..._production_matches_source` and then registering the row they exist to refuse
took `nexus_lead_ingest_invariants()` to **1 FAIL**, correctly; whereas a direct
`UPDATE lead_event SET origin_verified='simulated'` as `service_role` was
**refused `23503`** by the foreign key, so the gate stayed at 0 FAIL — also
correctly, because the state is unreachable. "Did not fire because unreachable"
is a PASS for the gate and must be written as that rather than as a gap.

### The strongest red is the one a real defect produced

`nexus_lead_ingest_invariants()` gained an eighth check — *every lead carrying an
ingestion source is pointed at by the event that made it* — and it went **FAIL,
`2 orphan lead(s): 41, 43`** on wreckage a genuine five-backend race had just
made, then **PASS, `0 orphan lead(s)`** after teardown. A gate made red by the
defect itself, rather than by a planted sabotage, is the stronger proof and is
usually the cheaper one. Prefer it where a real failure is available.

---

## 8. The two rules, restated

**NOT RUN ≠ PASS.** A cell you cannot evidence is NOT RUN. It is never upgraded
by inference, by the obviousness of the code, by a green neighbour, or by the
fact that shipping is inconvenient today. A suite that reports "49 tests pass"
and does not report how many did not run is reporting half a result.

**UNKNOWN ≠ ZERO.** A figure that could not be computed is rendered as
`NOT_COMPUTABLE`, `UNKNOWN` or `NO WITNESS EXISTS` — never as `0`, never as an
empty state that reads like an answer, and never as "AED 0". A screen showing `0`
where it means "no witness exists" fails this standard even if the code is
correct.

The companion file `STATUS-LADDER.md` applies these rules to every capability in
the product, and is the answer to "what actually works".
