-- ===========================================================================
-- POLICY ENGINE — 10 · the register of constants NOT yet migrated
--
-- BUSINESS RULE
-- What this engine will cost to adopt is itself a fact worth recording. Every
-- jurisdiction or commercial constant still hard-coded in the code or the
-- database is listed here with its exact location, so the migration is a
-- countable piece of work rather than an open-ended one, and so nobody has to
-- re-run the grep to find out how far it has got.
--
-- THIS TABLE MAKES NO CLAIM ABOUT WHETHER A VALUE IS CORRECT. It says only
-- "this number is asserted at this location and has no source". `reaches_a_
-- customer` is the ranking that matters commercially: a constant that only
-- colours an internal tile is a tidy-up, and a constant that is read out to a
-- buyer on WhatsApp is a liability.
--
-- SURVEYED 2026-09-03 against the live catalogue (pg_get_functiondef /
-- pg_get_viewdef / pg_attrdef / pg_constraint) and against the repo at
-- /home/claude/repo. The n8n rows were read from the repo's workflow JSON, NOT
-- from the n8n box, which was deliberately not touched; the box may have
-- drifted from the repo and those three rows should be re-checked against the
-- PUBLISHED workflow before anyone acts on them.
--
-- NOTHING IN THIS MIGRATION CHANGES ANY OF THE LISTED CODE. It is a report.
-- ===========================================================================

create table if not exists public.policy_unmigrated_constant (
  id                  uuid primary key default gen_random_uuid(),
  layer               text not null check (layer in ('DATABASE','DASHBOARD','N8N_WORKFLOW')),
  location            text not null,
  snippet             text not null,
  current_value       text not null,
  kind                text not null check (kind in ('JURISDICTION','COMMERCIAL','OPERATIONAL')),
  proposed_rule_type  text references public.policy_rule_type(code),
  proposed_rule_name  text,
  reaches_a_customer  boolean not null,
  seeded_as_rule      boolean not null default false,
  note                text not null,
  surveyed_on         date not null default date '2026-09-03',
  created_at          timestamptz not null default now(),
  constraint policy_unmigrated_constant_uq unique (layer, location, snippet)
);

comment on table public.policy_unmigrated_constant is
  'Every jurisdiction or commercial constant still hard-coded in the code or the '
  'database as of the surveyed_on date, with its exact location. This is the '
  'cost of migrating to the Policy Engine, written down. It asserts nothing '
  'about whether any listed value is correct — only that it is asserted with no '
  'source. Rank by reaches_a_customer.';
comment on column public.policy_unmigrated_constant.kind is
  'JURISDICTION: a law, regulation or tax the dealership does not set. '
  'COMMERCIAL: a business rule the dealership DOES set (its commission, its '
  'ageing bands) — still policy, still needs an owner and a date, but the owner '
  'is the dealership. OPERATIONAL: a threshold that shapes internal alerting '
  'only; listed where it has been mistaken for a rule.';
comment on column public.policy_unmigrated_constant.reaches_a_customer is
  'TRUE where the value, or a sentence derived from it, can be seen or heard by '
  'a buyer. These are the liabilities; the rest are tidy-ups.';

insert into public.policy_unmigrated_constant
  (layer, location, snippet, current_value, kind, proposed_rule_type, proposed_rule_name, reaches_a_customer, seeded_as_rule, note)
values

-- ── DATABASE ─────────────────────────────────────────────────────────────
('DATABASE','public.recompute_inventory_derived()','round(b.price * 0.05) as vat_amount','5% of list price','JURISDICTION','TAX','VAT_STANDARD_RATE',true,true,
 'The named example in the brief. A tax rate as a bare literal, with no source, no effective date and no owner. It writes inventory.vat_amount, which the Inventory drawer prints. Migrating it means calling policy_numeric(''AE'',''TAX'',''VAT_STANDARD_RATE'') — which today RAISES, correctly, because the seeded row is NOT_VERIFIED. Do not migrate until the row is verified, or the recompute starts failing.'),

('DATABASE','public.recompute_inventory_derived()','round((b.gross_margin - ...) * 0.05) as recommended_commission  (two branches)','5% of net margin','COMMERCIAL','FINANCE','SALES_COMMISSION_PCT_OF_NET_MARGIN',false,false,
 'A commission rate, not a tax, and it happens to share the number 5 with the VAT literal three lines above it — so a careless find-and-replace on 0.05 would corrupt one while fixing the other. Deliberately NOT seeded: it is one dealership''s commercial term and has no owner on record, so seeding it would be inventing a tenant policy nobody stated.'),

('DATABASE','public.recompute_inventory_derived()','coalesce(s.aging_warn_days, 90), coalesce(s.aging_critical_days, 120)','90 / 120 days','COMMERCIAL','COMPLIANCE','INVENTORY_AGING_BANDS',false,false,
 'Fallbacks that fire when a dealership has no inventory_profit_settings row. A fallback IS an assertion: an unconfigured dealership silently gets 90/120 as if it had chosen them. Compare lib/unit-form.js, which falls back to 75 for the same band — the two disagree today.'),

('DATABASE','public.v_inventory_profit_sentinel','COALESCE(s.promote_days,60), COALESCE(s.wholesale_days,180), COALESCE(s.min_reprice_margin_pct,8.00), COALESCE(s.enquiry_window_days,30), COALESCE(s.min_enquiry_sources,50), COALESCE(s.market_max_age_days,14)','60 / 180 / 8.00% / 30 / 50 / 14','COMMERCIAL','COMPLIANCE','PROFIT_SENTINEL_THRESHOLDS',false,false,
 'Six commercial thresholds that decide whether a unit is recommended for PROMOTE, WHOLESALE or REPRICE. They are settings-table-backed (good) with hard-coded fallbacks (not good): min_reprice_margin_pct 8.00 in particular is a margin floor that shapes a manager-facing recommendation.'),

('DATABASE','public.finance_quotes (constraint finance_quotes_tenure_months_check)','CHECK (tenure_months >= 12 AND tenure_months <= 60)','12 to 60 months','JURISDICTION','FINANCE','MAX_TENURE_MONTHS',false,true,
 'A jurisdiction rule enforced as a DDL constraint. This is the hardest kind to migrate and the easiest to forget: it is invisible to every grep of the application code, it silently rejects a legitimate 72-month quote if the rule ever changes, and altering it needs a migration and a table lock. The 60 matches screens/finance.js:308 and the customer-facing disclaimer, so three copies of one rule now exist in three layers.'),

('DATABASE','public.finance_quotes (constraint finance_quotes_credit_score_check)','CHECK (credit_score >= 300 AND credit_score <= 900)','300 to 900','JURISDICTION','FINANCE','CREDIT_SCORE_SCALE_BOUNDS',false,false,
 'The bounds of the AECB scale, encoded as a constraint. Jurisdiction-specific: it is the UAE bureau''s scale, and a second country would need a second scale. Low urgency, listed for completeness.'),

('DATABASE','public.v_lead_recovery','COALESCE(s.sla_first_response_minutes,5), COALESCE(s.silence_hours,12), COALESCE(s.stale_silence_hours,72), COALESCE(s.engagement_window_days,14)','5 min / 12 h / 72 h / 14 d','OPERATIONAL','MESSAGING','LEAD_RESPONSE_SLA',false,false,
 'Internal SLA thresholds. Listed because the 5-minute figure is the one PRODUCT.md warns about being confused with the unsourced "10-second response doubles ad ROI" claim — they are unrelated, and the Policy Engine now holds the latter as UNKNOWN precisely so the two cannot be merged by accident.'),

('DATABASE','public.v_needs_attention / public.v_team_performance','response_time_minutes > 5 ... ''breaches the 5-minute rule''','5 minutes','OPERATIONAL','MESSAGING','LEAD_RESPONSE_SLA',false,false,
 'The same 5-minute threshold, written as a literal in two views rather than read from lead_recovery_settings. v_lead_recovery_coverage already asserts the two agree; that assertion is a string match on the view definition, so it detects drift but does not prevent it.'),

('DATABASE','public.v_deal_rescue / public.lead_recovery_propose()','COALESCE(s.stalled_days,7) ... coalesce(s.reproposal_cooldown_days,7)','7 days','OPERATIONAL','COMPLIANCE','ACTION_COOLDOWN_DAYS',false,false,
 'Cooldown and stall thresholds. Note inventory_action_policy.reproposal_cooldown_days DEFAULTs to 14 for the same idea — two defaults, two numbers, one concept.'),

-- ── DASHBOARD ────────────────────────────────────────────────────────────
('DASHBOARD','apps/executive-dashboard/lib/unit-form.js:47','VAT_RATE: 0.05,','0.05 (i.e. 5%)','JURISDICTION','TAX','VAT_STANDARD_RATE',false,true,
 'The browser''s second copy of the VAT rate, and it is stored as a RATIO (0.05) while the database stores the same rule as a multiplication by 0.05 and the Policy Engine stores it as a PERCENT (5). Three renderings of one rule is exactly how a factor-of-100 error gets shipped. The file''s own comment already flags it as un-sourced and names the Policy Engine as where it belongs.'),

('DASHBOARD','apps/executive-dashboard/lib/unit-form.js:48','COMMISSION_RATE: 0.05,','0.05 (i.e. 5%)','COMMERCIAL','FINANCE','SALES_COMMISSION_PCT_OF_NET_MARGIN',false,false,
 'The browser''s copy of the commission rate, mirroring the database literal. Printed into a sentence at unit-form.js:545 and finance.js:3194.'),

('DASHBOARD','apps/executive-dashboard/lib/unit-form.js:49','WARN_DAYS: 75,','75 days','COMMERCIAL','COMPLIANCE','INVENTORY_AGING_BANDS',false,false,
 'DISAGREES WITH THE DATABASE, which uses 90 for the same band. The file says so in its own comment and leaves it deliberately: screens/competitors.js and screens/finance.js call deriveUnit() with no settings and have banded at 75 for weeks. This is a live one-figure-two-derivations violation waiting for the Policy Engine to resolve it.'),

('DASHBOARD','apps/executive-dashboard/screens/finance.js:291','const MIN_DOWN_PAYMENT_PCT_CBUAE = 20;','20%','JURISDICTION','FINANCE','MIN_DOWN_PAYMENT_PCT',true,true,
 'Named for a regulator nobody in this project has read. Printed into an explanatory sentence on the Finance Desk (finance.js:1107-1109) that attributes it to "the CBUAE 29/2011 legal floor".'),

('DASHBOARD','apps/executive-dashboard/screens/finance.js:292','const MAX_LTV_PCT_CBUAE = 100 - MIN_DOWN_PAYMENT_PCT_CBUAE;','80%','JURISDICTION','FINANCE','MAX_LTV_PCT',true,true,
 'Derived arithmetically from the constant above rather than independently sourced, and printed as "the 80% CBUAE ceiling" at finance.js:1479 and in the bank-panel tooltip at finance.js:2456.'),

('DASHBOARD','apps/executive-dashboard/screens/finance.js:303','const ASSUMED_DOWN_PAYMENT_PCT_USED = 30;','30%','COMMERCIAL','FINANCE','ASSUMED_DOWN_PAYMENT_PCT_USED',true,false,
 'A LENDER APPETITE assumption, not a law — the file is careful about the distinction and says the two are ten points of vehicle value apart. Deliberately NOT seeded: it is a claim about what UAE banks want, sourced to nothing, and seeding it would give a market assumption the same shelf as a regulation.'),

('DASHBOARD','apps/executive-dashboard/screens/finance.js:308','const MAX_TENURE_MONTHS_CBUAE = 60;','60 months','JURISDICTION','FINANCE','MAX_TENURE_MONTHS',true,true,
 'Third copy of the tenure rule, after the DDL constraint and the workflow disclaimer.'),

('DASHBOARD','apps/executive-dashboard/screens/finance.js:255','const MIN_VEHICLE_VALUE = 5000;','AED 5,000','COMMERCIAL','FINANCE','MIN_TRADE_IN_VALUE_AED',false,false,
 'Mirrors MIN_VEHICLE_VALUE_AED in the Finance Calc workflow. A currency threshold duplicated across the browser and the workflow, with no shared source — if one moves, quotes and validation disagree silently.'),

-- ── N8N (read from the repo, NOT from the box) ───────────────────────────
('N8N_WORKFLOW','n8n-workflows/finance_calc_auto_loan_equity_credit_score.json — node "Calculate Equity & Tier"','const DISCLAIMER = ''... Min 20% down payment, max 60 months (UAE Central Bank rules).''','20% / 60 months, attributed to the UAE Central Bank','JURISDICTION','FINANCE','MAX_TENURE_MONTHS',true,true,
 'THE MOST URGENT ROW IN THIS TABLE. This is a regulatory claim, naming a regulator, sent to real customers on WhatsApp, resting on two constants nobody has checked against the instrument. Everything else here is a number; this is a sentence asserting the law. It should be the first thing verified or withdrawn.'),

('N8N_WORKFLOW','n8n-workflows/finance_calc_auto_loan_equity_credit_score.json — node "Calculate Equity & Tier"','const BANDS = [{min:746,aprLow:5.3,aprHigh:6.7,...},{711,...},{651,...},{541,8.2,9.65,...}]','AECB cut-offs 746/711/651/541; APR 5.3%-9.65%; flat 2.50%-4.90%','COMMERCIAL','FINANCE','INDICATIVE_APR_BANDS',true,false,
 'An indicative rate table read out to customers. Its own comment does the right thing — it names ADCB''s published bands and Emirates NBD''s 9.00% reducing / 9.65% APR ceiling as where the numbers came from, which is more provenance than anything else in this survey has. That provenance lives in a code comment where nothing can check it or date it. It is the single best candidate for a genuinely VERIFIED policy row, one per band, because a real source already exists — somebody just has to cite and date it. NOT seeded: the source is a lender''s published rate card, and transcribing it from a comment would launder a comment into a citation.'),

('N8N_WORKFLOW','n8n-workflows/finance_calc_auto_loan_equity_credit_score.json — node "Calculate Equity & Tier"','''Without salary transfer add roughly 1.4 percentage points.'' / ''~1.87x the flat rate over 60 months''','+1.4 pp; 1.87x','COMMERCIAL','FINANCE','FLAT_TO_REDUCING_MULTIPLIER',true,false,
 'Two more customer-facing figures with no source. The 1.87 multiplier is arithmetic that depends on the 60-month tenure, so it silently becomes wrong if the tenure rule changes — a dependency no reader of either constant can see.'),

('N8N_WORKFLOW','n8n-workflows/backup/dynamic_pricing.json — LLM system prompt','''Days in stock (holding cost = AED 50/day)'' and ''Gross margin preservation (minimum 8% margin)''','AED 50/day; 8%','COMMERCIAL','COMPLIANCE','HOLDING_COST_PER_DAY_AED',false,false,
 'THE AED 50/DAY IS STILL HERE. It was removed from lib/unit-form.js and from recompute_inventory_derived() on 2 Sep 2026 as the largest fabrication in the product — but it survives inside an LLM prompt, where no grep for a numeric constant and no database audit would find it, feeding a model that recommends price changes. A constant inside a prompt string is the worst hiding place for one. This is a backup/ copy in the repo; whether the published workflow on the box still carries it was NOT checked, because the box was not touched.')

on conflict (layer, location, snippet) do nothing;

create or replace view public.v_policy_unmigrated_constant
with (security_invoker = true) as
select
  u.layer,
  u.kind,
  u.location,
  u.snippet,
  u.current_value,
  u.reaches_a_customer,
  u.proposed_rule_type,
  u.proposed_rule_name,
  u.seeded_as_rule,
  -- Does a rule of that name exist yet, and can it actually be relied on?
  exists (select 1 from public.policy_rule r
           where r.rule_name = u.proposed_rule_name)                       as rule_row_exists,
  exists (select 1 from public.v_policy_authoritative a
           where a.rule_name = u.proposed_rule_name)                       as rule_is_authoritative,
  case
    when u.proposed_rule_name is null then 'NO_TARGET_RULE'
    when exists (select 1 from public.v_policy_authoritative a
                  where a.rule_name = u.proposed_rule_name) then 'READY_TO_MIGRATE'
    when exists (select 1 from public.policy_rule r
                  where r.rule_name = u.proposed_rule_name) then 'BLOCKED_ON_VERIFICATION'
    else 'NOT_YET_RECORDED'
  end                                                                       as migration_state,
  u.note,
  u.surveyed_on
from public.policy_unmigrated_constant u
order by u.reaches_a_customer desc, u.layer, u.location;

comment on view public.v_policy_unmigrated_constant is
  'The migration backlog with each item''s state. READY_TO_MIGRATE means an '
  'authoritative rule now exists and the code can be repointed at it. '
  'BLOCKED_ON_VERIFICATION means the rule is recorded but nobody has verified '
  'it, so repointing the code would replace a silent wrong number with a loud '
  'refusal — which is progress, but must be a deliberate choice. Customer-'
  'facing items sort first.';

alter table public.policy_unmigrated_constant enable row level security;

drop policy if exists policy_unmigrated_constant_authenticated_read on public.policy_unmigrated_constant;
create policy policy_unmigrated_constant_authenticated_read on public.policy_unmigrated_constant
  for select to authenticated using (true);
drop policy if exists policy_unmigrated_constant_service_role_all on public.policy_unmigrated_constant;
create policy policy_unmigrated_constant_service_role_all on public.policy_unmigrated_constant
  for all to service_role using (true) with check (true);
drop policy if exists policy_unmigrated_constant_deny_anon on public.policy_unmigrated_constant;
create policy policy_unmigrated_constant_deny_anon on public.policy_unmigrated_constant
  as restrictive for all to anon using (false) with check (false);

revoke all on public.policy_unmigrated_constant   from anon, authenticated, public;
revoke all on public.v_policy_unmigrated_constant from anon, authenticated, public;
grant select on public.policy_unmigrated_constant   to authenticated, service_role;
grant select on public.v_policy_unmigrated_constant to authenticated, service_role;
grant insert, update, delete on public.policy_unmigrated_constant to service_role;
