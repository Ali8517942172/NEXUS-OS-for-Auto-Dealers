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
   all times, and scheduled runs that have come and gone since without leaving a
   row are counted and named in a banner. (They are not "missed cycles" — see
   the 1 Sep pass below; they fire, and they produce nothing.)

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
   (the first two of the four below were fixed at the source on 1 Sep — read
   the fifth pass before believing the present tense in them)
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
       upserting on the listing. Nine rows on file are three listings. Every
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
   read, and it reports PRODUCING_NOTHING.

   1 Sep 2026, fifth pass. The data grew the columns that make the two
   weaknesses above falsifiable, so most of what this file said about them is
   now history rather than description, and the screen has stopped saying it.

   The scraper now ranks the offers on a page against the unit it was sent to
   price and records what it chose: `listing_title` (the OTHER page's own words
   for what it is selling — the field that finally lets a match FAIL rather
   than comparing our string with itself), `source_host` and `source_kind`
   (oem | marketplace | dealer | unknown, so a manufacturer's list page is no
   longer indistinguishable from a rival showroom), `offer_name` and
   `offer_condition` (which offer the price came from and whether the page
   called it new or used), and `match_quality` / `match_note`. On the Fortuner
   page the new logic picks the actual 2.7 VXR 2024 at 164,900 instead of the
   cheapest new base trim at 128,900, which turns "+23,100 above theirs" into
   12,900 below: the sign of the business conclusion inverts.

   `match_quality` is what this screen keys off, and it is never re-derived
   here — re-deriving it is what produced "+AED 23,100 · 17.9% above theirs"
   against a new base trim in the first place:
     · `exact_year` — the chosen offer named our model year.
     · `model_only` — the name matched, no year was stated. A gap, hedged.
     · `weak` — NOTHING on the page ties that price to our car. The row is
       still written, because a cheap page is worth knowing about, but this
       screen draws no pricing conclusion from it: no percentage, no direction,
       no place in either market KPI. It is context, and it is labelled as
       context.
     · NULL — the row predates the fix. That is not `weak` and it is not
       `exact_year`; it is UNRATED, and asserting either of the others of it
       would be inventing a verdict that no run ever reached. Every row on the
       screen today is one of these: 9 log rows, 3 listings, all seven columns
       NULL, read off the live database at 04:38 UTC on 1 Sep 2026. The
       scraper only started writing them this morning and the next run is at
       13:00 UTC, so the unrated branch is not an edge case here — it is the
       whole screen, and it is what a reviewer actually sees.

   `competitors` stays append-only ON PURPOSE now — price history over time is
   worth keeping — so this file no longer describes it as a fault waiting for
   an upsert. What changed is where the screen reads: `v_competitor_latest` is
   one indexed row per listing and every count, comparison and alert is
   computed from it. The log is read separately, without blocking, for the two
   questions where the history IS the subject.

   And the registry caught up. `workflow_registry.trigger_detail` now reads
   "Cron 0 5,17 * * * (05:00 and 17:00 Asia/Dubai = 01:00 and 13:00 UTC)",
   which agrees with the deployed cron, so the drift sentence this screen
   carried renders empty. The check stays — it is what noticed the
   disagreement — but nothing here asserts a disagreement that has been fixed.

   1 Sep 2026, finishing that pass. The work above stopped part-way down the
   file and left the half below it reading variables that no longer existed:
   `missed` was replaced by `dryRuns` at its definition and still read in two
   places — the "Prices collected" KPI and the drawer's stale banner — both
   inside the `stale` branch, so the screen threw ReferenceError the moment the
   prices aged past a cycle. And `SCRAPE_EVERY_HOURS`, which now means 12,
   was still interpolated into a sentence about the OLD n8n interval, which put
   'an n8n "every 12 hours" interval' on screen about a trigger that was a
   24-hour one. Both are fixed; the literal 24 is history and is written as a
   literal in both places it appears.

   What that half of the file was still saying, and now does not:
     · The KPIs read "We ask more" and "We undercut" over a figure that is the
       lowest price on a page — usually the manufacturer's own. They are
       "Above their page price" and "Below their page price" now, and both carry
       what they are measured against; the filter chips match.
     · The Competitor column is a Source column, because the value is
       `new URL(page).hostname`. Where that hostname is a manufacturer's own
       domain the row, the group and the drawer all say so.
     · "N rows were not refreshed … the scrape is still writing rows, so this is
       not the job being down" — a health conclusion drawn from the presence of
       rows, over a job the health view rates PRODUCING_NOTHING. Staleness is
       now counted per listing and reports the view's answer instead of its own.
     · The drawer printed one quantity twice with opposite signs four lines
       apart: "Gap +AED 23,100" and "Difference at scrape time −AED 23,100". The
       workflow computes `competitorPrice - localPrice`; this screen computes
       ours − theirs. Both labels now name the direction, the stored figure is
       shown in the screen's direction, and the raw column value is quoted.
     · The drawer claimed "the scrape stores a dealership name". It stores a
       hostname.

   The blind-spot panel on the empty branch was the last caller in the app
   wiring itself after `const card = await panel(...)`, which panel() cannot
   replay on retry; it is on the `.then` form the two panels at the foot of this
   file already use. */
import { canEditUnit, db } from '../lib/data.js';
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
   PRODUCING_NOTHING. Read live at 04:38 UTC on 1 Sep 2026: 96 runs in 30
   days, 12 successes, 84 producing no usable price — 12.5% against the
   green "Clean, 30 d · 100.0%" this screen's neighbours used to print. The
   figures quoted on screen are always the ones the view returns at load; the
   ones in this comment are a dated snapshot, for the reader of the file. */
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

/* The column lists, re-read off the live database at 04:38 UTC on 1 Sep 2026:

     competitors  id, competitor, model, our_price_aed, price_aed,
                  price_diff_aed, scraped_at, ai_recommendation,
                  listing_title, source_host, source_kind, offer_name,
                  offer_condition, match_quality, match_note
     v_competitor_latest   the same fifteen columns, distinct on
                  (competitor, model) over the newest snapshot
     inventory    id, model, vin, status, acquired_at, cost_aed, price_aed,
                  days_in_stock, holding_cost_accrued, gross_margin, net_margin,
                  vat_amount, aging_alert, ai_recommendation,
                  recommended_commission

   The last seven competitor columns landed on 1 Sep 2026 and are what let this
   screen state a provenance instead of assuming one. They are nullable and
   every row written before that morning has all seven NULL, which is a third
   state — unrated — and not a synonym for a bad match; see QUALITY.

   Inventory still has no make, no brand and no model year, and neither table
   has a listing contact. The alias lists below are what the feed has actually
   been called at some point; the real column is first and nothing here reaches
   for a column that does not exist on either table. */
/* `competitor` is not a dealership and this reads it as one at your peril. The
   scraper sets it from `ldSeller || hostSource || modelSource`, and in practice
   that is `hostSource` — `new URL(page).hostname` with the leading "www."
   removed. All nine rows on file at 04:38 UTC on 1 Sep 2026 read "toyota.ae".
   The workflow's NOT_A_SELLER guard only excludes search and social hosts, so
   an OEM, an aggregator and a classifieds portal all arrive in this column
   looking exactly like a rival showroom, which is why it is called a source
   everywhere on this screen. `source_host` and `source_kind` below are the
   columns that answer it properly; this one is the fallback for the rows that
   predate them. */
const cName  = r => pick(r, ['competitor', 'competitor_name', 'dealer']);
/* OUR model string, not the listing's: the scraper searched with it and writes
   it back. It is still the join key — it is the value that matches inventory —
   but it is no longer the only thing there is, and it is never presented as
   the other side of a comparison on its own. See cTitle. */
const cModel = r => pick(r, ['model', 'vehicle_model']);
const cPrice = r => n0(pick(r, ['price_aed', 'competitor_price_aed']));
const cAt    = r => pick(r, ['scraped_at', 'checked_at', 'created_at']);

/* The 1 Sep 2026 provenance columns. Every one is nullable and every row
   written before that morning has all of them null, so each accessor returns
   null rather than a default: a default here would be this screen inventing
   the answer the scraper did not record, which is the whole class of bug this
   round exists to remove.

   `listing_title` is the important one. It is the OTHER page's own words for
   what it is selling, so it is the first field in the history of this screen
   against which our model string can be compared and FOUND NOT TO MATCH. */
const cTitle   = r => pick(r, ['listing_title']);
const cHost    = r => pick(r, ['source_host']);
const cKind    = r => pick(r, ['source_kind']);
const cOffer   = r => pick(r, ['offer_name']);
const cCond    = r => pick(r, ['offer_condition']);
const cQuality = r => pick(r, ['match_quality']);
const cNote    = r => pick(r, ['match_note']);

const uModel = u => pick(u, ['model']);
const uPrice = u => n0(pick(u, ['price_aed']));
const uRef   = u => pick(u, ['id']);          // `id` IS the stock number

/* The sentence every match on this screen has to be read against. */
const NO_MAKE = 'Neither table records a make or a model year — `model` is free text and it is the only thing there is to match on.';

/* `competitors.model` is our own model string round-tripped: `Log Competitor
   Intel` writes it as `$json.model`, which `Parse AI Price` carries down from
   `Build Apify Query`, and that node built its search query out of the Supabase
   *inventory* row. Matching it against `inventory.model` compares a value with
   itself — it cannot fail, and any manufacturer read off "both sides" is one
   word counted twice.

   That is still what this column is, and it is still the join key. What changed
   on 1 Sep 2026 is that it is no longer the only thing on the row: the scraper
   now stores `listing_title` beside it, so the page's own wording can be shown
   against ours and the reader can see for themselves whether they describe the
   same car. This sentence is therefore used where a row carries no title of
   its own to check against, and not as a blanket statement about the feed. */
const MODEL_IS_OURS = 'The model text on this row is our own: the scraper wrote back the inventory model string it searched with, so matching it against our stock compares one value with itself and cannot tell us the two cars are the same car.';
const NO_TITLE = 'This row records no listing title, so there is nothing of the page\'s own wording to hold our model string against — the scraper only began storing it on 1 Sep 2026.';

/* The price side, and the same treatment. Before 1 Sep 2026 `collectPrices()`
   walked the page’s JSON-LD and returned the LOWEST AED figure above 20,000
   found anywhere on it, with a language-model fallback that likewise asked for
   the lowest advertised price. Nothing in either path constrained the figure to
   the same year, trim, mileage or even to a used car, and a manufacturer’s
   model page lists every variant — so the number that arrived was the cheapest
   new base trim, and our used 2.7 VXR at 152,000 was measured against it.

   The scraper now ranks the page’s offers against the unit it was sent to price
   and records which one it took. So this sentence describes rows written before
   that morning — which is every row on file today — and PRICE_RANKED describes
   the ones written after. Neither is asserted of a row that does not carry the
   evidence for it. */
const PRICE_UNCONSTRAINED = 'Their figure is the lowest AED price over 20,000 found anywhere on the page — no year, trim, mileage or condition matched, so on a page listing several variants it is the cheapest, usually new, one.';
const PRICE_RANKED = 'The scraper ranked the offers on that page against our unit and recorded which one it took, so this price belongs to a named offer rather than being the cheapest figure on the page.';

/* How well the price on a row is tied to OUR car, in the scraper’s own words.
   `match_quality` is the column the 1 Sep 2026 fix added, and this screen reads
   it rather than re-deriving it: re-deriving it from a model string and a
   minimum price is exactly what put "+AED 23,100 · 17.9% above theirs" in red
   against a new base Fortuner.

   `weak` is the one that changes what may be PRINTED. It means nothing on the
   page ties that price to our car, so the row is shown — a cheap page is worth
   knowing about — and no percentage, no direction and no market position is
   drawn from it anywhere on this screen.

   `unrated` is not a fourth grade of match. It is the ABSENCE of one, and it is
   what every row written before 1 Sep 2026 carries. Calling it weak would
   suppress a figure nobody has shown to be wrong; calling it rated would assert
   a check that never ran. It says which it is instead. */
const QUALITY = {
  exact_year: {
    chip: 'offer names our year', tone: 'ok', concludes: true,
    text: 'The offer this price came from named our model year, so as far as the page states it the two sides are the same car. This is the strongest tie the data carries.' },
  model_only: {
    chip: 'offer names the model, not the year', tone: 'warm', concludes: true,
    text: 'The offer this price came from carries our model name but states no year, so it may be a different model year of the same car. The gap is a real subtraction of two real figures; what it is a gap BETWEEN is one year less certain than it looks.' },
  weak: {
    chip: 'price not tied to our car', tone: 'hot', concludes: false,
    text: 'Nothing on that page ties this price to our car: the scraper found no offer naming our model, recorded the figure as context and rated the match weak. No gap, percentage or market position is drawn from this row anywhere on this screen, because every one of them would be a conclusion the page does not support. What it supports is "this page quotes that figure for something", and the row is kept for that.' },
  /* Reached two ways, and the wording has to be true of both: a row written
     before 1 Sep 2026, which carries none of the provenance columns, and a row
     whose match_quality holds a value this screen has no words for. Neither is
     a rating this screen can act on, and neither is claimed to be worse than
     that — so this text says only that the rating is missing, and the row's own
     Vehicle and Their-price cells say which of the other columns are missing
     with it. Asserting "no listing title" here was wrong on the second case. */
  unrated: {
    chip: 'match never rated', tone: 'warm', concludes: true,
    text: 'No usable match quality is recorded on this row, so how well its price is tied to our car was never established — it is not a good match and it is not a bad one, it is an unchecked one, and nothing on this screen can say which it would have turned out to be. Rows written before the 1 Sep 2026 scraper fix are all in this state. The figures are a true subtraction of two stored numbers and are shown as that and no more.' },
};

/* What kind of page the price came off, as the scraper recorded it. This
   replaces a guess: until 1 Sep 2026 the screen read the hostname’s first label
   against a manufacturer list (oemHost(), still below) and inferred the rest,
   which could only ever spot an OEM and called everything else nothing. Where
   `source_kind` is present it is used and oemHost() is not consulted; where it
   is absent the inference is used and is labelled as an inference, because "the
   scraper recorded it" and "we worked it out from the domain" are different
   claims and only one of them is evidence. */
const KIND = {
  oem: { label: 'the manufacturer\'s own site',
    price: 'a factory list price for a new car, not a rival showroom\'s asking price for a used unit like ours', tone: 'warm' },
  marketplace: { label: 'a classifieds marketplace',
    price: 'an advertised asking price on a listings portal, which may be a private seller rather than a dealer', tone: '' },
  dealer: { label: 'a dealer site',
    price: 'a dealership\'s own advertised price — the closest thing in this feed to a rival\'s asking price', tone: '' },
  unknown: { label: 'a page the scraper could not classify',
    price: 'a price off a page whose kind was not established, so what sort of price it is is unknown', tone: 'warm' },
};

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
   The first label of the host, read against the same manufacturer list the
   model strings are read against.

   This is the FALLBACK now, not the answer: `source_kind` records what the page
   is, and where it is present this is not consulted. It stays for the rows that
   predate that column, and for one thing the column cannot do — naming the
   manufacturer, so a row can say "Toyota's own site" rather than only "the
   manufacturer's own site". Where it is the only thing there is, everything it
   produces is labelled as read off the domain rather than recorded. It only
   ever adds a caution. */
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
  /* The price sentence used to be tacked onto the end of this one. It is a
     separate axis now — what the price is a price OF is `offer_name` and
     `match_quality`, not the model join — and stapling the two together made a
     weakness in one read as a weakness in the other. */
  model: { chip: 'model name',
    why: `Matched because our stock carries the same model name, character for character. ${NO_MAKE} Two cars sold under the same model name are the same row to this match, whoever built them.` },
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
   weakest possible evidence. Where the model text is our own the state is
   `circular` instead, and `circular` is ordered above `both` for that reason.

   That was true of every row the scraper had ever written until 1 Sep 2026, and
   it is true of all three listings on the screen today, because all three
   predate that morning's fix. It is not a permanent property of the feed any
   more: `listing_title` now carries the page's own wording, `isOurModelText()`
   is still checked per row rather than assumed, and `both` becomes reachable
   the moment a scrape stores a title that is not ours. Nothing here is
   hard-coded to the state the table happens to be in. */
const RISK = {
  circular: { chip: 'matched to itself', tone: 'hot',
    text: `${MODEL_IS_OURS} Both "manufacturers" below are that one string read twice, so they agree by construction and confirm nothing. What this row can support is "a page selling something under this name quotes that figure", and no more.` },
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
  /* "We ask more" / "We undercut" until 1 Sep 2026. Both named a market
     position the data cannot support: the other side is the lowest price on a
     page, usually a manufacturer's own, not a rival's price for our car. */
  ABOVE:  'Above their page',
  BELOW:  'Below their page',
  LEVEL:  'Level',
  NOSTOCK:'Not stocked',
  STALE:  'Not refreshed',
  NOPRICE:'No price',
  /* Counts every gap whose match cannot rule out a different car — which now
     includes the circular ones, so "Make unknown" understated it. */
  UNNAMED:'Match unconfirmed',
  /* The two the 1 Sep provenance columns made expressible. UNTIED is the
     scraper's own `weak`: a real price on a page that ties it to nothing of
     ours. UNRATED is the rows that predate the column entirely. */
  UNTIED: 'Not tied to our car',
  UNRATED:'Match never rated',
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
     round-tripped value looks like, and it is true of all nine rows on file at
     04:38 UTC on 1 Sep 2026 — three distinct model strings, every one of them
     ours, because every one of those rows predates that morning's fix.
     It is checked rather than assumed, so a scrape that stores the listing's
     own text stops this screen accusing it without anything here changing. */
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
  /* ── Provenance, as recorded rather than as inferred ─────────────────────
     Every one of these is null on a row written before 1 Sep 2026, and each is
     allowed to stay null. The screen's job here is to carry what the scraper
     decided, not to reconstruct it: `match_quality` in particular is the
     scraper's own rating of how well its price is tied to our unit, and this
     file's whole history is what happens when a screen works that out for
     itself from a model string and a minimum price. */
  const title = cTitle(r);
  /* `source_host` is the recorded hostname; `competitor` is what the rows that
     predate it carry, and it happens to hold a hostname too. The fallback is
     only taken when the value actually looks like one — a bot-detection page
     title stored in `competitor` is not a host and must not be shown as one. */
  const legacyHost = /^(www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(String(name == null ? '' : name).trim())
    ? String(name).trim().replace(/^www\./i, '') : null;
  const host = cHost(r) || legacyHost;
  const kindKey = low(cKind(r));
  const kind = KIND[kindKey] ? kindKey : null;
  /* Named only, never used to decide what the page IS where `source_kind`
     answers that. See oemHost(). */
  const oem = oemHost(host || name);
  const qKey = low(cQuality(r));
  /* Anything the column holds that this screen does not have words for is
     unrated rather than silently coerced into the nearest grade it does know:
     a value we cannot read is not a rating we can act on. */
  const quality = QUALITY[qKey] ? qKey : 'unrated';
  const cond = low(cCond(r)) || null;
  return {
    raw: r, id: pick(r, ['id']), name, model, price,
    fault: scrapeFault(name),
    title, host, kind, oem,
    offer: cOffer(r), cond, note: cNote(r), quality,
    unrated: quality === 'unrated',
    /* Whether the page's price may be turned into a statement about our
       pricing at all. False only on the scraper's own `weak`, and it gates the
       percentage, the direction arrow and both market KPIs — not the figures
       themselves, which are still shown as the context they are. */
    concludes: QUALITY[quality].concludes,
    /* `source_kind` where it is recorded; the hostname inference where it is
       not, and `kind` stays null so every reader can tell the two apart. */
    isOem: kind ? kind === 'oem' : !!oem,
    echoed,
    theirMake, ourMakes, risk, reusable: reusableName(keyed.key), conflictNote,
    /* A gap whose match cannot rule out another manufacturer, or whose match is
       circular and so rules out nothing at all. That is every gap on the screen
       today, because every row on file predates the listing_title column; the
       filter chip counting them says how many. */
    makeUnconfirmed: risk != null && risk !== 'both',
    label: String(model == null ? '' : model).trim() || 'Unnamed vehicle',
    at: cAt(r),
    storedOur: n0(pick(r, ['our_price_aed'])),
    storedDiff: n0(pick(r, ['price_diff_aed'])),
    /* The same quantity as `delta`, in the same direction, so the drawer cannot
       print one number twice with opposite signs four lines apart — which it
       did: "Gap +AED 23,100" above "Difference at scrape time −AED 23,100", one
       row, one figure, two signs. `Parse AI Price` computes
       `priceDiff = competitorPrice - localPrice`; this screen computes
       ours − theirs. They are negatives of each other, not a disagreement, and
       the raw stored value is still shown beside this one and labelled. */
    storedGap: n0(pick(r, ['price_diff_aed'])) == null ? null : -n0(pick(r, ['price_diff_aed'])),
    rec: pick(r, ['ai_recommendation', 'recommendation', 'notes']),
    units, pricedUnits, unmatched: units.length === 0,
    basis: units.length ? basis : 'none',
    soldOnly, ourPrice, ourHigh, delta,
    /* A gap this screen is willing to state as a position. A `weak` row keeps
       its `delta` — the subtraction is real and the drawer shows both figures —
       but nothing derived from it is printed as a conclusion. */
    concludable: delta != null && QUALITY[quality].concludes,
    /* Null on a weak row for the same reason: a percentage IS the conclusion.
       "17.9% above theirs" is the sentence that nearly got a car re-priced
       against a new base trim, and there is no honest way to render it over a
       price the page ties to nothing of ours. */
    deltaPct: (delta != null && price && QUALITY[quality].concludes) ? (delta / price) * 100 : null,
  };
}

/* How a source is described in a sentence, and whether that description is
   something the scraper recorded or something this screen worked out from the
   domain. Returns null when there is neither — an unclassified legacy row on a
   host that is not a manufacturer's, where the honest answer is to say the
   hostname and stop. */
function sourceWords(c) {
  const k = c.kind ? KIND[c.kind] : null;
  const named = c.oem ? `${titleCase(c.oem)}'s own site` : null;
  if (k) return { what: (c.kind === 'oem' && named) || k.label, price: k.price, tone: k.tone, sure: true };
  if (named) return { what: named, price: KIND.oem.price, tone: KIND.oem.tone, sure: false };
  return null;
}

/* The sentence that says what was compared with what, in one place, so the
   tooltip, the drawer, the alert strip and the table cannot drift apart on it.
   Four clauses in a fixed order: our model text against their page's own title,
   which offer the price was taken from and in what condition, what kind of page
   it came off, and how the scraper rated the tie. Where a row records none of
   that — every row on file today — each clause says so instead of falling back
   on the assumptions the 1 Sep fix removed. Plain text: callers escape it. */
function provenance(c) {
  const src = sourceWords(c);
  const out = [];
  out.push(c.title
    ? `Compared our "${c.model}" against the page's own "${c.title}".`
    : `Compared our "${c.model}" against nothing of the page's own. ${NO_TITLE}`);
  out.push(c.offer
    ? `${PRICE_RANKED} It took the "${c.offer}" offer`
      + (c.cond && c.cond !== 'unknown' ? `, which the page states is ${c.cond}.` : ', and the page did not state whether it is new or used.')
    : PRICE_UNCONSTRAINED);
  if (c.host) {
    out.push(`Read from ${c.host}`
      + (src ? ` — ${src.what}${src.sure ? '' : ' (read off the domain, not recorded by the scraper)'}: ${src.price}.` : '.'));
  }
  out.push(QUALITY[c.quality].text);
  if (c.note) out.push(`The scraper's own note: "${c.note}".`);
  return out.join(' ');
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
  /* The scraper rated this match `weak`: nothing on that page ties its price to
     our car. The subtraction is still real, and both figures are still on the
     row in their own columns — what is refused here is every form of
     CONCLUSION. No arrow, no signed gap, no percentage, no "above/below
     theirs". The cell that used to sit here on a row like this read
     "+AED 23,100 · 17.9% above theirs" in red, against a page whose cheapest
     new base trim was the only thing it had matched, and that sentence is the
     reason this screen exists in its current form. */
  if (!c.concludable) {
    const why = `No gap is drawn from this row. ${provenance(c)}`;
    return `<span class="t-muted" title="${esc(why)}">not comparable</span>
      <div class="cell-sub t-hot" style="white-space:normal">Their ${esc(aed(c.price))} is not tied to our car — shown as context, not as a position</div>`;
  }
  if (c.delta === 0) return '<span class="t-muted">level</span>';
  const worse = c.delta > 0;
  /* The tooltip carries what the number itself cannot: when their price was
     collected, and the full provenance — our model text against their listing
     title, which offer the figure came from, what kind of page it came off, and
     how the scraper rated the tie. It used to assert the last two rather than
     read them. */
  const why = `Our ${aed(c.ourPrice)} (list price today) against their ${aed(c.price)}, collected `
    + (c.at ? dt(c.at) : 'on a date this row does not record')
    + `. Matched on the model name "${c.label}"`
    + (c.echoed ? ' — and that name is our own text, written back by the scraper, so the name alone confirms nothing. ' : c.makeUnconfirmed ? ', with no make recorded on either side. ' : '. ')
    + provenance(c);
  return `<span class="${worse ? 't-hot' : 't-ok'}" style="font-weight:500"
      title="${esc(why)}">
      <span class="material-symbols-outlined" style="font-size:16px;vertical-align:-3px" aria-hidden="true">${worse ? 'arrow_upward' : 'arrow_downward'}</span>
      ${aedSigned(c.delta)}</span>
    ${c.deltaPct == null ? '' : `<div class="cell-sub">${pct(Math.abs(c.deltaPct))} ${worse ? 'above' : 'below'} theirs</div>`}
    ${c.unrated ? '<div class="cell-sub t-warm" style="white-space:normal">Match never rated — this comparison predates the 1 Sep provenance fix</div>' : ''}`;
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

  /* Five reads, started together rather than one after another. Inventory and
     the attention view used to wait on the competitors fetch for no reason; on
     a single-core box that is two round-trips of dead time. All are marked
     handled the moment they are created — if the competitors read fails first
     and this function returns, a rejection with no handler surfaces in the
     console instead of in the panel that is supposed to report it. */
  /* The append-only log. NOT the source of any figure on this screen any more —
     see the listing read below — and read here only for the two questions where
     the history IS the subject: what the drawer can show about a price that has
     or has not moved, and resolving an attention row raised against a snapshot
     a later run superseded. It is an enrichment, so it does not block and its
     failure costs the history rather than the screen. */
  const logP = db(`competitors?select=id,competitor,model,price_aed,scraped_at,match_quality&limit=${ROW_LIMIT}`);
  const invP = db('inventory?select=*&limit=1000');
  const attnP = db('v_needs_attention?select=kind,severity,ref,title,detail,at,screen'
    + `&screen=eq.competitors&limit=${ATTN_LIMIT}`);
  /* The scrape's own health, from the shared view, because this screen is not
     entitled to infer it. Rows arriving used to be taken as proof the job was
     working — "the scrape is still writing rows, so this is not the job being
     down" — and the view's answer is PRODUCING_NOTHING: it runs, it does not
     fail, and most runs end with no usable price. The columns the view already
     computes are read as they are; nothing here classifies a status itself. */
  const healthP = db('v_workflow_health?select=name,health,runs_30d,successes_30d,'
    + `no_result_30d,failures_30d,partials_30d,effective_runs_30d,success_rate_30d,last_run,last_success&name=eq.${encodeURIComponent(SCRAPE_WORKFLOW)}`);
  logP.catch(() => {}); invP.catch(() => {}); attnP.catch(() => {}); healthP.catch(() => {});

  /* ── One row per listing, from the view rather than reduced here ─────────
     `v_competitor_latest` is `distinct on (competitor, model)` over the newest
     snapshot, and it is indexed. Every count, comparison, group and alert below
     reads it. This screen used to pull 500 log rows and collapse them in the
     browser, which worked but made the definition of "a listing" a private
     opinion of this file — the attention view holds its own copy of the same
     reduction, and two screens quietly disagreeing about how many listings
     there are is the class of bug this project keeps hitting.

     `competitors` itself stays append-only ON PURPOSE — the price history over
     time is worth keeping — so nothing here treats the extra rows as a fault to
     be fixed by an upsert, which is what this file said until today.

     Ordering is still deliberately left to the client: the column set behind
     this view has changed twice in a fortnight, and ordering server-side on a
     column that has been renamed returns a 400 and takes the whole screen down,
     while sorting here cannot. */
  let rows = [];
  try { rows = await db(`v_competitor_latest?select=*&limit=${ROW_LIMIT}`); }
  catch (e) {
    strip.remove(); below.remove(); alertHost.remove();
    body.innerHTML = `<div class="card">${stateError('competitor pricing', e, 'competitors')}</div>`;
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

  /* The fourth. Losing the log costs the drawer's scrape history and the
     "older snapshots" figure, and nothing else — which is the point of having
     moved every count onto the view. Where it fails the screen says the history
     is missing rather than printing a zero that reads as "scraped once". */
  let log = null, logErr = null;
  try { log = await logP; }
  catch (e) { logErr = e; }

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
     They disagreed until 1 Sep 2026, when the registry was corrected: it now
     reads "Cron 0 5,17 * * * (05:00 and 17:00 Asia/Dubai = 01:00 and 13:00
     UTC)", which parses to the same two UTC hours as the deployed cron, so this
     renders empty and nothing on the screen claims a drift.

     The check stays, and stays derived from the deployed cron rather than from
     the registry, because a registry nobody updates is how "expected daily at
     05:00 UTC" and a next run at 09:00 GST got onto this screen in the first
     place. It reports a disagreement; it does not assert one. */
  const regHours = health ? registryHoursUtc(health.trigger_detail) : null;
  const scheduleDrift = regHours && regHours.join(',') !== SCRAPE_HOURS_UTC.join(',')
    ? `workflow_registry records this job's trigger as "${esc(String(health.trigger_detail))}" — ${num(regHours.length)} ${plural(regHours.length, 'run', 'runs')} a day, where the deployed cron is "${esc(SCRAPE_CRON)}" in Asia/Dubai and audit_log carries runs at both hours. The schedule stated here follows the deployed cron; the registry entry is out of date.`
    : '';

  /* One re-issuable inventory read, for the two blind-spot panels below.
     panel()'s Retry calls `load` again, and a loader that closes over an
     already-settled rejection (`if (invErr) throw invErr`) hands back the same
     failure for ever: the button looks like it is doing something and can never
     succeed. Both blind panels were written that way, so converting the empty
     branch's panel to the `.then` form would have fixed wiring nothing could
     ever reach. This re-issues the request; on success the panel renders the
     stock it just read, and says that the counts above it were drawn before
     that read landed and are still the failed ones. */
  let invRows = invErr ? null : inv;
  const unsoldNow = async () => {
    if (!invRows) invRows = await db('inventory?select=*&limit=1000');
    return invRows.filter(u => !isSold(u))
      .sort((a, b) => (n0(b.days_in_stock) || 0) - (n0(a.days_in_stock) || 0));
  };

  const index = buildIndex(inv);
  const all = rows.map(r => compare(r, index));
  const reload = () => go('competitors');

  /* Rows the scraper produced that are not competitors — a name of "null", or
     the title of a bot-detection page. They are held apart from here down.
     `junk` is reported as a data-quality fault and is reachable through its own
     filter, never charted as a rival source. The view collapses these the same
     way it collapses everything else, so this is a count of broken LISTINGS. */
  const junk = all.filter(c => c.fault);
  const live = all.filter(c => !c.fault);
  const junkPriced = junk.filter(c => c.price != null).length;

  const dated = c => !!(c.at && !Number.isNaN(Date.parse(c.at)));

  /* ── What is left of the client-side collapse, and why it is left ────────
     `live` is now the view's answer, not this file's. What survives here is a
     grouping over the LOG, and it is no longer the source of any figure. It
     earns its place on three things:

     1. The drawer's scrape history. A price that has not moved across five
        reads of the same page is worth showing as exactly that, and the view
        returns one row by construction.
     2. Resolving an attention row raised against a snapshot a later run
        superseded, so such an alert opens the listing instead of nothing.
     3. A disagreement the view cannot report about itself. `v_competitor_latest`
        orders `scraped_at DESC` with no NULLS LAST, and Postgres sorts NULLs
        FIRST under DESC — checked against this database on 1 Sep 2026, not
        assumed. So a listing that acquires one undated row would have that row
        chosen as its representative over every dated one, and the age on screen
        would silently become "unknown" for a listing scraped this morning. This
        screen's own rule has always been the opposite: an undated row can only
        represent a listing that has NO dated row. The grouping below notices
        when the view picked one anyway and the row says so.

     No row on file carries a null `scraped_at` today (0 of 9, read 04:38 UTC on
     1 Sep 2026), so (3) reports nothing — which is the right amount for a guard
     to report, and this table has held undated rows before.

     Keyed on the pair the view groups on, `competitor` and `model`, so the two
     definitions of "a listing" cannot drift apart. */
  const listingKey = o => `${norm(o.name)} :: ${norm(o.model)}`;
  const logRows = (log || []).map(r => ({
    id: pick(r, ['id']), name: cName(r), model: cModel(r), at: cAt(r), price: cPrice(r),
  }));
  const historyOf = new Map();
  logRows.forEach(h => {
    const k = listingKey(h);
    if (!historyOf.has(k)) historyOf.set(k, []);
    historyOf.get(k).push(h);
  });
  historyOf.forEach(hs => hs.sort((a, b) =>
    (dated(b) ? Date.parse(b.at) : -Infinity) - (dated(a) ? Date.parse(a.at) : -Infinity)));
  all.forEach(c => {
    const hs = historyOf.get(listingKey(c)) || [];
    c.history = hs;
    c.snapshotCount = hs.length;
    /* (3) above. True only where the log holds a dated snapshot of this listing
       and the row the view handed back is undated — which is the NULLS-FIRST
       ordering choosing the one row whose age cannot be stated. */
    c.datedSnapshots = hs.filter(dated).length;
    c.viewPickedUndated = !dated(c) && c.datedSnapshots > 0;
  });
  /* Log rows that are not the representative of their listing. Zero when the
     log did not load, which is why every sentence built on it checks `logErr`
     first: "0 older snapshots" and "the history could not be read" are
     different statements and only one of them is true then. */
  const supersededCount = logErr ? 0 : Math.max(0, logRows.length - historyOf.size);

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
        <div class="cell-sub" style="white-space:normal;margin-top:8px">More than they used to, and each row will say how much. Since 1 Sep 2026 the scrape records the page's own listing title beside our model string, which offer on the page the price came from and whether that page called it new or used, what kind of site it was read off, and its own rating of how well that price is tied to our unit. Where it rates a match <strong>weak</strong> — nothing on the page ties the price to our car — the row is still written, because a cheap page is worth knowing about, and this screen draws no gap, no percentage and no market position from it. ${esc(NO_MAKE)} So a rated gap says what offer on what page was compared with which of our cars, and a weak one says only that a page quotes a figure for something. The scrape still has no listing contact and no stock number on their side, and when it is blocked it stores the block page — rows like that are set aside as the data-quality fault they are and counted in nothing.</div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:18px 0 24px">
          <button class="btn sm" disabled title="${esc(NO_SCRAPE_HOOK.why)}">${esc(NO_SCRAPE_HOOK.label)}</button>
          <button class="btn sm" id="cInvEmpty">Open Inventory</button>
        </div>
      </div></div>`;
    $('cInvEmpty').addEventListener('click', () => go('inventory'));

    /* The blind-spot panel is the only one with a real answer today, so it is
       rendered even here — and with its own wording, because "no scraped row
       matches this unit" would imply a comparison that never happened.

       Wired in `.then`, not after an `await`. panel() rebuilds the whole card
       on a retry and replays the fulfilment handlers registered on it, so the
       rows and the Open Inventory button come back wired; code written after
       `const blind = await panel(...)` cannot be replayed — nothing records
       what follows an await — and this was the last caller in the app still on
       that form, its button and its rows dead after any retry
       (lib/ui.js documents it). The two sibling panels at the foot of this file
       already use `.then`.

       The replay runs again after every retry, so nothing in here may do
       anything that accumulates outside the card. The card's own listeners are
       safe: the replay follows a fresh render, so the nodes they attach to are
       new every time. The one wiring that touches something OUTSIDE the card —
       the alert-strip jump — is therefore kept out of the handler entirely and
       reads the card from `blindPanel` at click time. */
    let blindPanel = null;
    await panel(blindHost, {
      title: 'Stock with no market reference',
      sub: 'Unsold units with no competitor price against them. With the competitors table empty this is every one of them: they are priced on instinct, not on evidence.',
      actions: '<button class="btn sm" data-act="inv">Open Inventory</button>',
      load: unsoldNow,
      render: (units, card) => {
        /* The rendered list is stashed on the card so the click wiring opens
           the unit the panel is showing, not the one the first attempt held. */
        card.__units = units;
        const total = units.reduce((a, u) => a + (uPrice(u) || 0), 0);
        return units.length ? `<div>${units.slice(0, BLIND_LIMIT).map((u, i) => `
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
          <div class="cell-sub" style="white-space:normal">${units.length > BLIND_LIMIT ? `Showing the ${num(BLIND_LIMIT)} longest in stock of ${num(units.length)}. ` : ''}Ordered by how long each unit has been on the lot. Clicking one opens its price form — the only price on this screen that is ours to change. ${total ? `${units.length > BLIND_LIMIT ? 'All' : 'The'} ${num(units.length)} together list at ${esc(aed(total))}.` : ''}${invErr ? ' Inventory failed on the first attempt and this list is the retry; the counts above it were drawn before it landed and still read "—". Reload the screen to bring them into line.' : ''}</div>
        </div></div>`
          : stateEmpty('No unsold stock on the lot',
            'Every unit in inventory is marked sold, so there is nothing whose price a competitor could undercut.', 'price_check');
      },
    }).then(blind => {
      blindPanel = blind;
      blind.querySelector('[data-act="inv"]')?.addEventListener('click', () => go('inventory'));
      const openUnit = i => { const u = (blind.__units || [])[Number(i)]; if (u) unitForm(u, invRows || [], reload); };
      blind.querySelectorAll('[data-unit]').forEach(node => {
        node.addEventListener('click', () => openUnit(node.dataset.unit));
        node.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openUnit(node.dataset.unit); }
        });
      });
    });

    /* The one alert that can be followed here scrolls to that panel. Bound once,
       outside the replayed handler, and resolving the card at click time — the
       alert strip is not rebuilt by a retry, so re-binding it on every retry
       would stack duplicate listeners on the same node. */
    alertHost.querySelectorAll('[data-empty]').forEach(node => {
      const jump = () => {
        const target = blindPanel || blindHost;
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (!blindPanel) return;
        blindPanel.style.background = 'var(--primary-subtle)';
        setTimeout(() => { if (blindPanel) blindPanel.style.background = ''; }, 2200);
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
  /* A subtraction is not a market position. `concluded` is the subset the
     scraper's own `match_quality` lets this screen speak about — everything
     except `weak`, which means nothing on that page ties its price to our car.
     A weak row is held out of both market KPIs and counted on its own line
     rather than dropped, because "we could not compare 4 of 7" is a fact and
     "we are above on 3" over a denominator that quietly shed the awkward rows
     is the older, worse version of this screen. */
  const concluded = comparable.filter(c => c.concludable);
  const untied = comparable.filter(c => !c.concludable);
  const above = concluded.filter(c => c.delta > 0);
  const level = concluded.filter(c => c.delta === 0);
  const belowMkt = concluded.filter(c => c.delta < 0);
  const notStocked = live.filter(c => c.unmatched);
  /* Listings written before the scraper recorded any provenance at all. Not
     weak, not confirmed — unchecked. All three on screen today. */
  const unratedRows = live.filter(c => c.unrated);
  const worstAbove = above.length ? above.reduce((a, c) => (c.delta > a.delta ? c : a)) : null;
  const bestBelow = belowMkt.length ? belowMkt.reduce((a, c) => (c.delta < a.delta ? c : a)) : null;
  const competitorCount = new Set(live.map(c => norm(c.name)).filter(Boolean)).size;
  const modelCount = new Set(live.map(c => norm(c.label)).filter(Boolean)).size;
  /* Gaps whose match cannot rule out a different manufacturer, and the harder
     case: a model name our own stock demonstrably uses across two makes. */
  const gapRows = comparable;
  const unconfirmed = gapRows.filter(c => c.makeUnconfirmed);
  const mixedRows = gapRows.filter(c => c.risk === 'mixed');
  /* Gaps whose two model strings are one string: the scraper wrote our own
     model text back out, so the match agrees with itself. That is all three of
     them today, because all three predate the listing_title column — it is
     counted and named rather than left in a chip for that reason, and it is
     checked per row so it stops being said the moment a scrape stores a title
     that is not ours. */
  const circularRows = gapRows.filter(c => c.echoed);
  /* Gaps measured against a manufacturer's own site — a factory list price for
     a new car, not a rival showroom's price for this used unit. Read from
     `source_kind` where the row records it, from the hostname where it does
     not; `isOem` keeps the two apart. */
  const oemRows = gapRows.filter(c => c.isOem);
  const reusableRows = unconfirmed.filter(c => c.reusable);
  const staleNote = stale && daysOld != null
    ? ` Measured against prices ${dayWord(daysOld)} old.` : '';
  /* What the other side of every one of these gaps actually is. Stated on the
     KPI itself because the KPI is the figure that gets repeated out loud.

     This used to be a constant — "against the lowest price on the page" — which
     was true of every row the scraper could then write. It is read off the rows
     now, so the day a run lands a rated one the sentence changes with it
     instead of libelling a comparison that was made properly. */
  const compareNote = unratedRows.length === live.length
    ? ' Every listing here predates the 1 Sep provenance fix: their figure is the lowest price found on the page, tied to our car by nothing that was recorded, and the match was never rated.'
    : ` Taken from the offer the scraper matched to our unit.${untied.length
      ? ` A further ${num(untied.length)} ${plural(untied.length, 'listing is', 'listings are')} priced off a page that ties nothing to our car and ${plural(untied.length, 'is', 'are')} not counted here.`
      : ''}${unratedRows.length
      ? ` ${num(unratedRows.length)} more ${plural(unratedRows.length, 'predates', 'predate')} the fix and ${plural(unratedRows.length, 'is', 'are')} unrated.`
      : ''}${oemRows.length
      ? ` ${oemRows.length === gapRows.length ? 'Every one of these pages is' : `${num(oemRows.length)} of these pages are`} a manufacturer's own site, so the figure is a new-car list price.`
      : ''}`;
  /* The cap now applies to LISTINGS, because that is what the view returns. The
     log has its own cap and its own consequence — a truncated history, not a
     truncated count — and they are reported separately. */
  const capped = rows.length >= ROW_LIMIT;
  const logCapped = !logErr && logRows.length >= ROW_LIMIT;

  strip.innerHTML = [
    /* A count of LISTINGS, straight from `v_competitor_latest`. `competitors`
       is an append-only log, so a count of its rows grows whether or not the
       market moves — which is how "We ask more · 4" and "We undercut · 4" came
       to sit beside a subtitle correctly reading three vehicles. Nothing on
       this screen counts log rows any more. */
    kpi('Listings priced', num(live.length),
      `${num(competitorCount)} source${competitorCount === 1 ? '' : 's'} · ${num(modelCount)} vehicle${modelCount === 1 ? '' : 's'}${capped ? ` · capped at ${num(ROW_LIMIT)} rows` : ''}`
      + (logErr
        ? ` · <span class="t-muted" title="${esc(`The append-only log did not load (${logErr.message}). Every figure on this screen comes from v_competitor_latest and is unaffected; what is missing is the scrape history in the drawer.`)}">history unavailable</span>`
        : supersededCount ? ` · <span class="t-muted" title="v_competitor_latest returns the newest snapshot of each listing. competitors itself is an append-only log on purpose — the price history over time is worth keeping — so these older rows are still on file and are shown in the drawer, they are simply not counted as listings.">${num(supersededCount)} older ${plural(supersededCount, 'snapshot', 'snapshots')} in the log</span>` : '')
      + (junk.length ? ` · <span class="t-hot">${num(junk.length)} more ${plural(junk.length, 'row is', 'rows are')} a scrape failure, not a listing</span>` : '')),
    /* When inventory did not load nothing could be compared, so the honest
       value is "—", not the zero that arithmetic over an empty list produces.
       A zero here reads as "we checked and found none". */
    kpi('Comparable to our stock', invErr ? '—' : num(comparable.length),
      invErr
        ? '<span class="t-hot">Inventory did not load, so no comparison could be made</span>'
        : `<span class="t-muted">${num(notStocked.length)} not stocked · ${num(live.length - comparable.length - notStocked.length)} missing a price</span>`
          + (untied.length ? ` <span class="t-hot">· ${num(untied.length)} priced off a page that ties nothing to our car</span>` : '')
          + (unratedRows.length ? ` <span class="t-warm">· ${num(unratedRows.length)} ${plural(unratedRows.length, 'match', 'matches')} never rated</span>` : '')
          + (unconfirmed.length ? ` <span class="t-warm">· ${num(unconfirmed.length)} matched on model name only</span>` : '')),
    /* "More than what" is the question these two must not dodge. The figure on
       the other side is the lowest AED price over 20,000 anywhere on the page
       the scraper read, on a page that is usually a manufacturer's own — so
       both KPIs carry the comparison they are against rather than presenting a
       gap as a market position. */
    /* The denominator moved on 1 Sep: these two count `concluded` rows, not
       every row with a delta, so a `weak` match cannot become a market position
       by arithmetic alone. Where any were held out, the sub says so — a count
       that quietly sheds its awkward rows is worse than no count. */
    kpi('Above their page price', invErr ? '—' : num(above.length),
      invErr
        ? '<span class="t-hot">Not counted — our own prices are unknown</span>'
        : above.length
          ? `<span class="t-hot">Worst ${aedSigned(worstAbove.delta)} on ${esc(worstAbove.label)}</span>${esc(staleNote)}${esc(compareNote)}`
          : comparable.length ? `<span class="t-muted">No matched unit is above the page price scraped for it</span>${esc(compareNote)}` : '',
      above.length && !invErr ? 't-hot' : ''),
    kpi('Below their page price', invErr ? '—' : num(belowMkt.length),
      invErr
        ? '<span class="t-hot">Not counted — our own prices are unknown</span>'
        : bestBelow
          ? `<span class="t-ok">Best ${aedSigned(bestBelow.delta)} on ${esc(bestBelow.label)}</span>${esc(staleNote)}${esc(compareNote)}`
          : `<span class="t-muted">${num(level.length)} priced level</span>${esc(compareNote)}`),
    /* Stated in days rather than through ago(), which collapses everything past
       a month into "1 mo ago" — the exact rounding this KPI must not do. */
    /* Not "missed N cycles". The runs were not missed: v_workflow_health shows
       them firing and finishing without failing, and producing nothing usable.
       `missed` was the old name for this figure and it was computed off a
       cadence that was wrong by half. */
    kpi('Prices collected', newest ? (daysOld >= 1 ? `${dayWord(daysOld)} ago` : ago(newest)) : '—',
      newest
        ? (dryRuns
          ? `<span class="${stale ? 't-hot' : 't-warm'}">${num(dryRuns)} scheduled ${plural(dryRuns, 'run since', 'runs since')} left no row</span> <span class="t-muted">· ${esc(dt(newest))}</span>`
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

  /* One grouping, shared by the alert and by the By-source panel. Keyed on
     `source_host` where the row records it and on `competitor` where it does
     not — the same value in practice, but the recorded one is the one that
     will still be a hostname when `competitor` goes back to being a seller
     name. `src` is carried so the panel does not have to re-derive it.

     `above` and `below` count only rows this screen may draw a conclusion from,
     for the same reason the KPIs do: a weak match is a real price and not a
     position, and a per-source tally is exactly where one would quietly become
     the other. `untied` is carried so the panel can say how many it held out. */
  const groups = (() => {
    const by = new Map();
    live.forEach(c => {
      const k = c.host || c.name || 'Unnamed source';
      if (!by.has(k)) by.set(k, { name: k, src: sourceWords(c), rows: [], above: 0, below: 0, cmp: 0, untied: 0, unrated: 0, priced: 0, newest: null, stale: 0 });
      const g = by.get(k);
      g.rows.push(c);
      if (c.price != null) g.priced += 1;
      if (staleSet.has(c)) g.stale += 1;
      if (c.unrated) g.unrated += 1;
      if (c.delta != null && !c.concludable) g.untied += 1;
      if (c.concludable) { g.cmp += 1; if (c.delta > 0) g.above += 1; else if (c.delta < 0) g.below += 1; }
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
      /* The literal 24 is history: the interval that drifted really was a
         24-hour one. It must not be derived from SCRAPE_EVERY_HOURS, which now
         describes the twice-daily cron that replaced it. */
      detailHtml: `${freshLine} It is a cron now, firing ${SCRAPE_SCHEDULE} — the trigger that drifted was an n8n "every 24 hours" interval, which stops firing after a restart without ever failing, and that is not what is happening today. ${healthLine} Until a run lands a price, every gap on this screen is measured against figures that old and none of them is safe to quote at a customer without being re-checked first.`,
      agoHtml: `<span title="${esc(dt(newest))}">price ${esc(dayWord(daysOld))} old</span>`,
      noHook: NO_SCRAPE_HOOK,
      actLabel: 'Oldest first',
      act: () => focusFilter('ALL', '', 'oldest'),
    });
  }

  /* What the job itself is doing, from the shared view rather than inferred
     from the fact that rows exist. Rows existing is exactly what made this
     screen's neighbours print a green "Clean, 30 d · 100.0%" over a workflow
     that was producing nothing, and this screen drew the same conclusion in
     prose: "the scrape is still writing rows, so this is not the job being
     down". It is the job. Never classify a status here — the view does it, and
     lib/health.js supplies the words. */
  if (!health || healthErr || String(health.health).toUpperCase() !== 'HEALTHY') {
    push({
      sev: (health && String(health.health).toUpperCase() === 'PRODUCING_NOTHING') ? 'HOT'
        : (health && hWords.tone === 'hot') ? 'HOT' : 'WARM',
      icon: 'monitor_heart',
      titleHtml: health && !healthErr
        ? `The scrape itself is rated ${esc(hWords.label)}`
        : 'The scrape\'s own health could not be established',
      detailHtml: `${healthLine} Every figure on this screen is drawn from the rows it did manage to write; none of them says anything about the runs that wrote nothing.${scheduleDrift ? ` ${scheduleDrift}` : ''}`,
      agoHtml: health && health.last_run
        ? `<span title="${esc(dt(health.last_run))}">last run ${esc(ago(health.last_run))}</span>`
        : '<span class="t-muted">no run recorded</span>',
      noHook: NO_SCRAPE_HOOK,
      why: 'This screen reads the health view; it has no control over the workflow.',
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

  /* ── The state a reviewer actually sees today ────────────────────────────
     Every row written before 1 Sep 2026 carries no listing_title, no offer_name
     and no match_quality, because the scraper only began writing them that
     morning. That is not a weak match and it is not a good one. It is an
     UNRATED one, and the difference decides what may be printed: calling it
     weak would suppress a figure nobody has shown to be wrong, and calling it
     rated would assert a check that never ran. This alert says which it is, and
     when the next run will replace it.

     All 3 listings are in this state right now (read 04:38 UTC, 1 Sep 2026), so
     it leads the match items rather than sitting under them. */
  if (!invErr && unratedRows.length) {
    const due = nextScrape();
    /* A row that predates the columns altogether, as against one whose rating
       simply cannot be read. The two get different sentences because they are
       different facts. */
    const legacyRows = unratedRows.filter(c => !c.title && !c.offer).length;
    const noTitle = unratedRows.filter(c => !c.title).length;
    const noOffer = unratedRows.filter(c => !c.offer).length;
    const unratedMissing = [
      noTitle ? `${num(noTitle)} of them ${plural(noTitle, 'carries', 'carry')} no listing title` : '',
      noOffer ? `${num(noOffer)} ${plural(noOffer, 'records', 'record')} no offer name` : '',
    ].filter(Boolean);
    push({
      sev: unratedRows.length === live.length ? 'HOT' : 'WARM',
      icon: 'help_center',
      titleHtml: `${unratedRows.length === live.length ? `All ${num(live.length)}` : `${num(unratedRows.length)} of ${num(live.length)}`} ${legacyRows === unratedRows.length
        ? `${plural(unratedRows.length, 'comparison predates', 'comparisons predate')} the fix that makes a match checkable`
        : `${plural(unratedRows.length, 'comparison carries', 'comparisons carry')} no usable match rating`}`,
      /* What is missing is counted rather than asserted. A row reaches this
         branch two ways — by predating the provenance columns entirely, or by
         carrying a match_quality this screen has no words for — and the second
         kind does have a listing title. Saying it does not would be the same
         species of confident wrong sentence this round exists to remove. */
      detailHtml: esc(`${legacyRows === unratedRows.length
        ? `${plural(unratedRows.length, 'This listing carries', 'These listings carry')} no listing title, no offer name and no match quality: the scraper began recording all three on 1 Sep 2026 and has not re-scraped ${plural(unratedRows.length, 'it', 'them')} since.`
        : `The match quality on ${plural(unratedRows.length, 'this listing', 'these listings')} is missing or holds a value this screen has no words for${unratedMissing.length ? `, and ${unratedMissing.join(' and ')}` : ''}.`} How well each price is tied to our car was therefore never established — unrated, which is neither weak nor confirmed, and nothing on this screen can say which it would have turned out to be. ${unratedRows.some(c => !c.offer) ? `${PRICE_UNCONSTRAINED} ` : ''}The gaps below are a true subtraction of two stored numbers and are shown as that and no more.`)
        + ` The next scheduled run is ${esc(dt(due.toISOString()))}, ${esc(waitWord(due - Date.now()))}, and will rewrite ${plural(unratedRows.length, 'it', 'them')} with a rated match — on the Fortuner page that changes which offer the price is taken from, and with it the direction of the gap.`,
      agoHtml: '<span class="t-warm">never rated</span>',
      noHook: NO_SCRAPE_HOOK,
      actLabel: 'Show them',
      act: () => focusFilter(counts.UNRATED && counts.UNRATED < counts.ALL ? 'UNRATED' : 'ALL', '', 'oldest'),
    });
  }

  /* The scraper's own `weak`: a real price on a page that ties it to nothing of
     ours. These rows are deliberately kept — a cheap page is worth knowing
     about — and deliberately silent: no percentage, no direction, no place in
     either market KPI. The alert exists so that silence is a stated decision
     rather than a row the reader assumes was simply level. */
  if (!invErr && untied.length) {
    push({
      sev: 'HOT', icon: 'link_off',
      titleHtml: `${num(untied.length)} scraped ${plural(untied.length, 'price is', 'prices are')} not tied to any car of ours`,
      detailHtml: esc(`The scraper rated ${plural(untied.length, 'this match', 'these matches')} weak: it read the page, found no offer naming our model, and recorded the figure as context. ${untied.map(c => `${c.label} — ${c.note || 'no offer on the page named our model'}`).join('; ')}. No gap, percentage or market position is drawn from ${plural(untied.length, 'it', 'them')} anywhere on this screen, and ${plural(untied.length, 'it is', 'they are')} excluded from "Above their page price" and "Below their page price" for the same reason. What ${plural(untied.length, 'it supports', 'they support')} is that a page quotes that figure for something, which is worth seeing and is not a comparison.`),
      agoHtml: '<span class="t-hot">no tie to our car</span>',
      actLabel: 'Show them',
      act: () => focusFilter('UNTIED', ''),
    });
  }

  /* The claim this screen used to make and could not support. It is raised as
     an alert rather than left in a tooltip because it qualifies every AED figure
     on the page: a gap is only a gap if the two cars are the same car. */
  if (!invErr && gapRows.length) {
    const worst = circularRows[0] || mixedRows[0] || reusableRows[0] || unconfirmed[0];
    push({
      sev: (circularRows.length || mixedRows.length) ? 'HOT' : unconfirmed.length ? 'WARM' : 'COLD',
      icon: 'compare_arrows',
      titleHtml: circularRows.length
        ? `${circularRows.length === gapRows.length ? `All ${num(gapRows.length)}` : `${num(circularRows.length)} of ${num(gapRows.length)}`} ${plural(gapRows.length, 'gap compares', 'gaps compare')} our own model text with itself`
        : unconfirmed.length
          ? `${num(unconfirmed.length)} of ${num(gapRows.length)} ${plural(gapRows.length, 'gap is', 'gaps are')} a model-name match, not a make match`
          : 'Every gap here is matched on the model name',
      detailHtml: esc((circularRows.length
        ? `${MODEL_IS_OURS} The match therefore cannot miss and confirms nothing, on ${circularRows.length === gapRows.length ? 'every gap here' : `${circularRows.length} of them`}. ${circularRows.every(c => !c.title) ? `None of ${plural(circularRows.length, 'it', 'them')} carries a listing title either, so there is nothing of the page's own wording to check ours against — the scraper began storing that on 1 Sep 2026. ` : ''}`
        : '')
        + `${NO_MAKE} A gap below therefore says "a car called this costs that much elsewhere", not "the same car costs that much elsewhere".`
        /* The price sentence is read off the rows now rather than asserted. It
           was a constant here, and a constant would go on describing the old
           scraper long after it stopped behaving that way. */
        + (unratedRows.length ? ` ${PRICE_UNCONSTRAINED}` : ` ${PRICE_RANKED}`)
        + (oemRows.length
          ? ` ${oemRows.length === gapRows.length ? 'Every one of these pages is' : `${oemRows.length} of these pages are`} a manufacturer's own site (${[...new Set(oemRows.map(c => c.host || c.name))].slice(0, 3).join(', ')})${oemRows.every(c => !c.kind) ? ', read off the domain rather than recorded' : ''}, so the figure being compared against is a factory list price for a new car — not a rival showroom's price for the used unit on our lot.`
          : '')
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
        ? (comparable.length === 1 ? 'The one listing on file' : `All ${num(live.length)} listings on file`)
        : `${num(comparable.length)} of the ${num(live.length)} ${plural(live.length, 'listing', 'listings')} on file`} could be matched to stock we hold and priced against it${groups.length === 1 ? `, ${plural(comparable.length, 'from', 'all of them from')} ${esc(groups[0].name || 'a single source')}` : ''}. The counts above are ${plural(comparable.length, 'that one listing', 'those listings')} and nothing more — ${plural(comparable.length, 'it says', 'they say')} what ${plural(comparable.length, 'this page quotes', 'these pages quote')}, not where our prices sit in the market.`,
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
  /* This used to file one row per SNAPSHOT and put five identical
     "toyota.ae is AED 23,100 cheaper" alerts in the strip, all of them the same
     Fortuner listing scraped five times. The view's undercut arm now carries
     its own `distinct on (competitor, model)` and files one row per listing —
     it returned exactly one for this screen at 04:38 UTC on 1 Sep 2026, and its
     `ref` is the live row id, so it resolves by key.

     The superseded map is kept anyway. It costs one pass over the log and it is
     what stops an alert that was raised before that change, or against a row a
     run has superseded since the strip loaded, from resolving to nothing. It is
     empty when the log did not load, in which case such an alert simply fails
     to resolve and says so, which is the existing unmatched path. */
  const supersededIds = new Map();
  const liveByKey = new Map(live.map(c => [listingKey(c), c]));
  historyOf.forEach((hs, k) => {
    const current = liveByKey.get(k);
    if (!current) return;
    /* Every log row for this listing EXCEPT the one the view returned. Compared
       by id rather than by position, so this stays right if the view's pick and
       the newest dated snapshot are not the same row — which is exactly the
       NULLS-FIRST case the collapse above exists to notice. */
    hs.forEach(h => {
      if (h.id != null && String(h.id) !== String(current.id)) supersededIds.set(String(h.id), current);
    });
  });
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
    if (c && c.concludable) {
      extra.push(`Against the list price we ask today the gap is ${esc(aedSigned(c.delta))}.`);
    } else if (c && c.delta != null) {
      /* The view's undercut arm keys on `price_diff_aed < 0` and does not read
         `match_quality`, so it will keep filing these over a price the scraper
         itself rated as tied to nothing of ours. This screen will not restate
         that figure — restating it is endorsing it. */
      extra.push(`This screen will not restate that gap: the scraper rated the match weak — ${esc(c.note || 'no offer on that page named our model')} — so the figure behind this alert is a subtraction between two cars nothing has shown to be the same car. The view raises these on the stored price difference alone and does not read match quality.`);
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
      const sup = supersededIds.get(String(it.ref == null ? '' : it.ref).trim());
      extra.push(sup
        ? `It was raised against scrape row ${esc(String(it.ref))}, which a later scrape of the same listing has superseded — the scrape inserts rather than upserting, so one listing raises one of these per run.`
        : `Matched to a scraped row by ${how}, not by id — a weaker match than a key, so check it is the same car.`);
    }
    /* The view's own wording — "toyota.ae is AED 23,100 cheaper" — reads as a
       rival showroom undercutting us on the same used unit. It is neither: the
       name is a page hostname, and on an OEM domain the figure is a new-car
       list price. The view is not this screen's to change, so the correction is
       appended rather than the sentence being rewritten. */
    if (c && (c.isOem || c.echoed || c.unrated)) {
      const src = c ? sourceWords(c) : null;
      extra.push([
        c.isOem && src
          ? `"${esc(c.host || c.name)}" is ${esc(src.what)}${src.sure ? '' : ' (read off the domain, not recorded)'}, not a rival dealership: the figure behind that sentence is ${esc(src.price)}.`
          : '',
        c.echoed && !c.title
          ? 'The two cars were matched on a model string the scraper copied from our own inventory row, and this row carries no listing title to check it against, so nothing here establishes that they are the same car.'
          : '',
        c.unrated
          ? 'It was raised on a row that predates the 1 Sep 2026 provenance fix, so how well its price is tied to our car was never rated.'
          : '',
      ].filter(Boolean).join(' '));
    }
    push({
      source: 'view',
      sev: String(it.severity || 'WARM').toUpperCase(),
      /* Whether that `sev` is the view's own word or this file's 'WARM' fallback
         decides what pill() may claim about where it came from. */
      sevFromRow: it.severity != null && String(it.severity).trim() !== '',
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
          ? `${placeholder.length} ${plural(placeholder.length, 'row carries', 'rows carry')} the literal text ${[...new Set(placeholder.map(c => `"${c.name}"`))].join(', ')} where the source belongs. `
          : '')
        + (blocked.length
          ? `${[...new Set(blocked.map(c => `"${c.name}"`))].join(', ')} ${plural(blocked.length, 'is the heading', 'are the headings')} of a bot-detection page rather than a dealership: the scraper was blocked, stored the block page as a competitor, and never read the listing it was sent to read — so this feed is quietly missing whatever ${plural(blocked.length, 'that run was', 'those runs were')} meant to collect. `
          : '')
        + `${junkPriced ? 'They are excluded' : 'None of them carries a price, and all are excluded'} from every count, gap and comparison on this screen, including "Listings priced" above — v_competitor_latest returned ${all.length} ${plural(all.length, 'listing', 'listings')} and ${live.length} of them ${plural(live.length, 'is', 'are')} usable.`),
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
      titleHtml: `${num(notRefreshed.length)} ${plural(notRefreshed.length, 'listing was', 'listings were')} not refreshed by the latest scrape`,
      /* Measured per listing, off its own newest snapshot. Measured per ROW
         against an append-only table it accused listings of being abandoned on
         the strength of their own superseded rows — two were flagged on 31 Aug
         while both had been re-scraped on the 29th, 30th and 31st.

         And it no longer concludes anything about the job from the fact that
         rows are arriving. That sentence — "the scrape is still writing rows,
         so this is not the job being down" — was the screen inferring health it
         is not entitled to infer, and v_workflow_health disagrees with it. */
      detailHtml: [
        trailing.length
          ? `${num(trailing.length)} ${plural(trailing.length, 'listing has not been re-scraped', 'listings have not been re-scraped')} for more than ${REFRESH_LAG_HOURS} h past the newest row in this table${oldestTrail ? `, the oldest by ${esc(ago(oldestTrail.at))} (${esc(oldestTrail.name || 'unnamed source')} · ${esc(oldestTrail.label)})` : ''}. Whether the runs in between fired is not something this table can answer: ${healthLine}`
          : '',
        undatedRows.length
          ? `${num(undatedRows.length)} ${plural(undatedRows.length, 'listing carries', 'listings carry')} no scrape date at all, so ${plural(undatedRows.length, 'its', 'their')} age cannot be established and ${plural(undatedRows.length, 'it is', 'they are')} invisible to every freshness figure on this screen.`
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
        : `${num(silentSources.length)} sources sent no price at all`,
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
      ? `v_needs_attention did not load (${esc(attnErr.message)}), so alerts raised centrally for this screen — the nightly undercut check among them — are missing from this list entirely. The ${num(localCount)} above ${plural(localCount, 'was', 'were')} derived here from the ${num(live.length)} ${plural(live.length, 'listing', 'listings')} this screen loaded.`
      : `${num(viewCount)} ${plural(viewCount, 'row', 'rows')} from v_needs_attention where screen = competitors${viewCount ? '' : ' (it returned none for this screen)'}, and ${num(localCount)} derived here from the ${num(live.length)} ${plural(live.length, 'listing', 'listings')} v_competitor_latest returned${junk.length ? ` (${num(junk.length)} more set aside as ${plural(junk.length, 'a scrape failure', 'scrape failures')})` : ''} and ${invErr ? 'no inventory rows' : `${num(inv.length)} inventory ${plural(inv.length, 'row', 'rows')}`} loaded.`,
    unresolved
      ? `${num(unresolved)} of the view's ${plural(unresolved, 'alert', 'alerts')} could not be matched to a row loaded here, so ${plural(unresolved, 'it opens', 'they open')} nothing.`
      : '',
    capped
      ? `The listing read was capped at ${num(ROW_LIMIT)} rows, so every count on this screen — these alerts included — may be short.`
      : '',
    logErr
      ? `The append-only log did not load (${esc(logErr.message)}). No figure here depends on it — every count comes from v_competitor_latest — but the drawer cannot show what a listing's price has done over time, and an alert raised against a superseded scrape row will not resolve to its listing.`
      : logCapped
        ? `The history read was capped at ${num(ROW_LIMIT)} log rows, so a drawer's scrape history may be shorter than the listing's real one. No count on this screen is affected.`
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
          ${a.titleHtml}${pill(a.sev, sevTone(a.sev), { verbatim: a.sevFromRow === true })}${a.source === 'view' ? '<span class="chip" title="Raised by v_needs_attention, the shared cross-screen alert view, not computed on this screen.">shared</span>' : ''}
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
    UNNAMED: unconfirmed.length, UNTIED: untied.length, UNRATED: unratedRows.length,
    BROKEN: junk.length,
  };
  const offered = Object.entries(FILTERS)
    .filter(([k]) => ALWAYS_SHOWN.has(k) || counts[k] > 0)
    /* A chip that selects every row is not a filter, it is a label — and this
       screen's own rule is that a control which does nothing does not get
       rendered. UNRATED is the one that can legitimately match the whole table
       (it matches all three listings today), so it is offered only where it
       would actually narrow something; the alert that would have opened it
       falls back to ALL and says the count in its own words. */
    .filter(([k]) => k !== 'UNRATED' || counts.UNRATED < counts.ALL);

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
      if (f.view === 'UNTIED' && !(c.delta != null && !c.concludable)) return false;
      if (f.view === 'UNRATED' && !c.unrated) return false;
      /* The page's own title and hostname are searchable too — they are now the
         fields somebody would actually recognise a listing by. */
      if (q && ![c.name, c.host, c.label, c.model, c.title, c.offer].map(low).join(' ').includes(q)) return false;
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
  /* Three chips, and they answer three different questions in a fixed order:
     what our stock was joined on, how far that join is from being the same car,
     and — the one the 1 Sep provenance columns added — how well the PRICE on
     the row is tied to our unit. The third is the scraper's own rating and is
     never re-derived here. */
  const matchChip = c => {
    const b = BASIS[c.basis] || BASIS.none;
    const r = c.risk ? RISK[c.risk] : null;
    const rWhy = r ? r.text + (c.reusable && c.risk !== 'both' ? REUSABLE_NOTE : '') : '';
    const q = QUALITY[c.quality];
    return `<span class="chip" title="${esc(b.why)}">${esc(b.chip)}</span>
      ${r ? `<span class="chip ${r.tone ? `t-${r.tone}` : ''}" title="${esc(rWhy)}">${esc(r.chip)}</span>` : ''}
      <span class="chip ${q.tone ? `t-${q.tone}` : ''}" title="${esc(`${q.text} ${c.note ? `The scraper's own note: "${c.note}".` : ''}`)}">${esc(q.chip)}</span>
      ${c.note ? `<div class="cell-sub" style="white-space:normal">${esc(c.note)}</div>` : ''}
      ${c.soldOnly ? '<div class="cell-sub">Only a sold unit carries this model name</div>' : ''}
      ${c.conflictNote ? `<div class="cell-sub t-warm" style="white-space:normal">${esc(c.conflictNote)}</div>` : ''}`;
  };

  /* The age of the price is in the first column of every row, coloured. A table
     of gaps where the dates are one uniform grey invites the reader to treat a
     six-week-old number the same as this morning's. */
  const ageCell = c => {
    if (!dated(c)) {
      /* See the collapse comment: v_competitor_latest orders `scraped_at DESC`
         with no NULLS LAST, so an undated snapshot outranks every dated one and
         becomes the listing's representative. Where the log shows that happened
         the row says so, rather than letting a listing scraped this morning
         read as one whose age is simply unknown. */
      return c.viewPickedUndated
        ? `<div class="cell-sub t-hot" title="${esc(`The log holds ${c.datedSnapshots} dated ${plural(c.datedSnapshots, 'snapshot', 'snapshots')} of this listing, but v_competitor_latest returned an undated one: it orders scraped_at DESC and Postgres sorts nulls first under DESC, so an undated row wins. The price beside it may not be the newest one collected.`)}">no scrape date · the view picked an undated row over ${num(c.datedSnapshots)} dated ${plural(c.datedSnapshots, 'one', 'ones')}</div>`
        : '<div class="cell-sub t-warm" title="This row carries no scrape timestamp, so its age is unknown.">no scrape date</div>';
    }
    const cls = staleSet.has(c) ? 't-hot' : stale ? 't-warm' : 't-muted';
    const why = staleSet.has(c)
      ? `Collected ${dt(c.at)}${c.snapshotCount > 1 ? ` — the newest of ${c.snapshotCount} snapshots of this listing` : ''}. That trails the newest row in the table by more than ${REFRESH_LAG_HOURS} h, so the last scrape did not cover this listing.`
      : `Collected ${dt(c.at)}${c.snapshotCount > 1 ? ` — the newest of ${c.snapshotCount} snapshots of this listing` : ''}.`;
    return `<div class="cell-sub ${cls}" title="${esc(why)}">${esc(ago(c.at))}${staleSet.has(c) ? ' · not refreshed' : ''}</div>`;
  };

  const cols = [
    /* "Source", not "Competitor". The hostname is kept visible — it is the one
       thing a reader can go and check — and what KIND of page it is now comes
       from `source_kind` where the row records it and from the domain where it
       does not, with the two never presented as the same claim. Headed
       "Competitor" over an OEM's list page, this column read to a rep as a
       rival showroom undercutting us on the same used unit. */
    { label: 'Source', strong: true, render: c => {
      const src = sourceWords(c);
      return `${esc(c.host || c.name || 'Unnamed source')}
        ${src ? `<div class="cell-sub ${src.tone ? `t-${src.tone}` : ''}" style="white-space:normal" title="${esc(`${src.what}: the price beside it is ${src.price}.${src.sure ? '' : ' The scraper did not record what kind of page this is; this is read off the domain.'}`)}">${esc(src.what)}${src.sure ? '' : ' (read off the domain)'}</div>` : ''}
        ${c.fault ? `<div class="cell-sub t-hot" style="white-space:normal" title="${esc(c.fault.why)}">Not a seller — ${esc(c.fault.kind === 'interstitial' ? 'a bot-detection page the scraper stored as a competitor' : 'a placeholder the scraper wrote instead of a name')}</div>` : ''}
        ${ageCell(c)}`;
    } },
    /* Our model string, and under it the page's own words for what IT is
       selling. Those two lines are the comparison; until 1 Sep 2026 the second
       did not exist and this column showed our string twice without saying so. */
    { label: 'Vehicle', render: c => `${esc(c.label)}
        ${c.title
          ? `<div class="cell-sub" style="white-space:normal" title="${esc(`The page's own title for what it is selling. Our model string is the line above; this is the field that lets the match fail.`)}">their page: ${esc(c.title)}</div>`
          : `<div class="cell-sub t-warm" style="white-space:normal" title="${esc(NO_TITLE)}">no listing title recorded</div>`}
        ${c.units.length > 1 ? `<div class="cell-sub">${num(c.units.length)} comparable units in stock</div>` : ''}` },
    /* Was "Lowest on their page", which is only what the figure is on a row the
       old scraper wrote. On a rated row it is a named offer, so the header says
       "Their price" and the cell says which offer and in what condition. */
    { label: 'Their price', align: 'r', render: c => {
      if (c.price == null) return '<span class="t-muted" title="This row has no competitor price recorded.">—</span>';
      return `${aed(c.price)}
        ${c.offer
          ? `<div class="cell-sub" style="white-space:normal" title="${esc(PRICE_RANKED)}">${esc(c.offer)}${c.cond && c.cond !== 'unknown' ? ` · ${esc(c.cond)}` : ' · condition not stated'}</div>`
          : `<div class="cell-sub t-warm" style="white-space:normal" title="${esc(PRICE_UNCONSTRAINED)}">lowest figure on the page — no offer recorded</div>`}`;
    } },
    { label: 'Our list price', align: 'r', render: c => {
      if (invErr) return '<span class="t-muted" title="Inventory did not load.">—</span>';
      if (c.unmatched) return `<span class="t-muted" title="${esc(c.conflictNote || 'No unit on the lot carries this model name. Model name is the only thing either table records, so there is nothing looser to fall back on.')}">not stocked</span>`;
      if (c.ourPrice == null) return '<span class="t-muted" title="The matching unit carries no list price.">no price on record</span>';
      return `${aed(c.ourPrice)}${c.ourHigh !== c.ourPrice
        ? `<div class="cell-sub">lowest of ${aed(c.ourPrice)}–${aed(c.ourHigh)}</div>` : ''}`;
    } },
    /* The direction is in the header because the same quantity appears in the
       drawer and in `price_diff_aed` with the opposite sign. */
    { label: 'Gap · ours − theirs', align: 'r', render: deltaCell },
    { label: 'Match', render: matchChip },
  ];

  const card = el('div', 'card flush');
  card.innerHTML = `
    <div class="card-head"><div><div class="card-title">Price comparison</div>
      <div class="card-sub" style="white-space:normal">One row per listing, from <span class="mono">v_competitor_latest</span>, against the cheapest unit we hold whose <strong>model name</strong> matches. ${unratedRows.length === live.length
      ? `Read the Match column before trusting any gap here: ${plural(live.length, 'this listing predates', 'all of these listings predate')} the 1 Sep 2026 provenance fix, so ${plural(live.length, 'it carries', 'they carry')} no listing title of the page’s own to check our model string against, and ${plural(live.length, 'its', 'their')} figure is the lowest AED price over 20,000 found anywhere on the page — no year, trim, mileage or condition matched. How well ${plural(live.length, 'it is', 'they are')} tied to our car was never rated, which is not the same as being rated badly.`
      : `Each row states what it compared: our model string against the page’s own listing title, the price taken from a named offer, and the scraper’s own rating of how well that offer ties to our unit.${untied.length ? ` ${num(untied.length)} of them ${plural(untied.length, 'is', 'are')} rated weak — nothing on the page tied the price to our car — so ${plural(untied.length, 'it shows', 'they show')} the figure as context and no gap is drawn from ${plural(untied.length, 'it', 'them')}.` : ''}${unratedRows.length ? ` ${num(unratedRows.length)} ${plural(unratedRows.length, 'predates', 'predate')} the fix and ${plural(unratedRows.length, 'is', 'are')} unrated.` : ''}`}${oemRows.length ? ` ${oemRows.length === gapRows.length ? (gapRows.length === 1 ? 'That page is' : 'Every one of those pages is') : `${num(oemRows.length)} of those pages ${plural(oemRows.length, 'is', 'are')}`} a manufacturer’s own site, so the number is a new-car list price rather than a rival’s asking price.` : ''} A positive gap means we are asking more than the page quotes${stale && daysOld != null ? `, against a price collected ${esc(dayWord(daysOld))} ago` : ''}.</div></div></div>
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
    /* Drives the provenance block below: five rows answering, in order, what
       our string was held against, which offer the price came from and in what
       condition, what kind of page it came off, and how the scraper rated the
       tie. Before 1 Sep 2026 none of those fields existed and this drawer
       filled the gaps in from assumptions instead. */
    const quality = QUALITY[c.quality];
    const riskWhy = risk ? risk.text + (c.reusable && c.risk !== 'both' ? REUSABLE_NOTE : '') : '';
    const best = c.pricedUnits.length
      ? c.pricedUnits.reduce((a, u) => (uPrice(u) < uPrice(a) ? u : a))
      : null;
    const rowStale = staleSet.has(c);

    openDrawer(`
      <div class="drawer-head">
        <div style="flex:1"><h2 style="font-size:18px">${esc(c.label)}</h2>
          <div class="cell-sub">${c.fault ? `<span class="t-hot">${esc(c.name)} — not a dealership</span>` : esc(c.host || c.name || 'Unnamed source')} · ${c.at ? `scraped ${esc(ago(c.at))}` : 'no scrape date recorded'}</div></div>
        <button class="btn ghost sm" id="dClose" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
      </div>
      <div class="drawer-body">
        ${c.fault ? `<div class="banner hot"><span class="material-symbols-outlined">bug_report</span>
          <div>${esc(c.fault.why)} It is held out of every count, gap and comparison on this screen, and there is nothing here to price against.</div></div>` : ''}
        ${!dated(c) ? `<div class="banner warm"><span class="material-symbols-outlined">schedule</span>
          <div>This row carries no scrape date, so there is no way to say how old the price below is.</div></div>`
        : rowStale ? `<div class="banner hot"><span class="material-symbols-outlined">sync_problem</span>
          <div>Collected ${esc(dt(c.at))} — ${esc(ago(c.at))}${c.snapshotCount > 1 ? `, the newest of ${num(c.snapshotCount)} snapshots of this listing` : ''}. The last scrape did not cover this listing: its newest row trails the newest row in the table by more than ${REFRESH_LAG_HOURS} h. What happened on the runs in between is not something this table records — ${healthLine}</div></div>`
        : stale ? `<div class="banner hot"><span class="material-symbols-outlined">update_disabled</span>
          <div>Collected ${esc(dt(c.at))} — ${esc(ago(c.at))}. Even the newest price on this screen is ${esc(dayWord(daysOld))} old${dryRuns ? `, and ${num(dryRuns)} scheduled ${plural(dryRuns, 'run has', 'runs have')} come and gone since without leaving a row` : ''}. Confirm this figure before quoting it to a customer.</div></div>`
        : `<div class="banner info"><span class="material-symbols-outlined">schedule</span>
          <div>Collected ${esc(dt(c.at))} — ${esc(ago(c.at))}.</div></div>`}
        ${c.delta == null ? `<div class="banner info"><span class="material-symbols-outlined">info</span>
          <div>${esc(c.unmatched ? (c.conflictNote || BASIS.none.why)
            : c.soldOnly ? 'Every unit carrying this model name is sold, so we are not asking a price for one — no gap is computed from a car that is not for sale. The units are listed below for what we got for them.'
              : c.price == null ? 'This row has no competitor price, so no gap can be calculated.'
                : 'The matching unit has no list price on record, so no gap can be calculated.')}</div></div>`
        /* The scraper rated this match weak, so this banner — the sentence a rep
           would repeat out loud — states the refusal instead of the gap. Both
           figures are still below in the key/value list; what is withheld is the
           conclusion, because the page supports none. */
        : !c.concludable ? `<div class="banner hot"><span class="material-symbols-outlined">link_off</span>
          <div>No comparison is drawn from this row. ${esc(QUALITY[c.quality].text)}${c.note ? ` The scraper's own note: "${esc(c.note)}".` : ''} Their ${esc(aed(c.price))} and our ${esc(c.ourPrice == null ? 'unpriced unit' : aed(c.ourPrice))} are both shown below, and the difference between them is not a statement about our pricing.</div></div>`
          : `<div class="banner ${c.delta > 0 ? 'hot' : c.delta < 0 ? 'info' : 'warm'}">
              <span class="material-symbols-outlined">${c.delta > 0 ? 'trending_up' : c.delta < 0 ? 'trending_down' : 'trending_flat'}</span>
              <div>${c.delta === 0
                ? `We are asking exactly what ${esc(c.name || 'this competitor')} asks for this vehicle.`
                /* The sign already lives in the words "more"/"less", so the figure
                   itself is stated unsigned here; the columns above keep aedSigned(). */
                : `We are asking <strong>${esc(aed(Math.abs(c.delta)))}</strong>${c.deltaPct == null ? '' : ` (${esc(pct(Math.abs(c.deltaPct)))})`}
                   ${c.delta > 0 ? 'more than' : 'less than'} ${c.offer ? `the "${esc(c.offer)}" offer on` : 'the lowest price on'} ${esc(c.host || c.name || 'this page')}${c.title ? `, which that page lists as "${esc(c.title)}"` : ' for something carrying the same model name'}${
                     /* Two different uncertainties, and they must not shout
                        over each other. On an `exact_year` row the page itself
                        named our model year, so "not, as far as this data can
                        say, for the same car" reads as a flat contradiction of
                        the chip beside it — what is actually still open there
                        is the manufacturer, because neither table records one.
                        On every weaker rating the blunt clause is the right
                        one and is kept. */
                     !c.makeUnconfirmed ? ''
                       : c.quality === 'exact_year' ? ' — though neither table records a manufacturer, so a model name shared across makes would still go unnoticed'
                         : ' — not, as far as this data can say, for the same car'}.
                   ${c.unrated ? 'This comparison predates the 1 Sep 2026 provenance fix, so how well that price is tied to our car was never rated — it is a true subtraction of two stored numbers and nothing stronger.' : ''}
                   ${(() => { const src = sourceWords(c); return c.isOem && src ? `${esc(c.host || c.name)} is ${esc(src.what)}${src.sure ? '' : ' (read off the domain, not recorded)'}, so that figure is ${esc(src.price)}.` : ''; })()}`}</div></div>`}

        <dl class="kv">
          <dt>${c.offer ? 'Their price (from the offer below)' : 'Lowest price on their page'}</dt><dd class="num">${c.price == null ? '—' : aed(c.price)}</dd>
          <dt>Our list price</dt><dd class="num">${c.ourPrice == null ? '—' : aed(c.ourPrice)}</dd>
          <dt>Gap (ours − theirs)</dt><dd class="num">${c.delta == null ? '—'
            /* Shown, because it is a real subtraction, and immediately labelled
               as not a conclusion — the drawer is the one place both figures
               and the reason they may not be compared can sit together. */
            : c.concludable ? aedSigned(c.delta)
              : `<span class="t-muted">${esc(aedSigned(c.delta))} <span class="cell-sub">not a comparison</span></span>`}</dd>
          <dt>Matched on</dt><dd>${esc(basis.chip)}${risk ? ` · ${esc(risk.chip)}` : ''} · ${esc(quality.chip)}</dd>
          <dt>Scraped</dt><dd>${c.at ? `${esc(dt(c.at))} <span class="cell-sub">· ${esc(ago(c.at))}</span>` : '—'}</dd>
        </dl>

        <div style="margin-top:20px"><div class="label-caps">What was compared with what</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Our model text</dt><dd>${esc(c.model || '—')}</dd>
            <dt>Their listing title</dt><dd>${c.title
              ? esc(c.title)
              : `<span class="t-warm">not recorded</span> <span class="cell-sub" style="white-space:normal">${esc(NO_TITLE)}</span>`}</dd>
            <dt>Priced from</dt><dd>${c.offer
              ? `${esc(c.offer)}${c.cond ? ` <span class="cell-sub">· the page states this offer is ${esc(c.cond)}</span>` : ' <span class="cell-sub">· the page did not state new or used</span>'}`
              : `<span class="t-warm">no offer recorded</span> <span class="cell-sub" style="white-space:normal">${esc(PRICE_UNCONSTRAINED)}</span>`}</dd>
            <dt>Source</dt><dd>${esc(c.host || c.name || '—')}${(() => {
              const src = sourceWords(c);
              return src
                ? ` <span class="cell-sub ${src.tone ? `t-${src.tone}` : ''}">· ${esc(src.what)}${src.sure ? '' : ', read off the domain rather than recorded'}</span>`
                : ' <span class="cell-sub t-warm">· kind not recorded, and the hostname does not name a manufacturer</span>';
            })()}</dd>
            <dt>Match quality</dt><dd><span class="${quality.tone ? `t-${quality.tone}` : ''}">${esc(quality.chip)}</span></dd>
          </dl>
          <div class="cell-sub ${quality.tone ? `t-${quality.tone}` : ''}" style="white-space:normal;margin-top:8px">${esc(quality.text)}</div>
          ${c.note ? `<div class="cell-sub" style="white-space:normal;margin-top:6px">The scraper's own note on this match: ${esc(c.note)}</div>` : ''}
        </div>

        <div style="margin-top:16px"><div class="label-caps">What this match is</div>
          <div class="cell-sub" style="white-space:normal;margin-top:8px">${esc(basis.why)}</div>
          ${risk ? `<div class="cell-sub ${risk.tone ? `t-${risk.tone}` : ''}" style="white-space:normal;margin-top:6px">${esc(riskWhy)}</div>` : ''}
          ${c.conflictNote ? `<div class="cell-sub t-warm" style="white-space:normal;margin-top:6px">${esc(c.conflictNote)}</div>` : ''}
          ${c.theirMake || c.ourMakes.length ? `<div class="cell-sub" style="white-space:normal;margin-top:6px">Manufacturer${c.theirMake && c.ourMakes.length ? 's' : ''} read out of the model text${c.theirMake ? ` — theirs names ${esc(titleCase(c.theirMake))}` : ''}${c.ourMakes.length ? `${c.theirMake ? ',' : ' —'} ours names ${esc(c.ourMakes.map(titleCase).join(', '))}` : ''}. Inferred from free text, not from a make column: there is none on either table.${c.echoed ? ' And on this row those are one string read twice — the scraper wrote our own model text back out — so their agreement is not evidence of anything.' : ''}</div>` : ''}
          <div class="cell-sub" style="white-space:normal;margin-top:6px">${c.title
            ? `The scrape stores a hostname, our model string, the page's own listing title, the offer the price came from, a price, a date and its own rating of the match. ${esc(c.host || c.name || 'This source')} is the page that was read`
            : `This row stores a page hostname, a model string, a price and a date, and nothing else — the listing title, the offer and the match rating arrived with the 1 Sep 2026 fix and this row predates it. "${esc(c.host || c.name || 'this source')}" is the hostname of the page that was read`}: there is still no listing contact, no stock number on their side, and no way from here to open the page and see it for yourself.</div>
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
                ${String(u.aging_alert || '').toUpperCase() === 'CRITICAL' ? pill('CRITICAL', 'hot', { verbatim: false }) : ''}
              </div></div>`;
          }).join('')
          : `<div class="cell-sub" style="margin-top:8px;white-space:normal">${esc(c.conflictNote || BASIS.none.why)}</div>`}
        </div>

        ${c.snapshotCount > 1 ? `<div style="margin-top:20px"><div class="label-caps">Scrape history · ${num(c.snapshotCount)}</div>
          <div class="cell-sub" style="white-space:normal;margin-top:8px">competitors is an append-only log on purpose — what a price has done over time is worth keeping — so this listing carries one row per run that covered it. The comparison above is the row v_competitor_latest returns, which is the newest; the rest are counted nowhere else on this screen and are here because history is what this block is for.</div>
          ${c.history.map(h => `<div class="list-item" style="cursor:default">
            <div style="flex:1;min-width:0" class="cell-sub">${esc(dt(h.at))}</div>
            <div style="text-align:right;flex-shrink:0" class="num">${h.price == null ? '<span class="t-muted">no price</span>' : aed(h.price)}</div></div>`).join('')}
          ${[...new Set(c.history.map(h => h.price))].length === 1 ? `<div class="cell-sub" style="white-space:normal;margin-top:8px">Every snapshot quotes the same figure, so nothing here shows a price moving — it shows the same page being read ${num(c.snapshotCount)} times.</div>` : ''}
        </div>` : ''}

        <div style="margin-top:20px"><div class="label-caps">As recorded by the scrape</div>
          <dl class="kv" style="margin-top:8px">
            <dt>Our price at scrape time</dt><dd class="num">${c.storedOur == null ? '<span class="t-muted">not recorded</span>' : aed(c.storedOur)}</dd>
            <dt>Difference at scrape time (ours − theirs)</dt><dd class="num">${c.storedGap == null ? '<span class="t-muted">not recorded</span>' : aedSigned(c.storedGap)}</dd>
          </dl>
          ${disagrees ? `<div class="cell-sub" style="white-space:normal;margin-top:8px">The scrape recorded our price as ${esc(aed(c.storedOur))}; inventory currently lists ${esc(aed(c.ourPrice))}. The gap above uses the live list price.</div>` : ''}
          ${c.storedDiff != null ? `<div class="cell-sub" style="white-space:normal;margin-top:6px">Both figures on this screen are signed the same way — positive means we are asking more — because this drawer used to print the one quantity twice with opposite signs four lines apart. The workflow stores it the other way round, as theirs − ours: the raw value in <span class="mono">price_diff_aed</span> is ${esc(aedSigned(c.storedDiff))}, and it is negated here rather than re-derived.</div>` : ''}
        </div>

        ${c.rec ? `<div style="margin-top:20px"><div class="label-caps">AI recommendation</div>
          <div class="cell-sub" style="white-space:normal;margin-top:8px">${esc(c.rec)}</div>
          <div class="cell-sub t-muted" style="white-space:normal;margin-top:6px">Written by the scrape when the row was stored, and shown as stored. It calls the source a competitor and its figure a competitor's price; both are qualified above, and it was composed from the same ${esc(aedSigned(c.storedDiff == null ? 0 : c.storedDiff))} the workflow signs the other way round.</div></div>` : ''}
      </div>
      <div class="drawer-foot">
        <button class="btn primary" id="dPrice"${best && canEditUnit(best.tenant_id) ? '' : ` disabled title="${esc(!best
          ? 'No comparable unit with a list price is in stock, so there is nothing here to re-price.'
          : 'Changing a list price is an owner, admin or manager decision at this dealership.')}"`}>Adjust our list price</button>
        <button class="btn" id="dInv">Open Inventory</button>
      </div>`);
    $('dClose').addEventListener('click', closeDrawer);
    $('dInv').addEventListener('click', () => { closeDrawer(); go('inventory'); });
    if (best && canEditUnit(best.tenant_id)) $('dPrice').addEventListener('click', () => { closeDrawer(); unitForm(best, inv, reload); });
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

  /* ── Per-source summary and our blind spots ─────────────────────────────── */
  await Promise.all([
    panel(byCompHost, {
      title: 'By source',
      /* Not "By competitor". These are page hostnames, and today the only one
         is the manufacturer's own new-car site. */
      sub: `Each page the scrape read, and how old its figures are. ${stale && daysOld != null ? `Nothing here has refreshed for ${esc(dayWord(daysOld))}.` : ''} Listings are matched to our stock on the model name; the counts on the right are only the ones whose price the scraper tied to our car, so a page that quotes a figure for something else adds no position here.`,
      load: async () => groups,
      render: gs => (gs.length ? `<div>${gs.map((g, i) => `
        <div class="list-item" role="button" tabindex="0" data-comp="${i}" style="align-items:flex-start">
          <div style="flex:1;min-width:0">
            <div style="font-weight:500">${esc(g.name)}${g.src ? ` <span class="chip ${g.src.tone ? `t-${g.src.tone}` : ''}" style="margin-left:8px" title="${esc(`${g.src.what}: the prices under it are ${g.src.price}.${g.src.sure ? '' : ' The scraper did not record what kind of page this is; this is read off the domain.'}`)}">${esc(g.src.what)}${g.src.sure ? '' : ' (from the domain)'}</span>` : ''}</div>
            <div class="cell-sub">${num(g.rows.length)} listing${g.rows.length === 1 ? '' : 's'} · ${g.priced === 0
              ? '<span class="t-warm">no price on any row</span>'
              : g.cmp ? `${num(g.cmp)} comparable` : 'none comparable to our stock'}
              ${g.newest ? ` · scraped ${esc(ago(g.newest))}` : ' · <span class="t-warm">no scrape date</span>'}</div>
            ${g.untied ? `<div class="cell-sub t-hot">${num(g.untied)} priced off a page that ties nothing to our car — no gap drawn</div>` : ''}
            ${g.unrated ? `<div class="cell-sub t-warm">${num(g.unrated)} ${plural(g.unrated, 'match', 'matches')} never rated — ${plural(g.unrated, 'it predates', 'they predate')} the 1 Sep provenance fix</div>` : ''}
            ${g.stale ? `<div class="cell-sub t-hot">${g.rows.length === 1
              ? 'Its only listing was'
              : `${num(g.stale)} of its ${num(g.rows.length)} listings ${plural(g.stale, 'was', 'were')}`} not covered by the last scrape</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="${g.above ? 't-hot' : 't-muted'}" style="font-weight:500">${num(g.above)}</div>
            <div class="cell-sub">above its page price${g.below ? ` · ${num(g.below)} below` : ''}</div>
          </div></div>`).join('')}</div>`
        : stateEmpty('No sources yet', 'No scraped row carries a source hostname.', 'storefront')),
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
      /* Re-issues the inventory read rather than re-throwing a captured
         failure, so Retry can succeed. `covered` is computed from the scraped
         rows, which are already in hand, so the blind set can be re-derived
         from whatever comes back. */
      load: async () => {
        const unsold = await unsoldNow();
        return unsold.filter(u => !covered.has(String(uRef(u))));
      },
      render: (units, card) => {
        card.__units = units;
        return units.length ? `<div>${units.slice(0, 12).map((u, i) => `
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
            'Each car on the lot is matched by at least one scraped price.', 'price_check');
      },
    }).then(c => {
      blindCard = c;
      c.querySelector('[data-act="inv"]')?.addEventListener('click', () => go('inventory'));
      /* There is no comparison row to open for these — that is the whole point
         of the panel — so the row opens the unit's own price form instead. */
      const open = i => { const u = (c.__units || [])[Number(i)]; if (u) unitForm(u, invRows || [], reload); };
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
