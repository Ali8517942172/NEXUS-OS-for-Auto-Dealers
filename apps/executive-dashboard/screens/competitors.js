/* NEXUS OS — screens/competitors.js
   Reworked on 19 Aug 2026 to answer one question: am I priced right?

   The old screen printed the scrape's own `price_diff_aed` column and trusted
   it. That number is a snapshot of what our list price was at scrape time, so
   after any re-price it quietly describes a price we no longer ask. This screen
   matches each scraped row against the stock we actually hold and computes the
   gap against the live list price in `inventory`. The stored figure is still
   shown in the drawer, labelled as the scrape's own snapshot, and flagged when
   the two disagree, because that disagreement is itself information.

   Freshness is stated rather than implied. A price comparison is only as good
   as the day it was collected, so the age of the newest row is on the screen at
   all times and a scrape that has missed a cycle says so in a banner.

   24 Aug 2026 — alerts. A price-comparison screen that does not say how old its
   prices are is lying, so the freshness statement was promoted out of a banner
   half-way down the page into the header of an alert strip that sits above even
   the KPI row: it is now the first sentence on the screen, and it is rendered
   whether the data is fresh or not. `v_needs_attention?screen=eq.competitors`
   is read and its rows are listed there, each one re-checked against the list
   price we ask today — the view's `undercut` rows carry the gap as it was at
   scrape time, and that figure is currently over a month old.

   Five failures the view does not model are raised here as well, because each
   is a way this screen can be quietly wrong rather than visibly empty:
     · what the match under every AED figure actually is — a model-name match,
       and how far that is from being the same car;
     · rows that are not a competitor at all: a scraper placeholder, or a
       bot-detection page stored as a dealership;
     · rows the latest scrape did not refresh (the job still runs, but it has
       stopped covering those listings) and rows with no scrape date at all;
     · a competitor every one of whose rows arrived with no price — it
       contributes to no gap and can support no undercut claim;
     · an unsold unit of ours that no scraped row matches. That is the undercut
       we would never detect, and it is invisible by construction: there is no
       row to look at, which is exactly why it needs saying out loud.
   Every alert scrolls to and opens the comparison row it is about, or filters
   the table down to the rows it names.

   One figure in that strip is computed here rather than by a shared helper, for
   the reason the screen exists: a helper that rounds is worse than no helper
   where the subject is how old a number is, so a waiting time past a week is
   spelled out in days rather than through `ago()`, which collapses every one of
   the view's mid-July rows into the same "1 mo ago". Severity colour is
   `tone()`'s job and the private map that used to live here is gone.

   24 Aug 2026, second pass. An audit found the screen's central claim to be
   false and the table under it to be partly junk.

     · The match was never a make match. `uMake` read `make`/`brand` off an
       inventory row and `inventory` has neither column, so it returned null on
       every row and the "make · model" index was keyed on norm('' + ' ' + model)
       — byte-identical to the model index. Every row that reached basis 'mm'
       was drawn with a chip reading "make · model" and the tooltip "Same make
       and model", over a match on the model string alone, with a confident AED
       gap beside it: a cross-brand collision on a shared model name would have
       priced us against the wrong car. `BASIS.exact` was dead for the same
       reason — no year is recorded on either side either. Both are gone. The
       chip, the tooltip and the drawer now say what the match is — a text match
       on `model` — and warn wherever the name cannot rule out another
       manufacturer, which today is every row.
     · A manufacturer written *inside* a model string ("Toyota Land Cruiser",
       which is what the unit form's own placeholder asks for) is read where it
       is there, always labelled as inferred from the text, and never presented
       as a make column. It can only weaken a match: two strings naming two
       different manufacturers stop being compared at all.
     · The competitors table holds rows that are not competitors. Two carry the
       literal string "null" as the dealership name and one carries "Pardon Our
       Interruption" — a bot-detection interstitial the scraper captured and
       stored as a competitor. All three carry no price. They are reported as
       the data-quality fault they are and excluded from every count, gap and
       market claim here; a row with no price cannot support an undercut and is
       never counted in one.
     · Nothing has refreshed since mid-July. The scrape's n8n trigger was an
       "every 24 hours" interval, which drifts and then stops silently after a
       restart; it is on a cron now, but the prices below were collected six
       weeks ago and that is said wherever a comparison is presented as
       current.

   24 Aug 2026, third pass — the table was emptied, and the empty state is now
   the screen. All fifteen rows were deleted: twelve were seed prices whose
   `our_price_aed` contradicted the stock we hold (a Land Cruiser quoted at AED
   290,000 against a 385,000 list price; a GLE, an X5, a Cayenne and a Macan
   that were never on the lot), so the five undercut alerts this screen fed to
   Overview were fabricated and went with them; the other three were the scrape
   failures below. `v_needs_attention` now files nothing against this screen,
   which is said in a sentence rather than left as an empty box.

   None of the guards below became dead code. The scraper is on a cron now and
   will write rows again, and these branches are what keeps the same garbage out
   when it does — so every one of them is kept and every one degrades to
   *nothing*, not to a titled card with blank space under it: the by-competitor
   summary is not rendered at all with no sources, the filter chips and the
   staleness clock never get built, and the one panel with a real answer today —
   our own unsold stock, none of which has ever been checked against a rival
   price — takes the full width and leads the screen.

   31 Aug 2026, fourth pass. The table filled again, and a second audit found
   that everything this screen had learned to say honestly about its *match* was
   still being said over a source that is worse than the screen believed. Four
   things changed, and all four are the writer's faults stated out loud rather
   than papered over — none of them can be fixed from here.

     · The match is circular. `Log Competitor Intel` writes `model` as
       `={{ $json.model }}`, and that value is carried down from
       `Build Apify Query`, which built the search query out of the Supabase
       *inventory* row. `competitors.model` is therefore our own model string
       round-tripped, not the listing's. Matching it against `inventory.model`
       compares a value with itself: the join cannot miss, `makeIn()` reads the
       same manufacturer word on both sides, and the "both sides name the same
       make" conclusion was an inference drawn from one string twice. Every row
       whose model text is byte-identical to one of ours is now labelled as the
       circular match it is, and the reassuring branch of the match-quality
       alert is unreachable while that holds.
     · The price side, which was never modelled here at all, is where the real
       like-for-like risk lives. `collectPrices()` walks the page's JSON-LD and
       takes the *lowest* AED figure over 20,000 found anywhere on it. Nothing
       constrains it to the same year, trim, mileage or even to a used car. Our
       152,000 Fortuner is therefore measured against toyota.ae's cheapest new
       base Fortuner. That sentence is now on the row, in the tooltip and in the
       drawer, because it is the one that stops somebody re-pricing a car.
     · `competitors` is append-only. The Supabase node carries no `operation`
       key, so it defaults to `create` and every run inserts rather than
       upserting on the listing. Eight rows on file are three listings. Every
       count on this screen was a count of snapshots, which is how "We ask more
       4" and "We undercut 4" came to sit beside a subtitle correctly reading
       three vehicles. Everything countable is now reduced to the newest
       snapshot per listing first; the history is kept only where history is the
       subject, which is staleness and the drawer.
     · `competitor` is the page's hostname, not a dealership. All eight rows
       read `toyota.ae` — the manufacturer's own new-car site. "toyota.ae is
       AED 23,100 cheaper" read as a rival showroom undercutting us on the same
       used unit; it is a list price for a different, new car. The column is a
       source now, and where the host is a manufacturer's own domain the screen
       says so.

   The schedule constants were wrong in both hour and cadence and are one
   derived set now — see SCRAPE_HOURS_UTC. And the screen no longer asserts the
   scrape is healthy merely because rows are arriving: `v_workflow_health` is
   read, and it reports PRODUCING_NOTHING. */
import { db } from '../lib/data.js';
import { $, el } from '../lib/dom.js';
import { aed, aedSigned, ago, dubaiStamp, esc, n0, num, pct, pill, tone } from '../lib/format.js';
import { healthWords } from '../lib/health.js';
import { SCREENS, go } from '../lib/nav.js';
import { stateEmpty, stateError, stateLoading } from '../lib/states.js';
import { closeDrawer, kpi, openDrawer, panel, table, wireRows } from '../lib/ui.js';
import { deriveUnit, unitForm } from '../lib/unit-form.js';

/* The hours the scrape actually fires, UTC, and the ONE constant every other
   figure about the schedule is derived from — the prose, the next-run time, and
   both staleness thresholds. It used to be two constants that disagreed with
   the workflow and with each other: `SCRAPE_EVERY_HOURS = 24` and
   `SCRAPE_HOUR_UTC = 5`, which put "expected daily at 05:00 UTC" on the screen
   and a next run at 09:00 GST — an hour this job has never fired at.

   The deployed trigger is `"0 5,17 * * *"` with `"timezone": "Asia/Dubai"`, so
   it fires twice a day at 05:00 and 17:00 GST = 01:00 and 13:00 UTC. Every
   `scraped_at` on file is ~01:00 UTC and `audit_log` carries runs at both 01:00
   and 13:00, which is the evidence for the second hour: the 13:00 run fires and
   writes nothing.

   `workflow_registry.trigger_detail` is NOT the source used here, deliberately.
   It reads "Cron 0 5 * * * (05:00 Asia/Dubai = 01:00 UTC)" — right about the
   hour, a day behind on the cadence — so deriving from it would reinstate the
   halved cycle count this round exists to remove. It is read at runtime and
   the disagreement is reported on the screen instead, because a registry that
   describes a different schedule from the one running is itself worth saying.

   The hour list is named in both clocks because the schedule is fixed in UTC
   and the reader is not. */
const SCRAPE_HOURS_UTC = [1, 13];
const SCRAPE_CRON = '0 5,17 * * *';                        // as deployed, Asia/Dubai
const SCRAPE_EVERY_HOURS = 24 / SCRAPE_HOURS_UTC.length;   // 12 — the gap between runs
const SCRAPE_SCHEDULE = 'twice a day, at 01:00 and 13:00 UTC (05:00 and 17:00 GST)';
/* Two cycles, not two days. These were 48 h against a job believed to run daily;
   against the real cadence 48 h is four cycles, which is why a table that had
   not been covered for two days looked fresh. Derived so they cannot drift
   apart from the cadence again. */
const STALE_AFTER_HOURS = SCRAPE_EVERY_HOURS * 2;
const ROW_LIMIT = 500;
const ATTN_LIMIT = 100;

/* The workflow's name in `workflow_registry` / `v_workflow_health`. Health is
   read rather than inferred: this screen used to conclude "the scrape is still
   writing rows, so this is not the job being down", and the view says
   PRODUCING_NOTHING — 84 runs, 11 successes, 73 producing no usable price. */
const SCRAPE_WORKFLOW = 'Competitor Price Scraping';

/* Past a week the wording stops hedging. "Missed a cycle" is a scheduling
   hiccup an operator can shrug at; a price collected last month is a different
   claim about the world and is coloured as the harder failure it is. */
const VERY_STALE_DAYS = 7;

/* A LISTING whose newest snapshot trails the newest row in the table by more
   than one further cycle was not picked up by the last scrape. That is a
   different fault from the whole table being old, and it hides inside a
   healthy-looking "last scrape" figure, which is why it is counted separately.

   This is measured per listing, not per row. It used to be measured per row
   against an append-only table, so a listing scraped every day for a week was
   accused of not being covered on the strength of its own week-old snapshot —
   two rows were flagged as abandoned on 31 Aug while both listings behind them
   had been re-scraped on the 29th, 30th and 31st. */
const REFRESH_LAG_HOURS = SCRAPE_EVERY_HOURS * 2;

/* Below this many comparisons the counts on this screen describe a handful of
   individual listings and nothing about a market. The scrape writes whatever it
   managed to collect, so "we undercut 2 of 3" is a real possibility the day
   after a partial run, and a count that small has to say what it is. */
const THIN_ROWS = 3;

/* The blind-spot list is a list of things to go and do, not a stock report;
   past this many rows it stops being read and Inventory is the better screen
   for it. The count is stated in full either way. */
const BLIND_LIMIT = 20;

/* Matches the aging threshold the inventory screen uses when it starts calling a
   unit old. Used only to qualify how bad a blind spot is, never to compute one. */
const AGING_DAYS = 60;

const low = s => String(s == null ? '' : s).toLowerCase();
const isSold = u => low(u.status) === 'sold';
/* Model names arrive punctuated differently from every source — "Land-Cruiser",
   "LAND CRUISER", "Land Cruiser 300". Compare on letters and digits only. */
const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const plural = (n, one, many) => (Number(n) === 1 ? one : many);
/* Days, spelled out. `ago()` collapses anything past 30 days to "1 mo ago",
   which is the one place this screen must not round: "1 mo" and "43 days" feel
   like different amounts of wrong to the person about to quote the price. */
const dayWord = n => `${num(n)} ${Number(n) === 1 ? 'day' : 'days'}`;
/* Every absolute time on this screen is the showroom's, not the reader's. The
   scraper runs on "timezone": "Asia/Dubai" like every other workflow, so a
   collection time re-read in the browser's own zone is a different moment
   wearing the same digits. dubaiStamp() pins it and labels it GST. */
const dt = ts => dubaiStamp(ts);

/* Midnight UTC on the day a moment falls in. Both functions below walk whole
   days and pick the scheduled hours out of them, which is what keeps them
   correct for a cron with two unevenly-spaced hours as well as this one. */
const utcMidnight = ms => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

/* The next time the cron is due to fire, as a real Date rather than a phrase.
   Computed from the UTC clock so it stays right in any timezone the browser
   happens to be in. */
function nextScrape(from = Date.now()) {
  for (let day = utcMidnight(from); ; day += 86400000) {
    for (const h of SCRAPE_HOURS_UTC) {
      const t = day + h * 3600000;
      if (t > from) return new Date(t);
    }
  }
}

/* How many scheduled runs fall in (from, to]. Counted rather than divided: a
   division by an average gap is only right while the hours are evenly spaced,
   and it under-reported by exactly half for the whole time this screen believed
   the job was daily. A run counted here is a run that was due — whether it
   fired, and whether it produced anything, is what v_workflow_health answers. */
function cyclesSince(from, to = Date.now()) {
  if (!(from < to)) return 0;
  let n = 0;
  for (let day = utcMidnight(from); day <= to; day += 86400000) {
    for (const h of SCRAPE_HOURS_UTC) {
      const t = day + h * 3600000;
      if (t > from && t <= to) n += 1;
    }
  }
  return n;
}

/* The hours a cron string in `workflow_registry.trigger_detail` names, in UTC.
   Used for one thing: telling the reader when the registry's recorded schedule
   is not the schedule the workflow is running. It reads the hour field only,
   which is all a "0 5,17 * * *" style entry carries, and returns null rather
   than guessing at anything it cannot parse. */
function registryHoursUtc(detail) {
  const s = String(detail == null ? '' : detail);
  const m = /(^|\s)([0-9*,\-/]+)\s+([0-9,]+)\s+\*\s+\*\s+\*/.exec(s);
  if (!m) return null;
  const hours = m[3].split(',').map(h => Number(h)).filter(h => Number.isInteger(h) && h >= 0 && h < 24);
  if (!hours.length) return null;
  /* Every workflow in this system runs on "timezone": "Asia/Dubai", which is a
     fixed +04:00 with no daylight saving — so the shift is arithmetic, not a
     calendar question. */
  const shift = /dubai|gst|\+0?4/i.test(s) ? 4 : 0;
  return [...new Set(hours.map(h => (h - shift + 24) % 24))].sort((a, b) => a - b);
}
/* How long until then, in the units a person waits in. Under an hour is stated
   in minutes because "in about 0 hours" is not an answer. */
const waitWord = ms => {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `in ${num(mins)} ${plural(mins, 'minute', 'minutes')}`;
  const h = Math.round(mins / 60);
  return `in about ${num(h)} ${plural(h, 'hour', 'hours')}`;
};

/* Reads the first column that actually carries a value. The competitor feed and
   the inventory table were built by different workflows and do not agree on
   names; this resolves them without inventing a value when none is present. */
function pick(row, names) {
  for (const k of names) {
    const v = row?.[k];
    if (v != null && String(v).trim() !== '') return v;
  }
  return null;
}

/* The two column lists, read off the live database on 24 Aug 2026:

     competitors  id, competitor, model, our_price_aed, price_aed,
                  price_diff_aed, scraped_at, ai_recommendation
     inventory    id, model, vin, status, acquired_at, cost_aed, price_aed,
                  days_in_stock, holding_cost_accrued, gross_margin, net_margin,
                  vat_amount, aging_alert, ai_recommendation,
                  recommended_commission

   Neither side has a make, a brand or a model year, and neither has a listing
   contact. The alias lists below are what the feed has actually been called at
   some point; the real column is first and nothing here reaches for a column
   that does not exist on either table. */
/* `competitor` is not a dealership and this reads it as one at your peril. The
   scraper sets it from `ldSeller || hostSource || modelSource`, and in practice
   that is `hostSource` — `new URL(page).hostname` with the leading "www."
   removed. All eight rows on file read "toyota.ae", which is the manufacturer's
   own new-car site. The workflow's NOT_A_SELLER guard only excludes search and
   social hosts, so an OEM, an aggregator and a classifieds portal all arrive
   here looking exactly like a rival showroom. It is called a source
   everywhere on this screen for that reason. */
const cName  = r => pick(r, ['competitor', 'competitor_name', 'dealer']);
/* NOT the listing's model text — see MODEL_IS_OURS. It is our own inventory
   row's model string, written back out by the scraper. */
const cModel = r => pick(r, ['model', 'vehicle_model']);
const cPrice = r => n0(pick(r, ['price_aed', 'competitor_price_aed']));
const cAt    = r => pick(r, ['scraped_at', 'checked_at', 'created_at']);

const uModel = u => pick(u, ['model']);
const uPrice = u => n0(pick(u, ['price_aed']));
const uRef   = u => pick(u, ['id']);          // `id` IS the stock number

/* The sentence every match on this screen has to be read against. */
const NO_MAKE = 'Neither table records a make or a model year — `model` is free text and it is the only thing there is to match on.';

/* The harder sentence. `competitors.model` is not what the listing calls the
   car: the scraper's `Log Competitor Intel` node writes it as `$json.model`,
   which `Parse AI Price` carries down from `Build Apify Query` — and that node
   reads the Supabase *inventory* row and builds its search query from it. The
   value stored in this column is our own model string, returned to us. Matching
   it against `inventory.model` is therefore a comparison of a value with
   itself: it cannot fail, and any manufacturer read off "both sides" is the
   same word counted twice. The screen can only report this, not fix it — the
   fix is a listing-side model field in the scraper. */
const MODEL_IS_OURS = 'The model text on this row is our own: the scraper writes back the inventory model string it searched with, so matching it against our stock compares one value with itself and cannot tell us the two cars are the same car.';

/* And the side that was never modelled here at all. `collectPrices()` walks the
   page’s JSON-LD and returns the LOWEST AED figure above 20,000 found anywhere
   on it; where that finds nothing, a language model reads the first 6,000
   characters of a web-search result for "<model> price UAE dealership". Nothing
   in either path constrains the figure to the same year, trim, mileage or even
   to a used car. A manufacturer’s model page lists every variant, so the number
   that arrives is the cheapest new base trim. */
const PRICE_UNCONSTRAINED = 'Their figure is the lowest AED price over 20,000 found anywhere on the page — no year, trim, mileage or condition is matched, so on a page listing several variants it is the cheapest, usually new, one.';

/* Manufacturer names, used for exactly one thing: spotting a make that somebody
   already typed into a model string. It is never used to fill a make in. A name
   found this way is labelled "inferred from the model text" everywhere it is
   shown, and it can only ever weaken a match or add a caution — never create a
   match, and never turn one into "same make". */
const MAKE_WORDS = [
  'toyota', 'lexus', 'nissan', 'infiniti', 'mitsubishi', 'honda', 'mazda',
  'suzuki', 'subaru', 'isuzu', 'hyundai', 'kia', 'genesis', 'ford', 'chevrolet',
  'chevy', 'gmc', 'cadillac', 'dodge', 'jeep', 'chrysler', 'ram', 'tesla',
  'bmw', 'mini', 'mercedes', 'mercedes benz', 'benz', 'maybach', 'audi',
  'volkswagen', 'vw', 'porsche', 'skoda', 'peugeot', 'citroen', 'renault',
  'volvo', 'jaguar', 'land rover', 'range rover', 'bentley',
  'rolls royce', 'aston martin', 'mclaren', 'ferrari', 'lamborghini',
  'maserati', 'alfa romeo', 'fiat', 'byd', 'geely', 'chery', 'haval',
  'changan', 'jetour', 'omoda', 'jaecoo', 'lincoln', 'buick', 'acura',
];
/* Different words for the same manufacturer. Without this a "Range Rover Sport"
   and a "Land Rover Range Rover" would look like two different makes and stop
   being compared, which is the opposite of the point. */
const MAKE_CANON = {
  'chevy': 'chevrolet', 'vw': 'volkswagen', 'benz': 'mercedes',
  'mercedes benz': 'mercedes', 'maybach': 'mercedes',
  'range rover': 'land rover',
};

/* The manufacturer named inside a free-text model string, or null. Longest
   match wins so "mercedes benz" beats "benz". */
function makeIn(text) {
  const s = ` ${norm(text)} `;
  let hit = null;
  for (const w of MAKE_WORDS) {
    if (s.includes(` ${w} `) && (!hit || w.length > hit.length)) hit = w;
  }
  return hit ? (MAKE_CANON[hit] || hit) : null;
}
/* How a manufacturer's name is written when it is shown back to a human. The
   handful that are initialisms would otherwise read as "Bmw". */
const MAKE_DISPLAY = { bmw: 'BMW', gmc: 'GMC', mg: 'MG', byd: 'BYD', vw: 'Volkswagen' };
const titleCase = m => MAKE_DISPLAY[m] || String(m || '').replace(/\b[a-z]/g, c => c.toUpperCase());

/* A source whose hostname IS a manufacturer's name — "toyota.ae", "lexus.com".
   This is not a guess about the market: it is the first label of the host read
   against the same manufacturer list the model strings are read against. When
   it hits, the price on the row is a factory list price for a new car, and
   calling that an undercut by a competitor is the specific wrong thing a rep
   would repeat to a customer. It only ever adds a caution. */
function oemHost(name) {
  const host = String(name == null ? '' : name).trim().toLowerCase().replace(/^www\./, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;   // not a hostname at all
  const label = norm(host.split('.')[0]);
  if (!label) return null;
  const hit = MAKE_WORDS.find(w => w === label || w.replace(/ /g, '') === label);
  return hit ? (MAKE_CANON[hit] || hit) : null;
}

/* A model string with the year and any manufacturer word taken out, so
   "Toyota Land Cruiser 2024" on one side can still find "Land Cruiser" on the
   other. This is a looser match than an identical string and is labelled as
   one wherever it is used. */
const YEAR_TOKEN = /^(19|20)\d{2}$/;
function coreKey(text) {
  const make = makeIn(text);
  let t = norm(text).split(' ').filter(w => w && !YEAR_TOKEN.test(w));
  if (make) {
    const drop = new Set([...MAKE_WORDS, ...Object.keys(MAKE_CANON)]
      .filter(w => MAKE_CANON[w] === make || w === make)
      .flatMap(w => w.split(' ')));
    const stripped = t.filter(w => !drop.has(w));
    if (stripped.length) t = stripped;
  }
  return t.join(' ');
}

/* A model name of the shape manufacturers reuse — one bare word ("Patrol"), or
   a short alphanumeric designation ("X5", "300", "Q7"). This is a heuristic
   about the string, not knowledge about the market: it only ever adds a
   caution, and it never removes one. */
function reusableName(key) {
  const t = String(key || '').split(' ').filter(Boolean);
  if (!t.length) return false;
  if (t.length === 1) return true;
  return t.every(w => /^[a-z]{0,2}\d{1,4}[a-z]?$/.test(w));
}

/* What the match IS. There is no make basis and no year basis, because there is
   no make column and no year column — the two that used to be listed here were
   unreachable and the one that was reachable described itself as the loose
   fallback from a make match that never happened. */
const BASIS = {
  model: { chip: 'model name',
    why: `Matched because our stock carries the same model name, character for character. ${NO_MAKE} Two cars sold under the same model name are the same row to this match, whoever built them. ${PRICE_UNCONSTRAINED}` },
  loose: { chip: 'model name · loose',
    why: `Matched on the model name only after a year, or a manufacturer word somebody typed into the text, was set aside — the two strings were not even identical. ${NO_MAKE}` },
  none:  { chip: 'no unit in stock',
    why: 'No unit on the lot carries this model name, so there is no price of ours to compare it against.' },
};

/* How far the match is from being the same car.

   `both` used to be described here as "as good as it gets on this data". It was
   not good at all: it fired when the manufacturer read out of their model text
   equalled the one read out of ours, and those are the same string, so it fired
   on every row and rendered the least alarming chip on the screen over the
   weakest possible evidence. Where the model text is our own — which is every
   row the scraper has ever written — the state is `circular` and `both` is
   unreachable. `both` is kept for the day the scraper stores the listing's own
   model text, because then it will mean something. */
const RISK = {
  circular: { chip: 'matched to itself', tone: 'hot',
    text: `${MODEL_IS_OURS} Both "manufacturers" below are that one string read twice, so they agree by construction and confirm nothing. ${PRICE_UNCONSTRAINED} What this row can support is "a page selling something under this name quotes that figure", and no more.` },
  mixed: { chip: 'make ambiguous', tone: 'hot',
    text: 'The units carrying this model name do not all name the same manufacturer, so this name is used by more than one make. The gap beside it may be measured against a different car entirely.' },
  onesided: { chip: 'make unconfirmed', tone: 'warm',
    text: 'Only one of the two model strings names a manufacturer; the other names none, so it could be any make that uses this model name.' },
  unnamed: { chip: 'make unknown', tone: 'warm',
    text: `No manufacturer is named on either side. ${NO_MAKE} If two makes share this model name, nothing on this screen can tell them apart and the gap may be a Nissan measured against a Toyota.` },
  both: { chip: 'make inferred', tone: '',
    text: 'Both model strings happen to name the same manufacturer. That is read out of free text, not out of a make column — there is none — so it is an inference, not a confirmation that these are the same car.' },
};
const REUSABLE_NOTE = ' The name is a single short designation of the kind manufacturers reuse, which makes a collision more likely rather than less.';

/* Rows that are not a competitor at all. Two of the fifteen rows in this table
   carry the literal string "null" where the dealership name belongs — a scraper
   that wrote the word instead of the value — and one carries "Pardon Our
   Interruption", which is the heading of a bot-detection interstitial: the
   scrape was blocked, captured the block page and stored its title as a rival
   dealership. All three carry no price. They are shown, because a scraper being
   blocked is worth knowing about, but they are shown as a data-quality fault and
   excluded from every count, every gap and every claim about the market here. */
const PLACEHOLDER_NAME = /^(null|undefined|nan|none|unknown|n\s*\/?\s*a|-{1,3}|\.)$/i;
const INTERSTITIAL = /(pardon our interruption|are you a robot|robot check|verify (?:you are|you're)|just a moment|attention required|access denied|checking your browser|enable javascript|captcha|cloudflare|unusual traffic|request blocked|too many requests|rate limit|forbidden|not found|error 4\d\d)/i;

function scrapeFault(name) {
  const s = String(name == null ? '' : name).trim();
  if (!s) return null;
  if (PLACEHOLDER_NAME.test(s)) {
    return { kind: 'placeholder',
      why: `The scraper stored the literal text "${s}" where the source belongs, so this row does not say what page it read or who is selling anything.` };
  }
  if (INTERSTITIAL.test(s)) {
    return { kind: 'interstitial',
      why: `"${s}" is the heading of a bot-detection page, not a source that sells cars. The scraper was blocked, captured the block page and stored its title as a competitor — so the listing it was sent to read was never read at all.` };
  }
  return null;
}

/* The first five are always offered. The rest exist so an alert has somewhere
   to land and are rendered only when they would match something — a filter chip
   reading "Scrape failures · 0" is a control that does nothing. */
const FILTERS = {
  ALL:    'All',
  ABOVE:  'We ask more',
  BELOW:  'We undercut',
  LEVEL:  'Level',
  NOSTOCK:'Not stocked',
  STALE:  'Not refreshed',
  NOPRICE:'No price',
  UNNAMED:'Make unknown',
  BROKEN: 'Scrape failures',
};
const ALWAYS_SHOWN = new Set(['ALL', 'ABOVE', 'BELOW', 'LEVEL', 'NOSTOCK']);
const SORTS = {
  above_first: 'Most overpriced first',
  below_first: 'Biggest undercut first',
  newest:      'Newest scrape first',
  oldest:      'Oldest scrape first',
  name:        'Competitor A–Z',
};

/* One competitor row, joined to the stock it can legitimately be compared with.
   Everything here is either a column Postgres returned or arithmetic over two
   of them; nothing is filled in when a side is missing. The join is a text match
   on `model` and nothing more — see BASIS above for why there is no other. */
function compare(r, index) {
  const model = cModel(r), price = cPrice(r);
  /* Inferred from the listing's own model text, never from a make column. */
  const theirMake = makeIn(model);
  const keyed = index.lookup(model);
  let units = keyed.units, basis = keyed.basis;
  let conflictNote = '';

  /* Two model strings that name two different manufacturers are not the same
     car. This is the only place the manufacturer list changes an outcome, and
     it can only ever take a unit out of a comparison. */
  if (units.length && theirMake) {
    const clash = units.filter(u => { const m = makeIn(uModel(u)); return m && m !== theirMake; });
    if (clash.length) {
      const named = [...new Set(clash.map(u => titleCase(makeIn(uModel(u)))))].join(', ');
      const many = clash.length !== 1;
      units = units.filter(u => !clash.includes(u));
      conflictNote = `${clash.length} unit${many ? 's' : ''} carrying this model name name${many ? '' : 's'} a different manufacturer in ${many ? 'their' : 'its'} own model text (${named}) than this listing does (${titleCase(theirMake)})`
        + (units.length
          ? `, so ${many ? 'they are' : 'it is'} left out of the comparison.`
          : ', so there is nothing left on the lot to compare this against.');
      if (!units.length) basis = 'none';
    }
  }

  /* A sold car is not a car we are pricing, and it is no longer allowed to set
     one. It used to stay in `units` when it was the only thing that matched, so
     `ourPrice`, the gap and both market KPIs were computed off a car that is
     not for sale, with a sub-line under the Match chip as the only disclosure.
     The units are still listed in the drawer — knowing what we got for the last
     one is worth something — but they set no gap, and the row falls into the
     same "no price of ours to compare" path every other unpriced row takes.
     All twelve units are Available today, so this is a guard for the first time
     a matched car sells rather than something visible now. */
  const onLot = units.filter(u => !isSold(u));
  const soldOnly = units.length > 0 && onLot.length === 0;
  if (onLot.length) units = onLot;

  /* The basis is settled after the sold and manufacturer filters have run, not
     before: a match that reached for the looser key but ends up comparing
     against units whose model string is identical is an exact match, and saying
     "loose" of it would be its own small untruth. */
  if (units.length) {
    basis = units.every(u => norm(uModel(u)) === keyed.exact) ? 'model' : 'loose';
  }

  const pricedUnits = units.filter(u => uPrice(u) != null);
  const prices = pricedUnits.map(uPrice);
  /* Several units of the same car rarely carry the same sticker. The shopper
     compares against the cheapest one we advertise, so that is the figure the
     gap is measured from; the spread is shown next to it. A sold-only match
     advertises nothing, so it has no "our price" at all. */
  const ourPrice = (!soldOnly && prices.length) ? Math.min(...prices) : null;
  const ourHigh = (!soldOnly && prices.length) ? Math.max(...prices) : null;
  const delta = (ourPrice != null && price != null) ? ourPrice - price : null;

  /* Which manufacturers, if any, the matched stock names in its own text. More
     than one means this model name is demonstrably shared across makes — and a
     single unit that names none is enough to stop the whole match claiming both
     sides are the same manufacturer, because that unit could be anybody's. */
  const ourMakes = [...new Set(units.map(u => makeIn(uModel(u))).filter(Boolean))];
  const anonUnits = units.filter(u => !makeIn(uModel(u))).length;
  /* The runtime evidence for MODEL_IS_OURS: this row's model text is, character
     for character, a model string out of our own inventory. That is what a
     round-tripped value looks like, and it is true of all eight rows on file.
     It is checked rather than assumed so that the day the scraper starts
     storing the listing's own text, this screen stops accusing it. */
  const echoed = index.isOurModelText(model);
  const risk = !units.length ? null
    : ourMakes.length > 1 ? 'mixed'
      /* Ordered above `both` on purpose: a manufacturer agreement drawn from
         one string read twice is not an agreement, and must never render the
         quietest chip on the screen. */
      : echoed ? 'circular'
        : (theirMake && ourMakes.length === 1 && ourMakes[0] === theirMake && !anonUnits) ? 'both'
          : (theirMake || ourMakes.length === 1) ? 'onesided'
            : 'unnamed';

  const name = cName(r);
  return {
    raw: r, id: pick(r, ['id']), name, model, price,
    fault: scrapeFault(name),
    /* Set when the source's hostname is a manufacturer's own domain, which is
       every row on file: the figure beside it is a factory list price. */
    oem: oemHost(name),
    echoed,
    theirMake, ourMakes, risk, reusable: reusableName(keyed.key), conflictNote,
    /* A gap whose match cannot rule out another manufacturer, or whose match is
       circular and so rules out nothing at all. Today that is every gap on the
       screen, and the filter chip counting them says so. */
    makeUnconfirmed: risk != null && risk !== 'both',
    label: String(model == null ? '' : model).trim() || 'Unnamed vehicle',
    at: cAt(r),
    storedOur: n0(pick(r, ['our_price_aed'])),
    storedDiff: n0(pick(r, ['price_diff_aed'])),
    rec: pick(r, ['ai_recommendation', 'recommendation', 'notes']),
    units, pricedUnits, unmatched: units.length === 0,
    basis: units.length ? basis : 'none',
    soldOnly, ourPrice, ourHigh, delta,
    deltaPct: (delta != null && price) ? (delta / price) * 100 : null,
  };
}

/* Two keys off the one column there is. The exact one is the model string as
   stored; the core one is that string with a year and any manufacturer word
   taken out, so "Toyota Land Cruiser 2024" can still find "Land Cruiser". The
   second is a looser claim than the first and is reported as one — it is not a
   make match, because there is no make on either side to match. */
function buildIndex(inv) {
  const byModel = new Map(), byCore = new Map();
  const add = (map, key, u) => { if (!key) return; if (!map.has(key)) map.set(key, []); map.get(key).push(u); };
  inv.forEach(u => {
    add(byModel, norm(uModel(u)), u);
    add(byCore, coreKey(uModel(u)), u);
  });
  return {
    /* Does this string appear in `inventory.model` exactly as stored? The
       scraper writes our own model text back into `competitors.model`, so a hit
       here is the signature of that round trip rather than of a listing that
       happens to be named the same way. It is a weaker statement than the
       workflow proof in MODEL_IS_OURS — a real scrape could in principle return
       the identical string — which is why the wording it drives says what the
       row cannot support, not what the scraper did. */
    isOurModelText: model => { const k = norm(model); return !!k && byModel.has(k); },
    /* Both sets, not the first one that hits. "Patrol" and "Nissan Patrol" are
       one model name written two ways, and taking only the identical-string
       match would have compared a scraped Patrol against the one sold unit
       whose text happens to be bare while ignoring the one on the lot. The
       basis stays 'model' only when every unit matched the string exactly;
       the moment a unit needed a word taken out of it, the whole match is
       reported as the looser thing it is. */
    lookup(model) {
      const exact = norm(model), core = coreKey(model);
      const hit = byModel.get(exact) || [];
      const loose = byCore.get(core) || [];
      const units = [...new Set([...hit, ...loose])];
      if (!units.length) return { units: [], basis: 'none', key: core || exact, exact };
      return {
        units,
        basis: hit.length === units.length ? 'model' : 'loose',
        key: core || exact,
        exact,
      };
    },
  };
}

const deltaCell = c => {
  if (c.delta == null) {
    const why = c.unmatched ? (c.conflictNote || BASIS.none.why)
      : c.soldOnly ? 'The only unit carrying this model name is sold, so we have no list price to compare against it.'
        : c.price == null ? 'This row has no competitor price recorded.'
          : 'The matching unit has no list price on record.';
    return `<span class="t-muted" title="${esc(why)}">—</span>`;
  }
  if (c.delta === 0) return '<span class="t-muted">level</span>';
  const worse = c.delta > 0;
  /* The tooltip carries the three things the number itself cannot: when their
     price was collected, what the two cars were matched on, and what their
     figure is a price OF. The last one is why a gap this large exists at all. */
  const why = `Our ${aed(c.ourPrice)} (list price today) against their ${aed(c.price)}, collected `
    + (c.at ? dt(c.at) : 'on a date this row does not record')
    + `. Matched on the model name "${c.label}" alone`
    + (c.echoed ? ' — and that name is our own text, written back by the scraper, so the match confirms nothing. ' : c.makeUnconfirmed ? ', with no make recorded on either side. ' : '. ')
    + PRICE_UNCONSTRAINED
    + (c.oem ? ` ${c.name} is ${titleCase(c.oem)}'s own site, so this is a factory list price for a new car.` : '');
  return `<span class="${worse ? 't-hot' : 't-ok'}" style="font-weight:500"
      title="${esc(why)}">
      <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px" aria-hidden="true">${worse ? 'arrow_upward' : 'arrow_downward'}</span>
      ${aedSigned(c.delta)}</span>
    ${c.deltaPct == null ? '' : `<div class="cell-sub">${pct(Math.abs(c.deltaPct))} ${worse ? 'above' : 'below'} theirs</div>`}`;
};

/* The obvious answer to "these prices are old" is "run the scrape again", and
   there is no way to do that from here: the competitors table is written by a
   scheduled workflow with no webhook in the HOOK map, so the control is rendered
   disabled and says what is missing rather than being left off the screen — an
   absent button reads as "not possible", a disabled one as "not wired yet". */
const NO_SCRAPE_HOOK = {
  label: 'Re-run scrape',
  why: 'No webhook exists for the price scrape. The competitors table is written by a scheduled workflow that has no manual trigger in the HOOK map, so it cannot be re-run from the browser.',
};

/* Icons for the kinds `v_needs_attention` routes to this screen. `undercut` is
   the only one it emits today; anything it grows later still renders, with a
   generic icon rather than nothing. */
const KIND_ICON = { undercut: 'trending_down', price_stale: 'update_disabled' };

/* The private severity map this screen used to keep is gone. `tone()` in
   lib/format.js now carries every vocabulary that reaches here — HOT/WARM/COLD,
   CRITICAL/WARNING/HEALTHY, HIGH/MEDIUM/LOW/INFO and the workflow-health words
   — and gives anything it does not recognise its own 'unknown' tone rather
   than ''. One preference is still local, and only one: a severity nobody here
   has seen, arriving from a shared view this screen does not own, is more
   useful shown as a warning than as a note nobody looks at.

   That test used to be a regex, because tone() answered 'cold' both for a
   genuinely cold item and for a word it had never heard of, and this screen had
   to tell those two apart by hand. tone() now makes the distinction itself, so
   the regex is gone and a real COLD stays cold. */
const sevTone = s => {
  const t = tone(s);
  if (!t) return '';                 // genuinely blank severity — say nothing
  return t === 'unknown' ? 'warm' : t;
};

SCREENS.competitors = async host => {
  /* The alert strip is appended before the KPI row on purpose. The first thing
     an operator needs from this screen is not a count of undercuts, it is how
     old the prices behind that count are — so the freshness statement is the
     header of the topmost card and cannot be scrolled past. */
  const alertHost = el('div'); host.appendChild(alertHost);

  const strip = el('div', 'grid g5'); strip.innerHTML = stateLoading(2); host.appendChild(strip);
  const body = el('div'); body.style.marginTop = '16px'; host.appendChild(body);
  body.innerHTML = `<div class="card flush">${stateLoading(8)}</div>`;
  const below = el('div', 'grid g2 top'); below.style.marginTop = '16px'; host.appendChild(below);
  const byCompHost = el('div'); const blindHost = el('div');
  below.appendChild(byCompHost); below.appendChild(blindHost);

  /* Four reads, started together rather than one after another. Inventory and
     the attention view used to wait on the competitors fetch for no reason; on
     a single-core box that is two round-trips of dead time. All are marked
     handled the moment they are created — if the competitors read fails first
     and this function returns, a rejection with no handler surfaces in the
     console instead of in the panel that is supposed to report it. */
  const invP = db('inventory?select=*&limit=1000');
  const attnP = db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen'
    + `&screen=eq.competitors&limit=${ATTN_LIMIT}`);
  /* The scrape's own health, from the shared view, because this screen is not
     entitled to infer it. Rows arriving used to be taken as proof the job was
     working — "the scrape is still writing rows, so this is not the job being
     down" — and the view's answer is PRODUCING_NOTHING: it runs, it does not
     fail, and most runs end with no usable price. The columns the view already
     computes are read as they are; nothing here classifies a status itself. */
  const healthP = db('v_workflow_health?select=name,trigger_detail,health,runs_30d,successes_30d,'
    + `no_result_30d,failures_30d,partials_30d,effective_runs_30d,success_rate_30d,last_run,last_success&name=eq.${encodeURIComponent(SCRAPE_WORKFLOW)}`);
  invP.catch(() => {}); attnP.catch(() => {}); healthP.catch(() => {});

  /* Ordering is deliberately left to the client. The competitors feed is
     written by a scraping workflow and the column set has changed before;
     ordering server-side on a column that has been renamed returns a 400 and
     takes the whole screen down, while sorting here cannot. */
  let rows = [];
  try { rows = await db(`competitors?select=*&limit=${ROW_LIMIT}`); }
  catch (e) {
    strip.remove(); below.remove(); alertHost.remove();
    body.innerHTML = `<div class="card">${stateError('competitor pricing', e.message, 'competitors')}</div>`;
    body.querySelector('[data-retry]')?.addEventListener('click', () => go('competitors'));
    return;
  }

  /* Inventory is a second, independent failure. Losing it costs the deltas, not
     the screen — the scraped prices are still worth seeing, so the comparison
     columns say why they are blank instead of the page showing an error. */
  let inv = [], invErr = null;
  try { inv = (await invP).map(deriveUnit); }
  catch (e) { invErr = e; }

  /* The shared attention view is an enrichment too. Its failure costs the
     centrally-raised alerts, not the locally-derived ones, and the strip says
     which half is missing rather than showing a shorter list as if complete. */
  let attn = null, attnErr = null;
  try { attn = await attnP; }
  catch (e) { attnErr = e; }

  /* Health is the third enrichment. A missing row is not a healthy job: the
     registry may simply not carry this workflow under that name, and that is
     said rather than being allowed to read as silence. */
  let health = null, healthErr = null;
  try { health = (await healthP)[0] || null; }
  catch (e) { healthErr = e; }

  /* The health view's own words for the state it reports. Never derived here —
     lib/health.js mirrors nexus_outcome_class() in Postgres, and this screen is
     a consumer of both. */
  const hWords = health ? healthWords(health.health) : null;
  const noResult30 = health ? (n0(health.no_result_30d) || 0) : 0;
  const runs30 = health ? (n0(health.runs_30d) || 0) : 0;
  const success30 = health ? (n0(health.successes_30d) || 0) : 0;
  /* One sentence about the job itself, for wherever this screen would otherwise
     be tempted to conclude something about it from the rows in front of it. */
  const healthLine = healthErr
    ? `The scrape's health could not be read (${esc(healthErr.message)}), so nothing on this screen says whether the job is working — only what it has written.`
    : !health
      ? `v_workflow_health carries no row named "${esc(SCRAPE_WORKFLOW)}", so how the scrape itself is doing is unknown here — the rows below are all this screen can speak for.`
      : `v_workflow_health rates the scrape ${esc(hWords.label)} — ${esc(hWords.blurb)}${runs30 ? ` ${num(runs30)} ${plural(runs30, 'run', 'runs')} in 30 days, ${num(success30)} ${plural(success30, 'success', 'successes')}, ${num(noResult30)} producing no usable price.` : ''}`;
  /* The registry's recorded schedule against the one the workflow is running.
     They disagree today — the registry says a single daily cron — and a
     schedule nobody has updated is how the wrong hour got onto this screen in
     the first place, so the disagreement is reported rather than resolved. */
  const regHours = health ? registryHoursUtc(health.trigger_detail) : null;
  const scheduleDrift = regHours && regHours.join(',') !== SCRAPE_HOURS_UTC.join(',')
    ? `workflow_registry records this job's trigger as "${esc(String(health.trigger_detail))}" — ${num(regHours.length)} ${plural(regHours.length, 'run', 'runs')} a day, where the deployed cron is "${esc(SCRAPE_CRON)}" in Asia/Dubai and audit_log carries runs at both hours. The schedule stated here follows the deployed cron; the registry entry is out of date.`
    : '';

  const index = buildIndex(inv);
  const all = rows.map(r => compare(r, index));
  const reload = () => go('competitors');

  /* Rows the scraper produced that are not competitors — a name of "null", or
     the title of a bot-detection page. They are held apart from here down.
     `junk` is reported as a data-quality fault and is reachable through its own
     filter, never charted as a rival source. */
  const junk = all.filter(c => c.fault);
  const snapshots = all.filter(c => !c.fault);
  const junkPriced = junk.filter(c => c.price != null).length;

  const dated = c => !!(c.at && !Number.isNaN(Date.parse(c.at)));

  /* ── Snapshots to listings ───────────────────────────────────────────────
     `competitors` is an append-only log. The scraper's `Log Competitor Intel`
     node carries no `operation` key, so the Supabase node defaults to `create`
     and every run inserts a new row; nothing upserts on the listing. Eight rows
     on file are three listings, scraped repeatedly.

     Every count on this screen used to be taken straight off those rows, which
     is how "We ask more · 4" and "We undercut · 4" came to sit beside a
     subtitle correctly reading 3 vehicles — 4 + 4 > 3. It grows without bound:
     at two runs a day the 500-row cap arrives in about a month, after which
     every headline is a function of how long the job has been up rather than of
     the market.

     So `live` is one row per listing — the newest snapshot of each — and it is
     what every KPI, filter, group, gap and market claim below is computed from.
     `snapshots` is kept for the two questions where the history IS the subject:
     how long a listing has gone without being covered, and what the drawer can
     show about a price that has or has not moved. A listing is keyed on the
     pair the scraper actually writes, source and model text. */
  const listingKey = c => `${norm(c.name)} :: ${norm(c.model)}`;
  const historyOf = new Map();
  snapshots.forEach(c => {
    const k = listingKey(c);
    if (!historyOf.has(k)) historyOf.set(k, []);
    historyOf.get(k).push(c);
  });
  const live = [];
  historyOf.forEach(rowsOfListing => {
    /* Newest wins. An undated row can only be the representative of a listing
       that has no dated row at all, in which case its age is unknown and the
       undated-rows check downstream is the one that reports it. */
    rowsOfListing.sort((a, b) => (dated(b) ? Date.parse(b.at) : -Infinity) - (dated(a) ? Date.parse(a.at) : -Infinity));
    const current = rowsOfListing[0];
    current.history = rowsOfListing;
    current.snapshotCount = rowsOfListing.length;
    live.push(current);
  });
  const supersededCount = snapshots.length - live.length;

  /* Freshness is read off the current listings only: a scrape failure carries
     no price, so letting one set the "newest price collected" clock would date
     the screen by a row that priced nothing. */
  const stamped = live.filter(dated);
  const newest = stamped.length ? stamped.reduce((a, c) => (Date.parse(c.at) > Date.parse(a.at) ? c : a)).at : null;
  const oldest = stamped.length ? stamped.reduce((a, c) => (Date.parse(c.at) < Date.parse(a.at) ? c : a)).at : null;
  const ageHours = newest ? (Date.now() - Date.parse(newest)) / 3600000 : null;
  const stale = ageHours != null && ageHours > STALE_AFTER_HOURS;
  const daysOld = ageHours == null ? null : Math.floor(ageHours / 24);
  const veryStale = daysOld != null && daysOld >= VERY_STALE_DAYS;
  /* Scheduled runs that have been and gone since the newest row was written.
     Counted off the real fire times rather than divided by a cadence, and named
     for what it is: these runs were due, and none of them left a row. Whether
     they fired at all is what `healthLine` answers — today they did, and
     produced nothing, which the old "missed about N cycles" wording asserted
     the opposite of. */
  const dryRuns = newest ? cyclesSince(Date.parse(newest)) : null;

  /* The sentence this screen exists to make impossible to miss. It renders
     whether the prices are fresh or not: "collected 2 hours ago" is as much a
     part of an honest comparison as "collected 43 days ago". */
  const freshLine = !newest
    ? 'No row here carries a scrape timestamp, so how old these prices are cannot be established at all.'
    : `Newest price collected ${esc(ago(newest))} (${esc(dt(newest))})`
      + (oldest && oldest !== newest ? `, oldest ${esc(ago(oldest))} (${esc(dt(oldest))})` : '')
      + `. The scrape runs ${SCRAPE_SCHEDULE}`
      + (dryRuns ? `, so ${num(dryRuns)} scheduled ${plural(dryRuns, 'run has', 'runs have')} come and gone since without leaving a row.` : '.');

  /* ── Nothing to compare ──────────────────────────────────────────────────
     On 24 Aug 2026 this table was emptied, and an empty competitors table is
     now the screen's ordinary state rather than an edge case: twelve of the
     fifteen rows were seed prices whose `our_price_aed` contradicted the stock
     we actually hold, and the other three were the scrape failures described
     above. So this branch is not a placeholder — it is the screen — and it has
     to answer four questions in order: what is empty, why it is empty, when it
     fills again, and what the rows will and will not be able to prove when
     they arrive.

     Every guard above still runs on whatever the scrape writes next; with no
     rows each of them simply has nothing to report, and reports nothing at all
     rather than a card with a heading and blank space under it. The one panel
     that still has something real to say is the blind spot — our own unsold
     stock, none of which has a market price against it — so that is what the
     screen leads with instead of five zeroes. */
  if (!all.length || !live.length) {
    /* "By competitor" is a summary of sources; with no sources it would be a
       titled card containing an empty state, which is the thing this round is
       meant to remove. It is not rendered at all, and the panel that is left
       takes the full width rather than sitting in half a two-column grid. */
    byCompHost.remove();
    below.className = 'grid top';

    const allJunk = all.length > 0;      // rows came back, none of them usable
    const next = nextScrape();
    const nextLine = `The scrape is a scheduled job, running ${SCRAPE_SCHEDULE}. The next run is due ${esc(dt(next.toISOString()))}, ${esc(waitWord(next - Date.now()))}.`;
    /* The reason for six weeks of silence, stated in the empty state rather
       than in a commit message: the trigger was an n8n "every 24 hours"
       interval, which drifts on every restart and eventually stops firing
       without ever failing, so nothing errored and nothing ran. */
    /* The literal 24 is history, not the current cadence: the interval that
       drifted really was a 24-hour one. It is deliberately not derived from
       SCRAPE_EVERY_HOURS, which now describes the cron that replaced it. */
    const cronLine = 'Its trigger used to be an n8n "every 24 hours" interval, which drifts on restart and then stops firing without failing — which is why nothing refreshed for weeks and no run was ever recorded as broken. It is on a cron now.';

    /* Unsold stock, and the honest reason none of it has a market reference.
       This is not "we checked and found no cheaper rival": nothing has been
       checked at all, and the panel says so in those words. */
    const unsold = invErr ? [] : inv.filter(u => !isSold(u));
    const uncovered = [...unsold].sort((a, b) => (n0(b.days_in_stock) || 0) - (n0(a.days_in_stock) || 0));
    const agedUnits = uncovered.filter(u => (n0(u.days_in_stock) || 0) >= AGING_DAYS);
    const criticalUnits = uncovered.filter(u => String(u.aging_alert || '').toUpperCase() === 'CRITICAL');
    const listValue = uncovered.reduce((a, u) => a + (uPrice(u) || 0), 0);
    const soldHeld = invErr ? 0 : inv.length - unsold.length;

    strip.className = 'grid g3';
    strip.innerHTML = [
      kpi('Competitor prices on file', num(live.length),
        allJunk
          ? `<span class="t-hot">${num(all.length)} ${plural(all.length, 'row was', 'rows were')} returned and every one is a scrape failure, not a listing</span>`
          : '<span class="t-muted">The table holds no rows at all — nothing has been scraped since it was cleared</span>'),
      /* The hour, from the one place the schedule is defined. It used to read
         05:00 UTC and resolve to 09:00 GST, which is an hour this job has never
         fired at — an operator told to come back then came back to nothing. */
      kpi('Next scrape due', `${String(next.getUTCHours()).padStart(2, '0')}:00 UTC`,
        `<span class="t-muted">${esc(dt(next.toISOString()))} · ${esc(waitWord(next - Date.now()))}</span>`),
      /* A count, not a proportion. Twelve units is a small enough number to
         state outright, and "100% of stock uncovered" would dress a plain fact
         up as a metric. */
      kpi('Our stock with no market price', invErr ? '—' : num(uncovered.length),
        invErr
          ? '<span class="t-hot">Inventory did not load, so our own stock could not be listed</span>'
          : uncovered.length
            ? `<span class="t-warm">Every unsold unit we hold${soldHeld ? `, and ${num(soldHeld)} sold ${plural(soldHeld, 'unit is', 'units are')} not counted` : ''}</span>`
            : '<span class="t-muted">No unsold unit is on the lot</span>'),
    ].join('');

    /* ── The alert strip, with nothing filed ──────────────────────────────
       v_needs_attention returns no row for this screen today. That is a
       result, and it is said in a sentence — an empty box under a "Needs
       attention" heading would read as a panel that failed to load, and it
       would leave the operator wondering where five undercut alerts went. */
    const emptyAlerts = [];
    if (attnErr) {
      emptyAlerts.push({
        tone: 'hot', icon: 'error',
        title: 'The shared alert view did not load',
        detailHtml: `${esc(attnErr.message)} — so whether anything is filed centrally against this screen is unknown, not zero. The line above is what this screen can see for itself.`,
      });
    } else if ((attn || []).length) {
      /* A row filed against a table with nothing in it is a real contradiction
         and is worth more than a shrug: the view saw prices this screen
         cannot. */
      emptyAlerts.push({
        source: 'view', tone: 'warm', icon: 'rule',
        title: `${num(attn.length)} ${plural(attn.length, 'alert is', 'alerts are')} filed against this screen, with no price behind ${plural(attn.length, 'it', 'them')}`,
        detailHtml: `v_needs_attention still returns ${plural(attn.length, 'this row', 'these rows')} for screen = competitors, but the competitors table returned ${allJunk ? 'nothing usable' : 'nothing at all'}, so ${plural(attn.length, 'it cannot', 'none of them can')} be shown against the price ${plural(attn.length, 'it was', 'they were')} raised on: ${esc((attn || []).map(it => it.title || 'untitled').join('; '))}.`,
      });
    } else {
      emptyAlerts.push({
        tone: 'ok', icon: 'task_alt',
        title: 'Nothing is filed against this screen',
        detailHtml: 'v_needs_attention returns no row where screen = competitors. The undercut alerts it carried until tonight were each computed from a seed price that has now been deleted, so they were withdrawn with the data rather than worked through — nothing was fixed and nothing is outstanding.',
      });
    }

    if (allJunk) {
      const blocked = junk.filter(c => c.fault.kind === 'interstitial');
      emptyAlerts.push({
        tone: 'hot', icon: 'bug_report',
        title: `${num(junk.length)} scraped ${plural(junk.length, 'row is', 'rows are')} not a competitor`,
        detailHtml: `${esc(junk.map(c => c.name).join(', '))} — ${esc(junk.map(c => c.fault.why).join(' '))} ${blocked.length ? 'The scrape was blocked and stored the block page instead of the listing, so this feed is quietly missing whatever that run was sent to collect. ' : ''}${junkPriced ? '' : 'None of them carries a price. '}They are held out of every count here, which is why "Competitor prices on file" reads ${num(live.length)} rather than ${num(all.length)}.`,
      });
    }

    if (invErr) {
      emptyAlerts.push({
        tone: 'hot', icon: 'error',
        title: 'Our own stock did not load either',
        detailHtml: `${esc(invErr.message)} — so the one question this screen can still answer today, which of our cars has no market price against it, could not be answered.`,
      });
    } else if (uncovered.length) {
      emptyAlerts.push({
        tone: criticalUnits.length ? 'hot' : 'warm', icon: 'price_check',
        title: `All ${num(uncovered.length)} unsold ${plural(uncovered.length, 'unit is', 'units are')} priced with no market reference`,
        detailHtml: `Not one of them has ever been checked against a rival price, and with the table empty none can be. If a competitor undercut any of them today nothing on this screen would show it.${agedUnits.length ? ` ${num(agedUnits.length)} ${plural(agedUnits.length, 'has', 'have')} been in stock ${AGING_DAYS} days or more${criticalUnits.length ? `, ${num(criticalUnits.length)} flagged CRITICAL` : ''}.` : ''}${listValue ? ` Together they list at ${esc(aed(listValue))}.` : ''}`,
        act: 'blind', actLabel: 'See the list',
      });
    }

    const emptyItem = (a, i) => `<div class="list-item"${a.act ? ` role="button" tabindex="0" data-empty="${i}"` : ' style="cursor:default"'}>
      <span class="material-symbols-outlined t-${esc(a.tone)}" style="font-size:20px" aria-hidden="true">${esc(a.icon)}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500">${esc(a.title)}</div>
        <div class="cell-sub" style="white-space:normal">${a.detailHtml}</div>
      </div>
      ${a.act ? `<div class="cell-sub t-muted" style="flex-shrink:0">${esc(a.actLabel || 'Open')}</div>
      <span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">chevron_right</span>` : ''}
    </div>`;

    /* An item whose tone is 'ok' is a statement, not a task — "nothing is filed
       against this screen" is worth a line but must not inflate a count of
       things needing a human. */
    const actionable = emptyAlerts.filter(a => a.tone !== 'ok').length;
    const fromView = emptyAlerts.filter(a => a.source === 'view').length;
    alertHost.innerHTML = `<div class="card flush" style="margin-bottom:16px">
      <div class="card-head"><div style="min-width:0">
        <div class="card-title">${actionable ? `Needs attention · ${num(actionable)}` : 'Nothing on this screen needs a human right now'}</div>
        <div class="card-sub t-warm" style="white-space:normal">${allJunk
          ? `Not one row the scrape wrote is a listing${junkPriced ? '' : ', and not one carries a price'}, so there is no comparison on this screen to be old or new.`
          : `No price has been collected since the competitors table was cleared, so there is no comparison on this screen to be old or new.`} ${nextLine}</div>
      </div></div>
      <div>${emptyAlerts.map(emptyItem).join('')}</div>
      <div class="list-item" style="cursor:default">
        <span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">info</span>
        <div class="cell-sub" style="white-space:normal">${attnErr
          ? 'Nothing could be read from v_needs_attention.'
          : `${num((attn || []).length)} ${plural((attn || []).length, 'row', 'rows')} from v_needs_attention where screen = competitors${(attn || []).length ? '' : ' (it returned none for this screen)'}, and ${num(emptyAlerts.length - fromView)} ${plural(emptyAlerts.length - fromView, 'line', 'lines')} written here off ${num(all.length)} scraped ${plural(all.length, 'row', 'rows')} and ${invErr ? 'no inventory rows' : `${num(inv.length)} inventory ${plural(inv.length, 'row', 'rows')}`}.`}
          The checks that run on scraped rows — what each match is matched on, rows the last scrape did not refresh, rows that are not a dealership at all, sources that sent no price — have no rows to run against and are absent from this list rather than sitting in it at zero.</div>
      </div></div>`;

    /* ── The empty state proper ───────────────────────────────────────────── */
    body.innerHTML = `<div class="card flush">
      <div class="card-head"><div style="min-width:0"><div class="card-title">Price comparison</div>
        <div class="card-sub" style="white-space:normal">When the scrape has run, every collected price appears here against the cheapest unit we hold whose model name matches, with the date it was collected on the row.</div></div></div>
      ${stateEmpty(
        allJunk ? 'No usable competitor prices' : 'No competitor prices on file',
        allJunk
          ? `The scrape wrote ${all.length} ${plural(all.length, 'row', 'rows')} and not one of them names a source that sells cars or carries a price, so there is no market price to compare our stock against. Until the scraper gets past whatever is blocking it, this screen has nothing to compare.`
          : 'The competitors table is empty, so there is nothing to compare our prices against. It is not that our stock came out level — no rival price has been collected at all.',
        'price_change')}
      <div style="padding:0 20px 8px;max-width:760px;margin:0 auto">
        <div class="label-caps">${allJunk ? 'What was in this table before' : 'Why it is empty'}</div>
        <div class="cell-sub" style="white-space:normal;margin-top:8px">The fifteen rows this table held until 24 August were deleted. Twelve were seed prices that contradicted the stock we actually hold — one quoted a Land Cruiser at AED 290,000 against a list price of AED 385,000, and four of them named models that have never been on the lot at all — and the remaining three were scrape failures stored as dealerships. Every undercut this screen reported, including the five it fed to Overview, was computed from those rows, so all of them went when the rows did.</div>

        <div class="label-caps" style="margin-top:18px">When it fills</div>
        <div class="cell-sub" style="white-space:normal;margin-top:8px">${nextLine} ${cronLine} A run that collects nothing writes nothing, so if this screen still reads empty after that hour the job is worth checking rather than the market. ${healthLine}${scheduleDrift ? ` ${scheduleDrift}` : ''}</div>

        <div class="label-caps" style="margin-top:18px">What the rows will be able to prove</div>
        <div class="cell-sub" style="white-space:normal;margin-top:8px">Less than it looks. ${esc(NO_MAKE)} A gap on this screen therefore says "a car called this costs that much elsewhere", not "the same car costs that much elsewhere", and each row will carry a chip saying which of those it is. The scrape also has no listing contact and no model year to offer, and when it is blocked it stores the block page as a dealership — rows like that are set aside as the data-quality fault they are and counted in nothing.</div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 24px">
          <button class="btn sm" disabled title="${esc(NO_SCRAPE_HOOK.why)}">${esc(NO_SCRAPE_HOOK.label)}</button>
          <button class="btn sm" id="cInvEmpty">Open Inventory</button>
        </div>
      </div></div>`;
    $('cInvEmpty').addEventListener('click', () => go('inventory'));

    /* The blind-spot panel is the only one with a real answer today, so it is
       rendered even here — and with its own wording, because "no scraped row
       matches this unit" would imply a comparison that never happened. */
    const blind = await panel(blindHost, {
      title: 'Stock with no market reference',
      sub: 'Unsold units with no competitor price against them. With the competitors table empty this is every one of them: they are priced on instinct, not on evidence.',
      actions: '<button class="btn sm" data-act="inv">Open Inventory</button>',
      load: async () => { if (invErr) throw invErr; return uncovered; },
      render: units => (units.length ? `<div>${units.slice(0, BLIND_LIMIT).map((u, i) => `
        <div class="list-item" role="button" tabindex="0" data-unit="${i}" style="align-items:flex-start">
          <span class="material-symbols-outlined t-muted" style="font-size:20px" aria-hidden="true">price_check</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:500">${esc(uModel(u) || 'Unnamed unit')}</div>
            <div class="cell-sub mono">${esc(String(uRef(u) ?? '—'))}</div>
            <div class="cell-sub">${esc(String(u.status || 'status unknown'))}${String(u.aging_alert || '').toUpperCase() === 'CRITICAL' ? ' · <span class="t-hot">CRITICAL</span>' : ''}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="num">${uPrice(u) == null ? '<span class="t-muted">no list price</span>' : aed(uPrice(u))}</div>
            <div class="cell-sub">${n0(u.days_in_stock) == null ? 'no acquisition date' : `${num(u.days_in_stock)} days in stock`}</div>
          </div></div>`).join('')}
        <div class="list-item" style="cursor:default">
          <span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">info</span>
          <div class="cell-sub" style="white-space:normal">${units.length > BLIND_LIMIT ? `Showing the ${num(BLIND_LIMIT)} longest in stock of ${num(units.length)}. ` : ''}Ordered by how long each unit has been on the lot. Clicking one opens its price form — the only price on this screen that is ours to change. ${listValue ? `${units.length > BLIND_LIMIT ? 'All' : 'The'} ${num(units.length)} together list at ${esc(aed(listValue))}.` : ''}</div>
        </div></div>`
        : stateEmpty('No unsold stock on the lot',
          'Every unit in inventory is marked sold, so there is nothing whose price a competitor could undercut.', 'price_check')),
    });
    blind.querySelector('[data-act="inv"]')?.addEventListener('click', () => go('inventory'));
    const openUnit = i => { const u = uncovered[Number(i)]; if (u) unitForm(u, inv, reload); };
    blind.querySelectorAll('[data-unit]').forEach(node => {
      node.addEventListener('click', () => openUnit(node.dataset.unit));
      node.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openUnit(node.dataset.unit); }
      });
    });

    /* The one alert that can be followed here scrolls to that panel. */
    alertHost.querySelectorAll('[data-empty]').forEach(node => {
      const jump = () => {
        blind.scrollIntoView({ behavior: 'smooth', block: 'start' });
        blind.style.background = 'var(--primary-subtle)';
        setTimeout(() => { blind.style.background = ''; }, 2200);
      };
      node.addEventListener('click', jump);
      node.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
      });
    });
    return;
  }

  /* ── Headline figures. Every one is a count or a difference of two stored
     prices; where a side is missing the row is excluded and said so. ─────── */
  const comparable = live.filter(c => c.delta != null);
  const above = comparable.filter(c => c.delta > 0);
  const level = comparable.filter(c => c.delta === 0);
  const belowMkt = comparable.filter(c => c.delta < 0);
  const notStocked = live.filter(c => c.unmatched);
  const worstAbove = above.length ? above.reduce((a, c) => (c.delta > a.delta ? c : a)) : null;
  const bestBelow = belowMkt.length ? belowMkt.reduce((a, c) => (c.delta < a.delta ? c : a)) : null;
  const competitorCount = new Set(live.map(c => norm(c.name)).filter(Boolean)).size;
  const modelCount = new Set(live.map(c => norm(c.label)).filter(Boolean)).size;
  /* Gaps whose match cannot rule out a different manufacturer, and the harder
     case: a model name our own stock demonstrably uses across two makes. */
  const gapRows = comparable;
  const unconfirmed = gapRows.filter(c => c.makeUnconfirmed);
  const mixedRows = gapRows.filter(c => c.risk === 'mixed');
  const reusableRows = unconfirmed.filter(c => c.reusable);
  const staleNote = stale && daysOld != null
    ? ` Measured against prices ${dayWord(daysOld)} old.` : '';
  const capped = all.length >= ROW_LIMIT;

  strip.innerHTML = [
    kpi('Scraped prices', num(live.length),
      `${num(competitorCount)} competitor${competitorCount === 1 ? '' : 's'} · ${num(modelCount)} vehicle${modelCount === 1 ? '' : 's'}${capped ? ` · capped at ${num(ROW_LIMIT)} rows` : ''}`
      + (junk.length ? ` · <span class="t-hot">${num(junk.length)} more ${plural(junk.length, 'row is', 'rows are')} a scrape failure, not a dealership</span>` : '')),
    /* When inventory did not load nothing could be compared, so the honest
       value is "—", not the zero that arithmetic over an empty list produces.
       A zero here reads as "we checked and found none". */
    kpi('Comparable to our stock', invErr ? '—' : num(comparable.length),
      invErr
        ? '<span class="t-hot">Inventory did not load, so no comparison could be made</span>'
        : `<span class="t-muted">${num(notStocked.length)} not stocked · ${num(live.length - comparable.length - notStocked.length)} missing a price</span>`
          + (unconfirmed.length ? ` <span class="t-warm">· ${num(unconfirmed.length)} matched on model name only</span>` : '')),
    kpi('We ask more', invErr ? '—' : num(above.length),
      invErr
        ? '<span class="t-hot">Not counted — our own prices are unknown</span>'
        : above.length
          ? `<span class="t-hot">Worst ${aedSigned(worstAbove.delta)} on ${esc(worstAbove.label)}</span>${esc(staleNote)}`
          : comparable.length ? '<span class="t-ok">No matched unit is above its scraped market price</span>' : '',
      above.length && !invErr ? 't-hot' : ''),
    kpi('We undercut', invErr ? '—' : num(belowMkt.length),
      invErr
        ? '<span class="t-hot">Not counted — our own prices are unknown</span>'
        : bestBelow
          ? `<span class="t-ok">Best ${aedSigned(bestBelow.delta)} on ${esc(bestBelow.label)}</span>${esc(staleNote)}`
          : `<span class="t-muted">${num(level.length)} priced level</span>`),
    /* Stated in days rather than through ago(), which collapses everything past
       a month into "1 mo ago" — the exact rounding this KPI must not do. */
    kpi('Prices collected', newest ? (daysOld >= 1 ? `${dayWord(daysOld)} ago` : ago(newest)) : '—',
      newest
        ? (stale
          ? `<span class="t-hot">Missed about ${num(missed)} ${plural(missed, 'cycle', 'cycles')}</span> <span class="t-muted">· ${esc(dt(newest))}</span>`
          : `<span class="t-muted">${esc(dt(newest))}</span>`)
        : '<span class="t-muted">No row carries a scrape timestamp</span>',
      stale ? 't-hot' : ''),
  ].join('');

  /* ── Derived sets the alerts and the panels below both read ──────────────
     Computed once. The alert strip claiming one number and the panel under it
     showing another is the specific failure this avoids. */

  /* A row the latest scrape did not touch: its own timestamp trails the newest
     row in the table by more than a further cycle. Rows with no timestamp at
     all join them — not because they are known to be old, but because they are
     invisible to every freshness figure on the screen, which is its own fault. */
  const lagHours = c => (newest && dated(c)) ? (Date.parse(newest) - Date.parse(c.at)) / 3600000 : null;
  const trailing = live.filter(c => { const l = lagHours(c); return l != null && l > REFRESH_LAG_HOURS; });
  const undatedRows = live.filter(c => !dated(c));
  const notRefreshed = trailing.concat(undatedRows);
  const staleSet = new Set(notRefreshed);
  const oldestTrail = trailing.length
    ? trailing.reduce((a, c) => (Date.parse(c.at) < Date.parse(a.at) ? c : a)) : null;

  /* Real rows that carry no price. A row with no price cannot support an
     undercut claim and is counted in none — the scrape failures are not in here
     at all, because they are not listings. */
  const pricelessRows = live.filter(c => c.price == null);

  /* One grouping, shared by the alert and by the By-competitor panel. */
  const groups = (() => {
    const by = new Map();
    live.forEach(c => {
      const k = c.name || 'Unnamed source';
      if (!by.has(k)) by.set(k, { name: k, rows: [], above: 0, below: 0, cmp: 0, priced: 0, newest: null, stale: 0 });
      const g = by.get(k);
      g.rows.push(c);
      if (c.price != null) g.priced += 1;
      if (staleSet.has(c)) g.stale += 1;
      if (c.delta != null) { g.cmp += 1; if (c.delta > 0) g.above += 1; else if (c.delta < 0) g.below += 1; }
      if (dated(c) && (!g.newest || Date.parse(c.at) > Date.parse(g.newest))) g.newest = c.at;
    });
    return [...by.values()].sort((a, b) => b.above - a.above || b.rows.length - a.rows.length);
  })();
  const silentSources = groups.filter(g => g.priced === 0);

  /* Our own stock that no scraped row matches. This is the blind spot the whole
     screen is blind to by construction: there is no row to look at, so without
     naming it here a competitor could undercut one of these units indefinitely
     and nothing on this page would ever change. */
  const covered = new Set();
  live.forEach(c => c.units.forEach(u => covered.add(String(uRef(u)))));
  const blindUnits = invErr ? [] : inv
    .filter(u => !isSold(u) && !covered.has(String(uRef(u))))
    .sort((a, b) => (n0(b.days_in_stock) || 0) - (n0(a.days_in_stock) || 0));

  /* ── Alerts ──────────────────────────────────────────────────────────────
     `titleHtml` and `detailHtml` hold HTML that is already escaped at the point
     it is built. The names carry the -Html suffix because this app has had a
     real XSS finding and competitor names arrive from a scraper; a field called
     `title` invites the next person to pass raw text into it. */
  const alerts = [];
  const push = a => alerts.push({ sev: 'WARM', icon: 'warning', source: 'local', ...a });

  /* Order is deliberate. Freshness first because it qualifies every other item
     — an undercut measured on a month-old price may not be an undercut at all.
     Then failed reads, because they change what the numbers below can claim.
     Then the view's own rows, then the data-quality faults this screen derives. */
  if (!newest) {
    push({
      sev: 'HOT', icon: 'schedule',
      titleHtml: 'These prices are undated',
      detailHtml: 'Not one row carries a scrape timestamp, so nothing on this screen can be said to be current. Every gap below is a comparison against a price of unknown age.',
      agoHtml: '<span class="t-hot">age unknown</span>',
      noHook: NO_SCRAPE_HOOK,
      why: 'There is no timestamp to sort or filter on, so there is no row this can open.',
    });
  } else if (stale) {
    push({
      sev: veryStale ? 'HOT' : 'WARM', icon: 'update_disabled',
      titleHtml: `The newest price here is ${dayWord(daysOld)} old`,
      detailHtml: `${freshLine} The scrape's own schedule is the reason: it was an n8n "every ${SCRAPE_EVERY_HOURS} hours" interval, which drifts on restart and then stops firing without failing, so nothing refreshed and nothing was ever recorded as broken. It is a cron now, firing ${SCRAPE_SCHEDULE}, but until a run lands, every gap on this screen is measured against prices that old and none of them is safe to quote at a customer without being re-checked first.`,
      agoHtml: `<span title="${esc(dt(newest))}">price ${esc(dayWord(daysOld))} old</span>`,
      noHook: NO_SCRAPE_HOOK,
      actLabel: 'Oldest first',
      act: () => focusFilter('ALL', '', 'oldest'),
    });
  }

  if (invErr) {
    push({
      sev: 'HOT', icon: 'error',
      titleHtml: 'Our own stock did not load, so no gap could be computed',
      detailHtml: `${esc(invErr.message)} — every "Our list price" and "Gap" cell below is blank for that reason, the three comparison figures above read "—" rather than zero, and the check for stock with no market reference could not run at all.`,
      agoHtml: 'this page load',
      actLabel: 'Retry',
      act: reload,
    });
  }

  /* The claim this screen used to make and could not support. It is raised as
     an alert rather than left in a tooltip because it qualifies every AED figure
     on the page: a gap is only a gap if the two cars are the same car. */
  if (!invErr && gapRows.length) {
    const worst = mixedRows[0] || reusableRows[0] || unconfirmed[0];
    push({
      sev: mixedRows.length ? 'HOT' : unconfirmed.length ? 'WARM' : 'COLD',
      icon: 'compare_arrows',
      titleHtml: unconfirmed.length
        ? `${num(unconfirmed.length)} of ${num(gapRows.length)} ${plural(gapRows.length, 'gap is', 'gaps are')} a model-name match, not a make match`
        : 'Every gap here is matched on the model name',
      detailHtml: esc(`${NO_MAKE} A gap below therefore says "a car called this costs that much elsewhere", not "the same car costs that much elsewhere".`
        + (mixedRows.length
          ? ` ${mixedRows.length} of them carry a model name our own stock uses across more than one manufacturer — ${[...new Set(mixedRows.map(c => c.label))].slice(0, 4).join(', ')} — so those are the likeliest to be pricing us against somebody else's car.`
          : '')
        + (reusableRows.length
          ? ` ${reusableRows.length} ${plural(reusableRows.length, 'is a single short designation', 'are single short designations')} of the kind manufacturers reuse (${[...new Set(reusableRows.map(c => c.label))].slice(0, 4).join(', ')}).`
          : '')
        + (worst ? ` Check the Match column on each row before quoting one; ${worst.label} is the one to look at first.` : '')),
      agoHtml: '<span class="t-muted">match quality</span>',
      actLabel: 'Show them',
      act: () => focusFilter(counts.UNNAMED ? 'UNNAMED' : 'ALL', ''),
    });
  }

  /* Counts this small are not a picture of the market. They are named as what
     they are rather than left to be read as a share — the screen shows "we
     undercut 1", and one comparison out of a two-row scrape is a listing, not a
     position. No percentage is drawn from them anywhere. */
  if (!invErr && comparable.length && comparable.length <= THIN_ROWS) {
    push({
      sev: 'COLD', icon: 'help',
      titleHtml: `Everything above rests on ${num(comparable.length)} ${plural(comparable.length, 'comparison', 'comparisons')}`,
      detailHtml: `${comparable.length === live.length
        ? (comparable.length === 1 ? 'The one scraped row on file' : `All ${num(live.length)} scraped rows`)
        : `${num(comparable.length)} of the ${num(live.length)} scraped ${plural(live.length, 'row', 'rows')}`} could be matched to stock we hold and priced against it${groups.length === 1 ? `, ${plural(comparable.length, 'from', 'all of them from')} ${esc(groups[0].name || 'a single source')}` : ''}. The counts above are ${plural(comparable.length, 'that one row', 'those rows')} and nothing more — ${plural(comparable.length, 'it says', 'they say')} what ${plural(comparable.length, 'this listing does', 'these listings do')}, not where our prices sit in the market.`,
      agoHtml: '<span class="t-muted">sample size</span>',
      actLabel: 'Show them',
      act: () => focusFilter('ALL', '', 'below_first'),
    });
  }

  /* ── The centrally-raised rows ──────────────────────────────────────────
     `ref` is matched against the scraped row's id first, then against the stock
     id of a unit the row was matched to, then against the vehicle name. Which
     one hit is reported, because a match on a name is a weaker claim than a
     match on a key and the operator should know which they are looking at. */
  const byId = new Map(); live.forEach(c => { if (c.id != null) byId.set(String(c.id), c); });
  const byStock = new Map();
  live.forEach(c => c.units.forEach(u => { const k = String(uRef(u)); if (k && !byStock.has(k)) byStock.set(k, c); }));
  /* Names are compared as a bag of words, not as a string. The view builds its
     title from the same parts this screen builds `label` from but not in the
     same order — "Nissan Patrol Nismo 2023" against "2023 Nissan Patrol Nismo"
     — and a straight comparison silently fails on every row. Sorting the tokens
     makes the two forms the same key; dropping the year gives a second, looser
     key for a title that does not carry one. */
  const tokenKey = s => norm(s).split(' ').filter(Boolean).sort().join(' ');
  const tokenKeyNoYear = s => norm(s).split(' ')
    .filter(t => t && !/^(19|20)\d{2}$/.test(t)).sort().join(' ');
  const byLabel = new Map(), byLabelLoose = new Map();
  live.forEach(c => {
    const k = tokenKey(c.label); if (k && !byLabel.has(k)) byLabel.set(k, c);
    const l = tokenKeyNoYear(c.label); if (l && !byLabelLoose.has(l)) byLabelLoose.set(l, c);
  });

  const resolveAttn = it => {
    const ref = String(it.ref == null ? '' : it.ref).trim();
    if (ref && byId.has(ref)) return { c: byId.get(ref), how: 'the scraped row id' };
    if (ref && byStock.has(ref)) return { c: byStock.get(ref), how: 'our stock id' };
    const t = tokenKey(it.title);
    if (t && byLabel.has(t)) return { c: byLabel.get(t), how: 'the vehicle name' };
    const l = tokenKeyNoYear(it.title);
    if (l && byLabelLoose.has(l)) return { c: byLabelLoose.get(l), how: 'the vehicle name without its year' };
    return { c: null, how: null };
  };

  let unresolved = 0;
  (attn || []).forEach(it => {
    const { c, how } = resolveAttn(it);
    if (!c) unresolved += 1;
    const extra = [];
    /* The view's detail carries the gap as it stood when the row was scraped.
       This screen's entire thesis is that a stored gap describes a price we may
       no longer ask, so the alert is re-checked against the live list price and
       the two are shown together rather than the older one being trusted. */
    if (c && c.delta != null) {
      extra.push(`Against the list price we ask today the gap is ${esc(aedSigned(c.delta))}.`);
    } else if (c) {
      extra.push('This screen cannot re-check that figure: '
        + (c.unmatched ? 'no unit on the lot carries this model name.'
          : c.price == null ? 'the scraped row carries no price.'
            : 'the matching unit has no list price on record.'));
    }
    if (it.at && !Number.isNaN(Date.parse(it.at))) {
      const d = Math.floor((Date.now() - Date.parse(it.at)) / 86400000);
      if (d >= VERY_STALE_DAYS) extra.push(`It rests on a price collected ${dayWord(d)} ago.`);
    }
    if (how && how.startsWith('the vehicle name')) {
      extra.push(`Matched to a scraped row by ${how}, not by id — a weaker match than a key, so check it is the same car.`);
    }
    push({
      source: 'view',
      sev: String(it.severity || 'WARM').toUpperCase(),
      icon: KIND_ICON[it.kind] || 'warning',
      titleHtml: esc(it.title || 'Untitled alert'),
      detailHtml: [esc(it.detail || ''), ...extra].filter(Boolean).join(' '),
      at: it.at,
      actLabel: 'Open row',
      act: c ? () => focusRow(c) : null,
      why: c ? null : `v_needs_attention raised this against ref ${esc(String(it.ref == null ? '—' : it.ref))}, and no row loaded here carries that id or that vehicle name — so there is no comparison row on this screen to open.`,
    });
  });

  if (junk.length) {
    const blocked = junk.filter(c => c.fault.kind === 'interstitial');
    const placeholder = junk.filter(c => c.fault.kind === 'placeholder');
    const newestJunk = junk.filter(dated)
      .reduce((a, c) => (!a || Date.parse(c.at) > Date.parse(a.at) ? c : a), null);
    push({
      sev: blocked.length ? 'HOT' : 'WARM', icon: 'bug_report',
      titleHtml: `${num(junk.length)} scraped ${plural(junk.length, 'row is', 'rows are')} not a competitor`,
      detailHtml: esc(
        (placeholder.length
          ? `${placeholder.length} ${plural(placeholder.length, 'row carries', 'rows carry')} the literal text ${[...new Set(placeholder.map(c => `"${c.name}"`))].join(', ')} where the dealership's name belongs. `
          : '')
        + (blocked.length
          ? `${[...new Set(blocked.map(c => `"${c.name}"`))].join(', ')} ${plural(blocked.length, 'is the heading', 'are the headings')} of a bot-detection page rather than a dealership: the scraper was blocked, stored the block page as a competitor, and never read the listing it was sent to read — so this feed is quietly missing whatever ${plural(blocked.length, 'that run was', 'those runs were')} meant to collect. `
          : '')
        + `${junkPriced ? 'They are excluded' : 'None of them carries a price, and all are excluded'} from every count, gap and comparison on this screen, including "Scraped prices" above — ${live.length} of the ${all.length} rows returned are real listings.`),
      agoHtml: newestJunk
        ? `<span title="${esc(dt(newestJunk.at))}">written ${esc(ago(newestJunk.at))}</span>`
        : '<span class="t-muted">no scrape date</span>',
      noHook: NO_SCRAPE_HOOK,
      actLabel: 'Show them',
      act: () => focusFilter('BROKEN', ''),
    });
  }

  if (notRefreshed.length) {
    push({
      sev: 'WARM', icon: 'sync_problem',
      titleHtml: `${num(notRefreshed.length)} ${plural(notRefreshed.length, 'row was', 'rows were')} not refreshed by the latest scrape`,
      detailHtml: [
        trailing.length
          ? `${num(trailing.length)} ${plural(trailing.length, 'row trails', 'rows trail')} the newest row in this table by more than ${REFRESH_LAG_HOURS} h${oldestTrail ? `, the oldest by ${esc(ago(oldestTrail.at))} (${esc(oldestTrail.name || 'unnamed source')} · ${esc(oldestTrail.label)})` : ''}. The scrape is still writing rows, so this is not the job being down — it has stopped covering these listings.`
          : '',
        undatedRows.length
          ? `${num(undatedRows.length)} ${plural(undatedRows.length, 'row carries', 'rows carry')} no scrape date at all, so ${plural(undatedRows.length, 'its', 'their')} age cannot be established and ${plural(undatedRows.length, 'it is', 'they are')} invisible to every freshness figure on this screen.`
          : '',
      ].filter(Boolean).join(' '),
      agoHtml: oldestTrail
        ? `<span title="${esc(dt(oldestTrail.at))}">oldest ${esc(ago(oldestTrail.at))}</span>`
        : '<span class="t-warm">no dates at all</span>',
      actLabel: 'Show them',
      act: () => focusFilter('STALE', '', 'oldest'),
    });
  }

  if (silentSources.length) {
    const one = silentSources.length === 1 ? silentSources[0] : null;
    const silentRows = silentSources.reduce((a, g) => a + g.rows.length, 0);
    push({
      sev: 'WARM', icon: 'money_off',
      titleHtml: one
        ? `${esc(one.name)} sent no price at all`
        : `${num(silentSources.length)} competitors sent no price at all`,
      detailHtml: `${one
        ? `Every one of ${esc(one.name)}'s ${num(one.rows.length)} scraped ${plural(one.rows.length, 'row', 'rows')} arrived without a price`
        : `${esc(silentSources.map(g => g.name).join(', '))} — ${num(silentRows)} rows between them — arrived without a price`}, so nothing they list can be compared with ours. Those rows are counted in "Scraped prices" above and contribute to no gap anywhere on this screen.${pricelessRows.length > silentRows ? ` ${num(pricelessRows.length)} rows have no price in total, across every source.` : ''}`,
      agoHtml: one && one.newest
        ? `<span title="${esc(dt(one.newest))}">last seen ${esc(ago(one.newest))}</span>`
        : '',
      actLabel: 'Show them',
      act: () => focusFilter('NOPRICE', one ? one.name : ''),
    });
  } else if (pricelessRows.length) {
    push({
      sev: 'COLD', icon: 'money_off',
      titleHtml: `${num(pricelessRows.length)} scraped ${plural(pricelessRows.length, 'row has', 'rows have')} no price`,
      detailHtml: `${plural(pricelessRows.length, 'It is', 'They are')} counted in "Scraped prices" above but ${plural(pricelessRows.length, 'contributes', 'contribute')} to no gap, so the comparable count is smaller than the row count by at least this much. Every source here did record a price on some of its rows.`,
      agoHtml: '',
      actLabel: 'Show them',
      act: () => focusFilter('NOPRICE', ''),
    });
  }

  if (!invErr && blindUnits.length) {
    const aged = blindUnits.filter(u => (n0(u.days_in_stock) || 0) >= AGING_DAYS);
    const critical = blindUnits.filter(u => String(u.aging_alert || '').toUpperCase() === 'CRITICAL');
    const listValue = blindUnits.reduce((a, u) => a + (uPrice(u) || 0), 0);
    const longest = blindUnits.reduce((a, u) => Math.max(a, n0(u.days_in_stock) || 0), 0);
    push({
      sev: critical.length ? 'HOT' : 'WARM', icon: 'price_check',
      titleHtml: `${num(blindUnits.length)} unsold ${plural(blindUnits.length, 'unit has', 'units have')} no competitor price at all`,
      detailHtml: `No scraped row carries ${plural(blindUnits.length, 'its', 'their')} model name, so if a rival undercut ${plural(blindUnits.length, 'it', 'one of them')} today nothing on this screen would show it — this is the undercut we would never detect.${aged.length ? ` ${num(aged.length)} of them ${plural(aged.length, 'has', 'have')} been in stock ${AGING_DAYS} days or more${critical.length ? `, ${num(critical.length)} flagged CRITICAL` : ''}.` : ''}${listValue ? ` Together they list at ${esc(aed(listValue))}.` : ''}`,
      agoHtml: longest ? `${esc(dayWord(longest))} in stock` : '',
      actLabel: 'Show them',
      act: () => focusBlind(),
    });
  }

  /* ── Strip rendering ────────────────────────────────────────────────────── */
  const viewCount = alerts.filter(a => a.source === 'view').length;
  const localCount = alerts.length - viewCount;

  /* Every count on this screen has to be explainable, and the two that are not
     obvious are "why is this list this long" and "what is missing from it". */
  const notes = [
    attnErr
      ? `v_needs_attention did not load (${esc(attnErr.message)}), so alerts raised centrally for this screen — the nightly undercut check among them — are missing from this list entirely. The ${num(localCount)} above ${plural(localCount, 'was', 'were')} derived here from the ${num(live.length)} usable scraped ${plural(live.length, 'row', 'rows')} this screen loaded.`
      : `${num(viewCount)} ${plural(viewCount, 'row', 'rows')} from v_needs_attention where screen = competitors${viewCount ? '' : ' (it returned none for this screen)'}, and ${num(localCount)} derived here from the ${num(live.length)} usable scraped ${plural(live.length, 'row', 'rows')}${junk.length ? ` (of ${num(all.length)} returned; ${num(junk.length)} set aside as ${plural(junk.length, 'a scrape failure', 'scrape failures')})` : ''} and ${invErr ? 'no inventory rows' : `${num(inv.length)} inventory ${plural(inv.length, 'row', 'rows')}`} loaded.`,
    unresolved
      ? `${num(unresolved)} of the view's ${plural(unresolved, 'alert', 'alerts')} could not be matched to a row loaded here, so ${plural(unresolved, 'it opens', 'they open')} nothing.`
      : '',
    capped
      ? `The competitors read was capped at ${num(ROW_LIMIT)} rows, so every count on this screen — these alerts included — may be short.`
      : '',
    invErr
      ? 'Inventory did not load, so the check for stock with no market reference could not run and is absent from this list rather than empty.'
      : '',
  ].filter(Boolean);
  const notesHtml = notes.join('<br>');

  /* "How long has this been waiting" is the second figure on this screen that
     ago() is not allowed to round. Every row v_needs_attention files against
     this screen today was raised in mid-July, and ago() renders all of them as
     the same "1 mo ago" — which makes a 43-day-old undercut sound like a
     rounding error rather than a decision that has been pending for six weeks.
     Past VERY_STALE_DAYS the wait is spelled out in days and coloured; the
     exact timestamp stays in the tooltip either way. */
  const waitedHtml = at => {
    if (!at || Number.isNaN(Date.parse(at))) {
      return '<span class="t-muted" title="This alert carries no timestamp, so how long it has been waiting cannot be established.">no timestamp</span>';
    }
    const d = Math.floor((Date.now() - Date.parse(at)) / 86400000);
    return d >= VERY_STALE_DAYS
      ? `<span class="t-hot" title="${esc(dt(at))}">waiting ${esc(dayWord(d))}</span>`
      : `<span title="${esc(dt(at))}">raised ${esc(ago(at))}</span>`;
  };

  const alertItem = (a, i) => {
    const clickable = typeof a.act === 'function';
    /* "How long has this been waiting" only means something for the view's own
       rows, which carry the moment the condition was recorded. A locally derived
       alert states the age of the thing it is about instead, and where neither
       is meaningful it says nothing rather than inventing a clock. */
    const waited = a.agoHtml != null ? a.agoHtml : waitedHtml(a.at);
    return `<div class="list-item"${clickable ? ` role="button" tabindex="0" data-alert="${i}"` : ' style="cursor:default"'}>
      <span class="material-symbols-outlined t-${sevTone(a.sev)}" style="font-size:20px" aria-hidden="true">${esc(a.icon)}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${a.titleHtml}${pill(a.sev, sevTone(a.sev))}${a.source === 'view' ? '<span class="chip" title="Raised by v_needs_attention, the shared cross-screen alert view, not computed on this screen.">shared</span>' : ''}
        </div>
        <div class="cell-sub" style="white-space:normal">${a.detailHtml}${a.why ? ` <span class="t-muted">${a.why}</span>` : ''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0" class="cell-sub">${waited}
        ${clickable ? `<div class="t-muted">${esc(a.actLabel || 'Open')}</div>` : ''}</div>
      ${a.noHook ? `<button class="btn sm" disabled title="${esc(a.noHook.why)}">${esc(a.noHook.label)}</button>` : ''}
      ${clickable ? '<span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">chevron_right</span>' : ''}
    </div>`;
  };

  const headSub = `<div class="card-sub ${stale || !newest ? 't-hot' : ''}" style="white-space:normal">${freshLine}</div>`;

  if (!alerts.length) {
    /* No empty box. One line saying what was checked, so "nothing here" is a
       result rather than a panel that failed to render. */
    alertHost.innerHTML = `<div class="card" style="margin-bottom:16px">
      <div style="display:flex;gap:10px;align-items:flex-start">
        <span class="material-symbols-outlined t-ok" style="font-size:20px" aria-hidden="true">task_alt</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500">Nothing on this screen needs a human right now</div>
          ${headSub}
          <div class="cell-sub" style="white-space:normal;margin-top:6px">Checked: what each match is actually matched on, rows the last scrape did not refresh, rows that are not a competitor at all, sources that sent no price, and unsold stock with no market reference. ${notesHtml}</div>
        </div></div></div>`;
  } else {
    alertHost.innerHTML = `<div class="card flush" style="margin-bottom:16px">
      <div class="card-head"><div style="min-width:0">
        <div class="card-title">Needs attention · ${num(alerts.length)}</div>
        ${headSub}</div></div>
      <div>${alerts.map(alertItem).join('')}</div>
      <div class="list-item" style="cursor:default">
        <span class="material-symbols-outlined t-muted" style="font-size:18px" aria-hidden="true">info</span>
        <div class="cell-sub" style="white-space:normal">${notesHtml}</div></div></div>`;
    const fire = i => { const a = alerts[Number(i)]; if (a && typeof a.act === 'function') a.act(); };
    alertHost.querySelectorAll('[data-alert]').forEach(node => {
      node.addEventListener('click', () => fire(node.dataset.alert));
      node.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(node.dataset.alert); }
      });
    });
  }

  /* ── Table chrome ────────────────────────────────────────────────────────── */
  const f = { view: 'ALL', q: '', sort: 'above_first' };
  const counts = {
    ALL: live.length, ABOVE: above.length, BELOW: belowMkt.length,
    LEVEL: level.length, NOSTOCK: notStocked.length,
    STALE: notRefreshed.length, NOPRICE: pricelessRows.length,
    UNNAMED: unconfirmed.length, BROKEN: junk.length,
  };
  const offered = Object.entries(FILTERS).filter(([k]) => ALWAYS_SHOWN.has(k) || counts[k] > 0);

  const visible = () => {
    const q = f.q.trim().toLowerCase();
    /* Everything except the BROKEN filter reads the real rows only. A row whose
       "competitor" is a bot-detection page must never appear in a list of
       rivals; it is reachable, and labelled, in one place. */
    const base = f.view === 'BROKEN' ? junk : live;
    return base.filter(c => {
      if (f.view === 'ABOVE' && !(c.delta > 0)) return false;
      if (f.view === 'BELOW' && !(c.delta < 0)) return false;
      if (f.view === 'LEVEL' && c.delta !== 0) return false;
      if (f.view === 'NOSTOCK' && !c.unmatched) return false;
      if (f.view === 'STALE' && !staleSet.has(c)) return false;
      if (f.view === 'NOPRICE' && c.price != null) return false;
      if (f.view === 'UNNAMED' && !(c.delta != null && c.makeUnconfirmed)) return false;
      if (q && ![c.name, c.label, c.model].map(low).join(' ').includes(q)) return false;
      return true;
    });
  };

  /* Rows the sort key cannot speak about sink to the bottom in name order
     rather than being ranked as if they were the best or the worst. */
  const sorted = list => {
    if (f.sort === 'name') return [...list].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    const key = f.sort.startsWith('above') || f.sort.startsWith('below')
      ? (c => c.delta)
      : (c => (dated(c) ? Date.parse(c.at) : null));
    const dir = (f.sort === 'below_first' || f.sort === 'oldest') ? 1 : -1;
    const known = list.filter(c => key(c) != null).sort((a, b) => dir * (key(a) - key(b)));
    const unknown = list.filter(c => key(c) == null)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return known.concat(unknown);
  };

  /* What the row is actually claiming. The first chip is the basis — always a
     model-name match, because there is nothing else to match on — and the second
     is how far that is from being the same car. Both carry the full sentence in
     their tooltip; the drawer says it in full. */
  const matchChip = c => {
    const b = BASIS[c.basis] || BASIS.none;
    const r = c.risk ? RISK[c.risk] : null;
    const rWhy = r ? r.text + (c.reusable && c.risk !== 'both' ? REUSABLE_NOTE : '') : '';
    return `<span class="chip" title="${esc(b.why)}">${esc(b.chip)}</span>
      ${r ? `<span class="chip ${r.tone ? `t-${r.tone}` : ''}" title="${esc(rWhy)}">${esc(r.chip)}</span>` : ''}
      ${c.soldOnly ? '<div class="cell-sub">Only a sold unit carries this model name</div>' : ''}
      ${c.conflictNote ? `<div class="cell-sub t-warm" style="white-space:normal">${esc(c.conflictNote)}</div>` : ''}`;
  };

  /* The age of the price is in the first column of every row, coloured. A table
     of gaps where the dates are one uniform grey invites the reader to treat a
     six-week-old number the same as this morning's. */
  const ageCell = c => {
    if (!dated(c)) return '<div class="cell-sub t-warm" title="This row carries no scrape timestamp, so its age is unknown.">no scrape date</div>';
    const cls = staleSet.has(c) ? 't-hot' : stale ? 't-warm' : 't-muted';
    const why = staleSet.has(c)
      ? `Collected ${dt(c.at)}. This row trails the newest row in the table by more than ${REFRESH_LAG_HOURS} h — the last scrape did not refresh it.`
      : `Collected ${dt(c.at)}.`;
    return `<div class="cell-sub ${cls}" title="${esc(why)}">${esc(ago(c.at))}${staleSet.has(c) ? ' · not refreshed' : ''}</div>`;
  };

  const cols = [
    { label: 'Competitor', strong: true, render: c => `${esc(c.name || 'Unnamed source')}
        ${c.fault ? `<div class="cell-sub t-hot" style="white-space:normal" title="${esc(c.fault.why)}">Not a dealership — ${esc(c.fault.kind === 'interstitial' ? 'a bot-detection page the scraper stored as a competitor' : 'a placeholder the scraper wrote instead of a name')}</div>` : ''}
        ${ageCell(c)}` },
    { label: 'Vehicle', render: c => `${esc(c.label)}
        ${c.units.length > 1 ? `<div class="cell-sub">${num(c.units.length)} comparable units in stock</div>` : ''}` },
    { label: 'Their price', align: 'r', render: c => (c.price == null
      ? '<span class="t-muted" title="This row has no competitor price recorded.">—</span>'
      : aed(c.price)) },
    { label: 'Our list price', align: 'r', render: c => {
      if (invErr) return '<span class="t-muted" title="Inventory did not load.">—</span>';
      if (c.unmatched) return `<span class="t-muted" title="${esc(c.conflictNote || 'No unit on the lot carries this model name. Model name is the only thing either table records, so there is nothing looser to fall back on.')}">not stocked</span>`;
      if (c.ourPrice == null) return '<span class="t-muted" title="The matching unit carries no list price.">no price on record</span>';
      return `${aed(c.ourPrice)}${c.ourHigh !== c.ourPrice
        ? `<div class="cell-sub">lowest of ${aed(c.ourPrice)}–${aed(c.ourHigh)}</div>` : ''}`;
    } },
    { label: 'Gap vs their price', align: 'r', render: deltaCell },
    { label: 'Match', render: matchChip },
  ];

  const card = el('div', 'card flush');
  card.innerHTML = `
    <div class="card-head"><div><div class="card-title">Price comparison</div>
      <div class="card-sub" style="white-space:normal">Every scraped price against the cheapest unit we hold whose <strong>model name</strong> matches. Neither table records a make or a model year, so the model string is all there is to match on — read the Match column before trusting a gap. A positive gap means we are asking more than they are${stale && daysOld != null ? `, against a price collected ${esc(dayWord(daysOld))} ago` : ''}.</div></div></div>
    <div class="toolbar">
      <div class="seg" id="cSeg" role="group" aria-label="Filter by where our price sits">
        ${offered.map(([k, l]) => `<button data-v="${k}">${esc(l)} · ${num(counts[k])}</button>`).join('')}
      </div>
      <div class="grow"><input type="search" id="cQ" aria-label="Search competitors and vehicles"
        placeholder="Search competitor or model" /></div>
      <select id="cSort" aria-label="Sort rows" style="width:auto">
        ${Object.entries(SORTS).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}
      </select>
      <div class="t-muted num" id="cCount"></div>
      <button class="btn sm" id="cInv">Open Inventory</button>
    </div>
    ${!invErr && !inv.length ? `<div class="banner info" style="margin:14px 20px 0">
      <span class="material-symbols-outlined">directions_car</span>
      <div>There are no vehicles in stock, so there is nothing of ours to price against these rows.</div></div>` : ''}
    <div id="cTable"></div>`;
  body.innerHTML = '';
  body.appendChild(card);
  $('cInv').addEventListener('click', () => go('inventory'));

  /* ── Making an alert land somewhere ──────────────────────────────────────
     An alert the operator cannot follow is a notification, not a tool. Each of
     these puts the thing the alert is about on screen: the row itself, the
     filtered set it belongs to, or the panel that lists it. */

  /* A brief wash of colour on the thing that was jumped to. The stylesheet's
     `.flash` rule fades out over 400 ms, which is too quick to find after a
     smooth scroll has finished moving, so the background is held inline for a
     couple of seconds and then handed back to the sheet. */
  function highlight(node) {
    if (!node) return;
    node.style.background = 'var(--primary-subtle)';
    setTimeout(() => { node.style.background = ''; }, 2200);
  }

  function focusRow(c) {
    /* Filters are cleared first: an alert must never fail to open its row
       because the operator happened to leave a filter on that excludes it. */
    f.view = 'ALL'; f.q = '';
    const q = $('cQ'); if (q) q.value = '';
    draw();
    const i = sorted(visible()).indexOf(c);
    const tr = i >= 0 ? $('cTable').querySelector(`tbody tr[data-i="${i}"]`) : null;
    (tr || card).scrollIntoView({ behavior: 'smooth', block: tr ? 'center' : 'start' });
    highlight(tr);
    drawer(c);
  }

  function focusFilter(view, q, sort) {
    f.view = view; f.q = q || '';
    if (sort) f.sort = sort;
    const box = $('cQ'); if (box) box.value = f.q;
    draw();
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* The blind-spot panel is built after this runs, so the card is read from the
     closure at click time rather than captured now. */
  let blindCard = null;
  function focusBlind() {
    const target = blindCard || blindHost;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    highlight(blindCard);
  }

  /* ── Drawer: the whole case for one row ──────────────────────────────────── */
  function drawer(c) {
    const disagrees = c.storedOur != null && c.ourPrice != null && c.storedOur !== c.ourPrice;
    const basis = BASIS[c.basis] || BASIS.none;
    const risk = c.risk ? RISK[c.risk] : null;
    const riskWhy = risk ? risk.text + (c.reusable && c.risk !== 'both' ? REUSABLE_NOTE : '') : '';
    const best = c.pricedUnits.length
      ? c.pricedUnits.reduce((a, u) => (uPrice(u) < uPrice(a) ? u : a))
      : null;
    const rowStale = staleSet.has(c);

    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1"><h2 style="font-size:18px">${esc(c.label)}</h2>
          <div class="cell-sub">${c.fault ? `<span class="t-hot">${esc(c.name)} — not a dealership</span>` : esc(c.name || 'Unnamed source')} · ${c.at ? `scraped ${esc(ago(c.at))}` : 'no scrape date recorded'}</div></div>
        <button class="btn ghost sm" id="dClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        ${c.fault ? `<div class="banner hot"><span class="material-symbols-outlined">bug_report</span>
          <div>${esc(c.fault.why)} It is held out of every count, gap and comparison on this screen, and there is nothing here to price against.</div></div>` : ''}
        ${!dated(c) ? `<div class="banner warm"><span class="material-symbols-outlined">schedule</span>
          <div>This row carries no scrape date, so there is no way to say how old the price below is.</div></div>`
        : rowStale ? `<div class="banner hot"><span class="material-symbols-outlined">sync_problem</span>
          <div>Collected ${esc(dt(c.at))} — ${esc(ago(c.at))}. The last scrape did not refresh this row: it trails the newest row in the table by more than ${REFRESH_LAG_HOURS} h, so this listing may not even exist any more.</div></div>`
        : stale ? `<div class="banner hot"><span class="material-symbols-outlined">update_disabled</span>
          <div>Collected ${esc(dt(c.at))} — ${esc(ago(c.at))}. Even the newest price on this screen is ${esc(dayWord(daysOld))} old, so the scrape has missed about ${num(missed)} ${plural(missed, 'cycle', 'cycles')}. Confirm this figure before quoting it to a customer.</div></div>`
        : `<div class="banner info"><span class="material-symbols-outlined">schedule</span>
          <div>Collected ${esc(dt(c.at))} — ${esc(ago(c.at))}.</div></div>`}
        ${c.delta == null ? `<div class="banner info"><span class="material-symbols-outlined">info</span>
          <div>${esc(c.unmatched ? (c.conflictNote || BASIS.none.why) : c.price == null
            ? 'This row has no competitor price, so no gap can be calculated.'
            : 'The matching unit has no list price on record, so no gap can be calculated.')}</div></div>`
          : `<div class="banner ${c.delta > 0 ? 'hot' : c.delta < 0 ? 'info' : 'warm'}">
              <span class="material-symbols-outlined">${c.delta > 0 ? 'trending_up' : c.delta < 0 ? 'trending_down' : 'trending_flat'}</span>
              <div>${c.delta === 0
                ? `We are asking exactly what ${esc(c.name || 'this competitor')} asks for this vehicle.`
                /* The sign already lives in the words "more"/"less", so the figure
                   itself is stated unsigned here; the columns above keep aedSigned(). */
                : `We are asking <strong>${esc(aed(Math.abs(c.delta)))}</strong>${c.deltaPct == null ? '' : ` (${esc(pct(Math.abs(c.deltaPct)))})`}
                   ${c.delta > 0 ? 'more than' : 'less than'} ${esc(c.name || 'this competitor')} for a car carrying the same model name${c.makeUnconfirmed ? ' — not, as far as this data can say, for the same car' : ''}.`}</div></div>`}

        <dl class="kv">
          <dt>Their price</dt><dd class="num">${c.price == null ? '—' : aed(c.price)}</dd>
          <dt>Our list price</dt><dd class="num">${c.ourPrice == null ? '—' : aed(c.ourPrice)}</dd>
          <dt>Gap</dt><dd class="num">${c.delta == null ? '—' : aedSigned(c.delta)}</dd>
          <dt>Matched on</dt><dd>${esc(basis.chip)}${risk ? ` · ${esc(risk.chip)}` : ''}</dd>
          <dt>Scraped</dt><dd>${c.at ? `${esc(dt(c.at))} <span class="cell-sub">· ${esc(ago(c.at))}</span>` : '—'}</dd>
        </dl>

        <div style="margin-top:16px"><div class="label-caps">What this match is</div>
          <div class="cell-sub" style="white-space:normal;margin-top:8px">${esc(basis.why)}</div>
          ${risk ? `<div class="cell-sub ${risk.tone ? `t-${risk.tone}` : ''}" style="white-space:normal;margin-top:6px">${esc(riskWhy)}</div>` : ''}
          ${c.conflictNote ? `<div class="cell-sub t-warm" style="white-space:normal;margin-top:6px">${esc(c.conflictNote)}</div>` : ''}
          ${c.theirMake || c.ourMakes.length ? `<div class="cell-sub" style="white-space:normal;margin-top:6px">Manufacturer${c.theirMake && c.ourMakes.length ? 's' : ''} read out of the model text${c.theirMake ? ` — theirs names ${esc(titleCase(c.theirMake))}` : ''}${c.ourMakes.length ? `${c.theirMake ? ',' : ' —'} ours names ${esc(c.ourMakes.map(titleCase).join(', '))}` : ''}. Inferred from free text, not from a make column: there is none on either table.</div>` : ''}
          <div class="cell-sub" style="white-space:normal;margin-top:6px">There is no listing contact recorded either — the scrape stores a dealership name, a model, a price and a date, and nothing else about who is selling it.</div>
        </div>

        <div style="margin-top:20px"><div class="label-caps">Comparable stock${c.units.length ? ` · ${num(c.units.length)}` : ''}</div>
          ${c.units.length ? c.units.map(u => {
            const p = uPrice(u), d = (p != null && c.price != null) ? p - c.price : null;
            return `<div class="list-item" style="cursor:default;align-items:flex-start">
              <div style="flex:1;min-width:0">
                <div style="font-weight:500">${esc(uModel(u) || 'Unnamed unit')}</div>
                <div class="cell-sub mono">${esc(String(uRef(u) ?? '—'))}</div>
                <div class="cell-sub">${esc(String(u.status || 'status unknown'))}${n0(u.days_in_stock) == null ? '' : ` · ${num(u.days_in_stock)} days in stock`}</div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div class="num">${p == null ? '—' : aed(p)}</div>
                <div class="cell-sub">${d == null ? 'no gap' : esc(aedSigned(d))}</div>
                ${String(u.aging_alert || '').toUpperCase() === 'CRITICAL' ? pill('CRITICAL', 'hot') : ''}
              </div></div>`;
          }).join('')
          : `<div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(c.conflictNote || BASIS.none.why)}</div>`}
        </div>

        <div style="margin-top:20px"><div class="label-caps">As recorded by the scrape</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Our price at scrape time</dt><dd class="num">${c.storedOur == null ? '<span class="t-muted">not recorded</span>' : aed(c.storedOur)}</dd>
            <dt>Difference at scrape time</dt><dd class="num">${c.storedDiff == null ? '<span class="t-muted">not recorded</span>' : aedSigned(c.storedDiff)}</dd>
          </dl>
          ${disagrees ? `<div class="cell-sub" style="white-space:normal;margin-top:8px">The scrape recorded our price as ${esc(aed(c.storedOur))}; inventory currently lists ${esc(aed(c.ourPrice))}. The gap above uses the live list price.</div>` : ''}
          ${c.storedDiff != null ? `<div class="cell-sub" style="white-space:normal;margin-top:6px">The stored difference is signed by the scraping workflow's own convention and is shown here unchanged, not re-derived.</div>` : ''}
        </div>

        ${c.rec ? `<div style="margin-top:20px"><div class="label-caps">AI recommendation</div>
          <div class="cell-sub" style="white-space:normal;margin-top:8px">${esc(c.rec)}</div></div>` : ''}
      </div>
      <div class="drawer-foot">
        <button class="btn primary" id="dPrice"${best ? '' : ' disabled title="No comparable unit with a list price is in stock, so there is nothing here to re-price."'}>Adjust our list price</button>
        <button class="btn" id="dInv">Open Inventory</button>
      </div>`);
    $('dClose').addEventListener('click', closeDrawer);
    $('dInv').addEventListener('click', () => { closeDrawer(); go('inventory'); });
    if (best) $('dPrice').addEventListener('click', () => { closeDrawer(); unitForm(best, inv, reload); });
  }

  function draw() {
    card.querySelectorAll('#cSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === f.view));
    $('cSort').value = f.sort;
    const list = sorted(visible());
    $('cCount').textContent = f.view === 'BROKEN'
      ? `${list.length} of ${junk.length} broken rows`
      : `${list.length} of ${live.length} rows`;

    const th = $('cTable');
    th.innerHTML = table(cols, list, {
      onRow: true,
      empty: `${stateEmpty('No rows match these filters',
        'Clear the search or widen the filter to see the scraped prices again.', 'search_off')}
        <div style="text-align:center;padding:0 20px 32px"><button class="btn" id="cClear">Clear filters</button></div>`,
    });
    wireRows(th, list, drawer);
    $('cClear')?.addEventListener('click', () => { f.view = 'ALL'; f.q = ''; $('cQ').value = ''; draw(); });
  }

  card.querySelectorAll('#cSeg button').forEach(b =>
    b.addEventListener('click', () => { f.view = b.dataset.v; draw(); }));
  $('cQ').addEventListener('input', e => { f.q = e.target.value; draw(); });
  $('cSort').addEventListener('change', e => { f.sort = e.target.value; draw(); });
  draw();

  /* ── Per-competitor summary and our blind spots ──────────────────────────── */
  const requireInv = () => { if (invErr) throw invErr; return true; };

  await Promise.all([
    panel(byCompHost, {
      title: 'By competitor',
      sub: `Where each source has us beaten, and how old its data is. ${stale && daysOld != null ? `Nothing here has refreshed for ${esc(dayWord(daysOld))}.` : ''} Every row is matched to our stock on the model name alone.`,
      load: async () => groups,
      render: gs => (gs.length ? `<div>${gs.map((g, i) => `
        <div class="list-item" role="button" tabindex="0" data-comp="${i}" style="align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="font-weight:500">${esc(g.name)}</div>
            <div class="cell-sub">${num(g.rows.length)} price${g.rows.length === 1 ? '' : 's'} · ${g.priced === 0
              ? '<span class="t-warm">no price on any row</span>'
              : g.cmp ? `${num(g.cmp)} comparable` : 'none comparable to our stock'}
              ${g.newest ? ` · scraped ${esc(ago(g.newest))}` : ' · <span class="t-warm">no scrape date</span>'}</div>
            ${g.stale ? `<div class="cell-sub t-hot">${g.rows.length === 1
              ? 'Its only row was'
              : `${num(g.stale)} of its ${num(g.rows.length)} rows ${plural(g.stale, 'was', 'were')}`} not refreshed by the last scrape</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="${g.above ? 't-hot' : 't-muted'}" style="font-weight:500">${num(g.above)}</div>
            <div class="cell-sub">we ask more${g.below ? ` · ${num(g.below)} lower` : ''}</div>
          </div></div>`).join('')}</div>`
        : stateEmpty('No sources yet', 'No scraped row carries a competitor name.', 'storefront')),
    }).then(c => {
      /* Clicking a source filters the table to it — the same landing an alert
         about that source uses, so the two behave identically. */
      const open = i => { const g = groups[Number(i)]; if (g) focusFilter('ALL', g.name); };
      c.querySelectorAll('[data-comp]').forEach(node => {
        node.addEventListener('click', () => open(node.dataset.comp));
        node.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(node.dataset.comp); }
        });
      });
    }),

    panel(blindHost, {
      title: 'Stock with no market reference',
      sub: 'Unsold units no scraped row matches — priced on instinct, not on evidence. A rival undercutting one of these would not appear anywhere on this screen.',
      actions: '<button class="btn sm" data-act="inv">Open Inventory</button>',
      load: async () => { requireInv(); return blindUnits; },
      render: units => (units.length ? `<div>${units.slice(0, 12).map((u, i) => `
        <div class="list-item" role="button" tabindex="0" data-unit="${i}" style="align-items:flex-start">
          <span class="material-symbols-outlined t-muted" style="font-size:20px" aria-hidden="true">price_check</span>
          <div style="flex:1;min-width:0">
            <div style="font-weight:500">${esc(uModel(u) || 'Unnamed unit')}</div>
            <div class="cell-sub mono">${esc(String(uRef(u) ?? '—'))}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="num">${uPrice(u) == null ? '—' : aed(uPrice(u))}</div>
            <div class="cell-sub">${n0(u.days_in_stock) == null ? 'no acquisition date' : `${num(u.days_in_stock)} days in stock`}</div>
          </div></div>`).join('')}
        ${units.length > 12 ? `<div class="list-item" style="cursor:default"><div class="cell-sub">${num(units.length - 12)} more unit${units.length - 12 === 1 ? '' : 's'} have no scraped comparison</div></div>` : ''}</div>`
        : stateEmpty('Every unsold unit has a market reference',
          'Each car on the lot is matched by at least one scraped competitor price.', 'price_check')),
    }).then(c => {
      blindCard = c;
      c.querySelector('[data-act="inv"]')?.addEventListener('click', () => go('inventory'));
      /* There is no comparison row to open for these — that is the whole point
         of the panel — so the row opens the unit's own price form instead. */
      const open = i => { const u = blindUnits[Number(i)]; if (u) unitForm(u, inv, reload); };
      c.querySelectorAll('[data-unit]').forEach(node => {
        node.addEventListener('click', () => open(node.dataset.unit));
        node.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(node.dataset.unit); }
        });
      });
    }),
  ]);
};

/* ==========================================================================
   S6 · Ask AI
   ========================================================================== */
