-- ============================================================================
-- NEXUS OS — demo dealership teardown
--
--   Removes NORTHWIND MOTORS (DEMO — FICTIONAL DEALERSHIP) and every row that
--   carries its tenant id, plus its three sign-ins. Nothing else.
--
--   IT MUST NEVER RUN AGAINST PRODUCTION (dsvuoovivysszdoiorch). The guard is
--   identical to the seed's and refuses on two independent tests.
--
--   IDEMPOTENT. Run it twice and the second run deletes nothing and raises
--   nothing.
--
--   SCOPE. Every DELETE is keyed on
--   tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' — or, for the three
--   auth rows, on those three fixed user ids. It cannot reach Alpha Motors,
--   Bravo Autos, the quarantine tenant, the GATE-PROBE fixtures, or any
--   platform reference table. It never touches a shared catalogue: whatever
--   `deal_rescue_prerequisites`, `workflow_registry`, `policy_rule` and the
--   rest held before the demo, they hold after it.
--
--   PROOF. It prints a before/after count per table so a run can be shown to
--   have returned the database to where it started.
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 0 · THE GUARD — identical to seed_demo_tenant.sql. Do not relax it.
-- ────────────────────────────────────────────────────────────────────────────
do $guard$
begin
  if exists (select 1 from public.tenants
              where lower(slug) like '%alba%' or lower(name) like '%alba%') then
    raise exception using
      errcode = 'NX999',
      message = 'REFUSED: this database contains the Tenant A tenant, which identifies it as NEXUS PRODUCTION.',
      detail  = 'This script deletes rows. It is written for a synthetic demo tenant that exists only on '
             || 'staging, and it must never be pointed at the database that holds the one real dealership.',
      hint    = 'Run this against the staging project (wwspuxrbiyagnrnzgate) only.';
  end if;

  if not (exists (select 1 from public.tenants where slug = 'staging-alpha')
      and exists (select 1 from public.tenants where slug = 'staging-bravo')) then
    raise exception using
      errcode = 'NX999',
      message = 'REFUSED: this database does not look like NEXUS STAGING.',
      detail  = 'The staging fixture tenants staging-alpha and staging-bravo were not both found. This script '
             || 'only recognises staging by their presence, and it refuses rather than guess where it is.',
      hint    = 'If staging has been rebuilt without those fixtures, restore them first, or change this test '
             || 'deliberately — do not delete it.';
  end if;
end
$guard$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1 · BEFORE
-- ────────────────────────────────────────────────────────────────────────────
create temporary table _demo_before on commit drop as
select 'tenants' t, count(*) n from public.tenants where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
union all select 'users',                   count(*) from public.users                   where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
union all select 'tenant_members',          count(*) from public.tenant_members          where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
union all select 'inventory',               count(*) from public.inventory               where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
union all select 'leads',                   count(*) from public.leads                   where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
union all select 'communication_logs',      count(*) from public.communication_logs      where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
union all select 'whatsapp_contacts',       count(*) from public.whatsapp_contacts       where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
union all select 'competitors',             count(*) from public.competitors             where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
union all select 'purchase_history',        count(*) from public.purchase_history        where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
union all select 'inventory_actions',       count(*) from public.inventory_actions       where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
union all select 'inventory_action_events', count(*) from public.inventory_action_events where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
union all select 'audit_log',               count(*) from public.audit_log               where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
union all select 'auth.users',              count(*) from auth.users                     where id in ('dddddddd-a001-4ddd-8ddd-dddddddddddd','dddddddd-a002-4ddd-8ddd-dddddddddddd','dddddddd-a003-4ddd-8ddd-dddddddddddd');

-- ────────────────────────────────────────────────────────────────────────────
-- 2 · DELETE, in FK order
-- ────────────────────────────────────────────────────────────────────────────
delete from public.inventory_action_events        where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.inventory_actions              where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.lead_recovery_action_events    where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.lead_recovery_actions          where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.purchase_history               where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.deals_embeddings               where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.communication_logs             where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.whatsapp_contacts              where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.whatsapp_conversation_state    where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.whatsapp_customer_message_seen where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.whatsapp_delivery_events       where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.whatsapp_message_usage         where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.whatsapp_opt_in_event          where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.whatsapp_templates             where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.channel_send_directive         where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.channel_message_events         where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.channel_registry               where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.competitors                    where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.audit_log                      where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.kyc_documents                  where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.finance_quotes                 where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.customer_360_profiles          where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.daily_metrics                  where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.processed_messages             where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.rag_documents                  where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.policy_rule_event              where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.policy_rule                    where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.leads                          where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.inventory                      where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.inventory_profit_settings      where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.inventory_action_policy        where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.lead_recovery_settings         where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.deal_rescue_settings           where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.tenant_configuration           where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.tenant_capability              where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.tenant_members                 where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.users                          where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
delete from public.tenants                        where id        = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

-- The three sign-ins. auth.identities cascades from auth.users.
delete from auth.identities where user_id in ('dddddddd-a001-4ddd-8ddd-dddddddddddd',
                                              'dddddddd-a002-4ddd-8ddd-dddddddddddd',
                                              'dddddddd-a003-4ddd-8ddd-dddddddddddd');
delete from auth.users      where id      in ('dddddddd-a001-4ddd-8ddd-dddddddddddd',
                                              'dddddddd-a002-4ddd-8ddd-dddddddddddd',
                                              'dddddddd-a003-4ddd-8ddd-dddddddddddd');

-- ────────────────────────────────────────────────────────────────────────────
-- 3 · PROOF — before, after, and the other dealerships left alone
-- ────────────────────────────────────────────────────────────────────────────
select b.t as table_name, b.n as rows_before, a.n as rows_after
  from _demo_before b
  join (
    select 'tenants' t, count(*) n from public.tenants where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    union all select 'users',                   count(*) from public.users                   where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    union all select 'tenant_members',          count(*) from public.tenant_members          where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    union all select 'inventory',               count(*) from public.inventory               where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    union all select 'leads',                   count(*) from public.leads                   where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    union all select 'communication_logs',      count(*) from public.communication_logs      where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    union all select 'whatsapp_contacts',       count(*) from public.whatsapp_contacts       where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    union all select 'competitors',             count(*) from public.competitors             where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    union all select 'purchase_history',        count(*) from public.purchase_history        where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    union all select 'inventory_actions',       count(*) from public.inventory_actions       where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    union all select 'inventory_action_events', count(*) from public.inventory_action_events where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    union all select 'audit_log',               count(*) from public.audit_log               where tenant_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    union all select 'auth.users',              count(*) from auth.users                     where id in ('dddddddd-a001-4ddd-8ddd-dddddddddddd','dddddddd-a002-4ddd-8ddd-dddddddddddd','dddddddd-a003-4ddd-8ddd-dddddddddddd')
  ) a on a.t = b.t
 order by b.t;

commit;
