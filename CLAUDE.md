# Working on NEXUS OS

Read this before doing anything in this repo.

## The governing question — set 8 September 2026

Every piece of work here is judged against one sentence:

> **Can a real dealership enquiry enter NEXUS from a real source at 11 PM,
> become the correct customer and opportunity, receive the right response,
> reach the right salesperson, leave an audit trail, and still be traceable
> six months later?**

It **replaces** "what should we build next". Progress is no longer measured in
commits, nodes, screens or migrations — none of those answers any clause of
that sentence, and this repository has produced a great many of all four.

**The next milestone is not "V1 feature complete".** It is **NEXUS V1 — REAL
DEALERSHIP CERTIFIED**: one real dealership's real enquiries proven end to end
— source → capture → classify → lead → response → sales action → audit →
revenue evidence. `ROADMAP.md` holds the phase that gets there, `V1.5 — Revenue
Capture Reliability`; `VERSIONS.md` holds where each capability stands against
it.

## The Foundation Freeze

**New features are frozen.** Work is admitted in these categories only:

    SECURITY · RELIABILITY · DATA INTEGRITY · INGESTION · OBSERVABILITY ·
    REAL-WORLD TESTING

Every proposed piece of work answers one question before anything else:

> **Does this make the existing core revenue path safer or more provable?**

If the answer is no, it is not built now. It goes to the V2 backlog in
`ROADMAP.md`, whatever its revenue case — the reasoning is written there in
full, and it is short: every V2 feature is worth less on top of a capture layer
that loses enquiries.

The freeze is not a licence to describe unfinished work as finished. The
honesty rules in this file are unchanged; the ladder below is how they are
reported.

Parallel agents remain wanted for docs, SQL analysis, tests, frontend and
research. The live n8n box still takes exactly one writer at a time — see
**House rules**, which now says why.

## Report on five levels, and name the level

Every run reports where a thing stands on this ladder:

    1. IMPLEMENTED   2. PROVEN   3. PRODUCTION-DEPLOYED
    4. REAL TRAFFIC PROVEN   5. COMMERCIAL VALIDATED

The reason is a mistake this repository keeps paying for: **"49 tests pass" is
level 2 and gets read as level 4.** A passing suite says somebody deliberately
tried to break the thing and recorded the result. It says nothing about whether
that thing is deployed, whether a real customer has been through it, or whether
anyone has paid for it. Name the level, name the evidence, and never let a lower
level be quoted as a higher one.

The full applied ladder — every capability against every level — is at
`ops/evidence-standard/STATUS-LADDER.md`. **Do not restate that table here or
anywhere else**: one figure, one derivation.

## Who you are working for

Ali owns this product. As of 2 September 2026 he has decided to run this as a
business rather than as an engineering project, and he has asked that work here
be judged the way an owner judges it:

**Does this make NEXUS OS sellable to a real dealership on a subscription, and
does it keep it sellable once they are using it?**

**That question stands, and the governing question at the top of this file is
how it is now answered.** Sellability was being read as feature coverage; from
8 September 2026 it is read as whether a real enquiry survives the whole path
and can be proved afterwards. Where the two seem to disagree, the sentence at
the top of the file decides.

That is not a licence to cut corners — an owner carries the liability for what
the software says to a customer. It means:

- Weigh revenue, risk and time-to-cash alongside correctness. A defect that
  cannot reach a customer is not urgent. A defect that puts a wrong number in
  front of a buyer, or one dealership's data in front of another, is.
- Say what is proven and what is not, in plain commercial terms. "Wired but
  never fired" is a real and useful answer. A confident claim that turns out to
  be false costs a customer, not a code review.
- Never help overstate the product. The current honest position is a
  **controlled dealership pilot**, not "enterprise-ready" or "compliant". If a
  claim is not backed by evidence in this repo or the database, do not make it
  and do not help make it.
- Prefer finishing one path a buyer can see end to end over improving five they
  will never open.

## What the product is

**NEXUS is a Revenue Recovery & Action OS for dealerships**, not an AI chatbot,
not a CRM, not an automation platform. It sits *above* the dealership's
existing DMS, CRM, inventory and accounting systems, finds where money is
leaking, decides the next best action, and executes it with the team in
control. It replaces none of those systems. `PRODUCT.md` holds the full thesis,
the commercial role of each of the 14 modules, the engines, and the roadmap —
read it before proposing any feature.

**Who it is for: every dealership, not this one.** NEXUS is a multi-tenant
product **by design and by intent**, sold to auto dealerships on a subscription
— the UAE market first, then worldwide. It was not commissioned by, and is not
being built for, any single dealership. **ALBA CARS is tenant #1 and the pilot**
— the proving ground the product is measured on, not the customer it exists to
serve. That is what NEXUS is *for*; it is not a claim that it is safe to put a
second dealership on today, which the next two sections answer, and answer with
"not yet". Judge a feature as
a product decision: *does this hold for a dealership we have not met yet?* A
fact that is really one dealership's configuration — its bank commission
arrangement, its holding-cost rate, its WhatsApp number, its lead-ingest
endpoints — belongs in per-tenant data, never in a constant and never in code.

The sequencing rule that matters more than the strategy: **build the engine
whose data already exists.** An engine that renders "no data" to a paying
dealership is worse than one that does not exist. Measured 2 Sep — inventory
has cost and days-in-stock on all 12 units, so Profit Sentinel is buildable
now; there is **no service table, no appointment table and no recon-cost
column**, so Service Retention and most of Deal Rescue are blocked on
integrations, not on code. Sell those as roadmap, never as capability.

Never fabricate a monetary impact. Estimated, attributed and confirmed are
three different words; do not call an estimate revenue, and do not claim
recovered revenue until a real business outcome occurs.

## Every production measurement in this repo is a measurement of one tenant

Production holds **one active dealership plus a quarantine tenant**. So a figure
taken "as the ALBA owner", "on production" or "on ALBA's real data" is a
one-tenant figure. It says nothing about what a second dealership would see.

That is the deliberate shape of production, not a gap in the testing.
Cross-tenant behaviour is proven **on staging only**, with two synthetic
dealerships — and it is proven there because activating a second dealership on
production silences the five consumers of `nexus_scoped_tenant_id()` tabulated
in the next section.

**Do not let a reader — or yourself — upgrade "works for ALBA" into "works for
any dealership".** Those are two claims with two different pieces of evidence.
When quoting a production figure, say which tenant it was scoped to. When a
check could only run at one tenant, record it as NOT RUN for the multi-tenant
case rather than as a PASS. `commercial/WHAT-WE-CLAIM.md` holds the
customer-facing version of this rule and outranks this file for anything said to
a buyer.

### The 1-in-31 figure is a risk shape, and must never be quoted as a market statistic

It is recorded here because it is the number in this repository most likely to
end up in a pitch deck, and it is the one that must not.

Measured on the only WhatsApp line NEXUS has ever watched: **of 31 genuine 1:1
inbound messages in seven days, one was a vehicle enquiry — and that one was
planted**, Ali's own test from an Indian number.
`ops/whatsapp-lead-capture/SPEC.md` holds the query and characterises the other
thirty (family conversation in four languages, a kitchen-worktop quotation, an
unrelated business chasing a payment, a social-engineering attempt).

**That line is Ali's personal handset**, not a dealership sales line — the
number his family and his other businesses message. So the figure establishes
**the shape of a risk**: an eager capture rule pointed at a real WhatsApp line
would fill a dealership's CRM with family conversation, and production already
holds one such lead (122, "Hussain", created from *"I have been driving for 6-7
hours. Can you please adjust for a while?"*).

**It is not a dealership benchmark and not a base rate.** On a real dealership
number the mix inverts. Do not quote 1-in-31 as a market statistic, as evidence
of how noisy dealership WhatsApp is, or as a justification for a capture rule's
precision. It is a measurement of one personal phone, and it is worth keeping
for exactly that reason.

## Tenancy: the database is finished. The workflows are most of the way.

As of 2 September the database side is **complete**. `tenant_id` on every
tenant-scoped table and NOT NULL on all of them; every natural business key
scoped per dealership (`leads.email`, `customer_360_profiles.customer_id`,
`deals_embeddings.deal_id`, `inventory.id`, `whatsapp_contacts.chat_id`,
`processed_messages.message_id`, `purchase_history.deal_id`, `users.email`);
tenant-scoped RLS; the five SECURITY DEFINER functions that were cross-tenant
bypasses scoped; `v_inventory_sales` and `v_customer_directory` scoped. Proven
adversarially with two synthetic tenants as real roles with JWT claims — reads,
writes, updates, deletes, tenant-hopping, a forged `tenant_id` claim, membership
self-grant, all ten views, hot-lead routing, phone-tail identity collision and
the whole `anon` surface all returned zero. Do not redo this work.

Read "returned zero" narrowly: it meant **zero rows**, and for `anon` that was
evidence about RLS only. The grants underneath were still wide open and were not
closed until 2 Sep (views, then all 16 base tables and the sequences). Row counts
never proved the `anon` surface shut, and no future claim about it should rest on
them.

That 2 Sep pass closed **`anon` only**. It left `authenticated=arwdDxtm` — full
INSERT/UPDATE/DELETE/TRUNCATE — on 32 objects, and the wording above was read by
the next three agents as "grants: done". Narrowed 3 Sep 2026 (migration
`authgrant_narrow_authenticated_to_actual_consumers`): every table and view in
`public` is now `authenticated=r`, except `inventory` (`arwd`) and `leads` (`rw`),
which are live dashboard write paths, and `processed_messages` plus the three
sequences, where `authenticated` now holds nothing. `service_role` unchanged.

17 of 21 n8n workflows now resolve a tenant from something real — the WAHA
session for WhatsApp, the authenticated user via `tenant_members` for
JWT-guarded webhooks, the calling workflow for sub-workflow hops — and stamp it
explicitly rather than relying on the column default.

**It is still not safe to onboard a second dealership**, and what remains is
operational rather than structural:

- `NEXUS_TENANT_MAP` is not set on the box. Every resolver falls through to its
  built-in single-tenant map. The moment that env var holds two keys, roughly
  fifteen code paths switch from "the only dealership" to "unresolved" at once.
  **Rehearse that switch on a staging box before it happens in production.**
- Customer 360 goes *silent* at two dealerships — `nexus_scoped_tenant_id()`
  returns null for a `service_role` caller once more than one tenant is active,
  so the nightly batch syncs nobody and writes no audit row. Silent, not wrong,
  but it must iterate tenants before anyone is onboarded. **Measured, not
  predicted, on 6 Sep 2026** (staging, two active dealerships, one transaction),
  and **it is not only Customer 360.** Five things read their scope from that
  function and all five go quiet together:

  | consumer | at 1 dealership | at 2 |
  |---|---|---|
  | `v_customer_directory` to `service_role` | 4 rows | **0** |
  | `v_inventory_sales` to `service_role` | 3 rows | **0** |
  | `search_rag_documents(q, limit)` — the 2-arg form | 1 row | **0** |
  | `nexus_comm_keys_for_lead(email, phone)` | 3 keys | **0** |
  | `nexus_lead_for_comm_key(key)` | lead 1 | **NULL** |

  Positive control on every line: the 3-argument forms, given an explicit tenant
  in the same transaction, returned 1 row, 3 keys and lead 1; both dealerships'
  own signed-in sessions still saw their own view rows (Alpha 3/2, Bravo 1/1).
  So the zeros are a scope that resolved to nothing, not an empty database.
  Re-proved on **production** on 6 Sep in an aborted transaction: with a second
  tenant made active, `v_inventory_sales` to `service_role` went **12 → 0** and
  RAG **5 → 0**, against a live control of 12 `inventory` rows.

  The identity helpers are the worst of the five and were not on anyone's list:
  they fail closed *by design* at more than one tenant (`return '{}'` / `return
  null`), so inbound WhatsApp stops matching known customers and starts creating
  duplicate people. `nexus_scoped_tenant_id()` was **not** widened to fix this —
  handing a batch some dealership when the caller named none is how one
  dealership's job writes another's data. `public.nexus_active_dealership_ids()`
  (added 6 Sep, `service_role` only) is the plural answer the consumers should
  be driven over instead.
- `tenants.is_unattributed_default` **no longer points at a dealership.** Fixed
  5 Sep 2026 (migrations `20260905201206`/`201227`/`201337`, evidence in
  `ops/evidence/unattributed-default-evidence.md`). It is held by a
  quarantine tenant — slug `__unattributed__`, `status='quarantine'`,
  `is_quarantine=true` — and a CHECK constraint
  (`tenants_unattributed_default_must_be_quarantine`) makes re-pointing it at a
  real dealership impossible without dropping that constraint by name. A backend
  write that omits `tenant_id` is now **retained** under quarantine rather than
  filed under ALBA: unreadable by any dealership session (no `tenant_members`
  row, and `nexus_current_tenant_ids()` requires `status='active'` — both locks
  measured, including against a forged membership row plus a forged JWT claim),
  excluded from all 29 tenant-carrying views **in their own definitions**, and
  findable by `service_role` via `nexus_quarantine_census()`.
  `nexus_scoped_tenant_id()` was decoupled from the flag and still returns ALBA,
  so Customer 360 did not go silent. **What this does not fix:** the four n8n
  workflows that still omit `tenant_id` are not identified anywhere — the repo's
  `n8n-workflows/*.json` is a 30 Aug export containing zero occurrences of
  `tenant_id` and cannot answer it. Their rows now land in quarantine instead of
  ALBA, which is visible and recoverable rather than silent. **Run
  `select * from public.nexus_quarantine_census();` as `service_role` daily until
  it is stable** — that census is the only measurement of which writers are
  broken, and this is the cheapest moment to take it. Also: disabling
  `Resolve Tenant` in n8n, the documented rollback, no longer falls back to ALBA;
  see `ops/evidence/n8n-quarantine-change-NOT-DEPLOYED.md` (not deployed).
- ~~**`workflow_registry` is readable by every signed-in user and is not
  tenant-scoped.**~~ **Closed 6 September 2026** — migration
  `20260906042024_workflow_registry_off_the_dealer_plane_via_vendor_accessor`,
  applied to staging then production, evidence in
  `ops/evidence/workflow-registry-scoping-evidence.md`. **`QUALITY_GATE`
  check L2 now PASSES** (12 open policies, 12 exempt, 0 not) and nothing was
  added to `L2_EXEMPT_TABLES`.

  **It did not get a `tenant_id`, and that was the finding.** The 18 rows are
  the *vendor's* register of the automations NEXUS runs. Nothing in this
  database maps an automation to a dealership, and three of the registered
  workflows are NEXUS's own public pages, which serve none — so a `tenant_id`
  could only have been filled by inventing that mapping, and a
  nullable-meaning-platform one would have been a predicate that filters
  nothing while reading like a scope. The table left the dealer data plane
  instead: **no table grant, no column grant, no `authenticated` policy**
  (`workflow_registry_read` dropped; the anon-deny and service_role policies
  untouched). Measured on production as the ALBA owner with a real JWT claim:
  `count(*)`, `select name`, `select *` and `select id` on the table all return
  **42501**; as `anon` over the live REST API, `42501 permission denied for
  schema public`.

  The one thing CONTROL-PLANE.md Part 4 says a dealership *is* entitled to now
  arrives through `public.nexus_workflow_catalogue()` — `SECURITY DEFINER`,
  `STABLE`, owned by `postgres`, EXECUTE to `authenticated` and `service_role`
  and revoked from `anon` and PUBLIC. It returns the naming projection only
  (`name, audit_name, audit_aliases, category, description, is_active,
  writes_audit_log`) and **cannot** return `id`, `trigger_type` or
  `trigger_detail`: those are absent from the function's own result type rather
  than merely unprojected, so re-opening the leak needs a deliberate edit, not
  a forgotten revoke. The four `security_invoker` views —
  `v_workflow_health`, `v_lead_recovery`, `v_needs_attention`,
  `v_audit_unregistered_writers` — read that function, which is why they still
  work with the table closed. Their outputs were diffed against their
  pre-change bodies: **symmetric difference 0 rows on all four**.
  `v_workflow_health` still returns **18 rows to a dealership session**.

  **A caller acting as `authenticated` gets rows only as a member of an active
  dealership**, so a signed-in session belonging to no dealership now gets zero
  from the accessor and zero from `v_workflow_health` — it used to enumerate
  all 18. **What is still disclosed, deliberately:** a real member can count
  the 18 automations through `v_workflow_health`, because that view is the
  sanctioned projection. The accessor is now the single place a per-dealership
  filter goes when a fact exists to filter on.

`select * from public.nexus_tenancy_readiness();` is the live gate. The BLOCKER
that "fires whenever any tenant holds the default flag" — i.e. could never clear
— was replaced on 5 Sep 2026 by four measured branches, and **production returns
zero BLOCKERs**: two WARNs on `policy_rule` and `policy_rule_event` (nullable by
design, platform scope) and INFO lines. It still cannot see n8n at all, so it
will never report a workflow that omits `tenant_id` directly — but
`nexus_quarantine_census()`, which it surfaces as a WARN, measures exactly that
from the rows those workflows write.

**It was also green over the one thing it exists to catch, until 6 Sep 2026.**
Run on a two-dealership staging database it returned **zero BLOCKERs** while
`nexus_scoped_tenant_id()` returned **NULL in the same transaction** — the
Customer 360 silence above, unreported. Migration
`20260906045700_tenancy_readiness_blocker_for_silent_backend_scope` adds a
BLOCKER that **measures** the resolver rather than assuming it: it fires on
`active dealerships > 1 AND nexus_scoped_tenant_id() IS NULL`, names all five
consumers that go quiet, and says both what would clear it (drive them over
`nexus_active_dealership_ids()`) and what would only look like clearing it
(widening the resolver). Proved both directions: red at two dealerships on
staging and on production; **quiet the moment one is suspended**, and quiet on
production as it stands.

**Every branch of that gate was then fired deliberately, because a gate that
cannot go red is decoration and this file has now found two of them.** Nine
branches, staging, each in its own rolled-back transaction, 6 Sep 2026:

| branch | fired by | result |
|---|---|---|
| BLOCKER default flag on a real dealership | dropping `tenants_unattributed_default_must_be_quarantine`, moving the flag | **fires** |
| BLOCKER nobody holds the flag | clearing `is_unattributed_default` | **fires** |
| BLOCKER backend scope resolves to no dealership | two active dealerships (new) | **fires** |
| WARN rows sitting in quarantine | one `rag_documents` row under the quarantine tenant | **fires** |
| BLOCKER natural key globally unique, workflow-pinned | `create unique index on deals_embeddings(deal_id)` | **fires** |
| WARN natural key globally unique, unpinned | `create unique index on purchase_history(deal_id)` | **fires** |
| BLOCKER `tenant_id` nullable AND defaulted | `alter table competitors alter tenant_id drop not null` | **fires** |
| BLOCKER `tenant_id` nullable and orphaning | …then `drop default` | **fires** |
| INFO natural keys correctly scoped | live state | fires (true today) |

**The tenth could never fire and has been replaced.** The final INFO counted
`tenant_id IS NULL` on `leads`, `communication_logs`, `audit_log`, `inventory`
and `whatsapp_contacts` — all five are `NOT NULL` on both projects, so it was
decoration that read like coverage. It now counts the two tables that genuinely
can hold a NULL (`policy_rule`, `policy_rule_event`) and calls those rows what
they are: **platform scope, not orphans.** Detecting a *newly* nullable table
remains the job of the three catalogue-driven branches, which read
`pg_attribute` rather than a list maintained by hand.

## The lead `source` column recorded the writer, not the origin

6 September 2026. `select source, count(*) from leads group by 1` on production
returns exactly one row:

    nexus-master-router   3

That is the name of the workflow that wrote the rows. The column that would
answer *"did this customer come from Facebook, or Dubizzle, or the website?"*
has been recording the writer. So attribution across sources was not unbuilt —
it was **structurally impossible**, and the Attribution screen has been reading
a field that never held an origin. Six migrations, `leadingest_01` …
`leadingest_06`, answer that **on staging only**. `LEAD-INGESTION.md` is the
full account; what is below is the part that changes how work is done here.

### Three provider facts, checked rather than assumed, that changed the schema before it was written

- **Meta's Lead Ads webhook carries no customer data at all.** Six ids —
  `leadgen_id`, `page_id`, `form_id`, `ad_id`, `adgroup_id`, `created_time` —
  and the fields themselves arrive only from a second `GET /v25.0/<leadgen_id>`
  on the Graph API, which expires. A one-shot "here is a lead" table could not
  have held that arrival, which is why the event has phases.
- **Google Ads sends the whole lead in one hop**, authenticated by `google_key`:
  a plaintext shared secret **inside the JSON body**, not a signature over the
  bytes. Delivery is at-least-once, and a **4XX permanently discards the lead** —
  so a processing failure must answer 5XX, and a redelivery must come back as a
  duplicate rather than as an exception. A refusal shaped as a 4XX here does not
  reject a request; it destroys a customer.
- **Dubizzle Motors has no public leads-out API, no webhook, no developer portal
  and no Zapier integration.** Its enquiries reach a UAE dealer as a WhatsApp
  message from the listing, a phone call, a seller-dashboard entry or a
  notification email. It can be **simulated, intercepted or negotiated — never
  integrated**, and no amount of engineering time produces an API that does not
  exist. YallaMotor and CarSwitch look the same. Sell it as roadmap.

Meta's Lead Ads Testing Tool and Google's "send test data" button both fire the
**real** webhook, cost nothing and need no ad spend — so two of the four
integrable sources are testable end to end at **AED 0**.

### The endpoint decides the dealership, and that is the whole point

Read this next to `POST /webhook/whatsapp-inbound`, which is the shape it exists
to avoid. That webhook takes its tenant from `body.session` — a field the
**caller** supplies — and n8n then writes as `service_role`, which is
`BYPASSRLS`, so one JSON field chooses whose data is written and nothing in the
database filters it.

A lead endpoint takes its tenant from a **registered row** in
`lead_ingest_endpoint`, resolved by `public_key`. And `public_key`
**identifies; it does not authenticate** — it says which endpoint was addressed
and nothing about whether the caller was entitled to address it. The secret that
answers that question is named by `secret_ref` and stored elsewhere. Anyone
reading this later should not upgrade "resolved by public key" into "verified".

### Three structural decisions, each replacing a rule somebody would otherwise have to remember

- **The simulator cannot reach production numbers.** Not a flag a job checks: a
  production endpoint carrying unattestable provenance is **a row that cannot
  exist**, and a `lead_event` is pinned to its endpoint's `environment` by
  composite foreign key. Simulator output labelled production is refused
  `23514`.
- **The Google secret cannot be stored.** `payload_raw` is kept verbatim and
  Google puts `google_key` inside the body, so every Google lead would otherwise
  have filed the endpoint's own authentication secret into a table the
  dealership can read. `lead_event_payload_carries_no_shared_secret` refuses
  the row, which forces the adapter to redact **before** writing rather than
  after somebody notices.
- **A cross-tenant promotion is refused by a trigger, not by a composite
  foreign key — and the reason belongs in this file.** The clean answer would
  be a unique `(id, tenant_id)` on `leads` to point a composite FK at. That
  means `ALTER TABLE` on `leads`, which fires `nexus_guard_born_open_grants()`,
  which strips the two live dashboard write paths (`lib/unit-form.js` →
  `inventory`, `lib/lead-drawer.js` → `leads`). **That has already happened
  once this week.** A trigger buys the same guarantee without touching the
  table: `service_role` bypasses RLS, it does not bypass a trigger. Treat this
  as the worked example — when the guard stands between you and the tidy
  constraint, route around it rather than firing it again and re-opening two
  screens' worth of grants.

### What was proven adversarially, and what the sabotage showed

Two passes on staging, both inside transactions that were rolled back.

**Registration attacks, all refused `23514`:** a production endpoint claiming
simulated provenance; a Meta endpoint downgraded to a shared header; an HMAC
endpoint naming no secret; a website form with no Origin allowlist; an
eight-character public key. **Ingestion attacks, all refused:** an unregistered
endpoint (`LEAD_ENDPOINT_UNRESOLVED`), a `nokey:`-prefixed identity, a 13-digit
clock reading used as an id, a Meta lead presented on a weaker proof, a lead
dated forty days in the future, a Bravo event citing Alpha's endpoint (`23503`),
a `PROMOTED` row with no lead behind it.

**The positive controls held**, which is the half that is easy to skip: the Meta
two-hop recorded `RECEIVED` with no customer data and reached a lead only after
hydration; a redelivery returned `was_duplicate = true` **and did not raise**,
which is precisely what stops Google discarding a real lead; promoting twice
produced one lead; and `leads.source` came out as `meta_lead_ads_facebook` — the
origin, not the writer.

On the read path, as real signed-in sessions: Alpha's owner sees one row in
`v_lead_origin` and none of Bravo's, and the mirror holds. Raw payload, endpoint
id and endpoint keys are refused **`42501` — by grant, not by a row filter**,
which is the distinction this codebase has paid for three times. `anon` is
refused `42P01` at the schema level by the 4 September `public` USAGE revoke —
**a stronger lock than the view's own grant, and it must not be read later as
"the view is missing".**

**The invariants gate was then sabotaged on purpose and went red:** zero FAILs
before, one after planting an unattributed promotion. This file has now twice
found gates that could not go red, so a new gate does not get to be trusted
until it has been made to fail.

### A defect in my own design: one flag was answering two questions

`operator_recorded` carried `counts_as_real = false`, and the production
endpoint CHECK reads that flag — so **a `walk_in` or `phone_call` endpoint was a
row that could not exist in production.** The layer could record Facebook and
could not record the largest lead source in a UAE showroom.

"Did an external system attest this?" and "is this real business?" are not the
same question: a salesperson vouching for a customer they met in the showroom is
real and unattested at once. `leadingest_06` splits them — `counts_as_real`
(commercial) from `is_externally_attested` (cryptographic). A production walk-in
endpoint now registers; a manual-entry endpoint holding a secret or a public
Origin is refused; the simulator is still refused.

Worth recording *how* it was found: the Journey Lab refused to write a verdict it
had not earned, and the contradiction surfaced instead of being rounded to a
pass.

### What is NOT proven — and this half is not smaller than the half above

> Three lines in this section were true when written and are false now. They are
> corrected in place below rather than left to be quoted by the next reader.

- ~~**Nothing has carried a real lead.** Zero rows on both projects.~~
  **Superseded 7 September 2026.** Production now holds **one** `lead_event` and
  the first `leads` row in this project's history whose `source` is an origin
  rather than a writer:

      select source, count(*) from leads group by 1
      nexus-master-router   3
      walk_in               1        <-- lead 121

  (Production `leads` reached **5** later the same day — see the WhatsApp lead
  below. `walk_in` is still 1.)
  It is a **preflight, not a customer** — `walkin-preflight-2026-09-07-01`, email
  under `@nexus-preflight.invalid`, and it is deletable. Do not quote it as
  traffic. What it does prove, on production and not in a rolled-back
  transaction, is that record → hydrate → promote works and that the origin
  survives to `leads.source`. Redelivering the same event returned
  `was_duplicate = true` without raising, and promoting twice returned
  `was_already_promoted = true` with the lead count unchanged at 4.
- ~~**No HTTP endpoint exists yet.**~~ **Partly superseded.** The WhatsApp Cloud
  receiver is built and published (`J8MXprxVw1yhjBpp`,
  `POST/GET /webhook/whatsapp-cloud-inbound`), and it refuses every request today
  because `META_APP_SECRET` is unset — deliberately, see
  `ops/whatsapp-cloud/README.md`. Still true for **leads**: there is no HTTP
  receiver for Meta Lead Ads, Google, or a website form. The database contract is
  built and now exercised; that transport is not.
- ~~**The Meta signature verifier is the highest-risk unwritten piece.**~~
  **Written, tested and deployed** — `ops/n8n-whatsapp-cloud/`, 47 tests. Read
  that directory before writing the Lead Ads receiver: the same signature applies,
  and the sandbox it runs in has **no `crypto` at all**.
- ~~**All twenty Journey Lab verdicts are `NOT RUN`**~~ **Superseded 7 September
  2026: 15 PASS, 0 FAIL, 7 BLOCKED, 1 NOT RUN across 23 journeys**, executed
  against staging with per-journey teardown asserted. T21–T23 are the
  concurrency pass added later that day; T22 was a FAIL and is fixed, and **T12
  — the last standing FAIL — was closed the same day** (see "T12 closed" below:
  a direct `UPDATE` on `leads` wrote 0 audit rows; a trigger now records every
  ownership change from every writer). Still **none of them is L4** — no
  dealership is on a live NEXUS ingestion endpoint, so no verdict here is
  evidence about a real customer, and a green column is not a working product.
- ~~**The six migrations are on staging and deliberately not on production.**~~
  **False as of 7 September 2026, and it was already false when this line was
  last read.** There are **seven** (`leadingest_01` … `leadingest_07`) and all
  seven are on **production** — `supabase_migrations.schema_migrations` carries
  versions `20260907023137` through `20260907024207`, and the objects are live: 4
  tables, 7 functions, 8 provenance kinds, 9 catalogue sources. Anyone planning
  work around "it is staging-only" is planning around a fact that expired.

### Registered production endpoints, and why two of them are disabled

| source | public key | env | status |
|---|---|---|---|
| `walk_in` | `alba-prod-walkin-showroom-floor` | production | **active** |
| `phone_call` | `alba-prod-phonecall-front-desk` | production | **active** |
| `meta_lead_ads_facebook` | `alba-prod-meta-leadads-facebook` | production | disabled |
| `meta_lead_ads_instagram` | `alba-prod-meta-leadads-instagram` | production | disabled |

The two Meta rows are registered and **deliberately `disabled`**. They were
created active, and `nexus_lead_source_readiness()` immediately reported Facebook
and Instagram as `CONNECTED` to an ALBA session — while Meta is subscribed to
nothing, no Page or lead form exists, and `META_APP_SECRET` is unset. That is the
**same defect this function was written to kill**, one layer up: the first
version derived connectedness from `integration_status`, a fact about the
provider; the fix derived it from whether an endpoint row exists; and an endpoint
row is *still* not the same fact as "a delivery can arrive". Disabling them is
the honest state until the subscription exists. Re-enable in one statement then.

Read as the ALBA owner today: **2 CONNECTED** (`walk_in`, `phone_call` — the two
a salesperson can use with no integration at all), **1 NOT_CONNECTABLE**
(Dubizzle), **6 NOT_CONNECTED**.

### Proved on production, 7 September 2026

Six registration attacks, all refused `23514`: a production endpoint claiming
simulated provenance; a Meta endpoint downgraded to a shared header; an HMAC
endpoint naming no secret; a website form with no Origin allowlist; a
manual-entry endpoint holding a secret; an eight-character public key.

Six ingestion attacks, all refused: an unregistered public key (`NX001`), a
`nokey:` identity (`23514`), a bare 13-digit clock reading as an id (`23514`),
provenance stronger than the endpoint declares (`NX001`), a lead dated forty days
ahead (`NX001`), and `google_key` nested three deep inside `payload_raw`
(`23514`). **Positive control held**: the same body redacted, with `gcl_id`
preserved, still inserted and reached `HYDRATED` — so the guard is not too wide.

Dealer read path as a real ALBA session: `v_lead_origin` **1 row**;
`payload_raw`, `lead_event.endpoint_id`, `lead_ingest_endpoint.public_key` and
`secret_ref` all refused **`42501` — by grant, not by a row filter**.

**And the gate was made to go red, because a gate that cannot fail is
decoration.** `nexus_lead_ingest_invariants()` returns 7 PASS / 2 INFO / 0 FAIL
on production. Two sabotages, both rolled back:

- Direct `UPDATE lead_event SET origin_verified='simulated'` as `service_role`,
  which bypasses RLS — **refused `23503`**. The event is pinned to its endpoint's
  provenance by foreign key, so even the bypass role cannot downgrade a live
  arrival. Gate stayed 0 FAIL, correctly: the state is unreachable.
- Dropping `lead_ingest_endpoint_production_needs_real_provenance` and
  `..._production_matches_source`, then registering the row they exist to
  refuse — **gate went to 1 FAIL**, naming "A production endpoint never accepts
  provenance that is not real business".

Both constraints and all 17 verified back in place afterwards.

Repo↔production parity is **byte-exact over the 288 shared migrations** — see
`ops/PARITY-2026-09-06.md`, and note its own caveat that a version-keyed rollup
cannot answer a content question once versions diverge.

### Door three never looked at `environment` — 7 September 2026

Found by asking a narrow question: *is it safe to register a simulation Google
endpoint so the receiver can be proven end to end?* The answer was no, and not
for a Google reason.

Parts 2 and 3 of the lead-ingest layer both claim, in their own comments, that
the simulator cannot reach production numbers "because the row it would need
cannot be written". That is true of **recording**. It was never true of
**promotion**. Measured on production before the fix:

```
pg_get_functiondef(nexus_promote_lead_event) like '%environment%'   ->  0
columns of public.leads matching (sim|test|demo|fixture|synthetic)  ->  0
```

A simulation `lead_event`, once hydrated, inserted into `public.leads` exactly
like a real customer — into a table with no column that could ever say
otherwise. Pipeline value, response-time reporting and every recovered-revenue
figure would have counted it. **Nothing had happened**: zero simulation
endpoints, zero simulation events. A door that was open, not a mess.

Migration `20260907124500_leadingest_10` makes door three refuse a non-production
event with `PROMOTION_REQUIRES_PRODUCTION_ENVIRONMENT`, and says in its HINT
what would have to exist first. The tempting fix — `leads.is_simulation` — was
deliberately **not** taken: an `ALTER TABLE` on `public.leads` fires
`nexus_guard_born_open_grants()` and strips the live dashboard's write grants,
and a flag half the readers ignore is worse than no flag. That is a change to
make with someone watching.

**Proven on staging first, with a positive control**: the simulation event
refused; a production event alongside it still promoted (lead 31,
`source = google_ads_lead_form`). Then applied to production and verified —
guard present, `anon` and `authenticated` denied by `has_function_privilege()`,
`service_role` allowed, `leads` unchanged at 4 rows, `lead_event` at 1.

### The most valuable field on a car dealership's lead row was being dropped

Same migration. The promoter reads `normalized->>'vehicle_interest'`. Both
receivers written this week emit `vehicle_of_interest`.
`nexus_lead_normalized_defect()` does not mention a vehicle at all, so nothing
complained — every Meta and Google lead would have landed with
`leads.vehicle_interest` NULL. A silent near-miss between two spellings,
invisible because the contract was silent about the field.

The promoter now coalesces both spellings, so no lead in flight loses the
answer, and both test suites now pin the pair so a third spelling cannot be
introduced quietly. The contract is deliberately left permissive: refusing the
wrong spelling would have turned a dropped field into a dropped customer.

### The constraint re-measurement that corrected a shipped receiver

`lead_event_payload_carries_no_shared_secret` refuses a string — key or value,
at any depth — that is **exactly** one of six credential words. Substrings never
trip it; one trailing character clears it; the match ignores case.

The Meta receiver shipped guarding question LABELS only, with a SUBSTRING regex.
Wrong in both directions from one wrong rule: a customer whose whole answer was
`authorization` would have failed the insert and been thrown away, while a
harmless label like `my_api_key` was renamed for nothing. I had measured an
embedded word and generalised the result to every word.

Repo bodies and tests for both receivers are corrected (Meta 49 tests, Google
56), and the Meta box was fixed and **verified on the box, both ways**.
`test_workflow` pins the upstream nodes and lets a Code node execute for real,
which reaches `Normalize And Redact` while `META_APP_SECRET` is still unset:

| execution | node output | Postgres verdict |
|---|---|---|
| `10879` (old body) | the bare word | **REFUSED `23514`** — customer thrown away |
| `10880` (new body) | the word plus a stated note, `annotated_answers: 2` | **would INSERT** |

That technique — pin every trigger, credentialled and HTTP node, let the Code
node run — is the only way to exercise these receivers before their secrets
exist. Use it. All three live URLs still fail closed afterwards:
`500 APP_SECRET_NOT_CONFIGURED` for both Meta receivers, `403
GOOGLE_KEY_REJECTED` for Google.

### The Google Ads Lead Form receiver is live and refuses everything

n8n `EYva4c2bMV5MGq0o`, `POST /webhook/google-ads-lead?k=<endpoint public key>`.
Measured on the live box: `404` with no key, `404` malformed key, `400` no
`lead_id`, `400` array body, `403` unregistered key, and — with a registered
endpoint whose secret is unset — **`500 ENDPOINT_SECRET_NOT_CONFIGURED`**, which
is the answer that makes Google **hold** the lead rather than discard it.

Google retries a 5XX and permanently discards on a 4XX, so the status code is a
decision about a real customer, not a formality. An unconfigured secret answers
5XX on purpose. A form that collected too little to contact anyone answers 200
and records a `REJECTED` event — the delivery was fine, the form is what needs
changing.

Two things this receiver does **not** control, stated rather than glossed:
`google_key` is in n8n's own execution store because the webhook node holds the
raw body before any of this runs, and a malformed JSON body never reaches the
code at all — n8n answers `422` first, so a truncated Google POST that a retry
might have fixed is discarded by n8n, not by us.

The path was originally `google-ads-lead/:key`. n8n registers a
path-parameter webhook under an internal `webhookId` prefix, so the clean URL
404s — measured, not assumed. The key moved to `?k=`.

### The 42 SECURITY DEFINER functions a dealership user can reach — 7 Sep 2026

`SECURITY DEFINER` runs as the owner and **bypasses RLS**, so every one of these
is responsible for its own tenant scoping and they are the surface worth auditing
first. Audited transitively (a function counts as scoped if it derives the
caller's identity directly **or through a call** — the first pass called
`lead_recovery_decide` unscoped and was wrong, because it delegates to
`action_approver_context()`):

| verdict | reads | writes |
|---|---|---|
| derives the caller's identity | 17 | 24 |
| **does not** | **1** | 0 |

The one: **`nexus_kyc_object_tenant(text)`**, and it was answering the exact
question RLS had just refused. Measured on production from a signed-in account
belonging to **zero** dealerships:

```
rows it could SELECT from public.kyc_documents ... 0          <- RLS works
nexus_kyc_object_tenant(<a real kyc path>) ....... fff6a2b5-… <- and this
nexus_kyc_object_tenant('kyc/999999/nope') ....... NULL       <- clean control
```

Existence **and** ownership, cross-tenant, over passports and Emirates IDs. And
the paths are walkable, not opaque: all 35 characters, all `kyc/<integer>/…`,
**none containing a uuid**. One dealership on production today, so nothing has
crossed a boundary — the second dealership is what turns the shape into a leak.

**The grant could not simply be revoked**: policy `kyc_objects_staff_read` on
`storage.objects` calls it, and Postgres evaluates a policy expression as the
*querying* role, so revoking it breaks every KYC read. A designed grant whose
side effect was never priced.

`20260907150000` replaces "whose is this?" with "may I read this?".
`nexus_kyc_object_readable(text)` encodes the whole policy predicate and returns
a boolean, so calling it directly reveals nothing a read attempt would not.
Verified on production, with the positive control that matters:

| caller | old oracle | may read a real object | may read a made-up path |
|---|---|---|---|
| unaffiliated account | **refused 42501** | false | false |
| a member of the owning dealership | — | **true** | false |

An outsider can no longer tell a real path from an invented one, and the
legitimate reader is unaffected.

### Branch by branch, the RLS-bypassing surface holds — 7 Sep 2026

The earlier audit asked *does this function derive the caller's identity at all?*
This one asks the harder question: having derived it, does it **use** it on every
statement that touches tenant-scoped data? A function can read `auth.uid()` in
its first line and update another dealership's row in its last.

Over the 42 `SECURITY DEFINER` functions `authenticated` can reach: **5
statements in 5 functions** touch a tenant-scoped table with no tenant
predicate, and **zero of them are writes**. All five read, all five correct:

- `action_decide`, `lead_recovery_decide` — `select u.name … where u.id =
  v_row.decided_by_staff_id`. `v_row` was loaded with a tenant predicate, so the
  id is already this dealership's; a foreign id yields NULL, not a name.
- `policy_verify_rule`, `policy_supersede_rule`, `policy_withdraw_rule` —
  `select * into r from policy_rule where id = p_rule_id`. This one **cannot**
  carry a tenant predicate: you must load the row to learn whose it is, and the
  three then refuse by name (`GLOBAL_RULE_NOT_TENANT_VERIFIABLE`,
  `WRONG_TENANT`, `JURISDICTION_NOT_YOURS_TO_LEGISLATE`). Verified: those
  refusals go through `policy_refuse()`, which **raises**, and every UPDATE in
  the family carries `and tenant_id = ctx.tenant_id` in the statement itself.

`nexus_definer_scoping_audit()` (`20260907160000`) makes that a standing check —
REVIEW rows are the finding, zero is healthy. Made to go red: a planted function
reading *and* writing `leads` unscoped returned two REVIEW rows with `is_write`
correctly set.

**And the audit's own exemption mechanism had a hole, found by testing it.** The
exemption was keyed on the statement hash alone, so any function containing a
byte-identical statement would inherit it. The planted attempt came back REVIEW
— but only because its `;`-split chunk picked up a leading `begin`, so it was
refused **by accident, not by design**. `20260907160500` keys on
`(function_name, statement_md5)`: editing the statement lapses the exemption, a
different function cannot borrow it, and a rename lapses it too.

What it cannot see, so nobody reads zero rows as safety: it splits on `;`, so a
predicate in a neighbouring statement is invisible — which is exactly the
`policy_rule` shape, correct there and identical-looking if it were wrong. And it
matches the *word* `tenant_id`, not a correct comparison: `tenant_id =
p_tenant_id` from a caller-supplied argument passes, and that is the original
defect this whole layer exists to remove.

### Attribution a dealership can read, and a false finding a positive control caught

`20260907170000`. Both Meta receivers and the Google receiver already recorded
platform, campaign, adset, ad and form — all of it inside `hydrated_payload` /
`payload_raw`, on columns the dealer plane is **denied by column grant**. The
facts existed and nobody could ask a question of them.

`nexus_lead_attribution(p_since)` is the read-side projection.
`nexus_lead_attribution_summary(p_since)` is the shape a dashboard should read,
and it is built so it **cannot flatter**: the UNKNOWN bucket is emitted even at
zero, and `share_of_known` and `share_of_all` are two different numbers so the
kinder one cannot be quoted by accident. Verified on production:

| caller | attribution rows | summary |
|---|---|---|
| account in 0 dealerships | 0 | 1 bucket — UNKNOWN, at zero |
| a real member | 1 | `UNKNOWN=1 (of_known n/a, of_all 100.0)` |

The single production lead reads `UNKNOWN / UNKNOWN / PLATFORM_UNKNOWN` with the
evidence sentence spelled out. It is not quietly filed under Facebook.

**Three things this cost, worth keeping:**

1. It is a FUNCTION, not a view, and not by preference. An invoker view cannot
   read `payload_raw` (column grant), and a view **without** `security_invoker`
   is refused outright by `nexus_require_security_invoker_views()` — an event
   trigger that has been guarding this since before today. So: SECURITY DEFINER
   with the tenant predicate written into the statement.
2. **A boolean reloption has more than one spelling.** A sweep flagged
   `v_competitor_latest` as definer-semantics, dealer-readable and unscoped —
   which sounded exactly like the KYC oracle. It is spelled
   `security_invoker=on`; the other 41 views say `=true`; the sweep compared
   against the literal `'true'` and read `on` as OFF. The positive control
   settled it before anything was written down: 0 rows to an unaffiliated
   account, 7 to a real member — precisely what invoker semantics predicts.
   **The measurement was right and my reading of it was wrong.** An audit that
   string-matches one spelling of a boolean is blind in a direction that will
   not always be the safe one.
3. `service_role` gets **zero** rows from the attribution function by design —
   `nexus_current_tenant_ids()` is empty for it. It answers "my dealership's
   attribution"; the vendor reads `lead_event`.

### There is no correlation id, and the join key is an email string

`20260907180000`. "What happened to this customer?" could not be answered, and
the reason is structural. `communication_logs` and `audit_log` link to a
customer by **`lead_email`** — an email address string. Not `lead_id`, not a
foreign key. Measured on production:

| | |
|---|---|
| leads | 4 |
| **leads with no email at all** | **1 (25%)** |
| `communication_logs` | 120 |
| ...whose `lead_email` matches no lead | **95 (79%)** |
| `audit_log` | 843 |
| ...carrying no `lead_email` at all | **775 (92%)** |

So a phone-only lead — a walk-in, a WhatsApp enquiry, the ordinary UAE case — is
**unlinkable**, 92% of the audit trail is attached to nobody, and two enquiries
from one person collapse into one history.

`nexus_lead_trace(lead_id)` answers what can be answered and says `NOT_LINKABLE`
where it cannot, because "0 messages" for a customer whose only possible link is
an email they do not have is a guess wearing a number. Verified on production:

| lead | hops |
|---|---|
| with an email | `lead=PRIMARY_KEY, arrival=NO_ROWS, communication=EMAIL_STRING_MATCH, audit=EMAIL_STRING_MATCH` |
| **without an email** | `lead=PRIMARY_KEY, arrival=NO_ROWS, communication=NOT_LINKABLE, audit=NOT_LINKABLE` |
| another dealership's lead | 0 rows |

`arrival=NO_ROWS` on both is itself honest: those leads predate the ingestion
layer, and the row says so rather than implying the customer never arrived.

**The real fix is owed, not done**: a `lead_id` foreign key on
`communication_logs`, or a correlation id carried from receiver to outbound
message. Both are `ALTER TABLE` on tables the live dashboard writes, which fires
`nexus_guard_born_open_grants()` and strips those grants. That is a change to
make with someone watching. `nexus_trace_linkability_report()` (service_role,
deliberately cross-tenant, counts only — no names, no message text) keeps the
gap as a number somebody can watch shrink.

### Three doors read a row and then wrote it, and one made three customers

7 September 2026. The Journey Lab's own README had said since the day it was
written that nineteen sequential journeys prove nothing about concurrency. Five
`pg_cron` backends behind a `pg_sleep_until` barrier — all five entering inside
**25 ms**, measured from `clock_timestamp()` — were pointed at the three
ingestion doors on staging. All three were read-then-write with no lock.

| door | five concurrent callers, before | after |
|---|---|---|
| `nexus_record_lead_event` | 1 insert, **4 × `23505`** | 1 insert, 4 × `was_duplicate = true`, no exception |
| `nexus_hydrate_lead_event` | **5 hydrations, last write wins** | 1 hydration, 4 × `LEAD_EVENT_NOT_AWAITING_HYDRATION` |
| `nexus_promote_lead_event` (lead **with** an email) | 1 lead, 4 × `23505 leads_tenant_email_key` | 1 lead, 4 idempotent |
| `nexus_promote_lead_event` (lead with **no** email) | **THREE leads: 41, 42, 43. Zero errors.** | 1 lead, all five callers naming it |

**The last row is the defect, and the row above it is why nobody had seen it.**
Promotion of an emailed lead looked safe only because a unique index on
`(tenant_id, email)` refused the second insert — an *incidental* lock, which
this file already records the worth of. A unique index does not constrain NULLs,
and door three writes NULL for a lead with no email. That is the ordinary UAE
case: the walk-in, the phone call, the WhatsApp enquiry. This file measures 25%
of production leads as having no email at all.

**And the damage was invisible from every angle anyone was looking from.**
`lead_event.lead_id` holds one value, so it kept 42; leads 41 and 43 were
orphans that no event points at. They satisfy every constraint on `lead_event`
(no `lead_event` is involved), they carry a real origin in `leads.source` so
`nexus_lead_attribution` counts them, and `nexus_lead_trace` answers
`arrival = NO_ROWS` for them — which reads as *"this customer predates the
ingestion layer"*, not as a fault. Two of the five callers were told
`was_already_promoted = true` while two others were making the duplicates, and
**every caller got a success.** Three salespeople, three CRM cards, one person
called three times.

`20260907190000`, on staging **and** production. The fix is `SELECT … FOR
UPDATE` on the event row for hydrate and promote, and `INSERT … ON CONFLICT ON
CONSTRAINT lead_event_identity_key DO NOTHING` plus a re-read for record. **Not**
a unique index on `leads` and **not** a marker column: both are `ALTER TABLE` on
`public.leads`, which fires `nexus_guard_born_open_grants()`. Route around the
guard — the worked example this file already carries.

`nexus_lead_ingest_invariants()` gains an eighth check — *every lead carrying an
ingestion source is pointed at by the event that made it* — and **it went red on
the wreckage the race had just made** (`2 orphan lead(s): 41, 43`), then green
after teardown. A gate made to fail by the defect itself, not by a planted
sabotage.

Semantic parity confirmed across all four bodies: comment- and
whitespace-normalised `md5(prosrc)` identical on both projects, while the raw
hashes differ — which is the distinction this file already insists on. Staging
teardown asserted back to the exact pre-run snapshot (3 `lead_event`, 31
`leads`). Production positive control: promoting the already-promoted preflight
event returns `lead_id = 121, was_already_promoted = true` and creates nothing.

**Two things this did not settle.** Five backends is not load — nothing here
says what happens at fifty deliveries or under a connection-pool limit, and
`FOR UPDATE` now serialises promotions of one event, which is free at this
volume and worth watching at real volume. And the receiver's behaviour when
Postgres refuses is still **asserted, not measured**: all four HTTP nodes carry
`retryOnFail: true, maxTries: 3` with `onError: null`, so a refusal throws and
n8n answers the caller itself — believed to be 500, which is the direction that
makes Google hold the lead, but it is not in `ops/n8n-google-lead-form/README.md`'s
probe table and reaching that node over HTTP needs a secret on the VM.

**A related repo defect, same class.** `receiver.sdk.js` and `build-sdk.js`
declared the Google webhook path as `google-ads-lead/:key` while the published
workflow has said `google-ads-lead` since the path parameter was measured to
404. `build-sdk.js` round-trips the two Code **bodies** and nothing around them,
so a wrong path, credential or retry setting in the scaffolding is invisible to
the check whose whole purpose is repo↔box equality. Corrected, and the limit is
now written into the generator.

### No receiver wrote an audit row — T12's shape at the other end of the funnel

7 September 2026, found by checking rather than by it biting:

```
grep -c audit_log  ops/n8n-google-lead-form/receiver.sdk.js   ->  0
grep -c audit_log  ops/n8n-meta-lead-ads/*.js                 ->  0
the Meta workflow's graph:  Promote To Lead -> Respond 200 Promoted, end.
```

Every receiver built this week would have created a real customer with **no
entry in the one table a dealership reads to answer "what happened"**. Nothing
had gone wrong yet only because no receiver has carried a lead.

**The audit went into door three, not into each receiver** — the T12 lesson
applied at the other end. A writer that audits itself audits *one* writer, and
there are four receivers plus manual entry plus whatever comes next, each a
separate chance to forget. Every lead that becomes a customer passes through
`nexus_promote_lead_event`, so now no receiver *can* forget, and the sentence has
one derivation rather than five that drift.

It also **removed** one that already existed: `nexus_lead_record_manual` wrote
its own an hour earlier. Two writers for one fact is how a count ends up double.

The row spells the provenance out in words, because it is what somebody reads
when asking whether a lead is real:

```
ingest:walk_in       … origin operator_recorded (a person's word, not a signature)
ingest:website_form  … origin origin_and_form_key (attested by the provider)
```

Fails closed, same reason as T12's trigger: a customer in the funnel with no
record of arriving is worse than a delivery the provider retries, and Meta and
Google both redeliver.

### The Meta Lead Ads receiver was already built — checked, not rebuilt

Asked to "build the Meta Lead Ads receiver", the first thing to do was look:
`ops/n8n-meta-lead-ads/` is live (`JDqy54w2HUH7pHgW`), fail-closed, and carries
**49 passing tests**. Raw-body HMAC, `page_id` identity resolution, the Graph
hop, `field_data` normalisation, allowlist redaction, and an explicit rule that
attribution never touches `lead_event_identity_key` — all present.

Two things were genuinely worth checking rather than assuming:

- **"registered / verified / active endpoint checks"** — measured on staging with
  a positive control, all three levels refuse: a disabled **page identity**, a
  disabled **endpoint**, and a suspended **dealership** each return zero rows
  from `nexus_lead_endpoint_for_provider_identity()`, while the active case
  resolves.
- **the audit row** — genuinely missing, and that is the section above.

What is still missing is not code: `META_APP_SECRET`,
`META_WEBHOOK_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN`, a Facebook Page, and the
`leadgen` subscription. **Do not rebuild this receiver.**

### A salesperson can now put a walk-in into NEXUS

7 September 2026. The other half of the `REGISTERED_NO_ENTRY_PATH` finding: the
endpoints, the provenance ladder and the promoter all existed, and the person
standing in the showroom had nowhere to type.

`nexus_lead_record_manual()` is the path, and it is the **one place a browser
crosses into the ingestion layer**. That is a new write surface on the dealer
plane, which this file spent the morning arguing against for owner assignment —
the difference is that there a narrow column grant already existed to reuse, and
here doors one and three are `service_role`-only, so no grant exists and the
capability genuinely has to cross. It crosses once, through one function, with
every decision that matters taken from the **session**:

| the caller may not decide | why, in one line |
|---|---|
| the dealership | from `nexus_current_tenant_ids()`, no argument, no fallback — `/webhook/whatsapp-inbound` takes its tenant from a caller-supplied field, and that is the open door we still live with |
| the endpoint | resolved by `(tenant, source_key)`; a caller-supplied key is how one dealership posts into another's pipeline |
| the source | `MANUAL_ENTRY` only — otherwise anybody with a login could manufacture attribution, which is what ad spend gets judged against |
| the provenance | forced to `operator_recorded`: a person's word, recorded as a person's word |

**Ambiguity is refused, not resolved.** An account in two dealerships gets a
refusal naming the problem rather than having one picked for it.

**Idempotency is the caller's request id**, generated once when the dialog opens
and re-sent on every attempt, because the failure it prevents is a double-click.
Two *different* reps entering the same walk-in produce two leads, and that is
correct — they are two separate acts of recording, and merging two people into
one row is identity resolution, which must not be solved here by accident.

Five controls, one rolled-back staging transaction: the happy path
(**phone-only, no email**) produced lead 45 with `source = walk_in` — an origin,
not a writer; the same request id again returned **lead 45, `was_duplicate =
true`**; `meta_lead_ads_facebook` by hand was refused; a lead with no phone and
no email was refused by the contract's own rule; an account in no dealership was
refused. **`leads` went 31 → 32 across all five attempts.**

**A defect caught while writing it:** the function was first declared `returns
null on null input`. STRICT makes the whole function return NULL the moment *any*
argument is null, and `p_email`, `p_vehicle_interest` and `p_budget_aed` are all
optional — so every refusal above would have become a silent empty answer the
form renders as "nothing happened". The migration now asserts `proisstrict` is
false.

`lib/manual-lead-form.js` is the screen, reached from an **Add a lead** button on
Leads. It writes nothing itself. The picker offers only `MANUAL_ENTRY` sources —
a convenience, not the control, since the server refuses the rest anyway.

**And the readiness flip is deliberately staging-only.**
`20260907230000` sets `manual_entry_surface`, which turns `walk_in` and
`phone_call` back to **CONNECTED** — proving `20260907200000` was a recorded fact
and not a hardcode. It must run on **production only on the day the dashboard is
deployed**: the column records a fact about the *shipped* bundle, and setting it
early would put the green pill back while the deployed bundle still had no
button, which is the same defect re-introduced by its own fix. The check is one
line — the browser bundle must contain `rpc/nexus_lead_record_manual`.

Staging after the flip: **4 CONNECTED** (`walk_in`, `phone_call`,
`meta_lead_ads_facebook`, `website_form`). Production stays at **0 CONNECTED**
until the deploy.

`ops/journey-lab/CONCURRENCY-REGRESSION.sql` makes the promotion race a standing
check: **ten** concurrent backends on one phone-only event must produce exactly
one lead, zero orphans, zero raises and nine idempotent answers. It says in its
own header why it must be phone-only — the same race on an emailed lead goes
green while the defect is fully open, because a unique index refuses the second
insert and a unique index does not constrain NULLs.

### T12 closed: who reassigned this lead, and why

7 September 2026. A direct `UPDATE` on `public.leads` — the dashboard's own
owner-assignment path — changed the owner and wrote **zero** audit rows. Fixed
by a trigger, not by the RPC that was the obvious answer, and then by an RPC as
well for the half a trigger cannot do.

**`CREATE TRIGGER` on `public.leads` does not fire the guard, and that was
measured.** `nexus_guard_born_open_grants()` has `evttags = null`, so it fires on
**every** `ddl_command_end` — but it acts only on rows whose `object_type` is
`table` / `view` / `sequence` / `function`, and `CREATE TRIGGER` reports
`trigger`. Proved on staging in a rolled-back transaction: 8 column grants
before and after, `relacl` byte-identical, `authenticated` still holds UPDATE.
**The guard's blast radius is `ALTER TABLE`, not "any DDL near `leads`"** — which
widens what can be fixed here without the two-screen outage this file keeps
warning about.

**Why a trigger and not a definer RPC**, in order of weight: a definer RPC
bypasses RLS and would need a **second copy** of `leads_role_update`'s
authorisation, and the copy that drifts is the one that silently grants too much;
it audits **one writer**, while n8n writes as `service_role` and would bypass it;
and it is a **new write surface** on the dealer plane, where the browser holds
one narrow column grant today.

Proved on staging, every one a separate rolled-back transaction:

| control | result |
|---|---|
| the exact dashboard write, as a signed-in manager | `REASSIGNED`, `tenant_member`, actor auth id **and** staff id, from/to names, linked `audit_log` row |
| a `sales` rep taking a lead that is not theirs | **0 rows** — authorisation unchanged |
| an edit to any other column | **0 events** |
| a `service_role` write (the n8n path) | audited, `actor_authority = service_role`, no person named |
| **audit table made to refuse** | the owner change was **refused `23514`** and the owner was unchanged — it fails closed |

**A defect the control caught before it shipped.** The first version derived the
actor from `current_user = 'service_role'`, which inside a `SECURITY DEFINER`
function is **always the owner** — so it could never be true, and an n8n write
came out labelled `database_owner`: a machine blaming a different machine. The
answer is `current_setting('role')`, which carries PostgREST's per-request
`SET ROLE` and survives the definer switch. Found by running the control, not by
reading the code.

**And the RPC, `nexus_lead_assign_owner`, is `SECURITY INVOKER`** — the UPDATE
runs as the caller, so the same policy still decides and nothing is
re-implemented or bypassed. It exists for two things a PATCH cannot do:

1. **The reason.** PostgREST will not set an arbitrary GUC for a browser, so
   `nexus.change_reason` — the seam the trigger reads — is reachable only from
   inside a function. Through the RPC a reason is recorded; through a PATCH it is
   NULL, and NULL means nobody said.
2. **A measured cross-dealership defect.** `leads_role_update`'s WITH CHECK
   constrains `leads.tenant_id` and says **nothing** about `assigned_to_id`. As a
   real signed-in Alpha manager: through the RPC, refused by name; **by direct
   PATCH, accepted** — Alpha's lead came out owned by Bravo's owner. Not an
   access leak (the lead stays put and the stranger still cannot read it), but
   the screen then names a rep nobody is accountable to.

`lib/lead-drawer.js` now calls the RPC and takes an optional "why". **The shipped
bundle contains zero `leads?id=eq` writes**, so the `authenticated` column-level
UPDATE grant on `leads` — the one kept because "revoking it breaks the screen" —
**no longer has a screen behind it.** Revoking it is now a real option and a
separate decision: check n8n first, because `service_role` does not need it but
something else might.

**No backfill.** Every ownership change before today is unrecorded and is not
reconstructable. `lead_owner_events` starts empty on both projects and says so.

### CONNECTED meant a row exists, and nobody could type into it

7 September 2026. `nexus_lead_source_readiness()` reported **2 CONNECTED** to
the ALBA owner — `walk_in` and `phone_call` — and those were the *only* two
sources reading connected, so the entire positive half of the Lead Sources
screen was this. Both endpoints are registered, active and production.

Then the dashboard was searched for any way a human can put a lead into NEXUS,
source and built bundle both. **There is none.**

| searched for | result |
|---|---|
| any add-lead / walk-in / manual-entry form | **not found** |
| a `POST` to `leads` | **not found** — the only write touching `leads` anywhere is `lib/lead-drawer.js:490`, a `PATCH` of `assigned_to_id` on a row that already exists |
| `nexus_record_lead_event` / `hydrate` / `promote` in the app | **not found**, source or bundle |
| `lead_event` as a string in the bundle | **zero occurrences** |

And the three doors are `service_role`-only by grant, so a signed-in
salesperson could not call them from the browser even if a form existed.

**This is the third turn of the same mistake, and the previous two are recorded
above in this file.** v1 derived connectedness from `integration_status` — a
fact about the *provider*. v2 derived it from whether an endpoint row exists — a
fact about *us*, and its own comment already says an endpoint row *"is still not
the same fact as a delivery can arrive"*. v3: for a **webhook** source the
deliverer is a provider that posts to the endpoint, so the endpoint **is** the
path. For a **`MANUAL_ENTRY`** source the deliverer is a person and the path is
a screen. A registered endpoint with no screen behind it is a door with no
handle on the inside.

`20260907200000`, both projects. `lead_source_catalogue.manual_entry_surface`
names the screen, NULL when there is not one, with a CHECK that only a
`MANUAL_ENTRY` source may name one. The readiness function gains
`REGISTERED_NO_ENTRY_PATH`, evaluated **before** the CONNECTED branch. **A
column and not a rule**: "MANUAL_ENTRY is never CONNECTED" would be wrong the
day the form ships, and silently — the function cannot see the dashboard, so a
person having a way to do this is a fact somebody must *record*.

Both controls held on staging, in one rolled-back transaction: setting
`manual_entry_surface` flips `walk_in` straight back to `CONNECTED`, so the
branch is not a hardcode wearing a column; and a `WEBHOOK_FULL_PAYLOAD` source
claiming a surface is refused by the CHECK.

**Production now reads 0 CONNECTED**, which is the true state: NEXUS is
receiving from nothing today.

    before   CONNECTED 2 (phone_call, walk_in) · NOT_CONNECTABLE 1 · NOT_CONNECTED 6
    after    REGISTERED_NO_ENTRY_PATH 2        · NOT_CONNECTABLE 1 · NOT_CONNECTED 6

`ALTER TABLE` was safe here and that was checked rather than assumed:
`nexus_guard_born_open_grants()` strips ALL from `anon` and
INSERT/UPDATE/DELETE/TRUNCATE from `authenticated`, and this table holds exactly
`authenticated=r`. The migration asserts the grant survived rather than trusting
the reasoning.

**The screen was already right about not knowing.** Until the dashboard is
redeployed, `connectionCell()` meets the unfamiliar word with a *stated unknown*
that prints the raw value, and the FAULT row names it — by design, and far
better than a false green. `lib/vocabulary.js` now carries the state (tone
`warm`, not `unknown`: NOT_CONNECTED is neutral because nobody has done anything
wrong yet, whereas here the dealership **did** the setup and the missing half is
ours). Three captions saying "the four this screen knows" were corrected, and
the count is now computed from `CONNECTION_STATE` so it cannot go stale again.

**What is owed, and it is the most sellable unbuilt thing in this repo:** a
walk-in / phone-call entry screen. It needs no Meta secret, no Google asset and
no VM change — the endpoints, the provenance ladder, the promoter and the origin
column all already exist and are proven. It does need a decision that should be
made with someone watching: door three is `service_role`-only today, and giving
a salesperson a form means either a new `SECURITY DEFINER` RPC granted to
`authenticated` (a new write surface on the dealer plane) or routing the form
through n8n. That is an authority question, not a UI question.

### A real WhatsApp lead arrived on production while this was running

Lead **122**, `Hussain`, `+971556382721`, `source = nexus-master-router`,
`status = COLD`, created 7 Sep 2026 14:05 UTC. Production `leads` is therefore
**5**, not the 4 this file said. It came through the old writer, which means it
came through `/webhook/whatsapp-inbound` — the door recorded above as accepting
unauthenticated calls with `WAHA_WEBHOOK_SECRET` unset. Nothing about it is
wrong; it is a reminder that the open webhook is not theoretical and is carrying
real people's phone numbers today.

### Cross-tenant, on production, is still NOT PROVEN and should stay that way

Production holds one dealership and a quarantine tenant. Proving a cross-tenant
refusal needs a second **active** tenant, and activating one silences the five
consumers of `nexus_scoped_tenant_id()` listed at the top of this file. The
staging pass proved it (a Bravo event citing Alpha's endpoint, `23503`); do not
re-run it here to feel thorough.

## What is actually proven

Proven live on 2 Sep 2026, with a real inbound WhatsApp message:
identity resolved to an existing lead without creating a duplicate; an
inventory-grounded reply in 17.8 seconds quoting a real price with the vehicle's
cost withheld; a SUCCESS audit row. That path is demoable and honest.

Deals now works end to end. On 2 September a real closed-won deal was recorded
through the live dashboard UI: `purchase_history` row with the correct
`amount_aed`, `purchase_date`, `lead_id` and `tenant_id`, a `deals_embeddings`
row, an audit row, and the Deals screen showing it. Submitted four times, one
row — idempotency is proven, not assumed.

Finance is subtler than "never exercised", and the earlier claim in this file
was wrong. `finance_quotes` shows **25 inserts and 15 deletes** in
`pg_stat_all_tables` (re-measured 5 Sep 2026; this file said 16 and 13) — the insert path has worked repeatedly and a journey
teardown script deletes the rows after every test. "Empty" means cleared, not
never. What is genuinely unproven is whether it works *today*: the fix to the
constraint that broke it is nine minutes younger than the last failure and has
not been exercised since.

KYC has 3 rows and 0 verified. A row appearing is not the capability working —
check the outcome, not the count. `Customer 360` is a once-daily batch, not live.

On 31 Aug the WhatsApp agent invented an EMI of AED 11,200 (the true figure was
nearer 7,800) and sent it to a real person, and a separate reply leaked the
dealership's internal vehicle cost. Both are now gated. The WhatsApp finance
path should not go live.

## The open webhook — read before touching anything WhatsApp

Tested live 3 Sep. There are **11 business POST webhooks**, and **not one uses
n8n's own `authentication` parameter** — every guard is downstream application
logic, so every endpoint accepts the request and starts an execution before
refusing. Ten refuse correctly. One does not:

**`POST /webhook/whatsapp-inbound` accepts unauthenticated calls.** Its
`WAHA Auth Gate` is env-driven and **dormant on this box** — `WAHA_WEBHOOK_SECRET`
is unset, so the gate's early `return items;` passes everything through. Proven
by running the published workflow with a payload that dies before any write: the
gate emitted the item with no `_gate` key, which only the dormant branch does.

What an unauthenticated caller gets: keyword-matched AI replies **sent to a
number they choose** (`Guard Reply` filters content, never the recipient), rows
in `processed_messages`, `whatsapp_contacts`, `communication_logs`, `audit_log`,
and — via `Score New Lead`, which enters the Master Router through
`Called Internally` and **bypasses that router's own Auth Gate** — rows in
`leads`. A guarded front door with an unguarded side door behind it.

**And the caller picks the dealership.** `Resolve Tenant` keys off `body.session`,
which is caller-supplied; a bogus session resolves to the sole configured tenant
today. The moment `NEXUS_TENANT_MAP` holds two dealerships, one JSON field
chooses whose data is written — and n8n writes as `service_role`, `BYPASSRLS`,
so nothing in the database filters it. **Every tenant control proven this week
has this in front of it.**

The workflow code is already correct; the hole is configuration, and the fix is
on the VM, not in n8n: set `WAHA_WEBHOOK_SECRET`, make WAHA send
`x-nexus-webhook-secret`, confirm in MONITOR mode, then set
`WAHA_WEBHOOK_ENFORCE=true`. Hardcoding a secret in n8n first would silently
drop every real customer message, because WAHA is not sending the header yet.
One trap: that workflow has `saveDataSuccessExecution:"none"`, so MONITOR-mode
executions are never saved and the monitoring window is unobservable — flip it
to `"all"` for the rollout or you will enforce blind.

~~Also: `slack-command` is closed by accident, not by design.~~ **Retracted
6 Sep 2026, measured against the live published definition.**
`Tenant For JWT User` **has** `alwaysOutputData: true`. Execution `9325` shows it
emitting one empty item, `Auth Gate` running, and throwing — status `error`, not
`success`. `slack-command` is closed **by design**. The claim above was read from
the 30 August repo export, which is stale; the box is the witness.

## House rules that exist because something broke

- **Many agents inspect; one agent publishes.** Restated by the owner on
  8 September 2026 as the working pattern rather than as a caution: parallel
  agents are fine, and wanted, for docs, SQL analysis, tests, frontend and
  research. The **live n8n box has exactly one writer at a time.** Parallel
  writes have taken the production VM down twice — and short of an outage, this
  file already records what the same shape costs: a secret verified in the `n8n`
  container while the comparison ran in `n8n-worker`, a repository that did not
  know which compose file was on the box, a second n8n and WAHA running on a
  machine nobody had accounted for. Queue, worker and environment drift is what
  a second writer produces before it produces an outage. Repo and database work
  parallelises fine. So: design, inspect, test, review and draft in parallel;
  publish through one agent.
- **n8n edits stay in draft until published.** Verify against the *published*
  version by fetching it back, not against your draft.
- **No frontend may compute a finance figure.** APR, EMI, monthly payment, LTV
  come from the calculator with `calculation_id` and `execution_id` behind them,
  or they do not appear. Without evidence: no number, not even "indicative".
- **A missing row is not proof the event did not happen.** Unknown ≠ none. This
  codebase has rendered that lie in six separate places.
- **One figure, one derivation.** See `NEXUS_INVARIANTS.md`.
- **Check captions against the branch they sit in.** Sentences asserting the
  opposite of their own code have been found seven times here.
- **After creating ANY function, table, view or sequence, read its ACL.**
  Supabase's default privileges grant EXECUTE **directly to those roles**, and
  `REVOKE ... FROM PUBLIC` does not touch a direct grant. This exact shape has
  opened a hole three times: the RAG search functions, the tenancy helpers, and
  `action_write_audit` — which takes a tenant as an argument and runs as
  definer, so any signed-in user could have forged audit rows against another
  dealership. Revoke explicitly from `anon` and `authenticated`, then re-check
  with `get_advisors`.
- **Every public view needs `security_invoker`.** A database event trigger now
  fails the deploy without it; `CREATE OR REPLACE VIEW` silently drops the
  option and did so three times.
- **One boolean answering two questions will eventually make a legitimate row
  impossible to write.** `operator_recorded` carried `counts_as_real = false`,
  and a production endpoint CHECK read that one flag as if it answered both
  "is this real business?" and "did an external system attest this?" — so a
  `walk_in` endpoint, the largest lead source in a UAE showroom, was a row that
  could not exist. Split the commercial question from the attestation question
  *before* a constraint starts reading either.

## The default-grant check: `anon` **and** `authenticated`, at TABLE **and** COLUMN level

> Read the heading, and read both halves of it. The title has now been the direct
> cause of a failure **twice**.
>
> It used to say "the `anon` grant check". `anon` was closed on 2 Sep 2026 and
> everyone who opened this file afterwards read the section as *done* — while
> **32 objects sat wide open to `authenticated`**, including `leads`, `inventory`,
> `users`, `audit_log`, `finance_quotes` and `purchase_history`. The default grant
> lands on **both roles**. Closing one says nothing about the other.
>
> Then it said "`anon` **and** `authenticated`" — naming the roles and saying
> nothing about the *level* — and the query underneath it read `pg_class.relacl`
> and `has_table_privilege` only. **That is the third time a column-level grant
> has hidden from this file's own check**, and the third is the one that proves
> the pattern rather than the accident:
>
> 1. **`channel_registry`** (4 Sep) — `authenticated=r` on seven of eight columns,
>    `credential_ref` deliberately withheld. Correct design; the check reported
>    the table as `service_role`-only.
> 2. **`policy_platform_attestation`** (4 Sep) — ten column-level `authenticated=r`
>    grants and **no `authenticated` entry in `relacl` at all**. The check, and
>    `QUALITY_GATE`'s `l2AuthenticatedAclLetters` with it, called it closed.
>    Every signed-in dealership user could read who attested a global rule.
> 3. **`inventory` and `leads`** (6 Sep) — this time the check hid *live write
>    paths*, not reads. Measured on **both** projects: the query below returned
>    **zero rows**, while in the same pass a signed-in dealership owner
>    **successfully INSERTed a row into `inventory`**. The grants are on
>    `pg_attribute.attacl`, nine columns for `inventory` INSERT/UPDATE and eight
>    for `leads` UPDATE, plus a table-level `authenticated=rd` on `inventory` —
>    and `d` is DELETE, which the old query also missed because it tested
>    `UPDATE` and nothing else.
>
> Three incidents, one shape: **`relacl` is not the ACL. It is one of two ACLs**,
> and the one a careful person is *more* likely to have used, because a
> column-level grant is what you write when you are being precise. So the check
> was blindest exactly where somebody had taken the most care.
>
> ### And for FUNCTIONS the same title has a fourth trap — 7 Sep 2026
>
> `proacl` is not two ACLs; it is one, with an entry that has no name. A
> function is born with `EXECUTE` granted to `PUBLIC`, and that entry renders as
> a bare `=X/postgres`. There are now **three distinct ways** to get this wrong,
> and none of them catches the other two:
>
> 1. `revoke ... from public` does **not** remove a direct grant to `anon`.
>    Supabase's default privileges hand `anon` an entry of its own.
> 2. `revoke ... from anon, authenticated` does **not** remove the `PUBLIC`
>    entry. Both roles keep reaching the function *through* `PUBLIC`, and
>    neither name appears in `proacl` afterwards — so the ACL reads **clean**.
> 3. `proacl like '%anon=%'` is therefore blind in both directions.
>
> Number 2 was live for three days on `nexus_public_exposure_report` — the
> function that prints this database's own over-grants. Measured on production:
> `proacl = {=X/postgres, postgres=X, service_role=X}`,
> `has_function_privilege('authenticated', …) = true`, and
> `set local role authenticated; select count(*) …` returned **149 rows** naming
> 149 objects, every one flagged as a broken rule. A dealership's own user could
> ask the database for the map of its own weaknesses.
>
> **The rule: `revoke ... from public, anon, authenticated` — name `public` AND
> the roles — then assert with `has_function_privilege()`.**
> `ops/ci/function-grants.mjs` now blocks a migration after
> `20260907140000` that does not.
>
> ### `has_function_privilege()` is necessary and still not sufficient
>
> It answers "is EXECUTE granted", not "can this role call it". **Schema `USAGE`
> is a second gate**, and on production the two disagree completely:
>
> | role | `USAGE` on `public` | functions it may EXECUTE | actually reachable |
> |---|---|---|---|
> | `anon` | **no** | 146 | **none** |
> | `authenticated` | yes | 209 | 209 |
>
> Measured: `set local role anon; select … from public.nexus_public_exposure_report()`
> fails **42501, permission denied for schema public**. So the alarming `anon`
> number is carried entirely by one missing schema grant — which is real
> protection, and is also a single `grant usage on schema public to anon` away
> from opening 146 functions at once. Judge reachability on **both** gates, and
> never report an `anon` function count as an exposure without saying which gate
> is holding.
>
> Of the 64 of our own functions `authenticated` can genuinely reach, **42 are
> `SECURITY DEFINER`** — they run as the owner and bypass RLS. That is the
> dashboard's intended API and each one is responsible for its own tenant
> scoping; it is a designed surface, not a defect, and it is the surface worth
> auditing first.

Supabase ships default privileges that grant **directly to `anon` and
`authenticated`** on everything created in `public` — `EXECUTE` on every new
function, and *all* privileges (`arwdDxtm` — SELECT **and INSERT/UPDATE/DELETE**,
not just SELECT) on every new table and view. Nobody writes those grants; they
arrive on their own, so nothing in the migration diff shows them.

**Read the ACL, and know what the letters mean.** `authenticated=arwdDxtm` is
not "read access". It is:

| letter | verb | filtered by RLS? |
|---|---|---|
| `r` | SELECT | yes |
| `a` | INSERT | yes |
| `w` | UPDATE | yes |
| `d` | DELETE | yes |
| `D` | **TRUNCATE** | **NO** |
| `x` | REFERENCES | n/a |
| `t` | TRIGGER | n/a |
| `m` | MAINTAIN | n/a |

**`D` is the one that matters most, and this file missed it for four rounds.**
RLS does not apply to TRUNCATE. So on every object carrying `D`, the reassuring
sentence "RLS is the remaining lock" was simply **false — there was no lock at
all**. Measured 3 Sep 2026 in a rolled-back transaction: as `authenticated`,
`TRUNCATE public.competitors` took the table from 13 rows to 0. The same grant
sat on `audit_log`, `purchase_history` and `finance_quotes` — a signed-in user
could have erased the audit trail and the sales record across **every** tenant,
and no policy in this database would have filtered a single row of it.

**`get_advisors` does not catch this.** It returned zero grant-related lints on
the same day all 32 objects were open. It flags missing RLS and definer
functions, not over-wide table privileges. Treat a clean advisors run as
evidence about RLS and nothing else; the ACL query below is the only check that
answers this question.

**The one query. Run it; do not reason about it.** Corrected 6 Sep 2026 — the
version this file carried until then returned **zero rows on both projects**
while four live write paths were open.

```sql
-- Every write privilege reachable by anon or authenticated in `public`,
-- at TABLE level or at COLUMN level, for every verb -- not just UPDATE.
select c.relkind, c.relname, g.grantee, p.priv,
       has_table_privilege(g.grantee, c.oid, p.priv)                      as at_table_level,
       case when p.priv in ('INSERT','UPDATE')
            then has_any_column_privilege(g.grantee, c.oid, p.priv) end   as at_column_level,
       coalesce(array_to_string(c.relacl, ' | '), '(no table-level ACL)') as relacl,
       coalesce((select string_agg(a.attname || '=' || array_to_string(a.attacl, ','),
                                   ' | ' order by a.attnum)
                   from pg_attribute a
                  where a.attrelid = c.oid and a.attnum > 0
                    and not a.attisdropped and a.attacl is not null),
                '(no column-level ACL)')                                  as attacl
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 cross join (values ('anon'),('authenticated')) g(grantee)
 cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) p(priv)
 where n.nspname = 'public' and c.relkind in ('r','v','m','p')
   and (has_table_privilege(g.grantee, c.oid, p.priv)
     or (p.priv in ('INSERT','UPDATE')
         and has_any_column_privilege(g.grantee, c.oid, p.priv)))
union all
-- Sequences take has_sequence_privilege, not has_table_privilege, and USAGE is
-- a write on one: nextval(). UPDATE is setval().
select c.relkind, c.relname, g.grantee, p.priv,
       has_sequence_privilege(g.grantee, c.oid, p.priv), null,
       coalesce(array_to_string(c.relacl, ' | '), '(no table-level ACL)'),
       '(sequences have no column ACL)'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 cross join (values ('anon'),('authenticated')) g(grantee)
 cross join (values ('USAGE'),('UPDATE')) p(priv)
 where n.nspname = 'public' and c.relkind = 'S'
   and has_sequence_privilege(g.grantee, c.oid, p.priv)
 order by 2, 3, 4;
```

Anything it returns that is not a deliberate, named write path is a hole.

**Why every clause is there — each replaces a specific blindness measured on
6 Sep 2026:**

- `has_any_column_privilege` — sees `pg_attribute.attacl`. Postgres allows
  column-level grants for `SELECT`, `INSERT`, `UPDATE` and `REFERENCES` **only**;
  `DELETE` and `TRUNCATE` are table-level by nature, which is why the `case`
  above returns NULL for them rather than pretending to have checked.
- **All four verbs, not just `UPDATE`.** The old query tested `UPDATE` alone, so
  a table granting only `DELETE` or only `TRUNCATE` was invisible — including
  **`D`, the letter this very section calls "the one that matters most"**.
  `inventory` carries a real table-level `authenticated=rd` on both projects and
  the old query did not return it.
- **`attacl` printed, not just tested.** `relacl` alone tells a reader "closed"
  about a table with nine column grants on it.
- **Sequences split out.** `has_table_privilege` has no `USAGE` privilege type;
  reaching a sequence through the table branch silently under-reports it.

**What the corrected query returns today**, identically on staging
(`wwspuxrbiyagnrnzgate`) and production (`dsvuoovivysszdoiorch`) — and all four
of these were reported as **closed** by the old one:

| object | grantee | verb | table level | column level |
|---|---|---|---|---|
| `inventory` | `authenticated` | DELETE | **true** | n/a |
| `inventory` | `authenticated` | INSERT | false | **true** (9 cols) |
| `inventory` | `authenticated` | UPDATE | false | **true** (8 cols) |
| `leads` | `authenticated` | UPDATE | false | **true** (8 cols) |

Those are the two deliberate dashboard write paths (`lib/unit-form.js`,
`lib/lead-drawer.js`), so the *grants* are right and narrow. The defect was the
check.

**Proved adversarially, 6 Sep 2026**, in a rolled-back transaction on staging:
four holes were planted — `grant update (amount_aed) on purchase_history to anon`,
`grant insert (doc_title) on rag_documents to authenticated`,
`grant truncate on competitors to authenticated`,
`grant delete on audit_log to authenticated`. The **old query still returned zero
rows**. The corrected query returned all eight rows (the four planted plus the
four real). A check that cannot go red over an `anon` UPDATE grant and a
`TRUNCATE` grant is not a check.

**And the read side is a separate query, because this one is write-only.** Both
of the earlier column-grant incidents were `SELECT` grants, and nothing above
would have found either. Run this too:

```sql
select c.relkind, c.relname, g.grantee,
       (select string_agg(a.attname, ', ' order by a.attnum) from pg_attribute a
         where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
           and has_column_privilege(g.grantee, c.oid, a.attnum, 'SELECT')) as readable_columns
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 cross join (values ('anon'),('authenticated')) g(grantee)
 where n.nspname = 'public' and c.relkind in ('r','v','m','p')
   and not has_table_privilege(g.grantee, c.oid, 'SELECT')
   and has_any_column_privilege(g.grantee, c.oid, 'SELECT')
 order by 2, 3;
```

It returns exactly one row on each project today: `channel_registry` /
`authenticated`, seven of eight columns, `credential_ref` withheld — the
deliberate design. `policy_platform_attestation` no longer appears, because it
was revoked on 4 Sep. **A correction while we are here:** this file says staging
"carries none" of `channel_registry`'s column grants. Re-measured 6 Sep 2026 —
**staging carries the same seven**, so that particular gap in the rehearsal is
closed.

Note the write query covers **sequences** too: `authenticated` held `rwU` on
`leads_id_seq`, and UPDATE on a sequence is `setval()` — rewinding the counter to
collide primary keys on the dealership's next real insert.

Three more things follow, and each has already cost this project:

- **`REVOKE ... FROM PUBLIC` does not remove a direct grant.** A direct
  `anon=X` entry and a PUBLIC `=X` entry are separate ACL rows. Revoke from
  **both** (`REVOKE ... FROM anon, public`), every time — revoking only PUBLIC
  is what left one of these open after it was believed closed.
- **The check belongs on every new function AND every new view**, not just the
  ones a linter flags. The linter only flags what reads a tenant-owned table, so
  a helper that merely *encodes a business rule* passes it while still carrying
  an anon grant. The danger is not the body today: a later
  `CREATE OR REPLACE FUNCTION` adding `SECURITY DEFINER`, or a view widened to
  read a new table, opens a live hole with **no grant-shaped diff to review**,
  because the grant was already sitting there.
- **RLS is one lock, not two.** A `<table>_deny_anon` RESTRICTIVE policy makes an
  anon read return 0 rows, which looks identical to having no privilege — so
  "returns 0 rows" is evidence about RLS, never evidence the grant is absent.
  Measured 2 Sep 2026 on the 10 views *and* on all 16 tenant-owned base tables:
  as `anon`, SELECT, UPDATE and DELETE all **parsed and executed** against every
  one of them, and were stopped only by the row filter. Check `relacl`/`proacl`,
  not row counts.
- **An incidental lock is not a designed lock, and it will not hold.** On the
  same measurement, anon INSERT was refused on all 16 tables — but not by RLS and
  not by any privilege. It failed on `permission denied for function
  nexus_default_tenant_id`, because the `tenant_id` column DEFAULT called a
  function anon could not execute. Supplying `tenant_id` explicitly skipped the
  default, and the INSERT then reached RLS. Had that column default ever changed,
  the only thing standing between an anonymous caller and a write would have
  disappeared with no grant-shaped and no policy-shaped diff to review. When you
  record *which* lock stopped a verb, name the real one — and if it is
  incidental, treat the object as open.

Default privileges for `anon` in `public` are now revoked on tables, functions
**and sequences** for objects created by `postgres` (`ALTER DEFAULT PRIVILEGES
FOR ROLE postgres IN SCHEMA public REVOKE ...`), which is the role migrations
run as. Sequences mattered: `anon` held `rwU`, and `UPDATE` on a sequence is
`setval()` — an anonymous caller could have rewound the id counter behind
`leads` and caused primary-key collisions on the dealership's next real insert.

That backstop is still partial, and the remaining hole **cannot be closed from
this project**. A separate `supabase_admin` default ACL on `public` still grants
`anon` on tables, functions and sequences, so anything created by that role — an
extension, a Supabase-managed object — is still born open. `ALTER DEFAULT
PRIVILEGES FOR ROLE supabase_admin` was attempted 2 Sep 2026 and returns
`42501 permission denied to change default privileges`: `postgres` is not a
member of `supabase_admin` and Supabase grants no route to it. Residual risk:
any object a future extension or Supabase platform upgrade creates in `public`
arrives with a full `anon` grant and nothing will revoke it automatically.
**So the per-object check below is load-bearing, not belt-and-braces — after
installing an extension or taking a platform upgrade, re-run it.** Check the
object you just made.

**Before revoking, establish the reader *and the writer* — do not revoke
reflexively, and do not trust what this file says the writers are.** The role per
request is in the edge logs at `request.sb.jwt.authorization.payload.role`; the
dashboard signs in and reads as `authenticated` (`app.js` `boot()` returns at the
login card before any screen fetches), and n8n reads and writes as `service_role`
(user agent `n8n`, `sb_secret_` key). Filter the logs to
`method in ('POST','PATCH','PUT','DELETE')` and look at who is actually writing.
If an object has no reader for a role, revoking costs nothing. If it has one, say
so and leave it.

**Establish the writers from the shipped bundle, not from belief.** Going into the
3 Sep pass the working assumption — written down and inherited — was that *every*
dashboard write goes through a `SECURITY DEFINER` function. That was **false**.
`grep -rn "dbWrite" apps/executive-dashboard/lib apps/executive-dashboard/screens`
finds two direct table writes, both live and both confirmed in
`dist/assets/main-*.js`, which is the deployed truth rather than the source:

- `lib/unit-form.js` → `inventory` POST / PATCH / DELETE (the unit form)
- `lib/lead-drawer.js` → `leads` PATCH (owner assignment)

Those two are why `inventory` keeps `arwd` and `leads` keeps `rw`. Revoking them
would have broken two working screens to close a lock nothing was exploiting —
a bad trade. Everything else routes through `rpc/*`, and because those functions
are `SECURITY DEFINER` **owned by `postgres`**, they touch their tables as
`postgres` and are completely unaffected by the caller's table grants. That is
what makes narrowing safe: check `prosecdef` and `proowner` before relying on it,
because `sentinel_inventory_actions` and `search_rag_documents` are
`SECURITY INVOKER` and *do* read as the caller.

Then prove it **per object, not once at the end**, in transactions you roll back
(a prior agent ran a live DELETE outside one and had to disclose it). A
`DO $$ ... $$` block that ends in `RAISE EXCEPTION` aborts unconditionally, so
nothing can persist even if a probe misbehaves. Prove three things each time: the
consumer still does what it needs, the verb you closed now fails with `42501`
(*blocked by GRANT* — not "0 rows", which only ever proves RLS filtered it), and
`service_role` is untouched. Re-check `get_advisors` at the end knowing it will
not see grants, and for a `security_invoker` view read it as `authenticated`
*and* as `service_role`, not just inspecting the ACL.

## Where the record lives

- `NEXUS_INVARIANTS.md` — INV-001..INV-008: the business rule, who owns it,
  how it is written and read, and the query that proves it. Open violations are
  recorded as open rather than described as passing. Keep it that way.
- `architecture/schema.sql` — regenerated from the live catalogue; a
  transcription, not a replay, and it goes stale within days.
- `DESIGN.md`, `README.md` — product and setup.

## Across a patch transfer, compare trees — not commit ids

3 Sep 2026. J1 reported that PR #5 and the container's branch "share no
commits" — it had run `git cat-file -t` on all thirteen of PR #5's commit ids
and found none locally. That reading nearly caused an unnecessary branch
surgery, and it was wrong.

`git am` writes new commit objects for identical content: new author date, new
parent, therefore a new SHA. Across a patch-transfer boundary a SHA comparison
can only ever report "no shared commits", whatever the contents are. It is
evidence of nothing.

The test that settles it is `git rev-parse <ref>^{tree}`. Container `0905195`
and Ali's `cef1bf0` both hashed to `91eb1463…` — the same work, transferred by
patch. After applying the five missing commits, container `cfa679a` and clone
`e907338` both hashed to `8519be3a…`.

So: **a SHA mismatch across a patch transfer is the expected outcome. Compare
`^{tree}` before concluding two chains diverged.**

## Ali's clone, and why the push cannot happen from here

The working copy is `C:\Users\user\Desktop\MY RESUMES\nexus-os`. It is inside a
connected folder, so `device_bash` can run git in it directly — no staging.

Two things block pushing from this session, and neither is fixable from here:

- The cloud container is not in the session's authorized repository set. The
  git proxy refuses to inject a credential (HTTP 403).
- The clone's `credential.helper` is `manager` — Windows Credential Manager,
  which does not exist in the Linux VM the device shell runs in.

So the pattern is: apply and verify in the clone via `device_bash`, then hand
Ali one `git push` to run in PowerShell. Give him the real path — a literal
`<your repo>` placeholder is a PowerShell parse error, and he has hit it.

**`git am` stalling in the device shell is a permissions symptom, not a
conflict.** git cannot unlink its own `.git/*.lock` files there, so the apply
dies halfway and leaves the repository mid-`am`. Call
`device_request_delete_permission` on the Desktop folder, `git am --abort`,
then re-run clean. Do not try to nurse a half-applied `am` forward with `mv`
tricks — the counter in `.git/rebase-apply` stops advancing and it re-applies
the same commit forever.

## Two WAHA instances are posting the same messages into production

3 Sep 2026, read from saved executions. Executions 9427 and 9428 carry the
**same `body.payload.id`** and different everything else:

| | 9427 | 9428 |
|---|---|---|
| `x-webhook-request-id` | `35bsz6mtlzeem9` | `1mt17mtlzf9bc` |
| `user-agent` | `WAHA/2026.7.2` | `WAHA/2026.7.1` |
| `x-forwarded-for` | `35.224.126.225` (the box) | `2.50.10.149` (external, UAE) |
| `me.jid` | `971526647253:12@…` | `971526647253:8@…` |

A second pair, 9420/9421, carries an identical `payload.id` and started **1 ms
apart** — far too close for a retry. Different build, different source address,
different device index on the same WhatsApp account. This is not one WAHA
retrying; it is **two senders**, and one of them is a host nobody has
accounted for.

So the execution list is pairs: 275 executions is roughly 137 messages. The
only thing absorbing the doubling is `Claim Message Id`. And the control that
would refuse an unknown sender — `WAHA Auth Gate` — is measured `DORMANT` on
that same traffic.

Two things follow. Any count of "messages" taken from the execution list is
roughly double the truth. And an external host is posting WhatsApp traffic into
production through an open door.

### `2.50.10.149` is identified — 6 September 2026

It is **not a stranger.** Executions 10322 and 10323 carry the same `payload.id`
and the same body, and differ like this:

| | 10322 | 10323 |
|---|---|---|
| `x-forwarded-for` | `35.224.126.225` (the box) | `2.50.10.149` |
| build | WAHA/2026.7.2 | WAHA/**2026.7.1** |
| `me.jid` | `971526647253:**12**@…` | `971526647253:**8**@…` |
| `me.id`, `me.lid`, `pushName` | identical | identical |
| `x-webhook-timestamp` | 1788664766034 | 1788664807464 — **41 s later** |

The same WhatsApp account, on a **different device index**, served by a
**second, older WAHA instance on a non-GCP (UAE) host**, running about forty
seconds behind. `reachoutTimelock` is present on one and absent on the other,
which is the build difference showing through the payload.

**And it is never the only sender.** 102 executions sampled over 8h56m
(5 Sep 18:23 → 6 Sep 03:19 UTC), grouped by `payload.id`: **51 distinct
messages, 51 arrived from both sources, 0 from the box only, 0 from `.149`
only.** Headers were read on both halves of 9 of the 51 pairs, spread across the
window; for the other 42 two deliveries were confirmed but not both headers.
Not extrapolated to the full 988.

So on this evidence **arming the gate without configuring `.149` would have
dropped nothing** — with three limits that belong in the runbook: the sample is
nine hours with both hosts up; it contains zero customer conversations; and the
box's WAHA is also the *send* path, so `.149` surviving a box outage would
produce an unanswerable inbound rather than a rescue.

### And it stopped posting — 6 September 2026, evening

Ali identified it: **it was his own local Docker WAHA**, run before the move to
GCP. He deleted it there and has now logged his WhatsApp account out of it.

**Corrected 8 September 2026:** the second half of that sentence did not hold.
On 8 Sep Ali asked for the old WAHA to be removed — which means it was still
there to remove. Treat "he deleted it there and logged the account out" as
*reported on 6 Sep and not verified*; what **was** verified that evening is the
measurement below — the doubling stopped and every sampled header was the box.
Those are different facts. See "The machine is named" below.

Verified from the box rather than taken on trust, because "logged out" and "no
longer posting" are different facts and the whole rollout depends on which is
true. Five executions spanning 15:58 -> 19:09 UTC:

| execution | interval | `payload.id` | source |
|---|---|---|---|
| 10555 / 10556 | 0.38 s apart | `A591527F…` / `A50C03B9…` — **different** | — |
| 10580 | — | `ACA18E5D…` | — |
| 10581 | 46 s later | `AC2A799E…` | — |
| 10582 | 39 s later | `AC4392C3…` | `35.224.126.225`, WAHA/2026.7.2, jid `:12` |

**Five consecutive executions, five distinct message ids, no pair.** Even the
0.38-second gap — the exact signature that used to mean a duplicate — is two
different messages from the same group. The doubling has stopped and every
sampled header is the GCP box.

**Two consequences, and the second is a new hazard rather than a relief:**

- **The "execution count is roughly double the truth" caveat no longer applies**
  to traffic after 6 September. It still applies to everything before, so any
  historical figure taken from the execution list keeps its factor of two.
- **Arming the gate is now more dangerous, not less.** With two senders, setting
  `WAHA_WEBHOOK_ENFORCE=true` before the header was configured would have cut
  off whichever sender lacked it and the other would have carried on — the
  damage was survivable and visible. With **one** sender, the same mistake drops
  **100% of inbound messages** and the channel goes silent. The order is
  therefore not advice: `WAHA_WEBHOOK_SECRET` on the VM, then make the GCP WAHA
  send `x-nexus-webhook-secret`, then confirm in MONITOR on a genuine 1:1
  message, and only then enforce.

### The machine is named — 8 September 2026, stated by Ali, not measured

The host behind `2.50.10.149` is **Ali's own Windows desktop `desktop-l3an0ma`**,
running WAHA in Docker Desktop. It is the same PC that used to host n8n, reached
over a Tailscale funnel at `https://desktop-l3an0ma.tail2141f7.ts.net`, from
before the move to GCP. In his words, on 8 September 2026: *"purana waha mene
desktop docker pe chalaya tha aur n8n bhi tailscale ke zariye use bhi local pc pe
download kiya tha but ab sab kuch gcp pe hai to use remove kar do purana wala."*

**Where the line between measured and stated falls, and it matters here:**

| fact | how it is known |
|---|---|
| two senders on 3–6 Sep, same account, device index `:8` vs `:12`, builds 2026.7.1 vs 2026.7.2, ~40 s apart | **measured**, from saved executions |
| 51 distinct messages over 8h56m, every one delivered by both, zero singletons | **measured** |
| one sender only on 7 Sep (29 executions, zero duplicate `payload.id`) | **measured** |
| the `.149` host is `desktop-l3an0ma`, WAHA in Docker Desktop on Ali's Windows PC, ex-n8n host behind Tailscale | **stated by the owner, 8 Sep 2026.** Nothing was read off that machine from here |
| the container is stopped | **not proven** |
| it will not come back | **not proven** — its compose declares `restart: always`, so a reboot or a Docker Desktop start restarts it |
| WhatsApp linked device **8** is unlinked | **not proven** |

So the correct status is **identified; decommissioning in progress, not yet
verified** — not "removed", and not "done". As of this writing the desktop
teardown is running in the same session that recorded this and has not been
confirmed from either end.

**A detail that is consistent with this, and is not proof of it.** On 8 September,
execution `11094` carried a `webhookUrl` of
`https://desktop-l3an0ma.tail2141f7.ts.net/...` inside a WAHA payload — the same
Tailscale hostname. That is consistent with the desktop having been the WAHA
webhook target while it was the n8n host. It is not confirmation: the live WAHA
session config has not been read back, so what that instance points at *today*
is unknown.

**What still has to happen before the perimeter question closes.** Either the
container is stopped and device 8 unlinked and that is verified from the box (no
`:8` deliveries over a window long enough to mean something), or `.149` is
configured with `x-nexus-webhook-secret` like any other kept sender. Naming the
machine removes the search; it does not remove the step.

### It had not stopped. It was stopped, by hand, at 06:08 UTC on 8 September 2026

The section above records the machine being *named*. This one records it being
*measured*, and it corrects two claims this file made with confidence.

**Claim one, wrong: "the second WAHA really is gone" (6 Sep) / "it stopped
posting".** Execution **11103**, production, **8 September 2026 at 06:07:40 UTC**:

```
x-forwarded-for            2.50.10.149
user-agent                 WAHA/2026.7.1
me.jid                     971526647253:8@s.whatsapp.net
body.environment.version   2026.7.1
body.event                 session.status
x-nexus-webhook-secret     absent   ->  _gate.header_present = false
```

That is the `.149` host, on the old build, at device index 8, posting into
`/webhook/whatsapp-inbound` on production **two days after this file said it was
gone** — and roughly half an hour before it was stopped.

**Why the 6–7 September samples missed it, and the lesson is the point.** Both
samples grouped by `payload.id` and looked for duplicate pairs. The desktop
WAHA's WhatsApp session is no longer authenticated, so it emits **`session.status`
events and no `message` events at all** — events that carry no `payload.id` and
therefore can never form a pair. A method that detects a second sender only by
the duplicates it creates goes blind the moment that sender stops duplicating.
**Absence of duplicates is not absence of the sender**, and "the doubling has
stopped" was the honest reading of a measurement that could not answer the
question it was being asked.

**Claim two, wrong: implied by the first — that nothing had to be switched off.**
Docker Desktop on `desktop-l3an0ma`, opened on 8 September, showed a compose
project **`nexus-os`** at `C:\Users\user\Desktop\MY RESUMES\nexus-os` with
**three containers running**: `n8n` (5678), `n8n-db` (postgres:16-alpine) and
`waha` (devlikeapro/waha, 3000). Its own WAHA log, minutes earlier:

```
[06:02:22.358] INFO (WebhookSender/7): session:default - POST request was sent
with status code: 200
{"session":"default","event":"session.status",
 "url":"https://35.224.126.225.nip.io/webhook/whatsapp-inbound"}
```

A second n8n was also live on that machine with its own Postgres — schedules,
credentials and all — which is a larger exposure than the WAHA half and had
never been costed anywhere in this repo.

**What was done, and what deliberately was not.** The compose project was
**stopped** through the Docker Desktop UI at 06:08:24 UTC (`Received SIGTERM
signal, shutting down`, `Deregistered all crons`, `database system is shut
down`). The GCP box was unaffected: `/healthz` `ok`, and executions 11104 and
11105 arrived from `35.224.126.225` in the same minute.

Deleting the project was **declined**. Docker Desktop's confirmation says only
*"The 'nexus-os' compose project is selected for deletion"* with a **Delete
forever** button and no statement about named volumes — and those volumes hold
that n8n's workflows and credentials and the WAHA linked-device session. An
ambiguous irreversible button is not worth pressing to save a reversible command.

**So the correct status is still not "removed".** `restart: always` is declared
on all three services, and Docker's own rule is that a manually stopped `always`
container **is restarted when the daemon next starts**. A Docker Desktop restart
or a Windows reboot brings the whole thing back. The permanent, non-destructive
close is one command on that PC:

```
docker update --restart=no n8n n8n-db waha
```

and then WhatsApp -> Linked Devices -> unlink device **8**, which is the only
step that stops the account being served by that machine at all. Neither has
been done as of this line.

### The worker is the process that reads `$env`, and the box is in queue mode

Same day, and it is the reason `WAHA_WEBHOOK_ENFORCE` still could not be armed.
After Ali corrected the header name and rotated the secret, the gate read:

```
_gate.mode  MONITOR     _gate.header_present  true     _gate.ok  false
```

The header half was genuinely fixed — measured on executions 11098/11099/11100:
name `x-nexus-webhook-secret`, value 32 characters, alphanumeric, no quoting and
no surrounding whitespace, and the SHA-256 fingerprint of what WAHA sends
**changes** between 11096 and 11098, so the rotation reached WAHA. `ok = false`
therefore means one thing only: the value n8n compares against is not that value.

`GET /rest/settings` on the live box returns **`executionMode: "queue"`**,
concurrency 2. In queue mode the **worker** executes workflows, so the Code node
that reads `$env.WAHA_WEBHOOK_SECRET` runs in `n8n-worker`, not in `n8n`.
`docker compose up -d n8n` recreates the container whose `printenv` you then
check, and leaves the one that does the comparing on the old value. **The
verification and the defect were in different containers.**

Two things follow that are worth more than this incident:

- **Verify a secret where it is consumed, not where it is convenient.** The
  non-disclosing check is
  `docker compose exec -T n8n-worker sh -c 'printf %s "$WAHA_WEBHOOK_SECRET" | sha256sum'`,
  compared against the fingerprint of what the sender actually sent. A hash
  prefix settles it without either value being printed, pasted or logged.
- **The repo does not know which compose file is on the box, and said it did.**
  `docs/J1-RUN-CHECKLIST.md` drives `-f docker-compose.single.yml`, and
  `docker-compose.single.yml` states in its own comments that it runs in the
  default `regular` mode with no worker and no redis. Queue mode can only come
  from `docker-compose.yml`. Both files' headers have been corrected to say what
  is measured and what is inferred; the question is settled by `docker compose ps`
  on the VM and by nothing in this repository.

**A defect this uncovered, unrelated to the secret.** `docker-compose.single.yml`
carried `extra_hosts: ["waha:100.76.236.42"]` on the n8n service, pinning the
hostname `waha` to the Tailscale IP of the desktop that has just been stopped —
while defining a `waha` service on the same bridge. Had that file been the
deployed one, every `http://waha:3000/api/sendText` would now be aimed at a
stopped machine and the outbound WhatsApp path would be dead with no error
anywhere in NEXUS. Removed. The measured evidence says it was not deployed; the
pin was a loaded gun regardless of whether this was the week it fired.

### And none of this traffic is a customer

Read from `Is Real Inbound?`'s own output rather than judged by eye: **0 of 102
executions — 0 of 51 messages — were genuine customer conversation.** All 51 were
`@g.us` groups, `status@broadcast` or `@newsletter` on Ali's personal handset.
The audit said most of the traffic is not customer conversation; in this window
**none** of it was.

## Resend was one call site pretending to be a dependency — 8 September 2026

Ali asked why the go-live list wanted a `RESEND_API_KEY` when the system already
sends everything through Gmail. He was right, and the measurement is stark:

| | |
|---|---|
| files calling Resend | **one** — `apps/marketing-site/api/lead.js`, a single `fetch` to `api.resend.com` |
| n8n workflows calling Resend | **zero** |
| n8n workflows with Gmail nodes | **five** — the 7-day drip (3), Customer 360 (1), Lead Escalation (1) |
| the decisive one | `Email: Escalation Alert (Gmail)` already emails `aliasgher892@gmail.com` on a `gmailOAuth2` credential — the *same shape* as the site's notification |

So a Resend account existed for one call in one file. `ARCHITECTURE.md`,
`CONTROL-PLANE.md` and the architecture diagram all listed it as a provider
NEXUS uses; none of them was true.

### What replaced it, and what it actually costs

The site now POSTs the enquiry to **`POST /webhook/site-enquiry`**
(`Oz2W6EWG6n6XW0HQ`, *NEXUS Site Enquiry to Gmail Notification*), which composes
the mail and sends it from that existing Gmail credential.

**Correcting something said out loud first: this is not "no secret on Vercel".**
That was claimed before the door was designed, and it was wrong. An unguarded
webhook that emails the owner is a spam cannon, and this file already carries
the story of what an open business webhook costs. The honest ledger:

| | before | after |
|---|---|---|
| Vercel env vars | `RESEND_API_KEY` + `NEXUS_NOTIFY_FROM` | `NEXUS_NOTIFY_WEBHOOK_SECRET` |
| third-party account | Resend, plus a verified sending domain | none |
| who sends | Resend | the `gmailOAuth2` credential already in production use |

Two variables and an external account become one variable we generate.

### Two design decisions worth keeping

**The door is guarded by n8n itself.** The webhook uses `authentication:
headerAuth`, so a request without the matching header is refused **before an
execution starts**. This file records that all eleven older business webhooks
do the opposite — every guard is downstream application logic, so every endpoint
accepts the request and begins work before refusing. This is the first one that
does not.

**The mail body is composed inside n8n, never passed through.** The site sends
seven allowlisted fields and *not* the `summary` string it used to build; the
workflow strips control characters, caps every length, and refuses an enquiry
with no name or no way to reply. A body built by the caller is a body the caller
chooses, and the whole point of the guard is that they do not.

**And nothing is written to any dealership record, deliberately.** A person
filling in the NEXUS site is a prospect for the *vendor*. Filing them into
`leads` or `audit_log` would put the vendor's own pipeline inside a customer's
data — the boundary `CONTROL-PLANE.md` exists to hold.

### The one step that is Ali's, and one trap inside it

Creating the Header Auth credential is typing a secret, so it is his. **And n8n
auto-assigned the wrong credential on creation:** it bound the webhook to
`Resend API (Header)`, the only Header Auth credential that existed — so until
that is changed the door key is the Resend API key, which is both wrong and the
exact opposite of the point. **The workflow is therefore left UNPUBLISHED.**

Publishing it before the credential is right would arm a door with the key we
are trying to throw away.

**The check to run first needs no secret at all**: POST to the endpoint with no
header and expect **403** from n8n, with no execution created. That proves the
route exists *and* that the guard bites. Only then send a real form.

### And the marketing site is not connected to git

`nexus-for-autodealers` on Vercel reads *"Connect Git Repository"*. Measured on
the live page the same day: it still mints `submission_id` per attempt, so
**both of the 7 September fixes are on `main` and not live.** A redeploy of that
project ships whatever was last uploaded by hand, not what the repository says.
That is the more important finding of the two.

## The evidence lived in a container that gets deleted — 8 September 2026

This file, `CONTROL-PLANE.md`, `README.md`, `OWNER-ACTIONS.md`,
`V1-RELEASE-CLOSURE.md`, `ops/DEMO.md` and both `STATUS-*.md` cited **ten**
evidence files by absolute path under `/home/claude/out/` — an ephemeral cloud
container that is reclaimed after a period of inactivity. **None of the ten was
tracked.** Sentences like *"proved adversarially, evidence in
`/home/claude/out/unattributed-default-evidence.md`"* would have gone on
asserting a measurement while the named file existed nowhere.

Nothing had been lost yet. The whole record — 33 documents, 676 KB — is now in
`ops/evidence/`, and every citation points there. Nothing was rewritten except
the paths; the CI secret scan passes over the lot (no JWT, no key, no token).

**The rule: evidence for a claim in a tracked file must itself be tracked.** If
a measurement is worth citing, it is worth committing. A path under
`/home/claude`, `/tmp` or any other session-local directory is not a citation —
it is a promise that expires when the container does.

Three things were deliberately **not** committed, and `ops/evidence/README.md`
says why in full: the catalogue dumps (regenerable in one statement, and a stale
committed catalogue is worse than none, because the gate's entire staleness
discipline exists to stop exactly that being trusted); the gate reports (CI
uploads its own); and the transfer patches. Two sentences still name
`/home/claude/out/nexus-M0-M1-2026-09-06.patch` — that is a historical
measurement of a moment on 6 September, not an instruction, and rewriting it
into a repository path it never had would have been the fabrication rather than
the fix.

## The dashboard was already deployed, and the flip is done — 7 September 2026

`nexus_lead_source_readiness()` read **0 CONNECTED** on production this morning
because `20260907230000` was deliberately held back until the bundle shipped. It
had already shipped. Measured against the live production bundle
(`nexus-os-dashboard-six.vercel.app`, `/assets/main-BFmkO_-a.js`, 1,499,871 bytes):

| probed for | occurrences |
|---|---|
| `rpc/nexus_lead_record_manual` | 2 |
| `rpc/nexus_lead_assign_owner` | 1 |
| `rpc/nexus_lead_attribution` | 2 |
| `rpc/nexus_lead_source_readiness` | 1 |
| `REGISTERED_NO_ENTRY_PATH` | 1 |
| `Add a lead` | 2 |
| **`leads?id=eq`** | **0** |

The last row is the one that changes a decision. **The `authenticated`
column-level UPDATE grant on `leads` no longer has a screen behind it on the
DEPLOYED bundle**, not just in the repository — so
`20260908090000_the_grant_that_no_longer_has_a_screen_behind_it.sql`, written and
held, is now genuinely applicable. Its preflight still refuses while
`nexus_lead_assign_owner` is `SECURITY INVOKER` (the RPC needs the grant to do
its UPDATE as the caller), so that refusal is correct and the migration stays
unapplied until someone decides which of the two shapes to keep. **Check n8n
before revoking**: `service_role` does not need the grant, but nothing has
established that no other writer does.

So `20260907230000` was applied to production. Two manual sources now carry
`manual_entry_surface`, zero provider-delivered sources do, and as a real ALBA
session the readiness reads **CONNECTED 2 (`phone_call`, `walk_in`) ·
NOT_CONNECTABLE 1 · NOT_CONNECTED 6**.

**Read as `service_role` it still says NOT_CONNECTED for all nine**, and that is
not a bug: readiness is tenant-scoped and `nexus_current_tenant_ids()` is empty
for `service_role`, so `active_endpoints` comes back 0. Any future reading of
this function taken through the MCP without impersonating a member is a reading
of nobody's dealership.

### And the RPC was proved on production, in a transaction that rolled back

As a real `authenticated` ALBA member, sequenced through a temp table because
**UNION ALL branches are not evaluated in the order they are written** — a first
attempt read `before = 5` after the insert and looked like a silent failure:

| control | result |
|---|---|
| A — walk-in, **phone only, no email** | lead **125**, `was_duplicate = false`, `source_key = walk_in` |
| B — same `client_request_id` again | lead **125**, `was_duplicate = true` |
| C — after | `leads` 5 → 6, `leads.source = walk_in`, phone `+971500000001` |
| D — the event points at the lead | exactly **1** `lead_event`, no orphan |

Rolled back. Production is unchanged at **5 leads, 1 `lead_event`, 0 rows named
`Rolled Back Control`**. That is the browser-reachable path — grant, contract,
idempotency and origin — exercised on production without inventing a customer.

## The marketing site would have duplicated a prospect, and its 503 lied ahead of time

Same day, reading `apps/marketing-site/`:

- **`submission_id` was minted inside the submit handler**, so every retry was a
  new id — and this form actively invites retries: the 503 branch re-enables the
  button and the error text asks the visitor to try again. `submission_id` is
  sent as `p_external_event_id`, the idempotency key of
  `nexus_record_lead_event`. It is the `nokey:` + clock shape this file already
  records, wearing a `web-` prefix so the database CHECK let it through. Now
  minted **once per page load** and re-sent; a reload is deliberately a new id,
  because that is a person deciding to enquire again rather than a retry. The
  server's own `'web-' + Date.now() + Math.random()` fallback is **deleted**
  rather than replaced: an absent id recorded as absent beats one that looks
  idempotent and is not.
- **The 503 branch's comment said "Nothing durable happened" and the branch did
  not check.** `recorded` can be `'recorded'` — the enquiry IS in `lead_event` —
  and the comment asserted the opposite. **Eighth instance** of the house rule
  about captions contradicting their own branch. It is latent rather than live:
  production carries **4 lead endpoints, all `production`, zero `simulation`**
  (measured), so the optional write cannot succeed today and `recorded` is null.
  The status code is deliberately unchanged — a stored enquiry nobody is
  notified about still means nobody will call the person back, so the browser
  must still show the WhatsApp fallback — but the response now carries
  `stored_for_replay` and the log says which of the two happened.

**The 503 itself is a Vercel environment variable, not a missing account.**
~~n8n holds a working `Resend API (Header)` credential; `RESEND_API_KEY` and
`NEXUS_NOTIFY_FROM` are simply unset on the site's Vercel project.~~
**Superseded 8 September 2026 — Resend is gone entirely. See below.**

## Bitrix24 has really worked. Slack has not been shown to.

Asked whether the CRM and Slack legs are real, measured rather than inspected —
node existence is not evidence, and `audit_log` is.

**Bitrix24: proven, in August, and not since.** `wf_108 ERP Sync - Bitrix24`
wrote SUCCESS rows naming a returned CRM id — *"Bitrix24 lead created (ID 25)"*,
*"(ID 27)"*, *"lead updated (ID 25)"* — across 16, 17 and 19 August. A returned
Bitrix id is evidence a real Bitrix24 instance answered, so
`$env.BITRIX24_WEBHOOK_URL` was set and reachable then. **Nothing has succeeded
since 19 August.** All six retained executions of that workflow are refusals of
my own `curl` probes at its `Auth Gate` (`401 no_authorization` from
`/auth/v1/user`, then `[NEXUS-UNATTRIBUTED] ERP sync rejected`) — the guard
working, on a path nothing real has entered. There is **no Bitrix24 credential in
n8n**, by design: every Bitrix call is an `httpRequest` to
`{{ $env.BITRIX24_WEBHOOK_URL }}`, so whether it is still set cannot be read
through the n8n API.

**Slack: five SUCCESS rows, all with summary `"Completed"`.** That is the
workflow finishing, not a message arriving in a channel. A Slack credential
exists. **Do not quote those five as proof a Slack alert was delivered** — the
Bitrix rows name an id and these name nothing, and the difference is the whole
point.

**And the ERP link-back is keyed on an email string.** `Link Back to Supabase`
PATCHes `leads?email=eq.<email>&tenant_id=eq.<tenant>`, falling back to the
literal `__nexus_noop__` when `_lead_email` is falsy. So for a **phone-only**
lead — the walk-in, the phone call, the WhatsApp enquiry, 25% of production
leads — the Bitrix id is never written back into NEXUS. It fails safe (it
matches no row rather than the wrong one) and it fails **silently**. Same defect
this file already records for `communication_logs` and `audit_log`, now found a
third time in the ERP sync.

## The template literal is not the SQL — 7 September 2026

R2 and R3 had been red on every CI run since 6 September. The cause was the one
this file predicts: `QUALITY_GATE.mjs` carries an embedded schema snapshot, it
was anchored to migration `20260906071310`, and the twenty-odd functions added
since — `nexus_lead_record_manual`, `nexus_lead_assign_owner`,
`nexus_lead_attribution`, `nexus_lead_trace` among them — were absent from it,
so the offline PostgREST stub answered `404 PGRST202` to screens that are
correct. Refreshed against production: **156 functions, 110 relations, anchor
`20260907154626` at count 310**, and the offline lanes now exit 0 with R0..R7 all
PASS. Migration hygiene, function grants and the secret scan are clean too.

**The correction matters more than the refresh.** `CATALOGUE_SQL` contains a call
to an aggregate that exists in no Postgres. That was read, correctly identified
as impossible, and written up as *"the gate's own SQL is broken, so
`--refresh-schema` cannot work as shipped"*. **It is not broken.** A `.replace()`
at the end of that template strips the whole `'sentinel'` key before the SQL
leaves the file, and the count it reaches for is selected as
`meta.sentinel_units` instead. Proved the only way that counts: `--print-sql`
was run, piped verbatim into production, and returned **482,833 characters with
no error**.

So: **read what `--print-sql` emits, never the template literal.** This is the
fifth entry in the same family — a boolean spelled `on` and not `true`, a policy
predicate written `1=1` and not `true`, `relacl` that was not the ACL, a
`proacl` clean because the grant was held through PUBLIC, and now a SQL string
that is not the SQL. The dead fragment is deliberately left in place with a
comment explaining it, and that comment deliberately does **not** name the
aggregate: a name written into a comment is carried into the emitted SQL and
would make the grep the comment exists to recommend find it.

Same day, same shape, caught before it was written down: a check for the T12
owner-audit trigger on production reported **false** and looked like a missing
migration. The trigger is called `nexus_leads_owner_change_audit_trg`; the query
had asked for `nexus_leads_owner_change_audit`, which is the **function**. All
twelve migrations were then verified live object by object. **The wrong witness
answers confidently.**

### The migration history does NOT stop twelve short — the VERSIONS diverge

**This section said something wrong on 7 September and the correction is worth
more than the original claim.** It read: *"twelve repository migrations are live
on production but were applied through `execute_sql` rather than
`apply_migration`, so nothing recorded them."* **They were recorded.**
`apply_migration` stamps its own wall-clock version rather than the filename's,
so the history and the repository hold the same migrations under **different
version numbers**. Reading `max(version)` and comparing it with the newest
filename measured the wrong thing.

Measured properly on 8 September — by NAME, which is the field that survives the
stamping:

| repository file | recorded on production as |
|---|---|
| `20260907124500_leadingest_10_…` | `20260907121650` |
| `20260907140000_exposure_report_…` | `20260907123723` |
| `20260907150000_the_kyc_helper_…` | `20260907124533` |
| `20260907160000_the_rls_bypassing_surface_…` | `20260907130806` |
| `20260907160500_the_exemption_was_borrowable` | `20260907131039` |
| `20260907170000_attribution_is_additive_…` | `20260907132018` |
| `20260907180000_a_lead_trace_…` | `20260907132716` |
| `20260907190000_the_promoter_read_a_phase_…` | `20260907141933` |
| `20260907200000_connected_meant_a_row_exists_…` | `20260907143510` |
| `20260907210000_who_reassigned_this_lead_…` | `20260907150958` |
| `20260907211000_assigning_an_owner_can_now_say_why` | `20260907151246` |
| `20260907220000_a_salesperson_can_finally_…` | `20260907152407` |
| `20260907240000_a_lead_arrived_and_nothing_wrote_it_down` | `20260907154626` |

Thirteen exact name matches. `20260907230000` (the readiness flip) is genuinely
unrecorded — it was applied by hand on 7 September. `20260908090000` is
deliberately unapplied and now lives in `ops/migrations-held/`.

**And do not now stamp the thirteen, which is what the old text recommended.**
`schema_migrations.statements` holds the SQL that actually ran, and it was
compared against the repository files:

| | |
|---|---|
| byte-exact (modulo a trailing newline) | **6** of 13 |
| **content differs** | **7** of 13 |

`20260907124500`, `190000`, `200000`, `210000`, `211000`, `220000` and `240000`
all differ — mostly because a defect was found *after* the migration was applied
and the file was corrected while the fix went to production as a separate
statement. Their objects are live and were verified one by one, so the file and
the database agree **semantically**; they do not agree **textually**, and
renaming a version to make a parity rollup look clean over seven files whose
text does not match what ran is precisely the lie this file keeps warning about.
So: **semantic parity, stated as semantic parity.** The same distinction this
file already draws for `md5(prosrc)`.

### The Supabase GitHub integration was pointed at the production database

Found on 8 September while chasing a red X on the merge commit. **The X was
never CI** — all four CI jobs were green (Dashboard builds 14s, Quality gate 1m
11s, Migration hygiene 6s, Secret scan 5s). The failing check was
**`Supabase Preview`**, and `list_branches` on the production project answers:

```
name: main   git_branch: main   project_ref: dsvuoovivysszdoiorch
parent_project_ref: dsvuoovivysszdoiorch   status: MIGRATIONS_FAILED
```

`project_ref` **is production**. So on every push to `main`, Supabase was
attempting to apply `supabase/migrations/` **directly to the database holding a
real dealership's customers**, and the only reason nothing happened is that it
has been failing — since the branch row was created on 3 August 2026.

That is a worse fact than the red X it produced. A red X is information; an
automated push at a production database that happens to be broken is a loaded
gun that has been jamming.

**Ali's decision, 8 September: disconnect the integration.** Migrations here are
applied deliberately, verified object by object, and proved with positive
controls before anyone believes them — an automatic push on merge is the
opposite of that discipline, and it cannot be made safe by tidying the history.

**Moving `20260908090000` out of `supabase/migrations/` does not by itself turn
the check green,** and nobody should read it that way: the version divergence
above remains, so `db push` would still find thirteen files it has no record of.
The check goes away when the integration does. What the move fixes is different
and permanent — a deliberately-held migration sitting in the deploy path fails
every automated push for ever, and the failure is indistinguishable from a
broken migration. `ops/migrations-held/README.md` states what would have to be
true before it comes back.

## Corrections to what this file used to say

- **`saveDataSuccessExecution` on the WhatsApp workflow is `"all"`, not
  `"none"`.** The published settings say `all` for both success and error, with
  a 300 s timeout. The MONITOR window is observable today; earlier text here
  said it was not.
- **`Resolve Tenant` runs BEFORE `Claim Message Id`** — fourth node against
  sixth — and `Claim Message Id` **does** send `tenant_id`, taken from
  `Resolve Tenant`'s output. The `nexus_default_tenant_id()` fallback on
  `processed_messages` fires only if `Resolve Tenant` is disabled, which is the
  documented ten-second rollback. Claims file under the right dealership.
- **The claim gate's "side door" is not a live re-entry path.** `Called by
  Master Router` does connect straight to `Extract Message & Sender`, past the
  claim — but `HOT/WARM: Already In A Live Chat?` gate both callbacks on
  `lead.origin === 'whatsapp-bdc'`, and `Shape Lead For Router` always sets it.
  The internal branch also rewrites the item to `direction:'outbound'`, and
  `New Lead Worth Scoring?` requires `inbound`, so the loop is bounded at one
  pass. Zero of 275 retained executions are `mode:"integrated"`; zero
  `'[system] Initial outreach…'` rows exist in `communication_logs` ever.
- **`x-webhook-request-id` is a delivery id, not a message id.** Proven by the
  pair above. So is `body.id` (`evt_…`). The only identifier stable across
  deliveries of one WhatsApp message is `body.payload.id` — which is what
  `Prefilter` and `Claim Message Id` already key on. That design is correct.
- **`body.session` IS present on real inbound traffic**, value `"default"`,
  with `Resolve Tenant` emitting `tenant_source:"waha_session"` on live
  messages. The rollback contingency "WAHA sends no session" is dead; retire
  it. The `channel_registry` cutover has its input field.

## The duplicate inbound rows are a retry, not a second pass

Ten of 83 inbound `communication_logs` rows are near-duplicates — about 12%.
The `W.slam` case is one claim at 06:48:01 and two identical **inbound** rows
at 06:48:23 and 06:48:29. The re-entry path cannot produce that: it would have
written `direction:'outbound'` with the outreach marker.

Inferred cause: `Log Incoming Message` is published with `retryOnFail: true`
and `Prefer: return=minimal`, and it never populates `external_message_id`, so
a POST that commits server-side but whose response is lost gets retried and
inserts a second row with nothing to dedupe it. A unique index on
`(tenant_id, direction, external_message_id)` now exists and is inert until a
writer sends the column — that node is the writer to fix.

## The WhatsApp messaging layer — wired, never fired

4 Sep 2026. Four agents built a provider-agnostic messaging layer in the
database. **None of it has carried a real customer message.** Everything below
is applied to production and to staging at byte parity, and every part of it is
`service_role`-only with `anon` and `authenticated` refused by grant.

WAHA is temporary. The production transport is meant to be the official
WhatsApp Business Cloud API, and each dealership chooses. So nothing in NEXUS
core may know which provider carried a message.

**`channel_registry`** — tenant from a trusted integration identity, not from
an env var and not from anything the caller names. `whatsapp_waha_session` and
`whatsapp_cloud_phone_number_id` are both valid namespaces; the Cloud one is
still empty. The resolver returns a **set**, so unresolved is zero rows and an
n8n branch halts on it.

**The Message Policy Engine** — `whatsapp_policy_decision_for_channel(...)`
answers `FREEFORM_ALLOWED | TEMPLATE_REQUIRED | BLOCKED` with the reason, the
`policy_rule` row it applied, that rule's verification status, and what would
change the answer. No `SECURITY DEFINER` anywhere in it, and no model in the
path — the arguments are identifiers and a timestamp, so a message body cannot
become one.

**The 24-hour customer service window is Meta's rule, not a dealer setting.**
It lives in `policy_rule` under jurisdiction `PLATFORM_WHATSAPP`, seeded
`NOT_VERIFIED`, and the number `24` appears in no function body. Withdrawing
the rule produces `TEMPLATE_REQUIRED / POLICY_RULE_MISSING`, not a fallback.
One rule is deliberately filed under `NEXUS_HOUSE` instead — NEXUS refuses
marketing without evidenced opt-in even inside an open window, which is
stricter than the platform, and it is recorded as our choice rather than
Meta's requirement.

**Cloud API is structurally better than WAHA and the adapter must not squander
it.** Meta signs every webhook with `X-Hub-Signature-256` — HMAC-SHA256 over
the **raw bytes**, so hashing a re-serialised JSON object never matches; and
the tenant comes from Meta's own `metadata.phone_number_id`, not a
caller-chosen string. A CHECK constraint makes this structural: a
`whatsapp_cloud` row in `channel_message_events` cannot exist unless
`origin_verified = 'hmac_sha256_x_hub'`.

Write nothing before the signature verifies. The reason that matters most is
not storage: **claiming a `wamid` before verification is a denial of service on
a real customer** — the genuine Meta delivery then looks like a duplicate and
is silently dropped, and nothing appears broken.

**Never invent a messaging cost.** `whatsapp_message_usage` has **zero numeric
columns** and the monthly rollup has no total. `cost_state` distinguishes
"awaiting a provider report", "provider reported no pricing", "provider said
not billable" and "billable, amount unknown" — and a screen may not render any
of them as zero. Meta's `pricing` and `conversation` objects are stored
verbatim as provider-reported facts.

**NEXUS's template record is a cache, not an approval.** `nexus_state` and
`provider_status` are separate, an APPROVED with no observation timestamp is
unsavable, and `whatsapp_template_sendability()` takes a staleness tolerance
with **no default** — the caller must state how old an answer it will accept,
and that tolerance is recorded on the usage row. A 40-day-old APPROVED refuses.

**The router never selects a provider on cost.** Order is: conversation
continuity, then the official platform first, then earliest registered.
`channel_provider_rank` has no cost column, and
`nexus_provider_router_invariants()` fails if one appears — and fails again if
WAHA ever gains a capability Cloud lacks, which is the only route by which the
capability filter could push a send downward. Using an unofficial transport to
avoid an official platform's charges is a policy bypass, and the number at risk
of a ban is the dealership's own business line.

### A dealership could legislate as Meta, until 4 Sep

An adversarial pass proved this on production, as the ALBA CARS owner acting
as role `authenticated` — a signed-in dashboard user, no `service_role`, no
n8n — using only functions that carry EXECUTE for `authenticated`:

    propose PLATFORM_WHATSAPP / WA_CUSTOMER_SERVICE_WINDOW_HOURS = 99999  -> ok
    verify that same rule themselves                                      -> ok
    decision: TEMPLATE_REQUIRED -> FREEFORM_ALLOWED, AUTHORITATIVE,
              window_hours 99999, jurisdiction PLATFORM_WHATSAPP

Two facts combined: `policy_verify_rule` guarded *scope* but not
*jurisdiction*, and the lookup ordered `(tenant_id is null)` ascending, so a
tenant rule **outranked** the global one. The audit trail then said Meta had
said so.

Fixed by making it unrepresentable rather than refused. A jurisdiction is now
a namespace with an owner (`policy_jurisdiction`), the owner kind is pinned to
the rule by a composite foreign key, and a CHECK ties scope to ownership: a
dealership row under `PLATFORM_WHATSAPP` cannot exist. The lookup no longer
*orders* by scope — scope is a filter derived from ownership, so there is no
direction left to invert. A dealership may still hold house rules under
`TENANT_HOUSE`, and one is applied only when it is **strictly stricter** than
the platform's; a longer window is recorded as considered-and-ignored.

**The lesson worth keeping: a guard on scope is not a guard on authority.**
Asking "may this actor write a row of this shape" is a different question from
"may this actor speak in this name".

### And the platform-verification path exists now

`policy_verify_rule` returned `NO_SESSION` to `postgres` and `service_role`, so
nobody — not even the platform operator — could verify a global rule. That, not
policy, was why every conversation returned `TEMPLATE_REQUIRED`.

`policy_platform_verify_rule()` is `service_role`-only and demands an
attestation: a named person, a reachable contact, a source kind, an openable
reference, and the day it was read. No session means the actor cannot be
derived, so it must be stated. A global rule cannot reach `VERIFIED` without
one.

**Ali still has to check the WhatsApp rules against his own Meta account.** The
road is built; nobody has driven it. Production holds zero attestations and
zero verified rules.

### Corrections earned by measurement, 4 Sep

- **"Applied at byte parity" was wrong.** `md5(prosrc)` differs on 34 of 105
  functions between production and staging. Comment-and-whitespace-stripped
  they all match — staging's copies were applied with `--` comments removed —
  but the honest claim is *semantic* parity, and it must be stated that way.
- **"`service_role` only, `anon` and `authenticated` refused by grant" was
  wrong**, and the way it was wrong matters more than the claim.
  `channel_registry` carries **column-level** grants: `authenticated=r` on
  seven of eight columns with `credential_ref` deliberately withheld. That
  design is right — but **the ACL query prescribed above reads `relacl` and
  cannot see it**, and would report the table as `service_role`-only. Check
  `pg_attribute.attacl` as well, or the check is blind to exactly the grants
  someone took care over.
- **The template staleness gate was wired to nothing.** The function behaved
  as designed and the router never called it — it called a stub returning
  `UNVERIFIED_REGISTRY_PRESENT_NOT_WIRED` and set `SEND` before it. A 40-day
  stale APPROVED, a provider-REJECTED template, a NEXUS-retired one and a
  reference that never existed all returned `SEND / SENDABLE_TEMPLATE`. Now
  wired; the router takes a staleness tolerance with no default and refuses for
  want of one.
- **`channel_message_events` *can* hold an outbound `whatsapp_cloud` event** —
  by claiming a signature it does not have. The CHECK demands
  `hmac_sha256_x_hub`; recording an outbound with the honest value
  `shared_header` is refused, and claiming the signature is accepted. So the
  constraint pressures the writer into asserting something it cannot have, and
  `origin_verified` on an outbound row is evidence of nothing.
- **The forged-send CHECK is real but shallow.** It holds on NULL, empty string
  and out-of-vocabulary values, and on nothing else. `policy_decision` is bare
  `text` and `policy_applied_rule_id` a bare `uuid` with no foreign key,
  because **no decision entity is persisted anywhere** — the function returns a
  row type. A decision belonging to a different tenant, customer or
  conversation, or one taken 30 days ago against a window that has since
  closed, all insert cleanly. A tenant A directive naming tenant B's
  `integration_id` inserted cleanly too.
- **Two cracks in idempotency.** The key includes `requested_by`, which is
  caller-declared and defaults to a placeholder — two n8n nodes retrying the
  same logical send under different names produce two sends; and a null
  `request_ref` disables it entirely. Separately,
  `whatsapp_record_customer_message` ignores `external_message_id` and upserts
  on timestamp alone, so **replaying one message with a later timestamp extends
  the customer service window** — which is the fact that turns
  `TEMPLATE_REQUIRED` into `FREEFORM_ALLOWED`. Given two WAHA hosts posting the
  same `payload.id` and a retrying `Log Incoming Message`, that is the live
  traffic shape.

### Refusals must raise, not be returned in a column

`policy_verify_rule` and `policy_supersede_rule` signalled refusal as
`ok=false` and raised nothing. A `PERFORM` or an ignored column read as
success — the QA agent made exactly that mistake and filed a false finding
from it. The four dealership policy write functions now raise SQLSTATE `NX001`
with the machine code in `DETAIL`, the sentence in `MESSAGE` and the next step
in `HINT`, so PostgREST hands a dashboard all three.

### One blocker this layer still cannot clear itself

- **`policy_verify_rule()` refuses global rules by design** — "global rules are
  verified by the platform" — and no platform-verification path exists. So the
  window rule stays `NOT_VERIFIED`, and **every conversation in production
  returns `TEMPLATE_REQUIRED / WINDOW_RULE_NOT_VERIFIED` today.** That is the
  engine being honest, and it is also the single thing standing between this
  layer and being usable. Someone with the Meta Business account has to check
  the rule, and a platform-verification function has to exist to record that.
- **`channel_message_events` cannot hold an outbound `whatsapp_cloud` event** —
  its signature CHECK demands `hmac_sha256_x_hub`, right for an inbound
  webhook, impossible for a call we made ourselves.

### Two defects the router's own probes found, worth remembering

A CHECK constraint of the form `a OR b` **passes on NULL** — CHECK rejects only
FALSE. The "a SEND requires a policy decision" guarantee did not structurally
exist until an explicit `is not null` was added, and a forged send inserted
cleanly until then.

And a `row_number()` that counted ineligible candidates put WAHA first for a
template send it cannot carry, so the router asked the policy engine with a
NULL integration and got back `CHANNEL_NOT_REGISTERED_TO_TENANT` — **a tenancy
alarm raised by a ranking bug.** It failed closed, which is what the
constraints bought.

## Two planes, and the boundary between them

4 Sep 2026. NEXUS is a product Ali sells to dealerships, so there are two
audiences and they must not see the same screen.

- **Control Plane** — platform users, tenants, subscriptions, licences,
  entitlements, usage events, workflow and node health, error events,
  releases, support cases. Ali's.
- **Dealer Data Plane** — customers, leads, messages, vehicles, deals,
  finance, compliance, campaigns, actions, audit. The dealership's.

Least privilege applies to Ali too: platform telemetry by default, customer
content only through an audited support path. On Cloud he holds the database
credentials and nothing in software prevents him bypassing that path — the
document says so rather than pretending otherwise.

**The audit of what the dashboard shows today found no cross-tenant leak and
no secret rendered.** The finding is different and more ordinary: *the
operator's instrumentation accumulated inside the customer's product.*
`settings.js:1402` tells a dealership that one n8n instance serves every
dealership; `workflow_registry` is `SELECT USING (true)` for `authenticated`
with no `tenant_id` and 18 rows of workflow ids, cron expressions and webhook
paths (**that one is closed — see the `workflow_registry` bullet above; it is
off the dealer plane entirely as of 6 Sep 2026**); `automation.js` renders n8n
execution deep links, node names and
"spends OpenRouter tokens"; `ask.js` prints the model ladder and the prompt
budget. The operating rule is: **symptom and impact to the dealership;
mechanism and location to the vendor.**

**Self-hosted telemetry is a fiction.** That is what self-hosting means. A
licence check can gate first-run setup, carry an expiry and be revoked; it
cannot prove the software stopped running, report health, or count active
dealerships. Any control-plane design that assumes it can see a self-hosted
installation is designing against a customer who can block it at the firewall.

## The node count is 334, not 250-300

Read from the published definitions on the box, 4 Sep. 21 workflows, 334
nodes. **19 carry a published version; two have none at all** — Phase 6
Silence Detector and NEXUS Infra Health Probe, 12 nodes each,
`activeVersionId: null`.

That second one matters: **nothing is watching the WhatsApp channel.** The
Infra Health Probe is the schedule trigger, the WAHA session check and the
alarm that throws into the error workflow, and it has never been published.
`workflow_registry` reports `is_active = true` for both — the registry and the
box disagree, and the dashboard reads the registry.

**There is no run-marker column anywhere** — no `journey_id`, `test_run_id` or
`is_test` on any of the 58 tables. So a journey's test data is marked
structurally by `tenant_id` (NOT NULL everywhere, therefore unforgettable) and
by an RFC 2606 `.invalid` email namespace, with an external primary-key
manifest and a three-snapshot cleanup proof. Cleanup fails on collateral even
when every assertion passed.

And a phone number is not safely fakeable: `Guard Reply` filters content, never
the recipient. Either journeys run against a WAHA session on a controlled
device, or the send legs stay blocked.

## The idempotency family, and what the release verifier found

4 Sep 2026, two independent passes. The first fixed six identities; the second
verified PR #6 and found four things the branch's own author had not seen.

### The window could be extended by replaying a message

`whatsapp_record_customer_message` ignored `external_message_id` and upserted
on `last_customer_message_at` alone. Replaying one message with a later
timestamp moved the window forward six hours. Proved end to end:

    genuine customer message 30h ago  -> TEMPLATE_REQUIRED / WINDOW_CLOSED
    redelivery of the same payload.id -> FREEFORM_ALLOWED  / WINDOW_OPEN

That is not a data bug. `last_customer_message_at` is the single fact that
turns `TEMPLATE_REQUIRED` into `FREEFORM_ALLOWED`, so a replay was **NEXUS
granting itself permission to send outside Meta's window** — and with two WAHA
hosts posting the same `payload.id` and a retrying `Log Incoming Message`, it
was reachable from live traffic.

Fixed with `whatsapp_customer_message_seen`, keyed on the window's own identity
plus the message id. A single `last_seen_id` column would not work — A→B→A
defeats it, tested. A null `external_message_id` is **refused**: accepting one
restores the whole defect through another door, because with nothing to dedupe
on every redelivery looks new.

### An actor is not part of an event's identity

`nexus_request_send` keyed on `(tenant_id, requested_by, request_ref)`, and
`requested_by` is caller-declared. Two n8n nodes retrying the same logical send
under different names produced two sends; a null `request_ref` disabled
idempotency entirely. Both closed, and a null ref now refuses rather than
silently going unkeyed.

**Four more of the same shape**, found by looking for it deliberately:
`channel_message_events`'s key omitted `integration_id`; the directive was not
bound to its carrier; and `whatsapp_opt_in_event` **had no key at all** — so
replaying the same consent evidence with a bumped timestamp overturned a later
OPT_OUT, taking a conversation from `BLOCKED / CUSTOMER_OPTED_OUT` back to
`FREEFORM_ALLOWED`. Defect one's shape applied to consent withdrawal.

**Still open and stated rather than papered over:** a decision from a
*different conversation* cannot be closed by a constraint, because no decision
entity is persisted — `policy_applied_rule_id` is a bare uuid with no foreign
key and there is no row to compare against.

### The gate had been exempting workflow_registry all along

This file has said for a day that `workflow_registry` is "deliberately NOT
exempt" and "left failing on purpose". Measured against the base gate: its
filter was the substring regex `/reason_codes|workflow_registry/`, so
`workflow_registry` **was being silently exempted and was not among the
failures**. The claim was true of the intent and false of the artefact. It
fails by name now, with its reason.

**And on 6 September 2026 it stopped failing, by being fixed rather than
named.** The table is off the dealer data plane and `workflow_registry_read`
no longer exists, so it is not an open policy for the gate to judge. Nothing
was added to `L2_EXEMPT_TABLES`; `L2_NOT_EXEMPT_NOTES['workflow_registry']` is
left in place and is now dormant — it only prints if somebody re-creates a
`USING (true)` policy on that table, which is exactly when it should.

### `policy_platform_attestation` is on the wrong plane

Ten column-level `authenticated=r` grants and a `USING (true)` policy, with
**no `authenticated` entry in `relacl` at all** — so the ACL query prescribed
in this file, and the gate's own `l2AuthenticatedAclLetters`, both report it as
`service_role`-only. It is not. Every signed-in dealership user can read who
attested a global rule, their email, the source they read and when. Zero rows
today, so this is exposure of an empty table — but attestations are control
plane, and this is the dealer data plane.

### Three smaller things worth carrying

- **L5 is blind to a PUBLIC grant.** Its filter is `/anon=X/`; L4's also
  matches `/=X/`. `anon` inherits PUBLIC, and one PUBLIC-granted function
  exists. A future `CREATE OR REPLACE` adding `SECURITY DEFINER` and a tenant
  read to it would be invisible to L5 — the exact "no grant-shaped diff to
  review" shape that has opened three holes here.
- **The catalogue's 24-hour freshness tolerance is a fuse, not a lock.** A
  catalogue 23.92 hours old was accepted and produced a full live verdict — for
  a database with 60 functions where live had 110.
- **`applied_rule_*` names the wrong rule when a house rule closes the window.**
  The hours come from `TENANT_HOUSE` while `applied_rule_jurisdiction` reads
  `PLATFORM_WHATSAPP`. Anything persisting only `policy_applied_rule_id` will
  attribute the dealership's own decision to Meta — the same shape as the
  defect above it, one layer up. The truth is in `rules_considered`.

### Staging is not yet a faithful rehearsal

Semantic parity is exact — 110 functions, 356 constraints, 167 indexes, 161
policies, identical. ~~But production carries seven `channel_registry` **column**
grants and staging carries none, and that is the table the tenant resolver
reads.~~ **Corrected 6 Sep 2026: staging now carries the same seven**
(`integration_id, tenant_id, channel_type, external_identifier, status,
created_at, updated_at` to `authenticated`, `credential_ref` withheld), measured
with the column-level query in the default-grant section. That particular gap in
the rehearsal is closed. What still makes staging an imperfect rehearsal is the
n8n box, which is not staged at all.

### The consent table was closed by an accident, not by a decision — 6 Sep 2026

The two-dealership proof reported that a dealership gets **42501** on
`whatsapp_opt_in_event`, `channel_message_events` and `whatsapp_delivery_events`
and cannot see its own consent, message or delivery records.

**Measured, the refusal is correct and no grant was opened.** The Conversations
screen reads `v_conversations` and nothing else — `grep -rn` across
`apps/executive-dashboard/screens` and `lib` finds zero queries against those
three tables; the one mention of `channel_message_events` is a glossary entry in
`lib/vocabulary.js`. A dealership already sees its own WhatsApp history today:
production `v_conversations` = 13 rows and `communication_logs` = 114, both
`authenticated=r` behind a tenant-scoped RLS policy. All three refused tables
hold **zero rows** on both projects. Opening a grant would have been designing a
projection against no rows, for no caller, to fix no symptom — and when a caller
does exist the right shape is `channel_registry`'s: a **column-level** grant
withholding what is mechanism rather than symptom.

**What the sweep did find is worth more.** `channel_message_events`,
`whatsapp_delivery_events` and `whatsapp_customer_message_seen` each carry a
RESTRICTIVE `_deny_end_users` policy naming `anon` **and** `authenticated`.
Seven sibling tables in the same never-fired layer carried **no such floor** —
including `whatsapp_opt_in_event`, the consent record. They were closed only
because no grant existed and no permissive policy named `authenticated`: RLS
default-deny. That is an incidental lock, and this file already records what
those are worth.

Closed by `20260906050648_messaging_layer_deny_end_users_is_designed_not_incidental`
on both projects: the same explicit RESTRICTIVE deny on all seven
(`whatsapp_opt_in_event`, `whatsapp_conversation_state`, `whatsapp_message_intent`,
`channel_provider_capability`, `channel_provider_rank`, `channel_send_directive`,
`channel_send_form`). The migration **refuses to run** if any of them has grown
an end-user `SELECT` grant in the meantime — a floor is only safe to lay where
nobody is standing.

Proved by counterfactual rather than asserted, in one rolled-back staging
transaction: a real consent row written by `whatsapp_record_opt_in_event`, then
the pre-migration shape reconstructed (floor dropped, `grant select` added, a
permissive `using (true)` policy added) — **the Bravo owner read Alpha's consent
row, 1 row.** With the floor back and the same accident in place: **0**, while
`service_role` saw 1 throughout. Before and after the real change, all seven
tables return `42501` to `authenticated` and unchanged row counts to
`service_role` on both projects, and the engine's own writer still works.

**Still true and still the honest position:** a dealership has no way to see the
consent state its sends are being refused on. That is a screen that has not been
designed, not a grant that is missing, and it should be designed the day a
caller exists.

### A refusal rendered an empty date, and its hint led nowhere — 6 Sep 2026

`policy_verify_rule` on a rule with `effective_from` NULL returned, verbatim:

    MESSAGE  This version has been in force since  and that date cannot move.
    HINT     Verify it as it stands (pass no p_effective_from, or ), or supersede
             it with a version that starts on the new date.

The blank is a NULL interpolated raw — the thing this project says it never
does. The worse half is the hint: "pass no `p_effective_from`" then fails
`NO_EFFECTIVE_FROM`, so **both routes it offered refuse**, and a dealership
following it has nowhere to go. `policy_platform_verify_rule` carried the
identical branch and the identical dead end.

Fixed by `20260906050249_policy_refusals_say_what_they_mean_when_a_date_is_absent`
on both projects. The NULL case is now its own refusal — `EFFECTIVE_FROM_NOT_RECORDED`
— which says the version left DRAFT without ever recording a start date, that
`policy_rule_guard_immutability()` freezes `effective_from` outside DRAFT so one
cannot be set now, and that superseding is the **only** route. `ALREADY_VERIFIED`
in both functions interpolated `verified_by` and `verification_date` raw as well;
neither column is NOT NULL, and both now print "(not recorded)".

Positive control held on both projects: with a real `effective_from`, the
original `EFFECTIVE_FROM_IS_FROZEN` still renders the real date (`2026-09-04`),
`NO_EFFECTIVE_FROM` still fires when no date is supplied, and
`GLOBAL_RULE_NOT_TENANT_VERIFIABLE` still refuses a dealership approver on a
global rule. No guard was added, removed, reordered or relaxed; no refusal
became an acceptance; both functions' ACLs are unchanged and byte-identical
across the two projects.

## anon read 8,500 rows, and the guard does not cover the door it came through

4 Sep 2026, proved by execution, not inferred.

The 2 September closure revoked default privileges for role **`postgres`
only**. Supabase carries a second line for **`supabase_admin`** in `public`,
and it was never closed. `CREATE EXTENSION … SCHEMA public` — run *by
postgres* — produces objects *owned by supabase_admin*, so a probe table
arrived with `anon=arwdDxtm` and **RLS off**, and `anon` then read **8,500
rows from it**. `REVOKE … FROM anon` as postgres returned SUCCESS and changed
nothing: the non-grantor no-op, exactly as this file warns.

The `postgres` line was also only half closed — a table created by an ordinary
migration was born with `authenticated` holding **TRUNCATE and DELETE**, and a
sequence with `setval()`. The 3 Sep pass narrowed the objects that existed and
never touched the default, so the defect was set to recur on every migration.

Both are closed now. The `postgres` line is narrowed to `SELECT` for
`authenticated` on tables and nothing on sequences — the FUNCTIONS line is
deliberately left, because every `rpc/*` the dashboard calls depends on it.
The line postgres does not own is handled by an event trigger,
`nexus_guard_born_open_grants()`, which is **`SECURITY INVOKER` on purpose**:
an event-trigger function runs as the role that ran the DDL, so the REVOKE
inside it executes *as the grantor* and bites. `SECURITY DEFINER` would run it
as postgres and turn it straight back into the proved no-op.

**Three things are not closed, and pretending otherwise would be worse than
the defect:**

- **The guard does not fire for `CREATE EXTENSION`** — measured with an
  instrumented trigger, which logged `CREATE TABLE` and `CREATE SEQUENCE` and
  logged nothing for `create extension`. That is the exact path that produced
  the 8,500-row read. **Operational rule: install extensions into
  `extensions`, never `public`.**
- **The one lever that would close it — `revoke usage on schema public from
  anon, public` — was not pulled.** Revoking from `anon` alone changes nothing
  (PUBLIC still holds `=U`); revoking from PUBLIC too returns 42501. Eleven
  roles hold that USAGE only through PUBLIC, including **`authenticator`, the
  role PostgREST logs in as**. That is a plausible whole-API outage and needs a
  rehearsal against a live REST endpoint first.
- **A third default-ACL line nobody has looked at:** `postgres` / `storage`
  still grants `anon` ALL on new tables and `rwU` on new sequences. Postgres
  owns that one, so it *can* be closed.

`policy_jurisdiction` and `policy_platform_attestation` are off the dealer data
plane now — revoked, not viewed, because `v_policy_rule` already carries the
verification facts a dealership legitimately needs and a second view would be a
second derivation of the same figure. Neither was added to the exemption map.
L2 is down from three failures to one, and the one left is the one deliberately
left red.

And a detection lesson: `inventory_actions_touch()` reached `anon` on both
projects, but via a **direct** grant on staging and via **PUBLIC** on
production. A sweep written as `proacl like '%anon=%'` flags staging and clears
production, which is exactly as reachable. The direct-vs-PUBLIC rule applies to
the *detection query*, not only to the REVOKE.

## The consent fix was half done, and messaging must not be switched on

Adversarial regression, 4 Sep. `recorded_by` was correctly removed from
`whatsapp_opt_in_event`'s identity — and **two other caller-controlled fields
were left in it**: `evidence_kind` and `evidence_ref`, both free text. So a
conversation that reached `BLOCKED / CUSTOMER_OPTED_OUT` returns to
`FREEFORM_ALLOWED` by three routes, none involving the customer:

- the same consent replayed under a different `evidence_ref`
- the same consent replayed under a different `evidence_kind`
- an OPT_IN dated 2099 — there is no temporal CHECK

And the tiebreak at an identical `occurred_at` **is not deterministic and
resolves toward consent**: `recorded_at` defaults to transaction time, so a
writer recording both events in one transaction ties on both sort keys and heap
order decides. Proved concurrently too — two OPT_INs racing an OPT_OUT across
three real backends returned `OPTED_IN`.

Today, with the window rule `NOT_VERIFIED`, that forgery sends a **marketing
template to someone who sent STOP**. After attestation it sends a free-form
message.

Compare `whatsapp_record_customer_message`, which refuses a null id and carries
a 400-character hint warning against per-delivery ids. The consent writer has
no equivalent discipline, and **no caller exists yet** — which is exactly why
the discipline must be structural before one is written.

**The window fix holds against every stable-id replay, including A→B→A — and
was defeated by the live `nokey:` shape, and is not any more** (5 Sep 2026: a
CHECK on `whatsapp_customer_message_seen`, `processed_messages`,
`channel_message_events` and `whatsapp_delivery_events` refuses ids minted per
attempt — `nokey:`, `outreach:`, `exec-`, `run-`, `job-`, and bare numeric ids.
The **node** still mints them, so the writer change in
`ops/n8n-bundle-NOT-DEPLOYED/04-*` is still owed).** `whatsapp_bdc_ai_agent.json:713`
mints `'nokey:' + $now.toMillis()` when the message id is absent: a
per-delivery id that changes on every retry, which is precisely what the
function's own hint warns against. Two `nokey:` ids for one message jump the
window to now.

**`nexus_request_send` is the one of the six that is properly finished** — all
five attacks held, including a genuine two-backend race.

Six more found by looking where nobody had: `whatsapp_delivery_events` keys on
unnormalised `status_raw`, so `delivered` and `DELIVERED` double-count, and its
key **omits `integration_id`** — the defect just fixed one table over — so a
second integration's genuine delivery report is silently dropped. Template
identity duplicates through a nullable `waba_ref`. And **seven of nine tables
carrying both `tenant_id` and `integration_id` accept a mismatched pairing** —
the functions check `channel_registry`, the tables do not, and `service_role`
writes tables directly.

A SEND can also cite a decision belonging to a different customer, or the
finance `MAX_LTV_PCT` rule, or a rule id that exists nowhere — because
`policy_applied_rule_id` is a bare uuid. **The cheapest real fix is one
constraint:** a foreign key to `policy_rule(id)`.

**Verdict: the idempotency family is not safe enough to switch WhatsApp
messaging on.**

## Consent identity, closed

4 Sep 2026. Five migrations, both projects, fingerprint identical across 279
objects. Production held zero consent rows before and after — no backfill,
nothing deleted.

**The key is now two constraints, not one.** `UNIQUE (tenant, integration,
customer, event, occurred_at)` is the act — "this customer said yes or no at
this moment on this channel", and nothing a caller invents is in it. A second
constraint pins evidence as a *property*: one reference attests one act,
normalised by `lower(btrim(…))`, with **`evidence_kind` deliberately absent**
so relabelling cannot mint a row and **`event` absent** so one reference cannot
attest both a yes and a no.

Dropping evidence from the key alone would have re-opened "identical evidence
at a bumped timestamp"; keeping it in the key was the original defect. It takes
both constraints to close both directions.

**`occurred_at` is bounded, asymmetrically, and the asymmetry is the point.** A
future OPT_IN is **refused** — a stored-but-ignored row reads as consent to
anyone auditing the table, and this codebase has already paid repeatedly for
"unknown rendered as a fact". A future OPT_OUT is **clamped to now** with the
stated time kept in notes, because a clock disagreement must never be the
reason a customer who sent STOP keeps being messaged.

**The tiebreak is structural and can only fall one way.** A generated,
unwritable `consent_rank` column puts OPT_OUT ahead of OPT_IN, and the
canonical order is `occurred_at desc, consent_rank asc, recorded_at desc,
id desc`. The two hand-written ORDER BYs that had to agree are gone — both
consumers now call one function. **The answer no longer depends on commit
order**, proved with five separate `pg_cron` backends whose execution windows
overlapped: two OPT_INs racing an OPT_OUT now returns `OPTED_OUT`.

**Overturning a STOP is held to a higher standard than granting consent in the
first place.** A first opt-in may rest on the recording system's word. A
reversal may not use `OPERATOR_RECORDED` or an import, and must cite evidence
NEXUS can resolve **to a row it already holds, dated after the withdrawal** —
the customer's own measured inbound message, or an audit row of that tenant's.
A bare uuid, a bare epoch, an `exec-`/`run-`/`job-`/`nokey:` prefix, or a
`wamid` NEXUS never observed are all refused by name.

All three original forgery routes, the tie, and the concurrent race now return
`BLOCKED / CUSTOMER_OPTED_OUT` — including with the platform rule attested
inside the transaction, which is the severity that will actually matter.

**What is left is not a consent defect.** There is no `SECURITY DEFINER` here,
so `service_role` writing the table directly bypasses the writer's checks; the
CHECKs and the derivation's own future-filter still bite, but a direct insert
of an OPT_IN one microsecond after an OPT_OUT still reads as consent. n8n holds
`service_role`. **The writer is the disciplined door, not the only door**, and
closing it properly means moving consent reversal onto a named-human path
rather than the n8n key — an authority question, the same lesson as
`policy_verify_rule`, and it deserves its own pass.

## The door was the schema, not the ACL

4 Sep 2026. The exposure was reproduced exactly: `CREATE EXTENSION postgis
SCHEMA public` as **postgres** produced `public.spatial_ref_sys` owned by
`supabase_admin`, RLS off, `anon=arwdDxtm` — and `anon` read **8,500 rows**,
inserted, updated and deleted. **Not read-only. Writable.**

**Root cause: `supautils`.** Supabase re-runs `CREATE EXTENSION` as
`supabase_admin` for the 70 names in `supautils.privileged_extensions`, and it
**skips non-superuser event triggers** — there is a
`supautils.log_skipped_evtrigs` setting for exactly this. Proved with three
triggers running simultaneously (untagged `ddl_command_start`, tagged
`ddl_command_start`, tagged `ddl_command_end`): all three logged a `CREATE
TABLE` in the same transaction, **none logged the `CREATE EXTENSION`**.

So the answer to "can the guard be made to cover it" is **no**, and a
scheduled sweep would not have been an answer either — a sweep cannot
remediate what it cannot out-race.

**The earlier 42501 on revoking schema USAGE did not reproduce.** `postgres`
is a member of `pg_database_owner`, which is the grantor. So the door that was
thought shut was open. `USAGE` is now revoked from `PUBLIC` and `anon` and
re-granted **by name** to the eleven service roles that held it only through
PUBLIC; the thirteen `pg_*` roles need no grant, because
`pg_read_all_data`/`pg_write_all_data` confer schema USAGE implicitly.

### The verification that matters, and the lesson in it

With the door shut, postgis was installed **for real** on staging.
`relacl` still read `anon=arwdDxtm`. `has_table_privilege('anon', …)` still
returned **true**. And `GET`/`POST /rest/v1/spatial_ref_sys` with the anon key
both returned **401, `42501 permission denied for schema public`** — `42501`
and not `PGRST205`, which proves PostgREST had the table cached and refused
anyway.

**ACL metadata was the wrong witness.** Every ACL sweep this project has run —
including the ones in this file — would have called that table exposed. The
reachability probe is the one that told the truth.

### Extensions are contained, not migrated — and the reason matters

`ALTER EXTENSION … SET SCHEMA extensions` succeeds, and doing it would break
the RAG path: `search_rag_documents` is pinned `search_path='public'` and its
trigram tier calls `word_similarity()` unqualified, so after the move that is
`42883 function does not exist`. A first test appeared to pass only on a cached
plan. Production holds 15 live `rag_documents` rows.

**Prerequisite for any later migration pass:** change `search_rag_documents`
and `nexus_tenancy_readiness` to `search_path = public, extensions` *first*.

The rule, written down: **extensions belong in `extensions`, never `public`.**

### What is still open, and it needs Supabase

**`authenticated` still reaches born-open objects** — measured live: SELECT
8,500 rows, UPDATE one row. It cannot lose `USAGE` on `public`, because the
dashboard lives there. Closing it needs Supabase to either close the
`supabase_admin` default-ACL line for `public` or pin extensions via
`supautils.extensions_parameter_overrides`. Both are config-file settings and
both return **55P02 "cannot be changed now"** from SQL.

`nexus_public_exposure_report()` reports reachability rather than ACL —
currently **anon 0, authenticated 149**. It reports and does not remediate,
because here a sweep genuinely cannot.

Reversal, if the schema revoke ever needs undoing, is one statement:
`grant usage on schema public to public;`
