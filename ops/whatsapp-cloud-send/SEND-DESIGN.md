# WhatsApp Cloud — the outbound send seam

What this folder adds, and the rules a dealership actually hits when it tries to
message a customer. Everything below was measured against prod
`dsvuoovivysszdoiorch` on 2026-09-13, read-only, and each claim names where.

---

## 0. The seam already existed. It was never wired.

`nexus_request_send()` and `nexus_route_message()` are in the database and fully
specified. Nothing called them: `channel_send_directive` = 0 rows,
`channel_message_events` = 0 rows.

More than that — **the Cloud channel is already registered and already wins the
carrier race.** `public.channel_registry` holds, for tenant
`fff6a2b5-cfd5-4460-8383-875bc5826de0`:

| channel_type | external_identifier | status | credential_ref |
|---|---|---|---|
| `whatsapp_cloud_phone_number_id` | `1306545252542419` | active | `env:META_APP_SECRET+META_WA_TOKEN` |
| `whatsapp_waha_session` | `default` | active | `env:WAHA_API_KEY` |

A read-only call to `nexus_route_message(tenant, '971500000000', 'FOLLOW_UP',
'FREEFORM_TEXT', 'probe body', …)` returns `provider: whatsapp_cloud`,
`provider_rank: 10`, `is_official_platform: true`, `selection_order: 1`, with
`waha` at rank 90 marked *"Capable, but another active integration was selected
ahead of it by the carrier rules."* The router already prefers Cloud. It has
simply had no transport standing behind it.

`EXECUTE` on `nexus_request_send`, `nexus_route_message` and
`nexus_record_send_result` is already granted to `postgres, service_role`. n8n
writes as `service_role`, so **the RPCs are reachable today**. The HELD migration
in `held/` therefore does *not* re-register the channel; it fixes the send
credential identity, which is wrong, and adds a readiness view. See §7.

**The missing thing was the transport.** `grep -rl graph.facebook.com` over the
repo returns only Lead Ads simulator fixtures. `send.workflow.json` is the first
code in NEXUS that can put a message on the WhatsApp Cloud API.

---

## 1. What the transport is allowed to decide: almost nothing

`send.workflow.json` does not decide whether to send. It asks
`nexus_request_send`, and the answer is a `directive` of `SEND` or
`DO_NOT_SEND`. The workflow's own judgement is limited to three refusals, and
each one refuses rather than guessing:

1. **`NOT_THIS_TRANSPORT`** — the router picked `waha`. This workflow is the
   Cloud transport and will not carry another provider's directive. A template
   decision made for a WABA executed over an unofficial session is exactly the
   bypass `nexus_route_message` warns about in its own `what_would_change_it`.
2. **`ALREADY_SENT_UNDER_THIS_REQUEST_REF`** — the ledger returned
   `ALREADY_ROUTED_UNDER_THIS_REQUEST_REF`. Stop. See §5.
3. **`SEND_FORM_NOT_IMPLEMENTED_IN_TRANSPORT`** — the router resolved a shape
   this transport cannot build a Graph payload for (today: the two
   `INTERACTIVE_*` forms). It refuses rather than flattening an interactive
   message to text, which would send a different message from the one authorised.

Payloads are built from `resolved_send_form`, never from the caller's
`requested_send_form` — the router is allowed to have narrowed it.

---

## 2. The 24-hour customer service window

An inbound customer message opens a window during which the business may send
free-form messages. NEXUS holds that as a policy rule, not a constant:

```
rule_name            WA_CUSTOMER_SERVICE_WINDOW_HOURS
value                24 HOURS
jurisdiction         PLATFORM_WHATSAPP
verification_status  NOT_VERIFIED
may_be_relied_on     false
```
(`public.v_policy_rule`, rule id `35235fbe-b0d2-4648-a157-fff8cdb344b2`.)

Three states, and the third is the one that matters:

- **Window OPEN** — the customer messaged within the tolerance. Free-form is
  permitted. `policy_decision = FREEFORM_ALLOWED`.
- **Window CLOSED** — the last inbound is older than the window. Free-form is
  refused. Only a **template message** may be sent, and a template is a WABA
  object that **Meta must have pre-approved** — it does not exist until Meta says
  it does, and it cannot be conjured by writing the text into a free-form body.
- **Window UNKNOWN** — NEXUS has never observed this conversation. This is the
  live state for every customer today: `whatsapp_conversation_state` = 0 rows.
  The policy engine's own words, from the probe: *"NEXUS cannot establish that a
  window is open on this conversation, and unknown is not open."* Reason code
  `CONVERSATION_NOT_MEASURED`, `policy_window_state: UNKNOWN`, outcome
  `TEMPLATE_REQUIRED`.

### When no approved template exists, NEXUS refuses and says so

`public.whatsapp_templates` = **0 rows**. So the full chain today is:

window UNKNOWN → `TEMPLATE_REQUIRED` → caller returns with `TEMPLATE_TEXT` →
`nexus_verify_template_ref` finds no approved template → `TEMPLATE_NOT_SENDABLE`
→ `directive = DO_NOT_SEND`.

**Every outbound WhatsApp message on this deployment is refused right now.** That
is the seam working, not the seam broken. The refusal is durable — it is a row in
`channel_send_directive` with `send_result = NOT_ATTEMPTED` — and it carries
`reason` and `what_would_change_it` in plain language, which the workflow returns
to the caller verbatim. Nothing in NEXUS composes a plausible-looking message and
sends it because a template was unavailable.

There is a second gate on top: a template send **also** refuses unless the caller
states `p_max_template_status_age`. Reason code
`STALENESS_TOLERANCE_NOT_STATED`. NEXUS will not pick that number, because it is
a statement about how much risk of sending on an approval Meta has since revoked
the caller is willing to carry, and NEXUS does not carry it.

### The attestation gate — say this out loud so it is not mistaken for a bug

The window rule is `NOT_VERIFIED` / `may_be_relied_on: false`. The router's own
`what_would_change_it` reads: *"A new inbound message from the customer opens a
fresh window and this becomes FREEFORM_ALLOWED **once the platform has attested
the window rule**. Until then, send an approved template of category UTILITY."*

So free-form is gated on the owner attesting the 24-hour rule via
`policy_platform_verify_rule(p_rule_id, p_attested_by, …)`. Until someone with the
Meta account checks Meta's current terms and attests it, the only path that can
ever reach `directive = SEND` is a template send against an approved template.
**A green build and a working transport will still produce zero sent messages
until that attestation exists. That is by design.**

---

## 3. Session vs template, in the terms the dealership uses

| | Session (free-form) | Template |
|---|---|---|
| When | Window OPEN only | Any time, incl. window CLOSED/UNKNOWN |
| Needs Meta approval | No | **Yes, before first use** |
| NEXUS send forms | `FREEFORM_TEXT`, `FREEFORM_IMAGE/VIDEO/AUDIO/DOCUMENT` | `TEMPLATE_TEXT`, `TEMPLATE_MEDIA_HEADER` |
| Extra gate | none | `template_ref` + `p_max_template_status_age` + category match |
| Graph `type` | `text` / `image` / … | `template` |
| Available on WAHA | yes | **no** — a template is a WABA object |

`intent` is not decoration: it decides the template **category** the policy
engine demands (`UTILITY` for the probe). A MARKETING template sent where a
UTILITY one was required is a Meta policy violation, not a formatting slip.

---

## 4. Rate limits, retry and backoff

Meta rate-limits per phone number (a messaging tier) and per app (Graph calls).
Over the limit, Graph answers `4xx` with error `130429` / `131056`; a
too-frequent repeat to one recipient gets `131026`. NEXUS treats **all** of these
as `REJECTED_BY_PROVIDER`, not as transport failures, and does **not** re-drive
them. Re-driving a rate-limit rejection is how an account gets its tier cut.

Retry posture is deliberately asymmetric, and every node carries a note saying
which it is:

| Node | retryOnFail | Why |
|---|---|---|
| `Ask NEXUS To Route And Record` | **3 tries** | Idempotent on `(tenant_id, request_ref)`; a repeat returns the existing directive. Safe. |
| `POST Graph Messages` | **false** | The Graph messages endpoint has **no idempotency key**. An n8n retry of a request Meta already accepted is a second real message to a real customer. |
| `Record Send Result` | **5 tries** | Idempotent: an identical repeat returns `ALREADY_RECORDED`; a *conflicting* second result raises `55000` rather than overwriting. |

Backoff is n8n's fixed `waitBetweenTries` (2 s). That is enough for a transient
Supabase blip and is not the right tool for a Meta rate limit — a rate limit
needs a scheduled re-drive under the *same* `request_ref`, hours later, by a
human or a queue, not a tight loop inside one execution.

### The failure row is the point

Five of six existing WhatsApp send sites in this repo use
`onError: continueRegularOutput` and then record "we said this" whether or not
anything left the building. This workflow does not repeat that:

- `POST Graph Messages` sets `neverError: true` + `fullResponse: true`, so a 4xx
  arrives as **data with a status code** instead of vanishing into an error path;
  `onError: continueErrorOutput` catches only the case where the call never
  completed.
- Both outputs converge on `Classify Provider Response`, which **reads the status
  code and the body** and names one of `ACCEPTED_BY_PROVIDER` /
  `REJECTED_BY_PROVIDER` / `TRANSPORT_ERROR`.
- Both then hit `Record Send Result`. **There is no path from the Graph call to a
  webhook response that does not write a row.**

Three honesty rules encoded in that node:

1. A `2xx` with **no** `messages[0].id` is recorded as `TRANSPORT_ERROR`, not as
   an accept. `nexus_record_send_result` refuses `ACCEPTED_BY_PROVIDER` without a
   wamid by design — without it, "accepted" is unfalsifiable.
2. `TRANSPORT_ERROR` means *whether Meta saw it is UNKNOWN* — not "it was not
   sent". The RPC returns exactly that sentence.
3. **Accepted is not delivered and is not read.** The workflow returns that
   sentence in its own response body. No screen may claim delivery until a
   delivery-event feed exists; there is none today.

---

## 5. Idempotency — what stops a retry sending twice

Four layers, in order:

1. **`request_ref` is mandatory and is not generated by the transport.**
   `nexus_request_send` raises `22023` /
   `NEXUS_SEND_REQUEST_REF_REQUIRED` without one, and its hint says plainly: *"Do
   not pass a UUID generated at call time: that is a new ref on every retry and is
   the same as passing none."* The workflow's first Code node enforces the same
   rule before the RPC is ever called.
2. **The ledger key is `(tenant_id, request_ref)`** — the business event, not the
   actor. A repeat returns `ALREADY_ROUTED_UNDER_THIS_REQUEST_REF` and does **not
   re-route**; re-routing would re-evaluate the window, which may have moved.
3. **The transport stops on that state.** `Compose Graph Payload` refuses with
   `ALREADY_SENT_UNDER_THIS_REQUEST_REF` rather than posting again. This is the
   layer that turns the ledger fact into a non-send.
4. **`retryOnFail: false` on the Graph call**, because layers 1–3 protect a *new
   execution*, and nothing protects an in-execution retry of a request the server
   already accepted.

A ref reused for a *different* customer raises `55000` /
`NEXUS_REQUEST_REF_REUSED_FOR_A_DIFFERENT_CUSTOMER` — that is a caller defect,
and returning the first directive would put one customer's message in front of
another.

---

## 6. The `'+'` defect — what it broke

`phone-plus-defect.patch` fixes `ops/n8n-whatsapp-cloud/receiver.sdk.js:265`,
which built `p_customer_phone` as `'+' + customer_wa_id`.

- `channel_message_events` carries `CHECK (customer_phone IS NULL OR
  customer_phone ~ '^[0-9]{6,20}$')` — constraint
  `channel_message_events_customer_phone_is_digits_or_null`. A leading `+` fails
  it, so `nexus_record_channel_event` raised `23514` on **every genuine,
  HMAC-verified inbound message**; the node retried three times and the execution
  went red with nothing written. Prod today: `channel_message_events` = 0 rows.
- Because the event never landed, the next node never opened the window, so
  `whatsapp_conversation_state` = 0 rows — which is why the policy engine answers
  `CONVERSATION_NOT_MEASURED` / `UNKNOWN` for every conversation and every
  free-form send is refused. **One stray character on the inbound path is what
  makes the entire outbound path unable to send.**
- The receiver failed *closed*, which is the right direction — no unsigned or
  unrecorded traffic got through — but it failed **silently at the write**, so
  the dashboard reads "no customers have ever messaged us" rather than "the
  receiver cannot write". The patch strips non-digits and passes `null` rather
  than an empty string, so a malformed wa_id records the event without inventing
  a phone number.

The original file is **not** edited here. Apply from the repo root with
`git apply ops/whatsapp-cloud-send/phone-plus-defect.patch` (dry-run verified).

---

## 7. Token naming — `META_WA_SYSTEM_USER_TOKEN`, and why not the obvious name

`META_PAGE_ACCESS_TOKEN` in this repo holds the **Lead Ads Page token**, scope
`leads_retrieval`. It cannot send a WhatsApp message and will answer `190` /
`200` if pointed at `/messages`. Cloud messaging needs a **System User token
scoped `whatsapp_business_messaging`**, which is a different token from a
different object in Business Manager. The workflow therefore reads
`$env.META_WA_SYSTEM_USER_TOKEN` — a distinct name, so that the day someone
rotates the Lead Ads token nobody silently takes the sender down with it, and so
that no one "fixes" a `190` by pasting the Page token into the send path.

The registry row currently says `credential_ref = env:META_APP_SECRET+META_WA_TOKEN`.
Both halves are wrong for sending: `META_APP_SECRET` is the *receiver's* HMAC
signing secret, and `META_WA_TOKEN` names no env var this repo sets. The HELD
migration corrects it and records the correct token identity in a new
`channel_send_endpoint` table, with a CHECK that makes a production Cloud
endpoint naming `META_PAGE_ACCESS_TOKEN` a row that cannot exist.

## 8. Provenance

Cloud inbound is `hmac_sha256_x_hub`, rank 90; `channel_message_events` carries
`CHECK (provider <> 'whatsapp_cloud' OR origin_verified = 'hmac_sha256_x_hub')`.
Nothing here downgrades it to WAHA's `shared_secret_header` (rank 50).

Outbound is **not** written to `channel_message_events` — migration
`chanroute_06` says so explicitly, because that CHECK demands an HMAC the sender
never receives, and half-recording outbound would read as "we never sent on
Cloud". `channel_send_directive` is the outbound record, and this workflow is the
only thing that writes its result.
