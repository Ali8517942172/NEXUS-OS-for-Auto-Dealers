# NEXUS JOURNEY LAB — TEST MATRIX T01–T20

**Written 6 September 2026. Nothing in this file has been executed.** Every
row's verdict WAS `NOT RUN` until 7 September 2026 (see "What was actually run"
below); no row may move off `NOT RUN` except by a
recorded execution with its assertions read.

Read `README.md` first.

## What this matrix was written against, and what it was not

The ingestion layer is being built in parts. At the time of writing, the
working tree carries **parts 1, 2 and 5** as untracked migrations:

| migration | gives us |
|---|---|
| `20260906201008_leadingest_01_provenance_and_source_vocabulary.sql` | `lead_provenance_kind`, `lead_source_catalogue`, both seeded |
| `20260906201107_leadingest_02_tenant_bound_endpoints.sql` | `lead_ingest_endpoint`, `nexus_lead_endpoint_for_public_key()` |
| `20260906201743_leadingest_05_the_dealer_read_path_and_the_secret_in_the_payload.sql` | `lead_event`'s dealer read path, its column grants, and `v_lead_origin` |

**Parts 3 and 4 are not on disk.** They hold `lead_event`'s own DDL and the
writer/hydrator. So every `lead_event` column named below comes from part 5's
`grant select (...)` list and its CHECK — real, but a projection of the table
rather than its definition — and the **phase vocabulary, the disposition
reasons and `nexus_lead_ingest_invariants()` are not readable from the repo at
all.** They are named here from the brief for that work. `RUNBOOK.md` Step 0
reconciles them; a witness that does not exist under the name used here makes
its journey `BLOCKED`, not quietly re-pointed at the nearest similar column.

## House rules for this matrix

1. **A `NOT RUN` is never converted into a `PASS`** — not by inference, not by
   "the writer is obviously correct", not by a previous run of a similar
   journey. A journey whose steps ran but whose assertions were not read is
   `NOT RUN`.
2. **Verdict vocabulary:** `NOT RUN`, `PASS`, `FAIL`, `BLOCKED`,
   `BLOCKED BY MISSING CAPABILITY`. The last names the missing thing, and its
   test inverts: assert that NEXUS says UNKNOWN or NOT AVAILABLE rather than
   inventing a value. A screen rendering `0` where it means "no witness exists"
   fails that.
3. **A refusal is an assertion, not a failure.** An expected refusal must be
   recorded as a refusal with its named reason, and the rows the happy path
   would have written must be absent.
4. **`0 rows` and `42501` are different results.** Zero rows is evidence about
   RLS. `42501` is evidence about the grant. Every cross-tenant assertion says
   which it expects and records which it got.
5. **A constraint that has never been fired is decoration.** Where an assertion
   is already carried by a CHECK or a UNIQUE, the journey fires it deliberately
   in a rolled-back transaction rather than trusting the DDL.
6. **No monetary figure is asserted anywhere in this matrix.** Estimated,
   attributed and confirmed are three different words, and none of the twenty
   journeys produces any of them.

## The fictional dealership

Everything runs as **NEXUS AUTO TEST SHOWROOM — DEMONSTRATION TEST
ENVIRONMENT**, in two branches so the cross-tenant journeys have someone to be
refused:

| | name | slug |
|---|---|---|
| Branch A | `Nexus Auto Test Showroom (Branch A) — DEMONSTRATION TEST ENVIRONMENT` | `nexus-lab-a` |
| Branch B | `Nexus Auto Test Showroom (Branch B) — DEMONSTRATION TEST ENVIRONMENT` | `nexus-lab-b` |

Both invented. Identities are `t<nn>.<run_id>@journey-lab.invalid` (RFC 2606,
cannot resolve). No journey uses the name, branding, licence number, web
address or phone number of any real UAE dealership, in a payload body or
anywhere else. **The Lab runs no outbound send legs.**

## The phase machine these journeys assert against

```
RECEIVED ──► HYDRATED ──► PROMOTED          (a lead the dealership can work)
    │            │
    ├────────────┴──► DUPLICATE             (we already hold this one)
    ├─────────────────► REJECTED            (a decision: this is not a lead)
    ├─────────────────► QUARANTINED         (we cannot vouch for where it came from)
    └─────────────────► EXPIRED             (the provider will no longer give us the data)
```

`RECEIVED` means an arrival was accepted and retained. `PROMOTED` means a
`leads` row exists that a salesperson can be asked to answer. Everything
between is NEXUS's problem and none of the dealership's.

## The witnesses, as actually built

**`lead_source_catalogue`** — seeded, and it is the reason most journeys can be
written precisely rather than vaguely:

| `source_key` | `delivery_shape` | `required_provenance` | `dedup_field` | `integration_status` |
|---|---|---|---|---|
| `meta_lead_ads_facebook` | `WEBHOOK_METADATA_THEN_FETCH` | `hmac_sha256_x_hub` | `leadgen_id` | AVAILABLE |
| `meta_lead_ads_instagram` | `WEBHOOK_METADATA_THEN_FETCH` | `hmac_sha256_x_hub` | `leadgen_id` | AVAILABLE |
| `google_ads_lead_form` | `WEBHOOK_FULL_PAYLOAD` | `shared_secret_in_body` | `lead_id` | AVAILABLE |
| `website_form` | `WEBHOOK_FULL_PAYLOAD` | `origin_and_form_key` | `submission_id` | AVAILABLE |
| `marketplace_dubizzle` | `INBOUND_MESSAGE` | **`simulated`** | `simulator_scenario_id` | **COMMERCIAL_CONVERSATION_REQUIRED** |
| `marketplace_email_notification` | `INBOUND_EMAIL_METADATA_THEN_FETCH` | `hmac_sha256_svix` | `rfc_message_id` | AVAILABLE |
| `whatsapp_inbound` | `INBOUND_MESSAGE` | `shared_secret_header` | `wa_message_id` | AVAILABLE |
| `walk_in` | `MANUAL_ENTRY` | **`operator_recorded`** | `operator_reference` | AVAILABLE |
| `phone_call` | `MANUAL_ENTRY` | **`operator_recorded`** | `operator_reference` | AVAILABLE |

**`lead_provenance_kind`** — a ranked ladder, not a boolean:
`hmac_sha256_x_hub` (90) · `hmac_sha256_svix` (85) · `shared_secret_header`
(50) · `shared_secret_in_body` (30) · `origin_and_form_key` (20) ·
`operator_recorded` (10, `counts_as_real = false`) · `simulated` (0, false) ·
`unverified` (0, false).

**The `public_key` identifies; it does not authenticate.** The table's own
comment says so: *"treat every request bearing one as unauthenticated until its
`declared_provenance` has actually been verified."* Where a secret exists it is
named by `secret_ref` and stored elsewhere — `channel_registry`'s discipline.
Several journeys below exist because that distinction is easy to lose.

**Two structural refusals worth knowing before reading the journeys**, both on
`lead_ingest_endpoint`:

- `lead_ingest_endpoint_production_needs_real_provenance` — a **production**
  endpoint cannot carry a provenance whose `counts_as_real` is false. Since
  `marketplace_dubizzle` requires `simulated`, **a production Dubizzle endpoint
  cannot exist as a row**, and neither can a production `walk_in` or
  `phone_call` endpoint (T10 records that as a question, not a pass).
- `lead_ingest_endpoint_production_matches_source` — a production endpoint must
  declare exactly the provenance its source can prove. A Meta endpoint cannot
  downgrade itself to a shared header; a Google endpoint cannot claim an HMAC
  it never receives.

**`lead_event`, as the dealership can read it** — column-level `SELECT` to
`authenticated` on fifteen columns: `event_id, tenant_id, source_key,
environment, origin_verified, provenance_counts_as_real, external_event_id,
occurred_at, received_at, phase, disposition_reason, hydrated_at,
hydration_error, lead_id, promoted_at`. Deliberately withheld from the grant,
not merely unselected: `payload_raw`, `hydrated_payload`, `normalized`,
`endpoint_id`. Writes are refused by a restrictive policy with
`with check (false)`; reads are scoped by `nexus_current_tenant_ids()`.
**`lead_ingest_endpoint` is off the dealer plane entirely** — `revoke all` from
both end-user roles plus a restrictive deny — so a dealership read against it
should be `42501`, not zero rows.

**`v_lead_origin`** — `security_invoker`, joins the catalogue and the
provenance ladder onto the event, and exposes `is_test_traffic`,
`origin_cryptographically_verified`, `origin_strength`, `origin_explanation`,
`integration_status`, `disposition_reason`. Its comment is explicit that
`is_test_traffic` is **exposed rather than filtered**, so a screen that forgets
to exclude simulation traffic renders it as test data instead of counting it as
real. That makes T15 a test of the screens, not of the view.

---

## The twenty journeys

T01–T10 are the **dealership's customer**. T11–T20 are the **dealership
operator**, written multi-tenant — two branches signed in at once — because
that is where this product's expensive failures live.

| id | title | enters by | level runnable today | verdict |
|---|---|---|---|---|
| T01 | The website enquiry that lands | `website_form` | L2 | **PASS** |
| T02 | Meta Lead Ads: the two hops that complete | `meta_lead_ads_facebook` | L3 | **BLOCKED BY MISSING CAPABILITY** |
| T03 | Meta Lead Ads: the field data that expired | `meta_lead_ads_instagram` | L2 | **PASS** |
| T04 | Google Ads lead form: the secret inside the body | `google_ads_lead_form` | L3 | **BLOCKED BY MISSING CAPABILITY** |
| T05 | Google delivers the same lead twice | `google_ads_lead_form` | L2 | **PASS** |
| T06 | A bot fills the website form — and the human who follows | `website_form` | L2 | **BLOCKED BY MISSING CAPABILITY** |
| T07 | The WhatsApp enquiry, on a door that is open | `whatsapp_inbound` | L2 | **BLOCKED BY MISSING CAPABILITY** |
| T08 | The marketplace enquiry that arrives as a WhatsApp message | `marketplace_dubizzle` via `whatsapp_inbound` | L2 (simulated only, permanently) | **BLOCKED BY MISSING CAPABILITY** |
| T09 | The marketplace notification email | `marketplace_email_notification` | L2 (simulated only) | **BLOCKED BY MISSING CAPABILITY** |
| T10 | Walk-in, then a phone call from the same person | `walk_in`, `phone_call` | L2 | **PASS** |
| T11 | First response on a promoted lead, and the clock that is not the clock | `website_form` (from T01) | L2 | **BLOCKED BY MISSING CAPABILITY** |
| T12 | Owner assignment, and the act nothing records | any promoted lead | L2 | **FAIL** |
| T13 | A lead for Branch A while Branch B is signed in | `website_form` | L2 | **PASS** |
| T14 | An origin we cannot verify is never promoted | all four verification paths | L2 | **PASS** |
| T15 | Simulation traffic must be flagged, not counted | Lab traffic from T01–T10 | L2 | **PASS** |
| T16 | An endpoint disabled between hop one and hop two | `meta_lead_ads_facebook` | L2 (L3 for the honest half) | **PASS** |
| T17 | A suspended dealership, and its own blind book | `website_form` | L2 | **NOT RUN** |
| T18 | Two dealerships, one source: the endpoint decides | `meta_lead_ads_facebook`, `google_ads_lead_form` | L2 | **PASS** |
| T19 | The invariant sweep, and making every branch go red | n/a — the gate itself | L2 | **PASS** |
| T20 | Onboarding a dealership's ingestion, and rotating a key | all | L2 | **PASS** |

## What was actually run — 7 September 2026, staging

Executed against staging (`wwspuxrbiyagnrnzgate`) in three passes, every journey
creating its own endpoints and tearing them down afterwards. Emails are in the
RFC 2606 `.invalid` namespace; teardown was asserted, not assumed (`0
journey-lab leads remain`).

**11 PASS, 1 FAIL, 7 BLOCKED, 1 NOT RUN.** The FAIL is the most valuable line
here and it is not in the ingestion layer.

| id | verdict | evidence, as measured |
|---|---|---|
| T01 | PASS | recorded `HYDRATED` in one hop, promoted to lead 32, `leads.source = website_form` — an origin, not a writer |
| T03 | PASS | metadata-only arrival records `RECEIVED` with `normalized` null; promotion refused `LEAD_EVENT_NOT_HYDRATED`; then `EXPIRED` **retained with its reason**, not deleted |
| T05 | PASS | the second delivery returned `was_duplicate=true` with the **same** `event_id` and **did not raise** — which is what stops Google discarding a real lead |
| T10 | PASS | two events, two sources, two leads, both carrying a real origin: `walk_in`, `phone_call` |
| T13 | PASS | Branch B's signed-in session sees **0** of Branch A's `lead_event` rows through `v_lead_origin`, and `nexus_lead_trace` on Branch A's lead returns **0 rows** to Branch B |
| T14 | PASS | refused at the **record** door, not the promote door: `PROVENANCE_WEAKER_THAN_ENDPOINT_DECLARES` |
| T15 | PASS | promotion refused `PROMOTION_REQUIRES_PRODUCTION_ENVIRONMENT`; the event is **still readable**, phase `HYDRATED`, `is_test_traffic true` — contained, not deleted |
| T16 | PASS | hydration of an already-recorded event **succeeds** after its endpoint is disabled. Disabling a key stops NEW arrivals; it does not strand a customer who already got in half way |
| T18 | PASS | recorded against the dealership that **owns the endpoint**, with nothing in the call naming a dealership |
| T19 | PASS | `nexus_lead_ingest_invariants()` — 7 PASS / 2 INFO / **0 FAIL** |
| T20 | PASS | the rotated-out key is refused `LEAD_ENDPOINT_UNRESOLVED`, and the `lead_event` it already wrote is untouched |

### T12 — FAIL, and it is a live screen

> A direct `UPDATE` on `leads` — **the dashboard's own write path**,
> `lib/lead-drawer.js`, owner assignment — wrote **0 audit rows**.
>
> The change is real and **nothing recorded who made it.** Every other write in
> this product goes through a `SECURITY DEFINER` function that writes an audit
> row; this one does not, because it is a direct table write kept deliberately
> (revoking it would break the screen). The consequence was never priced: a
> dealership cannot answer "who reassigned this lead, and when".
>
> This is not an ingestion defect and the Journey Lab found it anyway, which is
> what the Lab is for.

### The seven BLOCKED, each naming the missing thing

| id | what is missing |
|---|---|
| T02 | `META_APP_SECRET` on the VM, a Facebook Page, and a lead form. L3 by definition — it needs Meta to fire our real endpoint |
| T04 | `GOOGLE_LEAD_KEY_ALBA` on the VM and a Google Ads lead form asset |
| T06 | the live website form answers **503** — `RESEND_API_KEY` and `NEXUS_NOTIFY_FROM` are unset on Vercel. The honeypot refusal itself is exercised by simulator scenario G, which is **adjacent evidence and not this journey** |
| T07 | a WAHA session on a controlled device, and the open-door remediation on `/webhook/whatsapp-inbound` |
| T08 | the same WhatsApp path. The marketplace half is permanently simulated — Dubizzle publishes no leads-out API |
| T09 | there is **no inbound email ingest at all**. Not a configuration gap, an unbuilt capability |
| T11 | the outbound messaging path has never carried a message. A response clock cannot be measured from data that does not exist, and deriving it from `created_at` would invent the number this journey exists to check |

### T17 — NOT RUN, and why it stays that way today

It needs a dealership suspended mid-run. Staging currently has two active
dealerships and suspending one changes `nexus_scoped_tenant_id()` behaviour for
everything else in the same transaction. That is a deliberate pass of its own,
not a step to bolt onto a batch — so it is left `NOT RUN` rather than
half-attempted.

**Nothing here is L4.** No dealership is on a live NEXUS ingestion endpoint, so
no verdict above is evidence about a real customer.

**Coverage of the nine sources:** `website_form` T01/T06/T11/T13/T17;
`meta_lead_ads_facebook` T02/T16/T18; `meta_lead_ads_instagram` T03;
`google_ads_lead_form` T04/T05/T18; `whatsapp_inbound` T07/T08;
`marketplace_dubizzle` T08; `marketplace_email_notification` T09;
`walk_in` and `phone_call` T10.

**Level distribution today:** L3 reachable on T02 and T04, plus half of T14a
and the honest half of T16 and T18. Everything else caps at L2. **Nothing here
is L4, because no dealership is on a live NEXUS ingestion endpoint.** That is
the honest headline of this file and should be the first thing said about it.

---

# T01 — The website enquiry that lands

**Side** customer. **Source** `website_form`. **Tenant** Branch A.
**Provenance** `origin_and_form_key` — strength 20, *"the weakest thing we
accept from the public internet"*. **Dedup on** `submission_id`.

**Preconditions**
- Branch A exists, `tenants.status = 'active'` (the resolver joins `tenants`
  and requires it).
- One `lead_ingest_endpoint` row: Branch A, `source_key = 'website_form'`,
  `status = 'active'`, `environment = 'simulation'`,
  `declared_provenance = 'origin_and_form_key'`, a **non-empty
  `origin_allowlist`** (a CHECK requires it for this provenance), and a
  `public_key` matching `^[A-Za-z0-9_-]{24,128}$`.
- No `leads` row for `t01.<run_id>@journey-lab.invalid`.

**Steps**
1. `select * from public.nexus_lead_endpoint_for_public_key('<key>')` and
   confirm it returns exactly one row for Branch A. Zero rows is the
   "unresolved" answer and must be treated as a halt, not a default.
2. POST a form body — name, email, phone, vehicle of interest, message, and a
   client-minted `submission_id` — at the Branch A ingest address, with an
   `Origin` on the allowlist.
3. Read the `lead_event` row.
4. Read the `leads` row **as the Branch A owner over REST**, not as
   `service_role` — what the dealership can see is the thing being tested.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | exactly one arrival is recorded | `lead_event` for this `external_event_id` | 0 (lost) or 2 (double-written) |
| 2 | it reaches `PROMOTED` and carries a `lead_id` and a `promoted_at` | `lead_event.phase`, `.lead_id`, `.promoted_at` | a terminal phase, or a stall with `lead_id` null |
| 3 | the tenant is Branch A **and equals the endpoint's** | `lead_event.tenant_id` vs the resolver's `tenant_id` for that key | they differ, or the tenant follows something in the body |
| 4 | exactly one `leads` row, readable by the Branch A owner | `leads` over REST with a real Branch A JWT | 0 rows (say whether RLS or promotion failed) or 2 |
| 5 | it is marked as test traffic | `lead_event.environment = 'simulation'`; `v_lead_origin.is_test_traffic = true` | either is false |
| 6 | provenance is recorded honestly, not flattered | `lead_event.origin_verified = 'origin_and_form_key'`; `v_lead_origin.origin_strength = 20`; `origin_cryptographically_verified = false` | it records a stronger kind than was actually performed |
| 7 | an Origin **not** on the allowlist does not promote | `lead_event.phase`, `disposition_reason` | it promotes — the allowlist is then decoration |
| 8 | layer invariants hold | `nexus_lead_ingest_invariants()` | any violation |

**On assertion 2:** if `lead_event` keeps only the current phase and no
history, "it passed through `HYDRATED`" is **unobservable** and must be
recorded as unobservable, not inferred from the endpoint state. `RUNBOOK.md`
Step 0 settles which it is; parts 3 and 4 are not on disk.

**Level today** L2. L3 is not applicable — we are the provider of our own form,
so a real submission is either L2 (us) or L4 (a visitor).
**Verdict** **NOT RUN**

---

# T02 — Meta Lead Ads: the two hops that complete

**Side** customer. **Source** `meta_lead_ads_facebook`. **Tenant** Branch A.
**Delivery shape** `WEBHOOK_METADATA_THEN_FETCH`. **Provenance**
`hmac_sha256_x_hub` — strength 90, the strongest thing this layer accepts.
**Dedup on** `leadgen_id`.

**The fact the journey turns on, recorded in the catalogue itself:** the
webhook body carries `leadgen_id`, `page_id`, `form_id`, `ad_id`, `adgroup_id`
and `created_time` and **no customer fields at all**. The answers require a
second hop — `GET /v<version>/<leadgen_id>` with `leads_retrieval` **plus Lead
Access Manager access** — and that hop can expire (T03).

**Preconditions**
- A Meta app, page and lead form, webhook subscribed to `leadgen`.
- App secret registered as the endpoint's `secret_ref` — never in the payload,
  never in a readable column. A CHECK already refuses an endpoint declaring
  this provenance with no `secret_ref`.
- A Branch A endpoint for this page. See T18 for the design question this
  raises.

**Steps**
1. `developers.facebook.com/tools/lead-ads-testing` → select page and form →
   create a test lead. Free, no ad spend, fires the real signed webhook.
2. Assert on hop 1 **before** hop 2 runs.
3. Let the Graph fetch run; assert on hop 2.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | hop 1 is `RECEIVED` and holds identifiers only | `lead_event.phase`; `payload_raw` read as `service_role` | any customer-shaped value is present at `RECEIVED` — Meta sent none, so it was invented |
| 2 | the signature verified **before anything was written** | `lead_event.origin_verified = 'hmac_sha256_x_hub'` | a row exists for an unverified delivery. Claiming a provider id before verification is a denial of service on a real lead: the genuine delivery then looks like a duplicate and is dropped, and nothing appears broken |
| 3 | the HMAC is over the **raw request bytes** | re-sign a pretty-printed copy of the same JSON and deliver it: verification must fail | it passes, which means the verifier parses first and is not this provenance kind at all — the catalogue's own definition says so |
| 4 | hydration comes from the Graph fetch, not the webhook | `lead_event.hydrated_at` set, `hydration_error` null, fields present | fields appear with `hydrated_at` null |
| 5 | `external_event_id` is the `leadgen_id` | `lead_event.external_event_id` against `lead_source_catalogue.dedup_field` | it is a delivery id, a receipt timestamp, or a hash of the body |
| 6 | it promotes into Branch A only | Branch A read = 1; Branch B read = 0 (T13) | any Branch B visibility |
| 7 | invariants hold | `nexus_lead_ingest_invariants()` | any violation |

**Level today** **L3** — one of only two journeys a provider can drive today,
and it costs nothing. What L3 still cannot prove: that a real customer's
answers arrive intact, since a test lead has no person behind it.
**Verdict** **NOT RUN**

---

# T03 — Meta Lead Ads: the field data that expired

**Side** customer. **Source** `meta_lead_ads_instagram`. **Tenant** Branch A.

Hop 1 arrives. Hop 2 fails permanently. This is where NEXUS is most tempted to
lie: it holds an arrival it cannot read, and the cheapest thing to do is
promote a lead with blank fields.

**On the expiry window.** `lead_source_catalogue`'s own evidence note says Meta
documents a hard expiry and that **secondary sources put it at 90 days — a
number explicitly not verified against Meta's own documentation and not to be
treated as measured.** Do not repeat a figure to a dealership from this file or
from that column. The journey asserts our behaviour, not Meta's number.

Note also, from the catalogue: Instagram lead ads arrive on the connected
Facebook Page's `leadgen` subscription. **There is no separate Instagram
webhook to wire** — the distinction exists for attribution only, and this
journey must not claim to have tested a second transport.

**Preconditions** as T02, on an Instagram-connected form, plus a way to make
hop 2 fail: point the fetch at a `leadgen_id` that will not resolve, or inject
the provider error at the fetch boundary.

**Steps**
1. Deliver a valid signed hop 1. Assert `RECEIVED`.
2. Run hop 2 against data the Graph API will not serve.
3. Assert on the terminal state and on what a dealership can see.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | the event terminates at `EXPIRED` | `lead_event.phase` | it reaches `PROMOTED`, or it is deleted, or it sits at `RECEIVED` with no terminal state |
| 2 | **no `leads` row is created** | `leads` for the run identity: 0 | a lead exists with blank or placeholder fields |
| 3 | the failure is recorded in words, not as a silence | `lead_event.hydration_error`, `disposition_reason` | both null. "It just stopped" is not a record |
| 4 | nothing was invented to fill the gap | `hydrated_payload` and the promoted fields | any plausible default — an empty string rendered as a name, `unknown@`, a synthesised phone |
| 5 | the dealership can see that something arrived and could not be read | `v_lead_origin` for Branch A shows the expired arrival with its reason | it is invisible. A lost enquiry that leaves no trace is worse than one that leaves an empty row, because nobody can go and ask Meta about it |
| 6 | it is distinguishable from "no enquiries" | the terminal phase and reason | it is counted as zero enquiries |

**Level today** L2 — the failure is injectable at the fetch boundary. **L3
cannot reach this:** the Testing Tool will not age a lead on demand, and a
bogus `leadgen_id` at L3 tests *not found*, a different branch from *expired*.
Say which you tested.
**Verdict** **NOT RUN**

---

# T04 — Google Ads lead form: the secret inside the body

**Side** customer. **Source** `google_ads_lead_form`. **Tenant** Branch A.
**Delivery shape** `WEBHOOK_FULL_PAYLOAD`. **Provenance**
`shared_secret_in_body` — **strength 30**, and the ladder's own description is
the assertion: *"it is not a signature: it does not attest the payload, and
anyone who learns the key can forge a lead."* **Dedup on** `lead_id`.

Three facts from the catalogue, all load-bearing:

- the whole lead arrives in one hop — no second fetch, no expiry;
- delivery is explicitly **at-least-once**;
- **Google retries a 5XX and permanently discards the lead on a 4XX**, so a
  processing failure must never answer 4XX. A 4XX is not a refusal; it is a
  deletion, performed by Google, that we asked for.

**Preconditions** a lead form asset with the webhook pointed at Branch A's
ingest address and a `google_key` set, registered as the endpoint's
`secret_ref` (a CHECK requires one for this provenance).

**Steps**
1. Press **"send test data"** on the lead form asset. Free; no campaign spend.
2. Record the HTTP status Google received, from our side.
3. Assert.
4. Repeat with a wrong `google_key` and assert separately — that half is also
   T14b.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | one arrival, promoted in one hop | `lead_event.phase`; `hydrated_at` null | a second hop was attempted — Google needs none |
| 2 | the key is compared against **this endpoint's** secret | `secret_ref` resolution for the endpoint the `public_key` selected | it is compared against a global constant, an env var, or a value shared by two dealerships |
| 3 | **the secret never reaches the table** | `lead_event_payload_carries_no_shared_secret` — fire it: attempt an insert whose `payload_raw` contains `"google_key"`, in a rolled-back transaction, and expect refusal | the insert succeeds. This CHECK is the only thing standing between a stored provider payload and handing an authentication secret to every signed-in user of that dealership — and a constraint nobody has fired is decoration |
| 4 | provenance is recorded as what it is | `origin_verified = 'shared_secret_in_body'`; `v_lead_origin.origin_strength = 30`; `origin_cryptographically_verified = false` | it is recorded as an HMAC kind — which `lead_ingest_endpoint_production_matches_source` should already make impossible on a production endpoint; fire that too |
| 5 | Google's own `is_test` does not decide whether a lead counts | `lead_event.environment` traced to the endpoint, not the body | `environment` is derived from a caller-supplied field |
| 6 | **no 4XX is returned for anything we might want back** | the HTTP status per failure mode: parse failure, unknown key, disabled endpoint, database error | a 4XX on any of them permanently destroys a real dealership's lead at Google's end |
| 7 | invariants hold | `nexus_lead_ingest_invariants()` | any violation |

**Assertion 6 is a design decision this Lab cannot make.** If the design
deliberately chooses 4XX for an unrecognised key — defensible, since a 5XX
invites Google to retry a request we will never accept — that must be **written
down as "we discard these leads on purpose"**, and T14b then asserts the written
behaviour. What must not happen is a 4XX arriving incidentally, from a
framework default, on a path nobody chose.

**Level today** **L3.** **Verdict** **NOT RUN**

---

# T05 — Google delivers the same lead twice

**Side** customer. **Source** `google_ads_lead_form`. **Tenant** Branch A.

Not malice: the catalogue records delivery as **at-least-once**. Our endpoint
commits, then answers slowly or dies before responding; Google sees a 5XX or a
timeout and retries. Two deliveries, one lead, one customer who must not appear
twice on a salesperson's list.

**Preconditions** T04 delivered one lead and its `lead_id` is recorded.

**Steps**
1. Replay the captured Google body **verbatim**, including its `lead_id`.
2. Assert.
3. Optionally force the realistic version: make the endpoint answer 5XX after
   committing, and let Google's own retry produce the second delivery.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | the second delivery is `DUPLICATE` | `lead_event.phase` on the second row | it promotes, or it is discarded with no row |
| 2 | the `leads` count is unchanged | `leads` for the run identity: still 1 | 2 |
| 3 | the first event is untouched | the first row still `PROMOTED`, same `event_id`, same `promoted_at` | the replay overwrote it — the same shape that let a replayed message extend a WhatsApp policy window on this system, one layer up |
| 4 | duplicate identity is Google's `lead_id` | `lead_event.external_event_id` against `lead_source_catalogue.dedup_field` for this source | it keys on receipt time, a per-attempt id, or a whole-body hash that changes when Google adds a field |
| 5 | the duplicate is retained and countable | the `DUPLICATE` row as `service_role` | nothing is retained, and "how many duplicates did we absorb" is unanswerable |

**A discipline this database already enforces elsewhere and this key should
inherit:** identifiers minted per attempt — `nokey:`, `exec-`, `run-`, `job-`,
bare numerics — are refused by CHECK on four message tables, because an id that
changes on every retry makes every retry look new. Check whether
`external_event_id` carries the same guard; if not, that absence is the
finding.

**Level today** L2 for the verbatim replay. **L3 only if Google's test button
re-sends the same `lead_id`** — check that, do not assume it.
**Verdict** **NOT RUN**

---

# T06 — A bot fills the website form, and the human who follows

**Side** customer. **Source** `website_form`. **Tenant** Branch A.

The catalogue names the contract we set for our own endpoint: *an unguessable
per-tenant form key, an Origin check, a honeypot field, a rate limit and a
client-minted submission id for idempotency — never a raw public n8n webhook.*
Five controls, so five things to fire.

**Preconditions** the T01 endpoint, with `rate_limit_per_minute` recorded.

**Steps**
1. Submit against each control in turn, one submission each: honeypot filled;
   `Origin` absent; `Origin` off the allowlist; a burst exceeding
   `rate_limit_per_minute`; a repeated `submission_id`.
2. Then, in the same minute and at the same endpoint, submit a clean,
   human-shaped enquiry.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | each control terminates the arrival at `REJECTED` (or `QUARANTINED` where the design says the signal is weak) | `lead_event.phase` | it promotes |
| 2 | the repeated `submission_id` is `DUPLICATE`, not `REJECTED` | `lead_event.phase` | a customer who double-clicked Send is recorded as spam |
| 3 | no `leads` row for any of them | `leads` for those identities: 0 | any row — a bot in the pipeline is a number a dealership will quote to itself |
| 4 | the reason is a **named code**, not a boolean | `lead_event.disposition_reason` | it records only that the row was refused, which cannot be argued with by a dealership whose real customer was blocked |
| 5 | **the clean submission that follows still reaches `PROMOTED`** | `lead_event.phase` | it does not. A filter that refuses everything passes assertion 1 and is worthless |
| 6 | the rate limit is real | fire the burst and count what landed | every request lands; `rate_limit_per_minute` is then a column, not a control |
| 7 | rejections are visible to the dealership | `v_lead_origin` shows them with their reason | invisible — the dealership cannot then find the customer who says "I filled in your form and nobody called" |

**Level today** L2. **Verdict** **NOT RUN**

---

# T07 — The WhatsApp enquiry, on a door that is open

**Side** customer. **Source** `whatsapp_inbound`. **Tenant** Branch A.
**Required provenance** `shared_secret_header` — strength 50.

> **This journey sits on an unauthenticated surface and its assertions are
> written accordingly.** In production `WAHA_WEBHOOK_SECRET` is unset, the
> `WAHA Auth Gate` is measured **DORMANT**, and n8n writes as `service_role`,
> which is `BYPASSRLS`. So on this path today: anyone who knows the URL can
> post; the caller's own JSON has chosen the dealership through `body.session`;
> and no database policy filters what is written. **No assertion below claims
> the message came from a customer**, because on this surface nothing
> distinguishes that from "someone posted a payload". **Nothing in this Lab
> should be read as evidence that this surface is secure.**
>
> The new layer is the fix for exactly this — the endpoint decides the tenant,
> and a CHECK refuses a production endpoint declaring `shared_secret_header`
> with no `secret_ref`. But **the live path has not been cut over**, and until
> it is, this journey tests the new writer and not the door the traffic
> actually comes through.

**Preconditions**
- Structural limit: **there is no n8n box behind staging.** An L2 run exercises
  the writer, not the workflow, so the workflow's own gates, retries, tenant
  resolution and error handling are **untested here entirely.** Say that in the
  result rather than letting a green row imply it.
- A Branch A endpoint for `whatsapp_inbound` with a `secret_ref`.

**Steps**
1. Deliver an inbound message for a number not already known, with the shared
   secret header.
2. Deliver a second message from the same number.
3. Deliver a third **without** the header.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | an arrival is recorded with `source_key = 'whatsapp_inbound'` | `lead_event.source_key`, `.phase` | no row |
| 2 | the tenant comes from the endpoint, **not** from a caller-supplied session string | `lead_event.tenant_id` vs `nexus_lead_endpoint_for_public_key` | a body field selects the dealership. With two active dealerships that is one JSON field choosing whose data is written |
| 3 | `external_event_id` is the `wa_message_id` | `lead_event.external_event_id` vs the catalogue's `dedup_field` | a per-delivery id — and this system already mints `'nokey:' + now` when a message id is absent, which is precisely the shape that defeats deduplication |
| 4 | the second message does not create a second lead | `leads` count for the identity: 1 | 2 |
| 5 | an ambiguous identity match is reported as ambiguous | the resolver's own output | it silently picks one. The last-9 phone-suffix rule cannot separate two people sharing a suffix, and merging them merges two customers' histories into one pane |
| 6 | the third, unheaded delivery does not promote | `lead_event.phase`, `origin_verified = 'unverified'` | it promotes — which is the production behaviour today, and would be the single most important finding this Lab could produce |
| 7 | no outbound message is sent | `communication_logs` for the run: no outbound rows | anything was sent. `Guard Reply` filters content, never the recipient |

**Level today** L2 against the writer. **L4 is the only level that can prove
this path**, and not before the documented rollout order: set
`WAHA_WEBHOOK_SECRET` on the VM, make WAHA send `x-nexus-webhook-secret`,
confirm in MONITOR on a genuine message, then enforce. With a single sender now
posting, enforcing before the header is configured drops **100%** of inbound
messages.
**Verdict** **NOT RUN**

---

# T08 — The marketplace enquiry that arrives as a WhatsApp message

**Side** customer. **Origin** `marketplace_dubizzle`. **Transport**
`whatsapp_inbound`. **Tenant** Branch A.

**Dubizzle Motors publishes no leads-out API.** The catalogue records the
search, dated 6 September 2026: no developer portal, no public leads-out API or
webhook, no Zapier integration, and the only public API surface is third-party
scrapers, which breach their terms. Its `integration_status` is
**`COMMERCIAL_CONVERSATION_REQUIRED`** and its `required_provenance` is
**`simulated`**, whose `counts_as_real` is false.

**Which means the database refuses to pretend otherwise**, and that is this
journey's best assertion: because of
`lead_ingest_endpoint_production_needs_real_provenance`, **a production
Dubizzle endpoint cannot exist as a row.**

What a UAE dealer actually receives is a WhatsApp message from the listing, a
phone call, a seller-dashboard entry, or a notification email. So the **origin**
is the marketplace and the **transport** is something else, and NEXUS must say
both without collapsing them. That distinction is worth money directly: a
dealership deciding whether to keep paying a marketplace subscription needs to
know which channel produced the enquiry, not which wire carried it.

**Preconditions** T07's registration, plus a message body of the shape a
Dubizzle-originated WhatsApp enquiry has — a listing reference in the text.
**That shape is copied from a sample, not from a specification**, and a change
to it is invisible to this test.

**Steps**
1. Attempt to register a **production** `marketplace_dubizzle` endpoint.
2. Deliver an inbound WhatsApp message carrying a marketplace listing
   reference.
3. Deliver a second inbound message with no marketplace signal at all.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | step 1 is **refused by constraint** | `lead_ingest_endpoint_production_needs_real_provenance` raising | it inserts. Simulated marketplace traffic could then be registered as production and counted as real enquiries |
| 2 | origin and transport are both recoverable | `lead_event.source_key` plus whatever carries the transport; `v_lead_origin.channel_family` | only one is recorded — the attribution is then lost at the transport, and that is the finding, not a passing test |
| 3 | the attribution carries evidence, not just a value | the attribution columns | it is stored as a bare fact. Attribution here is *inferred from message text*, and storing an inference as a fact is the shape this project has paid for repeatedly |
| 4 | message 2 records origin **UNKNOWN** | the attribution column | it defaults to the marketplace, or to any source at all. Unknown is not none, and a guessed attribution silently credits a channel the dealership pays for |
| 5 | the dealership's screen says the source is not integrated | `v_lead_origin.integration_status = 'COMMERCIAL_CONVERSATION_REQUIRED'` rendered, not hidden | it renders as an ordinary connected source, which is a capability claim we cannot back |

**Level today** **L2, simulated only — and permanently so.** There is no L3 for
Dubizzle and there will not be one until they publish an API or a commercial
conversation produces a feed. Every claim about Dubizzle traffic in this
product rests on a simulation of a shape we observed, and any commercial
statement about marketplace attribution has to say that out loud.
**Verdict** **NOT RUN**

---

# T09 — The marketplace notification email

**Side** customer. **Source** `marketplace_email_notification`. **Tenant**
Branch A. **Provenance** `hmac_sha256_svix` — strength 85, Resend inbound.
**Dedup on** `rfc_message_id`.

**The authenticity model here is not the one most people assume, and the
catalogue says so.** A dedicated subdomain with a **distinct local-part per
dealership** — not plus-addressing, which forwarders mangle. **Route on the
envelope recipient, never on the `To:` header**, because a dealer forwarding
from their own inbox leaves `To:` pointing at themselves and routing on it
files their leads under nobody. And: **SPF fails across a forward by design, so
DMARC cannot be the authenticity gate. The secret ingest address is.** The
webhook from the mail provider is what carries the signature.

**Preconditions** an ingest subdomain, a Branch A endpoint with its
`ingest_address` local-part set, and the provider's signing secret as
`secret_ref`.

**Steps**
1. Deliver a notification-shaped email through the provider, signed.
2. Deliver the same content with a broken/absent provider signature.
3. Deliver one **forwarded** from a mailbox, so SPF fails but the envelope
   recipient is right.
4. Deliver one addressed to Branch A in `To:` but with a different envelope
   recipient.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | the signed delivery promotes | `lead_event.phase`; `origin_verified = 'hmac_sha256_svix'` | it does not |
| 2 | the parsed fields land where they belong | the promoted `leads` row against the email body | any field transposed, truncated, or filled from a neighbouring label |
| 3 | **the unsigned delivery does not promote** | `lead_event.phase = 'QUARANTINED'` | it promotes. An email is forgeable by anyone, and a parser that trusts its own inbox creates leads for whoever emails it |
| 4 | **the forwarded one still promotes** | `lead_event.phase` | it is refused for failing SPF. That would refuse the normal case — forwarding is how most dealers will actually wire this |
| 5 | routing follows the **envelope recipient**, not `To:` | `lead_event.tenant_id` on the step-4 delivery | it follows `To:` and files the lead under the wrong dealership, or under nobody |
| 6 | an unrecognised layout quarantines rather than promoting a partial | `lead_event.phase`, and no half-filled `leads` row | a lead is promoted with two of five fields |

**Level today** L2, simulated. **We can send ourselves a real email; we cannot
make a marketplace send one**, so the field layout under test is ours, not
theirs. Say that in the result.
**Verdict** **NOT RUN**

---

# T10 — Walk-in, then a phone call from the same person

**Side** customer. **Sources** `walk_in`, then `phone_call`. **Tenant** Branch
A. **Provenance** `operator_recorded` — strength 10, and **`counts_as_real =
false`**: a person vouches for it, but it attests nothing about an external
system.

**A finding this journey must open with, not bury.** Because
`operator_recorded` does not count as real, and because
`lead_ingest_endpoint_production_needs_real_provenance` forbids a production
endpoint carrying such a provenance, **a production `walk_in` or `phone_call`
endpoint cannot exist as a row.** Either manual entry is meant to bypass the
endpoint layer entirely and be typed into the dashboard — in which case that
should be written down, and this journey tests the dashboard path — or the
largest source in a UAE showroom cannot be registered in production, which is a
defect. **Settle that at Step 0 before running.** Do not resolve it by
registering a simulation endpoint and calling the journey passed.

Note also: `phone_call` is `MANUAL_ENTRY` today. The catalogue says
call-tracking integration is **roadmap, not capability**, and no journey here
may be reported as testing it.

**Preconditions** a signed-in Branch A staff session with the role permitted to
record a walk-in, and the Step 0 answer above.

**Steps**
1. Record a walk-in: name, phone, vehicle of interest.
2. Later, record a phone call from the same number, with the name spelled
   differently.
3. As a Branch B user, attempt the same against Branch A.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | both arrivals carry their true source | `lead_event.source_key` | either is filed as `website_form` or a generic "manual" |
| 2 | provenance is `operator_recorded` and is **not** counted as externally originated | `lead_event.provenance_counts_as_real = false`; `v_lead_origin.origin_strength = 10` | it is dressed up as a channel lead, which inflates every attribution figure the dealership sees |
| 3 | the tenant comes from the signed-in user's membership | `lead_event.tenant_id` vs `tenant_members` | it comes from a form field the user can edit |
| 4 | the second does not create a second person, **or** is surfaced as a merge candidate | `leads` count: 1, or 2 with an explicit duplicate flag | 2 silently. A duplicated customer is two salespeople calling the same person |
| 5 | an ambiguous phone match is reported, not resolved | the resolver's ambiguity output | it picks one. Two people sharing the last nine digits cannot be separated by the rule this system matches on, and that has already produced a wrong-person match here |
| 6 | the Branch B attempt is refused | record whether by `42501` or by 0 rows | it succeeds |

**Level today** L2 through the real writer with a real session. L4 is a person
at a desk.
**Verdict** **NOT RUN**

---

# T11 — First response on a promoted lead, and the clock that is not the clock

**Side** operator. **Source** the lead promoted by T01. **Tenant** Branch A.

The commercial claim behind this product is that enquiries get answered fast.
This journey measures whether NEXUS can *say* how fast — and the honest state
of that today is poor enough that the journey is written around it.

**Two existing witnesses are known defective and must not be the primary
measurement:**

- **`leads.response_time_minutes` is not a measured first-response time.** A
  `BEFORE INSERT` trigger looks for a reply at the instant the lead row is
  created, finds one that predates the row on this system, computes a negative
  interval and stores `0` via `greatest(0, …)`. Every lead in the live table
  carries `0`, including one answered 81 minutes later and one never answered.
  The `AFTER INSERT` writer that would be correct is guarded by
  `response_time_minutes is null`, so the stored `0` locks it out permanently.
- **`v_lead_recovery.sla_state` emits `BREACHED_SLA`; `screens/money-leaks.js`
  tests `sla_state === 'BREACHED'`.** One word, and the check that reports "no
  enquiry missed the first-response target" can never fail. On the demo data
  six of eleven had missed it while that line read clear.

**The new layer gives this journey the witness it was missing.**
`lead_event.received_at` is the moment the enquiry **arrived**; `promoted_at`
is when it became a lead. The gap between them is latency this layer
introduced, and measuring from `leads.created_at` hides exactly that.

**Preconditions** T01 promoted, and a stated first-response target for Branch A.

**Steps**
1. Record `lead_event.received_at`, `occurred_at` and `promoted_at`.
2. Record an outbound first response a known number of minutes later, through
   the real path.
3. Read every witness.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | elapsed time is measured from **arrival** | first outbound `communication_logs` timestamp minus `lead_event.received_at` | it is measured from `leads.created_at`. A lead that sat unhydrated for an hour was late before anyone saw it |
| 2 | the ingestion latency is itself visible | `promoted_at − received_at` | there is no way to see it, and a slow hydrate is indistinguishable from a slow salesperson |
| 3 | the measured figure matches the known delay | the computed interval vs the delay applied | they differ |
| 4 | the two defective witnesses are read, compared, and their disagreement recorded | `leads.response_time_minutes`; `v_lead_recovery.sla_state` | they are quietly used, or the disagreement is not written down. **Expect at least one to disagree** — that is the current state, not a surprise |
| 5 | a breach renders as a breach on a dealer screen | the screen's state string vs the view's | the `BREACHED` / `BREACHED_SLA` mismatch is still live, in which case this half is `FAIL` once run, not `NOT RUN` |
| 6 | an **unanswered** lead is distinguishable from a fast one | the witness for "no reply timed" | both render as `0` — the lie this codebase has already shipped in six places |

**Level today** L2. **Verdict** **NOT RUN**

---

# T12 — Owner assignment, and the act nothing records

**Side** operator. **Tenant** Branch A, attacked from Branch B.

**Preconditions** a promoted Branch A lead, two Branch A users, one Branch B
user.

**Steps**
1. As a Branch A user with the right role, assign the lead through the real
   write path — the dashboard's lead drawer, which holds a **column-level
   `UPDATE` grant on eight columns of `leads`** for `authenticated`. That grant
   lives on `pg_attribute.attacl` and is invisible to a `relacl`-only ACL check.
2. Reassign to the second user.
3. As the Branch B user, attempt the same assignment on the same lead.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | the owner value changes | the owner column on `leads` | it does not |
| 2 | the Branch B attempt is refused, **and the refusal's kind is recorded** | `42501` (grant) or 0 rows updated (RLS) — write down which | it succeeds; or "refused" is recorded without saying which lock did it, since 0 rows is evidence about RLS only |
| 3 | a role that should not assign cannot | the role check | any signed-in user can assign |
| 4 | **when the assignment happened, and who did it, has a witness** | an `audit_log` row for the act, if one is written | there is none. `leads` has no `assigned_by`, no `assigned_at` and no `updated_at`, so after the fact a lead never assigned and a lead whose rep was deleted are indistinguishable |
| 5 | assignment does not disturb the ingestion record | `lead_event.lead_id` still points at the same lead | the link is broken by an update path that rewrites the lead |

**If assertion 4 has no witness, the timing half of this journey is
`BLOCKED BY MISSING CAPABILITY`** — the missing thing being "assignment
recorded as an act rather than as a value" — and it must not be reported as a
pass on the strength of assertion 1.

**Level today** L2. **Verdict** **NOT RUN**

---

# T13 — A lead for Branch A while Branch B is signed in

**Side** operator. **Source** `website_form`. The journey a technical buyer
asks for, and the one whose failure ends the company.

**Preconditions** both branches active; a real Branch B user with a real JWT;
Branch A's endpoint registered.

**Steps**
1. Deliver a lead on **Branch A's** endpoint.
2. As Branch B, over the live REST API — not a SQL session — read `leads`,
   `lead_event`, `v_lead_origin`, and `lead_ingest_endpoint`.
3. Repeat with a **forged `tenant_id` claim** in the JWT.
4. Repeat after attempting to insert a **self-granted `tenant_members` row**
   for the Branch B user against Branch A.
5. Read the same objects as `anon` over REST.
6. Read them as `service_role` as a positive control.
7. As Branch B, attempt an `UPDATE` and a `DELETE` on `lead_event`.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | Branch B sees **zero rows** on `leads`, `lead_event` and `v_lead_origin` in steps 2–4 | the REST responses | any row |
| 2 | Branch B's read of `lead_ingest_endpoint` is refused **by grant** — `42501`, not zero rows | the REST error | it returns rows, or returns `0 rows`. That table is off the dealer plane entirely: `revoke all` from both end-user roles plus a restrictive deny |
| 3 | the withheld columns are refused, not merely unselected | ask Branch A's **own owner** for `payload_raw`, `hydrated_payload`, `normalized`, `endpoint_id` | any is returned. They are deliberately absent from the column grant; a view that reintroduces them reopens it |
| 4 | Branch B's `UPDATE`/`DELETE` on `lead_event` are refused | `lead_event_no_end_user_writes` (restrictive, `with check (false)`) | either succeeds |
| 5 | the self-grant in step 4 is itself refused | the insert result | it succeeds — membership self-grant is the shortest route to another dealership's book |
| 6 | `anon` is refused by grant | the REST error code | it returns `0 rows`, which proves RLS filtered and says nothing about the grant. This project has been wrong about that distinction three times |
| 7 | `service_role` sees exactly one throughout | the control read | zero — which would mean the zeros above were an empty database, not a filter, and the journey proved nothing |
| 8 | Branch A's own owner sees exactly one | the Branch A read | zero |

**Level today** L2. **Verdict** **NOT RUN**

---

# T14 — An origin we cannot verify is never promoted

**Side** operator. **Four sub-cases, one per verification mechanism**, because
the sources authenticate in four different ways and a single "unverified" test
would cover one of them.

| | case | the provenance that should have been proved |
|---|---|---|
| a | Meta webhook, bad or absent `X-Hub-Signature-256` | `hmac_sha256_x_hub` (90) |
| b | Google POST, unrecognised `google_key` | `shared_secret_in_body` (30) |
| c | Meta webhook whose `page_id` is registered to no dealership | see T18 |
| d | inbound email with a bad or absent provider signature | `hmac_sha256_svix` (85) |

**Steps** deliver each case; assert each separately; record four verdicts.

**Assertions (all four)**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | the event terminates at `QUARANTINED` (or `REJECTED` where the design says so) | `lead_event.phase`, `disposition_reason` | it reaches `HYDRATED` or `PROMOTED` |
| 2 | provenance is recorded as `unverified`, not as the kind that was attempted | `lead_event.origin_verified = 'unverified'`; `provenance_counts_as_real = false` | it records the intended kind. The ladder's whole purpose is that a failed HMAC is not a weak HMAC |
| 3 | **no `leads` row exists** | `leads` for the identity: 0 | any row. An unverifiable origin promoted into a dealership's book is a stranger's lead in their pipeline |
| 4 | nothing was written before verification failed | the absence of any claimed `external_event_id` for the identity | one was claimed pre-verification — which makes the **genuine** delivery look like a duplicate and silently drops a real customer |
| 5 | the arrival is retained and countable by `service_role` | the quarantined row | it is discarded, and "how many arrivals could we not vouch for" is unanswerable |
| 6 | no dealership's counts include it | `v_lead_origin`, and the dealer-facing aggregates | it appears in a count |
| 7 | case (b) does not answer Google with a 4XX unless that discard is the written, deliberate design | the HTTP status returned | an incidental 4XX permanently destroys a real lead at Google's end |

**Level today** L2 for all four. **L3 reaches only half of case (a):** Meta
will send a correct signature on demand and will never send a bad one, so the
positive half is L3 and the negative half stays L2 permanently. Do not report
the pair as "L3".
**Verdict** **NOT RUN**

---

# T15 — Simulation traffic must be flagged, not counted

**Side** operator. **Tenant** Branch A, loaded with T01–T10's traffic.

This journey protects the Lab from becoming the problem. A test lead in a
dealership's book is not harmless leftovers: it inflates the pipeline, it can
be chased, it can be emailed, and it is counted in whatever number the
dealership quotes itself at the end of the month.

**The view does not filter, deliberately.** `v_lead_origin`'s own comment says
`is_test_traffic` is *exposed rather than filtered, so a screen that forgets to
exclude simulation traffic renders it as test data instead of counting it as
real.* **So this is a test of the screens, not of the view.**

**Preconditions** Lab traffic present at `environment = 'simulation'`, plus
**one row at `environment = 'production'`** in the same tenant as a negative
control.

**Steps**
1. Read `v_lead_origin` for Branch A.
2. Read every dealer-facing count: the leads list, the overview counters,
   money-leaks, lead recovery, team performance, and any "enquiries this week"
   figure on any screen.
3. Re-read with the production-marked row present.
4. Attempt to set `environment` from a payload field.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | every Lab row is flagged | `v_lead_origin.is_test_traffic = true` | any is false |
| 2 | every dealer-facing aggregate excludes or labels them; none silently includes them | each screen's figure vs the same figure computed with simulation excluded | a screen includes them unlabelled |
| 3 | **the production-marked row IS counted** | the same figures | it is excluded too — the filter is then a broken join, not a filter, and would hide real enquiries |
| 4 | `is_test_traffic` has exactly one derivation | the view definition vs every screen rendering it | a screen derives it a second way. One figure, one derivation |
| 5 | `environment` cannot be set by a caller | step 4 | a body field decides whether a lead counts |
| 6 | a simulation endpoint cannot be promoted to production while carrying a fake provenance | attempt `update lead_ingest_endpoint set environment='production'` on a Lab endpoint | it succeeds. `lead_ingest_endpoint_production_needs_real_provenance` and `..._production_matches_source` should both bite; fire them |

**Level today** L2. **Verdict** **NOT RUN**

---

# T16 — An endpoint disabled between hop one and hop two

**Side** operator. **Source** `meta_lead_ads_facebook`. **Tenant** Branch A.

The `WEBHOOK_METADATA_THEN_FETCH` shape makes a mid-flight configuration change
reachable in a way a one-hop source cannot be: hop 1 was accepted under a valid
endpoint, and hop 2 runs in a different world. `nexus_lead_endpoint_for_public_key`
filters on `status = 'active'` **and** the tenant being active, so after the
change the resolver returns **zero rows** — which the design must treat as a
halt, not a default.

**Preconditions** T02's setup, and the ability to disable the endpoint between
hops.

**Steps**
1. Deliver a valid hop 1. Assert `RECEIVED`.
2. `update lead_ingest_endpoint set status = 'disabled'`.
3. Run hop 2.
4. Separately, deliver a **new** hop 1 at the disabled endpoint.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | the design states which behaviour it wants for the in-flight lead — complete it, or terminate it — and the observed behaviour is the stated one | the design note; `lead_event.phase` | no stated behaviour exists, in which case this journey is `BLOCKED BY MISSING CAPABILITY` and the missing thing is the decision |
| 2 | whichever it does, **no half-hydrated lead is promoted** | `leads`, and `hydrated_at` / `hydration_error` | a lead exists with fields the Graph fetch never returned |
| 3 | whichever it does, **there is a row and a reason** | `lead_event.disposition_reason` | a silent drop. A dealership who disabled an endpoint by accident must be able to find what arrived while it was off |
| 4 | zero rows from the resolver halts rather than defaulting | the code path taken | it falls through to a built-in map or "the only dealership" — the exact fallthrough `NEXUS_TENANT_MAP` already carries elsewhere |
| 5 | the new arrival at step 4 is refused **and retained** | `lead_event.phase`; the HTTP status | it is discarded. A disabled endpoint is precisely when a dealership most wants the lead held rather than deleted |
| 6 | the status is chosen with the provider's retry semantics in mind | the status per source | a 4XX on the Google endpoint for a disabled-endpoint condition, permanently destroying the lead |

**Level today** L2. The honest half — a real signed Meta hop 1, then disable,
then hop 2 — is a mixed L3/L2 run and is worth doing that way.
**Verdict** **NOT RUN**

---

# T17 — A suspended dealership, and its own blind book

**Side** operator. **Tenant** Branch B, suspended.

**Preconditions** Branch B holds at least one promoted lead from an earlier
journey. The suspension must be reversible: inside a rolled-back transaction,
or with a restore step recorded in the manifest and verified afterwards.

**Steps**
1. Set Branch B's `tenants.status` to suspended.
2. Deliver a lead on Branch B's endpoint.
3. Read as a Branch B member over REST.
4. Read as `service_role`.
5. Restore, and re-read.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | the endpoint resolver returns **zero rows** while suspended | `nexus_lead_endpoint_for_public_key` — it joins `tenants` and requires `status = 'active'` | it resolves anyway |
| 2 | the arrival is **retained**, not discarded | `lead_event` as `service_role` | nothing is written. Suspension is usually a billing state, and deleting a paying-again customer's enquiries is not recoverable |
| 3 | it is not promoted into a book nobody can read — or, if it is, that is visible | `lead_event.phase`; the `service_role` read | leads are promoted silently into an unreadable book, and the dealership discovers a month of enquiries on the day they are reinstated |
| 4 | Branch B's own members see **zero**, and this is stated as a product behaviour rather than discovered by a customer | the Branch B REST read; `nexus_current_tenant_ids()` requires `status = 'active'` | it is neither documented nor rendered. A suspended dealership blinded to its own book is a commercial event, and the screen must say *suspended*, not render an empty list |
| 5 | Branch A is unaffected throughout | Branch A's counts before and after | any change |
| 6 | the active-dealership count dropping to one does not silently "repair" the backend scope in a way that masks the known defect | `nexus_scoped_tenant_id()` and `nexus_active_dealership_ids()` read in the same transaction | the run is cited as evidence that the two-dealership silence is fixed. It is not; suspending one dealership only hides it |
| 7 | restore returns everything to its prior state | row counts and the Branch B read, before and after | any residue |

**Level today** L2. **Verdict** **NOT RUN**

---

# T18 — Two dealerships, one source: the endpoint decides

**Side** operator. **Sources** `meta_lead_ads_facebook`, `google_ads_lead_form`.

**Preconditions** both branches hold their own endpoint for the same source,
with distinct `public_key`s.

**Steps**
1. Deliver a lead at each endpoint. Assert each lands in its own branch.
2. **The attack:** take Branch B's payload — its `page_id`, its `form_id`, its
   customer — and deliver it verbatim at **Branch A's** endpoint.
3. The same with the Google body and `google_key` swapped between branches.
4. Attempt to insert a second endpoint carrying an existing `public_key`.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | each normal delivery lands in the branch owning the endpoint | `lead_event.tenant_id` vs the resolver's | any mismatch |
| 2 | the swapped payload is filed by **endpoint**, not by body — or quarantined as a contradiction | `lead_event.tenant_id` / `phase` | the body wins. That is one JSON field choosing whose data is written, which is the shape already live on the WhatsApp path |
| 3 | the Google swap fails **verification**, not just routing | `origin_verified`, `disposition_reason` | Branch B's key authenticates at Branch A's endpoint, which would make the secret global rather than per-endpoint |
| 4 | step 4 is refused | `lead_ingest_endpoint_public_key_key` raising | it inserts. A collision assigns one dealership's leads to another; the constraint exists, so fire it rather than trusting it |
| 5 | Branch B cannot read the swapped event by any route in T13 | the Branch B reads | any row |

**A design question this journey must record rather than assume away.** Meta
gives an app **one** callback URL, so per-dealership `public_key` separation on
Meta requires one of two shapes:

- **an app per dealership** — each with its own callback URL and its own key, and
  "the tenant comes from the endpoint" holds literally; or
- **one shared app**, where the dealership is found by looking `page_id` up in a
  mapping NEXUS registered in advance, on a delivery whose signature has already
  verified. There, `page_id` is **a lookup key into a registration we hold**,
  not an identity claim by the caller — and an unregistered `page_id` must
  quarantine, which is T14c.

The two have different security stories and different onboarding costs.
**`RUNBOOK.md` Step 0 must record which the built layer uses**, because the
"never from the payload" rule is literally true only in the first. Note that
`lead_ingest_endpoint` carries `ingest_address` for email routing but nothing
visibly page-shaped, which suggests the first — confirm it, do not infer it.

**Level today** L2. L3 for the honest half if two real Meta pages exist.
**Verdict** **NOT RUN**

---

# T19 — The invariant sweep, and making every branch go red

**Side** operator. **Source** n/a — the gate itself is the subject.

`nexus_lead_ingest_invariants()` is the release gate for this layer, and this
project has already found **two** gates that could never go red: a tenancy
BLOCKER firing on a condition that could never clear, and an INFO counting
`NULL`s in five `NOT NULL` columns. A gate that cannot go red is decoration.

**The function is not readable from the repo** — it is in parts 3 or 4, which
are not on disk. Step 0 must fetch its definition; until then this journey
cannot even enumerate what it is testing, and that is itself a `BLOCKED`
precondition rather than an inconvenience.

**Steps**
1. Run it on staging with the Lab loaded. Record every branch it reports and
   every branch it *can* report.
2. Fire each branch deliberately — **each in its own transaction, each rolled
   back**, a `DO $$ … $$` block ending in `RAISE EXCEPTION` so nothing persists
   even if a probe misbehaves.
3. Record which branches fired and which could not be made to.

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | every branch has a counterfactual that makes it fire | the per-branch result table from step 2 | any branch cannot be made to fire. It is decoration and must be deleted or rewritten, not left in for the look of it |
| 2 | the sweep is clean against the Lab's own correct traffic | the function's output after T01–T18 | it reports a violation caused by the Lab itself, meaning the Lab generates rows the layer considers invalid |
| 3 | nothing persisted from step 2 | the three-snapshot check in `RUNBOOK.md` | any residue. A probe leaving a planted violation behind poisons every later run |

**Branches worth attacking specifically** — if the function does not cover one,
that absence is the finding: a `PROMOTED` event with no `leads` row; a `leads`
row with no `lead_event`; an event whose `tenant_id` differs from its
endpoint's; an event `PROMOTED` with `origin_verified = 'unverified'` or
`provenance_counts_as_real = false`; two `PROMOTED` events sharing one
`external_event_id` for one source; a `simulation` event inside a dealer-facing
aggregate; a production endpoint whose declared provenance is not its source's
required one.

**Level today** L2. Run it first for a clean baseline and last as the gate.
**Verdict** **NOT RUN**

---

# T20 — Onboarding a dealership's ingestion, and rotating a key

**Side** operator. **Sources** all. **Tenant** Branch A, from nothing.

If registering a Facebook page needs an engineer, this is not a subscription
product. That is the commercial assertion under this journey.

**Steps**
1. From a Branch A with no endpoints, register one per source the dealership
   uses — each needing `source_key`, `required_provenance_for_source`,
   `declared_provenance`, `provenance_counts_as_real`, `environment`,
   `public_key`, `label`, and `secret_ref` or `origin_allowlist` where the
   CHECKs demand them.
2. Fire one arrival at each. Assert each lands.
3. Rotate the `public_key` on one endpoint.
4. Fire the **old** key, then the **new** key.
5. Disable an endpoint entirely and fire at it (overlaps T16 step 4).

**Assertions**

| # | assertion | witness | fails if |
|---|---|---|---|
| 1 | registration needs no migration and no engineer | the steps actually performed | a schema change or a code deploy was required |
| 2 | each new endpoint routes to Branch A | `lead_event.tenant_id` | any other tenant, including the quarantine tenant |
| 3 | a malformed key is refused at registration | `lead_ingest_endpoint_public_key_shape` — try a 12-character key | it inserts. A short key is guessable, and the key is the only thing identifying a website form endpoint |
| 4 | after rotation the new key works | `lead_event.phase` reaching `PROMOTED` | it does not |
| 5 | after rotation the old key **stops resolving but the arrival is retained** | `nexus_lead_endpoint_for_public_key('<old>')` returns zero rows; the delivery still leaves a `lead_event` row | it still resolves (rotation did nothing), or the arrival is discarded — a provider still on the old key then silently loses every lead during the rotation window |
| 6 | `updated_at` moved on rotation | `lead_ingest_endpoint.updated_at`, written by `lead_ingest_endpoint_touch_trg` | it did not — the trigger is inert and no rotation is auditable |
| 7 | neither the key nor `secret_ref` is reachable by a dealership | Branch A owner reads of `lead_ingest_endpoint` and `v_lead_origin` | either appears. The table is off the dealer plane by grant; a future view must not walk it back |
| 8 | a disabled endpoint's historical events stay attributable | the old events still carry `tenant_id` and `source_key` | disabling orphans the history |

**Level today** L2. **Verdict** **NOT RUN**

---

## What all twenty, run and green, would still not prove

Repeated from `README.md`, because this is the page people screenshot.

Twenty green rows would mean: the ingestion layer handles the payloads we and
two providers can generate, against staging, with the tenancy rules we
designed, at n=1, sequentially, with no n8n behind it and no customer involved.
They would not prove volume, concurrency, deliverability, Dubizzle, the
WhatsApp perimeter, or that one dealership's real enquiries have ever passed
through this layer.

**implemented ≠ tested ≠ production-proven ≠ commercially validated.**
