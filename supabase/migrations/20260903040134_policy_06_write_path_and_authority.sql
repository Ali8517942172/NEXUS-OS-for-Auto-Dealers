-- ===========================================================================
-- POLICY ENGINE — 06 · the write path, and who is allowed to verify
--
-- BUSINESS RULE
-- Anybody at a dealership may PROPOSE a rule — writing down what a source says
-- is clerical work. Only somebody with approval authority may mark one
-- VERIFIED, because VERIFIED is the word that lets a number be quoted to a
-- customer and a regulatory claim be made.
--
-- WHO DECIDES. This reuses public.action_approver_context() rather than
-- inventing a third authority system. Be precise about what that means: the
-- approving roles are the ones stated in inventory_action_policy for the
-- dealership. That is a deliberate reuse of one authority record, NOT a claim
-- that a separate policy-verification authority has been configured. If a
-- dealership wants different people verifying rules than approving repricing,
-- that is a new column on inventory_action_policy, not a new table.
--
-- GLOBAL RULES. A rule with tenant_id NULL applies to every dealership. One
-- dealership's manager may not verify it — that would let one customer's staff
-- change what every other customer's system treats as law. Global rules are
-- verifiable only by the platform (service_role / postgres), and the refusal
-- says so.
--
-- WHY SECURITY DEFINER. `authenticated` holds no INSERT or UPDATE on
-- policy_rule at all; the only way in is through these functions, which check
-- authority first. Each statement carries its own tenant predicate rather than
-- relying on RLS alone, so the tenant scope is readable at the statement.
-- ===========================================================================

create or replace function public.policy_propose_rule(
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
  p_notes           text    default null
) returns table (
  ok             boolean,
  rule_id        uuid,
  version        integer,
  refusal_code   text,
  refusal_reason text
)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  ctx        record;
  v_kind     text;
  v_actor    text;
  v_unknown  boolean;
  v_id       uuid;
begin
  select * into ctx from public.action_approver_context();

  if ctx.tenant_id is null then
    return query select false, null::uuid, null::integer,
                        coalesce(ctx.refusal_code, 'NO_TENANT'),
                        coalesce(ctx.refusal_reason,
                          'This account belongs to no dealership, so it cannot record a rule for one.');
    return;
  end if;

  select u.value_kind into v_kind from public.policy_unit u where u.code = upper(p_unit);
  if v_kind is null then
    return query select false, null::uuid, null::integer, 'UNKNOWN_UNIT',
      format('%s is not a unit this engine knows. Add it to policy_unit in a migration first — a new unit is a modelling decision.', p_unit);
    return;
  end if;

  -- No value supplied means the rule is registered as a QUESTION. It is stored
  -- as UNKNOWN with no value, and can never be read as authoritative.
  v_unknown := (p_value_numeric is null and nullif(btrim(coalesce(p_value_text,'')),'') is null);

  if not v_unknown then
    if v_kind = 'NUMERIC' and p_value_numeric is null then
      return query select false, null::uuid, null::integer, 'VALUE_UNIT_MISMATCH',
        format('Unit %s is numeric, so the value belongs in p_value_numeric.', upper(p_unit));
      return;
    end if;
    if v_kind <> 'NUMERIC' and p_value_numeric is not null then
      return query select false, null::uuid, null::integer, 'VALUE_UNIT_MISMATCH',
        format('Unit %s is not numeric, so the value belongs in p_value_text.', upper(p_unit));
      return;
    end if;
  end if;

  if nullif(btrim(coalesce(p_source_name,'')),'') is null then
    return query select false, null::uuid, null::integer, 'NO_SOURCE_NAME',
      'Every rule must name where it came from, even an unverified one. If the value was lifted out of '
      'this codebase, the honest source_name is the file and line it sat on — not the regulator that '
      'constant was guessing at.';
    return;
  end if;

  v_actor := coalesce(nullif(btrim(coalesce(ctx.staff_name,'')),''),
                      nullif(btrim(coalesce(auth.jwt() ->> 'email','')),''),
                      ctx.auth_user_id::text);

  insert into public.policy_rule (
    tenant_id, jurisdiction, rule_type, rule_name,
    value_numeric, value_text, unit, value_kind,
    source_name, source_url, source_document,
    effective_from, notes,
    status, verification_status, confidence,
    version, added_by, added_by_auth_user_id
  ) values (
    ctx.tenant_id, upper(p_jurisdiction), upper(p_rule_type), upper(p_rule_name),
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

  return query select true, v_id, 1, null::text, null::text;
end;
$$;

comment on function public.policy_propose_rule(text,text,text,text,text,numeric,text,text,text,date,text) is
  'BUSINESS RULE: recording what a source says is clerical, so anybody at the '
  'dealership may do it. A proposal always lands DRAFT and NOT_VERIFIED (or '
  'UNKNOWN, when no value is supplied), so nothing proposed can be read as '
  'authoritative. Every proposal must name an origin — "a constant in '
  'screens/finance.js:291" is a legitimate origin; a regulator that constant '
  'was guessing at is not.';

-- ── Verification: the authority gate ──────────────────────────────────────
create or replace function public.policy_verify_rule(
  p_rule_id         uuid,
  p_source_name     text default null,
  p_source_url      text default null,
  p_source_document text default null,
  p_effective_from  date default null,
  p_confidence      text default 'HIGH',
  p_notes           text default null
) returns table (
  ok             boolean,
  rule_id        uuid,
  version        integer,
  refusal_code   text,
  refusal_reason text
)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  ctx    record;
  r      public.policy_rule%rowtype;
  v_actor text;
  v_from date;
begin
  select * into ctx from public.action_approver_context();

  if not ctx.may_decide then
    return query select false, p_rule_id, null::integer,
                        coalesce(ctx.refusal_code, 'NOT_AN_APPROVER'),
                        coalesce(ctx.refusal_reason,
                          'This account may not verify a policy rule.')
                        || ' Verifying a rule is what allows its value to be quoted to a customer, '
                        || 'so it is gated on the same approval authority as an inventory action '
                        || '(inventory_action_policy).';
    return;
  end if;

  select * into r from public.policy_rule where id = p_rule_id;
  if not found then
    return query select false, p_rule_id, null::integer, 'NO_SUCH_RULE',
      'No rule with that id exists.';
    return;
  end if;

  -- A global rule binds every dealership. One dealership's manager cannot be
  -- the one who says it is true.
  if r.tenant_id is null then
    return query select false, p_rule_id, r.version, 'GLOBAL_RULE_NOT_TENANT_VERIFIABLE',
      'This rule has no tenant, so it applies to every dealership on the platform. A single '
      'dealership''s approver may not verify it — that would let one customer''s staff change what '
      'every other customer''s system treats as law. Global rules are verified by the platform.';
    return;
  end if;

  if r.tenant_id <> ctx.tenant_id then
    return query select false, p_rule_id, r.version, 'WRONG_TENANT',
      'That rule belongs to another dealership.';
    return;
  end if;

  if r.verification_status = 'UNKNOWN' then
    return query select false, p_rule_id, r.version, 'NO_VALUE_TO_VERIFY',
      'This rule states no value — it is registered as a question. There is nothing to verify. '
      'Supersede it with a version that states the value the source gives.';
    return;
  end if;

  if r.status in ('SUPERSEDED','WITHDRAWN') then
    return query select false, p_rule_id, r.version, 'RULE_IS_RETIRED',
      format('This version is %s and is closed to further change.', r.status);
    return;
  end if;

  if r.verification_status = 'VERIFIED' then
    return query select false, p_rule_id, r.version, 'ALREADY_VERIFIED',
      format('Already verified by %s on %s. Re-sourcing a verified rule means superseding it, '
             'not overwriting what was checked.', r.verified_by, r.verification_date);
    return;
  end if;

  v_from := coalesce(p_effective_from, r.effective_from);
  if v_from is null then
    return query select false, p_rule_id, r.version, 'NO_EFFECTIVE_FROM',
      'A verified rule must say from when it applies, or no decision can ever be tied to it.';
    return;
  end if;

  if coalesce(p_confidence,'UNKNOWN') = 'UNKNOWN' then
    return query select false, p_rule_id, r.version, 'NO_CONFIDENCE',
      'State HIGH, MEDIUM or LOW confidence. UNKNOWN confidence and VERIFIED are contradictory.';
    return;
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
          format('Checked against %s. Authority: %s.',
                 coalesce(p_source_name, r.source_name, 'the recorded source'),
                 coalesce(ctx.authority, 'unstated')));

  return query select true, p_rule_id, r.version, null::text, null::text;
end;
$$;

comment on function public.policy_verify_rule(uuid,text,text,text,date,text,text) is
  'BUSINESS RULE: only an approver may mark a rule VERIFIED, because VERIFIED is '
  'what permits the value to reach a customer. Authority is read from '
  'action_approver_context() — the SAME record that governs inventory action '
  'approval, reused deliberately rather than duplicated. A global rule cannot be '
  'verified by any single dealership.';

-- ── Superseding: the new version, and the closing of the old one ──────────
create or replace function public.policy_supersede_rule(
  p_rule_id         uuid,
  p_effective_from  date,
  p_source_name     text,
  p_value_numeric   numeric default null,
  p_value_text      text    default null,
  p_source_url      text    default null,
  p_source_document text    default null,
  p_notes           text    default null
) returns table (
  ok             boolean,
  rule_id        uuid,
  version        integer,
  refusal_code   text,
  refusal_reason text
)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  ctx     record;
  r       public.policy_rule%rowtype;
  v_actor text;
  v_new   uuid;
begin
  select * into ctx from public.action_approver_context();

  if not ctx.may_decide then
    return query select false, p_rule_id, null::integer,
                        coalesce(ctx.refusal_code, 'NOT_AN_APPROVER'),
                        coalesce(ctx.refusal_reason, 'This account may not change a policy rule.');
    return;
  end if;

  select * into r from public.policy_rule where id = p_rule_id;
  if not found then
    return query select false, p_rule_id, null::integer, 'NO_SUCH_RULE', 'No rule with that id exists.';
    return;
  end if;
  if r.tenant_id is null then
    return query select false, p_rule_id, r.version, 'GLOBAL_RULE_NOT_TENANT_VERIFIABLE',
      'A global rule may only be superseded by the platform.';
    return;
  end if;
  if r.tenant_id <> ctx.tenant_id then
    return query select false, p_rule_id, r.version, 'WRONG_TENANT', 'That rule belongs to another dealership.';
    return;
  end if;
  if r.status in ('SUPERSEDED','WITHDRAWN') then
    return query select false, p_rule_id, r.version, 'RULE_IS_RETIRED',
      format('Version %s is already %s. Supersede the version that is current.', r.version, r.status);
    return;
  end if;
  if r.effective_from is not null and p_effective_from <= r.effective_from then
    return query select false, p_rule_id, r.version, 'EFFECTIVE_FROM_NOT_AFTER_PREVIOUS',
      format('The new version must start after the one it replaces (%s started %s).', r.version, r.effective_from);
    return;
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
    tenant_id, jurisdiction, rule_type, rule_name,
    value_numeric, value_text, unit, value_kind,
    source_name, source_url, source_document,
    effective_from, notes,
    status, verification_status, confidence,
    version, supersedes_id, added_by, added_by_auth_user_id
  ) values (
    r.tenant_id, r.jurisdiction, r.rule_type, r.rule_name,
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

  return query select true, v_new, r.version + 1, null::text, null::text;
end;
$$;

comment on function public.policy_supersede_rule(uuid,date,text,numeric,text,text,text,text) is
  'BUSINESS RULE: a jurisdiction changing its rule must not erase what the rule '
  'was. This closes the current version (keeping its value, source and dates '
  'intact) and inserts the next version as DRAFT/NOT_VERIFIED — the new figure '
  'is not authoritative until somebody verifies it against the new source.';

create or replace function public.policy_withdraw_rule(
  p_rule_id uuid,
  p_reason  text
) returns table (
  ok boolean, rule_id uuid, version integer, refusal_code text, refusal_reason text
)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  ctx record; r public.policy_rule%rowtype; v_actor text;
begin
  select * into ctx from public.action_approver_context();
  if not ctx.may_decide then
    return query select false, p_rule_id, null::integer,
                        coalesce(ctx.refusal_code,'NOT_AN_APPROVER'),
                        coalesce(ctx.refusal_reason,'This account may not withdraw a policy rule.');
    return;
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then
    return query select false, p_rule_id, null::integer, 'NO_REASON',
      'Withdrawing a rule removes it from every consumer. Say why, so the next reader knows.';
    return;
  end if;
  select * into r from public.policy_rule where id = p_rule_id;
  if not found then
    return query select false, p_rule_id, null::integer, 'NO_SUCH_RULE', 'No rule with that id exists.';
    return;
  end if;
  if r.tenant_id is distinct from ctx.tenant_id then
    return query select false, p_rule_id, r.version,
      case when r.tenant_id is null then 'GLOBAL_RULE_NOT_TENANT_VERIFIABLE' else 'WRONG_TENANT' end,
      'This rule is not this dealership''s to withdraw.';
    return;
  end if;
  if r.status in ('SUPERSEDED','WITHDRAWN') then
    return query select false, p_rule_id, r.version, 'RULE_IS_RETIRED',
      format('Version %s is already %s.', r.version, r.status);
    return;
  end if;

  v_actor := coalesce(nullif(btrim(coalesce(ctx.staff_name,'')),''),
                      nullif(btrim(coalesce(auth.jwt() ->> 'email','')),''),
                      ctx.auth_user_id::text);

  update public.policy_rule set status = 'WITHDRAWN'
   where id = p_rule_id and tenant_id = ctx.tenant_id;

  insert into public.policy_rule_event (rule_id, tenant_id, event, actor, actor_auth_user_id,
                                        from_status, to_status, detail)
  values (p_rule_id, ctx.tenant_id, 'WITHDRAWN', v_actor, ctx.auth_user_id, r.status, 'WITHDRAWN', p_reason);

  return query select true, p_rule_id, r.version, null::text, null::text;
end;
$$;

comment on function public.policy_withdraw_rule(uuid,text) is
  'BUSINESS RULE: pulling a rule is an approver decision and must carry a '
  'reason. The row is not deleted — WITHDRAWN, with the reason in the event log, '
  'so a past decision made under it is still explicable.';
