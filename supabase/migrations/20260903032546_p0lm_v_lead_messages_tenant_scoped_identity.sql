-- P0 · v_lead_messages resolved messages across dealerships.
--
-- BUSINESS RULE
--   A message belongs to the customer who sent it, AT THE DEALERSHIP THAT
--   RECEIVED IT. Identity (email, phone tail, WhatsApp @lid) is only ever
--   compared within one tenant. Two dealerships are two separate universes of
--   people: the same email address or the same nine-digit phone tail at
--   dealership A and dealership B is two different customers, and neither
--   dealership may see, or be confused by, the other's.
--
-- WHAT BREAKS WITHOUT THE TENANT PREDICATE
--   Every join arm here matched on identity alone. Under RLS the dashboard
--   (`authenticated`) was incidentally safe, because RLS filtered both sides of
--   the join to the caller's tenant. n8n reads this view as `service_role`,
--   which BYPASSES RLS -- so for the automation there was no filter at all.
--   Demonstrated live, in a rolled-back transaction, on all three arms:
--   a message stored under tenant A resolved to a lead in tenant C, and the
--   Lead Recovery engine reported messages_resolved = 1 for that lead as
--   `service_role` while the same read as `authenticated` returned 0. That is
--   one dealership's customer conversation appearing under another
--   dealership's lead -- and the drip reply gate, Lead Recovery and the
--   attribution chain all read it.
--
--   The `unique_tail` guard had the mirror-image failure. It counted DISTINCT
--   PEOPLE on a nine-digit tail across ALL tenants, so an unrelated customer at
--   another dealership sharing a tail made the tail "ambiguous" and silently
--   deleted a dealership's resolution of its OWN phone-keyed messages.
--   Also demonstrated in a rolled-back transaction: 1 row -> 0 rows. Scoping
--   the guard per tenant keeps the refusal that INV-002 requires (a tail shared
--   by two people AT THE SAME DEALERSHIP still matches nothing, counted by
--   distinct person, not by row) without letting a stranger's data suppress it.
--
-- tenant_id is now exposed so a `service_role` consumer can assert the tenant
-- it asked for rather than trusting the join. It is the MESSAGE's tenant; the
-- join guarantees the lead's tenant is the same value.
--
-- security_invoker is restated explicitly: CREATE OR REPLACE VIEW silently
-- drops the option, and the `nexus_guard_security_invoker_views` event trigger
-- fails the deploy without it.

create or replace view public.v_lead_messages
with (security_invoker = true) as
with person as (
  select
    l.id,
    l.tenant_id,
    coalesce(nullif(lower(btrim(coalesce(l.email, ''))), ''), 'lead:' || l.id::text) as person_key,
    nullif(right(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g'), 9), '')   as tail9,
    length(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g'))                 as plen
  from public.leads l
),
unique_tail as (
  -- Ambiguity is judged per dealership, and by distinct PERSON, not by row:
  -- a duplicated customer row must not make their own tail ambiguous.
  select p.tenant_id, p.tail9
  from person p
  where p.tail9 is not null and p.plen >= 9
  group by p.tenant_id, p.tail9
  having count(distinct p.person_key) = 1
)
select
  l.id as lead_id,
  c.id,
  c.created_at,
  c.channel,
  c.direction,
  c.message,
  c.lead_email,
  public.nexus_is_message(c.direction, c.channel, c.message) as is_message,
  c.tenant_id
from public.communication_logs c
join public.leads l
  --  TENANT PREDICATE: applies to every arm of the disjunction below.
  on l.tenant_id = c.tenant_id
 and (
      -- ARM 1 -- exact lowercased email, within the tenant.
      (
        coalesce(btrim(l.email), '') <> ''
        and lower(btrim(c.lead_email)) = lower(btrim(l.email))
      )
   or -- ARM 2 -- last nine digits of a phone-bearing key, within the tenant,
      -- and only when that tail belongs to exactly one person AT THIS TENANT.
      (
        c.lead_email not like '%@lid'
        and length(regexp_replace(split_part(c.lead_email, '@', 1), '[^0-9]', '', 'g')) >= 9
        and right(regexp_replace(split_part(c.lead_email, '@', 1), '[^0-9]', '', 'g'), 9)
            = right(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g'), 9)
        and length(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g')) >= 9
        and exists (
              select 1 from unique_tail ut
              where ut.tenant_id = l.tenant_id
                and ut.tail9 = right(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g'), 9)
            )
      )
   or -- ARM 3 -- opaque @lid key bridged through whatsapp_contacts. The bridge
      -- row is itself tenant-owned and carries its own join, so it gets its own
      -- predicate: a bridge belonging to another dealership must not be usable.
      (
        c.lead_email like '%@lid'
        and exists (
              select 1
              from public.whatsapp_contacts wc
              where wc.chat_id = c.lead_email
                and wc.tenant_id = c.tenant_id
                and (
                      (
                        coalesce(btrim(l.email), '') <> ''
                        and lower(btrim(wc.lead_email)) = lower(btrim(l.email))
                      )
                   or (
                        length(regexp_replace(coalesce(wc.phone, ''), '[^0-9]', '', 'g')) >= 9
                        and right(regexp_replace(coalesce(wc.phone, ''), '[^0-9]', '', 'g'), 9)
                            = right(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g'), 9)
                        and length(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g')) >= 9
                        and exists (
                              select 1 from unique_tail ut2
                              where ut2.tenant_id = l.tenant_id
                                and ut2.tail9 = right(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g'), 9)
                            )
                      )
                    )
            )
      )
     );

comment on view public.v_lead_messages is
  'Message-to-lead resolution (INV-002), scoped to one dealership. Identity is '
  'compared only within a tenant: l.tenant_id = c.tenant_id gates all three '
  'arms (email, unique nine-digit phone tail, @lid bridge), the whatsapp_contacts '
  'bridge carries its own wc.tenant_id = c.tenant_id, and unique_tail judges '
  'ambiguity per tenant by distinct person. Without those predicates a message '
  'received by one dealership resolves to another dealership''s lead whenever '
  'RLS is not filtering -- which is exactly how n8n reads it, as service_role. '
  'tenant_id is exposed so such a caller can assert the tenant it asked for.';

-- Grants: a replace can reset these, Supabase default privileges grant DIRECTLY
-- to anon/authenticated, and REVOKE FROM PUBLIC does not remove a direct grant.
-- Revoke from both, then restore only the two roles that actually read this view
-- (dashboard = authenticated, n8n = service_role).
revoke all on public.v_lead_messages from anon;
revoke all on public.v_lead_messages from public;
grant select on public.v_lead_messages to authenticated;
grant select on public.v_lead_messages to service_role;