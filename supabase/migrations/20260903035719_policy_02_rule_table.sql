-- ===========================================================================
-- POLICY ENGINE — 02 · policy_rule, the versioned record of a stated rule
--
-- BUSINESS RULE (the one that outranks the schema)
-- A MODEL MAY NEVER INVENT A POLICY VALUE. Where no authoritative rule exists,
-- the answer is UNKNOWN or NOT_VERIFIED and carries no number at all — never an
-- inferred one. Every row therefore has to say, on its own face, where it came
-- from, who put it there, who checked it, when it was checked, and for what
-- span of dates it was true.
--
-- WHY THIS TABLE EXISTS, concretely
--   · An AED 50/day holding cost was hard-coded from a browser constant and fed
--     a manager-facing margin figure for weeks. Nobody had ever quoted it.
--   · `vat_amount = price * 0.05` still sits in recompute_inventory_derived()
--     as a bare literal — correct for the UAE today, but a jurisdiction rule
--     with no source, no effective date and no owner.
--   · PRODUCT.md records three research claims that were refused as fact until
--     sourced. They belong here with a source, or nowhere.
--
-- VERSIONING
-- A jurisdiction changing its rule must NOT overwrite the evidence of what the
-- rule was when a past decision was made. A quote issued last March was correct
-- under last March's rule. So versions are ROWS, not edits: superseding a rule
-- inserts a new row at version n+1 pointing back at version n through
-- supersedes_id, and closes the old row's effective_to. Nothing is deleted and
-- the value/source/date fields of an existing row are immutable (enforced in
-- policy_03).
--
-- TENANCY
--   tenant_id NULL  = a rule that applies to every dealership in that
--                     jurisdiction. Readable by all tenants; it carries no
--                     tenant data, so nothing leaks.
--   tenant_id SET   = a rule specific to one dealership (its bank panel, its
--                     own commercial caps). Readable only by that dealership.
-- ===========================================================================

create table if not exists public.policy_rule (
  id                       uuid primary key default gen_random_uuid(),

  -- NULL means "globally applicable in this jurisdiction". See TENANCY above.
  tenant_id                uuid references public.tenants(id) on delete restrict,

  -- ISO-3166 alpha-2 where the rule belongs to a country ('AE', 'SA', 'GB').
  -- Two reserved tokens: 'GLOBAL' for a rule with no jurisdiction (a platform
  -- or vendor rule), and 'UNSPECIFIED' for a claim that was made WITHOUT ever
  -- naming a jurisdiction — which is itself the defect being recorded.
  jurisdiction             text not null
                             check (jurisdiction = upper(jurisdiction)
                                    and jurisdiction ~ '^[A-Z][A-Z_]{1,31}$'),

  rule_type                text not null references public.policy_rule_type(code),

  -- The stable identity of the rule inside its (tenant, jurisdiction, type).
  -- Consumers look a rule up by this name, so renaming one breaks callers:
  -- supersede instead.
  rule_name                text not null
                             check (rule_name = upper(rule_name)
                                    and rule_name ~ '^[A-Z][A-Z0-9_]{2,79}$'),

  -- ── the value ────────────────────────────────────────────────────────────
  -- Exactly one of these is populated, and only when the rule actually states
  -- a value. An UNKNOWN rule populates NEITHER: that is the whole point.
  value_numeric            numeric,
  value_text               text,
  unit                     text not null references public.policy_unit(code),
  value_kind               text not null,

  -- ── provenance ───────────────────────────────────────────────────────────
  source_url               text,
  source_name              text,      -- who says so: 'CBUAE', 'Federal Decree-Law 8/2017', 'a constant in this repo'
  source_document          text,      -- the specific instrument, article or file:line

  -- ── the span over which this version was true ────────────────────────────
  effective_from           date,
  effective_to             date,      -- NULL = still open

  -- ── who checked it, and when ─────────────────────────────────────────────
  verification_date        date,
  verified_by              text,
  verified_by_auth_user_id uuid,
  confidence               text not null default 'UNKNOWN'
                             check (confidence in ('HIGH','MEDIUM','LOW','UNKNOWN')),

  -- Lifecycle: is this version the one in force?
  status                   text not null default 'DRAFT'
                             check (status in ('DRAFT','ACTIVE','SUPERSEDED','WITHDRAWN')),

  -- Evidence: has a human checked it against the source?
  verification_status      text not null default 'NOT_VERIFIED'
                             check (verification_status in ('VERIFIED','NOT_VERIFIED','UNKNOWN','DISPUTED')),

  notes                    text,

  -- ── versioning and authorship ────────────────────────────────────────────
  version                  integer not null default 1 check (version >= 1),
  supersedes_id            uuid references public.policy_rule(id) on delete restrict,
  added_by                 text not null,
  added_by_auth_user_id    uuid,
  added_at                 timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- The composite FK that makes a NUMERIC value under a TEXT unit impossible.
  constraint policy_rule_unit_kind_fk
    foreign key (unit, value_kind) references public.policy_unit(code, value_kind),

  -- UNKNOWN states NO value. This is the constraint that stops "we don't know
  -- the rule" from silently becoming "the rule is zero".
  constraint policy_rule_unknown_carries_no_value check (
    verification_status <> 'UNKNOWN'
    or (value_numeric is null and value_text is null)
  ),

  -- A rule that is not UNKNOWN states exactly one value, in the column its
  -- unit demands.
  constraint policy_rule_states_one_value check (
    verification_status = 'UNKNOWN'
    or (
      num_nonnulls(value_numeric, value_text) = 1
      and (value_kind <> 'NUMERIC' or value_numeric is not null)
      and (value_kind =  'NUMERIC' or value_text    is not null)
    )
  ),

  -- An UNKNOWN rule can never be in force. It may sit as DRAFT (a question
  -- somebody has registered) or WITHDRAWN, and nothing else.
  constraint policy_rule_unknown_is_never_active check (
    verification_status <> 'UNKNOWN' or status in ('DRAFT','WITHDRAWN')
  ),

  -- VERIFIED is a claim about evidence, so it requires the evidence. A row
  -- cannot be marked VERIFIED without naming who says so, pointing at the
  -- instrument, saying who checked it and when, and stating from when it
  -- applies. Nor may it hide behind UNKNOWN confidence.
  constraint policy_rule_verified_needs_evidence check (
    verification_status <> 'VERIFIED'
    or (
      nullif(btrim(coalesce(source_name, '')), '') is not null
      and coalesce(nullif(btrim(coalesce(source_url, '')), ''),
                   nullif(btrim(coalesce(source_document, '')), '')) is not null
      and verification_date is not null
      and nullif(btrim(coalesce(verified_by, '')), '') is not null
      and effective_from is not null
      and confidence <> 'UNKNOWN'
    )
  ),

  -- Every row, verified or not, must say where it came from. "A constant
  -- somebody typed in screens/finance.js:291" is a legitimate answer here and
  -- an illegitimate one above.
  constraint policy_rule_always_names_an_origin check (
    nullif(btrim(coalesce(source_name, '')), '') is not null
  ),

  constraint policy_rule_effective_span_is_ordered check (
    effective_to is null or effective_from is null or effective_to > effective_from
  ),

  -- Version 1 supersedes nothing; every later version must name its parent.
  constraint policy_rule_version_chain check (
    (version = 1 and supersedes_id is null)
    or (version > 1 and supersedes_id is not null)
  ),

  constraint policy_rule_added_by_is_named check (
    nullif(btrim(added_by), '') is not null
  )
);

-- One version number per rule identity. Two partial indexes because NULL
-- tenant_id is a real value here ("global"), not an absence, and a plain
-- unique index would let two global rules share a version number.
create unique index if not exists policy_rule_tenant_version_uq
  on public.policy_rule (tenant_id, jurisdiction, rule_type, rule_name, version)
  where tenant_id is not null;

create unique index if not exists policy_rule_global_version_uq
  on public.policy_rule (jurisdiction, rule_type, rule_name, version)
  where tenant_id is null;

-- A superseded version is named exactly once, so a chain cannot fork.
create unique index if not exists policy_rule_supersedes_uq
  on public.policy_rule (supersedes_id)
  where supersedes_id is not null;

create index if not exists policy_rule_lookup_ix
  on public.policy_rule (jurisdiction, rule_type, rule_name, status);

create index if not exists policy_rule_tenant_ix
  on public.policy_rule (tenant_id) where tenant_id is not null;

comment on table public.policy_rule is
  'One row per VERSION of one jurisdiction or commercial rule. Never edited in '
  'place: superseding inserts a new row and closes the old one, so the evidence '
  'behind a decision taken last March survives this March''s rule change. '
  'status says whether this version is in force; verification_status says '
  'whether a human has checked it against the source. A row can be ACTIVE and '
  'NOT_VERIFIED — that is the honest description of a constant the code already '
  'obeys but nobody has sourced. Consumers must read v_policy_authoritative or '
  'call policy_numeric()/policy_citation(), which exclude those rows.';

comment on column public.policy_rule.tenant_id is
  'NULL means the rule applies to every dealership in this jurisdiction and is '
  'readable by all tenants. Non-NULL means it is that dealership''s own rule.';
comment on column public.policy_rule.jurisdiction is
  'ISO-3166 alpha-2, or the reserved tokens GLOBAL (no jurisdiction applies) '
  'and UNSPECIFIED (a claim made without naming one — the defect, recorded).';
comment on column public.policy_rule.value_numeric is
  'The numeric value, in the unit named by `unit`. NULL whenever '
  'verification_status is UNKNOWN. A missing value means UNKNOWN, never zero.';
comment on column public.policy_rule.unit is
  'PCT means out of 100: five percent is 5, not 0.05. Use RATIO only where the '
  'source itself publishes a ratio.';
comment on column public.policy_rule.source_name is
  'Who says so. Required on every row. For a value lifted out of this '
  'codebase the honest answer is the file and line, NOT the regulator that '
  'constant was guessing at.';
comment on column public.policy_rule.verification_status is
  'VERIFIED: a human checked it against the cited source on verification_date. '
  'NOT_VERIFIED: the value is recorded but nobody has checked it. '
  'UNKNOWN: no value is stated at all. DISPUTED: sources disagree.';
comment on column public.policy_rule.status is
  'DRAFT / ACTIVE / SUPERSEDED / WITHDRAWN. Lifecycle only. ACTIVE says this '
  'version is the one in force for its effective span; it says nothing about '
  'whether anybody verified it.';
comment on column public.policy_rule.supersedes_id is
  'The version this row replaced. The chain is the audit trail: follow it back '
  'to read the rule as it stood on any past date.';
