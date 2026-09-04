-- ===========================================================================
-- POLICY ENGINE — 04 · one derivation of "is this rule authoritative", and the
--                      two views that make the safe read the easy one
--
-- BUSINESS RULE
-- A consumer must not be able to read an unverified or expired rule and treat
-- it as authoritative BY ACCIDENT. The design principle is: the shortest,
-- most obvious read returns only rules that are in force, in date, and checked
-- against a named source. Reading anything weaker requires naming the weaker
-- surface out loud.
--
--   v_policy_authoritative  — the easy read. Contains ONLY rules that are
--                             verified, in force and in date today. Reading an
--                             unverified rule from here is impossible because
--                             it is not in here.
--   v_policy_rule           — the full register, every version, each one
--                             LABELLED with why it is or is not authoritative.
--                             A consumer selecting from this and ignoring
--                             `authority` has said so out loud.
--
-- AUTHORITY IS ONE FUNCTION. policy_authority() is the single derivation, so a
-- view, a function and a screen cannot each invent their own idea of "current".
-- Note that a SUPERSEDED version IS authoritative for a date inside its own
-- effective span: that is precisely how "the quote issued last March was
-- correct under last March's rule" is answered.
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
    -- Never in force: a proposal, or a rule that was pulled.
    when p_status in ('DRAFT','WITHDRAWN')          then 'NOT_IN_FORCE'
    -- In force from when? A rule with no start date cannot be pinned to a
    -- decision, so it cannot support one.
    when p_effective_from is null                   then 'NO_EFFECTIVE_DATE'
    when p_as_of < p_effective_from                 then 'NOT_YET_EFFECTIVE'
    when p_effective_to is not null
         and p_as_of >= p_effective_to              then 'EXPIRED'
    when p_verification_status = 'DISPUTED'         then 'DISPUTED'
    when p_verification_status = 'NOT_VERIFIED'     then 'NOT_VERIFIED'
    else 'AUTHORITATIVE'
  end;
$$;

comment on function public.policy_authority(text,text,date,date,date) is
  'BUSINESS RULE: the single derivation of whether a policy rule version may be '
  'relied on as of a given date. AUTHORITATIVE requires all four of: a stated '
  'value, a lifecycle that is or was in force, an effective span containing the '
  'date, and VERIFIED provenance. Every other outcome names why not. A '
  'SUPERSEDED version is authoritative FOR A DATE INSIDE ITS OWN SPAN — that is '
  'how a decision taken under a previous rule stays defensible.';

revoke all on function public.policy_authority(text,text,date,date,date) from anon, public;
grant execute on function public.policy_authority(text,text,date,date,date) to authenticated, service_role;

-- ── The full register, every version, each labelled ───────────────────────
create or replace view public.v_policy_rule
with (security_invoker = true) as
select
  r.id,
  r.tenant_id,
  (r.tenant_id is null)                                as is_global_rule,
  r.jurisdiction,
  r.rule_type,
  r.rule_name,
  r.version,
  r.supersedes_id,
  r.value_numeric,
  r.value_text,
  r.unit,
  r.value_kind,
  case
    when r.verification_status = 'UNKNOWN' then null
    when r.value_kind = 'NUMERIC' then
      trim(to_char(r.value_numeric, 'FM999,999,999,990.999999')) || ' ' || r.unit
    else r.value_text
  end                                                  as value_display,
  r.status,
  r.verification_status,
  r.confidence,
  r.effective_from,
  r.effective_to,
  r.source_name,
  r.source_url,
  r.source_document,
  r.verification_date,
  r.verified_by,
  r.added_by,
  r.added_at,
  r.updated_at,
  r.notes,
  a.authority,
  case a.authority
    when 'AUTHORITATIVE'     then 'Verified against ' || coalesce(r.source_name, 'its source')
                                  || ' on ' || to_char(r.verification_date, 'DD Mon YYYY')
                                  || ' and in force today. This rule may be relied on.'
    when 'UNKNOWN'           then 'No value has ever been stated for this rule. It is registered as a question, not as an answer. '
                                  || 'Nothing may be computed from it and no claim may be made on it.'
    when 'NOT_VERIFIED'      then 'A value is recorded but NOBODY HAS CHECKED IT against ' || coalesce(r.source_name, 'any source')
                                  || '. It describes what this system currently does, not what the law or the lender says. '
                                  || 'It may not be quoted to a customer or used in a regulatory claim.'
    when 'DISPUTED'          then 'Sources disagree about this rule. Until that is resolved it may not be relied on.'
    when 'NOT_IN_FORCE'      then 'This version is ' || lower(r.status) || ' — it is not the rule in force.'
    when 'NO_EFFECTIVE_DATE' then 'This version states no effective_from, so it cannot be tied to the date any decision was taken.'
    when 'NOT_YET_EFFECTIVE' then 'This version does not take effect until ' || to_char(r.effective_from, 'DD Mon YYYY') || '.'
    when 'EXPIRED'           then 'This version stopped applying on ' || to_char(r.effective_to, 'DD Mon YYYY')
                                  || '. It remains readable because decisions taken while it applied were correct under it.'
    else 'Unrecognised authority state.'
  end                                                  as authority_reason,
  (a.authority = 'AUTHORITATIVE')                      as may_be_relied_on
from public.policy_rule r
cross join lateral (
  select public.policy_authority(r.status, r.verification_status,
                                 r.effective_from, r.effective_to,
                                 (now() at time zone 'Asia/Dubai')::date) as authority
) a;

comment on view public.v_policy_rule is
  'Every policy rule version this dealership can see — its own plus the global '
  'ones — each labelled with whether it may be relied on TODAY and, in plain '
  'words, why not. A consumer that selects from this view and ignores '
  '`authority` has chosen to; the safe read is v_policy_authoritative.';

-- ── The easy read: only what may actually be relied on ────────────────────
create or replace view public.v_policy_authoritative
with (security_invoker = true) as
select
  id, tenant_id, is_global_rule, jurisdiction, rule_type, rule_name, version,
  value_numeric, value_text, unit, value_kind, value_display,
  effective_from, effective_to,
  source_name, source_url, source_document,
  verification_date, verified_by, confidence,
  coalesce(source_name, '') ||
    case when source_document is not null then ', ' || source_document else '' end ||
    case when source_url is not null then ' (' || source_url || ')' else '' end ||
    ', verified ' || to_char(verification_date, 'DD Mon YYYY') || ' by ' || verified_by
                                                       as citation
from public.v_policy_rule
where authority = 'AUTHORITATIVE';

comment on view public.v_policy_authoritative is
  'The safe read. Contains ONLY rule versions that state a value, are in force '
  'today, are inside their effective span, and were verified against a named '
  'source. A rule that is missing, unverified, expired or disputed is simply '
  'ABSENT here — so a consumer that finds no row must handle "unknown", and '
  'cannot silently receive a value it should not trust. `citation` is the '
  'string a customer-facing claim must carry.';

-- ── The version chain, for reading a rule as it stood on a past date ──────
create or replace view public.v_policy_rule_history
with (security_invoker = true) as
select
  r.tenant_id,
  r.jurisdiction,
  r.rule_type,
  r.rule_name,
  r.version,
  r.id,
  r.supersedes_id,
  r.status,
  r.verification_status,
  r.value_numeric,
  r.value_text,
  r.unit,
  r.effective_from,
  r.effective_to,
  r.source_name,
  r.source_document,
  r.verification_date,
  r.verified_by,
  r.added_by,
  r.added_at,
  prev.value_numeric                                   as previous_value_numeric,
  prev.value_text                                      as previous_value_text,
  prev.effective_from                                  as previous_effective_from,
  prev.effective_to                                    as previous_effective_to,
  prev.source_name                                     as previous_source_name
from public.policy_rule r
left join public.policy_rule prev on prev.id = r.supersedes_id;

comment on view public.v_policy_rule_history is
  'Every version of every visible rule, next to the version it replaced. This '
  'is how "what did this rule say when that quote was issued" is answered '
  'without trusting anybody''s memory. Use policy_numeric_as_of() to resolve a '
  'specific past date.';

revoke all on public.v_policy_rule            from anon, public;
revoke all on public.v_policy_authoritative   from anon, public;
revoke all on public.v_policy_rule_history    from anon, public;
grant select on public.v_policy_rule          to authenticated, service_role;
grant select on public.v_policy_authoritative to authenticated, service_role;
grant select on public.v_policy_rule_history  to authenticated, service_role;
