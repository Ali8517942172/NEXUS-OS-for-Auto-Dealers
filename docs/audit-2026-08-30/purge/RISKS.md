# RISKS — NEXUS Retention Purge reconciliation

Workflow `aIYwwoYStDAi9kHy`. Nothing live was touched to produce this; everything below
is reasoned from the exported JSON and from sibling workflows in `/home/claude/audit/`.

---

## 1. What I could not verify (ranked by how much it matters)

### 1.1 The exact shape of Supabase Storage's bulk-delete response — **highest risk**
The whole reconciliation keys on `j.name` in each returned item. I am confident that
`DELETE /storage/v1/object/{bucket}` with `{"prefixes":[…]}` answers with an array of
`storage.objects` rows carrying `name`, but I could not confirm it against **this**
project's Supabase version.

- If `name` is present → everything works.
- If the field is called something else, or the version answers
  `{"message":"Successfully deleted"}` → `shape_unknown` fires, **nothing is marked**,
  and the audit row says `FAILED — response shape unrecognised, reconciliation
  impossible`. Safe, but the job stops making progress until someone looks.
- **Check first (read-only, 30 seconds):** open the last successful execution of the
  current workflow in n8n and look at `Delete Storage Objects`' output items. If they are
  not `{name, id, bucket_id, …}`, change the two `j.name` reads in
  `Reconcile Storage Deletions` before applying anything else.

### 1.2 `retain_until`'s real column type
`kyc_aml_document_auditor_re_upload_loop_phase_5.json` writes it as a 10-char string with
`// column is DATE`, and `compliance.js` treats it as date-only. No DDL for
`kyc_documents` exists in `/home/claude/audit/`. The change (§2 of DESIGN.md) is a no-op
for a `date` column at any run hour and only bites if the column is `timestamptz` — which
is precisely the case the audit flagged. It cannot select *more* rows than the old filter
under either type. Confirm with `\d kyc_documents` when convenient; nothing depends on
the answer.

### 1.3 `kyc_documents.id` type, and the new quoting in `Mark Rows Purged`
The old URL joined ids **unquoted**; the new one wraps each in `"…"`. PostgREST documents
quoted members in `in.(…)` and casts them for uuid and integer alike. This is a real
change to a working query — **watch the first run's `Mark Rows Purged` response**. If it
400s, drop the `.map(…)` and go back to `.join(',')`; the reconciliation is unaffected,
only the id list is.

### 1.4 The MCP operation vocabulary
`addNode`, `setNodeSettings`, `setNodeParameter`, `addConnection` and `removeConnection`
are all proven against this repo (`/home/claude/audit/voice-final/OPERATIONS.json`).
**`removeNode` and `moveNode` are not.** Confirm both against `get_sdk_reference` before
applying. Fallbacks if either is rejected:
- `removeNode` — the three `removeConnection` ops already orphan
  `Storage Delete Succeeded?`; a node with no inbound edge never executes, so the
  workflow is *correct* without the removal. Delete it by hand in the editor.
- `moveNode` — the five position ops are **purely cosmetic**. Drop them; the graph is
  identical, just visually crossed, and can be tidied in the editor.

### 1.5 A stale `connections` key
After the three `removeConnection` ops, `connections["Storage Delete Succeeded?"]` is
`{"main":[[],[]]}`. n8n ignores an entry whose source node is gone. If the MCP exposes
`cleanStaleConnections`, run it after; otherwise it is cosmetic.

### 1.6 URL length on `Mark Rows Purged`
500 quoted uuids ≈ 20 KB of query string. This is **pre-existing** (the old code built the
same list) and evidently works today, but the quoting adds ~1 KB and a full 500-row batch
may be rarer than a partial one. If a 414 ever appears, chunk the PATCH — do **not**
solve it by lowering the limit and leaving rows uncounted.

---

## 2. What could break, and what it costs

| Risk | Blast radius | Mitigation already in the design |
|---|---|---|
| `Reconcile Storage Deletions` throws | run dies before the audit row; **no row is marked** | `onError: stopWorkflow`, all inputs defensively coerced, `pairs` falls back to zipping `ids`/`paths`. Files already deleted stay deleted; rows retry tomorrow. |
| Path-format mismatch (DB stores `/kyc/…`, Storage returns `kyc/…`) | everything reads unaccounted → nightly `FAILED`, nothing marked | both raw and normalised forms indexed; leading `/` and `kyc-documents/` stripped for comparison. Loud, never silent. |
| `Anything Confirmed Deleted?` false branch converging on `Summarise Purge` | double-run of the summary | only one IF output ever carries data. The pattern is used in 13 of this repo's workflows. |
| `Log Purge to Audit` emits nothing → verdict gate never runs | failures stop escalating | `alwaysOutputData: true` added specifically for this. |
| `Purge Verdict Clean?` fires nightly on a persistent PARTIAL | alert fatigue; `errorWorkflow` noise | see §4 — this is a deliberate choice, and it is one condition to change. |

---

## 3. The one genuinely uncomfortable consequence: the stuck-loop

"Only mark what actually deleted" has a cost. If an object is **already absent** from the
bucket — removed by hand, or by an earlier half-completed run under the old buggy graph —
the delete returns nothing for it, so it is never confirmed, so it is never marked, so it
is re-selected tomorrow. Forever, `FAILED` every night.

I considered auto-resolving it (HEAD/list each unaccounted path; treat "already gone" as
purged). I did not build it, for three reasons:

1. It needs a batch loop over up to 500 paths inside a 300 s execution timeout — real
   complexity for a case that should be empty.
2. On a **legal retention obligation**, "the file isn't there, so let's write the
   destruction record ourselves" is the same class of reasoning that produced this bug.
3. Silence is what let 250 rows go missing. A nightly `FAILED` that names exact paths is
   the correct amount of pressure.

**The remedy is a runbook, not code.** When `audit_log` shows a repeating `FAILED`/`PARTIAL`
for the same paths: confirm each object is genuinely absent from the `kyc-documents`
bucket, then set `purged_at` on those ids by hand, with a note referencing the run. The
`summary` already carries this instruction on the `M === 0` branch.

Because of this, **the old buggy graph has almost certainly already created victims**:
rows marked `purged_at` whose file is still in the bucket. Those are invisible to both the
old and the new selection query. Finding them needs a one-off audit outside this workflow
— list the bucket, join against `kyc_documents WHERE purged_at IS NOT NULL`, and any
storage object still present with a purged row is an undeleted customer ID document.
**Do that.** This fix stops the bleeding; it does not repair the past.

---

## 4. Batch limit and dry-run — argued, not silently added

**I did not reduce `limit=500` and I did not add a dry-run gate.** Requirement 4 asked for
the argument either way, so:

- **Against a lower limit:** the old graph's damage did not scale with batch size — one
  half-failed batch of 50 mismarks 25 rows just as permanently. The new graph marks only
  confirmed deletions, so a 500-row batch is now *no more dangerous* than a 50-row one.
  Lowering it would only make the backlog drain slower while the same documents sit past
  their legal deadline. Deleting late is a violation too.
- **Against a dry-run gate:** it converts a nightly compliance job into a manual one and
  guarantees the backlog grows. The `Anything Confirmed Deleted?` gate is **not** a
  dry-run — it is the empty-set case, because `id=in.()` is a malformed filter.
- **The one cap I would accept**, if the first live runs look wrong: leave `limit=500` and
  add `&order=retain_until.asc` so the oldest overdue documents drain first and a partial
  night is deterministic rather than arbitrary. One `setNodeParameter` on
  `Find Expired Documents`. I left it out because it changes selection, and selection was
  declared sound.

`Purge Verdict Clean?` currently escalates on **any** non-SUCCESS. That is the strict
reading of "the audit trail is the point of it". If PARTIAL noise becomes a problem, flip
its `rightValue` logic to fire only on `FAILED` — but do that only *after* the first weeks
of runs show what normal looks like, and never by removing the gate.

---

## 5. After applying — check these, in order

1. `validate_workflow` on `aIYwwoYStDAi9kHy`. Expect **16 nodes**, no unreachable node, no
   dangling connection.
2. Open the canvas. `Storage Delete Succeeded?` must be **gone**. The spine must read
   `Delete Storage Objects → Reconcile Storage Deletions → Anything Confirmed Deleted? →
   {Mark Rows Purged, Summarise Purge} → Delivery Report → Log Purge to Audit →
   Purge Verdict Clean?`.
3. Node settings survived the update: `Mark Rows Purged` still `continueRegularOutput` +
   `alwaysOutputData` + 3 retries; `Log Purge to Audit` now has `alwaysOutputData`.
4. Credentials: every HTTP node must still carry the Supabase credential. `OPERATIONS.json`
   uses `"<<SUPABASE_CRED_ID>>"` **nowhere on an existing node** — no `addNode` here is an
   HTTP node, so no credential is attached by these ops and none should be lost. If any
   node shows "credential not set" after applying, re-attach `dv4OeARarErZLHCj`
   ("Supabase account") by hand.
5. First scheduled run: read the `audit_log` row. It must contain the literal words
   `requested`, `deleted`, `unaccounted`. If it says `deleted 500` with no `unaccounted`
   count, the ops did not apply.
6. Cross-check that run: `SELECT count(*) FROM kyc_documents WHERE purged_at::date =
   CURRENT_DATE` must equal the `deleted M` in the audit row. **Not** `requested N`. That
   equality is the entire fix.

## 6. How to test it safely on the live bucket

Do **not** first-run this against real customer documents.

1. **Seed.** Upload 3 junk files to `kyc-documents` under a throwaway prefix
   (`kyc/_purge-test/…`). Insert 3 `kyc_documents` rows pointing at them with
   `retain_until` in the past and `purged_at` NULL.
2. **Provoke the exact bug.** Delete **one** of the three objects from the bucket by hand
   *before* the run. The workflow will request 3 and Storage will return 2.
   - Expected: `Mark Rows Purged` PATCHes **2** ids. `audit_log` says
     `requested 3, deleted 2, unaccounted 1` with `status PARTIAL`, names the third path,
     and the execution ends red via `Purge Verdict Clean?`.
   - The third row still has `purged_at IS NULL`. **On the old graph all three would have
     been marked and the row would have said SUCCESS.** That contrast is the acceptance test.
3. **Empty case.** Delete the remaining two objects by hand, run again: `deleted 0`,
   `FAILED`, nothing marked — and confirm the summary carries the "already gone from an
   earlier half-completed run" runbook line.
4. **Clean case.** Re-seed 2 fresh files, run: `requested 2, deleted 2, unaccounted 0`,
   `SUCCESS`, both rows marked, execution green.
5. **Scope check.** Confirm no object outside `kyc/_purge-test/` disappeared, and that no
   run produced the `objects that were NOT requested` warning.
6. Only then let the 03:00 schedule touch real rows — and watch the first **three** nights,
   not one. A partial failure needs a batch big enough to be partial.

Isolate real data throughout by pointing step 1's rows at a distinct prefix and, if you
want belt and braces for the first live night, temporarily narrow
`Find Expired Documents` with `&storage_path=like.kyc/_purge-test/*` — then **remove it**,
and verify you removed it.
