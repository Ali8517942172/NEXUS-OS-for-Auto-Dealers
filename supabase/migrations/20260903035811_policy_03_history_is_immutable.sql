-- ===========================================================================
-- POLICY ENGINE — 03 · history is immutable, and two ACTIVE versions cannot
--                      claim the same day
--
-- BUSINESS RULE
-- A quote issued last March was correct under last March's rule. So the record
-- of what the rule WAS must survive the rule changing. Two guards enforce that:
--
--  1. IMMUTABILITY. Once a rule version exists, the fields that constitute the
--     rule — what it says, in what unit, for whom, from when — cannot be
--     edited. Changing a rule means inserting the next version. The only
--     fields that may move are the ones that describe the version's standing
--     (its status, its verification, its closing date, its notes), and even
--     those freeze once the row is VERIFIED or retired. Without this,
--     `update policy_rule set value_numeric = 5` would silently rewrite every
--     past decision that had relied on the old figure, leaving no trace.
--
--  2. NO OVERLAPPING ACTIVE VERSIONS. Two rows both claiming to be the rule in
--     force on the same date is not a data-quality nuisance; it is a fork, and
--     a consumer asking "what is the VAT rate today" would get whichever the
--     planner returned first. btree_gist (which would allow a declarative
--     EXCLUDE constraint) is NOT installed on this project and installing an
--     extension creates objects that are born with anon grants nothing here can
--     revoke, so the guard is a trigger instead.
--
-- Every transition is written to policy_rule_event, which is append-only. That
-- is the "who added, who verified, when" trail.
-- ===========================================================================

create table if not exists public.policy_rule_event (
  id                 uuid primary key default gen_random_uuid(),
  rule_id            uuid not null references public.policy_rule(id) on delete restrict,
  tenant_id          uuid references public.tenants(id) on delete restrict,
  event              text not null check (event in
                       ('PROPOSED','VERIFIED','UNVERIFIED','DISPUTED','ACTIVATED',
                        'SUPERSEDED','WITHDRAWN','CLOSED','ANNOTATED','CORRECTED')),
  actor              text not null,
  actor_auth_user_id uuid,
  at                 timestamptz not null default now(),
  from_status        text,
  to_status          text,
  from_verification  text,
  to_verification    text,
  detail             text
);

create index if not exists policy_rule_event_rule_ix on public.policy_rule_event (rule_id, at);

comment on table public.policy_rule_event is
  'Append-only trail of what happened to a rule version and who did it. Rows '
  'are never updated or deleted; a mistake is recorded as a further event, not '
  'erased. This is the answer to "who verified this, and when".';

-- ── Guard 1 · what may change after a row exists ──────────────────────────
create or replace function public.policy_rule_guard_immutability()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  frozen text;
begin
  -- The rule itself never changes. A different value is a different version.
  if new.tenant_id     is distinct from old.tenant_id     then frozen := 'tenant_id';
  elsif new.jurisdiction  is distinct from old.jurisdiction  then frozen := 'jurisdiction';
  elsif new.rule_type     is distinct from old.rule_type     then frozen := 'rule_type';
  elsif new.rule_name     is distinct from old.rule_name     then frozen := 'rule_name';
  elsif new.value_numeric is distinct from old.value_numeric then frozen := 'value_numeric';
  elsif new.value_text    is distinct from old.value_text    then frozen := 'value_text';
  elsif new.unit          is distinct from old.unit          then frozen := 'unit';
  elsif new.value_kind    is distinct from old.value_kind    then frozen := 'value_kind';
  elsif new.version       is distinct from old.version       then frozen := 'version';
  elsif new.supersedes_id is distinct from old.supersedes_id then frozen := 'supersedes_id';
  elsif new.added_by      is distinct from old.added_by      then frozen := 'added_by';
  elsif new.added_at      is distinct from old.added_at      then frozen := 'added_at';
  end if;

  if frozen is not null then
    raise exception using
      errcode = '23514',
      message = format('policy_rule.%s cannot be changed on an existing rule version (rule %s, %s v%s).',
                       frozen, old.id, old.rule_name, old.version),
      hint    = 'Insert the next version with policy_supersede_rule() instead. '
                'Editing this row in place would rewrite the evidence behind every past decision that used it.';
  end if;

  -- effective_from is part of the rule once it is in force.
  if old.status <> 'DRAFT' and new.effective_from is distinct from old.effective_from then
    raise exception using
      errcode = '23514',
      message = format('policy_rule.effective_from cannot be changed once a version leaves DRAFT (rule %s, status %s).',
                       old.id, old.status),
      hint    = 'Supersede the version instead.';
  end if;

  -- Once a version is VERIFIED, its evidence is frozen. Re-sourcing it is a
  -- new version, not an edit to the old one.
  if old.verification_status = 'VERIFIED'
     and (new.source_url        is distinct from old.source_url
       or new.source_name       is distinct from old.source_name
       or new.source_document   is distinct from old.source_document
       or new.verification_date is distinct from old.verification_date
       or new.verified_by       is distinct from old.verified_by) then
    raise exception using
      errcode = '23514',
      message = format('The provenance of a VERIFIED rule version is frozen (rule %s).', old.id),
      hint    = 'If the source was wrong, supersede the version. Do not overwrite what was checked.';
  end if;

  -- A retired version is closed. Only notes may be appended to it, because a
  -- later reader may need to know why it was retired.
  if old.status in ('SUPERSEDED','WITHDRAWN')
     and (new.status              is distinct from old.status
       or new.verification_status is distinct from old.verification_status
       or new.effective_to        is distinct from old.effective_to
       or new.confidence          is distinct from old.confidence) then
    raise exception using
      errcode = '23514',
      message = format('Rule version %s is %s and is closed to further change.', old.id, old.status),
      hint    = 'Only notes may be added to a retired version.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on function public.policy_rule_guard_immutability() is
  'BUSINESS RULE: a rule version is evidence, not a mutable setting. What the '
  'rule said, in what unit, for whom and from when cannot be edited after the '
  'fact; changing a rule means adding a version.';

drop trigger if exists policy_rule_immutability on public.policy_rule;
create trigger policy_rule_immutability
  before update on public.policy_rule
  for each row execute function public.policy_rule_guard_immutability();

-- ── Guard 2 · one rule in force at a time ─────────────────────────────────
create or replace function public.policy_rule_guard_one_active()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  clash public.policy_rule%rowtype;
begin
  if new.status <> 'ACTIVE' then
    return new;
  end if;

  select r.* into clash
    from public.policy_rule r
   where r.id <> new.id
     and r.status = 'ACTIVE'
     and r.jurisdiction = new.jurisdiction
     and r.rule_type    = new.rule_type
     and r.rule_name    = new.rule_name
     and r.tenant_id is not distinct from new.tenant_id
     -- daterange with an unbounded end where effective_to is null; an
     -- unbounded start where effective_from is null.
     and daterange(r.effective_from, r.effective_to, '[)')
         && daterange(new.effective_from, new.effective_to, '[)')
   limit 1;

  if found then
    raise exception using
      errcode = '23505',
      message = format('Rule %s/%s/%s already has an ACTIVE version (%s, v%s) covering these dates.',
                       new.jurisdiction, new.rule_type, new.rule_name, clash.id, clash.version),
      hint    = 'Close the existing version first — policy_supersede_rule() does both in one step. '
                'Two ACTIVE versions covering one date is a fork: a consumer asking what the rule is '
                'would get whichever row the planner returned first.';
  end if;

  return new;
end;
$$;

comment on function public.policy_rule_guard_one_active() is
  'BUSINESS RULE: for one (tenant, jurisdiction, rule_type, rule_name) at most '
  'one version may be ACTIVE over any given date. Prevents a fork where two '
  'rows both claim to be the rule in force.';

drop trigger if exists policy_rule_one_active on public.policy_rule;
create trigger policy_rule_one_active
  before insert or update on public.policy_rule
  for each row execute function public.policy_rule_guard_one_active();

-- ── The event log is append-only ──────────────────────────────────────────
create or replace function public.policy_rule_event_append_only()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
begin
  raise exception using
    errcode = '23514',
    message = 'policy_rule_event is append-only; a correction is a further event, not an edit.';
end;
$$;

drop trigger if exists policy_rule_event_no_rewrite on public.policy_rule_event;
create trigger policy_rule_event_no_rewrite
  before update or delete on public.policy_rule_event
  for each row execute function public.policy_rule_event_append_only();
