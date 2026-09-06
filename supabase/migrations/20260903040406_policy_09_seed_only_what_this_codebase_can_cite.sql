-- ===========================================================================
-- POLICY ENGINE — 09 · the seed, and the discipline it is under
--
-- BUSINESS RULE
-- A model may never invent a policy value. So this migration seeds ONLY values
-- that already exist somewhere in this system, and records their provenance as
-- what it actually is — "a constant somebody typed, at this file and this
-- line" — never as the regulator that constant was guessing at.
--
-- WHAT IS DELIBERATELY NOT DONE HERE
-- Nobody looked up the real UAE VAT rate, the real CBUAE down-payment floor or
-- the real maximum tenure and entered them as VERIFIED. That would be the
-- precise failure this table exists to prevent: a value with the appearance of
-- provenance and none of the substance. Four of these constants CARRY the word
-- CBUAE in their own variable names; that assertion is recorded in `notes` as
-- an unchecked assertion, and the regulator's name does NOT appear in
-- source_name.
--
-- Every row below lands DRAFT, and either NOT_VERIFIED (a value the code
-- already obeys, unchecked) or UNKNOWN (a claim registered with no value at
-- all). policy_authority() therefore labels all seven non-authoritative, and
-- none of them appears in v_policy_authoritative. policy_numeric() will REFUSE
-- for every one of them today. That is the correct behaviour, not a gap.
--
-- SCOPE. All seven are tenant_id NULL — they are jurisdiction claims, not one
-- dealership's commercial terms, so they are readable by every tenant and
-- contain no tenant data.
-- ===========================================================================

insert into public.policy_rule (
  tenant_id, jurisdiction, rule_type, rule_name,
  value_numeric, value_text, unit, value_kind,
  source_name, source_url, source_document,
  effective_from, effective_to,
  verification_date, verified_by, confidence,
  status, verification_status, notes,
  version, added_by
) values

-- ── 1 · the VAT literal, in two places, agreeing by luck ─────────────────
(null, 'AE', 'TAX', 'VAT_STANDARD_RATE',
 5, null, 'PCT', 'NUMERIC',
 'A constant in this codebase — NOT a tax authority',
 null,
 'public.recompute_inventory_derived(): round(b.price * 0.05) as vat_amount  ·  '
 'apps/executive-dashboard/lib/unit-form.js:47: VAT_RATE: 0.05  ·  '
 'both re-read against the live catalogue and the repo on 2026-09-03',
 null, null, null, null, 'UNKNOWN',
 'DRAFT', 'NOT_VERIFIED',
 'This is the rate the system already applies, recorded so that it stops being invisible. It is '
 'probably right for the UAE today and that is not the same as being sourced: there is no '
 'instrument, no effective date and no owner behind it. Two independent copies exist (a Postgres '
 'function and a browser module) and they agree only because nobody has changed either. Before '
 'this can be VERIFIED somebody must cite the Federal Tax Authority instrument and its commencement '
 'date, and state whether the used-vehicle margin scheme changes the base it applies to — which '
 'neither copy considers at all.',
 1, 'NEXUS OS migration policy_09 (automated transcription of existing constants)'),

-- ── 2 · the down-payment floor ───────────────────────────────────────────
(null, 'AE', 'FINANCE', 'MIN_DOWN_PAYMENT_PCT',
 20, null, 'PCT', 'NUMERIC',
 'A constant in this codebase — NOT a central bank',
 null,
 'apps/executive-dashboard/screens/finance.js:291: const MIN_DOWN_PAYMENT_PCT_CBUAE = 20;',
 null, null, null, null, 'UNKNOWN',
 'DRAFT', 'NOT_VERIFIED',
 'The constant''s own NAME asserts CBUAE, and the comment beside it asserts CBUAE Regulation '
 '29/2011. That assertion has never been checked against the regulation by anyone in this project, '
 'so it is recorded here as an assertion and not as a source. It must not be repeated to a customer '
 'until somebody reads the instrument, cites the article, and dates it. Note also that the same '
 'file distinguishes this LEGAL FLOOR from a separate COMMERCIAL assumption of 30% for used cars '
 '(ASSUMED_DOWN_PAYMENT_PCT_USED, finance.js:303) — ten points of vehicle value apart, and the '
 'commercial one is not seeded here because it is a lender''s appetite, not a jurisdiction rule.',
 1, 'NEXUS OS migration policy_09 (automated transcription of existing constants)'),

-- ── 3 · the LTV ceiling, which is not independently sourced at all ───────
(null, 'AE', 'FINANCE', 'MAX_LTV_PCT',
 80, null, 'PCT', 'NUMERIC',
 'A constant in this codebase — NOT a central bank',
 null,
 'apps/executive-dashboard/screens/finance.js:292: const MAX_LTV_PCT_CBUAE = 100 - MIN_DOWN_PAYMENT_PCT_CBUAE;',
 null, null, null, null, 'UNKNOWN',
 'DRAFT', 'NOT_VERIFIED',
 'Weaker provenance than the row above, and the difference matters. This is not a second '
 'observation of a rule — it is ARITHMETIC on the first one (100 minus the down-payment floor). If '
 'MIN_DOWN_PAYMENT_PCT is wrong, this is wrong by exactly the same amount and gives no independent '
 'signal that anything is off. Verifying it means reading the same instrument for the LTV cap '
 'itself, not re-deriving it.',
 1, 'NEXUS OS migration policy_09 (automated transcription of existing constants)'),

-- ── 4 · the maximum tenure ───────────────────────────────────────────────
(null, 'AE', 'FINANCE', 'MAX_TENURE_MONTHS',
 60, null, 'MONTHS', 'NUMERIC',
 'A constant in this codebase — NOT a central bank',
 null,
 'apps/executive-dashboard/screens/finance.js:308: const MAX_TENURE_MONTHS_CBUAE = 60;  ·  '
 'also asserted as prose inside the customer-facing DISCLAIMER string in '
 'n8n-workflows/finance_calc_auto_loan_equity_credit_score.json, node "Calculate Equity & Tier"',
 null, null, null, null, 'UNKNOWN',
 'DRAFT', 'NOT_VERIFIED',
 'This is the most urgent of the four, because unlike the others it is already being SPOKEN TO '
 'CUSTOMERS: the Finance Calc workflow''s disclaimer text reads "Min 20% down payment, max 60 months '
 '(UAE Central Bank rules)" and that sentence goes out over WhatsApp. A regulatory claim is being '
 'made on the authority of a constant nobody has checked. Until this row is VERIFIED with a cited '
 'instrument, that sentence is unsupported.',
 1, 'NEXUS OS migration policy_09 (automated transcription of existing constants)'),

-- ── 5-7 · the three PRODUCT.md claims: registered as questions, no value ──
(null, 'AE', 'FINANCE', 'SHARE_OF_VEHICLES_FINANCED_PCT',
 null, null, 'PCT', 'NUMERIC',
 'PRODUCT.md — an unsourced research claim, recorded here as a question',
 null,
 'PRODUCT.md, "Rules that outrank features": "Three claims from earlier research are not to be '
 'encoded as fact until sourced: that ~80% of cars are financed ..."',
 null, null, null, null, 'UNKNOWN',
 'DRAFT', 'UNKNOWN',
 'NO VALUE IS STORED, and the ~80% figure from the original research is deliberately NOT written '
 'into value_numeric even as a placeholder — a placeholder is how an unsourced number becomes a '
 'sourced-looking one. This row exists so that a consumer looking for the figure finds an explicit '
 'UNKNOWN with a reason, rather than nothing at all and a temptation to guess. Verifying it needs a '
 'named, dated industry or regulator publication, and a definition of the denominator (new only? '
 'new and used? retail only?) — the original claim defined none.',
 1, 'NEXUS OS migration policy_09 (automated transcription of existing constants)'),

(null, 'GLOBAL', 'CAMPAIGN', 'TEN_SECOND_RESPONSE_AD_ROI_MULTIPLIER',
 null, null, 'MULTIPLIER', 'NUMERIC',
 'PRODUCT.md — an unsourced research claim, recorded here as a question',
 null,
 'PRODUCT.md, "Rules that outrank features": "... that a 10-second response doubles ad ROI ..."',
 null, null, null, null, 'UNKNOWN',
 'DRAFT', 'UNKNOWN',
 'NO VALUE IS STORED. Jurisdiction is GLOBAL because the claim is a marketing-performance assertion '
 'rather than a legal one, but it is held here for the same reason: it would be used to justify a '
 'product claim to a buyer, and a product claim needs a source. Verifying it needs the study, its '
 'sample, its market and its date. Note that this system already has a SEPARATE and unrelated '
 '5-minute SLA threshold in lead_recovery_settings.sla_first_response_minutes and in '
 'v_needs_attention; the two must not be conflated.',
 1, 'NEXUS OS migration policy_09 (automated transcription of existing constants)'),

(null, 'UNSPECIFIED', 'IMPORT', 'VEHICLE_IMPORT_ELIGIBILITY',
 null, null, 'TEXT', 'TEXT',
 'PRODUCT.md — an unsourced research claim, recorded here as a question',
 null,
 'PRODUCT.md, "Rules that outrank features": "... and any country import rule."',
 null, null, null, null, 'UNKNOWN',
 'DRAFT', 'UNKNOWN',
 'NO VALUE IS STORED. The jurisdiction is the reserved token UNSPECIFIED because the original claim '
 'never named a country — which is itself the defect being recorded. An import rule is per-country '
 'and per-vehicle-age; a single global answer does not exist. When export compliance is built, this '
 'row must be replaced by one VERIFIED row PER destination jurisdiction, each citing that country''s '
 'own instrument. Until then the engine''s honest answer to "can this car be exported to X" is '
 'UNKNOWN, and policy_numeric() will refuse.',
 1, 'NEXUS OS migration policy_09 (automated transcription of existing constants)')

on conflict do nothing;

-- Record the origin of each seeded row in the append-only trail, so the fact
-- that these came from a migration rather than from a person is not lost.
insert into public.policy_rule_event (rule_id, tenant_id, event, actor, to_status, to_verification, detail)
select r.id, r.tenant_id, 'PROPOSED', r.added_by, r.status, r.verification_status,
       'Transcribed from an existing constant in this system by migration policy_09. Nobody has '
       'checked it against an external source, and this event is not evidence that anybody has.'
  from public.policy_rule r
 where r.added_by like 'NEXUS OS migration policy_09%'
   and not exists (select 1 from public.policy_rule_event e where e.rule_id = r.id);
