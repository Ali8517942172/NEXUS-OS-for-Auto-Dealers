-- Quarantined rows must not be counted in any revenue, recovery or attribution
-- figure. Measured on staging 5 Sep 2026 BEFORE this migration, with three rows
-- (a lead, an AED 999,999 purchase_history row and an audit row) filed under the
-- quarantine tenant by a service_role write that omitted tenant_id:
--
--   read as a dealership session (authenticated, Alpha's owner):  0 rows in all
--     six views -- RLS on the base tables already excluded them, and that is the
--     product surface, so no dealership could ever see them.
--   read as service_role (BYPASSRLS):  v_attribution_events 3, v_attribution_edges 4,
--     v_attribution_lead_chain 1, v_attribution_sale_chain 1, v_lead_recovery 1,
--     v_deal_rescue_candidates 2 -- including deal_value_aed.
--
-- So the exclusion held only because of RLS. CLAUDE.md is explicit that "returns
-- 0 rows" is evidence about RLS and never about anything else, and a vendor-side
-- report run as service_role that sums one of these views without grouping by
-- tenant would have added quarantined money to a real figure. This closes it in
-- the view definitions themselves, where it holds for every reader.
--
-- WHICH VIEWS is a policy decision and is written out here by name: every public
-- view carrying a tenant_id column, so no judgement about which view is "a
-- revenue view" has to be re-made correctly every time one is added. WHAT each
-- view currently is, is a fact and is read from the catalogue -- transcribing
-- 80 KB of view bodies by hand would introduce exactly the class of error this
-- guard exists to prevent. Each body is preserved verbatim and wrapped.
--
-- The guard is NULL-safe on purpose (NOT EXISTS, not NOT IN): policy_rule rows
-- carry a NULL tenant_id meaning platform scope, and those must still be shown.
--
-- For an authenticated caller the subquery reads public.tenants under RLS and
-- returns nothing, so the guard is a no-op and no dealership's numbers change.
-- Verified on staging: Alpha's row counts across all six views were identical
-- before and after.

do $$
declare
  v_name  text;
  v_body  text;
  v_names constant text[] := array[
    'v_action_center_health',
    'v_attribution_edges',
    'v_attribution_events',
    'v_attribution_lead_chain',
    'v_attribution_link_map',
    'v_attribution_sale_chain',
    'v_audit_unregistered_writers',
    'v_channel_send_health',
    'v_conversations',
    'v_customer_360',
    'v_customer_directory',
    'v_deal_rescue',
    'v_deal_rescue_candidates',
    'v_inventory_action_queue',
    'v_inventory_action_timeline',
    'v_inventory_profit_sentinel',
    'v_inventory_sales',
    'v_lead_messages',
    'v_lead_recovery',
    'v_lead_recovery_coverage',
    'v_lead_recovery_health',
    'v_lead_recovery_queue',
    'v_policy_authoritative',
    'v_policy_rule',
    'v_policy_rule_history',
    'v_whatsapp_conversation_window',
    'v_whatsapp_message_usage',
    'v_whatsapp_messaging_usage_monthly',
    'v_whatsapp_template_registry'
  ];
begin
  foreach v_name in array v_names loop
    if to_regclass('public.' || quote_ident(v_name)) is null then
      raise exception 'quarantine view guard: public.% does not exist', v_name;
    end if;

    if not exists (
      select 1 from pg_attribute a
       where a.attrelid = ('public.' || quote_ident(v_name))::regclass
         and a.attname = 'tenant_id' and a.attnum > 0 and not a.attisdropped
    ) then
      raise exception 'quarantine view guard: public.% has no tenant_id column', v_name;
    end if;

    v_body := pg_get_viewdef(('public.' || quote_ident(v_name))::regclass, true);

    -- Idempotent: a view already carrying the guard is left exactly as it is.
    if position('_q.is_quarantine' in v_body) > 0 then
      continue;
    end if;

    -- security_invoker is re-asserted on every one of these, because
    -- CREATE OR REPLACE VIEW silently drops it and has done so three times here.
    execute format(
      'create or replace view public.%I with (security_invoker = true) as '
      'select * from (%s) _v '
      'where not exists (select 1 from public.tenants _q '
                        'where _q.is_quarantine and _q.id = _v.tenant_id)',
      v_name, rtrim(btrim(v_body), ';'));
  end loop;
end $$;