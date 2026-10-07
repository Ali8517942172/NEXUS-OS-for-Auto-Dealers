# Test plan — Meta Lead Ads Testing Tool, no ad spend

`https://developers.facebook.com/tools/lead-ads-testing`. Pick the Page and the
form, create a test lead. Meta delivers a **real webhook, signed with a real
`X-Hub-Signature-256`, carrying a real `leadgen_id`** the Graph API will then
serve field data for. No App Review is needed for a Page **you** administer.

> **The grade of that paragraph is: asserted by the repo, not measured**
> (`ops/n8n-meta-lead-ads/GO-LIVE.md:400-403`). NEXUS has never received a Meta
> delivery other than five subscription handshakes. **The first firing of this
> tool is the first measurement.**

## Read this before firing anything

**A green n8n execution proves none of the hops below it.** An n8n run goes green
when the last node it reached returned without throwing. It does not know whether
Postgres accepted the insert, whether the promoter refused, whether the Bitrix
HTTP call 200'd with an error body, or whether a Slack message arrived in a
channel. This repository already owns that mistake twice: five Slack SUCCESS rows
whose summary is literally `"Completed"` are quoted as proof of delivery and are
not (`ops/evidence-standard/STATUS-LADDER.md:107`, `:171-173`), and on the Cloud
receiver a missed node connection meant every real delivery ran no nodes at all
while returning a healthy-looking `200` (`ops/n8n-meta-lead-ads/README.md:136-137`).
**Every hop below names the table or system that holds its proof. Read that, not
the execution list.**

**A Testing Tool lead becomes a real customer row.** The endpoint is
`environment = production`, the promoter refuses anything else, and `public.leads`
has no simulation marker (`GO-LIVE.md:416-425`). Decide *before* firing whether
that `leads` row gets deleted afterwards. `lead_event` rows are never deleted and
should not be — the arrival stays on the record either way.

## Preconditions, each with its own check

| # | precondition | the check that says it is true |
|---|---|---|
| P1 | Graph node's env-var name known | Open `JDqy54w2HUH7pHgW`, open the `GET /v25.0/<leadgen_id>` node, **read the expression**. The node body is not in this repo (`GO-LIVE.md:225-227`); `META_PAGE_ACCESS_TOKEN` is asserted, never measured (`GO-LIVE.md:219`). Write down the name it really reads. |
| P2 | Token set under **that** name | `sha256sum` fingerprint compared on the VM, in and out of the container. The token never leaves the box. Wrong name = identical symptom to unset: everything stops at `RECEIVED`. |
| P3 | Page registered | `held/20260913120000_enable_meta_lead_ads_facebook.sql` section 1 applied; `nexus_lead_endpoint_for_provider_identity('meta','facebook_page_id','<page id>')` returns **zero rows** — correct while the endpoint is disabled. |
| P4 | Endpoint active | Section 2 uncommented and run; the same call now returns **exactly one row**, `declared_provenance = hmac_sha256_x_hub`. **Do this last.** |
| P5 | Baseline counts recorded | `select count(*) from public.leads;` and `select phase, count(*) from public.lead_event where source_key like 'meta%' group by 1;` — write both down. A delta you did not baseline is not a measurement. |

## The hops, in order, and the evidence each requires

### H1 · Webhook received
**Do:** create the test lead.
**Proof lives in:** the n8n execution list for `JDqy54w2HUH7pHgW`.
**Required:** an execution that does **not** terminate at `Respond Without
Writing`. The five handshakes all took that branch (`GO-LIVE.md:40-46`). If this
one does too, read `reason_code` on the `Verify Or Refuse` output —
`WRONG_WEBHOOK_OBJECT` means the WhatsApp and leadgen callbacks are crossed in
the Meta app (both live in app `1406045581736122`); `NO_PAGE_ID` / `NO_LEADGEN_ID`
mean the delivery carried neither.
**This hop alone proves: transport. Nothing else.**

### H2 · HMAC verified over raw bytes
**Proof lives in:** the `Verify Or Refuse` node output —
`reason_code = SIGNATURE_VERIFIED`, `verdict = ACCEPT`.
**Required:** not `SIGNATURE_MISMATCH` (app secret wrong) and not
`RAW_BODY_NOT_AVAILABLE` (**Raw Body** is off on the webhook node — the hash must
be over the request bytes, never a re-serialised object, `GO-LIVE.md:651-659`).
**Negative control, and do not skip it:** re-sign a **pretty-printed** copy of the
same JSON body and POST it. Verification **must fail**. A verifier that parses
first passes an ASCII suite and then fails every Arabic customer name in Dubai —
`lead_provenance_kind.hmac_sha256_x_hub` says so in its own description.

### H3 · Tenant resolved from `page_id`
**Proof lives in:** `nexus_lead_endpoint_for_provider_identity(...)` returning one
row, and the `Record Lead Event` node receiving a `tenant_id`.
**Required:** resolution happens **after** verification, never before. Recording a
`lead_event` for an unverified delivery claims the identity, so Meta's genuine
delivery then matches `(tenant_id, source_key, external_event_id)`, returns
`was_duplicate = true`, and is **silently dropped** — a denial of service on a
real customer (`GO-LIVE.md:672-680`).

### H4 · `lead_event` at `RECEIVED`
**Proof lives in:** `public.lead_event`.
```sql
select event_id, phase, source_key, external_event_id, origin_verified,
       environment, received_at, payload_raw
  from public.lead_event
 where source_key like 'meta_lead_ads_%'
 order by received_at desc limit 5;
```
**Required:** `origin_verified = 'hmac_sha256_x_hub'`, `environment = 'production'`,
and `payload_raw` holding **six ids and nothing else** — Meta's leadgen webhook
carries no customer data at all (`README.md:17-21`). **If a customer-shaped value
appears at `RECEIVED`, something invented it.**
**Also record `external_event_id` verbatim.** Whether the live node writes the bare
`leadgen_id` or `meta_leadgen:<id>` is **not recorded anywhere in this repository**
(`GO-LIVE.md:784-786`, Unknown 3). This is the moment that question gets answered.
It matters: the CHECK refuses an exactly-13-digit id as a millisecond clock
reading (`GO-LIVE.md:627-645`).

### H5 · Graph API `leadgen_id` fetch
**Proof lives in:** the Graph node's output in the execution, and then `lead_event`.
**Required:** a 200 carrying `field_data`. A 400 here with the event left at
`RECEIVED` is the token — see `FAILURE-MODES.md` F1/F2.
**Not testable this way:** the `EXPIRED` branch. The Testing Tool cannot age a
lead. A bogus `leadgen_id` tests *not found*, which is a **different branch**
(`GO-LIVE.md:406-415`). **Say which one you tested.**

### H6 · Normalization
**Proof lives in:** `lead_event.normalized` and `lead_event.hydrated_payload`.
**Required:** `full_name` present, and at least one of `phone_e164` / `email`
(`normalize-and-redact.node.js:156-165`). A UAE `05x` number must appear as
`+9715…`. `hydrated_payload` must be the **allowlist object**, not a filtered copy
(`:13-28`). Read `field_data_stripped_keys` and
`field_data_stripped_token_shaped_values` — **zero is the healthy answer**
(`:252-259`).
**Read `normalized.message`.** Any form question the normalizer does not recognise
lands there as `question text: answer` (`:150-159`). That is the designed landing
place — confirm the form's non-identity questions actually arrived in it.

### H7 · `HYDRATED`
**Proof lives in:** `lead_event`. **Required:** `hydrated_at` non-null,
`hydration_error` null.
`ad_platform_confidence = 'UNKNOWN'` is **normal and correct** — Meta returned no
`platform` on the lead node, and it is never guessed from the ad name
(`GO-LIVE.md:456-458`). Whether this Page's form carries `platform` at all is
`GO-LIVE.md` Unknown 8, and this firing is what settles it.

### H8 · `PROMOTED`
**Proof lives in:** `lead_event.phase = 'PROMOTED'`, `promoted_at` non-null.
`HYDRATED` with `promoted_at` null means the promoter was not called or refused —
read its `NX001` detail (`GO-LIVE.md:450-451`).

### H9 · `leads`
**Proof lives in:** `public.leads`.
```sql
select l.id, l.name, l.source, l.tenant_id, l.vehicle_interest,
       e.event_id, e.phase
  from public.leads l join public.lead_event e on e.lead_id = l.id
 where e.source_key like 'meta_lead_ads_%';
```
**Required:** `l.source = 'meta_lead_ads_facebook'` — the **origin**, not the
workflow that wrote the row. Before this layer existed, every row on production
said `nexus-master-router 3` (`GO-LIVE.md:475-479`). Anything other than the
source key here means the origin was lost again.
**Check `vehicle_interest` is non-null** if the form asked. The column is
`vehicle_interest`; every receiver emits `vehicle_of_interest`; the promoter
coalesces both and nothing complains if it stops (`GO-LIVE.md:614-626`).

### H10 · Dashboard UI
**Proof lives in:** the screen, opened as a signed-in Tenant A session — and it is
**level 3 evidence at best**, because production has exactly one login and it
belongs to the owner (`STATUS-LADDER.md:27`).
**Required:** the lead visible, attributed to Facebook, with the vehicle and the
`message` extras readable.
**Do not accept the readiness pill as evidence of anything.**
`nexus_lead_source_readiness()` returns `CONNECTED` on the mere existence of an
active production endpoint (`GO-LIVE.md:329-333`) — after P4 it says CONNECTED
whether or not a single lead ever arrives.

### H11 · Bitrix24
**Proof lives in:** `public.audit_log`, and **in Bitrix itself**.
**Required:** an audit row naming a **returned CRM id** (the August rows read
*"Bitrix24 lead created (ID 25)"*). **Expect this to fail.** The last Bitrix
success on this system was **2026-08-19 11:04 UTC**; the workflow has shown 10
FAILED since, last 6 Sep (`STATUS-LADDER.md:106`). Firing a Meta lead does not fix
that, and a green n8n execution will not tell you.
**Second check, and it is the silent one:** the link-back PATCHes
`leads?email=eq.…`. A Meta form that collected a phone and no email gets **no
Bitrix id written back, with nothing logged**. If your test form has no email
field, this hop fails invisibly by design.

### H12 · Slack
**Proof lives in:** **the Slack channel**. Open it and look.
**Required:** a message you can see. An `audit_log` row reading `"Completed"` is
**not** evidence — `STATUS-LADDER.md:171-173` states plainly that no system has
ever observed a Slack message arriving in a channel on this product. If the
channel is empty, record `NOT RUN`, not PASS.

### H13 · `audit_log`
**Proof lives in:** `public.audit_log`.
```sql
select workflow, status, lead_name, summary, logged_at
  from public.audit_log
 where workflow = 'ingest:meta_lead_ads_facebook'
 order by logged_at desc limit 5;
```
**Required:** **exactly one row per promoted lead**, `status = 'SUCCESS'`, summary
naming the event uuid, the leadgen id, and `origin hmac_sha256_x_hub (attested by
the provider)`. Written inside `nexus_promote_lead_event`, not by the receiver
(`GO-LIVE.md:492-496`). **Two rows for one lead is a defect** — it means a receiver
started auditing itself again. This is also the first `audit_log` row anything
named meta/facebook/instagram will ever have written.

## After the hops

### The invariants gate
```sql
select * from public.nexus_lead_ingest_invariants();
```
**Required: 8 PASS, 0 FAIL.** The INFO line *"share of arrivals that nothing
external attested"* must move from `1 of 1` to **`1 of 2`** — the walk-in preflight
stays the only unattested arrival and the Meta lead carries a signature. **`2 of 2`
means the event was recorded on the wrong provenance kind** (`GO-LIVE.md:526-535`).

### Redelivery — exercise it, do not assume it
Re-fire the same test lead, or let Meta's own retry land.
```sql
select external_event_id, count(*) from public.lead_event
 where source_key like 'meta_lead_ads_%' group by 1 having count(*) > 1;
select count(*) as leads_after from public.leads;
```
**Required:** zero rows from the first, and `leads_after` equal to the P5 baseline.
`nexus_record_lead_event` returns `was_duplicate = true` without raising
(`GO-LIVE.md:552-558`).

### Nothing stuck — keep this one permanently
```sql
select phase, count(*), min(received_at) as oldest
  from public.lead_event where source_key like 'meta_lead_ads_%'
 group by phase order by phase;
```
Any `RECEIVED` row older than a few minutes is a lead that arrived and cannot be
read. **That is the shape of an expired Page token** (`GO-LIVE.md:583-588`).

## What a fully green run does and does not license you to say

**Does:** the transport, the signature, the registration, the token, the Graph
hop, the normalizer, all three phases, the promoter and the audit row work on
production for one lead from a Page you administer.

**Does not:** it is **not** REAL TRAFFIC PROVEN. `STATUS-LADDER.md:27` excludes a
provider's test button by name. There is no person behind a test lead, so it
cannot prove a real customer's answers survive (`GO-LIVE.md:406-411`). It says
nothing about a Page you do not own — that needs App Review and the dealership's
Lead Access Manager grant (`GO-LIVE.md:710-751`). And it says nothing about
Instagram, which has no transport of its own.
