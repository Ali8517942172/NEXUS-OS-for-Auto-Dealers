# Multi-source lead ingestion — what was built, what is proven, what is not

6 September 2026. Applied to **staging only** (`wwspuxrbiyagnrnzgate`).
Deliberately **not on production** — see `ops/PARITY-2026-09-06.md`.

## The defect this started from

`select source, count(*) from leads group by 1` on production returns **one row**:

    nexus-master-router   3

That is the name of the workflow that wrote the rows. The column that would
answer "did this customer come from Facebook, or Dubizzle, or the website?" is
recording the writer. So attribution across sources was not unbuilt — it was
structurally impossible, and the Attribution screen has been reading a field that
never held an origin.

## What the providers actually do, checked rather than assumed

Two of these changed the schema before it was written.

| source | what it really sends | grade of evidence |
|---|---|---|
| **Meta Lead Ads** (FB + IG) | **No customer data at all.** Six ids — `leadgen_id`, `page_id`, `form_id`, `ad_id`, `adgroup_id`, `created_time` — then the fields come from `GET /v25.0/<leadgen_id>` on a second hop, and expire. | Meta's published docs |
| **Google Ads lead forms** | The whole lead in one hop. Authenticated by `google_key`: a plaintext shared secret **inside the JSON body**, not a signature. At-least-once; a **4XX permanently discards the lead**. | Google's published docs |
| **Dubizzle Motors** | **No public leads-out API, no webhook, no developer portal, not even a Zapier integration.** The only public API surface is third-party scrapers, which breach their terms. A UAE dealer receives enquiries as a WhatsApp message from the listing, a phone call, a seller-dashboard entry, or a notification email. | absence of evidence, searched 6 Sep |
| **Inbound email** | Metadata webhook, body on a second call. `To:` is useless for routing — a dealer forwarding from their own inbox leaves it pointing at themselves; route on the envelope recipient. SPF fails across a forward **by design**, so DMARC cannot be the authenticity gate. | Resend's published docs |

Two consequences worth stating plainly, because they are commercial and not
technical:

- **A one-shot "here is a lead" table would not have fit two of the four
  sources.** The event has phases for this reason, not for tidiness.
- **Dubizzle cannot be integrated. It can only be simulated, intercepted or
  negotiated.** Its enquiries arrive over WhatsApp, which NEXUS already carries —
  so the capture path exists; what does not exist is an API, and no amount of
  engineering time produces one. YallaMotor and CarSwitch look the same.

Meta's Lead Ads Testing Tool and Google's "send test data" button both fire the
**real** webhook, cost nothing, and need no ad spend. So two of the four sources
are testable end to end at **AED 0**.

## What was built

Six migrations, `leadingest_01` … `leadingest_06`.

- **`lead_provenance_kind`** — how an arrival's origin was established, ranked.
  An HMAC over raw bytes (90) is not the same thing as a secret sitting in a
  request body (30), and the rank exists so that no screen can render them
  identically.
- **`lead_source_catalogue`** — the nine sources, each carrying its real delivery
  shape and an `integration_status` that is a *commercial* fact:
  `COMMERCIAL_CONVERSATION_REQUIRED` means engineering time is wasted until
  somebody signs something. Dubizzle is the one row that holds it.
- **`lead_ingest_endpoint`** — **where the dealership is decided.** This is the
  whole point. The WhatsApp webhook takes its tenant from `body.session`, which
  the caller supplies, and n8n writes as `service_role`, which is `BYPASSRLS` —
  one JSON field chooses whose data is written and nothing in the database
  filters it. A lead endpoint takes its tenant from a registered row resolved by
  `public_key`, and `public_key` **identifies, it does not authenticate**.
  Secrets are named by `secret_ref` and stored elsewhere.
- **`lead_event`** — every arrival, verbatim, whatever became of it. Phases
  `RECEIVED → HYDRATED → PROMOTED`, or terminal `DUPLICATE / REJECTED /
  QUARANTINED / EXPIRED`, each terminal one required to state its reason.
- **The writers** — `nexus_record_lead_event`, `nexus_hydrate_lead_event`,
  `nexus_promote_lead_event`, `nexus_reject_lead_event`. All refuse by raising
  `NX001` with a machine code in DETAIL and a next step in HINT, because a
  refusal returned in a column has already been read here as success once.
- **`v_lead_origin`** — the dealership's own view, `security_invoker`,
  tenant-scoped. Raw payloads, endpoint ids and keys are absent from the grant,
  not merely unselected.

### Three structural decisions, each replacing a rule somebody would have to remember

- **The simulator cannot reach production numbers.** Not a flag a job checks: a
  production endpoint carrying unattestable provenance is a row that cannot
  exist, and the event is pinned to its endpoint's `environment` by composite
  foreign key. Simulator output labelled production is refused `23514`.
- **The Google secret cannot be stored.** `payload_raw` is kept verbatim, and
  Google puts `google_key` inside it — so every Google lead would have filed the
  endpoint's own authentication secret into a table the dealership can read.
  `lead_event_payload_carries_no_shared_secret` refuses the row. The adapter has
  to redact before writing rather than after somebody notices.
- **A cross-tenant promotion is refused by a trigger, not by documentation.**
  `leads` has no unique `(id, tenant_id)`, and adding one means `ALTER TABLE` on
  `leads`, which fires `nexus_guard_born_open_grants()` and strips the two live
  dashboard write paths — that has already happened once this week. A trigger
  gets the same guarantee without touching the table: `service_role` bypasses
  RLS, it does not bypass a trigger.

## What is proven, and how

Two adversarial passes on staging, both in rolled-back transactions.

**Pass one — 25 cells.** Every registration attack refused (`23514`): a
production endpoint with simulated provenance, a Meta endpoint downgraded to a
shared header, an HMAC endpoint with no secret reference, a website form with no
Origin allowlist, an eight-character public key. Every ingestion attack refused:
an unregistered endpoint (`LEAD_ENDPOINT_UNRESOLVED`), a `nokey:`-prefixed
identity, a 13-digit clock reading used as an id, a Meta lead on a weaker proof,
a lead dated forty days in the future, a Bravo event citing Alpha's endpoint
(`23503`), a `PROMOTED` row with no lead behind it. Positive controls held: the
Meta two-hop recorded `RECEIVED` with no customer data and only reached a lead
after hydration; a redelivery returned `was_duplicate = true` **and not an
exception**, which is what stops Google discarding a real lead; promoting twice
produced one lead; and `leads.source` came out as `meta_lead_ads_facebook` — the
origin, not the writer.

**The gate was then sabotaged on purpose and went red.** Zero FAILs before, one
after planting an unattributed promotion. A gate that cannot go red is
decoration, and this project has already found two of those.

**Pass two — the read path, as real signed-in sessions.** Alpha's owner sees one
row in `v_lead_origin` and zero of Bravo's; Bravo's owner the mirror image. Raw
payload, endpoint id and endpoint keys all refused **`42501` — by grant, not by
a row filter**, which is the distinction this codebase has paid for. Update and
delete refused. `anon` is refused `42P01`, at the schema level, by the `public`
USAGE revoke of 4 September — a stronger lock than the view's own grant, and it
should not be read later as "the view is missing".

## One defect found in my own design, by the Journey Lab refusing to fake a pass

`operator_recorded` carried `counts_as_real = false`, and the production endpoint
CHECK reads that flag — so **a `walk_in` or `phone_call` endpoint could not exist
in production.** In a UAE showroom the walk-in is the largest source there is, so
the layer was structurally incapable of recording the dealership's main channel
while cheerfully recording Facebook.

One flag was answering two questions. "Did an external system attest this?" and
"is this real business?" are not the same question: a salesperson vouching for a
customer they met is real and unattested at once. `leadingest_06` splits them.
A production walk-in endpoint now registers; a manual-entry endpoint holding a
secret or a public Origin is refused; the simulator is still refused.

## What is NOT proven — do not let anyone say otherwise

- **Nothing has carried a real lead.** Zero rows on both projects. Every result
  above is staging, in transactions that were rolled back.
- **No HTTP endpoint exists yet.** There is no receiver for any of this — no n8n
  workflow, no signature verifier, no rate limit, no honeypot enforcement in a
  running service. The database contract is built and the transport is not.
- **The Meta signature verifier is the highest-risk unwritten piece.** Meta
  computes `X-Hub-Signature-256` over an **escaped-unicode** form of the body, so
  a verifier that parses and re-serialises will pass an ASCII test suite and fail
  every Arabic customer name in Dubai. Scenario J in the simulator exists for
  this and derives both encodings live.
- **Nothing is on production.** Repo↔production parity is byte-exact over 288
  shared migrations; these six are staged only, on purpose.
- **All twenty Journey Lab verdicts are NOT RUN**, and none of them is L4.

## Where the rest of it lives

- `ops/lead-simulator/` — scenarios A–J, `--dry-run` by default, every fictional
  identity under `.invalid` and labelled **Nexus Auto Test Showroom —
  DEMONSTRATION TEST ENVIRONMENT**.
- `ops/journey-lab/` — README, `TEST-MATRIX.md` (T01–T20), `RUNBOOK.md`.
- `apps/executive-dashboard/screens/lead-sources.js` — the dealership's screen.
- `ops/PARITY-2026-09-06.md` — why production is five migrations behind.
