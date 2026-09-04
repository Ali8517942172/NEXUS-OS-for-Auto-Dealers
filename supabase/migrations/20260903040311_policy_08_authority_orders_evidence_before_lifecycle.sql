-- ===========================================================================
-- POLICY ENGINE — 08 · authority reports the EVIDENCE failure first
--
-- BUSINESS RULE
-- When a rule fails to be authoritative for more than one reason, the reason
-- reported must be the one the reader has to act on. "Nobody has checked this
-- against a source" outranks "this version is a draft": the draft flag is a
-- workflow state that a click fixes, the missing source is the reason the
-- number may not reach a customer at all.
--
-- This reordering is strictly SAFER, not looser: no input that previously
-- returned a non-AUTHORITATIVE label now returns AUTHORITATIVE. It only changes
-- WHICH refusal is named. Verified but draft still reads NOT_IN_FORCE.
-- ===========================================================================

create or replace function public.policy_authority(
  p_status              text,
  p_verification_status text,
  p_effective_from      date,
  p_effective_to        date,
  p_as_of               date
) returns text
language sql
immutable
set search_path to 'public', 'pg_catalog'
as $$
  select case
    -- No value is stated at all. Nothing downstream may proceed from this.
    when p_verification_status = 'UNKNOWN'          then 'UNKNOWN'
    -- A value exists but nobody has checked it. This is the reason that stops
    -- it reaching a customer, so it is the reason that gets reported.
    when p_verification_status = 'NOT_VERIFIED'     then 'NOT_VERIFIED'
    when p_verification_status = 'DISPUTED'         then 'DISPUTED'
    -- Verified, but not the version in force.
    when p_status in ('DRAFT','WITHDRAWN')          then 'NOT_IN_FORCE'
    -- In force from when? A rule with no start date cannot be pinned to the
    -- date a decision was taken, so it cannot support one.
    when p_effective_from is null                   then 'NO_EFFECTIVE_DATE'
    when p_as_of < p_effective_from                 then 'NOT_YET_EFFECTIVE'
    when p_effective_to is not null
         and p_as_of >= p_effective_to              then 'EXPIRED'
    else 'AUTHORITATIVE'
  end;
$$;

comment on function public.policy_authority(text,text,date,date,date) is
  'BUSINESS RULE: the single derivation of whether a policy rule version may be '
  'relied on as of a given date. AUTHORITATIVE requires all four of: a stated '
  'value, VERIFIED provenance, a lifecycle that is or was in force, and an '
  'effective span containing the date. Every other outcome names why not, and '
  'names the EVIDENCE failure ahead of the lifecycle one because that is the '
  'one that stops a number reaching a customer. A SUPERSEDED version is '
  'authoritative FOR A DATE INSIDE ITS OWN SPAN — that is how a decision taken '
  'under a previous rule stays defensible.';

revoke execute on function public.policy_authority(text,text,date,date,date) from anon, public;
grant execute on function public.policy_authority(text,text,date,date,date) to authenticated, service_role;
