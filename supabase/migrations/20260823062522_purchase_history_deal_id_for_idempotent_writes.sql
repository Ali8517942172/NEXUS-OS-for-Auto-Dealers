-- purchase_history has never had a single row, and the reason is not a bug in
-- the Deals screen: the "record a deal" flow posts to the deals/closed-won
-- webhook, and that workflow only writes deals_embeddings. Nothing has ever
-- written purchase_history at all, so the revenue screen reads an empty table
-- by construction.
--
-- The closed-won workflow already derives a DETERMINISTIC deal id
-- ("auto:<email>|<closed_at>") precisely so re-posting the same deal overwrites
-- its vector row instead of duplicating it. Give purchase_history the same key
-- and the same property: the deal row and its embedding are then two halves of
-- one record, and a retried webhook cannot create a second purchase.
alter table public.purchase_history
  add column if not exists deal_id text;

comment on column public.purchase_history.deal_id is
  'Deterministic id minted by the closed-won workflow; matches deals_embeddings.deal_id. Unique, so a retried webhook cannot duplicate a purchase.';

-- Partial unique index rather than a plain constraint: rows that predate this
-- column (there are none today, but a manual insert could add one) carry NULL
-- and must not collide with each other.
create unique index if not exists purchase_history_deal_id_key
  on public.purchase_history (deal_id)
  where deal_id is not null;