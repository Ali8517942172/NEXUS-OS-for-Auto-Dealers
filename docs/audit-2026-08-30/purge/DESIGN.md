# NEXUS Retention Purge — reconciliation redesign

Workflow `aIYwwoYStDAi9kHy` · source `/home/claude/audit/n8n-workflows/nexus_retention_purge.json`
14 nodes → **16 nodes** (+3 added, −1 removed). `executionOrder: v1`, timezone `Asia/Dubai`.

---

## 0. What was actually wrong

Two separate defects that reinforced each other.

**(a) The graph marked rows the delete never touched.** Supabase Storage's bulk delete
returns a JSON array, and n8n splits an array response into **one item per deleted
object**. `Storage Delete Succeeded?` is a per-item IF, so a batch of 500 that
half-succeeds produces ~250 items on output 0 and the rest on output 1. Under
executionOrder v1 output 0 runs to completion first: `Mark Rows Purged` PATCHed
`$('Collect Expired Paths').ids` — **all 500 requested ids, not the survivors** —
`Log Purge to Audit` wrote SUCCESS, and only afterwards did `Purge Failed` throw. The
stopAndError's own text ("purged_at was deliberately NOT written") was false in exactly
the case it existed for. 250 rows became invisible to every future run while the
customer's Emirates ID and passport scans stayed in the bucket.

**(b) Nothing compared requested against returned.** `Summarise Purge` and
`Delivery Report` looked only for a `.error` key. The bulk delete returns **only the
objects it removed**; an object it could not touch is simply *absent*, with no error.
A run that deleted 3 of 500 reported `SUCCESS — deleted 500`.

The fix is not a better error check. It is a **set comparison**, plus a structural change
that makes the ordering hazard impossible rather than merely unlikely.

---

## 1. New spine

```
Every Night 03:00
 └─(y −120)─ Find Expired Documents ─ Collect Expired Paths ─ Delete Storage Objects
                                                                      │
                                                    Reconcile Storage Deletions   ← NEW
                                                                      │
                                                    Anything Confirmed Deleted?   ← NEW (IF)
                                                       ├─[0] true  → Mark Rows Purged ─┐
                                                       └─[1] false ───────────────────┴→ Summarise Purge
                                                                                            │
                                                                                      Delivery Report
                                                                                            │
                                                                                      Log Purge to Audit
                                                                                            │
                                                                              Purge Verdict Clean?  ← NEW (IF)
                                                                                 ├─[0] SUCCESS → end
                                                                                 └─[1] not     → Purge Failed — Rows NOT Marked
 ├─(y  140)─ Prune Dedupe Guard                    (unchanged)
 └─(y  380)─ Find Archive Gaps ─ Any Gaps? ─ Slack: Archive Gap Alert   (unchanged)
```

`Storage Delete Succeeded?` is **removed**. Its per-item semantics were the defect; it
cannot be repaired in place because the question it asks ("does *this item* carry an
error?") is the wrong question.

---

## 2. Node by node

### `Find Expired Documents` — parameter change (`/url`)

```
retain_until=lt.' + $now.toFormat('yyyy-MM-dd')          →   retain_until=lt.' + $now.startOf('day').toUTC().toISO()
```

`$now.startOf('day')` uses the workflow timezone (`Asia/Dubai`), so this is the *instant*
00:00 Dubai today, sent as `2026-08-29T20:00:00.000Z`. Precedent for an ISO instant in a
PostgREST filter is already in this workflow: `Prune Dedupe Guard`.

Why this and not the date string:

| `retain_until` column type | old behaviour | new behaviour |
|---|---|---|
| `date` (what `kyc_aml_document_auditor…` writes — `// column is DATE`) | selects `retain_until ≤ today_Dubai − 1` | **identical**, at any run hour |
| `timestamptz` | `'2026-08-30'` casts to `2026-08-30T00:00:00Z` = 04:00 Dubai, so documents were destroyed **before** their deadline | selects only once 00:00 Dubai of the *following* day has passed — never early |

Selection semantics are otherwise untouched: `storage_path=not.is.null`,
`purged_at=is.null`, `limit=500`. A NULL `retain_until` still cannot match either
operator, so the null-matches-everything mode still does not exist.

### `Collect Expired Paths` — parameter change (`/jsCode`)

Adds `pairs: [{id, path}]` — the reconciliation ledger. Each id now travels **beside**
the path whose deletion has to be confirmed before that id may be marked. `count`,
`ids`, `paths`, `oldest_due` are unchanged (`Delete Storage Objects` still sends
`paths`); `ids` survives for reference only — **nothing PATCHes by it any more**. The
existing truthy-`id`/`storage_path` filter is untouched, so an empty path still cannot
become a bucket-wide prefix.

### `Reconcile Storage Deletions` — **NEW** Code node, `[880, −120]`

Does two jobs.

**Job 1 — the set comparison.**

```
returnedSet ← every  j.name  in the delete response  (raw and normalised)
confirmed   ← pairs whose path IS in returnedSet     → its id may be marked
unaccounted ← pairs whose path is NOT in returnedSet → row left alone
```

Normalisation strips a leading `/` and a leading `kyc-documents/` **for comparison
only**. What is *sent* to Storage is never rewritten — changing that would change which
objects get destroyed. Both the raw and normalised forms are indexed, so a match either
way counts.

The code says this in a comment, because it is the assumption that produced the bug:

> Supabase Storage's bulk delete returns ONLY the objects it removed. An object it could
> not touch is simply ABSENT from the response — no error key, no null, no placeholder.
> **ABSENCE IS NOT SUCCESS.** A path that does not come back means "still sitting in the
> kyc-documents bucket", and its row must stay UNMARKED so tomorrow's run selects it
> again. Unmarked self-heals. Wrongly-marked does not.

Three conditions beyond the plain comparison:

- **`transport_error`** — `Delete Storage Objects` runs `onError: continueRegularOutput`,
  so an HTTP/network failure arrives as an item carrying `error`. Scanned across *all*
  items, because with an array-split response the failure can be item 7.
- **`shape_unknown`** — response is non-empty, carries no error, and yet contains no
  `name` anywhere. The API contract changed under us and reconciliation is impossible.
  Being *unable to verify* is not success: mark nothing, report FAILED.
- **`extra_returned`** — object names came back that were never requested. `prefixes` is
  the API's own parameter name; if Storage ever applied real prefix semantics it would
  destroy documents whose retention has not expired, **and every requested path would
  still come back clean**. A tidy N-of-N is therefore not on its own proof the delete
  was in scope.

**Job 2 — collapse the fan-out.** It emits exactly **one** item. No node downstream of
here can run per-item, so defect (a) is structurally gone, not merely counted
differently.

### `Anything Confirmed Deleted?` — **NEW** IF, `[1100, −120]`

`{{ $json.deleted }}` **> 0**.

- `[0] true` → `Mark Rows Purged`
- `[1] false` → straight to `Summarise Purge`

The gate exists because `id=in.()` with an empty list is a malformed PostgREST filter —
this is not a dry-run switch, it is the empty-set case. Both outputs converge on
`Summarise Purge`, so **the audit row is written on every path**. Only one IF output ever
carries data, so `Summarise Purge` runs exactly once. (Converging edges into input 0 are
the house pattern here — `Delivery Report` in `nexus_master_lead_router` has six.)

### `Mark Rows Purged` — parameter change (`/url`), moved to `[1320, −260]`

```
id=in.( $('Collect Expired Paths').first().json.ids.join(',') )                       ← every requested row
id=in.( $('Reconcile Storage Deletions').first().json.confirmed_ids …quoted… )        ← only the confirmed ones
```

Ids are wrapped in `"…"` (PostgREST accepts quoted `in.` members for uuid and integer
alike) with any embedded quote stripped, so a stray character in an id cannot break the
filter apart. Guards re-asserted unchanged: `onError: continueRegularOutput`,
`alwaysOutputData`, 3 retries.

### `Summarise Purge` — parameter change (`/jsCode`), moved to `[1540, −120]`

Reads `$('Reconcile Storage Deletions')` **explicitly**. `$json` is not safe here: this
node is fed by two edges, and on the true path the incoming item is the PATCH response
(empty, under `Prefer: return=minimal`).

```
N = requested   M = deleted (confirmed gone)   U = N − M
transport_error or shape_unknown → FAILED     (could not verify)
N === 0                          → SUCCESS    (nothing was due)
M === 0                          → FAILED
M === N                          → SUCCESS
otherwise                        → PARTIAL
extra_returned && SUCCESS        → PARTIAL    (over-delete is not success)
```

`summary` always opens `requested N, deleted M, unaccounted N−M (oldest due …)` and then
**names the unaccounted paths** (first 20, then a `…and K more` tail). That list is the
point of the row.

### `Delivery Report` — parameter change (`/jsCode`), moved to `[1760, −120]`

Same `CLAIMED` / `check()` / `delivery{status, verified[], dropped[], note}` shape as
`competitor_price_scraping`, `wf_108_erp_sync` and `whatsapp_bdc`. Two extensions:

1. `check(c)` short-circuits on an explicit `c.verdict`, for claims no single node's
   output can answer (the count comparison, the scope check).
2. `Mark Rows Purged` is claimed **only when `M > 0`** — claiming a node the gate skipped
   by design would report a phantom drop.

```
{ what: 'every requested KYC object confirmed gone from Storage (M of N)',
  critical: unverifiable || (M === 0 && N > 0) }        ← FAILED vs PARTIAL lives here
{ node: 'Delete Storage Objects', critical: true }
{ what: 'delete stayed scoped to the requested paths', critical: false }
{ node: 'Mark Rows Purged',       critical: false }     ← only when M > 0
```

`Summarise Purge` and `Delivery Report` were checked against eight simulated responses
and agree on `status` in all eight (§4).

### `Log Purge to Audit` — settings change only, moved to `[1980, −120]`

Parameters untouched: it already prefers `delivery.status` and appends `delivery.note` +
`delivery.dropped[]`. `alwaysOutputData: true` is **new** and load-bearing — the node
sends `Prefer: return=minimal`, so Supabase answers 204 with no body and the verdict gate
downstream would otherwise never fire.

### `Purge Verdict Clean?` — **NEW** IF, `[2200, −120]`

`{{ $('Delivery Report').first().json.delivery.status }}` **equals** `SUCCESS`.
`[0] true` → end. `[1] false` → `Purge Failed — Rows NOT Marked`.

Placed **after** the audit write on purpose: the compliance row lands before the run is
allowed to go red. Nothing is rolled back and nothing is suppressed — the throw exists so
the execution shows red and reaches `errorWorkflow: iYJkh1kztWxZXDbT`.

### `Purge Failed — Rows NOT Marked` — parameter change (`/errorMessage`), moved to `[2420, 0]`

The old message asserted something that had already become false. The new one states what
is now true: the audit row was written first and names every unaccounted path; `purged_at`
was written only for confirmed deletions; the rest are deliberately unmarked and will be
retried; **absence from the response means NOT DELETED, never "fine"**.

---

## 3. Failure modes → what lands in `audit_log`

| Storage returns | marked | `status` | `summary` / `dropped[]` |
|---|---|---|---|
| all 500 names | 500 | `SUCCESS` | `requested 500, deleted 500, unaccounted 0` · 4 steps verified |
| 250 names | **250** | `PARTIAL` | `requested 500, deleted 250, unaccounted 250` + the 250 paths · dropped: *250 of 500 requested path(s) absent from the delete response - NOT deleted* |
| 3 names | **3** | `PARTIAL` | `requested 500, deleted 3, unaccounted 497` + paths (**was `SUCCESS — deleted 500`**) |
| `[]` | **0** | `FAILED` | `deleted 0, unaccounted 500` + the "already gone from an earlier half-completed run?" runbook line |
| HTTP error | 0 | `FAILED` | dropped names both the count claim and `Delete Storage Objects` with the error text |
| unrecognised shape | 0 | `FAILED` | *response shape unrecognised, reconciliation impossible* — unverifiable ≠ success |
| all 500 + an object never requested | 500 | `PARTIAL` | `WARNING: Storage deleted 1 object(s) that were NOT requested: …` |
| `Mark Rows Purged` swallows a 4xx | 0 | `PARTIAL` | dropped: *purged_at written on M kyc_documents row(s) - …* — the delete is irreversible, the mark self-heals, but it is **named** |

In every non-SUCCESS row the unmarked rows stay selectable, so the next run retries them.
That direction self-heals; the old one did not.

---

## 4. Verification performed offline

Node 22 harness (`_sim.mjs`, deleted after the run) executed the four real Code bodies
against stubbed `$input` / `$()` for: 500/500, 250/500, 3/500, 0/500, transport error,
unknown shape, leading-slash & bucket-prefixed names, and an out-of-scope object.
`Summarise Purge.status === Delivery Report.delivery.status` in all eight.

The 28 operations were then replayed against the exported workflow JSON: every
`removeConnection` matched a real edge, every `setNodeParameter` path existed on its
node, 14 → 16 nodes, **no unreachable node, no orphaned connection target**.

---

## 5. y-positions and `executionOrder: v1`

- **The only real fan-out is `Every Night 03:00` → 3 children, and its y-values are
  unchanged**: `Find Expired Documents` −120, `Prune Dedupe Guard` 140,
  `Find Archive Gaps` 380. Branch order therefore stays purge → dedupe prune →
  archive-gap scan. Deliberate: the purge is the compliance-critical branch and should
  run while the 300 s `executionTimeout` budget is fresh.
- **IF outputs are ordered by output index, not by y.** The true branch is drawn above
  the false branch (`Mark Rows Purged` at −260 vs the −120 spine; `Purge Failed` at 0)
  purely so the canvas reads in the order the engine runs.
- **The v1 ordering hazard is designed out, not depended on.** The old failure needed
  output 0 of a *per-item* IF to complete before output 1 threw. `Reconcile Storage
  Deletions` emits one item, so no downstream node fans out and no branch can finish a
  destructive write before its sibling reports the failure. Even if v1 ordering changed,
  the result would be identical.
- New nodes take the vacated `[880, −120]` and `[1100, −120]` slots and extend right on
  the same −120 rail; the two unchanged branches at y 140 / 380 end at x 660, so nothing
  overlaps.
