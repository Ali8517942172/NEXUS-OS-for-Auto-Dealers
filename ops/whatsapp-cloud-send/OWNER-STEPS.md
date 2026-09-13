# OWNER-STEPS — turning on the WhatsApp Cloud sender

Ordered. Do not skip ahead: step 5 cannot succeed until step 1 has been running
long enough for a real customer message to land.

Secrets are named here and **never handled**. No value in this folder, this
repo, or this session. Nothing below asks you to paste a token into a file that
gets committed.

---

## 0. What you are turning on, and what will still refuse

`send.workflow.json` is the first code in NEXUS that can send a WhatsApp
message over the official Cloud API. Importing it does **not** start messages
going out. On today's data every outbound still refuses, correctly, for reasons
that are recorded and readable. Steps 4 and 5 are what clear that. Read
`SEND-DESIGN.md` §2 before you decide that a refusal is a bug.

---

## 1. Apply the receiver patch first

Nothing on the send side can work while the inbound side writes nothing.

```
cd <repo root>
git apply ops/whatsapp-cloud-send/phone-plus-defect.patch
```

Then re-generate and re-import the receiver workflow from
`ops/n8n-whatsapp-cloud/receiver.sdk.js` the same way it was imported before.

**Why this is step 1:** the receiver was sending `+971…` into a column
CHECK-constrained to digits, so every genuine verified inbound message failed to
write. `channel_message_events` = 0 rows. No inbound event means no conversation
state, which means the policy engine answers UNKNOWN for every customer, which
means every free-form send refuses. One character on the inbound path is what
makes the outbound path unable to send.

---

## 2. Create the sending token — a **different** token from the one you already have

In Meta Business Manager, create (or reuse) a **System User**, give it access to
the WhatsApp Business Account, and generate a token with scope
**`whatsapp_business_messaging`**.

You will be tempted to reuse `META_PAGE_ACCESS_TOKEN`. **Do not.** In this repo
that name holds the **Lead Ads Page token**, scope `leads_retrieval`. Pointed at
`/messages` it answers error `190` or `200`, and someone will "fix" that by
widening the Lead Ads token instead of creating the right one.

The sender reads this env var, by name:

```
META_WA_SYSTEM_USER_TOKEN
```

Also confirm these already exist for the receiver, unchanged by any of this:
`META_APP_SECRET` (HMAC signing secret — **not** a send credential) and
`META_WEBHOOK_VERIFY_TOKEN`.

---

## 3. Put the variable on the box — **both** containers

This box runs n8n in **queue mode**. `$env` is read by the process that actually
executes the node, and in queue mode that is the **worker**, not the main
container. Setting the variable on `n8n` alone produces a sender that imports
cleanly, runs, and sends with an empty `Authorization: Bearer ` header.

Add `META_WA_SYSTEM_USER_TOKEN` to the environment of **both** services, then
recreate **both**:

```
docker compose up -d --force-recreate n8n n8n-worker
```

A restart is not enough — the variable has to be present at container creation.
Confirm it reached the worker before going further; do this by checking that the
variable is **set**, without printing it:

```
docker compose exec n8n-worker sh -lc 'test -n "$META_WA_SYSTEM_USER_TOKEN" && echo PRESENT || echo MISSING'
```

If that prints `MISSING`, stop. Everything after this step will fail in a way
that looks like a Meta problem and is not.

---

## 4. Apply the held migration

```
ops/whatsapp-cloud-send/held/20260913051500_wire_the_cloud_sender.sql
```

It is **held**: read it, then apply it deliberately. It creates
`channel_send_endpoint` (the send address and the *name* of the token env var),
files the row for the already-registered Cloud number, corrects
`channel_registry.credential_ref` — which today names `META_APP_SECRET`, a
signing secret that cannot send — and adds
`v_whatsapp_cloud_send_readiness`.

It refuses to commit if `service_role` cannot execute the three send RPCs.

Afterwards, this is your one-line answer to "why is nothing sending?":

```sql
select * from public.v_whatsapp_cloud_send_readiness;
```

---

## 5. Attest the 24-hour window rule

Rule `WA_CUSTOMER_SERVICE_WINDOW_HOURS` (id
`35235fbe-b0d2-4648-a157-fff8cdb344b2`) is `NOT_VERIFIED` /
`may_be_relied_on: false`. Nobody has checked the recorded value of 24 hours
against Meta's current terms.

**Until you attest it, every free-form send refuses.** That is deliberate and it
is not a defect. Only you can clear it — it requires someone with access to the
Meta account reading Meta's current documentation and saying so on the record:

```sql
select * from public.policy_platform_verify_rule(
  p_rule_id             => '35235fbe-b0d2-4648-a157-fff8cdb344b2',
  p_attested_by         => '<your name>',
  p_attested_by_contact => '<your email>',
  p_source_kind         => 'PUBLIC_DOCUMENTATION',
  p_source_name         => 'WhatsApp Business Platform — Cloud API, customer service window',
  p_source_ref          => 'https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages',
  p_source_observed_on  => current_date,
  p_effective_from      => current_date,
  p_confidence          => 'HIGH',
  p_account_ref         => '<your WABA id>',
  p_notes               => 'Read against Meta current terms on the date above.'
);
```

Do not attest a number you have not personally read today. An attestation is a
person's name against a claim, and it is what a later reader will rely on.

---

## 6. Get at least one approved template registered

Outside an open window, only a **Meta-approved template** may be sent.
`whatsapp_templates` = **0 rows**, so today every out-of-window send refuses
`TEMPLATE_NOT_SENDABLE` — correctly, and with the reason recorded.

1. In the WhatsApp Manager, submit a template — for a dealership follow-up, a
   **UTILITY**-category one is what the policy engine will demand for a
   `FOLLOW_UP` intent. Wait for Meta to approve it.
2. Record it in `whatsapp_templates` with its `provider_status` as Meta reports
   it, and the timestamp at which you observed that status. NEXUS checks the
   *age* of that observation, not just its value.

Callers must then pass `p_max_template_status_age` (e.g. `'24 hours'`). NEXUS
refuses to pick that number for you: it is a statement about how much risk of
sending on an approval Meta has since paused you are willing to carry.

---

## 7. Import the sender

n8n → Workflows → **Import from File** → `ops/whatsapp-cloud-send/send.workflow.json`.

Then, before activating:

1. Attach the existing **Supabase** credential (`supabaseApi`) to the two HTTP
   nodes `Ask NEXUS To Route And Record` and `Record Send Result`. It must be
   the **service_role** credential — outbound is a backend path and the RPCs
   raise `42501` for `authenticated` and `anon`.
2. Attach a **Header Auth** credential to the `Send Request In` webhook. This
   endpoint reaches real customers' phones; the only thing between an open port
   and a send must not be that nobody has scanned it.
3. Leave `POST Graph Messages` with **retry off**. It is off on purpose: the
   Graph messages endpoint has no idempotency key, so an n8n retry of a request
   Meta already accepted is a second real message. Do not "helpfully" enable it.
4. Do **not** change any node's error handling to `Continue (using regular
   output)`. That is the pattern that made five of six existing send sites
   record "we said this" when nothing was sent.

---

## 8. First live send — prove the refusal before you prove the send

Call the webhook with a **template** send to a number you control, and read what
comes back.

```json
{
  "tenant_id": "fff6a2b5-cfd5-4460-8383-875bc5826de0",
  "customer_external_id": "9715XXXXXXXX",
  "intent": "FOLLOW_UP",
  "send_form": "TEMPLATE_TEXT",
  "template_ref": "<your approved template name>",
  "template_variables": { "language_code": "en", "body": ["Ali"] },
  "max_template_status_age": "24 hours",
  "request_ref": "owner-first-live-send-2026-09-13",
  "requested_by": "<your name>"
}
```

`customer_external_id` is the wa_id: **digits only, no leading `+`**.

`request_ref` must be **stable across retries and unique across sends**. Do not
generate a UUID per call — that is a new ref every time and is the same as
passing none; `nexus_request_send` refuses a missing one by name.

Then check the ledger:

```sql
select directive, outcome, reason_code, send_result, provider_message_id,
       provider_error_code, left(reason, 200)
  from public.channel_send_directive
 order by routed_at desc limit 5;
```

- `send_result = ACCEPTED_BY_PROVIDER` with a `wamid` — Meta accepted it.
  **Accepted is not delivered and is not read.** There is no delivery feed yet;
  no screen may claim otherwise.
- `REJECTED_BY_PROVIDER` — Meta refused. The error is recorded verbatim. Do
  **not** re-drive it as if it were a transport failure.
- `TRANSPORT_ERROR` — the call did not complete. Whether Meta saw it is
  **UNKNOWN**, not "it was not sent". Re-drive only under the **same**
  `request_ref` so idempotency decides.
- `NOT_ATTEMPTED` with `directive = DO_NOT_SEND` — a refusal, recorded before
  any transport ran, with `reason` and `what_would_change_it` in plain English.

Now send the **same** request a second time, unchanged. It must come back
`ALREADY_SENT_UNDER_THIS_REQUEST_REF` and must **not** produce a second message
on the handset. If it does produce a second message, stop and report it — that
is the doubled-sender shape this deployment has seen before.

---

## 9. What is still not done after all of this

- **No delivery or read feed.** Meta's `statuses` webhook is not consumed by
  anything. `ACCEPTED_BY_PROVIDER` is the strongest claim NEXUS can make.
- **WAHA is still registered and still active** on this tenant. It sits second
  behind Cloud, but it is a live carrier. Removing it is the owner's WAHA-exit
  decision, not this folder's.
- **`waba_id` is unknown** and filed as NULL. It becomes observable once the
  patched receiver writes its first inbound event. Do not paste it in from a
  dashboard screenshot.
- **Rate-limit re-drive is manual.** A `130429` / `131056` rejection is recorded
  and stops. Re-driving it hours later under the same `request_ref` is a human
  decision today; there is no queue for it.
