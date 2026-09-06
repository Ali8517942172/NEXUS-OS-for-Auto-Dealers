-- competitors is an append-only log: the scraper inserts, it does not upsert.
--
-- The audit's proposed fix was to make it upsert on (competitor, model). That
-- would destroy the price history, which is the one thing this table is uniquely
-- placed to hold -- knowing that a rival dropped 8,000 over three weeks is worth
-- more than knowing today's number. The defect was never that history exists; it
-- was that every reader treated a snapshot as a listing, so one car undercut at
-- one price counted four times.
--
-- So: keep the log, and give readers a view that is one row per listing. Any
-- screen counting listings, positions or gaps reads this. Anything charting a
-- price over time reads the base table, which is what it is for.

create or replace view public.v_competitor_latest
with (security_invoker = on)
as
select distinct on (c.competitor, c.model) c.*
  from public.competitors c
 order by c.competitor, c.model, c.scraped_at desc;

comment on view public.v_competitor_latest is
'One row per (competitor, model): the newest snapshot. Read this for any count, comparison or alert. Read the competitors table itself only for price history over time - it holds every scrape, and counting it counts scrapes, not cars.';

-- The scrape rotates 8 units per run twice a day, so the log grows by ~16 rows
-- daily. A read capped at 500 rows starts silently truncating in about a month
-- on a 16-unit fleet, which is how a cap becomes a wrong number rather than a
-- missing one. Indexed so the view stays cheap as the log grows.
create index if not exists competitors_listing_recent_idx
  on public.competitors (competitor, model, scraped_at desc);