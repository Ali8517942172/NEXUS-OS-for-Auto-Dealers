-- NX931 — pgcrypto lives in `extensions`, not `public`.
--
-- Applied to production dsvuoovivysszdoiorch 2026-09-14. Mirrors production.
--
-- nexus_channel_secret_put() pinned search_path to public/vault/pg_catalog, so
-- digest() resolved to nothing and the very first install failed with
-- `function digest(text, unknown) does not exist`. Qualify the call rather than
-- widening the search_path: a SECURITY DEFINER function that can reach a vault
-- should not gain a whole schema just to find one function.
--
-- The NX930 mirror already carries the corrected body, so this file is the
-- historical record of the fix. Re-running it is harmless.

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
  fingerprint := left(v_fp, 8);
  return next;
end;
$fn$;

revoke all on function public.nexus_channel_secret_put(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.nexus_channel_secret_put(uuid, text, text, text) to service_role;
