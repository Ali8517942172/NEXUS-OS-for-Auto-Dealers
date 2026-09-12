# One question, four answers, and a filter that can never match

8-9 September 2026. Production `dsvuoovivysszdoiorch`, staging `wwspuxrbiyagnrnzgate`.
Every number below is a query result, quoted with the query that produced it.

## What I set out to do, and why that was wrong

The plan was: `screens/competitors.js` hardcodes which match qualities it will
draw a conclusion from, while `v_inventory_profit_sentinel` reads a per-tenant
setting. Make the screen read the setting, and the third divergence closes.

Measuring first changed the answer. **Making the screen obey that setting would
have propagated the defect to a third surface rather than removing it**, because
the setting names two grades this system has never been able to produce.

## The measurement

The producer's vocabulary, documented by the migration that created the column —
`supabase/migrations/20260901042906_competitors_listing_provenance_columns.sql:18`:

```
add column if not exists match_quality   text,   -- exact_year | model_only | weak
```

and its column comment, same file:

> `exact_year` = the chosen offer named our model year; `model_only` = model name
> matched but no year confirmation; `weak` = the price is the lowest on the page
> with nothing tying it to our unit.

The consumer's vocabulary — `supabase/baseline/00000000000000_baseline.sql:7558`
and `supabase/sentinel/sentinel_01_holding_rate_provenance.sql:86`:

```
alter column accepted_market_match_quality set default array['exact','strong']
```

**`exact` and `strong` are not values this system writes.** Not by the scraper,
not by the demo seed, not anywhere. The highest grade the producer can emit —
`exact_year` — is rejected by the default accepted set, because it is not spelled
the way the consumer expects.

What is actually on production:

```sql
select coalesce(match_quality,'(null)') q, count(*) from competitors group by 1;
--  (null)      9
--  weak        9
--  model_only  4
```

```sql
select tenant_id, accepted_market_match_quality from inventory_profit_settings;
--  fff6a2b5-… (ALBA)   {exact,strong}
```

How many of the 22 rows pass, under each candidate accepted set:

```sql
select
  count(*) filter (where lower(coalesce(match_quality,'')) = any(array['exact','strong']))          as pass_current_default,
  count(*) filter (where lower(coalesce(match_quality,'')) = any(array['exact_year']))              as pass_exact_year,
  count(*) filter (where lower(coalesce(match_quality,'')) = any(array['exact_year','model_only'])) as pass_exact_or_model,
  count(*) as total
from competitors;
--  0 | 0 | 4 | 22
```

And the downstream effect, today, on the product's own economic authority:

```sql
select market_position, count(*) from v_inventory_profit_sentinel group by 1;
--  UNKNOWN_UNVERIFIED_COMPARABLE   7
--  UNKNOWN_NO_COMPARABLE           5
```

Twelve units, **zero** with a usable market position.

## Two separate facts that look like one

They must not be collapsed: different fixes, different lifetimes.

1. **The vocabularies do not intersect.** `{exact,strong}` cannot match
   `{exact_year,model_only,weak}` for any input whatsoever. A defect in the code,
   permanent until someone changes a string.
2. **Production holds no `exact_year` row.** `pass_exact_year = 0`. Separately
   true, and about the data rather than the code.

Because (2) holds, fixing (1) alone changes **nothing visible today**: 0 rows pass
before, 0 after. It changes everything on the first day the scraper produces a
good match — which, under the current code, would be silently discarded and
reported as "no verified comparable".

That is why this survived a week. An empty result reads as *"we have no good
data"*, a sentence about the dealership. The true sentence was *"these two ends
do not speak the same language"*, a sentence about us.

## What I could not establish

**Whether the scraper can emit `exact_year` at all.** UNKNOWN, not zero. No
workflow JSON in this repo writes `match_quality` — `grep -rl match_quality
--include=*.json` returns only dashboard gate fixtures — so the writer lives on
the n8n box and was not read. `pass_exact_year = 0` is consistent with both "can
emit it, has not yet" and "never emits it". The strongest claim available: no
`exact_year` row has ever reached this table.

## The staging proof of the held migration was weaker than I reported

`ops/migrations-held/20260908120000_…sql` was proven on staging: undercut alerts
7 → 1, the survivor being the single `strong` row. I presented that survivor as a
positive control showing the filter keeps trustworthy rows. It does not show that.

```sql
-- staging wwspuxrbiyagnrnzgate
select coalesce(match_quality,'(null)') q, count(*), min(scraped_at) from competitors group by 1;
--  weak        4
--  model_only  3
--  (null)      1
--  strong      1   2026-08-12
```

That `strong` row is seed data written in the *consumer's* vocabulary. The scraper
cannot produce it. So the run proved that a SQL predicate filters on the column it
names — never in doubt — and did **not** prove the rule admits real trustworthy
rows, because no real trustworthy row was present to admit. The 7 → 1 number
stands; the meaning I attached to it does not.

The production prediction in that file (3 → 0) remains correct, but its stated
reason — "not one of them rests on a comparison this dealership's own setting
accepts" — is only half true. They would have gone to 0 even if every row were a
perfect `exact_year` match.

## Four answers to one question, corrected

| # | Surface | Rule today | Vocabulary | Verdict |
|---|---|---|---|---|
| 1 | `v_inventory_profit_sentinel` | per-tenant `accepted_market_match_quality` | `{exact,strong}` | configurable, and structurally empty |
| 2 | `screens/competitors.js` | hardcoded `concludes` per grade | `exact_year`, `model_only`, `unrated` true; `weak` false | not configurable, but **the only surface speaking the producer's language** |
| 3 | `v_needs_attention` | none | — | addressed by the held migration |
| 4 | the producer | writes `exact_year\|model_only\|weak` | — | canonical by definition |

The screen is currently the *most* correct surface. That is the reversal.

## Fix order

1. **Reconcile the vocabulary** — held at
   `ops/f2-tenant-rule/held/20260909_the_accepted_set_named_two_grades_that_are_never_written.sql`.
   The producer's spelling is canonical; the setting moves to it.
2. **Guard against re-drift, asymmetrically.** Reject a *configuration* naming a
   grade that cannot exist — cheap, rare, human, always a mistake. Do **not**
   reject a *scrape* carrying an unfamiliar grade: a dealer is better served by a
   row with an unreadable quality (the screen already renders that as `unrated`)
   than by no row at all. Block config errors; surface data anomalies. Both are
   `CREATE TRIGGER`, which does not fire `nexus_guard_born_open_grants()`.
3. **Then** make the views and the screen read the setting. Not before: a screen
   obeying an impossible setting shows an empty table and blames the data.
4. **Then** re-run the held `v_needs_attention` staging proof against a row the
   scraper could actually have written.

## Still owed by the owner

Whether `model_only` counts as good enough to act on. One UPDATE. In the
producer's vocabulary the consequences are measured, not estimated:

- `{exact_year}` — 0 of 22 rows pass today. Undercut alerts 3 → 0. Sentinel stays
  12 UNKNOWN. Strictest, and honest.
- `{exact_year, model_only}` — 4 of 22 pass. Admits "the model name matched but no
  year was confirmed" — possibly a different model year of the same car. On a
  used-car gap of five figures, one model year is often the whole gap.

I am not choosing this. It is a commercial risk appetite, not a technical fact.
