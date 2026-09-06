-- ===========================================================================
-- POLICY ENGINE — 01 · the controlled vocabularies
--
-- BUSINESS RULE
-- A jurisdiction or commercial rule (a VAT rate, an LTV cap, an export
-- restriction, a messaging window) is DATA that came from an authoritative
-- source, never a constant somebody typed into a file. Before a rule can be
-- stored at all, two things must be sayable in one agreed word each: WHAT KIND
-- of rule it is, and WHAT UNIT its value is expressed in.
--
-- These two catalogues exist so "5% VAT" and "0.05 vat" cannot both be written
-- into the same column and mean different things, and so a consumer reading a
-- number knows without guessing whether it is a percentage, a ratio, a count of
-- months, or a currency amount. Extending either is a migration, deliberately:
-- a new unit is a modelling decision, not a typo waiting to happen.
--
-- These tables hold NO tenant data and NO jurisdiction claims. They are the
-- alphabet, not the sentences.
-- ===========================================================================

create table if not exists public.policy_rule_type (
  code        text primary key check (code = upper(code) and code ~ '^[A-Z][A-Z_]{2,39}$'),
  label       text not null,
  description text not null,
  created_at  timestamptz not null default now()
);

comment on table public.policy_rule_type is
  'The eight kinds of rule the Policy Engine holds. A rule type is a domain, '
  'not a value: it says which part of the product reads the rule, never what '
  'the rule says.';

insert into public.policy_rule_type (code, label, description) values
  ('FINANCE', 'Finance',
   'Rules governing lending against a vehicle: LTV ceilings, down-payment floors, maximum tenure, rate-disclosure obligations, permitted lenders.'),
  ('TAX', 'Tax',
   'Rules imposing or exempting a tax on a vehicle transaction: VAT rate, registration duty, margin-scheme treatment.'),
  ('EXPORT', 'Export',
   'Rules restricting or conditioning the sale of a vehicle OUT of a jurisdiction: export certificates, de-registration, age or emissions limits at the border.'),
  ('IMPORT', 'Import',
   'Rules restricting or conditioning bringing a vehicle INTO a jurisdiction: age limits, left/right hand drive, homologation, duty rates.'),
  ('VEHICLE_ELIGIBILITY', 'Vehicle eligibility',
   'Rules about which vehicles may lawfully be sold, financed, registered or advertised in a jurisdiction, independent of who the buyer is.'),
  ('MESSAGING', 'Messaging',
   'Rules governing contacting a person: consent, opt-out, permitted hours, channel-specific windows, template pre-approval.'),
  ('CAMPAIGN', 'Campaign',
   'Rules governing advertising and promotion: price-claim substantiation, mandatory disclosures, prize and finance-advert requirements.'),
  ('COMPLIANCE', 'Compliance',
   'Rules imposing an obligation on the dealership itself: KYC/AML thresholds, record retention, reporting duties, licence conditions.')
on conflict (code) do nothing;

create table if not exists public.policy_unit (
  code        text primary key check (code = upper(code) and code ~ '^[A-Z][A-Z0-9_]{0,39}$'),
  label       text not null,
  value_kind  text not null check (value_kind in ('NUMERIC','TEXT','BOOLEAN')),
  description text not null,
  created_at  timestamptz not null default now(),
  -- Referenced as a composite foreign key by policy_rule so a rule cannot
  -- declare a NUMERIC value under a TEXT unit. See policy_02.
  constraint policy_unit_code_kind_uq unique (code, value_kind)
);

comment on table public.policy_unit is
  'The units a policy value may be expressed in, and the kind of column that '
  'value must live in. policy_rule carries a composite FK onto (code, '
  'value_kind), so a rule declaring unit PCT can only ever populate the '
  'numeric column, and a rule declaring unit TEXT can only ever populate the '
  'text one. This is the constraint that stops "5" and "0.05" both being '
  'written as a VAT rate.';

insert into public.policy_unit (code, label, value_kind, description) values
  ('PCT',         'Percent',              'NUMERIC', 'A percentage expressed out of 100. 5 means five percent, NOT 0.05.'),
  ('RATIO',       'Ratio',                'NUMERIC', 'A dimensionless fraction. 0.05 means five percent. Use PCT unless the source itself publishes a ratio.'),
  ('MULTIPLIER',  'Multiplier',           'NUMERIC', 'A dimensionless factor applied to another figure. 1.87 means "times 1.87".'),
  ('AED',         'UAE dirham',           'NUMERIC', 'An absolute amount in AED.'),
  ('AED_PER_DAY', 'UAE dirham per day',   'NUMERIC', 'An AED amount accruing once per calendar day.'),
  ('MONTHS',      'Months',               'NUMERIC', 'A whole number of months.'),
  ('YEARS',       'Years',                'NUMERIC', 'A whole number of years.'),
  ('DAYS',        'Days',                 'NUMERIC', 'A whole number of days.'),
  ('HOURS',       'Hours',                'NUMERIC', 'A whole number of hours.'),
  ('MINUTES',     'Minutes',              'NUMERIC', 'A whole number of minutes.'),
  ('COUNT',       'Count',                'NUMERIC', 'A dimensionless count of things.'),
  ('SCORE',       'Score',                'NUMERIC', 'A point on a named scale; the scale itself belongs in notes.'),
  ('BOOLEAN',     'Permitted / not',      'BOOLEAN', 'The rule permits or forbids. Stored as the text true/false.'),
  ('TEXT',        'Free text',            'TEXT',    'The rule is prose and has no numeric form. Quote the source, do not paraphrase it.'),
  ('ENUM',        'Enumerated value',     'TEXT',    'The rule names one of a fixed set of options; the set belongs in notes.'),
  ('ISO_DATE',    'Date',                 'TEXT',    'The rule IS a date (a deadline, a cut-off). Stored ISO-8601.')
on conflict (code) do nothing;

-- Vocabularies are readable by everyone signed in and writable by nobody but
-- the platform. They contain no tenant data, so there is nothing to scope.
alter table public.policy_rule_type enable row level security;
alter table public.policy_unit      enable row level security;

drop policy if exists policy_rule_type_authenticated_read on public.policy_rule_type;
create policy policy_rule_type_authenticated_read on public.policy_rule_type
  for select to authenticated using (true);
drop policy if exists policy_rule_type_service_role_all on public.policy_rule_type;
create policy policy_rule_type_service_role_all on public.policy_rule_type
  for all to service_role using (true) with check (true);
drop policy if exists policy_rule_type_deny_anon on public.policy_rule_type;
create policy policy_rule_type_deny_anon on public.policy_rule_type
  as restrictive for all to anon using (false) with check (false);

drop policy if exists policy_unit_authenticated_read on public.policy_unit;
create policy policy_unit_authenticated_read on public.policy_unit
  for select to authenticated using (true);
drop policy if exists policy_unit_service_role_all on public.policy_unit;
create policy policy_unit_service_role_all on public.policy_unit
  for all to service_role using (true) with check (true);
drop policy if exists policy_unit_deny_anon on public.policy_unit;
create policy policy_unit_deny_anon on public.policy_unit
  as restrictive for all to anon using (false) with check (false);

-- Supabase default privileges grant anon AND authenticated arwdDxtm on every
-- new table in public, and a direct grant is a separate ACL row from the
-- PUBLIC one — so both must be revoked, every time, and then read back.
revoke all on public.policy_rule_type from anon, authenticated, public;
revoke all on public.policy_unit      from anon, authenticated, public;
grant select on public.policy_rule_type to authenticated;
grant select on public.policy_unit      to authenticated;
grant select, insert, update, delete on public.policy_rule_type to service_role;
grant select, insert, update, delete on public.policy_unit      to service_role;
