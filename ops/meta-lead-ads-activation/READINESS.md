# Meta Lead Ads — what is actually ready, component by component

Written 13 September 2026. Scope: the Facebook lead-ads path only.

The ladder is `ops/evidence-standard/STATUS-LADDER.md:24-28`:
**IMPLEMENTED** (readable in a tracked place) → **PROVEN** (executed, assertions
read) → **PRODUCTION-DEPLOYED** (live and reachable by the path a provider would
take) → **REAL TRAFFIC PROVEN** (a real customer drove it). A cell that cannot be
evidenced is **NOT RUN**, never PASS (`STATUS-LADDER.md:33-34`).

## The one-paragraph answer

**Nothing in this path has ever carried a lead.** `lead_event` holds one row in
its entire life — the walk-in preflight of 7 September
(`STATUS-LADDER.md:64-65`). Nothing named meta, facebook or instagram has ever
written an `audit_log` row. Both Meta endpoints sit `status='disabled'` on
production, `nexus_lead_endpoint_for_public_key` resolves only active endpoints,
and `nexus_record_lead_event` raises `NX001 / LEAD_ENDPOINT_UNRESOLVED`
otherwise — so a real Facebook lead arriving this afternoon is **refused**. That
is the door working, not a fault. What follows is the honest grade per component.

## The table

| # | component | grade | the evidence, and what it is not |
|---|---|---|---|
| 1 | **HMAC verifier** (`Verify Or Refuse`) | **PROVEN**, not real-traffic | `ops/n8n-meta-lead-ads/verify-and-extract.node.js`; 49 assertions in `receiver.test.js` run the **deployed** body (`README.md:109-137`). On-box self-test, execution `10848`: `hmac_selftest {vectors:3, failed:0, negative_control_rejects:true}` (`README.md:133-135`). **Never verified a signature Meta produced** — the five live executions were subscription handshakes that took the `Respond Without Writing` branch and wrote nothing (`GO-LIVE.md:40-46`). |
| 2 | **The webhook URL itself** | **PRODUCTION-DEPLOYED** | `https://35.224.126.225.nip.io/webhook/meta-lead-ads`, workflow `JDqy54w2HUH7pHgW`, ACTIVE (`GO-LIVE.md:21-23`). Measured refusals: `GET` wrong verify token → `403 HUB_VERIFY_TOKEN_MISMATCH`; `POST` unsigned → `401 SIGNATURE_HEADER_MISSING` (`GO-LIVE.md:24-25`). Those two refusals are also the only proof `META_APP_SECRET` and `META_WEBHOOK_VERIFY_TOKEN` reach the worker (`GO-LIVE.md:27`). |
| 3 | **Meta-side subscription** | **registered only** | Callback verified and Page subscribed to `leadgen`+`leadgen_update`, evidenced by executions `11193/11209/11214/11217/11228` (`GO-LIVE.md:28`, `:40-46`). This proves Meta can reach us. It proves nothing about a lead, and it is the rung that gets mistaken for readiness. |
| 4 | **Graph API fetch node** (hop two) | **NOT READABLE — outside the repo** | The node that performs `GET /v25.0/<leadgen_id>` **is not in this repository** (`GO-LIVE.md:225-227`). `grep -c META_PAGE_ACCESS_TOKEN ops/n8n-meta-lead-ads/*.js` returns **0** on all three files (`GO-LIVE.md:213-215`). So the variable name, the transport (query param vs Bearer header), and whether it is an n8n credential at all are **UNKNOWN** — `GO-LIVE.md:779-785`, Unknowns 1 and 2. This component cannot even be graded IMPLEMENTED from here. |
| 5 | **`META_PAGE_ACCESS_TOKEN`** | **NOT SET** | Measured 8 Sep (`GO-LIVE.md:26`). The name itself is **asserted, not measured** (`GO-LIVE.md:219`). Setting it under a name no node reads produces the identical symptom to not setting it: every event stops at `RECEIVED` (`GO-LIVE.md:234-235`). |
| 6 | **Normalizer** (`Normalize And Redact`) | **PROVEN** on fixtures and once on the box; **deployed body unverified today** | `normalize-and-redact.node.js`. Allowlist-first, with `field_data` the one wholesale branch (`:13-28`). Constraint-word repair proven both ways on the box: execution `10879` (old body) → Postgres refused `23514`; `10880` (new body) → `annotated_answers: 2`, would insert (`README.md:90-94`). **But** `GO-LIVE.md:786-788`, Unknown 4: nothing re-verified that the box carries the corrected body. |
| 7 | **Page → dealership registration** | **NOT IMPLEMENTED — 0 rows** | `lead_ingest_provider_identity` holds **0 rows**; no Page is registered against any dealership (`GO-LIVE.md:29`). The table and all six constraints exist: `supabase/migrations/20260907095640_leadingest_08_the_page_decides_the_dealership.sql:19-64`. The owner still owes a Facebook Page ID. Until that row exists, hop one has no tenant to route to. |
| 8 | **The two endpoint rows** | **IMPLEMENTED, deliberately disabled** | `4d4f5cf2-f966-4d4e-9d9e-605757c615b7` / `alba-prod-meta-leadads-facebook` and `ccb32d53-d07b-4e9b-9950-a6c2122ef279` / `alba-prod-meta-leadads-instagram`, both production, both `disabled` (`GO-LIVE.md:32-33`). They were created `active` on 7 Sep, `nexus_lead_source_readiness()` immediately showed Tenant A a green **CONNECTED** over a dead source, and they were disabled the same day (`GO-LIVE.md:334-341`). |
| 9 | **`nexus_record_lead_event`** | **PROVEN on production, once, for a walk-in** | The idempotent path returned `was_duplicate` false then true for lead 125 in a rolled-back production transaction (`STATUS-LADDER.md:70`). **Never called with `source_key like 'meta%'`** — 0 such rows (`GO-LIVE.md:30`). |
| 10 | **Hydrate → promote** | **IMPLEMENTED; never run on a Meta event** | `nexus_hydrate_lead_event` / `nexus_promote_lead_event`; the audit row is written inside the promoter, not the receiver (`GO-LIVE.md:492-496`). `grep -c audit_log ops/n8n-meta-lead-ads/*.js` = 0, and that is correct. Zero Meta promotions have ever occurred. |
| 11 | **`leads` row and `leads.source`** | **NOT RUN for Meta** | 5 `leads` rows, none from Meta (`GO-LIVE.md:31`). The check that `l.source = 'meta_lead_ads_facebook'` and not the writing workflow's name (`GO-LIVE.md:475-479`) has never been executed against a Meta lead. |
| 12 | **Invariants gate** | **PRODUCTION-DEPLOYED and known to go red** | 8 PASS / 0 FAIL / 2 INFO measured 8 Sep (`GO-LIVE.md:34`, `:513-535`). It was sabotaged on purpose with a planted unattributed promotion and reported one FAIL (`GO-LIVE.md:537`). This is the only component here with a demonstrated negative control on production. |
| 13 | **Dashboard UI** | **UNVERIFIED for this source** | No Meta lead has ever rendered. The readiness pill is the known liar: `nexus_lead_source_readiness()` reports `CONNECTED` on the mere existence of an active production endpoint (`GO-LIVE.md:329-333`) — it does not know whether the token is set, whether the Graph hop works, or whether one lead has ever arrived. |
| 14 | **Bitrix24 CRM sync** | **SUPERSEDED / broken since 19 August** | `STATUS-LADDER.md:106`: 7 SUCCESS audit rows naming returned CRM ids, last **2026-08-19 11:04 UTC**; **nothing has succeeded since**, and the workflow shows **10 FAILED**, last 6 Sep. Its link-back PATCHes `leads?email=eq.…`, so a phone-only lead never gets its Bitrix id written back — **silently**. |
| 15 | **Slack alerts** | **NOT RUN — delivery never observed** | `STATUS-LADDER.md:107`: 5 SUCCESS rows whose summary is literally `"Completed"`, last 2026-08-19 11:21 UTC; 7 FAILED since, last 6 Sep. That is a workflow finishing, not a message arriving in a channel. `STATUS-LADDER.md:171-173` says in terms: no system has ever observed a Slack message arriving. |
| 16 | **App Review / Lead Access Manager** | **NOT STARTED, and not ours** | `GO-LIVE.md:710-751`. Business verification, App Review for `leads_retrieval`, and the dealership granting lead access in **their** Business Manager. No engineering work substitutes. No number in this repo describes how long Meta's leads App Review takes (`GO-LIVE.md:791-795`). |

## What that adds up to

- Components 1, 2, 6, 9, 12 are real work that has been executed and read. They
  are the reason this path is worth activating at all.
- Components 4, 5, 7 are the **hard blockers**: a node nobody in this repo has
  read, a secret that is not set under a name nobody has confirmed, and a
  registration row that does not exist.
- Components 14 and 15 are the **quiet ones**. They are downstream of everything
  above, they are already broken on production, and no Meta test will surface
  them unless the test plan looks for them by name. It does — see `TEST-PLAN.md`.
- The whole chain past `RECEIVED` is at **NOT RUN**. Not failing. Never executed.
