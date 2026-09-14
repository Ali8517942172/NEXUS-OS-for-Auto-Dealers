-- NX940 — The handshake can name the dealer without shipping the token.
--
-- Applied to production dsvuoovivysszdoiorch 2026-09-14. Mirrors production.
--
-- Meta's GET subscription handshake carries only hub.mode, hub.challenge and
-- hub.verify_token. There is no phone_number_id in it, so the receiver cannot
-- look up "this dealer's" verify token the way it can for a POST.
--
-- The wrong fix is to fetch every dealer's verify token into n8n and compare
-- there: that puts every token on the wire, in memory, and in any execution
-- record n8n keeps, to answer one yes/no question.
--
-- So the comparison happens here, inside the database, and only the answer
-- leaves. The token is compared in constant time against each installed one --
-- an early return on the first differing byte leaks the prefix by timing, and
-- a handshake is exactly the kind of endpoint someone will sit and measure.

create or replace function public.nexus_channel_verify_token_matches(
  p_token text
) returns table (tenant_id uuid, integration_id uuid, phone_number_id text)
language plpgsql
stable
security definer
set search_path to 'public', 'vault', 'pg_catalog', 'pg_temp'
as $fn$
declare
  r        record;
  stored   text;
  matched  boolean;
  i        int;
begin
  if p_token is null or p_token = '' then
    return;
  end if;

  for r in
    select cr.tenant_id, cr.integration_id, cr.external_identifier, cs.vault_secret_id
      from public.channel_registry cr
      join public.channel_secret  cs on cs.integration_id = cr.integration_id
     where cr.channel_type = 'whatsapp_cloud_phone_number_id'
       and cr.status = 'active'
       and cs.kind = 'meta_verify_token'
  loop
    select vs.decrypted_secret into stored
      from vault.decrypted_secrets vs where vs.id = r.vault_secret_id;

    -- Constant time over the stored token's length. Length inequality is not
    -- secret (it is observable from the refusal either way), but the contents
    -- are, so every byte is compared even after a mismatch is known.
    matched := (stored is not null and length(stored) = length(p_token));
    if stored is not null and length(stored) = length(p_token) then
      for i in 1 .. length(stored) loop
        if substr(stored, i, 1) <> substr(p_token, i, 1) then
          matched := false;
        end if;
      end loop;
    end if;

    if matched then
      tenant_id := r.tenant_id;
      integration_id := r.integration_id;
      phone_number_id := r.external_identifier;
      return next;
      return;
    end if;
  end loop;

  -- No row. The caller refuses. A handshake that cannot name a dealership is
  -- not a handshake we should confirm.
  return;
end;
$fn$;

revoke all on function public.nexus_channel_verify_token_matches(text)
  from public, anon, authenticated;
grant execute on function public.nexus_channel_verify_token_matches(text) to service_role;
