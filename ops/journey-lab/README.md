# NEXUS JOURNEY LAB

**Written 6 September 2026.** This directory is documentation and a test plan.
It runs nothing on its own, it creates no database object, and it touches no
n8n workflow.

**Status of every journey in this Lab: NOT RUN.** All twenty rows in
`TEST-MATRIX.md` carry the verdict `NOT RUN` and none of them has been
executed. Nothing here has been converted to `PASS`, by inference or otherwise.

---

## What this Lab is

`JOURNEYS.md` covers what happens to a lead **after** NEXUS holds it — the
conversation, the finance quote, the KYC loop, the deal, the audit row. It
begins at a lead that already exists.

The Journey Lab covers the half hour before that: **how a lead gets in at all,
from nine named sources, into the right dealership, without a second one being
able to see it.** That layer was built and proven on staging on 6 September
2026 and it now carries every entry point NEXUS has:

| source value | transport | can a provider fire our real endpoint today? |
|---|---|---|
| `meta_lead_ads_facebook` | Meta webhook, then a Graph API fetch | **yes** — Meta's Lead Ads Testing Tool, free |
| `meta_lead_ads_instagram` | same webhook, different page/form | **yes** — same tool |
| `google_ads_lead_form` | one HTTPS POST from Google | **yes** — "send test data" in the lead form asset, free |
| `website_form` | our own page posting to our own endpoint | yes — it is our page |
| `whatsapp_inbound` | WAHA → n8n | yes, and **the door is open** (see below) |
| `walk_in` | a person typing | yes — a person |
| `phone_call` | a person typing | yes — a person |
| `marketplace_dubizzle` | **none** — Dubizzle Motors publishes no leads-out API | **no.** Simulated only — and a *production* Dubizzle endpoint cannot exist as a row |
| `marketplace_email_notification` | a notification email we parse | partly — we can send ourselves a real email; we cannot make Dubizzle send one |

Every arrival becomes a `lead_event` row and walks
**RECEIVED → HYDRATED → PROMOTED**, or stops at one of the terminal phases
**DUPLICATE / REJECTED / QUARANTINED / EXPIRED**. The dealership is decided by
the registered endpoint the request arrived on — `lead_ingest_endpoint.public_key`
— and never by anything in the payload. That single rule is what most of the
dealer-side journeys in this Lab exist to attack.

---

## The one thing to read before trusting any name in these files

The ingestion layer is being built in parts, and the repository is mid-way
through catching up with it. Measured 6 September 2026, the working tree
carries **parts 1, 2 and 5** as untracked migrations:

| migration | what it defines |
|---|---|
| `..._leadingest_01_provenance_and_source_vocabulary.sql` | `lead_provenance_kind`, `lead_source_catalogue`, both seeded |
| `..._leadingest_02_tenant_bound_endpoints.sql` | `lead_ingest_endpoint`, `nexus_lead_endpoint_for_public_key()` |
| `..._leadingest_05_the_dealer_read_path_and_the_secret_in_the_payload.sql` | `lead_event`'s dealer read path, its column grants, `v_lead_origin` |

**Parts 3 and 4 are not on disk.** They carry `lead_event`'s own DDL and the
writer/hydrator. So:

- the **endpoint**, the **source catalogue**, the **provenance ladder** and
  **`v_lead_origin`** are named in these files from the migrations themselves;
- **`lead_event`'s columns** are read from part 5's `grant select (...)` list
  and its CHECK — real, but a projection of the table rather than its
  definition;
- the **phase vocabulary**, the **disposition reasons** and
  **`nexus_lead_ingest_invariants()`** are readable nowhere in the repo and are
  named from the brief for that work.

`RUNBOOK.md` Step 0 is a schema reconciliation for exactly this reason, and it
is not optional. If a witness named here does not exist under that name, the
journey it belongs to is `BLOCKED`, not adapted quietly to whatever is nearby.
This project has already paid three times for a check written against what a
document said the schema was.

### One correction the migrations forced, and it changes how three journeys read

`lead_ingest_endpoint.public_key` **identifies; it does not authenticate.** The
table's own comment says to *"treat every request bearing one as
unauthenticated until its `declared_provenance` has actually been verified"*.
The authenticator, where a source has one, is named by `secret_ref` and stored
elsewhere — `channel_registry`'s discipline. Provenance is a **ranked ladder**,
not a boolean: an HMAC over raw bytes (90) and a secret sitting in a JSON body
(30) are both "authenticated" and are not the same claim, and
`v_lead_origin.origin_strength` exists so a screen can never present them as
equal.

## Four levels, and what each one can and cannot prove

Every journey in `TEST-MATRIX.md` carries the level it can be run at **today**.
The levels are cumulative in confidence and in cost, and they are not
substitutes for one another.

### L1 — contract / unit. Fixtures against the writers, no network.

A stored payload is handed straight to the function or node that would have
received it. Nothing is fetched, nothing is signed, no port is open.

**Proves:** that a given payload shape produces the phase, the terminal state,
the tenant and the refusal reason we intended; that a second identical payload
does not produce a second lead; that a field we never populate is not silently
defaulted to something plausible.

**Cannot prove:** that the payload shape is the one the provider actually
sends. An L1 suite is a test of our reading of a specification. Meta and Google
have both changed the shape of a lead payload without telling anyone in
particular, and an L1 fixture written from documentation will keep passing
forever after they do.

### L2 — integration. Real staging database, simulated transport.

The payload is posted at our real endpoint on staging, or written through the
real writer, and the assertions are read back out of the real tables with real
RLS and real constraints in the way. The *provider* is still us.

**Proves:** that the writers, the constraints, the phase machine, the tenant
resolution and the cross-tenant refusals behave against a live Postgres — which
is where this project's defects have historically lived.

**Cannot prove:** anything about authentication or transport that only the
provider can exercise. An L2 run signs its own request, so it proves the
verifier accepts a signature we generated; it does not prove the verifier
accepts Meta's. It also cannot prove a retry, a timeout, or a 4XX consequence,
because we are the one retrying.

### L3 — provider loop. Their own test tool fires our real endpoint.

Both providers that matter ship a free test button, and neither needs ad spend:

- **Meta** — the Lead Ads Testing Tool at
  `developers.facebook.com/tools/lead-ads-testing`. Pick the page and the form,
  create a test lead, and Meta delivers a **real webhook, signed with a real
  `X-Hub-Signature-256`, carrying a real `leadgen_id`** which the Graph API will
  then serve field data for. It is the whole two-hop, for nothing.
- **Google Ads** — the lead form asset's built-in **"send test data"** button.
  It posts a real, Google-shaped body containing a real `google_key` to whatever
  webhook URL is configured on the asset. Google treats the endpoint's response
  exactly as it would in production.

**Proves:** the parts L2 structurally cannot — signature verification over the
provider's own raw bytes, the real field names and their real order, the real
`leadgen_id` against the real Graph endpoint, and our HTTP status codes being
read by the party whose retry logic depends on them.

**Cannot prove:** that a customer exists. A test lead has no person behind it,
no phone that rings, and no consent. It also cannot prove Meta's data-retention
expiry, because you cannot make the tool's lead age on demand.

### L4 — live pilot. A real customer, a real phone.

One dealership, live endpoints, real people filling in real forms.

**Proves:** the only thing that has ever mattered commercially — that a
dealership's enquiries arrive, land under the right name, reach a person who
can answer them, and are answered in time.

**Cannot be substituted.** See below.

---

## L1, L2 and L3 can never prove L4

Stated plainly because the temptation is real and this Lab is exactly the sort
of document that gets read as a green tick.

A full green L1–L3 sweep says: *the code we wrote handles the payloads we and
the providers can generate, against the database we have, with the tenancy
rules we designed.* It says nothing about:

- **volume** — every journey here runs at n=1, against a database holding a
  handful of rows;
- **concurrency** — twenty sequential journeys never put five deliveries in
  flight, and this box has been taken down twice by parallel writes;
- **a customer's actual behaviour** — the person who fills a form twice, gives
  a wrong number, replies from a different handset, or enquires about a car that
  sold yesterday;
- **deliverability** — an accepted API call is not a received message;
- **the transports we do not own** — Dubizzle, which has no API to test at all,
  and whose enquiries reach us disguised as something else.

**The project's rule, and it applies to every row in `TEST-MATRIX.md`:**

> **implemented ≠ tested ≠ production-proven ≠ commercially validated.**

Four states, four different pieces of evidence. Code that exists is
*implemented*. A green L1/L2 run makes it *tested*. L3 plus a live L4 pilot
makes it *production-proven*. A dealership renewing a subscription because of
what it did is the only thing that makes it *commercially validated*, and no
test in this directory can produce that word.

---

## What the Lab runs against, and the naming rule

Everything runs on the **staging** Supabase project, against a fictional
dealership that exists for this purpose and is labelled as such on every row it
owns:

> **NEXUS AUTO TEST SHOWROOM — DEMONSTRATION TEST ENVIRONMENT**

Two branches of it, because half the journeys need a second dealership to be
refused: **Branch A** and **Branch B**. Both are invented. No journey, fixture,
screenshot or example in this directory may carry the name, branding, phone
number, trade licence or web address of a real UAE dealership — not as a
placeholder, not as a "realistic" example, not in a payload body. A payload
that has to look like it came from a real business is still a payload naming a
real business.

Every email is under `@journey-lab.invalid` (RFC 2606; it can never resolve).
Every phone is unroutable, and **the Lab runs no send legs at all** — see
`RUNBOOK.md`, because `Guard Reply` filters message content and never the
recipient, so a plausible-looking UAE number is how a dealership's price list
reaches a stranger.

---

## The two standing hazards these journeys sit on top of

Both are recorded in `CLAUDE.md`; they are repeated here because journeys in
this Lab depend on them and a reader of only this directory would not know.

**1. The WhatsApp inbound webhook is unauthenticated in production.**
`WAHA_WEBHOOK_SECRET` is unset, the `WAHA Auth Gate` is measured **DORMANT**,
and n8n writes as `service_role`, which is `BYPASSRLS`. So on the WhatsApp
path: anyone who knows the URL can post, the caller's own JSON chooses the
dealership through `body.session`, and no database policy filters what is then
written. **T07, T08 and T15 depend on that door.** Their assertions are written
to say what the row shows, never that the row came from a customer — because on
this surface, today, nothing distinguishes those two facts. **This Lab does not
claim any surface is secure**, and no journey passing here should be read as
one.

**2. `nexus_scoped_tenant_id()` returns NULL at more than one active
dealership**, taking five backend consumers silent with it. The Lab runs two
active dealerships by design, so anything reading its scope from that function
will return zero rows during a Lab run — a zero that means "scope resolved to
nothing", not "no data". Every journey below that could hit it names the
plural accessor `nexus_active_dealership_ids()` as the correct witness instead.

---

## The files

| file | what it is for |
|---|---|
| `README.md` | this — what the Lab is, the four levels, what each cannot prove |
| `TEST-MATRIX.md` | T01–T20: the table, and one detail section per journey with preconditions, steps, witnesses and verdict |
| `RUNBOOK.md` | how to actually run L1 and L2 today, including endpoint registration, reading a verdict, and the three-snapshot teardown |

There is no harness code in this directory. `RUNBOOK.md` is written so that a
person with SQL access and `curl` can execute L1 and L2 by hand, which is the
right first shape for a suite whose schema has not yet been reconciled against
the repo.
