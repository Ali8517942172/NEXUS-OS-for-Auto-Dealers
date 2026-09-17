# Putting a dealership into the KYC object key

`kyc/YYYY/MM/uuid.ext` → `kyc/<tenant>/YYYY/MM/uuid.ext`

Agent PURGE-FIX · 17 September 2026 · **proposal only, nothing applied**

---

## 1. Why this is the blocking item, not a tidy-up

The nightly retention purge destroys customer identity documents with one bulk
call:

```
DELETE /storage/v1/object/kyc-documents
{"prefixes": [ … ]}
```

The natural safety control for a bulk delete is a scope check: *refuse any path
that does not begin with the tenant segment of the dealership this batch is
for*. **That check cannot be written today, because the key contains no
dealership.** The path is built in
`n8n-workflows/kyc_aml_document_auditor_re_upload_loop_phase_5.json`:

```js
const storage_path = 'kyc/' + yyyy + '/' + mm + '/' + uuid + '.' + ext;
```

Year, month, random UUID. Measured on production today: **9 KYC rows, all with a
`storage_path`, all matching `^kyc/\d{4}/\d{2}/`, zero in any other shape.**

So the only thing in the system that knows who owns `kyc/2026/08/<uuid>.jpg` is
the `kyc_documents` row that points at it. Every scope decision has to come from
the database, and the delete call itself is unverifiable in isolation. That is
the whole problem: a path that carries no owner cannot be checked, only trusted.

There is a second reason this matters beyond the purge. Supabase Storage
policies on `storage.objects` match on `name`. The existing policy
`kyc_objects_staff_read` has to call `public.nexus_kyc_object_readable(name)` —
a SECURITY DEFINER function that looks the owner up in `kyc_documents` — because
the name alone tells it nothing. A tenant segment lets a policy be written
against the path directly, and lets a bucket listing be scoped, which today it
cannot be.

## 2. The privacy constraint this must not break

The path used to carry an identity segment. The archive node's own comment
records why it was removed:

> The key used to carry an identity segment derived from the customer's email or
> phone number, e.g. `kyc/ahmed_at_gmail.com/2026/08/<uuid>.jpg`. Anyone able to
> list the bucket then read the customer list straight out of the key names
> without opening a file […] The key is now non-identifying.

That decision is correct and this proposal must not quietly reverse it. **A
tenant UUID is not a customer identity.** It identifies a dealership — a
business, our own customer, whose name is already in `tenants` — and it reveals
nothing about the individual whose passport is in the file. Use the raw
`tenants.id` UUID, not the `slug`: a slug is a human-readable business name
(`alba-cars`) and would leak our client list to anyone who could list the
bucket. The UUID leaks only "there are N dealerships", which the row count
already implies.

Proposed shape:

```
kyc/<tenants.id as uuid>/YYYY/MM/<uuid>.<ext>
kyc/fff6a2b5-cfd5-4460-8383-875bc5826de0/2026/08/9c1f….jpg
```

## 3. The documents already written under the old shape — say it plainly

**The 9 existing objects cannot be scoped. Not "not yet" — not at all, while
they sit at their current keys.** There is nothing in
`kyc/2026/08/<uuid>.jpg` for a prefix check to match against, so any control of
the form "the prefix must start with this dealership" will either reject all of
them or has to carve out an exception that accepts any path under `kyc/` — which
is the hole it was meant to close.

There are exactly three options, and none of them is free:

1. **Move the objects.** Copy each to its new key, verify the copy, update
   `kyc_documents.storage_path`, delete the old object. This is the only option
   that ends with a uniformly scopeable bucket. It is also a write against 9
   irreplaceable identity documents, and a failed copy that is followed by a
   successful delete loses one permanently.
2. **Leave them, and carve out a legacy exception.** Honest, cheap, and it means
   the scope check does not protect those 9 documents — ever. Acceptable only
   because those 9 all belong to the one dealership that exists today, which is
   a fact about the customer count, not a control.
3. **Leave them and let them expire.** `retain_until` is set 7 years out by the
   archive node (`RETENTION_YEARS = 7`). Option 3 means the exception in option
   2 lives until 2033.

**Recommended: option 1, for 9 objects, copy-verify-then-delete, with the delete
last and conditional on a verified copy.** Nine is a number a human can check by
hand afterwards. If this is deferred until there are thousands, option 1 stops
being a morning's work and the answer becomes option 2 by default.

## 4. Migration path

Ordered, and each step is safe to stop after.

**Step 1 — write new documents to the new shape.** Change the archive node in
`kyc_aml_document_auditor_re_upload_loop_phase_5.json`. The node already has the
tenant in scope wherever the `kyc_documents` insert gets its `tenant_id`; the
path build becomes:

```js
// The tenant segment is the dealership's UUID, never its slug. A slug is a
// business name and would leak our client list to anyone who can list the
// bucket. A UUID identifies a dealership and says nothing about the customer
// whose passport this is — the privacy rule that removed the email segment is
// about the CUSTOMER, and is unaffected.
if (!tenantId) {
  // No tenant, no path. Falling back to the untenanted shape would quietly
  // recreate the unscopeable case this whole change exists to remove.
  base.archive_error = 'no tenant on this document — refusing to archive to an unscoped key';
  return [{ json: base }];
}
const storage_path = 'kyc/' + tenantId + '/' + yyyy + '/' + mm + '/' + uuid + '.' + ext;
```

Note the refusal. An `archive_error` here surfaces as a `storage_path IS NULL`
row, which the purge workflow's `Find Archive Gaps` branch already detects and
alerts on. Failing into an existing, monitored gap is better than writing an
unscopeable key.

**Step 2 — add a constraint that makes the old shape unwritable, but tolerates
what already exists.** `NOT VALID` is the point: it applies to new and updated
rows and does not reject the 9 legacy rows already in the table.

```sql
-- PROPOSAL. Changes what the KYC auditor can write. Needs Ali's yes.
alter table public.kyc_documents
  add constraint kyc_storage_path_carries_tenant
  check (
    storage_path is null
    or storage_path = 'kyc/' || tenant_id::text || '/' ||
       substring(storage_path from '^kyc/[0-9a-f-]{36}/(.*)$')
  ) not valid;
```

This says more than "looks like a UUID": it says **the UUID in the path is this
row's own tenant**. A path carrying another dealership's segment is rejected.
Run `validate constraint` only after step 3.

**Step 3 — move the 9 legacy objects.** Order matters, and the delete is last:

1. `select id, tenant_id, storage_path from public.kyc_documents
    where storage_path is not null and storage_path !~ '^kyc/[0-9a-f-]{36}/';`
   (9 rows today.)
2. For each: `copy` old key → new key via the Storage API.
3. **Verify the copy exists and its byte size matches** before touching anything
   else. A copy that silently produced a 0-byte object and was then followed by
   a delete destroys a passport scan.
4. `update public.kyc_documents set storage_path = <new> where id = <id>;`
5. Only now delete the old object.
6. Re-run the query in (1). It must return 0 rows.

This is a hand-run one-off against 9 documents, done with someone watching — not
a workflow, and not a loop that runs unattended.

**Step 4 — `alter table public.kyc_documents validate constraint
kyc_storage_path_carries_tenant;`** This is the moment the bucket becomes
uniformly scopeable. If it fails, step 3 missed something; fix that rather than
dropping the constraint.

**Step 5 — turn on the scope check in the purge.**
`nexus_retention_purge.TENANT_SCOPED.json` already enforces it: every path must
start with `kyc/<tenant>/` or the whole batch for that dealership is abandoned
and reported. Until step 4 passes, that check would abandon every batch, which
is why the workflow ships with `NEXUS_PURGE_REQUIRE_TENANT_PREFIX` as a flag and
a `DRY_RUN` default.

**Step 6 — simplify the storage policy.** Once every key carries its owner,
`kyc_objects_staff_read` can match the path directly instead of calling
`nexus_kyc_object_readable()` per object. Optional, and a separate change —
listed so it is not forgotten, not so it is bundled in.

## 5. What is still not fixed after all of this

A tenant segment makes the delete *checkable*. It does not make it *correct*.
The batch is still chosen by a query over `kyc_documents`, and if that query is
wrong — wrong `retain_until`, wrong tenant — the prefix check passes happily
while the wrong documents are destroyed. The prefix check is a second lock on
the same door, not a different door. The first lock is the tenant predicate on
the SELECT, and that is in the workflow rewrite.
