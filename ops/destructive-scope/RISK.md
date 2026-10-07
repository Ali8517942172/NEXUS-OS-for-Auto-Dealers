# Destructive scope under multi-tenancy — what four nightly statements would do

Agent PURGE-FIX · 17 September 2026 · read-only against `dsvuoovivysszdoiorch`

**Nothing in this folder has been applied.** Every file here is a proposal.
Production was read with SELECT only. No migration, no DDL, no write, and the
n8n box was not touched.

---

## 0. A correction before anything else — one of the four briefed facts is stale

I was briefed that `public.recompute_inventory_derived()` "is SECURITY DEFINER
and runs `update public.inventory i set … where i.id = d.id` with no tenant
predicate and no tenant parameter — a mass UPDATE of every dealership's
inventory from one empty call."

**That was true of `supabase/migrations/20260830051654_fix_days_in_stock_dubai_date.sql`.
It is not true of what runs tonight.** That migration is superseded. Two later
migrations redefine the same function, both present in this repo:

- `20260902195239_p0_1_recompute_inventory_derived_scopes_to_its_caller.sql`
- `20260906065739_inventory_derived_figures_refuse_to_invent_a_missing_input.sql`

I read the live definition out of `pg_proc` on production. It:

- declares `v_tenants uuid[]` and **enumerates dealerships explicitly**;
- for a signed-in caller uses `array[public.nexus_current_tenant_id()]`, and
  returns `0` when that account belongs to no dealership;
- for a `service_role` batch caller (the n8n nightly) builds the array from
  `public.nexus_active_dealership_ids()`, which excludes the quarantine tenant;
- ends the UPDATE with `where i.tenant_id = d.tenant_id and i.id = d.id
  **and i.tenant_id = any(v_tenants)**`;
- reads `holding_cost_per_day_aed`, `aging_warn_days` and `aging_critical_days`
  from `public.inventory_profit_settings` joined `on s.tenant_id = inv.tenant_id`.

The live function's own comment names the incident that caused the fix: "the
sweep used to be an unscoped UPDATE, which on 6 Sep touched 33 rows across three
dealerships for a caller that had named none of them."

So **two of the five hard-coded economics are already per-tenant**, and the
mass-UPDATE-across-dealerships hole is already closed. The finding was read off
a superseded file. It should not be carried into a P0 list as written, or the
list loses credibility on the items that *are* real.

**What is still real in that function** — and what
`PROPOSED_recompute_inventory_derived.sql` addresses:

| Literal | Where | Why it is per-dealer |
|---|---|---|
| `* 0.05` (VAT) | `round(b.price * 0.05)` | VAT is a jurisdiction rate. A dealer outside the UAE gets a wrong tax figure, silently. |
| `* 0.05` (commission) | `round((gross − holding) * 0.05)` | Commission is a commercial policy each dealership sets. |
| `'Asia/Dubai'` | `today_dubai date := (now() at time zone 'Asia/Dubai')::date` | `public.tenant_configuration.timezone` already exists as a column. The function does not read it. (Measured: it is `NULL` for Tenant A, so it is an unset field, not a populated one — a fix must say what happens when it is NULL rather than assume a value is there.) |
| no `p_tenant_id` | function signature is `()` | A `service_role` call still sweeps **every** active dealership at once. That is defensible for a nightly batch, but there is no way to recompute one dealership, and no way to cap the blast radius of a bad run. |

---

## 1. The four destructive statements

Measured on production today: **2 tenant rows** — `Tenant A` (active) and
`UNATTRIBUTED - QUARANTINE (not a dealership)` (quarantine). So exactly one
live dealership. `kyc_documents` holds **9** rows, all with a `storage_path`,
all in the `kyc/YYYY/MM/uuid.ext` shape. `processed_messages` holds **173**
rows. `inventory` holds **12** rows across **1** tenant.

Everything below is "what happens when dealership number two exists".

### 1.1 `Find Expired Documents` — blind cross-tenant SELECT

```
GET /rest/v1/kyc_documents
      ?select=id,storage_path,retain_until
      &storage_path=not.is.null
      &purged_at=is.null
      &retain_until=lt.<today>
      &limit=500
```

`kyc_documents` **does** carry a `tenant_id` column (verified in
`information_schema`). The query does not mention it. The credential is the
n8n `service_role` Supabase account, which bypasses RLS entirely.

**With two dealerships live:** the 500-row page is filled in whatever order
PostgREST returns, mixing both dealerships. Dealership A's expired documents and
dealership B's expired documents land in one list, and every downstream node —
the storage delete, the PATCH — operates on that mixed list as one unit. There
is no per-dealership count, no per-dealership audit row, and no way after the
fact to answer "how many of my documents did you destroy last night" for one
dealer. The `limit=500` also becomes a silent fairness problem: a dealership
with 600 expired documents starves the other one out of the nightly run
indefinitely, and nothing reports it.

**Does the guard stop it?** Not applicable — it is a SELECT. But it is the
statement that *chooses the victims* for the two that follow, so its lack of a
tenant predicate is what makes the rest cross-tenant.

### 1.2 `Delete Storage Objects` — bulk delete of Emirates ID and passport scans

```
DELETE /storage/v1/object/kyc-documents
Body: {"prefixes": [ …every storage_path from 1.1… ]}
```

This destroys the actual image files. Irreversible — Supabase Storage has no
undelete, and there is no bucket versioning in play.

**With two dealerships live:** it deletes both dealerships' identity documents
in one call, chosen by a query that never looked at who owns them.

**Does the guard stop it? NO — and it structurally cannot.**
`nexus_refuse_destructive_write()` is a Postgres row/statement trigger.
Supabase Storage objects live behind the Storage API; the delete never becomes
a `DELETE` on a guarded `public.*` table. There is no trigger surface here at
all. This is the one of the four where the guard is not merely missing a table —
it is in the wrong system.

**The storage-path problem, stated plainly.** The obvious mitigation for a
bulk-prefix delete is "refuse any prefix that does not start with the tenant's
own segment". **You cannot do that here, because the prefix carries no tenant.**
The path is built in
`n8n-workflows/kyc_aml_document_auditor_re_upload_loop_phase_5.json` as:

```
'kyc/' + yyyy + '/' + mm + '/' + uuid + '.' + ext
```

Year, month, random UUID. Nothing in that string identifies a dealership. All 9
production paths match that shape (measured: zero rows in any other shape). So
a scope check on the path has nothing to check against — the only thing that
knows who owns `kyc/2026/08/<uuid>.jpg` is the `kyc_documents` row, which is
exactly the thing the blind SELECT failed to filter. **A tenant-scoped storage
delete is not possible until the path carries a tenant segment.** See
`PROPOSED_storage_path_tenant_segment.md`.

There is a second, subtler hazard the existing workflow already documents in its
own code comments: `prefixes` is Supabase's own parameter name, and the workflow
carries a `extra_returned` check in `Reconcile Storage Deletions` precisely
because *if the API ever applied real prefix semantics, a path like `kyc/2026/`
would take out everything under it*. Under one tenant that is a data-loss
incident. Under two it is a cross-tenant data-loss incident.

### 1.3 `Prune Dedupe Guard` — unscoped DELETE on `processed_messages`

```
DELETE /rest/v1/processed_messages?processed_at=lt.<now-7d>
```

`processed_messages` **does** carry `tenant_id`. The filter is a timestamp and
nothing else.

**With two dealerships live:** it clears both dealerships' idempotency ledger in
one statement. The direct consequence of losing that ledger is **duplicate
processing** — a replayed webhook that would have been recognised as already
seen is treated as new. For a WhatsApp or lead webhook that means a duplicate
lead, a duplicate customer message, or a duplicate outbound send. The 7-day
window makes it low-probability, not impossible, and a provider retry storm is
exactly the scenario where it matters.

**Does the guard stop it? NO.** `processed_messages` is not one of the 11 tables
the guard covers. I verified the live trigger set on production directly from
`pg_trigger`, filtering on `tgfoid = 'public.nexus_refuse_destructive_write'::regproc`.
The guarded tables are exactly: `audit_log`, `channel_message_events`,
`channel_registry`, `communication_logs`, `inventory`, `inventory_actions`,
`lead_event`, `lead_recovery_actions`, `leads`, `tenants`,
`whatsapp_conversation_state`. `processed_messages` is not there.
`kyc_documents` is not there either.

### 1.4 `Mark Rows Purged` — PATCH driven by the blind select

```
PATCH /rest/v1/kyc_documents?id=in.( …confirmed_ids… )
Body: {"purged_at": "<now>"}
```

Credit where due: this node is **better than the brief describes**. It does not
PATCH the raw ids from the select. It PATCHes
`$('Reconcile Storage Deletions').first().json.confirmed_ids` — only the ids
whose storage object Supabase confirmed it actually deleted. The workflow's own
comments record why: an earlier version "PATCHed all 500 REQUESTED ids, not the
survivors" and "stamped purged_at on 500 rows for a delete that removed 250".
That specific bug is fixed.

**What is still wrong:** the ids are still ultimately descended from the
untenanted select in 1.1, and the PATCH itself carries no `tenant_id=eq.…`
predicate. So it writes a compliance field — `purged_at`, the field that says
"we destroyed this customer's passport scan on schedule" — across both
dealerships' rows in one statement, with `service_role` bypassing RLS.

**Does the guard stop it? NO, twice over.** First, `kyc_documents` is not a
guarded table. Second and more general: **the guard fires on DELETE and TRUNCATE
only. It has no UPDATE arm at all.** I verified this on production by decoding
`pg_trigger.tgtype` for every trigger bound to the guard function: 11 tables ×
2 triggers, every one of them either `BEFORE DELETE FOR EACH ROW` or
`BEFORE TRUNCATE FOR EACH STATEMENT`. Not one `UPDATE`. An UPDATE that rewrites
every row of `leads` — or of `inventory`, or `tenants` — is not checked by
anything.

---

## 2. Guard verdict, in one table

| Statement | Target | Guard refuses it? | Evidence |
|---|---|---|---|
| `Find Expired Documents` (SELECT) | `kyc_documents` | n/a (read) | Not a write; but it picks the rows the next two destroy. |
| `Delete Storage Objects` | Supabase Storage bucket `kyc-documents` | **NO** | Storage is outside Postgres. A row trigger has no surface here. Not fixable by extending the guard. |
| `Prune Dedupe Guard` (DELETE) | `public.processed_messages` | **NO** | Table absent from the 11 guarded tables (verified in `pg_trigger` on production). |
| `Mark Rows Purged` (UPDATE) | `public.kyc_documents` | **NO** | Table not guarded, *and* the guard has zero UPDATE triggers on any table. |
| (bonus) nightly `recompute_inventory_derived` (UPDATE) | `public.inventory` | **NO** | `inventory` is guarded for DELETE and TRUNCATE only. The nightly mass UPDATE passes straight through. |

`public.nexus_destructive_guard_coverage()` exists and reports "GUARDED" per
table — but it only ever asks about triggers named `%refuse_delete` and
`%refuse_truncate`. It will report a table as GUARDED while an UPDATE rewrites
every row of it. That report is honest about what it measures and silent about
what it does not; a reader will take it as broader than it is.

---

## 3. A trap in extending the guard to UPDATE — do not reuse the function

`public.nexus_refuse_destructive_write()` ends:

```sql
  if tg_op = 'DELETE' then
    return old;
  end if;
  return null;
```

For `BEFORE TRUNCATE FOR EACH STATEMENT` the return value is ignored, so `null`
is harmless there. **For a `BEFORE UPDATE FOR EACH ROW` trigger, returning
`NULL` tells Postgres to silently skip the row.** Bolting an UPDATE trigger onto
this function would not refuse updates — it would make every update *appear to
succeed and change nothing*, with no error. That is worse than the hole it was
meant to close, because nothing would report it.

`PROPOSED_guard_extension.sql` therefore adds a **separate** function that
returns `NEW`, and never reuses the existing one for UPDATE.

---

## 4. Blast radius, in plain words

Tonight, with one dealership, every one of these statements hits exactly one
dealership's data, because there is only one. That is the whole of the current
safety margin — not a control, an accident of the customer count.

The night the second dealership's data lands in this database:

- **03:00.** One query with no owner filter picks up to 500 expired KYC
  documents belonging to both dealerships. One bulk call destroys those image
  files — Emirates IDs and passports — permanently. `purged_at` is then written
  across both dealerships' compliance records in a single statement.
- **03:00, same trigger.** Both dealerships' 7-day idempotency ledger is
  deleted in one statement.
- **00:15.** Every active dealership's inventory is recomputed in one call.
  This one is scoped correctly today and excludes quarantine — but the VAT rate,
  the commission rate and the business day boundary applied to dealership B are
  dealership A's, hard-coded.
- **Any hour.** A Slack alert about a KYC archive gap goes to one hard-coded
  channel, `C0BKTLL1X54`, naming a document. Dealership A reads about
  dealership B's compliance hole.

None of it is refused by anything. The failure mode is not a crash — it is a
clean green run and an `audit_log` row saying SUCCESS.
