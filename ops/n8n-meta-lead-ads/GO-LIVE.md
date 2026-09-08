# Meta Lead Ads — from a verified handshake to a lead row

**Written 8 September 2026.** The receiver is built, live and fail-closed; the
handshake is done; **no lead has ever arrived**. This file is the remaining path,
in order, with the check for each step. Nothing below is code to write.

`ops/n8n-meta-lead-ads/README.md` is the design and the reasoning. This file is
the sequence. Where the two disagree, the measurement in this file is newer.

ALBA CARS is dealership number one, not the only one. Every statement is written
so a second dealership can follow it: the ALBA-specific values are given, and
each is also given as a lookup that resolves for any tenant.

---

## 0 · The starting state, measured today

Measured on the box and on production Postgres (`dsvuoovivysszdoiorch`),
8 September 2026.

| fact | value | grade |
|---|---|---|
| n8n workflow | `JDqy54w2HUH7pHgW`, **ACTIVE** | measured |
| URL | `POST/GET https://35.224.126.225.nip.io/webhook/meta-lead-ads` | measured |
| `GET` with a wrong verify token | **403 `HUB_VERIFY_TOKEN_MISMATCH`** | measured |
| `POST` with no signature | **401 `SIGNATURE_HEADER_MISSING`** | measured |
| the same two probes before today | `500 APP_SECRET_NOT_CONFIGURED` | measured |
| `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` | set on the VM, and reaching the worker | measured, by the two refusals above |
| `META_PAGE_ACCESS_TOKEN` | **not set** | measured |
| Meta callback verification, Page subscribed to `leadgen` + `leadgen_update` | done by the owner | measured, from executions |
| `lead_ingest_provider_identity` | **0 rows** — no Page is registered against any dealership | measured |
| `lead_event` where `source_key like 'meta%'` | **0 rows** | measured |
| `lead_event`, all sources | 1 row — the walk-in preflight of 7 September | measured |
| `leads` | 5 rows, none from Meta | measured |
| `meta_lead_ads_facebook` endpoint | `4d4f5cf2-f966-4d4e-9d9e-605757c615b7`, `alba-prod-meta-leadads-facebook`, production, **`disabled`** | measured |
| `meta_lead_ads_instagram` endpoint | `ccb32d53-d07b-4e9b-9950-a6c2122ef279`, `alba-prod-meta-leadads-instagram`, production, **`disabled`** | measured |
| `nexus_lead_ingest_invariants()` | 8 PASS, 0 FAIL, 2 INFO | measured |

**The five executions everyone will point at are handshakes, not leads.**
`11193`, `11209`, `11214`, `11217` and `11228` each ran
`Meta Leadgen Webhook → Verify Or Refuse → Signature Verified And Usable? →
Respond Without Writing` and stopped. That is Meta confirming the subscription
and the receiver answering the challenge. Nothing was written, and nothing
should have been. A subscribed Page is not a delivered lead.

**What is still missing is two things, and neither is code:** a Page registered
against the dealership (step 1), and `META_PAGE_ACCESS_TOKEN` (step 3).

---

## 1 · Register the Facebook Page against the dealership

Meta's delivery carries no public key and cannot be made to: the callback URL is
registered once with Meta and is identical for every dealership. The only
per-dealership fact in the body is `page_id`. `page_id` is **public** — anyone
can read it off the Page — so on its own it is a string an attacker chose. What
makes it safe to route on is that it arrived inside a body whose HMAC verified
**and** that it is registered here. Both, in that order, or neither.

### The exact INSERT

For ALBA, with the endpoint id written out:

```sql
insert into public.lead_ingest_provider_identity
  (endpoint_id, source_key, provider, identity_kind, identity_value, label)
values ('4d4f5cf2-f966-4d4e-9d9e-605757c615b7',
        'meta_lead_ads_facebook',
        'meta',
        'facebook_page_id',
        '<the Page id, digits only>',
        'ALBA CARS Facebook Page');
```

For any dealership, resolving the endpoint rather than pasting a uuid — use this
form for dealership number two:

```sql
insert into public.lead_ingest_provider_identity
  (endpoint_id, source_key, provider, identity_kind, identity_value, label)
select e.endpoint_id, e.source_key, 'meta', 'facebook_page_id',
       '<the Page id, digits only>', '<dealership name> Facebook Page'
  from public.lead_ingest_endpoint e
  join public.tenants t on t.id = e.tenant_id
 where t.slug = 'alba-cars'                     -- the dealership
   and e.source_key = 'meta_lead_ads_facebook'
   and e.environment = 'production';
```

### Every column, and what refuses a wrong one

Constraint definitions read from `pg_constraint` on production today.

| column | the value it must carry | what refuses anything else |
|---|---|---|
| `endpoint_id` | the dealership's own production `meta_lead_ads_facebook` endpoint | `lead_ingest_provider_identity_endpoint_fk` — `FOREIGN KEY (endpoint_id, source_key) REFERENCES lead_ingest_endpoint(endpoint_id, source_key)`. A Page cannot be attached to a Google endpoint, or to another dealership's, without matching both halves. `23503` |
| `source_key` | **`meta_lead_ads_facebook`** | the same composite FK, plus `lead_ingest_provider_identity_provider_matches_source`. `23514` |
| `provider` | **`meta`**, lower case, exactly | `CHECK (provider = ANY (ARRAY['meta','google']))`. `'Meta'` is refused. The resolver also lower-cases its *argument*, so a stored capital would never match even if the CHECK let it through. `23514` |
| `identity_kind` | **`facebook_page_id`**, exactly | `CHECK (identity_kind = ANY (ARRAY['facebook_page_id','lead_form_id','google_webhook_id']))`. `23514` |
| `identity_value` | the Page id, **digits only, 5–32 of them**, no prefix, no spaces | `CHECK (identity_value ~ '^[0-9]{5,32}$')`. `23514` |
| `label` | free text, `NOT NULL` | `23502` on a null |
| `status` | omit it — defaults to `active` | `CHECK (status in ('active','disabled'))` |
| `identity_id`, `created_at`, `updated_at` | omit — defaulted | — |

`identity_value` measured against the live CHECK, today:

| candidate | accepted |
|---|---|
| `102938475610293` | yes |
| `ALBA CARS` | **no** — a Page *name* pasted where an id belongs |
| `1234` | **no** — under five digits |
| `fb_102938475610293` | **no** — a prefix is not a Meta id |
| `102938475610293 ` (one trailing space) | **no** |

There is also `lead_ingest_provider_identity_key UNIQUE (provider,
identity_kind, identity_value)`. **Two dealerships cannot register the same
Facebook Page.** That is deliberate: it is not a conflict to resolve at read
time, it is a row that cannot exist. If it fires, one of the two registrations
is wrong and somebody must say which.

### The Page id is not a secret

It is on the Page's About tab and in Business Suite. It may be pasted into a
ticket, a chat, or this repository. Nothing about the security of this path rests
on it being unknown — it rests on the HMAC over the raw bytes and on this
registration row. Do not treat it as a credential and do not put it in `.env`.

### Check

```sql
select * from public.nexus_lead_endpoint_for_provider_identity(
  'meta', 'facebook_page_id', '<the Page id>');
```

**Expected right now: zero rows.** The endpoint is still `disabled`, and the
resolver requires an active identity, an active endpoint and an active
dealership. Zero rows here is the lock working, not a failure. Step 4 turns it
into one row.

To confirm the row itself landed:

```sql
select i.identity_value, i.identity_kind, i.provider, i.status,
       e.public_key, e.status as endpoint_status, t.slug
  from public.lead_ingest_provider_identity i
  join public.lead_ingest_endpoint e on e.endpoint_id = i.endpoint_id
  join public.tenants t on t.id = e.tenant_id;
```

---

## 2 · The two-hop shape, and the phases it forces

Meta's leadgen webhook carries **no customer data at all**. Six identifiers —
`leadgen_id`, `page_id`, `form_id`, `ad_id`, `adgroup_id`, `created_time` — and
no name, no phone, no email. The customer's answers exist in exactly one place:
`GET /v25.0/<leadgen_id>` on the Graph API, which needs `leads_retrieval`, needs
Lead Access Manager access, and **expires**.

That is why `lead_event` has phases at all.

```
webhook  → verify HMAC over the raw bytes            (Verify Or Refuse)
         → page_id → lead_ingest_provider_identity → dealership
         → nexus_record_lead_event                  → phase RECEIVED
         → GET /v25.0/<leadgen_id>                   (the second hop)
         → normalize + allowlist                     (Normalize And Redact)
         → nexus_hydrate_lead_event                 → phase HYDRATED
         → nexus_promote_lead_event                 → phase PROMOTED + leads row
                                                     + audit_log row
```

| phase | what is true | what is not yet true |
|---|---|---|
| `RECEIVED` | the signature verified, the dealership is known, `payload_raw` holds six ids | there is no customer, no `leads` row, nothing a salesperson can see |
| `HYDRATED` | the Graph fetch returned, `hydrated_payload` and `normalized` are set, `hydrated_at` is non-null | still no `leads` row |
| `PROMOTED` | `leads` row exists, `lead_id` and `promoted_at` set, `audit_log` row written | — |
| `EXPIRED` | hop one arrived and hop two can never succeed | there is no lead and there never will be; the reason must be stated |

**How this differs from Google.** `nexus_record_lead_event` sets
`phase = case when p_normalized is null then 'RECEIVED' else 'HYDRATED'` —
measured in the live function body. Google Ads sends the whole lead in one hop,
so its receiver passes a `p_normalized` and the row is **born `HYDRATED`**; door
two is never called. Meta passes `p_normalized => null` and the row is born
`RECEIVED`. One provider skips a phase the other cannot.

Two consequences worth knowing before anything goes wrong:

- **A `RECEIVED` Meta event cannot be promoted.** `nexus_promote_lead_event`
  raises `NX001` with `detail = 'LEAD_EVENT_NOT_HYDRATED'` and the hint
  *"A RECEIVED Meta event holds six ids and no customer. Fetch it from the Graph
  API first."* Measured in the live function. So a broken token cannot produce a
  blank lead — it produces a row that stops.
- **`nexus_hydrate_lead_event` refuses anything that is not `RECEIVED`**
  (`LEAD_EVENT_NOT_AWAITING_HYDRATION`). Re-fetching a lead a salesperson is
  already working from would overwrite what they are reading.

**On the expiry window.** `lead_source_catalogue.evidence_note` for
`meta_lead_ads_facebook` says Meta documents a hard expiry and that *secondary
sources put it at 90 days — a number explicitly not verified against Meta's own
documentation*. Do not repeat 90 days to a dealership from this file or from
that column. What we assert is our own behaviour: an unfetchable lead terminates
at `EXPIRED` with a stated reason and produces no `leads` row.

---

## 3 · `META_PAGE_ACCESS_TOKEN` — the one secret still missing

### Read this before setting it: the repo cannot tell you the variable name

`grep -c META_PAGE_ACCESS_TOKEN ops/n8n-meta-lead-ads/*.js` returns **0** on all
three files — measured today. This directory holds the two **Code** node bodies
(`verify-and-extract.node.js`, `normalize-and-redact.node.js`) and neither reads
a token: hop one has no token, and `Normalize And Redact` receives the Graph
*response* as `$input`, not the credential that fetched it.

The node that reads the token is the **HTTP Request node that performs
`GET /v25.0/<leadgen_id>`**, and its body is **not in this repository**. So the
name `META_PAGE_ACCESS_TOKEN` is **asserted, not measured**. It is asserted in
two places and nowhere else:

- `ops/n8n-meta-lead-ads/README.md`, line 171 — *"`META_PAGE_ACCESS_TOKEN` (a
  Page token with `leads_retrieval`; the short-lived one expires, so a System
  User token is the real answer)"*.
- `ops/GO-LIVE-SEQUENCE.md`, line 216 — *"`META_PAGE_ACCESS_TOKEN` (a System User
  token — the short-lived Page token expires)"*.

**First action of this step: open `JDqy54w2HUH7pHgW` in n8n, open the Graph
fetch node, and read the expression.** Write down the name it actually
references. If it is not `META_PAGE_ACCESS_TOKEN`, everything below uses that
name instead, and the README lines above are wrong and should be corrected in
the same sitting. Setting the variable under a name no node reads produces
exactly the same symptom as not setting it: the fetch runs with an empty token
and every event stops at `RECEIVED`.

### What kind of token

A Page access token with `leads_retrieval`. The short-lived one expires within
hours and the long-lived one within about two months, so **a System User token
is the real answer** — asserted by the README, not measured here. An expiring
token is not a one-off failure: it is a dealership's Facebook leads going quiet
weeks after go-live, with a green "Connected" pill still on the screen.

### If it is unset, wrong, or expired

The Graph API answers `400` with `GraphMethodException` / `OAuthException` rather
than `200`. The receiver has nothing to hydrate with. The event stays at
`RECEIVED`, no `leads` row is created, no `audit_log` row is written, and the
promoter would refuse the row anyway. **The visible symptom is `lead_event` rows
piling up at `RECEIVED` and never advancing** — which is exactly what the
standing query in 6.6 looks for. Nothing errors loudly; Meta got its `200`.

### Set it on the VM, then verify it where it is consumed

Put it in `/opt/nexus/.env` alongside `META_APP_SECRET`, then recreate the
containers. **Recreate `n8n` and `n8n-worker`, both.**

> **The box runs in queue mode, and this already cost a day.** `GET
> /rest/settings` returned `executionMode: "queue"`. In queue mode the **worker**
> executes workflow nodes, so the node reading `$env.META_PAGE_ACCESS_TOKEN` runs
> in `n8n-worker`, not in `n8n`. `docker compose up -d n8n` recreates the
> container you then check and leaves the one that does the work on the old
> value. On the WAHA gate this produced `header_present: true, ok: false` on the
> box's own traffic while `printenv` in the `n8n` container looked perfect — the
> verification and the defect were in different containers.

Verify by fingerprint, never by printing the token:

```bash
docker compose exec -T n8n        sh -c 'printf %s "$META_PAGE_ACCESS_TOKEN" | sha256sum'
docker compose exec -T n8n-worker sh -c 'printf %s "$META_PAGE_ACCESS_TOKEN" | sha256sum'
```

Compare both against the fingerprint of the value you pasted, computed on your
own machine:

```bash
printf %s '<the token>' | sha256sum
```

**All three digests must be identical.** Two rules for reading the output:

- `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` is the
  SHA-256 of the **empty string** (measured). If either container prints that,
  the variable is unset *in that container*.
- If `n8n` and `n8n-worker` disagree, the worker is stale. Recreate it and
  re-read. Do not proceed on the `n8n` container's answer.

> **Which compose file the box runs is not settled by this repository.**
> `docker-compose.single.yml` states in its own comments that it runs in the
> default `regular` mode with no worker and no redis; queue mode can only come
> from `docker-compose.yml`. `docker compose ps` on the VM settles it. If there
> is no `n8n-worker` container, the second command errors, and that error is the
> answer — one container, one check.

### Check

Both fingerprints match the pasted value, and neither is the empty-string digest.
That is the whole check. There is nothing to prove against Meta until step 6
fires a lead — a token cannot be exercised without a `leadgen_id`.

---

## 4 · Enable the two endpoints — and not one minute earlier

```sql
update public.lead_ingest_endpoint
   set status = 'active'
 where public_key = 'alba-prod-meta-leadads-facebook';
```

Instagram is a separate statement, and trap 7 in section 7 says why it
waits:

```sql
update public.lead_ingest_endpoint
   set status = 'active'
 where public_key = 'alba-prod-meta-leadads-instagram';
```

For dealership number two, by tenant rather than by key:

```sql
update public.lead_ingest_endpoint e
   set status = 'active'
  from public.tenants t
 where t.id = e.tenant_id
   and t.slug = 'alba-cars'
   and e.source_key = 'meta_lead_ads_facebook'
   and e.environment = 'production';
```

> ### ⚠ Enabling this before the token exists puts a false "CONNECTED" in front of a dealership
>
> `nexus_lead_source_readiness()` reports **`CONNECTED`** when an **active
> production endpoint** exists for the source — that is the whole test, read from
> the migration body. It does not know whether `META_PAGE_ACCESS_TOKEN` is set,
> whether the Graph hop works, or whether one lead has ever arrived.
>
> These two rows were created `active` on 7 September, the readiness function
> immediately reported Facebook and Instagram as `CONNECTED` to an ALBA session,
> and they were disabled again the same day. That was the correct call and it is
> why they sit `disabled` today. Enabling them while the token is missing gives a
> dealership a green pill over a source where every lead stops at `RECEIVED` —
> the failure that looks like success, which is the thing this whole layer was
> built to make impossible.
>
> **Order: token first (step 3), then this.** The endpoints are the last switch,
> not the first.

### Check

```sql
select * from public.nexus_lead_endpoint_for_provider_identity(
  'meta', 'facebook_page_id', '<the Page id>');
```

**Expected: exactly one row**, carrying the dealership's `tenant_id`,
`source_key = meta_lead_ads_facebook`, `public_key =
alba-prod-meta-leadads-facebook`, `declared_provenance = hmac_sha256_x_hub`,
`environment = production`, `secret_ref = env:META_APP_SECRET`.

The three-way lock is real, and was measured on staging with a positive control:
a disabled page identity, a disabled endpoint, and a suspended dealership each
resolve to **zero rows** while the all-active case resolves to one.

---

## 5 · Fire Meta's Lead Ads Testing Tool

`https://developers.facebook.com/tools/lead-ads-testing`. Select the Page and the
form, and create a test lead.

**What the repo says it does** — `ops/journey-lab/README.md`, the L3 section:

> Pick the page and the form, create a test lead, and Meta delivers a **real
> webhook, signed with a real `X-Hub-Signature-256`, carrying a real
> `leadgen_id`** which the Graph API will then serve field data for. It is the
> whole two-hop, for nothing.

`ops/journey-lab/TEST-MATRIX.md` (T02) says the same: *"Free, no ad spend, fires
the real signed webhook."* No App Review is required for **your own** Page — see
step 8 for the Page you do not own.

**Grade: asserted by the repo, not measured.** NEXUS has never received a Meta
delivery of any kind other than the five subscription handshakes. The first firing
of this tool is the first measurement.

### What to expect, in order

1. **An n8n execution that does not stop at `Respond Without Writing`.** The five
   handshake executions took that branch. A real delivery must reach
   `Record Lead Event`. If it goes to `Respond Without Writing` again, read
   `reason_code` on the `Verify Or Refuse` output: `SIGNATURE_MISMATCH` means the
   app secret is wrong, `WRONG_WEBHOOK_OBJECT` means the WhatsApp and leadgen
   callbacks are crossed in the Meta app config, `NO_PAGE_ID` or `NO_LEADGEN_ID`
   means the delivery carried neither.
2. **A `lead_event` row at `RECEIVED`**, `origin_verified = hmac_sha256_x_hub`,
   `payload_raw` holding six ids and nothing else. If a customer-shaped value
   appears at `RECEIVED`, something invented it — Meta sent none.
3. **The Graph hop, then `HYDRATED`**: `hydrated_at` non-null, `hydration_error`
   null, `normalized` carrying `full_name` and at least one of `email` /
   `phone_e164`.
4. **`PROMOTED`**, a `leads` row, and an `audit_log` row.

### Two things the Testing Tool cannot do

- **It cannot prove a customer's answers arrive intact.** A test lead has no
  person behind it. TEST-MATRIX calls this out: L3 proves the signature, the real
  field names and the real `leadgen_id` against the real Graph endpoint, and not
  that a real form's answers survive.
- **It cannot age a lead**, so the `EXPIRED` branch (T03) cannot be reached this
  way. A bogus `leadgen_id` tests *not found*, which is a different branch. Say
  which one you tested.

### The test lead becomes a real customer row

The endpoint is `environment = production`, the promoter refuses to promote
anything else, and `public.leads` has **no simulation marker** — the promoter
says so in its own refusal hint. So a Testing Tool lead that reaches `PROMOTED`
is a real `leads` row that counts in pipeline value and response-time reporting.
Decide before firing whether that row is deleted afterwards. `lead_event` rows
are never deleted; the arrival stays on the record either way, which is correct.

---

## 6 · The end-to-end proof

Run these in order. A step is not done because it was performed; it is done
because the check passed.

### 6.1 The event and its phases

```sql
select event_id, phase, source_key, external_event_id, origin_verified,
       environment, received_at, hydrated_at, promoted_at,
       hydration_error, disposition_reason,
       hydrated_payload->>'ad_platform'            as ad_platform,
       hydrated_payload->>'ad_platform_confidence' as ad_platform_confidence
  from public.lead_event
 where source_key like 'meta_lead_ads_%'
 order by received_at desc
 limit 5;
```

Expected: **one row**, `phase = 'PROMOTED'`, `origin_verified =
'hmac_sha256_x_hub'`, `environment = 'production'`, `hydrated_at` and
`promoted_at` both non-null, `hydration_error` null.

Read the failures rather than guessing at them:

| what you see | what it means |
|---|---|
| `phase = 'RECEIVED'`, `hydrated_at` null | the second hop never succeeded. Go back to step 3 — token unset, wrong name, or expired |
| `phase = 'HYDRATED'`, `promoted_at` null | the promoter was not called, or it refused. Read its `NX001` detail |
| `phase = 'EXPIRED'` | hop one arrived and hop two cannot ever succeed. `disposition_reason` says so in words |
| no row at all | the delivery never reached `Record Lead Event`. Read the n8n execution, not the database |
| `ad_platform_confidence = 'UNKNOWN'` | normal. Meta returned no `platform` on the lead node; it is **not** guessed from the ad name |

### 6.2 `leads.source` is the origin, not the writer

```sql
select l.id, l.name, l.source, l.tenant_id, l.vehicle_interest,
       e.event_id, e.phase
  from public.leads l
  join public.lead_event e on e.lead_id = l.id
 where e.source_key like 'meta_lead_ads_%';
```

Expected: `l.source = 'meta_lead_ads_facebook'`.

This is the defect the whole ingestion layer exists to fix. Before it,
`select source, count(*) from leads group by 1` on production returned one row —
`nexus-master-router 3`, the name of the **workflow that wrote the rows**. Anything
other than `meta_lead_ads_facebook` here means the origin was lost again.

Instagram-attributed leads still carry `source = meta_lead_ads_facebook` when
they arrived on the Facebook Page's subscription. That is not a bug; see
trap 7 in section 7.

### 6.3 The audit row

```sql
select workflow, status, lead_name, summary, logged_at
  from public.audit_log
 where workflow = 'ingest:meta_lead_ads_facebook'
 order by logged_at desc
 limit 5;
```

Expected: **exactly one row per promoted lead**, `status = 'SUCCESS'`, and a
summary reading

```
Lead <n> arrived through meta_lead_ads_facebook and was promoted.
Event <uuid>, external id <the leadgen id>, origin hmac_sha256_x_hub
(attested by the provider)
```

The row is written inside `nexus_promote_lead_event`, not by this workflow — a
receiver that audits itself audits one receiver, and there are four plus manual
entry. `grep -c audit_log ops/n8n-meta-lead-ads/*.js` returns 0 and that is
correct. The parenthetical is derived from
`lead_provenance_kind.is_externally_attested`; for a walk-in it reads *"(a
person's word, not a signature)"* instead.

**Two rows for one lead is a defect**, not a duplicate log line — it means a
receiver started writing its own audit row again.

### 6.4 The invariants gate

```sql
select * from public.nexus_lead_ingest_invariants();
```

Expected: **8 PASS, 0 FAIL**, and 2 INFO rows. Measured today on production, before
any Meta lead:

| invariant | today |
|---|---|
| A production endpoint never accepts provenance that is not real business | PASS, 0 endpoints |
| A production event never rests on provenance that is not real business | PASS, 0 events |
| No promoted lead came from an unestablished origin | PASS, 0 events |
| No promoted event points at a lead belonging to another dealership | PASS, 0 events |
| Simulator output never carries a production label | PASS, 0 events |
| Manual entry holds no secret and no public origin | PASS, 0 endpoints |
| Every source in the catalogue names a provenance that exists | PASS, 0 sources |
| Every lead carrying an ingestion source is pointed at by the event that made it | PASS, 0 orphans |
| *(INFO)* Share of arrivals that nothing external attested | `1 of 1` |
| *(INFO)* Sources with no public integration | `Dubizzle Motors` |

After one Meta lead the INFO line must read **`1 of 2`** — the walk-in preflight
stays the only unattested arrival, and the Meta lead carries a signature. If it
reads `2 of 2`, the event was recorded on the wrong provenance kind.

This gate can go red. It was sabotaged on purpose with a planted unattributed
promotion and reported one FAIL. A gate that cannot go red is decoration.

### 6.5 Redelivery and idempotency

Meta redelivers. This must be exercised, not assumed.

Count first:

```sql
select count(*) as leads_before from public.leads;
```

Then re-fire the same test lead from the Testing Tool, or let Meta's own retry
land. `nexus_record_lead_event` finds the existing row by
`(tenant_id, source_key, external_event_id)` and returns
`was_duplicate = true` **without raising** — that behaviour exists because
Google permanently discards a lead on a 4XX, and it protects Meta here too.

```sql
-- no duplicate identity was written
select external_event_id, count(*)
  from public.lead_event
 where source_key like 'meta_lead_ads_%'
 group by 1
having count(*) > 1;

-- and no second customer was created
select count(*) as leads_after from public.leads;
```

Expected: **zero rows** from the first query, and `leads_after = leads_before`.

Promoting the same event twice returns `was_already_promoted = true` with the
lead count unchanged — measured on production for the walk-in preflight on
7 September.

### 6.6 Nothing is stuck

Keep this one. It is the standing check that a token has quietly expired:

```sql
select phase, count(*), min(received_at) as oldest
  from public.lead_event
 where source_key like 'meta_lead_ads_%'
 group by phase
 order by phase;
```

Any `RECEIVED` row older than a few minutes is a lead that arrived and cannot be
read. That is the shape of an expired `META_PAGE_ACCESS_TOKEN`.

---

## 7 · Traps

Every one of these has bitten this repository or was found by measurement before
it could.

**1 · `lead_event_payload_carries_no_shared_secret` matches whole words, not
substrings — and a failed insert here throws a real customer away.** The CHECK is
a case-insensitive text match for a quoted `google_key`, `app_secret`,
`client_secret`, `access_token`, `api_key` or `authorization` over the serialised
`payload_raw` and `hydrated_payload`. It does not distinguish a key from a value.
Re-measured against production Postgres today:

| shape | constraint |
|---|---|
| a question label of exactly `api_key` | **REFUSES** |
| `API_KEY` in any case | **REFUSES** |
| a label of `my_api_key` | accepts — a substring never trips it |
| an **answer** of exactly `authorization` | **REFUSES** |
| an answer reading `my api_key is broken` | accepts |
| an answer of `api_key` plus one trailing space | accepts |
| the same answer plus the receiver's stated note | accepts |
| the word four levels deep | **REFUSES** |

**2 · The receiver shipped with this rule wrong, in both directions.** The first
pass guarded question **labels** only, and guarded them with a **substring**
regex. So a real customer whose whole answer was `authorization` would have
failed the insert and been thrown away, while a harmless label like `my_api_key`
— which never trips the constraint at all — was renamed for nothing. One wrong
rule: an embedded word had been measured and the result generalised to every
word. It is now exact-match, applied to values, inside `scrub()`, and the repair
appends a stated note rather than deleting the customer's answer, because one
trailing character is all the constraint needs. Proven on the box both ways:
execution `10879` (old body) produced the bare word and Postgres **refused
`23514`**; execution `10880` (new body) produced the word plus the note,
`annotated_answers: 2`, and would have inserted. `normalized` — the text a
salesperson reads — is a different column the constraint does not cover and is
left exactly as written.

**3 · `vehicle_interest` versus `vehicle_of_interest`.** `public.leads` has
`vehicle_interest`. Every receiver written this week emits `vehicle_of_interest`,
and `nexus_lead_normalized_defect()` never mentions a vehicle, so nothing
complained — every Meta and Google lead would have landed with the vehicle NULL.
The live promoter now coalesces both spellings; read today:

```sql
nullif(btrim(coalesce(r.normalized->>'vehicle_interest',
                      r.normalized->>'vehicle_of_interest', '')), '')
```

Do not "tidy" the receiver to emit `vehicle_interest`, and do not remove the
coalesce. A third spelling would be silent again.

**4 · The HMAC is over the raw request bytes.** Hashing a re-serialised JSON
object never matches. `Verify Or Refuse` refuses with `RAW_BODY_NOT_AVAILABLE`
if the webhook node did not hand it the bytes — if that appears, **Raw Body** is
off on the webhook node. The deeper form of this trap: Meta computes the
signature over an escaped-unicode form of the body, so a verifier that parses
first passes an ASCII test suite and **fails every Arabic customer name in
Dubai**. `lead_provenance_kind.hmac_sha256_x_hub` says so in its own description:
*"a verifier that parses first is not this kind."* To test it, re-sign a
pretty-printed copy of the same JSON and deliver it — verification must fail.

**5 · `external_event_id` refuses per-attempt ids and exactly-13-digit ids.**
Measured against the live CHECK today:

| candidate | accepted |
|---|---|
| `1234567890123456` (a 16-digit leadgen id) | yes |
| `1234567890123` (exactly 13 digits) | **no** |
| `meta_leadgen:1234567890123` | yes |
| `exec-11228` | **no** |
| `nokey:1788700000000` | **no** |
| `tmp-abc` | **no** |

Exactly thirteen digits is a millisecond clock reading, not an identifier, and
the constraint refuses it by name. Meta's `leadgen_id` normally runs longer, but
if one ever arrives at thirteen digits the insert fails `23514` and the lead is
lost. The lead simulator writes `meta_leadgen:<id>`, which clears the rule.
**Whether the live `Record Lead Event` node prefixes or passes the bare
`leadgen_id` is not recorded in this repository** — see Unknowns. The catalogue's
`dedup_field` for both Meta sources is `leadgen_id`, and TEST-MATRIX T02
assertion 5 requires `external_event_id` to be that id and not a delivery id, a
receipt timestamp, or a hash of the body.

**6 · Never claim the identity before the signature verifies.** Writing a
`lead_event` for an unverified delivery is a denial of service on a real
customer, not a tidy-up problem: the identity is claimed, so when Meta's
**genuine** delivery arrives it matches `(tenant_id, source_key,
external_event_id)`, returns `was_duplicate = true`, and is silently dropped. The
same shape as claiming a `wamid` before verifying a WhatsApp delivery. Nothing
looks broken. The receiver's order — verify, resolve the identity, then record —
is the defence, and it must not be reordered for convenience.

**7 · Instagram requires a working Facebook lead first, and must never touch
`source_key`.** Instagram lead ads arrive on the **connected Facebook Page's
`leadgen` subscription**. There is no separate Instagram webhook to wire, and the
webhook body has no platform field, so at `RECEIVED` time nobody can know which
it was. The Graph response often says; it is recorded as `ad_platform` /
`ad_platform_confidence`, additive. Moving the event to the Instagram endpoint
once the platform is known is exactly wrong: `lead_event_identity_key` is
`UNIQUE (tenant_id, source_key, external_event_id)`, so changing `source_key`
makes Meta's redelivery of the same `leadgen_id` look new — **two leads for one
customer**. Fire a real Facebook lead, read what the Graph response actually
contains, and only then decide whether Instagram origin can be established
independently. Absent platform is `UNKNOWN`, never guessed from the ad name.

**8 · Crossed callbacks.** A `whatsapp_business_account` delivery arriving on
`/webhook/meta-lead-ads` is refused by name with `WRONG_WEBHOOK_OBJECT` and
pointed at `/webhook/whatsapp-cloud-inbound`. Both webhooks live in the same Meta
app (`NEXUS for AutoDealers`, `1406045581736122`), so this is the likeliest
configuration mistake. It is refused rather than silently finding no leads, but
it still wastes a day if nobody reads the reason code.

**9 · A Testing Tool lead is a real `leads` row.** See step 5.

**10 · Enabling the endpoint early shows a dealership a green pill over a dead
source.** See step 4.

---

## 8 · App Review and Lead Access Manager — the Page you do not own

Everything above works for a Page **you** administer with the developer account
that owns the app. Selling this product means receiving leads from a
**dealership's own Page**, and that is a different gate — Meta's, not ours. No
engineering work substitutes for it.

From `ROADMAP.md`, item 1 of the ingestion roadmap:

> A Meta app cannot receive `leadgen` webhooks for a real page until it has been
> through App Review for the leads permissions, and the dealership must then grant
> NEXUS lead access on the page through **Lead Access Manager** — a setting inside
> the dealership's own Business Manager that no engineering work can substitute
> for. Both are prerequisites, and both are on Ali and the dealership rather than
> on the repo.

Roughly what each involves:

| gate | whose | roughly what it is |
|---|---|---|
| **Business verification** | Meta's, on Ali's business | Submit the trade licence and business details. `commercial/PILOT-ONBOARDING.md` says Meta takes **2 to 10 working days** for the WhatsApp path and that it is Meta's clock, not ours |
| **App Review for the leads permissions** | Meta's | The app requests `leads_retrieval` and the Page permissions it needs, submits a use-case description and a screencast of the flow, and waits. Meta decides |
| **Lead Access Manager** | the **dealership's**, in their own Business Manager | The dealership grants the app (or the System User) lead access on their Page. Without it the Graph fetch fails with a permissions error even though the webhook arrives |
| **A System User token** | ours | So the fetch does not expire two months after go-live |

`commercial/PILOT-OFFER.md` gives the calendar spread as *"one to three calendar
weeks — the spread is Meta's business verification, not my speed."* **That is a
commercial estimate asserted in the repo, not a measured timeline, and it
describes the WhatsApp Cloud path.** Nothing in this repository has measured how
long Meta takes to review a leads app. Do not quote a number for App Review to a
dealership; say it is Meta's gate and that it is submitted on day one.

One thing already cleared: the privacy policy and terms pages Meta requires are
live and reachable at `/privacy` and `/terms`.

**The order that saves a week.** Fire the Testing Tool against your own Page
first (step 5). It needs none of the gates in this section and it proves the
receiver, the token, the registration and the promoter end to end. Submit
verification and App Review on day one **in parallel**, not after.

---

## 9 · Who does what

| # | step | who | where |
|---|---|---|---|
| 1 | Register the Facebook Page identity | either | a database session as `service_role` |
| 2 | — | — | reading only |
| 3 | Read the Graph node's env-var name in n8n | **the owner** | the n8n UI on the box |
| 3 | Mint the System User token with `leads_retrieval` | **the owner** | Meta Business Manager |
| 3 | Put it in `/opt/nexus/.env`, recreate `n8n` **and** `n8n-worker` | **the owner** | an SSH session on the VM |
| 3 | Compare the two `sha256sum` fingerprints | **the owner** | the same SSH session — the token must not leave the box |
| 4 | Enable the endpoint rows | either | a database session as `service_role` |
| 5 | Fire the Lead Ads Testing Tool | **the owner** | `developers.facebook.com/tools/lead-ads-testing` |
| 5 | Read the n8n execution and its reason code | either | the n8n UI |
| 6 | Every check in the proof | either | a database session |
| 8 | Business verification, App Review, Lead Access Manager | **the owner**, and the **dealership** for Lead Access Manager | Meta Business Manager |

Steps 1, 4 and 6 are pure SQL and can be done from anywhere with a `service_role`
connection. Everything marked *the owner* needs a person with the VM, a Meta
account, or both, and cannot be done from a container. The token itself must
never be pasted into a chat, a ticket, or this repository — only its fingerprint.

---

## Unknowns

Things this file could not settle from the repository or from production, listed
so nobody mistakes an absence for a check.

1. **The env-var name the Graph fetch node actually reads.** The repo holds only
   the two Code node bodies; `grep -c META_PAGE_ACCESS_TOKEN
   ops/n8n-meta-lead-ads/*.js` is 0. The name is asserted by `README.md` and
   `ops/GO-LIVE-SEQUENCE.md` and by nothing that runs. Settle it by opening the
   node before setting anything (step 3).
2. **How the Graph node passes the token** — `access_token` query parameter or an
   `Authorization: Bearer` header, and whether it is an n8n credential rather than
   an env var at all. The lead simulator's scenario C models a query parameter,
   but the simulator is not the workflow.
3. **What the live `Record Lead Event` node passes as `external_event_id`** — the
   bare `leadgen_id`, or the simulator's `meta_leadgen:<id>` form. This decides
   whether a 13-digit `leadgen_id` would be refused `23514`. Read the node.
4. **Whether the box carries the corrected `Normalize And Redact` body.** The
   repo body is fixed and execution `10880` proved the fix on the box on
   7 September, but nothing re-verified the deployed body today.
5. **Whether the box is in queue mode right now.** `executionMode: "queue"` was
   read on 7–8 September for the WAHA gate; `docker-compose.single.yml` declares
   regular mode with no worker. `docker compose ps` settles it and this file does
   not.
6. **Meta's retention window for an unfetched lead.** The catalogue records that
   secondary sources say 90 days and explicitly marks that unverified. Not
   measurable here, and not to be quoted to a dealership.
7. **How long Meta takes for App Review of the leads permissions.** No number in
   this repository describes it. The 2–10 working days figure is business
   verification for the WhatsApp Cloud path, and the "one to three calendar weeks"
   figure is a commercial estimate.
8. **Whether the Graph response for this Page's form carries `platform`.** Until
   a real lead is fetched, `ad_platform_confidence = 'UNKNOWN'` is the only
   honest expectation, and the Instagram question in trap 7 cannot be
   answered.
9. **Whether the Instagram endpoint should ever be enabled.** It shares the
   Facebook Page's subscription and has no transport of its own. It is registered
   and disabled; the decision waits on a real Facebook lead.
