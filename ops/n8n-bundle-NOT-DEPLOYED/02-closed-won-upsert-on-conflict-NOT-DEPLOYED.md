# 02 — Closed-Won `Upsert Vector` has **no** `on_conflict` at all — **NOT DEPLOYED**

**The source note was wrong about this one.** `n8n-quarantine-change-NOT-DEPLOYED.md`
lists three outstanding `?on_conflict=` edits. Checked against the live published
definitions today, **two of the three are already applied** and the third is not
the edit described.

| workflow | node | note said | **live today** |
|---|---|---|---|
| Master Router `JnlZFAVmFAuNXVya` | `Persist Lead (deterministic)` | `?on_conflict=email` → `tenant_id,email` | **already `?on_conflict=tenant_id,email`** — done, no action |
| Customer 360 `AZkGM5M4c1uzSH7S` | `Supabase - Upsert Profile` | `?on_conflict=customer_id` → `tenant_id,customer_id` | **already `on_conflict=tenant_id,customer_id`** (as a query parameter, not in the URL) — done, no action |
| Closed-Won `dhy2DDjWUqwuzHLW` | `Supabase (Postgres) - Upsert Vector` | `?on_conflict=deal_id` → `tenant_id,deal_id` | **no `on_conflict` anywhere on the node** — this is the only real change, and it is an *add*, not an edit |

Telling Ali to change `?on_conflict=email` to `?on_conflict=tenant_id,email` would
have him hunt for a string that is not there.

---

## The change

| | |
|---|---|
| workflow | `dhy2DDjWUqwuzHLW` — Sync Closed-Won Deals to Supabase pgvector (`active: true`, `versionId == activeVersionId == 77c4fa5b-4bc8-4bc7-80c2-30ef03a23874`) |
| node | `Supabase (Postgres) - Upsert Vector` (`n8n-nodes-base.httpRequest`) |
| field | `parameters.url` |

**Before** (verbatim, live):

```
https://dsvuoovivysszdoiorch.supabase.co/rest/v1/deals_embeddings
```

**After:**

```
https://dsvuoovivysszdoiorch.supabase.co/rest/v1/deals_embeddings?on_conflict=tenant_id,deal_id
```

Nothing else changes. The node keeps `Prefer: resolution=merge-duplicates,return=minimal`,
`retryOnFail: true`, `maxTries: 3`, `onError: null`, and its body expression:

```
={{ '{"deal_id":' + JSON.stringify(String($json.dealId)) + ',"content":' + JSON.stringify($json.dealText) + ($json.tenant_id ? ',"tenant_id":' + JSON.stringify(String($json.tenant_id)) : '') + ',"embedding":' + $json.embedding + '}' }}
```

## Why it matters more than "tenancy hygiene"

The target index exists and is already tenant-scoped:

```
deals_embeddings_tenant_deal_id_key  UNIQUE (tenant_id, deal_id)
```

`deals_embeddings` columns: `id uuid, deal_id text, content text,
embedding vector(1536), created_at timestamptz, tenant_id uuid`.

With **no** `on_conflict`, PostgREST resolves `merge-duplicates` against the
primary key, `id` — which the body never supplies, so it never collides. The
`Prefer` header is therefore inert and the request behaves as a plain INSERT.
Re-submitting a deal that already has an embedding row hits
`deals_embeddings_tenant_deal_id_key` and returns **409 / SQLSTATE 23505**.

And this node is `onError: null` — i.e. n8n's default, **stop the workflow**. It
retries 3× and then fails the run, so `Delivery Report` → `Audit Log` →
`Respond to Webhook` never execute and the dashboard's closed-won submission gets
no response at all.

**Stated as inference, not measurement:** `dhy2DDjWUqwuzHLW` has **zero retained
executions**, so I could not observe this happening. It is read from the
definition and the catalogue, not from a run. `CLAIM.md`'s "submitted four times,
one row, idempotency is proven" is about `Record Purchase`, which *does* carry
`resolution=ignore-duplicates` and a `purchase_history` key — a different node.

## What breaks if applied out of order

Nothing depends on this and it depends on nothing. It is second only because it
is cheap, reversible, and touches no customer-visible path. Do **not** defer it
behind the WhatsApp work: it is the one change here that may already be failing a
live dashboard action.

## Verify

See `VERIFY.md` §02. Database witness, not a screenshot.

## Roll back (under a minute)

Delete `?on_conflict=tenant_id,deal_id` from the URL and republish. The node
returns to exactly today's behaviour.
