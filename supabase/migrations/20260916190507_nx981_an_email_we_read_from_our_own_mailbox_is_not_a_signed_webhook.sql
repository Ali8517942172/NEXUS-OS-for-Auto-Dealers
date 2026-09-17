-- NX981 — An email we read from our own mailbox is not a signed webhook.
--
-- `marketplace_email_notification` was written with required_provenance
-- 'hmac_sha256_svix' -- Resend's shape. Resend is out of this architecture
-- (ADR: Gmail and Meta WhatsApp Cloud only), and
-- lead_ingest_endpoint_production_matches_source refuses a production endpoint
-- whose declared provenance differs from the catalogue's required one. So with
-- Resend gone, an inbound-email endpoint could not be registered at all. No
-- endpoint references the row, so the requirement is restated rather than
-- worked around.
--
-- The replacement is named for exactly what it is. Reading a message out of a
-- mailbox we hold the OAuth token for attests the FETCH, not the MESSAGE:
-- SPF breaks across a forward by design, DKIM is not verified here, and anyone
-- who learns the address can post a lead into it. So it is not cryptographic
-- and not externally attested, and it sits below every signed kind and above
-- operator_recorded. It gets its own kind precisely so that no screen can
-- render it as a signature.
--
-- THE ENDPOINT IS CREATED DISABLED, ON PURPOSE. It becomes active the day a
-- real email produces a real lead_event, not the day the row is written.
-- Do not enable it to make the pill green.

begin;

insert into public.lead_provenance_kind
  (kind, is_cryptographic, strength_rank, counts_as_real, is_externally_attested, description)
values
  ('mailbox_read_oauth', false, 15, true, false,
   'Read by NEXUS from a dedicated mailbox it authenticates to over OAuth. Externally originated, so it counts as real, but nothing attests the message itself: SPF breaks across a forward by design, DKIM is not verified on this path, and anyone who learns the ingest address can post a lead into it. The secrecy of the address is the only gate. Idempotency rests on the RFC Message-ID header, and a message without one is refused rather than hashed into something that merely looks unique.')
on conflict (kind) do nothing;

update public.lead_source_catalogue
   set required_provenance = 'mailbox_read_oauth',
       evidence_note = coalesce(evidence_note, '') ||
         ' As of 16 Sep 2026 the route is a dedicated Gmail mailbox polled by n8n over OAuth, not a signed inbound webhook. Nothing signs the message; the secrecy of the address is the gate, and rfc_message_id carries idempotency. The receiver is authored at ops/n8n-gmail-inbound/ and has not been imported.'
 where source_key = 'marketplace_email_notification';

insert into public.lead_ingest_endpoint
  (tenant_id, source_key, required_provenance_for_source, declared_provenance,
   provenance_counts_as_real, environment, public_key, secret_ref, origin_allowlist,
   ingest_address, status, rate_limit_per_minute, label)
select
  'fff6a2b5-cfd5-4460-8383-875bc5826de0'::uuid,
  'marketplace_email_notification',
  'mailbox_read_oauth',
  'mailbox_read_oauth',
  true,
  'production',
  -- 24 random bytes as URL-safe base64, which satisfies ^[A-Za-z0-9_-]{24,128}$.
  -- Nested replace(), not the pipe operator: NX962 already learned that
  -- Postgres resolves `||` in ways the author did not intend.
  replace(replace(replace(encode(extensions.gen_random_bytes(24), 'base64'), '+', '-'), '/', '_'), '=', ''),
  null,
  '{}'::text[],
  -- The mailbox is not created yet. The address is written when it exists;
  -- a made-up one here would answer "where does this arrive" with a guess.
  null,
  'disabled',
  60,
  'ALBA CARS inbound marketplace email, polled from a dedicated Gmail inbox by n8n'
where not exists (
  select 1 from public.lead_ingest_endpoint e
   where e.tenant_id = 'fff6a2b5-cfd5-4460-8383-875bc5826de0'::uuid
     and e.source_key = 'marketplace_email_notification'
);

do $verify$
declare r record;
begin
  select * into r from public.lead_ingest_endpoint
   where source_key = 'marketplace_email_notification'
     and tenant_id = 'fff6a2b5-cfd5-4460-8383-875bc5826de0'::uuid;
  if not found then
    raise exception 'NX981: the endpoint row was not created. Rolling back.';
  end if;
  if r.status <> 'disabled' then
    raise exception 'NX981: the endpoint is % and this migration must leave it disabled. Rolling back.', r.status;
  end if;
  raise notice 'NX981 endpoint REGISTERED and DISABLED. public_key=% . It has received nothing, no mailbox exists, and no inbound Gmail credential exists. It goes active the day a real email produces a real lead_event.', r.public_key;
end
$verify$;

commit;