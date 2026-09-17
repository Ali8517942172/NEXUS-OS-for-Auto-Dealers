# Tonight, before any of this is applied

Agent PURGE-FIX · 17 September 2026 · for Ali · **his call, not mine**

Nothing in this folder has been applied. Production was read with SELECT only.
The n8n box was not touched. This document is advice about a decision that is
his to make.

---

## The one sentence

**Leave the retention purge running tonight — it has nothing to delete and will
not have for seven years — and treat "a second dealership row exists" as the
tripwire that must not be crossed before the fixes land.**

---

## What I measured, before recommending anything

Read from `dsvuoovivysszdoiorch` today:

| Question | Answer |
|---|---|
| KYC documents due for deletion tonight (`retain_until < today`, not yet purged) | **0** |
| Earliest `retain_until` on any unpurged document | **2033-09-02** |
| `processed_messages` rows older than 7 days (what the dedupe prune would delete) | **0** |
| Dealerships owning KYC documents | **1** |
| Active dealerships in `tenants` | **1** (the second row is the quarantine / unattributed tenant, which is not a dealership) |
| Open archive gaps | **0** |

**Tonight's 03:00 run is a no-op.** It will select zero expired documents,
delete zero storage objects, PATCH zero rows, prune zero dedupe rows and post
zero Slack alerts. The 00:15 inventory recompute will run against one
dealership, correctly scoped, as it already does.

## The trade-off I was asked to lay out — and why it does not survive measurement

The brief framed this as a genuine dilemma: pausing the workflow may breach a
data-retention obligation by keeping identity documents past `retain_until`,
while leaving it running is only safe while exactly one dealership exists.

The second half is exactly right. **The first half is not true for the next
seven years.** The earliest `retain_until` in the table is 2033-09-02 — the
archive node sets `RETENTION_YEARS = 7`. Pausing this workflow tonight, or for
the next several months, keeps nothing past its deletion date, because nothing
reaches its deletion date. There is no retention breach available to us here
yet.

I would rather say that than hand over a balanced-sounding dilemma the data does
not support. A risk register that inflates one side loses the reader on the side
that is real.

## So what, honestly, does each option cost?

**Option A — pause the workflow on the n8n box tonight.**
- Prevents: nothing tonight. There is nothing to prevent.
- Costs: the archive-gap Slack alert stops (0 gaps today, but a new one would go
  unreported), and the dedupe ledger stops being trimmed (0 rows due today, but
  it grows). Both are slow, recoverable harms.
- Also costs: pausing an active nightly job is itself a change to nightly
  behaviour — the thing your own rule says needs a deliberate yes. And a paused
  job is a job someone has to remember to unpause.

**Option B — leave it running.**
- Risks: nothing tonight, and nothing until either (a) a document reaches its
  `retain_until`, which is 2033, or (b) **a second dealership's rows appear in
  this database**. (b) is the one that can happen this week.
- Keeps: the archive-gap alert and the dedupe prune doing their jobs.

**The control that actually matters is neither switch.** It is that no second
dealership is onboarded into this project before the tenant predicates are in
place. The purge is safe today because there is one customer, not because
anything is stopping it.

## Recommended, then

1. **Leave the purge running.** (Option B.) Pausing buys nothing tonight and
   costs two working safeguards.
2. **Do not create a second `tenants` row — or load a second dealership's data
   into an existing one — until the tenant predicates are in.** That is the
   real gate. If a second dealership has to be onboarded before then, **pause
   the purge first**, in that order, and accept the two slow costs above for as
   long as it takes to land the fixes.
3. **Set yourself a tripwire you will actually see.** Before each onboarding,
   run:
   ```sql
   select count(*) from public.tenants
    where status = 'active' and coalesce(is_quarantine, false) = false;
   ```
   The moment that returns more than 1, the purge's blind reads become
   cross-tenant and option B expires.
4. **Nothing needs to be applied tonight.** None of the four proposals in this
   folder is urgent in the next 24 hours. They are urgent before dealership two,
   which is a different and probably nearer deadline.

## The order, when you do say yes

1. `PROPOSED_recompute_inventory_derived.sql` (nx984) — the smallest and safest;
   with the backfill it leaves ALBA CARS' numbers identical.
2. `PROPOSED_guard_extension.sql` sections A and B — A must go in the same
   window as the workflow swap, because A guards `processed_messages` and the
   current workflow deletes from it directly.
3. `PROPOSED_storage_path_tenant_segment.md` steps 1–4 — the 9 legacy objects.
4. `nexus_retention_purge.TENANT_SCOPED.json`, imported and run in **dry run**
   for several nights first, reading the per-dealership counts in `audit_log`,
   before `NEXUS_PURGE_DRY_RUN=false` is ever set.
5. `PROPOSED_guard_extension.sql` section C — last, and only after nx984 is
   amended to loop per dealership. Reversing this order takes out the nightly
   recompute.

## What I did not do, so you know the boundaries of this

- No migration was applied, no DDL run, no row written. Read-only throughout.
- The n8n box at `35.224.126.225` was not contacted. I cannot tell you what is
  actually imported and running there — only what this repo's export says, and
  that export is stale. `nexus_retention_purge.json` carries
  `_exported_from.updatedAt = 2026-08-30` and `active: true`. **Confirm on the
  box itself before acting on any of this.**
- `n8n-workflows/nexus_retention_purge.json` is untouched. The rewrite is a new
  file beside it.
- One thing worth correcting in the P0 list: the "mass UPDATE of every
  dealership's inventory" finding was read off a superseded migration. The live
  function is already tenant-scoped. Details in `RISK.md` §0. Three of the four
  destructive statements are real; that one is not, as written.
