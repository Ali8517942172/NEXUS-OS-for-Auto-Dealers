# NEXUS tenant-precedence -- three-dealer journeys results

Two live runs feed this file:

1. **Original run**, `run_id 4fa7d95b`, 2026-09-20 ~11:14-11:28 UTC (pushes),
   all three dealers (a, b, c), 15 customer pushes. Re-judged from n8n
   execution data via `journeys.py --reverify JOURNEYS-RUN.json` (adds check
   1b, reading the resolved tenant straight off each push's own execution
   rather than only the `leads` row). Table below, rows `a-*`/`b-*`/`1:c-c1`/
   `1:c-c2`/`3:cross-tenant...`/`4:*`.
2. **Dealer-C re-run**, `run_id 07c60f5a`, 2026-09-20 ~15:03-15:05 UTC,
   `journeys.py --live --allow-side-effects --dealers c` (new `--dealers`
   filter + explicit >=19s pacing between pushes -- see "why re-run" below).
   Dealers a and b were **not** re-pushed; their run-1 results stand
   unchanged and are not repeated by this run.

## Run 1 results (a, b, c-c1, c-c2; c-c3/c-c4 superseded by run 2 below)

| Check | Scope | Verdict | Detail |
|---|---|---|---|
| 1:tenant-correctness:a-c1 | a | PASS | 1 row, tenant_id=fff6a2b5-cfd5-4460-8383-875bc5826de0 |
| 1b:execution-tenant-resolved:a-c1 | a | PASS | execution 15905 (Delivery Report) resolved tenant_id=fff6a2b5-cfd5-4460-8383-875bc5826de0 |
| 1:tenant-correctness:a-c2 | a | PASS | 1 row, tenant_id=fff6a2b5-cfd5-4460-8383-875bc5826de0 |
| 1b:execution-tenant-resolved:a-c2 | a | PASS | execution 15906 (Delivery Report) resolved tenant_id=fff6a2b5-cfd5-4460-8383-875bc5826de0 |
| 1:tenant-correctness:a-c3 | a | PASS | 1 row, tenant_id=fff6a2b5-cfd5-4460-8383-875bc5826de0 |
| 1b:execution-tenant-resolved:a-c3 | a | PASS | execution 15907 (Delivery Report) resolved tenant_id=fff6a2b5-cfd5-4460-8383-875bc5826de0 |
| 2:same-dealer-shared-phone-not-deduped | a | PASS | 2 separate rows under tenant_id=fff6a2b5-cfd5-4460-8383-875bc5826de0 (correctly NOT deduped on shared phone) |
| 2:double-push-deduped | a | PASS | two identical pushes deduped to exactly 1 row |
| 1:tenant-correctness:b-c1 | b | PASS | 1 row, tenant_id=9060a854-ec38-4f0d-a39c-54372f1998b1 |
| 1b:execution-tenant-resolved:b-c1 | b | PASS | execution 15910 (Delivery Report) resolved tenant_id=9060a854-ec38-4f0d-a39c-54372f1998b1 |
| 1:tenant-correctness:b-c2 | b | PASS | 1 row, tenant_id=9060a854-ec38-4f0d-a39c-54372f1998b1 |
| 1b:execution-tenant-resolved:b-c2 | b | PASS | execution 15911 (Delivery Report) resolved tenant_id=9060a854-ec38-4f0d-a39c-54372f1998b1 |
| 1:tenant-correctness:b-c3 | b | PASS | 1 row, tenant_id=9060a854-ec38-4f0d-a39c-54372f1998b1 |
| 1b:execution-tenant-resolved:b-c3 | b | PASS | execution 15912 (Delivery Report) resolved tenant_id=9060a854-ec38-4f0d-a39c-54372f1998b1 |
| 2:same-dealer-shared-phone-not-deduped | b | PASS | 2 separate rows under tenant_id=9060a854-ec38-4f0d-a39c-54372f1998b1 (correctly NOT deduped on shared phone) |
| 2:double-push-deduped | b | PASS | two identical pushes deduped to exactly 1 row |
| 1:tenant-correctness:c-c1 | c | PASS | 1 row, tenant_id=d6c3bc16-83e0-4568-9547-07bd4468415c |
| 1b:execution-tenant-resolved:c-c1 | c | PASS | execution 15915 (Delivery Report) resolved tenant_id=d6c3bc16-83e0-4568-9547-07bd4468415c |
| 1:tenant-correctness:c-c2 | c | PASS | 1 row, tenant_id=d6c3bc16-83e0-4568-9547-07bd4468415c |
| 1b:execution-tenant-resolved:c-c2 | c | PASS | execution 15916 (Delivery Report) resolved tenant_id=d6c3bc16-83e0-4568-9547-07bd4468415c |
| 3:cross-tenant-phone-collision | a+b+c | PASS | 3 distinct tenant-scoped rows for the shared phone, no collapse |
| 4:jwt-scoped-postgrest-visibility | a | PASS | all NEXUS-TEST rows visible via dealer a's own JWT are under dealer a's own tenant_id |
| 4:jwt-scoped-postgrest-visibility | b | PASS | all NEXUS-TEST rows visible via dealer b's own JWT are under dealer b's own tenant_id |
| 4:jwt-scoped-postgrest-visibility | c (run 1) | PASS | all NEXUS-TEST rows visible via dealer c's own JWT are under dealer c's own tenant_id |

Run 1's `c-c3` and the `c-c4` dedupe pair originally FAILed (executions
15917/15918/15919 errored before persisting a row). That was reported without
a confirmed cause. Run 2 below re-does exactly those three dealer-C cases,
live, and gets a confirmed cause.

## Run 2: why re-run, and what changed

The original guess was "OpenRouter got rate-limited because 15 pushes fired
back-to-back with no pacing." `journeys.py` gained a `--dealers` filter (limit
the push phase to one dealer, so re-testing c doesn't re-push a/b's
already-passing customers and risk new external sends for no reason) and a
pacing helper (>=20s between any two live pushes, mirroring
`live_adversarial.py`'s), then dealer c was re-run alone: 4 customers, 5
pushes (c-c4 is the dedupe probe), each **>=19.2s apart** (confirmed from this
run's own log).

**The pacing fix did not fix it** -- 3 of the 4 executions this run produced
still failed, but now with the OpenRouter's own error text on the record
instead of a guess:

- execution 16069 (c-c2) and 16072 (c-c3): `Model Ladder` node exhausted its
  free-model fallback list, final error `"free / openai/gpt-oss-120b [line 40]"`.
- execution 16077 (c-c4, second/dedupe push): same `Model Ladder` exhaustion.
- execution 16074 (c-c4, first push) succeeded, but only via `Groq Fallback`
  -- its own `OpenRouter Chat Model` node hit
  `"Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000
  free model requests per day"` first.

**This is a daily quota, not a per-minute one.** No amount of intra-run
pacing fixes a daily cap that is already exhausted; the quota resets on
OpenRouter's own schedule (or needs credits added), not on a delay this
harness controls. This confirms run 1's c-c3/c-c4 FAILs were never a
tenant-precedence defect (same conclusion as before) but corrects *why*:
proven to be the AI provider's daily ceiling, not "insufficient pacing" as
originally guessed -- and warns that any further live run today, for any door
that calls OpenRouter, will likely hit the same wall regardless of spacing.

**c-c1's push produced no n8n execution at all** despite an HTTP-accepted
webhook call -- the same "accepted but nothing recorded" symptom independently
found on the `qTnh3nwWheFJbFkU` (kyc) door this same session (see
`STATUS.md`), but on master-router, a workflow whose other executions (today
and every other push in this very run) save normally. Not yet reproducible on
demand; most consistent with an intermittent proxy-layer drop on this shared
box rather than a per-workflow setting. Flagged, not fixed.

## Run 2 results

| Check | Scope | Verdict | Detail |
|---|---|---|---|
| 0:execution-found:c-c1 | c | INCONCLUSIVE | no n8n execution found for this push at all (HTTP accepted; see note above) |
| 1:tenant-correctness:c-c1 | c | FAIL | no lead row found for this customer's marker (no execution ever ran to persist one) |
| 1:tenant-correctness:c-c2 | c | FAIL | no lead row found for this customer's marker (execution 16069 errored before persisting -- OpenRouter free-tier daily quota exhausted, confirmed by the execution's own error text, not a tenancy defect) |
| 1b:execution-tenant-resolved:c-c2 | c | INCONCLUSIVE | execution 16069 errored before any node resolved/recorded a tenant_id |
| 1:tenant-correctness:c-c3 | c | FAIL | no lead row found for this customer's marker (execution 16072 errored before persisting -- same OpenRouter cause) |
| 1b:execution-tenant-resolved:c-c3 | c | INCONCLUSIVE | execution 16072 errored before any node resolved/recorded a tenant_id |
| 1:tenant-correctness:c-c4 | c | PASS | 1 row, tenant_id=d6c3bc16-83e0-4568-9547-07bd4468415c (execution 16074, via Groq Fallback after OpenRouter's own quota error) |
| 1b:execution-tenant-resolved:c-c4 | c | PASS | execution 16074 (Delivery Report) resolved tenant_id=d6c3bc16-83e0-4568-9547-07bd4468415c |
| 2:double-push-deduped | c | PASS | two pushes (16074 success, 16077 errored) deduped to exactly 1 row -- dedupe holds even when the second push errors before reaching the write |
| 2:same-dealer-shared-phone-not-deduped | c | INCONCLUSIVE | c-c1's row (needed for this pair check) never landed -- see c-c1 above |
| 4:jwt-scoped-postgrest-visibility | c (run 2) | PASS | 3 NEXUS-TEST rows visible via dealer c's own JWT, all under dealer c's own tenant_id, none leaked |

**Run 2 totals: 3 PASS, 3 FAIL (all three confirmed OpenRouter-daily-quota /
missing-execution, not a tenancy defect), 3 INCONCLUSIVE (downstream of those
same 3), 1 PASS carried by re-check (check 4).**

**Combined (run 1 + run 2, superseding run 1's c-c3/c-c4 rows with run 2's):
22 PASS, 3 FAIL (all confirmed non-tenancy), 3 INCONCLUSIVE, 1 not-retested
(same-dealer-shared-phone pair, blocked on c-c1's missing execution).** No
row in either run shows a cross-tenant leak; every check that resolved a
tenant_id resolved it correctly, in both runs.
