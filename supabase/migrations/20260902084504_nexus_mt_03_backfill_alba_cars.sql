-- NEXUS OS multi-tenancy, step 3 of 6: the existing dealership becomes a tenant.
-- Every row on this database today belongs to ALBA CARS -- it is the only
-- dealership that has ever used it. Backfill is therefore a single assignment.
set local lock_timeout = '5s';

insert into public.tenants (slug, name, status, is_unattributed_default)
values ('alba-cars', 'ALBA CARS', 'active', true)
on conflict (slug) do nothing;

-- The one real user (auth.users 21460dfd-…, aliasgher892@gmail.com) becomes
-- owner of ALBA CARS, bridged to his staff row in public.users, which carries a
-- DIFFERENT id -- public.users is a staff directory, not an auth table.
insert into public.tenant_members (tenant_id, auth_user_id, role, staff_user_id)
select t.id, u.id, 'owner', su.id
  from public.tenants t
  join auth.users u on lower(u.email) = 'aliasgher892@gmail.com'
  left join public.users su on lower(su.email) = lower(u.email)
 where t.slug = 'alba-cars'
on conflict (tenant_id, auth_user_id) do nothing;

do $mig$
declare
  t text;
  v_tenant uuid;
  n bigint;
  tenant_tables text[] := array[
    'leads','communication_logs','whatsapp_contacts','inventory',
    'purchase_history','finance_quotes','kyc_documents','customer_360_profiles',
    'competitors','rag_documents','audit_log','processed_messages',
    'daily_metrics','users','deals_embeddings'
  ];
begin
  select id into strict v_tenant from public.tenants where slug = 'alba-cars';

  foreach t in array tenant_tables loop
    execute format('update public.%I set tenant_id = $1 where tenant_id is null', t)
      using v_tenant;
    get diagnostics n = row_count;
    raise notice 'backfilled % rows in %', n, t;

    -- Only now, with every existing row attributed, does the column acquire a
    -- default. Any INSERT that omits tenant_id -- the dashboard's "add vehicle",
    -- every n8n write -- lands in the caller's tenant, or in the
    -- unattributed-default tenant when the caller has none (service_role).
    execute format(
      'alter table public.%I alter column tenant_id set default public.nexus_default_tenant_id()', t);
  end loop;
end
$mig$;