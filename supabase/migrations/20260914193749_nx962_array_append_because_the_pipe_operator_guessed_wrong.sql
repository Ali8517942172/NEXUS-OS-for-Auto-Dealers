-- NX962 — mirrored from production.
--
-- Applied to dsvuoovivysszdoiorch on 2026-09-14. This file is the repo's copy
-- of what production already runs; it is not a new change.

-- NX962 — array_append, because `||` guessed wrong.
--
-- `rc := rc || 'GREETING_ONLY'` looks like appending an element. Postgres has
-- both anyarray||anyelement and anyarray||anyarray, and an unadorned string
-- literal is untyped, so it resolved to the array form and tried to parse
-- GREETING_ONLY as an array literal. Every reason code in the classifier had
-- the same defect; only the first branch to be exercised showed it.
--
-- array_append has one meaning. Using it is cheaper than remembering the cast.

create or replace function public.nexus_classify_message_intent(p_text text)
returns table (intent text, reason_codes text[], promote_eligible boolean)
language plpgsql
immutable
as $fn$
declare
  t text := lower(coalesce(p_text, ''));
  rc text[] := array[]::text[];
begin
  if btrim(t) = '' then
    return query select 'UNKNOWN'::text, array['EMPTY_MESSAGE']::text[], false; return;
  end if;

  if t ~ '\m(instal?ment|instal?ments|emi|finance|financing|down\s?payment|lease|loan|bank)\M' then
    return query select 'FINANCE_ENQUIRY'::text, array_append(rc,'FINANCE_WORD'), true; return;
  end if;

  if t ~ '\m(trade[\s-]?in|exchange|part[\s-]?ex|my old car|sell my)\M' then
    return query select 'TRADE_IN'::text, array_append(rc,'TRADE_IN_WORD'), true; return;
  end if;

  if t ~ '\m(price|pricing|cost|how much|rate|quote|discount|best offer|final)\M' then
    rc := array_append(rc,'PRICE_WORD');
    if t ~ '\m(fortuner|prado|patrol|land cruiser|hilux|corolla|camry|explorer|lexus|nissan|toyota|ford|bmw|mercedes|audi|kia|hyundai|honda)\M' then
      rc := array_append(rc,'MODEL_NAMED');
    end if;
    return query select 'PRICE_ENQUIRY'::text, rc, true; return;
  end if;

  if t ~ '\m(test drive|testdrive|view|viewing|see the car|come and see|visit|showroom)\M' then
    return query select 'TEST_DRIVE'::text, array_append(rc,'VIEWING_WORD'), true; return;
  end if;

  if t ~ '\m(fortuner|prado|patrol|land cruiser|hilux|corolla|camry|explorer|lexus|nissan|toyota|ford|bmw|mercedes|audi|kia|hyundai|honda)\M' then
    rc := array_append(rc,'MODEL_NAMED');
    return query select 'VEHICLE_ENQUIRY'::text, rc, true; return;
  end if;

  if t ~ '\m(available|availability|stock|in stock|interested in|looking for|do you have)\M' then
    return query select 'VEHICLE_ENQUIRY'::text, array_append(rc,'VEHICLE_INTEREST'), true; return;
  end if;

  if t ~ '\m(service|servicing|repair|oil change|maintenance|warranty claim|workshop)\M' then
    return query select 'SERVICE'::text, array_append(rc,'SERVICE_WORD'), false; return;
  end if;

  if t ~ '\m(timing|timings|open|close|hours|where are you|location|address|directions)\M' then
    return query select 'INFO_ONLY'::text, array_append(rc,'INFO_WORD'), false; return;
  end if;

  if t ~ '(http://|https://|www\.)' or t ~ '\m(congratulations|you have won|click here|unsubscribe|promo code)\M' then
    return query select 'SPAM'::text, array_append(rc,'SPAM_SIGNAL'), false; return;
  end if;

  -- A greeting ONLY when that is the entire message. Checked late, so that
  -- "Hi, what is the price" is a price enquiry and not a greeting.
  if t ~ '^\s*(hi|hello|hey|salam|salaam|assalam[ou]?\s?alaikum|good (morning|afternoon|evening)|thanks|thank you|ok|okay|yes|no)\W*$' then
    return query select 'GREETING'::text, array_append(rc,'GREETING_ONLY'), false; return;
  end if;

  if length(btrim(t)) < 4 then
    return query select 'UNKNOWN'::text, array_append(rc,'TOO_SHORT_TO_READ'), false; return;
  end if;

  return query select 'UNKNOWN'::text, array_append(rc,'NO_RULE_MATCHED'), false;
end;
$fn$;
