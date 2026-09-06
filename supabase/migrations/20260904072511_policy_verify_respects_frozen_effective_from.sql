-- ============================================================================
-- policy_verify_respects_frozen_effective_from
--
-- Found by the P0 re-proof, not by review. policy_rule_guard_immutability
-- freezes effective_from once a version leaves DRAFT. Both verify paths set
-- effective_from = coalesce(p_effective_from, effective_from) unconditionally,
-- so verifying a rule that is already ACTIVE with a different p_effective_from
-- died on the trigger with a constraint error instead of a readable refusal.
--
-- The five WhatsApp rules are exactly that shape - ACTIVE and NOT_VERIFIED,
-- seeded with effective_from 2026-09-04 - so this would have hit Ali on his
-- first real attestation if he passed a date. It is refused in words now, and
-- the same guard is added to the tenant path so the two cannot drift.
-- ============================================================================

create or replace function public.policy_platform_verify_rule(
  p_rule_id            uuid,
  p_attested_by        text,
  p_attested_by_contact text,
  p_source_kind        text,
  p_source_name        text,
  p_source_ref         text,
  p_source_observed_on date,
  p_effective_from     date default null,
  p_confidence         text default 'HIGH',
  p_account_ref        text default null,
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

  -- effective_from is frozen once a version leaves DRAFT (policy_rule_guard_
  -- immutability). Attesting does not get to move the date the rule started
  -- applying: decisions have already been taken under it.
  if r.status <> 'DRAFT' and v_from is distinct from r.effective_from then
    perform public.policy_refuse('EFFECTIVE_FROM_IS_FROZEN',
      format('This version has been in force since %s and that date cannot move; attesting it does not '
             'change when it started applying.', r.effective_from),
      format('Attest it as it stands (pass no p_effective_from, or %s), or - if the source says the rule '
             'changed on a later date - record that as a new version with '
             'policy_platform_supersede_rule() and attest the new one.', r.effective_from));
  end if;

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

revoke all on function public.policy_platform_verify_rule(uuid,text,text,text,text,text,date,date,text,text,text) from anon, authenticated, public;
grant execute on function public.policy_platform_verify_rule(uuid,text,text,text,text,text,date,date,text,text,text) to service_role;

-- ---------------------------------------------------------------------------

create or replace function public.policy_verify_rule(
  p_rule_id         uuid,
  p_source_name     text default null,
  p_source_url      text default null,
  p_source_document text default null,
  p_effective_from  date default null,
  p_confidence      text default 'HIGH',
  p_notes           text default null)
returns table(rule_id uuid, version integer, outcome text)
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  ctx     record;
  r       public.policy_rule%rowtype;
  jur     record;
  v_actor text;
  v_from  date;
begin
  select * into ctx from public.action_approver_context();

  if not ctx.may_decide then
    perform public.policy_refuse(
      coalesce(ctx.refusal_code, 'NOT_AN_APPROVER'),
      coalesce(ctx.refusal_reason, 'This account may not verify a policy rule.'),
      'Verifying a rule is what allows its value to be quoted to a customer, so it is gated on the same '
      'approval authority as an inventory action (inventory_action_policy).');
  end if;

  select * into r from public.policy_rule where id = p_rule_id;
  if not found then
    perform public.policy_refuse('NO_SUCH_RULE', 'No rule with that id exists.');
  end if;

  -- A global rule binds every dealership. One dealership's manager cannot be
  -- the one who says it is true.
  if r.tenant_id is null then
    perform public.policy_refuse('GLOBAL_RULE_NOT_TENANT_VERIFIABLE',
      'This rule has no tenant, so it applies to every dealership on the platform. A single '
      'dealership''s approver may not verify it - that would let one customer''s staff change what '
      'every other customer''s system treats as law.',
      'Global rules are verified by the platform, with policy_platform_verify_rule(), by a named person '
      'holding the account the rule comes from. That path records who checked it, when, and against '
      'which source.');
  end if;

  if r.tenant_id <> ctx.tenant_id then
    perform public.policy_refuse('WRONG_TENANT', 'That rule belongs to another dealership.');
  end if;

  -- Belt and braces behind policy_rule_scope_follows_jurisdiction. While that
  -- CHECK stands this branch is unreachable, which is the point: if somebody
  -- drops the constraint, the jurisdiction guard does not disappear with it.
  select * into jur from public.policy_jurisdiction j where j.code = r.jurisdiction;
  if coalesce(r.jurisdiction_owner_kind, jur.owner_kind) <> 'TENANT' then
    perform public.policy_refuse('JURISDICTION_NOT_YOURS_TO_VERIFY',
      format('That rule is filed under %s, which is %s''s namespace. A dealership may verify its own '
             'house rules and nothing else.', r.jurisdiction, coalesce(jur.owner_name,'another party')),
      'Verify the dealership''s TENANT_HOUSE rule instead, or ask the platform operator to attest the '
      'platform rule with policy_platform_verify_rule().');
  end if;

  if r.verification_status = 'UNKNOWN' then
    perform public.policy_refuse('NO_VALUE_TO_VERIFY',
      'This rule states no value - it is registered as a question. There is nothing to verify.',
      'Supersede it with a version that states the value the source gives.');
  end if;

  if r.status in ('SUPERSEDED','WITHDRAWN') then
    perform public.policy_refuse('RULE_IS_RETIRED',
      format('This version is %s and is closed to further change.', r.status));
  end if;

  if r.verification_status = 'VERIFIED' then
    perform public.policy_refuse('ALREADY_VERIFIED',
      format('Already verified by %s on %s.', r.verified_by, r.verification_date),
      'Re-sourcing a verified rule means superseding it, not overwriting what was checked.');
  end if;

  v_from := coalesce(p_effective_from, r.effective_from);
  if v_from is null then
    perform public.policy_refuse('NO_EFFECTIVE_FROM',
      'A verified rule must say from when it applies, or no decision can ever be tied to it.');
  end if;

  -- effective_from is frozen once a version leaves DRAFT.
  if r.status <> 'DRAFT' and v_from is distinct from r.effective_from then
    perform public.policy_refuse('EFFECTIVE_FROM_IS_FROZEN',
      format('This version has been in force since %s and that date cannot move.', r.effective_from),
      format('Verify it as it stands (pass no p_effective_from, or %s), or supersede it with a version '
             'that starts on the new date.', r.effective_from));
  end if;

  if coalesce(p_confidence,'UNKNOWN') = 'UNKNOWN' then
    perform public.policy_refuse('NO_CONFIDENCE',
      'State HIGH, MEDIUM or LOW confidence. UNKNOWN confidence and VERIFIED are contradictory.');
  end if;

  v_actor := coalesce(nullif(btrim(coalesce(ctx.staff_name,'')),''),
                      nullif(btrim(coalesce(auth.jwt() ->> 'email','')),''),
                      ctx.auth_user_id::text);

  update public.policy_rule
     set source_name         = coalesce(p_source_name, source_name),
         source_url          = coalesce(p_source_url, source_url),
         source_document     = coalesce(p_source_document, source_document),
         effective_from      = v_from,
         verification_status = 'VERIFIED',
         status              = 'ACTIVE',
         verification_date   = (now() at time zone 'Asia/Dubai')::date,
         verified_by         = v_actor,
         verified_by_auth_user_id = ctx.auth_user_id,
         confidence          = p_confidence,
         notes               = coalesce(p_notes, notes)
   where id = p_rule_id
     and tenant_id = ctx.tenant_id;   -- tenant predicate readable at the statement

  insert into public.policy_rule_event (rule_id, tenant_id, event, actor, actor_auth_user_id,
                                        from_status, to_status, from_verification, to_verification, detail)
  values (p_rule_id, ctx.tenant_id, 'VERIFIED', v_actor, ctx.auth_user_id,
          r.status, 'ACTIVE', r.verification_status, 'VERIFIED',
          format('House rule checked against %s by a dealership approver. Authority: %s. This is the '
                 'dealership vouching for its own rule; it is not a platform attestation.',
                 coalesce(p_source_name, r.source_name, 'the recorded source'),
                 coalesce(ctx.authority, 'unstated')));

  return query select p_rule_id, r.version, 'VERIFIED'::text;
end;
$function$;

revoke all on function public.policy_verify_rule(uuid,text,text,text,date,text,text) from anon, public;
grant execute on function public.policy_verify_rule(uuid,text,text,text,date,text,text) to authenticated, service_role;