-- NEXUS OS multi-tenancy, step 6 of 6: onboarding a dealership is one call,
-- and the system can say out loud what still stands between it and a second
-- paying dealership.
set local lock_timeout = '5s';

-- ── Onboard a dealership ──────────────────────────────────────────────────
-- The person must already exist in auth.users (they sign up, or you invite them
-- through Supabase Auth) -- this function does not create logins, on purpose:
-- creating credentials is not something a database function should do quietly.
create or replace function public.nexus_onboard_dealership(
  p_slug        text,
  p_name        text,
  p_owner_email text,
  p_owner_role  text default 'owner'
) returns uuid
language plpgsql security definer set search_path to 'public' as $fn$
declare v_tenant uuid; v_auth uuid; v_staff uuid;
begin
  if p_slug is null or btrim(p_slug) = '' then
    raise exception 'nexus_onboard_dealership: slug is required';
  end if;

  insert into public.tenants (slug, name, status, is_unattributed_default)
  values (lower(btrim(p_slug)), coalesce(nullif(btrim(p_name),''), p_slug), 'active', false)
  on conflict (slug) do update set name = excluded.name
  returning id into v_tenant;

  select id into v_auth from auth.users where lower(email) = lower(btrim(p_owner_email));
  if v_auth is null then
    raise exception
      'nexus_onboard_dealership: no auth.users row for %. Create the login in Supabase Auth first, then re-run.',
      p_owner_email;
  end if;

  -- Staff directory row, so the rep appears on the team screen and can be
  -- assigned leads. users.email is UNIQUE GLOBALLY (see the readiness check),
  -- so a person cannot yet be staff at two dealerships.
  insert into public.users (name, email, role, status, tenant_id)
  values (split_part(p_owner_email,'@',1), lower(btrim(p_owner_email)), 'manager', 'online', v_tenant)
  on conflict (email) do update set tenant_id = coalesce(public.users.tenant_id, excluded.tenant_id)
  returning id into v_staff;

  insert into public.tenant_members (tenant_id, auth_user_id, role, staff_user_id)
  values (v_tenant, v_auth, coalesce(p_owner_role,'owner'), v_staff)
  on conflict (tenant_id, auth_user_id) do update
    set role = excluded.role, staff_user_id = coalesce(public.tenant_members.staff_user_id, excluded.staff_user_id);

  return v_tenant;
end;
$fn$;

revoke all on function public.nexus_onboard_dealership(text,text,text,text) from public, anon, authenticated;
grant execute on function public.nexus_onboard_dealership(text,text,text,text) to service_role;

comment on function public.nexus_onboard_dealership(text,text,text,text) is
  'Onboard a dealership. Run as postgres or service_role. The owner must already '
  'exist in auth.users. Read nexus_tenancy_readiness() before onboarding the '
  'SECOND dealership -- several shared keys and the n8n integration are still '
  'single-tenant and are listed there.';

-- ── What still blocks dealership number two ───────────────────────────────
-- Deliberately a query, not a document: a document goes stale, this does not.
create or replace function public.nexus_tenancy_readiness()
returns table(severity text, item text, detail text)
language sql stable security definer set search_path to 'public' as $fn$
  select 'BLOCKER', 'n8n writes are not tenant-aware',
         'Every n8n workflow writes as service_role, which has no auth.uid(). '
         'Those rows are attributed by the tenants.is_unattributed_default flag, '
         'currently held by: ' ||
         coalesce((select name from tenants where is_unattributed_default), '(nobody)') ||
         '. Until n8n sends tenant_id explicitly, a second dealership''s inbound '
         'traffic would be filed under that tenant.'
  where exists (select 1 from tenants where is_unattributed_default)
  union all
  select 'BLOCKER', 'leads.email is globally unique',
         'Index leads_email_key is UNIQUE(email) across all tenants and the Master '
         'Router upserts with on_conflict=email. Two dealerships sharing a customer '
         'email address would update each other''s lead row. Needs UNIQUE(tenant_id, '
         'email) here AND on_conflict=tenant_id,email in the router.'
  union all
  select 'BLOCKER', 'customer_360_profiles.customer_id is globally unique',
         'Same shape: on_conflict=customer_id in the Customer 360 workflow.'
  union all
  select 'WARN', 'shared keys that collide across tenants',
         'users.email, inventory.id, whatsapp_contacts.chat_id, deals_embeddings.deal_id '
         'and processed_messages.message_id are all unique globally rather than per '
         'tenant. None leaks data (RLS still hides the row); each is a write collision '
         'or a lost display name for the second dealership.'
  union all
  select 'WARN', 'tenant_id is nullable everywhere',
         (select count(*)::text from information_schema.columns
           where table_schema='public' and column_name='tenant_id' and is_nullable='YES') ||
         ' tables carry a nullable tenant_id with DEFAULT nexus_default_tenant_id(). '
         'A row that somehow lands with NULL is invisible to every signed-in user.'
  union all
  select 'INFO', 'rows with no tenant right now', x.tbl || ': ' || x.n::text
    from (
      select 'leads' tbl, count(*) n from leads where tenant_id is null
      union all select 'communication_logs', count(*) from communication_logs where tenant_id is null
      union all select 'audit_log', count(*) from audit_log where tenant_id is null
      union all select 'inventory', count(*) from inventory where tenant_id is null
      union all select 'whatsapp_contacts', count(*) from whatsapp_contacts where tenant_id is null
    ) x where x.n > 0;
$fn$;

grant execute on function public.nexus_tenancy_readiness() to authenticated, service_role;