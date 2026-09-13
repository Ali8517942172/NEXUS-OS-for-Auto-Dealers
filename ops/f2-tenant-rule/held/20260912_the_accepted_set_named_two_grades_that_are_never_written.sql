-- The accepted set named two grades that are never written
-- =========================================================
-- 12 September 2026. HELD — not applied to any project.
-- Evidence: ops/f2-tenant-rule/RECONCILIATION.md
--
-- WHAT IS WRONG. `competitors.match_quality` is written with the vocabulary
-- `exact_year | model_only | weak` (documented at
-- supabase/migrations/20260901042906_competitors_listing_provenance_columns.sql:18
-- and in the column COMMENT). `inventory_profit_settings
-- .accepted_market_match_quality` defaults to `{exact,strong}`. Those two sets do
-- not intersect. `v_inventory_profit_sentinel` compares one against the other, so
-- it rejects every row for every input — including the strongest grade the
-- scraper can emit. Measured on production: 0 of 22 rows pass; the sentinel
-- reports 7 UNKNOWN_UNVERIFIED_COMPARABLE + 5 UNKNOWN_NO_COMPARABLE, i.e. twelve
-- units and no usable market position, permanently.
--
-- WHY IT SURVIVED. Production also happens to hold no `exact_year` row
-- (`pass_exact_year = 0`), so the empty output was read as "we have no good
-- data" — a sentence about the dealership — when the true sentence was "these
-- two ends do not speak the same language", a sentence about us.
--
-- WHAT THIS CHANGES TODAY: NOTHING VISIBLE. 0 rows passed before, 0 pass after.
-- It changes the first day the scraper produces a good match, which under the
-- current code would be discarded in silence. That is the whole value of this
-- migration and it should not be oversold as anything more.
--
-- WHAT IS DELIBERATELY NOT DONE HERE.
--   * `screens/competitors.js` is NOT changed to read this setting. It speaks the
--     producer's vocabulary already and is currently the most correct surface;
--     making it obey the setting before the setting is correct would propagate
--     the defect to a third place. That change comes after this one lands.
--   * `model_only` is NOT added to any tenant's accepted set. That is a
--     commercial risk decision the owner owns: `{exact_year}` passes 0 of 22 rows
--     today, `{exact_year,model_only}` passes 4, and `model_only` means the model
--     name matched with no year confirmed — on a five-figure used-car gap, one
--     model year is often the whole gap.
--
-- WHAT REMAINS UNKNOWN, NOT ZERO. Whether the scraper can emit `exact_year` at
-- all. No file in this repo writes `match_quality` (`grep -rl match_quality
-- --include=*.json` returns only dashboard gate fixtures), so the writer lives on
-- the n8n box and has not been read. This migration assumes the documented
-- vocabulary is the real one. If the live node writes something else, step 3's
-- drift report will say so on the next scrape rather than filtering to nothing.
--
-- EVENT-TRIGGER SAFETY, verified against both function bodies on 12 Sep
-- (ops/crosscheck/X1-the-guard-fires-on-everything.md):
--   * `nexus_guard_born_open_grants` has evttags = NULL and fires on EVERY DDL,
--     including CREATE TRIGGER. It matches no branch for object_type 'trigger',
--     so it revokes nothing here. The `ALTER TABLE` in step 1 DOES match the
--     table branch: it revokes `all` from `anon` and `insert,update,delete,
--     truncate` from `authenticated` on inventory_profit_settings. Step 4
--     re-asserts and step 5 verifies, because that guard swallows its own
--     exceptions and cannot report a REVOKE that failed.
--   * `nexus_guard_security_invoker_views` lists ALTER TABLE among its tags and
--     so fires on step 1, but filters to object_type='view' and finds none.
--     No view is created here; if one ever is, `security_invoker = on` must be
--     INLINED in the CREATE — a following ALTER VIEW is too late (42501).

begin;

-- 1. The vocabulary, stated once, as data. -----------------------------------
-- A catalogue rather than a CHECK constraint: a CHECK holds a private copy of
-- the list, and a private copy is how the two ends drifted in the first place.

create table if not exists public.market_match_quality_kind (
  kind          text primary key,
  rank          int  not null,           -- higher = stronger tie to our car
  is_conclusive boolean not null,        -- may a price position be drawn from it
  written_by    text not null,           -- who emits this value
  note          text not null
);

insert into public.market_match_quality_kind (kind, rank, is_conclusive, written_by, note) values
  ('exact_year',  30, true,  'scraper',
   'The chosen offer named our model year. The strongest tie the data carries.'),
  ('model_only',  20, true,  'scraper',
   'Model name matched, no year confirmation. May be a different model year of the same car.'),
  ('weak',        10, false, 'scraper',
   'Nothing on the page ties the price to our car. Kept as context; no position is drawn from it.')
on conflict (kind) do nothing;

comment on table public.market_match_quality_kind is
'The one place `competitors.match_quality` values are defined. A tenant may not '
'accept a grade absent from this table, and a scrape carrying an unlisted grade '
'is surfaced by v_market_match_quality_drift rather than rejected — see step 3 '
'for why those two directions are deliberately asymmetric.';

-- 2. Correct the setting, and stop it drifting again. ------------------------
-- The producer's spelling is canonical: it is the end that actually writes.

alter table public.inventory_profit_settings
  alter column accepted_market_match_quality
  set default array['exact_year']::text[];

update public.inventory_profit_settings
   set accepted_market_match_quality = array['exact_year']::text[]
 where accepted_market_match_quality @> array['exact']
    or accepted_market_match_quality @> array['strong'];

-- CREATE TRIGGER, not ALTER TABLE ... ADD CONSTRAINT: the guard matches no
-- branch for a trigger, so this costs no grants.
create or replace function public.nexus_check_accepted_match_quality()
returns trigger language plpgsql as $$
declare bad text[];
begin
  select array_agg(q) into bad
    from unnest(coalesce(new.accepted_market_match_quality, '{}')) q
   where not exists (select 1 from public.market_match_quality_kind k where k.kind = q);
  if bad is not null then
    raise exception
      'NEXUS: accepted_market_match_quality names grade(s) % that are never written',
      array_to_string(bad,', ')
      using errcode = '23514',
            detail  = 'A grade no producer emits makes this filter match nothing, '
                      'and an empty result is indistinguishable from having no good data.',
            hint    = 'Valid grades are in public.market_match_quality_kind.';
  end if;
  return new;
end $$;

drop trigger if exists nexus_check_accepted_match_quality on public.inventory_profit_settings;
create trigger nexus_check_accepted_match_quality
  before insert or update of accepted_market_match_quality
  on public.inventory_profit_settings
  for each row execute function public.nexus_check_accepted_match_quality();

-- 3. Surface producer drift instead of blocking it. --------------------------
-- Asymmetric on purpose. A tenant configuring a grade that cannot exist is a
-- human mistake, cheap and rare: reject it (step 2). A scrape carrying a grade
-- we do not recognise is a machine surprise, and a dealer is better served by
-- the row with an unreadable quality — screens/competitors.js already renders
-- that state as `unrated` — than by no row at all. Block config, surface data.

create or replace view public.v_market_match_quality_drift
  with (security_invoker = on) as
select c.tenant_id,
       coalesce(c.match_quality,'(null)') as written_value,
       count(*)                          as rows_affected,
       max(c.scraped_at)                 as last_seen,
       (c.match_quality is not null
        and not exists (select 1 from public.market_match_quality_kind k
                         where k.kind = lower(c.match_quality))) as is_unknown_grade
  from public.competitors c
 group by c.tenant_id, c.match_quality;

comment on view public.v_market_match_quality_drift is
'Every match_quality value actually present, per tenant, with is_unknown_grade '
'true for any the catalogue does not define. If this view ever returns a true '
'row, a producer and a consumer have drifted and something downstream is '
'filtering to nothing while looking like an absence of data.';

commit;

-- 4/5. VERIFY AFTER APPLYING — outcome, not mechanism. -----------------------
-- The grant guard swallows its own exceptions, so a failed REVOKE is silent and
-- so is a failed re-grant. Run these and read the results; do not assume.
--
--   -- (a) the ALTER TABLE in step 2 fired the grant guard. Re-assert and check.
--   grant select on public.inventory_profit_settings to authenticated;
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema='public' and table_name='inventory_profit_settings'
--    order by 1,2;
--   -- EXPECT: authenticated SELECT present; anon absent entirely.
--
--   -- (b) nothing accepts an impossible grade any more
--   select tenant_id, accepted_market_match_quality from public.inventory_profit_settings;
--   -- EXPECT: every row {exact_year}. No 'exact', no 'strong'.
--
--   -- (c) the guard works
--   update public.inventory_profit_settings set accepted_market_match_quality = array['strong'];
--   -- EXPECT: 23514, 'names grade(s) strong that are never written'. Roll back.
--
--   -- (d) drift is visible, and today should report no unknown grades
--   select * from public.v_market_match_quality_drift where is_unknown_grade;
--   -- EXPECT on production today: 0 rows (values present are weak, model_only, null).
--
--   -- (e) the honest no-change check
--   select count(*) filter (where lower(coalesce(match_quality,'')) = 'exact_year') from public.competitors;
--   -- EXPECT: 0. This migration is a landmine removal, not a visible improvement.
