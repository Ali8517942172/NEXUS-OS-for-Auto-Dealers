-- TEMPORARY PROBE TABLE -- dropped in mt_keys_probe_drop_temporary in this same wave.
-- Purpose: establish, by observation rather than assumption, what conflict target
-- PostgREST emits for `Prefer: resolution=merge-duplicates` with NO on_conflict
-- parameter when the table's PRIMARY KEY is composite and one of its columns
-- (tenant_id) is absent from the request body and supplied by a DEFAULT.
-- This is the exact shape whatsapp_contacts and processed_messages will have,
-- and their live upserts depend on the answer.
create table public.mt_keys_probe (
  tenant_id uuid not null default public.nexus_default_tenant_id(),
  k text not null,
  v text,
  primary key (tenant_id, k)
);
alter table public.mt_keys_probe enable row level security;
create policy mt_keys_probe_anon_all on public.mt_keys_probe
  for all to anon using (true) with check (true);
grant select, insert, update on public.mt_keys_probe to anon;
