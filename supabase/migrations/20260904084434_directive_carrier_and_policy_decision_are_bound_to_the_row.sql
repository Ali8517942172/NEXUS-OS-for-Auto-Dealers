-- A directive names the channel the message leaves through. Nothing tied that
-- channel to the dealership the row is filed under, so tenant A could file a
-- directive carrying tenant B's integration -- one dealership's message on
-- another's number. Make it a composite foreign key, so it is unrepresentable.
alter table public.channel_registry
  drop constraint if exists channel_registry_integration_tenant_key;
alter table public.channel_registry
  add constraint channel_registry_integration_tenant_key unique (integration_id, tenant_id);

alter table public.channel_send_directive
  drop constraint if exists csd_carrier_belongs_to_the_tenant;
alter table public.channel_send_directive
  add constraint csd_carrier_belongs_to_the_tenant
  foreign key (integration_id, tenant_id)
  references public.channel_registry (integration_id, tenant_id)
  on delete restrict;

-- A policy decision is a statement about a moment. Attaching one taken 30 days ago
-- to a send made now is not evidence that the send was permitted; it is evidence
-- that nobody checked. Both columns are row-local, so this is a CHECK and not a
-- trigger, and it holds against direct INSERT as well as through the router.
alter table public.channel_send_directive
  drop constraint if exists csd_send_decision_is_contemporaneous;
alter table public.channel_send_directive
  add constraint csd_send_decision_is_contemporaneous check (
    directive <> 'SEND'
    or (policy_evaluated_at is not null
        and policy_evaluated_at <= routed_at + interval '1 minute'
        and policy_evaluated_at >= routed_at - interval '5 minutes'));

-- And a decision that said the window was OPEN may not be attached to a send made
-- after that window had already expired.
alter table public.channel_send_directive
  drop constraint if exists csd_open_window_had_not_expired;
alter table public.channel_send_directive
  add constraint csd_open_window_had_not_expired check (
    directive <> 'SEND'
    or policy_window_state is distinct from 'OPEN'
    or (policy_window_expires_at is not null and policy_window_expires_at > routed_at));