-- NX970 — mirrored from production.
--
-- Applied to dsvuoovivysszdoiorch on 2026-09-14. This file is the repo's copy
-- of what production already runs; it is not a new change.

-- NX970 — The journey starts where the message lands.
--
-- The obvious plan was a second n8n node calling the journey RPC. It would have
-- meant dragging a connection through a live published workflow on the only
-- receiver a dealership has, and a workflow where two things must both succeed
-- has two things that can drift apart.
--
-- The message row is already written inside nexus_record_channel_event. The
-- journey belongs in the same transaction as the fact that started it, so it is
-- a trigger on channel_message_events and n8n does not change shape at all.
-- One node's JSON body gains one field. That is the entire live diff.
--
-- WHY THE TEXT HAS TO BE STORED
-- Classification needs the words. channel_message_events never kept them -- it
-- recorded that a message existed, not what it said -- so "Hi, what's the price"
-- and "Hi" were the same row to anything downstream. A column is added, and it
-- is nullable: every message already recorded stays valid, and a message that
-- arrives without text classifies as UNKNOWN rather than being guessed at.
--
-- WHY THE TRIGGER CANNOT FAIL THE INSERT
-- If the journey raises, the message must still be recorded. Losing the
-- evidence that a customer wrote to us, because the step that scores them had a
-- bug, is the worst possible trade. The handler records the failure as a
-- journey_step and lets the row through.

begin;

alter table public.channel_message_events
  add column if not exists message_text text,
  add column if not exists customer_display_name text;

comment on column public.channel_message_events.message_text is
  'What the customer actually wrote. Nullable: rows recorded before 14 Sep 2026 '
  'have none, and a message with no text classifies UNKNOWN rather than being guessed.';

-- The recorder now accepts the words, without changing its existing signature
-- for any caller that does not pass them.
create or replace function public.nexus_record_channel_event_text(
  p_event_id uuid,
  p_message_text text,
  p_customer_display_name text default null
) returns void
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $fn$
  update public.channel_message_events
     set message_text = coalesce(nullif(btrim(p_message_text), ''), message_text),
         customer_display_name = coalesce(nullif(btrim(p_customer_display_name), ''), customer_display_name)
   where event_id = p_event_id;
$fn$;
revoke all on function public.nexus_record_channel_event_text(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.nexus_record_channel_event_text(uuid, text, text) to service_role;

-- The trigger ----------------------------------------------------------------
create or replace function public.nexus_journey_on_message_recorded()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog', 'pg_temp'
as $fn$
declare
  v_corr text;
begin
  if new.direction <> 'inbound' then
    return new;
  end if;

  begin
    perform public.nexus_journey_from_channel_message(
      new.event_id, new.message_text, new.customer_display_name);
  exception when others then
    -- The message survives. The failure is recorded where someone will find it.
    v_corr := 'NX-' || upper(substr(replace(new.event_id::text,'-',''), 1, 10));
    begin
      insert into public.journey_step (correlation_id, tenant_id, step, status, ref_table, ref_id, detail)
      values (v_corr, new.tenant_id, 'JOURNEY', 'FAILED',
              'channel_message_events', new.event_id::text,
              left('The message was recorded; the journey raised: ' || sqlerrm, 900));
    exception when others then null;
    end;
  end;

  return new;
end;
$fn$;

drop trigger if exists nexus_channel_message_starts_a_journey on public.channel_message_events;
create trigger nexus_channel_message_starts_a_journey
  after insert on public.channel_message_events
  for each row execute function public.nexus_journey_on_message_recorded();

commit;
