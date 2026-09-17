# I filled the form on the live site. It returned 503, and nothing anywhere moved.

12 September 2026. An end-to-end capture test across every channel NEXUS claims,
run against production, with a real browser filling a real form. Every line below
is a measurement with the query or the HTTP response behind it.

## The short answer

**No automated channel can capture a lead today.** Not Facebook, not Instagram,
not Google Ads, not the website, not any marketplace. The only two ingest paths
that are switched on are a salesperson typing into the dashboard.

This is not a wiring problem waiting on a test. Three of the five registered
endpoints are `status = 'disabled'` in the database, and the door refuses a
disabled endpoint by design.

## What the ingest table actually says

```sql
select source_key, label, status, ingest_address from lead_ingest_endpoint order by created_at;
```

| source_key | status | ingest_address |
|---|---|---|
| `walk_in` | **active** | `dashboard://lead-drawer` |
| `phone_call` | **active** | `dashboard://lead-drawer` |
| `meta_lead_ads_facebook` | **disabled** | `…/webhook/meta-lead-ads` |
| `meta_lead_ads_instagram` | **disabled** | `…/webhook/meta-lead-ads` |
| `google_ads_lead_form` | **disabled** | **null** |

Both active rows are `dashboard://lead-drawer` — a human typing. Every automated
channel is off. `google_ads_lead_form` additionally has no ingest address at all.

And there is **no website endpoint registered at all**. No `website`, no
`web_form`, no `landing_page`. The marketing site has nowhere to deliver to even
if it worked.

`nexus_record_lead_event` resolves through `nexus_lead_endpoint_for_public_key`,
which returns only active endpoints, and its own error text names this case:

> LEAD_ENDPOINT_UNRESOLVED — "The endpoint is unregistered, **disabled**, or its
> dealership is not active. There is no fallback tenant on purpose: a resolver
> that guesses is how one dealership's traffic writes another's data."

So a real Facebook lead arriving right now raises NX001 and is refused. The
refusal is correct behaviour on a shut door. The door being shut is the finding.

This is the whole registered ≠ connected ≠ received ladder in one table. Meta
verified the webhooks — that is real, and it is the *first* rung. It says Meta
will call us. It says nothing about what happens when it does.

## The website form, tested for real

I filled every field on `https://nexus-for-autodealers.vercel.app/` in a browser
— name, dealership, WhatsApp number, email, stock band, message — left the
honeypot empty, and clicked **Request a walkthrough**.

```
POST https://nexus-for-autodealers.vercel.app/api/lead   ->  HTTP 503
```

On screen the visitor is told:

> "That did not send. Please WhatsApp +971 52 664 7253 directly — it reaches the
> same person."

This is the same 503 recorded on **7 September**. Five days, unchanged. The cause
is unchanged too: `RESEND_API_KEY` and `NEXUS_NOTIFY_FROM` are unset on that
Vercel project. The endpoint is being honest — it refuses to answer 200 when
nothing durable happened — but a prospect who fills that form is told, correctly,
that their enquiry went nowhere.

One consequence worth stating plainly: the site publishes a price, an offer and a
founding-rate scarcity line. Any traffic driven to it converts at zero by
construction. *(Record of the page as it stood on 12 September 2026. The scarcity
line was withdrawn on 17 September 2026 — the price is flat and permanent with no
cap and no deadline. See `ops/landing-page/PRICE-DECISION.md`.)*

A distinction the test made visible: **this form is NEXUS selling to dealerships.
It is not a dealership capturing car buyers.** They are different products and
different lead types, and only the second one is what the ingest layer above is
built for. Neither works today, for different reasons.

## What reached the database: nothing

```sql
select 'lead_event', count(*), max(received_at) from lead_event
union all select 'leads', count(*), max(created_at) from leads
union all select 'communication_logs', count(*), max(created_at) from communication_logs;
```

| table | rows | latest |
|---|---|---|
| `lead_event` | **1** | 2026-09-07 09:41:38 |
| `leads` | 6 | 2026-09-11 11:18:32 |
| `communication_logs` | 218 | 2026-09-12 16:08:44 |

The entire lead-ingestion layer has received **one event in its life**, five days
ago, and that one is the preflight fixture. The 503 wrote nothing, which is at
least clean — this test contaminated no production data.

WhatsApp is the exception and it is genuinely alive: `communication_logs` is
taking traffic as recently as three hours before this test, and grew from 142 to
218 rows during this session.

## Every lead in the system, and where it came from

```sql
select id, name, phone, source, status, created_at from leads order by created_at desc;
```

All six: five `nexus-master-router` (WhatsApp) and one `walk_in` preflight.
**Zero from Facebook, Instagram, Google Ads, the website, or any marketplace.**

And `source` says `nexus-master-router` — the name of the *workflow that wrote the
row*, not where the customer came from. So even the WhatsApp leads cannot answer
"which channel produced this", which is the question the whole ingest layer was
built to answer.

## n8n, Slack and Bitrix24

n8n's UI had logged out and I did not sign in — I do not enter credentials. The
audit trail answers it anyway.

**Nothing named meta, google, facebook, instagram or web has ever written an audit
row.** A search across `%meta%`, `%google%`, `%lead%`, `%bitrix%`, `%slack%`,
`%web%` over all of `audit_log` returns only Lead Escalation, the Drip campaign,
Slack Command Center, the Master Lead Router and Bitrix24 ERP Sync. There is no
Meta Lead Ads run and no Google Ads Lead Form run, ever.

Last 5 days, everything that ran:

| workflow | runs | last |
|---|---|---|
| Competitor Price Scraping | 118 | 2026-09-12 13:00 |
| Phase 6 Silence Detector | 4 | 2026-09-12 04:05 |
| Lead Escalation | 4 | 2026-09-12 04:05 |
| Customer 360 Aggregation | 21 | 2026-09-11 22:00 |
| Inventory Ageing Recompute | 5 | 2026-09-11 20:15 |
| WhatsApp BDC Agent | 17 | 2026-09-11 18:10 |
| 7-Day Warm Lead Drip | 1 | 2026-09-11 11:18 |
| Master Router | 1 | 2026-09-11 11:18 |

**Slack: last run 2026-09-06 15:02:53. Bitrix24: last run 2026-09-06 15:02:34.**
Both silent for six days. Neither appears in the five-day window at all. So the
CRM sync and the sales-alert channel are not merely untested on new channels —
they have not fired on anything.

## GitHub

`origin/main` head is `4e963bd`; the working branch is **131 commits ahead and 0
behind**, and `wip/gate-L9-2026-09-03` **does not exist on the remote** — a
`git ls-remote --heads origin` lists only `main`. The Vercel project for the
marketing site last deployed production from the PR #18 merge on 8 September.

So everything after 8 September — including the whole Foundation Freeze wave, the
provenance contract, the isolation audit, the durability design and today's
vocabulary fixes — exists only on two machines and on neither remote.

## What this changes about sequencing

The instinct is to go and fix the channels. The measurement says something else:
every channel is off, and the two things that *are* running — WhatsApp and the
scraper — are the two nobody switched off. Turning three endpoints on is a
one-line UPDATE each. It is not the work.

The work is that when those endpoints come on, the leads they produce will land in
a `leads.source` column that records the writer rather than the origin, be counted
by an `overview.js` KPI trio that reads 3 of 6 statuses, be escalated by a
detector whose two write paths disagree about which tenant owns the customer, and
be synced to a Bitrix24 that has not fired in six days. Opening the doors first
would produce real leads flowing into a system that cannot yet say truthfully
where any of them came from.

Endpoints last, not first.
