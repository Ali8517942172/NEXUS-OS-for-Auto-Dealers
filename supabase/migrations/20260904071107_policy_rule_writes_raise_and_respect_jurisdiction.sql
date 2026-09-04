-- ============================================================================
-- policy_rule_writes_raise_and_respect_jurisdiction
--
-- Two changes to the four functions a dealership uses to change policy.
--
-- 1. They refuse by RAISING, not by returning ok = false in a column. The old
--    shape was ignorable: `PERFORM policy_verify_rule(...)` swallowed the
--    refusal completely and the caller carried on believing the rule was
--    verified. Measured on production 4 Sep 2026 -- PERFORM raised nothing and
--    the rule stayed NOT_VERIFIED. A QA agent made exactly that mistake and
--    filed a false finding from it. Nothing is lost by raising: the machine
--    readable code travels in the exception DETAIL, the sentence in MESSAGE and
--    the next step in HINT, so PostgREST still hands a dashboard all three.
--    SQLSTATE NX001 marks a NEXUS policy refusal specifically.
--
-- 2. They will not let a dealership legislate in somebody else's namespace.
--    The schema already makes it unrepresentable (policy_jurisdiction +
--    policy_rule_scope_follows_jurisdiction); this is the readable refusal in
--    front of the constraint, so the dealership is told where its own rule
--    goes instead of getting a constraint violation.
-- ============================================================================

create or replace function public.policy_refuse(p_code text, p_reason text, p_hint text default null)
returns void
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
begin
  raise exception using
    errcode = 'NX001',
    message = p_reason,
    detail  = p_code,
    hint    = coalesce(p_hint, 'Nothing was written.');
end;
$function$;

comment on function public.policy_refuse(text,text,text) is
  'The single way a policy write function refuses. It raises, so a caller using PERFORM or ignoring a '
  'return column cannot mistake a refusal for a success. DETAIL carries the machine-readable code.';

revoke all on function public.policy_refuse(text,text,text) from anon, authenticated, public;

-- ---------------------------------------------------------------------------

drop function if exists public.policy_propose_rule(text,text,text,text,text,numeric,text,text,text,date,text);

create function public.policy_propose_rule(
  p_jurisdiction    text,
  p_rule_type       text,
  p_rule_name       text,
  p_unit            text,
  p_source_name     text,
  p_value_numeric   numeric default null,
  p_value_text      text    default null,
  p_source_url      text    default null,
  p_source_document text    default null,
  p_effective_from  date    default null,
  p_notes           text    default null)
returns table(rule_id uuid, version integer, outcome text)
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  ctx        record;
  jur        record;
  v_kind     text;
  v_actor    text;
  v_unknown  boolean;
  v_id       uuid;
  v_jur      text := upper(btrim(coalesce(p_jurisdiction,'')));
  v_type     text := upper(btrim(coalesce(p_rule_type,'')));
begin
  select * into ctx from public.action_approver_context();

  if ctx.tenant_id is null then
    perform public.policy_refuse(
      coalesce(ctx.refusal_code, 'NO_TENANT'),
      coalesce(ctx.refusal_reason,
        'This account belongs to no dealership, so it cannot record a rule for one.'),
      'Sign in as a member of a dealership.');
  end if;

  select * into jur from public.policy_jurisdiction j where j.code = v_jur;
  if not found then
    perform public.policy_refuse('UNKNOWN_JURISDICTION',
      format('%L is not a jurisdiction this engine knows, so there is nobody it could be a rule of.', v_jur),
      'Register it in public.policy_jurisdiction in a migration first, naming who owns the namespace. '
      'Naming a new legislator is a modelling decision, not a data entry.');
  end if;

  -- The P0. A jurisdiction that names a platform or a regulator is not a
  -- dealership's to legislate in, however honestly it fills the form in.
  if jur.owner_kind <> 'TENANT' then
    perform public.policy_refuse('JURISDICTION_NOT_YOURS_TO_LEGISLATE',
      format('%s is %s''s namespace (%s), not this dealership''s. A rule filed there is read by every '
             'consumer as %s''s own requirement, and the engine reports it back with that jurisdiction '
             'on the audit trail. One dealership''s staff cannot be the source of that.',
             v_jur, jur.owner_name, jur.owner_kind, jur.owner_name),
      'File the dealership''s own position under TENANT_HOUSE instead. A TENANT_HOUSE rule of the same '
      'name may tighten what the platform allows and can never loosen it. If you believe the platform '
      'rule itself is recorded wrongly, that is a platform correction, made by whoever holds the '
      'platform account: policy_platform_supersede_rule().');
  end if;

  if not exists (select 1 from public.policy_rule_type t where t.code = v_type) then
    perform public.policy_refuse('UNKNOWN_RULE_TYPE',
      format('%L is not a rule type this engine knows.', v_type),
      'Add it to policy_rule_type in a migration first. The set of things policy can govern is a '
      'modelling decision.');
  end if;

  select u.value_kind into v_kind from public.policy_unit u where u.code = upper(p_unit);
  if v_kind is null then
    perform public.policy_refuse('UNKNOWN_UNIT',
      format('%s is not a unit this engine knows.', p_unit),
      'Add it to policy_unit in a migration first - a new unit is a modelling decision.');
  end if;

  -- No value supplied means the rule is registered as a QUESTION. It is stored
  -- as UNKNOWN with no value, and can never be read as authoritative.
  v_unknown := (p_value_numeric is null and nullif(btrim(coalesce(p_value_text,'')),'') is null);

  if not v_unknown then
    if v_kind = 'NUMERIC' and p_value_numeric is null then
      perform public.policy_refuse('VALUE_UNIT_MISMATCH',
        format('Unit %s is numeric, so the value belongs in p_value_numeric.', upper(p_unit)));
    end if;
    if v_kind <> 'NUMERIC' and p_value_numeric is not null then
      perform public.policy_refuse('VALUE_UNIT_MISMATCH',
        format('Unit %s is not numeric, so the value belongs in p_value_text.', upper(p_unit)));
    end if;
  end if;

  if nullif(btrim(coalesce(p_source_name,'')),'') is null then
    perform public.policy_refuse('NO_SOURCE_NAME',
      'Every rule must name where it came from, even an unverified one.',
      'If the value was lifted out of this codebase, the honest source_name is the file and line it sat '
      'on - not the regulator that constant was guessing at.');
  end if;

  v_actor := coalesce(nullif(btrim(coalesce(ctx.staff_name,'')),''),
                      nullif(btrim(coalesce(auth.jwt() ->> 'email','')),''),
                      ctx.auth_user_id::text);

  insert into public.policy_rule (
    tenant_id, jurisdiction, jurisdiction_owner_kind, rule_type, rule_name,
    value_numeric, value_text, unit, value_kind,
    source_name, source_url, source_document,
    effective_from, notes,
    status, verification_status, confidence,
    version, added_by, added_by_auth_user_id
  ) values (
    ctx.tenant_id, v_jur, jur.owner_kind, v_type, upper(p_rule_name),
    case when v_unknown then null else p_value_numeric end,
    case when v_unknown then null else p_value_text end,
    upper(p_unit), v_kind,
    p_source_name, p_source_url, p_source_document,
    p_effective_from, p_notes,
    'DRAFT',
    case when v_unknown then 'UNKNOWN' else 'NOT_VERIFIED' end,
    'UNKNOWN',
    1, v_actor, ctx.auth_user_id
  ) returning id into v_id;

  insert into public.policy_rule_event (rule_id, tenant_id, event, actor, actor_auth_user_id,
                                        to_status, to_verification, detail)
  values (v_id, ctx.tenant_id, 'PROPOSED', v_actor, ctx.auth_user_id,
          'DRAFT', case when v_unknown then 'UNKNOWN' else 'NOT_VERIFIED' end,
          case when v_unknown
               then 'Registered as a question: no value stated.'
               else 'Value recorded but not checked against the source.' end);

  return query select v_id, 1, 'PROPOSED'::text;
end;
$function$;

comment on function public.policy_propose_rule(text,text,text,text,text,numeric,text,text,text,date,text) is
  'A dealership records a house rule. Refuses by raising (SQLSTATE NX001, code in DETAIL). '
  'Only the TENANT_HOUSE jurisdiction is a dealership''s to legislate in.';

revoke all on function public.policy_propose_rule(text,text,text,text,text,numeric,text,text,text,date,text) from anon, public;
grant execute on function public.policy_propose_rule(text,text,text,text,text,numeric,text,text,text,date,text) to authenticated, service_role;

-- ---------------------------------------------------------------------------

drop function if exists public.policy_verify_rule(uuid,text,text,text,date,text,text);

create function public.policy_verify_rule(
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

comment on function public.policy_verify_rule(uuid,text,text,text,date,text,text) is
  'A dealership approver verifies one of that dealership''s own house rules. Refuses by raising '
  '(SQLSTATE NX001, code in DETAIL). Global rules go through policy_platform_verify_rule().';

revoke all on function public.policy_verify_rule(uuid,text,text,text,date,text,text) from anon, public;
grant execute on function public.policy_verify_rule(uuid,text,text,text,date,text,text) to authenticated, service_role;

-- ---------------------------------------------------------------------------

drop function if exists public.policy_supersede_rule(uuid,date,text,numeric,text,text,text,text);

create function public.policy_supersede_rule(
  p_rule_id         uuid,
  p_effective_from  date,
  p_source_name     text,
  p_value_numeric   numeric default null,
  p_value_text      text    default null,
  p_source_url      text    default null,
  p_source_document text    default null,
  p_notes           text    default null)
returns table(rule_id uuid, version integer, outcome text)
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  ctx     record;
  r       public.policy_rule%rowtype;
  v_actor text;
  v_new   uuid;
begin
  select * into ctx from public.action_approver_context();

  if not ctx.may_decide then
    perform public.policy_refuse(
      coalesce(ctx.refusal_code, 'NOT_AN_APPROVER'),
      coalesce(ctx.refusal_reason, 'This account may not change a policy rule.'));
  end if;

  select * into r from public.policy_rule where id = p_rule_id;
  if not found then
    perform public.policy_refuse('NO_SUCH_RULE', 'No rule with that id exists.');
  end if;

  if r.tenant_id is null then
    perform public.policy_refuse('GLOBAL_RULE_NOT_TENANT_VERIFIABLE',
      'A global rule binds every dealership, so a single dealership may not replace it.',
      'The platform supersedes a global rule with policy_platform_supersede_rule().');
  end if;

  if r.tenant_id <> ctx.tenant_id then
    perform public.policy_refuse('WRONG_TENANT', 'That rule belongs to another dealership.');
  end if;

  if r.jurisdiction_owner_kind <> 'TENANT' then
    perform public.policy_refuse('JURISDICTION_NOT_YOURS_TO_LEGISLATE',
      format('That rule is filed under %s, which is not this dealership''s namespace.', r.jurisdiction));
  end if;

  if r.status in ('SUPERSEDED','WITHDRAWN') then
    perform public.policy_refuse('RULE_IS_RETIRED',
      format('Version %s is already %s.', r.version, r.status),
      'Supersede the version that is current.');
  end if;

  if r.effective_from is not null and p_effective_from <= r.effective_from then
    perform public.policy_refuse('EFFECTIVE_FROM_NOT_AFTER_PREVIOUS',
      format('The new version must start after the one it replaces (%s started %s).',
             r.version, r.effective_from));
  end if;

  v_actor := coalesce(nullif(btrim(coalesce(ctx.staff_name,'')),''),
                      nullif(btrim(coalesce(auth.jwt() ->> 'email','')),''),
                      ctx.auth_user_id::text);

  -- Close the old version FIRST. Its evidence stays exactly as it was; only
  -- its end date and its lifecycle move, so a decision taken while it applied
  -- can still be re-derived from it.
  update public.policy_rule
     set effective_to = p_effective_from,
         status       = 'SUPERSEDED'
   where id = p_rule_id
     and tenant_id = ctx.tenant_id;

  insert into public.policy_rule (
    tenant_id, jurisdiction, jurisdiction_owner_kind, rule_type, rule_name,
    value_numeric, value_text, unit, value_kind,
    source_name, source_url, source_document,
    effective_from, notes,
    status, verification_status, confidence,
    version, supersedes_id, added_by, added_by_auth_user_id
  ) values (
    r.tenant_id, r.jurisdiction, r.jurisdiction_owner_kind, r.rule_type, r.rule_name,
    p_value_numeric, p_value_text, r.unit, r.value_kind,
    p_source_name, p_source_url, p_source_document,
    p_effective_from, p_notes,
    'DRAFT', 'NOT_VERIFIED', 'UNKNOWN',
    r.version + 1, r.id, v_actor, ctx.auth_user_id
  ) returning id into v_new;

  insert into public.policy_rule_event (rule_id, tenant_id, event, actor, actor_auth_user_id,
                                        from_status, to_status, detail)
  values (p_rule_id, ctx.tenant_id, 'SUPERSEDED', v_actor, ctx.auth_user_id,
          r.status, 'SUPERSEDED',
          format('Replaced by version %s from %s. This version stays readable: decisions taken while it '
                 'applied were correct under it.', r.version + 1, p_effective_from));

  insert into public.policy_rule_event (rule_id, tenant_id, event, actor, actor_auth_user_id,
                                        to_status, to_verification, detail)
  values (v_new, ctx.tenant_id, 'PROPOSED', v_actor, ctx.auth_user_id, 'DRAFT', 'NOT_VERIFIED',
          format('Version %s, superseding %s. Not authoritative until verified.', r.version + 1, p_rule_id));

  return query select v_new, r.version + 1, 'SUPERSEDED'::text;
end;
$function$;

comment on function public.policy_supersede_rule(uuid,date,text,numeric,text,text,text,text) is
  'A dealership replaces one of its own house rules with a new version. Refuses by raising '
  '(SQLSTATE NX001, code in DETAIL).';

revoke all on function public.policy_supersede_rule(uuid,date,text,numeric,text,text,text,text) from anon, public;
grant execute on function public.policy_supersede_rule(uuid,date,text,numeric,text,text,text,text) to authenticated, service_role;

-- ---------------------------------------------------------------------------

drop function if exists public.policy_withdraw_rule(uuid,text);

create function public.policy_withdraw_rule(p_rule_id uuid, p_reason text)
returns table(rule_id uuid, version integer, outcome text)
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  ctx record; r public.policy_rule%rowtype; v_actor text;
begin
  select * into ctx from public.action_approver_context();

  if not ctx.may_decide then
    perform public.policy_refuse(
      coalesce(ctx.refusal_code,'NOT_AN_APPROVER'),
      coalesce(ctx.refusal_reason,'This account may not withdraw a policy rule.'));
  end if;

  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    perform public.policy_refuse('NO_REASON',
      'Withdrawing a rule removes it from every consumer. Say why, so the next reader knows.');
  end if;

  select * into r from public.policy_rule where id = p_rule_id;
  if not found then
    perform public.policy_refuse('NO_SUCH_RULE', 'No rule with that id exists.');
  end if;

  if r.tenant_id is distinct from ctx.tenant_id then
    perform public.policy_refuse(
      case when r.tenant_id is null then 'GLOBAL_RULE_NOT_TENANT_VERIFIABLE' else 'WRONG_TENANT' end,
      'This rule is not this dealership''s to withdraw.');
  end if;

  if r.status in ('SUPERSEDED','WITHDRAWN') then
    perform public.policy_refuse('RULE_IS_RETIRED',
      format('Version %s is already %s.', r.version, r.status));
  end if;

  v_actor := coalesce(nullif(btrim(coalesce(ctx.staff_name,'')),''),
                      nullif(btrim(coalesce(auth.jwt() ->> 'email','')),''),
                      ctx.auth_user_id::text);

  update public.policy_rule set status = 'WITHDRAWN'
   where id = p_rule_id and tenant_id = ctx.tenant_id;

  insert into public.policy_rule_event (rule_id, tenant_id, event, actor, actor_auth_user_id,
                                        from_status, to_status, detail)
  values (p_rule_id, ctx.tenant_id, 'WITHDRAWN', v_actor, ctx.auth_user_id, r.status, 'WITHDRAWN', p_reason);

  return query select p_rule_id, r.version, 'WITHDRAWN'::text;
end;
$function$;

comment on function public.policy_withdraw_rule(uuid,text) is
  'A dealership withdraws one of its own house rules. Refuses by raising (SQLSTATE NX001, code in DETAIL).';

revoke all on function public.policy_withdraw_rule(uuid,text) from anon, public;
grant execute on function public.policy_withdraw_rule(uuid,text) to authenticated, service_role;