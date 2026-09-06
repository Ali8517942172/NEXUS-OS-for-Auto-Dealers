-- ===========================================================================
-- POLICY ENGINE — 05 · the fail-closed readers
--
-- BUSINESS RULE
-- A model, a workflow or a screen asking the Policy Engine for a number must
-- either get a VERIFIED, in-force, in-date number, or an ERROR. It must never
-- get a plausible-looking value it is not entitled to rely on, and it must
-- never get NULL where NULL could be coerced to zero — an AED 50/day holding
-- cost and a 5% VAT literal both reached a manager-facing figure precisely
-- because nothing ever refused.
--
-- So:
--   policy_numeric()            raises when there is no authoritative rule.
--                               This is the default call. It cannot return a
--                               value you may not use.
--   policy_numeric_as_of()      the same, resolved against a PAST date, so a
--                               decision taken under a previous version can be
--                               re-derived exactly as it was.
--   policy_citation()           the sourced sentence a customer-facing claim
--                               must carry. Raises when there is nothing to
--                               cite — which is the point.
--   policy_read_unverified_rule() the deliberate unsafe read. It is named so
--                               that using it appears in the diff, and it
--                               returns the authority label alongside the
--                               value so the caller cannot pretend not to know.
--
-- TENANT RESOLUTION. A dealership's own rule beats the global rule for its
-- jurisdiction; if it has none, the global rule applies. These are SECURITY
-- INVOKER, so RLS decides what the caller can see and no tenant can resolve
-- another tenant's rule.
-- ===========================================================================

create or replace function public.policy_numeric_as_of(
  p_jurisdiction text,
  p_rule_type    text,
  p_rule_name    text,
  p_as_of        date
) returns numeric
language plpgsql
stable
set search_path to 'public', 'pg_catalog'
as $$
declare
  r     record;
  n_any integer;
begin
  select v.*
    into r
    from public.v_policy_rule v
   where v.jurisdiction = upper(p_jurisdiction)
     and v.rule_type    = upper(p_rule_type)
     and v.rule_name    = upper(p_rule_name)
     and public.policy_authority(v.status, v.verification_status,
                                 v.effective_from, v.effective_to, p_as_of) = 'AUTHORITATIVE'
     -- A dealership's own rule outranks the global one for the same name.
     order by (v.tenant_id is null), v.version desc
   limit 1;

  if found then
    if r.value_kind <> 'NUMERIC' then
      raise exception using
        errcode = '22023',
        message = format('Policy rule %s/%s/%s is not numeric — its unit is %s.',
                         upper(p_jurisdiction), upper(p_rule_type), upper(p_rule_name), r.unit),
        hint    = 'Read it from v_policy_authoritative as value_text.';
    end if;
    return r.value_numeric;
  end if;

  -- Nothing authoritative. Say exactly why, and never suggest a number.
  select count(*) into n_any
    from public.v_policy_rule v
   where v.jurisdiction = upper(p_jurisdiction)
     and v.rule_type    = upper(p_rule_type)
     and v.rule_name    = upper(p_rule_name);

  if n_any = 0 then
    raise exception using
      errcode = 'P0002',
      message = format('No policy rule %s/%s/%s exists as of %s.',
                       upper(p_jurisdiction), upper(p_rule_type), upper(p_rule_name), p_as_of),
      hint    = 'UNKNOWN is the answer. Do not infer, estimate or default a value. '
                'Record the rule in policy_rule with its source, get it verified, then ask again.';
  else
    raise exception using
      errcode = 'P0002',
      message = format('Policy rule %s/%s/%s exists but no version is authoritative as of %s.',
                       upper(p_jurisdiction), upper(p_rule_type), upper(p_rule_name), p_as_of),
      hint    = 'Read v_policy_rule for that rule: `authority_reason` says whether it is unverified, '
                'expired, not yet effective, disputed or never in force. Until it is verified and in '
                'date, the answer is UNKNOWN — not the value sitting in the row.';
  end if;
end;
$$;

comment on function public.policy_numeric_as_of(text,text,text,date) is
  'BUSINESS RULE: a numeric policy value, resolved as it stood on a given date, '
  'or an error. Never a value the caller is not entitled to rely on, and never '
  'NULL — because NULL becomes zero somewhere downstream. A tenant''s own rule '
  'outranks the global rule of the same name.';

create or replace function public.policy_numeric(
  p_jurisdiction text,
  p_rule_type    text,
  p_rule_name    text
) returns numeric
language sql
stable
set search_path to 'public', 'pg_catalog'
as $$
  select public.policy_numeric_as_of(p_jurisdiction, p_rule_type, p_rule_name,
                                     (now() at time zone 'Asia/Dubai')::date);
$$;

comment on function public.policy_numeric(text,text,text) is
  'Today''s authoritative numeric value for a rule, or an error. The default '
  'call. Dealership clock is Asia/Dubai, matching every other date derivation '
  'in this system.';

create or replace function public.policy_citation(
  p_jurisdiction text,
  p_rule_type    text,
  p_rule_name    text
) returns text
language plpgsql
stable
set search_path to 'public', 'pg_catalog'
as $$
declare v_cite text;
begin
  select a.citation into v_cite
    from public.v_policy_authoritative a
   where a.jurisdiction = upper(p_jurisdiction)
     and a.rule_type    = upper(p_rule_type)
     and a.rule_name    = upper(p_rule_name)
   order by (a.tenant_id is null), a.version desc
   limit 1;

  if v_cite is null then
    raise exception using
      errcode = 'P0002',
      message = format('There is no verified source for %s/%s/%s, so no regulatory claim may be made about it.',
                       upper(p_jurisdiction), upper(p_rule_type), upper(p_rule_name)),
      hint    = 'A customer-facing regulatory statement requires a VERIFIED policy rule with a named '
                'source, an instrument or URL, a verification date and a verifier. Get one, or say nothing.';
  end if;
  return v_cite;
end;
$$;

comment on function public.policy_citation(text,text,text) is
  'BUSINESS RULE: a customer-facing regulatory claim requires a verified policy '
  'row. This returns the citation that claim must carry, or refuses. If it '
  'refuses, the claim may not be made — not softened, not hedged, not made.';

create or replace function public.policy_read_unverified_rule(
  p_jurisdiction text,
  p_rule_type    text,
  p_rule_name    text
) returns table (
  id                  uuid,
  tenant_id           uuid,
  version             integer,
  value_numeric       numeric,
  value_text          text,
  unit                text,
  status              text,
  verification_status text,
  authority           text,
  authority_reason    text,
  may_be_relied_on    boolean,
  source_name         text,
  source_document     text
)
language sql
stable
set search_path to 'public', 'pg_catalog'
as $$
  select v.id, v.tenant_id, v.version, v.value_numeric, v.value_text, v.unit,
         v.status, v.verification_status, v.authority, v.authority_reason,
         v.may_be_relied_on, v.source_name, v.source_document
    from public.v_policy_rule v
   where v.jurisdiction = upper(p_jurisdiction)
     and v.rule_type    = upper(p_rule_type)
     and v.rule_name    = upper(p_rule_name)
   order by (v.tenant_id is null), v.version desc;
$$;

comment on function public.policy_read_unverified_rule(text,text,text) is
  'The DELIBERATE unsafe read, named so that using it is visible in a diff and '
  'in a code review. It returns every version including unverified, expired and '
  'draft ones, and always alongside `authority` and `may_be_relied_on` so a '
  'caller cannot claim it did not know. Nothing it returns may be quoted to a '
  'customer or used in a regulatory claim.';

revoke all on function public.policy_numeric_as_of(text,text,text,date) from anon, public;
revoke all on function public.policy_numeric(text,text,text)            from anon, public;
revoke all on function public.policy_citation(text,text,text)           from anon, public;
revoke all on function public.policy_read_unverified_rule(text,text,text) from anon, public;
grant execute on function public.policy_numeric_as_of(text,text,text,date) to authenticated, service_role;
grant execute on function public.policy_numeric(text,text,text)            to authenticated, service_role;
grant execute on function public.policy_citation(text,text,text)           to authenticated, service_role;
grant execute on function public.policy_read_unverified_rule(text,text,text) to authenticated, service_role;
