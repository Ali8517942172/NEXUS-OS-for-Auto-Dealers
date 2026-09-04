-- finance_quotes was modelled as if every finance quote involves a trade-in.
-- It does not: a customer financing a purchase with no car to trade is the
-- common case. Calculate Equity & Tier correctly emits NULL for all three
-- trade-in columns and sets equity_status = 'No trade-in', but the columns
-- were bigint NOT NULL, so PostgREST rejected every such insert with
-- SQLSTATE 23502 -> HTTP 400. Log Quote has onError: continueRegularOutput,
-- so the rejection was swallowed silently and finance_quotes has held
-- ZERO rows since it was created -- the Finance Desk has never had data.
alter table public.finance_quotes
  alter column vehicle_value_aed drop not null,
  alter column loan_payoff_aed   drop not null,
  alter column equity_aed        drop not null;

-- Keep the invariant that actually matters: a trade-in quote must carry all
-- three figures, and a no-trade-in quote must carry none of them.
alter table public.finance_quotes
  add constraint finance_quotes_trade_in_complete check (
    (vehicle_value_aed is null and loan_payoff_aed is null and equity_aed is null)
    or
    (vehicle_value_aed is not null and loan_payoff_aed is not null and equity_aed is not null)
  );