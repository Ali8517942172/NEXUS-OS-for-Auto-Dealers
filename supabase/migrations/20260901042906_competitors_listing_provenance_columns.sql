-- The competitors table could not say what it had actually compared.
--
-- `model` is our OWN inventory model string, written back out by the scraper --
-- so a "match" between our car and theirs compared a string to itself and could
-- never fail. And `competitor` is the page's hostname, so toyota.ae -- the
-- manufacturer's new-car site -- was presented to the sales floor as a rival
-- dealership undercutting us on a used unit.
--
-- These columns let a row record what was on the other page, so the screen can
-- show the comparison instead of asserting it.

alter table public.competitors
  add column if not exists listing_title   text,   -- the OTHER page's own title/model text
  add column if not exists source_host     text,   -- page hostname, always present
  add column if not exists source_kind     text,   -- oem | marketplace | dealer | unknown
  add column if not exists offer_name      text,   -- which offer on the page the price came from
  add column if not exists offer_condition text,   -- new | used | unknown, as the page stated it
  add column if not exists match_quality   text,   -- exact_year | model_only | weak
  add column if not exists match_note      text;   -- why the match is rated that way

comment on column public.competitors.model is
'OUR inventory model string, and the join key. It is NOT the competitor listing''s own text - that is listing_title. Anything comparing model to model is comparing our string to itself.';
comment on column public.competitors.competitor is
'Display name for the source. Historically the page hostname, which is why an OEM site could read as a rival dealership. source_host and source_kind are the reliable fields.';
comment on column public.competitors.match_quality is
'How much the compared price can be trusted to be the same car. exact_year = the chosen offer named our model year; model_only = model name matched but no year confirmation; weak = the price is the lowest on the page with nothing tying it to our unit.';