# Google Ads Lead Form receiver — import and go-live runbook

What this file covers: taking `google-ads-lead.workflow.json` from this repo,
getting it into n8n, and getting Google Ads pointed at it **in the one order
that cannot throw away a real customer**.

Authored 16 September 2026. Nothing in this file has been executed. Every step
below is written to be performed by the owner, and every step says what to
check before moving to the next one.

---

## 0. The ordering trap — read this before anything else

**Google Ads retries a 5XX and PERMANENTLY DISCARDS the lead on a 4XX.** There
is no second chance and no dead-letter queue on Google's side. So the order of
the five steps is not a preference, it is the whole safety property:

| if you do this first | the endpoint answers | Google does |
|---|---|---|
| point Google at the URL while the DB endpoint is `disabled` | **403** `GOOGLE_KEY_REJECTED` | **discards the lead forever** |
| point Google at the URL while the env var is unset | **500** `ENDPOINT_SECRET_NOT_CONFIGURED` | holds it and redelivers — safe |
| point Google at the URL while the workflow is inactive | 404 from n8n | discards — treat as unsafe |

Measured on production Supabase on 16 September 2026:
`nexus_lead_endpoint_for_public_key` filters on `e.status = 'active'` **and**
`tenants.status = 'active'`. Tenant A's tenant is already `active`; the endpoint row
`31d6ff9c-a44a-4046-b75f-7d14baac70fb` is **`disabled`**. A disabled endpoint
resolves to zero rows, which is answered `403` — the discard direction. So the
database is enabled **first**, not last.

**The order is: (a) enable the DB endpoint → (b) set the env var on the box →
(c) import and activate the workflow → (d) send Google's test payload →
(e) and ONLY THEN paste the URL into a lead form on a running ad.**

---

## (a) Enable the endpoint row in Supabase

The row already exists. Nothing needs creating; it needs flipping.

```sql
-- look first
select endpoint_id, public_key, secret_ref, environment, status
  from public.lead_ingest_endpoint
 where endpoint_id = '31d6ff9c-a44a-4046-b75f-7d14baac70fb';

-- then enable
update public.lead_ingest_endpoint
   set status = 'active'
 where endpoint_id = '31d6ff9c-a44a-4046-b75f-7d14baac70fb';
```

Check it took, and that the resolver now actually returns a row:

```sql
select endpoint_id, tenant_id, source_key, secret_ref
  from public.nexus_lead_endpoint_for_public_key('alba-prod-google-leadform-0001');
```

**PASS = exactly one row, with `source_key = 'google_ads_lead_form'` and
`secret_ref = 'GOOGLE_LEAD_KEY_ALBA'`.** Zero rows means the receiver will
answer 403 to everything, so do not continue.

---

## (b) Set the secret on the n8n box

The secret is **never** stored in Supabase and **never** in this repo. The
endpoint row only names it: `GOOGLE_LEAD_KEY_ALBA`.

On the VM that runs n8n, add the environment variable to the n8n service (the
compose file's `environment:` block, or the unit's `EnvironmentFile`):

```
GOOGLE_LEAD_KEY_ALBA=<a long random string you generate now>
```

Then **restart n8n** — n8n reads `$env` from its own process, so an unrestarted
box still has it unset. Keep this value where you keep passwords; you will type
it into Google Ads in step (e) and it must match byte for byte.

Check without printing it:

```
docker compose exec n8n sh -lc '[ -n "$GOOGLE_LEAD_KEY_ALBA" ] && echo SET || echo NOT SET'
```

**PASS = `SET`.** (Adjust the command to however n8n runs on that box.)
Today it is **NOT SET**.

---

## (c) Import the workflow and bind its credentials

1. n8n → **Workflows → Import from File** → `google-ads-lead.workflow.json`.

2. **The path collision is the thing most likely to bite you.** This repo's
   README records an already-published workflow, id `EYva4c2bMV5MGq0o`, serving
   the same path `google-ads-lead` on the same box. n8n will not let two active
   workflows own one webhook path. Before activating the import, open the old
   workflow, **read its definition back** (the README says explicitly that the
   repo's generator was once wrong about this very path), and then either
   deactivate the old one or decide the old one is the truth and discard this
   import. Do not run both.

3. Bind credentials. Four nodes are HTTP RPC calls to Supabase and all four
   carry `nodeCredentialType: supabaseApi`, pre-bound to credential id
   `dv4OeARarErZLHCj` ("Supabase account") — the same credential the
   site-enquiry workflow uses. If that credential does not exist on this box,
   the four nodes show unbound and you must pick the Supabase credential
   yourself on each:

   | node | credential | why it needs it |
   |---|---|---|
   | Resolve Endpoint From URL Key | `supabaseApi` | reads the endpoint + `secret_ref` |
   | Record Lead Event | `supabaseApi` | writes door one, idempotent on `lead_id` |
   | Promote To Lead | `supabaseApi` | the only node that creates a row in `leads` |
   | Hold Without Promoting | `supabaseApi` | writes QUARANTINED / REJECTED |

   The two Code nodes need **no** credential. The webhook node has
   `authentication: none` and needs none — Google cannot send a custom header,
   so the body secret is the only authenticator there is.

4. Confirm the webhook node shows path `google-ads-lead`, method `POST`,
   **Raw Body ON**, response mode **Using Respond to Webhook node**. Raw Body is
   load-bearing: `Extract And Shape` reads `item.binary.data` first, and falls
   back to a re-serialised body only if it must.

5. **Activate** the workflow. The file ships `"active": false` on purpose — an
   authored workflow is not a running one, and this repo does not get to claim
   otherwise.

---

## (d) Prove the wire with your own POST, before Google ever sees the URL

Run this from anywhere. Type the secret in yourself; do not paste it into a
chat, a ticket, or this file.

```bash
curl -sS -o /tmp/google-proof.txt -w 'HTTP %{http_code}\n' -X POST \
  'https://35.224.126.225.nip.io/webhook/google-ads-lead?k=alba-prod-google-leadform-0001' \
  -H 'Content-Type: application/json' \
  --data '{
    "lead_id": "nexus-wire-proof-2026-09-16-01",
    "is_test": true,
    "api_version": "1.0",
    "form_id": "0",
    "campaign_id": "0",
    "google_key": "REPLACE_WITH_THE_VALUE_OF_GOOGLE_LEAD_KEY_ALBA",
    "user_column_data": [
      {"column_id":"FULL_NAME","column_name":"Full Name","string_value":"Wire Proof"},
      {"column_id":"EMAIL","column_name":"Email","string_value":"wire.proof@example.com"},
      {"column_id":"PHONE_NUMBER","column_name":"Phone","string_value":"+971500000000"}
    ]
  }'; cat /tmp/google-proof.txt
```

**PASS is all three of these, not just the first:**

1. `HTTP 200` and a body of exactly `ok`.
2. A `lead_event` row for this endpoint in phase **`QUARANTINED`**:

```sql
select event_id, phase, external_event_id, rejection_reason, received_at
  from public.lead_event
 where endpoint_id = '31d6ff9c-a44a-4046-b75f-7d14baac70fb'
 order by received_at desc limit 5;
```

3. **No new row in `leads`.** `is_test: true` is authenticated, recorded, and
   deliberately never promoted — a fake customer must never enter the funnel.

```sql
select count(*) from public.leads;   -- compare to the count you took before
```

Re-run the identical curl once. **PASS = `HTTP 200` again, and still exactly one
`lead_event` row** (the second delivery took the `was_duplicate` branch). That
is the at-least-once property proven rather than asserted.

Failure readings, all of them useful:

| you get | it means | fix |
|---|---|---|
| `404` from n8n | workflow not active, or path collision with `EYva4c2bMV5MGq0o` | step (c) |
| `403 GOOGLE_KEY_REJECTED` | endpoint not `active`, or the key/secret is wrong | steps (a)/(b) — deliberately indistinguishable |
| `500 ENDPOINT_SECRET_NOT_CONFIGURED` | env var unset or n8n not restarted | step (b) |
| `500 ENDPOINT_HAS_NO_SECRET_REF` | the endpoint row names no secret | step (a) |
| `400 ENDPOINT_IS_NOT_A_GOOGLE_ENDPOINT` | that key belongs to a different source | wrong key in the URL |
| `422 Failed to parse request body` | n8n's own parser, before our code | your JSON is malformed |

---

## (e) Only now: paste the URL into Google Ads

On the lead form asset in the dealership's own Google Ads account:

* **Webhook URL:**
  `https://35.224.126.225.nip.io/webhook/google-ads-lead?k=alba-prod-google-leadform-0001`
* **Key:** the exact value of `GOOGLE_LEAD_KEY_ALBA`.

Press **Send test data**. Expect the same PASS as step (d): `200`, a
`QUARANTINED` `lead_event`, no new `leads` row.

A dealer who mistypes the key sees a silent `403` and nothing else — the same
answer as an unregistered key, on purpose, so the key space cannot be
enumerated. Google's own test button is where that shows up, which is why (d)
and the test button both happen before the form is attached to a running ad.

Only after the test button is green should the lead form be attached to a live
campaign.

---

## Two things this receiver does not fix, stated rather than hidden

* **The secret lands in n8n's own execution store.** `google_key` is a plaintext
  field in the body and the webhook node's output item holds the raw body before
  any redaction runs. The redaction keeps it out of Supabase; it cannot keep it
  out of n8n. Mitigate with execution pruning; do not claim it is solved.
* **TLS is the only integrity there is.** Google signs nothing. This endpoint
  must never be reachable over plain HTTP.
