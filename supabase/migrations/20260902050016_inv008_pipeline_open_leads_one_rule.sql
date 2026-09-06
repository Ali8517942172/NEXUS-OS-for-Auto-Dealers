-- INV-008 · One number, one derivation — open pipeline, part 1 of 2.
--
-- BUSINESS RULE. "Open pipeline" is the sum of budget_aed over the leads that
-- are still being worked — every lead whose status is NOT in a won or dead
-- state. A lead in an unrecognised state is OPEN: a lead is not finished
-- because a word was not recognised. A lead with no status is OPEN for the
-- same reason. And when no open lead carries a recorded budget the answer is
-- NULL — unknown — not 0. "AED 0 of pipeline" and "no pipeline figure exists"
-- are different statements about the business and only one of them is ever
-- true; coalescing to 0 asserted the first while meaning the second.
--
-- This is the rule already implemented, and owned, by
-- apps/executive-dashboard/lib/pipeline.js (TERMINAL_TONES + isOpenLead +
-- sumBudget), which both screens/overview.js and screens/team.js import. The
-- terminal word list below is copied from the lead-lifecycle block of
-- lib/format.js's TONE table: the values it tones 'won' or 'dead'. Everything
-- else that table tones — 'open', 'hot', 'warm', 'cold', and the 'unknown'
-- fallback for a word nobody has taught it — is open here. Three writers fill
-- leads.status (the Master Router writes HOT/WARM/COLD, the Slack Command
-- Center writes CONTACTED/QUALIFIED/WON/LOST through an unconstrained $fromAI,
-- the BDC agent and silence detector write DISQUALIFIED), so the next word
-- $fromAI invents will arrive without a deploy and must not be read as closed.
--
-- If this list and lib/format.js ever disagree, lib/format.js is the original
-- and this is the copy.
create or replace function public.nexus_lead_is_open(p_status text)
returns boolean
language sql
immutable
as $function$
  -- Normalisation mirrors lib/format.js toneKey(): upper-case, and runs of
  -- whitespace or hyphens folded to a single underscore, so 'Closed Won',
  -- 'closed-won' and 'CLOSED_WON' are one word. NULL and '' fold to '', which
  -- is not in the list and is therefore open.
  select upper(regexp_replace(coalesce(p_status, ''), '[[:space:]-]+', '_', 'g')) not in (
    -- tone 'won'
    'WON', 'CLOSED_WON', 'CONVERTED', 'DELIVERED', 'SOLD',
    -- tone 'dead'
    'LOST', 'CLOSED_LOST', 'DISQUALIFIED', 'UNQUALIFIED', 'CLOSED', 'DEAD',
    'JUNK', 'SPAM', 'ARCHIVED'
  );
$function$;

comment on function public.nexus_lead_is_open(text) is
  'INV-008. True when a lead is still being worked. The database half of the '
  'open-lead rule owned by apps/executive-dashboard/lib/pipeline.js '
  '(TERMINAL_TONES/isOpenLead); the terminal words are the lead-lifecycle '
  'values that lib/format.js tones ''won'' or ''dead''. An unrecognised or '
  'absent status is OPEN — a lead is not finished because a word was not '
  'recognised. Added 2026-09-02.';

grant execute on function public.nexus_lead_is_open(text) to anon, authenticated, service_role;

-- v_team_performance.pipeline_aed was
--   COALESCE(sum(l.budget_aed), 0::bigint)
-- over `users LEFT JOIN leads ON l.assigned_to_id = u.id` — every lead ever
-- assigned to that user, won and dead included, floored at 0 so the column
-- could never say "no figure". It now sums only the open ones and returns NULL
-- when none of them carries a budget. Column name, position and type (bigint,
-- from sum(integer)) are unchanged, so every existing consumer keeps working;
-- what changes is that the column can now be NULL, which is the point.
-- The other columns are untouched and reproduced verbatim from the definition
-- captured by pg_get_viewdef immediately before this migration.
-- security_invoker=true is restated explicitly so the replacement cannot
-- silently drop it.
create or replace view public.v_team_performance
with (security_invoker = true) as
 SELECT u.id,
    u.name,
    u.email,
    u.role,
    u.status,
    count(l.id) AS leads_assigned,
    count(l.id) FILTER (WHERE upper(l.status) = 'HOT'::text) AS hot_leads,
    round(avg(l.response_time_minutes), 1) AS avg_response_minutes,
    count(l.id) FILTER (WHERE l.response_time_minutes <= 5) AS within_sla,
    count(l.id) FILTER (WHERE l.response_time_minutes > 5) AS breached_sla,
    sum(l.budget_aed) FILTER (WHERE public.nexus_lead_is_open(l.status)) AS pipeline_aed
   FROM users u
     LEFT JOIN leads l ON l.assigned_to_id = u.id
  GROUP BY u.id, u.name, u.email, u.role, u.status;

comment on view public.v_team_performance is
  'INV-008. pipeline_aed sums budget_aed over that rep''s OPEN leads only '
  '(public.nexus_lead_is_open) and is NULL — not 0 — when none of them has a '
  'recorded budget. Same rule as apps/executive-dashboard/lib/pipeline.js. '
  'Before 2026-09-02 it was COALESCE(sum(budget_aed), 0) over every lead ever '
  'assigned, won and dead included.';