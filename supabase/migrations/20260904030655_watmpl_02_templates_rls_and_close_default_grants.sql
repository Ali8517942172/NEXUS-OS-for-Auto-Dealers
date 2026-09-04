alter table public.whatsapp_templates enable row level security;

create policy whatsapp_templates_deny_anon
  on public.whatsapp_templates as restrictive for all to anon
  using (false) with check (false);

create policy whatsapp_templates_authenticated_read
  on public.whatsapp_templates for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));

create policy whatsapp_templates_service_role_all
  on public.whatsapp_templates for all to service_role
  using (true) with check (true);

revoke all on table public.whatsapp_templates from anon, authenticated, public;
grant select on table public.whatsapp_templates to authenticated;
grant all    on table public.whatsapp_templates to service_role;

revoke all on function public.whatsapp_template_variable_schema_ok(jsonb) from anon, authenticated, public;
revoke all on function public.whatsapp_templates_touch() from anon, authenticated, public;
grant execute on function public.whatsapp_template_variable_schema_ok(jsonb) to service_role;
grant execute on function public.whatsapp_templates_touch() to service_role;