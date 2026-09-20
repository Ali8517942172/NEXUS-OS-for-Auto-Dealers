# NEXUS tenant-precedence -- three-dealer journeys results

Mode: LIVE + --allow-side-effects (full push + verify), run_id `4fa7d95b`, 2026-09-20 ~11:14-11:28 UTC.

## Timing correction (important)

`journeys.py`'s own push-then-verify sequence runs the Supabase verification
**immediately** after posting all 15 webhooks. The Master Lead Router's
webhook (`Webhook Catch-All`) uses `responseMode: onReceived` -- it returns
HTTP 200 the instant the request is received, then processes the lead
**asynchronously** (AI scoring via OpenRouter/Groq, ERP sync, WhatsApp/Slack/
Gmail sends, then the Supabase insert). With 15 pushes queued at once and the
n8n instance processing 1-2 concurrently at ~80s-3min each, draining all 15
took until 11:28 UTC -- well after `journeys.py`'s verification phase had
already run and printed 16 FAIL + 3 INCONCLUSIVE (visible in this repo's git
history / the tool transcript). That first table was **not accurate** --
it measured a database that hadn't been written to yet, not a tenancy defect.

The table below is a **re-verification** against the same live `leads` table,
same run_id, same marker-matching logic as `journeys.py` (functions imported
and reused unmodified from `journeys.py`, including check 4 with fresh JWTs
for each dealer member), run after confirming via `search_executions` that
all 15 Master Router executions for this run had reached a terminal state
(12 `success`, 3 `error`). No customer was pushed a third time; this is
read-only re-verification of the side effects already caused by the one
`journeys.py --live --allow-side-effects` run.

## Results (re-verified after async drain, 11:29 UTC)

| Check | Scope | Verdict | Detail |
|---|---|---|---|
| 1:tenant-correctness:a-c1 | a | PASS | 1 row, tenant_id=fff6a2b5-cfd5-4460-8383-875bc5826de0 |
| 1:tenant-correctness:a-c2 | a | PASS | 1 row, tenant_id=fff6a2b5-cfd5-4460-8383-875bc5826de0 |
| 1:tenant-correctness:a-c3 | a | PASS | 1 row, tenant_id=fff6a2b5-cfd5-4460-8383-875bc5826de0 |
| 2:same-dealer-shared-phone-not-deduped | a | PASS | 2 separate rows under tenant_id=fff6a2b5-cfd5-4460-8383-875bc5826de0 (correctly NOT deduped on shared phone) |
| 2:double-push-deduped | a | PASS | two identical pushes deduped to exactly 1 row |
| 1:tenant-correctness:b-c1 | b | PASS | 1 row, tenant_id=9060a854-ec38-4f0d-a39c-54372f1998b1 |
| 1:tenant-correctness:b-c2 | b | PASS | 1 row, tenant_id=9060a854-ec38-4f0d-a39c-54372f1998b1 |
| 1:tenant-correctness:b-c3 | b | PASS | 1 row, tenant_id=9060a854-ec38-4f0d-a39c-54372f1998b1 |
| 2:same-dealer-shared-phone-not-deduped | b | PASS | 2 separate rows under tenant_id=9060a854-ec38-4f0d-a39c-54372f1998b1 (correctly NOT deduped on shared phone) |
| 2:double-push-deduped | b | PASS | two identical pushes deduped to exactly 1 row |
| 1:tenant-correctness:c-c1 | c | PASS | 1 row, tenant_id=d6c3bc16-83e0-4568-9547-07bd4468415c |
| 1:tenant-correctness:c-c2 | c | PASS | 1 row, tenant_id=d6c3bc16-83e0-4568-9547-07bd4468415c |
| 1:tenant-correctness:c-c3 | c | FAIL | no lead row found for this customer's marker (upstream: n8n execution 15917 errored -- see below) |
| 2:same-dealer-shared-phone-not-deduped | c | FAIL | missing row(s) for the phone-sharing pair (c-c3 never landed, see above) |
| 2:double-push-deduped | c | FAIL | no row found after pushing twice (both c-c4 pushes errored -- executions 15918, 15919, see below) |
| 3:cross-tenant-phone-collision | a+b+c | PASS | 3 distinct tenant-scoped rows for the shared phone, no collapse |
| 4:jwt-scoped-postgrest-visibility | a | PASS | 4 row(s) visible, all under own tenant_id=fff6a2b5-cfd5-4460-8383-875bc5826de0 |
| 4:jwt-scoped-postgrest-visibility | b | PASS | 4 row(s) visible, all under own tenant_id=9060a854-ec38-4f0d-a39c-54372f1998b1 |
| 4:jwt-scoped-postgrest-visibility | c | PASS | 2 row(s) visible, all under own tenant_id=d6c3bc16-83e0-4568-9547-07bd4468415c |

**Totals: 15 PASS, 3 FAIL, 0 INCONCLUSIVE, 0 NOT RUN.**

## Root cause of the 3 FAILs -- NOT a tenancy defect

n8n executions `15917`, `15918`, `15919` (dealer C's `c-c3`, and both `c-c4`
dedupe-probe pushes -- the last 3 of 15 fired) all failed at the
`AI Lead Scoring Agent` node with the same error, before any tenant
resolution or Supabase write:

```
Error: All 3 model tiers failed for lead aliasgher892+c-c4@gmail.com.
Tried: nvidia/nemotron-3.5-lightning:free / openai/gpt-oss-120b,
nvidia/nemotron-3-super-120b-a12b:free / openai/gpt-oss-120b,
minimax/minimax-m2.7:free / openai/gpt-oss-120b
```

This is OpenRouter's free-tier model pool rejecting/rate-limiting requests
after 12 back-to-back real LLM calls from the preceding 12 leads in this same
burst -- an external-provider capacity issue, unrelated to the tenant-
precedence patch, NX1000, or the dealer-B/C fixtures. The other 12 leads
(including dealer C's own c-c1 and c-c2, and the cross-tenant collision
check that depends on all three dealers) scored and landed correctly, which
is itself evidence the tenancy logic was never in the failure path for these
3 -- they never reached it.

## External side effects that actually happened

All 12 successful executions ran real downstream actions per their AI score
(WhatsApp Cloud API / Slack `#sales-hot-leads` / Gmail drip / Bitrix24 ERP
sync as scored), addressed to the `aliasgher892+dealer{a,b,c}@gmail.com` /
`aliasgher892+{customer-id}@gmail.com` plus-alias test contacts and
`+971526647253` / `+918517942172` test phone numbers per `fixtures.json`.
OpenRouter/Groq API costs were incurred for all 15 attempts (12 successful,
3 that exhausted all 3 model tiers before failing).
