-- NX1012 -- a dealer's own website form, answered by one function.
--
-- The embed script (apps/executive-dashboard/public/embed/nexus-lead-form.js)
-- posts to the edge function lead-intake-website, which holds the
-- service_role key and calls THIS function and nothing else. Every decision
-- that matters is made here, in one transaction, not in TypeScript:
--
--   * the tenant comes from the endpoint the public key resolves to -- never
--     from the body. There is no tenant parameter to pass.
--   * only a website_form endpoint answers here. A Meta or Google key pasted
--     into a script tag is refused, not recorded under the wrong contract.
--   * the browser Origin must be in the endpoint's origin_allowlist.
--   * a per-endpoint rate limit, counted from lead_event itself.
--   * record + promote through the SAME door functions every other source
--     uses (nexus_record_lead_event, nexus_promote_lead_event), with the
--     provenance the endpoint declares (origin_and_form_key).
--   * idempotency on the client-minted submission_id: a replay answers
--     DUPLICATE and is still promoted if the first attempt never got that far.
--
-- Expected refusals are RETURNED as an outcome code, not raised, so the edge
-- function can map them to 404/403/429/400 without parsing error text.
-- Anything raised is ours and answers 5XX, so the browser retries with the
-- same submission_id.

create or replace function public.nexus_ingest_website_form(
  p_public_key    text,
  p_origin        text,
  p_payload       jsonb,
  p_submission_id text
)
returns table (outcome text, lead_event_id uuid, lead_id integer, was_duplicate boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  r_ep      record;
  r_ev      record;
  r_pr      record;
  v_origin  text := lower(rtrim(btrim(coalesce(p_origin, '')), '/'));
  v_sub     text := btrim(coalesce(p_submission_id, ''));
  v_recent  integer;
  v_norm    jsonb;
  v_name    text;
  v_email   text;
  v_phone   text;
  v_digits  text;
begin
  if coalesce(btrim(p_public_key), '') = '' then
    return query select 'UNKNOWN_KEY'::text, null::uuid, null::integer, false;
    return;
  end if;

  select * into r_ep from public.nexus_lead_endpoint_for_public_key(p_public_key);
  if not found or r_ep.source_key <> 'website_form' then
    return query select 'UNKNOWN_KEY'::text, null::uuid, null::integer, false;
    return;
  end if;

  if v_origin = '' or not exists (
       select 1 from unnest(r_ep.origin_allowlist) a
        where lower(rtrim(btrim(a), '/')) = v_origin) then
    return query select 'ORIGIN_NOT_ALLOWED'::text, null::uuid, null::integer, false;
    return;
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return query select 'BAD_PAYLOAD'::text, null::uuid, null::integer, false;
    return;
  end if;

  -- The client mints a UUID per form load. Anything else is not an
  -- idempotency key, and the lead_event CHECK would refuse the per-attempt
  -- shapes anyway; refuse it here with a code the browser can act on.
  if v_sub !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return query select 'SUBMISSION_ID_REQUIRED'::text, null::uuid, null::integer, false;
    return;
  end if;
  v_sub := lower(v_sub);

  -- Replay first: a retry of a lead we already hold must never be counted
  -- against the rate limit or refused for it.
  select e.event_id, e.phase into r_ev
    from public.lead_event e
   where e.tenant_id = r_ep.tenant_id
     and e.source_key = r_ep.source_key
     and e.external_event_id = v_sub;
  if found then
    if r_ev.phase = 'HYDRATED' then
      select * into r_pr from public.nexus_promote_lead_event(r_ev.event_id);
      return query select 'DUPLICATE'::text, r_ev.event_id, r_pr.lead_id, true;
    else
      return query select 'DUPLICATE'::text, r_ev.event_id,
        (select e.lead_id from public.lead_event e where e.event_id = r_ev.event_id), true;
    end if;
    return;
  end if;

  select count(*) into v_recent
    from public.lead_event e
   where e.endpoint_id = r_ep.endpoint_id
     and e.received_at > now() - interval '1 minute';
  if v_recent >= r_ep.rate_limit_per_minute then
    return query select 'RATE_LIMITED'::text, null::uuid, null::integer, false;
    return;
  end if;

  v_name  := left(btrim(regexp_replace(coalesce(p_payload->>'name', ''), '[[:cntrl:]]', '', 'g')), 120);
  v_email := lower(left(btrim(coalesce(p_payload->>'email', '')), 160));
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    v_email := '';
  end if;

  -- E.164 or nothing, the same rule the marketing site uses: a UAE local
  -- 05x number is unambiguous here; anything else must already carry its
  -- country code. We never paste +971 onto a number that was not local.
  v_phone  := regexp_replace(coalesce(p_payload->>'phone', ''), '[^0-9+]', '', 'g');
  v_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
  v_phone := case
    when v_phone ~ '^\+[1-9][0-9]{7,14}$'  then v_phone
    when v_digits ~ '^00[1-9][0-9]{7,14}$' then '+' || substr(v_digits, 3)
    when v_digits ~ '^971[0-9]{9}$'        then '+' || v_digits
    when v_digits ~ '^0?5[0-9]{8}$'        then '+971' || regexp_replace(v_digits, '^0', '')
    else '' end;

  if v_phone = '' and v_email = '' then
    return query select 'CONTACT_REQUIRED'::text, null::uuid, null::integer, false;
    return;
  end if;
  if v_name = '' then
    return query select 'NAME_REQUIRED'::text, null::uuid, null::integer, false;
    return;
  end if;

  v_norm := jsonb_strip_nulls(jsonb_build_object(
    'full_name',        v_name,
    'phone_e164',       nullif(v_phone, ''),
    'email',            nullif(v_email, ''),
    'vehicle_interest', nullif(left(btrim(coalesce(p_payload->>'vehicle_interest', '')), 200), ''),
    'message',          nullif(left(btrim(coalesce(p_payload->>'message', '')), 2000), '')
  ));

  select * into r_ev from public.nexus_record_lead_event(
    p_public_key,
    v_sub,
    r_ep.declared_provenance,
    jsonb_build_object(
      'channel',     'website_embed',
      'origin',      v_origin,
      'page_url',    left(coalesce(p_payload->>'page_url', ''), 500),
      'fields',      v_norm - 'full_name' - 'phone_e164' - 'email'
    ),
    now(),
    v_norm
  );

  if r_ev.was_duplicate then
    -- Lost a race with a concurrent replay; the other attempt owns promotion.
    return query select 'DUPLICATE'::text, r_ev.event_id, null::integer, true;
    return;
  end if;

  select * into r_pr from public.nexus_promote_lead_event(r_ev.event_id);
  return query select 'ACCEPTED'::text, r_ev.event_id, r_pr.lead_id, false;
end $$;

comment on function public.nexus_ingest_website_form(text, text, jsonb, text) is
  'NX1012. The only door a dealer''s embedded website form uses. Tenant from '
  'the endpoint key only; Origin allowlist, rate limit, idempotency on '
  'submission_id; records and promotes through the shared lead_event doors. '
  'Returns outcome in (ACCEPTED, DUPLICATE, UNKNOWN_KEY, ORIGIN_NOT_ALLOWED, '
  'RATE_LIMITED, BAD_PAYLOAD, SUBMISSION_ID_REQUIRED, CONTACT_REQUIRED, '
  'NAME_REQUIRED). service_role only -- called by the lead-intake-website '
  'edge function.';

revoke all on function public.nexus_ingest_website_form(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.nexus_ingest_website_form(text, text, jsonb, text) to service_role;
