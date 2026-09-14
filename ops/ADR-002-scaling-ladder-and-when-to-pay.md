# ADR-002 — The scaling ladder, and when free tier becomes paid

**Status:** ACCEPTED · 14 September 2026 · supersedes nothing · owner decision

## Context

NEXUS runs entirely on free tier. As of today **zero auto dealers are onboarded**.
The owner asked a fair question: do 20–25 n8n workflows serve 1,000–10,000
dealers, or does each dealer need its own copy?

## Decision 1 — The workflow count never grows with dealer count

**One workflow set. One webhook URL. N dealers.** Per-dealer workflows are
forbidden.

Tenant is resolved from the payload, not from the URL:

```
Meta webhook (one URL for every dealer)
  -> metadata.phone_number_id
  -> channel_registry lookup
  -> tenant_id
  -> refuse if the channel is not registered
```

1,000 dealers means 1,000 rows in `channel_registry`. This is already built and
was proven on 14 September by the first real Cloud message (FACT-110).

## Decision 2 — Capacity is bought as dealers arrive, never before

The owner's rule, recorded verbatim in intent: **free tier holds until revenue
arrives.** The first purchase is triggered by the **second paying dealer**, and
buys the paid AI model and paid Supabase. Everything after that follows dealer
growth.

The architecture must be right from day one. Only the *capacity* is deferred.
Nothing in this ladder requires re-designing what exists — each step buys more
of something, or moves one component, and the tenant model is unchanged
throughout.

| Dealers | What changes |
|---|---|
| **1–20** | Today's architecture. Paid AI model (or deterministic rules), and n8n execution pruning. |
| **20–200** | Supabase paid. 3–5 n8n workers. `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`, 48-hour retention. |
| **200–1000** | The message hot path leaves n8n. The inbound receiver becomes a small service doing three things: verify the HMAC, insert the row, enqueue. n8n keeps the business workflows — drip, escalation, CRM sync — which are not per-message. |
| **1000+** | Multi-worker, multi-region, read replicas. |

Shape for 1,000 dealers at 50 messages/day: roughly 10–20 n8n workers, a paid
AI model, managed Postgres.

## Decision 3 — n8n is not the wrong tool; it is in the wrong place at scale

n8n is excellent for business logic a person needs to see and change. It is a
poor fit on the hot path of every customer message. The 200–1000 step is not a
rewrite — it moves one node's worth of work into a service and leaves the rest.

## The order in which things break

Measured 14 September 2026. Current production volume is roughly **5–10
messages per day** (`audit_log` holds 1,052 rows for the whole month; the
highest-volume path, WhatsApp BDC Agent, shows 146 runs in 30 days). The
question was about 50,000/day — a 10,000× step.

| # | First to break | At roughly | Why |
|---|---|---|---|
| 1 | **Free-tier AI models** | **2–3 dealers** | Daily rate limits, and observed decoder collapse on 13 Sep (`the the the the…`) producing a regex-scraped score of 0. |
| 2 | Supabase free tier | 10–30 | Database size cap against accumulating message history. |
| 3 | n8n execution storage | 30–100 | ~3 GB/day at 50k messages if execution data is retained. |
| 4 | n8n worker concurrency | 100–300 | One worker today. ~0.7 executions/sec once an AI call dominates latency. |
| 5 | Single GCP VM | 200+ | One box, no failover. |

**The first wall is not n8n. It is the free AI models, and it arrives at dealer
two — not dealer one thousand.**

## Consequences

- Scoring must stop depending on a free model that collapses. Either a paid
  model with native structured output, or deterministic rules with the model
  demoted to a labelled, non-authoritative signal. This is the only item on
  this page that blocks dealer #2.
- Execution pruning is not optional even at current volume; it is a one-line
  environment change that prevents a silent disk-fill later.
- No further infrastructure work is justified today.
