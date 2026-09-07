# Google Ads Lead Form receiver — LIVE, and refusing every delivery

n8n workflow `EYva4c2bMV5MGq0o`, published 7 September 2026.
`POST https://35.224.126.225.nip.io/webhook/google-ads-lead?k=<endpoint public key>`

**No lead has ever arrived here.** No Google Ads account is connected, no
endpoint is registered to ALBA, and no per-endpoint secret is set on the VM.

## Measured on the live box, 7 September 2026

| request | answer | Google's reading |
|---|---|---|
| no `k` | `404 NO_ENDPOINT_KEY_IN_URL` | discard |
| `k` malformed | `404 ENDPOINT_KEY_MALFORMED` | discard |
| JSON with no `lead_id` | `400 NO_LEAD_ID` | discard |
| a JSON array | `400 BODY_NOT_A_JSON_OBJECT` | discard |
| unregistered `k` | `403 GOOGLE_KEY_REJECTED` | discard |
| **registered `k`, secret unset** | **`500 ENDPOINT_SECRET_NOT_CONFIGURED`** | **retry — the lead is held** |
| `GET` | `404` from n8n; the webhook is POST-only | — |

The last two rows are the ones worth reading twice, and they needed a registered
endpoint to reach. A `simulation` endpoint was created on production for the
probe, used, and deleted; `nexus_lead_source_readiness()` computed for ALBA's
tenant while it existed returned **`SIMULATION_ONLY`**, never `CONNECTED`, which
is the whole reason a simulation endpoint was safe to use for this. Nothing was
written: `lead_event` still holds exactly one row and `leads` four.

To repeat the probe:

```sql
insert into public.lead_ingest_endpoint
  (tenant_id, source_key, required_provenance_for_source, declared_provenance,
   provenance_counts_as_real, environment, public_key, secret_ref, label)
values ('<tenant>', 'google_ads_lead_form', 'shared_secret_in_body',
        'shared_secret_in_body', true, 'simulation',
        'nexus-google-liveprobe-<date>', 'GOOGLE_LEAD_KEY_DELIBERATELY_UNSET',
        'PROBE ONLY');
```

## The status code is the design, not an afterthought

Google Ads delivers at-least-once, **retries a 5XX and permanently discards the
lead on a 4XX**. So every refusal in this receiver is a decision about a real
customer, and the split is:

* **4XX** — this can never succeed. A forgery, a wrong key, a body with no
  `lead_id`: the retry carries identical bytes and gets an identical answer, so
  holding it helps nobody.
* **5XX** — this is ours to fix. Our secret is unset, our database is down, our
  bug. Google holds the lead and brings it back.
* **200** — accepted, already known, or recorded-and-refused for a stated reason.

The one that looks wrong and is not: an **unconfigured secret answers 5XX**. The
WAHA gate's defect was the opposite — an unset env var made it pass everything
through. This one refuses everything, and refuses in the direction that keeps
the customer.

The one that reads oddly and is deliberate: a form that did not collect enough
to contact anybody gets **200**, with a `REJECTED` lead_event holding the reason.
The delivery was fine; the dealership's lead form is what needs changing, and
answering 4XX would throw away the evidence of that.

## What we do not control

**A malformed JSON body never reaches this code.** n8n parses the body first and
answers `422 Failed to parse request body` with its own message. The outcome
matches what this receiver would have chosen (a 4XX, discarded) — but if a real
Google POST were ever truncated in transit, a retry might have succeeded and
n8n has already discarded it. The `BODY_NOT_JSON` branch survives as a fallback
for a delivery with a different content type; on the live path it is unreachable.

**The secret is in n8n's own execution store.** `google_key` is a plaintext
field inside the body, and the webhook node's output item holds the raw body
before any of this runs. The redaction here keeps it out of Supabase — it does
not and cannot keep it out of n8n. Mitigations are n8n's execution pruning and
the fact that the box is ours; the honest statement is that anyone with the n8n
database has every dealership's Google key for the retention window.

**Nothing enforces `rate_limit_per_minute`.** The column is registered and read;
no limiter uses it.

**What a database error becomes on the wire has not been measured.** All four
HTTP nodes carry `retryOnFail: true, maxTries: 3` and `onError: null`, so a
PostgREST refusal is retried three times and then throws; with
`responseMode: 'responseNode'` the workflow errors before reaching any respond
node, and n8n answers the caller itself. That is believed to be a 500 — the
direction that makes Google hold the lead — but it is **not** in the probe table
above, because reaching `Record Lead Event` over HTTP needs a registered
endpoint and a secret on the VM. Until it is measured, treat the receiver's
status-code discipline as proven up to the secret check and asserted beyond it.

**Concurrency at door one is fixed as of 7 September, and the retry setting is
why it mattered.** `Record Lead Event` retries a lost response, and Google
delivers at-least-once, so two deliveries of one lead genuinely overlap. Five
concurrent backends against the old `nexus_record_lead_event` produced one
insert and **four `23505`** — an exception where the function's own contract
promised `was_duplicate = true`. Migration `20260907190000` uses
`ON CONFLICT ON CONSTRAINT … DO NOTHING` and a re-read; the same race now
returns one new event and four duplicates with no exception. See T21 in
`ops/journey-lab/TEST-MATRIX.md`.

## Two things about the tenant

**The key is in the URL and it is not a secret.** Unlike Meta, Google's webhook
URL is configured per lead form inside the dealership's own Google Ads account,
so the URL is a legitimate place to carry the tenant identifier. It identifies;
it does not authenticate. Everything bearing one stays unauthenticated until the
secret matches.

**The secret belongs to the endpoint, not to the box.** That is why the database
is read *before* the request is authenticated, which is uncomfortable and
deliberate. A single global `GOOGLE_LEAD_KEY` would authenticate first and cost
nothing — and would give every dealership the same secret, so any dealer who
knows their own could post leads into any other dealer's pipeline. That is the
tenancy defect this whole layer exists to remove. The URL key is shape-checked
before any lookup, so an unresolvable probe costs one indexed hit.

An unresolved key and a wrong secret return the **same** 403 with the same body,
so the key space cannot be enumerated. The cost is real and is not hidden: a
dealer who mistypes their key sees a silent refusal. It shows up at
configuration time, on Google's own "send test data" button.

## Google's test button, which must never become a customer

`is_test: true` arrives with a fabricated name and email. It is verified,
recorded as a `lead_event`, and then **QUARANTINED** with a stated reason — never
promoted. That gives the wire a real connectivity proof that cannot put a fake
customer into a dealership's funnel, which is exactly the distinction between
*Received* and *Attributed* that this project keeps having to defend.

## Redaction: an allowlist, and the one door it cannot cover

`payload_raw` is assembled field by field from a named list. It is not Google's
object with the bad parts removed; it is our object with only the parts we asked
for put in — so `google_key`, and anything Google adds to this webhook next
year, cannot arrive by being forgotten.

`user_column_data` is the one branch copied wholesale, because it is the
customer's own answers and they are not ours to edit. `safeCopy()` guards
exactly that branch: it drops keys with credential names, and it repairs the one
string shape the database refuses.

`gcl_id` is kept deliberately. It is an ad-click identifier, not a credential,
and it is the only thing that will ever let a dealership prove to Google that
the click became a sale.

## The constraint that can eat a real lead, re-measured

`lead_event_payload_carries_no_shared_secret` is a text match over the whole
serialised JSON. It needs a real quote on both sides, so what trips it is a
string — key or value, at any depth — that is **exactly** one of the six words.
Measured against Postgres, not reasoned about:

| shape | verdict |
|---|---|
| `column_name` exactly `google_key` | **REFUSED** |
| `column_id` exactly `API_KEY` | **REFUSED** (the match ignores case) |
| `column_name` `my_api_key` | accepted — a substring never trips it |
| an **answer** that is exactly `api_key` | **REFUSED** |
| an answer reading `my api_key is broken` | accepted |
| an answer with the word in escaped quotes | accepted |
| an answer of `api_key` plus one space | accepted |
| the word four levels deep | **REFUSED** |

The fourth row corrects the Meta receiver, which shipped guarding question
*labels* only and guarding them with a *substring* regex — so a real customer
whose whole answer was `authorization` would have failed the insert and been
thrown away, while a harmless label like `my_api_key` was renamed for nothing.
Wrong in both directions out of one wrong rule: an embedded word had been
measured, and the result generalised to every word.

The repair is the smallest thing that clears it. The string keeps the customer's
word and gains a stated note; nothing is deleted and nothing is silently
rewritten. `normalized` — the text a salesperson actually reads — is a different
column the constraint does not cover and is never touched at all.

There is deliberately **no** key-rename branch. All six words are already in
`SECRET_KEYS`, so a key equal to one of them is dropped as a credential before
any repair could run; a rename branch would be unreachable code pretending to be
a defence. Both providers carry the question label as a *value*, so the value
path is the one that fires.

## Tests: 56, all passing

`node ops/n8n-google-lead-form/receiver.test.js` runs the **deployed node
bodies** through a harness faking `$input` / `$env` / `$()`, and the harness
throws if a body references an upstream node the workflow does not have.

Every refusal asserts its **status code** as well as its reason, because getting
the reason right and the number wrong still loses the customer.

## How the repo stays equal to the box

`node ops/n8n-google-lead-form/build-sdk.js` inlines both node bodies into
`receiver.sdk.js` as one string literal per source line. The SDK parser allows a
string literal and `+` and nothing else — no `.join()`, no template literals —
so that is the only available shape. The build then **evaluates its own output
back** and compares it against the source files, and refuses to write if they
differ; an off-by-one in the line splitting broke that on the first attempt,
silently, because the code still looked right.

**It covers the two Code bodies and nothing around them, and that gap was live.**
Read from the published workflow on 7 September, the webhook path on the box is
`google-ads-lead`. `build-sdk.js` — and therefore the generated SDK — said
`google-ads-lead/:key`, the path-parameter form this very file records as
measured-and-404ing. So the file whose job is to keep the repo equal to the box
was wrong about the URL, and the round-trip assertion could not see it, because
a path is scaffolding rather than a body. Corrected in the generator, with the
limit now stated there. A wrong credential name, retry setting or `onError` in
that scaffolding would be equally invisible: **read the published definition
back before trusting this file.**

## What has to happen before this can carry anything

1. A **Google Ads lead form asset** on the dealership's account.
2. Register the endpoint and mint the secret:

```sql
insert into public.lead_ingest_endpoint
  (tenant_id, source_key, required_provenance_for_source, declared_provenance,
   provenance_counts_as_real, environment, public_key, secret_ref, label)
values ('<ALBA tenant id>', 'google_ads_lead_form', 'shared_secret_in_body',
        'shared_secret_in_body', true, 'production',
        '<24-128 chars of [A-Za-z0-9_-], unguessable>',
        'GOOGLE_LEAD_KEY_ALBA', 'ALBA CARS Google Ads lead form');
```

3. On the VM: `GOOGLE_LEAD_KEY_ALBA=<a long random string>`, then restart n8n.
   The secret is **never** stored in Supabase and never in this repo — the
   endpoint row names it, and that is all.
4. In Google Ads, on the lead form asset, set the webhook URL to
   `https://35.224.126.225.nip.io/webhook/google-ads-lead?k=<the public key>`
   and the **Key** to the same value as `GOOGLE_LEAD_KEY_ALBA`.
5. Press **Send test data**. Expect `200`, a `lead_event` in `QUARANTINED` with
   the test reason, and **no** new row in `leads`.
