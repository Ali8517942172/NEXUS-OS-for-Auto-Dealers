-- NX930 — Every dealer brings their own Meta app.
--
-- Applied to production dsvuoovivysszdoiorch 2026-09-14. Mirrors production.
-- Rationale and the Meta-policy reasoning behind it:
--   ops/ADR-004-how-a-dealer-gets-on-whatsapp-without-our-licence.md
--
-- THE DEFECT THIS CLOSES
-- The Cloud receiver verifies the X-Hub signature against a single
-- `$env.META_APP_SECRET` on the n8n box, and channel_registry can only point at
-- it (`credential_ref = 'env:META_APP_SECRET+META_WA_TOKEN'`). One box, one app
-- secret. The moment a second dealership arrives with its OWN Meta app -- the
-- only onboarding path that does not require NEXUS itself to hold a verified
-- business -- its webhook signature is computed with a different secret and the
-- receiver refuses it. NEXUS as built could serve exactly one dealership on
-- WhatsApp Cloud.
--
-- WHAT THIS DOES NOT DO
-- It does not put a plaintext secret anywhere. Values go in through
-- nexus_channel_secret_put() and live in Supabase Vault, encrypted at rest. A
-- fingerprint is stored alongside so anyone can ask "is the right secret
-- installed?" and get an answer without the secret being displayed. Nothing
-- here can print a secret except nexus_channel_secret_reveal(), which is
-- service_role-only and writes an audit row on every call.

create extension if not exists supabase_vault with schema vault;

create table if not exists public.channel_secret_kind (
  kind        text primary key,
  description text not null
);

insert into public.channel_secret_kind (kind, description) values
  ('meta_app_secret',
   'The dealership Meta app''s App Secret. Verifies the X-Hub-Signature-256 on every inbound webhook. Without the right one, that dealership''s messages are refused.'),
  ('meta_verify_token',
   'The token the dealership typed into Meta''s webhook Verify Token box. Checked on the GET handshake only.'),
  ('meta_system_user_token',
   'The dealership''s permanent System User access token. Sends outbound messages on their number.')
on conflict (kind) do nothing;

create table if not exists public.channel_secret (
  integration_id   uuid not null
                     references public.channel_registry(integration_id) on delete cascade,
  kind             text not null references public.channel_secret_kind(kind),
  vault_secret_id  uuid not null,
  fingerprint      text not null,
  installed_at     timestamptz not null default now(),
  rotated_at       timestamptz,
  installed_by     text,
  primary key (integration_id, kind)
);

comment on table public.channel_secret is
  'One dealership''s Meta credentials, encrypted in Vault. This table holds a '
  'pointer and a fingerprint -- never a value. NEXUS owns no WhatsApp asset; '
  'each dealership brings its own app, its own WABA and its own number.';

alter table public.channel_secret enable row level security;
revoke all on public.channel_secret from public, anon, authenticated;

drop policy if exists channel_secret_no_api_read on public.channel_secret;
create policy channel_secret_no_api_read on public.channel_secret
  for select to authenticated using (false);

-- Installing a secret. Called with the value the dealership copied out of their
-- own Meta dashboard. pgcrypto lives in `extensions`, so digest() is qualified
-- rather than widening this function's search_path (see NX931).
create or replace function public.nexus_channel_secret_put(
  p_integration_id uuid,
  p_kind           text,
  p_secret         text,
  p_installed_by   text default null
) returns table (kind text, fingerprint text, action text)
language plpgsql
security definer
set search_path to 'public', 'vault', 'pg_catalog', 'pg_temp'
as $fn$
declare
  v_existing uuid;
  v_new      uuid;
  v_fp       text;
  v_name     text;
begin
  if p_secret is null or length(trim(p_secret)) < 8 then
    raise exception using errcode='P0001',
      message='NX930 REFUSED: that is too short to be a Meta credential.';
  end if;

  v_fp := encode(extensions.digest(p_secret, 'sha256'), 'hex');
  v_name := 'nexus/' || p_integration_id::text || '/' || p_kind;

  select cs.vault_secret_id into v_existing
    from public.channel_secret cs
   where cs.integration_id = p_integration_id and cs.kind = p_kind;

  if v_existing is null then
    v_new := vault.create_secret(p_secret, v_name,
               'NEXUS channel credential. Owned by the dealership, not by NEXUS.');
    insert into public.channel_secret
      (integration_id, kind, vault_secret_id, fingerprint, installed_by)
    values (p_integration_id, p_kind, v_new, v_fp, p_installed_by);
    action := 'INSTALLED';
  else
    perform vault.update_secret(v_existing, p_secret);
    update public.channel_secret cs
       set fingerprint = v_fp, rotated_at = now(),
           installed_by = coalesce(p_installed_by, cs.installed_by)
     where cs.integration_id = p_integration_id and cs.kind = p_kind;
    action := 'ROTATED';
  end if;

  kind := p_kind;
  -- Eight characters is enough to tell two secrets apart and not enough to be
  -- one. The full hash is withheld too: a sha256 of a short token is
  -- brute-forceable.
  fingerprint := left(v_fp, 8);
  return next;
end;
$fn$;

-- Reading one back. The receiver calls this per webhook, keyed on the
-- phone_number_id Meta sent. Every call is audited, because a function that can
-- print an app secret should never be quiet about it.
create or replace function public.nexus_channel_secret_reveal(
  p_phone_number_id text,
  p_kind            text,
  p_reason          text default 'inbound webhook verification'
) returns table (tenant_id uuid, integration_id uuid, secret text)
language plpgsql
security definer
set search_path to 'public', 'vault', 'pg_catalog', 'pg_temp'
as $fn$
declare
  r record;
begin
  select cr.tenant_id, cr.integration_id, cs.vault_secret_id
    into r
    from public.channel_registry cr
    join public.channel_secret  cs on cs.integration_id = cr.integration_id
   where cr.channel_type = 'whatsapp_cloud_phone_number_id'
     and cr.external_identifier = p_phone_number_id
     and cr.status = 'active'
     and cs.kind = p_kind;

  if not found then
    -- Fail closed and say which half is missing. "Refused" with no reason is
    -- what cost a week on this channel already.
    raise exception using errcode='P0001',
      message = format(
        'NX930 NO_CREDENTIAL: no active whatsapp_cloud channel with '
        || 'phone_number_id %L holds a %L. Either the dealership is not '
        || 'registered or they have not installed this credential yet.',
        p_phone_number_id, p_kind);
  end if;

  insert into public.audit_log (workflow, status, summary, logged_at, tenant_id)
  values ('Channel Credential Vault', 'SUCCESS',
          format('Revealed %s for phone_number_id %s — %s',
                 p_kind, p_phone_number_id, coalesce(p_reason, 'no reason given')),
          now(), r.tenant_id);

  tenant_id := r.tenant_id;
  integration_id := r.integration_id;
  select vs.decrypted_secret into secret
    from vault.decrypted_secrets vs where vs.id = r.vault_secret_id;
  return next;
end;
$fn$;

-- Is this dealership ready? Answers without revealing anything.
create or replace function public.nexus_meta_onboarding_status()
returns table (tenant_id uuid, phone_number_id text, credential text,
               state text, detail text)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select cr.tenant_id,
         cr.external_identifier,
         k.kind,
         case when cs.integration_id is null then 'MISSING' else 'INSTALLED' end,
         case when cs.integration_id is null
              then 'Not installed. ' || k.description
              else 'Installed ' || to_char(coalesce(cs.rotated_at, cs.installed_at),
                                           'YYYY-MM-DD HH24:MI')
                   || ' · fingerprint ' || left(cs.fingerprint, 8)
         end
    from public.channel_registry cr
   cross join public.channel_secret_kind k
    left join public.channel_secret cs
           on cs.integration_id = cr.integration_id and cs.kind = k.kind
   where cr.channel_type = 'whatsapp_cloud_phone_number_id'
     and cr.status = 'active'
   order by cr.tenant_id, k.kind;
$fn$;

revoke all on function public.nexus_channel_secret_put(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.nexus_channel_secret_reveal(text, text, text)
  from public, anon, authenticated;
revoke all on function public.nexus_meta_onboarding_status()
  from public, anon, authenticated;

grant execute on function public.nexus_channel_secret_put(uuid, text, text, text) to service_role;
grant execute on function public.nexus_channel_secret_reveal(text, text, text)    to service_role;
grant execute on function public.nexus_meta_onboarding_status()                   to service_role;
