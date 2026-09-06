-- The earlier finance_quotes_allow_no_trade_in migration only did half the job.
-- It freed vehicle_value_aed / loan_payoff_aed / equity_aed, but left
-- equity_status NOT NULL with CHECK (equity_status IN ('Positive','Negative')) --
-- and Calculate Equity & Tier emits the string 'No trade-in' for a cash buyer.
-- So every no-trade-in quote STILL failed, just at a different constraint, and
-- the only way to make one insert was to record a false 'Positive' equity for a
-- customer who has no trade-in at all. Two independent reviews caught this.
alter table public.finance_quotes
  drop constraint if exists finance_quotes_equity_status_check;

alter table public.finance_quotes
  add constraint finance_quotes_equity_status_check
  check (equity_status is null or equity_status in ('Positive', 'Negative', 'No trade-in'));

alter table public.finance_quotes
  alter column equity_status drop not null;

-- Keep equity_status honest: it must agree with whether a trade-in is present.
alter table public.finance_quotes
  add constraint finance_quotes_equity_status_matches_trade_in check (
    (vehicle_value_aed is null and (equity_status is null or equity_status = 'No trade-in'))
    or
    (vehicle_value_aed is not null and equity_status in ('Positive', 'Negative'))
  );

-- calculation_id is the evidence handle a finance number is traced by. PostgREST
-- sends an explicit null when a key is present, which would override the column
-- default -- so Log Quote deliberately never sends this key and the database
-- mints it. Making it NOT NULL guarantees every stored quote has one.
update public.finance_quotes set calculation_id = gen_random_uuid() where calculation_id is null;
alter table public.finance_quotes alter column calculation_id set not null;

comment on column public.finance_quotes.equity_status is
  'Positive/Negative when a trade-in is present; ''No trade-in'' for a cash or straight-finance purchase. Never fabricate Positive to satisfy a constraint.';