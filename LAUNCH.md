# NEXUS Launch Week

Decided 4 September 2026; **Track A re-measured 5 September 2026**.
`ROADMAP.md` holds the market position and the long route; `VERSIONS.md` maps
this launch story onto V1–V4 with a measured status per capability; this file
holds what ships now, what does not, and the two tracks that run at the same
time.

**None of the six thin additions below exists yet.** They are the launch plan,
not the launch. Everything in "The thin additions" is V2 in `VERSIONS.md` and
none of it is implemented.

## The reframing

The goal is not fifteen new modules. It is: **harden what exists, add five to
seven thin capabilities that connect data NEXUS already holds, and launch as a
Dealer Revenue Recovery OS.**

The governing rule is **maximum high-value problems per unit of engineering
effort.** A service-overdue detector takes one to three days and exposes a real
revenue opportunity. A service ERP takes three months and competes with vendors
who already sell one.

## The five revenue-control loops

This is the launch story. "Mostly built already" was the 4 September framing;
measured against the branch on 5 September it holds for two of the five.

| Loop | The dealer's problem | Where it actually is |
|---|---|---|
| **Lead Recovery** | An enquiry arrived, somebody replied late, the customer went elsewhere | Screen ships and draws real rows; queue = 0 because there are 3 leads. The silence detector it depends on last succeeded 26 Aug |
| **Stock Recovery** | A car has been standing 30, 60, 90, 150 days | Ships, on 12 of 12 units with real cost and days in stock. The strongest thing in the product |
| **Deal Recovery** | A hot buyer is stuck behind a finance blocker or a missing document | Screen ships and is **structurally empty by design** — no deal record exists before a sale closes. Demo the refusal, not the engine |
| **Marketing Recovery** | The dealer has stock and does not know which vehicle to push | **Not built.** The drip campaign it would ride on has 8 runs and 8 failures |
| **Customer Recovery** | Someone enquired and never bought, or bought and was forgotten | **Not built.** Customer 360 is a once-daily batch with 2 profiles on file |

## The thin additions

Not systems. Intelligence layers over data that is already there.

**Pricing Advisor** — not a valuation engine. Acquisition cost, current price,
days in stock, enquiry count, margin, comparable data where it exists → `HOLD`,
`WATCH`, `REPRICE`, `MANAGER REVIEW`. Every recommendation carries evidence,
confidence, and what is missing.

**Buy or Don't Buy Advisor** — an offline decision tool, no auction
integrations. Acquisition price, expected retail, estimated recon, expected
holding days, target margin → `BUY`, `NEGOTIATE`, `WALK AWAY`,
`MANAGER REVIEW`. This moves NEXUS upstream from *"I own this, what now"* to
*"should I own this"*, which is a much larger economic loop.

**Trade-In Desk** — a valuation **workflow**, not a valuation. Capture vehicle,
mileage, condition, service and accident history, photos, inspection, expected
recon → `INSUFFICIENT EVIDENCE`, or a `PRELIMINARY RANGE`, or
`APPROVAL REQUIRED`. Refusing to price a car NEXUS cannot evidence is the
feature, not a limitation of it.

**Marketplace Performance Sentinel** — read imported marketplace reports; do
**not** build a publisher. Per vehicle: views, leads, price, days listed,
lead-to-view ratio → *"exposure but no demand"*, *"enquiries but no
conversion"*, *"ageing without lead activity"*.

**Service Revenue Recovery** — last service, mileage, age, warranty expiry,
next due, last contact → `DUE`, `OVERDUE`, `AT RISK`, and a recovery action.
Nothing else. This is not workshop software.

**Stock-to-lead matching** — a buyer says "AED 150K, family SUV" and NEXUS
names candidates. Every competitor has inventory-aware AI, so the match alone
is table stakes. NEXUS differentiates by naming the **economic consequence**:
*"Vehicle A fits the buyer and is 147 days old. Vehicle B fits similarly and is
42 days old. Recommend B."*

## The screen that is the product

**Today's Money Leaks** — the primary owner view. Not "AI Insights", not
"Analytics", not "AI Assistant". **Built 6 September 2026** (`710817a`) and now
the default landing screen — but on `wip/platform-truth-2026-09-01` only, and
that branch is not deployed, so it is not yet on any site a buyer can open. The
AED figure it opens with states its own derivation on the screen — the sum of
`engine_impact_aed` over the first register, one impact kind, one engine, two
stored columns — and it is never called revenue. Measured on Tenant A's real data
when it was built: **2 leaks · AED 66,000 gross margin exposed · 8 checks clear ·
9 checks that could not run.**

> AED X exposed today.
> Five leads have no response. Two hot leads have finance blockers. Three
> vehicles are ageing. One vehicle has pricing risk. Four customers need
> follow-up.

Every item: **WHY → EVIDENCE → ACTION → APPROVE → RESULT.**

A dealer understands that in thirty seconds, and it is not a feature-by-feature
comparison with anybody.

## What must stay explicitly unsupported

Saying these plainly is what makes the rest credible. UAE vendors already sell
full DMS and workshop systems — one advertises DMS projects from AED 120K–250K
and service/parts systems from AED 50K. Do not fight them head-on.

RTA automation · vehicle registration · insurance transactions · full lender
submission · workshop management · parts ERP · bodyshop ERP · marketplace
publishing · automated trade-in valuation without evidence · acquisition
pricing without reliable market data.

## Pricing, with real benchmarks

| | |
|---|---|
| Funoon (AI WhatsApp lead management, UAE) | AED 499 / 999 / 1,999 per month |
| Repluno (website, unified inbox, leads, proformas) | $199 / $900 / $2,900 per month |
| Mawrid360 (AI dealer cockpit) | demo/pilot, no public monthly price |

AED 2,500–3,500 is defensible — **but not for another WhatsApp bot.** At that
price NEXUS has to be sold as revenue recovery, stock profit control and a
management action system, priced on dealership size, inventory, users and
integrations rather than on AI conversation count.

## The two tracks

They run at the same time and **neither waits for the other.**

**Track A — make it safe.** Measured 5 September 2026, in the order it was
written:

| step | status |
|---|---|
| Consent identity P0 | **closed** 4 Sep |
| The anonymous object-creation path | **closed** 4 Sep at the schema door; `authenticated` still reaches born-open objects and that needs Supabase |
| The idempotency family | **closed at the database** 5 Sep; **the n8n writers are not deployed**, and `communication_logs` still has no writer for its identity |
| The policy foreign key and the delivery-events key | **closed** 5 Sep, with eight composite tenant/carrier foreign keys |
| The stale gate snapshot | **closed** 5 Sep |
| Staging parity | achieved 4 Sep, **re-measured and holding 6 Sep 00:0x UTC** — columns 1731, constraints 374, functions 269, indexes 169, policies 163, tables 59, views 39, triggers 19, identical on both projects. Function *bodies* were not compared. **And staging is a worse rehearsal than it looks**: six platform reference tables are empty there, so Deal Rescue cannot be walked on it at all |
| Full security regression | **not run** since 3 Sep |

Still standing between here and switching WhatsApp on: the open inbound webhook
and its WAHA gate, which as of 8 Sep 2026 is in MONITOR and reads
`header_present: true, ok: false` on the box's own traffic — the box is in queue
mode, so the Code node comparing the secret runs in `n8n-worker` and
`docker compose up -d n8n` recreates the wrong container. Enforcing against that
drops every real customer message, so the gate is still not armable.

Then the second sender `2.50.10.149`, **identified as Ali's own WhatsApp account
on device 8, an older WAHA on his Windows desktop `desktop-l3an0ma` in Docker
Desktop — the PC that used to host n8n behind
`https://desktop-l3an0ma.tail2141f7.ts.net`**. **It had not stopped**: execution
11103 on production at 06:07:40 UTC on 8 September posted `session.status` from
that address with no secret header, two days after this repo recorded it gone.
Its `nexus-os` compose project (`n8n`, `n8n-db`, `waha`) was **stopped by hand at
06:08:24 UTC**, which reads **identified, and stopped by hand on 8 Sep 2026 — not
yet permanently removed (`restart: always` still declared, device 8 still
linked)**. Then the Meta attestation (13 rules, 0 verified, 0 attestations,
re-measured 6 Sep); the unpublished Infra Health Probe; and the n8n writer
changes above. No shortcuts. **WhatsApp does not switch on until those are
done.** `STATUS-2026-09-06.md` is the current list and `OWNER-ACTIONS.md` is
the ordered set of steps.

**Track B — make it sellable.** Three to five UAE dealers. Show the real Profit
Sentinel on Tenant A's own honest data and Today's Money Leaks. Ask **what they
would pay**, and what the one missing capability is.

Never ask *"what features would you like"* — that is how a product becomes an
ERP.

**Track B does not depend on Track A.** The demo is read-only: it needs no
WhatsApp, no consent fix, no Meta attestation. So the dealer conversations
happen this week regardless of where the engineering stands, and what those
dealers say reorders everything below them.

**Track B has produced nothing measurable yet.** Zero dealer conversations are
recorded anywhere in this repository, and there are zero paying customers. Until
one of those numbers moves, every price and every unbuilt capability in this
file is a hypothesis.

## The agent structure

36 specialist roles; **~12–18 actively coding at any moment.** More than that
and coordination overhead outweighs the parallelism.

| Area | Agents |
|---|---|
| Architecture and orchestration | 4 |
| Backend and data | 8 |
| AI and intelligence | 5 |
| Integrations and n8n | 6 |
| Dealer frontend | 5 |
| Dealer's-customer frontend | 3 |
| Control plane | 2 |
| QA, security, release | 3 |

Three levels, and the middle one is what keeps agent output honest:
**Builder → Reviewer → Gatekeeper.** Every agent gets bounded file ownership.
Waves, not a free-for-all. And still **one agent at a time on the n8n box** —
parallel writes have crashed that VM twice.

## Four surfaces, separated from now on

1. **NEXUS Control Center** — Ali's. Tenants, subscriptions, usage, health,
   releases, security.
2. **Dealer OS** — the dealership's. Revenue, leads, stock, deals, customers,
   actions.
3. **Dealer Customer Experience** — the dealership's customer. Vehicle →
   enquiry → conversation → appointment. Keep this small for launch.
4. **Integration and automation plane** — not user-visible. n8n, webhooks,
   event processing, provider adapters, AI orchestration. Do not couple it to
   the frontend.
