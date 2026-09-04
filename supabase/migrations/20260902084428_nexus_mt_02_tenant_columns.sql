-- NEXUS OS multi-tenancy, step 2 of 6: tenant_id on every tenant-owned table.
-- NULLABLE, no default, no NOT NULL. Nothing reads it yet. Backfill is step 3.
-- Largest table here is audit_log at 589 rows, so every lock is milliseconds.
set local lock_timeout = '5s';

do $mig$
declare
  t text;
  tenant_tables text[] := array[
    'leads','communication_logs','whatsapp_contacts','inventory',
    'purchase_history','finance_quotes','kyc_documents','customer_360_profiles',
    'competitors','rag_documents','audit_log','processed_messages',
    'daily_metrics','users','deals_embeddings'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('alter table public.%I add column if not exists tenant_id uuid', t);
    -- RESTRICT, not CASCADE: deleting a dealership must be a deliberate,
    -- ordered act, never a silent cascade through customer records.
    if not exists (select 1 from pg_constraint
                    where conname = format('%s_tenant_id_fkey', t)
                      and conrelid = format('public.%I', t)::regclass) then
      execute format(
        'alter table public.%I add constraint %I foreign key (tenant_id) '
        'references public.tenants(id) on delete restrict',
        t, format('%s_tenant_id_fkey', t));
    end if;
    execute format('create index if not exists %I on public.%I (tenant_id)',
                   format('%s_tenant_id_idx', t), t);
  end loop;
end
$mig$;

comment on column public.leads.tenant_id is
  'Owning dealership. Nullable by design: a NULL row is invisible to every '
  'signed-in user (RLS) but still writable by service_role, so a tenant-unaware '
  'insert path fails visibly rather than leaking across dealerships.';