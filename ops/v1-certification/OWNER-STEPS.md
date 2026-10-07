# Owner steps — only you can do these, and this is the order

Written 13 September 2026. **This agent never handles, reads, prints or stores a
secret value.** Where a step involves one, it is named by variable name only and
marked **SECRET**, and the value moves from you to the machine without passing
through any transcript.

Steps are in **dependency order**. Each names what it unblocks and what breaks if
it is done early. Do not reorder them to make progress feel faster — several of
these are ordered specifically because the out-of-order version fails silently.

---

## Phase 0 — get the code off this machine

### 0.1 Push the branch. **SECRET: no.**
`wip/gate-L9-2026-09-03-continued` at `14b9744`. This clone's only
remote-tracking ref is `origin/main` dated **2026-08-31**; the working branch has
**no remote-tracking ref at all**. Everything from `869e08f` (Foundation Freeze)
through `14b9744` (12 Sep) exists in exactly one place.

*Unblocks:* review, CI, deploy — every step below.
*If skipped:* one disk failure erases two weeks of work, including the Cloud
receiver, the WAHA exit plan and this certification pass.

### 0.2 Open the PR and get it reviewed. **SECRET: no.**
*Unblocks:* merge.
*If done out of order:* reviewing before pushing is not possible; merging before
review puts unreviewed database-adjacent changes on `main`.

### 0.3 Merge. **SECRET: no.**
*Unblocks:* deploy.

### 0.4 Deploy the bundle to the box. **SECRET: no** (uses credentials already on
the VM).
**The deployed bundle predates the current code.** Every measurement in
`META-CLOUD-COMPLETION.md` about what is *on the box* was taken against an older
bundle than what is in this repo.
*If skipped:* every later step is verified against code that is not the code you
have. This is the specific failure mode that makes a passing verification
worthless.

---

## Phase 1 — make the Cloud receiver survive its first real message

### 1.1 Fix `ops/n8n-whatsapp-cloud/receiver.sdk.js:265`. **SECRET: no.**
Delete `'+' + `. `customer_wa_id` is already Meta's bare E.164 digits; the
`'+'` violates
`channel_message_events_customer_phone_is_digits_or_null` and raises `23514`.
*Unblocks:* any Cloud message ever being recorded.
*If done after step 1.5:* the first real customer message fails, Meta retries and
fails identically, and you diagnose in production a defect that was already
written down. There is no upside to this order.

### 1.2 Republish the receiver workflow (`J8MXprxVw1yhjBpp`). **SECRET: no.**
*Rollback:* republish the previous version — the refusal path writes nothing, so
a bad version costs refused deliveries, not bad rows.

### 1.3 Set the environment variables on the VM. **SECRET: YES — all three.**
By name only:
- `META_APP_SECRET`
- `META_WEBHOOK_VERIFY_TOKEN`
- a **separately named** WhatsApp System User token for send

**Do not reuse `META_PAGE_ACCESS_TOKEN` for WhatsApp send.** In this repo that
name belongs to the Meta **Lead Ads** path — a Page token carrying
`leads_retrieval` (`ops/n8n-meta-lead-ads/README.md:171`,
`ops/n8n-meta-lead-ads/GO-LIVE.md:207-230`, which itself records the variable
name as *asserted, not measured*). WhatsApp Cloud send needs a **System User
token scoped `whatsapp_business_messaging` against the WABA**. Using one for the
other fails with a permissions error that reads like a bad secret and costs a
day.

Also: the token the Meta developer UI hands you **expires in 24 hours**. Only a
System User token survives the night.

*Conflicting measurements on the first two:* `ops/whatsapp-cloud/README.md`
(7 Sep) records them **unset**; `WAHA-EXIT-PLAN.md` §2 (8 Sep) records them
**set and reaching the worker**. The later stands, but neither has been
re-measured. Verify rather than assume.

### 1.4 Recreate **both** `n8n` **and** `n8n-worker`. **SECRET: no.**
This box runs **queue mode** (`/rest/settings` → `executionMode: "queue"`,
concurrency 2). A Code node's `$env` is read by **`n8n-worker`**.
*If you recreate only `n8n`:* the worker keeps the old environment, the receiver
keeps refusing, and the UI shows a healthy workflow. **Verifying the wrong
container is the mistake that cost two days in early September.** Do not repeat
it.

### 1.5 Complete webhook verification in the Meta app. **SECRET: uses 1.3's
verify token, but you enter it in Meta's UI — not here.**
GET handshake against
`https://35.224.126.225.nip.io/webhook/whatsapp-cloud-inbound`.
*Unblocks:* nothing is delivered until Meta considers the callback verified.

### 1.6 Subscribe the `messages` field on the WABA. **SECRET: no.**
*If skipped:* the callback shows verified and **no message is ever delivered**.
A verified webhook is not a subscribed one, and the Meta UI does not make that
obvious.

### 1.7 Send one real 1:1 test message. **SECRET: no.**
From a verified recipient handset to `+1 555 672-4466` (`phone_number_id`
`1306545252542419`). A 1:1 chat — not a group, not a status.
*Accept as proof only:* an execution reaching `Respond 200 Recorded`, **one row
in `channel_message_events`** with `provider = 'whatsapp_cloud'` and
`origin_verified = 'hmac_sha256_x_hub'`, and **one row in
`whatsapp_conversation_state`**. A green execution is not proof
(`V1-CERTIFICATION-MATRIX.md` §3).
*Unblocks:* this is the first real evidence the Cloud channel has ever produced,
and it clears half of the `TEMPLATE_REQUIRED` reason (`CONVERSATION_NOT_MEASURED`).

---

## Phase 2 — decisions only a named human can make

### 2.1 Decide the number: migrate `+971526647253`, or take a new business line.
**SECRET: no. Nobody can make this for you.**
`+971526647253` is on WhatsApp Business *app* (WABA `311007628770691`,
`bharmalmarketing`), not Cloud API, and WAHA drives it today. Migrating it kills
the app's chat history and WAHA's linked-device session, and forces a hard
cutover with no parallel proof. A separate line lets both transports run at once
and makes rollback one `channel_registry` row.

This repo also records that `+971526647253` is **Ali's personal handset**
(`me.pushName: "Ali Asgher"`; in a nine-hour sample of 51 distinct inbound
messages, **zero** were 1:1 customer chats — 47 community and family groups,
3 `status@broadcast`, 1 newsletter). Migrating it puts your private
conversations on a platform where the business's automation holds the token.
*If decided late:* Phase 3 (parallel run) may not exist at all, which removes the
only safe way to prove Cloud without betting inbound on it.

### 2.2 Attest `WA_CUSTOMER_SERVICE_WINDOW_HOURS`. **SECRET: no. Requires your
name.**
`policy_platform_verify_rule('35235fbe-b0d2-4648-a157-fff8cdb344b2', …)` with a
named human, their contact, a source another person can open and read, the date
it was read, and a confidence. The function refuses `service_role` explicitly —
*"service_role is machinery, not a witness"*.
*Unblocks:* the second half of `TEMPLATE_REQUIRED`. `policy_rule` holds 13 rows,
**0 VERIFIED**; `policy_platform_attestation` holds **0 rows**. Until this is
done, **every** outbound message is refused, including inside an open window.
*If skipped:* the send seam builds fine and refuses everything, and it will look
like a code bug.
*Note:* append-only. Reversal returns the decision to refusing; it does not unsay
the attestation. That asymmetry is why a name is required.

### 2.3 Get at least one `UTILITY` template approved at Meta, then record the
observation. **SECRET: no.** `whatsapp_template_declare()` +
`whatsapp_template_observe()`. `whatsapp_templates` = **0 rows**.
Meta's approval is Meta's and takes as long as it takes.
*Unblocks:* replying to a customer **outside** the 24-hour window. Without it the
dealership can only answer inside a window the customer opened, and must accept
that limit explicitly.

---

## Phase 3 — build and prove Cloud send

### 3.1 Register the Cloud channel per tenant. **SECRET: the `credential_ref`
points at a secret; the ref itself is not one.**
`nexus_register_channel(<tenant_slug>, 'whatsapp_cloud_phone_number_id', <phone_number_id>, <credential_ref>, 'active')`.
*Verify:* `nexus_resolve_channel_tenant(...)` → exactly one row, right tenant;
one digit off → zero rows.
*Do not delete a registered row later* — `ON DELETE RESTRICT` from
`channel_message_events` and `whatsapp_conversation_state`. Deactivate instead.

### 3.2 Build the policy-gated send seam and the Cloud sender. **SECRET: no
(reads 1.3's token from `$env`).**
Detail in `META-CLOUD-COMPLETION.md` §4d. `nexus_request_send()` /
`nexus_route_message()` already exist and **nothing calls them**.
*If built before 2.2:* it works and refuses every message, which is correct
behaviour that looks like a broken build.

### 3.3 Send one real message to one real consenting person, inside a window they
opened. **SECRET: no.**
*Accept as proof, in order:* a `channel_send_directive` row with
`provider = 'whatsapp_cloud'`, non-null `policy_decision`,
`policy_rule_verification_status = 'VERIFIED'`; then
`nexus_record_send_result(directive_id, 'SENT', <wamid>, …)` writing
`provider_message_id`; then **the message on the handset, seen by a human**.
*Unblocks:* **everything in `WAHA-DECOMMISSION.md`.** This is the blocking
precondition for the entire exit. Until it exists, removing any WAHA send site
leaves the dealership unable to reply and the dashboard silent about it.

### 3.4 Promote `whatsapp_cloud / FREEFORM_TEXT` to `MEASURED_HERE` with that
evidence. **SECRET: no.** Exactly as `waha / FREEFORM_TEXT` carries its 2 Sep
2026 / 17.8 s proof.

---

## Phase 4 — retire WAHA (full plan in `WAHA-DECOMMISSION.md`)

### 4.1 Repoint the six send sites, **one at a time**, verifying each with a real
message before starting the next. **SECRET: no.**
*If batched:* a failure in any one of them is indistinguishable from a failure in
the seam, and site 2 (`Send via WAHA`, the Conversations screen) has a
salesperson waiting at it.

### 4.2 Publish `nexus_infra_health_probe` pointed at the Cloud channel.
**SECRET: no.** Measured 4 Sep: `activeVersionId: null`, never published. **The
WhatsApp channel is unmonitored today** and would remain unmonitored after the
swap. Doing this before 4.1 means the one channel monitor is watching the
transport you are leaving.

### 4.3 Deactivate each `whatsapp_waha_session` `channel_registry` row
(`status <> 'active'`, **not** deleted). **SECRET: no.** Tenant A's is
`75d67b05-1cd4-4f81-8afd-3c2186f25590`.

### 4.4 Remove the `waha` service, its env vars, then recreate `n8n` **and**
`n8n-worker`. **SECRET: removing `WAHA_API_KEY` etc. — names only.**
This repo declares the `waha` service **three times**
(`docker-compose.yml:176-208`, `docker-compose.single.yml:159-185`,
`render.yaml:111-121`) and does **not** settle which file the box runs.
`docker compose ps` on the VM settles it. Editing the wrong file changes nothing
and reads as done.

### 4.5 Remove the `waha_sessions` volume — **deliberately and last. SECRET: it
holds the linked-device session.** This is the point of no return; re-linking
needs a human with the handset.

### 4.6 On `desktop-l3an0ma`: `docker update --restart=no n8n n8n-db waha`, and
unlink WhatsApp device **8**. **SECRET: no.**
*If skipped:* WAHA comes back on its own. `restart: always` is still declared on
all three services and the compose project was only stopped by hand through the
Docker Desktop UI (06:08:24 UTC, 8 Sep). A Docker Desktop restart or a Windows
reboot restores it — and this already happened: execution `11103` recorded
`me.jid 971526647253:8@s.whatsapp.net` posting into production two days after
this repo declared that host gone.
*Also on that PC:* a **second n8n with its own Postgres**, schedules and
credentials — a larger exposure than the WAHA half, never costed anywhere.
Decide it deliberately.

---

## Steps that are NOT on this list, on purpose

- **Customer / Conversation / Opportunity schema design or migration.**
  Explicitly paused by you. Nothing here depends on it.
- **Anything on the website/Gmail path.** Owned by a sibling agent in
  `ops/site-enquiry/`. Note only, as evidence: commit `14b9744` (12 Sep) records
  the live-site form returning **503** when filled by hand, five days after that
  path was called done — so the Website row in the matrix is NOT RUN for a
  reason, not for lack of looking.
- **Re-enabling Facebook / Instagram / Google Ads lead forms.** All three
  `lead_ingest_endpoint` rows are disabled and `google_ads_lead_form` has a
  **null `ingest_address`**. None of them can be certified until they have an
  address and are enabled, and none is on the critical path to a working
  WhatsApp channel.
