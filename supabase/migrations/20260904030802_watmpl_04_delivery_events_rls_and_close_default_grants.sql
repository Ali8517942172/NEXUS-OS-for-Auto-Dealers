alter table public.whatsapp_delivery_events enable row level security;

-- Same posture as channel_message_events, and for the same reason: these rows
-- carry the customer's WhatsApp id and the provider's raw payload. Staff read
-- messaging usage through whatsapp_message_usage, which carries no customer
-- identifier at all. End-user roles get nothing here.
create policy whatsapp_delivery_events_deny_end_users
  on public.whatsapp_delivery_events as restrictive for all to anon, authenticated
  using (false) with check (false);

create policy whatsapp_delivery_events_service_role_all
  on public.whatsapp_delivery_events for all to service_role
  using (true) with check (true);

revoke all on table public.whatsapp_delivery_events from anon, authenticated, public;
grant all  on table public.whatsapp_delivery_events to service_role;

revoke all on function public.whatsapp_delivery_events_guard_link()  from anon, authenticated, public;
revoke all on function public.whatsapp_delivery_events_append_only() from anon, authenticated, public;
grant execute on function public.whatsapp_delivery_events_guard_link()  to service_role;
grant execute on function public.whatsapp_delivery_events_append_only() to service_role;