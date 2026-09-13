# V1 certification matrix — seven channels, and what each has actually proven

Written 13 September 2026 against `14b9744`. Every cell is an **evidence id**
(row id, execution id, `audit_log` id, commit) or the literal word **NOT RUN**
(the thing exists but has never been exercised) or **UNKNOWN** (nobody has
measured it). **No cell says PASS without an evidence id, and none of them do.**

Column meanings, held strictly apart:

- **IMPLEMENTED** — code or a database row exists in this repo / this database.
- **DEPLOYED** — it is live on the box or active in production, reachable.
- **REAL TRAFFIC PROVEN** — a genuine external event reached it and it did
  something. A test fixture is not real traffic.
- **END-TO-END VERIFIED** — that real event completed the full chain in §2 and a
  human confirmed the far end.
- **COMMERCIALLY VALIDATED** — a paying dealership relied on it and it held.

---

## 1. The matrix

| channel | IMPLEMENTED | DEPLOYED | REAL TRAFFIC PROVEN | END-TO-END VERIFIED | COMMERCIALLY VALIDATED |
|---|---|---|---|---|---|
| **Website / Gmail** | partial — no `lead_ingest_endpoint` row for a website source exists (5 rows total, none website); Gmail path is a sibling agent's work in `ops/site-enquiry/`, **not present in this tree** | form is live on the site | **NOT RUN** — commit `14b9744` (12 Sep): the live-site form was filled by hand and returned **503**, five days after the path was called done | NOT RUN | NOT RUN |
| **WhatsApp Cloud** | receiver yes — `ops/n8n-whatsapp-cloud/{hmac-pure.js, verify-or-refuse.node.js, receiver.sdk.js}`; **no sender anywhere**; defect live at `receiver.sdk.js:265` | workflow `J8MXprxVw1yhjBpp`, ACTIVE, `POST/GET /webhook/whatsapp-cloud-inbound`; `channel_registry` `9129126e-da78-4340-a89d-ca703b9fc169` → `alba-cars` (prod), `7f858868-8dd4-4391-a655-89570d9bf45a` → `staging-alpha` | **NOT RUN** — executions `11190`, `11191`, `11206` are handshakes and refusals; all three ended at `Respond Without Writing`. `channel_message_events` = 0 rows (8 Sep) | NOT RUN | NOT RUN |
| **Facebook Lead Ads** | `lead_ingest_endpoint` row exists, source `meta_lead_ads_facebook` | **disabled** | **NOT RUN** — nothing named meta/facebook has **ever** written an `audit_log` row | NOT RUN | NOT RUN |
| **Instagram** | `lead_ingest_endpoint` row exists, source `meta_lead_ads_instagram` | **disabled** | **NOT RUN** — nothing named meta/instagram has ever written an `audit_log` row | NOT RUN | NOT RUN |
| **Google Ads lead form** | `lead_ingest_endpoint` row exists, source `google_ads_lead_form`, **`ingest_address` is null** — there is no address to post to | **disabled** | **NOT RUN** — nothing named google has ever written an `audit_log` row | NOT RUN | NOT RUN |
| **Walk-in** | `lead_ingest_endpoint` row, source `walk_in`, `ingest_address = dashboard://lead-drawer` | **active** | **partial** — 1 of the 6 rows in `leads` is a walk-in, and it is the **7 Sep preflight fixture**, the same event as the single `lead_event` row. Staff-entered, not a walked-in customer | NOT RUN | NOT RUN |
| **Phone call** | `lead_ingest_endpoint` row, source `phone_call`, `ingest_address = dashboard://lead-drawer` | **active** | **NOT RUN** — zero of the 6 `leads` rows are `phone_call` | NOT RUN | NOT RUN |

### What the whole-system totals say
- `lead_ingest_endpoint`: **5 rows**. Two active, three disabled. **No website
  endpoint and no `whatsapp_cloud` endpoint exists at all** — those two channels
  cannot currently produce a lead by design, not by outage.
- `lead_event`: **1 row, ever** — 7 Sep, the preflight fixture.
- `leads`: **6 rows** — 5 WhatsApp (WAHA-era), 1 walk-in preflight.
- **Nothing named meta / google / facebook / instagram / web has ever written an
  `audit_log` row.** Five of the seven channels above have no footprint in the
  audit trail whatsoever.
- Slack last ran **2026-09-06 15:02:53**. Bitrix24 ERP Sync last ran **2026-09-06
  15:02:34**. Both are seven days silent as of today.
- `channel_message_events`, `whatsapp_conversation_state`,
  `whatsapp_customer_message_seen`, `whatsapp_opt_in_event`,
  `whatsapp_message_usage`, `channel_send_directive`, `whatsapp_templates`:
  **0 rows each** (8 Sep). The entire messaging layer is empty.
- The one genuine WhatsApp **send** on record is WAHA, 2 Sep 2026, 17.8 s,
  `MEASURED_HERE` in `channel_provider_capability` for `waha / FREEFORM_TEXT`.
  It is the only proof of any outbound message in this system, and it belongs to
  the provider being decommissioned.

**This matrix has thirty-five cells and not one of them is a PASS.** That is the
correct answer today. A matrix that looked better would be a worse instrument.

---

## 2. The certification chain, and where the proof lives

A row is certified when it completes **every** hop below and can name the
artefact at each. A missing artefact at any hop breaks the chain — the hops after
it are unproven regardless of what they appear to show.

| # | hop | what it means | where the proof lives |
|---|---|---|---|
| 1 | **SOURCE** | an external party did something | the provider's own record: a Meta delivery, a Google lead-form submission, an SMTP message-id, a staff entry in the lead drawer |
| 2 | **AUTH** | we proved *who* sent it, cryptographically or not at all | `channel_message_events.origin_verified` — `hmac_sha256_x_hub` (rank 90, Meta HMAC) for Cloud; `shared_secret_header` (rank 50) for WAHA. **These are not interchangeable and Cloud must never be downgraded to the WAHA form** |
| 3 | **TENANT** | the event was attributed to one dealership, from a field the *caller cannot choose* | `channel_registry` + `nexus_resolve_channel_tenant()`. Cloud resolves from `metadata.phone_number_id` inside a verified body. Compare `/webhook/whatsapp-inbound`, which takes its tenant from `body.session` — a field the caller supplies — and writes as `service_role` (`BYPASSRLS`) |
| 4 | **CUSTOMER** | a person exists and is the same person next time | `customers` / `whatsapp_contacts`. **Schema design here is explicitly paused** — record what exists, do not migrate it |
| 5 | **CONVERSATION** | a thread with a measured 24-hour window | `whatsapp_conversation_state` (+ `whatsapp_customer_message_seen` as the redelivery guard). **0 rows** — every conversation currently answers `CONVERSATION_NOT_MEASURED` |
| 6 | **LEAD** | commercial intent recorded and attributable to a source | `leads` + `lead_event` + `lead_ingest_endpoint`. **1 `lead_event` row ever**, so the attribution trail exists for exactly one fixture |
| 7 | **AI / POLICY** | a decision was made and it was allowed | `policy_rule` (13 rows, **0 VERIFIED**), `policy_platform_attestation` (**0 rows**), `whatsapp_policy_decision_for_channel(...)`. Everything answers `TEMPLATE_REQUIRED / CONVERSATION_NOT_MEASURED` today |
| 8 | **N8N** | the workflow ran | the n8n execution id. **See §3 — this is the weakest evidence in the chain** |
| 9 | **BITRIX24** | the CRM holds the record | a Bitrix24 entity id, plus the `audit_log` row from the ERP Sync workflow. Last run **2026-09-06 15:02:34** |
| 10 | **SLACK** | a human was told | the Slack message `ts` in the target channel, plus its `audit_log` row. Last run **2026-09-06 15:02:53** |
| 11 | **WHATSAPP** | a reply left the building and landed | `channel_send_directive` (the outbound ledger — **0 rows**) + `nexus_record_send_result(directive_id, 'SENT', <wamid>, …)` writing `provider_message_id`, **plus a human confirming the handset**. Note: Cloud outbound **cannot** be recorded in `channel_message_events` — `channel_message_events_cloud_requires_signature` demands `origin_verified = 'hmac_sha256_x_hub'`, impossible for a call we made ourselves |
| 12 | **UI** | the dealership can see it | the dashboard read path — the row rendered on the Conversations / Leads screen, from the same query a salesperson runs |
| 13 | **AUDIT** | the whole thing is reconstructible afterwards | `audit_log` row ids tying hops 3-12 to one correlation id. **Five of seven channels have never written one** |

### Evidence required to move a channel one column right
- **IMPLEMENTED → DEPLOYED**: a live workflow id or an `active` registry/endpoint
  row.
- **DEPLOYED → REAL TRAFFIC PROVEN**: an execution triggered by a genuine
  external event **that wrote at least one row**. A refusal is not traffic proven;
  it is a gate proven.
- **REAL TRAFFIC PROVEN → END-TO-END VERIFIED**: every hop 1-13 with a named
  artefact, and a human confirming hop 11 or hop 12 with their eyes.
- **END-TO-END VERIFIED → COMMERCIALLY VALIDATED**: a dealership that is not ALBA
  relied on the channel in the ordinary course of business and it held. ALBA is
  tenant #1, not the customer — ALBA succeeding proves the software runs, not
  that the product works for the market it is sold to.

---

## 3. A green n8n execution is not proof of any downstream hop

State this wherever the matrix is quoted, because it is the single most likely
way this document gets misread.

- **A 200 is not a delivery.** n8n's HTTP node returns success on a 2xx. Meta can
  answer 200 to an accepted-but-undeliverable message; WAHA answers 200 the
  moment it queues. Hop 11 needs the `wamid` **and** a handset.
- **A green execution can mean nothing ran.** The Cloud receiver's first
  published version wired only output 0 of a `multipleMethods` webhook — output 0
  is GET — so **every POST ran no nodes at all** and n8n answered a bare 200 with
  an empty body. `lastNodeExecuted: "Meta Cloud Webhook"`, `runData: {}`. From
  outside that is indistinguishable from a healthy endpoint.
- **A green execution today would be a green execution that wrote nothing.**
  Executions `11190`, `11191`, `11206` are all green and all ended at
  `Respond Without Writing`.
- **A green execution can precede a guaranteed failure.** With
  `receiver.sdk.js:265` unfixed, the first real message throws `23514` at
  `Record Channel Event` — after the gate passed, after the tenant resolved.
- **`onError: continueRegularOutput` turns a failed send green.** Any send node
  configured that way must have a `Delivery Report` node behind it that inspects
  the item for `error`; without one, the execution is green precisely because the
  send failed quietly.

**The proof of a hop is the artefact that hop writes, in the system that hop
owns.** An execution id proves hop 8 and hop 8 only.
