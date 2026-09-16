-- NX980 — A Page token had nowhere to live.
--
-- Meta's lead webhook carries six ids and no customer. The person exists only
-- behind GET /v<v>/<leadgen_id>, which needs a Page or System User token with
-- leads_retrieval. That token belongs to the DEALERSHIP -- they own the Meta
-- app, the Page and the trade licence (ADR-004) -- so there must be one per
-- dealer, resolved per delivery, or dealership #2 is served dealership #1's
-- credentials.
--
-- The WhatsApp store cannot hold it. nexus_channel_secret_reveal() keys on
-- channel_registry.channel_type, and channel_registry_channel_type_check
-- allows only 'whatsapp_waha_session' and 'whatsapp_cloud_phone_number_id'.
-- A Facebook Page id cannot be registered there. This is the sibling store,
-- keyed on the lead-ingest endpoint, which already carries the tenant.
--
-- IT ENABLES NOTHING. No endpoint status changes, and no Page identity row is
-- created here: the Page id is the dealership's, it is not in this repo, and a
-- migration that guesses one would map a delivery to the wrong showroom.
-- Registering the Page is a separate, stated step in
-- ops/n8n-meta-lead-ads/OWNER-RUNBOOK.md.

begin;

create extension if not exists supabase_vault with schema vault;

create table if not exists public.lead_ingest_secret_kind (
  kind        text primary key,
  description text not null
);
insert into public.lead_ingest_secret_kind (kind, description) values
  ('meta_page_access_token',
   'A System User or Page access token carrying leads_retrieval, issued inside the dealership''s own Meta app. Hop two of the Meta receiver fetches the lead with it. Without it a verified delivery records six ids and never finds the customer.'),
  ('google_ads_developer_token',
   'Reserved. Not used by the Google lead-form receiver, which authenticates on a shared secret in the body against an n8n environment variable named by lead_ingest_endpoint.secret_ref.')
on conflict (kind) do nothing;

alter table public.lead_ingest_secret_kind enable row level security;
revoke all on public.lead_ingest_secret_kind from public, anon, authenticated;
grant select on public.lead_ingest_secret_kind to service_role;
create policy lead_ingest_secret_kind_service on public.lead_ingest_secret_kind
  for all to service_role using (true) with check (true);
create policy lead_ingest_secret_kind_deny_end_users on public.lead_ingest_secret_kind
  as restrictive for all to anon, authenticated using (false) with check (false);

-- A pointer and a fingerprint. Never a value. The value lives in Vault and only
-- the reveal function below can print it.
create table if not exists public.lead_ingest_secret (
  endpoint_id     uuid not null references public.lead_ingest_endpoint(endpoint_id) on delete cascade,
  kind            text not null references public.lead_ingest_secret_kind(kind),
  vault_secret_id uuid not null,
  fingerprint     text not null,
  installed_at    timestamptz not null default now(),
  rotated_at      timestamptz,
  installed_by    text,
  primary key (endpoint_id, kind)
);
comment on table public.lead_ingest_secret is
  'Per-dealership credentials for lead-ingest sources. Holds a Vault pointer '
  'and a sha256 fingerprint so a token can be recognised without being read. '
  'The fingerprint is what an operator compares when asked "is the right token '
  'installed"; the answer never requires showing the token.';

alter table public.lead_ingest_secret enable row level security;
revoke all on public.lead_ingest_secret from public, anon, authenticated;
grant all on public.lead_ingest_secret to service_role;
create policy lead_ingest_secret_service on public.lead_ingest_secret
  for all to service_role using (true) with check (true);
create policy lead_ingest_secret_deny_end_users on public.lead_ingest_secret
  as restrictive for all to anon, authenticated using (false) with check (false);

create or replace function public.nexus_lead_ingest_secret_put(
  p_endpoint_id  uuid,
  p_kind         text,
  p_secret       text,
  p_installed_by text default null
) returns table (kind text, fingerprint text, action text)
language plpgsql
security definer
set search_path to 'public','vault','extensions','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare
  v_existing uuid;
  v_new      uuid;
  v_fp       text;
  v_name     text;
begin
  if p_secret is null or length(btrim(p_secret)) < 20 then
    raise exception using errcode = 'P0001',
      message = 'NX980 REFUSED: that is too short to be a Meta access token. Nothing was stored.';
  end if;
  if not exists (select 1 from public.lead_ingest_endpoint e where e.endpoint_id = p_endpoint_id) then
    raise exception using errcode = 'P0001',
      message = 'NX980 REFUSED: no lead-ingest endpoint with that id, so this token belongs to nobody.';
  end if;

  v_fp   := encode(extensions.digest(p_secret, 'sha256'), 'hex');
  v_name := 'nexus/lead-ingest/' || p_endpoint_id::text || '/' || p_kind;

  select s.vault_secret_id into v_existing
    from public.lead_ingest_secret s
   where s.endpoint_id = p_endpoint_id and s.kind = p_kind;

  if v_existing is null then
    v_new := vault.create_secret(p_secret, v_name,
      'NEXUS lead ingest credential. Owned by the dealership, not by NEXUS.');
    insert into public.lead_ingest_secret
      (endpoint_id, kind, vault_secret_id, fingerprint, installed_by)
    values (p_endpoint_id, p_kind, v_new, v_fp, p_installed_by);
    action := 'INSTALLED';
  else
    perform vault.update_secret(v_existing, p_secret);
    update public.lead_ingest_secret s
       set fingerprint  = v_fp,
           rotated_at   = now(),
           installed_by = coalesce(p_installed_by, s.installed_by)
     where s.endpoint_id = p_endpoint_id and s.kind = p_kind;
    action := 'ROTATED';
  end if;

  -- Eight characters. Enough to tell two tokens apart, useless for anything else.
  kind := p_kind;
  fingerprint := left(v_fp, 8);
  return next;
end
$fn$;

-- Resolves through the SAME registered identity the receiver routes on, and
-- through nothing else. A disabled identity, a disabled endpoint or a
-- suspended dealership raises -- it never falls back to a default, because a
-- default here means one dealership's token fetching another's customer.
create or replace function public.nexus_lead_ingest_secret_reveal(
  p_provider      text,
  p_identity_kind text,
  p_identity_value text,
  p_kind          text,
  p_reason        text default 'graph leadgen hydration'
) returns table (tenant_id uuid, endpoint_id uuid, source_key text, secret text)
language plpgsql
security definer
set search_path to 'public','vault','extensions','pg_catalog','pg_temp'
as $fn$
#variable_conflict use_column
declare r record;
begin
  select e.tenant_id, e.endpoint_id, e.source_key, s.vault_secret_id
    into r
    from public.lead_ingest_provider_identity i
    join public.lead_ingest_endpoint e
      on e.endpoint_id = i.endpoint_id and e.source_key = i.source_key
    join public.tenants t
      on t.id = e.tenant_id and t.status = 'active'
    join public.lead_ingest_secret s
      on s.endpoint_id = e.endpoint_id and s.kind = p_kind
   where i.provider       = lower(btrim(coalesce(p_provider, '')))
     and i.identity_kind  = lower(btrim(coalesce(p_identity_kind, '')))
     and i.identity_value = btrim(coalesce(p_identity_value, ''))
     and i.status = 'active'
     and e.status = 'active';

  if not found then
    raise exception using errcode = 'P0001', message = format(
      'NX980 NO_CREDENTIAL: no active registered %L identity %L on an active endpoint holds a %L. '
      'Either the Page is not registered, the endpoint is still disabled, the dealership is not active, '
      'or the token has not been installed. Refusing rather than reaching for somebody else''s token.',
      p_identity_kind, p_identity_value, p_kind);
  end if;

  -- Every reveal is written down. A credential read that leaves no trace is a
  -- credential nobody can audit.
  insert into public.audit_log (workflow, status, summary, logged_at, tenant_id)
  values ('Lead Ingest Credential Vault', 'SUCCESS',
    format('Revealed %s for %s %s — %s', p_kind, p_identity_kind, p_identity_value,
           coalesce(p_reason, 'no reason given')),
    now(), r.tenant_id);

  tenant_id   := r.tenant_id;
  endpoint_id := r.endpoint_id;
  source_key  := r.source_key;
  select vs.decrypted_secret into secret from vault.decrypted_secrets vs where vs.id = r.vault_secret_id;
  return next;
end
$fn$;

revoke all on function public.nexus_lead_ingest_secret_put(uuid,text,text,text)
  from public, anon, authenticated;
revoke all on function public.nexus_lead_ingest_secret_reveal(text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.nexus_lead_ingest_secret_put(uuid,text,text,text) to service_role;
grant execute on function public.nexus_lead_ingest_secret_reveal(text,text,text,text,text) to service_role;

commit;