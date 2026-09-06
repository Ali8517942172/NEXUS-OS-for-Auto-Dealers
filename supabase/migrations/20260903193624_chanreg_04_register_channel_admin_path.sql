-- The onboarding path for a channel, alongside nexus_onboard_dealership().
-- service_role only, so it runs from an operator console or a provisioning job —
-- never from the dashboard, never from a browser.
--
-- It refuses the one mistake that matters: re-pointing an identifier that is
-- already bound to a different dealership. An UPSERT that quietly updated
-- tenant_id would let a typo redirect a live dealership's inbound WhatsApp into
-- someone else's data, which is precisely the failure channel_registry exists
-- to make impossible. Rebinding requires deleting the old row deliberately.

create or replace function public.nexus_register_channel(
  p_tenant_slug         text,
  p_channel_type        text,
  p_external_identifier text,
  p_credential_ref      text default null,
  p_status              text default 'active'
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_tenant uuid;
  v_ident  text := lower(btrim(coalesce(p_external_identifier, '')));
  v_type   text := lower(btrim(coalesce(p_channel_type, '')));
  v_owner  uuid;
  v_id     uuid;
begin
  if v_ident = '' then
    raise exception 'nexus_register_channel: external_identifier is required and must be the '
                    'real session/number the channel receives on. Do not invent one.';
  end if;

  select id into v_tenant
    from public.tenants
   where slug = lower(btrim(coalesce(p_tenant_slug, '')));
  if v_tenant is null then
    raise exception 'nexus_register_channel: no tenant with slug %. Run nexus_onboard_dealership() first.',
                    p_tenant_slug;
  end if;

  select tenant_id into v_owner
    from public.channel_registry
   where channel_type = v_type and external_identifier = v_ident;

  if v_owner is not null and v_owner <> v_tenant then
    raise exception
      'nexus_register_channel: (%, %) is already bound to a different dealership. '
      'Re-pointing a live identifier is refused. Delete the existing row deliberately '
      'if that is really what is intended.', v_type, v_ident;
  end if;

  insert into public.channel_registry
    (tenant_id, channel_type, external_identifier, credential_ref, status)
  values
    (v_tenant, v_type, v_ident, nullif(btrim(coalesce(p_credential_ref,'')),''), coalesce(p_status,'active'))
  on conflict (channel_type, external_identifier) do update
     set credential_ref = excluded.credential_ref,
         status         = excluded.status
  returning integration_id into v_id;

  return v_id;
end;
$fn$;

comment on function public.nexus_register_channel(text, text, text, text, text) is
  'Bind an integration identity to a dealership, or change its status/credential_ref. '
  'service_role only. Refuses to re-point an identifier already bound to another '
  'dealership. Pass p_status => ''suspended'' to take a channel off the air without '
  'deleting the row. p_credential_ref must be a REFERENCE (env var name, n8n '
  'credential id, secret-manager path) — never a secret value.';

revoke all on function public.nexus_register_channel(text, text, text, text, text)
  from anon, authenticated, public;
grant execute on function public.nexus_register_channel(text, text, text, text, text)
  to service_role;
