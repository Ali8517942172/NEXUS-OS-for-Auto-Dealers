-- Idempotency guard for inbound WAHA webhook deliveries.
-- WAHA has repeatedly delivered the same message three times in one second.
-- The primary key makes the claim atomic: concurrent deliveries race on the
-- INSERT and exactly one wins, which a SELECT-then-INSERT check cannot do.
create table if not exists public.processed_messages (
  message_id   text primary key,
  source       text        not null default 'waha',
  chat_id      text,
  processed_at timestamptz not null default now()
);

comment on table public.processed_messages is
  'One row per inbound message id already handled. Claimed atomically by the WhatsApp BDC workflow via INSERT ... on_conflict=do_nothing. Rows older than 7 days are pruned by the retention purge workflow.';

create index if not exists processed_messages_processed_at_idx
  on public.processed_messages (processed_at);

alter table public.processed_messages enable row level security;

-- Only the service role (which bypasses RLS) may touch this table.
-- Browser-side keys get nothing, in either direction.
drop policy if exists processed_messages_no_anon on public.processed_messages;
create policy processed_messages_no_anon
  on public.processed_messages for all to anon
  using (false) with check (false);

drop policy if exists processed_messages_no_authenticated on public.processed_messages;
create policy processed_messages_no_authenticated
  on public.processed_messages for all to authenticated
  using (false) with check (false);