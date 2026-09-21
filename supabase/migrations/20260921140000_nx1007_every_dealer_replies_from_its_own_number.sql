-- NX1007 — Every dealer replies from its own number.
--
-- WHY THIS MIGRATION EXISTS
-- Tasks F1-F3 give every outbound WhatsApp send node a channel to resolve
-- (ops/per-dealer-send/patched/*.json), reading channel_registry and preferring
-- whatsapp_cloud_phone_number_id over the legacy whatsapp_waha_session. That
-- only helps a dealership that HAS a Cloud channel registered. Today the only
-- path onto channel_registry is a manual SQL INSERT run by an operator — there
-- is no owner-facing way to add one. This migration is that path: an
-- authenticated RPC a dealer owner can call from the Channels screen, a token
-- store that reuses the Vault-backed secret table NX930 already built (nothing
-- new is invented for holding a Meta credential), and a service_role-only RPC
-- an n8n test-send workflow calls to flip PENDING_VERIFY to ACTIVE once a real
-- send has actually gone through Meta's API — never on the strength of the
-- owner's say-so alone.
--
-- WHAT THIS DOES NOT DO
-- It does not let a browser read a token back. nexus_channel_secret_put (NX930)
-- already enforces that: EXECUTE is service_role-only, and this migration's own
-- register RPC is the only authenticated-reachable caller of it, is SECURITY
-- DEFINER, and returns a FINGERPRINT ONLY — the same shape NX930 chose for its
-- own return value. It does not let one dealership steal another's
-- phone_number_id: the unique index from chanreg_01
-- (channel_type, external_identifier) is checked explicitly before any write,
-- and a collision with a DIFFERENT tenant is refused, not silently reassigned.
-- It does not mark a channel ACTIVE on registration. Registering only ever
-- produces PENDING_VERIFY (channel_registry.status = 'pending' — the enum this
-- table already has, from chanreg_01; no new status value is added). Only
-- nexus_channel_mark_active(), called by the test-send n8n workflow after a
-- real Graph API call succeeds, moves a channel to 'active'. A dealer who never
-- clicks "Send test message" stays PENDING_VERIFY forever, which is correct: an
-- unverified number claimed by a form is not a working send channel.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Two columns channel_registry did not need until an owner, not an
--    operator, could write a row: what to show them, and the WABA id Meta's
--    dashboard groups the number under. Neither is a secret.
-- ─────────────────────────────────────────────────────────────────────────
alter table public.channel_registry
  add column if not exists display_number text,
  add column if not exists waba_id        text;

alter table public.channel_registry
  drop constraint if exists channel_registry_display_number_shape;
alter table public.channel_registry
  add constraint channel_registry_display_number_shape
  check (display_number is null or length(btrim(display_number)) between 1 and 40);

alter table public.channel_registry
  drop constraint if exists channel_registry_waba_id_is_digits;
alter table public.channel_registry
  add constraint channel_registry_waba_id_is_digits
  check (waba_id is null or waba_id ~ '^[0-9]{1,32}$');

comment on column public.channel_registry.display_number is
  'The phone number as the dealership types it, e.g. "+971 4 xxx xxxx". Shown '
  'on the Channels screen only. Never used for routing — routing keys on '
  'external_identifier (the Meta phone_number_id), which this column is not.';
comment on column public.channel_registry.waba_id is
  'The WhatsApp Business Account id Meta groups this number under. Not a '
  'secret, not used to authenticate anything here — recorded so the owner can '
  'cross-check it against their own Meta Business Manager if a send is refused.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Register. Called by the dealer owner (or admin) from the Channels
--    screen's "Connect WhatsApp Cloud number" form. Produces exactly one
--    channel_registry row, status='pending', and stores the access token
--    through the existing Vault-backed store — never in this table, never in
--    a column a REST read could return.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.nexus_channel_register_cloud_number(
  p_display_number   text,
  p_phone_number_id  text,
  p_waba_id          text,
  p_access_token     text
) returns table (
  integration_id uuid,
  status         text,
  fingerprint    text
)
language plpgsql
security definer
set search_path to 'public', 'vault', 'pg_catalog', 'pg_temp'
as $fn$
declare
  v_tenant  uuid;
  v_n       integer;
  v_pnid    text := lower(btrim(coalesce(p_phone_number_id, '')));
  v_disp    text := nullif(btrim(coalesce(p_display_number, '')), '');
  v_waba    text := nullif(btrim(coalesce(p_waba_id, '')), '');
  v_existing_tenant uuid;
  v_row     public.channel_registry;
  v_secret  record;
begin
  -- WHO. Only an owner or admin of exactly one dealership may register a
  -- send channel for it — the same account-authority column (rbac_01) every
  -- other write in this product reads, not a second permission system.
  select count(*) into v_n from public.nexus_tenant_ids_for_roles(array['owner','admin']);
  if v_n = 0 then
    raise exception using errcode = 'NX1007',
      message = 'NX1007 REFUSED: you are not an owner or admin of any dealership. '
        || 'Connecting a WhatsApp Cloud number is an owner/admin decision.';
  end if;
  if v_n > 1 then
    raise exception using errcode = 'NX1007',
      message = 'NX1007 REFUSED: you are an owner/admin of more than one dealership. '
        || 'This form cannot choose one on your behalf.';
  end if;
  select t into v_tenant from public.nexus_tenant_ids_for_roles(array['owner','admin']) t;

  -- WHAT. Fail closed on shape before touching Vault at all.
  if v_pnid !~ '^[0-9]{5,20}$' then
    raise exception using errcode = 'NX1007',
      message = 'NX1007 REFUSED: phone_number_id must be the numeric Meta id from your '
        || 'WhatsApp Business API settings, not the phone number itself.';
  end if;
  if v_waba is not null and v_waba !~ '^[0-9]{1,32}$' then
    raise exception using errcode = 'NX1007',
      message = 'NX1007 REFUSED: WABA id must be numeric.';
  end if;

  -- Does this phone_number_id already belong to someone? The unique index on
  -- (channel_type, external_identifier) from chanreg_01 is the real lock;
  -- this check exists to give the caller a clear reason instead of a bare
  -- constraint-violation error, and to make the "belongs to another
  -- dealership" case an explicit refusal rather than an ON CONFLICT that
  -- could silently rebind it.
  select tenant_id into v_existing_tenant
    from public.channel_registry
   where channel_type = 'whatsapp_cloud_phone_number_id'
     and external_identifier = v_pnid;

  if v_existing_tenant is not null and v_existing_tenant <> v_tenant then
    raise exception using errcode = 'NX1007',
      message = 'NX1007 REFUSED: this phone_number_id is already registered to a '
        || 'different dealership. If you believe this is an error, contact support — '
        || 'this form will not reassign it.';
  end if;

  if v_existing_tenant is null then
    insert into public.channel_registry
      (tenant_id, channel_type, external_identifier, credential_ref, status,
       display_number, waba_id)
    values
      (v_tenant, 'whatsapp_cloud_phone_number_id', v_pnid,
       'vault:channel_secret', 'pending', v_disp, v_waba)
    returning * into v_row;
  else
    -- Re-registering (e.g. rotating the token, or re-verifying after a prior
    -- failed test). Re-entering pending is deliberate: a stale ACTIVE channel
    -- whose token may be wrong should not keep reading as verified.
    update public.channel_registry
       set status = 'pending',
           display_number = coalesce(v_disp, display_number),
           waba_id = coalesce(v_waba, waba_id)
     where integration_id = (select integration_id from public.channel_registry
                               where channel_type = 'whatsapp_cloud_phone_number_id'
                                 and external_identifier = v_pnid)
    returning * into v_row;
  end if;

  -- Store the token in Vault via the store NX930 already built. Never
  -- returned from here beyond its fingerprint.
  select * into v_secret
    from public.nexus_channel_secret_put(
      v_row.integration_id, 'meta_system_user_token', p_access_token,
      coalesce(nullif(btrim(coalesce(auth.jwt() ->> 'email', '')), ''), auth.uid()::text));

  insert into public.audit_log (workflow, status, summary, logged_at, tenant_id)
  values ('Channel Onboarding', 'SUCCESS',
          format('Owner registered WhatsApp Cloud number %s (phone_number_id %s) — status PENDING_VERIFY',
                 coalesce(v_disp, '(no display number given)'), v_pnid),
          now(), v_tenant);

  integration_id := v_row.integration_id;
  status := v_row.status;
  fingerprint := v_secret.fingerprint;
  return next;
end;
$fn$;

comment on function public.nexus_channel_register_cloud_number(text, text, text, text) is
  'Owner/admin-only. Registers (or re-registers) this dealership''s WhatsApp '
  'Cloud number, storing the access token in Vault via nexus_channel_secret_put '
  'and leaving channel_registry.status = ''pending'' (shown to the owner as '
  'PENDING_VERIFY) until nexus_channel_mark_active() confirms a real send. '
  'Never returns the token — fingerprint only.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Activate. service_role-only: called by the n8n "Channel Test Send"
--    webhook after a real Graph API call against this channel succeeds, and
--    ONLY after — never by the browser, never on registration.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.nexus_channel_mark_active(
  p_integration_id uuid,
  p_verified_by    text default null
) returns table (integration_id uuid, tenant_id uuid, status text)
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $fn$
declare
  v_row public.channel_registry;
begin
  select * into v_row from public.channel_registry cr where cr.integration_id = p_integration_id;
  if not found then
    raise exception using errcode = 'NX1007',
      message = format('NX1007 NO_SUCH_CHANNEL: integration_id %s has no channel_registry row.', p_integration_id);
  end if;
  if v_row.status <> 'pending' then
    raise exception using errcode = 'NX1007',
      message = format('NX1007 REFUSED: channel %s is %s, not pending. This RPC only promotes a pending '
        || 'channel that has just passed a real test send — it does not reactivate a suspended or revoked one.',
        p_integration_id, v_row.status);
  end if;

  update public.channel_registry
     set status = 'active'
   where integration_id = p_integration_id
  returning * into v_row;

  insert into public.audit_log (workflow, status, summary, logged_at, tenant_id)
  values ('Channel Onboarding', 'SUCCESS',
          format('WhatsApp Cloud number %s (phone_number_id %s) verified by a real test send — now ACTIVE. %s',
                 coalesce(v_row.display_number, '(no display number)'), v_row.external_identifier,
                 coalesce('Confirmed by ' || p_verified_by || '.', '')),
          now(), v_row.tenant_id);

  integration_id := v_row.integration_id;
  tenant_id := v_row.tenant_id;
  status := v_row.status;
  return next;
end;
$fn$;

comment on function public.nexus_channel_mark_active(uuid, text) is
  'service_role-only. Promotes a PENDING_VERIFY WhatsApp Cloud channel to '
  'ACTIVE. Called by n8n''s Channel Test Send webhook after a real Graph API '
  'send against this phone_number_id has succeeded — never by the browser, '
  'never at registration time. Refuses (does not silently no-op) on any '
  'status other than pending, so it cannot be used to reactivate a suspended '
  'or revoked channel by mistake.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Read. What the Channels screen's connect form and "Send test message"
--    button need that nexus_channel_status() (NX986) does not carry:
--    integration_id, so the browser has something to hand back to the n8n
--    test-send webhook, plus the owner-entered display fields. Scoped the
--    same way NX986 scopes itself, and additive — NX986 is untouched.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.nexus_channel_registry_for_owner()
returns table (
  integration_id  uuid,
  channel_type    text,
  external_identifier text,
  display_number  text,
  waba_id         text,
  status          text,
  created_at      timestamptz,
  updated_at      timestamptz
)
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  select cr.integration_id, cr.channel_type, cr.external_identifier,
         cr.display_number, cr.waba_id, cr.status, cr.created_at, cr.updated_at
    from public.channel_registry cr
   where cr.tenant_id = any (
           select t from public.nexus_current_tenant_ids() t
         )
     and cr.channel_type = 'whatsapp_cloud_phone_number_id'
   order by cr.created_at desc;
$fn$;

comment on function public.nexus_channel_registry_for_owner() is
  'This dealership''s WhatsApp Cloud channel_registry rows, with '
  'integration_id — the one field nexus_channel_status() (NX986) '
  'deliberately does not expose. Any member may read it (same scope as '
  'nexus_current_tenant_ids()); only owner/admin may write via '
  'nexus_channel_register_cloud_number(). Zero rows for a caller in no '
  'dealership, never another dealership''s rows.';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Grants. Literal revokes before explicit grants, per house style.
-- ─────────────────────────────────────────────────────────────────────────
revoke all on function public.nexus_channel_register_cloud_number(text, text, text, text) from public, anon, authenticated;
revoke all on function public.nexus_channel_mark_active(uuid, text)                       from public, anon, authenticated;
revoke all on function public.nexus_channel_registry_for_owner()                           from public, anon, authenticated;

grant execute on function public.nexus_channel_register_cloud_number(text, text, text, text) to authenticated;
grant execute on function public.nexus_channel_mark_active(uuid, text)                       to service_role;
grant execute on function public.nexus_channel_registry_for_owner()                           to authenticated;

commit;
