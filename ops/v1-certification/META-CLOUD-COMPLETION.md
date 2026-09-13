# Meta WhatsApp Cloud — what exists, what is only tested, what has never run

Written 13 September 2026 against the working tree at `14b9744` on
`wip/gate-L9-2026-09-03-continued`. Every line is either **measured here today**,
**quoted from a dated measurement in this repo**, or marked **asserted**. No
n8n API or UI was touched; production Supabase was not queried in this pass —
the database figures below are quoted from `ops/whatsapp-cloud/WAHA-EXIT-PLAN.md`
(8 Sep) and carry that date, not today's.

The one sentence: **the Cloud receiver is a gate with nothing behind it, and the
Cloud sender does not exist at all.**

---

## 1. The three states, kept apart

`implemented` = code exists in this repo.
`tested` = a test harness exercises that code and passes.
`production-proven` = real Meta traffic reached it and a row or a message resulted.

| piece | implemented | tested | production-proven |
|---|---|---|---|
| SHA-256 / HMAC-SHA256, hand-rolled (n8n sandbox has no crypto) | `ops/n8n-whatsapp-cloud/hmac-pure.js` | **yes** — `hmac-pure.test.js`, **9 passed, 0 failed**, run 13 Sep 2026 | partially — on-box self-test `hmac_selftest {vectors:3, failed:0, negative_control_rejects:true}`, execution `10759` |
| `Verify Or Refuse` Code node body | `ops/n8n-whatsapp-cloud/verify-or-refuse.node.js` | **yes** — `verify-or-refuse.test.js` runs the *deployed node body* in a fake `$input`/`$env` harness, **26 passed, 0 failed**, run 13 Sep 2026 | refusals only — executions `11190`, `11191`, `11206` reached `Respond Without Writing` |
| Standalone raw-bytes verifier | `ops/whatsapp-cloud/verify-signature.mjs` | **yes** — **12 passed, 0 failed**, run 13 Sep 2026 | never deployed; it is the reference implementation |
| Webhook GET handshake (`hub.mode`/`hub.verify_token`/`hub.challenge`) | `receiver.sdk.js:9` `Meta Cloud Webhook`, `multipleMethods` | yes (in the 26) | **recorded 8 Sep**: callback verified and subscribed to `messages` |
| Tenant resolution from `metadata.phone_number_id` | `receiver.sdk.js:203` `Resolve Tenant From Phone Number ID` → `nexus_resolve_channel_tenant` | yes, in the DB (registered id → `alba-cars`, one digit off → zero rows) | **NOT RUN** — never reached by a real delivery |
| `Record Channel Event` → `nexus_record_channel_event` | `receiver.sdk.js:250` | **no** — no test covers this node | **NOT RUN**. `channel_message_events` = **0 rows** (8 Sep) |
| `Open Or Extend Customer Service Window` → `whatsapp_record_customer_message` | `receiver.sdk.js:275` | no | **NOT RUN**. `whatsapp_conversation_state` = **0 rows** (8 Sep) |
| Lead creation from a Cloud message | **does not exist** | — | — |
| AI / BDC reply on Cloud | **does not exist** | — | — |
| Inbound media (image, voice) on Cloud | **does not exist** | — | — |
| Delivery-status receiver | `whatsapp_record_delivery_status()` exists in the DB; **nothing calls it** | — | `whatsapp_message_usage` = **0 rows** (8 Sep) |
| **Cloud send** | **does not exist anywhere** — `grep -rl graph.facebook.com` over the repo returns only `ops/lead-simulator/scenarios/c-…` and `d-…`, which are Lead Ads fixtures, not sends | — | — |

47 tests pass across the three suites. **Every one of them stops at the signature
gate.** Nothing past `Verify Or Refuse` has a test, and nothing past
`Verify Or Refuse` has ever executed against a Meta delivery.

### The receiver's terminal nodes, in full
`Respond 200 Recorded` (`:300`), `Respond 200 Unknown Channel` (`:313`),
`Respond Without Writing` (`:352`). Between the gate and those, exactly two
writes. **No send node, no model node, no lead node.** A customer who messages
the Cloud number today gets a `200` and silence.

---

## 2. The defect that fires on the first real message

`ops/n8n-whatsapp-cloud/receiver.sdk.js:265` — confirmed present in the working
tree today:

    p_customer_phone: '+' + $('Verify Or Refuse').item.json.customer_wa_id

`nexus_record_channel_event` passes it through unchanged.
`channel_message_events_customer_phone_is_digits_or_null` is
`customer_phone IS NULL OR customer_phone ~ '^[0-9]{6,20}$'`.
Measured 8 Sep on production, read-only: `'+971556382721'` → false,
`'971556382721'` → true.

So the first genuine customer message raises `23514` at `Record Channel Event`.
That node has `retryOnFail: true, maxTries: 3` (`:251-253`) and **no `onError`**,
so it throws; `Respond 200 Recorded` is downstream and never runs; n8n answers
Meta 5XX; Meta retries and fails identically. The fix is deleting `'+' + ` —
`customer_wa_id` is already Meta's bare E.164 digits. **This is the single
highest-priority code change in the Cloud path**, and it must land before the
first real message, not be diagnosed after one.

Because nothing past the gate is tested, expect more of this shape. The
honest reading: the Cloud receiver is proven at the door and unproven in the
hallway.

---

## 3. Env vars — a conflict this repo has not resolved

| doc | date | claim |
|---|---|---|
| `ops/whatsapp-cloud/README.md` (table) | 7 Sep | `META_APP_SECRET` / `META_WEBHOOK_VERIFY_TOKEN` on the VM **unset** |
| `ops/whatsapp-cloud/WAHA-EXIT-PLAN.md` §2 | 8 Sep | both **are set and reached the worker**; callback verified, subscribed to `messages` |

The 8 Sep measurement is later and more specific, so it stands. But it has not
been re-measured since, and this pass may not touch n8n. **Today's state:
UNKNOWN, last recorded as set on 8 Sep.** Re-measure before assuming.

`META_PAGE_ACCESS_TOKEN` is named in this repo **only for Meta Lead Ads** — a
Page token carrying `leads_retrieval` (`ops/n8n-meta-lead-ads/README.md:171`,
`GO-LIVE.md:207-230`, which itself records that the variable name is *asserted,
not measured*). It is **the wrong token for WhatsApp Cloud send**: Cloud
messaging needs a System User token scoped `whatsapp_business_messaging` against
the WABA, not a Page token. Reusing one for the other will fail with a
permissions error that looks like a bad secret. Name them separately.

---

## 4. The send side — what must be built, in full

Nothing in NEXUS has ever sent on Cloud. This is the largest single gap, and
because WAHA is being decommissioned it is also the one that decides whether the
dealership can reply at all.

### 4a. Endpoint and auth
- `POST https://graph.facebook.com/<vNN.N>/<phone_number_id>/messages`.
  **Pin the API version explicitly** — nothing in this repo pins one today, and an
  unpinned Graph path silently changes behaviour under you.
- `Authorization: Bearer <token>`, `Content-Type: application/json`.
- The token must be a **Meta System User token** against the WABA with
  `whatsapp_business_messaging`. The token the developer UI hands you **expires in
  24 hours** — using it produces a path that works on the day it is built and is
  dead the next morning. Owner's account, owner's action, a secret this agent
  never handles.
- `phone_number_id` must come from the tenant's `channel_registry` row
  (`whatsapp_cloud_phone_number_id`), never from a constant — NEXUS is
  multi-tenant and a hard-coded id sends one dealership's reply from another's
  number.

### 4b. Two body shapes, and they are not interchangeable

Free-form (session) message:

    { "messaging_product": "whatsapp", "recipient_type": "individual",
      "to": "<bare E.164 digits, no +>", "type": "text",
      "text": { "preview_url": false, "body": "…" } }

Template message:

    { "messaging_product": "whatsapp", "to": "<bare E.164 digits>",
      "type": "template",
      "template": { "name": "<approved name>", "language": { "code": "<code>" },
                    "components": [ … ] } }

Note `to` takes bare digits — the same convention `customer_wa_id` already uses,
and the same convention §2's `'+'` defect violates on the inbound side.

### 4c. The 24-hour customer service window, and what happens when it closes

The window is a Meta rule, and NEXUS already models it as one. Measured 8 Sep,
`policy_rule` holds 13 rows, **0 VERIFIED**; six are WhatsApp rules:

- `WA_CUSTOMER_SERVICE_WINDOW_HOURS` = 24 (`PLATFORM_WHATSAPP`)
- `WA_BUSINESS_INITIATED_OUTSIDE_WINDOW_REQUIRES_TEMPLATE`
- `WA_MARKETING_TEMPLATE_REQUIRES_OPT_IN`
- `WA_WINDOW_RESETS_ONLY_ON_CUSTOMER_MESSAGE`
- `WA_FREEFORM_OUTSIDE_WINDOW_ERROR_CODE` = 131047
- `WA_MARKETING_REQUIRES_OPT_IN_EVEN_INSIDE_WINDOW` (`NEXUS_HOUSE` — our stricter rule)

**Open** (a customer message landed within 24 h): free-form text is allowed.
**Closed**: Meta refuses free-form with error **131047**. The only legal send is
an **APPROVED template**, and a `MARKETING` template additionally requires
recorded opt-in. An outbound message **does not** reset the window — only a
customer message does.

The failure mode to design against is not "the send errors". It is **a send seam
that, on a closed window, quietly falls back to free-form and eats a 131047 that
nobody reads.** The seam must branch to a template or **refuse and say so**, and
the refusal must be visible in the product.

Today `whatsapp_policy_decision_for_channel(...)` answers `TEMPLATE_REQUIRED /
CONVERSATION_NOT_MEASURED` to everything, for two independent reasons:
(a) no `whatsapp_conversation_state` row exists — this clears by itself once §2's
defect is fixed and one real message lands; (b) the window rule is
`NOT_VERIFIED` — **this never clears by itself** and needs
`policy_platform_verify_rule()` called by a named human (see `OWNER-STEPS.md`).

### 4d. The policy-gated send seam
`nexus_request_send()` / `nexus_route_message()` already exist and already pick
the carrier, ask the policy engine, refuse a null decision, and write a
`channel_send_directive` row with `provider`, `external_identifier`,
`credential_ref`, `resolved_send_form`, `template_ref` and the verdict.
**Nothing calls them.** `channel_send_directive` = 0 rows (8 Sep).

Build: one n8n subworkflow — `(tenant, customer, intent, body)` →
`nexus_request_send` → branch on `directive` → HTTP send → `nexus_record_send_result(directive_id, 'SENT', <wamid>, …)`.
Call shape: model on `Send to KYC Auditor` (`executeWorkflow`) in the BDC agent.
HTTP node shape: model on `Send via WAHA`
(`n8n-workflows/whatsapp_send_dashboard_reply.json:181`) — `$env` credentials,
`onError: continueRegularOutput`, and a `Delivery Report` node behind it that
inspects the item for `error` rather than assuming a 200 meant delivery.

### 4e. The outbound ledger hole — structural, not a missing node
`channel_message_events` carries
`channel_message_events_cloud_requires_signature`: a `whatsapp_cloud` row
requires `origin_verified = 'hmac_sha256_x_hub'`. That is correct for an inbound
webhook and **impossible for a call we made ourselves**. So Cloud *outbound*
cannot be recorded in `channel_message_events` at all. `channel_send_directive`
is the outbound ledger until the owner of that constraint amends it. Recording
WAHA outbound there while Cloud outbound is refused would produce a record that
reads "we never sent on Cloud".

### 4f. Also missing on the Cloud side
- **Inbound normaliser.** `Extract Message & Sender` parses WAHA's shape
  (`@c.us`, `@lid`, `_data.Info.SenderAlt`, `_data.Message.audioMessage`). None
  of it exists in a Cloud delivery. `Verify Or Refuse` already emits a clean
  normalised item (`customer_wa_id`, `message_id`, `message_kind`, `text`,
  `occurred_at`) — standardise on that and make the WAHA extractor emit it too.
- **Inbound media.** Cloud gives a `media_id` to be exchanged at `/{media_id}`
  for a short-lived URL, then fetched with the bearer token. Two new nodes ahead
  of each existing download.
- **Delivery status.** Subscribe the status field and call
  `whatsapp_record_delivery_status()` — it already takes Meta's `pricing` and
  `conversation` objects verbatim. Without it there is **no cost record at all**.
- **Channel monitoring.** `nexus_infra_health_probe` probes
  `waha:3000/api/sessions/default` and has `activeVersionId: null` — it has never
  been published. The WhatsApp channel is unmonitored today and would still be
  unmonitored after the swap.

### 4g. Provenance that must not be traded away
`channel_provider_rank`: `whatsapp_cloud` rank 10, `is_official_platform = true`;
`waha` rank 90, false. Cloud's `origin_verified` is `hmac_sha256_x_hub` (rank 90)
and **must not** be downgraded to WAHA's `shared_secret_header` (rank 50) to make
one code path serve both. The Meta HMAC is the reason a Cloud row can be trusted
about who sent it; a shared header is not.

---

## 5. Ordered owner steps for Cloud

Each step's *unblocks* and *out-of-order* consequences are in `OWNER-STEPS.md`;
this is the Cloud-only sequence.

1. **Fix `receiver.sdk.js:265`** (drop `'+' + `) and republish the receiver
   workflow. *Verify:* nothing yet — this only stops the first message from
   failing. *Rollback:* republish the previous version; the refusal path writes
   nothing, so a bad version costs refused deliveries, not bad rows.
2. **Set the env vars on the VM** — by name only, never handled here:
   `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, and a **separately named**
   WhatsApp System User token for send (do **not** reuse `META_PAGE_ACCESS_TOKEN`,
   which is the Lead Ads Page token, §3).
3. **Recreate BOTH `n8n` and `n8n-worker`.** This box runs **queue mode**
   (`/rest/settings` → `executionMode: "queue"`, concurrency 2), and a Code
   node's `$env` is read by **`n8n-worker`**. Recreating only `n8n` leaves the
   worker holding the old environment and the receiver still refusing — verifying
   the wrong container is the mistake that cost two days in early September.
4. **Complete webhook verification in the Meta app** — the GET handshake against
   `https://35.224.126.225.nip.io/webhook/whatsapp-cloud-inbound` with the verify
   token. *Verify:* Meta shows the callback verified.
5. **Subscribe the `messages` field** on the WABA. Without the subscription the
   callback is verified and no message is ever delivered — a verified webhook is
   not a subscribed one.
6. **Send one real 1:1 test message** from a verified recipient handset to the
   test number (`+1 555 672-4466`, `phone_number_id` `1306545252542419`) — a 1:1
   chat, not a group, not a status.
   *Verify, and accept nothing less:* an execution reaching `Respond 200
   Recorded`; **one row in `channel_message_events`** with
   `provider = 'whatsapp_cloud'` and `origin_verified = 'hmac_sha256_x_hub'`; and
   **one row in `whatsapp_conversation_state`**. A green execution alone proves
   nothing — see `V1-CERTIFICATION-MATRIX.md` §3.

Only after step 6 has produced those two rows does the Cloud path have any
production evidence at all. Everything before it is a road with no traffic.
