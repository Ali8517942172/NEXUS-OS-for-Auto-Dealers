-- ============================================================================
-- policy_platform_verification_path
--
-- Before this migration there was NO path by which anybody could verify a
-- global policy rule. policy_verify_rule() refuses them by design ("global
-- rules are verified by the platform") and, called as postgres or service_role,
-- it returns NO_SESSION because action_approver_context() needs auth.uid().
-- Measured on production 4 Sep 2026. That is why every conversation returns
-- TEMPLATE_REQUIRED / WINDOW_RULE_NOT_VERIFIED: the engine is being honest
-- about a rule nobody was able to check.
--
-- This builds the road. It does not drive it: the WhatsApp rules are still
-- NOT_VERIFIED after this migration, because the person who has to look at
-- Meta's account and its documentation is Ali, not an agent.
--
-- How a platform verification differs from a dealership verifying its own
-- house rule, and why:
--
--   tenant house rule            platform / regulator rule
--   -------------------------    ------------------------------------------
--   policy_verify_rule()         policy_platform_verify_rule()
--   caller: authenticated        caller: service_role (EXECUTE granted to
--   dealership approver          nobody else; anon and authenticated refused
--                                by grant AND at runtime)
--   who acted: derived from      who acted: cannot be derived - service_role
--   the session (auth.uid,       is machinery. So it must be STATED: a named
--   staff row, tenant role)      person and a reachable contact, both checked
--   evidence: a source name      evidence: a policy_platform_attestation row -
--   and a URL on the rule        source kind, source reference, the DAY it was
--                                read, and for an account check, WHICH account
--   record: policy_rule_event    record: the attestation row, FK'd from the
--   with actor_auth_user_id      rule, plus a policy_rule_event naming it
--   scope: binds one dealership  scope: binds every dealership on the platform
--
-- A global rule cannot become VERIFIED without an attestation: that is the
-- CHECK policy_rule_global_verified_needs_platform_attestation, not a promise
-- made by this function. And a tenant rule can never carry one.
--
-- Deliberately NOT built: a platform withdraw. Correcting a global rule is a
-- supersede, which leaves the old version readable so past decisions can still
-- be re-derived. Nothing today needs a global rule to vanish.
-- ============================================================================

create or replace function public.policy_platform_verify_rule(
  p_rule_id            uuid,
  p_attested_by        text,      -- the human who looked. Not a role, not a system.
  p_attested_by_contact text,     -- how a later reader reaches them to ask
  p_source_kind        text,      -- see policy_platform_attestation.ppa_source_kind_vocabulary
  p_source_name        text,
  p_source_ref         text,      -- a URL or document reference somebody else could open
  p_source_observed_on date,      -- the day it was actually read
  p_effective_from     date default null,
  p_confidence         text default 'HIGH',
  p_account_ref        text default null,  -- required for a PROVIDER_ACCOUNT_CONSOLE check
  p_notes              text default null)
returns table(rule_id uuid, version integer, attestation_id uuid, outcome text)
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
declare
  r      public.policy_rule%rowtype;
  jur    record;
  v_att  uuid;
  v_from date;
  v_role text := coalesce(current_setting('role', true), '');
begin
  -- Belt and braces in front of the grant. If a future default-privilege
  -- accident hands authenticated EXECUTE on this, it still refuses.
  if v_role in ('authenticated','anon') then
    perform public.policy_refuse('PLATFORM_PATH_NOT_FOR_END_USERS',
      format('policy_platform_verify_rule is a platform operator path and refuses role %s.', v_role),
      'A dealership verifies its own house rules with policy_verify_rule().');
  end if;

  select * into r from public.policy_rule where id = p_rule_id;
  if not found then
    perform public.policy_refuse('NO_SUCH_RULE', 'No rule with that id exists.');
  end if;

  if r.tenant_id is not null then
    perform public.policy_refuse('NOT_A_GLOBAL_RULE',
      'That rule belongs to one dealership, so the platform is not the party that vouches for it.',
      'A dealership approver verifies it with policy_verify_rule().');
  end if;

  select * into jur from public.policy_jurisdiction j where j.code = r.jurisdiction;

  if r.verification_status = 'UNKNOWN' then
    perform public.policy_refuse('NO_VALUE_TO_VERIFY',
      'This rule states no value - it is registered as a question. There is nothing to verify.',
      'Supersede it with a version that states the value the source gives, then attest that.');
  end if;

  if r.verification_status = 'VERIFIED' then
    perform public.policy_refuse('ALREADY_VERIFIED',
      format('Already verified by %s on %s.', r.verified_by, r.verification_date),
      'Re-sourcing a verified rule means superseding it, not overwriting what was checked.');
  end if;

  if r.status in ('SUPERSEDED','WITHDRAWN') then
    perform public.policy_refuse('RULE_IS_RETIRED',
      format('This version is %s and is closed to further change.', r.status));
  end if;

  -- Who looked. This is the whole difference from the tenant path: there is no
  -- session to derive it from, so an unnamed attestation is refused outright.
  if nullif(btrim(coalesce(p_attested_by,'')),'') is null then
    perform public.policy_refuse('NO_ATTESTOR_NAMED',
      'A platform verification is one person saying they checked this against the source. Name them.',
      'service_role is machinery, not a witness. Pass the name of the human who read the source.');
  end if;

  if nullif(btrim(coalesce(p_attested_by_contact,'')),'') is null then
    perform public.policy_refuse('NO_ATTESTOR_CONTACT',
      'Give a contact address for the person attesting, so a later reader can ask them what they saw.');
  end if;

  if nullif(btrim(coalesce(p_source_ref,'')),'') is null then
    perform public.policy_refuse('NO_SOURCE_REFERENCE',
      'A platform attestation must reference something another person could open and read for '
      'themselves - a documentation URL, a console screen, a contract clause.');
  end if;

  if p_source_observed_on is null then
    perform public.policy_refuse('NO_OBSERVATION_DATE',
      'Say which day the source was read. A rule verified against an undated look cannot be judged '
      'stale later.');
  end if;

  if p_source_observed_on > (now() at time zone 'Asia/Dubai')::date then
    perform public.policy_refuse('OBSERVATION_IN_THE_FUTURE',
      format('The source cannot have been read on %s; today is %s in Asia/Dubai.',
             p_source_observed_on, (now() at time zone 'Asia/Dubai')::date));
  end if;

  if coalesce(p_confidence,'UNKNOWN') = 'UNKNOWN' then
    perform public.policy_refuse('NO_CONFIDENCE',
      'State HIGH, MEDIUM or LOW confidence. UNKNOWN confidence and VERIFIED are contradictory.');
  end if;

  v_from := coalesce(p_effective_from, r.effective_from);
  if v_from is null then
    perform public.policy_refuse('NO_EFFECTIVE_FROM',
      'A verified rule must say from when it applies, or no decision can ever be tied to it.');
  end if;

  -- The attestation is written first and the rule points at it. The remaining
  -- shape rules - a person rather than a role name, a reachable contact, an
  -- account named for a console check, a reference that is not a pasted secret
  -- - are CHECK constraints on the table, so they hold for any writer, not just
  -- for callers of this function.
  insert into public.policy_platform_attestation
    (rule_id, attested_by, attested_by_contact, source_kind, source_name, source_ref,
     source_observed_on, account_ref, confidence, notes)
  values
    (p_rule_id, btrim(p_attested_by), btrim(p_attested_by_contact), p_source_kind,
     p_source_name, btrim(p_source_ref), p_source_observed_on,
     nullif(btrim(coalesce(p_account_ref,'')),''), p_confidence, p_notes)
  returning public.policy_platform_attestation.attestation_id into v_att;

  update public.policy_rule
     set source_name             = coalesce(p_source_name, source_name),
         source_url              = case when p_source_ref ~* '^https?://' then btrim(p_source_ref)
                                        else source_url end,
         source_document         = case when p_source_ref ~* '^https?://' then source_document
                                        else btrim(p_source_ref) end,
         effective_from          = v_from,
         verification_status     = 'VERIFIED',
         status                  = 'ACTIVE',
         verification_date       = (now() at time zone 'Asia/Dubai')::date,
         verified_by             = btrim(p_attested_by),
         verified_by_auth_user_id = null,
         confidence              = p_confidence,
         platform_attestation_id = v_att,
         notes                   = coalesce(p_notes, notes)
   where id = p_rule_id
     and tenant_id is null;

  insert into public.policy_rule_event
    (rule_id, tenant_id, event, actor, actor_auth_user_id,
     from_status, to_status, from_verification, to_verification, detail)
  values
    (p_rule_id, null, 'VERIFIED', btrim(p_attested_by), null,
     r.status, 'ACTIVE', r.verification_status, 'VERIFIED',
     format('PLATFORM ATTESTATION %s. %s checked %s (%s) against %s, read on %s%s. This is the platform '
            'operator vouching for a rule that binds every dealership under jurisdiction %s (%s). It is '
            'not a dealership verifying its own house rule, and no dealership account could have done it.',
            v_att, btrim(p_attested_by), r.rule_name, r.jurisdiction, p_source_name, p_source_observed_on,
            case when nullif(btrim(coalesce(p_account_ref,'')),'') is not null
                 then format(' in account %s', btrim(p_account_ref)) else '' end,
            r.jurisdiction, coalesce(jur.owner_name,'owner not registered')));

  return query select p_rule_id, r.version, v_att, 'PLATFORM_VERIFIED'::text;
end;
$function$;

comment on function public.policy_platform_verify_rule(uuid,text,text,text,text,text,date,date,text,text,text) is
  'The platform operator attests that a global policy rule matches its source. EXECUTE is service_role '
  'only; the acting human must be named because service_role is machinery, not a witness. Refuses by '
  'raising (SQLSTATE NX001, code in DETAIL). Note that the attestation records the DAY the source was '
  'read: how old an attestation may be before it should be re-made is a judgement for whoever reads it, '
  'and NEXUS does not invent a number for it.';

revoke all on function public.policy_platform_verify_rule(uuid,text,text,text,text,text,date,date,text,text,text) from anon, authenticated, public;
grant execute on function public.policy_platform_verify_rule(uuid,text,text,text,text,text,date,date,text,text,text) to service_role;

-- ---------------------------------------------------------------------------

create or replace function public.policy_platform_supersede_rule(
  p_rule_id         uuid,
  p_effective_from  date,
  p_source_name     text,
  p_changed_by      text,
  p_value_numeric   numeric default null,
  p_value_text      text    default null,
  p_source_ref      text    default null,
  p_notes           text    default null)
returns table(rule_id uuid, version integer, outcome text)
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
declare
  r     public.policy_rule%rowtype;
  v_new uuid;
  v_role text := coalesce(current_setting('role', true), '');
begin
  if v_role in ('authenticated','anon') then
    perform public.policy_refuse('PLATFORM_PATH_NOT_FOR_END_USERS',
      format('policy_platform_supersede_rule is a platform operator path and refuses role %s.', v_role));
  end if;

  select * into r from public.policy_rule where id = p_rule_id;
  if not found then
    perform public.policy_refuse('NO_SUCH_RULE', 'No rule with that id exists.');
  end if;

  if r.tenant_id is not null then
    perform public.policy_refuse('NOT_A_GLOBAL_RULE',
      'That rule belongs to one dealership.',
      'The dealership replaces it with policy_supersede_rule().');
  end if;

  if r.status in ('SUPERSEDED','WITHDRAWN') then
    perform public.policy_refuse('RULE_IS_RETIRED',
      format('Version %s is already %s.', r.version, r.status),
      'Supersede the version that is current.');
  end if;

  if nullif(btrim(coalesce(p_changed_by,'')),'') is null then
    perform public.policy_refuse('NO_AUTHOR_NAMED',
      'Name the person recording this new version. service_role is not an author.');
  end if;

  if p_effective_from is null then
    perform public.policy_refuse('NO_EFFECTIVE_FROM',
      'The new version must say from when it applies.');
  end if;

  if r.effective_from is not null and p_effective_from <= r.effective_from then
    perform public.policy_refuse('EFFECTIVE_FROM_NOT_AFTER_PREVIOUS',
      format('The new version must start after the one it replaces (%s started %s).',
             r.version, r.effective_from));
  end if;

  update public.policy_rule
     set effective_to = p_effective_from,
         status       = 'SUPERSEDED'
   where id = p_rule_id and tenant_id is null;

  insert into public.policy_rule (
    tenant_id, jurisdiction, jurisdiction_owner_kind, rule_type, rule_name,
    value_numeric, value_text, unit, value_kind,
    source_name, source_url, source_document,
    effective_from, notes,
    status, verification_status, confidence,
    version, supersedes_id, added_by, added_by_auth_user_id
  ) values (
    null, r.jurisdiction, r.jurisdiction_owner_kind, r.rule_type, r.rule_name,
    p_value_numeric, p_value_text, r.unit, r.value_kind,
    p_source_name,
    case when p_source_ref ~* '^https?://' then btrim(p_source_ref) end,
    case when p_source_ref is not null and p_source_ref !~* '^https?://' then btrim(p_source_ref) end,
    p_effective_from, p_notes,
    'DRAFT', 'NOT_VERIFIED', 'UNKNOWN',
    r.version + 1, r.id, btrim(p_changed_by), null
  ) returning id into v_new;

  insert into public.policy_rule_event (rule_id, tenant_id, event, actor, actor_auth_user_id,
                                        from_status, to_status, detail)
  values (p_rule_id, null, 'SUPERSEDED', btrim(p_changed_by), null, r.status, 'SUPERSEDED',
          format('Replaced by version %s from %s by the platform. The old version stays readable: '
                 'decisions taken while it applied were correct under it.', r.version + 1, p_effective_from));

  insert into public.policy_rule_event (rule_id, tenant_id, event, actor, actor_auth_user_id,
                                        to_status, to_verification, detail)
  values (v_new, null, 'PROPOSED', btrim(p_changed_by), null, 'DRAFT', 'NOT_VERIFIED',
          format('Version %s, superseding %s. It is NOT authoritative until a named person attests it '
                 'with policy_platform_verify_rule(); until then every consumer keeps refusing.',
                 r.version + 1, p_rule_id));

  return query select v_new, r.version + 1, 'PLATFORM_SUPERSEDED'::text;
end;
$function$;

comment on function public.policy_platform_supersede_rule(uuid,date,text,text,numeric,text,text,text) is
  'The platform records the next version of a global rule - for instance when Meta changes what the '
  'customer service window is. The new version arrives DRAFT / NOT_VERIFIED and grants nothing until '
  'it is attested. EXECUTE is service_role only.';

revoke all on function public.policy_platform_supersede_rule(uuid,date,text,text,numeric,text,text,text) from anon, authenticated, public;
grant execute on function public.policy_platform_supersede_rule(uuid,date,text,text,numeric,text,text,text) to service_role;