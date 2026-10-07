# SOURCE CERTIFICATION — the gate every lead source passes before it may be called working

**Written 8 September 2026. This is a proposal and a measurement, not an
applied change.** Nothing in this directory runs, creates a database object,
edits an n8n workflow or writes a row. Every production figure below was read
read-only from `dsvuoovivysszdoiorch` today; every other statement carries the
file it came from.

The reason this file exists, in the owner's words:

> *"Isse tum kabhi accidentally '49 tests pass' ko 'Meta integration works'
> nahi samjhoge."*

49 passing tests is a fact about a harness. It is not a fact about Meta, about a
customer, or about a dealership being able to answer an enquiry. This file
separates those and refuses to let one stand in for another.

---

## 1 · The ladder

Five levels, cumulative, each with its own kind of evidence. A level is only
reached when **every** level below it is reached.

| # | level | the question it answers | the evidence that settles it | what it still cannot prove |
|---|---|---|---|---|
| 1 | **IMPLEMENTED** | does code exist that could carry this source, end to end? | the receiver, the endpoint contract, the writers, named by file and by workflow id | that any of it runs |
| 2 | **PROVEN** (unit / staging) | does that code do what we intended, against a real Postgres with real RLS? | a recorded run: unit tests against the deployed node bodies, plus a Journey Lab L1/L2 journey with its assertions read | that the payload shape is the one the provider actually sends |
| 3 | **PRODUCTION-DEPLOYED** | is it live on production, addressable, fail-closed, and wired to a dealership? | the published workflow, the registered `lead_ingest_endpoint` row **active**, the secret present where it is consumed, the refusal shapes probed on the box | that a delivery can complete — a deployed receiver that refuses everything is deployed, not working |
| 4 | **REAL TRAFFIC PROVEN** | did a delivery this dealership did not originate arrive and complete the chain? | a `lead_event` on production, from a `production` endpoint, walking `RECEIVED → … → PROMOTED`, with a `leads` row and an `ingest:` audit row | that anyone answered the customer, or that it was worth money |
| 5 | **COMMERCIAL VALIDATED** | did it produce business the dealership can point at? | a lead from this source, worked by a named salesperson, with a recorded commercial outcome — and a dealership that keeps paying because of it | nothing; this is the end of the ladder |

**Level 4 has two halves and they are not the same claim.**

- **4a — transport real.** The provider fired our real endpoint with its own
  bytes: Meta's Lead Ads Testing Tool, Google's "send test data", a real WhatsApp
  message from a handset. This is the Journey Lab's **L3**.
- **4b — customer real.** There was a person behind it, with a phone that rings.

A provider test lead satisfies 4a and not 4b. **4a alone is not level 4.** The
Testing Tool creates a signed, genuine delivery carrying a fabricated person;
the Google receiver deliberately `QUARANTINE`s Google's own `is_test: true`
rather than promoting it (`ops/n8n-google-lead-form/README.md`). Recording 4a as
level 4 would put a fake customer in a certificate.

**How this maps onto the Journey Lab's four levels**, which are not replaced:

| Journey Lab | certification level |
|---|---|
| L1 contract / unit | evidence toward 2 |
| L2 staging integration | completes 2 |
| — (no Lab level) | 3 — deployment and wiring, which the Lab explicitly never touches |
| L3 provider loop | 4a |
| L4 live pilot | 4b, and therefore 4 |
| — | 5, which no test in any directory can produce |

### Verdict vocabulary, and the one rule that matters

`NOT RUN` · `RUNNING` · `PASS` · `FAIL` · `BLOCKED` · `DEGRADED`

- **`NOT RUN` is not `PASS`.** It is not "probably fine", not "the writer is
  obviously correct", and not inherited from a similar source. A level whose
  steps ran but whose assertions were not read is `NOT RUN`.
- **`FAIL`** — a step ran and produced the wrong answer. A `FAIL` is kept in the
  table after it is fixed, with the fix beside it, because the failure is the
  evidence that the fix is load-bearing. This is already the Journey Lab's
  practice for T12 and T22.
- **`BLOCKED`** — the step cannot run today, and the missing thing is named. A
  `BLOCKED` that does not name what is missing is a `NOT RUN` in a better coat.
- **`DEGRADED`** — the level's steps pass except named ones, and the shortfall
  is stated in the same cell. Used where a receiver is deployed and fail-closed
  but cannot accept a delivery, or where the unit half of level 2 passes and the
  staging half has not run.
- **`RUNNING`** — a certification run is in flight. It is a state a report can
  be in, never a state a report is filed in.

**A refusal is an assertion, not a failure.** An endpoint that answers `403` to
a forged key has passed that step. The step it fails is the one where a refusal
was not expected.

---

## 2 · What the Journey Lab already is, and where it is stale

`ops/journey-lab/` is not being rebuilt. It is the substrate this gate stands
on. Read honestly:

**What it already does.** 23 journeys (T01–T23), each with preconditions,
ordered steps, a witness per assertion, and a stated failure meaning. Executed
against staging on 7 September 2026 in three passes with per-journey teardown
asserted. Headline verdict in its own README: **15 PASS, 0 FAIL, 7 BLOCKED, 1
NOT RUN**. Two FAILs found and closed the same day and deliberately kept as
FAILs in the table — T12 (a direct `UPDATE` on `leads` wrote zero audit rows)
and T22 (five concurrent promotions of one phone-only event made three
customers, two of them orphans). It carries `RUNBOOK.md`, a
`REGRESSION-SUITE.sql` of eleven self-asserting controls that ends in a
deliberate `RAISE` so nothing survives, and `CONCURRENCY-REGRESSION.sql`, a
standing ten-backend race. Its README states its own limit in the words this
gate inherits: *implemented ≠ tested ≠ production-proven ≠ commercially
validated.*

**What it deliberately does not do.** It never sends. It never runs against
production. It never touches the n8n box — and says so, which is precisely the
hole this certification gate fills: **the Journey Lab has no level 3 and no
opinion about a deployed receiver.** Every green verdict in `TEST-MATRIX.md` is
a fact about the database contract, and four of the nine sources now have an
HTTP receiver in front of that contract which the Lab has never seen.

### Six things in it that are stale against the shipped system

Each is measured today, not inferred.

1. **"Parts 3 and 4 are not on disk" — false.** README, TEST-MATRIX and RUNBOOK
   Step 0 all rest on it. `supabase/migrations/20260907023308_leadingest_03_the_lead_event.sql`
   and `..._023425_leadingest_04_writers_and_the_dealer_projection.sql` are both
   tracked. The phase vocabulary, the writers and `nexus_lead_ingest_invariants()`
   are readable from the repo, and RUNBOOK Step 0's central premise — that three
   witnesses are "named from the brief" — no longer holds.

2. **T05's assertion table contradicts the shipped door.** T05 asserts *"the
   second delivery is `DUPLICATE` — `lead_event.phase` on the second row"* and
   *"the duplicate is retained and countable — the `DUPLICATE` row as
   `service_role`"*. The shipped `nexus_record_lead_event`
   (`20260907190000`) does `on conflict on constraint lead_event_identity_key do
   nothing` and re-reads: **a redelivery produces no second row and no row is
   ever written with phase `DUPLICATE` by door one.** The matrix's own "what was
   actually run" line records the true behaviour — *"returned `was_duplicate=true`
   with the same `event_id`"* — so the file disagrees with itself, and the
   half a reader quotes is the assertion table. The `DUPLICATE` phase value
   exists in the CHECK (measured) and is reachable only through
   `nexus_reject_lead_event`. **T05's assertions 1 and 5 must be rewritten to
   the shipped contract before T05 is cited as evidence of anything.**

3. **RUNBOOK's open question "does `lead_event` keep phase history?" is
   answered, and the answer is no.** Measured today: `lead_event` has 19 columns
   and no history table; `phase` is a single current value. So *"it passed
   through `HYDRATED`"* is **unobservable** on every journey that asserts it
   (T01 assertion 2, T02, T16). It must be recorded as unobservable, and a
   certification step may not assert it.

4. **RUNBOOK's second open question — "one Meta app per dealership, or a
   registered `page_id → tenant` map?" — is answered, and it is the map.**
   `lead_ingest_provider_identity` exists on production
   (`20260907095640_leadingest_08_the_page_decides_the_dealership.sql`), with
   `nexus_lead_endpoint_for_provider_identity()`. **It holds 0 rows**, so no
   Page is registered against any dealership. T18's design question is settled;
   its answer creates a new certification step that the Lab has no row for.

5. **The seven BLOCKED are the right seven, and two of their reasons have
   moved.** T06's reason was corrected in place on 8 September (Resend removed;
   the site now posts to a guarded n8n webhook). T02/T04 are blocked on secrets
   and provider assets, and `META_APP_SECRET` and `META_WEBHOOK_VERIFY_TOKEN`
   are now **set** on the VM — measured by refusal shape in
   `ops/n8n-meta-lead-ads/GO-LIVE.md`, 8 September: `POST` with no signature now
   answers `401 SIGNATURE_HEADER_MISSING`, where it previously answered
   `500 APP_SECRET_NOT_CONFIGURED`. T02 is closer to runnable than the matrix says.

6. **The Lab's "nine sources" table lists `whatsapp_inbound` as one row.** There
   are two WhatsApp transports in production and they are not the same source:
   the **WAHA** door (`POST /webhook/whatsapp-inbound`, unauthenticated, tenant
   from `body.session`) which is carrying live customer traffic today, and the
   **WhatsApp Cloud** receiver (`J8MXprxVw1yhjBpp`, HMAC over raw bytes, tenant
   from a verified `phone_number_id`) which has never carried a message. Certifying
   them as one row would let the second borrow the first's traffic. They are two
   rows below.

**What is not stale.** The four-level model, the house rules, the naming rule,
the two standing hazards, the teardown discipline, and every verdict earned on
7 September. This gate extends the Lab; it does not correct it.

---

## 3 · The ladder, filled in, 8 September 2026

Every cell is a verdict plus an evidence tag. The tags resolve in **§3.1 The
evidence register**. A cell with no evidence tag does not exist in this table.

| source | 1 IMPLEMENTED | 2 PROVEN (unit/staging) | 3 PRODUCTION-DEPLOYED | 4 REAL TRAFFIC PROVEN | 5 COMMERCIAL VALIDATED |
|---|---|---|---|---|---|
| **WhatsApp Cloud** `whatsapp_inbound` | **PASS** `E01` | **DEGRADED** — unit PASS (47), staging NOT RUN `E02` | **DEGRADED** — published, fail-closed, cannot accept `E03` | **NOT RUN** — 0 events, 0 delivery rows `E04` | **NOT RUN** `E05` |
| **WhatsApp WAHA** (legacy, live) | **PASS** `E06` | **NOT RUN** — no Lab journey has run against it `E07` | **FAIL** — door open, caller picks the dealership `E08` | **FAIL** — real traffic arrives and certifies nothing `E09` | **NOT RUN** `E05` |
| **Facebook** `meta_lead_ads_facebook` | **PASS** `E10` | **DEGRADED** — unit PASS (49), T02 BLOCKED `E11` | **DEGRADED** — live + handshake done; endpoint disabled, 0 Page identities, page token unset `E12` | **NOT RUN** — 0 `meta%` events `E13` | **NOT RUN** `E05` |
| **Instagram** `meta_lead_ads_instagram` | **PASS** — shares the Facebook receiver `E10` | **DEGRADED** — T03 PASS on staging; no separate transport exists to prove `E14` | **DEGRADED** — endpoint registered, disabled `E15` | **NOT RUN** `E13` | **NOT RUN** `E05` |
| **Website** `website_form` | **DEGRADED** — DB contract only; no dealership form receiver exists `E16` | **PASS** — T01 on staging, L2 `E17` | **NOT RUN** — no `website_form` endpoint on production `E18` | **NOT RUN** `E18` | **NOT RUN** `E05` |
| **Google** `google_ads_lead_form` | **PASS** `E19` | **PASS** — 56 unit + T05/T21 staging `E20` | **DEGRADED** — live, probed; endpoint disabled, secret unset `E21` | **NOT RUN** — 0 Google events `E22` | **NOT RUN** `E05` |
| **Walk-in** `walk_in` | **PASS** `E23` | **PASS** — T10 staging + production controls, rolled back `E24` | **PASS** — endpoint active, entry surface shipped `E25` | **NOT RUN** — the one event is a preflight, not a customer `E26` | **NOT RUN** `E05` |
| **Phone** `phone_call` | **PASS** `E23` | **PASS** — T10 staging `E27` | **PASS** — endpoint active, same entry surface `E25` | **NOT RUN** — 0 events `E28` | **NOT RUN** `E05` |
| **Marketplace — Dubizzle** `marketplace_dubizzle` | **BLOCKED** — no leads-out API exists `E29` | **BLOCKED** `E29` | **BLOCKED** — a production endpoint cannot exist as a row `E30` | **BLOCKED** `E29` | **BLOCKED** `E29` |
| **Marketplace — notification email** `marketplace_email_notification` | **BLOCKED** — no inbound email ingest is built `E31` | **BLOCKED** `E31` | **BLOCKED** `E31` | **BLOCKED** `E31` | **BLOCKED** `E31` |

**Totals: 0 sources at level 3 for a provider-delivered source. 0 sources at
level 4. 0 sources at level 5.** Two sources are at level 3 and both are typed
by a human (`walk_in`, `phone_call`). Every provider integration in this product
is at level 2 or below, and the only source carrying real customer traffic today
fails certification at level 3.

That last sentence is the honest headline of the acquisition layer and should be
the first thing said about it.

### 3.1 The evidence register

Each entry is `measured` (I read it today, read-only, on
`dsvuoovivysszdoiorch`), `repo` (a tracked file records it, cited), or
`absent` (the thing does not exist, which is itself the evidence).

| tag | grade | evidence |
|---|---|---|
| `E01` | repo | Receiver `J8MXprxVw1yhjBpp`, `POST/GET /webhook/whatsapp-cloud-inbound`, published. HMAC-SHA256 implemented inside the node because the n8n sandbox has no crypto at all. `ops/whatsapp-cloud/README.md`, `ops/n8n-whatsapp-cloud/` |
| `E02` | repo | 9 HMAC tests + 26 node tests + 12 standalone verifier tests, all passing, including both wire forms of an Arabic name and the `l % 64 === 55` padding bug found by differential-testing 300 pairs against `node:crypto`. Staging half: Journey Lab **T07 is BLOCKED** — no WAHA session on a controlled device and the open-door remediation is not done. `ops/whatsapp-cloud/README.md`, `TEST-MATRIX.md` |
| `E03` | repo + measured | Deployed and refusing every request by design: `500 APP_SECRET_NOT_CONFIGURED` / `500 VERIFY_TOKEN_NOT_CONFIGURED`, 5XX deliberately so Meta redelivers. `channel_registry` carries an **active** production row `9129126e-…` → `phone_number_id 1306545252542419` → `alba-cars` (measured). `META_APP_SECRET` unset on the VM per `ops/whatsapp-cloud/README.md` |
| `E04` | measured | `lead_event` where `source_key = 'whatsapp_inbound'`: **0 rows**. `channel_message_events`: **0**. `whatsapp_delivery_events`: **0**. `whatsapp_message_usage`: **0**. There is no row anywhere that says a message was delivered |
| `E05` | absent | No dealership is on a NEXUS-certified acquisition path, so no commercial outcome can be attributed to one. Level 5 cannot be reached by any run in this directory |
| `E06` | repo | `POST /webhook/whatsapp-inbound` is live and has been since August; it is one of the 11 business POST webhooks. `CLAUDE.md`, "The open webhook" |
| `E07` | repo | T07/T08/T15 are written against this door and all three are BLOCKED. No Lab journey has been executed against the WAHA transport |
| `E08` | repo | The gate is **DORMANT**: `WAHA_WEBHOOK_SECRET` unset, so the early `return items;` passes everything through; the tenant comes from `body.session`, caller-supplied; n8n writes as `service_role`, which is `BYPASSRLS`. Additionally, as of 8 September `5b does not currently pass` — with the secret set the gate reads `header_present: true, ok: false` because the Code node executes in `n8n-worker`. `CLAUDE.md`; `ops/GO-LIVE-SEQUENCE.md` §5 |
| `E09` | measured | Real traffic is arriving: `communication_logs` holds 109 inbound and 28 outbound WhatsApp rows, most recent inbound `2026-09-08 17:24:39Z`. Leads 34 and 122 were created from it. **And it certifies nothing:** both carry `source = 'nexus-master-router'` — the writer, not an origin — no `lead_event` exists for either, and their email is a synthesised `+9715…@whatsapp.lead`. A chain that produces a customer without an arrival row cannot answer "where did this lead come from" |
| `E10` | repo | Receiver `JDqy54w2HUH7pHgW`, `GET/POST /webhook/meta-lead-ads`, published 7 Sep. Two-hop shape, `hydrated_payload` built by allowlist. `ops/n8n-meta-lead-ads/README.md` |
| `E11` | repo | 49 tests passing against the deployed node bodies. Journey Lab **T02 BLOCKED** (needs Meta to fire our real endpoint); T16 and T18 PASS on staging and cover "an endpoint disabled between hop one and hop two" and "the endpoint decides the dealership" |
| `E12` | repo + measured | ACTIVE on the box; `META_APP_SECRET` and `META_WEBHOOK_VERIFY_TOKEN` **set** — evidenced by the refusal shape changing to `401 SIGNATURE_HEADER_MISSING` / `403 HUB_VERIFY_TOKEN_MISMATCH`; Page subscribed to `leadgen`, five handshake executions (`11193, 11209, 11214, 11217, 11228`) which wrote nothing and should not have. Blockers, measured by me today: endpoint `alba-prod-meta-leadads-facebook` is **`disabled`**; `lead_ingest_provider_identity` holds **0 rows**, so no `page_id` resolves to any dealership. `META_PAGE_ACCESS_TOKEN` unset per `ops/n8n-meta-lead-ads/GO-LIVE.md` |
| `E13` | measured | `lead_event` where `source_key like 'meta%'`: **0 rows** |
| `E14` | repo | T03 PASS on staging: a metadata-only arrival records `RECEIVED` with `normalized` null, promotion is refused `LEAD_EVENT_NOT_HYDRATED`, and the event terminates `EXPIRED` **retained with its reason**. Also from the catalogue: Instagram lead ads arrive on the connected Facebook Page's `leadgen` subscription — **there is no separate Instagram webhook to wire**, so no independent transport exists to certify |
| `E15` | measured | Endpoint `alba-prod-meta-leadads-instagram`, production, **`disabled`**, `secret_ref = env:META_APP_SECRET` |
| `E16` | absent + repo | There is no dealership website-form receiver anywhere in the repo — `ops/` holds receivers for Meta, Google and WhatsApp Cloud and none for a website form. The one shipped form is the **vendor's** marketing site (`apps/marketing-site/api/lead.js`), which posts a prospect to a guarded n8n webhook for a Gmail notification and — only if `NEXUS_LEAD_ENDPOINT_KEY` is set — makes an *optional* `nexus_record_lead_event` call with `p_origin_verified: 'simulated'`. A vendor prospect is deliberately not filed into any dealership record (`CLAUDE.md`, Resend section) |
| `E17` | repo | Journey Lab **T01 PASS**: recorded `HYDRATED` in one hop, promoted to lead 32, `leads.source = website_form` — an origin, not a writer. T06 (honeypot + the human who follows) remains BLOCKED |
| `E18` | measured | Production holds **5** `lead_ingest_endpoint` rows and none is `website_form`. There is nothing for a dealership form to post to |
| `E19` | repo | Receiver `EYva4c2bMV5MGq0o`, `POST /webhook/google-ads-lead?k=<public key>`, published 7 Sep. `payload_raw` assembled field-by-field from an allowlist so `google_key` cannot arrive by being forgotten. `ops/n8n-google-lead-form/README.md` |
| `E20` | repo | 56 tests against the deployed node bodies, every refusal asserting its **status code** as well as its reason. Journey Lab **T05 PASS** (redelivery answered `was_duplicate = true` and did not raise) and **T21 PASS after a fix** (five concurrent backends: was 1 insert + four `23505`, now 1 insert + four duplicates, no exception). See §2 item 2: T05's written assertions need correcting even though its verdict stands |
| `E21` | repo + measured | Seven refusal shapes probed on the live box, including `403 GOOGLE_KEY_REJECTED` for an unregistered key and `500 ENDPOINT_SECRET_NOT_CONFIGURED` for a registered one — the second reached only by creating, using and deleting a simulation endpoint. Status-code discipline is *proven up to the secret check and asserted beyond it* — the receiver's own words. Measured by me today: endpoint `alba-prod-google-leadform-0001` now exists on production, created `2026-09-08 09:22:36Z`, **`disabled`**, `secret_ref = GOOGLE_LEAD_KEY_ALBA`, which the repo records as unset on the VM |
| `E22` | measured | `lead_event` where `source_key = 'google_ads_lead_form'`: **0 rows** |
| `E23` | repo | `nexus_lead_record_manual` (SECURITY DEFINER) plus the entry surface in `apps/executive-dashboard/lib/manual-lead-form.js`. `20260907220000`, `20260907240000` |
| `E24` | repo | T10 PASS on staging (two events, two sources, two leads, both carrying a real origin). Plus four controls on **production** as a real `authenticated` Tenant A member, in a transaction that was rolled back: a phone-only walk-in became lead 125; the same `client_request_id` returned lead 125 with `was_duplicate = true`; exactly one `lead_event` pointed at it; production unchanged afterward at 5 leads. `CLAUDE.md` |
| `E25` | repo + measured | Endpoints `alba-prod-walkin-showroom-floor` and `alba-prod-phonecall-front-desk`, both `production`, both **`active`** (measured). The deployed dashboard bundle carries `rpc/nexus_lead_record_manual` (2 occurrences) and `leads?id=eq` is absent — measured against `/assets/main-BFmkO_-a.js`, `CLAUDE.md` |
| `E26` | measured | Production holds exactly **one** `lead_event`: `walk_in`, external id `walkin-preflight-2026-09-07-01`, `PROMOTED` to lead 121, whose email is under `@nexus-preflight.invalid`. That is a preflight, not a customer, and the repo says so in terms. **And a second finding: `audit_log` holds 0 rows whose `workflow` begins `ingest:`** — the preflight was promoted on 7 Sep 09:41, before `20260907240000` put the audit write inside `nexus_promote_lead_event`. The audit step of every gate below has therefore **never fired on production**, on any source |
| `E27` | repo | Covered by T10, which exercised `walk_in` and `phone_call` as two separate events from one person |
| `E28` | measured | `lead_event` where `source_key = 'phone_call'`: **0 rows** |
| `E29` | repo + measured | Dubizzle Motors publishes no leads-out API, no webhook, no developer portal and no Zapier integration; the only public surface is third-party scrapers, which breach their terms. `nexus_lead_source_readiness()` returns `NOT_CONNECTABLE` / `COMMERCIAL_CONVERSATION_REQUIRED` for it (measured), and `nexus_lead_ingest_invariants()` reports it under *"Sources with no public integration are marked as such, not as buildable"* (measured) |
| `E30` | measured | `lead_source_catalogue.required_provenance` for `marketplace_dubizzle` is `simulated`, whose `counts_as_real` is `false`; `lead_ingest_endpoint_production_needs_real_provenance` forbids a production endpoint carrying it. **A production Dubizzle endpoint is a row that cannot exist**, by constraint, not by convention |
| `E31` | absent | There is no inbound email ingest at all. Journey Lab T09 records this as an unbuilt capability rather than a configuration gap. The catalogue's own note names the design (a dedicated subdomain, one local-part per dealership, route on the envelope recipient, never the `To:` header) and none of it is built |

### 3.2 Two readings that must not be taken from this table

**`nexus_lead_source_readiness()` read as `service_role` says `NOT_CONNECTED`
for all nine sources with `active_endpoints: 0`.** I measured exactly that
today. It is **not** evidence that nothing is connected: readiness is
tenant-scoped and `nexus_current_tenant_ids()` is empty for `service_role`, so
that reading is nobody's dealership. The same function read as a real Tenant A
session returned `CONNECTED 2 · NOT_CONNECTABLE 1 · NOT_CONNECTED 6` on
7 September (`CLAUDE.md`). Any certification run that reads this function
without impersonating a member has measured nothing.

**`nexus_lead_ingest_invariants()` returns 8 PASS / 2 INFO / 0 FAIL on
production today** (measured). Zero FAILs across eight invariants over **one**
production arrival is a weak signal, and the file that records this gate also
records that it was deliberately sabotaged once and went red. A green gate over
an almost-empty table is a green gate, not a proven layer.

---

## 4 · The gates, as runnable checks

For each source: the ordered steps. Every step names its **actor** — `HUMAN`
(someone must press a button, send a message or type a secret) or `MACHINE` (a
scheduled job or an agent can run it read-only) — what is done, what is
observed, the exact probe, the pass condition, and what a failure costs
commercially.

Conventions used throughout:

- `<KEY>` is the endpoint's `public_key`; it is an identifier, never a secret,
  and never pasted into a report, a screenshot or this repository.
- `$EP` is `https://35.224.126.225.nip.io`.
- Every SQL probe below is a **read** or a rolled-back transaction. No step in
  any gate writes a row to production.
- A step whose witness does not exist under the name given is `BLOCKED`, and the
  missing object is named. It is never re-pointed at the nearest similar column.

### 4.1 WhatsApp Cloud — the owner's seven steps

| # | actor | what is done | what is observed | probe | pass condition | what a failure costs |
|---|---|---|---|---|---|---|
| W1 **webhook verified** | HUMAN | Meta's callback verification against the receiver | the challenge is echoed and **nothing is written** | n8n execution list for `J8MXprxVw1yhjBpp`; then `select count(*) from lead_event where received_at > '<t0>'` | the execution runs `Webhook → Verify Or Refuse → Respond Without Writing` and stops; `lead_event` unchanged | a subscription that never verifies means Meta never delivers, and the dealership's WhatsApp enquiries stop arriving with no error anywhere |
| W2 **signature verified** | MACHINE | a forged and a tampered delivery are posted | the refusal code and reason | `curl -sS -o /dev/null -w '%{http_code}' -XPOST $EP/webhook/whatsapp-cloud-inbound -H 'X-Hub-Signature-256: sha256=deadbeef' -d '{}'` | a refusal naming the signature, **and** an unconfigured secret answers **5XX not 4XX**; and the same body signed correctly but re-serialised with an Arabic name is **rejected** | a verifier that parses before hashing accepts ASCII and silently rejects every Arabic name — in Dubai that is most of the customers, and the failure is invisible |
| W3 **message received** | HUMAN | one genuine 1:1 message from a handset that is not ours | an arrival row exists, tenant resolved from a **verified** `phone_number_id` | `select event_id, tenant_id, source_key, phase, environment, origin_verified from lead_event where source_key='whatsapp_inbound' order by received_at desc limit 1` | exactly one row, `origin_verified = 'shared_secret_header'` or stronger, `environment='production'`, `tenant_id` = the row `channel_registry` resolves for that `phone_number_id` | if the tenant came from anything the caller supplied, one JSON field chooses whose data is written |
| W4 **customer created** | MACHINE | promotion runs | one lead, and no orphan | `select l.id, l.source, (select count(*) from lead_event e where e.lead_id=l.id) arrivals from leads l where l.id = <lead>` | `source = 'whatsapp_inbound'` (an origin, not a writer) and `arrivals = 1` | a customer with no arrival row cannot be attributed, and the dealership cannot be told which channel is paying for itself |
| W5 **AI responded** | MACHINE | the reply leg runs | an outbound row exists **and names what it replied to** | `select id, direction, external_message_id, created_at from communication_logs where tenant_id=<t> and direction='outbound' order by created_at desc limit 1` | an outbound row whose `external_message_id` is not null and not per-attempt | today this step is the weakest link in the chain: `communication_logs` links to a customer by an email string, so an outbound message to a phone-only lead attaches to nobody (§5) |
| W6 **delivery confirmed** | MACHINE | Meta's delivery status callback | a provider-confirmed delivery, not an accepted API call | `select count(*) from whatsapp_delivery_events where conversation_id is not null` | at least one row for this message, with a provider status | **an accepted API call is not a received message.** `whatsapp_delivery_events` holds **0 rows** today (measured), so this step is `NOT RUN` for every source and cannot currently pass |
| W7 **audit created** | MACHINE | the promoter's audit write | one row a dealership can read | `select workflow, status, summary from audit_log where workflow = 'ingest:whatsapp_inbound' order by logged_at desc limit 1` | exactly one row naming the lead, the event, the external id and the provenance **in words** | 0 `ingest:%` rows exist on production today (measured, `E26`) — this step has never fired, on any source |

**Steps that need a human: W1, W3.** Everything else a machine can run.

### 4.2 Facebook — lead test → Graph fetch → normalize → lead → audit

| # | actor | what is done | what is observed | probe | pass condition | what a failure costs |
|---|---|---|---|---|---|---|
| F0 **page registered** | HUMAN | the Page is registered against the dealership | a resolvable identity | `select * from nexus_lead_endpoint_for_provider_identity('meta','facebook_page_id','<page id>')` | exactly one row, the right tenant | **0 rows today** (`lead_ingest_provider_identity` is empty, measured). Until this exists a verified Meta delivery resolves to no dealership and is refused — a real lead, discarded, with the signature having verified |
| F1 **lead test** | HUMAN | `developers.facebook.com/tools/lead-ads-testing` → create a test lead | hop 1 arrives carrying **identifiers only** | `select phase, external_event_id, normalized, hydrated_at from lead_event where source_key='meta_lead_ads_facebook' order by received_at desc limit 1` | `phase='RECEIVED'`, `normalized` null, `external_event_id` = the `leadgen_id` | if any customer-shaped value is present at `RECEIVED`, it was invented — Meta sent none |
| F2 **signature over raw bytes** | MACHINE | re-sign a pretty-printed copy of the same JSON and deliver it | verification must **fail** | replay through the receiver harness in `ops/n8n-meta-lead-ads/receiver.test.js` | the pretty-printed copy is refused | a verifier that parses first is not `hmac_sha256_x_hub` at all, and the catalogue's own definition says so |
| F3 **Graph fetch** | MACHINE | `GET /v25.0/<leadgen_id>` | hydration came from the fetch, not the webhook | `select hydrated_at, hydration_error, normalized from lead_event where event_id=<id>` | `hydrated_at` set, `hydration_error` null, fields present | fields present with `hydrated_at` null means the receiver filled them itself |
| F4 **normalize** | MACHINE | the allowlist builds `hydrated_payload` | no credential-shaped string, and no customer answer destroyed | attempt the insert in a **rolled-back** transaction with a customer answer of exactly `authorization` | the constraint's behaviour matches the measured table in `ops/n8n-google-lead-form/README.md` | this constraint is a text match over the whole serialised JSON: a customer whose whole answer is one of six words has their lead **thrown away** unless the receiver repairs it first |
| F5 **lead** | MACHINE | promotion | one lead, right dealership | `select id, source, tenant_id from leads where id = <lead>` | `source='meta_lead_ads_facebook'`; a second dealership's session reads **0 rows** through `v_lead_origin` | a lead filed under the wrong dealership is a data breach, not a bug |
| F6 **audit** | MACHINE | the promoter's audit write | one row | `select summary from audit_log where workflow='ingest:meta_lead_ads_facebook'` | one row, naming the provenance in words | see W7 — never fired |
| F7 **redelivery** | MACHINE | replay the same `leadgen_id` verbatim | one lead, not two | `select count(*) from lead_event where external_event_id='<leadgen_id>'` and the `leads` count | **exactly one `lead_event` row**, and the call returns `was_duplicate=true` without raising | Meta and Google both redeliver. A redelivery that raises looks to the receiver like a crash, and for Google a 4XX answer **permanently destroys** the lead |

**Steps that need a human: F0, F1.** Meta's Testing Tool is free and needs no ad
spend; F1 satisfies **4a only**. A real customer filling in a real form is the
separate step that satisfies 4b.

**Instagram** runs F1–F7 unchanged on the same Page subscription, and gets one
extra assertion: `E14`. It may not be certified at level 4 by a Facebook
delivery, and the Instagram origin may **never** be encoded into `source_key` —
`lead_event_identity_key` is `UNIQUE (tenant_id, source_key, external_event_id)`
(measured), so a second `source_key` would make Meta's redelivery of the same
`leadgen_id` look new and hand the dealership two leads for one customer.

### 4.3 Website — form → lead → attribution → notification

| # | actor | what is done | what is observed | probe | pass condition | what a failure costs |
|---|---|---|---|---|---|---|
| S0 **endpoint registered** | HUMAN | a `website_form` endpoint with a non-empty `origin_allowlist` | it resolves | `select * from nexus_lead_endpoint_for_public_key('<KEY>')` | exactly one row, the right tenant, `environment='production'` | **0 such endpoints exist today** (measured) |
| S1 **form** | HUMAN | one submission from the dealership's own page, from an allowed `Origin` | an arrival | `select phase, environment, origin_verified from lead_event where external_event_id='<submission_id>'` | `origin_verified='origin_and_form_key'`, strength 20, `origin_cryptographically_verified=false` | recording a stronger provenance than was performed flatters every lead that came through it |
| S2 **the Origin check bites** | MACHINE | the same submission from an `Origin` **not** on the allowlist | it does not promote | `select phase, disposition_reason from lead_event where external_event_id='<id2>'` | not `PROMOTED`, and a stated reason | an allowlist that never refuses is decoration, and this endpoint is the weakest thing we accept from the public internet |
| S3 **idempotency** | MACHINE | submit the same thing twice from one page load | one customer | `select count(*) from leads where …` | 1 | `submission_id` was once minted per attempt, and the 503 branch actively invites a retry — that shape duplicates a prospect (`CLAUDE.md`) |
| S4 **attribution** | MACHINE | the Leads screen reads the origin | the origin, not the writer | `select * from nexus_lead_attribution(now() - interval '30 days')` **as a real member session** | the source appears as `website_form` | `leads.source` recording the writer is the defect this whole layer exists to remove |
| S5 **notification** | HUMAN | the person who should call the customer is told | a message arrives at a human | the notification leg's own log **and** the recipient confirming | someone with a phone knows there is a lead | this is where "the lead landed" and "the dealership answered" separate. A stored enquiry nobody is notified about still means nobody calls the person back |

**Two things this gate must keep apart.** The **vendor's** marketing site
(`apps/marketing-site/`) is not a dealership website form: it posts vendor
prospects to a guarded n8n webhook for a Gmail notification, records under
`simulated` provenance if it records at all, and deliberately writes nothing to
any dealership record. Certifying `website_form` with a submission to the vendor
site would be the same category error as calling a WhatsApp enquiry a Dubizzle
integration.

### 4.4 Google — lead form → signed webhook → normalize → lead → audit

| # | actor | what is done | what is observed | probe | pass condition | what a failure costs |
|---|---|---|---|---|---|---|
| G0 **wiring** | HUMAN | lead form asset created; `GOOGLE_LEAD_KEY_ALBA` set on the VM; endpoint enabled | the endpoint resolves and the secret is present where it is **consumed** | `select status from lead_ingest_endpoint where public_key='<KEY>'`; then a `curl` to the endpoint with a registered `k` | not `500 ENDPOINT_SECRET_NOT_CONFIGURED` | today the endpoint is `disabled` and the secret is unset (`E21`). Check the secret in the container that reads it — the WAHA gate's 8-September failure was exactly this: the value was set in `n8n` and read in `n8n-worker` |
| G1 **signed webhook** | HUMAN | press **Send test data** on the lead form asset | a `QUARANTINED` event with a stated reason, and **no lead** | `select phase, disposition_reason from lead_event where source_key='google_ads_lead_form' order by received_at desc limit 1`; `select count(*) from leads where created_at > '<t0>'` | `QUARANTINED`, reason names the test, `leads` unchanged | Google's `is_test:true` arrives with a fabricated name and email. Promoting it puts a fake customer into a dealership's funnel and into every revenue figure computed from it |
| G2 **the secret never reaches the table** | MACHINE | attempt an insert whose `payload_raw` contains `"google_key"`, in a **rolled-back** transaction | the constraint refuses | `begin; insert … ; rollback;` expecting `lead_event_payload_carries_no_shared_secret` | refused | this CHECK is the only thing between a stored provider payload and handing an authentication secret to every signed-in user of that dealership — and a constraint nobody has fired is decoration |
| G3 **status codes** | MACHINE | each failure mode is provoked | the code Google reads | the seven probes in `ops/n8n-google-lead-form/README.md` | 4XX only where the retry can never succeed; 5XX for anything ours to fix | **a 4XX is not a refusal; it is a deletion Google performs at our request.** Google permanently discards the lead |
| G4 **redelivery** | MACHINE | replay the captured body verbatim | one lead | as F7 | one `lead_event`, `was_duplicate=true`, no exception | at-least-once delivery is the normal case, not the edge case |
| G5 **lead + audit** | MACHINE | promotion | `source='google_ads_lead_form'`, one `ingest:` audit row | as F5, F6 | both present | see W7 |

**The step G3 cannot settle by itself.** What a *database* error becomes on the
wire has not been measured — all four HTTP nodes carry `retryOnFail` and
`onError: null`, so a PostgREST refusal is retried and then throws, and n8n
answers the caller itself. It is *believed* to be a 500. Until it is measured,
this gate records G3 as **PASS up to the secret check, `NOT RUN` beyond it** —
which is what the receiver's own README says, and the certificate must not
round it up.

### 4.5 Walk-in / phone — salesperson → authenticated RPC → lead → audit

| # | actor | what is done | what is observed | probe | pass condition | what a failure costs |
|---|---|---|---|---|---|---|
| M1 **salesperson** | HUMAN | a member of the dealership types a walk-in into the deployed dashboard | the entry surface exists on the **deployed bundle**, not in the repo | fetch the deployed JS asset and grep for `rpc/nexus_lead_record_manual` | present | a green "Connected" pill over a bundle with no button is the exact defect `20260907200000` removed |
| M2 **authenticated RPC** | MACHINE | `nexus_lead_record_manual` under a real member JWT | provenance is `operator_recorded`, and it is honest | `select origin_verified, provenance_counts_as_real from lead_event where lead_id=<id>` | `operator_recorded`; `counts_as_real = true`; `is_externally_attested = false` | these are two questions and one flag once answered both, which made a production walk-in endpoint **a row that could not exist** — the largest lead source in a UAE showroom |
| M3 **an account in no dealership is refused** | MACHINE | the same call from an unaffiliated session | refusal | control 8 of `ops/journey-lab/REGRESSION-SUITE.sql` | refused | manual entry with no tenant check lets anyone write into anyone's funnel |
| M4 **idempotency** | MACHINE | the same `client_request_id` twice | one lead | `select count(*) from lead_event where external_event_id = 'walk_in:<uuid>'` | 1, and the second call returns `was_duplicate = true` | a salesperson double-clicking Save must not create two customers |
| M5 **lead** | MACHINE | promotion | `leads.source='walk_in'` | as F5 | present | — |
| M6 **audit** | MACHINE | the promoter's audit row | one row | `select summary from audit_log where workflow='ingest:walk_in'` | one row | **`NOT RUN` today, on production, for every source** (`E26`) |

**M1 is the only human step**, and the walk-in gate is the one gate whose level 4
needs no provider at all: a real salesperson recording a real customer who walked
into the showroom is level 4 on this source. It is also the cheapest level 4
available to this product today.

### 4.6 Marketplace — the gate that is a refusal

There is no gate, and writing one would be the defect.

| assertion | witness | why it is here |
|---|---|---|
| `marketplace_dubizzle` is never presented as connected | `nexus_lead_source_readiness()` as a real member session returns `NOT_CONNECTABLE` / `COMMERCIAL_CONVERSATION_REQUIRED` | measured today. A screen rendering this as "not yet connected" invites someone to go and connect it |
| a production Dubizzle endpoint does not exist | `select count(*) from lead_ingest_endpoint where source_key='marketplace_dubizzle' and environment='production'` = 0, **and** the attempt is refused `23514` in a rolled-back transaction | the refusal is structural (`E30`), and a constraint nobody has fired is decoration |
| **a WhatsApp-origin enquiry is never called a Dubizzle integration** | any lead whose arrival is `whatsapp_inbound` carries `source_key='whatsapp_inbound'`; a marketplace claim, if ever made, is **attribution** carried elsewhere and never in `source_key` | this is the line the owner drew and it is also a schema rule: `source_key` is part of `lead_event_identity_key`, so putting a marketplace claim in it would break redelivery identity as well as being untrue |

Certifying Dubizzle requires a commercial conversation with Dubizzle, not
engineering time. That belongs on a roadmap, sold as a roadmap.

`marketplace_email_notification` is `BLOCKED` on an unbuilt capability. Its gate
cannot be specified beyond its first step — *an inbound email ingest exists* —
because nothing after that step has a witness.

---

## 5 · The correlation id

**Today there is no correlation id anywhere.** Measured on production, today,
with `nexus_trace_linkability_report()` and directly:

| | |
|---|---|
| `leads` | 5 |
| leads with no usable email | **1 (20%)** |
| `communication_logs` | 142 |
| ...whose `lead_email` matches no lead | **107 (75.4%)** |
| `audit_log` | 881 |
| ...carrying no `lead_email` at all | **807 (91.6%)** |
| any column named `correlation_id` or `request_id`, anywhere in `public` | **none** |

`communication_logs` and `audit_log` attach to a customer by an **email
string**. Not `lead_id`, not a foreign key. So a phone-only lead — the walk-in,
the phone call, the WhatsApp enquiry, the ordinary UAE case — is **unlinkable**;
92% of the audit trail is attached to nobody; and two enquiries from one person
collapse into one history. The ERP link-back has the same defect a third time:
`Link Back to Supabase` PATCHes `leads?email=eq.<email>`, falling back to the
literal `__nexus_noop__`, so a phone-only lead never gets its Bitrix id written
back — silently.

### What a correlation id would have to be

**Two ids, not one.** They answer different questions and conflating them is how
this gets built wrong.

**(a) `request_id` — one per delivery attempt.** A UUIDv7, minted at the
outermost boundary: inside the receiver node, **after** the signature verifies
and **before** the first write. It identifies *this HTTP delivery*, not this
customer. It is what answers *"the Facebook lead came in at 14:03 — show me
everything that one webhook caused."* A retry is a **new** `request_id` and the
same `external_event_id`; that difference is the whole point, and it is what
makes "we absorbed three redeliveries" countable.

**(b) `lead_event.event_id` — one per arrival, and it already exists.** It is a
UUID primary key, already `NOT NULL`, already the thing `lead_event.lead_id`
hangs off. What is missing is not a new id; it is that **nothing downstream
carries it.** `communication_logs`, `audit_log`, `whatsapp_delivery_events`,
`channel_message_events` and `lead_owner_events` have no column for it.

So the correlation id is `event_id` plus a `request_id` beside it, and the work
is carriage, not minting.

**One id already exists and dies where it is born.**
`nexus_lead_record_manual(p_client_request_id uuid, …)` takes a caller-minted
request id and stores it as `external_event_id` in the form
`p_source_key || ':' || p_client_request_id` (read from
`20260907240000`). It never reaches `audit_log`, never reaches
`communication_logs`, and no other door takes one at all. The manual path is
therefore the smallest possible pilot for (a).

### Where it must be minted, and every writer that must carry it

| minted at | by | note |
|---|---|---|
| Meta receiver, after `Verify Or Refuse` | `JDqy54w2HUH7pHgW` | must be **after** verification: minting before means an unverified caller chooses a correlation id that then appears in a dealership's audit trail |
| Google receiver, after the secret check | `EYva4c2bMV5MGq0o` | same rule |
| WhatsApp Cloud receiver, after the HMAC | `J8MXprxVw1yhjBpp` | same rule |
| the WAHA door | `POST /webhook/whatsapp-inbound` | **cannot be trusted today** — the door is unauthenticated, so a `request_id` minted there is a value an anonymous caller caused. Fix the door first, or the id is decoration |
| manual entry | `nexus_lead_record_manual` | already takes one; needs to carry it further |
| dashboard writes | `nexus_lead_assign_owner`, the `leads` owner-change trigger | these are acts, not arrivals; they need `lead_id` + `event_id`, not a `request_id` |

Writers that must carry both ids for the chain to close:

`lead_event` (has `event_id`; needs `request_id`) · `leads` (needs
`origin_event_id`, or a `lead_event.lead_id` reverse read, which already works)
· `audit_log` (needs `event_id` **and** `request_id`; 91.6% of its rows attach to
nobody today) · `communication_logs` (needs `lead_id` and `event_id`; the email
string is the defect) · `channel_message_events` · `whatsapp_delivery_events` ·
`whatsapp_message_usage` · `lead_owner_events` · `lead_recovery_actions` ·
the Bitrix link-back.

### What it costs, stated rather than waved at

1. **`ALTER TABLE` on `leads`, `communication_logs` and `audit_log` fires
   `nexus_guard_born_open_grants()`, which strips the live dashboard write
   grants.** That has already happened once this week and re-opened two screens'
   worth of grants. It is a change to make with someone watching, and with the
   re-grant written before the ALTER, not after.
2. **A backfill is impossible and must not be faked.** Existing rows have no
   correlation id and cannot acquire a true one. They stay NULL, and every
   reader must render NULL as *unknown*, never as *none* — the house rule this
   codebase has broken in six separate places.
3. **Every n8n write site changes.** The `communication_logs` writers alone are
   three separate Set expressions across the WhatsApp workflows
   (`ops/n8n-bundle-NOT-DEPLOYED/03-…`), each a separate chance to forget. The
   T12 lesson applies: put the carriage in **one** definer function or trigger
   that every writer passes through, not in each writer.
4. **It does not make the WAHA door safe.** A correlation id on an
   unauthenticated webhook correlates an attacker's traffic just as neatly as a
   customer's.

### What `nexus_lead_trace()` already does, and the four things it cannot answer

It exists, it is `SECURITY DEFINER` with the tenant predicate written into every
branch, and it is honest: it names the link kind per hop — `PRIMARY_KEY`,
`FOREIGN_KEY`, `EMAIL_STRING_MATCH`, `NO_ROWS`, `NOT_LINKABLE` — and says
`NOT_LINKABLE` rather than returning "0 messages", because zero for a customer
whose only possible link is an email they do not have is a guess wearing a
number. Its `arrival` hop is already properly keyed on `lead_event.lead_id`.

It cannot answer:

1. **Backwards from a delivery.** There is no `request_id`, so *"what did the
   webhook that fired at 14:03 do?"* has no starting point.
2. **A phone-only customer's messages.** `communication`/`audit` fall to
   `NOT_LINKABLE` by construction.
3. **Which of two enquiries a message belongs to.** One email string, two
   arrivals, one collapsed history.
4. **Whether anything was delivered.** `whatsapp_delivery_events` holds 0 rows
   (measured), so the last hop of the owner's chain has no witness at all.

So: `nexus_lead_trace()` does the *lead → arrival* half of the correlation
already, and reports the other half as unlinkable rather than inventing it. The
gap is exactly the half a correlation id would close, and the function is
already shaped to consume one.

---

## 6 · Evidence that survives a run

Two defects this project has already paid for set the shape:

- **evidence in an ephemeral container is not evidence.** Ten citations pointed
  at `/home/claude/out/` in tracked files; the rule now is that *evidence for a
  claim in a tracked file must itself be tracked* (`CLAUDE.md`, 8 September).
- **no table in this database has a test-marker column** — measured across all
  58 base tables (`RUNBOOK.md` Step 3), and this gate must not add one.

### Where evidence is written

```
ops/certification/
  SOURCE-CERTIFICATION.md        this file — the gate and the ladder
  runs/<run_id>/
    00_manifest.json             run id, level, source, project, t0/t1, operator,
                                 the exact commit and the exact deployed bundle hash
    01_probes.jsonl              one line per probe: step id, actor, statement or URL,
                                 raw result, verdict, timestamp
    02_verdict.md                the certificate for this source (format in §7)
    03_residue.md                what the run created and what it removed, asserted
```

`runs/` is **tracked**, not gitignored — that is the whole point — with one
exception carved out explicitly: **no `public_key`, no secret, no customer name
or phone number is written into any file under it.** A run cites `event_id`s and
`lead_id`s, which are meaningless outside the database, and the CI secret scan
must pass over the directory like any other.

### How a run is identified

`cert-<YYYYMMDD>-<source_key>-L<level>-<nn>` — e.g.
`cert-20260908-google_ads_lead_form-L3-01`. It is recorded in `00_manifest.json`
and repeated in every line of `01_probes.jsonl`. It is **never** written into a
production row.

### How a run is distinguished from real business, without test data in production

Level by level, and the answer is different at each:

**Levels 1–2 — staging only.** Run on `wwspuxrbiyagnrnzgate` against the two Lab
dealerships. Marked by the three structural markers the RUNBOOK already
established, in this order of strength: `tenant_id` (NOT NULL, RLS-enforced,
cannot be forgotten); `lead_event.environment = 'simulation'`, which is set from
the **endpoint** and not from anything a caller sends; and the
`@journey-lab.invalid` email namespace, which can never resolve. No new marker
is needed and none should be added.

**Level 3 — production, and it writes nothing.** This is the level the Journey
Lab does not have, and it is safe precisely because it is all reads, refusals
and rolled-back transactions:

- HTTP probes that are **expected to be refused** — a forged signature, an
  unregistered key, a missing header. A refusal writes no row. This is already
  how the Google receiver's seven refusal shapes were measured.
- SQL **reads** — endpoint state, catalogue, invariants, readiness read as a
  real member session.
- **rolled-back transactions** for anything that must exercise a write path.
  This is already how the manual-entry RPC was proved on production: controls
  A–D ran, produced lead 125, and production was left unchanged at 5 leads.

Two structural locks make this safe rather than merely careful, and both were
measured:

1. `nexus_promote_lead_event` refuses `PROMOTION_REQUIRES_PRODUCTION_ENVIRONMENT`
   for any event whose `environment` is not `production`. **A simulation event
   cannot become a `leads` row.**
2. A production endpoint cannot carry provenance that is not real business
   (`lead_event_production_needs_real_provenance`, measured), so the simulator
   cannot reach production numbers by mislabelling itself.

**The one thing level 3 is allowed to create, and the discipline around it.** A
temporary `simulation` endpoint, where a probe cannot otherwise reach the code
under test — as the Google live probe did. It must be created, used and
**deleted in the same session**, and `03_residue.md` must assert the deletion by
count, not by intention. While it exists, `nexus_lead_source_readiness()` reads
`SIMULATION_ONLY` for that source and never `CONNECTED`, which is what makes it
safe to have existed at all.

**Level 4 — nothing is injected; the first real one is observed.** This is the
move that resolves the whole problem. A level 4 certificate does not create
traffic. It **watches for** the first production arrival on that source and
records its `event_id`, its phase transitions, its `lead_id`, its audit row and
its timings. The evidence of level 4 *is* real business, and marking it as a
test would be the falsification. What the run adds is the **observation**, filed
in `runs/`, citing ids.

The corollary, and it is a hard rule: **level 4 evidence may cite ids and
timings and may not copy customer data into the repository.** No name, no phone,
no message text, ever.

**Level 5** is a commercial fact and its evidence is a commercial document. It
does not live in `runs/`.

### The two things this scheme deliberately refuses

- **A `test_run_id` column on production tables.** It would be the fourth marker
  answering a question three markers already answer on staging, and on production
  it would create the exact hazard it claims to remove: a column that lets a
  future writer mark real traffic as a test.
- **A "certification tenant" on production.** Another agent is separately
  establishing that running test data through production is a blocker. This gate
  agrees and is built so it never needs to.

---

## 7 · The certification report — one page per source

Machine-generatable from `01_probes.jsonl` plus four SQL reads. It is what Ali
can put in front of a dealership. **Every line either carries evidence or says
`NOT RUN`; nothing on it is rounded up.**

```
NEXUS SOURCE CERTIFICATE
Source            Facebook Lead Ads  (meta_lead_ads_facebook)
Dealership        <tenant display name>
Project           dsvuoovivysszdoiorch (production)
Run               cert-20260908-meta_lead_ads_facebook-L3-01
Measured          2026-09-08T18:40:00Z        Operator  <name>
Repo commit       <sha>                       Deployed bundle  <asset hash>

CERTIFIED TO LEVEL:  2 of 5   (PROVEN — unit and staging)

  1  IMPLEMENTED           PASS      receiver JDqy54w2HUH7pHgW, published
  2  PROVEN                DEGRADED  49 unit tests pass; Journey Lab T02 BLOCKED
  3  PRODUCTION-DEPLOYED   DEGRADED  live and fail-closed; endpoint disabled;
                                     0 page identities registered
  4  REAL TRAFFIC PROVEN   NOT RUN   0 lead_event rows for this source
  5  COMMERCIAL VALIDATED  NOT RUN   no commercial outcome is attributable

THE GATE, STEP BY STEP
  step                     actor    verdict   evidence
  F0 page registered       human    NOT RUN   lead_ingest_provider_identity = 0 rows
  F1 lead test             human    NOT RUN   —
  F2 signature raw bytes   machine  PASS      receiver.test.js, 49/49
  F3 Graph fetch           machine  NOT RUN   META_PAGE_ACCESS_TOKEN unset
  F4 normalize             machine  PASS      allowlist + constraint table measured
  F5 lead                  machine  NOT RUN   —
  F6 audit                 machine  NOT RUN   0 rows where workflow = 'ingest:%'
  F7 redelivery            machine  PASS      staging, T21, five backends

WHAT THIS CERTIFICATE DOES NOT SAY
  · that a Facebook lead has ever reached this dealership
  · that a customer has been contacted through this source
  · that this source has produced revenue

BLOCKING, IN ORDER
  1  register the Page against the dealership   (owner, 1 SQL insert)
  2  set META_PAGE_ACCESS_TOKEN on the VM       (owner, a secret)
  3  enable the endpoint                        (owner, 1 SQL update)
  4  fire Meta's Lead Ads Testing Tool          (owner, free, no ad spend)

CORRELATION
  request_id      not implemented
  arrival id      lead_event.event_id — present, not carried downstream
  trace           nexus_lead_trace(<lead_id>) — arrival keyed; communication and
                  audit link by email string, NOT_LINKABLE for a phone-only lead
```

Four rules for generating it:

1. **The headline is the lowest level fully reached**, never the highest level
   with any green in it. A source with `PASS PASS DEGRADED NOT RUN NOT RUN` is
   **certified to level 2**, and the sentence says so.
2. **"WHAT THIS CERTIFICATE DOES NOT SAY" is not optional and is not shortened.**
   It is generated from the levels not reached, so it cannot be edited away.
3. **Every `NOT RUN` carries its blocking reason** in the same line, or it is a
   generation bug.
4. **No number appears without its derivation.** If a step's evidence is a
   count, the certificate carries the statement that produced it.

---

## 8 · What this gate would cost to stand up

Stated so nobody discovers it halfway. Nothing below is scheduled; this file
proposes and does not apply.

| piece | shape | who |
|---|---|---|
| correct `TEST-MATRIX.md` T05, and RUNBOOK Step 0's three stale premises | documentation edit, no code | an agent, one pass |
| the `runs/` skeleton and the probe format | new files under `ops/certification/` | an agent |
| the level-3 probe set per source | mostly already written — the Google seven, the Meta two, the SQL reads here | an agent, read-only |
| `request_id` carriage | `ALTER TABLE` on three tables the dashboard writes, plus every n8n write site, plus the re-grant | a pass of its own, with someone watching |
| level 4 on `walk_in` | one real customer, typed by a real salesperson | the dealership |
| level 4 on Facebook / Google | four owner steps each, all free, listed in `ops/GO-LIVE-SEQUENCE.md` | the owner |
| level 5 | a dealership renewing | not an engineering task |

---

## Unknowns

1. **What a database error becomes on the wire, on both provider receivers.**
   Believed 500, which is the direction that makes the provider hold the lead.
   Not measured, and it cannot be measured without a registered endpoint and a
   secret on the VM. Until then, G3 and its Meta equivalent are `PASS` up to the
   secret check and `NOT RUN` beyond it.
2. **Whether Google's "send test data" re-sends the same `lead_id`.** T05's L3
   half depends on it. Assumed nowhere; check it, do not infer it.
3. **Meta's field-data retention window.** The catalogue's own note says
   secondary sources put it at 90 days and that the figure is **not verified
   against Meta's documentation**. No certificate may quote a number for it.
4. **Whether `lead_event` should keep phase history.** Today it does not
   (measured), so three Journey Lab assertions are unobservable. Whether that is
   a defect or a deliberate economy has not been decided, and this file does not
   decide it.
5. **Which of two shapes owner-assignment keeps** —
   `nexus_lead_assign_owner` as `SECURITY INVOKER` needing the `authenticated`
   UPDATE grant on `leads`, or `SECURITY DEFINER` with a second copy of the
   policy predicate. `20260908090000` is written and held, and its preflight
   correctly refuses until that is decided. The certification gate has no
   opinion; it only records that the decision is open.
6. **The production migration ledger and the repo filenames do not correspond.**
   `supabase_migrations.schema_migrations` on production lists versions up to
   `20260907154626` and does not contain `20260907190000`, `20260907230000` or
   `20260907240000` — yet the objects those files define are live and were
   verified today by reading the function bodies (`for update` present, the
   `ingest:` audit insert present, `on conflict on constraint` present). So the
   **live definition is the witness and the ledger is not.** Why they diverge has
   not been established, and a certification run must read `pg_get_functiondef`,
   never the ledger.
7. **What certifies the notification leg.** Step S5 and step W5 both end at "a
   human was told". `audit_log` records a workflow finishing, not a message
   arriving — this file already records five Slack SUCCESS rows whose summary is
   only `"Completed"`. What evidence distinguishes *sent* from *received* on the
   notification leg has not been specified, and until it is, S5 and W5 can only
   ever be `NOT RUN` or attested by a person.
8. **Whether level 4 on a source can be certified once, or must be re-certified.**
   A provider changes a payload shape without telling anyone in particular. A
   certificate with no expiry will be quoted in six months about a wire that has
   moved. No expiry rule is proposed here because none has been measured to be
   right.
9. **Whether the WAHA door should be certified at all, or retired.**
   `ops/whatsapp-cloud/WAHA-EXIT-PLAN.md` exists. Certifying a transport that is
   scheduled to be replaced may be the wrong spend, and this file records the
   question rather than answering it.
