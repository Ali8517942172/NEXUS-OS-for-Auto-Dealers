-- Bad evidence is a state on the record, not a deletion of it.
--
-- 6 Sep 2026. On 31 August the WhatsApp BDC agent told a real customer the
-- Lexus LX 600 financed out at "roughly AED 11 200 per month over 60 months".
-- No calculation produced it: both Finance Calc runs for this lead that day
-- (audit_log 5fc8163d 04:02:32, 9c510b0d 04:03:40) FAILED to write a
-- finance_quotes row, and no calculator ran at all in the 34 minutes before the
-- instalment was sent. finance_quotes holds 0 rows.
--
-- The 6 Sep output gates (Guard Reply, Guard Brief) stop a model WRITING a new
-- figure. They do nothing about this one, because this one is READ back out of
-- communication_logs and quoted faithfully. Two live readers hand that table to
-- a model: get_lead_timeline (Lead Escalation) and Fetch Thread History
-- (WhatsApp BDC) -- the latter interpolated into the customer-facing agent's
-- prompt under "This is the real thread from the CRM -- treat it as what was
-- actually said". So the fix belongs in the evidence, not in the prompt.
--
-- This migration does NOT delete the row, does NOT correct the number, and does
-- NOT touch communication_logs.message. The value becomes INVALID, not REVISED.

create table if not exists public.communication_log_evidence_event (
  id                  uuid primary key default gen_random_uuid(),
  -- ON DELETE RESTRICT is load-bearing: while a quarantine record exists the
  -- communication_logs row CANNOT be deleted.
  comm_log_id         uuid not null
                        references public.communication_logs(id) on delete restrict,
  tenant_id           uuid not null,
  event               text not null check (event in ('QUARANTINE','REINSTATE','DISPUTE')),
  to_state            text not null check (to_state in ('ADMISSIBLE','QUARANTINED','DISPUTED')),
  reason_code         text not null check (reason_code in (
                        'FABRICATED_FIGURE_NO_CALCULATION',
                        'INTERNAL_DATA_DISCLOSED',
                        'MODEL_DELIBERATION_SENT',
                        'SUPERSEDED_BY_CORRECTION',
                        'OTHER')),
  reason              text not null check (length(btrim(reason)) >= 20),
  actor               text not null check (length(btrim(actor)) > 0),
  actor_auth_user_id  uuid,
  at                  timestamptz not null default now(),
  incident_ref        text,
  evidence_ref        text,
  -- Generated and unwritable. Breaks a tie at an identical `at` toward the more
  -- restrictive state. Found by rehearsal on staging, not by review: two events
  -- in one transaction tie on transaction time and a random uuid decided the
  -- winner -- the consent model's documented defect, reproduced here. A tie must
  -- never be the reason a fabricated figure becomes readable to a model again.
  evidence_rank       smallint generated always as
                        (case to_state when 'QUARANTINED' then 0
                                       when 'DISPUTED'    then 1
                                       when 'ADMISSIBLE'  then 2 end) stored,
  constraint comm_log_evidence_event_state_matches_event check (
    (event = 'QUARANTINE' and to_state = 'QUARANTINED') or
    (event = 'REINSTATE'  and to_state = 'ADMISSIBLE')  or
    (event = 'DISPUTE'    and to_state = 'DISPUTED')),
  -- Reinstating is held to a higher standard than quarantining, the same
  -- asymmetry the consent model uses for overturning an OPT_OUT.
  constraint comm_log_evidence_event_reinstate_needs_evidence check (
    event <> 'REINSTATE'
    or (nullif(btrim(coalesce(evidence_ref,'')),'') is not null
        and reason_code = 'SUPERSEDED_BY_CORRECTION'))
);

create index if not exists comm_log_evidence_event_canonical_idx
  on public.communication_log_evidence_event (comm_log_id, at desc, evidence_rank asc, id desc);
create index if not exists comm_log_evidence_event_tenant_idx
  on public.communication_log_evidence_event (tenant_id);

alter table public.communication_log_evidence_event enable row level security;

alter table public.communication_logs
  add column if not exists evidence_state text not null default 'ADMISSIBLE';

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid='public.communication_logs'::regclass
                    and conname='communication_logs_evidence_state_check') then
    alter table public.communication_logs
      add constraint communication_logs_evidence_state_check
      check (evidence_state in ('ADMISSIBLE','QUARANTINED','DISPUTED'));
  end if;
end $$;

comment on column public.communication_logs.evidence_state is
  'Whether this row is admissible as evidence. Derived by trigger from communication_log_evidence_event -- never set by hand. QUARANTINED rows are excluded from v_lead_timeline_admissible (the AI-facing projection) and shown, visibly marked, to the dealership. The message text is never altered.';

-- One canonical ordering, in one place. Both consumers call this.
create or replace function public.nexus_comm_log_evidence_state(p_comm_log_id uuid)
returns text language sql stable security invoker set search_path = public as $$
  select coalesce((select e.to_state
                     from public.communication_log_evidence_event e
                    where e.comm_log_id = p_comm_log_id
                    order by e.at desc, e.evidence_rank asc, e.id desc
                    limit 1), 'ADMISSIBLE');
$$;

create or replace function public.nexus_sync_comm_log_evidence_state()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid := coalesce(new.comm_log_id, old.comm_log_id);
begin
  update public.communication_logs
     set evidence_state = public.nexus_comm_log_evidence_state(v_id)
   where id = v_id;
  return null;
end; $$;

drop trigger if exists trg_comm_log_evidence_state on public.communication_log_evidence_event;
create trigger trg_comm_log_evidence_state
  after insert or update or delete on public.communication_log_evidence_event
  for each row execute function public.nexus_sync_comm_log_evidence_state();

-- The AI-facing projection. Every model-facing reader must point here.
create or replace view public.v_lead_timeline_admissible
with (security_invoker = true) as
  select id, lead_email, channel, direction, message, created_at, sent_by,
         tenant_id, external_message_id, channel_key, direction_key, evidence_state
    from public.communication_logs
   where evidence_state = 'ADMISSIBLE'
     and not exists (select 1 from public.tenants _q
                      where _q.is_quarantine and _q.id = communication_logs.tenant_id);

comment on view public.v_lead_timeline_admissible is
  'communication_logs minus rows ruled inadmissible as evidence. Every reader that hands conversation history to a model MUST read this, not the base table: get_lead_timeline (Lead Escalation) and Fetch Thread History (WhatsApp BDC). The row itself is untouched and still on the record.';

-- The dealership-facing projection. The message is still there, carrying why it
-- was flagged and by whom, so a screen can mark it rather than drop it.
create or replace view public.v_communication_log_evidence
with (security_invoker = true) as
  select c.id, c.lead_email, c.channel, c.direction, c.message, c.created_at,
         c.sent_by, c.tenant_id, c.evidence_state,
         (c.evidence_state <> 'ADMISSIBLE') as evidence_flagged,
         e.reason_code   as evidence_reason_code,
         e.reason        as evidence_reason,
         e.actor         as evidence_actor,
         e.at            as evidence_at,
         e.incident_ref  as evidence_incident_ref,
         e.evidence_ref  as evidence_ref
    from public.communication_logs c
    left join lateral (select ev.* from public.communication_log_evidence_event ev
                        where ev.comm_log_id = c.id
                        order by ev.at desc, ev.evidence_rank asc, ev.id desc
                        limit 1) e on true
   where not exists (select 1 from public.tenants _q
                      where _q.is_quarantine and _q.id = c.tenant_id);

comment on view public.v_communication_log_evidence is
  'What the dealership sees on Conversations: every message, including the ones ruled inadmissible, each carrying why it was ruled so and by whom. A quarantined message is marked, never dropped -- it was really sent, and hiding it from the people who deal with the customer would be a second lie.';

create or replace function public.nexus_quarantine_comm_log(
  p_comm_log_id uuid, p_reason_code text, p_reason text, p_actor text,
  p_incident_ref text default null, p_evidence_ref text default null)
returns public.communication_log_evidence_event
language plpgsql security invoker set search_path = public as $$
declare v_tenant uuid; v_row public.communication_log_evidence_event;
begin
  select tenant_id into v_tenant from public.communication_logs where id = p_comm_log_id;
  if v_tenant is null then
    raise exception using errcode = 'NX001',
      message = 'No communication_logs row with that id.',
      detail  = 'COMM_LOG_NOT_FOUND',
      hint    = 'Quarantine names a row that exists. Check the id against communication_logs before asserting anything about it.';
  end if;
  insert into public.communication_log_evidence_event
    (comm_log_id, tenant_id, event, to_state, reason_code, reason, actor, incident_ref, evidence_ref)
  values (p_comm_log_id, v_tenant, 'QUARANTINE', 'QUARANTINED', p_reason_code,
          p_reason, p_actor, p_incident_ref, p_evidence_ref)
  returning * into v_row;
  return v_row;
end; $$;

drop policy if exists comm_log_evidence_event_authenticated_read on public.communication_log_evidence_event;
create policy comm_log_evidence_event_authenticated_read
  on public.communication_log_evidence_event for select to authenticated
  using (tenant_id in (select nexus_current_tenant_ids()));

drop policy if exists comm_log_evidence_event_deny_anon on public.communication_log_evidence_event;
create policy comm_log_evidence_event_deny_anon
  on public.communication_log_evidence_event as restrictive for all to anon
  using (false) with check (false);

drop policy if exists comm_log_evidence_event_service_role_all on public.communication_log_evidence_event;
create policy comm_log_evidence_event_service_role_all
  on public.communication_log_evidence_event for all to service_role
  using (true) with check (true);

-- Supabase's default privileges grant directly to anon and authenticated, and
-- REVOKE ... FROM PUBLIC does not remove a direct grant. Revoke from both.
revoke all on public.communication_log_evidence_event from anon, authenticated, public;
revoke all on public.v_lead_timeline_admissible        from anon, authenticated, public;
revoke all on public.v_communication_log_evidence      from anon, authenticated, public;

grant select on public.communication_log_evidence_event to authenticated;
grant select on public.v_communication_log_evidence      to authenticated;
grant all    on public.communication_log_evidence_event  to service_role;
grant select on public.v_lead_timeline_admissible        to service_role;
grant select on public.v_communication_log_evidence      to service_role;

revoke all on function public.nexus_quarantine_comm_log(uuid,text,text,text,text,text) from anon, authenticated, public;
revoke all on function public.nexus_comm_log_evidence_state(uuid) from anon, public;
revoke all on function public.nexus_sync_comm_log_evidence_state() from anon, authenticated, public;
grant execute on function public.nexus_quarantine_comm_log(uuid,text,text,text,text,text) to service_role;
grant execute on function public.nexus_comm_log_evidence_state(uuid) to service_role, authenticated;