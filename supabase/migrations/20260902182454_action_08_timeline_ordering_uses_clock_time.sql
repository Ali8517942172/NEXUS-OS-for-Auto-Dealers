-- ===========================================================================
-- action_08_timeline_ordering_uses_clock_time
--
-- BUSINESS RULE: a timeline has to be readable in the order things happened.
-- inventory_action_events.at defaulted to now(), which is TRANSACTION start
-- time, so the two events an approval writes - APPROVED and ASSIGNED - carried
-- an identical timestamp and their order on screen was whatever the planner
-- felt like. clock_timestamp() advances within the transaction, so the rows
-- sort the way a person watched them happen. Existing rows are left alone; they
-- are already written and moving them would be rewriting history to make it
-- tidier.
-- ===========================================================================
alter table public.inventory_action_events
  alter column at set default clock_timestamp();

comment on column public.inventory_action_events.at is
  'clock_timestamp(), not now(): two events written by the same call must not share a '
  'timestamp, or the timeline has no defined order.';