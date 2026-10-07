# Test plan — proving the Google Ads lead form path with a test lead

Google Ads lets you send a **test lead** from the lead form asset itself, with no
campaign running and no money spent. That is the instrument this plan uses. It
is the only way to exercise the real wire — the real URL, the real key, the real
secret, the real database — without putting a fabricated customer in front of a
salesperson, because `is_test: true` is recorded and then **QUARANTINED, never
promoted** (`ops/n8n-google-lead-form/receiver.sdk.js` — the `Hold Without
Promoting` node calls `nexus_reject_lead_event`).

## Read this first

**A green n8n execution proves nothing downstream of n8n.**

The workflow's last four nodes are `respondToWebhook`. An execution shows green
when the receiver answered Google — not when a row landed, not when a lead was
created, not when anyone was told. Worse: all four HTTP nodes carry
`retryOnFail: true, maxTries: 3`, so a green execution is also compatible with a
database call that failed twice. Every hop below therefore names **the table or
the artefact that holds the evidence**, and the n8n execution is evidence of
exactly one thing: that a request reached the box and got an answer.

## Preconditions

1. The held migration `held/20260913T170000Z_enable_google_ads_lead_form.sql`
   has been applied. Until then the endpoint is `status='disabled'`,
   `nexus_lead_endpoint_for_public_key()` returns zero rows, and **every**
   delivery is answered `403` and permanently discarded by Google.
2. The secret is set on the n8n VM under the exact name in
   `lead_ingest_endpoint.secret_ref`. Until then the receiver answers
   `500 ENDPOINT_SECRET_NOT_CONFIGURED` (measured 7 Sep 2026).
3. Record the "before" counts, so every assertion below is a delta and not a
   vibe:

```sql
select count(*) from public.lead_event;                              -- expect 1
select count(*) from public.leads;                                   -- record it
select count(*) from public.audit_log where workflow like 'ingest:google%';  -- expect 0
```

## The steps

**Step 1 — paste the URL into the lead form asset.**
Google Ads → Assets → the lead form asset → *Lead delivery option* → webhook.
Webhook URL:
`https://35.224.126.225.nip.io/webhook/google-ads-lead?k=alba-prod-google-leadform-0001`
Key: the same secret value that is set on the VM. Save.

**Step 2 — press "Send test data".**
Google posts one delivery with `is_test: true` and a fabricated name and email.
If Google reports the webhook as failing, stop and read the status code against
`STATUS-CODE-CONTRACT.md` before changing anything — the number tells you which
hop refused and whether Google kept or destroyed the lead.

## The evidence, hop by hop

| Hop | What to check | Where the evidence lives | What a pass looks like |
|---|---|---|---|
| 1. Webhook received | n8n execution list for workflow `EYva4c2bMV5MGq0o` | n8n execution store **only** | One execution exists. This proves the request arrived. It proves nothing else |
| 2. Key resolved to a tenant | output of the `Resolve Endpoint` node | n8n execution; confirm against `public.lead_ingest_endpoint` | One row, and its `tenant_id` is Tenant A's. Zero rows means the migration was not applied, or the tenant is not `active` |
| 3. Body secret verified | output of `Verify And Redact` | n8n execution | `verdict` starts with `ACCEPT`. Anything else: read `reason_code`, not the HTTP code alone |
| 4. Normalisation | `normalized` and `normalized_defect` in the same node output | n8n execution, then `public.lead_event.normalized` | For a test lead, whatever Google fabricated. `stripped_secret_keys` / `annotated_values` show the redaction ran |
| 5. `lead_event` written | the row itself | **`public.lead_event`** | `select event_id, source_key, phase, origin_verified, external_event_id from public.lead_event where source_key='google_ads_lead_form';` → one new row. Count goes 1 → 2. `phase` is **`QUARANTINED`** for a test lead, and `origin_verified='shared_secret_in_body'` |
| 6. `leads` | the absence of a row | **`public.leads`** | **The count must NOT change.** A test lead becoming a `leads` row is a failure, not a success — it means the `is_test` guard did not hold and a fabricated customer entered the funnel |
| 7. HTTP status on the wire | Google Ads' own webhook status, plus the response code in the n8n execution | Google Ads UI + n8n | `200`. **While you are here, measure the unmeasured cell:** stop PostgREST (or point the credential at a dead URL), send a second test lead, and record what n8n actually answers when `Record Lead Event` throws. `STATUS-CODE-CONTRACT.md` row 16 asserts 5XX and has never proven it. If it is a 4XX, that is a P0 — every database blip destroys real enquiries |
| 8. UI | the executive dashboard leads screen | `public.leads` via the dashboard | **Nothing new appears**, for the same reason as hop 6. The test lead is visible only through `lead_event` / `v_lead_origin`, which carry `is_test_traffic` |
| 9. Bitrix24 | — | — | **NOT APPLICABLE — this hop does not exist.** The receiver graph ends at `respondToWebhook`; nothing calls `wf_108_erp_sync_bitrix24_crm.json`, and its backlog fetch filters `status=eq.HOT` while promotion writes `status='new'`. Do not mark this hop untested; mark it unbuilt |
| 10. Slack | — | — | **NOT APPLICABLE — this hop does not exist.** No Slack node in `ops/n8n-google-lead-form/`, no edge to any Slack workflow |
| 11. `audit_log` | the row | **`public.audit_log`** | For a **test** lead: **no row**, because the audit row is written inside `nexus_promote_lead_event` and a test lead is never promoted. This is correct and it is also the limit of what a test lead can prove |

## The second run: the only way to prove a real lead

A test lead cannot prove hops 6, 8 and 11, because it must never be promoted.
The only honest proof of those is a **real submission through a real ad**, after
which:

```sql
select l.id, l.name, l.source, l.status, e.phase, e.promoted_at
  from public.leads l join public.lead_event e on e.lead_id = l.id
 where e.source_key = 'google_ads_lead_form';

select workflow, status, summary, created_at
  from public.audit_log
 where workflow = 'ingest:google_ads_lead_form';
```

Pass: one `leads` row with `source='google_ads_lead_form'` and `status='new'`,
its `lead_event` at `phase='PROMOTED'`, and exactly one `audit_log` row whose
summary names the lead id, the event id, the external id and the origin. Until
those three queries return rows, the correct word for this path is **NOT RUN**.

## Duplicate delivery — worth forcing, cheap to force

Google is at-least-once. Press "Send test data" twice. The second delivery must
answer **200** and must **not** add a `lead_event` row: `nexus_record_lead_event`
returns `was_duplicate = true` and the `Already Have This Lead?` branch responds
without touching the stored row. If the second delivery adds a row, the dedup key
(`external_event_id` = Google's `lead_id`) is not being sent, and every retry
Google makes will create a duplicate customer.
