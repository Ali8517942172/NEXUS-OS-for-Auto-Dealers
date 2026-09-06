-- ============================================================================
-- policy_jurisdiction_ownership
--
-- A jurisdiction is a legislative namespace, and every namespace has an owner.
-- PLATFORM_WHATSAPP is Meta's. AE is a regulator's. NEXUS_HOUSE is ours.
-- None of those are a dealership's to legislate in. Until this migration the
-- jurisdiction column was free text with a shape check, so a signed-in
-- dealership user could file a rule under PLATFORM_WHATSAPP, verify it
-- themselves, and have the engine report the number back as AUTHORITATIVE with
-- applied_rule_jurisdiction = PLATFORM_WHATSAPP -- the audit trail saying Meta
-- said so. Proved on production 4 Sep 2026 in a rolled-back transaction: a
-- 99999-hour customer service window, self-verified by the ALBA CARS owner
-- acting as role authenticated.
--
-- The fix is not "tenants may not propose rules". A dealership may legitimately
-- hold house rules, and some of them are stricter than the platform's. The fix
-- is that a tenant may only legislate in a namespace it owns, and that this is
-- a property of the schema rather than of a function body:
--
--   * policy_jurisdiction names every namespace and who owns it.
--   * policy_rule.jurisdiction_owner_kind is derived on insert and tied to the
--     registry by a composite foreign key, so a row cannot claim an owner the
--     registry does not agree with.
--   * a CHECK makes scope follow ownership: TENANT namespaces are tenant-scoped
--     and nothing else is. A dealership row under PLATFORM_WHATSAPP is now
--     unrepresentable, not merely refused by a function.
--
-- It also builds the record a platform verification has to leave behind.
-- ============================================================================

create table if not exists public.policy_jurisdiction (
  code            text primary key,
  owner_kind      text        not null,
  owner_name      text        not null,
  what_it_covers  text        not null,
  added_at        timestamptz not null default now(),
  constraint policy_jurisdiction_code_shape
    check (code = upper(code) and code ~ '^[A-Z][A-Z_]{1,31}$'),
  constraint policy_jurisdiction_owner_kind_vocabulary
    check (owner_kind in ('PLATFORM','REGULATOR','NEXUS','TENANT')),
  constraint policy_jurisdiction_owner_is_named
    check (nullif(btrim(owner_name),'') is not null),
  -- The target of policy_rule's composite FK. Reclassifying a namespace then
  -- becomes a migration with a visible diff, not an UPDATE nobody reviews.
  constraint policy_jurisdiction_code_owner_uq unique (code, owner_kind)
);

comment on table public.policy_jurisdiction is
  'Every jurisdiction a policy rule can be filed under, and who owns that namespace. '
  'owner_kind TENANT is the only namespace a dealership may legislate in.';

insert into public.policy_jurisdiction (code, owner_kind, owner_name, what_it_covers) values
  ('PLATFORM_WHATSAPP','PLATFORM','Meta Platforms, Inc. (WhatsApp Business Platform)',
   'Rules Meta imposes on every business using the WhatsApp Business Platform. Only the platform operator, holding the Meta account, may verify one.'),
  ('AE','REGULATOR','The applicable United Arab Emirates federal authority',
   'Rules a UAE regulator imposes. A dealership is subject to these; it does not write them.'),
  ('GLOBAL','NEXUS','NEXUS OS',
   'Claims NEXUS itself makes that are not tied to a platform or a territory. Mostly research claims recorded as questions.'),
  ('NEXUS_HOUSE','NEXUS','NEXUS OS',
   'Rules NEXUS chooses to impose on every dealership, stricter than any platform or regulator requires. Recorded as our choice, never as somebody else''s requirement.'),
  ('UNSPECIFIED','NEXUS','Nobody - the jurisdiction has never been established',
   'A holding namespace for constants lifted out of the codebase whose legislator was never identified. Nothing here should ever be authoritative.'),
  ('TENANT_HOUSE','TENANT','The dealership itself',
   'The only namespace a dealership legislates in. A house rule here may tighten what a platform or regulator allows; it can never loosen it, and it binds nobody but the dealership that wrote it.')
on conflict (code) do nothing;

alter table public.policy_rule add column if not exists jurisdiction_owner_kind text;

update public.policy_rule r
   set jurisdiction_owner_kind = j.owner_kind
  from public.policy_jurisdiction j
 where j.code = r.jurisdiction
   and r.jurisdiction_owner_kind is distinct from j.owner_kind;

do $$
declare n int;
begin
  select count(*) into n from public.policy_rule where jurisdiction_owner_kind is null;
  if n > 0 then
    raise exception 'policy_jurisdiction is missing % jurisdiction(s) that policy_rule already uses: %',
      n, (select string_agg(distinct jurisdiction, ', ') from public.policy_rule where jurisdiction_owner_kind is null);
  end if;
end $$;

alter table public.policy_rule alter column jurisdiction_owner_kind set not null;

-- Derived, not stated. A writer that supplies nothing gets the registry's
-- answer; a writer that supplies the wrong answer is refused by the FK below.
create or replace function public.policy_rule_derive_jurisdiction_owner()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
declare v_owner text;
begin
  select j.owner_kind into v_owner
    from public.policy_jurisdiction j where j.code = new.jurisdiction;

  if v_owner is null then
    raise exception using
      errcode = '23503',
      message = format('%L is not a jurisdiction this engine knows.', new.jurisdiction),
      hint    = 'Register it in public.policy_jurisdiction in a migration first, naming who owns the '
                'namespace. Naming a new legislator is a modelling decision, not a data entry.';
  end if;

  if new.jurisdiction_owner_kind is null then
    new.jurisdiction_owner_kind := v_owner;
  end if;

  return new;
end;
$function$;

revoke all on function public.policy_rule_derive_jurisdiction_owner() from anon, authenticated, public;

drop trigger if exists policy_rule_derive_jurisdiction_owner on public.policy_rule;
create trigger policy_rule_derive_jurisdiction_owner
  before insert on public.policy_rule
  for each row execute function public.policy_rule_derive_jurisdiction_owner();

alter table public.policy_rule
  add constraint policy_rule_jurisdiction_is_registered
    foreign key (jurisdiction) references public.policy_jurisdiction(code)
    on update restrict on delete restrict;

alter table public.policy_rule
  add constraint policy_rule_jurisdiction_owner_agrees
    foreign key (jurisdiction, jurisdiction_owner_kind)
    references public.policy_jurisdiction(code, owner_kind)
    on update restrict on delete restrict;

-- The structural half of the P0 fix. A tenant-scoped row can only exist in a
-- TENANT namespace, and a TENANT namespace row can only exist tenant-scoped.
alter table public.policy_rule
  add constraint policy_rule_scope_follows_jurisdiction
    check ((jurisdiction_owner_kind = 'TENANT') = (tenant_id is not null));

-- ---------------------------------------------------------------------------
-- What a platform verification has to leave behind.
--
-- A dealership approver verifying their own house rule is authenticated by the
-- session: action_approver_context() knows who they are and which dealership
-- they belong to, and policy_rule_event records auth_user_id. The platform
-- operator has no session -- the act reaches the database as service_role, which
-- is machinery, not a person. So the evidence cannot be derived; it has to be
-- stated, and the statement is this row.
-- ---------------------------------------------------------------------------
create table if not exists public.policy_platform_attestation (
  attestation_id      uuid primary key default gen_random_uuid(),
  rule_id             uuid        not null references public.policy_rule(id) on delete restrict,
  attested_by         text        not null,
  attested_by_contact text        not null,
  attested_at         timestamptz not null default now(),
  source_kind         text        not null,
  source_name         text        not null,
  source_ref          text        not null,
  source_observed_on  date        not null,
  account_ref         text,
  confidence          text        not null,
  notes               text,
  constraint ppa_attested_by_is_a_person check (
      length(btrim(attested_by)) >= 3
      and lower(btrim(attested_by)) not in
          ('postgres','service_role','anon','authenticated','n8n','nexus','nexus os',
           'system','automation','admin','root','api','operator','platform')),
  constraint ppa_contact_is_reachable
    check (attested_by_contact ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint ppa_source_kind_vocabulary check (source_kind in (
      'PROVIDER_ACCOUNT_CONSOLE',
      'PROVIDER_PUBLIC_DOCUMENTATION',
      'REGULATOR_PUBLICATION',
      'CONTRACT',
      'LEGAL_ADVICE')),
  constraint ppa_account_check_names_the_account
    check (source_kind <> 'PROVIDER_ACCOUNT_CONSOLE'
           or nullif(btrim(coalesce(account_ref,'')),'') is not null),
  constraint ppa_source_is_named check (nullif(btrim(source_name),'') is not null),
  constraint ppa_source_ref_is_a_reference_not_a_secret check (
      length(btrim(source_ref)) >= 4
      and source_ref !~* '^(eyJ|sk-|sb_secret_|sbp_|service_role|bearer)'),
  constraint ppa_confidence_vocabulary check (confidence in ('HIGH','MEDIUM','LOW'))
);

comment on table public.policy_platform_attestation is
  'One row per act of a named human checking a global policy rule against its source on behalf of the '
  'platform. A global rule cannot be VERIFIED without one, and a tenant rule may never carry one.';

create index if not exists policy_platform_attestation_rule_ix
  on public.policy_platform_attestation (rule_id, attested_at desc);

create or replace function public.policy_platform_attestation_append_only()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
begin
  raise exception using
    errcode = '42501',
    message = 'policy_platform_attestation is append-only: an attestation records what somebody '
              'checked on a day, and that does not change afterwards.',
    hint    = 'If the check was wrong, supersede the rule and attest the new version.';
  return null;
end;
$function$;

revoke all on function public.policy_platform_attestation_append_only() from anon, authenticated, public;

drop trigger if exists policy_platform_attestation_no_rewrite on public.policy_platform_attestation;
create trigger policy_platform_attestation_no_rewrite
  before update or delete on public.policy_platform_attestation
  for each row execute function public.policy_platform_attestation_append_only();

alter table public.policy_rule
  add column if not exists platform_attestation_id uuid
    references public.policy_platform_attestation(attestation_id) on delete restrict;

-- Only a global rule may carry an attestation. This is what stops the tenant
-- path from ever manufacturing platform authority.
alter table public.policy_rule
  add constraint policy_rule_attestation_is_for_global_rules_only
    check (platform_attestation_id is null or tenant_id is null);

-- And a global rule cannot be VERIFIED without one. Written as an implication
-- rather than an equivalence on purpose: a rule later marked DISPUTED keeps the
-- attestation that was made, because it happened.
alter table public.policy_rule
  add constraint policy_rule_global_verified_needs_platform_attestation
    check (tenant_id is not null
           or verification_status <> 'VERIFIED'
           or platform_attestation_id is not null);

-- ---------------------------------------------------------------------------
-- Freeze the two new columns the same way the rest of a rule version is frozen.
-- ---------------------------------------------------------------------------
create or replace function public.policy_rule_guard_immutability()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  frozen text;
begin
  -- The rule itself never changes. A different value is a different version.
  if new.tenant_id     is distinct from old.tenant_id     then frozen := 'tenant_id';
  elsif new.jurisdiction  is distinct from old.jurisdiction  then frozen := 'jurisdiction';
  elsif new.jurisdiction_owner_kind is distinct from old.jurisdiction_owner_kind
                                                             then frozen := 'jurisdiction_owner_kind';
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
  -- An attestation is attached once, by the act of verifying. Re-pointing it at
  -- a different attestation would move the evidence out from under a verified
  -- rule without changing anything a reader would notice.
  elsif old.platform_attestation_id is not null
        and new.platform_attestation_id is distinct from old.platform_attestation_id
                                                             then frozen := 'platform_attestation_id';
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
$function$;

revoke all on function public.policy_rule_guard_immutability() from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- Grants. Supabase default privileges hand anon and authenticated everything on
-- anything created in public, so both new tables arrive wide open. Read the ACL
-- back after this runs; relacl alone will not show the column grants below.
-- ---------------------------------------------------------------------------
revoke all on public.policy_jurisdiction           from anon, authenticated, public;
revoke all on public.policy_platform_attestation   from anon, authenticated, public;

grant select on public.policy_jurisdiction to authenticated;
grant all    on public.policy_jurisdiction to service_role;

-- A dealership may see that a human vouched for a rule that binds it, and on
-- what source. It may not see that person's contact address or the platform
-- account identifier the check was made inside; neither is the dealership's.
grant select (attestation_id, rule_id, attested_by, attested_at, source_kind,
              source_name, source_ref, source_observed_on, confidence, notes)
  on public.policy_platform_attestation to authenticated;
grant all on public.policy_platform_attestation to service_role;

alter table public.policy_jurisdiction         enable row level security;
alter table public.policy_platform_attestation enable row level security;

drop policy if exists policy_jurisdiction_authenticated_read on public.policy_jurisdiction;
create policy policy_jurisdiction_authenticated_read on public.policy_jurisdiction
  for select to authenticated using (true);
drop policy if exists policy_jurisdiction_deny_anon on public.policy_jurisdiction;
create policy policy_jurisdiction_deny_anon on public.policy_jurisdiction
  as restrictive for all to anon using (false) with check (false);
drop policy if exists policy_jurisdiction_service_role_all on public.policy_jurisdiction;
create policy policy_jurisdiction_service_role_all on public.policy_jurisdiction
  for all to service_role using (true) with check (true);

drop policy if exists policy_platform_attestation_authenticated_read on public.policy_platform_attestation;
create policy policy_platform_attestation_authenticated_read on public.policy_platform_attestation
  for select to authenticated using (true);
drop policy if exists policy_platform_attestation_deny_anon on public.policy_platform_attestation;
create policy policy_platform_attestation_deny_anon on public.policy_platform_attestation
  as restrictive for all to anon using (false) with check (false);
drop policy if exists policy_platform_attestation_service_role_all on public.policy_platform_attestation;
create policy policy_platform_attestation_service_role_all on public.policy_platform_attestation
  for all to service_role using (true) with check (true);