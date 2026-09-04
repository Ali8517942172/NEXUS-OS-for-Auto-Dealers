-- One-time repair of the rows the retired BEFORE INSERT trigger poisoned.
--
-- All three leads read 0. None of them was answered in under 30 seconds; the
-- trigger had measured a reply that arrived BEFORE the lead row existed and
-- greatest(0, ...) had rendered that negative interval as instant service.
-- The new writer guards on `response_time_minutes is null`, so these rows would
-- never self-correct: the repair must reset before it re-derives.
--
-- Correct values, derived below and verified by hand against communication_logs
-- on 2026-09-01:
--   lead 34 -> 1     (reply 06:12:56.897, created 06:11:49.690)
--   lead 35 -> NULL  (nobody has ever replied to this lead)
--   lead 38 -> 4     (reply 02:44:53.078, created 02:40:41.135)
--
-- Note lead 38: an earlier audit put this at 81 minutes by reading the first row
-- filed under the lead's real email address. The genuine first reply is filed
-- under '+918517942172@whatsapp.lead' and was invisible until the resolver was
-- made symmetric in the previous migration. There is no hidden SLA breach here.
-- Lead 35 is the damning row: never answered, and the column asserted otherwise.

update public.leads set response_time_minutes = null;

with replies as (
  select c.created_at, public.nexus_lead_for_comm_key(c.lead_email) as lead_id
  from public.communication_logs c
  where public.nexus_is_reply(c.direction, c.channel, c.message)
),
derived as (
  -- Only replies at or after the lead row count. A reply that predates it
  -- belongs to the conversation that produced the lead, not to answering it.
  select l.id,
         round(extract(epoch from (min(r.created_at) - l.created_at)) / 60.0)::int as mins
  from public.leads l
  join replies r on r.lead_id = l.id and r.created_at >= l.created_at
  group by l.id, l.created_at
)
update public.leads l
   set response_time_minutes = d.mins
  from derived d
 where d.id = l.id;