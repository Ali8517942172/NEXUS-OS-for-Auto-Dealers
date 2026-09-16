# Google Ads Lead Form receiver — what is actually true

Written 16 September 2026. Measured where it says measured, and marked
**NOT RUN** everywhere else. Nothing on this page says PASS on the strength of
having been authored.

The three columns are separate on purpose, because they keep getting collapsed:

* **code exists** — the logic is written down in this repo and runs under test.
* **wired** — it exists as an importable n8n workflow definition in this repo.
  Authored is not imported, and imported is not running.
* **real payload** — a delivery from Google Ads has actually arrived here.

| piece | code exists | wired | real payload |
|---|---|---|---|
| `extract-and-shape.node.js` (door-zero shaping) | YES — 56/56 tests pass, re-run 16 Sep 2026 | YES — embedded byte-identical in `google-ads-lead.workflow.json` | **NO** |
| `verify-and-redact.node.js` (secret compare + redaction) | YES — same suite | YES — embedded byte-identical | **NO** |
| Webhook node, path `google-ads-lead`, raw body ON | YES (authored) | YES | **NO** |
| `nexus_lead_endpoint_for_public_key` RPC node | YES | YES | **NO** — never called from this file |
| `nexus_record_lead_event` RPC node | YES | YES | **NO** |
| `nexus_promote_lead_event` RPC node | YES | YES | **NO** |
| `nexus_reject_lead_event` RPC node | YES | YES | **NO** |
| six `respondToWebhook` nodes / status contract | YES | YES | **NO** |
| importable workflow JSON in this repo | YES — 18 nodes, parses, no dangling refs | YES | **NO** |
| workflow imported into the n8n box | — | **NOT RUN** — this file's author did not touch the box | **NO** |
| workflow active on the box | — | **NOT RUN** | **NO** |
| `GOOGLE_LEAD_KEY_ALBA` set on the box | — | **NOT SET** (as of the last recorded check) | — |
| ALBA endpoint row enabled | row exists | **`status = 'disabled'`** — measured 16 Sep 2026 | — |
| Google Ads lead form pointed at this URL | — | **NOT RUN** | **NO** |

## The count, which is the only number that settles it

Measured against production Supabase `dsvuoovivysszdoiorch` on 16 September 2026,
read-only:

* `lead_event` rows for endpoint `31d6ff9c-a44a-4046-b75f-7d14baac70fb`: **0**
* `lead_event` rows in the whole table: **1**, and it is `walk_in` / `PROMOTED`.
* Google deliveries ever received, test or real: **0**.

**No Google Ads delivery has ever reached this system.** Not a test-button
delivery, not a real customer. The receiver is authored and tested; it has never
been fed by Google.

## The endpoint row, measured 16 September 2026

| field | value |
|---|---|
| `endpoint_id` | `31d6ff9c-a44a-4046-b75f-7d14baac70fb` |
| `tenant_id` | `fff6a2b5-cfd5-4460-8383-875bc5826de0` (tenant status `active`) |
| `source_key` | `google_ads_lead_form` |
| `environment` | `production` |
| `status` | **`disabled`** |
| `public_key` | `alba-prod-google-leadform-0001` |
| `secret_ref` | `GOOGLE_LEAD_KEY_ALBA` |
| `ingest_address` | NULL |

All four RPCs exist with the argument names this workflow sends, and all four
return `SETOF` / `TABLE` — verified read-only, same date:

```
nexus_lead_endpoint_for_public_key(p_public_key text)
  -> TABLE(endpoint_id, tenant_id, source_key, declared_provenance, environment,
           secret_ref, origin_allowlist, rate_limit_per_minute, delivery_shape, dedup_field)
nexus_record_lead_event(p_public_key, p_external_event_id, p_origin_verified,
                        p_payload_raw, p_occurred_at, p_normalized)
  -> TABLE(event_id, tenant_id, phase, was_duplicate, source_key)
nexus_promote_lead_event(p_event_id uuid) -> TABLE(event_id, lead_id, was_already_promoted)
nexus_reject_lead_event(p_event_id uuid, p_phase text, p_reason text) -> TABLE(event_id, phase)
```

## The webhook path is unverified against the live box

The path in this workflow is `google-ads-lead`, taken from `build-sdk.js` and
from the README's record of what was read off the published workflow on
7 September 2026. **It has not been re-verified against the box by this author,
who is not permitted to touch it.** The README itself records that the
generator was once wrong about exactly this line — it said
`google-ads-lead/:key` while the box said `google-ads-lead` — and that the
round-trip check covers the two Code bodies and nothing around them. So the path,
the credential id, the retry settings and `onError` in this JSON are **asserted
from the repo, not measured from the box.** Read the published definition back
before trusting any of them.

Related and unresolved: the README records a workflow `EYva4c2bMV5MGq0o`
already published on that box serving this same path. Importing this file
creates a **second** workflow claiming `google-ads-lead`. Two active workflows
cannot own one webhook path. Which of the two is the truth has **NOT** been
determined here.

## What this JSON is, precisely

`google-ads-lead.workflow.json` — 18 nodes, `"active": false`, parses, every
connection target exists, every node reachable from the single trigger, every
`$('Node Name')` reference (`Extract And Shape`, `Verify And Redact`,
`Record Lead Event`) resolves to a node that is present, both IF outputs wired
on all five IF nodes.

The two Code bodies were inserted programmatically from the `.js` files and
compared back byte for byte (6,936 and 13,944 bytes, identical). The `.js` and
`.test.js` files were not modified.

The node graph, node types, typeVersions, RPC URLs, jsonBody expressions, retry
settings and response bodies are transcribed from the scaffolding already in
`build-sdk.js`, which is the nearest thing this repo has to a definition of the
published workflow.

**Deviations from that scaffolding, all of them additions, none silent:**

1. Each IF node's `conditions.options` gained `"version": 2`, and each condition
   gained an `id`. `build-sdk.js` omits both; every IF node in
   `ops/site-enquiry/` and `ops/whatsapp-cloud-send/` carries them, and n8n's
   filter component v2 keys its comparison semantics off that version field.
2. Each IF node gained `"options": {}` at parameter level, matching
   `ops/whatsapp-cloud-send/send.workflow.json`.
3. The four HTTP nodes are pre-bound to Supabase credential id `dv4OeARarErZLHCj`
   ("Supabase account"), the id used by `ops/site-enquiry/`. `build-sdk.js`
   names no credential. **Whether that id exists on the box is NOT RUN.**
4. Node ids, canvas positions, `webhookId`, `settings`, `meta`, `tags`,
   `pinData` and per-node `notes` were added — an SDK graph has none of these
   and an n8n import wants them.
5. `onError` is set on no node, matching the README's statement that all four
   HTTP nodes run with `onError: null`. A PostgREST refusal therefore retries
   three times and then throws, and n8n — not a respond node — answers the
   caller. The README says that is *believed* to be a 500. It is still believed,
   not measured.

## Things in the existing code worth knowing, which were not touched

Per instruction, nothing in the `.js` or `.test.js` files was changed. Two
observations, neither of them a defect found in the logic:

* **The node order is not the one a reader expects, and the code is right.**
  `Verify And Redact` takes the *resolved endpoint row* as its own input and
  reaches back for the delivery via `$('Extract And Shape')`. So the chain is
  Webhook → Extract And Shape → Resolve Endpoint → Verify And Redact, not
  Webhook → Verify → Resolve → Extract. Any description with Verify before
  Resolve is wrong about this workflow, and the workflow JSON follows the code.
* **`$('Extract And Shape').item` depends on n8n's paired-item tracing surviving
  the HTTP Request node in between.** With one endpoint row returned it resolves;
  if the resolver ever returned more than one row for a key, `.item` can fail
  with "can't determine which item to use". `public_key` is unique in practice,
  so this is a latent edge rather than a live fault — **NOT RUN**, and noted
  rather than fixed.

## What would move a row in the first table

Nothing here. The only thing that turns any **NO** in the "real payload" column
into a YES is a delivery arriving from Google Ads, and the only thing that turns
"wired" into "running" is an import and an activation on the box. Follow
`IMPORT-RUNBOOK.md` in the stated order; the order is what protects the first
real customer from being answered `403` and thrown away.
