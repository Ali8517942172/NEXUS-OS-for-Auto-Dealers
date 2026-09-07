# NEXUS Marketplace & Lead Simulator

**Dubizzle Motors has no public leads-out API, no webhook and no developer portal.** There is
nothing to integrate against. A UAE dealer receives a marketplace enquiry as a WhatsApp message
from the listing, a phone call, an entry in the seller dashboard, or a notification email — and
that is the whole list. Consequently the two `marketplace_dubizzle` /
`marketplace_email_notification` payload shapes in this directory (scenarios **A** and **B**) are
**our reconstruction of what a dealer actually receives. They are not a published contract**, no
provider has agreed to them, and the marketplace can change what it sends without telling anyone.
The Meta and Google shapes (**C, D, E, H**) are a **different grade of evidence entirely**: they
are taken from those providers' own published developer documentation. Do not let the two blur
together — a reconstruction is a guess we are honest about, and a published contract is something
you can hold a provider to.

This simulator exists so that the ingestion pipeline can be exercised end to end for **AED 0 of ad
spend, with no real customer, and no marketplace integration that does not exist**. Marketplace
ingestion cannot be integrated today; it can only be simulated until a commercial conversation
with the marketplace happens. The real capture path in production is the WhatsApp channel plus an
email parser, which is exactly what scenarios A and B model.

---

## What this is

A dependency-free Node script that emits ten scenario payloads against the NEXUS lead-event
ingestion contract, either as JSON fixtures on stdout / on disk, or by POSTing them to a
configurable simulation ingest URL.

## What this is NOT

- **Not a Dubizzle integration.** No such integration is possible today. See the first paragraph.
- **Not a source of leads.** Nothing it emits is a customer, and nothing it emits may be counted
  as one.
- **Not a source of revenue, recovered or attributed.** A scenario may carry a `budget_aed` that a
  fictional buyer typed into a form. No scenario carries, computes, or implies a monetary outcome,
  and `lib/validate.js` refuses to emit any payload containing a key like `revenue`,
  `recovered_aed` or `attributed_revenue`.
- **Not a load generator.** It emits one delivery per scenario.
- **Not a database migration or an n8n change.** It writes nothing anywhere unless you explicitly
  pass `--post`.

## Why its output cannot be mistaken for real business

This is enforced structurally rather than by convention, because a convention does not survive
being copied into a demo:

| Guard | Mechanism |
|---|---|
| Provenance | Every emitted event declares `p_origin_verified = 'simulated'`, environment `simulation`. The database refuses a production endpoint whose provenance is unattestable, so this tool **physically cannot write production-labelled rows**. |
| Dealership | Every payload names the fictional **Nexus Auto Test Showroom** and is stamped **DEMONSTRATION TEST ENVIRONMENT**. No real UAE dealership is named, branded or imitated anywhere in this directory. |
| Email | Every address is on an RFC 2606 `.invalid` domain. Undeliverable by construction. |
| Phone | Every number uses ITU-T reserved country code **+999**, which is assigned to no country. The numbers are well-formed E.164 and are dialable nowhere on earth. |
| Money | A denylist of outcome-shaped keys is scanned before every emit and refuses the run. |
| Enforcement | All four checks run in `lib/validate.js` on **every** emit. A scenario that violates one is not emitted; the run fails with the offending path named. |

If you add a scenario, you do not need to remember these rules. The emitter will stop you.

---

## Running it

```
node simulate.js --list                                  # what exists, emits nothing
node simulate.js --scenario A                            # one fixture to stdout
node simulate.js --all                                   # all ten to stdout
node simulate.js --all --out fixtures/                   # all ten to disk
node simulate.js --scenario C --post http://localhost:5678/webhook/sim-ingest
node simulate.js --help
```

**`--dry-run` is the default.** With no `--out` and no `--post`, the tool prints JSON and touches
nothing. Posting is an explicit flag, and `--post` to a non-local host additionally requires
`--allow-remote` — sending simulated leads at a remote ingest is the specific mistake that rail
exists to prevent.

`p_public_key` comes from `--public-key`, else `$NEXUS_SIM_PUBLIC_KEY`, else a placeholder. It
must be the public key of a **simulation** endpoint; the tool warns if it does not look like one.

Node 18+. No dependencies, runtime or dev.

---

## The contract it emits against

Three functions, in order:

```
nexus_record_lead_event(p_public_key, p_external_event_id, p_origin_verified,
                        p_payload_raw, p_occurred_at, p_normalized)
nexus_hydrate_lead_event(event_id, hydrated_payload, normalized)
nexus_promote_lead_event(event_id)
```

The split into three is not ceremony. Meta's lead webhook contains six ids and **no customer
data**, so the delivery must be durable before anyone knows who it came from. `record` accepts
`p_normalized = NULL`; `hydrate` attaches customer data when the second-hop fetch returns;
`promote` is where `full_name` and a contact channel become mandatory, because that is the first
moment they could possibly be known.

The normalized Lead Event object: `full_name` (required), one of `email` / `phone_e164`
(required; phone must match `^\+[1-9][0-9]{7,14}$`), plus optional `vehicle_interest`,
`budget_aed` (number), `message`, `attribution`, `locale`.

Provenance kinds: `hmac_sha256_x_hub`, `hmac_sha256_svix`, `shared_secret_header`,
`shared_secret_in_body`, `origin_and_form_key`, `operator_recorded`, `simulated`, `unverified`.

Each scenario exports **two** provenance fields, and the distinction matters:

- `provenance` — what this emitter declares. Always `simulated`. The registry throws if a scenario
  sets anything else.
- `provenance_in_production` — what the live endpoint would declare for the same delivery. This is
  documentation of the real contract, never something the simulator asserts about its own output.

`provenance_in_production` is **not free text**. `scenarios/index.js` asserts it against
`public.lead_source_catalogue.required_provenance` on `require()`, because the database already
settles the question:

```
lead_ingest_endpoint_production_matches_source
  check (environment <> 'production' or declared_provenance = required_provenance_for_source)
```

A scenario documenting a different pairing is documenting an endpoint that cannot exist. That
assertion caught two wrong values in this directory's first draft.

The `CHECK (lead_event_payload_carries_no_shared_secret)` on `public.lead_event` covers
**`hydrated_payload` as well as `payload_raw`**, so the strip runs on second-hop bodies too — a
Graph API response echoing a token back would otherwise be refused one hop later than anyone would
think to look.

---

## The scenarios

| | Source | Expected | What it is for |
|---|---|---|---|
| **A** | `marketplace_dubizzle` | PROMOTED | Marketplace enquiry over WhatsApp. The catalogue requires provenance `simulated` for this source — there is no public route, so nothing external can attest anything, and a production endpoint for it is a row that cannot exist. In production the same enquiry is captured under `whatsapp_inbound` (`shared_secret_header`, deduped on `wa_message_id`) and *attributed* to the marketplace. |
| **B** | `marketplace_email_notification` | PROMOTED | The email fallback, and a two-hop source: a Svix-signed provider webhook carrying metadata, then a fetch for the body. Routes on the **envelope recipient, never the To: header**; DMARC is a signal, not a gate. Contact is often a relay address, flagged as one. |
| **C** | `meta_lead_ads_facebook` | PROMOTED | What Meta actually sends: six fields, five of them ids, zero customer data. Then the successful second-hop `GET /<leadgen_id>`. |
| **D** | `meta_lead_ads_instagram` | **EXPIRED** | The same flow where the fetch fails because the retention window closed. Ends EXPIRED with a stated reason and the provider's error code, retained and countable — **not deleted, not retried forever, not promoted with a placeholder name**. |
| **E** | `google_ads_lead_form` | PROMOTED | Full payload in one hop — and the body really does contain `google_key`. The fixture emits the payload **as delivered** and **as written** so the strip is demonstrated, not claimed. |
| **F** | `website_form` | PROMOTED | Clean submission keyed on a browser-minted `submission_id`. |
| **G** | `website_form` | **REFUSED** | Bot: honeypot filled, refused at the adapter before any database call, HTTP 200 to the submitter so it learns nothing. |
| **H** | `google_ads_lead_form` | **ALREADY_KNOWN** | The same external id twice. Must answer success, not an error. |
| **I** | `website_form` | **REFUSED** | Three defects, three refusals by name. |
| **J** | `whatsapp_inbound` | PROMOTED | Arabic-script name and the escaped-unicode signature trap. Read the note below. |

### On the 90-day figure in D

Secondary sources report Meta's lead-retention window as 90 days and Meta's own documentation has
not been checked against that. Scenario D uses it to make the timeline concrete and says in the
file that it is **not a measured figure** — `lead_source_catalogue`'s `evidence_note` says the same.
Do not set an alerting threshold on it without verifying it first. What D actually demonstrates
does not depend on the number: an event whose customer data can no longer be fetched must end
EXPIRED with a reason, retained and countable, rather than deleted, retried forever, or promoted
with a fabricated name.

### Why E has its own scenario

`public.lead_event` carries `CHECK (lead_event_payload_carries_no_shared_secret)`, which refuses
any `payload_raw` containing `google_key`. Google Ads authenticates by putting that shared secret
**in the body of every delivery**. So the obvious adapter — forward the body verbatim — cannot
write a single Google lead, and it fails *after* the HTTP 200 has already been sent, so from
Google's side everything looks fine while nothing is stored. Authenticate with the key, strip it,
then write. Scenario E's fixture contains both forms plus `adapter.stripped`; diff them.

### Why H must not answer 4XX

Google Ads retries a lead delivery a limited number of times and then **permanently discards the
lead**. There is no console to re-download it from. An adapter that answers `409 Conflict` on a
duplicate is therefore a lead-loss bug wearing the costume of correctness — and its logs read as a
tidy sequence of 409s. The second delivery of a known external id is a **success**: HTTP 200,
`already_known = true`, the same `event_id` back, no second row, no second alert.

### Why I refuses `nokey:1788700000000`

That id shape is what an adapter emits when the provider gave it nothing stable to key on and
somebody reached for `Date.now()`. It is the quietest of the three defects in that scenario — it
never errors — and the most damaging: every retry carries a different id, so idempotency cannot
hold and scenario H silently becomes two, three, five leads for one customer, each one alerting a
salesperson.

*(A note on I's phone number: the real-world shape of that defect is a UAE mobile typed as
`05X XXX XXXX`, with no country code. This repository reproduces the **defect** — no leading plus,
trunk zero present — without reproducing a **dialable number**, using the reserved +999 range in
local form. Every 05x number of that shape is either assigned to somebody today or assignable
tomorrow, and the emit guards refuse to write one down. The refusal that fires is identical.)*

### Why J exists — read this one

Meta computes `X-Hub-Signature-256` as HMAC-SHA256 over the **raw request bytes**, and the bytes
Meta sends escape every non-ASCII character as `\uXXXX`. An adapter that parses the JSON and then
re-serialises it — `JSON.parse` then `JSON.stringify`, which is what almost every framework hands
you — produces the same characters as raw UTF-8: a different byte string, a different length, a
different HMAC.

**The bug is invisible to an ASCII-only test suite.** Every fixture named "Test Buyer Alpha"
passes. Staging passes. Then it ships to a Dubai dealership and the leads that fail signature
verification and get dropped are exactly the ones whose customers wrote their name in Arabic.
Nobody sees an error spike, because a rejected signature is *supposed* to be rejected. What they
get is a quiet, demographically selective hole in the funnel.

Scenario J's fixture carries a `signature_evidence` block that emits the identical object in both
encodings with the byte length and HMAC of each, computed at emit time. The digests differ. Verify
the signature against the bytes you received, before parsing. Never re-serialise and then verify.

**When it bites, precisely: not today.** The live inbound channel is WAHA, whose provenance is a
copyable shared header and which computes no HMAC over the body at all — which is why the catalogue
requires `shared_secret_header` for `whatsapp_inbound`. The trap arms itself the moment the channel
moves to the WhatsApp Cloud API, where `channel_message_events_cloud_requires_signature`
CHECK-constrains `origin_verified` to `hmac_sha256_x_hub` and the signature becomes load-bearing.
The scenario is written now, before that cutover makes it expensive to discover.

---

## Layout

```
ops/lead-simulator/
  simulate.js        CLI
  package.json       no dependencies
  README.md          this file
  lib/
    constants.js     the synthetic identities, the contract vocabulary, the clock
    validate.js      the four emit guards + the normalized / external-id rules
    adapter.js       stripSharedSecrets() and the honeypot check, executed for real
    unicode.js       derives J's two encodings and their HMACs
  scenarios/
    index.js         registry; throws on a scenario that breaks the export contract
    a-…  …  j-…      one file per scenario
```

Each scenario file exports `{ id, title, source_key, provenance, description, payload_raw,
normalized, expect }` — checked on `require()` — plus optionally `provenance_in_production`,
`evidence_grade`, `external_event_id`, `occurred_at`, `plan` (the hop sequence, when it is not the
default record → promote), and `derive_signature_evidence`.

`expect` states the expected disposition in words: `PROMOTED`, `PENDING_HYDRATION`, `EXPIRED`,
`ALREADY_KNOWN` or `REFUSED`.

## Adding a scenario

Add the file, add it to `scenarios/index.js`, run `node simulate.js --list`. The emitter runs the
real validators and the real adapter functions against what you wrote, so:

- a scenario claiming `PROMOTED` whose normalized object does not satisfy the contract **fails at
  emit time**;
- a scenario claiming `REFUSED` that every validator accepts **fails at emit time**, because that
  means either the scenario is wrong or a guard has stopped working;
- a scenario containing a deliverable email, a dialable number, or an outcome-shaped money key is
  **not emitted at all**.

That is deliberate. Fixtures that quietly stop testing what they claim to test are worse than no
fixtures.

---

## The simulator cannot make a customer, and that is now measured

Every scenario's `disposition` says what happens **in production**, with a real
provider on a production endpoint. Six of them say `PROMOTED`, and that is still
correct as a statement about production.

It is no longer what happens when you run the simulator, and the difference is
deliberate. Since `20260907124500_leadingest_10`, `nexus_promote_lead_event()`
refuses any event whose `environment` is not `production`, because
`public.leads` has **no column that could say a row is simulated** — so a
simulated row put there is a real customer to every reader of that table, for
ever, and would be counted by pipeline value, response-time reporting and every
recovered-revenue figure.

So every emitted fixture now carries `in_simulation` on its promote step, saying
so before anyone discovers it in a demo:

```json
"call": "nexus_promote_lead_event",
"in_simulation": {
  "outcome": "REFUSED_BY_DESIGN",
  "sqlstate": "NX001",
  "detail": "PROMOTION_REQUIRES_PRODUCTION_ENVIRONMENT"
}
```

**Measured on staging, 7 September 2026, running scenario A's own shape against
a real `simulation` endpoint:**

| step | result |
|---|---|
| record + hydrate in one hop | event recorded, phase **HYDRATED** |
| promote the simulated event | **refused: `PROMOTION_REQUIRES_PRODUCTION_ENVIRONMENT`** |
| still readable afterwards? | `v_lead_origin`: phase HYDRATED, **`is_test_traffic` true**, source "Dubizzle Motors" |
| did a `leads` row appear? | **0** |

Read the third row as carefully as the second. The event is **not** discarded —
it records, it hydrates, and a dealership can see it, correctly flagged as test
traffic. What it cannot do is become a customer. That is the difference between
containment and deletion, and it is the property that makes this directory safe
to demo in front of a buyer.

The positive control is in the same migration: a **production** event alongside
it promoted normally (lead 31, `source = google_ads_lead_form`). The guard is
not simply refusing everything.
