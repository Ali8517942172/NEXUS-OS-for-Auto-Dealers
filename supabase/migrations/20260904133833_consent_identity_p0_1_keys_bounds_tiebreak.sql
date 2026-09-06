-- =====================================================================
-- Consent identity P0.
--
-- A conversation that reached BLOCKED / CUSTOMER_OPTED_OUT could be
-- returned to FREEFORM_ALLOWED by three routes, none of which involved
-- the customer: a replay under a different evidence_ref, a replay under
-- a different evidence_kind, and an OPT_IN dated 2099. The tiebreak at
-- an identical occurred_at was heap order, and it resolved toward
-- consent.
--
-- The cause was that evidence -- caller-supplied free text -- was part
-- of the identity of a consent event, and occurred_at was unbounded.
-- =====================================================================

------------------------------------------------------------------
-- 1. Identity.
--
-- What identifies "this customer said yes/no at this moment on this
-- channel" is exactly that sentence: the dealership and the channel
-- (both verified against channel_registry by the writer, never taken
-- on the caller's word), the platform's own identifier for the
-- customer, which of the two things they said, and when.
--
-- Evidence is what makes the record believable. It is not what makes
-- it distinct, and while it was part of the key any caller who could
-- vary a string could mint a second consent act out of one.
------------------------------------------------------------------
alter table public.whatsapp_opt_in_event
  drop constraint whatsapp_opt_in_event_evidence_key;

alter table public.whatsapp_opt_in_event
  add constraint whatsapp_opt_in_event_act_key
  unique (tenant_id, integration_id, customer_wa_id, event, occurred_at);

comment on constraint whatsapp_opt_in_event_act_key on public.whatsapp_opt_in_event is
  'A consent act is identified by the conversation, the word said and the moment it was said. '
  'Nothing in this key is free text: tenant and integration are verified against channel_registry, '
  'customer_wa_id is the platform''s identifier, event is a two-value vocabulary, and occurred_at is '
  'bounded by wa_optin_occurred_at_bounded. Two genuinely distinct consent acts differ in occurred_at '
  'and are both recordable; a replay of one act collapses onto it.';

------------------------------------------------------------------
-- 2. Evidence is a property, and each piece of it attests one act.
--
-- Dropping evidence from the identity is not the same as letting it
-- roam. One message id, one form submission, one signed document is
-- one thing the customer did. Note what is deliberately NOT in this
-- index: evidence_kind (so relabelling the same reference cannot mint
-- a row) and event (so one reference cannot be made to attest both a
-- yes and a no). lower() and btrim() close the case and whitespace
-- variants.
------------------------------------------------------------------
create unique index whatsapp_opt_in_event_evidence_once
  on public.whatsapp_opt_in_event
  (tenant_id, integration_id, customer_wa_id, lower(btrim(evidence_ref)));

comment on index public.whatsapp_opt_in_event_evidence_once is
  'One piece of evidence attests exactly one consent act on one conversation. evidence_kind and event '
  'are deliberately absent: including either would let the same reference be relabelled into a second act.';

alter table public.whatsapp_opt_in_event
  add constraint wa_optin_evidence_ref_normalised
  check (evidence_ref = btrim(evidence_ref) and length(evidence_ref) between 1 and 300);

------------------------------------------------------------------
-- 3. occurred_at is bounded in both directions.
--
-- The upper bound stays true for the life of the row as the clock
-- advances, so it survives a dump and reload; the table is append-only,
-- so it is never re-checked against a moving now() for any other reason.
------------------------------------------------------------------
alter table public.whatsapp_opt_in_event
  add constraint wa_optin_occurred_at_bounded
  check (occurred_at >= timestamptz '2015-01-01 00:00:00+00'
     and occurred_at <= now() + interval '5 minutes');

comment on constraint wa_optin_occurred_at_bounded on public.whatsapp_opt_in_event is
  'A consent act cannot have happened before WhatsApp business messaging existed, and cannot have '
  'happened after now. Five minutes of tolerance is for a provider clock, not for a caller: it is far '
  'more than NTP-synced hosts disagree by and far less than any useful forgery window.';

------------------------------------------------------------------
-- 4. An OPT_IN that claims the customer's own message must cite one.
------------------------------------------------------------------
alter table public.whatsapp_opt_in_event
  add constraint wa_optin_customer_message_names_a_message
  check (event <> 'OPT_IN' or mechanism <> 'CUSTOMER_MESSAGE' or evidence_kind = 'WHATSAPP_MESSAGE_ID');

------------------------------------------------------------------
-- 5. The tiebreak, made structural rather than left to an ORDER BY
--    that a future author of a second view could get wrong.
--
-- At an identical occurred_at NEXUS cannot tell which came last. The
-- safe direction is fixed: it behaves as though the customer opted out.
-- OPT_OUT sorts first because it ranks 0.
------------------------------------------------------------------
alter table public.whatsapp_opt_in_event
  add column consent_rank smallint
  generated always as (case when event = 'OPT_OUT' then 0 else 1 end) stored;

comment on column public.whatsapp_opt_in_event.consent_rank is
  'Safety rank for the tiebreak, generated and not writable: OPT_OUT = 0, OPT_IN = 1. Ordering by '
  'occurred_at desc then consent_rank asc means that when two events share a timestamp -- which is '
  'what a writer recording both in one transaction produces -- the withdrawal governs. When NEXUS '
  'cannot tell which came last it must behave as though the customer opted out.';

create index whatsapp_opt_in_event_governing_idx
  on public.whatsapp_opt_in_event
  (tenant_id, integration_id, customer_wa_id, occurred_at desc, consent_rank asc, recorded_at desc, id desc);

------------------------------------------------------------------
-- 6. One derivation, in one place.
--
-- The state was derived twice -- once in whatsapp_policy_decision and
-- once in v_whatsapp_conversation_window -- from two hand-written
-- ORDER BYs that had to agree. They now both call this.
------------------------------------------------------------------
create or replace function public.whatsapp_opt_in_state(
  p_tenant_id uuid, p_integration_id uuid, p_customer_wa_id text)
returns table (state text, event text, occurred_at timestamptz, mechanism text,
               evidence_kind text, evidence_ref text, recorded_by text, recorded_at timestamptz)
language sql
stable
set search_path to 'public', 'pg_catalog'
as $$
  select case when e.event = 'OPT_IN' then 'OPTED_IN' else 'OPTED_OUT' end,
         e.event, e.occurred_at, e.mechanism, e.evidence_kind, e.evidence_ref,
         e.recorded_by, e.recorded_at
    from public.whatsapp_opt_in_event e
   where e.tenant_id       = p_tenant_id
     and e.integration_id  = p_integration_id
     and e.customer_wa_id  = lower(btrim(coalesce(p_customer_wa_id,'')))
     -- A consent act dated in the future is not a consent act. The CHECK
     -- refuses one at the door; this refuses to act on one that reached the
     -- table by some other road, and it is uniform, so it can never hide a
     -- withdrawal while showing a grant.
     and e.occurred_at <= now() + interval '5 minutes'
   order by e.occurred_at desc, e.consent_rank asc, e.recorded_at desc, e.id desc
   limit 1;
$$;

comment on function public.whatsapp_opt_in_state(uuid,uuid,text) is
  'The governing consent event for one conversation. Latest occurred_at wins; at a tie the withdrawal '
  'wins; then recorded_at and id give a total order, so the answer is deterministic whatever order two '
  'concurrent writers committed in. This is the only place the state is derived.';

revoke all on function public.whatsapp_opt_in_state(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.whatsapp_opt_in_state(uuid,uuid,text) to service_role;