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

---

# Corrections from cross-check, 12 September 2026

Five reviewer agents attacked this document and the wave around it. Three of its
claims did not survive intact. Full evidence in `ops/crosscheck/`.

## The screen is wrong too, and I graded it on the wrong axis

Above, I called `screens/competitors.js` "the most correct surface" and reversed
the fix order on that basis. The vocabulary half of that judgement holds. The
judgement itself was too generous, because I graded the screen on *which words it
knows* and never checked *what its verdict gates*.

`QUALITY.unrated` carries `concludes: true`. `unrated` is the ABSENCE of a rating
— 9 of 22 production rows are null-quality — and `concludes` is what gates the
percentage and the market position at `competitors.js:900` and `:905`. The file's
own doctrine, written three hundred lines above, is that "a percentage IS the
conclusion". So a row whose tie to our car was never established is permitted to
support a price position, while `weak` — a row the scraper actively rated as
untied — is not. The unchecked row outranks the checked-and-failed one.

The scraper's measured base rate is 0% `exact_year`, 31% `model_only`, 69% `weak`.
If the 9 unrated rows had been rated, roughly 6 of them would have come back
`weak`. Treating them as conclusive is not neutral; it is optimistic by default,
which is the same failure as `REAL unless marked test` that the provenance
contract exists to prevent.

Correct behaviour: show the row and the absolute gap, withhold the percentage and
the market position, and give the reason its own words — distinct from `weak`'s,
because "never checked" and "checked and failed" are different sentences and the
screen is otherwise scrupulous about exactly that distinction. `concludes: false`,
for a different reason.

Related, same file, `:858`: any grade the screen has no words for is coerced to
`unrated` — and therefore inherits conclusive authority. That now couples to the
20260912 migration's deliberate choice to *surface* unknown producer grades rather
than reject them. Surfacing them is still right; letting them conclude is not.

## The fix order was right, for one reason more than I knew

The reversal stands and gains a third leg. `ops/migrations-held/20260908120000_…`
repeated `array['exact','strong']` as its **own fallback inside the view body**. A
literal in a view body cannot be reached by a migration that corrects a column
DEFAULT and its existing rows, so the dead vocabulary would have survived in
`v_needs_attention` in either apply order — in the file most recently reviewed and
therefore least likely to be re-read. Fixed on 12 Sep: the fallback now reads the
catalogue, which makes that file depend on this one. **Apply 20260912 first.**

## Patient zero has a name, and the guard would have broken it

`ops/demo/seed_demo_tenant.sql` seeds `array['exact','strong']` at line 204 and
writes `weak` / `model_only` / `null` competitor rows at line 434. One file, both
vocabularies, neither matching the other. That is why `{exact,strong}` looked
verified: the only place the two ends were ever written together wrote them
inconsistently, and the demo tenant never had enough rows for anyone to notice.

It is also why staging held a single `strong` row dated 2026-08-12 — the one I
presented as a positive control. Origin now settled: `seed_demo_tenant.sql:434`.
Not scraper output. Seed.

Consequence neither held file had noticed: once the 20260912 guard lands, seeding
a demo tenant raises `23514`. The seed is corrected in the same commit.

## `exact_year` is not emittable from anything in this repo — settled

Marked UNKNOWN above; now resolved as far as the repo can resolve it.
`competitor_price_scraping_supabase_update.json` is the only repo file writing
`tableId:"competitors"`, and it contains **zero** occurrences of `match_quality`,
`listing_title`, `source_kind`, `offer_name`, `offer_condition` or `match_note`.
Production holds 13 non-null `match_quality` values and 13 `source_kind='unknown'`,
so the deployed node is newer than the repo copy and **the repo copy is stale**.
The writer exists only inside the deployed `Competitor Price Scraping` workflow on
the n8n box. This cannot be closed from the repo, and the honest status is that
NEXUS's scraper is a component whose source of truth is not in version control.

## It is a class. Five live instances, not one

The pattern — a producer writes one vocabulary, a consumer filters on another, the
empty result reads as absent data — is not confined to `match_quality`. Measured:

| Producer | Consumer | Effect |
|---|---|---|
| `competitors.match_quality` | `accepted_market_match_quality` | 0 of 22 pass; 12 units, no market position |
| `audit_log.workflow` | `nexus_workflow_catalogue()` | 9 rows invisible in `v_workflow_health`; 4 registry rows render `NEVER_RAN` with an empty alias map |
| `audit_log.summary` prose | `nexus_outcome_class()` 5-substring regex | 13 of 53 Finance Calc refusals counted as runs producing nothing |
| `attribution_edge_type.state` | `v_attribution_link_map` | a hop refused **by design** prints as "nothing has happened yet" |
| `leads.status` | `overview.js` KPI trio | counts **3 of 6** leads; `NEW` belongs to no documented writer |

The last one is the one a dealership would notice first: the summary screen
undercounts its own pipeline by half, and does it by hardcoding what the detail
screen derives from reality — the same reversal found here, in a second place.

The counter-example matters too. `nexus_outcome_class` translates `FAILED→FAILURE`
and classifies **0 of 1018 rows** as UNKNOWN. The correct pattern already exists in
this codebase; it simply was not applied consistently.
