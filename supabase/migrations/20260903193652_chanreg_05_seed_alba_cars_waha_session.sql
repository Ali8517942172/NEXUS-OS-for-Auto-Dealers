-- The one real row. The identifier was ESTABLISHED, not guessed, from four
-- independent places — three in this repository, one a live measurement
-- recorded in it:
--
--   1. n8n-workflows/whatsapp_bdc_ai_agent.json, node "Send Reply via WAHA HTTP
--      API": the outbound body hardcodes  session: 'default'.  Every reply this
--      dealership sends goes out on that session.
--   2. n8n-workflows/nexus_infra_health_probe.json:32 polls
--      http://waha:3000/api/sessions/default  as the health check for the live
--      WhatsApp channel.
--   3. docker-compose.single.yml, the waha_sessions volume comment, quotes the
--      production failure verbatim: 'Session "default" does not exist'.
--   4. apps/executive-dashboard/J1_PRODUCTION_READINESS_REPORT.md, probe C run
--      live on 3 Sep 2026 against the PUBLISHED workflow: session `default`
--      resolved to tenant_id fff6a2b5-cfd5-4460-8383-875bc5826de0 with
--      tenant_source `waha_session`. That uuid is ALBA CARS in public.tenants.
--
-- The tenant is looked up by slug rather than by that literal uuid, so this
-- migration carries no hardcoded generated id.
--
-- credential_ref is 'env:WAHA_API_KEY' — a NAME. docker-compose.single.yml
-- passes WAHA_API_KEY into both the waha and n8n containers, and the workflow's
-- WAHA nodes send it as the X-Api-Key header via {{ $env.WAHA_API_KEY }}. The
-- value itself is not in this repository, is not in this database, and must
-- never be put in this column.
--
-- status is 'active', not 'pending', because this row records what is TRUE
-- TODAY. The binding must already be correct before the workflow is switched
-- over; a 'pending' row would take ALBA CARS offline at the moment of cutover.

do $seed$
declare v_tenant uuid;
begin
  select id into v_tenant from public.tenants where slug = 'alba-cars';

  if v_tenant is null then
    raise exception
      'chanreg_05: no tenant with slug alba-cars. Refusing to guess a tenant; '
      'nothing seeded.';
  end if;

  insert into public.channel_registry
    (tenant_id, channel_type, external_identifier, credential_ref, status)
  values
    (v_tenant, 'whatsapp_waha_session', 'default', 'env:WAHA_API_KEY', 'active')
  on conflict (channel_type, external_identifier) do nothing;
end
$seed$;
