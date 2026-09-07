-- Lead ingestion, part 5: what the dealership reads, and a secret that would
-- otherwise have been stored in plain text on every Google lead.
--
-- Google Ads authenticates its lead webhook with `google_key`: a plaintext
-- shared secret carried as a FIELD INSIDE THE JSON BODY. Parts 1-4 store
-- `payload_raw` verbatim, because storing the provider's own bytes is how a
-- disputed lead gets settled. Those two facts together mean that, as written,
-- every Google lead would have filed the endpoint's authentication secret into
-- a table -- and then the dealership read path added below would have handed it
-- to any signed-in user of that dealership.
--
-- Redaction by convention would have been a line in a runbook. This is a CHECK:
-- a row carrying the secret cannot be written at all, so the adapter has to
-- strip it before the insert rather than after somebody notices.
alter table public.lead_event
  add constraint lead_event_payload_carries_no_shared_secret check (
        payload_raw::text       !~* '"(google_key|app_secret|client_secret|access_token|api_key|authorization)"'
    and coalesce(hydrated_payload::text, '') !~* '"(google_key|app_secret|client_secret|access_token|api_key|authorization)"'
  );

comment on constraint lead_event_payload_carries_no_shared_secret on public.lead_event is
  'Provider payloads are stored verbatim, and one provider puts its shared '
  'secret in the payload. Redact before writing. Named so that a future '
  'provider needing an exception has to widen this deliberately.';

-- The dealership's own leads are the dealership's data, so unlike
-- workflow_registry -- which is vendor plumbing and left the dealer plane
-- entirely -- this table gets a real tenant-scoped read. The projection is
-- column-level, which is `channel_registry`'s shape: raw provider payloads and
-- the endpoint id are mechanism, and are withheld from the grant rather than
-- merely unselected by today's view.
drop policy lead_event_deny_end_users on public.lead_event;

create policy lead_event_deny_anon on public.lead_event
  as restrictive for all to anon using (false) with check (false);

create policy lead_event_no_end_user_writes on public.lead_event
  as restrictive for all to authenticated
  using (true) with check (false);

create policy lead_event_read_own_tenant on public.lead_event
  for select to authenticated
  using (tenant_id in (select public.nexus_current_tenant_ids()));

grant select (
  event_id, tenant_id, source_key, environment, origin_verified,
  provenance_counts_as_real, external_event_id, occurred_at, received_at,
  phase, disposition_reason, hydrated_at, hydration_error, lead_id, promoted_at
) on public.lead_event to authenticated;

-- payload_raw, hydrated_payload, normalized and endpoint_id are deliberately
-- absent from that list. normalized is withheld too: everything in it that the
-- dealership needs is already on the leads row it was promoted into, and a
-- second copy would be a second derivation of the same figure.

drop view if exists public.v_lead_origin;

create view public.v_lead_origin
with (security_invoker = true) as
select e.event_id,
       e.tenant_id,
       e.source_key,
       c.display_name          as source,
       c.channel_family,
       c.integration_status,
       e.phase,
       e.disposition_reason,
       e.received_at,
       e.occurred_at,
       e.lead_id,
       p.is_cryptographic      as origin_cryptographically_verified,
       p.strength_rank         as origin_strength,
       p.description           as origin_explanation,
       e.environment = 'simulation' as is_test_traffic
  from public.lead_event e
  join public.lead_source_catalogue c on c.source_key = e.source_key
  join public.lead_provenance_kind  p on p.kind = e.origin_verified;

comment on view public.v_lead_origin is
  'Where a dealership''s leads came from and how well that is attested. '
  'security_invoker, so a signed-in user sees only their own dealership''s rows '
  'through lead_event''s RLS. is_test_traffic is exposed rather than filtered, '
  'so a screen that forgets to exclude simulation traffic renders it as test '
  'data instead of counting it as real. origin_strength exists so that a lead '
  'authenticated by a secret sitting in a request body is never displayed as '
  'equally attested as one carrying an HMAC over raw bytes.';

alter view public.v_lead_origin owner to postgres;
revoke all on public.v_lead_origin from anon, authenticated, public;
grant select on public.v_lead_origin to authenticated, service_role;