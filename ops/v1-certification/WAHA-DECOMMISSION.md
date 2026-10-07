# Decommissioning WAHA — ordered, reversible, and blocked at step 0

Written 13 September 2026. Source of every call site below:
`ops/whatsapp-cloud/WAHA-EXIT-PLAN.md` §1b (8 Sep). Line numbers are from the
30 August export in `n8n-workflows/`; **the node names are the stable handle**,
the line numbers are where to look.

---

## 0. The strict precondition

**WAHA is the only thing in NEXUS that has ever sent a WhatsApp message.**
The Cloud receiver only receives — it has no send node
(`META-CLOUD-COMPLETION.md` §1). `channel_send_directive` = 0 rows (8 Sep).

> **No WAHA send site may be removed, repointed, or disabled until a real
> WhatsApp message has been sent on Cloud to a real handset and confirmed by a
> human looking at that handset.**

Remove one first and the dealership stops answering its customers, and **the
dashboard would not say so** — nothing monitors the WhatsApp channel
(`nexus_infra_health_probe` has `activeVersionId: null`, never published).

The one proof that lifts this precondition, in order:
1. a `channel_send_directive` row with `provider = 'whatsapp_cloud'`, a non-null
   `policy_decision`, and `policy_rule_verification_status = 'VERIFIED'`;
2. `nexus_record_send_result(directive_id, 'SENT', <wamid>, …)` writing
   `provider_message_id`;
3. **the message arriving on the handset, checked by a human** — not inferred
   from a 200.

Until all three exist, this document is a plan and not a schedule.

---

## 1. The six send call sites

Each is a place where a customer receives a message today and would receive
nothing the moment WAHA goes.

| # | file:line | node name | call | what stops |
|---|---|---|---|---|
| 1 | `n8n-workflows/whatsapp_bdc_ai_agent.json:36` | `Send Reply via WAHA HTTP API` | `POST /api/sendText` | the BDC agent's reply — **the only send this deployment has ever performed on a real customer** (2 Sep 2026, 17.8 s, recorded `MEASURED_HERE` in `channel_provider_capability`) |
| 2 | `n8n-workflows/whatsapp_send_dashboard_reply.json:181` | `Send via WAHA` | `POST /api/sendText` | the human reply from the Conversations screen, reached via `POST /webhook/whatsapp-send` (`apps/executive-dashboard/lib/data.js:378`) — a salesperson typing into the product |
| 3 | `n8n-workflows/7_day_warm_lead_drip_campaign.json:255` | `WhatsApp: Welcome` | `POST /api/sendText` | Day-1 WhatsApp leg of the 7-day drip |
| 4 | `n8n-workflows/7_day_warm_lead_drip_campaign.json:369` | `WhatsApp: Check-in` | `POST /api/sendText` | Day-5 WhatsApp leg of the 7-day drip |
| 5 | `n8n-workflows/kyc_aml_document_auditor_re_upload_loop_phase_5.json:190` | `WhatsApp: Request Re-upload` | `POST /api/sendText` | the KYC loop asking for a legible document — without it the loop cannot close |
| 6 | `n8n-workflows/kyc_aml_document_auditor_re_upload_loop_phase_5.json:344` | `WhatsApp: KYC Approved` | `POST /api/sendText` | the KYC loop telling the customer they are cleared |

**Two more WAHA dependencies that are not sends** and are equally load-bearing:

| # | file:line | node name | what it is |
|---|---|---|---|
| 7 | `n8n-workflows/nexus_infra_health_probe.json:32` | `WAHA Sessions` | `GET /api/sessions/default` — the **only** WhatsApp channel monitor anywhere. Measured 4 Sep: `activeVersionId: null`, never published, so nothing watches the channel today either way |
| 8 | `n8n-workflows/whatsapp_bdc_ai_agent.json:22` | inside `Extract Message & Sender` | rewrites `http://localhost:3000` → `http://waha:3000` for `media.url`, consumed by `Download KYC Image` and `Download Voice Note`. **Inbound media retrieval** — a customer's Emirates ID photo and voice note are fetched *from the WAHA container*. Cloud does not serve media this way; this is a rewrite, not a config change |

**One inbound door:** `WAHA Webhook (POST)`, path `whatsapp-inbound`, live
workflow `BiyHk9ZXxJUVGbf6`, fronted by `WAHA Auth Gate`
(`ops/n8n-waha-gate/auth-gate.node.js`, in **ENFORCE**, proven by execution
`11184`, `mode=ENFORCE, ok=true`).

---

## 2. The ordered plan

Each step names its verification and its rollback. Steps 1-5 are fully
reversible. Step 6 is reversible per site. Step 7 is where reversibility ends.

### Step 0 — prove Cloud send. **Blocking. Not started.**
See §0 and `META-CLOUD-COMPLETION.md` §4-5. Nothing below may begin.
*Rollback:* n/a — nothing has changed.

### Step 1 — build the policy-gated send seam, leaving WAHA untouched
One n8n subworkflow: `nexus_request_send` → branch on `directive` → HTTP send to
Graph → `nexus_record_send_result`. Do **not** repoint any of the six sites yet.
*Verify:* one `channel_send_directive` row per invocation, `directive` non-null.
*Rollback:* delete the subworkflow. Nothing referenced it.

### Step 2 — register the Cloud channel per tenant
`nexus_register_channel(<tenant_slug>, 'whatsapp_cloud_phone_number_id', <phone_number_id>, <credential_ref>, 'active')`.
*Verify:* `nexus_resolve_channel_tenant(...)` returns exactly one row with the
right tenant; one digit off returns zero rows; the same id under the WAHA
namespace returns zero rows.
*Rollback:* set the row's `status` to anything but `active`. The resolver returns
a **set** and `Channel Registered To A Dealership?` branches on empty, so an
inactive channel makes the receiver answer Meta `200`, write nothing, and raise
`WHATSAPP_CLOUD_CHANNEL_NOT_REGISTERED` into `audit_log`. A clean, loud off
switch. **Do not delete the row** — `channel_message_events` and
`whatsapp_conversation_state` hold `ON DELETE RESTRICT` to it.

### Step 3 — attest the window rule
`policy_platform_verify_rule('35235fbe-b0d2-4648-a157-fff8cdb344b2', …)` by a
**named human** with contact, source reference, observation date and confidence.
*Verify:* `whatsapp_policy_decision_for_channel(...)` on a conversation with a
recent inbound returns `FREEFORM_ALLOWED` with
`applied_rule_verification_status = VERIFIED`.
*Rollback:* an attestation is append-only and a `VERIFIED` rule refuses
re-verification (`ALREADY_VERIFIED`). Reversal is
`policy_platform_supersede_rule()` or `policy_withdraw_rule()`, which produces
`TEMPLATE_REQUIRED / POLICY_RULE_MISSING` — **the decision goes back to refusing;
the attestation cannot be unsaid.** That asymmetry is the point of requiring a
name.

### Step 4 — parallel run, one transport per number
Only available if the Cloud number is **separate** from the WAHA number
(WAHA-EXIT-PLAN §3 Option B). If the same number is migrated to Cloud, WAHA's
linked-device session dies with the migration and this step does not exist — the
cutover becomes a hard swap with no parallel proof.

**Read the dedupe warning before starting** (WAHA-EXIT-PLAN §6): the three
controls — `processed_messages_pkey (tenant_id, message_id)`,
`whatsapp_customer_message_seen_pkey (tenant_id, integration_id, customer_wa_id,
external_message_id)` and
`channel_message_events_channel_direction_extmsg_key` — **do not deduplicate
across transports**. WAHA ids are `3EB0…`, Cloud ids are `wamid.HBg…`; the
`integration_id` differs by construction; WAHA emits `971…@c.us`, Cloud emits
bare `971…`. A customer who messages both numbers gets two independent AI
replies. Never copy a window from one integration to the other "to keep the
conversation alive" — that is the already-fixed replay defect rebuilt by hand.
*Rollback:* step 2's rollback. Nothing on the WAHA side is touched at any point.

### Step 5 — build Cloud inbound media and the Cloud normaliser
Two new nodes ahead of each download (media_id → short-lived URL → bearer fetch);
a provider-keyed extractor emitting `Verify Or Refuse`'s normalised shape.
*Verify:* a real inbound image and a real inbound voice note on the Cloud number
reach `Download …` successfully.
*Rollback:* restore the previous node versions. Site 8's rewrite is still intact
until step 6.

### Step 6 — repoint the six send sites, **one at a time**
For each of sites 1-6 in §1: replace the `waha:3000` HTTP node with an
`executeWorkflow` call to the send seam, publish, **send one real message through
that specific path and confirm it on a handset**, then move to the next. Do not
batch them: each site has a different caller and a different failure surface, and
site 2 is a human waiting at a screen.
*Rollback per site:* restore that node's previous version in n8n. Every other
site is unchanged, which is the entire reason they move one at a time.

### Step 7 — retire the WAHA surface
Only when all six sites are repointed and each verified.
- Delete site 8's `localhost:3000` → `waha:3000` rewrite in
  `Extract Message & Sender`.
- Repoint site 7 (`WAHA Sessions`) at the Cloud channel **and publish it** —
  today it has never been published, so shipping the swap without this leaves the
  channel unmonitored, which is the state it is already in and must not remain.
- Disable or delete `POST /webhook/whatsapp-inbound`.
- **Only then** delete the `WAHA Auth Gate` node and `ops/n8n-waha-gate/`.
  Deleting the gate while the webhook lives reopens the door the gate was built
  to close.
- Set each tenant's `whatsapp_waha_session` `channel_registry` row to
  `status <> 'active'`. **Do not delete it** — `ON DELETE RESTRICT`, and the
  history is the point. Tenant A's row is
  `75d67b05-1cd4-4f81-8afd-3c2186f25590` (tenant
  `fff6a2b5-cfd5-4460-8383-875bc5826de0`).
- Remove the `waha` service from **whichever compose file the box actually
  runs** — this repo declares it three times (`docker-compose.yml:176-208`,
  `docker-compose.single.yml:159-185`, `render.yaml:111-121`) and does not settle
  which is live. `docker compose ps` on the VM settles it, not this repository.
- Remove `WAHA_API_KEY`, `WAHA_DASHBOARD_USERNAME`, `WAHA_DASHBOARD_PASSWORD`,
  `WAHA_WEBHOOK_SECRET`, `WAHA_WEBHOOK_ENFORCE` from `.env` and both compose
  files, then **recreate `n8n` AND `n8n-worker`** (queue mode — the worker reads
  `$env`).
- Promote `whatsapp_cloud / FREEFORM_TEXT` in `channel_provider_capability` from
  `VENDOR_DOCUMENTED` to `MEASURED_HERE` with the real evidence, exactly as
  `waha / FREEFORM_TEXT` carries its 2 Sep proof.
- Confirm `nexus_provider_router_invariants()` passes, `R3_CLOUD_IS_A_SUPERSET_OF_WAHA` included.
- Remove the `waha_sessions` named volume **deliberately and last** — it holds
  the linked-device session, and removing it is the point of no return.

### Step 8 — the host that can bring WAHA back on its own
Ali's Windows desktop `desktop-l3an0ma`, compose project `nexus-os` at
`C:\Users\user\Desktop\MY RESUMES\nexus-os`, was stopped by hand through the
Docker Desktop UI at 06:08:24 UTC on 8 Sep 2026 — but `restart: always` is still
declared on `n8n`, `n8n-db` and `waha`, and Docker restarts a manually stopped
`always` container when the daemon next starts. A Docker Desktop restart or a
Windows reboot brings it back. This already happened once: execution `11103`
(8 Sep, 06:07:40 UTC) recorded `me.jid 971526647253:8@s.whatsapp.net` posting
into production two days after this repo had declared that host gone.
- `docker update --restart=no n8n n8n-db waha` on that PC.
- WhatsApp → Linked Devices → **unlink device 8**. Until this is done the account
  is still served by that machine.
- That PC also runs a **second n8n with its own Postgres** — schedules,
  credentials and all. A larger exposure than the WAHA half, never costed
  anywhere in this repo. Decide it deliberately; do not leave it as an oversight.

---

## 3. Preserved vs removed

**Preserved — never rewritten, never deleted:**
- Every historical row written by the WAHA path: `communication_logs`,
  `processed_messages`, `whatsapp_contacts`, `audit_log`.
- The `whatsapp_waha_session` `channel_registry` row — deactivated, not deleted
  (`ON DELETE RESTRICT`, and the history is the record).
- `channel_provider_capability` `waha / FREEFORM_TEXT = MEASURED_HERE` with the
  2 Sep 2026 / 17.8 s evidence. That remains true forever; WAHA did send that
  message.
- The `WAHA Auth Gate` audit trail, including execution `11184`
  (`mode=ENFORCE, ok=true`) and `ops/n8n-waha-gate/`, until after step 7 removes
  the door the gate defends — and the *evidence* of that gate stays in the repo
  history regardless.
- `ops/whatsapp-cloud/WAHA-EXIT-PLAN.md` and the measurements in it.

**Removed:**
- The six `waha:3000` send call sites (repointed, node-by-node, each with a
  restorable previous version).
- The `waha:3000` media rewrite and the WAHA inbound webhook.
- The `waha` service declaration, its env vars, and — last — the
  `waha_sessions` volume.
- `restart: always` and the linked device on `desktop-l3an0ma`.

---

## 4. Rollback, whole-plan

Reversibility decays in exactly one place: the `waha_sessions` volume and the
unlinked device. Before step 7's final two items, **every** step is undone by
one of:

| step | rollback |
|---|---|
| 1 | delete the subworkflow — nothing referenced it |
| 2 | set the Cloud `channel_registry` row inactive → receiver logs and writes nothing |
| 3 | `policy_platform_supersede_rule()` / `policy_withdraw_rule()` → decision returns to refusing (the attestation itself is permanent) |
| 4 | step 2's rollback; WAHA untouched throughout |
| 5 | restore previous node versions |
| 6 | restore that one site's previous node version in n8n; the other five are unchanged |
| 7 (services, env, rows) | re-declare the service, restore env, set the `channel_registry` row `active`, recreate `n8n` + `n8n-worker` |
| 7 (`waha_sessions` volume) | **none** — the linked-device session is gone and must be re-linked by a human with the handset |
| 8 (device unlink) | re-link by scanning a QR from the handset |

Until every box in WAHA-EXIT-PLAN §7 is ticked, the correct words are
**"stopped"** or **"not in the send path"** — never "removed", "decommissioned"
or "done".
