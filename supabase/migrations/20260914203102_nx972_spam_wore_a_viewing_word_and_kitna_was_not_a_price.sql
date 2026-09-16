-- NX972_SPAM_WORE_A_VIEWING_WORD_AND_KITNA_WAS_NOT_A_PRICE — mirrored from production.
--
-- Applied to dsvuoovivysszdoiorch on 2026-09-14. This file is the repo's copy
-- of what production already runs; it is not a new change.

-- NX972 — Spam wore a viewing word, and "kitna" was not a price.
--
-- A red team ran 69 real-shaped UAE messages through the classifier. Nothing
-- crashed -- not the 5000-character string, not the SQL-shaped text, not the
-- RTL Arabic. But it found two classes of defect, and one of them is the class
-- that loses a dealership's trust in a week.
--
-- RULE A BREAKS (a lead invented from something that is not one) -- 2 found:
--   'WIN A FREE CAR NOW visit http://spam.example' -> TEST_DRIVE, promoted.
--     The spam check sat BELOW the viewing check, and the word "visit" is a
--     viewing word. Order was the whole bug.
--   'I am NOT interested in the price' -> PRICE_ENQUIRY, promoted.
--     There was no negation handling at all. ("don't send me prices" happened
--     to fall through to UNKNOWN, which made the gap look smaller than it was.)
--
-- RULE B BREAKS (a real buyer missed) -- 10 found, and nearly all of them are
-- the same omission: THE CLASSIFIER ONLY SPOKE ENGLISH. In Dubai a customer
-- writes "kitna", "kitne ka hai", "aakhri daam", "كم السعر". Every one of those
-- is a price enquiry and every one was scored UNKNOWN and dropped. Also missed:
-- 'installment' (the US spelling -- 'instalment' matched, the other did not),
-- 'can i see it', 'kab aa sakta hu', 'need a car under 60k', 'can you hold this
-- car for me'.
--
-- Order is now: empty -> spam -> opt-out -> finance -> trade-in -> price ->
-- viewing -> vehicle -> service -> info -> greeting -> unknown. Spam and
-- opt-out are first because both are reasons NOT to promote, and a reason not
-- to promote must outrank every reason to.

create or replace function public.nexus_classify_message_intent(p_text text)
returns table (intent text, reason_codes text[], promote_eligible boolean)
language plpgsql
immutable
as $fn$
declare
  t text := lower(coalesce(p_text, ''));
  rc text[] := array[]::text[];
  MODELS constant text :=
    '\m(fortuner|prado|patrol|land\s?cruiser|hilux|corolla|camry|explorer|lexus|'
    || 'nissan|toyota|ford|bmw|mercedes|benz|audi|kia|hyundai|honda|mitsubishi|'
    || 'pajero|rav4|tucson|sportage|civic|accord|yaris|tahoe|suburban|range\s?rover)\M';
begin
  if btrim(t) = '' then
    return query select 'UNKNOWN'::text, array['EMPTY_MESSAGE']::text[], false; return;
  end if;

  -- 1. SPAM FIRST. It used to sit below the viewing check, and "visit" in
  --    "WIN A FREE CAR NOW visit http://..." promoted an advert to a test drive.
  if t ~ '(http://|https://|www\.|t\.me/|bit\.ly)'
     or t ~ '\m(congratulations|you have won|win a free|click here|unsubscribe|'
         || 'promo code|join my (channel|group)|limited offer|act now|'
         || 'earn money|investment opportunity)\M' then
    return query select 'SPAM'::text, array_append(rc,'SPAM_SIGNAL'), false; return;
  end if;

  -- 2. OPT-OUT AND NEGATION SECOND. A reason not to promote outranks every
  --    reason to. "I am NOT interested in the price" is not a price enquiry.
  if t ~ '\m(not interested|no longer interested|don''?t (want|send|call|contact|message)|'
      || 'do not (want|send|call|contact|message)|stop sending|remove me|'
      || 'wrong number|not me|mistake)\M' then
    return query select 'NON_BUSINESS'::text, array_append(rc,'OPT_OUT'), false; return;
  end if;

  -- 3. Finance. 'installment' is the US spelling; only 'instalment' matched before.
  if t ~ '\m(instal?ment|instal?ments|installment|installments|emi|finance|financing|'
      || 'down\s?payment|downpayment|lease|leasing|loan|bank|monthly payment|'
      || 'qist|qists|kist)\M' then
    return query select 'FINANCE_ENQUIRY'::text, array_append(rc,'FINANCE_WORD'), true; return;
  end if;

  if t ~ '\m(trade[\s-]?in|exchange|part[\s-]?ex|my old car|sell my|swap)\M' then
    return query select 'TRADE_IN'::text, array_append(rc,'TRADE_IN_WORD'), true; return;
  end if;

  -- 4. Price, in the languages this market actually writes in. A Dubai customer
  --    types "kitna" far more often than "what is the price".
  if t ~ '\m(price|pricing|cost|how much|rate|quote|discount|best offer|final|'
      || 'kitna|kitne|kitni|daam|keemat|qeemat|rakha|last price|final price|'
      || 'best price|cash price)\M'
     or t like '%السعر%' or t like '%بكم%' or t like '%كم%' or t like '%سعر%' then
    rc := array_append(rc,'PRICE_WORD');
    if t ~ MODELS then rc := array_append(rc,'MODEL_NAMED'); end if;
    return query select 'PRICE_ENQUIRY'::text, rc, true; return;
  end if;

  -- 5. Viewing. "can i see it" and "kab aa sakta hu" are a customer asking to
  --    come to the showroom; both were UNKNOWN.
  if t ~ '\m(test drive|testdrive|view|viewing|see the car|see it|come and see|'
      || 'can i see|visit|showroom|dekh|dekhna|kab aa|aa sakta|aa sakti|'
      || 'appointment|book a slot)\M' then
    return query select 'TEST_DRIVE'::text, array_append(rc,'VIEWING_WORD'), true; return;
  end if;

  -- 6. Vehicle interest, including the buyer who never names a model.
  if t ~ MODELS then
    return query select 'VEHICLE_ENQUIRY'::text, array_append(rc,'MODEL_NAMED'), true; return;
  end if;
  if t ~ '\m(available|availability|stock|in stock|interested in|looking for|'
      || 'do you have|any car|7\s?seater|seven seater|family (car|suv)|suv|sedan|'
      || 'hold (this|the) car|reserve|booking|book (it|this)|gaadi|gadi|car under|'
      || 'under \d+\s?k|budget|warranty|mileage|kilometer|kilometre|km)\M' then
    return query select 'VEHICLE_ENQUIRY'::text, array_append(rc,'VEHICLE_INTEREST'), true; return;
  end if;

  if t ~ '\m(service|servicing|repair|oil change|maintenance|warranty claim|'
      || 'workshop|ac not working|not working|breakdown)\M' then
    return query select 'SERVICE'::text, array_append(rc,'SERVICE_WORD'), false; return;
  end if;

  if t ~ '\m(timing|timings|open|close|closing|hours|where are you|location|'
      || 'address|directions|map)\M' then
    return query select 'INFO_ONLY'::text, array_append(rc,'INFO_WORD'), false; return;
  end if;

  -- 7. Greeting LAST among the recognisers, so "Hi, what's the price" is a
  --    price enquiry. Widened to the greetings this market actually sends.
  if t ~ '^\s*(hi|hii+|hello|hey|hy|salam|salaam|marhaba|shukran|'
      || 'as+alam[ou]?\s?alaik[ou]m|assalamualaikum|'
      || 'g(oo)?d\s?(mrng|morning|afternoon|evening|eve)|'
      || 'thanks|thank you|thx|ok|okay|k|yes|no|yeah|sure|👍|🙏)\W*$'
     or t like '%السلام عليكم%' then
    return query select 'GREETING'::text, array_append(rc,'GREETING_ONLY'), false; return;
  end if;

  if length(btrim(t)) < 4 then
    return query select 'UNKNOWN'::text, array_append(rc,'TOO_SHORT_TO_READ'), false; return;
  end if;

  -- UNKNOWN is a real answer. It is never upgraded to make a funnel look fuller.
  return query select 'UNKNOWN'::text, array_append(rc,'NO_RULE_MATCHED'), false;
end;
$fn$;

-- The gap the migration-mirror caught: both of these were created carrying the
-- default PUBLIC EXECUTE grant a function is born with. The classifier reads
-- nothing and the trigger function cannot be usefully called by hand, but
-- "born open" is exactly the shape that cost three days in September.
revoke all on function public.nexus_classify_message_intent(text) from public, anon;
grant execute on function public.nexus_classify_message_intent(text) to authenticated, service_role;

revoke all on function public.nexus_journey_on_message_recorded() from public, anon, authenticated;
