# NEXUS Control Plane — the vendor's side of the glass

**Written 4 September 2026. This is a design document. Nothing in it is built.**

Measured against production (`dsvuoovivysszdoiorch`) on the day of writing:
there is **one tenant row, one `tenant_members` row, one `users` row**, and
there is **no table, view or function anywhere in `public` whose name matches
`licen`, `subscri`, `plan`, `billing`, `entitle`, `usage`, `release`, `support`,
`install`, `activat`, `telemetry` or `marketplace`** — the only matches are
`whatsapp_message_usage` and its two views, which are messaging records, not
commercial ones. So every noun in this document is a proposal. Read it as a
specification to build against, not as a description of a system that exists.

This document creates no database objects and applies no migrations.

---

# Part 1 — What Ali can actually know, per product shape

This part comes first deliberately. Every dashboard drawn before this question
is settled is a dashboard that assumes a telemetry stream that may not exist.

Three shapes are agreed:

| Shape | Who runs the infrastructure | Who holds the keys |
|---|---|---|
| **NEXUS Cloud** | Ali | Ali |
| **NEXUS Managed** | Ali, on hardware the dealership may nominally own | Ali |
| **NEXUS Self-Hosted** | The dealership | The dealership |

## 1.1 The hard truth

**Cloud gives full telemetry, because Ali runs the machines.** He owns the
Supabase project, the n8n instance, the WAHA or Cloud API adapter, the Vercel
deployment and the logs of all four. Every figure in Part 3 is obtainable
because the dealership's NEXUS *is* Ali's infrastructure. Nothing needs to phone
home; the data is already on his side. Managed sits here too — the distinction
between Cloud and Managed is commercial and contractual (who was in the room
during installation, who signs for the box), not technical. If Ali holds the
credentials and the logs, it is Cloud for telemetry purposes.

**Self-Hosted gives essentially none. That is what self-hosting means.**

This must not be softened, because softening it produces a control plane that
silently reports a fiction. Concretely, on a self-hosted installation:

- The dealership's Postgres is theirs. Ali has no connection string, no
  `service_role` key, and no route to `audit_log`, `v_workflow_health` or any
  other table. Every workflow-health figure in Part 3 is unobtainable.
- The n8n instance is theirs. Workflow ids, execution counts, node failures,
  credential state — all of it is on their box. `v_workflow_health` is computed
  from *their* `audit_log`, which Ali cannot read.
- Module adoption is unobtainable. Nobody is counting screen opens on a static
  bundle the dealership serves themselves.
- "Is Supabase working" is unanswerable. It may not even be Supabase — a
  self-hoster can point the bundle at their own Postgres with PostgREST in front
  of it.
- **Any phone-home an installation performs can be blocked at the firewall by
  any competent operator, in one egress rule, in under a minute.** A dealership
  IT department that blocks it will not tell Ali they have. Silence from a
  self-hosted installation is therefore ambiguous forever: uninstalled, idle,
  broken, or deliberately muted. Those four states are indistinguishable from
  outside, and no design fixes that.

So the answer to "how will I know how many downloaded, what problems each
dealership hits, whether the workflows and Supabase are working, and which
modules they use" is:

| Question | Cloud / Managed | Self-Hosted |
|---|---|---|
| How many downloaded | Yes — from the marketplace's own download counter, not from NEXUS | Same counter, same number |
| How many installed | Yes | Only if activation is required and not bypassed |
| How many are running today | Yes | No — only "last heartbeat seen", which silence does not disprove |
| What problems they hit | Yes, in detail | Only what they choose to send, or tell him |
| Are the n8n workflows healthy | Yes | No |
| Is Supabase healthy | Yes | No — and it may not be Supabase |
| Which modules are used most/least | Yes | No |
| Are they still paying | Yes — that is billing, not telemetry | Yes — same |

The last row is the important one. **Subscription state is knowable in every
shape, because it lives with the payment processor and the marketplace, not with
the software.** Whether a self-hosted dealership is *using* NEXUS is unknowable;
whether they are *paying* for it is fully knowable. Those are different
questions and Part 6 refuses to merge them.

## 1.2 What a licence check can honestly enforce

A licence key is not a telemetry channel and must never be sold as one.

**What it can do:**

- Refuse to complete first-run setup without a key that validates against Ali's
  licence service. This is the one moment where the installation is
  cooperating — the operator wants it to work — so it is the highest-yield
  point to learn that an installation exists, who it belongs to, and roughly
  where. Call this **activation**, and it is the only self-hosted signal that
  is reliable *once*.
- Carry an expiry, so a lapsed subscription eventually produces a visible
  "licence expired" state inside the dealership's own UI. This nags an honest
  customer. It does not stop a dishonest one.
- Be revoked, so a future re-validation fails.

**What it cannot do, and must not be claimed to do:**

- **It cannot prove the software stopped running.** The code is on their disk.
  Anyone willing to edit one JavaScript file or block one DNS name keeps
  running it. Every enforcement short of a server round-trip per action is
  cosmetic, and a server round-trip per action is not self-hosting.
- **It cannot report health.** A licence check that also uploads workflow
  telemetry is a phone-home wearing a licence's clothes, and the same firewall
  rule kills both.
- **It cannot count active dealerships.** It counts validations, which is a
  count of installations that chose not to block the call.

**The honest self-hosted posture:** licence for revenue integrity and for
knowing an installation was born; ask for telemetry as an opt-in with a clear
statement of what leaves the building; and accept that the primary channel for
"what problems is this dealership hitting" is a **support case a human opens**,
not a metric. Build the support-case path as a first-class part of the control
plane, because for self-hosted it is the *only* path.

**A recommendation that follows from all of the above:** sell Cloud. Price
Self-Hosted so that the loss of visibility is compensated, sell it into
dealerships whose IT policy forbids anything else, and expect to support it
blind. Do not build product decisions on self-hosted adoption data, because
there will not be any.

---

# Part 2 — The two planes, and the boundary between them

## 2.1 The Control Plane

The vendor's world. One dealership is a **row** here.

| Domain | What it holds |
|---|---|
| Platform identity | Ali, and anyone he ever hires: platform users, roles, sessions |
| Tenants | One row per dealership: name, shape (Cloud/Managed/Self-Hosted), region, lifecycle status |
| Commercial | Subscriptions, plans, prices, invoices, payment state, trial and pilot terms |
| Licensing | Licence keys, activations, expiry, revocations, the activation record |
| Entitlements | Which modules and engines a plan turns on |
| Usage events | Module opens, actions taken, messages sent — *counts and identifiers, never content* |
| Operational health | Workflow health, node telemetry, error events, integration state |
| Releases | Versions, what shipped, which tenant is on which version |
| Support | Cases, their state, and the audited access grants that let Ali see into a tenant |

## 2.2 The Dealer Data Plane

The dealership's world. Their customers, leads, messages, vehicles, deals,
finance quotes, KYC documents, compliance records, campaigns, actions and
audit trail. This is what the twenty screens in `apps/executive-dashboard/`
read today, and it is already tenant-scoped by RLS in production.

## 2.3 Where each lives

**They must not share a Postgres role, and should not share a database.**

The recommendation is a **separate Supabase project for the control plane**,
distinct from every tenant's data project. The reasons are structural, not
stylistic:

1. **The blast radius of `service_role`.** n8n writes to the data plane as
   `service_role`, which is `BYPASSRLS`. CLAUDE.md records that the WhatsApp
   inbound webhook is currently reachable unauthenticated and that the caller
   supplies the field the tenant is resolved from. If control-plane tables sat
   in the same database, that same open door would sit in front of the
   subscription and licence tables. It does not today only because those tables
   do not exist. **Do not create them in `dsvuoovivysszdoiorch`.**
2. **RLS is the wrong tool for this boundary.** RLS is a row filter. The
   control/data boundary is not "which rows" — it is "which system". A policy
   bug in a shared database is a total compromise; a policy bug across two
   projects is still bounded by the fact that no connection exists.
3. **Self-hosted makes it mandatory anyway.** A self-hosted dealership runs
   their own data plane. The control plane cannot live inside it, because Ali
   would have no access to it. So the control plane is already a separate
   system for one shape, and having it be a separate system for all three is
   the only design that is uniform.

Within the control plane, tenant-scoped tables still carry `tenant_id`, and
platform users still get least privilege — but the tenant here is a *customer
record*, not a data boundary, because every row in the control plane belongs to
Ali by definition.

## 2.4 How a control-plane row does not become a back door

This is the part that is easy to get wrong, and it is worth being explicit
because the failure mode is quiet.

The control plane necessarily holds, per dealership, the things that make the
data plane reachable: a project ref, a connection endpoint, an n8n base URL, an
integration id. **The moment a support screen renders a customer's name beside
those, the control plane has become a console into their business.** The
temptation is enormous, because it makes support easy.

Four rules:

1. **The control plane stores references, never credentials.** A row may hold
   "this tenant's data plane is project `X`". It may not hold project `X`'s
   `service_role` key. Keys live in a secret manager, and the reference in the
   control plane is a pointer to a secret, not the secret. This is the same
   design the messaging layer already got right: `channel_registry` carries
   `credential_ref` with a **column-level grant withholding it from
   `authenticated`**, which is why CLAUDE.md's own prescribed ACL query was
   blind to it — read `pg_attribute.attacl`, not just `relacl`.
2. **Telemetry is counts and identifiers, never content.** A usage event may
   say "tenant T opened Inventory" or "tenant T sent 41 WhatsApp messages". It
   may not carry a message body, a customer name, a phone number, a VIN, a
   price or a document. An error event may carry a class, a code and a
   stack — with the payload stripped. Design the event schema so that carrying
   content is *unrepresentable* rather than merely discouraged: no free-text
   `payload` column that a future n8n node will inevitably fill with the item
   it was processing.
3. **Customer content is reachable only through an audited support path.**
   Not a dashboard link. A named support case, a stated reason, a scope, a
   time-boxed grant, and — this is the part that makes it real — **a record the
   dealership can read**. Least privilege applies to Ali too: his default
   posture on a customer's data plane is *no access*, and elevation is an event
   with a beginning and an end, not a role he holds permanently.
4. **The dealership can see when Ali looked.** If support access is invisible
   to the customer, "audited" means nothing more than "Ali could reconstruct it
   if he wanted to". A support-access record that appears in the dealership's
   own audit view is what makes rule 3 enforceable rather than aspirational.

The honest note on rule 3: for **Cloud**, Ali holds the database credentials
and can bypass this entire path at any time. Nothing in software prevents the
person who runs the server from reading the server. What the path buys is that
the *normal* way of working leaves a record, so an access outside it is
visible as an anomaly rather than being indistinguishable from routine. Say
that to a dealership plainly; a claim of technical impossibility would be
false, and PRODUCT.md's rules forbid making it.

---

# Part 3 — What belongs on Ali's dashboard

Every panel below states the question it answers and what a person does
differently because of it. A panel that fails the second test is decoration and
does not get built. **All figures used as examples are marked illustrative;
none is measured.**

## 3.1 Platform Overview

*Question:* Is the business growing, and is the platform up right now?

Two rows of tiles, and they must not be mixed: **commercial** (paying
subscriptions, MRR, net new this month, churned this month) and **operational**
(tenants with a health state that needs attention, platform-wide error rate,
integrations down).

*What changes:* if operational tiles are red, Ali stops selling and starts
fixing. If commercial tiles are flat and operational tiles are green, he stops
fixing and starts selling. Today he has no way to tell those two mornings
apart.

*Refusal rule:* MRR is a **confirmed** figure — it comes from the payment
processor. Pipeline value is an **estimate** and must be labelled as one. They
never appear in the same tile, and the estimate never sits in a currency tile
styled like the confirmed one. This is PRODUCT.md's estimated/attributed/
confirmed rule applied to Ali's own numbers, and it matters more here, not
less, because he is the one making decisions on them.

## 3.2 Tenant Command Centre

*Question:* Which of my dealerships needs me today?

One row per dealership. Columns: name, shape, plan, subscription state, health
state (Part 6), last activity seen, version, open support cases. Sorted worst
first, the way `screens/automation.js` already sorts workflows.

*What changes:* this replaces "Ali remembers to check on people". A dealership
that stops sending messages is visible on day two rather than at renewal.

*Refusal rule:* a Self-Hosted row must render its unknowables as **unknown**,
in the same grey `lib/health.js` already uses for `NOT_INSTRUMENTED`, and never
as zero or green. "No runs logged" for a Cloud tenant means the workflows are
not running. For a Self-Hosted tenant it means nothing at all. The two must not
share a colour, and the tooltip must say which one it is.

## 3.3 Dealership 360

*Question:* Everything about one customer, on one page, before I call them.

Commercial history (signed, plan changes, invoices, payment failures), the
acquisition funnel for this one dealership, module adoption, workflow health,
version and upgrade state, integration state, error history, support cases, and
the record of every support access Ali's side has taken into their data.

*What changes:* the renewal call and the incident call both start from the same
page instead of from three tools and a memory.

*Refusal rule:* this page shows **no customer content**. Not a lead name, not a
message. It shows that there were 412 messages (illustrative), not what any of
them said. If Ali needs to see one, that is a support case with a reason, and
it is recorded here as such.

## 3.4 Subscription & licence lifecycle

*Question:* Who is paying, who is about to stop, and who is running software
they no longer have a right to?

States that must be distinct: `trial`, `pilot`, `active`, `past_due`,
`cancelled_at_period_end`, `cancelled`, `expired`, `refunded`. A payment
failure is `past_due`, not `cancelled` — they are different conversations.

Licence view: keys issued, keys activated, keys never activated (a real and
telling category — money taken, software never installed), keys activated more
times than the plan allows, keys past expiry that are still validating.

*What changes:* `past_due` triggers an email today, not a discovery at renewal.
"Purchased but never activated" is the single highest-value support list on the
whole dashboard — those are customers who paid and got nothing, and every one
of them is a refund request or a churn already in motion.

*Refusal rule:* "licence validating" is not "software running", and a lapsed
licence that stops validating is not evidence the software stopped. Both
figures are labelled with what they actually observe.

## 3.5 Workflow health

*Question:* Are the automations working, for this dealership and across the
platform?

This one already half-exists, and its semantics are already right. `lib/health.js`
mirrors `public.nexus_outcome_class()` and holds the vocabulary that took four
screens' worth of mistakes to arrive at: `SUCCESS`, `PARTIAL`, `FAILURE`,
`NO_RESULT`, `REJECTED_EXPECTED`, `ESCALATED`, `UNKNOWN`, and the health states
`HEALTHY`, `DEGRADED`, `PRODUCING_NOTHING`, `UNKNOWN_OUTCOME`,
`NO_QUALIFYING_RUNS`, `NOT_INSTRUMENTED`, `NEVER_RAN`. **Reuse it verbatim.**
Do not invent a second vocabulary for the control plane; the whole reason that
file exists is that four screens each invented their own and all four were
wrong in the same direction.

The control-plane addition is the **cross-tenant** view: the same workflow
across every dealership, so Ali can tell "Competitor Price Scraping is broken
for Tenant A" from "Competitor Price Scraping is broken for everyone", which
is the difference between a support ticket and a release.

*What changes:* one broken workflow across ten tenants is a hotfix. One broken
workflow at one tenant is a call to that tenant.

## 3.6 Node-level telemetry

*Question:* Which step is failing, and is it the same step everywhere?

Per workflow, per node: executions, failures, and the failure text. The Error
Handler already writes the execution's own n8n URL into the audit summary —
`screens/automation.js:139-151` parses exactly that — so the deep link exists
for the runs that need one.

*What changes:* Ali opens the failing node directly instead of scrolling the
n8n execution list by timestamp.

*Refusal rule, and it is the sharp one:* **node names, execution ids and n8n
URLs belong here and nowhere else.** They are on the dealership's Automation
screen today (Part 5). And node telemetry must carry no item payload — an n8n
error object routinely contains the record being processed, which is a
customer's message. Strip it at the collector, not at the renderer.

## 3.7 Module adoption

*Question:* Which of the twenty screens is anybody actually using?

Per tenant and in aggregate: screen opens, unique users, actions taken, and
last-opened. The interesting column is the last one — a screen with a
last-opened of "never" is a screen that has cost development and returned
nothing.

*What changes:* three things, and they are the reason this panel is worth
building at all. It tells Ali what to **build next** (the used screens),
what to **stop maintaining** (the never-opened ones), and — per tenant — what
to **train on**, because a dealership using three of twenty screens is a churn
risk that has not happened yet.

*Refusal rule:* an open is not a use, and a use is not value. Count opens and
call them opens. Do not compute an "engagement score"; it would be an
invented number about invented weights, and PRODUCT.md forbids exactly that
shape of figure.

## 3.8 The acquisition funnel

*Question:* Where do people fall out between seeing the listing and getting
value?

Ten stages, and each must be separately observable or explicitly marked as
unobservable:

| # | Stage | Where the signal comes from | Cloud | Self-Hosted |
|---|---|---|---|---|
| 1 | Marketplace view | Marketplace analytics | ✓ | ✓ |
| 2 | Purchase | Payment processor | ✓ | ✓ |
| 3 | Download | Marketplace download counter | ✓ | ✓ |
| 4 | Activation | Licence service — first successful validation | ✓ | ✓ (once) |
| 5 | Onboarding complete | Control plane: tenant provisioned, first admin user | ✓ | ✗ |
| 6 | Integration connected | Control plane: a `channel_registry`-equivalent row exists | ✓ | ✗ |
| 7 | First message | Usage event | ✓ | ✗ |
| 8 | First lead | Usage event | ✓ | ✗ |
| 9 | First business outcome | Usage event — a recorded sale, an executed action | ✓ | ✗ |
| 10 | 30-day retained | Usage events still arriving at day 30 **and** subscription still active | ✓ | Subscription only |

*What changes:* the drop between 3 and 4 is a broken installer. Between 4 and 6
is an integration that is too hard to connect. Between 7 and 8 is a product
that talks but does not convert. Each is a different fix, and without the
funnel they all present as "churn".

*Refusal rule:* stages 5-9 are **unobservable for Self-Hosted**, and the funnel
must render them as unobservable rather than as zero. A self-hosted cohort
rendered as 100% drop-off at stage 5 would be a false finding, and it is the
exact shape of error CLAUDE.md names: *a missing row is not proof the event did
not happen.*

## 3.9 Health signals that reach Ali before the dealership calls

*Question:* What is about to go wrong?

Not a panel — an alert stream, with a small closed set of triggers:

- Integration disconnected (WhatsApp session dropped, OAuth credential revoked).
  `screens/campaigns.js` already demonstrates why this matters: a revoked Gmail
  credential meant every "sent" was false, and the screen could only infer it
  from the wreckage in `audit_log`.
- Workflow health crossed into `DEGRADED` or `PRODUCING_NOTHING`.
- Activity fell off a cliff — messages, logins, or actions this week against
  the trailing four-week baseline.
- Error rate spike for one tenant.
- Payment failed.
- A tenant fell behind the current release by more than N versions.
- Nothing heard from a Cloud tenant in 48 hours.

*What changes:* Ali calls them. That is the entire product of this panel, and
it is the single highest-leverage thing on the whole dashboard — the difference
between "we noticed your WhatsApp dropped and fixed it" and "why has this not
worked for a week".

*Refusal rule:* every alert must name its evidence and be dismissible with a
reason. An alert stream nobody trusts is worse than none, and the way it loses
trust is firing on absence-of-evidence. "Nothing heard in 48 hours" from a
Self-Hosted tenant is not an alert; it is Tuesday.

---

# Part 4 — What must never appear on a dealership's dashboard

Concrete and complete. Each line is a thing that, if a dealership sees it, is
either a breach, a commercial injury, or a support call Ali will lose.

| Never shown | Why |
|---|---|
| **Any other dealership** — name, count, existence, or a total that implies one | The whole tenancy proof rests on this. A count of "12 dealerships" tells Tenant A their competitors are on the same system. |
| **NEXUS's revenue, MRR, pricing, margin or plan economics** | Ali's business, and the fastest route to a renegotiation. |
| **Global AI cost, token spend, or per-message model cost** | Two harms: it is Ali's cost base, and CLAUDE.md records that `whatsapp_message_usage` has **zero numeric columns** on purpose — a messaging cost may not be invented, and rendering a platform cost as a dealership's cost invents one. |
| **Provider API keys — OpenRouter, Groq, Apify, Meta** | Obvious, and stated because "masked" is not an exception: a masked key still confirms which key is installed. |
| **n8n credentials, credential names, or the credential store** | n8n exposes no browser-reachable credential API, which is a fact the current build relies on. Do not build one. |
| **The `service_role` key, the Supabase connection string, or any secret reference** | `service_role` is `BYPASSRLS`. Exposure is total compromise of every tenant. |
| **Internal prompts, system messages, the model ladder, model names, retrieval parameters** | Product IP, and a jailbreak surface. A dealership seeing "8000-character prompt budget, three-model fallback ladder" learns how to steer the agent. |
| **Cross-tenant health, cross-tenant error rates, platform-wide uptime** | Implies other tenants exist, and their state. |
| **Infrastructure topology** — host IPs, VM specs, `nip.io` hostnames, Docker layout, which SaaS is behind which feature, project refs, build modes | Attack surface, and it invites engineering questions in a sales meeting. `commercial/DEMO-SCRIPT.md` already closes Settings for this reason. |
| **Model-selection logic, fallback behaviour, rate-limit state** | Same as prompts. |
| **Other dealers' benchmarks, percentile ranks, "you are in the top 30%"** | PRODUCT.md is explicit: *Dealer Benchmarking needs multiple dealerships. It is a moat that only exists after customers do.* Until it is a deliberate, consented product with anonymity that has been reasoned about, a benchmark is a leak with a chart on it. |
| **Developer audit** — quality-gate output, migration names, git branches, readiness verdicts, defect lists, `NOT_READY` | This is the engineering record. `NEXUS_INVARIANTS.md` and the gate exist to keep failures visible **to the team**. In front of a customer they are a liability inventory. |

Two clarifications, because the boundary is not "hide everything technical":

- **A dealership is entitled to know that their own automation is broken.**
  "WhatsApp replies are not sending" is theirs. "Node `Model Ladder` threw at
  execution 3213 on `https://35.224.126.225.nip.io/workflow/BiyHk9ZXxJUVGbf6`"
  is Ali's. The rule is *symptom and impact to the dealership; mechanism and
  location to the vendor.*
- **A dealership is entitled to know what NEXUS is doing with their data.**
  Support access records, data location, retention. That is a trust asset, not
  a leak.

---

# Part 5 — Audit: what the dashboard showed on 4 September, and what it shows now

Read against `apps/executive-dashboard/` on branch
`wip/platform-truth-2026-09-01`.

**This part was worked through item by item on 5 September 2026 and every one of
its predictions held.** It is now partly historical, and each finding below
carries its status. The file-and-line references are kept as written, because
they are the record of where each leak was and they are how the fix can be
audited; several line numbers have since moved.

| finding | status, 5 Sep 2026 |
|---|---|
| 5.1 the dashboard tells the dealership other dealerships exist | **CLOSED** — and it existed on a second screen the audit did not name |
| 5.2 `workflow_registry` is a platform table with no tenant scope | **CLOSED 6 Sep 2026** — off the dealer plane entirely; not by a `tenant_id` |
| 5.3 infrastructure topology on Settings | **CLOSED** |
| 5.4 Automation is a vendor operations console | **CLOSED** |
| 5.5 the vendor's third-party stack listed by name | **CLOSED for the chip list; open elsewhere** |
| 5.6 model behaviour described to the dealership | **CLOSED** |
| 5.7 credential state and the vendor's operational history | **CLOSED** — split as this section proposed |
| 5.8 smaller items | **CLOSED except `settings.js:1091`/`:1400`, deliberately** |
| 5.9 what the audit did not find | **still holds** as far as the 5 Sep pass could see |

**Two things this part got wrong about its own premise.** It opens by saying
there is no role check in the database or the UI. That was true on 4 September
and is false now — see `ARCHITECTURE.md` §4 and `STATUS-2026-09-05.md` §4 — though
the model is inert while there is one login. And **eight leaks it did not
predict were found by rendering the screens rather than reading them**, the
worst of which is recorded under 5.8 below. Reading a screen finds the sentences
somebody wrote; rendering it finds the ones the data wrote.

Full evidence, including what was deliberately left:
`ops/evidence/control-plane-frontend-evidence.md`.

Findings are ordered by how much they cost if a dealership reads them.

## 5.1 The dashboard tells the dealership that other dealerships exist — CLOSED

**Closed 5 September 2026.** `settings.js:1402` (now `:1432`) reads *"This list
is the register of the automations NEXUS runs for you. Every count beside them
is this dealership's alone… A few entries are pages NEXUS publishes rather than
automations."* The same sentence was also live on a **second screen**,
`automation.js:1520`, which this section did not name; that copy is gone too.

The original finding, kept because the reasoning is the rule:

`apps/executive-dashboard/screens/settings.js:1402`

> *"This list is the automation register, and the register is the platform's:
> **one n8n instance serves every dealership**, so the same workflows are listed
> for all of them. … The n8n instance also carries the three published workflows
> that serve **NEXUS's public home, privacy and terms pages** — Google requires
> all three before an OAuth consent screen can go to production, and it rejects
> vercel.app as a public suffix — so a count taken in n8n is larger than the
> count here."*

This sentence is *honest*, which is why it was written, and it is exactly the
wrong side of the boundary. It discloses, to a customer, that NEXUS is
multi-tenant on shared infrastructure; that their automations run on the same
n8n instance as everyone else's; that the vendor's own marketing pages are
served from that instance; and that the vendor had to work around a Google
policy. Every clause is a control-plane fact.

**Verdict:** move to Ali's side entirely. The dealership-side sentence is
"these are the automations running for you", with no claim about who else runs
on the same machine.

## 5.2 `workflow_registry` is a platform table with no tenant scope — CLOSED

**Half closed, 5 September 2026, and the half that is left is the one that
blocks a second dealership.** Migration
`20260905194717_workflow_registry_ids_and_crons_off_the_dealer_plane` took the
columns off the dealer plane. Measured in production today, `authenticated`
reads **7 of 10** columns — `name, audit_name, category, is_active, description,
writes_audit_log, audit_aliases` — and `id`, `trigger_type` and `trigger_detail`
return `42501`. No surviving column carries the same content: zero cron-shaped
strings, URLs or hostnames across all 18 rows.

**Closed 6 September 2026**, by migration
`20260906042024_workflow_registry_off_the_dealer_plane_via_vendor_accessor`
(staging first, then production; evidence
`ops/evidence/workflow-registry-scoping-evidence.md`). Gate check `L2`
**passes** and nothing was added to `L2_EXEMPT_TABLES`.

**It was not closed with a `tenant_id`, and that is the part worth carrying.**
This section asked for "a `tenant_id` and a scoped policy", and that request was
wrong about the data. The 18 rows are the **vendor's** register: no measurement
anywhere in the database maps an automation to a dealership, and three of the
registered workflows are NEXUS's own public home/privacy/terms pages, which
serve no dealership at all. A `tenant_id` could only have been populated by
inventing that mapping; a nullable-meaning-platform one would have been NULL on
every row forever, so `tenant_id is null or tenant_id in (…)` would have
filtered nothing while reading like a scope. Splitting the table into a vendor
half and a dealer-safe half was rejected for the same reason in a different
shape: the dealer-safe half would still have needed its own `USING (true)`
policy, which relocates the finding rather than closing it, and it would have
created a second derivation of the same names.

**What was done instead.** The table left the dealer data plane completely — no
table privilege, no column privilege, and `workflow_registry_read` dropped (the
anon-deny and `service_role` policies are untouched). The dealer-safe naming
projection is served by `public.nexus_workflow_catalogue()`, `SECURITY DEFINER`,
`STABLE`, owned by `postgres`, EXECUTE to `authenticated` and `service_role`,
revoked from `anon` and PUBLIC. It returns `name, audit_name, audit_aliases,
category, description, is_active, writes_audit_log` and **cannot** return `id`,
`trigger_type` or `trigger_detail` — they are absent from its result type, so
the withholding is structural rather than a column grant somebody has to
remember. That is the destination this section named, arrived at as a function
rather than a view because a `security_invoker` view is checked against the
caller's privileges on every base column its body reads, and the caller now has
none.

**The RLS policy could be dropped once the views stopped reading the table.**
The 5 September reasoning for leaving it was correct and is preserved by the
design, not overruled: `v_lead_recovery`, `v_needs_attention` and
`v_audit_unregistered_writers` read `name` / `audit_name` / `audit_aliases`, and
dropping the policy underneath them would have broken them silently — the first
by returning NULL "the silence detector never ran", the third by declaring every
audit writer unregistered. All four views now read the accessor instead, and
their outputs were diffed against their own pre-change bodies: **symmetric
difference 0 rows on all four.**

**What is still disclosed, deliberately.** A dealership session that is a member
of an active dealership still sees **18 rows** through `v_workflow_health` and
can count them; that view is the sanctioned projection and Part 4 says a
dealership is entitled to know whether its automations are running. What changed
is that a signed-in session belonging to **no** dealership now gets zero rows
from both the accessor and the view, where it previously enumerated all 18 — and
that the accessor is the single place a per-dealership filter goes if a fact ever
exists to filter on.

**And withholding the columns made the screen lie.** Six paths in
`automation.js` read nothing afterwards and four of them told the dealership
that none of its workflows records a cadence and that entering one would turn
the panel on. Fixed the same day by `triggerReadable()`, which tests key
**presence** rather than truthiness, so "the column was withheld", "the register
recorded nothing" and "the view returned nothing" stay three different findings
and the panel relights by itself if a scoped view ever restores the columns.
**A withheld fact must never be rendered as an absent one** — that is the same
rule as `NOT_COMPUTABLE`, applied to the vendor boundary.

The original measurement, 4 September 2026:

```
workflow_registry_read | PERMISSIVE | {authenticated} | SELECT | qual: true
```

The table has **no `tenant_id` column** (`id, name, audit_name, trigger_type,
trigger_detail, category, is_active, description, writes_audit_log,
audit_aliases`) and holds **18 rows**. Every signed-in user of every dealership
reads all of it.

What that row set is: the real n8n workflow ids, the human names, the trigger
type and detail — **including cron expressions and webhook paths** — and the
`is_active` flag. That is which automations the platform runs, on what schedule,
at what address, and which are switched off. It is operational configuration,
not shipped vocabulary.

CLAUDE.md already records this as deliberately-left-failing: `QUALITY_GATE.mjs`
check **L2** is red on exactly this row, and `workflow_registry` is excluded
from `L2_EXEMPT_TABLES` so the finding stays visible. This document does not
re-litigate that; it names the destination. **`workflow_registry` is a control-
plane table.** The dealership needs a *view* over it filtered to their tenant
and stripped of `id`, `trigger_detail` and anything else in Part 4 — not the
table.

Consumers to change when it moves: `screens/ask.js:1444`, `screens/ask.js:1611`,
`screens/automation.js` (via `v_workflow_health`), `screens/settings.js:756`.

## 5.3 Infrastructure topology is printed in full on Settings — CLOSED

**Closed 5 September 2026.** The Environment card became a three-row
**Connection** card — `NEXUS data`, `Automation`, `Credentials`, each
`configured` or a red not-configured line. The *consequence* of a missing value
survives; the variable name and the value do not. The endpoint chip list became
a count and a sentence: *"Their addresses are not shown: where an automation
lives is NEXUS's operational configuration."*

The original finding:

`apps/executive-dashboard/screens/settings.js:596-601`:

```
<dt>Supabase project</dt><dd class="mono">${projectRef}</dd>
<dt>Supabase URL</dt><dd class="mono">${SUPABASE_URL}</dd>
<dt>n8n base</dt><dd class="mono">${N8N_BASE}</dd>
<dt>Build mode</dt><dd class="mono">${mode}</dd>
```

`screens/settings.js:644-646` then prints every webhook endpoint as a full URL
chip:

```
${hooks.map(p => `<span class="chip mono">${esc(N8N_BASE)}/webhook/${esc(p)}</span>`)}
```

The screen's own header comment (`settings.js:5-16`) is candid about who this is
for: *"Which Supabase project and which n8n instance is THIS bundle talking
to?"* — that is an on-call engineer's question, and the on-call engineer is Ali.

The defence written at `settings.js:649` and in the banner above it is that the
paths are compiled into a public bundle and so reveal nothing further. **That is
true and it is not the point.** The bundle is public but nobody reads it; a
dashboard panel is read. The panel takes a fact that is technically discoverable
and *presents* it — and presentation is what turns "discoverable" into "known".
Note also what the same panel gets exactly right and must keep: no key is
rendered, in full or masked, and the reasoning at `settings.js:18-21` is the
correct standard for the control plane too.

**Verdict:** the whole Environment card and the endpoint chip list are
control-plane diagnostics. On the dealership's Settings, replace with a
connection state — connected / degraded / down — and nothing else.

## 5.4 The dealership's Automation screen is a vendor operations console — CLOSED

**Closed 5 September 2026.** `EXEC_URL_RE` now **removes** the execution URL
from a summary rather than rendering it as a working deep link into the vendor's
n8n (`dealerSummary`, `automation.js:200`); a disabled **Inspect this run**
control replaces the link. Trigger chips are gone with 5.2. The
nip.io / Google-OAuth / `vercel.app` explanation is gone from both places it
appeared. *"spends OpenRouter tokens"* became *"a question to answer"*.
`VITE_N8N_BASE_URL` became *"That is a NEXUS-side setting."*

The original finding:

`apps/executive-dashboard/screens/automation.js`:

- **`:139-151` and `:2124`** — parses the n8n execution URL out of the audit
  summary and renders it as a working deep link into Ali's n8n. The example in
  the comment is verbatim what a dealership user can see:
  `… · Failed at node: Model Ladder · Execution 3213 · https://…/workflow/BiyHk9ZXxJUVGbf6/executions/3213`.
  That is a node name, an execution id, a workflow id and a host, all four in
  Part 4's table.
- **`:1485`** — renders `w.trigger_type` and `w.trigger_detail` as a chip on
  every workflow row: cron expressions and webhook paths, straight from the
  unscoped registry.
- **`:281-305`** — a long, correct, and entirely vendor-facing explanation that
  three of the workflows are NEXUS's public home/privacy/terms pages, served
  over `nip.io` because Google rejects `vercel.app` as a public suffix.
- **`:424`** — tells the dealership that calling `ask-ai` *"spends OpenRouter
  tokens"*, naming the model provider and implying the cost model.
- **`:441-442`** — surfaces the `VITE_N8N_BASE_URL` variable name to the user.

The screen is excellent work. `automation.js:1-115` is one of the better pieces
of reasoning in this repo, and the health semantics it enforces are exactly what
Part 3.5 wants. **The problem is only who it is pointed at.** Almost all of it
should be lifted to Ali's dashboard, and the dealership should be left with a
much smaller screen: which automations are running for me, are they working,
what is the business impact when they are not, and who do I contact.

## 5.5 The vendor's third-party stack is listed by name — CLOSED for the chip list, OPEN elsewhere

**The chip list is closed, 5 September 2026**: the supplier names became
capability names — `Finance calculations`, `WhatsApp messaging`, `CRM sync`,
`Team notifications`, `Email delivery`, `AI answers`. The *probed* tiles were
named after suppliers too, which this section's unprobed-only list did not
catch; they were renamed with it.

**Still open, and it is the largest remaining leak of this class.** `WAHA` is
named to the dealership in `screens/conversations.js` — 6 occurrences when the
5 September pass counted them, 7 when this section was re-measured a few hours
later — and `Bitrix24` in `screens/customers.js`. These files are being edited
concurrently by other agents, so **count them rather than quoting this line**:
`grep -c WAHA screens/conversations.js`. `screens/finance.js` named Bitrix in
the 5 September pass and no longer does. In `conversations.js` the
names are load-bearing inside long identity-resolution explanations, and
rewriting them safely means understanding that screen's identity model. It was
not attempted, and it is exactly the harm this section describes — *"can
discover from one search that their WhatsApp is running through an unofficial
client"*. Two further items were left with reasons: internal table and view
names across roughly twenty screens, which needs a vocabulary decision first,
and `app.js`'s boot card naming the hosting provider and the environment
variables.

The original finding:

`apps/executive-dashboard/lib/integrations.js:134`:

```js
const unprobed = ['Finance Calc', 'WhatsApp (WAHA)', 'Bitrix24', 'Slack', 'Gmail', 'OpenRouter'];
```

Rendered as chips under "Not probed from the browser" on **both**
`screens/settings.js` and `screens/automation.js` (both call
`renderIntegrations`). This is the vendor's supplier list: the unofficial
WhatsApp client, the CRM, the model gateway. A dealership reading "WAHA" and
"OpenRouter" can price the stack, and — more immediately — can discover from
one search that their WhatsApp is running through an unofficial client, which
is a conversation `commercial/PILOT-OFFER.md` intends to have deliberately and
on Ali's terms.

`lib/integrations.js:150` compounds it: the Ask AI tile is captioned *"Runs a
real query — spends tokens and logs a run"*, exposing the vendor's cost model
in the dealership's UI.

## 5.6 Model behaviour is described to the dealership — CLOSED

**Closed 5 September 2026**, and closed the way this section asked: the
dealership still learns how much to trust the answer, and no longer learns the
mechanism. The model name is gone from the meta line, *"backup ladder"* became
*"this screen cannot confirm the answer came from the intended path — judge it
on the grounding above, which is checked rather than claimed"*, and *"no model
tier having answered at all"* became *"nothing having answered at all"*.

The original finding:

`apps/executive-dashboard/screens/ask.js:750` renders, under every answer:

> *"The reply names {model} … but carries no marker saying whether the primary
> tier answered or the workflow had already dropped to its **backup ladder**, so
> a silent fallback is not visible from here."*

And `ask.js:1113` renders `'no model tier having answered at all'`.

The *epistemics* here are right — the screen refuses to guess which tier
answered, which is the correct refusal. But the sentence discloses that a
fallback ladder exists and names the model that replied. Combined with
`ask.js:637` ("8000-character prompt budget"), a dealership learns the retrieval
budget and the failover architecture.

**Verdict:** the dealership needs to know **how much to trust this answer** —
grounded, partly grounded, ungrounded — which the screen computes beautifully.
It does not need to know the mechanism that produced that state. Model names,
tier structure and prompt budgets move to Ali's side.

## 5.7 Credential state and the vendor's operational history — CLOSED, split as proposed

**Closed 5 September 2026**, and it is worth noting *how*, because this section
called the split correctly. The dealership's half was already right and was left
untouched — *"Email delivery is broken right now — every 'Enrolled' row on this
screen means queued, not delivered"*. The vendor's half — the verbatim n8n error
naming the credential — became *"The connection this campaign sends email
through is not working, and NEXUS is the only one who can restore it. What broke
it, and where it is fixed, is on NEXUS's side."*

The original finding:

`screens/campaigns.js:1094`, `:1162`, `:1671` and the surrounding panel render
the Gmail OAuth2 credential's failure history in the dealership's words —
including the verbatim n8n error text, the credential's *name*, and the
inference that "every 'sent' is false".

This one is **genuinely split**, and it is the clearest illustration of the
boundary rule:

- *Theirs:* "Your drip campaign has not sent any email since 23 August. Nothing
  reached a customer. We are on it." — a real business impact on their
  customers, which they are entitled to and would be badly served by not
  having.
- *Ali's:* the credential is named `Gmail OAuth2 API`, it returned
  `invalid_grant`, it is reconnected in the n8n UI under Credentials, and the
  same credential serves N other tenants.

## 5.8 Smaller items, same class — CLOSED, except one left deliberately

**Closed 5 September 2026:** the n8n repair runbook in the Reconnect tooltip;
the raw `audit_log.summary` in the Automation run drawer, the activity-log
Summary cell and its search box, all three now through `dealerSummary()`; and
`team.js`'s `NO_INVITE`, which had listed **every deployed webhook path** plus
the table and its RLS posture, now *"Inviting somebody is not built yet. Ask
NEXUS to add the account and it will appear here."* The controls stay rendered
and disabled, per Part 4 and gate check `R7`.

**Worse than anything this section listed, and found by rendering rather than
reading:** `compliance.js` printed raw `audit_log.summary` **verbatim in two
places**, and the harness rendered a node name, an execution id, a workflow id, a
host and the VM's bare public IP onto a dealership screen. `campaigns.js:2074`
did the same. Both are closed.

**Left deliberately, and the disagreement is recorded rather than resolved
silently:** `settings.js:1091` and `:1400`. This section calls "which of our
workflows are not instrumented" Ali's backlog. The 5 September pass rewrote the
vendor-ish half and kept the finding, on the grounds that a dealership reading
*"this figure could not be read, so its absence means nothing"* is being
protected from a false zero, which is this project's first rule. Two rules meet
here and the boundary rule does not automatically win.

`lib/tenant.js:49` was read and left exactly as it is, for the reason the table
below gives.

The original findings:

| File:line | What leaks |
|---|---|
| `screens/settings.js:112-113`, rendered at `:1612` and `:1629` | Names the vendor's repair runbook to the customer — *"Reconnecting a credential is done in the n8n UI under Credentials … its API key must not ship inside this bundle"* — as the tooltip on a disabled Reconnect button. |
| `screens/settings.js:1091`, `:1400` | Renders `audit_log` read failures and instrumentation gaps as findings to the dealership; "which of our workflows are not instrumented" is Ali's backlog. |
| `screens/settings.js:649` | Rendered text narrates the platform's own historical defect to the customer — that a health probe *"came to manufacture most of that workflow's logged runs before that probe was removed on 31 Aug"* — and names `ask-ai` as spending *"OpenRouter tokens"*. Correct engineering candour, wrong audience. |
| `screens/automation.js:2145` | The run drawer prints raw `audit_log.summary` verbatim, which is where node names and execution URLs live. |
| `screens/team.js:195-198`, rendered as button tooltips at `:1225`, `:1645-1646` | Explains that `users` is service-role-only and that no invite endpoint exists — an unbuilt-feature disclosure in the dealership's UI. |
| `lib/tenant.js:49` (`TENANT_PATH`) | Reads `tenants?select=id,name,slug,status` unfiltered. **Currently safe** — verified 4 Sep: `tenants_member_read` scopes SELECT to `nexus_current_tenant_ids()`. Recorded here because the safety is entirely the policy's, and the request shape is the one that would leak a dealership list the moment that policy changes. |

## 5.9 What the audit did *not* find, and should be said — still holds

*Re-checked 5 September 2026 by the frontend pass: all four negatives still hold
as far as that pass could see. One of them changed shape — `policy_platform_attestation`
was found on 4 September to be readable by every signed-in user through ten
column-level grants that a `relacl`-only sweep could not see, and was revoked
rather than viewed. "No other dealership's data is reachable" survived; "no
control-plane row is readable" was never claimed and would have been false.*


- **No other dealership's data is reachable.** `tenants` and `tenant_members`
  are RLS-scoped correctly (verified 4 Sep). The tenant pill in
  `lib/nav.js` names only the caller's own dealership, and `lib/tenant.js`
  refuses to render a screen for a member of no dealership rather than drawing
  zeros — which is the right call and is the rule Part 3.2 borrows.
- **No secret is rendered anywhere**, masked or otherwise, and
  `screens/settings.js:18-21` states that as a rule the screen holds itself to.
- **No NEXUS revenue, pricing or margin figure appears on any screen.**
- **No cross-dealership benchmark exists**, because there is one dealership.

So the boundary problem in the current build is **not** a data-isolation
failure. It is that a dashboard built for one dealership, by the person who also
operates the platform, has accumulated the operator's own instrumentation.
Every finding above is a screen that answers Ali's question inside the
customer's product.

---

# Part 6 — Metrics that must never be conflated

Four words that mean four different things, and merging any two produces a
number that cannot be acted on.

| Metric | Definition | Observable in | The mistake it prevents |
|---|---|---|---|
| **Download** | The marketplace served the package | All shapes | Counting downloads as customers. A download is a click. |
| **Activation** | The software ran and validated a licence at least once | All shapes (once) | Counting activations as usage. An activation is a first boot, not a habit. |
| **Active dealership** | The installation produced usage events in the last N days | **Cloud/Managed only** | Counting paying as active. A paying tenant that has not opened a screen in 30 days is churn that has not been processed. |
| **Paying subscription** | The payment processor says the subscription is in good standing | All shapes | Counting active as paying. An active tenant whose card failed is revenue about to disappear. |

The two cross-products are where the money is:

- **Paying and not active** — churn in progress. Highest-priority outreach list.
- **Active and not paying** — either a trial doing well (convert it) or a
  licence problem (fix it). Both are urgent, in opposite directions.

**And the rule that makes the table honest:** for a Self-Hosted tenant, "active"
is **not measurable**, and must render as unknown. Not zero, not inactive.
`lib/health.js` already has the right grey for this and the right sentence:
*"This workflow does not write to the audit log, so its health is unknown — not
good."* The same word, for the same reason.

## 6.2 The health model

States mean something operationally or they are decoration. Six, and only one
of them is green:

| State | Definition | What Ali does |
|---|---|---|
| `HEALTHY` | Integrations connected, workflows within tolerance, activity within the tenant's own baseline | Nothing |
| `DEGRADED` | Something is failing but the dealership can still work — one workflow down, one integration flapping | Fix it this week; tell them before they notice |
| `IMPAIRED` | A capability the dealership paid for is not delivering — WhatsApp down, no messages leaving | Call them today |
| `SILENT` | Cloud tenant, no activity in N days, nothing failing | Call them. Nothing is broken and nobody is using it, which is worse |
| `UNREACHABLE` | Cloud tenant, no heartbeat. The platform cannot see the installation | Page yourself. This is an outage |
| `UNKNOWN` | Self-hosted, or telemetry declined, or the tenant is too new to have a baseline | Nothing automatic. Do not infer |

Three notes, each earned by something in this repo:

1. **`SILENT` and `UNKNOWN` must never share a colour with `HEALTHY`.** This is
   `NOT_INSTRUMENTED` sorting above `HEALTHY` in `screens/automation.js:176-179`,
   generalised: an unmeasured tenant is a worse position than a measured clean
   one, even though it cannot be coloured red.
2. **`IMPAIRED` is not `DEGRADED`.** The distinction is whether the dealership's
   customers are affected. It is the same distinction `lib/health.js` draws
   between `PARTIAL` and `FAILURE`, and it is the one that decides whether Ali
   calls today or Friday.
3. **A state is computed from evidence and names it.** A tenant card that says
   `IMPAIRED` must be able to say why, from a row, the way
   `screens/overview.js:463-500` does for workflows. A health state with no
   evidence behind it is the "figure with no evidence" PRODUCT.md forbids,
   wearing a colour instead of a currency symbol.

---

# Part 7 — What to build first, and what waits

**Item 1 is mostly done. Items 2–5 do not exist.** Not a table, not a screen,
not a licence service, not an event collector — re-measured 5 September 2026
against production: **zero control-plane objects.** The state of the world is
one dealership, one user, and a dashboard that is no longer doing quite so much
double duty as Ali's operations console.

## Build first

1. **Move the boundary in the existing dashboard.** ***Frontend half done
   5 September 2026; the database half done 6 September 2026.*** Taken in the
   order this item listed them:
   - `workflow_registry` `tenant_id` and a scoped policy — **DONE 6 Sep 2026,
     and deliberately NOT with a `tenant_id`.** The whole table is off the
     dealer plane: no grant, no `authenticated` policy, every read `42501`, and
     the dealer-safe naming projection served by
     `public.nexus_workflow_catalogue()`. `L2` passes. See 5.2 for why a
     `tenant_id` on a vendor register would have been an invented mapping.
   - the Environment card and endpoint chips (`settings.js:596-646`) — **done**,
     replaced by a three-row Connection card and a count.
   - `settings.js:1402` — **done**, and the same sentence was found and removed
     from a second screen.
   - `N8N_BASE`, node names and execution URLs — **done**, including two raw
     `audit_log.summary` renders on Compliance and one on Campaigns that this
     document did not predict, which between them put a node name, an execution
     id, a workflow id, a host and the VM's bare public IP onto a dealership
     screen.
   - the `unprobed` supplier chips (`lib/integrations.js:134`) — **done**, and
     the probed tiles with them.

   **What remains of item 1**, and it should be scheduled rather than
   rediscovered: `WAHA` and `Bitrix24`
   still named to the dealership in `conversations.js`, `finance.js` and
   `customers.js`; internal table and view names across roughly twenty screens,
   which needs a vocabulary decision before a rewrite; and `app.js`'s boot card.
   Evidence and reasons:
   `ops/evidence/control-plane-frontend-evidence.md` §2d.
2. **The tenant registry and subscription state.** A separate Supabase project,
   one row per dealership, one row per subscription, wired to whatever payment
   processor the marketplace uses. This alone answers "who is paying" and "who
   is `past_due`", which is most of the commercial value, and it needs no
   telemetry at all.
3. **The licence service and the activation record.** One endpoint, one table.
   This is the only self-hosted signal that will ever be reliable, and it is
   what turns "downloads" into "installations" — the single most valuable
   distinction in Part 6.
4. **The usage event collector, for Cloud only.** A narrow schema, counts and
   identifiers, no content. Start with: screen opened, action executed, message
   sent, lead created, sale recorded. That is enough for module adoption and
   funnel stages 5-9, which is enough to make the tenant command centre real.
5. **The alert stream** (Part 3.9), built on 2-4. Integration disconnected,
   workflow degraded, activity cliff, payment failed. This is the panel that
   changes Ali's week.

## Can wait

- **Node-level telemetry aggregation.** The data already exists in `audit_log`
  and the deep links already parse. Reading it out of one tenant's database by
  hand is tolerable at one, two or five dealerships. Automate at ten.
- **Release management and version tracking.** Meaningless with one deployment.
  Necessary the first time two tenants are on different versions.
- **The support-case system.** Ali is currently support, and a shared inbox is a
  support-case system for the first several customers. The *audited access
  path* (Part 2.4) matters earlier than the case tracker does — build the
  access record before the ticket queue.
- **The acquisition funnel above stage 4.** Stages 1-4 come free from the
  marketplace and the licence service. Stages 5-10 need the collector and are
  worthless below a handful of tenants, because a funnel over three customers
  is anecdote with a chart on it.
- **Self-hosted opt-in telemetry.** Design it when the first self-hosted
  customer exists, with them, rather than guessing what they will permit.
- **Anything cross-tenant and comparative** — benchmarks, cohort analysis,
  "dealerships like yours". PRODUCT.md's ruling stands: it is a moat that only
  exists after customers do.

## What must not be built

- **A support console that reads customer data by default.** Every version of
  this starts as a convenience and ends as the thing that loses an enterprise
  deal. Build the audited grant first; build the console, if at all, on top of
  it.
- **Control-plane tables inside `dsvuoovivysszdoiorch`.** Part 2.3.
- **Anything that renders a self-hosted unknown as a number.** Part 1.

---

*Cross-references: `PRODUCT.md` (estimated / attributed / confirmed; the
evidence rule; benchmarking sequencing), `CLAUDE.md` (`workflow_registry` and
gate check L2; the `anon`/`authenticated` default-grant check and its blindness
to column-level ACLs; the open WhatsApp webhook), `ARCHITECTURE.md` (the stack
as measured; the staff role model that replaced "no role check in the database
or the UI" on 5 September), `STATUS-2026-09-05.md` (what closed and what did
not), `VERSIONS.md` (the control plane is V4, and V4 is unstarted),
`commercial/DEMO-SCRIPT.md` (the DO NOT SHOW list, which is Part 4 applied to a
sales meeting).*
