# Booking flow — status

**Date:** 17 September 2026
**Author:** BOOK-FLOW agent
**Subject:** the first thing in NEXUS that calls NX995.

---

## 0. The one-line version

A workflow now exists that would turn a WhatsApp "can I come and see the car?"
into a row in `public.appointment`. **It is not active, it has never run, and it
has booked nothing.** Authored ≠ imported ≠ active ≠ proven. This file says
exactly which of those four it has reached, and what Ali has to do for the rest.

---

## 1. What was created

| | |
|---|---|
| **Workflow id** | `IsdF6LbuBnq0z3K7` |
| **Name** | `NEXUS Appointment Booking — CANDIDATE (do not activate)` |
| **State** | created, **INACTIVE / unpublished**, 34 nodes |
| **Project** | Ali's personal n8n project |
| **URL** | `https://35.224.126.225.nip.io/workflow/IsdF6LbuBnq0z3K7` |
| **Webhook path** | `nexus-appointment-booking` (nothing points at it) |

No existing workflow was modified, published, activated, archived or deleted.
`WhatsApp Cloud - Inbound Receiver (Meta)` (`J8MXprxVw1yhjBpp`) and
`WhatsApp BDC AI Agent` (`BiyHk9ZXxJUVGbf6`) were **read only**.

---

## 2. Exactly what it does

### Trigger and dealership resolution

Its own Meta Cloud webhook. The first node is the **same security decision as the
live receiver**: HMAC-SHA256 of the **raw request bytes** against
`$env.META_APP_SECRET`, compared in constant time to `X-Hub-Signature-256`. The
SHA-256/HMAC implementation is carried over from the live receiver's
`Verify Or Refuse` node byte-for-byte, including the `(l + 8)` padding fix. With
`META_APP_SECRET` unset it **refuses every request** rather than passing traffic.

The dealership comes from Meta's own signed `metadata.phone_number_id`, resolved
through `nexus_resolve_channel_tenant('whatsapp_cloud_phone_number_id', …)` →
`channel_registry` — exactly as the live receiver does. **Nothing the customer
types can name or change a dealership.** An unregistered `phone_number_id` gets a
200 to Meta and then a loud throw (`WHATSAPP_CLOUD_CHANNEL_NOT_REGISTERED`),
which is the live receiver's own pattern.

### The intent it keys on: `TEST_DRIVE`

`nexus_classify_message_intent` (current form: NX973) has **no `APPOINTMENT`
intent**. Its visit-request bucket is `TEST_DRIVE`, reason code `VIEWING_WORD`,
and it covers `test drive`, `view`, `viewing`, `see the car`, `can i see`,
`visit`, `showroom`, `dekh`, `dekhna`, `kab aa`, `aa sakta`, `appointment`,
`book a slot`. `TEST_DRIVE` is the nearest honest value and it is what this
workflow keys on. Measured against production on 17 Sep 2026 (read-only):

| message | intent |
|---|---|
| `can i come and see the car tomorrow` | `TEST_DRIVE` |
| `I want to book a slot for a test drive` | `TEST_DRIVE` |
| `kab aa sakta hu showroom` | `TEST_DRIVE` |
| `appointment please` | `TEST_DRIVE` |
| `what is the price` | `PRICE_ENQUIRY` (ignored) |
| `WIN A FREE CAR visit http://x.co` | `SPAM` (ignored — spam is checked before the viewing words) |

### The three calls, in order

1. **`nexus_appointment_request(p_tenant_id, p_customer_id, 'WHATSAPP', null, null, <message>, 'n8n:nexus-appointment-booking-candidate')`**
   The customer must already exist in `public.customer` for that dealership —
   NX995 refuses to create one, so the workflow looks the row up by
   `tenant_id` + `phone_digits` and, if it is missing, replies nothing, answers
   Meta 200 and throws `APPOINTMENT_CUSTOMER_NOT_RECORDED`. That row is normally
   created by the live receiver recording the same conversation.
2. **`nexus_appointment_offer_slots(appointment_id, <3 slots>, actor)`**, then the
   times are sent back to the customer in **Asia/Dubai wall clock** (`Fri 18 Sep,
   11:00`), numbered 1–3, with `Nothing is held until you pick one.`
3. **`nexus_appointment_confirm(appointment_id, <the slot they picked>, 45, …)`**
   when the customer replies with the **number of a slot NEXUS actually
   offered**. Only then does the word "booked" appear in any message.

If the reply is about visiting but does not name an offered time
(`first one`, `I will take 2`, `2pm`), the workflow **re-sends the list**. It
never guesses which time the customer meant.

### What it deliberately does NOT do

- **It never calls `nexus_appointment_mark_attended`.** Attendance is something a
  person sees. NX995 refuses to infer it and so does this.
- It does not record the channel event or open the service window — the live
  receiver owns those and double-writing them would corrupt the ledger.
- It does not write to any calendar. NX995 does not either. A `CONFIRMED` row is
  invisible to every diary in the dealership until a human copies it across.

### Failing closed

Every NX995 write node has `onError: continueErrorOutput` wired to one
`Explain The Refusal Honestly` node. That node reads the database's own sentence,
sends the customer a short true one, answers Meta 200, then throws
`APPOINTMENT_WRITE_REFUSED: <the database's message>` so the failure lands in the
error workflow. **The word "booked" does not appear on any refusal path.** The
confirmation node additionally re-checks `state === 'CONFIRMED'` and throws
rather than composing a confirmation for anything else.

---

## 3. What has been tested — and what has NOT

### Ran, and passed

1. **SDK validation** — `validate_workflow`: valid, 34 nodes.
2. **The NX995 call sequence, for real, against STAGING `wwspuxrbiyagnrnzgate`**
   (which has NX995 applied), using the exact argument shapes and values the n8n
   nodes send. Results:

   | step | result |
   |---|---|
   | `nexus_appointment_request(...,'WHATSAPP',...)` | `state=REQUESTED action=REQUESTED` |
   | `nexus_appointment_offer_slots(id, 3 slots)` | `state=OFFERED action=SLOTS_OFFERED slots=3` |
   | `nexus_appointment_confirm(id, slot[1], 45)` | `state=CONFIRMED was_offered=true` |
   | offer on a CONFIRMED row | refused: `NX995 TRANSITION_REFUSED … CONFIRMED -> OFFERED is not a move this machine allows` |
   | confirm a past time | refused: `NX995 REFUSED: … is in the past …` |
   | request against the quarantine tenant | refused: `NX995 REFUSED: that is the unattributed quarantine tenant …` |
   | request with another dealership's customer | refused: `NX995 REFUSED: customer … does not exist in dealership …` |

   The rehearsal appointment was then `nexus_appointment_cancel`-ed. It was a
   synthetic tenant and a synthetic customer.
3. **The Dubai slot arithmetic**, run in Node against 24 `now` values across a
   whole UTC day, including the UTC-midnight rollover: 72 slots checked, 0 in the
   past, every label landing on 11:00 or 16:00 Dubai.
4. **The slot-pick regex**, 10 cases: `2`, `  3 `, `option 1`, `Option  2`,
   `1) Thu` parse; `first one`, `I will take 2`, `2pm`, `10`, `""` correctly
   parse to nothing.
5. **The classifier probe** in the table above, read-only against production.

### Did NOT run

- **The workflow itself has never executed.** Not once, not in test mode. No n8n
  execution exists for it.
- **Nothing was written to production.** Production `dsvuoovivysszdoiorch` was
  `SELECT`-only for this work. `public.appointment` on production is still empty
  of anything this agent put there.
- **No message has been sent to anybody.** See §4.
- **The HMAC node was not exercised** in this workflow (the code is carried over
  from a node that has taken real signature-verified Meta traffic, but this copy
  has verified nothing).
- **Multi-message deliveries are untested.** If one Meta delivery ever carries
  two inbound messages, `Find An Open Offer` returns 0 rows for one of them and
  `alwaysOutputData` emits a single synthetic item, which can break per-item
  pairing. Meta normally delivers one message per change. Test this before
  trusting it at volume.
- **Double-booking protection is effectively off in this flow.** NX995's
  exclusion constraint keys on `assigned_to_id` **or** `resource`; this workflow
  sets neither, so two customers can hold the same slot and the database will
  not stop them. `nexus_appointment_status` says so in words on every such row.
- **The proposed times are arbitrary.** Tomorrow 11:00, tomorrow 16:00, the day
  after 11:00, Dubai. NX995 has no capacity model — no opening hours, no shift
  roster, no Friday prayer. These times are not checked against any diary or any
  human's availability.

---

## 4. The hard blocker: it cannot currently send anything

The workflow hands its outbound messages to the house send seam — a POST to
`$env.NEXUS_WA_SEND_WEBHOOK_URL` with the `nexus_request_send` request shape
(`tenant_id, customer_external_id, intent, send_form, message_body,
requested_by, request_ref`), exactly as `ops/whatsapp-cloud-send/send.workflow.json`
expects. Two things are true today:

1. **That transport is not in n8n at all.** `send.workflow.json` exists only in
   the repo; an n8n search for "WhatsApp" returns three workflows and it is not
   one of them.
2. **Even once it is imported, every send currently refuses.** Per
   `ops/whatsapp-cloud-send/SEND-DESIGN.md`: `whatsapp_conversation_state` has no
   rows, so the window is `UNKNOWN` → `TEMPLATE_REQUIRED`; `whatsapp_templates`
   has no rows → `TEMPLATE_NOT_SENDABLE` → `directive = DO_NOT_SEND`. The
   24-hour window rule is `NOT_VERIFIED` / `may_be_relied_on: false` and needs an
   owner attestation via `policy_platform_verify_rule` before free-form can ever
   be allowed.

So: **this workflow can create an appointment in the database, and cannot yet
tell the customer about it.** That is the seam working, not the seam broken — but
it means "booked appointments automatically" is not true end-to-end yet, and
turning this workflow on alone will not make it true.

---

## 5. What Ali must do to make it live

Nothing below was done for him, and step 3 and step 6 are his alone.

1. **Attach the Supabase credential.** n8n did not auto-assign it. Open
   `IsdF6LbuBnq0z3K7` and set the existing **`Supabase account`**
   (`supabaseApi`, id `dv4OeARarErZLHCj`) on all seven Supabase nodes:
   `Resolve Tenant From Phone Number ID`, `Find Customer In This Dealership`,
   `Classify The Message`, `Find An Open Offer`, `Request The Visit`,
   `Offer The Slots`, `Confirm The Chosen Slot`. That credential must carry the
   **service_role** key: the five NX995 write functions are `service_role` only.
2. **Set the workflow's Error Workflow.** Workflow settings → Error Workflow →
   the same one the live receiver uses, `iYJkh1kztWxZXDbT`. Until that is set,
   every honest `throw` in this workflow goes nowhere and nobody finds out a
   booking was refused. Also set Timeout 120s and save both success and error
   executions, matching the receiver.
3. **Decide how inbound messages reach it, and wire that yourself.** The agent
   would not touch the live receiver. Two options:
   - **(a) Branch the live receiver** — add one connection from
     `Open Or Extend Customer Service Window` to an Execute-Workflow node
     pointing at `IsdF6LbuBnq0z3K7`, and convert this workflow's trigger from a
     webhook to an Execute-Sub-workflow trigger. One delivery, one path. This is
     the cleaner end state and it is a change to a live, traffic-carrying
     workflow, which is why it is yours.
   - **(b) A second Meta webhook subscription** pointed at
     `…/webhook/<id>/nexus-appointment-booking`. No live workflow is touched, but
     Meta then delivers twice and both endpoints verify independently.
4. **Confirm the env vars are set on the n8n box**: `META_APP_SECRET` and
   `META_WEBHOOK_VERIFY_TOKEN` (the workflow refuses everything without the
   first), plus `NEXUS_WA_SEND_WEBHOOK_URL` and `NEXUS_WA_SEND_WEBHOOK_TOKEN`
   for the send seam. **No credential exists in n8n for the send transport's
   header auth** — there is no `httpHeaderAuth` credential for it and the agent
   did not create one. The send nodes therefore read the token from
   `$env.NEXUS_WA_SEND_WEBHOOK_TOKEN`; if you would rather use a credential,
   create it yourself and swap the nodes to it.
5. **Import and activate the send transport** (`ops/whatsapp-cloud-send/send.workflow.json`)
   if you want the customer to actually receive the times. Until then the
   appointment is created and the customer is told nothing.
6. **Attest the WhatsApp 24-hour window rule**, or approve a UTILITY template,
   or both — see §4. Without one of these, `directive` is `DO_NOT_SEND` every
   time, by design.
7. **Decide about double-booking before this carries real volume.** Either pass
   `p_assigned_to_id` (a real `users` row at that dealership) or `p_resource`
   (a bay) into `nexus_appointment_confirm`, or accept that the exclusion
   constraint has nothing to key on. Today the workflow passes neither.
8. **Replace the arbitrary slot times** with real showroom hours before a
   customer is offered 16:00 on a Friday.
9. **Only then publish it**, and rename it — the name still says
   *CANDIDATE (do not activate)* on purpose.

---

## 6. Separate item, done in this pass: the NX991 RAG cutover

`n8n-workflows/ask_ai_rag_query_agent.json` called the **2-argument**
`search_rag_documents(text, integer)`. NX991 (applied to production today) makes
that form **RAISE** for a backend caller once a second dealership exists, because
the alternative — zero rows — reads as "the company has no document about that".

**The repo file has been moved to the 3-argument tenant-scoped form**
`public.search_rag_documents(q text, match_limit integer, p_tenant uuid)`.
The change, in the file only:

- new node **`Resolve Caller Dealership`** — POSTs `rpc/nexus_current_tenant_id`
  with the **caller's own bearer token forwarded** (the header block is copied
  verbatim from the existing `Verify JWT` node, so no key was retyped). The
  dealership therefore comes from the signed-in user's membership, never from
  the request body.
- new node **`Require A Dealership`** — normalises the response and **throws
  `NX991_TENANT_UNRESOLVED`** when the caller belongs to no active dealership,
  rather than searching unscoped.
- `Supabase Knowledge Search` body changed from
  `{ q, match_limit: 6 }` to `{ q, match_limit: 6, p_tenant }`.
- `Extract Question` now feeds `Resolve Caller Dealership` →
  `Require A Dealership` → `Supabase Knowledge Search`.

**Cutover note — the live workflow was NOT touched.** The running `Ask-AI — RAG
Query Agent` in n8n still calls the 2-argument form. It will keep working while
production has exactly one active dealership and will start raising NX991 the
moment a second one goes active. To cut over: import the updated repo file over
the live workflow (or hand-apply the three changes above), attach the Supabase
credential to the new `Resolve Caller Dealership` node, and run one real question
through it before the second dealership is switched on.

Neither this file nor the agent ran any git command.
