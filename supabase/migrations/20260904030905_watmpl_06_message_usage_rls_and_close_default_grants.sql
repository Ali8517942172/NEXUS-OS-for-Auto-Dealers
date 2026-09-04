alter table public.whatsapp_message_usage enable row level security;

create policy whatsapp_message_usage_deny_anon
  on public.whatsapp_message_usage as restrictive for all to anon
  using (false) with check (false);

-- Signed-in staff may read their own dealership's messaging ledger. They may not
-- write it: a usage row is written by the send path and amended only by what the
-- provider reports.
create policy whatsapp_message_usage_authenticated_read
  on public.whatsapp_message_usage for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));

create policy whatsapp_message_usage_service_role_all
  on public.whatsapp_message_usage for all to service_role
  using (true) with check (true);

revoke all on table public.whatsapp_message_usage from anon, authenticated, public;
grant select on table public.whatsapp_message_usage to authenticated;
grant all    on table public.whatsapp_message_usage to service_role;

revoke all on function public.whatsapp_message_usage_touch() from anon, authenticated, public;
grant execute on function public.whatsapp_message_usage_touch() to service_role;