-- HELD. DO NOT APPLY.
--
-- This file is not in supabase/migrations/ and must not be moved there until
-- the owner has read it and decided. Written against production
-- dsvuoovivysszdoiorch as measured on 13 Sep 2026, read-only verified, never
-- executed.
--
-- WHAT IT DOES
--   Enables the Google Ads lead form endpoint (status disabled -> active) and
--   gives it an ingest_address, which is null today.
--
-- THE NULL ingest_address IS ITS OWN DEFECT, INDEPENDENT OF THE STATUS
-- -------------------------------------------------------------------
-- lead_ingest_endpoint.ingest_address is the only column in the registry that
-- records WHERE a source arrives. The walk-in and phone-call endpoints carry
-- 'dashboard://lead-drawer'; the Google row carries nothing. So the database
-- cannot answer the one question an operator asks at configuration time --
-- "which URL do I paste into Google Ads" -- and every certification pass has to
-- reconstruct it from a README instead of reading it from the row that governs
-- it. ops/v1-certification/OWNER-STEPS.md:246 already records this as blocking
-- certification. It would still be wrong if the endpoint were active, and it
-- would still be wrong if the endpoint were deleted, which is why it is called
-- out here rather than fixed silently in passing.
--
-- The column's own comment (20260907023225_leadingest_02_tenant_bound_endpoints
-- .sql:98) scopes it to email sources: "the distinct per-dealership local-part
-- on the ingest subdomain". That comment is narrower than the column's actual
-- use -- walk_in and phone_call already carry URI-shaped values. This migration
-- follows the established practice rather than the stale comment, and widens
-- the comment to say so. If the owner would rather keep ingest_address
-- email-only, then the correct fix is a NEW column, and this file is wrong.
--
-- ORDER MATTERS, AND GETTING IT WRONG DESTROYS REAL ENQUIRIES
-- ----------------------------------------------------------
-- Google Ads permanently discards a lead on a 4XX. While status='disabled',
-- nexus_lead_endpoint_for_public_key() returns zero rows (it joins on
-- e.status='active') and the receiver answers 403 GOOGLE_KEY_REJECTED --
-- discarded, never retried. So:
--
--   1. apply this migration
--   2. set the secret on the n8n VM under the name in secret_ref
--   3. verify with the test lead (ops/google-ads-activation/TEST-PLAN.md)
--   4. ONLY THEN paste the URL into a lead form that is attached to a running ad
--
-- Doing step 4 before steps 1-2 loses every enquiry that arrives in the gap,
-- silently, with a 403 that looks exactly like an attacker probing keys.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * It does not write a secret. secret_ref names where the secret lives; the
--     value belongs on the VM and never in this database or this repo.
--   * It does not ALTER TABLE. Everything here is an UPDATE against one row
--     plus one COMMENT, so no grant is disturbed and
--     nexus_guard_born_open_grants() has nothing to strip. There is no view in
--     this file; if one is ever added it must carry `with (security_invoker =
--     on)` inline in the CREATE VIEW -- a following ALTER VIEW is refused 42501.
--   * It does not change environment, declared_provenance, or public_key. The
--     public_key already in the row is the one that goes in the URL.
--
-- VERIFICATION IS AT THE BOTTOM AND IT RAISES. Do not treat a clean apply as
-- proof; read the NOTICE output.

begin;

-- One row, addressed by its unique public_key rather than by endpoint_id, so
-- this file is readable without a uuid lookup and cannot hit the wrong row.
update public.lead_ingest_endpoint
   set status         = 'active',
       ingest_address = 'https://35.224.126.225.nip.io/webhook/google-ads-lead?k=alba-prod-google-leadform-0001'
 where public_key = 'alba-prod-google-leadform-0001'
   and source_key = 'google_ads_lead_form';

-- The comment is widened because the column is already used more broadly than
-- it claims, and a comment that is wrong is worse than no comment: the next
-- reader trusts it.
comment on column public.lead_ingest_endpoint.ingest_address is
  'Where this source arrives, in the shape that source uses. For email: the '
  'distinct per-dealership local-part on the ingest subdomain -- route on the '
  'envelope recipient this matches, never on the To: header, because a dealer '
  'forwarding from their own inbox leaves To: pointing at themselves and files '
  'their leads under nobody. For an HTTP receiver: the full URL including the '
  'public key, which is what an operator pastes into the provider console. For '
  'a screen: a dashboard:// URI. Null means nobody can answer "where does this '
  'arrive" without reading a README, which is how an endpoint goes uncertified.';

-- ---------------------------------------------------------------------------
-- VERIFY. Raises rather than notices, so a wrong result cannot be committed by
-- someone who scrolled past the output.
-- ---------------------------------------------------------------------------
do $verify$
declare r record;
begin
  select * into r from public.lead_ingest_endpoint
   where public_key = 'alba-prod-google-leadform-0001';

  if not found then
    raise exception 'No endpoint with public_key alba-prod-google-leadform-0001. This migration was written against a row that does not exist here; do not commit.';
  end if;
  if r.status <> 'active' then
    raise exception 'status is % after the update, expected active', r.status;
  end if;
  if r.ingest_address is null or btrim(r.ingest_address) = '' then
    raise exception 'ingest_address is still empty after the update';
  end if;
  if r.source_key <> 'google_ads_lead_form' then
    raise exception 'public_key alba-prod-google-leadform-0001 belongs to source %, not google_ads_lead_form', r.source_key;
  end if;
  if r.declared_provenance <> 'shared_secret_in_body' then
    raise exception 'declared_provenance is %, and the receiver sends shared_secret_in_body; nexus_record_lead_event refuses the mismatch on a production endpoint', r.declared_provenance;
  end if;
  if r.secret_ref is null or btrim(r.secret_ref) = '' then
    raise exception 'secret_ref is empty. An active endpoint that names no secret authenticates nothing; the receiver answers 500 ENDPOINT_HAS_NO_SECRET_REF to every delivery.';
  end if;

  -- The endpoint is only reachable if the resolver can see it. Prove the
  -- resolver, not the row: the row being right and the join still returning
  -- zero (suspended tenant) is exactly the failure this catches.
  if not exists (select 1 from public.nexus_lead_endpoint_for_public_key('alba-prod-google-leadform-0001')) then
    raise exception 'The row is active but nexus_lead_endpoint_for_public_key() still returns zero rows. The tenant is probably not status=active. Every delivery would be answered 403 and permanently discarded by Google.';
  end if;

  raise notice 'Endpoint active. tenant=% environment=% secret_ref=% ingest_address=%',
    r.tenant_id, r.environment, r.secret_ref, r.ingest_address;
  raise notice 'The secret VALUE is not set by this migration. Until the environment variable named % is set on the n8n VM, every delivery is answered 500 ENDPOINT_SECRET_NOT_CONFIGURED and Google holds the lead rather than losing it.', r.secret_ref;
end
$verify$;

commit;
