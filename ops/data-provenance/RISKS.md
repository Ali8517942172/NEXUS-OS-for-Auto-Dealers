# What this contract cannot do, and where it can be defeated

Written against the design in `CONTRACT.md`. Nothing here is speculative
hardening advice; each item is a way the contract fails while continuing to
report success, which is the only failure mode worth writing down.

---

## 1. `service_role` is not restrained by grants, and every writer is `service_role`

Measured (`MEASUREMENTS.md` §6): on every scoped table `service_role` holds
`DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`, and
`nexus_guard_born_open_grants` never touches it. Every n8n workflow, every
backend writer and every migration runs as `service_role` or `postgres`.

So the grant mechanism of `CONTRACT.md` §4 restrains the **dashboard** and
nothing else. The only thing standing between a `service_role` writer and
`data_origin = 'REAL_ATTESTED'` is the `BEFORE` trigger, and:

- `alter table … disable trigger` is available to the table owner, fires the ACL
  guard, and leaves the column wide open with no diff a reviewer would notice;
- a trigger created `BEFORE INSERT OR UPDATE OF data_origin, test_run_id` does
  not fire on an `UPDATE` that names neither column — correct here, but one
  careless edit to the column list turns it off silently;
- `truncate` bypasses row triggers entirely, and `service_role` has it.

**This is the single largest hole and it is not closable from inside Postgres
alone.** The mitigation is detection, not prevention: invariant I5 in
`CONTRACT.md` §5.3 must also assert that the trigger exists and is enabled
(`pg_trigger.tgenabled = 'O'`), and that assertion must run in CI on a schedule
rather than only at migration time. A disabled trigger is a finding.

## 2. The contract cannot distinguish REAL from CORRECT

`REAL_ATTESTED` means a named owner or admin said this row is the dealership's
business. It says nothing about whether `amount_aed` is right, whether the date
is right, or whether the sale happened. A dealer who attests a batch without
reading it produces rows that are provenance-clean and factually wrong, and every
downstream tile will present them with more confidence than it presents an
UNKNOWN row that happens to be accurate.

`implemented ≠ tested ≠ production-proven ≠ commercially validated` has a fifth
term this contract does not touch: **attested ≠ accurate.**

## 3. Attestation is only as good as the attester, and there is exactly one

Measured: `tenant_members` holds **1** row on production, and `users` holds 1.
ALBA has a single member. So "requires `owner` or `admin`" is, today, "requires
that one person", and a role check against a one-row table is closer to
ceremony than to control. It becomes a real control at the third member, and not
before.

Nothing prevents that person from attesting everything at once. The
`data_provenance_attestation` ledger records that they did — which is the actual
deliverable, since a bulk attestation with the evidence string
`"looked fine"` is visible, and an unrecorded one is not.

## 4. Derived and pre-aggregated numbers are ungradeable

`daily_metrics` holds **21** rows on production carrying `pipeline_aed` and
`holding_cost_aed` — snapshots already summed over rows whose provenance nobody
recorded. A `data_origin` column on that table would be a fabrication in either
direction: `UNKNOWN` understates snapshots that were mostly real, `REAL` asserts
something never established.

Those 21 rows are permanently ungradeable. The only honest treatment is to leave
them alone, exclude them from any provenance-filtered figure, and stamp *future*
snapshots with the provenance mix they were computed from — three counts, not a
grade. `CONTRACT.md` §3 scopes `daily_metrics` out for this reason rather than
pretending.

The same applies to every view: `v_inventory_profit_sentinel` joins six tables,
and a row of it is only as real as its weakest input. **No view computes that
today, and this contract does not add it.** A view that filtered `leads` on
`data_origin` while joining `inventory` unfiltered would report a real customer's
interest in a fixture vehicle and look entirely clean doing it. Getting that
right is a second piece of work, per view, and pretending the column alone
delivers it is the most likely way this contract gets oversold.

## 5. The foreign key does not reach JavaScript

This is the residual `match_quality` hole and it should be named plainly.

Inside Postgres the vocabulary is single-sourced and a bad value fails with
23503. Outside it, `apps/executive-dashboard/screens/` is 24 files that can
freely write `if (row.data_origin === 'REAL')` — a string the database will
never emit — and get a permanently empty panel that reads as *"this dealership
has no attested data."* Exactly the sentence `ops/f2-tenant-rule/RECONCILIATION.md`
was written about.

`CONTRACT.md` §5.4 answers it with a rule (screens read `counts_as_real` /
`is_test` off a joined view, never an origin literal) and a CI grep. **A rule and
a grep are weaker than a foreign key**, and the honest statement is that the
JavaScript end of this contract is enforced by convention. The strongest
available hardening is the one already specified: invariant I2 fails loudly when
an accepted set does not intersect the written set — but I2 can only see sets
that live in the database, so a literal hardcoded in a screen is invisible to it.

## 6. `data_origin` and the existing lead-ingest provenance can disagree

Two provenance systems now exist and they answer different questions
(`CONTRACT.md` §1). `lead_event.provenance_counts_as_real` and
`v_lead_origin.is_test_traffic` answer "which endpoint, authenticated how";
`leads.data_origin` answers "is this dealership business".

They will disagree, and the disagreement is not always an error. Lead 121 today:
`provenance_counts_as_real = true`, `is_test_traffic = false`, and under this
contract `data_origin = 'TEST_FIXTURE'`. Both are correct answers to their own
question. A reader who does not know there are two questions will treat one as a
bug and "fix" it — most likely by flipping `operator_recorded.counts_as_real`
back to `false`, which would break walk-in leads, a genuinely real source.

Mitigation: the column comments in `held/` say which question each answers, and
no view exposes both under similar names. That is documentation, not
enforcement.

## 7. `UNKNOWN` is a large, indefinite state, and there is pressure to collapse it

On the day this ships, **every** row on production is `UNKNOWN`: 5 leads, 12
units, 1 sale. Every tile reads "0 real, 0 test, 18 unknown". That is true and it
is unsatisfying, and the pressure to make the dashboard look normal will take one
of two forms — treat UNKNOWN as real (which is exactly today's behaviour and how
a preflight got into team performance) or treat it as test (which deletes ALBA's
history from every screen). Both are one-line changes in a view.

The three-way split of `CONTRACT.md` §2.1 exists to make the collapse visible
when someone attempts it. It does not prevent it.

## 8. `test_run_id` is only as good as the harness that registers itself

A harness that never inserts into `data_test_run` cannot write a `TEST_FIXTURE`
row at all — it gets 23503 on the FK. Good. But it *can* write an `UNKNOWN` row
with no run id, which is legal, indistinguishable from a real unattested row, and
therefore untearable-down by run id.

So the contract does not stop a careless harness polluting production; it stops a
careless harness polluting production **while claiming to be a test**. Getting
the rest requires every harness to be edited, and no harness was read for this
design (`MEASUREMENTS.md` §7).

Related, and measured: `purchase_history.deal_id` uses the natural key
`auto:<email>|<date>` (`supabase/baseline/00000000000002_vocabulary_seed.sql:133`,
which notes there is *no* foreign key behind it). A test run using a real
customer's email on a real date collides with the genuine row on that key. The
provenance column does not defend a natural key.

## 9. Teardown deletes rows; it does not delete their consequences

`delete from <t> where test_run_id = $1` removes the fixture rows. It does not
remove the 898 `audit_log` rows those fixtures caused, the `communication_logs`
they generated, the response-time meters they moved, or any `daily_metrics`
snapshot taken while they were present. `audit_log` is deliberately out of scope
(`CONTRACT.md` §3) because marking the record of a test as test data makes the
test disappear from the record.

So "the run left nothing behind" is a claim about the scoped tables only, and
should be worded that way wherever it is reported.

## 10. Nothing here has been run

`CONTRACT.md` and `MIGRATION-PATTERN.md` are designs; `held/` is one worked file
that has been applied nowhere. **NOT RUN, not PASS.**

Three specific claims in this folder are inference rather than measurement, and
each would be settled by a single apply on staging:

1. That a `GRANT` re-asserting stripped privileges survives
   `nexus_guard_born_open_grants` by way of a NULL `object_identity`
   (`MIGRATION-PATTERN.md` §5). The *outcome* is measured on production; the
   *mechanism* is not.
2. That `CREATE TRIGGER` strips no grants. Follows from reading the guard's body
   and from `ops/channel-events/WIRING-SPEC.md`; not executed.
3. That `add column … not null default 'UNKNOWN'` takes no rewrite lock long
   enough to matter. True of Postgres 11+ generally; not timed on a table of any
   size here, and ALBA's largest scoped table is 12 rows, so this is untested at
   any scale that would reveal a problem.
