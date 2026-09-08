# Frontend honesty audit — every screen against production, 8 September 2026

What this is: a read of all 22 screens in `apps/executive-dashboard/screens/` and the
shared helpers in `apps/executive-dashboard/lib/`, checked against what production
`dsvuoovivysszdoiorch` returns **today**, looking for one defect class — a screen
rendering an unknown as a fact.

Nothing here was changed. Every fix is proposed, none applied. Supabase was read only.

## Method, and what it can and cannot support

Every figure below was produced twice: once by reading the code that renders it, and
once by running the query behind it on production. Where the two disagree, the
production run is the finding. Where the code is right and the data makes it absurd,
that is also a finding, and it is the more common of the two — this codebase has been
through several honesty passes and most of the screens are careful. What remains is
mostly the gap between a screen that is honest about its own arithmetic and a screen
that is honest about **what the arithmetic is of**.

Three cautions on the evidence:

- **All of it is one tenant.** Production holds one active dealership
  (`fff6a2b5-cfd5-4460-8383-875bc5826de0`) plus a quarantine tenant. Nothing below
  says what a second dealership would see.
- **The reads are `authenticated`.** `lib/data.js:261` sends
  `Authorization: Bearer <session access_token>` on every `db()` call, falling back to
  the anon key when there is no session. So every screen reads as the signed-in
  dealership user under RLS. Nine of the RPCs the screens call are SECURITY DEFINER
  (`action_approver_context`, `nexus_lead_attribution`, `nexus_lead_source_readiness`,
  `nexus_team_roster`, `nexus_team_pending`, `nexus_whatsapp_consent_current`,
  `nexus_whatsapp_consent_events`, `nexus_workflow_catalogue`); two are not
  (`nexus_lead_attribution_summary`, `sentinel_inventory_actions`). Every view in
  `public` carries `security_invoker`.
- **My queries ran as the service role**, not as a dealership user. Row counts are
  therefore the true counts, and a dealership under RLS could see fewer. On a
  one-tenant database they coincide, but the distinction is real and is listed under
  Unknowns.

## The database a dealership is looking at today

Measured 8 September 2026, ~19:00 UTC.

| Table | Rows | Table | Rows |
|---|---|---|---|
| `audit_log` | 889 | `leads` | **5** |
| `communication_logs` | **142** | `customer_360_profiles` | 4 |
| `processed_messages` | 41 | `inventory_actions` | 3 |
| `competitors` | 22 | `kyc_documents` | 3 (all voided) |
| `daily_metrics` | 20 (newest 2026-09-07) | `channel_registry` | 2 |
| `workflow_registry` | 18 | `deals_embeddings` | 1 |
| `rag_documents` | 15 | `lead_event` | **1** |
| `whatsapp_contacts` | 14 | `purchase_history` | **1** |
| `policy_rule` | 13 | `users` | 1 |
| `inventory` | 12 | `tenant_members` | 1 |
| `lead_source_catalogue` | 9 | `channel_message_events` | **0** |
| `lead_ingest_endpoint` | 5 | `finance_quotes` | **0** |
| | | `lead_recovery_actions` | **0** |
| | | `whatsapp_templates` | 0 |

There is **no `campaigns` table and no `campaign_enrollments` table.**
`lib/vocabulary.js:130-131` maps both names. `screens/campaigns.js` reads neither —
it synthesises a campaign view out of `leads`, `communication_logs` and `audit_log`,
and says so.

The five leads, in full, because most of the findings are about them:

| id | name | status | response_time_minutes | assigned | what it actually is |
|---|---|---|---|---|---|
| 34 | Siva Thangavelu | `DISQUALIFIED` | 1 | Ali Asgher | wrong number — asked about 30 mm end clamps (solar mounting hardware) |
| 35 | Effco Contracting llc | `DISQUALIFIED` | null | — | wrong number — a web-design contact |
| 38 | Ali | `WARM` | 4 | — | Lexus LX 600 enquiry from `+91 8517942172` — the owner's own test |
| 121 | Preflight Walk-In | `new` | null | — | `walkin-preflight-01@nexus-preflight.invalid` — a preflight probe |
| 122 | Hussain | `COLD` | 3 | — | *"I have been driving for 6-7 hours. Can you please adjust for a while?"* |

`budget_aed` is null on all five. Four statuses in three casings: `DISQUALIFIED`,
`WARM`, `COLD`, `new`. `lib/format.js:193-197` maps all four and `toneKey`
(`lib/format.js:206`) uppercases, so the lowercase `new` is handled everywhere I
checked — `screens/leads.js:935` filters on `up(l.status)`, `lib/pipeline.js:92`
tones through the same table. This is the one place the vocabulary register is
currently holding.

`v_lead_recovery_coverage` on the same data:

```
leads_total 5 · leads_open 3 · leads_closed 2 · leads_at_risk 0
leads_with_a_confirmed_sale 1 · confirmed_revenue_aed 585000
sales_attributed_to_a_recovery_action 0 · leads_with_no_owner 4
communication_log_rows 141 · message_events 137
message_events_resolved_to_a_lead 66 · identity_resolution_pct 48.2
unresolved_whatsapp_handles 10 · recovery_actions_total 0
```

**Over half of every message on file resolves to no lead.** That number is the
denominator behind several findings below.

## The deployed bundle

`apps/executive-dashboard/dist/index.html` references `main-CgKC2kaX.js`, built
2026-09-08 06:13. Every source file under `screens/` and `lib/` has an mtime earlier
than that build. I spot-checked distinctive string literals from
`screens/settings.js`, `screens/leads.js`, `screens/attribution.js`,
`screens/money-leaks.js`, `lib/vocabulary.js` and `lib/manual-lead-form.js` and found
each present in the bundle, along with the specific literals behind every finding
below (`"Above their page price"`, `"match never rated"`,
`"Within the 5-minute rule"`, `"Recorded purchase value"`,
`"Withdrawn: one priced deal is not an average"`, `"Confirmed recovery"`,
`"Revenue this product may call recovered"`).

**Source and bundle agree. Every finding below is live for a dealership today** —
subject to one caveat under Unknowns: I verified the bundle in this repo, not the
bytes being served from the deployment origin.

## What each screen reads

Every read is a PostgREST `GET /rest/v1/<path>` through `db()` in `lib/data.js:260`,
as `authenticated`. There is no `supabase-js` `.from()` anywhere in the screens.

| Screen | Reads |
|---|---|
| `actions.js` | `v_inventory_action_queue`, `rpc/action_approver_context`, `inventory_action_reason_codes`, `rpc/sentinel_inventory_actions`, `v_inventory_action_timeline` |
| `ask.js` | `v_needs_attention`, `v_workflow_health`, `audit_log`, `rpc/nexus_workflow_catalogue`, `rag_documents`, `leads` |
| `attribution.js` | `v_attribution_link_map`, `attribution_link_basis`, `v_attribution_sale_chain`, `v_attribution_lead_chain`, `rpc/nexus_lead_attribution_summary`, `v_attribution_edges`, `v_attribution_events` |
| `automation.js` | `v_workflow_health`, `audit_log`, `rpc/nexus_workflow_catalogue`, `leads` |
| `campaigns.js` | `v_needs_attention`, `v_workflow_health`, `v_conversations`, `leads`, `communication_logs`, `audit_log`, `rpc/nexus_workflow_catalogue` |
| `competitors.js` | `competitors`, `inventory`, `v_needs_attention`, `v_workflow_health`, `v_competitor_latest` |
| `compliance.js` | `kyc_documents`, `whatsapp_contacts`, `leads`, `audit_log`, `communication_logs`, `v_needs_attention`, `v_workflow_health`, `users`, `rpc/nexus_whatsapp_consent_events`, `rpc/nexus_whatsapp_consent_current` |
| `conversations.js` | `leads`, `v_conversations`, `v_workflow_health`, `v_needs_attention` |
| `customers.js` | `v_customer_directory`, `v_customer_360`, `customer_360_profiles`, `whatsapp_contacts`, `leads`, `purchase_history`, `rpc/nexus_workflow_catalogue`, `v_workflow_health`, `audit_log` |
| `deal-rescue.js` | `v_deal_rescue`, `v_deal_rescue_candidates`, `v_deal_rescue_readiness`, `v_deal_rescue_state_model` |
| `deals.js` | `purchase_history`, `deals_embeddings`, `leads`, `v_needs_attention`, `inventory`, `finance_quotes` |
| `finance.js` | `finance_quotes`, `leads`, `audit_log`, `v_needs_attention`, `inventory` |
| `inventory.js` | `rpc/sentinel_inventory_actions` (via `lib`), `inventory` |
| `lead-recovery.js` | `v_lead_recovery`, `v_lead_recovery_coverage`, `v_lead_recovery_state_model`, `v_lead_recovery_queue`, `v_lead_recovery_health` |
| `lead-sources.js` | `v_lead_origin`, `rpc/nexus_lead_source_readiness` |
| `leads.js` | `v_needs_attention`, `communication_logs`, `whatsapp_contacts`, `rpc/nexus_lead_attribution`, `leads`, `purchase_history`, `audit_log` |
| `money-leaks.js` | `rpc/sentinel_inventory_actions`, `v_inventory_action_queue`, `v_action_center_health`, `v_lead_recovery`, `v_lead_recovery_coverage`, `v_deal_rescue_readiness`, `v_needs_attention`, `v_workflow_health` |
| `overview.js` | `v_needs_attention`, `v_conversations`, `kyc_documents`, `v_workflow_health`, `competitors`, `v_inventory_action_queue`, `leads`, `daily_metrics`, `communication_logs`, `whatsapp_contacts`, `v_lead_recovery_coverage`, `v_deal_rescue` |
| `policy.js` | `v_policy_rule`, `v_policy_authoritative`, `v_policy_unmigrated_constant` |
| `revenue.js` | `v_inventory_profit_sentinel`, `v_action_center_health`, `v_inventory_action_queue`, `v_lead_recovery`, `v_lead_recovery_coverage`, `v_deal_rescue`, `v_deal_rescue_candidates`, `v_deal_rescue_readiness`, `v_policy_rule`, `v_policy_unmigrated_constant`, `v_attribution_sale_chain` |
| `settings.js` | `v_needs_attention`, `v_workflow_health`, `audit_log`, `rpc/nexus_workflow_catalogue`, `rag_documents` |
| `team.js` | `users`, `v_team_performance`, `leads`, `v_needs_attention`, `rpc/nexus_team_roster`, `rpc/nexus_team_pending` |
| `lib/badges.js` | `v_needs_attention` (nav badges, all screens) |
| `lib/lead-drawer.js` | `whatsapp_contacts`, `purchase_history`, `leads`, `users` |
| `lib/manual-lead-form.js` | `lead_source_catalogue` |
| `lib/unit-form.js` | `inventory_profit_settings` |
| `lib/integrations.js` | `leads` (connectivity probe only) |

## Findings, ranked by what they cost

Ranked money first, then operational, then cosmetic — as instructed.

---

### F1 · A repair test is rendered as a confirmed sale and a VIP customer on six screens

**Rank: worst. This is the one that loses a customer.**

**Where.**
`screens/customers.js:894`, `screens/customers.js:1667` and `:1680`,
`screens/deals.js:903` and `:919`, `screens/attribution.js:314`,
`screens/revenue.js:924`, `screens/lead-recovery.js:248`.

**What a dealership sees today.**

- Customers → *Recorded purchase value* **AED 585,000**, "Summed over 1 recorded
  purchase from 1 customer".
- Customers → the drawer for "Ali" carries a **VIP** pill, a **Buyer** pill and
  *Lifetime value* **AED 585,000**.
- Deals → *Deals closed* **1**, *Revenue* **AED 585,000**.
- Attribution → *Confirmed revenue on file* **AED 585,000**, toned `t-won`.
- Revenue Recovery → *Confirmed revenue* **AED 585,000**.
- Lead Recovery → *Confirmed sales on file* **1**.

**Live query and result.**

```sql
select * from purchase_history;
-- 1 row: customer_name 'Ali', email shabbir53ujjainwala@gmail.com,
--   phone +918517942172, vehicle 'Lexus LX 600 2024', amount_aed 585000,
--   purchase_date 2026-09-02, created_at 2026-09-02 09:59:53.189871+00,
--   deal_id 'auto:shabbir53ujjainwala@gmail.com|2026-09-02', lead_id 38
```

**What is actually true.** `ops/pilot-readiness/BLOCKERS.md:759`,
`commercial/WHAT-WE-CLAIM.md:171`, `commercial/PILOT-OFFER.md:145` and
`commercial/DEMO-SCRIPT.md:219` all record the same fact: `purchase_history` held
zero rows until 09:59:53 on 2 September 2026, when repair work wrote this one row
against **the owner's own test lead** — lead 38, still marked `WARM`, from an Indian
number. No dealership customer has bought a car through this system.

The screens cannot know that. **`purchase_history` has no provenance column at all** —
its columns are `id, customer_name, email, phone, vehicle, purchase_date, amount_aed,
created_at, deal_id, lead_id, tenant_id`. Neither does `leads`. The one table in the
database that carries `is_test_traffic` is `lead_event`, and it does not cover this
lead. So the six screens are each reading the strongest word the schema offers —
CONFIRMED — over a row nobody can mark.

This is exactly the distinction `CLAUDE.md` insists on
(`detected ≠ estimated ≠ attributed ≠ influenced ≠ confirmed ≠ recovered`) failing at
the far end: the word *confirmed* is correct about the column and wrong about the
world, and no screen has a branch that could say so.

`v_lead_recovery` is the one reader that gets the second half right — it reports
`recovery_attribution_state = SALE_WITHOUT_RECOVERY_ACTION` and
`recovered_value_aed = null`, with the basis *"This lead converted and NEXUS recovered
nothing… The sale is the dealership's, not the product's."* But its `state` column for
that lead is the literal word **`RECOVERED`**, and any screen that renders a state pill
prints it.

**Smallest correct fix.** Two parts, and only the first needs a migration.

1. Add `purchase_history.origin` (or reuse the shape of `lead_provenance_kind`), NOT
   NULL, defaulting to the value that means "not stated". Backfill this one row as a
   test.
2. Until that column exists, every money tile reading `purchase_history` states the
   row count **and** that provenance is not recorded — one shared sentence in
   `lib/vocabulary.js`, in the register beside `TEST_TRAFFIC_UNCLASSIFIED`, so the six
   call sites cannot drift. `screens/deals.js:924` already prints *"That is the whole
   of the recorded sales — 1 row, not a period's takings"* at `deals.length <= THIN`;
   that sentence needs one more clause and four more call sites.
3. Rename `v_lead_recovery.state`'s `RECOVERED` to `SALE_RECORDED`. The engine's own
   basis text says NEXUS recovered nothing; the state label says it recovered
   something. One of the two is wrong and it is the label.

**Live in the deployed bundle: yes.**

---

### F2 · The attention list publishes a price-drop conclusion the product itself grades unusable

**Rank: money. This one recommends dropping the price of the most expensive car on the
lot by AED 90,000 on evidence NEXUS describes as worthless.**

**Where.** `v_needs_attention`'s `undercut` branch (database);
`screens/competitors.js:2029`; `lib/badges.js:144`; `screens/overview.js:2846`.

**What a dealership sees today.** Three alerts, on the Competitors screen, in the
Overview attention list, and as a nav badge count of 3:

- **Lexus LX 600 2024** — *"drivearabia.com is AED 90,000 cheaper"*
- **Mitsubishi Pajero GLS 2023** — *"icartea.com is AED 30,000 cheaper"*
- **Toyota Fortuner 2.7 VXR 2024** — *"toyota.ae is AED 23,100 cheaper"*

**Live query and result.**

```sql
select kind, ref, title, detail, at from v_needs_attention where kind='undercut';
-- 39 | Mitsubishi Pajero GLS 2023 | icartea.com is AED 30,000 cheaper   | 2026-09-05
-- 36 | Toyota Fortuner 2.7 VXR 2024 | toyota.ae is AED 23,100 cheaper   | 2026-09-04
-- 34 | Lexus LX 600 2024 | drivearabia.com is AED 90,000 cheaper        | 2026-09-03

select match_quality, count(*) from competitors group by 1;
-- weak 9 · (null) 9 · model_only 4
```

The view's own definition, read live:

```sql
SELECT 'undercut', 'WARM', c.id::text, c.model,
       c.competitor || ' is AED ' || to_char(abs(c.price_diff_aed),'FM999,999') || ' cheaper',
       c.scraped_at, 'competitors'
FROM (SELECT DISTINCT ON (competitor, model) … , match_quality, match_note
      FROM competitors ORDER BY competitor, model, scraped_at DESC) c
WHERE c.price_diff_aed < 0
```

**It selects `match_quality` into the subquery and never uses it.**

**What is actually true.** The Lexus and Fortuner rows are `match_quality = 'weak'` and
the Pajero row is `model_only`. `screens/competitors.js:521-523` defines `weak` as
`concludes: false` and states the rule in prose: *"No gap, percentage or market
position is drawn from this row anywhere on this screen, because every one of them
would be a conclusion the page does not support."*

`v_inventory_profit_sentinel`, on the identical rows, agrees with the screen and not
with the alert:

```sql
select id, market_position, market_note from v_inventory_profit_sentinel where id='NX-1011';
-- NX-1011 | UNKNOWN_UNVERIFIED_COMPARABLE
-- "A competitor row exists (drivearabia.com at AED 495,000) but nothing ties that
--  price to this car - match quality weak. Their own note: 'Price came from the
--  language model asked for the lowest advertised figure, which cannot say what it
--  was for.' Shown as evidence only; no position is derived from it and no price
--  move is recommended because of it."
```

So one screen refuses to state a gap from that row, a second engine refuses to derive
a position from it and refuses to recommend a price move because of it, and a third
surface publishes it as a WARM alert with the figure in the headline.

`screens/competitors.js:2029` appends a correction to alerts raised on OEM domains,
echoed model strings and unrated rows:

```js
if (c && (c.isOem || c.echoed || c.unrated)) {
```

**`weak` is not in that list.** `drivearabia.com` is not an OEM host, so the Lexus
alert — the one carrying the AED 90,000 figure on the dealership's most expensive
unit — renders with **no correction at all**. The Fortuner alert gets only the
new-car-list-price note, because `toyota.ae` is an OEM; nothing tells the reader the
match itself is unusable.

**Smallest correct fix.**

1. Database: `WHERE c.price_diff_aed < 0 AND c.match_quality IS DISTINCT FROM 'weak'`.
   A weak row cannot support the sentence the view writes.
2. Frontend, independently, because the view is not this screen's to depend on:
   change `screens/competitors.js:2029` to
   `if (c && (c.isOem || c.echoed || c.unrated || !c.concludes))` and add the
   corresponding clause — the screen already has the words at `:522`.

**Live in the deployed bundle: yes.**

---

### F3 · "Above / Below their page price" concludes from matches nobody ever rated

**Rank: money.**

**Where.** `screens/competitors.js:531-533` (`unrated: { concludes: true }`),
`:519` (`model_only: { concludes: true }`), `:905` (`deltaPct`), `:1575-1577`,
`:1659`, `:1666`.

**What a dealership sees today.**

- *Above their page price* **1** — "Worst +AED 30,000 on Mitsubishi Pajero GLS 2023"
- *Below their page price* **2** — "Best −AED 334,000 on Range Rover Sport HSE 2023"
- In the table and the drawer, percentages: **30.6% above theirs** on the Pajero,
  **45.8% below theirs** on the Range Rover.

**Live query and result.**

```sql
select competitor, model, price_aed, match_quality, scraped_at from v_competitor_latest;
-- drivearabia.com   | Lexus LX 600 2024            | 495000 | weak       | 2026-09-03
-- icartea.com       | Mitsubishi Pajero GLS 2023   |  98000 | model_only | 2026-09-05
-- landrover-uae.com | Range Rover Sport HSE 2023   | 729000 | model_only | 2026-09-04
-- toyota.ae         | Toyota Corolla 2.0 XLI 2024  |  82900 | weak       | 2026-09-06
-- toyota.ae         | Toyota Fortuner 2.7 VXR 2024 | 128900 | weak       | 2026-09-04
-- toyota.ae         | Toyota Land Cruiser VXR 2024 | 399900 | (null)     | 2026-08-30
-- toyota.ae         | Toyota Prado TXL 2024        | 264900 | weak       | 2026-09-07
```

`concluded` (`:1573`) is the three non-`weak` rows: two `model_only` and **one whose
`match_quality` is NULL — never rated at all**, scraped 2026-08-30, nine days old.

**What is actually true.** The comment at `:511-513` states the reasoning for treating
an unrated match as conclusive:

> `unrated` is not a fourth grade of match. It is the ABSENCE of one… Calling it weak
> would suppress a figure nobody has shown to be wrong; calling it rated would assert
> a check that never ran.

That inverts the house rule. *Unknown ≠ none* and *unknown ≠ permission*. A match
nobody rated has not been shown to be **right** either, and the cost of the two errors
is not symmetric: suppressing a figure costs a page a number, publishing one costs a
dealership a price cut. There is a third option the file already uses everywhere else
— show the subtraction, refuse the conclusion — and it is what `weak` gets.

Nine of the 22 rows on file carry a NULL `match_quality`. Every one of them is
currently allowed to produce a direction and a percentage.

**Smallest correct fix.** `screens/competitors.js:532` → `concludes: false`, and move
the count onto the existing `unratedRows` line at `:1650`, which already says
*"N matches never rated"*. The row keeps its `delta`; only the conclusion is
withdrawn. That is precisely what `weak` already does, and the file has the sentence
for it.

Second, weaker: reconsider `model_only` at `:519`. `v_inventory_profit_sentinel`
grades a `model_only` comparable `UNKNOWN_UNVERIFIED_COMPARABLE` and refuses a market
position from it. The Competitors screen concludes from it. **One fact, two
derivations, opposite answers** — the exact thing `NEXUS_INVARIANTS.md` forbids.
Whichever way it settles, it must settle once.

**Live in the deployed bundle: yes.**

---

### F4 · Lead Sources reports "1 enquiry arrived" over a book of 5 leads, and the caption disclaims the wrong gap

**Rank: operational, high. It is the screen a dealership opens to answer "is my lead
flow working".**

**Where.** `screens/lead-sources.js:519`, `:534`, `:562`, `:578`, `:690`.

**What a dealership sees today.**

- *Enquiries that arrived* **1** — "Over all 1 arrival the record returned, within the
  1000 most recent this screen reads."
- *Sources they came through* **1**
- *Signed at source* **0 of 1**
- *Arrived and then lost* **0**, toned **`t-ok`** — green — with
  *"Measured over 1 arrival from real customers in the window read."*
- The panel below: *"No arrival in what was read was refused, held back or left to
  expire… That is a zero with a denominator, which is a finding — it says nothing
  about enquiries that never reached NEXUS at all."*

**Live query and result.**

```sql
select count(*) from v_lead_origin;   -- 1
select count(*) from lead_event;      -- 1
select count(*) from leads;           -- 5

select source_key, phase, lead_id, is_test_traffic, origin_strength from v_lead_origin;
-- walk_in | PROMOTED | 121 | false | 10
```

**What is actually true.** Two things, and the second is the worse.

1. **Four of the five leads on file have no arrival record.** They are not enquiries
   that never reached NEXUS — they are on the Leads screen, they have message
   histories, one of them carries the AED 585,000 sale. They simply predate
   `lead_event`. The screen never reads `leads`, so it has no denominator to compare
   against and cannot say this.

   The caption at `:690` is the failure the house rule names — *check captions against
   the branch they sit in*. It disclaims *"enquiries that never reached NEXUS at
   all"*, which is a real but different gap, while the gap that actually exists —
   enquiries that reached NEXUS and were never recorded as arriving — goes unmentioned
   directly above a green tick.

2. **The one arrival counted as real business is a preflight probe.** Lead 121 is
   `walkin-preflight-01@nexus-preflight.invalid`, and its `lead_event` row carries
   `is_test_traffic = false`. `splitTraffic()` at `:230` therefore files it under
   `business`, and every one of the four headline figures is computed over it. This
   is the only screen in the product with a test-traffic classifier, and today it
   classifies a synthetic probe as a real customer.

**Smallest correct fix.**

1. Add a `leads?select=id&limit=1` count to `loadBoth` and render one clause:
   *"1 of the 5 leads on file has an arrival record. The origin of the other 4 is not
   recorded — they are not absent enquiries, they are enquiries whose door NEXUS
   cannot name."* Put that clause in `lib/vocabulary.js` beside `LOSS_IS_NOT_ABSENCE`,
   which is the sentence it is the mirror of.
2. Withhold the green `t-ok` on *Arrived and then lost* while arrivals cover fewer
   leads than are on file. A green tick over 20% coverage is an all-clear over a
   check that ran on one row.
3. Mark the preflight endpoint's events `is_test_traffic = true`. That is a data fix,
   not a frontend one, and it belongs with whoever owns `lead_ingest_endpoint`.

**Live in the deployed bundle: yes.**

---

### F5 · Overview averages the response time of leads the dealership has disqualified

**Rank: operational.**

**Where.** `screens/overview.js:1030-1031`, rendered at `:1628`.

```js
const withResp = leads.filter(l => n0(l.response_time_minutes) != null);
const avgResp  = withResp.length ? withResp.reduce(…) / withResp.length : null;
```

**What a dealership sees today.** *Avg response time* **2.7m**, in green, *"Inside the
5-minute rule"*, *"From 3 of 5 leads with a recorded response time"*, with the warning
*"An average of 3 measurements is not a performance figure."*

**Live query and result.**

```sql
select id, name, status, response_time_minutes from leads where response_time_minutes is not null;
-- 34  | Siva Thangavelu | DISQUALIFIED | 1
-- 38  | Ali             | WARM         | 4
-- 122 | Hussain         | COLD         | 3
-- mean = 2.666… → renders 2.7m
```

**What is actually true.** Two of the three measurements are replies to conversations
that are not vehicle enquiries: lead 34 is the solar mounting-clamps wrong number the
dealership itself disqualified, and lead 122 is *"I have been driving for 6-7 hours.
Can you please adjust for a while?"* The third, lead 38, is the owner's own test from
an Indian number.

The arithmetic is right and the coverage is disclosed. What is wrong is the
population: **every other lead figure on this screen excludes closed leads** — *Open
leads* uses `isOpenLead` via `lib/pipeline.js:91`, *Pipeline value* excludes them
explicitly and says so ("a won deal is money already taken and a lost one is money
that was never there", `:1500`). The response tile silently includes them. One screen,
two populations, no sign of the difference.

**Smallest correct fix.** Filter `withResp` with `isOpenLead` — the predicate is
already imported at `:255` — and where a closed lead carried a measurement, say so:
*"N of the leads timed here have since been closed and are excluded; their replies
were real, they are just not open business."* Do not silently drop them; the point of
`lib/pipeline.js` is one rule stated once.

**Live in the deployed bundle: yes.**

---

### F6 · The Team screen's entire SLA record is one disqualified wrong number

**Rank: operational.**

**Where.** `screens/team.js:674` (the KPI), `:1243` (the *Leads* column), `:1258`
(*Avg response*), `:1274` (*Within SLA*).

**What a dealership sees today.**

- *Within the 5-minute rule* **1 / 1** — *"One lead has been timed, so this is that
  lead's outcome and not a rate. Its first reply took 1 minute."*
- The roster row for Ali Asgher: *Leads* **1**, *Avg response* **1m** with
  *"one lead, not an average"*, *Within SLA* **1 / 1** with *"answered in time — one
  lead, so no rate"*.

**Live query and result.**

```sql
select * from v_team_performance;
-- Ali Asgher | senior_rep | online | leads_assigned 1 | hot_leads 0
-- avg_response_minutes 1.0 | within_sla 1 | breached_sla 0 | pipeline_aed null
```

The single assigned lead is **lead 34 — the solar mounting-clamps wrong number,
status `DISQUALIFIED`.**

**What is actually true.** This screen is the most careful in the repo on the
denominator question. `MIN_RATE_SAMPLE = 2` at `:288` withholds the percentage;
`:1544` records the reason in the file itself (*"one lead is that lead wearing a
percent sign: 100% within SLA and 0%"*). The arithmetic honesty is done.

What is missing is the subject. Nothing on the screen says the one lead anybody has
been timed on is a lead this dealership disqualified as a wrong number. A prospective
buyer reading "1 / 1 · answered in time" reads a performance claim.

There is a second, structural half. Read live, the view is:

```sql
count(l.id)                                                     AS leads_assigned
count(l.id) FILTER (WHERE l.response_time_minutes <= 5)          AS within_sla
sum(l.budget_aed) FILTER (WHERE nexus_lead_is_open(l.status))    AS pipeline_aed
```

`pipeline_aed` was migrated onto `nexus_lead_is_open` on 2 September;
`leads_assigned`, `within_sla`, `breached_sla` and `avg_response_minutes` were not.
**One row, two populations, four columns that do not say which they are.**
`screens/team.js:1243` renders `leads_assigned` under the label *Leads*.

**Smallest correct fix.**

1. Where `measuredTot < MIN_RATE_SAMPLE`, name the lead and its status:
   *"The one timed lead is #34 (DISQUALIFIED). Its first reply took 1 minute."* The
   screen already reads `leads` and already has `ownedBy(r)`.
2. Either bring `leads_assigned` / `within_sla` / `breached_sla` onto
   `nexus_lead_is_open` like `pipeline_aed`, or rename them so the column says which
   population it counts. Do not leave one row describing two.

**Live in the deployed bundle: yes.**

---

### F7 · Five HOT "reply due" alerts, none of them a customer

**Rank: operational.**

**Where.** `v_needs_attention`'s `unanswered_chat` branch (database);
`lib/badges.js:144-180`; `screens/overview.js:2800-2860`;
`screens/conversations.js:1872`.

**What a dealership sees today.** A nav badge on Conversations reading **5**, five HOT
rows in the Overview attention list, and a *Reply due* tile of 5.

**Live query and result.**

```sql
select ref, title, left(detail,70) from v_needs_attention where kind='unanswered_chat';
-- 56375908552955@lid  | محمد فارن حسین          | "…I know your router password, can you give me your router pa"
-- 76703921635478@lid  | KAWKAB AL NUJOOM COSMETIC| "…Samosa ch / Bafore namz baad awi ja"
-- 42795289079828@lid  | Mustafa                  | "…Kay hoy too"
-- 115105257808001@lid | Mustafa Fefco أب الحسن   | "…You were making the AI banner I had shared reference above"
-- 261852009332755@lid | perfumer                 | "…Nai bhai ese hi kiya tha fon"

select identified, count(*) from v_conversations group by 1;
-- whatsapp_profile 11 · lead 3 · unidentified 1
```

The view's branch, read live:

```sql
FROM v_conversations v WHERE v.awaiting_msg_reply AND v.last_msg_at > now() - '7 days'
```

**No lead filter.** Every WhatsApp thread awaiting a reply becomes a HOT alert.

**What is actually true.** None of the five is a vehicle enquiry, and none resolves to
a lead — they are `@lid` handles among the 10 the coverage view counts as
`unresolved_whatsapp_handles`. One is a social-engineering attempt. This is the
1-in-31 shape `CLAUDE.md` records, arriving on the dealership's dashboard as
operational urgency.

`screens/conversations.js:1894` is honest at tile level — it prints *"3 matched to a
lead"* against 15 threads. The nav badge and the Overview count are not: `lib/badges.js`
counts severity and screen only, with no notion of whether a thread is a customer.

**Smallest correct fix.** Two options; the first is smaller.

1. In `lib/badges.js`, split the Conversations count into matched and unmatched, and
   put the split in the badge `title`: *"5 threads awaiting a reply — 0 of them match
   a lead."* That is one join the screen already performs.
2. Better, and a database change: grade an unanswered thread that resolves to no lead
   `WARM`, not `HOT`. A thread nobody can tie to a customer is a thing to look at, not
   a thing to drop everything for.

**Live in the deployed bundle: yes.**

---

### F8 · Ask AI cites seed fixtures as the dealership's own policy

**Rank: operational, and a liability. A rep can repeat one of these to a customer.**

**Where.** `screens/ask.js:226`, `:983-985`, `:450`, `:469`;
`lib/vocabulary.js:157` (`rag_documents: 'your documents'`).

**What a dealership sees today.** The Ask AI screen reports a knowledge base of **15
indexed sections** across four documents, and answers questions by quoting them with a
document title, a section and a page number.

**Live query and result.**

```sql
select doc_title, section, source_file, page_number from rag_documents;
-- Warranty Policy            | Standard Coverage …          | warranty_policy_v4.2.pdf      | 12–16
-- HR Handbook                | Annual / Sick / Maternity …  | hr_handbook_2026.pdf          | 22–24
-- Sales Compensation Policy  | Tiers / Timing / Clawback    | sales_compensation_policy.pdf |  4–6
-- Trade-In Appraisal SOP     | Inspection / Diagnostic / …  | trade_in_appraisal_sop.pdf    |  8–11
```

Every one of the 15 rows is in `setup_real_data.sql:111-125`. The warranty text reads
*"All new vehicles sold by NEXUS OS come with a standard warranty of 3 years or
100,000 km."*

**What is actually true.** These are the product's own seed fixtures. No dealership
wrote them, and `warranty_policy_v4.2.pdf` does not exist. `screens/ask.js:226`
describes an answer as one that *"quotes the dealership's own policy material"*, and
`lib/vocabulary.js` renders the table to a dealership as **"your documents"**.

The screen already does the hard half of this. `:983` raises a permanent, never-
dismissed panel: *"We cannot know when this knowledge base was last updated… Every
answer on this screen is therefore grounded in documents of unknown vintage. Before
repeating a finance rate, a warranty term or a policy to a customer, open the cited
document and check its own date."*

That instruction cannot be followed. The document does not exist. The screen has
correctly identified that it cannot vouch for **when** a section was written, and has
not noticed that it equally cannot vouch for **who wrote it** — and `rag_documents`
records neither: its columns are `id, doc_title, section, content, source_file,
page_number, search_vector, tenant_id`.

**Smallest correct fix.**

1. Add `rag_documents.ingested_by` / `ingested_at`. One column answers both this and
   the freshness panel the screen already raises.
2. Until then, extend the existing `kb-undated` panel — the branch is already there,
   already permanent, already the right tone — to say that the table records no
   ingestion provenance either, and list the four `source_file` values so a
   dealership can see at a glance that none of them is theirs.
3. Consider whether `lib/vocabulary.js:157` should read *"the documents indexed for
   this dealership"* rather than *"your documents"* until (1) lands. "Your" is an
   ownership claim the table cannot support.

**Live in the deployed bundle: yes.**

---

### F9 · Two attention rows are stamped `now()` and are therefore always "just now"

**Rank: operational, low.**

**Where.** `v_needs_attention`'s `inventory_aging` branch: `now() AS at`.
Consumed at `lib/badges.js:93`.

**Live query and result.**

```sql
select kind, ref, detail, at from v_needs_attention where kind='inventory_aging';
-- NX-1010 | 155 days in stock · holding cost NOT COMPUTABLE | 2026-09-08 19:08:33+00
-- NX-1004 | 120 days in stock · holding cost NOT COMPUTABLE | 2026-09-08 19:08:33+00
```

The timestamp is the moment of the read, on a fact 155 days old.

**What is actually true.** `screens/overview.js:2672-2683` has already caught this —
its `AT_WORDS` table gives `inventory_aging` its own wording rather than rendering
`ago(at)`, and the comment at `:2840` records the incident (*"NX-1010 — a Range Rover
on the lot since April — printed 'waiting just now' beside its own detail string
reading '148 days in stock'"*).

`lib/badges.js:93` was not fixed with it. Its `collapseAttention` picks the newest row
per group by `Date.parse(it.at)`, so these two rows win every group they land in,
permanently.

**Smallest correct fix.** In the view, use `i.acquired_at` (or the last successful
Inventory Ageing Recompute run) instead of `now()`. If `now()` must stay, `badges.js`
needs the same `AT_WORDS` exemption Overview has — which is an argument for putting
that table in `lib/vocabulary.js` so there is one copy.

**Live in the deployed bundle: yes.**

---

### F10 · The one surviving `catch(() => [])`

**Rank: operational, low. Not firing today.**

**Where.** `screens/overview.js:978`.

```js
db('daily_metrics?select=*&order=snapshot_date.desc&limit=1').catch(() => []),
```

**What is actually true.** This repo has removed this pattern everywhere else and left
the reason in the code each time — `screens/actions.js:597`, `screens/compliance.js:823`,
`screens/deals.js:260`, `screens/team.js:384`, `lib/lead-drawer.js:291` all say some
version of *"allSettled, never `catch(() => [])`"*. This is the last one.

The comment above it argues the read is optional. That is true of a **missing** table
and false of a **failed** read: both produce `[]`, both silently withdraw every delta
line and the `snapshotShrank` warning at `:1376`, and the reader sees no difference
between "there is no snapshot to compare against" and "we could not fetch the
snapshot."

Live today `daily_metrics` holds 20 rows, newest `2026-09-07` (`open_leads 3`,
`avg_response_minutes 2.67`, `pipeline_aed null`), so the branch is not firing and
nothing is currently wrong on screen.

**Smallest correct fix.** Move it into the same `Promise.allSettled` shape the other
reads on this screen use, and render one sentence on failure: *"The previous snapshot
could not be read, so no comparison is shown — that is an unread comparison, not an
unchanged figure."*

**Live in the deployed bundle: yes (the code is; the branch is not).**

---

### F11 · "Ask AI is HEALTHY, 100%" over 11 of 20 runs

**Rank: cosmetic-to-operational, low.**

**Where.** `screens/automation.js:1961` (table cell), `screens/settings.js:1524`.

**Live query and result.**

```sql
select name, runs_30d, successes_30d, rejected_30d, effective_runs_30d,
       success_rate_30d, health from v_workflow_health where name='Ask-AI - RAG Query Agent';
-- 20 | 11 | 9 | 11 | 100.0 | HEALTHY
```

**What is actually true.** Nine of the twenty runs were refused by design and are
excluded from the denominator, correctly. The table cell names the denominator
(*"11 of 11 qualifying runs succeeded outright"*) but not the nine excluded; the
drawer does, via `runsBreakdown` (`screens/settings.js:295`). A green **HEALTHY** badge
and a round **100.0%** over eleven runs is the smallest sample on the screen wearing
the strongest word.

For contrast, the same view grades Competitor Price Scraping `PRODUCING_NOTHING` at
8.7% over 288 runs, and that grading is right — so the machinery works; it is the
sample size that is unstated.

**Smallest correct fix.** Put the excluded count on the cell, not only in the drawer:
`100.0% · 11 of 20 runs qualified`. One clause, and `runsBreakdown` already computes it.

---

### F12 · A null lifetime value sorts as zero

**Rank: cosmetic.**

**Where.** `screens/customers.js:1137-1138`.

```js
const av = n0(a.view && a.view.lifetime_value_aed) || 0;
const bv = n0(b.view && b.view.lifetime_value_aed) || 0;
```

**What is actually true.** A customer whose lifetime value is unknown sorts identically
to one whose lifetime value is zero. This is a **sort key only** — no figure is
rendered from it, and the drawer at `:1605-1639` handles the null/zero distinction
properly and at length. Live, three of four customers have `lifetime_value_aed = null`
and none has 0, so the collision does not occur today.

**Smallest correct fix.** Sort nulls last explicitly rather than coercing. Worth doing
because `|| 0` on a money column is the shape this codebase keeps finding, and the next
reader will copy it.

---

### F13 · The Lexus is Available on Inventory and sold on Deals

**Rank: money — this is F1 seen from the other side, and it is what a dealership would
notice first.**

**Live query and result.**

```sql
select id, model, status, days_in_stock, price_aed, recommendation
  from v_inventory_profit_sentinel where id='NX-1011';
-- NX-1011 | Lexus LX 600 2024 | Available | 41 | 585000 | HOLD
```

**What a dealership sees.** Inventory shows a Lexus LX 600 2024, **Available**, listed
at **AED 585,000**, 41 days on the lot, recommendation HOLD. Deals shows one closed
deal — a Lexus LX 600 2024 at **AED 585,000**. Neither screen mentions the other.

The only place in the product that notices is `v_attribution_sale_chain`, in the
vehicle hop, and it is blunt about it:

> *"1 unit(s) share model words with the sale text 'Lexus LX 600 2024': NX-1011
> (Lexus LX 600 2024, Available, listed AED 585,000). THE TEXT MATCHES AND PROVES
> NOTHING - note the unit's status."*

That sentence is only reachable by opening the sale drawer on the Attribution screen.

**Smallest correct fix.** The Deals screen already reads `inventory` (`deals.js:299`).
Where a recorded sale's vehicle text matches a unit that is still `Available`, say so
on the row: *"A unit matching this text is still on the lot as available. Either the
sale is not a sale or the stock record is stale."* That is one comparison over 1 row
and 12 rows, and it is the contradiction most likely to be spotted in a demo.

---

## Which three I would fix before showing this to a dealership

**1 · F2 — the undercut alerts (`v_needs_attention` + `competitors.js:2029`).**
This is the one that would embarrass Ali most directly and most quickly. Open the
Competitors screen in front of a buyer and NEXUS says *"drivearabia.com is AED 90,000
cheaper"* on the dealership's most expensive car. If the buyer asks how NEXUS knows,
the honest answer is that NEXUS does not — the product's own Profit Sentinel says the
price came from a language model asked for the lowest advertised figure and cannot say
what it was for. The product will have contradicted itself inside two clicks, and it
will have done so while recommending a five-figure price cut. It is also the cheapest
fix on this list: one `AND` in a view, one `||` in a screen.

**2 · F1 / F13 — the AED 585,000.**
Every money surface in the product is currently reporting a repair test as confirmed
revenue, and the same car is simultaneously on the lot as available stock at the same
price. A dealership does not need to be told this is wrong; they will see it, because
it is their inventory and it is not sold. The provenance column is the real fix, but
the interim fix — every money tile stating its row count and that provenance is not
recorded — is a day's work across six call sites and one shared sentence in
`lib/vocabulary.js`.

**3 · F8 — Ask AI citing seed fixtures.**
This is the one with an actual liability attached. A rep asks "what does our warranty
cover?", gets "3 years or 100,000 km, `warranty_policy_v4.2.pdf` page 12", and repeats
it to a customer. That is a commitment the dealership never made, sourced to a document
that does not exist, delivered by a screen that calls it *your documents*. The screen
has already built the panel that would carry the warning; it needs one more clause in
it.

Honourable mention: **F4**. "1 enquiry arrived" is the single most misleading headline
in the product for a buyer being sold a lead-capture system, and the green tick under
"Arrived and then lost: 0" is the kind of all-clear this repo has spent months
removing elsewhere.

## What is already right, and should not be undone

Recording this because the next pass over these files should know what the reasoning
was, and because most of what I read is correct.

- `screens/revenue.js:33-75` refuses to produce a total "revenue at risk" and states
  why in five numbered rules. It is the best thing in the repo.
- `screens/money-leaks.js:790-803` totals exactly one quantity on the whole screen and
  puts the denominator on the surface rather than in a note.
- `screens/deals.js:934` withdraws *Average deal* at one priced deal and prints the
  reason where the number would be.
- `screens/overview.js:1683` refuses to draw the pipeline-by-stage bar at n=1, on the
  grounds that a full-width band of one colour makes a claim no caption can undo.
- `screens/team.js:674` withholds the SLA percentage below two measurements.
- `screens/finance.js:1361` renamed a tile from "Customers quoted" to "Customers
  recorded" rather than print a false zero in the largest type on the screen.
- `screens/attribution.js:322` distinguishes "nothing confirmed" from "no sale on
  file" as two separate branches, because they are two different findings.
- `lib/pipeline.js:104` returns `null`, not `0`, from `sumBudget`.
- `lib/data.js:12` keeps `ME_READ_FAILED` so that "we could not find out" never renders
  as "you have no staff record".
- `v_lead_recovery`, `v_lead_recovery_coverage`, `v_inventory_profit_sentinel` and
  `v_attribution_sale_chain` each carry a `_state` and a `_basis` beside every figure
  and a paragraph naming their own blind spots. Four of the findings above were only
  provable because those views state what they cannot know.

## The standard, proposed

Three rules. They are not new — they are what the best screens above already do,
written down so the next screen does not have to rediscover them.

### Rule 1 · An unmeasured value renders as a word, never as a number

A figure the product has not measured renders as the reason, in the value slot, at
full size. Never `0`, never `—` alone, never a number with a caveat beneath it.

The register of those words belongs in `lib/vocabulary.js`, next to
`CONNECTION_STATE_NOT_KNOWN` and `ORIGIN_STRENGTH_NOT_STATED`, which are already
exactly this. The words the database already uses and the frontend should reuse
verbatim: `NOT_COMPUTABLE`, `UNKNOWN_NOT_MEASURED`, `UNKNOWN_NO_LINK`,
`UNKNOWN_NO_COMPARABLE`, `NO_SALE_RECORDED`.

Worked example, live today: `screens/inventory.js:386` renders *Holding cost accrued*
as **"Not computable"** with *"No holding rate is on record for this dealership, so the
engine will not state a holding cost or a net margin for any of the 12 units."* All
twelve units carry `holding_cost_state = NOT_COMPUTABLE`. Rendering `AED 0` there
would have been a lie about a rate nobody has ever quoted, and the file's own comment
records that it once did.

The counter-test: `num(null)` renders an em dash, and an em dash means "not known". It
is correct in a **table cell**, where the column header supplies the noun. It is not
sufficient in a **tile**, where a dash reads as a shrug. Tiles get words.

### Rule 2 · A rate states its denominator, and is withheld below the sample it needs

Any percentage, average or rate renders `n of m` — never `n%` alone — and is
**withdrawn entirely**, with the reason printed where the number would be, when `m`
falls below the sample the figure needs.

- `MIN_RATE_SAMPLE = 2` (`screens/team.js:288`) is the floor for any rate at all: one
  measurement can only be 0% or 100%, and both are that measurement wearing a percent
  sign.
- `THIN = 5` (`screens/team.js:289`, `screens/deals.js`, `screens/overview.js`) is the
  threshold below which a rate is shown but carries an explicit warning that it moves
  a long way on one row.
- `STAT_MIN_CUSTOMERS` (`screens/finance.js`) is the same idea for a rate about
  *people* rather than *events*, and the distinction matters: three quotes to one
  customer is a sample of one, not three.

Both constants belong in `lib/vocabulary.js` with the sentences that go with them, so
that seven screens cannot hold seven thresholds. Today `screens/team.js` and
`screens/finance.js` each declare their own, and they agree by luck.

**A rate must also state what it excluded from its own denominator.** `100.0%` over
11 qualifying runs of 20 logged (F11) is the current failure of this clause.

### Rule 3 · A money figure names its provenance word, and the word is a closed set

The six words are already in the repo's vocabulary and are already ordered:

```
DETECTED  <  ESTIMATED  <  ATTRIBUTED  <  INFLUENCED  <  CONFIRMED  <  RECOVERED
```

`screens/money-leaks.js:1252-1275` already renders four of them as a register with
what currently holds each word, including the empty ones — *"Listed because a
vocabulary with no empty slots is a vocabulary nobody checks."* That register should
move to `lib/vocabulary.js` as `MONEY_WORD`, mirroring the shape of `LEAD_PHASE` and
`ATTRIBUTION_CONFIDENCE`: a frozen object of `{ label, tone, blurb, weaker_than }`,
with a lookup returning `null` for anything outside the set.

Three clauses:

1. **No money figure renders without one of the six words beside it.** Not in a
   tooltip — beside it, in the sub-line, at the same moment.
2. **A figure whose provenance is weaker than CONFIRMED renders the weaker word and
   never a stronger one.** The failure to avoid is not using a wrong word; it is using
   the right word about the column and the wrong word about the world (F1).
3. **CONFIRMED requires a provenance the schema can express.** Today it cannot: no
   table that holds money holds a column saying where the row came from. Until
   `purchase_history` carries one, CONFIRMED is the strongest word available and
   therefore not a strong word — and any tile using it says so, once, in the shared
   sentence.

A fourth clause worth adding, because two findings above turn on it: **two surfaces
computing the same fact must reach the same verdict.** `v_needs_attention` and
`screens/competitors.js` disagree about whether a `weak` match supports a price
conclusion; `screens/competitors.js` and `v_inventory_profit_sentinel` disagree about
`model_only`. That is `NEXUS_INVARIANTS.md`'s *one figure, one derivation* applied to
a verdict rather than a number, and it needs saying in those words.

## Unknowns

Stated plainly, because several of them bound how far the findings above can be
trusted.

1. **I read the bundle in this repo, not the bytes being served.** `dist/index.html`
   references `main-CgKC2kaX.js` and every source file predates that build, and the
   literals behind every finding are present in it. Whether the deployment origin is
   serving that same file today I did not check and could not from here. Every
   "live in the deployed bundle: yes" carries that caveat.

2. **My production reads ran as the service role, not as a dealership user.** Row
   counts above are true counts; a signed-in dealership user under RLS could see
   fewer. On a one-tenant database the two coincide, but the audit did not prove that
   and it is exactly the assumption `CLAUDE.md` warns against upgrading.

3. **Every figure here is one tenant's.** Nothing above says what a second dealership
   would see, and several findings (F4's arrival coverage, F6's roster of one, F7's
   unresolved handles) would look entirely different on a dealership with real volume.
   Some would get better; F7 would get much worse.

4. **Three screens I read less closely than the rest** because their live data is thin
   and their reads are shared with screens I did read in full:
   `screens/policy.js` (13 rule versions, all read through `v_policy_rule`),
   `screens/deal-rescue.js` (`v_deal_rescue` returns 0 rows — the screen is
   structurally empty today and says so), and `screens/actions.js` (3 actions, and
   `v_action_center_health` reports `health = EXECUTIONS_FAILING` with 1 execution
   failed of 3 raised). Each of the three carries `_state` handling and read-failure
   branches; none showed the shapes in this audit. That is an absence of evidence over
   a small sample, not a clean bill.

5. **I did not audit `screens/settings.js`, `screens/automation.js`,
   `screens/compliance.js`, `screens/campaigns.js` or `screens/conversations.js`
   exhaustively** — each is 2,000–3,000 lines, and I read their KPI strips, their
   read paths and the branches their live data reaches. Their untaken branches are
   unexamined.

6. **Whether a `model_only` match should conclude is a judgement I did not make.**
   F3 records that the Competitors screen and the Profit Sentinel disagree and says
   the disagreement must be settled once. Which way it settles is a product decision
   about how much precision a price recommendation needs, and it is not mine.

7. **Why four of five leads have no `lead_event` row is unestablished.** The
   observable fact is that `lead_event` holds one row and `leads` holds five, and that
   the four uncovered leads all predate 7 September. Whether that is a backfill that
   was never run, a writer that only started that day, or something else, I did not
   determine — and F4's proposed wording is deliberately written to be true either way.

8. **`channel_message_events` holds zero rows.** No screen in this audit renders a
   figure from it directly, so it produced no finding. But it is the delivery record,
   `lib/vocabulary.js:126` maps it to *"the delivery record"*, and a delivery record
   with nothing in it is the sort of table a future screen will read and render as
   "0 messages delivered". Worth a rule-1 guard before that screen exists.

9. **I did not check whether the three parallel agents' in-flight work on
   `held-enquiries.js`, `system-truth.js` or `ops/frontend-contract/` overlaps any
   finding here.** Two of those files do not exist in `screens/` as I read it, so they
   are new work; if either renders a count from `v_needs_attention` or
   `purchase_history`, F1, F2 and F7 apply to them on arrival.
