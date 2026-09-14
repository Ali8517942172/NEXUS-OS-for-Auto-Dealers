-- NX920 — A score now says who decided it.
--
-- Applied to production dsvuoovivysszdoiorch on 2026-09-14 as
-- nx920_a_score_now_says_who_decided_it. This file mirrors production.
--
-- Until today a lead scored 50/WARM by a regex scraping model babble was
-- byte-identical to a lead scored 50/WARM by the model itself, and an empty
-- model response `{}` produced a confident-looking WARM/50 as well. Every
-- metric built on ai_score mixed the three together.
--
-- Owner decision, 14 Sep 2026 (ops/ADR-003-who-decides-the-score.md): with zero
-- paying dealers the model ladder is entirely free-tier and none of those
-- models support structured output, so the DETERMINISTIC RULES are
-- authoritative and the model is a labelled, non-authoritative signal. At two
-- paying dealers the paid model arrives with structured output and the labels
-- flip -- no schema change needed.

alter table public.leads
  add column if not exists score_source    text,
  add column if not exists rules_score     integer,
  add column if not exists ai_score_raw    integer,
  add column if not exists ai_intent_raw   text,
  add column if not exists ai_parse_failed boolean;

-- UNKNOWN is the honest value for everything written before today. It is not
-- zero and it is not confirmed.
update public.leads
   set score_source = 'AI_SCORE_UNKNOWN'
 where score_source is null;

alter table public.leads
  alter column score_source set default 'AI_SCORE_UNKNOWN';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'leads_score_source_is_a_known_label'
  ) then
    alter table public.leads
      add constraint leads_score_source_is_a_known_label
      check (score_source in (
        'RULES',                -- deterministic rules decided; authoritative today
        'AI_SCORE_CONFIRMED',   -- model returned valid structured JSON with both fields
        'AI_SCORE_FALLBACK',    -- regex scraped prose, or the model returned {}
        'AI_SCORE_UNKNOWN'      -- provenance was never recorded
      ));
  end if;
end $$;

comment on column public.leads.score_source is
  'Who decided ai_score. Never aggregate across these labels -- a FALLBACK 50 '
  'and a CONFIRMED 50 are not the same number.';
comment on column public.leads.rules_score is
  'Deterministic rules score. Authoritative while score_source = RULES.';
comment on column public.leads.ai_score_raw is
  'What the model said, kept for comparison. Not authoritative unless '
  'score_source = AI_SCORE_CONFIRMED.';

-- The metric that refuses to mix the labels -----------------------------------
create or replace function public.nexus_scoring_health()
returns table(score_source text, leads bigint, avg_score numeric, note text)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select
    l.score_source,
    count(*)::bigint,
    round(avg(l.ai_score)::numeric, 1),
    case l.score_source
      when 'RULES'              then 'Deterministic. Authoritative today.'
      when 'AI_SCORE_CONFIRMED' then 'Model returned valid structured JSON.'
      when 'AI_SCORE_FALLBACK'  then 'NOT A MODEL VERDICT. Regex scrape or empty response. Do not report as AI accuracy.'
      when 'AI_SCORE_UNKNOWN'   then 'Provenance never recorded. UNKNOWN is not ZERO.'
      else 'Unlabelled.'
    end
  from public.leads l
  group by l.score_source
  order by l.score_source;
$fn$;

revoke all on function public.nexus_scoring_health() from public, anon;
grant execute on function public.nexus_scoring_health() to authenticated, service_role;
