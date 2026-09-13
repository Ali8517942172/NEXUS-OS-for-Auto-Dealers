# Getting off WAHA and onto the WhatsApp Business Cloud API

Written 8 September 2026. Everything below is either **measured** — read from
this repository, from the production database `dsvuoovivysszdoiorch`, or from an
n8n execution — or **asserted**, and the two are kept apart on purpose. Nothing
here carries a date by which anything will happen.

NEXUS is sold to dealerships. ALBA CARS is tenant #1, not the customer this is
built for, so every step below is written per tenant and none of it may depend
on facts that are true only of ALBA — one particular phone number, one
particular WAHA container, one particular owner who answers his own WhatsApp.

**The one sentence this plan exists for:** the Cloud receiver only receives.
WAHA is the only thing in NEXUS that has ever *sent* a WhatsApp message.
Removing WAHA before something replaces the send path is a dealership that stops
answering its customers, and the dashboard would not say so.

---

## 1. What WAHA does today, exhaustively

Two roles, and only the first is the one people think of.

**Line numbers below are from the repository's `n8n-workflows/*.json`, which is a
30 August 2026 export.** The live definitions on the box have changed at least
twice since (`WAHA Auth Gate` and `Prefilter` are on the box and not in the
export — see `ops/n8n-waha-gate/prefilter.assignments.md`). The node *names* are
stable and are the reliable handle; treat the line numbers as where to look, not
as proof of what is deployed.

### 1a. Inbound — one door

| what | where |
|---|---|
| `WAHA Webhook (POST)`, path `whatsapp-inbound` | `n8n-workflows/whatsapp_bdc_ai_agent.json` (node), live workflow `BiyHk9ZXxJUVGbf6` |
| `WAHA Auth Gate` — shared-header check, live only | `ops/n8n-waha-gate/auth-gate.node.js` |
| `Prefilter` — `message_id` / `sender` / `direction` / `is_real_inbound` | `ops/n8n-waha-gate/prefilter.assignments.md` |
| `Extract Message & Sender` — WAHA payload shape, LID handling, voice/image branch | `n8n-workflows/whatsapp_bdc_ai_agent.json:22` |

Measured: the gate is in **ENFORCE** and proven (execution 11184,
`mode=ENFORCE, ok=true`, one item emitted). WAHA inbound is authenticated. It is
not going away by itself, and enforcing the gate did not move it any closer to
going away — it made the WAHA door *safe*, which is a different thing from
making it *unnecessary*.

### 1b. Outbound — every call site of `http://waha:3000`

This is the list that defines "done". Each of these is a place where a customer
receives a message today and would receive nothing after WAHA is removed.

| # | file:line | node | call | what stops |
|---|---|---|---|---|
| 1 | `n8n-workflows/whatsapp_bdc_ai_agent.json:36` | `Send Reply via WAHA HTTP API` | `POST /api/sendText` | **the BDC agent's reply.** The only send this deployment has ever performed on a real customer (2 Sep 2026, 17.8 s, recorded as `MEASURED_HERE` in `channel_provider_capability`). |
| 2 | `n8n-workflows/whatsapp_send_dashboard_reply.json:181` | `Send via WAHA` | `POST /api/sendText` | **the human reply from the Conversations screen.** Reached from the dashboard via `POST /webhook/whatsapp-send` (`apps/executive-dashboard/lib/data.js:378`). A salesperson typing into the product. |
| 3 | `n8n-workflows/7_day_warm_lead_drip_campaign.json:255` | `WhatsApp: Welcome` | `POST /api/sendText` | the Day-1 WhatsApp leg of the 7-day drip. |
| 4 | `n8n-workflows/7_day_warm_lead_drip_campaign.json:369` | `WhatsApp: Check-in` | `POST /api/sendText` | the Day-5 WhatsApp leg of the 7-day drip. |
| 5 | `n8n-workflows/kyc_aml_document_auditor_re_upload_loop_phase_5.json:190` | `WhatsApp: Request Re-upload` | `POST /api/sendText` | the KYC loop asking a customer for a legible document. Without it the loop has no way to close. |
| 6 | `n8n-workflows/kyc_aml_document_auditor_re_upload_loop_phase_5.json:344` | `WhatsApp: KYC Approved` | `POST /api/sendText` | the KYC loop telling the customer they are cleared. |
| 7 | `n8n-workflows/nexus_infra_health_probe.json:32` | `WAHA Sessions` | `GET /api/sessions/default` | not a send — the **only monitor of the WhatsApp channel** anywhere in the system. Measured 4 Sep: this workflow has `activeVersionId: null` and has never been published, so today nothing watches the channel at all. |
| 8 | `n8n-workflows/whatsapp_bdc_ai_agent.json:22` (inside `Extract Message & Sender`) | rewrites `http://localhost:3000` → `http://waha:3000` for `media.url` | consumed by `Download KYC Image` (`url = {{ $json.document_url }}`) and `Download Voice Note` (`url = {{ $json.audio_url }}`) | **inbound media retrieval.** A customer's Emirates ID photo and a customer's voice note are fetched *from the WAHA container*. Cloud API does not serve media this way — this is a rewrite, not a config change. |

Three more places declare or feed WAHA and are part of the removal, not of the
send path:

- `docker-compose.yml:176-208` — the `waha` service, `restart: always`,
  `waha_sessions:/app/.sessions`; `docker-compose.yml:61` and `:131` inject
  `WAHA_API_KEY` into `n8n` and `n8n-worker`; `:193-196` inject the API key and
  dashboard credentials into WAHA itself.
- `docker-compose.single.yml:159-185` — a second declaration of the same
  service, `:88` the same env var. Which of the two files the box actually runs
  is **not settled by this repository** (`CLAUDE.md` says so explicitly); it is
  settled by `docker compose ps` on the VM.
- `render.yaml:111-121` — a third declaration, `waha-whatsapp-api`,
  `devlikeapro/waha:latest`. Nothing in this repo shows it deployed; it is dead
  weight that will still name WAHA after the VM stops running it.

And one row in the database:
`channel_registry` `75d67b05-1cd4-4f81-8afd-3c2186f25590` →
`whatsapp_waha_session` / `default` / `env:WAHA_API_KEY`, status `active`,
tenant `fff6a2b5-cfd5-4460-8383-875bc5826de0` (ALBA CARS). Seeded by
`supabase/migrations/20260903193652_chanreg_05_seed_alba_cars_waha_session.sql`.

### 1c. What WAHA does *not* do, which matters for the exit

Measured on production today:

    channel_message_events           0 rows
    whatsapp_conversation_state      0 rows
    whatsapp_customer_message_seen   0 rows
    whatsapp_opt_in_event            0 rows
    whatsapp_message_usage           0 rows
    channel_send_directive           0 rows
    whatsapp_templates               0 rows

And no workflow in `n8n-workflows/` references `nexus_resolve_channel_tenant`,
`nexus_record_channel_event`, `whatsapp_record_customer_message`,
`whatsapp_policy_decision_for_channel`, `nexus_route_message` or
`nexus_request_send`.

So: **the live WAHA path sends without ever asking the policy engine, and
without recording a channel event.** It writes `communication_logs`,
`processed_messages`, `whatsapp_contacts` and `audit_log` and nothing in the
messaging layer. That is not an argument for keeping it; it is the reason the
Cloud cutover is bigger than swapping a URL. The Cloud path is the first one
that has to satisfy the policy engine, and the policy engine currently answers
`TEMPLATE_REQUIRED` to everything (§4).

---

## 2. What the Cloud path already does, and what it demonstrably does not

Authority for the node bodies: `ops/n8n-whatsapp-cloud/receiver.sdk.js`,
`verify-or-refuse.node.js`, `hmac-pure.js`. Live workflow `J8MXprxVw1yhjBpp`,
ACTIVE, `POST/GET /webhook/whatsapp-cloud-inbound`.

### Measured, working

- `META_APP_SECRET` and `META_WEBHOOK_VERIFY_TOKEN` are set and reached the
  worker. The callback is verified and subscribed to `messages`.
- Executions 11190, 11191, 11206 each ran
  `Meta Cloud Webhook → Verify Or Refuse → Signature Verified And Measurable? → Respond Without Writing`.
  Those are handshakes and refusals. **Nothing was written.**
- The signature check is real and tested against the traps that matter: raw
  bytes rather than a re-serialised object (an Arabic customer name breaks the
  re-serialising kind), a hand-rolled SHA-256 because the n8n Code sandbox has
  no crypto at all, and a constant-time compare.
- Tenant comes from `metadata.phone_number_id` looked up in `channel_registry` —
  Meta's own field inside a body we verified — not from anything the caller
  names.

### The receiver's terminal nodes, in full

`Respond 200 Recorded`, `Respond 200 Unknown Channel`, `Respond Without
Writing`. Between the gate and those three there are exactly two writes:
`Record Channel Event` (`nexus_record_channel_event`) and `Open Or Extend
Customer Service Window` (`whatsapp_record_customer_message`).

**There is no send node. No model node. No lead creation. No media download.**
A customer who messages the Cloud number gets a `200` and silence.

### CONFIG gaps — a secret, a row, a subscription. Hours.

| gap | what closes it |
|---|---|
| No Cloud channel registered for any tenant except ALBA's test number | one `nexus_register_channel(tenant_slug, 'whatsapp_cloud_phone_number_id', <phone_number_id>, <credential_ref>, 'active')` per dealership |
| No non-expiring Cloud token | a Meta System User token. The developer-UI token expires in 24 hours. Owner's account, owner's action |
| Test number recipient allowlist (five verified numbers) | either stay on the test number for the proof, or move to a real number (§3) |
| The window rule is `NOT_VERIFIED` | one `policy_platform_verify_rule()` call by a named human (§4) — this is config in the sense that it is one call, and *not* config in the sense that nobody can make it up |
| No templates | `whatsapp_template_declare()` + Meta approval (§4). Meta's half is not config here |

### BUILD gaps — code that does not exist. Each one names what to write.

1. **A Cloud sender.** Nothing anywhere calls
   `https://graph.facebook.com/.../<phone_number_id>/messages`. This is the
   whole of §1b rows 1-6. Model it on `Send via WAHA`
   (`whatsapp_send_dashboard_reply.json:181`) for shape — an `httpRequest` node
   with `$env`-supplied credentials, `onError: continueRegularOutput`, and a
   `Delivery Report` node behind it that checks the item for `error` rather than
   assuming the send landed. What must be different: the body is Meta's
   `{messaging_product, to, type, text|template}`, and it must be preceded by a
   policy call (below) rather than firing unconditionally.

2. **A policy-gated send seam.** `nexus_request_send()` /
   `nexus_route_message()` already exist and already do the hard part — they
   pick the carrier, ask the policy engine, refuse a null decision, and write a
   `channel_send_directive` row with `provider`, `external_identifier`,
   `credential_ref`, `resolved_send_form`, `template_ref` and the policy
   verdict. **Nothing calls them.** The build is an n8n subworkflow that takes
   (tenant, customer, intent, body) → `nexus_request_send` → branch on
   `directive` → HTTP send → `nexus_record_send_result(directive_id, ...)`.
   Every one of the six send sites in §1b then calls that subworkflow instead
   of `waha:3000`. Model the call/response shape on `Send to KYC Auditor`
   (`executeWorkflow`) in the BDC agent.

3. **Cloud inbound media.** `Download KYC Image` and `Download Voice Note`
   fetch from the WAHA container. Cloud API gives a `media_id` that must be
   exchanged at `/{media_id}` for a short-lived URL and then fetched with the
   bearer token. Two new nodes ahead of each existing download, and
   `Extract Message & Sender`'s `localhost:3000` → `waha:3000` rewrite deleted.

4. **A Cloud inbound normaliser.** `Extract Message & Sender` parses WAHA's
   `body.payload` shape — `@c.us`, `@lid`, `_data.Info.SenderAlt`,
   `_data.Message.audioMessage`. None of that exists in a Cloud delivery. Either
   a second extractor keyed on provider, or one that branches. `Verify Or
   Refuse` already emits a normalised item (`customer_wa_id`, `message_id`,
   `message_kind`, `text`, `occurred_at`) — that is the shape to standardise on,
   and the WAHA extractor should be made to emit the same fields so the
   downstream chain stops caring which transport it came from.

5. **A delivery-status receiver.** `whatsapp_record_delivery_status()` exists
   and takes Meta's `pricing` and `conversation` objects verbatim; nothing
   subscribes to the `message_status` webhook field or calls it. Without this
   there is no `whatsapp_message_usage` row and therefore no cost record at all
   (§8).

6. **The outbound-event hole is structural, not a missing node.**
   `channel_message_events` carries
   `channel_message_events_cloud_requires_signature` — a `whatsapp_cloud` row
   requires `origin_verified = 'hmac_sha256_x_hub'`, which is right for an
   inbound webhook and **impossible for a call we made ourselves**. So outbound
   Cloud sends cannot be recorded there. `channel_send_directive` is the
   outbound ledger until the owner of that constraint amends it. Recording WAHA
   outbound there while Cloud outbound is refused would produce a record that
   reads as "we never sent on Cloud".

### A measured defect sitting one node past the handshake

`Record Channel Event` sends
`p_customer_phone: '+' + customer_wa_id` (`receiver.sdk.js`, the `jsonBody`
expression). `nexus_record_channel_event` passes that value through unchanged.
`channel_message_events_customer_phone_is_digits_or_null` is
`customer_phone IS NULL OR customer_phone ~ '^[0-9]{6,20}$'`.

Checked on production, read-only:

    select ('+971556382721' ~ '^[0-9]{6,20}$'), ('971556382721' ~ '^[0-9]{6,20}$');
    ->  false, true

So the first genuine customer message on Cloud raises `23514` at
`Record Channel Event`. That node has `retryOnFail: true, maxTries: 3` and no
`onError`, so it throws; `Respond 200 Recorded` is downstream and never runs;
n8n answers Meta a 5XX; Meta retries and fails identically. **The receiver has
never written a row, so this has never been hit.** The fix is one character —
drop the `'+'`, since `customer_wa_id` is already Meta's bare E.164 digits — but
it must be made *before* the first real message, not diagnosed after one.

This is the shape to expect from the rest of the Cloud path too: it has been
tested at the gate and nowhere past it.

---

## 3. The number problem

**A phone number lives on one platform.** Read from Meta Business Suite on
7 September 2026: the WhatsApp account `311007628770691` owned by
`bharmalmarketing` is type **"WhatsApp Business app"**, not Cloud API.
`+971526647253` is on that app, and WAHA is driving the same number today.
Three claims on one line.

### Option A — migrate `+971526647253` to Cloud API

What it costs: the number must be removed from the WhatsApp Business app first,
which loses that app's chat history. WAHA's linked-device session dies with it.
Every one of the six send sites in §1b is offline from the moment the number
moves until the Cloud sender (§2, build gap 1) exists — so this option *forces*
a hard cutover and forbids the parallel run in §5.

What it buys: customers keep messaging the number they already have.

### Option B — a new dedicated business line on Cloud API

What it costs: a new number nobody has yet. Existing conversations stay on the
old number and have to be migrated by telling people, which is a marketing
problem, not an engineering one.

What it buys: **both transports run at once** (§5), which is the only way to
prove the Cloud path on real traffic without betting the dealership's inbound on
it. The old number stays answerable throughout. Rollback is turning one
`channel_registry` row inactive.

### What a dealership would do

Option B, and for a reason that is stronger here than "it is safer".

This repository records that `+971526647253` is **Ali's personal handset**:
`me.pushName: "Ali Asgher"`, and in a nine-hour sample of 51 distinct inbound
messages, **zero** were 1:1 customer chats — 47 were community and family
groups, 3 `status@broadcast`, 1 newsletter
(`ops/n8n-bundle-NOT-DEPLOYED/EVIDENCE-second-waha-2026-09-06.md`). NEXUS is
currently watching a private handset's group feed and correctly discarding all
of it.

A dealership buying NEXUS does not have this problem and does not want it. The
product's answer is: **the dealership registers a business line, and NEXUS never
touches a personal number.** ALBA CARS being the exception is a tenant-one
artefact, and continuing it would make the personal-handset arrangement look
like the supported design.

Stated rather than implied: migrating a personal number to Cloud API also puts
the owner's private conversations on a platform where the business's automation
holds the token. That is a reason on its own.

**Not decided here.** This is the owner's call, and it is the one decision in
this document that no amount of measurement settles. What is settled: prove the
pipeline on the free test number (`+1 555 672-4466`, `phone_number_id`
`1306545252542419`) before touching any production number either way.

---

## 4. The policy gate — `TEMPLATE_REQUIRED` on everything, and it is not a bug

Measured on production today, read-only, on the registered Cloud channel:

    whatsapp_policy_decision_for_channel(
      'whatsapp_cloud_phone_number_id','1306545252542419', <any customer>, 'SERVICE_REPLY', now())

    decision                         TEMPLATE_REQUIRED
    reason_code                      CONVERSATION_NOT_MEASURED
    applied_rule_name                WA_BUSINESS_INITIATED_OUTSIDE_WINDOW_REQUIRES_TEMPLATE
    applied_rule_verification_status NOT_VERIFIED
    window_hours                     24

`policy_rule` holds **13 rows, 0 VERIFIED**. Six of them are the WhatsApp ones:
five under jurisdiction `PLATFORM_WHATSAPP`
(`WA_CUSTOMER_SERVICE_WINDOW_HOURS` = 24,
`WA_BUSINESS_INITIATED_OUTSIDE_WINDOW_REQUIRES_TEMPLATE`,
`WA_MARKETING_TEMPLATE_REQUIRES_OPT_IN`,
`WA_WINDOW_RESETS_ONLY_ON_CUSTOMER_MESSAGE`,
`WA_FREEFORM_OUTSIDE_WINDOW_ERROR_CODE` = 131047) and one under `NEXUS_HOUSE`
(`WA_MARKETING_REQUIRES_OPT_IN_EVEN_INSIDE_WINDOW` — our stricter rule, recorded
as ours rather than Meta's). `policy_platform_attestation` holds **0 rows**.
`whatsapp_templates` holds **0 rows**.

Two independent reasons every conversation answers `TEMPLATE_REQUIRED`, and both
have to clear:

**(a) The conversation is not measured.** No row in
`whatsapp_conversation_state`, and unknown is not open. This clears by itself
the moment the Cloud receiver successfully writes one — i.e. the moment the
`'+'` defect in §2 is fixed and a real message lands.

**(b) The window rule is not attested.** This does not clear by itself, ever.

### What `policy_platform_verify_rule()` requires

It is the platform-operator path — the *only* way a `PLATFORM_WHATSAPP` rule can
become `VERIFIED`. Read from the deployed function body, it refuses unless all
of these hold:

- the caller's role is not `authenticated` or `anon` (`PLATFORM_PATH_NOT_FOR_END_USERS`);
- the rule is global — `tenant_id is null` (`NOT_A_GLOBAL_RULE`). A dealership
  verifies its own house rules with `policy_verify_rule()`, and structurally
  **cannot** hold a rule under `PLATFORM_WHATSAPP` at all;
- `p_attested_by` — a **named human**. The refusal text is explicit:
  *"service_role is machinery, not a witness"*;
- `p_attested_by_contact` — so a later reader can ask that person what they saw;
- `p_source_ref` — something another person could open and read: a
  documentation URL, a console screen, a contract clause;
- `p_source_observed_on` — the day the source was read, and not in the future
  (Asia/Dubai);
- `p_confidence` ∈ HIGH / MEDIUM / LOW. `UNKNOWN` and `VERIFIED` are held to be
  contradictory;
- an `effective_from`, which is **frozen** once the version leaves `DRAFT`.

On success it inserts an append-only `policy_platform_attestation` row, flips the
rule to `VERIFIED` / `ACTIVE`, and writes a `policy_rule_event` naming the human
and the jurisdiction owner. **This is deliberately a person putting their name to
a claim about Meta's rules.** It is not a migration, not a seed, and not
something an agent should perform on someone's behalf.

### Templates are approved at Meta, not here

`whatsapp_template_declare()` and `whatsapp_template_observe()` record what
NEXUS *believes* about a template. `nexus_state` and `provider_status` are
separate columns on purpose, an `APPROVED` with no observation timestamp is
unsavable, and `whatsapp_template_sendability()` takes a staleness tolerance
with **no default** — the caller must state how old an answer it will accept,
and that tolerance is recorded on the usage row. A 40-day-old `APPROVED`
refuses.

None of that creates an approval. A template is submitted to Meta on the WABA,
reviewed by Meta, and approved by Meta. `whatsapp_templates_guard_channel`
refuses to hold a template against a WAHA channel at all, because a WAHA
"template" is just free-form text with the template wording pasted in — which is
a business-initiated message outside the window, sent without the platform's
review and without its charge. That is the policy bypass the whole layer exists
to prevent, and it is the fastest route to the dealership's number being banned.

### Why this looks like a bug and is not

Before any attestation exists, the honest answer to "may I send freely?" is "I
cannot establish that I may", and the engine says so instead of guessing. The
alternative — defaulting to a 24-hour window nobody checked — is exactly the
failure this layer was rebuilt to make unrepresentable: on 4 September a
dealership acting as `authenticated` proposed and self-verified a
`PLATFORM_WHATSAPP` window of 99999 hours and the audit trail then read as
though Meta had said so.

**Consequence for the cutover:** until the attestation exists, a Cloud send is
only possible as an approved template, and there are no approved templates. So
the first Cloud send that can happen at all is inside a window opened by a
customer's own message — and even that needs (b) cleared, because
`WA_CUSTOMER_SERVICE_WINDOW_HOURS` being `NOT_VERIFIED` is what the decision
reports as its authority.

---

## 5. Migration order, per tenant

Each step names its own verification and its own rollback. No step depends on a
later one having been done. **Steps 0-2 are safe to run against a dealership
that is still fully on WAHA;** step 3 is the first one that changes what a
customer receives.

### Step 0 — fix the `'+'` in `Record Channel Event`

Not per-tenant. Change `p_customer_phone: '+' + …` to the bare `wa_id` in
`ops/n8n-whatsapp-cloud/receiver.sdk.js` and republish `J8MXprxVw1yhjBpp`.

*Verify:* an execution reaching `Respond 200 Recorded`, and one row in
`channel_message_events`.
*Rollback:* republish the previous version. The receiver writes nothing on the
refusal path, so a bad version costs refused deliveries, not bad rows.

### Step 1 — register the Cloud channel

    nexus_register_channel(<tenant_slug>, 'whatsapp_cloud_phone_number_id',
                           '<phone_number_id>', '<credential_ref>', 'active')

*Verify:* `nexus_resolve_channel_tenant('whatsapp_cloud_phone_number_id',
'<phone_number_id>')` returns exactly one row with the right tenant; one digit
off returns zero rows; the same id under the WAHA namespace returns zero rows.
*Rollback:* set the row's `status` to something other than `active`. The
resolver returns a **set**, and `Channel Registered To A Dealership?` branches on
empty — so an inactive channel makes the receiver answer Meta `200`, write
nothing, and raise `WHATSAPP_CLOUD_CHANNEL_NOT_REGISTERED` into `audit_log`.
That is a clean, loud off switch.

Do not delete the row: `channel_message_events` and
`whatsapp_conversation_state` carry `ON DELETE RESTRICT` foreign keys to it, so
once anything is recorded the row is not deletable anyway, and that is correct.

### Step 2 — provider rank and capability

Measured: both are already seeded and are **global, not per-tenant**.
`channel_provider_rank` has `whatsapp_cloud` at rank 10,
`is_official_platform = true`; `waha` at rank 90, false. There is no cost column
and `nexus_provider_router_invariants()` fails if one appears.
`channel_provider_capability` has all nine send forms `SUPPORTED` for
`whatsapp_cloud`; for `waha`, `TEMPLATE_TEXT` and `TEMPLATE_MEDIA_HEADER` are
`NOT_SUPPORTED / STRUCTURAL` and both interactive forms are `NOT_SUPPORTED`.

So for a new tenant this step is **verification, not work**:

    select * from nexus_provider_router_invariants();

`R3_CLOUD_IS_A_SUPERSET_OF_WAHA` must pass. If it ever fails, the capability
filter has gained a path that moves a send *down* from the official platform to
the unofficial one, and the cutover stops until that is understood.

The one real change here: when this deployment first sends on Cloud, promote
`whatsapp_cloud / FREEFORM_TEXT` from `VENDOR_DOCUMENTED` to `MEASURED_HERE`
with the evidence, exactly as `waha / FREEFORM_TEXT` carries the 2 Sep proof.

*Rollback:* none needed — nothing was changed.

### Step 3 — run both transports in parallel, with dedupe understood

Only reachable under §3 Option B (a separate Cloud number). Under Option A this
step does not exist and the cutover is a hard swap.

Both receivers are live. Inbound arrives on whichever number the customer used.
Read §6 before starting this step — the controls do **not** deduplicate across
transports, and that is a property to design around rather than a bug to fix.

*Verify:* for one test customer, a message to the Cloud number produces a
`channel_message_events` row with `provider = 'whatsapp_cloud'` and
`origin_verified = 'hmac_sha256_x_hub'`, plus a `whatsapp_conversation_state`
row; a message to the WAHA number produces the WAHA behaviour it always did.
*Rollback:* set the Cloud `channel_registry` row inactive (step 1's rollback).
Inbound on the Cloud number becomes a logged, audited no-op. Nothing on the WAHA
side is touched at any point in this step.

### Step 4 — attest the window rule

    policy_platform_verify_rule('35235fbe-b0d2-4648-a157-fff8cdb344b2', …)

with a named human, their contact, a source reference, the date they read it,
and a confidence. See §4 for the full refusal list.

*Verify:* `whatsapp_policy_decision_for_channel(...)` on a conversation with a
recent inbound message returns `FREEFORM_ALLOWED` with
`applied_rule_verification_status = VERIFIED`.
*Rollback:* an attestation is append-only and a `VERIFIED` rule refuses
re-verification (`ALREADY_VERIFIED`). The reversal is
`policy_platform_supersede_rule()` or `policy_withdraw_rule()` — and withdrawing
produces `TEMPLATE_REQUIRED / POLICY_RULE_MISSING`, not a fallback. **This step
is reversible in the sense that the decision goes back to refusing, not in the
sense that the attestation can be unsaid.** That asymmetry is the point of
requiring a name.

### Step 5 — prove send on Cloud

Build the sender and the send seam (§2 build gaps 1 and 2), then send one real
message to one real consenting person, inside a window that person opened.

*Verify, in order:*
1. a `channel_send_directive` row with `directive` = send, `provider =
   'whatsapp_cloud'`, a non-null `policy_decision` and
   `policy_rule_verification_status = 'VERIFIED'`;
2. `nexus_record_send_result(directive_id, 'SENT', <wamid>, …)` writing
   `provider_message_id`;
3. the message actually arriving on the handset — checked by a human, not
   inferred from a 200.

*Rollback:* the send seam is one subworkflow. Point the six call sites back at
`waha:3000` — they are unchanged until step 6 — and the Cloud sender becomes
dead code. This is the last fully reversible step.

### Step 6 — retire WAHA

Repoint each of the six send sites in §1b to the send seam, one at a time,
verifying each with a real message before starting the next. Then §7.

*Rollback per site:* restore the previous node version in n8n. Each site is
independent, which is why they move one at a time rather than in a single
release.

---

## 6. The dedupe warning — read this before step 3

During parallel running, **both transports can deliver the same customer's
message, and no control in NEXUS will recognise them as the same message.**

The three controls, and what each is actually keyed on — read from the live
constraint definitions, not from memory:

| control | key | absorbs |
|---|---|---|
| `processed_messages_pkey` | `(tenant_id, message_id)` | a WAHA redelivery of the same `payload.id` |
| `whatsapp_customer_message_seen_pkey` | `(tenant_id, integration_id, customer_wa_id, external_message_id)` | a redelivery **on the same integration** |
| `channel_message_events_channel_direction_extmsg_key` | `(tenant_id, integration_id, direction, external_message_id)` | the same |

Three reasons the cross-transport case slips through all of them:

1. **The ids differ.** WAHA's id is `payload.id` (`3EB0…`); Cloud's is a
   `wamid.HBg…`. The same human utterance carries two different provider ids, so
   `processed_messages` — the only tenant-scoped control — sees two distinct
   messages and claims both.
2. **The `integration_id` differs.** The other two controls include it, so they
   are per-transport by construction. That is deliberate and correct — a WAHA
   window and a Cloud window are genuinely different conversations with
   different platform rules — but it means they cannot be the thing that catches
   a duplicate.
3. **The customer identity differs.** WAHA emits `971…@c.us` (or an `@lid`
   address with the real number hidden in `_data.Info.SenderAlt`); Cloud emits
   bare `971…`. `whatsapp_record_customer_message` lowercases and trims but does
   not normalise the address form, so the same person is two `customer_wa_id`
   values.

**Consequence:** if a dealership advertises both numbers and a customer messages
both, they get two independent AI replies. If the same number were somehow
served by both — which is what §3 says cannot happen, and is the reason it
cannot — it would be worse.

### Where this becomes a policy failure and not just noise

The repository already records the mechanism: `whatsapp_record_customer_message`
once ignored `external_message_id` and upserted on timestamp alone, so
**replaying one message with a later timestamp extended the customer service
window** — proved end to end, `TEMPLATE_REQUIRED / WINDOW_CLOSED` becoming
`FREEFORM_ALLOWED / WINDOW_OPEN` on a redelivery. That is NEXUS granting itself
permission to send outside Meta's window.

It is fixed, and the fix is exactly `whatsapp_customer_message_seen` plus a
monotonic guard (`excluded.last_customer_message_at > c.last_customer_message_at`),
plus an outright refusal of a null `external_message_id` — because with nothing
to dedupe on, every redelivery looks new. A single `last_seen_id` column would
not have worked: A→B→A defeats it, and that was tested.

**So the control holds within a transport and does not exist across transports.**
During parallel running the safe reading is:

- each transport keeps its own window, and each is honest about its own;
- **never** copy a window from one integration to the other to "keep the
  conversation alive". That is the replay defect rebuilt by hand, with a
  business justification attached;
- if cross-transport identity is ever needed, it belongs in a customer-identity
  resolution above the messaging layer, not in the window table.

The narrower thing to watch during step 3: a customer who messages the Cloud
number and gets a reply from the WAHA number, because the reply path resolved
them by phone digits through `Fetch All Leads` / `Resolve Lead Identity` rather
than by channel. That is not a dedupe failure, it is a routing failure, and it
looks identical to the customer.

---

## 7. The finish line

WAHA is removable when **all** of these are true. Not "mostly".

**The send path**
- [ ] All six send sites (§1b rows 1-6) call the send seam and have each been
      verified with a real message.
- [ ] Inbound media (§1b row 8) is fetched from Meta's media endpoint; the
      `localhost:3000` → `waha:3000` rewrite in `Extract Message & Sender` is
      deleted.
- [ ] `nexus_infra_health_probe` (§1b row 7) no longer probes
      `waha:3000/api/sessions/default`, probes the Cloud channel instead, **and
      is published** — measured 4 Sep it has `activeVersionId: null` and has
      never run, so the WhatsApp channel is currently unmonitored and would
      still be unmonitored after the swap.

**The database**
- [ ] Each tenant has an `active` `whatsapp_cloud_phone_number_id` row in
      `channel_registry`.
- [ ] Each tenant's `whatsapp_waha_session` row is `status <> 'active'`. Do not
      delete it: `ON DELETE RESTRICT` from `channel_message_events` and
      `whatsapp_conversation_state`, and the history is the point.
- [ ] `whatsapp_cloud / FREEFORM_TEXT` in `channel_provider_capability` is
      `MEASURED_HERE` with real evidence.
- [ ] `nexus_provider_router_invariants()` passes, `R3` included.

**The policy layer**
- [ ] `WA_CUSTOMER_SERVICE_WINDOW_HOURS` is `VERIFIED` with a
      `policy_platform_attestation` row naming a human.
- [ ] At least one `UTILITY` template is `APPROVED` at Meta and observed through
      `whatsapp_template_observe()`, or the dealership accepts that it can only
      answer inside a customer-opened window.

**The GCP box**
- [ ] `waha` service removed from whichever compose file the box actually runs —
      settle that with `docker compose ps`, not with this repository, which
      declares the service **twice** (`docker-compose.yml:176`,
      `docker-compose.single.yml:159`) and a third time in `render.yaml:111`.
- [ ] `WAHA_API_KEY`, `WAHA_DASHBOARD_USERNAME`, `WAHA_DASHBOARD_PASSWORD`,
      `WAHA_WEBHOOK_SECRET`, `WAHA_WEBHOOK_ENFORCE` removed from `.env` and from
      both compose files. Recreate **`n8n` and `n8n-worker`** — the box is in
      queue mode (`/rest/settings` → `executionMode: "queue"`, concurrency 2),
      so a Code node's `$env` is read by `n8n-worker`. Verifying the wrong
      container is the mistake that cost two days in early September.
- [ ] The `waha_sessions` named volume removed, deliberately and last. It holds
      the linked-device session.
- [ ] `WAHA Auth Gate` node deleted from the BDC workflow, and
      `ops/n8n-waha-gate/` deleted — **only after** `/webhook/whatsapp-inbound`
      itself is gone. Deleting the gate while the webhook lives reopens the door
      it was built to close.
- [ ] `POST /webhook/whatsapp-inbound` disabled or deleted.

**Ali's Windows desktop `desktop-l3an0ma`** — this is the item most likely to be
skipped, and it is the one that can bring WAHA back on its own.
- [ ] `docker update --restart=no n8n n8n-db waha` on that PC. The compose
      project `nexus-os` at `C:\Users\user\Desktop\MY RESUMES\nexus-os` was
      **stopped by hand through the Docker Desktop UI at 06:08:24 UTC on
      8 September 2026**, but `restart: always` is still declared on all three
      services, and Docker restarts a manually stopped `always` container when
      the daemon next starts. A Docker Desktop restart or a Windows reboot
      brings it back.
- [ ] WhatsApp → Linked Devices → unlink device **8**. Until this is done the
      account is still served by that machine. Execution 11103 (8 Sep, 06:07:40
      UTC) recorded `me.jid 971526647253:8@s.whatsapp.net` posting into
      production two days after this repo had declared that host gone.
- [ ] That PC also runs a **second n8n with its own Postgres** — schedules,
      credentials and all. It is a larger exposure than the WAHA half and has
      never been costed anywhere in this repo. Deleting the compose project was
      declined on 8 Sep because the Docker Desktop dialog says nothing about the
      named volumes. Decide it deliberately; do not leave it as an oversight.

Until every box is ticked, the correct words are **"stopped"** or **"not in the
send path"**. Never "removed", "decommissioned" or "done".

---

## 8. What this costs a dealership

**No numbers are given here, and none should be invented.** Meta's WhatsApp
Business Platform conversation pricing is Meta's, it varies by country and by
conversation category, and it has been restructured more than once. A figure
written into this repository would be wrong at some point without anyone
noticing it had become wrong.

`whatsapp_message_usage` was built with that in mind: **zero numeric columns**,
verified today against `information_schema`. What it stores instead is
`provider_billable` (boolean), `provider_pricing_model`,
`provider_pricing_category`, `provider_pricing_type`,
`provider_conversation_id`, `provider_conversation_origin_type`,
`provider_conversation_expiration_at`, `provider_pricing_observed_at`, and a
`cost_state` that distinguishes *awaiting a provider report*, *provider reported
no pricing*, *provider said not billable* and *billable, amount unknown*. The
monthly rollup has no total. A screen may not render any of those as zero.

Those columns are populated by `whatsapp_record_delivery_status()` from Meta's
own `pricing` and `conversation` objects, stored verbatim as provider-reported
facts. **That receiver does not exist yet** (§2, build gap 5), so today the
table would stay empty even if sends were happening.

What has to be looked up, by a person, at Meta, per dealership:

1. The current conversation-pricing model and its categories.
2. The per-country rate for the dealership's market — UAE first, and *not*
   assumed to apply to the next country NEXUS sells into.
3. Whether any free tier or free-entry-point allowance applies, and to what.
4. What a service (customer-initiated) conversation costs versus a
   business-initiated template conversation, since the policy engine's whole
   job is to keep traffic in the cheaper and more respectful of the two.

What can be said without looking anything up:

- WAHA has no per-message charge and Cloud API does. The router is deliberately
  built so that this cannot influence carrier choice:
  `channel_provider_rank` has **no cost column**, and
  `nexus_provider_router_invariants()` fails if one appears. Using an unofficial
  transport to avoid an official platform's charges is a policy bypass, and the
  number at risk of a ban is the dealership's own business line.
- The correct way to reduce this bill is to answer inside the customer's own
  window rather than to send more templates — which is the same behaviour the
  policy engine already enforces for compliance reasons.

---

## Unknowns

1. **Which compose file the GCP box runs.** `docker-compose.yml` (queue mode,
   worker, redis) and `docker-compose.single.yml` (regular mode, no worker) both
   declare a `waha` service and both are in this repo. `/rest/settings` reports
   queue mode, which points at `docker-compose.yml`, but that is an inference
   from behaviour, not a read of the file on disk. `docker compose ps` on the VM
   settles it. Until it is settled, "remove the waha service" has two possible
   targets.

2. **Whether the deployed `J8MXprxVw1yhjBpp` is byte-identical to
   `ops/n8n-whatsapp-cloud/receiver.sdk.js`.** The repo is the stated authority
   for the node bodies and the execution traces are consistent with it, but the
   `'+' + customer_wa_id` defect in §2 was found by reading the repo, not the
   box. It should be confirmed against the published definition before it is
   called fixed.

3. **Whether `Record Channel Event` is the only such defect past the gate.**
   Everything below `Verify Or Refuse` has run zero times with real data.
   `nexus_record_channel_event`'s other constraints — `cme_extmsg_is_a_provider_id`
   (no whitespace, ≥8 chars, not all digits) against a real `wamid`, and
   `message_kind` against Meta's actual type strings — have not been exercised
   either.

4. **What Meta's `phone_number_id` looks like for a migrated number.** The one
   registered id (`1306545252542419`) belongs to a test number. Nothing here
   confirms the shape or stability of the id a production number receives, and
   `channel_registry.external_identifier` is the tenant key.

5. **Whether Option A (migrating `+971526647253`) is even available.** It
   depends on the state of WABA `311007628770691` under `bharmalmarketing` and
   on Meta's current rules for moving a number off the WhatsApp Business app.
   Read once, on 7 September, from Business Suite. Not re-checked.

6. **Whether any dealership other than ALBA CARS exists to migrate.**
   `channel_registry` holds two rows, both tenant
   `fff6a2b5-cfd5-4460-8383-875bc5826de0`. The per-tenant framing in §5 is
   therefore a design commitment, not a description of something that has been
   run twice.

7. **What `whatsapp_message_usage.cost_state` should read while the delivery
   receiver does not exist.** Every send would sit at *awaiting a provider
   report* indefinitely, which is honest but indistinguishable from a broken
   feed. Nothing currently distinguishes the two.

8. **Whether the WAHA gate README is behind the box.**
   `ops/n8n-waha-gate/README.md` still reads `MONITOR / ok=false`; execution
   11184 measured `mode=ENFORCE, ok=true`. That file is owned elsewhere and was
   not edited here — but the discrepancy is worth someone's attention, because
   the README is what an operator would read before touching the gate.
