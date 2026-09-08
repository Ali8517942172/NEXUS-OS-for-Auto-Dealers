-- The undercut alert ignored the match_quality it had already selected
-- =====================================================================
-- 8 September 2026. HELD — not applied to any project. See the decision below.
--
-- WHAT IS WRONG, measured on production `dsvuoovivysszdoiorch` today.
--
-- `v_needs_attention`'s `undercut` branch selects `c2.match_quality` into its
-- DISTINCT ON subquery and then never mentions it again. The predicate is the
-- whole rule:
--
--     WHERE c.price_diff_aed < 0
--
-- So the Needs Attention list currently publishes three price alerts:
--
--     weak       drivearabia.com / Lexus LX 600 2024        "AED 90,000 cheaper"
--     weak       toyota.ae      / Toyota Fortuner 2.7 VXR 2024
--     model_only icartea.com    / Mitsubishi Pajero GLS 2023
--
-- and the first of those is a row that `v_inventory_profit_sentinel` — the
-- product's own economic authority on the same table — describes as one where
-- "no price move is recommended because of it". Two surfaces, one fact, two
-- verdicts, and the one recommending a five-figure price cut is the one that
-- did not read the column.
--
-- THREE RULES EXIST IN THIS PRODUCT FOR ONE QUESTION. That is the real finding:
--
--   1. `v_inventory_profit_sentinel`  usable = `inventory_profit_settings
--                                      .accepted_market_match_quality`,
--                                      default array['exact','strong'].
--                                      PER TENANT. Configurable.
--   2. `screens/competitors.js`       concludes = exact_year, model_only, and
--                                      unrated. NOT weak. Hardcoded.
--   3. `v_needs_attention`            no rule at all.
--
-- This migration does not add a fourth. It makes (3) read (1), because (1) is
-- the only one of the three that a dealership can configure and the only one
-- that already treats the question as a per-tenant economic setting rather than
-- a constant. If ALBA decides `model_only` is good enough to act on, the answer
-- is one UPDATE on their settings row — not an edit to a view.
--
-- WHAT THIS CHANGES, and it is not small. ALBA's setting is `{exact,strong}`.
-- Production holds no `exact` or `strong` competitor rows at all — 9 null,
-- 4 `model_only`, 9 `weak`. So:
--
--     undercut alerts before: 3
--     undercut alerts after:  0     (measured, not predicted)
--
-- Three items leave the Needs Attention list. That is the correct outcome —
-- not one of them rests on a comparison this dealership's own setting accepts —
-- but it is a visible change to a screen a dealership looks at, which is why
-- this file is HELD rather than applied.
--
-- A SECOND DEFECT IN THE SAME BRANCH, fixed here because the branch is already
-- being rewritten. `DISTINCT ON (c2.competitor, c2.model)` omits `tenant_id`,
-- which is NOT NULL on `competitors`. Under RLS a dealership only ever sees its
-- own rows, so this is harmless today — but `service_role` bypasses RLS, and at
-- two dealerships one dealership's newer scrape of the same (competitor, model)
-- pair would suppress the other's. Adding `tenant_id` to the DISTINCT ON costs
-- nothing and removes a trap that only appears on the day a second dealership
-- is onboarded, which is the worst day to find it.
--
-- WHAT IS NOT CHANGED. Every other branch of this view is reproduced verbatim
-- from `pg_get_viewdef(..., true)` as read on production today. If any of them
-- differs from what you expect, the difference is upstream of this file.
--
-- `security_invoker = on` is set INSIDE the CREATE, and that is not a style
-- choice. The first attempt at this migration put it in a following
--
--     alter view public.v_needs_attention set (security_invoker = true);
--
-- and was REFUSED on staging:
--
--     42501: NEXUS SECURITY GATE: view(s) public.v_needs_attention in schema
--     public lack security_invoker
--
-- `nexus_require_security_invoker_views()` fires on `ddl_command_end` of the
-- CREATE, which is before the ALTER runs. The option has to be in the CREATE or
-- the deploy does not happen. Recorded here because the gate doing its job is
-- the only reason this file is correct, and the next person will reach for the
-- ALTER too.
--
-- PROVEN ON STAGING `wwspuxrbiyagnrnzgate`, 8 September 2026, applied and
-- measured — not predicted:
--
--     undercut alerts before          7
--     undercut alerts after           1
--     the one that survives           Toyota Land Cruiser VXR 2022 —
--                                     "Example Motors LLC (demo) is AED 7,000
--                                     cheaper", the single `strong` match on
--                                     that project
--     security_invoker after          on
--     every other branch              unchanged: lead_unassigned 1,
--                                     sla_breach 6, inventory_aging 5,
--                                     unanswered_chat 3
--
-- The surviving row is the positive control, and it is the half that matters:
-- this change does not silence the alert, it silences the alerts that were
-- never entitled to speak. Staging carries one `strong` row; production carries
-- none, which is why production goes to zero and staging does not.
--
-- BEFORE APPLYING, two things must be true and neither is settled here:
--   1. Ali decides whether `model_only` should count. Today it does not.
--   2. The screen's own hardcoded QUALITY table in `screens/competitors.js`
--      is reconciled with the same setting, or the two surfaces disagree again
--      the moment somebody changes the setting.

create or replace view public.v_needs_attention with (security_invoker = on) as
 select 'lead_unassigned'::text as kind, 'HOT'::text as severity, l.id::text as ref,
        l.name as title, 'HOT lead with no rep assigned'::text as detail,
        l.created_at as at, 'leads'::text as screen
   from leads l
  where upper(l.status) = 'HOT'::text and l.assigned_to_id is null
union all
 select 'sla_breach'::text, case when l.response_time_minutes > 60 then 'HOT'::text else 'WARM'::text end,
        l.id::text, l.name,
        ('Responded in '::text || l.response_time_minutes) || ' min — breaches the 5-minute rule'::text,
        l.created_at, 'leads'::text
   from leads l
  where l.response_time_minutes > 5 and l.created_at > (now() - '30 days'::interval)
union all
 select 'inventory_aging'::text, 'HOT'::text, i.id, i.model,
        (case when i.days_in_stock is null then 'Days in stock not on record'::text
              else i.days_in_stock || ' days in stock'::text end || ' · '::text) ||
        case when i.holding_cost_accrued is not null
                  then ('AED '::text || to_char(i.holding_cost_accrued, 'FM999,999'::text)) || ' holding cost'::text
             when s.holding_cost_per_day_aed is null
                  then 'holding cost NOT COMPUTABLE — this dealership has not recorded what a day of floor costs'::text
             else 'holding cost NOT COMPUTABLE — a daily rate is on record but no accrued figure has been computed for this unit'::text
        end,
        now(), 'inventory'::text
   from inventory i
   left join inventory_profit_settings s on s.tenant_id = i.tenant_id
  where i.aging_alert = 'CRITICAL'::text
union all
 -- THE CHANGED BRANCH.
 select 'undercut'::text, 'WARM'::text, c.id::text, c.model,
        ((c.competitor || ' is AED '::text) || to_char(abs(c.price_diff_aed), 'FM999,999'::text)) || ' cheaper'::text,
        c.scraped_at, 'competitors'::text
   from ( select distinct on (c2.tenant_id, c2.competitor, c2.model)
                 c2.id, c2.tenant_id, c2.competitor, c2.model, c2.price_diff_aed,
                 c2.scraped_at, c2.match_quality
            from competitors c2
           order by c2.tenant_id, c2.competitor, c2.model, c2.scraped_at desc ) c
   left join inventory_profit_settings ips on ips.tenant_id = c.tenant_id
  where c.price_diff_aed < 0
    -- The dealership's own setting decides what a usable comparison is. A row
    -- whose match was never rated (NULL) is not a rated match and never passes:
    -- unknown is not a verdict.
    and lower(coalesce(c.match_quality, '')) = any (
          select lower(q)
            from unnest(coalesce(ips.accepted_market_match_quality, array['exact','strong'])) q )
union all
 select 'workflow_failure'::text, 'HOT'::text, coalesce(r.name, f.workflow), coalesce(r.name, f.workflow),
        (((f.n || ' run'::text) || case when f.n = 1 then ''::text else 's'::text end)
          || ' that did not deliver in the last 24 h · '::text)
          || "left"(coalesce(f.latest, 'no detail recorded'::text), 140),
        f.last_at, 'automation'::text
   from ( select a.workflow, count(*) as n, max(a.logged_at) as last_at,
                 (array_agg(a.summary order by a.logged_at desc))[1] as latest
            from audit_log a
           where (nexus_outcome_class(a.workflow, a.status, a.summary) = any (array['FAILURE'::text,'PARTIAL'::text]))
             and a.logged_at > (now() - '24:00:00'::interval)
           group by a.workflow ) f
   left join nexus_workflow_catalogue() r(name, audit_name, audit_aliases, category, description, is_active, writes_audit_log)
          on f.workflow = r.name or f.workflow = r.audit_name or (f.workflow = any (r.audit_aliases))
union all
 select 'kyc_archive_gap'::text, 'HOT'::text, k.id::text,
        coalesce(k.lead_name, k.full_name, k.lead_email, 'KYC document'::text),
        'Document was never archived to Storage — retention cannot be proven'::text,
        k.created_at, 'compliance'::text
   from kyc_documents k
  where k.storage_path is null and k.purged_at is null and k.void_reason is null
    and k.created_at > '2026-08-17 16:01:48+00'::timestamptz
union all
 select 'unanswered_chat'::text, 'HOT'::text, v.chat_id, v.display_name,
        (('Waiting since '::text || to_char(v.last_msg_at, 'DD Mon HH24:MI'::text)) || ' · '::text)
          || "left"(coalesce(v.last_msg, ''::text), 90),
        v.last_msg_at, 'conversations'::text
   from v_conversations v
  where v.awaiting_msg_reply and v.last_msg_at > (now() - '7 days'::interval);
