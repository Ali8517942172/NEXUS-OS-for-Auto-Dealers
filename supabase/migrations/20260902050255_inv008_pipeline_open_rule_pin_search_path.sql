-- INV-008 · open pipeline — housekeeping for the predicate added by
-- inv008_pipeline_open_leads_one_rule.
--
-- BUSINESS RULE unchanged: a lead is open unless its status is a won or dead
-- word; the list and the normalisation below are byte-for-byte the ones that
-- migration installed. The only change is `SET search_path = ''`, which
-- silences the function_search_path_mutable advisor warning this function
-- introduced. It is safe to pin here precisely because the body references no
-- table, no operator class and no other function — only built-ins — so an
-- empty search_path cannot change what it returns. Re-verified against
-- lib/pipeline.js over the full 72-value status vocabulary after applying.
create or replace function public.nexus_lead_is_open(p_status text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select upper(regexp_replace(coalesce(p_status, ''), '[[:space:]-]+', '_', 'g')) not in (
    -- tone 'won'
    'WON', 'CLOSED_WON', 'CONVERTED', 'DELIVERED', 'SOLD',
    -- tone 'dead'
    'LOST', 'CLOSED_LOST', 'DISQUALIFIED', 'UNQUALIFIED', 'CLOSED', 'DEAD',
    'JUNK', 'SPAM', 'ARCHIVED'
  );
$function$;